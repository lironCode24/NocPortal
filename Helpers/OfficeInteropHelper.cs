using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Text;

public class OfficeInteropHelper : IDisposable
{
    private dynamic _application;
    private dynamic _workbook;
    private dynamic _worksheet;
    private dynamic _document;
    private OfficeApplication _applicationType;
    private bool _disposed = false;

    public enum OfficeApplication
    {
        Excel,
        Word
    }

    public OfficeInteropHelper(OfficeApplication appType)
    {
        try
        {
            _applicationType = appType;
            string progId = appType == OfficeApplication.Excel ? "Excel.Application" : "Word.Application";
            Type officeType = Type.GetTypeFromProgID(progId);
            
            if (officeType == null)
                throw new Exception($"{appType} is not installed on the server");
                
            _application = Activator.CreateInstance(officeType);
            _application.Visible = false;
            _application.DisplayAlerts = false;
        }
        catch (Exception ex)
        {
            Dispose();
            throw new Exception($"Failed to initialize {appType}: {ex.Message}", ex);
        }
    }

    public dynamic OpenWorkbook(string path)
    {
        try
        {
            _workbook = _application.Workbooks.Open(path);
            return _workbook;
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to open workbook: {ex.Message}", ex);
        }
    }

    public dynamic GetWorksheet(int index = 1)
    {
        try
        {
            _worksheet = _workbook.Worksheets[index];
            return _worksheet;
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to get worksheet: {ex.Message}", ex);
        }
    }

    // מתודה לקבלת גיליון לפי שם
    public dynamic GetWorksheet(string name)
    {
        try
        {
            _worksheet = _workbook.Worksheets[name];
            return _worksheet;
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to get worksheet '{name}': {ex.Message}", ex);
        }
    }

    public void SaveAs(string path, int format)
    {
        try
        {
            _workbook.SaveAs(path, format);
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to save file: {ex.Message}", ex);
        }
    }

    public void SaveAsPdf(string path)
    {
        try
        {
            // Excel: 0 = xlTypePDF, Word: 17 = wdFormatPDF
            int pdfFormat = _workbook != null ? 0 : 17;
            
            if (_workbook != null)
                _workbook.ExportAsFixedFormat(pdfFormat, path);
            else
                _application.ActiveDocument.SaveAs2(path, pdfFormat);
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to save as PDF: {ex.Message}", ex);
        }
    }

    // מתודה לפתיחת מסמך Word
    public void OpenDocument(string filePath, bool readOnly = false)
    {
        try
        {
            if (_applicationType == OfficeApplication.Word)
            {
                _document = _application.Documents.Open(filePath, ReadOnly: readOnly);
            }
            else
            {
                throw new InvalidOperationException("OpenDocument is only available for Word application");
            }
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to open document: {ex.Message}", ex);
        }
    }

    // מתודה לחילוץ טקסט ממסמך
    public string ExtractText()
    {
        try
        {
            if (_applicationType == OfficeApplication.Word && _document != null)
            {
                return _document.Content.Text;
            }
            else if (_applicationType == OfficeApplication.Excel && _workbook != null)
            {
                StringBuilder text = new StringBuilder();
                foreach (dynamic sheet in _workbook.Sheets)
                {
                    if (sheet.UsedRange != null)
                    {
                        text.AppendLine(sheet.Name + ":");
                        text.AppendLine("-------------------");
                        
                        dynamic usedRange = sheet.UsedRange;
                        for (int row = 1; row <= usedRange.Rows.Count; row++)
                        {
                            for (int col = 1; col <= usedRange.Columns.Count; col++)
                            {
                                dynamic cell = usedRange.Cells[row, col];
                                if (cell.Value != null)
                                {
                                    text.Append(cell.Value.ToString() + "\t");
                                }
                                else
                                {
                                    text.Append("\t");
                                }
                            }
                            text.AppendLine();
                        }
                        text.AppendLine();
                    }
                }
                return text.ToString();
            }
            
            return "No text could be extracted";
        }
        catch (Exception ex)
        {
            return $"Error extracting text: {ex.Message}";
        }
    }

    // מתודה ליצירת חוברת עבודה חדשה
    public dynamic CreateNewWorkbook()
    {
        try
        {
            if (_applicationType == OfficeApplication.Excel)
            {
                _workbook = _application.Workbooks.Add();
                return _workbook;
            }
            throw new InvalidOperationException("CreateNewWorkbook is only available for Excel application");
        }
        catch (Exception ex)
        {
            throw new Exception($"Failed to create new workbook: {ex.Message}", ex);
        }
    }

    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
        if (!_disposed)
        {
            if (disposing)
            {
                // Free managed resources
            }

            // Free unmanaged resources
            try
            {
                if (_worksheet != null)
                {
                    Marshal.ReleaseComObject(_worksheet);
                    _worksheet = null;
                }
            }
            catch { }

            try
            {
                if (_document != null)
                {
                    _document.Close(false);
                    Marshal.ReleaseComObject(_document);
                    _document = null;
                }
            }
            catch { }

            try
            {
                if (_workbook != null)
                {
                    _workbook.Close(false);
                    Marshal.ReleaseComObject(_workbook);
                    _workbook = null;
                }
            }
            catch { }

            try
            {
                if (_application != null)
                {
                    _application.Quit();
                    Marshal.ReleaseComObject(_application);
                    _application = null;
                }
            }
            catch { }

            _disposed = true;
        }
    }

    ~OfficeInteropHelper()
    {
        Dispose(false);
    }
}