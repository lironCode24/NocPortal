// Models/EditUserViewModel.cs
using System.ComponentModel.DataAnnotations;

namespace NocPortal.Models
{
    public class EditUserViewModel
    {
        [Required]
        public string UserId { get; set; } = string.Empty;

        [Required(ErrorMessage = "שם תצוגה הוא שדה חובה")]
        [StringLength(50, MinimumLength = 2,
            ErrorMessage = "שם תצוגה חייב להכיל בין 2 ל-50 תווים")]
        public string DisplayName { get; set; } = string.Empty;

        [Required(ErrorMessage = "שם משתמש הוא שדה חובה")]
        [StringLength(30, MinimumLength = 3,
            ErrorMessage = "שם משתמש חייב להכיל בין 3 ל-30 תווים")]
        [RegularExpression(@"^[a-zA-Z0-9._-]+$",
            ErrorMessage = "שם משתמש יכול להכיל רק אותיות, מספרים ו- . _ -")]
        public string Username { get; set; } = string.Empty;

        [EmailAddress(ErrorMessage = "כתובת מייל לא תקינה")]
        public string? Email { get; set; }
    }
}