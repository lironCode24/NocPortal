// ChangesController.cs
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using System.Runtime.InteropServices;
using System.Web;
using NocPortal.Services;

public class ChangesController : Controller
{
    private const string CHANGES_FILE_PATH =
        @"R:\USERS\TASHTIT\NOC\CAB_Automation\results";
    private const string AGGREGATED_CHANGES_PATH =
        @"R:\USERS\TASHTIT\NOC\CAB_Automation\aggregated_changes.json";
    private const string OLD_SYSTEM_JSON_PATH =
        @"R:\USERS\TASHTIT\NOC\CAB_Automation\ONIT is going down\All regular changes requests - ONIT.json";
    private const string CAB_DECISIONS_PATH =
        @"R:\USERS\TASHTIT\NOC\CAB_Automation\cab_decisions.json";

    private const string ATTACHMENTS_BASE_PATH =
        @"R:\USERS\TASHTIT\NOC\CAB_Automation\attachments";

    // *** הוספה: נתיב קובץ ה-CSV של המערכת הישנה להעשרת נתונים ***
    private const string OLD_SYSTEM_CSV_PATH =
        @"R:\USERS\TASHTIT\NOC\CAB_Automation\Changes_NOC_Portal_ServiceNow.csv";

    private static readonly string _emailHtmlCachePath =
        Path.Combine(Path.GetTempPath(), "EmailHtmlCache");

    private static readonly TimeSpan _emailCacheDuration = 
        TimeSpan.FromDays(30);

    private const int PAGE_SIZE = 100;

    // ===== שדות לטיימר CAB יום חמישי =====
    private static System.Threading.Timer _thursdayCabEmailTimer = null;
    private static bool _thursdayCabEmailTimerInitialized = false;
    private static readonly object _cabTimerLock = new object();
    private static AuditLogService _auditLog;

    public ChangesController(AuditLogService auditLog)
    {
        _auditLog = auditLog;
        EnsureThursdayCabEmailTimerStarted();
    }

