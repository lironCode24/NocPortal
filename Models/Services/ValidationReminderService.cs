// file: Services/ValidationReminderService.cs
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using NocPortal.Services;

namespace NocPortal.Services
{
    // ─── מחלקת עזר לספירת תוצאות (במקום ref parameters) ───
    internal class RemindersCounter
    {
        public int       SentCount    { get; set; } = 0;
        public int       SkippedCount { get; set; } = 0;
        public List<string> Errors    { get; set; } = new();
    }

    public class ValidationReminderService : BackgroundService
    {
        private readonly ILogger<ValidationReminderService> _logger;
        private readonly IConfiguration                     _config;
        private readonly EmailService                       _emailService;

        private readonly string _jsonStorePath;
        private static readonly object _fileLock = new object();

        // ─── מפתח סודי לטוקנים ───
        private readonly ValidationTokenService _tokenService;

        // ─── PhoneDirectory URL לקבלת מיילים ───
        private readonly string _phoneDirectoryPath;

        public ValidationReminderService(
            ILogger<ValidationReminderService> logger,
            IConfiguration                     config,
            EmailService                       emailService)
        {
            _logger       = logger;
            _config       = config;
            _emailService = emailService;

            _jsonStorePath = config["SystemsCatalog:JsonPath"]
                ?? PortalPaths.UnderFiles(@"systems_catalog.json");

            _phoneDirectoryPath = config["PhoneDirectory:JsonPath"]
                ?? PortalPaths.UnderFiles(@"phone_directory.csv");

            var secretKey = config["ValidationToken:SecretKey"]
                ?? "DefaultSecretKey_ChangeThis_InProduction_2024!";
            _tokenService = new ValidationTokenService(secretKey);
        }

        // ════════════════════════════════════════════════════════
        // ExecuteAsync - לולאה ראשית
        // ════════════════════════════════════════════════════════
        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation(
                "[ValidationReminder] שירות תזכורות תיקוף הופעל");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    var delay = CalculateDelayUntilNext1100();

                    _logger.LogInformation(
                        "[ValidationReminder] תזכורת הבאה בעוד {Minutes} דקות " +
                        "({NextRun:dd/MM/yyyy HH:mm})",
                        (int)delay.TotalMinutes,
                        DateTime.Now.Add(delay));

                    // ─── המתן עד 11:00 ───
                    await Task.Delay(delay, stoppingToken);

                    if (stoppingToken.IsCancellationRequested) break;

                    // ─── הפעל שליחת תזכורות ───
                    await SendRemindersAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // ─── שירות נעצר - זה תקין ───
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "[ValidationReminder] שגיאה בלולאה הראשית");

