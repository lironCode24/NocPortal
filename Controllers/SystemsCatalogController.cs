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


[Authorize]
public class SystemsCatalogController : Controller
{
    private readonly UserService _userService;
    private readonly EmailService _emailService;
    private readonly IConfiguration _config;
    private readonly ValidationTokenService _tokenService; // ← חדש

    private readonly string _jsonStorePath =
        PortalPaths.UnderFiles(@"systems_catalog.json");

    private readonly string _columnDefsPath =
        PortalPaths.UnderFiles(@"catalog_column_definitions.json");

    // ─── הוסף בתחילת הקובץ ───
    private readonly string _permissionsPath =
        PortalPaths.UnderFiles(@"catalog_permissions.json");

    private static readonly object _permLock = new object();

    private static readonly object _fileLock = new object();

    public SystemsCatalogController(
        IConfiguration config,
        EmailService emailService,
        UserService userService)
    {
        _config       = config;
        _emailService = emailService;
        _userService  = userService;

        // ─── אתחל שירות טוקנים ───
        var secretKey = config["ValidationToken:SecretKey"]
                     ?? "DefaultSecretKey_ChangeThis_InProduction_2024!";
        _tokenService = new ValidationTokenService(secretKey);
    }

    // ─── GET: דף ראשי של הקטלוג (ללא הרשאות) ────────────────────
    [HttpGet]
    [AllowAnonymous] 
    public IActionResult Index()
    {
        return View();
    }

