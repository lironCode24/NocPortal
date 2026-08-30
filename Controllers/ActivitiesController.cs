using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;
using System.Runtime.InteropServices;

public class ActivitiesController : Controller
{
    private readonly string _activitiesFilePath;
    private readonly string _activityTasksFilePath;

    public ActivitiesController(IWebHostEnvironment env)
    {
        _activitiesFilePath = Path.Combine(env.WebRootPath, "assets", "files", "activities.txt");
        _activityTasksFilePath = Path.Combine(env.WebRootPath, "assets", "files", "activity_tasks.txt");
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

            var newTask = new
            {
                id = Guid.NewGuid().ToString(),
                activityId = request.ActivityId,
                title = request.Title,
                description = request.Description ?? "",
                priority = request.Priority ?? "medium",
                taskDate = request.TaskDate ?? "",  
                taskHour = request.TaskHour ?? "",
                taskMinute = request.TaskMinute ?? "",
                responsiblePerson = request.ResponsiblePerson ?? "",  
                secondaryResponsible = request.SecondaryResponsible ?? "",  
                status = request.Status ?? "חדש",
                notes = request.Notes ?? "",  
                createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                completionDates = new List<string>(),
                skipReasons = new Dictionary<string, string>(),
                skipUserNames = new Dictionary<string, string>(),
                completedByEmployees = new Dictionary<string, string>(),
                completionTimes = new Dictionary<string, string>(),
                executorNames = new Dictionary<string, string>(),
                order = 999999
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

                    var updatedTask = new
                    {
                        id = request.Id,
                        activityId = obj.TryGetProperty("activityId", out var actId) ? actId.GetString() : "",
                        title = request.Title ?? (obj.TryGetProperty("title", out var title) ? title.GetString() : ""),
                        description = request.Description ?? (obj.TryGetProperty("description", out var desc) ? desc.GetString() : ""),
                        priority = request.Priority ?? (obj.TryGetProperty("priority", out var priority) ? priority.GetString() : "medium"),
                        taskDate = request.TaskDate ?? (obj.TryGetProperty("taskDate", out var td) ? td.GetString() : ""),   
                        taskHour = request.TaskHour ?? (obj.TryGetProperty("taskHour", out var th) ? th.GetString() : ""), 
                        taskMinute = request.TaskMinute ?? (obj.TryGetProperty("taskMinute", out var tm) ? tm.GetString() : ""),  
                        responsiblePerson = request.ResponsiblePerson ?? (obj.TryGetProperty("responsiblePerson", out var rp) ? rp.GetString() : ""),  
                        secondaryResponsible = request.SecondaryResponsible ?? (obj.TryGetProperty("secondaryResponsible", out var sr) ? sr.GetString() : ""),  
                        status = request.Status ?? (obj.TryGetProperty("status", out var st) ? st.GetString() : "חדש"),  
                        notes = request.Notes ?? (obj.TryGetProperty("notes", out var nt) ? nt.GetString() : ""),  
                        createdAt = obj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates = obj.TryGetProperty("completionDates", out var cd) ? JsonSerializer.Deserialize<List<string>>(cd.GetRawText()) : new List<string>(),
                        skipReasons = skipReasons, 
                        skipUserNames = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes = completionTimes,
                        executorNames = executorNames,
                        order = obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999
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

                    var updatedTask = new
                    {
                        id = taskId,
                        activityId = obj.TryGetProperty("activityId", out var actId) ? actId.GetString() : "",
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
                        completionDates = completionDates,
                        skipReasons = skipReasons,
                        skipUserNames = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes = completionTimes,
                        executorNames = executorNames,
                        order = obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999
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

                    var updatedTask = new
                    {
                        id = taskId,
                        activityId = obj.TryGetProperty("activityId", out var actId) ? actId.GetString() : "",
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
                        completionDates = completionDates,
                        skipReasons = skipReasons,
                        skipUserNames = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes = completionTimes,
                        executorNames = executorNames,
                        order = obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999
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
        string importedActivityName = Path.GetFileNameWithoutExtension(excelFile.FileName); // הגדר ערך ברירת מחדל

        try
        {
            // שמור את הקובץ המועלה באופן זמני
            tempFilePath = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString() + Path.GetExtension(excelFile.FileName));
            using (var fileStream = new FileStream(tempFilePath, FileMode.Create))
            {
                await excelFile.CopyToAsync(fileStream);
            }

            // שימוש במחלקת העזר החדשה
            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
            {
                var workbook = helper.OpenWorkbook(tempFilePath);
                var worksheet = helper.GetWorksheet(1);

                // קריאת שם הפעילות מתא D1
                string activityNameFromExcel = worksheet.Cells[1, 4].Value?.ToString();
                if (!string.IsNullOrEmpty(activityNameFromExcel))
                {
                    importedActivityName = activityNameFromExcel;
                }

                // קריאת תאריך הפעילות אם קיים
                string activityDate = Request.Form["activityDate"];
                if (string.IsNullOrEmpty(activityDate))
                {
                    activityDate = DateTime.Now.ToString("yyyy-MM-dd");
                }
                
                // יצירת פעילות חדשה
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
                    id = activityId,
                    name = importedActivityName,
                    description = "יובא מקובץ אקסל",
                    activityDate = activityDate,
                    createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                    archived = false,
                    order = maxOrder + 1
                };

                activities.Add(newActivity);
                WriteActivitiesToFile(activities);

                // קריאת משימות מהאקסל (החל משורה 5)
                var allTasks = ReadActivityTasksFromFile();
                var usedRange = worksheet.UsedRange;
                int rowCount = usedRange.Rows.Count;
                int startRow = 5; // נתחיל מהשורה החמישית (אחרי כותרות)
                
                for (int row = startRow; row <= rowCount; row++)
                {
                    // בדוק אם יש תוכן בשורה
                    bool hasContent = false;
                    for (int col = 1; col <= 8; col++)
                    {
                        if (!string.IsNullOrEmpty(worksheet.Cells[row, col].Value?.ToString()))
                        {
                            hasContent = true;
                            break;
                        }
                    }
                    
                    if (!hasContent) continue;
                    
                    string day = worksheet.Cells[row, 1].Value?.ToString()?.Trim() ?? "";
                    string date = worksheet.Cells[row, 2].Value?.ToString()?.Trim() ?? "";
                    string time = worksheet.Cells[row, 3].Value?.ToString()?.Trim() ?? "";
                    string title = worksheet.Cells[row, 4].Value?.ToString()?.Trim() ?? "";
                    string responsible = worksheet.Cells[row, 5].Value?.ToString()?.Trim() ?? "";
                    string secondaryResponsible = worksheet.Cells[row, 6].Value?.ToString()?.Trim() ?? "";
                    string status = worksheet.Cells[row, 7].Value?.ToString()?.Trim() ?? "חדש";
                    string notes = worksheet.Cells[row, 8].Value?.ToString()?.Trim() ?? "";
                    
                    // אם אין כותרת, דלג על השורה
                    if (string.IsNullOrEmpty(title)) continue;
                    
                    // טיפול בשעה
                    string taskHour = "";
                    string taskMinute = "";
                    if (!string.IsNullOrEmpty(time))
                    {
                        try {
                            // בדוק אם הערך הוא מספר עשרוני (ייצוג של Excel לשעה)
                            double excelTimeValue;
                            if (double.TryParse(time.Replace(",", "."), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out excelTimeValue))
                            {
                                // המר את הערך העשרוני של Excel לשעה ודקות
                                // בפורמט Excel, 0.5 = 12:00, 0.25 = 06:00, וכו'
                                int totalMinutes = (int)Math.Round(excelTimeValue * 24 * 60);
                                int hours = totalMinutes / 60;
                                int minutes = totalMinutes % 60;
                                
                                taskHour = hours.ToString("00");
                                taskMinute = minutes.ToString("00");
                            }
                            else
                            {
                                // נקה את השעה מרווחים ותווים מיותרים
                                time = time.Replace(" ", "").Trim();
                                
                                // נסה לפרש כשעה בפורמטים שונים
                                if (time.Contains(":"))
                                {
                                    string[] timeParts = time.Split(':');
                                    if (timeParts.Length >= 2)
                                    {
                                        // נסה לפרש את החלקים כמספרים
                                        int hour, minute;
                                        if (int.TryParse(timeParts[0], out hour) && int.TryParse(timeParts[1], out minute))
                                        {
                                            taskHour = hour.ToString("00");
                                            taskMinute = minute.ToString("00");
                                        }
                                    }
                                }
                                else
                                {
                                    // נסה לפרש כתאריך/שעה מלא
                                    DateTime parsedTime;
                                    if (DateTime.TryParse(time, out parsedTime))
                                    {
                                        taskHour = parsedTime.Hour.ToString("00");
                                        taskMinute = parsedTime.Minute.ToString("00");
                                    }
                                }
                            }
                            
                            // הדפס לוג לצורך דיבוג
                            System.Diagnostics.Debug.WriteLine($"Parsed time: '{time}' to {taskHour}:{taskMinute}");
                        }
                        catch (Exception ex) {
                            // במקרה של שגיאה, השאר ריק ורשום לוג
                            taskHour = "";
                            taskMinute = "";
                            System.Diagnostics.Debug.WriteLine($"Error parsing time '{time}': {ex.Message}");
                        }
                    }

                    // טיפול בתאריך
                    string taskDate = "";
                    if (!string.IsNullOrEmpty(date))
                    {
                        try
                        {
                            // נסה לפרש את התאריך
                            DateTime parsedDate;
                            if (DateTime.TryParse(date, out parsedDate))
                            {
                                taskDate = parsedDate.ToString("yyyy-MM-dd");
                            }
                        }
                        catch { }
                    }
                    
                    // קביעת עדיפות לפי תוכן הכותרת או ההערות
                    string priority = "medium";
                    string titleLower = title.ToLower();
                    string notesLower = notes.ToLower();
                    
                    if (titleLower.Contains("דחוף") || titleLower.Contains("חשוב") || 
                        notesLower.Contains("דחוף") || notesLower.Contains("חשוב"))
                    {
                        priority = "high";
                    }
                    
                    var newTask = new
                    {
                        id = Guid.NewGuid().ToString(),
                        activityId = activityId,
                        title = title,
                        description = "",
                        priority = priority,
                        taskDate = taskDate,
                        taskHour = taskHour,
                        taskMinute = taskMinute,
                        responsiblePerson = responsible,
                        secondaryResponsible = secondaryResponsible,
                        status = status,
                        notes = notes,
                        createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completionDates = new List<string>(),
                        skipReasons = new Dictionary<string, string>(),
                        skipUserNames = new Dictionary<string, string>(),
                        order = row - startRow + 1 // סדר לפי מיקום בקובץ
                    };

                    allTasks.Add(newTask);
                }
                
                WriteActivityTasksToFile(allTasks);
            }

            return Json(new { 
                success = true, 
                activityId = activityId,
                activityName = importedActivityName
            });
        }
        catch (Exception ex)
        {
            return Json(new { 
                success = false, 
                error = $"שגיאה בעיבוד הקובץ: {ex.Message}" 
            });
        }
        finally
        {
            // מחיקת הקובץ הזמני
            if (tempFilePath != null && System.IO.File.Exists(tempFilePath))
            {
                try
                {
                    System.IO.File.Delete(tempFilePath);
                }
                catch { }
            }
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
            System.Diagnostics.Debug.WriteLine($"File write error: {ex.Message}");
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
            System.Diagnostics.Debug.WriteLine($"File write error: {ex.Message}");
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
                    order = obj.TryGetProperty("order", out var order) ? order.GetInt32() : 999999
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