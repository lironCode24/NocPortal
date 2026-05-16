using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;

public class DailyTasksController : Controller
{
    private readonly string _tasksFilePath;
    private readonly IWebHostEnvironment _env;

    public DailyTasksController(IWebHostEnvironment env)
    {
        _env = env;
        _tasksFilePath = Path.Combine(_env.ContentRootPath, "portal", "files", "daily_tasks.txt");
    }

    [HttpGet]
    public IActionResult GetTasks(string date)
    {
        try
        {

            if (!System.IO.File.Exists(_tasksFilePath))
            {
                return Json(new List<object>());
            }
            
            var allTasks = ReadAllTasksFromFile();
            
            // Filter out deleted tasks for dates on or after deletion date
            var filteredTasks = allTasks.Where(task =>
            {
                var taskJson = JsonSerializer.Serialize(task);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson);
                
                // Check if task is deleted
                bool isDeleted = taskObj.TryGetProperty("isDeleted", out var deletedProp) && deletedProp.GetBoolean();
                
                if (!isDeleted)
                {
                    return true;
                }
                
                if (!taskObj.TryGetProperty("deletionDate", out var deletionDateProp))
                {
                    return true;
                }
                
                try
                {
                    var requestDate = DateTime.Parse(date);
                    var taskDeletionDate = DateTime.Parse(deletionDateProp.GetString());
                    bool shouldInclude = requestDate < taskDeletionDate;
                    
                    return shouldInclude;
                }
                catch (Exception ex)
                {
                    return false;
                }
            })
            .OrderBy(task => 
            {
                var taskJson = JsonSerializer.Serialize(task);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson);
                
                // First sort by manual order if exists
                if (taskObj.TryGetProperty("manualOrder", out var orderProp) && 
                    orderProp.ValueKind == JsonValueKind.Number) 
                {
                    return orderProp.GetInt32();
                }
                return 999999;
            })
            .ThenBy(task =>
            {
                var taskJson = JsonSerializer.Serialize(task);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson);
                
                if (taskObj.TryGetProperty("taskHour", out var hourProp) && 
                    taskObj.TryGetProperty("taskMinute", out var minuteProp) &&
                    hourProp.ValueKind == JsonValueKind.String && 
                    minuteProp.ValueKind == JsonValueKind.String)
                {
                    try
                    {
                        string hourStr = hourProp.GetString();
                        string minuteStr = minuteProp.GetString();
                        
                        if (!string.IsNullOrEmpty(hourStr) && !string.IsNullOrEmpty(minuteStr))
                        {
                            int hour = int.Parse(hourStr);
                            int minute = int.Parse(minuteStr);
                            return hour * 60 + minute;
                        }
                    }
                    catch
                    {
                        return 999999;
                    }
                }
                return 999999;
            })
            .ToList();
            
            return Json(filteredTasks);
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult AddTask([FromBody] TaskRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Title) || string.IsNullOrEmpty(request.Date))
            {
                return Json(new { success = false, error = "כותרת ותאריך נדרשים" });
            }

            // Validate days of week
            if (request.DaysOfWeek == null || request.DaysOfWeek.Count == 0)
            {
                request.DaysOfWeek = new List<int> { 0, 1, 2, 3, 4, 5, 6 }; // Default: all days
            }

            var newTask = new
            {
                id = Guid.NewGuid().ToString(),
                title = request.Title,
                description = request.Description ?? "",
                priority = request.Priority ?? "medium",
                time = request.Time ?? "",
                taskHour = request.TaskHour ?? "",
                taskMinute = request.TaskMinute ?? "",
                completed = false,
                date = request.Date,
                createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                completedAt = (string)null,
                completionDates = new List<string>(),
                daysOfWeek = request.DaysOfWeek,
                enableAlarm = request.EnableAlarm 
            };

            var allTasks = ReadAllTasksFromFile();
            allTasks.Insert(0, newTask);

            WriteTasksToFile(allTasks);

            return Json(new { success = true, task = newTask });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPut]
    public IActionResult UpdateTask([FromBody] TaskUpdateRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Id))
            {
                return Json(new { success = false, error = "מזהה משימה נדרש" });
            }

            var allTasks = ReadAllTasksFromFile();
            
            for (int i = 0; i < allTasks.Count; i++)
            {
                var taskJson = JsonSerializer.Serialize(allTasks[i]);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson);
                
                string taskId = taskObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (taskId == request.Id)
                {
                    // Get existing data
                    var completionDates = new List<string>();
                    var skipReasons = new Dictionary<string, string>();
                    var skipUserNames = new Dictionary<string, string>();
                    var completedByEmployees = new Dictionary<string, string>();
                    var completionTimes = new Dictionary<string, string>();
                    var skipTimes = new Dictionary<string, string>();
                    var history = new List<TaskHistoryEntry>();

                    if (taskObj.TryGetProperty("completionDates", out var cdProp) && cdProp.ValueKind != JsonValueKind.Null)
                    {
                        try { completionDates = JsonSerializer.Deserialize<List<string>>(cdProp.GetRawText()); }
                        catch { completionDates = new List<string>(); }
                    }

                    if (taskObj.TryGetProperty("skipReasons", out var srProp) && srProp.ValueKind != JsonValueKind.Null)
                    {
                        try { skipReasons = JsonSerializer.Deserialize<Dictionary<string, string>>(srProp.GetRawText()); }
                        catch { skipReasons = new Dictionary<string, string>(); }
                    }

                    if (taskObj.TryGetProperty("skipUserNames", out var sunProp) && sunProp.ValueKind != JsonValueKind.Null)
                    {
                        try { skipUserNames = JsonSerializer.Deserialize<Dictionary<string, string>>(sunProp.GetRawText()); }
                        catch { skipUserNames = new Dictionary<string, string>(); }
                    }

                    if (taskObj.TryGetProperty("completedByEmployees", out var cbeProp) && cbeProp.ValueKind != JsonValueKind.Null)
                    {
                        try { completedByEmployees = JsonSerializer.Deserialize<Dictionary<string, string>>(cbeProp.GetRawText()); }
                        catch { completedByEmployees = new Dictionary<string, string>(); }
                    }

                    if (taskObj.TryGetProperty("completionTimes", out var ctProp) && ctProp.ValueKind != JsonValueKind.Null)
                    {
                        try { completionTimes = JsonSerializer.Deserialize<Dictionary<string, string>>(ctProp.GetRawText()); }
                        catch { completionTimes = new Dictionary<string, string>(); }
                    }

                    if (taskObj.TryGetProperty("skipTimes", out var stProp) && stProp.ValueKind != JsonValueKind.Null)
                    {
                        try { skipTimes = JsonSerializer.Deserialize<Dictionary<string, string>>(stProp.GetRawText()); }
                        catch { skipTimes = new Dictionary<string, string>(); }
                    }

                    // Load existing history
                    if (taskObj.TryGetProperty("history", out var histProp) && histProp.ValueKind != JsonValueKind.Null)
                    {
                        try { history = JsonSerializer.Deserialize<List<TaskHistoryEntry>>(histProp.GetRawText()); }
                        catch { history = new List<TaskHistoryEntry>(); }
                    }

                    // Track field changes for history
                    var fieldChanges = new List<(string field, string oldValue, string newValue)>();

                    string completionDate = request.CompletionDate ?? request.Date;
                    string now = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");

                    // Check title change
                    string oldTitle = taskObj.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : "";
                    if (!string.IsNullOrEmpty(request.Title) && request.Title != oldTitle)
                    {
                        fieldChanges.Add(("כותרת", oldTitle, request.Title));
                    }

                    // Check description change
                    string oldDescription = taskObj.TryGetProperty("description", out var descProp) ? descProp.GetString() : "";
                    string newDescription = request.Description ?? "";
                    if (newDescription != oldDescription)
                    {
                        fieldChanges.Add(("תיאור", 
                            string.IsNullOrEmpty(oldDescription) ? "ללא תיאור" : oldDescription, 
                            string.IsNullOrEmpty(newDescription) ? "ללא תיאור" : newDescription));
                    }

                    // Check priority change
                    string oldPriority = taskObj.TryGetProperty("priority", out var priorityProp) ? priorityProp.GetString() : "medium";
                    string newPriority = request.Priority ?? oldPriority;
                    if (newPriority != oldPriority)
                    {
                        var priorityLabels = new Dictionary<string, string>
                        {
                            { "high", "גבוהה" },
                            { "medium", "בינונית" },
                            { "low", "נמוכה" }
                        };
                        fieldChanges.Add(("עדיפות", 
                            priorityLabels.ContainsKey(oldPriority) ? priorityLabels[oldPriority] : oldPriority,
                            priorityLabels.ContainsKey(newPriority) ? priorityLabels[newPriority] : newPriority));
                    }

                    // Check time change
                    string oldTime = taskObj.TryGetProperty("time", out var timeProp) ? timeProp.GetString() : "";
                    string newTime = request.Time ?? "";
                    if (newTime != oldTime)
                    {
                        fieldChanges.Add(("זמן משוער", 
                            string.IsNullOrEmpty(oldTime) ? "ללא זמן" : oldTime,
                            string.IsNullOrEmpty(newTime) ? "ללא זמן" : newTime));
                    }

                    // Check scheduled time change
                    string oldHour = taskObj.TryGetProperty("taskHour", out var hourProp) ? hourProp.GetString() : "";
                    string oldMinute = taskObj.TryGetProperty("taskMinute", out var minuteProp) ? minuteProp.GetString() : "";
                    string newHour = request.TaskHour ?? "";
                    string newMinute = request.TaskMinute ?? "";

                    string oldScheduledTime = !string.IsNullOrEmpty(oldHour) && !string.IsNullOrEmpty(oldMinute) 
                        ? $"{oldHour}:{oldMinute}" : "";
                    string newScheduledTime = !string.IsNullOrEmpty(newHour) && !string.IsNullOrEmpty(newMinute) 
                        ? $"{newHour}:{newMinute}" : "";

                    if (oldScheduledTime != newScheduledTime)
                    {
                        fieldChanges.Add(("שעת ביצוע", 
                            string.IsNullOrEmpty(oldScheduledTime) ? "ללא שעה" : oldScheduledTime,
                            string.IsNullOrEmpty(newScheduledTime) ? "ללא שעה" : newScheduledTime));
                    }

                    // Check is Alarm change
                    bool oldEnableAlarm = taskObj.TryGetProperty("enableAlarm", out var enableAlarmProp) ? 
                        (enableAlarmProp.ValueKind == JsonValueKind.True) : true; // ברירת מחדל: מופעל
                    bool newEnableAlarm = request.EnableAlarm;

                    if (oldEnableAlarm != newEnableAlarm)
                    {
                        fieldChanges.Add(("התראה", 
                            oldEnableAlarm ? "מופעלת" : "כבויה",
                            newEnableAlarm ? "מופעלת" : "כבויה"));
                    }

                    // Check days of week change
                    var oldDaysOfWeek = taskObj.TryGetProperty("daysOfWeek", out var dowProp) && dowProp.ValueKind != JsonValueKind.Null 
                        ? JsonSerializer.Deserialize<List<int>>(dowProp.GetRawText()) 
                        : new List<int> { 0, 1, 2, 3, 4, 5, 6 };
                    var newDaysOfWeek = request.DaysOfWeek ?? oldDaysOfWeek;

                    if (!oldDaysOfWeek.SequenceEqual(newDaysOfWeek.OrderBy(x => x)))
                    {
                        var dayNames = new Dictionary<int, string>
                        {
                            { 0, "ראשון" }, { 1, "שני" }, { 2, "שלישי" }, { 3, "רביעי" },
                            { 4, "חמישי" }, { 5, "שישי" }, { 6, "שבת" }
                        };
                        
                        string oldDaysStr = string.Join(", ", oldDaysOfWeek.OrderBy(x => x).Select(d => dayNames[d]));
                        string newDaysStr = string.Join(", ", newDaysOfWeek.OrderBy(x => x).Select(d => dayNames[d]));
                        
                        fieldChanges.Add(("ימי ביצוע", oldDaysStr, newDaysStr));
                    }

                    // Add history entries for field changes
                    if (fieldChanges.Count > 0)
                    {
                        foreach (var change in fieldChanges)
                        {
                            history.Add(new TaskHistoryEntry
                            {
                                Timestamp = now,
                                TargetDate = completionDate ?? request.Date, 
                                Action = "עריכת משימה",
                                UserName = "משתמש",
                                Details = $"שדה '{change.field}' שונה",
                                PreviousValue = change.oldValue,
                                NewValue = change.newValue
                            });
                        }
                    }

                    var notesByDate = new Dictionary<string, List<TaskNote>>();

                    // Load existing notes BY DATE
                    if (taskObj.TryGetProperty("notesByDate", out var notesProp) && notesProp.ValueKind != JsonValueKind.Null)
                    {
                        try { notesByDate = JsonSerializer.Deserialize<Dictionary<string, List<TaskNote>>>(notesProp.GetRawText()); }
                        catch { notesByDate = new Dictionary<string, List<TaskNote>>(); }
                    }   
                    else if (taskObj.TryGetProperty("notes", out var oldNotesProp) && oldNotesProp.ValueKind != JsonValueKind.Null) // Backward compatibility: migrate old notes to current date
                    {
                        try 
                        { 
                            var oldNotes = JsonSerializer.Deserialize<List<TaskNote>>(oldNotesProp.GetRawText());
                            if (oldNotes != null && oldNotes.Count > 0)
                            {
                                // Migrate to current date
                                string migrationDate = request.CompletionDate ?? request.Date;
                                notesByDate[migrationDate] = oldNotes;
                            }
                        }
                        catch { notesByDate = new Dictionary<string, List<TaskNote>>(); }
                    }

                   // Handle adding note
                    if (!string.IsNullOrEmpty(request.NoteText))
                    {
                        if (!notesByDate.ContainsKey(completionDate))
                        {
                            notesByDate[completionDate] = new List<TaskNote>();
                        }

                        var newNote = new TaskNote
                        {
                            Text = request.NoteText,
                            UserName = request.NoteUserName ?? "לא ידוע",
                            Date = completionDate, 
                            Time = request.NoteTime ?? DateTime.Now.ToString("HH:mm")
                        };
                        
                        notesByDate[completionDate].Add(newNote);
                        
                        string noteTimestamp = completionDate + " " + DateTime.Now.ToString("HH:mm:ss");
                        
                        history.Add(new TaskHistoryEntry
                        {
                            Timestamp = noteTimestamp, 
                            TargetDate = completionDate,
                            Action = "הוספת הערה",
                            UserName = request.NoteUserName ?? "לא ידוע",
                            Details = $"הערה בתאריך {completionDate}: {request.NoteText}",
                            PreviousValue = "",
                            NewValue = request.NoteText
                        });
                    }

                    // Handle editing note
                    if (request.EditNoteIndex.HasValue && !string.IsNullOrEmpty(request.EditNoteText) && notesByDate.ContainsKey(completionDate))
                    {
                        var notesForDate = notesByDate[completionDate];
                        if (request.EditNoteIndex.Value >= 0 && request.EditNoteIndex.Value < notesForDate.Count)
                        {
                            var oldNote = notesForDate[request.EditNoteIndex.Value];
                            string previousText = oldNote.Text;
                            
                            oldNote.Text = request.EditNoteText;
                            
                            string editTimestamp = completionDate + " " + DateTime.Now.ToString("HH:mm:ss");
                            
                            history.Add(new TaskHistoryEntry
                            {
                                Timestamp = editTimestamp,
                                TargetDate = completionDate,
                                Action = "עריכת הערה",
                                UserName = request.EditNoteUserName ?? "משתמש",
                                Details = $"הערה נערכה בתאריך {completionDate}",
                                PreviousValue = previousText,
                                NewValue = request.EditNoteText
                            });
                        }
                    }
                    
                    // Handle deleting note
                    if (request.DeleteNoteIndex.HasValue && notesByDate.ContainsKey(completionDate))
                    {
                        var notesForDate = notesByDate[completionDate];
                        if (request.DeleteNoteIndex.Value >= 0 && request.DeleteNoteIndex.Value < notesForDate.Count)
                        {
                            var deletedNote = notesForDate[request.DeleteNoteIndex.Value];
                            notesForDate.RemoveAt(request.DeleteNoteIndex.Value);
                            
                            // Remove date key if no notes left
                            if (notesForDate.Count == 0)
                            {
                                notesByDate.Remove(completionDate);
                            }
                            
                            string deleteTimestamp = completionDate + " " + DateTime.Now.ToString("HH:mm:ss");

                            history.Add(new TaskHistoryEntry
                            {
                                Timestamp = deleteTimestamp, // ← שונה
                                TargetDate = completionDate,
                                Action = "מחיקת הערה",
                                UserName = "משתמש",
                                Details = $"הערה נמחקה מתאריך {completionDate}: {deletedNote.Text}",
                                PreviousValue = deletedNote.Text,
                                NewValue = ""
                            });
                        }
                    }

                    // Add history entry based on action
                    if (request.Completed)
                    {
                        // Task completed
                        if (!completionDates.Contains(completionDate))
                        {
                            completionDates.Add(completionDate);
                        }
                        
                        // תמיד להוסיף רישום היסטוריה בכל פעם שמסמנים משימה כהושלמה
                        history.Add(new TaskHistoryEntry
                        {
                            Timestamp = now,
                            TargetDate = completionDate,
                            Action = "הושלמה",
                            UserName = request.CompletedByEmployee ?? "לא ידוע",
                            Details = $"המשימה סומנה כהושלמה בתאריך {completionDate}",
                            PreviousValue = "לא בוצעה",
                            NewValue = "הושלמה"
                        });
                        
                        if (!string.IsNullOrEmpty(request.CompletedByEmployee))
                        {
                            completedByEmployees[completionDate] = request.CompletedByEmployee;
                        }
                        
                        if (!string.IsNullOrEmpty(request.CompletionTime))
                        {
                            completionTimes[completionDate] = request.CompletionTime;
                        }

                        // Clear skip reasons
                        if (skipReasons.ContainsKey(completionDate))
                        {
                            string previousReason = skipReasons[completionDate];
                            skipReasons.Remove(completionDate);
                            
                            history.Add(new TaskHistoryEntry
                            {
                                Timestamp = now,
                                TargetDate = completionDate,
                                Action = "ביטול סיבת אי-ביצוע",
                                UserName = request.CompletedByEmployee ?? "לא ידוע",
                                Details = $"סיבת אי-ביצוע קודמת בוטלה: {previousReason}",
                                PreviousValue = previousReason,
                                NewValue = ""
                            });
                        }
                        if (skipUserNames.ContainsKey(completionDate))
                        {
                            skipUserNames.Remove(completionDate);
                        }
                        if (skipTimes.ContainsKey(completionDate))
                        {
                            skipTimes.Remove(completionDate);
                        }
                    }
                    else if (!string.IsNullOrEmpty(request.SkipReason))
                    {
                        // Task skipped
                        string previousReason = skipReasons.ContainsKey(completionDate) ? skipReasons[completionDate] : "";
                        skipReasons[completionDate] = request.SkipReason;
                        
                        history.Add(new TaskHistoryEntry
                        {
                            Timestamp = now,
                            TargetDate = completionDate,
                            Action = "לא בוצעה",
                            UserName = request.SkipUserName ?? "לא ידוע",
                            Details = $"סיבה: {request.SkipReason}",
                            PreviousValue = previousReason,
                            NewValue = request.SkipReason
                        });
                        
                        if (!string.IsNullOrEmpty(request.SkipUserName))
                        {
                            skipUserNames[completionDate] = request.SkipUserName;
                        }
                        
                        if (!string.IsNullOrEmpty(request.SkipTime))
                        {
                            skipTimes[completionDate] = request.SkipTime;
                        }
                        
                        completionDates.Remove(completionDate);
                        completedByEmployees.Remove(completionDate);
                        completionTimes.Remove(completionDate);
                    }
                    else
                    {
                        // Status cancelled
                        bool wasCompleted = completionDates.Contains(completionDate);
                        bool wasSkipped = skipReasons.ContainsKey(completionDate);
                        
                        if (wasCompleted || wasSkipped)
                        {
                            history.Add(new TaskHistoryEntry
                            {
                                Timestamp = now,
                                TargetDate = completionDate,
                                Action = "ביטול סטטוס",
                                UserName = "משתמש",
                                Details = $"הסטטוס בוטל בתאריך {completionDate}",
                                PreviousValue = wasCompleted ? "הושלמה" : "לא בוצעה",
                                NewValue = "ממתינה"
                            });
                        }
                        
                        completionDates.Remove(completionDate);
                        skipReasons.Remove(completionDate);
                        skipUserNames.Remove(completionDate);
                        completedByEmployees.Remove(completionDate);
                        completionTimes.Remove(completionDate);
                        skipTimes.Remove(completionDate);
                    }

                    // Update the task
                    var updatedTask = new
                    {
                        id = request.Id,
                        title = request.Title ?? (taskObj.TryGetProperty("title", out var title) ? title.GetString() : ""),
                        description = request.Description ?? (taskObj.TryGetProperty("description", out var desc) ? desc.GetString() : ""),
                        priority = request.Priority ?? (taskObj.TryGetProperty("priority", out var priority) ? priority.GetString() : "medium"),
                        time = request.Time ?? (taskObj.TryGetProperty("time", out var time) ? time.GetString() : ""),
                        taskHour = request.TaskHour ?? (taskObj.TryGetProperty("taskHour", out var hour) ? hour.GetString() : ""),
                        taskMinute = request.TaskMinute ?? (taskObj.TryGetProperty("taskMinute", out var minute) ? minute.GetString() : ""),
                        completed = completionDates.Count > 0,
                        date = request.Date ?? (taskObj.TryGetProperty("date", out var date) ? date.GetString() : ""),
                        createdAt = taskObj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completedAt = completionDates.Count > 0 ? DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") : (string)null,
                        completionDates = completionDates,
                        skipReasons = skipReasons,
                        skipUserNames = skipUserNames,
                        completedByEmployees = completedByEmployees,
                        completionTimes = completionTimes,
                        skipTimes = skipTimes,
                        notesByDate = notesByDate,
                        history = history, 
                        enableAlarm = request.EnableAlarm,
                        manualOrder = taskObj.TryGetProperty("manualOrder", out var mo) && mo.ValueKind == JsonValueKind.Number ? (int?)mo.GetInt32() : null,
                        isDeleted = taskObj.TryGetProperty("isDeleted", out var deleted) && deleted.GetBoolean(),
                        deletionDate = taskObj.TryGetProperty("deletionDate", out var delDate) ? delDate.GetString() : null,
                        daysOfWeek = request.DaysOfWeek ?? (taskObj.TryGetProperty("daysOfWeek", out var dow) && dow.ValueKind != JsonValueKind.Null ? JsonSerializer.Deserialize<List<int>>(dow.GetRawText()) : new List<int> { 0, 1, 2, 3, 4, 5, 6 })
                    };
                    
                    allTasks[i] = updatedTask;
                    WriteTasksToFile(allTasks);
                    
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

    [HttpDelete]
    public IActionResult DeleteTask(string id)
    {
        try
        {
            var allTasks = ReadAllTasksFromFile();
            
            for (int i = 0; i < allTasks.Count; i++)
            {
                var taskJson = JsonSerializer.Serialize(allTasks[i]);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson); // ← Changed
                
                string taskId = taskObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (taskId == id)
                {
                    var notesByDate = new Dictionary<string, List<TaskNote>>();
                    if (taskObj.TryGetProperty("notesByDate", out var nbdProp) && nbdProp.ValueKind != JsonValueKind.Null)
                    {
                        try { notesByDate = JsonSerializer.Deserialize<Dictionary<string, List<TaskNote>>>(nbdProp.GetRawText()); }
                        catch { notesByDate = new Dictionary<string, List<TaskNote>>(); }
                    }
                    var updatedTask = new
                    {
                        id = taskId,
                        title = taskObj.TryGetProperty("title", out var title) ? title.GetString() : "",
                        description = taskObj.TryGetProperty("description", out var desc) ? desc.GetString() : "",
                        priority = taskObj.TryGetProperty("priority", out var priority) ? priority.GetString() : "medium",
                        time = taskObj.TryGetProperty("time", out var time) ? time.GetString() : "",
                        completed = taskObj.TryGetProperty("completed", out var comp) && comp.GetBoolean(),
                        date = taskObj.TryGetProperty("date", out var date) ? date.GetString() : "",
                        createdAt = taskObj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completedAt = taskObj.TryGetProperty("completedAt", out var compAt) ? compAt.GetString() : null,
                        completionDates = taskObj.TryGetProperty("completionDates", out var cd) ? JsonSerializer.Deserialize<List<string>>(cd.GetRawText()) : new List<string>(),
                        skipReasons = taskObj.TryGetProperty("skipReasons", out var sr) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sr.GetRawText()) : new Dictionary<string, string>(),
                        skipUserNames = taskObj.TryGetProperty("skipUserNames", out var sun) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sun.GetRawText()) : new Dictionary<string, string>(),
                        completedByEmployees = taskObj.TryGetProperty("completedByEmployees", out var cbe) ? JsonSerializer.Deserialize<Dictionary<string, string>>(cbe.GetRawText()) : new Dictionary<string, string>(), 
                        completionTimes = taskObj.TryGetProperty("completionTimes", out var ct) ? JsonSerializer.Deserialize<Dictionary<string, string>>(ct.GetRawText()) : new Dictionary<string, string>(),
                        skipTimes = taskObj.TryGetProperty("skipTimes", out var st) ? JsonSerializer.Deserialize<Dictionary<string, string>>(st.GetRawText()) : new Dictionary<string, string>(),
                        notesByDate = notesByDate,
                        taskMinute = taskObj.TryGetProperty("taskMinute", out var minute) ? minute.GetString() : "",
                        taskHour = taskObj.TryGetProperty("taskHour", out var hour) ? hour.GetString() : "",
                        manualOrder = taskObj.TryGetProperty("manualOrder", out var mo) && mo.ValueKind == JsonValueKind.Number ? (int?)mo.GetInt32() : null,
                        deletionDate = DateTime.Now.ToString("yyyy-MM-dd"),
                        isDeleted = true,
                        daysOfWeek = taskObj.TryGetProperty("daysOfWeek", out var dow) && dow.ValueKind != JsonValueKind.Null ? JsonSerializer.Deserialize<List<int>>(dow.GetRawText()) : new List<int> { 0, 1, 2, 3, 4, 5, 6 }
                    };
                    
                    allTasks[i] = updatedTask;
                    WriteTasksToFile(allTasks);
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

    [HttpPost]
    public IActionResult UpdateTaskOrder([FromBody] TaskOrderRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.Date) || request.TaskOrder == null)
            {
                return Json(new { success = false, error = "תאריך וסדר משימות נדרשים" });
            }

            var allTasks = ReadAllTasksFromFile();
            
            // Create a dictionary for quick lookup - handle duplicates
            var orderDict = new Dictionary<string, int>();
            foreach (var item in request.TaskOrder)
            {
                if (!orderDict.ContainsKey(item.Id))
                {
                    orderDict[item.Id] = item.Order;
                }
            }
            
            // Update manual order for each task
            for (int i = 0; i < allTasks.Count; i++)
            {
                var taskJson = JsonSerializer.Serialize(allTasks[i]);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson); // ← Changed from dynamic
                
                string taskId = taskObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (!string.IsNullOrEmpty(taskId) && orderDict.ContainsKey(taskId))
                {
                    var notesByDate = new Dictionary<string, List<TaskNote>>();
                    if (taskObj.TryGetProperty("notesByDate", out var nbdProp) && nbdProp.ValueKind != JsonValueKind.Null)
                    {
                        try { notesByDate = JsonSerializer.Deserialize<Dictionary<string, List<TaskNote>>>(nbdProp.GetRawText()); }
                        catch { notesByDate = new Dictionary<string, List<TaskNote>>(); }
                    }
                    var updatedTask = new
                    {
                        id = taskId,
                        title = taskObj.TryGetProperty("title", out var title) ? title.GetString() : "",
                        description = taskObj.TryGetProperty("description", out var desc) ? desc.GetString() : "",
                        priority = taskObj.TryGetProperty("priority", out var priority) ? priority.GetString() : "medium",
                        time = taskObj.TryGetProperty("time", out var time) ? time.GetString() : "",
                        taskHour = taskObj.TryGetProperty("taskHour", out var hour) ? hour.GetString() : "",
                        taskMinute = taskObj.TryGetProperty("taskMinute", out var minute) ? minute.GetString() : "",
                        completed = taskObj.TryGetProperty("completed", out var comp) && comp.GetBoolean(),
                        date = taskObj.TryGetProperty("date", out var date) ? date.GetString() : "",
                        createdAt = taskObj.TryGetProperty("createdAt", out var created) ? created.GetString() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                        completedAt = taskObj.TryGetProperty("completedAt", out var compAt) ? compAt.GetString() : null,
                        completionDates = taskObj.TryGetProperty("completionDates", out var cd) ? JsonSerializer.Deserialize<List<string>>(cd.GetRawText()) : new List<string>(),
                        skipReasons = taskObj.TryGetProperty("skipReasons", out var sr) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sr.GetRawText()) : new Dictionary<string, string>(),
                        skipUserNames = taskObj.TryGetProperty("skipUserNames", out var sun) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sun.GetRawText()) : new Dictionary<string, string>(),
                        completedByEmployees = taskObj.TryGetProperty("completedByEmployees", out var cbe) ? JsonSerializer.Deserialize<Dictionary<string, string>>(cbe.GetRawText()) : new Dictionary<string, string>(), 
                        manualOrder = orderDict[taskId], // Save manual order
                        isDeleted = taskObj.TryGetProperty("isDeleted", out var deleted) && deleted.GetBoolean(),
                        deletionDate = taskObj.TryGetProperty("deletionDate", out var delDate) ? delDate.GetString() : null,
                        daysOfWeek = taskObj.TryGetProperty("daysOfWeek", out var dow) && dow.ValueKind != JsonValueKind.Null ? JsonSerializer.Deserialize<List<int>>(dow.GetRawText()) : new List<int> { 0, 1, 2, 3, 4, 5, 6 }
                    };
                    
                    allTasks[i] = updatedTask;
                }
            }
            
            WriteTasksToFile(allTasks);
            
            return Json(new { success = true });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetPendingAlarms(string date, string time)
    {
        try
        {
            if (string.IsNullOrEmpty(date) || string.IsNullOrEmpty(time))
            {
                return Json(new { success = false, error = "Date and time are required" });
            }

            // Parse current time
            var timeParts = time.Split(':');
            if (timeParts.Length != 2)
            {
                return Json(new { success = false, error = "Invalid time format" });
            }

            int currentHour = int.Parse(timeParts[0]);
            int currentMinute = int.Parse(timeParts[1]);
            
            // Calculate current time in minutes since midnight
            int currentTimeInMinutes = currentHour * 60 + currentMinute;
            
            // Calculate time window (current time + 10 minutes)
            int timeWindowEnd = currentTimeInMinutes + 10;

            var allTasks = ReadAllTasksFromFile();
            var pendingAlarms = new List<object>();

            foreach (var task in allTasks)
            {
                var taskJson = JsonSerializer.Serialize(task);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson);
                
                // Check if task is deleted
                bool isDeleted = taskObj.TryGetProperty("isDeleted", out var deletedProp) && deletedProp.GetBoolean();
                if (isDeleted)
                {
                    // Check if deletion date is before or equal to the current date
                    if (taskObj.TryGetProperty("deletionDate", out var deletionDateProp))
                    {
                        string deletionDate = deletionDateProp.GetString();
                        if (!string.IsNullOrEmpty(deletionDate) && string.Compare(deletionDate, date) <= 0)
                        {
                            // Task was deleted on or before the current date, skip it
                            continue;
                        }
                    }
                    else
                    {
                        // If deletionDate is not specified but task is marked as deleted, skip it
                        continue;
                    }
                }
                
                // Check if task has execution time
                if (!taskObj.TryGetProperty("taskHour", out var hourProp) || 
                    !taskObj.TryGetProperty("taskMinute", out var minuteProp))
                    continue;
                // בדוק אם התראות מופעלות למשימה זו
                bool alarmsEnabled = !taskObj.TryGetProperty("enableAlarm", out var enableAlarmProp) || enableAlarmProp.GetBoolean();
                if (!alarmsEnabled)
                    continue;
                    
                string taskHourStr = hourProp.GetString();
                string taskMinuteStr = minuteProp.GetString();
                
                if (string.IsNullOrEmpty(taskHourStr) || string.IsNullOrEmpty(taskMinuteStr))
                    continue;
                
                // Parse task time
                if (!int.TryParse(taskHourStr, out int taskHour) || !int.TryParse(taskMinuteStr, out int taskMinute))
                    continue;
                    
                // Calculate task time in minutes since midnight
                int taskTimeInMinutes = taskHour * 60 + taskMinute;
                
                // Check if task time is within the next 10 minutes
                // (current time <= task time < current time + 10 minutes)
                bool isTimeInWindow = (taskTimeInMinutes >= currentTimeInMinutes && taskTimeInMinutes < timeWindowEnd);
                
                if (!isTimeInWindow)
                    continue;
                    
                // Check if task is relevant for today
                bool isRelevantForToday = true;
                if (taskObj.TryGetProperty("daysOfWeek", out var dowProp) && dowProp.ValueKind != JsonValueKind.Null)
                {
                    var daysOfWeek = JsonSerializer.Deserialize<List<int>>(dowProp.GetRawText());
                    var requestDate = DateTime.Parse(date);
                    int dayOfWeek = (int)requestDate.DayOfWeek;
                    
                    isRelevantForToday = daysOfWeek.Contains(dayOfWeek);
                }
                
                if (!isRelevantForToday)
                    continue;
                    
                // Check if task is already completed for today
                bool isCompleted = false;
                if (taskObj.TryGetProperty("completionDates", out var cdProp) && cdProp.ValueKind != JsonValueKind.Null)
                {
                    var completionDates = JsonSerializer.Deserialize<List<string>>(cdProp.GetRawText());
                    isCompleted = completionDates.Contains(date);
                }
                
                if (isCompleted)
                    continue;
                    
                // Check if task is skipped for today
                bool isSkipped = false;
                if (taskObj.TryGetProperty("skipReasons", out var srProp) && srProp.ValueKind != JsonValueKind.Null)
                {
                    var skipReasons = JsonSerializer.Deserialize<Dictionary<string, string>>(srProp.GetRawText());
                    isSkipped = skipReasons.ContainsKey(date);
                }
                
                if (isSkipped)
                    continue;
                    
                // Add to pending alarms
                pendingAlarms.Add(new
                {
                    taskId = taskObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : "",
                    title = taskObj.TryGetProperty("title", out var titleProp) ? titleProp.GetString() : "",
                    description = taskObj.TryGetProperty("description", out var descProp) ? descProp.GetString() : "",
                    executionTime = $"{taskHourStr}:{taskMinuteStr}",
                    date = date,
                    isDeleted = isDeleted // Add this flag to inform the client
                });
            }
            
            return Json(new { success = true, alarms = pendingAlarms });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetTaskById(string id)
    {
        try
        {
            if (string.IsNullOrEmpty(id))
            {
                return Json(new { success = false, error = "Task ID is required" });
            }

            var allTasks = ReadAllTasksFromFile();
            
            foreach (var task in allTasks)
            {
                var taskJson = JsonSerializer.Serialize(task);
                var taskObj = JsonSerializer.Deserialize<JsonElement>(taskJson);
                
                string taskId = taskObj.TryGetProperty("id", out var idProp) ? idProp.GetString() : null;
                
                if (taskId == id)
                {
                    // Check if task is deleted
                    bool isDeleted = taskObj.TryGetProperty("isDeleted", out var deletedProp) && deletedProp.GetBoolean();
                    
                    // Return the task with deletion status
                    return Json(new { 
                        success = true, 
                        task = task,
                        isDeleted = isDeleted
                    });
                }
            }
            
            return Json(new { success = false, error = "Task not found" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    private List<object> ReadAllTasksFromFile()
    {
        var tasks = new List<object>();

        if (!System.IO.File.Exists(_tasksFilePath))
        {
            return tasks;
        }

        try
        {
            using (var fileStream = new FileStream(_tasksFilePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var reader = new StreamReader(fileStream))
            {
                string line;
                int lineNumber = 0;
                while ((line = reader.ReadLine()) != null)
                {
                    lineNumber++;
                    if (string.IsNullOrWhiteSpace(line))
                    {
                        continue;
                    }

                    try
                    {
                        // Parse as JsonElement first
                        var taskObj = JsonSerializer.Deserialize<JsonElement>(line);
                        
                        // Helper function to safely get boolean (handles null)
                        bool GetBooleanSafe(JsonElement element, string propertyName)
                        {
                            if (!element.TryGetProperty(propertyName, out var prop))
                                return false;
                            
                            if (prop.ValueKind == JsonValueKind.Null)
                                return false;
                            
                            if (prop.ValueKind == JsonValueKind.True)
                                return true;
                            
                            if (prop.ValueKind == JsonValueKind.False)
                                return false;
                            
                            // Try to parse as string "true"/"false"
                            if (prop.ValueKind == JsonValueKind.String)
                            {
                                return bool.TryParse(prop.GetString(), out var result) && result;
                            }
                            
                            return false;
                        }
                        
                        // Helper function to safely get string (handles null)
                        string GetStringSafe(JsonElement element, string propertyName)
                        {
                            if (!element.TryGetProperty(propertyName, out var prop))
                                return null;
                            
                            if (prop.ValueKind == JsonValueKind.Null)
                                return null;
                            
                            return prop.GetString();
                        }
                        
                        
                        var notesByDate = new Dictionary<string, List<TaskNote>>();
                        
                        if (taskObj.TryGetProperty("notesByDate", out var nbdProp) && nbdProp.ValueKind != JsonValueKind.Null)
                        {
                            try { notesByDate = JsonSerializer.Deserialize<Dictionary<string, List<TaskNote>>>(nbdProp.GetRawText()); }
                            catch { notesByDate = new Dictionary<string, List<TaskNote>>(); }
                        }
                        // Backward compatibility
                        else if (taskObj.TryGetProperty("notes", out var oldNotesProp) && oldNotesProp.ValueKind != JsonValueKind.Null)
                        {
                            try 
                            { 
                                var oldNotes = JsonSerializer.Deserialize<List<TaskNote>>(oldNotesProp.GetRawText());
                                if (oldNotes != null && oldNotes.Count > 0)
                                {
                                    string taskDate = GetStringSafe(taskObj, "date");
                                    if (!string.IsNullOrEmpty(taskDate))
                                    {
                                        notesByDate[taskDate] = oldNotes;
                                    }
                                }
                            }
                            catch { notesByDate = new Dictionary<string, List<TaskNote>>(); }
                        }

                        // Check if completionDates exists
                        bool hasCompletionDates = taskObj.TryGetProperty("completionDates", out var _);
                        
                        if (!hasCompletionDates)
                        {
                            // Handle backward compatibility
                            var completionDates = new List<string>();
                            
                            string completionDate = GetStringSafe(taskObj, "completionDate");
                            if (!string.IsNullOrEmpty(completionDate))
                            {
                                completionDates.Add(completionDate);
                            }
                            else if (GetBooleanSafe(taskObj, "completed"))
                            {
                                string taskDate = GetStringSafe(taskObj, "date");
                                if (!string.IsNullOrEmpty(taskDate))
                                {
                                    completionDates.Add(taskDate);
                                }
                            }

                            var updatedTask = new
                            {
                                id = GetStringSafe(taskObj, "id"),
                                title = GetStringSafe(taskObj, "title"),
                                description = GetStringSafe(taskObj, "description") ?? "",
                                priority = GetStringSafe(taskObj, "priority") ?? "medium",
                                time = GetStringSafe(taskObj, "time") ?? "",
                                taskHour = GetStringSafe(taskObj, "taskHour") ?? "",
                                taskMinute = GetStringSafe(taskObj, "taskMinute") ?? "",
                                completed = GetBooleanSafe(taskObj, "completed"),
                                date = GetStringSafe(taskObj, "date"),
                                createdAt = GetStringSafe(taskObj, "createdAt"),
                                completedAt = GetStringSafe(taskObj, "completedAt"),
                                completionDates = completionDates,
                                isDeleted = GetBooleanSafe(taskObj, "isDeleted"),
                                deletionDate = GetStringSafe(taskObj, "deletionDate"),
                                manualOrder = taskObj.TryGetProperty("manualOrder", out var mo) && mo.ValueKind == JsonValueKind.Number ? (int?)mo.GetInt32() : null,
                                skipReasons = taskObj.TryGetProperty("skipReasons", out var sr) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sr.GetRawText()) : new Dictionary<string, string>(),
                                skipUserNames = taskObj.TryGetProperty("skipUserNames", out var sun) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sun.GetRawText()) : new Dictionary<string, string>(),
                                completedByEmployees = taskObj.TryGetProperty("completedByEmployees", out var cbe) ? JsonSerializer.Deserialize<Dictionary<string, string>>(cbe.GetRawText()) : new Dictionary<string, string>(),
                                completionTimes = taskObj.TryGetProperty("completionTimes", out var ct) ? JsonSerializer.Deserialize<Dictionary<string, string>>(ct.GetRawText()) : new Dictionary<string, string>(),
                                skipTimes = taskObj.TryGetProperty("skipTimes", out var st) ? JsonSerializer.Deserialize<Dictionary<string, string>>(st.GetRawText()) : new Dictionary<string, string>(),
                                notesByDate = notesByDate, 
                                history = taskObj.TryGetProperty("history", out var hist) ? JsonSerializer.Deserialize<List<TaskHistoryEntry>>(hist.GetRawText()) : new List<TaskHistoryEntry>(),
                                daysOfWeek = taskObj.TryGetProperty("daysOfWeek", out var dow) && dow.ValueKind != JsonValueKind.Null ? JsonSerializer.Deserialize<List<int>>(dow.GetRawText()) : new List<int> { 0, 1, 2, 3, 4, 5, 6 },
                                enableAlarm = GetBooleanSafe(taskObj, "enableAlarm")
                            };
                            tasks.Add(updatedTask);
                        }
                        else
                        {
                            var normalizedTask = new
                            {
                                id = GetStringSafe(taskObj, "id"),
                                title = GetStringSafe(taskObj, "title"),
                                description = GetStringSafe(taskObj, "description") ?? "",
                                priority = GetStringSafe(taskObj, "priority") ?? "medium",
                                time = GetStringSafe(taskObj, "time") ?? "",
                                taskHour = GetStringSafe(taskObj, "taskHour") ?? "",
                                taskMinute = GetStringSafe(taskObj, "taskMinute") ?? "",
                                completed = GetBooleanSafe(taskObj, "completed"),
                                date = GetStringSafe(taskObj, "date"),
                                createdAt = GetStringSafe(taskObj, "createdAt"),
                                completedAt = GetStringSafe(taskObj, "completedAt"),
                                completionDates = taskObj.TryGetProperty("completionDates", out var cd) ? JsonSerializer.Deserialize<List<string>>(cd.GetRawText()) : new List<string>(),
                                isDeleted = GetBooleanSafe(taskObj, "isDeleted"),
                                deletionDate = GetStringSafe(taskObj, "deletionDate"),
                                manualOrder = taskObj.TryGetProperty("manualOrder", out var mo) && mo.ValueKind == JsonValueKind.Number ? (int?)mo.GetInt32() : null,
                                skipReasons = taskObj.TryGetProperty("skipReasons", out var sr) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sr.GetRawText()) : new Dictionary<string, string>(),
                                skipUserNames = taskObj.TryGetProperty("skipUserNames", out var sun) ? JsonSerializer.Deserialize<Dictionary<string, string>>(sun.GetRawText()) : new Dictionary<string, string>(),
                                completedByEmployees = taskObj.TryGetProperty("completedByEmployees", out var cbe) ? JsonSerializer.Deserialize<Dictionary<string, string>>(cbe.GetRawText()) : new Dictionary<string, string>(),
                                completionTimes = taskObj.TryGetProperty("completionTimes", out var ct) ? JsonSerializer.Deserialize<Dictionary<string, string>>(ct.GetRawText()) : new Dictionary<string, string>(),
                                skipTimes = taskObj.TryGetProperty("skipTimes", out var st) ? JsonSerializer.Deserialize<Dictionary<string, string>>(st.GetRawText()) : new Dictionary<string, string>(),
                                notesByDate = notesByDate, 
                                history = taskObj.TryGetProperty("history", out var hist) ? JsonSerializer.Deserialize<List<TaskHistoryEntry>>(hist.GetRawText()) : new List<TaskHistoryEntry>(),
                                daysOfWeek = taskObj.TryGetProperty("daysOfWeek", out var dow) && dow.ValueKind != JsonValueKind.Null ? JsonSerializer.Deserialize<List<int>>(dow.GetRawText()) : new List<int> { 0, 1, 2, 3, 4, 5, 6 },
                                enableAlarm = GetBooleanSafe(taskObj, "enableAlarm")
                            };
                            tasks.Add(normalizedTask);
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Line {lineNumber}: Error: {ex.Message}");
                    }
                }
            }
            
        }
        catch (Exception ex)
        {
            Console.WriteLine($"ReadAllTasksFromFile: ERROR: {ex.Message}");
        }

        return tasks;
    }

    private void WriteTasksToFile(List<object> tasks)
    {
        try
        {
            var directory = Path.GetDirectoryName(_tasksFilePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var lines = tasks.Select(t => JsonSerializer.Serialize(t)).ToArray();
            
            try
            {
                using (var fileStream = new FileStream(_tasksFilePath, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(fileStream))
                {
                    foreach (var line in lines)
                    {
                        writer.WriteLine(line);
                    }
                    writer.Flush();
                }
            }
            catch (IOException)
            {
                var tempFile = _tasksFilePath + ".tmp";
                using (var fileStream = new FileStream(tempFile, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(fileStream))
                {
                    foreach (var line in lines)
                    {
                        writer.WriteLine(line);
                    }
                    writer.Flush();
                }
                
                if (System.IO.File.Exists(_tasksFilePath))
                {
                    System.IO.File.Delete(_tasksFilePath);
                }
                System.IO.File.Move(tempFile, _tasksFilePath);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"File write warning: {ex.Message}");
        }
    }
}

public class TaskRequest
{
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string Time { get; set; }
    public string Date { get; set; }
    public string TaskHour { get; set; }
    public string TaskMinute { get; set; }
    public List<int> DaysOfWeek { get; set; }
    public bool EnableAlarm { get; set; }
}

public class TaskUpdateRequest
{
    public string Id { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string Time { get; set; }
    public bool Completed { get; set; }
    public string Date { get; set; }
    public string CompletionDate { get; set; }
    public string SkipReason { get; set; }
    public string SkipUserName { get; set; } 
    public string TaskHour { get; set; }
    public string TaskMinute { get; set; }
    public string CompletedByEmployee { get; set; }
    public string CompletionTime { get; set; }
    public string SkipTime { get; set; }
    public string NoteText { get; set; }
    public string NoteUserName { get; set; }
    public string NoteDate { get; set; }
    public string NoteTime { get; set; }
    public int? DeleteNoteIndex { get; set; }
    public int? EditNoteIndex { get; set; }
    public string EditNoteText { get; set; }
    public string EditNoteUserName { get; set; }
    public List<int> DaysOfWeek { get; set; }
    public bool EnableAlarm { get; set; }
}

public class TaskOrderRequest
{
    public string Date { get; set; }
    public List<TaskOrderItem> TaskOrder { get; set; }
}

public class TaskOrderItem
{
    public string Id { get; set; }
    public int Order { get; set; }
}

public class TaskHistoryEntry
{
    public string Timestamp { get; set; }
    public string Action { get; set; }
    public string UserName { get; set; }
    public string Details { get; set; }
    public string PreviousValue { get; set; }
    public string NewValue { get; set; }
    public string TargetDate { get; set; }
}

public class TaskNote
{
    public string Text { get; set; }
    public string UserName { get; set; }
    public string Date { get; set; }
    public string Time { get; set; }
}