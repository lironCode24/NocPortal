class ChangesManager {
    constructor() {
        this.changesData = [];
        this.autoRefreshInterval = null;
        this.AUTO_REFRESH_MINUTES = 60; // רענון כל 60 דקות
        this.currentView = 'calendar'; // 'table' או 'calendar'

        // טעינת שינויים בעת אתחול
        this.loadChanges();
        this.startAutoRefresh();
        this.setupViewToggle(); // עדיין נשאיר את זה כדי להוסיף מאזיני אירועים
    }

    // הגדרת מאזיני אירועים לכפתורי החלפת תצוגה
    setupViewToggle() {
        // מאזיני אירועים לכפתורים
        const buttons = document.querySelectorAll('.view-toggle-btn');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const view = button.getAttribute('data-view');
                this.switchView(view);

                // עדכון מצב הכפתורים
                buttons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
            });
        });
    }

    // החלפת תצוגה בין טבלה ללוח שנה
    switchView(view) {
        this.currentView = view;
        if (view === 'table') {
            this.displayChangesTable();
        } else {
            this.displayCalendarView();
        }
    }

    // טעינת נתוני שינויים מהשרת
    async loadChanges() {
        try {
            const loadingIndicator = document.getElementById('changesLoadingIndicator');
            if (loadingIndicator) loadingIndicator.style.display = 'flex';

            const response = await fetch('/Changes/GetChanges');
            const data = await response.json();

            if (loadingIndicator) loadingIndicator.style.display = 'none';

            if (!data.success) {
                console.error('Error loading changes:', data.message);
                document.getElementById('changesTableContainer').innerHTML =
                    '<p class="no-data-message">שגיאה בטעינת נתוני שינויים</p>';
                return;
            }

            this.changesData = data.changes || [];

            // הצגת הנתונים בהתאם לתצוגה הנוכחית
            if (this.currentView === 'table') {
                this.displayChangesTable();
            } else {
                this.displayCalendarView();
            }
        } catch (error) {
            console.error('Error fetching changes:', error);
            document.getElementById('changesTableContainer').innerHTML =
                '<p class="no-data-message">שגיאה בטעינת נתוני שינויים</p>';

            if (loadingIndicator) loadingIndicator.style.display = 'none';
        }
    }

    // הצגת טבלת השינויים
    displayChangesTable() {
        const container = document.getElementById('changesTableContainer');

        if (!container) {
            console.error('Changes table container not found');
            return;
        }

        if (!this.changesData || this.changesData.length === 0) {
            container.innerHTML = '<p class="no-data-message">לא נמצאו שינויים מתוכננים</p>';
            return;
        }

        let tableHTML = '<table class="changes-table">';

        // כותרות
        tableHTML += `
        <tr>
            <th>מספר שינוי</th>
            <th>שם השינוי</th>
            <th>תאריך השינוי</th>
        </tr>
    `;

        // שורות נתונים
        this.changesData.forEach(change => {
            // בדיקה אם השינוי הוא להיום
            const isToday = this.isChangeToday(change.date);

            // הוספת קישור לשינוי
            const changeLink = change.link ?
                `<a href="${change.link}" target="_blank" class="change-link">${change.number}</a>` :
                change.number;

            tableHTML += `
            <tr class="${isToday ? 'change-today' : ''}">
                <td>${changeLink}</td>
                <td>${change.name}</td>
                <td>${change.date}</td>
            </tr>
        `;
        });

        tableHTML += '</table>';
        container.innerHTML = tableHTML;
    }

    // הצגת תצוגת לוח שנה
    displayCalendarView() {
        const container = document.getElementById('changesTableContainer');

        if (!container) {
            console.error('Changes container not found');
            return;
        }

        if (!this.changesData || this.changesData.length === 0) {
            container.innerHTML = '<p class="no-data-message">לא נמצאו שינויים מתוכננים</p>';
            return;
        }

        // ארגון השינויים לפי תאריך
        const changesByDate = this.organizeChangesByDate();

        // יצירת לוח שנה לחודש הנוכחי
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();

        // יצירת מבנה לוח השנה
        let calendarHTML = `
        <div class="calendar-container">
            <div class="calendar-header">
                <button class="calendar-nav-btn prev-month">
                    <i class="fas fa-chevron-right"></i>
                </button>
                <h3 class="calendar-title">${this.getHebrewMonthName(currentMonth)} ${currentYear}</h3>
                <button class="calendar-nav-btn next-month">
                    <i class="fas fa-chevron-left"></i>
                </button>
            </div>
            <div class="calendar-grid">
                <div class="calendar-weekdays">
                    <div>א'</div>
                    <div>ב'</div>
                    <div>ג'</div>
                    <div>ד'</div>
                    <div>ה'</div>
                    <div>ו'</div>
                    <div>ש'</div>
                </div>
                <div class="calendar-days">
                    ${this.generateCalendarDays(currentMonth, currentYear, changesByDate)}
                </div>
            </div>
        </div>
    `;

        container.innerHTML = calendarHTML;

        // הוספת מאזיני אירועים לכפתורי הניווט
        this.setupCalendarNavigation(container, currentMonth, currentYear);

        // הוספת מאזיני אירועים לכפתורי "שינויים נוספים"
        const moreChangesButtons = container.querySelectorAll('.day-change.more-changes');
        moreChangesButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                // מניעת בועה של האירוע
                event.stopPropagation();

                // מציאת היום המתאים
                const dayElement = button.closest('.calendar-day');
                const dayChanges = dayElement.querySelector('.day-changes');

                // מציאת התאריך של היום
                const day = parseInt(dayElement.querySelector('.day-number').textContent);
                const dateStr = this.formatDateString(day, currentMonth + 1, currentYear);

                // מציאת כל השינויים לתאריך זה
                const allChangesForDay = changesByDate[dateStr] || [];

                // יצירת HTML עבור כל השינויים
                let allChangesHTML = '';
                allChangesForDay.forEach(change => {
                    const changeLink = change.link ?
                        `<a href="${change.link}" target="_blank" class="change-link">` :
                        '<span>';

                    const closingTag = change.link ? '</a>' : '</span>';

                    allChangesHTML += `
                <div class="day-change" title="${change.name}">
                    ${changeLink}
                        <span class="change-number">${change.number}</span>
                        <span class="change-name">${this.truncateText(change.name, 20)}</span>
                    ${closingTag}
                </div>
                `;
                });

                // החלפת התוכן של היום בכל השינויים
                dayChanges.innerHTML = allChangesHTML;
            });
        });
    }

    // הגדרת מאזיני אירועים לניווט בלוח השנה
    setupCalendarNavigation(container, initialMonth, initialYear) {
        let currentMonth = initialMonth;
        let currentYear = initialYear;

        const prevBtn = container.querySelector('.prev-month');
        const nextBtn = container.querySelector('.next-month');

        prevBtn.addEventListener('click', () => {
            currentMonth--;
            if (currentMonth < 0) {
                currentMonth = 11;
                currentYear--;
            }
            this.updateCalendarView(container, currentMonth, currentYear);
        });

        nextBtn.addEventListener('click', () => {
            currentMonth++;
            if (currentMonth > 11) {
                currentMonth = 0;
                currentYear++;
            }
            this.updateCalendarView(container, currentMonth, currentYear);
        });
    }

    // עדכון תצוגת לוח השנה
    updateCalendarView(container, month, year) {
        const changesByDate = this.organizeChangesByDate();

        const titleElement = container.querySelector('.calendar-title');
        titleElement.textContent = `${this.getHebrewMonthName(month)} ${year}`;

        const daysContainer = container.querySelector('.calendar-days');
        daysContainer.innerHTML = this.generateCalendarDays(month, year, changesByDate);

        // הוספת מאזיני אירועים לכפתורי "שינויים נוספים"
        const moreChangesButtons = container.querySelectorAll('.day-change.more-changes');
        moreChangesButtons.forEach(button => {
            button.addEventListener('click', (event) => {
                // מניעת בועה של האירוע
                event.stopPropagation();

                // מציאת היום המתאים
                const dayElement = button.closest('.calendar-day');
                const dayChanges = dayElement.querySelector('.day-changes');

                // מציאת התאריך של היום
                const day = parseInt(dayElement.querySelector('.day-number').textContent);
                const dateStr = this.formatDateString(day, month + 1, year);

                // מציאת כל השינויים לתאריך זה
                const allChangesForDay = changesByDate[dateStr] || [];

                // יצירת HTML עבור כל השינויים
                let allChangesHTML = '';
                allChangesForDay.forEach(change => {
                    const changeLink = change.link ?
                        `<a href="${change.link}" target="_blank" class="change-link">` :
                        '<span>';

                    const closingTag = change.link ? '</a>' : '</span>';

                    allChangesHTML += `
                <div class="day-change" title="${change.name}">
                    ${changeLink}
                        <span class="change-number">${change.number}</span>
                        <span class="change-name">${this.truncateText(change.name, 20)}</span>
                    ${closingTag}
                </div>
                `;
                });

                // החלפת התוכן של היום בכל השינויים
                dayChanges.innerHTML = allChangesHTML;
            });
        });
    }

    // יצירת ימי לוח השנה
    generateCalendarDays(month, year, changesByDate) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();

        // התאמה ליום ראשון כתחילת השבוע (0 = יום ראשון)
        // הבעיה: בישראל יום ראשון הוא יום 0, אבל בלוח השנה שלנו הוא מוצג כיום 1
        let startingDayOfWeek = firstDay.getDay();

        // תיקון: בישראל יום ראשון הוא 0, לא צריך להוסיף 1
        // אם startingDayOfWeek הוא 0 (יום ראשון), נשאיר אותו כ-0
        // במקום:
        // if (startingDayOfWeek === 0) startingDayOfWeek = 7;

        // נשתמש בקוד הבא:
        // בלוח השנה שלנו: 0=א', 1=ב', 2=ג', 3=ד', 4=ה', 5=ו', 6=ש'

        let daysHTML = '';

        // ימים ריקים לפני תחילת החודש
        for (let i = 0; i < startingDayOfWeek; i++) {
            daysHTML += '<div class="calendar-day empty"></div>';
        }

        // ימי החודש
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = this.formatDateString(day, month + 1, year);
            const changesForDay = changesByDate[dateStr] || [];

            const isToday = this.isToday(day, month, year);
            const hasChanges = changesForDay.length > 0;

            let dayClasses = 'calendar-day';
            if (isToday) dayClasses += ' today';
            if (hasChanges) dayClasses += ' has-changes';

            daysHTML += `
            <div class="${dayClasses}">
                <div class="day-number">${day}</div>
                ${hasChanges ? this.generateChangesForDay(changesForDay) : ''}
            </div>
        `;
        }

        return daysHTML;
    }

    // יצירת תצוגת שינויים ליום מסוים
    generateChangesForDay(changes) {
        // אם אין שינויים, החזר מחרוזת ריקה
        if (!changes || changes.length === 0) return '';

        let changesHTML = '<div class="day-changes">';

        // הגבלה ל-3 שינויים בתצוגה הראשונית
        const displayChanges = changes.slice(0, 2);
        const remainingChanges = changes.length - 2;

        // הצגת השינויים הראשונים
        displayChanges.forEach(change => {
            // הוספת קישור לשינוי
            const changeLink = change.link ?
                `<a href="${change.link}" target="_blank" class="change-link">` :
                '<span>';

            const closingTag = change.link ? '</a>' : '</span>';

            changesHTML += `
        <div class="day-change" title="${change.name}">
            ${changeLink}
                <span class="change-number">${change.number}</span>
                <span class="change-name">${this.truncateText(change.name, 20)}</span>
            ${closingTag}
        </div>
        `;
        });

        // הוספת אינדיקציה לשינויים נוספים
        if (remainingChanges > 0) {
            changesHTML += `
        <div class="day-change more-changes" title="${remainingChanges} שינויים נוספים">
            <span class="change-more">+ ${remainingChanges} נוספים...</span>
        </div>
        `;
        }

        changesHTML += '</div>';
        return changesHTML;
    }

    // קיצור טקסט ארוך
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    // בדיקה אם תאריך הוא היום
    isToday(day, month, year) {
        const today = new Date();
        return day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();
    }

    // ארגון השינויים לפי תאריך
    organizeChangesByDate() {
        const changesByDate = {};

        this.changesData.forEach(change => {
            const dateObj = this.parseDateString(change.date);
            if (dateObj) {
                const dateStr = this.formatDateString(
                    dateObj.getDate(),
                    dateObj.getMonth() + 1,
                    dateObj.getFullYear()
                );

                if (!changesByDate[dateStr]) {
                    changesByDate[dateStr] = [];
                }

                changesByDate[dateStr].push(change);
            }
        });

        return changesByDate;
    }

    // פרסור מחרוזת תאריך
    parseDateString(dateString) {
        if (!dateString) return null;

        try {
            // פורמטים אפשריים לתאריך
            const formats = [
                /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/, // DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY
                /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/    // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
            ];

            for (const format of formats) {
                const match = dateString.match(format);
                if (match) {
                    let day, month, year;

                    if (match[3] && match[3].length <= 2) {
                        // פורמט DD-MM-YY
                        day = parseInt(match[1], 10);
                        month = parseInt(match[2], 10) - 1;
                        year = parseInt(match[3], 10);
                        if (year < 100) year += 2000;
                    } else if (match[1].length === 4) {
                        // פורמט YYYY-MM-DD
                        year = parseInt(match[1], 10);
                        month = parseInt(match[2], 10) - 1;
                        day = parseInt(match[3], 10);
                    } else {
                        // פורמט DD-MM-YYYY
                        day = parseInt(match[1], 10);
                        month = parseInt(match[2], 10) - 1;
                        year = parseInt(match[3], 10);
                    }

                    // תיקון: יצירת תאריך עם שעה 12:00 כדי למנוע בעיות אזור זמן
                    return new Date(year, month, day, 12, 0, 0);
                }
            }

            // ניסיון פרסור רגיל
            const date = new Date(dateString);
            if (!isNaN(date.getTime())) {
                // תיקון: איפוס שעה ל-12:00 כדי למנוע בעיות אזור זמן
                return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
            }

            return null;
        } catch (error) {
            console.error('Error parsing date:', error);
            return null;
        }
    }

    // פורמט מחרוזת תאריך
    formatDateString(day, month, year) {
        return `${day.toString().padStart(2, '0')}-${month.toString().padStart(2, '0')}-${year}`;
    }

    // קבלת שם חודש בעברית
    getHebrewMonthName(monthIndex) {
        const hebrewMonths = [
            'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
            'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
        ];
        return hebrewMonths[monthIndex];
    }

    // בדיקה אם השינוי מתוכנן להיום
    isChangeToday(dateString) {
        if (!dateString) return false;

        try {
            // ניסיון לפרסר את התאריך בפורמטים שונים
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const dateObj = this.parseDateString(dateString);
            if (dateObj) {
                dateObj.setHours(0, 0, 0, 0);
                return dateObj.getTime() === today.getTime();
            }

            return false;
        } catch (error) {
            console.error('Error parsing date:', error);
            return false;
        }
    }

    // התחלת רענון אוטומטי
    startAutoRefresh() {
        // ניקוי אינטרוול קיים אם יש
        this.stopAutoRefresh();

        // הגדרת אינטרוול חדש - רענון כל AUTO_REFRESH_MINUTES דקות
        this.autoRefreshInterval = setInterval(() => {
            this.loadChanges();
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000);
    }

    // עצירת רענון אוטומטי
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }
}

// יצירת אובייקט גלובלי
const changesManager = new ChangesManager();