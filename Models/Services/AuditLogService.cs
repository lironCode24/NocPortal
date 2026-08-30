using System.Text.Json;

namespace NocPortal.Services
{
    public class AuditLogEntry
    {
        public string   Id          { get; set; } = Guid.NewGuid().ToString();
        public DateTime Timestamp   { get; set; } = DateTime.UtcNow;
        public string   EventType   { get; set; } = "";
        public string   Username    { get; set; } = "";
        public string   UserId      { get; set; } = "";
        public string   PerformedBy { get; set; } = "";
        public string   IpAddress   { get; set; } = "";
        public string   Details     { get; set; } = "";
        public bool     Success     { get; set; } = true;
    }

    public static class AuditEventTypes
    {
        public const string Login              = "LOGIN";
        public const string LoginFailed        = "LOGIN_FAILED";
        public const string Logout             = "LOGOUT";
        public const string Register           = "REGISTER";
        public const string UserApproved       = "USER_APPROVED";
        public const string UserDeleted        = "USER_DELETED";
        public const string RoleChanged        = "ROLE_CHANGED";
        public const string PermissionsChanged = "PERMISSIONS_CHANGED";
        public const string MessageCreated      = "MESSAGE_CREATED";
        public const string MessageEdited       = "MESSAGE_EDITED";
        public const string MessageDeactivated  = "MESSAGE_DEACTIVATED";
        public const string MessageAcknowledged = "MESSAGE_ACKNOWLEDGED";
        public const string PasswordChanged         = "PasswordChanged";
        public const string PasswordReset           = "PasswordReset";
        public const string PasswordResetRequested  = "PasswordResetRequested";
        // ── מיילים ──────────────────────────────────────────────────
        public const string EmailSent        = "EMAIL_SENT";
        public const string EmailFailed      = "EMAIL_FAILED";
        public const string EmailTempPass    = "EMAIL_TEMP_PASS";
        public const string EmailReset       = "EMAIL_RESET";
        public const string EmailApproved    = "EMAIL_APPROVED";
        public const string EmailRejected    = "EMAIL_REJECTED";
        public const string EmailChangedPass = "EMAIL_CHANGED_PASS";
        public const string EmailRegister    = "EMAIL_REGISTER";
        public const string EmailCalendar    = "EMAIL_CALENDAR";
        public const string EmailValidation  = "EMAIL_VALIDATION";
    }

    public class AuditLogService
    {
        private readonly string _logFilePath;
        private readonly ILogger<AuditLogService> _logger;
        private readonly object _lock = new();

        public AuditLogService(
            IConfiguration configuration,
            ILogger<AuditLogService> logger)
        {
            _logger = logger;

            // ── קרא נתיב מ-appsettings ────────────────────────────────
            var basePath = configuration["AuditLog:Path"]
                ?? @"R:\USERS\TASHTIT\NOC\Portal\files";

            // ── וודא שהתיקייה קיימת ───────────────────────────────────
            try
            {
                if (!Directory.Exists(basePath))
                {
                    Directory.CreateDirectory(basePath);
                    _logger.LogInformation(
                        "AuditLog: תיקייה נוצרה: {Path}", basePath);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    "AuditLog: שגיאה ביצירת תיקייה {Path}: {Error}",
                    basePath, ex.Message);

                // Fallback לתיקייה מקומית אם הנתיב לא נגיש
                basePath = Path.Combine(
                    AppDomain.CurrentDomain.BaseDirectory, "Logs");
                Directory.CreateDirectory(basePath);

                _logger.LogWarning(
                    "AuditLog: משתמש בנתיב חלופי: {Path}", basePath);
            }

            _logFilePath = Path.Combine(basePath, "audit_log.json");

            _logger.LogInformation(
                "AuditLog: קובץ לוג: {FilePath}", _logFilePath);
        }

        // ── כתיבת רשומה ───────────────────────────────────────────────
        public void Log(AuditLogEntry entry)
        {
            entry.Timestamp = DateTime.UtcNow;

            Task.Run(() =>
            {
                lock (_lock)
                {
                    try
                    {
                        var entries = ReadAllInternal();
                        entries.Add(entry);

                        var json = JsonSerializer.Serialize(
                            entries,
                            new JsonSerializerOptions
                            {
                                WriteIndented    = true,
                                Encoder = System.Text.Encodings.Web
                                    .JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                            });

                        File.WriteAllText(_logFilePath, json);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(
                            "AuditLog: שגיאה בכתיבת לוג: {Error}",
                            ex.Message);
                    }
                }
            });
        }

        // ── קריאה פנימית (ללא lock - נקרא מתוך lock) ──────────────────
        private List<AuditLogEntry> ReadAllInternal()
        {
            if (!File.Exists(_logFilePath))
                return new List<AuditLogEntry>();

            try
            {
                var json = File.ReadAllText(_logFilePath);

                return JsonSerializer
                    .Deserialize<List<AuditLogEntry>>(json)
                       ?? new List<AuditLogEntry>();
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    "AuditLog: שגיאה בקריאת לוג: {Error}", ex.Message);
                return new List<AuditLogEntry>();
            }
        }

        // ── קריאה ציבורית ─────────────────────────────────────────────
        public List<AuditLogEntry> ReadAll()
        {
            lock (_lock)
            {
                return ReadAllInternal();
            }
        }

        // ── פילטור לפי סוג אירוע ──────────────────────────────────────
        public List<AuditLogEntry> GetByEventType(string eventType)
            => ReadAll()
               .Where(e => e.EventType == eventType)
               .OrderByDescending(e => e.Timestamp)
               .ToList();

        // ── פילטור לפי משתמש ──────────────────────────────────────────
        public List<AuditLogEntry> GetByUsername(string username)
            => ReadAll()
               .Where(e => e.Username.Equals(
                   username, StringComparison.OrdinalIgnoreCase))
               .OrderByDescending(e => e.Timestamp)
               .ToList();

        // ── רשומות אחרונות ────────────────────────────────────────────
        public List<AuditLogEntry> GetRecent(int count = 100)
            => ReadAll()
               .OrderByDescending(e => e.Timestamp)
               .Take(count)
               .ToList();

        // ── בדיקה שהקובץ נגיש ────────────────────────────────────────
        public bool IsHealthy()
        {
            try
            {
                var dir = Path.GetDirectoryName(_logFilePath)!;
                return Directory.Exists(dir);
            }
            catch
            {
                return false;
            }
        }

        // ── שליפת כל הרשומות ללא הגבלה ───────────────────────────────
        public List<AuditLogEntry> GetAll()
            => ReadAll()
            .OrderByDescending(e => e.Timestamp)
            .ToList();

        // ── מחיקת לוגים ישנים ─────────────────────────────────────────
        public void CleanOldLogs(int daysToKeep = 90)
        {
            lock (_lock)
            {
                try
                {
                    var cutoff  = DateTime.UtcNow.AddDays(-daysToKeep);
                    var entries = ReadAllInternal()
                        .Where(e => e.Timestamp >= cutoff)
                        .ToList();

                    var json = JsonSerializer.Serialize(
                        entries,
                        new JsonSerializerOptions
                        {
                            WriteIndented = true,
                            Encoder = System.Text.Encodings.Web
                                .JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                        });

                    File.WriteAllText(_logFilePath, json);

                    _logger.LogInformation(
                        "AuditLog: נוקו לוגים ישנים מעל {Days} ימים",
                        daysToKeep);
                }
                catch (Exception ex)
                {
                    _logger.LogError(
                        "AuditLog: שגיאה בניקוי לוגים: {Error}",
                        ex.Message);
                }
            }
        }
    }
}