
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Text;
using System.Runtime.InteropServices;

namespace MyWebApp.Controllers
{
    public class ProceduresController : Controller
    {
        private readonly string _proceduresPath;
        private readonly string _pdfCachePath; 
        private readonly string _metadataPath; 

        public ProceduresController()
        {
            _proceduresPath = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\נהלים";
            _pdfCachePath = Path.Combine(Path.GetTempPath(), "ProceduresPdfCache");
            _metadataPath = Path.Combine(@"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\files\Procedures", "Metadata");

            // Create cache directory if it doesn't exist
            if (!Directory.Exists(_pdfCachePath))
            {
                Directory.CreateDirectory(_pdfCachePath);
            }
            
            // Create procedures directory if it doesn't exist
            if (!Directory.Exists(_proceduresPath))
            {
                Directory.CreateDirectory(_proceduresPath);
            }

            // Create metadata directory if it doesn't exist
            if (!Directory.Exists(_metadataPath))
            {
                Directory.CreateDirectory(_metadataPath);
            }
        }

        [HttpGet]
        public IActionResult GetProcedures()
        {
            try
            {
                if (!Directory.Exists(_proceduresPath))
                {
                    return Json(new { error = "Procedures directory not found" });
                }

                // Get all files including files in subdirectories
                var files = Directory.GetFiles(_proceduresPath, "*.*", SearchOption.AllDirectories)
                    .Select(filePath => new
                    {
                        fileName = Path.GetFileName(filePath),
                        name = Path.GetFileNameWithoutExtension(filePath),
                        fullPath = filePath, // Full path of the file
                        relativePath = Path.GetRelativePath(_proceduresPath, filePath), // Relative path for display
                        folder = GetFolderName(filePath, _proceduresPath), // Folder name if in subdirectory
                        size = FormatFileSize(new FileInfo(filePath).Length),
                        lastModified = new FileInfo(filePath).LastWriteTime.ToString("dd/MM/yyyy HH:mm"),
                        modifiedBy = GetFileModifiedBy(filePath),
                        icon = GetFileIcon(Path.GetExtension(filePath))
                    })
                    .OrderByDescending(f => f.lastModified)
                    .ToArray();
                
                return Json(files);
            }
            catch (Exception ex)
            {
                return Json(new { error = ex.Message });
            }
        }


