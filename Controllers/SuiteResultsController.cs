using Microsoft.AspNetCore.Mvc;
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;
using System.Collections.Generic;
using System.Linq;
using NocPortal.Services;

[Route("[controller]/[action]")]
public class SuiteResultsController : Controller
{
    private readonly IHttpClientFactory _httpClientFactory;

    private readonly UserService _userService;
    private readonly SecretsService _secrets;

    private string _elasticBaseUrl => _secrets.ElasticBaseUrl;
    private string _elasticUser    => _secrets.ElasticUsername;
    private string _elasticPassword => _secrets.ElasticPassword;

    // *** נתיב קובץ אנשי קשר ***
    private readonly string _contactsFilePath = PortalPaths.UnderFiles(@"test_contacts.csv");
    private readonly string _downtimeSystemsPath = PortalPaths.UnderFiles(@"downtime_systems.csv");

    private readonly string _runAllLockFilePath = 
        PortalPaths.UnderFiles(@"runall_lock.txt");
    private readonly string _permissionsPath =
        PortalPaths.UnderFiles(@"suite_permissions.json");

    private static readonly object _suitesPermLock = new object();
    private readonly TimeSpan _lockDuration = TimeSpan.FromMinutes(5);

    public SuiteResultsController(
        IHttpClientFactory httpClientFactory,
        SecretsService secrets,
        SuiteConfigController suiteConfig,
        UserService userService)
    {
        _httpClientFactory = httpClientFactory;
        _secrets           = secrets;
        _userService  = userService;
    }

    private bool IsLocalDemoHost()
    {
        var host = Request.Host.Host ?? "";
        return true || host.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || host == "127.0.0.1";
    }

    // ==========================================
    // GetAllSuites — קורא מהקובץ, שולף בדיקות
    // ==========================================

    [HttpGet]
    public async Task<IActionResult> GetAllSuites()
    {
        try
        {
            if (IsLocalDemoHost())
                return GenerateMockResults(suitesCount: 12, testsPerSuite: 8, patchSuitesCount: 3);

            // 1. קרא את רשימת הסוויטות מהקובץ
            var suiteConfig = new SuiteConfigController(_httpClientFactory, _secrets);
            var configEntries = suiteConfig.ReadSuitesFromCsv();

            if (configEntries.Count == 0)
            {
                return Json(new
                {
                    success = true,
                    total   = 0,
                    suites  = new List<object>(),
                    runAllLastTime = (string?)null
                });
            }

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

            var since = DateTime.UtcNow
                                .AddDays(-7)
                                .ToString("yyyy-MM-ddTHH:mm:ss");

            // *** חדש: שלוף זמן Run All במקביל לסוויטות ***
            var runAllLastTimeTask = FetchRunAllLastTime(client);

            var suites = new List<SuiteInfo>();

            foreach (var entry in configEntries)
            {
                var suite = new SuiteInfo
                {
                    SuiteUid     = entry.ParentUid,
                    SuiteName    = !string.IsNullOrEmpty(entry.DisplayName)
                                    ? entry.DisplayName
                                    : entry.SuiteName,
                    SuiteNumber  = entry.SuiteNumber,
                    SuiteTeam    = entry.SuiteTeam,
                    SuiteBrowser = entry.SuiteBrowser,
                    SuiteKey     = entry.ParentUid,
                    CloudBeatId  = entry.CloudBeatId,
                    IsPatchSuite = entry.IsPatchSuite
                };

                // שלוף גם מידע עדכני על הסוויטה (סטטוס, זמן)
                await FetchSuiteMetadata(client, suite);

                // שלוף בדיקות
                suite.Tests = await FetchTestsForSuite(
                    client, entry.ParentUid, since: since);

                suites.Add(suite);
            }

            // *** המתן לתוצאת Run All ***
            var runAllLastTime = await runAllLastTimeTask;

            suites = suites
                .OrderBy(s =>
                {
                    var firstWord = s.SuiteName
                        .Split(' ')
                        .FirstOrDefault() ?? "";

                    if (int.TryParse(firstWord, out var n))
                        return n;

                    return int.MaxValue;
                })
                .ThenBy(s => s.SuiteName,
                        StringComparer.OrdinalIgnoreCase)
                .ToList();

            var allContacts = ReadContactsFromCsv();

            foreach (var suite in suites)
            {
                foreach (var test in suite.Tests)
                {
                    if (!string.IsNullOrEmpty(test.TestId))
                    {
                        test.Contacts = allContacts
                            .Where(c => c.TestId == test.TestId)
                            .OrderBy(c => c.Name)
                            .ToList();
                    }
                }
            }

            return Json(new
            {
                success        = true,
                total          = suites.Count,
                suites,
                runAllLastTime  // *** חדש: זמן Run All האחרון ***
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in GetAllSuites: {ex.Message}");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ==========================================
    // GET: כל הטסטים שרצו ב-24 שעות האחרונות
    // ==========================================
    [HttpGet]
    public async Task<IActionResult> GetAllRecentTests(int hours = 24)
    {
        try
        {
            if (IsLocalDemoHost())
                return GenerateMockRecentTests(count: 40, hours: hours);

            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback = (_, _, _, _) => true
            };

            using var client = new HttpClient(handler);
            var creds = Convert.ToBase64String(
                Encoding.UTF8.GetBytes($"{_elasticUser}:{_elasticPassword}"));
            client.DefaultRequestHeaders.Add("Authorization", $"Basic {creds}");

            var since = DateTime.UtcNow
                                .AddHours(-hours)
                                .ToString("yyyy-MM-ddTHH:mm:ss");

            // ==========================================
            // collapse על container_name
            // מחזיר רק ריצה אחרונה לכל טסט ייחודי
            // ==========================================
            var requestBody = new
            {
                _source = new[]
                {
                    "container_name",
                    "container_uid",
                    "container_type",
                    "status",
                    "start_time",
                    "duration",
                    "parent_container_uid",
                    "parent_container_name",
                    "container_fqn",
                    "project_name",
                    "project_uid",
                    "environment_name",
                    "location_name",
                    "location_key",
                    "instance_name",
                    "instance_uid",
                    "result_uid",
                    "db_id",
                    "pass_rate",
                    "stats"
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
                                    ["container_type"] = "case"
                                }
                            },
                            new
                            {
                                range = new Dictionary<string, object>
                                {
                                    ["start_time"] = new Dictionary<string, object>
                                    {
                                        ["gte"] = since
                                    }
                                }
                            }
                        }
                    }
                },

                // collapse - מקבץ לפי שם טסט, שומר רק האחרון
                collapse = new
                {
                    field = "container_name",
                    inner_hits = new
                    {
                        name = "latest_run",
                        size = 1,
                        sort = new object[]
                        {
                            new Dictionary<string, object>
                            {
                                ["start_time"] = new Dictionary<string, object>
                                {
                                    ["order"] = "desc"
                                }
                            }
                        }
                    }
                },

                // מספר תוצאות גדול - כי עכשיו כל תוצאה = טסט ייחודי
                size = 10000,

                sort = new object[]
                {
                    new Dictionary<string, object>
                    {
                        ["start_time"] = new Dictionary<string, object>
                        {
                            ["order"] = "desc"
                        }
                    }
                }
            };

            var json    = JsonSerializer.Serialize(requestBody);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync(
                $"{_elasticBaseUrl}/cbr-*/_search", content);

            if (!response.IsSuccessStatusCode)
                return StatusCode((int)response.StatusCode,
                    new { success = false, message = "Elastic error" });

            var responseContent = await response.Content.ReadAsStringAsync();
            var elasticResponse = JsonSerializer.Deserialize<JsonElement>(responseContent);

            var results = ProcessRecentTestResults(elasticResponse);

            return Json(new
            {
                success = true,
                total   = results.Count,
                hours,
                since,
                tests   = results
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"GetAllRecentTests Error: {ex.Message}");
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    // ==========================================
    // עיבוד תוצאות — כל הטסטים האחרונים
    // ==========================================
    private List<object> ProcessRecentTestResults(JsonElement elasticResponse)
    {
        var results = new List<object>();

        if (!elasticResponse.TryGetProperty("hits", out var hitsOuter))
            return results;
        if (!hitsOuter.TryGetProperty("hits", out var hits))
            return results;

        foreach (var hit in hits.EnumerateArray())
        {
            if (!hit.TryGetProperty("_source", out var src))
                continue;

            // ── שדות בסיסיים ──────────────────────────────────────
            var containerName = src.TryGetProperty("container_name", out var cn)
                ? cn.GetString() : null;
            var status        = src.TryGetProperty("status",         out var st)
                ? st.GetString() : null;
            var startTime     = src.TryGetProperty("start_time",     out var stt)
                ? stt.GetString() : null;
            var duration = 0.0;
            if (src.TryGetProperty("duration", out var dur))
            {
                if (dur.ValueKind == JsonValueKind.Number)
                    duration = dur.GetDouble();
                // אם null או string — נשאר 0
            }

            // ── מזהים ─────────────────────────────────────────────
            var containerUid  = src.TryGetProperty("container_uid",  out var cu)
                ? cu.GetString() : null;
            var resultUid     = src.TryGetProperty("result_uid",     out var ru)
                ? ru.GetString() : null;
            var instanceUid   = src.TryGetProperty("instance_uid",   out var iu)
                ? iu.GetString() : null;
            var dbId          = src.TryGetProperty("db_id",          out var di)
                ? di.GetInt64() : 0;

            // ── פרויקט / סביבה ────────────────────────────────────
            var projectName   = src.TryGetProperty("project_name",   out var pn)
                ? pn.GetString() : null;
            var projectUid    = src.TryGetProperty("project_uid",    out var pu)
                ? pu.GetString() : null;
            var environmentName = src.TryGetProperty("environment_name", out var en)
                ? en.GetString() : null;
            var locationName  = src.TryGetProperty("location_name",  out var ln)
                ? ln.GetString() : null;
            var locationKey   = src.TryGetProperty("location_key",   out var lk)
                ? lk.GetString() : null;
            var instanceName  = src.TryGetProperty("instance_name",  out var inn)
                ? inn.GetString() : null;

            // ── parent ────────────────────────────────────────────
            var parentContainerUid  = src.TryGetProperty("parent_container_uid",  out var pcu)
                ? pcu.GetString() : null;
            var parentContainerName = src.TryGetProperty("parent_container_name", out var pcn)
                ? pcn.GetString() : null;
            var containerFqn        = src.TryGetProperty("container_fqn",         out var fqn)
                ? fqn.GetString() : null;

            // ── pass rate ─────────────────────────────────────────
            var passRate = src.TryGetProperty("pass_rate", out var pr)
                ? pr.GetDouble() : 0;

            // ── stats ─────────────────────────────────────────────
            int    stepCount       = 0;
            double stepPassRate    = 0;
            double stepDurationAvg = 0;

            if (src.TryGetProperty("stats", out var stats))
            {
                if (stats.TryGetProperty("step_count",        out var sc))
                    stepCount       = sc.GetInt32();
                if (stats.TryGetProperty("step_pass_rate",    out var spr))
                    stepPassRate    = spr.GetDouble();
                if (stats.TryGetProperty("step_duration_avg", out var sda))
                    stepDurationAvg = sda.ValueKind != JsonValueKind.Null
                        ? sda.GetDouble() : 0;
            }

            // ── duration בשניות ───────────────────────────────────
            // duration מגיע במילישניות מ-Elastic
            var durationSeconds = duration > 0 ? duration / 1000.0 : 0;

           // חלץ priority ו-testId מ-containerName
            var priority  = ParsePriorityFromName(containerName);
            var catalogNum = ParseTestIdFromName(containerName);

            // *** אם מספר קטלוגי הוא 9999 — השתמש ב-containerUid כ-testId ***
            var testId = catalogNum == "9999"
                ? (!string.IsNullOrEmpty(containerUid)
                    ? containerUid
                    : containerName ?? "")
                : (!string.IsNullOrEmpty(catalogNum)
                    ? catalogNum
                    : containerUid ?? "");

           // חשב projectId מ-project_name
            var projectId = GetCloudBeatProjectId(projectName);

            results.Add(new
            {
                // מזהים
                testId,
                dbId,
                resultUid,
                instanceUid,

                // שמות
                testName            = containerName,
                containerName,
                containerFqn,
                parentContainerUid,
                parentContainerName,

                // פרויקט / סביבה
                projectName,
                projectUid,
                projectId,         // חדש — מספר פרויקט CloudBeat
                environmentName,
                locationName,
                locationKey,
                instanceName,

                // תוצאה
                status,
                passRate,
                lastRunTime         = startTime,

                // משך
                durationSeconds,
                durationMs          = duration,

               // priority מפורסר
                priority,

                // סטטיסטיקות
                stepCount,
                stepPassRate,
                stepDurationAvg,
            });
        }

        return results;
    }

    //  מיפוי project_name → projectId
    private static int GetCloudBeatProjectId(string? projectName)
    {
        if (string.IsNullOrEmpty(projectName)) return 0;

        return projectName.Trim() switch
        {
            "תשתיות טכנולוגיות"                          => 138,
            "קטלוג מערכות - קריטיות תפעולית גבוהה"       => 162,
            "Onit_to_Nihulit_Gvia_Elem_Linux"             => 439,
            _ => 0
        };
    }

    //  חילוץ priority מ-containerName
    private static string ParsePriorityFromName(string? containerName)
    {
        if (string.IsNullOrEmpty(containerName)) return "";
        var parts = containerName.Split(" - ");
        // פורמט: DEPT - TestId - TestName - Browser - Priority
        return parts.Length >= 5 ? parts[4].Trim() : "";
    }

    //  חילוץ testId מ-containerName
    private static string ParseTestIdFromName(string? containerName)
    {
        if (string.IsNullOrEmpty(containerName)) return "";
        var parts = containerName.Split(" - ");
        return parts.Length >= 2 ? parts[1].Trim() : "";
    }

    // ==========================================
    // פרסור שם טסט — גרסה ל-RecentTests
    // (זהה ל-ParseContainerName אבל לא דורסת Department)
    // ==========================================
    private void ParseContainerNameForResult(SuiteTestResult result)
    {
        if (string.IsNullOrEmpty(result.ContainerName)) return;

        var parts = result.ContainerName.Split(" - ");

        if (parts.Length >= 3)
        {
            var catalogNum  = parts[1].Trim();
            result.TestName = parts[2].Trim();

            // *** אם מספר קטלוגי הוא 9999 — השתמש ב-Id הייחודי ***
            if (catalogNum == "9999")
            {
                result.TestId = !string.IsNullOrEmpty(result.Id)
                    ? result.Id
                    : result.ContainerName;
            }
            else
            {
                result.TestId = catalogNum;
            }
        }

        if (parts.Length >= 5)
            result.Priority = parts[4].Trim();
    }

    // ==========================================
    // *** שליפת זמן הריצה האחרון של Run All ***
    // ==========================================
    private async Task<string?> FetchRunAllLastTime(HttpClient client)
    {
        try
        {
            var caseUids = new[]
            {
                "2cd6d06c-0b5c-11ee-ab72-005056b9d895",
                "0ecb7125-0557-11f0-b8ca-005056b9ec1a"
            };

            DateTime? latestTime = null;

            foreach (var caseUid in caseUids)
            {
                try
                {
                    var query = new
                    {
                        _source = new[] { "start_time" },
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
                                            ["container_uid"] = caseUid
                                        }
                                    }
                                }
                            }
                        },
                        size = 1,
                        sort = new object[]
                        {
                            new Dictionary<string, object>
                            {
                                ["start_time"] = new Dictionary<string, object>
                                {
                                    ["order"] = "desc"
                                }
                            }
                        }
                    };

                    var json    = JsonSerializer.Serialize(query);
                    var content = new StringContent(
                        json, Encoding.UTF8, "application/json");

                    var response = await client.PostAsync(
                        $"{_elasticBaseUrl}/cbr-*/_search", content);

                    if (!response.IsSuccessStatusCode) continue;

                    var body = await response.Content.ReadAsStringAsync();
                    var doc  = JsonSerializer.Deserialize<JsonElement>(body);

                    if (!doc.TryGetProperty("hits", out var h1)) continue;
                    if (!h1.TryGetProperty("hits",  out var h2)) continue;

                    foreach (var hit in h2.EnumerateArray())
                    {
                        if (!hit.TryGetProperty("_source", out var src))
                            continue;

                        if (!src.TryGetProperty("start_time", out var tp))
                            break;

                        var startTimeStr = tp.GetString() ?? "";
                        if (string.IsNullOrEmpty(startTimeStr)) break;

                        if (!DateTime.TryParse(startTimeStr, null,
                                System.Globalization.DateTimeStyles.RoundtripKind,
                                out var dt))
                            break;

                        if (dt.Kind == DateTimeKind.Unspecified)
                            dt = DateTime.SpecifyKind(dt, DateTimeKind.Utc);

                        // *** המר לשעון ישראל ***
                        var israelTimeStr = ConvertUtcToIsrael(dt.ToString("o"));

                        if (DateTime.TryParse(israelTimeStr, out var israelDt))
                        {
                            if (latestTime == null || israelDt > latestTime)
                                latestTime = israelDt;
                        }

                        break;
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(
                        $"Error: FetchRunAllLastTime uid={caseUid}: {ex.Message}");
                }
            }

