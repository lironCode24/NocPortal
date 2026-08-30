using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Text.RegularExpressions;
using System.Net.Http;
using System.Text;

public class DataCenterController : Controller
{
    // שימוש בנתיב יחסי או בהגדרה מקובץ תצורה
    private readonly IWebHostEnvironment _env;
    private readonly string _filesFolderPath;
    private readonly string _excelFilePathRG;
    private readonly string _excelFilePathPT;
    // הוספת שדות חדשים לניהול קאש
    private readonly string _cacheFolderPath;
    private readonly string _connectionsFolderPath;
    private readonly TimeSpan _cacheExpiration = TimeSpan.FromHours(12); // תוקף הקאש - 12 שעות

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _proxyUrl = "http://10.10.111.209:8080";
    private readonly string _helixAccessKey = "85Q505MJG73R3KVTYDI9YEZLYT8I59";
    private readonly string _helixAccessSecretKey = "MhMx6Xzxg3djFUmUO0gP3kkgMdxvMlOiY8ZJIbrlix9YMthuTq";
    private readonly string _helixTenantId = "976648405";
    private readonly string _helixApiBaseUrl  = "https://menora-itom.onbmc.com";
    
    private static string _jwtToken;
    private static DateTime _tokenExpiry = DateTime.MinValue;
    
    public DataCenterController(IHttpClientFactory httpClientFactory, IWebHostEnvironment env)
    {
        _httpClientFactory = httpClientFactory;
        _env = env;

        _filesFolderPath = Path.Combine(_env.WebRootPath, "assets", "files");
        _excelFilePathRG = Path.Combine(_filesFolderPath, "תיעוד ציודים בחדרי שרתים - רמת גן.xlsx");
        _excelFilePathPT = Path.Combine(_filesFolderPath, "תיעוד ציודים בחדר שרתים - פתח תקווה.xlsx");
        _cacheFolderPath = Path.Combine(_filesFolderPath, "dataCenterCache");
        _connectionsFolderPath = Path.Combine(_cacheFolderPath, "connections");

        // וודא שהתיקיות קיימות
        Directory.CreateDirectory(_cacheFolderPath);
        Directory.CreateDirectory(_connectionsFolderPath);
    }
    
    private async Task EnsureValidToken()
    {
        // בדוק אם הטוקן תקף
        if (!string.IsNullOrEmpty(_jwtToken) && _tokenExpiry > DateTime.UtcNow)
        {
            return;
        }
        
        var client = CreateHttpClient();
        
        // Step 1: Get Refresh Token
        var loginBody = new
        {
            access_key = _helixAccessKey,
            access_secret_key = _helixAccessSecretKey
        };
        
        var loginContent = new StringContent(
            JsonSerializer.Serialize(loginBody),
            Encoding.UTF8,
            "application/json");
            
        var loginResponse = await client.PostAsync($"{_helixApiBaseUrl }/ims/api/v1/access_keys/login", loginContent);
        loginResponse.EnsureSuccessStatusCode();
        
        var loginResponseContent = await loginResponse.Content.ReadAsStringAsync();
        var loginData = JsonSerializer.Deserialize<JsonElement>(loginResponseContent);
        var refreshToken = loginData.GetProperty("token").GetString();
        
        // Step 2: Get JWT Token
        var tokenBody = new
        {
            token = refreshToken
        };
        
        var tokenContent = new StringContent(
            JsonSerializer.Serialize(tokenBody),
            Encoding.UTF8,
            "application/json");
            
        var tokenResponse = await client.PostAsync($"{_helixApiBaseUrl }/ims/api/v1/auth/tokens", tokenContent);
        tokenResponse.EnsureSuccessStatusCode();
        
        var tokenResponseContent = await tokenResponse.Content.ReadAsStringAsync();
        var tokenData = JsonSerializer.Deserialize<JsonElement>(tokenResponseContent);
        _jwtToken = tokenData.GetProperty("json_web_token").GetString();
        
        // הגדר תפוגה של הטוקן (10 דקות)
        _tokenExpiry = DateTime.UtcNow.AddMinutes(10);
    }

    private HttpClient CreateHttpClient()
    {
        // השתמש ב-HttpClientFactory במקום ליצור HttpClient חדש
        var client = _httpClientFactory.CreateClient("HelixClient");
        
        // הגדר את הפרוקסי
        var handler = new HttpClientHandler
        {
            Proxy = new System.Net.WebProxy(_proxyUrl),
            UseProxy = true,
            ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
        };
        
        client = new HttpClient(handler);
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        
        return client;
    }

    [HttpGet]
    public IActionResult GetRacksData(string dataCenterType, bool forceRefresh = false)
    {
        try
        {
            // If forced refresh is requested, delete the relevant cache file
            if (forceRefresh)
            {
                string cacheFilePath = Path.Combine(_cacheFolderPath, $"datacenter_{dataCenterType}_cache.json");
                if (System.IO.File.Exists(cacheFilePath))
                {
                    System.IO.File.Delete(cacheFilePath);
                }
            }
            
            var racksData = LoadRacksDataFromExcel(dataCenterType);
            return Ok(new { success = true, racksData });
        }
        catch (FileNotFoundException ex)
        {
            return BadRequest(new { success = false, error = $"Excel file not found: {ex.Message}" });
        }
        catch (UnauthorizedAccessException ex)
        {
            return BadRequest(new { success = false, error = $"Access denied to file: {ex.Message}" });
        }
        catch (Exception ex)
        {
            // Log the full exception for debugging
            System.Diagnostics.Debug.WriteLine($"Error in GetRacksData: {ex.ToString()}");
            return BadRequest(new { success = false, error = $"Error loading data: {ex.Message}" });
        }
    }

