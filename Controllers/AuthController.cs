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
        private readonly UserService _userService;

        public AuthController(UserService userService)
        {
            _userService = userService;
        }

        // ── Login GET ──────────────────────────────────────────────────
        [HttpGet]
        public IActionResult Login()
        {
            
            // אם כבר מחובר - הפנה לפי Role
            if (User.Identity?.IsAuthenticated == true)
            {
                

            var roles = User.Claims
                .Where(c => c.Type == ClaimTypes.Role)
                .Select(c => c.Value)
                .ToList();

            Console.Error.WriteLine($"USER ROLES: {string.Join(", ", roles)}");

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
        public async Task<IActionResult> Login(LoginViewModel model, string? returnUrl = null)
        {
            if (!ModelState.IsValid)
                return View(model);

            if (!_userService.ValidateUser(model.Username, model.Password, out var user))
            {
                model.ErrorMessage = "שם משתמש או סיסמה שגויים, או שהחשבון טרם אושר.";
                return View(model);
            }

            // ── בנה Claims ────────────────────────────────────────────
            var claims = new List<Claim>
            {
                new Claim(ClaimTypes.Name,  user!.Username),
                new Claim(ClaimTypes.Role,  user.Role.ToString()),
                new Claim("DisplayName",    user.DisplayName),
                new Claim("UserId",         user.Id)
            };

            // הוסף: שמור AllowedDashboards ב-Claims
            if (user.AllowedDashboards != null && user.AllowedDashboards.Any())
            {
                foreach (var dashboardId in user.AllowedDashboards)
                {
                    claims.Add(new Claim("AllowedDashboard", dashboardId));
                }
            }

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

            // ── Redirect לפי Role ──────────────────────────────────────
            var role = user.Role.ToString();

            // Admin רואה הכל - עבור לדף הבית
            if (role == "Admin")
                return RedirectToAction("Index", "Home");

            // NOC - עבור לדף הבית
            if (role == "NOC")
                return RedirectToAction("Index", "Home");

            // עבור לדף הדשבורדים הכללי
            if (role == "Dashboard")
            {
                return RedirectToAction("Index", "Dashboards");
            }

            // Fallback: returnUrl או דף הבית
            if (!string.IsNullOrEmpty(returnUrl) && Url.IsLocalUrl(returnUrl))
                return Redirect(returnUrl);

            return RedirectToAction("Index", "Home");
        }

        // ── Logout ─────────────────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Logout()
        {
            await HttpContext.SignOutAsync(
                CookieAuthenticationDefaults.AuthenticationScheme);
            return RedirectToAction("Login");
        }

        // ── Register GET ───────────────────────────────────────────────
        [HttpGet]
        public IActionResult Register()
        {
            return View(new RegisterViewModel());
        }

        // ── Register POST ──────────────────────────────────────────────
        [HttpPost]
        [ValidateAntiForgeryToken]
        public IActionResult Register(RegisterViewModel model)
        {
            var (success, message) = _userService.RegisterUser(model);

            if (!success)
            {
                model.ErrorMessage = message;
                return View(model);
            }

            model.SuccessMessage = message;
            return View(model);
        }

        // ── Admin Panel ────────────────────────────────────────────────
        [HttpGet]
        [Authorize(Roles = "Admin")]
        public IActionResult AdminPanel()
        {
            var allUsers        = _userService.GetAllUsers();
            var unapprovedUsers = _userService.GetUnapprovedUsers();

            ViewBag.AllUsers        = allUsers;
            ViewBag.UnapprovedUsers = unapprovedUsers;

            return View();
        }

        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult ApproveUser(string userId)
        {
            _userService.ApproveUser(userId);
            TempData["Success"] = "המשתמש אושר בהצלחה";
            return RedirectToAction("AdminPanel");
        }

        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult DeleteUser(string userId)
        {
            _userService.DeleteUser(userId);
            TempData["Success"] = "המשתמש נמחק בהצלחה";
            return RedirectToAction("AdminPanel");
        }

        // ── Change Role ────────────────────────────────────────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult ChangeRole(string userId, string newRole)
        {
            var (success, message) = _userService.ChangeRole(userId, newRole);

            if (success)
                TempData["Success"] = message;
            else
                TempData["Error"] = message;

            return RedirectToAction("AdminPanel");
        }

        // ── Access Denied ──────────────────────────────────────────────
        [HttpGet]
        public IActionResult AccessDenied()
        {
            return View();
        }

        // ── Dashboard Permissions GET ──────────────────────────────────────
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
                userId             = user.Id,
                username           = user.Username,
                displayName        = user.DisplayName,
                allowedDashboards  = user.AllowedDashboards,
                availableDashboards = AvailableDashboards.All
            });
        }

        // ── Dashboard Permissions POST ─────────────────────────────────────
        [HttpPost]
        [Authorize(Roles = "Admin")]
        [ValidateAntiForgeryToken]
        public IActionResult UpdateDashboardPermissions(
            string userId, [FromForm] List<string> dashboardIds)
        {
            var (success, message) = _userService.UpdateDashboardPermissions(
                userId, dashboardIds);

            if (success)
                TempData["Success"] = message;
            else
                TempData["Error"] = message;

            return RedirectToAction("AdminPanel");
        }

        // ── API: Get Current User ──────────────────────────────────────────
        [HttpGet]
        [Authorize]
        public IActionResult Me()
        {
            var username   = User.FindFirstValue(ClaimTypes.Name);
            var role       = User.FindFirstValue(ClaimTypes.Role);
            var displayName = User.FindFirstValue("DisplayName");
            var userId     = User.FindFirstValue("UserId");

            // שלוף הרשאות דשבורד של המשתמש
            var user = _userService.GetUserById(userId ?? "");
            var allowedDashboards = user?.AllowedDashboards ?? new List<string>();

            return Ok(new
            {
                username          = username,
                role              = role,
                displayName       = displayName,
                userId            = userId,
                allowedDashboards = allowedDashboards
            });
        }
    }
}