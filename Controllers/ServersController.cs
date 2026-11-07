// file: ServersController.cs
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression; // ← קיים ב-.NET Core ללא חבילות
using System.Linq;
using System.Text.Json;
using System.Text;
using System.Xml.Linq;       // ← קיים ב-.NET Core ללא חבילות
using System.Data;
using System.Net.Http;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Authorization;
using NocPortal.Services; 

public class ServersController : Controller
{
    // ─── נתיבים ───────────────────────────────────────────────
    private readonly string _baseDir =
        PortalPaths.UnderFiles("servers");
    private readonly string _serverProdPath;
    
    private readonly string _outputServersPath;
    private readonly string _mappingPath;

    private readonly string _jsonStorePath =
        PortalPaths.UnderFiles(@"servers_data.json");

    private static readonly object _fileLock = new object();

    // ─── נתיבים נוספים ────────────────────────────────────────────
    private readonly string _prodPatchesPath;
    private readonly string _nonProdPatchesPath;
    private readonly string _prodOnlyPath;

    private readonly IConfiguration _configuration;
    private readonly SecretsService _secrets; 
    private readonly UserService _userService; 

    // ─── נתיב קובץ הרשאות שרתים ────────────────────────────────
    private readonly string _serversPermissionsPath =
        PortalPaths.UnderFiles(@"servers_permissions.json");

    private static readonly object _permLock = new object();

    public ServersController(IConfiguration configuration,
        SecretsService secrets, UserService userService) 
    {
        _outputServersPath = Path.Combine(_baseDir,
            "OUTPUT_SERVERS_19-05-26.xlsx");
        _mappingPath = Path.Combine(_baseDir,
            "מיפוי שרתים למערכות ארגוניות.xlsx");
        _serverProdPath = Path.Combine(_baseDir,
            "SERVER_PROD__NONPROD.xlsx");

        // ── קבצי XLSX נוספים ─────────────────────────────────────
        _prodPatchesPath     = Path.Combine(_baseDir,
            "הפצת עדכוני פאצים לשרתי ייצור 08.25.xlsx");
        _nonProdPatchesPath  = Path.Combine(_baseDir,
            "הפצת עדכוני אבטחה לשרתי NONPROD 05.26.xlsx");
        _prodOnlyPath        = Path.Combine(_baseDir,
            "PROD_ONLY.xlsx");
        _configuration = configuration;
        _secrets       = secrets;  
        _userService   = userService; 
    }

