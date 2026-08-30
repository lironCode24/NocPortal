using Microsoft.AspNetCore.Hosting;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NocPortal.Models;

namespace NocPortal.Services
{
    public class UserService
    {
        private readonly ILogger<UserService> _logger;

        // מפתח הצפנה - שמור ב-appsettings או Environment Variable!
        private const string EncryptionKey = "NocPortal2025SecretKey32BytesLng!";
        private readonly string _usersFilePath;

        public UserService(IWebHostEnvironment env, ILogger<UserService> logger)
        {
            _logger = logger;
            _usersFilePath = Path.Combine(env.WebRootPath, "assets", "files", "users.json");
            EnsureDataDirectoryAndFile();
        }

        // ── קריאה וכתיבה ──────────────────────────────────────────────

        private List<AppUser> ReadUsers()
        {
            try
            {
                if (!File.Exists(_usersFilePath))
                    return new List<AppUser>();

                var encryptedContent = File.ReadAllText(_usersFilePath);

                if (string.IsNullOrWhiteSpace(encryptedContent))
                    return new List<AppUser>();

                var json = Decrypt(encryptedContent);
                return JsonSerializer.Deserialize<List<AppUser>>(json)
                       ?? new List<AppUser>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "שגיאה בקריאת קובץ משתמשים");
                return new List<AppUser>();
            }
        }

        private void WriteUsers(List<AppUser> users)
        {
            var json = JsonSerializer.Serialize(users, new JsonSerializerOptions
            {
                WriteIndented = true
            });
            var encrypted = Encrypt(json);
            File.WriteAllText(_usersFilePath, encrypted);
        }

        // ── פעולות משתמשים ────────────────────────────────────────────

        public AppUser? GetByUsername(string username)
        {
            var users = ReadUsers();
            return users.FirstOrDefault(u =>
                u.Username.Equals(username, StringComparison.OrdinalIgnoreCase));
        }

        // ════════════════════════════════════════════════════════════════
        //  GetById  +  GetByIdAsync   ← חדש
        // ════════════════════════════════════════════════════════════════

        public AppUser? GetById(string userId)
        {
            if (string.IsNullOrWhiteSpace(userId))
                return null;

            return ReadUsers()
                .FirstOrDefault(u => u.Id == userId);
        }

        public Task<AppUser?> GetByIdAsync(string userId)
            => Task.FromResult(GetById(userId));

        // ════════════════════════════════════════════════════════════════
        //  Update  +  UpdateAsync   ← חדש
        // ════════════════════════════════════════════════════════════════

        public bool Update(AppUser updatedUser)
        {
            var users = ReadUsers();
            var index = users.FindIndex(u => u.Id == updatedUser.Id);

            if (index == -1)
            {
                _logger.LogWarning(
                    "ניסיון עדכון משתמש שלא קיים: {UserId}", updatedUser.Id);
                return false;
            }

            users[index] = updatedUser;
            WriteUsers(users);

            _logger.LogInformation(
                "משתמש עודכן: {Username}", updatedUser.Username);
            return true;
        }

        public Task<bool> UpdateAsync(AppUser updatedUser)
            => Task.FromResult(Update(updatedUser));

        // ════════════════════════════════════════════════════════════════
        //  ChangeRole   ← חדש (לוגיקה ב-Service במקום ב-Controller)
        // ════════════════════════════════════════════════════════════════

        public (bool Success, string Message) ChangeRole(
            string userId, string newRole)
        {
            // ── מציאת משתמש ─────────────────────────────────────────
            var user = GetById(userId);
            if (user == null)
                return (false, "משתמש לא נמצא");

            // ── מניעת שינוי Admin ────────────────────────────────────
            if (user.Role == UserRole.Admin)
                return (false, "לא ניתן לשנות תפקיד מנהל מערכת");

            // ── ולידציית תפקיד ───────────────────────────────────────
            if (!Enum.TryParse<UserRole>(newRole, out var parsedRole))
                return (false, $"תפקיד '{newRole}' אינו תקין");

            // ── מניעת שינוי לאותו תפקיד ─────────────────────────────
            if (user.Role == parsedRole)
                return (false, $"המשתמש כבר בעל תפקיד {newRole}");

            // ── ביצוע השינוי ─────────────────────────────────────────
            var oldRole  = user.Role.ToString();
            user.Role    = parsedRole;

            var updated = Update(user);
            if (!updated)
                return (false, "שגיאה בשמירת השינוי");

            _logger.LogInformation(
                "תפקיד שונה: {Username} | {OldRole} → {NewRole}",
                user.Username, oldRole, newRole);

            return (true,
                $"תפקיד המשתמש {user.DisplayName} שונה מ-{oldRole} ל-{newRole}");
        }

