using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.IO.Compression;
using System.Text.Json;
using System.Text;
using System.Xml.Linq;       // ← קיים ב-.NET Core ללא חבילות
using System.Data;
using System.Net.Http;
using System.Net.Http.Headers;
using Microsoft.AspNetCore.Authorization;

public class PhoneDirectoryController : Controller
{
    private readonly string csvPath;

    public PhoneDirectoryController(IWebHostEnvironment env)
    {
        csvPath = Path.Combine(env.WebRootPath, "assets", "files", "phone_directory.csv");
    }

    [HttpGet]
    public IActionResult GetPhoneDirectory()
    {
        try
        {
            if (System.IO.File.Exists(csvPath))
            {
                var phoneDirectory = ReadPhoneDirectoryFromCsv(csvPath);
                return Json(phoneDirectory);
            }

            return Json(GetDefaultPhoneDirectory());
        }
        catch (Exception ex)
        {
            return Json(new { error = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult AddContact([FromBody] ContactModel contact)
    {
        try
        {
            // ─── ולידציה: שם מלא ותפקיד חובה ────────────────────────
            if (string.IsNullOrEmpty(contact.FullName) ||
                string.IsNullOrEmpty(contact.Role))
            {
                return Json(new
                {
                    success = false,
                    message = "שם מלא ותפקיד הם שדות חובה"
                });
            }

            // ─── ולידציה: לפחות שלוחה או טלפון ──────────────────────
            if (string.IsNullOrEmpty(contact.Extension) &&
                string.IsNullOrEmpty(contact.PhoneNumber))
            {
                return Json(new
                {
                    success = false,
                    message = "חייב למלא לפחות אחד מהשדות: שלוחה או טלפון"
                });
            }

            var contacts = ReadPhoneDirectoryFromCsv(csvPath);

            // ─── בדוק כפילות מספר טלפון ──────────────────────────────
            if (!string.IsNullOrEmpty(contact.PhoneNumber))
            {
                var isDuplicate = contacts.Any(c =>
                    ((dynamic)c).phoneNumber?.ToString() == contact.PhoneNumber);

                if (isDuplicate)
                {
                    return Json(new
                    {
                        success = false,
                        message = "מספר טלפון זה כבר קיים במערכת"
                    });
                }
            }

            // ─── בדוק כפילות שלוחה ───────────────────────────────────
            if (!string.IsNullOrEmpty(contact.Extension))
            {
                var isDuplicateExt = contacts.Any(c =>
                    ((dynamic)c).extension?.ToString() == contact.Extension);

                if (isDuplicateExt)
                {
                    return Json(new
                    {
                        success = false,
                        message = "שלוחה זו כבר קיימת במערכת"
                    });
                }
            }

            // ─── צור ID חדש ──────────────────────────────────────────
            var maxId = contacts.Any()
                ? contacts.Max(c => (int)((dynamic)c).id)
                : 0;

            maxId++;

            // ─── הוסף איש קשר חדש ────────────────────────────────────
            var newContact = new
            {
                id          = maxId,
                fullName    = contact.FullName    ?? "",
                role        = contact.Role        ?? "",
                domain      = contact.Domain      ?? "",
                department  = contact.Department  ?? "",
                team        = contact.Team        ?? "",
                phoneNumber = contact.PhoneNumber ?? "",
                extension   = contact.Extension   ?? "",
                email       = contact.Email       ?? ""
            };

            contacts.Add(newContact);
            SavePhoneDirectoryToCsv(csvPath, contacts);

            return Json(new { success = true, message = "איש קשר נוסף בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ─── GET: חפש מייל לפי שם מספר הטלפונים ────────────────────
    [HttpGet]
    public IActionResult GetManagerEmail(string name)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name))
                return Json(new { success = false, email = "" });

            var phoneCsvPath = Path.Combine(HttpContext.RequestServices.GetService<IWebHostEnvironment>()?.WebRootPath ?? AppContext.BaseDirectory, "assets", "files", "phone_directory.csv");

            if (!System.IO.File.Exists(phoneCsvPath))
                return Json(new { success = false, email = "", message = "קובץ ספר טלפונים לא נמצא" });

            var lines = System.IO.File.ReadAllLines(phoneCsvPath, Encoding.UTF8);

            // דלג על שורת כותרת
            for (int i = 1; i < lines.Length; i++)
            {
                var columns = lines[i].Split(',');
                if (columns.Length < 8) continue;

                var fullName = columns[0]?.Trim() ?? "";
                var email    = columns[7]?.Trim() ?? "";

                // חיפוש מדויק תחילה
                if (string.Equals(fullName, name, StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrEmpty(email))
                {
                    return Json(new { success = true, email, fullName });
                }
            }

            // חיפוש חלקי אם לא נמצא מדויק
            for (int i = 1; i < lines.Length; i++)
            {
                var columns = lines[i].Split(',');
                if (columns.Length < 8) continue;

                var fullName = columns[0]?.Trim() ?? "";
                var email    = columns[7]?.Trim() ?? "";

                if (!string.IsNullOrEmpty(email) &&
                    (fullName.Contains(name,  StringComparison.OrdinalIgnoreCase) ||
                    name.Contains(fullName,  StringComparison.OrdinalIgnoreCase)))
                {
                    return Json(new { success = true, email, fullName });
                }
            }

            return Json(new { success = false, email = "", message = $"לא נמצא מייל עבור: {name}" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, email = "", message = ex.Message });
        }
    }

    // ─── GET: קבל שיוך ארגוני מלא לפי שם עובד ──────────────────────
    [HttpGet]
    public IActionResult GetEmployeeOrgInfo(string name)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(name))
                return Json(new { success = false, error = "נדרש שם עובד" });

            if (!System.IO.File.Exists(csvPath))
                return Json(new { 
                    success = false, 
                    error   = "קובץ ספר טלפונים לא נמצא" 
                });

            var lines = System.IO.File.ReadAllLines(csvPath, Encoding.UTF8);

            // ─── מבנה CSV ─────────────────────────────────────────────
            // cols[0]=שם מלא | cols[1]=תפקיד | cols[2]=תחום
            // cols[3]=מחלקה  | cols[4]=צוות  | cols[5]=טלפון
            // cols[6]=שלוחה  | cols[7]=מייל

            OrgInfoResult? bestMatch = null;
            int            bestScore = 0;

            for (int i = 1; i < lines.Length; i++)
            {
                var cols = lines[i].Split(',');
                if (cols.Length < 5) continue;

                var fullName   = cols[0]?.Trim() ?? "";
                var role       = cols[1]?.Trim() ?? "";
                var domain     = cols[2]?.Trim() ?? "";
                var department = cols[3]?.Trim() ?? "";
                var team       = cols[4]?.Trim() ?? "";
                var email      = cols.Length > 7 
                                ? cols[7]?.Trim() ?? "" 
                                : "";

                if (string.IsNullOrWhiteSpace(fullName)) continue;

                int score = _CalcNameMatchScore(name, fullName);
                if (score <= 0) continue;

                if (score > bestScore)
                {
                    bestScore = score;
                    bestMatch = new OrgInfoResult
                    {
                        FullName   = fullName,
                        Role       = role,
                        Domain     = domain,
                        Department = department,
                        Team       = team,
                        Email      = email,
                        MatchScore = score
                    };
                }

                // ─── התאמה מושלמת - אין טעם להמשיך ──────────────────
                if (bestScore == 100) break;
            }

            if (bestMatch == null)
                return Json(new { 
                    success = false, 
                    message = $"לא נמצא עובד בשם: {name}" 
                });

            return Json(new
            {
                success    = true,
                employee   = bestMatch,
                matchScore = bestScore
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── GET: קבל מנהל מחלקה לפי שם מחלקה ──────────────────────
    [HttpGet]
    public IActionResult GetDepartmentManager(string department)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(department))
                return Json(new { success = false, error = "נדרש שם מחלקה" });

            if (!System.IO.File.Exists(csvPath))
                return Json(new { 
                    success = false, 
                    error   = "קובץ ספר טלפונים לא נמצא" 
                });

            var lines = System.IO.File.ReadAllLines(csvPath, Encoding.UTF8);

            // ─── מבנה CSV ─────────────────────────────────────────────
            // cols[0]=שם מלא | cols[1]=תפקיד | cols[2]=תחום
            // cols[3]=מחלקה  | cols[4]=צוות  | cols[5]=טלפון
            // cols[6]=שלוחה  | cols[7]=מייל

            // ─── חפש עובד שהמחלקה שלו תואמת וצוות ריק ────────────────
            // (צוות ריק = מנהל מחלקה)
            string? bestMatch = null;
            int     bestScore = 0;

            for (int i = 1; i < lines.Length; i++)
            {
                var cols = lines[i].Split(',');
                if (cols.Length < 5) continue;

                var fullName   = cols[0]?.Trim() ?? "";
                var dept       = cols[3]?.Trim() ?? "";
                var team       = cols[4]?.Trim() ?? "";

                if (string.IsNullOrWhiteSpace(fullName)) continue;
                if (string.IsNullOrWhiteSpace(dept))     continue;

                // ─── צוות חייב להיות ריק (מנהל מחלקה) ───────────────
                if (!string.IsNullOrWhiteSpace(team)) continue;

                // ─── בדוק התאמת מחלקה ────────────────────────────────
                int score = 0;

                if (string.Equals(dept, department,
                        StringComparison.OrdinalIgnoreCase))
                {
                    score = 100; // התאמה מדויקת
                }
                else if (dept.Contains(department,
                            StringComparison.OrdinalIgnoreCase) ||
                        department.Contains(dept,
                            StringComparison.OrdinalIgnoreCase))
                {
                    score = 60; // התאמה חלקית
                }

                if (score > bestScore)
                {
                    bestScore = score;
                    bestMatch = fullName;
                }

                if (bestScore == 100) break;
            }

            if (bestMatch == null)
                return Json(new { 
                    success = false, 
                    message = $"לא נמצא מנהל מחלקה עבור: {department}" 
                });

            return Json(new
            {
                success           = true,
                departmentManager = bestMatch,
                matchScore        = bestScore
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, error = ex.Message });
        }
    }

    // ─── עזר: חשב ציון התאמת שם ─────────────────────────────────────
    private int _CalcNameMatchScore(string searchName, string candidateName)
    {
        if (string.IsNullOrWhiteSpace(searchName) ||
            string.IsNullOrWhiteSpace(candidateName))
            return 0;

        var s = searchName.Trim();
        var c = candidateName.Trim();

        // ─── התאמה מדויקת בלבד ───────────────────────────────────
        if (string.Equals(s, c, StringComparison.OrdinalIgnoreCase))
            return 100;

        return 0;
    }

    [HttpPost]
    public IActionResult UpdateContact([FromBody] ContactModel contact)
    {
        try
        {
            if (contact.Id == null)
            {
                return Json(new { success = false, message = "מזהה איש קשר חסר" });
            }

            var contacts = ReadPhoneDirectoryFromCsv(csvPath);
            var existingContact = contacts.FirstOrDefault(c => ((dynamic)c).id == contact.Id);

            if (existingContact == null)
            {
                return Json(new { success = false, message = "איש קשר לא נמצא" });
            }

            // Check for duplicate phone number (excluding current contact)
            if (!string.IsNullOrEmpty(contact.PhoneNumber))
            {
                var isDuplicate = contacts.Any(c => 
                    ((dynamic)c).phoneNumber?.ToString() == contact.PhoneNumber && 
                    ((dynamic)c).id != contact.Id);

                if (isDuplicate)
                {
                    return Json(new { success = false, message = "מספר טלפון זה כבר קיים במערכת" });
                }
            }
            // Remove old contact
            contacts.Remove(existingContact);

            // Add updated contact
            var updatedContact = new
            {
                id = contact.Id,
                fullName = contact.FullName,
                role = contact.Role,
                domain = contact.Domain ?? "",
                department = contact.Department ?? "",
                team = contact.Team ?? "",
                phoneNumber = contact.PhoneNumber,
                extension = contact.Extension ?? "",
                email = contact.Email ?? "" 
            };

            contacts.Add(updatedContact);
            SavePhoneDirectoryToCsv(csvPath, contacts);

            return Json(new { success = true, message = "איש קשר עודכן בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    [HttpPost]
    public IActionResult DeleteContact([FromBody] DeleteContactModel model)
    {
        try
        {
            if (model.Id == null)
            {
                return Json(new { success = false, message = "מזהה איש קשר חסר" });
            }

            var contacts = ReadPhoneDirectoryFromCsv(csvPath);
            var contactToDelete = contacts.FirstOrDefault(c => ((dynamic)c).id == model.Id);

            if (contactToDelete == null)
            {
                return Json(new { success = false, message = "איש קשר לא נמצא" });
            }

            contacts.Remove(contactToDelete);
            SavePhoneDirectoryToCsv(csvPath, contacts);

            return Json(new { success = true, message = "איש קשר נמחק בהצלחה" });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = ex.Message });
        }
    }

    // ─── POST: ייבא אנשי קשר מ-Excel (usersFromSns) ──────────────
    [HttpPost]
    public IActionResult ImportFromExcel([FromForm] IFormFile file)
    {
        try
        {
            if (file == null || file.Length == 0)
                return Json(new { success = false, message = "לא נבחר קובץ" });

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension != ".xlsx" && extension != ".xls")
                return Json(new { success = false, message = "יש להעלות קובץ Excel בלבד" });

            using var memStream = new MemoryStream();
            file.CopyTo(memStream);
            memStream.Position = 0;

            DataTable targetSheet;
            string sheetName = file.FileName;

            try
            {
                targetSheet = ReadXlsxFromStream(memStream);
            }
            catch
            {
                return Json(new { success = false, message = "שגיאה בקריאת הקובץ" });
            }

            if (targetSheet.Rows.Count == 0)
                return Json(new { success = false, message = "לא נמצאו נתונים בקובץ" });

        // ─── מצא עמודות ──────────────────────────────────────────
            int colEnglishName = FindImportColumnIndex(targetSheet,
                "englishname", "english name", "name", "שם אנגלי");   // ← חזר

            int colNameFromMail = FindImportColumnIndex(targetSheet,
                "namefrommail", "name from mail", "hebrew name", "שם");

            int colEmail = FindImportColumnIndex(targetSheet,
                "email", "mail", "אימייל");

            int colPhoneNum = FindImportColumnIndex(targetSheet,
                "phonenum", "phone", "phone number", "טלפון");

            // ─── וודא שיש לפחות עמודת אימייל או שם ──────────────────
            if (colEmail < 0 && colNameFromMail < 0 && colEnglishName < 0)
                return Json(new
                {
                    success = false,
                    message = "לא נמצאו עמודות נדרשות. נדרשות: email או name"
                });

            // ─── קרא נתונים ──────────────────────────────────────
            var importedUsers = new List<ImportedUserRecord>();
            var skippedRows   = new List<string>();

            foreach (DataRow row in targetSheet.Rows)
            {
                var nameFromMail = colNameFromMail >= 0
                    ? row[colNameFromMail]?.ToString()?.Trim() ?? "" : "";

                // ← הוסף חזרה
                var englishName = colEnglishName >= 0
                    ? row[colEnglishName]?.ToString()?.Trim() ?? "" : "";

                var email = colEmail >= 0
                    ? row[colEmail]?.ToString()?.Trim() ?? "" : "";

                var phoneNum = colPhoneNum >= 0
                    ? row[colPhoneNum]?.ToString()?.Trim() ?? "" : "";

                // ─── דלג על שורות ריקות ──────────────────────────────
                if (string.IsNullOrWhiteSpace(nameFromMail) &&
                    string.IsNullOrWhiteSpace(englishName)  &&
                    string.IsNullOrWhiteSpace(email))
                    continue;

                // ─── דלג על ערכים לא תקינים ──────────────────────────
                if (email.Equals("NaN", StringComparison.OrdinalIgnoreCase)         ||
                    email.Equals("undefined", StringComparison.OrdinalIgnoreCase)   ||
                    nameFromMail.Equals("undefined", StringComparison.OrdinalIgnoreCase) ||
                    englishName.Equals("undefined", StringComparison.OrdinalIgnoreCase))
                {
                    var skipName = !string.IsNullOrEmpty(nameFromMail)
                        ? nameFromMail : englishName;
                    skippedRows.Add($"'{skipName}' - ערך לא תקין");
                    continue;
                }

                // ─── דלג על רשימות תפוצה ─────────────────────────────
                if (IsDistributionList(email))
                {
                    var skipName = !string.IsNullOrEmpty(nameFromMail)
                        ? nameFromMail : englishName;
                    skippedRows.Add($"'{skipName}' - רשימת תפוצה");
                    continue;
                }

                var cleanPhone  = NormalizeImportPhone(phoneNum);
                var isExtension = IsExtensionNumber(cleanPhone);

                // ─── לוגיקת שם: עברית > אנגלית ──────────────────────
                var hebrewName = (!nameFromMail.Contains("@") &&
                                !string.IsNullOrWhiteSpace(nameFromMail))
                                    ? nameFromMail.Trim()
                                    : "";

                // ─── שם סופי: עברית אם קיים, אחרת אנגלית ────────────
                var finalName = !string.IsNullOrWhiteSpace(hebrewName)
                    ? hebrewName
                    : englishName;

                importedUsers.Add(new ImportedUserRecord
                {
                    NameFromMail = nameFromMail,
                    HebrewName   = finalName,   // ← עברית או אנגלית כ-fallback
                    Email        = email,
                    PhoneNum     = cleanPhone,
                    IsExtension  = isExtension
                });
            }

            if (importedUsers.Count == 0)
                return Json(new { success = false, message = "לא נמצאו נתונים תקינים בקובץ" });

            var existingContacts = ReadPhoneDirectoryFromCsv(csvPath);
            var comparison       = CompareImportedUsers(importedUsers, existingContacts);

            return Json(new
            {
                success       = true,
                sheetName     = sheetName,
                totalImported = importedUsers.Count,
                skippedCount  = skippedRows.Count,
                skippedRows   = skippedRows.Take(20).ToList(),
                data          = comparison
            });
        }
        catch (Exception ex)
        {
            return Json(new { success = false, message = $"Error: {ex.Message}" });
        }
    }

    // ─── POST: שמור משתמשים נבחרים מהייבוא ──────────────────────
    [HttpPost]
    public IActionResult SaveImportedContacts(
        [FromBody] SaveImportedContactsRequest request)
    {
        try
        {
            if (request?.Contacts == null ||
                request.Contacts.Count == 0)
                return Json(new
                {
                    success = false,
                    message = "לא נשלחו אנשי קשר לשמירה"
                });

            var existingContacts = ReadPhoneDirectoryFromCsv(csvPath);

            // ─── מצא ID מקסימלי קיים ─────────────────────────────
            var maxId = existingContacts.Any()
                ? existingContacts.Max(c => ((dynamic)c).id)
                : 0;

            var added   = new List<string>();
            var skipped = new List<string>();
            var errors  = new List<string>();

            foreach (var contact in request.Contacts)
            {
                try
                {
                    // ─── עדכון איש קשר קיים (changed) ────────────────
                    if (contact.Id.HasValue)
                    {
                        var existingToUpdate = existingContacts
                            .FirstOrDefault(c =>
                                ((dynamic)c).id == contact.Id.Value);

                        if (existingToUpdate != null)
                        {
                            existingContacts.Remove(existingToUpdate);
                            var existingDyn = (dynamic)existingToUpdate;

                            var updatedContact = new
                            {
                                id          = contact.Id.Value,
                                fullName    = existingDyn.fullName?.ToString()   ?? "",
                                role        = existingDyn.role?.ToString()       ?? "",
                                domain      = existingDyn.domain?.ToString()     ?? "",
                                department  = existingDyn.department?.ToString() ?? "",
                                team        = existingDyn.team?.ToString()       ?? "",
                                phoneNumber = contact.PhoneNumber                ?? "",
                                extension   = contact.Extension                  ?? "",
                                email       = existingDyn.email?.ToString()      ?? ""
                            };

                            existingContacts.Add(updatedContact);
                            added.Add(existingDyn.fullName?.ToString() ?? "");
                        }
                        else
                        {
                            skipped.Add(contact.FullName ?? "");
                        }
                        continue;
                    }

                    // ─── הוספת איש קשר חדש ───────────────────────────
                    bool emailExists =
                        !string.IsNullOrEmpty(contact.Email) &&
                        existingContacts.Any(c =>
                            string.Equals(
                                ((dynamic)c).email?.ToString(),
                                contact.Email,
                                StringComparison.OrdinalIgnoreCase));

                    // ─── בדוק כפילות לפי טלפון ───────────────────
                    bool phoneExists =
                        !string.IsNullOrEmpty(contact.PhoneNumber) &&
                        existingContacts.Any(c =>
                            ((dynamic)c).phoneNumber?.ToString()
                                == contact.PhoneNumber);

                    if (emailExists || phoneExists)
                    {
                        skipped.Add(contact.FullName ?? "");
                        continue;
                    }

                    maxId++;

                    var newContact = new
                    {
                        id          = maxId,
                        fullName    = contact.FullName    ?? "",
                        role        = contact.Role        ?? "",
                        domain      = contact.Domain      ?? "",
                        department  = contact.Department  ?? "",
                        team        = contact.Team        ?? "",
                        phoneNumber = contact.PhoneNumber ?? "",
                        extension   = contact.Extension   ?? "",
                        email       = contact.Email       ?? ""
                    };

                    existingContacts.Add(newContact);
                    added.Add(contact.FullName ?? "");
                }
                catch (Exception ex)
                {
                    errors.Add(
                        $"שגיאה בשמירת '{contact.FullName}': " +
                        ex.Message);
                }
            }

            if (added.Count > 0)
                SavePhoneDirectoryToCsv(csvPath, existingContacts);

            return Json(new
            {
                success      = true,
                addedCount   = added.Count,
                skippedCount = skipped.Count,
                addedNames   = added,
                skippedNames = skipped,
                errors       = errors,
                message      = $"נוספו/עודכנו {added.Count} אנשי קשר" +
                    (skipped.Count > 0
                        ? $" | {skipped.Count} דולגו"
                        : "")
            });
        }
        catch (Exception ex)
        {
            return Json(new
            {
                success = false,
                message = $"שגיאה בשמירה: {ex.Message}"
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // פונקציות עזר פרטיות - ייבוא Excel
    // ═══════════════════════════════════════════════════════════════
    // ─── קרא XLSX - זהה ל-ServersController ──────────────────────
    private DataTable ReadXlsxToDataTableForImport(string filePath)
    {
        // ← אותה פונקציה בדיוק כמו ב-ServersController
        return ReadXlsxFromStream(System.IO.File.OpenRead(filePath));
    }

    private DataTable ReadXlsxFromStream(Stream fileStream)
    {
        var dt = new DataTable();

        using var zip = new ZipArchive(fileStream, ZipArchiveMode.Read);

        // ─── שלב 1: SharedStrings ────────────────────────────────
        var sharedStrings = new List<string>();
        var ssEntry = zip.GetEntry("xl/sharedStrings.xml");
        if (ssEntry != null)
        {
            using var stream = ssEntry.Open();
            var xdoc = XDocument.Load(stream);
            XNamespace ns =
                "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

            foreach (var si in xdoc.Descendants(ns + "si"))
            {
                var text = string.Concat(
                    si.Descendants(ns + "t").Select(t => t.Value));
                sharedStrings.Add(text);
            }
        }

        // ─── שלב 2: מצא גיליון ראשון ─────────────────────────────
        string sheet1File = "xl/worksheets/sheet1.xml";
        var wbEntry = zip.GetEntry("xl/workbook.xml");
        if (wbEntry != null)
        {
            using var stream = wbEntry.Open();
            var xdoc = XDocument.Load(stream);
            XNamespace ns =
                "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

            var firstSheet = xdoc.Descendants(ns + "sheet").FirstOrDefault();
            if (firstSheet != null)
            {
                var rId = firstSheet.Attribute(
                    XNamespace.Get(
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                    ) + "id")?.Value;

                if (rId != null)
                {
                    var relsEntry = zip.GetEntry("xl/_rels/workbook.xml.rels");
                    if (relsEntry != null)
                    {
                        using var relsStream = relsEntry.Open();
                        var relsDoc = XDocument.Load(relsStream);
                        XNamespace relsNs =
                            "http://schemas.openxmlformats.org/package/2006/relationships";

                        var target = relsDoc
                            .Descendants(relsNs + "Relationship")
                            .FirstOrDefault(r => r.Attribute("Id")?.Value == rId)
                            ?.Attribute("Target")?.Value;

                        if (target != null)
                            sheet1File = target.StartsWith("xl/")
                                ? target : $"xl/{target}";
                    }
                }
            }
        }

        // ─── שלב 3: קרא גיליון ───────────────────────────────────
        var sheetEntry = zip.GetEntry(sheet1File);
        if (sheetEntry == null) return dt;

        using var sheetStream = sheetEntry.Open();
        var sheetDoc = XDocument.Load(sheetStream);
        XNamespace sheetNs =
            "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

        var rows = sheetDoc.Descendants(sheetNs + "row").ToList();
        if (rows.Count == 0) return dt;

        // ─── כותרות ──────────────────────────────────────────────
        var headerRow = rows[0];
        var headers   = new List<string>();

        foreach (var cell in headerRow.Elements(sheetNs + "c"))
        {
            string val = GetCellValueForImport(cell, sharedStrings, sheetNs);
            headers.Add(val);
            dt.Columns.Add(string.IsNullOrEmpty(val)
                ? $"Col{headers.Count}" : val);
        }

        // ─── נתונים ──────────────────────────────────────────────
        for (int rowIdx = 1; rowIdx < rows.Count; rowIdx++)
        {
            var row    = rows[rowIdx];
            var drData = dt.NewRow();

            foreach (var cell in row.Elements(sheetNs + "c"))
            {
                string cellRef = cell.Attribute("r")?.Value ?? "";
                int colIndex   = GetColumnIndexForImport(cellRef);

                if (colIndex >= 0 && colIndex < dt.Columns.Count)
                    drData[colIndex] = GetCellValueForImport(
                        cell, sharedStrings, sheetNs);
            }

            dt.Rows.Add(drData);
        }

        return dt;
    }

    private string GetCellValueForImport(
        XElement     cell,
        List<string> sharedStrings,
        XNamespace   ns)
    {
        var valueEl = cell.Element(ns + "v");
        if (valueEl == null) return "";

        string cellType = cell.Attribute("t")?.Value ?? "";

        if (cellType == "s")
        {
            if (int.TryParse(valueEl.Value, out int idx) &&
                idx >= 0 && idx < sharedStrings.Count)
                return sharedStrings[idx];
            return "";
        }

        if (cellType == "inlineStr")
            return cell.Element(ns + "is")
                    ?.Element(ns + "t")?.Value ?? "";

        return valueEl.Value;
    }

    private int GetColumnIndexForImport(string cellRef)
    {
        if (string.IsNullOrEmpty(cellRef)) return -1;

        string colLetters = new string(
            cellRef.TakeWhile(char.IsLetter).ToArray());

        if (string.IsNullOrEmpty(colLetters)) return -1;

        int index = 0;
        foreach (char c in colLetters.ToUpper())
            index = index * 26 + (c - 'A' + 1);

        return index - 1;
    }

    // ─── מצא אינדקס עמודה לפי שם (case-insensitive) ─────────────
    private int FindImportColumnIndex(
        DataTable dt, params string[] names)
    {
        foreach (var name in names)
        {
            for (int i = 0; i < dt.Columns.Count; i++)
            {
                if (string.Equals(
                        dt.Columns[i].ColumnName.Trim(),
                        name,
                        StringComparison.OrdinalIgnoreCase))
                    return i;
            }
        }
        return -1;
    }

    // ─── בדוק אם לגיליון יש עמודות נדרשות ───────────────────────
    private bool HasRequiredImportColumns(DataTable dt)
    {
        var colNames = dt.Columns
            .Cast<DataColumn>()
            .Select(c => c.ColumnName.ToLowerInvariant())
            .ToHashSet();

        return (colNames.Contains("englishname") ||
                colNames.Contains("english name")) &&
            colNames.Contains("email");
    }

    // ─── בדוק אם רשימת תפוצה ─────────────────────────────────────
    private bool IsDistributionList(string email)
    {
        if (string.IsNullOrWhiteSpace(email)) return false;

        var lower = email.ToLowerInvariant();

        // PDL = Personal Distribution List
        if (lower.StartsWith("pdl-")) return true;
        if (lower.StartsWith("pdl_")) return true;

        // כתובות מיוחדות ידועות
        var knownDL = new HashSet<string>(
            StringComparer.OrdinalIgnoreCase)
        {
            "noc@menoramivt.co.il",
            "cyber@menora.co.il",
            "security.team@menora.co.il",
            "soc.team@menoramivt.co.il",
            "tsystem@menora.co.il",
            "mft@menora.co.il",
            "itelement@menora.co.il",
            "resilientsoc@menoramivt.net",
            "promotions-room@menoramivt.net",
            "securityroomusr@menoramivt.net",
            "on-support@menoramivt.co.il",
            "dba.alerts@menoramivt.net",
            "dlp-rpa-support@menoramivt.net",
            "siebel-crm-alerts@menoramivt.net",
            "hadarmarchev@menora.co.il",
            "bmcmail@menora.co.il"
        };

        if (knownDL.Contains(email)) return true;

        // דפוסים של רשימות תפוצה
        if (lower.Contains("-alerts@"))  return true;
        if (lower.Contains("-support@")) return true;
        if (lower.Contains("-team@"))    return true;
        if (lower.Contains("-noc@"))     return true;
        if (lower.Contains("-mon@"))     return true;
        if (lower.Contains("-room@"))    return true;

        return false;
    }

    // ─── נרמל מספר טלפון ─────────────────────────────────────────
    private string NormalizeImportPhone(string phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return "";

        // ─── סנן ערכים לא תקינים ─────────────────────────────────
        if (phone.Equals("NaN",
                StringComparison.OrdinalIgnoreCase) ||
            phone.Equals("undefined",
                StringComparison.OrdinalIgnoreCase) ||
            phone.Equals("null",
                StringComparison.OrdinalIgnoreCase))
            return "";

        var digitsOnly = new string(
            phone.Where(char.IsDigit).ToArray());

        if (string.IsNullOrEmpty(digitsOnly)) return "";

        // ─── שלוחה פנימית (3-4 ספרות) ───────────────────────────
        if (digitsOnly.Length >= 3 &&
            digitsOnly.Length <= 4)
            return digitsOnly;

        // ─── מספר ישראלי (10 ספרות) ──────────────────────────────
        if (digitsOnly.Length == 10)
            return $"{digitsOnly[..3]}-{digitsOnly[3..]}";

        // ─── מספר עם קידומת 972 ──────────────────────────────────
        if (digitsOnly.Length == 12 &&
            digitsOnly.StartsWith("972"))
        {
            var local = "0" + digitsOnly[3..];
            return $"{local[..3]}-{local[3..]}";
        }

        return phone.Trim();
    }

    // ─── בדוק אם מספר הוא שלוחה ──────────────────────────────────
    private bool IsExtensionNumber(string phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return false;
        var digits = new string(
            phone.Where(char.IsDigit).ToArray());
        return digits.Length >= 3 && digits.Length <= 4;
    }

    // ─── השווה משתמשים מיובאים עם אנשי קשר קיימים ───────────────
    private ImportComparisonResult CompareImportedUsers(
        List<ImportedUserRecord> importedUsers,
        List<object>             existingContacts)
    {
        var newUsers     = new List<NewUserSuggestion>();
        var changedUsers = new List<ChangedUserInfo>();
        var duplicates   = new List<DuplicateUserInfo>();

        // ─── בנה אינדקסים ────────────────────────────────────────
        var byEmail = new Dictionary<string, object>(
            StringComparer.OrdinalIgnoreCase);
        var byPhone = new Dictionary<string, object>();
        var byName  = new Dictionary<string, object>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var c in existingContacts)
        {
            var contact  = (dynamic)c;
            var email    = contact.email?.ToString()       ?? "";
            var phone    = contact.phoneNumber?.ToString() ?? "";
            var fullName = contact.fullName?.ToString()    ?? "";

            if (!string.IsNullOrEmpty(email)    && !byEmail.ContainsKey(email))
                byEmail[email] = c;
            if (!string.IsNullOrEmpty(phone)    && !byPhone.ContainsKey(phone))
                byPhone[phone] = c;
            if (!string.IsNullOrEmpty(fullName) && !byName.ContainsKey(fullName))
                byName[fullName] = c;
        }

        foreach (var user in importedUsers)
        {
            object? matchedContact = null;
            string  matchReason    = "";

            // ─── חיפוש התאמה - רק לפי אימייל, טלפון, שם עברי ────
            if (!string.IsNullOrEmpty(user.Email) &&
                byEmail.TryGetValue(user.Email, out var byEmailMatch))
            {
                matchedContact = byEmailMatch;
                matchReason    = "אימייל";
            }
            else if (!string.IsNullOrEmpty(user.PhoneNum) &&
                    !user.IsExtension &&
                    byPhone.TryGetValue(user.PhoneNum, out var byPhoneMatch))
            {
                matchedContact = byPhoneMatch;
                matchReason    = "טלפון";
            }
            else if (!string.IsNullOrEmpty(user.HebrewName) &&
                    byName.TryGetValue(user.HebrewName, out var byNameMatch))
            {
                matchedContact = byNameMatch;
                matchReason    = "שם";
            }

            if (matchedContact == null)
            {
                // ─── חדש לחלוטין ─────────────────────────────────
                newUsers.Add(new NewUserSuggestion
                {
                    HebrewName         = user.HebrewName,
                    NameFromMail       = user.NameFromMail,
                    Email              = user.Email,
                    PhoneNum           = user.PhoneNum,
                    IsExtension        = user.IsExtension,
                    SuggestedFullName  = user.HebrewName,
                    SuggestedPhone     = user.IsExtension ? "" : user.PhoneNum,
                    SuggestedExtension = user.IsExtension ? user.PhoneNum : "",
                    SuggestedEmail     = user.Email
                });
                continue;
            }

            // ─── נמצאה התאמה ─────────────────────────────────────
            var existing     = (dynamic)matchedContact;
            var existingName = existing.fullName?.ToString()    ?? "";
            var existingExt  = existing.extension?.ToString()   ?? "";
            var existingPh   = existing.phoneNumber?.ToString() ?? "";
            var existingEm   = existing.email?.ToString()       ?? "";

            var importedPhone = user.IsExtension ? "" : user.PhoneNum;
            var importedExt   = user.IsExtension ? user.PhoneNum : "";

            // ─── בדוק שינויים ────────────────────────────────────
            var changedFields = new List<string>();

            // ─── לוגיקת טלפון חכמה ───────────────────────────────
            string finalPhone = existingPh;
            string finalExt   = existingExt;

            if (!string.IsNullOrEmpty(importedPhone))
            {
                if (string.IsNullOrEmpty(existingPh))
                {
                    finalPhone = importedPhone;
                    changedFields.Add("טלפון (נוסף)");
                }
                else if (!string.Equals(existingPh, importedPhone,
                            StringComparison.OrdinalIgnoreCase))
                {
                    finalPhone = importedPhone;
                    changedFields.Add("טלפון (עודכן)");
                }
            }

            if (!string.IsNullOrEmpty(importedExt))
            {
                if (string.IsNullOrEmpty(existingExt))
                {
                    finalExt = importedExt;
                    changedFields.Add("שלוחה (נוספה)");
                }
                else if (!string.Equals(existingExt, importedExt,
                            StringComparison.OrdinalIgnoreCase))
                {
                    finalExt = importedExt;
                    changedFields.Add("שלוחה (עודכנה)");
                }
            }

            // ─── בדוק שינוי אימייל ───────────────────────────────
            bool emailMatch = string.Equals(existingEm, user.Email,
                                StringComparison.OrdinalIgnoreCase);

            // ─── אין שינויים → קיים זהה ──────────────────────────
            if (changedFields.Count == 0)
            {
                duplicates.Add(new DuplicateUserInfo
                {
                    ImportedHebrewName = user.HebrewName,
                    ImportedEmail      = user.Email,
                    ImportedPhone      = user.PhoneNum,
                    ExistingFullName   = existingName,
                    ExistingEmail      = existingEm,
                    ExistingPhone      = existingPh,
                    MatchReason        = matchReason
                });
                continue;
            }

            // ─── יש שינויים ──────────────────────────────────────
            int? existingIdInt = null;
            try { existingIdInt = (int)existing.id; } catch { }

            changedUsers.Add(new ChangedUserInfo
            {
                ImportedHebrewName = user.HebrewName,
                ImportedEmail      = user.Email,
                ImportedPhone      = importedPhone,
                ImportedExtension  = importedExt,
                ExistingFullName   = existingName,
                ExistingEmail      = existingEm,
                ExistingPhone      = existingPh,
                ExistingExtension  = existingExt,
                MatchReason        = matchReason,
                ChangedFields      = changedFields,
                SuggestedFullName  = existingName,
                SuggestedPhone     = finalPhone,
                SuggestedExtension = finalExt,
                SuggestedEmail     = existingEm,
                ExistingId         = existingIdInt
            });
        }

        return new ImportComparisonResult
        {
            NewUsers     = newUsers,
            ChangedUsers = changedUsers,
            Duplicates   = duplicates,
            Summary      = new ImportSummary
            {
                Total          = importedUsers.Count,
                NewCount       = newUsers.Count,
                ChangedCount   = changedUsers.Count,
                DuplicateCount = duplicates.Count
            }
        };
    }

    private List<object> ReadPhoneDirectoryFromCsv(string filePath)
    {
        try
        {
            if (!System.IO.File.Exists(filePath))
            {
                return new List<object>();
            }

            var lines = System.IO.File.ReadAllLines(filePath);
            var phoneDirectory = new List<object>();

            // Skip header row
            for (int i = 1; i < lines.Length; i++)
            {
                var columns = lines[i].Split(',');
                
                if (columns.Length >= 3)
                {
                    var fullName = columns[0]?.Trim();
                    var role = columns[1]?.Trim();
                    var domain = columns.Length > 2 ? columns[2]?.Trim() : "";
                    var department = columns.Length > 3 ? columns[3]?.Trim() : "";
                    var team = columns.Length > 4 ? columns[4]?.Trim() : "";
                    var phoneNumber = columns.Length > 5 ? columns[5]?.Trim() : "";
                    var extension = columns.Length > 6 ? columns[6]?.Trim() : "";
                    var email = columns.Length > 7 ? columns[7]?.Trim() : "";  

                    // Skip empty rows
                    if (string.IsNullOrEmpty(fullName) && 
                        string.IsNullOrEmpty(role) && 
                        string.IsNullOrEmpty(phoneNumber))
                    {
                        continue;
                    }

                    phoneDirectory.Add(new
                    {
                        id = i,
                        fullName = fullName ?? "",
                        role = role ?? "",
                        domain = domain ?? "",
                        department = department ?? "",
                        team = team ?? "",
                        phoneNumber = phoneNumber ?? "",
                        extension = extension ?? "",
                        email = email ?? "" 
                    });
                }
            }

            return phoneDirectory.OrderBy(p => ((dynamic)p).fullName).ToList();
        }
        catch (Exception)
        {
            return new List<object>();
        }
    }

    private void SavePhoneDirectoryToCsv(string filePath, List<object> contacts)
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
            lines.Add("שם מלא,תפקיד,תחום,מחלקה,צוות,טלפון,שלוחה,מייל");

            // Add contacts (sorted by name)
            var sortedContacts = contacts.OrderBy(c => ((dynamic)c).fullName).ToList();
            
            foreach (var contact in sortedContacts)
            {
                var c = (dynamic)contact;
                lines.Add($"{c.fullName},{c.role},{c.domain ?? ""},{c.department ?? ""},{c.team ?? ""},{c.phoneNumber},{c.extension ?? ""},{c.email ?? ""}");
            }

            System.IO.File.WriteAllLines(filePath, lines);
        }
        catch (Exception ex)
        {
            throw new Exception($"שגיאה בשמירת הקובץ: {ex.Message}");
        }
    }

    private List<object> GetDefaultPhoneDirectory()
    {
        return new List<object>
        {
            new { id = 1, fullName = "דוגמה - ישראל ישראלי", role = "מנהל מערכות", domain = "IT", department = "תשתיות", team = "צוות א'", phoneNumber = "03-1234567", extension = "101" },
            new { id = 2, fullName = "דוגמה - שרה כהן", role = "מנהלת פרויקטים", domain = "ניהול", department = "פרויקטים", team = "צוות ב'", phoneNumber = "03-7654321", extension = "102" },
            new { id = 3, fullName = "דוגמה - דוד לוי", role = "מהנדס תשתיות", domain = "IT", department = "תשתיות", team = "צוות א'", phoneNumber = "03-1112223", extension = "103" }
        };
    }

        // ═══════════════════════════════════════════════════════════
    // MODELS - כל המודלים במקום אחד
    // ═══════════════════════════════════════════════════════════

    public class ContactModel
    {
        public int?   Id          { get; set; }
        public string FullName    { get; set; } = "";
        public string Role        { get; set; } = "";
        public string Domain      { get; set; } = "";
        public string Department  { get; set; } = "";
        public string Team        { get; set; } = "";
        public string PhoneNumber { get; set; } = "";
        public string Extension   { get; set; } = "";
        public string Email       { get; set; } = "";
    }

    public class DeleteContactModel
    {
        public int? Id { get; set; }
    }

    public class ImportedUserRecord
    {
        public string NameFromMail { get; set; } = "";
        public string HebrewName   { get; set; } = "";
        public string Email        { get; set; } = "";
        public string PhoneNum     { get; set; } = "";
        public bool   IsExtension  { get; set; } = false;
    }

    public class NewUserSuggestion
    {
        public string HebrewName         { get; set; } = "";
        public string NameFromMail       { get; set; } = "";
        public string Email              { get; set; } = "";
        public string PhoneNum           { get; set; } = "";
        public bool   IsExtension        { get; set; } = false;
        public string SuggestedFullName  { get; set; } = "";
        public string SuggestedPhone     { get; set; } = "";
        public string SuggestedExtension { get; set; } = "";
        public string SuggestedEmail     { get; set; } = "";
    }

    public class ChangedUserInfo
    {
        public string       ImportedHebrewName  { get; set; } = "";
        public string       ImportedEmail       { get; set; } = "";
        public string       ImportedPhone       { get; set; } = "";
        public string       ImportedExtension   { get; set; } = "";
        public string       ExistingFullName    { get; set; } = "";
        public string       ExistingEmail       { get; set; } = "";
        public string       ExistingPhone       { get; set; } = "";
        public string       ExistingExtension   { get; set; } = "";
        public string       MatchReason         { get; set; } = "";
        public List<string> ChangedFields       { get; set; } = new();
        public string       SuggestedFullName   { get; set; } = "";
        public string       SuggestedPhone      { get; set; } = "";  // אחרי מיזוג
        public string       SuggestedExtension  { get; set; } = "";  // אחרי מיזוג
        public string       SuggestedEmail      { get; set; } = "";
        public int?         ExistingId          { get; set; }
    }

    public class DuplicateUserInfo
    {
        public string ImportedHebrewName  { get; set; } = "";
        public string ImportedEmail       { get; set; } = "";
        public string ImportedPhone       { get; set; } = "";
        public string ExistingFullName    { get; set; } = "";
        public string ExistingEmail       { get; set; } = "";
        public string ExistingPhone       { get; set; } = "";
        public string MatchReason         { get; set; } = "";
    }

    public class ImportComparisonResult
    {
        public List<NewUserSuggestion> NewUsers     { get; set; } = new();
        public List<ChangedUserInfo>   ChangedUsers { get; set; } = new();
        public List<DuplicateUserInfo> Duplicates   { get; set; } = new();
        public ImportSummary           Summary      { get; set; } = new();
    }

    public class ImportSummary
    {
        public int Total          { get; set; } = 0;
        public int NewCount       { get; set; } = 0;
        public int ChangedCount   { get; set; } = 0;
        public int DuplicateCount { get; set; } = 0;
    }

    public class SaveImportedContactsRequest
    {
        public List<ContactModel> Contacts { get; set; } = new();
    }

}

public class OrgInfoResult
{
    public string FullName   { get; set; } = "";
    public string Role       { get; set; } = "";
    public string Domain     { get; set; } = "";
    public string Department { get; set; } = "";
    public string Team       { get; set; } = "";
    public string Email      { get; set; } = "";
    public int    MatchScore { get; set; } = 0;
}