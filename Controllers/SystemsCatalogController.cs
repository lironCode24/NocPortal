// file: SystemsCatalogController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using NocPortal.Services;
using System.Security.Cryptography;


[AllowAnonymous]
public class SystemsCatalogController : Controller
{
    private readonly EmailService _emailService;
    private readonly IConfiguration _config;
    private readonly ValidationTokenService _tokenService; // ← חדש

    private readonly string _jsonStorePath =
        @"R:\USERS\TASHTIT\NOC\Portal\files\systems_catalog.json";

    private static readonly object _fileLock = new object();

    public SystemsCatalogController(
        IConfiguration config,
        EmailService emailService)
    {
        _config       = config;
        _emailService = emailService;

        // ─── אתחל שירות טוקנים ───
        var secretKey = config["ValidationToken:SecretKey"]
                     ?? "DefaultSecretKey_ChangeThis_InProduction_2024!";
        _tokenService = new ValidationTokenService(secretKey);
    }

    // ─── GET: דף ראשי של הקטלוג (ללא הרשאות) ────────────────────
    [HttpGet]
    public IActionResult Index()
    {
        return View();
    }

    // ─── GET: קבל את כל המערכות ──────────────────────────────
    [HttpGet]
    public IActionResult GetSystems()
    {
        try
        {
            var systems = LoadFromJson();
            return Json(new
            {
                success = true,
                systems,
                count   = systems.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל משתמש נוכחי ────────────────────────────────
    [HttpGet]
    public IActionResult GetCurrentUser()
    {
        try
        {
            return Json(new
            {
                success             = true,
                username            = GetCurrentUsername(),
                isAdmin             = IsCurrentUserAdmin(),
                isAutomationOnly    = IsAutomationOnlyEditor()
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: עדכן מערכת ────────────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult UpdateSystem([FromBody] UpdateSystemRequest request)
    {
        try
        {
            bool isAdmin = IsCurrentUserAdmin();
            bool isAutomationOnly = IsAutomationOnlyEditor();

            if (!isAdmin && !isAutomationOnly)
                return Json(new { success = false, error = "אין הרשאה לביצוע פעולה זו" });

            if (string.IsNullOrEmpty(request?.SystemId))
                return Json(new { success = false, error = "מזהה מערכת נדרש" });

            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == request.SystemId);

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            // ← עכשיו system מוגדר, אפשר להשתמש בו
            if (request.RequiresValidation != null)
                system.RequiresValidation = request.RequiresValidation.Value;

            // ─── עדכן שדות ───────────────────────────────────────
            // אם עורך אוטומציה בלבד - עדכן רק שדות אוטומציה
            if (isAutomationOnly && !isAdmin)
            {
                if (request.HasAutomation  != null) system.HasAutomation  = request.HasAutomation;
                if (request.AutomationNote != null) system.AutomationNote = request.AutomationNote;
            }
            else
            {
                // אדמין - עדכן את כל השדות
                if (request.Number                  != null) system.Number                  = request.Number;
                if (request.Name                    != null) system.Name                    = request.Name;
                if (request.NameEn                  != null) system.NameEn                  = request.NameEn;
                if (request.Description             != null) system.Description             = request.Description;
                if (request.Status                  != null) system.Status                  = request.Status;
                if (request.SystemManager           != null) system.SystemManager           = request.SystemManager;
                if (request.Domain                  != null) system.Domain                  = request.Domain;
                if (request.Department              != null) system.Department              = request.Department;
                if (request.Team                    != null) system.Team                    = request.Team;
                if (request.BusinessDivision        != null) system.BusinessDivision        = request.BusinessDivision;
                if (request.AppClassification       != null) system.AppClassification       = request.AppClassification;
                if (request.AppType                 != null) system.AppType                 = request.AppType;
                if (request.BusinessCriticality     != null) system.BusinessCriticality     = request.BusinessCriticality;
                if (request.AvailabilityRequirement != null) system.AvailabilityRequirement = request.AvailabilityRequirement;
                if (request.Environment             != null) system.Environment             = request.Environment;
                if (request.Publisher               != null) system.Publisher               = request.Publisher;
                if (request.SupportVendor           != null) system.SupportVendor           = request.SupportVendor;
                if (request.CreatedAt               != null) system.CreatedAt               = request.CreatedAt;
                if (request.DepartmentManager       != null) system.DepartmentManager       = request.DepartmentManager;
                if (request.HasAutomation           != null) system.HasAutomation           = request.HasAutomation;
                if (request.AutomationNote          != null) system.AutomationNote          = request.AutomationNote;
            }

            system.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.UpdatedBy   = GetCurrentUsername();

            if (request.HasAutomation  != null) system.HasAutomation  = request.HasAutomation;
            if (request.AutomationNote != null) system.AutomationNote = request.AutomationNote;

            SaveToJson(systems);

            return Json(new
            {
                success = true,
                system,
                message = $"מערכת {system.Name} עודכנה בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: הוסף מערכת חדשה ───────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult AddSystem([FromBody] AddSystemRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            // ─── ולידציה בסיסית ───────────────────────────────────
            if (string.IsNullOrWhiteSpace(request?.Name))
                return Json(new
                {
                    success = false,
                    error   = "שם מערכת הוא שדה חובה"
                });

            if (string.IsNullOrWhiteSpace(request.Number))
                return Json(new
                {
                    success = false,
                    error   = "מספר קטלוגי הוא שדה חובה",
                    missingField = "number"
                });

            if (string.IsNullOrWhiteSpace(request.NameEn))
                return Json(new
                {
                    success = false,
                    error   = "שם אנגלי הוא שדה חובה",
                    missingField = "nameEn"
                });

            if (string.IsNullOrWhiteSpace(request.SystemManager))
                return Json(new
                {
                    success = false,
                    error   = "מנהל מערכת הוא שדה חובה",
                    missingField = "systemManager"
                });

            var systems = LoadFromJson();

            // ─── בדיקת כפילות מספר קטלוג ─────────────────────────
            if (!string.IsNullOrWhiteSpace(request.Number))
            {
                var duplicateNumber = systems.FirstOrDefault(s =>
                    string.Equals(
                        (s.Number ?? "").Trim(),
                        request.Number.Trim(),
                        StringComparison.OrdinalIgnoreCase));

                if (duplicateNumber != null)
                    return Json(new
                    {
                        success        = false,
                        error          = $"מספר קטלוג \"{request.Number}\" כבר קיים במערכת \"{duplicateNumber.Name}\"",
                        duplicateField = "number",
                        duplicateSystem = new
                        {
                            duplicateNumber.Id,
                            duplicateNumber.Name,
                            duplicateNumber.Number
                        }
                    });
            }

            // ─── בדיקת כפילות שם מערכת (עברית) ──────────────────
            var duplicateName = systems.FirstOrDefault(s =>
                string.Equals(
                    (s.Name ?? "").Trim(),
                    request.Name.Trim(),
                    StringComparison.OrdinalIgnoreCase));

            if (duplicateName != null)
                return Json(new
                {
                    success        = false,
                    error          = $"מערכת בשם \"{request.Name}\" כבר קיימת (מספר: {duplicateName.Number})",
                    duplicateField = "name",
                    duplicateSystem = new
                    {
                        duplicateName.Id,
                        duplicateName.Name,
                        duplicateName.Number
                    }
                });

            // ─── בדיקת כפילות שם אנגלי ───────────────────────────
            if (!string.IsNullOrWhiteSpace(request.NameEn))
            {
                var duplicateNameEn = systems.FirstOrDefault(s =>
                    !string.IsNullOrWhiteSpace(s.NameEn) &&
                    string.Equals(
                        (s.NameEn ?? "").Trim(),
                        request.NameEn.Trim(),
                        StringComparison.OrdinalIgnoreCase));

                if (duplicateNameEn != null)
                    return Json(new
                    {
                        success        = false,
                        error          = $"שם אנגלי \"{request.NameEn}\" כבר קיים במערכת \"{duplicateNameEn.Name}\"",
                        duplicateField = "nameEn",
                        duplicateSystem = new
                        {
                            duplicateNameEn.Id,
                            duplicateNameEn.Name,
                            duplicateNameEn.Number,
                            duplicateNameEn.NameEn
                        }
                    });
            }

            // ─── הוסף מערכת חדשה ─────────────────────────────────
            var now  = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user = GetCurrentUsername();

            var newSystem = new SystemRecord
            {
                Id          = $"sys_{Guid.NewGuid():N}",
                Number      = request.Number                  ?? "",
                Name        = request.Name                    ?? "",
                NameEn      = request.NameEn                  ?? "",
                Description = request.Description             ?? "",
                Status      = request.Status                  ?? "",
                SystemManager           = request.SystemManager           ?? "",
                Domain                  = request.Domain                  ?? "",
                Department              = request.Department              ?? "",
                Team                    = request.Team                    ?? "",
                BusinessDivision        = request.BusinessDivision        ?? "",
                AppClassification       = request.AppClassification       ?? "",
                AppType                 = request.AppType                 ?? "",
                BusinessCriticality     = request.BusinessCriticality     ?? "",
                AvailabilityRequirement = request.AvailabilityRequirement ?? "",
                Environment             = request.Environment             ?? "",
                Publisher               = request.Publisher               ?? "",
                SupportVendor           = request.SupportVendor           ?? "",
                CreatedAt               = !string.IsNullOrEmpty(request.CreatedAt)
                                            ? request.CreatedAt
                                            : DateTime.Now.ToString("dd/MM/yyyy"),
                LastUpdated             = now,
                UpdatedBy               = user,
                HasAutomation           = request.HasAutomation  ?? "לא קיימות",
                AutomationNote          = request.AutomationNote ?? "",
                ImportedAt              = "",
                DepartmentManager       = request.DepartmentManager ?? "",
                RequiresValidation      = request.RequiresValidation ?? false,
            };

            systems.Add(newSystem);
            SaveToJson(systems);

            return Json(new
            {
                success = true,
                system  = newSystem,
                message = $"מערכת {newSystem.Name} נוספה בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: ייבא מערכות ────────────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult ImportSystems([FromBody] ImportSystemsRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לייבוא"
                });

            if (request?.Systems == null || request.Systems.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו מערכות לייבוא"
                });

            var existing = LoadFromJson();

            // ─── בנה מפה לפי שם (lowercase) ──────────────────
            var existingMap = existing.ToDictionary(
                s => (s.Name ?? "").ToLowerInvariant(),
                s => s,
                StringComparer.OrdinalIgnoreCase);

            int addedCount   = 0;
            int updatedCount = 0;
            var now          = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user         = GetCurrentUsername();

            foreach (var imported in request.Systems)
            {
                if (string.IsNullOrWhiteSpace(imported.Name))
                    continue;

                var key = (imported.Name ?? "").ToLowerInvariant();

                if (existingMap.TryGetValue(key, out var existingSystem))
                {
                    // ─── עדכן קיים (אם overwrite) ────────────
                    if (request.Overwrite)
                    {
                        if (!string.IsNullOrEmpty(imported.Number))
                            existingSystem.Number = imported.Number;
                        if (!string.IsNullOrEmpty(imported.NameEn))
                            existingSystem.NameEn = imported.NameEn;
                        if (!string.IsNullOrEmpty(imported.Description))
                            existingSystem.Description = imported.Description;
                        if (!string.IsNullOrEmpty(imported.Status))
                            existingSystem.Status = imported.Status;
                        if (!string.IsNullOrEmpty(imported.SystemManager))
                            existingSystem.SystemManager = imported.SystemManager;
                        if (!string.IsNullOrEmpty(imported.Domain))
                            existingSystem.Domain = imported.Domain;
                        if (!string.IsNullOrEmpty(imported.Department))
                            existingSystem.Department = imported.Department;
                        if (!string.IsNullOrEmpty(imported.Team))
                            existingSystem.Team = imported.Team;
                        if (!string.IsNullOrEmpty(imported.BusinessDivision))
                            existingSystem.BusinessDivision = imported.BusinessDivision;
                        if (!string.IsNullOrEmpty(imported.AppClassification))
                            existingSystem.AppClassification = imported.AppClassification;
                        if (!string.IsNullOrEmpty(imported.AppType))
                            existingSystem.AppType = imported.AppType;
                        if (!string.IsNullOrEmpty(imported.BusinessCriticality))
                            existingSystem.BusinessCriticality = imported.BusinessCriticality;
                        if (!string.IsNullOrEmpty(imported.AvailabilityRequirement))
                            existingSystem.AvailabilityRequirement = imported.AvailabilityRequirement;
                        if (!string.IsNullOrEmpty(imported.Environment))
                            existingSystem.Environment = imported.Environment;
                        if (!string.IsNullOrEmpty(imported.Publisher))
                            existingSystem.Publisher = imported.Publisher;
                        if (!string.IsNullOrEmpty(imported.SupportVendor))
                            existingSystem.SupportVendor = imported.SupportVendor;
                        if (!string.IsNullOrEmpty(imported.CreatedAt))
                            existingSystem.CreatedAt = imported.CreatedAt;

                        existingSystem.LastUpdated = now;
                        existingSystem.UpdatedBy   = user;
                        updatedCount++;
                    }
                }
                else
                {
                    // ─── הוסף חדש ────────────────────────────
                    existing.Add(new SystemRecord
                    {
                        Id                      = $"sys_{Guid.NewGuid():N}",
                        Number                  = imported.Number                  ?? "",
                        Name                    = imported.Name                    ?? "",
                        NameEn                  = imported.NameEn                  ?? "",
                        Description             = imported.Description             ?? "",
                        Status                  = imported.Status                  ?? "",
                        SystemManager           = imported.SystemManager           ?? "",
                        Domain                  = imported.Domain                  ?? "",
                        Department              = imported.Department              ?? "",
                        Team                    = imported.Team                    ?? "",
                        BusinessDivision        = imported.BusinessDivision        ?? "",
                        AppClassification       = imported.AppClassification       ?? "",
                        AppType                 = imported.AppType                 ?? "",
                        BusinessCriticality     = imported.BusinessCriticality     ?? "",
                        AvailabilityRequirement = imported.AvailabilityRequirement ?? "",
                        Environment             = imported.Environment             ?? "",
                        Publisher               = imported.Publisher               ?? "",
                        SupportVendor           = imported.SupportVendor           ?? "",
                        CreatedAt               = imported.CreatedAt               ?? "",
                        LastUpdated             = now,
                        UpdatedBy               = user,
                        ImportedAt              = now
                    });
                    addedCount++;
                }
            }

            SaveToJson(existing);

            return Json(new
            {
                success      = true,
                addedCount,
                updatedCount,
                totalCount   = existing.Count,
                message      = $"יובאו {addedCount} חדשות" +
                               (updatedCount > 0
                                   ? $" + {updatedCount} עודכנו"
                                   : "")
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: ייבא אוטומציה מאקסל ──────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult ImportAutomationFromExcel(
        [FromBody] ImportAutomationRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לייבוא"
                });

            if (request?.Items == null || request.Items.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו נתונים לייבוא"
                });

            var systems = LoadFromJson();
            var now     = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user    = GetCurrentUsername();

            int updatedCount  = 0;
            int notFoundCount = 0;
            var notFoundList  = new List<string>();

            foreach (var item in request.Items)
            {
                if (string.IsNullOrWhiteSpace(item.CatalogNumber))
                    continue;

                // ─── חפש לפי מספר קטלוג (מדויק) ───
                var system = systems.FirstOrDefault(s =>
                    string.Equals(
                        (s.Number ?? "").Trim(),
                        item.CatalogNumber.Trim(),
                        StringComparison.OrdinalIgnoreCase));

                if (system == null)
                {
                    notFoundCount++;
                    notFoundList.Add(item.CatalogNumber);
                    continue;
                }

                // ─── עדכן ערך אוטומציה ───
                var validValues = new HashSet<string>
                {
                    "קיימות", "לא קיימות", "לא רלוונטי"
                };

                if (!string.IsNullOrWhiteSpace(item.AutomationStatus) &&
                    validValues.Contains(item.AutomationStatus.Trim()))
                {
                    system.HasAutomation = item.AutomationStatus.Trim();
                }

                if (item.AutomationNote != null)
                    system.AutomationNote = item.AutomationNote.Trim();

                system.LastUpdated = now;
                system.UpdatedBy   = user;
                updatedCount++;
            }

            SaveToJson(systems);

            return Json(new
            {
                success      = true,
                updatedCount,
                notFoundCount,
                notFoundList,
                message      = $"עודכנו {updatedCount} מערכות" +
                            (notFoundCount > 0
                                ? $" | {notFoundCount} לא נמצאו"
                                : "")
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: מחק מערכת ─────────────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult DeleteSystem([FromBody] DeleteSystemRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה למחיקה"
                });

            if (string.IsNullOrEmpty(request?.SystemId))
                return Json(new
                {
                    success = false,
                    error   = "מזהה מערכת נדרש"
                });

            var systems = LoadFromJson();
            var before  = systems.Count;

            systems = systems
                .Where(s => s.Id != request.SystemId)
                .ToList();

            if (systems.Count == before)
                return Json(new
                {
                    success = false,
                    error   = "מערכת לא נמצאה"
                });

            SaveToJson(systems);

            return Json(new
            {
                success    = true,
                totalCount = systems.Count,
                message    = "המערכת נמחקה בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מערכת בודדת לפי ID (ללא הרשאות) ──────────────
    [HttpGet]
    [Authorize]
    public IActionResult GetSystemById(string id)
    {
        try
        {
            if (string.IsNullOrEmpty(id))
                return Json(new { success = false, error = "מזהה נדרש" });

            var systems = LoadFromJson();
            var system = systems.FirstOrDefault(s => s.Id == id);

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            return Json(new { success = true, system });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מערכת בודדת לפי שם ────────────────────────────
    [HttpGet]
    [Authorize]
    public IActionResult GetSystemByCatalogNum(string number)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(number))
                return Json(new { success = false, error = "מספר קטלוגי נדרש" });

            var systems = LoadFromJson();

            // ─── חיפוש מדויק תחילה ───────────────────────────────
            var system = systems.FirstOrDefault(s =>
                string.Equals(s.Number, number, StringComparison.OrdinalIgnoreCase));

            // ─── אם לא נמצא - חיפוש חלקי ────────────────────────
            if (system == null)
            {
                system = systems.FirstOrDefault(s =>
                    (s.Number ?? "").IndexOf(number, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    number.IndexOf(s.Number ?? "", StringComparison.OrdinalIgnoreCase) >= 0);
            }

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            return Json(new { success = true, system });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }
    
    // ─── GET: קבל מערכת בודדת לפי שם ────────────────────────────
    [HttpGet]
    [Authorize]
    public IActionResult GetSystemByName(string name)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name))
                return Json(new { success = false, error = "שם מערכת נדרש" });

            var systems = LoadFromJson();

            // ─── חיפוש מדויק תחילה ───────────────────────────────
            var system = systems.FirstOrDefault(s =>
                string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));

            // ─── אם לא נמצא - חיפוש חלקי ────────────────────────
            if (system == null)
            {
                system = systems.FirstOrDefault(s =>
                    (s.Name ?? "").IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf(s.Name ?? "", StringComparison.OrdinalIgnoreCase) >= 0);
            }

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            return Json(new { success = true, system });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: עדכן מערכת ללא הרשאות (דף תיקוף) ────────────────
    [HttpPost]
    public async Task<IActionResult> UpdateSystemPublic([FromBody] UpdateSystemRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request?.SystemId))
                return Json(new { success = false, error = "מזהה מערכת נדרש" });

            var systems = LoadFromJson();
            var system = systems.FirstOrDefault(s => s.Id == request.SystemId);

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            if (request.Number                  != null) system.Number                  = request.Number;
            if (request.Name                    != null) system.Name                    = request.Name;
            if (request.NameEn                  != null) system.NameEn                  = request.NameEn;
            if (request.Description             != null) system.Description             = request.Description;
            if (request.Status                  != null) system.Status                  = request.Status;
            if (request.SystemManager           != null) system.SystemManager           = request.SystemManager;
            if (request.Domain                  != null) system.Domain                  = request.Domain;
            if (request.Department              != null) system.Department              = request.Department;
            if (request.Team                    != null) system.Team                    = request.Team;
            if (request.BusinessDivision        != null) system.BusinessDivision        = request.BusinessDivision;
            if (request.AppClassification       != null) system.AppClassification       = request.AppClassification;
            if (request.AppType                 != null) system.AppType                 = request.AppType;
            if (request.BusinessCriticality     != null) system.BusinessCriticality     = request.BusinessCriticality;
            if (request.AvailabilityRequirement != null) system.AvailabilityRequirement = request.AvailabilityRequirement;
            if (request.Environment             != null) system.Environment             = request.Environment;
            if (request.Publisher               != null) system.Publisher               = request.Publisher;
            if (request.SupportVendor           != null) system.SupportVendor           = request.SupportVendor;
            if (request.CreatedAt               != null) system.CreatedAt               = request.CreatedAt;

            system.LastUpdated        = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.UpdatedBy          = "public-validation";
            system.LastValidatedAt    = DateTime.Now.ToString("dd/MM/yyyy HH:mm");
            system.RequiresValidation = false;

            SaveToJson(systems);

            // שלח מייל אישור תיקוף
            var baseUrl      = $"{Request.Scheme}://{Request.Host}";
            var systemUrl    = $"{baseUrl}/dashboards?dashboard=systems-catalog";
            var managerEmail = request.ManagerEmail;

            if (!string.IsNullOrWhiteSpace(managerEmail))
            {
                await _emailService.SendValidationCompletedEmailAsync(
                    managerEmail:  managerEmail,
                    managerName:   system.SystemManager ?? "",
                    systemName:    system.Name ?? "",
                    systemUrl:     systemUrl,
                    validatedAt:   system.LastValidatedAt,
                    catalogNumber: system.Number ?? ""
                );
            }

            return Json(new { success = true, system,
                message = $"מערכת {system.Name} עודכנה בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: דף תיקוף (View) ────────────────────────────────────
    [HttpGet]
    public IActionResult Validate(string id)
    {
        if (string.IsNullOrEmpty(id))
            return Content("מזהה מערכת חסר", "text/plain");

        // ─── נסה לפענח כטוקן חדש ───
        var (valid, systemId, error) = _tokenService.ValidateToken(id);

        if (!valid)
        {
            // ─── בדוק אם זה ID ישן (לתאימות לאחור) ───
            var systems = LoadFromJson();
            var oldSystem = systems.FirstOrDefault(s => s.Id == id);

            if (oldSystem != null)
            {
                // ─── ID ישן - הצג אזהרה אבל אפשר גישה ───
                ViewBag.SystemId = id;
                ViewBag.Warning  = "קישור ישן - מומלץ לבקש קישור חדש";
                return View();
            }

            // ─── טוקן לא תקין / פג תוקף ───
            ViewBag.TokenError = error;
            return View("ValidateExpired");
        }

        ViewBag.SystemId = systemId;
        return View();
    }

    // ─── POST: שמור את כל המערכות ────────────────────────────
    [HttpPost]
    public IActionResult SaveSystems([FromBody] SaveSystemsRequest request)
    {
        try
        {
            if (request?.Systems == null)
                return Json(new
                {
                    success = false,
                    error   = "אין נתונים לשמירה"
                });

            SaveToJson(request.Systems);

            return Json(new
            {
                success = true,
                count   = request.Systems.Count,
                message = $"נשמרו {request.Systems.Count} מערכות"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: עדכן מספר מערכות בבת אחת ──────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult UpdateMultipleSystems(
        [FromBody] UpdateMultipleSystemsRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            if (request?.SystemIds == null || request.SystemIds.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו מערכות לעדכון"
                });

            var systems = LoadFromJson();
            var updated = 0;
            var now     = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user    = GetCurrentUsername();

            foreach (var id in request.SystemIds)
            {
                var system = systems.FirstOrDefault(s => s.Id == id);
                if (system == null) continue;

                var u = request.Updates;

                if (u.Status                  != null) system.Status                  = u.Status;
                if (u.Environment             != null) system.Environment             = u.Environment;
                if (u.HasAutomation           != null) system.HasAutomation           = u.HasAutomation;
                if (u.SystemManager           != null) system.SystemManager           = u.SystemManager;
                if (u.DepartmentManager       != null) system.DepartmentManager       = u.DepartmentManager;
                if (u.Domain                  != null) system.Domain                  = u.Domain;
                if (u.Department              != null) system.Department              = u.Department;
                if (u.Team                    != null) system.Team                    = u.Team;
                if (u.BusinessDivision        != null) system.BusinessDivision        = u.BusinessDivision;
                if (u.AppClassification       != null) system.AppClassification       = u.AppClassification;
                if (u.AppType                 != null) system.AppType                 = u.AppType;
                if (u.BusinessCriticality     != null) system.BusinessCriticality     = u.BusinessCriticality;
                if (u.AvailabilityRequirement != null) system.AvailabilityRequirement = u.AvailabilityRequirement;
                if (u.RequiresValidation != null) system.RequiresValidation = u.RequiresValidation.Value;
                system.LastUpdated = now;
                system.UpdatedBy   = user;
                updated++;
            }

            SaveToJson(systems);

            return Json(new
            {
                success      = true,
                updatedCount = updated,
                message      = $"עודכנו {updated} מערכות"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: שלח מייל תיקוף ────────────────────────────────────────────
    [HttpPost]
    [Authorize]
    public async Task<IActionResult> SendValidationEmail(
        [FromBody] SendValidationEmailRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == request.SystemId);
            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            system.RequiresValidation = true;
            system.LastUpdated        = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.UpdatedBy          = GetCurrentUsername();
            SaveToJson(systems);

            var baseUrl = $"{Request.Scheme}://{Request.Host}";

            // ─── צור טוקן עם תוקף שבוע ───
            var token       = _tokenService.GenerateToken(system.Id, validDays: 7);
            var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

            var (success, message) = await _emailService.SendValidationRequestEmailAsync(
                toEmail:       request.ManagerEmail,
                toName:        system.SystemManager ?? "",
                systemName:    system.Name ?? "",
                validateUrl:   validateUrl,
                catalogNumber: system.Number ?? ""
            );

            return Json(new { success, message, requiresValidation = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: שלח מיילי תיקוף מרובים ───────────────────────────────────
    [HttpPost]
    [Authorize]
    public async Task<IActionResult> SendBulkValidationEmails(
        [FromBody] BulkValidationRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            var systems = LoadFromJson();
            var baseUrl = $"{Request.Scheme}://{Request.Host}";

            int sentCount    = 0;
            int markedCount  = 0;
            var noManager    = new List<string>();
            var noDeptMgr    = new List<string>();
            var errors       = new List<string>();

            foreach (var systemId in request.SystemIds)
            {
                var system = systems.FirstOrDefault(s => s.Id == systemId);
                if (system == null) continue;

                if (string.IsNullOrWhiteSpace(system.SystemManager))
                    noManager.Add(system.Name ?? systemId);

                if (string.IsNullOrWhiteSpace(system.DepartmentManager))
                    noDeptMgr.Add(system.Name ?? systemId);

                system.RequiresValidation = true;
                system.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
                system.UpdatedBy   = GetCurrentUsername();
                markedCount++;

                if (!string.IsNullOrWhiteSpace(request.ManagerEmailMap?
                        .GetValueOrDefault(systemId)))
                {
                    // ─── צור טוקן עם תוקף שבוע ───
                    var token       = _tokenService.GenerateToken(system.Id, validDays: 7);
                    var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

                    var managerEmail = request.ManagerEmailMap[systemId];
                    // ─── שלח מייל ───
                    var (ok, msg) = await _emailService.SendValidationRequestEmailAsync(
                        toEmail:       managerEmail,
                        toName:        system.SystemManager ?? "",
                        systemName:    system.Name ?? "",
                        validateUrl:   validateUrl,
                        catalogNumber: system.Number ?? ""
                    );

                    if (ok) sentCount++;
                    else    errors.Add($"{system.Name}: {msg}");
                }
            }

            SaveToJson(systems);

            if (noManager.Count > 0 || noDeptMgr.Count > 0)
            {
                await _emailService.SendBulkValidationSummaryEmailAsync(
                    toEmail:      "talyoh@menoramivt.co.il",
                    noManager:    noManager,
                    noDeptManager: noDeptMgr,
                    totalSent:    sentCount,
                    totalMarked:  markedCount
                );
            }

            return Json(new
            {
                success      = true,
                sentCount,
                markedCount,
                noManagerCount  = noManager.Count,
                noDeptMgrCount  = noDeptMgr.Count,
                message = $"סומנו {markedCount} מערכות | נשלחו {sentCount} מיילים"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: צור טוקן תיקוף ─────────────────────────────────────
    [HttpGet]
    [Authorize]
    public IActionResult GenerateValidationToken(string systemId)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            if (string.IsNullOrEmpty(systemId))
                return Json(new { success = false, error = "מזהה נדרש" });

            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == systemId);
            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            var token       = _tokenService.GenerateToken(systemId, validDays: 7);
            var baseUrl     = $"{Request.Scheme}://{Request.Host}";
            var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

            // ─── חשב תאריך תפוגה להצגה ───
            var expiryDate = DateTime.Now.AddDays(7)
                                    .ToString("dd/MM/yyyy HH:mm");

            return Json(new
            {
                success    = true,
                url        = validateUrl,
                token,
                expiryDate,
                message    = $"הקישור תקף עד {expiryDate}"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── עזרים פרטיים ────────────────────────────────────────
    private List<SystemRecord> LoadFromJson()
    {
        lock (_fileLock)
        {
            if (!System.IO.File.Exists(_jsonStorePath))
                return new List<SystemRecord>();

            var json = System.IO.File.ReadAllText(
                _jsonStorePath, Encoding.UTF8);

            // ─── נסה לטעון ישירות ───
            try
            {
                var systems = JsonSerializer.Deserialize<List<SystemRecord>>(
                    json,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    }
                ) ?? new List<SystemRecord>();

                return systems;
            }
            catch
            {
                // ─── fallback: טען כ-JsonDocument והמר ידנית ───
                return LoadFromJsonWithFallback(json);
            }
        }
    }

    private List<SystemRecord> LoadFromJsonWithFallback(string json)
    {
        var result  = new List<SystemRecord>();
        var doc     = JsonDocument.Parse(json);

        foreach (var el in doc.RootElement.EnumerateArray())
        {
            var rec = new SystemRecord();

            foreach (var prop in el.EnumerateObject())
            {
                switch (prop.Name.ToLower())
                {
                    case "id":                      rec.Id                      = prop.Value.GetString() ?? ""; break;
                    case "number":                  rec.Number                  = prop.Value.GetString() ?? ""; break;
                    case "name":                    rec.Name                    = prop.Value.GetString() ?? ""; break;
                    case "nameen":                  rec.NameEn                  = prop.Value.GetString() ?? ""; break;
                    case "description":             rec.Description             = prop.Value.GetString() ?? ""; break;
                    case "status":                  rec.Status                  = prop.Value.GetString() ?? ""; break;
                    case "systemmanager":           rec.SystemManager           = prop.Value.GetString() ?? ""; break;
                    case "domain":                  rec.Domain                  = prop.Value.GetString() ?? ""; break;
                    case "department":              rec.Department              = prop.Value.GetString() ?? ""; break;
                    case "team":                    rec.Team                    = prop.Value.GetString() ?? ""; break;
                    case "businessdivision":        rec.BusinessDivision        = prop.Value.GetString() ?? ""; break;
                    case "appclassification":       rec.AppClassification       = prop.Value.GetString() ?? ""; break;
                    case "apptype":                 rec.AppType                 = prop.Value.GetString() ?? ""; break;
                    case "businesscriticality":     rec.BusinessCriticality     = prop.Value.GetString() ?? ""; break;
                    case "availabilityrequirement": rec.AvailabilityRequirement = prop.Value.GetString() ?? ""; break;
                    case "environment":             rec.Environment             = prop.Value.GetString() ?? ""; break;
                    case "publisher":               rec.Publisher               = prop.Value.GetString() ?? ""; break;
                    case "supportvendor":           rec.SupportVendor           = prop.Value.GetString() ?? ""; break;
                    case "createdat":               rec.CreatedAt               = prop.Value.GetString() ?? ""; break;
                    case "importedat":              rec.ImportedAt              = prop.Value.GetString() ?? ""; break;
                    case "lastupdated":             rec.LastUpdated             = prop.Value.GetString(); break;
                    case "updatedby":               rec.UpdatedBy               = prop.Value.GetString(); break;
                    case "automationNote":          rec.AutomationNote          = prop.Value.GetString() ?? ""; break;
                    case "departmentmanager": rec.DepartmentManager = prop.Value.GetString() ?? ""; break;
                    case "requiresvalidation": rec.RequiresValidation = prop.Value.GetBoolean(); break;
                    case "lastvalidatedat": rec.LastValidatedAt = prop.Value.GetString() ?? ""; break;

                    // ─── המרה בטוחה: bool ישן → string חדש ───
                    case "hasautomation":
                        if (prop.Value.ValueKind == JsonValueKind.True)
                            rec.HasAutomation = "קיימות";
                        else if (prop.Value.ValueKind == JsonValueKind.False)
                            rec.HasAutomation = "לא קיימות";
                        else if (prop.Value.ValueKind == JsonValueKind.String)
                            rec.HasAutomation = prop.Value.GetString() ?? "לא קיימות";
                        break;
                }
            }

            result.Add(rec);
        }

        // ─── שמור מחדש בפורמט החדש ───
        SaveToJson(result);

        return result;
    }

    private void SaveToJson(List<SystemRecord> systems)
    {
        lock (_fileLock)
        {
            var dir = Path.GetDirectoryName(_jsonStorePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(systems,
                new JsonSerializerOptions { WriteIndented = true });

            System.IO.File.WriteAllText(
                _jsonStorePath, json, Encoding.UTF8);
        }
    }

    private string GetCurrentUsername()
    {
        return User?.Identity?.Name
               ?? User?.FindFirst("username")?.Value
               ?? "מערכת";
    }

    private bool IsCurrentUserAdmin()
    {
        if (User?.IsInRole("Admin") == true) return true;
        if (User?.IsInRole("admin") == true) return true;

        var roleClaim = User?.FindFirst("role")?.Value
                    ?? User?.FindFirst(
                            System.Security.Claims.ClaimTypes.Role
                        )?.Value ?? "";

        if (roleClaim.Equals("admin",
                StringComparison.OrdinalIgnoreCase)) return true;

        // *** קרא רשימת אדמינים מ-appsettings ***
        // *** שים לב: AdminUsers הוא שדה נפרד מ-PrivilegedUsers ***
        var adminUsers = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            "talyoh",
            "admin",
            "administrator"
        };

        return adminUsers.Contains(GetCurrentUsername());
    }

    // ─── בדוק אם המשתמש הנוכחי הוא עורך אוטומציה בלבד ───
    private bool IsAutomationOnlyEditor()
    {
        var editors = _config
            .GetSection("Authorization:AutomationPrivilegedUsers")
            .Get<List<string>>();

        var automationEditors = new HashSet<string>(
            editors,
            StringComparer.OrdinalIgnoreCase);

        return automationEditors.Contains(GetCurrentUsername());
    }
}


// ─── מודלים ──────────────────────────────────────────────────
public class SystemRecord
{
    public string  Id                      { get; set; } = "";
    public string  Number                  { get; set; } = "";
    public string  Name                    { get; set; } = "";
    public string  NameEn                  { get; set; } = "";
    public string  Description             { get; set; } = "";
    public string  Status                  { get; set; } = "";
    public string  SystemManager           { get; set; } = "";
    public string  Domain                  { get; set; } = "";
    public string  Department              { get; set; } = "";
    public string  Team                    { get; set; } = "";
    public string  BusinessDivision        { get; set; } = "";
    public string  AppClassification       { get; set; } = "";
    public string  AppType                 { get; set; } = "";
    public string  BusinessCriticality     { get; set; } = "";
    public string  AvailabilityRequirement { get; set; } = "";
    public string  Environment             { get; set; } = "";
    public string  Publisher               { get; set; } = "";
    public string  SupportVendor           { get; set; } = "";
    public string  CreatedAt               { get; set; } = "";
    public string  ImportedAt              { get; set; } = "";
    public string? LastUpdated             { get; set; }
    public string? UpdatedBy               { get; set; }
    public string  HasAutomation           { get; set; } = "לא קיימות";
    public string  AutomationNote          { get; set; } = "";
    public string  DepartmentManager       { get; set; } = "";
    public bool RequiresValidation { get; set; } = false;
    public string LastValidatedAt    { get; set; } = ""; 
}

public class UpdateSystemRequest
{
    public string  SystemId                { get; set; } = "";
    public string? Number                  { get; set; }
    public string? Name                    { get; set; }
    public string? NameEn                  { get; set; }
    public string? Description             { get; set; }
    public string? Status                  { get; set; }
    public string? SystemManager           { get; set; }
    public string? Domain                  { get; set; }
    public string? Department              { get; set; }
    public string? Team                    { get; set; }
    public string? BusinessDivision        { get; set; }
    public string? AppClassification       { get; set; }
    public string? AppType                 { get; set; }
    public string? BusinessCriticality     { get; set; }
    public string? AvailabilityRequirement { get; set; }
    public string? Environment             { get; set; }
    public string? Publisher               { get; set; }
    public string? SupportVendor           { get; set; }
    public string? CreatedAt               { get; set; }
    public string? HasAutomation           { get; set; }
    public string? AutomationNote          { get; set; }
    public string? DepartmentManager       { get; set; }
    public bool? RequiresValidation { get; set; }
    public string? ManagerEmail { get; set; }
}

public class ImportSystemsRequest
{
    public List<SystemRecord> Systems  { get; set; } = new();
    public bool               Overwrite { get; set; } = true;
}

public class DeleteSystemRequest
{
    public string SystemId { get; set; } = "";
}

public class SaveSystemsRequest
{
    public List<SystemRecord> Systems { get; set; } = new();
}

public class AddSystemRequest
{
    public string? Number                  { get; set; }
    public string? Name                    { get; set; }
    public string? NameEn                  { get; set; }
    public string? Description             { get; set; }
    public string? Status                  { get; set; }
    public string? SystemManager           { get; set; }
    public string? Domain                  { get; set; }
    public string? Department              { get; set; }
    public string? Team                    { get; set; }
    public string? BusinessDivision        { get; set; }
    public string? AppClassification       { get; set; }
    public string? AppType                 { get; set; }
    public string? BusinessCriticality     { get; set; }
    public string? AvailabilityRequirement { get; set; }
    public string? Environment             { get; set; }
    public string? Publisher               { get; set; }
    public string? SupportVendor           { get; set; }
    public string? CreatedAt               { get; set; }
    public string? HasAutomation           { get; set; }
    public string? AutomationNote          { get; set; }
    public string? DepartmentManager       { get; set; }
    public bool? RequiresValidation { get; set; }
}

public class ImportAutomationRequest
{
    public List<AutomationImportItem> Items { get; set; } = new();
}

public class AutomationImportItem
{
    public string  CatalogNumber    { get; set; } = "";
    public string? AutomationStatus { get; set; }
    public string? AutomationNote   { get; set; }
}

public class MultiSystemUpdates
{
    public string? Status                  { get; set; }
    public string? Environment             { get; set; }
    public string? HasAutomation           { get; set; }
    public string? SystemManager           { get; set; }
    public string? DepartmentManager       { get; set; }
    public string? Domain                  { get; set; }
    public string? Department              { get; set; }
    public string? Team                    { get; set; }
    public string? BusinessDivision        { get; set; }
    public string? AppClassification       { get; set; }
    public string? AppType                 { get; set; }
    public string? BusinessCriticality     { get; set; }
    public string? AvailabilityRequirement { get; set; }
    public bool? RequiresValidation { get; set; }
}

public class UpdateMultipleSystemsRequest
{
    public List<string>       SystemIds { get; set; } = new();
    public MultiSystemUpdates Updates   { get; set; } = new();
}

public class SendValidationEmailRequest
{
    public string SystemId     { get; set; } = "";
    public string ManagerEmail { get; set; } = "";
}

public class BulkValidationRequest
{
    public List<string>              SystemIds       { get; set; } = new();
    public Dictionary<string,string> ManagerEmailMap { get; set; } = new();
}

// ─── הוסף מחלקת טוקן ───
public class ValidationTokenService
{
    // מפתח סודי - שמור ב-appsettings.json
    private readonly string _secretKey;

    public ValidationTokenService(string secretKey)
    {
        _secretKey = secretKey;
    }

    // ─── צור טוקן ───
    public string GenerateToken(string systemId, int validDays = 7)
    {
        var expiry = DateTime.UtcNow.AddDays(validDays)
                              .ToString("yyyyMMddHHmm");
        var payload = $"{systemId}|{expiry}";
        var signature = ComputeHmac(payload);
        var raw = $"{payload}|{signature}";
        return Convert.ToBase64String(
            Encoding.UTF8.GetBytes(raw))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    // ─── אמת טוקן ───
    public (bool valid, string systemId, string error) ValidateToken(string token)
    {
        try
        {
            // ─── שחזר Base64 ───
            var padded = token.Replace('-', '+').Replace('_', '/');
            switch (padded.Length % 4)
            {
                case 2: padded += "=="; break;
                case 3: padded += "=";  break;
            }

            var raw     = Encoding.UTF8.GetString(Convert.FromBase64String(padded));
            var parts   = raw.Split('|');

            if (parts.Length != 3)
                return (false, "", "קישור לא תקין");

            var systemId  = parts[0];
            var expiryStr = parts[1];
            var signature = parts[2];

            // ─── בדוק חתימה ───
            var expectedSig = ComputeHmac($"{systemId}|{expiryStr}");
            if (signature != expectedSig)
                return (false, "", "קישור לא תקין");

            // ─── בדוק תפוגה ───
            if (!DateTime.TryParseExact(
                    expiryStr, "yyyyMMddHHmm",
                    null,
                    System.Globalization.DateTimeStyles.None,
                    out var expiry))
                return (false, "", "קישור לא תקין");

            if (DateTime.UtcNow > expiry)
            {
                var expired = expiry.ToLocalTime().ToString("dd/MM/yyyy HH:mm");
                return (false, "", $"פג תוקף הקישור ב-{expired}");
            }

            return (true, systemId, "");
        }
        catch
        {
            return (false, "", "קישור לא תקין");
        }
    }

    private string ComputeHmac(string data)
    {
        using var hmac = new HMACSHA256(
            Encoding.UTF8.GetBytes(_secretKey));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(data));
        return Convert.ToBase64String(hash)
                      .Replace('+', '-')
                      .Replace('/', '_')
                      .TrimEnd('=');
    }
}