        // ── פעולות קיימות ─────────────────────────────────────────────

        public List<AppUser> GetAllUsers()
        {
            return ReadUsers();
        }

        public List<AppUser> GetUnapprovedUsers()
        {
            return ReadUsers().Where(u => !u.IsApproved).ToList();
        }

        public bool ValidateUser(string username, string password, out AppUser? user)
        {
            user = GetByUsername(username);

            if (user == null)
                return false;

            if (!user.IsApproved)
                return false;

            return VerifyPassword(password, user.PasswordHash);
        }

        public (bool Success, string Message) RegisterUser(RegisterViewModel model)
        {
            if (GetByUsername(model.Username) != null)
                return (false, "שם משתמש כבר קיים במערכת");

            if (model.Password != model.ConfirmPassword)
                return (false, "הסיסמאות אינן תואמות");

            if (model.Password.Length < 6)
                return (false, "הסיסמה חייבת להכיל לפחות 6 תווים");

            var users = ReadUsers();
            var newUser = new AppUser
            {
                Username     = model.Username,
                PasswordHash = HashPassword(model.Password),
                Role         = model.Role,
                DisplayName  = model.DisplayName,
                IsApproved   = false,
                CreatedAt    = DateTime.UtcNow
            };

            users.Add(newUser);
            WriteUsers(users);

            return (true, "ההרשמה בוצעה בהצלחה! חשבונך ממתין לאישור מנהל.");
        }

        public bool ApproveUser(string userId)
        {
            var users = ReadUsers();
            var user  = users.FirstOrDefault(u => u.Id == userId);

            if (user == null) return false;

            user.IsApproved = true;
            WriteUsers(users);
            return true;
        }

        public bool DeleteUser(string userId)
        {
            var users = ReadUsers();
            var user  = users.FirstOrDefault(u => u.Id == userId);

            if (user == null) return false;

            // ── מניעת מחיקת Admin ────────────────────────────────────
            if (user.Role == UserRole.Admin)
            {
                _logger.LogWarning(
                    "ניסיון מחיקת מנהל מערכת נחסם: {Username}", user.Username);
                return false;
            }

            users.Remove(user);
            WriteUsers(users);

            _logger.LogInformation("משתמש נמחק: {Username}", user.Username);
            return true;
        }

        // ── Hash & Encrypt ────────────────────────────────────────────

        public string HashPassword(string password)
        {
            byte[] salt = new byte[16];
            using (var rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(salt);
            }

            var pbkdf2 = new Rfc2898DeriveBytes(
                password, salt,
                iterations: 100000,
                hashAlgorithm: HashAlgorithmName.SHA256);

            byte[] hash     = pbkdf2.GetBytes(32);
            byte[] combined = new byte[salt.Length + hash.Length];

            Buffer.BlockCopy(salt, 0, combined, 0, salt.Length);
            Buffer.BlockCopy(hash, 0, combined, salt.Length, hash.Length);

            return Convert.ToBase64String(combined);
        }

        public bool VerifyPassword(string password, string storedHash)
        {
            try
            {
                byte[] combined        = Convert.FromBase64String(storedHash);
                byte[] salt            = new byte[16];
                byte[] storedHashBytes = new byte[32];

                Buffer.BlockCopy(combined, 0,           salt,            0, salt.Length);
                Buffer.BlockCopy(combined, salt.Length, storedHashBytes, 0, storedHashBytes.Length);

                var pbkdf2 = new Rfc2898DeriveBytes(
                    password, salt,
                    iterations: 100000,
                    hashAlgorithm: HashAlgorithmName.SHA256);

                byte[] computedHash = pbkdf2.GetBytes(32);

                return CryptographicEquals(storedHashBytes, computedHash);
            }
            catch
            {
                return false;
            }
        }

