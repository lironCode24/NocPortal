using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

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
            // Validate required fields: FullName, Role, and at least one of Extension/PhoneNumber
            if (string.IsNullOrEmpty(contact.FullName) || 
                string.IsNullOrEmpty(contact.Role))
            {
                return Json(new { success = false, message = "שם מלא ותפקיד הם שדות חובה" });
            }

            // Check that at least one contact method exists (Extension OR PhoneNumber)
            if (string.IsNullOrEmpty(contact.Extension) && string.IsNullOrEmpty(contact.PhoneNumber))
            {
                return Json(new { success = false, message = "חייב למלא לפחות אחד מהשדות: שלוחה או טלפון" });
            }

            var contacts = ReadPhoneDirectoryFromCsv(csvPath);
            
            // Check for duplicate phone number (only if phone number is provided)
            if (!string.IsNullOrEmpty(contact.PhoneNumber))
            {
                var isDuplicate = contacts.Any(c => ((dynamic)c).phoneNumber == contact.PhoneNumber);
                if (isDuplicate)
                {
                    return Json(new { success = false, message = "מספר טלפון זה כבר קיים במערכת" });
                }
            }
            
            // Check for duplicate extension (only if extension is provided)
            if (!string.IsNullOrEmpty(contact.Extension))
            {
                var isDuplicateExt = contacts.Any(c => ((dynamic)c).extension == contact.Extension);
                if (isDuplicateExt)
                {
                    return Json(new { success = false, message = "שלוחה זו כבר קיימת במערכת" });
                }
            }
            
            // Generate new ID
            var maxId = contacts.Any() ? contacts.Max(c => ((dynamic)c).id) : 0;
            var newContact = new
            {
                id = maxId + 1,
                fullName = contact.FullName,
                role = contact.Role,
                domain = contact.Domain ?? "",
                department = contact.Department ?? "",
                team = contact.Team ?? "",
                phoneNumber = contact.PhoneNumber ?? "",
                extension = contact.Extension ?? "",
                email = contact.Email ?? "" 
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
            var isDuplicate = contacts.Any(c => 
                ((dynamic)c).phoneNumber == contact.PhoneNumber && 
                ((dynamic)c).id != contact.Id);
            
            if (isDuplicate)
            {
                return Json(new { success = false, message = "מספר טלפון זה כבר קיים במערכת" });
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

    // Models
    public class ContactModel
    {
        public int? Id { get; set; }
        public string FullName { get; set; }
        public string Role { get; set; }
        public string Domain { get; set; }
        public string Department { get; set; }
        public string Team { get; set; }
        public string PhoneNumber { get; set; }
        public string Extension { get; set; }
        public string Email { get; set; } 
    }

    public class DeleteContactModel
    {
        public int? Id { get; set; }
    }
}