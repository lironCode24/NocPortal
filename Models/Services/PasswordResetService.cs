// file: Services/PasswordResetService.cs
using NocPortal.Models;
using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace NocPortal.Services
{
    public class PasswordResetService
    {
        // שמירה בזיכרון (ניתן להחליף ל-DB/Redis)
        private readonly ConcurrentDictionary<string, PasswordResetToken>
            _tokens = new();

        private readonly ILogger<PasswordResetService> _logger;

        public PasswordResetService(ILogger<PasswordResetService> logger)
        {
            _logger = logger;
        }

        /// <summary>
        /// יצירת טוקן איפוס חדש למשתמש
        /// </summary>
        public PasswordResetToken CreateToken(string userId, string username)
        {
            // בטל טוקנים ישנים של אותו משתמש
            var oldTokens = _tokens.Values
                .Where(t => t.UserId == userId)
                .ToList();

            foreach (var old in oldTokens)
                _tokens.TryRemove(old.Id, out _);

            // צור טוקן חדש (6 ספרות)
            var token = new PasswordResetToken
            {
                UserId   = userId,
                Username = username,
                Token    = GenerateNumericToken(),
                ExpiresAt = DateTime.UtcNow.AddMinutes(30)
            };

            _tokens[token.Id] = token;

            _logger.LogInformation(
                "טוקן איפוס נוצר עבור משתמש {Username}", username);

            return token;
        }

        /// <summary>
        /// אימות טוקן
        /// </summary>
        public (bool valid, PasswordResetToken? token) ValidateToken(
            string username, string tokenValue)
        {
            var token = _tokens.Values.FirstOrDefault(t =>
                t.Username.Equals(username,
                    StringComparison.OrdinalIgnoreCase) &&
                t.Token == tokenValue &&
                t.IsValid);

            if (token == null)
                return (false, null);

            return (true, token);
        }

        /// <summary>
        /// סימון טוקן כבשימוש לאחר איפוס מוצלח
        /// </summary>
        public void MarkTokenAsUsed(string tokenId)
        {
            if (_tokens.TryGetValue(tokenId, out var token))
                token.IsUsed = true;
        }

        /// <summary>
        /// ניקוי טוקנים פגי תוקף
        /// </summary>
        public void CleanupExpiredTokens()
        {
            var expired = _tokens.Values
                .Where(t => t.IsExpired)
                .ToList();

            foreach (var t in expired)
                _tokens.TryRemove(t.Id, out _);
        }

        // ── יצירת קוד 6 ספרות ─────────────────────────────────────────
        private static string GenerateNumericToken()
        {
            var bytes = RandomNumberGenerator.GetBytes(4);
            var num   = BitConverter.ToUInt32(bytes, 0) % 1_000_000;
            return num.ToString("D6");
        }
    }
}