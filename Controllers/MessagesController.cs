using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Web;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using NocPortal.Services;

public class MessagesController : Controller
{
    private readonly string _baseFilesPath;
    private readonly string _messagesFilePath;
    private readonly string _uploadsPath;
    private readonly string _emailCachePath;
    private readonly string _dailyReportsPath = @"R:\USERS\TASHTIT\NOC\Control-M Files\DAILY_REPORTS";
    private readonly string _jobsContactsPath = @"R:\USERS\TASHTIT\NOC\Control-M Files\JOBS_CONTACTS";
    private readonly string _permanentAccessListPath;

    // הוסף שדה חדש לשמירת נתיב קובץ מיפוי מיילים
    private readonly string _emailMappingFilePath;
    
    private static DateTime _lastCacheCleanupTime = DateTime.MinValue;
    private static DateTime _lastFullCacheCleanupTime = DateTime.MinValue;
    private static readonly TimeSpan _fullCacheCleanupInterval = TimeSpan.FromDays(2); // אחת ליומיים
    private static readonly TimeSpan _cacheFileMaxAge = TimeSpan.FromDays(7); // שמירת קבצים עד 7 ימים

    // ===== שדות לטיימר יומי =====
    private static System.Threading.Timer _dailyPermitEmailTimer = null;
    private static bool _dailyEmailTimerInitialized = false;
    private static readonly object _timerLock = new object();

    private HashSet<int> _dateStyleIndices = null;
    private static AuditLogService _auditLog;

    public MessagesController(AuditLogService auditLog, IWebHostEnvironment env)
    {
        _auditLog = auditLog;
        _baseFilesPath = Path.Combine(env.WebRootPath, "assets", "files");
        _messagesFilePath = Path.Combine(_baseFilesPath, "messages.txt");
        _uploadsPath = Path.Combine(_baseFilesPath, "messagesUploads");
        _emailCachePath = Path.Combine(_baseFilesPath, "emailCache");
        _permanentAccessListPath = Path.Combine(_baseFilesPath, "permanent_access_list.json");
        _emailMappingFilePath = Path.Combine(_baseFilesPath, "email_mapping.csv");
        // הפעל טיימר יומי בפעם הראשונה שהקונטרולר נוצר
        EnsureDailyPermitEmailTimerStarted();
    }

