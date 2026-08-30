using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NocPortal.Models;
using NocPortal.Services;
using System.Security.Claims;

namespace NocPortal.Controllers
{
    [Authorize]
    public class UserMessagesController : Controller
    {
        private readonly SystemMessageService _messageService;
        private readonly UserService          _userService;
        private readonly AuditLogService      _auditLog;

        public UserMessagesController(
            SystemMessageService messageService,
            UserService          userService,
            AuditLogService      auditLog)
        {
            _messageService = messageService;
            _userService    = userService;
            _auditLog       = auditLog;
        }

        // ── עזר: שליפת פרטי משתמש מ-Claims ───────────────────────────
        private string GetUserId()
            => User.FindFirstValue("UserId") ?? "";

        private string GetUsername()
            => User.FindFirstValue(ClaimTypes.Name) ?? "";

        private string GetDisplayName()
            => User.FindFirstValue("DisplayName") ?? "";

        private string GetClientIp()
            => HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        private string GetUserRole()
            => User.FindFirstValue("Role") ?? "";

        // ══════════════════════════════════════════════════════════════
        //  API: שליפת הודעות ממתינות לאישור (לפופאפ בהתחברות)
        // ══════════════════════════════════════════════════════════════
        [HttpGet]
        [Route("/api/userMessages/pending")]
        public IActionResult GetPendingMessages()
        {
            var userId = GetUserId();
            var userRole = GetUserRole();

            var messages = _messageService.GetPendingForUser(userId, userRole);

            return Ok(new
            {
                count    = messages.Count,
                messages = messages.Select(m => new
                {
                    id        = m.Id,
                    title     = m.Title,
                    content   = m.Content,
                    createdAt = m.CreatedAt
                })
            });
        }

        // ══════════════════════════════════════════════════════════════════
        //  API: שליפת הודעות שאושרו (לתיבת דואר)
        // ══════════════════════════════════════════════════════════════════
        [HttpGet]
        [Route("/api/userMessages/acknowledged")]
        public IActionResult GetAcknowledgedMessages()
        {
            var userId   = GetUserId();
            var userRole = GetUserRole();

            var messages = _messageService.GetAcknowledgedForUser(userId, userRole);

            return Ok(new
            {
                count    = messages.Count,
                messages = messages
                    .OrderByDescending(m => m.Acknowledgments
                        .FirstOrDefault(a => a.UserId == userId)?.AcknowledgedAt)
                    .Select(m => new
                    {
                        id             = m.Id,
                        title          = m.Title,
                        content        = m.Content,
                        createdAt      = m.CreatedAt,
                        isEdited       = m.IsEdited,
                        editedAt       = m.EditedAt,
                        acknowledgedAt = m.Acknowledgments
                            .FirstOrDefault(a => a.UserId == userId)?.AcknowledgedAt
                    })
            });
        }

        // ══════════════════════════════════════════════════════════════
        //  API: אישור קריאת הודעה
        // ══════════════════════════════════════════════════════════════
        [HttpPost]
        [Route("/api/userMessages/acknowledge/{messageId}")]
        [ValidateAntiForgeryToken]
        public IActionResult AcknowledgeMessage(string messageId)
        {
            var existingMessage = _messageService.GetById(messageId);
            var messageTitle    = existingMessage?.Title ?? messageId;

            var (success, message) = _messageService.AcknowledgeMessage(
                messageId,
                GetUserId(),
                GetUsername(),
                GetDisplayName());

            if (!success)
                return BadRequest(new { message });

            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.MessageAcknowledged,
                Username  = GetUsername(),
                UserId    = GetUserId(),
                IpAddress = GetClientIp(),
                Details   = $"אישור קריאת הודעה: {messageTitle}",
                Success   = true
            });

