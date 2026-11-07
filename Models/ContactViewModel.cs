using System.ComponentModel.DataAnnotations;

namespace NocPortal.Models
{
    public class ContactViewModel
    {
        [Required(ErrorMessage = "נא להזין שם")]
        [StringLength(100, ErrorMessage = "השם יכול להכיל עד 100 תווים")]
        public string Name { get; set; } = string.Empty;

        [Required(ErrorMessage = "נא להזין כתובת מייל")]
        [EmailAddress(ErrorMessage = "כתובת מייל לא תקינה")]
        [StringLength(254, ErrorMessage = "כתובת המייל ארוכה מדי")]
        public string Email { get; set; } = string.Empty;

        [Required(ErrorMessage = "נא להזין מספר טלפון")]
        [Phone(ErrorMessage = "מספר טלפון לא תקין")]
        [StringLength(30, ErrorMessage = "מספר הטלפון ארוך מדי")]
        public string Phone { get; set; } = string.Empty;

        [Required(ErrorMessage = "נא להזין נושא")]
        [StringLength(200, ErrorMessage = "הנושא יכול להכיל עד 200 תווים")]
        [RegularExpression(@"^[^\r\n]+$", ErrorMessage = "הנושא לא יכול להכיל שורות חדשות")]
        public string Subject { get; set; } = string.Empty;

        [Required(ErrorMessage = "נא להזין תוכן הודעה")]
        [StringLength(5000, ErrorMessage = "ההודעה יכולה להכיל עד 5,000 תווים")]
        public string Message { get; set; } = string.Empty;
    }
}
