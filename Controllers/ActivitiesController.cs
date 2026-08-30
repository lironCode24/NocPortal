using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;
using System.Runtime.InteropServices;

public class ActivitiesController : Controller
{
    private readonly string _activitiesFilePath = @"R:\USERS\TASHTIT\NOC\Portal\files\activities.txt";
    private readonly string _activityTasksFilePath = @"R:\USERS\TASHTIT\NOC\Portal\files\activity_tasks.txt";

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
        try
        {
            if (string.IsNullOrEmpty(request.Name))
            {
                return Json(new { success = false, error = "שם הפעילות נדרש" });
            }

            if (string.IsNullOrEmpty(request.ActivityDate))
            {
                return Json(new { success = false, error = "תאריך הפעילות נדרש" });
            }

            var activities = ReadActivitiesFromFile();

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

            var newActivity = new
            {
                id = Guid.NewGuid().ToString(),
                name = request.Name,
                description = request.Description ?? "",
                activityDate = request.ActivityDate,
                createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                archived = false,
                order = maxOrder + 1 
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
                        id = request.Id,
                        name = request.Name ?? obj.GetProperty("name").GetString(),
                        description = request.Description ?? (obj.TryGetProperty("description", out var desc) ? desc.GetString() : ""),
                        activityDate = request.ActivityDate ?? obj.GetProperty("activityDate").GetString(), 
                        createdAt = obj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        archived = request.Archived ?? (obj.TryGetProperty("archived", out var arch) && arch.GetBoolean()),
                        order = obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999  // ADD THIS

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
                        history              = existingHistory
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
    public IActionResult ToggleTask([FromBody] ToggleTaskRequest request)
    {
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
                        history              = toggleHistory   // ← חדש
                    };

                    allTasks[i] = updatedTask;
                    WriteActivityTasksToFile(allTasks);
                    
                    return Json(new { success = true, completed = !isCompleted });
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
                        hasAlarm             = obj.TryGetProperty("hasAlarm",              out var ha)      && ha.GetBoolean(),
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
                            id = obj.GetProperty("id").GetString(),
                            name = obj.GetProperty("name").GetString(),
                            description = obj.TryGetProperty("description", out var desc) ? desc.GetString() : "",
                            activityDate = obj.GetProperty("activityDate").GetString(),
                            createdAt = obj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                            archived = obj.TryGetProperty("archived", out var arch) && arch.GetBoolean(),
                            order = orderItem.Order
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
                            // ✅ הוסף שדות חסרים:
                            completedByEmployees = obj.TryGetProperty("completedByEmployees", out var cbe) ? JsonSerializer.Deserialize<Dictionary<string, string>>(cbe.GetRawText()) : new Dictionary<string, string>(),
                            completionTimes = obj.TryGetProperty("completionTimes", out var ct) ? JsonSerializer.Deserialize<Dictionary<string, string>>(ct.GetRawText()) : new Dictionary<string, string>(),
                            executorNames = obj.TryGetProperty("executorNames", out var en) ? JsonSerializer.Deserialize<Dictionary<string, string>>(en.GetRawText()) : new Dictionary<string, string>(),
                            hasAlarm = obj.TryGetProperty("hasAlarm", out var ha) && ha.GetBoolean(), // ✅ חיוני!
                            history = obj.TryGetProperty("history", out var hist) ? JsonSerializer.Deserialize<List<object>>(hist.GetRawText()) : new List<object>(),
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
                string activityNameFromExcel = worksheet.Cells[1, 4].Value?.ToString();
                if (!string.IsNullOrEmpty(activityNameFromExcel))
                {
                    importedActivityName = activityNameFromExcel;
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

                var newActivity = new
                {
                    id          = activityId,
                    name        = importedActivityName,
                    description = "יובא מקובץ אקסל",
                    activityDate = activityDate,
                    createdAt   = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    archived    = false,
                    order       = maxOrder + 1
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
                        priorityText, description;

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

    [HttpPost]
    public async Task<IActionResult> ImportFromWord(IFormFile wordFile)
    {
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
                        status, notes, priorityText, description;

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

                        title                = colTitle > 0 ? GetWordCellText(mainTable, row, colTitle) : "";
                        time                 = colTime  > 0 ? GetWordCellText(mainTable, row, colTime)  : "";
                        responsible          = colResp  > 0 ? GetWordCellText(mainTable, row, colResp)  : "";
                        secondaryResponsible = colSec   > 0 ? GetWordCellText(mainTable, row, colSec)   : "";
                        status               = colStat  > 0 ? GetWordCellText(mainTable, row, colStat)  : "";
                        notes                = colNotes > 0 ? GetWordCellText(mainTable, row, colNotes) : "";
                        priorityText         = colPrio  > 0 ? GetWordCellText(mainTable, row, colPrio)  : "";
                        description          = colDesc  > 0 ? GetWordCellText(mainTable, row, colDesc)  : "";
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
            string templatesPath = @"R:\USERS\TASHTIT\NOC\Portal\files\activityTemplates";

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

            string templatesPath = @"R:\USERS\TASHTIT\NOC\Portal\files\activityTemplates";
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
                @"R:\USERS\TASHTIT\NOC\Portal\files\activityTemplates";

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
                @"R:\USERS\TASHTIT\NOC\Portal\files\activityTemplates";
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
                    hasAlarm = false 
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
    public string Name { get; set; }
    public string Description { get; set; }
    public string ActivityDate { get; set; }  
}

public class ActivityUpdateRequest
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Description { get; set; }
    public bool? Archived { get; set; }
    public string ActivityDate { get; set; }  
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