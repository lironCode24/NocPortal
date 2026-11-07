// PhoneDirectoryChangesController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using NocPortal.Services;
using System.Security.Claims;

[Authorize(Roles = "Admin,NOC")]
public class PhoneDirectoryChangesController : Controller
{

    // ─── נתיבים ──────────────────────────────────────────────────────
    private readonly string _currentCsvPath =
        PortalPaths.UnderFiles(@"phone_directory.csv");

    private readonly string _updatedCsvFolder =
        PortalPaths.UnderFiles(@"Helix_Employees_Export\MergePhoneDirectory");

    private readonly string _historyFilePath =
        PortalPaths.UnderFiles(@"phone_directory_changes_history.json");

    private readonly AuditLogService _auditLog;
    private readonly ILogger<PhoneDirectoryChangesController> _logger;

    // ← הוסף בראש המחלקה, ליד שאר השדות הסטטיים
    // ─── שם אגף מערכות מידע (לאישור אוטומטי) ────────────────────────
    private const string IT_DIVISION = "מטה ואסטרטגיה";

    public PhoneDirectoryChangesController(
        AuditLogService auditLog,
        ILogger<PhoneDirectoryChangesController> logger)
    {
        _auditLog = auditLog;
        _logger   = logger;
    }

    // ═══════════════════════════════════════════════════════════════
    // GET: מסך ראשי
    // ═══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult Index()
    {
        return View();
    }

