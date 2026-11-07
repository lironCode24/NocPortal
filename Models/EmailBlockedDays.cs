// file: Models/EmailBlockedDays.cs

public class EmailBlockedDaysConfig
{
    /// <summary>תאריכים ספציפיים לחסימה (פורמט: yyyy-MM-dd)</summary>
    public List<string> BlockedDates { get; set; } = new();

    /// <summary>ימי שבוע קבועים לחסימה (0=ראשון, 6=שבת)</summary>
    public List<int> BlockedWeekDays { get; set; } = new() { 6 }; // שבת כברירת מחדל

    /// <summary>האם לחסום בחגי ישראל אוטומטית</summary>
    public bool BlockIsraeliHolidays { get; set; } = true;

    /// <summary>הערות לכל תאריך חסום</summary>
    public Dictionary<string, string> DateNotes { get; set; } = new();
    public string PermitPersonName { get; set; } = "דן בירון";

    public string PermitEmailTime { get; set; } = "06:50";
}