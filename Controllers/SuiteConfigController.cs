using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

[Route("[controller]/[action]")]
public class SuiteConfigController : Controller
{
    private readonly string _csvPath;

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _elasticBaseUrl = "https://172.22.250.10:9200";
    private readonly string _elasticUser     = "grafana_user";
    private readonly string _elasticPassword = "Grafana_user1";

    public SuiteConfigController(IHttpClientFactory httpClientFactory)
    {
        _httpClientFactory = httpClientFactory;
        _csvPath = Path.Combine(Directory.GetCurrentDirectory(), "assets", "files", "suite_config.csv");
    }

    public SuiteConfigController(IHttpClientFactory httpClientFactory, IWebHostEnvironment env)
        : this(httpClientFactory)
    {
        _csvPath = Path.Combine(env.WebRootPath, "assets", "files", "suite_config.csv");
    }

    // ==========================================
    // GET: קרא את כל הסוויטות מהקובץ
    // ==========================================

    [HttpGet]
    public IActionResult GetSuiteConfigs()
    {
        try
        {
            var suites = ReadSuitesFromCsv();
            return Json(new { success = true, suites });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ==========================================
    // POST: הוסף סוויטה חדשה לפי parent_container_uid
    // ==========================================

    [HttpPost]
    public async Task<IActionResult> AddSuiteConfig(
        [FromBody] SuiteConfigModel model)
    {
        try
        {
            // ולידציה
            if (string.IsNullOrWhiteSpace(model.ParentUid))
                return Json(new
                {
                    success = false,
                    message = "parent_container_uid הוא שדה חובה"
                });

            var suites = ReadSuitesFromCsv();

            // בדוק כפילות
            if (suites.Any(s => s.ParentUid
                    .Equals(model.ParentUid,
                            StringComparison.OrdinalIgnoreCase)))
            {
                return Json(new
                {
                    success = false,
                    message = "סוויטה עם UID זה כבר קיימת"
                });
            }

            // שלוף מידע על הסוויטה מאלסטיק
            var suiteInfo = await FetchSuiteInfoFromElastic(model.ParentUid);

            var newEntry = new SuiteConfigEntry
            {
                Id          = suites.Any()
                                  ? suites.Max(s => s.Id) + 1
                                  : 1,
                ParentUid   = model.ParentUid.Trim(),
                DisplayName = !string.IsNullOrWhiteSpace(model.DisplayName)
                                  ? model.DisplayName.Trim()
                                  : suiteInfo?.SuiteName ?? model.ParentUid,
                SuiteName   = suiteInfo?.SuiteName   ?? "",
                SuiteNumber = suiteInfo?.SuiteNumber ?? "",
                SuiteTeam   = suiteInfo?.SuiteTeam   ?? "",
                SuiteBrowser= suiteInfo?.SuiteBrowser?? "",
                CloudBeatId  = model.CloudBeatId?.Trim() ?? "",
                AddedAt     = DateTime.Now
                                  .ToString("yyyy-MM-dd HH:mm:ss"),
                IsPatchSuite = model.IsPatchSuite ?? false
            };

            suites.Add(newEntry);
            SaveSuitesToCsv(suites);

            return Json(new
            {
                success = true,
                message = "הסוויטה נוספה בהצלחה",
                suite   = newEntry
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ==========================================
    // POST: עדכן שם תצוגה
    // ==========================================
    [HttpPost]
    public IActionResult UpdateSuiteConfig(
        [FromBody] SuiteConfigModel model)
    {
        try
        {
            if (model.Id == null)
                return Json(new
                {
                    success = false,
                    message = "מזהה חסר"
                });

            var suites  = ReadSuitesFromCsv();
            var existing = suites.FirstOrDefault(s => s.Id == model.Id);

            if (existing == null)
                return Json(new
                {
                    success = false,
                    message = "סוויטה לא נמצאה"
                });

            if (!string.IsNullOrWhiteSpace(model.DisplayName))
                existing.DisplayName = model.DisplayName.Trim();

            if (model.CloudBeatId != null)
                existing.CloudBeatId = model.CloudBeatId.Trim();

            if (model.IsPatchSuite.HasValue)
                existing.IsPatchSuite = model.IsPatchSuite.Value;

            SaveSuitesToCsv(suites);

            return Json(new
            {
                success = true,
                message = "הסוויטה עודכנה בהצלחה",
                suite   = existing
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ==========================================
    // POST: מחק סוויטה
    // ==========================================

    [HttpPost]
    public IActionResult DeleteSuiteConfig(
        [FromBody] DeleteSuiteConfigModel model)
    {
        try
        {
            if (model.Id == null)
                return Json(new
                {
                    success = false,
                    message = "מזהה חסר"
                });

            var suites = ReadSuitesFromCsv();
            var toDelete = suites.FirstOrDefault(s => s.Id == model.Id);

            if (toDelete == null)
                return Json(new
                {
                    success = false,
                    message = "סוויטה לא נמצאה"
                });

            suites.Remove(toDelete);
            SaveSuitesToCsv(suites);

            return Json(new
            {
                success = true,
                message = "הסוויטה נמחקה בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ==========================================
    // פונקציות עזר — CSV
    // ==========================================

    public List<SuiteConfigEntry> ReadSuitesFromCsv()
    {
        var result = new List<SuiteConfigEntry>();

        if (!System.IO.File.Exists(_csvPath))
            return result;

        var lines = System.IO.File.ReadAllLines(_csvPath);

        // שורה 0 = כותרת
        for (int i = 1; i < lines.Length; i++)
        {
            var cols = ParseCsvLine(lines[i]);
            if (cols.Length < 2) continue;

            // דלג על שורות ריקות
            if (string.IsNullOrWhiteSpace(cols[0]) &&
                string.IsNullOrWhiteSpace(cols[1]))
                continue;

            if (!int.TryParse(cols[0].Trim(), out var id))
                continue;

            result.Add(new SuiteConfigEntry
            {
                Id           = id,
                ParentUid    = cols.Length > 1 ? cols[1].Trim() : "",
                DisplayName  = cols.Length > 2 ? cols[2].Trim() : "",
                SuiteName    = cols.Length > 3 ? cols[3].Trim() : "",
                SuiteNumber  = cols.Length > 4 ? cols[4].Trim() : "",
                SuiteTeam    = cols.Length > 5 ? cols[5].Trim() : "",
                SuiteBrowser = cols.Length > 6 ? cols[6].Trim() : "",
                CloudBeatId  = cols.Length > 7 ? cols[7].Trim() : "",
                AddedAt      = cols.Length > 8 ? cols[8].Trim() : "",
                IsPatchSuite = cols.Length > 9 && cols[9].Trim() == "1"
            });
        }

        return result;
    }

    // public wrapper לשימוש חיצוני
    public void WriteSuitesToCsv(List<SuiteConfigEntry> suites)
    {
        SaveSuitesToCsv(suites);
    }

    private void SaveSuitesToCsv(List<SuiteConfigEntry> suites)
    {
        var dir = Path.GetDirectoryName(_csvPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        var lines = new List<string>
        {
            "id,parent_uid,display_name,suite_name," +
            "suite_number,suite_team,suite_browser,cloud_beat_id,added_at,is_patch" 
        };

        foreach (var s in suites.OrderBy(x => x.Id))
        {
            lines.Add(string.Join(",",
                EscapeCsv(s.Id.ToString()),
                EscapeCsv(s.ParentUid),
                EscapeCsv(s.DisplayName),
                EscapeCsv(s.SuiteName),
                EscapeCsv(s.SuiteNumber),
                EscapeCsv(s.SuiteTeam),
                EscapeCsv(s.SuiteBrowser),
                EscapeCsv(s.CloudBeatId), 
                EscapeCsv(s.AddedAt),
                s.IsPatchSuite ? "1" : "0"
            ));
        }

        System.IO.File.WriteAllLines(_csvPath, lines);
    }

    // ==========================================
    // שליפת מידע מאלסטיק
    // ==========================================

    private async Task<SuiteInfoBasic?> FetchSuiteInfoFromElastic(
        string parentUid)
    {
        try
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (_, _, _, _) => true
            };

            using var client = new HttpClient(handler);
            var creds = Convert.ToBase64String(
                Encoding.UTF8.GetBytes(
                    $"{_elasticUser}:{_elasticPassword}"));
            client.DefaultRequestHeaders.Add(
                "Authorization", $"Basic {creds}");

            var query = new
            {
                _source = new[]
                {
                    "container_name",
                    "container_uid"
                },
                query = new
                {
                    @bool = new
                    {
                        must = new object[]
                        {
                            new
                            {
                                term = new Dictionary<string, object>
                                {
                                    ["container_uid.keyword"] = parentUid
                                }
                            },
                            new
                            {
                                term = new Dictionary<string, object>
                                {
                                    ["container_type.keyword"] = "suite"
                                }
                            }
                        }
                    }
                },
                // הוסף מיון לפי timestamp בסדר יורד
                sort = new[]
                {
                    new Dictionary<string, object>
                    {
                        ["start_time"] = new { order = "desc" }
                    }
                },
                size = 1
            };

            var json    = JsonSerializer.Serialize(query);
            var content = new StringContent(
                json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync(
                $"{_elasticBaseUrl}/cbr-*/_search", content);

            if (!response.IsSuccessStatusCode)
                return null;

            var body = await response.Content.ReadAsStringAsync();
            var doc  = JsonSerializer.Deserialize<JsonElement>(body);

            if (!doc.TryGetProperty("hits", out var h1)) return null;
            if (!h1.TryGetProperty("hits",  out var h2)) return null;

            foreach (var hit in h2.EnumerateArray())
            {
                if (!hit.TryGetProperty("_source", out var src))
                    continue;

                var name = src.TryGetProperty(
                    "container_name", out var np)
                    ? np.GetString() ?? "" : "";

                var info = new SuiteInfoBasic { SuiteName = name };
                ParseSuiteNameBasic(info);
                return info;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"FetchSuiteInfoFromElastic error: {ex.Message}");
        }

        return null;
    }

    // ==========================================
    // פרסור שם סוויטה
    // ==========================================

    private void ParseSuiteNameBasic(SuiteInfoBasic info)
    {
        if (string.IsNullOrEmpty(info.SuiteName)) return;

        var parts = info.SuiteName.Split(" - ");

        if (parts.Length >= 1)
            info.SuiteNumber = parts[0]
                .Replace("Suite", "",
                         StringComparison.OrdinalIgnoreCase)
                .Trim();

        if (parts.Length >= 2)
            info.SuiteTeam = parts[1].Trim();

        if (parts.Length >= 3)
            info.SuiteBrowser = parts[2].Trim();
    }

    // ==========================================
    // CSV helpers
    // ==========================================

    private string EscapeCsv(string field)
    {
        if (string.IsNullOrEmpty(field)) return "";
        if (field.Contains(',') ||
            field.Contains('"') ||
            field.Contains('\n'))
        {
            field = field.Replace("\"", "\"\"");
            return $"\"{field}\"";
        }
        return field;
    }

    private string[] ParseCsvLine(string line)
    {
        var result  = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];

            if (c == '"')
            {
                if (inQuotes &&
                    i + 1 < line.Length &&
                    line[i + 1] == '"')
                {
                    current.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }
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

    // ==========================================
    // מודלים
    // ==========================================

    public class SuiteConfigEntry
    {
        public int    Id           { get; set; }
        public string ParentUid    { get; set; } = "";
        public string DisplayName  { get; set; } = "";
        public string SuiteName    { get; set; } = "";
        public string SuiteNumber  { get; set; } = "";
        public string SuiteTeam    { get; set; } = "";
        public string SuiteBrowser { get; set; } = "";
        public string CloudBeatId  { get; set; } = "";
        public string AddedAt      { get; set; } = "";
        public bool   IsPatchSuite { get; set; } = false;
    }

    public class SuiteInfoBasic
    {
        public string SuiteName    { get; set; } = "";
        public string SuiteNumber  { get; set; } = "";
        public string SuiteTeam    { get; set; } = "";
        public string SuiteBrowser { get; set; } = "";
    }

    public class SuiteConfigModel
    {
        public int?   Id          { get; set; }
        public string ParentUid   { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public string CloudBeatId  { get; set; } = ""; 
        public bool?  IsPatchSuite { get; set; }
    }

    public class DeleteSuiteConfigModel
    {
        public int? Id { get; set; }
    }
}