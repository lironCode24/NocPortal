using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

[Route("[controller]/[action]")]
public class OrgTreeController : Controller
{
    // ─── תיקיית קבצי עץ ארגוני ───────────────────────────────────
    private readonly string _treeFolder =
        PortalPaths.UnderFiles(@"Helix_Employees_Export\BuildTree");

    // ─── ספר טלפונים (לצירוף מידע נוסף) ─────────────────────────
    private readonly string _phoneCsvPath =
        PortalPaths.UnderFiles(@"phone_directory.csv");

    // ══════════════════════════════════════════════════════════════
    // GET /OrgTree/GetOrgTree
    // מחזיר את רשימת העובדים עם קשרי מנהל-כפוף
    // ══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult GetOrgTree()
    {
        try
        {
            // ─── מצא את הקובץ האחרון בתיקייה ────────────────────
            var latestFile = GetLatestCsvFile(_treeFolder);

            if (latestFile == null)
                return Json(new
                {
                    success = false,
                    error   = "לא נמצא קובץ עץ ארגוני בתיקייה"
                });

            // ─── קרא את הקובץ ────────────────────────────────────
            var employees = ReadEmployeesFromCsv(latestFile);

            if (employees.Count == 0)
                return Json(new
                {
                    success = false,
                    error   = "הקובץ ריק או לא תקין"
                });

            return Json(new
            {
                success       = true,
                employees     = employees,
                totalCount    = employees.Count,
                sourceFile    = Path.GetFileName(latestFile),
                lastModified  = System.IO.File.GetLastWriteTime(latestFile)
                                    .ToString("dd/MM/yyyy HH:mm")
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    // GET /OrgTree/GetEmployeeSubTree?employeeId=YAKIZ
    // מחזיר תת-עץ של עובד ספציפי
    // ══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult GetEmployeeSubTree(string employeeId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(employeeId))
                return Json(new
                {
                    success = false,
                    error   = "נדרש מזהה עובד"
                });

            var latestFile = GetLatestCsvFile(_treeFolder);
            if (latestFile == null)
                return Json(new
                {
                    success = false,
                    error   = "לא נמצא קובץ עץ ארגוני"
                });

            var allEmployees = ReadEmployeesFromCsv(latestFile);

            // ─── מצא את העובד ────────────────────────────────────
            var root = allEmployees.FirstOrDefault(e =>
                string.Equals(e.EmployeeId, employeeId,
                    StringComparison.OrdinalIgnoreCase));

            if (root == null)
                return Json(new
                {
                    success = false,
                    error   = $"עובד '{employeeId}' לא נמצא"
                });

            // ─── אסוף את כל הכפיפים ──────────────────────────────
            var subTree = GetSubTreeEmployees(allEmployees, employeeId);

            return Json(new
            {
                success    = true,
                root       = root,
                employees  = subTree,
                totalCount = subTree.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    // GET /OrgTree/GetManagerChain?employeeId=LIRONPAS
    // מחזיר שרשרת מנהלים מהעובד עד לשורש
    // ══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult GetManagerChain(string employeeId)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(employeeId))
                return Json(new
                {
                    success = false,
                    error   = "נדרש מזהה עובד"
                });

            var latestFile = GetLatestCsvFile(_treeFolder);
            if (latestFile == null)
                return Json(new
                {
                    success = false,
                    error   = "לא נמצא קובץ עץ ארגוני"
                });

            var allEmployees = ReadEmployeesFromCsv(latestFile);

            // ─── בנה מפה לחיפוש מהיר ─────────────────────────────
            var empMap = allEmployees.ToDictionary(
                e => e.EmployeeId,
                e => e,
                StringComparer.OrdinalIgnoreCase);

            if (!empMap.TryGetValue(employeeId, out var startEmp))
                return Json(new
                {
                    success = false,
                    error   = $"עובד '{employeeId}' לא נמצא"
                });

            // ─── עלה בשרשרת ──────────────────────────────────────
            var chain   = new List<EmployeeRecord>();
            var current = startEmp;
            var visited = new HashSet<string>(
                StringComparer.OrdinalIgnoreCase);

            while (current != null)
            {
                if (visited.Contains(current.EmployeeId))
                    break; // מניעת לולאה אינסופית

                chain.Add(current);
                visited.Add(current.EmployeeId);

                if (string.IsNullOrEmpty(current.ManagerId))
                    break;

                empMap.TryGetValue(current.ManagerId, out current);
            }

            return Json(new
            {
                success    = true,
                chain      = chain,
                chainCount = chain.Count
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    // GET /OrgTree/GetOrgStats
    // סטטיסטיקות על העץ הארגוני
    // ══════════════════════════════════════════════════════════════
    [HttpGet]
    public IActionResult GetOrgStats()
    {
        try
        {
            var latestFile = GetLatestCsvFile(_treeFolder);
            if (latestFile == null)
                return Json(new
                {
                    success = false,
                    error   = "לא נמצא קובץ עץ ארגוני"
                });

            var employees = ReadEmployeesFromCsv(latestFile);

            // ─── חשב סטטיסטיקות ──────────────────────────────────
            var managerIds = employees
                .Where(e => !string.IsNullOrEmpty(e.ManagerId))
                .Select(e => e.ManagerId!)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var managers = employees
                .Where(e => managerIds.Contains(e.EmployeeId))
                .ToList();

            var roots = employees
                .Where(e => string.IsNullOrEmpty(e.ManagerId))
                .ToList();

            // ─── עומק מקסימלי ────────────────────────────────────
            var empMap = employees.ToDictionary(
                e => e.EmployeeId,
                e => e,
                StringComparer.OrdinalIgnoreCase);

            int maxDepth = 0;
            foreach (var emp in employees)
            {
                int depth   = 0;
                var current = emp;
                var visited = new HashSet<string>(
                    StringComparer.OrdinalIgnoreCase);

                while (current != null &&
                       !string.IsNullOrEmpty(current.ManagerId))
                {
                    if (visited.Contains(current.EmployeeId)) break;
                    visited.Add(current.EmployeeId);
                    depth++;
                    empMap.TryGetValue(current.ManagerId, out current);
                }

                if (depth > maxDepth) maxDepth = depth;
            }

            return Json(new
            {
                success        = true,
                totalEmployees = employees.Count,
                totalManagers  = managers.Count,
                totalRoots     = roots.Count,
                maxDepth       = maxDepth,
                sourceFile     = Path.GetFileName(latestFile),
                lastModified   = System.IO.File.GetLastWriteTime(latestFile)
                                     .ToString("dd/MM/yyyy HH:mm")
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                error   = ex.Message
            });
        }
    }

    // ══════════════════════════════════════════════════════════════
    // פונקציות עזר פרטיות
    // ══════════════════════════════════════════════════════════════

    // ─── מצא את הקובץ האחרון בתיקייה ────────────────────────────
    private string? GetLatestCsvFile(string folderPath)
    {
        if (!Directory.Exists(folderPath))
            return null;

        var files = Directory.GetFiles(folderPath, "*.csv");

        if (files.Length == 0)
            return null;

        // ─── מיין לפי תאריך שינוי אחרון - הכי חדש ראשון ─────────
        return files
            .OrderByDescending(f =>
                System.IO.File.GetLastWriteTime(f))
            .First();
    }

    // ─── קרא עובדים מ-CSV ────────────────────────────────────────
    // מבנה: EmployeeId,EmployeeName,ManagerId
    private List<EmployeeRecord> ReadEmployeesFromCsv(string filePath)
    {
        var result = new List<EmployeeRecord>();

        if (!System.IO.File.Exists(filePath))
            return result;

        var lines = System.IO.File.ReadAllLines(
            filePath, Encoding.UTF8);

        // ─── דלג על שורת כותרת ───────────────────────────────────
        for (int i = 1; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            // ─── פצל לפי פסיק ────────────────────────────────────
            // שים לב: ManagerId יכול להיות ריק (שורש)
            var cols = line.Split(',');

            if (cols.Length < 2) continue;

            var employeeId   = cols[0].Trim();
            var employeeName = cols[1].Trim();
            var managerId    = cols.Length > 2
                ? cols[2].Trim()
                : "";

            if (string.IsNullOrWhiteSpace(employeeId)) continue;

            result.Add(new EmployeeRecord
            {
                EmployeeId   = employeeId,
                EmployeeName = employeeName,
                ManagerId    = string.IsNullOrWhiteSpace(managerId)
                    ? null
                    : managerId
            });
        }

        return result;
    }

    // ─── אסוף את כל הכפיפים (רקורסיבי) ──────────────────────────
    private List<EmployeeRecord> GetSubTreeEmployees(
        List<EmployeeRecord> allEmployees,
        string               rootId)
    {
        var result  = new List<EmployeeRecord>();
        var visited = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase);

        void Collect(string managerId)
        {
            if (visited.Contains(managerId)) return;
            visited.Add(managerId);

            var directReports = allEmployees
                .Where(e => string.Equals(
                    e.ManagerId, managerId,
                    StringComparison.OrdinalIgnoreCase))
                .ToList();

            foreach (var emp in directReports)
            {
                result.Add(emp);
                Collect(emp.EmployeeId);
            }
        }

        // ─── הוסף את השורש עצמו ──────────────────────────────────
        var root = allEmployees.FirstOrDefault(e =>
            string.Equals(e.EmployeeId, rootId,
                StringComparison.OrdinalIgnoreCase));

        if (root != null)
        {
            result.Add(root);
            Collect(rootId);
        }

        return result;
    }
}

// ══════════════════════════════════════════════════════════════════
// מודל עובד
// ══════════════════════════════════════════════════════════════════
public class EmployeeRecord
{
    public string  EmployeeId   { get; set; } = "";
    public string  EmployeeName { get; set; } = "";
    public string? ManagerId    { get; set; }
}