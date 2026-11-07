// file: Services/EmailService.cs
using System.Net;
using System.Net.Mail;

namespace NocPortal.Services
{
    public class EmailService
    {
        private readonly AuditLogService _auditLog;
        private readonly IConfiguration _config;
        private readonly ILogger<EmailService> _logger;

        private const string SmtpHost = "172.22.28.25";
        private const int    SmtpPort = 25;

        // ─── פלטת צבעים מינימליסטית ───────────────────────────────────────
        private const string ColorPrimary  = "#1B3A6B";
        private const string ColorAccent   = "#2563EB";
        private const string ColorSuccess  = "#16A34A";
        private const string ColorWarning  = "#D97706";
        private const string ColorDanger   = "#DC2626";
        private const string ColorBg       = "#F8FAFC";
        private const string ColorCardBg   = "#FFFFFF";
        private const string ColorBorder   = "#E2E8F0";
        private const string ColorTextMain = "#1E293B";
        private const string ColorTextSub  = "#64748B";

        public EmailService(
            IConfiguration config,
            ILogger<EmailService> logger,
            AuditLogService auditLog)
        {
            _config = config;
            _logger = logger;
            _auditLog = auditLog;
        }

        // ════════════════════════════════════════════════════════════════════
        //  PRIVATE HELPERS
        // ════════════════════════════════════════════════════════════════════

        private static string EncodeSubject(string text) =>
            "=?UTF-8?B?" +
            Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(text)) +
            "?=";

        /// <summary>
        /// תבנית HTML מינימליסטית - header דק + body נקי + footer קטן
        /// </summary>
        private static string BuildEmailHtml(
            string accentColor,
            string headerTitle,
            string headerSubtitle,
            string bodyContent)
        {
            return $@"<!DOCTYPE html>
<html lang=""he"" dir=""rtl"">
<head>
  <meta charset=""UTF-8"">
  <meta name=""viewport"" content=""width=device-width,initial-scale=1.0"">
  <title>{headerTitle}</title>
</head>
<body style=""margin:0;padding:0;background-color:{ColorBg};
             font-family:Arial,Helvetica,sans-serif;direction:rtl;"">

  <table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
         style=""background-color:{ColorBg};padding:32px 16px;"">
    <tr><td align=""center"">

      <table width=""560"" cellpadding=""0"" cellspacing=""0"" border=""0""
             style=""max-width:560px;background-color:{ColorCardBg};
                    border-radius:8px;border:1px solid {ColorBorder};"">

        <!-- ── פס צבע עליון דק ── -->
        <tr>
          <td style=""background-color:{accentColor};
                     height:3px;border-radius:8px 8px 0 0;font-size:0;"">
          </td>
        </tr>

        <!-- ── HEADER ── -->
        <tr>
          <td style=""padding:24px 28px 20px 28px;
                     border-bottom:1px solid {ColorBorder};text-align:center;"">
            <p style=""margin:0 0 2px 0;font-size:14px;font-weight:700;
                       color:{ColorAccent};letter-spacing:2px;"">
              NOC PORTAL
            </p>
            <h1 style=""margin:0 0 4px 0;font-size:20px;font-weight:700;
                        color:{ColorPrimary};"">
              {headerTitle}
            </h1>
            <p style=""margin:0;font-size:15px;color:{ColorTextSub};"">
              {headerSubtitle}
            </p>
          </td>
        </tr>

        <!-- ── BODY ── -->
        <tr>
          <td style=""padding:24px 28px;"">
            {bodyContent}
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style=""padding:20px 36px 28px 36px;text-align:center;"">
            <p style=""margin:0 0 4px 0;font-size:14px;
                       color:{ColorTextSub};line-height:1.7;"">
              מייל אוטומטי · אין להשיב<br>
              &copy; NOC Portal
            </p>
          </td>
        </tr>

      </table>

    </td></tr>
  </table>

</body>
</html>";
        }

       /// <summary>
        /// מחזיר HTML של כפתור פעולה ראשי - תואם Outlook + כל הדפדפנים
        /// </summary>
        private static string BuildButton(string url, string label, string bgColor,int width = 220)
        {
            return $@"
        <table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
              style=""margin-top:28px;"">
          <tr>
            <td align=""center"">

              <!--[if mso]>
              <v:roundrect xmlns:v=""urn:schemas-microsoft-com:vml""
                          xmlns:w=""urn:schemas-microsoft-com:office:word""
                          href=""{url}""
                          style=""height:48px;v-text-anchor:middle;width:{width}px;""
                          arcsize=""20%""
                          stroke=""f""
                          fillcolor=""{bgColor}"">
                <w:anchorlock/>
                <center style=""color:#ffffff;font-family:Arial,Helvetica,sans-serif;
                                font-size:14px;font-weight:700;
                                letter-spacing:0.3px;"">
                  {label}
                </center>
              </v:roundrect>
              <![endif]-->

              <!--[if !mso]><!-->
              <table cellpadding=""0"" cellspacing=""0"" border=""0"">
                <tr>
                  <td align=""center""
                      style=""background-color:{bgColor};
                            border-radius:10px;
                            mso-padding-alt:0;"">
                    <a href=""{url}""
                      style=""display:inline-block;
                              padding:14px 40px;
                              color:#ffffff;
                              font-size:17px;
                              font-weight:700;
                              text-decoration:none;
                              border-radius:10px;
                              font-family:Arial,Helvetica,sans-serif;
                              letter-spacing:0.3px;
                              mso-hide:all;"">
                      {label}
                    </a>
                  </td>
                </tr>
              </table>
              <!--<![endif]-->

            </td>
          </tr>
        </table>";
        }

        /// <summary>
        /// שורת מידע - קומפקטית
        /// </summary>
        private static string BuildInfoRow(string label, string value)
        {
            return $@"
<tr>
  <td style=""padding:7px 0;font-size:15px;color:{ColorTextSub};
             width:40%;border-bottom:1px solid {ColorBorder};"">
    {label}
  </td>
  <td style=""padding:7px 0;font-size:15px;color:{ColorTextMain};
             font-weight:600;border-bottom:1px solid {ColorBorder};"">
    {value}
  </td>
</tr>";
        }

        /// <summary>
        /// הודעת התראה - פס צבע שמאלי בלבד, ללא רקע כבד
        /// </summary>
        private static string BuildAlert(string text, string borderColor, string textColor)
        {
            return $@"
<p style=""margin:16px 0 0 0;padding:10px 14px;
          border-right:3px solid {borderColor};
          font-size:15px;color:{textColor};
          background-color:transparent;line-height:1.6;"">
  {text}
</p>";
        }

        /// <summary>
        /// טוען את לוגו המנורה כ-base64
        /// </summary>
        private string GetMenoraLogoBase64()
        {
            try
            {
                // נסה לטעון מ-wwwroot
                var possiblePaths = new[]
                {
                    Path.Combine(
                        AppDomain.CurrentDomain.BaseDirectory,
                        "wwwroot", "images", "menora-logo.png"),
                    Path.Combine(
                        Directory.GetCurrentDirectory(),
                        "wwwroot", "images", "menora-logo.png")
                };

                foreach (var path in possiblePaths)
                {
                    if (File.Exists(path))
                    {
                        var bytes = File.ReadAllBytes(path);
                        return Convert.ToBase64String(bytes);
                    }
                }

                _logger.LogWarning(
                    "[Email] לוגו מנורה לא נמצא ב-wwwroot/images/menora-logo.png");
                return string.Empty;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[Email] שגיאה בטעינת לוגו מנורה");
                return string.Empty;
            }
        }