    // ═══════════════════════════════════════════════════════════════
    // GET: בדוק אם יש שינויים ממתינים (לשימוש ה-header)
    // ═══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult GetPendingChangesCount()
    {
        try
        {
            var latestFile = GetLatestUpdatedCsvFile();
            if (latestFile == null)
                return Json(new
                {
                    success        = true,
                    pendingCount   = 0,
                    reApproveCount = 0,
                    hasChanges     = false
                });

            var currentContacts = ReadCsvContacts(_currentCsvPath);
            var updatedContacts = ReadCsvContacts(latestFile);
            var comparison      = CompareContacts(currentContacts, updatedContacts);
            var history         = ReadHistory();
            MarkProcessedChanges(comparison.Changes, history);

            // ✅ חדש: אשר אוטומטית שינויים של עובדים שאינם באגף מערכות מידע
            var pendingBeforeAuto = comparison.Changes
                .Count(c => c.Status == ChangeStatus.Pending);

            if (pendingBeforeAuto > 0)
            {
                AutoApproveNonITChanges(
                    comparison.Changes,
                    updatedContacts,
                    history);

                _logger.LogInformation(
                    "אישור אוטומטי: לפני={Before}, אחרי={After}",
                    pendingBeforeAuto,
                    comparison.Changes.Count(c => c.Status == ChangeStatus.Pending));
            }

            // ─── ספור רק שינויים שנשארו ממתינים (אגף מערכות מידע) ────
            var pendingCount = comparison.Changes
                .Count(c => c.Status == ChangeStatus.Pending);

            var reApproveCount = comparison.Changes
                .Count(c => c.Status == ChangeStatus.ReApprove);

            var summary = comparison.Summary;

            return Json(new
            {
                success        = true,
                pendingCount   = pendingCount,
                reApproveCount = reApproveCount,
                hasChanges     = pendingCount > 0 || reApproveCount > 0,
                summary        = new
                {
                    newEmployees     = summary.NewEmployees,
                    removedEmployees = summary.RemovedEmployees,
                    fieldChanges     = summary.FieldChanges,
                    total            = summary.TotalChanges
                },
                fileDate = System.IO.File.GetLastWriteTime(latestFile)
                            .ToString("dd/MM/yyyy HH:mm")
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(
                "GetPendingChangesCount error: {Error}", ex.Message);
            return Json(new
            {
                success        = false,
                pendingCount   = 0,
                reApproveCount = 0,
                hasChanges     = false
            });
        }
    }

    // ─── האם העובד שייך לאגף מערכות מידע ────────────────────────────
    private bool IsITDivision(string division)
    {
        if (string.IsNullOrWhiteSpace(division))
            return true;

        return division.Trim().Contains(
            IT_DIVISION,
            StringComparison.OrdinalIgnoreCase);
    }

    // ─── אשר אוטומטית שינויים שאינם אגף מערכות מידע ────────────────
    private void AutoApproveNonITChanges(
        List<DirectoryChange>    changes,
        List<CsvContact>         updatedContacts,
        List<ChangeHistoryEntry> history)
    {
        var updatedByEmail = updatedContacts.ToDictionary(
            c => c.Email,
            c => c,
            StringComparer.OrdinalIgnoreCase);

        var currentContacts = ReadCsvContacts(_currentCsvPath);
        var currentByEmail  = currentContacts.ToDictionary(
            c => c.Email,
            c => c,
            StringComparer.OrdinalIgnoreCase);

        var autoApprovedBy = "אישור אוטומטי";
        var autoApprovedAt = DateTime.Now;

        foreach (var change in changes)
        {
            // ← רק שינויים ממתינים
            if (change.Status != ChangeStatus.Pending) continue;

            // ✅ חדש: דלג על שינויים שנדחו ידנית בהיסטוריה
            var historyEntry = history.FirstOrDefault(h =>
                h.ChangeId == change.ChangeId);

            if (historyEntry != null &&
                historyEntry.Status == ChangeStatus.Rejected)
            {
                _logger.LogInformation(
                    "דילוג על אישור אוטומטי - שינוי נדחה ידנית: " +
                    "{Employee} | שינוי: {Field}",
                    change.EmployeeName, change.FieldName);
                continue;
            }

            // ← קבע את האגף של העובד
            string division = "";

            if (change.ChangeType == ChangeType.RemovedEmployee)
            {
                if (currentByEmail.TryGetValue(
                        change.Email, out var curContact))
                    division = curContact.Division;
            }
            else
            {
                if (updatedByEmail.TryGetValue(
                        change.Email, out var updContact))
                    division = updContact.Division;
            }

            // ← אם לא אגף מערכות מידע - אשר אוטומטית
            if (!IsITDivision(division))
            {
                _logger.LogInformation(
                    "אישור אוטומטי: {Employee} | אגף: '{Division}' | " +
                    "שינוי: {Field}",
                    change.EmployeeName, division, change.FieldName);

                var applyRequest = new ApproveChangeRequest
                {
                    ChangeId     = change.ChangeId,
                    ChangeType   = change.ChangeType,
                    EmployeeName = change.EmployeeName,
                    EmployeeId   = change.EmployeeId,
                    Email        = change.Email,
                    FieldName    = change.FieldName,
                    OldValue     = change.OldValue,
                    NewValue     = change.NewValue,
                    Notes        = $"אושר אוטומטית - אגף: {division}"
                };

                var applyResult = ApplyChangeToDirectory(applyRequest);

                var entry = new ChangeHistoryEntry
                {
                    ChangeId     = change.ChangeId,
                    ChangeType   = change.ChangeType,
                    EmployeeName = change.EmployeeName,
                    EmployeeId   = change.EmployeeId,
                    Email        = change.Email,
                    FieldName    = change.FieldName,
                    OldValue     = change.OldValue,
                    NewValue     = change.NewValue,
                    Status       = applyResult.Success
                                    ? ChangeStatus.Approved
                                    : ChangeStatus.Failed,
                    ProcessedBy  = autoApprovedBy,
                    ProcessedAt  = autoApprovedAt,
                    Notes        = applyResult.Success
                                    ? $"אישור אוטומטי - אגף: {division}"
                                    : applyResult.Message
                };

                history.RemoveAll(h => h.ChangeId == change.ChangeId);
                history.Add(entry);

                change.Status      = applyResult.Success
                                        ? ChangeStatus.Approved
                                        : ChangeStatus.Failed;
                change.ProcessedBy = autoApprovedBy;
                change.ProcessedAt = autoApprovedAt;
            }
        }

        SaveHistory(history);
    }

    // ═══════════════════════════════════════════════════════════════
    // GET: השווה בין הקובץ הקיים לקובץ המעודכן
    // ═══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult CompareDirectories(string? role = null)
    {
        try
        {
            var latestUpdatedFile = GetLatestUpdatedCsvFile();
            if (latestUpdatedFile == null)
                return Json(new { success = false,
                    message = "לא נמצא קובץ CSV מעודכן בתיקייה" });

            var currentContacts = ReadCsvContacts(_currentCsvPath);
            var updatedContacts = ReadCsvContacts(latestUpdatedFile);

            // ─── סנן לפי תפקיד אם נשלח ───────────────────────────
            if (!string.IsNullOrWhiteSpace(role))
            {
                currentContacts = currentContacts
                    .Where(c => string.Equals(c.Role, role,
                        StringComparison.OrdinalIgnoreCase))
                    .ToList();
                updatedContacts = updatedContacts
                    .Where(c => string.Equals(c.Role, role,
                        StringComparison.OrdinalIgnoreCase))
                    .ToList();
            }

            var comparison = CompareContacts(currentContacts, updatedContacts);
            var history    = ReadHistory();
            MarkProcessedChanges(comparison.Changes, history);

            // ─── שלח רשימת תפקידים ייחודיים ──────────────────────
            var allContacts = ReadCsvContacts(_currentCsvPath);
            var roles = allContacts
                .Select(c => c.Role)
                .Where(r => !string.IsNullOrWhiteSpace(r))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(r => r)
                .ToList();

            return Json(new
            {
                success    = true,
                sourceFile = Path.GetFileName(latestUpdatedFile),
                fileDate   = System.IO.File.GetLastWriteTime(latestUpdatedFile)
                                .ToString("dd/MM/yyyy HH:mm"),
                summary    = comparison.Summary,
                changes    = comparison.Changes,
                roles      = roles              // ← רשימת תפקידים
            });
        }
        catch (Exception ex)
        {
            _logger.LogError("CompareDirectories error: {Error}", ex.Message);
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // POST: אשר שינוי בודד
    // ═══════════════════════════════════════════════════════════════
    [HttpPost]
    public IActionResult ApproveChange([FromBody] ApproveChangeRequest request)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(request.ChangeId))
                return Json(new { success = false, message = "מזהה שינוי חסר" });

            var username    = GetCurrentUsername();
            var displayName = GetCurrentDisplayName();

            var history  = ReadHistory();
            var existing = history.FirstOrDefault(h =>
                h.ChangeId == request.ChangeId);

            // ← אפשר אישור אם: Pending, Rejected, ReApprove, או עברו 5 דקות
            if (existing != null && existing.Status == ChangeStatus.Approved)
            {
                var daysSince = DateTime.Now - existing.ProcessedAt;
                if (daysSince <= TimeSpan.FromSeconds(5*60))
                    return Json(new
                    {
                        success = false,
                        message = "שינוי זה כבר אושר"
                    });
                // ← עברו יותר מ-5 דקות - המשך לאישור מחדש
            }

            var applyResult = ApplyChangeToDirectory(request);

            if (!applyResult.Success)
                return Json(new
                {
                    success = false,
                    message = applyResult.Message
                });

            var entry = new ChangeHistoryEntry
            {
                ChangeId     = request.ChangeId,
                ChangeType   = request.ChangeType,
                EmployeeName = request.EmployeeName,
                Email        = request.Email,
                FieldName    = request.FieldName,
                OldValue     = request.OldValue,
                NewValue     = request.NewValue,
                Status       = ChangeStatus.Approved,
                ProcessedBy  = displayName,
                ProcessedAt  = DateTime.Now,
                Notes        = request.Notes ?? ""
            };

            history.RemoveAll(h => h.ChangeId == request.ChangeId);
            history.Add(entry);
            SaveHistory(history);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = "PHONE_DIRECTORY_CHANGE_APPROVED",
                Username    = username,
                PerformedBy = displayName,
                Details     = $"אושר שינוי: {request.ChangeType} | " +
                            $"עובד: {request.EmployeeName} | " +
                            $"שדה: {request.FieldName} | " +
                            $"{request.OldValue} → {request.NewValue}",
                Success     = true
            });

            return Json(new
            {
                success = true,
                message = "השינוי אושר והוחל בהצלחה"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError("ApproveChange error: {Error}", ex.Message);
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // POST: דחה שינוי בודד
    // ═══════════════════════════════════════════════════════════════
    [HttpPost]
    public IActionResult RejectChange([FromBody] ApproveChangeRequest request)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(request.ChangeId))
                return Json(new { success = false, message = "מזהה שינוי חסר" });

            var username    = GetCurrentUsername();
            var displayName = GetCurrentDisplayName();

            var history  = ReadHistory();
            var existing = history.FirstOrDefault(h =>
                h.ChangeId == request.ChangeId);

            // ← אפשר דחייה מ-Pending ומ-ReApprove
            if (existing != null &&
                existing.Status != ChangeStatus.Pending &&
                existing.Status != ChangeStatus.ReApprove)
            {
                // ← בדוק אם עברו 5 ימים
                if (DateTime.Now - existing.ProcessedAt <= TimeSpan.FromDays(5))
                    return Json(new
                    {
                        success = false,
                        message = $"שינוי זה כבר {GetStatusText(existing.Status)}"
                    });
            }

            var entry = new ChangeHistoryEntry
            {
                ChangeId     = request.ChangeId,
                ChangeType   = request.ChangeType,
                EmployeeName = request.EmployeeName,
                Email        = request.Email,
                FieldName    = request.FieldName,
                OldValue     = request.OldValue,
                NewValue     = request.NewValue,
                Status       = ChangeStatus.Rejected,
                ProcessedBy  = displayName,
                ProcessedAt  = DateTime.Now,
                Notes        = request.Notes ?? ""
            };

            history.RemoveAll(h => h.ChangeId == request.ChangeId);
            history.Add(entry);
            SaveHistory(history);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = "PHONE_DIRECTORY_CHANGE_REJECTED",
                Username    = username,
                PerformedBy = displayName,
                Details     = $"נדחה שינוי: {request.ChangeType} | " +
                            $"עובד: {request.EmployeeName}",
                Success     = true
            });

