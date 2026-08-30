using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NocPortal.Models;
using NocPortal.Services;
using System.Security.Claims;

namespace NocPortal.Controllers
{
    public class AuthController : Controller
    {
        private readonly UserService          _userService;
        private readonly AuditLogService      _auditLog;
        private readonly EmailService         _emailService;
        private readonly PasswordResetService _resetService;
        private readonly ILogger<AuthController> _logger;
        private readonly SecretsService _secrets;

         public AuthController(
            UserService             userService,
            AuditLogService         auditLog,
            EmailService            emailService,
            PasswordResetService    resetService,
            ILogger<AuthController> logger,SecretsService secrets)
        {
            _userService  = userService;
            _auditLog     = auditLog;
            _emailService = emailService;
            _resetService = resetService;
            _logger       = logger;
            _secrets           = secrets;
        }

        // ── עזר: שליפת IP ─────────────────────────────────────────────
        private string GetClientIp()
            => HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        // ── Login GET ──────────────────────────────────────────────────
        [HttpGet]
        public IActionResult Login()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                if (User.IsInRole("NOC") || User.IsInRole("Admin"))
                    return RedirectToAction("Index", "Home");
                else
                    return RedirectToAction("Index", "Dashboards");
            }

            return View(new LoginViewModel());
        }

        // ── Login POST ─────────────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Login(
            LoginViewModel model, string? returnUrl = null)
        {
            if (!ModelState.IsValid)
                return View(model);

            if (!_userService.ValidateUser(
                    model.Username, model.Password,
                    out var user, out var errorMessage))
            {
                _auditLog.Log(new AuditLogEntry
                {
                    EventType = AuditEventTypes.LoginFailed,
                    Username  = model.Username,
                    UserId    = "",
                    IpAddress = GetClientIp(),
                    Details   = errorMessage,
                    Success   = false
                });

                model.ErrorMessage = errorMessage;
                return View(model);
            }

            // ── בנה Claims ────────────────────────────────────────────
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.Name,   user!.Username),
                new Claim(ClaimTypes.Role,   user.Role.ToString()),
                new Claim("DisplayName",     user.DisplayName),
                new Claim("UserId",          user.Id),
                // ── הוסף claim לסיסמה זמנית ──────────────────────────
                new Claim("MustChangePassword",
                        user.MustChangePassword.ToString())
            };

            if (user.AllowedDashboards?.Any() == true)
                foreach (var dashboardId in user.AllowedDashboards)
                    claims.Add(new Claim("AllowedDashboard", dashboardId));

            var identity  = new ClaimsIdentity(
                claims, CookieAuthenticationDefaults.AuthenticationScheme);
            var principal = new ClaimsPrincipal(identity);

            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                principal,
                new AuthenticationProperties
                {
                    IsPersistent = true,
                    ExpiresUtc   = DateTimeOffset.UtcNow.AddHours(8)
                });

            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.Login,
                Username  = user.Username,
                UserId    = user.Id,
                IpAddress = GetClientIp(),
                Details   = $"כניסה מוצלחת | Role: {user.Role}" +
                            (user.MustChangePassword ? " | סיסמה זמנית" : ""),
                Success   = true
            });

            // ── בדוק אם נדרש שינוי סיסמה ─────────────────────────────
            // ← זה הלוגיק החדש: מעביר ישירות למסך שינוי סיסמה
            if (user.MustChangePassword)
            {
                TempData["ForceChangePassword"] =
                    "הסיסמה שלך אופסה על ידי מנהל המערכת. " +
                    "עליך להגדיר סיסמה חדשה לפני הכניסה למערכת.";
                return RedirectToAction("ChangePassword", "Auth");
            }

            // ── Redirect לפי Role ──────────────────────────────────────
            var role = user.Role.ToString();

            if (role == "Admin" || role == "NOC")
                return RedirectToAction("Index", "Home");

            if (role == "Dashboard")
                return RedirectToAction("Index", "Dashboards");

            if (!string.IsNullOrEmpty(returnUrl) && Url.IsLocalUrl(returnUrl))
                return Redirect(returnUrl);

            return RedirectToAction("Index", "Home");
        }

        // ── Logout ─────────────────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Logout()
        {
            // שמור פרטים לפני יציאה
            var username = User.FindFirstValue(ClaimTypes.Name) ?? "unknown";
            var userId   = User.FindFirstValue("UserId")        ?? "";

            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.Logout,
                Username  = username,
                UserId    = userId,
                IpAddress = GetClientIp(),
                Details   = "יציאה מהמערכת",
                Success   = true
            });

            await HttpContext.SignOutAsync(
                CookieAuthenticationDefaults.AuthenticationScheme);

            return RedirectToAction("Login");
        }

        // ── Register GET ───────────────────────────────────────────────
        [HttpGet]
        public IActionResult Register()
            => View(new RegisterViewModel());

        // ── Register POST ──────────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Register(RegisterViewModel model)
        {
            var (success, message) = _userService.RegisterUser(model);

            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.Register,
                Username  = model.Username,
                UserId    = "",
                IpAddress = GetClientIp(),
                Details   = success
                    ? "הרשמה חדשה - ממתין לאישור"
                    : $"הרשמה נכשלה: {message}",
                Success   = success
            });

            if (!success)
            {
                model.ErrorMessage = message;
                return View(model);
            }

            // ── שלח מייל לאדמינים על הרשמה חדשה ─────────────────────
            var adminPanelUrl = "https://nocport-p1apw1/Auth/Users";

            await _emailService.SendNewRegistrationToAdminsAsync(
                model.Username,
                model.DisplayName,
                model.Email ?? "",
                adminPanelUrl);

            model.SuccessMessage = message;
            return View(model);
        }

        // ── Admin Panel — מסך ניהול ראשי ──────────────────────────────
        [HttpGet]
        [Authorize(Roles = "Admin")]
        public IActionResult AdminPanel()
        {
            ViewBag.AllUsers        = _userService.GetAllUsers();
            ViewBag.UnapprovedUsers = _userService.GetUnapprovedUsers();
            // מציג את מסך הניהול הראשי החדש
            return View("AdminDashboard");
        }

        // ── ניהול משתמשים — View נפרד ─────────────────────────────────
        [HttpGet]
        [Authorize(Roles = "Admin")]
        [Route("Auth/Users")]
        public IActionResult Users()
        {
            ViewBag.AllUsers        = _userService.GetAllUsers();
            ViewBag.UnapprovedUsers = _userService.GetUnapprovedUsers();
            // מציג את ה-View הקיים של ניהול משתמשים
            return View("AdminPanel");
        }

        // ── Approve User ───────────────────────────────────────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ApproveUser(string userId)
        {
            var targetUser = _userService.GetUserById(userId);
            _userService.ApproveUser(userId);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.UserApproved,
                Username    = targetUser?.Username ?? userId,
                UserId      = userId,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = $"משתמש אושר על ידי " +
                            $"{User.FindFirstValue(ClaimTypes.Name)}",
                Success     = true
            });

            // ── שלח מייל למשתמש על אישור החשבון ─────────────────────
            if (targetUser != null && !string.IsNullOrEmpty(targetUser.Email))
            {
                var loginUrl = Url.Action("Login", "Auth", null, Request.Scheme)!;

                await _emailService.SendAccountApprovedEmailAsync(
                    targetUser.Email,
                    targetUser.DisplayName,
                    loginUrl);
            }

            TempData["Success"] = "המשתמש אושר בהצלחה";
            return RedirectToAction("Users");
        }

        // ── Delete User ────────────────────────────────────────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DeleteUser(
            string userId,
            bool sendRejectionEmail = false)
        {
            var targetUser = _userService.GetUserById(userId);

            // ── שלח מייל דחייה רק אם המשתמש טרם אושר וסומן לשליחה ──
            var shouldNotifyRejection = sendRejectionEmail      // ← שינוי
                                        && targetUser != null
                                        && !targetUser.IsApproved
                                        && !string.IsNullOrEmpty(targetUser.Email);

            _userService.DeleteUser(userId);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.UserDeleted,
                Username    = targetUser?.Username ?? userId,
                UserId      = userId,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = $"משתמש נמחק על ידי " +
                            $"{User.FindFirstValue(ClaimTypes.Name)}" +
                            (shouldNotifyRejection ? " | מייל דחייה נשלח" : ""),
                Success     = true
            });

            if (shouldNotifyRejection)
            {
                await _emailService.SendAccountRejectedEmailAsync(
                    targetUser!.Email!,
                    targetUser.DisplayName);
            }

            TempData["Success"] = shouldNotifyRejection
                ? "המשתמש נדחה ומייל נשלח אליו"
                : "המשתמש נמחק בהצלחה";

            return RedirectToAction("Users");
        }

        // ── Change Role ────────────────────────────────────────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult ChangeRole(string userId, string newRole)
        {
            var targetUser         = _userService.GetUserById(userId);
            var (success, message) = _userService.ChangeRole(userId, newRole);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.RoleChanged,
                Username    = targetUser?.Username ?? userId,
                UserId      = userId,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = success
                    ? $"Role שונה ל-{newRole}"
                    : $"שינוי Role נכשל: {message}",
                Success     = success
            });

            if (success) TempData["Success"] = message;
            else         TempData["Error"]   = message;

            return RedirectToAction("Users");
        }

        // ── Update Dashboard Permissions ───────────────────────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult UpdateDashboardPermissions(
            string userId, [FromForm] List<string> dashboardIds)
        {
            var targetUser         = _userService.GetUserById(userId);
            var (success, message) = _userService
                .UpdateDashboardPermissions(userId, dashboardIds);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.PermissionsChanged,
                Username    = targetUser?.Username ?? userId,
                UserId      = userId,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = success
                    ? $"הרשאות דשבורד עודכנו: " +
                      $"{string.Join(", ", dashboardIds)}"
                    : $"עדכון הרשאות נכשל: {message}",
                Success     = success
            });

            if (success) TempData["Success"] = message;
            else         TempData["Error"]   = message;

            return RedirectToAction("Users");
        }

        // ── Audit Log Viewer (Admin only) ──────────────────────────────
        [HttpGet]
        [Authorize(Roles = "Admin")]
        public IActionResult AuditLog(
            string? filterType     = null,
            string? filterUsername = null,
            int     page           = 1,
            int     pageSize       = 50)
        {
            // ── שליפת כל הלוגים לסטטיסטיקה (ללא פילטרים) ─────────────
            var allLogs = _auditLog.GetRecent(int.MaxValue); // ← כל הלוגים תמיד

            // ── שליפת לוגים מסוננים לטבלה ────────────────────────────
            var filteredLogs = string.IsNullOrEmpty(filterUsername)
                ? (string.IsNullOrEmpty(filterType)
                    ? _auditLog.GetRecent(500)
                    : _auditLog.GetByEventType(filterType))
                : _auditLog.GetByUsername(filterUsername);

            // ── Pagination ─────────────────────────────────────────────
            var totalCount = filteredLogs.Count;
            var pagedLogs  = filteredLogs
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToList();

            // ── סטטיסטיקות תמיד לפי כל הנתונים ──────────────────────
            ViewBag.Logs          = pagedLogs;
            ViewBag.TotalCount    = totalCount;
            ViewBag.Page          = page;
            ViewBag.PageSize      = pageSize;
            ViewBag.TotalPages    = (int)Math.Ceiling(
                (double)totalCount / pageSize);
            ViewBag.FilterType    = filterType;
            ViewBag.FilterUsername = filterUsername;

            // ← נתונים חדשים לסטטיסטיקה - תמיד מכל הלוגים
            ViewBag.StatsLoginOk      = allLogs.Count(l => l.EventType == AuditEventTypes.Login);
            ViewBag.StatsLoginFail    = allLogs.Count(l => l.EventType == AuditEventTypes.LoginFailed);
            ViewBag.StatsRegisters    = allLogs.Count(l => l.EventType == AuditEventTypes.Register);
            ViewBag.StatsAdminActions = allLogs.Count(l => l.EventType is
                                            AuditEventTypes.UserApproved or
                                            AuditEventTypes.UserDeleted  or
                                            AuditEventTypes.RoleChanged  or
                                            AuditEventTypes.PermissionsChanged);
            ViewBag.StatsEmailsSent   = allLogs.Count(l =>
                l.EventType.StartsWith("EMAIL_") && l.Success);

            ViewBag.StatsEmailsFailed = allLogs.Count(l =>
                l.EventType.StartsWith("EMAIL_") && !l.Success);
            ViewBag.StatsTotalAll     = allLogs.Count; // ← סה"כ כל הרשומות

            ViewBag.EventTypes = new[]
            {
                AuditEventTypes.Login,
                AuditEventTypes.LoginFailed,
                AuditEventTypes.Logout,
                AuditEventTypes.Register,
                AuditEventTypes.UserApproved,
                AuditEventTypes.UserDeleted,
                AuditEventTypes.RoleChanged,
                AuditEventTypes.PermissionsChanged,
                AuditEventTypes.MessageCreated,
                AuditEventTypes.MessageEdited,
                AuditEventTypes.MessageDeactivated,
                AuditEventTypes.MessageAcknowledged,

                AuditEventTypes.PasswordChanged,
                AuditEventTypes.PasswordReset,
                AuditEventTypes.PasswordResetRequested,

                AuditEventTypes.EmailSent,
                AuditEventTypes.EmailFailed,
                AuditEventTypes.EmailTempPass,
                AuditEventTypes.EmailReset,
                AuditEventTypes.EmailApproved,
                AuditEventTypes.EmailRejected,
                AuditEventTypes.EmailChangedPass,
                AuditEventTypes.EmailRegister,
                AuditEventTypes.EmailCalendar,
                AuditEventTypes.EmailValidation
            };

            return View();
        }

        // ── API: Get Dashboard Permissions ─────────────────────────────
        [HttpGet]
        [Authorize(Roles = "Admin")]
        [Route("/api/admin/dashboard-permissions/{userId}")]
        public IActionResult GetDashboardPermissions(string userId)
        {
            var user = _userService.GetUserById(userId);
            if (user == null)
                return NotFound(new { message = "משתמש לא נמצא" });

            return Ok(new
            {
                userId              = user.Id,
                username            = user.Username,
                displayName         = user.DisplayName,
                allowedDashboards   = user.AllowedDashboards,
                availableDashboards = AvailableDashboards.All
            });
        }

        // ── API: Get Current User Email ────────────────────────────────
        [HttpGet]
        [Authorize]
        public IActionResult GetCurrentUserEmail()
        {
            var userId = User.FindFirstValue("UserId") ?? "";
            var user   = _userService.GetUserById(userId);

            return Json(new
            {
                success = true,
                email   = user?.Email ?? "",
                name    = user?.DisplayName ?? ""
            });
        }

        [HttpGet]
        [Authorize]
        public IActionResult GetCurrentUserRole()
        {
            var role = User.FindFirstValue(ClaimTypes.Role) ?? "user";
            var username = User.FindFirstValue(ClaimTypes.Name) ?? "";
            
            return Ok(new
            {
                success = true,
                role = role,
                username = username,
                isAdmin = role == "Admin"
            });
        }

        // ── API: Me ────────────────────────────────────────────────────
        [HttpGet]
        [Authorize]
        public IActionResult Me()
        {
            var userId = User.FindFirstValue("UserId") ?? "";
            var user = _userService.GetUserById(userId);

            var privilegedUsers = _secrets.PrivilegedUsers
            .Select(u => u.ToLower().Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return Ok(new
            {
                username = User.FindFirstValue(ClaimTypes.Name),
                role = User.FindFirstValue(ClaimTypes.Role),
                displayName = User.FindFirstValue("DisplayName"),
                userId = userId,
                allowedDashboards = user?.AllowedDashboards ?? new List<string>(),
                privilegedUsers = privilegedUsers
            });
        }

        // ── API: Get Audit Logs (לייצוא Excel) ────────────────────────
        [HttpGet]
        [Authorize(Roles = "Admin")]
        public IActionResult GetAuditLogs(
            int     page           = 1,
            int     pageSize       = 9999,
            string? filterType     = null,
            string? filterUsername = null)
        {
            try
            {
                // ── שליפה לפי פילטרים (שימוש בשירות הקיים) ──────────────
                List<AuditLogEntry> logs;

                if (!string.IsNullOrEmpty(filterUsername))
                    logs = _auditLog.GetByUsername(filterUsername);
                else if (!string.IsNullOrEmpty(filterType))
                    logs = _auditLog.GetByEventType(filterType);
                else
                    logs = _auditLog.GetAll(); // כל הלוגים

                var totalCount = logs.Count;

                // ── Pagination ────────────────────────────────────────────
                var pagedLogs = logs
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(l => new
                    {
                        timestamp   = l.Timestamp,
                        eventType   = l.EventType,
                        username    = l.Username,
                        performedBy = l.PerformedBy,
                        ipAddress   = l.IpAddress,
                        details     = l.Details,
                        success     = l.Success
                    })
                    .ToList();

                return Json(new
                {
                    success    = true,
                    logs       = pagedLogs,
                    totalCount = totalCount
                });
            }
            catch (Exception ex)
            {
                return Json(new
                {
                    success = false,
                    message = ex.Message
                });
            }
        }

         // ══════════════════════════════════════════════════════════════
        // FORGOT PASSWORD - שלב 1: הכנסת שם משתמש
        // ══════════════════════════════════════════════════════════════

        [HttpGet]
        public IActionResult ForgotPassword()
            => View(new ForgotPasswordViewModel());

        // ── FORGOT PASSWORD POST ──────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ForgotPassword(ForgotPasswordViewModel model)
        {
            if (!ModelState.IsValid)
                return View(model);

            var user = _userService.GetUserByUsername(model.Username?.Trim() ?? "");

            // ── משתמש לא קיים ─────────────────────────────────────────────
            if (user == null)
            {
                _logger.LogWarning(
                    "בקשת איפוס סיסמה עבור משתמש לא קיים: {Username}",
                    model.Username);

                // אבטחה: אותה הודעה - לא לחשוף אם משתמש קיים
                model.SuccessMessage =
                    "אם שם המשתמש קיים במערכת, נשלח מייל עם הוראות לאיפוס.";
                return View(model);
            }

            // ── משתמש קיים אבל אין מייל ───────────────────────────────────
            if (string.IsNullOrEmpty(user.Email))
            {
                _logger.LogWarning(
                    "בקשת איפוס סיסמה - למשתמש {Username} אין כתובת מייל מוגדרת",
                    user.Username);

                // אבטחה: אותה הודעה גנרית
                model.SuccessMessage =
                    "אם שם המשתמש קיים במערכת, נשלח מייל עם הוראות לאיפוס.";
                return View(model);
            }

            // ── משתמש קיים + יש מייל → המשך רגיל ────────────────────────
            var resetToken = _resetService.CreateToken(user.Id, user.Username);

            // ── בנה URL לאיפוס ─────────────────────────────────────────
            var resetUrl = Url.Action(
                "ResetPassword", "Auth",
                new { token = resetToken.Token, username = user.Username },
                Request.Scheme)!;

            // ── שלח מייל ──────────────────────────────────────────────
            var (emailSent, emailMsg) = await _emailService
                .SendPasswordResetEmailAsync(
                    user.Email,
                    user.DisplayName,
                    resetToken.Token,
                    resetUrl);

            if (!emailSent)
            {
                _logger.LogError(
                    "שגיאה בשליחת מייל איפוס ל-{Email}: {Msg}",
                    user.Email, emailMsg);
            }

            // ── לוג ───────────────────────────────────────────────────
            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.PasswordResetRequested,
                Username  = user.Username,
                UserId    = user.Id,
                IpAddress = GetClientIp(),
                Details   = emailSent
                    ? $"בקשת איפוס סיסמה - מייל נשלח ל-{user.Email}"
                    : $"בקשת איפוס סיסמה - שגיאה בשליחת מייל: {emailMsg}",
                Success   = emailSent
            });

            model.SuccessMessage =
                "אם שם המשתמש קיים במערכת, נשלח מייל עם הוראות לאיפוס.";
            return View(model);
        }

        // ══════════════════════════════════════════════════════════════
        // RESET PASSWORD - שלב 2: הכנסת קוד + סיסמה חדשה
        // ══════════════════════════════════════════════════════════════

        [HttpGet]
        public IActionResult ResetPassword(
            string? token    = null,
            string? username = null)
        {
            return View(new ResetPasswordViewModel
            {
                Token    = token    ?? "",
                Username = username ?? ""
            });
        }

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ResetPassword(
            ResetPasswordViewModel model)
        {
            if (!ModelState.IsValid)
                return View(model);

            // ── אמת טוקן ──────────────────────────────────────────────
            var (valid, resetToken) =
                _resetService.ValidateToken(model.Username, model.Token);

            if (!valid || resetToken == null)
            {
                model.ErrorMessage =
                    "הקוד שגוי או פג תוקף. אנא בקש איפוס סיסמה מחדש.";
                return View(model);
            }

            // ── אפס סיסמה ─────────────────────────────────────────────
            var (success, message) =
                _userService.ResetPassword(resetToken.UserId, model.NewPassword);

            if (!success)
            {
                model.ErrorMessage = message;
                return View(model);
            }

            // ── סמן טוקן כבשימוש ──────────────────────────────────────
            _resetService.MarkTokenAsUsed(resetToken.Id);

            // ── שלח מייל אישור ────────────────────────────────────────
            var user = _userService.GetUserById(resetToken.UserId);
            if (user != null && !string.IsNullOrEmpty(user.Email))
            {
                await _emailService.SendPasswordChangedEmailAsync(
                    user.Email,
                    user.DisplayName,
                    GetClientIp());
            }

            // ── לוג ───────────────────────────────────────────────────
            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.PasswordReset,
                Username  = model.Username,
                UserId    = resetToken.UserId,
                IpAddress = GetClientIp(),
                Details   = "סיסמה אופסה בהצלחה דרך מייל",
                Success   = true
            });

            model.SuccessMessage =
                "הסיסמה אופסה בהצלחה! ניתן להתחבר עם הסיסמה החדשה.";
            return View(model);
        }

        // ══════════════════════════════════════════════════════════════
        // CHANGE PASSWORD - למשתמש מחובר
        // ══════════════════════════════════════════════════════════════
        // ── ChangePassword - הוסף הגנה: חייב לשנות סיסמה ─────────────
        [HttpGet]
        [Authorize]
        public IActionResult ChangePassword()
        {
            var model = new ChangePasswordViewModel();

            // ── הצג הודעה אם הגיע מ-ForceChange ──────────────────────
            if (TempData["ForceChangePassword"] is string forceMsg)
                model.ForceChangeMessage = forceMsg;

            return View(model);
        }

        [HttpPost]
        [Authorize]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ChangePassword(
            ChangePasswordViewModel model)
        {
            if (!ModelState.IsValid)
                return View(model);

            var userId = User.FindFirstValue("UserId") ?? "";

            var (success, message) =
                _userService.ChangePassword(
                    userId,
                    model.CurrentPassword,
                    model.NewPassword);

            if (!success)
            {
                model.ErrorMessage = message;
                return View(model);
            }

            // ── שלח מייל אישור ────────────────────────────────────────
            var user = _userService.GetUserById(userId);
            if (user != null && !string.IsNullOrEmpty(user.Email))
            {
                await _emailService.SendPasswordChangedEmailAsync(
                    user.Email,
                    user.DisplayName,
                    GetClientIp());
            }

            _auditLog.Log(new AuditLogEntry
            {
                EventType = AuditEventTypes.PasswordChanged,
                Username  = User.FindFirstValue(ClaimTypes.Name) ?? "",
                UserId    = userId,
                IpAddress = GetClientIp(),
                Details   = "שינוי סיסמה עצמי" +
                            (model.WasForced ? " (אחרי איפוס Admin)" : ""),
                Success   = true
            });

            // ── אם היה ForceChange - עדכן את ה-Cookie ─────────────────
            // נדרש כדי לעדכן את ה-Claim MustChangePassword ל-false
            if (user != null)
            {
                var claims = new List<Claim>
                {
                    new Claim(ClaimTypes.Name,        user.Username),
                    new Claim(ClaimTypes.Role,        user.Role.ToString()),
                    new Claim("DisplayName",          user.DisplayName),
                    new Claim("UserId",               user.Id),
                    new Claim("MustChangePassword",   "False") // ← עדכון
                };

                if (user.AllowedDashboards?.Any() == true)
                    foreach (var d in user.AllowedDashboards)
                        claims.Add(new Claim("AllowedDashboard", d));

                var identity  = new ClaimsIdentity(
                    claims,
                    CookieAuthenticationDefaults.AuthenticationScheme);
                var principal = new ClaimsPrincipal(identity);

                await HttpContext.SignInAsync(
                    CookieAuthenticationDefaults.AuthenticationScheme,
                    principal,
                    new AuthenticationProperties
                    {
                        IsPersistent = true,
                        ExpiresUtc   = DateTimeOffset.UtcNow.AddHours(8)
                    });
            }

            model.SuccessMessage = "הסיסמה שונתה בהצלחה!";
            return View(model);
        }

        // ══════════════════════════════════════════════════════════════
        // ADMIN - איפוס סיסמה למשתמש ספציפי
        // ══════════════════════════════════════════════════════════════
         // ── AdminResetPassword - הוסף תמיכה בסיסמה זמנית ─────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> AdminResetPassword(
            AdminResetPasswordViewModel model)
        {
            if (!ModelState.IsValid)
            {
                TempData["Error"] = "נתונים לא תקינים";
                return RedirectToAction("Users");
            }

            var targetUser = _userService.GetUserById(model.UserId);

            // ← שינוי: isTemporary = true כדי לאלץ שינוי סיסמה
            var (success, message) =
                _userService.ResetPassword(
                    model.UserId,
                    model.NewPassword,
                    isTemporary: true);

            // ── בנה URL לאיפוס ─────────────────────────────────────────
            var loginUrl = Url.Action(
                "Login", "Auth",
                null,
                Request.Scheme)!;

            if (success &&
                targetUser != null &&
                !string.IsNullOrEmpty(targetUser.Email))
            {
                // ← שלח מייל שמודיע שהסיסמה אופסה וצריך לשנות
                await _emailService.SendTemporaryPasswordEmailAsync(
                    targetUser.Email,
                    targetUser.DisplayName,
                    model.NewPassword,loginUrl);  // ← שלח את הסיסמה הזמנית במייל
            }

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = AuditEventTypes.PasswordReset,
                Username    = targetUser?.Username ?? model.UserId,
                UserId      = model.UserId,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = success
                    ? "סיסמה זמנית הוגדרה על ידי Admin - נדרש שינוי בכניסה"
                    : $"איפוס סיסמה נכשל: {message}",
                Success     = success
            });

            if (success)
                TempData["Success"] =
                    "הסיסמה הזמנית הוגדרה. המשתמש יידרש לשנות אותה בכניסה הבאה.";
            else
                TempData["Error"] = message;

            return RedirectToAction("Users");
        }

        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult UpdateUserEmail(string UserId, string Email)
        {
            var user = _userService.GetUserById(UserId);

            if (user == null)
            {
                TempData["Error"] = "משתמש לא נמצא";
                return RedirectToAction("Users");
            }

            var oldEmail = user.Email;

            user.Email = string.IsNullOrWhiteSpace(Email)
                ? null
                : Email.Trim();

            _userService.Update(user);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = "EmailUpdated",
                Username    = user.Username,
                UserId      = user.Id,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = $"Email changed: {oldEmail ?? "none"} -> {user.Email ?? "none"}",
                Success     = true
            });

            TempData["Success"] =
                string.IsNullOrWhiteSpace(user.Email)
                    ? "המייל הוסר בהצלחה"
                    : $"המייל עודכן ל־{user.Email}";

            return RedirectToAction("Users");
        }

        // ── Access Denied ──────────────────────────────────────────────
        [HttpGet]
        public IActionResult AccessDenied() => View();

        // ── Edit User ──────────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        [Authorize(Roles = "Admin")]
        public IActionResult EditUser(EditUserViewModel model)
        {
            if (!ModelState.IsValid)
            {
                var errors = ModelState.Values
                    .SelectMany(v => v.Errors)
                    .Select(e => e.ErrorMessage)
                    .FirstOrDefault();

                TempData["Error"] = errors ?? "נתונים לא תקינים";
                return RedirectToAction("Users");
            }

            // ── קרא לשירות ────────────────────────────────────────
            var (success, message) = _userService.EditUser(
                model.UserId,
                model.DisplayName,
                model.Username,
                model.Email);

            if (!success)
            {
                TempData["Error"] = message;
                return RedirectToAction("Users");
            }

            // ── לוג ───────────────────────────────────────────────
            var user = _userService.GetUserById(model.UserId);

            _auditLog.Log(new AuditLogEntry
            {
                EventType   = "USER_EDITED",
                Username    = user?.Username ?? model.Username,
                UserId      = model.UserId,
                PerformedBy = User.FindFirstValue(ClaimTypes.Name) ?? "Admin",
                IpAddress   = GetClientIp(),
                Details     = message,
                Success     = true
            });

            TempData["Success"] = message == "ללא שינויים"
                ? "לא בוצעו שינויים"
                : $"פרטי המשתמש עודכנו: {message}";

            return RedirectToAction("Users");
        }
    }
}