        [HttpGet]
        public IActionResult ViewFile(string fileName, string folderPath = "")
        {
            try
            {
                string filePath;
                
                if (!string.IsNullOrEmpty(folderPath))
                {
                    // If folder path is provided, look in that specific folder
                    filePath = Path.Combine(_proceduresPath, folderPath, fileName);
                    if (!System.IO.File.Exists(filePath))
                    {
                        return NotFound();
                    }
                }
                else
                {
                    // Otherwise search in all directories
                    var files = Directory.GetFiles(_proceduresPath, fileName, SearchOption.AllDirectories);
                    
                    if (files.Length == 0)
                    {
                        return NotFound();
                    }
                    
                    filePath = files[0];
                }
                
                var extension = Path.GetExtension(fileName).ToLowerInvariant();
                
                // Convert Word documents to PDF for viewing
                if (extension == ".docx" || extension == ".doc")
                {
                    try
                    {
                        // Convert to PDF
                        var pdfPath = ConvertWordToPdf(filePath);
                        
                        // Serve the PDF
                        var pdfBytes = System.IO.File.ReadAllBytes(pdfPath);
                        
                        Response.Headers.Clear();
                        Response.Headers.Add("Content-Type", "application/pdf");
                        Response.Headers.Add("Content-Disposition", "inline; filename*=UTF-8''" + System.Net.WebUtility.UrlEncode(Path.GetFileNameWithoutExtension(fileName) + ".pdf"));
                        Response.Headers.Add("Content-Length", pdfBytes.Length.ToString());
                        Response.Headers.Add("Accept-Ranges", "bytes");
                        Response.Headers.Add("Cache-Control", "public, max-age=3600");
                        
                        return File(pdfBytes, "application/pdf");
                    }
                    catch (Exception ex)
                    {
                        // Fallback to text extraction if PDF conversion fails
                        Console.WriteLine($"PDF conversion failed, falling back to text: {ex.Message}");
                        string extractedText = ExtractTextFromWord(filePath);
                        var textBytes = Encoding.UTF8.GetBytes(extractedText);
                        return File(textBytes, "text/plain; charset=utf-8");
                    }
                }
                
                // Convert Excel documents to PDF for viewing
                if (extension == ".xlsx" || extension == ".xls")
                {
                    try
                    {
                        var pdfPath = ConvertExcelToPdf(filePath);
                        var pdfBytes = System.IO.File.ReadAllBytes(pdfPath);
                        
                        Response.Headers.Clear();
                        Response.Headers.Add("Content-Type", "application/pdf");
                        Response.Headers.Add("Content-Disposition", "inline; filename*=UTF-8''" + System.Net.WebUtility.UrlEncode(Path.GetFileNameWithoutExtension(fileName) + ".pdf"));
                        Response.Headers.Add("Content-Length", pdfBytes.Length.ToString());
                        
                        return File(pdfBytes, "application/pdf");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Excel PDF conversion failed, falling back to text: {ex.Message}");
                        string extractedText = ExtractTextFromExcel(filePath);
                        var textBytes = Encoding.UTF8.GetBytes(extractedText);
                        return File(textBytes, "text/plain; charset=utf-8");
                    }
                }
                // For PDF files
                if (extension == ".pdf")
                {
                    try
                    {
                        var fileBytes = System.IO.File.ReadAllBytes(filePath);
                        
                        // Important: Set correct headers for PDF display
                        Response.Headers.Clear();
                        Response.Headers.Add("Content-Type", "application/pdf");
                        Response.Headers.Add("Content-Disposition", "inline; filename*=UTF-8''" + System.Net.WebUtility.UrlEncode(fileName));
                        Response.Headers.Add("Content-Length", fileBytes.Length.ToString());
                        Response.Headers.Add("Accept-Ranges", "bytes");
                        Response.Headers.Add("Cache-Control", "public, max-age=3600");
                        
                        return File(fileBytes, "application/pdf");
                    }
                    catch (UnauthorizedAccessException ex)
                    {
                        Console.WriteLine($"Access denied to PDF: {filePath}, Error: {ex.Message}");
                        return StatusCode(403, new { error = "אין הרשאה לקרוא את הקובץ" });
                    }
                    catch (IOException ex)
                    {
                        Console.WriteLine($"IO Error reading PDF: {filePath}, Error: {ex.Message}");
                        return StatusCode(500, new { error = $"שגיאה בקריאת הקובץ: {ex.Message}" });
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Unexpected error serving PDF: {filePath}, Error: {ex.Message}");
                        return StatusCode(500, new { error = $"שגיאה: {ex.Message}" });
                    }
                }
                
                // For text files
                if (extension == ".txt")
                {
                    var fileBytes = System.IO.File.ReadAllBytes(filePath);
                    return File(fileBytes, "text/plain; charset=utf-8");
                }
                
                // For images
                if (new[] { ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg" }.Contains(extension))
                {
                    var fileBytes = System.IO.File.ReadAllBytes(filePath);
                    var contentType = GetContentType(fileName);
                    return File(fileBytes, contentType);
                }
                
                // For HTML files
                if (extension == ".html" || extension == ".htm")
                {
                    var fileBytes = System.IO.File.ReadAllBytes(filePath);
                    return File(fileBytes, "text/html; charset=utf-8");
                }

                // For other files
                var bytes = System.IO.File.ReadAllBytes(filePath);
                return File(bytes, GetContentType(fileName));
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpGet]
        public IActionResult DownloadFile(string fileName, string folderPath = "")
        {
            try
            {
                string filePath;
                
                if (!string.IsNullOrEmpty(folderPath))
                {
                    // If folder path is provided, look in that specific folder
                    filePath = Path.Combine(_proceduresPath, folderPath, fileName);
                    if (!System.IO.File.Exists(filePath))
                    {
                        return NotFound(new { error = $"File not found: {fileName} in folder {folderPath}" });
                    }
                }
                else
                {
                    // Search for the file in all subdirectories
                    var files = Directory.GetFiles(_proceduresPath, fileName, SearchOption.AllDirectories);
                    
                    if (files.Length == 0)
                    {
                        return NotFound(new { error = $"File not found: {fileName}" });
                    }
                    
                    // Take the first match
                    filePath = files[0];
                }
                
                var fileBytes = System.IO.File.ReadAllBytes(filePath);
                var contentType = GetContentType(fileName);
                
                // Encode filename for header - fix Hebrew characters issue
                var encodedFileName = System.Net.WebUtility.UrlEncode(fileName);
                
                // Use RFC 5987 encoding for filename with Hebrew characters
                Response.Headers.Add("Content-Disposition", $"attachment; filename*=UTF-8''{encodedFileName}");
                
                return File(fileBytes, contentType);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPost]
        public IActionResult EditFile(string fileName, string folderPath = "")
        {
            try
            {
                string filePath;
                
                if (!string.IsNullOrEmpty(folderPath))
                {
                    // If folder path is provided, look in that specific folder
                    filePath = Path.Combine(_proceduresPath, folderPath, fileName);
                    if (!System.IO.File.Exists(filePath))
                    {
                        return Json(new { success = false, error = $"File not found: {fileName} in folder {folderPath}" });
                    }
                }
                else
                {
                    // Otherwise search in all subdirectories
                    var files = Directory.GetFiles(_proceduresPath, fileName, SearchOption.AllDirectories);
                    
                    if (files.Length == 0)
                    {
                        return Json(new { success = false, error = $"File not found: {fileName}" });
                    }
                    
                    // Take the first match
                    filePath = files[0];
                    
                    // Extract the folder path for the response
                    folderPath = GetFolderName(filePath, _proceduresPath);
                }
                
                return Json(new { 
                    success = true, 
                    fullPath = filePath, 
                    folderPath = Path.GetDirectoryName(filePath),
                    relativeFolderPath = folderPath,
                    fileName = Path.GetFileName(filePath)
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, error = ex.Message });
            }
        }

        [HttpPost]
        public async Task<IActionResult> UploadProcedure()
        {
            try
            {
                var file = Request.Form.Files.FirstOrDefault();
                var folderPath = Request.Form["folderPath"].ToString(); // Get selected folder
                var userName = Request.Form["userName"].ToString(); // Get selected user name
                
                if (file == null || file.Length == 0)
                {
                    return Json(new { success = false, error = "לא נבחר קובץ" });
                }

                // Validate file extension
                var allowedExtensions = new[] { ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".rtf", ".odt", ".ods" };
                var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
                
                if (!allowedExtensions.Contains(extension))
                {
                    return Json(new { success = false, error = "סוג קובץ לא נתמך. קבצים מותרים: PDF, DOC, DOCX, XLS, XLSX, TXT, RTF, ODT, ODS" });
                }

                // Validate file size (max 10MB)
                if (file.Length > 10 * 1024 * 1024)
                {
                    return Json(new { success = false, error = "גודל הקובץ חורג מ-10MB" });
                }

                // Sanitize filename
                var fileName = Path.GetFileName(file.FileName);
                fileName = string.Join("_", fileName.Split(Path.GetInvalidFileNameChars()));
                
                // Determine target directory
                string targetDirectory;
                if (string.IsNullOrEmpty(folderPath))
                {
                    targetDirectory = _proceduresPath; // Root folder
                }
                else
                {
                    targetDirectory = Path.Combine(_proceduresPath, folderPath);
                    
                    // Create folder if it doesn't exist
                    if (!Directory.Exists(targetDirectory))
                    {
                        Directory.CreateDirectory(targetDirectory);
                    }
                }
                
                // Check if file already exists in target folder
                var filePath = Path.Combine(targetDirectory, fileName);
                if (System.IO.File.Exists(filePath))
                {
                    return Json(new { success = false, error = "קובץ בשם זה כבר קיים בתיקייה זו" });
                }

                // Get user name from form or use system user as fallback
                var uploadedBy = !string.IsNullOrEmpty(userName) ? userName : User.Identity?.Name ?? "Unknown";
                if (uploadedBy.Contains("\\") && string.IsNullOrEmpty(userName))
                {
                    uploadedBy = uploadedBy.Split('\\')[1];
                }

                // Save file
                using (var stream = new FileStream(filePath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                // Create metadata file to store uploader information
                var metadataFileName = $"{Path.GetFileNameWithoutExtension(fileName)}_metadata.txt";
                var metadataFilePath = Path.Combine(_metadataPath, metadataFileName);

                // Write metadata
                using (var writer = new StreamWriter(metadataFilePath, false, Encoding.UTF8))
                {
                    await writer.WriteLineAsync($"FileName: {fileName}");
                    await writer.WriteLineAsync($"UploadedBy: {uploadedBy}");
                    await writer.WriteLineAsync($"UploadPath: {filePath}");
                    await writer.WriteLineAsync($"UploadDate: {DateTime.Now}");
                }

                return Json(new 
                { 
                    success = true, 
                    message = "הקובץ הועלה בהצלחה",
                    fileName = fileName,
                    folder = folderPath,
                    uploadedBy = uploadedBy
                });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, error = $"שגיאה בהעלאת הקובץ: {ex.Message}" });
            }
        }
        
        [HttpDelete]
        public IActionResult DeleteProcedure(string fileName, string folderPath = "")
        {
            try
            {
                string filePath;
                
                if (!string.IsNullOrEmpty(folderPath))
                {
                    // If folder path is provided, look in that specific folder
                    filePath = Path.Combine(_proceduresPath, folderPath, fileName);
                    if (!System.IO.File.Exists(filePath))
                    {
                        return Json(new { success = false, error = $"File not found: {fileName} in folder {folderPath}" });
                    }
                }
                else
                {
                    // Search for the file in all subdirectories
                    var files = Directory.GetFiles(_proceduresPath, fileName, SearchOption.AllDirectories);
                    
                    if (files.Length == 0)
                    {
                        return Json(new { success = false, error = "הקובץ לא נמצא" });
                    }
                    
                    // Take the first match
                    filePath = files[0];
                }
                
                // Get file info before deletion for logging
                var fileInfo = new FileInfo(filePath);
                var folderName = GetFolderName(filePath, _proceduresPath);
                
                // Delete the file
                System.IO.File.Delete(filePath);
                
                // Also delete metadata file if exists
                try
                {
                    var metadataFileName = $"{Path.GetFileNameWithoutExtension(fileName)}_metadata.txt";
                    var metadataFilePath = Path.Combine(_metadataPath, metadataFileName);
                    
                    if (System.IO.File.Exists(metadataFilePath))
                    {
                        System.IO.File.Delete(metadataFilePath);
                        Console.WriteLine($"Deleted metadata file: {metadataFilePath}");
                    }
                }
                catch (Exception ex)
                {
                    // Log but don't fail the deletion
                    Console.WriteLine($"Error deleting metadata file: {ex.Message}");
                }
                
                // Also delete cached PDF if exists (for Word/Excel files)
                try
                {
                    var extension = Path.GetExtension(fileName).ToLowerInvariant();
                    if (extension == ".doc" || extension == ".docx" || extension == ".xls" || extension == ".xlsx")
                    {
                        var cacheFileName = $"{Path.GetFileNameWithoutExtension(fileName)}_{fileInfo.LastWriteTime.Ticks}.pdf";
                        var cachedPdfPath = Path.Combine(_pdfCachePath, cacheFileName);
                        
                        if (System.IO.File.Exists(cachedPdfPath))
                        {
                            System.IO.File.Delete(cachedPdfPath);
                        }
                    }
                }
                catch (Exception ex)
                {
                    // Log but don't fail the deletion
                    Console.WriteLine($"Error deleting cached PDF: {ex.Message}");
                }
                
                return Json(new { 
                    success = true, 
                    message = "הקובץ נמחק בהצלחה",
                    folder = folderName
                });
            }
            catch (UnauthorizedAccessException)
            {
                return Json(new { success = false, error = "אין הרשאה למחוק את הקובץ" });
            }
            catch (IOException ex)
            {
                return Json(new { success = false, error = $"הקובץ בשימוש או נעול: {ex.Message}" });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, error = $"שגיאה במחיקת הקובץ: {ex.Message}" });
            }
        }

        [HttpGet]
        public IActionResult GetImage(string fileName)
        {
            try
            {
                // Path to images folder
                var imagesPath = @"C:\Users\liron\Desktop\automation\Noc Portal\NocPortal\NocPortal\portal\files\ProcedureImages";
                var imagePath = Path.Combine(imagesPath, fileName);
                
                if (!System.IO.File.Exists(imagePath))
                {
                    return NotFound(new { error = $"Image not found: {fileName}" });
                }
                
                var imageBytes = System.IO.File.ReadAllBytes(imagePath);
                var contentType = GetImageContentType(fileName);
                
                return File(imageBytes, contentType);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }
        
        [HttpDelete]
        public IActionResult DeleteCachedPdf(string fileName)
        {
            try
            {
                // Get file info to generate cache file name
                var files = Directory.GetFiles(_proceduresPath, fileName, SearchOption.AllDirectories);
                
                if (files.Length == 0)
                {
                    return Json(new { success = false, error = "Original file not found" });
                }
                
                var originalFilePath = files[0];
                var fileInfo = new FileInfo(originalFilePath);
                
                // Generate cache file name (same logic as in conversion methods)
                var cacheFileName = $"{Path.GetFileNameWithoutExtension(fileName)}_{fileInfo.LastWriteTime.Ticks}.pdf";
                var cachedPdfPath = Path.Combine(_pdfCachePath, cacheFileName);
                
                // Delete cached PDF if exists
                if (System.IO.File.Exists(cachedPdfPath))
                {
                    System.IO.File.Delete(cachedPdfPath);
                    return Json(new { success = true, message = "Cached PDF deleted successfully" });
                }
                
                return Json(new { success = true, message = "No cached PDF found" });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error deleting cached PDF: {ex.Message}");
                return Json(new { success = false, error = ex.Message });
            }
        }

        [HttpGet]
        public IActionResult GetFolders()
        {
            try
            {
                if (!Directory.Exists(_proceduresPath))
                {
                    return Json(new { error = "Procedures directory not found" });
                }

                // Get all subdirectories
                var folders = Directory.GetDirectories(_proceduresPath, "*", SearchOption.AllDirectories)
                    .Select(dir => new
                    {
                        name = Path.GetFileName(dir),
                        path = Path.GetRelativePath(_proceduresPath, dir),
                        fullPath = dir
                    })
                    .OrderBy(f => f.path)
                    .ToList();

                // Add root folder option
                folders.Insert(0, new
                {
                    name = "תיקייה ראשית",
                    path = "",
                    fullPath = _proceduresPath
                });

                return Json(folders);
            }
            catch (Exception ex)
            {
                return Json(new { error = ex.Message });
            }
        }

        private string GetImageContentType(string fileName)
        {
            var extension = Path.GetExtension(fileName).ToLowerInvariant();
            
            switch (extension)
            {
                case ".jpg":
                case ".jpeg":
                    return "image/jpeg";
                case ".png":
                    return "image/png";
                case ".gif":
                    return "image/gif";
                case ".bmp":
                    return "image/bmp";
                case ".webp":
                    return "image/webp";
                case ".svg":
                    return "image/svg+xml";
                default:
                    return "application/octet-stream";
            }
        }
        
        private string GetContentType(string fileName)
        {
            var extension = Path.GetExtension(fileName).ToLowerInvariant();
            
            switch (extension)
            {
                case ".pdf":
                    return "application/pdf";
                case ".doc":
                    return "application/msword";
                case ".docx":
                    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                case ".xls":
                    return "application/vnd.ms-excel";
                case ".xlsx":
                    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                case ".txt":
                    return "text/plain";
                case ".rtf":
                    return "application/rtf";
                case ".odt":
                    return "application/vnd.oasis.opendocument.text";
                case ".ods":
                    return "application/vnd.oasis.opendocument.spreadsheet";
                case ".html":
                case ".htm":
                    return "text/html";
                default:
                    return "application/octet-stream";
            }
        }

        private string GetFileIcon(string extension)
        {
            switch (extension.ToLowerInvariant())
            {
                case ".pdf":
                    return "fas fa-file-pdf";
                case ".doc":
                case ".docx":
                    return "fas fa-file-word";
                case ".xls":
                case ".xlsx":
                    return "fas fa-file-excel";
                case ".ppt":
                case ".pptx":
                    return "fas fa-file-powerpoint";
                case ".txt":
                    return "fas fa-file-alt";
                case ".html":
                case ".htm":
                    return "fas fa-file-code";
                case ".zip":
                case ".rar":
                case ".7z":
                    return "fas fa-file-archive";
                case ".jpg":
                case ".jpeg":
                case ".png":
                case ".gif":
                case ".bmp":
                    return "fas fa-file-image";
                case ".mp4":
                case ".avi":
                case ".mov":
                case ".wmv":
                    return "fas fa-file-video";
                case ".mp3":
                case ".wav":
                case ".wma":
                    return "fas fa-file-audio";
                default:
                    return "fas fa-file";
            }
        }

        private string FormatFileSize(long bytes)
        {
            string[] sizes = { "B", "KB", "MB", "GB", "TB" };
            double len = bytes;
            int order = 0;
            while (len >= 1024 && order < sizes.Length - 1)
            {
                order++;
                len = len / 1024;
            }
            return $"{len:0.##} {sizes[order]}";
        }

        // Extract text from Word document using COM Interop
        private string ExtractTextFromWord(string filePath)
        {
            // Verify file exists
            if (!System.IO.File.Exists(filePath))
            {
                return $"הקובץ לא נמצא: {filePath}";
            }

            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Word))
            {
                try
                {
                    helper.OpenDocument(filePath, true); // readOnly = true
                    return helper.ExtractText();
                }
                catch (Exception ex)
                {
                    return $"שגיאה בחילוץ טקסט מ-Word: {ex.Message}";
                }
            }
        }

        // בפונקציה ExtractTextFromExcel
        private string ExtractTextFromExcel(string filePath)
        {
            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
            {
                try
                {
                    helper.OpenWorkbook(filePath);
                    return helper.ExtractText();
                }
                catch (Exception ex)
                {
                    return $"שגיאה בחילוץ טקסט מ-Excel: {ex.Message}";
                }
            }
        }


        // Check if the application has access to the network path
        private bool CheckNetworkAccess()
        {
            try
            {
                return Directory.Exists(_proceduresPath);
            }
            catch (UnauthorizedAccessException)
            {
                return false;
            }
        }

        // Get detailed error information for troubleshooting
        private string GetAccessErrorDetails()
        {
            try
            {
                var currentUser = System.Security.Principal.WindowsIdentity.GetCurrent();
                return $"Current user: {currentUser.Name}, Path: {_proceduresPath}";
            }
            catch
            {
                return "Unable to get user information";
            }
        }

        // Convert Word to PDF using Word COM Interop
        private string ConvertWordToPdf(string wordFilePath)
        {
            // Generate cache file name based on original file hash
            var fileInfo = new FileInfo(wordFilePath);
            var cacheFileName = $"{Path.GetFileNameWithoutExtension(wordFilePath)}_{fileInfo.LastWriteTime.Ticks}.pdf";
            var pdfPath = Path.Combine(_pdfCachePath, cacheFileName);
            
            // Return cached PDF if exists and is newer than source
            if (System.IO.File.Exists(pdfPath))
            {
                var pdfInfo = new FileInfo(pdfPath);
                if (pdfInfo.LastWriteTime >= fileInfo.LastWriteTime)
                {
                    return pdfPath;
                }
            }
            
            // Convert Word to PDF using helper class
            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Word))
            {
                try
                {
                    helper.OpenDocument(wordFilePath, true); // readOnly = true
                    helper.SaveAsPdf(pdfPath);
                    return pdfPath;
                }
                catch (Exception ex)
                {
                    throw new Exception($"Error converting Word to PDF: {ex.Message}", ex);
                }
            }
        }

