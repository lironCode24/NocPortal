using NocPortal.Models;
using System.Text.Json;

namespace NocPortal.Services
{
    public class SystemMessageService
    {
        // ── נתיב קובץ JSON ────────────────────────────────────────────
        private readonly string      _filePath;
        private readonly object      _lock = new();
        private readonly UserService _userService;

        public SystemMessageService(
            IWebHostEnvironment env,
            UserService         userService)
        {
            var filesRoot = Path.Combine(env.WebRootPath, "assets", "files");
            _filePath = Path.Combine(filesRoot, "system_messages.json");
            _userService = userService;

            // צור תיקייה אם לא קיימת
            var dir = Path.GetDirectoryName(_filePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);
        }

        // ── טעינת כל ההודעות ──────────────────────────────────────────
        private List<SystemMessage> LoadAll()
        {
            lock (_lock)
            {
                if (!File.Exists(_filePath))
                    return new List<SystemMessage>();

                var json = File.ReadAllText(_filePath);
                return JsonSerializer.Deserialize<List<SystemMessage>>(json)
                       ?? new List<SystemMessage>();
            }
        }

        // ── שמירת כל ההודעות ──────────────────────────────────────────
        private void SaveAll(List<SystemMessage> messages)
        {
            lock (_lock)
            {
                var json = JsonSerializer.Serialize(messages,
                    new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_filePath, json);
            }
        }

        // ── יצירת הודעה חדשה ──────────────────────────────────────────
        public (bool success, string message) CreateMessage(
            string        title,
            string        content,
            string        createdBy,
            List<string>? targetUserIds = null,
            List<string>? targetRoles   = null)
        {
            if (string.IsNullOrWhiteSpace(title))
                return (false, "כותרת ההודעה לא יכולה להיות ריקה");

            if (string.IsNullOrWhiteSpace(content))
                return (false, "תוכן ההודעה לא יכול להיות ריק");

            var messages = LoadAll();
            messages.Add(new SystemMessage
            {
                Title         = title.Trim(),
                Content       = content.Trim(),
                CreatedBy     = createdBy,
                TargetUserIds = targetUserIds,
                TargetRoles   = targetRoles,  
                IsActive      = true
            });

            SaveAll(messages);
            return (true, "ההודעה נוצרה בהצלחה");
        }

        // ── שליפת הודעות פעילות למשתמש ───────────────────────────────
        // מחזיר הודעות שהמשתמש טרם אישר
        public List<SystemMessage> GetPendingForUser(string userId, string userRole = "")
        {
            var messages = LoadAll();
            return messages
                .Where(m =>
                {
                    bool userMatch =
                        m.TargetUserIds != null &&
                        m.TargetUserIds.Contains(userId);

                    bool roleMatch =
                        m.TargetRoles != null &&
                        m.TargetRoles.Contains(userRole,
                            StringComparer.OrdinalIgnoreCase);

                    bool globalMessage =
                        (m.TargetUserIds == null || !m.TargetUserIds.Any()) &&
                        (m.TargetRoles == null || !m.TargetRoles.Any());

                    return m.IsActive &&
                        (globalMessage || userMatch || roleMatch) &&
                        !m.Acknowledgments.Any(a => a.UserId == userId);
                })
                .OrderByDescending(m => m.CreatedAt)
                .ToList();
        }

        // מחזיר הודעות שהמשתמש כבר אישר
        public List<SystemMessage> GetAcknowledgedForUser(string userId, string userRole = "")
        {
            var messages = LoadAll();

            return messages
                .Where(m =>
                {
                    bool userMatch =
                        m.TargetUserIds != null &&
                        m.TargetUserIds.Contains(userId);

                    bool roleMatch =
                        m.TargetRoles != null &&
                        m.TargetRoles.Contains(userRole,
                            StringComparer.OrdinalIgnoreCase);

                    bool globalMessage =
                        (m.TargetUserIds == null || !m.TargetUserIds.Any()) &&
                        (m.TargetRoles == null || !m.TargetRoles.Any());

                    return m.IsActive &&
                        (globalMessage || userMatch || roleMatch) &&
                        m.Acknowledgments.Any(a => a.UserId == userId);
                })
                .OrderByDescending(m => m.CreatedAt)
                .ToList();
        }

        // ── אישור קריאה ───────────────────────────────────────────────
        public (bool success, string message) AcknowledgeMessage(
            string messageId,
            string userId,
            string username,
            string displayName)
        {
            var messages = LoadAll();
            var msg      = messages.FirstOrDefault(m => m.Id == messageId);

            if (msg == null)
                return (false, "הודעה לא נמצאה");

            // בדוק אם כבר אישר
            if (msg.Acknowledgments.Any(a => a.UserId == userId))
                return (true, "ההודעה כבר אושרה");

            msg.Acknowledgments.Add(new MessageAcknowledgment
            {
                UserId        = userId,
                Username      = username,
                DisplayName   = displayName,
                AcknowledgedAt = DateTime.UtcNow
            });

            SaveAll(messages);
            return (true, "ההודעה אושרה בהצלחה");
        }

