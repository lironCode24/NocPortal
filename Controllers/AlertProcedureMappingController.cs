// file: AlertProcedureMappingController.cs

using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace MyWebApp.Controllers
{
    /// <summary>
    /// קונטרולר לניהול מיפויים בין התראות לנהלים
    /// </summary>
    public class AlertProcedureMappingController : Controller
    {
        // ─── נתיבים ───────────────────────────────────────────────
        private readonly string _mappingsFilePath;
        private readonly string _proceduresPath;

        public AlertProcedureMappingController(IWebHostEnvironment env)
        {
            var baseFilesPath = Path.Combine(env.WebRootPath, "assets", "files");
            _mappingsFilePath = Path.Combine(baseFilesPath, "alert_procedure_mappings.json");
            _proceduresPath = Path.Combine(baseFilesPath, "Procedures");
        }

        private static readonly object _fileLock = new object();

        // ══════════════════════════════════════════════════════════
        // GET  /AlertProcedureMapping/GetMappings
        // מחזיר את כל המיפויים הקיימים
        // ══════════════════════════════════════════════════════════
        [HttpGet]
        public IActionResult GetMappings()
        {
            try
            {
                var mappings = LoadMappings();
                return Json(new { success = true, mappings });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        // ══════════════════════════════════════════════════════════
        // POST  /AlertProcedureMapping/SaveMapping
        // שמירת מיפוי חדש או עדכון קיים
        // ══════════════════════════════════════════════════════════
        [HttpPost]
        public IActionResult SaveMapping([FromBody] AlertProcedureMappingRequest request)
        {
            try
            {
                // ── ולידציה ──────────────────────────────────────
                if (string.IsNullOrWhiteSpace(request?.Pattern))
                    return Json(new
                    {
                        success = false,
                        message = "חסר תבנית חיפוש (pattern)"
                    });

                if (string.IsNullOrWhiteSpace(request.ProcedureFileName))
                    return Json(new
                    {
                        success = false,
                        message = "חסר שם קובץ נוהל"
                    });

                // ── בדוק שהנוהל קיים ─────────────────────────────
                var procedureFiles = Directory.GetFiles(
                    _proceduresPath, request.ProcedureFileName,
                    SearchOption.AllDirectories);

                if (procedureFiles.Length == 0)
                    return Json(new
                    {
                        success = false,
                        message = $"הנוהל '{request.ProcedureFileName}' לא נמצא"
                    });

                var currentUser = User.Identity?.Name ?? "anonymous";

                var mappings = LoadMappings();

                // ── עדכון קיים ────────────────────────────────────
                if (!string.IsNullOrEmpty(request.Id))
                {
                    var existing = mappings.FirstOrDefault(m => m.Id == request.Id);
                    if (existing != null)
                    {
                        existing.Pattern           = request.Pattern.Trim();
                        existing.MatchType         = request.MatchType ?? "contains";
                        existing.ProcedureFileName = request.ProcedureFileName;
                        existing.ProcedureName     = request.ProcedureName ?? 
                                                     Path.GetFileNameWithoutExtension(
                                                         request.ProcedureFileName);
                        existing.ProcedureFolderPath = request.ProcedureFolderPath ?? "";
                        existing.Description       = request.Description ?? "";
                        existing.UpdatedBy         = currentUser;
                        existing.UpdatedAt         = DateTime.UtcNow.ToString("o");

                        SaveMappingsToFile(mappings);
                        return Json(new
                        {
                            success = true,
                            id      = existing.Id,
                            message = "המיפוי עודכן בהצלחה"
                        });
                    }
                }

                // ── בדוק כפילות pattern ───────────────────────────
                bool patternExists = mappings.Any(m =>
                    string.Equals(m.Pattern, request.Pattern.Trim(),
                        StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(m.MatchType, request.MatchType ?? "contains",
                        StringComparison.OrdinalIgnoreCase));

                if (patternExists)
                    return Json(new
                    {
                        success = false,
                        message = $"תבנית '{request.Pattern}' כבר קיימת"
                    });

                // ── הוסף חדש ─────────────────────────────────────
                var newMapping = new AlertProcedureMappingData
                {
                    Id = $"map_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}" +
                         $"_{Guid.NewGuid().ToString("N").Substring(0, 6)}",
                    Pattern             = request.Pattern.Trim(),
                    MatchType           = request.MatchType ?? "contains",
                    ProcedureFileName   = request.ProcedureFileName,
                    ProcedureName       = request.ProcedureName ??
                                         Path.GetFileNameWithoutExtension(
                                             request.ProcedureFileName),
                    ProcedureFolderPath = request.ProcedureFolderPath ?? "",
                    Description         = request.Description ?? "",
                    CreatedBy           = currentUser,
                    CreatedAt           = DateTime.UtcNow.ToString("o"),
                    UpdatedBy           = currentUser,
                    UpdatedAt           = DateTime.UtcNow.ToString("o")
                };

                mappings.Add(newMapping);
                SaveMappingsToFile(mappings);

                return Json(new
                {
                    success = true,
                    id      = newMapping.Id,
                    message = "המיפוי נשמר בהצלחה"
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        // ══════════════════════════════════════════════════════════
        // DELETE  /AlertProcedureMapping/DeleteMapping?id=xxx
        // ══════════════════════════════════════════════════════════
        [HttpDelete]
        public IActionResult DeleteMapping(string id)
        {
            try
            {
                if (string.IsNullOrEmpty(id))
                    return Json(new { success = false, message = "חסר מזהה" });

                var mappings = LoadMappings();
                var mapping  = mappings.FirstOrDefault(m => m.Id == id);

                if (mapping == null)
                    return Json(new { success = false, message = "המיפוי לא נמצא" });

                mappings.Remove(mapping);
                SaveMappingsToFile(mappings);

                return Json(new { success = true, message = "המיפוי נמחק בהצלחה" });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        // ══════════════════════════════════════════════════════════
        // GET  /AlertProcedureMapping/GetProceduresList
        // מחזיר רשימת נהלים זמינים לבחירה
        // ══════════════════════════════════════════════════════════
        [HttpGet]
        public IActionResult GetProceduresList()
        {
            try
            {
                if (!Directory.Exists(_proceduresPath))
                    return Json(new { success = false, error = "תיקיית הנהלים לא נמצאה" });

                var files = Directory.GetFiles(
                        _proceduresPath, "*.*", SearchOption.AllDirectories)
                    // סנן קבצי נעילה זמניים של Office
                    .Where(f => !Path.GetFileName(f).StartsWith("~$"))
                    .Select(f => new
                    {
                        fileName   = Path.GetFileName(f),
                        name       = Path.GetFileNameWithoutExtension(f),
                        folderPath = GetRelativeFolderPath(f),
                        icon       = GetFileIcon(Path.GetExtension(f))
                    })
                    .OrderBy(f => f.folderPath)
                    .ThenBy(f => f.name)
                    .ToList();

                return Json(new { success = true, procedures = files });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        // ══════════════════════════════════════════════════════════
        // GET  /AlertProcedureMapping/MatchAlert?message=xxx
        // בדיקה אם התראה מסוימת מתאימה למיפוי כלשהו
        // ══════════════════════════════════════════════════════════
        [HttpGet]
        public IActionResult MatchAlert(string message)
        {
            try
            {
                if (string.IsNullOrEmpty(message))
                    return Json(new { success = true, matched = false });

                var mappings = LoadMappings();
                var match    = FindMatchingProcedure(message, mappings);

                if (match == null)
                    return Json(new { success = true, matched = false });

                return Json(new
                {
                    success  = true,
                    matched  = true,
                    mapping  = match
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        // ══════════════════════════════════════════════════════════
        // GET  /AlertProcedureMapping/GetAllMappingsForAlerts
        // מחזיר את כל המיפויים בפורמט מותאם ל-JS
        // (נקרא פעם אחת בטעינת הדף)
        // ══════════════════════════════════════════════════════════
        [HttpGet]
        public IActionResult GetAllMappingsForAlerts()
        {
            try
            {
                var mappings = LoadMappings();
                return Json(new { success = true, mappings });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, error = ex.Message });
            }
        }

        // ══════════════════════════════════════════════════════════
        // פונקציות עזר פרטיות
        // ══════════════════════════════════════════════════════════

        /// <summary>
        /// טוען את המיפויים מהקובץ
        /// </summary>
        private List<AlertProcedureMappingData> LoadMappings()
        {
            lock (_fileLock)
            {
                try
                {
                    if (!System.IO.File.Exists(_mappingsFilePath))
                        return new List<AlertProcedureMappingData>();

                    var json = System.IO.File.ReadAllText(_mappingsFilePath);
                    if (string.IsNullOrWhiteSpace(json))
                        return new List<AlertProcedureMappingData>();

                    return JsonSerializer.Deserialize<List<AlertProcedureMappingData>>(
                        json,
                        new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        }
                    ) ?? new List<AlertProcedureMappingData>();
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error loading mappings: {ex.Message}");
                    return new List<AlertProcedureMappingData>();
                }
            }
        }

        /// <summary>
        /// שומר את המיפויים לקובץ
        /// </summary>
        private void SaveMappingsToFile(List<AlertProcedureMappingData> mappings)
        {
            lock (_fileLock)
            {
                try
                {
                    Directory.CreateDirectory(
                        Path.GetDirectoryName(_mappingsFilePath));

                    var json = JsonSerializer.Serialize(
                        mappings,
                        new JsonSerializerOptions { WriteIndented = true });

                    System.IO.File.WriteAllText(_mappingsFilePath, json);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Error saving mappings: {ex.Message}");
                    throw;
                }
            }
        }

        /// <summary>
        /// מוצא נוהל תואם להודעת התראה
        /// </summary>
        private AlertProcedureMappingData FindMatchingProcedure(
            string message,
            List<AlertProcedureMappingData> mappings)
        {
            if (string.IsNullOrEmpty(message) || mappings == null)
                return null;

            var msgLower = message.ToLowerInvariant();

            foreach (var mapping in mappings)
            {
                if (string.IsNullOrEmpty(mapping.Pattern)) continue;

                var patternLower = mapping.Pattern.ToLowerInvariant();
                bool isMatch = false;

                switch ((mapping.MatchType ?? "contains").ToLowerInvariant())
                {
                    case "exact":
                        isMatch = string.Equals(msgLower, patternLower,
                            StringComparison.OrdinalIgnoreCase);
                        break;

                    case "startswith":
                        isMatch = msgLower.StartsWith(patternLower);
                        break;

                    case "endswith":
                        isMatch = msgLower.EndsWith(patternLower);
                        break;

                    case "regex":
                        try
                        {
                            isMatch = System.Text.RegularExpressions.Regex.IsMatch(
                                message, mapping.Pattern,
                                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
                        }
                        catch { isMatch = false; }
                        break;

                    case "contains":
                    default:
                        isMatch = msgLower.Contains(patternLower);
                        break;
                }

                if (isMatch) return mapping;
            }

            return null;
        }

        private string GetRelativeFolderPath(string filePath)
        {
            var dir = Path.GetDirectoryName(filePath);
            if (dir == _proceduresPath) return "";
            return Path.GetRelativePath(_proceduresPath, dir);
        }

        private string GetFileIcon(string extension)
        {
            return extension.ToLowerInvariant() switch
            {
                ".pdf"  => "fas fa-file-pdf",
                ".doc"  => "fas fa-file-word",
                ".docx" => "fas fa-file-word",
                ".xls"  => "fas fa-file-excel",
                ".xlsx" => "fas fa-file-excel",
                ".txt"  => "fas fa-file-alt",
                ".html" => "fas fa-file-code",
                ".htm"  => "fas fa-file-code",
                _       => "fas fa-file"
            };
        }
    }

    // ══════════════════════════════════════════════════════════════
    // מחלקות נתונים
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// מיפוי בין תבנית התראה לנוהל
    /// </summary>
    public class AlertProcedureMappingData
    {
        public string Id                  { get; set; }

        /// <summary>תבנית החיפוש בהודעת ההתראה</summary>
        public string Pattern             { get; set; }

        /// <summary>סוג ההתאמה: contains | exact | startswith | endswith | regex</summary>
        public string MatchType           { get; set; } = "contains";

        /// <summary>שם קובץ הנוהל</summary>
        public string ProcedureFileName   { get; set; }

        /// <summary>שם תצוגה של הנוהל</summary>
        public string ProcedureName       { get; set; }

        /// <summary>נתיב תיקיית הנוהל (יחסי)</summary>
        public string ProcedureFolderPath { get; set; } = "";

        /// <summary>תיאור אופציונלי</summary>
        public string Description         { get; set; } = "";

        public string CreatedBy           { get; set; }
        public string CreatedAt           { get; set; }
        public string UpdatedBy           { get; set; }
        public string UpdatedAt           { get; set; }
    }

    /// <summary>
    /// בקשת שמירת מיפוי
    /// </summary>
    public class AlertProcedureMappingRequest
    {
        public string Id                  { get; set; }
        public string Pattern             { get; set; }
        public string MatchType           { get; set; }
        public string ProcedureFileName   { get; set; }
        public string ProcedureName       { get; set; }
        public string ProcedureFolderPath { get; set; }
        public string Description         { get; set; }
    }
}