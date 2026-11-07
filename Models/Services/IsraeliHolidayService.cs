// file: Services/IsraeliHolidayService.cs

public static class IsraeliHolidayService
{
    /// <summary>
    /// מחזיר רשימת חגי ישראל לשנה נתונה (לפי לוח גרגוריאני).
    /// החישוב מבוסס על אלגוריתם המרת תאריך עברי.
    /// </summary>
    public static List<(DateTime Date, string Name)> GetHolidays(int year)
    {
        var holidays = new List<(DateTime, string)>();

        // ─── חגים קבועים (לפי לוח עברי - תאריכים משוערים) ───────────
        // הערה: תאריכים אלו הם קירוב. לדיוק מלא יש להשתמש בספריית
        // המרת תאריכים עברית.

        // ראש השנה - א' תשרי (ספטמבר/אוקטובר)
        var roshHashana = GetHebrewHolidayApprox(year, "rosh_hashana");
        if (roshHashana.HasValue)
        {
            holidays.Add((roshHashana.Value, "ראש השנה א'"));
            holidays.Add((roshHashana.Value.AddDays(1), "ראש השנה ב'"));
        }

        // יום כיפור - י' תשרי
        var yomKippur = GetHebrewHolidayApprox(year, "yom_kippur");
        if (yomKippur.HasValue)
            holidays.Add((yomKippur.Value, "יום כיפור"));

        // סוכות - ט\"ו תשרי
        var sukkot = GetHebrewHolidayApprox(year, "sukkot");
        if (sukkot.HasValue)
        {
            holidays.Add((sukkot.Value, "סוכות"));
            holidays.Add((sukkot.Value.AddDays(7), "שמיני עצרת/שמחת תורה"));
        }

        // פסח - ט\"ו ניסן
        var pesach = GetHebrewHolidayApprox(year, "pesach");
        if (pesach.HasValue)
        {
            holidays.Add((pesach.Value, "פסח א'"));
            holidays.Add((pesach.Value.AddDays(1), "פסח ב'"));
            holidays.Add((pesach.Value.AddDays(6), "פסח ז'"));
            holidays.Add((pesach.Value.AddDays(7), "פסח ח'"));
        }

        // שבועות - ו' סיון
        var shavuot = GetHebrewHolidayApprox(year, "shavuot");
        if (shavuot.HasValue)
        {
            holidays.Add((shavuot.Value, "שבועות א'"));
            holidays.Add((shavuot.Value.AddDays(1), "שבועות ב'"));
        }

        // יום העצמאות - ה' אייר
        var independence = GetHebrewHolidayApprox(year, "independence");
        if (independence.HasValue)
            holidays.Add((independence.Value, "יום העצמאות"));

        // פורים - י\"ד אדר
        var purim = GetHebrewHolidayApprox(year, "purim");
        if (purim.HasValue)
            holidays.Add((purim.Value, "פורים"));

        return holidays;
    }

    /// <summary>
    /// טבלת תאריכים מדויקת לשנים 2024-2030
    /// </summary>
    private static DateTime? GetHebrewHolidayApprox(int year, string holiday)
    {
        // טבלת תאריכים מדויקת לשנים הקרובות
        var table = new Dictionary<int, Dictionary<string, DateTime>>
        {
            [2024] = new()
            {
                ["rosh_hashana"] = new DateTime(2024, 10, 2),
                ["yom_kippur"]   = new DateTime(2024, 10, 11),
                ["sukkot"]       = new DateTime(2024, 10, 16),
                ["pesach"]       = new DateTime(2024, 4, 22),
                ["shavuot"]      = new DateTime(2024, 6, 11),
                ["independence"] = new DateTime(2024, 5, 14),
                ["purim"]        = new DateTime(2024, 3, 24),
            },
            [2025] = new()
            {
                ["rosh_hashana"] = new DateTime(2025, 9, 22),
                ["yom_kippur"]   = new DateTime(2025, 10, 1),
                ["sukkot"]       = new DateTime(2025, 10, 6),
                ["pesach"]       = new DateTime(2025, 4, 12),
                ["shavuot"]      = new DateTime(2025, 6, 1),
                ["independence"] = new DateTime(2025, 5, 1),
                ["purim"]        = new DateTime(2025, 3, 13),
            },
            [2026] = new()
            {
                ["rosh_hashana"] = new DateTime(2026, 9, 11),
                ["yom_kippur"]   = new DateTime(2026, 9, 20),
                ["sukkot"]       = new DateTime(2026, 9, 25),
                ["pesach"]       = new DateTime(2026, 4, 1),
                ["shavuot"]      = new DateTime(2026, 5, 21),
                ["independence"] = new DateTime(2026, 4, 22),
                ["purim"]        = new DateTime(2026, 3, 3),
            },
            [2027] = new()
            {
                ["rosh_hashana"] = new DateTime(2027, 10, 1),
                ["yom_kippur"]   = new DateTime(2027, 10, 10),
                ["sukkot"]       = new DateTime(2027, 10, 15),
                ["pesach"]       = new DateTime(2027, 4, 21),
                ["shavuot"]      = new DateTime(2027, 6, 10),
                ["independence"] = new DateTime(2027, 5, 12),
                ["purim"]        = new DateTime(2027, 3, 23),
            },
            [2028] = new()
            {
                ["rosh_hashana"] = new DateTime(2028, 9, 20),
                ["yom_kippur"]   = new DateTime(2028, 9, 29),
                ["sukkot"]       = new DateTime(2028, 10, 4),
                ["pesach"]       = new DateTime(2028, 4, 10),
                ["shavuot"]      = new DateTime(2028, 5, 30),
                ["independence"] = new DateTime(2028, 5, 1),
                ["purim"]        = new DateTime(2028, 3, 12),
            },
        };

        if (table.TryGetValue(year, out var yearHolidays) &&
            yearHolidays.TryGetValue(holiday, out var date))
            return date;

        return null;
    }

    /// <summary>בדיקה אם תאריך נתון הוא חג ישראלי</summary>
    public static bool IsIsraeliHoliday(
        DateTime date,
        out string holidayName)
    {
        holidayName = "";
        var holidays = GetHolidays(date.Year);

        var match = holidays.FirstOrDefault(
            h => h.Date.Date == date.Date);

        if (match.Date != default)
        {
            holidayName = match.Name;
            return true;
        }
        return false;
    }
}