            return Ok(new { success = true, message });
        }

        // ══════════════════════════════════════════════════════════════
        //  ADMIN: מסך ניהול הודעות
        // ══════════════════════════════════════════════════════════════
        [HttpGet]
        [Authorize(Roles = "Admin")]
        public IActionResult Index()
        {
            var messages = _messageService.GetAll();
            ViewBag.Messages = messages;
            ViewBag.AllUsers = _userService.GetAllUsers()
                                           .Where(u => u.IsApproved)
                                           .ToList();
            return View(new CreateMessageViewModel());
        }

        // ══════════════════════════════════════════════════════════════
        //  ADMIN: יצירת הודעה חדשה
        // ══════════════════════════════════════════════════════════════
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult Create(
            CreateMessageViewModel model,
            [FromForm] List<string>? targetUserIds,
            [FromForm] List<string>? targetRoles)
        {
            var targets = model.SendToAll ? null : targetUserIds;
            var roles   = (targetRoles?.Any() == true) ? targetRoles : null;

            var (success, message) = _messageService.CreateMessage(
                model.Title, model.Content, GetUsername(), targets, roles);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.MessageCreated,
                Username    = GetUsername(),
                UserId      = GetUserId(),
                PerformedBy = GetUsername(),
                IpAddress   = GetClientIp(),
                Details     = success
                    ? $"הודעה חדשה נוצרה: {model.Title}"
                    : $"יצירת הודעה נכשלה: {message}",
                Success     = success
            });

            if (success) TempData["Success"] = message;
            else         TempData["Error"]   = message;

            return RedirectToAction("Index");
        }

        // ══════════════════════════════════════════════════════════════
        //  ADMIN: ביטול הודעה
        // ══════════════════════════════════════════════════════════════
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult Deactivate(string messageId)
        {
            // שלוף כותרת לפני הביטול
            var existingMessage = _messageService.GetById(messageId);
            var messageTitle    = existingMessage?.Title ?? messageId;

            var (success, message) = _messageService.DeactivateMessage(messageId);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.MessageDeactivated,
                Username    = GetUsername(),
                UserId      = GetUserId(),
                PerformedBy = GetUsername(),
                IpAddress   = GetClientIp(),
                Details     = success
                    ? $"הודעה בוטלה: {messageTitle}"
                    : $"ביטול הודעה נכשל: {message}",
                Success     = success
            });

            if (success) TempData["Success"] = message;
            else         TempData["Error"]   = message;

            return RedirectToAction("Index");
        }

        // ══════════════════════════════════════════════════════════════
        //  ADMIN: עריכת הודעה
        // ══════════════════════════════════════════════════════════════
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult Edit(
            string messageId,
            string title,
            string content,
            bool sendToAll,
            [FromForm] List<string>? targetUserIds)
        {
            var targets = sendToAll ? null : targetUserIds;

            var (success, message) = _messageService.EditMessage(
                messageId, title, content, targets);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.MessageEdited,
                Username    = GetUsername(),
                UserId      = GetUserId(),
                PerformedBy = GetUsername(),
                IpAddress   = GetClientIp(),
                Details     = success
                    ? $"הודעה עודכנה ואישורים אופסו: {title}" 
                    : $"עריכת הודעה נכשלה: {message}",
                Success     = success
            });

            if (success) TempData["Success"] = message;
            else         TempData["Error"]   = message;

            return RedirectToAction("Index");
        }

        // ══════════════════════════════════════════════════════════════
        //  ADMIN: סטטיסטיקת הודעה
        // ══════════════════════════════════════════════════════════════
        [HttpGet]
        [Authorize(Roles = "Admin")]
        public IActionResult Stats(string messageId)
        {
            var stats = _messageService.GetMessageStats(messageId);
            if (stats.Message == null)
            {
                TempData["Error"] = "הודעה לא נמצאה";
                return RedirectToAction("Index");
            }

            return View(stats);
        }

        // ══════════════════════════════════════════════════════════════
        //  API: סטטיסטיקת הודעה (JSON)
        // ══════════════════════════════════════════════════════════════
        [HttpGet]
        [Authorize(Roles = "Admin")]
        [Route("/api/userMessages/stats/{messageId}")]
        public IActionResult GetStats(string messageId)
        {
            var stats = _messageService.GetMessageStats(messageId);

            if (stats.Message == null)
                return NotFound(new { message = "הודעה לא נמצאה" });

            return Ok(new
            {
                messageId         = stats.Message.Id,
                title             = stats.Message.Title,
                totalRecipients   = stats.TotalRecipients,
                acknowledgedCount = stats.AcknowledgedCount,
                pendingCount      = stats.PendingCount,
                acknowledgedUsers = stats.AcknowledgedUsers.Select(u => new
                {
                    userId      = u.Id,
                    username    = u.Username,
                    displayName = u.DisplayName,
                    acknowledgedAt = stats.Message.Acknowledgments
                        .FirstOrDefault(a => a.UserId == u.Id)?.AcknowledgedAt
                }),
                pendingUsers = stats.PendingUsers.Select(u => new
                {
                    userId      = u.Id,
                    username    = u.Username,
                    displayName = u.DisplayName
                })
            });
        }

        // ══════════════════════════════════════════════════════════════
        //  ADMIN: שליחת הודעה מחדש למשתמש ספציפי
        // ══════════════════════════════════════════════════════════════
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult Resend(string messageId, string userId)
        {
            var existingMessage  = _messageService.GetById(messageId);
            var messageTitle     = existingMessage?.Title ?? messageId;

            var targetUser       = _userService.GetUserById(userId);
            var targetUsername   = targetUser?.Username ?? userId;
            var (success, message) = _messageService.ResendToUser(
                messageId, userId);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.MessageCreated,
                Username    = GetUsername(),
                UserId      = GetUserId(),
                PerformedBy = GetUsername(),
                IpAddress   = GetClientIp(),
                Details     = success
                    ? $"הודעה נשלחה מחדש: {messageTitle} למשתמש: {targetUsername}"
                    : $"שליחה מחדש נכשלה: {message}",
                Success     = success
            });

            return Json(new { success, message });
        }
    }
}