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
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly string _proxyUrl = "http://10.10.111.209:8080";
    private readonly string _accessKey = "85Q505MJG73R3KVTYDI9YEZLYT8I59";
    private readonly string _accessToken = "MhMx6Xzxg3djFUmUO0gP3kkgMdxvMlOiY8ZJIbrlix9YMthuTq";
    private readonly string _tenantId = "976648405";
    private readonly string _baseUrl = "https://menora-itom.onbmc.com";
    
    // מטמון לטוקנים
    private static string _jwtToken;
    private static DateTime _tokenExpiry = DateTime.MinValue;
    
    // קובץ לשמירת מידע על התראות
    private readonly string _alertsDataFilePath = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\files\alerts_data.txt";
    private readonly string _alertsCacheFilePath = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\files\alerts_cache.json";

    // נתיב לקובץ הסינונים השמורים
    private readonly string _savedFiltersFilePath = 
        @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\files\saved_filters.json";

    private static readonly object _fileLock = new object();

    public AlertsController(IHttpClientFactory httpClientFactory, IWebHostEnvironment env)
    {
        _httpClientFactory = httpClientFactory;
        
        // וודא שהתיקייה קיימת
        Directory.CreateDirectory(Path.GetDirectoryName(_alertsDataFilePath));
        
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
    public IActionResult GetAlerts(int minutes = 1440)
    {
        try
        {
            // קריאה מהקובץ המקומי
            string json;
            lock (_fileLock)
            {
                if (!System.IO.File.Exists(_alertsCacheFilePath))
                {
                    return Json(new List<object>()); // אם הקובץ לא קיים, החזר רשימה ריקה
                }
                json = System.IO.File.ReadAllText(_alertsCacheFilePath);
            }
            
            // המרת ה-JSON לאובייקטים
            var alerts = JsonSerializer.Deserialize<List<object>>(json);
            
            return Json(alerts);
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
            Console.Error.WriteLine($">>> ERROR in FetchEventNotes for event {eventId}: {ex.Message}");
            Console.Error.WriteLine($">>> Stack trace: {ex.StackTrace}");
            return new List<NoteItem>();
        }
    }

    [HttpGet]
    public async Task<IActionResult> UpdateAlertsCache()
    {
        try
        {
            // בדוק אם הקובץ עודכן ב-1 הדקות האחרונות ואם לא נדרש רענון מלא
            bool shouldUpdate = true;
            
            if (System.IO.File.Exists(_alertsCacheFilePath))
            {
                var lastWriteTime = System.IO.File.GetLastWriteTime(_alertsCacheFilePath);
                var timeSinceLastUpdate = DateTime.Now - lastWriteTime;
                
                // אם עברו יותר מ-3 דקות בלי עדכון - מחק את הקאש
                if (timeSinceLastUpdate.TotalMinutes >= 3)
                {
                    lock (_fileLock)
                    {
                        if (System.IO.File.Exists(_alertsCacheFilePath))
                        {
                            System.IO.File.Delete(_alertsCacheFilePath);
                            Console.WriteLine($"Cache deleted - not updated for {timeSinceLastUpdate.TotalMinutes:F1} minutes");
                        }
                    }
                    
                    // נקה את מטמון ההערות
                    ClearNotesCache();
                    
                    // עדכן מחדש
                    shouldUpdate = true;
                }
                // אם עברו פחות מ-1 דקות מהעדכון האחרון, אל תעדכן
                if (timeSinceLastUpdate.TotalMinutes < 1)
                {
                    shouldUpdate = false;
                    return Json(new { success = true, updated = false, message = "Cache is still fresh" });
                }
            }
            
            // רק אם צריך לעדכן, פנה ל-API
            if (shouldUpdate)
            {
                // נקה את מטמון ההערות לפני עדכון
                ClearNotesCache();
                
                // קריאה לשירות החיצוני לקבלת התראות עדכניות
                var alerts = await FetchAlertsFromService();
                
                // שמירת ההתראות בקובץ מטמון
                lock (_fileLock)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_alertsCacheFilePath));
                    System.IO.File.WriteAllText(_alertsCacheFilePath, JsonSerializer.Serialize(alerts));
                }
                
                return Json(new { success = true, updated = true, count = alerts.Count });
            }
            
            return Json(new { success = true, updated = false });
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
                                    query = "mx_noc:Yes AND NOT (status:CLOSED OR BLACKOUT)"
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
                            if (alertData != null && !string.IsNullOrEmpty(alertData.Status))
                            {
                                status = alertData.Status;
                            }

                            // הוסף מידע על המשתמש שקיבל את ההקצאה אם קיים
                            if (alertData != null && !string.IsNullOrEmpty(alertData.Assignee))
                            {
                                contacts = $"{contacts} (Assigned to: {alertData.Assignee})";
                            }

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
                    // עדכון מקומי
                    foreach (var eventId in request.EventIds)
                    {
                        // חילוץ שם המשתמש מההערה
                        string userName = "Helix";
                        string noteText = request.Note;
                        
                        // אם ההערה מכילה ":", חלק אותה לשם משתמש והערה
                        if (!string.IsNullOrEmpty(request.Note) && request.Note.Contains(":"))
                        {
                            var parts = request.Note.Split(':', 2);
                            userName = parts[0].Trim();
                            noteText = parts[1].Trim();
                        }
                        
                        // עדכון הסטטוס
                        UpdateAlertData(eventId, status: "CLOSED");
                        
                        // הוספת ההערה בנפרד
                        if (!string.IsNullOrEmpty(noteText))
                        {
                            UpdateAlertData(eventId, notes: noteText, userName: userName);
                        }
                    }
                    
                    return Json(new { 
                        success = true, 
                        message = "Events closed successfully" 
                    });
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
    public async Task<IActionResult> AcknowledgeEvents([FromBody] AcknowledgeEventsRequest request)
    {
        try
        {
            // Filter invalid IDs
            var validEventIds = request.EventIds
                .Where(id => !string.IsNullOrWhiteSpace(id) && id != "service")
                .ToList();
            
            if (validEventIds.Count == 0)
            {
                return Json(new { success = false, message = "No valid event IDs to acknowledge" });
            }
            
            // Ensure valid token
            await EnsureValidToken();
            
            // שימוש ב-HttpClient מהפקטורי במקום ליצור חדש
            var client = _httpClientFactory.CreateClient();
            
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
                
                int successCount = 0;
                int failCount = 0;
                int alreadyClosedCount = 0;
                var errors = new List<string>();
                
                // Build request body
                var body = new { status = "ACK" };
                var jsonBody = JsonSerializer.Serialize(body);
                
                // Loop through each event ID and update separately
                foreach (var eventId in validEventIds)
                {
                    try
                    {
                        var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                        
                        // שימוש ב-PatchAsync במקום SendAsync
                        var response = await httpClient.PatchAsync(
                            $"{_baseUrl}/events-service/api/v1.0/events/{eventId}", content);
                        
                        var responseContent = await response.Content.ReadAsStringAsync();
                        
                        if (response.IsSuccessStatusCode)
                        {
                            successCount++;
                            
                            // Update local data
                            UpdateAlertData(eventId, status: "ACK");
                        }
                        else
                        {
                            // בדיקה מדויקת יותר של תוכן התגובה, בדומה לקוד JavaScript
                            if (responseContent.Contains("closed", StringComparison.OrdinalIgnoreCase) || 
                                responseContent.Contains("blacked out", StringComparison.OrdinalIgnoreCase))
                            {
                                alreadyClosedCount++;
                                Console.WriteLine($"⊘ Event already closed/blacked out: {eventId}");
                            }
                            else
                            {
                                failCount++;
                                errors.Add($"Event {eventId}: {response.StatusCode}, Response: {responseContent}");
                                Console.WriteLine($"✗ Failed to acknowledge event {eventId}. Status: {response.StatusCode}, Response: {responseContent}");
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        failCount++;
                        errors.Add($"Event {eventId}: {ex.Message}");
                        Console.Error.WriteLine($"✗ Error acknowledging event {eventId}: {ex.Message}");
                    }
                }
                
                return Json(new 
                { 
                    success = successCount > 0,
                    message = $"Total: {validEventIds.Count}, Success: {successCount}, Already Closed: {alreadyClosedCount}, Failed: {failCount}",
                    successCount = successCount,
                    failCount = failCount,
                    alreadyClosedCount = alreadyClosedCount,
                    errors = errors.Count > 0 ? errors : null
                });
            }
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
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
    private void UpdateAlertData(string alertId, string status = null, string notes = null, string assignee = null, string userName = "Helix")
    {
        if (string.IsNullOrEmpty(alertId))
        {
            Console.Error.WriteLine("Cannot update alert data: alertId is null or empty");
            return;
        }
        
        // קריאה ישירה מהקובץ
        var alertsData = LoadAlertsData();
        
        // קבל את המידע הקיים או צור חדש
        if (!alertsData.TryGetValue(alertId, out var alertData))
        {
            alertData = new AlertData();
            alertsData[alertId] = alertData;
        }
        
        // עדכן רק את השדות שהועברו
        if (status != null)
        {
            alertData.Status = status;
        }
        
        if (notes != null)
        {
            // יצירת הערה חדשה
            if (alertData.Notes == null)
            {
                alertData.Notes = new List<NoteItem>();
            }
            
            alertData.Notes.Insert(0, new NoteItem
            {
            Text = notes,
            UserName = userName,
            Date = DateTime.UtcNow,
            Time = DateTime.Now.ToString("HH:mm")
            });
        }
        
        if (assignee != null)
        {
            alertData.Assignee = assignee;
        }
        
        // עדכן את זמן השינוי האחרון
        alertData.LastModified = DateTime.UtcNow;
        
        // שמור את המידע לקובץ
        SaveAlertsData(alertsData);
    
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