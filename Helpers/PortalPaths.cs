using Microsoft.AspNetCore.Hosting;

public static class PortalPaths
{
    private static string _webRoot = "";

    public static void Initialize(IWebHostEnvironment env)
    {
        _webRoot = env.WebRootPath ?? "";
    }

    public static string FilesRoot =>
        Path.Combine(
            string.IsNullOrEmpty(_webRoot) ? AppContext.BaseDirectory : _webRoot,
            "assets",
            "files");

    public static string UnderFiles(string relative)
    {
        var parts = (relative ?? "")
            .Trim()
            .TrimStart('\\', '/')
            .Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
        var all = new string[parts.Length + 1];
        all[0] = FilesRoot;
        Array.Copy(parts, 0, all, 1, parts.Length);
        return Path.Combine(all);
    }
}
