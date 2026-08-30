// file: Models/PasswordResetToken.cs
namespace NocPortal.Models
{
    public class PasswordResetToken
    {
        public string Id          { get; set; } = Guid.NewGuid().ToString();
        public string UserId      { get; set; } = "";
        public string Username    { get; set; } = "";
        public string Token       { get; set; } = "";
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddMinutes(30);
        public bool     IsUsed    { get; set; } = false;

        public bool IsExpired => DateTime.UtcNow > ExpiresAt;
        public bool IsValid   => !IsUsed && !IsExpired;
    }
}