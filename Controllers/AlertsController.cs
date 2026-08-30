using Microsoft.AspNetCore.Mvc;
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Text.Json;
using System.Collections.Generic;
using System.IO;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.Hosting;
using System.Diagnostics; 
using NocPortal.Services;

public static class HttpClientExtensions
{

    public static async Task<HttpResponseMessage> PatchAsync(this HttpClient client, string requestUri, HttpContent content)
    {
        var request = new HttpRequestMessage(new HttpMethod("PATCH"), requestUri)
        {
            Content = content
        };
        return await client.SendAsync(request);
    }
}

public class AlertsController : Controller
{
    private static readonly ConcurrentDictionary<string, List<NoteItem>> _notesCache = new ConcurrentDictionary<string, List<NoteItem>>();
    private static readonly ConcurrentDictionary<string, string> _helixIdToInternalId = new ConcurrentDictionary<string, string>();
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SecretsService     _secrets;

    // *** שדות מחושבים מה-SecretsService ***
    private string _accessKey    => _secrets.HelixAccessKey;
    private string _accessToken  => _secrets.HelixAccessSecret;
    private string _tenantId     => _secrets.HelixTenantId;
    private string _baseUrl      => _secrets.HelixBaseUrl;
    private string _proxyUrl     => _secrets.HelixProxyUrl;
    
    // מטמון לטוקנים
    private static string _jwtToken;
    private static DateTime _tokenExpiry = DateTime.MinValue;
    
    // קובץ לשמירת מידע על התראות
    private readonly string _alertsDataFilePath;
    private readonly string _alertsCacheFilePath;

    // נתיב לקובץ הסינונים השמורים
    private readonly string _savedFiltersFilePath;

    private static readonly object _fileLock = new object();

    private readonly AuditLogService _auditLog;

    public AlertsController(IHttpClientFactory httpClientFactory, IWebHostEnvironment env,
        SecretsService secrets,
        AuditLogService auditLog)  
    {
        _httpClientFactory = httpClientFactory;
        _secrets           = secrets;
        _auditLog = auditLog;
        _alertsDataFilePath = Path.Combine(env.WebRootPath, "assets", "files", "alerts_data.txt");
        _alertsCacheFilePath = Path.Combine(env.WebRootPath, "assets", "files", "alerts_cache.json");
        _savedFiltersFilePath = Path.Combine(env.WebRootPath, "assets", "files", "saved_filters.json");
        
        // וודא שהתיקייה קיימת
        Directory.CreateDirectory(Path.GetDirectoryName(_alertsDataFilePath)!);
        
        // טען את המידע מהקובץ בעת אתחול הקונטרולר
        LoadAlertsData();
    }

    private string GenerateStableId(JsonElement source)
    {
        // נסה למצוא מזהה ייחודי יציב יותר
        string host = GetStringProperty(source, "mx_host") ?? "";
        string message = GetStringProperty(source, "msg") ?? "";
        string timestamp = source.TryGetProperty("creation_time", out var timestampProp) ? 
                        timestampProp.GetInt64().ToString() : "";
        
        // צור מזהה מבוסס על שילוב של שדות שסביר שיישארו קבועים
        string combinedKey = $"{host}_{message}_{timestamp}";
        
        // המר למחרוזת MD5 קצרה יותר
        using (var md5 = System.Security.Cryptography.MD5.Create())
        {
            byte[] inputBytes = System.Text.Encoding.UTF8.GetBytes(combinedKey);
            byte[] hashBytes = md5.ComputeHash(inputBytes);
            
            // המר את ה-hash לייצוג הקסדצימלי
            return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
        }
    }