    [HttpGet]
    public IActionResult GetMessages()
    {
        try
        {
            if (!System.IO.File.Exists(_messagesFilePath))
            {
                return Json(new List<object>());
            }

            var messages = ReadMessagesFromFile();
            // Return messages in the order they appear in the file
            return Json(messages);
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> ConvertExcelToCsv(IFormFile file, string messageId)
    {
        string tempExcelPath = null;
        string csvPath = null;

        try
        {
            if (file == null || file.Length == 0)
                return Json(new { success = false, error = "לא נבחר קובץ" });

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension != ".xlsx" && extension != ".xls")
                return Json(new { success = false, error = "יש להעלות קובץ Excel בלבד (.xlsx או .xls)" });

            // שמירת הקובץ זמנית
            tempExcelPath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString() + extension);
            using (var stream = new FileStream(tempExcelPath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            // יצירת נתיב לקובץ CSV
            var uploadsDir = Path.Combine(_uploadsPath, messageId);
            Directory.CreateDirectory(uploadsDir);

            var csvFileName = Path.GetFileNameWithoutExtension(file.FileName) + ".csv";
            csvPath = Path.Combine(uploadsDir, csvFileName);

            // שימוש במחלקת העזר להמרה
            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
            {
                var workbook = helper.OpenWorkbook(tempExcelPath);
                var worksheet = helper.GetWorksheet(1);

                // המרה ל-CSV
                var csvLines = new List<string>();
                var usedRange = worksheet.UsedRange;
                int rowCount = usedRange.Rows.Count;
                int colCount = usedRange.Columns.Count;

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

                // שמירה כ-CSV עם UTF-8
                await System.IO.File.WriteAllLinesAsync(csvPath, csvLines, Encoding.UTF8);
            }

            // קריאת הנתונים מה-CSV שנוצר
            var parseResult = await ParseCsvFile(csvPath);

            if (!parseResult.success)
            {
                return Json(new { success = false, error = "שגיאה בקריאת הנתונים מהקובץ" });
            }

            // החזרת נתיב יחסי
            var relativePath = Path.Combine(_uploadsPath, messageId, csvFileName);

            return Json(new 
            { 
                success = true, 
                filePath = relativePath,
                data = parseResult.data
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
            return Json(new { success = false, error = "שגיאה בקריאת הנתונים מהקובץ. נסה להעלות קובץ זה כCSV" });
        }
        finally
        {
            // מחיקת קובץ זמני
            if (tempExcelPath != null && System.IO.File.Exists(tempExcelPath))
            {
                try { System.IO.File.Delete(tempExcelPath); } catch { }
            }
        }
    }

    // פונקציה עזר פרטית
    private async Task<dynamic> ParseCsvFile(string filePath)
    {
        try
        {
            var lines = await System.IO.File.ReadAllLinesAsync(filePath, System.Text.Encoding.UTF8);
            var data = new List<List<string>>();

            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line))
                    continue;

                char delimiter = line.Contains('\t') ? '\t' : ',';
                
                // שימוש ב-TextFieldParser לטיפול נכון בשדות מוקפים במרכאות
                var values = new List<string>();
                bool inQuotes = false;
                StringBuilder field = new StringBuilder();
                
                for (int i = 0; i < line.Length; i++)
                {
                    char c = line[i];
                    
                    if (c == '"')
                    {
                        // בדיקה אם זה מרכאה כפולה בתוך שדה מוקף במרכאות
                        if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                        {
                            field.Append('"');
                            i++; // דלג על המרכאה השנייה
                        }
                        else
                        {
                            inQuotes = !inQuotes;
                        }
                    }
                    else if (c == delimiter && !inQuotes)
                    {
                        // סיום שדה
                        values.Add(field.ToString());
                        field.Clear();
                    }
                    else
                    {
                        field.Append(c);
                    }
                }
                
                // הוסף את השדה האחרון
                values.Add(field.ToString());
                
                data.Add(values);
            }

            return new { success = true, data = data };
        }
        catch (Exception ex)
        {
            return new { success = false, error = ex.Message };
        }
    }

    [HttpPost]
    public IActionResult UploadFile(IFormFile file, string messageId)
    {
        try
        {
            if (file == null || file.Length == 0)
                return Json(new { success = false, error = "לא נבחר קובץ" });

            var uploadsDir = Path.Combine(_uploadsPath, messageId);
            Directory.CreateDirectory(uploadsDir);

            // נקה את שם הקובץ מתווים אסורים
            var fileName = SanitizeFileName(Path.GetFileName(file.FileName));
            var fullPath = Path.Combine(uploadsDir, fileName);

            using (var stream = new FileStream(fullPath, FileMode.Create))
            {
                file.CopyTo(stream);
            }

            // שמור נתיב יחסי במקום מוחלט
            var relativePath = Path.Combine(_uploadsPath, messageId, fileName);

            return Json(new { success = true, filePath = relativePath });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // פונקציה חדשה לניקוי שם קובץ מתווים אסורים
    private string SanitizeFileName(string fileName)
    {
        if (string.IsNullOrEmpty(fileName))
            return "file";

        // החלף תווים אסורים בקו תחתון
        char[] invalidChars = Path.GetInvalidFileNameChars();
        string sanitized = fileName;
        
        // החלף תווים אסורים של מערכת הקבצים
        foreach (char c in invalidChars)
        {
            sanitized = sanitized.Replace(c, '_');
        }
        
        // החלף תווים נוספים שעלולים לגרום לבעיות בפרסור JSON
        string additionalInvalidChars = "'\"";
        foreach (char c in additionalInvalidChars)
        {
            sanitized = sanitized.Replace(c, '_');
        }
        
        // וודא שהשם לא ארוך מדי
        if (sanitized.Length > 200)
        {
            string extension = Path.GetExtension(sanitized);
            sanitized = sanitized.Substring(0, 196) + extension;
        }
        
        return sanitized;
    }

    [HttpGet]
    public IActionResult ConvertMultipleEmailsToHtml(string filePaths)
    {
        try
        {
            if (string.IsNullOrEmpty(filePaths))
            {
                return Json(new { success = false, error = "נתיבי קבצים חסרים" });
            }

            // בדוק אם זה מערך JSON
            if (filePaths.StartsWith("[") && filePaths.EndsWith("]"))
            {
                try
                {
                    // נסה לפרסר את המערך
                    var pathsArray = JsonSerializer.Deserialize<string[]>(filePaths);
                    
                    // מערך לשמירת תוכן ה-HTML של כל המיילים
                    var htmlContents = new List<string>();
                    
                    // עבור על כל נתיב ונסה להמיר אותו ל-HTML
                    foreach (var path in pathsArray)
                    {
                        try
                        {
                            string htmlContent = "";
                            var extension = Path.GetExtension(path).ToLowerInvariant();
                            
                            if (extension == ".msg")
                            {
                                htmlContent = ConvertMsgToHtml(path);
                            }
                            else if (extension == ".eml")
                            {
                                htmlContent = ConvertEmlToHtml(path);
                            }
                            
                            if (!string.IsNullOrEmpty(htmlContent))
                            {
                                htmlContents.Add(htmlContent);
                            }
                        }
                        catch (Exception ex)
                        {
                            htmlContents.Add($"<div class='error-message'>שגיאה בהמרת המייל {Path.GetFileName(path)}: {ex.Message}</div>");
                        }
                    }
                    
                    // אם הצלחנו להמיר לפחות מייל אחד
                    if (htmlContents.Count > 0)
                    {
                        return Json(new { success = true, htmlContents = htmlContents });
                    }
                    else
                    {
                        return Json(new { success = false, error = "לא ניתן להמיר אף אחד מהמיילים" });
                    }
                }
                catch (JsonException jex)
                {
                    return Json(new { success = false, error = $"שגיאה בפרסור מערך הנתיבים: {jex.Message}" });
                }
            }
            
            // אם זה לא מערך, טפל בו כנתיב בודד
            return ConvertEmailToHtml(filePaths);
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = $"Error: {ex.Message}" });
        }
    }

    [HttpGet]
    public IActionResult DownloadFile(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return NotFound(new { error = "נתיב קובץ חסר" });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            // נסה לפענח את הנתיב אם הוא מקודד
            string decodedPath = filePath;
            try
            {
                if (filePath.Contains("%"))
                {
                    decodedPath = Uri.UnescapeDataString(filePath);
                }
            }
            catch (Exception ex)
            {
                // אם הפענוח נכשל, השתמש בנתיב המקורי
                decodedPath = filePath;
            }
            
            if (Path.IsPathRooted(decodedPath))
            {
                // אם זה נתיב מוחלט - השתמש בו ישירות
                fullPath = decodedPath;
            }
            else
            {
                // אם זה נתיב יחסי - בנה נתיב מוחלט
                fullPath = Path.Combine(_baseFilesPath, decodedPath);
            }

            // נרמל את הנתיב (תקן slashes)
            fullPath = Path.GetFullPath(fullPath);

            if (!System.IO.File.Exists(fullPath))
            {
                
                // נסה גם עם הנתיב המקורי אם הפענוח נכשל
                if (decodedPath != filePath)
                {
                    string alternativePath;
                    if (Path.IsPathRooted(filePath))
                    {
                        alternativePath = filePath;
                    }
                    else
                    {
                        alternativePath = Path.Combine(_baseFilesPath, filePath);
                    }
                    
                    alternativePath = Path.GetFullPath(alternativePath);
                    Console.WriteLine($"Trying alternative path: {alternativePath}");
                    
                    if (System.IO.File.Exists(alternativePath))
                    {
                        fullPath = alternativePath;
                    }
                    else
                    {
                        return NotFound(new { error = $"הקובץ לא נמצא: {filePath}" });
                    }
                }
                else
                {
                    return NotFound(new { error = $"הקובץ לא נמצא: {filePath}" });
                }
            }

            var fileName = Path.GetFileName(fullPath);
            var fileBytes = System.IO.File.ReadAllBytes(fullPath);
            var contentType = GetContentType(fullPath);

            return File(fileBytes, contentType, fileName);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = $"Error: {ex.Message}" });
        }
    }

    private string GetContentType(string filePath)
    {
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        return extension switch
        {
            ".msg" => "application/vnd.ms-outlook",
            ".eml" => "message/rfc822",
            ".csv" => "text/csv",
            ".pdf" => "application/pdf",
            ".txt" => "text/plain",
            _ => "application/octet-stream"
        };
    }

    [HttpGet]
    public IActionResult GetCsvFile(string filePath)
    {
        if (string.IsNullOrEmpty(filePath) || !System.IO.File.Exists(filePath))
        {
            return NotFound();
        }

        var fileBytes = System.IO.File.ReadAllBytes(filePath);
        return File(fileBytes, "text/csv", Path.GetFileName(filePath));
    }
    
    [HttpGet]
    public async Task<IActionResult> ParseCsv(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath) || !System.IO.File.Exists(filePath))
            {
                return Json(new { success = false, error = "File not found" });
            }

            // קריאה לפונקציה הפרטית שכבר מטפלת נכון בפסיקים
            var result = await ParseCsvFile(filePath);
            return Json(result);
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult AddMessage([FromBody] MessageRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Title))
            {
                return Json(new { success = false, error = "כותרת ותוכן הודעה נדרשים" });
            }

            // Create base message object with new ID
            string newMessageId = Guid.NewGuid().ToString();
            
            var newMessage = new Dictionary<string, object>
            {
                ["id"] = newMessageId,
                ["title"] = request.Title,
                ["category"] = request.Category ?? "כללי",
                ["author"] = request.Author ?? "מנהל מערכת",
                ["date"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                ["priority"] = request.Priority ?? "רגיל",
                ["dueDate"] = request.DueDate
            };

            // בדוק אם יש קבצים כלשהם בתיקיית temp שצריך להעביר
            bool needToMoveFiles = false;
            
            // בדוק קבצי התראות
            if (request.AlertItems != null && request.AlertItems.Count > 0)
            {
                foreach (var item in request.AlertItems)
                {
                    if (item.ImagePath != null && item.ImagePath.Contains("temp"))
                    {
                        needToMoveFiles = true;
                        break;
                    }
                }
            }
            
            // בדוק קבצים מצורפים
            if (!needToMoveFiles && request.Attachments != null && request.Attachments.Count > 0)
            {
                foreach (var path in request.Attachments)
                {
                    if (path.Contains("temp"))
                    {
                        needToMoveFiles = true;
                        break;
                    }
                }
            }
            
            // בדוק קובץ CSV
            if (!needToMoveFiles && request.CsvFilePath != null && request.CsvFilePath.Contains("temp"))
            {
                needToMoveFiles = true;
            }
            
            // העבר קבצים אם צריך
            if (needToMoveFiles)
            {
                MoveFilesFromTemp("temp", newMessageId);
                
                // עדכן את כל הנתיבים
                if (request.AlertItems != null)
                {
                    for (int i = 0; i < request.AlertItems.Count; i++)
                    {
                        if (request.AlertItems[i].ImagePath != null && request.AlertItems[i].ImagePath.Contains("temp"))
                        {
                            request.AlertItems[i].ImagePath = request.AlertItems[i].ImagePath.Replace("temp", newMessageId);
                        }
                    }
                }
                
                if (request.Attachments != null)
                {
                    for (int i = 0; i < request.Attachments.Count; i++)
                    {
                        if (request.Attachments[i].Contains("temp"))
                        {
                            request.Attachments[i] = request.Attachments[i].Replace("temp", newMessageId);
                        }
                    }
                }
                
                if (request.AttachedEmails != null)
                {
                    for (int i = 0; i < request.AttachedEmails.Count; i++)
                    {
                        if (request.AttachedEmails[i].Contains("temp"))
                        {
                            request.AttachedEmails[i] = request.AttachedEmails[i].Replace("temp", newMessageId);
                        }
                    }
                }
                
                if (request.CsvFilePath != null && request.CsvFilePath.Contains("temp"))
                {
                    request.CsvFilePath = request.CsvFilePath.Replace("temp", newMessageId);
                }
            }

            
            // טיפול במערך מיילים
            if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
            {
                // העברת קבצים מתיקיית temp לתיקיית ההודעה החדשה
                foreach (var emailPath in request.AttachedEmails)
                {
                    if (emailPath.Contains("temp"))
                    {
                        MoveFilesFromTemp("temp", newMessageId);
                        break; // מספיק פעם אחת
                    }
                }
                
                // עדכון הנתיבים בהודעה
                List<string> updatedPaths = new List<string>();
                foreach (var emailPath in request.AttachedEmails)
                {
                    if (!string.IsNullOrEmpty(emailPath))
                    {
                        string updatedPath = emailPath.Replace("temp", newMessageId);
                        updatedPaths.Add(updatedPath.Replace("\\", "/"));
                        ManageCache(updatedPath);
                    }
                }
                
                if (updatedPaths.Count > 0)
                {
                    newMessage["attachedEmails"] = updatedPaths;
                }
            }
            // תאימות לאחור - טיפול במייל בודד
            else if (!string.IsNullOrEmpty(request.AttachedEmail) && request.AttachedEmail.Contains("temp"))
            {
                MoveFilesFromTemp("temp", newMessageId);
                
                // עדכן את הנתיב בהודעה
                if (!string.IsNullOrEmpty(request.AttachedEmail))
                {
                    request.AttachedEmail = request.AttachedEmail.Replace("temp", newMessageId);
                    ManageCache(request.AttachedEmail);
                    newMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                }
            }
            
            if (request.CsvFilePath != null && request.CsvFilePath.Contains("temp"))
            {
                MoveFilesFromTemp("temp", newMessageId);
                
                // עדכן את הנתיב בהודעה
                if (!string.IsNullOrEmpty(request.CsvFilePath))
                {
                    request.CsvFilePath = request.CsvFilePath.Replace("temp", newMessageId);
                }
            }

            // Add category-specific fields
            switch (request.Category)
            {
                case "בקשות וביצוע":
                    newMessage["jobs"] = request.Jobs ?? new List<ExecutionJob>();
                    // טיפול בקבצים מצורפים
                    if (request.Attachments != null && request.Attachments.Count > 0)
                    {
                        foreach (var attachmentPath in request.Attachments)
                        {
                            if (attachmentPath.Contains("temp"))
                            {
                                MoveFilesFromTemp("temp", newMessageId);
                                break;
                            }
                        }
                        
                        List<string> updatedAttachmentPaths = new List<string>();
                        foreach (var attachmentPath in request.Attachments)
                        {
                            if (!string.IsNullOrEmpty(attachmentPath))
                            {
                                string updatedPath = attachmentPath.Replace("temp", newMessageId);
                                updatedAttachmentPaths.Add(updatedPath.Replace("\\", "/"));
                            }
                        }
                        
                        if (updatedAttachmentPaths.Count > 0)
                        {
                            newMessage["attachments"] = updatedAttachmentPaths;
                        }
                    }
                    // שמירת מערך המיילים או מייל בודד
                    if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
                    {
                        // העברת קבצים מתיקיית temp לתיקיית ההודעה החדשה
                        foreach (var emailPath in request.AttachedEmails)
                        {
                            if (emailPath.Contains("temp"))
                            {
                                MoveFilesFromTemp("temp", newMessageId);
                                break; // מספיק פעם אחת
                            }
                        }
                        
                        // עדכון הנתיבים בהודעה
                        List<string> updatedPaths = new List<string>();
                        foreach (var emailPath in request.AttachedEmails)
                        {
                            if (!string.IsNullOrEmpty(emailPath))
                            {
                                string updatedPath = emailPath.Replace("temp", newMessageId);
                                updatedPaths.Add(updatedPath.Replace("\\", "/"));
                                ManageCache(updatedPath);
                            }
                        }
                        
                        if (updatedPaths.Count > 0)
                        {
                            newMessage["attachedEmails"] = updatedPaths;
                        }
                    }
                    else if (!string.IsNullOrEmpty(request.AttachedEmail))
                    {
                        newMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                    }
                    break;
                    
                case "בקשות":
                    newMessage["content"] = request.Content;
                     // שמירת מערך המיילים או מייל בודד
                    if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
                    {
                        newMessage["attachedEmails"] = request.AttachedEmails;
                    }
                    else if (!string.IsNullOrEmpty(request.AttachedEmail))
                    {
                        newMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                    }
                    break;
                    
                case "רשימות":
                    if (!string.IsNullOrEmpty(request.CsvFilePath))
                    {
                        newMessage["csvFilePath"] = request.CsvFilePath.Replace("\\", "/");
                    }
                    newMessage["tableData"] = request.TableData;
                    newMessage["alwaysShow"] = request.AlwaysShow;
                    if (!request.AlwaysShow && !string.IsNullOrEmpty(request.EndDate))
                    {
                        newMessage["endDate"] = request.EndDate;
                    }
                    break;

                case "דוחות UC4":
                    if (!string.IsNullOrEmpty(request.CsvFilePath))
                    {
                        newMessage["csvFilePath"] = request.CsvFilePath.Replace("\\", "/");
                    }
                    newMessage["tableData"] = request.TableData;
                    
                    // ← הוסף שמירת Control-M:
                    if (request.ControlMTableData != null && request.ControlMTableData.Count > 0)
                    {
                        newMessage["controlMTableData"] = request.ControlMTableData;
                    }
                    break;
                case "סיכומי משמרת":
                    newMessage["incidents"] = request.Incidents;
                    newMessage["openAlerts"] = request.OpenAlerts;
                    newMessage["alertItems"] = request.AlertItems;
                    newMessage["specialActions"] = request.SpecialActions;
                    newMessage["generalInfo"] = request.GeneralInfo;
                    newMessage["openItems"] = request.OpenItems;
                    
                    if (request.DailyTasksSummary != null)
                    {
                        newMessage["dailyTasksSummary"] = request.DailyTasksSummary;
                    }
                    // טיפול בקבצים מצורפים
                    if (request.Attachments != null && request.Attachments.Count > 0)
                    {
                        // העברת קבצים מתיקיית temp לתיקיית ההודעה החדשה
                        foreach (var attachmentPath in request.Attachments)
                        {
                            if (attachmentPath.Contains("temp"))
                            {
                                MoveFilesFromTemp("temp", newMessageId);
                                break; // מספיק פעם אחת
                            }
                        }
                        
                        // עדכון הנתיבים בהודעה
                        List<string> updatedPaths = new List<string>();
                        foreach (var attachmentPath in request.Attachments)
                        {
                            if (!string.IsNullOrEmpty(attachmentPath))
                            {
                                string updatedPath = attachmentPath.Replace("temp", newMessageId);
                                updatedPaths.Add(updatedPath.Replace("\\", "/"));
                            }
                        }
                        
                        if (updatedPaths.Count > 0)
                        {
                            newMessage["attachments"] = updatedPaths;
                        }
                    }
                    
                    // טיפול בקבצי מייל מצורפים לסיכומי משמרת
                    if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
                    {
                        // העברת קבצים מתיקיית temp לתיקיית ההודעה החדשה
                        foreach (var emailPath in request.AttachedEmails)
                        {
                            if (emailPath.Contains("temp"))
                            {
                                MoveFilesFromTemp("temp", newMessageId);
                                break; // מספיק פעם אחת
                            }
                        }
                        
                        // עדכון הנתיבים בהודעה
                        List<string> updatedEmailPaths = new List<string>();
                        foreach (var emailPath in request.AttachedEmails)
                        {
                            if (!string.IsNullOrEmpty(emailPath))
                            {
                                string updatedPath = emailPath.Replace("temp", newMessageId);
                                updatedEmailPaths.Add(updatedPath.Replace("\\", "/"));
                                ManageCache(updatedPath);
                            }
                        }
                        
                        if (updatedEmailPaths.Count > 0)
                        {
                            newMessage["attachedEmails"] = updatedEmailPaths;
                        }
                    }
                    else if (!string.IsNullOrEmpty(request.AttachedEmail))
                    {
                        // תמיכה לאחור במייל בודד
                        newMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                        ManageCache(request.AttachedEmail);
                    }
                    break;
                case "כללי":
                case "דחוף":
                default:
                    newMessage["content"] = request.Content;
                    break;
            }

            // טיפול באישורי כניסה
            if (request.IsEntryPermit && request.EntryPermitData != null)
            {
                newMessage["entryPermitData"] = request.EntryPermitData;
            }

            var messages = ReadMessagesFromFile();
            messages.Insert(0, newMessage);

            WriteMessagesToFile(messages);

            return Json(new { success = true, message = newMessage });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in AddMessage: {ex.Message}");
            Console.WriteLine($"Stack trace: {ex.StackTrace}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    private void MoveFilesFromTemp(string tempId, string newMessageId)
    {
        try
        {
            var tempDir = Path.Combine(_uploadsPath, tempId);
            var targetDir = Path.Combine(_uploadsPath, newMessageId);
            
            Console.WriteLine($"Moving files from {tempDir} to {targetDir}");
            
            // בדוק אם תיקיית temp קיימת
            if (Directory.Exists(tempDir))
            {
                // וודא שתיקיית היעד קיימת
                Directory.CreateDirectory(targetDir);
                
                // רשימה לשמירת קבצים שכבר הועברו
                var copiedFiles = new HashSet<string>();
                
                // העבר את כל הקבצים מתיקיית temp לתיקיית היעד
                foreach (var file in Directory.GetFiles(tempDir))
                {
                    var fileName = Path.GetFileName(file);
                    var targetPath = Path.Combine(targetDir, fileName);
                    
                    // בדוק אם הקובץ כבר קיים ביעד
                    if (System.IO.File.Exists(targetPath))
                    {
                        // אם הקובץ כבר קיים, הוסף מספר סידורי לשם הקובץ
                        string fileNameWithoutExt = Path.GetFileNameWithoutExtension(fileName);
                        string extension = Path.GetExtension(fileName);
                        int counter = 1;
                        
                        while (System.IO.File.Exists(targetPath))
                        {
                            fileName = $"{fileNameWithoutExt}_{counter}{extension}";
                            targetPath = Path.Combine(targetDir, fileName);
                            counter++;
                        }
                    }
                    
                    try
                    {
                        // העתק את הקובץ ליעד החדש
                        System.IO.File.Copy(file, targetPath, true);
                        copiedFiles.Add(fileName.ToLower());
                        Console.WriteLine($"Copied file from temp: {fileName} to {targetPath}");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error copying file {fileName}: {ex.Message}");
                    }
                }
                
                // מחק את תיקיית temp רק אם כל הקבצים הועתקו בהצלחה
                try
                {
                    Directory.Delete(tempDir, true);
                    Console.WriteLine($"Deleted temp directory: {tempDir}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error deleting temp directory: {ex.Message}");
                }
            }
            else
            {
                Console.WriteLine($"Temp directory not found: {tempDir}");
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in MoveFilesFromTemp: {ex.Message}");
        }
    }

    private List<ExecutionMessage> LoadMessages()
    {
        var messages = new List<ExecutionMessage>();
        
        if (!System.IO.File.Exists(_messagesFilePath))
        {
            return messages;
        }

        try
        {
            var lines = System.IO.File.ReadAllLines(_messagesFilePath);
            
            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                try
                {
                    var jsonElement = JsonSerializer.Deserialize<JsonElement>(line);
                    
                    // בדוק אם זו הודעת ביצוע
                    if (jsonElement.TryGetProperty("category", out var categoryProp) && 
                        categoryProp.GetString() == "בקשות וביצוע")
                    {
                        var message = new ExecutionMessage
                        {
                            Id = jsonElement.TryGetProperty("id", out var idProp) ? idProp.GetString() : null,
                            Title = jsonElement.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : "",
                            Category = "בקשות וביצוע",
                            Author = jsonElement.TryGetProperty("author", out var authorProp) ? authorProp.GetString() : "",
                            Date = jsonElement.TryGetProperty("date", out var dateProp) ? dateProp.GetString() : "",
                            Priority = jsonElement.TryGetProperty("priority", out var priorityProp) ? priorityProp.GetString() : "רגיל",
                            DueDate = jsonElement.TryGetProperty("dueDate", out var dueDateProp) ? dueDateProp.GetString() : null,
                            LastModified = jsonElement.TryGetProperty("lastModified", out var modifiedProp) ? modifiedProp.GetString() : null,
                            AttachedEmail = jsonElement.TryGetProperty("attachedEmail", out var emailProp) ? emailProp.GetString() : null,
                            Jobs = new List<ExecutionJob>()
                        };

                        // טען את הג'ובים
                        if (jsonElement.TryGetProperty("jobs", out var jobsProp) && jobsProp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var jobElement in jobsProp.EnumerateArray())
                            {
                                var job = new ExecutionJob
                                {
                                    IsCompleted = jobElement.TryGetProperty("IsCompleted", out var completedProp) && completedProp.GetBoolean(),
                                    Order = jobElement.TryGetProperty("Order", out var orderProp) ? orderProp.GetInt32() : -1,
                                    JobName = jobElement.TryGetProperty("JobName", out var nameProp) ? nameProp.GetString() : "",
                                    Notes = jobElement.TryGetProperty("Notes", out var notesProp) ? notesProp.GetString() : "",
                                    Responsible = jobElement.TryGetProperty("Responsible", out var respProp) ? respProp.GetString() : "",
                                    CompletedBy = jobElement.TryGetProperty("CompletedBy", out var completedByProp) ? completedByProp.GetString() : null,
                                    CompletedDate = jobElement.TryGetProperty("CompletedDate", out var completedDateProp) ? completedDateProp.GetString() : null,
                                    ExecutionTime = jobElement.TryGetProperty("ExecutionTime", out var execTimeProp) ? execTimeProp.GetString() : null,
                                    HasAlarm = jobElement.TryGetProperty("HasAlarm", out var hasAlarmProp) && hasAlarmProp.GetBoolean()
                                };
                                message.Jobs.Add(job);
                            }
                        }

                        messages.Add(message);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error parsing message line: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error reading messages file: {ex.Message}");
        }

        return messages;
    }

    private void SaveMessages(List<ExecutionMessage> executionMessages)
    {
        try
        {
            // קרא את כל ההודעות הקיימות
            var allMessages = ReadMessagesFromFile();
            
            // צור dictionary של הודעות ביצוע מעודכנות
            var updatedExecutionDict = executionMessages.ToDictionary(m => m.Id);
            
            // עדכן את ההודעות ברשימה הכללית
            for (int i = 0; i < allMessages.Count; i++)
            {
                var messageJson = JsonSerializer.Serialize(allMessages[i]);
                var messageObj = JsonSerializer.Deserialize<JsonElement>(messageJson);
                
                if (messageObj.TryGetProperty("id", out var idProp))
                {
                    string messageId = idProp.GetString();
                    
                    // אם זו הודעת ביצוע שעודכנה, החלף אותה
                    if (updatedExecutionDict.ContainsKey(messageId))
                    {
                        var updatedMessage = updatedExecutionDict[messageId];
                        
                        allMessages[i] = new Dictionary<string, object>
                        {
                            ["id"] = updatedMessage.Id,
                            ["title"] = updatedMessage.Title,
                            ["category"] = updatedMessage.Category,
                            ["author"] = updatedMessage.Author,
                            ["date"] = updatedMessage.Date,
                            ["priority"] = updatedMessage.Priority,
                            ["dueDate"] = updatedMessage.DueDate,
                            ["lastModified"] = updatedMessage.LastModified,
                            ["attachedEmail"] = updatedMessage.AttachedEmail,
                            ["jobs"] = updatedMessage.Jobs
                        };
                    }
                }
            }
            
            // שמור את כל ההודעות בחזרה לקובץ
            WriteMessagesToFile(allMessages);
        }
        catch (Exception ex)
        {
            throw new Exception($"שגיאה בשמירת הודעות: {ex.Message}");
        }
    }

    [HttpPost]
    public IActionResult UpdateJobCompletion([FromBody] UpdateJobCompletionRequest request)
    {
        try
        {
            // Validation
            if (string.IsNullOrEmpty(request.MessageId))
            {
                return Json(new { success = false, error = "מזהה הודעה חסר" });
            }

            if (request.JobIndex < 0)
            {
                return Json(new { success = false, error = "אינדקס משימה לא תקין" });
            }

            var messages = LoadMessages();
            var message = messages.FirstOrDefault(m => m.Id == request.MessageId);
            
            if (message == null)
            {
                return Json(new { success = false, error = "הודעה לא נמצאה" });
            }

            if (message.Jobs == null || request.JobIndex >= message.Jobs.Count)
            {
                return Json(new { success = false, error = "משימה לא נמצאה" });
            }

            // עדכון הסטטוס
            message.Jobs[request.JobIndex].IsCompleted = request.IsCompleted;
            
            // עדכון מידע על מי ביצע את המשימה
            if (request.IsCompleted)
            {
                message.Jobs[request.JobIndex].CompletedBy = request.CompletedBy ?? "משתמש מערכת";
                message.Jobs[request.JobIndex].CompletedDate = request.CompletedDate ?? DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            }
            else
            {
                // אם מסירים את הסימון, מנקים את פרטי הביצוע
                message.Jobs[request.JobIndex].CompletedBy = null;
                message.Jobs[request.JobIndex].CompletedDate = null;
            }
            
            message.LastModified = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");

            // שמירה
            SaveMessages(messages);

            // החזר גם סטטיסטיקה מעודכנת
            var completedCount = message.Jobs.Count(j => j.IsCompleted);
            var totalCount = message.Jobs.Count;

            return Json(new 
            { 
                success = true,
                completedCount = completedCount,
                totalCount = totalCount,
                percentage = totalCount > 0 ? Math.Round((double)completedCount / totalCount * 100, 0) : 0,
                completedBy = message.Jobs[request.JobIndex].CompletedBy,
                completedDate = message.Jobs[request.JobIndex].CompletedDate
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = $"Error: {ex.Message}" });
        }
    }

    [HttpPost]
    public async Task<IActionResult> UpdateAllJobStatuses([FromBody] object requestData)
    {
        try
        {
            // המר את הנתונים למודל באופן ידני
            var jsonElement = (JsonElement)requestData;
            
            if (!jsonElement.TryGetProperty("MessageId", out var messageIdElement) || 
                messageIdElement.ValueKind != JsonValueKind.String ||
                !jsonElement.TryGetProperty("Jobs", out var jobsElement) ||
                jobsElement.ValueKind != JsonValueKind.Array)
            {
                return Json(new { success = false, error = "נתונים חסרים או לא תקינים" });
            }
            
            string messageId = messageIdElement.GetString();
            
            // טען את כל ההודעות
            var messages = LoadMessages();
            var message = messages.FirstOrDefault(m => m.Id == messageId);
            
            if (message == null)
            {
                return Json(new { success = false, error = "הודעה לא נמצאה" });
            }
            
            if (message.Jobs == null)
            {
                return Json(new { success = false, error = "אין משימות בהודעה זו" });
            }
            
            // עדכן את המשימות
            foreach (var jobElement in jobsElement.EnumerateArray())
            {
                if (!jobElement.TryGetProperty("JobIndex", out var jobIndexElement) ||
                    jobIndexElement.ValueKind != JsonValueKind.Number)
                {
                    continue;
                }
                
                int jobIndex = jobIndexElement.GetInt32();
                
                if (jobIndex < 0 || jobIndex >= message.Jobs.Count)
                {
                    continue;
                }
                
                // עדכן את סטטוס הביצוע
                if (jobElement.TryGetProperty("IsCompleted", out var isCompletedElement) &&
                    isCompletedElement.ValueKind == JsonValueKind.True)
                {
                    message.Jobs[jobIndex].IsCompleted = true;
                    
                    // עדכן את פרטי המבצע
                    if (jobElement.TryGetProperty("CompletedBy", out var completedByElement) &&
                        completedByElement.ValueKind == JsonValueKind.String)
                    {
                        message.Jobs[jobIndex].CompletedBy = completedByElement.GetString();
                    }
                    
                    if (jobElement.TryGetProperty("CompletedDate", out var completedDateElement) &&
                        completedDateElement.ValueKind == JsonValueKind.String)
                    {
                        message.Jobs[jobIndex].CompletedDate = completedDateElement.GetString();
                    }
                    else
                    {
                        message.Jobs[jobIndex].CompletedDate = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                    }
                    
                    // אם מסומן כבוצע, וודא שלא מסומן גם כבריצה
                    message.Jobs[jobIndex].IsRunning = false;
                    message.Jobs[jobIndex].RunningBy = null;
                    message.Jobs[jobIndex].RunningDate = null;
                }
                else
                {
                    message.Jobs[jobIndex].IsCompleted = false;
                    message.Jobs[jobIndex].CompletedBy = null;
                    message.Jobs[jobIndex].CompletedDate = null;
                    
                    // עדכן את סטטוס הריצה
                    if (jobElement.TryGetProperty("IsRunning", out var isRunningElement) &&
                        isRunningElement.ValueKind == JsonValueKind.True)
                    {
                        message.Jobs[jobIndex].IsRunning = true;
                        
                        // עדכן את פרטי המריץ
                        if (jobElement.TryGetProperty("RunningBy", out var runningByElement) &&
                            runningByElement.ValueKind == JsonValueKind.String)
                        {
                            message.Jobs[jobIndex].RunningBy = runningByElement.GetString();
                        }
                        
                        if (jobElement.TryGetProperty("RunningDate", out var runningDateElement) &&
                            runningDateElement.ValueKind == JsonValueKind.String)
                        {
                            message.Jobs[jobIndex].RunningDate = runningDateElement.GetString();
                        }
                        else
                        {
                            message.Jobs[jobIndex].RunningDate = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                        }
                    }
                    else
                    {
                        message.Jobs[jobIndex].IsRunning = false;
                        message.Jobs[jobIndex].RunningBy = null;
                        message.Jobs[jobIndex].RunningDate = null;
                    }
                }
            }
            
            // עדכן את זמן העדכון האחרון
            message.LastModified = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            
            // שמור את השינויים
            SaveMessages(messages);
            
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in UpdateAllJobStatuses: {ex.Message}");
            return Json(new { success = false, error = $"Error: {ex.Message}" });
        }
    }

    [HttpPut]
    public IActionResult EditMessage([FromBody] MessageRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Id) || string.IsNullOrEmpty(request.Title))
            {
                return Json(new { success = false, error = "מזהה וכותרת נדרשים" });
            }

            var messages = ReadMessagesFromFile();
            
            for (int i = 0; i < messages.Count; i++)
            {
                var messageJson = JsonSerializer.Serialize(messages[i]);
                var messageObj = JsonSerializer.Deserialize<JsonElement>(messageJson);
                
                string messageId = messageObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (messageId == request.Id)
                {
                    string originalDate = messageObj.TryGetProperty("date", out var dateProp) 
                        ? dateProp.GetString() 
                        : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                    
                    // בדוק אם יש קבצים כלשהם בתיקיית temp שצריך להעביר
                    bool needToMoveFiles = false;
                    
                    // בדוק קבצי התראות
                    if (request.AlertItems != null && request.AlertItems.Count > 0)
                    {
                        foreach (var item in request.AlertItems)
                        {
                            if (item.ImagePath != null && item.ImagePath.Contains("temp"))
                            {
                                needToMoveFiles = true;
                                break;
                            }
                        }
                    }
                    
                    // בדוק קבצים מצורפים
                    if (!needToMoveFiles && request.Attachments != null && request.Attachments.Count > 0)
                    {
                        foreach (var path in request.Attachments)
                        {
                            if (path.Contains("temp"))
                            {
                                needToMoveFiles = true;
                                break;
                            }
                        }
                    }
                    
                    // בדוק קובץ CSV
                    if (!needToMoveFiles && request.CsvFilePath != null && request.CsvFilePath.Contains("temp"))
                    {
                        needToMoveFiles = true;
                    }
                    
                    // העבר קבצים אם צריך
                    if (needToMoveFiles)
                    {
                        Console.WriteLine($"Moving files from temp to {request.Id} for edit operation");
                        MoveFilesFromTemp("temp", request.Id);
                        
                        // עדכן את נתיבי התמונות של ההתראות
                        if (request.AlertItems != null)
                        {
                            for (int j = 0; j < request.AlertItems.Count; j++)
                            {
                                if (request.AlertItems[j].ImagePath != null && request.AlertItems[j].ImagePath.Contains("temp"))
                                {
                                    request.AlertItems[j].ImagePath = request.AlertItems[j].ImagePath.Replace("temp", request.Id);
                                    Console.WriteLine($"Updated alert item path: {request.AlertItems[j].ImagePath}");
                                }
                            }
                        }
                        
                        // עדכן את נתיבי הקבצים המצורפים
                        if (request.Attachments != null)
                        {
                            for (int j = 0; j < request.Attachments.Count; j++)
                            {
                                if (request.Attachments[j].Contains("temp"))
                                {
                                    request.Attachments[j] = request.Attachments[j].Replace("temp", request.Id);
                                    Console.WriteLine($"Updated attachment path: {request.Attachments[j]}");
                                }
                            }
                        }
                        
                        // עדכן את נתיב קובץ ה-CSV
                        if (request.CsvFilePath != null && request.CsvFilePath.Contains("temp"))
                        {
                            request.CsvFilePath = request.CsvFilePath.Replace("temp", request.Id);
                            Console.WriteLine($"Updated CSV path: {request.CsvFilePath}");
                        }
                    }

                    // Create updated message
                    var updatedMessage = new Dictionary<string, object>
                    {
                        ["id"] = request.Id,
                        ["title"] = request.Title,
                        ["category"] = request.Category ?? "כללי",
                        ["author"] = request.Author ?? "מנהל מערכת",
                        ["date"] = originalDate,
                        ["priority"] = request.Priority ?? "רגיל",
                        ["lastModified"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        ["dueDate"] = request.DueDate
                    };

                    // Add category-specific fields
                    switch (request.Category)
                    {
                        case "בקשות וביצוע":
                            updatedMessage["jobs"] = request.Jobs ?? new List<ExecutionJob>();
                            // שמירת קבצים מצורפים
                            if (request.Attachments != null && request.Attachments.Count > 0)
                            {
                                foreach (var attachmentPath in request.Attachments)
                                {
                                    if (attachmentPath.Contains("temp"))
                                    {
                                        MoveFilesFromTemp("temp", messageId);
                                        break;
                                    }
                                }
                                
                                List<string> updatedAttachmentPaths = new List<string>();
                                foreach (var attachmentPath in request.Attachments)
                                {
                                    if (!string.IsNullOrEmpty(attachmentPath))
                                    {
                                        string updatedPath = attachmentPath.Replace("temp", messageId);
                                        updatedAttachmentPaths.Add(updatedPath.Replace("\\", "/"));
                                    }
                                }
                                
                                if (updatedAttachmentPaths.Count > 0)
                                {
                                    updatedMessage["attachments"] = updatedAttachmentPaths;
                                }
                            }
                            // שמירת מערך המיילים או מייל בודד
                            if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
                            {
                                // העברת קבצים מתיקיית temp לתיקיית ההודעה החדשה
                                foreach (var emailPath in request.AttachedEmails)
                                {
                                    if (emailPath.Contains("temp"))
                                    {
                                        MoveFilesFromTemp("temp", messageId);
                                        break; // מספיק פעם אחת
                                    }
                                }
                                
                                // עדכון הנתיבים בהודעה
                                List<string> updatedPaths = new List<string>();
                                foreach (var emailPath in request.AttachedEmails)
                                {
                                    if (!string.IsNullOrEmpty(emailPath))
                                    {
                                        string updatedPath = emailPath.Replace("temp", messageId);
                                        updatedPaths.Add(updatedPath.Replace("\\", "/"));
                                        ManageCache(updatedPath);
                                    }
                                }
                                
                                if (updatedPaths.Count > 0)
                                {
                                    updatedMessage["attachedEmails"] = updatedPaths;
                                }
                            }
                            else if (!string.IsNullOrEmpty(request.AttachedEmail))
                            {
                                updatedMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                            }
                            break;
                            
                        case "בקשות":
                            updatedMessage["content"] = request.Content;
                            
                            // שמירת מערך המיילים או מייל בודד
                            if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
                            {
                                // העברת קבצים מתיקיית temp לתיקיית ההודעה החדשה
                                foreach (var emailPath in request.AttachedEmails)
                                {
                                    if (emailPath.Contains("temp"))
                                    {
                                        MoveFilesFromTemp("temp", messageId);
                                        break; // מספיק פעם אחת
                                    }
                                }
                                
                                // עדכון הנתיבים בהודעה
                                List<string> updatedPaths = new List<string>();
                                foreach (var emailPath in request.AttachedEmails)
                                {
                                    if (!string.IsNullOrEmpty(emailPath))
                                    {
                                        string updatedPath = emailPath.Replace("temp", messageId);
                                        updatedPaths.Add(updatedPath.Replace("\\", "/"));
                                        ManageCache(updatedPath);
                                    }
                                }
                                
                                if (updatedPaths.Count > 0)
                                {
                                    updatedMessage["attachedEmails"] = updatedPaths;
                                }
                            }
                            else if (!string.IsNullOrEmpty(request.AttachedEmail))
                            {
                                updatedMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                            }
                            break;
                            
                        case "רשימות":
                            updatedMessage["csvFilePath"] =  request.CsvFilePath.Replace("\\", "/");
                            updatedMessage["tableData"] = request.TableData;
                            updatedMessage["endDate"] = request.EndDate;
                            updatedMessage["alwaysShow"] = request.AlwaysShow;
                            break;
                            
                        case "דוחות UC4":
                            updatedMessage["csvFilePath"] = request.CsvFilePath?.Replace("\\", "/") ?? "";
                            updatedMessage["tableData"] = request.TableData;
                            
                            // ← הוסף שמירת Control-M:
                            if (request.ControlMTableData != null && request.ControlMTableData.Count > 0)
                            {
                                updatedMessage["controlMTableData"] = request.ControlMTableData;
                            }
                            break;

                        case "סיכומי משמרת":
                            updatedMessage["incidents"] = request.Incidents;
                            updatedMessage["openAlerts"] = request.OpenAlerts;
                            updatedMessage["alertItems"] = request.AlertItems;
                            updatedMessage["specialActions"] = request.SpecialActions;
                            updatedMessage["generalInfo"] = request.GeneralInfo;
                            updatedMessage["openItems"] = request.OpenItems;
                            if (request.DailyTasksSummary != null)
                            {
                                updatedMessage["dailyTasksSummary"] = request.DailyTasksSummary;
                            }
                            // טיפול בקבצים מצורפים
                            if (request.Attachments != null && request.Attachments.Count > 0)
                            {
                                // העברת קבצים מתיקיית temp לתיקיית ההודעה
                                foreach (var attachmentPath in request.Attachments)
                                {
                                    if (attachmentPath.Contains("temp"))
                                    {
                                        MoveFilesFromTemp("temp", messageId);
                                        break; // מספיק פעם אחת
                                    }
                                }
                                
                                // עדכון הנתיבים בהודעה
                                List<string> updatedPaths = new List<string>();
                                foreach (var attachmentPath in request.Attachments)
                                {
                                    if (!string.IsNullOrEmpty(attachmentPath))
                                    {
                                        string updatedPath = attachmentPath.Replace("temp", messageId);
                                        updatedPaths.Add(updatedPath.Replace("\\", "/"));
                                    }
                                }
                                
                                if (updatedPaths.Count > 0)
                                {
                                    updatedMessage["attachments"] = updatedPaths;
                                }
                            }
                            
                            // טיפול בקבצי מייל מצורפים לסיכומי משמרת
                            if (request.AttachedEmails != null && request.AttachedEmails.Count > 0)
                            {
                                // העברת קבצים מתיקיית temp לתיקיית ההודעה
                                foreach (var emailPath in request.AttachedEmails)
                                {
                                    if (emailPath.Contains("temp"))
                                    {
                                        MoveFilesFromTemp("temp", messageId);
                                        break; // מספיק פעם אחת
                                    }
                                }
                                
                                // עדכון הנתיבים בהודעה
                                List<string> updatedEmailPaths = new List<string>();
                                foreach (var emailPath in request.AttachedEmails)
                                {
                                    if (!string.IsNullOrEmpty(emailPath))
                                    {
                                        string updatedPath = emailPath.Replace("temp", messageId);
                                        updatedEmailPaths.Add(updatedPath.Replace("\\", "/"));
                                        ManageCache(updatedPath);
                                    }
                                }
                                
                                if (updatedEmailPaths.Count > 0)
                                {
                                    updatedMessage["attachedEmails"] = updatedEmailPaths;
                                }
                            }
                            else if (!string.IsNullOrEmpty(request.AttachedEmail))
                            {
                                // תמיכה לאחור במייל בודד
                                updatedMessage["attachedEmail"] = request.AttachedEmail.Replace("\\", "/");
                                ManageCache(request.AttachedEmail);
                            }
                            break;
                        case "כללי":
                        case "דחוף":
                        default:
                            updatedMessage["content"] = request.Content;
                            break;
                    }
                    
                    // טיפול באישורי כניסה
                    if (request.IsEntryPermit && request.EntryPermitData != null)
                    {
                        updatedMessage["entryPermitData"] = request.EntryPermitData;
                    }

                    messages[i] = updatedMessage;
                    WriteMessagesToFile(messages);
                    
                    if (!string.IsNullOrEmpty(request.AttachedEmail))
                    {
                        ManageCache(request.AttachedEmail);
                    }
                    return Json(new { success = true, message = updatedMessage });
                }
            }

            return Json(new { success = false, error = "הודעה לא נמצאה" });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in EditMessage: {ex.Message}");
            Console.WriteLine($"Stack trace: {ex.StackTrace}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetFileAsBase64(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return Json(new { success = false, error = "נתיב קובץ חסר" });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            if (Path.IsPathRooted(filePath))
            {
                fullPath = filePath;
            }
            else
            {
                fullPath = Path.Combine(_baseFilesPath, filePath);
            }

            // נרמל את הנתיב
            fullPath = Path.GetFullPath(fullPath);

            if (!System.IO.File.Exists(fullPath))
            {
                return Json(new { success = false, error = $"הקובץ לא נמצא: {Path.GetFileName(fullPath)}" });
            }

            // קרא את הקובץ כמערך בייטים
            byte[] fileBytes = System.IO.File.ReadAllBytes(fullPath);
            
            // המר ל-base64
            string base64 = Convert.ToBase64String(fileBytes);
            
            return Json(new { success = true, base64Data = base64 });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpDelete]
    public IActionResult DeleteMessage(string id)
    {
        try
        {
            var messages = ReadMessagesFromFile();
            
            // Find and remove message with matching ID
            for (int i = messages.Count - 1; i >= 0; i--)
            {
                var messageJson = JsonSerializer.Serialize(messages[i]);
                var messageObj = JsonSerializer.Deserialize<JsonElement>(messageJson);
                
                string messageId = messageObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (messageId == id)
                {
                    // בדוק אם יש מייל מצורף ונקה את המטמון שלו
                    if (messageObj.TryGetProperty("attachedEmail", out var emailPathProp))
                    {
                        string emailPath = emailPathProp.GetString();
                        if (!string.IsNullOrEmpty(emailPath))
                        {
                            // נקה את המטמון של המייל
                            ManageCache(emailPath);
                        }
                    }
                    
                    // מחיקת הקבצים המצורפים של ההודעה
                    var uploadsDir = Path.Combine(_uploadsPath, messageId);
                    if (Directory.Exists(uploadsDir))
                    {
                        try
                        {
                            Directory.Delete(uploadsDir, true); // true מציין מחיקה רקורסיבית
                        }
                        catch (Exception ex)
                        {
                            // לוג את השגיאה אבל להמשיך במחיקת ההודעה
                            Console.WriteLine($"שגיאה במחיקת קבצים מצורפים: {ex.Message}");
                        }
                    }
                    
                    messages.RemoveAt(i);
                    WriteMessagesToFile(messages);
                    return Json(new { success = true });
                }
            }

            return Json(new { success = false, error = "הודעה לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult FileExists(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return Json(new { exists = false });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            if (Path.IsPathRooted(filePath))
            {
                fullPath = filePath;
            }
            else
            {
                fullPath = Path.Combine(_baseFilesPath, filePath);
            }

            // נרמל את הנתיב
            fullPath = Path.GetFullPath(fullPath);
            
            bool exists = System.IO.File.Exists(fullPath);
            return Json(new { exists = exists });
        }
        catch (Exception ex)
        {
            return Json(new { exists = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetImageAsBase64(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return Json(new { success = false, error = "נתיב קובץ חסר" });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            if (Path.IsPathRooted(filePath))
            {
                fullPath = filePath;
            }
            else
            {
                fullPath = Path.Combine(_baseFilesPath, filePath);
            }

            // נרמל את הנתיב
            fullPath = Path.GetFullPath(fullPath);

            if (!System.IO.File.Exists(fullPath))
            {
                return Json(new { success = false, error = $"הקובץ לא נמצא: {Path.GetFileName(fullPath)}" });
            }

            // בדוק אם זו תמונה
            var extension = Path.GetExtension(fullPath).ToLowerInvariant();
            string[] supportedImageExtensions = { ".jpg", ".jpeg", ".png", ".gif", ".bmp" };
            
            if (!supportedImageExtensions.Contains(extension))
            {
                return Json(new { success = false, error = "הקובץ אינו תמונה נתמכת" });
            }

            // קרא את הקובץ כמערך בייטים
            byte[] fileBytes = System.IO.File.ReadAllBytes(fullPath);
            
            // המר ל-base64
            string base64 = Convert.ToBase64String(fileBytes);
            
            // הוסף את סוג ה-MIME המתאים
            string mimeType = GetImageMimeType(fullPath);
            string base64Data = $"data:{mimeType};base64,{base64}";
            
            return Json(new { success = true, base64Data = base64Data });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetImageFile(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return NotFound(new { error = "נתיב קובץ חסר" });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            if (Path.IsPathRooted(filePath))
            {
                fullPath = filePath;
            }
            else
            {
                fullPath = Path.Combine(_baseFilesPath, filePath);
            }

            // נרמל את הנתיב
            fullPath = Path.GetFullPath(fullPath);

            if (!System.IO.File.Exists(fullPath))
            {
                return NotFound(new { error = $"הקובץ לא נמצא: {Path.GetFileName(fullPath)}" });
            }

            // בדוק אם זו תמונה
            var extension = Path.GetExtension(fullPath).ToLowerInvariant();
            string[] supportedImageExtensions = { ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg" };
            
            if (!supportedImageExtensions.Contains(extension))
            {
                return BadRequest(new { error = "הקובץ אינו תמונה נתמכת" });
            }

            // קרא את הקובץ כמערך בייטים
            byte[] fileBytes = await System.IO.File.ReadAllBytesAsync(fullPath);
            
            // קבע את סוג התוכן המתאים
            string contentType = GetContentType(fullPath);
            
            // החזר את התמונה
            return File(fileBytes, contentType);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = $"Error: {ex.Message}" });
        }
    }

    [HttpGet]
    public async Task<IActionResult> ViewAttachment(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return NotFound(new { error = "נתיב קובץ חסר" });
            }

            // Normalize the path
            string fullPath = NormalizePath(filePath);

            // Check if file exists
            if (!System.IO.File.Exists(fullPath))
            {
                return NotFound(new { error = $"הקובץ לא נמצא: {filePath}" });
            }

            var fileName = Path.GetFileName(fullPath);
            var fileBytes = await System.IO.File.ReadAllBytesAsync(fullPath);
            var contentType = GetContentType(fullPath);

            // בדוק אם זה קובץ Word או Excel ונדרשת המרה ל-PDF
            var extension = Path.GetExtension(fullPath).ToLowerInvariant();
            if (extension == ".doc" || extension == ".docx")
            {
                // המר ל-PDF
                string pdfPath = ConvertWordToPdf(fullPath);
                if (System.IO.File.Exists(pdfPath))
                {
                    fileBytes = await System.IO.File.ReadAllBytesAsync(pdfPath);
                    contentType = "application/pdf";
                }
            }
            else if (extension == ".xls" || extension == ".xlsx")
            {
                // המר ל-PDF
                string pdfPath = ConvertExcelToPdf(fullPath);
                if (System.IO.File.Exists(pdfPath))
                {
                    fileBytes = await System.IO.File.ReadAllBytesAsync(pdfPath);
                    contentType = "application/pdf";
                }
            }

            return File(fileBytes, contentType);
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = $"Error: {ex.Message}" });
        }
    }

    // Normalize file paths
    private string NormalizePath(string filePath)
    {
        if (string.IsNullOrEmpty(filePath))
            return filePath;
            
        // Replace forward slashes with backslashes for Windows paths
        filePath = filePath.Replace('/', '\\');
        
        // Check if it's already an absolute path
        if (Path.IsPathRooted(filePath))
            return filePath;
            
        // Otherwise, combine with base path
        return Path.Combine(_baseFilesPath, filePath);
    }

    private string ConvertWordToPdf(string wordFilePath)
    {
        // יצירת שם קובץ למטמון על בסיס הקובץ המקורי
        var fileInfo = new FileInfo(wordFilePath);
        var cacheFileName = $"{Path.GetFileNameWithoutExtension(wordFilePath)}_{fileInfo.LastWriteTime.Ticks}.pdf";
        var pdfCachePath = Path.Combine(Path.GetTempPath(), "MessagesPdfCache");
        
        // וודא שתיקיית המטמון קיימת
        if (!Directory.Exists(pdfCachePath))
        {
            Directory.CreateDirectory(pdfCachePath);
        }
        
        var pdfPath = Path.Combine(pdfCachePath, cacheFileName);
        
        // החזר קובץ מהמטמון אם קיים ועדכני
        if (System.IO.File.Exists(pdfPath))
        {
            var pdfInfo = new FileInfo(pdfPath);
            if (pdfInfo.LastWriteTime >= fileInfo.LastWriteTime)
            {
                return pdfPath;
            }
        }
        
        // המר Word ל-PDF
        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Word))
        {
            try
            {
                helper.OpenDocument(wordFilePath, true); // readOnly = true
                helper.SaveAsPdf(pdfPath);
                return pdfPath;
            }
            catch (Exception ex)
            {
                throw new Exception($"שגיאה בהמרת Word ל-PDF: {ex.Message}", ex);
            }
        }
    }

    private string ConvertExcelToPdf(string excelFilePath)
    {
        var fileInfo = new FileInfo(excelFilePath);
        var cacheFileName = $"{Path.GetFileNameWithoutExtension(excelFilePath)}_{fileInfo.LastWriteTime.Ticks}.pdf";
        var pdfCachePath = Path.Combine(Path.GetTempPath(), "MessagesPdfCache");
        
        // וודא שתיקיית המטמון קיימת
        if (!Directory.Exists(pdfCachePath))
        {
            Directory.CreateDirectory(pdfCachePath);
        }
        
        var pdfPath = Path.Combine(pdfCachePath, cacheFileName);
        
        // החזר קובץ מהמטמון אם קיים
        if (System.IO.File.Exists(pdfPath))
        {
            var pdfInfo = new FileInfo(pdfPath);
            if (pdfInfo.LastWriteTime >= fileInfo.LastWriteTime)
            {
                return pdfPath;
            }
        }
        
        // המר Excel ל-PDF באמצעות מחלקת העזר
        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
        {
            try
            {
                helper.OpenWorkbook(excelFilePath);
                helper.SaveAsPdf(pdfPath);
                return pdfPath;
            }
            catch (Exception ex)
            {
                throw new Exception($"שגיאה בהמרת Excel ל-PDF: {ex.Message}", ex);
            }
        }
    }

    private string ExtractTextFromWord(string filePath)
    {
        // וודא שהקובץ קיים
        if (!System.IO.File.Exists(filePath))
        {
            return $"הקובץ לא נמצא: {filePath}";
        }

        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Word))
        {
            try
            {
                helper.OpenDocument(filePath, true); // readOnly = true
                
                // חילוץ טקסט מהמסמך
                var text = new StringBuilder();
                
                // נסה להשתמש בפונקציה המובנית לחילוץ טקסט
                string extractedText = helper.ExtractText();
                
                if (!string.IsNullOrWhiteSpace(extractedText))
                {
                    text.Append(extractedText);
                }
                
                // החזרת טקסט או הודעה אם ריק
                string result = text.ToString();
                return string.IsNullOrWhiteSpace(result) ? "המסמך ריק או לא ניתן לחלץ ממנו טקסט" : result;
            }
            catch (Exception ex)
            {
                return $"שגיאה בחילוץ טקסט מ-Word: {ex.Message}";
            }
        }
    }

    private string ExtractTextFromExcel(string filePath)
    {
        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
        {
            try
            {
                helper.OpenWorkbook(filePath);
                return helper.ExtractText();
            }
            catch (Exception ex)
            {
                return $"שגיאה בחילוץ טקסט מ-Excel: {ex.Message}";
            }
        }
    }

    [HttpDelete]
    public IActionResult DeleteCachedPdf(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return Json(new { success = false, error = "נתיב קובץ חסר" });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            if (Path.IsPathRooted(filePath))
            {
                fullPath = filePath;
            }
            else
            {
                fullPath = Path.Combine(_baseFilesPath, filePath);
            }

            // נרמל את הנתיב
            fullPath = Path.GetFullPath(fullPath);
            
            // קבל מידע על הקובץ המקורי
            var fileInfo = new FileInfo(fullPath);
            
            // יצירת שם קובץ למטמון
            var cacheFileName = $"{Path.GetFileNameWithoutExtension(fullPath)}_{fileInfo.LastWriteTime.Ticks}.pdf";
            var pdfCachePath = Path.Combine(Path.GetTempPath(), "MessagesPdfCache");
            var cachedPdfPath = Path.Combine(pdfCachePath, cacheFileName);
            
            // מחק קובץ PDF מהמטמון אם קיים
            if (System.IO.File.Exists(cachedPdfPath))
            {
                System.IO.File.Delete(cachedPdfPath);
                return Json(new { success = true, message = "קובץ PDF נמחק מהמטמון בהצלחה" });
            }
            
            return Json(new { success = true, message = "לא נמצא קובץ PDF במטמון" });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"שגיאה במחיקת PDF מהמטמון: {ex.Message}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    private List<object> ReadMessagesFromFile()
    {
        var messages = new List<object>();

        if (!System.IO.File.Exists(_messagesFilePath))
        {
            return messages;
        }

        try
        {
            var lines = System.IO.File.ReadAllLines(_messagesFilePath);
            
            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                try
                {
                    var message = JsonSerializer.Deserialize<object>(line);
                    messages.Add(message);
                }
                catch
                {
                    // If not JSON, treat as simple text message
                    messages.Add(new
                    {
                        id = Guid.NewGuid().ToString(),
                        title = "הודעה",
                        content = line.Trim(),
                        category = "בקשות",
                        author = "מערכת",
                        date = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        priority = "רגיל"
                    });
                }
            }
        }
        catch (Exception)
        {
            // Return empty list if file can't be read
        }

        return messages;
    }

    [HttpPost]
    public IActionResult UpdateJobRunning([FromBody] UpdateJobRunningRequest request)
    {
        try
        {
            // Validation
            if (string.IsNullOrEmpty(request.MessageId))
            {
                return Json(new { success = false, error = "מזהה הודעה חסר" });
            }

            if (request.JobIndex < 0)
            {
                return Json(new { success = false, error = "אינדקס משימה לא תקין" });
            }

            var messages = LoadMessages();
            var message = messages.FirstOrDefault(m => m.Id == request.MessageId);
            
            if (message == null)
            {
                return Json(new { success = false, error = "הודעה לא נמצאה" });
            }

            if (message.Jobs == null || request.JobIndex >= message.Jobs.Count)
            {
                return Json(new { success = false, error = "משימה לא נמצאה" });
            }

            // עדכון הסטטוס
            message.Jobs[request.JobIndex].IsRunning = request.IsRunning;
            
            // עדכון מידע על מי התחיל את המשימה
            if (request.IsRunning)
            {
                message.Jobs[request.JobIndex].RunningBy = request.RunningBy ?? "משתמש מערכת";
                message.Jobs[request.JobIndex].RunningDate = request.RunningDate ?? DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
            }
            else
            {
                // אם מסירים את הסימון, מנקים את פרטי הריצה
                message.Jobs[request.JobIndex].RunningBy = null;
                message.Jobs[request.JobIndex].RunningDate = null;
            }
            
            message.LastModified = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");

            // שמירה
            SaveMessages(messages);

            return Json(new 
            { 
                success = true,
                runningBy = message.Jobs[request.JobIndex].RunningBy,
                runningDate = message.Jobs[request.JobIndex].RunningDate
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = $"Error: {ex.Message}" });
        }
    }

    [HttpPost]
    public IActionResult UpdateMessageOrder([FromBody] UpdateMessageOrderRequest request)
    {
        try
        {
            var messages = ReadMessagesFromFile();
            
            // Create a dictionary for quick lookup
            var messageDict = new Dictionary<string, object>();
            foreach (var message in messages)
            {
                var messageJson = JsonSerializer.Serialize(message);
                var messageObj = JsonSerializer.Deserialize<JsonElement>(messageJson); // ← Changed
                
                string id = messageObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null; // ← Changed
                
                if (!string.IsNullOrEmpty(id))
                {
                    messageDict[id] = message;
                }
            }
            
            // Reorder messages based on the provided order
            var orderedMessages = new List<object>();
            
            foreach (var orderItem in request.MessageOrder.OrderBy(x => x.Order))
            {
                if (messageDict.ContainsKey(orderItem.Id))
                {
                    orderedMessages.Add(messageDict[orderItem.Id]);
                }
            }
            
            WriteMessagesToFile(orderedMessages);
            
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> ParseExcelForJobs(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return Json(new { success = false, error = "לא נבחר קובץ" });

            // בדיקת סוג הקובץ
            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension != ".xlsx" && extension != ".xls")
                return Json(new { success = false, error = "יש להעלות קובץ Excel בלבד (.xlsx או .xls)" });

            // שמירת הקובץ זמנית
            var tempFilePath = Path.GetTempFileName();
            using (var stream = new FileStream(tempFilePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            // קריאת הקובץ והמרה לרשימת משימות
            var jobs = await ParseExcelToJobs(tempFilePath);

            // מחיקת הקובץ הזמני
            try { System.IO.File.Delete(tempFilePath); } catch { }

            return Json(new { success = true, jobs = jobs });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> PreloadEmailCache()
    {
        try
        {
            if (!System.IO.File.Exists(_messagesFilePath))
            {
                return Json(new { success = true, message = "No messages file found" });
            }

            var messages = ReadMessagesFromFile();
            int totalEmails = 0;
            int processedEmails = 0;

            // איסוף כל נתיבי המיילים מכל ההודעות
            var emailPaths = new List<string>();
            
            foreach (var message in messages)
            {
                var messageJson = JsonSerializer.Serialize(message);
                var messageObj = JsonSerializer.Deserialize<JsonElement>(messageJson);
                
                // בדוק אם יש מייל מצורף בהודעה
                if (messageObj.TryGetProperty("attachedEmail", out var emailPathProp))
                {
                    string emailPath = emailPathProp.GetString();
                    if (!string.IsNullOrEmpty(emailPath))
                    {
                        emailPaths.Add(emailPath);
                        totalEmails++;
                    }
                }
            }

            // עיבוד מקבילי של עד 3 מיילים בו-זמנית
            var tasks = new List<Task>();
            var semaphore = new SemaphoreSlim(3); // מגביל ל-3 עיבודים במקביל
            
            foreach (var emailPath in emailPaths)
            {
                tasks.Add(Task.Run(async () => {
                    try
                    {
                        await semaphore.WaitAsync(); // השג אישור לעיבוד
                        
                        // המר נתיב יחסי לנתיב מוחלט
                        string fullPath;
                        
                        if (Path.IsPathRooted(emailPath))
                        {
                            fullPath = emailPath;
                        }
                        else
                        {
                            fullPath = Path.Combine(_baseFilesPath, emailPath);
                        }
                        
                        // נרמל את הנתיב
                        fullPath = Path.GetFullPath(fullPath);
                        
                        if (!System.IO.File.Exists(fullPath))
                        {
                            return;
                        }
                        
                        var extension = Path.GetExtension(fullPath).ToLowerInvariant();
                        if (extension != ".msg" && extension != ".eml")
                        {
                            return;
                        }
                        
                        // יצירת שם קובץ ייחודי למטמון
                        var fileInfo = new FileInfo(fullPath);
                        string cacheFileName = $"{Path.GetFileNameWithoutExtension(fullPath)}_{fileInfo.LastWriteTimeUtc.Ticks}{extension}.html";
                        string cachePath = Path.Combine(_emailCachePath, cacheFileName);
                        
                        // בדוק אם כבר קיים במטמון
                        if (Directory.Exists(_emailCachePath) && System.IO.File.Exists(cachePath))
                        {
                            Interlocked.Increment(ref processedEmails);
                            return; // כבר קיים במטמון
                        }
                        
                        // המר את המייל ל-HTML
                        string htmlContent = "";
                        
                        if (extension == ".msg")
                        {
                            htmlContent = ConvertMsgToHtml(fullPath);
                        }
                        else if (extension == ".eml")
                        {
                            htmlContent = ConvertEmlToHtml(fullPath);
                        }
                        
                        if (!string.IsNullOrEmpty(htmlContent))
                        {
                            // שמור את התוצאה במטמון
                            try
                            {
                                // וודא שתיקיית המטמון קיימת
                                if (!Directory.Exists(_emailCachePath))
                                {
                                    Directory.CreateDirectory(_emailCachePath);
                                }
                                
                                // שמור את ה-HTML במטמון
                                System.IO.File.WriteAllText(cachePath, htmlContent);
                                Interlocked.Increment(ref processedEmails);
                            }
                            catch (Exception ex)
                            {
                                Console.WriteLine($"שגיאה בשמירה למטמון: {ex.Message}");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"שגיאה בעיבוד מייל: {ex.Message}");
                    }
                    finally
                    {
                        semaphore.Release(); // שחרר את האישור
                    }
                }));
            }
            
            // המתן לסיום כל המשימות או לפסק זמן של 30 שניות
            await Task.WhenAny(
                Task.WhenAll(tasks),
                Task.Delay(TimeSpan.FromSeconds(30))
            );
            
            return Json(new { 
                success = true, 
                totalEmails = totalEmails,
                processedEmails = processedEmails,
                message = $"Processed {processedEmails} of {totalEmails} emails"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult ConvertEmailToHtml(string filePath)
    {
        try
        {
            if (string.IsNullOrEmpty(filePath))
            {
                return Json(new { success = false, error = "נתיב קובץ חסר" });
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            
            // נסה לפענח את הנתיב אם הוא מקודד
            string decodedPath = filePath;
            try
            {
                if (filePath.Contains("%"))
                {
                    decodedPath = Uri.UnescapeDataString(filePath);
                }
            }
            catch (Exception ex)
            {
                // אם הפענוח נכשל, השתמש בנתיב המקורי
                decodedPath = filePath;
            }
            
            if (Path.IsPathRooted(decodedPath))
            {
                // אם זה נתיב מוחלט - השתמש בו ישירות
                fullPath = decodedPath;
            }
            else
            {
                // אם זה נתיב יחסי - בנה נתיב מוחלט
                fullPath = Path.Combine(_baseFilesPath, decodedPath);
            }

            // נרמל את הנתיב (תקן slashes)
            fullPath = Path.GetFullPath(fullPath);

            if (!System.IO.File.Exists(fullPath))
            {
              
                // נסה גם עם הנתיב המקורי אם הפענוח נכשל
                if (decodedPath != filePath)
                {
                    string alternativePath;
                    if (Path.IsPathRooted(filePath))
                    {
                        alternativePath = filePath;
                    }
                    else
                    {
                        alternativePath = Path.Combine(_baseFilesPath, filePath);
                    }
                    
                    alternativePath = Path.GetFullPath(alternativePath);
                    
                    if (System.IO.File.Exists(alternativePath))
                    {
                        fullPath = alternativePath;
                    }
                    else
                    {
                        return Json(new { success = false, error = $"הקובץ לא נמצא: {filePath}" });
                    }
                }
                else
                {
                    return Json(new { success = false, error = $"הקובץ לא נמצא: {filePath}" });
                }
            }

            var extension = Path.GetExtension(fullPath).ToLowerInvariant();
            
            // בדוק אם זה קובץ מייל
            if (extension != ".msg" && extension != ".eml")
            {
                return Json(new { success = false, error = "הקובץ אינו קובץ מייל נתמך" });
            }

            // יצירת שם קובץ ייחודי למטמון על בסיס הנתיב והתאריך האחרון של שינוי הקובץ
            var fileInfo = new FileInfo(fullPath);
            string cacheFileName = $"{Path.GetFileNameWithoutExtension(fullPath)}_{fileInfo.LastWriteTimeUtc.Ticks}{extension}.html";
            string cachePath = Path.Combine(_emailCachePath, cacheFileName);
            
            // בדוק אם קיים במטמון
            if (Directory.Exists(_emailCachePath) && System.IO.File.Exists(cachePath))
            {
                // אם קיים במטמון, החזר את התוכן המוכן
                string cachedHtml = System.IO.File.ReadAllText(cachePath);
                return Json(new { success = true, htmlContent = cachedHtml });
            }

            // המר את המייל ל-HTML
            string htmlContent = "";
            
            if (extension == ".msg")
            {
                htmlContent = ConvertMsgToHtml(fullPath);
            }
            else if (extension == ".eml")
            {
                htmlContent = ConvertEmlToHtml(fullPath);
            }

            if (string.IsNullOrEmpty(htmlContent))
            {
                return Json(new { success = false, error = "לא ניתן להמיר את המייל לתצוגה" });
            }

            // שמור את התוצאה במטמון לשימוש עתידי
            try
            {
                // וודא שתיקיית המטמון קיימת
                if (!Directory.Exists(_emailCachePath))
                {
                    Directory.CreateDirectory(_emailCachePath);
                }
                
                // שמור את ה-HTML במטמון
                System.IO.File.WriteAllText(cachePath, htmlContent);
            }
            catch (Exception ex)
            {
                // אם יש שגיאה בשמירה למטמון, רק רשום לוג ואל תפסיק את התהליך
                Console.WriteLine($"שגיאה בשמירה למטמון: {ex.Message}");
            }

            return Json(new { success = true, htmlContent = htmlContent });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in ConvertEmailToHtml: {ex.Message}");
            Console.WriteLine($"Stack trace: {ex.StackTrace}");
            return Json(new { success = false, error = $"Error: {ex.Message}" });
        }
    }

    // פונקציה משולבת לניקוי מטמון
    private void ManageCache(string specificEmailPath = null)
    {
        try
        {
            // 1. אם צוין נתיב ספציפי, מחק את המטמון שלו
            if (!string.IsNullOrEmpty(specificEmailPath))
            {
                DeleteSpecificEmailCache(specificEmailPath);
            }
            
            // 2. בדוק אם הגיע הזמן למחיקה מלאה (אחת ליום)
            if (DateTime.Now - _lastFullCacheCleanupTime > _fullCacheCleanupInterval)
            {
                CleanupOldCacheFiles();
                _lastFullCacheCleanupTime = DateTime.Now;
                _lastCacheCleanupTime = DateTime.Now; // אין צורך בניקוי רגיל אחרי ניקוי מלא
                return;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in ManageCache: {ex.Message}");
        }
    }

    // פונקציה למחיקת קבצי מטמון ישנים
    private void CleanupOldCacheFiles()
    {
        try
        {
            if (!Directory.Exists(_emailCachePath))
            {
                return;
            }

            Console.WriteLine($"Starting cache cleanup at {DateTime.Now}");

            var cacheFiles = Directory.GetFiles(_emailCachePath);
            int deletedCount = 0;
            
            foreach (var file in cacheFiles)
            {
                try
                {
                    var fileInfo = new FileInfo(file);
                    
                    // מחק קבצים שלא היה בהם שימוש יותר מ-12 שעות
                    if (DateTime.Now - fileInfo.LastAccessTime > _cacheFileMaxAge)
                    {
                        System.IO.File.Delete(file);
                        deletedCount++;
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error deleting cache file {file}: {ex.Message}");
                }
            }

            Console.WriteLine($"Cache cleanup completed. Deleted {deletedCount} old files.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in cache cleanup: {ex.Message}");
        }
    }
    
    // פונקציה למחיקת קובץ מטמון ספציפי
    private void DeleteSpecificEmailCache(string emailPath)
    {
        try
        {
            if (string.IsNullOrEmpty(emailPath) || !Directory.Exists(_emailCachePath))
            {
                return;
            }

            // המר נתיב יחסי לנתיב מוחלט
            string fullPath;
            if (Path.IsPathRooted(emailPath))
            {
                fullPath = emailPath;
            }
            else
            {
                fullPath = Path.Combine(_baseFilesPath, emailPath);
            }

            // נרמל את הנתיב
            fullPath = Path.GetFullPath(fullPath);
            
            if (!System.IO.File.Exists(fullPath))
            {
                return;
            }
            
            var extension = Path.GetExtension(fullPath).ToLowerInvariant();
            if (extension != ".msg" && extension != ".eml")
            {
                return;
            }
            
            // חפש את כל קבצי המטמון שמתאימים לקובץ המייל הזה
            var fileInfo = new FileInfo(fullPath);
            string fileNamePattern = $"{Path.GetFileNameWithoutExtension(fullPath)}_*{extension}.html";
            
            foreach (var cacheFile in Directory.GetFiles(_emailCachePath, fileNamePattern))
            {
                try
                {
                    System.IO.File.Delete(cacheFile);
                    Console.WriteLine($"Deleted specific cache file: {cacheFile}");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error deleting specific cache file {cacheFile}: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in DeleteSpecificEmailCache: {ex.Message}");
        }
    }

    // המרת קובץ MSG ל-HTML באמצעות Outlook COM Interop
    private string ConvertMsgToHtml(string msgFilePath)
    {
        dynamic outlookApp = null;
        dynamic msgItem = null;
        string tempHtmlPath = null;
        var htmlBuilder = new StringBuilder();
        
        try
        {
            // יצירת תיקייה זמנית לשמירת הקבצים
            string tempDir = Path.Combine(Path.GetTempPath(), "EmailViewer");
            Directory.CreateDirectory(tempDir);
            
            // נתיב לקובץ HTML זמני
            tempHtmlPath = Path.Combine(tempDir, $"{Guid.NewGuid()}.html");
            
            // נסה להשתמש ב-Outlook COM API
            Type outlookType = Type.GetTypeFromProgID("Outlook.Application");
            if (outlookType == null)
            {
                return "<div class='error-message'>Microsoft Outlook אינו מותקן על השרת</div>";
            }
            
            // יצירת אובייקט Outlook
            outlookApp = Activator.CreateInstance(outlookType);
            
            // פתיחת קובץ MSG
            msgItem = outlookApp.CreateItemFromTemplate(msgFilePath);
            
            // קריאת נושא המייל ישירות מה-COM object
            string subject = "";
            try {
                subject = msgItem.Subject;
            } catch {}
            
            // קריאת גוף המייל ישירות מה-COM object
            string body = "";
            try {
                body = msgItem.HTMLBody;
            } catch {}
            
            // קריאת פרטי השולח
            string sender = "";
            try {
                sender = msgItem.SenderName;
            } catch {}
            
            // קריאת פרטי הנמענים
            string recipients = "";
            try {
                dynamic recipientsObj = msgItem.Recipients;
                var recipientsList = new List<string>();
                
                for (int i = 1; i <= recipientsObj.Count; i++)
                {
                    dynamic recipient = recipientsObj[i];
                    recipientsList.Add(recipient.Name);
                }
                
                recipients = string.Join("; ", recipientsList);
            } catch {}
            
            // קריאת תאריך שליחה
            string sentDate = "";
            try {
                sentDate = msgItem.SentOn.ToString("dd/MM/yyyy HH:mm");
            } catch {}
            
            // אם הצלחנו לקרוא את הגוף ישירות, נשתמש בו
            if (!string.IsNullOrEmpty(body)) {
                // טיפול בתמונות מוטמעות
                body = HandleEmbeddedImages(body, msgItem);
                // יצירת HTML מותאם לתצוגה
                htmlBuilder.Append("<!DOCTYPE html>");
                htmlBuilder.Append("<html dir=\"rtl\">");
                htmlBuilder.Append("<head>");
                htmlBuilder.Append("<meta charset=\"UTF-8\">");
                htmlBuilder.Append("<meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\">");
                htmlBuilder.Append("<title>").Append(HttpUtility.HtmlEncode(subject)).Append("</title>");
                htmlBuilder.Append("<style>");
                htmlBuilder.Append("body { font-family: Arial, sans-serif; direction: rtl; }");
                htmlBuilder.Append("</style>");
                htmlBuilder.Append("</head>");
                htmlBuilder.Append("<body>");
                
                // הוספת כותרת המייל
                if (!string.IsNullOrEmpty(subject)) {
                    htmlBuilder.Append("<h2 style=\"color:#333; border-bottom:1px solid #ddd; padding-bottom:10px;\">");
                    htmlBuilder.Append(HttpUtility.HtmlEncode(subject));
                    htmlBuilder.Append("</h2>");
                }
                
                // הוספת פרטי השולח והנמענים
                htmlBuilder.Append("<div style=\"margin-bottom:15px;\">");
                if (!string.IsNullOrEmpty(sender)) {
                    htmlBuilder.Append("<strong>מאת:</strong> ").Append(HttpUtility.HtmlEncode(sender)).Append("<br>");
                }
                if (!string.IsNullOrEmpty(recipients)) {
                    htmlBuilder.Append("<strong>אל:</strong> ").Append(HttpUtility.HtmlEncode(recipients)).Append("<br>");
                }
                if (!string.IsNullOrEmpty(sentDate)) {
                    htmlBuilder.Append("<strong>תאריך:</strong> ").Append(sentDate).Append("<br>");
                }
                if (!string.IsNullOrEmpty(subject)) {
                    htmlBuilder.Append("<strong>נושא:</strong> ").Append(HttpUtility.HtmlEncode(subject));
                }
                htmlBuilder.Append("</div>");
                
                htmlBuilder.Append("<div class='email-content'>");
                htmlBuilder.Append(body); // הוספת גוף המייל כפי שהוא
                htmlBuilder.Append("</div>");
                
                // הוספת קבצים מצורפים אם יש
                try {
                    dynamic attachments = msgItem.Attachments;
                    if (attachments.Count > 0) {
                        htmlBuilder.Append("<div style=\"margin-top:20px; border-top:1px solid #ddd; padding-top:10px;\">");
                        htmlBuilder.Append("<h3>קבצים מצורפים:</h3>");
                        htmlBuilder.Append("<ul>");
                        
                        for (int i = 1; i <= attachments.Count; i++) {
                            dynamic attachment = attachments[i];
                            htmlBuilder.Append("<li>").Append(HttpUtility.HtmlEncode(attachment.FileName)).Append("</li>");
                        }
                        
                        htmlBuilder.Append("</ul>");
                        htmlBuilder.Append("</div>");
                    }
                } catch {}
                
                htmlBuilder.Append("</body>");
                htmlBuilder.Append("</html>");
                
                return htmlBuilder.ToString();
            }
            
            // אם לא הצלחנו לקרוא את הגוף ישירות, ננסה לשמור לקובץ HTML
            try {
                msgItem.SaveAs(tempHtmlPath, 5); // 5 = olHTML format
                
                // קריאת תוכן ה-HTML עם קידוד UTF-8 מפורש
                string htmlContent = "";
                
                // נסה קודם עם קידוד UTF-8
                try {
                    htmlContent = System.IO.File.ReadAllText(tempHtmlPath, Encoding.UTF8);
                } catch {
                    // אם נכשל, נסה עם קידודים אחרים
                    try {
                        htmlContent = System.IO.File.ReadAllText(tempHtmlPath, Encoding.GetEncoding(1255)); // Hebrew Windows
                    } catch {
                        try {
                            htmlContent = System.IO.File.ReadAllText(tempHtmlPath); // Default encoding
                        } catch (Exception ex) {
                            return $"<div class='error-message'>שגיאה בקריאת קובץ HTML: {ex.Message}</div>";
                        }
                    }
                }
                
                // יצירת HTML מותאם לתצוגה
                htmlBuilder.Clear();
                htmlBuilder.Append("<!DOCTYPE html>");
                htmlBuilder.Append("<html dir=\"rtl\">");
                htmlBuilder.Append("<head>");
                htmlBuilder.Append("<meta charset=\"UTF-8\">");
                htmlBuilder.Append("<meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\">");
                htmlBuilder.Append("<title>").Append(HttpUtility.HtmlEncode(subject)).Append("</title>");
                htmlBuilder.Append("<style>");
                htmlBuilder.Append("body { font-family: Arial, sans-serif; direction: rtl; }");
                htmlBuilder.Append("</style>");
                htmlBuilder.Append("</head>");
                htmlBuilder.Append("<body>");
                
                // הוספת כותרת המייל
                if (!string.IsNullOrEmpty(subject)) {
                    htmlBuilder.Append("<h2 style=\"color:#333; border-bottom:1px solid #ddd; padding-bottom:10px;\">");
                    htmlBuilder.Append(HttpUtility.HtmlEncode(subject));
                    htmlBuilder.Append("</h2>");
                }
                
                // הוספת פרטי השולח והנמענים
                htmlBuilder.Append("<div style=\"margin-bottom:15px;\">");
                if (!string.IsNullOrEmpty(sender)) {
                    htmlBuilder.Append("<strong>מאת:</strong> ").Append(HttpUtility.HtmlEncode(sender)).Append("<br>");
                }
                if (!string.IsNullOrEmpty(recipients)) {
                    htmlBuilder.Append("<strong>אל:</strong> ").Append(HttpUtility.HtmlEncode(recipients)).Append("<br>");
                }
                if (!string.IsNullOrEmpty(sentDate)) {
                    htmlBuilder.Append("<strong>תאריך:</strong> ").Append(sentDate).Append("<br>");
                }
                if (!string.IsNullOrEmpty(subject)) {
                    htmlBuilder.Append("<strong>נושא:</strong> ").Append(HttpUtility.HtmlEncode(subject));
                }
                htmlBuilder.Append("</div>");
                
                htmlBuilder.Append("<div class='email-content'>");
                htmlBuilder.Append(htmlContent);
                htmlBuilder.Append("</div>");
                htmlBuilder.Append("</body>");
                htmlBuilder.Append("</html>");
                
                return htmlBuilder.ToString();
            } catch (Exception ex) {
                // אם גם זה נכשל, ננסה לקרוא את הטקסט הפשוט
                try {
                    string plainText = msgItem.Body;
                    
                    htmlBuilder.Clear();
                    htmlBuilder.Append("<!DOCTYPE html>");
                    htmlBuilder.Append("<html dir=\"rtl\">");
                    htmlBuilder.Append("<head>");
                    htmlBuilder.Append("<meta charset=\"UTF-8\">");
                    htmlBuilder.Append("<title>").Append(HttpUtility.HtmlEncode(subject)).Append("</title>");
                    htmlBuilder.Append("<style>");
                    htmlBuilder.Append("body { font-family: Arial, sans-serif; direction: rtl; }");
                    htmlBuilder.Append("</style>");
                    htmlBuilder.Append("</head>");
                    htmlBuilder.Append("<body>");
                    
                    // הוספת כותרת המייל
                    if (!string.IsNullOrEmpty(subject)) {
                        htmlBuilder.Append("<h2 style=\"color:#333; border-bottom:1px solid #ddd; padding-bottom:10px;\">");
                        htmlBuilder.Append(HttpUtility.HtmlEncode(subject));
                        htmlBuilder.Append("</h2>");
                    }
                    
                    // הוספת פרטי השולח והנמענים
                    htmlBuilder.Append("<div style=\"margin-bottom:15px;\">");
                    if (!string.IsNullOrEmpty(sender)) {
                        htmlBuilder.Append("<strong>מאת:</strong> ").Append(HttpUtility.HtmlEncode(sender)).Append("<br>");
                    }
                    if (!string.IsNullOrEmpty(recipients)) {
                        htmlBuilder.Append("<strong>אל:</strong> ").Append(HttpUtility.HtmlEncode(recipients)).Append("<br>");
                    }
                    if (!string.IsNullOrEmpty(sentDate)) {
                        htmlBuilder.Append("<strong>תאריך:</strong> ").Append(sentDate).Append("<br>");
                    }
                    if (!string.IsNullOrEmpty(subject)) {
                        htmlBuilder.Append("<strong>נושא:</strong> ").Append(HttpUtility.HtmlEncode(subject));
                    }
                    htmlBuilder.Append("</div>");
                    
                    htmlBuilder.Append("<pre style=\"white-space: pre-wrap; font-family: Arial, sans-serif;\">");
                    htmlBuilder.Append(HttpUtility.HtmlEncode(plainText));
                    htmlBuilder.Append("</pre>");
                    htmlBuilder.Append("</body>");
                    htmlBuilder.Append("</html>");
                    
                    return htmlBuilder.ToString();
                } catch {
                    // אם כל הניסיונות נכשלו, החזר הודעת שגיאה
                    return $"<div class='error-message'>שגיאה בהמרת המייל: {ex.Message}<br/>" +
                        $"<a href='/Messages/DownloadFile?filePath={HttpUtility.UrlEncode(msgFilePath)}' class='btn btn-primary'>הורד את קובץ המייל המקורי</a></div>";
                }
            }
        }
        catch (Exception ex)
        {
            return $"<div class='error-message'>שגיאה בהמרת המייל: {ex.Message}<br/>" +
                $"<a href='/Messages/DownloadFile?filePath={HttpUtility.UrlEncode(msgFilePath)}' class='btn btn-primary'>הורד את קובץ המייל המקורי</a></div>";
        }
        finally
        {
            // ניקוי משאבים
            try
            {
                if (msgItem != null)
                {
                    Marshal.ReleaseComObject(msgItem);
                }
                
                if (outlookApp != null)
                {
                    outlookApp.Quit();
                    Marshal.ReleaseComObject(outlookApp);
                }
                
                // מחיקת קבצים זמניים
                if (tempHtmlPath != null && System.IO.File.Exists(tempHtmlPath))
                {
                    try { System.IO.File.Delete(tempHtmlPath); } catch { }
                }
            }
            catch { }
            
            GC.Collect();
            GC.WaitForPendingFinalizers();
        }
    }

    // פונקציה חדשה לטיפול בתמונות מוטמעות
    private string HandleEmbeddedImages(string htmlBody, dynamic msgItem)
    {
        try
        {
            // בדוק אם יש קבצים מצורפים
            dynamic attachments = msgItem.Attachments;
            if (attachments.Count == 0)
                return htmlBody;
                
            // מילון לשמירת מיפוי בין ContentID לקובץ מצורף
            Dictionary<string, dynamic> cidMap = new Dictionary<string, dynamic>(StringComparer.OrdinalIgnoreCase);
            
            // עבור על כל הקבצים המצורפים וחפש ContentID
            for (int i = 1; i <= attachments.Count; i++)
            {
                dynamic attachment = attachments[i];
                try
                {
                    string contentId = attachment.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001E");
                    if (!string.IsNullOrEmpty(contentId))
                    {
                        // הסר סוגריים זוויתיים אם יש
                        contentId = contentId.Trim('<', '>');
                        cidMap[contentId] = attachment;
                    }
                }
                catch { }
            }
            
            // אם אין תמונות מוטמעות, החזר את ה-HTML כמו שהוא
            if (cidMap.Count == 0)
                return htmlBody;
                
            // החלף את כל ה-CID בתגיות img עם נתוני base64
            return System.Text.RegularExpressions.Regex.Replace(
                htmlBody,
                @"<img[^>]*src=[""']cid:([^""']+)[""'][^>]*>",
                match => {
                    string cid = match.Groups[1].Value;
                    if (cidMap.TryGetValue(cid, out dynamic attachment))
                    {
                        try
                        {
                            // שמור את הקובץ המצורף זמנית
                            string tempDir = Path.Combine(Path.GetTempPath(), "EmailImages");
                            Directory.CreateDirectory(tempDir);
                            string tempFile = Path.Combine(tempDir, attachment.FileName);
                            attachment.SaveAsFile(tempFile);
                            
                            // קרא את הקובץ והמר ל-base64
                            byte[] fileBytes = System.IO.File.ReadAllBytes(tempFile);
                            string base64 = Convert.ToBase64String(fileBytes);
                            string mimeType = GetImageMimeType(tempFile);
                            
                            // נקה את הקובץ הזמני
                            try { System.IO.File.Delete(tempFile); } catch { }
                            
                            // החזר את התג עם נתוני התמונה מוטמעים
                            return match.Value.Replace($"cid:{cid}", $"data:{mimeType};base64,{base64}");
                        }
                        catch
                        {
                            return match.Value; // אם נכשל, השאר את התג המקורי
                        }
                    }
                    return match.Value;
                },
                System.Text.RegularExpressions.RegexOptions.IgnoreCase
            );
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error handling embedded images: {ex.Message}");
            return htmlBody; // במקרה של שגיאה, החזר את ה-HTML המקורי
        }
    }

    private Encoding DetectEncoding(string filePath)
    {
        using (var reader = new StreamReader(filePath, Encoding.ASCII, true))
        {
            // קריאת מספר תווים לזיהוי הקידוד
            char[] buffer = new char[1024];
            reader.Read(buffer, 0, buffer.Length);
            
            // החזרת הקידוד שזוהה
            return reader.CurrentEncoding;
        }
    }

    // פונקציה להסרת חתימות מייל נפוצות
    private string RemoveEmailSignatures(string htmlContent)
    {
        try
        {
            // הסרת חתימות המסומנות בתגיות סטנדרטיות
            string[] signaturePatterns = new string[] 
            {
                @"<div\s+[^>]*class\s*=\s*[""']signature[""'][^>]*>.*?</div>",
                @"<div\s+[^>]*id\s*=\s*[""']signature[""'][^>]*>.*?</div>",
                @"<div\s+[^>]*class\s*=\s*[""'].*?sign.*?[""'][^>]*>.*?</div>",
                @"<!-- Signature -->.*?<!-- End Signature -->",
                @"<hr[^>]*>.*?<span[^>]*>.*?[Ss]ent from.*?</span>",
                @"<hr[^>]*>.*?[Ss]ent from my iPhone",
                @"<hr[^>]*>.*?[Ss]ent from my iPad",
                @"<hr[^>]*>.*?[Ss]ent from my Android",
                @"<hr[^>]*>.*?[Ss]ent from Outlook",
                @"<hr[^>]*>.*?[Ss]ent from Yahoo Mail",
                @"<hr[^>]*>.*?[Ss]ent from Gmail",
                @"<hr[^>]*>.*?[Ss]ent from Windows Mail",
                @"<div[^>]*>.*?[Ss]ent from.*?</div>"
            };

            // הסרת כל אחד מהדפוסים
            foreach (var pattern in signaturePatterns)
            {
                htmlContent = System.Text.RegularExpressions.Regex.Replace(
                    htmlContent,
                    pattern,
                    "",
                    System.Text.RegularExpressions.RegexOptions.Singleline | 
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase
                );
            }

            // הסרת חתימות עם קווים אופקיים (נפוץ במיילים)
            htmlContent = System.Text.RegularExpressions.Regex.Replace(
                htmlContent,
                @"<hr[^>]*>(?:(?!</body>).)*$",
                "",
                System.Text.RegularExpressions.RegexOptions.Singleline | 
                System.Text.RegularExpressions.RegexOptions.IgnoreCase
            );

            // הסרת חתימות בעברית
            string[] hebrewSignatureMarkers = new string[] 
            {
                "בברכה,",
                "בכבוד רב,",
                "בתודה,",
                "בהערכה,",
                "בהצלחה,"
            };

            foreach (var marker in hebrewSignatureMarkers)
            {
                int index = htmlContent.IndexOf(marker);
                if (index > 0)
                {
                    // חתוך את התוכן מהמקום שבו מתחילה החתימה
                    int endBodyIndex = htmlContent.IndexOf("</body>", index);
                    if (endBodyIndex > index)
                    {
                        htmlContent = htmlContent.Substring(0, index) + htmlContent.Substring(endBodyIndex);
                    }
                }
            }

            return htmlContent;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error removing signatures: {ex.Message}");
            return htmlContent; // במקרה של שגיאה, החזר את התוכן המקורי
        }
    }
    
    // המרת קובץ EML ל-HTML
    private string ConvertEmlToHtml(string emlFilePath)
    {
        try
        {
            // זיהוי קידוד אוטומטי
            Encoding detectedEncoding = DetectEncoding(emlFilePath);
            
            // קריאת תוכן ה-EML עם הקידוד שזוהה
            string emlContent = System.IO.File.ReadAllText(emlFilePath, detectedEncoding);
            
            // חילוץ נושא המייל
            string subject = "";
            var subjectMatch = System.Text.RegularExpressions.Regex.Match(emlContent, @"Subject:\s*([^\r\n]+)");
            if (subjectMatch.Success)
            {
                subject = subjectMatch.Groups[1].Value.Trim();
                
                // פענוח נושא מקודד ב-base64 (נפוץ בעברית)
                if (subject.StartsWith("=?UTF-8?B?"))
                {
                    try
                    {
                        // חילוץ החלק המקודד ב-base64
                        var base64Part = subject.Replace("=?UTF-8?B?", "").Replace("?=", "");
                        var decodedBytes = Convert.FromBase64String(base64Part);
                        subject = Encoding.UTF8.GetString(decodedBytes);
                    }
                    catch {}
                }
            }
            
            // חילוץ חלק ה-HTML מה-EML
            int htmlStartIndex = emlContent.IndexOf("<html", StringComparison.OrdinalIgnoreCase);
            int htmlEndIndex = emlContent.LastIndexOf("</html>", StringComparison.OrdinalIgnoreCase);
            
            if (htmlStartIndex >= 0 && htmlEndIndex >= 0)
            {
                string htmlContent = emlContent.Substring(htmlStartIndex, htmlEndIndex - htmlStartIndex + 7);
                
                // טיפול בתמונות מוטמעות ב-EML
                htmlContent = HandleEmlEmbeddedImages(emlContent, htmlContent);
            
                // הוספת כותרת המייל לתוכן ה-HTML
                if (!string.IsNullOrEmpty(subject))
                {
                    htmlContent = htmlContent.Replace("<body", 
                        $"<body><h2 style=\"color:#333; border-bottom:1px solid #ddd; padding-bottom:10px;\">{HttpUtility.HtmlEncode(subject)}</h2>");
                }
                
                return htmlContent;
            }
            
            // אם אין חלק HTML, הצג את התוכן כטקסט פשוט
            var htmlBuilder = new StringBuilder();
            htmlBuilder.Append("<!DOCTYPE html>");
            htmlBuilder.Append("<html dir=\"rtl\">");
            htmlBuilder.Append("<head>");
            htmlBuilder.Append("<meta charset=\"UTF-8\">");
            htmlBuilder.Append("<meta http-equiv=\"Content-Type\" content=\"text/html; charset=UTF-8\">");
            htmlBuilder.Append("<title>").Append(HttpUtility.HtmlEncode(subject)).Append("</title>");
            htmlBuilder.Append("</head>");
            htmlBuilder.Append("<body>");
            
            // הוספת כותרת המייל
            if (!string.IsNullOrEmpty(subject)) {
                htmlBuilder.Append("<h2 style=\"color:#333; border-bottom:1px solid #ddd; padding-bottom:10px;\">");
                htmlBuilder.Append(HttpUtility.HtmlEncode(subject));
                htmlBuilder.Append("</h2>");
            }
            
            htmlBuilder.Append("<pre style=\"font-family: Arial, sans-serif; direction: rtl;\">");
            htmlBuilder.Append(HttpUtility.HtmlEncode(emlContent));
            htmlBuilder.Append("</pre>");
            htmlBuilder.Append("</body>");
            htmlBuilder.Append("</html>");
            
            return htmlBuilder.ToString();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error converting EML to HTML: {ex.Message}");
            return $"<div class='error-message'>שגיאה בהמרת המייל: {ex.Message}</div>";
        }
    }

    // פונקציה חדשה לטיפול בתמונות מוטמעות ב-EML
    private string HandleEmlEmbeddedImages(string fullEmlContent, string htmlContent)
    {
        try
        {
            // חיפוש גבולות בין חלקי המייל
            var boundaryMatch = System.Text.RegularExpressions.Regex.Match(fullEmlContent, @"boundary=""([^""]+)""");
            if (!boundaryMatch.Success)
                return htmlContent;
                
            string boundary = boundaryMatch.Groups[1].Value;
            
            // פיצול המייל לחלקים לפי הגבול
            string[] parts = fullEmlContent.Split(new[] { "--" + boundary }, StringSplitOptions.None);
            
            // מילון למיפוי בין ContentID לתוכן התמונה
            Dictionary<string, string> cidMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            
            // עבור על כל חלק ומצא תמונות מוטמעות
            foreach (var part in parts)
            {
                // בדוק אם זה חלק עם תמונה
                if (part.Contains("Content-Type: image/") && part.Contains("Content-ID:"))
                {
                    // חלץ את ה-Content-ID
                    var cidMatch = System.Text.RegularExpressions.Regex.Match(part, @"Content-ID:\s*<([^>]+)>");
                    if (!cidMatch.Success)
                        continue;
                        
                    string cid = cidMatch.Groups[1].Value;
                    
                    // חלץ את סוג התמונה
                    var typeMatch = System.Text.RegularExpressions.Regex.Match(part, @"Content-Type:\s*image/([^;\s]+)");
                    if (!typeMatch.Success)
                        continue;
                        
                    string imageType = typeMatch.Groups[1].Value;
                    
                    // חלץ את תוכן התמונה (base64)
                    int dataStartIndex = part.IndexOf("\r\n\r\n");
                    if (dataStartIndex < 0)
                        continue;
                        
                    string base64Data = part.Substring(dataStartIndex).Trim();
                    
                    // שמור במילון
                    cidMap[cid] = $"data:image/{imageType};base64,{base64Data}";
                }
            }
            
            // החלף את כל ה-CID בתגיות img עם נתוני base64
            return System.Text.RegularExpressions.Regex.Replace(
                htmlContent,
                @"<img[^>]*src=[""']cid:([^""']+)[""'][^>]*>",
                match => {
                    string cid = match.Groups[1].Value;
                    if (cidMap.TryGetValue(cid, out string base64Data))
                    {
                        return match.Value.Replace($"cid:{cid}", base64Data);
                    }
                    return match.Value;
                },
                System.Text.RegularExpressions.RegexOptions.IgnoreCase
            );
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error handling EML embedded images: {ex.Message}");
            return htmlContent; // במקרה של שגיאה, החזר את ה-HTML המקורי
        }
    }

    // תיקון נתיבים יחסיים בתוכן ה-HTML
    private string FixHtmlImagePaths(string htmlContent, string htmlFilePath)
    {
        try
        {
            string baseDir = Path.GetDirectoryName(htmlFilePath);
            
            // החלף נתיבים יחסיים בתגיות img
            htmlContent = System.Text.RegularExpressions.Regex.Replace(
                htmlContent,
                @"<img\s+[^>]*src\s*=\s*[""'](?!https?:\/\/)([^""']+)[""'][^>]*>",
                match => {
                    string imgSrc = match.Groups[1].Value;
                    string fullPath = Path.Combine(baseDir, imgSrc);
                    
                    if (System.IO.File.Exists(fullPath))
                    {
                        // המר את התמונה ל-base64
                        byte[] imageBytes = System.IO.File.ReadAllBytes(fullPath);
                        string base64 = Convert.ToBase64String(imageBytes);
                        string mimeType = GetImageMimeType(fullPath);
                        
                        return match.Value.Replace(imgSrc, $"data:{mimeType};base64,{base64}");
                    }
                    
                    return match.Value;
                },
                System.Text.RegularExpressions.RegexOptions.IgnoreCase
            );
            
            return htmlContent;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error fixing HTML paths: {ex.Message}");
            return htmlContent;
        }
    }

    // קבלת סוג MIME לתמונה
    private string GetImageMimeType(string imagePath)
    {
        string extension = Path.GetExtension(imagePath).ToLowerInvariant();
        
        switch (extension)
        {
            case ".jpg":
            case ".jpeg":
                return "image/jpeg";
            case ".png":
                return "image/png";
            case ".gif":
                return "image/gif";
            case ".bmp":
                return "image/bmp";
            default:
                return "application/octet-stream";
        }
    }

    [HttpGet]
    public IActionResult GetPendingAlarms()
    {
        try
        {
            if (!System.IO.File.Exists(_messagesFilePath))
            {
                return Json(new { success = true, alarms = new List<object>(), currentTime = DateTime.Now.ToString("HH:mm:ss") });
            }

            var now = DateTime.Now;
            var pendingAlarms = new List<object>();

            var lines = System.IO.File.ReadAllLines(_messagesFilePath);
            int totalJobsChecked = 0;

            foreach (var line in lines)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                try
                {
                    var messageElement = JsonSerializer.Deserialize<JsonElement>(line);
                    
                    // בדוק אם זו הודעת ביצוע
                    if (!messageElement.TryGetProperty("category", out var categoryProp) || 
                        categoryProp.GetString() != "בקשות וביצוע")
                    {
                        continue;
                    }

                    // קרא פרטי ההודעה
                    string messageId = messageElement.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                    string messageTitle = messageElement.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : "";
                    
                    // בדוק את תאריך היעד
                    string dueDate = messageElement.TryGetProperty("dueDate", out var dueDateProp) ? dueDateProp.GetString() : null;
                    
                    // אם יש תאריך יעד, בדוק שהוא היום
                    if (!string.IsNullOrEmpty(dueDate))
                    {
                        DateTime targetDate;
                        
                        // טיפול בפורמטים שונים של תאריך
                        if (dueDate.Contains('/'))
                        {
                            // פורמט DD/MM/YYYY
                            string[] dateParts = dueDate.Split('/');
                            if (dateParts.Length == 3)
                            {
                                targetDate = new DateTime(
                                    int.Parse(dateParts[2]), 
                                    int.Parse(dateParts[1]), 
                                    int.Parse(dateParts[0])
                                );
                            }
                            else
                            {
                                continue; // פורמט לא תקין
                            }
                        }
                        else
                        {
                            // פורמט YYYY-MM-DD
                            targetDate = DateTime.Parse(dueDate);
                        }
                        
                        // השווה רק את התאריך (ללא שעה)
                        if (targetDate.Date != now.Date)
                        {
                            continue; // דלג על הודעות שתאריך היעד שלהן אינו היום
                        }
                    }

                    // בדוק אם יש ג'ובים
                    if (!messageElement.TryGetProperty("jobs", out var jobsProp) || 
                        jobsProp.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    int jobIndex = 0;
                    foreach (var jobElement in jobsProp.EnumerateArray())
                    {
                        totalJobsChecked++;

                        // קרא את כל השדות של הג'וב ישירות מה-JSON
                        string jobName = jobElement.TryGetProperty("JobName", out var jobNameProp) ? jobNameProp.GetString() : "";
                        bool isCompleted = jobElement.TryGetProperty("IsCompleted", out var completedProp) && completedProp.GetBoolean();
                        bool hasAlarm = jobElement.TryGetProperty("HasAlarm", out var hasAlarmProp) && hasAlarmProp.GetBoolean();
                        string executionTime = jobElement.TryGetProperty("ExecutionTime", out var execTimeProp) ? execTimeProp.GetString() : null;
                        string responsible = jobElement.TryGetProperty("Responsible", out var respProp) ? respProp.GetString() : null;

                        // בדוק אם יש שעון מעורר ושעת ביצוע
                        if (hasAlarm && !string.IsNullOrEmpty(executionTime) && !isCompleted)
                        {
                            
                            // פרסר את השעה
                            if (TimeSpan.TryParse(executionTime, out TimeSpan executionTimeSpan))
                            {
                                
                                // בנה את זמן היעד עם התאריך והשעה הנוכחיים
                                var targetTime = new DateTime(
                                    now.Year, 
                                    now.Month, 
                                    now.Day, 
                                    executionTimeSpan.Hours, 
                                    executionTimeSpan.Minutes, 
                                    0
                                );
                                
                                // חשב את ההפרש בדקות
                                var timeDiff = (targetTime - now).TotalMinutes;
                                
                                // התרעה אם השעה הגיעה (עד 5 דקות לפני ועד 5 דקות אחרי)
                                if (timeDiff >= -5 && timeDiff <= 5)
                                {
                                    
                                    pendingAlarms.Add(new
                                    {
                                        messageId = messageId,
                                        jobIndex = jobIndex,
                                        jobName = jobName,
                                        executionTime = executionTime,
                                        messageTitle = messageTitle,
                                        responsible = responsible,
                                        timeDiff = Math.Round(timeDiff, 1)
                                    });
                                }
                            }
                        }

                        jobIndex++;
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error parsing message line: {ex.Message}");
                }
            }

            return Json(new { 
                success = true, 
                alarms = pendingAlarms, 
                currentTime = now.ToString("HH:mm:ss"),
                totalChecked = totalJobsChecked
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in GetPendingAlarms: {ex.Message}");
            Console.WriteLine($"Stack trace: {ex.StackTrace}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetUC4DailyReport()
    {
        try
        {
            // 1. מצא קבצי דוח - סנן קבצי נעילה (~$)
            if (!Directory.Exists(_dailyReportsPath))
                return Json(new { success = false, error = "תיקיית הדוחות לא נמצאה" });

            var reportFiles = Directory.GetFiles(_dailyReportsPath, "*.xlsx")
                .Concat(Directory.GetFiles(_dailyReportsPath, "*.xls"))
                .Concat(Directory.GetFiles(_dailyReportsPath, "*.csv"))
                .Where(f => !Path.GetFileName(f).StartsWith("~$")) // ← סנן קבצי נעילה
                .Where(f => !Path.GetFileName(f).StartsWith("."))   // ← סנן קבצים נסתרים
                .OrderByDescending(f => System.IO.File.GetLastWriteTime(f))
                .ToList();

            if (!reportFiles.Any())
                return Json(new { success = false, error = "לא נמצאו קבצי דוח" });

            var latestReportFile = reportFiles.First();

            // *** בדיקה שהקובץ הוא מהיום ***
            var fileDate = System.IO.File.GetLastWriteTime(latestReportFile).Date;
            var today = DateTime.Now.Date;

            if (fileDate < today)
            {
                return Json(new
                {
                    success = false,
                    error = $"קובץ הדוח האחרון הוא מתאריך " +
                            $"{fileDate:dd/MM/yyyy} ולא מהיום ({today:dd/MM/yyyy}). " +
                            $"יש לוודא שהדוח עודכן היום.",
                    fileDate = fileDate.ToString("dd/MM/yyyy"),
                    today = today.ToString("dd/MM/yyyy")
                });
            }

            // 2. מצא קבצי אנשי קשר - סנן קבצי נעילה (~$)
            if (!Directory.Exists(_jobsContactsPath))
                return Json(new { success = false, error = "תיקיית אנשי הקשר לא נמצאה" });

            var contactFiles = Directory.GetFiles(_jobsContactsPath, "*.xlsx")
                .Concat(Directory.GetFiles(_jobsContactsPath, "*.xls"))
                .Concat(Directory.GetFiles(_jobsContactsPath, "*.csv"))
                .Where(f => !Path.GetFileName(f).StartsWith("~$")) // ← סנן קבצי נעילה
                .Where(f => !Path.GetFileName(f).StartsWith("."))   // ← סנן קבצים נסתרים
                .OrderByDescending(f => System.IO.File.GetLastWriteTime(f))
                .ToList();

            if (!contactFiles.Any())
                return Json(new { success = false, error = "לא נמצאו קבצי אנשי קשר" });

            var latestContactFile = contactFiles.First();

            // 3. קרא את קובץ הדוח
            var failedJobsData = await ParseFailedJobsReport(latestReportFile);
            
            // 4. קרא את קובץ אנשי הקשר
            var contactsData = await ParseContactsFile(latestContactFile);

            // 5. בנה את הטבלה המאוחדת
            var result = await BuildJobsContactsTableAsync(failedJobsData, contactsData);

            return Json(new { 
                success = true, 
                data = result,
                reportFile = Path.GetFileName(latestReportFile),
                contactFile = Path.GetFileName(latestContactFile),
                generatedAt = DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss")
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in GetUC4DailyReport: {ex.Message}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetPermanentAccessList()
    {
        try
        {
            if (!System.IO.File.Exists(_permanentAccessListPath))
            {
                // החזר רשימה ריקה אם הקובץ לא קיים
                return Json(new { success = true, persons = new List<object>() });
            }

            var json = System.IO.File.ReadAllText(_permanentAccessListPath, 
                Encoding.UTF8);
            var persons = JsonSerializer.Deserialize<List<PermanentAccessPerson>>(json);
            
            return Json(new { success = true, persons = persons });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult SavePermanentAccessList(
        [FromBody] SavePermanentAccessRequest request)
    {
        try
        {
            if (request?.Persons == null)
                return Json(new { success = false, error = "נתונים חסרים" });

            var directory = Path.GetDirectoryName(_permanentAccessListPath);
            if (!Directory.Exists(directory))
                Directory.CreateDirectory(directory);

            var json = JsonSerializer.Serialize(request.Persons, 
                new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(_permanentAccessListPath, json, 
                Encoding.UTF8);

            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpDelete]
    public IActionResult DeletePermanentAccessPerson(string id)
    {
        try
        {
            if (!System.IO.File.Exists(_permanentAccessListPath))
                return Json(new { success = false, error = "הרשימה לא קיימת" });

            var json = System.IO.File.ReadAllText(_permanentAccessListPath, 
                Encoding.UTF8);
            var persons = JsonSerializer.Deserialize<List<PermanentAccessPerson>>(json);
            
            var personToRemove = persons?.FirstOrDefault(p => p.Id == id);
            if (personToRemove == null)
                return Json(new { success = false, error = "האדם לא נמצא" });

            persons.Remove(personToRemove);

            var updatedJson = JsonSerializer.Serialize(persons, 
                new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(_permanentAccessListPath, updatedJson, 
                Encoding.UTF8);

            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> ParseExcelForPermanentAccess(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return Json(new { success = false, error = "לא נבחר קובץ" });

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            var allowedExtensions = new[] { ".xls", ".xlsx", ".csv" };

            if (!allowedExtensions.Contains(extension))
                return Json(new { success = false, error = "סוג קובץ לא נתמך. יש להעלות XLS, XLSX או CSV" });

            List<List<string>> data;

            if (extension == ".csv")
            {
                var tempPath = Path.GetTempFileName();
                using (var stream = new FileStream(tempPath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                var result = await ParseCsvFile(tempPath);
                data = result.data as List<List<string>>;

                try { System.IO.File.Delete(tempPath); } catch { }
            }
            else
            {
                var tempPath = Path.GetTempFileName() + extension;
                using (var stream = new FileStream(tempPath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                try
                {
                    data = await ParseExcelToList(tempPath);
                }
                finally
                {
                    try { System.IO.File.Delete(tempPath); } catch { }
                }
            }

            if (data == null || data.Count == 0)
                return Json(new { success = false, error = "הקובץ ריק" });

            // *** חדש: זיהוי פורמט רשימת שמות (עמודה אחת) ***
            var detectedFormat = DetectExcelFormat(data);
            
            if (detectedFormat == "name_list")
            {
                // המר לפורמט טבלאי סטנדרטי
                data = ConvertNameListToTableFormat(data);
            }

            return Json(new { success = true, data, detectedFormat });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error in ParseExcelForPermanentAccess: {ex.Message}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> SendEntryPermitEmail(
        [FromBody] EntryPermitEmailRequest request)
    {
        try
        {
            if (request == null ||
                string.IsNullOrEmpty(request.Subject) ||
                request.ToAddresses == null ||
                !request.ToAddresses.Any())
            {
                return Json(new { success = false, error = "נתונים חסרים" });
            }

            // *** שימוש בפונקציה הסטטית המשותפת ***
            await Task.Run(() => SendPermitEmailSmtp(
                subject:     request.Subject,
                body:        request.Body,
                toAddresses: request.ToAddresses,
                ccAddresses: request.CcAddresses ?? new List<string>()
            ));

            Console.WriteLine(
                $"Entry permit email sent to: " +
                $"{string.Join(", ", request.ToAddresses)}");

            return Json(new { success = true });
        }
        catch (System.Net.Mail.SmtpException ex)
        {
            Console.WriteLine($"SMTP Error: {ex.Message}");
            return Json(new { success = false, error = $"שגיאת שרת מייל: {ex.Message}" });
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error sending entry permit email: {ex.Message}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    private string BuildEntryPermitHtmlEmail(string plainBody)
    {
        if (string.IsNullOrEmpty(plainBody))
            return "<html><body></body></html>";

        var lines = plainBody.Split('\n');
        var htmlLines = new System.Text.StringBuilder();

        foreach (var line in lines)
        {
            var trimmed = line.TrimEnd('\r').Trim();

            if (string.IsNullOrEmpty(trimmed))
            {
                htmlLines.Append(
                    "<div style=\"height:10px;line-height:10px;\">&nbsp;</div>");
                continue;
            }

            // שורות עם נקודותיים - שדות נתונים
            if (trimmed.Contains(':'))
            {
                int colonIdx = trimmed.IndexOf(':');
                string label = trimmed.Substring(0, colonIdx).Trim();
                string value = trimmed.Substring(colonIdx + 1).Trim();

                var knownLabels = new[]
                {
                    "שם", "שמות", "חברה", "מס' רכב",
                    "ת.ז.", "מלווה", "טלפון"
                };

                bool isKnown = knownLabels.Any(l =>
                    label.Trim() == l);

                if (isKnown)
                {
                    htmlLines.Append($@"
    <div style=""padding:4px 0;line-height:1.6;"">
    <span style=""font-weight:bold;color:#444;
                display:inline-block;min-width:90px;"">
        {System.Net.WebUtility.HtmlEncode(label)}:
    </span>
    <span style=""color:#222;margin-right:8px;"">
        {System.Net.WebUtility.HtmlEncode(value)}
    </span>
    </div>");
                    continue;
                }
            }

            // שורה רגילה
            htmlLines.Append($@"
    <div style=""padding:4px 0;color:#333;line-height:1.6;"">
    {System.Net.WebUtility.HtmlEncode(trimmed)}
    </div>");
        }

        return $@"<!DOCTYPE html>
    <html dir=""rtl"" lang=""he"">
    <head>
    <meta charset=""UTF-8"">
    <meta http-equiv=""Content-Type"" content=""text/html; charset=UTF-8"">
    </head>
    <body style=""margin:0;padding:25px 30px;
                font-family:Arial,sans-serif;
                direction:rtl;font-size:14px;
                color:#333;line-height:1.8;
                background:#ffffff;"">
    <div style=""max-width:600px;"">
        {htmlLines}
    </div>
    </body>
    </html>";
    }

    // *** חדש: זיהוי פורמט הקובץ ***
    private string DetectExcelFormat(List<List<string>> data)
    {
        if (data == null || data.Count == 0) return "unknown";

        // בדוק אם זה פורמט רשימת שמות:
        // - עמודה אחת בעיקר
        // - מכיל שורת כותרת עם "מורשי כניסה" או דומה
        // - שמות בפורמט "שם משפחה, שם פרטי"
        
        int singleColumnRows = 0;
        int nameFormatRows = 0;
        bool hasAccessHeader = false;

        foreach (var row in data)
        {
            // בדוק שורות עם תוכן בעמודה הראשונה בלבד
            var nonEmptyCells = row.Count(c => !string.IsNullOrWhiteSpace(c));
            
            if (nonEmptyCells <= 1)
            {
                singleColumnRows++;
                
                var cellValue = row.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c)) ?? "";
                
                // בדוק אם זה כותרת של רשימת גישה
                if (cellValue.Contains("מורשי כניסה") || 
                    cellValue.Contains("Access Level") ||
                    cellValue.Contains("Cardholder"))
                {
                    hasAccessHeader = true;
                }
                
                // בדוק אם זה שם בפורמט "שם משפחה, שם פרטי"
                if (cellValue.Contains(",") && 
                    !cellValue.Contains("@") && 
                    !cellValue.Contains("=") &&
                    cellValue.Length < 60)
                {
                    nameFormatRows++;
                }
            }
        }

        // אם רוב השורות הן עמודה אחת ויש שמות בפורמט הנכון
        double singleColRatio = (double)singleColumnRows / data.Count;
        
        if ((hasAccessHeader || singleColRatio > 0.7) && nameFormatRows > 2)
        {
            return "name_list";
        }

        return "standard_table";
    }

    // *** חדש: המרת רשימת שמות לפורמט טבלאי ***
    private List<List<string>> ConvertNameListToTableFormat(List<List<string>> data)
    {
        var result = new List<List<string>>();
        
        // הוסף שורת כותרות
        result.Add(new List<string> 
        { 
            "שם מלא", 
            "חברה", 
            "אתרים מורשים",
            "מס' רכב",
            "ת\"ז",
            "טלפון",
            "הערות"
        });

        // זיהוי שם הארגון/מבנה מהכותרת
        string organization = "";
        string building = "";
        
        foreach (var row in data)
        {
            var cellValue = row.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c))?.Trim() ?? "";
            
            if (string.IsNullOrWhiteSpace(cellValue)) continue;
            
            // דלג על שורות מיוחדות
            if (cellValue.StartsWith("===") || 
                cellValue.StartsWith("---") ||
                cellValue.Contains("Access Level") ||
                cellValue.Contains("Cardholder Report"))
                continue;
            
            // זיהוי שם הארגון/מבנה
            if (cellValue.Contains("מורשי כניסה") || 
                cellValue.Contains("חדר מחשב") ||
                cellValue.Contains("מבנה"))
            {
                organization = cellValue;
                
                // חלץ שם מבנה
                if (cellValue.Contains("מבנה"))
                {
                    building = cellValue;
                }
                continue;
            }
            
            // בדוק אם זה שם בפורמט "שם משפחה, שם פרטי"
            if (cellValue.Contains(","))
            {
                string fullName = ParseHebrewName(cellValue);
                
                if (!string.IsNullOrEmpty(fullName))
                {
                    // קבע אתרים מורשים - ברירת מחדל: שני האתרים
                    string allowedSites = DetermineAllowedSites(organization, building);
                    
                    result.Add(new List<string>
                    {
                        fullName,           // שם מלא
                        "",                 // חברה (ריק - יש למלא ידנית)
                        allowedSites,       // אתרים מורשים
                        "",                 // מס' רכב
                        "",                 // ת"ז
                        "",                 // טלפון
                        organization        // הערות - שם הארגון המקורי
                    });
                }
            }
        }

        return result;
    }

    // *** חדש: פרסור שם עברי מפורמט "שם משפחה, שם פרטי" ***
    private string ParseHebrewName(string nameString)
    {
        if (string.IsNullOrWhiteSpace(nameString)) return "";
        
        nameString = nameString.Trim();
        
        // פורמט: "שם משפחה, שם פרטי"
        var parts = nameString.Split(',');
        
        if (parts.Length >= 2)
        {
            string lastName = parts[0].Trim();
            string firstName = parts[1].Trim();
            
            // וודא שזה שם עברי תקין (לא מספרים, לא תווים מיוחדים)
            if (IsValidHebrewName(lastName) && IsValidHebrewName(firstName))
            {
                // החזר בפורמט "שם פרטי שם משפחה"
                return $"{firstName} {lastName}";
            }
        }
        
        // אם אין פסיק, בדוק אם זה שם תקין כמו שהוא
        if (IsValidHebrewName(nameString) && !nameString.Contains("="))
        {
            return nameString;
        }
        
        return "";
    }

    // *** חדש: בדיקה אם מחרוזת היא שם עברי תקין ***
    private bool IsValidHebrewName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;
        if (name.Length < 2 || name.Length > 50) return false;
        
        // בדוק שמכיל לפחות אות עברית אחת
        bool hasHebrew = name.Any(c => c >= '\u05D0' && c <= '\u05EA');
        
        // בדוק שלא מכיל תווים אסורים
        bool hasInvalidChars = name.Any(c => 
            c == '=' || c == '<' || c == '>' || 
            c == '{' || c == '}' || c == '[' || c == ']' ||
            char.IsDigit(c));
        
        return hasHebrew && !hasInvalidChars;
    }

    // *** חדש: קביעת אתרים מורשים לפי שם הארגון ***
    private string DetermineAllowedSites(string organization, string building)
    {
        if (string.IsNullOrEmpty(organization) && string.IsNullOrEmpty(building))
        {
            // ברירת מחדל: שני האתרים
            return "ר\"ג,פ\"ת";
        }
        
        string combined = (organization + " " + building).ToLower();
        
        // בדוק אם מוזכר אתר ספציפי
        bool hasRG = combined.Contains("ר\"ג") || combined.Contains("רמת גן") || 
                    combined.Contains("ramat");
        bool hasPT = combined.Contains("פ\"ת") || combined.Contains("פתח תקווה") || 
                    combined.Contains("petah");
        
        if (hasRG && hasPT) return "ר\"ג,פ\"ת";
        if (hasRG) return "ר\"ג";
        if (hasPT) return "פ\"ת";
        
        // ברירת מחדל: שני האתרים
        return "ר\"ג,פ\"ת";
    }

    private string FormatDateTimeString(string dateTimeStr)
    {
        if (string.IsNullOrEmpty(dateTimeStr)) return dateTimeStr;
        
        if (TryParseDateTime(dateTimeStr, out DateTime parsed))
        {
            return parsed.ToString("dd.MM.yyyy HH:mm:ss");
        }
        
        return dateTimeStr; // אם הפרסור נכשל, החזר את המחרוזת המקורית
    }

    private async Task<List<FailedJobEntry>> ParseFailedJobsReport(string filePath)
    {
        var failedJobs = new List<FailedJobEntry>();
        
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        List<List<string>> tableData;

        if (extension == ".csv")
        {
            var result = await ParseCsvFile(filePath);
            tableData = result.data as List<List<string>>;
        }
        else
        {
            tableData = await ParseExcelToList(filePath);
        }

        if (tableData == null || tableData.Count < 2)
            return failedJobs;

        var headers = tableData[0];
        
        int folderIdx         = headers.IndexOf("Folder");
        int jobNameIdx        = headers.IndexOf("Job Name");
        int startTimeIdx      = headers.IndexOf("Start Time");
        int applicationIdx    = headers.IndexOf("Application");
        int subApplicationIdx = headers.IndexOf("Sub Application Name");
        int runTimeIdx        = headers.IndexOf("Run Time (Sec.)");
        int endTimeIdx        = headers.IndexOf("End Time");
        int hostIdx           = headers.IndexOf("Host");
        int runIdIdx          = headers.IndexOf("Run ID");
        int runAsUserIdx      = headers.IndexOf("Run as user");

        if (folderIdx    == -1) folderIdx    = headers.FindIndex(h => h?.Contains("Folder")   == true);
        if (jobNameIdx   == -1) jobNameIdx   = headers.FindIndex(h => h?.Contains("Job")      == true && h?.Contains("Name") == true);
        if (startTimeIdx == -1) startTimeIdx = headers.FindIndex(h => h?.Contains("Start")    == true);
        if (runTimeIdx   == -1) runTimeIdx   = headers.FindIndex(h => h?.Contains("Run Time") == true);
        if (endTimeIdx   == -1) endTimeIdx   = headers.FindIndex(h => h?.Contains("End Time") == true);
        if (hostIdx      == -1) hostIdx      = headers.FindIndex(h => h?.Equals("Host", StringComparison.OrdinalIgnoreCase) == true);
        if (runIdIdx     == -1) runIdIdx     = headers.FindIndex(h => h?.Contains("Run ID")   == true);
        if (runAsUserIdx == -1) runAsUserIdx = headers.FindIndex(h => h?.Contains("Run as")   == true);

        var jobFailureCounts = new Dictionary<string, FailedJobEntry>();

        for (int i = 1; i < tableData.Count; i++)
        {
            var row = tableData[i];
            if (row == null || row.Count == 0) continue;

            string jobName       = jobNameIdx    >= 0 && jobNameIdx    < row.Count ? row[jobNameIdx]?.Trim()    : "";
            string folder        = folderIdx     >= 0 && folderIdx     < row.Count ? row[folderIdx]?.Trim()     : "";
            string startTimeStr  = startTimeIdx  >= 0 && startTimeIdx  < row.Count ? row[startTimeIdx]?.Trim()  : "";
            string application   = applicationIdx >= 0 && applicationIdx < row.Count ? row[applicationIdx]?.Trim() : "";
            string subApplication = subApplicationIdx >= 0 && subApplicationIdx < row.Count ? row[subApplicationIdx]?.Trim() : "";
            
            string runTime   = runTimeIdx   >= 0 && runTimeIdx   < row.Count ? row[runTimeIdx]?.Trim()   : "";
            
            // *** תיקון: פרסור זמן סיום לפורמט אחיד ***
            string endTimeRaw = endTimeIdx >= 0 && endTimeIdx < row.Count ? row[endTimeIdx]?.Trim() : "";
            string endTime    = FormatDateTimeString(endTimeRaw);
            
            string host      = hostIdx      >= 0 && hostIdx      < row.Count ? row[hostIdx]?.Trim()      : "";
            string runId     = runIdIdx     >= 0 && runIdIdx     < row.Count ? row[runIdIdx]?.Trim()     : "";
            string runAsUser = runAsUserIdx >= 0 && runAsUserIdx < row.Count ? row[runAsUserIdx]?.Trim() : "";

            if (string.IsNullOrEmpty(jobName)) continue;

            DateTime startTime;
            bool timeValid = TryParseDateTime(startTimeStr, out startTime);

            if (!string.IsNullOrEmpty(jobName))
            {
                string key = $"{folder}|{jobName}";
                
                if (!jobFailureCounts.ContainsKey(key))
                {
                    jobFailureCounts[key] = new FailedJobEntry
                    {
                        Folder         = folder,
                        JobName        = jobName,
                        Application    = application,
                        SubApplication = subApplication,
                        FailureCount   = 0,
                        LastFailureTime = startTime,
                        RunTime        = runTime,
                        EndTime        = endTime,   // ← כבר מפורסר
                        Host           = host,
                        RunId          = runId,
                        RunAsUser      = runAsUser
                    };
                }
                
                jobFailureCounts[key].FailureCount++;
                if (startTime > jobFailureCounts[key].LastFailureTime)
                {
                    jobFailureCounts[key].LastFailureTime = startTime;
                    jobFailureCounts[key].RunTime   = runTime;
                    jobFailureCounts[key].EndTime   = endTime;   // ← כבר מפורסר
                    jobFailureCounts[key].Host      = host;
                    jobFailureCounts[key].RunId     = runId;
                    jobFailureCounts[key].RunAsUser = runAsUser;
                }
            }
        }

        return jobFailureCounts.Values.OrderByDescending(j => j.FailureCount).ToList();
    }

    // פונקציה חדשה לקריאת styles.xml
    private HashSet<int> LoadDateStyleIndices(System.IO.Compression.ZipArchive archive)
    {
        var dateIndices = new HashSet<int>();
        
        // מספרי פורמט מובנים של Excel שהם תאריכים
        var builtInDateFormats = new HashSet<int> 
        { 
            14, 15, 16, 17, 18, 19, 20, 21, 22,  // תאריכים
            45, 46, 47,                            // זמנים
            164, 165, 166, 167, 168, 169, 170      // פורמטים מותאמים אישית
        };
        
        var stylesEntry = archive.GetEntry("xl/styles.xml");
        if (stylesEntry == null) return dateIndices;
        
        using (var stream = stylesEntry.Open())
        using (var reader = new System.IO.StreamReader(stream))
        {
            var xml = reader.ReadToEnd();
            
            // קרא את numFmts המותאמים אישית
            var customDateFormats = new HashSet<int>();
            var numFmtMatches = System.Text.RegularExpressions.Regex.Matches(
                xml, 
                @"<numFmt\s+numFmtId=""(\d+)""\s+formatCode=""([^""]+)""",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase
            );
            
            foreach (System.Text.RegularExpressions.Match m in numFmtMatches)
            {
                if (int.TryParse(m.Groups[1].Value, out int fmtId))
                {
                    string formatCode = m.Groups[2].Value.ToLower();
                    
                    // בדוק אם הפורמט מכיל תווי תאריך/שעה
                    bool isDateFormat = 
                        (formatCode.Contains("y") || formatCode.Contains("d") || 
                        formatCode.Contains("h") || formatCode.Contains("m")) &&
                        !formatCode.Contains("0") &&      // ← מספרים רגילים מכילים "0"
                        !formatCode.Contains("#") &&      // ← מספרים רגילים מכילים "#"
                        !formatCode.Contains("general");  // ← General אינו תאריך
                        
                    if (isDateFormat)
                        customDateFormats.Add(fmtId);
                }
            }
            
            // קרא את xf (cell formats) ומצא אילו styles הם תאריכים
            var xfSection = System.Text.RegularExpressions.Regex.Match(
                xml, @"<cellXfs>(.*?)</cellXfs>",
                System.Text.RegularExpressions.RegexOptions.Singleline
            );
            
            if (xfSection.Success)
            {
                var xfMatches = System.Text.RegularExpressions.Regex.Matches(
                    xfSection.Groups[1].Value,
                    @"<xf\s[^>]*numFmtId=""(\d+)""[^>]*/?>",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase
                );
                
                int styleIndex = 0;
                foreach (System.Text.RegularExpressions.Match xf in xfMatches)
                {
                    if (int.TryParse(xf.Groups[1].Value, out int numFmtId))
                    {
                        if (builtInDateFormats.Contains(numFmtId) || 
                            customDateFormats.Contains(numFmtId))
                        {
                            dateIndices.Add(styleIndex);
                        }
                    }
                    styleIndex++;
                }
            }
        }
        
        return dateIndices;
    }

    private bool TryParseDateTime(string dateTimeStr, out DateTime result)
    {
        result = DateTime.MinValue;
        if (string.IsNullOrEmpty(dateTimeStr)) return false;

        string normalizedStr = dateTimeStr.Trim();
        
        // *** תיקון הלוגיקה של AM/PM ***
        // הבעיה: "May 30, 2026 1:19:43 PM" - שעה 1 עם PM = 13:00
        // הקוד הישן הסיר את ה-PM בטעות כי hours < 12
        
        var amPmMatch = System.Text.RegularExpressions.Regex.Match(
            normalizedStr, 
            @"(\d{1,2}:\d{2}:\d{2})\s*(AM|PM)$", 
            System.Text.RegularExpressions.RegexOptions.IgnoreCase
        );
        
        if (amPmMatch.Success)
        {
            string timePart = amPmMatch.Groups[1].Value;
            string amPm = amPmMatch.Groups[2].Value.ToUpper();
            
            if (TimeSpan.TryParse(timePart, out TimeSpan ts))
            {
                // *** תיקון: המר ל-24 שעות לפי AM/PM בצורה נכונה ***
                int hours = ts.Hours;
                
                if (amPm == "PM" && hours < 12)
                {
                    // PM + שעה < 12 → הוסף 12 (1 PM = 13:00, 2 PM = 14:00)
                    hours += 12;
                }
                else if (amPm == "AM" && hours == 12)
                {
                    // 12 AM = חצות = 0:00
                    hours = 0;
                }
                // שאר המקרים: AM עם שעה < 12 → נשאר כמו שהוא
                // PM עם שעה >= 12 (12 PM = 12:00) → נשאר כמו שהוא
                
                // בנה מחרוזת עם שעה מתוקנת ב-24 שעות (ללא AM/PM)
                string correctedTime = $"{hours:D2}:{ts.Minutes:D2}:{ts.Seconds:D2}";
                
                // החלף את החלק של השעה במחרוזת המקורית
                normalizedStr = System.Text.RegularExpressions.Regex.Replace(
                    normalizedStr,
                    @"\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$",
                    correctedTime,
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase
                ).Trim();
            }
        }

        // פורמטים לניסיון - מהספציפי לכללי
        string[] formats = {
            // פורמט הקובץ: "May 30, 2026 13:19:43" (אחרי המרה)
            "MMM d, yyyy H:mm:ss",
            "MMM dd, yyyy H:mm:ss",
            "MMM d, yyyy HH:mm:ss",
            "MMM dd, yyyy HH:mm:ss",
            // פורמטים נוספים
            "MM/dd/yyyy HH:mm:ss",
            "dd/MM/yyyy HH:mm:ss",
            "yyyy-MM-dd HH:mm:ss",
            "dd.MM.yyyy HH:mm:ss",
            "MM/dd/yyyy H:mm:ss",
            "dd/MM/yyyy H:mm:ss",
        };

        // נסה עם InvariantCulture
        foreach (var format in formats)
        {
            if (DateTime.TryParseExact(
                normalizedStr, 
                format, 
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, 
                out result))
            {
                return true;
            }
        }

        // נסה פרסור כללי
        if (DateTime.TryParse(
            normalizedStr, 
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None,
            out result))
        {
            return true;
        }

        Console.WriteLine($"[TryParseDateTime] FAILED to parse: '{dateTimeStr}'");
        return false;
    }

    private async Task<List<ContactEntry>> ParseContactsFile(string filePath)
    {
        var contacts = new List<ContactEntry>();
        
        var extension = Path.GetExtension(filePath).ToLowerInvariant();
        List<List<string>> tableData;

        if (extension == ".csv")
        {
            var result = await ParseCsvFile(filePath);
            tableData = result.data as List<List<string>>;
        }
        else
        {
            tableData = await ParseExcelToList(filePath);
        }

        if (tableData == null || tableData.Count < 2)
            return contacts;

        var headers = tableData[0];
        
        // מצא עמודות רלוונטיות בקובץ אנשי הקשר
        // לפי מבנה RESPONSIBLE_USERS_LIST.xlsx: Job Name | Mail User | User Name
        int jobNameIdx = headers.FindIndex(h => h?.Contains("Job") == true);
        int mailIdx = headers.FindIndex(h => h?.Contains("Mail") == true || h?.Contains("Email") == true || h?.Contains("mail") == true);
        int userNameIdx = headers.FindIndex(h => h?.Contains("User Name") == true || h?.Contains("UserName") == true);

        if (jobNameIdx == -1) jobNameIdx = 0;
        if (mailIdx == -1) mailIdx = 1;
        if (userNameIdx == -1) userNameIdx = 2;

        for (int i = 1; i < tableData.Count; i++)
        {
            var row = tableData[i];
            if (row == null || row.Count == 0) continue;

            string jobName = jobNameIdx < row.Count ? row[jobNameIdx]?.Trim() : "";
            string email = mailIdx < row.Count ? row[mailIdx]?.Trim() : "";
            string userName = userNameIdx < row.Count ? row[userNameIdx]?.Trim() : "";

            if (string.IsNullOrEmpty(jobName)) continue;

            contacts.Add(new ContactEntry
            {
                JobName = jobName,
                Email = email,
                UserName = userName
            });
        }

        return contacts;
    }

    // ─── חיפוש מייל עם fallback: JOBS_CONTACTS → ספר טלפונים → עץ ארגוני ───
    private async Task<ContactResolutionResult> ResolveContactEmail(
        string userName,
        List<ContactEntry> jobsContacts)
    {
        if (string.IsNullOrWhiteSpace(userName))
            return new ContactResolutionResult 
            { 
                UserName = userName, 
                Email = "", 
                Source = "empty",
                ManagerName = null
            };

        // ─── שלב 1: חפש בקובץ JOBS_CONTACTS ─────────────────────────
        var directContact = jobsContacts.FirstOrDefault(c =>
            string.Equals(c.UserName?.Trim(), userName.Trim(),
                StringComparison.OrdinalIgnoreCase));

        if (directContact != null && 
            !string.IsNullOrEmpty(directContact.Email))
        {
            return new ContactResolutionResult
            {
                UserName = userName,
                Email    = directContact.Email,
                Source   = "jobs_contacts"
            };
        }

        // ─── שלב 2: חפש בספר הטלפונים ───────────────────────────────
        var phoneCsvPath = Path.Combine(_baseFilesPath, "phone_directory.csv");

        if (System.IO.File.Exists(phoneCsvPath))
        {
            var phoneLines = System.IO.File.ReadAllLines(
                phoneCsvPath, Encoding.UTF8);

            // חיפוש מדויק תחילה
            for (int i = 1; i < phoneLines.Length; i++)
            {
                var cols = phoneLines[i].Split(',');
                if (cols.Length < 8) continue;

                var fullName = cols[0]?.Trim() ?? "";
                var email    = cols[7]?.Trim() ?? "";

                if (string.Equals(fullName, userName.Trim(),
                        StringComparison.OrdinalIgnoreCase) &&
                    !string.IsNullOrEmpty(email))
                {
                    return new ContactResolutionResult
                    {
                        UserName = userName,
                        Email    = email,
                        Source   = "phone_directory"
                    };
                }
            }

            // חיפוש חלקי
            for (int i = 1; i < phoneLines.Length; i++)
            {
                var cols = phoneLines[i].Split(',');
                if (cols.Length < 8) continue;

                var fullName = cols[0]?.Trim() ?? "";
                var email    = cols[7]?.Trim() ?? "";

                if (!string.IsNullOrEmpty(email) &&
                    (fullName.Contains(userName.Trim(),
                        StringComparison.OrdinalIgnoreCase) ||
                    userName.Trim().Contains(fullName,
                        StringComparison.OrdinalIgnoreCase)))
                {
                    return new ContactResolutionResult
                    {
                        UserName = userName,
                        Email    = email,
                        Source   = "phone_directory_partial"
                    };
                }
            }
        }

        // ─── שלב 3: חפש בעץ הארגוני ─────────────────────────────────
        var treeFolder = Path.Combine(_baseFilesPath, "Helix_Employees_Export", "BuildTree");

        if (Directory.Exists(treeFolder))
        {
            var treeFiles = Directory.GetFiles(treeFolder, "*.csv")
                .OrderByDescending(f => 
                    System.IO.File.GetLastWriteTime(f))
                .ToList();

            if (treeFiles.Any())
            {
                var treeLines = System.IO.File.ReadAllLines(
                    treeFiles.First(), Encoding.UTF8);

                // מצא את העובד בעץ
                string? employeeId   = null;
                string? managerId    = null;
                string? employeeName = null;

                for (int i = 1; i < treeLines.Length; i++)
                {
                    var cols = treeLines[i].Split(',');
                    if (cols.Length < 2) continue;

                    var empId   = cols[0]?.Trim() ?? "";
                    var empName = cols[1]?.Trim() ?? "";
                    var mgrId   = cols.Length > 2 
                        ? cols[2]?.Trim() : "";

                    if (string.Equals(empName, userName.Trim(),
                            StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(empId, userName.Trim(),
                            StringComparison.OrdinalIgnoreCase))
                    {
                        employeeId   = empId;
                        managerId    = mgrId;
                        employeeName = empName;
                        break;
                    }
                }

                // ─── נמצא עובד - חפש את המנהל שלו ───────────────────
                if (!string.IsNullOrEmpty(managerId))
                {
                    // מצא שם המנהל מהעץ
                    string? managerName = null;
                    for (int i = 1; i < treeLines.Length; i++)
                    {
                        var cols = treeLines[i].Split(',');
                        if (cols.Length < 2) continue;

                        if (string.Equals(cols[0]?.Trim(), managerId,
                                StringComparison.OrdinalIgnoreCase))
                        {
                            managerName = cols[1]?.Trim();
                            break;
                        }
                    }

                    if (!string.IsNullOrEmpty(managerName))
                    {
                        // חפש מייל של המנהל בספר הטלפונים
                        if (System.IO.File.Exists(phoneCsvPath))
                        {
                            var phoneLines = System.IO.File.ReadAllLines(
                                phoneCsvPath, Encoding.UTF8);

                            for (int i = 1; i < phoneLines.Length; i++)
                            {
                                var cols = phoneLines[i].Split(',');
                                if (cols.Length < 8) continue;

                                var fullName = cols[0]?.Trim() ?? "";
                                var email    = cols[7]?.Trim() ?? "";

                                if (string.Equals(fullName, managerName,
                                        StringComparison.OrdinalIgnoreCase) &&
                                    !string.IsNullOrEmpty(email))
                                {
                                    return new ContactResolutionResult
                                    {
                                        UserName    = userName,
                                        Email       = email,
                                        Source      = "manager_fallback",
                                        ManagerName = managerName,
                                        ManagerId   = managerId
                                    };
                                }
                            }
                        }

                        // המנהל נמצא בעץ אבל לא בספר טלפונים
                        return new ContactResolutionResult
                        {
                            UserName    = userName,
                            Email       = "",
                            Source      = "manager_found_no_email",
                            ManagerName = managerName,
                            ManagerId   = managerId,
                            Error       = $"נמצא מנהל '{managerName}' אך לא נמצא מייל"
                        };
                    }
                }

                // עובד נמצא בעץ אבל אין מנהל
                if (!string.IsNullOrEmpty(employeeId))
                {
                    return new ContactResolutionResult
                    {
                        UserName = userName,
                        Email    = "",
                        Source   = "org_tree_no_manager",
                        Error    = $"עובד נמצא בעץ ארגוני ללא מנהל מוגדר"
                    };
                }
            }
        }

        // ─── שלב 4: לא נמצא בשום מקום ───────────────────────────────
        return new ContactResolutionResult
        {
            UserName = userName,
            Email    = "",
            Source   = "not_found",
            Error    = $"'{userName}' לא נמצא בשום מקור נתונים"
        };
    }

    private async Task<List<JobContactResult>> BuildJobsContactsTableAsync(
    List<FailedJobEntry> failedJobs, 
    List<ContactEntry>   contacts)
    {
        var results = new List<JobContactResult>();

        var contactsByJob = contacts
            .GroupBy(c => c.JobName?.Trim(), 
                StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), 
                StringComparer.OrdinalIgnoreCase);

        foreach (var failedJob in failedJobs)
        {
            var rawContacts = new List<ContactEntry>();
            string jobNameForSearch = failedJob.JobName?.Trim() ?? "";

            if (jobNameForSearch.Contains('/'))
                jobNameForSearch = jobNameForSearch
                    .Substring(0, jobNameForSearch.IndexOf('/'))
                    .Trim();

            if (contactsByJob.ContainsKey(jobNameForSearch))
                rawContacts = contactsByJob[jobNameForSearch];

            // ─── פתור מייל לכל איש קשר עם fallback ──────────────────
            var resolvedContacts = new List<ResolvedContactInfo>();

            foreach (var rawContact in rawContacts)
            {
                if (string.IsNullOrWhiteSpace(rawContact.UserName))
                    continue;

                var resolution = await ResolveContactEmail(
                    rawContact.UserName, contacts);

                resolvedContacts.Add(new ResolvedContactInfo
                {
                    UserName    = rawContact.UserName,
                    Email       = resolution.Email,
                    Source      = resolution.Source,
                    ManagerName = resolution.ManagerName,
                    Error       = resolution.Error
                });
            }

            // ─── אם אין אנשי קשר - נסה לפי שם הג'וב ─────────────────
            if (!resolvedContacts.Any() && 
                !string.IsNullOrEmpty(failedJob.RunAsUser))
            {
                var resolution = await ResolveContactEmail(
                    failedJob.RunAsUser, contacts);

                if (!string.IsNullOrEmpty(resolution.Email) ||
                    resolution.Source != "not_found")
                {
                    resolvedContacts.Add(new ResolvedContactInfo
                    {
                        UserName    = failedJob.RunAsUser,
                        Email       = resolution.Email,
                        Source      = resolution.Source + "_runasuser",
                        ManagerName = resolution.ManagerName,
                        Error       = resolution.Error
                    });
                }
            }

            results.Add(new JobContactResult
            {
                Folder          = failedJob.Folder,
                JobName         = failedJob.JobName,
                FailureCount    = failedJob.FailureCount,
                LastFailureTime = failedJob.LastFailureTime
                    .ToString("dd/MM/yyyy HH:mm:ss"),
                Application     = failedJob.Application,
                RunTime         = failedJob.RunTime,
                EndTime         = failedJob.EndTime,
                Host            = failedJob.Host,
                RunId           = failedJob.RunId,
                RunAsUser       = failedJob.RunAsUser,
                // ← שמור גם ContactInfo הישן לתאימות לאחור
                Contacts = resolvedContacts.Select(c => new ContactInfo
                {
                    UserName = c.UserName,
                    Email    = c.Email
                }).DistinctBy(c => c.Email).ToList(),
                // ← הוסף מידע מורחב
                ResolvedContacts = resolvedContacts
            });
        }

        return results.OrderByDescending(r => r.FailureCount).ToList();
    }

    private async Task<List<List<string>>> ParseExcelToList(string filePath)
    {
        var result = new List<List<string>>();

        if (!System.IO.File.Exists(filePath))
            return result;

        var extension = Path.GetExtension(filePath).ToLowerInvariant();

        try
        {
            if (extension == ".xlsx")
            {
                // קרא XLSX ישירות - XLSX הוא ZIP עם XML בפנים
                result = ReadXlsxDirectly(filePath);
            }
            else if (extension == ".xls")
            {
                // עבור XLS ישן - נסה COM עם retry
                result = await ReadXlsWithRetry(filePath);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error reading Excel file {filePath}: {ex.Message}");
            throw new Exception($"שגיאה בקריאת קובץ: {Path.GetFileName(filePath)}. {ex.Message}");
        }

        return result;
    }

    // קריאת XLSX ישירות - ללא Excel COM
    private List<List<string>> ReadXlsxDirectly(string filePath)
    {
        var result = new List<List<string>>();

        try
        {
            using (var archive = System.IO.Compression.ZipFile.OpenRead(filePath))
            {
                // ← הוסף: טען את ה-date styles
                _dateStyleIndices = LoadDateStyleIndices(archive);
                
                var sharedStrings = new List<string>();
                var sharedStringsEntry = archive.GetEntry("xl/sharedStrings.xml");
                if (sharedStringsEntry != null)
                {
                    using (var stream = sharedStringsEntry.Open())
                    using (var reader = new System.IO.StreamReader(stream))
                    {
                        var xml = reader.ReadToEnd();
                        sharedStrings = ParseSharedStrings(xml);
                    }
                }


                // מצא את הגיליון הראשון
                // קודם קרא את workbook.xml כדי למצוא את שם הגיליון
                string sheet1Path = "xl/worksheets/sheet1.xml";
                
                var workbookEntry = archive.GetEntry("xl/workbook.xml");
                if (workbookEntry != null)
                {
                    using (var stream = workbookEntry.Open())
                    using (var reader = new System.IO.StreamReader(stream))
                    {
                        var xml = reader.ReadToEnd();
                        // מצא את ה-rId של הגיליון הראשון
                        var sheetMatch = System.Text.RegularExpressions.Regex.Match(
                            xml, @"<sheet[^>]+r:id=""(rId\d+)""");
                        if (sheetMatch.Success)
                        {
                            var rId = sheetMatch.Groups[1].Value;
                            // מצא את הנתיב האמיתי מ-_rels
                            var relsEntry = archive.GetEntry("xl/_rels/workbook.xml.rels");
                            if (relsEntry != null)
                            {
                                using (var relsStream = relsEntry.Open())
                                using (var relsReader = new System.IO.StreamReader(relsStream))
                                {
                                    var relsXml = relsReader.ReadToEnd();
                                    var relMatch = System.Text.RegularExpressions.Regex.Match(
                                        relsXml, $@"Id=""{rId}""[^>]+Target=""([^""]+)""");
                                    if (relMatch.Success)
                                    {
                                        var target = relMatch.Groups[1].Value;
                                        sheet1Path = target.StartsWith("/") 
                                            ? target.TrimStart('/') 
                                            : "xl/" + target;
                                    }
                                }
                            }
                        }
                    }
                }

                // קרא את הגיליון
                var sheetEntry = archive.GetEntry(sheet1Path);
                if (sheetEntry == null)
                {
                    // נסה נתיב ישיר
                    sheetEntry = archive.GetEntry("xl/worksheets/sheet1.xml");
                }

                if (sheetEntry != null)
                {
                    using (var stream = sheetEntry.Open())
                    using (var reader = new System.IO.StreamReader(stream))
                    {
                        var xml = reader.ReadToEnd();
                        result = ParseSheetXml(xml, sharedStrings);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error reading XLSX directly: {ex.Message}");
            throw;
        }

        return result;
    }

    // פרסור SharedStrings מ-XML
    private List<string> ParseSharedStrings(string xml)
    {
        var strings = new List<string>();
        
        // מצא כל <si> element
        var matches = System.Text.RegularExpressions.Regex.Matches(
            xml, @"<si>(.*?)</si>", 
            System.Text.RegularExpressions.RegexOptions.Singleline);
        
        foreach (System.Text.RegularExpressions.Match match in matches)
        {
            var siContent = match.Groups[1].Value;
            
            // חלץ טקסט מ-<t> tags
            var textMatches = System.Text.RegularExpressions.Regex.Matches(
                siContent, @"<t[^>]*>(.*?)</t>",
                System.Text.RegularExpressions.RegexOptions.Singleline);
            
            var sb = new StringBuilder();
            foreach (System.Text.RegularExpressions.Match tm in textMatches)
            {
                sb.Append(System.Net.WebUtility.HtmlDecode(tm.Groups[1].Value));
            }
            
            strings.Add(sb.ToString());
        }
        
        return strings;
    }

    // פרסור גיליון Excel מ-XML
    private List<List<string>> ParseSheetXml(string xml, List<string> sharedStrings)
    {
        var result = new List<List<string>>();
        
        // מצא את כל השורות
        var rowMatches = System.Text.RegularExpressions.Regex.Matches(
            xml, @"<row[^>]*>(.*?)</row>",
            System.Text.RegularExpressions.RegexOptions.Singleline);
        
        foreach (System.Text.RegularExpressions.Match rowMatch in rowMatches)
        {
            var rowContent = rowMatch.Value;
            var cells = new List<(string ref_, string type, string value)>();
            
            // מצא את כל התאים בשורה
            var cellMatches = System.Text.RegularExpressions.Regex.Matches(
                rowContent, @"<c\s+r=""([^""]+)""(?:[^>]*t=""([^""]*)"")?\s*(?:[^>]*)?>(?:<v>(.*?)</v>)?(?:<is><t>(.*?)</t></is>)?</c>|<c\s+r=""([^""]+)""(?:[^>]*t=""([^""]*)"")?\s*(?:[^>]*)?/>",
                System.Text.RegularExpressions.RegexOptions.Singleline);
            
            foreach (System.Text.RegularExpressions.Match cellMatch in cellMatches)
            {
                string cellRef = cellMatch.Groups[1].Value;
                string cellType = cellMatch.Groups[2].Value;
                string cellValue = cellMatch.Groups[3].Value;
                string inlineStr = cellMatch.Groups[4].Value;
                
                if (string.IsNullOrEmpty(cellRef))
                {
                    cellRef = cellMatch.Groups[5].Value;
                    cellType = cellMatch.Groups[6].Value;
                }
                
                cells.Add((cellRef, cellType, string.IsNullOrEmpty(inlineStr) ? cellValue : inlineStr));
            }
            
            if (!cells.Any()) continue;
            
            // מצא את מספר העמודה המקסימלי בשורה
            int maxCol = 0;
            foreach (var (cellRef, _, _) in cells)
            {
                int col = GetColumnIndex(cellRef);
                if (col > maxCol) maxCol = col;
            }
            
            // בנה שורה עם כל התאים במיקום הנכון
            var row = new List<string>(new string[maxCol]);
            
            foreach (var (cellRef, cellType, cellValue) in cells)
            {
                int colIdx = GetColumnIndex(cellRef) - 1;
                if (colIdx < 0 || colIdx >= row.Count) continue;
                
                string value = "";
                
                if (cellType == "s") // shared string
                {
                    if (int.TryParse(cellValue, out int idx) && idx < sharedStrings.Count)
                        value = sharedStrings[idx];
                }
                else if (cellType == "b") // boolean
                {
                    value = cellValue == "1" ? "TRUE" : "FALSE";
                }
                else if (cellType == "inlineStr" || !string.IsNullOrEmpty(cellValue))
                {
                    // נסה לפרמט תאריך אם זה מספר
                    if (double.TryParse(cellValue, 
                        System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture, 
                        out double numVal))
                    {
                        // בדוק אם זה תאריך Excel (מספרים בין 1 ל-2958465)
                        if (numVal > 1 && numVal < 2958465 && IsDateCell(cellRef, xml))
                        {
                            try
                            {
                                var date = DateTime.FromOADate(numVal);
                                value = date.ToString("MMM d, yyyy h:mm:ss tt", 
                                    System.Globalization.CultureInfo.InvariantCulture);
                            }
                            catch
                            {
                                value = cellValue;
                            }
                        }
                        else
                        {
                            value = cellValue;
                        }
                    }
                    else
                    {
                        value = System.Net.WebUtility.HtmlDecode(cellValue);
                    }
                }
                
                row[colIdx] = value;
            }
            
            result.Add(row);
        }
        
        return result;
    }

    // בדוק אם תא הוא תאריך לפי ה-style שלו
    private bool IsDateCell(string cellRef, string sheetXml)
    {
        var cellMatch = System.Text.RegularExpressions.Regex.Match(
            sheetXml, 
            $@"<c\s+r=""{System.Text.RegularExpressions.Regex.Escape(cellRef)}""[^>]*s=""(\d+)""");
        
        if (cellMatch.Success && int.TryParse(cellMatch.Groups[1].Value, out int styleIdx))
        {
            // ← בדוק אם ה-style הזה הוא באמת תאריך לפי styles.xml
            if (_dateStyleIndices != null)
                return _dateStyleIndices.Contains(styleIdx);
                
            // ← fallback: אם אין מידע על styles, אל תניח שזה תאריך
            return false;
        }
        
        return false;
    }

    // המר אות עמודה למספר (A=1, B=2, AA=27 וכו')
    private int GetColumnIndex(string cellRef)
    {
        if (string.IsNullOrEmpty(cellRef)) return 0;
        
        int col = 0;
        foreach (char c in cellRef)
        {
            if (!char.IsLetter(c)) break;
            col = col * 26 + (char.ToUpper(c) - 'A' + 1);
        }
        return col;
    }

    // קריאת XLS ישן עם retry
    private async Task<List<List<string>>> ReadXlsWithRetry(string filePath, int maxRetries = 3)
    {
        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                return await Task.Run(() =>
                {
                    var result = new List<List<string>>();
                    using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
                    {
                        var workbook = helper.OpenWorkbook(filePath);
                        var worksheet = helper.GetWorksheet(1);
                        var usedRange = worksheet.UsedRange;
                        int rowCount = usedRange.Rows.Count;
                        int colCount = usedRange.Columns.Count;

                        for (int i = 1; i <= rowCount; i++)
                        {
                            var row = new List<string>();
                            for (int j = 1; j <= colCount; j++)
                            {
                                var cell = worksheet.Cells[i, j];
                                row.Add(cell.Value?.ToString() ?? "");
                            }
                            result.Add(row);
                        }
                    }
                    return result;
                });
            }
            catch (System.Runtime.InteropServices.COMException ex) 
                when (ex.HResult == unchecked((int)0x8001010A))
            {
                Console.WriteLine($"Excel busy, attempt {attempt}/{maxRetries}. Waiting...");
                if (attempt < maxRetries)
                    await Task.Delay(2000 * attempt); // המתן 2, 4, 6 שניות
                else
                    throw new Exception($"Excel עמוס לאחר {maxRetries} ניסיונות. נסה שוב מאוחר יותר.");
            }
        }
        
        return new List<List<string>>();
    }

    [HttpPost]
    public async Task<IActionResult> UploadEmailMapping(IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return Json(new { success = false, error = "לא נבחר קובץ" });

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension != ".csv")
                return Json(new { success = false, error = "יש להעלות קובץ CSV בלבד" });

            // שמירת הקובץ
            using (var stream = new FileStream(_emailMappingFilePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            return Json(new { success = true, message = "קובץ המרת מיילים הועלה בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetEmailMapping()
    {
        try
        {
            var mappings = new List<object>();
            string phoneDirectoryPath = Path.Combine(_baseFilesPath, "phone_directory.csv");
            bool emailMappingExists = System.IO.File.Exists(_emailMappingFilePath);
            bool phoneDirectoryExists = System.IO.File.Exists(phoneDirectoryPath);
            
            // ─── קריאת נתונים מקובץ מיפוי מיילים אם קיים ───────────
            if (emailMappingExists)
            {
                var lines = System.IO.File.ReadAllLines(_emailMappingFilePath);
                bool isFirstLine = true;
                string[] headers = null;

                foreach (var line in lines)
                {
                    if (isFirstLine)
                    {
                        headers = line.Split(',');
                        isFirstLine = false;
                        continue;
                    }

                    var parts = line.Split(',');
                    if (parts.Length >= 2)
                    {
                        var mapping = new Dictionary<string, string>();
                        for (int i = 0; i < Math.Min(parts.Length, headers.Length); i++)
                        {
                            mapping[headers[i]] = parts[i];
                        }
                        mappings.Add(mapping);
                    }
                }
            }
            
            // ─── קריאת נתונים מספר הטלפונים - לתצוגה בלבד ──────────
            // *** שים לב: אין שמירה לקובץ! ***
            if (phoneDirectoryExists)
            {
                var phoneLines = System.IO.File.ReadAllLines(
                    phoneDirectoryPath, Encoding.UTF8);
                bool isFirstLine = true;
                
                // מילון לבדיקת כפילויות מיילים
                // (כולל מיילים שכבר נטענו מקובץ המיפוי)
                var existingEmails = new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase);
                
                foreach (var mapping in mappings)
                {
                    var dict = mapping as Dictionary<string, string>;
                    if (dict != null && dict.ContainsKey("emails"))
                    {
                        existingEmails.Add(dict["emails"]);
                    }
                }
                
                foreach (var line in phoneLines)
                {
                    if (isFirstLine)
                    {
                        isFirstLine = false;
                        continue;
                    }
                    
                    var parts = line.Split(',');
                    if (parts.Length >= 8)
                    {
                        string fullName = parts[0].Trim();
                        string email    = parts[7].Trim();
                        
                        // הוסף לתצוגה בלבד - ללא שמירה לקובץ
                        if (!string.IsNullOrEmpty(email) && 
                            !existingEmails.Contains(email))
                        {
                            var mapping = new Dictionary<string, string>
                            {
                                ["emails"]   = email,
                                ["users"]    = fullName,
                                ["onitGroup"] = "",
                                // ← סימון שמקור הנתון הוא ספר הטלפונים
                                ["הערות"]   = "מספר טלפונים",
                                // ← דגל שמונע שמירה בעתיד
                                ["readOnly"] = "true"
                            };
                            
                            mappings.Add(mapping);
                            existingEmails.Add(email);
                            
                            // *** הוסרה כל שמירה לקובץ מכאן ***
                        }
                    }
                }
                
                // אם קובץ המיפוי לא קיים, צור אותו עם כל הנתונים
                if (!emailMappingExists && mappings.Count > 0)
                {
                    try
                    {
                        var directory = Path.GetDirectoryName(_emailMappingFilePath);
                        if (!Directory.Exists(directory))
                        {
                            Directory.CreateDirectory(directory);
                        }
                        
                        var lines = new List<string> { "emails,users,onitGroup,הערות" };
                        
                        foreach (var mapping in mappings)
                        {
                            var dict = mapping as Dictionary<string, string>;
                            if (dict != null)
                            {
                                string email = dict.ContainsKey("emails") ? dict["emails"] : "";
                                string user = dict.ContainsKey("users") ? dict["users"] : "";
                                string group = dict.ContainsKey("onitGroup") ? dict["onitGroup"] : "";
                                string notes = dict.ContainsKey("הערות") ? dict["הערות"] : "";
                                if(!notes.Contains("מספר טלפונים")){
                                    lines.Add($"{email},{user},{group},{notes}");
                                }
                            }
                        }
                        
                        System.IO.File.WriteAllLines(_emailMappingFilePath, lines);
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"שגיאה ביצירת קובץ מיפוי: {ex.Message}");
                    }
                }
            }
            else if (!emailMappingExists)
            {
                // אם הקובץ לא קיים, נסה להשתמש בקובץ שציינת
                string alternativePath = @"R:\USERS\TASHTIT\תפעול תשתיות חדש\מחלקת הפעלה ובקרה - שולמית אגמי\אוטומציה\liron\For Tal Yohay\PDL to Users\files\onit_emails.csv";
                
                if (System.IO.File.Exists(alternativePath))
                {
                    // העתק רק את קובץ המיפוי המקורי - ללא נתוני ספר טלפונים
                    System.IO.File.Copy(
                        alternativePath, _emailMappingFilePath, true);
                    return GetEmailMapping();
                }
                else
                {
                    return Json(new { 
                        success = false, 
                        error = "קובץ מיפוי מיילים לא קיים" 
                    });
                }
            }

            return Json(new { success = true, mappings = mappings });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }
    
    [HttpPost]
    public IActionResult AddEmailMappings([FromBody] AddEmailMappingsRequest request)
    {
        try
        {
            if (request?.Mappings == null || request.Mappings.Count == 0)
            {
                return Json(new { success = false, error = "לא התקבלו מיפויים" });
            }

            // וודא שתיקיית הקבצים קיימת
            var directory = Path.GetDirectoryName(_emailMappingFilePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            // בדוק אם הקובץ קיים
            bool fileExists = System.IO.File.Exists(_emailMappingFilePath);
            
            // קרא את הקובץ הקיים אם יש
            List<string> existingLines = new List<string>();
            if (fileExists)
            {
                existingLines = System.IO.File.ReadAllLines(_emailMappingFilePath).ToList();
            }
            else
            {
                // אם הקובץ לא קיים, הוסף שורת כותרות
                existingLines.Add("emails,users,onitGroup,הערות");
            }

            // הוסף את המיפויים החדשים
            foreach (var mapping in request.Mappings)
            {
                string newLine = $"{mapping.Email},{mapping.Name},,";
                existingLines.Add(newLine);
            }

            // שמור את הקובץ
            System.IO.File.WriteAllLines(_emailMappingFilePath, existingLines);

            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult InitDailyPermitEmailTimer()
    {
        try
        {
            EnsureDailyPermitEmailTimerStarted();
            return Json(new { success = true, message = "Timer initialized" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    private static void EnsureDailyPermitEmailTimerStarted()
    {
        lock (_timerLock)
        {
            if (_dailyEmailTimerInitialized) return;
            _dailyEmailTimerInitialized = true;

           // חשב כמה זמן עד 06:50 הבאה
            var now = DateTime.Now;
            var nextRun = new DateTime(now.Year,now.Month,now.Day,
                6,   // שעה
                50,  // דקות
                0    // שניות
            );

            // אם כבר עברנו 06:50 היום - קבע ליום הבא
            if (now >= nextRun)
                nextRun = nextRun.AddDays(1);

            // דלג על שבת (6) - קבע ליום ראשון
            while (nextRun.DayOfWeek == DayOfWeek.Saturday)
                nextRun = nextRun.AddDays(1);

            var initialDelay = nextRun - now;
            var period = TimeSpan.FromHours(24);

            Console.WriteLine(
                $"[DailyPermitEmail] Timer set. " +
                $"First run: {nextRun:dd/MM/yyyy HH:mm:ss} " +
                $"(in {initialDelay.TotalMinutes:F0} minutes)"
            );

            _dailyPermitEmailTimer = new System.Threading.Timer(
                callback: _ => SendDailyDanBironPermitEmail(),
                state: null,
                dueTime: initialDelay,
                period: period
            );
        }
    }

    private static void SendDailyDanBironPermitEmail()
    {
        try
        {
            var now = DateTime.Now;

            if (now.DayOfWeek == DayOfWeek.Saturday)
            {
                Console.WriteLine(
                    $"[DailyPermitEmail] Skipping Saturday {now:dd/MM/yyyy}");
                return;
            }

            var dateDisplay =
                $"{now.Day:D2}/{now.Month:D2}/{now.Year}";

            var body = BuildDanBironPermitBody(dateDisplay);

            var toAddresses = new List<string>
            {
                "lobbymenora@menoramivt.co.il",
                "binyaminra@menoramivt.co.il",
                "securityroomusr@menoramivt.co.il",
                "HananBD1@kyndryl.com"
            };

            // CC משותף
            var cc = new List<string>
            {
                "noc@menoramivt.co.il"
            };

            SendPermitEmailSmtp(
                subject:  $"אישור כניסה להיום ({dateDisplay}) עבור דן בירון- פ\"ת ור\"ג",
                body: body,
                toAddresses: toAddresses,
                ccAddresses: cc
            );
            Console.WriteLine(
                $"[DailyPermitEmail] Successfully sent for {dateDisplay}");
        }
        catch (Exception ex)
        {
            Console.WriteLine(
                $"[DailyPermitEmail] Error: {ex.Message}");
        }
    }

    private static string BuildDanBironPermitBody(string dateDisplay)
    {
        return
            $"שלום רב,\n\n" +
            $"נא לאשר כניסה להיום ({dateDisplay}) לר\"ג ולפ\"ת:\n\n" +
            $"חברה    : מנורה מבטחים\n\n" +
            $"שם      : דני בירון\n\n" +
            $"תודה.";
    }

    private static void SendPermitEmailSmtp(
        string subject,
        string body,
        List<string> toAddresses,
        List<string> ccAddresses)
    {
        using var client = new System.Net.Mail.SmtpClient("172.22.28.25", 25)
        {
            EnableSsl             = false,
            DeliveryMethod        = System.Net.Mail.SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
            Credentials           = System.Net.CredentialCache.DefaultNetworkCredentials,
            Timeout               = 10_000
        };

        var htmlBody = BuildPermitHtmlBodyStatic(body);

        using var mail = new System.Net.Mail.MailMessage
        {
            From       = new System.Net.Mail.MailAddress(
                            "noc@menoramivt.co.il", "NOC Portal"),
            Subject    = subject,
            Body       = htmlBody,
            IsBodyHtml = true
        };

        mail.SubjectEncoding = System.Text.Encoding.UTF8;
        mail.BodyEncoding    = System.Text.Encoding.UTF8;
        mail.HeadersEncoding = System.Text.Encoding.UTF8;

        foreach (var to in toAddresses)
            if (!string.IsNullOrWhiteSpace(to))
                mail.To.Add(to.Trim());

        foreach (var cc in ccAddresses)
            if (!string.IsNullOrWhiteSpace(cc))
                mail.CC.Add(cc.Trim());

        try
        {
            client.Send(mail);

            _auditLog?.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.EmailSent,
                Username  = "system",
                IpAddress = "system",
                Details   = $"Permit email sent | To={string.Join(", ", toAddresses)} | Subject={subject}",
                Success   = true
            });
        }
        catch (Exception ex)
        {
            _auditLog?.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.EmailFailed,
                Username  = "system",
                IpAddress = "system",
                Details   = $"Permit email failed | To={string.Join(", ", toAddresses)} | Subject={subject} | Error={ex.Message}",
                Success   = false
            });

            throw;
        }

    }

    private static string BuildPermitHtmlBodyStatic(string plainBody)
    {
        if (string.IsNullOrEmpty(plainBody))
            return "<html><body></body></html>";

        var lines = plainBody.Split('\n');
        var sb = new System.Text.StringBuilder();

        foreach (var line in lines)
        {
            var trimmed = line.TrimEnd('\r').Trim();

            if (string.IsNullOrEmpty(trimmed))
            {
                sb.Append(
                    "<div style=\"height:10px;line-height:10px;\">&nbsp;</div>"
                );
                continue;
            }

            if (trimmed.Contains(':'))
            {
                int idx = trimmed.IndexOf(':');
                string label = trimmed.Substring(0, idx).Trim();
                string value = trimmed.Substring(idx + 1).Trim();

                var knownLabels = new[]
                {
                    "שם", "שמות", "חברה", "מס' רכב",
                    "ת.ז.", "מלווה", "טלפון"
                };

                if (knownLabels.Any(l => label.Trim() == l))
                {
                    sb.Append($@"
    <div style=""padding:4px 0;line-height:1.6;"">
    <span style=""font-weight:bold;color:#444;
                display:inline-block;min-width:90px;"">
        {System.Net.WebUtility.HtmlEncode(label)}:
    </span>
    <span style=""color:#222;margin-right:8px;"">
        {System.Net.WebUtility.HtmlEncode(value)}
    </span>
    </div>");
                    continue;
                }
            }

            sb.Append($@"
    <div style=""padding:4px 0;color:#333;line-height:1.6;"">
    {System.Net.WebUtility.HtmlEncode(trimmed)}
    </div>");
        }

        return $@"<!DOCTYPE html>
    <html dir=""rtl"" lang=""he"">
    <head>
    <meta charset=""UTF-8"">
    <meta http-equiv=""Content-Type"" content=""text/html; charset=UTF-8"">
    </head>
    <body style=""margin:0;padding:25px 30px;
                font-family:Arial,sans-serif;
                direction:rtl;font-size:14px;
                color:#333;line-height:1.8;
                background:#ffffff;"">
    <div style=""max-width:600px;"">
        {sb}
    </div>
    </body>
    </html>";
    }

    private async Task<List<ExecutionJob>> ParseExcelToJobs(string filePath)
    {
        var jobs = new List<ExecutionJob>();

        using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
        {
            try
            {
                var workbook = helper.OpenWorkbook(filePath);
                var worksheet = helper.GetWorksheet(1);

                var usedRange = worksheet.UsedRange;
                int rowCount = usedRange.Rows.Count;
                int colCount = usedRange.Columns.Count;

                // בדיקה שיש לפחות שורת כותרת ושורת נתונים אחת
                if (rowCount < 2)
                {
                    return jobs;
                }

                // מיפוי עמודות - מחפש את העמודות הרלוונטיות לפי הכותרות
                int statusCol = -1, orderCol = -1, nameCol = -1, notesCol = -1, responsibleCol = -1, completedByCol = -1, executionTimeCol = -1, hasAlarmCol = -1; 

                for (int col = 1; col <= colCount; col++)
                {
                    string headerValue = (worksheet.Cells[1, col].Value ?? "").ToString().Trim();
                    
                    if (headerValue.Contains("סטטוס")) statusCol = col;
                    else if (headerValue.Contains("סדר")) orderCol = col;
                    else if (headerValue.Contains("שם ג'וב") || headerValue.Contains("שם")) nameCol = col;
                    else if (headerValue.Contains("הערות")) notesCol = col;
                    else if (headerValue.Contains("אחראי")) responsibleCol = col;
                    else if (headerValue.Contains("בוצע") || headerValue.Contains("ע\"י")) completedByCol = col;
                    else if (headerValue.Contains("שעת ביצוע") || headerValue.Contains("זמן ביצוע")) executionTimeCol = col;
                    else if (headerValue.Contains("התראה") || headerValue.Contains("שעון מעורר")) hasAlarmCol = col;
                }

                // וידוא שנמצאו העמודות החיוניות
                if (nameCol == -1)
                {
                    throw new Exception("לא נמצאה עמודת 'שם ג'וב' בקובץ");
                }

                // קריאת הנתונים משורה 2 ואילך
                for (int row = 2; row <= rowCount; row++)
                {
                    string jobName = (worksheet.Cells[row, nameCol].Value ?? "").ToString().Trim();
                    
                    // דילוג על שורות ריקות
                    if (string.IsNullOrEmpty(jobName))
                        continue;

                    // קריאת שאר הנתונים
                    string statusValue = statusCol > 0 ? (worksheet.Cells[row, statusCol].Value ?? "").ToString().Trim() : "";
                    string orderValue = orderCol > 0 ? (worksheet.Cells[row, orderCol].Value ?? "").ToString().Trim() : "";
                    string notes = notesCol > 0 ? (worksheet.Cells[row, notesCol].Value ?? "").ToString().Trim() : "";
                    string responsible = responsibleCol > 0 ? (worksheet.Cells[row, responsibleCol].Value ?? "").ToString().Trim() : "";
                    string completedBy = completedByCol > 0 ? (worksheet.Cells[row, completedByCol].Value ?? "").ToString().Trim() : "";
                    string executionTime = "";
                    if (executionTimeCol > 0)
                    {
                        var cellValue = worksheet.Cells[row, executionTimeCol].Value;
                        if (cellValue != null)
                        {
                            // בדוק אם זה מספר עשרוני (ייצוג זמן של Excel)
                            if (cellValue is double timeValue)
                            {
                                // המר את המספר העשרוני לשעות ודקות
                                int hours = (int)(timeValue * 24);
                                int minutes = (int)((timeValue * 24 - hours) * 60);
                                executionTime = $"{hours:D2}:{minutes:D2}";
                            }
                            else
                            {
                                // אם זה לא מספר, נסה לקרוא כמחרוזת
                                executionTime = cellValue.ToString().Trim();
                                
                                // בדוק אם זה NaN או ערך לא תקין אחר
                                if (executionTime == "NaN" || executionTime.ToLower() == "nan" || string.IsNullOrEmpty(executionTime))
                                {
                                    executionTime = "";
                                }
                            }
                        }
                    }
                    string hasAlarmValue = hasAlarmCol > 0 ? (worksheet.Cells[row, hasAlarmCol].Value ?? "").ToString().Trim() : "";

                    // פענוח התראה
                    bool hasAlarm = !string.IsNullOrEmpty(hasAlarmValue) && 
                        (hasAlarmValue.Contains("כן") || hasAlarmValue.Contains("✓") || hasAlarmValue == "1" || hasAlarmValue.ToLower() == "true");

                    // פענוח סטטוס
                    bool isCompleted = statusValue.Contains("בוצע") || statusValue.Contains("✓");
                    bool isRunning = statusValue.Contains("בריצה") || statusValue.Contains("●");

                    // פענוח מספר סדר
                    int order = -1;
                    if (!string.IsNullOrEmpty(orderValue) && orderValue != "-")
                    {
                        int.TryParse(orderValue, out order);
                    }

                    // יצירת אובייקט משימה
                    var job = new ExecutionJob
                    {
                        IsCompleted = isCompleted,
                        IsRunning = isRunning,
                        Order = order,
                        JobName = jobName,
                        Notes = notes,
                        Responsible = responsible,
                        CompletedBy = isCompleted && !string.IsNullOrEmpty(completedBy) ? completedBy.Replace("✓", "").Trim() : null,
                        CompletedDate = isCompleted ? DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") : null,
                        RunningBy = isRunning && !string.IsNullOrEmpty(completedBy) ? completedBy.Replace("●", "").Trim() : null,
                        RunningDate = isRunning ? DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") : null,
                        ExecutionTime = executionTime, 
                        HasAlarm = hasAlarm
                    };

                    jobs.Add(job);
                }

                return jobs;
            }
            catch (Exception ex)
            {
                throw new Exception($"שגיאה בקריאת קובץ Excel: {ex.Message}", ex);
            }
        }
    }

    private void WriteMessagesToFile(List<object> messages)
    {
            try
            {
                var directory = Path.GetDirectoryName(_messagesFilePath);
                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var lines = messages.Select(m => JsonSerializer.Serialize(m)).ToArray();
                System.IO.File.WriteAllLines(_messagesFilePath, lines);
            }
            catch (Exception ex)
            {
                throw new Exception($"שגיאה בכתיבה לקובץ: {ex.Message}");
            }
        }
    }

public class AddEmailMappingsRequest
{
    public List<EmailMapping> Mappings { get; set; }
}

public class EmailMapping
{
    public string Name { get; set; }
    public string Email { get; set; }
}

public class AlertItem
{
    public string Text { get; set; }
    public string ImagePath { get; set; }
}

public class MessageRequest
{
    public string Id { get; set; } 
    public string Title { get; set; }
    public string Category { get; set; }
    public string Author { get; set; }
    public string Priority { get; set; }
    public string DueDate { get; set; }
    
    // שדות ספציפיים לפי קטגוריה
    public string Content { get; set; } // בקשות, כללי, דחוף
    public List<ExecutionJob> Jobs { get; set; } // ביצוע
    public string AttachedEmail { get; set; } // ביצוע, בקשות
    public List<string> AttachedEmails { get; set; } // מערך חדש לקבצי מייל
    public string CsvFilePath { get; set; } // דוחות
    public List<List<string>> TableData { get; set; } 
    public List<List<string>> ControlMTableData { get; set; }
    
    // סיכום משמרת
    public string Incidents { get; set; }
    public string OpenAlerts { get; set; }
    public string SpecialActions { get; set; }
    public string GeneralInfo { get; set; }
    public string OpenItems { get; set; }
    public List<string> Attachments { get; set; } // קבצים מצורפים לסיכומי משמרת
    public List<AlertItem> AlertItems { get; set; }
    public object DailyTasksSummary { get; set; }

    public EntryPermitData EntryPermitData { get; set; }
    public bool IsEntryPermit { get; set; }

    public string EndDate { get; set; }        // תאריך סיום
    public bool AlwaysShow { get; set; } = true; // הצג תמיד

}

public class UpdateMessageOrderRequest
{
    public List<MessageOrderItem> MessageOrder { get; set; }
}

public class MessageOrderItem
{
    public string Id { get; set; }
    public int Order { get; set; }
}

// מודל בסיסי להודעה
public class BaseMessage
{
    public string Id { get; set; }
    public string Title { get; set; }
    public string Category { get; set; }
    public string Author { get; set; }
    public string Date { get; set; }
    public string Priority { get; set; }
    public string DueDate { get; set; }
    public string LastModified { get; set; }
}

// ביצוע - טבלת ג'ובים
public class ExecutionMessage : BaseMessage
{
    public List<ExecutionJob> Jobs { get; set; }
    public string AttachedEmail { get; set; } // נתיב לקובץ מייל
    public List<string> AttachedEmails { get; set; } // מערך חדש לקבצי מייל
}

public class ExecutionJob
{
    public bool IsCompleted { get; set; }
    public bool IsRunning { get; set; }
    public int Order { get; set; }
    public string JobName { get; set; }
    public string Notes { get; set; }
    public string Responsible { get; set; }
    public string CompletedBy { get; set; } 
    public string CompletedDate { get; set; }
    public string RunningBy { get; set; }
    public string RunningDate { get; set; }
    public string ExecutionTime { get; set; }
    public bool HasAlarm { get; set; }
}

public class UpdateJobRunningRequest
{
    public string MessageId { get; set; }
    public int JobIndex { get; set; }
    public bool IsRunning { get; set; }
    public string RunningBy { get; set; }
    public string RunningDate { get; set; }
}

// בקשות - טקסט חופשי + מייל
public class RequestMessage : BaseMessage
{
    public string Content { get; set; }
    public string AttachedEmail { get; set; } // נתיב לקובץ מייל
    public List<string> AttachedEmails { get; set; } // מערך חדש לקבצי מייל
}

// דוחות - CSV כטבלה
public class ReportMessage : BaseMessage
{
    public string CsvFilePath { get; set; }
    public List<List<string>> TableData { get; set; } // הנתונים מה-CSV
}

// סיכום משמרת
public class ShiftSummaryMessage : BaseMessage
{
    public string Incidents { get; set; } // תקלות
    public string OpenAlerts { get; set; } // התראות פתוחות
    public string SpecialActions { get; set; } // פעולות מיוחדות
    public string GeneralInfo { get; set; } // מידע כללי
    public string OpenItems { get; set; } // דברים פתוחים ממשמרות קודמות
    public List<string> Attachments { get; set; } // קבצים מצורפים
}

// כללי - נשאר כמו היום
public class GeneralMessage : BaseMessage
{
    public string Content { get; set; }
}

// דחוף - נשאר כמו היום
public class UrgentMessage : BaseMessage
{
    public string Content { get; set; }
}

public class UpdateJobCompletionRequest
{
    public string MessageId { get; set; }
    public int JobIndex { get; set; }
    public bool IsCompleted { get; set; }
    public string CompletedBy { get; set; }
    public string CompletedDate { get; set; }
}

public class UpdateAllJobStatusesRequest
{
    public string MessageId { get; set; }
    public List<JobStatusUpdate> Jobs { get; set; }
}

public class JobStatusUpdate
{
    public int JobIndex { get; set; }
    public bool IsCompleted { get; set; }
    public bool IsRunning { get; set; }
    public string CompletedBy { get; set; }
    public string RunningBy { get; set; }
    public string CompletedDate { get; set; } 
    public string RunningDate { get; set; } 
}

public class EntryPermitData
{
    public List<string> Sites { get; set; }
    public string Site { get; set; }
    public string Date { get; set; }
    public string DateLabel { get; set; }
    public List<EntryPermitPerson> Persons { get; set; }
    public List<string> Names { get; set; }
    public string FullName { get; set; }
    public string Company { get; set; }
    public List<string> CarNumbers { get; set; }
    public string CarNumber { get; set; }
    public string IdNumber { get; set; }
    public string Escort { get; set; }
    public string Time { get; set; }
    public string Phone { get; set; }
}

public class EntryPermitPerson
{
    public string Name { get; set; }
    public string CarNumber { get; set; }
    public string IdNumber { get; set; }
    public string Phone { get; set; }
}

public class FailedJobEntry
{
    public string Folder { get; set; }
    public string JobName { get; set; }
    public string Application { get; set; }
    public string SubApplication { get; set; }
    public int FailureCount { get; set; }
    public DateTime LastFailureTime { get; set; }
    public string RunTime { get; set; }
    public string EndTime { get; set; }
    public string Host { get; set; }
    public string RunId { get; set; }
    public string RunAsUser { get; set; }
}

public class ContactEntry
{
    public string JobName { get; set; }
    public string Email { get; set; }
    public string UserName { get; set; }
}

public class ContactInfo
{
    public string UserName { get; set; }
    public string Email { get; set; }
}

public class JobContactResult
{
    public string Folder { get; set; }
    public string JobName { get; set; }
    public int FailureCount { get; set; }
    public string LastFailureTime { get; set; }
    public string Application { get; set; }
    public string RunTime { get; set; }
    public string EndTime { get; set; }
    public string Host { get; set; }
    public string RunId { get; set; }
    public string RunAsUser { get; set; }
    public List<ContactInfo> Contacts { get; set; } = new List<ContactInfo>();
    public List<ResolvedContactInfo> ResolvedContacts { get; set; } = new();
}

public class PermanentAccessPerson
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; }
    public string Company { get; set; }
    public string CarNumber { get; set; }
    public string IdNumber { get; set; }
    public string Phone { get; set; }
    public string Notes { get; set; }
    public string AddedDate { get; set; } = 
        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
    public string AddedBy { get; set; }
    // אתרים מורשים: "ר\"ג", "פ\"ת", "שניהם"
    public List<string> AllowedSites { get; set; } = new List<string>();
}

public class SavePermanentAccessRequest
{
    public List<PermanentAccessPerson> Persons { get; set; }
}

public class EntryPermitEmailRequest
{
    public string Subject { get; set; }
    public string Body { get; set; }
    public List<string> ToAddresses { get; set; }
    public List<string> CcAddresses { get; set; }
}

public class ContactResolutionResult
{
    public string  UserName    { get; set; } = "";
    public string  Email       { get; set; } = "";
    // "jobs_contacts" | "phone_directory" | "phone_directory_partial"
    // "manager_fallback" | "manager_found_no_email" 
    // "org_tree_no_manager" | "not_found" | "empty"
    public string  Source      { get; set; } = "";
    public string? ManagerName { get; set; }
    public string? ManagerId   { get; set; }
    public string? Error       { get; set; }
}

public class ResolvedContactInfo
{
    public string  UserName    { get; set; } = "";
    public string  Email       { get; set; } = "";
    public string  Source      { get; set; } = "";
    public string? ManagerName { get; set; }
    public string? Error       { get; set; }
}