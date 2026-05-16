// file: UserTasksService.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

public class UserTasksService
{
    private readonly string _userTasksFilePath;
    private static readonly object _fileLock = new object();
    private const int MaxRetries = 3;
    private const int RetryDelayMs = 100;

    public UserTasksService()
    {
        _userTasksFilePath = Path.Combine(
            Directory.GetCurrentDirectory(), "portal", "files", "user_personal_tasks.txt");
    }

    public List<EmployeeTask> GetTasksByUsername(string username)
    {
        var tasks = new List<EmployeeTask>();
        var lines = SafeReadFromFile();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var task = JsonSerializer.Deserialize<UserPersonalTask>(line);
                // רק משימות של המשתמש הזה
                if (task?.OwnerUsername?.Equals(
                    username, 
                    StringComparison.OrdinalIgnoreCase) == true)
                {
                    tasks.Add(task.ToEmployeeTask());
                }
            }
            catch { continue; }
        }
        return tasks;
    }

    public bool AddTask(UserPersonalTask task)
    {
        try
        {
            lock (_fileLock)
            {
                EnsureFileExists();
                var json = JsonSerializer.Serialize(task);
                using var fs = new FileStream(
                    _userTasksFilePath,
                    FileMode.Append, FileAccess.Write, FileShare.None);
                using var writer = new StreamWriter(fs);
                writer.WriteLine(json);
            }
            return true;
        }
        catch (Exception ex)
        {
            throw new Exception($"Error adding user task: {ex.Message}");
        }
    }

    public bool UpdateTask(string taskId, string ownerUsername, 
        Action<UserPersonalTask> updateAction)
    {
        bool updated = false;
        SafeWriteToFile(lines =>
        {
            for (int i = 0; i < lines.Count; i++)
            {
                if (string.IsNullOrWhiteSpace(lines[i])) continue;
                try
                {
                    var task = JsonSerializer.Deserialize<UserPersonalTask>(lines[i]);
                    // וידוא שהמשתמש הוא הבעלים
                    if (task?.Id == taskId &&
                        task.OwnerUsername?.Equals(
                            ownerUsername,
                            StringComparison.OrdinalIgnoreCase) == true)
                    {
                        updateAction(task);
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

    public bool DeleteTask(string taskId, string ownerUsername)
    {
        bool deleted = false;
        SafeWriteToFile(lines =>
        {
            var original = lines.Count;
            lines.RemoveAll(line =>
            {
                if (string.IsNullOrWhiteSpace(line)) return false;
                try
                {
                    var task = JsonSerializer.Deserialize<UserPersonalTask>(line);
                    // מחיקה רק אם הבעלים תואם
                    return task?.Id == taskId &&
                           task.OwnerUsername?.Equals(
                               ownerUsername,
                               StringComparison.OrdinalIgnoreCase) == true;
                }
                catch { return false; }
            });
            deleted = lines.Count < original;
        });
        return deleted;
    }

    private void EnsureFileExists()
    {
        if (!File.Exists(_userTasksFilePath))
        {
            var dir = Path.GetDirectoryName(_userTasksFilePath);
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            File.WriteAllText(_userTasksFilePath, "");
        }
    }

    private List<string> SafeReadFromFile()
    {
        lock (_fileLock)
        {
            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                try
                {
                    if (!File.Exists(_userTasksFilePath))
                        return new List<string>();

                    using var fs = new FileStream(
                        _userTasksFilePath,
                        FileMode.Open, FileAccess.Read, FileShare.Read);
                    using var reader = new StreamReader(fs);
                    var lines = new List<string>();
                    string line;
                    while ((line = reader.ReadLine()) != null)
                        lines.Add(line);
                    return lines;
                }
                catch (IOException) when (attempt < MaxRetries - 1)
                {
                    System.Threading.Thread.Sleep(RetryDelayMs * (attempt + 1));
                }
            }
            return new List<string>();
        }
    }

    private void SafeWriteToFile(Action<List<string>> writeAction)
    {
        lock (_fileLock)
        {
            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                try
                {
                    EnsureFileExists();
                    var lines = File.ReadAllLines(_userTasksFilePath).ToList();
                    writeAction(lines);

                    using var fs = new FileStream(
                        _userTasksFilePath,
                        FileMode.Create, FileAccess.Write, FileShare.None);
                    using var writer = new StreamWriter(fs);
                    foreach (var line in lines)
                        writer.WriteLine(line);
                    return;
                }
                catch (IOException) when (attempt < MaxRetries - 1)
                {
                    System.Threading.Thread.Sleep(RetryDelayMs * (attempt + 1));
                }
                catch (Exception ex)
                {
                    throw new Exception($"Error writing user tasks: {ex.Message}");
                }
            }
        }
    }
}

// מודל משימה אישית של משתמש
public class UserPersonalTask
{
    public string Id { get; set; }
    public string OwnerUsername { get; set; }   // ← שם המשתמש הבעלים
    public string OwnerEmployeeId { get; set; } // ← ה-ID של העובד המשויך
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

    // המרה ל-EmployeeTask לשימוש בקוד הקיים
    public EmployeeTask ToEmployeeTask()
    {
        return new EmployeeTask
        {
            Id = this.Id,
            EmployeeId = this.OwnerEmployeeId,
            Title = this.Title,
            Description = this.Description,
            Priority = this.Priority,
            DueDate = this.DueDate,
            EstimatedTime = this.EstimatedTime,
            Completed = this.Completed,
            CompletedTime = this.CompletedTime,
            SkipReason = this.SkipReason,
            LastCompletedDate = this.LastCompletedDate,
            LastSkippedDate = this.LastSkippedDate,
            Status = this.Status,
            StatusDate = this.StatusDate,
            Progress = this.Progress,
            CreatedAt = this.CreatedAt
        };
    }
}