    // טעינת מידע על התראות מהקובץ
    private Dictionary<string, AlertData> LoadAlertsData()
    {
        var alertsData = new Dictionary<string, AlertData>();
        
        lock (_fileLock)
        {
            try
            {
                if (System.IO.File.Exists(_alertsDataFilePath))
                {
                    string json = System.IO.File.ReadAllText(_alertsDataFilePath);
                    if (!string.IsNullOrEmpty(json))
                    {
                        alertsData = JsonSerializer.Deserialize<Dictionary<string, AlertData>>(json);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error loading alerts data: {ex.Message}");
            }
        }
        
        return alertsData;
    }
    
    // שמירת מידע על התראות לקובץ
    private void SaveAlertsData(Dictionary<string, AlertData> alertsData)
    {
        lock (_fileLock)
        {
            try
            {
                // וודא שהתיקייה קיימת
                Directory.CreateDirectory(Path.GetDirectoryName(_alertsDataFilePath));
                
                string json = JsonSerializer.Serialize(alertsData);
                System.IO.File.WriteAllText(_alertsDataFilePath, json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error saving alerts data: {ex.Message}");
            }
        }
    }
    
    [HttpGet]
    public IActionResult GetCurrentUser()
    {
        var username = User.Identity?.Name ?? "";
        return Json(new { username });
    }

    [HttpGet]
    public IActionResult GetAlerts(int minutes = 1440)
    {
        try
        {
            string json;
            DateTime lastWriteTime = DateTime.MinValue;

            lock (_fileLock)
            {
                if (!System.IO.File.Exists(_alertsCacheFilePath))
                {
                    return Json(new
                    {
                        alerts = new List<object>(),
                        cacheExists = false,
                        message = "Cache file not found yet",
                        lastUpdated = (string)null  
                    });
                }

                json = System.IO.File.ReadAllText(_alertsCacheFilePath);
                lastWriteTime = System.IO.File.GetLastWriteTime(_alertsCacheFilePath);
            }

            if (string.IsNullOrWhiteSpace(json))
            {
                return Json(new
                {
                    alerts = new List<object>(),
                    cacheExists = false,
                    message = "Cache file is empty",
                    lastUpdated = (string)null  
                });
            }

            var alerts = JsonSerializer.Deserialize<List<object>>(json);
            var cacheAgeSeconds = (DateTime.Now - lastWriteTime).TotalSeconds;

            // *** חדש: המר לשעון ישראל ***
            var israelTz = TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time");
            var israelTime = TimeZoneInfo.ConvertTime(lastWriteTime, israelTz);
            string lastUpdatedStr = israelTime.ToString("dd/MM/yyyy HH:mm:ss");

            return Json(new
            {
                alerts,
                cacheExists = true,
                cacheAgeSeconds = (int)cacheAgeSeconds,
                lastUpdated = lastUpdatedStr  
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // הוסף פונקציה חדשה לניקוי המטמון
    private void ClearNotesCache()
    {
        _notesCache.Clear();
    }
    
    // פונקציה לקבלת הערות עבור התראה ספציפית
    private async Task<List<NoteItem>> FetchEventNotes(HttpClient client, string eventId)
    {
        try
        {
            // בדוק אם ההערות כבר במטמון
            if (_notesCache.TryGetValue(eventId, out var cachedNotes))
            {
                return cachedNotes;
            }
            
            // שימוש בנתיב הנכון שמצאנו
            string url = $"{_baseUrl}/tsws/monitoring/api/v1.0/events/{eventId}/lognotes";
            
            var httpResponse = await client.GetAsync(url);
            var responseContent = await httpResponse.Content.ReadAsStringAsync();

            if (!httpResponse.IsSuccessStatusCode)
            {
                 return new List<NoteItem>();
            }
                        
            // עיבוד התגובה - המרה ל-JsonElement
            var responseData = JsonSerializer.Deserialize<JsonElement>(responseContent);
            var notesList = new List<NoteItem>();
            
            // בדוק אם התגובה מכילה את המבנה הצפוי
            if (responseData.TryGetProperty("response", out var responseObj) && 
                responseObj.TryGetProperty("logsnotes", out var logsnotes))
            {
                
                foreach (var note in logsnotes.EnumerateArray())
                {
                    // חלץ את המידע מההערה
                    long date = note.TryGetProperty("date", out var dateProp) ? dateProp.GetInt64() : 0;
                    string source = note.TryGetProperty("source", out var sourceProp) ? sourceProp.GetString() : "";
                    string content = note.TryGetProperty("content", out var contentProp) ? contentProp.GetString() : "";

                    if (!string.IsNullOrEmpty(content) && 
                        content.Contains("OVERRIDE_CLOSED", StringComparison.OrdinalIgnoreCase))
                    {
                        // סמן שיש לעדכן את הסטטוס ל-CLOSED
                        // נחזיר דגל מיוחד דרך מחלקה עוטפת
                        notesList.Add(new NoteItem
                        {
                            Text = content,
                            UserName = source,
                            Date = TimeZoneInfo.ConvertTimeFromUtc(
                                DateTimeOffset.FromUnixTimeMilliseconds(date).UtcDateTime,
                                TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time")),
                            Time = TimeZoneInfo.ConvertTimeFromUtc(
                                DateTimeOffset.FromUnixTimeMilliseconds(date).UtcDateTime,
                                TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time")).ToString("HH:mm"),
                            Source = source,
                            IsOverrideClosed = true
                        });
                        continue;
                    }
                    
                    // פילטור פשוט: הצג רק הערות עם source לא ריק
                    if (!string.IsNullOrEmpty(source))
                    {
                        // בדוק אם יש שם משתמש בתוכן ההערה (פורמט: "username:text")
                        string userName = source;
                        string noteText = content;

                        // בדוק אם התוכן כבר מכיל את שם המשתמש בפורמט "username:text"
                        if (content.Contains(":") && !userName.Contains("@") && content.StartsWith(userName + ":"))
                        {
                            // אם כן, אל תחלץ שוב את שם המשתמש
                            noteText = content.Substring(userName.Length + 1).Trim();
                        }
                        else if (content.Contains(":") && !userName.Contains("@"))
                        {
                            // אחרת, נסה לחלץ את שם המשתמש מהתוכן
                            var parts = content.Split(':', 2);
                            userName = parts[0].Trim();
                            noteText = parts[1].Trim();
                        }
                        
                        notesList.Add(new NoteItem
                        {
                            Text = noteText,
                            UserName = userName,
                            Date = TimeZoneInfo.ConvertTimeFromUtc(
                                DateTimeOffset.FromUnixTimeMilliseconds(date).UtcDateTime,
                                TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time")),
                            Time = TimeZoneInfo.ConvertTimeFromUtc(
                                DateTimeOffset.FromUnixTimeMilliseconds(date).UtcDateTime,
                                TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time")).ToString("HH:mm"),
                            Source = source
                        });
                        
                    }
                }
            }
            // שמור את ההערות במטמון
            _notesCache[eventId] = notesList;
            
            return notesList;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($">>> Error in FetchEventNotes for event {eventId}: {ex.Message}");
            Console.Error.WriteLine($">>> Stack trace: {ex.StackTrace}");
            return new List<NoteItem>();
        }
    }

    [HttpGet]
    public async Task<IActionResult> UpdateAlertsCache(bool force = false)
    {
        try
        {
            bool shouldUpdate = true;

            if (System.IO.File.Exists(_alertsCacheFilePath) && !force)
            {
                var lastWriteTime = System.IO.File.GetLastWriteTime(_alertsCacheFilePath);
                var timeSinceLastUpdate = DateTime.Now - lastWriteTime;

                if (timeSinceLastUpdate.TotalMinutes >= 5)
                {
                    lock (_fileLock)
                    {
                        if (System.IO.File.Exists(_alertsCacheFilePath))
                        {
                            System.IO.File.Delete(_alertsCacheFilePath);
                        }
                    }
                    ClearNotesCache();
                    shouldUpdate = true;
                }
                // *** תיקון: חסום רק אם עברו פחות מ-25 שניות (ולא force) ***
                if (timeSinceLastUpdate.TotalSeconds < 25)
                {
                    return Json(new
                    {
                        success = true,
                        updated = false,
                        message = "Cache is still fresh"
                    });
                }
            }

            // נקה מטמון הערות לפני עדכון
            ClearNotesCache();

            // קריאה לשירות החיצוני לקבלת התראות עדכניות
            // var alerts = await FetchAlertsFromService();
            var alerts = GetMockAlertsList(50);

            // שמירת ההתראות בקובץ מטמון
            lock (_fileLock)
            {
                Directory.CreateDirectory(
                    Path.GetDirectoryName(_alertsCacheFilePath));
                System.IO.File.WriteAllText(
                    _alertsCacheFilePath,
                    JsonSerializer.Serialize(alerts));
            }

            // *** חדש: המר לשעון ישראל ***
            var israelTz = TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time");
            var israelTime = TimeZoneInfo.ConvertTime(DateTime.Now, israelTz);
            string lastUpdatedStr = israelTime.ToString("dd/MM/yyyy HH:mm:ss");

            return Json(new
            {
                success = true,
                updated = true,
                count = alerts.Count,
                lastUpdated = lastUpdatedStr
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private async Task<List<object>> FetchAlertsFromService(int minutes = 1440) // ברירת מחדל: 24 שעות
    {
        int alertCount = 0;
        
        try
        {
            Console.WriteLine($"Starting to fetch alerts from service. Time: {DateTime.Now}");

            // קריאה ישירה מהקובץ
            var alertsData = LoadAlertsData();
            
            // וודא שיש לנו טוקן תקף
            await EnsureValidToken();
            
            var client = CreateHttpClient();
            client.DefaultRequestHeaders.Add("Authorization", $"Bearer {_jwtToken}");
            client.DefaultRequestHeaders.Add("tenantId", _tenantId);
            
            // רשימה מאוחדת של כל ההתראות
            var allAlerts = new List<object>();
            
            // חישוב טווח זמנים
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var timeRangeMs = minutes * 60 * 1000L; // המרת דקות למילישניות (עם L לציון long)
            var startTime = now - timeRangeMs;
            
            // 1. שליפת התראות פתוחות (כל הזמנים)
            var openAlertsQuery = new
            {
                size = 10000,
                from = 0,
                query = new
                {
                    @bool = new
                    {
                        must = new object[]
                        {
                            new
                            {
                                query_string = new
                                {
                                    analyze_wildcard = true,
                                    query = "mx_noc:Yes AND NOT status:CLOSED AND NOT status:BLACKOUT"
                                }
                            }
                        }
                    }
                },
                sort = new object[]
                {
                    new
                    {
                        creation_time = new
                        {
                            order = "desc"
                        }
                    }
                }
            };
            
            var openAlerts = await ExecuteAlertsQuery(client, openAlertsQuery, alertsData);
            allAlerts.AddRange(openAlerts);
            
            // 2. שליפת התראות סגורות (שנה אחורה)
            // שימוש ב-long כדי למנוע גלישה
            long daysBack = 365L;
            long hoursInDay = 24L;
            long minutesInHour = 60L;
            long secondsInMinute = 60L;
            long msInSecond = 1000L;
            long yearInMs = daysBack * hoursInDay * minutesInHour * secondsInMinute * msInSecond;
            long closedStartTime = now - yearInMs;
            
            var closedAlertsQuery = new
            {
                size = 1000, // הגבלה ל-1000 התראות סגורות
                from = 0,
                query = new
                {
                    @bool = new
                    {
                        must = new object[]
                        {
                            new
                            {
                                range = new
                                {
                                    creation_time = new
                                    {
                                        gte = closedStartTime,
                                        lte = now,
                                        format = "epoch_millis"
                                    }
                                }
                            },
                            new
                            {
                                query_string = new
                                {
                                    analyze_wildcard = true,
                                    query = "mx_noc:Yes AND (status:CLOSED)"
                                }
                            }
                        }
                    }
                },
                sort = new object[]
                {
                    new
                    {
                        creation_time = new
                        {
                            order = "desc"
                        }
                    }
                }
            };
            
            var closedAlerts = await ExecuteAlertsQuery(client, closedAlertsQuery, alertsData);
            allAlerts.AddRange(closedAlerts);
            
            Console.WriteLine($"Finished fetching alerts. Found {allAlerts.Count} alerts. Time: {DateTime.Now}");

            return allAlerts;
        }
        catch (Exception ex)
        {
            throw; // זרוק את השגיאה כדי שהקורא יוכל לטפל בה
        }
    }

    [HttpGet]
    private List<object> GetMockAlertsList(int count)
    {
        var mockAlerts = new List<object>();
        var now = DateTimeOffset.UtcNow;
        var rand = new Random();

        string[] hosts = { "srv-web-prod-01", "db-sql-cluster-02", "app-api-gateway" };
        string[] ips = { "10.10.20.11", "10.10.40.55", "10.10.10.5" };
        
        for (int i = 1; i <= count; i++)
        {
            var alert = new
            {
                id = Guid.NewGuid().ToString("N").Substring(0, 16),
                idHelix = $"bme_event_{1000000 + i}",
                host = hosts[rand.Next(hosts.Length)],
                message = "Mock Alert Error Description Code " + rand.Next(100, 999),
                timestamp = now.AddMinutes(-rand.Next(5, 200)).ToUnixTimeMilliseconds(),
                severity = rand.Next(2) == 0 ? "CRITICAL" : "MAJOR",
                status = "OPEN",
                hostAddress = ips[rand.Next(ips.Length)],
                contacts = "DevOps Team",
                notes = (object)null,
                modified = (long?)null,
                assignee = (string)null,
                priority = rand.Next(1, 4)
            };
            mockAlerts.Add(alert);
        }
        
        return mockAlerts.Cast<dynamic>().OrderByDescending(a => a.timestamp).ToList();
    }

    // פונקציה חדשה לביצוע שאילתת התראות ועיבוד התוצאות
    private async Task<List<object>> ExecuteAlertsQuery(HttpClient client, object queryBody, Dictionary<string, AlertData> alertsData)
    {
        
        var content = new StringContent(
            JsonSerializer.Serialize(queryBody),
            Encoding.UTF8,
            "application/json");
        
        var response = await client.PostAsync($"{_baseUrl}/events-service/api/v1.0/events/msearch", content);
        response.EnsureSuccessStatusCode();
        
        var responseContent = await response.Content.ReadAsStringAsync();
        
        var eventsData = JsonSerializer.Deserialize<JsonElement>(responseContent);
        var alertsList = new List<object>();
        
        try {
            // בדיקה אם יש את המפתחות הנדרשים
            if (eventsData.TryGetProperty("responses", out var responsesElement) && 
                responsesElement.GetArrayLength() > 0)
            {
                var firstResponse = responsesElement[0];
                
                if (firstResponse.TryGetProperty("hits", out var hitsContainer) &&
                    hitsContainer.TryGetProperty("hits", out var hits))
                {
                    foreach (var eventElement in hits.EnumerateArray())
                    {
                        if (eventElement.TryGetProperty("_source", out var source))
                        {
                            // חילוץ נתונים מהאירוע - התאמה למבנה האמיתי של התגובה
                            string idHelix = "";
                            if (source.TryGetProperty("_identifier", out var idProp) && idProp.ValueKind == JsonValueKind.String)
                            {
                                idHelix = idProp.GetString();
                            }

                            string id = GenerateStableId(source);
                            // *** תיקון: שמור מיפוי idHelix → id פנימי ***
                            if (!string.IsNullOrEmpty(idHelix))
                            {
                                _helixIdToInternalId[idHelix] = id;
                            }
                            string host = GetStringProperty(source, "mx_host");
                                        
                            string message = GetStringProperty(source, "msg");
                                            
                            long timestamp = source.TryGetProperty("creation_time", out var timestampProp) ? 
                                            timestampProp.GetInt64() : 0;
                                            
                            string severity = GetStringProperty(source, "severity") ?? GetStringProperty(source, "Severity") ?? "";
                            severity = MapSeverity(severity);

                            // קבל את הסטטוס המקורי מהשרת
                            string originalStatus = GetStringProperty(source, "status");
                            string status = MapStatus(originalStatus);
                            
                            string hostAddress = GetStringProperty(source, "source_address") ?? 
                                                GetStringProperty(source, "source_ip") ?? 
                                                GetStringProperty(source, "mx_ip") ?? "";
                                                
                            string contacts = GetStringProperty(source, "mx_responsible_team") ?? "";

                            // *** ניקוי: הסר תוספת "(Assigned to: ...)" אם קיימת מעדכונים קודמים ***
                            if (contacts.Contains(" (Assigned to:"))
                            {
                                contacts = contacts.Substring(0, contacts.IndexOf(" (Assigned to:")).Trim();
                            }
                                            
                            // קבל את ההערות המקוריות מהשרת
                            string originalNotes = GetStringProperty(source, "mx_notes") ?? 
                                        GetStringProperty(source, "details") ?? "";
                            
                            long? modified = source.TryGetProperty("_modified_time", out var modifiedProp) ? 
                                            modifiedProp.GetInt64() : (long?)null;
                            
                            // חילוץ שדה העדיפות
                            int priority = 0; // ברירת מחדל - עדיפות רגילה

                            // בדיקת שדה priority
                            if (source.TryGetProperty("priority", out var priorityProp) && priorityProp.ValueKind == JsonValueKind.String)
                            {
                                string priorityStr = priorityProp.GetString();
                                
                                // בדוק אם המחרוזת מתחילה ב-"PRIORITY_" ואחריה מספר
                                if (priorityStr != null && priorityStr.StartsWith("PRIORITY_", StringComparison.OrdinalIgnoreCase))
                                {
                                    string priorityNumStr = priorityStr.Substring("PRIORITY_".Length);
                                    if (int.TryParse(priorityNumStr, out int parsedPriority))
                                    {
                                        priority = parsedPriority;
                                    }
                                }
                            }

                            // בדוק אם יש מידע נוסף בקובץ המקומי
                            var alertData = alertsData.ContainsKey(id) ? alertsData[id] : null;

                            // עדכן את הסטטוס אם קיים בקובץ המקומי
                            string helixStatus = status;

                            // עדכן מהמטמון המקומי רק אם Helix לא אומר CLOSED
                            if (alertData != null && !string.IsNullOrEmpty(alertData.Status))
                            {
                                // אם Helix אומר CLOSED - תמיד כבד את Helix, לא צריך הערות
                                if (!string.Equals(helixStatus, "CLOSED", StringComparison.OrdinalIgnoreCase))
                                {
                                    status = alertData.Status;
                                }
                                else
                                {
                                    // עדכן גם מקומית כדי שבפעם הבאה לא יהיה קונפליקט
                                    UpdateAlertData(id, status: "CLOSED");
                                }
                            }

                            // הוסף מידע על המשתמש שקיבל את ההקצאה אם קיים
                            /*if (alertData != null && !string.IsNullOrEmpty(alertData.Assignee))
                            {
                                contacts = $"{contacts} (Assigned to: {alertData.Assignee})";
                            }*/

                            // יצירת רשימה מאוחדת של הערות
                            var combinedNotes = new List<NoteItem>();

                            // 1. קבל הערות מהשרת עבור ההתראה הנוכחית
                            if (!string.IsNullOrEmpty(idHelix) && 
                                (string.Equals(status, "ASSIGN", StringComparison.OrdinalIgnoreCase) || 
                                string.Equals(status, "ACK", StringComparison.OrdinalIgnoreCase) ||
                                string.Equals(status, "OPEN", StringComparison.OrdinalIgnoreCase)))
                            {
                                var serverNotes = await FetchEventNotes(client, idHelix);
                                combinedNotes.AddRange(serverNotes);
                                bool hasOverrideClosed = serverNotes.Any(n => n.IsOverrideClosed);
                                if (hasOverrideClosed)
                                {
                                    status = "CLOSED";  // עדכן את הסטטוס המקומי
                                    Console.WriteLine($"[OVERRIDE_CLOSED] Alert {idHelix} forced to CLOSED by note");
                                }
                            }

                            // 2. הוסף הערות מקומיות אם קיימות (רק אם אינן כפולות)
                            if (alertData?.Notes != null && alertData.Notes.Count > 0)
                            {
                                foreach (var note in alertData.Notes)
                                {
                                    // בדוק אם ההערה כבר קיימת ברשימה (למניעת כפילויות)
                                    if (!combinedNotes.Any(n => 
                                        // כפילות לפי תוכן ומשתמש
                                        (n.Text == note.Text && n.UserName == note.UserName) ||
                                        // או כפילות לפי זמן (בטווח של דקה)
                                        Math.Abs((n.Date - note.Date).TotalMinutes) < 1))
                                    {
                                        combinedNotes.Add(note);
                                    }
                                }
                            }

                            // 3. אם אין הערות אבל יש הערות מקוריות, הוסף אותן
                            if (combinedNotes.Count == 0 && !string.IsNullOrEmpty(originalNotes))
                            {
                                // אם אין מידע מקומי אבל יש הערות מקוריות, שמור אותן
                                UpdateAlertData(id, notes: originalNotes);
                                
                                // הוסף את ההערה המקורית לרשימה
                                combinedNotes.Add(new NoteItem
                                {
                                    Text = originalNotes,
                                    UserName = "מערכת",
                                    Date = DateTimeOffset.FromUnixTimeMilliseconds(timestamp).DateTime,
                                    Time = DateTimeOffset.FromUnixTimeMilliseconds(timestamp).DateTime.ToString("HH:mm"),
                                    Source = "system"
                                });
                            }

                            // מיין את ההערות לפי תאריך (מהחדש לישן)
                            combinedNotes = combinedNotes.OrderByDescending(n => n.Date).ToList();

                            // המר את רשימת ההערות המאוחדת לפורמט הנדרש עבור ה-JSON
                            var notesList = combinedNotes.Select(note => new
                            {
                                text = note.Text,
                                userName = note.UserName,
                                date = note.Date,
                                time = note.Time,
                                source = note.Source
                            }).ToList();

                            // יצירת אובייקט ההתראה עם רשימת ההערות המאוחדת
                            var alert = new
                            {
                                id = id,
                                idHelix = idHelix,
                                host = host,
                                message = message,
                                timestamp = timestamp,
                                severity = severity,
                                status = status,
                                hostAddress = hostAddress,
                                contacts = contacts,
                                notes = notesList.Count > 0 ? notesList : null,
                                modified = modified,
                                assignee = alertData?.Assignee,
                                priority = priority 
                            };

                            alertsList.Add(alert);
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error processing alerts: {ex.Message}");
            throw;
        }
        
        return alertsList;
    }

    [HttpPost]
    public async Task<IActionResult> SetAlertStatus([FromBody] SetAlertStatusRequest request)
    {
        try
        {
            // בדיקת תקינות הבקשה
            if (string.IsNullOrEmpty(request.EventId) || string.IsNullOrEmpty(request.Status))
            {
                return Json(new { success = false, message = "Event ID and Status are required" });
            }

            // וודא שהסטטוס תקין
            string mappedStatus = MapStatus(request.Status);
            if (string.IsNullOrEmpty(mappedStatus))
            {
                return Json(new { success = false, message = "Invalid status value" });
            }

            // Ensure valid token
            await EnsureValidToken();
            
            // הגדרת הפרוקסי
            var handler = new HttpClientHandler
            {
                Proxy = new System.Net.WebProxy(_proxyUrl),
                UseProxy = true,
                ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
            };
            
            using (var httpClient = new HttpClient(handler))
            {
                httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {_jwtToken}");
                httpClient.DefaultRequestHeaders.Add("tenantId", _tenantId);
                httpClient.DefaultRequestHeaders.Add("Accept", "application/json");
                
                // Build request body
                var body = new { status = mappedStatus };

                var jsonBody = JsonSerializer.Serialize(body);
                var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                
                // שימוש ב-PATCH לעדכון הסטטוס
                var url = $"{_baseUrl}/events-service/api/v1.0/events/{request.EventId}";
                
                var patchRequest = new HttpRequestMessage(new HttpMethod("PATCH"), url)
                {
                    Content = content
                };
                
                var response = await httpClient.SendAsync(patchRequest);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                if (response.IsSuccessStatusCode)
                {
                    // עדכון מקומי
                    UpdateAlertData(request.EventId, status: mappedStatus);
                    await UpdateAlertInCache(request.EventId, mappedStatus);

                    return Json(new { 
                        success = true, 
                        message = $"Event status updated to {mappedStatus} successfully" 
                    });
                }
                else
                {
                    return Json(new { 
                        success = false, 
                        message = $"Failed to update event status. Status: {response.StatusCode}, Response: {responseContent}" 
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in SetAlertStatus: {ex.Message}");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> CloseEvents([FromBody] CloseEventsRequest request)
    {
        try
        {
            // בדיקת תקינות הבקשה
            if (request.EventIds == null || request.EventIds.Length == 0)
            {
                return Json(new { success = false, message = "Event IDs are required" });
            }

            // וודא שיש לנו טוקן תקף
            await EnsureValidToken();
            
            // הגדרת הפרוקסי
            var handler = new HttpClientHandler
            {
                Proxy = new System.Net.WebProxy(_proxyUrl),
                UseProxy = true,
                ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
            };
            
            using (var httpClient = new HttpClient(handler))
            {
                httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {_jwtToken}");
                httpClient.DefaultRequestHeaders.Add("tenantId", _tenantId);
                httpClient.DefaultRequestHeaders.Add("Accept", "application/json");
                
                // בניית גוף הבקשה
                var requestBody = new
                {
                    eventIds = request.EventIds,
                    slots = new
                    {
                        notes = request.Note
                    }
                };

                var jsonBody = JsonSerializer.Serialize(requestBody);
                var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                
                // שליחת הבקשה ל-API
                var url = $"{_baseUrl}/events-service/api/v1.0/events/operations/close";
                
                var response = await httpClient.PostAsync(url, content);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                if (response.IsSuccessStatusCode)
                {
                    string userName = "Helix";
                    string noteText = request.Note ?? ""; // *** תיקון: null → ""

                    if (!string.IsNullOrEmpty(request.Note) && request.Note.Contains(":"))
                    {
                        var parts = request.Note.Split(':', 2);
                        userName = parts[0].Trim();
                        noteText = parts[1].Trim();
                    }

                    foreach (var eventId in request.EventIds)
                    {
                        // *** תיקון: עדכן סטטוס תמיד, ללא תלות בהערה ***
                        UpdateAlertData(eventId, status: "CLOSED");

                        // הוספת ההערה רק אם קיימת
                        if (!string.IsNullOrEmpty(noteText))
                        {
                            UpdateAlertData(eventId, notes: noteText, userName: userName);
                        }
                    }

                    // *** תיקון: cacheTasks מחוץ ללולאה, עם noteText/userName הנכונים ***
                    var cacheTasks = request.EventIds.Select(id =>
                        UpdateAlertInCache(id, "CLOSED",
                            string.IsNullOrEmpty(noteText) ? null : noteText,
                            string.IsNullOrEmpty(noteText) ? null : userName));
                    await Task.WhenAll(cacheTasks);

                    return Json(new { success = true, message = "Events closed successfully" });
                }
                else
                {
                    return Json(new { 
                        success = false, 
                        message = $"Failed to close events. Status: {response.StatusCode}, Response: {responseContent}" 
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in CloseEvents: {ex.Message}");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> AssignEvents([FromBody] AssignEventsRequest request)
    {
        try
        {
            // בדיקת תקינות הבקשה
            if (request.EventIds == null || request.EventIds.Length == 0 || string.IsNullOrEmpty(request.AssignedUser))
            {
                return Json(new { success = false, message = "Event IDs and Assigned User are required" });
            }

            // Ensure valid token
            await EnsureValidToken();
            
            // הגדרת הפרוקסי
            var handler = new HttpClientHandler
            {
                Proxy = new System.Net.WebProxy(_proxyUrl),
                UseProxy = true,
                ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
            };
            
            using (var httpClient = new HttpClient(handler))
            {
                httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {_jwtToken}");
                httpClient.DefaultRequestHeaders.Add("tenantId", _tenantId);
                httpClient.DefaultRequestHeaders.Add("Accept", "application/json");
                
                // Build request body according to API requirements
                var requestBody = new
                {
                    eventIds = request.EventIds,
                    slots = new
                    {
                        assigned_user = request.AssignedUser
                    }
                };

                var jsonBody = JsonSerializer.Serialize(requestBody);
                var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                
                // שליחת הבקשה ל-API הנכון
                var url = $"{_baseUrl}/events-service/api/v1.0/events/operations/assign";
                
                var response = await httpClient.PostAsync(url, content);
                var responseContent = await response.Content.ReadAsStringAsync();
                
                if (response.IsSuccessStatusCode)
                {
                    // עדכון מקומי - חילוץ שם המשתמש מההערה
                    string userName = "Helix";
                    string noteText = request.Note;
                    
                    // אם ההערה מכילה ":", חלק אותה לשם משתמש והערה
                    if (!string.IsNullOrEmpty(request.Note) && request.Note.Contains(":"))
                    {
                        var parts = request.Note.Split(':', 2);
                        userName = parts[0].Trim();
                        noteText = parts[1].Trim();
                    }
                    
                    foreach (var eventId in request.EventIds)
                    {
                        // עדכון הסטטוס והמשתמש המוקצה
                        UpdateAlertData(eventId, status: "ASSIGN", assignee: request.AssignedUser);
                        
                        // הוספת ההערה בנפרד
                        if (!string.IsNullOrEmpty(noteText))
                        {
                            UpdateAlertData(eventId, notes: noteText, userName: userName);
                        }
                        var cacheTasks = request.EventIds.Select(id => 
                            UpdateAlertInCache(id, "ASSIGN", noteText, userName));
                        await Task.WhenAll(cacheTasks);
                    }
                    return Json(new { 
                        success = true, 
                        message = $"Events assigned to {request.AssignedUser} successfully" 
                    });
                }
                else
                {
                    return Json(new { 
                        success = false, 
                        message = $"Failed to assign events. Status: {response.StatusCode}, Response: {responseContent}" 
                    });
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in AssignEvents: {ex.Message}");
            Console.Error.WriteLine($"Stack trace: {ex.StackTrace}");
            
            if (ex.InnerException != null)
            {
                Console.Error.WriteLine($"Inner exception: {ex.InnerException.Message}");
                Console.Error.WriteLine($"Inner stack trace: {ex.InnerException.StackTrace}");
            }
            
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> AcknowledgeEvents(
        [FromBody] AcknowledgeEventsRequest request)
    {
        try
        {
            var validEventIds = request.EventIds
                .Where(id => !string.IsNullOrWhiteSpace(id) && id != "service")
                .ToList();

            if (validEventIds.Count == 0)
                return Json(new { success = false, 
                    message = "No valid event IDs to acknowledge" });

            await EnsureValidToken();

            var handler = new HttpClientHandler
            {
                Proxy = new System.Net.WebProxy(_proxyUrl),
                UseProxy = true,
                ServerCertificateCustomValidationCallback = 
                    (sender, cert, chain, sslPolicyErrors) => true
            };

            using (var httpClient = new HttpClient(handler))
            {
                httpClient.DefaultRequestHeaders.Add(
                    "Authorization", $"Bearer {_jwtToken}");
                httpClient.DefaultRequestHeaders.Add("tenantId", _tenantId);
                httpClient.DefaultRequestHeaders.Add("Accept", "application/json");

                int successCount = 0, failCount = 0, alreadyClosedCount = 0;
                var errors = new List<string>();

                var body = new { status = "ACK" };
                var jsonBody = JsonSerializer.Serialize(body);

                foreach (var eventId in validEventIds)
                {
                    try
                    {
                        var content = new StringContent(
                            jsonBody, Encoding.UTF8, "application/json");

                        var response = await httpClient.PatchAsync(
                            $"{_baseUrl}/events-service/api/v1.0/events/{eventId}",
                            content);

                        var responseContent = 
                            await response.Content.ReadAsStringAsync();

                        Console.WriteLine(
                            $"ACK {eventId}: HTTP {(int)response.StatusCode} " +
                            $"- {responseContent.Substring(0, 
                                Math.Min(200, responseContent.Length))}");

                        if (response.IsSuccessStatusCode)
                        {
                            successCount++;
                            // *** תיקון: UpdateAlertData מטפל במיפוי idHelix → id ***
                            UpdateAlertData(eventId, status: "ACK");
                            await UpdateAlertInCache(eventId, "ACK");
                        }
                        else
                        {
                            if (responseContent.Contains("closed", 
                                    StringComparison.OrdinalIgnoreCase) ||
                                responseContent.Contains("blacked out", 
                                    StringComparison.OrdinalIgnoreCase))
                            {
                                alreadyClosedCount++;
                            }
                            else
                            {
                                failCount++;
                                errors.Add($"Event {eventId}: " +
                                    $"{response.StatusCode} - {responseContent}");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        failCount++;
                        errors.Add($"Event {eventId}: {ex.Message}");
                        Console.Error.WriteLine(
                            $"Error acknowledging {eventId}: {ex.Message}");
                    }
                }

                // *** תיקון: success=true גם אם חלק נכשלו ***
                bool overallSuccess = successCount > 0 || alreadyClosedCount > 0;

                return Json(new
                {
                    success = overallSuccess,
                    message = $"Total: {validEventIds.Count}, " +
                        $"Success: {successCount}, " +
                        $"Already Closed: {alreadyClosedCount}, " +
                        $"Failed: {failCount}",
                    successCount,
                    failCount,
                    alreadyClosedCount,
                    errors = errors.Count > 0 ? errors : null
                });
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in AcknowledgeEvents: {ex.Message}");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    private async Task UpdateAlertInCache(string helixId, string newStatus, 
        string note = null, string userName = null)
    {
        try
        {
            if (!System.IO.File.Exists(_alertsCacheFilePath)) return;

            string json;
            lock (_fileLock)
            {
                json = System.IO.File.ReadAllText(_alertsCacheFilePath);
            }

            if (string.IsNullOrWhiteSpace(json)) return;

            // פרסר את הקאש
            using var doc = JsonDocument.Parse(json);
            var alerts = doc.RootElement.EnumerateArray().ToList();

            var updatedAlerts = new List<object>();
            bool found = false;

            foreach (var alertElement in alerts)
            {
                // בדוק אם זו ההתראה שצריך לעדכן
                string alertHelixId = "";
                if (alertElement.TryGetProperty("idHelix", out var helixProp))
                    alertHelixId = helixProp.GetString() ?? "";

                if (string.Equals(alertHelixId, helixId, 
                    StringComparison.OrdinalIgnoreCase))
                {
                    found = true;

                    // בנה אובייקט מעודכן
                    var dict = new Dictionary<string, object>();

                    foreach (var prop in alertElement.EnumerateObject())
                    {
                        dict[prop.Name] = prop.Name switch
                        {
                            "status" => newStatus ?? 
                                JsonSerializer.Deserialize<object>(prop.Value.GetRawText()),
                            "modified" => DateTimeOffset.UtcNow
                                .ToUnixTimeMilliseconds(),
                            _ => JsonSerializer.Deserialize<object>(
                                prop.Value.GetRawText())
                        };
                    }

                    // הוסף הערה אם יש
                    if (!string.IsNullOrEmpty(note) && 
                        !string.IsNullOrEmpty(userName))
                    {
                        var newNote = new
                        {
                            text = note,
                            userName = userName,
                            date = DateTime.UtcNow,
                            time = DateTime.Now.ToString("HH:mm"),
                            source = userName
                        };

                        // קבל הערות קיימות
                        List<object> existingNotes = new List<object>();
                        if (alertElement.TryGetProperty("notes", 
                            out var notesProp) && 
                            notesProp.ValueKind == JsonValueKind.Array)
                        {
                            existingNotes = notesProp.EnumerateArray()
                                .Select(n => (object)JsonSerializer
                                    .Deserialize<object>(n.GetRawText()))
                                .ToList();
                        }

                        existingNotes.Insert(0, newNote);
                        dict["notes"] = existingNotes;
                    }

                    updatedAlerts.Add(dict);
                }
                else
                {
                    updatedAlerts.Add(JsonSerializer.Deserialize<object>(
                        alertElement.GetRawText()));
                }
            }

            if (found)
            {
                lock (_fileLock)
                {
                    System.IO.File.WriteAllText(
                        _alertsCacheFilePath,
                        JsonSerializer.Serialize(updatedAlerts));
                }
                Console.WriteLine(
                    $"✓ Cache updated for helixId={helixId}, " +
                    $"newStatus={newStatus}");
            }
            else
            {
                Console.WriteLine(
                    $"⚠ helixId={helixId} not found in cache");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"Error updating cache for {helixId}: {ex.Message}");
        }
    }

    [HttpPost]
    public async Task<IActionResult> AddNote([FromBody] AddNoteRequest request)
    {
        try
        {
            // וודא שיש לנו טוקן תקף
            await EnsureValidToken();
            
            // בדיקת תקינות הבקשה
            if (string.IsNullOrEmpty(request.EventId) || string.IsNullOrEmpty(request.Note))
            {
                return Json(new { success = false, error = "Event ID and Note are required" });
            }
            
            // קריאה ל-API להוספת הערה
            var client = CreateHttpClient();
            client.DefaultRequestHeaders.Add("Authorization", $"Bearer {_jwtToken}");
            client.DefaultRequestHeaders.Add("tenantId", _tenantId);
            
            // שינוי כותרת ה-Accept ל-application/json בלבד
            client.DefaultRequestHeaders.Accept.Clear();
            client.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
            
            // בניית גוף הבקשה לפי דרישות ה-API
            var requestBody = new
            {
                eventIds = new string[] { request.EventId },
                slots = new
                {
                    notes = request.Note
                }
            };
            
            var jsonBody = JsonSerializer.Serialize(requestBody);
            var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
            
            // שליחת הבקשה ל-API
            var url = $"{_baseUrl}/events-service/api/v1.0/events/operations/addNote";
            
            var response = await client.PostAsync(url, content);
            var responseContent = await response.Content.ReadAsStringAsync();
            
            // בדיקה אם התגובה מצביעה על הצלחה
            bool apiSuccess = response.IsSuccessStatusCode;
            
            // עדכן את המידע המקומי
            UpdateAlertData(request.AlertId, notes: request.Note, userName: request.UserName ?? "משתמש");
            await UpdateAlertInCache(request.EventId, null, 
                request.Note, request.UserName ?? "משתמש");
            
            if (apiSuccess)
            {
                return Json(new { success = true, message = "Note added successfully to API and local storage" });
            }
            else
            {
                
                // בדיקה אם יש שגיאה ספציפית שאפשר להציג למשתמש
                string errorMessage = "API update failed";
                try
                {
                    var errorJson = JsonSerializer.Deserialize<JsonElement>(responseContent);
                    if (errorJson.TryGetProperty("statusMsg", out var statusMsg))
                    {
                        errorMessage = statusMsg.GetString();
                    }
                }
                catch { /* התעלם משגיאות פירוק JSON */ }
                
                // אם ה-API נכשל, עדיין נחזיר הצלחה כי עדכנו מקומית
                return Json(new { 
                    success = true, 
                    message = "Note added to local storage only. API update failed.",
                    apiError = errorMessage,
                    fullError = responseContent
                });
            }
        }
        catch (Exception ex)
        {            
            // נסה לעדכן מקומית למרות השגיאה
            try {
                UpdateAlertData(request.EventId, notes: request.Note, userName: request.UserName ?? "משתמש");
                return Json(new { 
                    success = true, 
                    message = "Note added to local storage only. API update failed.",
                    apiError = ex.Message
                });
            } catch {
                return StatusCode(500, new { error = ex.Message });
            }
        }
    }
    
    [HttpPost]
    public async Task<IActionResult> AddBulkNotes([FromBody] AddBulkNotesRequest request)
    {
        try
        {
            // וודא שיש לנו טוקן תקף
            await EnsureValidToken();
            
            // בדיקת תקינות הבקשה
            if (request.EventIds == null || request.EventIds.Length == 0 || string.IsNullOrEmpty(request.Note))
            {
                return Json(new { success = false, error = "Event IDs and Note are required" });
            }
            
            int successCount = 0;
            int failCount = 0;
            var errors = new List<string>();
            
            // עבור על כל ההתראות ועדכן אותן
            foreach (var eventId in request.EventIds)
            {
                try
                {
                    // עדכן את המידע המקומי
                    UpdateAlertData(eventId, notes: request.Note, userName: request.UserName ?? "משתמש");
                    successCount++;
                }
                catch (Exception ex)
                {
                    failCount++;
                    errors.Add($"Error updating alert {eventId}: {ex.Message}");
                }
            }
            
            return Json(new { 
                success = successCount > 0, 
                message = $"Notes added to {successCount} alerts. Failed: {failCount}",
                successCount = successCount,
                failCount = failCount,
                errors = errors.Count > 0 ? errors : null
            });
        }
        catch (Exception ex)
        {            
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // עדכון מידע על התראה
    private void UpdateAlertData(string alertId, string status = null, 
        string notes = null, string assignee = null, string userName = "Helix")
    {
        if (string.IsNullOrEmpty(alertId))
        {
            Console.Error.WriteLine("Error: Cannot update alert data: alertId is null or empty");
            return;
        }

        // *** תיקון: אם זה idHelix, המר למזהה פנימי ***
        string internalId = alertId;
        if (_helixIdToInternalId.TryGetValue(alertId, out var mappedId))
        {
            internalId = mappedId;
            Console.WriteLine($"Mapped helixId {alertId} → internalId {internalId}");
        }

        var alertsData = LoadAlertsData();

        if (!alertsData.TryGetValue(internalId, out var alertData))
        {
            alertData = new AlertData();
            alertsData[internalId] = alertData;
        }

        if (status != null)
            alertData.Status = status;

        if (notes != null)
        {
            if (alertData.Notes == null)
                alertData.Notes = new List<NoteItem>();

            alertData.Notes.Insert(0, new NoteItem
            {
                Text = notes,
                UserName = userName,
                Date = DateTime.UtcNow,
                Time = DateTime.Now.ToString("HH:mm")
            });
        }

        if (assignee != null)
            alertData.Assignee = assignee;

        alertData.LastModified = DateTime.UtcNow;

        SaveAlertsData(alertsData);
        Console.WriteLine($"✓ UpdateAlertData: id={internalId}, status={status ?? "unchanged"}");
    }

    // ==========================================
    // טעינת סינונים שמורים מקובץ
    // ==========================================
    private List<SavedFilterData> LoadSavedFilters()
    {
        lock (_fileLock)
        {
            try
            {
                if (!System.IO.File.Exists(_savedFiltersFilePath))
                    return new List<SavedFilterData>();

                var json = System.IO.File.ReadAllText(_savedFiltersFilePath);
                return string.IsNullOrEmpty(json)
                    ? new List<SavedFilterData>()
                    : JsonSerializer.Deserialize<List<SavedFilterData>>(
                        json,
                        new JsonSerializerOptions
                        {
                            PropertyNameCaseInsensitive = true
                        }
                    ) ?? new List<SavedFilterData>();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"Error loading saved filters: {ex.Message}"
                );
                return new List<SavedFilterData>();
            }
        }
    }

    // ==========================================
    // שמירת סינונים שמורים לקובץ
    // ==========================================
    private void SaveFiltersToFile(List<SavedFilterData> filters)
    {
        lock (_fileLock)
        {
            try
            {
                Directory.CreateDirectory(
                    Path.GetDirectoryName(_savedFiltersFilePath)
                );
                var json = JsonSerializer.Serialize(
                    filters,
                    new JsonSerializerOptions { WriteIndented = true }
                );
                System.IO.File.WriteAllText(_savedFiltersFilePath, json);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(
                    $"Error saving filters: {ex.Message}"
                );
            }
        }
    }

    // ==========================================
    // GET - קבלת סינונים שמורים
    // ==========================================
    [HttpGet]
    public IActionResult GetSavedFilters()
    {
        try
        {
            var allFilters = LoadSavedFilters();

            // קבל את שם המשתמש הנוכחי מה-session/claims
            var currentUsername = User.Identity?.Name ?? "";

            // החזר: גלובליים + אישיים של המשתמש הנוכחי
            var visibleFilters = allFilters
                .Where(f =>
                    f.IsGlobal ||
                    string.Equals(
                        f.CreatedBy,
                        currentUsername,
                        StringComparison.OrdinalIgnoreCase
                    )
                )
                .OrderByDescending(f => f.IsGlobal)
                .ThenByDescending(f => f.CreatedAt)
                .ToList();

            return Json(new { success = true, filters = visibleFilters });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                $"Error in GetSavedFilters: {ex.Message}"
            );
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // ==========================================
    // POST - שמירת סינון חדש
    // ==========================================
    [HttpPost]
    public IActionResult SaveFilter([FromBody] SavedFilterRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request?.Name))
            {
                return Json(new
                {
                    success = false,
                    message = "שם הסינון לא יכול להיות ריק"
                });
            }

            var currentUsername = User.Identity?.Name ?? "anonymous";

            // רק Admin/NOC יכולים לשמור גלובלי
            bool isAdmin = User.IsInRole("Admin") || User.IsInRole("NOC");
            bool isGlobal = request.IsGlobal && isAdmin;

            var allFilters = LoadSavedFilters();

            // בדוק כפילות שם (לאותו משתמש)
            bool nameExists = allFilters.Any(f =>
                string.Equals(f.Name, request.Name,
                    StringComparison.OrdinalIgnoreCase) &&
                string.Equals(f.CreatedBy, currentUsername,
                    StringComparison.OrdinalIgnoreCase) &&
                f.IsGlobal == isGlobal
            );

            if (nameExists)
            {
                return Json(new
                {
                    success = false,
                    message = $"סינון בשם \"{request.Name}\" כבר קיים"
                });
            }

            var newFilter = new SavedFilterData
            {
                Id = $"filter_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}" +
                    $"_{Guid.NewGuid().ToString("N").Substring(0, 8)}",
                Name = request.Name.Trim(),
                IsGlobal = isGlobal,
                CreatedBy = currentUsername,
                CreatedAt = DateTime.UtcNow.ToString("o"),
                Filters = request.Filters
            };

            allFilters.Add(newFilter);
            SaveFiltersToFile(allFilters);

            return Json(new
            {
                success = true,
                id = newFilter.Id,
                message = "הסינון נשמר בהצלחה"
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in SaveFilter: {ex.Message}");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // ==========================================
    // DELETE - מחיקת סינון
    // ==========================================
    [HttpDelete]
    public IActionResult DeleteFilter(string id)
    {
        try
        {
            if (string.IsNullOrEmpty(id))
            {
                return Json(new
                {
                    success = false,
                    message = "מזהה הסינון לא יכול להיות ריק"
                });
            }

            var currentUsername = User.Identity?.Name ?? "";
            bool isAdmin = User.IsInRole("Admin") || User.IsInRole("NOC");

            var allFilters = LoadSavedFilters();
            var filter = allFilters.FirstOrDefault(f => f.Id == id);

            if (filter == null)
            {
                return Json(new
                {
                    success = false,
                    message = "הסינון לא נמצא"
                });
            }

            // בדוק הרשאה למחיקה
            bool canDelete = isAdmin ||
                string.Equals(
                    filter.CreatedBy,
                    currentUsername,
                    StringComparison.OrdinalIgnoreCase
                );

            if (!canDelete)
            {
                return Json(new
                {
                    success = false,
                    message = "אין הרשאה למחוק סינון זה"
                });
            }

            allFilters.Remove(filter);
            SaveFiltersToFile(allFilters);

            return Json(new { success = true, message = "הסינון נמחק בהצלחה" });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error in DeleteFilter: {ex.Message}");
            return StatusCode(500, new { success = false, error = ex.Message });
        }
    }

    // ── עזר: שלוף התראות מהקאש לפי IDs ──────────────────────────────
    private List<JsonElement> GetAlertsFromCacheByIds(List<string> ids)
    {
        var result = new List<JsonElement>();
        try
        {
            if (!System.IO.File.Exists(_alertsCacheFilePath)) return result;

            string json;
            lock (_fileLock)
            {
                json = System.IO.File.ReadAllText(_alertsCacheFilePath);
            }

            using var doc = JsonDocument.Parse(json);
            foreach (var el in doc.RootElement.EnumerateArray())
            {
                if (el.TryGetProperty("id", out var idProp) &&
                    ids.Contains(idProp.GetString() ?? ""))
                    result.Add(el.Clone());
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"GetAlertsFromCacheByIds: {ex.Message}");
        }
        return result;
    }

    // ── עזר: חלץ שדה מ-JsonElement ───────────────────────────────────
    private string GetAlertField(JsonElement el, string field) =>
        el.TryGetProperty(field, out var p) &&
        p.ValueKind == JsonValueKind.String
            ? p.GetString() ?? "-"
            : "-";

    // ────────────────────────────────────────────────────────────────────
    //  SendAlertEmail - שליחת מייל התראה (יחידה או מרובה)
    // ────────────────────────────────────────────────────────────────────
    [HttpPost]
    public async Task<IActionResult> SendAlertEmail(
        [FromBody] SendAlertEmailRequest request)
    {
        try
        {
            // ── ולידציה ──────────────────────────────────────────────
            if (request?.To == null || request.To.Count == 0)
                return Json(new { success = false, error = "לא הוזנו נמענים" });

            if (string.IsNullOrWhiteSpace(request.Subject))
                return Json(new { success = false, error = "חסר נושא" });

            // ── שלוף התראות מהקאש לפי IDs ───────────────────────────
            var alerts = GetAlertsFromCacheByIds(request.AlertIds ?? new List<string>());

            if (alerts.Count == 0)
                return Json(new { success = false, error = "לא נמצאו התראות" });

            // ── שעון ישראל ───────────────────────────────────────────
            var israelTz = TimeZoneInfo.FindSystemTimeZoneById("Israel Standard Time");

            // ── בנה שורות טבלה ───────────────────────────────────────
            var rows = new System.Text.StringBuilder();

            foreach (var a in alerts)
            {
                string host        = GetAlertField(a, "host");
                string hostAddress = GetAlertField(a, "hostAddress");
                string message     = GetAlertField(a, "message");
                string severity    = GetAlertField(a, "severity");

                // תאריך פתיחה
                string openedDate = "-";
                if (a.TryGetProperty("timestamp", out var tsProp) &&
                    tsProp.ValueKind == JsonValueKind.Number)
                {
                    var dt = TimeZoneInfo.ConvertTime(
                        DateTimeOffset.FromUnixTimeMilliseconds(
                            tsProp.GetInt64()).UtcDateTime,
                        israelTz);
                    openedDate = dt.ToString("dd/MM/yyyy HH:mm");
                }

                // צבע severity
                string bg = (severity?.ToUpper()) switch
                {
                    "CRITICAL" => "#e53e3e",
                    "MAJOR"    => "#dd6b20",
                    "UNKNOWN"  => "#805ad5",
                    _          => "#718096"
                };

                rows.Append($@"
    <tr>
        <td style=""padding:8px 12px;border:1px solid #ddd;font-size:13px;
                    text-align:center;vertical-align:middle;"">
            {System.Web.HttpUtility.HtmlEncode(message)}
        </td>
        <td style=""padding:8px 12px;border:1px solid #ddd;font-size:13px;
                    text-align:center;vertical-align:middle;"">
            {System.Web.HttpUtility.HtmlEncode(hostAddress)}
        </td>
        <td style=""padding:8px 12px;border:1px solid #ddd;font-size:13px;
                    text-align:center;vertical-align:middle;"">
            {System.Web.HttpUtility.HtmlEncode(host)}
        </td>
        <td style=""padding:8px 12px;border:1px solid #ddd;
                    text-align:center;vertical-align:middle;"">
            <span style=""display:inline-block;padding:3px 10px;border-radius:12px;
                        font-size:11px;font-weight:700;
                        background:{bg};color:#fff;"">
            {System.Web.HttpUtility.HtmlEncode(severity ?? "UNKNOWN")}
            </span>
        </td>
        <td style=""padding:8px 12px;border:1px solid #ddd;font-size:13px;
                    text-align:center;vertical-align:middle;white-space:nowrap;"">
            {System.Web.HttpUtility.HtmlEncode(openedDate)}
        </td>
    </tr>");
            }

            // ── כותרת דינמית לפי מספר התראות ────────────────────────
            bool isSingle   = alerts.Count == 1;
            string introText = isSingle
                ? "התראה זו פתוחה לטיפול במסך ההתראות:"
                : "התראות אלו פתוחות לטיפול במסך ההתראות:";

            string tableTitle = isSingle
                ? "פרטי ההתראה:"
                : "פרטי ההתראות:";

            // ── חתימה ────────────────────────────────────────────────
            var signaturePath = System.IO.Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "wwwroot", "images", "noc_signature.png");
            bool hasSignature = System.IO.File.Exists(signaturePath);

            var signatureHtml = hasSignature
                ? @"<img src=""cid:noc_signature"" alt=""NOC Team""
                        style=""max-width:300px;height:auto;
                                display:block;margin-top:8px;""/>"
                : @"<p style=""margin:4px 0 0;font-size:13px;
                            color:#64748B;"">חדר מחשב - NOC</p>";

            // ── בנה HTML מלא ─────────────────────────────────────────
            var htmlBody = $@"<!DOCTYPE html>
    <html dir=""rtl"" lang=""he"">
    <head><meta charset=""UTF-8""></head>
    <body style=""font-family:Arial,Helvetica,sans-serif;direction:rtl;
                font-size:14px;color:#333;line-height:1.7;
                padding:20px;margin:0;"">

    <p style=""margin:0 0 8px 0;"">היי,</p>
    <p style=""margin:0 0 16px 0;"">
        {introText}
    </p>

    <p style=""margin:0 0 8px 0;font-weight:700;color:#1e293b;"">
        {tableTitle}
    </p>

    <table style=""width:100%;border-collapse:collapse;
                direction:rtl;margin-bottom:24px;"">
        <thead>
        <tr style=""background:#320F5B;"">
            <th style=""padding:10px 12px;border:1px solid #4a1a7a;
                    color:#fff;font-size:13px;font-weight:700;
                    text-align:center;vertical-align:middle;"">Message</th>
            <th style=""padding:10px 12px;border:1px solid #4a1a7a;
                    color:#fff;font-size:13px;font-weight:700;
                    text-align:center;vertical-align:middle;"">IP Address</th>
            <th style=""padding:10px 12px;border:1px solid #4a1a7a;
                    color:#fff;font-size:13px;font-weight:700;
                    text-align:center;vertical-align:middle;"">Host Name</th>
            <th style=""padding:10px 12px;border:1px solid #4a1a7a;
                    color:#fff;font-size:13px;font-weight:700;
                    text-align:center;vertical-align:middle;"">Severity</th>
            <th style=""padding:10px 12px;border:1px solid #4a1a7a;
                    color:#fff;font-size:13px;font-weight:700;
                    text-align:center;vertical-align:middle;direction:ltr;"">Date & Time</th>
        </tr>
        </thead>
        <tbody>
        {rows}
        </tbody>
    </table>

    <br>
    {signatureHtml}

    </body>
    </html>";

            // ── שלח SMTP ─────────────────────────────────────────────
            using var smtp = new System.Net.Mail.SmtpClient("172.22.28.25", 25)
            {
                EnableSsl             = false,
                DeliveryMethod        = System.Net.Mail.SmtpDeliveryMethod.Network,
                UseDefaultCredentials = false,
                Credentials           = System.Net.CredentialCache.DefaultNetworkCredentials,
                Timeout               = 10_000
            };

            using var mail = new System.Net.Mail.MailMessage
            {
                From       = new System.Net.Mail.MailAddress(
                    "noc@menoramivt.co.il", "NOC Portal"),
                Subject    = request.Subject,
                IsBodyHtml = true
            };

            mail.SubjectEncoding = System.Text.Encoding.UTF8;
            mail.BodyEncoding    = System.Text.Encoding.UTF8;
            mail.HeadersEncoding = System.Text.Encoding.UTF8;

            // ── נמענים (To) ──────────────────────────────────────────
            foreach (var addr in request.To.Where(a =>
                !string.IsNullOrWhiteSpace(a) && a.Contains('@')))
                mail.To.Add(addr.Trim());

            // ── עותק (CC) ────────────────────────────────────────────
            foreach (var addr in (request.Cc ?? new List<string>()).Where(a =>
                !string.IsNullOrWhiteSpace(a) && a.Contains('@')))
                mail.CC.Add(addr.Trim());

            // ── HTML View ────────────────────────────────────────────
            var htmlView = System.Net.Mail.AlternateView
                .CreateAlternateViewFromString(
                    htmlBody, System.Text.Encoding.UTF8, "text/html");

            if (hasSignature)
            {
                var sig = new System.Net.Mail.LinkedResource(
                    signaturePath, "image/png")
                {
                    ContentId        = "noc_signature",
                    TransferEncoding = System.Net.Mime.TransferEncoding.Base64
                };
                htmlView.LinkedResources.Add(sig);
            }

            mail.AlternateViews.Add(htmlView);
            await smtp.SendMailAsync(mail);
            _auditLog?.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.EmailSent,
                Username  = "system",
                IpAddress = "system",
                Details   = $"[SendAlertEmail] Email sent | To={string.Join(", ", request.To)}",
                Success   = true
            });
            Console.WriteLine(
                $"[SendAlertEmail] נשלח אל {string.Join(", ", request.To)} | " +
                $"alertIds: {string.Join(", ", request.AlertIds ?? new List<string>())}");

            return Json(new { success = true, count = alerts.Count });
        }
        catch (System.Net.Mail.SmtpException ex)
        {
             _auditLog?.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.EmailFailed,
                Username  = "system",
                IpAddress = "system",
                Details   = $"[SendAlertEmail] Email failed | To={string.Join(", ", request.To)} | Error={ex.Message}",
                Success   = false
            });
            Console.Error.WriteLine($"[SendAlertEmail] SMTP: {ex.Message}");
            return Json(new { success = false,
                error = $"שגיאת שרת מייל: {ex.Message}" });
        }
        catch (Exception ex)
        {
             _auditLog?.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.EmailFailed,
                Username  = "system",
                IpAddress = "system",
                Details   = $"[SendAlertEmail] Email failed | To={string.Join(", ", request.To)} | Error={ex.Message}",
                Success   = false
            });
            Console.Error.WriteLine($"[SendAlertEmail] {ex.Message}");
            return Json(new { success = false, error = ex.Message });
        }
    }

    private async Task EnsureValidToken()
    {
        // בדוק אם הטוקן תקף
        if (!string.IsNullOrEmpty(_jwtToken) && _tokenExpiry > DateTime.UtcNow)
        {
            return;
        }
        
        var client = CreateHttpClient();
        
        // Step 1: Get Refresh Token
        var loginBody = new
        {
            access_key = _accessKey,
            access_secret_key = _accessToken
        };
        
        var loginContent = new StringContent(
            JsonSerializer.Serialize(loginBody),
            Encoding.UTF8,
            "application/json");
            
        var loginResponse = await client.PostAsync($"{_baseUrl}/ims/api/v1/access_keys/login", loginContent);
        loginResponse.EnsureSuccessStatusCode();
        
        var loginResponseContent = await loginResponse.Content.ReadAsStringAsync();
        var loginData = JsonSerializer.Deserialize<JsonElement>(loginResponseContent);
        var refreshToken = loginData.GetProperty("token").GetString();
        
        // Step 2: Get JWT Token
        var tokenBody = new
        {
            token = refreshToken
        };
        
        var tokenContent = new StringContent(
            JsonSerializer.Serialize(tokenBody),
            Encoding.UTF8,
            "application/json");
            
        var tokenResponse = await client.PostAsync($"{_baseUrl}/ims/api/v1/auth/tokens", tokenContent);
        tokenResponse.EnsureSuccessStatusCode();
        
        var tokenResponseContent = await tokenResponse.Content.ReadAsStringAsync();
        var tokenData = JsonSerializer.Deserialize<JsonElement>(tokenResponseContent);
        _jwtToken = tokenData.GetProperty("json_web_token").GetString();
        
        // הגדר תפוגה של הטוקן (10 דקות)
        _tokenExpiry = DateTime.UtcNow.AddMinutes(10);
    }
    
    private HttpClient CreateHttpClient()
    {
        // השתמש ב-HttpClientFactory במקום ליצור HttpClient חדש
        var client = _httpClientFactory.CreateClient("HelixClient");
        
        // הגדר את הפרוקסי בצורה נכונה
        var handler = new HttpClientHandler
        {
            Proxy = new System.Net.WebProxy(_proxyUrl),
            UseProxy = true,
            ServerCertificateCustomValidationCallback = (sender, cert, chain, sslPolicyErrors) => true
        };
        
        client = new HttpClient(handler);
        client.DefaultRequestHeaders.Add("Accept", "application/json");
        
        return client;
    }
    
    private string GetStringProperty(JsonElement element, string propertyName)
    {
        if (element.TryGetProperty(propertyName, out var prop) && prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString();
        }
        return null;
    }
    
    private string MapSeverity(string severity)
    {
        severity = (severity ?? "").ToUpper();
        
        switch (severity)
        {
            case "CRITICAL":
            case "FATAL":
                return "CRITICAL";
            case "MAJOR":
            case "WARNING":
            case "MINOR":
                return "MAJOR";
            case "OK":
                return "OK";
            default:
                return "UNKNOWN";
        }
    }
    
    private string MapStatus(string status)
    {
        status = (status ?? "").ToUpper();
        
        switch (status)
        {
            case "OPEN":
            case "NEW":
                return "OPEN";
            case "ACKNOWLEDGED":
            case "ACK":
                return "ACK";
            case "ASSIGNED":
            case "ASSIGN":
                return "ASSIGN";
            case "CLOSED":
                return "CLOSED";
            default:
                return status;
        }
    }
}


// ── DTO מאוחד לשליחת מייל (יחיד ומרובה) ──────────────────────────
public class SendAlertEmailRequest
{
    public List<string> AlertIds { get; set; } = new();
    public List<string> To       { get; set; } = new();
    public List<string> Cc       { get; set; } = new();
    public string       Subject  { get; set; } = "";
}

// מחלקה לשמירת מידע על התראות
public class AlertData
{
    public string Status { get; set; }
    public List<NoteItem> Notes { get; set; } = new List<NoteItem>();
    public string Assignee { get; set; }
    public DateTime LastModified { get; set; } = DateTime.UtcNow;
}

// מחלקה חדשה לייצוג הערה בודדת
public class NoteItem
{
    public string Text { get; set; }
    public string UserName { get; set; } = "Helix";
    public DateTime Date { get; set; } = DateTime.UtcNow;
    public string Time { get; set; } = DateTime.Now.ToString("HH:mm");
    public string Source { get; set; } = "";
    public bool IsOverrideClosed { get; set; } = false;
}

// מחלקות בקשה
public class AcknowledgeEventsRequest
{
    public string[] EventIds { get; set; }
}

public class AssignEventRequest
{
    public string EventId { get; set; }
    public string Assignee { get; set; }
}

public class AssignEventsRequest
{
    public string[] EventIds { get; set; }
    public string AssignedUser { get; set; }
    public string Note { get; set; }
}

public class AddNoteRequest
{
    public string EventId { get; set; }
    public string Note { get; set; }
    public string UserName { get; set; }
    public string AlertId { get; set; }
}

public class SetAlertStatusRequest
{
    public string EventId { get; set; }
    public string Status { get; set; }
}

public class CloseEventsRequest
{
    public string[] EventIds { get; set; }
    public string Note { get; set; }
}

public class AddBulkNotesRequest
{
    public string[] EventIds { get; set; }
    public string Note { get; set; }
    public string UserName { get; set; }
}

// ==========================================
// Saved Filters - מחלקות בקשה
// ==========================================

public class SavedFilterRequest
{
    public string Id { get; set; }
    public string Name { get; set; }
    public bool IsGlobal { get; set; }
    public string CreatedBy { get; set; }
    public string CreatedAt { get; set; }
    public SavedFilterSnapshot Filters { get; set; }
}

public class SavedFilterSnapshot
{
    public List<string> SeverityFilters { get; set; }
    public List<string> StatusFilters { get; set; }
    public string SearchTerm { get; set; }
}

public class SavedFilterData
{
    public string Id { get; set; }
    public string Name { get; set; }
    public bool IsGlobal { get; set; }
    public string CreatedBy { get; set; }
    public string CreatedAt { get; set; }
    public SavedFilterSnapshot Filters { get; set; }
}