    // ─── GET: קבל הגדרות עמודות גלובליות ────────────────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetColumnDefinitions()
    {
        try
        {
            if (!System.IO.File.Exists(_columnDefsPath))
            {
                // ─── החזר ברירת מחדל אם הקובץ לא קיים ───
                return Json(new { success = true, definitions = GetDefaultColumnDefs() });
            }

            var json = System.IO.File.ReadAllText(_columnDefsPath, Encoding.UTF8);
            var defs = JsonSerializer.Deserialize<ColumnDefinitionsFile>(
                json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
            return Json(new { success = true, definitions = defs });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: שמור הגדרות עמודות גלובליות (אדמין בלבד) ─────────
    [HttpPost]
    [Authorize]
    public IActionResult SaveColumnDefinitions(
        [FromBody] ColumnDefinitionsFile request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            if (request?.Columns == null || request.Columns.Count == 0)
                return Json(new { success = false, error = "אין נתונים לשמירה" });

            // ─── מספר קטלוג תמיד ראשון ───
            var numberCol = request.Columns.FirstOrDefault(c => c.Key == "number");
            if (numberCol != null)
            {
                numberCol.AlwaysVisible  = true;
                numberCol.DefaultVisible = true;
                numberCol.CanReorder     = false;

                request.Columns.Remove(numberCol);
                request.Columns.Insert(0, numberCol); // ← נשאר נכון
            }

            // ─── כפתורי פעולה תמיד אחרונים ───
            var buttonsCol = request.Columns.FirstOrDefault(c => c.Key == "buttons");
            if (buttonsCol != null)
            {
                buttonsCol.AlwaysVisible  = true;
                buttonsCol.DefaultVisible = true;

                request.Columns.Remove(buttonsCol);
                request.Columns.Add(buttonsCol); // ← תיקון: Add במקום Insert(0,...)
            }

            // ─── עדכון SortOrder ───
            for (int i = 0; i < request.Columns.Count; i++)
            {
                request.Columns[i].SortOrder = i;
            }

            request.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            request.UpdatedBy   = GetCurrentUsername();

            var dir = Path.GetDirectoryName(_columnDefsPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(request,
                new JsonSerializerOptions { WriteIndented = true });

            System.IO.File.WriteAllText(_columnDefsPath, json, Encoding.UTF8);

            return Json(new
            {
                success   = true,
                message   = $"הגדרות {request.Columns.Count} עמודות נשמרו בהצלחה",
                updatedAt = request.LastUpdated
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── עזר: ברירת מחדל אם הקובץ לא קיים ──────────────────────
    private ColumnDefinitionsFile GetDefaultColumnDefs()
    {
        return new ColumnDefinitionsFile
        {
            Version     = "1.0",
            LastUpdated = DateTime.Now.ToString("yyyy-MM-dd"),
            UpdatedBy   = "system",
            Columns     = new List<ColumnDefinition>
            {
                new() { Key="number",      Label="מספר",   DefaultVisible=true,  AlwaysVisible=true,  
                        CanReorder=false,  Category="בסיסי",    SortOrder=0,  
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="name",        Label="שם",     DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="בסיסי",    SortOrder=1,  
                        ShowInValidation=true,  RequiredInValidation=true  },

                new() { Key="nameEn",      Label="שם מערכת - אנגלית", DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="בסיסי",    SortOrder=2,  
                        ShowInValidation=true,  RequiredInValidation=true  },

                new() { Key="description", Label="תיאור",  DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="בסיסי",    SortOrder=3,  
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="status",      Label="סטטוס",  DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="בסיסי",    SortOrder=4,  
                        ShowInValidation=true,  RequiredInValidation=true  },

                new() { Key="systemManager", Label="מנהל מערכת", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="ארגוני",   SortOrder=5,  
                        ShowInValidation=true,  RequiredInValidation=true  },

                new() { Key="departmentManager", Label="מנהל מחלקה", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="ארגוני",   SortOrder=6,  
                        ShowInValidation=false, RequiredInValidation=false },

                new() { Key="domain",      Label="תחום",   DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="ארגוני",   SortOrder=7,  
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="department",  Label="מחלקה",  DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="ארגוני",   SortOrder=8,  
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="team",        Label="צוות",   DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="ארגוני",   SortOrder=9,  
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="businessDivision", Label="אגף עסקי - ראשי", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="ארגוני",   SortOrder=10, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="appClassification", Label="סיווג יישום", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="טכני",     SortOrder=11, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="appType",     Label="סוג יישום", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="טכני",     SortOrder=12, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="businessCriticality", Label="קריטיות עסקית", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="עסקי",     SortOrder=13, 
                        ShowInValidation=true,  RequiredInValidation=true  },

                new() { Key="availabilityRequirement", Label="דרישת זמינות", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="עסקי",     SortOrder=14, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="environment", Label="סביבה",  DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="טכני",     SortOrder=15, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="publisher",   Label="מפרסם",  DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="ספקים",    SortOrder=16, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="supportVendor", Label="ספק תמיכה", DefaultVisible=true, AlwaysVisible=false, 
                        CanReorder=true,   Category="ספקים",    SortOrder=17, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="createdAt",   Label="נוצר",   DefaultVisible=true,  AlwaysVisible=false, 
                        CanReorder=true,   Category="תאריכים",  SortOrder=18, 
                        ShowInValidation=false, RequiredInValidation=false },

                new() { Key="hasAutomation", Label="בדיקות אוטומטיות", DefaultVisible=false, AlwaysVisible=false, 
                        CanReorder=true,   Category="אוטומציה", SortOrder=19, 
                        ShowInValidation=true,  RequiredInValidation=false },

                new() { Key="lastValidatedAt", Label="בוצע תיקוף", DefaultVisible=false, AlwaysVisible=false, 
                        CanReorder=true,   Category="תיקוף",    SortOrder=20, 
                        ShowInValidation=false, RequiredInValidation=false },

                new() { Key="requiresValidation", Label="נדרש תיקוף", DefaultVisible=false, AlwaysVisible=false, 
                        CanReorder=true,   Category="תיקוף",    SortOrder=21, 
                        ShowInValidation=false, RequiredInValidation=false },

                new() { Key="lastValidationEmailSentAt", Label="נשלח תיקוף", DefaultVisible=false, AlwaysVisible=false, 
                        CanReorder=true,   Category="תיקוף",    SortOrder=22, 
                        ShowInValidation=false, RequiredInValidation=false },

                new() { Key="buttons",     Label="",       DefaultVisible=true,  AlwaysVisible=true,  
                        CanReorder=false,  Category="מערכת",    SortOrder=99, 
                        ShowInValidation=false, RequiredInValidation=false },
            }
        };
    }

    // ─── POST: אשר מערכות מרובות ציבורי (דף תיקוף מנהל) ────────────
    [HttpPost]
    [AllowAnonymous]
    public async Task<IActionResult> BulkValidatePublic(
        [FromBody] BulkValidatePublicRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request?.ManagerToken))
                return Json(new { success = false, error = "טוקן נדרש" });

            if (request.SystemIds == null || request.SystemIds.Count == 0)
                return Json(new { success = false, error = "לא נשלחו מערכות" });

            // ─── אמת טוקן מנהל ───
            var (valid, managerId, tokenError) =
                _tokenService.ValidateToken(request.ManagerToken);

            if (!valid)
                return Json(new { success = false, error = tokenError });

            if (!managerId.StartsWith("manager_"))
                return Json(new { success = false, error = "טוקן לא תקין" });

            var managerName = Uri.UnescapeDataString(
                managerId.Substring("manager_".Length));

            var systems = LoadFromJson();
            var now     = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var validatedDate = DateTime.Now.ToString("dd/MM/yyyy HH:mm");

            var validatedNames = new List<string>();
            int validatedCount = 0;

            foreach (var systemId in request.SystemIds)
            {
                var system = systems.FirstOrDefault(s => s.Id == systemId);
                if (system == null) continue;

                // ─── וודא שהמערכת שייכת למנהל ───
                if (!string.Equals(
                        system.SystemManager?.Trim(),
                        managerName.Trim(),
                        StringComparison.OrdinalIgnoreCase))
                    continue;

                system.RequiresValidation = false;
                system.LastValidatedAt    = validatedDate;
                system.LastUpdated        = now;
                system.UpdatedBy          = managerName;
                validatedNames.Add(system.Name ?? "");
                validatedCount++;
            }

            SaveToJson(systems);

            // ─── שלח מייל אישור אם יש מייל ───
            if (!string.IsNullOrWhiteSpace(request.ManagerEmail) && validatedCount > 0)
            {
                try
                {
                    var baseUrl   = $"{Request.Scheme}://{Request.Host}";
                    var systemUrl = $"{baseUrl}/dashboards?dashboard=systems-catalog";

                    await _emailService.SendBulkValidationCompletedEmailAsync(
                        managerEmail:  request.ManagerEmail,
                        managerName:   managerName,
                        systemNames:   validatedNames,
                        catalogUrl:    systemUrl
                    );
                }
                catch (Exception emailEx)
                {
                    // ─── אל תכשל בגלל שגיאת מייל ───
                    Console.WriteLine($"Email error: {emailEx.Message}");
                }
            }

            return Json(new
            {
                success        = true,
                validatedCount,
                validatedNames,
                message        = $"אושרו {validatedCount} מערכות בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מערכות (ציבורי - ללא אימות) ────────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetSystemsPublic()
    {
        try
        {
            // ─── אפשר גישה רק אם מחובר, או דרך ה-endpoint הציבורי ───
            var allSystems = LoadFromJson();
            return Json(new
            {
                success = true,
                systems = allSystems,
                count   = allSystems.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל את כל המערכות ──────────────────────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetSystems()
    {
        try
        {
            if (User?.Identity?.IsAuthenticated != true)
            {
                if (!TryBasicAuth(out var authError))
                {
                    Response.Headers["WWW-Authenticate"] = "Basic realm=\"NOC Portal\"";
                    Response.StatusCode = 401;
                    return Json(new { success = false, error = authError });
                }
            }

            // ─── אימות הצליח ───
            var allSystems = LoadFromJson();
            return Json(new
            {
                success = true,
                systems = allSystems,
                count   = allSystems.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל משתמש נוכחי ────────────────────────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetCurrentUser()
    {
        try
        {
            return Json(new
            {
                success          = true,
                username         = GetCurrentUsername(),
                isAdmin          = IsCurrentUserAdmin(),
                isNoc            = IsCurrentUserNoc(),
                isAutomationOnly = IsAutomationOnlyEditor(),
                canSendValidation = CanSendValidation()
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
    public async Task<IActionResult> UpdateSystem([FromBody] JsonElement body)
    {
        try
        {
            // ─── המר ל-UpdateSystemRequest ───
            var request = JsonSerializer.Deserialize<UpdateSystemRequest>(
                body.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );

            if (request == null)
                return Json(new { success = false, error = "בקשה לא תקינה" });

            
            bool isAdmin = IsCurrentUserAdmin();
            bool isCanSendValidation = CanSendValidation();
            bool isAutomationOnly = IsAutomationOnlyEditor();

            if (!isAdmin && !isCanSendValidation && !isAutomationOnly)
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
            if (isAutomationOnly && !isCanSendValidation && !isAdmin)
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


            // ─── עדכן שדות דינמיים ───
                var builtInFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                {
                    "systemId", "number", "name", "nameEn", "description", "status",
                    "systemManager", "departmentManager", "environment", "domain",
                    "department", "team", "businessDivision", "appClassification",
                    "appType", "businessCriticality", "availabilityRequirement",
                    "publisher", "supportVendor", "createdAt", "hasAutomation",
                    "automationNote", "requiresValidation", "managerEmail",
                    "validationToken", "lastUpdated", "updatedBy",
                    "lastValidatedAt", "lastValidationEmailSentAt",
                    "validationReminderCount", "importedAt", "id"
                };

                // ─── אתחל DynamicFields אם null ───
                system.DynamicFields ??= new Dictionary<string, string>();

                foreach (var prop in body.EnumerateObject())
                {
                    if (builtInFields.Contains(prop.Name)) continue;

                    string? val = null;
                    if (prop.Value.ValueKind == JsonValueKind.String)
                        val = prop.Value.GetString();
                    else if (prop.Value.ValueKind == JsonValueKind.Null)
                        val = "";  // ← שנה null ל-string ריק לאיפוס
                    else
                        val = prop.Value.ToString();

                    // הסר את בדיקת if (val == null) continue;
                    // כי ייתכן שרוצים לאפס שדה
                    
                    var property = typeof(SystemRecord).GetProperty(
                        prop.Name,
                        System.Reflection.BindingFlags.IgnoreCase |
                        System.Reflection.BindingFlags.Public |
                        System.Reflection.BindingFlags.Instance
                    );

                    if (property != null && property.CanWrite &&
                        property.PropertyType == typeof(string))
                    {
                        property.SetValue(system, val ?? "");
                    }
                    else if (val != null)
                    {
                        system.DynamicFields ??= new Dictionary<string, string>();
                        system.DynamicFields[prop.Name] = val;
                    }
                }
            }

            system.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.UpdatedBy   = GetCurrentUsername();

            if (request.HasAutomation  != null) system.HasAutomation  = request.HasAutomation;
            if (request.AutomationNote != null) system.AutomationNote = request.AutomationNote;

            SaveToJson(systems);

            return Json(new { success = true, system,
                message = $"מערכת {system.Name} עודכנה בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: הוסף מערכת חדשה ───────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult AddSystem([FromBody] JsonElement body)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה לביצוע פעולה זו" });

            // ─── המר ל-AddSystemRequest ───
            var request = JsonSerializer.Deserialize<AddSystemRequest>(
                body.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );

            // ─── ולידציות קיימות (ללא שינוי) ───
            if (string.IsNullOrWhiteSpace(request?.Name))
                return Json(new { success = false, error = "שם מערכת הוא שדה חובה" });

            if (string.IsNullOrWhiteSpace(request.Number))
                return Json(new { success = false, error = "מספר קטלוגי הוא שדה חובה", missingField = "number" });

            if (string.IsNullOrWhiteSpace(request.NameEn))
                return Json(new { success = false, error = "שם אנגלי הוא שדה חובה", missingField = "nameEn" });

            if (string.IsNullOrWhiteSpace(request.SystemManager))
                return Json(new { success = false, error = "מנהל מערכת הוא שדה חובה", missingField = "systemManager" });

            var systems = LoadFromJson();

            // ─── בדיקות כפילות (ללא שינוי) ───
            if (!string.IsNullOrWhiteSpace(request.Number))
            {
                var duplicateNumber = systems.FirstOrDefault(s =>
                    string.Equals((s.Number ?? "").Trim(), request.Number.Trim(),
                        StringComparison.OrdinalIgnoreCase));
                if (duplicateNumber != null)
                    return Json(new
                    {
                        success = false,
                        error = $"מספר קטלוג \"{request.Number}\" כבר קיים במערכת \"{duplicateNumber.Name}\"",
                        duplicateField = "number",
                        duplicateSystem = new { duplicateNumber.Id, duplicateNumber.Name, duplicateNumber.Number }
                    });
            }

            var duplicateName = systems.FirstOrDefault(s =>
                string.Equals((s.Name ?? "").Trim(), request.Name.Trim(),
                    StringComparison.OrdinalIgnoreCase));
            if (duplicateName != null)
                return Json(new
                {
                    success = false,
                    error = $"מערכת בשם \"{request.Name}\" כבר קיימת (מספר: {duplicateName.Number})",
                    duplicateField = "name",
                    duplicateSystem = new { duplicateName.Id, duplicateName.Name, duplicateName.Number }
                });

            if (!string.IsNullOrWhiteSpace(request.NameEn))
            {
                var duplicateNameEn = systems.FirstOrDefault(s =>
                    !string.IsNullOrWhiteSpace(s.NameEn) &&
                    string.Equals((s.NameEn ?? "").Trim(), request.NameEn.Trim(),
                        StringComparison.OrdinalIgnoreCase));
                if (duplicateNameEn != null)
                    return Json(new
                    {
                        success = false,
                        error = $"שם אנגלי \"{request.NameEn}\" כבר קיים במערכת \"{duplicateNameEn.Name}\"",
                        duplicateField = "nameEn",
                        duplicateSystem = new { duplicateNameEn.Id, duplicateNameEn.Name, duplicateNameEn.Number, duplicateNameEn.NameEn }
                    });
            }

            var now  = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user = GetCurrentUsername();

            var newSystem = new SystemRecord
            {
                Id          = $"sys_{Guid.NewGuid():N}",
                Number      = request.Number ?? "",
                Name        = request.Name ?? "",
                NameEn      = request.NameEn ?? "",
                Description = request.Description ?? "",
                Status      = request.Status ?? "",
                SystemManager           = request.SystemManager ?? "",
                DepartmentManager       = request.DepartmentManager ?? "",
                Domain                  = request.Domain ?? "",
                Department              = request.Department ?? "",
                Team                    = request.Team ?? "",
                BusinessDivision        = request.BusinessDivision ?? "",
                AppClassification       = request.AppClassification ?? "",
                AppType                 = request.AppType ?? "",
                BusinessCriticality     = request.BusinessCriticality ?? "",
                AvailabilityRequirement = request.AvailabilityRequirement ?? "",
                Environment             = request.Environment ?? "",
                Publisher               = request.Publisher ?? "",
                SupportVendor           = request.SupportVendor ?? "",
                CreatedAt               = !string.IsNullOrEmpty(request.CreatedAt)
                                            ? request.CreatedAt
                                            : DateTime.Now.ToString("dd/MM/yyyy"),
                LastUpdated             = now,
                UpdatedBy               = user,
                HasAutomation           = request.HasAutomation ?? "לא קיימות",
                AutomationNote          = request.AutomationNote ?? "",
                ImportedAt              = "",
                RequiresValidation      = request.RequiresValidation ?? false,
            };

            // ─── טפל בשדות דינמיים ───────────────────────────────────────
            var builtInFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "number", "name", "nameEn", "description", "status",
                "systemManager", "departmentManager", "environment",
                "domain", "department", "team", "businessDivision",
                "appClassification", "appType", "businessCriticality",
                "availabilityRequirement", "publisher", "supportVendor",
                "createdAt", "hasAutomation", "automationNote",
                "requiresValidation", "lastUpdated", "updatedBy",
                "lastValidatedAt", "lastValidationEmailSentAt",
                "validationReminderCount", "importedAt", "id"
            };

            newSystem.DynamicFields ??= new Dictionary<string, string>();

            foreach (var prop in body.EnumerateObject())
            {
                if (!builtInFields.Contains(prop.Name) &&
                    prop.Value.ValueKind == JsonValueKind.String)
                {
                    var val = prop.Value.GetString();
                    if (val != null)
                    {
                        // ─── נסה לשמור ישירות על האובייקט דרך Reflection ───
                        var property = typeof(SystemRecord).GetProperty(
                            prop.Name,
                            System.Reflection.BindingFlags.IgnoreCase |
                            System.Reflection.BindingFlags.Public |
                            System.Reflection.BindingFlags.Instance
                        );

                        if (property != null && property.CanWrite &&
                            property.PropertyType == typeof(string))
                        {
                            property.SetValue(newSystem, val);
                        }
                        else
                        {
                            // ─── שמור ב-DynamicFields ───
                            newSystem.DynamicFields[prop.Name] = val;
                        }
                    }
                }
            }

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

            // בנה מפה לפי מספר קטלוג (עדיפות ראשונה)
            var existingByNumber = new Dictionary<string, SystemRecord>(
                StringComparer.OrdinalIgnoreCase);
            var existingByName = new Dictionary<string, SystemRecord>(
                StringComparer.OrdinalIgnoreCase);

            foreach (var s in existing)
            {
                // מפה לפי מספר קטלוג
                if (!string.IsNullOrWhiteSpace(s.Number))
                {
                    var numKey = s.Number.Trim();
                    if (!existingByNumber.ContainsKey(numKey))
                        existingByNumber[numKey] = s;
                }

                // מפה לפי שם (fallback)
                var nameKey = (s.Name ?? "").Trim().ToLowerInvariant();
                if (!string.IsNullOrWhiteSpace(nameKey))
                {
                    if (!existingByName.ContainsKey(nameKey))
                        existingByName[nameKey] = s;
                }
            }

            int addedCount   = 0;
            int updatedCount = 0;
            var now          = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user         = GetCurrentUsername();

            foreach (var imported in request.Systems)
            {
                if (string.IsNullOrWhiteSpace(imported.Name))
                    continue;

                // ─── קוד חדש: חפש לפי מספר קטלוג תחילה, אחר כך לפי שם ───
                SystemRecord? existingSystem = null;

                // עדיפות 1: חיפוש לפי מספר קטלוג
                if (!string.IsNullOrWhiteSpace(imported.Number))
                {
                    existingByNumber.TryGetValue(
                        imported.Number.Trim(), out existingSystem);
                }

                // עדיפות 2: fallback לפי שם
                if (existingSystem == null)
                {
                    var nameKey = (imported.Name ?? "").Trim().ToLowerInvariant();
                    existingByName.TryGetValue(nameKey, out existingSystem);
                }

                if (existingSystem != null)
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

                        // ─── הוסף: שדות נוספים ───
                        if (!string.IsNullOrEmpty(imported.IsMonitored))
                            existingSystem.IsMonitored = imported.IsMonitored;
                        if (!string.IsNullOrEmpty(imported.IsCritical))
                            existingSystem.IsCritical = imported.IsCritical;
                        if (!string.IsNullOrEmpty(imported.WorkNotes))
                            existingSystem.WorkNotes = imported.WorkNotes;
                        if (!string.IsNullOrEmpty(imported.SkipSync))
                            existingSystem.SkipSync = imported.SkipSync;
                        if (!string.IsNullOrEmpty(imported.BaNumber))
                            existingSystem.BaNumber = imported.BaNumber;
                        if (!string.IsNullOrEmpty(imported.ServiceOffering))
                            existingSystem.ServiceOffering = imported.ServiceOffering;
                        if (!string.IsNullOrEmpty(imported.ShadowIT))
                            existingSystem.ShadowIT = imported.ShadowIT;
                        if (!string.IsNullOrEmpty(imported.Tags))
                            existingSystem.Tags = imported.Tags;
                        if (!string.IsNullOrEmpty(imported.Owner))
                            existingSystem.Owner = imported.Owner;
                        if (!string.IsNullOrEmpty(imported.CanPrint))
                            existingSystem.CanPrint = imported.CanPrint;
                        if (!string.IsNullOrEmpty(imported.Rto))
                            existingSystem.Rto = imported.Rto;
                        if (!string.IsNullOrEmpty(imported.Rpo))
                            existingSystem.Rpo = imported.Rpo;
                        if (!string.IsNullOrEmpty(imported.UserCount))
                            existingSystem.UserCount = imported.UserCount;
                        if (!string.IsNullOrEmpty(imported.AppUrl))
                            existingSystem.AppUrl = imported.AppUrl;
                        if (!string.IsNullOrEmpty(imported.JiraId))
                            existingSystem.JiraId = imported.JiraId;
                        if (!string.IsNullOrEmpty(imported.RequiresAuth))
                            existingSystem.RequiresAuth = imported.RequiresAuth;
                        if (!string.IsNullOrEmpty(imported.As400Partition))
                            existingSystem.As400Partition = imported.As400Partition;
                        if (!string.IsNullOrEmpty(imported.SystemRequestNumber))
                            existingSystem.SystemRequestNumber = imported.SystemRequestNumber;
                        if (!string.IsNullOrEmpty(imported.ClusterNumber))
                            existingSystem.ClusterNumber = imported.ClusterNumber;
                        if (!string.IsNullOrEmpty(imported.AlternativeSite))
                            existingSystem.AlternativeSite = imported.AlternativeSite;
                        if (!string.IsNullOrEmpty(imported.CoreSystem))
                            existingSystem.CoreSystem = imported.CoreSystem;
                        if (!string.IsNullOrEmpty(imported.PermissionManagement))
                            existingSystem.PermissionManagement = imported.PermissionManagement;
                        if (!string.IsNullOrEmpty(imported.DomainPath))
                            existingSystem.DomainPath = imported.DomainPath;
                        if (!string.IsNullOrEmpty(imported.SystemDeptPath))
                            existingSystem.SystemDeptPath = imported.SystemDeptPath;
                        if (!string.IsNullOrEmpty(imported.InstallationType))
                            existingSystem.InstallationType = imported.InstallationType;
                        if (!string.IsNullOrEmpty(imported.ClientType))
                            existingSystem.ClientType = imported.ClientType;
                        if (!string.IsNullOrEmpty(imported.MainDbType))
                            existingSystem.MainDbType = imported.MainDbType;
                        if (!string.IsNullOrEmpty(imported.AuthStatus))
                            existingSystem.AuthStatus = imported.AuthStatus;
                        if (!string.IsNullOrEmpty(imported.OperationalStatus))
                            existingSystem.OperationalStatus = imported.OperationalStatus;
                        if (!string.IsNullOrEmpty(imported.FailureCount))
                            existingSystem.FailureCount = imported.FailureCount;
                        if (!string.IsNullOrEmpty(imported.Updates))
                            existingSystem.Updates = imported.Updates;
                        if (!string.IsNullOrEmpty(imported.Group))
                            existingSystem.Group = imported.Group;
                        if (!string.IsNullOrEmpty(imported.BudgetCategory))
                            existingSystem.BudgetCategory = imported.BudgetCategory;
                        if (!string.IsNullOrEmpty(imported.RiskLevel))
                            existingSystem.RiskLevel = imported.RiskLevel;
                        if (!string.IsNullOrEmpty(imported.MainSystemAssociation))
                            existingSystem.MainSystemAssociation = imported.MainSystemAssociation;
                        if (!string.IsNullOrEmpty(imported.MainSchemaName))
                            existingSystem.MainSchemaName = imported.MainSchemaName;
                        if (!string.IsNullOrEmpty(imported.ItDomain))
                            existingSystem.ItDomain = imported.ItDomain;
                        if (!string.IsNullOrEmpty(imported.BusinessSurvey))
                            existingSystem.BusinessSurvey = imported.BusinessSurvey;
                        if (!string.IsNullOrEmpty(imported.TechSurvey))
                            existingSystem.TechSurvey = imported.TechSurvey;
                        if (!string.IsNullOrEmpty(imported.Approved))
                            existingSystem.Approved = imported.Approved;
                        if (!string.IsNullOrEmpty(imported.Active))
                            existingSystem.Active = imported.Active;
                        if (!string.IsNullOrEmpty(imported.Monitor))
                            existingSystem.Monitor = imported.Monitor;
                        if (!string.IsNullOrEmpty(imported.LastTechSurveyScore))
                            existingSystem.LastTechSurveyScore = imported.LastTechSurveyScore;
                        if (!string.IsNullOrEmpty(imported.LastBusinessSurveyScore))
                            existingSystem.LastBusinessSurveyScore = imported.LastBusinessSurveyScore;

                        // ─── שדות דינמיים ───
                        if (imported.DynamicFields != null && imported.DynamicFields.Count > 0)
                        {
                            existingSystem.DynamicFields ??= new Dictionary<string, string>();
                            foreach (var kv in imported.DynamicFields)
                            {
                                // ─── עדכן DynamicFields ───
                                existingSystem.DynamicFields[kv.Key] = kv.Value;
                                
                                // ─── נסה לעדכן ישירות על האובייקט דרך Reflection ───
                                var property = typeof(SystemRecord).GetProperty(
                                    kv.Key,
                                    System.Reflection.BindingFlags.IgnoreCase |
                                    System.Reflection.BindingFlags.Public |
                                    System.Reflection.BindingFlags.Instance
                                );
                                if (property != null && property.CanWrite && 
                                    property.PropertyType == typeof(string))
                                {
                                    property.SetValue(existingSystem, kv.Value);
                                }
                            }
                        }

                        existingSystem.LastUpdated = now;
                        existingSystem.UpdatedBy   = user;
                        updatedCount++;
                    }
                }
                else
                {
                    if (string.IsNullOrWhiteSpace(imported.Number))
                    {
                        imported.Number = GenerateNextCatalogNumber(existing);
                    }
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
                        ImportedAt              = now,
                        
                        // ─── הוסף: שדות נוספים ───
                        IsMonitored             = imported.IsMonitored             ?? "",
                        IsCritical              = imported.IsCritical              ?? "",
                        WorkNotes               = imported.WorkNotes               ?? "",
                        SkipSync                = imported.SkipSync                ?? "",
                        BaNumber                = imported.BaNumber                ?? "",
                        ServiceOffering         = imported.ServiceOffering         ?? "",
                        ShadowIT                = imported.ShadowIT                ?? "",
                        Tags                    = imported.Tags                    ?? "",
                        Owner                   = imported.Owner                   ?? "",
                        CanPrint                = imported.CanPrint                ?? "",
                        Rto                     = imported.Rto                     ?? "",
                        Rpo                     = imported.Rpo                     ?? "",
                        UserCount               = imported.UserCount               ?? "",
                        AppUrl                  = imported.AppUrl                  ?? "",
                        JiraId                  = imported.JiraId                  ?? "",
                        RequiresAuth            = imported.RequiresAuth            ?? "",
                        As400Partition          = imported.As400Partition          ?? "",
                        SystemRequestNumber     = imported.SystemRequestNumber     ?? "",
                        ClusterNumber           = imported.ClusterNumber           ?? "",
                        AlternativeSite         = imported.AlternativeSite         ?? "",
                        CoreSystem              = imported.CoreSystem              ?? "",
                        PermissionManagement    = imported.PermissionManagement    ?? "",
                        DomainPath              = imported.DomainPath              ?? "",
                        SystemDeptPath          = imported.SystemDeptPath          ?? "",
                        InstallationType        = imported.InstallationType        ?? "",
                        ClientType              = imported.ClientType              ?? "",
                        MainDbType              = imported.MainDbType              ?? "",
                        AuthStatus              = imported.AuthStatus              ?? "",
                        OperationalStatus       = imported.OperationalStatus       ?? "",
                        FailureCount            = imported.FailureCount            ?? "",
                        Updates                 = imported.Updates                 ?? "",
                        Group                   = imported.Group                   ?? "",
                        BudgetCategory          = imported.BudgetCategory          ?? "",
                        RiskLevel               = imported.RiskLevel               ?? "",
                        MainSystemAssociation   = imported.MainSystemAssociation   ?? "",
                        MainSchemaName          = imported.MainSchemaName          ?? "",
                        ItDomain                = imported.ItDomain                ?? "",
                        BusinessSurvey          = imported.BusinessSurvey          ?? "",
                        TechSurvey              = imported.TechSurvey              ?? "",
                        Approved                = imported.Approved                ?? "",
                        Active                  = imported.Active                  ?? "",
                        Monitor                 = imported.Monitor                 ?? "",
                        LastTechSurveyScore     = imported.LastTechSurveyScore     ?? "",
                        LastBusinessSurveyScore = imported.LastBusinessSurveyScore ?? "",
                        DynamicFields           = imported.DynamicFields,
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

    [HttpGet]
    [Authorize]
    public IActionResult GetNextCatalogNumber()
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            var systems = LoadFromJson();
            var next = GenerateNextCatalogNumber(systems);
            
            return Json(new { 
                success = true, 
                number = next 
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // הוסף פונקציה לגנרציית מספר קטלוגי
    private string GenerateNextCatalogNumber(List<SystemRecord> systems)
    {
        var existing = systems
            .Where(s => System.Text.RegularExpressions.Regex
                .IsMatch(s.Number ?? "", @"^APM\d+$"))
            .Select(s => int.TryParse(
                (s.Number ?? "").Replace("APM", ""), out int n) ? n : 0)
            .ToList();

        int next = existing.Count > 0 ? existing.Max() + 1 : 1;
        
        // חפש חור ברצף
        for (int i = 5; i < next; i++)
        {
            string candidate = $"APM{i:D7}";
            if (!systems.Any(s => string.Equals(
                s.Number, candidate, StringComparison.OrdinalIgnoreCase)))
            {
                return candidate;
            }
        }
        
        return $"APM{next:D7}";
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

    // ─── GET: קבל מערכת בודדת לפי ID (ציבורי - ללא אימות) ──────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetSystemByIdPublic(string id)
    {
        try
        {
            if (string.IsNullOrEmpty(id))
                return Json(new { success = false, error = "מזהה נדרש" });

            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == id);

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            return Json(new { success = true, system });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מערכת בודדת לפי ID (ללא הרשאות) ──────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetSystemById(string id)
    {
        try
        {
            // ─── אם המשתמש מחובר - אפשר גישה ישירה ───
            if (User?.Identity?.IsAuthenticated == true)
            {
                if (string.IsNullOrEmpty(id))
                    return Json(new { success = false, error = "מזהה נדרש" });

                var systems = LoadFromJson();
                var system = systems.FirstOrDefault(s => s.Id == id);

                if (system == null)
                    return Json(new { success = false, error = "מערכת לא נמצאה" });

                return Json(new { success = true, system });
            }

            // ─── בדוק Basic Auth Header ───
            if (!TryBasicAuth(out var authError))
            {
                Response.Headers["WWW-Authenticate"] = "Basic realm=\"NOC Portal\"";
                Response.StatusCode = 401;
                return Json(new { success = false, error = authError });
            }

            if (string.IsNullOrEmpty(id))
                return Json(new { success = false, error = "מזהה נדרש" });

            var allSystems = LoadFromJson();
            var foundSystem = allSystems.FirstOrDefault(s => s.Id == id);

            if (foundSystem == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            return Json(new { success = true, system = foundSystem });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מערכת בודדת לפי שם ────────────────────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetSystemByCatalogNum(string number)
    {
        try
        {
            if (User?.Identity?.IsAuthenticated != true)
            {
                if (!TryBasicAuth(out var authError))
                {
                    Response.Headers["WWW-Authenticate"] = "Basic realm=\"NOC Portal\"";
                    Response.StatusCode = 401;
                    return Json(new { success = false, error = authError });
                }
            }

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
    [AllowAnonymous]
    public IActionResult GetSystemByName(string name)
    {
        try
        {
            if (User?.Identity?.IsAuthenticated != true)
            {
                if (!TryBasicAuth(out var authError))
                {
                    Response.Headers["WWW-Authenticate"] = "Basic realm=\"NOC Portal\"";
                    Response.StatusCode = 401;
                    return Json(new { success = false, error = authError });
                }
            }

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

    // ─── עזר: בדוק Basic Auth Header ───
    private bool TryBasicAuth(out string errorMessage)
    {
        errorMessage = "";
        var authHeader = Request.Headers["Authorization"].ToString();

        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Basic "))
        {
            errorMessage = "נדרש אימות";
            return false;
        }

        try
        {
            var encoded  = authHeader.Substring("Basic ".Length).Trim();
            var decoded  = Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
            var parts    = decoded.Split(':', 2);

            if (parts.Length != 2)
            {
                errorMessage = "פורמט אימות שגוי";
                return false;
            }

            if (!_userService.ValidateUser(parts[0], parts[1],
                    out _, out var validationError))
            {
                errorMessage = "יוזר או סיסמה שגויים";
                return false;
            }

            return true;
        }
        catch
        {
            errorMessage = "שגיאה באימות";
            return false;
        }
    }

    // ─── POST: עדכן מערכת ללא הרשאות (דף תיקוף) ────────────────
    [HttpPost]
    [AllowAnonymous]
    public async Task<IActionResult> UpdateSystemPublic([FromBody] JsonElement body)
    {
        try
        {
            // ─── המר ל-UpdateSystemRequest ───
            var request = JsonSerializer.Deserialize<UpdateSystemRequest>(
                body.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );

            if (string.IsNullOrEmpty(request?.SystemId))
                return Json(new { success = false, error = "מזהה מערכת נדרש" });

            if (string.IsNullOrEmpty(request.ValidationToken))
                return Json(new { success = false, error = "טוקן תיקוף נדרש" });

            var (valid, systemId, tokenError) =
                _tokenService.ValidateToken(request.ValidationToken);

            if (!valid)
                return Json(new { success = false, error = tokenError });

            if (systemId != request.SystemId)
                return Json(new { success = false,
                                error = "טוקן לא תואם למערכת" });

            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == request.SystemId);

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            // ─── עדכן שדות קבועים ───
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
            if (request.HasAutomation           != null) system.HasAutomation           = request.HasAutomation;
            if (request.AutomationNote          != null) system.AutomationNote          = request.AutomationNote;
            if (request.DepartmentManager       != null) system.DepartmentManager       = request.DepartmentManager;

            // ─── עדכן שדות דינמיים מה-JsonElement ───
            var builtInFields = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "systemId", "validationToken", "managerEmail",
                "number", "name", "nameEn", "description", "status",
                "systemManager", "departmentManager", "environment",
                "domain", "department", "team", "businessDivision",
                "appClassification", "appType", "businessCriticality",
                "availabilityRequirement", "publisher", "supportVendor",
                "createdAt", "hasAutomation", "automationNote",
                "requiresValidation", "lastUpdated", "updatedBy",
                "lastValidatedAt", "lastValidationEmailSentAt",
                "validationReminderCount", "importedAt", "id"
            };

            system.DynamicFields ??= new Dictionary<string, string>();

            foreach (var prop in body.EnumerateObject())
            {
                if (builtInFields.Contains(prop.Name)) continue;

                // קבל ערך - string ריק הוא תקין!
                string val;

                if (prop.Value.ValueKind == JsonValueKind.String)
                    val = prop.Value.GetString() ?? "";
                else if (prop.Value.ValueKind == JsonValueKind.Null)
                    val = ""; // ← null הופך לריק, לא מדלגים
                else
                    val = prop.Value.ToString();

                // ─── נסה לעדכן ישירות על האובייקט דרך Reflection ───
                var property = typeof(SystemRecord).GetProperty(
                    prop.Name,
                    System.Reflection.BindingFlags.IgnoreCase |
                    System.Reflection.BindingFlags.Public |
                    System.Reflection.BindingFlags.Instance
                );

                if (property != null && property.CanWrite &&
                    property.PropertyType == typeof(string))
                {
                    property.SetValue(system, val);
                }
                else
                {
                    // ← שמור ב-DynamicFields רק אם יש ערך
                    if (!string.IsNullOrEmpty(val))
                    {
                        system.DynamicFields ??= new Dictionary<string, string>();
                        system.DynamicFields[prop.Name] = val;
                    }
                }
            }

            // ─── עדכן מטא-דאטה ───
            system.LastUpdated        = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.UpdatedBy          = "מנהל מערכת";
            system.LastValidatedAt    = DateTime.Now.ToString("dd/MM/yyyy HH:mm");
            system.RequiresValidation = false;

            SaveToJson(systems);

            // ─── שלח מייל אישור ───
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

    // ─── GET: דף תיקוף (View) ────────────────────────────────────
    [HttpGet]
    [AllowAnonymous]
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
    
    // ─── GET: קבל URL תיקוף למערכת (מאומת דרך טוקן מנהל) ───
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetValidationUrl(string systemId, string managerToken)
    {
        try
        {
            if (string.IsNullOrEmpty(systemId) || string.IsNullOrEmpty(managerToken))
                return Json(new { success = false, error = "פרמטרים חסרים" });

            // ─── אמת טוקן מנהל ───
            var (valid, managerId, tokenError) =
                _tokenService.ValidateToken(managerToken);

            if (!valid)
                return Json(new { success = false, error = tokenError });

            if (!managerId.StartsWith("manager_"))
                return Json(new { success = false, error = "טוקן לא תקין" });

            var managerName = Uri.UnescapeDataString(
                managerId.Substring("manager_".Length));

            // ─── וודא שהמערכת שייכת למנהל ───
            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == systemId);

            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            if (!string.Equals(
                    system.SystemManager?.Trim(),
                    managerName.Trim(),
                    StringComparison.OrdinalIgnoreCase))
                return Json(new { success = false, error = "אין הרשאה למערכת זו" });

            // ─── צור טוקן למערכת בודדת ───
            var token       = _tokenService.GenerateToken(system.Id, validDays: 7);
            var baseUrl     = $"{Request.Scheme}://{Request.Host}";
            var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

            return Json(new { success = true, url = validateUrl });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מערכות לפי מנהל (ציבורי עם טוקן) ───────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult GetSystemsByManagerToken(string token)
    {
        try
        {
            if (string.IsNullOrEmpty(token))
                return Json(new { success = false, error = "טוקן נדרש" });

            var (valid, managerId, tokenError) =
                _tokenService.ValidateToken(token);

            if (!valid)
                return Json(new { success = false, error = tokenError });

            if (!managerId.StartsWith("manager_"))
                return Json(new { success = false, error = "טוקן לא תקין" });

            var managerName = Uri.UnescapeDataString(
                managerId.Substring("manager_".Length));

            var systems = LoadFromJson();

            // ─── מצא מערכות של המנהל שממתינות לתיקוף ───
            var managerSystems = systems
                .Where(s => string.Equals(
                    s.SystemManager?.Trim(),
                    managerName.Trim(),
                    StringComparison.OrdinalIgnoreCase))
                .ToList();

            return Json(new
            {
                success     = true,
                managerName,
                systems     = managerSystems,
                count       = managerSystems.Count,
                pendingCount = managerSystems.Count(s => s.RequiresValidation)
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: דף תיקוף מנהל (View) ──────────────────────────────
    [HttpGet]
    [AllowAnonymous]
    public IActionResult ValidateManager(string id)
    {
        if (string.IsNullOrEmpty(id))
            return Content("טוקן חסר", "text/plain");

        var (valid, managerId, error) = _tokenService.ValidateToken(id);

        if (!valid)
        {
            ViewBag.TokenError = error;
            return View("ValidateExpired");
        }

        if (!managerId.StartsWith("manager_"))
        {
            ViewBag.TokenError = "סוג טוקן שגוי";
            return View("ValidateExpired");
        }

        var managerName = Uri.UnescapeDataString(
            managerId.Substring("manager_".Length));

        ViewBag.ManagerName = managerName;
        ViewBag.Token       = id;
        return View();
    }

    // ─── POST: שמור את כל המערכות ────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult SaveSystems([FromBody] SaveSystemsRequest request)
    {
        try
        {
            // ─── הוסף בדיקת הרשאה ───
            if (!IsCurrentUserAdmin() && !CanSendValidation())
                return Json(new { success = false, 
                                error = "אין הרשאה לביצוע פעולה זו" });
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
            if (!IsCurrentUserAdmin() && !CanSendValidation())
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
                if (u.Publisher != null) system.Publisher = u.Publisher;
                if (u.SupportVendor != null) system.SupportVendor = u.SupportVendor;
                if (u.AutomationNote != null) system.AutomationNote = u.AutomationNote;

                // ─── שדות דינמיים ───
                if (u.DynamicFields != null)
                {
                    system.DynamicFields ??= new Dictionary<string, string>();
                    foreach (var kv in u.DynamicFields)
                    {
                        if (kv.Value.ValueKind == System.Text.Json.JsonValueKind.String)
                        {
                            var val = kv.Value.GetString();
                            if (!string.IsNullOrEmpty(val))
                            {
                                system.DynamicFields[kv.Key] = val;
                                
                                // עדכן ישירות על האובייקט דרך Reflection
                                var property = typeof(SystemRecord).GetProperty(
                                    kv.Key,
                                    System.Reflection.BindingFlags.IgnoreCase |
                                    System.Reflection.BindingFlags.Public |
                                    System.Reflection.BindingFlags.Instance
                                );
                                if (property != null && property.CanWrite &&
                                    property.PropertyType == typeof(string))
                                {
                                    property.SetValue(system, val);
                                }
                            }
                        }
                    }
                }
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
            if (!CanSendValidation())
                return Json(new { success = false, error = "אין הרשאה לשליחת תיקוף" });

            var systems = LoadFromJson();
            var system  = systems.FirstOrDefault(s => s.Id == request.SystemId);
            if (system == null)
                return Json(new { success = false, error = "מערכת לא נמצאה" });

            system.RequiresValidation = true;
            system.LastUpdated        = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.UpdatedBy          = GetCurrentUsername();
            system.LastValidationEmailSentAt =
                DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            system.ValidationReminderCount = 0;
            SaveToJson(systems);

            var baseUrl = $"{Request.Scheme}://{Request.Host}";

            // ─── טוקן למערכת בודדת ───
            var token       = _tokenService.GenerateToken(system.Id, validDays: 7);
            var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

            // ─── טוקן לדף המנהל (כל המערכות שלו) ───
            var managerId      = "manager_" +
                Uri.EscapeDataString(system.SystemManager?.Trim() ?? "");
            var managerToken   = _tokenService.GenerateToken(managerId, validDays: 7);
            var managerPageUrl = $"{baseUrl}/SystemsCatalog/ValidateManager/{managerToken}";

            var (success, message) = await _emailService.SendValidationRequestEmailAsync(
                toEmail:         request.ManagerEmail,
                toName:          system.SystemManager ?? "",
                systemName:      system.Name ?? "",
                validateUrl:     validateUrl,
                catalogNumber:   system.Number ?? "",
                managerPageUrl:  managerPageUrl   // ← פרמטר חדש
            );

            return Json(new { success, message, requiresValidation = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: שלח מייל מרוכז עם כל קישורי התיקוף ───
    [HttpPost]
    [Authorize]
    public async Task<IActionResult> SendBulkValidationLinksToMe(
        [FromBody] BulkValidationLinksRequest request)
    {
        try
        {
            if (!CanSendValidation())
                return Json(new { success = false, error = "אין הרשאה לשליחת תיקוף" });

            if (request?.SystemIds == null || request.SystemIds.Count == 0)
                return Json(new { success = false, error = "לא נשלחו מערכות" });

            if (string.IsNullOrWhiteSpace(request.ToEmail))
                return Json(new { success = false, error = "נדרש מייל יעד" });

            var systems = LoadFromJson();
            var baseUrl = $"{Request.Scheme}://{Request.Host}";

            // ─── קבץ לפי מנהל מערכת ───
            // (string systemName, string catalogNumber, string validateUrl)
            var byManager = new Dictionary<string,
                List<(string systemName, string catalogNumber, string validateUrl)>>(
                StringComparer.OrdinalIgnoreCase);

            // ─── טוקן מנהל אחד לכל מנהל ייחודי ───
            var managerPageUrls = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);

            var now  = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user = GetCurrentUsername();

            foreach (var systemId in request.SystemIds)
            {
                var system = systems.FirstOrDefault(s => s.Id == systemId);
                if (system == null) continue;

                // ─── טוקן למערכת בודדת ───
                var token       = _tokenService.GenerateToken(system.Id, validDays: 7);
                var validateUrl = $"{baseUrl}/SystemsCatalog/Validate/{token}";

                var managerKey = string.IsNullOrWhiteSpace(system.SystemManager)
                    ? "__no_manager__"
                    : system.SystemManager.Trim();

                // ─── צור טוקן מנהל (פעם אחת לכל מנהל) ───
                if (!managerPageUrls.ContainsKey(managerKey) &&
                    managerKey != "__no_manager__")
                {
                    var managerId      = "manager_" +
                        Uri.EscapeDataString(system.SystemManager!.Trim());
                    var managerToken   = _tokenService.GenerateToken(
                        managerId, validDays: 7);
                    managerPageUrls[managerKey] =
                        $"{baseUrl}/SystemsCatalog/ValidateManager/{managerToken}";
                }

                if (!byManager.ContainsKey(managerKey))
                    byManager[managerKey] = new();

                byManager[managerKey].Add((
                    system.Name         ?? "",
                    system.Number       ?? "",
                    validateUrl
                ));

                // ─── סמן כנדרש תיקוף ───
                system.RequiresValidation        = true;
                system.LastValidationEmailSentAt = now;
                system.ValidationReminderCount   = 0;
                system.LastUpdated               = now;
                system.UpdatedBy                 = user;
            }

            // ─── שמור ───
            SaveToJson(systems);

            // ─── שלח מייל מרוכז אליי עם קישורים לכל מנהל ───
            var (success, message) = await _emailService
                .SendBulkValidationLinksEmailAsync(
                    toEmail:         request.ToEmail,
                    toName:          GetCurrentUsername(),
                    byManager:       byManager,
                    managerPageUrls: managerPageUrls,   // ← חדש
                    totalSystems:    request.SystemIds.Count
                );

            return Json(new { success, message });
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
            if (!CanSendValidation())
                return Json(new { success = false, error = "אין הרשאה לשליחת תיקוף" });

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

                    if (ok)
                    {
                        sentCount++;
                        // ← תיעוד מתי נשלח המייל
                        system.LastValidationEmailSentAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
                        system.ValidationReminderCount   = 0;
                    }
                    else
                    {
                        errors.Add($"{system.Name}: {msg}");
                    }

                    var random = new Random();
                    var delaySeconds = random.Next(10, 31); // 10-30 כולל
                    await Task.Delay(TimeSpan.FromSeconds(delaySeconds));
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
            if (!IsCurrentUserAdmin() && !CanSendValidation())
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

                    default:
                        // ─── שדה לא מוכר - נסה לשמור ישירות על האובייקט ───
                        if (prop.Value.ValueKind == JsonValueKind.String)
                        {
                            var property = typeof(SystemRecord).GetProperty(
                                prop.Name,
                                System.Reflection.BindingFlags.IgnoreCase |
                                System.Reflection.BindingFlags.Public |
                                System.Reflection.BindingFlags.Instance
                            );
                            if (property != null && property.CanWrite &&
                                property.PropertyType == typeof(string))
                            {
                                property.SetValue(rec, prop.Value.GetString() ?? "");
                            }
                            else
                            {
                                // ─── שמור ב-DynamicFields ───
                                rec.DynamicFields ??= new Dictionary<string, string>();
                                rec.DynamicFields[prop.Name] = prop.Value.GetString() ?? "";
                            }
                        }
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

        var username = GetCurrentUsername();
        
        // ─── בדוק מקובץ הרשאות ───
        var perms = LoadPermissions();
        if (perms.Admins.Contains(username, StringComparer.OrdinalIgnoreCase))
            return true;

        // ─── fallback: רשימה קשיחה ───
        var hardcodedAdmins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "talyoh", "admin", "administrator"
        };
        return hardcodedAdmins.Contains(username);
    }

    private bool IsCurrentUserNoc()
    {
        if (User?.IsInRole("NOC") == true) return true;
        if (User?.IsInRole("noc") == true) return true;

        var roleClaim = User?.FindFirst("role")?.Value
                    ?? User?.FindFirst(
                            System.Security.Claims.ClaimTypes.Role
                        )?.Value ?? "";

        if (roleClaim.Equals("NOC",
                StringComparison.OrdinalIgnoreCase)) return true;

        var username = GetCurrentUsername();
        var perms = LoadPermissions();
        return perms.NocUsers.Contains(username, StringComparer.OrdinalIgnoreCase);
    }

    // ─── בדוק אם המשתמש הנוכחי הוא עורך אוטומציה בלבד ───
    private bool IsAutomationOnlyEditor()
    {
        var username = GetCurrentUsername();
        
        // ─── בדוק מקובץ הרשאות ───
        var perms = LoadPermissions();
        if (perms.AutomationEditors.Contains(username, StringComparer.OrdinalIgnoreCase))
            return true;

        // ─── fallback: מ-config ───
        var editors = _config
            .GetSection("Authorization:AutomationPrivilegedUsers")
            .Get<List<string>>() ?? new List<string>();

        return editors.Contains(username, StringComparer.OrdinalIgnoreCase);
    }

    private bool CanSendValidation()
    {
        if (IsCurrentUserAdmin()) return true;
        
        var username = GetCurrentUsername();
        var perms = LoadPermissions();
        return perms.ValidationSenders.Contains(
            username, StringComparer.OrdinalIgnoreCase);
    }

    // ─── GET: קבל הרשאות ────────────────────────────────────────
    [HttpGet]
    [Authorize]
    public IActionResult GetPermissions()
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            var perms = LoadPermissions();
            return Json(new { success = true, permissions = perms });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: שמור הרשאות ──────────────────────────────────────
    [HttpPost]
    [Authorize]
    public IActionResult SavePermissions([FromBody] CatalogPermissions request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            if (request == null)
                return Json(new { success = false, error = "בקשה לא תקינה" });

            // ─── וודא שהמשתמש הנוכחי נשאר אדמין ───
            var currentUser = GetCurrentUsername();
            if (!request.Admins.Contains(currentUser, StringComparer.OrdinalIgnoreCase))
                request.Admins.Add(currentUser);

            // ─── וודא שאין כפילויות ───
            request.Admins           = request.Admins.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.ValidationSenders = request.ValidationSenders.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.AutomationEditors = request.AutomationEditors.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.NocUsers          = request.NocUsers.Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            request.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            request.UpdatedBy   = currentUser;

            SavePermissionsPrivate(request);

            return Json(new
            {
                success = true,
                message = "הרשאות נשמרו בהצלחה",
                permissions = request
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל רשימת משתמשים ─────────────────────────────────
    [HttpGet]
    [Authorize]
    public IActionResult GetAllUsers()
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            // ─── קרא משתמשים מ-UserService ───
            var users = _userService.GetAllUsers();
            
            return Json(new
            {
                success = true,
                users = users.Select(u => new
                {
                    username    = u.Username,
                    displayName = u.DisplayName ?? u.Username,
                    role        = u.Role.ToString()     // ← המרה ל-string
                }).OrderBy(u => u.displayName).ToList()
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── טען הרשאות ─────────────────────────────────────────────
    private CatalogPermissions LoadPermissions()
    {
        lock (_permLock)
        {
            if (!System.IO.File.Exists(_permissionsPath))
                return GetDefaultPermissions();

            try
            {
                var json = System.IO.File.ReadAllText(_permissionsPath, Encoding.UTF8);
                return JsonSerializer.Deserialize<CatalogPermissions>(
                    json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                ) ?? GetDefaultPermissions();
            }
            catch
            {
                return GetDefaultPermissions();
            }
        }
    }

    // ─── שמור הרשאות ────────────────────────────────────────────
    private void SavePermissionsPrivate(CatalogPermissions perms)
    {
        lock (_permLock)
        {
            var dir = Path.GetDirectoryName(_permissionsPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(perms,
                new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(_permissionsPath, json, Encoding.UTF8);
        }
    }

    // ─── ברירת מחדל ─────────────────────────────────────────────
    private CatalogPermissions GetDefaultPermissions()
    {
        return new CatalogPermissions
        {
            Admins            = new List<string> { "talyoh" },
            ValidationSenders = new List<string>(),
            AutomationEditors = new List<string>(),
            NocUsers          = new List<string>(),
            LastUpdated       = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
            UpdatedBy         = "system"
        };
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
    public string? LastValidationEmailSentAt { get; set; } = "";
    public int     ValidationReminderCount   { get; set; } = 0;
    
    // ─── שדות נוספים מהאקסל ───
    public string IsMonitored            { get; set; } = "";
    public string IsCritical             { get; set; } = "";
    public string WorkNotes              { get; set; } = "";
    public string SkipSync               { get; set; } = "";
    public string BaNumber               { get; set; } = "";
    public string ServiceOffering        { get; set; } = "";
    public string ShadowIT               { get; set; } = "";
    public string Tags                   { get; set; } = "";
    public string Owner                  { get; set; } = "";
    public string CanPrint               { get; set; } = "";
    public string Rto                    { get; set; } = "";
    public string Rpo                    { get; set; } = "";
    public string UserCount              { get; set; } = "";
    public string AppUrl                 { get; set; } = "";
    public string JiraId                 { get; set; } = "";
    public string RequiresAuth           { get; set; } = "";
    public string As400Partition         { get; set; } = "";
    public string SystemRequestNumber    { get; set; } = "";
    public string ClusterNumber          { get; set; } = "";
    public string AlternativeSite        { get; set; } = "";
    public string CoreSystem             { get; set; } = "";
    public string PermissionManagement   { get; set; } = "";
    public string DomainPath             { get; set; } = "";
    public string SystemDeptPath         { get; set; } = "";
    public string InstallationType       { get; set; } = "";
    public string ClientType             { get; set; } = "";
    public string MainDbType             { get; set; } = "";
    public string AuthStatus             { get; set; } = "";
    public string OperationalStatus      { get; set; } = "";
    public string FailureCount           { get; set; } = "";
    public string Updates                { get; set; } = "";
    public string Group                  { get; set; } = "";
    public string BudgetCategory         { get; set; } = "";
    public string RiskLevel              { get; set; } = "";
    public string MainSystemAssociation  { get; set; } = "";
    public string MainSchemaName         { get; set; } = "";
    public string ItDomain               { get; set; } = "";
    public string BusinessSurvey         { get; set; } = "";
    public string TechSurvey             { get; set; } = "";
    public string Approved               { get; set; } = "";
    public string Active                 { get; set; } = "";
    public string Monitor                { get; set; } = "";
    public string LastTechSurveyScore    { get; set; } = "";
    public string LastBusinessSurveyScore{ get; set; } = "";
    
    // ─── שדות דינמיים (עמודות שהאדמין הוסיף) ───
    public Dictionary<string, string>? DynamicFields { get; set; }
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
    public string? ValidationToken  { get; set; }
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
    public bool?   RequiresValidation      { get; set; }
    public string? Publisher               { get; set; }
    public string? SupportVendor           { get; set; }
    public string? AutomationNote          { get; set; }
    
    // ─── שדות דינמיים ─────────────────────────
    [System.Text.Json.Serialization.JsonExtensionData]
    public Dictionary<string, System.Text.Json.JsonElement>? 
        DynamicFields { get; set; }
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

public class SendReminderRequest
{
    public string SystemId     { get; set; } = "";
    public string ManagerEmail { get; set; } = "";
    public int    DaysSinceSent { get; set; } = 3;
}

// ─── מודל עמודה ───
public class ColumnDefinition
{
    public string Key            { get; set; } = "";
    public string Label          { get; set; } = "";
    public bool   DefaultVisible { get; set; } = false;
    public bool   AlwaysVisible  { get; set; } = false;
    public bool   CanReorder     { get; set; } = true;
    public string Category       { get; set; } = "";
    public int    SortOrder      { get; set; } = 50;
    public string? Description   { get; set; }
    public int?   Width          { get; set; }
    public bool ShowInValidation { get; set; } = true;
    public bool RequiredInValidation { get; set; } = false; 
    
    // ─── סוג שדה וערכים אפשריים ───
    public string FieldType       { get; set; } = "text";
    // אפשרויות: "text", "select", "number", "date", "boolean", "textarea"
    
    public List<string>? AllowedValues { get; set; }
    // רלוונטי רק כאשר FieldType = "select"
}

public class ColumnDefinitionsFile
{
    public string              Version     { get; set; } = "1.0";
    public string              LastUpdated { get; set; } = "";
    public string?             UpdatedBy   { get; set; }
    public List<ColumnDefinition> Columns  { get; set; } = new();
}

public class CatalogPermissions
{
    public List<string> Admins            { get; set; } = new();
    public List<string> ValidationSenders { get; set; } = new();
    public List<string> AutomationEditors { get; set; } = new();
    public List<string> NocUsers          { get; set; } = new();
    public string       LastUpdated       { get; set; } = "";
    public string?      UpdatedBy         { get; set; }
}

public class UserInfo
{
    public string Username    { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role        { get; set; } = "";
}

public class BulkValidationLinksRequest
{
    public List<string> SystemIds { get; set; } = new();
    public string       ToEmail   { get; set; } = "";
}

public class BulkValidatePublicRequest
{
    public string       ManagerToken  { get; set; } = "";
    public List<string> SystemIds     { get; set; } = new();
    public string?      ManagerEmail  { get; set; }
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