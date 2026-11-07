using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using MyWebApp.Models;
using Microsoft.AspNetCore.Authorization;
using NocPortal.Services; 
using NocPortal.Models;

namespace MyWebApp.Controllers
{
    [Authorize] 
    public class HomeController : Controller
    {
        private readonly UserService _userService;
        private readonly EmailService _emailService;

        public HomeController(UserService userService, EmailService emailService)
        {
            _userService = userService;
            _emailService = emailService;
        }
        // ─────────────────────────────────────────────────────────────

        [AllowAnonymous]
        [HttpGet]
        public IActionResult Landing()
        {
            if (User.Identity?.IsAuthenticated == true)
            {
                if (User.IsInRole("Admin") || User.IsInRole("NOC"))
                    return RedirectToAction(nameof(Index));
                return RedirectToAction("Index", "Dashboards");
            }

            return View(new ContactViewModel());
        }

        [Authorize(Roles = "Admin,NOC")]
        public IActionResult Index()
        {
            if (User.IsInRole("Admin"))
            {
                var unapprovedCount = _userService.GetUnapprovedUsers().Count();
                ViewBag.UnapprovedCount = unapprovedCount;
            }

            return View();
        }

        public IActionResult About()
        {
            ViewData["Message"] = "Your application description page.";
            return View();
        }

        [AllowAnonymous]
        public IActionResult Contact()
        {
            return View(new ContactViewModel());
        }

        [AllowAnonymous]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Contact(ContactViewModel model)
        {
            if (!ModelState.IsValid)
                return View("Landing", model);

            var (success, _) = await _emailService.SendContactMessageAsync(
                model.Name,
                model.Email,
                model.Phone,
                model.Subject,
                model.Message);

            if (!success)
            {
                ModelState.AddModelError(string.Empty, "לא ניתן לשלוח את ההודעה כרגע. נא לנסות שוב מאוחר יותר.");
                return View("Landing", model);
            }

            TempData["Success"] = "ההודעה נשלחה בהצלחה.";
            return RedirectToAction(nameof(Landing));
        }

        public IActionResult Privacy()
        {
            return View();
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel 
            { 
                RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier 
            });
        }
    }
}
