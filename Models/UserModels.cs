using System.Text.Json.Serialization;

namespace NocPortal.Models
{
    public enum UserRole
    {
        Admin,
        NOC,
        Dashboard
    }

    public class AppUser
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = Guid.NewGuid().ToString();

        [JsonPropertyName("username")]
        public string Username { get; set; } = string.Empty;

        [JsonPropertyName("passwordHash")]
        public string PasswordHash { get; set; } = string.Empty;

        [JsonPropertyName("role")]
        public UserRole Role { get; set; } = UserRole.NOC;

        [JsonPropertyName("isApproved")]
        public bool IsApproved { get; set; } = false;

        [JsonPropertyName("createdAt")]
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        [JsonPropertyName("displayName")]
        public string DisplayName { get; set; } = string.Empty;

        public List<string> AllowedDashboards { get; set; } = new();
    }

    // ViewModels
    public class LoginViewModel
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string? ErrorMessage { get; set; }
    }

    public class RegisterViewModel
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string ConfirmPassword { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public UserRole Role { get; set; } = UserRole.Dashboard;
        public string? ErrorMessage { get; set; }
        public string? SuccessMessage { get; set; }
    }
}