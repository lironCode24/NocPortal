using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;
using System.Runtime.InteropServices;
using Microsoft.AspNetCore.Http;
using System.Threading.Tasks;

public class ActivitiesController : Controller
{
    private readonly string _activitiesFilePath = PortalPaths.UnderFiles(@"activities.txt");
    private readonly string _activityTasksFilePath = PortalPaths.UnderFiles(@"activity_tasks.txt");
    private readonly string _activityPermissionsFilePath = 
        PortalPaths.UnderFiles(@"activity_permissions.json");
    private readonly NocPortal.Services.EmailService _emailService;

    public ActivitiesController(NocPortal.Services.EmailService emailService)
    {
        _emailService = emailService;
    }

    private bool IsUserAuthenticated()
    {
        return HttpContext.User?.Identity?.IsAuthenticated == true;
    }

    private IActionResult RequireAuth()
    {
        return Json(new { 
            success = false, 
            error = "נדרשת התחברות לביצוע פעולה זו",
            requireLogin = true 
        });
    }

    // ─── Helper: קרא הרשאות מקובץ ───
    private List<ActivityPermission> ReadPermissionsFromFile()
    {
        if (!System.IO.File.Exists(_activityPermissionsFilePath))
            return new List<ActivityPermission>();
        try
        {
            var json = System.IO.File.ReadAllText(_activityPermissionsFilePath);
            return JsonSerializer.Deserialize<List<ActivityPermission>>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? new List<ActivityPermission>();
        }
        catch { return new List<ActivityPermission>(); }
    }

    // ─── Helper: כתוב הרשאות לקובץ ───
    private void WritePermissionsToFile(List<ActivityPermission> permissions)
    {
        var dir = Path.GetDirectoryName(_activityPermissionsFilePath);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        var json = JsonSerializer.Serialize(permissions,
            new JsonSerializerOptions { WriteIndented = true });
        System.IO.File.WriteAllText(_activityPermissionsFilePath, json);
    }