            return latestTime?.ToString("yyyy-MM-ddTHH:mm:ss");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"FetchRunAllLastTime Error: {ex.Message}");
            return null;
        }
    }

    // ==========================================
    // POST: Proxy להרצת סוויטה ב-CloudBeat
    // ==========================================

    [HttpPost]
    public async Task<IActionResult> RunCloudBeatSuite(
        [FromBody] RunSuiteRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req?.CloudBeatId))
                return Json(new
                {
                    success = false,
                    message = "CloudBeat ID is missing"
                });

            // *** API Keys ***
            var apiKeys = new Dictionary<string, string>
            {
                ["automation"] = "54ae6a3c-c475-48f1-a50d-b200ea335fa5",
                ["noc"]        = "9a7077d5-88a8-47f3-ab38-f7003f8059c3"
            };

            var runnerType = req.RunnerType?.ToLower() ?? "automation";

            if (!apiKeys.TryGetValue(runnerType, out var apiKey))
                return Json(new
                {
                    success = false,
                    message = $"Invalid runner type: {runnerType}"
                });

            var timeVar = DateTime.UtcNow.ToString("o");

            var failedOnlySuffix = req.RunFailedOnly
                ? "&runFailedOnlyResultId=0"
                : "";

            var url =
                $"https://prod-api-cloudbeat.menora.co.il/suites/api/suite/" +
                $"{Uri.EscapeDataString(req.CloudBeatId)}/run" +
                $"?apiKey={Uri.EscapeDataString(apiKey)}" +
                failedOnlySuffix;

            // *** השרת שולח — אין בעיית CORS ***
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (_, _, _, _) => true
            };

            using var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(30);

            var response = await client.GetAsync(url);

            var body = await response.Content
                                    .ReadAsStringAsync();

            if (response.IsSuccessStatusCode)
            {
                return Json(new
                {
                    success    = true,
                    message    = "Suite started successfully",
                    statusCode = (int)response.StatusCode,
                    body
                });
            }
            else
            {
                return Json(new
                {
                    success    = false,
                    message    = $"שגיאה מ-CloudBeat (HTTP {(int)response.StatusCode})",
                    statusCode = (int)response.StatusCode,
                    body
                });
            }
        }
        catch (TaskCanceledException)
        {
            return Json(new
            {
                success = false,
                message = "Timeout — CloudBeat did not respond within 30 seconds"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"RunCloudBeatSuite Error: {ex.Message}");
            return Json(new
            {
                success = false,
                message = $"Server Error: {ex.Message}"
            });
        }
    }

    [HttpPost]
    public async Task<IActionResult> RunCloudBeatCase(
        [FromBody] RunCaseRequest req)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(req?.CloudBeatId))
                return Json(new
                {
                    success = false,
                    message = "CloudBeat Case ID is missing"
                });

            var apiKeys = new Dictionary<string, string>
            {
                ["automation"] = "54ae6a3c-c475-48f1-a50d-b200ea335fa5",
                ["noc"]        = "9a7077d5-88a8-47f3-ab38-f7003f8059c3"
            };

            var runnerType = req.RunnerType?.ToLower() ?? "automation";

            if (!apiKeys.TryGetValue(runnerType, out var apiKey))
                return Json(new
                {
                    success = false,
                    message = $"Invalid runner type: {runnerType}"
                });

            var url =
                $"https://prod-api-cloudbeat.menora.co.il/cases/api/case/" +
                $"{Uri.EscapeDataString(req.CloudBeatId)}/run" +
                $"?apiKey={Uri.EscapeDataString(apiKey)}";

            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (_, _, _, _) => true
            };

            using var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(30);

            var response = await client.GetAsync(url);
            var body = await response.Content.ReadAsStringAsync();

            if (response.IsSuccessStatusCode)
            {
                return Json(new
                {
                    success    = true,
                    message    = "Case started successfully",
                    statusCode = (int)response.StatusCode,
                    body
                });
            }
            else
            {
                return Json(new
                {
                    success    = false,
                    message    = $"שגיאה מ-CloudBeat (HTTP {(int)response.StatusCode})",
                    statusCode = (int)response.StatusCode,
                    body
                });
            }
        }
        catch (TaskCanceledException)
        {
            return Json(new
            {
                success = false,
                message = "Timeout — CloudBeat did not respond within 30 seconds"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"RunCloudBeatCase Error: {ex.Message}");
            return Json(new
            {
                success = false,
                message = $"Server Error: {ex.Message}"
            });
        }
    }

    // ==========================================
    // POST: הרצת כל הסוויטות (Run All)
    // ==========================================
    [HttpPost]
    public async Task<IActionResult> RunAllSuites(
        [FromBody] RunAllSuitesRequest req)
    {
        try
        {
            var username = User?.Identity?.Name ?? "";
            if (username.Contains('\\'))
                username = username.Split('\\').Last();
            username = username.ToLower().Trim();

            bool isPrivileged = IsPrivilegedUser();

            // *** בדוק קובץ נעילה — רק למשתמשים לא מורשים (NOC) ***
            if (!isPrivileged)
            {
                var lockResult = CheckRunAllLock();
                if (lockResult.IsLocked)
                {
                    return Json(new
                    {
                        success      = false,
                        message      = $"הרצה כבר בוצעה לאחרונה. " +
                                    $"נסה שוב בעוד {lockResult.TimeLeftStr}",
                        isLocked     = true,
                        timeLeftSecs = lockResult.TimeLeftSecs,
                        timeLeftStr  = lockResult.TimeLeftStr,
                        triggeredBy  = lockResult.TriggeredBy,
                        triggeredAt  = lockResult.TriggeredAt  
                    });
                }
            }

            // *** API Keys ***
            var apiKeys = new Dictionary<string, string>
            {
                ["automation"] = "54ae6a3c-c475-48f1-a50d-b200ea335fa5",
                ["noc"]        = "9a7077d5-88a8-47f3-ab38-f7003f8059c3"
            };

            var runnerType = req?.RunnerType?.ToLower() ?? "automation";

            if (!apiKeys.TryGetValue(runnerType, out var apiKey))
                return Json(new
                {
                    success = false,
                    message = $"Invalid runner type: {runnerType}"
                });

            var caseId = runnerType == "noc" ? "3483" : "3023";

            var url =
                $"https://prod-api-cloudbeat.menora.co.il/cases/api/case/" +
                $"{Uri.EscapeDataString(caseId)}/run" +
                $"?apiKey={Uri.EscapeDataString(apiKey)}";

            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (_, _, _, _) => true
            };

            using var client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(30);

            var response = await client.GetAsync(url);
            var body     = await response.Content.ReadAsStringAsync();

            // *** Patch Suites ***
            string patchBody       = null;
            bool   patchSuccess    = false;
            int?   patchStatusCode = null;

            if (req?.RunPatchSuites == true)
            {
                var patchCaseId = "3710";
                var patchUrl =
                    $"https://prod-api-cloudbeat.menora.co.il/cases/api/case/" +
                    $"{Uri.EscapeDataString(patchCaseId)}/run" +
                    $"?apiKey={Uri.EscapeDataString(apiKey)}";

                try
                {
                    using var patchClient = new HttpClient(handler);
                    patchClient.Timeout = TimeSpan.FromSeconds(30);

                    var patchResponse = await patchClient.GetAsync(patchUrl);
                    patchBody         = await patchResponse.Content
                                                    .ReadAsStringAsync();
                    patchSuccess      = patchResponse.IsSuccessStatusCode;
                    patchStatusCode   = (int)patchResponse.StatusCode;
                }
                catch (Exception patchEx)
                {
                    patchBody    = patchEx.Message;
                    patchSuccess = false;
                }
            }

            if (response.IsSuccessStatusCode)
            {
                // *** צור קובץ נעילה תמיד — כדי שNOC יידע שהרצה בוצעה ***
                // *** גם Admin/Automation יוצרים נעילה לטובת NOC ***
                CreateRunAllLock(username);

                return Json(new
                {
                    success        = true,
                    message        = "All suites triggered successfully",
                    runnerType,
                    isPrivileged,  // *** הוסף — לידיעת ה-client ***
                    statusCode     = (int)response.StatusCode,
                    body,
                    patchTriggered = req?.RunPatchSuites == true,
                    patchSuccess,
                    patchStatusCode,
                    patchBody
                });
            }
            else
            {
                return Json(new
                {
                    success    = false,
                    message    = $"שגיאה מ-CloudBeat " +
                                $"(HTTP {(int)response.StatusCode})",
                    runnerType,
                    statusCode = (int)response.StatusCode,
                    body,
                    patchTriggered  = req?.RunPatchSuites == true,
                    patchSuccess,
                    patchStatusCode,
                    patchBody
                });
            }
        }
        catch (TaskCanceledException)
        {
            return Json(new
            {
                success = false,
                message = "Timeout — CloudBeat did not respond within 30 seconds"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"RunAllSuites Error: {ex.Message}");
            return Json(new
            {
                success = false,
                message = $"Server Error: {ex.Message}"
            });
        }
    }

    // ==========================================
    // *** בדיקת הרשאת bypass — Admin + Automation team ***
    // ==========================================
    private SuitePermissions LoadSuitePermissions()
    {
        lock (_suitesPermLock)
        {
            if (!System.IO.File.Exists(_permissionsPath))
                return GetDefaultSuitePermissions();
            try
            {
                var json = System.IO.File.ReadAllText(
                    _permissionsPath, Encoding.UTF8);
                return JsonSerializer.Deserialize<SuitePermissions>(
                    json,
                    new JsonSerializerOptions 
                    { PropertyNameCaseInsensitive = true }
                ) ?? GetDefaultSuitePermissions();
            }
            catch { return GetDefaultSuitePermissions(); }
        }
    }

    private void SaveSuitePermissionsPrivate(SuitePermissions perms)
    {
        lock (_suitesPermLock)
        {
            var dir = Path.GetDirectoryName(_permissionsPath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonSerializer.Serialize(perms,
                new JsonSerializerOptions { WriteIndented = true });
            System.IO.File.WriteAllText(_permissionsPath, json, Encoding.UTF8);
        }
    }

    private SuitePermissions GetDefaultSuitePermissions() =>
    new SuitePermissions
    {
        Admins  = new List<string> { "talyoh" },
        Editors = new List<string>(),
        Runners = new List<string>(),
        Viewers = new List<string>(),

        LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm"),
        UpdatedBy = "system"
    };

    private string GetCurrentUsername()
    {
        var name = User?.Identity?.Name ?? "";
        if (name.Contains('\\'))
            name = name.Split('\\').Last();
        return name.ToLower().Trim();
    }

    private bool IsSuiteAdmin()
    {
        var username = GetCurrentUsername();
        var perms    = LoadSuitePermissions();

        if (perms.Admins.Contains(username,
                StringComparer.OrdinalIgnoreCase)) return true;
        if (User?.IsInRole("Admin") == true) return true;

        var roleClaim = User?.Claims?
            .FirstOrDefault(c =>
                c.Type == System.Security.Claims.ClaimTypes.Role ||
                c.Type == "role")?.Value ?? "";

        return roleClaim.Equals("Admin",
            StringComparison.OrdinalIgnoreCase);
    }

    private bool CanRunSuites()
    {
        var username = GetCurrentUsername();
        var perms    = LoadSuitePermissions();

        if (IsSuiteAdmin()) return true;
        if (perms.Runners.Contains(username,
                StringComparer.OrdinalIgnoreCase)) return true;
        if (User?.IsInRole("NOC") == true) return true;

        return false;
    }

    private bool IsPrivilegedUser()
    {
        return IsSuiteAdmin();
    }

    // ==========================================
    // GET: בדיקת מצב נעילת Run All
    // ==========================================
    [HttpGet]
    public IActionResult GetRunAllLockStatus()
    {
        try
        {
            bool isPrivileged = IsPrivilegedUser();
            var lockStatus    = CheckRunAllLock();
            bool isLockedForUser = !isPrivileged && lockStatus.IsLocked;

            return Json(new
            {
                success       = true,
                isLocked      = isLockedForUser,
                isPrivileged,
                hasActiveLock = lockStatus.IsLocked,
                timeLeftSecs  = isLockedForUser ? lockStatus.TimeLeftSecs : 0,
                timeLeftStr   = isLockedForUser ? lockStatus.TimeLeftStr  : "",
                canRun        = !isLockedForUser,
                triggeredBy   = lockStatus.TriggeredBy,
                triggeredAt   = lockStatus.TriggeredAt,
                privilegedUsers = LoadSuitePermissions().Admins
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success       = false,
                message       = ex.Message,
                canRun        = true,
                isLocked      = false,
                hasActiveLock = false
            });
        }
    }

    // ─── GET: קבל הרשאות סוויטות ───
    [HttpGet]
    public IActionResult GetSuitePermissions()
    {
        try
        {
            if (!IsSuiteAdmin())
                return Json(new { success = false, 
                                message = "אין הרשאה" });

            var perms = LoadSuitePermissions();
            return Json(new { success = true, permissions = perms });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ─── POST: שמור הרשאות סוויטות ───
    [HttpPost]
    public IActionResult SaveSuitePermissions(
        [FromBody] SuitePermissions request)
    {
        try
        {
            if (!IsSuiteAdmin())
                return Json(new { success = false, 
                                message = "אין הרשאה" });

            if (request == null)
                return Json(new { success = false, 
                                message = "בקשה לא תקינה" });

            // ─── וודא שהמשתמש הנוכחי נשאר אדמין ───
            var currentUser = GetCurrentUsername();
            if (!request.Admins.Contains(currentUser,
                    StringComparer.OrdinalIgnoreCase))
                request.Admins.Add(currentUser);

            // ─── הסר כפילויות ───
            request.Admins  = request.Admins
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.Runners = request.Runners
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.Viewers = request.Viewers
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            request.Editors = (request.Editors ?? new List<string>())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            request.LastUpdated = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            request.UpdatedBy   = currentUser;

            SaveSuitePermissionsPrivate(request);

            return Json(new
            {
                success     = true,
                message     = "הרשאות נשמרו בהצלחה",
                permissions = request
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ─── GET: קבל משתמש נוכחי + הרשאות ───
    [HttpGet]
    public IActionResult GetCurrentUser()
    {
        try
        {
            var username = GetCurrentUsername();
            var perms    = LoadSuitePermissions();

            return Json(new
            {
                success = true,
                username,
                isAdmin = IsSuiteAdmin(),
                canRun = CanRunSuites(),

                role = IsSuiteAdmin() ? "Admin"
                    : User?.IsInRole("NOC") == true ? "NOC"
                    : CanRunSuites() ? "Runner"
                    : "Viewer",

                privilegedUsers = perms.Admins,
                editors = perms.Editors,
                runners = perms.Runners,
                viewers = perms.Viewers
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
            if (!IsSuiteAdmin())
                return Json(new { success = false, message = "אין הרשאה" });

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

    // ==========================================
    // GET: בדיקת תוצאה אחרונה של Run All
    // ==========================================

    [HttpGet]
    public async Task<IActionResult> GetRunAllLastResult()
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

            var caseUids = new[]
            {
                "2cd6d06c-0b5c-11ee-ab72-005056b9d895",
                "0ecb7125-0557-11f0-b8ca-005056b9ec1a"
            };

            var results = new List<(string CaseUid, DateTime LastRun, string Status)>();

            foreach (var caseUid in caseUids)
            {
                try
                {
                    var query = new
                    {
                        _source = new[]
                        {
                            "status",
                            "start_time",
                            "container_name"
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
                                            // *** חיפוש לפי container_uid בלבד ***
                                            // *** ללא פילטר container_type ***
                                            ["container_uid"] = caseUid
                                        }
                                    }
                                }
                            }
                        },
                        size = 1,
                        sort = new object[]
                        {
                            new Dictionary<string, object>
                            {
                                ["start_time"] = new Dictionary<string, object>
                                {
                                    ["order"] = "desc"
                                }
                            }
                        }
                    };

                    var json    = JsonSerializer.Serialize(query);
                    var content = new StringContent(
                        json, Encoding.UTF8, "application/json");

                    var response = await client.PostAsync(
                        $"{_elasticBaseUrl}/cbr-*/_search", content);

                    var body = await response.Content.ReadAsStringAsync();
                    var doc  = JsonSerializer.Deserialize<JsonElement>(body);

                    if (!doc.TryGetProperty("hits", out var h1)) continue;
                    if (!h1.TryGetProperty("hits",  out var h2)) continue;

                    foreach (var hit in h2.EnumerateArray())
                    {
                        if (!hit.TryGetProperty("_source", out var src))
                            continue;

                        var startTimeStr = src.TryGetProperty(
                            "start_time", out var tp)
                            ? tp.GetString() ?? "" : "";

                        var status = src.TryGetProperty(
                            "status", out var sp)
                            ? sp.GetString() ?? "" : "";

                        if (string.IsNullOrEmpty(startTimeStr)) break;

                        if (!DateTime.TryParse(startTimeStr, null,
                                System.Globalization.DateTimeStyles.RoundtripKind,
                                out var dt))
                            break;

                        if (dt.Kind == DateTimeKind.Unspecified)
                            dt = DateTime.SpecifyKind(dt, DateTimeKind.Utc);

                        var israelTimeStr = ConvertUtcToIsrael(dt.ToString("o"));

                        if (DateTime.TryParse(israelTimeStr, out var israelDt))
                        {
                            results.Add((caseUid, israelDt, status));
                        }

                        break;
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(
                        $"GetRunAllLastResult uid={caseUid}: {ex.Message}");
                }
            }

            if (!results.Any())
            {
                return Json(new
                {
                    success     = true,
                    hasResult   = false,
                    lastRunTime = (string?)null,
                    status      = (string?)null
                });
            }

            var latest = results.OrderByDescending(r => r.LastRun).First();

            return Json(new
            {
                success     = true,
                hasResult   = true,
                lastRunTime = latest.LastRun.ToString("yyyy-MM-ddTHH:mm:ss"),
                status      = latest.Status,
                caseUid     = latest.CaseUid
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"GetRunAllLastResult Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }   

    // ==========================================
    // שליפת מטא-דאטה של הסוויטה (סטטוס, זמן, משך)
    // ==========================================

    private async Task FetchSuiteMetadata(
        HttpClient client, SuiteInfo suite)
    {
        try
        {
            var query = new
            {
                _source = new[]
                {
                    "status",
                    "start_time",
                    "duration",
                    "container_name"
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
                                    ["container_uid"] =
                                        suite.SuiteUid
                                }
                            },
                            new
                            {
                                term = new Dictionary<string, object>
                                {
                                    ["container_type"] = "suite"
                                }
                            }
                        }
                    }
                },
                size = 1,
                sort = new object[]
                {
                    new Dictionary<string, object>
                    {
                        ["start_time"] = "desc"
                    }
                }
            };

            var json    = JsonSerializer.Serialize(query);
            var content = new StringContent(
                json, Encoding.UTF8, "application/json");

            var response = await client.PostAsync(
                $"{_elasticBaseUrl}/cbr-*/_search", content);

            if (!response.IsSuccessStatusCode) return;

            var body = await response.Content.ReadAsStringAsync();
            var doc  = JsonSerializer.Deserialize<JsonElement>(body);

            if (!doc.TryGetProperty("hits", out var h1)) return;
            if (!h1.TryGetProperty("hits",  out var h2)) return;

            foreach (var hit in h2.EnumerateArray())
            {
                if (!hit.TryGetProperty("_source", out var src))
                    continue;

                if (src.TryGetProperty("status", out var sp))
                    suite.Status = sp.GetString() ?? "";

                if (src.TryGetProperty("start_time", out var tp))
                {
                    var rawTime = tp.GetString() ?? "";
                    suite.StartTime   = ConvertUtcToIsrael(rawTime);
                    suite.LastRunTime = ConvertUtcToIsrael(rawTime);
                }

                if (src.TryGetProperty("duration", out var dp) &&
                    dp.ValueKind == JsonValueKind.Number)
                    suite.Duration = dp.GetInt64();

                // הבדיקה הפוכה — עדכן שם רק אם ריק
                if (string.IsNullOrEmpty(suite.SuiteName) &&
                    src.TryGetProperty("container_name", out var np))
                {
                    suite.SuiteName = np.GetString() ?? "";
                    ParseSuiteName(suite);
                }

                break;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"FetchSuiteMetadata Error: {ex.Message}");
        }
    }

    // ==========================================
    // *** המרת UTC לשעון ישראל ***
    // ==========================================
    private static string ConvertUtcToIsrael(string utcTimeString)
    {
        if (string.IsNullOrEmpty(utcTimeString))
            return utcTimeString;

        try
        {
            // פרסר את הזמן
            if (!DateTime.TryParse(utcTimeString, null,
                    System.Globalization.DateTimeStyles.RoundtripKind,
                    out var utcTime))
                return utcTimeString;

            // וודא שזה UTC
            if (utcTime.Kind != DateTimeKind.Utc)
                utcTime = DateTime.SpecifyKind(utcTime, DateTimeKind.Utc);

            // המר לאזור זמן ישראל
            var israelZone = TimeZoneInfo.FindSystemTimeZoneById(
                "Israel Standard Time");  // Windows
                // לינוקס: "Asia/Jerusalem"

            var israelTime = TimeZoneInfo.ConvertTimeFromUtc(
                utcTime, israelZone);

            // החזר כ-string מפורמט
            return israelTime.ToString("yyyy-MM-ddTHH:mm:ss");
        }
        catch
        {
            return utcTimeString;
        }
    }

    // ==========================================
    // GetSuiteResults
    // ==========================================

    [HttpGet]
    public async Task<IActionResult> GetSuiteResults(
        string suiteId =
            "308b6494-ebaf-4308-9044-bbfdf5c160eb",
        int size = 5000)
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

            var since = DateTime.UtcNow
                                .AddDays(-7)
                                .ToString("yyyy-MM-ddTHH:mm:ss");

            var tests = await FetchTestsForSuite(
                client, suiteId, size, since);

            return Json(new
            {
                success = true,
                total   = tests.Count,
                suiteId,
                results = tests
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"Error in GetSuiteResults: {ex.Message}");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ==========================================
    // GenerateMockResults
    // ==========================================

    [HttpGet]
    public IActionResult GenerateMockResults(
        int suitesCount      = 15,
        int testsPerSuite    = 10,
        int patchSuitesCount = 4)
    {
        var random = new Random();
        var suites = new List<SuiteInfo>();

        var teamNames = new[]
        {
            "Tashtiot_DBA Team",
            "Tashtiot_Core Team",
            "Tashtiot_UI Team",
            "Tashtiot_API Team"
        };

        var browsers = new[] { "CH", "IE" };

        for (int s = 1; s <= suitesCount; s++)
        {
            var team    = teamNames[(s - 1) % teamNames.Length];
            var browser = browsers[s % 2];

            // זמן ריצה אחרון — אקראי בתוך שבוע
            var lastRun = DateTime.Now
                .AddMinutes(-s * 10)
                .ToString("o");

            var suite = new SuiteInfo
            {
                SuiteUid     = Guid.NewGuid().ToString(),
                SuiteName    = $"{s} Suite - {team} - {browser}",
                Status       = "pending",   // *** יחושב אחרי הטסטים ***
                StartTime    = lastRun,
                LastRunTime  = lastRun,
                Duration     = random.Next(5000, 20000),
                Tests        = new List<SuiteTestResult>()
            };

            var testsAmount=random.Next(1, testsPerSuite);
            for (int t = 1; t <= testsAmount; t++)
            {
                var duration = random.Next(1000, 7000);
                var testName =
                    $"TASHTIT - {10000 + t} - Test {t} description" +
                    $" - CH - {random.Next(1, 5)}";

                // זמן ריצה לכל טסט
                var testRunTime = DateTime.UtcNow
                    .AddMinutes(-(s * 10 + t))
                    .ToString("o");

                var roll = random.Next(0, 10);
                var testStatus = roll > 3
                    ? "passed"
                    : roll > 1
                        ? "failed"
                        : "warning";   // *** ~20% warning ***

                var test = new SuiteTestResult
                {
                    Id              = Guid.NewGuid().ToString(),
                    ContainerName   = testName,
                    Status          = testStatus,
                    StartTime       = testRunTime,
                    LastRunTime     = testRunTime,
                    Duration        = duration,
                    DurationSeconds = duration / 1000.0
                };


                ParseContainerName(test);

                // *** טען אנשי קשר אמיתיים גם ב-Mock ***
                if (!string.IsNullOrEmpty(test.TestId))
                {
                    test.Contacts = GetContactsForTest(test.TestId);
                }

                suite.Tests.Add(test);
            }

            ParseSuiteName(suite);

            // *** חשב סטטוס סוויטה לפי הטסטים ***
            if (suite.Tests.Any(t =>
                (t.Status ?? "").ToLower() == "failed"))
            {
                suite.Status = "failed";
            }
            else if (suite.Tests.Any(t =>
                (t.Status ?? "").ToLower() == "warning"))
            {
                suite.Status = "warning";
            }
            else
            {
                suite.Status = "passed";
            }

                        suites.Add(suite);
        }

        // *** סוויטות Post-Patch ***
        var patchSuiteNames = new[]
        {
            "Patch - Security Scan",
            "Patch - DB Migration",
            "Patch - API Regression",
            "Patch - UI Smoke"
        };

        for (int p = 1; p <= patchSuitesCount; p++)
        {
            var team    = teamNames[(p - 1) % teamNames.Length];
            var browser = browsers[p % 2];

            var lastRun = DateTime.Now
                .AddMinutes(-p * 15)
                .ToString("o");

            var patchName = p <= patchSuiteNames.Length
                ? patchSuiteNames[p - 1]
                : $"Patch Suite {p}";

            var patchSuite = new SuiteInfo
            {
                SuiteUid     = Guid.NewGuid().ToString(),
                SuiteName    = $"{suitesCount + p} {patchName} - {team} - {browser}",
                Status       = "pending",
                StartTime    = lastRun,
                LastRunTime  = lastRun,
                Duration     = random.Next(5000, 20000),
                IsPatchSuite = true,          // *** סימון Patch ***
                Tests        = new List<SuiteTestResult>()
            };

            var patchTestsAmount = random.Next(2, testsPerSuite);
            for (int t = 1; t <= patchTestsAmount; t++)
            {
                var duration = random.Next(1000, 7000);
                var testName =
                    $"TASHTIT - {20000 + t} - Patch Test {t} description" +
                    $" - CH - {random.Next(1, 5)}";

                var testRunTime = DateTime.UtcNow
                    .AddMinutes(-(p * 15 + t))
                    .ToString("o");

                var roll       = random.Next(0, 10);
                var testStatus = roll > 3
                    ? "passed"
                    : roll > 1
                        ? "failed"
                        : "warning";

                var test = new SuiteTestResult
                {
                    Id              = Guid.NewGuid().ToString(),
                    ContainerName   = testName,
                    Status          = testStatus,
                    StartTime       = testRunTime,
                    LastRunTime     = testRunTime,
                    Duration        = duration,
                    DurationSeconds = duration / 1000.0
                };

                ParseContainerName(test);

                if (!string.IsNullOrEmpty(test.TestId))
                {
                    test.Contacts = GetContactsForTest(test.TestId);
                }

                patchSuite.Tests.Add(test);
            }

            ParseSuiteName(patchSuite);

            // *** חשב סטטוס ***
            if (patchSuite.Tests.Any(t =>
                (t.Status ?? "").ToLower() == "failed"))
            {
                patchSuite.Status = "failed";
            }
            else if (patchSuite.Tests.Any(t =>
                (t.Status ?? "").ToLower() == "warning"))
            {
                patchSuite.Status = "warning";
            }
            else
            {
                patchSuite.Status = "passed";
            }

            suites.Add(patchSuite);
        }

        // *** מדמה Run All שרץ לפני 30 דקות ***
        var mockRunAllLastTime = DateTime.Now
            .AddMinutes(-30)
            .ToString("yyyy-MM-ddTHH:mm:ss");

        return Json(new
        {
            success        = true,
            total          = suites.Count,
            suites,
            runAllLastTime = mockRunAllLastTime
        });
    }

    // ==========================================
    // GET: Mock לכל הטסטים האחרונים
    // ==========================================
    [HttpGet]
    public IActionResult GenerateMockRecentTests(
        int count = 80,
        int hours = 24)
    {
        var random      = new Random();
        var statuses    = new[] { "passed", "passed", "passed", "failed", "warning" };
        var priorities  = new[] { "P1", "P2", "P3", "" };
        var departments = new[] { "TASHTIT", "FINANCE", "HR", "IT" };

        // פרויקטים — תואם ל-GetCloudBeatProjectId
        var projects = new[]
        {
            new { Name = "תשתיות טכנולוגיות",                      Id = 138 },
            new { Name = "קטלוג מערכות - קריטיות תפעולית גבוהה",  Id = 162 },
            new { Name = "Onit_to_Nihulit_Gvia_Elem_Linux",         Id = 439 }
        };

        // *** סוויטות לדוגמה — חלק מהטסטים ירוצו דרך סוויטה וחלק לא ***
        var suiteNames = new[]
        {
            "1 Suite - Tashtiot_DBA Team - CH",
            "2 Suite - Tashtiot_Core Team - CH",
            "3 Suite - Tashtiot_UI Team - IE",
            "4 Suite - Tashtiot_API Team - CH",
            "5 Suite - Tashtiot_DBA Team - IE",
            null,   // *** טסטים ללא סוויטה ***
            null,
            null
        };

        var tests = new List<object>();

        for (int i = 0; i < count; i++)
        {
            var testId    = (10000 + (i % 30)).ToString();
            var dept      = departments[i % departments.Length];
            var status    = statuses[random.Next(statuses.Length)];
            var priority  = priorities[random.Next(priorities.Length)];
            var duration  = random.Next(500, 7500);
            var minsAgo   = random.Next(0, hours * 60);
            var project   = projects[i % projects.Length];

            // *** בחר סוויטה אקראית — null = ללא סוויטה ***
            var suiteName = suiteNames[random.Next(suiteNames.Length)];

            var lastRunTime = DateTime.Now
                .AddMinutes(-minsAgo)
                .ToString("yyyy-MM-ddTHH:mm:ss");

            // containerName כולל priority בפוזיציה [4]
            // פורמט: DEPT - TestId - TestName - Browser - Priority
            var containerName =
                $"{dept} - {testId} - Test description {i + 1}" +
                $" - CH - {priority}";

            tests.Add(new
            {
                id                  = $"mock-{i}",
                containerName,
                testId,
                testName            = $"Test description {i + 1}",
                status,
                priority,
                duration,
                durationSeconds     = duration / 1000.0,
                startTime           = lastRunTime,
                lastRunTime,
                department          = dept,
                projectName         = project.Name,
                projectId           = project.Id,

                parentContainerName = suiteName,
                parentContainerUid  = suiteName != null
                    ? $"mock-suite-uid-{Array.IndexOf(suiteNames, suiteName)}"
                    : null
            });
        }

        // *** מיין לפי זמן ריצה יורד ***
        var sorted = tests
            .Cast<dynamic>()
            .OrderByDescending(t => (string)t.lastRunTime)
            .ToList();

        return Json(new
        {
            success = true,
            total   = sorted.Count,
            hours,
            since   = DateTime.Now
                        .AddHours(-hours)
                        .ToString("yyyy-MM-ddTHH:mm:ss"),
            tests   = sorted
        });
    }

    // ==========================================
    // FetchTestsForSuite
    // ==========================================

    private async Task<List<SuiteTestResult>> FetchTestsForSuite(
        HttpClient client,
        string suiteId,
        int  size  = 5000,
        string since = null) 
    {
        //  בנה את תנאי ה-must עם פילטר תאריך אופציונלי
        var mustClauses = new List<object>
        {
            new
            {
                term = new Dictionary<string, object>
                {
                    ["parent_container_uid"] = suiteId
                }
            },
            new
            {
                term = new Dictionary<string, object>
                {
                    ["container_type"] = "case"
                }
            }
        };

        //  הוסף range רק אם since סופק
        if (!string.IsNullOrEmpty(since))
        {
            mustClauses.Add(new
            {
                range = new Dictionary<string, object>
                {
                    ["start_time"] = new Dictionary<string, object>
                    {
                        ["gte"] = since
                    }
                }
            });
        }

        var requestBody = new
        {
            _source = new[]
            {
                "container_name",
                "status",
                "start_time",
                "duration"
            },
            query = new
            {
                @bool = new
                {
                    must = mustClauses.ToArray()
                }
            },
            size,
            sort = new object[]
            {
                new Dictionary<string, object>
                {
                    ["start_time"] = "asc"
                }
            }
        };

        var json    = JsonSerializer.Serialize(requestBody);
        var content = new StringContent(
            json, Encoding.UTF8, "application/json");

        var response = await client.PostAsync(
            $"{_elasticBaseUrl}/cbr-*/_search", content);

        if (!response.IsSuccessStatusCode)
            return new List<SuiteTestResult>();

        var responseContent =
            await response.Content.ReadAsStringAsync();
        var elasticResponse =
            JsonSerializer.Deserialize<JsonElement>(responseContent);

        return ProcessTestResults(elasticResponse);
    }

    // ==========================================
    // ProcessTestResults
    // ==========================================

    private List<SuiteTestResult> ProcessTestResults(
        JsonElement elasticResponse)
    {
        var results = new List<SuiteTestResult>();

        try
        {
            if (!elasticResponse.TryGetProperty(
                    "hits", out var hitsContainer))
                return results;
            if (!hitsContainer.TryGetProperty("hits", out var hits))
                return results;

            foreach (var hit in hits.EnumerateArray())
            {
                if (hit.TryGetProperty("_index", out var indexProp))
                {
                    if ((indexProp.GetString() ?? "")
                        .Contains("failures"))
                        continue;
                }

                if (!hit.TryGetProperty("_source", out var source))
                    continue;

                var startTimeRaw = source.TryGetProperty("start_time", out var stt) 
                    ? stt.GetString() : null;

                var startTime = startTimeRaw != null && !startTimeRaw.EndsWith("Z") 
                    ? startTimeRaw + "Z" 
                    : startTimeRaw;

                // המר לשעון ישראל
                var israelTime = ConvertUtcToIsrael(startTime);

                var result = new SuiteTestResult
                {
                    Id = hit.TryGetProperty("_id", out var idProp)
                        ? idProp.GetString() ?? "" : "",

                    ContainerName = source.TryGetProperty(
                        "container_name", out var nameProp)
                        ? nameProp.GetString() ?? "" : "",

                    Status = source.TryGetProperty(
                        "status", out var statusProp)
                        ? statusProp.GetString() ?? "" : "",

                    StartTime   = israelTime,
                    LastRunTime = israelTime, 

                    Duration = source.TryGetProperty(
                        "duration", out var durProp) &&
                        durProp.ValueKind == JsonValueKind.Number
                        ? durProp.GetInt64() : 0
                };

                result.DurationSeconds = result.Duration / 1000.0;
                ParseContainerNameForResult(result);
                results.Add(result);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"Error processing test results: {ex.Message}");
        }

        return GetLatestRunPerTest(results);
    }

    // ==========================================
    // GetLatestRunPerTest
    // ==========================================

    private List<SuiteTestResult> GetLatestRunPerTest(
        List<SuiteTestResult> results)
    {
        return results
            .GroupBy(r => r.TestName ?? r.ContainerName)
            .Select(g =>
            {
                //  הריצה האחרונה לפי StartTime
                var latest = g.OrderByDescending(r => r.StartTime)
                              .First();

                //  LastRunTime = StartTime של הריצה האחרונה
                latest.LastRunTime = latest.StartTime;
                return latest;
            })
            .OrderBy(r => r.TestName)
            .ToList();
    }

    // ==========================================
    // ParseSuiteName
    // ==========================================

    private void ParseSuiteName(SuiteInfo suite)
    {
        if (string.IsNullOrEmpty(suite.SuiteName))
        {
            suite.SuiteKey = "";
            return;
        }

        var parts = suite.SuiteName.Split(" - ");

        if (parts.Length >= 1)
        {
            suite.SuiteNumber = parts[0]
                .Replace("Suite", "",
                         StringComparison.OrdinalIgnoreCase)
                .Trim();
        }

        if (parts.Length >= 2)
            suite.SuiteTeam = parts[1].Trim();

        if (parts.Length >= 3)
            suite.SuiteBrowser = parts[2].Trim();

        suite.SuiteKey =
            $"{suite.SuiteNumber}_{suite.SuiteTeam}_{suite.SuiteBrowser}";
    }

    private void ParseContainerName(SuiteTestResult result)
    {
        if (string.IsNullOrEmpty(result.ContainerName))
            return;

        var parts = result.ContainerName.Split(" - ");

        if (parts.Length >= 3)
        {
            result.Department = parts[0].Trim();
            var catalogNum    = parts[1].Trim();
            result.TestName   = parts[2].Trim();

            // *** אם מספר קטלוגי הוא 9999 — השתמש ב-Id הייחודי של הטסט ***
            // *** (container_uid שכבר נמצא ב-result.Id) ***
            if (catalogNum == "9999")
            {
                // השתמש ב-Id הייחודי של הרשומה (container_uid / _id מ-Elastic)
                result.TestId = !string.IsNullOrEmpty(result.Id)
                    ? result.Id
                    : result.ContainerName; // fallback לשם מלא
            }
            else
            {
                result.TestId = catalogNum;
            }
        }

        if (parts.Length >= 5)
            result.Priority = parts[4].Trim();
    }

    // ==========================================
    // *** קריאת כל אנשי הקשר מ-CSV ***
    // ==========================================
    private List<TestContact> ReadContactsFromCsv()
    {
        var contacts = new List<TestContact>();

        try
        {
            // *** צור תיקייה אם לא קיימת ***
            var dir = Path.GetDirectoryName(_contactsFilePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            if (!System.IO.File.Exists(_contactsFilePath))
            {
                System.IO.File.WriteAllText(
                    _contactsFilePath,
                    "id,test_id,name,email,phone,added_at\n");
                return contacts;
            }

            var lines = System.IO.File.ReadAllLines(_contactsFilePath);

            if (lines.Length == 0) return contacts;

            // *** זהה את הפורמט לפי שורת הכותרת ***
            var header = lines[0].ToLower();
            bool hasPhone = header.Contains("phone");

            // *** דלג על שורת כותרת ***
            foreach (var line in lines.Skip(1))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                var parts = line.Split(',');
                if (parts.Length < 4) continue;

                if (hasPhone)
                {
                    // *** פורמט חדש: id,test_id,name,email,phone,added_at ***
                    contacts.Add(new TestContact
                    {
                        Id      = int.TryParse(parts[0].Trim(), out var id) ? id : 0,
                        TestId  = parts[1].Trim(),
                        Name    = parts[2].Trim(),
                        Email   = parts[3].Trim(),
                        Phone   = parts.Length > 4 ? parts[4].Trim() : "",
                        AddedAt = parts.Length > 5 ? parts[5].Trim() : ""
                    });
                }
                else
                {
                    // *** פורמט ישן: id,test_id,name,email,added_at ***
                    contacts.Add(new TestContact
                    {
                        Id      = int.TryParse(parts[0].Trim(), out var id) ? id : 0,
                        TestId  = parts[1].Trim(),
                        Name    = parts[2].Trim(),
                        Email   = parts[3].Trim(),
                        Phone   = "",  // *** אין טלפון בפורמט ישן ***
                        AddedAt = parts.Length > 4 ? parts[4].Trim() : ""
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ReadContactsFromCsv Error: {ex.Message}");
        }

        return contacts;
    }

    // ==========================================
    // *** כתיבת כל אנשי הקשר ל-CSV ***
    // ==========================================
    private void WriteContactsToCsv(List<TestContact> contacts)
    {
        try
        {
            var dir = Path.GetDirectoryName(_contactsFilePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var lines = new List<string>
            {
                "id,test_id,name,email,phone,added_at"
            };

            foreach (var c in contacts)
            {
                // *** escape פסיקים בשם ***
                var safeName  = c.Name.Replace(",", " ");
                var safeEmail = c.Email.Replace(",", "");
                var safePhone = (c.Phone ?? "").Replace(",", ""); 

                lines.Add(
                    $"{c.Id},{c.TestId},{safeName}," +
                    $"{safeEmail},{safePhone},{c.AddedAt}"); 
            }

            System.IO.File.WriteAllLines(
                _contactsFilePath, lines);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"WriteContactsToCsv Error: {ex.Message}");
        }
    }

    // ==========================================
    // *** שליפת אנשי קשר לטסט ספציפי ***
    // ==========================================
    private List<TestContact> GetContactsForTest(string testId)
    {
        if (string.IsNullOrWhiteSpace(testId))
            return new List<TestContact>();

        return ReadContactsFromCsv()
            .Where(c => c.TestId == testId)
            .OrderBy(c => c.Name)
            .ToList();
    }

    // ==========================================
    // *** GetContacts endpoint ***
    // ==========================================
    [HttpGet]
    public IActionResult GetContacts(string testId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(testId))
                return Json(new
                {
                    success = false,
                    message = "testId is required"
                });

            var contacts = GetContactsForTest(testId);

            return Json(new
            {
                success  = true,
                testId,
                contacts
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"GetContacts Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // ==========================================
    // *** AddContact endpoint ***
    // ==========================================
    [HttpPost]
    public IActionResult AddContact(
        [FromBody] AddContactRequest req)
    {
        try
        {
            // *** ולידציה ***
            if (string.IsNullOrWhiteSpace(req?.TestId))
                return Json(new
                {
                    success = false,
                    message = "testId is required"
                });

            if (string.IsNullOrWhiteSpace(req.Name))
                return Json(new
                {
                    success = false,
                    message = "Name is required"
                });

            if (string.IsNullOrWhiteSpace(req.Email) ||
                !IsValidEmail(req.Email))
                return Json(new
                {
                    success = false,
                    message = "Invalid email address"
                });

            var all = ReadContactsFromCsv();

            // *** בדוק כפילות ***
            var duplicate = all.Any(c =>
                c.TestId == req.TestId.Trim() &&
                c.Email.Equals(req.Email.Trim(),
                    StringComparison.OrdinalIgnoreCase));

            if (duplicate)
                return Json(new
                {
                    success = false,
                    message = "מייל זה כבר קיים עבור בדיקה זו"
                });

            // *** ID חדש ***
            var newId = all.Count > 0
                ? all.Max(c => c.Id) + 1
                : 1;

            var contact = new TestContact
            {
                Id      = newId,
                TestId  = req.TestId.Trim(),
                Name    = req.Name.Trim(),
                Email   = req.Email.Trim().ToLower(),
                Phone   = req.Phone?.Trim() ?? "", 
                AddedAt = DateTime.UtcNow
                              .ToString("yyyy-MM-dd")
            };

            all.Add(contact);
            WriteContactsToCsv(all);

            return Json(new
            {
                success = true,
                message = "איש הקשר נוסף בהצלחה",
                contact
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"AddContact Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // ==========================================
    // *** UpdateContact endpoint ***
    // ==========================================
    [HttpPost]
    public IActionResult UpdateContact(
        [FromBody] UpdateContactRequest req)
    {
        try
        {
            if (req == null || req.Id <= 0)
                return Json(new
                {
                    success = false,
                    message = "Invalid ID"
                });

            if (string.IsNullOrWhiteSpace(req.Name))
                return Json(new
                {
                    success = false,
                    message = "Name is required"
                });

            if (string.IsNullOrWhiteSpace(req.Email) ||
                !IsValidEmail(req.Email))
                return Json(new
                {
                    success = false,
                    message = "Invalid email address"
                });

            var all = ReadContactsFromCsv();
            var contact = all.FirstOrDefault(c => c.Id == req.Id);

            if (contact == null)
                return Json(new
                {
                    success = false,
                    message = "Contact not found"
                });

            // *** בדוק כפילות מייל — מלבד הרשומה הנוכחית ***
            var duplicate = all.Any(c =>
                c.Id != req.Id &&
                c.TestId == contact.TestId &&
                c.Email.Equals(req.Email.Trim(),
                    StringComparison.OrdinalIgnoreCase));

            if (duplicate)
                return Json(new
                {
                    success = false,
                    message = "מייל זה כבר קיים עבור בדיקה זו"
                });

            contact.Name  = req.Name.Trim();
            contact.Email = req.Email.Trim().ToLower();
            contact.Phone = req.Phone?.Trim() ?? "";

            WriteContactsToCsv(all);

            return Json(new
            {
                success = true,
                message = "איש הקשר עודכן בהצלחה",
                contact
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"UpdateContact Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // ==========================================
    // *** DeleteContact endpoint ***
    // ==========================================
    [HttpPost]
    public IActionResult DeleteContact(
        [FromBody] DeleteContactRequest req)
    {
        try
        {
            if (req == null || req.Id <= 0)
                return Json(new
                {
                    success = false,
                    message = "Invalid ID"
                });

            var all = ReadContactsFromCsv();
            var contact = all.FirstOrDefault(
                c => c.Id == req.Id);

            if (contact == null)
                return Json(new
                {
                    success = false,
                    message = "Contact not found"
                });

            all.Remove(contact);
            WriteContactsToCsv(all);

            return Json(new
            {
                success = true,
                message = "Deleted successfully"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"DeleteContact Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // ==========================================
    // FetchLatestSuiteNames — שולף שמות עדכניים
    // ==========================================

    [HttpGet]
    public async Task<IActionResult> FetchLatestSuiteNames()
    {
        try
        {
            var suiteConfig   = new SuiteConfigController(_httpClientFactory, _secrets);
            var configEntries = suiteConfig.ReadSuitesFromCsv();

            if (!configEntries.Any())
                return Json(new { success = true, 
                                names   = new Dictionary<string,string>() });

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

            var names = new Dictionary<string, string>();

            // שלוף שם עדכני לכל סוויטה במקביל
            var tasks = configEntries.Select(async entry =>
            {
                var query = new
                {
                    _source = new[] { "container_name" },
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
                                        ["container_uid"] =
                                            entry.ParentUid
                                    }
                                },
                                new
                                {
                                    term = new Dictionary<string, object>
                                    {
                                        ["container_type"] = "suite"
                                    }
                                }
                            }
                        }
                    },
                    size = 1,
                    sort = new object[]
                    {
                        new Dictionary<string, object>
                        {
                            ["start_time"] = "desc"
                        }
                    }
                };

                var json    = JsonSerializer.Serialize(query);
                var content = new StringContent(
                    json, Encoding.UTF8, "application/json");

                try
                {
                    var response = await client.PostAsync(
                        $"{_elasticBaseUrl}/cbr-*/_search", content);

                    if (!response.IsSuccessStatusCode) return;

                    var body = await response.Content
                                            .ReadAsStringAsync();
                    var doc  = JsonSerializer
                                .Deserialize<JsonElement>(body);

                    if (!doc.TryGetProperty("hits", out var h1)) return;
                    if (!h1.TryGetProperty("hits",  out var h2)) return;

                    foreach (var hit in h2.EnumerateArray())
                    {
                        if (!hit.TryGetProperty("_source", out var src))
                            continue;

                        if (src.TryGetProperty(
                                "container_name", out var np))
                        {
                            var name = np.GetString() ?? "";
                            if (!string.IsNullOrEmpty(name))
                            {
                                lock (names)
                                {
                                    names[entry.ParentUid] = name;
                                }
                            }
                        }
                        break;
                    }
                }
                catch { /* המשך לסוויטה הבאה */ }
            });

            await Task.WhenAll(tasks);

            return Json(new { success = true, names });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"FetchLatestSuiteNames Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }

    // ==========================================
    // BulkUpdateSuiteNames — עדכון מרובה
    // ==========================================

    [HttpPost]
    public IActionResult BulkUpdateSuiteNames(
        [FromBody] BulkUpdateRequest req)
    {
        try
        {
            if (req?.Updates == null || !req.Updates.Any())
                return Json(new
                {
                    success = false,
                    message = "No updates provided"
                });

            var suiteConfig = new SuiteConfigController(
                _httpClientFactory, _secrets);
            var all = suiteConfig.ReadSuitesFromCsv();

            int updatedCount = 0;

            foreach (var update in req.Updates)
            {
                var entry = all.FirstOrDefault(
                    s => s.Id == update.Id);

                if (entry == null) continue;

                entry.DisplayName = update.DisplayName?.Trim() ?? "";
                updatedCount++;
            }

            if (updatedCount > 0)
                suiteConfig.WriteSuitesToCsv(all);

            return Json(new
            {
                success      = true,
                updatedCount,
                message = $"{updatedCount} suites updated successfully"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"BulkUpdateSuiteNames Error: {ex.Message}");
            return StatusCode(500, new
            {
                success = false,
                message = ex.Message
            });
        }
    }
    // ==========================================
    // *** ולידציית מייל ***
    // ==========================================
    private static bool IsValidEmail(string email)
    {
        try
        {
            var addr = new System.Net.Mail
                           .MailAddress(email);
            return addr.Address ==
                   email.Trim().ToLower();
        }
        catch
        {
            return false;
        }
    }

    // ==========================================
    // *** נרמול דומיין מייל של מנורה ***
    // ==========================================
    private static string NormalizeEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return email?.Trim().ToLower() ?? "";

        var normalized = email.Trim().ToLower();

        // *** החלף את שני הדומיינים לדומיין אחיד לצורך השוואה ***
        normalized = normalized
            .Replace("@menoramivt.co.il", "@menora.co.il");

        return normalized;
    }

    // ==========================================
    // *** LookupPhoneByNameEmail endpoint ***
    // ==========================================
    [HttpGet]
    public IActionResult LookupPhoneByNameEmail(
        string name, string email)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name) ||
                string.IsNullOrWhiteSpace(email))
                return Json(new { success = false, phone = "" });

            var csvPath = PortalPaths.UnderFiles(@"phone_directory.csv");

            if (!System.IO.File.Exists(csvPath))
                return Json(new { success = false, phone = "" });

            var lines      = System.IO.File.ReadAllLines(csvPath);
            var nameLower  = name.Trim().ToLower();
            var emailNorm  = NormalizeEmail(email); 

            foreach (var line in lines.Skip(1))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;

                var cols = line.Split(',');
                if (cols.Length < 6) continue;

                var rowName  = cols[0].Trim().ToLower();
                var rowEmail = cols.Length > 7
                    ? NormalizeEmail(cols[7]) : "";
                var rowPhone = cols.Length > 5
                    ? cols[5].Trim() : "";
                var rowExt   = cols.Length > 6
                    ? cols[6].Trim() : "";

                // *** חובה: גם שם מלא וגם מייל חייבים להתאים במדויק ***
                bool nameMatch  = rowName  == nameLower;
                bool emailMatch = !string.IsNullOrEmpty(rowEmail) &&
                                rowEmail == emailNorm;

                if (nameMatch && emailMatch)
                {
                    var phone = !string.IsNullOrEmpty(rowPhone)
                        ? rowPhone
                        : !string.IsNullOrEmpty(rowExt)
                            ? rowExt
                            : "";

                    return Json(new
                    {
                        success = true,
                        phone
                    });
                }
            }

            // *** לא נמצאה התאמה מלאה ***
            return Json(new { success = false, phone = "" });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"LookupPhoneByNameEmail Error: {ex.Message}");
            return Json(new { success = false, phone = "" });
        }
    }

    [HttpGet]   
    public IActionResult GetDowntimeSystems()
    {
        try
        {
            var systems = ReadDowntimeSystemsFromCsv();
            return Json(new { success = true, systems });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult AddDowntimeSystem([FromBody] DowntimeSystem req)
    {
        try
        {
            if (req == null || req.Num <= 0)
                return Json(new { success = false, message = "מספר מערכת חסר" });
            if (string.IsNullOrWhiteSpace(req.En))
                return Json(new { success = false, message = "שם אנגלי חסר" });
            if (string.IsNullOrWhiteSpace(req.He))
                return Json(new { success = false, message = "שם עברי חסר" });

            var all = ReadDowntimeSystemsFromCsv();

            if (all.Any(s => s.Num == req.Num))
                return Json(new { success = false, message = "מספר מערכת כבר קיים" });

            all.Add(req);
            WriteDowntimeSystemsToCsv(all);

            return Json(new { success = true, message = "המערכת נוספה בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult UpdateDowntimeSystem([FromBody] DowntimeSystem req)
    {
        try
        {
            if (req == null || req.Num <= 0)
                return Json(new { success = false, message = "מספר מערכת חסר" });

            var all = ReadDowntimeSystemsFromCsv();
            var existing = all.FirstOrDefault(s => s.Num == req.Num);

            if (existing == null)
                return Json(new { success = false, message = "מערכת לא נמצאה" });

            existing.En = req.En?.Trim() ?? existing.En;
            existing.He = req.He?.Trim() ?? existing.He;

            WriteDowntimeSystemsToCsv(all);

            return Json(new { success = true, message = "המערכת עודכנה בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult DeleteDowntimeSystem([FromBody] DeleteDowntimeRequest req)
    {
        try
        {
            if (req == null || req.Num <= 0)
                return Json(new { success = false, message = "מספר מערכת חסר" });

            var all = ReadDowntimeSystemsFromCsv();
            var toDelete = all.FirstOrDefault(s => s.Num == req.Num);

            if (toDelete == null)
                return Json(new { success = false, message = "מערכת לא נמצאה" });

            all.Remove(toDelete);
            WriteDowntimeSystemsToCsv(all);

            return Json(new { success = true, message = "המערכת נמחקה בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    private List<DowntimeSystem> ReadDowntimeSystemsFromCsv()
    {
        var result = new List<DowntimeSystem>();
        try
        {
            if (!System.IO.File.Exists(_downtimeSystemsPath))
            {
                // צור קובץ ברירת מחדל עם הרשימה הקיימת
                WriteDefaultDowntimeSystems();
            }

            var lines = System.IO.File.ReadAllLines(_downtimeSystemsPath);
            foreach (var line in lines.Skip(1))
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var cols = line.Split(',');
                if (cols.Length < 3) continue;
                if (!int.TryParse(cols[0].Trim(), out var num)) continue;

                result.Add(new DowntimeSystem
                {
                    Num = num,
                    En  = cols[1].Trim(),
                    He  = cols[2].Trim()
                });
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ReadDowntimeSystemsFromCsv Error: {ex.Message}");
        }
        return result.OrderBy(s => s.Num).ToList();
    }

    private void WriteDowntimeSystemsToCsv(List<DowntimeSystem> systems)
    {
        var dir = Path.GetDirectoryName(_downtimeSystemsPath)!;
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);

        var lines = new List<string> { "num,en,he" };
        foreach (var s in systems.OrderBy(x => x.Num))
        {
            var safeEn = s.En.Contains(',') ? $"\"{s.En}\"" : s.En;
            var safeHe = s.He.Contains(',') ? $"\"{s.He}\"" : s.He;
            lines.Add($"{s.Num},{safeEn},{safeHe}");
        }
        System.IO.File.WriteAllLines(_downtimeSystemsPath, lines);
    }

    private void WriteDefaultDowntimeSystems()
    {
        var systems = new List<DowntimeSystem>
        {
            new() { Num = 5,   En = "IturMutav-Module",              He = "מערכות איתור מוטבים" },
            new() { Num = 6,   En = "HealthClaims-Application",      He = "מערכת תביעות בריאות" },
            new() { Num = 7,   En = "DentalClinics-Application",     He = "פורטל ממ\"ש" },
            new() { Num = 11,  En = "LombardyHealthClaims-Module",   He = "שולחן עבודה לומברדי תביעות בריאות" },
            new() { Num = 12,  En = "HealthInsurance-Application",   He = "מערכת התפעול: בריאות" },
            new() { Num = 13,  En = "HealthForgn-Application",       He = "מערכת עובדים זרים" },
            new() { Num = 21,  En = "GviaElementary-Application",    He = "גבייה אלמנטרי ובריאות" },
            new() { Num = 23,  En = "UnifiedTasks-Application",      He = "תור מאוחד תביעות אלמנטרי" },
            new() { Num = 24,  En = "Tamino-Application",            He = "מערכת דוחות (טמינו)" },
            new() { Num = 25,  En = "HESKHATAVOT-Application",       He = "ניהול הסכמים והצעות" },
            new() { Num = 27,  En = "TopazPension-Application",      He = "טופז פנסיה" },
            new() { Num = 35,  En = "KdamKlitaPension-Module",       He = "קדם קליטה פנסיה וגמל" },
            new() { Num = 44,  En = "AgentsContrct-Module",          He = "מערכת הסכמי סוכנים" },
            new() { Num = 47,  En = "NIHULIT-Application",           He = "מערכת ניהולית" },
            new() { Num = 51,  En = "IQULIM-Application",            He = "מערכת עיקולים" },
            new() { Num = 53,  En = "PublicAffairs-Application",     He = "מערכת פניות הציבור" },
            new() { Num = 71,  En = "HafakaYAMI-Module",             He = "הפקה ימי" },
            new() { Num = 72,  En = "ElementaryClaims-Application",  He = "מערכת תביעות אלמנטרי" },
            new() { Num = 75,  En = "TOR_HATAM-Application",         He = "תור לחתם אלמנטרי" },
            new() { Num = 81,  En = "ElementaryNet-Application",     He = "אלמנטרינט" },
            new() { Num = 102, En = "MeyoazimPension-Module",        He = "ניהול יועצים ועמיתים מיועצים פנסיונים" },
            new() { Num = 112, En = "KUPA-Application",              He = "קופה" },
            new() { Num = 138, En = "MIVTAH-Application",            He = "מבטח" },
            new() { Num = 139, En = "TopazLife-Application",         He = "טופז ביטוח חיים" },
            new() { Num = 140, En = "LifeClaims-Application",        He = "מערכת תביעות ביטוח חיים" },
            new() { Num = 141, En = "Medirisk-Application",          He = "מדיריסק" },
            new() { Num = 143, En = "OzmaLife-Module",               He = "עוצמה" },
            new() { Num = 148, En = "LombardyDeskLife-Module",       He = "שולחן עבודה לומברדי תביעות חיים" },
            new() { Num = 152, En = "PowerAttorney-Application",     He = "ייפוי כח" },
            new() { Num = 189, En = "MenoraWebSite-Application",     He = "אתר קבוצת מנורה מבטחים" },
            new() { Num = 195, En = "DentalClaims-Application",      He = "מערכת תביעות שיניים" },
            new() { Num = 201, En = "ElementaryMX-Application",      He = "ניהול מבצעים אלמנטרי" },
            new() { Num = 210, En = "GviaGemel-Module",              He = "מערכת גבייה גמל" },
            new() { Num = 229, En = "Travel-Application",            He = "מערכת לביטוח נסיעות לחו\"ל" },
            new() { Num = 267, En = "GviaLife-Module",               He = "גבייה ביטוח חיים" },
            new() { Num = 268, En = "HulyotLife-Module",             He = "חוליות" },
            new() { Num = 270, En = "HalvaotLife-Module",            He = "הלוואות ביטוח חיים" },
            new() { Num = 271, En = "ElementaryIway-Application",    He = "מערכות הפקה אלמנטרי IWAY" },
            new() { Num = 292, En = "NiudOutPension-Application",    He = "ניוד יוצא פנסיה" },
            new() { Num = 293, En = "NiudOutGemel-Application",      He = "ניוד יוצא גמל" },
            new() { Num = 294, En = "NiudOutLife-Application",       He = "ניוד יוצא ביטוח חיים" },
            new() { Num = 373, En = "TopazPensionClaims-Module",     He = "תביעות פנסיה נכות ושארים" },
            new() { Num = 379, En = "SavingControl-ServiceBSI",      He = "בקרת חסכון" },
            new() { Num = 387, En = "CollectiveLife-Application",    He = "קולקטיב חיים" },
            new() { Num = 423, En = "LinksToken-ServiceAPI",         He = "LinksToken" },
            new() { Num = 464, En = "eMergeTopaz-Applitech",         He = "eMerge Topaz" },
            new() { Num = 467, En = "eMergeNonTopaz-Applitech",      He = "eMerge Non Topaz" },
            new() { Num = 504, En = "Niud In Life-Application",      He = "ניוד נכנס ביטוח חיים (חוזר ניוד)" },
            new() { Num = 505, En = "NiudInPension-Application",     He = "ניוד נכנס פנסיה וגמל (חוזר ניוד)" },
            new() { Num = 506, En = "NiudJoining-Application",       He = "תהליך מקדים – ניוד אגב הצטרפות" },
            new() { Num = 510, En = "BPM Tashtit Lombardi-Application", He = "תשתית BPM - לומברדי" },
            new() { Num = 531, En = "HafakaWeb-Application",         He = "NEXT" },
            new() { Num = 537, En = "OshAmlot-Application",          He = "דוחות עמלות וחשבות" },
            new() { Num = 555, En = "EMPDB-Application",             He = "מנחם" },
            new() { Num = 573, En = "BPMNiyudTefen-Application",     He = "ניהול בקשות ניוד תפנסופט" },
            new() { Num = 578, En = "ODS-Applitech",                 He = "ODS" },
            new() { Num = 597, En = "LombardyLoanMMPG",              He = "LombardyLoanMMPG" },
        };
        WriteDowntimeSystemsToCsv(systems);
    }

    // ==========================================
    // *** ניהול קובץ נעילה של Run All ***
    // ==========================================
    private (bool IsLocked, int TimeLeftSecs, string TimeLeftStr, 
         string TriggeredBy, string TriggeredAt) 
    CheckRunAllLock()
    {
        try
        {
            if (!System.IO.File.Exists(_runAllLockFilePath))
                return (false, 0, "", "", "");

            var content = System.IO.File.ReadAllText(
                _runAllLockFilePath).Trim();

            var lines = content
                .Split('\n', StringSplitOptions.RemoveEmptyEntries)
                .Select(l => l.Trim())
                .ToArray();

            // *** שורה ראשונה — זמן UTC ***
            var firstLine = lines.FirstOrDefault() ?? "";

            if (!DateTime.TryParse(firstLine, null,
                    System.Globalization.DateTimeStyles.RoundtripKind,
                    out var lockTime))
            {
                TryDeleteLockFile();
                return (false, 0, "", "", "");
            }

            if (lockTime.Kind != DateTimeKind.Utc)
                lockTime = DateTime.SpecifyKind(lockTime, DateTimeKind.Utc);

            var elapsed  = DateTime.UtcNow - lockTime;
            var timeLeft = _lockDuration - elapsed;

            if (timeLeft <= TimeSpan.Zero)
            {
                TryDeleteLockFile();
                return (false, 0, "", "", "");
            }

            // *** קרא triggered_by מהשורה השנייה ***
            var triggeredBy = "";
            var triggeredByLine = lines
                .FirstOrDefault(l => l.StartsWith("triggered_by="));
            if (triggeredByLine != null)
                triggeredBy = triggeredByLine
                    .Substring("triggered_by=".Length).Trim();

            // *** המר זמן הנעילה לשעון ישראל לתצוגה ***
            var triggeredAt = "";
            try
            {
                var israelZone = TimeZoneInfo.FindSystemTimeZoneById(
                    "Israel Standard Time");
                var israelTime = TimeZoneInfo.ConvertTimeFromUtc(
                    lockTime, israelZone);
                triggeredAt = israelTime.ToString("HH:mm:ss");
            }
            catch
            {
                triggeredAt = lockTime.ToString("HH:mm:ss");
            }

            var secs    = (int)Math.Ceiling(timeLeft.TotalSeconds);
            var mins    = secs / 60;
            var remSecs = secs % 60;
            var str     = mins > 0
                ? $"{mins}m {remSecs}s"
                : $"{remSecs}s";

            return (true, secs, str, triggeredBy, triggeredAt);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"CheckRunAllLock Error: {ex.Message}");
            return (false, 0, "", "", "");
        }
    }

    private void CreateRunAllLock(string username)
    {
        try
        {
            var dir = Path.GetDirectoryName(_runAllLockFilePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            // *** כתוב רק זמן UTC בשורה הראשונה — CheckRunAllLock קורא רק אותה ***
            var content = 
                $"{DateTime.UtcNow:o}\n" +
                $"triggered_by={username}\n" +
                $"expires={DateTime.UtcNow.Add(_lockDuration):o}";

            System.IO.File.WriteAllText(
                _runAllLockFilePath, content);

            // *** תזמן מחיקה אוטומטית אחרי 5 דקות ***
            _ = Task.Delay(_lockDuration).ContinueWith(_ =>
            {
                TryDeleteLockFile();
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"CreateRunAllLock Error: {ex.Message}");
        }
    }

    private void TryDeleteLockFile()
    {
        try
        {
            if (System.IO.File.Exists(_runAllLockFilePath))
                System.IO.File.Delete(_runAllLockFilePath);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"TryDeleteLockFile Error: {ex.Message}");
        }
    }
}
// ==========================================
// מודלים
// ==========================================

public class SuiteInfo
{
    public string SuiteUid     { get; set; } = "";
    public string SuiteName    { get; set; } = "";
    public string Status       { get; set; } = "";
    public string StartTime    { get; set; } = "";
    public string LastRunTime  { get; set; } = "";
    public long   Duration     { get; set; }
    public List<SuiteTestResult> Tests { get; set; } = new();
    public string SuiteNumber  { get; set; } = "";
    public string SuiteTeam    { get; set; } = "";
    public string SuiteBrowser { get; set; } = "";
    public string SuiteKey     { get; set; } = "";
    public string CloudBeatId  { get; set; } = "";
    public bool IsPatchSuite   { get; set; } = false;
}

public class SuiteTestResult
{
    public string Id              { get; set; } = "";
    public string ContainerName   { get; set; } = "";
    public string Status          { get; set; } = "";
    public string StartTime       { get; set; } = "";
    public string LastRunTime     { get; set; } = "";
    public long   Duration        { get; set; }
    public double DurationSeconds { get; set; }
    public string Department      { get; set; } = "";
    public string TestId          { get; set; } = "";
    public string TestName        { get; set; } = "";
    public string Priority        { get; set; } = "";
    public List<TestContact> Contacts { get; set; } = new();
}

public class TestContact
{
    public int    Id      { get; set; }
    public string TestId  { get; set; } = "";
    public string Name    { get; set; } = "";
    public string Email   { get; set; } = "";
    public string Phone   { get; set; } = "";
    public string AddedAt { get; set; } = "";
}

public class AddContactRequest
{
    public string TestId { get; set; } = "";
    public string Name   { get; set; } = "";
    public string Email  { get; set; } = "";
    public string Phone  { get; set; } = "";
}

public class UpdateContactRequest
{
    public int    Id    { get; set; }
    public string Name  { get; set; } = "";
    public string Email { get; set; } = "";
    public string Phone { get; set; } = "";
}

public class DeleteContactRequest
{
    public int Id { get; set; }
}

public class BulkUpdateRequest
{
    public List<BulkUpdateItem> Updates { get; set; } = new();
}

public class BulkUpdateItem
{
    public int    Id          { get; set; }
    public string DisplayName { get; set; } = "";
}

public class RunSuiteRequest
{
    public string CloudBeatId   { get; set; } = "";
    public string RunnerType    { get; set; } = "automation";
    public bool   RunFailedOnly { get; set; } = false; 
}

public class RunAllSuitesRequest
{
    public string RunnerType { get; set; } = "automation";
    public bool   RunPatchSuites { get; set; } = false;
}

public class DowntimeSystem
{
    public int    Num { get; set; }
    public string En  { get; set; } = "";
    public string He  { get; set; } = "";
}

public class DeleteDowntimeRequest
{
    public int Num { get; set; }
}

public class RunCaseRequest
{
    public string CloudBeatId { get; set; } = "";
    public string RunnerType  { get; set; } = "automation";
}

public class SuitePermissions
{
    public List<string> Admins      { get; set; } = new();
    public List<string> Runners     { get; set; } = new();
    public List<string> Viewers     { get; set; } = new();
    public List<string> Editors { get; set; } = new();
    public string       LastUpdated { get; set; } = "";
    public string?      UpdatedBy   { get; set; }
}