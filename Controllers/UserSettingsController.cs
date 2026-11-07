// file: Controllers/UserSettingsController.cs
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;

[ApiController]
[Route("[controller]")]
public class UserSettingsController : ControllerBase
{
    // ── נתיב בסיס לקבצי הגדרות ──
    private static readonly string BASE_PATH =
        PortalPaths.UnderFiles(@"UserSettings\");

    // ── קבל שם קובץ לפי משתמש ──
    private string GetUserFilePath(string userId)
    {
        // נקה תווים לא חוקיים משם הקובץ
        var safeId = string.Concat(
            userId.Where(c =>
                char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == '@'
            )
        );

        if (string.IsNullOrEmpty(safeId))
            safeId = "anonymous";

        return Path.Combine(BASE_PATH, $"{safeId}.json");
    }

    // ── קבל מזהה משתמש מה-session/claims ──
    private string GetCurrentUserId()
    {
        // התאם לפי מנגנון האימות שלך
        var name = User?.Identity?.Name;
        if (!string.IsNullOrWhiteSpace(name))
            return name;

        return "anonymous";
    }

    // ── טען את כל ההגדרות ──
    [HttpGet("GetAll")]
    public IActionResult GetAll()
    {
        try
        {
            var userId = GetCurrentUserId();
            var filePath = GetUserFilePath(userId);

            Dictionary<string, object> settings;

            if (System.IO.File.Exists(filePath))
            {
                var json = System.IO.File.ReadAllText(filePath);
                settings = JsonSerializer.Deserialize
                    <Dictionary<string, object>>(json)
                    ?? new Dictionary<string, object>();
            }
            else
            {
                settings = new Dictionary<string, object>();
            }

            return Ok(new
            {
                success = true,
                userId = userId,
                settings = settings
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }

    // ── שמור קבוצת הגדרות ──
    [HttpPost("SaveBatch")]
    public IActionResult SaveBatch([FromBody] SaveBatchRequest request)
    {
        try
        {
            if (request?.Settings == null)
                return BadRequest(new
                {
                    success = false,
                    error = "נתונים חסרים"
                });

            var userId = GetCurrentUserId();
            var filePath = GetUserFilePath(userId);

            // וודא שהתיקייה קיימת
            var dir = Path.GetDirectoryName(filePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            // טען הגדרות קיימות
            Dictionary<string, JsonElement> existing;

            if (System.IO.File.Exists(filePath))
            {
                var existingJson = System.IO.File.ReadAllText(filePath);
                existing = JsonSerializer.Deserialize
                    <Dictionary<string, JsonElement>>(existingJson)
                    ?? new Dictionary<string, JsonElement>();
            }
            else
            {
                existing = new Dictionary<string, JsonElement>();
            }

            // מזג הגדרות חדשות
            foreach (var kvp in request.Settings)
            {
                existing[kvp.Key] = kvp.Value;
            }

            // שמור לקובץ
            var options = new JsonSerializerOptions
            {
                WriteIndented = true
            };

            var json = JsonSerializer.Serialize(existing, options);
            System.IO.File.WriteAllText(filePath, json);

            return Ok(new
            {
                success = true,
                saved = request.Settings.Count
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }

    // ── מחק הגדרה ──
    [HttpPost("Delete")]
    public IActionResult Delete([FromBody] DeleteRequest request)
    {
        try
        {
            if (string.IsNullOrEmpty(request?.Key))
                return BadRequest(new
                {
                    success = false,
                    error = "מפתח חסר"
                });

            var userId = GetCurrentUserId();
            var filePath = GetUserFilePath(userId);

            if (!System.IO.File.Exists(filePath))
                return Ok(new { success = true });

            var json = System.IO.File.ReadAllText(filePath);
            var settings = JsonSerializer.Deserialize
                <Dictionary<string, JsonElement>>(json)
                ?? new Dictionary<string, JsonElement>();

            if (settings.Remove(request.Key))
            {
                var options = new JsonSerializerOptions
                {
                    WriteIndented = true
                };
                System.IO.File.WriteAllText(
                    filePath,
                    JsonSerializer.Serialize(settings, options)
                );
            }

            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                error = ex.Message
            });
        }
    }
}

// ── מודלים ──
public class SaveBatchRequest
{
    public Dictionary<string, JsonElement> Settings { get; set; } = new();
}

public class DeleteRequest
{
    public string Key { get; set; } = "";
}