        /// <summary>
        /// תבנית HTML עם לוגו - לשימוש במיילי קטלוג מערכות
        /// </summary>
        private static string BuildEmailHtmlWithLogo(
            string accentColor,
            string headerTitle,
            string headerSubtitle,
            string bodyContent,
            string logoBase64 = "")
        {
            // בניית תג הלוגו - אם יש base64 נשתמש בו, אחרת fallback לטקסט
            string logoHtml = !string.IsNullOrEmpty(logoBase64)
                ? $@"<img src=""data:image/png;base64,{logoBase64}""
                        alt=""מנורה מבטחים""
                        width=""48"" height=""48""
                        style=""display:block;border:0;
                                border-radius:50%;
                                object-fit:contain;"" />"
                : $@"<div style=""width:48px;height:48px;
                                background-color:{accentColor};
                                border-radius:50%;
                                display:inline-block;""></div>";

            return $@"<!DOCTYPE html>
        <html lang=""he"" dir=""rtl"">
        <head>
        <meta charset=""UTF-8"">
        <meta name=""viewport"" content=""width=device-width,initial-scale=1.0"">
        <title>{headerTitle}</title>
        </head>
        <body style=""margin:0;padding:0;background-color:{ColorBg};
                    font-family:Arial,Helvetica,sans-serif;direction:rtl;"">

        <table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
                style=""background-color:{ColorBg};padding:32px 16px;"">
            <tr><td align=""center"">

            <table width=""560"" cellpadding=""0"" cellspacing=""0"" border=""0""
                    style=""max-width:560px;background-color:{ColorCardBg};
                            border-radius:8px;border:1px solid {ColorBorder};"">

                <!-- ── פס צבע עליון דק ── -->
                <tr>
                <td style=""background-color:{accentColor};
                            height:3px;border-radius:8px 8px 0 0;font-size:0;"">
                </td>
                </tr>

                <!-- ── HEADER עם לוגו ── -->
                <tr>
                <td style=""padding:24px 28px 20px 28px;
                            border-bottom:1px solid {ColorBorder};text-align:center;"">

                    <!-- לוגו מנורה -->
                    <table cellpadding=""0"" cellspacing=""0"" border=""0""
                        style=""margin:0 auto 12px auto;"">
                    <tr>
                        <td align=""center"">
                        {logoHtml}
                        </td>
                    </tr>
                    </table>

                    <!-- כותרת קטלוג מערכות -->
                    <p style=""margin:0 0 2px 0;font-size:18px;font-weight:700;
                            color:{ColorAccent};letter-spacing:2px;"">
                    קטלוג מערכות
                    </p>
                    <h1 style=""margin:0 0 4px 0;font-size:20px;font-weight:700;
                                color:{ColorPrimary};"">
                    {headerTitle}
                    </h1>
                    <p style=""margin:0;font-size:15px;color:{ColorTextSub};"">
                    {headerSubtitle}
                    </p>
                </td>
                </tr>

                <!-- ── BODY ── -->
                <tr>
                <td style=""padding:24px 28px;"">
                    {bodyContent}
                </td>
                </tr>

                <!-- ── FOOTER ── -->
                <tr>
                <td style=""padding:20px 36px 28px 36px;text-align:center;"">
                    <p style=""margin:0 0 4px 0;font-size:14px;
                            color:{ColorTextSub};line-height:1.7;"">
                    מייל אוטומטי · אין להשיב<br>
                    &copy; NOC Portal · קטלוג מערכות
                    </p>
                </td>
                </tr>

            </table>

            </td></tr>
        </table>

        </body>
        </html>";
        }

        // ════════════════════════════════════════════════════════════════════
        //  PUBLIC: שליחת מייל כללי
        // ════════════════════════════════════════════════════════════════════
        public async Task<(bool success, string message)> SendEmailAsync(
            string toEmail,
            string toName,
            string subject,
            string htmlBody,
            string emailEventType = AuditEventTypes.EmailSent)
        {
            try
            {
                // ✅ תוקן: SMTP פנימי ללא auth - הסרת הסתירה
                using var client = new SmtpClient(SmtpHost, SmtpPort)
                {
                    EnableSsl             = false,
                    DeliveryMethod        = SmtpDeliveryMethod.Network,
                    UseDefaultCredentials = false, // ✅ תוקן: SMTP פנימי ללא auth
                    Credentials           = CredentialCache.DefaultNetworkCredentials,
                    Timeout               = 10_000
                };

                var fromAddress = _config["Email:FromAddress"] ?? "noc@menoramivt.co.il";
                var fromName    = _config["Email:FromName"]    ?? "NOC Portal";

                using var mail = new MailMessage
                {
                    From       = new MailAddress(fromAddress, fromName),
                    Subject    = subject,
                    Body       = htmlBody,
                    IsBodyHtml = true
                };

                mail.SubjectEncoding = System.Text.Encoding.UTF8;
                mail.BodyEncoding    = System.Text.Encoding.UTF8;
                mail.HeadersEncoding = System.Text.Encoding.UTF8;
                mail.To.Add(new MailAddress(toEmail, toName));

                await client.SendMailAsync(mail);

                _logger.LogInformation(
                    "[Email] ✅ נשלח | אל: {Email} | סוג: {Type}",
                    toEmail, emailEventType);

                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = emailEventType,
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"מייל נשלח אל {toEmail} | נושא: {subject}",
                    Success   = true
                });