    // ─── GET: קבל הרשאות לפעילות ───
    [HttpGet]
    public IActionResult GetActivityPermissions(string activityId)
    {
        if (!IsUserAuthenticated()) return RequireAuth();
        try
        {
            var all = ReadPermissionsFromFile();
            var perms = activityId != null
                ? all.Where(p => p.ActivityId == activityId).ToList()
                : all;
            return Json(new { success = true, permissions = perms });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: בדוק אם למשתמש הנוכחי יש הרשאה לפעילות ───
    [HttpGet]
    public IActionResult CheckUserPermission(string activityId)
    {
        try
        {
            var username = HttpContext.User?.Identity?.Name ?? "";
            if (string.IsNullOrEmpty(username))
                return Json(new { success = true, hasPermission = false });

            var all = ReadPermissionsFromFile();
            var hasPerm = all.Any(p =>
                p.ActivityId == activityId &&
                string.Equals(p.Username, username,
                    StringComparison.OrdinalIgnoreCase) &&
                p.CanToggle);

            return Json(new { success = true, hasPermission = hasPerm, username });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: הוסף/עדכן הרשאה ───
    [HttpPost]
    public IActionResult SetActivityPermission(
        [FromBody] ActivityPermissionRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth();
        try
        {
            if (string.IsNullOrEmpty(request.ActivityId) ||
                string.IsNullOrEmpty(request.Username))
                return Json(new { success = false, error = "חסרים פרטים" });

            var all = ReadPermissionsFromFile();
            var existing = all.FirstOrDefault(p =>
                p.ActivityId == request.ActivityId &&
                string.Equals(p.Username, request.Username,
                    StringComparison.OrdinalIgnoreCase));

            // *** הוסף: קבע grantedBy לפי מי נתן את ההרשאה ***
            // אם זה בא מ-grantManagerPermissionAuto - ה-caller שולח "מערכת"
            var grantedBy = HttpContext.User?.Identity?.Name ?? "admin";
            bool isAutoGrant = !string.IsNullOrEmpty(request.GrantedBy) && 
                            request.GrantedBy == "מערכת";
            if (isAutoGrant) 
            {
                grantedBy = "מערכת";
            }

            if (existing != null)
            {
                existing.CanToggle   = request.CanToggle;
                existing.GrantedBy   = grantedBy;
                existing.GrantedAt   = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                existing.AutoGranted = isAutoGrant;
            }
            else
            {
                all.Add(new ActivityPermission
                {
                    ActivityId   = request.ActivityId,
                    Username     = request.Username,
                    CanToggle    = request.CanToggle,
                    GrantedBy    = grantedBy,
                    GrantedAt    = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    AutoGranted  = isAutoGrant
                });
            }

            WritePermissionsToFile(all);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── DELETE: הסר הרשאה ───
    [HttpDelete]
    public IActionResult RemoveActivityPermission(
        string activityId, string username)
    {
        if (!IsUserAuthenticated()) return RequireAuth();
        try
        {
            var all = ReadPermissionsFromFile();
            var toRemove = all.FirstOrDefault(p =>
                p.ActivityId == activityId &&
                string.Equals(p.Username, username,
                    StringComparison.OrdinalIgnoreCase));

            if (toRemove != null)
            {
                all.Remove(toRemove);
                WritePermissionsToFile(all);
            }

            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Get all activities
    [HttpGet]
    public IActionResult GetActivities(bool includeArchived = false)
    {
        try
        {
            if (!System.IO.File.Exists(_activitiesFilePath))
            {
                return Json(new List<object>());
            }

            var activities = ReadActivitiesFromFile();
            
            // Filter and sort
            var filteredActivities = activities;
            
            // Filter archived only if not requested
            if (!includeArchived)
            {
                filteredActivities = filteredActivities
                    .Where(a => 
                    {
                        var json = JsonSerializer.Serialize(a);
                        var obj = JsonSerializer.Deserialize<JsonElement>(json);
                        return !obj.TryGetProperty("archived", out var archived) || !archived.GetBoolean();
                    })
                    .ToList();
            }
            
            // Sort by order
            filteredActivities = filteredActivities
                .OrderBy(a => 
                {
                    var json = JsonSerializer.Serialize(a);
                    var obj = JsonSerializer.Deserialize<JsonElement>(json);
                    return obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999;
                })
                .ToList();
            
            return Json(filteredActivities);
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    // Add new activity
    [HttpPost]
    public IActionResult AddActivity([FromBody] ActivityRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth();
        try
        {
            if (string.IsNullOrEmpty(request.Name))
                return Json(new { success = false, error = "שם הפעילות נדרש" });

            if (string.IsNullOrEmpty(request.ActivityDate))
                return Json(new { success = false, error = "תאריך הפעילות נדרש" });

            var activities = ReadActivitiesFromFile();

            int maxOrder = 0;
            foreach (var act in activities)
            {
                var json = JsonSerializer.Serialize(act);
                var obj  = JsonSerializer.Deserialize<JsonElement>(json);
                if (obj.TryGetProperty("order", out var orderProp))
                {
                    int cur = orderProp.GetInt32();
                    if (cur > maxOrder) maxOrder = cur;
                }
            }

            var newActivity = new
            {
                id              = Guid.NewGuid().ToString(),
                name            = request.Name,
                description     = request.Description     ?? "",
                activityDate    = request.ActivityDate,
                activityManager = request.ActivityManager ?? "",  // *** חדש ***
                createdAt       = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                archived        = false,
                order           = maxOrder + 1
            };

            activities.Add(newActivity);
            WriteActivitiesToFile(activities);

            return Json(new { success = true, activity = newActivity });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Update activity
    [HttpPut]
    public IActionResult UpdateActivity([FromBody] ActivityUpdateRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            if (string.IsNullOrEmpty(request.Id))
            {
                return Json(new { success = false, error = "מזהה פעילות נדרש" });
            }

            var activities = ReadActivitiesFromFile();
            
            for (int i = 0; i < activities.Count; i++)
            {
                var json = JsonSerializer.Serialize(activities[i]);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                
                if (obj.GetProperty("id").GetString() == request.Id)
                {
                    var updatedActivity = new
                    {
                        id              = request.Id,
                        name            = request.Name ??
                                        obj.GetProperty("name").GetString(),
                        description     = request.Description ??
                                        (obj.TryGetProperty("description", out var desc)
                                            ? desc.GetString() : ""),
                        activityDate    = request.ActivityDate ??
                                        obj.GetProperty("activityDate").GetString(),
                        activityManager = request.ActivityManager ??
                                        (obj.TryGetProperty("activityManager", out var am)
                                            ? am.GetString() : ""),   // *** חדש ***
                        createdAt       = obj.TryGetProperty("createdAt", out var created)
                                        ? created.GetString()
                                        : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        archived        = request.Archived ??
                                        (obj.TryGetProperty("archived", out var arch)
                                        && arch.GetBoolean()),
                        order           = obj.TryGetProperty("order", out var order)
                                        ? order.GetInt32() : 999999
                    };
                    
                    activities[i] = updatedActivity;
                    WriteActivitiesToFile(activities);
                    
                    return Json(new { success = true, activity = updatedActivity });
                }
            }

            return Json(new { success = false, error = "פעילות לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Delete activity
    [HttpDelete]
    public IActionResult DeleteActivity(string id)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            var activities = ReadActivitiesFromFile();
            var activityToRemove = activities.FirstOrDefault(a =>
            {
                var json = JsonSerializer.Serialize(a);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                return obj.GetProperty("id").GetString() == id;
            });

            if (activityToRemove != null)
            {
                activities.Remove(activityToRemove);
                WriteActivitiesToFile(activities);
                
                // Also delete all tasks for this activity
                DeleteActivityTasks(id);
                
                return Json(new { success = true });
            }

            return Json(new { success = false, error = "פעילות לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Duplicate activity
    [HttpPost]
    public IActionResult DuplicateActivity([FromBody] DuplicateActivityRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            var activities = ReadActivitiesFromFile();
            var activityToDuplicate = activities.FirstOrDefault(a =>
            {
                var json = JsonSerializer.Serialize(a);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                return obj.GetProperty("id").GetString() == request.ActivityId;
            });

            if (activityToDuplicate == null)
            {
                return Json(new { success = false, error = "פעילות לא נמצאה" });
            }

            var duplicateJson = JsonSerializer.Serialize(activityToDuplicate);
            var duplicateObj = JsonSerializer.Deserialize<JsonElement>(duplicateJson);

            int maxOrder = 0;
            foreach (var act in activities)
            {
                var json = JsonSerializer.Serialize(act);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                if (obj.TryGetProperty("order", out var orderProp))
                {
                    int currentOrder = orderProp.GetInt32();
                    if (currentOrder > maxOrder) maxOrder = currentOrder;
                }
            }

            var newActivityId = Guid.NewGuid().ToString();
            var newActivity = new
            {
                id = newActivityId,
                name = duplicateObj.GetProperty("name").GetString() + " (עותק)",
                description = duplicateObj.TryGetProperty("description", out var desc) ? desc.GetString() : "",
                activityDate = duplicateObj.GetProperty("activityDate").GetString(), 
                createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                archived = false,
                order = maxOrder + 1   
            };

            activities.Add(newActivity);
            WriteActivitiesToFile(activities);

            // Duplicate tasks
            DuplicateActivityTasks(request.ActivityId, newActivityId);

            return Json(new { success = true, activity = newActivity });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Get tasks for activity
    [HttpGet]
    public IActionResult GetActivityTasks(string activityId, string date)
    {
        try
        {
            if (!System.IO.File.Exists(_activityTasksFilePath))
            {
                return Json(new List<object>());
            }

            var allTasks = ReadActivityTasksFromFile();
            var activityTasks = allTasks.Where(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                return obj.GetProperty("activityId").GetString() == activityId;
            })
            .OrderBy(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                return obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999;
            })
            .ToList();

            return Json(activityTasks);
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    // Get single task
    [HttpGet]
    public IActionResult GetTask(string taskId, string activityId)
    {
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            var task = allTasks.FirstOrDefault(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                return obj.GetProperty("id").GetString() == taskId && 
                       obj.GetProperty("activityId").GetString() == activityId;
            });

            if (task != null)
            {
                return Json(new { success = true, task = task });
            }

            return Json(new { success = false, error = "משימה לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Add task to activity
    [HttpPost]
    public IActionResult AddTask([FromBody] ActivityTaskRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            if (string.IsNullOrEmpty(request.Title) || string.IsNullOrEmpty(request.ActivityId))
            {
                return Json(new { success = false, error = "כותרת ומזהה פעילות נדרשים" });
            }

            var initialHistory = new List<object>
            {
                new
                {
                    action    = "created",
                    timestamp = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss"),
                    userName  = "מערכת",
                    changes   = new Dictionary<string, object>(),
                    note      = ""
                }
            };

            var newTask = new
            {
                id                   = Guid.NewGuid().ToString(),
                activityId           = request.ActivityId,
                title                = request.Title,
                description          = request.Description          ?? "",
                priority             = request.Priority             ?? "medium",
                taskDate             = request.TaskDate             ?? "",
                taskHour             = request.TaskHour             ?? "",
                taskMinute           = request.TaskMinute           ?? "",
                responsiblePerson    = request.ResponsiblePerson    ?? "",
                secondaryResponsible = request.SecondaryResponsible ?? "",
                status               = request.Status               ?? "חדש",
                notes                = request.Notes                ?? "",
                createdAt            = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                completionDates      = new List<string>(),
                skipReasons          = new Dictionary<string, string>(),
                skipUserNames        = new Dictionary<string, string>(),
                completedByEmployees = new Dictionary<string, string>(),
                completionTimes      = new Dictionary<string, string>(),
                executorNames        = new Dictionary<string, string>(),
                order                = 999999,
                hasAlarm             = request.HasAlarm,
                alertsToCheck        = request.AlertsToCheck        ?? "",
                emailTo              = request.EmailTo              ?? "",
                emailCc              = request.EmailCc              ?? "",
                emailSubject         = request.EmailSubject         ?? "",
                emailBody            = request.EmailBody            ?? "",
                emailSent            = false,
                emailSentAt          = "",
                systemName        = request.SystemName        ?? "",
                environment       = request.Environment       ?? "",
                dependency        = request.Dependency        ?? "",
                disruptionDuration = request.DisruptionDuration ?? "",
                impact            = request.Impact            ?? "",
                history              = initialHistory
            };

            var allTasks = ReadActivityTasksFromFile();
            allTasks.Add(newTask);
            WriteActivityTasksToFile(allTasks);

            return Json(new { success = true, task = newTask });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Update task
    [HttpPut]
    public IActionResult UpdateTask([FromBody] ActivityTaskUpdateRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            if (string.IsNullOrEmpty(request.Id))
            {
                return Json(new { success = false, error = "מזהה משימה נדרש" });
            }

            var allTasks = ReadActivityTasksFromFile();
            
            for (int i = 0; i < allTasks.Count; i++)
            {
                var json = JsonSerializer.Serialize(allTasks[i]);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                
                string taskId = obj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (taskId == request.Id)
                {
                    // Get existing skip data
                    var skipReasons = new Dictionary<string, string>();
                    var skipUserNames = new Dictionary<string, string>();
                    var completedByEmployees = new Dictionary<string, string>();
                    var completionTimes = new Dictionary<string, string>();
                    var executorNames = new Dictionary<string, string>();
                    var notes = new List<object>();
                    
                    if (obj.TryGetProperty("skipReasons", out var srProp))
                    {
                        try
                        {
                            skipReasons = JsonSerializer.Deserialize<Dictionary<string, string>>(srProp.GetRawText());
                        }
                        catch { }
                    }
                    
                    if (obj.TryGetProperty("skipUserNames", out var sunProp))
                    {
                        try
                        {
                            skipUserNames = JsonSerializer.Deserialize<Dictionary<string, string>>(sunProp.GetRawText());
                        }
                        catch { }
                    }
                    
                    if (obj.TryGetProperty("completedByEmployees", out var cbeProp))
                    {
                        try
                        {
                            completedByEmployees = JsonSerializer.Deserialize<Dictionary<string, string>>(cbeProp.GetRawText());
                        }
                        catch { }
                    }
                    
                    if (obj.TryGetProperty("completionTimes", out var ctProp))
                    {
                        try
                        {
                            completionTimes = JsonSerializer.Deserialize<Dictionary<string, string>>(ctProp.GetRawText());
                        }
                        catch { }
                    }
                    
                    if (obj.TryGetProperty("executorNames", out var enProp))
                    {
                        try
                        {
                            executorNames = JsonSerializer.Deserialize<Dictionary<string, string>>(enProp.GetRawText());
                        }
                        catch { }
                    }
                    
                    if (obj.TryGetProperty("notes", out var notesProp))
                    {
                        try
                        {
                            notes = JsonSerializer.Deserialize<List<object>>(notesProp.GetRawText());
                        }
                        catch { }
                    }

                    // Remove skip
                    if (!string.IsNullOrEmpty(request.ClearSkipForDate))
                    {
                        if (skipReasons.ContainsKey(request.ClearSkipForDate))
                        {
                            skipReasons.Remove(request.ClearSkipForDate);
                        }
                        if (skipUserNames.ContainsKey(request.ClearSkipForDate))
                        {
                            skipUserNames.Remove(request.ClearSkipForDate);
                        }
                    }
                    
                    // Add completion info if provided
                    string completionDate = request.Date ?? DateTime.Now.ToString("yyyy-MM-dd");
                    
                    if (!string.IsNullOrEmpty(request.CompletedByEmployee))
                    {
                        completedByEmployees[completionDate] = request.CompletedByEmployee;
                    }
                    
                    if (!string.IsNullOrEmpty(request.CompletionTime))
                    {
                        completionTimes[completionDate] = request.CompletionTime;
                    }
                    
                    if (!string.IsNullOrEmpty(request.ExecutorName))
                    {
                        executorNames[completionDate] = request.ExecutorName;
                    }
                    
                    // Add note if provided
                    if (!string.IsNullOrEmpty(request.NoteText))
                    {
                        var newNote = new
                        {
                            text = request.NoteText,
                            userName = request.NoteUserName ?? "מערכת",
                            date = completionDate,
                            time = request.NoteTime ?? DateTime.Now.ToString("HH:mm")
                        };
                        
                        notes.Add(newNote);
                    }

                    // ── שמור היסטוריה קיימת ──
                    var existingHistory = new List<object>();
                    if (obj.TryGetProperty("history", out var existHistProp) &&
                        existHistProp.ValueKind == JsonValueKind.Array)
                    {
                        try
                        {
                            existingHistory = JsonSerializer.Deserialize<List<object>>(
                                existHistProp.GetRawText()
                            );
                        }
                        catch { }
                    }

                    // ── בנה רשומת שינוי ──
                    var changes = new Dictionary<string, object>();

                    // השווה שדות ובדוק מה השתנה
                    var fieldComparisons = new[]
                    {
                        ("title",               request.Title,               obj.TryGetProperty("title",               out var oldTitle)  ? oldTitle.GetString()  : ""),
                        ("description",         request.Description,         obj.TryGetProperty("description",         out var oldDesc)   ? oldDesc.GetString()   : ""),
                        ("priority",            request.Priority,            obj.TryGetProperty("priority",            out var oldPrio)   ? oldPrio.GetString()   : ""),
                        ("status",              request.Status,              obj.TryGetProperty("status",              out var oldStat)   ? oldStat.GetString()   : ""),
                        ("taskDate",            request.TaskDate,            obj.TryGetProperty("taskDate",            out var oldTd)     ? oldTd.GetString()     : ""),
                        ("taskHour",            request.TaskHour,            obj.TryGetProperty("taskHour",            out var oldTh)     ? oldTh.GetString()     : ""),
                        ("taskMinute",          request.TaskMinute,          obj.TryGetProperty("taskMinute",          out var oldTm)     ? oldTm.GetString()     : ""),
                        ("responsiblePerson",   request.ResponsiblePerson,   obj.TryGetProperty("responsiblePerson",   out var oldRp)     ? oldRp.GetString()     : ""),
                        ("secondaryResponsible",request.SecondaryResponsible,obj.TryGetProperty("secondaryResponsible",out var oldSr)     ? oldSr.GetString()     : ""),
                        ("notes",               request.Notes,               obj.TryGetProperty("notes",               out var oldNt)     ? oldNt.GetString()     : ""),
                    };

                    foreach (var (field, newVal, oldVal) in fieldComparisons)
                    {
                        if (newVal != null && newVal != oldVal)
                        {
                            changes[field] = new { before = oldVal ?? "", after = newVal };
                        }
                    }

                    // הוסף רשומת היסטוריה רק אם יש שינויים
                    if (changes.Count > 0 || !string.IsNullOrEmpty(request.NoteText))
                    {
                        string action = "updated";
                        if (!string.IsNullOrEmpty(request.CompletedByEmployee)) action = "completed";
                        else if (!string.IsNullOrEmpty(request.ClearSkipForDate)) action = "unskipped";

                        var historyEntry = new
                        {
                            action    = action,
                            timestamp = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss"),
                            userName  = request.NoteUserName ?? request.CompletedByEmployee ?? "מערכת",
                            changes   = changes,
                            note      = request.NoteText ?? ""
                        };

                        existingHistory.Add(historyEntry);
                    }

                    // ── עדכן את updatedTask עם history ──
                    var updatedTask = new
                    {
                        id                   = request.Id,
                        activityId           = obj.TryGetProperty("activityId",            out var actId)    ? actId.GetString()    : "",
                        title                = request.Title                ?? (obj.TryGetProperty("title",                out var title)    ? title.GetString()    : ""),
                        description          = request.Description          ?? (obj.TryGetProperty("description",          out var desc)     ? desc.GetString()     : ""),
                        priority             = request.Priority             ?? (obj.TryGetProperty("priority",             out var priority) ? priority.GetString() : "medium"),
                        taskDate             = request.TaskDate             ?? (obj.TryGetProperty("taskDate",             out var td)       ? td.GetString()       : ""),
                        taskHour             = request.TaskHour             ?? (obj.TryGetProperty("taskHour",             out var th)       ? th.GetString()       : ""),
                        taskMinute           = request.TaskMinute           ?? (obj.TryGetProperty("taskMinute",           out var tm)       ? tm.GetString()       : ""),
                        responsiblePerson    = request.ResponsiblePerson    ?? (obj.TryGetProperty("responsiblePerson",    out var rp)       ? rp.GetString()       : ""),
                        secondaryResponsible = request.SecondaryResponsible ?? (obj.TryGetProperty("secondaryResponsible", out var sr)       ? sr.GetString()       : ""),
                        status               = request.Status               ?? (obj.TryGetProperty("status",               out var st)       ? st.GetString()       : "חדש"),
                        notes                = request.Notes                ?? (obj.TryGetProperty("notes",                out var nt)       ? nt.GetString()       : ""),
                        createdAt            = obj.TryGetProperty("createdAt",             out var created)  ? created.GetString()  : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates      = obj.TryGetProperty("completionDates",       out var cd)       ? JsonSerializer.Deserialize<List<string>>(cd.GetRawText())                       : new List<string>(),
                        skipReasons          = skipReasons,
                        skipUserNames        = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes      = completionTimes,
                        executorNames        = executorNames,
                        order                = obj.TryGetProperty("order",                 out var order)    ? order.GetInt32()     : 999999,
                        hasAlarm             = request.HasAlarm,
                        alertsToCheck        = request.AlertsToCheck        ?? (obj.TryGetProperty("alertsToCheck",        out var atc)      ? atc.GetString()      : ""),
                        emailTo      = request.EmailTo      ?? (obj.TryGetProperty("emailTo",      out var et)  ? et.GetString()  : ""),
                        emailCc      = request.EmailCc      ?? (obj.TryGetProperty("emailCc",      out var ec)  ? ec.GetString()  : ""),
                        emailSubject = request.EmailSubject ?? (obj.TryGetProperty("emailSubject", out var es)  ? es.GetString()  : ""),
                        emailBody    = request.EmailBody    ?? (obj.TryGetProperty("emailBody",    out var eb)  ? eb.GetString()  : ""),
                        emailSent    = obj.TryGetProperty("emailSent",  out var ems) && ems.GetBoolean(),
                        emailSentAt  = obj.TryGetProperty("emailSentAt", out var esa) ? esa.GetString() : "",
                        systemName        = request.SystemName        ?? (obj.TryGetProperty("systemName",        out var sn)  ? sn.GetString()  : ""),
                        environment       = request.Environment       ?? (obj.TryGetProperty("environment",       out var env) ? env.GetString() : ""),
                        dependency        = request.Dependency        ?? (obj.TryGetProperty("dependency",        out var dep) ? dep.GetString() : ""),
                        disruptionDuration = request.DisruptionDuration ?? (obj.TryGetProperty("disruptionDuration", out var dd) ? dd.GetString() : ""),
                        impact            = request.Impact            ?? (obj.TryGetProperty("impact",            out var imp) ? imp.GetString() : ""),
                        history      = existingHistory
                    };

                    allTasks[i] = updatedTask;
                    WriteActivityTasksToFile(allTasks);

                    return Json(new { success = true, task = updatedTask });
                }
            }

            return Json(new { success = false, error = "משימה לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetTaskHistory(string taskId, string activityId)
    {
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            var task = allTasks.FirstOrDefault(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj  = JsonSerializer.Deserialize<JsonElement>(json);
                return obj.TryGetProperty("id",         out var id)  &&
                    id.GetString()  == taskId         &&
                    obj.TryGetProperty("activityId",  out var aid) &&
                    aid.GetString() == activityId;
            });

            if (task == null)
                return Json(new { success = false, error = "משימה לא נמצאה" });

            var json2 = JsonSerializer.Serialize(task);
            var obj2  = JsonSerializer.Deserialize<JsonElement>(json2);

            List<object> history = new List<object>();
            if (obj2.TryGetProperty("history", out var histProp) &&
                histProp.ValueKind == JsonValueKind.Array)
            {
                history = JsonSerializer.Deserialize<List<object>>(
                    histProp.GetRawText()
                );
            }

            return Json(new { success = true, history = history });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Toggle task completion
    [HttpPut]
    public async Task<IActionResult> ToggleTask([FromBody] ToggleTaskRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            
            for (int i = 0; i < allTasks.Count; i++)
            {
                var json = JsonSerializer.Serialize(allTasks[i]);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                
                string taskId = obj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (taskId == request.TaskId)
                {
                    var completionDates = new List<string>();
                    var skipReasons = new Dictionary<string, string>();
                    var skipUserNames = new Dictionary<string, string>();
                    var completedByEmployees = new Dictionary<string, string>();
                    var completionTimes = new Dictionary<string, string>();
                    var executorNames = new Dictionary<string, string>();

                    // Get existing data
                    if (obj.TryGetProperty("completionDates", out var cdProp))
                    {
                        try
                        {
                            completionDates = JsonSerializer.Deserialize<List<string>>(cdProp.GetRawText());
                        }
                        catch
                        {
                            completionDates = new List<string>();
                        }
                    }

                    if (obj.TryGetProperty("skipReasons", out var srProp))
                    {
                        try
                        {
                            skipReasons = JsonSerializer.Deserialize<Dictionary<string, string>>(srProp.GetRawText());
                        }
                        catch
                        {
                            skipReasons = new Dictionary<string, string>();
                        }
                    }

                    if (obj.TryGetProperty("skipUserNames", out var sunProp))
                    {
                        try
                        {
                            skipUserNames = JsonSerializer.Deserialize<Dictionary<string, string>>(sunProp.GetRawText());
                        }
                        catch
                        {
                            skipUserNames = new Dictionary<string, string>();
                        }
                    }
                    
                    if (obj.TryGetProperty("completedByEmployees", out var cbeProp))
                    {
                        try
                        {
                            completedByEmployees = JsonSerializer.Deserialize<Dictionary<string, string>>(cbeProp.GetRawText());
                        }
                        catch
                        {
                            completedByEmployees = new Dictionary<string, string>();
                        }
                    }
                    
                    if (obj.TryGetProperty("completionTimes", out var ctProp))
                    {
                        try
                        {
                            completionTimes = JsonSerializer.Deserialize<Dictionary<string, string>>(ctProp.GetRawText());
                        }
                        catch
                        {
                            completionTimes = new Dictionary<string, string>();
                        }
                    }
                    
                    if (obj.TryGetProperty("executorNames", out var enProp))
                    {
                        try
                        {
                            executorNames = JsonSerializer.Deserialize<Dictionary<string, string>>(enProp.GetRawText());
                        }
                        catch
                        {
                            executorNames = new Dictionary<string, string>();
                        }
                    }

                    bool isCompleted = completionDates.Contains(request.Date);

                    if (isCompleted)
                    {
                        completionDates.Remove(request.Date);
                        
                        // Also remove completion metadata
                        if (completedByEmployees.ContainsKey(request.Date))
                        {
                            completedByEmployees.Remove(request.Date);
                        }
                        
                        if (completionTimes.ContainsKey(request.Date))
                        {
                            completionTimes.Remove(request.Date);
                        }
                        
                        if (executorNames.ContainsKey(request.Date))
                        {
                            executorNames.Remove(request.Date);
                        }
                    }
                    else
                    {
                        completionDates.Add(request.Date);
                        
                        // Add completion metadata if provided
                        if (!string.IsNullOrEmpty(request.CompletedByEmployee))
                        {
                            completedByEmployees[request.Date] = request.CompletedByEmployee;
                        }
                        
                        if (!string.IsNullOrEmpty(request.CompletionTime))
                        {
                            completionTimes[request.Date] = request.CompletionTime;
                        }
                        
                        if (!string.IsNullOrEmpty(request.ExecutorName))
                        {
                            executorNames[request.Date] = request.ExecutorName;
                        }
                        
                        // Remove skip reason if exists
                        if (skipReasons.ContainsKey(request.Date))
                        {
                            skipReasons.Remove(request.Date);
                        }
                        if (skipUserNames.ContainsKey(request.Date))
                        {
                            skipUserNames.Remove(request.Date);
                        }
                    }

                    // ── שמור היסטוריה קיימת ──
                    var toggleHistory = new List<object>();
                    if (obj.TryGetProperty("history", out var toggleHistProp) &&
                        toggleHistProp.ValueKind == JsonValueKind.Array)
                    {
                        try
                        {
                            toggleHistory = JsonSerializer.Deserialize<List<object>>(
                                toggleHistProp.GetRawText()
                            );
                        }
                        catch { }
                    }

                    // ── הוסף רשומת toggle ──
                    var toggleEntry = new
                    {
                        action    = isCompleted ? "uncompleted" : "completed",
                        timestamp = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss"),
                        userName  = request.CompletedByEmployee ?? "מערכת",
                        changes   = new Dictionary<string, object>(),
                        note      = isCompleted
                                        ? "ביצוע בוטל"
                                        : $"בוצע על ידי: {request.CompletedByEmployee ?? "לא ידוע"}"
                    };

                    toggleHistory.Add(toggleEntry);

                    var updatedTask = new
                    {
                        id                   = taskId,
                        activityId           = obj.TryGetProperty("activityId",            out var actId)   ? actId.GetString()   : "",
                        title                = obj.TryGetProperty("title",                 out var title)   ? title.GetString()   : "",
                        description          = obj.TryGetProperty("description",           out var desc)    ? desc.GetString()    : "",
                        priority             = obj.TryGetProperty("priority",              out var priority)? priority.GetString(): "medium",
                        taskDate             = obj.TryGetProperty("taskDate",              out var td)      ? td.GetString()      : "",
                        taskHour             = obj.TryGetProperty("taskHour",              out var th)      ? th.GetString()      : "",
                        taskMinute           = obj.TryGetProperty("taskMinute",            out var tm)      ? tm.GetString()      : "",
                        responsiblePerson    = obj.TryGetProperty("responsiblePerson",     out var rp)      ? rp.GetString()      : "",
                        secondaryResponsible = obj.TryGetProperty("secondaryResponsible",  out var sr)      ? sr.GetString()      : "",
                        status               = obj.TryGetProperty("status",                out var st)      ? st.GetString()      : "חדש",
                        notes                = obj.TryGetProperty("notes",                 out var nt)      ? nt.GetString()      : "",
                        createdAt            = obj.TryGetProperty("createdAt",             out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates      = completionDates,
                        skipReasons          = skipReasons,
                        skipUserNames        = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes      = completionTimes,
                        executorNames        = executorNames,
                        order                = obj.TryGetProperty("order",                 out var order)   ? order.GetInt32()    : 999999,
                        hasAlarm             = obj.TryGetProperty("hasAlarm",              out var ha)      && ha.GetBoolean(),
                        activityManager      = obj.TryGetProperty("activityManager",  out var amTog)  ? amTog.GetString()  : "",
                        alertsToCheck        = obj.TryGetProperty("alertsToCheck",    out var atcTog) ? atcTog.GetString() : "",
                        emailTo      = obj.TryGetProperty("emailTo", out var et) ? et.GetString() : "",
                        emailCc      = obj.TryGetProperty("emailCc", out var ec) ? ec.GetString() : "",
                        emailSubject = obj.TryGetProperty("emailSubject", out var es) ? es.GetString() : "",
                        emailBody    = obj.TryGetProperty("emailBody", out var eb) ? eb.GetString() : "",
                        emailSent    = obj.TryGetProperty("emailSent", out var ems) && ems.GetBoolean(),
                        emailSentAt  = obj.TryGetProperty("emailSentAt", out var esa) ? esa.GetString() : "",
                        systemName        = obj.TryGetProperty("systemName",         out var sn)  ? sn.GetString()  : "",
                        environment       = obj.TryGetProperty("environment",        out var env) ? env.GetString() : "",
                        dependency        = obj.TryGetProperty("dependency",         out var dep) ? dep.GetString() : "",
                        disruptionDuration = obj.TryGetProperty("disruptionDuration", out var dd)  ? dd.GetString()  : "",
                        impact            = obj.TryGetProperty("impact",             out var imp) ? imp.GetString() : "",
                        history              = toggleHistory   // ← חדש
                    };

                    allTasks[i] = updatedTask;
                    WriteActivityTasksToFile(allTasks);

                    // *** חדש: שלח מייל אם המשימה הושלמה ויש הגדרת מייל ***
                    bool emailWasSent = false;
                    string emailSentAt = updatedTask.emailSentAt ?? "";

                    if (!isCompleted) // המשימה הושלמה עכשיו (הפוך מ-isCompleted)
                    {
                        string taskEmailTo = obj.TryGetProperty("emailTo", out var emailToProp) 
                            ? emailToProp.GetString() : "";
                        string taskEmailCc = obj.TryGetProperty("emailCc", out var emailCcProp) 
                            ? emailCcProp.GetString() : "";
                        string taskEmailSubject = obj.TryGetProperty("emailSubject", out var emailSubjProp) 
                            ? emailSubjProp.GetString() : "";
                        string taskEmailBody = obj.TryGetProperty("emailBody", out var emailBodyProp) 
                            ? emailBodyProp.GetString() : "";

                        if (!string.IsNullOrEmpty(taskEmailTo) && _emailService != null)
                        {
                            try
                            {
                                // בנה גוף HTML מהתבנית
                                var completedBy = request.CompletedByEmployee ?? "לא ידוע";
                                var completionTime = request.CompletionTime ?? DateTime.Now.ToString("HH:mm");
                                var taskTitle = obj.TryGetProperty("title", out var titleProp) 
                                    ? titleProp.GetString() : "";

                                // החלף placeholders בגוף המייל
                                var finalBody = taskEmailBody
                                    .Replace("{task}", taskTitle ?? "")
                                    .Replace("{completedBy}", completedBy)
                                    .Replace("{time}", completionTime)
                                    .Replace("{date}", request.Date ?? DateTime.Now.ToString("yyyy-MM-dd"));

                                var finalSubject = taskEmailSubject
                                    .Replace("{task}", taskTitle ?? "")
                                    .Replace("{completedBy}", completedBy);

                                // שלח את המייל הראשי
                                var (success, msg) = await _emailService.SendTaskCompletionEmailAsync(
                                    toEmail:   taskEmailTo,
                                    ccEmail:   taskEmailCc,
                                    subject:   finalSubject,
                                    body:      finalBody,
                                    taskTitle: taskTitle ?? "",
                                    completedBy: completedBy,
                                    completionTime: completionTime
                                );

                                if (success)
                                {
                                    emailWasSent = true;
                                    emailSentAt  = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                                    System.Diagnostics.Debug.WriteLine(
                                        $"[Email] נשלח מייל ביצוע משימה: {taskTitle} → {taskEmailTo}");
                                }
                            }
                            catch (Exception emailEx)
                            {
                                System.Diagnostics.Debug.WriteLine(
                                    $"[Email] שגיאה בשליחת מייל ביצוע: {emailEx.Message}");
                            }
                        }
                    }

                    // עדכן את updatedTask עם מצב המייל
                    var finalUpdatedTask = new
                    {
                        id                   = updatedTask.id,
                        activityId           = updatedTask.activityId,
                        title                = updatedTask.title,
                        description          = updatedTask.description,
                        priority             = updatedTask.priority,
                        taskDate             = updatedTask.taskDate,
                        taskHour             = updatedTask.taskHour,
                        taskMinute           = updatedTask.taskMinute,
                        responsiblePerson    = updatedTask.responsiblePerson,
                        secondaryResponsible = updatedTask.secondaryResponsible,
                        status               = updatedTask.status,
                        notes                = updatedTask.notes,
                        createdAt            = updatedTask.createdAt,
                        completionDates      = updatedTask.completionDates,
                        skipReasons          = updatedTask.skipReasons,
                        skipUserNames        = updatedTask.skipUserNames,
                        completedByEmployees = updatedTask.completedByEmployees,
                        completionTimes      = updatedTask.completionTimes,
                        executorNames        = updatedTask.executorNames,
                        order                = updatedTask.order,
                        hasAlarm             = updatedTask.hasAlarm,
                        activityManager      = updatedTask.activityManager,
                        alertsToCheck        = updatedTask.alertsToCheck,
                        emailTo              = obj.TryGetProperty("emailTo",      out var et2) ? et2.GetString() : "",
                        emailCc              = obj.TryGetProperty("emailCc",      out var ec2) ? ec2.GetString() : "",
                        emailSubject         = obj.TryGetProperty("emailSubject", out var es2) ? es2.GetString() : "",
                        emailBody            = obj.TryGetProperty("emailBody",    out var eb2) ? eb2.GetString() : "",
                        emailSent            = emailWasSent
                                                ? true
                                                : (obj.TryGetProperty("emailSent", out var ems2) && ems2.GetBoolean()),
                        emailSentAt          = emailWasSent
                                                ? emailSentAt
                                                : (obj.TryGetProperty("emailSentAt", out var esa2) ? esa2.GetString() : ""),
                        history              = updatedTask.history
                    };

                    allTasks[i] = finalUpdatedTask;
                    WriteActivityTasksToFile(allTasks);
                    return Json(new { success = true, completed = !isCompleted, emailSent = emailWasSent });
                }
            }

            return Json(new { success = false, error = "משימה לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Skip task
    [HttpPut]
    public IActionResult SkipTask([FromBody] SkipTaskRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            
            for (int i = 0; i < allTasks.Count; i++)
            {
                var json = JsonSerializer.Serialize(allTasks[i]);
                var obj = JsonSerializer.Deserialize<JsonElement>(json); 
                
                string taskId = obj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (taskId == request.TaskId)
                {
                    var completionDates = new List<string>();
                    var skipReasons = new Dictionary<string, string>();
                    var skipUserNames = new Dictionary<string, string>();

                    // Get existing data for completion metadata
                    var completedByEmployees = new Dictionary<string, string>();
                    var completionTimes = new Dictionary<string, string>();
                    var executorNames = new Dictionary<string, string>();

                    if (obj.TryGetProperty("completedByEmployees", out var cbeProp))
                    {
                        try
                        {
                            completedByEmployees = JsonSerializer.Deserialize<Dictionary<string, string>>(cbeProp.GetRawText());
                        }
                        catch { }
                    }

                    if (obj.TryGetProperty("completionTimes", out var ctProp))
                    {
                        try
                        {
                            completionTimes = JsonSerializer.Deserialize<Dictionary<string, string>>(ctProp.GetRawText());
                        }
                        catch { }
                    }

                    if (obj.TryGetProperty("executorNames", out var enProp))
                    {
                        try
                        {
                            executorNames = JsonSerializer.Deserialize<Dictionary<string, string>>(enProp.GetRawText());
                        }
                        catch { }
                    }

                    // Get existing data
                    if (obj.TryGetProperty("completionDates", out var cdProp))
                    {
                        try
                        {
                            completionDates = JsonSerializer.Deserialize<List<string>>(cdProp.GetRawText());
                        }
                        catch { }
                    }

                    if (obj.TryGetProperty("skipReasons", out var srProp))
                    {
                        try
                        {
                            skipReasons = JsonSerializer.Deserialize<Dictionary<string, string>>(srProp.GetRawText());
                        }
                        catch { }
                    }

                    if (obj.TryGetProperty("skipUserNames", out var sunProp))
                    {
                        try
                        {
                            skipUserNames = JsonSerializer.Deserialize<Dictionary<string, string>>(sunProp.GetRawText());
                        }
                        catch { }
                    }

                    // Remove from completion dates if exists
                    completionDates.Remove(request.Date);
                    
                    // Add skip reason
                    skipReasons[request.Date] = request.SkipReason;
                    skipUserNames[request.Date] = request.SkipUserName;

                    // ── שמור היסטוריה קיימת ──
                    var skipHistory = new List<object>();
                    if (obj.TryGetProperty("history", out var skipHistProp) &&
                        skipHistProp.ValueKind == JsonValueKind.Array)
                    {
                        try
                        {
                            skipHistory = JsonSerializer.Deserialize<List<object>>(
                                skipHistProp.GetRawText()
                            );
                        }
                        catch { }
                    }

                    // ── הוסף רשומת skip ──
                    skipHistory.Add(new
                    {
                        action    = "skipped",
                        timestamp = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss"),
                        userName  = request.SkipUserName ?? "מערכת",
                        changes   = new Dictionary<string, object>(),
                        note      = request.SkipReason ?? ""
                    });

                    var updatedTask = new
                    {
                        id                   = taskId,
                        activityId           = obj.TryGetProperty("activityId",            out var actId)   ? actId.GetString()   : "",
                        title                = obj.TryGetProperty("title",                 out var title)   ? title.GetString()   : "",
                        description          = obj.TryGetProperty("description",           out var desc)    ? desc.GetString()    : "",
                        priority             = obj.TryGetProperty("priority",              out var priority)? priority.GetString(): "medium",
                        taskDate             = obj.TryGetProperty("taskDate",              out var td)      ? td.GetString()      : "",
                        taskHour             = obj.TryGetProperty("taskHour",              out var th)      ? th.GetString()      : "",
                        taskMinute           = obj.TryGetProperty("taskMinute",            out var tm)      ? tm.GetString()      : "",
                        responsiblePerson    = obj.TryGetProperty("responsiblePerson",     out var rp)      ? rp.GetString()      : "",
                        secondaryResponsible = obj.TryGetProperty("secondaryResponsible",  out var sr)      ? sr.GetString()      : "",
                        status               = obj.TryGetProperty("status",                out var st)      ? st.GetString()      : "חדש",
                        notes                = obj.TryGetProperty("notes",                 out var nt)      ? nt.GetString()      : "",
                        createdAt            = obj.TryGetProperty("createdAt",             out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates      = completionDates,
                        skipReasons          = skipReasons,
                        skipUserNames        = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes      = completionTimes,
                        executorNames        = executorNames,
                        order                = obj.TryGetProperty("order",                 out var order)   ? order.GetInt32()    : 999999,
                        activityManager      = obj.TryGetProperty("activityManager",  out var amSkip)  ? amSkip.GetString()  : "",
                        alertsToCheck        = obj.TryGetProperty("alertsToCheck",    out var atcSkip) ? atcSkip.GetString() : "",
                        hasAlarm             = obj.TryGetProperty("hasAlarm",              out var ha)      && ha.GetBoolean(),
                        systemName        = obj.TryGetProperty("systemName",         out var sn)  ? sn.GetString()  : "",
                        environment       = obj.TryGetProperty("environment",        out var env) ? env.GetString() : "",
                        dependency        = obj.TryGetProperty("dependency",         out var dep) ? dep.GetString() : "",
                        disruptionDuration = obj.TryGetProperty("disruptionDuration", out var dd)  ? dd.GetString()  : "",
                        impact            = obj.TryGetProperty("impact",             out var imp) ? imp.GetString() : "",
                        history              = skipHistory   // ← חדש
                    };
                    allTasks[i] = updatedTask;
                    WriteActivityTasksToFile(allTasks);
                    
                    return Json(new { success = true });
                }
            }

            return Json(new { success = false, error = "משימה לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Delete task
    [HttpDelete]
    public IActionResult DeleteTask(string taskId, string activityId)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            var taskToRemove = allTasks.FirstOrDefault(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj = JsonSerializer.Deserialize<JsonElement>(json); 
                
                string tId = obj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                string aId = obj.TryGetProperty("activityId", out var actIdProp) ? actIdProp.GetString() : null;
                
                return tId == taskId && aId == activityId;
            });

            if (taskToRemove != null)
            {
                allTasks.Remove(taskToRemove);
                WriteActivityTasksToFile(allTasks);
                return Json(new { success = true });
            }

            return Json(new { success = false, error = "משימה לא נמצאה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPut]
    public IActionResult UpdateActivityOrder([FromBody] ActivityOrderRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            if (!System.IO.File.Exists(_activitiesFilePath))
            {
                return Json(new { success = false, error = "קובץ פעילויות לא נמצא" });
            }

            var activities = ReadActivitiesFromFile();

            // Update order for each activity
            foreach (var orderItem in request.Activities)
            {
                for (int i = 0; i < activities.Count; i++)
                {
                    var json = JsonSerializer.Serialize(activities[i]);
                    var obj = JsonSerializer.Deserialize<JsonElement>(json);
                    
                    if (obj.GetProperty("id").GetString() == orderItem.Id)
                    {
                        var updatedActivity = new
                        {
                            id              = obj.GetProperty("id").GetString(),
                            name            = obj.GetProperty("name").GetString(),
                            description     = obj.TryGetProperty("description",     out var desc) ? desc.GetString() : "",
                            activityDate    = obj.GetProperty("activityDate").GetString(),
                            activityManager = obj.TryGetProperty("activityManager", out var am)   ? am.GetString()   : "", 
                            createdAt       = obj.TryGetProperty("createdAt",       out var cr)   ? cr.GetString()   : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                            archived        = obj.TryGetProperty("archived",        out var arch) && arch.GetBoolean(),
                            order           = orderItem.Order
                        };
                        
                        activities[i] = updatedActivity;
                        break;
                    }
                }
            }

            WriteActivitiesToFile(activities);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPut]
    public IActionResult UpdateTaskOrder([FromBody] ActivityTaskOrderRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            if (!System.IO.File.Exists(_activityTasksFilePath))
            {
                return Json(new { success = false, error = "קובץ משימות לא נמצא" });
            }

            var allTasks = ReadActivityTasksFromFile();

            // Update order for each task in this activity
            foreach (var orderItem in request.Tasks)
            {
                for (int i = 0; i < allTasks.Count; i++)
                {
                    var json = JsonSerializer.Serialize(allTasks[i]);
                    var obj = JsonSerializer.Deserialize<JsonElement>(json);
                    
                    string taskId = obj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                    string activityId = obj.TryGetProperty("activityId", out var actIdProp) ? actIdProp.GetString() : null;
                    
                    if (taskId == orderItem.Id && activityId == request.ActivityId)
                    {
                        var updatedTask = new
                        {
                            id = taskId,
                            activityId = activityId,
                            title = obj.TryGetProperty("title", out var title) ? title.GetString() : "",
                            description = obj.TryGetProperty("description", out var desc) ? desc.GetString() : "",
                            priority = obj.TryGetProperty("priority", out var priority) ? priority.GetString() : "medium",
                            taskDate = obj.TryGetProperty("taskDate", out var td) ? td.GetString() : "",
                            taskHour = obj.TryGetProperty("taskHour", out var th) ? th.GetString() : "",
                            taskMinute = obj.TryGetProperty("taskMinute", out var tm) ? tm.GetString() : "",
                            responsiblePerson = obj.TryGetProperty("responsiblePerson", out var rp) ? rp.GetString() : "",
                            secondaryResponsible = obj.TryGetProperty("secondaryResponsible", out var sr) ? sr.GetString() : "",
                            status = obj.TryGetProperty("status", out var st) ? st.GetString() : "חדש",
                            notes = obj.TryGetProperty("notes", out var nt) ? nt.GetString() : "",
                            createdAt = obj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                            completionDates = obj.TryGetProperty("completionDates", out var cd) ? JsonSerializer.Deserialize<List<string>>(cd.GetRawText()) : new List<string>(),
                            skipReasons = obj.TryGetProperty("skipReasons", out var srr) ? JsonSerializer.Deserialize<Dictionary<string, string>>(srr.GetRawText()) : new Dictionary<string, string>(),
                            skipUserNames = obj.TryGetProperty("skipUserNames", out var sun) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sun.GetRawText()) : new Dictionary<string, string>(),
                            completedByEmployees = obj.TryGetProperty("completedByEmployees", out var cbe) ? JsonSerializer.Deserialize<Dictionary<string, string>>(cbe.GetRawText()) : new Dictionary<string, string>(),
                            completionTimes = obj.TryGetProperty("completionTimes", out var ct) ? JsonSerializer.Deserialize<Dictionary<string, string>>(ct.GetRawText()) : new Dictionary<string, string>(),
                            executorNames = obj.TryGetProperty("executorNames", out var en) ? JsonSerializer.Deserialize<Dictionary<string, string>>(en.GetRawText()) : new Dictionary<string, string>(),
                            hasAlarm = obj.TryGetProperty("hasAlarm", out var ha) && ha.GetBoolean(), // ✅ חיוני!
                            history = obj.TryGetProperty("history", out var hist) ? JsonSerializer.Deserialize<List<object>>(hist.GetRawText()) : new List<object>(),
                            activityManager      = obj.TryGetProperty("activityManager",  out var amOrd)  ? amOrd.GetString()  : "",
                            systemName        = obj.TryGetProperty("systemName",         out var sn)  ? sn.GetString()  : "",
                            environment       = obj.TryGetProperty("environment",        out var env) ? env.GetString() : "",
                            dependency        = obj.TryGetProperty("dependency",         out var dep) ? dep.GetString() : "",
                            disruptionDuration = obj.TryGetProperty("disruptionDuration", out var dd)  ? dd.GetString()  : "",
                            impact            = obj.TryGetProperty("impact",             out var imp) ? imp.GetString() : "",
                            alertsToCheck        = obj.TryGetProperty("alertsToCheck",    out var atcOrd) ? atcOrd.GetString() : "",
                            order = orderItem.Order
                        };
                        
                        allTasks[i] = updatedTask;
                        break;
                    }
                }
            }

            WriteActivityTasksToFile(allTasks);
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> ImportFromExcel(IFormFile excelFile)
    {
        // *** חדש: קריאת מנהל הפעילות מהכותרת ***
        // מחפש בשורות 1-3 תא שמכיל "מנהל" ולוקח את הערך שלידו
        string activityManagerFromHeader = "";
        if (!IsUserAuthenticated()) return RequireAuth(); 
        if (excelFile == null || excelFile.Length == 0)
        {
            return Json(new { 
                success = false, 
                error = "לא נבחר קובץ" 
            });
        }

        if (!excelFile.FileName.EndsWith(".xlsx") && !excelFile.FileName.EndsWith(".xls"))
        {
            return Json(new { 
                success = false, 
                error = "הקובץ אינו בפורמט אקסל" 
            });
        }

        string tempFilePath = null;
        string activityId = Guid.NewGuid().ToString();
        string importedActivityName = Path.GetFileNameWithoutExtension(excelFile.FileName);
        if (string.IsNullOrWhiteSpace(importedActivityName))
            importedActivityName = $"פעילות {DateTime.Now:yyyy-MM-dd HH:mm}";
        try
        {
            tempFilePath = Path.Combine(
                Path.GetTempPath(), 
                Guid.NewGuid().ToString() + Path.GetExtension(excelFile.FileName)
            );
            
            using (var fileStream = new FileStream(tempFilePath, FileMode.Create))
            {
                await excelFile.CopyToAsync(fileStream);
            }

            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
            {
                var workbook  = helper.OpenWorkbook(tempFilePath);
                var worksheet = helper.GetWorksheet(1);

                // ── קריאת שם הפעילות מתא D1 ──────────────────────────────────
                string activityNameFromExcel = 
                    worksheet.Cells[1, 4].Value?.ToString();
                if (!string.IsNullOrEmpty(activityNameFromExcel) && activityNameFromExcel.Length > 8)
                    importedActivityName = activityNameFromExcel;

                for (int searchRow = 1; searchRow <= 3; searchRow++)
                {
                    for (int searchCol = 1; searchCol <= 10; searchCol++)
                    {
                        string cellVal = worksheet.Cells[searchRow, searchCol]
                                                .Value?.ToString()?.Trim() ?? "";

                        // בדוק אם התא מכיל מילת "מנהל" - הערך בתא הבא
                        if (cellVal.IndexOf("מנהל", StringComparison.OrdinalIgnoreCase) >= 0 ||
                            cellVal.IndexOf("manager", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            // נסה לקרוא מהתא הסמוך (ימין או שמאל)
                            string nextVal = worksheet.Cells[searchRow, searchCol + 1]
                                                    .Value?.ToString()?.Trim() ?? "";
                            string prevVal = searchCol > 1
                                ? worksheet.Cells[searchRow, searchCol - 1]
                                            .Value?.ToString()?.Trim() ?? ""
                                : "";

                            if (!string.IsNullOrEmpty(nextVal))
                            {
                                activityManagerFromHeader = nextVal;
                                break;
                            }
                            else if (!string.IsNullOrEmpty(prevVal))
                            {
                                activityManagerFromHeader = prevVal;
                                break;
                            }
                        }

                        // או - אם התא עצמו מכיל "מנהל: שם" בפורמט
                        if (cellVal.Contains(":"))
                        {
                            var parts = cellVal.Split(':', 2);
                            if (parts[0].IndexOf("מנהל", 
                                    StringComparison.OrdinalIgnoreCase) >= 0 &&
                                !string.IsNullOrEmpty(parts[1].Trim()))
                            {
                                activityManagerFromHeader = parts[1].Trim();
                                break;
                            }
                        }
                    }
                    if (!string.IsNullOrEmpty(activityManagerFromHeader)) break;
                }

                // ── קריאת תאריך הפעילות ───────────────────────────────────────
                string activityDate = Request.Form["activityDate"];
                if (string.IsNullOrEmpty(activityDate))
                {
                    activityDate = DateTime.Now.ToString("yyyy-MM-dd");
                }

                // ══════════════════════════════════════════════════════════════
                // זיהוי דינמי של שורת הכותרות (בין שורות 1-5)
                // ══════════════════════════════════════════════════════════════
                int headerRow   = -1;   // שורת הכותרות שנמצאה
                int dataStartRow = -1;  // שורת הנתונים הראשונה

                // מילות מפתח שמזהות עמודות כותרת
                var headerKeywords = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                {
                    // עברית
                    "כותרת", "משימה", "תיאור", "שעה", "תאריך", "אחראי",
                    "סטטוס", "הערות", "יום", "עדיפות",
                    // אנגלית
                    "title", "task", "description", "time", "date",
                    "responsible", "status", "notes", "day", "priority"
                };

                for (int row = 1; row <= 5; row++)
                {
                    int matchCount = 0;

                    // בדוק את 10 העמודות הראשונות בחיפוש אחר כותרות
                    for (int col = 1; col <= 10; col++)
                    {
                        string cellValue = worksheet.Cells[row, col].Value?.ToString()?.Trim() ?? "";
                        if (string.IsNullOrEmpty(cellValue)) continue;

                        // בדוק אם הערך מכיל מילת מפתח של כותרת
                        foreach (var keyword in headerKeywords)
                        {
                            if (cellValue.IndexOf(keyword, 
                                    StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                matchCount++;
                                break; // מספיק התאמה אחת לעמודה
                            }
                        }
                    }

                    // אם נמצאו לפחות 2 כותרות בשורה - זו שורת הכותרות
                    if (matchCount >= 2)
                    {
                        headerRow    = row;
                        dataStartRow = row + 1;
                        System.Diagnostics.Debug.WriteLine(
                            $"Header row detected at row {headerRow} " +
                            $"with {matchCount} matching columns");
                        break;
                    }
                }

                // אם לא נמצאה שורת כותרות - השתמש בברירת מחדל (שורה 4 כותרות, שורה 5 נתונים)
                if (headerRow == -1)
                {
                    headerRow    = 4;
                    dataStartRow = 5;
                    System.Diagnostics.Debug.WriteLine(
                        "Header row not detected, using default: row 4");
                }

                // ══════════════════════════════════════════════════════════════
                // מיפוי עמודות לפי כותרות שנמצאו
                // ══════════════════════════════════════════════════════════════
                var columnMap = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

                // מיפוי שמות עמודות לשמות שדות פנימיים
                // סרוק את שורת הכותרות ובנה את המיפוי
                // הסדר חשוב: "אחראי משנה" חייב להיבדק לפני "אחראי"
                for (int col = 1; col <= 20; col++)
                {
                    string header = worksheet.Cells[headerRow, col]
                                            .Value?.ToString()?.Trim() ?? "";
                    if (string.IsNullOrEmpty(header)) continue;

                    string fieldName = null;

                    // ── בדיקות עברית (סדר חשוב - ספציפי לפני כללי) ──────────────
                    if (header.IndexOf("אחראי משנה", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "secondaryResponsible";
                    else if (header.IndexOf("secondary",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "secondaryResponsible";
                    else if (header.IndexOf("אחראי",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("responsible", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("כותרת",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("משימה",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("title",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("task",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("תאריך",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "date";
                    else if (header.IndexOf("date",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "date";
                    else if (header.IndexOf("שעה",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "time";
                    else if (header.IndexOf("time",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "time";
                    else if (header.IndexOf("יום",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "day";
                    else if (header.IndexOf("day",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "day";
                    else if (header.IndexOf("סטטוס",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "status";
                    else if (header.IndexOf("status",      StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "status";
                    else if (header.IndexOf("הערות",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "notes";
                    else if (header.IndexOf("notes",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "notes";
                    else if (header.IndexOf("עדיפות",      StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "priority";
                    else if (header.IndexOf("priority",    StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "priority";
                    else if (header.IndexOf("תיאור",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "description";
                    else if (header.IndexOf("description", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "description";
                    else if (header.IndexOf("התראות",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("התראה",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("alerts",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("alert",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("מייל",        StringComparison.OrdinalIgnoreCase) >= 0 &&
                            header.IndexOf("נמען",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailTo";
                    else if (header.IndexOf("emailto",     StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailTo";
                    else if (header.IndexOf("cc",          StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailCc";
                    else if (header.IndexOf("נושא מייל",  StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailSubject";
                    else if (header.IndexOf("emailsubject",StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailSubject";
                    else if (header.IndexOf("גוף מייל",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailBody";
                    else if (header.IndexOf("emailbody",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "emailBody";
                    else if (header.IndexOf("מערכת",   StringComparison.OrdinalIgnoreCase) >= 0 &&
                            header.IndexOf("שם",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "system";
                    else if (header.IndexOf("מערכת", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "system";
                    else if (header.IndexOf("system", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "system";
                    else if (header.IndexOf("סביבה",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "environment";
                    else if (header.IndexOf("environment", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "environment";
                    else if (header.IndexOf("תלות",    StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "dependency";
                    else if (header.IndexOf("dependency", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "dependency";
                    else if (header.IndexOf("משך",     StringComparison.OrdinalIgnoreCase) >= 0 &&
                            header.IndexOf("שיבוש",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "disruptionDuration";
                    else if (header.IndexOf("duration", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "disruptionDuration";
                    else if (header.IndexOf("השפעה",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "impact";
                    else if (header.IndexOf("impact",  StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "impact";
                    // שמור רק את ההתאמה הראשונה לכל שדה
                    if (fieldName != null && !columnMap.ContainsKey(fieldName))
                    {
                        columnMap[fieldName] = col;
                    }
                }

                System.Diagnostics.Debug.WriteLine(
                    $"Column map: {string.Join(", ", columnMap.Select(kv => $"{kv.Key}={kv.Value}"))}");

                // סרוק את שורת הכותרות ובנה את המיפוי
                // סרוק את שורת הכותרות ובנה את המיפוי
                // הסדר חשוב: "אחראי משנה" חייב להיבדק לפני "אחראי"
                for (int col = 1; col <= 20; col++)
                {
                    string header = worksheet.Cells[headerRow, col]
                                            .Value?.ToString()?.Trim() ?? "";
                    if (string.IsNullOrEmpty(header)) continue;

                    string fieldName = null;

                    if (header.IndexOf("אחראי משנה", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "secondaryResponsible";
                    else if (header.IndexOf("secondary",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "secondaryResponsible";
                    else if (header.IndexOf("אחראי", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("אחריות", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("responsible", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("responsible", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("כותרת",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("משימה",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("title",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("task",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("תאריך",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "date";
                    else if (header.IndexOf("date",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "date";
                    else if (header.IndexOf("שעה",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "time";
                    else if (header.IndexOf("time",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "time";
                    else if (header.IndexOf("יום",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "day";
                    else if (header.IndexOf("day",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "day";
                    else if (header.IndexOf("סטטוס",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "status";
                    else if (header.IndexOf("status",      StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "status";
                    else if (header.IndexOf("הערות",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "notes";
                    else if (header.IndexOf("notes",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "notes";
                    else if (header.IndexOf("עדיפות",      StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "priority";
                    else if (header.IndexOf("priority",    StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "priority";
                    else if (header.IndexOf("תיאור",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "description";
                    else if (header.IndexOf("description", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "description";

                    if (fieldName != null && !columnMap.ContainsKey(fieldName))
                    {
                        columnMap[fieldName] = col;
                    }
                }

                System.Diagnostics.Debug.WriteLine(
                    $"Column map: {string.Join(", ", columnMap.Select(kv => $"{kv.Key}={kv.Value}"))}");

                // ── יצירת פעילות חדשה ────────────────────────────────────────
                var activities = ReadActivitiesFromFile();

                int maxOrder = 0;
                foreach (var act in activities)
                {
                    var json = JsonSerializer.Serialize(act);
                    var obj  = JsonSerializer.Deserialize<JsonElement>(json);
                    if (obj.TryGetProperty("order", out var orderProp))
                    {
                        int currentOrder = orderProp.GetInt32();
                        if (currentOrder > maxOrder) maxOrder = currentOrder;
                    }
                }

                // ── יצירת פעילות חדשה ────────────────────────────────────────
                var newActivity = new
                {
                    id              = activityId,
                    name            = importedActivityName,
                    description     = "יובא מקובץ אקסל",
                    activityDate    = activityDate,
                    activityManager = activityManagerFromHeader,   // *** חדש ***
                    createdAt       = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    archived        = false,
                    order           = maxOrder + 1
                };
                activities.Add(newActivity);
                WriteActivitiesToFile(activities);

                // ── קריאת משימות מהאקסל ──────────────────────────────────────
                var allTasks  = ReadActivityTasksFromFile();
                var usedRange = worksheet.UsedRange;
                int rowCount  = usedRange.Rows.Count;
                int taskOrder = 1;
                string lastKnownDate = "";   // זוכר את התאריך האחרון שנראה
                string lastKnownDay  = "";   // זוכר את היום האחרון שנראה

                for (int row = dataStartRow; row <= rowCount; row++)
                {
                    // ── קרא תאריך ויום תמיד - גם בשורות ריקות (תאים ממוזגים) ──
                    int colDateCheck = columnMap.ContainsKey("date") ? columnMap["date"] : 2;
                    int colDayCheck  = columnMap.ContainsKey("day")  ? columnMap["day"]  : 1;

                    string rawDate = worksheet.Cells[row, colDateCheck].Value?.ToString()?.Trim() ?? "";
                    string rawDay  = worksheet.Cells[row, colDayCheck ].Value?.ToString()?.Trim() ?? "";

                    // עדכן תאריך אחרון ידוע אם נמצא ערך
                    if (!string.IsNullOrEmpty(rawDate))
                    {
                        DateTime parsedDateCheck;
                        bool parsedCheck = false;

                        // פורמט ישראלי DD.MM.YYYY
                        if (rawDate.Contains("."))
                        {
                            parsedCheck = DateTime.TryParseExact(
                                rawDate,
                                new[] { "dd.MM.yyyy", "d.M.yyyy", "dd.M.yyyy", "d.MM.yyyy" },
                                System.Globalization.CultureInfo.InvariantCulture,
                                System.Globalization.DateTimeStyles.None,
                                out parsedDateCheck);

                            if (parsedCheck)
                                lastKnownDate = parsedDateCheck.ToString("yyyy-MM-dd");
                        }

                        // פורמט רגיל
                        if (!parsedCheck && DateTime.TryParse(rawDate, out parsedDateCheck))
                        {
                            lastKnownDate = parsedDateCheck.ToString("yyyy-MM-dd");
                            parsedCheck = true;
                        }

                        // ערך מספרי של Excel
                        if (!parsedCheck)
                        {
                            double excelDateVal;
                            if (double.TryParse(
                                    rawDate.Replace(",", "."),
                                    System.Globalization.NumberStyles.Any,
                                    System.Globalization.CultureInfo.InvariantCulture,
                                    out excelDateVal)
                                && excelDateVal > 1 && excelDateVal < 100000)
                            {
                                try
                                {
                                    lastKnownDate = DateTime.FromOADate(excelDateVal)
                                                            .ToString("yyyy-MM-dd");
                                }
                                catch { }
                            }
                        }
                    }

                    // עדכן יום אחרון ידוע
                    if (!string.IsNullOrEmpty(rawDay))
                        lastKnownDay = rawDay;

                    // ── בדוק אם יש תוכן בשורה (מעבר לתאריך ויום) ──────────────
                    bool hasContent = false;
                    for (int col = 1; col <= 10; col++)
                    {
                        if (col == colDateCheck || col == colDayCheck) continue;
                        if (!string.IsNullOrEmpty(
                                worksheet.Cells[row, col].Value?.ToString()))
                        {
                            hasContent = true;
                            break;
                        }
                    }
                    if (!hasContent) continue;

                    // ── קריאת ערכי עמודות לפי המיפוי הדינמי ─────────────────
                    string day, date, time, title, responsible, 
                        secondaryResponsible, status, notes, 
                        priorityText, description,activityManagerName,alertsToCheck,emailTo,emailCc,emailSubject,emailBody,systemName,environment,dependency,disruptionDuration,impact;

                    if (columnMap.Count > 0)
                    {
                        int colDay   = columnMap.ContainsKey("day")                  ? columnMap["day"]                  : 0;
                        int colDate  = columnMap.ContainsKey("date")                 ? columnMap["date"]                 : 0;
                        int colTime  = columnMap.ContainsKey("time")                 ? columnMap["time"]                 : 0;
                        int colTitle = columnMap.ContainsKey("title")                ? columnMap["title"]                : 0;
                        int colResp  = columnMap.ContainsKey("responsible")          ? columnMap["responsible"]          : 0;
                        int colSec   = columnMap.ContainsKey("secondaryResponsible") ? columnMap["secondaryResponsible"] : 0;
                        int colStat  = columnMap.ContainsKey("status")               ? columnMap["status"]               : 0;
                        int colNotes = columnMap.ContainsKey("notes")                ? columnMap["notes"]                : 0;
                        int colPrio  = columnMap.ContainsKey("priority")             ? columnMap["priority"]             : 0;
                        int colDesc  = columnMap.ContainsKey("description")          ? columnMap["description"]          : 0;
                        int colActMgr  = columnMap.ContainsKey("activityManager") ? columnMap["activityManager"] : 0;
                        int colAlerts  = columnMap.ContainsKey("alertsToCheck")   ? columnMap["alertsToCheck"]   : 0;
                        int colSystem     = columnMap.ContainsKey("system")             ? columnMap["system"]             : 0;
                        int colEnv        = columnMap.ContainsKey("environment")        ? columnMap["environment"]        : 0;
                        int colDep        = columnMap.ContainsKey("dependency")         ? columnMap["dependency"]         : 0;
                        int colDuration   = columnMap.ContainsKey("disruptionDuration") ? columnMap["disruptionDuration"] : 0;
                        int colImpact     = columnMap.ContainsKey("impact")             ? columnMap["impact"]             : 0;
                        int colEmailTo      = columnMap.ContainsKey("emailTo")      ? columnMap["emailTo"]      : 0;
                        int colEmailCc      = columnMap.ContainsKey("emailCc")      ? columnMap["emailCc"]      : 0;
                        int colEmailSubject = columnMap.ContainsKey("emailSubject") ? columnMap["emailSubject"] : 0;
                        int colEmailBody    = columnMap.ContainsKey("emailBody")    ? columnMap["emailBody"]    : 0;

                        systemName         = colSystem   > 0 ? worksheet.Cells[row, colSystem  ].Value?.ToString()?.Trim() ?? "" : "";
                        environment        = colEnv      > 0 ? worksheet.Cells[row, colEnv     ].Value?.ToString()?.Trim() ?? "" : "";
                        dependency         = colDep      > 0 ? worksheet.Cells[row, colDep     ].Value?.ToString()?.Trim() ?? "" : "";
                        disruptionDuration = colDuration > 0 ? worksheet.Cells[row, colDuration].Value?.ToString()?.Trim() ?? "" : "";
                        impact             = colImpact   > 0 ? worksheet.Cells[row, colImpact  ].Value?.ToString()?.Trim() ?? "" : "";
                        activityManagerName = colActMgr > 0 
                            ? worksheet.Cells[row, colActMgr].Value?.ToString()?.Trim() ?? "" 
                            : "";
                        alertsToCheck = colAlerts > 0 
                            ? worksheet.Cells[row, colAlerts].Value?.ToString()?.Trim() ?? "" 
                            : "";
                        day                  = colDay   > 0 ? worksheet.Cells[row, colDay  ].Value?.ToString()?.Trim() ?? "" : "";
                        date                 = colDate  > 0 ? worksheet.Cells[row, colDate ].Value?.ToString()?.Trim() ?? "" : "";
                        time                 = colTime  > 0 ? worksheet.Cells[row, colTime ].Value?.ToString()?.Trim() ?? "" : "";
                        title                = colTitle > 0 ? worksheet.Cells[row, colTitle].Value?.ToString()?.Trim() ?? "" : "";
                        responsible          = colResp  > 0 ? worksheet.Cells[row, colResp ].Value?.ToString()?.Trim() ?? "" : "";
                        secondaryResponsible = colSec   > 0 ? worksheet.Cells[row, colSec  ].Value?.ToString()?.Trim() ?? "" : "";
                        status               = colStat  > 0 ? worksheet.Cells[row, colStat ].Value?.ToString()?.Trim() ?? "" : "";
                        notes                = colNotes > 0 ? worksheet.Cells[row, colNotes].Value?.ToString()?.Trim() ?? "" : "";
                        priorityText         = colPrio  > 0 ? worksheet.Cells[row, colPrio ].Value?.ToString()?.Trim() ?? "" : "";
                        description          = colDesc  > 0 ? worksheet.Cells[row, colDesc ].Value?.ToString()?.Trim() ?? "" : "";

                        emailTo      = colEmailTo      > 0 ? worksheet.Cells[row, colEmailTo     ].Value?.ToString()?.Trim() ?? "" : "";
                        emailCc      = colEmailCc      > 0 ? worksheet.Cells[row, colEmailCc     ].Value?.ToString()?.Trim() ?? "" : "";
                        emailSubject = colEmailSubject > 0 ? worksheet.Cells[row, colEmailSubject].Value?.ToString()?.Trim() ?? "" : "";
                        emailBody    = colEmailBody    > 0 ? worksheet.Cells[row, colEmailBody   ].Value?.ToString()?.Trim() ?? "" : "";
                    }
                    else
                    {
                        // fallback - עמודות ברירת מחדל
                        day                  = worksheet.Cells[row, 1].Value?.ToString()?.Trim() ?? "";
                        date                 = worksheet.Cells[row, 2].Value?.ToString()?.Trim() ?? "";
                        time                 = worksheet.Cells[row, 3].Value?.ToString()?.Trim() ?? "";
                        title                = worksheet.Cells[row, 4].Value?.ToString()?.Trim() ?? "";
                        responsible          = worksheet.Cells[row, 5].Value?.ToString()?.Trim() ?? "";
                        secondaryResponsible = worksheet.Cells[row, 6].Value?.ToString()?.Trim() ?? "";
                        status               = worksheet.Cells[row, 7].Value?.ToString()?.Trim() ?? "חדש";
                        notes                = worksheet.Cells[row, 8].Value?.ToString()?.Trim() ?? "";
                        priorityText         = "";
                        description          = "";
                        activityManagerName = "";
                        alertsToCheck       = "";
                        emailTo = "";
                        emailCc = "";
                        emailSubject = "";
                        emailBody = "";
                        systemName        = "";
                        environment       = "";
                        dependency        = "";
                        disruptionDuration = "";
                        impact            = "";
                    }

                    // אם אין כותרת - דלג על השורה
                    if (string.IsNullOrEmpty(title)) continue;

                    // ── טיפול בשעה ───────────────────────────────────────────
                    string taskHour   = "";
                    string taskMinute = "";

                    if (!string.IsNullOrEmpty(time))
                    {
                        try
                        {
                            double excelTimeValue;
                            if (double.TryParse(
                                    time.Replace(",", "."),
                                    System.Globalization.NumberStyles.Any,
                                    System.Globalization.CultureInfo.InvariantCulture,
                                    out excelTimeValue)
                                && excelTimeValue >= 0 && excelTimeValue < 1)
                            {
                                // ערך עשרוני של Excel לשעה
                                int totalMinutes = (int)Math.Round(excelTimeValue * 24 * 60);
                                taskHour   = (totalMinutes / 60).ToString("00");
                                taskMinute = (totalMinutes % 60).ToString("00");
                            }
                            else
                            {
                                time = time.Replace(" ", "").Trim();

                                if (time.Contains(":"))
                                {
                                    string[] parts = time.Split(':');
                                    if (parts.Length >= 2 &&
                                        int.TryParse(parts[0], out int h) &&
                                        int.TryParse(parts[1], out int m))
                                    {
                                        taskHour   = h.ToString("00");
                                        taskMinute = m.ToString("00");
                                    }
                                }
                                else if (DateTime.TryParse(time, out DateTime parsedTime))
                                {
                                    taskHour   = parsedTime.Hour.ToString("00");
                                    taskMinute = parsedTime.Minute.ToString("00");
                                }
                            }

                            System.Diagnostics.Debug.WriteLine(
                                $"Parsed time: '{time}' → {taskHour}:{taskMinute}");
                        }
                        catch (Exception ex)
                        {
                            taskHour   = "";
                            taskMinute = "";
                            System.Diagnostics.Debug.WriteLine(
                                $"Error parsing time '{time}': {ex.Message}");
                        }
                    }

                    // ── טיפול בתאריך ─────────────────────────────────────────
                    // אם יש תאריך בשורה הנוכחית - עדכן את התאריך הידוע האחרון
                    // אם אין - השתמש בתאריך האחרון שנראה (תאריך משותף לכמה שורות)
                    string taskDate = "";

                    if (!string.IsNullOrEmpty(date))
                    {
                        try
                        {
                            // נסה לפרש תאריך בפורמט DD.MM.YYYY (פורמט ישראלי נפוץ)
                            DateTime parsedDate;
                            bool parsed = false;

                            // נסה פורמט ישראלי DD.MM.YYYY
                            if (!parsed && date.Contains("."))
                            {
                                parsed = DateTime.TryParseExact(
                                    date.Trim(),
                                    new[] { "dd.MM.yyyy", "d.M.yyyy", "dd.M.yyyy", "d.MM.yyyy" },
                                    System.Globalization.CultureInfo.InvariantCulture,
                                    System.Globalization.DateTimeStyles.None,
                                    out parsedDate);

                                if (parsed)
                                {
                                    lastKnownDate = parsedDate.ToString("yyyy-MM-dd");
                                }
                            }

                            // נסה פורמט רגיל
                            if (!parsed && DateTime.TryParse(date, out parsedDate))
                            {
                                lastKnownDate = parsedDate.ToString("yyyy-MM-dd");
                                parsed = true;
                            }

                            // נסה ערך מספרי של Excel (מספר ימים מ-1900)
                            if (!parsed)
                            {
                                double excelDateValue;
                                if (double.TryParse(
                                        date.Replace(",", "."),
                                        System.Globalization.NumberStyles.Any,
                                        System.Globalization.CultureInfo.InvariantCulture,
                                        out excelDateValue)
                                    && excelDateValue > 1 && excelDateValue < 100000)
                                {
                                    try
                                    {
                                        parsedDate = DateTime.FromOADate(excelDateValue);
                                        lastKnownDate = parsedDate.ToString("yyyy-MM-dd");
                                        parsed = true;
                                    }
                                    catch { }
                                }
                            }
                        }
                        catch { }
                    }

                    // השתמש בתאריך הנוכחי או בתאריך האחרון הידוע
                    taskDate = !string.IsNullOrEmpty(lastKnownDate) ? lastKnownDate : "";

                    // עדכן גם את היום האחרון הידוע
                    if (!string.IsNullOrEmpty(day))
                    {
                        lastKnownDay = day;
                    }

                    // ── קביעת עדיפות ─────────────────────────────────────────
                    string priority = "medium";

                    // אם יש עמודת עדיפות מפורשת - השתמש בה
                    if (!string.IsNullOrEmpty(priorityText))
                    {
                        priority = GetPriorityFromExcel(priorityText);
                    }
                    else
                    {
                        // fallback: זיהוי לפי תוכן הכותרת/הערות
                        string titleLower = title.ToLower();
                        string notesLower = notes.ToLower();

                        if (titleLower.Contains("דחוף") || titleLower.Contains("חשוב") ||
                            notesLower.Contains("דחוף") || notesLower.Contains("חשוב"))
                        {
                            priority = "high";
                        }
                    }

                    // ── ולידציה של סטטוס ─────────────────────────────────────
                    var validStatuses = new HashSet<string>
                        { "חדש", "ממתין", "בביצוע", "בוצע", "מבוטלת" };
                    if (string.IsNullOrEmpty(status) || !validStatuses.Contains(status))
                    {
                        status = "חדש";
                    }

                    // ── יצירת המשימה ─────────────────────────────────────────
                    var newTask = new
                    {
                        id                   = Guid.NewGuid().ToString(),
                        activityId           = activityId,
                        title                = title,
                        description          = description,
                        priority             = priority,
                        taskDate             = taskDate,
                        taskHour             = taskHour,
                        taskMinute           = taskMinute,
                        responsiblePerson    = responsible,
                        secondaryResponsible = secondaryResponsible,
                        status               = status,
                        notes                = notes,
                        createdAt            = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates      = new List<string>(),
                        skipReasons          = new Dictionary<string, string>(),
                        skipUserNames        = new Dictionary<string, string>(),
                        completedByEmployees = new Dictionary<string, string>(),
                        completionTimes      = new Dictionary<string, string>(),
                        executorNames        = new Dictionary<string, string>(),
                        activityManager      = activityManagerName,
                        alertsToCheck        = alertsToCheck,
                        emailTo          = emailTo,
                        emailCc          = emailCc,
                        emailSubject     = emailSubject,
                        emailBody        = emailBody,
                        emailSent        = false,
                        emailSentAt      = "",
                        systemName        = systemName,
                        environment       = environment,
                        dependency        = dependency,
                        disruptionDuration = disruptionDuration,
                        impact            = impact,
                        order            = taskOrder++
                    };

                    allTasks.Add(newTask);
                }

                WriteActivityTasksToFile(allTasks);
            }

            return Json(new { 
                success      = true, 
                activityId   = activityId,
                activityName = importedActivityName,
                activityManager  = activityManagerFromHeader
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                error   = $"שגיאה בעיבוד הקובץ: {ex.Message}" 
            });
        }
        finally
        {
            if (tempFilePath != null && System.IO.File.Exists(tempFilePath))
            {
                try { System.IO.File.Delete(tempFilePath); }
                catch { }
            }
        }
    }

    [HttpPost]
    public async Task<IActionResult> SendTaskEmail(
        [FromBody] SendTaskEmailRequest request)
    {
        if (!IsUserAuthenticated()) return RequireAuth();
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            var taskIndex = -1;
            
            for (int i = 0; i < allTasks.Count; i++)
            {
                var tjson = JsonSerializer.Serialize(allTasks[i]);
                var tobj  = JsonSerializer.Deserialize<JsonElement>(tjson);
                if (tobj.TryGetProperty("id", out var tid) &&
                    tid.GetString() == request.TaskId)
                {
                    taskIndex = i;
                    break;
                }
            }

            if (taskIndex == -1)
                return Json(new { success = false, error = "משימה לא נמצאה" });

            var json2 = JsonSerializer.Serialize(allTasks[taskIndex]);
            var obj2  = JsonSerializer.Deserialize<JsonElement>(json2);

            var emailTo      = obj2.TryGetProperty("emailTo",      out var et)  ? et.GetString()  : "";
            var emailCc      = obj2.TryGetProperty("emailCc",      out var ec)  ? ec.GetString()  : "";
            var emailSubject = obj2.TryGetProperty("emailSubject", out var es)  ? es.GetString()  : "";
            var emailBody    = obj2.TryGetProperty("emailBody",    out var eb)  ? eb.GetString()  : "";
            var taskTitle    = obj2.TryGetProperty("title",        out var tt)  ? tt.GetString()  : "";

            if (string.IsNullOrEmpty(emailTo))
                return Json(new { success = false, 
                                error = "לא הוגדר כתובת מייל למשימה" });

            var completedBy    = request.CompletedBy ?? 
                                HttpContext.User?.Identity?.Name ?? "לא ידוע";
            var completionTime = DateTime.Now.ToString("HH:mm");

            var finalBody = (emailBody ?? "")
                .Replace("{task}",        taskTitle    ?? "")
                .Replace("{completedBy}", completedBy)
                .Replace("{time}",        completionTime)
                .Replace("{date}",        DateTime.Now.ToString("yyyy-MM-dd"));

            var finalSubject = (emailSubject ?? "")
                .Replace("{task}",        taskTitle    ?? "")
                .Replace("{completedBy}", completedBy);

            var (success, msg) = await _emailService.SendTaskCompletionEmailAsync(
                toEmail:        emailTo,
                ccEmail:        emailCc,
                subject:        finalSubject,
                body:           finalBody,
                taskTitle:      taskTitle    ?? "",
                completedBy:    completedBy,
                completionTime: completionTime
            );

            if (success)
            {
                // ✅ תיקון: עדכן emailSent = true במשימה
                var emailSentAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                
                var updatedTask = new
                {
                    id                   = obj2.TryGetProperty("id",                   out var id2)   ? id2.GetString()   : "",
                    activityId           = obj2.TryGetProperty("activityId",           out var ai2)   ? ai2.GetString()   : "",
                    title                = obj2.TryGetProperty("title",                out var t2)    ? t2.GetString()    : "",
                    description          = obj2.TryGetProperty("description",          out var d2)    ? d2.GetString()    : "",
                    priority             = obj2.TryGetProperty("priority",             out var p2)    ? p2.GetString()    : "medium",
                    taskDate             = obj2.TryGetProperty("taskDate",             out var td2)   ? td2.GetString()   : "",
                    taskHour             = obj2.TryGetProperty("taskHour",             out var th2)   ? th2.GetString()   : "",
                    taskMinute           = obj2.TryGetProperty("taskMinute",           out var tm2)   ? tm2.GetString()   : "",
                    responsiblePerson    = obj2.TryGetProperty("responsiblePerson",    out var rp2)   ? rp2.GetString()   : "",
                    secondaryResponsible = obj2.TryGetProperty("secondaryResponsible", out var sr2)   ? sr2.GetString()   : "",
                    status               = obj2.TryGetProperty("status",               out var st2)   ? st2.GetString()   : "חדש",
                    notes                = obj2.TryGetProperty("notes",                out var nt2)   ? nt2.GetString()   : "",
                    createdAt            = obj2.TryGetProperty("createdAt",            out var cr2)   ? cr2.GetString()   : "",
                    completionDates      = obj2.TryGetProperty("completionDates",      out var cd2)   
                                        ? JsonSerializer.Deserialize<List<string>>(cd2.GetRawText()) 
                                        : new List<string>(),
                    skipReasons          = obj2.TryGetProperty("skipReasons",          out var srr2)  
                                        ? JsonSerializer.Deserialize<Dictionary<string,string>>(srr2.GetRawText()) 
                                        : new Dictionary<string,string>(),
                    skipUserNames        = obj2.TryGetProperty("skipUserNames",        out var sun2)  
                                        ? JsonSerializer.Deserialize<Dictionary<string,string>>(sun2.GetRawText()) 
                                        : new Dictionary<string,string>(),
                    completedByEmployees = obj2.TryGetProperty("completedByEmployees", out var cbe2)  
                                        ? JsonSerializer.Deserialize<Dictionary<string,string>>(cbe2.GetRawText()) 
                                        : new Dictionary<string,string>(),
                    completionTimes      = obj2.TryGetProperty("completionTimes",      out var ct2)   
                                        ? JsonSerializer.Deserialize<Dictionary<string,string>>(ct2.GetRawText()) 
                                        : new Dictionary<string,string>(),
                    executorNames        = obj2.TryGetProperty("executorNames",        out var en2)   
                                        ? JsonSerializer.Deserialize<Dictionary<string,string>>(en2.GetRawText()) 
                                        : new Dictionary<string,string>(),
                    order                = obj2.TryGetProperty("order",                out var or2)   ? or2.GetInt32()    : 999999,
                    hasAlarm             = obj2.TryGetProperty("hasAlarm",             out var ha2)   && ha2.GetBoolean(),
                    activityManager      = obj2.TryGetProperty("activityManager",      out var am2)   ? am2.GetString()   : "",
                    alertsToCheck        = obj2.TryGetProperty("alertsToCheck",        out var atc2)  ? atc2.GetString()  : "",
                    emailTo              = emailTo,
                    emailCc              = emailCc,
                    emailSubject         = emailSubject,
                    emailBody            = emailBody,
                    emailSent            = true,          // ✅ מעודכן
                    emailSentAt          = emailSentAt,   // ✅ מעודכן
                    history              = obj2.TryGetProperty("history",              out var hi2)   
                                        ? JsonSerializer.Deserialize<List<object>>(hi2.GetRawText()) 
                                        : new List<object>()
                };

                allTasks[taskIndex] = updatedTask;
                WriteActivityTasksToFile(allTasks);

                return Json(new { success = true, message = "מייל נשלח בהצלחה" });
            }
            else
            {
                return Json(new { success = false, error = msg });
            }
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public async Task<IActionResult> ImportFromWord(IFormFile wordFile)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        if (wordFile == null || wordFile.Length == 0)
        {
            return Json(new { 
                success = false, 
                error = "לא נבחר קובץ" 
            });
        }

        if (!wordFile.FileName.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) && 
            !wordFile.FileName.EndsWith(".doc",  StringComparison.OrdinalIgnoreCase))
        {
            return Json(new { 
                success = false, 
                error = "הקובץ אינו בפורמט Word" 
            });
        }

        string tempFilePath      = null;
        string activityId        = Guid.NewGuid().ToString();
        string importedActivityName = Path.GetFileNameWithoutExtension(wordFile.FileName);
        if (string.IsNullOrWhiteSpace(importedActivityName))
            importedActivityName = $"פעילות {DateTime.Now:yyyy-MM-dd HH:mm}";

        try
        {
            // שמור קובץ זמני
            tempFilePath = Path.Combine(
                Path.GetTempPath(),
                Guid.NewGuid().ToString() + Path.GetExtension(wordFile.FileName)
            );

            using (var fileStream = new FileStream(tempFilePath, FileMode.Create))
            {
                await wordFile.CopyToAsync(fileStream);
            }

           using (var helper = new OfficeInteropHelper(
           OfficeInteropHelper.OfficeApplication.Word))
            {
                // פתח את המסמך וקבל את האובייקט דרך helper
                helper.OpenDocument(tempFilePath);
                dynamic document = helper.GetDocument();

                // ── בדוק שיש טבלאות במסמך ───────────────────────────
                int tableCount = document.Tables.Count;
                if (tableCount == 0)
                {
                    return Json(new { 
                        success = false, 
                        error = "לא נמצאו טבלאות במסמך Word" 
                    });
                }

                // ── קריאת שם הפעילות מהכותרת של המסמך ──────────────
                try
                {
                    string firstParagraph = document.Paragraphs[1].Range.Text?.Trim();
                    if (!string.IsNullOrEmpty(firstParagraph) && 
                        firstParagraph.Length > 1)
                    {
                        importedActivityName = firstParagraph
                            .Replace("\r", "")
                            .Replace("\n", "")
                            .Trim();
                    }
                }
                catch { }

                // ── קריאת תאריך הפעילות ──────────────────────────────
                string activityDate = Request.Form["activityDate"];
                if (string.IsNullOrEmpty(activityDate))
                {
                    activityDate = DateTime.Now.ToString("yyyy-MM-dd");
                }

                // ── עבוד על הטבלה הגדולה ביותר ───────────────────────
                dynamic mainTable = document.Tables[1];
                int maxRows = 0;

                for (int t = 1; t <= tableCount; t++)
                {
                    int rows = document.Tables[t].Rows.Count;
                    if (rows > maxRows)
                    {
                        maxRows   = rows;
                        mainTable = document.Tables[t];
                    }
                }

                int totalRows = mainTable.Rows.Count;
                int totalCols = mainTable.Columns.Count;

                System.Diagnostics.Debug.WriteLine(
                    $"Word table: {totalRows} rows x {totalCols} cols");

                // ══════════════════════════════════════════════════════
                // זיהוי דינמי של שורת הכותרות (בין שורות 1-5)
                // ══════════════════════════════════════════════════════
                int headerRow    = -1;
                int dataStartRow = -1;

                var headerKeywords = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                {
                    "כותרת", "משימה", "תיאור", "שעה", "תאריך", "אחראי",
                    "סטטוס", "הערות", "יום", "עדיפות",
                    "title", "task", "description", "time", "date",
                    "responsible", "status", "notes", "day", "priority"
                };

                int checkRows = Math.Min(5, totalRows);
                for (int row = 1; row <= checkRows; row++)
                {
                    int matchCount = 0;

                    for (int col = 1; col <= totalCols; col++)
                    {
                        string cellValue = GetWordCellText(mainTable, row, col);
                        if (string.IsNullOrEmpty(cellValue)) continue;

                        foreach (var keyword in headerKeywords)
                        {
                            if (cellValue.IndexOf(keyword, 
                                    StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                matchCount++;
                                break;
                            }
                        }
                    }

                    if (matchCount >= 2)
                    {
                        headerRow    = row;
                        dataStartRow = row + 1;
                        System.Diagnostics.Debug.WriteLine(
                            $"Word header row: {headerRow}, matches: {matchCount}");
                        break;
                    }
                }

                // ברירת מחדל אם לא נמצאה שורת כותרות
                if (headerRow == -1)
                {
                    headerRow    = 1;
                    dataStartRow = 2;
                }

                // ══════════════════════════════════════════════════════
                // מיפוי עמודות לפי כותרות
                // ══════════════════════════════════════════════════════
                var columnMap = new Dictionary<string, int>(
                    StringComparer.OrdinalIgnoreCase);

                for (int col = 1; col <= totalCols; col++)
                {
                    string header = GetWordCellText(mainTable, headerRow, col);
                    if (string.IsNullOrEmpty(header)) continue;

                    string fieldName = null;

                    if (header.IndexOf("אחראי משנה", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "secondaryResponsible";
                    else if (header.IndexOf("secondary",   StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "secondaryResponsible";
                    else if (header.IndexOf("אחראי",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("responsible", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "responsible";
                    else if (header.IndexOf("כותרת",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("משימה",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("title",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("task",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "title";
                    else if (header.IndexOf("תאריך",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "date";
                    else if (header.IndexOf("date",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "date";
                    else if (header.IndexOf("שעה",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "time";
                    else if (header.IndexOf("time",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "time";
                    else if (header.IndexOf("יום",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "day";
                    else if (header.IndexOf("day",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "day";
                    else if (header.IndexOf("סטטוס",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "status";
                    else if (header.IndexOf("status",      StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "status";
                    else if (header.IndexOf("הערות",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "notes";
                    else if (header.IndexOf("notes",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "notes";
                    else if (header.IndexOf("עדיפות",      StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "priority";
                    else if (header.IndexOf("priority",    StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "priority";
                    else if (header.IndexOf("תיאור",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "description";
                    else if (header.IndexOf("description", StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "description";
                    else if (header.IndexOf("מנהל פעילות",  StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "activityManager";
                    else if (header.IndexOf("מנהל",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "activityManager";
                    else if (header.IndexOf("manager",       StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "activityManager";
                    else if (header.IndexOf("התראות",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("התראה",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("alerts",        StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";
                    else if (header.IndexOf("alert",         StringComparison.OrdinalIgnoreCase) >= 0)
                        fieldName = "alertsToCheck";

                    if (fieldName != null && !columnMap.ContainsKey(fieldName))
                    {
                        columnMap[fieldName] = col;
                    }
                }

                System.Diagnostics.Debug.WriteLine(
                    $"Word column map: {string.Join(", ", columnMap.Select(kv => $"{kv.Key}={kv.Value}"))}");

                // ── יצירת פעילות חדשה ────────────────────────────────
                var activities = ReadActivitiesFromFile();
                int maxOrder   = 0;

                foreach (var act in activities)
                {
                    var json = JsonSerializer.Serialize(act);
                    var obj  = JsonSerializer.Deserialize<JsonElement>(json);
                    if (obj.TryGetProperty("order", out var orderProp))
                    {
                        int currentOrder = orderProp.GetInt32();
                        if (currentOrder > maxOrder) maxOrder = currentOrder;
                    }
                }

                var newActivity = new
                {
                    id           = activityId,
                    name         = importedActivityName,
                    description  = "יובא מקובץ Word",
                    activityDate = activityDate,
                    createdAt    = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    archived     = false,
                    order        = maxOrder + 1
                };

                activities.Add(newActivity);
                WriteActivitiesToFile(activities);

                // ── קריאת משימות מהטבלה ──────────────────────────────
                var allTasks      = ReadActivityTasksFromFile();
                int taskOrder     = 1;
                string lastKnownDate = "";
                string lastKnownDay  = "";

                int colDateCheck = columnMap.ContainsKey("date") ? columnMap["date"] : 2;
                int colDayCheck  = columnMap.ContainsKey("day")  ? columnMap["day"]  : 1;

                for (int row = dataStartRow; row <= totalRows; row++)
                {
                    // ── קרא תאריך/יום תמיד (גם בשורות ריקות/ממוזגות) ─
                    string rawDate = GetWordCellText(mainTable, row, colDateCheck);
                    string rawDay  = GetWordCellText(mainTable, row, colDayCheck);

                    if (!string.IsNullOrEmpty(rawDate))
                    {
                        DateTime parsedDateCheck;
                        bool parsedCheck = false;

                        if (rawDate.Contains("."))
                        {
                            parsedCheck = DateTime.TryParseExact(
                                rawDate,
                                new[] { "dd.MM.yyyy", "d.M.yyyy", 
                                        "dd.M.yyyy",  "d.MM.yyyy" },
                                System.Globalization.CultureInfo.InvariantCulture,
                                System.Globalization.DateTimeStyles.None,
                                out parsedDateCheck);

                            if (parsedCheck)
                                lastKnownDate = parsedDateCheck.ToString("yyyy-MM-dd");
                        }

                        if (!parsedCheck && 
                            DateTime.TryParse(rawDate, out parsedDateCheck))
                        {
                            lastKnownDate = parsedDateCheck.ToString("yyyy-MM-dd");
                        }
                    }

                    if (!string.IsNullOrEmpty(rawDay))
                        lastKnownDay = rawDay;

                    // ── בדוק אם יש תוכן בשורה ───────────────────────
                    bool hasContent = false;
                    for (int col = 1; col <= totalCols; col++)
                    {
                        if (col == colDateCheck || col == colDayCheck) continue;
                        if (!string.IsNullOrEmpty(GetWordCellText(mainTable, row, col)))
                        {
                            hasContent = true;
                            break;
                        }
                    }
                    if (!hasContent) continue;

                    // ── קריאת ערכי עמודות ────────────────────────────
                    string title, time, responsible, secondaryResponsible,
                        status, notes, priorityText, description,activityManagerName,alertsToCheck,systemName,environment,dependency,disruptionDuration,impact;

                    if (columnMap.Count > 0)
                    {
                        int colTitle = columnMap.ContainsKey("title")                ? columnMap["title"]                : 0;
                        int colTime  = columnMap.ContainsKey("time")                 ? columnMap["time"]                 : 0;
                        int colResp  = columnMap.ContainsKey("responsible")          ? columnMap["responsible"]          : 0;
                        int colSec   = columnMap.ContainsKey("secondaryResponsible") ? columnMap["secondaryResponsible"] : 0;
                        int colStat  = columnMap.ContainsKey("status")               ? columnMap["status"]               : 0;
                        int colNotes = columnMap.ContainsKey("notes")                ? columnMap["notes"]                : 0;
                        int colPrio  = columnMap.ContainsKey("priority")             ? columnMap["priority"]             : 0;
                        int colDesc  = columnMap.ContainsKey("description")          ? columnMap["description"]          : 0;
                        int colActMgr  = columnMap.ContainsKey("activityManager") ? columnMap["activityManager"] : 0;
                        int colAlerts  = columnMap.ContainsKey("alertsToCheck")   ? columnMap["alertsToCheck"]   : 0;

                        int colSystem     = columnMap.ContainsKey("system")             ? columnMap["system"]             : 0;
                        int colEnv        = columnMap.ContainsKey("environment")        ? columnMap["environment"]        : 0;
                        int colDep        = columnMap.ContainsKey("dependency")         ? columnMap["dependency"]         : 0;
                        int colDuration   = columnMap.ContainsKey("disruptionDuration") ? columnMap["disruptionDuration"] : 0;
                        int colImpact     = columnMap.ContainsKey("impact")             ? columnMap["impact"]             : 0;
                        int colEmailTo      = columnMap.ContainsKey("emailTo")      ? columnMap["emailTo"]      : 0;
                        int colEmailCc      = columnMap.ContainsKey("emailCc")      ? columnMap["emailCc"]      : 0;
                        int colEmailSubject = columnMap.ContainsKey("emailSubject") ? columnMap["emailSubject"] : 0;
                        int colEmailBody    = columnMap.ContainsKey("emailBody")    ? columnMap["emailBody"]    : 0;

                        activityManagerName = colActMgr > 0 
                            ? GetWordCellText(mainTable, row, colActMgr) 
                            : "";
                        alertsToCheck = colAlerts > 0 
                            ? GetWordCellText(mainTable, row, colAlerts) 
                            : "";
                        title                = colTitle > 0 ? GetWordCellText(mainTable, row, colTitle) : "";
                        time                 = colTime  > 0 ? GetWordCellText(mainTable, row, colTime)  : "";
                        responsible          = colResp  > 0 ? GetWordCellText(mainTable, row, colResp)  : "";
                        secondaryResponsible = colSec   > 0 ? GetWordCellText(mainTable, row, colSec)   : "";
                        status               = colStat  > 0 ? GetWordCellText(mainTable, row, colStat)  : "";
                        notes                = colNotes > 0 ? GetWordCellText(mainTable, row, colNotes) : "";
                        priorityText         = colPrio  > 0 ? GetWordCellText(mainTable, row, colPrio)  : "";
                        description          = colDesc  > 0 ? GetWordCellText(mainTable, row, colDesc)  : "";
                        systemName         = colSystem   > 0 ? GetWordCellText(mainTable, row, colSystem)   : "";
                        environment        = colEnv      > 0 ? GetWordCellText(mainTable, row, colEnv)      : "";
                        dependency         = colDep      > 0 ? GetWordCellText(mainTable, row, colDep)      : "";
                        disruptionDuration = colDuration > 0 ? GetWordCellText(mainTable, row, colDuration) : "";
                        impact             = colImpact   > 0 ? GetWordCellText(mainTable, row, colImpact)   : "";
                    }
                    else
                    {
                        // fallback - עמודות ברירת מחדל
                        title                = GetWordCellText(mainTable, row, 4);
                        time                 = GetWordCellText(mainTable, row, 3);
                        responsible          = GetWordCellText(mainTable, row, 5);
                        secondaryResponsible = GetWordCellText(mainTable, row, 6);
                        status               = GetWordCellText(mainTable, row, 7);
                        notes                = GetWordCellText(mainTable, row, 8);
                        priorityText         = "";
                        description          = "";
                        activityManagerName = "";
                        alertsToCheck       = "";
                        systemName        = "";
                        environment       = "";
                        dependency        = "";
                        disruptionDuration = "";
                        impact            = "";
                    }

                    if (string.IsNullOrEmpty(title)) continue;

                    // ── טיפול בשעה ───────────────────────────────────
                    string taskHour   = "";
                    string taskMinute = "";

                    if (!string.IsNullOrEmpty(time))
                    {
                        try
                        {
                            time = time.Replace(" ", "").Trim();

                            if (time.Contains(":"))
                            {
                                string[] parts = time.Split(':');
                                if (parts.Length >= 2 &&
                                    int.TryParse(parts[0], out int h) &&
                                    int.TryParse(parts[1], out int m))
                                {
                                    taskHour   = h.ToString("00");
                                    taskMinute = m.ToString("00");
                                }
                            }
                            else if (DateTime.TryParse(time, out DateTime parsedTime))
                            {
                                taskHour   = parsedTime.Hour.ToString("00");
                                taskMinute = parsedTime.Minute.ToString("00");
                            }
                        }
                        catch { }
                    }

                    // ── תאריך המשימה ─────────────────────────────────
                    string taskDate = lastKnownDate;

                    // ── עדיפות ───────────────────────────────────────
                    string priority = "medium";
                    if (!string.IsNullOrEmpty(priorityText))
                    {
                        priority = GetPriorityFromExcel(priorityText);
                    }
                    else
                    {
                        if (title.ToLower().Contains("דחוף") || 
                            title.ToLower().Contains("חשוב") ||
                            notes.ToLower().Contains("דחוף") || 
                            notes.ToLower().Contains("חשוב"))
                        {
                            priority = "high";
                        }
                    }

                    // ── ולידציה סטטוס ────────────────────────────────
                    var validStatuses = new HashSet<string>
                        { "חדש", "ממתין", "בביצוע", "בוצע", "מבוטלת" };
                    if (string.IsNullOrEmpty(status) || !validStatuses.Contains(status))
                        status = "חדש";

                    // ── יצירת המשימה ─────────────────────────────────
                    var newTask = new
                    {
                        id                   = Guid.NewGuid().ToString(),
                        activityId           = activityId,
                        title                = title,
                        description          = description,
                        priority             = priority,
                        taskDate             = taskDate,
                        taskHour             = taskHour,
                        taskMinute           = taskMinute,
                        responsiblePerson    = responsible,
                        secondaryResponsible = secondaryResponsible,
                        status               = status,
                        notes                = notes,
                        createdAt            = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates      = new List<string>(),
                        skipReasons          = new Dictionary<string, string>(),
                        skipUserNames        = new Dictionary<string, string>(),
                        completedByEmployees = new Dictionary<string, string>(),
                        completionTimes      = new Dictionary<string, string>(),
                        executorNames        = new Dictionary<string, string>(),
                        activityManager      = activityManagerName,
                        alertsToCheck        = alertsToCheck,
                        systemName        = systemName,
                        environment       = environment,
                        dependency        = dependency,
                        disruptionDuration = disruptionDuration,
                        impact            = impact,
                        order                = taskOrder++
                    };

                    allTasks.Add(newTask);
                }

                WriteActivityTasksToFile(allTasks);
            }

            return Json(new {
                success      = true,
                activityId   = activityId,
                activityName = importedActivityName
            });
        }
        catch (Exception ex)
        {
            return Json(new {
                success = false,
                error   = $"שגיאה בעיבוד הקובץ: {ex.Message}"
            });
        }
        finally
        {
            if (tempFilePath != null && System.IO.File.Exists(tempFilePath))
            {
                try { System.IO.File.Delete(tempFilePath); }
                catch { }
            }
        }
    }

    // פונקציית עזר לקריאת טקסט מתא בטבלת Word
    private string GetWordCellText(dynamic table, int row, int col)
    {
        try
        {
            string text = table.Cell(row, col).Range.Text ?? "";
            // Word מוסיף תו \r\a בסוף כל תא - נקה אותו
            text = text.Replace("\r", "").Replace("\a", "").Trim();
            return text;
        }
        catch
        {
            // תא ממוזג או לא קיים
            return "";
        }
    }

    // Get list of available Excel templates
    [HttpGet]
    public IActionResult GetActivityTemplates()
    {
        try
        {
            string templatesPath = PortalPaths.UnderFiles(@"activityTemplates");

            // Check if directory exists
            if (!Directory.Exists(templatesPath))
            {
                return Json(new { success = true, templates = new List<object>() });
            }

            // Get all Excel files from the directory
            var excelFiles = Directory.GetFiles(templatesPath)
                .Where(f => f.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) ||
                            f.EndsWith(".xls", StringComparison.OrdinalIgnoreCase))
                .Select(f => new
                {
                    fileName = Path.GetFileName(f),
                    displayName = Path.GetFileNameWithoutExtension(f),
                    fileSize = new FileInfo(f).Length,
                    lastModified = new FileInfo(f).LastWriteTime.ToString("yyyy-MM-dd HH:mm")
                })
                .OrderBy(f => f.displayName)
                .ToList<object>();

            return Json(new { success = true, templates = excelFiles });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error reading templates directory: {ex.Message}");
            return Json(new { success = false, error = "שגיאה בטעינת רשימת הטמפלייטים" });
        }
    }

    // Download a specific template file
    [HttpGet]
    public IActionResult DownloadTemplate(string fileName)
    {
        try
        {
            // Validate filename - prevent path traversal attacks
            if (string.IsNullOrEmpty(fileName) || fileName.Contains("..") || fileName.Contains("/") || fileName.Contains("\\"))
            {
                return Json(new { success = false, error = "שם קובץ לא תקין" });
            }

            // Validate extension
            if (!fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) &&
                !fileName.EndsWith(".xls", StringComparison.OrdinalIgnoreCase))
            {
                return Json(new { success = false, error = "סוג קובץ לא נתמך" });
            }

            string templatesPath = PortalPaths.UnderFiles(@"activityTemplates");
            string filePath = Path.Combine(templatesPath, fileName);

            // Verify the file exists
            if (!System.IO.File.Exists(filePath))
            {
                return Json(new { success = false, error = "הקובץ לא נמצא" });
            }

            // Determine content type
            string contentType = fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : "application/vnd.ms-excel";

            // Return file for download
            var fileBytes = System.IO.File.ReadAllBytes(filePath);
            return File(fileBytes, contentType, fileName);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error downloading template: {ex.Message}");
            return Json(new { success = false, error = "שגיאה בהורדת הטמפלייט" });
        }
    }

    // Upload a template file
    [HttpPost]
    public async Task<IActionResult> UploadTemplate(IFormFile templateFile)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        if (templateFile == null || templateFile.Length == 0)
        {
            return Json(new { 
                success = false, 
                error = "לא נבחר קובץ" 
            });
        }

        // Validate extension
        if (!templateFile.FileName.EndsWith(".xlsx", 
                StringComparison.OrdinalIgnoreCase) &&
            !templateFile.FileName.EndsWith(".xls",  
                StringComparison.OrdinalIgnoreCase))
        {
            return Json(new { 
                success = false, 
                error = "יש לבחור קובץ אקסל בלבד (.xlsx או .xls)" 
            });
        }

        // Validate filename - prevent path traversal attacks
        string fileName = Path.GetFileName(templateFile.FileName);
        if (string.IsNullOrEmpty(fileName) || 
            fileName.Contains("..") || 
            fileName.Contains("/")  || 
            fileName.Contains("\\"))
        {
            return Json(new { 
                success = false, 
                error = "שם קובץ לא תקין" 
            });
        }

        try
        {
            string templatesPath = 
                PortalPaths.UnderFiles(@"activityTemplates");

            // Create directory if it doesn't exist
            if (!Directory.Exists(templatesPath))
            {
                Directory.CreateDirectory(templatesPath);
            }

            string filePath = Path.Combine(templatesPath, fileName);

            // Save the uploaded file
            using (var fileStream = new FileStream(
                filePath, 
                FileMode.Create, 
                FileAccess.Write, 
                FileShare.None))
            {
                await templateFile.CopyToAsync(fileStream);
            }

            return Json(new { 
                success = true, 
                fileName = fileName,
                message = $"הטמפלייט \"{fileName}\" הועלה בהצלחה"
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine(
                $"Error uploading template: {ex.Message}");
            return Json(new { 
                success = false, 
                error = "שגיאה בהעלאת הטמפלייט" 
            });
        }
    }

    // Delete a specific template file
    [HttpDelete]
    public IActionResult DeleteTemplate(string fileName)
    {
        if (!IsUserAuthenticated()) return RequireAuth(); 
        try
        {
            // Validate filename - prevent path traversal attacks
            if (string.IsNullOrEmpty(fileName) || 
                fileName.Contains("..") || 
                fileName.Contains("/")  || 
                fileName.Contains("\\"))
            {
                return Json(new { 
                    success = false, 
                    error = "שם קובץ לא תקין" 
                });
            }

            // Validate extension
            if (!fileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) &&
                !fileName.EndsWith(".xls",  StringComparison.OrdinalIgnoreCase))
            {
                return Json(new { 
                    success = false, 
                    error = "סוג קובץ לא נתמך" 
                });
            }

            string templatesPath = 
                PortalPaths.UnderFiles(@"activityTemplates");
            string filePath = Path.Combine(templatesPath, fileName);

            // Verify the file exists
            if (!System.IO.File.Exists(filePath))
            {
                return Json(new { 
                    success = false, 
                    error = "הקובץ לא נמצא" 
                });
            }

            // Delete the file
            System.IO.File.Delete(filePath);

            return Json(new { 
                success = true,
                message = $"הטמפלייט \"{fileName}\" נמחק בהצלחה"
            });
        }
        catch (UnauthorizedAccessException)
        {
            System.Diagnostics.Debug.WriteLine(
                $"Access denied when deleting template: {fileName}");
            return Json(new { 
                success = false, 
                error = "אין הרשאה למחוק את הקובץ" 
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine(
                $"Error deleting template: {ex.Message}");
            return Json(new { 
                success = false, 
                error = "שגיאה במחיקת הטמפלייט" 
            });
        }
    }

    // פונקציית עזר להמרת עדיפות מהאקסל
    private string GetPriorityFromExcel(string priorityText)
    {
        if (string.IsNullOrEmpty(priorityText)) return "medium";
        
        priorityText = priorityText.Trim().ToLower();
        
        if (priorityText.Contains("גבוה") || priorityText.Contains("high"))
            return "high";
        if (priorityText.Contains("נמוכ") || priorityText.Contains("low"))
            return "low";
        
        return "medium";
    }

    // Helper methods
    private List<object> ReadActivitiesFromFile()
    {
        var activities = new List<object>();

        if (!System.IO.File.Exists(_activitiesFilePath))
                {
            return activities;
        }

        try
        {
            using (var fileStream = new FileStream(_activitiesFilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var reader = new StreamReader(fileStream))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;

                    try
                    {
                        var activity = JsonSerializer.Deserialize<object>(line);
                        activities.Add(activity);
                    }
                    catch { }
                }
            }
        }
        catch { }

        return activities;
    }

    private void WriteActivitiesToFile(List<object> activities)
    {
        try
        {
            var directory = Path.GetDirectoryName(_activitiesFilePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var lines = activities.Select(a => JsonSerializer.Serialize(a)).ToArray();
            
            using (var fileStream = new FileStream(_activitiesFilePath, FileMode.Create, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(fileStream))
            {
                foreach (var line in lines)
                {
                    writer.WriteLine(line);
                }
                writer.Flush();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"File write Error: {ex.Message}");
        }
    }

    private List<object> ReadActivityTasksFromFile()
    {
        var tasks = new List<object>();

        if (!System.IO.File.Exists(_activityTasksFilePath))
        {
            return tasks;
        }

        try
        {
            using (var fileStream = new FileStream(_activityTasksFilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var reader = new StreamReader(fileStream))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;

                    try
                    {
                        var task = JsonSerializer.Deserialize<object>(line);
                        tasks.Add(task);
                    }
                    catch { }
                }
            }
        }
        catch { }

        return tasks;
    }

    private void WriteActivityTasksToFile(List<object> tasks)
    {
        try
        {
            var directory = Path.GetDirectoryName(_activityTasksFilePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var lines = tasks.Select(t => JsonSerializer.Serialize(t)).ToArray();
            
            using (var fileStream = new FileStream(_activityTasksFilePath, FileMode.Create, FileAccess.Write, FileShare.None))
            using (var writer = new StreamWriter(fileStream))
            {
                foreach (var line in lines)
                {
                    writer.WriteLine(line);
                }
                writer.Flush();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"File write Error: {ex.Message}");
        }
    }

    private void DeleteActivityTasks(string activityId)
    {
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            var remainingTasks = allTasks.Where(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj = JsonSerializer.Deserialize<JsonElement>(json); 
                
                string aId = obj.TryGetProperty("activityId", out var actIdProp) ? actIdProp.GetString() : null;
                return aId != activityId;
            }).ToList();

            WriteActivityTasksToFile(remainingTasks);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error deleting activity tasks: {ex.Message}");
        }
    }

    private void DuplicateActivityTasks(string sourceActivityId, string newActivityId)
    {
        try
        {
            var allTasks = ReadActivityTasksFromFile();
            var tasksToClone = allTasks.Where(t =>
            {
                var json = JsonSerializer.Serialize(t);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);
                
                string aId = obj.TryGetProperty("activityId", out var actIdProp) ? actIdProp.GetString() : null;
                return aId == sourceActivityId;
            }).ToList();

            foreach (var task in tasksToClone)
            {
                var json = JsonSerializer.Serialize(task);
                var obj = JsonSerializer.Deserialize<JsonElement>(json);

                var newTask = new
                {
                    id = Guid.NewGuid().ToString(),
                    activityId = newActivityId,
                    title = obj.TryGetProperty("title", out var title) ? title.GetString() : "",
                    description = obj.TryGetProperty("description", out var desc) ? desc.GetString() : "",
                    priority = obj.TryGetProperty("priority", out var priority) ? priority.GetString() : "medium",
                    taskDate = obj.TryGetProperty("taskDate", out var td) ? td.GetString() : "",  
                    taskHour = obj.TryGetProperty("taskHour", out var th) ? th.GetString() : "",  
                    taskMinute = obj.TryGetProperty("taskMinute", out var tm) ? tm.GetString() : "",    
                    responsiblePerson = obj.TryGetProperty("responsiblePerson", out var rp) ? rp.GetString() : "",  
                    secondaryResponsible = obj.TryGetProperty("secondaryResponsible", out var sr) ? sr.GetString() : "",  
                    status = "חדש",  
                    notes = obj.TryGetProperty("notes", out var nt) ? nt.GetString() : "",  
                    createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    completionDates = new List<string>(),
                    skipReasons = new Dictionary<string, string>(),
                    skipUserNames = new Dictionary<string, string>(),
                    completedByEmployees = new Dictionary<string, string>(),
                    completionTimes = new Dictionary<string, string>(),
                    executorNames = new Dictionary<string, string>(),
                    order = obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999,
                    activityManager      = obj.TryGetProperty("activityManager",  out var amDup)  ? amDup.GetString()  : "",
                    alertsToCheck        = obj.TryGetProperty("alertsToCheck",    out var atcDup) ? atcDup.GetString() : "",
                    emailTo          = obj.TryGetProperty("emailTo",      out var etDup) ? etDup.GetString() : "",
                    emailCc          = obj.TryGetProperty("emailCc",      out var ecDup) ? ecDup.GetString() : "",
                    emailSubject     = obj.TryGetProperty("emailSubject", out var esDup) ? esDup.GetString() : "",
                    emailBody        = obj.TryGetProperty("emailBody",    out var ebDup) ? ebDup.GetString() : "",
                    emailSent        = false,  // איפוס - עותק חדש
                    emailSentAt      = "",
                    systemName        = obj.TryGetProperty("systemName",         out var sn)  ? sn.GetString()  : "",
                    environment       = obj.TryGetProperty("environment",        out var env) ? env.GetString() : "",
                    dependency        = obj.TryGetProperty("dependency",         out var dep) ? dep.GetString() : "",
                    disruptionDuration = obj.TryGetProperty("disruptionDuration", out var dd)  ? dd.GetString()  : "",
                    impact            = obj.TryGetProperty("impact",             out var imp) ? imp.GetString() : "",
                    hasAlarm         = false
                };

                allTasks.Add(newTask);
            }

            WriteActivityTasksToFile(allTasks);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Error duplicating tasks: {ex.Message}");
        }
    }
}

// Request models
public class ActivityRequest
{
    public string Name            { get; set; }
    public string Description     { get; set; }
    public string ActivityDate    { get; set; }
    public string ActivityManager { get; set; }   // *** חדש ***
}

public class ActivityUpdateRequest
{
    public string Id              { get; set; }
    public string Name            { get; set; }
    public string Description     { get; set; }
    public bool?  Archived        { get; set; }
    public string ActivityDate    { get; set; }
    public string ActivityManager { get; set; }   // *** חדש ***
}

public class DuplicateActivityRequest
{
    public string ActivityId { get; set; }
}

public class ActivityTaskRequest
{
    public string ActivityId { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string TaskDate { get; set; }
    public string TaskHour { get; set; }
    public string TaskMinute { get; set; }
    public string ResponsiblePerson { get; set; }
    public string SecondaryResponsible { get; set; }
    public string Status { get; set; }
    public string Notes { get; set; }
    public bool HasAlarm { get; set; }
    public string AlertsToCheck { get; set; }          // התראות לבדיקה (טקסט חופשי)
    public string SystemName           { get; set; }
    public string Environment          { get; set; }
    public string Dependency           { get; set; }
    public string DisruptionDuration   { get; set; }
    public string Impact               { get; set; }
    
    // *** חדש: שדות מייל ***
    public string EmailTo { get; set; }          // כתובת נמען
    public string EmailCc { get; set; }          // כתובת CC
    public string EmailSubject { get; set; }     // נושא המייל
    public string EmailBody { get; set; }        // גוף המייל
    public bool EmailSent { get; set; }          // האם נשלח מייל
    public string EmailSentAt { get; set; }      // מתי נשלח
}

public class ActivityTaskUpdateRequest
{
    public string Id { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string TaskDate { get; set; }
    public string TaskHour { get; set; }
    public string TaskMinute { get; set; }
    public string ResponsiblePerson { get; set; }
    public string SecondaryResponsible { get; set; }
    public string Status { get; set; }
    public string Notes { get; set; }
    public string ClearSkipForDate { get; set; }
    public string CompletedByEmployee { get; set; }
    public string CompletionTime { get; set; }
    public string ExecutorName { get; set; }
    public string NoteText { get; set; }
    public string NoteUserName { get; set; }
    public string NoteTime { get; set; }
    public string Date { get; set; }
    public bool HasAlarm { get; set; }
    public string SystemName           { get; set; }
    public string Environment          { get; set; }
    public string Dependency           { get; set; }
    public string DisruptionDuration   { get; set; }
    public string Impact               { get; set; }
    public string EmailTo { get; set; }
    public string EmailCc { get; set; }
    public string EmailSubject { get; set; }
    public string EmailBody { get; set; }
    // *** חדש ***
    public string AlertsToCheck { get; set; }          // התראות לבדיקה
}

public class ToggleTaskRequest
{
    public string TaskId { get; set; }
    public string ActivityId { get; set; }
    public string Date { get; set; }
    public string CompletedByEmployee { get; set; }
    public string CompletionTime { get; set; }
    public string ExecutorName { get; set; }
}

public class SkipTaskRequest
{
    public string TaskId { get; set; }
    public string ActivityId { get; set; }
    public string Date { get; set; }
    public string SkipReason { get; set; }
    public string SkipUserName { get; set; }
}

public class ActivityOrderRequest
{
    public List<ActivityOrderItem> Activities { get; set; }
}

public class ActivityOrderItem
{
    public string Id { get; set; }
    public int Order { get; set; }
}

public class ActivityTaskOrderRequest
{
    public string ActivityId { get; set; }
    public List<ActivityTaskOrderItem> Tasks { get; set; }
}

public class ActivityTaskOrderItem
{
    public string Id { get; set; }
    public int Order { get; set; }
}

public class ExcelImportResult
{
    public bool Success { get; set; }
    public string Error { get; set; }
    public string ActivityId { get; set; }
    public string ActivityName { get; set; }
}

public class ActivityPermission
{
    public string ActivityId { get; set; }
    public string Username { get; set; }
    public bool CanToggle { get; set; }
    public string GrantedBy { get; set; }
    public string GrantedAt { get; set; }
    public bool   AutoGranted { get; set; } 
}

public class ActivityPermissionRequest
{
    public string ActivityId { get; set; }
    public string Username { get; set; }
    public bool CanToggle { get; set; }
    public string GrantedBy  { get; set; } 
}

public class SendTaskEmailRequest
{
    public string TaskId      { get; set; }
    public string CompletedBy { get; set; }
}