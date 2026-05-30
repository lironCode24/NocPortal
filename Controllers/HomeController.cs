using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using MyWebApp.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NocPortal.Services; 

namespace MyWebApp.Controllers
{
    [Authorize] 
    public class HomeController : Controller
    {
        private readonly UserService _userService;

        public HomeController(UserService userService)
        {
            _userService = userService;
        }
        // ─────────────────────────────────────────────────────────────

        /// <summary>
        /// Public landing page - no authorization required
        /// </summary>
        [AllowAnonymous]
        [HttpGet("/")]
        public IActionResult Landing()
        {
            return View();
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

        public IActionResult Contact()
        {
            ViewData["Message"] = "Your contact page.";
            return View();
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