            return Json(new { success = true, message = "השינוי נדחה" });
        }
        catch (Exception ex)
        {
            _logger.LogError("RejectChange error: {Error}", ex.Message);
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // POST: אשר את כל השינויים הממתינים
    // ═══════════════════════════════════════════════════════════════
    [HttpPost]
    public IActionResult ApproveAll([FromBody] BulkActionRequest request)
    {
        try
        {
            if (request?.Changes == null || request.Changes.Count == 0)
                return Json(new
                {
                    success = false,
                    message = "לא נשלחו שינויים לאישור"
                });

            var username    = GetCurrentUsername();
            var displayName = GetCurrentDisplayName();
            var history     = ReadHistory();

            int approved = 0;
            int failed   = 0;
            var errors   = new List<string>();

            foreach (var change in request.Changes)
            {
                try
                {
                    // ─── דלג על שינויים שכבר טופלו ───────────────
                    var existing = history.FirstOrDefault(h =>
                        h.ChangeId == change.ChangeId);

                    if (existing != null)
                    {
                        var canApprove =
                            existing.Status == ChangeStatus.Pending ||
                            existing.Status == ChangeStatus.ReApprove ||
                            (
                                existing.Status == ChangeStatus.Approved &&
                                DateTime.Now - existing.ProcessedAt >
                                TimeSpan.FromMinutes(5)
                            );

                        if (!canApprove)
                            continue;
                    }

                    // ─── החל שינוי ────────────────────────────────
                    var applyResult = ApplyChangeToDirectory(change);

                    var entry = new ChangeHistoryEntry
                    {
                        ChangeId     = change.ChangeId,
                        ChangeType   = change.ChangeType,
                        Email        = change.Email,    
                        EmployeeName = change.EmployeeName,
                        FieldName    = change.FieldName,
                        OldValue     = change.OldValue,
                        NewValue     = change.NewValue,
                        Status       = applyResult.Success
                                           ? ChangeStatus.Approved
                                           : ChangeStatus.Failed,
                        ProcessedBy  = displayName,
                        ProcessedAt  = DateTime.Now,
                        Notes        = applyResult.Success
                                           ? ""
                                           : applyResult.Message
                    };

                    history.RemoveAll(h => h.ChangeId == change.ChangeId);
                    history.Add(entry);

                    if (applyResult.Success) approved++;
                    else
                    {
                        failed++;
                        errors.Add($"{change.EmployeeName}: {applyResult.Message}");
                    }
                }
                catch (Exception ex)
                {
                    failed++;
                    errors.Add($"{change.EmployeeName}: {ex.Message}");
                }
            }

            SaveHistory(history);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = "PHONE_DIRECTORY_BULK_APPROVE",
                Username    = username,
                PerformedBy = displayName,
                Details     = $"אושרו {approved} שינויים, נכשלו {failed}",
                Success     = failed == 0
            });

            return Json(new
            {
                success      = true,
                approvedCount = approved,
                failedCount  = failed,
                errors       = errors,
                message      = $"אושרו {approved} שינויים" +
                               (failed > 0 ? $" | נכשלו {failed}" : "")
            });
        }
        catch (Exception ex)
        {
            _logger.LogError("ApproveAll error: {Error}", ex.Message);
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // POST: דחה את כל השינויים הממתינים
    // ═══════════════════════════════════════════════════════════════
    [HttpPost]
    public IActionResult RejectAll([FromBody] BulkActionRequest request)
    {
        try
        {
            if (request?.Changes == null || request.Changes.Count == 0)
                return Json(new
                {
                    success = false,
                    message = "לא נשלחו שינויים לדחייה"
                });

            var username    = GetCurrentUsername();
            var displayName = GetCurrentDisplayName();
            var history     = ReadHistory();

            int rejected = 0;

            foreach (var change in request.Changes)
            {
                var existing = history.FirstOrDefault(h =>
                    h.ChangeId == change.ChangeId);

                if (existing != null)
                {
                    var canApprove =
                        existing.Status == ChangeStatus.Pending ||
                        existing.Status == ChangeStatus.ReApprove ||
                        (
                            existing.Status == ChangeStatus.Approved &&
                            DateTime.Now - existing.ProcessedAt >
                            TimeSpan.FromMinutes(5)
                        );

                    if (!canApprove)
                        continue;
                }

                var entry = new ChangeHistoryEntry
                {
                    ChangeId     = change.ChangeId,
                    ChangeType   = change.ChangeType,
                    EmployeeName = change.EmployeeName,
                    Email        = change.Email,  
                    FieldName    = change.FieldName,
                    OldValue     = change.OldValue,
                    NewValue     = change.NewValue,
                    Status       = ChangeStatus.Rejected,
                    ProcessedBy  = displayName,
                    ProcessedAt  = DateTime.Now
                };

                history.RemoveAll(h => h.ChangeId == change.ChangeId);
                history.Add(entry);
                rejected++;
            }

            SaveHistory(history);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = "PHONE_DIRECTORY_BULK_REJECT",
                Username    = username,
                PerformedBy = displayName,
                Details     = $"נדחו {rejected} שינויים",
                Success     = true
            });

            return Json(new
            {
                success       = true,
                rejectedCount = rejected,
                message       = $"נדחו {rejected} שינויים"
            });
        }
        catch (Exception ex)
        {
            _logger.LogError("RejectAll error: {Error}", ex.Message);
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GET: היסטוריית שינויים
    // ═══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult GetHistory(int days = 30)
    {
        try
        {
            var cutoff  = DateTime.Now.AddDays(-days);
            var history = ReadHistory()
                .Where(h => h.ProcessedAt >= cutoff)
                .OrderByDescending(h => h.ProcessedAt)
                .ToList();

            return Json(new { success = true, history });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // פונקציות עזר פרטיות
    // ═══════════════════════════════════════════════════════════════

    // ─── מצא קובץ CSV מעודכן אחרון ───────────────────────────────
    private string? GetLatestUpdatedCsvFile()
    {
        if (!Directory.Exists(_updatedCsvFolder))
            return null;

        var files = Directory.GetFiles(
            _updatedCsvFolder,
            "phone_directory_updated-*.csv"
        );

        if (files.Length == 0) return null;

        // מיין לפי תאריך שינוי - האחרון ראשון
        return files
            .OrderByDescending(f =>
                System.IO.File.GetLastWriteTime(f))
            .First();
    }

    // ─── קרא אנשי קשר מ-CSV ──────────────────────────────────────
    private List<CsvContact> ReadCsvContacts(string filePath)
    {
        var contacts = new List<CsvContact>();

        if (!System.IO.File.Exists(filePath))
            return contacts;

        var lines = System.IO.File.ReadAllLines(filePath, Encoding.UTF8);
        if (lines.Length == 0) return contacts;

        var headerCols = SplitCsvLine(lines[0]);
        var colIndex   = DetectColumnIndices(headerCols);

        _logger.LogInformation(
            "CSV עמודות שזוהו: שם={Name} תפקיד={Role} " +
            "טלפון={Phone} שלוחה={Ext} מייל={Email} אגף={Division}",
            colIndex.FullName, colIndex.Role,
            colIndex.Phone, colIndex.Extension, 
            colIndex.Email, colIndex.Division);  // ← הוסף Division ללוג

        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            var cols = SplitCsvLine(line);
            if (cols.Length < 2) continue;

            string GetCol(int idx) =>
                idx >= 0 && idx < cols.Length
                    ? cols[idx].Trim() : "";

            var fullName = GetCol(colIndex.FullName);
            if (string.IsNullOrWhiteSpace(fullName)) continue;

            var email = GetCol(colIndex.Email);
            if (string.IsNullOrWhiteSpace(email))
            {
                email = FindEmailInCols(cols);
                if (!string.IsNullOrWhiteSpace(email))
                    _logger.LogInformation(
                        "מייל נמצא בחיפוש חופשי עבור {Name}: {Email}",
                        fullName, email);
            }
            email = CleanEmail(email);

            contacts.Add(new CsvContact
            {
                FullName    = fullName,
                Role        = GetCol(colIndex.Role),
                Domain      = GetCol(colIndex.Domain),
                Department  = GetCol(colIndex.Department),
                Team        = GetCol(colIndex.Team),
                PhoneNumber = GetCol(colIndex.Phone),
                Extension   = GetCol(colIndex.Extension),
                Email       = email,
                EmployeeId  = GetCol(colIndex.EmployeeId),
                Division    = GetCol(colIndex.Division)  // ← חדש: קרא אגף
            });
        }

        return contacts;
    }

    // ─── נקה מייל ────────────────────────────────────────────────
    private string CleanEmail(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";

        // אם יש @ - חלץ רק את המייל
        if (raw.Contains('@'))
        {
            // פצל לפי פסיק ומצא את החלק עם @
            var parts = raw.Split(',');
            foreach (var part in parts)
            {
                var p = part.Trim();
                if (IsValidEmail(p))
                    return p.ToLowerInvariant();
            }
        }

        return "";
    }

    // ─── זהה אינדקסי עמודות לפי כותרת ───────────────────────────
    private CsvColumnIndices DetectColumnIndices(string[] headers)
    {
        var idx = new CsvColumnIndices();

        for (int i = 0; i < headers.Length; i++)
        {
            var h = headers[i].Trim().ToLowerInvariant()
                        .Replace("\"", "");

            if (h.Contains("שם")    || h.Contains("name"))
                idx.FullName = i;
            else if (h.Contains("תפקיד") || h.Contains("role"))
                idx.Role = i;
            else if (h.Contains("תחום")  || h.Contains("domain"))
                idx.Domain = i;
            else if (h.Contains("מחלקה") || h.Contains("dept"))
                idx.Department = i;
            else if (h.Contains("צוות")  || h.Contains("team"))
                idx.Team = i;
            else if (h.Contains("טלפון") || h.Contains("phone"))
                idx.Phone = i;
            else if (h.Contains("שלוחה") || h.Contains("ext"))
                idx.Extension = i;
            else if (h.Contains("מייל")  || h.Contains("mail")
                                        || h.Contains("email"))
                idx.Email = i;
            else if (h.Contains("מזהה")  || h.Contains("id"))
                idx.EmployeeId = i;
            // ✅ חדש: זיהוי עמודת אגף
            else if (h.Contains("אגף") || h.Contains("division"))
                idx.Division = i;
        }

        return idx;
    }

    // ─── חפש מייל בכל העמודות ────────────────────────────────────
    // ─── חפש מייל בכל העמודות ────────────────────────────────────
private string FindEmailInCols(string[] cols)
{
    // ─── קודם חפש עמודה שהיא רק מייל ────────────────────────
    foreach (var col in cols)
    {
        var val = col.Trim();
        
        // מייל תקין: מכיל @ ונקודה, ללא רווחים, ללא פסיקים
        if (IsValidEmail(val))
            return val;
    }

    // ─── אם לא נמצא - חפש מייל בתוך עמודה מורכבת ────────────
    foreach (var col in cols)
    {
        var val = col.Trim();
        if (!val.Contains('@')) continue;

        // פצל לפי פסיק וחפש מייל
        var parts = val.Split(',');
        foreach (var part in parts)
        {
            var p = part.Trim();
            if (IsValidEmail(p))
                return p;
        }
    }

    return "";
}

// ─── בדוק אם מחרוזת היא מייל תקין ───────────────────────────
private bool IsValidEmail(string val)
{
    if (string.IsNullOrWhiteSpace(val)) return false;
    if (!val.Contains('@'))             return false;
    if (val.Contains(' '))              return false;
    if (val.Contains(','))              return false;

    var atIdx = val.IndexOf('@');
    if (atIdx < 1)                      return false;

    var domain = val.Substring(atIdx + 1);
    if (!domain.Contains('.'))          return false;
    if (domain.StartsWith('.'))         return false;
    if (domain.EndsWith('.'))           return false;

    return true;
}

    // ─── מודל אינדקסי עמודות ─────────────────────────────────────
    private class CsvColumnIndices
    {
        public int FullName   { get; set; } = 0;
        public int Role       { get; set; } = 1;
        public int Domain     { get; set; } = 2;
        public int Department { get; set; } = 3;
        public int Team       { get; set; } = 4;
        public int Phone      { get; set; } = 5;
        public int Extension  { get; set; } = 6;
        public int Email      { get; set; } = 7;
        public int EmployeeId { get; set; } = 8;
        public int Division   { get; set; } = -1; 
    }

    // ─── פיצול שורת CSV (תומך בפסיקים בתוך מרכאות) ──────────────
    private string[] SplitCsvLine(string line)
{
    var result  = new List<string>();
    var current = new StringBuilder();
    bool inQuotes = false;

    for (int i = 0; i < line.Length; i++)
    {
        char c = line[i];

        if (c == '"')
        {
            // ─── מרכאות כפולות בתוך שדה ──────────────────────
            if (inQuotes && i + 1 < line.Length
                         && line[i + 1] == '"')
            {
                current.Append('"');
                i++;
                continue;
            }

            // ─── פתיחת מרכאות - רק אם בתחילת שדה ────────────
            if (!inQuotes && current.Length == 0)
            {
                inQuotes = true;
                continue;
            }

            // ─── סגירת מרכאות ─────────────────────────────────
            if (inQuotes)
            {
                inQuotes = false;
                continue;
            }

            // ─── מרכאה באמצע שדה ללא עטיפה - התעלם ──────────
            // לדוגמה: ושו"ב ← לא פותח/סוגר מצב inQuotes
            current.Append(c);
        }
        else if (c == ',' && !inQuotes)
        {
            result.Add(current.ToString());
            current.Clear();
        }
        else
        {
            current.Append(c);
        }
    }

    result.Add(current.ToString());
    return result.ToArray();
}
    // ─── השווה בין שני רשימות ─────────────────────────────────────
    private ComparisonResult CompareContacts(
        List<CsvContact> current,
        List<CsvContact> updated)
    {
        var changes = new List<DirectoryChange>();

        // ─── בנה מילונים לפי Email (ייחודי) ──────────────────────
        var currentByEmail = new Dictionary<string, CsvContact>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var c in current)
        {
            if (string.IsNullOrWhiteSpace(c.Email))
            {
                _logger.LogWarning(
                    "רשומה ללא מייל ב-CSV הנוכחי: {Name}", c.FullName);
                continue;
            }
            if (!currentByEmail.TryAdd(c.Email, c))
                _logger.LogWarning(
                    "מייל כפול ב-CSV הנוכחי: {Email} ({Name})",
                    c.Email, c.FullName);
        }

        var updatedByEmail = new Dictionary<string, CsvContact>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var c in updated)
        {
            if (string.IsNullOrWhiteSpace(c.Email))
            {
                _logger.LogWarning(
                    "רשומה ללא מייל ב-CSV המעודכן: {Name}", c.FullName);
                continue;
            }
            if (!updatedByEmail.TryAdd(c.Email, c))
                _logger.LogWarning(
                    "מייל כפול ב-CSV המעודכן: {Email} ({Name})",
                    c.Email, c.FullName);
        }

        // ─── עובדים חדשים (קיים ב-updated, לא ב-current) ─────────
        foreach (var upd in updatedByEmail.Values)
        {
            if (!currentByEmail.ContainsKey(upd.Email))
            {
                changes.Add(new DirectoryChange
                {
                    ChangeId     = GenerateChangeId("new", upd.Email),
                    ChangeType   = ChangeType.NewEmployee,
                    EmployeeName = upd.FullName,
                    EmployeeId   = upd.EmployeeId,
                    Email        = upd.Email,
                    FieldName    = "עובד חדש",
                    OldValue     = "",
                    NewValue     = FormatContactSummary(upd),
                    Status       = ChangeStatus.Pending
                });
            }
        }

        // ─── עובדים שהוסרו (קיים ב-current, לא ב-updated) ────────
        foreach (var cur in currentByEmail.Values)
        {
            if (!updatedByEmail.ContainsKey(cur.Email))
            {
                changes.Add(new DirectoryChange
                {
                    ChangeId     = GenerateChangeId("removed", cur.Email),
                    ChangeType   = ChangeType.RemovedEmployee,
                    EmployeeName = cur.FullName,
                    EmployeeId   = cur.EmployeeId,
                    Email        = cur.Email,
                    FieldName    = "עובד שהוסר",
                    OldValue     = FormatContactSummary(cur),
                    NewValue     = "",
                    Status       = ChangeStatus.Pending
                });
            }
        }

        // ─── שינויים בפרטים - חיפוש לפי Email ───────────────────
        foreach (var upd in updatedByEmail.Values)
        {
            if (!currentByEmail.TryGetValue(upd.Email, out var cur))
                continue;

            // שם מלא - עכשיו הגיוני כי מצאנו לפי מייל
            CheckFieldChange(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "שם מלא",    cur.FullName,    upd.FullName,
                ChangeType.NameChange);

            CheckFieldChange(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "תפקיד",     cur.Role,        upd.Role,
                ChangeType.RoleChange);

            CheckFieldChangeWithNormalize(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "טלפון",
                cur.PhoneNumber,
                upd.PhoneNumber,
                ChangeType.PhoneChange,
                NormalizePhone);

            CheckFieldChangeWithNormalize(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "שלוחה",
                cur.Extension,
                upd.Extension,
                ChangeType.ExtensionChange,
                NormalizePhone);

            CheckFieldChange(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "אגף",       cur.Division,    upd.Division,
                ChangeType.OtherChange);

            CheckFieldChange(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "תחום",      cur.Domain,      upd.Domain,
                ChangeType.OtherChange);

            CheckFieldChange(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "מחלקה",     cur.Department,  upd.Department,
                ChangeType.OtherChange);

            CheckFieldChange(changes, upd.FullName, upd.EmployeeId, upd.Email,
                "צוות",      cur.Team,        upd.Team,
                ChangeType.OtherChange);
            
            // מייל - לא בודקים שינוי מייל כי זה המזהה שלנו
        }

        // ─── סיכום ───────────────────────────────────────────────
        var summary = new ChangeSummary
        {
            NewEmployees     = changes.Count(c =>
                c.ChangeType == ChangeType.NewEmployee),
            RemovedEmployees = changes.Count(c =>
                c.ChangeType == ChangeType.RemovedEmployee),
            FieldChanges     = changes.Count(c =>
                c.ChangeType != ChangeType.NewEmployee &&
                c.ChangeType != ChangeType.RemovedEmployee),
            TotalChanges     = changes.Count
        };

        // שינויים בפרטים ממוינים א-ת לפי שם עובד
        // עובדים חדשים ושהוסרו נשארים בראש, שינויי פרטים ממוינים
        var sortedChanges = changes
            .OrderBy(c => c.ChangeType == ChangeType.NewEmployee      ? 0 :
                        c.ChangeType == ChangeType.RemovedEmployee  ? 1 : 2)
            .ThenBy(c => c.EmployeeName,
                    StringComparer.Create(
                        new System.Globalization.CultureInfo("he-IL"),
                        ignoreCase: true))
            .ToList();

        return new ComparisonResult
        {
            Changes = sortedChanges,
            Summary = summary
        };
    }

    // ─── נרמל מספר טלפון (הסר מקפים ורווחים) ────────────────────
    private string NormalizePhone(string phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return "";
        return System.Text.RegularExpressions.Regex
            .Replace(phone.Trim(), @"[\s\-\(\)]", "");
    }

    // פונקציה חדשה לנרמול מספר טלפון
    private void CheckFieldChangeWithNormalize(
        List<DirectoryChange> changes,
        string employeeName, string employeeId, string email,
        string fieldName, string oldValue, string newValue,
        ChangeType changeType,
        Func<string, string>? normalizer = null)
    {
        var oldTrimmed = oldValue?.Trim() ?? "";
        var newTrimmed = newValue?.Trim() ?? "";

        // אם היה ערך והחדש ריק - לא מחליפים
        if (!string.IsNullOrEmpty(oldTrimmed) &&
            string.IsNullOrEmpty(newTrimmed))
            return;

        // נרמול להשוואה בלבד
        var oldNorm = normalizer != null
            ? normalizer(oldTrimmed) : oldTrimmed;
        var newNorm = normalizer != null
            ? normalizer(newTrimmed) : newTrimmed;

        if (string.Equals(oldNorm, newNorm,
                StringComparison.OrdinalIgnoreCase))
            return;

        changes.Add(new DirectoryChange
        {
            ChangeId     = GenerateChangeId(fieldName, email),
            ChangeType   = changeType,
            EmployeeName = employeeName,
            EmployeeId   = employeeId,
            Email        = email,
            FieldName    = fieldName,
            OldValue     = oldTrimmed,  // ← ערך מקורי
            NewValue     = newTrimmed,  // ← ערך מקורי
            Status       = ChangeStatus.Pending
        });
    }

    // ─── בדוק שינוי בשדה ─────────────────────────────────────────
    private void CheckFieldChange(
        List<DirectoryChange> changes,
        string employeeName,
        string employeeId,
        string email,
        string fieldName,
        string oldValue,
        string newValue,
        ChangeType changeType)
    {
        var oldTrimmed = oldValue?.Trim() ?? "";
        var newTrimmed = newValue?.Trim() ?? "";

        // ─── נרמל לפני השוואה ─────────────────────────────────────
        var oldNorm = NormalizeFieldValue(oldTrimmed);
        var newNorm = NormalizeFieldValue(newTrimmed);

        // אם זהים אחרי נרמול - אין שינוי
        if (string.Equals(oldNorm, newNorm,
                StringComparison.OrdinalIgnoreCase))
            return;

        // אם היה ערך והחדש ריק - לא מחליפים
        if (!string.IsNullOrEmpty(oldTrimmed) &&
            string.IsNullOrEmpty(newTrimmed))
            return;

        // אם הערך הישן מתחיל בערך החדש - לא מחליפים
        if (!string.IsNullOrEmpty(oldNorm) &&
            !string.IsNullOrEmpty(newNorm) &&
            newNorm.Length >= 4 &&
            oldNorm.StartsWith(newNorm,
                StringComparison.OrdinalIgnoreCase))
            return;

        changes.Add(new DirectoryChange
        {
            ChangeId     = GenerateChangeId(fieldName, email),
            ChangeType   = changeType,
            EmployeeName = employeeName,
            EmployeeId   = employeeId,
            Email        = email,
            FieldName    = fieldName,
            OldValue     = oldTrimmed,
            NewValue     = newTrimmed,
            Status       = ChangeStatus.Pending
        });
    }

    // ─── נרמל ערך שדה להשוואה ────────────────────────────────────
    private string NormalizeFieldValue(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";

        var result = value.Trim();

        // ─── החלף תווי הפרדה שונים לתו אחיד ─────────────────────
        // פסיק, נקודה-פסיק, & , | , / , - 
        // כולם הופכים לרווח יחיד
        result = System.Text.RegularExpressions.Regex.Replace(
            result,
            @"[\,\;\&\|\\/\-]+",
            " "
        );

        // ─── הסר רווחים מרובים ────────────────────────────────────
        result = System.Text.RegularExpressions.Regex.Replace(
            result,
            @"\s+",
            " "
        );

        return result.Trim();
    }

    // ─── סמן שינויים שכבר טופלו ──────────────────────────────────
    private void MarkProcessedChanges(
        List<DirectoryChange>   changes,
        List<ChangeHistoryEntry> history)
    {
        var historyDict = history.ToDictionary(
            h => h.ChangeId,
            h => h);

        foreach (var change in changes)
        {
            if (historyDict.TryGetValue(change.ChangeId, out var entry))
            {
                change.ProcessedBy = entry.ProcessedBy;
                change.ProcessedAt = entry.ProcessedAt;

                // ← אם עברו יותר מ-5 דקות - סטטוס ReApprove
                if (entry.ProcessedAt != default &&
                    DateTime.Now - entry.ProcessedAt > TimeSpan.FromSeconds(5 * 60) &&
                    entry.Status == ChangeStatus.Approved)
                {
                    change.Status = ChangeStatus.ReApprove;
                    change.CanReApprove = true;
                }
                else
                {
                    change.Status = entry.Status;
                }
            }
        }
    }

    // ─── החל שינוי על ה-CSV ──────────────────────────────────────
    private (bool Success, string Message) ApplyChangeToDirectory(
        ApproveChangeRequest request)
    {
        try
        {
            if (!System.IO.File.Exists(_currentCsvPath))
                return (false, "קובץ ה-CSV הנוכחי לא נמצא");

            var lines = System.IO.File.ReadAllLines(
                _currentCsvPath, Encoding.UTF8).ToList();

            switch (request.ChangeType)
            {
                // ─── עובד חדש ───────────────────────────────────
                case ChangeType.NewEmployee:
                {
                    var latestFile = GetLatestUpdatedCsvFile();
                    if (latestFile == null)
                        return (false, "קובץ מעודכן לא נמצא");

                    var updatedContacts = ReadCsvContacts(latestFile);
                    
                    // ← חיפוש לפי Email
                    var newContact = updatedContacts.FirstOrDefault(c =>
                        string.Equals(c.Email, request.Email,
                            StringComparison.OrdinalIgnoreCase));

                    if (newContact == null)
                        return (false, "עובד לא נמצא בקובץ המעודכן");

                    lines.Add(FormatCsvLine(newContact));
                    System.IO.File.WriteAllLines(
                        _currentCsvPath, lines, Encoding.UTF8);
                    return (true, "עובד נוסף בהצלחה");
                }

                case ChangeType.RemovedEmployee:
                {
                    var newLines = lines.Where((line, idx) =>
                    {
                        if (idx == 0) return true; // שמור כותרת
                        var cols = SplitCsvLine(line);
                        
                        // ← בדוק לפי Email (עמודה 7)
                        var emailInLine = cols.Length > 7 ? cols[7].Trim() : "";
                        return string.IsNullOrEmpty(emailInLine) ||
                            !string.Equals(
                                emailInLine,
                                request.Email,
                                StringComparison.OrdinalIgnoreCase);
                    }).ToList();

                    System.IO.File.WriteAllLines(
                        _currentCsvPath, newLines, Encoding.UTF8);
                    return (true, "עובד הוסר בהצלחה");
                }

                default:
                {
                    int colIndex = GetColumnIndex(request.FieldName);
                    if (colIndex < 0)
                        return (false, $"שדה לא מוכר: {request.FieldName}");

                    bool found = false;
                    for (int i = 1; i < lines.Count; i++)
                    {
                        var cols = SplitCsvLine(lines[i]).ToList();
                        if (cols.Count == 0) continue;

                        // ← חיפוש לפי Email (עמודה 7)
                        var emailInLine = cols.Count > 7 ? cols[7].Trim() : "";
                        if (!string.Equals(
                                emailInLine,
                                request.Email,
                                StringComparison.OrdinalIgnoreCase))
                            continue;

                        while (cols.Count <= colIndex)
                            cols.Add("");

                        cols[colIndex] = request.NewValue ?? "";
                        lines[i] = string.Join(",", cols.Select(EscapeCsvValue));
                        found = true;
                        break;
                    }

                    if (!found)
                        return (false, $"עובד לא נמצא: {request.Email}");

                    System.IO.File.WriteAllLines(
                        _currentCsvPath, lines, Encoding.UTF8);
                    return (true, "שדה עודכן בהצלחה");
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(
                "ApplyChangeToDirectory error: {Error}", ex.Message);
            return (false, ex.Message);
        }
    }

    // ─── קבל אינדקס עמודה לפי שם שדה ────────────────────────────
    private int GetColumnIndex(string fieldName)
    {
        return fieldName switch
        {
            "שם מלא"    => 0,
            "תפקיד"     => 1,
            "תחום"      => 2,
            "מחלקה"     => 3,
            "צוות"      => 4,
            "טלפון"     => 5,
            "שלוחה"     => 6,
            "מייל"      => 7,
            "מזהה עובד" => 8,
            "אגף"       => 9,
            _           => -1
        };
    }

    // ─── עצב ערך CSV - החלף פסיקים ב-& ──────────────────────────
    private string EscapeCsvValue(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";

        // ─── החלף פסיקים ב-& לפני הכל ───────────────────────────
        value = value.Replace(",", " & ");

        // ─── אם נשארו מרכאות או ירידת שורה - עטוף במרכאות ───────
        if (value.Contains('"')  ||
            value.Contains('\n') ||
            value.Contains('\r'))
        {
            return $"\"{value.Replace("\"", "\"\"")}\"";
        }

        return value;
    }

    // ─── עצב שורת CSV מ-CsvContact ───────────────────────────────
    private string FormatCsvLine(CsvContact contact)
    {
        var fields = new[]
        {
            contact.FullName,
            contact.Role,
            contact.Division,
            contact.Domain,
            contact.Department,
            contact.Team,
            contact.PhoneNumber,
            contact.Extension,
            contact.Email,
            contact.EmployeeId
        };
        return string.Join(",", fields.Select(EscapeCsvValue));
    }

    // ─── עצב תקציר איש קשר ───────────────────────────────────────
    private string FormatContactSummary(CsvContact contact)
    {
        var parts = new List<string>();

        if (!string.IsNullOrEmpty(contact.Role))
            parts.Add($"תפקיד: {contact.Role}");
        if (!string.IsNullOrEmpty(contact.Division))
            parts.Add($"אגף: {contact.Division}");
        if (!string.IsNullOrEmpty(contact.Domain))
            parts.Add($"תחום: {contact.Domain}");
        if (!string.IsNullOrEmpty(contact.Department))
            parts.Add($"מחלקה: {contact.Department}");
        if (!string.IsNullOrEmpty(contact.Team))
            parts.Add($"צוות: {contact.Team}");
        if (!string.IsNullOrEmpty(contact.PhoneNumber))
            parts.Add($"טלפון: {contact.PhoneNumber}");
        if (!string.IsNullOrEmpty(contact.Extension))
            parts.Add($"שלוחה: {contact.Extension}");
        if (!string.IsNullOrEmpty(contact.Email))
            parts.Add($"מייל: {contact.Email}");

        return string.Join(" | ", parts);
    }

    // ─── צור מזהה ייחודי לשינוי ──────────────────────────────────
    private string GenerateChangeId(string changeType, string employeeName)
    {
        // מזהה דטרמיניסטי - אותו שינוי = אותו מזהה
        var raw = $"{changeType}_{employeeName}".ToLowerInvariant();
        var bytes = Encoding.UTF8.GetBytes(raw);

        using var sha = System.Security.Cryptography.SHA256.Create();
        var hash = sha.ComputeHash(bytes);
        return Convert.ToHexString(hash)[..16].ToLowerInvariant();
    }

    // ─── קרא היסטוריה ────────────────────────────────────────────
    private List<ChangeHistoryEntry> ReadHistory()
    {
        try
        {
            if (!System.IO.File.Exists(_historyFilePath))
                return new List<ChangeHistoryEntry>();

            var json = System.IO.File.ReadAllText(
                _historyFilePath, Encoding.UTF8);

            return JsonSerializer.Deserialize<List<ChangeHistoryEntry>>(json)
                   ?? new List<ChangeHistoryEntry>();
        }
        catch (Exception ex)
        {
            _logger.LogError(
                "ReadHistory error: {Error}", ex.Message);
            return new List<ChangeHistoryEntry>();
        }
    }

    // ─── שמור היסטוריה ───────────────────────────────────────────
    private void SaveHistory(List<ChangeHistoryEntry> history)
    {
        try
        {
            var dir = Path.GetDirectoryName(_historyFilePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(history,
                new JsonSerializerOptions
                {
                    WriteIndented = true,
                    Encoder = System.Text.Encodings.Web
                        .JavaScriptEncoder.UnsafeRelaxedJsonEscaping
                });

            System.IO.File.WriteAllText(
                _historyFilePath, json, Encoding.UTF8);
        }
        catch (Exception ex)
        {
            _logger.LogError(
                "SaveHistory error: {Error}", ex.Message);
            throw;
        }
    }

    // ─── שם משתמש נוכחי ──────────────────────────────────────────
    private string GetCurrentUsername()
        => User.Identity?.Name
           ?? User.FindFirst(ClaimTypes.Name)?.Value
           ?? "unknown";

    private string GetCurrentDisplayName()
        => User.FindFirst("DisplayName")?.Value
           ?? GetCurrentUsername();

    // ─── טקסט סטטוס ──────────────────────────────────────────────
    private string GetStatusText(ChangeStatus status)
        => status switch
        {
            ChangeStatus.Approved   => "אושר",
            ChangeStatus.Rejected   => "נדחה",
            ChangeStatus.Failed     => "נכשל",
            ChangeStatus.ReApprove  => "ממתין לאישור מחדש",
            _                       => "ממתין"
        };

    // ═══════════════════════════════════════════════════════════════
    // MODELS
    // ═══════════════════════════════════════════════════════════════

    public class CsvContact
    {
        public string FullName    { get; set; } = "";
        public string Role        { get; set; } = "";
        public string Domain      { get; set; } = "";
        public string Department  { get; set; } = "";
        public string Team        { get; set; } = "";
        public string PhoneNumber { get; set; } = "";
        public string Extension   { get; set; } = "";
        public string Email       { get; set; } = "";
        public string EmployeeId  { get; set; } = "";
        public string Division    { get; set; } = ""; 
    }

    public class DirectoryChange
    {
        public string        ChangeId     { get; set; } = "";
        public ChangeType    ChangeType   { get; set; }
        public string        EmployeeName { get; set; } = "";
        public string        EmployeeId   { get; set; } = "";
        public string        Email        { get; set; } = ""; 
        public string        FieldName    { get; set; } = "";
        public string        OldValue     { get; set; } = "";
        public string        NewValue     { get; set; } = "";
        public ChangeStatus  Status       { get; set; } = ChangeStatus.Pending;
        public string?       ProcessedBy  { get; set; }
        public DateTime?     ProcessedAt  { get; set; }
        public bool CanReApprove { get; set; } = false;
    }

    public class ChangeHistoryEntry
    {
        public string       ChangeId     { get; set; } = "";
        public ChangeType   ChangeType   { get; set; }
        public string       EmployeeName { get; set; } = "";
        public string       EmployeeId   { get; set; } = "";
        public string       FieldName    { get; set; } = "";
        public string       Email        { get; set; } = "";
        public string       OldValue     { get; set; } = "";
        public string       NewValue     { get; set; } = "";
        public ChangeStatus Status       { get; set; }
        public string       ProcessedBy  { get; set; } = "";
        public DateTime     ProcessedAt  { get; set; }
        public string       Notes        { get; set; } = "";
    }

    public class ChangeSummary
    {
        public int NewEmployees     { get; set; }
        public int RemovedEmployees { get; set; }
        public int FieldChanges     { get; set; }
        public int TotalChanges     { get; set; }
    }

    public class ComparisonResult
    {
        public List<DirectoryChange> Changes { get; set; } = new();
        public ChangeSummary         Summary { get; set; } = new();
    }

    public class ApproveChangeRequest
    {
        public string      ChangeId     { get; set; } = "";
        public ChangeType  ChangeType   { get; set; }
        public string      EmployeeName { get; set; } = "";
        public string      EmployeeId   { get; set; } = "";
        public string      Email        { get; set; } = "";
        public string      FieldName    { get; set; } = "";
        public string      OldValue     { get; set; } = "";
        public string      NewValue     { get; set; } = "";
        public string?     Notes        { get; set; }
    }

    public class BulkActionRequest
    {
        public List<ApproveChangeRequest> Changes { get; set; } = new();
    }

    public enum ChangeType
    {
        NewEmployee,
        RemovedEmployee,
        NameChange,
        RoleChange,
        PhoneChange,
        ExtensionChange,
        OtherChange
    }

    public enum ChangeStatus
    {
        Pending,
        Approved,
        Rejected,
        Failed,
        ReApprove
    }
}