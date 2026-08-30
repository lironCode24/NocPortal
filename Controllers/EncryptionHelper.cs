// file: EncryptionHelper.cs
using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

public static class EncryptionHelper
{
    // *** המפתח נשמר בקובץ נפרד מחוץ לתיקיית הפרויקט ***
    private static readonly string _keyFilePath =
        Path.Combine(AppContext.BaseDirectory, "assets", "files", "secrets", "encryption.key");

    // ==========================================
    // הצפנה
    // ==========================================
    public static string Encrypt(string plainText)
    {
        if (string.IsNullOrEmpty(plainText))
            return plainText ?? "";

        var key = GetOrCreateKey();

        using var aes = Aes.Create();
        aes.Key = key;
        aes.GenerateIV();

        using var encryptor = aes.CreateEncryptor();
        using var ms        = new MemoryStream();

        // שמור את ה-IV בתחילת הנתונים המוצפנים
        ms.Write(aes.IV, 0, aes.IV.Length);

        using (var cs = new CryptoStream(
            ms, encryptor, CryptoStreamMode.Write))
        using (var sw = new StreamWriter(cs))
        {
            sw.Write(plainText);
        }

        return Convert.ToBase64String(ms.ToArray());
    }

    // ==========================================
    // פענוח
    // ==========================================
    public static string Decrypt(string cipherText)
    {
        if (string.IsNullOrEmpty(cipherText))
            return cipherText ?? "";

        try
        {
            var key        = GetOrCreateKey();
            var fullCipher = Convert.FromBase64String(cipherText);

            using var aes = Aes.Create();
            aes.Key = key;

            // חלץ את ה-IV מתחילת הנתונים
            var iv = new byte[aes.BlockSize / 8];
            Array.Copy(fullCipher, 0, iv, 0, iv.Length);
            aes.IV = iv;

            var cipher = new byte[fullCipher.Length - iv.Length];
            Array.Copy(fullCipher, iv.Length, cipher, 0, cipher.Length);

            using var decryptor = aes.CreateDecryptor();
            using var ms        = new MemoryStream(cipher);
            using var cs        = new CryptoStream(
                ms, decryptor, CryptoStreamMode.Read);
            using var sr        = new StreamReader(cs);

            return sr.ReadToEnd();
        }
        catch
        {
            // אם הפענוח נכשל — החזר את הערך המקורי (לתאימות לאחור)
            return cipherText;
        }
    }

    // ==========================================
    // בדיקה אם ערך מוצפן
    // ==========================================
    public static bool IsEncrypted(string value)
    {
        if (string.IsNullOrEmpty(value)) return false;

        try
        {
            var bytes = Convert.FromBase64String(value);
            // מוצפן = Base64 תקין + אורך מינימלי (IV = 16 bytes)
            return bytes.Length > 16;
        }
        catch
        {
            return false;
        }
    }

    // ==========================================
    // קבל או צור מפתח הצפנה
    // ==========================================
    private static byte[] GetOrCreateKey()
    {
        var dir = Path.GetDirectoryName(_keyFilePath)!;
        if (!Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        if (File.Exists(_keyFilePath))
        {
            var keyBase64 = File.ReadAllText(_keyFilePath).Trim();
            return Convert.FromBase64String(keyBase64);
        }

        // צור מפתח חדש (256-bit AES)
        using var aes = Aes.Create();
        aes.KeySize = 256;
        aes.GenerateKey();

        File.WriteAllText(
            _keyFilePath,
            Convert.ToBase64String(aes.Key));

        return aes.Key;
    }
}