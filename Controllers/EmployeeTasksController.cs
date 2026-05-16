using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.IO;
using System;
using System.Linq;
using System.Text.Json;

public class EmployeeTasksController : Controller
{
    private readonly EmployeeService _employeeService;
    private readonly UserTasksService _userTasksService; 
    private readonly string _employeeTasksFilePath;
    private static readonly object _fileLock = new object();
    private const int MaxRetries = 3;
    private const int RetryDelayMs = 100;

    public EmployeeTasksController(IWebHostEnvironment env)
    {
        _employeeService = new EmployeeService(env);
        _userTasksService = new UserTasksService();
        _employeeTasksFilePath = Path.Combine(env.WebRootPath, "assets", "files", "employee_tasks.txt");
    }

    [HttpGet]
    public IActionResult GetEmployees()
    {
        try
        {
            var employees = _employeeService.GetAllEmployees();
            return Ok(employees);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetEmployeeTasks(string employeeId, string date)
    {
        try
        {
            // Handle "All Employees" case OR select no Employees
            if (string.IsNullOrEmpty(employeeId) || employeeId == "ALL_EMPLOYEES")
            {
                var allTasks = ReadAllEmployeeTasksFromFile(date);
                return Json(new { tasks = allTasks });
            }
            
            // Validate that employee exists
            if (!_employeeService.EmployeeExists(employeeId))
            {
                return Json(new { error = "Employee not found" });
            }

            var tasks = ReadEmployeeTasksFromFile(employeeId, date);
            return Json(new { tasks = tasks });
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    // Read all employees' tasks
    private List<EmployeeTask> ReadAllEmployeeTasksFromFile(string currentDate)
    {
        var tasks = new List<EmployeeTask>();
        var lines = SafeReadFromFile();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                var task = JsonSerializer.Deserialize<EmployeeTask>(line);
                
                task.Completed = task.LastCompletedDate == currentDate;
                if (task.LastSkippedDate == currentDate)
                {
                    task.Completed = false;
                }
                else if (task.LastCompletedDate != currentDate)
                {
                    task.Completed = false;
                    task.CompletedTime = null;
                    task.SkipReason = null;
                }
                if (string.IsNullOrEmpty(task.CreatedAt))
                {
                    // השתמש בתאריך מהשדה StatusDate אם קיים, אחרת השתמש בתאריך נוכחי
                    task.CreatedAt = !string.IsNullOrEmpty(task.StatusDate) ? 
                        task.StatusDate : 
                        DateTime.Now.ToString("yyyy-MM-dd");
                }
                
                tasks.Add(task);
            }
            catch { continue; }
        }

        
        // Sort tasks: overdue first, then by employee, status, priority, and due date
        return tasks
            .OrderBy(t => t.EmployeeId)
            .ThenBy(t => IsTaskOverdue(t) ? 0 : 1) // Overdue tasks first within each employee
            .ThenBy(t => GetStatusOrder(t.Status))
            .ThenBy(t => t.Status == "בוצע" || t.Status == "מבוטלת" ? 0 : GetPriorityOrder(t.Priority))
            .ThenBy(t => t.Status == "בוצע" || t.Status == "מבוטלת" ? DateTime.MaxValue : ParseDueDate(t.DueDate))
            .ThenBy(t => t.Title)
            .ToList();
    }

    [HttpPost]
    public IActionResult UpdateTaskStatus([FromBody] UpdateTaskStatusRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.EmployeeId) || string.IsNullOrEmpty(request.TaskId))
            {
                return Json(new { success = false, error = "Employee ID and Task ID are required" });
            }

            var success = UpdateTaskStatusInFile(request);
            return Json(new { success = success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Update Task Progress endpoint
    [HttpPost]
    public IActionResult UpdateTaskProgress([FromBody] UpdateTaskProgressRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.EmployeeId) || string.IsNullOrEmpty(request.TaskId))
            {
                return Json(new { success = false, error = "Employee ID and Task ID are required" });
            }

            if (request.Progress < 0 || request.Progress > 100)
            {
                return Json(new { success = false, error = "Progress must be between 0 and 100" });
            }

            var success = UpdateTaskProgressInFile(request);
            return Json(new { success = success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // Helper method to check if task is overdue
    private bool IsTaskOverdue(EmployeeTask task)
    {
        // Task is overdue if:
        // 1. It has a due date
        // 2. Due date has passed
        // 3. Progress is not 100% (not completed)
        // 4. Status is not "בוצע" or "מבוטלת"
        
        if (string.IsNullOrEmpty(task.DueDate))
            return false;
        
        if (task.Progress >= 100)
            return false;
        
        if (task.Status == "בוצע" || task.Status == "מבוטלת")
            return false;
        
        if (DateTime.TryParse(task.DueDate, out DateTime dueDate))
        {
            return dueDate.Date < DateTime.Now.Date;
        }
        
        return false;
    }

    // Helper method to get status order
    private int GetStatusOrder(string status)
    {
        if (string.IsNullOrEmpty(status)) return 0;
        
        switch (status)
        {
            case "חדש":
                return 1;
            case "בביצוע":
                return 2;
            case "ממתין":
                return 3;
            case "בוצע":
                return 4;
            case "מבוטלת":
                return 5;
            default:
                return 0; // Unknown status goes first
        }
    }

    // Helper method to get priority order
    private int GetPriorityOrder(string priority)
    {
        if (priority == "high") return 1;
        if (priority == "medium") return 2;
        if (priority == "low") return 3;
        return 4;
    }

    // Helper method to parse due date
    private DateTime ParseDueDate(string dueDate)
    {
        if (string.IsNullOrEmpty(dueDate))
            return DateTime.MaxValue; // Tasks without due date go last
        
        if (DateTime.TryParse(dueDate, out DateTime parsedDate))
            return parsedDate;
        
        return DateTime.MaxValue;
    }
    
    private bool UpdateTaskProgressInFile(UpdateTaskProgressRequest request)
    {
        try
        {
            bool updated = false;
            
            SafeWriteToFile(lines =>
            {
                for (int i = 0; i < lines.Count; i++)
                {
                    if (string.IsNullOrWhiteSpace(lines[i])) continue;

                    try
                    {
                        var task = JsonSerializer.Deserialize<EmployeeTask>(lines[i]);
                        if (task.Id == request.TaskId && task.EmployeeId == request.EmployeeId)
                        {
                            task.Progress = request.Progress;
                            
                            if (request.Progress == 100)
                            {
                                task.Status = "בוצע";
                                task.Completed = true;
                                task.CompletedTime = DateTime.Now.ToString("HH:mm");
                                task.LastCompletedDate = request.Date;
                            }
                            else if (request.Progress > 0 && task.Status == "חדש")
                            {
                                task.Status = "בביצוע";
                            }

                            lines[i] = JsonSerializer.Serialize(task);
                            updated = true;
                            return;
                        }
                    }
                    catch { continue; }
                }
            });

            return updated;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error updating task progress: {ex.Message}");
        }
    }

    private List<EmployeeTask> ReadEmployeeTasksFromFile(string employeeId, string currentDate)
    {
        var tasks = new List<EmployeeTask>();
        var lines = SafeReadFromFile();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                var task = JsonSerializer.Deserialize<EmployeeTask>(line);
                
                if (task.EmployeeId == employeeId)
                {
                    task.Completed = task.LastCompletedDate == currentDate;
                    if (task.LastSkippedDate == currentDate)
                    {
                        task.Completed = false;
                    }
                    else if (task.LastCompletedDate != currentDate)
                    {
                        task.Completed = false;
                        task.CompletedTime = null;
                        task.SkipReason = null;
                    }
                    // הוסף תאריך יצירה אם חסר
                    if (string.IsNullOrEmpty(task.CreatedAt))
                    {
                        // השתמש בתאריך מהשדה StatusDate אם קיים, אחרת השתמש בתאריך נוכחי
                        task.CreatedAt = !string.IsNullOrEmpty(task.StatusDate) ? 
                            task.StatusDate : 
                            DateTime.Now.ToString("yyyy-MM-dd");
                    }
                    
                    tasks.Add(task);
                }
            }
            catch { continue; }
        }

        // Sort tasks: overdue first, then by status, priority, and due date
        return tasks
            .OrderBy(t => IsTaskOverdue(t) ? 0 : 1) // Overdue tasks first
            .ThenBy(t => GetStatusOrder(t.Status))
            .ThenBy(t => t.Status == "בוצע" || t.Status == "מבוטלת" ? 0 : GetPriorityOrder(t.Priority))
            .ThenBy(t => t.Status == "בוצע" || t.Status == "מבוטלת" ? DateTime.MaxValue : ParseDueDate(t.DueDate))
            .ThenBy(t => t.Title)
            .ToList();
    }

    private string ConvertDateFormat(string date)
    {
        try
        {
            if (DateTime.TryParse(date, out DateTime parsedDate))
            {
                return parsedDate.ToString("yyyy-MM-dd");
            }
        }
        catch { }
        
        return date;
    }

    [HttpPost]
    public IActionResult AddTask([FromBody] AddTaskRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.EmployeeId) || string.IsNullOrEmpty(request.Title))
            {
                return Json(new { success = false, error = "Employee ID and Title are required" });
            }

            var newTask = new EmployeeTask
            {
                Id = $"task_{request.EmployeeId}_{DateTime.Now.Ticks}",
                EmployeeId = request.EmployeeId,
                Title = request.Title,
                Description = request.Description,
                Priority = request.Priority ?? "medium",
                DueDate = request.DueDate,
                EstimatedTime = request.EstimatedTime,
                Completed = false,
                CompletedTime = null,
                SkipReason = null,
                LastCompletedDate = null,
                LastSkippedDate = null,
                CreatedAt = DateTime.Now.ToString("yyyy-MM-dd") 
            };

            var success = AddTaskToFile(newTask);
            return Json(new { success = success, taskId = newTask.Id });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult UpdateTask([FromBody] UpdateTaskRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.TaskId) || string.IsNullOrEmpty(request.Title))
            {
                return Json(new { success = false, error = "Task ID and Title are required" });
            }