                return (true, "המייל נשלח בהצלחה");
            }
            catch (SmtpException ex)
            {
                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = "EMAIL_FAILED",
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"שליחה נכשלה אל {toEmail} | סוג: {emailEventType} | שגיאה: {ex.Message}",
                    Success   = false
                });

                _logger.LogError(ex,
                    "[Email] ❌ שגיאת SMTP | אל: {Email}", toEmail);
                return (false, $"שגיאת שרת מייל: {ex.Message}");
            }
            catch (Exception ex)
            {
                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = "EMAIL_FAILED",
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"שליחה נכשלה אל {toEmail} | סוג: {emailEventType} | שגיאה: {ex.Message}",
                    Success   = false
                });

                _logger.LogError(ex,
                    "[Email] ❌ שגיאה | אל: {Email}", toEmail);
                return (false, $"Error: {ex.Message}");
            }
        }

        // ────────────────────────────────────────────────────────────────────
        //  1. סיסמה זמנית
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendTemporaryPasswordEmailAsync(
            string toEmail,
            string displayName,
            string temporaryPassword,
            string loginUrl) 
        {
            try
            {
                var subject = EncodeSubject("סיסמה זמנית - NOC Portal");

                var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
  שלום <strong>{displayName}</strong>,
  מנהל המערכת איפס את הסיסמה שלך.
</p>

<!-- קוד סיסמה -->
<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"">
  <tr>
    <td align=""center""
        style=""border:1px dashed {ColorBorder};
               border-radius:6px;padding:16px;"">
      <p style=""margin:0 0 6px 0;font-size:13px;color:{ColorTextSub};"">
        סיסמה זמנית
      </p>
      <span style=""font-family:'Courier New',Courier,monospace;
                    font-size:24px;font-weight:700;
                    letter-spacing:6px;color:{ColorPrimary};"">
        {temporaryPassword}
      </span>
    </td>
  </tr>
</table>

{BuildAlert(
    "<strong>נדרש שינוי סיסמה</strong> בכניסה הבאה למערכת.",
    ColorWarning, "#92400E")}

{BuildAlert(
    "לא ביקשת איפוס? פנה מיידית למנהל המערכת.",
    ColorDanger, "#991B1B")}

{BuildButton(loginUrl, "כניסה למערכת", ColorAccent)}"; 

                var html = BuildEmailHtml(
                    accentColor:    ColorWarning,
                    headerTitle:    "סיסמה זמנית הוגדרה",
                    headerSubtitle: "נדרש שינוי סיסמה בכניסה הבאה",
                    bodyContent:    body);

                return await SendEmailAsync(toEmail, displayName, subject, html,AuditEventTypes.EmailTempPass);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error: שגיאה בשליחת מייל סיסמה זמנית ל-{Email}", toEmail);
                return (false, ex.Message);
            }
        }

        // ────────────────────────────────────────────────────────────────────
        //  2. איפוס סיסמה
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendPasswordResetEmailAsync(
            string toEmail,
            string displayName,
            string resetToken,
            string resetUrl)
        {
            var subject = EncodeSubject("איפוס סיסמה - NOC Portal");

            var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
  שלום <strong>{displayName}</strong>,
  קיבלנו בקשה לאיפוס הסיסמה שלך.
</p>

{BuildButton(resetUrl, "איפוס סיסמה", ColorAccent)}

<p style=""margin:16px 0 8px 0;font-size:14px;color:{ColorTextSub};"">
  לחלופין, השתמש בקוד:
</p>
<table width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"">
  <tr>
    <td align=""center""
        style=""border:1px dashed {ColorBorder};
               border-radius:6px;padding:14px;"">
      <span style=""font-family:'Courier New',Courier,monospace;
                    font-size:22px;font-weight:700;
                    letter-spacing:6px;color:{ColorPrimary};"">
        {resetToken}
      </span>
    </td>
  </tr>
</table>

{BuildAlert(
    "הקישור תקף ל-<strong>30 דקות</strong> בלבד. " +
    "לא ביקשת איפוס? התעלם ממייל זה.",
    ColorWarning, "#92400E")}";

            var html = BuildEmailHtml(
                accentColor:    ColorAccent,
                headerTitle:    "איפוס סיסמה",
                headerSubtitle: "בצע את הפעולות הבאות לאיפוס הסיסמה שלך",
                bodyContent:    body);

            return await SendEmailAsync(toEmail, displayName, subject, html,AuditEventTypes.EmailReset);
        }

        // ────────────────────────────────────────────────────────────────────
        //  3. הרשמה חדשה → אדמינים
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendNewRegistrationToAdminsAsync(
            string newUsername,
            string newDisplayName,
            string newEmail,
            string adminPanelUrl)
        {
            var adminEmails = _config
                .GetSection("Email:AdminList")
                .Get<List<string>>()
                ?? new List<string> { "talyoh@menoramivt.co.il" };

            var subject      = EncodeSubject($"בקשת הרשמה חדשה - {newDisplayName}");
            var registeredAt = DateTime.Now.ToString("dd/MM/yyyy HH:mm");

            var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
  משתמש חדש מחכה לאישורך:
</p>

<table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
  {BuildInfoRow("שם מלא",      newDisplayName)}
  {BuildInfoRow("שם משתמש",    newUsername)}
  {BuildInfoRow("מייל",        string.IsNullOrEmpty(newEmail) ? "לא הוזן" : newEmail)}
  {BuildInfoRow("זמן הרשמה",   registeredAt)}
</table>

{BuildButton(adminPanelUrl, "מעבר לניהול משתמשים", ColorAccent)}";

            var html = BuildEmailHtml(
                accentColor:    ColorAccent,
                headerTitle:    "בקשת הרשמה חדשה",
                headerSubtitle: "נדרש אישור מנהל מערכת",
                bodyContent:    body);

            var errors = new List<string>();
            var anyOk  = false;

            foreach (var adminEmail in adminEmails)
            {
                var (ok, msg) = await SendEmailAsync(adminEmail, "Admin", subject, html);
                if (ok) anyOk = true;
                else    errors.Add($"{adminEmail}: {msg}");
            }

            return anyOk
                ? (true,  "מייל נשלח לאדמינים בהצלחה")
                : (false, string.Join(" | ", errors));
        }

        // ────────────────────────────────────────────────────────────────────
        //  4. חשבון אושר
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendAccountApprovedEmailAsync(
            string toEmail,
            string displayName,
            string loginUrl)
        {
            var subject    = EncodeSubject("חשבונך אושר - NOC Portal");
            var approvedAt = DateTime.Now.ToString("dd/MM/yyyy HH:mm");

            var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
  שלום <strong>{displayName}</strong>,
  בקשת ההרשמה שלך <strong>אושרה</strong>.
</p>

<table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
  {BuildInfoRow("שם מלא",       displayName)}
  {BuildInfoRow("תאריך אישור",  approvedAt)}
</table>

{BuildButton(loginUrl, "כניסה למערכת", ColorSuccess)}

{BuildAlert(
    "מומלץ לא לשתף את פרטי הכניסה עם אחרים.",
    ColorSuccess, "#166534")}";

            var html = BuildEmailHtml(
                accentColor:    ColorSuccess,
                headerTitle:    "חשבונך אושר",
                headerSubtitle: "ברוך הבא למערכת NOC Portal",
                bodyContent:    body);

            return await SendEmailAsync(toEmail, displayName, subject, html,AuditEventTypes.EmailApproved);
        }

        // ────────────────────────────────────────────────────────────────────
        //  5. חשבון נדחה
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendAccountRejectedEmailAsync(
            string toEmail,
            string displayName)
        {
            var subject = EncodeSubject("עדכון בקשת הרשמה - NOC Portal");

            var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
  שלום <strong>{displayName}</strong>,
  לאחר בדיקת בקשת ההרשמה שלך, <strong>הבקשה לא אושרה</strong> בשלב זה.
</p>

{BuildAlert(
    "לפרטים נוספים, אנא פנה למנהל המערכת.",
    ColorWarning, "#92400E")}";

            var html = BuildEmailHtml(
                accentColor:    ColorDanger,
                headerTitle:    "עדכון בקשת הרשמה",
                headerSubtitle: "בקשתך נבדקה על ידי מנהל המערכת",
                bodyContent:    body);

            return await SendEmailAsync(toEmail, displayName, subject, html,AuditEventTypes.EmailRejected);
        }

        // ────────────────────────────────────────────────────────────────────
        //  6. שינוי סיסמה
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendPasswordChangedEmailAsync(
            string toEmail,
            string displayName,
            string ipAddress)
        {
            var subject   = EncodeSubject("הסיסמה שלך שונתה - NOC Portal");
            var changedAt = DateTime.Now.ToString("dd/MM/yyyy HH:mm");

            var body = $@"
<p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
  שלום <strong>{displayName}</strong>,
  הסיסמה שלך שונתה בהצלחה.
</p>

<table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
  {BuildInfoRow("זמן השינוי", changedAt)}
</table>

{BuildAlert(
    "<strong>לא ביצעת שינוי זה? </strong> " +
    "פנה מיידית למנהל המערכת.",
    ColorDanger, "#991B1B")}";

            var html = BuildEmailHtml(
                accentColor:    ColorSuccess,
                headerTitle:    "הסיסמה שונתה",
                headerSubtitle: "פעולת אבטחה - שינוי סיסמה",
                bodyContent:    body);

            return await SendEmailAsync(toEmail, displayName, subject, html,AuditEventTypes.EmailChangedPass);
        }

        // ────────────────────────────────────────────────────────────────────
        //  7. הזמנת פגישה - שינוי מתוכנן
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendCalendarInviteEmailAsync(
            CalendarInviteRequest req)
        {
            try
            {
                var subject = EncodeSubject(
                    $"[{req.ChangeNumber}] {req.ChangeName}");

                // ── בניית ICS ──────────────────────────────────────────────
                var icsContent = BuildIcsContent(req);
                var icsBytes   = System.Text.Encoding.UTF8.GetBytes(icsContent);

                // ── בניית גוף HTML ─────────────────────────────────────────
                var rows = new System.Text.StringBuilder();

                void AddRow(string label, string value)
                {
                    if (string.IsNullOrWhiteSpace(value)) return;
                    rows.Append($@"
        <tr>
          <td style=""padding:7px 12px;font-size:14px;color:#64748B;
                    background:#F8FAFC;border-bottom:1px solid #E2E8F0;
                    white-space:nowrap;font-weight:600;width:35%;"">
            {label}
          </td>
          <td style=""padding:7px 12px;font-size:14px;color:#1E293B;
                    border-bottom:1px solid #E2E8F0;"">
            {value}
          </td>
        </tr>");
                }

                AddRow("מספר שינוי",  req.ChangeNumber);
                AddRow("שם השינוי",   req.ChangeName);
                AddRow("תאריך התחלה", req.StartDate);

                if (!string.IsNullOrWhiteSpace(req.EndDate))
                    AddRow("תאריך סיום", req.EndDate);

                AddRow("אחראי",       req.Presenter);
                AddRow("צוות מבצע",   req.ExecutingTeam);
                AddRow("מערכת",       req.System);
                AddRow("סטטוס",       req.Status);

                // קישור - שורה מיוחדת עם לינק
                if (!string.IsNullOrWhiteSpace(req.Link))
                {
                    rows.Append($@"
        <tr>
          <td style=""padding:7px 12px;font-size:14px;color:#64748B;
                    background:#F8FAFC;border-bottom:1px solid #E2E8F0;
                    white-space:nowrap;font-weight:600;width:35%;"">
            קישור לשינוי
          </td>
          <td style=""padding:7px 12px;font-size:14px;
                    border-bottom:1px solid #E2E8F0;"">
            <a href=""{req.Link}""
              style=""color:{ColorAccent};text-decoration:none;font-weight:600;"">
              פתח קישור ↗
            </a>
          </td>
        </tr>");
                }

                var tableHtml = $@"
        <table cellpadding=""0"" cellspacing=""0"" border=""0""
              style=""width:100%;border-collapse:collapse;
                      border:1px solid #E2E8F0;border-radius:8px;
                      overflow:hidden;"">
          <tbody>
            {rows}
          </tbody>
        </table>";

                // הערות / תיאור
                var descHtml = string.Empty;
                if (!string.IsNullOrWhiteSpace(req.Description) ||
                    !string.IsNullOrWhiteSpace(req.Notes))
                {
                    var descText = !string.IsNullOrWhiteSpace(req.Description)
                        ? req.Description
                        : req.Notes;

                    descHtml = $@"
        {BuildAlert(
            $"<strong>תיאור:</strong> {descText}",
            ColorAccent, "#1E40AF")}";
                }

                var body = $@"
        <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
          מצורפת הזמנה עבור השינוי הבא:
        </p>

        {tableHtml}

        {descHtml}

        {BuildAlert(
            "הזמנה זו נשלחה ממערכת NOC Portal ",
            ColorSuccess, "#166534")}";

                var html = BuildEmailHtml(
                    accentColor:    ColorPrimary,
                    headerTitle:    $"{req.ChangeNumber}<br/>{req.ChangeName}",
                    headerSubtitle: $"הזמנה לפגישת השינוי — {req.StartDate}",
                    bodyContent:    body);

                // ── שליחת מייל עם ICS מצורף ────────────────────────────────
                var fromAddress = _config["Email:FromAddress"]
                    ?? "noc@menoramivt.co.il";
                var fromName = _config["Email:FromName"] ?? "NOC Portal";

                using var client = new System.Net.Mail.SmtpClient(SmtpHost, SmtpPort)
                {
                    EnableSsl             = false,
                    DeliveryMethod        =
                        System.Net.Mail.SmtpDeliveryMethod.Network,
                    UseDefaultCredentials = false,
                    Credentials           =
                        System.Net.CredentialCache.DefaultNetworkCredentials,
                    Timeout               = 10_000
                };

                using var mail = new System.Net.Mail.MailMessage
                {
                    From       = new System.Net.Mail.MailAddress(
                                    fromAddress, fromName),
                    Subject    = subject,
                    Body       = html,
                    IsBodyHtml = true
                };

                mail.SubjectEncoding = System.Text.Encoding.UTF8;
                mail.BodyEncoding    = System.Text.Encoding.UTF8;
                mail.HeadersEncoding = System.Text.Encoding.UTF8;

                // נמען
                var toName = string.IsNullOrWhiteSpace(req.ToName)
                    ? req.ToEmail
                    : req.ToName;
                mail.To.Add(new System.Net.Mail.MailAddress(req.ToEmail, toName));

                // ── צירוף ICS כקובץ מצורף ──────────────────────────────────
                var icsStream = new System.IO.MemoryStream(icsBytes);
                var attachment = new System.Net.Mail.Attachment(
                    icsStream,
                    $"{req.ChangeNumber}.ics",
                    "text/calendar");

                // הוסף header לזיהוי כהזמנת פגישה
                attachment.ContentDisposition!.Inline = false;
                mail.Attachments.Add(attachment);

                var htmlView =
                  AlternateView.CreateAlternateViewFromString(
                      html,
                      System.Text.Encoding.UTF8,
                      "text/html");

              mail.AlternateViews.Add(htmlView);

              var icsView =
                  AlternateView.CreateAlternateViewFromString(
                      icsContent,
                      System.Text.Encoding.UTF8,
                      "text/calendar");

              icsView.ContentType.Parameters.Add("method", "REQUEST");

              mail.AlternateViews.Add(icsView);

                await client.SendMailAsync(mail);

                _logger.LogInformation(
                    "הזמנת פגישה נשלחה אל {Email} עבור שינוי {Number}",
                    req.ToEmail, req.ChangeNumber);
                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = AuditEventTypes.EmailCalendar,
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"הזמנת פגישה נשלחה אל {req.ToEmail} | שינוי: {req.ChangeNumber}",
                    Success   = true
                });
                return (true, $"ההזמנה נשלחה בהצלחה אל {req.ToEmail}");
            }
            catch (System.Net.Mail.SmtpException ex)
            {
                
                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = AuditEventTypes.EmailFailed,
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"הזמנת פגישה נכשלה אל {req.ToEmail} | שינוי: {req.ChangeNumber} | {ex.Message}",
                    Success   = false
                });
                _logger.LogError(ex,
                    "Error: שגיאת SMTP בשליחת הזמנה עבור {Number}", req.ChangeNumber);
                return (false, $"שגיאת שרת מייל: {ex.Message}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error: שגיאה בשליחת הזמנה עבור {Number}", req.ChangeNumber);
                return (false, $"Error: {ex.Message}");
            }
        }

        /// <summary>
        /// חושף את BuildEmailHtml לשימוש חיצוני - לבניית מייל התראת שינוי
        /// </summary>
        public string BuildAlarmEmailHtml(
            string accentColor,
            string headerTitle,
            string headerSubtitle,
            string bodyContent)
        {
            return BuildEmailHtml(
                accentColor:    accentColor,
                headerTitle:    headerTitle,
                headerSubtitle: headerSubtitle,
                bodyContent:    bodyContent
            );
        }

        // ────────────────────────────────────────────────────────────────────
        //  חדש: שליחת מייל על ביצוע משימה
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendTaskCompletionEmailAsync(
            string toEmail,
            string ccEmail,
            string subject,
            string body,
            string taskTitle,
            string completedBy,
            string completionTime)
        {
            try
            {
                // אם אין נושא - צור ברירת מחדל
                if (string.IsNullOrWhiteSpace(subject))
                    subject = $"משימה הושלמה: {taskTitle}";

                // אם אין גוף - צור ברירת מחדל
                if (string.IsNullOrWhiteSpace(body))
                    body = $"המשימה <strong>{taskTitle}</strong> " +
                        $"הושלמה על ידי <strong>{completedBy}</strong> " +
                        $"בשעה {completionTime}.";

                var encodedSubject = EncodeSubject(subject);

                // בנה HTML גוף אם הגוף הוא טקסט פשוט
                var htmlBody = body.Contains("<") ? body : $@"
                    <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
                        {body}
                    </p>";

                // הוסף טבלת פרטים
                var fullBody = $@"
                    {htmlBody}

                    <table cellpadding=""0"" cellspacing=""0"" border=""0"" 
                        style=""width:100%;margin-top:16px;"">
                        {BuildInfoRow("משימה",      taskTitle)}
                        {BuildInfoRow("בוצע על ידי", completedBy)}
                        {BuildInfoRow("שעת ביצוע",  completionTime)}
                        {BuildInfoRow("תאריך",       DateTime.Now.ToString("dd/MM/yyyy"))}
                    </table>

                    {BuildAlert(
                        "מייל זה נשלח אוטומטית על ביצוע משימה במערכת NOC Portal.",
                        ColorSuccess, "#166534")}";

                var html = BuildEmailHtml(
                    accentColor:    ColorSuccess,
                    headerTitle:    "✓ משימה הושלמה",
                    headerSubtitle: taskTitle,
                    bodyContent:    fullBody);

                // ── שליחה עם CC ──────────────────────────────────────
                var fromAddress = _config["Email:FromAddress"] ?? "noc@menoramivt.co.il";
                var fromName    = _config["Email:FromName"]    ?? "NOC Portal";

                using var client = new SmtpClient(SmtpHost, SmtpPort)
                {
                    EnableSsl             = false,
                    DeliveryMethod        = SmtpDeliveryMethod.Network,
                    UseDefaultCredentials = false,
                    Credentials           = CredentialCache.DefaultNetworkCredentials,
                    Timeout               = 10_000
                };

                using var mail = new MailMessage
                {
                    From       = new MailAddress(fromAddress, fromName),
                    Subject    = encodedSubject,
                    Body       = html,
                    IsBodyHtml = true
                };

                mail.SubjectEncoding = System.Text.Encoding.UTF8;
                mail.BodyEncoding    = System.Text.Encoding.UTF8;
                mail.HeadersEncoding = System.Text.Encoding.UTF8;

                mail.To.Add(new MailAddress(toEmail));

                // הוסף CC אם קיים
                if (!string.IsNullOrWhiteSpace(ccEmail))
                {
                    foreach (var cc in ccEmail.Split(
                        new[] { ',', ';' }, 
                        StringSplitOptions.RemoveEmptyEntries))
                    {
                        var ccTrimmed = cc.Trim();
                        if (!string.IsNullOrEmpty(ccTrimmed))
                            mail.CC.Add(new MailAddress(ccTrimmed));
                    }
                }

                await client.SendMailAsync(mail);

                _logger.LogInformation(
                    "[Email] ✅ מייל ביצוע משימה נשלח | משימה: {Task} | אל: {Email}",
                    taskTitle, toEmail);

                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = AuditEventTypes.EmailSent,
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"מייל ביצוע משימה נשלח | משימה: {taskTitle} | אל: {toEmail}",
                    Success   = true
                });

                return (true, "מייל נשלח בהצלחה");
            }
            catch (SmtpException ex)
            {
                _logger.LogError(ex,
                    "[Email] ❌ שגיאת SMTP בשליחת מייל ביצוע | משימה: {Task}",
                    taskTitle);
                return (false, $"שגיאת שרת מייל: {ex.Message}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "[Email] ❌ שגיאה בשליחת מייל ביצוע | משימה: {Task}",
                    taskTitle);
                return (false, $"Error: {ex.Message}");
            }
        }

        // ── עזר: בניית תוכן ICS ────────────────────────────────────────────
        private string BuildIcsContent(CalendarInviteRequest req)
        {
            var pad = (int n) => n.ToString("D2");

            // פרסור תאריך התחלה
            DateTime? startDt = TryParseDateTime(req.StartDate);
            DateTime? endDt   = TryParseDateTime(req.EndDate);

            if (startDt == null)
                startDt = DateTime.Now.AddHours(1);

            if (endDt == null || endDt <= startDt)
                endDt = startDt.Value.AddHours(1);

            bool hasTime = startDt.Value.Hour != 0 ||
                          startDt.Value.Minute != 0;

            string FmtIcs(DateTime d, bool withTime)
            {
                var s = $"{d.Year}{pad(d.Month)}{pad(d.Day)}";
                if (!withTime) return s;
                return $"{s}T{pad(d.Hour)}{pad(d.Minute)}00";
            }

            string EscIcs(string s) => (s ?? "")
                .Replace("\n", "\\n")
                .Replace(",",  "\\,")
                .Replace(";",  "\\;");

            var uid      = $"{req.ChangeNumber}-{DateTime.UtcNow.Ticks}@noc-portal";
            var dtStamp  = FmtIcs(DateTime.UtcNow, true) + "Z";
            var dtStart  = hasTime
                ? $"DTSTART:{FmtIcs(startDt.Value, true)}"
                : $"DTSTART;VALUE=DATE:{FmtIcs(startDt.Value, false)}";
            var dtEnd    = hasTime
                ? $"DTEND:{FmtIcs(endDt.Value, true)}"
                : $"DTEND;VALUE=DATE:{FmtIcs(endDt.Value, false)}";

            var summary  = EscIcs($"[{req.ChangeNumber}] {req.ChangeName}");

            var descParts = new List<string>();
            if (!string.IsNullOrWhiteSpace(req.Presenter))
                descParts.Add($"אחראי: {req.Presenter}");
            if (!string.IsNullOrWhiteSpace(req.ExecutingTeam))
                descParts.Add($"צוות מבצע: {req.ExecutingTeam}");
            if (!string.IsNullOrWhiteSpace(req.System))
                descParts.Add($"מערכת: {req.System}");
            if (!string.IsNullOrWhiteSpace(req.Status))
                descParts.Add($"סטטוס: {req.Status}");
            if (!string.IsNullOrWhiteSpace(req.Description))
                descParts.Add($"תיאור: {req.Description}");
            if (!string.IsNullOrWhiteSpace(req.Link))
                descParts.Add($"קישור: {req.Link}");

            var description = EscIcs(string.Join("\\n", descParts));

            var fromAddress = _config["Email:FromAddress"]
                ?? "noc@menoramivt.co.il";

            var lines = new[]
            {
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//NOC Portal//IL",
                "CALSCALE:GREGORIAN",
                "METHOD:REQUEST",
                "BEGIN:VEVENT",
                $"UID:{uid}",
                $"DTSTAMP:{dtStamp}",
                dtStart,
                dtEnd,
                $"SUMMARY:{summary}",
                $"DESCRIPTION:{description}",
                $"ORGANIZER:mailto:{fromAddress}",
                "STATUS:CONFIRMED",
                "TRANSP:OPAQUE",
                "BEGIN:VALARM",
                "TRIGGER:-PT30M",
                "ACTION:DISPLAY",
                $"DESCRIPTION:תזכורת: {EscIcs(req.ChangeNumber)}",
                "END:VALARM",
                "END:VEVENT",
                "END:VCALENDAR"
            };

            return string.Join("\r\n", lines);
        }

        // ── עזר: פרסור תאריך + שעה ────────────────────────────────────────
        private DateTime? TryParseDateTime(string str)
        {
            if (string.IsNullOrWhiteSpace(str)) return null;

            // dd/mm/yyyy HH:MM
            var m1 = System.Text.RegularExpressions.Regex.Match(
                str,
                @"^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})" +
                @"(?:\s+(\d{1,2}):(\d{2}))?");
            if (m1.Success)
            {
                int day   = int.Parse(m1.Groups[1].Value);
                int month = int.Parse(m1.Groups[2].Value);
                int year  = int.Parse(m1.Groups[3].Value);
                int hour  = m1.Groups[4].Success
                    ? int.Parse(m1.Groups[4].Value) : 0;
                int min   = m1.Groups[5].Success
                    ? int.Parse(m1.Groups[5].Value) : 0;
                try { return new DateTime(year, month, day, hour, min, 0); }
                catch { }
            }

            // yyyy-mm-dd HH:MM
            var m2 = System.Text.RegularExpressions.Regex.Match(
                str,
                @"^(\d{4})-(\d{1,2})-(\d{1,2})" +
                @"(?:[T\s](\d{1,2}):(\d{2}))?");
            if (m2.Success)
            {
                int year  = int.Parse(m2.Groups[1].Value);
                int month = int.Parse(m2.Groups[2].Value);
                int day   = int.Parse(m2.Groups[3].Value);
                int hour  = m2.Groups[4].Success
                    ? int.Parse(m2.Groups[4].Value) : 0;
                int min   = m2.Groups[5].Success
                    ? int.Parse(m2.Groups[5].Value) : 0;
                try { return new DateTime(year, month, day, hour, min, 0); }
                catch { }
            }

            if (DateTime.TryParse(str, out var parsed))
                return parsed;

            return null;
        }

        public async Task<(bool success, string message)> SendValidationReminderEmailAsync(
        string toEmail,
        string toName,
        string systemName,
        string validateUrl,
        string catalogNumber  = "",
        int    daysSinceSent  = 3,
        string originalSentAt = "")
        {
            var subject = EncodeSubject(
                $"תזכורת: תיקוף פרטי מערכת - {systemName}");

            var catalogRow = !string.IsNullOrWhiteSpace(catalogNumber)
                ? BuildInfoRow("מספר קטלוגי", catalogNumber)
                : "";

            // ─── חשב תאריך תפוגה מהמייל המקורי ───
            string expiryInfo = "";
            if (!string.IsNullOrWhiteSpace(originalSentAt) &&
                DateTime.TryParseExact(
                    originalSentAt,
                    "yyyy-MM-dd HH:mm",
                    null,
                    System.Globalization.DateTimeStyles.None,
                    out var sentDt))
            {
                var expiryDate = sentDt.AddDays(7).ToString("dd/MM/yyyy");
                expiryInfo = $"הקישור תקף עד <strong>{expiryDate}</strong>";
            }

           var body = $@"
            <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
            שלום <strong>{toName}</strong>,
            לפני <strong>{daysSinceSent} ימים</strong> נשלחה אליך בקשה לתיקוף פרטי המערכת.<br>
            טרם בוצע תיקוף למערכת.
            </p>

            <table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
            {catalogRow}
            {BuildInfoRow("שם מערכת",       systemName)}
            </table>

            {BuildButton(validateUrl, "תיקוף פרטי המערכת", ColorWarning)}

            {(!string.IsNullOrEmpty(expiryInfo)
                ? BuildAlert(expiryInfo, ColorWarning, "#92400E")
                : "")}

            {BuildAlert(
                "לשאלות נוספות ניתן לפנות אל חדר מחשב/טל יוחאי במייל חוזר.",
                ColorAccent, "#1E40AF")}";

            var logoBase64 = GetMenoraLogoBase64();

            var html = BuildEmailHtmlWithLogo(
                accentColor:    ColorWarning,
                headerTitle:    "תזכורת: טרם בוצע תיקוף",
                headerSubtitle: $"{systemName}",
                bodyContent:    body,
                logoBase64:     logoBase64);

            return await SendEmailAsync(
                toEmail, toName, subject, html,
                AuditEventTypes.EmailValidation);
        }

        // ────────────────────────────────────────────────────────────────────
        //  8. בקשת תיקוף מערכת
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendValidationRequestEmailAsync(
            string toEmail,
            string toName,
            string systemName,
            string validateUrl,
            string catalogNumber = "",
            string? managerPageUrl = null)
        {
            var subject = EncodeSubject($"בקשה לתיקוף פרטי מערכת: {systemName}");

            // ← הוסף שורת מספר קטלוגי אם קיים
            var catalogRow = !string.IsNullOrWhiteSpace(catalogNumber)
                ? BuildInfoRow("מספר קטלוגי", catalogNumber)
                : "";
            // ─── הוסף כפתור "כל המערכות שלי" אם יש URL ───
            var managerPageSection = string.IsNullOrWhiteSpace(managerPageUrl)
                ? ""
                : $@"
                {BuildButton(
                    managerPageUrl,
                    "לתיקוף כל המערכות שלי",
                    "#7C3AED")}";

            // ─── חשב תאריך תפוגה ───
            var expiryDate = DateTime.Now.AddDays(7).ToString("dd/MM/yyyy");

            var body = $@"
            <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
            שלום <strong>{toName}</strong>,
            יש לבצע תיקוף לפרטי המערכת שבאחריותך.
            </p>

            <table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
            {catalogRow}
            {BuildInfoRow("שם מערכת", systemName)}
            </table>

            <p style=""margin:16px 0 8px 0;font-size:15px;color:{ColorTextSub};"">
            ניתן ללחוץ על הקישור מטה ולעדכן את הפרטים הרלוונטיים.
            הסבר על כל שדה ניתן למצוא בריחוף העכבר על שם השדה.
            </p>
            {BuildButton(validateUrl, "תיקוף פרטי המערכת", ColorAccent)}

            {BuildAlert(
                $"הקישור תקף עד תאריך <strong>{expiryDate}</strong>",
                ColorWarning, "#92400E")}

            {BuildAlert(
                "לשאלות נוספות ניתן לפנות אל חדר מחשב/טל יוחאי במייל חוזר.",
                ColorAccent, "#1E40AF")}
                
            {managerPageSection}";

            var logoBase64 = GetMenoraLogoBase64();

            var html = BuildEmailHtmlWithLogo(
                accentColor:    ColorAccent,
                headerTitle:    "בקשה לתיקוף פרטי מערכת",
                headerSubtitle: !string.IsNullOrWhiteSpace(catalogNumber)
                    ? $"{systemName}"
                    : systemName,
                bodyContent:    body,
                logoBase64:     logoBase64);

            return await SendEmailAsync(toEmail, toName, subject, html,AuditEventTypes.EmailValidation);
        }

        public async Task<(bool ok, string msg)> SendAnnualValidationReminderEmailAsync(
            string toEmail,
            string toName,
            string systemName,
            string validateUrl,
            string catalogNumber,
            string lastValidatedAt)
        {
            try
            {
                var subject = EncodeSubject(
                    $"תיקוף שנתי - {systemName} ({catalogNumber})");

                // ─── חשב תאריך תפוגה (7 ימים) ───
                var expiryDate = DateTime.Now.AddDays(7).ToString("dd/MM/yyyy");

                var catalogRow = !string.IsNullOrWhiteSpace(catalogNumber)
                    ? BuildInfoRow("מספר קטלוגי", catalogNumber)
                    : "";

                var body = $@"
        <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
        שלום <strong>{toName}</strong>,<br>
        עברה <strong>שנה</strong> מאז תוקפה המערכת שבאחריותך בפעם האחרונה.
        <br>עליך לבצע תיקוף למערכת בהקדם.
        </p>

        <table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
        {catalogRow}
        {BuildInfoRow("שם מערכת",        systemName)}
        {BuildInfoRow("תיקוף אחרון",     lastValidatedAt)}
        </table>

        {BuildButton(validateUrl, "תיקוף פרטי המערכת", ColorWarning)}

        {BuildAlert(
            $"הקישור תקף עד תאריך <strong>{expiryDate}</strong>",
            ColorWarning, "#92400E")}

        {BuildAlert(
            "לשאלות נוספות ניתן לפנות אל חדר מחשב/טל יוחאי במייל חוזר.",
            ColorAccent, "#1E40AF")}";

                var logoBase64 = GetMenoraLogoBase64();

                var html = BuildEmailHtmlWithLogo(
                    accentColor:    ColorWarning,
                    headerTitle:    "תיקוף שנתי",
                    headerSubtitle: $"{systemName}",
                    bodyContent:    body,
                    logoBase64:     logoBase64);

                return await SendEmailAsync(
                    toEmail, toName, subject, html,
                    AuditEventTypes.EmailValidation);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "[Email] שגיאה בשליחת תזכורת שנתית ל-{Email}", toEmail);
                return (false, ex.Message);
            }
        }

        // ────────────────────────────────────────────────────────────────────
        //  9. אישור תיקוף מערכת
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendValidationCompletedEmailAsync(
            string managerEmail,
            string managerName,
            string systemName,
            string systemUrl,
            string validatedAt,
            string catalogNumber = "")
        {
            var subject = EncodeSubject($"מערכת תוקפה: {systemName}");

            // ← הוסף שורת מספר קטלוגי אם קיים
            var catalogRow = !string.IsNullOrWhiteSpace(catalogNumber)
                ? BuildInfoRow("מספר קטלוגי", catalogNumber)
                : "";

            var body = $@"
            <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
            המערכת <strong>{systemName}</strong> תוקפה בהצלחה.
            </p>

            <table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
            {catalogRow}
            {BuildInfoRow("שם מערכת",    systemName)}
            {BuildInfoRow("מנהל מערכת",  managerName)}
            {BuildInfoRow("תאריך תיקוף", validatedAt)}
            </table>

            {BuildButton(systemUrl, "מעבר לקטלוג מערכות", ColorSuccess)}";

            var logoBase64 = GetMenoraLogoBase64();

            var html = BuildEmailHtmlWithLogo(
                accentColor:    ColorSuccess,
                headerTitle:    "מערכת תוקפה",
                headerSubtitle: !string.IsNullOrWhiteSpace(catalogNumber)
                    ? $" | {systemName} | תיקוף בוצע בתאריך {validatedAt}"
                    : $"תיקוף בוצע בתאריך {validatedAt}",
                bodyContent:    body,
                logoBase64:     logoBase64);

            try
            {
                var fromAddress = _config["Email:FromAddress"] ?? "noc@menoramivt.co.il";
                var fromName    = _config["Email:FromName"]    ?? "NOC Portal";

                using var client = new SmtpClient(SmtpHost, SmtpPort)
                {
                    EnableSsl             = false,
                    DeliveryMethod        = SmtpDeliveryMethod.Network,
                    UseDefaultCredentials = false,
                    Credentials           = CredentialCache.DefaultNetworkCredentials,
                    Timeout               = 10_000
                };

                using var mail = new MailMessage
                {
                    From       = new MailAddress(fromAddress, fromName),
                    Subject    = subject,
                    Body       = html,
                    IsBodyHtml = true
                };

                mail.SubjectEncoding = System.Text.Encoding.UTF8;
                mail.BodyEncoding    = System.Text.Encoding.UTF8;
                mail.HeadersEncoding = System.Text.Encoding.UTF8;

                // ─── נמען ראשי: מנהל המערכת ───
                mail.To.Add(new MailAddress(managerEmail, managerName));

                // ─── CC: טל יוחאי ───
                // mail.CC.Add(new MailAddress("talyoh@menoramivt.co.il", "טל יוחאי"));

                await client.SendMailAsync(mail);
                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = AuditEventTypes.EmailValidation,
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"מייל תיקוף נשלח אל {managerEmail} | מערכת: {systemName}",
                    // Details   = $"מייל תיקוף נשלח אל {managerEmail} (CC: talyoh) | מערכת: {systemName}",
                    Success   = true
                });
                _logger.LogInformation(
                    "מייל תיקוף נשלח אל {Email} עבור מערכת {System}",
                    // "מייל תיקוף נשלח אל {Email} (CC: talyoh) עבור מערכת {System}",
                    managerEmail, systemName);

                return (true, $"מייל נשלח ל-{managerEmail}");
                // return (true, $"מייל נשלח ל-{managerEmail} (CC: טל יוחאי)");
            }
            catch (SmtpException ex)
            {
                _auditLog?.Log(new AuditLogEntry
                {
                    EventType = AuditEventTypes.EmailFailed,
                    Username  = "system",
                    IpAddress = "system",
                    Details   = $"מייל תיקוף נכשל אל {managerEmail} | מערכת: {systemName} | {ex.Message}",
                    Success   = false
                });
                _logger.LogError(ex,
                    "שגיאת SMTP בשליחת מייל תיקוף ל-{Email}", managerEmail);
                return (false, $"שגיאת שרת מייל: {ex.Message}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "שגיאה בשליחת מייל תיקוף ל-{Email}", managerEmail);
                return (false, $"Error: {ex.Message}");
            }
        }

        // מתודה חדשה ייעודית לאישור מרובה
        public async Task<(bool success, string message)> 
            SendBulkValidationCompletedEmailAsync(
                string managerEmail,
                string managerName,
                List<string> systemNames,    // ← רשימה במקום שם בודד
                string catalogUrl)
        {
            var count   = systemNames.Count;
            var subject = EncodeSubject(
                $"אישור תיקוף - {count} מערכות");

            // ניסוח תקין לפי מספר
            var titleText = count == 1
                ? $"המערכת <strong>{systemNames[0]}</strong> תוקפה בהצלחה"
                : $"תוקפו בהצלחה <strong>{count} מערכות</strong>";

            var systemListHtml = string.Join("",
                systemNames.Select(n =>
                    $"<li style='padding:4px 0;font-size:14px;" +
                    $"color:#166534;'>{n}</li>"));

            var body = $@"
        <p style='margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};'>
        שלום <strong>{managerName}</strong>,<br>
        {titleText}.
        </p>

        <ul style='margin:12px 0;padding-right:20px;
                background:rgba(34,197,94,0.06);
                border:1px solid rgba(34,197,94,0.2);
                border-radius:8px;padding:12px 28px;
                list-style:none;'>
        {systemListHtml}
        </ul>

        {BuildButton(catalogUrl, "מעבר לקטלוג מערכות", ColorSuccess)}";

            var logoBase64 = GetMenoraLogoBase64();
            var html = BuildEmailHtmlWithLogo(
                accentColor:    ColorSuccess,
                headerTitle:    count == 1
                    ? "מערכת תוקפה בהצלחה"
                    : $"תוקפו בהצלחה {count} מערכות",
                headerSubtitle: $"תיקוף בוצע בתאריך " +
                    $"{DateTime.Now:dd/MM/yyyy HH:mm}",
                bodyContent:    body,
                logoBase64:     logoBase64);

            return await SendEmailAsync(
                managerEmail, managerName, subject, html,
                AuditEventTypes.EmailValidation);
        }

        // ────────────────────────────────────────────────────────────────────
        //  10. סיכום שליחה מרובה - מערכות חסרות
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)> SendBulkValidationSummaryEmailAsync(
            string       toEmail,
            List<string> noManager,
            List<string> noDeptManager,
            int          totalSent,
            int          totalMarked)
        {
            var subject = EncodeSubject("סיכום שליחת תיקוף מרובה - מערכות חסרות");

            var noMgrHtml = noManager.Count > 0
                ? "<ul style=\"margin:8px 0;padding-right:20px;\">" +
                string.Join("", noManager.Select(n =>
                    $"<li style=\"font-size:14px;color:{ColorTextMain};padding:2px 0;\">{n}</li>")) +
                "</ul>"
                : $"<p style=\"color:{ColorSuccess};font-size:14px;\">✓ כל המערכות כוללות מנהל מערכת</p>";

            var noDeptHtml = noDeptManager.Count > 0
                ? "<ul style=\"margin:8px 0;padding-right:20px;\">" +
                string.Join("", noDeptManager.Select(n =>
                    $"<li style=\"font-size:14px;color:{ColorTextMain};padding:2px 0;\">{n}</li>")) +
                "</ul>"
                : $"<p style=\"color:{ColorSuccess};font-size:14px;\">✓ כל המערכות כוללות מנהל מחלקה</p>";

            var body = $@"
        <table cellpadding=""0"" cellspacing=""0"" border=""0"" style=""width:100%;"">
        {BuildInfoRow("סה\"כ מערכות שסומנו", totalMarked.ToString())}
        {BuildInfoRow("מיילים שנשלחו",       totalSent.ToString())}
        {BuildInfoRow("ללא מנהל מערכת",      noManager.Count.ToString())}
        {BuildInfoRow("ללא מנהל מחלקה",      noDeptManager.Count.ToString())}
        </table>

        {(noManager.Count > 0 ? $@"
        <p style=""margin:16px 0 6px 0;font-size:15px;font-weight:700;
                color:{ColorDanger};"">
        מערכות ללא מנהל מערכת ({noManager.Count}):
        </p>
        {noMgrHtml}" : "")}

        {BuildAlert(
            "מומלץ להשלים את פרטי המנהלים החסרים בקטלוג המערכות.",
            ColorWarning, "#92400E")}";

            var html = BuildEmailHtml(
                accentColor:    ColorWarning,
                headerTitle:    "סיכום שליחת תיקוף מרובה",
                headerSubtitle: $"נשלחו {totalSent} מיילים מתוך {totalMarked} מערכות",
                bodyContent:    body);

            return await SendEmailAsync(toEmail, "טל יוחאי", subject, html,AuditEventTypes.EmailValidation);
        }

        // ────────────────────────────────────────────────────────────────────
        //  11. מייל מרוכז - כל קישורי התיקוף לפי מנהל מערכת
        // ────────────────────────────────────────────────────────────────────
        public async Task<(bool success, string message)>
            SendBulkValidationLinksEmailAsync(
                string toEmail,
                string toName,
                Dictionary<string, List<(string systemName,
                                        string catalogNumber,
                                        string validateUrl)>> byManager,
                Dictionary<string, string> managerPageUrls,
                int totalSystems)
        {
            var subject = EncodeSubject(
                $"קישורי תיקוף מרוכזים - {totalSystems} מערכות");

            var sectionsHtml = new System.Text.StringBuilder();

            foreach (var (managerName, systems) in byManager.OrderBy(k => k.Key))
            {
                var isNoManager = managerName == "__no_manager__";
                var displayName = isNoManager ? "ללא מנהל מערכת" : managerName;
                var headerColor = isNoManager ? ColorWarning : ColorAccent;

                // ─── קישור לדף המנהל (אם קיים) ───
                string? managerPageUrl = null;
            if (managerPageUrls != null)
                managerPageUrls.TryGetValue(managerName, out managerPageUrl);

                sectionsHtml.Append($@"
        <div style=""margin-bottom:24px;"">

        <!-- כותרת מנהל -->
        <table cellpadding=""0"" cellspacing=""0"" border=""0""
                style=""width:100%;margin-bottom:6px;"">
            <tr>
            <td style=""padding:6px 10px;
                        background-color:{headerColor}18;
                        border-right:3px solid {headerColor};
                        direction:rtl;
                        text-align:right;"">
                <span style=""font-size:12px;
                            color:{ColorTextSub};
                            font-family:Arial,Helvetica,sans-serif;"">
                מנהל מערכת:
                </span>
                <span style=""font-size:15px;
                            font-weight:700;
                            color:{headerColor};
                            font-family:Arial,Helvetica,sans-serif;
                            margin-right:6px;"">
                {displayName}
                </span>
                <span style=""font-size:12px;
                            color:{ColorTextSub};
                            font-family:Arial,Helvetica,sans-serif;"">
                ({systems.Count} מערכות)
                </span>
            </td>
            </tr>
        </table>

        <!-- טבלת מערכות -->
        <table cellpadding=""0"" cellspacing=""0"" border=""0""
                style=""width:100%;
                        border-collapse:collapse;
                        border:1px solid {ColorBorder};
                        border-radius:6px;
                        overflow:hidden;"">
            <thead>
            <tr style=""background-color:#F8FAFC;"">
                <th style=""padding:7px 10px;
                        font-size:12px;
                        font-weight:700;
                        color:{ColorTextSub};
                        text-align:right;
                        border-bottom:1px solid {ColorBorder};
                        direction:rtl;
                        font-family:Arial,Helvetica,sans-serif;"">
                שם מערכת
                </th>
                <th style=""padding:7px 10px;
                        font-size:12px;
                        font-weight:700;
                        color:{ColorTextSub};
                        text-align:center;
                        border-bottom:1px solid {ColorBorder};
                        width:110px;
                        font-family:Arial,Helvetica,sans-serif;"">
                קישור
                </th>
            </tr>
            </thead>
            <tbody>
        ");

                foreach (var (sysName, catalogNum, url) in systems)
                {
                    sectionsHtml.Append($@"
                        <tr>
                            <td style=""padding:8px 10px;
                                    border-bottom:1px solid {ColorBorder};
                                    direction:rtl;
                                    text-align:right;
                                    vertical-align:middle;"">
                                <span style=""font-size:14px;
                                            font-weight:600;
                                            color:{ColorTextMain};
                                            font-family:Arial,Helvetica,sans-serif;"">
                                    {sysName}
                                </span>
                                {(!string.IsNullOrEmpty(catalogNum)
                                    ? $"<br><span style=\"font-family:monospace;font-size:11px;" +
                                    $"color:{ColorAccent};background:#EEF2FF;" +
                                    $"padding:1px 6px;border-radius:3px;" +
                                    $"direction:ltr;display:inline-block;margin-top:2px;\">" +
                                    $"{catalogNum}</span>"
                                    : "")}
                            </td>
                            <td style=""padding:8px 10px;
                                    border-bottom:1px solid {ColorBorder};
                                    width:120px;
                                    text-align:center;
                                    vertical-align:middle;"">
                                <a href=""{url}""
                                style=""color:{ColorAccent};
                                        text-decoration:none;
                                        font-size:13px;
                                        font-weight:600;"">
                                    לחץ לתיקוף ↗
                                </a>
                            </td>
                        </tr>
                    ");
                }

                // ✅ בנה את הכפתור מחוץ ל-string - פותר את כל שגיאות ה-interpolation
                if (!string.IsNullOrWhiteSpace(managerPageUrl))
                {
                    // בנה את הכפתור תחילה למשתנה נפרד
                    var managerBtn = BuildButton(
                        managerPageUrl,
                        $"לתיקוף כל המערכות של {displayName}",
                        "#7C3AED",
                        width: 320);

                    sectionsHtml.Append($@"
                        <tr>
                            <td colspan=""2""
                                style=""padding:10px 16px;
                                    background-color:#F5F3FF;
                                    border-top:2px solid #DDD6FE;
                                    text-align:center;"">
                                {managerBtn}
                            </td>
                        </tr>
                    ");
                }

                sectionsHtml.Append(@"
                    </tbody>
                </table>
                </div>
                ");
            }

            var expiryDate = DateTime.Now.AddDays(7).ToString("dd/MM/yyyy");

            var body = $@"
        <p style=""margin:0 0 16px 0;font-size:16px;color:{ColorTextMain};"">
        שלום,<br>
        להלן רשימת קישורי התיקוף המרוכזת עבור
        <strong>{totalSystems}</strong> מערכות,
        מקובצת לפי מנהל מערכת:
        </p>

        {sectionsHtml}

        {BuildAlert(
            $"כל הקישורים תקפים עד תאריך <strong>{expiryDate}</strong>",
            ColorWarning, "#92400E")}

        {BuildAlert(
            "ניתן להעביר את הקישורים הרלוונטיים לכל מנהל מערכת.",
            ColorAccent, "#1E40AF")}";

            var logoBase64 = GetMenoraLogoBase64();

            var html = BuildEmailHtmlWithLogo(
                accentColor:    ColorAccent,
                headerTitle:    "קישורי תיקוף מרוכזים",
                headerSubtitle: "מקובץ לפי מנהל מערכת",
                bodyContent:    body,
                logoBase64:     logoBase64);

            return await SendEmailAsync(
                toEmail, toName, subject, html,
                AuditEventTypes.EmailValidation);
        }
    }
}