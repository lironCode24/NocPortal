using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Text;
using System.Runtime.InteropServices;
using System.Drawing;

public class ShiftsController : Controller
{
    private readonly string SHIFTS_FILE_PATH;
    private readonly string BACKUP_DIRECTORY;
    private readonly string EXCEL_FILE_PATH;
    private readonly string FUTURE_SHIFTS_FILE_PATH;

    public ShiftsController(IWebHostEnvironment env)
    {
        SHIFTS_FILE_PATH = Path.Combine(env.WebRootPath, "assets", "files", "shifts.csv");
        BACKUP_DIRECTORY = Path.Combine(env.WebRootPath, "assets", "files", "shifts_backup");
        EXCEL_FILE_PATH = Path.Combine(env.WebRootPath, "assets", "files", "משמרות.xlsx");
        FUTURE_SHIFTS_FILE_PATH = Path.Combine(env.WebRootPath, "assets", "files", "future_shifts.csv");
    }
    
    [HttpGet]
    public IActionResult GetShifts()
    {
        try
        {
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                var shifts = ReadShiftsFromCsv(SHIFTS_FILE_PATH);
                return Json(shifts);
            }

            return Json(GetDefaultShifts());
        }
        catch (Exception)
        {
            return Json(GetDefaultShifts());
        }
    }

    [HttpGet]
    public IActionResult GetShiftsTable()
    {
        try
        {
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
                return Json(tableData);
            }

            return Json(new { error = "File not found" });
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> UploadShiftsFile(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
            {
                return Json(new { success = false, message = "לא נבחר קובץ" });
            }

            // Validate file extension
            var extension = Path.GetExtension(file.FileName).ToLower();
            
            if (extension != ".csv")
            {
                return Json(new { success = false, message = "יש להעלות קובץ CSV בלבד" });
            }

            // Create backup directory if it doesn't exist
            if (!Directory.Exists(BACKUP_DIRECTORY))
            {
                Directory.CreateDirectory(BACKUP_DIRECTORY);
            }

            // Create backup of existing file
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                var backupFileName = GenerateBackupFileName(SHIFTS_FILE_PATH);
                var backupPath = Path.Combine(BACKUP_DIRECTORY, backupFileName);
                System.IO.File.Copy(SHIFTS_FILE_PATH, backupPath, true);
            }

            // Handle CSV files
            string csvContent;
            using (var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8))
            {
                csvContent = await reader.ReadToEndAsync();
            }

            // Save new file
            await System.IO.File.WriteAllTextAsync(SHIFTS_FILE_PATH, csvContent, Encoding.UTF8);

            await SaveCsvToExcel(csvContent);

            // Validate the uploaded file by trying to read it
            var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
            
            return Json(new { 
                success = true, 
                message = "הקובץ הועלה בהצלחה",
                data = tableData
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בהעלאת הקובץ: {ex.Message}" 
            });
        }
    }

    [HttpGet]
    public IActionResult GetBackupFiles()
    {
        try
        {
            if (!Directory.Exists(BACKUP_DIRECTORY))
            {
                return Json(new List<object>());
            }

            var backupFiles = Directory.GetFiles(BACKUP_DIRECTORY, "shifts_*.csv")
                .Select(f => new
                {
                    fileName = Path.GetFileName(f),
                    date = System.IO.File.GetLastWriteTime(f),
                    size = new FileInfo(f).Length
                })
                .OrderByDescending(f => f.date)
                .Take(10)
                .ToList();

            return Json(backupFiles);
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> ViewBackup([FromBody] string fileName)
    {
        try
        {
            var backupPath = Path.Combine(BACKUP_DIRECTORY, fileName);

            if (!System.IO.File.Exists(backupPath))
            {
                return Json(new { success = false, message = "קובץ המשמרות ההיסטורי לא נמצא" });
            }

            // Read backup file content
            var csvContent = await System.IO.File.ReadAllTextAsync(backupPath, Encoding.UTF8);
            
            // Parse the CSV content to table format
            var tableData = ParseCsvContentToTable(csvContent);
            
            return Json(new { 
                success = true, 
                message = "הקובץ נטען בהצלחה לצפייה",
                data = tableData,
                isPreview = true
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בטעינת הקובץ: {ex.Message}" 
            });
        }
    }

    // Helper method to parse CSV content to table format
    private object ParseCsvContentToTable(string csvContent)
    {
        var lines = csvContent.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        
        if (lines.Length < 2) 
            return new { headers = new List<string>(), dayHeaders = new List<string>(), rows = new List<object>() };

        // Parse headers (dates)
        var dateHeaders = lines[0].Split(',').Skip(1).ToList();
        var dayHeaders = lines[1].Split(',').Skip(1).ToList();

        var result = new
        {
            headers = dateHeaders,
            dayHeaders = dayHeaders,
            rows = ParseShiftRows(lines.Skip(2).ToArray(), dateHeaders.Count)
        };

        return result;
    }

    [HttpPost]
    public async Task<IActionResult> RestoreBackup([FromBody] string fileName)
    {
        try
        {
            var backupPath = Path.Combine(BACKUP_DIRECTORY, fileName);

            if (!System.IO.File.Exists(backupPath))
            {
                return Json(new { success = false, message = "קובץ המשמרות ההיסטורי לא נמצא" });
            }

            // Create backup of current file before restoring
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                var tempBackup = Path.Combine(BACKUP_DIRECTORY, $"shifts_temp_{DateTime.Now:yyyyMMdd_HHmmss}.csv");
                System.IO.File.Copy(SHIFTS_FILE_PATH, tempBackup, true);
            }

            // Restore backup
            System.IO.File.Copy(backupPath, SHIFTS_FILE_PATH, true);

            var csvContent = await System.IO.File.ReadAllTextAsync(SHIFTS_FILE_PATH, Encoding.UTF8);
            await SaveCsvToExcel(csvContent);

            var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
            
            return Json(new { 
                success = true, 
                message = "הקובץ שוחזר בהצלחה",
                data = tableData
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בשחזור הקובץ: {ex.Message}" 
            });
        }
    }

    [HttpPost]
    public IActionResult DeleteBackup([FromBody] string fileName)
    {
        try
        {
            var backupPath = Path.Combine(BACKUP_DIRECTORY, fileName);

            if (!System.IO.File.Exists(backupPath))
            {
                return Json(new { success = false, message = "קובץ המשמרות ההיסטורי לא נמצא" });
            }

            // Prevent deletion of non-backup files
            if (!fileName.StartsWith("shifts_") || !fileName.EndsWith(".csv"))
            {
                return Json(new { success = false, message = "ניתן למחוק רק קבצי משמרות היסטורים" });
            }

            System.IO.File.Delete(backupPath);
            
            return Json(new { 
                success = true, 
                message = "קובץ המשמרות ההיסטורי נמחק בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה במחיקת הקובץ: {ex.Message}" 
            });
        }
    }

    [HttpPost]
    public async Task<IActionResult> SaveShiftsTable([FromBody] SaveShiftsRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.CsvContent))
            {
                return Json(new { success = false, message = "תוכן הקובץ ריק" });
            }

            // Create backup directory if it doesn't exist
            if (!Directory.Exists(BACKUP_DIRECTORY))
            {
                Directory.CreateDirectory(BACKUP_DIRECTORY);
            }

            // Create backup of existing file
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                var backupFileName = GenerateBackupFileName(SHIFTS_FILE_PATH);
                var backupPath = Path.Combine(BACKUP_DIRECTORY, backupFileName);
                System.IO.File.Copy(SHIFTS_FILE_PATH, backupPath, true);
            }

            // Save new content with UTF-8 encoding
            await System.IO.File.WriteAllTextAsync(SHIFTS_FILE_PATH, request.CsvContent, Encoding.UTF8);            // Validate the saved file by trying to read it
            
            // Save to Excel as well
            await SaveCsvToExcel(request.CsvContent);

            var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
            
            return Json(new { 
                success = true, 
                message = "השינויים נשמרו בהצלחה",
                data = tableData
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בשמירת השינויים: {ex.Message}" 
            });
        }
    }

    [HttpGet]
    public IActionResult CheckExcelFileModified()
    {
        try
        {
            if (!System.IO.File.Exists(EXCEL_FILE_PATH) || !System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                return Json(new { hasChanges = false });
            }

            // Read current CSV content
            var currentCsvContent = System.IO.File.ReadAllText(SHIFTS_FILE_PATH, Encoding.UTF8);
            
            // Convert Excel to CSV
            string excelAsCsv = ConvertExcelToCsvSync(EXCEL_FILE_PATH);
            
            // Normalize both strings for comparison (remove extra whitespace, line endings)
            var normalizedCurrent = NormalizeContent(currentCsvContent);
            var normalizedExcel = NormalizeContent(excelAsCsv);
            
            // Compare content
            bool hasChanges = normalizedCurrent != normalizedExcel;

            return Json(new { 
                hasChanges = hasChanges
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error checking Excel changes: {ex.Message}");
            return Json(new { hasChanges = false, error = ex.Message });
        }
    }

    // Synchronous version of Excel to CSV conversion
    private string ConvertExcelToCsvSync(string excelPath)
    {
        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
        {
            try
            {
                var workbook = helper.OpenWorkbook(excelPath);
                var worksheet = helper.GetWorksheet(1);

                var usedRange = worksheet.UsedRange;
                int rowCount = usedRange.Rows.Count;
                int colCount = usedRange.Columns.Count;

                var csvLines = new List<string>();

                for (int i = 1; i <= rowCount; i++)
                {
                    var rowValues = new List<string>();
                    for (int j = 1; j <= colCount; j++)
                    {
                        var cell = worksheet.Cells[i, j];
                        var value = cell.Value?.ToString() ?? "";
                        
                        // Escape commas and quotes
                        if (value.Contains(",") || value.Contains("\"") || value.Contains("\n"))
                        {
                            value = $"\"{value.Replace("\"", "\"\"")}\"";
                        }
                        
                        rowValues.Add(value);
                    }
                    csvLines.Add(string.Join(",", rowValues));
                }
                
                return string.Join("\n", csvLines);
            }
            catch (Exception ex)
            {
                throw new Exception($"Error converting Excel to CSV: {ex.Message}", ex);
            }
        }
    }

    // הגרסה החדשה שמקבלת מערך בתים
    private string ConvertExcelToCsvSync(byte[] excelData)
    {
        string tempFilePath = null;

        try
        {
            // שמירת הנתונים לקובץ זמני
            tempFilePath = Path.GetTempFileName() + ".xlsx";
            System.IO.File.WriteAllBytes(tempFilePath, excelData);
            
            // המשך כמו בפונקציה המקורית
            return ConvertExcelToCsvSync(tempFilePath);
        }
        finally
        {
            // מחיקת הקובץ הזמני
            if (tempFilePath != null && System.IO.File.Exists(tempFilePath))
            {
                try { System.IO.File.Delete(tempFilePath); } catch { }
            }
        }
    }

    // פונקציה לניסיון פרסור תאריך במגוון פורמטים
    private bool TryParseDate(string dateStr, out DateTime result)
    {
        result = DateTime.MinValue;
        if (string.IsNullOrEmpty(dateStr))
            return false;
            
        // יצירת תרבות עברית לפרסור
        var hebrewCulture = new System.Globalization.CultureInfo("he-IL");
        var invariantCulture = System.Globalization.CultureInfo.InvariantCulture;
        
        // ניסיון פרסור בפורמטים שונים
        string[] formats = { 
            "dd.MM.yy", 
            "dd.MM.yyyy",
            "d.M.yy",
            "d.M.yyyy",
            "dd/MM/yy",
            "dd/MM/yyyy"
        };
        
        return DateTime.TryParseExact(dateStr, formats, 
                invariantCulture, 
                System.Globalization.DateTimeStyles.None, out result) ||
            DateTime.TryParseExact(dateStr, formats, 
                hebrewCulture, 
                System.Globalization.DateTimeStyles.None, out result) ||
            DateTime.TryParse(dateStr, hebrewCulture, 
                System.Globalization.DateTimeStyles.None, out result) ||
            DateTime.TryParse(dateStr, invariantCulture, 
                System.Globalization.DateTimeStyles.None, out result);
    }

    // Normalize content for comparison
    private string NormalizeContent(string content)
    {
        if (string.IsNullOrEmpty(content))
            return "";
        
        // Remove BOM and zero-width characters
        content = content.TrimStart('\uFEFF', '\u200B');
        
        // Normalize line endings to \n
        content = content.Replace("\r\n", "\n").Replace("\r", "\n");
        
        // Split into lines
        var lines = content.Split('\n')
            .Select(line => line.Trim())  // Trim each line
            .Where(line => !string.IsNullOrWhiteSpace(line))  // Remove empty lines
            .ToList();
        
        // Normalize each line (remove extra spaces between commas)
        var normalizedLines = lines.Select(line => 
        {
            var parts = line.Split(',')
                .Select(p => p.Trim().Trim('"'))  // Trim and remove quotes
                .ToArray();
            return string.Join(",", parts);
        });
        
        return string.Join("\n", normalizedLines);
    }

    [HttpPost]
    public async Task<IActionResult> LoadFromExcel()
    {
        try
        {
            if (!System.IO.File.Exists(EXCEL_FILE_PATH))
            {
                return Json(new { success = false, message = "קובץ Excel לא נמצא בתיקיית המשמרות" });
            }

            // Create backup of current CSV file
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                if (!Directory.Exists(BACKUP_DIRECTORY))
                {
                    Directory.CreateDirectory(BACKUP_DIRECTORY);
                }
                
                var backupFileName = GenerateBackupFileName(SHIFTS_FILE_PATH);
                var backupPath = Path.Combine(BACKUP_DIRECTORY, backupFileName);
                System.IO.File.Copy(SHIFTS_FILE_PATH, backupPath, true);
            }

            // Convert Excel to CSV
            string csvContent = await ConvertExcelToCsv(EXCEL_FILE_PATH);
            
            // Save to CSV file
            await System.IO.File.WriteAllTextAsync(SHIFTS_FILE_PATH, csvContent, Encoding.UTF8);

            // Read and return table data
            var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
            
            return Json(new { 
                success = true, 
                message = "המשמרות עודכנו בהצלחה מקובץ Excel",
                data = tableData
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בטעינת קובץ Excel: {ex.Message}" 
            });
        }
    }

    [HttpGet]
    public IActionResult GetFutureShifts()
    {
        try
        {
            // בדיקה אם קובץ המשמרות העתידי קיים
            if (!System.IO.File.Exists(FUTURE_SHIFTS_FILE_PATH))
            {
                return Json(new { success = false, message = "לא נמצאו משמרות עתידיות" });
            }

            // קריאת הקובץ העתידי
            var tableData = ReadCsvAsTable(FUTURE_SHIFTS_FILE_PATH);
            
            return Json(new { 
                success = true, 
                data = tableData
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> UploadFutureShiftsFile(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
            {
                return Json(new { success = false, message = "לא נבחר קובץ" });
            }

            // בדיקת סיומת הקובץ
            var extension = Path.GetExtension(file.FileName).ToLower();
            
            if (extension != ".csv" && extension != ".xlsx" && extension != ".xls")
            {
                return Json(new { success = false, message = "יש להעלות קובץ CSV או Excel בלבד" });
            }

            // קריאת תוכן הקובץ
            string csvContent;
            
            if (extension == ".xlsx" || extension == ".xls")
            {
                // המרת Excel ל-CSV
                using (var stream = new MemoryStream())
                {
                    await file.CopyToAsync(stream);
                    stream.Position = 0;
                    csvContent = ConvertExcelToCsvSync(stream.ToArray());
                }
            }
            else
            {
                // קריאת CSV ישירות
                using (var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8))
                {
                    csvContent = await reader.ReadToEndAsync();
                }
            }

            // בדיקה אם התאריך הראשון בקובץ הוא בשבוע הנוכחי או עתידי
            bool isCurrentWeek = IsFirstDateInCurrentWeek(csvContent);
            
            if (isCurrentWeek)
            {
                // אם זה השבוע הנוכחי, שמור כקובץ משמרות רגיל
                
                // יצירת גיבוי לקובץ הנוכחי אם קיים
                if (System.IO.File.Exists(SHIFTS_FILE_PATH))
                {
                    if (!Directory.Exists(BACKUP_DIRECTORY))
                    {
                        Directory.CreateDirectory(BACKUP_DIRECTORY);
                    }
                    
                    var backupFileName = GenerateBackupFileName(SHIFTS_FILE_PATH);
                    var backupPath = Path.Combine(BACKUP_DIRECTORY, backupFileName);
                    System.IO.File.Copy(SHIFTS_FILE_PATH, backupPath, true);
                }
                
                // שמירת הקובץ החדש
                await System.IO.File.WriteAllTextAsync(SHIFTS_FILE_PATH, csvContent, Encoding.UTF8);
                
                // עדכון קובץ האקסל
                await SaveCsvToExcel(csvContent);
                
                var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
                
                return Json(new { 
                    success = true, 
                    message = "הקובץ הועלה בהצלחה ללוח המשמרות הנוכחי",
                    data = tableData,
                    isCurrent = true
                });
            }
            else
            {
                // אם זה שבוע עתידי, שמור כקובץ משמרות עתידי
                
                // יצירת גיבוי לקובץ העתידי אם קיים
                if (System.IO.File.Exists(FUTURE_SHIFTS_FILE_PATH))
                {
                    if (!Directory.Exists(BACKUP_DIRECTORY))
                    {
                        Directory.CreateDirectory(BACKUP_DIRECTORY);
                    }
                    
                    var backupFileName = "future_" + GenerateBackupFileName(FUTURE_SHIFTS_FILE_PATH);
                    var backupPath = Path.Combine(BACKUP_DIRECTORY, backupFileName);
                    System.IO.File.Copy(FUTURE_SHIFTS_FILE_PATH, backupPath, true);
                }
                
                // שמירת הקובץ העתידי
                await System.IO.File.WriteAllTextAsync(FUTURE_SHIFTS_FILE_PATH, csvContent, Encoding.UTF8);
                
                var tableData = ReadCsvAsTable(FUTURE_SHIFTS_FILE_PATH);
                
                return Json(new { 
                    success = true, 
                    message = "הקובץ הועלה בהצלחה ללוח המשמרות העתידי",
                    data = tableData,
                    isCurrent = false
                });
            }
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בהעלאת הקובץ: {ex.Message}" 
            });
        }
    }

    // בדיקה אם התאריך הראשון בקובץ הוא בשבוע הנוכחי
    private bool IsFirstDateInCurrentWeek(string csvContent)
    {
        try
        {
            var lines = csvContent.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            
            if (lines.Length == 0)
                return false;
                
            var headers = ParseCsvLine(lines[0]);
            
            if (headers.Length < 2)
                return false;
                
            var firstDateStr = headers[1].Trim();
            
            if (TryParseDate(firstDateStr, out DateTime firstDate))
            {
                // קביעת תחילת השבוע הנוכחי (שבת)
                DateTime currentWeekStart = GetCurrentWeekStart();
                
                // קביעת סוף השבוע הנוכחי (שישי)
                DateTime currentWeekEnd = currentWeekStart.AddDays(6);
                
                // בדיקה אם התאריך בטווח השבוע הנוכחי
                return firstDate >= currentWeekStart && firstDate <= currentWeekEnd;
            }
            
            return false;
        }
        catch
        {
            return false;
        }
    }

    // קבלת תאריך תחילת השבוע הנוכחי (שבת)
    private DateTime GetCurrentWeekStart()
    {
        DateTime today = DateTime.Today;
        
        // בישראל השבוע מתחיל בשבת (יום 6) ומסתיים בשישי (יום 5)
        int daysUntilSaturday = ((int)today.DayOfWeek + 1) % 7;
        
        // חישוב תאריך השבת האחרונה
        return today.AddDays(-daysUntilSaturday);
    }

    // בדיקה אם יש משמרות עתידיות
    [HttpGet]
    public IActionResult CheckFutureShiftsExist()
    {
        try
        {
            bool exists = System.IO.File.Exists(FUTURE_SHIFTS_FILE_PATH);
            
            if (!exists)
            {
                return Json(new { exists = false });
            }
            
            // בדיקה אם הקובץ העתידי צריך לעבור ללוח הנוכחי
            bool shouldMigrate = ShouldMigrateFutureShifts();
            
            return Json(new { 
                exists = true,
                shouldMigrate = shouldMigrate
            });
        }
        catch (Exception ex)
        {
            return Json(new { exists = false, error = ex.Message });
        }
    }

    // בדיקה אם צריך להעביר את המשמרות העתידיות ללוח הנוכחי
    private bool ShouldMigrateFutureShifts()
    {
        try
        {
            if (!System.IO.File.Exists(FUTURE_SHIFTS_FILE_PATH))
                return false;
                
            string content = System.IO.File.ReadAllText(FUTURE_SHIFTS_FILE_PATH, Encoding.UTF8);
            return IsFirstDateInCurrentWeek(content);
        }
        catch
        {
            return false;
        }
    }

    // העברת משמרות עתידיות ללוח הנוכחי
    [HttpPost]
    public async Task<IActionResult> MigrateFutureShifts()
    {
        try
        {
            if (!System.IO.File.Exists(FUTURE_SHIFTS_FILE_PATH))
            {
                return Json(new { success = false, message = "לא נמצא קובץ משמרות עתידי" });
            }
            
            // בדיקה אם הקובץ העתידי אכן צריך לעבור ללוח הנוכחי
            if (!ShouldMigrateFutureShifts())
            {
                return Json(new { success = false, message = "קובץ המשמרות העתידי אינו מתאים לשבוע הנוכחי" });
            }
            
            // יצירת גיבוי לקובץ הנוכחי אם קיים
            if (System.IO.File.Exists(SHIFTS_FILE_PATH))
            {
                if (!Directory.Exists(BACKUP_DIRECTORY))
                {
                    Directory.CreateDirectory(BACKUP_DIRECTORY);
                }
                
                var backupFileName = GenerateBackupFileName(SHIFTS_FILE_PATH);
                var backupPath = Path.Combine(BACKUP_DIRECTORY, backupFileName);
                
                // שימוש ב-FileStream עם using כדי להבטיח שחרור משאבים
                using (var sourceStream = new FileStream(SHIFTS_FILE_PATH, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var destStream = new FileStream(backupPath, FileMode.Create, FileAccess.Write))
                {
                    await sourceStream.CopyToAsync(destStream);
                }
            }
            
            // קריאת תוכן הקובץ העתידי
            string futureContent;
            using (var reader = new StreamReader(FUTURE_SHIFTS_FILE_PATH, Encoding.UTF8))
            {
                futureContent = await reader.ReadToEndAsync();
            }
            
            // כתיבה לקובץ הנוכחי
            using (var writer = new StreamWriter(SHIFTS_FILE_PATH, false, Encoding.UTF8))
            {
                await writer.WriteAsync(futureContent);
            }
            
            // עדכון קובץ האקסל
            await SaveCsvToExcel(futureContent);
            
            // המתנה קצרה לפני מחיקת הקובץ העתידי
            await Task.Delay(500);
            
            // מחיקת הקובץ העתידי
            if (System.IO.File.Exists(FUTURE_SHIFTS_FILE_PATH))
            {
                System.IO.File.Delete(FUTURE_SHIFTS_FILE_PATH);
            }
            
            var tableData = ReadCsvAsTable(SHIFTS_FILE_PATH);
            
            return Json(new { 
                success = true, 
                message = "המשמרות העתידיות הועברו בהצלחה ללוח הנוכחי",
                data = tableData
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                message = $"שגיאה בהעברת המשמרות העתידיות: {ex.Message}" 
            });
        }
    }

    // Convert Excel file to CSV
    private async Task<string> ConvertExcelToCsv(string excelPath)
    {
        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
        {
            try
            {
                var workbook = helper.OpenWorkbook(excelPath);
                var worksheet = helper.GetWorksheet(1);

                var usedRange = worksheet.UsedRange;
                int rowCount = usedRange.Rows.Count;
                int colCount = usedRange.Columns.Count;

                var csvLines = new List<string>();

                for (int i = 1; i <= rowCount; i++)
                {
                    var rowValues = new List<string>();
                    for (int j = 1; j <= colCount; j++)
                    {
                        var cell = worksheet.Cells[i, j];
                        var value = cell.Value?.ToString() ?? "";
                        
                        // Escape commas and quotes
                        if (value.Contains(",") || value.Contains("\"") || value.Contains("\n"))
                        {
                            value = $"\"{value.Replace("\"", "\"\"")}\"";
                        }
                        
                        rowValues.Add(value);
                    }
                    csvLines.Add(string.Join(",", rowValues));
                }
                
                return string.Join("\n", csvLines);
            }
            catch (Exception ex)
            {
                throw new Exception($"Error converting Excel to CSV: {ex.Message}", ex);
            }
        }
    }

    private object ReadCsvAsTable(string filePath)
    {
        var lines = System.IO.File.ReadAllLines(filePath, Encoding.UTF8);
        var tableData = new
        {
            headers = new List<string>(),
            dayHeaders = new List<string>(),
            rows = new List<object>()
        };

        if (lines.Length < 2) return tableData;

        // Parse headers (dates)
        var dateHeaders = lines[0].Split(',').Skip(1).ToList();
        var dayHeaders = lines[1].Split(',').Skip(1).ToList();

        var result = new
        {
            headers = dateHeaders,
            dayHeaders = dayHeaders,
            rows = ParseShiftRows(lines.Skip(2).ToArray(), dateHeaders.Count)
        };

        return result;
    }

    private List<object> ParseShiftRows(string[] lines, int columnCount)
    {
        var rows = new List<object>();
        var currentShift = "";
        var shiftRows = new List<List<string>>();

        foreach (var line in lines)
        {
            var columns = line.Split(',');
            var shiftName = columns[0]?.Trim();

            // If this is a shift name row
            if (!string.IsNullOrEmpty(shiftName) && IsShiftName(shiftName))
            {
                // Save previous shift if exists
                if (!string.IsNullOrEmpty(currentShift) && shiftRows.Count > 0)
                {
                    rows.Add(new
                    {
                        shiftName = currentShift,
                        rows = shiftRows.ToList(),
                        icon = GetShiftIcon(currentShift),
                        color = GetShiftColor(currentShift)
                    });
                }

                // Start new shift
                currentShift = shiftName;
                shiftRows = new List<List<string>>();
            }

            // Add row data
            var rowData = new List<string>();
            for (int i = 0; i <= columnCount; i++)
            {
                rowData.Add(i < columns.Length ? columns[i]?.Trim() : "");
            }
            shiftRows.Add(rowData);
        }

        // Add last shift
        if (!string.IsNullOrEmpty(currentShift) && shiftRows.Count > 0)
        {
            rows.Add(new
            {
                shiftName = currentShift,
                rows = shiftRows.ToList(),
                icon = GetShiftIcon(currentShift),
                color = GetShiftColor(currentShift)
            });
        }

        return rows;
    }

    private string GetShiftColor(string shiftName)
    {
        switch (shiftName)
        {
            case "בוקר": return "#FFE082"; // Light yellow
            case "צהריים": return "#81C784"; // Light green  
            case "לילה": return "#9FA8DA"; // Light purple
            case "חופשה": return "#FFAB91"; // Light orange
            default: return "#E0E0E0"; // Light gray
        }
    }

    private List<object> ReadShiftsFromCsv(string filePath)
    {
        try
        {
            var lines = System.IO.File.ReadAllLines(filePath, Encoding.UTF8);
            if (lines.Length < 2) return GetDefaultShifts();

            var headers = lines[0].Split(',');
            var todayColumn = GetTodayColumnIndex(headers);
            
            if (todayColumn == -1) return GetDefaultShifts();

            var shifts = new List<object>();
            
            for (int i = 2; i < lines.Length; i++) // Start from row 2 (skip date and day headers)
            {
                var columns = lines[i].Split(',');
                var shiftName = columns[0]?.Trim();
                
                if (!string.IsNullOrEmpty(shiftName) && IsShiftName(shiftName))
                {
                    var employees = new List<string>();
                    
                    // Get employees for this shift
                    for (int j = i; j < lines.Length && j < i + 4; j++)
                    {
                        var rowColumns = lines[j].Split(',');
                        if (todayColumn < rowColumns.Length)
                        {
                            var employee = rowColumns[todayColumn]?.Trim();
                            if (!string.IsNullOrEmpty(employee))
                            {
                                employees.Add(employee);
                            }
                        }
                        
                        if (j > i && rowColumns.Length > 0)
                        {
                            var nextShift = rowColumns[0]?.Trim();
                            if (!string.IsNullOrEmpty(nextShift) && IsShiftName(nextShift))
                            {
                                break;
                            }
                        }
                    }

                    var shiftTimes = GetShiftTime(shiftName);
                    
                    shifts.Add(new
                    {
                        name = shiftName,
                        employees = employees.Count > 0 ? employees : new List<string> { "לא משובץ" },
                        startTime = shiftTimes.Item1,
                        endTime = shiftTimes.Item2,
                        icon = GetShiftIcon(shiftName)
                    });
                }
            }
            
            return shifts.Count > 0 ? shifts : GetDefaultShifts();
        }
        catch (Exception)
        {
            return GetDefaultShifts();
        }
    }

    private int GetTodayColumnIndex(string[] headers)
    {
        var today = DateTime.Now;
        
        for (int i = 1; i < headers.Length; i++)
        {
            var header = headers[i]?.Trim();
            
            if (DateTime.TryParse(header, out DateTime headerDate))
            {
                if (headerDate.Date == today.Date)
                {
                    return i;
                }
            }
        }
        
        return headers.Length > 1 ? 1 : -1;
    }

    private bool IsShiftName(string name)
    {
        var shiftNames = new[] { "בוקר", "צהריים", "לילה", "חופשה" };
        return shiftNames.Contains(name);
    }

    private Tuple<string, string> GetShiftTime(string shiftName)
    {
        switch (shiftName)
        {
            case "בוקר": return new Tuple<string, string>("07:00", "15:00");
            case "צהריים": return new Tuple<string, string>("15:00", "23:00");
            case "לילה": return new Tuple<string, string>("23:00", "07:00");
            case "חופשה": return new Tuple<string, string>("", "");
            default: return new Tuple<string, string>("00:00", "00:00");
        }
    }

    private string GetShiftIcon(string shiftName)
    {
        switch (shiftName)
        {
            case "בוקר": return "fas fa-sun";
            case "צהריים": return "fas fa-cloud-sun";
            case "לילה": return "fas fa-moon";
            case "חופשה": return "fas fa-umbrella-beach";
            default: return "fas fa-clock";
        }
    }

    // Save CSV content to Shifts Excel file when edit
    private async Task SaveCsvToExcel(string csvContent)
    {
        try
        {
            var excelDirectory = Path.GetDirectoryName(EXCEL_FILE_PATH);
            if (!Directory.Exists(excelDirectory))
            {
                Directory.CreateDirectory(excelDirectory);
            }

            // Create Excel application using late binding (no reference needed)
            Type excelType = Type.GetTypeFromProgID("Excel.Application");
            if (excelType == null)
            {
                // Excel not installed - fallback to CSV with xlsx extension
                await System.IO.File.WriteAllTextAsync(EXCEL_FILE_PATH, csvContent, Encoding.UTF8);
                return;
            }

            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
            {
                // Create new workbook
                var workbook = helper.CreateNewWorkbook();
                var worksheet = workbook.Worksheets[1];
                worksheet.Name = "משמרות";

                // Parse and write CSV data
                var lines = csvContent.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                
                // Track current shift for coloring
                string currentShift = "";
                
                for (int i = 0; i < lines.Length; i++)
                {
                    var columns = ParseCsvLine(lines[i]);
                    
                    // Check if this is a shift name row
                    if (columns.Length > 0 && IsShiftName(columns[0]))
                    {
                        currentShift = columns[0];
                    }
                    
                    for (int j = 0; j < columns.Length; j++)
                    {
                        var cell = worksheet.Cells[i + 1, j + 1];
                        cell.Value = columns[j];
                        
                        // Apply formatting
                        ApplyExcelCellFormatting(cell, i, j, columns[j], currentShift, lines.Length);
                    }
                }

                // Auto-fit columns
                worksheet.Columns.AutoFit();
                
                // Set right-to-left
                worksheet.DisplayRightToLeft = true;

                // Delete existing file if exists
                if (System.IO.File.Exists(EXCEL_FILE_PATH))
                {
                    System.IO.File.Delete(EXCEL_FILE_PATH);
                }

                // Save as Excel file (51 = xlOpenXMLWorkbook = .xlsx)
                workbook.SaveAs(EXCEL_FILE_PATH, 51);
            }

            await Task.CompletedTask;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error saving to Excel: {ex.Message}");
            // Fallback - save as CSV
            await System.IO.File.WriteAllTextAsync(EXCEL_FILE_PATH, csvContent, Encoding.UTF8);
        }
    }

    // Apply Excel cell formatting with colors
    private void ApplyExcelCellFormatting(dynamic cell, int rowIndex, int colIndex, string value, string currentShift, int totalLines)
    {
        try
        {
            // Header rows (first 2 rows)
            if (rowIndex < 2)
            {
                cell.Interior.Color = ColorTranslator.ToOle(Color.FromArgb(189, 189, 189)); // Purple gradient
                cell.Font.Color = ColorTranslator.ToOle(Color.White);
                cell.Font.Bold = true;
                cell.HorizontalAlignment = -4108; // xlCenter
                return;
            }

            // Shift name column (first column)
            if (colIndex == 0 && !string.IsNullOrEmpty(value))
            {
                cell.Interior.Color = ColorTranslator.ToOle(Color.FromArgb(240, 241, 246)); // Light gray
                cell.Font.Color = ColorTranslator.ToOle(Color.FromArgb(50, 15, 91)); // Dark purple
                cell.Font.Bold = true;
                cell.HorizontalAlignment = -4108; // xlCenter
                return;
            }

            // Data cells - apply shift colors
            if (colIndex > 0 && !string.IsNullOrEmpty(currentShift))
            {
                Color shiftColor = GetShiftColorForExcel(currentShift);
                cell.Interior.Color = ColorTranslator.ToOle(shiftColor);
                
                // Employee colors (if applicable)
                if (!string.IsNullOrEmpty(value) && value.Trim() != "")
                {
                    Color? employeeColor = GetEmployeeColorForExcel(value.Trim());
                    if (employeeColor.HasValue)
                    {
                        cell.Interior.Color = ColorTranslator.ToOle(employeeColor.Value);
                        cell.Font.Color = ColorTranslator.ToOle(Color.White);
                        cell.Font.Bold = true;
                    }
                }
                
                cell.HorizontalAlignment = -4108; // xlCenter
            }

            // Add borders
            cell.Borders.LineStyle = 1; // xlContinuous
            cell.Borders.Color = ColorTranslator.ToOle(Color.FromArgb(218, 217, 235));
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error formatting cell: {ex.Message}");
        }
    }

    // Get shift color for Excel
    private Color GetShiftColorForExcel(string shiftName)
    {
        switch (shiftName)
        {
            case "בוקר": 
                return Color.FromArgb(228, 204, 23); // Yellow
            case "צהריים": 
                return Color.FromArgb(163, 209, 227); // Light blue
            case "לילה": 
                return Color.FromArgb(44, 62, 80); // Dark gray-blue
            case "חופשה": 
                return Color.FromArgb(255, 183, 77); // Orange
            default: 
                return Color.White;
        }
    }

    // Get employee color for Excel
    private Color? GetEmployeeColorForExcel(string employeeName)
    {
        var employeeColors = new Dictionary<string, Color>
        {
            { "אריה", Color.FromArgb(75, 171, 70) },      // Green
            { "דני", Color.FromArgb(135, 206, 235) },     // Sky blue
            { "גלית", Color.FromArgb(255, 107, 107) },    // Red
            { "אבי", Color.FromArgb(221, 160, 221) },     // Plum
            { "רונן", Color.FromArgb(0, 206, 209) },      // Turquoise
            { "יוני", Color.FromArgb(154, 140, 140) },    // Gray
            { "יבגני", Color.FromArgb(230, 213, 88) },    // Yellow
            { "טל", Color.FromArgb(255, 182, 193) }       // Pink
        };

        if (employeeColors.ContainsKey(employeeName))
        {
            return employeeColors[employeeName];
        }

        return null;
    }

    // Parse CSV line handling quotes and commas
    private string[] ParseCsvLine(string line)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];

            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes)
            {
                result.Add(current.ToString().Trim().Trim('"'));
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        result.Add(current.ToString().Trim().Trim('"'));
        return result.ToArray();
    }

    private string GenerateBackupFileName(string filePath)
    {
        try
        {
            var content = System.IO.File.ReadAllText(filePath, Encoding.UTF8);
            var lines = content.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            
            if (lines.Length > 0)
            {
                var firstLine = lines[0].TrimStart('\uFEFF', '\u200B');
                var headers = firstLine.Split(',');
                
                if (headers.Length > 1)
                {
                    var firstDateStr = headers[1].Trim();
                    
                    DateTime firstDate;
                    
                    // Create culture info for parsing
                    var hebrewCulture = new System.Globalization.CultureInfo("he-IL");
                    var invariantCulture = System.Globalization.CultureInfo.InvariantCulture;
                    
                    // Try multiple date formats
                    string[] formats = { 
                        "dd.MM.yy", 
                        "dd.MM.yyyy",
                        "d.M.yy",
                        "d.M.yyyy",
                        "dd/MM/yy",
                        "dd/MM/yyyy"
                    };
                    
                    // Try parsing with different cultures and formats
                    if (DateTime.TryParseExact(firstDateStr, formats, 
                        invariantCulture, 
                        System.Globalization.DateTimeStyles.None, out firstDate))
                    {
                        return $"shifts_{firstDate:dd-MM-yyyy}_createdAt_{DateTime.Now:dd-MM_HHmm}.csv";
                    }
                    
                    if (DateTime.TryParseExact(firstDateStr, formats, 
                        hebrewCulture, 
                        System.Globalization.DateTimeStyles.None, out firstDate))
                    {
                        return $"shifts_{firstDate:dd-MM-yyyy}_createdAt_{DateTime.Now:dd-MM_HHmm}.csv";
                    }
                    
                    // Try standard parsing
                    if (DateTime.TryParse(firstDateStr, hebrewCulture, 
                        System.Globalization.DateTimeStyles.None, out firstDate))
                    {
                        return $"shifts_{firstDate:dd-MM-yyyy}_createdAt_{DateTime.Now:dd-MM_HHmm}.csv";
                    }
                    
                    if (DateTime.TryParse(firstDateStr, invariantCulture, 
                        System.Globalization.DateTimeStyles.None, out firstDate))
                    {
                        return $"shifts_{firstDate:dd-MM-yyyy}_createdAt_{DateTime.Now:dd-MM_HHmm}.csv";
                    }
                    
                    Console.WriteLine($"Failed to parse date: '{firstDateStr}'");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error generating backup filename: {ex.Message}");
        }
        
        // Fallback to original format if parsing fails
        return $"shifts_backup_{DateTime.Now:yyyyMMdd_HHmmss}.csv";
    }

    private List<object> GetDefaultShifts()
    {
        return new List<object>
        {
            new { name = "בוקר", employees = new[] { "לא זמין" }, startTime = "07:00", endTime = "15:00", icon = "fas fa-sun" },
            new { name = "צהריים", employees = new[] { "לא זמין" }, startTime = "15:00", endTime = "23:00", icon = "fas fa-cloud-sun" },
            new { name = "לילה", employees = new[] { "לא זמין" }, startTime = "23:00", endTime = "07:00", icon = "fas fa-moon" },
            new { name = "סוף שבוע", employees = new[] { "לא זמין" }, startTime = "09:00", endTime = "17:00", icon = "fas fa-calendar-weekend" },
            new { name = "חירום", employees = new[] { "תורן" }, startTime = "24/7", endTime = "", icon = "fas fa-exclamation-triangle" },
            new { name = "תמיכה", employees = new[] { "זמין" }, startTime = "לפי צורך", endTime = "", icon = "fas fa-headset" }
        };
    }

    // Request model
    public class SaveShiftsRequest
    {
        public string CsvContent { get; set; }
    }
}