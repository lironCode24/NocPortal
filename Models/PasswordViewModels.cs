// file: Models/PasswordViewModels.cs
using System.ComponentModel.DataAnnotations;

namespace NocPortal.Models
{
    // ── בקשת איפוס סיסמה (שלב 1 - הכנסת שם משתמש/מייל) ──────────────
    public class ForgotPasswordViewModel
    {
        [Required(ErrorMessage = "שדה חובה")]
        public string Username { get; set; } = "";

        public string? SuccessMessage { get; set; }
        public string? ErrorMessage   { get; set; }
    }

    // ── איפוס סיסמה עם טוקן (שלב 2) ──────────────────────────────────
    public class ResetPasswordViewModel
    {
        [Required]
        public string Token    { get; set; } = "";

        [Required]
        public string Username { get; set; } = "";

        [Required(ErrorMessage = "סיסמה חדשה נדרשת")]
        [MinLength(6, ErrorMessage = "סיסמה חייבת להכיל לפחות 6 תווים")]
        [DataType(DataType.Password)]
        public string NewPassword { get; set; } = "";

        [Required(ErrorMessage = "אימות סיסמה נדרש")]
        [Compare("NewPassword", ErrorMessage = "הסיסמאות אינן תואמות")]
        [DataType(DataType.Password)]
        public string ConfirmPassword { get; set; } = "";

        public string? ErrorMessage   { get; set; }
        public string? SuccessMessage { get; set; }
    }

    // ── שינוי סיסמה למשתמש מחובר ──────────────────────────────────────
    public class ChangePasswordViewModel
    {
        [Required(ErrorMessage = "סיסמה נוכחית נדרשת")]
        [DataType(DataType.Password)]
        public string CurrentPassword { get; set; } = "";

        [Required(ErrorMessage = "סיסמה חדשה נדרשת")]
        [MinLength(6, ErrorMessage = "סיסמה חייבת להכיל לפחות 6 תווים")]
        [DataType(DataType.Password)]
        public string NewPassword { get; set; } = "";

        [Required(ErrorMessage = "אימות סיסמה נדרש")]
        [Compare("NewPassword", ErrorMessage = "הסיסמאות אינן תואמות")]
        [DataType(DataType.Password)]
        public string ConfirmPassword { get; set; } = "";

        public string? ErrorMessage   { get; set; }
        public string? SuccessMessage { get; set; }

        /// <summary>הודעה כאשר Admin אילץ שינוי סיסמה</summary>
        public string? ForceChangeMessage { get; set; }

        /// <summary>האם השינוי נעשה בעקבות איפוס Admin</summary>
        public bool WasForced =>
            !string.IsNullOrEmpty(ForceChangeMessage);
    }

    // ── Admin: איפוס סיסמה למשתמש ─────────────────────────────────────
    public class AdminResetPasswordViewModel
    {
        [Required]
        public string UserId { get; set; } = "";

        [Required(ErrorMessage = "סיסמה חדשה נדרשת")]
        [MinLength(6, ErrorMessage = "סיסמה חייבת להכיל לפחות 6 תווים")]
        [DataType(DataType.Password)]
        public string NewPassword { get; set; } = "";

        public string? ErrorMessage   { get; set; }
        public string? SuccessMessage { get; set; }
    }
}