    // -------------------------------------------------------
    // GET /Changes/GetChanges?page=1&pageSize=100&search=
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult GetChanges(int page = 1, int pageSize = 100, string search = "")
    {
        try
        {
            SyncLatestCsvFile();

            List<ChangeItem> allChanges = LoadAggregatedChanges();

            if (!string.IsNullOrWhiteSpace(search))
            {
                search = search.ToLower();
                allChanges = allChanges.Where(c =>
                    (c.Number ?? "").ToLower().Contains(search) ||
                    (c.Name   ?? "").ToLower().Contains(search) ||
                    (c.Status ?? "").ToLower().Contains(search)
                ).ToList();
            }

            int totalCount = allChanges.Count;
            int totalPages = (int)Math.Ceiling((double)totalCount / pageSize);

            var pageItems = allChanges
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToList();

            return Json(new
            {
                success    = true,
                changes    = pageItems,
                pagination = new
                {
                    currentPage = page,
                    pageSize    = pageSize,
                    totalCount  = totalCount,
                    totalPages  = totalPages,
                    hasNext     = page < totalPages,
                    hasPrev     = page > 1
                }
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/GetChangesByMonth?month=5&year=2025
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult GetChangesByMonth(int month, int year)
    {
        try
        {
            SyncLatestCsvFile();

            List<ChangeItem> allChanges = LoadAggregatedChanges();

            var monthChanges = allChanges.Where(c =>
            {
                var dateObj = ParseDateString(c.Date);
                if (dateObj == null) return false;
                return dateObj.Value.Month == month &&
                       dateObj.Value.Year  == year;
            }).ToList();

            return Json(new
            {
                success = true,
                changes = monthChanges,
                month   = month,
                year    = year,
                count   = monthChanges.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // סנכרון קובץ CSV עדכני
    // -------------------------------------------------------
    private void SyncLatestCsvFile()
    {
        try
        {
            var directory = new DirectoryInfo(CHANGES_FILE_PATH);
            if (!directory.Exists) return;

            var latestFile = directory
                .GetFiles("Changes_NOC_Portal_*.csv")
                .OrderByDescending(f => f.LastWriteTime)
                .FirstOrDefault();

            if (latestFile == null) return;

            List<ChangeItem> aggregatedChanges = LoadAggregatedChanges();
            var newChanges = ReadNewSystemCsv(latestFile.FullName);
            MergeChanges(aggregatedChanges, newChanges);
            SaveAggregatedChanges(aggregatedChanges);
        }
        catch
        {
            // שגיאת סנכרון לא עוצרת את הטעינה
        }
    }

    // -------------------------------------------------------
    // POST /Changes/ImportOldSystemChanges
    // -------------------------------------------------------
    [HttpPost]
    public IActionResult ImportOldSystemChanges()
    {
        try
        {
            if (!System.IO.File.Exists(OLD_SYSTEM_JSON_PATH))
                return Json(new { success = false, message = "קובץ המערכת הישנה לא נמצא" });

            string jsonContent = System.IO.File.ReadAllText(OLD_SYSTEM_JSON_PATH, Encoding.UTF8);
            var oldChanges = ParseOldSystemJson(jsonContent);

            if (oldChanges == null || oldChanges.Count == 0)
                return Json(new { success = false, message = "לא נמצאו שינויים בקובץ" });

            List<ChangeItem> aggregatedChanges = LoadAggregatedChanges();

            int addedCount   = 0;
            int skippedCount = 0;

            foreach (var oldChange in oldChanges)
            {
                bool exists = aggregatedChanges.Any(c => c.Number == oldChange.Number);
                if (!exists)
                {
                    oldChange.Source = "ONIT";
                    aggregatedChanges.Add(oldChange);
                    addedCount++;
                }
                else
                {
                    skippedCount++;
                }
            }

            // *** הוספה: העשרת שינויי ONIT מקובץ ה-CSV ***
            int enrichedCount = EnrichFromCsvFile(aggregatedChanges);

            SaveAggregatedChanges(aggregatedChanges);

            return Json(new
            {
                success  = true,
                // *** הוספה: enrichedCount בהודעה ***
                message  = $"יובאו {addedCount} שינויים חדשים, " +
                           $"{skippedCount} כבר קיימים, " +
                           $"{enrichedCount} הועשרו מ-CSV",
                added    = addedCount,
                skipped  = skippedCount,
                enriched = enrichedCount,
                total    = aggregatedChanges.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // POST /Changes/UploadAttachment
    // העלאת קובץ/תמונה לשינוי ספציפי
    // -------------------------------------------------------
    [HttpPost]
    public async Task<IActionResult> UploadAttachment(
        [FromForm] string changeNumber,
        [FromForm] IFormFile file)
    {
        if (string.IsNullOrWhiteSpace(changeNumber))
            return Json(new { success = false, message = "מספר שינוי חסר" });

        if (file == null || file.Length == 0)
            return Json(new { success = false, message = "קובץ חסר" });

        // *** ולידציה: גודל מקסימלי 20MB ***
        const long MAX_SIZE = 20 * 1024 * 1024;
        if (file.Length > MAX_SIZE)
            return Json(new
            {
                success = false,
                message = "הקובץ גדול מדי (מקסימום 20MB)"
            });

        // *** ולידציה: סוגי קבצים מותרים ***
        var allowedExtensions = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
            ".pdf", ".doc", ".docx", ".xls", ".xlsx",
            ".txt", ".csv", ".zip", ".msg", ".eml"
        };

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExtensions.Contains(ext))
            return Json(new
            {
                success = false,
                message = $"סוג קובץ לא מותר: {ext}"
            });

        try
        {
            // *** יצירת תיקיית שינוי ***
            // נקה את מספר השינוי מתווים לא חוקיים
            var safeNumber = string.Concat(
                changeNumber.Where(c =>
                    char.IsLetterOrDigit(c) || c == '-' || c == '_'));

            var changeDir = Path.Combine(ATTACHMENTS_BASE_PATH, safeNumber);
            Directory.CreateDirectory(changeDir);

            // *** שם קובץ ייחודי: timestamp + שם מקורי ***
            var timestamp = DateTime.Now.ToString("yyyyMMdd_HHmmss");
            var safeFileName = Path.GetFileNameWithoutExtension(file.FileName);

            // נקה שם קובץ
            safeFileName = string.Concat(
                safeFileName.Where(c =>
                    char.IsLetterOrDigit(c) || c == '-' ||
                    c == '_' || c == ' '))
                .Trim()
                .Replace(' ', '_');

            if (string.IsNullOrEmpty(safeFileName))
                safeFileName = "file";

            var finalFileName = $"{timestamp}_{safeFileName}{ext}";
            var filePath = Path.Combine(changeDir, finalFileName);

            // *** שמירת הקובץ ***
            using (var stream = new FileStream(
                filePath, FileMode.Create, FileAccess.Write))
            {
                await file.CopyToAsync(stream);
            }

            // *** שמירת מטא-דאטה ***
            var meta = new AttachmentMeta
            {
                FileName     = finalFileName,
                OriginalName = file.FileName,
                ChangeNumber = changeNumber,
                UploadedAt   = DateTime.Now,
                FileSize     = file.Length,
                ContentType  = file.ContentType,
                Extension    = ext
            };

            SaveAttachmentMeta(changeNumber, meta);

            return Json(new
            {
                success      = true,
                fileName     = finalFileName,
                originalName = file.FileName,
                fileSize     = file.Length,
                contentType  = file.ContentType,
                uploadedAt   = meta.UploadedAt.ToString("dd/MM/yyyy HH:mm"),
                id           = meta.Id
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/GetAttachments?changeNumber=CRQ123
    // קבלת רשימת קבצים לשינוי
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult GetAttachments(string changeNumber)
    {
        if (string.IsNullOrWhiteSpace(changeNumber))
            return Json(new { success = false, message = "מספר שינוי חסר" });

        try
        {
            var attachments = LoadAttachmentsMeta(changeNumber);
            return Json(new { success = true, attachments });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/DownloadAttachment?changeNumber=X&fileName=Y
    // הורדת/צפייה בקובץ
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult DownloadAttachment(
        string changeNumber, string fileName)
    {
        if (string.IsNullOrWhiteSpace(changeNumber) ||
            string.IsNullOrWhiteSpace(fileName))
            return BadRequest("פרמטרים חסרים");

        // *** אבטחה: מנע path traversal ***
        if (fileName.Contains("..") || fileName.Contains("/") ||
            fileName.Contains("\\"))
            return BadRequest("שם קובץ לא חוקי");

        var safeNumber = string.Concat(
            changeNumber.Where(c =>
                char.IsLetterOrDigit(c) || c == '-' || c == '_'));

        var filePath = Path.Combine(
            ATTACHMENTS_BASE_PATH, safeNumber, fileName);

        if (!System.IO.File.Exists(filePath))
            return NotFound("קובץ לא נמצא");

        // *** ולידציה: הקובץ בתוך התיקייה המותרת ***
        var fullPath = Path.GetFullPath(filePath);
        var basePath = Path.GetFullPath(ATTACHMENTS_BASE_PATH);
        if (!fullPath.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
            return BadRequest("גישה לא מורשית");

        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        var contentType = GetContentType(ext);

        // *** תמונות ו-PDF - הצג inline; שאר - הורד ***
        var inlineTypes = new HashSet<string>
        {
            ".jpg", ".jpeg", ".png", ".gif", ".webp",
            ".bmp", ".pdf"
        };

        var disposition = inlineTypes.Contains(ext)
            ? "inline"
            : "attachment";

        // *** קרא מטא-דאטה לשם המקורי ***
        var metas = LoadAttachmentsMeta(changeNumber);
        var meta  = metas.FirstOrDefault(m => m.FileName == fileName);
        var displayName = meta?.OriginalName ?? fileName;

        Response.Headers.Add(
            "Content-Disposition",
            $"{disposition}; filename=\"{displayName}\"");

        return PhysicalFile(filePath, contentType);
    }

    // -------------------------------------------------------
    // DELETE /Changes/DeleteAttachment
    // מחיקת קובץ
    // -------------------------------------------------------
    [HttpPost]
    public IActionResult DeleteAttachment(
        [FromBody] DeleteAttachmentRequest request)
    {
        if (request == null ||
            string.IsNullOrWhiteSpace(request.ChangeNumber) ||
            string.IsNullOrWhiteSpace(request.FileName))
            return Json(new { success = false, message = "פרמטרים חסרים" });

        // *** אבטחה ***
        if (request.FileName.Contains("..") ||
            request.FileName.Contains("/") ||
            request.FileName.Contains("\\"))
            return Json(new { success = false, message = "שם קובץ לא חוקי" });

        try
        {
            var safeNumber = string.Concat(
                request.ChangeNumber.Where(c =>
                    char.IsLetterOrDigit(c) || c == '-' || c == '_'));

            var filePath = Path.Combine(
                ATTACHMENTS_BASE_PATH, safeNumber, request.FileName);

            if (System.IO.File.Exists(filePath))
                System.IO.File.Delete(filePath);

            // *** עדכן מטא-דאטה ***
            var metas = LoadAttachmentsMeta(request.ChangeNumber);
            metas.RemoveAll(m => m.FileName == request.FileName);
            SaveAllAttachmentsMeta(request.ChangeNumber, metas);

            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // עזר: ContentType לפי סיומת
    // -------------------------------------------------------
    private string GetContentType(string ext)
    {
        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png"            => "image/png",
            ".gif"            => "image/gif",
            ".webp"           => "image/webp",
            ".bmp"            => "image/bmp",
            ".pdf"            => "application/pdf",
            ".doc"            => "application/msword",
            ".docx"           => "application/vnd.openxmlformats-officedocument" +
                                ".wordprocessingml.document",
            ".xls"            => "application/vnd.ms-excel",
            ".xlsx"           => "application/vnd.openxmlformats-officedocument" +
                                ".spreadsheetml.sheet",
            ".txt"            => "text/plain",
            ".csv"            => "text/csv",
            ".zip"            => "application/zip",
            ".msg"            => "application/vnd.ms-outlook",
            ".eml"            => "message/rfc822",
            _                 => "application/octet-stream"
        };
    }

    // -------------------------------------------------------
    // עזר: שמירה/טעינה של מטא-דאטה
    // -------------------------------------------------------
    private string GetMetaFilePath(string changeNumber)
    {
        var safeNumber = string.Concat(
            changeNumber.Where(c =>
                char.IsLetterOrDigit(c) || c == '-' || c == '_'));

        var dir = Path.Combine(ATTACHMENTS_BASE_PATH, safeNumber);
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, "_meta.json");
    }

    private List<AttachmentMeta> LoadAttachmentsMeta(string changeNumber)
    {
        var path = GetMetaFilePath(changeNumber);
        if (!System.IO.File.Exists(path))
            return new List<AttachmentMeta>();

        try
        {
            var json = System.IO.File.ReadAllText(path);
            return JsonSerializer.Deserialize<List<AttachmentMeta>>(json)
                ?? new List<AttachmentMeta>();
        }
        catch { return new List<AttachmentMeta>(); }
    }

    private void SaveAttachmentMeta(
        string changeNumber, AttachmentMeta meta)
    {
        var metas = LoadAttachmentsMeta(changeNumber);

        // *** מנע כפילויות ***
        metas.RemoveAll(m => m.FileName == meta.FileName);
        metas.Add(meta);
        SaveAllAttachmentsMeta(changeNumber, metas);
    }

    private void SaveAllAttachmentsMeta(
        string changeNumber, List<AttachmentMeta> metas)
    {
        var path = GetMetaFilePath(changeNumber);
        var options = new JsonSerializerOptions { WriteIndented = true };
        System.IO.File.WriteAllText(
            path,
            JsonSerializer.Serialize(metas, options),
            Encoding.UTF8);
    }

    // -------------------------------------------------------
    // *** עזר: ניקוי HTML tags מטקסט ***
    // -------------------------------------------------------
    private string StripHtml(string input)
    {
        if (string.IsNullOrWhiteSpace(input)) return string.Empty;

        try
        {
            // *** הסרת HTML tags ***
            string stripped = System.Text.RegularExpressions.Regex.Replace(
                input, @"<[^>]+>", " ");

            // *** פענוח HTML entities נפוצים ***
            stripped = stripped
                .Replace("&nbsp;",  " ")
                .Replace("&amp;",   "&")
                .Replace("&lt;",    "<")
                .Replace("&gt;",    ">")
                .Replace("&quot;",  "\"")
                .Replace("&#39;",   "'")
                .Replace("&apos;",  "'");

            // *** הסרת רווחים כפולים וניקוי שורות ריקות ***
            stripped = System.Text.RegularExpressions.Regex.Replace(
                stripped, @"\s{2,}", " ");

            return stripped.Trim();
        }
        catch
        {
            return input;
        }
    }

    // -------------------------------------------------------
    // *** מתודה חדשה: העשרת שינויי ONIT מקובץ ה-CSV ***
    // קורא את קובץ ה-CSV של המערכת הישנה ומעדכן:
    // Status, Presenters, Link לפי מספר שינוי תואם
    // -------------------------------------------------------
    private int EnrichFromCsvFile(List<ChangeItem> changes)
    {
        if (!System.IO.File.Exists(OLD_SYSTEM_CSV_PATH))
            return 0;

        int enrichedCount = 0;

        try
        {
            var lines = System.IO.File.ReadAllLines(OLD_SYSTEM_CSV_PATH, Encoding.UTF8);
            if (lines.Length <= 1) return 0;

            var headers = ParseCsvLine(lines[0]);

            // *** תיקון: שמות העמודות האמיתיים בקובץ ***
            int numberIndex    = FindColumnIndex(headers, "מספר");
            int nameIndex      = FindColumnIndex(headers, "כותרת");
            int dateIndex      = FindColumnIndex(headers, "זמן התחלה מתוכנן");
            int statusIndex    = FindColumnIndex(headers, "מצב");
            int presenterIndex = FindColumnIndex(headers, "גורם מטפל");

            // עמודות נוספות שאולי שימושיות
            int teamIndex      = FindColumnIndex(headers, "צוות מטפל");
            int systemIndex    = FindColumnIndex(headers, "מערכת");
            int riskIndex      = FindColumnIndex(headers, "סיכון");

            if (numberIndex == -1)
            {
                // לוג לדיאגנוסטיקה אם עמודת מספר לא נמצאה
                return 0;
            }

            // בניית מילון: מספר שינוי -> עמודות השורה
            var csvLookup = new Dictionary<string, string[]>(
                StringComparer.OrdinalIgnoreCase);

            for (int i = 1; i < lines.Length; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;

                var cols = ParseCsvLine(lines[i]);
                if (cols.Length <= numberIndex) continue;

                string num = cols[numberIndex].Trim();
                if (!string.IsNullOrWhiteSpace(num))
                    csvLookup[num] = cols;
            }

            // עדכון שינויי ONIT לפי התאמת מספר
            foreach (var change in changes.Where(c => c.Source == "ONIT"))
            {
                // *** ניסיון התאמה ישירה ואחר כך עם נרמול ***
                string[] cols = null;

                if (!csvLookup.TryGetValue(change.Number, out cols))
                {
                    // *** נרמול: הסרת אפסים מובילים והתאמה מחדש ***
                    string normalized = change.Number.TrimStart('0');
                    csvLookup.TryGetValue(normalized, out cols);
                }

                if (cols == null) continue;

                bool wasEnriched = false;

                // *** עדכון שם (כותרת) ***
                if (nameIndex != -1 && cols.Length > nameIndex)
                {
                    string val = cols[nameIndex].Trim();
                    if (!string.IsNullOrWhiteSpace(val) &&
                        string.IsNullOrWhiteSpace(change.Name))
                    { change.Name = val; wasEnriched = true; }
                }

                // *** עדכון תאריך (זמן התחלה מתוכנן) ***
                if (dateIndex != -1 && cols.Length > dateIndex)
                {
                    string val = cols[dateIndex].Trim();
                    if (!string.IsNullOrWhiteSpace(val) &&
                        string.IsNullOrWhiteSpace(change.Date))
                    { change.Date = val; wasEnriched = true; }
                }

                // *** עדכון סטטוס (מצב) - תמיד מעדכן מה-CSV ***
                if (statusIndex != -1 && cols.Length > statusIndex)
                {
                    string val = cols[statusIndex].Trim();
                    if (!string.IsNullOrWhiteSpace(val))
                    { change.Status = val; wasEnriched = true; }
                }

                // *** עדכון מציג (גורם מטפל) - תמיד מעדכן מה-CSV ***
                if (presenterIndex != -1 && cols.Length > presenterIndex)
                {
                    string val = cols[presenterIndex].Trim();
                    if (!string.IsNullOrWhiteSpace(val))
                    { change.Presenters = val; wasEnriched = true; }
                }

                // *** עדכון הערות: הוספת מערכת + סיכון אם קיימים ***
                // *** אחרי - עם ניקוי HTML ***
                if (systemIndex != -1 && cols.Length > systemIndex)
                {
                    string sys = cols[systemIndex].Trim();
                    if (!string.IsNullOrWhiteSpace(sys))
                    {
                        string prefix = $"מערכת: {sys}";
                        if (!change.Notes.Contains(prefix))
                        {
                            // *** ניקוי HTML מה-Notes הקיים לפני הוספה ***
                            string cleanNotes = StripHtml(change.Notes);

                            change.Notes = string.IsNullOrWhiteSpace(cleanNotes)
                                ? prefix
                                : $"{prefix} | {cleanNotes}";
                            wasEnriched = true;
                        }
                    }
                }

                if (riskIndex != -1 && cols.Length > riskIndex)
                {
                    string risk = cols[riskIndex].Trim();
                    if (!string.IsNullOrWhiteSpace(risk))
                    {
                        string prefix = $"סיכון: {risk}";
                        if (!change.Notes.Contains(prefix))
                        {
                            // *** ניקוי HTML מה-Notes הקיים לפני הוספה ***
                            string cleanNotes = StripHtml(change.Notes);

                            change.Notes = string.IsNullOrWhiteSpace(cleanNotes)
                                ? prefix
                                : $"{cleanNotes} | {prefix}";
                            wasEnriched = true;
                        }
                    }
                }

                if (wasEnriched) enrichedCount++;
            }
        }
        catch
        {
            // שגיאת העשרה לא עוצרת את הייבוא
        }

        return enrichedCount;
    }

    // -------------------------------------------------------
    // *** עזר: מציאת אינדקס עמודה לפי רשימת שמות אפשריים ***
    // -------------------------------------------------------
    private int FindColumnIndex(string[] headers, params string[] names)
    {
        foreach (var name in names)
        {
            int idx = Array.IndexOf(headers, name);
            if (idx != -1) return idx;
        }
        return -1;
    }

    // -------------------------------------------------------
    // קריאת CSV מהמערכת החדשה - *** תיקון: הוספת קישור לשינוי ***
    // -------------------------------------------------------
    private List<ChangeItem> ReadNewSystemCsv(string filePath)
    {
        var result = new List<ChangeItem>();
        var lines  = System.IO.File.ReadAllLines(filePath, Encoding.UTF8);
        if (lines.Length <= 1) return result;

        var headers = ParseCsvLine(lines[0]);

        // *** עמודות בסיסיות ***
        int linkIndex           = Array.IndexOf(headers, "קישור לשינוי");
        int changeNumberIndex   = Array.IndexOf(headers, "מספר שינוי");
        int changeNameIndex     = Array.IndexOf(headers, "שם השינוי");
        int changeDateIndex     = Array.IndexOf(headers, "תאריך השינוי");
        int presentersIndex     = Array.IndexOf(headers, "מציגים");
        int notesIndex          = Array.IndexOf(headers, "הערות");
        int statusIndex         = Array.IndexOf(headers, "סטטוס");
        int needCabIndex        = Array.IndexOf(headers, "Need CAB?");
        int cabDateIndex        = Array.IndexOf(headers, "CAB date");

        // *** עמודות נוספות ***
        int systemIndex         = Array.IndexOf(headers, "מערכת");
        int companyIndex        = Array.IndexOf(headers, "חברה");
        int excerptIndex        = Array.IndexOf(headers, "Excerpt");
        int serviceDescIndex    = Array.IndexOf(headers, "Service Description");
        int changeTypeIndex     = Array.IndexOf(headers, "סוג שינוי");
        int plannedStartIndex   = Array.IndexOf(headers, "זמן התחלה מתוכנן");
        int plannedEndIndex     = Array.IndexOf(headers, "זמן סיום מתוכנן");
        int actualStartIndex = Array.IndexOf(headers, "זמן התחלה בפועל");
        int actualEndIndex   = Array.IndexOf(headers, "זמן סיום בפועל");
        int summaryIndex        = Array.IndexOf(headers, "תקציר");
        int descriptionIndex    = Array.IndexOf(headers, "תיאור");
        int changeNeedIndex     = Array.IndexOf(headers, "הצורך לביצוע השינוי");
        int implPlanIndex       = Array.IndexOf(headers, "תוכנית יישום");
        int possFailIndex       = Array.IndexOf(headers, "תקלות אפשריות");
        int rollbackIndex       = Array.IndexOf(headers, "תוכנית חזרה לאחור");
        int testPlanIndex       = Array.IndexOf(headers, "תוכנית בדיקה");
        int supportOrgIndex     = Array.IndexOf(headers, "Support Organization");
        int execTeamIndex       = Array.IndexOf(headers, "צוות מבצע");
        int teamLeaderIndex     = Array.IndexOf(headers, "ראש צוות מבצע");
        int directMgrIndex      = Array.IndexOf(headers, "מנהל ישיר של ראש צוות מבצע");
        int divMgrIndex         = Array.IndexOf(headers, "מנהל אגף של ראש צוות מבצע");
        int involvedTeamsIndex  = Array.IndexOf(headers, "צוותים מעורבים");
        int vendorInvIndex      = Array.IndexOf(headers, "מעורב ספק");
        int vendorNameIndex     = Array.IndexOf(headers, "שם הספק");
        int moduleIndex         = Array.IndexOf(headers, "מודול/תהליך");
        int categoryIndex       = Array.IndexOf(headers, "קטגוריית שינוי");
        int environmentIndex    = Array.IndexOf(headers, "סביבת השינוי");
        int changeReasonIndex = Array.IndexOf(headers, "סיבת שינוי");

        // *** עמודות סיכון ***
        int regRiskIndex        = Array.IndexOf(headers, "האם כישלון השינוי עשוי להוביל לנזק כספי או לפגיעה במחויבות רגולטורית");
        int coreSystemsIndex    = Array.IndexOf(headers, "האם השינוי משפיע על מערכות ליבה");
        int multiSystemsIndex   = Array.IndexOf(headers, "האם השינוי משפיע על יותר ממערכת אחת");
        int affCustIndex        = Array.IndexOf(headers, "האם השינוי משפיע על לקוחות הארגון");
        int affUsersIndex       = Array.IndexOf(headers, "האם השינוי משפיע על משתמשי מערכת");
        int bizHoursIndex       = Array.IndexOf(headers, "האם השינוי מתוכנן להתבצע במהלך שעות פעילות עסקית");
        int archChangeIndex     = Array.IndexOf(headers, "האם השינוי כולל שינוי בארכיטקטורה");
        int multiTeamsIndex     = Array.IndexOf(headers, "האם מעורבים יותר מצוות אחד ביישום השינוי");
        int knowledgeIndex      = Array.IndexOf(headers, "האם קיימים פערי ידע לצוות המיישם לצורך ביצוע המשימה");
        int bizTestsIndex       = Array.IndexOf(headers, "האם נדרשות בדיקות מטעם משתמש עסקי");
        int lowerEnvIndex       = Array.IndexOf(headers, "האם הבדיקה בסביבות נמוכות נכשלה");

        // *** ולידציה: עמודות חובה ***
        if (changeNumberIndex == -1 || changeNameIndex == -1 || changeDateIndex == -1)
            throw new Exception(
                $"עמודות חובה חסרות בקובץ CSV. " +
                $"נמצאו: {string.Join(", ", headers.Take(10))}");

        // *** פונקציית עזר: קריאה בטוחה של עמודה ***
        string SafeGet(string[] cols, int idx)
        {
            if (idx == -1 || idx >= cols.Length) return string.Empty;
            return cols[idx].Trim();
        }

        for (int i = 1; i < lines.Length; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i])) continue;

            var columns = ParseCsvLine(lines[i]);

            // *** ולידציה: שורה חייבת להכיל לפחות את עמודות החובה ***
            int maxRequired = Math.Max(
                Math.Max(changeNumberIndex, changeNameIndex),
                changeDateIndex
            );
            if (columns.Length <= maxRequired) continue;

            var change = new ChangeItem
            {
                // *** שדות בסיסיים ***
                Number              = SafeGet(columns, changeNumberIndex),
                Name                = SafeGet(columns, changeNameIndex),
                Date                = SafeGet(columns, changeDateIndex),
                Link                = SafeGet(columns, linkIndex),
                Status              = SafeGet(columns, statusIndex),
                Notes               = SafeGet(columns, notesIndex),
                Presenters          = SafeGet(columns, presentersIndex),
                NeedCab             = SafeGet(columns, needCabIndex),
                CabDate             = SafeGet(columns, cabDateIndex),

                // *** שדות נוספים ***
                System              = SafeGet(columns, systemIndex),
                Company             = SafeGet(columns, companyIndex),
                Excerpt             = SafeGet(columns, excerptIndex),
                ServiceDescription  = SafeGet(columns, serviceDescIndex),
                ChangeType          = SafeGet(columns, changeTypeIndex),
                PlannedStartTime    = SafeGet(columns, plannedStartIndex),
                PlannedEndTime      = SafeGet(columns, plannedEndIndex),
                ActualStartTime = SafeGet(columns, actualStartIndex),
                ActualEndTime   = SafeGet(columns, actualEndIndex),
                Description         = SafeGet(columns, descriptionIndex),
                ChangeNeed          = SafeGet(columns, changeNeedIndex),
                ImplementationPlan  = SafeGet(columns, implPlanIndex),
                PossibleFailures    = SafeGet(columns, possFailIndex),
                RollbackPlan        = SafeGet(columns, rollbackIndex),
                TestPlan            = SafeGet(columns, testPlanIndex),
                SupportOrganization = SafeGet(columns, supportOrgIndex),
                ExecutingTeam       = SafeGet(columns, execTeamIndex),
                TeamLeader          = SafeGet(columns, teamLeaderIndex),
                DirectManager       = SafeGet(columns, directMgrIndex),
                DivisionManager     = SafeGet(columns, divMgrIndex),
                InvolvedTeams       = SafeGet(columns, involvedTeamsIndex),
                VendorInvolved      = SafeGet(columns, vendorInvIndex),
                VendorName          = SafeGet(columns, vendorNameIndex),
                ModuleProcess       = SafeGet(columns, moduleIndex),
                ChangeCategory      = SafeGet(columns, categoryIndex),
                Environment         = SafeGet(columns, environmentIndex),
                ChangeReason = SafeGet(columns, changeReasonIndex),

                // *** שדות סיכון ***
                RegulatoryRisk          = SafeGet(columns, regRiskIndex),
                AffectsCoreSystems      = SafeGet(columns, coreSystemsIndex),
                AffectsMultipleSystems  = SafeGet(columns, multiSystemsIndex),
                AffectsCustomers        = SafeGet(columns, affCustIndex),
                AffectsSystemUsers      = SafeGet(columns, affUsersIndex),
                DuringBusinessHours     = SafeGet(columns, bizHoursIndex),
                ArchitectureChange      = SafeGet(columns, archChangeIndex),
                MultipleTeams           = SafeGet(columns, multiTeamsIndex),
                KnowledgeGaps           = SafeGet(columns, knowledgeIndex),
                BusinessTestsRequired   = SafeGet(columns, bizTestsIndex),
                LowerEnvTestsFailed     = SafeGet(columns, lowerEnvIndex),

                Source = "NEW"
            };

            // *** תיקון: שדה Excerpt - אם ריק, קח מ-summaryIndex ***
            if (string.IsNullOrWhiteSpace(change.Excerpt) && summaryIndex != -1)
                change.Excerpt = SafeGet(columns, summaryIndex);

            if (!string.IsNullOrWhiteSpace(change.Number))
                result.Add(change);
        }

        return result;
    }

    // -------------------------------------------------------
    // פרסור JSON מהמערכת הישנה - ללא שינוי
    // -------------------------------------------------------
    private List<ChangeItem> ParseOldSystemJson(string jsonContent)
    {
        var result = new List<ChangeItem>();

        using var doc  = JsonDocument.Parse(jsonContent);
        var root       = doc.RootElement;
        JsonElement itemsArray;

        if (root.ValueKind == JsonValueKind.Array)
        {
            itemsArray = root;
        }
        else
        {
            itemsArray = default;
            bool found = root.TryGetProperty("changes", out itemsArray) ||
                         root.TryGetProperty("result",  out itemsArray) ||
                         root.TryGetProperty("records", out itemsArray);

            if (!found)
            {
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.Value.ValueKind == JsonValueKind.Array)
                    {
                        itemsArray = prop.Value;
                        break;
                    }
                }
            }

            if (itemsArray.ValueKind != JsonValueKind.Array)
                return result;
        }

        foreach (var item in itemsArray.EnumerateArray())
        {
            string number = GetJsonStringValue(item,
                "number", "Number", "change_number", "מספר שינוי");
            string name   = GetJsonStringValue(item,
                "short_description", "name", "Name", "title", "שם השינוי");
            string date   = GetJsonStringValue(item,
                "start_date", "planned_start_date", "date", "Date", "תאריך השינוי");
            string status = GetJsonStringValue(item,
                "state", "status", "Status", "סטטוס");
            string notes  = GetJsonStringValue(item,
                "description", "notes", "Notes", "הערות");

            if (string.IsNullOrWhiteSpace(number)) continue;

            result.Add(new ChangeItem
            {
                Number = number,
                Name   = StripHtml(name),
                Date   = date,
                Status = StripHtml(status),
                Notes  = StripHtml(notes),
                Source = "ONIT"
            });
        }

        return result;
    }

    // -------------------------------------------------------
    // שאר המתודות - ללא שינוי
    // -------------------------------------------------------
    private DateTime? ParseDateString(string dateString)
    {
        if (string.IsNullOrWhiteSpace(dateString)) return null;
        try
        {
            var formats = new[]
            {
                @"(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2,4})",
                @"(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})"
            };

            foreach (var fmt in formats)
            {
                var match = System.Text.RegularExpressions.Regex.Match(dateString, fmt);
                if (!match.Success) continue;

                int day, month, year;

                if (match.Groups[1].Value.Length == 4)
                {
                    year  = int.Parse(match.Groups[1].Value);
                    month = int.Parse(match.Groups[2].Value);
                    day   = int.Parse(match.Groups[3].Value);
                }
                else
                {
                    day   = int.Parse(match.Groups[1].Value);
                    month = int.Parse(match.Groups[2].Value);
                    year  = int.Parse(match.Groups[3].Value);
                    if (year < 100) year += 2000;
                }

                return new DateTime(year, month, day, 12, 0, 0);
            }

            if (DateTime.TryParse(dateString, out var parsed))
                return parsed;

            return null;
        }
        catch { return null; }
    }

    private string GetJsonStringValue(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var prop))
                return prop.ValueKind == JsonValueKind.Null
                    ? string.Empty
                    : prop.GetString() ?? string.Empty;
        }
        return string.Empty;
    }

    private List<ChangeItem> LoadAggregatedChanges()
    {
        if (!System.IO.File.Exists(AGGREGATED_CHANGES_PATH))
            return new List<ChangeItem>();
        try
        {
            string json = System.IO.File.ReadAllText(AGGREGATED_CHANGES_PATH);
            return JsonSerializer.Deserialize<List<ChangeItem>>(json)
                   ?? new List<ChangeItem>();
        }
        catch { return new List<ChangeItem>(); }
    }

    private void SaveAggregatedChanges(List<ChangeItem> changes)
    {
        var options = new JsonSerializerOptions { WriteIndented = true };
        System.IO.File.WriteAllText(
            AGGREGATED_CHANGES_PATH,
            JsonSerializer.Serialize(changes, options),
            Encoding.UTF8
        );
    }

    private void MergeChanges(List<ChangeItem> existing, List<ChangeItem> newItems)
    {
        foreach (var newChange in newItems)
        {
            var found = existing.FirstOrDefault(c => c.Number == newChange.Number);
            if (found == null)
            {
                existing.Add(newChange);
            }
            else
            {
                // *** עדכון כל השדות ***
                found.Name                  = newChange.Name;
                found.Date                  = newChange.Date;
                found.Status                = newChange.Status;
                found.Notes                 = newChange.Notes;
                found.Presenters            = newChange.Presenters;
                found.NeedCab               = newChange.NeedCab;
                found.CabDate               = newChange.CabDate;
                found.System                = newChange.System;
                found.Company               = newChange.Company;
                found.Excerpt               = newChange.Excerpt;
                found.ServiceDescription    = newChange.ServiceDescription;
                found.ChangeType            = newChange.ChangeType;
                found.PlannedStartTime      = newChange.PlannedStartTime;
                found.PlannedEndTime        = newChange.PlannedEndTime;
                found.ActualStartTime = newChange.ActualStartTime;
                found.ActualEndTime   = newChange.ActualEndTime;
                found.Description           = newChange.Description;
                found.ChangeNeed            = newChange.ChangeNeed;
                found.ImplementationPlan    = newChange.ImplementationPlan;
                found.PossibleFailures      = newChange.PossibleFailures;
                found.RollbackPlan          = newChange.RollbackPlan;
                found.TestPlan              = newChange.TestPlan;
                found.SupportOrganization   = newChange.SupportOrganization;
                found.ExecutingTeam         = newChange.ExecutingTeam;
                found.TeamLeader            = newChange.TeamLeader;
                found.DirectManager         = newChange.DirectManager;
                found.DivisionManager       = newChange.DivisionManager;
                found.InvolvedTeams         = newChange.InvolvedTeams;
                found.VendorInvolved        = newChange.VendorInvolved;
                found.VendorName            = newChange.VendorName;
                found.ModuleProcess         = newChange.ModuleProcess;
                found.ChangeCategory        = newChange.ChangeCategory;
                found.Environment           = newChange.Environment;
                found.RegulatoryRisk        = newChange.RegulatoryRisk;
                found.AffectsCoreSystems    = newChange.AffectsCoreSystems;
                found.AffectsMultipleSystems= newChange.AffectsMultipleSystems;
                found.AffectsCustomers      = newChange.AffectsCustomers;
                found.AffectsSystemUsers    = newChange.AffectsSystemUsers;
                found.DuringBusinessHours   = newChange.DuringBusinessHours;
                found.ArchitectureChange    = newChange.ArchitectureChange;
                found.MultipleTeams         = newChange.MultipleTeams;
                found.KnowledgeGaps         = newChange.KnowledgeGaps;
                found.BusinessTestsRequired = newChange.BusinessTestsRequired;
                found.LowerEnvTestsFailed   = newChange.LowerEnvTestsFailed;
                found.ChangeReason = newChange.ChangeReason;
                
                if (!string.IsNullOrEmpty(newChange.Link))
                    found.Link = newChange.Link;
            }
        }
    }

    private string[] ParseCsvLine(string line)
    {
        var result    = new List<string>();
        var current   = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];

            if (c == '"')
            {
                // מרכאות כפולות בתוך שדה מוקף = escape
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Append('"');
                    i++;
                }
                // פתיחת שדה מוקף - רק אם אנחנו בתחילת שדה (current ריק)
                else if (!inQuotes && current.Length == 0)
                {
                    inQuotes = true;
                }
                // סגירת שדה מוקף
                else if (inQuotes)
                {
                    inQuotes = false;
                }
                else
                {
                    // מרכאה באמצע שדה לא מוקף (כמו מוצא"ש) - התייחס כתו רגיל
                    current.Append(c);
                }
            }
            else if (c == ',' && !inQuotes)
            {
                result.Add(current.ToString().Trim());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        result.Add(current.ToString().Trim());
        return result.ToArray();
    }

    [HttpGet]
    public IActionResult GetCabDateRange()
    {
        var (from, to) = GetCurrentCabDateRange();

        return Json(new
        {
            success  = true,
            from     = from.ToString("dd/MM/yyyy"),
            to       = to.ToString("dd/MM/yyyy"),
            fromDate = from.ToString("yyyy-MM-dd"),
            toDate   = to.ToString("yyyy-MM-dd")
        });
    }

    // -------------------------------------------------------
    // POST /Changes/SendCalendarInvite
    // שליחת הזמנת פגישה במייל דרך EmailService
    // -------------------------------------------------------
    [HttpPost]
    public async Task<IActionResult> SendCalendarInvite(
        [FromBody] CalendarInviteRequest request)
    {
        if (request == null ||
            string.IsNullOrWhiteSpace(request.ChangeNumber) ||
            string.IsNullOrWhiteSpace(request.ToEmail))
            return Json(new { success = false, message = "נתונים חסרים" });

        try
        {
            var emailService = HttpContext.RequestServices
                .GetRequiredService<NocPortal.Services.EmailService>();

            var (success, message) = await emailService
                .SendCalendarInviteEmailAsync(request);

            return Json(new { success, message });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/CheckIfRefreshNeeded
    // מחזיר האם הקובץ האחרון ישן מ-2 שעות
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult CheckIfRefreshNeeded()
    {
        try
        {
            var directory = new DirectoryInfo(CHANGES_FILE_PATH);
            if (!directory.Exists)
                return Json(new { needed = false, reason = "תיקייה לא קיימת" });

            var latestFile = directory
                .GetFiles("Changes_NOC_Portal_*.csv")
                .OrderByDescending(f => f.LastWriteTime)
                .FirstOrDefault();

            if (latestFile == null)
                return Json(new { needed = true, reason = "לא נמצא קובץ" });

            var age = DateTime.Now - latestFile.LastWriteTime;
            bool needed = age.TotalHours > 2;

            return Json(new
            {
                needed        = needed,
                lastFileTime  = latestFile.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"),
                ageMinutes    = (int)age.TotalMinutes,
                fileName      = latestFile.Name
            });
        }
        catch (Exception ex)
        {
            return Json(new { needed = false, reason = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/ConvertEmailToHtml?changeNumber=X&fileName=Y
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult ConvertEmailToHtml(
        string changeNumber, string fileName)
    {
        if (string.IsNullOrWhiteSpace(changeNumber) ||
            string.IsNullOrWhiteSpace(fileName))
            return Json(new { success = false, error = "פרמטרים חסרים" });

        if (fileName.Contains("..") || fileName.Contains("/") ||
            fileName.Contains("\\"))
            return Json(new { success = false, error = "שם קובץ לא חוקי" });

        var safeNumber = string.Concat(
            changeNumber.Where(c =>
                char.IsLetterOrDigit(c) || c == '-' || c == '_'));

        var filePath = Path.Combine(
            ATTACHMENTS_BASE_PATH, safeNumber, fileName);

        if (!System.IO.File.Exists(filePath))
            return Json(new { success = false, error = "קובץ לא נמצא" });

        try
        {
            // *** בדוק cache קודם ***
            var cachedHtml = TryGetEmailFromCache(filePath);
            if (cachedHtml != null)
                return Json(new { success = true, htmlContent = cachedHtml });

            var ext = Path.GetExtension(fileName).ToLowerInvariant();
            string htmlContent;

            if (ext == ".eml" || ext == ".msg")
                htmlContent = ConvertEmlToHtml(filePath);
            else
                return Json(new
                {
                    success = false,
                    error   = $"סוג קובץ לא נתמך: {ext}"
                });

            // *** שמור ב-cache ***
            SaveEmailToCache(filePath, htmlContent);

            return Json(new { success = true, htmlContent });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    private string TryGetEmailFromCache(string originalFilePath)
    {
        try
        {
            Directory.CreateDirectory(_emailHtmlCachePath);
            
            var cacheKey = Convert.ToBase64String(
                System.Security.Cryptography.MD5.HashData(
                    Encoding.UTF8.GetBytes(originalFilePath)))
                .Replace("/", "_").Replace("+", "-");
            
            var cachePath = Path.Combine(
                _emailHtmlCachePath, cacheKey + ".html");
            
            if (!System.IO.File.Exists(cachePath)) return null;
            
            var cacheInfo = new FileInfo(cachePath);
            var originalInfo = new FileInfo(originalFilePath);
            
            // Cache תקף אם: לא עבר שבוע AND הקובץ המקורי לא השתנה
            if (DateTime.Now - cacheInfo.LastWriteTime > _emailCacheDuration)
            {
                System.IO.File.Delete(cachePath);
                return null;
            }
            
            if (originalInfo.LastWriteTime > cacheInfo.LastWriteTime)
            {
                System.IO.File.Delete(cachePath);
                return null;
            }
            
            return System.IO.File.ReadAllText(cachePath, Encoding.UTF8);
        }
        catch { return null; }
    }

    private void SaveEmailToCache(string originalFilePath, string htmlContent)
    {
        try
        {
            Directory.CreateDirectory(_emailHtmlCachePath);
            
            var cacheKey = Convert.ToBase64String(
                System.Security.Cryptography.MD5.HashData(
                    Encoding.UTF8.GetBytes(originalFilePath)))
                .Replace("/", "_").Replace("+", "-");
            
            var cachePath = Path.Combine(
                _emailHtmlCachePath, cacheKey + ".html");
            
            System.IO.File.WriteAllText(cachePath, htmlContent, Encoding.UTF8);
            
            // *** ניקוי cache ישן (מעל שבוע) ***
            CleanOldEmailCache();
        }
        catch { /* שגיאת cache לא קריטית */ }
    }

    private void CleanOldEmailCache()
    {
        try
        {
            if (!Directory.Exists(_emailHtmlCachePath)) return;
            
            var oldFiles = new DirectoryInfo(_emailHtmlCachePath)
                .GetFiles("*.html")
                .Where(f => DateTime.Now - f.LastWriteTime > _emailCacheDuration);
            
            foreach (var f in oldFiles)
                try { f.Delete(); } catch { }
        }
        catch { }
    }

    // -------------------------------------------------------
    // עזר: חילוץ חלק HTML מ-MIME multipart
    // -------------------------------------------------------
    private string ExtractHtmlPartFromMime(string content, string boundary)
    {
        var parts = content.Split(
            new[] { "--" + boundary }, StringSplitOptions.None);

        foreach (var part in parts)
        {
            if (part.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                // מצא את גוף החלק (אחרי שורה ריקה)
                int emptyLine = part.IndexOf("\n\n");
                if (emptyLine == -1) emptyLine = part.IndexOf("\r\n\r\n");
                if (emptyLine == -1) continue;

                string partBody = part.Substring(emptyLine).Trim();

                // בדוק אם base64
                if (part.Contains("base64",
                    StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var cleaned = partBody.Replace("\r", "")
                                            .Replace("\n", "")
                                            .Trim();
                        var decoded = Convert.FromBase64String(cleaned);
                        return Encoding.UTF8.GetString(decoded);
                    }
                    catch { return partBody; }
                }

                return partBody;
            }
        }

        // fallback - חלץ text/plain
        foreach (var part in parts)
        {
            if (part.Contains("text/plain",
                StringComparison.OrdinalIgnoreCase))
            {
                int emptyLine = part.IndexOf("\n\n");
                if (emptyLine == -1) continue;
                string partBody = part.Substring(emptyLine).Trim();
                return $"<pre style='white-space:pre-wrap'>" +
                    $"{System.Net.WebUtility.HtmlEncode(partBody)}</pre>";
            }
        }

        return content;
    }

    // -------------------------------------------------------
    // עזר: פענוד encoded-words RFC 2047
    // -------------------------------------------------------
    private string DecodeEncodedWords(string input)
    {
        if (string.IsNullOrEmpty(input)) return input;

        return System.Text.RegularExpressions.Regex.Replace(
            input,
            @"=\?([^?]+)\?([BbQq])\?([^?]*)\?=",
            m =>
            {
                try
                {
                    string charset  = m.Groups[1].Value;
                    string encoding = m.Groups[2].Value.ToUpper();
                    string encoded  = m.Groups[3].Value;

                    var enc = Encoding.GetEncoding(charset);

                    if (encoding == "B")
                    {
                        var bytes = Convert.FromBase64String(encoded);
                        return enc.GetString(bytes);
                    }
                    else if (encoding == "Q")
                    {
                        encoded = encoded.Replace("_", " ");
                        var sb = new StringBuilder();
                        for (int i = 0; i < encoded.Length; i++)
                        {
                            if (encoded[i] == '=' && i + 2 < encoded.Length)
                            {
                                var hex = encoded.Substring(i + 1, 2);
                                sb.Append((char)Convert.ToInt32(hex, 16));
                                i += 2;
                            }
                            else sb.Append(encoded[i]);
                        }
                        return sb.ToString();
                    }
                }
                catch { }
                return m.Value;
            });
    }

    // -------------------------------------------------------
    // עזר: המרת EML ל-HTML - באמצעות Outlook COM (כמו MSG)
    // -------------------------------------------------------
    private string ConvertEmlToHtml(string emlPath)
    {
        dynamic outlookApp = null;
        dynamic msgItem = null;
        string tempHtmlPath = null;
        var htmlBuilder = new StringBuilder();

        try
        {
            // *** יצירת תיקייה זמנית ***
            string tempDir = Path.Combine(Path.GetTempPath(), "EmailViewer");
            Directory.CreateDirectory(tempDir);
            tempHtmlPath = Path.Combine(tempDir, $"{Guid.NewGuid()}.html");

            // *** נסה להשתמש ב-Outlook COM API ***
            Type outlookType = Type.GetTypeFromProgID("Outlook.Application");
            if (outlookType == null)
            {
                // *** Fallback: פרסור ידני אם Outlook לא מותקן ***
                return ConvertEmlToHtmlFallback(emlPath);
            }

            outlookApp = Activator.CreateInstance(outlookType);

            // *** פתח את קובץ ה-EML ***
            msgItem = outlookApp.CreateItemFromTemplate(emlPath);

            // *** קרא פרטים ישירות מה-COM object ***
            string subject = "";
            try { subject = msgItem.Subject; } catch { }

            string body = "";
            try { body = msgItem.HTMLBody; } catch { }

            string sender = "";
            try { sender = msgItem.SenderName; } catch { }

            string recipients = "";
            try
            {
                dynamic recipientsObj = msgItem.Recipients;
                var recipientsList = new List<string>();
                for (int i = 1; i <= recipientsObj.Count; i++)
                {
                    dynamic recipient = recipientsObj[i];
                    recipientsList.Add(recipient.Name);
                }
                recipients = string.Join("; ", recipientsList);
            }
            catch { }

            string sentDate = "";
            try { sentDate = msgItem.SentOn.ToString("dd/MM/yyyy HH:mm"); }
            catch { }

            // *** אם הצלחנו לקרוא את הגוף ישירות ***
            if (!string.IsNullOrEmpty(body))
            {
                // *** טיפול בתמונות מוטמעות ***
                body = HandleEmbeddedImagesForChanges(body, msgItem);

                htmlBuilder.Append("<!DOCTYPE html>");
                htmlBuilder.Append("<html dir='rtl' lang='he'>");
                htmlBuilder.Append("<head>");
                htmlBuilder.Append("<meta charset='UTF-8'>");
                htmlBuilder.Append("<style>");
                htmlBuilder.Append("body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f9fafb;direction:rtl;}");
                htmlBuilder.Append(".email-header{background:#1f2937;color:#f9fafb;padding:16px 20px;border-bottom:2px solid #374151;}");
                htmlBuilder.Append(".email-header-row{display:flex;gap:8px;margin-bottom:6px;font-size:13px;align-items:flex-start;}");
                htmlBuilder.Append(".email-header-label{color:#9ca3af;font-weight:600;min-width:50px;flex-shrink:0;}");
                htmlBuilder.Append(".email-header-value{color:#e5e7eb;word-break:break-word;}");
                htmlBuilder.Append(".email-subject{font-size:16px;font-weight:700;color:#fff;margin-bottom:12px;}");
                htmlBuilder.Append(".email-body{padding:20px;background:#fff;min-height:200px;direction:rtl;}");
                htmlBuilder.Append("img{max-width:100%;height:auto;}");
                htmlBuilder.Append("</style>");
                htmlBuilder.Append("</head>");
                htmlBuilder.Append("<body>");

                // *** כותרת ***
                htmlBuilder.Append("<div class='email-header'>");
                htmlBuilder.Append($"<div class='email-subject'>{System.Net.WebUtility.HtmlEncode(subject)}</div>");

                if (!string.IsNullOrEmpty(sender))
                    htmlBuilder.Append($"<div class='email-header-row'><span class='email-header-label'>מאת:</span><span class='email-header-value'>{System.Net.WebUtility.HtmlEncode(sender)}</span></div>");

                if (!string.IsNullOrEmpty(recipients))
                    htmlBuilder.Append($"<div class='email-header-row'><span class='email-header-label'>אל:</span><span class='email-header-value'>{System.Net.WebUtility.HtmlEncode(recipients)}</span></div>");

                if (!string.IsNullOrEmpty(sentDate))
                    htmlBuilder.Append($"<div class='email-header-row'><span class='email-header-label'>תאריך:</span><span class='email-header-value'>{System.Net.WebUtility.HtmlEncode(sentDate)}</span></div>");

                htmlBuilder.Append("</div>");

                // *** גוף ***
                htmlBuilder.Append("<div class='email-body'>");
                htmlBuilder.Append(body);
                htmlBuilder.Append("</div>");

                // *** קבצים מצורפים ***
                try
                {
                    dynamic attachments = msgItem.Attachments;
                    if (attachments.Count > 0)
                    {
                        htmlBuilder.Append("<div style='margin-top:20px;border-top:1px solid #ddd;padding-top:10px;'>");
                        htmlBuilder.Append("<h3>קבצים מצורפים:</h3><ul>");
                        for (int i = 1; i <= attachments.Count; i++)
                        {
                            dynamic att = attachments[i];
                            htmlBuilder.Append($"<li>{System.Net.WebUtility.HtmlEncode(att.FileName)}</li>");
                        }
                        htmlBuilder.Append("</ul></div>");
                    }
                }
                catch { }

                htmlBuilder.Append("</body></html>");
                return htmlBuilder.ToString();
            }

            // *** Fallback: שמור כ-HTML ***
            try
            {
                msgItem.SaveAs(tempHtmlPath, 5); // 5 = olHTML

                string htmlContent = "";
                try { htmlContent = System.IO.File.ReadAllText(tempHtmlPath, Encoding.UTF8); }
                catch
                {
                    try { htmlContent = System.IO.File.ReadAllText(tempHtmlPath, Encoding.GetEncoding(1255)); }
                    catch { htmlContent = System.IO.File.ReadAllText(tempHtmlPath); }
                }

                htmlBuilder.Clear();
                htmlBuilder.Append("<!DOCTYPE html>");
                htmlBuilder.Append("<html dir='rtl' lang='he'>");
                htmlBuilder.Append("<head><meta charset='UTF-8'>");
                htmlBuilder.Append("<style>");
                htmlBuilder.Append("body{font-family:Arial,sans-serif;margin:0;padding:0;background:#f9fafb;direction:rtl;}");
                htmlBuilder.Append(".email-header{background:#1f2937;color:#f9fafb;padding:16px 20px;border-bottom:2px solid #374151;}");
                htmlBuilder.Append(".email-header-row{display:flex;gap:8px;margin-bottom:6px;font-size:13px;}");
                htmlBuilder.Append(".email-header-label{color:#9ca3af;font-weight:600;min-width:50px;flex-shrink:0;}");
                htmlBuilder.Append(".email-header-value{color:#e5e7eb;word-break:break-word;}");
                htmlBuilder.Append(".email-subject{font-size:16px;font-weight:700;color:#fff;margin-bottom:12px;}");
                htmlBuilder.Append(".email-body{padding:20px;background:#fff;min-height:200px;}");
                htmlBuilder.Append("img{max-width:100%;height:auto;}");
                htmlBuilder.Append("</style></head><body>");

                htmlBuilder.Append("<div class='email-header'>");
                htmlBuilder.Append($"<div class='email-subject'>{System.Net.WebUtility.HtmlEncode(subject)}</div>");
                if (!string.IsNullOrEmpty(sender))
                    htmlBuilder.Append($"<div class='email-header-row'><span class='email-header-label'>מאת:</span><span class='email-header-value'>{System.Net.WebUtility.HtmlEncode(sender)}</span></div>");
                if (!string.IsNullOrEmpty(recipients))
                    htmlBuilder.Append($"<div class='email-header-row'><span class='email-header-label'>אל:</span><span class='email-header-value'>{System.Net.WebUtility.HtmlEncode(recipients)}</span></div>");
                if (!string.IsNullOrEmpty(sentDate))
                    htmlBuilder.Append($"<div class='email-header-row'><span class='email-header-label'>תאריך:</span><span class='email-header-value'>{System.Net.WebUtility.HtmlEncode(sentDate)}</span></div>");
                htmlBuilder.Append("</div>");

                htmlBuilder.Append("<div class='email-body'>");
                htmlBuilder.Append(htmlContent);
                htmlBuilder.Append("</div></body></html>");

                return htmlBuilder.ToString();
            }
            catch (Exception ex)
            {
                // *** Fallback לטקסט פשוט ***
                try
                {
                    string plainText = msgItem.Body;
                    htmlBuilder.Clear();
                    htmlBuilder.Append("<!DOCTYPE html><html dir='rtl' lang='he'>");
                    htmlBuilder.Append("<head><meta charset='UTF-8'></head><body>");
                    htmlBuilder.Append("<div style='background:#1f2937;color:#fff;padding:16px;'>");
                    htmlBuilder.Append($"<div style='font-size:16px;font-weight:700;margin-bottom:8px;'>{System.Net.WebUtility.HtmlEncode(subject)}</div>");
                    if (!string.IsNullOrEmpty(sender))
                        htmlBuilder.Append($"<div style='font-size:13px;color:#9ca3af;'>מאת: {System.Net.WebUtility.HtmlEncode(sender)}</div>");
                    htmlBuilder.Append("</div>");
                    htmlBuilder.Append("<div style='padding:20px;background:#fff;'>");
                    htmlBuilder.Append($"<pre style='white-space:pre-wrap;font-family:Arial;'>{System.Net.WebUtility.HtmlEncode(plainText)}</pre>");
                    htmlBuilder.Append("</div></body></html>");
                    return htmlBuilder.ToString();
                }
                catch
                {
                    return ConvertEmlToHtmlFallback(emlPath);
                }
            }
        }
        catch (Exception ex)
        {
            // *** Fallback מלא ***
            return ConvertEmlToHtmlFallback(emlPath);
        }
        finally
        {
            // *** ניקוי משאבים ***
            try
            {
                if (msgItem != null)
                    System.Runtime.InteropServices.Marshal.ReleaseComObject(msgItem);

                if (outlookApp != null)
                {
                    outlookApp.Quit();
                    System.Runtime.InteropServices.Marshal.ReleaseComObject(outlookApp);
                }

                if (tempHtmlPath != null && System.IO.File.Exists(tempHtmlPath))
                    try { System.IO.File.Delete(tempHtmlPath); } catch { }
            }
            catch { }

            GC.Collect();
            GC.WaitForPendingFinalizers();
        }
    }

    // -------------------------------------------------------
    // עזר: Fallback לפרסור EML ידני (אם Outlook לא זמין)
    // -------------------------------------------------------
    private string ConvertEmlToHtmlFallback(string emlPath)
    {
        try
        {
            var lines = System.IO.File.ReadAllLines(emlPath, Encoding.UTF8);

            var headers = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
            var bodyLines = new List<string>();
            bool inBody = false;
            bool isBase64 = false;
            bool isHtml = false;
            string boundary = null;

            for (int i = 0; i < lines.Length; i++)
            {
                string line = lines[i];

                if (!inBody)
                {
                    if (string.IsNullOrEmpty(line))
                    {
                        inBody = true;
                        continue;
                    }

                    if ((line.StartsWith(" ") || line.StartsWith("\t")) &&
                        headers.Count > 0)
                    {
                        var lastKey = headers.Keys.Last();
                        headers[lastKey] += " " + line.Trim();
                        continue;
                    }

                    int colonIdx = line.IndexOf(':');
                    if (colonIdx > 0)
                    {
                        string key = line.Substring(0, colonIdx).Trim();
                        string val = line.Substring(colonIdx + 1).Trim();
                        headers[key] = val;

                        if (key.Equals("Content-Type",
                            StringComparison.OrdinalIgnoreCase))
                        {
                            if (val.Contains("boundary="))
                            {
                                var bMatch = System.Text.RegularExpressions
                                    .Regex.Match(val,
                                        @"boundary=""?([^"";]+)""?");
                                if (bMatch.Success)
                                    boundary = bMatch.Groups[1].Value;
                            }
                            isHtml = val.Contains("text/html");
                        }

                        if (key.Equals("Content-Transfer-Encoding",
                            StringComparison.OrdinalIgnoreCase))
                        {
                            isBase64 = val.Trim()
                                .Equals("base64",
                                    StringComparison.OrdinalIgnoreCase);
                        }
                    }
                }
                else
                {
                    bodyLines.Add(line);
                }
            }

            string bodyText = string.Join("\n", bodyLines);

            if (!string.IsNullOrEmpty(boundary))
            {
                bodyText = ExtractHtmlPartFromMime(
                    string.Join("\n", lines), boundary);
                isHtml = true;
                isBase64 = false;
            }

            if (isBase64 && !string.IsNullOrWhiteSpace(bodyText))
            {
                try
                {
                    var cleaned = bodyText.Replace("\r", "")
                                        .Replace("\n", "").Trim();
                    var decoded = Convert.FromBase64String(cleaned);
                    bodyText = Encoding.UTF8.GetString(decoded);
                    isHtml = bodyText.TrimStart()
                        .StartsWith("<", StringComparison.OrdinalIgnoreCase);
                }
                catch { }
            }

            string from    = headers.GetValueOrDefault("From",    "לא ידוע");
            string to      = headers.GetValueOrDefault("To",      "לא ידוע");
            string subject = headers.GetValueOrDefault("Subject", "ללא נושא");
            string date    = headers.GetValueOrDefault("Date",    "");

            subject = DecodeEncodedWords(subject);
            from    = DecodeEncodedWords(from);

            string bodyHtml = isHtml
                ? bodyText
                : $"<pre style='white-space:pre-wrap;font-family:Arial;'>" +
                $"{System.Net.WebUtility.HtmlEncode(bodyText)}</pre>";

            return $@"<!DOCTYPE html>
    <html dir='rtl' lang='he'>
    <head>
        <meta charset='UTF-8'>
        <style>
            body{{font-family:Arial,sans-serif;margin:0;padding:0;
                background:#f9fafb;direction:rtl;}}
            .email-header{{background:#1f2937;color:#f9fafb;
                        padding:16px 20px;border-bottom:2px solid #374151;}}
            .email-header-row{{display:flex;gap:8px;margin-bottom:6px;
                            font-size:13px;align-items:flex-start;}}
            .email-header-label{{color:#9ca3af;font-weight:600;
                                min-width:50px;flex-shrink:0;}}
            .email-header-value{{color:#e5e7eb;word-break:break-word;}}
            .email-subject{{font-size:16px;font-weight:700;
                            color:#fff;margin-bottom:12px;}}
            .email-body{{padding:20px;background:#fff;
                        min-height:200px;direction:rtl;}}
            img{{max-width:100%;height:auto;}}
        </style>
    </head>
    <body>
        <div class='email-header'>
            <div class='email-subject'>
                {System.Net.WebUtility.HtmlEncode(subject)}
            </div>
            <div class='email-header-row'>
                <span class='email-header-label'>מאת:</span>
                <span class='email-header-value'>
                    {System.Net.WebUtility.HtmlEncode(from)}
                </span>
            </div>
            <div class='email-header-row'>
                <span class='email-header-label'>אל:</span>
                <span class='email-header-value'>
                    {System.Net.WebUtility.HtmlEncode(to)}
                </span>
            </div>
            {(string.IsNullOrEmpty(date) ? "" :
                $"<div class='email-header-row'>" +
                $"<span class='email-header-label'>תאריך:</span>" +
                $"<span class='email-header-value'>" +
                $"{System.Net.WebUtility.HtmlEncode(date)}</span></div>")}
        </div>
        <div class='email-body'>
            {bodyHtml}
        </div>
    </body>
    </html>";
        }
        catch (Exception ex)
        {
            return $@"<!DOCTYPE html>
    <html dir='rtl'>
    <head><meta charset='UTF-8'></head>
    <body style='font-family:Arial;padding:30px;text-align:center;color:#6b7280;'>
        <h3 style='color:#374151;'>שגיאה בקריאת קובץ EML</h3>
        <p>{System.Net.WebUtility.HtmlEncode(ex.Message)}</p>
        <p style='font-size:0.85rem;'>
            {System.Net.WebUtility.HtmlEncode(Path.GetFileName(emlPath))}
        </p>
    </body>
    </html>";
        }
    }

    // -------------------------------------------------------
    // עזר: טיפול בתמונות מוטמעות (לשימוש ב-ChangesController)
    // -------------------------------------------------------
    private string HandleEmbeddedImagesForChanges(
        string htmlBody, dynamic msgItem)
    {
        try
        {
            dynamic attachments = msgItem.Attachments;
            if (attachments.Count == 0) return htmlBody;

            var cidMap = new Dictionary<string, dynamic>(
                StringComparer.OrdinalIgnoreCase);

            for (int i = 1; i <= attachments.Count; i++)
            {
                dynamic attachment = attachments[i];
                try
                {
                    string contentId = attachment.PropertyAccessor
                        .GetProperty(
                            "http://schemas.microsoft.com/mapi/proptag/0x3712001E");
                    if (!string.IsNullOrEmpty(contentId))
                    {
                        contentId = contentId.Trim('<', '>');
                        cidMap[contentId] = attachment;
                    }
                }
                catch { }
            }

            if (cidMap.Count == 0) return htmlBody;

            return System.Text.RegularExpressions.Regex.Replace(
                htmlBody,
                @"<img[^>]*src=[""']cid:([^""']+)[""'][^>]*>",
                match =>
                {
                    string cid = match.Groups[1].Value;
                    if (cidMap.TryGetValue(cid, out dynamic att))
                    {
                        try
                        {
                            string tempDir = Path.Combine(
                                Path.GetTempPath(), "EmailImages");
                            Directory.CreateDirectory(tempDir);
                            string tempFile = Path.Combine(
                                tempDir, att.FileName);
                            att.SaveAsFile(tempFile);

                            byte[] fileBytes =
                                System.IO.File.ReadAllBytes(tempFile);
                            string base64 =
                                Convert.ToBase64String(fileBytes);
                            string mimeType =
                                GetImageMimeTypeForChanges(tempFile);

                            try { System.IO.File.Delete(tempFile); }
                            catch { }

                            return match.Value.Replace(
                                $"cid:{cid}",
                                $"data:{mimeType};base64,{base64}");
                        }
                        catch { }
                    }
                    return match.Value;
                },
                System.Text.RegularExpressions.RegexOptions.IgnoreCase
            );
        }
        catch
        {
            return htmlBody;
        }
    }

    // -------------------------------------------------------
    // עזר: MIME type לתמונה (לשימוש ב-ChangesController)
    // -------------------------------------------------------
    private string GetImageMimeTypeForChanges(string imagePath)
    {
        string ext = Path.GetExtension(imagePath).ToLowerInvariant();
        return ext switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png"            => "image/png",
            ".gif"            => "image/gif",
            ".bmp"            => "image/bmp",
            ".webp"           => "image/webp",
            _                 => "application/octet-stream"
        };
    }

    [HttpGet]
    public IActionResult GetImageFile(string filePath)
    {
        // *** ניתוב ל-DownloadAttachment ***
        if (string.IsNullOrWhiteSpace(filePath))
            return BadRequest("נתיב חסר");

        try
        {
            var fullPath = Path.GetFullPath(filePath);
            var basePath = Path.GetFullPath(ATTACHMENTS_BASE_PATH);

            if (!fullPath.StartsWith(basePath, 
                StringComparison.OrdinalIgnoreCase))
                return BadRequest("גישה לא מורשית");

            if (!System.IO.File.Exists(fullPath))
                return NotFound();

            var ext = Path.GetExtension(fullPath).ToLowerInvariant();
            var contentType = ext switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png"  => "image/png",
                ".gif"  => "image/gif",
                ".webp" => "image/webp",
                ".bmp"  => "image/bmp",
                _       => "application/octet-stream"
            };

            var bytes = System.IO.File.ReadAllBytes(fullPath);
            Response.Headers.Add("Content-Disposition", "inline");
            return File(bytes, contentType);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/ViewAttachment?changeNumber=X&fileName=Y
    // צפייה בקובץ - תמונה, PDF, Word, Excel
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult ViewAttachment(string changeNumber, string fileName)
    {
        if (string.IsNullOrWhiteSpace(changeNumber) ||
            string.IsNullOrWhiteSpace(fileName))
            return BadRequest("פרמטרים חסרים");

        // *** אבטחה: מנע path traversal ***
        if (fileName.Contains("..") || fileName.Contains("/") ||
            fileName.Contains("\\"))
            return BadRequest("שם קובץ לא חוקי");

        var safeNumber = string.Concat(
            changeNumber.Where(c =>
                char.IsLetterOrDigit(c) || c == '-' || c == '_'));

        // *** בנה נתיב מלא ***
        var filePath = Path.Combine(
            ATTACHMENTS_BASE_PATH, safeNumber, fileName);

        // *** ולידציה: הקובץ בתוך התיקייה המותרת ***
        var fullPath = Path.GetFullPath(filePath);
        var basePath = Path.GetFullPath(ATTACHMENTS_BASE_PATH);

        if (!fullPath.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
            return BadRequest("גישה לא מורשית");

        if (!System.IO.File.Exists(fullPath))
            return NotFound("קובץ לא נמצא");

        var ext = Path.GetExtension(fileName).ToLowerInvariant();

        // *** Word → PDF ***
        if (ext == ".doc" || ext == ".docx")
        {
            try
            {
                var pdfPath = ConvertWordToPdfForChanges(fullPath);
                var pdfBytes = System.IO.File.ReadAllBytes(pdfPath);

                Response.Headers["Content-Type"]        = "application/pdf";
                Response.Headers["Content-Disposition"] = "inline";
                Response.Headers["Cache-Control"]       = "no-cache";

                return File(pdfBytes, "application/pdf");
            }
            catch (Exception ex)
            {
                return StatusCode(500,
                    $"שגיאה בהמרת Word ל-PDF: {ex.Message}");
            }
        }

        // *** Excel → PDF ***
        if (ext == ".xls" || ext == ".xlsx")
        {
            try
            {
                var pdfPath = ConvertExcelToPdfForChanges(fullPath);
                var pdfBytes = System.IO.File.ReadAllBytes(pdfPath);

                Response.Headers["Content-Type"]        = "application/pdf";
                Response.Headers["Content-Disposition"] = "inline";
                Response.Headers["Cache-Control"]       = "no-cache";

                return File(pdfBytes, "application/pdf");
            }
            catch (Exception ex)
            {
                return StatusCode(500,
                    $"שגיאה בהמרת Excel ל-PDF: {ex.Message}");
            }
        }

        // *** PDF - הגש ישירות ***
        if (ext == ".pdf")
        {
            var fileBytes = System.IO.File.ReadAllBytes(fullPath);
            Response.Headers["Content-Disposition"] = "inline";
            Response.Headers["Cache-Control"]       = "no-cache";
            return File(fileBytes, "application/pdf");
        }

        // *** תמונות ***
        if (new[] { ".jpg", ".jpeg", ".png", ".gif",
                    ".webp", ".bmp" }.Contains(ext))
        {
            var fileBytes = System.IO.File.ReadAllBytes(fullPath);
            var contentType = GetContentType(ext);
            Response.Headers["Content-Disposition"] = "inline";
            return File(fileBytes, contentType);
        }

        // *** קבצים אחרים - הורדה ***
        var bytes = System.IO.File.ReadAllBytes(fullPath);
        return File(bytes, GetContentType(ext));
    }

    // -------------------------------------------------------
    // GET /Changes/GetImageAsBase64?filePath=...
    // המרת תמונה ל-base64 לשימוש במייל
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult GetImageAsBase64(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return Json(new { success = false, error = "נתיב חסר" });

        try
        {
            var fullPath = Path.GetFullPath(filePath);
            var basePath = Path.GetFullPath(ATTACHMENTS_BASE_PATH);

            if (!fullPath.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
                return Json(new { success = false, error = "גישה לא מורשית" });

            if (!System.IO.File.Exists(fullPath))
                return Json(new { success = false, error = "קובץ לא נמצא" });

            var bytes = System.IO.File.ReadAllBytes(fullPath);
            var base64 = Convert.ToBase64String(bytes);
            var ext = Path.GetExtension(fullPath).ToLowerInvariant();
            var mimeType = ext switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png"  => "image/png",
                ".gif"  => "image/gif",
                ".webp" => "image/webp",
                ".bmp"  => "image/bmp",
                _       => "application/octet-stream"
            };

            return Json(new
            {
                success    = true,
                base64Data = $"data:{mimeType};base64,{base64}"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // -------------------------------------------------------
    // GET /Changes/GetFileAsBase64?filePath=...
    // המרת קובץ כלשהו ל-base64 (לצירוף למייל)
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult GetFileAsBase64(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return Json(new { success = false, error = "נתיב חסר" });

        try
        {
            var fullPath = Path.GetFullPath(filePath);
            var basePath = Path.GetFullPath(ATTACHMENTS_BASE_PATH);

            if (!fullPath.StartsWith(basePath, StringComparison.OrdinalIgnoreCase))
                return Json(new { success = false, error = "גישה לא מורשית" });

            if (!System.IO.File.Exists(fullPath))
                return Json(new { success = false, error = "קובץ לא נמצא" });

            var bytes = System.IO.File.ReadAllBytes(fullPath);
            var base64 = Convert.ToBase64String(bytes);

            return Json(new { success = true, base64Data = base64 });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // -------------------------------------------------------
    // עזר: המרת Word ל-PDF עם cache נפרד לשינויים
    // -------------------------------------------------------
    private static readonly string _changesPdfCachePath =
        Path.Combine(Path.GetTempPath(), "ChangesPdfCache");

    private string ConvertWordToPdfForChanges(string wordFilePath)
    {
        if (!Directory.Exists(_changesPdfCachePath))
            Directory.CreateDirectory(_changesPdfCachePath);

        var fileInfo = new FileInfo(wordFilePath);
        fileInfo.Refresh();

        var cacheFileName =
            $"{Path.GetFileNameWithoutExtension(wordFilePath)}" +
            $"_{fileInfo.LastWriteTime.Ticks}.pdf";
        var pdfPath = Path.Combine(_changesPdfCachePath, cacheFileName);

        if (System.IO.File.Exists(pdfPath))
        {
            var pdfInfo = new FileInfo(pdfPath);
            pdfInfo.Refresh();
            if (pdfInfo.LastWriteTime >= fileInfo.LastWriteTime)
                return pdfPath;
            System.IO.File.Delete(pdfPath);
        }

        using var helper = new OfficeInteropHelper(
            OfficeInteropHelper.OfficeApplication.Word);
        helper.OpenDocument(wordFilePath, true);
        helper.SaveAsPdf(pdfPath);
        return pdfPath;
    }

    private string ConvertExcelToPdfForChanges(string excelFilePath)
    {
        if (!Directory.Exists(_changesPdfCachePath))
            Directory.CreateDirectory(_changesPdfCachePath);

        var fileInfo = new FileInfo(excelFilePath);
        fileInfo.Refresh();

        var cacheFileName =
            $"{Path.GetFileNameWithoutExtension(excelFilePath)}" +
            $"_{fileInfo.LastWriteTime.Ticks}.pdf";
        var pdfPath = Path.Combine(_changesPdfCachePath, cacheFileName);

        if (System.IO.File.Exists(pdfPath))
        {
            var pdfInfo = new FileInfo(pdfPath);
            pdfInfo.Refresh();
            if (pdfInfo.LastWriteTime >= fileInfo.LastWriteTime)
                return pdfPath;
            System.IO.File.Delete(pdfPath);
        }

        using var helper = new OfficeInteropHelper(
            OfficeInteropHelper.OfficeApplication.Excel);
        helper.OpenWorkbook(excelFilePath);
        helper.SaveAsPdf(pdfPath);
        return pdfPath;
    }

    private List<CabDecision> LoadCabDecisions()
    {
        if (!System.IO.File.Exists(CAB_DECISIONS_PATH))
            return new List<CabDecision>();

        try
        {
            string json = System.IO.File.ReadAllText(CAB_DECISIONS_PATH);
            
            var list = JsonSerializer.Deserialize<List<CabDecision>>(json)
                ?? new List<CabDecision>();
            
            // *** תיקון: סנן null entries שנוצרו בעבר ***
            return list.Where(d => d != null && 
                                !string.IsNullOrWhiteSpace(d.ChangeNumber))
                    .ToList();
        }
        catch
        {
            return new List<CabDecision>();
        }
    }

    private void SaveCabDecisions(List<CabDecision> decisions)
    {
        var options = new JsonSerializerOptions
        {
            WriteIndented = true
        };

        System.IO.File.WriteAllText(
            CAB_DECISIONS_PATH,
            JsonSerializer.Serialize(decisions, options),
            Encoding.UTF8
        );
    }

    [HttpPost]
    public IActionResult SaveCabDecision([FromBody] CabDecision decision)
    {
        if (decision == null ||
            string.IsNullOrWhiteSpace(decision.ChangeNumber) ||
            string.IsNullOrWhiteSpace(decision.Status))
            return Json(new { success = false, message = "נתונים חסרים" });

        var all = LoadCabDecisions();

        // *** תיקון: סנן nulls לפני RemoveAll ***
        all = all.Where(d => d != null && 
                            !string.IsNullOrWhiteSpace(d.ChangeNumber))
                .ToList();

        all.RemoveAll(d =>
            d.ChangeNumber == decision.ChangeNumber &&
            d.WeekKey == decision.WeekKey
        );

        if (decision.DecisionDate == default)
            decision.DecisionDate = DateTime.Now;

        all.Add(decision);
        SaveCabDecisions(all);

        return Json(new { success = true });
    }

    // *** מתודה סטטית: חישוב טווח CAB הנוכחי ***
    private static (DateTime from, DateTime to) GetCurrentCabDateRange()
    {
        DateTime today = DateTime.Today;

        int dow = (int)today.DayOfWeek;

        DateTime fromSunday;

        if (dow <= 1)
        {
            // ראשון או שני → השבוע הנוכחי
            fromSunday = today.AddDays(-dow);
        }
        else
        {
            // שלישי ואילך → השבוע הבא
            int daysUntilSunday = 7 - dow;
            fromSunday = today.AddDays(daysUntilSunday);
        }

        // *** from: תחילת היום (00:00:00) ***
        fromSunday = fromSunday.Date;

        // *** to: סוף יום הראשון האחרון (23:59:59) ***
        DateTime toSunday = fromSunday.AddDays(7).Date
                                    .AddHours(23)
                                    .AddMinutes(59)
                                    .AddSeconds(59);

        return (fromSunday, toSunday);
    }

    [HttpGet]
    public IActionResult DownloadCabExcel()
    {
        try
        {
            byte[] excelBytes = BuildCabExcelBytes();

            if (excelBytes == null || excelBytes.Length == 0)
            {
                var (rangeFrom, rangeTo) = GetCurrentCabDateRange();
                string rangeStr =
                    $"{rangeFrom:dd/MM/yyyy} - {rangeTo:dd/MM/yyyy}";

                return Json(new
                {
                    success = false,
                    message = $"לא נמצאו שינויים ל-CAB {rangeStr}"
                });
            }

            var fileName = $"CAB_Changes_{DateTime.Now:yyyy-MM-dd}.xls";

            Response.Headers["Content-Disposition"] =
                $"attachment; filename=\"{fileName}\"";
            Response.Headers["Cache-Control"] = "no-cache";

            Response.Headers["Content-Type"] = 
                "application/vnd.ms-excel; charset=UTF-8"; // *** הוספת charset ***

            return File(
                excelBytes,
                "application/vnd.ms-excel",
                fileName
            );
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetCabDecisions()
    {
        var decisions = LoadCabDecisions();
        
        // *** תיקון: סנן nulls ***
        decisions = decisions
            .Where(d => d != null && !string.IsNullOrWhiteSpace(d.ChangeNumber))
            .ToList();
        
        var decisionsDict = decisions
            .GroupBy(d => $"{d.WeekKey}_{d.ChangeNumber}")
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(d => d.DecisionDate).First()
            );
        
        return Json(new
        {
            success   = true,
            decisions = decisionsDict
        });
    }

    // ===== טיימר CAB יום חמישי =====
    private static void EnsureThursdayCabEmailTimerStarted()
    {
        lock (_cabTimerLock)
        {
            if (_thursdayCabEmailTimerInitialized) return;
            _thursdayCabEmailTimerInitialized = true;

            var now     = DateTime.Now;
            var nextRun = GetNextThursdayAt(now, hour: 11, minute: 5);

            var initialDelay = nextRun - now;
            // בדיקה כל 24 שעות - הטיימר עצמו בודק אם היום חמישי
            var period = TimeSpan.FromHours(24);

            Console.WriteLine(
                $"[ThursdayCabEmail] Timer set. " +
                $"First run: {nextRun:dd/MM/yyyy HH:mm:ss} " +
                $"(in {initialDelay.TotalMinutes:F0} minutes)"
            );

            _thursdayCabEmailTimer = new System.Threading.Timer(
                callback: _ => SendThursdayCabEmail(),
                state:    null,
                dueTime:  initialDelay,
                period:   period
            );
        }
    }

    private static DateTime GetNextThursdayAt(
        DateTime from, int hour, int minute)
    {
        var candidate = new DateTime(
            from.Year, from.Month, from.Day,
            hour, minute, 0
        );

        // קדם עד שמגיעים ליום חמישי
        while (candidate.DayOfWeek != DayOfWeek.Thursday)
            candidate = candidate.AddDays(1);

        // אם כבר עברנו את השעה היום (וזה חמישי) - קח שבוע הבא
        if (candidate <= from)
            candidate = candidate.AddDays(7);

        return candidate;
    }

    private static void SendThursdayCabEmail()
    {
        try
        {
            var now = DateTime.Now;

            // *** בדוק שהיום אכן יום חמישי ***
            if (now.DayOfWeek != DayOfWeek.Thursday)
            {
                Console.WriteLine(
                    $"[ThursdayCabEmail] Skipping - today is " +
                    $"{now.DayOfWeek} ({now:dd/MM/yyyy}), not Thursday");
                return;
            }

            Console.WriteLine(
                $"[ThursdayCabEmail] Starting CAB export for " +
                $"{now:dd/MM/yyyy HH:mm:ss}");

            // *** בנה את קובץ ה-Excel של CAB ***
            byte[] excelBytes = BuildCabExcelBytes();

            if (excelBytes == null || excelBytes.Length == 0)
            {
                Console.WriteLine(
                    "[ThursdayCabEmail] No CAB data found - skipping email");
                return;
            }

            string dateDisplay = now.ToString("dd/MM/yyyy");

            SendCabEmailWithAttachment(
                subject:     $"דוח CAB שבועי - {dateDisplay}",
                body:        BuildCabEmailBody(dateDisplay),
                excelBytes:  excelBytes,
                fileName:    $"CAB_Changes_{now:yyyy-MM-dd}.xls",
                toAddresses: new List<string>
                {
                    "talyoh@menoramivt.co.il"
                },
                ccAddresses: new List<string>
                {
                    "lirongo@menoramivt.co.il"
                }
            );

            Console.WriteLine(
                $"[ThursdayCabEmail] Successfully sent for {dateDisplay}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ThursdayCabEmail] Error: {ex.Message}");
            Console.WriteLine($"[ThursdayCabEmail] Stack: {ex.StackTrace}");
        }
    }

    // -------------------------------------------------------
    // GET /Changes/GetCabChanges
    // מחזיר את שינויי ה-CAB לשבוע הנוכחי (JSON)
    // -------------------------------------------------------
    [HttpGet]
    public IActionResult GetCabChanges()
    {
        try
        {
            if (!System.IO.File.Exists(AGGREGATED_CHANGES_PATH))
                return Json(new { success = false, message = "קובץ שינויים לא נמצא" });

            string json = System.IO.File.ReadAllText(
                AGGREGATED_CHANGES_PATH, Encoding.UTF8);

            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };

            var allChanges = JsonSerializer
                .Deserialize<List<ChangeItem>>(json, options)
                ?? new List<ChangeItem>();

            var (nextSunday, sundayAfterNext) = GetCurrentCabDateRange();

            // *** סינון זהה ל-BuildCabExcelBytes ***
            var cabChanges = allChanges.Where(c =>
            {
                // דלג על מבוטלים
                var s = (c.Status ?? "").ToLower().Trim();
                if (s == "cancelled" || s == "canceled" || s == "בוטל")
                    return false;

                // בדוק needCab
                var needCabVal = (c.NeedCab ?? "").ToLower().Trim();
                bool isCab = needCabVal == "cab"  ||
                            needCabVal == "yes"  ||
                            needCabVal == "כן";

                // בדוק CAB Date
                bool cabThisWeek = false;
                if (isCab && !string.IsNullOrEmpty(c.CabDate))
                {
                    var cabDateObj = StaticTryParseDate(c.CabDate);
                    if (cabDateObj.HasValue)
                        cabThisWeek = cabDateObj.Value >= nextSunday &&
                                    cabDateObj.Value <= sundayAfterNext;
                }

                // בדוק תאריך פעילות
                string startStr  = StaticGetEffectiveStartTime(c);
                var    startDate = StaticTryParseDate(startStr);
                bool   activityThisWeek =
                    startDate.HasValue &&
                    startDate.Value >= nextSunday &&
                    startDate.Value <= sundayAfterNext;

                return cabThisWeek || activityThisWeek;

            }).ToList();

            // מיון לפי תאריך
            cabChanges = cabChanges
                .OrderBy(c =>
                {
                    var d = StaticTryParseDate(StaticGetEffectiveStartTime(c));
                    return d ?? DateTime.MaxValue;
                })
                .ToList();

            return Json(new
            {
                success    = true,
                changes    = cabChanges,
                from       = nextSunday.ToString("dd/MM/yyyy"),
                to         = sundayAfterNext.ToString("dd/MM/yyyy"),
                fromDate   = nextSunday.ToString("yyyy-MM-dd"),
                toDate     = sundayAfterNext.ToString("yyyy-MM-dd"),
                count      = cabChanges.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // *** בניית קובץ CAB - קורא מ-aggregated_changes.json ***
    private static byte[] BuildCabExcelBytes()
    {
        try
        {
            if (!System.IO.File.Exists(AGGREGATED_CHANGES_PATH))
            {
                Console.WriteLine(
                    "[ThursdayCabEmail] aggregated_changes.json not found");
                return null;
            }

            string json = System.IO.File.ReadAllText(
                AGGREGATED_CHANGES_PATH, Encoding.UTF8);

            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };

            var allChanges = JsonSerializer
                .Deserialize<List<ChangeItem>>(json, options)
                ?? new List<ChangeItem>();

            var (nextSunday, sundayAfterNext) = GetCurrentCabDateRange();

            Console.WriteLine(
                $"[ThursdayCabEmail] CAB range: " +
                $"{nextSunday:dd/MM/yyyy} - {sundayAfterNext:dd/MM/yyyy}");

            // *** סנן שינויים רלוונטיים ל-CAB ***
            var cabChanges = allChanges.Where(c =>
            {
                // דלג על מבוטלים
                var s = (c.Status ?? "").ToLower().Trim();
                if (s == "cancelled" || s == "canceled" || s == "בוטל")
                    return false;

                // בדוק needCab
                var needCabVal = (c.NeedCab ?? "").ToLower().Trim();
                bool isCab = needCabVal == "cab"  ||
                            needCabVal == "yes"  ||
                            needCabVal == "כן";

                // בדוק CAB Date
                bool cabThisWeek = false;
                if (isCab && !string.IsNullOrEmpty(c.CabDate))
                {
                    var cabDateObj = StaticTryParseDate(c.CabDate);
                    if (cabDateObj.HasValue)
                        cabThisWeek = cabDateObj.Value >= nextSunday &&
                                    cabDateObj.Value <=  sundayAfterNext;
                }

                // בדוק תאריך פעילות
                string startStr   = StaticGetEffectiveStartTime(c);
                var    startDate  = StaticTryParseDate(startStr);
                bool   activityThisWeek =
                    startDate.HasValue &&
                    startDate.Value >= nextSunday &&
                    startDate.Value <=  sundayAfterNext;

                return cabThisWeek || activityThisWeek;

            }).ToList();

            if (!cabChanges.Any())
            {
                Console.WriteLine(
                    "[ThursdayCabEmail] No CAB changes found for this week");
                return null;
            }

            // *** מיין לפי תאריך ***
            cabChanges = cabChanges
                .OrderBy(c =>
                {
                    var d = StaticTryParseDate(
                        StaticGetEffectiveStartTime(c));
                    return d ?? DateTime.MaxValue;
                })
                .ToList();

            Console.WriteLine(
                $"[ThursdayCabEmail] Found {cabChanges.Count} CAB changes");

            // *** בנה Excel (XML Spreadsheet) ***
            return BuildCabAsExcel(
                cabChanges,
                nextSunday,
                sundayAfterNext);
        }
        catch (Exception ex)
        {
            Console.WriteLine(
                $"[ThursdayCabEmail] BuildCabExcelBytes error: {ex.Message}");
            return null;
        }
    }

    private static byte[] BuildCabAsExcel(
        List<ChangeItem> changes,
        DateTime fromD,
        DateTime toD)
    {
        // *** בנה CSV עם BOM - Excel פותח אותו נכון ***
        // אם רוצים xlsx אמיתי - צריך ספריית EPPlus/ClosedXML
        // כאן נשתמש ב-HTML שExcel פותח כ-xls
        
        string cabDateDisplay = $"{fromD:dd/MM/yyyy} - {toD:dd/MM/yyyy}";
        
        var sb = new StringBuilder();
        
        // *** HTML שExcel פותח ישירות כ-xls ***
        sb.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        sb.AppendLine("<?mso-application progid=\"Excel.Sheet\"?>");
        sb.AppendLine("<Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\"");
        sb.AppendLine(" xmlns:o=\"urn:schemas-microsoft-com:office:office\"");
        sb.AppendLine(" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"");
        sb.AppendLine(" xmlns:ss=\"urn:schemas-microsoft-com:office:spreadsheet\"");
        sb.AppendLine(" xmlns:html=\"http://www.w3.org/TR/REC-html40\">");
        sb.AppendLine("<ExcelWorkbook xmlns=\"urn:schemas-microsoft-com:office:excel\">");
        sb.AppendLine("<WindowHeight>9000</WindowHeight>");
        sb.AppendLine("<WindowWidth>14000</WindowWidth>");
        sb.AppendLine("<ActiveSheet>0</ActiveSheet>");
        sb.AppendLine("<DisplayRightToLeft/>"); // *** הוספה: RTL ברמת Workbook ***
        sb.AppendLine("</ExcelWorkbook>");
        // *** סגנונות ***
        sb.AppendLine("<Styles>");
        
        // סגנון כותרת ראשית
        sb.AppendLine("<Style ss:ID=\"s_title\">");
        sb.AppendLine("<Font ss:Bold=\"1\" ss:Size=\"14\" ss:Color=\"#FFFFFF\"/>");
        sb.AppendLine("<Interior ss:Color=\"#320F5B\" ss:Pattern=\"Solid\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("</Style>");
        
        // סגנון כותרות עמודות
        sb.AppendLine("<Style ss:ID=\"s_header\">");
        sb.AppendLine("<Font ss:Bold=\"1\" ss:Size=\"11\" ss:Color=\"#FFFFFF\"/>");
        sb.AppendLine("<Interior ss:Color=\"#667EEA\" ss:Pattern=\"Solid\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("<Borders>");
        sb.AppendLine("<Border ss:Position=\"Bottom\" ss:LineStyle=\"Continuous\" ss:Weight=\"1\" ss:Color=\"#D0D5DD\"/>");
        sb.AppendLine("</Borders>");
        sb.AppendLine("</Style>");
        
        // סגנון שורה רגילה
        sb.AppendLine("<Style ss:ID=\"s_row\">");
        sb.AppendLine("<Font ss:Size=\"10\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:WrapText=\"1\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("<Borders>");
        sb.AppendLine("<Border ss:Position=\"Bottom\" ss:LineStyle=\"Continuous\" ss:Weight=\"1\" ss:Color=\"#E5E7EB\"/>");
        sb.AppendLine("</Borders>");
        sb.AppendLine("</Style>");
        
        // סגנון שורה חלופית
        sb.AppendLine("<Style ss:ID=\"s_row_alt\">");
        sb.AppendLine("<Font ss:Size=\"10\"/>");
        sb.AppendLine("<Interior ss:Color=\"#F0F4FF\" ss:Pattern=\"Solid\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:WrapText=\"1\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("<Borders>");
        sb.AppendLine("<Border ss:Position=\"Bottom\" ss:LineStyle=\"Continuous\" ss:Weight=\"1\" ss:Color=\"#E5E7EB\"/>");
        sb.AppendLine("</Borders>");
        sb.AppendLine("</Style>");
        
        // סגנון מספר שינוי - כחול מודגש
        sb.AppendLine("<Style ss:ID=\"s_number\">");
        sb.AppendLine("<Font ss:Bold=\"1\" ss:Size=\"11\" ss:Color=\"#667EEA\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("<Borders>");
        sb.AppendLine("<Border ss:Position=\"Bottom\" ss:LineStyle=\"Continuous\" ss:Weight=\"1\" ss:Color=\"#E5E7EB\"/>");
        sb.AppendLine("</Borders>");
        sb.AppendLine("</Style>");
        
        // סגנון מספר שינוי - שורה חלופית
        sb.AppendLine("<Style ss:ID=\"s_number_alt\">");
        sb.AppendLine("<Font ss:Bold=\"1\" ss:Size=\"11\" ss:Color=\"#667EEA\"/>");
        sb.AppendLine("<Interior ss:Color=\"#F0F4FF\" ss:Pattern=\"Solid\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("<Borders>");
        sb.AppendLine("<Border ss:Position=\"Bottom\" ss:LineStyle=\"Continuous\" ss:Weight=\"1\" ss:Color=\"#E5E7EB\"/>");
        sb.AppendLine("</Borders>");
        sb.AppendLine("</Style>");
        
        // סגנון סטטוס - ממתין
        sb.AppendLine("<Style ss:ID=\"s_status_pending\">");
        sb.AppendLine("<Font ss:Bold=\"1\" ss:Size=\"10\" ss:Color=\"#D97706\"/>");
        sb.AppendLine("<Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\" ss:ReadingOrder=\"RightToLeft\"/>");
        sb.AppendLine("<Borders>");
        sb.AppendLine("<Border ss:Position=\"Bottom\" ss:LineStyle=\"Continuous\" ss:Weight=\"1\" ss:Color=\"#E5E7EB\"/>");
        sb.AppendLine("</Borders>");
        sb.AppendLine("</Style>");
        
        sb.AppendLine("</Styles>");
        
        // *** גיליון ראשי ***
        sb.AppendLine($"<Worksheet ss:Name=\"CAB {fromD:dd.MM} - {toD:dd.MM}\"" +
              " ss:RightToLeft=\"1\">");
        sb.AppendLine("<Table ss:DefaultRowHeight=\"15\" " +
              "ss:DefaultColumnWidth=\"60\" " +
              "x:FullColumns=\"1\" x:FullRows=\"1\">");
        
        // *** רוחב עמודות ***
        sb.AppendLine("<Column ss:Width=\"80\"/>");   // תאריך
        sb.AppendLine("<Column ss:Width=\"130\"/>");  // מספר שינוי
        sb.AppendLine("<Column ss:Width=\"300\"/>");  // שם השינוי
        sb.AppendLine("<Column ss:Width=\"130\"/>");  // תאריך השינוי
        sb.AppendLine("<Column ss:Width=\"150\"/>");  // מציגים
        sb.AppendLine("<Column ss:Width=\"200\"/>");  // הערות
        sb.AppendLine("<Column ss:Width=\"120\"/>");  // סטטוס
        
        // *** שורה 1: כותרת ראשית ממוזגת ***
        sb.AppendLine("<Row ss:Height=\"35\">");
        sb.AppendLine($"<Cell ss:MergeAcross=\"6\" ss:StyleID=\"s_title\">");
        sb.AppendLine($"<Data ss:Type=\"String\">CAB {cabDateDisplay}</Data>");
        sb.AppendLine("</Cell>");
        sb.AppendLine("</Row>");
        
        // *** שורה 2: כותרות עמודות ***
        sb.AppendLine("<Row ss:Height=\"25\">");
        foreach (var header in new[] { "תאריך", "מספר שינוי", "שם השינוי", "תאריך השינוי", "מציגים", "הערות", "סטטוס" })
        {
            sb.AppendLine($"<Cell ss:StyleID=\"s_header\"><Data ss:Type=\"String\">{header}</Data></Cell>");
        }
        sb.AppendLine("</Row>");
        
        // *** שורות נתונים ***
        bool isAlt = false;
        foreach (var c in changes)
        {
            string startStr      = StaticGetEffectiveStartTime(c);
            var    dateObj       = StaticTryParseDate(startStr);
            string formattedDate = dateObj.HasValue
                ? dateObj.Value.ToString("dd/MM/yyyy")
                : "";

            string status  = StaticMapStatus(c.Status);
            string notes   = !string.IsNullOrWhiteSpace(c.Notes)
                ? c.Notes
                : (c.System ?? "");
            string presenters = StaticCleanPresenters(c.Presenters);

            string rowStyle   = isAlt ? "s_row_alt"    : "s_row";
            string numStyle   = isAlt ? "s_number_alt" : "s_number";

            // *** Escape XML ***
            string EscXml(string v) => (v ?? "")
                .Replace("&", "&amp;")
                .Replace("<", "&lt;")
                .Replace(">", "&gt;")
                .Replace("\"", "&quot;");

            sb.AppendLine("<Row ss:Height=\"20\">");
            sb.AppendLine($"<Cell ss:StyleID=\"{rowStyle}\"><Data ss:Type=\"String\">{EscXml(formattedDate)}</Data></Cell>");
            sb.AppendLine($"<Cell ss:StyleID=\"{numStyle}\"><Data ss:Type=\"String\">{EscXml(c.Number)}</Data></Cell>");
            sb.AppendLine($"<Cell ss:StyleID=\"{rowStyle}\"><Data ss:Type=\"String\">{EscXml(c.Name)}</Data></Cell>");
            sb.AppendLine($"<Cell ss:StyleID=\"{rowStyle}\"><Data ss:Type=\"String\">{EscXml(c.Date)}</Data></Cell>");
            sb.AppendLine($"<Cell ss:StyleID=\"{rowStyle}\"><Data ss:Type=\"String\">{EscXml(presenters)}</Data></Cell>");
            sb.AppendLine($"<Cell ss:StyleID=\"{rowStyle}\"><Data ss:Type=\"String\">{EscXml(notes)}</Data></Cell>");
            sb.AppendLine($"<Cell ss:StyleID=\"s_status_pending\"><Data ss:Type=\"String\">{EscXml(status)}</Data></Cell>");
            sb.AppendLine("</Row>");

            isAlt = !isAlt;
        }
        
        sb.AppendLine("</Table>");
        
        // *** הגדרות גיליון: RTL + הקפאת שורות ***
        sb.AppendLine("<WorksheetOptions xmlns=\"urn:schemas-microsoft-com:office:excel\">");
        sb.AppendLine("<PageSetup>");
        sb.AppendLine("<Layout x:Orientation=\"Portrait\"/>");
        sb.AppendLine("</PageSetup>");
        sb.AppendLine("<Selected/>");
        sb.AppendLine("<FreezePanes/>");
        sb.AppendLine("<SplitHorizontal>2</SplitHorizontal>");
        sb.AppendLine("<TopRowBottomPane>2</TopRowBottomPane>");
        sb.AppendLine("<ActivePane>2</ActivePane>");
        sb.AppendLine("<Panes>");
        sb.AppendLine("<Pane>");
        sb.AppendLine("<Number>2</Number>");
        sb.AppendLine("<ActiveRow>2</ActiveRow>");
        sb.AppendLine("<ActiveCol>0</ActiveCol>");
        sb.AppendLine("</Pane>");
        sb.AppendLine("</Panes>");
        sb.AppendLine("<DisplayRightToLeft/>"); // *** הזזה: חייב להיות בסוף WorksheetOptions ***
        sb.AppendLine("</WorksheetOptions>");
        
        sb.AppendLine("</Worksheet>");
        sb.AppendLine("</Workbook>");
        
        return Encoding.UTF8.GetPreamble()
            .Concat(Encoding.UTF8.GetBytes(sb.ToString()))
            .ToArray();
    }

    // *** עזר סטטי: קבל תאריך התחלה אפקטיבי ***
    private static string StaticGetEffectiveStartTime(ChangeItem c)
    {
        var actual = (c.ActualStartTime ?? "").Trim();
        if (!string.IsNullOrEmpty(actual) &&
            actual.ToLower() != "none")
            return StaticNormalizeDate(actual);

        return c.PlannedStartTime ?? c.Date ?? "";
    }

    // *** עזר סטטי: נרמול תאריך ***
    private static string StaticNormalizeDate(string dateStr)
    {
        if (string.IsNullOrEmpty(dateStr)) return "";

        // *** ניקוי & לפני פרסור ***
        var cleaned = dateStr.Replace(" & ", " ").Trim();

        if (DateTime.TryParse(cleaned, out var d))
            return $"{d.Day:D2}/{d.Month:D2}/{d.Year} " +
                $"{d.Hour:D2}:{d.Minute:D2}";

        return dateStr;
    }

    // *** עזר סטטי: פרסור תאריך ***
    private static DateTime? StaticTryParseDate(string str)
    {
        if (string.IsNullOrWhiteSpace(str)) return null;

        str = str.Trim();

        // *** פורמט 1: dd/mm/yyyy HH:MM או dd/mm/yyyy ***
        var dmyMatch = System.Text.RegularExpressions.Regex.Match(
            str,
            @"^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})" +
            @"(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?");

        if (dmyMatch.Success)
        {
            try
            {
                int day   = int.Parse(dmyMatch.Groups[1].Value);
                int month = int.Parse(dmyMatch.Groups[2].Value);
                int year  = int.Parse(dmyMatch.Groups[3].Value);
                int hour  = dmyMatch.Groups[4].Success
                    ? int.Parse(dmyMatch.Groups[4].Value) : 0;
                int min   = dmyMatch.Groups[5].Success
                    ? int.Parse(dmyMatch.Groups[5].Value) : 0;
                int sec   = dmyMatch.Groups[6].Success
                    ? int.Parse(dmyMatch.Groups[6].Value) : 0;

                return new DateTime(year, month, day, hour, min, sec);
            }
            catch { }
        }

        // *** פורמט 2: yyyy-mm-dd HH:MM:SS או yyyy-mm-dd ***
        var isoMatch = System.Text.RegularExpressions.Regex.Match(
            str,
            @"^(\d{4})-(\d{1,2})-(\d{1,2})" +
            @"(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?");

        if (isoMatch.Success)
        {
            try
            {
                int year  = int.Parse(isoMatch.Groups[1].Value);
                int month = int.Parse(isoMatch.Groups[2].Value);
                int day   = int.Parse(isoMatch.Groups[3].Value);
                int hour  = isoMatch.Groups[4].Success
                    ? int.Parse(isoMatch.Groups[4].Value) : 0;
                int min   = isoMatch.Groups[5].Success
                    ? int.Parse(isoMatch.Groups[5].Value) : 0;
                int sec   = isoMatch.Groups[6].Success
                    ? int.Parse(isoMatch.Groups[6].Value) : 0;

                return new DateTime(year, month, day, hour, min, sec);
            }
            catch { }
        }

        // *** פורמט 3: mm/dd/yyyy (פורמט אמריקאי - CabDate) ***
        var mdyMatch = System.Text.RegularExpressions.Regex.Match(
            str,
            @"^(\d{1,2})\/(\d{1,2})\/(\d{4})$");

        if (mdyMatch.Success)
        {
            try
            {
                // *** נסה dd/mm/yyyy קודם, אם לא תקין נסה mm/dd/yyyy ***
                int first  = int.Parse(mdyMatch.Groups[1].Value);
                int second = int.Parse(mdyMatch.Groups[2].Value);
                int year   = int.Parse(mdyMatch.Groups[3].Value);

                // אם first > 12 - בטוח dd/mm
                if (first > 12)
                    return new DateTime(year, second, first, 12, 0, 0);

                // אם second > 12 - בטוח mm/dd
                if (second > 12)
                    return new DateTime(year, first, second, 12, 0, 0);

                // ברירת מחדל: dd/mm (ישראלי)
                return new DateTime(year, second, first, 12, 0, 0);
            }
            catch { }
        }

        // *** פורמט 4: ניקוי & ופרסור עם DateTime.TryParse ***
        var cleaned = str.Replace(" & ", " ").Trim();
        if (DateTime.TryParse(cleaned, out var parsedCleaned))
            return parsedCleaned;

        // *** פורמט 5: fallback כללי ***
        if (DateTime.TryParse(str, out var parsed))
            return parsed;

        return null;
    }

    // *** עזר סטטי: מיפוי סטטוס לעברית ***
    private static string StaticMapStatus(string status)
    {
        if (string.IsNullOrEmpty(status)) return "";
        return status switch
        {
            "Draft"                      => "טיוטה",
            "Request For Authorization"  => "לאישור מנהל",
            "Request For Change"         => "ממתין לאישור",
            "Planning In Progress"       => "בתכנון",
            "Scheduled For Review"       => "בבדיקה",
            "Scheduled For Approval"     => "לאישור CAB",
            "Scheduled for Approval"     => "לאישור CAB",
            "Scheduled"                  => "אושר",
            "Implementation In Progress" => "בביצוע",
            "Completed"                  => "בוצע",
            "Closed"                     => "בוצע",
            _                            => status
        };
    }

    // *** עזר סטטי: ניקוי שמות מציגים ***
    private static string StaticCleanPresenters(string presenters)
    {
        if (string.IsNullOrEmpty(presenters)) return "";
        return System.Text.RegularExpressions.Regex
            .Replace(presenters, @"\s*\[עובד מנורה\]", "")
            .Trim();
    }

    // *** בניית גוף המייל ***
    private static string BuildCabEmailBody(string dateDisplay)
    {
        return
            $"שלום טל,\n\n" +
            $"מצורף דוח CAB שבועי לתאריך {dateDisplay}.\n\n" +
            $"הדוח כולל את כל השינויים המתוכננים לשבוע הקרוב " +
            $"הדורשים אישור CAB.\n\n" +
            $"בברכה,\n" +
            $"NOC Portal";
    }

    // *** שליחת מייל עם קובץ מצורף ***
    private static void SendCabEmailWithAttachment(
        string       subject,
        string       body,
        byte[]       excelBytes,
        string       fileName,
        List<string> toAddresses,
        List<string> ccAddresses)
    {
        using var client = new System.Net.Mail.SmtpClient("172.22.28.25", 25)
        {
            EnableSsl             = false,
            DeliveryMethod        =
                System.Net.Mail.SmtpDeliveryMethod.Network,
            UseDefaultCredentials = false,
            Credentials           =
                System.Net.CredentialCache.DefaultNetworkCredentials,
            Timeout               = 30_000
        };

        string htmlBody = BuildCabHtmlEmailBody(body);

        using var mail = new System.Net.Mail.MailMessage
        {
            From       = new System.Net.Mail.MailAddress(
                            "noc@menoramivt.co.il", "NOC Portal"),
            Subject    = subject,
            Body       = htmlBody,
            IsBodyHtml = true
        };

        mail.SubjectEncoding = Encoding.UTF8;
        mail.BodyEncoding    = Encoding.UTF8;
        mail.HeadersEncoding = Encoding.UTF8;

        foreach (var to in toAddresses)
            if (!string.IsNullOrWhiteSpace(to))
                mail.To.Add(to.Trim());

        foreach (var cc in ccAddresses)
            if (!string.IsNullOrWhiteSpace(cc))
                mail.CC.Add(cc.Trim());

        // *** צרף את הקובץ ***
        if (excelBytes != null && excelBytes.Length > 0)
        {
            var stream = new System.IO.MemoryStream(excelBytes);

            string contentType = fileName.EndsWith(".xlsx")
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : fileName.EndsWith(".xls")
                    ? "application/vnd.ms-excel"
                    : "text/csv;charset=UTF-8";

            mail.Attachments.Add(
                new System.Net.Mail.Attachment(
                    stream, fileName, contentType));
        }

        try
        {
            client.Send(mail);

            _auditLog?.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.EmailSent,
                Username  = "system",
                IpAddress = "system",
                Details   =
                    $"CAB weekly email sent | " +
                    $"To={string.Join(", ", toAddresses)} | " +
                    $"Subject={subject}",
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
                Details   =
                    $"CAB weekly email failed | " +
                    $"To={string.Join(", ", toAddresses)} | " +
                    $"Error={ex.Message}",
                Success   = false
            });
            throw;
        }
    }

    // *** בניית HTML למייל ***
    private static string BuildCabHtmlEmailBody(string plainBody)
    {
        if (string.IsNullOrEmpty(plainBody))
            return "<html><body></body></html>";

        var lines = plainBody.Split('\n');
        var sb    = new StringBuilder();

        foreach (var line in lines)
        {
            var trimmed = line.TrimEnd('\r').Trim();

            if (string.IsNullOrEmpty(trimmed))
            {
                sb.Append(
                    "<div style=\"height:10px;" +
                    "line-height:10px;\">&nbsp;</div>");
                continue;
            }

            sb.Append(
                $"<div style=\"padding:4px 0;color:#333;" +
                $"line-height:1.6;\">" +
                $"{System.Net.WebUtility.HtmlEncode(trimmed)}" +
                $"</div>");
        }

        return
            "<!DOCTYPE html>" +
            "<html dir=\"rtl\" lang=\"he\">" +
            "<head>" +
            "<meta charset=\"UTF-8\">" +
            "</head>" +
            "<body style=\"margin:0;padding:25px 30px;" +
            "font-family:Arial,sans-serif;direction:rtl;" +
            "font-size:14px;color:#333;line-height:1.8;" +
            "background:#ffffff;\">" +
            $"<div style=\"max-width:600px;\">{sb}</div>" +
            "</body></html>";
    }

}

public class ChangeItem
{
    public string Number     { get; set; } = string.Empty;
    public string Name       { get; set; } = string.Empty;
    public string Date       { get; set; } = string.Empty;
    public string Link       { get; set; } = string.Empty;
    public string Status     { get; set; } = string.Empty;
    public string Notes      { get; set; } = string.Empty;
    public string Presenters { get; set; } = string.Empty;
    public string Source     { get; set; } = string.Empty;
    public string PlannedStartTime    { get; set; } = string.Empty;
    public string PlannedEndTime      { get; set; } = string.Empty;
    public string ActualStartTime  { get; set; } = string.Empty;    
    public string ActualEndTime    { get; set; } = string.Empty;
    public string System              { get; set; } = string.Empty;
    public string Company             { get; set; } = string.Empty;
    public string ChangeType          { get; set; } = string.Empty;
    public string ChangeCategory      { get; set; } = string.Empty;
    public string Environment         { get; set; } = string.Empty;
    public string ExecutingTeam       { get; set; } = string.Empty;
    public string TeamLeader          { get; set; } = string.Empty;
    public string DirectManager       { get; set; } = string.Empty;
    public string DivisionManager     { get; set; } = string.Empty;
    public string InvolvedTeams       { get; set; } = string.Empty;
    public string VendorInvolved      { get; set; } = string.Empty;
    public string VendorName          { get; set; } = string.Empty;
    public string ModuleProcess       { get; set; } = string.Empty;
    public string NeedCab             { get; set; } = string.Empty;
    public string CabDate             { get; set; } = string.Empty;
    public string Excerpt             { get; set; } = string.Empty;
    public string ServiceDescription  { get; set; } = string.Empty;
    public string Description         { get; set; } = string.Empty;
    public string ChangeNeed          { get; set; } = string.Empty;
    public string ImplementationPlan  { get; set; } = string.Empty;
    public string PossibleFailures    { get; set; } = string.Empty;
    public string RollbackPlan        { get; set; } = string.Empty;
    public string TestPlan            { get; set; } = string.Empty;
    public string SupportOrganization { get; set; } = string.Empty;
    public string ChangeReason { get; set; } = string.Empty;

    // שדות סיכון
    public string RegulatoryRisk         { get; set; } = string.Empty;
    public string AffectsCoreSystems     { get; set; } = string.Empty;
    public string AffectsMultipleSystems { get; set; } = string.Empty;
    public string AffectsCustomers       { get; set; } = string.Empty;
    public string AffectsSystemUsers     { get; set; } = string.Empty;
    public string DuringBusinessHours    { get; set; } = string.Empty;
    public string ArchitectureChange     { get; set; } = string.Empty;
    public string MultipleTeams          { get; set; } = string.Empty;
    public string KnowledgeGaps          { get; set; } = string.Empty;
    public string BusinessTestsRequired  { get; set; } = string.Empty;
    public string LowerEnvTestsFailed    { get; set; } = string.Empty;
}

public class CabDecision
{
    public string ChangeNumber { get; set; } = string.Empty;
    public string Status       { get; set; } = string.Empty;
    public string Notes        { get; set; } = string.Empty;
    public string WeekKey      { get; set; } = string.Empty;
    public string DecidedBy    { get; set; } = string.Empty;

    // *** תיקון: תמוך גם ב-string וגם ב-DateTime ***
    public DateTime DecisionDate { get; set; } = DateTime.Now;
}

public class CalendarInviteRequest
{
    public string ChangeNumber    { get; set; } = string.Empty;
    public string ChangeName      { get; set; } = string.Empty;
    public string ToEmail         { get; set; } = string.Empty;
    public string ToName          { get; set; } = string.Empty;
    public string StartDate       { get; set; } = string.Empty;
    public string EndDate         { get; set; } = string.Empty;
    public string Presenter       { get; set; } = string.Empty;
    public string ExecutingTeam   { get; set; } = string.Empty;
    public string System          { get; set; } = string.Empty;
    public string Status          { get; set; } = string.Empty;
    public string Link            { get; set; } = string.Empty;
    public string Description     { get; set; } = string.Empty;
    public string Notes           { get; set; } = string.Empty;
    public string ChangeCategory  { get; set; } = string.Empty;
}

public class AttachmentMeta
{
    public string Id           { get; set; } =
        Guid.NewGuid().ToString("N")[..8];
    public string FileName     { get; set; } = string.Empty;
    public string OriginalName { get; set; } = string.Empty;
    public string ChangeNumber { get; set; } = string.Empty;
    public DateTime UploadedAt { get; set; } = DateTime.Now;
    public long FileSize       { get; set; }
    public string ContentType  { get; set; } = string.Empty;
    public string Extension    { get; set; } = string.Empty;
    public string UploadedBy   { get; set; } = string.Empty;
    public string Notes        { get; set; } = string.Empty;
}

public class DeleteAttachmentRequest
{
    public string ChangeNumber { get; set; } = string.Empty;
    public string FileName     { get; set; } = string.Empty;
}