        private bool CryptographicEquals(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;

            int diff = 0;
            for (int i = 0; i < a.Length; i++)
                diff |= a[i] ^ b[i];

            return diff == 0;
        }

        private string Encrypt(string plainText)
        {
            using var aes    = Aes.Create();
            var keyBytes     = Encoding.UTF8
                .GetBytes(EncryptionKey.PadRight(32).Substring(0, 32));
            aes.Key          = keyBytes;
            aes.GenerateIV();

            using var encryptor = aes.CreateEncryptor();
            var plainBytes      = Encoding.UTF8.GetBytes(plainText);
            var cipherBytes     = encryptor
                .TransformFinalBlock(plainBytes, 0, plainBytes.Length);

            var result = new byte[aes.IV.Length + cipherBytes.Length];
            Buffer.BlockCopy(aes.IV,      0, result, 0,            aes.IV.Length);
            Buffer.BlockCopy(cipherBytes, 0, result, aes.IV.Length, cipherBytes.Length);

            return Convert.ToBase64String(result);
        }

        private string Decrypt(string cipherText)
        {
            var fullBytes = Convert.FromBase64String(cipherText);
            var keyBytes  = Encoding.UTF8
                .GetBytes(EncryptionKey.PadRight(32).Substring(0, 32));

            using var aes = Aes.Create();
            aes.Key       = keyBytes;

            var iv     = new byte[aes.BlockSize / 8];
            var cipher = new byte[fullBytes.Length - iv.Length];

            Buffer.BlockCopy(fullBytes, 0,         iv,     0, iv.Length);
            Buffer.BlockCopy(fullBytes, iv.Length, cipher, 0, cipher.Length);

            aes.IV = iv;
            using var decryptor = aes.CreateDecryptor();
            var plainBytes      = decryptor
                .TransformFinalBlock(cipher, 0, cipher.Length);

            return Encoding.UTF8.GetString(plainBytes);
        }

        // ── אתחול קובץ + יוזר אדמין ──────────────────────────────────

        private void EnsureDataDirectoryAndFile()
        {
            var dir = Path.GetDirectoryName(_usersFilePath)!;
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            if (!File.Exists(_usersFilePath))
            {
                var adminUser = new AppUser
                {
                    Id           = "admin-default-001",
                    Username     = "admin",
                    PasswordHash = HashPassword("portAdm2025"),
                    Role         = UserRole.Admin,
                    DisplayName  = "מנהל מערכת",
                    IsApproved   = true,
                    CreatedAt    = DateTime.UtcNow
                };

                WriteUsers(new List<AppUser> { adminUser });
                _logger.LogInformation("קובץ משתמשים נוצר עם אדמין ברירת מחדל");
            }
        }

        public AppUser? GetUserById(string userId)
        {
            var users = ReadUsers();                    
            return users.FirstOrDefault(u => u.Id == userId);
        }

        public (bool success, string message) UpdateDashboardPermissions(
            string userId, List<string> dashboardIds)
        {
            try
            {
                var users = ReadUsers();              
                var user  = users.FirstOrDefault(u => u.Id == userId);

                if (user == null)
                    return (false, "משתמש לא נמצא");

                var validIds   = AvailableDashboards.All.Select(d => d.DashboardId).ToList();
                var invalidIds = dashboardIds.Where(id => !validIds.Contains(id)).ToList();

                if (invalidIds.Any())
                    return (false, $"דשבורדים לא תקינים: {string.Join(", ", invalidIds)}");

                user.AllowedDashboards = dashboardIds;
                WriteUsers(users);                           

                return (true, "הרשאות עודכנו בהצלחה");
            }
            catch (Exception ex)
            {
                return (false, $"שגיאה בעדכון הרשאות: {ex.Message}");
            }
        }
    }
}