    [HttpGet]
    public IActionResult GetRackDetails(string rackId, string dataCenterType)
    {
        try
        {
            var racksData = LoadRacksDataFromExcel(dataCenterType);
            
            if (racksData.TryGetValue(rackId, out var rackData))
            {
                return Ok(new { success = true, rackData });
            }
            
            return NotFound(new { success = false, error = $"Rack {rackId} not found" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult ClearCache(string dataCenterType)
    {
        try
        {
            // אם לא צוין סוג חדר שרתים ספציפי, נמחק את כל קבצי הקאש
            if (string.IsNullOrEmpty(dataCenterType))
            {
                // מחיקת כל קבצי הקאש
                if (Directory.Exists(_cacheFolderPath))
                {
                    foreach (var file in Directory.GetFiles(_cacheFolderPath, "datacenter_*_cache.json"))
                    {
                        System.IO.File.Delete(file);
                    }
                }
            }
            else
            {
                // מחיקת קובץ קאש ספציפי
                string cacheFilePath = Path.Combine(_cacheFolderPath, $"datacenter_{dataCenterType}_cache.json");
                if (System.IO.File.Exists(cacheFilePath))
                {
                    System.IO.File.Delete(cacheFilePath);
                }
            }
            
            return Ok(new { success = true, message = "Cache cleared successfully" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult CheckSourceFilesModified(string dataCenterType)
    {
        try
        {
            string excelFilePath = dataCenterType == "RG" ? _excelFilePathRG : _excelFilePathPT;
            string cacheFilePath = Path.Combine(_cacheFolderPath, $"datacenter_{dataCenterType}_cache.json");
            
            if (!System.IO.File.Exists(excelFilePath))
            {
                return Ok(new { hasChanges = false, error = "קובץ המקור לא נמצא" });
            }
            
            // אם קובץ הקאש לא קיים, נחזיר false כדי לא להציג את כפתור הרענון
            // זה יגרום לטעינה רגילה של הנתונים בפעם הראשונה
            if (!System.IO.File.Exists(cacheFilePath))
            {
                return Ok(new { hasChanges = false });
            }
            
            // בדיקת תאריך עדכון אחרון של הקבצים
            var excelFileInfo = new FileInfo(excelFilePath);
            var cacheFileInfo = new FileInfo(cacheFilePath);
            
            // אם קובץ המקור עודכן אחרי קובץ המטמון, יש שינויים
            bool hasChanges = excelFileInfo.LastWriteTime > cacheFileInfo.LastWriteTime;
            
            return Ok(new { hasChanges });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

   // שיפור חישוב גודל היחידה עם התחשבות במסגרות ובצבעים
    int CalculateEquipmentSize(dynamic worksheet, int currentRow, int currentCol, int rowCount)
    {
        // קבל את מספר היחידה הנוכחי
        dynamic currentPositionCell = worksheet.Cells[currentRow, 1];
        double currentPosition = 0;
        
        if (currentPositionCell?.Value == null || 
            !double.TryParse(currentPositionCell.Value.ToString(), 
                out currentPosition))
        {
            return 1;
        }

        string currentEquipment = 
            worksheet.Cells[currentRow, currentCol]?.Value?.ToString() ?? "";
        
        // קבל צבע רקע של התא הנוכחי
        System.Drawing.Color currentColor;
        try
        {
            dynamic interior = worksheet.Cells[currentRow, currentCol].Interior;
            currentColor = System.Drawing.ColorTranslator.FromOle(
                Convert.ToInt32(interior.Color));
        }
        catch
        {
            currentColor = System.Drawing.Color.White;
        }

        int equipmentSize = 1;

        for (int nextRow = currentRow + 1; nextRow <= rowCount; nextRow++)
        {
            dynamic nextCell = worksheet.Cells[nextRow, currentCol];
            string nextValue = nextCell?.Value?.ToString() ?? "";

            // קבל מספר U של השורה הבאה
            dynamic nextPositionCell = worksheet.Cells[nextRow, 1];
            double nextPosition = 0;
            
            if (nextPositionCell?.Value == null || 
                !double.TryParse(nextPositionCell.Value.ToString(), 
                    out nextPosition))
            {
                break; // אין מספר U - עצור
            }

            // בדוק שהשורות עוקבות (U יורד ב-1 בכל פעם)
            if (Math.Abs(currentPosition - nextPosition) > 
                (nextRow - currentRow) + 0.5)
            {
                break; // קפיצה בU - לא המשך של אותו ציוד
            }

            System.Drawing.Color nextColor;
            try
            {
                dynamic nextInterior = 
                    worksheet.Cells[nextRow, currentCol].Interior;
                nextColor = System.Drawing.ColorTranslator.FromOle(
                    Convert.ToInt32(nextInterior.Color));
            }
            catch
            {
                nextColor = System.Drawing.Color.White;
            }

            bool isSameEquipment = false;

            // *** הוסר: תנאי 1 של איחוד לפי שם זהה ***
            // שם זהה = ציוד נפרד עם אותו שם, לא המשך של אותו ציוד

            // תנאי 1: תא ריק עם אותו צבע (לא לבן)
            if (string.IsNullOrWhiteSpace(nextValue) && 
                    currentColor.ToArgb() == nextColor.ToArgb() &&
                    currentColor.ToArgb() != 
                        System.Drawing.Color.White.ToArgb() &&
                    currentColor.ToArgb() != 
                        System.Drawing.Color.FromArgb(255,255,255).ToArgb())
            {
                isSameEquipment = true;
            }
            // תנאי 2: מסגרת משותפת
            else if (HasSameBorder(worksheet, currentRow, nextRow, currentCol))
            {
                isSameEquipment = true;
            }

            if (isSameEquipment)
            {
                int calculatedSize = 
                    (int)Math.Abs(currentPosition - nextPosition) + 1;
                equipmentSize = Math.Max(equipmentSize, calculatedSize);
            }
            else
            {
                break;
            }
        }

        return equipmentSize;
    }

    // פונקציה חדשה לבדיקת מסגרות משותפות
    private bool HasSameBorder(dynamic worksheet, int row1, int row2, int col)
    {
        try
        {
            // בדוק אם יש מסגרת שחורה בשני התאים
            dynamic cell1Border = worksheet.Cells[row1, col].Borders;
            dynamic cell2Border = worksheet.Cells[row2, col].Borders;
            
            // בדוק אם המסגרת התחתונה של התא העליון שחורה
            bool hasBottomBorder = (int)cell1Border[9].LineStyle > 0 && (int)cell1Border[9].Color == 0; // 9 = xlEdgeBottom
            
            // בדוק אם המסגרת העליונה של התא התחתון שחורה
            bool hasTopBorder = (int)cell2Border[8].LineStyle > 0 && (int)cell2Border[8].Color == 0; // 8 = xlEdgeTop
            
            // אם אין מסגרת בין התאים, הם כנראה שייכים לאותו ציוד
            return !hasBottomBorder && !hasTopBorder;
        }
        catch
        {
            // במקרה של שגיאה, נניח שאין מסגרת משותפת
            return false;
        }
    }

    private Dictionary<string, List<object>> LoadRacksDataFromExcel(string dataCenterType)
    {
        try
        {
            // בדיקה אם יש נתונים בקאש ואם הם עדיין תקפים
            string cacheFilePath = Path.Combine(_cacheFolderPath, $"datacenter_{dataCenterType}_cache.json");
            
            if (System.IO.File.Exists(cacheFilePath))
            {
                var fileInfo = new FileInfo(cacheFilePath);
                if ((DateTime.Now - fileInfo.LastWriteTime) < _cacheExpiration)
                {
                    try
                    {
                        // קריאת נתונים מהקאש
                        string jsonData = System.IO.File.ReadAllText(cacheFilePath);
                        var cachedData = JsonSerializer.Deserialize<Dictionary<string, List<object>>>(jsonData);
                        System.Diagnostics.Debug.WriteLine($"Loaded {dataCenterType} data from cache");
                        return cachedData;
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"Error reading from cache: {ex.Message}");
                        // אם יש שגיאה בקריאה מהקאש, נמשיך לקריאה מהאקסל
                    }
                }
            }

            // אם אין קאש תקף, נקרא מהאקסל
            System.Diagnostics.Debug.WriteLine($"Loading {dataCenterType} data from Excel");
            var racksData = LoadRacksDataFromExcelDirectly(dataCenterType);
            
            // שמירת הנתונים בקאש
            try
            {
                // וודא שתיקיית הקאש קיימת
                Directory.CreateDirectory(_cacheFolderPath);
                
                // שמירת הנתונים כקובץ JSON
                string jsonData = JsonSerializer.Serialize(racksData);
                System.IO.File.WriteAllText(cacheFilePath, jsonData);
                System.Diagnostics.Debug.WriteLine($"Saved {dataCenterType} data to cache");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error writing to cache: {ex.Message}");
                // נמשיך גם אם השמירה לקאש נכשלה
            }
            
            return racksData;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error in LoadRacksDataFromExcel: {ex.ToString()}");
            throw;
        }
    }

    private Dictionary<string, List<object>> LoadRacksDataFromExcelDirectly(string dataCenterType)
    {
        var racksData = new Dictionary<string, List<object>>();
        string excelFilePath = dataCenterType == "RG" ? _excelFilePathRG : _excelFilePathPT;
        
        if (!System.IO.File.Exists(excelFilePath))
        {
            throw new FileNotFoundException($"קובץ Excel לא נמצא: {excelFilePath}");
        }

        OfficeInteropHelper helper = null;
        try
        {
            helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel);
            var workbook = helper.OpenWorkbook(excelFilePath);
            
            // בחירת הגיליון המתאים לפי סוג חדר השרתים
            string sheetName = dataCenterType == "RG" ? "RMG A+B" : "PT";
            var worksheet = helper.GetWorksheet(sheetName);

            // קבלת טווח הנתונים
            dynamic usedRange = worksheet.UsedRange;
            int rowCount = usedRange.Rows.Count;
            int colCount = usedRange.Columns.Count;

            // מערך לשמירת שמות העמודות
            var columnNames = new Dictionary<int, string>();
            
            // קריאת שמות העמודות מהשורה הראשונה
            for (int col = 1; col <= colCount; col++)
            {
                dynamic cell = worksheet.Cells[1, col];
                if (cell != null && cell.Value != null)
                {
                    columnNames[col] = cell.Value.ToString();
                }
            }

            // עיבוד הנתונים מהאקסל - שינוי באופן זיהוי מזהי הארונות
            for (int col = 1; col <= colCount; col++)
            {
                // בדוק אם העמודה מכילה מזהה ארון תקף
                if (!columnNames.TryGetValue(col, out string columnName))
                {
                    continue;
                }
                
                // התעלם מעמודות שאינן מכילות מזהי ארונות
                if (string.IsNullOrWhiteSpace(columnName) || columnName.Equals("NaN"))
                {
                    continue;
                }
                
                // חלץ את מזהה הארון בהתאם לסוג חדר השרתים
                string rackId;
                
                // שינוי: שמור את המזהה המלא של הארון (כולל המספר אחרי המקף)
                if (dataCenterType == "RG" && columnName.Contains("-"))
                {
                    // עבור רמת גן, השתמש במזהה המלא כולל המספר אחרי המקף
                    rackId = columnName;
                    
                    // התעלם מעמודות Unnamed
                    if (columnName.StartsWith("Unnamed:"))
                    {
                        continue;
                    }
                }
                else
                {
                    // עבור פתח תקווה, השתמש בכותרת המלאה
                    rackId = columnName;
                    
                    // התעלם מעמודות Unnamed
                    if (columnName.StartsWith("Unnamed:"))
                    {
                        continue;
                    }
                }
                
                // בדוק שמזהה הארון מכיל לפחות אות אחת מ-A-Z
                if (!rackId.Any(char.IsLetter))
                {
                    continue; // דלג על עמודה זו אם אין אותיות במזהה
                }
                
                // יצירת רשימה חדשה לארון אם לא קיימת
                if (!racksData.ContainsKey(rackId))
                {
                    racksData[rackId] = new List<object>();
                }
                
                // רשימה זמנית לאחסון הציודים לפני הוספתם לרשימה הסופית
                var tempEquipmentList = new List<dynamic>();
                
                // עבור על כל השורות בעמודה (מתחיל משורה 2 כי שורה 1 היא כותרות)
                for (int row = 2; row <= rowCount; row++)
                {
                    // קריאת ערך התא
                    dynamic cell = worksheet.Cells[row, col];
                    string cellValue = cell?.Value?.ToString();
                    
                    // בדוק אם יש ערך בתא
                    if (string.IsNullOrWhiteSpace(cellValue))
                    {
                        continue;
                    }
                    
                    // חלץ את מספר היחידה (U) מהשורה - מהעמודה הראשונה
                    dynamic positionCell = worksheet.Cells[row, 1];
                    double position = 0; // אתחול ערך ברירת מחדל
                                        
                    if (positionCell?.Value != null && 
                        double.TryParse(positionCell.Value.ToString(), out position))
                    {
                        // position = U עליון (כפי שמופיע באקסל, למשל 42)
                        int topPosition = (int)position;
                        
                        // חישוב גודל
                        int size = CalculateEquipmentSize(worksheet, row, col, rowCount);
                        
                        // U תחתון = U עליון - גודל + 1
                        int bottomPosition = topPosition - size + 1;
                        
                        // הגנה: אם יצא שלילי או אפס - תקן
                        if (bottomPosition < 1)
                        {
                            size = topPosition; // צמצם את הגודל
                            bottomPosition = 1;
                        }

                        string equipmentType = DetermineEquipmentType(cellValue);

                        tempEquipmentList.Add(new EquipmentItem
                        {
                            StartPosition = bottomPosition,
                            SizeUnits = size,
                            Equipment = cellValue,
                            Type = equipmentType
                        });
                    }
                }
                
                // שנה ל (מיון מלמטה למעלה - U גבוה יותר קודם):
                tempEquipmentList = tempEquipmentList.OrderBy(e => e.StartPosition).ToList();
                
                // תיקון גדלים כדי למנוע חפיפות
                // startPosition = U תחתון, endPosition = U עליון
                for (int i = 0; i < tempEquipmentList.Count - 1; i++)
                {
                    var currentEquipment = tempEquipmentList[i];
                    var nextEquipment = tempEquipmentList[i + 1];
                    
                    // currentEquipment.StartPosition = U תחתון של הציוד הנוכחי
                    // currentEnd = U עליון של הציוד הנוכחי
                    int currentEnd = currentEquipment.StartPosition + currentEquipment.SizeUnits - 1;
                    
                    // אם הציוד הנוכחי חופף עם הציוד הבא (nextEquipment.StartPosition = U תחתון של הבא)
                    if (currentEnd >= nextEquipment.StartPosition)
                    {
                        // תקן את גודל הציוד הנוכחי כך שלא יהיה חפיפה
                        int newSize = nextEquipment.StartPosition - currentEquipment.StartPosition;
                        if (newSize < 1) newSize = 1;
                        
                        // עדכן את הגודל
                        tempEquipmentList[i] = new EquipmentItem
                        {
                            StartPosition = currentEquipment.StartPosition,
                            SizeUnits = newSize,
                            Equipment = currentEquipment.Equipment,
                            Type = currentEquipment.Type
                        };
                    }
                }
                
                // העבר את הציודים המתוקנים לרשימה הסופית
                foreach (var equipment in tempEquipmentList)
                {
                    racksData[rackId].Add(equipment);
                }
            }
            return racksData;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error loading Excel data: {ex.Message}");
            throw;
        }
        finally
        {
            // Ensure proper cleanup of COM objects
            if (helper != null)
            {
                helper.Dispose();
            }
        }
    }

    private string DetermineEquipmentType(string equipment)
    {
        if (string.IsNullOrEmpty(equipment)) return "other";
        
        equipment = equipment.ToLower();
        
        if (equipment.Contains("server") || equipment.Contains("שרת") || 
            equipment.Contains("cl-") || equipment.Contains("power") || 
            equipment.Contains("dell") || equipment.Contains("hp ") ||
            equipment.Contains("ucs") || equipment.Contains("apollo"))
        {
            return "server";
        }
        else if (equipment.Contains("switch") || equipment.Contains("מתג") || 
                equipment.Contains("cisco") || equipment.Contains("sw") || 
                equipment.Contains("arista") || equipment.Contains("nexus") ||
                equipment.Contains("network") || equipment.Contains("ilo sw"))
        {
            return "switch";
        }
        else if (equipment.Contains("storage") || equipment.Contains("אחסון") || 
                equipment.Contains("ds") || equipment.Contains("emc") || 
                equipment.Contains("infinibox") || equipment.Contains("isilon") ||
                equipment.Contains("san") || equipment.Contains("tape"))
        {
            return "storage";
        }
        else
        {
            return "other";
        }
    }

    // הוספת מתודות חדשות לטיפול בחיבורים
    [HttpGet]
    public IActionResult GetEquipmentConnections(string equipmentId, string rackId, string dataCenterType, int startPosition)
    {
        try
        {
            // ניסיון למצוא את הקובץ עם המזהה החדש שכולל את מיקום ה-U
            string connectionsFilePath = Path.Combine(_connectionsFolderPath, $"connections_{dataCenterType}_{rackId}_{startPosition}.json");
            
            // אם הקובץ לא קיים, ננסה עם השם הישן (לתאימות לאחור)
            if (!System.IO.File.Exists(connectionsFilePath))
            {
                string sanitizedEquipmentId = new string(equipmentId.Select(c => char.IsLetterOrDigit(c) || c == ' ' || c == '-' || c == '_' ? c : '_').ToArray());
                connectionsFilePath = Path.Combine(_connectionsFolderPath, $"connections_{dataCenterType}_{rackId}_{sanitizedEquipmentId}.json");
            }
            
            // אם גם עכשיו הקובץ לא קיים, נחזיר רשימה ריקה
            if (!System.IO.File.Exists(connectionsFilePath))
            {
                return Ok(new { success = true, connections = new List<object>() });
            }
            
            // קריאת נתוני החיבורים מהקובץ
            string jsonData = System.IO.File.ReadAllText(connectionsFilePath);
            var connections = JsonSerializer.Deserialize<List<Connection>>(jsonData);
            
            return Ok(new { success = true, connections });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult SaveEquipmentConnections([FromBody] EquipmentConnectionsRequest request)
    {
        try
        {
            // בדיקה שכל הפרמטרים הנדרשים קיימים
            if (string.IsNullOrEmpty(request.RackId) || string.IsNullOrEmpty(request.DataCenterType))
            {
                return BadRequest(new { success = false, error = "חסרים פרמטרים נדרשים" });
            }
            
            // שמירת נתוני החיבורים לפי מיקום ה-U
            string connectionsFilePath = Path.Combine(_connectionsFolderPath, 
                $"connections_{request.DataCenterType}_{request.RackId}_{request.StartPosition}.json");
            
            // *** תיקון: בדיקה שהקובץ לא נעול לפני שמירה ***
            if (!IsFileAvailable(connectionsFilePath))
            {
                return BadRequest(new { success = false, 
                    error = "הקובץ נעול על ידי תהליך אחר. אנא נסה שוב בעוד מספר שניות." });
            }
            
            string jsonData = JsonSerializer.Serialize(request.Connections);
            
            // *** תיקון: כתיבה אטומית ***
            string tempFilePath = connectionsFilePath + ".tmp";
            System.IO.File.WriteAllText(tempFilePath, jsonData);
            System.IO.File.Move(tempFilePath, connectionsFilePath, overwrite: true);
            
            // יצירת חיבורים הפוכים
            CreateReverseConnections(request.Connections, request.DataCenterType, 
                request.RackId, request.EquipmentId, request.StartPosition);
            
            return Ok(new { success = true, message = "החיבורים נשמרו בהצלחה" });
        }
        catch (IOException ex) when (ex.Message.Contains("being used by another process"))
        {
            // *** תיקון: טיפול ספציפי בשגיאת נעילת קובץ ***
            return BadRequest(new { success = false, 
                error = "הקובץ נעול על ידי תהליך אחר. אנא נסה שוב בעוד מספר שניות." });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    // *** פונקציה חדשה: בדיקה אם קובץ זמין לכתיבה ***
    private bool IsFileAvailable(string filePath)
    {
        if (!System.IO.File.Exists(filePath)) return true; // קובץ חדש - תמיד זמין
        
        try
        {
            using (var stream = new FileStream(filePath, FileMode.Open, 
                FileAccess.ReadWrite, FileShare.None))
            {
                return true;
            }
        }
        catch (IOException)
        {
            return false;
        }
    }

    // פונקציה ליצירת חיבורים הפוכים
    private void CreateReverseConnections(List<Connection> connections, string sourceDCType, string sourceRackId, string sourceEquipmentId, int sourcePosition)
    {
        foreach (var connection in connections)
        {
            // בדיקה אם יש מידע על החיבור הנגדי
            if (string.IsNullOrEmpty(connection.ConnectedTo))
                continue;

            // פיצול החיבור המורכב לשלבים (אם יש חיצים)
            string[] connectionSteps = connection.ConnectedTo.Split(new[] { "→", "->" }, StringSplitOptions.RemoveEmptyEntries);
            
            // נתמקד בשלב האחרון של החיבור (היעד הסופי)
            string finalConnection = connectionSteps.Last().Trim();
            
            // ניסיון לחלץ מידע על הציוד המחובר מהתיאור
            // פורמט צפוי: "Device Name (RackId / U-Position / PORT X)" או "Device Name (RackId / B-Position / PORT X)"
            var match = Regex.Match(finalConnection, @"\(([A-Z0-9\-]+)\s*\/\s*([UB])?-?(\d+)\s*\/\s*PORT\s*(\d+)\)");
            
            if (match.Success)
            {
                string targetRackId = match.Groups[1].Value.Trim();
                string positionPrefix = match.Groups[2].Value.Trim().ToUpper();
                if (string.IsNullOrEmpty(positionPrefix)) positionPrefix = "U";
                
                int targetPosition = int.Parse(match.Groups[3].Value.Trim());
                int targetPort = int.Parse(match.Groups[4].Value.Trim());
                
                // קביעת סוג חדר השרתים של היעד (אם לא צוין, נניח שזה אותו חדר)
                string targetDCType = sourceDCType;
                // בדיקה לפי מזהה הארון - אם יש מקף בשם, זה רמת גן
                if (targetRackId.Contains("-"))
                    targetDCType = "RG";
                // אם מזהה הארון מתחיל באות אחרת, זה כנראה פתח תקווה
                else if (char.IsLetter(targetRackId[0]))
                    targetDCType = "PT";
                
                string targetFilePath = Path.Combine(_connectionsFolderPath, 
                    $"connections_{targetDCType}_{targetRackId}_{targetPosition}.json");
                
                // ***  קריאה וכתיבה עם retry logic ***
                WriteFileWithRetry(targetFilePath, targetPort, connection, 
                    sourceEquipmentId, sourceRackId, sourcePosition);
            }
        }
    }

    // *** פונקציה חדשה: כתיבה עם retry ***
    private void WriteFileWithRetry(string filePath, int targetPort, Connection connection,
        string sourceEquipmentId, string sourceRackId, int sourcePosition,
        int maxRetries = 3, int delayMs = 200)
    {
        for (int attempt = 0; attempt < maxRetries; attempt++)
        {
            try
            {
                List<Connection> targetConnections = new List<Connection>();
                
                // קריאה ושחרור מיידי של הקובץ
                if (System.IO.File.Exists(filePath))
                {
                    // *** תיקון: שימוש ב-using עם FileShare.None למניעת גישה מקבילה ***
                    string jsonData;
                    using (var fileStream = new FileStream(filePath, FileMode.Open, 
                        FileAccess.Read, FileShare.Read))
                    using (var reader = new StreamReader(fileStream))
                    {
                        jsonData = reader.ReadToEnd();
                    }
                    // הקובץ משוחרר כאן לפני הכתיבה
                    targetConnections = JsonSerializer.Deserialize<List<Connection>>(jsonData) 
                        ?? new List<Connection>();
                }
                
                
                // בדיקה אם החיבור ההפוך כבר קיים
                var existingConnection = targetConnections.FirstOrDefault(c => c.Port == targetPort);
                
                // יצירת תיאור החיבור ההפוך
                string reverseConnectionDescription = $"{sourceEquipmentId} ({sourceRackId} / U-{sourcePosition} / PORT {connection.Port})";
                
                if (existingConnection != null)
                {
                    // עדכון החיבור הקיים רק אם הוא לא מצביע כבר לחיבור המקור
                    if (!existingConnection.ConnectedTo.Contains(reverseConnectionDescription))
                    {
                        existingConnection.ConnectedTo = reverseConnectionDescription;
                        existingConnection.Type = connection.Type;
                        existingConnection.Description = $"Auto-linked to {sourceRackId}";
                    }
                }
                else
                {
                    // יצירת חיבור חדש
                    targetConnections.Add(new Connection
                    {
                        Port = targetPort,
                        Type = connection.Type,
                        ConnectedTo = reverseConnectionDescription,
                        Description = $"Auto-linked to {sourceRackId}"
                    });
                }
                
                // *** תיקון: כתיבה אטומית - כתוב לקובץ זמני ואז החלף ***
                string tempFilePath = filePath + ".tmp";
                string updatedJsonData = JsonSerializer.Serialize(targetConnections);
                
                System.IO.File.WriteAllText(tempFilePath, updatedJsonData);
                System.IO.File.Move(tempFilePath, filePath, overwrite: true);
                
                return; // הצלחה - צא מהלולאה
            }
            catch (IOException ex) when (attempt < maxRetries - 1)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"File access attempt {attempt + 1} failed: {ex.Message}. Retrying...");
                System.Threading.Thread.Sleep(delayMs * (attempt + 1)); // delay הולך וגדל
            }
        }
    }

    [HttpPost]
    public async Task<IActionResult> UploadConnectionsFile()
    {
        try
        {
            // Check if file exists in request
            if (Request.Form.Files.Count == 0)
            {
                return BadRequest(new { success = false, error = "לא נמצא קובץ בבקשה" });
            }
            
            var file = Request.Form.Files[0];
            
            // Get parameters from form
            string equipmentId = Request.Form["equipmentId"];
            string rackId = Request.Form["rackId"];
            string dataCenterType = Request.Form["dataCenterType"];
            int startPosition = 0;
            int.TryParse(Request.Form["startPosition"], out startPosition);
            
            // Validate required parameters
            if (string.IsNullOrEmpty(rackId) || string.IsNullOrEmpty(dataCenterType) || startPosition <= 0)
            {
                return BadRequest(new { success = false, error = "חסרים פרמטרים נדרשים" });
            }
            
            // Validate file format
            if (!file.FileName.EndsWith(".xlsx") && !file.FileName.EndsWith(".xls") && !file.FileName.EndsWith(".csv"))
            {
                return BadRequest(new { success = false, error = "הקובץ חייב להיות בפורמט Excel או CSV" });
            }
            
            // Save file to temporary location
            string tempFilePath = Path.Combine(Path.GetTempPath(), file.FileName);
            using (var stream = new FileStream(tempFilePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }
            
            // Read connections data from file
            List<EquipmentConnection> connections;
            if (file.FileName.EndsWith(".csv"))
            {
                connections = ReadConnectionsFromCSV(tempFilePath);
            }
            else
            {
                connections = ReadConnectionsFromExcel(tempFilePath);
            }
            
            // Delete temporary file
            System.IO.File.Delete(tempFilePath);
            
            // **הסרנו את השמירה האוטומטית - רק מחזירים את הנתונים**
            // Return connections data without saving
            return Ok(new { success = true, connections, message = "החיבורים נטענו בהצלחה (טרם נשמרו)" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    // פונקציה חדשה לקריאת חיבורים מקובץ CSV
    private List<EquipmentConnection> ReadConnectionsFromCSV(string filePath)
    {
        var connections = new List<EquipmentConnection>();
        
        try
        {
            // קריאת כל שורות הקובץ
            string[] lines = System.IO.File.ReadAllLines(filePath);
            
            // דילוג על שורת הכותרות (אם קיימת)
            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i];
                if (string.IsNullOrWhiteSpace(line)) continue;
                
                // פיצול השורה לפי פסיקים
                string[] values = line.Split(',');
                
                // וידוא שיש מספיק ערכים בשורה
                if (values.Length >= 1)
                {
                    int port = 0;
                    if (int.TryParse(values[0].Trim(), out port))
                    {
                        string type = values.Length >= 2 ? values[1].Trim() : "";
                        string speed = values.Length >= 3 ? values[2].Trim() : ""; // קריאת המהירות
                        string connectedTo = values.Length >= 4 ? values[3].Trim() : "";
                        string description = values.Length >= 5 ? values[4].Trim() : "";
                        
                        connections.Add(new EquipmentConnection
                        {
                            Port = port,
                            Type = type,
                            Speed = speed,
                            ConnectedTo = connectedTo,
                            Description = description
                        });
                    }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error reading connections from CSV: {ex.Message}");
            throw;
        }
        
        return connections;
    }

    // פונקציה לקריאת חיבורים מקובץ אקסל
    private List<EquipmentConnection> ReadConnectionsFromExcel(string filePath)
    {
        var connections = new List<EquipmentConnection>();
        
        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
        {
            try
            {
                var workbook = helper.OpenWorkbook(filePath);
                var worksheet = helper.GetWorksheet(1); // גיליון ראשון
                
                // קבלת טווח הנתונים
                dynamic usedRange = worksheet.UsedRange;
                int rowCount = usedRange.Rows.Count;
                
                // התחלה משורה 2 (אחרי הכותרות)
                for (int row = 2; row <= rowCount; row++)
                {
                    // קריאת נתוני החיבור
                    int port = 0;
                    dynamic portCell = worksheet.Cells[row, 1];
                    if (portCell?.Value != null && int.TryParse(portCell.Value.ToString(), out port))
                    {
                        string type = worksheet.Cells[row, 2]?.Value?.ToString() ?? "";
                        string speed = worksheet.Cells[row, 3]?.Value?.ToString() ?? ""; // קריאת המהירות
                        string connectedTo = worksheet.Cells[row, 4]?.Value?.ToString() ?? "";
                        string description = worksheet.Cells[row, 5]?.Value?.ToString() ?? "";
                        
                        connections.Add(new EquipmentConnection
                        {
                            Port = port,
                            Type = type,
                            Speed = speed,
                            ConnectedTo = connectedTo,
                            Description = description
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"Error reading connections from Excel: {ex.Message}");
                throw;
            }
        }
        
        return connections;
    }

    [HttpPost]
    public IActionResult AddEquipment([FromBody] EquipmentRequest request)
    {
        try
        {
            // Validate request
            if (string.IsNullOrEmpty(request.RackId) || string.IsNullOrEmpty(request.DataCenterType) || 
                string.IsNullOrEmpty(request.Equipment) || request.StartPosition <= 0 || request.SizeUnits <= 0)
            {
                return BadRequest(new { success = false, error = "Missing required parameters" });
            }

            // Check if the U positions are available
            bool isSpaceAvailable = IsUPositionAvailable(
                request.RackId, 
                request.DataCenterType, 
                request.StartPosition, 
                request.SizeUnits);

            if (!isSpaceAvailable)
            {
                return BadRequest(new { success = false, error = "The requested U positions are not available" });
            }

            // Load current rack data
            var racksData = LoadRacksDataFromExcel(request.DataCenterType);
            
            if (!racksData.TryGetValue(request.RackId, out var rackData))
            {
                rackData = new List<object>();
                racksData[request.RackId] = rackData;
            }

            // קביעת סוג הציוד
            string equipmentType = DetermineEquipmentType(request.Equipment);

            // Add new equipment
            var newEquipment = new EquipmentItem
            {
                StartPosition = request.StartPosition,
                SizeUnits = request.SizeUnits,
                Equipment = request.Equipment,
                Type = equipmentType
            };
            
            rackData.Add(newEquipment);

            // Save updated data
            SaveRacksData(request.DataCenterType, racksData);

            // החזרת הציוד החדש בתשובה
            return Ok(new { 
                success = true, 
                message = "Equipment added successfully",
                equipment = newEquipment
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult CheckUPositionsAvailability(string rackId, string dataCenterType, int startPosition, int sizeUnits, int originalStartPosition = 0, string originalEquipment = "")
    {
        try
        {
            bool isAvailable = IsUPositionAvailable(rackId, dataCenterType, startPosition, sizeUnits, null, originalStartPosition, originalEquipment);
            return Ok(new { isAvailable });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    [HttpPut]
    public IActionResult EditEquipment([FromBody] EditEquipmentRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.RackId) || 
                string.IsNullOrEmpty(request.DataCenterType) || 
                request.OriginalStartPosition <= 0 || 
                request.NewStartPosition <= 0 || 
                request.NewSizeUnits <= 0)
            {
                return BadRequest(new { success = false, 
                    error = "Missing required parameters" });
            }

            if (string.IsNullOrEmpty(request.NewRackId))
                request.NewRackId = request.RackId;

            bool isMovingToNewRack = !string.Equals(
                request.RackId, request.NewRackId, 
                StringComparison.OrdinalIgnoreCase);

            // טעינת נתונים עדכניים מהקאש
            var racksData = LoadRacksDataFromExcel(request.DataCenterType);

            if (!racksData.TryGetValue(request.RackId, out var sourceRackData))
            {
                return NotFound(new { success = false, 
                    error = $"Rack {request.RackId} not found" });
            }

            // מציאת הציוד המקורי
            int indexToRemove = -1;
            for (int i = 0; i < sourceRackData.Count; i++)
            {
                int pos  = GetIntProperty(sourceRackData[i], "startPosition");
                string nm = GetStringProperty(sourceRackData[i], "equipment");
                if (pos == request.OriginalStartPosition && 
                    string.Equals(nm, request.OriginalEquipment, 
                        StringComparison.OrdinalIgnoreCase))
                {
                    indexToRemove = i;
                    break;
                }
            }

            if (indexToRemove < 0)
                return NotFound(new { success = false, 
                    error = "Equipment not found" });

            // הסרה מהארון המקורי
            sourceRackData.RemoveAt(indexToRemove);

            // בדיקת זמינות בארון היעד
            // (אחרי הסרה מהמקור - כך שאם אותו ארון, המיקום המקורי פנוי)
            List<object> targetRackData;
            if (isMovingToNewRack)
            {
                if (!racksData.TryGetValue(request.NewRackId, out targetRackData))
                {
                    targetRackData = new List<object>();
                    racksData[request.NewRackId] = targetRackData;
                }
            }
            else
            {
                targetRackData = sourceRackData;
            }

            bool isSpaceAvailable = IsUPositionAvailable(
                request.NewRackId,
                request.DataCenterType,
                request.NewStartPosition,
                request.NewSizeUnits,
                targetRackData); // בדיקה על הנתונים אחרי ההסרה

            if (!isSpaceAvailable)
            {
                // החזרת הציוד למקומו המקורי
                sourceRackData.Insert(indexToRemove, new EquipmentItem
                {
                    StartPosition = request.OriginalStartPosition,
                    SizeUnits     = GetIntProperty(
                        sourceRackData.Count > indexToRemove 
                            ? sourceRackData[indexToRemove] 
                            : new EquipmentItem(), "size_units"),
                    Equipment     = request.OriginalEquipment,
                    Type          = DetermineEquipmentType(request.OriginalEquipment)
                });
                int topPos = request.NewStartPosition + request.NewSizeUnits - 1;
                return BadRequest(new { success = false, 
                    error = $"מיקום U{request.NewStartPosition}–U{topPos} בארון {request.NewRackId} תפוס" });
            }

            // הוספה לארון היעד
            targetRackData.Add(new EquipmentItem
            {
                StartPosition = request.NewStartPosition,
                SizeUnits     = request.NewSizeUnits,
                Equipment     = request.NewEquipment,
                Type          = DetermineEquipmentType(request.NewEquipment)
            });

            // טיפול בקובץ חיבורים
            MoveConnectionsFile(
                request.DataCenterType,
                request.RackId,      request.OriginalStartPosition, 
                request.OriginalEquipment,
                request.NewRackId,   request.NewStartPosition, 
                request.NewEquipment);

            // שמירה - מעדכן את הקאש עם כל הנתונים
            SaveRacksData(request.DataCenterType, racksData);

            return Ok(new { 
                success = true, 
                movedToNewRack = isMovingToNewRack,
                newRackId = request.NewRackId,
                message = isMovingToNewRack 
                    ? $"הציוד הועבר בהצלחה לארון {request.NewRackId}" 
                    : "הציוד עודכן בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    private void MoveConnectionsFile(
        string dataCenterType,
        string sourceRackId, int sourcePosition, string sourceEquipment,
        string targetRackId, int targetPosition, string targetEquipment)
    {
        // חיפוש קובץ חיבורים קיים
        string oldPath = Path.Combine(_connectionsFolderPath,
            $"connections_{dataCenterType}_{sourceRackId}_{sourcePosition}.json");

        if (!System.IO.File.Exists(oldPath))
        {
            // ניסיון עם שם ישן (תאימות לאחור)
            string sanitized = new string(sourceEquipment
                .Select(c => char.IsLetterOrDigit(c) || 
                    c == ' ' || c == '-' || c == '_' ? c : '_').ToArray());
            oldPath = Path.Combine(_connectionsFolderPath,
                $"connections_{dataCenterType}_{sourceRackId}_{sanitized}.json");
        }

        if (!System.IO.File.Exists(oldPath)) return;

        string newPath = Path.Combine(_connectionsFolderPath,
            $"connections_{dataCenterType}_{targetRackId}_{targetPosition}.json");

        // *** תיקון: קרא את התוכן קודם, שחרר, ואז כתוב ***
        string json;
        using (var fileStream = new FileStream(oldPath, FileMode.Open, 
            FileAccess.Read, FileShare.Read))
        using (var reader = new StreamReader(fileStream))
        {
            json = reader.ReadToEnd();
        }
        // הקובץ המקורי משוחרר כאן
        
        System.IO.File.WriteAllText(newPath, json);
        
        // *** תיקון: מחיקה רק אחרי שהכתיבה הצליחה ***
        System.IO.File.Delete(oldPath);

        var connections = JsonSerializer.Deserialize<List<Connection>>(json);
        CreateReverseConnections(connections, dataCenterType, 
            targetRackId, targetEquipment, targetPosition);
    }

    // Helper method to safely extract string property from various object types
    private string GetStringProperty(object obj, string propertyName)
    {
        if (obj is JsonElement jsonElement)
        {
            // נסה עם השם המקורי
            if (jsonElement.TryGetProperty(propertyName, out JsonElement propElement))
            {
                return propElement.GetString() ?? string.Empty;
            }
            
            // נסה עם אות ראשונה גדולה
            string capitalizedName = char.ToUpper(propertyName[0]) + propertyName.Substring(1);
            if (jsonElement.TryGetProperty(capitalizedName, out propElement))
            {
                return propElement.GetString() ?? string.Empty;
            }
            
            // נסה עם שם חלופי
            if (propertyName == "equipment" && jsonElement.TryGetProperty("Equipment", out propElement))
            {
                return propElement.GetString() ?? string.Empty;
            }
            
            return string.Empty;
        }
        else if (obj is IDictionary<string, object> dict)
        {
            // נסה עם השם המקורי
            if (dict.TryGetValue(propertyName, out object value) && value != null)
            {
                return value.ToString() ?? string.Empty;
            }
            
            // נסה עם אות ראשונה גדולה
            string capitalizedName = char.ToUpper(propertyName[0]) + propertyName.Substring(1);
            if (dict.TryGetValue(capitalizedName, out value) && value != null)
            {
                return value.ToString() ?? string.Empty;
            }
            
            // נסה עם שם חלופי
            if (propertyName == "equipment" && dict.TryGetValue("Equipment", out value) && value != null)
            {
                return value.ToString() ?? string.Empty;
            }
            
            return string.Empty;
        }
        else
        {
            // נסה להשתמש ב-reflection
            try
            {
                // נסה עם השם המקורי
                var prop = obj.GetType().GetProperty(propertyName);
                if (prop != null)
                {
                    var value = prop.GetValue(obj);
                    return value?.ToString() ?? string.Empty;
                }
                
                // נסה עם אות ראשונה גדולה
                string capitalizedName = char.ToUpper(propertyName[0]) + propertyName.Substring(1);
                prop = obj.GetType().GetProperty(capitalizedName);
                if (prop != null)
                {
                    var value = prop.GetValue(obj);
                    return value?.ToString() ?? string.Empty;
                }
                
                // נסה עם שם חלופי
                if (propertyName == "equipment")
                {
                    prop = obj.GetType().GetProperty("Equipment");
                    if (prop != null)
                    {
                        var value = prop.GetValue(obj);
                        return value?.ToString() ?? string.Empty;
                    }
                }
            }
            catch { }
            
            // נסה להשתמש ב-dynamic
            try
            {
                dynamic dynamicObj = obj;
                return dynamicObj[propertyName]?.ToString() ?? string.Empty;
            }
            catch { }
            
            return string.Empty;
        }
    }

    [HttpDelete]
    public IActionResult RemoveEquipment([FromBody] RemoveEquipmentRequest request)
    {
        try
        {
            // Validate request
            if (string.IsNullOrEmpty(request.RackId) || string.IsNullOrEmpty(request.DataCenterType) || 
                request.StartPosition <= 0 || string.IsNullOrEmpty(request.Equipment))
            {
                return BadRequest(new { success = false, error = "Missing required parameters" });
            }

            // Load current rack data
            var racksData = LoadRacksDataFromExcel(request.DataCenterType);
            
            if (!racksData.TryGetValue(request.RackId, out var rackData))
            {
                return NotFound(new { success = false, error = $"Rack {request.RackId} not found" });
            }

            // Find the equipment to remove
            int indexToRemove = -1;
            
            for (int i = 0; i < rackData.Count; i++)
            {
                var equipment = rackData[i];
                int startPos = GetIntProperty(equipment, "startPosition");
                string equipName = GetStringProperty(equipment, "equipment");
                
                // השוואה תוך התעלמות מאותיות גדולות/קטנות
                if (startPos == request.StartPosition && 
                    string.Equals(equipName, request.Equipment, StringComparison.OrdinalIgnoreCase))
                {
                    indexToRemove = i;
                    break;
                }
            }

            if (indexToRemove < 0)
            {
                return NotFound(new { success = false, error = "Equipment not found" });
            }

            // Remove the equipment
            rackData.RemoveAt(indexToRemove);

            // Save updated data
            SaveRacksData(request.DataCenterType, racksData);

            return Ok(new { success = true, message = "Equipment removed successfully" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
    }

    private bool IsUPositionAvailable(
        string rackId, 
        string dataCenterType, 
        int startPosition,      // U תחתון
        int sizeUnits, 
        List<object> currentRackData = null, 
        int originalStartPosition = 0, 
        string originalEquipment = null)
    {
        try
        {
            // Load rack data if not provided
            var rackData = currentRackData;
            if (rackData == null)
            {
                var racksData = LoadRacksDataFromExcel(dataCenterType);
                if (!racksData.TryGetValue(rackId, out rackData))
                {
                    // If rack doesn't exist, positions are available
                    return true;
                }
            }

            // Calculate the range of U positions needed
            // startPosition = U תחתון, endPosition = U עליון
            int endPosition = startPosition + sizeUnits - 1;

            // בדיקת גבולות ארון
            if (startPosition < 1 || endPosition > 42 || sizeUnits <= 0)
            {
                return false;
            }

            // Check if any equipment overlaps with the requested range
            foreach (var equipmentObj in rackData)
            {
                // Extract properties safely from JsonElement or dynamic object
                int equipStartPos = GetIntProperty(equipmentObj, "startPosition"); // U תחתון
                string equipName  = GetStringProperty(equipmentObj, "equipment");

                // Skip the original equipment we're editing
                if (originalStartPosition > 0 
                    && equipStartPos == originalStartPosition 
                    && !string.IsNullOrEmpty(originalEquipment) 
                    && string.Equals(equipName, originalEquipment, 
                                    StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                int equipSize   = GetIntProperty(equipmentObj, "size_units");
                if (equipSize <= 0) equipSize = 1;

                int equipEndPos = equipStartPos + equipSize - 1; // U עליון

                // חפיפה: [startPosition..endPosition] חופף [equipStartPos..equipEndPos]
                // חפיפה קיימת כאשר: start <= equipEnd AND end >= equipStart
                bool overlaps = startPosition <= equipEndPos && endPosition >= equipStartPos;

                if (overlaps)
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"Overlap found: new=[{startPosition}-{endPosition}] " +
                        $"vs existing=[{equipStartPos}-{equipEndPos}] ({equipName})");
                    return false;
                }
            }

            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error checking U positions: {ex.Message}");
            throw;
        }
    }

    // Helper method to safely extract int property from various object types
    private int GetIntProperty(object obj, string propertyName)
    {
        // נסה קודם עם השם המדויק
        if (obj is JsonElement jsonElement)
        {
            // נסה עם השם המקורי
            if (jsonElement.TryGetProperty(propertyName, out JsonElement propElement) && 
                propElement.TryGetInt32(out int value))
            {
                return value;
            }
            
            // נסה עם אות ראשונה גדולה
            string capitalizedName = char.ToUpper(propertyName[0]) + propertyName.Substring(1);
            if (jsonElement.TryGetProperty(capitalizedName, out propElement) && 
                propElement.TryGetInt32(out value))
            {
                return value;
            }
            
            // נסה עם שם חלופי (startPosition -> StartPosition או size_units -> SizeUnits)
            if (propertyName == "startPosition" && jsonElement.TryGetProperty("StartPosition", out propElement) && 
                propElement.TryGetInt32(out value))
            {
                return value;
            }
            else if (propertyName == "size_units" && jsonElement.TryGetProperty("SizeUnits", out propElement) && 
                propElement.TryGetInt32(out value))
            {
                return value;
            }
            
            return 0;
        }
        else if (obj is IDictionary<string, object> dict)
        {
            // נסה עם השם המקורי
            if (dict.TryGetValue(propertyName, out object value) && value != null)
            {
                return Convert.ToInt32(value);
            }
            
            // נסה עם אות ראשונה גדולה
            string capitalizedName = char.ToUpper(propertyName[0]) + propertyName.Substring(1);
            if (dict.TryGetValue(capitalizedName, out value) && value != null)
            {
                return Convert.ToInt32(value);
            }
            
            // נסה עם שם חלופי
            if (propertyName == "startPosition" && dict.TryGetValue("StartPosition", out value) && value != null)
            {
                return Convert.ToInt32(value);
            }
            else if (propertyName == "size_units" && dict.TryGetValue("SizeUnits", out value) && value != null)
            {
                return Convert.ToInt32(value);
            }
            
            return 0;
        }
        else
        {
            // נסה להשתמש ב-reflection
            try
            {
                // נסה עם השם המקורי
                var prop = obj.GetType().GetProperty(propertyName);
                if (prop != null)
                {
                    var val = prop.GetValue(obj);
                    return Convert.ToInt32(val);
                }
                
                // נסה עם אות ראשונה גדולה
                string capitalizedName = char.ToUpper(propertyName[0]) + propertyName.Substring(1);
                prop = obj.GetType().GetProperty(capitalizedName);
                if (prop != null)
                {
                    var val = prop.GetValue(obj);
                    return Convert.ToInt32(val);
                }
                
                // נסה עם שם חלופי
                if (propertyName == "startPosition")
                {
                    prop = obj.GetType().GetProperty("StartPosition");
                    if (prop != null)
                    {
                        var val = prop.GetValue(obj);
                        return Convert.ToInt32(val);
                    }
                }
                else if (propertyName == "size_units")
                {
                    prop = obj.GetType().GetProperty("SizeUnits");
                    if (prop != null)
                    {
                        var val = prop.GetValue(obj);
                        return Convert.ToInt32(val);
                    }
                }
            }
            catch { }
            
            // נסה להשתמש ב-dynamic
            try
            {
                dynamic dynamicObj = obj;
                return (int)dynamicObj[propertyName];
            }
            catch { }
            
            return 0;
        }
    }

    private void SaveRacksData(string dataCenterType, Dictionary<string, List<object>> racksData)
    {
        try
        {
            // Clear cache for this data center
            string cacheFilePath = Path.Combine(_cacheFolderPath, $"datacenter_{dataCenterType}_cache.json");
            if (System.IO.File.Exists(cacheFilePath))
            {
                System.IO.File.Delete(cacheFilePath);
            }

            // Save the updated data to cache
            string jsonData = JsonSerializer.Serialize(racksData);
            System.IO.File.WriteAllText(cacheFilePath, jsonData);

            // TODO: Implement saving back to Excel file
            // This is more complex and would require a separate implementation
            // For now, we'll just update the cache and notify the user
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error saving racks data: {ex.Message}");
            throw;
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetRackMetrics(string rackId, string side = "L", int minutes = 60)
    {
        try
        {
            if (string.IsNullOrEmpty(rackId))
            {
                return BadRequest(new { success = false, error = "מזהה ארון חסר" });
            }

            // וידוא שהצד תקין
            side = side.ToUpper();
            if (side != "L" && side != "R")
            {
                side = "L"; // ברירת מחדל
            }

            // הגבלת טווח הזמן
            if (minutes <= 0 || minutes > 1440) // מקסימום 24 שעות
            {
                minutes = 60; // ברירת מחדל - שעה אחת
            }

            // קבלת מטריקות מ-Helix API
            var metrics = await GetRackMetricsFromHelixAPI(rackId, side, minutes);
            return Ok(metrics);
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = $"שגיאה בקבלת מטריקות: {ex.Message}" });
        }
    }

    [HttpGet]
    public IActionResult FindAvailableSpace(string dataCenterType, int requiredUnits)
    {
        if (string.IsNullOrEmpty(dataCenterType) || requiredUnits <= 0)
        {
            return BadRequest(new { success = false, error = "פרמטרים לא תקינים" });
        }

        try
        {
            var racksData = LoadRacksDataFromExcel(dataCenterType);
            var results = new List<object>();

            foreach (var rackEntry in racksData)
            {
                string rackId = rackEntry.Key;
                var rackItems = rackEntry.Value;

                // מיפוי U תפוסים (1–42)
                bool[] occupied = new bool[43]; // אינדקס 1..42

                foreach (var equipmentObj in rackItems)
                {
                    int startPos = GetIntProperty(equipmentObj, "startPosition"); // U תחתון
                    int size = GetIntProperty(equipmentObj, "size_units");

                    if (startPos <= 0 || size <= 0)
                        continue;

                    int endPos = startPos + size - 1; // U עליון
                    if (endPos > 42) endPos = 42;

                    for (int u = startPos; u <= endPos; u++)
                    {
                        if (u >= 1 && u <= 42)
                            occupied[u] = true;
                    }
                }

                // חיפוש רצפים פנויים
                var freeRanges = new List<object>();

                for (int u = 1; u <= 42; u++)
                {
                    // בדוק אם יש רצף של requiredUnits יחידות פנויות החל מ-u
                    if (!occupied[u])
                    {
                        bool canFit = true;
                        int endU = u + requiredUnits - 1; // U עליון

                        // בדוק שהרצף לא יוצא מגבולות הארון
                        if (endU > 42)
                        {
                            continue;
                        }

                        // בדוק שכל היחידות בטווח פנויות
                        for (int check = u; check <= endU; check++)
                        {
                            if (occupied[check])
                            {
                                canFit = false;
                                break;
                            }
                        }

                        if (canFit)
                        {
                            freeRanges.Add(new
                            {
                                start = u,    // U תחתון
                                end = endU    // U עליון
                            });
                        }
                    }
                }

                if (freeRanges.Count > 0)
                {
                    results.Add(new
                    {
                        rackId = rackId,
                        availableRanges = freeRanges
                    });
                }
            }

            return Ok(new
            {
                success = true,
                requiredUnits,
                results
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new
            {
                success = false,
                error = ex.Message
            });
        }
    }

    private async Task<RackMetricsResponse> GetRackMetricsFromHelixAPI(string rackId, string side, int minutes)
    {
        var response = new RackMetricsResponse
        {
            RackId = rackId,
            Success = false
        };

        try
        {
            // אם אנחנו במצב מקומי, החזר נתונים מדומים
            // return GenerateMockRackMetrics(rackId, side, minutes);
            
            // וידוא שיש טוקן תקף
            await EnsureValidToken();
            
            // פורמט מזהה הארון עם הצד
            var formattedRackId = rackId;
            if (!formattedRackId.EndsWith("-L") && !formattedRackId.EndsWith("-R"))
            {
                formattedRackId = $"{rackId}-{side}";
            }

            // חישוב טווח זמן - תמיד נבקש 24 שעות (1440 דקות) כדי שיהיו נתונים לכל הטווחים האפשריים
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var startTime = now - (1440 * 60); // תמיד 24 שעות אחורה

            // הכנת הבקשה למטריקות
            var client = CreateHttpClient();
            client.DefaultRequestHeaders.Add("Authorization", $"Bearer {_jwtToken}");
            client.DefaultRequestHeaders.Add("tenantId", _helixTenantId);

            var powerUrl = $"{_helixApiBaseUrl}/tsws/monitoring/api/v1.0/graph/data?istextparam=false";
            
            // בניית גוף הבקשה
            var requestBody = new
            {
                startTime = startTime,
                endTime = now,
                dataType = 0,
                baseLines = new object[] { },
                thresholds = new object[] { },
                graphDatas = new object[] { },
                dataSets = new[]
                {
                    new
                    {
                        serverId = _helixTenantId,
                        moTypeId = "PSM_DKM_pdu",
                        monitorId = $"fa2f50c7-1cad-4f6f-ab7b-0116ec3e2354%3APSM_DKM_pdu%3A{formattedRackId}",
                        attributeId = "rPDU2DeviceStatusPower"
                    },
                    new
                    {
                        serverId = _helixTenantId,
                        moTypeId = "PSM_DKM_pdu",
                        monitorId = $"fa2f50c7-1cad-4f6f-ab7b-0116ec3e2354%3APSM_DKM_pdu%3A{formattedRackId}",
                        attributeId = "rPDU2SensorTempHumidityStatusTempC"
                    }
                },
                considerDataFromPA = true
            };

            var content = new StringContent(
                JsonSerializer.Serialize(requestBody),
                Encoding.UTF8,
                "application/json"
            );

            var metricsResponse = await client.PostAsync(powerUrl, content);
            
            if (metricsResponse.IsSuccessStatusCode)
            {
                var responseContent = await metricsResponse.Content.ReadAsStringAsync();
                
                // הדפסת התשובה לצורך debug
                System.Diagnostics.Debug.WriteLine($"Response: {responseContent}");
                
                var metricsData = JsonSerializer.Deserialize<JsonElement>(responseContent);

                // בדוק אם יש dataSeries ישירות או תחת _object
                JsonElement dataSeriesElement;
                
                if (metricsData.TryGetProperty("dataSeries", out dataSeriesElement))
                {
                    // המקרה הרגיל - dataSeries ישירות ב-root
                    ProcessDataSeries(dataSeriesElement, response);
                }
                else if (metricsData.TryGetProperty("_object", out var objectElement) && 
                        objectElement.TryGetProperty("dataSeries", out dataSeriesElement))
                {
                    // המקרה של _object.dataSeries
                    ProcessDataSeries(dataSeriesElement, response);
                }
                else
                {
                    response.Error = "לא נמצא dataSeries בתשובה";
                    System.Diagnostics.Debug.WriteLine($"Response structure: {responseContent}");
                }
            }
            else
            {
                response.Error = $"שגיאה בקבלת מטריקות: {metricsResponse.StatusCode}";
                var errorContent = await metricsResponse.Content.ReadAsStringAsync();
                System.Diagnostics.Debug.WriteLine($"Error response: {errorContent}");
            }
        }
        catch (Exception ex)
        {
            response.Error = $"שגיאה בקבלת מטריקות: {ex.Message}";
            System.Diagnostics.Debug.WriteLine($"Error getting rack metrics: {ex}");
        }

        return response;
    }

    // פונקציה עזר לעיבוד dataSeries - גרסה עם זיהוי חכם של סוגי המדדים
    private void ProcessDataSeries(JsonElement dataSeriesElement, RackMetricsResponse response)
    {
        try
        {
            int arrayLength = dataSeriesElement.GetArrayLength();
            
            for (int i = 0; i < arrayLength; i++)
            {
                var series = dataSeriesElement[i];
                bool isPowerMetric = false;
                bool isTemperatureMetric = false;

                // שלב 1: זיהוי לפי uom (הכי אמין!)
                // uom="c" = מעלות צלזיוס = טמפרטורה
                // uom="#" = יחידה פנימית = חשמל
                if (series.TryGetProperty("uom", out var uomProp))
                {
                    string uom = uomProp.GetString() ?? "";
                    System.Diagnostics.Debug.WriteLine($"Series {i} uom: '{uom}'");
                    
                    if (uom.Equals("c", StringComparison.OrdinalIgnoreCase))
                    {
                        isTemperatureMetric = true;
                    }
                    else if (uom.Equals("#", StringComparison.OrdinalIgnoreCase))
                    {
                        isPowerMetric = true;
                    }
                }

                // שלב 2: זיהוי לפי atttibuteId (שים לב - 3 t-ים!)
                if (!isPowerMetric && !isTemperatureMetric)
                {
                    // נסה את שתי הגרסאות - עם שגיאת כתיב ובלי
                    string attrId = "";
                    if (series.TryGetProperty("atttibuteId", out var attrProp1)) // 3 t-ים
                        attrId = attrProp1.GetString() ?? "";
                    else if (series.TryGetProperty("attributeId", out var attrProp2)) // 2 t-ים
                        attrId = attrProp2.GetString() ?? "";
                        
                    System.Diagnostics.Debug.WriteLine($"Series {i} attrId: '{attrId}'");

                    if (attrId.IndexOf("Temp", StringComparison.OrdinalIgnoreCase) >= 0)
                        isTemperatureMetric = true;
                    else if (attrId.IndexOf("Power", StringComparison.OrdinalIgnoreCase) >= 0)
                        isPowerMetric = true;
                }

                // שלב 3: זיהוי לפי name
                if (!isPowerMetric && !isTemperatureMetric)
                {
                    if (series.TryGetProperty("name", out var nameProp))
                    {
                        string name = nameProp.GetString() ?? "";
                        System.Diagnostics.Debug.WriteLine($"Series {i} name: '{name}'");
                        
                        if (name.IndexOf("Temp", StringComparison.OrdinalIgnoreCase) >= 0)
                            isTemperatureMetric = true;
                        else if (name.IndexOf("Power", StringComparison.OrdinalIgnoreCase) >= 0)
                            isPowerMetric = true;
                    }
                }

                System.Diagnostics.Debug.WriteLine(
                    $"Series {i}: isPower={isPowerMetric}, isTemp={isTemperatureMetric}");

                // עיבוד הנתונים
                if (series.TryGetProperty("graphDataPoints", out var dataPoints))
                {
                    if (isPowerMetric || isTemperatureMetric)
                    {
                        ProcessDataPoints(dataPoints, response, isPowerMetric, isTemperatureMetric);
                    }
                    else
                    {
                        System.Diagnostics.Debug.WriteLine($"Series {i}: UNIDENTIFIED - skipping!");
                    }
                }
            }

            // קביעת ערכים נוכחיים
            response.CurrentPower = response.PowerData.Count > 0
                ? response.PowerData.Last().Value
                : (double?)null;

            response.CurrentTemperature = response.TemperatureData.Count > 0
                ? response.TemperatureData.Last().Value
                : (double?)null;

            response.Success = response.PowerData.Count > 0 || response.TemperatureData.Count > 0;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error processing data series: {ex.Message}");
            response.Error = $"שגיאה בעיבוד נתוני המדדים: {ex.Message}";
        }
    }

    // פונקציית עזר לעיבוד נקודות נתונים
    private void ProcessDataPoints(JsonElement dataPoints, RackMetricsResponse response, 
        bool isPowerMetric, bool isTemperatureMetric)
    {
        foreach (var point in dataPoints.EnumerateArray())
        {
            if (point.TryGetProperty("xDataValue", out var xValue))
            {
                long timestamp = xValue.GetInt64();
                
                if (point.TryGetProperty("yDataValue", out var yValue) && 
                    !yValue.ValueKind.Equals(JsonValueKind.Null))
                {
                    double value = yValue.GetDouble();
                    
                    if (isPowerMetric)
                    {
                        // הכפלה ב-10 לערכי צריכת חשמל
                        response.PowerData.Add(new DataPoint
                        {
                            Timestamp = timestamp,
                            Value = value * 10
                        });
                    }
                    else if (isTemperatureMetric)
                    {
                        response.TemperatureData.Add(new DataPoint
                        {
                            Timestamp = timestamp,
                            Value = value
                        });
                    }
                }
            }
        }
    }

    // מתודה חדשה ליצירת נתונים מדומים
    private RackMetricsResponse GenerateMockRackMetrics(string rackId, string side, int minutes)
    {
        var response = new RackMetricsResponse
        {
            RackId = rackId,
            Success = true
        };

        // יצירת נקודות זמן מדומות
        var now = DateTimeOffset.UtcNow;
        var random = new Random();
        
        // יצירת נתוני צריכת חשמל מדומים
        for (int i = 0; i < minutes; i++)
        {
            var timestamp = now.AddMinutes(-minutes + i).ToUnixTimeSeconds();
            
            // צריכת חשמל בין 150kW 1150kW
            var powerValue = 150 + random.NextDouble() * 1000;
            
            response.PowerData.Add(new DataPoint
            {
                Timestamp = timestamp,
                Value = Math.Round(powerValue, 1)
            });
        }
        
        // יצירת נתוני טמפרטורה מדומים
        for (int i = 0; i < minutes; i++)
        {
            var timestamp = now.AddMinutes(-minutes + i).ToUnixTimeSeconds();
            
            // טמפרטורה בין 15°C ל-35°C
            var tempValue = 15 + random.NextDouble() * 20;
            
            response.TemperatureData.Add(new DataPoint
            {
                Timestamp = timestamp,
                Value = Math.Round(tempValue, 1)
            });
        }
        
        // קביעת ערכים נוכחיים
        if (response.PowerData.Count > 0)
        {
            response.CurrentPower = response.PowerData.Last().Value;
        }
        
        if (response.TemperatureData.Count > 0)
        {
            response.CurrentTemperature = response.TemperatureData.Last().Value;
        }
        
        return response;
    }

    private async Task<string> GetHelixRefreshToken()
    {
        try
        {
            using (var httpClient = new HttpClient())
            {
                var url = $"{_helixApiBaseUrl}/ims/api/v1/access_keys/login";
                
                var requestBody = new
                {
                    access_key = _helixAccessKey,
                    access_secret_key = _helixAccessSecretKey
                };

                var content = new StringContent(
                    JsonSerializer.Serialize(requestBody),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await httpClient.PostAsync(url, content);
                
                if (response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    var tokenData = JsonSerializer.Deserialize<JsonElement>(responseContent);
                    
                    if (tokenData.TryGetProperty("token", out var token))
                    {
                        return token.GetString();
                    }
                }
                
                return null;
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error getting refresh token: {ex}");
            return null;
        }
    }

    private async Task<string> GetHelixJwtToken(string refreshToken)
    {
        try
        {
            using (var httpClient = new HttpClient())
            {
                var url = $"{_helixApiBaseUrl}/ims/api/v1/auth/tokens";
                
                var requestBody = new
                {
                    token = refreshToken
                };

                var content = new StringContent(
                    JsonSerializer.Serialize(requestBody),
                    Encoding.UTF8,
                    "application/json"
                );

                var response = await httpClient.PostAsync(url, content);
                
                if (response.IsSuccessStatusCode)
                {
                    var responseContent = await response.Content.ReadAsStringAsync();
                    var tokenData = JsonSerializer.Deserialize<JsonElement>(responseContent);
                    
                    if (tokenData.TryGetProperty("json_web_token", out var jwtToken))
                    {
                        return jwtToken.GetString();
                    }
                }
                
                return null;
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error getting JWT token: {ex}");
            return null;
        }
    }

    // מתודה נוספת לקבלת מטריקות נוכחיות בלבד (ללא היסטוריה)
    [HttpGet]
    public async Task<IActionResult> GetCurrentRackMetrics(string rackId, string side = "L")
    {
        try
        {
            if (string.IsNullOrEmpty(rackId))
            {
                return BadRequest(new { success = false, error = "מזהה ארון חסר" });
            }

            // וידוא שהצד תקין
            side = side.ToUpper();
            if (side != "L" && side != "R")
            {
                side = "L"; // ברירת מחדל
            }

            // קבלת מטריקות מ-Helix API (רק 5 דקות אחרונות)
            var metrics = await GetRackMetricsFromHelixAPI(rackId, side, 5);
            
            // החזרת רק הערכים הנוכחיים
            return Ok(new { 
                success = metrics.Success, 
                rackId = metrics.RackId,
                currentPower = metrics.CurrentPower,
                currentTemperature = metrics.CurrentTemperature,
                error = metrics.Success ? null : metrics.Error // רק אם יש שגיאה
            });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = $"שגיאה בקבלת מטריקות נוכחיות: {ex.Message}" });
        }
    }

    public class RackMetricsRequest
    {
        public string RackId { get; set; }
        public string Side { get; set; } = "L";
        public int Minutes { get; set; } = 60;
    }

    public class DataPoint
    {
        public long Timestamp { get; set; }
        public double Value { get; set; }
    }

    public class RackMetricsResponse
    {
        public bool Success { get; set; }
        public string RackId { get; set; }
        public List<DataPoint> PowerData { get; set; } = new List<DataPoint>();
        public List<DataPoint> TemperatureData { get; set; } = new List<DataPoint>();
        public double? CurrentPower { get; set; }
        public double? CurrentTemperature { get; set; }
        public string Error { get; set; }
    }

    public class EquipmentRequest
    {
        public string RackId { get; set; }
        public string DataCenterType { get; set; }
        public int StartPosition { get; set; }
        public int SizeUnits { get; set; }
        public string Equipment { get; set; }
    }

    public class EditEquipmentRequest : EquipmentRequest
    {
        public int OriginalStartPosition { get; set; }
        public string OriginalEquipment { get; set; }
        public string NewRackId { get; set; }  
        public int NewStartPosition { get; set; }
        public int NewSizeUnits { get; set; }
        public string NewEquipment { get; set; }
    }

    public class RemoveEquipmentRequest
    {
        public string RackId { get; set; }
        public string DataCenterType { get; set; }
        public int StartPosition { get; set; }
        public string Equipment { get; set; }
    }
    
    // מחלקה לקבלת הנתונים מהבקשה
    public class EquipmentConnectionsRequest
    {
        public string EquipmentId { get; set; }
        public string RackId { get; set; }
        public string DataCenterType { get; set; }
        public int StartPosition { get; set; }
        public List<Connection> Connections { get; set; }
    }

    // מחלקה לייצוג חיבור
    public class Connection
    {
        public int Port { get; set; }
        public string Type { get; set; }
        public string ConnectedTo { get; set; }
        public string Description { get; set; }
        public string Speed { get; set; }
    }

    // מחלקה לייצוג חיבור ציוד
    public class EquipmentConnection
    {
        public int Port { get; set; }
        public string Type { get; set; }
        public string ConnectedTo { get; set; }
        public string Description { get; set; }
        public string Speed { get; set; }
    }

    public class EquipmentItem
    {
        public int StartPosition { get; set; }
        public int SizeUnits { get; set; }
        public string Equipment { get; set; }
        public string Type { get; set; }
    }
}