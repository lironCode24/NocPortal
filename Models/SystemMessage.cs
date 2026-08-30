using System;
using System.Collections.Generic;

namespace NocPortal.Models
{
    // ── מודל הודעת מערכת ──────────────────────────────────────────────
    public class SystemMessage
    {
        public string              Id            { get; set; } = Guid.NewGuid().ToString();
        public string              Title         { get; set; } = string.Empty;
        public string              Content       { get; set; } = string.Empty;
        public DateTime            CreatedAt     { get; set; } = DateTime.UtcNow;
        public string              CreatedBy     { get; set; } = string.Empty;
        public bool                IsActive      { get; set; } = true;

        // קהל יעד: null = כולם, אחרת רשימת userId
        public List<string>?       TargetUserIds { get; set; } = null;
        public List<string>? TargetRoles { get; set; } = null;

        public bool      IsEdited { get; set; } = false;
        public DateTime? EditedAt { get; set; } = null;
        
        // מי אישר קריאה
        public List<MessageAcknowledgment> Acknowledgments { get; set; }
            = new List<MessageAcknowledgment>();
    }

    // ── מודל אישור קריאה ──────────────────────────────────────────────
    public class MessageAcknowledgment
    {
        public string   UserId       { get; set; } = string.Empty;
        public string   Username     { get; set; } = string.Empty;
        public string   DisplayName  { get; set; } = string.Empty;
        public DateTime AcknowledgedAt { get; set; } = DateTime.UtcNow;
    }

    // ── ViewModel ליצירת הודעה ─────────────────────────────────────────
    public class CreateMessageViewModel
    {
        public string         Title         { get; set; } = string.Empty;
        public string         Content       { get; set; } = string.Empty;
        public List<string>?  TargetUserIds { get; set; } = null;
        public List<string>?  TargetRoles    { get; set; } = null;
        public bool           SendToAll     { get; set; } = true;
        public string?        ErrorMessage  { get; set; }
        public string?        SuccessMessage { get; set; }
    }

    // ── ViewModel לסטטיסטיקת הודעה ────────────────────────────────────
    public class MessageStatsViewModel
    {
        public SystemMessage        Message          { get; set; } = null!;
        public int                  TotalRecipients  { get; set; }
        public int                  AcknowledgedCount { get; set; }
        public int                  PendingCount     { get; set; }
        public List<AppUser>        PendingUsers     { get; set; } = new();
        public List<AppUser>        AcknowledgedUsers { get; set; } = new();
    }
}