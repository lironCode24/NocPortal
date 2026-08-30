// file: SecretsService.cs
using Microsoft.Extensions.Configuration;

public class SecretsService
{
    private readonly IConfiguration _config;

    public SecretsService(IConfiguration config)
    {
        _config = config;
    }

    // ==========================================
    // קבל ערך — פענח אוטומטית אם מוצפן
    // ==========================================
    public string Get(string key)
    {
        var value = _config[key] ?? "";

        // אם הערך מתחיל ב-"ENC:" — פענח אותו
        if (value.StartsWith("ENC:", StringComparison.OrdinalIgnoreCase))
        {
            var encrypted = value.Substring(4); // הסר את "ENC:"
            return EncryptionHelper.Decrypt(encrypted);
        }

        return value;
    }

    // ==========================================
    // Properties נוחים לגישה
    // ==========================================
    public string HelixAccessKey    => Get("Helix:AccessKey");
    public string HelixAccessSecret => Get("Helix:AccessSecret");
    public string HelixTenantId     => Get("Helix:TenantId");
    public string HelixBaseUrl      => Get("Helix:BaseUrl");
    public string HelixProxyUrl     => Get("Helix:ProxyUrl");

    public string ElasticBaseUrl    => Get("Elastic:BaseUrl");
    public string ElasticUsername   => Get("Elastic:Username");
    public string ElasticPassword   => Get("Elastic:Password");

    public string BigFixUrl         => Get("BigFix:Url");
    public string BigFixUsername    => Get("BigFix:Username");
    public string BigFixPassword    => Get("BigFix:Password");
    
     // *** חדש: קריאת רשימת משתמשים מורשים מ-appsettings ***
    public IReadOnlyList<string> PrivilegedUsers =>
        _config
            .GetSection("Authorization:AutomationPrivilegedUsers")
            .Get<List<string>>()
            ?? new List<string>();

    public IReadOnlyList<string> AutomationOnlyEditors =>
        _config
            .GetSection("Authorization:AutomationPrivilegedUsers")
            .Get<List<string>>()
            ?? new List<string>();
}