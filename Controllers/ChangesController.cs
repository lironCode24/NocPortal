using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

public class ChangesController : Controller
{
    // נתיב לתיקיית השינויים
    private const string CHANGES_FILE_PATH = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\CAB_Automation\results";
    // נתיב לקובץ המאגד את כל השינויים
    private const string AGGREGATED_CHANGES_PATH = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\CAB_Automation\aggregated_changes.json";

    [HttpGet]
    public IActionResult GetChanges()
    {
        try
        {
            // מציאת הקובץ העדכני ביותר בתיקייה
            var directory = new DirectoryInfo(CHANGES_FILE_PATH);
            if (!directory.Exists)
            {
                return Json(new { success = false, message = "תיקיית השינויים לא נמצאה" });
            }

            var latestFile = directory.GetFiles("Changes_NOC_Portal_*.csv")
                                      .OrderByDescending(f => f.LastWriteTime)
                                      .FirstOrDefault();

            if (latestFile == null)
            {
                return Json(new { success = false, message = "לא נמצאו קבצי שינויים" });
            }

            // קריאת הקובץ המאגד הקיים אם קיים
            List<ChangeItem> aggregatedChanges = LoadAggregatedChanges();
            
            // קריאת הקובץ החדש
            var lines = System.IO.File.ReadAllLines(latestFile.FullName, Encoding.UTF8);
            if (lines.Length <= 1) // רק כותרת או ריק
            {
                return Json(new { success = true, changes = aggregatedChanges });
            }

            var newChanges = new List<ChangeItem>();
            
            // קריאת הכותרות
            var headers = lines[0].Split(',');
            
            // מציאת האינדקסים של העמודות הרלוונטיות
            int changeNumberIndex = Array.IndexOf(headers, "מספר שינוי");
            int changeNameIndex = Array.IndexOf(headers, "שם השינוי");
            int changeDateIndex = Array.IndexOf(headers, "תאריך השינוי");
            int changeLinkIndex = Array.IndexOf(headers, "קישור לשינוי");

            // עדכון הבדיקה של מבנה הקובץ
            if (changeNumberIndex == -1 || changeNameIndex == -1 || changeDateIndex == -1 || changeLinkIndex == -1)
            {
                return Json(new { success = false, message = "מבנה קובץ השינויים אינו תקין" });
            }

            // עיבוד השורות
            for (int i = 1; i < lines.Length; i++)
            {
                var columns = ParseCsvLine(lines[i]);
                if (columns.Length <= Math.Max(Math.Max(changeNumberIndex, changeNameIndex), Math.Max(changeDateIndex, changeLinkIndex)))
                    continue;

                var change = new ChangeItem
                {
                    Number = columns[changeNumberIndex],
                    Name = columns[changeNameIndex],
                    Date = columns[changeDateIndex],
                    Link = columns[changeLinkIndex]
                };
                
                newChanges.Add(change);
            }

            // מיזוג השינויים החדשים עם הקיימים
            MergeChanges(aggregatedChanges, newChanges);
            
            // שמירת השינויים המאוחדים
            SaveAggregatedChanges(aggregatedChanges);

            return Json(new { success = true, changes = aggregatedChanges });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // טעינת השינויים המאוחדים מקובץ
    private List<ChangeItem> LoadAggregatedChanges()
    {
        if (System.IO.File.Exists(AGGREGATED_CHANGES_PATH))
        {
            try
            {
                string json = System.IO.File.ReadAllText(AGGREGATED_CHANGES_PATH);
                return JsonSerializer.Deserialize<List<ChangeItem>>(json) ?? new List<ChangeItem>();
            }
            catch
            {
                return new List<ChangeItem>();
            }
        }
        return new List<ChangeItem>();
    }

    // שמירת השינויים המאוחדים לקובץ
    private void SaveAggregatedChanges(List<ChangeItem> changes)
    {
        string json = JsonSerializer.Serialize(changes);
        System.IO.File.WriteAllText(AGGREGATED_CHANGES_PATH, json);
    }

    // מיזוג השינויים החדשים עם הקיימים
    private void MergeChanges(List<ChangeItem> existingChanges, List<ChangeItem> newChanges)
    {
        foreach (var newChange in newChanges)
        {
            // בדיקה אם השינוי כבר קיים לפי מספר השינוי
            var existingChange = existingChanges.FirstOrDefault(c => c.Number == newChange.Number);
            
            if (existingChange == null)
            {
                // אם השינוי לא קיים, הוסף אותו
                existingChanges.Add(newChange);
            }
            else
            {
                // אם השינוי קיים, עדכן את הפרטים שלו
                existingChange.Name = newChange.Name;
                existingChange.Date = newChange.Date;
                existingChange.Link = newChange.Link;
            }
        }
    }

    // פונקציית עזר לפרסור שורת CSV
    private string[] ParseCsvLine(string line)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];

            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (c == ',' && !inQuotes)
            {
                result.Add(current.ToString().Trim().Trim('"'));
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        result.Add(current.ToString().Trim().Trim('"'));
        return result.ToArray();
    }
}

// מחלקה לייצוג פריט שינוי
public class ChangeItem
{
    public string Number { get; set; }
    public string Name { get; set; }
    public string Date { get; set; }
    public string Link { get; set; }
}