            var success = UpdateTaskInFile(request);
            return Json(new { success = success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult DeleteTask([FromBody] DeleteTaskRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.TaskId))
            {
                return Json(new { success = false, error = "Task ID is required" });
            }

            var success = DeleteTaskFromFile(request.TaskId);
            return Json(new { success = success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

        private bool AddTaskToFile(EmployeeTask newTask)
    {
        try
        {
            lock (_fileLock)
            {
                var directory = Path.GetDirectoryName(_employeeTasksFilePath);
                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var taskJson = JsonSerializer.Serialize(newTask);
                
                using (var fileStream = new FileStream(_employeeTasksFilePath, 
                    FileMode.Append, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(fileStream))
                {
                    writer.WriteLine(taskJson);
                }
            }
            
            return true;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error adding task: {ex.Message}");
        }
    }

    
    private bool UpdateTaskInFile(UpdateTaskRequest request)
    {
        try
        {
            bool updated = false;
            
            SafeWriteToFile(lines =>
            {
                for (int i = 0; i < lines.Count; i++)
                {
                    if (string.IsNullOrWhiteSpace(lines[i])) continue;

                    try
                    {
                        var task = JsonSerializer.Deserialize<EmployeeTask>(lines[i]);
                        if (task.Id == request.TaskId)
                        {
                            task.Title = request.Title;
                            task.Description = request.Description;
                            task.Priority = request.Priority ?? task.Priority;
                            task.DueDate = request.DueDate; 
                            task.EstimatedTime = request.EstimatedTime;
                            
                            if (!string.IsNullOrEmpty(request.EmployeeId))
                            {
                                task.EmployeeId = request.EmployeeId;
                            }

                            // אם אין תאריך יצירה, נוסיף אותו
                            if (string.IsNullOrEmpty(task.CreatedAt))
                            {
                                task.CreatedAt = DateTime.Now.ToString("yyyy-MM-dd");
                            }
                                
                            lines[i] = JsonSerializer.Serialize(task);
                            updated = true;
                            return;
                        }
                    }
                    catch { continue; }
                }
            });

            return updated;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error updating task: {ex.Message}");
        }
    }


    private bool DeleteTaskFromFile(string taskId)
    {
        try
        {
            bool deleted = false;
            
            SafeWriteToFile(lines =>
            {
                var originalCount = lines.Count;
                lines.RemoveAll(line =>
                {
                    if (string.IsNullOrWhiteSpace(line)) return false;
                    try
                    {
                        var task = JsonSerializer.Deserialize<EmployeeTask>(line);
                        return task.Id == taskId;
                    }
                    catch { return false; }
                });
                
                deleted = lines.Count < originalCount;
            });

            return deleted;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error deleting task: {ex.Message}");
        }
    }

    private bool UpdateTaskStatusInFile(UpdateTaskStatusRequest request)
    {
        try
        {
            bool updated = false;
            
            SafeWriteToFile(lines =>
            {
                                for (int i = 0; i < lines.Count; i++)
                {
                    if (string.IsNullOrWhiteSpace(lines[i])) continue;

                    try
                    {
                        var task = JsonSerializer.Deserialize<EmployeeTask>(lines[i]);
                        
                        if (task.Id == request.TaskId && task.EmployeeId == request.EmployeeId)
                        {
                            if (!string.IsNullOrEmpty(request.Status))
                            {
                                task.Status = request.Status;
                                task.StatusDate = request.Date;
                                                            
                                if (request.Status == "בוצע")
                                {
                                    task.Completed = true;
                                    task.CompletedTime = request.CompletedTime ?? DateTime.Now.ToString("HH:mm");
                                    task.LastCompletedDate = request.Date;
                                    task.SkipReason = null;
                                }
                                else if (request.Status == "מבוטלת")
                                {
                                    task.Completed = false;
                                    task.CompletedTime = null;
                                    task.SkipReason = request.SkipReason ?? "מבוטלת";
                                    task.LastSkippedDate = request.Date;
                                }
                                else
                                {
                                    task.Completed = request.Completed;
                                    task.CompletedTime = request.CompletedTime;
                                    task.SkipReason = request.SkipReason;
                                }
                            }

                            lines[i] = JsonSerializer.Serialize(task);
                            updated = true;
                            return;
                        }
                    }
                    catch (JsonException) { continue; }
                }
            });

            return updated;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error updating task status: {ex.Message}");
        }
    }


    // שיטת עזר לכתיבה בטוחה לקובץ
    private bool SafeWriteToFile(Action<List<string>> writeAction)
    {
        lock (_fileLock)
        {
            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                try
                {
                    if (!System.IO.File.Exists(_employeeTasksFilePath))
                    {
                        var directory = Path.GetDirectoryName(_employeeTasksFilePath);
                        if (!Directory.Exists(directory))
                        {
                            Directory.CreateDirectory(directory);
                        }
                        System.IO.File.WriteAllText(_employeeTasksFilePath, "");
                    }

                    var lines = System.IO.File.ReadAllLines(_employeeTasksFilePath).ToList();
                    writeAction(lines);
                    
                    // כתיבה עם FileShare.None למניעת גישה במקביל
                    using (var fileStream = new FileStream(_employeeTasksFilePath, 
                        FileMode.Create, FileAccess.Write, FileShare.None))
                    using (var writer = new StreamWriter(fileStream))
                    {
                        foreach (var line in lines)
                        {
                            writer.WriteLine(line);
                        }
                    }
                    
                    return true;
                }
                catch (IOException ex) when (attempt < MaxRetries - 1)
                {
                    System.Threading.Thread.Sleep(RetryDelayMs * (attempt + 1));
                }
                catch (Exception ex)
                {
                    throw new Exception($"Error writing to file: {ex.Message}");
                }
            }
            return false;
        }
    }

    
    // שיטת עזר לקריאה בטוחה מהקובץ
    private List<string> SafeReadFromFile()
    {
        lock (_fileLock)
        {
            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                try
                {
                    if (!System.IO.File.Exists(_employeeTasksFilePath))
                    {
                        return new List<string>();
                    }

                    using (var fileStream = new FileStream(_employeeTasksFilePath, 
                        FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (var reader = new StreamReader(fileStream))
                    {
                        var lines = new List<string>();
                        string line;
                        while ((line = reader.ReadLine()) != null)
                        {
                            lines.Add(line);
                        }
                        return lines;
                    }
                }
                catch (IOException ex) when (attempt < MaxRetries - 1)
                {
                    System.Threading.Thread.Sleep(RetryDelayMs * (attempt + 1));
                }
            }
            return new List<string>();
        }
    }

    // ─── endpoint קבלת משימות אישיות ───
    [HttpGet]
    public IActionResult GetMyTasks(string date)
    {
        try
        {
            var username = GetCurrentUsername();
            if (string.IsNullOrEmpty(username))
                return Json(new { error = "Unauthorized" });

            var employeeId = GetCurrentEmployeeId();
            var tasks = _userTasksService.GetTasksByUsername(username);

            // עדכן Completed לפי תאריך (כמו בקוד הקיים)
            foreach (var task in tasks)
            {
                task.Completed = task.LastCompletedDate == date;
                if (task.LastSkippedDate == date)
                    task.Completed = false;
                else if (task.LastCompletedDate != date)
                {
                    task.Completed = false;
                    task.CompletedTime = null;
                    task.SkipReason = null;
                }
                if (string.IsNullOrEmpty(task.CreatedAt))
                    task.CreatedAt = DateTime.Now.ToString("yyyy-MM-dd");
            }

            return Json(new { tasks });
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    // ─── הוסף endpoint: הוספת משימה אישית ───
    [HttpPost]
    public IActionResult AddMyTask([FromBody] AddTaskRequest request)
    {
        try
        {
            var username = GetCurrentUsername();
            if (string.IsNullOrEmpty(username))
                return Json(new { success = false, error = "Unauthorized" });

            if (string.IsNullOrEmpty(request.Title))
                return Json(new { success = false, error = "Title is required" });

            var employeeId = GetCurrentEmployeeId();

            var newTask = new UserPersonalTask
            {
                Id = $"utask_{username}_{DateTime.Now.Ticks}",
                OwnerUsername = username,
                OwnerEmployeeId = employeeId,
                Title = request.Title,
                Description = request.Description,
                Priority = request.Priority ?? "medium",
                DueDate = request.DueDate,
                EstimatedTime = request.EstimatedTime,
                Completed = false,
                Status = "חדש",
                Progress = 0,
                CreatedAt = DateTime.Now.ToString("yyyy-MM-dd")
            };

            var success = _userTasksService.AddTask(newTask);
            return Json(new { success, taskId = newTask.Id });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── הוסף endpoint: עדכון משימה אישית ───
    [HttpPost]
    public IActionResult UpdateMyTask([FromBody] UpdateTaskRequest request)
    {
        try
        {
            var username = GetCurrentUsername();
            if (string.IsNullOrEmpty(username))
                return Json(new { success = false, error = "Unauthorized" });

            var success = _userTasksService.UpdateTask(
                request.TaskId, username, task =>
                {
                    task.Title = request.Title;
                    task.Description = request.Description;
                    task.Priority = request.Priority ?? task.Priority;
                    task.DueDate = request.DueDate;
                    task.EstimatedTime = request.EstimatedTime;
                });

            return Json(new { success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── הוסף endpoint: עדכון סטטוס משימה אישית ───
    [HttpPost]
    public IActionResult UpdateMyTaskStatus(
        [FromBody] UpdateTaskStatusRequest request)
    {
        try
        {
            var username = GetCurrentUsername();
            if (string.IsNullOrEmpty(username))
                return Json(new { success = false, error = "Unauthorized" });

            var success = _userTasksService.UpdateTask(
                request.TaskId, username, task =>
                {
                    if (!string.IsNullOrEmpty(request.Status))
                    {
                        task.Status = request.Status;
                        task.StatusDate = request.Date;

                        if (request.Status == "בוצע")
                        {
                            task.Completed = true;
                            task.CompletedTime = request.CompletedTime
                                ?? DateTime.Now.ToString("HH:mm");
                            task.LastCompletedDate = request.Date;
                            task.SkipReason = null;
                        }
                        else if (request.Status == "מבוטלת")
                        {
                            task.Completed = false;
                            task.CompletedTime = null;
                            task.SkipReason = request.SkipReason ?? "מבוטלת";
                            task.LastSkippedDate = request.Date;
                        }
                        else
                        {
                            task.Completed = request.Completed;
                            task.CompletedTime = request.CompletedTime;
                            task.SkipReason = request.SkipReason;
                        }
                    }
                });

            return Json(new { success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── הוסף endpoint: עדכון התקדמות משימה אישית ───
    [HttpPost]
    public IActionResult UpdateMyTaskProgress(
        [FromBody] UpdateTaskProgressRequest request)
    {
        try
        {
            var username = GetCurrentUsername();
            if (string.IsNullOrEmpty(username))
                return Json(new { success = false, error = "Unauthorized" });

            if (request.Progress < 0 || request.Progress > 100)
                return Json(new { success = false, 
                    error = "Progress must be between 0 and 100" });

            var success = _userTasksService.UpdateTask(
                request.TaskId, username, task =>
                {
                    task.Progress = request.Progress;
                    if (request.Progress == 100)
                    {
                        task.Status = "בוצע";
                        task.Completed = true;
                        task.CompletedTime = DateTime.Now.ToString("HH:mm");
                        task.LastCompletedDate = request.Date;
                    }
                    else if (request.Progress > 0 && task.Status == "חדש")
                    {
                        task.Status = "בביצוע";
                    }
                });

            return Json(new { success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── הוסף endpoint: מחיקת משימה אישית ───
    [HttpPost]
    public IActionResult DeleteMyTask([FromBody] DeleteTaskRequest request)
    {
        try
        {
            var username = GetCurrentUsername();
            if (string.IsNullOrEmpty(username))
                return Json(new { success = false, error = "Unauthorized" });

            var success = _userTasksService.DeleteTask(
                request.TaskId, username);
            return Json(new { success });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── הוסף endpoint: בדיקת הרשאות ───
    [HttpGet]
    public IActionResult GetMyPermissions()
    {
        try
        {
            var username = GetCurrentUsername();
            var role = GetCurrentRole();
            var employeeId = GetCurrentEmployeeId();

            bool isPrivileged = role == "Admin" || role == "NOC";

            return Json(new
            {
                username,
                role,
                employeeId,
                isPrivileged,   // ← NOC/Admin רואים הכל
                canManageAll = isPrivileged
            });
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    // ─── Helper methods לשליפת פרטי משתמש ───
    // *** שנה לפי המימוש שלך ב-Auth ***
    private string GetCurrentUsername()
    {
        // לפי המימוש שלך - User.Identity.Name או Claims
        return User?.Identity?.Name ?? 
               User?.FindFirst("username")?.Value ?? "";
    }

    private string GetCurrentRole()
    {
        return User?.FindFirst("role")?.Value ?? 
               User?.FindFirst(
                   System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    }

    private string GetCurrentEmployeeId()
    {
        // אם יש Claim של employeeId - השתמש בו
        // אחרת - חפש לפי username ב-EmployeeService
        var empIdClaim = User?.FindFirst("UserId")?.Value;
        if (!string.IsNullOrEmpty(empIdClaim)) return empIdClaim;

        var username = GetCurrentUsername();
        // נסה למצוא עובד לפי שם משתמש
        var employees = _employeeService.GetAllEmployees();
        var emp = employees.FirstOrDefault(e =>
            e.Name.Equals(username, 
                StringComparison.OrdinalIgnoreCase) ||
            e.Id.Equals(username, 
                StringComparison.OrdinalIgnoreCase));
        return emp?.Id ?? username;
    }
    
    [HttpPost]
    public IActionResult ImportTasksFromExcel([FromBody] ImportTasksFromExcelRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request.EmployeeId))
                return Json(new { success = false, error = "Employee ID is required" });

            // בדוק שהעובד הוא דני בירון
            var employee = _employeeService.GetEmployeeById(request.EmployeeId);
            if (employee == null)
                return Json(new { success = false, error = "Employee not found" });

            // קרא משימות קיימות
            var existingTasks = ReadEmployeeTasksFromFile(request.EmployeeId, 
                DateTime.Now.ToString("yyyy-MM-dd"));
            var existingTitles = existingTasks
                .Select(t => t.Title?.Trim().ToLower())
                .ToHashSet();

            int added = 0;
            int skipped = 0;
            var errors = new List<string>();

            foreach (var row in request.Tasks ?? new List<ExcelTaskRow>())
            {
                if (string.IsNullOrWhiteSpace(row.Title))
                {
                    skipped++;
                    continue;
                }

                // בדוק אם המשימה כבר קיימת
                if (existingTitles.Contains(row.Title.Trim().ToLower()))
                {
                    skipped++;
                    continue;
                }

                // קבע עדיפות
                string priority = "medium";
                if (!string.IsNullOrEmpty(row.Priority))
                {
                    var p = row.Priority.ToLower();
                    if (p.Contains("גבוה") || p.Contains("high")) priority = "high";
                    else if (p.Contains("נמוך") || p.Contains("low")) priority = "low";
                }

                // קבע סטטוס
                string status = "חדש";
                bool completed = false;
                string completedTime = null;
                string completedDate = null;

                if (!string.IsNullOrEmpty(row.Status))
                {
                    var s = row.Status.Trim();
                    if (s == "בוצע" || s.Contains("בוצע"))
                    {
                        status = "בוצע";
                        completed = true;
                        completedTime = "00:00";
                        completedDate = !string.IsNullOrEmpty(row.CompletedDate)
                            ? row.CompletedDate
                            : DateTime.Now.ToString("yyyy-MM-dd");
                    }
                    else if (s.Contains("ביצוע") || s.Contains("המשך"))
                        status = "בביצוע";
                    else if (s.Contains("בוטל"))
                        status = "מבוטלת";
                    else if (s.Contains("ממתין"))
                        status = "ממתין";
                }

                // קבע התקדמות
                int progress = 0;
                if (row.Progress.HasValue)
                {
                    // הJS כבר המיר את הערך לאחוזים (0-100)
                    // אין צורך לכפול שוב ב-100
                    progress = (int)Math.Round(row.Progress.Value);
                    progress = Math.Min(100, Math.Max(0, progress)); // הגבל לטווח 0-100
                }
                if (status == "בוצע") progress = 100;

                // בנה תיאור מלא
                string description = row.Description ?? "";
                if (!string.IsNullOrEmpty(row.Notes) && row.Notes != "NaN")
                    description += (string.IsNullOrEmpty(description) ? "" : "\n") 
                        + "הערות: " + row.Notes;

                // קבע תאריך יעד מתאריך הביצוע אם קיים
                string dueDate = null;
                if (!string.IsNullOrEmpty(row.CompletedDate))
                {
                    dueDate = row.CompletedDate; // ← תאריך ביצוע מהאקסל → תאריך יעד במשימה
                }

                var newTask = new EmployeeTask
                {
                    Id = $"task_{request.EmployeeId}_{DateTime.Now.Ticks}_{added}",
                    EmployeeId = request.EmployeeId,
                    Title = row.Title.Trim(),
                    Description = description,
                    Priority = priority,
                    Status = status,
                    Progress = progress,
                    Completed = completed,
                    CompletedTime = completedTime,
                    DueDate = dueDate,           // ← שורה חדשה!
                    LastCompletedDate = completedDate,
                    CreatedAt = DateTime.Now.ToString("yyyy-MM-dd")
                };

                try
                {
                    AddTaskToFile(newTask);
                    existingTitles.Add(row.Title.Trim().ToLower());
                    added++;
                }
                catch (Exception ex)
                {
                    errors.Add($"שגיאה בהוספת '{row.Title}': {ex.Message}");
                }
            }

            return Json(new
            {
                success = true,
                added,
                skipped,
                errors,
                message = $"נוספו {added} משימות, דולגו {skipped} (כבר קיימות או ריקות)"
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }
}


public class Employee
{
    public string Id { get; set; }
    public string Name { get; set; }
}

public class EmployeeTask
{
    public string Id { get; set; }
    public string EmployeeId { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string DueDate { get; set; }
    public string EstimatedTime { get; set; } 
    public bool Completed { get; set; }
    public string CompletedTime { get; set; }
    public string SkipReason { get; set; }
    public string LastCompletedDate { get; set; }
    public string LastSkippedDate { get; set; }
    public string Status { get; set; } = "חדש";
    public string StatusDate { get; set; }
    public int Progress { get; set; } = 0; 
    public string CreatedAt { get; set; }
}

public class UpdateTaskStatusRequest
{
    public string EmployeeId { get; set; }
    public string TaskId { get; set; }
    public string Date { get; set; }
    public bool Completed { get; set; }
    public string CompletedTime { get; set; }
    public string SkipReason { get; set; }
    public string Status { get; set; }
}

public class AddTaskRequest
{
    public string EmployeeId { get; set; }
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string DueDate { get; set; }
    public string EstimatedTime { get; set; }
    public int? Progress { get; set; } 
    public string CreatedAt { get; set; } 
}

public class UpdateTaskRequest
{
    public string TaskId { get; set; }
    public string EmployeeId { get; set; } 
    public string Title { get; set; }
    public string Description { get; set; }
    public string Priority { get; set; }
    public string DueDate { get; set; }
    public string EstimatedTime { get; set; }
    public int? Progress { get; set; } 
    public string CreatedAt { get; set; } 
}

public class DeleteTaskRequest
{
    public string TaskId { get; set; }
}

public class UpdateTaskProgressRequest
{
    public string EmployeeId { get; set; }
    public string TaskId { get; set; }
    public string Date { get; set; }
    public int Progress { get; set; }
}

public class ImportTasksFromExcelRequest
{
    public string EmployeeId { get; set; }
    public List<ExcelTaskRow> Tasks { get; set; }
}

public class ExcelTaskRow
{
    public string Title { get; set; }
    public string Description { get; set; }
    public string Status { get; set; }
    public string Priority { get; set; }
    public string Notes { get; set; }
    public string CompletedDate { get; set; }
    public double? Progress { get; set; }
}