        // Convert Excel to PDF
        private string ConvertExcelToPdf(string excelFilePath)
        {
            var fileInfo = new FileInfo(excelFilePath);
            var cacheFileName = $"{Path.GetFileNameWithoutExtension(excelFilePath)}_{fileInfo.LastWriteTime.Ticks}.pdf";
            var pdfPath = Path.Combine(_pdfCachePath, cacheFileName);
            
            // Return cached PDF if exists
            if (System.IO.File.Exists(pdfPath))
            {
                var pdfInfo = new FileInfo(pdfPath);
                if (pdfInfo.LastWriteTime >= fileInfo.LastWriteTime)
                {
                    return pdfPath;
                }
            }
            
            // Convert Excel to PDF using helper class
            using (var helper = new OfficeInteropHelper(OfficeInteropHelper.OfficeApplication.Excel))
            {
                try
                {
                    helper.OpenWorkbook(excelFilePath);
                    helper.SaveAsPdf(pdfPath);
                    return pdfPath;
                }
                catch (Exception ex)
                {
                    throw new Exception($"Error converting Excel to PDF: {ex.Message}", ex);
                }
            }
        }

        // Helper method to get folder name for files in subdirectories
        private string GetFolderName(string filePath, string basePath)
        {
            var directory = Path.GetDirectoryName(filePath);
            if (directory == basePath)
            {
                return string.Empty; // File is in root directory
            }
            
            var relativePath = Path.GetRelativePath(basePath, directory);
            return relativePath;
        }

