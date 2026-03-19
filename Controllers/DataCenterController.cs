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

public class DataCenterController : Controller
{
    // שימוש בנתיב יחסי או בהגדרה מקובץ תצורה
    private readonly string _excelFilePathRG = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\Data Center\תיעוד ציודים בחדרי שרתים - רמת גן.xlsx";
    private readonly string _excelFilePathPT = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\Data Center\תיעוד ציודים בחדר שרתים - פתח תקווה.xlsx";
    // הוספת שדות חדשים לניהול קאש
    private readonly string _cacheFolderPath = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\files\dataCenterCache";
    private readonly string _connectionsFolderPath;
    private readonly TimeSpan _cacheExpiration = TimeSpan.FromHours(12); // תוקף הקאש - 12 שעות


    public DataCenterController()
    {
        _connectionsFolderPath = Path.Combine(_cacheFolderPath, "connections");
        // וודא שהתיקיות קיימות
        Directory.CreateDirectory(_cacheFolderPath);
        Directory.CreateDirectory(_connectionsFolderPath);
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
        
        if (currentPositionCell?.Value != null && double.TryParse(currentPositionCell.Value.ToString(), out currentPosition))
        {
            // בדיקה אם יש מסגרת שחורה או צבע רקע זהה בתאים הבאים
            string currentEquipment = worksheet.Cells[currentRow, currentCol]?.Value?.ToString() ?? "";
            dynamic currentCellFormat = worksheet.Cells[currentRow, currentCol].Interior;
            System.Drawing.Color currentColor;
            try {
                currentColor = System.Drawing.ColorTranslator.FromOle(Convert.ToInt32(currentCellFormat.Color));
            } catch {
                currentColor = System.Drawing.Color.White; // Default color if conversion fails
            }
            
            int equipmentSize = 1; // גודל ברירת מחדל
            
            // חפש תאים עוקבים עם אותו ציוד או אותו צבע רקע
            for (int nextRow = currentRow + 1; nextRow <= rowCount; nextRow++)
            {
                // בדוק אם התא הבא ריק
                dynamic nextCell = worksheet.Cells[nextRow, currentCol];
                string nextValue = nextCell?.Value?.ToString() ?? "";
                
                // בדוק את הצבע של התא הבא
                dynamic nextCellFormat = worksheet.Cells[nextRow, currentCol].Interior;
                System.Drawing.Color nextColor = System.Drawing.ColorTranslator.FromOle((int)nextCellFormat.Color);
                
                // בדוק אם התא הבא שייך לאותו ציוד (לפי צבע זהה או מסגרת)
                bool isSameEquipment = false;
                
                // אם יש ערך זהה בתא הבא, זה כנראה אותו ציוד
                if (!string.IsNullOrWhiteSpace(nextValue) && nextValue.Equals(currentEquipment))
                {
                    isSameEquipment = true;
                }
                // אם הצבע זהה והתא הבא ריק, זה כנראה המשך של אותו ציוד
                else if (string.IsNullOrWhiteSpace(nextValue) && currentColor.ToArgb() == nextColor.ToArgb() && 
                        currentColor.ToArgb() != System.Drawing.Color.White.ToArgb())
                {
                    isSameEquipment = true;
                }
                // בדוק אם יש מסגרת שחורה שמקיפה את התאים (מציינת אותו ציוד)
                else if (HasSameBorder(worksheet, currentRow, nextRow, currentCol))
                {
                    isSameEquipment = true;
                }
                
                if (isSameEquipment)
                {
                    // בדוק את מספר היחידה של התא הבא
                    dynamic nextPositionCell = worksheet.Cells[nextRow, 1];
                    double nextPosition = 0;
                    
                    if (nextPositionCell?.Value != null && double.TryParse(nextPositionCell.Value.ToString(), out nextPosition))
                    {
                        // חשב את ההפרש בין מספרי היחידות
                        equipmentSize = Math.Max(equipmentSize, (int)Math.Abs(currentPosition - nextPosition) + 1);
                    }
                }
                else
                {
                    // אם הגענו לתא שלא שייך לאותו ציוד, נפסיק את החיפוש
                    break;
                }
            }
            
            return equipmentSize;
        }
        
        // אם לא הצלחנו לחשב את הגודל, נחזיר ברירת מחדל של 1
        return 1;
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
                                        
                    if (positionCell?.Value != null && double.TryParse(positionCell.Value.ToString(), out position))
                    {
                        // קבע את סוג הציוד לפי תוכן התא
                        string equipmentType = DetermineEquipmentType(cellValue);
                        
                        // חישוב גודל היחידה בצורה מדויקת יותר
                        int size = CalculateEquipmentSize(worksheet, row, col, rowCount);
                        
                        // הוסף את הציוד לרשימה הזמנית
                        tempEquipmentList.Add(new EquipmentItem
                        {
                            StartPosition = (int)position,
                            SizeUnits = size,
                            Equipment = cellValue,
                            Type = equipmentType
                        });
                    }
                }
                