                    // ─── המתן 5 דקות לפני ניסיון חוזר ───
                    await Task.Delay(
                        TimeSpan.FromMinutes(5), stoppingToken);
                }
            }

            _logger.LogInformation(
                "[ValidationReminder] שירות תזכורות תיקוף נעצר");
        }

        // ════════════════════════════════════════════════════════
        // חשב delay עד 11:00 הבא (ללא שבת)
        // ════════════════════════════════════════════════════════
        private TimeSpan CalculateDelayUntilNext1100()
        {
            var now  = DateTime.Now;
            var next = new DateTime(
                now.Year, now.Month, now.Day,
                11, 0, 0);

            // ─── אם כבר עברנו 11:00 היום - קבע למחר ───
            if (now >= next)
                next = next.AddDays(1);

            // ─── דלג על שבת (DayOfWeek.Saturday = 6) ───
            while (next.DayOfWeek == DayOfWeek.Saturday)
                next = next.AddDays(1);

            return next - now;
        }

        // ════════════════════════════════════════════════════════
        // שלח תזכורות
        // ════════════════════════════════════════════════════════
        private async Task SendRemindersAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation(
                "[ValidationReminder] מתחיל שליחת תזכורות - {Now:dd/MM/yyyy HH:mm}",
                DateTime.Now);

            // ─── בדוק שוב שזה לא שבת ───
            if (DateTime.Now.DayOfWeek == DayOfWeek.Saturday)
            {
                _logger.LogInformation(
                    "[ValidationReminder] שבת - לא שולח תזכורות");
                return;
            }

            try
            {
                // ─── טען מערכות ───
                var systems = LoadSystemsFromJson();
                if (systems == null || systems.Count == 0)
                {
                    _logger.LogInformation(
                        "[ValidationReminder] לא נמצאו מערכות");
                    return;
                }

                // ─── טען מדריך טלפונים לקבלת מיילים ───
                var emailMap = LoadEmailMapFromPhoneDirectory();

                var now      = DateTime.Now;
                var baseUrl  = _config["App:BaseUrl"]
                    ?? "https://nocport-p1apw1";
                var rng      = new Random();

                // ─── מחלקת עזר במקום ref parameters ───
                var counter = new RemindersCounter();

                // ─── שלב 1: תזכורות על תיקוף ממתין (3-7 ימים) ───
                await SendPendingValidationRemindersAsync(
                    systems, emailMap, now, baseUrl, rng,
                    counter, stoppingToken);

                // ─── שלב 2: תזכורות תיקוף שנתי ───
                await SendAnnualValidationRemindersAsync(
                    systems, emailMap, now, baseUrl, rng,
                    counter, stoppingToken);

                _logger.LogInformation(
                    "[ValidationReminder] סיכום: נשלחו {Sent} | " +
                    "דולגו {Skipped} | שגיאות {Errors}",
                    counter.SentCount,
                    counter.SkippedCount,
                    counter.Errors.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "[ValidationReminder] שגיאה כללית בשליחת תזכורות");
            }
        }

        // ════════════════════════════════════════════════════════
        // שלב 1: תזכורות על תיקוף ממתין (3-7 ימים מאז שליחת מייל)
        // ════════════════════════════════════════════════════════
        private async Task SendPendingValidationRemindersAsync(
            List<SystemRecord>         systems,
            Dictionary<string, string> emailMap,
            DateTime                   now,
            string                     baseUrl,
            Random                     rng,
            RemindersCounter           counter,
            CancellationToken          stoppingToken)
        {
            foreach (var system in systems)
            {
                if (stoppingToken.IsCancellationRequested) break;

                // ─── רק מערכות שדורשות תיקוף ───
                if (!system.RequiresValidation)
                    { counter.SkippedCount++; continue; }

                // ─── חייב להיות תאריך שליחה מקורי ───
                if (string.IsNullOrEmpty(system.LastValidationEmailSentAt))
                    { counter.SkippedCount++; continue; }
                    // ─── פרסר תאריך ───
                if (!DateTime.TryParseExact(
                        system.LastValidationEmailSentAt,
                        "yyyy-MM-dd HH:mm", null,
                        System.Globalization.DateTimeStyles.None,
                        out var lastSent))
                    { counter.SkippedCount++; continue; }

                var daysSince = (now - lastSent).TotalDays;

                if (daysSince < 3 || daysSince >= 7)
                    { counter.SkippedCount++; continue; }

                if (daysSince % 2 != 0)
                    { counter.SkippedCount++; continue; }

                var managerEmail = FindManagerEmail(
                    system.SystemManager ?? "", emailMap);

                if (string.IsNullOrWhiteSpace(managerEmail))
                {
                    _logger.LogWarning(
                        "[ValidationReminder] לא נמצא מייל: {Manager} ({System})",
                        system.SystemManager, system.Name);
                    counter.SkippedCount++;
                    continue;
                }

                var originalExpiry = lastSent.AddDays(7);
                var remainingDays  =
                    (int)Math.Ceiling((originalExpiry - now).TotalDays);

                if (remainingDays < 1)
                    { counter.SkippedCount++; continue; }

                var token       = _tokenService.GenerateToken(
                    system.Id, validDays: remainingDays);
                var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

                try
                {
                    (bool ok, string msg) result =
                        await _emailService.SendValidationReminderEmailAsync(
                            toEmail:        managerEmail,
                            toName:         system.SystemManager ?? "",
                            systemName:     system.Name ?? "",
                            validateUrl:    validateUrl,
                            catalogNumber:  system.Number ?? "",
                            daysSinceSent:  (int)Math.Floor(daysSince),
                            originalSentAt: system.LastValidationEmailSentAt
                        );

                    if (result.ok)
                    {
                        counter.SentCount++;
                        system.ValidationReminderCount++;
                        system.LastUpdated = now.ToString("yyyy-MM-dd HH:mm");

                        // ─── שמור מיד אחרי כל שליחה מוצלחת ───
                        SaveSystemsToJson(systems);

                        _logger.LogInformation(
                            "[ValidationReminder] ✅ תזכורת נשלחה: {Name} → {Email}",
                            system.Name, managerEmail);
                    }
                    else
                    {
                        counter.Errors.Add($"{system.Name}: {result.msg}");
                        _logger.LogWarning(
                            "[ValidationReminder] ❌ נכשל: {Name} | {Msg}",
                            system.Name, result.msg);
                    }
                }
                catch (Exception ex)
                {
                    counter.Errors.Add($"{system.Name}: {ex.Message}");
                    _logger.LogError(ex,
                        "[ValidationReminder] שגיאה בשליחה: {Name}",
                        system.Name);
                }

                await DelayBetweenEmails(rng, stoppingToken);
            }
        }

        // ════════════════════════════════════════════════════════
        // שלב 2: תזכורות תיקוף שנתי
        // ════════════════════════════════════════════════════════
        private async Task SendAnnualValidationRemindersAsync(
            List<SystemRecord>         systems,
            Dictionary<string, string> emailMap,
            DateTime                   now,
            string                     baseUrl,
            Random                     rng,
            RemindersCounter           counter,
            CancellationToken          stoppingToken)
        {
            foreach (var system in systems)
            {
                if (stoppingToken.IsCancellationRequested) break;

                if (system.RequiresValidation)
                    { counter.SkippedCount++; continue; }

                if (string.IsNullOrWhiteSpace(system.LastValidatedAt))
                    { counter.SkippedCount++; continue; }

                if (!DateTime.TryParseExact(
                        system.LastValidatedAt,
                        new[] { "dd/MM/yyyy HH:mm", "dd/MM/yyyy" },
                        null,
                        System.Globalization.DateTimeStyles.None,
                        out var lastValidated))
                {
                    _logger.LogWarning(
                        "[ValidationReminder] לא ניתן לפרסר תאריך תיקוף: " +
                        "{Date} ({System})",
                        system.LastValidatedAt, system.Name);
                    counter.SkippedCount++;
                    continue;
                }

                var daysSinceValidation = (now - lastValidated).TotalDays;

                if (daysSinceValidation < 365)
                    { counter.SkippedCount++; continue; }

                var managerEmail = FindManagerEmail(
                    system.SystemManager ?? "", emailMap);

                if (string.IsNullOrWhiteSpace(managerEmail))
                {
                    _logger.LogWarning(
                        "[ValidationReminder] לא נמצא מייל עבור תזכורת שנתית: " +
                        "{Manager} ({System})",
                        system.SystemManager, system.Name);
                    counter.SkippedCount++;
                    continue;
                }

                var token       = _tokenService.GenerateToken(
                    system.Id, validDays: 7);
                var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

                try
                {
                    var result =
                        await _emailService.SendAnnualValidationReminderEmailAsync(
                            toEmail:         managerEmail,
                            toName:          system.SystemManager ?? "",
                            systemName:      system.Name ?? "",
                            validateUrl:     validateUrl,
                            catalogNumber:   system.Number ?? "",
                            lastValidatedAt: system.LastValidatedAt
                        );

                    if (result.ok)
                    {
                        counter.SentCount++;

                        // ─── עדכן מצב המערכת ───
                        system.RequiresValidation        = true;
                        system.LastValidationEmailSentAt =
                            now.ToString("yyyy-MM-dd HH:mm");
                        system.ValidationReminderCount   = 0;
                        system.LastUpdated               =
                            now.ToString("yyyy-MM-dd HH:mm");

                        // ─── שמור מיד אחרי כל שליחה מוצלחת ───
                        SaveSystemsToJson(systems);

                        _logger.LogInformation(
                            "[ValidationReminder] ✅ תזכורת שנתית נשלחה: " +
                            "{Name} → {Email} (תוקף אחרון: {LastValidated})",
                            system.Name, managerEmail, system.LastValidatedAt);
                    }
                    else
                    {
                        counter.Errors.Add($"[שנתי] {system.Name}: {result.msg}");
                        _logger.LogWarning(
                            "[ValidationReminder] ❌ נכשל (שנתי): {Name} | {Msg}",
                            system.Name, result.msg);
                    }
                }
                catch (Exception ex)
                {
                    counter.Errors.Add($"[שנתי] {system.Name}: {ex.Message}");
                    _logger.LogError(ex,
                        "[ValidationReminder] שגיאה בשליחת תזכורת שנתית: {Name}",
                        system.Name);
                }

                await DelayBetweenEmails(rng, stoppingToken);
            }
        }

        // ════════════════════════════════════════════════════════
        // עזר: delay בין מיילים - מוגדר פעם אחת בלבד ✅
        // ════════════════════════════════════════════════════════
        private async Task DelayBetweenEmails(
            Random rng, CancellationToken stoppingToken)
        {
            if (stoppingToken.IsCancellationRequested) return;
            var delaySec = rng.Next(10, 31);
            _logger.LogDebug(
                "[ValidationReminder] ממתין {Sec} שניות...", delaySec);
            await Task.Delay(
                TimeSpan.FromSeconds(delaySec), stoppingToken);
        }

        // ════════════════════════════════════════════════════════
        // מצא מייל מנהל מתוך מדריך הטלפונים
        // ════════════════════════════════════════════════════════
        private string FindManagerEmail(
            string managerName,
            Dictionary<string, string> emailMap)
        {
            if (string.IsNullOrWhiteSpace(managerName)) return "";

            if (emailMap.TryGetValue(
                    managerName.Trim().ToLowerInvariant(),
                    out var email))
                return email;

            var nameLower = managerName.Trim().ToLowerInvariant();
            foreach (var kvp in emailMap)
            {
                if (kvp.Key.Contains(nameLower) ||
                    nameLower.Contains(kvp.Key))
                    return kvp.Value;
            }

            return "";
        }

        // ════════════════════════════════════════════════════════
        // טען מדריך טלפונים → מפה: שם → מייל
        // ════════════════════════════════════════════════════════
        private Dictionary<string, string> LoadEmailMapFromPhoneDirectory()
        {
            var result = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);

            try
            {
                if (!File.Exists(_phoneDirectoryPath))
                {
                    _logger.LogWarning(
                        "[ValidationReminder] קובץ מדריך טלפונים לא נמצא");
                    return result;
                }

                var lines = File.ReadAllLines(
                    _phoneDirectoryPath, Encoding.UTF8);

                foreach (var line in lines.Skip(1))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;

                    var columns = line.Split(',');
                    if (columns.Length < 8) continue;

                    var name  = columns[0].Trim();
                    var email = columns[7].Trim();

                    if (!string.IsNullOrWhiteSpace(name) &&
                        !string.IsNullOrWhiteSpace(email))
                    {
                        result[name.ToLowerInvariant()] = email;
                    }
                }

                _logger.LogInformation(
                    "[ValidationReminder] נטענו {Count} מיילים",
                    result.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "[ValidationReminder] שגיאה בטעינת מדריך טלפונים");
            }

            return result;
        }

        // ════════════════════════════════════════════════════════
        // טען / שמור מערכות
        // ════════════════════════════════════════════════════════
        private List<SystemRecord> LoadSystemsFromJson()
        {
            lock (_fileLock)
            {
                if (!File.Exists(_jsonStorePath))
                    return new List<SystemRecord>();

                var json = File.ReadAllText(_jsonStorePath, Encoding.UTF8);

                return JsonSerializer.Deserialize<List<SystemRecord>>(
                    json,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    }
                ) ?? new List<SystemRecord>();
            }
        }

        private void SaveSystemsToJson(List<SystemRecord> systems)
        {
            lock (_fileLock)
            {
                var json = JsonSerializer.Serialize(systems,
                    new JsonSerializerOptions { WriteIndented = true });

                File.WriteAllText(_jsonStorePath, json, Encoding.UTF8);
            }
        }
    }
}