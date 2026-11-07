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
        private readonly EmailService         _emailService;   
        private readonly IConfiguration       _config;         

        public UserMessagesController(
            SystemMessageService messageService,
            UserService          userService,
            AuditLogService      auditLog,
            EmailService         emailService,   
            IConfiguration       config)         
        {
            _messageService = messageService;
            _userService    = userService;
            _auditLog       = auditLog;
            _emailService   = emailService;      
            _config         = config;            
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
            var userId   = GetUserId();
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
        public async Task<IActionResult> AcknowledgeMessage(string messageId)
        {
            var existingMessage = _messageService.GetById(messageId);
            var messageTitle    = existingMessage?.Title ?? messageId;

            var userId      = GetUserId();
            var username    = GetUsername();
            var displayName = GetDisplayName();

            var (success, message) = _messageService.AcknowledgeMessage(
                messageId,
                userId,
                username,
                displayName);

            if (!success)
                return BadRequest(new { message });

            // ── Audit Log ──────────────────────────────────────────────
            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.MessageAcknowledged,
                Username  = username,
                UserId    = userId,
                IpAddress = GetClientIp(),
                Details   = $"אישור קריאת הודעה: {messageTitle}",
                Success   = true
            });

            // שליחת מייל לאדמינים על אישור קריאה
            _ = Task.Run(async () =>
            {
                try
                {
                    await SendAcknowledgeNotificationToAdminsAsync(
                        messageId,
                        messageTitle,
                        userId,
                        username,
                        displayName,
                        existingMessage);
                }
                catch
                {
                    // שגיאת מייל לא תפגע בתגובת ה-API
                }
            });

            return Ok(new { success = true, message });
        }

        // ══════════════════════════════════════════════════════════════
        //  PRIVATE: שליחת מייל לאדמינים על אישור קריאה
        // ══════════════════════════════════════════════════════════════
        private async Task SendAcknowledgeNotificationToAdminsAsync(
            string  messageId,
            string  messageTitle,
            string  userId,
            string  username,
            string  displayName,
            dynamic? existingMessage)
        {
            // שליפת רשימת אדמינים ממייל
            var adminEmails = _config
                .GetSection("Email:AdminList")
                .Get<List<string>>()
                ?? new List<string> { "talyoh@menoramivt.co.il" };

            // שליפת סטטיסטיקת ההודעה (כמה קראו / כמה נשארו)
            var stats        = _messageService.GetMessageStats(messageId);
            var acknowledgedCount = stats?.AcknowledgedCount ?? 0;
            var totalRecipients   = stats?.TotalRecipients   ?? 0;
            var pendingCount      = stats?.PendingCount      ?? 0;

            var acknowledgedAt = DateTime.Now.ToString("dd/MM/yyyy HH:mm");

            // ── בניית גוף המייל ────────────────────────────────────────
            var pendingUsersHtml = "";
            if (stats?.PendingUsers != null && stats.PendingUsers.Any())
            {
                var rows = string.Join("", stats.PendingUsers.Select(u =>
                    $"<li style=\"font-size:14px;color:#1E293B;padding:2px 0;\">" +
                    $"{u.DisplayName} ({u.Username})</li>"));

                pendingUsersHtml = $@"
<p style=""margin:16px 0 6px 0;font-size:15px;font-weight:700;color:#D97706;"">
  ממתינים לקריאה ({pendingCount}):
</p>
<ul style=""margin:8px 0;padding-right:20px;"">
  {rows}
</ul>";
            }

            var progressPercent = totalRecipients > 0
                ? (int)Math.Round((double)acknowledgedCount / totalRecipients * 100)
                : 0;

            // ── צבע פרוגרס לפי אחוז ───────────────────────────────────
            var progressColor = progressPercent >= 100 ? "#16A34A"   // ירוק - הכל קרא
                              : progressPercent >= 50  ? "#2563EB"   // כחול - חצי
                              :                          "#D97706";  // כתום - מעט

            var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:#1E293B;"">
  משתמש אישר קריאת הודעה במערכת NOC Portal
</p>

<table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
  <tr>
    <td style=""padding:7px 0;font-size:15px;color:#64748B;
               width:40%;border-bottom:1px solid #E2E8F0;"">
      שם מלא
    </td>
    <td style=""padding:7px 0;font-size:15px;color:#1E293B;
               font-weight:600;border-bottom:1px solid #E2E8F0;"">
      {displayName}
    </td>
  </tr>
  <tr>
    <td style=""padding:7px 0;font-size:15px;color:#64748B;
               width:40%;border-bottom:1px solid #E2E8F0;"">
      שם משתמש
    </td>
    <td style=""padding:7px 0;font-size:15px;color:#1E293B;
               font-weight:600;border-bottom:1px solid #E2E8F0;"">
      {username}
    </td>
  </tr>
  <tr>
    <td style=""padding:7px 0;font-size:15px;color:#64748B;
               width:40%;border-bottom:1px solid #E2E8F0;"">
      כותרת הודעה
    </td>
    <td style=""padding:7px 0;font-size:15px;color:#1E293B;
               font-weight:600;border-bottom:1px solid #E2E8F0;"">
      {messageTitle}
    </td>
  </tr>
  <tr>
    <td style=""padding:7px 0;font-size:15px;color:#64748B;
               width:40%;border-bottom:1px solid #E2E8F0;"">
      זמן אישור
    </td>
    <td style=""padding:7px 0;font-size:15px;color:#1E293B;
               font-weight:600;border-bottom:1px solid #E2E8F0;"">
      {acknowledgedAt}
    </td>
  </tr>
  <tr>
    <td style=""padding:7px 0;font-size:15px;color:#64748B;
               width:40%;border-bottom:1px solid #E2E8F0;"">
      התקדמות
    </td>
    <td style=""padding:7px 0;font-size:15px;color:#1E293B;
               font-weight:600;border-bottom:1px solid #E2E8F0;"">
      {acknowledgedCount} מתוך {totalRecipients} קראו ({progressPercent}%)
    </td>
  </tr>
</table>

<!-- ── פס התקדמות ── -->
<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
       style=""margin:16px 0 0 0;"">
  <tr>
    <td style=""background-color:#E2E8F0;border-radius:4px;height:8px;"">
      <table width=""{progressPercent}%"" cellpadding=""0""
             cellspacing=""0"" border=""0"">
        <tr>
          <td style=""background-color:{progressColor};
                     border-radius:4px;height:8px;font-size:0;"">
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

{(progressPercent >= 100
    ? $@"<p style=""margin:12px 0 0 0;padding:10px 14px;
              border-right:3px solid #16A34A;
              font-size:15px;color:#166534;
              background-color:transparent;line-height:1.6;"">
          ✅ <strong>כל הנמענים קראו את ההודעה!</strong>
        </p>"
    : pendingUsersHtml)}";

            // ── שליחה לכל אדמין ────────────────────────────────────────
            var subject = $"=?UTF-8?B?" +
                Convert.ToBase64String(
                    System.Text.Encoding.UTF8.GetBytes(
                        $"[NOC] אישור קריאה: {messageTitle} | {acknowledgedCount}/{totalRecipients}")) +
                "?=";

            // בניית HTML מלא עם תבנית
            var htmlBody = $@"<!DOCTYPE html>
<html lang=""he"" dir=""rtl"">
<head>
  <meta charset=""UTF-8"">
  <meta name=""viewport"" content=""width=device-width,initial-scale=1.0"">
</head>
<body style=""margin:0;padding:0;background-color:#F8FAFC;
             font-family:Arial,Helvetica,sans-serif;direction:rtl;"">
  <table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
         style=""background-color:#F8FAFC;padding:32px 16px;"">
    <tr><td align=""center"">
      <table width=""560"" cellpadding=""0"" cellspacing=""0"" border=""0""
             style=""max-width:560px;background-color:#FFFFFF;
                    border-radius:8px;border:1px solid #E2E8F0;"">
        <tr>
          <td style=""background-color:{progressColor};
                     height:3px;border-radius:8px 8px 0 0;font-size:0;"">
          </td>
        </tr>
        <tr>
          <td style=""padding:24px 28px 20px 28px;
                     border-bottom:1px solid #E2E8F0;text-align:center;"">
            <p style=""margin:0 0 2px 0;font-size:14px;font-weight:700;
                       color:#2563EB;letter-spacing:2px;"">
              NOC PORTAL
            </p>
            <h1 style=""margin:0 0 4px 0;font-size:20px;font-weight:700;
                        color:#1B3A6B;"">
              אישור קריאת הודעה
            </h1>
            <p style=""margin:0;font-size:15px;color:#64748B;"">
              {acknowledgedCount} מתוך {totalRecipients} קראו
            </p>
          </td>
        </tr>
        <tr>
          <td style=""padding:24px 28px;"">
            {body}
          </td>
        </tr>
        <tr>
          <td style=""padding:20px 36px 28px 36px;text-align:center;"">
            <p style=""margin:0;font-size:14px;color:#64748B;line-height:1.7;"">
              מייל אוטומטי · אין להשיב<br>
              &copy; NOC Portal
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>";

            foreach (var adminEmail in adminEmails)
            {
                await _emailService.SendEmailAsync(
                    adminEmail,
                    "Admin",
                    subject,
                    htmlBody,
                    AuditEventTypes.MessageAcknowledged);
            }
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
            var existingMessage = _messageService.GetById(messageId);
            var messageTitle    = existingMessage?.Title ?? messageId;

            var targetUser     = _userService.GetUserById(userId);
            var targetUsername = targetUser?.Username ?? userId;

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