        // New method to get the user who modified the file
        private string GetFileModifiedBy(string filePath)
        {
            try
            {
                // First check if we have metadata file
                var fileName = Path.GetFileName(filePath);
                var metadataFileName = $"{Path.GetFileNameWithoutExtension(fileName)}_metadata.txt";
                var metadataFilePath = Path.Combine(_metadataPath, metadataFileName);
                
                if (System.IO.File.Exists(metadataFilePath))
                {
                    // Read metadata file
                    var lines = System.IO.File.ReadAllLines(metadataFilePath);
                    foreach (var line in lines)
                    {
                        if (line.StartsWith("UploadedBy:"))
                        {
                            var uploadedBy = line.Substring("UploadedBy:".Length).Trim();
                            if (!string.IsNullOrEmpty(uploadedBy))
                            {
                                return uploadedBy;
                            }
                        }
                    }
                }
                
                // Fallback to file security info
                var fileInfo = new FileInfo(filePath);
                var fileSecurity = fileInfo.GetAccessControl();
                var owner = fileSecurity.GetOwner(typeof(System.Security.Principal.NTAccount));
                
                if (owner != null)
                {
                    // Extract username from domain\username format
                    string ownerName = owner.Value;
                    if (ownerName.Contains("\\"))
                    {
                        ownerName = ownerName.Split('\\')[1];
                    }
                    return ownerName;
                }
                
                return "לא ידוע";
            }
            catch (Exception)
            {
                return "לא ידוע";
            }
        }
    }
}
