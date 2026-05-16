using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using System.Threading;
using System.Net.Http;
using System.Text;
using Microsoft.AspNetCore.Authorization;

[Authorize] 
public class DashboardsController : Controller
{
    // ─────────────────────────────────────────────
    // הגדרות - זהה לסגנון AlertsController
    // ─────────────────────────────────────────────
    private readonly IWebHostEnvironment _env;
    private readonly string _metricsCacheFilePath;

    private static readonly object _fileLock = new object();

    public DashboardsController(IWebHostEnvironment env)
    {
        _env = env;
        _metricsCacheFilePath = Path.Combine(_env.WebRootPath, "assets", "files", "rack_metrics_cache.json");
    }

    // ─────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────
    public IActionResult Index()
    {
        return View();
    }

    public IActionResult RackMetrics()
    {
        return View();
    }

    // ─────────────────────────────────────────────
    // קריאת קובץ Cache - זהה לסגנון AlertsController
    // ─────────────────────────────────────────────
    private RackMetricsCacheFile ReadCacheFile()
    {
        lock (_fileLock)
        {
            try
            {
                if (!System.IO.File.Exists(_metricsCacheFilePath))
                    return null;

                string json = System.IO.File.ReadAllText(_metricsCacheFilePath);

                if (string.IsNullOrEmpty(json))
                    return null;

                return JsonSerializer.Deserialize<RackMetricsCacheFile>(
                    json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error reading metrics cache: {ex.Message}");
                return null;
            }
        }
    }

    // ─────────────────────────────────────────────
    // כתיבת קובץ Cache - זהה לסגנון AlertsController
    // ─────────────────────────────────────────────
    private void WriteCacheFile(RackMetricsCacheFile data)
    {
        lock (_fileLock)
        {
            try
            {
                // וודא שהתיקייה קיימת
                Directory.CreateDirectory(
                    Path.GetDirectoryName(_metricsCacheFilePath)
                );

                string json = JsonSerializer.Serialize(
                    data,
                    new JsonSerializerOptions
                    {
                        WriteIndented        = true,
                        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
                    }
                );

                System.IO.File.WriteAllText(_metricsCacheFilePath, json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error writing metrics cache: {ex.Message}");
            }
        }
    }

    // ─────────────────────────────────────────────
    // UpdateMetricsCache - זהה לסגנון UpdateAlertsCache
    // ─────────────────────────────────────────────
    [HttpGet]
    public async Task<IActionResult> UpdateMetricsCache()
    {
        try
        {
            bool shouldUpdate = true;

            // בדוק אם הקובץ עודכן ב-5 הדקות האחרונות
            if (System.IO.File.Exists(_metricsCacheFilePath))
            {
                var lastWriteTime    = System.IO.File.GetLastWriteTime(_metricsCacheFilePath);
                var timeSinceLastUpdate = DateTime.Now - lastWriteTime;

                if (timeSinceLastUpdate.TotalMinutes < 5)
                {
                    shouldUpdate = false;
                    return Json(new
                    {
                        success = true,
                        updated = false,
                        message = "Cache is still fresh"
                    });
                }
            }

            if (shouldUpdate)
            {
                var cache = await RefreshMetricsCacheAsync();

                return Json(new
                {
                    success = cache != null,
                    updated = true,
                    count   = cache?.Metrics?.Count ?? 0
                });
            }

            return Json(new { success = true, updated = false });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─────────────────────────────────────────────
    // GetAllRackMetricsFromCache
    // ─────────────────────────────────────────────
    [HttpGet]
    public async Task<IActionResult> GetAllRackMetricsFromCache()
    {
        try
        {
            // קריאה מהקובץ המקומי - זהה לסגנון GetAlerts
            string json;
            lock (_fileLock)
            {
                if (!System.IO.File.Exists(_metricsCacheFilePath))
                {
                    return Json(new
                    {
                        success = false,
                        error   = "Cache file not found"
                    });
                }
                json = System.IO.File.ReadAllText(_metricsCacheFilePath);
            }

            if (string.IsNullOrEmpty(json))
            {
                return Json(new { success = false, error = "Cache file is empty" });
            }

            var cache = JsonSerializer.Deserialize<RackMetricsCacheFile>(
                json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );

            if (cache == null)
            {
                return Json(new { success = false, error = "Failed to parse cache" });
            }

            return Json(new
            {
                success     = true,
                metrics     = cache.Metrics,
                lastUpdated = cache.LastUpdated,
                nextUpdate  = cache.NextUpdate,
                isFromCache = true
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─────────────────────────────────────────────
    // GetCurrentRackMetricsCached
    // ─────────────────────────────────────────────
    [HttpGet]
    public IActionResult GetCurrentRackMetricsCached(
        string rackId,
        string dataCenterType,
        string side = "L")
    {
        try
        {
            var cache = ReadCacheFile();

            if (cache == null)
            {
                return Json(new { success = false, error = "Cache not available" });
            }

            var key = $"{dataCenterType}:{rackId}:{side}";

            if (cache.Metrics.TryGetValue(key, out var cachedMetrics))
            {
                return Json(new
                {
                    success            = cachedMetrics.Success,
                    currentPower       = cachedMetrics.CurrentPower,
                    currentTemperature = cachedMetrics.CurrentTemperature,
                    fromCache          = true,
                    lastUpdated        = cachedMetrics.LastUpdated,
                    nextUpdate         = cache.NextUpdate
                });
            }

            return Json(new
            {
                success   = false,
                fromCache = true,
                error     = "Rack not found in cache"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─────────────────────────────────────────────
    // ForceRefreshMetricsCache
    // ─────────────────────────────────────────────
    [HttpPost]
    public async Task<IActionResult> ForceRefreshMetricsCache()
    {
        try
        {
            var cache = await RefreshMetricsCacheAsync();

            return Json(new
            {
                success     = cache != null,
                lastUpdated = cache?.LastUpdated,
                nextUpdate  = cache?.NextUpdate,
                count       = cache?.Metrics?.Count ?? 0,
                message     = "Cache רועnn בהצלחה"
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ─────────────────────────────────────────────
    // GetMetricsCacheStatus
    // ─────────────────────────────────────────────
    [HttpGet]
    public IActionResult GetMetricsCacheStatus()
    {
        try
        {
            var cache = ReadCacheFile();

            if (cache == null)
            {
                return Json(new
                {
                    exists      = false,
                    isValid     = false,
                    lastUpdated = (DateTime?)null,
                    nextUpdate  = (DateTime?)null,
                    count       = 0
                });
            }

            return Json(new
            {
                exists      = true,
                isValid     = DateTime.UtcNow < cache.NextUpdate,
                lastUpdated = cache.LastUpdated,
                nextUpdate  = cache.NextUpdate,
                count       = cache.Metrics?.Count ?? 0,
                minutesUntilRefresh = Math.Max(
                    0,
                    (int)(cache.NextUpdate - DateTime.UtcNow).TotalMinutes
                ),
                cacheAgeMinutes = (DateTime.UtcNow - cache.LastUpdated).TotalMinutes
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // ═════════════════════════════════════════════
    // פונקציות פנימיות
    // ═════════════════════════════════════════════

    /// <summary>
    /// רענון Cache - קריאה ל-DataCenter API ושמירה לקובץ
    /// זהה לסגנון FetchAlertsFromService ב-AlertsController
    /// </summary>
    private async Task<RackMetricsCacheFile> RefreshMetricsCacheAsync()
    {
        try
        {
            Console.WriteLine($"Starting to refresh metrics cache. Time: {DateTime.Now}");

            var allRacks = await GetAllRacksListAsync();

            if (allRacks == null || allRacks.Count == 0)
            {
                Console.WriteLine("No racks found to refresh metrics");
                return null;
            }

            var newMetrics = new Dictionary<string, RackMetricsEntry>();

            // טעינת מטריקות לכל הארונות במקביל - בקבוצות של 10
            const int BATCH_SIZE = 10;
            for (int i = 0; i < allRacks.Count; i += BATCH_SIZE)
            {
                var batch = allRacks.Skip(i).Take(BATCH_SIZE).ToList();

                var tasks = batch.SelectMany(rack => new[]
                {
                    FetchSingleRackMetricsAsync(rack.RackId, rack.DataCenterType, "L"),
                    FetchSingleRackMetricsAsync(rack.RackId, rack.DataCenterType, "R")
                });

                var results = await Task.WhenAll(tasks);

                foreach (var result in results.Where(r => r != null))
                {
                    var key = $"{result.DataCenterType}:{result.RackId}:{result.Side}";
                    newMetrics[key] = result;
                }
            }

            // יצירת אובייקט ה-Cache
            var cacheData = new RackMetricsCacheFile
            {
                LastUpdated = DateTime.UtcNow,
                NextUpdate  = DateTime.UtcNow.AddMinutes(5),
                Metrics     = newMetrics
            };

            // שמירה לקובץ - זהה לסגנון AlertsController
            WriteCacheFile(cacheData);

            Console.WriteLine(
                $"Metrics cache updated: {newMetrics.Count} entries. Time: {DateTime.Now}"
            );

            return cacheData;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error refreshing metrics cache: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// קריאת מטריקות לארון בודד
    /// </summary>
    private async Task<RackMetricsEntry> FetchSingleRackMetricsAsync(
        string rackId,
        string dataCenterType,
        string side)
    {
        try
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (sender, cert, chain, sslPolicyErrors) => true
            };

            using var httpClient = new HttpClient(handler);

            var url = $"{Request.Scheme}://{Request.Host}" +
                      $"/DataCenter/GetCurrentRackMetrics" +
                      $"?rackId={Uri.EscapeDataString(rackId)}&side={side}";

            var response = await httpClient.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                return new RackMetricsEntry
                {
                    RackId         = rackId,
                    Side           = side,
                    DataCenterType = dataCenterType,
                    Success        = false,
                    LastUpdated    = DateTime.UtcNow
                };
            }

            var json    = await response.Content.ReadAsStringAsync();
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
            var data    = JsonSerializer.Deserialize<JsonElement>(json, options);

            return new RackMetricsEntry
            {
                RackId             = rackId,
                Side               = side,
                DataCenterType     = dataCenterType,
                Success            = data.TryGetProperty("success", out var s)
                                        && s.GetBoolean(),
                CurrentPower       = data.TryGetProperty("currentPower", out var p)
                                        && p.ValueKind != JsonValueKind.Null
                                        ? p.GetDouble() : null,
                CurrentTemperature = data.TryGetProperty("currentTemperature", out var t)
                                        && t.ValueKind != JsonValueKind.Null
                                        ? t.GetDouble() : null,
                LastUpdated        = DateTime.UtcNow
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"Error fetching metrics for {rackId} side {side}: {ex.Message}"
            );

            return new RackMetricsEntry
            {
                RackId         = rackId,
                Side           = side,
                DataCenterType = dataCenterType,
                Success        = false,
                LastUpdated    = DateTime.UtcNow
            };
        }
    }

    /// <summary>
    /// קבלת רשימת כל הארונות
    /// </summary>
    private async Task<List<RackIdentifier>> GetAllRacksListAsync()
    {
        try
        {
            var handler = new HttpClientHandler
            {
                ServerCertificateCustomValidationCallback =
                    (sender, cert, chain, sslPolicyErrors) => true
            };

            using var httpClient = new HttpClient(handler);
            var baseUrl = $"{Request.Scheme}://{Request.Host}";
            var racks   = new List<RackIdentifier>();
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

            foreach (var dcType in new[] { "PT", "RG" })
            {
                try
                {
                    var response = await httpClient.GetAsync(
                        $"{baseUrl}/DataCenter/GetRacksData?dataCenterType={dcType}"
                    );

                    if (!response.IsSuccessStatusCode) continue;

                    var json = await response.Content.ReadAsStringAsync();
                    var data = JsonSerializer.Deserialize<JsonElement>(json, options);

                    if (data.TryGetProperty("racksData", out var racksData))
                    {
                        foreach (var rack in racksData.EnumerateObject())
                        {
                            racks.Add(new RackIdentifier
                            {
                                RackId         = rack.Name,
                                DataCenterType = dcType
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine(
                        $"Error getting racks for {dcType}: {ex.Message}"
                    );
                }
            }

            return racks;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error getting racks list: {ex.Message}");
            return new List<RackIdentifier>();
        }
    }
}

// ═════════════════════════════════════════════
// מודלים
// ═════════════════════════════════════════════

public class RackMetricsCacheFile
{
    public DateTime LastUpdated { get; set; }
    public DateTime NextUpdate  { get; set; }
    public Dictionary<string, RackMetricsEntry> Metrics { get; set; } = new();
}

public class RackMetricsEntry
{
    public string   RackId             { get; set; }
    public string   Side               { get; set; }
    public string   DataCenterType     { get; set; }
    public double?  CurrentPower       { get; set; }
    public double?  CurrentTemperature { get; set; }
    public bool     Success            { get; set; }
    public string   Error              { get; set; }
    public DateTime LastUpdated        { get; set; }
}

public class RackIdentifier
{
    public string RackId         { get; set; }
    public string DataCenterType { get; set; }
}