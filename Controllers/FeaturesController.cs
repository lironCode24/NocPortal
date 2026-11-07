using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace NocPortal.Controllers
{
    [Authorize]
    public class FeaturesController : Controller
    {
        public IActionResult Index()
        {
            ViewData["Title"] = "קטלוג פיצ'רים";
            return View();
        }
    }
}
