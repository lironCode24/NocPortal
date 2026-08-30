// file: GrafanaDashboardController.cs

using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

public class GrafanaDashboardController : Controller
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SecretsService     _secrets;
    private readonly string             _proxyUrl =
        "http://10.10.111.209:8080";

    // UID של ה-datasource מתוך ה-JSON
    private const string _datasourceUid =
        "e6fd4fb9-df59-4226-a1aa-d7e88054b6e9";

    // ✅ URL הנכון שגראפנה משתמשת בו
    private string MetricsQueryUrl =>
        $"https://menora-itom.onbmc.com" +
        $"/dashboards/api/datasources/proxy" +
        $"/uid/{_datasourceUid}" +
        $"/metrics-query-service/api/v1.0/query_range";

    private string _helixAccessKey =>
        _secrets.HelixAccessKey;
    private string _helixAccessSecretKey =>
        _secrets.HelixAccessSecret;
    private string _helixTenantId =>
        _secrets.HelixTenantId;
    private string _helixApiBaseUrl =>
        _secrets.HelixBaseUrl;

    private static string   _jwtToken    = null;
    private static DateTime _tokenExpiry =
        DateTime.MinValue;

    private static readonly System.Threading.SemaphoreSlim
        _tokenLock =
            new System.Threading.SemaphoreSlim(1, 1);

    public GrafanaDashboardController(
        IHttpClientFactory httpClientFactory,
        SecretsService     secrets)
    {
        _httpClientFactory = httpClientFactory;
        _secrets           = secrets;
    }

    // =============================================
    // Endpoints
    // =============================================

    [HttpPost]
    public async Task<IActionResult> QueryPanel(
        [FromBody] PanelQueryRequest request)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(request?.Expr))
                return BadRequest(new
                {
                    success = false,
                    error   = "חסרה שאילתה (expr)"
                });

            await EnsureValidToken();
            var client = CreateHelixHttpClient();
            var result = await QuerySinglePanel(
                client,
                request.PanelId,
                request.Expr);

            return Ok(new
            {
                success   = true,
                panelId   = result.PanelId,
                status    = result.Status,
                items     = result.Items,
                queriedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            LogError("QueryPanel", ex);
            return StatusCode(500, new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    [HttpPost]
    public async Task<IActionResult> QueryAllPanels(
        [FromBody] QueryAllPanelsRequest request)
    {
        try
        {
            if (Request.Host.Host.Contains("localhost"))
                return GenerateMockData();

            if (request?.Panels == null ||
                !request.Panels.Any())
                return BadRequest(new
                {
                    success = false,
                    error   = "חסרים פאנלים ברשימה"
                });

            await EnsureValidToken();
            var client = CreateHelixHttpClient();

            var results =
                await QueryAllPanelsParallel(
                    client, request.Panels);

            string overallStatus = "up";
            if (results.Values.Any(
                    r => r.Status == "unknown"))
                overallStatus = "unknown";
            if (results.Values.Any(
                    r => r.Status == "critical"))
                overallStatus = "critical";

            return Ok(new
            {
                success = true,
                overallStatus,
                results,
                queriedAt = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            LogError("QueryAllPanels", ex);
            return StatusCode(500, new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    [HttpGet]
    public async Task<IActionResult> HealthCheck()
    {
        try
        {
            await EnsureValidToken();
            return Ok(new
            {
                success     = !string.IsNullOrEmpty(_jwtToken),
                tokenValid  = !string.IsNullOrEmpty(_jwtToken),
                tokenExpiry = _tokenExpiry,
                checkedAt   = DateTime.UtcNow
            });
        }
        catch (Exception ex)
        {
            LogError("HealthCheck", ex);
            return StatusCode(500, new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // =============================================
    // DEBUG: בדיקת ה-URL הנכון
    // =============================================

    [HttpGet]
    public async Task<IActionResult> TestMetricsApi(
        string hostname = "HFWBLE")
    {
        var log = new List<string>();

        try
        {
            await EnsureValidToken();
            var client = CreateHelixHttpClient();

            var now   = DateTimeOffset.UtcNow
                .ToUnixTimeSeconds();
            var start = now - (5 * 60);

            var expr =
                $"Availability{{hostname=~" +
                $"\"(?i).*{hostname}.*\"}}";

            log.Add($"URL: {MetricsQueryUrl}");
            log.Add($"Expr: {expr}");

            // ✅ POST עם form-urlencoded
            var formData =
                new FormUrlEncodedContent(
                    new Dictionary<string, string>
                    {
                        ["query"] = expr,
                        ["start"] = start.ToString(),
                        ["end"]   = now.ToString(),
                        ["step"]  = "60"
                    });

            var resp = await client.PostAsync(
                MetricsQueryUrl, formData);

            var body = await resp.Content
                .ReadAsStringAsync();

            log.Add($"Status: {(int)resp.StatusCode}");
            log.Add($"Body: {body.Substring(0, Math.Min(500, body.Length))}");

            return Ok(new
            {
                success = resp.IsSuccessStatusCode,
                log
            });
        }
        catch (Exception ex)
        {
            log.Add($"ERROR: {ex.Message}");
            return Ok(new { success = false, log });
        }
    }

    // =============================================
    // נתונים מדומים
    // =============================================

    private IActionResult GenerateMockData()
    {
        var mockStatuses = new Dictionary<int, string>
        {
            [59] = "critical",
            [47] = "up",
            [48] = "up",
            [49] = "up",
            [50] = "up",
            [51] = "critical",
            [55] = "up",
            [44] = "up",
            [45] = "up",
            [46] = "up",
            [52] = "up",
            [53] = "up",
            [54] = "up",
            [56] = "up",
            [57] = "up",
            [58] = "up"
        };

        var results =
            new Dictionary<int, PanelStatusResult>();

        foreach (var kv in mockStatuses)
        {
            results[kv.Key] = new PanelStatusResult
            {
                PanelId = kv.Key,
                Status  = kv.Value,
                Items   = new List<StatusItem>
                {
                    new StatusItem
                    {
                        Hostname =
                            $"mock-host-{kv.Key}",
                        Value = kv.Value ==
                            "critical" ? 0 : 100
                    }
                }
            };
        }

        return Ok(new
        {
            success       = true,
            overallStatus = "critical",
            results,
            queriedAt     = DateTime.UtcNow
        });
    }

    // =============================================
    // ניהול טוקן
    // =============================================

    private async Task EnsureValidToken()
    {
        if (!string.IsNullOrEmpty(_jwtToken) &&
            _tokenExpiry > DateTime.UtcNow)
            return;

        await _tokenLock.WaitAsync();
        try
        {
            if (!string.IsNullOrEmpty(_jwtToken) &&
                _tokenExpiry > DateTime.UtcNow)
                return;

            var client = CreateHttpClientWithProxy();

            var loginBody = new
            {
                access_key        = _helixAccessKey,
                access_secret_key = _helixAccessSecretKey
            };

            var loginResp = await client.PostAsync(
                $"{_helixApiBaseUrl}" +
                $"/ims/api/v1/access_keys/login",
                BuildJsonContent(loginBody));

            loginResp.EnsureSuccessStatusCode();

            var loginData = JsonSerializer
                .Deserialize<JsonElement>(
                    await loginResp.Content
                        .ReadAsStringAsync());

            var refreshToken =
                loginData.GetProperty("token")
                    .GetString();

            var tokenResp = await client.PostAsync(
                $"{_helixApiBaseUrl}" +
                $"/ims/api/v1/auth/tokens",
                BuildJsonContent(
                    new { token = refreshToken }));

            tokenResp.EnsureSuccessStatusCode();

            var tokenData = JsonSerializer
                .Deserialize<JsonElement>(
                    await tokenResp.Content
                        .ReadAsStringAsync());

            _jwtToken =
                tokenData
                    .GetProperty("json_web_token")
                    .GetString();

            _tokenExpiry =
                DateTime.UtcNow.AddMinutes(10);

            LogDebug("Token",
                $"Refreshed, expires " +
                $"{_tokenExpiry:HH:mm:ss}");
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    // =============================================
    // HttpClient
    // =============================================

    private HttpClient CreateHttpClientWithProxy()
    {
        var handler = new HttpClientHandler
        {
            Proxy    = new System.Net.WebProxy(_proxyUrl),
            UseProxy = true,
            ServerCertificateCustomValidationCallback =
                (s, c, ch, e) => true
        };

        var client = new HttpClient(handler);
        client.DefaultRequestHeaders
            .Add("Accept", "application/json");
        return client;
    }

    private HttpClient CreateHelixHttpClient()
    {
        var client = CreateHttpClientWithProxy();

        if (!string.IsNullOrEmpty(_jwtToken))
        {
            // ✅ x-ds-authorization - כמו שגראפנה שולחת
            client.DefaultRequestHeaders
                .Add("x-ds-authorization",
                    $"Bearer {_jwtToken}");

            // ✅ x-grafana-org-id = tenantId
            client.DefaultRequestHeaders
                .Add("x-grafana-org-id",
                    _helixTenantId);

            // ✅ source header
            client.DefaultRequestHeaders
                .Add("source", "monitor");

            // Authorization רגיל גם כן
            client.DefaultRequestHeaders
                .Authorization =
                new System.Net.Http.Headers
                    .AuthenticationHeaderValue(
                        "Bearer", _jwtToken);
        }

        return client;
    }

    // =============================================
    // שאילתות במקביל
    // =============================================

    private async Task<Dictionary<int, PanelStatusResult>>
        QueryAllPanelsParallel(
            HttpClient              client,
            List<PanelQueryRequest> panels)
    {
        var results =
            new Dictionary<int, PanelStatusResult>();

        var semaphore =
            new System.Threading.SemaphoreSlim(3, 3);

        var tasks = panels.Select(async panel =>
        {
            await semaphore.WaitAsync();
            try
            {
                var result = await QuerySinglePanel(
                    client,
                    panel.PanelId,
                    panel.Expr);

                lock (results)
                {
                    results[panel.PanelId] = result;
                }
            }
            finally
            {
                semaphore.Release();
            }
        });

        await Task.WhenAll(tasks);
        return results;
    }

    // =============================================
    // ✅ שאילתה לפאנל בודד - POST + form-urlencoded
    // =============================================

    private async Task<PanelStatusResult>
    QuerySinglePanel(
        HttpClient client,
        int        panelId,
        string     expr)
    {
        var result = new PanelStatusResult
        {
            PanelId = panelId,
            Status  = "unknown"
        };

        try
        {
            if (string.IsNullOrWhiteSpace(expr))
            {
                result.Error = "Empty expression";
                return result;
            }

            var now   = DateTimeOffset.UtcNow
                .ToUnixTimeSeconds();
            var start = now - (5 * 60);

            // ✅ POST עם form-urlencoded
            // בדיוק כמו שגראפנה שולחת
            var formData =
                new FormUrlEncodedContent(
                    new Dictionary<string, string>
                    {
                        ["query"] = expr,
                        ["start"] = start.ToString(),
                        ["end"]   = now.ToString(),
                        ["step"]  = "15"
                    });

            // ✅ הוסף x-panel-id header
            var request = new HttpRequestMessage(
                HttpMethod.Post,
                MetricsQueryUrl)
            {
                Content = formData
            };

            request.Headers.Add(
                "x-panel-id", panelId.ToString());

            LogDebug("Query",
                $"Panel {panelId}: POST " +
                $"{MetricsQueryUrl}");

            var response =
                await client.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                var errBody = await response.Content
                    .ReadAsStringAsync();

                LogDebug("Query",
                    $"Panel {panelId} failed " +
                    $"({(int)response.StatusCode}): " +
                    $"{errBody.Substring(0, Math.Min(200, errBody.Length))}");

                result.Error =
                    $"HTTP {(int)response.StatusCode}: " +
                    $"{errBody.Substring(0, Math.Min(100, errBody.Length))}";

                return result;
            }

            var json = await response.Content
                .ReadAsStringAsync();

            LogDebug("Query",
                $"Panel {panelId} OK: " +
                $"{json.Substring(0, Math.Min(200, json.Length))}");

            var parsed =
                JsonSerializer.Deserialize<JsonElement>(
                    json);

            var items = ExtractPrometheusItems(parsed);
            result.Items  = items;
            result.Status = CalculateStatus(items);

            LogDebug("Query",
                $"Panel {panelId}: " +
                $"{items.Count} items → " +
                $"{result.Status}");
        }
        catch (Exception ex)
        {
            result.Status = "unknown";
            result.Error  = ex.Message;
            LogError(
                $"QuerySinglePanel({panelId})", ex);
        }

        return result;
    }

    // =============================================
    // חילוץ נתונים
    // =============================================

    private List<StatusItem> ExtractPrometheusItems(
        JsonElement parsed)
    {
        var items = new List<StatusItem>();

        try
        {
            if (parsed.TryGetProperty(
                    "status", out var statusEl) &&
                statusEl.GetString() != "success")
            {
                LogDebug("Extract",
                    $"Status not success: " +
                    $"{statusEl.GetString()}");
                return items;
            }

            JsonElement resultEl;

            if (parsed.TryGetProperty(
                    "data", out var dataEl) &&
                dataEl.TryGetProperty(
                    "result", out resultEl))
            {
                // מבנה סטנדרטי
            }
            else if (parsed.TryGetProperty(
                    "result", out resultEl))
            {
                // מבנה ישיר
            }
            else
            {
                LogDebug("Extract",
                    "No result found in: " +
                    parsed.GetRawText().Substring(0,
                        Math.Min(300,
                            parsed.GetRawText()
                                .Length)));
                return items;
            }

            foreach (var item in
                resultEl.EnumerateArray())
            {
                string hostname = "";

                if (item.TryGetProperty(
                        "metric", out var metricEl))
                {
                    if (metricEl.TryGetProperty(
                            "hostname",
                            out var hnEl))
                    {
                        hostname =
                            hnEl.GetString() ?? "";
                    }
                    else if (metricEl.TryGetProperty(
                            "__name__",
                            out var nameEl))
                    {
                        hostname =
                            nameEl.GetString() ?? "";
                    }
                }

                double value = 0;

                // matrix: values = [[ts, val], ...]
                if (item.TryGetProperty(
                        "values", out var valuesEl))
                {
                    var arr = valuesEl
                        .EnumerateArray()
                        .ToList();

                    if (arr.Any())
                    {
                        var last = arr.Last();
                        if (last.ValueKind ==
                                JsonValueKind.Array &&
                            last.GetArrayLength() >= 2)
                        {
                            TryParseDouble(
                                last[1].GetString(),
                                out value);
                        }
                    }
                }
                // vector: value = [ts, val]
                else if (item.TryGetProperty(
                        "value", out var valueEl) &&
                    valueEl.ValueKind ==
                        JsonValueKind.Array &&
                    valueEl.GetArrayLength() >= 2)
                {
                    TryParseDouble(
                        valueEl[1].GetString(),
                        out value);
                }

                items.Add(new StatusItem
                {
                    Hostname = hostname,
                    Value    = value
                });
            }

            LogDebug("Extract",
                $"Extracted {items.Count} items");
        }
        catch (Exception ex)
        {
            LogError("ExtractPrometheusItems", ex);
        }

        return items;
    }

    // =============================================
    // חישוב סטטוס
    // =============================================

    private string CalculateStatus(
        List<StatusItem> items)
    {
        if (!items.Any())
            return "unknown";

        // Availability: 0=DOWN/Critical, 100=UP
        bool hasCritical = items.Any(
            i => i.Value < 0.5);

        if (hasCritical)
            return "critical";

        return "up";
    }

    // =============================================
    // פונקציות עזר
    // =============================================

    private StringContent BuildJsonContent(
        object body)
    {
        return new StringContent(
            JsonSerializer.Serialize(body),
            Encoding.UTF8,
            "application/json");
    }

    private bool TryParseDouble(
        string input, out double result)
    {
        return double.TryParse(
            input,
            System.Globalization.NumberStyles.Any,
            System.Globalization.CultureInfo
                .InvariantCulture,
            out result);
    }

    private void LogDebug(
        string category, string message)
    {
        System.Diagnostics.Debug.WriteLine(
            $"[GrafanaDashboard][{category}] " +
            $"{message}");
    }

    private void LogError(
        string category, Exception ex)
    {
        System.Diagnostics.Debug.WriteLine(
            $"[GrafanaDashboard][{category}] " +
            $"ERROR: {ex.Message}");
    }

    // =============================================
    // מחלקות נתונים
    // =============================================

    public class PanelQueryRequest
    {
        public int    PanelId { get; set; }
        public string Expr    { get; set; }
    }

    public class QueryAllPanelsRequest
    {
        public List<PanelQueryRequest> Panels
        { get; set; }
    }

    public class StatusItem
    {
        public string Hostname { get; set; }
        public double Value    { get; set; }
    }

    public class PanelStatusResult
    {
        public int              PanelId { get; set; }
        public string           Status  { get; set; }
        public List<StatusItem> Items   { get; set; }
            = new List<StatusItem>();
        public string           Error   { get; set; }
    }
}