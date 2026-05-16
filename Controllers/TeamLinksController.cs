using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

public class TeamLinksController : Controller
{
    private readonly string csvPath;

    public TeamLinksController(IWebHostEnvironment env)
    {
        csvPath = Path.Combine(env.ContentRootPath, "portal", "files", "team_links.csv");
    }

    [HttpGet]
    public IActionResult GetTeamLinks()
    {
        try
        {
            if (System.IO.File.Exists(csvPath))
            {
                var teamLinks = ReadTeamLinksFromCsv(csvPath);
                return Json(teamLinks);
            }
            return Json(new List<object>());
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult AddLink([FromBody] LinkModel link)
    {
        try
        {
            // Validate required fields
            if (string.IsNullOrEmpty(link.Title) || string.IsNullOrEmpty(link.Url))
            {
                return Json(new { success = false, message = "כותרת וכתובת URL הם שדות חובה" });
            }

            // Validate URL format
            if (!Uri.TryCreate(link.Url, UriKind.Absolute, out Uri uriResult) || 
                (uriResult.Scheme != Uri.UriSchemeHttp && uriResult.Scheme != Uri.UriSchemeHttps))
            {
                return Json(new { success = false, message = "כתובת URL אינה תקינה" });
            }

            var links = ReadTeamLinksFromCsv(csvPath);
            
            // Check for duplicate URL
            var isDuplicate = links.Any(l => ((dynamic)l).url == link.Url);
            if (isDuplicate)
            {
                return Json(new { success = false, message = "כתובת URL זו כבר קיימת במערכת" });
            }
            
            // Generate new ID
            var maxId = links.Any() ? links.Max(l => ((dynamic)l).id) : 0;
            var newLink = new
            {
                id = maxId + 1,
                title = link.Title,
                url = link.Url,
                description = link.Description ?? "",
                icon = link.Icon ?? "fas fa-link",
                category = link.Category ?? "",
                createdAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
            };

            links.Add(newLink);
            SaveTeamLinksToCsv(csvPath, links);

            return Json(new { success = true, message = "הקישור נוסף בהצלחה", link = newLink });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult UpdateLink([FromBody] LinkModel link)
    {
        try
        {
            if (link.Id == null)
            {
                return Json(new { success = false, message = "מזהה קישור חסר" });
            }

            // Validate required fields
            if (string.IsNullOrEmpty(link.Title) || string.IsNullOrEmpty(link.Url))
            {
                return Json(new { success = false, message = "כותרת וכתובת URL הם שדות חובה" });
            }

            // Validate URL format
            if (!Uri.TryCreate(link.Url, UriKind.Absolute, out Uri uriResult) || 
                (uriResult.Scheme != Uri.UriSchemeHttp && uriResult.Scheme != Uri.UriSchemeHttps))
            {
                return Json(new { success = false, message = "כתובת URL אינה תקינה" });
            }

            var links = ReadTeamLinksFromCsv(csvPath);
            var existingLink = links.FirstOrDefault(l => ((dynamic)l).id == link.Id);

            if (existingLink == null)
            {
                return Json(new { success = false, message = "קישור לא נמצא" });
            }

            // Check for duplicate URL (excluding current link)
            var isDuplicate = links.Any(l => 
                ((dynamic)l).url == link.Url && 
                ((dynamic)l).id != link.Id);
            
            if (isDuplicate)
            {
                return Json(new { success = false, message = "כתובת URL זו כבר קיימת במערכת" });
            }

            // Remove old link
            links.Remove(existingLink);

            // Preserve creation date
            var createdAt = ((dynamic)existingLink).createdAt;
            
            // Check if updatedAt exists in the existing link
            string previousUpdatedAt = null;
            try
            {
                previousUpdatedAt = ((dynamic)existingLink).updatedAt;
            }
            catch
            {
                // updatedAt doesn't exist, which is fine
            }

            // Add updated link
            var updatedLink = new
            {
                id = link.Id,
                title = link.Title,
                url = link.Url,
                description = link.Description ?? "",
                icon = link.Icon ?? "fas fa-link",
                category = link.Category ?? "",
                createdAt = createdAt,
                updatedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss")
            };

            links.Add(updatedLink);
            SaveTeamLinksToCsv(csvPath, links);

            return Json(new { success = true, message = "הקישור עודכן בהצלחה", link = updatedLink });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult DeleteLink([FromBody] DeleteLinkModel model)
    {
        try
        {
            if (model.Id == null)
            {
                return Json(new { success = false, message = "מזהה קישור חסר" });
            }

            var links = ReadTeamLinksFromCsv(csvPath);
            var linkToDelete = links.FirstOrDefault(l => ((dynamic)l).id == model.Id);

            if (linkToDelete == null)
            {
                return Json(new { success = false, message = "קישור לא נמצא" });
            }

            links.Remove(linkToDelete);
            SaveTeamLinksToCsv(csvPath, links);

            return Json(new { success = true, message = "הקישור נמחק בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpGet]
    public IActionResult GetCategories()
    {
        try
        {
            var links = ReadTeamLinksFromCsv(csvPath);
            var categories = links
                .Select(l => ((dynamic)l).category?.ToString())
                .Where(c => !string.IsNullOrEmpty(c))
                .Distinct()
                .OrderBy(c => c)
                .ToList();

            return Json(new { success = true, categories });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    private List<object> ReadTeamLinksFromCsv(string filePath)
    {
        try
        {
            if (!System.IO.File.Exists(filePath))
            {
                return new List<object>();
            }

            var lines = System.IO.File.ReadAllLines(filePath);
            var teamLinks = new List<object>();

            // Skip header row
            for (int i = 1; i < lines.Length; i++)
            {
                var columns = ParseCsvLine(lines[i]);
                
                if (columns.Length >= 3)
                {
                    var title = columns[0]?.Trim();
                    var url = columns[1]?.Trim();
                    var description = columns.Length > 2 ? columns[2]?.Trim() : "";
                    var icon = columns.Length > 3 ? columns[3]?.Trim() : "fas fa-link";
                    var category = columns.Length > 4 ? columns[4]?.Trim() : "";
                    var createdAt = columns.Length > 5 ? columns[5]?.Trim() : DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
                    var updatedAt = columns.Length > 6 ? columns[6]?.Trim() : "";

                    // Skip empty rows
                    if (string.IsNullOrEmpty(title) && string.IsNullOrEmpty(url))
                    {
                        continue;
                    }

                    teamLinks.Add(new
                    {
                        id = i,
                        title = title ?? "",
                        url = url ?? "",
                        description = description ?? "",
                        icon = icon ?? "fas fa-link",
                        category = category ?? "",
                        createdAt = createdAt,
                        updatedAt = updatedAt
                    });
                }
            }

            return teamLinks.OrderBy(l => ((dynamic)l).title).ToList();
        }
        catch (Exception)
        {
            return new List<object>();
        }
    }

    private void SaveTeamLinksToCsv(string filePath, List<object> links)
    {
        try
        {
            // Ensure directory exists
            var directory = Path.GetDirectoryName(filePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var lines = new List<string>();
            
            // Add header
            lines.Add("כותרת,כתובת URL,תיאור,אייקון,קטגוריה,תאריך יצירה,תאריך עדכון");

            // Add links (sorted by title)
            var sortedLinks = links.OrderBy(l => ((dynamic)l).title).ToList();
            
            foreach (var link in sortedLinks)
            {
                var l = (dynamic)link;
                var title = EscapeCsvField(l.title);
                var url = EscapeCsvField(l.url);
                var description = EscapeCsvField(l.description ?? "");
                var icon = EscapeCsvField(l.icon ?? "fas fa-link");
                var category = EscapeCsvField(l.category ?? "");
                var createdAt = EscapeCsvField(l.createdAt ?? "");
                
                // Check if updatedAt exists
                string updatedAt = "";
                try
                {
                    updatedAt = EscapeCsvField(l.updatedAt ?? "");
                }
                catch
                {
                    // updatedAt doesn't exist, use empty string
                }
                
                lines.Add($"{title},{url},{description},{icon},{category},{createdAt},{updatedAt}");
            }

            System.IO.File.WriteAllLines(filePath, lines);
        }
        catch (Exception ex)
        {
            throw new Exception($"שגיאה בשמירת הקובץ: {ex.Message}");
        }
    }

    // Helper method to escape CSV fields
    private string EscapeCsvField(string field)
    {
        if (string.IsNullOrEmpty(field))
            return "";
            
        // If the field contains comma, newline or double-quote, wrap it in quotes
        if (field.Contains(",") || field.Contains("\n") || field.Contains("\""))
        {
            // Replace any double-quotes with two double-quotes
            field = field.Replace("\"", "\"\"");
            return $"\"{field}\"";
        }
        
        return field;
    }

    // Helper method to parse CSV line handling quotes
    private string[] ParseCsvLine(string line)
    {
        var result = new List<string>();
        var inQuotes = false;
        var currentField = new System.Text.StringBuilder();
        
        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            
            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    // Escaped quote (two double quotes in a row)
                    currentField.Append('"');
                    i++; // Skip the next quote
                }
                else
                {
                    // Toggle quote mode
                    inQuotes = !inQuotes;
                }
            }
            else if (c == ',' && !inQuotes)
            {
                // End of field
                result.Add(currentField.ToString());
                currentField.Clear();
            }
            else
            {
                currentField.Append(c);
            }
        }
        
        // Add the last field
        result.Add(currentField.ToString());
        
        return result.ToArray();
    }

    // Models
    public class LinkModel
    {
        public int? Id { get; set; }
        public string Title { get; set; }
        public string Url { get; set; }
        public string Description { get; set; }
        public string Icon { get; set; }
        public string Category { get; set; }
    }

    public class DeleteLinkModel
    {
        public int? Id { get; set; }
    }
}