        // ── שליחת הודעה מחדש למשתמש (מחיקת האישור שלו) ───────────────
        public (bool success, string message) ResendToUser(
            string messageId,
            string userId)
        {
            var messages = LoadAll();
            var msg      = messages.FirstOrDefault(m => m.Id == messageId);

            if (msg == null)
                return (false, "הודעה לא נמצאה");

            if (!msg.IsActive)
                return (false, "לא ניתן לשלוח מחדש הודעה שבוטלה");

            var ack = msg.Acknowledgments
                        .FirstOrDefault(a => a.UserId == userId);

            if (ack != null)
                msg.Acknowledgments.Remove(ack);
            // אם לא אישר - ההודעה כבר ממתינה לו, אין מה לעשות
            // אבל נוודא שהמשתמש ברשימת הנמענים אם ההודעה ממוקדת
            else if (msg.TargetUserIds != null &&
                    !msg.TargetUserIds.Contains(userId))
            {
                msg.TargetUserIds.Add(userId);
            }

            SaveAll(messages);
            return (true, "ההודעה תישלח מחדש למשתמש");
        }

        // ── שליפת כל ההודעות (לאדמין) ────────────────────────────────
        public List<SystemMessage> GetAll()
            => LoadAll().OrderByDescending(m => m.CreatedAt).ToList();

        // ── שליפת הודעה לפי ID ────────────────────────────────────────
        public SystemMessage? GetById(string messageId)
            => LoadAll().FirstOrDefault(m => m.Id == messageId);

        // ── ביטול הודעה ───────────────────────────────────────────────
        public (bool success, string message) DeactivateMessage(string messageId)
        {
            var messages = LoadAll();
            var msg      = messages.FirstOrDefault(m => m.Id == messageId);

            if (msg == null)
                return (false, "הודעה לא נמצאה");

            msg.IsActive = false;
            SaveAll(messages);
            return (true, "ההודעה בוטלה בהצלחה");
        }

        // ── עריכת הודעה ───────────────────────────────────────────────
        public (bool success, string message) EditMessage(
            string        messageId,
            string        title,
            string        content,
            List<string>? targetUserIds,
            List<string>? targetRoles   = null)
        {
            if (string.IsNullOrWhiteSpace(title))
                return (false, "כותרת ההודעה לא יכולה להיות ריקה");

            if (string.IsNullOrWhiteSpace(content))
                return (false, "תוכן ההודעה לא יכול להיות ריק");

            var messages = LoadAll();
            var msg      = messages.FirstOrDefault(m => m.Id == messageId);

            if (msg == null)
                return (false, "הודעה לא נמצאה");

            // ── עדכן שדות ─────────────────────────────────────────────
            msg.Title         = title.Trim();
            msg.Content       = content.Trim();
            msg.EditedAt      = DateTime.UtcNow;  // תאריך עריכה
            msg.IsEdited      = true;             // סימון עריכה
            msg.TargetUserIds = targetUserIds;    // עדכן נמענים (List<string>?)
            msg.TargetRoles   = targetRoles;

            // אפס את כל האישורים - כי ההודעה השתנתה
            var acksCount = msg.Acknowledgments.Count;
            msg.Acknowledgments.Clear();

            SaveAll(messages);
            return (true, acksCount > 0
                ? $"ההודעה עודכנה ו-{acksCount} אישורים אופסו"
                : "ההודעה עודכנה בהצלחה");
        }

        // ── סטטיסטיקת הודעה ───────────────────────────────────────────
        public MessageStatsViewModel GetMessageStats(string messageId)
        {
            var msg      = GetById(messageId);
            var allUsers = _userService.GetAllUsers()
                                       .Where(u => u.IsApproved)
                                       .ToList();

            if (msg == null)
                return new MessageStatsViewModel();

            // קבע רשימת נמענים
            var recipients = msg.TargetUserIds == null
                ? allUsers
                : allUsers.Where(u =>
                    msg.TargetUserIds.Contains(u.Id)).ToList();

            var acknowledgedIds = msg.Acknowledgments
                                     .Select(a => a.UserId)
                                     .ToHashSet();

            var acknowledgedUsers = recipients
                .Where(u => acknowledgedIds.Contains(u.Id))
                .ToList();

            var pendingUsers = recipients
                .Where(u => !acknowledgedIds.Contains(u.Id))
                .ToList();

            return new MessageStatsViewModel
            {
                Message           = msg,
                TotalRecipients   = recipients.Count,
                AcknowledgedCount = acknowledgedUsers.Count,
                PendingCount      = pendingUsers.Count,
                AcknowledgedUsers = acknowledgedUsers,
                PendingUsers      = pendingUsers
            };
        }
    }
}