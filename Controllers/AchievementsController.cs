using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

public class AchievementsController : Controller
{
    private readonly string _filePath;
    private static readonly object _lock = new object();

    public AchievementsController(IWebHostEnvironment env)
    {
        _filePath = Path.Combine(env.WebRootPath, "assets", "files", "achievements.txt");
    }
    private const int MaxRetries = 3;
    private const int RetryDelayMs = 100;

    // ─── GET: כל ההשגים ───
    [HttpGet]
    public IActionResult GetAll()
    {
        try
        {
            var achievements = ReadAll();
            return Json(new { achievements });
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    // ─── POST: הוספת השג ───
    [HttpPost]
    public IActionResult Add([FromBody] AchievementItem item)
    {
        try
        {
            if (string.IsNullOrEmpty(item.Title))
                return Json(new { success = false, error = "Title is required" });

            item.Id = $"ach_{DateTime.Now.Ticks}";

            // CreatedAt = תאריך יצירת הרשומה במערכת - תמיד Now
            item.CreatedAt = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss");

            // AchievementDate = תאריך ביצוע שהמשתמש בחר
            // אם לא נשלח - ברירת מחדל היום
            if (string.IsNullOrEmpty(item.AchievementDate))
                item.AchievementDate = DateTime.Now.ToString("yyyy-MM-dd");

            item.CreatedBy = GetCurrentUsername();

            AppendToFile(item);
            return Json(new { success = true, id = item.Id });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: עדכון השג ───
    [HttpPost]
    public IActionResult Update([FromBody] AchievementItem item)
    {
        try
        {
            if (string.IsNullOrEmpty(item.Id))
                return Json(new { success = false, error = "Id is required" });

            bool updated = false;

            SafeWrite(lines =>
            {
                for (int i = 0; i < lines.Count; i++)
                {
                    if (string.IsNullOrWhiteSpace(lines[i])) continue;
                    try
                    {
                        var existing = JsonSerializer
                            .Deserialize<AchievementItem>(lines[i]);

                        if (existing.Id != item.Id) continue;

                        // שמור CreatedAt ו-CreatedBy המקוריים בלבד
                        item.CreatedAt  = existing.CreatedAt;
                        item.CreatedBy  = existing.CreatedBy;

                        // AchievementDate מגיע מהלקוח ונשמר כפי שהוא
                        // אם לא נשלח - שמור את הקיים
                        if (string.IsNullOrEmpty(item.AchievementDate))
                            item.AchievementDate = existing.AchievementDate;

                        item.UpdatedAt = DateTime.Now
                            .ToString("yyyy-MM-ddTHH:mm:ss");

                        lines[i] = JsonSerializer.Serialize(item);
                        updated = true;
                        return;
                    }
                    catch { continue; }
                }
            });

            return Json(new { success = updated });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── POST: מחיקת השג ───
    [HttpPost]
    public IActionResult Delete([FromBody] DeleteAchievementRequest req)
    {
        try
        {
            if (string.IsNullOrEmpty(req.Id))
                return Json(new
                {
                    success = false,
                    error = "Id is required"
                });

            bool deleted = false;

            SafeWrite(lines =>
            {
                var before = lines.Count;
                lines.RemoveAll(line =>
                {
                    if (string.IsNullOrWhiteSpace(line))
                        return false;
                    try
                    {
                        var a = JsonSerializer
                            .Deserialize<AchievementItem>(line);
                        return a.Id == req.Id;
                    }
                    catch { return false; }
                });
                deleted = lines.Count < before;
            });

            return Json(new { success = deleted });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── פונקציות עזר ───
    private List<AchievementItem> ReadAll()
    {
        var result = new List<AchievementItem>();
        var lines = SafeRead();

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var item = JsonSerializer
                    .Deserialize<AchievementItem>(line);
                if (item != null) result.Add(item);
            }
            catch { continue; }
        }

        return result.OrderByDescending(a => a.CreatedAt).ToList();
    }

    private void AppendToFile(AchievementItem item)
    {
        lock (_lock)
        {
            var dir = Path.GetDirectoryName(_filePath);
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            using var fs = new FileStream(
                _filePath, FileMode.Append,
                FileAccess.Write, FileShare.None);
            using var writer = new StreamWriter(fs);
            writer.WriteLine(JsonSerializer.Serialize(item));
        }
    }

    private List<string> SafeRead()
    {
        lock (_lock)
        {
            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                try
                {
                    if (!System.IO.File.Exists(_filePath))
                        return new List<string>();

                    using var fs = new FileStream(
                        _filePath, FileMode.Open,
                        FileAccess.Read, FileShare.Read);
                    using var reader = new StreamReader(fs);

                    var lines = new List<string>();
                    string line;
                    while ((line = reader.ReadLine()) != null)
                        lines.Add(line);
                    return lines;
                }
                catch (IOException) when (attempt < MaxRetries - 1)
                {
                    System.Threading.Thread.Sleep(
                        RetryDelayMs * (attempt + 1));
                }
            }
            return new List<string>();
        }
    }

    private void SafeWrite(Action<List<string>> action)
    {
        lock (_lock)
        {
            for (int attempt = 0; attempt < MaxRetries; attempt++)
            {
                try
                {
                    if (!System.IO.File.Exists(_filePath))
                    {
                        var dir = Path.GetDirectoryName(_filePath);
                        if (!Directory.Exists(dir))
                            Directory.CreateDirectory(dir);
                        System.IO.File.WriteAllText(_filePath, "");
                    }

                    var lines = System.IO.File
                        .ReadAllLines(_filePath).ToList();
                    action(lines);

                    using var fs = new FileStream(
                        _filePath, FileMode.Create,
                        FileAccess.Write, FileShare.None);
                    using var writer = new StreamWriter(fs);
                    foreach (var line in lines)
                        writer.WriteLine(line);

                    return;
                }
                catch (IOException) when (attempt < MaxRetries - 1)
                {
                    System.Threading.Thread.Sleep(
                        RetryDelayMs * (attempt + 1));
                }
            }
        }
    }

    private string GetCurrentUsername() =>
        User?.Identity?.Name ??
        User?.FindFirst("username")?.Value ?? "";
}

// ─── Models ───
public class AchievementItem
{
    public string Id             { get; set; }
    public string Title          { get; set; }
    public string Description    { get; set; }
    public string Category       { get; set; }
    public string Priority       { get; set; } = "medium";
    public string CreatedAt      { get; set; }    // תאריך יצירת הרשומה במערכת
    public string AchievementDate { get; set; }   // חדש - תאריך ביצוע ההשג
    public string UpdatedAt      { get; set; }
    public string CreatedBy      { get; set; }
    public string Link           { get; set; }
    public string AttachmentName { get; set; }
}

public class DeleteAchievementRequest
{
    public string Id { get; set; }
}