    // ─── GET: קבל את כל השרתים ────────────────────────────────
    [HttpGet]
    public IActionResult GetServers()
    {
        try
        {
            if (System.IO.File.Exists(_jsonStorePath))
            {
                var json = System.IO.File.ReadAllText(
                    _jsonStorePath, Encoding.UTF8);
                var servers =
                    JsonSerializer.Deserialize<List<ServerRecord>>(json);
                return Json(new
                {
                    success = true,
                    servers,
                    source  = "cache",
                    count   = servers?.Count ?? 0
                });
            }

            return ImportFromXlsxInternal();
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetCurrentUser()
    {
        try
        {
            var username = GetCurrentUsername();
            var isAdmin  = IsCurrentUserAdmin();
            var isEditor = IsCurrentUserEditor();

            // ─── אדמינים קשיחים של המערכת (לא ניתן להסיר) ───────────
            var systemAdmins = new List<string>
            {
                "talyoh",
                "admin",
                "administrator"
            };

            // ─── אדמינים של דשבורד השרתים (מקובץ הרשאות) ────────────
            var perms  = LoadServersPermissions();
            var admins = perms.Admins
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            return Json(new
            {
                success      = true,
                username     = username,
                isAdmin      = isAdmin,
                isEditor     = isEditor,
                // ─── אדמינים קשיחים - לא ניתן להסיר ─────────────────
                systemAdmins = systemAdmins,
                // ─── אדמינים של הדשבורד - ניתן לנהל ─────────────────
                admins       = admins
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל שרתים לפי שם מערכת ────────────────────────────
    [HttpGet]
    public IActionResult GetServersBySystem(string systemName, string? catalogNumber = null)
    {
        try
        {
            var allServers = LoadFromJson();

            List<ServerRecord> servers;

            // ─── חיפוש לפי מספר קטלוג (עדיפות) ───
            if (!string.IsNullOrWhiteSpace(catalogNumber))
            {
                servers = allServers.Where(s =>
                    string.Equals(
                        s.CatalogNumber,
                        catalogNumber,
                        StringComparison.OrdinalIgnoreCase)
                ).ToList();

                // ─── אם לא נמצא לפי קטלוג - fallback לשם ───
                if (servers.Count == 0 && !string.IsNullOrWhiteSpace(systemName))
                {
                    servers = allServers.Where(s =>
                        string.Equals(s.SystemName, systemName,
                            StringComparison.OrdinalIgnoreCase)
                    ).ToList();
                }
            }
            else if (!string.IsNullOrWhiteSpace(systemName))
            {
                // ─── חיפוש לפי שם מערכת ───
                servers = allServers.Where(s =>
                    string.Equals(s.SystemName, systemName,
                        StringComparison.OrdinalIgnoreCase) ||
                    (!string.IsNullOrEmpty(s.SystemName) &&
                    s.SystemName.IndexOf(systemName,
                        StringComparison.OrdinalIgnoreCase) >= 0)
                ).ToList();
            }
            else
            {
                return Json(new { success = false, error = "נדרש שם מערכת או מספר קטלוג" });
            }

            return Json(new
            {
                success = true,
                servers,
                count = servers.Count,
                systemName,
                catalogNumber
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult UpdateServer([FromBody] UpdateServerRequest request)
    {
        try
        {
            // ─── בדוק הרשאות עריכה (אדמין או עורך) ─────────────
            if (!IsCurrentUserEditor())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            if (string.IsNullOrEmpty(request?.ServerName))
                return Json(new { success = false, error = "שם שרת נדרש" });

            var servers = LoadFromJson();
            var server  = servers.FirstOrDefault(
                s => s.Name == request.ServerName);

            if (server == null)
                return Json(new { success = false, error = "שרת לא נמצא" });

            // ─── עורך רגיל - שדות מוגבלים ──────────────────────
            if (!IsCurrentUserAdmin())
            {
                // עורך יכול לעדכן רק שדות אלו:
                if (request.IsHealthy      != null) server.IsHealthy      = request.IsHealthy;
                if (request.SystemStatus   != null) server.SystemStatus   = request.SystemStatus;
                if (request.Notes          != null) server.Notes          = request.Notes;
                if (request.MappingNotes   != null) server.MappingNotes   = request.MappingNotes;
                if (request.CanShutdown    != null) server.CanShutdown    = request.CanShutdown;
                if (request.BootType       != null) server.BootType       = request.BootType;
            }
            else
            {
                // ─── אדמין - עדכן את כל השדות ──────────────────
                if (request.Environment    != null) server.Environment    = NormalizeEnvironment(request.Environment);
                if (request.IsVirtual      != null) server.IsVirtual      = request.IsVirtual;
                if (request.OS             != null) server.OS             = request.OS;
                if (request.SystemName     != null) server.SystemName     = request.SystemName;
                if (request.CatalogNumber  != null) server.CatalogNumber  = request.CatalogNumber;
                if (request.SystemStatus   != null) server.SystemStatus   = request.SystemStatus;
                if (request.SystemManager  != null) server.SystemManager  = request.SystemManager;
                if (request.BootType       != null) server.BootType       = request.BootType;
                if (request.Domain         != null) server.Domain         = request.Domain;
                if (request.Department     != null) server.Department     = request.Department;
                if (request.Team           != null) server.Team           = request.Team;
                if (request.CanShutdown    != null) server.CanShutdown    = request.CanShutdown;
                if (request.ScannedVia     != null) server.ScannedVia     = request.ScannedVia;
                if (request.IsHealthy      != null) server.IsHealthy      = request.IsHealthy;
                if (request.Notes          != null) server.Notes          = request.Notes;
                if (request.MappingNotes   != null) server.MappingNotes   = request.MappingNotes;
                if (request.HardwareVendor != null) server.HardwareVendor = request.HardwareVendor;
            }

            server.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            server.UpdatedBy   = GetCurrentUsername();

            SaveToJson(servers);

            return Json(new
            {
                success = true,
                server  = server,
                message = $"שרת {server.Name} עודכן בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── עזר: נרמל ערך סביבה ─────────────────────────────────────
    private static string NormalizeEnvironment(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        
        var normalized = value.Trim()
            .Replace(" ", "")
            .Replace("-", "")
            .Replace("_", "")
            .ToUpperInvariant();

        if (normalized == "PROD") return "PROD";
        if (normalized == "NONPROD") return "NONPROD";
        
        // fallback
        return value.Trim();
    }

    private bool IsCurrentUserAdmin()
    {
        // ── אפשרות 1: לפי Role ──────────────────────────────────
        if (User?.IsInRole("Admin") == true)  return true;
        if (User?.IsInRole("admin") == true)  return true;

        // ── אפשרות 2: לפי Claim ─────────────────────────────────
        var roleClaim = User?.FindFirst("role")?.Value
                    ?? User?.FindFirst(
                            System.Security.Claims.ClaimTypes.Role
                        )?.Value ?? "";

        if (roleClaim.Equals("admin",
                StringComparison.OrdinalIgnoreCase)) return true;

        // ── אפשרות 3: קרא מקובץ הרשאות דינמי ───────────────────
        var username = GetCurrentUsername();
        var perms = LoadServersPermissions();

        if (perms.Admins.Contains(username,
                StringComparer.OrdinalIgnoreCase))
            return true;

        // ── fallback: רשימה קשיחה ────────────────────────────────
        var hardcodedAdmins = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            "talyoh",
            "admin",
            "administrator"
        };
        return hardcodedAdmins.Contains(username);
    }

    // ─── בדוק אם המשתמש הנוכחי הוא עורך ────────────────────────
    private bool IsCurrentUserEditor()
    {
        // ─── אדמין = גם עורך ────────────────────────────────────
        if (IsCurrentUserAdmin()) return true;

        var username = GetCurrentUsername();
        var perms    = LoadServersPermissions();

        return perms.Editors.Contains(
            username, StringComparer.OrdinalIgnoreCase);
    }

    // ─── POST: ייבא מ-XLSX (רענון ידני) ──────────────────────
    [HttpPost]
    public IActionResult ImportFromCsv()
    {
        return ImportFromXlsxInternal();
    }

    // ─── לוגיקת ייבוא ומיזוג פנימית ──────────────────────────
    private IActionResult ImportFromXlsxInternal()
    {
        try
        {
            if (!System.IO.File.Exists(_outputServersPath))
                return Json(new
                {
                    success = false,
                    error   = $"קובץ OUTPUT_SERVERS לא נמצא: {_outputServersPath}"
                });

            if (!System.IO.File.Exists(_mappingPath))
                return Json(new
                {
                    success = false,
                    error   = $"קובץ מיפוי לא נמצא: {_mappingPath}"
                });

            if (!System.IO.File.Exists(_serverProdPath))
                return Json(new
                {
                    success = false,
                    error   = $"קובץ SERVER_PROD לא נמצא: {_serverProdPath}"
                });

            // שלב 1: קרא את נתוני המיפוי לדיקשנרי
            var mappingData = ReadMappingFile(_mappingPath);

            // שלב 2: קרא את SERVER_PROD לדיקשנרי (מפתח = Name)
            var serverProdData = ReadServerProdFile(_serverProdPath);

            // שלב 3: קרא OUTPUT_SERVERS ומזג עם המיפוי + SERVER_PROD
            var servers = ReadOutputServersAndMerge(
                _outputServersPath, mappingData, serverProdData);

            // שלב 4: שמור JSON
            SaveToJson(servers);

            return Json(new
            {
                success = true,
                servers,
                source  = "xlsx",
                count   = servers.Count,
                message = $"יובאו {servers.Count} שרתים בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success    = false,
                error      = ex.Message,
                stackTrace = ex.StackTrace
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // קריאת XLSX ישירות כ-ZIP + XML (ללא חבילות חיצוניות)
    // ═══════════════════════════════════════════════════════════

    /// <summary>
    /// קורא קובץ XLSX ומחזיר DataTable.
    /// XLSX = קובץ ZIP המכיל:
    ///   xl/sharedStrings.xml  ← מחרוזות משותפות
    ///   xl/worksheets/sheet1.xml ← נתוני הגיליון
    /// </summary>
    private DataTable ReadXlsxToDataTable(string filePath)
    {
        var dt = new DataTable();

        // ─── פתח את ה-XLSX כ-ZIP ──────────────────────────────
        using var zip = ZipFile.OpenRead(filePath);

        // ─── שלב 1: קרא את SharedStrings (מחרוזות משותפות) ───
        // ב-XLSX, מחרוזות טקסט נשמרות במאגר מרכזי
        // ותאים מכילים אינדקס למאגר זה
        var sharedStrings = new List<string>();
        var ssEntry = zip.GetEntry("xl/sharedStrings.xml");
        if (ssEntry != null)
        {
            using var stream = ssEntry.Open();
            var xdoc = XDocument.Load(stream);
            XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

            // כל <si> הוא מחרוזת, <t> הוא הטקסט
            foreach (var si in xdoc.Descendants(ns + "si"))
            {
                // איחוד כל חלקי הטקסט (תאים עם עיצוב חלקי)
                var text = string.Concat(
                    si.Descendants(ns + "t").Select(t => t.Value));
                sharedStrings.Add(text);
            }
        }

        // ─── שלב 2: מצא את הגיליון הראשון ────────────────────
        // קרא את workbook.xml כדי לדעת את שם הקובץ של sheet1
        string sheet1File = "xl/worksheets/sheet1.xml"; // ברירת מחדל
        var wbEntry = zip.GetEntry("xl/workbook.xml");
        if (wbEntry != null)
        {
            using var stream = wbEntry.Open();
            var xdoc = XDocument.Load(stream);
            XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

            // קח את הגיליון הראשון
            var firstSheet = xdoc.Descendants(ns + "sheet").FirstOrDefault();
            if (firstSheet != null)
            {
                // קרא את workbook.xml.rels כדי למצוא את הנתיב האמיתי
                var rId = firstSheet.Attribute(
                    XNamespace.Get(
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                    ) + "id")?.Value;

                if (rId != null)
                {
                    var relsEntry = zip.GetEntry("xl/_rels/workbook.xml.rels");
                    if (relsEntry != null)
                    {
                        using var relsStream = relsEntry.Open();
                        var relsDoc = XDocument.Load(relsStream);
                        XNamespace relsNs =
                            "http://schemas.openxmlformats.org/package/2006/relationships";

                        var target = relsDoc.Descendants(relsNs + "Relationship")
                            .FirstOrDefault(r => r.Attribute("Id")?.Value == rId)
                            ?.Attribute("Target")?.Value;

                        if (target != null)
                        {
                            // target יכול להיות "worksheets/sheet1.xml"
                            sheet1File = target.StartsWith("xl/")
                                ? target
                                : $"xl/{target}";
                        }
                    }
                }
            }
        }

        // ─── שלב 3: קרא את נתוני הגיליון ─────────────────────
        var sheetEntry = zip.GetEntry(sheet1File);
        if (sheetEntry == null)
            throw new Exception($"לא נמצא גיליון בקובץ: {filePath}");

        using var sheetStream = sheetEntry.Open();
        var sheetDoc = XDocument.Load(sheetStream);
        XNamespace sheetNs =
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

        var rows = sheetDoc.Descendants(sheetNs + "row").ToList();
        if (rows.Count == 0) return dt;

        // ─── שלב 4: קרא שורת כותרות (שורה ראשונה) ────────────
        var headerRow = rows[0];
        var headers   = new List<string>();

        foreach (var cell in headerRow.Elements(sheetNs + "c"))
        {
            string val = GetCellValue(cell, sharedStrings, sheetNs);
            headers.Add(val);
            // הוסף עמודה ל-DataTable (אם שם ריק - תן שם ברירת מחדל)
            dt.Columns.Add(string.IsNullOrEmpty(val)
                ? $"Col{headers.Count}"
                : val);
        }

        // ─── שלב 5: קרא שורות נתונים ─────────────────────────
        for (int rowIdx = 1; rowIdx < rows.Count; rowIdx++)
        {
            var row    = rows[rowIdx];
            var drData = dt.NewRow();

            foreach (var cell in row.Elements(sheetNs + "c"))
            {
                // קבל את מיקום התא (למשל "A1", "B2")
                string cellRef = cell.Attribute("r")?.Value ?? "";
                int colIndex   = GetColumnIndex(cellRef);

                if (colIndex >= 0 && colIndex < dt.Columns.Count)
                {
                    drData[colIndex] = GetCellValue(
                        cell, sharedStrings, sheetNs);
                }
            }

            dt.Rows.Add(drData);
        }

        return dt;
    }

    /// <summary>
    /// מחלץ את הערך מתא XLSX.
    /// סוג "s" = shared string (אינדקס למאגר המחרוזות)
    /// סוג אחר = ערך ישיר
    /// </summary>
    private string GetCellValue(
        XElement cell,
        List<string> sharedStrings,
        XNamespace ns)
    {
        var valueEl = cell.Element(ns + "v");
        if (valueEl == null) return "";

        string cellType = cell.Attribute("t")?.Value ?? "";

        // shared string - הערך הוא אינדקס במאגר
        if (cellType == "s")
        {
            if (int.TryParse(valueEl.Value, out int idx) &&
                idx >= 0 && idx < sharedStrings.Count)
                return sharedStrings[idx];
            return "";
        }

        // inline string
        if (cellType == "inlineStr")
        {
            return cell.Element(ns + "is")
                       ?.Element(ns + "t")
                       ?.Value ?? "";
        }

        // מספר / תאריך / בוליאני - החזר כטקסט
        return valueEl.Value;
    }

    /// <summary>
    /// ממיר כתובת תא (למשל "AB12") לאינדקס עמודה (0-based).
    /// "A" → 0, "B" → 1, "Z" → 25, "AA" → 26
    /// </summary>
    private int GetColumnIndex(string cellRef)
    {
        if (string.IsNullOrEmpty(cellRef)) return -1;

        // חלץ רק את האותיות (ללא המספרים)
        string colLetters = new string(
            cellRef.TakeWhile(char.IsLetter).ToArray());

        if (string.IsNullOrEmpty(colLetters)) return -1;

        int index = 0;
        foreach (char c in colLetters.ToUpper())
        {
            index = index * 26 + (c - 'A' + 1);
        }
        return index - 1; // המרה ל-0-based
    }

    // ─── קריאת קובץ המיפוי ────────────────────────────────────
    private Dictionary<string, MappingRecord> ReadMappingFile(string path)
    {
        var result = new Dictionary<string, MappingRecord>(
            StringComparer.OrdinalIgnoreCase);

        var dt = ReadXlsxToDataTable(path);

        string GetCell(DataRow row, string colName)
        {
            if (!dt.Columns.Contains(colName)) return "";
            return row[colName]?.ToString()?.Trim() ?? "";
        }

        foreach (DataRow row in dt.Rows)
        {
            var vmName = GetCell(row, "VM");
            if (string.IsNullOrWhiteSpace(vmName)) continue;
            if (result.ContainsKey(vmName)) continue;

            result[vmName] = new MappingRecord
            {
                VM             = vmName,
                PrimaryIP      = GetCell(row, "Primary IP Address"),
                ServerStatusVC = GetCell(row, "סטטוס שרת (VC)"),
                SystemName     = GetCell(row, "שם מערכת (אנגלית או עברית)"),
                CatalogNumber  = GetCell(row, "מספר קטלוג מערכות"),
                Status         = GetCell(row, "סטטוס"),
                SystemManager  = GetCell(row, "מנהל מערכת"),
                Domain         = GetCell(row, "תחום"),
                Department     = GetCell(row, "מחלקה"),
                Team           = GetCell(row, "צוות"),
                CanShutdown    = GetCell(row, "ניתן לכבות את השרת?"),
                Env            = GetCell(row, "סביבה"),
                DataApproved   = GetCell(row, "נתונים מאושרים?"),
                MappingNotes   = GetCell(row, "הערות"),
                AuxSystem      = GetCell(row, "מערכת עזר"),
                MappingOS      = GetCell(row, "OS")
            };
        }

        return result;
    }

    // ─── קריאת קובץ SERVER_PROD ────────────────────────────────
    /// <summary>
    /// קורא את SERVER_PROD__NONPROD.xlsx
    /// ומחזיר דיקשנרי: שם שרת → נתוני SERVER_PROD
    /// </summary>
    private Dictionary<string, ServerProdRecord> ReadServerProdFile(string path)
    {
        var result = new Dictionary<string, ServerProdRecord>(
            StringComparer.OrdinalIgnoreCase);

        var dt = ReadXlsxToDataTable(path);

        string GetCell(DataRow row, string colName)
        {
            if (!dt.Columns.Contains(colName)) return "";
            return row[colName]?.ToString()?.Trim() ?? "";
        }

        foreach (DataRow row in dt.Rows)
        {
            var name = GetCell(row, "Name");
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (result.ContainsKey(name)) continue;

            result[name] = new ServerProdRecord
            {
                Name           = name,
                OS             = GetCell(row, "OS"),
                HardwareVendor = GetCell(row, "Hardware Vendor"),
                IsVirtual      = GetCell(row, "Virtual"),
                ScannedVia     = GetCell(row, "Scanned via")
            };
        }

        return result;
    }

    
    // ─── POST: שמור את כל השרתים (ייבוא מאקסל) ──────────────
    [HttpPost]
    public IActionResult SaveServers([FromBody] SaveServersRequest request)
    {
        try
        {
            if (request?.Servers == null)
                return Json(new { success = false, error = "אין נתונים לשמירה" });

            SaveToJson(request.Servers);

            return Json(new
            {
                success = true,
                count   = request.Servers.Count,
                message = $"נשמרו {request.Servers.Count} שרתים"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── קריאת OUTPUT_SERVERS ומיזוג ─────────────────────────
    private List<ServerRecord> ReadOutputServersAndMerge(
        string path,
        Dictionary<string, MappingRecord> mappingData,
        Dictionary<string, ServerProdRecord> serverProdData)
    {
        var servers = new List<ServerRecord>();
        var dt      = ReadXlsxToDataTable(path);

        // ─── עזר: קרא תא וסנן ערכי #N/A ──────────────────────
        string GetCell(DataRow row, string colName)
        {
            if (!dt.Columns.Contains(colName)) return "";
            var val = row[colName]?.ToString()?.Trim() ?? "";

            // ← תיקון 3: אם הערך הוא #N/A (בכל צורה) - החזר ריק
            if (val.Equals("#N/A", StringComparison.OrdinalIgnoreCase) ||
                val.Equals("N/A",  StringComparison.OrdinalIgnoreCase) ||
                val == "#VALUE!" || val == "#REF!" || val == "#NAME?")
                return "";

            return val;
        }

        // ─── עזר: הסר דומיין משם שרת ─────────────────────────
        string StripDomain(string serverName)
        {
            if (string.IsNullOrWhiteSpace(serverName)) return serverName;

            var dotIndex = serverName.IndexOf('.');
            if (dotIndex <= 0) return serverName;

            var afterDot = serverName.Substring(dotIndex + 1);

            // אחרי הנקודה מתחיל בספרה = לא דומיין (ITA9.3.3-P1APA1)
            if (afterDot.Length > 0 && char.IsDigit(afterDot[0]))
                return serverName;

            // פחות מ-2 תווים אחרי הנקודה = לא דומיין
            if (afterDot.Length < 2)
                return serverName;

            // אין אותיות אחרי הנקודה = לא דומיין
            if (!afterDot.Any(char.IsLetter))
                return serverName;

            return serverName.Substring(0, dotIndex);
        }

        foreach (DataRow row in dt.Rows)
        {
            try
            {
                var rawName = GetCell(row, "Name");
                if (string.IsNullOrWhiteSpace(rawName)) continue;

                // ← תיקון 1: הסר דומיין משם השרת
                var name = StripDomain(rawName);

                // ← תיקון 2: סנן שרתים עם יצרן חומרה "None"
                var hardwareVendorRaw = GetCell(row, "Hardware Vendor");
                if (hardwareVendorRaw.Equals("None",
                        StringComparison.OrdinalIgnoreCase))
                    continue;

                // נסה למצוא מיפוי גם לפי השם המקוצר (ללא דומיין)
                mappingData.TryGetValue(name, out var mapping);

                // ← חפש ב-SERVER_PROD לפי שם השרת (ללא דומיין)
                serverProdData.TryGetValue(name, out var prodRecord);

                var server = new ServerRecord
                {
                    Id             = $"srv_{Guid.NewGuid():N}",
                    Name           = name,   // ← שם ללא דומיין
                    OS             = GetCell(row, "OS").IfEmpty(
                                        mapping?.MappingOS ?? ""),
                    // ← עדיפות: SERVER_PROD, fallback: OUTPUT_SERVERS
                    HardwareVendor = prodRecord?.HardwareVendor.IfEmpty(
                                        hardwareVendorRaw)
                                    ?? hardwareVendorRaw,
                    IsVirtual = GetCell(row, "Virtual") switch {
                        var v when v.Equals("TRUE", StringComparison.OrdinalIgnoreCase)  => "TRUE",
                        var v when v.Equals("FALSE", StringComparison.OrdinalIgnoreCase) => "FALSE",
                        var v when string.IsNullOrWhiteSpace(v)                          => "",
                        _                                                                 => "UNKNOWN"
                    },
                    // ← עדיפות: Primary IP מהמיפוי, אחר כך SERVER_PROD, אחר כך OUTPUT
                    ScannedVia     = mapping?.PrimaryIP.IfEmpty(
                                        prodRecord?.ScannedVia.IfEmpty(
                                            GetCell(row, "Scanned Via")) ?? "")
                                    ?? GetCell(row, "Scanned Via"),
                    Environment    = GetCell(row, "PROD/NON PROD"),
                    SystemName     = GetCell(row, "System Name").IfEmpty(
                                        mapping?.SystemName ?? ""),
                    CatalogNumber  = GetCell(row, "Catalog Number").IfEmpty(
                                        mapping?.CatalogNumber ?? ""),
                    SystemManager  = GetCell(row, "מנהל מערכת").IfEmpty(
                                        mapping?.SystemManager ?? ""),
                    BootType       = GetCell(row, "סוג אתחול"),
                    IsHealthy      = GetCell(row, "תקין/לא תקין"),
                    Notes          = GetCell(row, "הערות"),
                    PrimaryIP      = mapping?.PrimaryIP      ?? "",
                    ServerStatusVC = mapping?.ServerStatusVC ?? "",
                    SystemStatus   = mapping?.Status         ?? "",
                    Domain         = mapping?.Domain         ?? "",
                    Department     = mapping?.Department     ?? "",
                    Team           = mapping?.Team           ?? "",
                    CanShutdown    = mapping?.CanShutdown    ?? "",
                    Env            = mapping?.Env            ?? "",
                    DataApproved   = mapping?.DataApproved   ?? "",
                    MappingNotes   = mapping?.MappingNotes   ?? "",
                    AuxSystem      = mapping?.AuxSystem      ?? "",
                    ImportedAt     = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
                    LastUpdated    = null,
                    UpdatedBy      = null,
                    HasMappingData = mapping != null
                };

                servers.Add(server);
            }
            catch
            {
                continue;
            }
        }

        return servers;
    }

// ─── GET: דיבאג - מה קיים בכל קובץ ────────────────────────────
[HttpGet]
public IActionResult DebugSources()
{
    try
    {
        var result = new Dictionary<string, object>();

        // ── SERVER_PROD ──────────────────────────────────────────
        if (System.IO.File.Exists(_serverProdPath))
        {
            try
            {
                var dt = ReadXlsxToDataTable(_serverProdPath);
                var rows = new List<object>();
                foreach (DataRow row in dt.Rows)
                {
                    var name = row[0]?.ToString()?.Trim() ?? "";
                    if (!string.IsNullOrEmpty(name))
                        rows.Add(new {
                            raw    = name,
                            stripped = StripDomainStatic(name)
                        });
                }
                result["serverProd"] = new {
                    file    = _serverProdPath,
                    columns = dt.Columns.Cast<DataColumn>()
                                .Select(c => c.ColumnName).ToList(),
                    count   = rows.Count,
                    sample  = rows.Take(20).ToList()
                };
            }
            catch (Exception ex)
            {
                result["serverProd"] = new { error = ex.Message };
            }
        }
        else
        {
            result["serverProd"] = new { error = "קובץ לא נמצא" };
        }

        // ── PROD PATCHES ─────────────────────────────────────────
        if (System.IO.File.Exists(_prodPatchesPath))
        {
            try
            {
                var dt = ReadXlsxToDataTable(_prodPatchesPath);
                var rows = new List<object>();
                foreach (DataRow row in dt.Rows)
                {
                    var name = row[0]?.ToString()?.Trim() ?? "";
                    if (!string.IsNullOrEmpty(name))
                        rows.Add(new {
                            raw      = name,
                            stripped = StripDomainStatic(name)
                        });
                }
                result["prodPatches"] = new {
                    file    = _prodPatchesPath,
                    columns = dt.Columns.Cast<DataColumn>()
                                .Select(c => c.ColumnName).ToList(),
                    count   = rows.Count,
                    sample  = rows.Take(20).ToList()
                };
            }
            catch (Exception ex)
            {
                result["prodPatches"] = new { error = ex.Message };
            }
        }
        else
        {
            result["prodPatches"] = new { error = "קובץ לא נמצא" };
        }

        // ── NONPROD PATCHES ──────────────────────────────────────
        if (System.IO.File.Exists(_nonProdPatchesPath))
        {
            try
            {
                var dt = ReadXlsxToDataTable(_nonProdPatchesPath);
                var rows = new List<object>();
                foreach (DataRow row in dt.Rows)
                {
                    var name = row[0]?.ToString()?.Trim() ?? "";
                    if (!string.IsNullOrEmpty(name))
                        rows.Add(new {
                            raw      = name,
                            stripped = StripDomainStatic(name)
                        });
                }
                result["nonProdPatches"] = new {
                    file    = _nonProdPatchesPath,
                    columns = dt.Columns.Cast<DataColumn>()
                                .Select(c => c.ColumnName).ToList(),
                    count   = rows.Count,
                    sample  = rows.Take(20).ToList()
                };
            }
            catch (Exception ex)
            {
                result["nonProdPatches"] = new { error = ex.Message };
            }
        }
        else
        {
            result["nonProdPatches"] = new
                { error = "קובץ לא נמצא" };
        }

        // ── MAPPING ──────────────────────────────────────────────
        if (System.IO.File.Exists(_mappingPath))
        {
            try
            {
                var dt = ReadXlsxToDataTable(_mappingPath);
                var rows = new List<object>();
                foreach (DataRow row in dt.Rows)
                {
                    // קרא עמודת VM
                    var name = "";
                    if (dt.Columns.Contains("VM"))
                        name = row["VM"]?.ToString()?.Trim() ?? "";
                    else
                        name = row[0]?.ToString()?.Trim() ?? "";

                    if (!string.IsNullOrEmpty(name))
                        rows.Add(new {
                            raw      = name,
                            stripped = StripDomainStatic(name)
                        });
                }
                result["mapping"] = new {
                    file    = _mappingPath,
                    columns = dt.Columns.Cast<DataColumn>()
                                .Select(c => c.ColumnName).ToList(),
                    count   = rows.Count,
                    sample  = rows.Take(20).ToList()
                };
            }
            catch (Exception ex)
            {
                result["mapping"] = new { error = ex.Message };
            }
        }
        else
        {
            result["mapping"] = new { error = "קובץ לא נמצא" };
        }

        // ── PROD ONLY ────────────────────────────────────────────
        if (System.IO.File.Exists(_prodOnlyPath))
        {
            try
            {
                var dt = ReadXlsxToDataTable(_prodOnlyPath);
                var rows = new List<object>();
                foreach (DataRow row in dt.Rows)
                {
                    var name = row[0]?.ToString()?.Trim() ?? "";
                    if (!string.IsNullOrEmpty(name))
                        rows.Add(new {
                            raw      = name,
                            stripped = StripDomainStatic(name)
                        });
                }
                result["prodOnly"] = new {
                    file    = _prodOnlyPath,
                    columns = dt.Columns.Cast<DataColumn>()
                                .Select(c => c.ColumnName).ToList(),
                    count   = rows.Count,
                    sample  = rows.Take(20).ToList()
                };
            }
            catch (Exception ex)
            {
                result["prodOnly"] = new { error = ex.Message };
            }
        }
        else
        {
            result["prodOnly"] = new { error = "קובץ לא נמצא" };
        }

        return Json(new { success = true, sources = result });
    }
    catch (Exception ex)
    {
        return Json(new {
            success = false,
            error   = ex.Message,
            stack   = ex.StackTrace
        });
    }
}

// ─── GET: חפש שרת ספציפי בכל הקבצים ────────────────────────────
[HttpGet]
public IActionResult SearchServer(string name)
{
    if (string.IsNullOrWhiteSpace(name))
        return Json(new { error = "נדרש שם שרת" });

    var found   = new List<object>();
    var nameLow = name.ToLowerInvariant();

    // ── פונקציה: חפש ב-DataTable ────────────────────────────────
    void SearchInTable(string filePath, string sourceName)
    {
        if (!System.IO.File.Exists(filePath)) return;
        try
        {
            var dt = ReadXlsxToDataTable(filePath);
            foreach (DataRow row in dt.Rows)
            {
                // חפש בכל העמודות
                foreach (DataColumn col in dt.Columns)
                {
                    var cell = row[col]?.ToString()?.Trim() ?? "";
                    if (cell.ToLowerInvariant().Contains(nameLow))
                    {
                        // בנה dict של כל הערכים בשורה
                        var rowData = new Dictionary<string, string>();
                        foreach (DataColumn c in dt.Columns)
                            rowData[c.ColumnName] =
                                row[c]?.ToString()?.Trim() ?? "";

                        found.Add(new {
                            source  = sourceName,
                            column  = col.ColumnName,
                            rowData = rowData
                        });
                        break; // מצאנו בשורה זו - עבור לשורה הבאה
                    }
                }
            }
        }
        catch (Exception ex)
        {
            found.Add(new {
                source = sourceName,
                error  = ex.Message
            });
        }
    }

    SearchInTable(_serverProdPath,    "SERVER_PROD");
    SearchInTable(_prodPatchesPath,   "PROD_PATCHES");
    SearchInTable(_nonProdPatchesPath,"NONPROD_PATCHES");
    SearchInTable(_mappingPath,       "MAPPING");
    SearchInTable(_prodOnlyPath,      "PROD_ONLY");
    SearchInTable(_outputServersPath, "OUTPUT_SERVERS");

    // ── בדוק גם ב-JSON ───────────────────────────────────────────
    var jsonServers = LoadFromJson();
    var inJson = jsonServers
        .Where(s => (s.Name ?? "").ToLowerInvariant()
                    .Contains(nameLow))
        .Select(s => new {
            source = "JSON",
            name   = s.Name,
            env    = s.Environment
        }).ToList();

    return Json(new {
        success    = true,
        searchTerm = name,
        foundInFiles = found,
        foundInJson  = inJson,
        summary = new {
            totalInFiles = found.Count,
            totalInJson  = inJson.Count,
            sources = found
                .GroupBy(f => ((dynamic)f).source)
                .Select(g => new {
                    source = g.Key,
                    count  = g.Count()
                }).ToList()
        }
    });
}

    // ─── POST: עדכן הערה לשרת ─────────────────────────────────
    [HttpPost]
    public IActionResult UpdateServerNote(
        [FromBody] UpdateServerNoteRequest request)
    {
        try
        {
            // ─── עורך או אדמין יכולים לעדכן הערות ──────────────
            if (!IsCurrentUserEditor())
                return Json(new { success = false, error = "אין הרשאה" });

            if (string.IsNullOrEmpty(request?.ServerName))
                return Json(new { success = false, error = "שם שרת נדרש" });

            var servers = LoadFromJson();
            var server  = servers.FirstOrDefault(
                s => s.Name == request.ServerName);

            if (server == null)
                return Json(new { success = false, error = "שרת לא נמצא" });

            server.Notes        = request.Notes        ?? "";
            server.MappingNotes = request.MappingNotes ?? "";
            server.LastUpdated  = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            server.UpdatedBy    = GetCurrentUsername();

            SaveToJson(servers);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: עדכן מספר שרתים בבת אחת ──────────────────────────
    [HttpPost]
    public IActionResult UpdateMultipleServers(
        [FromBody] UpdateMultipleServersRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            if (request?.ServerNames == null ||
                request.ServerNames.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו שרתים לעדכון"
                });

            var servers = LoadFromJson();
            var updated = 0;
            var now     = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            var user    = GetCurrentUsername();

            foreach (var name in request.ServerNames)
            {
                var server = servers.FirstOrDefault(
                    s => s.Name == name);
                if (server == null) continue;

                var u = request.Updates;

                if (u.Environment    != null) server.Environment = NormalizeEnvironment(u.Environment);
                if (u.IsVirtual      != null) server.IsVirtual      = u.IsVirtual;
                if (u.SystemStatus   != null) server.SystemStatus   = u.SystemStatus;
                if (u.IsHealthy      != null) server.IsHealthy      = u.IsHealthy;
                if (u.SystemManager  != null) server.SystemManager  = u.SystemManager;
                if (u.Team           != null) server.Team           = u.Team;
                if (u.Department     != null) server.Department     = u.Department;
                if (u.SystemName     != null) server.SystemName     = u.SystemName;
                if (u.CatalogNumber != null) server.CatalogNumber = u.CatalogNumber;
                if (u.BootType       != null) server.BootType       = u.BootType;
                if (u.CanShutdown    != null) server.CanShutdown    = u.CanShutdown;
                if (u.Notes          != null) server.Notes          = u.Notes;

                server.LastUpdated = now;
                server.UpdatedBy   = user;
                updated++;
            }

            SaveToJson(servers);

            return Json(new
            {
                success      = true,
                updatedCount = updated,
                message      = $"עודכנו {updated} שרתים"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: מחק מספר שרתים בבת אחת ──────────────────────────
    [HttpPost]
    public IActionResult DeleteMultipleServers(
        [FromBody] DeleteMultipleServersRequest request)
    {
        try
        {
            // ─── בדוק הרשאות אדמין ───────────────────────────────
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            if (request?.ServerNames == null ||
                request.ServerNames.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו שרתים למחיקה"
                });

            // ─── נרמל שמות למחיקה (lowercase) ───────────────────
            var toDeleteSet = new HashSet<string>(
                request.ServerNames
                    .Where(n => !string.IsNullOrWhiteSpace(n))
                    .Select(n => n.Trim().ToLowerInvariant()),
                StringComparer.OrdinalIgnoreCase);

            if (toDeleteSet.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו שמות שרתים תקינים"
                });

            var servers      = LoadFromJson();
            var beforeCount  = servers.Count;

            // ─── סנן החוצה את השרתים שנמחקים ────────────────────
            var remaining = servers
                .Where(s => !toDeleteSet.Contains(
                    (s.Name ?? "").Trim().ToLowerInvariant()))
                .ToList();

            var deletedCount = beforeCount - remaining.Count;

            // ─── בדוק שנמחק לפחות שרת אחד ───────────────────────
            if (deletedCount == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נמצאו שרתים למחיקה מתוך הרשימה שנשלחה"
                });

            // ─── שמור את הרשימה המעודכנת ─────────────────────────
            SaveToJson(remaining);

            // ─── בנה רשימת שמות שנמחקו בפועל ────────────────────
            var deletedNames = servers
                .Where(s => toDeleteSet.Contains(
                    (s.Name ?? "").Trim().ToLowerInvariant()))
                .Select(s => s.Name)
                .ToList();

            // ─── בנה רשימת שמות שלא נמצאו ────────────────────────
            var foundNames = new HashSet<string>(
                deletedNames.Select(n =>
                    (n ?? "").Trim().ToLowerInvariant()),
                StringComparer.OrdinalIgnoreCase);

            var notFoundNames = request.ServerNames
                .Where(n => !foundNames.Contains(
                    n.Trim().ToLowerInvariant()))
                .ToList();

            return Json(new
            {
                success      = true,
                deletedCount = deletedCount,
                totalNow     = remaining.Count,
                deletedNames = deletedNames,
                notFound     = notFoundNames,
                message      = $"נמחקו {deletedCount} שרתים בהצלחה" +
                            (notFoundNames.Count > 0
                                ? $" | {notFoundNames.Count} לא נמצאו"
                                : "")
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ─── POST: עדכן סטטוס שרת ────────────────────────────────
    [HttpPost]
    public IActionResult UpdateServerStatus(
        [FromBody] UpdateServerStatusRequest request)
    {
        try
        {
            // ─── עורך או אדמין יכולים לעדכן סטטוס ──────────────
            if (!IsCurrentUserEditor())
                return Json(new { success = false, error = "אין הרשאה" });

            if (request == null || string.IsNullOrEmpty(request.ServerName))
                return Json(new { success = false, error = "שם שרת נדרש" });

            var servers = LoadFromJson();
            var server  = servers.FirstOrDefault(
                s => s.Name == request.ServerName);

            if (server == null)
                return Json(new { success = false, error = "שרת לא נמצא" });

            server.SystemStatus = request.SystemStatus ?? "";
            server.IsHealthy    = request.IsHealthy    ?? "";
            server.LastUpdated  = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            server.UpdatedBy    = GetCurrentUsername();

            SaveToJson(servers);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: סטטיסטיקות ──────────────────────────────────────
    [HttpGet]
    public IActionResult GetStats()
    {
        try
        {
            var servers = LoadFromJson();

            var stats = new
            {
                total    = servers.Count,
                prod     = servers.Count(s => s.Environment == "PROD"),
                nonProd  = servers.Count(s => s.Environment == "NON PROD"),
                virtual_ = servers.Count(s => s.IsVirtual   == "TRUE"),
                physical = servers.Count(s => s.IsVirtual   == "FALSE"),
                active   = servers.Count(s => s.SystemStatus == "פעילה"),
                inactive = servers.Count(s =>
                    s.SystemStatus != "פעילה" &&
                    !string.IsNullOrEmpty(s.SystemStatus)),
                healthy        = servers.Count(s => s.IsHealthy == "תקין"),
                unhealthy      = servers.Count(s => s.IsHealthy == "לא תקין"),
                withMapping    = servers.Count(s =>  s.HasMappingData),
                withoutMapping = servers.Count(s => !s.HasMappingData),
                byVendor = servers
                    .GroupBy(s => s.HardwareVendor ?? "לא ידוע")
                    .Select(g => new { vendor = g.Key, count = g.Count() })
                    .OrderByDescending(x => x.count)
                    .Take(10).ToList(),
                byDepartment = servers
                    .GroupBy(s => s.Department ?? "לא ידוע")
                    .Select(g => new { department = g.Key, count = g.Count() })
                    .OrderByDescending(x => x.count).ToList(),
                byOs = servers
                    .GroupBy(s => SimplifyOs(s.OS))
                    .Select(g => new { os = g.Key, count = g.Count() })
                    .OrderByDescending(x => x.count).ToList(),
                byTeam = servers
                    .GroupBy(s => s.Team ?? "לא ידוע")
                    .Select(g => new { team = g.Key, count = g.Count() })
                    .OrderByDescending(x => x.count).ToList()
            };

            return Json(new { success = true, stats });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: חפש שרת לפי שם/IP וקשר למערכות בקטלוג ──────────────
    [HttpGet]
    public IActionResult SearchServerForCatalog(string term)
    {
        if (string.IsNullOrWhiteSpace(term) || term.Length < 2)
            return Json(new { success = false, error = "נדרש מונח חיפוש" });

        try
        {
            var servers = LoadFromJson();
            var termLow = term.Trim().ToLowerInvariant();

            // ─── חפש שרתים שתואמים לשם או IP ───────────────────────
            var matchedServers = servers.Where(s =>
                (s.Name ?? "").ToLowerInvariant().Contains(termLow) ||
                (s.ScannedVia ?? "").ToLowerInvariant().Contains(termLow) ||
                (s.PrimaryIP ?? "").ToLowerInvariant().Contains(termLow)
            ).ToList();

            if (!matchedServers.Any())
                return Json(new
                {
                    success        = true,
                    matchedSystems = new List<object>(),
                    serverName     = term,
                    serverIp       = (string?)null
                });

            // ─── טען קטלוג מערכות ────────────────────────────────────
            var catalogPath =
                PortalPaths.UnderFiles(@"systems_catalog.json");

            if (!System.IO.File.Exists(catalogPath))
                return Json(new { success = false, error = "קטלוג מערכות לא נמצא" });

            var catalogJson = System.IO.File.ReadAllText(catalogPath, Encoding.UTF8);
            var catalog = JsonSerializer.Deserialize<List<SystemCatalogRecord>>(catalogJson)
                        ?? new List<SystemCatalogRecord>();

            // ─── בנה מפה: catalogNumber → systemId ───────────────────
            var catalogByNumber = catalog
                .Where(c => !string.IsNullOrWhiteSpace(c.Number))
                .GroupBy(c => c.Number!.Trim(),
                    StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g.First(),
                    StringComparer.OrdinalIgnoreCase);

            // ─── בנה מפה: systemName → systemId ──────────────────────
            var catalogByName = catalog
                .Where(c => !string.IsNullOrWhiteSpace(c.Name))
                .GroupBy(c => (c.Name ?? "").Trim().ToLowerInvariant(),
                    StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g.First(),
                    StringComparer.OrdinalIgnoreCase);


            // ─── מצא מערכות מקושרות לשרתים שנמצאו ───────────────────
            var matchedSystems = new List<object>();
            var addedSystemIds = new HashSet<string>();

            // ─── שרת ראשון שנמצא (לתצוגה ב-banner) ──────────────────
            var firstServer = matchedServers.First();
            var serverIp    = firstServer.ScannedVia?.Split(
                new[] { ',', '|', ';' },
                StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .FirstOrDefault(x => x.StartsWith("172.22"))
                ?? firstServer.ScannedVia?.Split(
                    new[] { ',', '|', ';' },
                    StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .FirstOrDefault()
                ?? "";

            foreach (var srv in matchedServers)
            {
                SystemCatalogRecord? catRecord = null;

                // ─── חפש לפי מספר קטלוג (עדיפות) ────────────────────
                if (!string.IsNullOrWhiteSpace(srv.CatalogNumber))
                {
                    catalogByNumber.TryGetValue(
                        srv.CatalogNumber.Trim(), out catRecord);
                }

                // ─── fallback: חפש לפי שם מערכת ──────────────────────
                if (catRecord == null && !string.IsNullOrWhiteSpace(srv.SystemName))
                {
                    var sysNameKey = srv.SystemName.Trim().ToLowerInvariant();
                    catalogByName.TryGetValue(sysNameKey, out catRecord);
                }

                if (catRecord == null) continue;
                if (addedSystemIds.Contains(catRecord.Id)) continue;

                addedSystemIds.Add(catRecord.Id);

                matchedSystems.Add(new
                {
                    systemId      = catRecord.Id,
                    systemName    = catRecord.Name,
                    systemNumber  = catRecord.Number,
                    serverName    = srv.Name,
                    serverIp      = srv.ScannedVia,
                    catalogNumber = srv.CatalogNumber
                });
            }

            return Json(new
            {
                success        = true,
                matchedSystems = matchedSystems,
                serverName     = firstServer.Name,
                serverIp       = serverIp,
                totalServers   = matchedServers.Count,
                totalSystems   = matchedSystems.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: BigFix Status Proxy ─────────────────────────────
    /// <summary>
    /// Proxy לשרת BigFix - מחזיר סטטוס Pending Restart
    /// לכל השרתים בקבוצות Windows Servers Prod/NP Nir
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetBigFixStatus()
    {
        try
        {
            // ─── קרא הגדרות מ-appsettings ────────────────────────
            var username = _secrets.BigFixUsername;
            var password = _secrets.BigFixPassword;
            var baseUrl  = _secrets.BigFixUrl;

            const string query = 
                "?output=json" +
                "&relevance=((name%20of%20it%20as%20string%20|%20%22Not%20Reported%22%2C" +
                "%20(%20concatenation%20%22%22%20of%20substrings%20separated%20by%20%22%2C%22" +
                "%20of%20it)%20of%20(%20last%20report%20time%20of%20it%20as%20string)%20|" +
                "%20%22Not%20Reported%22%2Cvalue%20of%20result%20from%20(bes%20property" +
                "%20%22Pending%20Restart%20v.2.0%22)%20of%20it%20|%20%22Not%20Reported%22%2C" +
                "%20%20value%20of%20result%20from%20(bes%20property%20%22Critical%20Updates" +
                "%20Servers%22)%20of%20it%20|%20%22Not3%20Reported%22%2C%20value%20of%20result" +
                "%20from%20(bes%20property%20%22Grafana%20Critical%20Update%20Servers%22)%20of" +
                "%20it%20|%20%22Not2%20Reported%22)%20of%20members%20of%20bes%20computer%20groups" +
                "%20whose%20(%20name%20of%20it%20%3D%20%22Windows%20Servers%20Prod%20Nir%22%20or" +
                "%20name%20of%20it%20%3D%20%22Windows%20Servers%20NP%20Nir%22))";
            
            var bigFixUrl = baseUrl+query;
            // ─── HttpClient עם bypass SSL (שרת פנימי) ────────
            var handler = new HttpClientHandler
            {
                // ← שרת BigFix פנימי - עוקפים אימות SSL
                ServerCertificateCustomValidationCallback = (_, _, _, _) => true
            };

            using var client = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromSeconds(30)
            };

            // ─── Basic Auth ───────────────────────────────────
            var credentials = Convert.ToBase64String(
                Encoding.UTF8.GetBytes($"{username}:{password}"));
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Basic", credentials);

            // ─── שלח בקשה ────────────────────────────────────
            var response = await client.GetAsync(bigFixUrl);

            if (!response.IsSuccessStatusCode)
            {
                return Json(new
                {
                    success = false,
                    error   = $"BigFix החזיר: {(int)response.StatusCode}"
                });
            }

            var content = await response.Content.ReadAsStringAsync();

            // ─── פרסר את התגובה ──────────────────────────────
            // מבנה: {"result":[["serverName","lastReport","pendingRestart",...],...]}
            using var doc = JsonDocument.Parse(content);
            var resultArr = doc.RootElement
                .GetProperty("result");

            var statusMap = new Dictionary<string, BigFixServerStatus>(
                StringComparer.OrdinalIgnoreCase);

            foreach (var item in resultArr.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Array) continue;

                var arr = item.EnumerateArray().ToList();
                if (arr.Count < 3) continue;

                // ─── חלץ שם שרת (הסר דומיין) ─────────────────
                var rawName = arr[0].GetString() ?? "";
                var dotIdx  = rawName.IndexOf('.');
                var name    = dotIdx > 0
                    ? rawName.Substring(0, dotIdx)
                    : rawName;

                var lastReport     = arr.Count > 1
                    ? arr[1].GetString() ?? "" : "";
                var pendingRestart = arr.Count > 2
                    ? arr[2].GetString() ?? "" : "";
                var criticalUpdates = arr.Count > 3
                    ? arr[3].GetString() ?? "" : "";
                var grafanaUpdates  = arr.Count > 4
                    ? arr[4].GetString() ?? "" : "";

                // ─── נרמל "Not3 Reported" / "Not2 Reported" ──
                if (criticalUpdates == "Not3 Reported")
                    criticalUpdates = "";
                if (grafanaUpdates  == "Not2 Reported")
                    grafanaUpdates  = "";

                statusMap[name] = new BigFixServerStatus
                {
                    Name            = name,
                    LastReport      = lastReport,
                    PendingRestart  = pendingRestart,
                    CriticalUpdates = criticalUpdates,
                    GrafanaUpdates  = grafanaUpdates
                };
            }

            return Json(new
            {
                success   = true,
                count     = statusMap.Count,
                statusMap = statusMap.Values.ToList()
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ─── POST: BigFix Status לשרתים נבחרים ──────────────────────
    /// <summary>
    /// מקבל רשימת שמות שרתים ומחזיר את סטטוס BigFix
    /// עבורם בלבד - פנייה ישירה לשרת BigFix.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> GetBigFixStatusForServers(
        [FromBody] GetBigFixForServersRequest request)
    {
        try
        {
            if (request?.ServerNames == null || !request.ServerNames.Any())
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו שמות שרתים"
                });

            // ─── קרא הגדרות ──────────────────────────────────────
            var username = _secrets.BigFixUsername;
            var password = _secrets.BigFixPassword;
            var baseUrl  = _secrets.BigFixUrl;

            const string query =
                "?output=json" +
                "&relevance=((name%20of%20it%20as%20string%20|%20%22Not%20Reported%22%2C" +
                "%20(%20concatenation%20%22%22%20of%20substrings%20separated%20by%20%22%2C%22" +
                "%20of%20it)%20of%20(%20last%20report%20time%20of%20it%20as%20string)%20|" +
                "%20%22Not%20Reported%22%2Cvalue%20of%20result%20from%20(bes%20property" +
                "%20%22Pending%20Restart%20v.2.0%22)%20of%20it%20|%20%22Not%20Reported%22%2C" +
                "%20%20value%20of%20result%20from%20(bes%20property%20%22Critical%20Updates" +
                "%20Servers%22)%20of%20it%20|%20%22Not3%20Reported%22%2C%20value%20of%20result" +
                "%20from%20(bes%20property%20%22Grafana%20Critical%20Update%20Servers%22)%20of" +
                "%20it%20|%20%22Not2%20Reported%22)%20of%20members%20of%20bes%20computer%20groups" +
                "%20whose%20(%20name%20of%20it%20%3D%20%22Windows%20Servers%20Prod%20Nir%22%20or" +
                "%20name%20of%20it%20%3D%20%22Windows%20Servers%20NP%20Nir%22))";

            var bigFixUrl = baseUrl + query;

            // ─── HttpClient עם bypass SSL ─────────────────────────
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (_, _, _, _) => true
            };

            using var client = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromSeconds(30)
            };

            var credentials = Convert.ToBase64String(
                Encoding.UTF8.GetBytes($"{username}:{password}"));
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Basic", credentials);

            // ─── שלח בקשה ל-BigFix ───────────────────────────────
            var response = await client.GetAsync(bigFixUrl);

            if (!response.IsSuccessStatusCode)
                return Json(new
                {
                    success = false,
                    error   = $"BigFix החזיר: {(int)response.StatusCode}"
                });

            var content = await response.Content.ReadAsStringAsync();

            // ─── פרסר תגובה ──────────────────────────────────────
            using var doc       = JsonDocument.Parse(content);
            var       resultArr = doc.RootElement.GetProperty("result");

            // ─── בנה מפה מלאה מ-BigFix ───────────────────────────
            var allBigFix = new Dictionary<string, BigFixServerStatus>(
                StringComparer.OrdinalIgnoreCase);

            foreach (var item in resultArr.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Array) continue;

                var arr = item.EnumerateArray().ToList();
                if (arr.Count < 3) continue;

                var rawName = arr[0].GetString() ?? "";
                var dotIdx  = rawName.IndexOf('.');
                var name    = dotIdx > 0
                    ? rawName.Substring(0, dotIdx)
                    : rawName;

                var lastReport      = arr.Count > 1
                    ? arr[1].GetString() ?? "" : "";
                var pendingRestart  = arr.Count > 2
                    ? arr[2].GetString() ?? "" : "";
                var criticalUpdates = arr.Count > 3
                    ? arr[3].GetString() ?? "" : "";
                var grafanaUpdates  = arr.Count > 4
                    ? arr[4].GetString() ?? "" : "";

                if (criticalUpdates == "Not3 Reported") criticalUpdates = "";
                if (grafanaUpdates  == "Not2 Reported") grafanaUpdates  = "";

                // ─── שמור גם עם שם מלא (עם דומיין) ─────────────
                allBigFix[rawName.ToLower()] = new BigFixServerStatus
                {
                    Name            = rawName,
                    LastReport      = lastReport,
                    PendingRestart  = pendingRestart,
                    CriticalUpdates = criticalUpdates,
                    GrafanaUpdates  = grafanaUpdates
                };

                // ─── שמור גם ללא דומיין ──────────────────────────
                if (dotIdx > 0)
                {
                    var shortKey = name.ToLower();
                    if (!allBigFix.ContainsKey(shortKey))
                    {
                        allBigFix[shortKey] = new BigFixServerStatus
                        {
                            Name            = name,
                            LastReport      = lastReport,
                            PendingRestart  = pendingRestart,
                            CriticalUpdates = criticalUpdates,
                            GrafanaUpdates  = grafanaUpdates
                        };
                    }
                }
            }

            // ─── סנן רק את השרתים המבוקשים ──────────────────────
            var requestedNames = request.ServerNames
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Select(n => n.Trim())
                .ToList();

            var statusMap = new List<BigFixServerStatus>();

            foreach (var serverName in requestedNames)
            {
                var key      = serverName.ToLower();
                var shortKey = StripDomainStatic(serverName).ToLower();

                // ─── חפש לפי שם מלא, אחר כך ללא דומיין ──────────
                BigFixServerStatus? found = null;

                if (allBigFix.TryGetValue(key, out var byFull))
                    found = byFull;
                else if (allBigFix.TryGetValue(shortKey, out var byShort))
                    found = byShort;

                if (found != null)
                {
                    statusMap.Add(found);
                }
                // ─── אם לא נמצא - לא מוסיפים (הלקוח יזהה כ"לא ב-BigFix") ──
            }

            return Json(new
            {
                success   = true,
                count     = statusMap.Count,
                requested = requestedNames.Count,
                statusMap = statusMap
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ─── עזרים ────────────────────────────────────────────────
    private string SimplifyOs(string os)
    {
        if (string.IsNullOrEmpty(os))                       return "לא ידוע";
        if (os.Contains("2022"))                            return "Windows 2022";
        if (os.Contains("2019"))                            return "Windows 2019";
        if (os.Contains("2016"))                            return "Windows 2016";
        if (os.Contains("2012"))                            return "Windows 2012";
        if (os.Contains("2008"))                            return "Windows 2008";
        if (os.Contains("Linux") || os.Contains("linux"))  return "Linux";
        if (os.Contains("Ubuntu"))                          return "Ubuntu";
        if (os.Contains("Red Hat") || os.Contains("RHEL")) return "RHEL";
        if (os.Contains("Windows"))                         return "Windows (אחר)";
        return "אחר";
    }

    private List<ServerRecord> LoadFromJson()
    {
        lock (_fileLock)
        {
            if (!System.IO.File.Exists(_jsonStorePath))
                return new List<ServerRecord>();

            var json = System.IO.File.ReadAllText(
                _jsonStorePath, Encoding.UTF8);
            
            var servers = JsonSerializer.Deserialize<List<ServerRecord>>(json)
                        ?? new List<ServerRecord>();

            // ─── נרמל ערכי סביבה ישנים ───────────────────────────
            bool needsSave = false;
            foreach (var srv in servers)
            {
                var normalized = NormalizeEnvironment(srv.Environment);
                if (normalized != srv.Environment)
                {
                    srv.Environment = normalized;
                    needsSave = true;
                }
            }

            // ─── שמור אם היו שינויים ─────────────────────────────
            if (needsSave)
            {
                var updatedJson = JsonSerializer.Serialize(servers,
                    new JsonSerializerOptions { WriteIndented = true });
                System.IO.File.WriteAllText(
                    _jsonStorePath, updatedJson, Encoding.UTF8);
            }

            return servers;
        }
    }

    private void SaveToJson(List<ServerRecord> servers)
    {
        lock (_fileLock)
        {
            var dir = Path.GetDirectoryName(_jsonStorePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(servers,
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

    // ─── POST: הוסף שרתים חסרים ל-JSON ───────────────────────────────
    [HttpPost]
    public IActionResult AddMissingServers(
        [FromBody] AddMissingServersRequest request)
    {
        try
        {
            if (request?.Servers == null || request.Servers.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "לא נשלחו שרתים להוספה"
                });

            var existingServers = LoadFromJson();

            var existingNames = new HashSet<string>(
                existingServers.Select(s =>
                    StripDomainStatic(s.Name ?? "")
                        .ToLowerInvariant()),
                StringComparer.OrdinalIgnoreCase);

            var added   = new List<string>();
            var skipped = new List<string>();

            foreach (var srv in request.Servers)
            {
                var nameClean = StripDomainStatic(srv.Name ?? "")
                    .ToLowerInvariant();

                if (existingNames.Contains(nameClean))
                {
                    skipped.Add(srv.Name ?? "");
                    continue;
                }

                existingServers.Add(new ServerRecord
                {
                    Id             = $"srv_{Guid.NewGuid():N}",
                    Name           = StripDomainStatic(srv.Name ?? ""),
                    OS             = srv.OS             ?? "",
                    HardwareVendor = srv.HardwareVendor ?? "",
                    IsVirtual      = NormalizeVirtual(srv.IsVirtual),
                    ScannedVia     = srv.ScannedVia     ?? "",
                    Environment    = srv.Environment    ?? "",
                    SystemName     = srv.SystemName     ?? "",
                    CatalogNumber  = srv.CatalogNumber  ?? "",
                    SystemManager  = srv.SystemManager  ?? "",
                    BootType       = srv.BootType       ?? "",
                    IsHealthy      = "",
                    Notes          = "",
                    // ← חדש: שדות מהמיפוי
                    PrimaryIP      = srv.PrimaryIP      ?? "",
                    ServerStatusVC = srv.ServerStatusVC ?? "",
                    SystemStatus   = srv.SystemStatus   ?? "",
                    Department     = srv.Department     ?? "",
                    Team           = srv.Team           ?? "",
                    Domain         = srv.Domain         ?? "",
                    CanShutdown    = srv.CanShutdown     ?? "",
                    Env            = srv.Env             ?? "",
                    DataApproved   = srv.DataApproved   ?? "",
                    MappingNotes   = srv.MappingNotes   ?? "",
                    AuxSystem      = srv.AuxSystem      ?? "",
                    HasMappingData = !string.IsNullOrEmpty(srv.SystemName) ||
                                    !string.IsNullOrEmpty(srv.SystemManager),
                    ImportedAt     = DateTime.Now
                        .ToString("yyyy-MM-dd HH:mm"),
                    LastUpdated    = null,
                    UpdatedBy      = GetCurrentUsername()
                });

                existingNames.Add(nameClean);
                added.Add(srv.Name ?? "");
            }

            SaveToJson(existingServers);

            return Json(new
            {
                success      = true,
                addedCount   = added.Count,
                skippedCount = skipped.Count,
                addedNames   = added,
                skippedNames = skipped,
                totalNow     = existingServers.Count,
                message      = $"נוספו {added.Count} שרתים" +
                            (skipped.Count > 0
                                ? $" | {skipped.Count} כבר קיימים"
                                : "")
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ─── GET: מצא שרתים חסרים ב-JSON ─────────────────────────────
    [HttpGet]
    public IActionResult FindMissingServers()
    {
        try
        {
            var prodPatches = ReadPatchesFile(
                _prodPatchesPath, "PROD");

            var nonProdPatches = ReadPatchesFile(
                _nonProdPatchesPath, "NONPROD");

            var prodOnly = ReadProdOnlyXlsx(_prodOnlyPath);

            var serverProd = System.IO.File.Exists(_serverProdPath)
                ? ReadServerProdFile(_serverProdPath)
                : new Dictionary<string, ServerProdRecord>(
                    StringComparer.OrdinalIgnoreCase);

            var mappingData = System.IO.File.Exists(_mappingPath)
                ? ReadMappingFile(_mappingPath)
                : new Dictionary<string, MappingRecord>(
                    StringComparer.OrdinalIgnoreCase);

            var allFromFiles = MergeAllSources(
                prodPatches,
                nonProdPatches,
                prodOnly,
                serverProd,
                mappingData);

            var existingServers = LoadFromJson();
            var existingNames   = new HashSet<string>(
                existingServers.Select(s =>
                    StripDomainStatic(s.Name ?? "")
                        .ToLowerInvariant()),
                StringComparer.OrdinalIgnoreCase);

            // ← שינוי: List<MissingServerInfo> במקום List<object>
            var missing = new List<MissingServerInfo>();

            foreach (var kvp in allFromFiles)
            {
                if (existingNames.Contains(kvp.Key)) continue;

                var info = kvp.Value;

                bool hasMappingData =
                    !string.IsNullOrEmpty(info.SystemName)    ||
                    !string.IsNullOrEmpty(info.SystemManager) ||
                    !string.IsNullOrEmpty(info.Department)    ||
                    !string.IsNullOrEmpty(info.Team)          ||
                    !string.IsNullOrEmpty(info.CatalogNumber);

                bool hasVendor =
                    !string.IsNullOrWhiteSpace(info.HardwareVendor) &&
                    !info.HardwareVendor.Equals("None",
                        StringComparison.OrdinalIgnoreCase);

                if (!hasVendor && !hasMappingData)
                    continue;

                // ← שינוי: צור MissingServerInfo במקום anonymous type
                missing.Add(new MissingServerInfo
                {
                    Name           = info.Name,
                    OS             = info.OS             ?? "",
                    HardwareVendor = info.HardwareVendor ?? "",
                    IsVirtual      = info.IsVirtual      ?? "",
                    ScannedVia     = info.ScannedVia     ?? "",
                    Environment    = info.Environment    ?? "",
                    SystemAdmin    = info.SystemAdmin    ?? "",
                    BootType       = info.BootType       ?? "",
                    SystemName     = info.SystemName     ?? "",
                    CatalogNumber  = info.CatalogNumber  ?? "",
                    SystemManager  = info.SystemManager  ?? "",
                    Department     = info.Department     ?? "",
                    Team           = info.Team           ?? "",
                    Domain         = info.Domain         ?? "",
                    CanShutdown    = info.CanShutdown     ?? "",
                    Env            = info.Env            ?? "",
                    PrimaryIP      = info.PrimaryIP      ?? "",
                    ServerStatusVC = info.ServerStatusVC ?? "",
                    SystemStatus   = info.SystemStatus   ?? "",
                    DataApproved   = info.DataApproved   ?? "",
                    MappingNotes   = info.MappingNotes   ?? "",
                    AuxSystem      = info.AuxSystem      ?? "",
                    Sources        = string.Join(", ", info.Sources)
                });
            }

            // ← עכשיו המיון עובד כי זו מחלקה אמיתית
            var sortedMissing = missing
                .OrderByDescending(x => x.Environment == "PROD")
                .ThenBy(x => x.Name)
                .ToList();

            return Json(new
            {
                success        = true,
                missingCount   = sortedMissing.Count,
                existingCount  = existingServers.Count,
                sourceStats    = new
                {
                    serverProd     = serverProd.Count,
                    prodPatches    = prodPatches.Count,
                    nonProdPatches = nonProdPatches.Count,
                    prodOnly       = prodOnly.Count,
                    mapping        = mappingData.Count,
                    totalUnique    = allFromFiles.Count
                },
                missingServers = sortedMissing
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message,
                stack   = ex.StackTrace
            });
        }
    }

    // ─── מזג את כל מקורות הנתונים ────────────────────────────────
    /// <summary>
    /// מאחד את כל הקבצים למבנה אחד.
    ///
    /// עדיפות סביבה (מגבוה לנמוך):
    ///   1. PROD_ONLY      → תמיד PROD (override חזק)
    ///   2. PROD patches   → PROD
    ///   3. NONPROD patches→ NONPROD (לא דורס PROD)
    ///   4. SERVER_PROD    → ברירת מחדל NONPROD
    /// </summary>
   // ─── מזג את כל מקורות הנתונים ────────────────────────────────────
    private Dictionary<string, MergedServerInfo> MergeAllSources(
        Dictionary<string, PatchesServerRecord>  prodPatches,
        Dictionary<string, PatchesServerRecord>  nonProdPatches,
        HashSet<string>                          prodOnly,
        Dictionary<string, ServerProdRecord>     serverProd,
        Dictionary<string, MappingRecord>        mappingData)  
    {
        var merged = new Dictionary<string, MergedServerInfo>(
            StringComparer.OrdinalIgnoreCase);

        // ── עזר: קבל או צור רשומה ────────────────────────────────
        MergedServerInfo GetOrCreate(string key, string name)
        {
            if (!merged.TryGetValue(key, out var info))
            {
                info = new MergedServerInfo { Name = name };
                merged[key] = info;
            }
            if (string.IsNullOrEmpty(info.Name) || info.Name == key)
                info.Name = name;
            return info;
        }

        // ── שלב 1: SERVER_PROD__NONPROD (XLSX) - בסיס ────────────
        foreach (var kvp in serverProd)
        {
            if (!string.IsNullOrEmpty(kvp.Value.HardwareVendor) &&
                kvp.Value.HardwareVendor.Equals(
                    "None", StringComparison.OrdinalIgnoreCase))
                continue;

            var key  = kvp.Key.ToLowerInvariant();
            var info = GetOrCreate(key, kvp.Value.Name);

            info.OS             = kvp.Value.OS;
            info.HardwareVendor = kvp.Value.HardwareVendor;
            info.IsVirtual      = kvp.Value.IsVirtual;
            info.ScannedVia     = kvp.Value.ScannedVia;
            info.Sources.Add("SERVER_PROD");

            if (string.IsNullOrEmpty(info.Environment))
                info.Environment = "NONPROD";
        }

        // ── שלב 2: PROD patches ───────────────────────────────────
        foreach (var kvp in prodPatches)
        {
            var key  = kvp.Key.ToLowerInvariant();
            var info = GetOrCreate(key, kvp.Value.Name);

            info.Environment = "PROD";
            info.Sources.Add("PROD_PATCHES");

            if (string.IsNullOrEmpty(info.SystemAdmin))
                info.SystemAdmin = kvp.Value.SystemAdmin;
            if (string.IsNullOrEmpty(info.BootType))
                info.BootType = kvp.Value.BootType;
        }

        // ── שלב 3: NONPROD patches ───────────────────────────────
        foreach (var kvp in nonProdPatches)
        {
            var key  = kvp.Key.ToLowerInvariant();
            var info = GetOrCreate(key, kvp.Value.Name);

            if (string.IsNullOrEmpty(info.Environment))
                info.Environment = "NONPROD";
            else if (info.Environment != "PROD")
                info.Environment = "NONPROD";

            info.Sources.Add("NONPROD_PATCHES");

            if (string.IsNullOrEmpty(info.SystemAdmin))
                info.SystemAdmin = kvp.Value.SystemAdmin;
            if (string.IsNullOrEmpty(info.BootType))
                info.BootType = kvp.Value.BootType;
        }

        // ── שלב 4: PROD_ONLY - override חזק ─────────────────────
        foreach (var key in prodOnly)
        {
            if (merged.TryGetValue(key, out var info))
            {
                info.Environment = "PROD";
                info.Sources.Add("PROD_ONLY");
            }
            else
            {
                merged[key] = new MergedServerInfo
                {
                    Name        = key,
                    Environment = "PROD",
                    Sources     = new List<string> { "PROD_ONLY" }
                };
            }
        }

        // ── שלב 5: מיפוי שרתים למערכות ארגוניות ─────────────────────
        foreach (var kvp in mappingData)
        {
            var vmName = kvp.Value.VM;
            if (string.IsNullOrWhiteSpace(vmName)) continue;

            var key = StripDomainStatic(vmName).ToLowerInvariant();
            if (string.IsNullOrEmpty(key)) continue;

            // ← נסה למצוא לפי IP אם השם לא נמצא
            if (!merged.ContainsKey(key))
            {
                var primaryIP = kvp.Value.PrimaryIP?.Trim() ?? "";
                if (!string.IsNullOrEmpty(primaryIP))
                {
                    var matchByIP = merged.Values.FirstOrDefault(m =>
                        !string.IsNullOrEmpty(m.ScannedVia) &&
                        m.ScannedVia.Trim() == primaryIP);

                    if (matchByIP != null)
                    {
                        EnrichFromMapping(matchByIP, kvp.Value);

                        if (!merged.ContainsKey(key))
                            merged[key] = matchByIP;

                        continue;
                    }
                }
            }

            bool isNewRecord = !merged.ContainsKey(key);

            var info = GetOrCreate(key, StripDomainStatic(vmName));
            EnrichFromMapping(info, kvp.Value);

            // ← חדש: אם הרשומה חדשה (לא הגיעה מ-SERVER_PROD)
            // שים HardwareVendor = "NOT_FOUND"
            if (isNewRecord && string.IsNullOrEmpty(info.HardwareVendor))
                info.HardwareVendor = "NOT_FOUND";
        }

        return merged;
    }

    // ─── עזר: העשר רשומה ממיפוי ──────────────────────────────────
    private void EnrichFromMapping(
        MergedServerInfo info,
        MappingRecord    mapping)
    {
        if (string.IsNullOrEmpty(info.OS) &&
            !string.IsNullOrEmpty(mapping.MappingOS))
            info.OS = mapping.MappingOS;

        if (string.IsNullOrEmpty(info.ScannedVia) &&
            !string.IsNullOrEmpty(mapping.PrimaryIP))
            info.ScannedVia = mapping.PrimaryIP;

        if (string.IsNullOrEmpty(info.PrimaryIP))
            info.PrimaryIP = mapping.PrimaryIP ?? "";

        if (string.IsNullOrEmpty(info.SystemName))
            info.SystemName = mapping.SystemName ?? "";

        if (string.IsNullOrEmpty(info.CatalogNumber))
            info.CatalogNumber = mapping.CatalogNumber ?? "";

        if (string.IsNullOrEmpty(info.SystemManager))
            info.SystemManager = mapping.SystemManager ?? "";

        if (string.IsNullOrEmpty(info.Department))
            info.Department = mapping.Department ?? "";

        if (string.IsNullOrEmpty(info.Team))
            info.Team = mapping.Team ?? "";

        if (string.IsNullOrEmpty(info.Domain))
            info.Domain = mapping.Domain ?? "";

        if (string.IsNullOrEmpty(info.CanShutdown))
            info.CanShutdown = mapping.CanShutdown ?? "";

        if (string.IsNullOrEmpty(info.Env))
            info.Env = mapping.Env ?? "";

        if (string.IsNullOrEmpty(info.ServerStatusVC))
            info.ServerStatusVC = mapping.ServerStatusVC ?? "";

        if (string.IsNullOrEmpty(info.SystemStatus))
            info.SystemStatus = mapping.Status ?? "";

        if (string.IsNullOrEmpty(info.DataApproved))
            info.DataApproved = mapping.DataApproved ?? "";

        if (string.IsNullOrEmpty(info.MappingNotes))
            info.MappingNotes = mapping.MappingNotes ?? "";

        if (string.IsNullOrEmpty(info.AuxSystem))
            info.AuxSystem = mapping.AuxSystem ?? "";

        // סביבה מהמיפוי - רק אם לא נקבעה
        if (string.IsNullOrEmpty(info.Environment) &&
            !string.IsNullOrEmpty(mapping.Env))
        {
            var envVal = mapping.Env.Trim().ToUpperInvariant();
            if (envVal.Contains("ייצור") ||
                (envVal.Contains("PROD") && !envVal.Contains("NON")))
                info.Environment = "PROD";
            else
                info.Environment = "NONPROD";
        }

        if (!info.Sources.Contains("MAPPING"))
            info.Sources.Add("MAPPING");
    }
    // ─── קריאת קובץ PROD/NONPROD patches ─────────────────────────
    /// <summary>
    /// קורא קובץ XLSX של פאצים (PROD או NONPROD).
    /// מבנה: cols[0]=Name | cols[4]=מנהל מערכת | cols[5]=סוג אתחול
    /// </summary>
    private Dictionary<string, PatchesServerRecord> ReadPatchesFile(
        string filePath,
        string defaultEnv)
    {
        var result = new Dictionary<string, PatchesServerRecord>(
            StringComparer.OrdinalIgnoreCase);

        if (!System.IO.File.Exists(filePath))
        {
            System.Diagnostics.Debug.WriteLine(
                $"[WARN] קובץ לא נמצא: {filePath}");
            return result;
        }

        try
        {
            var dt = ReadXlsxToDataTable(filePath);

            // ── מצא אינדקסי עמודות לפי כותרת ────────────────────
            // תמיכה בכותרות עברית ואנגלית
            int nameIdx  = FindColumnIndex(dt,
                "name", "שם", "שם שרת", "server name");
            int adminIdx = FindColumnIndex(dt,
                "מנהל מערכת", "system admin", "admin");
            int bootIdx  = FindColumnIndex(dt,
                "סוג אתחול", "boot type", "reboot");

            // אם לא נמצאה עמודת שם - נסה עמודה 0
            if (nameIdx < 0) nameIdx = 0;

            foreach (DataRow row in dt.Rows)
            {
                var rawName = row[nameIdx]?.ToString()?.Trim() ?? "";
                if (string.IsNullOrWhiteSpace(rawName)) continue;

                var name = StripDomainStatic(rawName);
                var key  = name.ToLowerInvariant();

                if (result.ContainsKey(key)) continue;

                result[key] = new PatchesServerRecord
                {
                    Name        = name,
                    Environment = defaultEnv,
                    SystemAdmin = adminIdx >= 0
                        ? row[adminIdx]?.ToString()?.Trim() ?? ""
                        : "",
                    BootType    = bootIdx >= 0
                        ? row[bootIdx]?.ToString()?.Trim() ?? ""
                        : ""
                };
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine(
                $"[Error] קריאת patches {filePath}: {ex.Message}");
        }

        return result;
    }

    // ─── קריאת PROD_ONLY XLSX ─────────────────────────────────────
    /// <summary>
    /// קורא PROD_ONLY.xlsx - רק שמות שרתים, עמודה ראשונה.
    /// כל שרת ברשימה זו הוא PROD בהגדרה.
    /// </summary>
    private HashSet<string> ReadProdOnlyXlsx(string filePath)
    {
        var result = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);

        if (!System.IO.File.Exists(filePath))
        {
            System.Diagnostics.Debug.WriteLine(
                $"[WARN] PROD_ONLY לא נמצא: {filePath}");
            return result;
        }

        try
        {
            var dt = ReadXlsxToDataTable(filePath);

            // עמודה ראשונה = שם שרת
            int nameIdx = FindColumnIndex(dt,
                "name", "שם", "שם שרת", "server name");
            if (nameIdx < 0) nameIdx = 0;

            foreach (DataRow row in dt.Rows)
            {
                var rawName = row[nameIdx]?.ToString()?.Trim() ?? "";
                if (string.IsNullOrWhiteSpace(rawName)) continue;

                var name = StripDomainStatic(rawName);
                result.Add(name.ToLowerInvariant());
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine(
                $"[Error] קריאת PROD_ONLY {filePath}: {ex.Message}");
        }

        return result;
    }

    // ─── עזר: מצא אינדקס עמודה לפי שם (case-insensitive) ─────────
    /// <summary>
    /// מחפש עמודה ב-DataTable לפי רשימת שמות אפשריים.
    /// מחזיר -1 אם לא נמצא.
    /// </summary>
    private int FindColumnIndex(DataTable dt, params string[] names)
    {
        foreach (var name in names)
        {
            for (int i = 0; i < dt.Columns.Count; i++)
            {
                if (string.Equals(
                        dt.Columns[i].ColumnName.Trim(),
                        name,
                        StringComparison.OrdinalIgnoreCase))
                    return i;
            }
        }
        return -1;
    }

    // ─── עזר סטטי: הסר דומיין ─────────────────────────────────────
    private static string StripDomainStatic(string serverName)
    {
        if (string.IsNullOrWhiteSpace(serverName))
            return serverName ?? "";

        var dotIndex = serverName.IndexOf('.');
        if (dotIndex <= 0) return serverName;

        // ── בדוק אם זה דומיין אמיתי ──────────────────────────────
        // דומיין אמיתי: אחרי הנקודה יש אותיות (domain.local / .com)
        // לא דומיין: ITA9.3.3-P1APA1 (אחרי הנקודה יש ספרה)
        var afterDot = serverName.Substring(dotIndex + 1);

        // אם מה שאחרי הנקודה מתחיל בספרה - זה לא דומיין
        if (afterDot.Length > 0 && char.IsDigit(afterDot[0]))
            return serverName;

        // אם מה שאחרי הנקודה קצר מדי (פחות מ-2 תווים) - לא דומיין
        if (afterDot.Length < 2)
            return serverName;

        // אם אין אותיות במה שאחרי הנקודה - לא דומיין
        if (!afterDot.Any(char.IsLetter))
            return serverName;

        // ── זה דומיין אמיתי - חתוך ────────────────────────────────
        return serverName.Substring(0, dotIndex);
    }

    // ─── עזר: נרמל isVirtual ──────────────────────────────────────
    private static string NormalizeVirtual(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";  // ← ריק במקום FALSE
        var v = value.Trim().ToUpperInvariant();
        return v switch
        {
            "TRUE" or "1" or "YES" or "כן" => "TRUE",
            "FALSE" or "0" or "NO" or "לא" => "FALSE",
            "UNKNOWN"                       => "UNKNOWN",
            _                               => ""  // ← ערך לא מוכר = ריק
        };
    }

    // ─── GET: בדיקת PING לשרת ────────────────────────────────────
    [HttpGet]
    public async Task<IActionResult> PingServer(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return Json(new { success = false, error = "נדרש שם שרת" });

        try
        {
            // ─── מצא את השרת ב-JSON ──────────────────────────────
            var servers = LoadFromJson();
            var server  = servers.FirstOrDefault(
                s => s.Name.Equals(name,
                    StringComparison.OrdinalIgnoreCase));

            // ─── חלץ את כל ה-IPs מהרשומה ────────────────────────
            var allIps = new List<string>();
            if (!string.IsNullOrWhiteSpace(server?.ScannedVia))
            {
                allIps = server.ScannedVia
                    .Split(new[] { '|', ',', ';' },
                        StringSplitOptions.RemoveEmptyEntries)
                    .Select(ip => ip.Trim())
                    .Where(ip => !string.IsNullOrEmpty(ip))
                    .ToList();
            }

            // ─── IP ראשי לתצוגה (עדיפות ל-172.22) ───────────────
            var storedIp = allIps
                .FirstOrDefault(x => x.StartsWith("172.22"))
                ?? allIps.FirstOrDefault()
                ?? "";

            // ════════════════════════════════════════════════════
            // שלב 1: פינג לפי שם + Reverse DNS
            // ════════════════════════════════════════════════════
            var pingByNameResult = await DoPingWithReverseDns(
                target:      name,
                targetType:  "name",
                storedName:  name,
                storedIp:    storedIp);

            // ════════════════════════════════════════════════════
            // שלב 2: אם הפינג לפי שם נכשל - נסה כל IP ברשימה
            // ════════════════════════════════════════════════════
            PingDetailedResult? pingByIpResult = null;
            string? successfulIp = null;

            if (!pingByNameResult.IsAlive && allIps.Count > 0)
            {
                foreach (var ip in allIps)
                {
                    var ipResult = await DoPingWithReverseDns(
                        target:      ip,
                        targetType:  "ip",
                        storedName:  name,
                        storedIp:    ip);

                    if (ipResult.IsAlive)
                    {
                        pingByIpResult = ipResult;
                        successfulIp   = ip;
                        break; // ← מצאנו IP שעובד - עצור
                    }

                    // ─── שמור את הניסיון האחרון גם אם נכשל ───
                    pingByIpResult = ipResult;
                }
            }

            // ════════════════════════════════════════════════════
            // שלב 3: בנה תוצאה מאוחדת
            // ════════════════════════════════════════════════════
            var finalResult = pingByNameResult.IsAlive
                ? pingByNameResult
                : pingByIpResult ?? pingByNameResult;

            var isAlive = finalResult.IsAlive;

            // ─── בנה הודעת סיכום ─────────────────────────────────
            string summary;
            if (isAlive)
            {
                var rttStr = finalResult.AvgRtt >= 0
                    ? $"{Math.Round(finalResult.AvgRtt, 0)}ms"
                    : "N/A";

                if (finalResult.TargetType == "ip")
                {
                    summary = $"✅ מגיב לפי IP ({successfulIp}) | {rttStr}";
                    
                    // ─── אם ניסינו מספר IPs - ציין כמה ───
                    if (allIps.Count > 1)
                    {
                        var triedCount = allIps.IndexOf(successfulIp!) + 1;
                        if (triedCount > 1)
                            summary += $" | ניסיון {triedCount}/{allIps.Count}";
                    }
                }
                else
                {
                    summary = $"✅ מגיב לפי שם | {rttStr}";
                }

                if (finalResult.HasMismatch)
                    summary += $" | ⚠️ אי-התאמה!";
            }
            else
            {
                if (allIps.Count == 0)
                    summary = $"❌ לא מגיב (0/3) - אין IP מוגדר";
                else if (allIps.Count == 1)
                    summary = $"❌ לא מגיב - לא לפי שם ולא לפי IP ({allIps[0]})";
                else
                    summary = $"❌ לא מגיב - נוסו {allIps.Count} כתובות IP: {string.Join(", ", allIps)}";
            }

            return Json(new
            {
                success      = true,
                serverName   = name,
                storedIp     = storedIp,
                allIps       = allIps,          // ← חדש: כל ה-IPs

                // ─── תוצאה סופית ──────────────────────────────────
                isAlive      = isAlive,
                target       = finalResult.Target,
                targetType   = finalResult.TargetType,
                successCount = finalResult.SuccessCount,
                avgRtt       = finalResult.AvgRtt >= 0
                    ? Math.Round(finalResult.AvgRtt, 1)
                    : (double?)-1,
                summary      = summary,
                successfulIp = successfulIp,    // ← חדש: ה-IP שהצליח

                // ─── Reverse DNS ───────────────────────────────────
                resolvedIp   = finalResult.ResolvedIp,
                resolvedName = finalResult.ResolvedName,

                // ─── אי-התאמות ────────────────────────────────────
                hasMismatch  = finalResult.HasMismatch,
                mismatches   = finalResult.Mismatches,

                // ─── פרטי שני הניסיונות ───────────────────────────
                pingByName   = new
                {
                    target       = name,
                    isAlive      = pingByNameResult.IsAlive,
                    successCount = pingByNameResult.SuccessCount,
                    avgRtt       = pingByNameResult.AvgRtt,
                    resolvedIp   = pingByNameResult.ResolvedIp,
                    resolvedName = pingByNameResult.ResolvedName,
                    hasMismatch  = pingByNameResult.HasMismatch,
                    mismatches   = pingByNameResult.Mismatches,
                    attempts     = pingByNameResult.Attempts
                },
                pingByIp = pingByIpResult == null ? null : new
                {
                    target       = successfulIp ?? storedIp,
                    isAlive      = pingByIpResult.IsAlive,
                    successCount = pingByIpResult.SuccessCount,
                    avgRtt       = pingByIpResult.AvgRtt,
                    resolvedIp   = pingByIpResult.ResolvedIp,
                    resolvedName = pingByIpResult.ResolvedName,
                    hasMismatch  = pingByIpResult.HasMismatch,
                    mismatches   = pingByIpResult.Mismatches,
                    attempts     = pingByIpResult.Attempts
                }
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success    = false,
                serverName = name,
                error      = ex.Message
            });
        }
    }

    [HttpPost]
    public IActionResult RenameServer([FromBody] RenameServerRequest request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            var oldName = request?.OldName?.Trim() ?? "";
            var newName = request?.NewName?.Trim() ?? "";

            if (string.IsNullOrWhiteSpace(oldName))
                return Json(new { success = false, error = "שם ישן נדרש" });

            if (string.IsNullOrWhiteSpace(newName))
                return Json(new { success = false, error = "שם חדש נדרש" });

            if (oldName.Equals(newName, StringComparison.OrdinalIgnoreCase))
                return Json(new { success = false, error = "השם החדש זהה לישן" });

            // ── תווים לא חוקיים בשם שרת ──────────────────────────
            var invalidChars = new[] { '/', '\\', ':', '*', '?', '"', '<', '>', '|', ' ' };
            if (newName.Any(c => invalidChars.Contains(c)))
                return Json(new
                {
                    success = false,
                    error   = "שם שרת לא יכול להכיל: / \\ : * ? \" < > | רווח"
                });

            if (newName.Length > 63)
                return Json(new
                {
                    success = false,
                    error   = "שם שרת לא יכול לעלות על 63 תווים"
                });

            var servers = LoadFromJson();

            // ── בדוק שהשם הישן קיים ──────────────────────────────
            var server = servers.FirstOrDefault(s =>
                s.Name.Equals(oldName, StringComparison.OrdinalIgnoreCase));

            if (server == null)
                return Json(new { success = false, error = "שרת לא נמצא" });

            // ── בדוק שהשם החדש לא תפוס ───────────────────────────
            var nameExists = servers.Any(s =>
                !s.Name.Equals(oldName, StringComparison.OrdinalIgnoreCase) &&
                s.Name.Equals(newName, StringComparison.OrdinalIgnoreCase));

            if (nameExists)
                return Json(new
                {
                    success = false,
                    error   = $"שרת בשם '{newName}' כבר קיים"
                });

            // ── שנה את השם ────────────────────────────────────────
            var oldNameSaved = server.Name;
            server.Name        = newName;
            server.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            server.UpdatedBy   = GetCurrentUsername();

            // ── הוסף הערה על שינוי השם ───────────────────────────
            var renameNote = $"[שינוי שם: {oldNameSaved} → {newName} " +
                            $"| {server.LastUpdated}]";

            server.Notes = string.IsNullOrWhiteSpace(server.Notes)
                ? renameNote
                : $"{renameNote}\n{server.Notes}";

            SaveToJson(servers);

            return Json(new
            {
                success = true,
                server  = server,
                oldName = oldNameSaved,
                newName = newName,
                message = $"שרת שונה מ-'{oldNameSaved}' ל-'{newName}'"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ════════════════════════════════════════════════════════════
    // עזר: בצע פינג + Reverse DNS + בדוק אי-התאמות
    // ════════════════════════════════════════════════════════════
    private async Task<PingDetailedResult> DoPingWithReverseDns(
        string target,
        string targetType,   // "name" | "ip"
        string storedName,
        string storedIp)
    {
        var result = new PingDetailedResult
        {
            Target     = target,
            TargetType = targetType
        };

        using var ping    = new System.Net.NetworkInformation.Ping();
        var       options = new System.Net.NetworkInformation.PingOptions
        {
            DontFragment = true,
            Ttl          = 64
        };

        // ─── שלח 3 ניסיונות פינג ─────────────────────────────────
        for (int i = 0; i < 3; i++)
        {
            try
            {
                var reply = await ping.SendPingAsync(
                    target,
                    timeout:  2000,
                    buffer:   new byte[32],
                    options:  options);

                var attempt = new PingAttemptResult
                {
                    Attempt   = i + 1,
                    Status    = reply.Status.ToString(),
                    RoundTrip = reply.Status ==
                        System.Net.NetworkInformation.IPStatus.Success
                        ? reply.RoundtripTime : -1,
                    IsSuccess = reply.Status ==
                        System.Net.NetworkInformation.IPStatus.Success
                };

                // ─── שמור את ה-IP שהוחזר מהפינג ─────────────────
                if (attempt.IsSuccess &&
                    string.IsNullOrEmpty(result.ResolvedIp))
                {
                    result.ResolvedIp = reply.Address?.ToString() ?? "";
                }

                result.Attempts.Add(attempt);
            }
            catch (Exception ex)
            {
                result.Attempts.Add(new PingAttemptResult
                {
                    Attempt   = i + 1,
                    Status    = ex.Message,
                    RoundTrip = -1,
                    IsSuccess = false
                });
            }

            if (i < 2) await Task.Delay(300);
        }

        // ─── חשב סיכום ───────────────────────────────────────────
        result.SuccessCount = result.Attempts.Count(a => a.IsSuccess);
        result.IsAlive      = result.SuccessCount > 0;

        var rtts = result.Attempts
            .Where(a => a.RoundTrip >= 0)
            .Select(a => (double)a.RoundTrip)
            .ToList();

        result.AvgRtt = rtts.Count > 0 ? rtts.Average() : -1;

        // ════════════════════════════════════════════════════════
        // Reverse DNS - שקול ל-ping -a
        // קבל שם מה-IP שהוחזר
        // ════════════════════════════════════════════════════════
        if (!string.IsNullOrEmpty(result.ResolvedIp))
        {
            try
            {
                var hostEntry = await System.Net.Dns.GetHostEntryAsync(
                    result.ResolvedIp);

                // ─── שם מלא מה-DNS ────────────────────────────────
                result.ResolvedName = hostEntry.HostName ?? "";

                // ─── הסר דומיין לצורך השוואה ─────────────────────
                var resolvedShortName = StripDomainStatic(result.ResolvedName);

                // ─── אם פינגנו לפי שם - קבל גם את ה-IP שנפתר ────
                if (targetType == "name" &&
                    string.IsNullOrEmpty(result.ResolvedIp))
                {
                    // נסה לפתור שם → IP
                    try
                    {
                        var dnsEntry = await System.Net.Dns.GetHostEntryAsync(
                            target);
                        result.ResolvedIp = dnsEntry.AddressList
                            .FirstOrDefault(
                                a => a.AddressFamily ==
                                    System.Net.Sockets.AddressFamily.InterNetwork)
                            ?.ToString() ?? "";
                    }
                    catch { /* DNS לא פתר */ }
                }

                // ════════════════════════════════════════════════
                // בדוק אי-התאמות
                // ════════════════════════════════════════════════
                var mismatches = new List<string>();

                // ─── השוואה 1: שם שהוחזר מה-DNS vs שם מהרשומה ───
                if (!string.IsNullOrEmpty(resolvedShortName) &&
                    !string.IsNullOrEmpty(storedName))
                {
                    if (!resolvedShortName.Equals(
                            storedName,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        mismatches.Add(
                            $"שם DNS ({resolvedShortName}) " +
                            $"≠ שם ברשומה ({storedName})");
                    }
                }

                // ─── השוואה 2: IP שהוחזר vs IP מהרשומה ──────────
                if (!string.IsNullOrEmpty(result.ResolvedIp) &&
                    !string.IsNullOrEmpty(storedIp))
                {
                    if (!result.ResolvedIp.Equals(
                            storedIp,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        mismatches.Add(
                            $"IP שהוחזר ({result.ResolvedIp}) " +
                            $"≠ IP ברשומה ({storedIp})");
                    }
                }

                // ─── השוואה 3: אם פינגנו לפי IP - שם שהוחזר ─────
                if (targetType == "ip" &&
                    !string.IsNullOrEmpty(resolvedShortName) &&
                    !string.IsNullOrEmpty(storedName))
                {
                    if (!resolvedShortName.Equals(
                            storedName,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        mismatches.Add(
                            $"Reverse DNS לפי IP ({target}) " +
                            $"מחזיר שם: {resolvedShortName} " +
                            $"(צפוי: {storedName})");
                    }
                }

                result.Mismatches  = mismatches;
                result.HasMismatch = mismatches.Count > 0;
            }
            catch
            {
                // DNS lookup נכשל - לא קריטי
                result.ResolvedName = "";
            }
        }

        // ─── אם פינגנו לפי שם ועדיין אין IP - נסה DNS ───────────
        if (targetType == "name" &&
            result.IsAlive &&
            string.IsNullOrEmpty(result.ResolvedIp))
        {
            try
            {
                var dnsEntry = await System.Net.Dns.GetHostEntryAsync(target);
                result.ResolvedIp = dnsEntry.AddressList
                    .FirstOrDefault(
                        a => a.AddressFamily ==
                            System.Net.Sockets.AddressFamily.InterNetwork)
                    ?.ToString() ?? "";

                // ─── בדוק אי-התאמת IP ─────────────────────────────
                if (!string.IsNullOrEmpty(result.ResolvedIp) &&
                    !string.IsNullOrEmpty(storedIp) &&
                    !result.ResolvedIp.Equals(
                        storedIp,
                        StringComparison.OrdinalIgnoreCase))
                {
                    result.Mismatches ??= new List<string>();
                    result.Mismatches.Add(
                        $"IP שנפתר מה-DNS ({result.ResolvedIp}) " +
                        $"≠ IP ברשומה ({storedIp})");
                    result.HasMismatch = true;
                }
            }
            catch { /* DNS לא פתר */ }
        }

        return result;
    }

    // ─── GET: קבל פערים בין קטלוג מערכות לשרתים ─────────────────
    [HttpGet]
    public IActionResult GetSystemsGaps()
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לצפייה בפערים"
                });

            // ─── טען שרתים (ServerRecord) ────────────────────────
            var servers = LoadFromJson();

            // ─── טען קטלוג מערכות (SystemCatalogRecord) ──────────
            var catalogPath =
                PortalPaths.UnderFiles(@"systems_catalog.json");

            if (!System.IO.File.Exists(catalogPath))
                return Json(new
                {
                    success = false,
                    error   = "קובץ קטלוג מערכות לא נמצא"
                });

            var catalogJson = System.IO.File.ReadAllText(
                catalogPath, Encoding.UTF8);

            var catalog = JsonSerializer
                .Deserialize<List<SystemCatalogRecord>>(catalogJson)
                ?? new List<SystemCatalogRecord>();

            var gaps = new List<GapRecord>();

            // ─── מפה: catalogNumber → רשומת קטלוג ───────────────
            var catalogByNumber = catalog
                .Where(c => !string.IsNullOrWhiteSpace(c.Number))
                .GroupBy(c => c.Number!.Trim(),
                    StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(),
                    StringComparer.OrdinalIgnoreCase);

            // ─── מפה: systemName → רשומת קטלוג ──────────────────
            var catalogByName = catalog
                .Where(c => !string.IsNullOrWhiteSpace(c.Name))
                .GroupBy(c => (c.Name ?? "").Trim().ToLowerInvariant())
                .ToDictionary(g => g.Key, g => g.First(),
                    StringComparer.OrdinalIgnoreCase);

            // ─── מפה: catalogNumber → רשימת שרתים ───────────────
            // ServerRecord.CatalogNumber ← שדה קיים ב-ServerRecord
            var serversByCatalog = servers
                .Where(s => !string.IsNullOrWhiteSpace(s.CatalogNumber))
                .GroupBy(s => s.CatalogNumber.Trim(),
                    StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key,
                    g => g.Select(s => s.Name).ToList(),
                    StringComparer.OrdinalIgnoreCase);

            // ─── מפה: systemName → רשימת שרתים ──────────────────
            // ServerRecord.SystemName ← שדה קיים ב-ServerRecord
            var serversBySystemName = servers
                .Where(s => !string.IsNullOrWhiteSpace(s.SystemName))
                .GroupBy(s => (s.SystemName ?? "").Trim().ToLowerInvariant())
                .ToDictionary(g => g.Key,
                    g => g.Select(s => s.Name).ToList(),
                    StringComparer.OrdinalIgnoreCase);

            // ════════════════════════════════════════════════════
            // בדיקה 1: אי-התאמות בשרתים עם מספר קטלוג
            // ════════════════════════════════════════════════════
            var serversWithCatalog = servers
                .Where(s => !string.IsNullOrWhiteSpace(s.CatalogNumber)
                        && !string.IsNullOrWhiteSpace(s.SystemName))
                .ToList();

            foreach (var srv in serversWithCatalog)
            {
                var catNum = srv.CatalogNumber.Trim();

                if (!catalogByNumber.TryGetValue(catNum, out var catRecord))
                    continue;

                var affectedServers = serversByCatalog
                    .GetValueOrDefault(catNum) ?? new List<string>();

                // ─── שם מערכת שונה ───────────────────────────────────────
                // השווה שם השרת מול שם עברי ושם אנגלי בקטלוג
                var srvName  = (srv.SystemName    ?? "").Trim();
                var catName  = (catRecord.Name    ?? "").Trim();
                var catNameEn = (catRecord.NameEn ?? "").Trim();

                // ─── תואם אם שווה לשם העברי או לשם האנגלי ───────────────
                bool matchesHebrew = !string.IsNullOrEmpty(catName) &&
                    srvName.Equals(catName, StringComparison.OrdinalIgnoreCase);

                bool matchesEnglish = !string.IsNullOrEmpty(catNameEn) &&
                    srvName.Equals(catNameEn, StringComparison.OrdinalIgnoreCase);

                if (!string.IsNullOrEmpty(srvName) &&
                    !matchesHebrew &&
                    !matchesEnglish &&
                    !gaps.Any(g => g.GapType       == "name_mismatch" &&
                                g.CatalogNumber == catNum))
                {
                    // ─── בנה תצוגת ערך קטלוג: עברית + אנגלית אם קיים ───
                    var catalogDisplayValue = !string.IsNullOrEmpty(catNameEn)
                        ? $"{catName} / {catNameEn}"
                        : catName;

                    gaps.Add(new GapRecord
                    {
                        GapType         = "name_mismatch",
                        CatalogNumber   = catNum,
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = catalogDisplayValue,
                        ServerValue     = srvName,
                        AffectedServers = affectedServers
                    });
                }

                // ─── מנהל מערכת שונה ─────────────────────────────
                var srvManager = (srv.SystemManager    ?? "").Trim();
                var catManager = (catRecord.SystemManager ?? "").Trim();

                if (!string.IsNullOrEmpty(srvManager) &&
                    !string.IsNullOrEmpty(catManager) &&
                    !srvManager.Equals(catManager,
                        StringComparison.OrdinalIgnoreCase) &&
                    !gaps.Any(g => g.GapType       == "manager_mismatch" &&
                                g.CatalogNumber == catNum))
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "manager_mismatch",
                        CatalogNumber   = catNum,
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = catManager,
                        ServerValue     = srvManager,
                        AffectedServers = affectedServers
                    });
                }

                // ─── מחלקה שונה ──────────────────────────────────
                var srvDept = (srv.Department    ?? "").Trim();
                var catDept = (catRecord.Department ?? "").Trim();

                if (!string.IsNullOrEmpty(srvDept) &&
                    !string.IsNullOrEmpty(catDept) &&
                    !srvDept.Equals(catDept,
                        StringComparison.OrdinalIgnoreCase) &&
                    !gaps.Any(g => g.GapType       == "dept_mismatch" &&
                                g.CatalogNumber == catNum))
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "dept_mismatch",
                        CatalogNumber   = catNum,
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = catDept,
                        ServerValue     = srvDept,
                        AffectedServers = affectedServers
                    });
                }

                // ─── צוות שונה ───────────────────────────────────
                var srvTeam = (srv.Team    ?? "").Trim();
                var catTeam = (catRecord.Team ?? "").Trim();

                if (!string.IsNullOrEmpty(srvTeam) &&
                    !string.IsNullOrEmpty(catTeam) &&
                    !srvTeam.Equals(catTeam,
                        StringComparison.OrdinalIgnoreCase) &&
                    !gaps.Any(g => g.GapType       == "team_mismatch" &&
                                g.CatalogNumber == catNum))
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "team_mismatch",
                        CatalogNumber   = catNum,
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = catTeam,
                        ServerValue     = srvTeam,
                        AffectedServers = affectedServers
                    });
                }

                // ─── תחום שונה ───────────────────────────────────
                var srvDomain = (srv.Domain    ?? "").Trim();
                var catDomain = (catRecord.Domain ?? "").Trim();

                if (!string.IsNullOrEmpty(srvDomain) &&
                    !string.IsNullOrEmpty(catDomain) &&
                    !srvDomain.Equals(catDomain,
                        StringComparison.OrdinalIgnoreCase) &&
                    !gaps.Any(g => g.GapType       == "domain_mismatch" &&
                                g.CatalogNumber == catNum))
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "domain_mismatch",
                        CatalogNumber   = catNum,
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = catDomain,
                        ServerValue     = srvDomain,
                        AffectedServers = affectedServers
                    });
                }
            }

            // ════════════════════════════════════════════════════
            // בדיקה 2: שרתים עם שם מערכת אך ללא מספר קטלוג
            // ════════════════════════════════════════════════════
            var serversWithNameNoCatalog = servers
                .Where(s => !string.IsNullOrWhiteSpace(s.SystemName)
                        && string.IsNullOrWhiteSpace(s.CatalogNumber))
                .GroupBy(s => (s.SystemName ?? "").Trim().ToLowerInvariant())
                .ToList();

            foreach (var grp in serversWithNameNoCatalog)
            {
                var systemName = grp.First().SystemName ?? "";

                if (catalogByName.TryGetValue(grp.Key, out var catRecord))
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "catalog_missing",
                        CatalogNumber   = catRecord.Number ?? "",
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = systemName,
                        ServerValue     = "חסר מספר קטלוג",
                        AffectedServers = grp.Select(s => s.Name).ToList()
                    });
                }
            }

            // ════════════════════════════════════════════════════
            // בדיקה 3: שם מערכת בשרתים שלא קיים בקטלוג
            // ════════════════════════════════════════════════════
            var uniqueSystemNames = servers
                .Where(s => !string.IsNullOrWhiteSpace(s.SystemName))
                .GroupBy(s => (s.SystemName ?? "").Trim().ToLowerInvariant())
                .ToList();

            foreach (var grp in uniqueSystemNames)
            {
                if (catalogByName.ContainsKey(grp.Key)) continue;

                var hasCatalogNum = grp.Any(s =>
                    !string.IsNullOrWhiteSpace(s.CatalogNumber) &&
                    catalogByNumber.ContainsKey(s.CatalogNumber.Trim()));

                if (!hasCatalogNum)
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "system_not_in_catalog",
                        CatalogNumber   = grp.First().CatalogNumber ?? "",
                        CatalogSystemId = "",
                        CatalogValue    = "",
                        ServerValue     = grp.First().SystemName ?? "",
                        AffectedServers = grp.Select(s => s.Name).ToList()
                    });
                }
            }

            // ════════════════════════════════════════════════════
            // בדיקה 4: מערכות בקטלוג ללא שרתים
            // ════════════════════════════════════════════════════
            foreach (var catRecord in catalog)
            {
                if (string.IsNullOrWhiteSpace(catRecord.Name)) continue;

                var catNameKey = (catRecord.Name ?? "").Trim().ToLowerInvariant();
                var catNum     = (catRecord.Number ?? "").Trim();

                bool hasServersByName    = serversBySystemName.ContainsKey(catNameKey);
                bool hasServersByCatalog = !string.IsNullOrEmpty(catNum) &&
                                        serversByCatalog.ContainsKey(catNum);

                if (!hasServersByName && !hasServersByCatalog)
                {
                    gaps.Add(new GapRecord
                    {
                        GapType         = "catalog_not_in_servers",
                        CatalogNumber   = catNum,
                        CatalogSystemId = catRecord.Id,
                        CatalogValue    = catRecord.Name ?? "",
                        ServerValue     = "",
                        AffectedServers = new List<string>()
                    });
                }
            }

            // ─── מיין ────────────────────────────────────────────
            var gapOrder = new Dictionary<string, int>
            {
                ["name_mismatch"]          = 1,
                ["manager_mismatch"]       = 2,
                ["dept_mismatch"]          = 3,
                ["team_mismatch"]          = 4,
                ["domain_mismatch"]        = 5,
                ["catalog_missing"]        = 6,
                ["system_not_in_catalog"]  = 7,
                ["catalog_not_in_servers"] = 8,
            };

            var sortedGaps = gaps
                .OrderBy(g => gapOrder.GetValueOrDefault(g.GapType, 99))
                .ThenBy(g => g.CatalogNumber)
                .ToList();

            return Json(new
            {
                success           = true,
                gaps              = sortedGaps,
                totalGaps         = sortedGaps.Count,
                catalogCount      = catalog.Count,
                serversWithSystem = servers.Count(s =>
                    !string.IsNullOrWhiteSpace(s.SystemName)),
                summary = sortedGaps
                    .GroupBy(g => g.GapType)
                    .Select(g => new { gapType = g.Key, count = g.Count() })
                    .ToList()
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message,
                stack   = ex.StackTrace
            });
        }
    }

    // ─── POST: הוסף שרת חדש ──────────────────────────────────────
    [HttpPost]
    public IActionResult AddServer([FromBody] AddServerRequest request)
    {
        try
        {
            // ─── בדוק הרשאות אדמין ───────────────────────────────
            if (!IsCurrentUserAdmin())
                return Json(new
                {
                    success = false,
                    error   = "אין הרשאה לביצוע פעולה זו"
                });

            if (string.IsNullOrWhiteSpace(request?.ServerName))
                return Json(new
                {
                    success = false,
                    error   = "שם שרת נדרש"
                });

            var serverName = request.ServerName.Trim();

            var servers = LoadFromJson();

            // ─── בדוק אם שרת כבר קיים ────────────────────────────
            var exists = servers.Any(s =>
                s.Name.Equals(serverName,
                    StringComparison.OrdinalIgnoreCase));

            if (exists)
                return Json(new
                {
                    success = false,
                    error   = $"שרת בשם '{serverName}' כבר קיים"
                });

            // ─── צור רשומה חדשה ──────────────────────────────────
            var newServer = new ServerRecord
            {
                Id             = $"srv_{Guid.NewGuid():N}",
                Name           = serverName,
                Environment    = NormalizeEnvironment(
                                    request.Environment ?? ""),
                IsVirtual      = NormalizeVirtual(
                                    request.IsVirtual ?? ""),
                SystemStatus   = request.SystemStatus   ?? "",
                IsHealthy      = request.IsHealthy      ?? "",
                OS             = request.OS             ?? "",
                HardwareVendor = request.HardwareVendor ?? "",
                SystemName     = request.SystemName     ?? "",
                CatalogNumber  = request.CatalogNumber  ?? "",
                SystemManager  = request.SystemManager  ?? "",
                Team           = request.Team           ?? "",
                Department     = request.Department     ?? "",
                Domain         = request.Domain         ?? "",
                ScannedVia     = request.ScannedVia     ?? "",
                BootType       = request.BootType       ?? "",
                CanShutdown    = request.CanShutdown    ?? "",
                Notes          = request.Notes          ?? "",
                MappingNotes   = "",
                HasMappingData = !string.IsNullOrEmpty(
                                    request.SystemName) ||
                                !string.IsNullOrEmpty(
                                    request.SystemManager),
                ImportedAt     = DateTime.Now
                                    .ToString("yyyy-MM-dd HH:mm"),
                LastUpdated    = DateTime.Now
                                    .ToString("yyyy-MM-dd HH:mm"),
                UpdatedBy      = GetCurrentUsername()
            };

            servers.Add(newServer);
            SaveToJson(servers);

            return Json(new
            {
                success = true,
                server  = newServer,
                message = $"שרת {serverName} נוסף בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── טען הרשאות שרתים ────────────────────────────────────────
    private ServersPermissions LoadServersPermissions()
    {
        lock (_permLock)
        {
            if (!System.IO.File.Exists(_serversPermissionsPath))
                return GetDefaultServersPermissions();

            try
            {
                var json = System.IO.File.ReadAllText(
                    _serversPermissionsPath, Encoding.UTF8);
                return JsonSerializer.Deserialize<ServersPermissions>(
                    json,
                    new JsonSerializerOptions
                    {
                        PropertyNameCaseInsensitive = true
                    }
                ) ?? GetDefaultServersPermissions();
            }
            catch
            {
                return GetDefaultServersPermissions();
            }
        }
    }

    // ─── שמור הרשאות שרתים ───────────────────────────────────────
    private void SaveServersPermissions(ServersPermissions perms)
    {
        lock (_permLock)
        {
            var dir = Path.GetDirectoryName(_serversPermissionsPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(perms,
                new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(
                _serversPermissionsPath, json, Encoding.UTF8);
        }
    }

    // ─── ברירת מחדל ──────────────────────────────────────────────
    private ServersPermissions GetDefaultServersPermissions()
    {
        return new ServersPermissions
        {
            Admins      = new List<string> { "talyoh" },
            Editors     = new List<string>(),              
            LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
            UpdatedBy   = "system"
        };
    }

    // ─── GET: קבל הרשאות שרתים ───────────────────────────────────
    [HttpGet]
    public IActionResult GetServersPermissions()
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            var perms = LoadServersPermissions();
            return Json(new { success = true, permissions = perms });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: שמור הרשאות שרתים ─────────────────────────────────
    [HttpPost]
    public IActionResult SavePermissions(
        [FromBody] ServersPermissions request)
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            if (request == null)
                return Json(new { success = false, error = "בקשה לא תקינה" });

            var currentUser = GetCurrentUsername();

            // ─── וודא שהמשתמש הנוכחי נשאר אדמין ───
            if (!request.Admins.Contains(
                    currentUser, StringComparer.OrdinalIgnoreCase))
                request.Admins.Add(currentUser);

            // ─── הסר כפילויות ───
            request.Admins  = request.Admins
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.Editors = (request.Editors ?? new List<string>())
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

            request.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            request.UpdatedBy   = currentUser;

            SaveServersPermissions(request);

            return Json(new
            {
                success     = true,
                message     = "הרשאות נשמרו בהצלחה",
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
    public IActionResult GetAllUsers()
    {
        try
        {
            if (!IsCurrentUserAdmin())
                return Json(new { success = false, error = "אין הרשאה" });

            // ─── קרא משתמשים מ-UserService (זהה לקטלוג) ────────
            var users = _userService.GetAllUsers();

            return Json(new
            {
                success = true,
                users   = users
                    .Select(u => new
                    {
                        username    = u.Username,
                        displayName = u.DisplayName ?? u.Username,
                        role        = u.Role.ToString()
                    })
                    .OrderBy(u => u.displayName)
                    .ToList()
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }
}

// ─── Extension Method ─────────────────────────────────────────
public static class StringExtensions
{
    public static string IfEmpty(this string value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value;
}

// ─── מודל מיפוי (פנימי) ───────────────────────────────────────
public class MappingRecord
{
    public string VM             { get; set; } = "";
    public string PrimaryIP      { get; set; } = "";
    public string ServerStatusVC { get; set; } = "";
    public string SystemName     { get; set; } = "";
    public string CatalogNumber  { get; set; } = "";
    public string Status         { get; set; } = "";
    public string SystemManager  { get; set; } = "";
    public string Domain         { get; set; } = "";
    public string Department     { get; set; } = "";
    public string Team           { get; set; } = "";
    public string CanShutdown    { get; set; } = "";
    public string Env            { get; set; } = "";
    public string DataApproved   { get; set; } = "";
    public string MappingNotes   { get; set; } = "";
    public string AuxSystem      { get; set; } = "";
    public string MappingOS      { get; set; } = "";
}

// ─── מודל שרת מעודכן ──────────────────────────────────────────
public class ServerRecord
{
    public string  Id             { get; set; } = "";
    public string  Name           { get; set; } = "";
    public string  OS             { get; set; } = "";
    public string  HardwareVendor { get; set; } = "";
    public string  IsVirtual      { get; set; } = "";
    public string  ScannedVia     { get; set; } = "";
    public string  Environment    { get; set; } = "";
    public string  SystemName     { get; set; } = "";
    public string  CatalogNumber  { get; set; } = "";
    public string  SystemManager  { get; set; } = "";
    public string  BootType       { get; set; } = "";
    public string  IsHealthy      { get; set; } = "";
    public string  Notes          { get; set; } = "";
    public string  PrimaryIP      { get; set; } = "";
    public string  ServerStatusVC { get; set; } = "";
    public string  SystemStatus   { get; set; } = "";
    public string  Domain         { get; set; } = "";
    public string  Department     { get; set; } = "";
    public string  Team           { get; set; } = "";
    public string  CanShutdown    { get; set; } = "";
    public string  Env            { get; set; } = "";
    public string  DataApproved   { get; set; } = "";
    public string  MappingNotes   { get; set; } = "";
    public string  AuxSystem      { get; set; } = "";
    public bool    HasMappingData { get; set; } = false;
    public string  ImportedAt     { get; set; } = "";
    public string? LastUpdated    { get; set; }
    public string? UpdatedBy      { get; set; }
}

// ─── Request Models ───────────────────────────────────────────
public class UpdateServerNoteRequest
{
    public string ServerName   { get; set; } = "";
    public string Notes        { get; set; } = "";
    public string MappingNotes { get; set; } = "";
}

public class UpdateServerStatusRequest
{
    public string ServerName   { get; set; } = "";
    public string SystemStatus { get; set; } = "";
    public string IsHealthy    { get; set; } = "";
}

// ─── מודל SERVER_PROD ─────────────────────────────────────────
public class ServerProdRecord
{
    public string Name           { get; set; } = "";
    public string OS             { get; set; } = "";
    public string HardwareVendor { get; set; } = "";
    public string IsVirtual      { get; set; } = "";
    public string ScannedVia     { get; set; } = "";
}

public class SaveServersRequest
{
    public List<ServerRecord> Servers { get; set; } = new();
}

// ─── מודל BigFix ──────────────────────────────────────────
public class BigFixServerStatus
{
    public string Name            { get; set; } = "";
    public string LastReport      { get; set; } = "";
    public string PendingRestart  { get; set; } = "";
    public string CriticalUpdates { get; set; } = "";
    public string GrafanaUpdates  { get; set; } = "";
}

// ─── מודל שרת מקובץ patches ───────────────────────────────────
public class PatchesServerRecord
{
    public string Name        { get; set; } = "";
    public string Environment { get; set; } = "";
    public string SystemAdmin { get; set; } = "";
    public string BootType    { get; set; } = "";
}

// ─── מודל מיזוג פנימי ─────────────────────────────────────────
public class MergedServerInfo
{
    public string       Name           { get; set; } = "";
    public string       Environment    { get; set; } = "";
    public string       OS             { get; set; } = "";
    public string       HardwareVendor { get; set; } = "";
    public string       IsVirtual      { get; set; } = "";
    public string       ScannedVia     { get; set; } = "";
    public string       SystemAdmin    { get; set; } = "";
    public string       BootType       { get; set; } = "";
    public string       SystemName     { get; set; } = "";
    public string       CatalogNumber  { get; set; } = "";
    public string       SystemManager  { get; set; } = "";
    public string       Department     { get; set; } = "";
    public string       Team           { get; set; } = "";
    public string       Domain         { get; set; } = "";
    public string       CanShutdown    { get; set; } = "";
    public string       Env            { get; set; } = "";
    public string       PrimaryIP      { get; set; } = "";
    public string       ServerStatusVC { get; set; } = "";
    public string       SystemStatus   { get; set; } = "";
    public string       DataApproved   { get; set; } = "";
    public string       MappingNotes   { get; set; } = "";
    public string       AuxSystem      { get; set; } = "";
    public List<string> Sources        { get; set; } = new();
}

// ─── Request Model ────────────────────────────────────────────
public class AddMissingServersRequest
{
    public List<ServerRecord> Servers { get; set; } = new();
}

// ─── מודל שרת חסר ────────────────────────────────────────────
public class MissingServerInfo
{
    public string Name           { get; set; } = "";
    public string OS             { get; set; } = "";
    public string HardwareVendor { get; set; } = "";
    public string IsVirtual      { get; set; } = "";
    public string ScannedVia     { get; set; } = "";
    public string Environment    { get; set; } = "";
    public string SystemAdmin    { get; set; } = "";
    public string BootType       { get; set; } = "";
    public string SystemName     { get; set; } = "";
    public string CatalogNumber  { get; set; } = "";
    public string SystemManager  { get; set; } = "";
    public string Department     { get; set; } = "";
    public string Team           { get; set; } = "";
    public string Domain         { get; set; } = "";
    public string CanShutdown    { get; set; } = "";
    public string Env            { get; set; } = "";
    public string PrimaryIP      { get; set; } = "";
    public string ServerStatusVC { get; set; } = "";
    public string SystemStatus   { get; set; } = "";
    public string DataApproved   { get; set; } = "";
    public string MappingNotes   { get; set; } = "";
    public string AuxSystem      { get; set; } = "";
    public string Sources        { get; set; } = "";
}

public class UpdateServerRequest
{
    public string  ServerName     { get; set; } = "";
    public string? Environment    { get; set; }
    public string? IsVirtual      { get; set; }
    public string? OS             { get; set; }
    public string? SystemName     { get; set; }
    public string? CatalogNumber  { get; set; }
    public string? SystemStatus   { get; set; }
    public string? SystemManager  { get; set; }
    public string? BootType       { get; set; }
    public string? Domain         { get; set; }
    public string? Department     { get; set; }
    public string? Team           { get; set; }
    public string? CanShutdown    { get; set; }
    public string? ScannedVia     { get; set; }
    public string? IsHealthy      { get; set; }
    public string? Notes          { get; set; }
    public string? MappingNotes   { get; set; }
    public string? HardwareVendor { get; set; }
}

public class MultiServerUpdates
{
    public string? Environment   { get; set; }
    public string? IsVirtual     { get; set; }
    public string? SystemStatus  { get; set; }
    public string? IsHealthy     { get; set; }
    public string? SystemManager { get; set; }
    public string? Team          { get; set; }
    public string? Department    { get; set; }
    public string? SystemName    { get; set; }
    public string? BootType      { get; set; }
    public string? CanShutdown   { get; set; }
    public string? Notes         { get; set; }
    public string CatalogNumber { get; set; }
}

public class UpdateMultipleServersRequest
{
    public List<string>       ServerNames { get; set; } = new();
    public MultiServerUpdates Updates     { get; set; } = new();
}

// ─── מודל תוצאת PING ──────────────────────────────────────────
public class PingAttemptResult
{
    public int    Attempt   { get; set; }
    public string Status    { get; set; } = "";
    public long   RoundTrip { get; set; }
    public bool   IsSuccess { get; set; }
}

// ─── מודל בקשת מחיקה מרובה ───────────────────────────────────
public class DeleteMultipleServersRequest
{
    public List<string> ServerNames { get; set; } = new();
}

// ─── מודל תוצאת PING מפורטת ──────────────────────────────────
public class PingDetailedResult
{
    public string       Target       { get; set; } = "";
    public string       TargetType   { get; set; } = ""; // "name" | "ip"
    public bool         IsAlive      { get; set; } = false;
    public int          SuccessCount { get; set; } = 0;
    public double       AvgRtt       { get; set; } = -1;

    // ─── Reverse DNS ──────────────────────────────────────────
    public string       ResolvedIp   { get; set; } = "";
    public string       ResolvedName { get; set; } = "";

    // ─── אי-התאמות ────────────────────────────────────────────
    public bool         HasMismatch  { get; set; } = false;
    public List<string> Mismatches   { get; set; } = new();

    // ─── ניסיונות ─────────────────────────────────────────────
    public List<PingAttemptResult> Attempts { get; set; } = new();
}

// ─── מודל קטלוג מערכות (לקריאה בלבד) ────────────────────────
public class SystemCatalogRecord
{
    public string  Id                      { get; set; } = "";
    public string? Number                  { get; set; }
    public string? Name                    { get; set; }
    public string? SystemManager           { get; set; }
    public string? Domain                  { get; set; }
    public string? Department              { get; set; }
    public string? Team                    { get; set; }
    public string? NameEn                  { get; set; }
    public string? Description             { get; set; }
    public string? Status                  { get; set; }
    public string? BusinessDivision        { get; set; }
    public string? AppClassification       { get; set; }
    public string? AppType                 { get; set; }
    public string? BusinessCriticality     { get; set; }
    public string? AvailabilityRequirement { get; set; }
    public string? Environment             { get; set; }
    public string? Publisher               { get; set; }
    public string? SupportVendor           { get; set; }
    public string? CreatedAt               { get; set; }
}

// ─── מודל פער ────────────────────────────────────────────────
public class GapRecord
{
    public string       GapType         { get; set; } = "";
    public string       CatalogNumber   { get; set; } = "";
    public string       CatalogSystemId { get; set; } = "";
    public string       CatalogValue    { get; set; } = "";
    public string       ServerValue     { get; set; } = "";
    public List<string> AffectedServers { get; set; } = new();
}


// ─── מודל בקשת הוספת שרת ─────────────────────────────────────
public class AddServerRequest
{
    public string  ServerName     { get; set; } = "";
    public string? Environment    { get; set; }
    public string? IsVirtual      { get; set; }
    public string? SystemStatus   { get; set; }
    public string? IsHealthy      { get; set; }
    public string? OS             { get; set; }
    public string? HardwareVendor { get; set; }
    public string? SystemName     { get; set; }
    public string? CatalogNumber  { get; set; }
    public string? SystemManager  { get; set; }
    public string? Team           { get; set; }
    public string? Department     { get; set; }
    public string? Domain         { get; set; }
    public string? ScannedVia     { get; set; }
    public string? BootType       { get; set; }
    public string? CanShutdown    { get; set; }
    public string? Notes          { get; set; }
}

// ─── מודל בקשת BigFix לשרתים נבחרים ─────────────────────────
public class GetBigFixForServersRequest
{
    public List<string> ServerNames { get; set; } = new();
}

// הוסף בסוף הקובץ, לפני הסגירה
public class RenameServerRequest
{
    public string OldName { get; set; } = "";
    public string NewName { get; set; } = "";
}

// ─── מודל הרשאות שרתים ───────────────────────────────────────
public class ServersPermissions
{
    public List<string> Admins      { get; set; } = new();
    public List<string> Editors     { get; set; } = new();  
    public string       LastUpdated { get; set; } = "";
    public string?      UpdatedBy   { get; set; }
}