                // מיון הציודים לפי מיקום (מלמעלה למטה)
                tempEquipmentList = tempEquipmentList.OrderByDescending(e => e.StartPosition).ToList();
                
                // תיקון גדלים כדי למנוע חפיפות
                for (int i = 0; i < tempEquipmentList.Count - 1; i++)
                {
                    var currentEquipment = tempEquipmentList[i];
                    var nextEquipment = tempEquipmentList[i + 1];
                    
                    int currentEnd = currentEquipment.StartPosition - currentEquipment.SizeUnits + 1;
                    
                    // אם הציוד הנוכחי חופף עם הציוד הבא
                    if (currentEnd <= nextEquipment.StartPosition)
                    {
                        // תקן את גודל הציוד הנוכחי כך שלא יהיה חפיפה
                        int newSize = currentEquipment.StartPosition - nextEquipment.StartPosition;
                        if (newSize < 1) newSize = 1; // מינימום גודל של 1
                        
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
            string connectionsFilePath = Path.Combine(_connectionsFolderPath, $"connections_{request.DataCenterType}_{request.RackId}_{request.StartPosition}.json");
            string jsonData = JsonSerializer.Serialize(request.Connections);
            System.IO.File.WriteAllText(connectionsFilePath, jsonData);
            
            // הוספת קוד חדש - יצירת חיבורים הפוכים
            CreateReverseConnections(request.Connections, request.DataCenterType, request.RackId, request.EquipmentId, request.StartPosition);
            
            return Ok(new { success = true, message = "החיבורים נשמרו בהצלחה" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
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
                string positionPrefix = match.Groups[2].Value.Trim().ToUpper(); // U או B
                if (string.IsNullOrEmpty(positionPrefix)) positionPrefix = "U"; // ברירת מחדל אם לא צוין
                
                int targetPosition = int.Parse(match.Groups[3].Value.Trim());
                int targetPort = int.Parse(match.Groups[4].Value.Trim());
                
                // קביעת סוג חדר השרתים של היעד (אם לא צוין, נניח שזה אותו חדר)
                string targetDCType = sourceDCType;
                
                // בדיקה לפי מזהה הארון - אם יש מקף בשם, זה רמת גן
                if (targetRackId.Contains("-"))
                {
                    targetDCType = "RG";
                }
                // אם מזהה הארון מתחיל באות אחרת, זה כנראה פתח תקווה
                else if (char.IsLetter(targetRackId[0]))
                {
                    targetDCType = "PT";
                }
                
                // בדיקה אם קובץ החיבורים של היעד קיים
                string targetFilePath = Path.Combine(_connectionsFolderPath, $"connections_{targetDCType}_{targetRackId}_{targetPosition}.json");
                List<Connection> targetConnections = new List<Connection>();
                
                // אם הקובץ קיים, נטען את החיבורים הקיימים
                if (System.IO.File.Exists(targetFilePath))
                {
                    string jsonData = System.IO.File.ReadAllText(targetFilePath);
                    targetConnections = JsonSerializer.Deserialize<List<Connection>>(jsonData);
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
                        existingConnection.Type = connection.Type; // שמירה על אותו סוג חיבור
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
                
                // שמירת החיבורים המעודכנים
                string updatedJsonData = JsonSerializer.Serialize(targetConnections);
                System.IO.File.WriteAllText(targetFilePath, updatedJsonData);
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
                        string connectedTo = values.Length >= 3 ? values[2].Trim() : "";
                        string description = values.Length >= 4 ? values[3].Trim() : "";
                        
                        connections.Add(new EquipmentConnection
                        {
                            Port = port,
                            Type = type,
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
                        string connectedTo = worksheet.Cells[row, 3]?.Value?.ToString() ?? "";
                        string description = worksheet.Cells[row, 4]?.Value?.ToString() ?? "";
                        
                        connections.Add(new EquipmentConnection
                        {
                            Port = port,
                            Type = type,
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
            // Validate request
            if (string.IsNullOrEmpty(request.RackId) || string.IsNullOrEmpty(request.DataCenterType) || 
                request.OriginalStartPosition <= 0 || request.NewStartPosition <= 0 || request.NewSizeUnits <= 0)
            {
                return BadRequest(new { success = false, error = "Missing required parameters" });
            }

            // Load current rack data
            var racksData = LoadRacksDataFromExcel(request.DataCenterType);
            
            if (!racksData.TryGetValue(request.RackId, out var rackData))
            {
                return NotFound(new { success = false, error = $"Rack {request.RackId} not found" });
            }

            // Find the equipment to edit
            object equipmentToEdit = null;
            int indexToRemove = -1;
            
            for (int i = 0; i < rackData.Count; i++)
            {
                var equipment = rackData[i];
                int startPos = GetIntProperty(equipment, "startPosition");
                string equipName = GetStringProperty(equipment, "equipment");
                
                // השוואה תוך התעלמות מאותיות גדולות/קטנות
                if (startPos == request.OriginalStartPosition && 
                    string.Equals(equipName, request.OriginalEquipment, StringComparison.OrdinalIgnoreCase))
                {
                    equipmentToEdit = equipment;
                    indexToRemove = i;
                    break;
                }
            }

            if (equipmentToEdit == null)
            {
                return NotFound(new { success = false, error = "Equipment not found" });
            }

            // If position or size changed, check availability
            if (request.OriginalStartPosition != request.NewStartPosition || 
                GetIntProperty(equipmentToEdit, "size_units") != request.NewSizeUnits)
            {
                // Remove the current equipment temporarily for the check
                if (indexToRemove >= 0)
                {
                    rackData.RemoveAt(indexToRemove);
                }
                
                bool isSpaceAvailable = IsUPositionAvailable(
                    request.RackId, 
                    request.DataCenterType, 
                    request.NewStartPosition, 
                    request.NewSizeUnits,
                    rackData);

                if (!isSpaceAvailable)
                {
                    // Add the equipment back since we're not making changes
                    if (indexToRemove >= 0)
                    {
                        rackData.Insert(indexToRemove, equipmentToEdit);
                    }
                    return BadRequest(new { success = false, error = "The requested U positions are not available" });
                }
            }
            else
            {
                // If we're just changing the name, remove the old entry
                if (indexToRemove >= 0)
                {
                    rackData.RemoveAt(indexToRemove);
                }
            }

            // Add updated equipment
            rackData.Add(new EquipmentItem
            {
                StartPosition = request.NewStartPosition,
                SizeUnits = request.NewSizeUnits,
                Equipment = request.NewEquipment,
                Type = DetermineEquipmentType(request.NewEquipment)
            });

            // Save updated data
            SaveRacksData(request.DataCenterType, racksData);

            return Ok(new { success = true, message = "Equipment updated successfully" });
        }
        catch (Exception ex)
        {
            return BadRequest(new { success = false, error = ex.Message });
        }
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

    private bool IsUPositionAvailable(string rackId, string dataCenterType, int startPosition, int sizeUnits, List<object> currentRackData = null, int originalStartPosition = 0, string originalEquipment = null)
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
            int endPosition = startPosition - sizeUnits + 1;
            if (endPosition < 1) endPosition = 1; // Ensure we don't go below U1
    
            // Check if any equipment overlaps with the requested range
            foreach (var equipmentObj in rackData)
            {
                // Extract properties safely from JsonElement or dynamic object
                int equipStartPos = GetIntProperty(equipmentObj, "startPosition");
                string equipName = GetStringProperty(equipmentObj, "equipment");
                
                // Skip the original equipment we're editing
                if (originalStartPosition > 0 && equipStartPos == originalStartPosition && 
                    !string.IsNullOrEmpty(originalEquipment) && 
                    string.Equals(equipName, originalEquipment, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                
                int equipSize = GetIntProperty(equipmentObj, "size_units");
                int equipEndPos = equipStartPos - equipSize + 1;

                // Check for overlap
                bool overlaps = !(endPosition > equipStartPos || startPosition < equipEndPos || equipEndPos < 0 || startPosition < 1 || startPosition > 42 || endPosition < 1);
                if (overlaps)
                {
                    return false; // Found an overlap
                }
            }

            return true; // No overlaps found
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
    }

    // מחלקה לייצוג חיבור ציוד
    public class EquipmentConnection
    {
        public int Port { get; set; }
        public string Type { get; set; }
        public string ConnectedTo { get; set; }
        public string Description { get; set; }
    }

    public class EquipmentItem
    {
        public int StartPosition { get; set; }
        public int SizeUnits { get; set; }
        public string Equipment { get; set; }
        public string Type { get; set; }
    }
}