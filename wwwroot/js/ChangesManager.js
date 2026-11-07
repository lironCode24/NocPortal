class ChangesManager {
    constructor() {
        this.changesData = [];
        this.currentView = 'calendar';
        this.autoRefreshInterval = null;
        this.AUTO_REFRESH_MINUTES = 60;

        // מצב בקשת רענון חיצוני
        this.REFRESH_API_URL =
            'https://prod-api-cloudbeat.menora.co.il/cases/api/case/3872' +
            '/run?apiKey=54ae6a3c-c475-48f1-a50d-b200ea335fa5';
        this._refreshPending = false;  // האם כבר שלחנו בקשת רענון
        this._postRefreshTimeout = null;   // טיימר ל-10 דקות

        // מצב pagination לטבלה
        this.tablePage = 1;
        this.tablePageSize = 100;
        this.tableTotalPages = 1;
        this.tableTotalCount = 0;
        this.tableSearch = '';

        // מצב לוח שנה
        this.calendarMonth = new Date().getMonth() + 1;
        this.calendarYear = new Date().getFullYear();

        // ── מנגנון התראות שינויים ──────────────────────────────
        this.changeAlarmInterval = null;
        this.ALARM_CHECK_MINUTES = 1;           // בדיקה כל דקה
        this.ALARM_BEFORE_MINUTES = 5;         // התראה 10 דקות לפני
        this.shownChangeAlarms = new Set();     // התראות שכבר הוצגו
        this.shownAlarmEmails = new Set(); // מניעת כפילות במיילים
        // ──────────────────────────────────────────────────────

        this.setupViewToggle();
        this.setupImportOldSystem();
        this.setupSearch();
        this.setupExportButtons();

        // טעינה ראשונית לפי תצוגה
        this.loadCurrentView();
        this.startAutoRefresh();
        this.startChangeAlarmMonitoring(); // ← הפעלת מנגנון התראות
    }

    // ==========================================================
    // מנגנון התראות שינויים קרובים
    // ==========================================================

    /**
     * מתחיל את הבדיקה התקופתית של שינויים קרובים
     */
    startChangeAlarmMonitoring() {
        this.stopChangeAlarmMonitoring();

        // בדיקה ראשונית מיידית
        this.checkUpcomingChanges();

        // בדיקה כל דקה
        this.changeAlarmInterval = setInterval(() => {
            this.checkUpcomingChanges();
        }, this.ALARM_CHECK_MINUTES * 60 * 1000);
    }

    /**
     * עוצר את הבדיקה התקופתית
     */
    stopChangeAlarmMonitoring() {
        if (this.changeAlarmInterval) {
            clearInterval(this.changeAlarmInterval);
            this.changeAlarmInterval = null;
        }
    }

    /**
     * בודק אם יש שינויים שעומדים להתחיל או להסתיים
     * ומציג התראה 10 דקות לפני
     */
    checkUpcomingChanges() {
        if (!this.changesData || this.changesData.length === 0) return;

        const now = new Date();

        this.changesData.forEach(change => {
            // ── סנן מבוטלים ──────────────────────────────────────
            const status = (change.status || '').toLowerCase().trim();
            if (['cancelled', 'canceled', 'בוטל', 'pending', 'ממתין']
                .includes(status)) return;

            // ── בדוק תאריך התחלה ─────────────────────────────────
            this._checkSingleAlarm(change, 'start', now);

            // ── בדוק תאריך סיום ──────────────────────────────────
            this._checkSingleAlarm(change, 'end', now);
        });
    }

    /**
     * בודק ומציג התראה לאירוע בודד (התחלה או סיום)
     * @param {Object} change - אובייקט השינוי
     * @param {'start'|'end'} type - סוג האירוע
     * @param {Date} now - הזמן הנוכחי
     */
    _checkSingleAlarm(change, type, now) {
        // ── קבל את זמן האירוע ─────────────────────────────────
        const timeStr = type === 'start'
            ? this._getEffectiveStartTime(change)
            : this._getEffectiveEndTime(change);

        if (!timeStr) return;

        const eventTime = this.parseDateWithTime(timeStr);
        if (!eventTime || isNaN(eventTime.getTime())) return;

        const diffMs = eventTime.getTime() - now.getTime();
        const diffMinutes = diffMs / (1000 * 60);

        if (diffMinutes >= 1 && diffMinutes <= 10) {

            // מפתח ייחודי לפי שעה - לא מילישניות
            const eventDateKey =
                `${eventTime.getFullYear()}-` +
                `${eventTime.getMonth()}-` +
                `${eventTime.getDate()}-` +
                `${eventTime.getHours()}`;

            const emailKey =
                `EMAIL_${change.number}_${type}_${eventDateKey}`;

            // ── סנן כפילויות בצד הלקוח קודם (מהיר) ──────────────
            if (!this.shownAlarmEmails.has(emailKey)) {
                this.shownAlarmEmails.add(emailKey);

                // ── בדוק בשרת אם כבר נשלח (atomic check + mark) ──
                this._sendAlarmEmailIfNotSent(change, type, eventTime, diffMinutes, emailKey);
            }
        }

        // ── פופאפ: חלון -1 עד +5 דקות ──
        if (diffMinutes < -1 || diffMinutes > this.ALARM_BEFORE_MINUTES) return;

        // ── מפתח ייחודי למניעת כפילויות ──────────────────────
        const alarmKey = `${change.number}_${type}_${eventTime.toISOString()}`;
        if (this.shownChangeAlarms.has(alarmKey)) return;

        // ── הצג את ההתראה ─────────────────────────────────────
        this._showChangeAlarmPopup(change, type, eventTime, diffMinutes);
        this.shownChangeAlarms.add(alarmKey);

        // ── נקה מהזיכרון אחרי 20 דקות ────────────────────────
        setTimeout(() => {
            this.shownChangeAlarms.delete(alarmKey);
        }, 20 * 60 * 1000);
    }

    // -------------------------------------------------------
    // Wrapper: בודק בשרת לפני שליחה
    // -------------------------------------------------------
    async _sendAlarmEmailIfNotSent(change, type, eventTime, diffMinutes, emailKey) {
        try {
            // ── שאל את השרת: האם לשלוח? ──────────────────────
            const checkRes = await fetch('/Changes/CheckAndMarkAlarmEmail', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ emailKey })
            });

            const checkData = await checkRes.json();

            // ── אם השרת אמר לא - עצור ────────────────────────
            if (!checkData.shouldSend) {
                console.log(
                    `[AlarmEmail] מייל כבר נשלח - דילוג: ${emailKey}`
                );
                return;
            }

            // ── שרת אישר - שלח ───────────────────────────────
            await this._sendAlarmEmail(
                change, type, eventTime, diffMinutes
            );

        } catch (err) {
            console.warn('[AlarmEmail] שגיאה בבדיקת שרת:', err);
            // במקרה של שגיאת תקשורת - שלח בכל זאת
            await this._sendAlarmEmail(change, type, eventTime, diffMinutes);
        }
    }

    /**
     * מציג פופאפ התראה לשינוי קרוב
     * @param {Object} change - אובייקט השינוי
     * @param {'start'|'end'} type - סוג האירוע
     * @param {Date} eventTime - זמן האירוע
     * @param {number} diffMinutes - הפרש דקות מהעכשיו
     */
    _showChangeAlarmPopup(change, type, eventTime, diffMinutes) {
        // ── עיצוב מחרוזת הזמן ────────────────────────────────
        const pad = n => String(n).padStart(2, '0');
        const timeDisplay =
            `${pad(eventTime.getHours())}:${pad(eventTime.getMinutes())}`;

        const dateDisplay = this.formatDateForDisplay(
            type === 'start'
                ? this._getEffectiveStartTime(change)
                : this._getEffectiveEndTime(change)
        );

        // ── בניית הודעה ───────────────────────────────────────
        const isStarting = type === 'start';
        const minutesLeft = Math.round(Math.abs(diffMinutes));
        const isNow = minutesLeft <= 1;

        const eventLabel = isStarting ? 'תחילת' : 'סיום';
        const actionMsg = isStarting
            ? 'יש לוודא התחלה בזמן המתוכנן מול מוביל הפעילות ולעדכן את קבוצת ה־WhatsApp בהתאם.'
            : 'אנא ודא שהפעילות הסתיימה בהצלחה ועדכן בהתאם בקבוצת ה-WhatsApp';

        const titleText = isNow
            ? `⏰ ${eventLabel} פעילות עכשיו!`
            : `⏰ ${eventLabel} פעילות בעוד ${minutesLeft} דקות`;

        const iconClass = isStarting ? 'fa-play-circle' : 'fa-stop-circle';
        const iconColor = isStarting ? '#22c55e' : '#ef4444';
        const borderColor = isStarting ? '#22c55e' : '#ef4444';
        const headerBg = isStarting
            ? 'linear-gradient(135deg,#14532d,#166534)'
            : 'linear-gradient(135deg, #153c64, #1b3099)';

        // ── יצירת אלמנט ה-DOM ────────────────────────────────
        const popupId = `changeAlarm_${change.number}_${type}`;

        // הסר פופאפ קיים לאותו שינוי
        document.getElementById(popupId)?.remove();

        const popup = document.createElement('div');
        popup.id = popupId;
        popup.className = 'change-alarm-popup';
        popup.setAttribute('role', 'alertdialog');
        popup.setAttribute('aria-live', 'assertive');

        popup.innerHTML = `
            <div class="change-alarm-content" 
                 style="border-right: 4px solid ${borderColor};">

                <!-- כפתור סגירה -->
                <button class="change-alarm-close-btn"
                        onclick="this.closest('.change-alarm-popup').remove()"
                        aria-label="סגור התראה">
                    <i class="fas fa-times"></i>
                </button>

                <!-- כותרת -->
                <div class="change-alarm-header"
                     style="background: ${headerBg};">
                    <div class="change-alarm-title">
                        <h3>${titleText}</h3>
                        <span class="change-alarm-subtitle">
                            שינוי מספר: ${change.number}
                        </span>
                    </div>
                </div>

                <!-- גוף ההתראה -->
                <div class="change-alarm-body">

                    <!-- מספר שינוי -->
                    <div class="change-alarm-row change-alarm-id">
                        <i class="fas fa-hashtag" style="color:#a78bfa;"></i>
                        <span class="change-alarm-label">מספר שינוי:</span>
                        <strong class="change-alarm-value">
                            ${change.number || ''}
                        </strong>
                    </div>

                    <!-- שם הפעילות -->
                    <div class="change-alarm-row change-alarm-name">
                        <i class="fas fa-tag" style="color:#a78bfa;"></i>
                        <span class="change-alarm-label">שם פעילות:</span>
                        <strong class="change-alarm-value">
                            ${change.name || ''}
                        </strong>
                    </div>

                    <!-- שעה -->
                    <div class="change-alarm-row">
                        <i class="fas fa-clock" style="color:#60a5fa;"></i>
                        <span class="change-alarm-label">
                            שעת ${eventLabel} פעילות:
                        </span>
                        <strong class="change-alarm-value">
                            ${timeDisplay}
                            <span class="change-alarm-date">
                                (${dateDisplay})
                            </span>
                        </strong>
                    </div>

                    <!-- מובילי פעילות -->
                    <div class="change-alarm-row change-alarm-presenters">
                        <i class="fas fa-users" style="color:#22c55e;"></i>
                        <span class="change-alarm-label">מובילי פעילות:</span>
                        <strong class="change-alarm-value">
                            ${this.cleanPresenters(change.presenters)}
                        </strong>
                    </div>

                    <!-- סטטוס -->
                    ${change.status ? `
                    <div class="change-alarm-row">
                        <i class="fas fa-info-circle" style="color:#fbbf24;"></i>
                        <span class="change-alarm-label">סטטוס:</span>
                        <span class="change-alarm-value">
                            ${this.mapStatus(change.status)}
                        </span>
                    </div>` : ''}

                    <!-- הודעת פעולה -->
                    <div class="change-alarm-message">
                        <i class="fas fa-bullhorn"></i>
                        <p>
                            שים לב! פעילות
                            <strong>${change.name || change.number}</strong>
                            עומדת ל${isStarting ? 'התחיל' : 'הסתיים'}
                            ב-<strong>${timeDisplay}</strong>.
                            <br>${actionMsg}
                        </p>
                    </div>

                </div>

                <!-- כפתורי פעולה -->
                <div class="change-alarm-footer">

                    ${change.link ? `
                    <a href="${change.link}"
                       target="_blank"
                       rel="noopener noreferrer"
                       class="change-alarm-btn change-alarm-btn-link"
                       onclick="event.stopPropagation()">
                        <i class="fas fa-external-link-alt"></i>
                        פתח קישור
                    </a>` : ''}

                    <button class="change-alarm-btn change-alarm-btn-snooze"
                            onclick="window.changesManager
                                ._snoozeChangeAlarm(
                                    '${change.number}',
                                    '${type}',
                                    '${eventTime.toISOString()}',
                                    this.closest('.change-alarm-popup')
                                )">
                        <i class="fas fa-bell-slash"></i>
                        דחה 5 דקות
                    </button>

                    <button class="change-alarm-btn change-alarm-btn-close"
                            onclick="this.closest('.change-alarm-popup').remove()">
                        <i class="fas fa-check"></i>
                        הבנתי
                    </button>

                </div>

            </div>
        `;

        document.body.appendChild(popup);

        // ── אנימציה ───────────────────────────────────────────
        requestAnimationFrame(() => {
            popup.classList.add('show');
        });

        // ── סגירה אוטומטית אחרי 3 דקות ──────────────────────
        setTimeout(() => {
            if (popup.parentNode) {
                popup.classList.remove('show');
                setTimeout(() => popup.remove(), 400);
            }
        }, 3 * 60 * 1000);
    }

    // -------------------------------------------------------
    // שליחת מייל התראה לשינוי קרוב
    // -------------------------------------------------------
    async _sendAlarmEmail(change, type, eventTime, diffMinutes) {
        try {
            const pad = n => String(n).padStart(2, '0');
            const timeDisplay =
                `${pad(eventTime.getHours())}:${pad(eventTime.getMinutes())}`;
            const dateDisplay = this.formatDateForDisplay(
                type === 'start'
                    ? this._getEffectiveStartTime(change)
                    : this._getEffectiveEndTime(change)
            );

            const minutesLeft = Math.round(Math.abs(diffMinutes));
            const isNow       = minutesLeft <= 1;

            const payload = {
                toEmail:      'noc@menoramivt.co.il',
                toName:       'NOC',
                changeNumber: change.number  || '',
                changeName:   change.name    || '',
                eventType:    type,
                eventTime:    timeDisplay,
                eventDate:    dateDisplay,
                presenters:   this.cleanPresenters(change.presenters || ''),
                status:       this.mapStatus(change.status || ''),
                system:       change.system  || '',
                link:         change.link    || '',
                minutesLeft:  minutesLeft,
                isNow:        isNow
            };

            await fetch('/Changes/SendAlarmEmail', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload)
            });

        } catch (err) {
            console.warn('[ChangeAlarm] שגיאה בשליחת מייל התראה:', err);
        }
    }

    /**
     * דחיית התראה ב-5 דקות
     */
    _snoozeChangeAlarm(changeNumber, type, eventTimeISO, popupEl) {
        // סגור פופאפ נוכחי
        if (popupEl) {
            popupEl.classList.remove('show');
            setTimeout(() => popupEl.remove(), 400);
        }

        // מחק מהסט כדי שתוצג שוב
        const change = this.changesData.find(c => c.number === changeNumber);
        if (!change) return;

        const eventTime = new Date(eventTimeISO);
        const alarmKey =
            `${changeNumber}_${type}_${eventTime.toISOString()}`;
        this.shownChangeAlarms.delete(alarmKey);

        // הצג שוב אחרי 5 דקות
        setTimeout(() => {
            const now = new Date();
            const diffMinutes =
                (eventTime.getTime() - now.getTime()) / (1000 * 60);
            if (change) {
                this._showChangeAlarmPopup(change, type, eventTime, diffMinutes);
            }
        }, 5 * 60 * 1000);

        // הצג הודעת אישור
        this._showSnoozeToast(5);
    }

    /**
     * מציג הודעת "נדחה" קצרה
     */
    _showSnoozeToast(minutes) {
        const toast = document.createElement('div');
        toast.className = 'change-alarm-snooze-toast';
        toast.innerHTML = `
            <i class="fas fa-bell-slash"></i>
            ההתראה נדחתה ב-${minutes} דקות
        `;
        document.body.appendChild(toast);

        requestAnimationFrame(() => toast.classList.add('show'));

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    // טעינת נתוני שינויים מהשרת
    async loadChanges() {
        try {
            // בדיקת רענון חיצוני - מאחורי הקלעים, לא חוסמת
            this.checkAndTriggerExternalRefresh(); // ← לא await - רץ ברקע
            this.showLoading(true);

            const response = await fetch('/Changes/GetChanges');
            const data = await response.json();

            this.showLoading(false);

            if (!data.success) {
                console.error('Error loading changes:', data.message);
                this.showError('שגיאה בטעינת נתוני שינויים');
                return;
            }

            this.changesData = data.changes || [];

            // ── תיקון: שימוש ב-this במקום changesManager ──────
            this.loadCurrentView();

            // ── לאחר טעינה - בדוק התראות ─────────────────────
            this.checkUpcomingChanges();

        } catch (error) {
            console.error('Error fetching changes:', error);
            this.showLoading(false);
            this.showError('שגיאה בטעינת נתוני שינויים');
        }
    }

    // -------------------------------------------------------
    // טעינת עמוד טבלה מהשרת
    // -------------------------------------------------------
    async loadTablePage(page = 1) {
        try {
            this.showLoading(true);
            this.tablePage = page;

            const params = new URLSearchParams({
                page: this.tablePage,
                pageSize: this.tablePageSize,
                search: this.tableSearch
            });

            const response = await fetch(`/Changes/GetChanges?${params}`);
            const data = await response.json();

            this.showLoading(false);

            if (!data.success) {
                this.showError('שגיאה בטעינת נתוני שינויים: ' + data.message);
                return;
            }

            this.changesData = data.changes || [];
            this.tableTotalPages = data.pagination.totalPages;
            this.tableTotalCount = data.pagination.totalCount;

            this.displayChangesTable();

            // ── בדוק התראות אחרי עדכון הנתונים ───────────────
            this.checkUpcomingChanges();

        } catch (error) {
            this.showLoading(false);
            this.showError('שגיאת תקשורת: ' + error.message);
        }
    }

    // -------------------------------------------------------
    // טעינת חודש ספציפי ללוח שנה
    // -------------------------------------------------------
    async loadCalendarMonth(month, year) {
        try {
            this.showLoading(true);
            this.calendarMonth = month;
            this.calendarYear = year;

            const params = new URLSearchParams({ month, year });
            const response =
                await fetch(`/Changes/GetChangesByMonth?${params}`);
            const data = await response.json();

            this.showLoading(false);

            if (!data.success) {
                this.showError(
                    'שגיאה בטעינת שינויים לחודש: ' + data.message
                );
                return;
            }

            this.changesData = data.changes || [];
            this.displayCalendarView(month, year);

            // ── בדוק התראות אחרי עדכון הנתונים ───────────────
            this.checkUpcomingChanges();

        } catch (error) {
            this.showLoading(false);
            this.showError('שגיאת תקשורת: ' + error.message);
        }
    }

    // -------------------------------------------------------
    // בדיקה האם צריך לרענן מהמקור החיצוני
    // -------------------------------------------------------
    async checkAndTriggerExternalRefresh() {
        // אם כבר שלחנו בקשה ומחכים - לא שולחים שוב
        if (this._refreshPending) return;

        try {
            const res = await fetch('/Changes/CheckIfRefreshNeeded');
            const data = await res.json();

            if (!data.needed) return;

            // בניית URL עם __from = זמן הקובץ האחרון (או לפני שעתיים)
            const fromMs = data.lastFileTime
                ? new Date(data.lastFileTime).getTime()
                : Date.now() - 2 * 60 * 60 * 1000;

            const triggerUrl =
                this.REFRESH_API_URL + `&var-time=${fromMs}`;

            // קריאה מאחורי הקלעים - לא מחכים לתשובה
            fetch(triggerUrl, { mode: 'no-cors' }).catch(() => { });

            this._refreshPending = true;

            // אחרי 10 דקות - רענן ואפס דגל
            this._postRefreshTimeout = setTimeout(async () => {
                this._refreshPending = false;
                console.log('[ChangesManager] רענון אחרי 10 דקות');
                await this.loadCurrentView();
            }, 10 * 60 * 1000);

        } catch (err) {
            console.warn('[ChangesManager] checkAndTriggerExternalRefresh שגיאה:', err);
        }
    }

    // -------------------------------------------------------
    // טעינה לפי תצוגה נוכחית
    // -------------------------------------------------------
    loadCurrentView() {
        if (this.currentView === 'table') {
            this.loadTablePage(this.tablePage);
        } else {
            this.loadCalendarMonth(this.calendarMonth, this.calendarYear);
        }
    }

    // טעינת נתוני שינויים מהשרת
    async loadChanges() {
        try {
            // בדיקת רענון חיצוני - מאחורי הקלעים, לא חוסמת
            this.checkAndTriggerExternalRefresh();
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

            changesManager.loadCurrentView();

        } catch (error) {
            console.error('Error fetching changes:', error);
            const loadingIndicator = document.getElementById('changesLoadingIndicator');
            if (loadingIndicator) loadingIndicator.style.display = 'none';
            document.getElementById('changesTableContainer').innerHTML =
                '<p class="no-data-message">שגיאה בטעינת נתוני שינויים</p>';
        }
    }

    // -------------------------------------------------------
    // הצגת טבלה עם pagination
    // -------------------------------------------------------
    displayChangesTable() {
        const container = document.getElementById('changesTableContainer');
        if (!container) return;

        // *** סנן מבוטלים ו-pending - לא משנה את this.changesData ***
        const visibleChanges = (this.changesData || []).filter(c => {
            const s = (c.status || '').toLowerCase().trim();
            return !['cancelled', 'canceled', 'בוטל', 'pending', 'ממתין'].includes(s);
        });

        if (!visibleChanges || visibleChanges.length === 0) {
            container.innerHTML = '<p class="no-data-message">לא נמצאו שינויים</p>';
            return;
        }

        let html = `
        <div class="table-info">
            סה"כ ${this.tableTotalCount.toLocaleString()} שינויים | 
            עמוד ${this.tablePage} מתוך ${this.tableTotalPages}
        </div>
        <table class="changes-table">
            <thead>
                <tr>
                    <th>מספר שינוי</th>
                    <th>שם השינוי</th>
                    <th>תאריך</th>
                    <th>סטטוס</th>
                </tr>
            </thead>
            <tbody>
    `;

        visibleChanges.forEach(change => {
            const isToday = this.isChangeToday(change.date);
            const link = change.link
                ? `<a href="${change.link}" target="_blank" class="change-link">${change.number}</a>`
                : `<span class="clickable-number" data-number="${change.number}">${change.number}</span>`;

            // *** תיקון: הסרת sourceBadge לחלוטין ***

            // *** הצג תאריך מפורמט - plannedStartTime או date ***
            const displayDate = this._getEffectiveStartTime(change);

            html += `
            <tr class="${isToday ? 'change-today' : ''}" 
                data-number="${change.number}"
                style="cursor:pointer">
                <td>${link}</td>
                <td>${change.name || ''}</td>
                <td>${this.formatDateForDisplay(displayDate)}</td>
                <td>${this.mapStatus(change.status)}</td>
            </tr>
        `;
        });

        html += `</tbody></table>`;
        html += this.buildPaginationHTML();

        container.innerHTML = html;

        // מאזיני קליק לשורות - ללא שינוי
        container.querySelectorAll('tbody tr').forEach(row => {
            row.addEventListener('click', () => {
                const number = row.getAttribute('data-number');
                const change = visibleChanges.find(c => c.number === number);
                if (change) this.showChangePopup(change);
            });
        });

        this.attachPaginationListeners(container);
    }
    // -------------------------------------------------------
    // בניית HTML לפקדי pagination
    // -------------------------------------------------------
    buildPaginationHTML() {
        if (this.tableTotalPages <= 1) return '';

        const maxButtons = 7;
        let pages = [];

        // חישוב טווח עמודים להצגה
        let start = Math.max(1, this.tablePage - 3);
        let end = Math.min(this.tableTotalPages, start + maxButtons - 1);
        if (end - start < maxButtons - 1)
            start = Math.max(1, end - maxButtons + 1);

        for (let i = start; i <= end; i++) pages.push(i);

        let html = '<div class="pagination">';

        // כפתור ראשון
        html += `<button class="page-btn" data-page="1" 
                    ${this.tablePage === 1 ? 'disabled' : ''}>
                    ««
                 </button>`;

        // כפתור הקודם
        html += `<button class="page-btn" data-page="${this.tablePage - 1}" 
                    ${this.tablePage === 1 ? 'disabled' : ''}>
                    ‹
                 </button>`;

        // מספרי עמודים
        pages.forEach(p => {
            html += `<button class="page-btn ${p === this.tablePage ? 'active' : ''}" 
                        data-page="${p}">${p}
                     </button>`;
        });

        // כפתור הבא
        html += `<button class="page-btn" data-page="${this.tablePage + 1}" 
                    ${this.tablePage === this.tableTotalPages ? 'disabled' : ''}>
                    ›
                 </button>`;

        // כפתור אחרון
        html += `<button class="page-btn" data-page="${this.tableTotalPages}" 
                    ${this.tablePage === this.tableTotalPages ? 'disabled' : ''}>
                    »»
                 </button>`;

        // קפיצה לעמוד
        html += `
            <span class="page-jump">
                עבור לעמוד:
                <input type="number" id="pageJumpInput" 
                       min="1" max="${this.tableTotalPages}" 
                       value="${this.tablePage}" />
                <button id="pageJumpBtn">עבור</button>
            </span>
        `;

        html += '</div>';
        return html;
    }

    // -------------------------------------------------------
    // מאזיני pagination
    // -------------------------------------------------------
    attachPaginationListeners(container) {
        container.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.getAttribute('data-page'));
                if (!isNaN(page) && page >= 1 && page <= this.tableTotalPages) {
                    this.loadTablePage(page);
                    // גלילה לראש הטבלה
                    container.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });

        const jumpBtn = container.querySelector('#pageJumpBtn');
        const jumpInput = container.querySelector('#pageJumpInput');

        if (jumpBtn && jumpInput) {
            jumpBtn.addEventListener('click', () => {
                const page = parseInt(jumpInput.value);
                if (!isNaN(page) && page >= 1 && page <= this.tableTotalPages) {
                    this.loadTablePage(page);
                    container.scrollIntoView({ behavior: 'smooth' });
                }
            });

            jumpInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') jumpBtn.click();
            });
        }
    }

    // -------------------------------------------------------
    // הצגת לוח שנה - טוען רק את החודש הנוכחי
    // -------------------------------------------------------
    displayCalendarView(month, year) {
        const container = document.getElementById('changesTableContainer');
        if (!container) return;

        // *** סנן מבוטלים ו-pending - שמור בנפרד ***
        const filteredChanges = (this.changesData || []).filter(c => {
            const s = (c.status || '').toLowerCase().trim();
            return !['cancelled', 'canceled', 'בוטל', 'pending', 'ממתין'].includes(s);
        });

        // *** השתמש ב-filteredChanges לארגון לפי תאריך ***
        const changesByDate = this._organizeChangesByDateFiltered(filteredChanges);

        let html = `
            <div class="calendar-container">
                <div class="calendar-header">
                    <button class="calendar-nav-btn prev-month">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                    <h3 class="calendar-title">
                        ${this.getHebrewMonthName(month - 1)} ${year}
                    </h3>
                    <button class="calendar-nav-btn next-month">
                        <i class="fas fa-chevron-left"></i>
                    </button>
                </div>
                <div class="calendar-month-info">
                    ${this.changesData.length} שינויים בחודש זה
                </div>
                <div class="calendar-grid">
                    <div class="calendar-weekdays">
                        <div>א'</div><div>ב'</div><div>ג'</div><div>ד'</div>
                        <div>ה'</div><div>ו'</div><div>ש'</div>
                    </div>
                    <div class="calendar-days">
                        ${this.generateCalendarDays(month - 1, year, changesByDate)}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // ניווט חודשים - טוען מהשרת
        container.querySelector('.prev-month').addEventListener('click', () => {
            let m = month - 1, y = year;
            if (m < 1) { m = 12; y--; }
            this.loadCalendarMonth(m, y);
        });

        container.querySelector('.next-month').addEventListener('click', () => {
            let m = month + 1, y = year;
            if (m > 12) { m = 1; y++; }
            this.loadCalendarMonth(m, y);
        });

        // מאזיני "עוד שינויים"
        this.attachMoreChangesListeners(container, changesByDate, month - 1, year);
        // מאזיני קליק לפופאפ
        this.attachChangeClickListeners(container);
    }

    _organizeChangesByDateFiltered(changes) {
        const byDate = {};
        (changes || []).forEach(change => {
            const rawDate = this._getEffectiveStartTime(change);
            const dateObj = this.parseDateString(rawDate);
            if (!dateObj) return;

            const dateStr = this.formatDateString(
                dateObj.getDate(),
                dateObj.getMonth() + 1,
                dateObj.getFullYear()
            );

            if (!byDate[dateStr]) byDate[dateStr] = [];
            byDate[dateStr].push(change);
        });
        return byDate;
    }
    // -------------------------------------------------------
    // חיפוש
    // -------------------------------------------------------
    setupSearch() {
        const searchInput = document.getElementById('changesSearchInput');
        const searchBtn = document.getElementById('changesSearchBtn');

        if (searchInput) {
            // חיפוש בלחיצת Enter
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.doSearch();
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', () => this.doSearch());
        }
    }

    doSearch() {
        const searchInput = document.getElementById('changesSearchInput');
        this.tableSearch = searchInput ? searchInput.value.trim() : '';
        this.tablePage = 1; // חזרה לעמוד ראשון
        this.loadTablePage(1);
    }

    async loadExcelJS() {
        if (typeof ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js';
                script.onload = res;
                script.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                document.head.appendChild(script);
            });
        }
        if (typeof saveAs === 'undefined') {
            await new Promise((res, rej) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';
                script.onload = res;
                script.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                document.head.appendChild(script);
            });
        }
    }

    downloadExport(exportType, options = {}) {
        this._pendingExportType = exportType;
        this.buildAndDownloadExcel(exportType, options);
    }

    async buildAndDownloadExcel(exportType, options = {}) {
        try {
            await this.loadExcelJS();

            let changesToExport = [];
            let sheetTitle = '';
            let fileName = '';
            let cabDateDisplay = '';

            // *** פונקציה לטעינת כל השינויים מכל החודשים ***
            const loadAllChanges = async () => {
                const allChanges = [];
                const now = new Date();

                // טען 3 חודשים: חודש שעבר, נוכחי, הבא
                const monthsToLoad = [
                    { month: now.getMonth(), year: now.getFullYear() },  // חודש שעבר
                    { month: now.getMonth() + 1, year: now.getFullYear() },  // חודש נוכחי
                    { month: now.getMonth() + 2, year: now.getFullYear() },  // חודש הבא
                ];

                // תקן חודשים שחורגים מ-12
                monthsToLoad.forEach(m => {
                    if (m.month > 12) { m.month -= 12; m.year++; }
                    if (m.month < 1) { m.month += 12; m.year--; }
                });

                for (const { month, year } of monthsToLoad) {
                    try {
                        const res = await fetch(
                            `/Changes/GetChangesByMonth?month=${month}&year=${year}`
                        );
                        const data = await res.json();
                        if (data.success && data.changes) {
                            allChanges.push(...data.changes);
                        }
                    } catch (err) {
                        console.warn(`שגיאה בטעינת חודש ${month}/${year}:`, err);
                    }
                }

                // הסר כפילויות לפי מספר שינוי
                const seen = new Set();
                return allChanges.filter(c => {
                    if (seen.has(c.number)) return false;
                    seen.add(c.number);
                    return true;
                });
            };
            if (exportType === 'cab') {
                // *** שימוש ב-endpoint הבקאנד במקום לוגיקה מקומית ***
                const cabRes = await fetch('/Changes/GetCabChanges');
                const cabData = await cabRes.json();

                if (!cabData.success) {
                    alert('שגיאה בטעינת שינויי CAB: ' + cabData.message);
                    return;
                }

                changesToExport = cabData.changes || [];

                const cabFrom = cabData.from || '';
                const cabTo = cabData.to || '';

                sheetTitle = `CAB ${cabFrom} - ${cabTo}`;
                cabDateDisplay = cabFrom;
                fileName = `CAB_Changes_${new Date().toISOString().slice(0, 10)}.xlsx`;

                if (changesToExport.length === 0) {
                    alert(`לא נמצאו שינויים ל-CAB בטווח ${cabFrom} - ${cabTo}`);
                    return;
                }
            } else if (exportType === 'range') {
                // *** חדש: ייצוא לפי טווח תאריכים ***
                const res = await fetch(`/Changes/GetChanges?page=1&pageSize=9999`);
                const data = await res.json();
                changesToExport = (data.changes || []).filter(c => {
                    const s = (c.status || '').toLowerCase().trim();
                    return s !== 'cancelled' && s !== 'canceled' && s !== 'בוטל';
                });
                const all = changesToExport;

                const fromD = new Date(options.from);
                const toD = new Date(options.to);
                toD.setDate(toD.getDate() + 1); // כולל את יום הסיום

                changesToExport = all.filter(c => {
                    var actualStartTime = (c.actualStartTime || '').trim();
                    if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                        actualStartTime = this._normalizeActualDate(c.actualStartTime)
                    } else {
                        actualStartTime = c.plannedStartTime || c.date
                    }
                    const d = this.parseDateStringExport(actualStartTime);
                    if (!d) return false;
                    return d >= fromD && d < toD;
                });

                // *** פורמט תאריכים לתצוגה בעברית ***
                const formatDisplay = (dateStr) => {
                    const d = new Date(dateStr);
                    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                };

                // *** אחרי - שימוש בתצוגה שכבר מגיעה מוכנה ***
                const fromDisplay = options.fromDisplay || options.from;
                const toDisplay = options.toDisplay || options.to;

                sheetTitle = `שינויים ${fromDisplay} - ${toDisplay}`;
                fileName = `Changes_${options.from}_to_${options.to}.xlsx`;

            } else {
                // *** all - ללא שינוי ***
                const res = await fetch(`/Changes/GetChanges?page=1&pageSize=9999`);
                const data = await res.json();
                changesToExport = data.changes || [];
                sheetTitle = 'כל השינויים';
                fileName = `All_Changes_${new Date().toISOString().slice(0, 10)}.xlsx`;
            }

            // *** בדיקה: אם אין תוצאות לטווח שנבחר ***
            if (exportType === 'range' && changesToExport.length === 0) {
                alert(`לא נמצאו שינויים בטווח התאריכים שנבחר`);
                return;
            }


            // *** מיון לפי תאריך - מהקרוב לרחוק ***
            changesToExport.sort((a, b) => {
                // השתמש ב-plannedStartTime אם קיים (כולל שעה), אחרת date
                const dateA = this.parseDateWithTime(this._getEffectiveStartTime(a));
                const dateB = this.parseDateWithTime(this._getEffectiveStartTime(b));

                if (!dateA && !dateB) return 0;
                if (!dateA) return 1;
                if (!dateB) return -1;

                return dateA - dateB; // מיון עולה - שעה מוקדמת קודם
            });

            // ==========================================
            // צבעים
            // ==========================================
            const C = {
                headerBg: '320F5B',
                headerFont: 'FFFFFF',
                subHeaderBg: '667eea',
                subHeaderFont: 'FFFFFF',
                altRowBg: 'F0F4FF',   // כחול בהיר לשורות זוגיות
                borderColor: 'D0D5DD',
                numberFont: '667eea',
                todayBg: 'FFF8E1',
                statusYellow: 'ED7D31',   // צהוב כהה לקריאות
                statusGreen: '1D6F42',
                statusRed: 'DC2626',
            };

            // ==========================================
            // פונקציות עזר
            // ==========================================
            const thinBorder = () => ({
                top: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                bottom: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                left: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                right: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            });

            const applyStyle = (cell, {
                bgColor = null,
                fontColor = '000000',
                bold = false,
                hAlign = 'center',
                fontSize = 11,
                wrapText = false,
                italic = false,
            } = {}) => {
                cell.font = {
                    name: 'Ariel',
                    size: fontSize,
                    bold,
                    italic,
                    color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign,
                    vertical: 'middle',
                    wrapText,
                    readingOrder: 'rightToLeft',
                };
                cell.border = thinBorder();
                if (bgColor) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            // ==========================================
            // יצירת Workbook
            // ==========================================
            const wb = new ExcelJS.Workbook();
            wb.creator = 'NOC Portal';
            wb.created = new Date();
            wb.modified = new Date();

            const wsName = sheetTitle
                .replace(/[*?:\\/\[\]]/g, '-')  // החלף תווים אסורים במקף
                .substring(0, 31);              // מקסימום 31 תווים

            const ws = wb.addWorksheet(wsName, {
                views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
                properties: { defaultRowHeight: 18 },
            });

            // ==========================================
            // שורה 1 - כותרת ראשית ממוזגת
            // ==========================================
            ws.mergeCells('A1:G1');
            const titleCell = ws.getCell('A1');
            titleCell.value = sheetTitle;
            applyStyle(titleCell, {
                bgColor: C.headerBg,
                fontColor: C.headerFont,
                bold: true,
                hAlign: 'center',
                fontSize: 14,
            });
            ws.getRow(1).height = 30;

            // ==========================================
            // שורה 2 - כותרות עמודות
            // ==========================================
            const headers = [
                'תאריך', 'מספר שינוי', 'שם השינוי',
                'תאריך השינוי', 'מציגים', 'הערות', 'סטטוס'
            ];

            const colWidths = [14, 18, 42, 22, 22, 32, 16];

            headers.forEach((h, i) => {
                const cell = ws.getCell(2, i + 1);
                cell.value = h;
                applyStyle(cell, {
                    bgColor: C.subHeaderBg,
                    fontColor: C.subHeaderFont,
                    bold: true,
                    hAlign: 'center',
                    fontSize: 11,
                });
                ws.getColumn(i + 1).width = colWidths[i];
            });
            ws.getRow(2).height = 22;

            // ==========================================
            // שורות נתונים - מתחיל משורה 3
            // ==========================================
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let excelRow = 3;
            let isAlt = false;

            changesToExport.forEach(c => {
                // *** פורמט תאריך ***

                var actualStartTime = (c.actualStartTime || '').trim();
                if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                    actualStartTime = this._normalizeActualDate(c.actualStartTime)
                } else {
                    actualStartTime = c.plannedStartTime || c.date
                }
                const dateObj = this.parseDateStringExport(actualStartTime);
                const formattedDate = dateObj
                    ? `${String(dateObj.getDate()).padStart(2, '0')}/${String(dateObj.getMonth() + 1).padStart(2, '0')}/${dateObj.getFullYear()}`
                    : '';

                // *** האם היום? ***
                const isToday = dateObj
                    ? dateObj.setHours(0, 0, 0, 0) === today.getTime()
                    : false;

                const rowBg = isToday
                    ? C.todayBg
                    : (isAlt ? C.altRowBg : null);

                // ערך ברירת מחדל "טרם הוצג" לייצוא CAB, ריק לשאר
                const presentationStatus = exportType === 'cab'
                    ? 'טרם הוצג'
                    : this.mapStatus(c.status) || '';

                const rowData = [
                    exportType === 'cab' ? cabDateDisplay : formattedDate,
                    c.number || '',
                    c.name || '',
                    c.date || '',
                    this.cleanPresenters(c.presenters),
                    (c.notes && c.notes.trim() !== '') ? c.notes : (c.system || ''),
                    presentationStatus,
                ];

                rowData.forEach((val, colIdx) => {
                    const cell = ws.getCell(excelRow, colIdx + 1);
                    cell.value = val;

                    // *** סגנון בסיסי - הכל ממורכז ***
                    applyStyle(cell, {
                        bgColor: rowBg,
                        hAlign: 'center',      // *** תמיד מרכז ***
                        wrapText: colIdx === 2 || colIdx === 5,
                        fontSize: 10,
                    });

                    // *** מספר שינוי - כחול + מודגש ***
                    if (colIdx === 1 && val) {
                        cell.font = {
                            name: 'Ariel',
                            size: 11,
                            bold: true,
                            color: { argb: 'FF' + C.numberFont },
                        };
                    }

                    // *** תאריך השינוי - עמודה 4 (index 3) - כולל שעה כפי שמגיע ***
                    if (colIdx === 6 && val) {
                        let statusColor = C.statusYellow; // ברירת מחדל - צהוב

                        if (val.includes('טרם') || val.includes('ממתין')) {
                            statusColor = C.statusYellow;
                        } else if (val.includes('אושר') || val.includes('הושלם')) {
                            statusColor = C.statusGreen;
                        } else if (val.includes('בוטל') || val.includes('נדחה') || val.includes('לבטל')) {
                            statusColor = C.statusRed;
                        }

                        cell.font = {
                            name: 'Ariel',
                            size: 11,
                            bold: true,
                            color: { argb: 'FF' + statusColor },
                        };
                    }
                });

                ws.getRow(excelRow).height = 17;
                isAlt = !isAlt;
                excelRow++;
            });

            // ==========================================
            // הורד את הקובץ
            // ==========================================
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, fileName);

        } catch (error) {
            console.error('שגיאה בייצוא:', error);
            alert('שגיאה בייצוא לאקסל: ' + error.message);
        }
    }

    // -------------------------------------------------------
    // *** עזר: נרמול תאריך אמריקאי mm/dd/yyyy → dd/mm/yyyy ***
    // -------------------------------------------------------
    _normalizeActualDate(dateStr) {
        if (!dateStr) return '';

        const d = new Date(dateStr);

        if (isNaN(d.getTime())) {
            return dateStr;
        }

        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();

        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');

        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    // -------------------------------------------------------
    // *** חדש: קבל תאריך התחלה אפקטיבי - בפועל אם קיים ***
    // -------------------------------------------------------
    _getEffectiveStartTime(change) {
        const actual = (change.actualStartTime || '').trim();
        if (actual && actual.toLowerCase() !== 'none' && actual !== '') {
            return this._normalizeActualDate(actual); // *** נרמל פורמט ***
        }
        return change.plannedStartTime || change.date || '';
    }

    // *** חדש: קבל תאריך סיום אפקטיבי - בפועל אם קיים ***
    _getEffectiveEndTime(change) {
        const actual = (change.actualEndTime || '').trim();
        if (actual && actual.toLowerCase() !== 'none' && actual !== '') {
            return this._normalizeActualDate(actual); // *** נרמל פורמט ***
        }
        return change.plannedEndTime || '';
    }

    // -------------------------------------------------------
    // המרת Date object ל-yyyy-mm-dd (ISO) לשימוש בסינון
    // -------------------------------------------------------
    toIsoDateString(dateObj) {
        if (!dateObj || isNaN(dateObj.getTime())) return null;
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // -------------------------------------------------------
    // המרת כל פורמט תאריך ל-Date object תקני
    // מחזיר: Mon Jul 06 2026 12:00:00 GMT+0300
    // -------------------------------------------------------
    parseToDate(str) {

        if (!str) return null;

        const [month, day, year] = str.split('/').map(Number);

        return new Date(year, month - 1, day, 12, 0, 0);

    }

    parseDateStringExport(dateStr) {
        if (!dateStr) return null;

        const [datePart, timePart = "00:00"] = dateStr.split(" ");

        const [day, month, year] = datePart.split("/").map(Number);
        const [hour, minute] = timePart.split(":").map(Number);

        return new Date(year, month - 1, day, hour, minute);
    }

    // *** עזר: פרסור תאריך ***
    parseDateString(dateString) {
        if (!dateString) return null;
        try {
            // *** נקה רווחים מיותרים ***
            const str = dateString.trim();

            // *** פורמט 1: yyyy-mm-dd HH:MM:SS או yyyy-mm-dd HH:MM ***
            // דוגמה: "2025-01-01 16:00:00" / "2025-01-01 16:00"
            const isoFull = str.match(
                /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/
            );
            if (isoFull) {
                const year = parseInt(isoFull[1], 10);
                const month = parseInt(isoFull[2], 10) - 1;
                const day = parseInt(isoFull[3], 10);
                const d = new Date(year, month, day, 12, 0, 0);
                return isNaN(d.getTime()) ? null : d;
            }

            // *** פורמט 2: dd/mm/yyyy HH:MM או dd/mm/yyyy ***
            // דוגמה: "01/06/2026 13:56" / "01/06/2026"
            const dmyFull = str.match(
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/
            );
            if (dmyFull) {
                const day = parseInt(dmyFull[1], 10);
                const month = parseInt(dmyFull[2], 10) - 1;
                const year = parseInt(dmyFull[3], 10);
                const d = new Date(year, month, day, 12, 0, 0);
                return isNaN(d.getTime()) ? null : d;
            }

            // *** פורמט 3: dd/mm/yy (שנה 2 ספרות) ***
            // דוגמה: "01/06/26"
            const dmyShort = str.match(
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/
            );
            if (dmyShort) {
                const day = parseInt(dmyShort[1], 10);
                const month = parseInt(dmyShort[2], 10) - 1;
                const year = parseInt(dmyShort[3], 10) + 2000;
                const d = new Date(year, month, day, 12, 0, 0);
                return isNaN(d.getTime()) ? null : d;
            }

            // *** fallback: Date() המובנה ***
            const cleanedAmp = str.replace(/\s*&\s*/g, ' ').trim();
            if (cleanedAmp !== str) {
                const dAmp = new Date(cleanedAmp);
                if (!isNaN(dAmp.getTime())) {
                    return new Date(
                        dAmp.getFullYear(), dAmp.getMonth(), dAmp.getDate(), 12, 0, 0
                    );
                }
            }

            // *** fallback: Date() המובנה ***
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
                return new Date(
                    d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0
                );
            }

            return null;

        } catch { return null; }
    }

    setupExportButtons() {
        const exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.showExportDialog());
        }
    }

    async showExportDialog() {
        // *** שליפת טווח CAB מהשרת ***
        let cabRangeText = '';
        try {
            const rangeRes = await fetch('/Changes/GetCabDateRange');
            const rangeData = await rangeRes.json();
            if (rangeData.success) {
                cabRangeText = `(${rangeData.from} עד ${rangeData.to})`;
            }
        } catch { }

        // *** הסרת דיאלוג קיים אם יש ***
        const existing = document.getElementById('exportDialog');
        if (existing) existing.remove();

        // *** תאריך ברירת מחדל: חודש אחורה עד היום ***
        const today = new Date();
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        // *** פורמט dd/mm/yyyy ***
        const formatForInput = (d) =>
            `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        const dialog = document.createElement('div');
        dialog.id = 'exportDialog';
        dialog.innerHTML = `
        <div class="popup-overlay" id="exportOverlay"></div>
        <div class="popup-content export-dialog-content">
            <div class="popup-header">
                <h3>ייצוא לאקסל</h3>
                <button class="popup-close" id="exportDialogClose">✕</button>
            </div>
            <div class="popup-body">
                <p>בחר סוג ייצוא:</p>
                <div class="export-options">

                    <button class="export-option-btn" id="exportAllOption">
                        <i class="fas fa-table"></i>
                        <span class="export-option-title">ייצוא הכל</span>
                        <span class="export-option-desc">כל השינויים במערכת</span>
                    </button>

                    <button class="export-option-btn" id="exportRangeOption">
                        <i class="fas fa-calendar-alt"></i>
                        <span class="export-option-title">ייצוא לפי טווח תאריכים</span>
                        <span class="export-option-desc">בחר תאריך התחלה וסיום</span>
                    </button>

                    <button class="export-option-btn" id="exportCabOption">
                        <i class="fas fa-calendar-week"></i>
                        <span class="export-option-title">CAB קרוב</span>
                        <span class="export-option-desc">${cabRangeText}</span>
                    </button>

                </div>

                <!-- *** אזור בחירת טווח - מוסתר בהתחלה *** -->
                <div id="dateRangeSection" style="display:none; margin-top:16px;">
                    <div class="date-range-container">
                        <div class="date-range-field">
                            <label for="exportFromDate">מתאריך:</label>
                            <div class="date-input-wrapper">
                                <input type="text"
                                    id="exportFromDate"
                                    class="date-text-input"
                                    value="${formatForInput(monthAgo)}"
                                    placeholder="dd/mm/yyyy"
                                    maxlength="10" />
                                <i class="fas fa-calendar-alt date-input-icon"></i>
                            </div>
                        </div>
                        <div class="date-range-field">
                            <label for="exportToDate">עד תאריך:</label>
                            <div class="date-input-wrapper">
                                <input type="text"
                                    id="exportToDate"
                                    class="date-text-input"
                                    value="${formatForInput(today)}"
                                    placeholder="dd/mm/yyyy"
                                    maxlength="10" />
                                <i class="fas fa-calendar-alt date-input-icon"></i>
                            </div>
                        </div>
                    </div>
                    <div style="text-align:center; margin-top:12px;">
                        <button class="export-confirm-btn" id="exportRangeConfirm">
                            <i class="fas fa-file-excel"></i>
                            ייצא טווח נבחר
                        </button>
                    </div>
                    <div id="exportRangeError" 
                         style="color:#dc2626; text-align:center; 
                                margin-top:8px; display:none; font-size:13px;">
                    </div>
                </div>

            </div>
        </div>
    `;

        document.body.appendChild(dialog);

        // *** מסכה אוטומטית לשדות תאריך dd/mm/yyyy ***
        const initDatePicker = (inputId) => {
            const input = document.getElementById(inputId);
            if (!input) return;

            // אם Flatpickr זמין - השתמש בו
            if (typeof flatpickr !== 'undefined') {
                flatpickr(input, {
                    dateFormat: 'd/m/Y',        // פורמט dd/mm/yyyy
                    locale: 'he',               // עברית אם זמין
                    allowInput: true,           // מאפשר הקלדה ידנית גם
                    disableMobile: false,
                    onChange: function (selectedDates, dateStr) {
                        input.value = dateStr;
                    }
                });
            } else {
                // fallback - המסכה הידנית הקיימת
                applyDateMask(inputId);
            }
        };

        initDatePicker('exportFromDate');
        initDatePicker('exportToDate');

        const close = () => dialog.remove();

        document.getElementById('exportDialogClose').addEventListener('click', close);
        document.getElementById('exportOverlay').addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        }, { once: true });

        // *** ייצוא הכל - ללא סינון תאריכים ***
        document.getElementById('exportAllOption').addEventListener('click', () => {
            close();
            this.downloadExport('all');
        });

        // *** ייצוא לפי טווח - הצג שדות תאריך ***
        document.getElementById('exportRangeOption').addEventListener('click', () => {
            // הדגש כפתור נבחר
            document.querySelectorAll('#exportDialog .export-option-btn')
                .forEach(b => b.classList.remove('selected'));
            document.getElementById('exportRangeOption').classList.add('selected');

            // הצג אזור תאריכים
            document.getElementById('dateRangeSection').style.display = 'block';
        });

        // *** אישור ייצוא טווח ***
        // *** פונקציית עזר: המרת dd/mm/yyyy ל-Date object ***
        const parseDdMmYyyy = (str) => {
            if (!str || str.length !== 10) return null;
            const parts = str.split('/');
            if (parts.length !== 3) return null;
            const day = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const year = parseInt(parts[2], 10);
            if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
            if (day < 1 || day > 31) return null;
            if (month < 0 || month > 11) return null;
            if (year < 2000 || year > 2100) return null;
            const d = new Date(year, month, day);
            // *** ולידציה שהתאריך תקין (למשל לא 31/02) ***
            if (d.getDate() !== day || d.getMonth() !== month) return null;
            return d;
        };

        document.getElementById('exportRangeConfirm').addEventListener('click', () => {
            const fromVal = document.getElementById('exportFromDate').value;
            const toVal = document.getElementById('exportToDate').value;
            const errEl = document.getElementById('exportRangeError');

            // *** ולידציה ***
            if (!fromVal || !toVal) {
                errEl.textContent = 'יש לבחור תאריך התחלה וסיום';
                errEl.style.display = 'block';
                return;
            }

            const fromDate = parseDdMmYyyy(fromVal);
            const toDate = parseDdMmYyyy(toVal);

            if (!fromDate) {
                errEl.textContent = 'תאריך ההתחלה אינו תקין (dd/mm/yyyy)';
                errEl.style.display = 'block';
                return;
            }

            if (!toDate) {
                errEl.textContent = 'תאריך הסיום אינו תקין (dd/mm/yyyy)';
                errEl.style.display = 'block';
                return;
            }

            if (fromDate > toDate) {
                errEl.textContent = 'תאריך ההתחלה חייב להיות לפני תאריך הסיום';
                errEl.style.display = 'block';
                return;
            }

            errEl.style.display = 'none';
            close();

            // *** המרה ל-yyyy-mm-dd לשימוש פנימי בסינון ***
            const toIso = (d) =>
                `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

            this.downloadExport('range', {
                from: toIso(fromDate),
                to: toIso(toDate),
                fromDisplay: fromVal,   // *** לתצוגה בשם הקובץ והכותרת ***
                toDisplay: toVal
            });
        });

        // *** CAB ***
        document.getElementById('exportCabOption').addEventListener('click', () => {
            close();
            this.downloadExport('cab');
        });
    }

    // -------------------------------------------------------
    // החלפת תצוגה
    // -------------------------------------------------------
    setupViewToggle() {
        document.querySelectorAll('.view-toggle-btn').forEach(button => {
            button.addEventListener('click', () => {
                const view = button.getAttribute('data-view');
                this.currentView = view;

                document.querySelectorAll('.view-toggle-btn')
                    .forEach(b => b.classList.remove('active'));
                button.classList.add('active');

                // הצגת/הסתרת שורת חיפוש
                const searchBar = document.getElementById('changesSearchBar');
                if (searchBar) {
                    searchBar.style.display = view === 'table' ? 'flex' : 'none';
                }

                this.loadCurrentView();
            });
        });
    }

    // -------------------------------------------------------
    // ייבוא מהמערכת הישנה
    // -------------------------------------------------------
    setupImportOldSystem() {
        const importBtn = document.getElementById('importOldSystemBtn');
        if (!importBtn) return;

        importBtn.addEventListener('click', async () => {
            if (!confirm('לייבא שינויים מהמערכת הישנה (ONIT)?')) return;

            importBtn.disabled = true;
            importBtn.textContent = 'מייבא...';

            try {
                const response = await fetch('/Changes/ImportOldSystemChanges', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await response.json();

                if (data.success) {
                    alert(`✅ ${data.message}`);
                    this.loadCurrentView();
                } else {
                    alert(`❌ שגיאה: ${data.message}`);
                }
            } catch (error) {
                alert(`❌ שגיאת תקשורת: ${error.message}`);
            } finally {
                importBtn.disabled = false;
                importBtn.textContent = 'ייבא שינויים ישנים (ONIT)';
            }
        });
    }

    // -------------------------------------------------------
    // פופאפ פרטי שינוי
    // -------------------------------------------------------
    showChangePopup(change) {
        const existing = document.getElementById('changePopup');
        if (existing) existing.remove();

        // *** תיקון: בניית קישור לשינוי חדש לפי מספר השינוי אם אין קישור ישיר ***
        const changeLink = change.link
            ? change.link
            : (change.source === 'NEW'
                ? ""
                : null);

        const popup = document.createElement('div');
        popup.id = 'changePopup';
        popup.innerHTML = `
        <div class="popup-overlay" id="popupOverlay"></div>
        <div class="popup-content">
            <div class="popup-header">
                <h3>פרטי שינוי - ${change.number}</h3>
                <div style="display:flex;align-items:center;gap:8px;">
                    <button class="popup-close" id="popupClose">✕</button>
                </div>
            </div>
            <div class="popup-body">
                <div class="popup-row">
                    <span class="popup-label">מספר שינוי:</span>
                    <span class="popup-value">${change.number || ''}</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">שם השינוי:</span>
                    <span class="popup-value">${change.name || ''}</span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">תאריך:</span>
                    <span class="popup-value">
                        ${this.formatDateForDisplay(
            this._getEffectiveStartTime(change)
        )}
                    </span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">סטטוס:</span>
                    <span class="popup-value">
                       ${this.mapStatus(change.status) || 'לא צוין'}
                    </span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">מציגים:</span>
                    <span class="popup-value">
                        ${this.cleanPresenters(change.presenters) || 'לא צוין'}
                    </span>
                </div>
                <div class="popup-row">
                    <span class="popup-label">הערות:</span>
                    <span class="popup-value popup-notes">
                        ${change.notes && change.notes.trim() !== ''
                ? change.notes
                : (change.system && change.system.trim() !== ''
                    ? change.system
                    : 'אין הערות')}
                    </span>
                </div>
                ${changeLink ? `
                <div class="popup-row">
                    <span class="popup-label">קישור לבקשה:</span>
                    <span class="popup-value">
                        <a href="${changeLink}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="popup-link"
                        onclick="event.stopPropagation()">
                            פתח קישור ↗
                        </a>
                    </span>
                </div>` : ''}
                <div class="popup-footer">
                    <button class="popup-export-cal-btn" id="popupExportCalBtn">
                        <i class="fas fa-calendar-plus"></i>
                        <span>הוסף ליומן</span>
                    </button>
                </div>
            </div>
        </div>
    `;

        document.body.appendChild(popup);

        document.getElementById('popupExportCalBtn')
            ?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportChangeToCalendar(change);
            });

        const close = () => popup.remove();
        document.getElementById('popupClose').addEventListener('click', close);
        document.getElementById('popupOverlay').addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close();
        }, { once: true });
    }

    // -------------------------------------------------------
    // מיפוי סטטוסים מאנגלית לעברית
    // -------------------------------------------------------
    mapStatus(status) {
        if (!status) return '';
        const map = {
            'Draft': 'טיוטה',
            'Request For Authorization': 'לאישור מנהל',
            'Request For Change': 'ממתין לאישור',
            'Planning In Progress': 'בתכנון',
            'Scheduled For Review': 'בבדיקה',
            'Scheduled For Approval': 'לאישור CAB',
            'Scheduled for Approval': 'לאישור CAB',
            'Scheduled': 'אושר',
            'Implementation In Progress': 'בביצוע',
            'Completed': 'בוצע',
            'Closed': 'בוצע',
        };
        return map[status] ?? status;
    }

    // -------------------------------------------------------
    // ניקוי סיומת [עובד מנורה] משמות מציגים
    // -------------------------------------------------------
    cleanPresenters(presenters) {
        if (!presenters) return '';
        // מסיר את הסיומת [עובד מנורה] מכל שם (כולל רווחים לפניה)
        return presenters
            .replace(/\s*\[עובד מנורה\]/g, '')
            .trim();
    }

    // -------------------------------------------------------
    // ייצוא שינוי ליומן
    // -------------------------------------------------------
    // ✅ קוד נכון
    exportChangeToCalendar(change) {
        const start = this.parseDateWithTime(
            this._getEffectiveStartTime(change)
        );
        const end = this.parseDateWithTime(
            this._getEffectiveEndTime(change)
        ) || start;

        if (!start) {
            alert('לא נמצא תאריך לשינוי זה');
            return;
        }

        const pad = n => String(n).padStart(2, '0');
        // בדוק גם actualStartTime/EndTime לקביעת hasTime
        const hasTime = !!(
            change.actualStartTime || change.actualEndTime ||
            change.plannedStartTime || change.plannedEndTime
        );

        const fmtICS = (d, withTime) => {
            const y = d.getFullYear();
            const mo = pad(d.getMonth() + 1);
            const dy = pad(d.getDate());
            if (!withTime) return `${y}${mo}${dy}`;
            const h = pad(d.getHours());
            const mi = pad(d.getMinutes());
            return `${y}${mo}${dy}T${h}${mi}00`;
        };

        const fmtOutlook = (d) => {
            const y = d.getFullYear();
            const mo = pad(d.getMonth() + 1);
            const dy = pad(d.getDate());
            const h = pad(d.getHours());
            const mi = pad(d.getMinutes());
            return `${y}-${mo}-${dy}T${h}:${mi}:00`;
        };

        const esc = s => (s || '')
            .replace(/\n/g, '\\n')
            .replace(/,/g, '\\,');

        const bodyParts = [
            change.presenters ? `אחראי: ${this.cleanPresenters(change.presenters)}` : '',
            change.name ? `שם שינוי: ${change.name}` : '',
            change.status ? `סטטוס: ${this.mapStatus(change.status)}` : '',
            change.system ? `מערכת: ${change.system}` : '',
            change.executingTeam ? `צוות מבצע: ${change.executingTeam}` : '',
            change.date ? `תאריך: ${change.date}` : '',
            change.needCab ? `CAB: ${change.needCab}` : '',
            change.cabDate ? `תאריך CAB: ${change.cabDate}` : '',
            change.description ? `תיאור: ${change.description}` : '',
            change.number ? `מספר שינוי: ${change.number}` : '',
            change.link ? `קישור: ${change.link}` : ''
        ].filter(Boolean);

        this._showChangeCalendarChoiceModal({
            change, start, end, hasTime,
            fmtICS, fmtOutlook, esc, bodyParts,
        });
    }

    // -------------------------------------------------------
    // פרסור תאריך + שעה
    // -------------------------------------------------------
    parseDateWithTime(str) {
        if (!str) return null;
        try {
            const s = String(str).trim();

            // yyyy-mm-dd HH:MM:SS  או  yyyy-mm-dd HH:MM
            const iso = s.match(
                /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
            );
            if (iso) {
                const h = iso[4] ? parseInt(iso[4]) : 0;
                const mi = iso[5] ? parseInt(iso[5]) : 0;
                const se = iso[6] ? parseInt(iso[6]) : 0;
                const d = new Date(
                    parseInt(iso[1]),
                    parseInt(iso[2]) - 1,
                    parseInt(iso[3]),
                    h, mi, se
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // dd/mm/yyyy HH:MM  או  dd/mm/yyyy
            const dmy = s.match(
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
            );
            if (dmy) {
                const h = dmy[4] ? parseInt(dmy[4]) : 0;
                const mi = dmy[5] ? parseInt(dmy[5]) : 0;
                const se = dmy[6] ? parseInt(dmy[6]) : 0;
                const d = new Date(
                    parseInt(dmy[3]),
                    parseInt(dmy[2]) - 1,
                    parseInt(dmy[1]),
                    h, mi, se
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // פורמט אנגלי עם &
            const cleaned = s.replace(/\s*&\s*/g, ' ').trim();
            const d = new Date(cleaned);
            if (!isNaN(d.getTime())) return d;

            return null;
        } catch { return null; }
    }

    // -------------------------------------------------------
    // שליחת הזמנת פגישה במייל (EML עם ICS מצורף)
    // -------------------------------------------------------
    _sendCalendarInviteEmail(change, start, end, hasTime, bodyParts) {
        const statusDiv = document.getElementById('cmCalChoiceStatus');

        try {
            if (statusDiv) {
                statusDiv.style.display = 'flex';
                statusDiv.style.color = '#a78bfa';
                statusDiv.innerHTML =
                    '<i class="fas fa-spinner fa-spin"></i> מכין הזמנה...';
            }

            const pad = n => String(n).padStart(2, '0');

            // ── פורמט תאריכים ──────────────────────────────────
            const fmtICS = (d, withTime) => {
                const y = d.getFullYear();
                const mo = pad(d.getMonth() + 1);
                const dy = pad(d.getDate());
                if (!withTime) return `${y}${mo}${dy}`;
                const h = pad(d.getHours());
                const mi = pad(d.getMinutes());
                return `${y}${mo}${dy}T${h}${mi}00`;
            };

            const esc = s => (s || '')
                .replace(/\n/g, '\\n')
                .replace(/,/g, '\\,');

            const dtStart = fmtICS(start, hasTime);
            const dtEnd = fmtICS(end, hasTime);
            const dtStamp = fmtICS(new Date(), true);

            // ── נושא המייל ──────────────────────────────────────
            const subject =
                `[${change.number}] ${change.name || 'שינוי מתוכנן'}`;

            // ── תוכן ICS ────────────────────────────────────────
            const icsLines = [
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//NOC Portal//IL',
                'CALSCALE:GREGORIAN',
                'METHOD:REQUEST',          // ← REQUEST = הזמנת פגישה
                'BEGIN:VEVENT',
                `UID:${change.number}-${Date.now()}@noc-portal`,
                `DTSTAMP:${dtStamp}`,
                hasTime
                    ? `DTSTART:${dtStart}`
                    : `DTSTART;VALUE=DATE:${dtStart}`,
                hasTime
                    ? `DTEND:${dtEnd}`
                    : `DTEND;VALUE=DATE:${dtEnd}`,
                `SUMMARY:${esc(subject)}`,
                `DESCRIPTION:${esc(bodyParts.join('\\n'))}`,
                `CATEGORIES:${esc(change.changeCategory || 'Change')}`,
                `ORGANIZER:mailto:noc@menoramivt.co.il`,
                'STATUS:CONFIRMED',
                'TRANSP:OPAQUE',
                'BEGIN:VALARM',
                'TRIGGER:-PT30M',
                'ACTION:DISPLAY',
                `DESCRIPTION:תזכורת: ${esc(change.number)}`,
                'END:VALARM',
                'END:VEVENT',
                'END:VCALENDAR',
            ].join('\r\n');

            // ── גוף HTML של המייל ───────────────────────────────
            const startDisplay = this.formatDateForDisplay(
                this._getEffectiveStartTime(change)
            );
            const endDisplay = this._getEffectiveEndTime(change)
                ? this.formatDateForDisplay(this._getEffectiveEndTime(change))
                : '';

            const htmlBody = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif; direction:rtl;
             font-size:11pt; color:#000; margin:20px;">

<p>שלום,</p>
<p>מצורפת הזמנה לפגישת CAB עבור השינוי הבא:</p>

<table border="1" cellpadding="6" cellspacing="0"
       style="border-collapse:collapse; width:100%; max-width:600px;
              font-size:10pt; direction:rtl;">
    <tr style="background:#dce6f1;">
        <th style="text-align:right; padding:7px 10px; font-weight:bold;">
            שדה
        </th>
        <th style="text-align:right; padding:7px 10px; font-weight:bold;">
            ערך
        </th>
    </tr>
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            מספר שינוי
        </td>
        <td style="padding:6px 10px; color:#1f3864; font-weight:bold;">
            ${change.number || ''}
        </td>
    </tr>
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            שם השינוי
        </td>
        <td style="padding:6px 10px;">
            ${change.name || ''}
        </td>
    </tr>
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            תאריך התחלה
        </td>
        <td style="padding:6px 10px;">
            ${startDisplay}
        </td>
    </tr>
    ${endDisplay ? `
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            תאריך סיום
        </td>
        <td style="padding:6px 10px;">
            ${endDisplay}
        </td>
    </tr>` : ''}
    ${change.presenters ? `
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            אחראי
        </td>
        <td style="padding:6px 10px; color:#4274d6; font-weight:bold;">
            ${this.cleanPresenters(change.presenters)}
        </td>
    </tr>` : ''}
    ${change.executingTeam ? `
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            צוות מבצע
        </td>
        <td style="padding:6px 10px;">
            ${change.executingTeam}
        </td>
    </tr>` : ''}
    ${change.system ? `
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            מערכת
        </td>
        <td style="padding:6px 10px;">
            ${change.system}
        </td>
    </tr>` : ''}
    ${change.status ? `
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            סטטוס
        </td>
        <td style="padding:6px 10px;">
            ${this.mapStatus(change.status)}
        </td>
    </tr>` : ''}
    ${change.link ? `
    <tr>
        <td style="padding:6px 10px; font-weight:bold; background:#f5f5f5;">
            קישור
        </td>
        <td style="padding:6px 10px;">
            <a href="${change.link}" style="color:#0078d4;">
                פתח קישור לשינוי
            </a>
        </td>
    </tr>` : ''}
</table>

<br>
<p style="color:#666; font-size:9pt;">
    מייל זה נשלח אוטומטית ממערכת NOC Portal
</p>

</body>
</html>`;

            // ── קידוד Base64 ─────────────────────────────────────
            const encodeB64 = str =>
                btoa(unescape(encodeURIComponent(str)));

            const encodedSubject =
                `=?UTF-8?B?${encodeB64(subject)}?=`;

            const htmlBase64 = encodeB64(htmlBody);
            const icsBase64 = encodeB64(icsLines);
            const boundary = `noc_cal_${Date.now()}`;
            const icsFileName =
                `${change.number || 'change'}.ics`
                    .replace(/[^a-zA-Z0-9._-]/g, '_');

            // ── בניית EML ────────────────────────────────────────
            const emlContent = [
                `Subject: ${encodedSubject}`,
                `MIME-Version: 1.0`,
                `Content-Type: multipart/mixed; boundary="${boundary}"`,
                `X-Mailer: NOC Portal`,
                `X-Unsent: 1`,
                ``,
                `--${boundary}`,
                `Content-Type: multipart/alternative; boundary="${boundary}_alt"`,
                ``,
                `--${boundary}_alt`,
                `Content-Type: text/html; charset=UTF-8`,
                `Content-Transfer-Encoding: base64`,
                ``,
                htmlBase64,
                ``,
                `--${boundary}_alt`,
                `Content-Type: text/calendar; charset=UTF-8; method=REQUEST`,
                `Content-Transfer-Encoding: base64`,
                ``,
                icsBase64,
                ``,
                `--${boundary}_alt--`,
                ``,
                `--${boundary}`,
                `Content-Type: application/ics; name="${icsFileName}"`,
                `Content-Transfer-Encoding: base64`,
                `Content-Disposition: attachment; filename="${icsFileName}"`,
                ``,
                icsBase64,
                ``,
                `--${boundary}--`,
            ].join('\r\n');

            // ── הורד EML ─────────────────────────────────────────
            const blob = new Blob([emlContent], { type: 'message/rfc822' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${change.number || 'change'}_invite.eml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            // ── הצג הצלחה ────────────────────────────────────────
            if (statusDiv) {
                statusDiv.style.color = '#4ade80';
                statusDiv.innerHTML =
                    '<i class="fas fa-check-circle"></i> ' +
                    'קובץ הזמנה הורד — פתח אותו כדי לשלוח';
            }

            // סגור מודל אחרי 2 שניות
            setTimeout(() => {
                document.getElementById('cmCalendarChoiceModal')?.remove();
            }, 2000);

        } catch (err) {
            console.error('[CalendarInvite] שגיאה:', err);
            if (statusDiv) {
                statusDiv.style.color = '#f87171';
                statusDiv.innerHTML =
                    `<i class="fas fa-exclamation-triangle"></i> שגיאה: ${err.message}`;
            }
        }
    }

    // -------------------------------------------------------
    // מודל בחירת יומן - Outlook Web / ICS
    // -------------------------------------------------------
    // -------------------------------------------------------
    // מודל בחירת יומן - Outlook Web / ICS / מייל
    // -------------------------------------------------------
    async _showChangeCalendarChoiceModal({
        change, start, end, hasTime,
        fmtICS, fmtOutlook, esc, bodyParts
    }) {
        // הסר מודל קיים
        document.getElementById('cmCalendarChoiceModal')?.remove();

        const escHtml = s => String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // *** טען מייל המשתמש המחובר ***
        let currentUserEmail = '';
        let currentUserName = '';
        try {
            const res = await fetch('/Auth/GetCurrentUserEmail');
            const data = await res.json();
            if (data.success) {
                currentUserEmail = data.email || '';
                currentUserName = data.name || '';
            }
        } catch { /* המשך ללא מייל */ }

        const modalHTML = `
    <div id="cmCalendarChoiceModal" style="
        position:fixed; top:0; left:0; width:100%; height:100%;
        background:rgba(0,0,0,0.65); z-index:99999;
        display:flex; align-items:center; justify-content:center;
        direction:rtl; backdrop-filter:blur(4px);
        animation: cdFadeInOverlay 0.2s ease;
    ">
        <div style="
            background:#1f2937; border:1px solid #374151;
            border-radius:16px; width:92%; max-width:440px;
            box-shadow:0 20px 60px rgba(0,0,0,0.5);
            overflow:hidden; direction:rtl;
            animation: cdPopupIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
        ">
            <!-- כותרת -->
            <div style="
                background:linear-gradient(135deg,#320F5B,#4c1d95,#6d28d9);
                color:white; padding:18px 22px;
                display:flex; justify-content:space-between;
                align-items:center;
            ">
                <div style="display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-calendar-plus"
                       style="font-size:1.3rem;"></i>
                    <div>
                        <div style="font-size:1rem; font-weight:700;">
                            הוסף ללוח שנה
                        </div>
                        <div style="
                            font-size:0.78rem; opacity:0.85; margin-top:2px;
                            max-width:260px; overflow:hidden;
                            text-overflow:ellipsis; white-space:nowrap;
                        ">
                            [${escHtml(change.number)}]
                            ${escHtml(change.name || '')}
                        </div>
                    </div>
                </div>
                <button
                    onclick="document.getElementById(
                        'cmCalendarChoiceModal').remove()"
                    style="
                        background:rgba(255,255,255,0.15);
                        border:1px solid rgba(255,255,255,0.25);
                        color:white; width:32px; height:32px;
                        border-radius:50%; cursor:pointer;
                        font-size:0.95rem; display:flex;
                        align-items:center; justify-content:center;
                        transition:all 0.2s;
                    "
                    onmouseover="this.style.background='rgba(239,68,68,0.3)'"
                    onmouseout="this.style.background='rgba(255,255,255,0.15)'"
                >✕</button>
            </div>

            <!-- פרטי אירוע -->
            <div style="
                padding:12px 22px; background:#111827;
                border-bottom:1px solid #374151;
                font-size:0.85rem; color:#9ca3af;
            ">
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <span style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-calendar"
                           style="color:#a78bfa;"></i>
                        ${escHtml(this.formatDateForDisplay(
            this._getEffectiveStartTime(change)
        ))}
                    </span>
                    ${this._getEffectiveEndTime(change) ? `
                    <span style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-flag-checkered"
                           style="color:#a78bfa;"></i>
                        ${escHtml(this.formatDateForDisplay(
            change.plannedEndTime
        ))}
                    </span>` : ''}
                    ${change.system ? `
                    <span style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-server"
                           style="color:#a78bfa;"></i>
                        ${escHtml(change.system)}
                    </span>` : ''}
                </div>
            </div>

            <!-- כפתורי בחירה -->
            <div style="padding:20px 22px;">
                <p style="
                    margin:0 0 14px 0; font-size:0.88rem;
                    color:#9ca3af; font-weight:600; text-align:center;
                ">
                    בחר כיצד להוסיף את האירוע ללוח השנה:
                </p>
                <div style="display:flex; flex-direction:column; gap:10px;">

                    <!-- ── שלח הזמנה במייל ── -->
                    <div>
                        <button
                            id="cmCalChoiceEmailBtn"
                            onclick="window._cmCalChoice('email_toggle')"
                            style="
                                display:flex; align-items:center; gap:14px;
                                padding:12px 16px; background:#1f2937;
                                border:2px solid #374151; border-radius:10px;
                                cursor:pointer; text-align:right;
                                transition:all 0.2s; width:100%; direction:rtl;
                            "
                            onmouseover="
                                this.style.borderColor='#7c3aed';
                                this.style.background='#1a1030';
                            "
                            onmouseout="
                                this.style.borderColor=
                                    document.getElementById('cmEmailInputSection')
                                        ?.style.display !== 'none'
                                    ? '#7c3aed' : '#374151';
                                this.style.background=
                                    document.getElementById('cmEmailInputSection')
                                        ?.style.display !== 'none'
                                    ? '#1a1030' : '#1f2937';
                            "
                        >
                            <div style="
                                width:38px; height:38px;
                                background:linear-gradient(
                                    135deg,#7c3aed,#8b5cf6);
                                border-radius:9px; display:flex;
                                align-items:center; justify-content:center;
                                flex-shrink:0;
                            ">
                                <i class="fas fa-envelope"
                                   style="color:white; font-size:1rem;"></i>
                            </div>
                            <div style="flex:1; text-align:right;">
                                <div style="
                                    font-weight:700; color:#f9fafb;
                                    font-size:0.9rem; margin-bottom:2px;
                                ">
                                    שלח הזמנה במייל
                                </div>
                                <div style="font-size:0.75rem; color:#6b7280;">
                                    שלח הזמנת פגישה אוטומטית לכתובת מייל
                                </div>
                            </div>
                            <i id="cmEmailToggleArrow"
                               class="fas fa-chevron-down"
                               style="
                                   color:#6b7280; font-size:0.8rem;
                                   transition:transform 0.2s;
                               "></i>
                        </button>

                        <!-- שדה מייל - מוסתר בהתחלה -->
                        <div id="cmEmailInputSection" style="
                            display:none;
                            background:#111827;
                            border:1px solid #374151;
                            border-top:none;
                            border-radius:0 0 10px 10px;
                            padding:14px 16px;
                            animation: cdSlideDown 0.2s ease;
                        ">
                            <label style="
                                font-size:11px; color:#9ca3af;
                                font-weight:700; display:block;
                                margin-bottom:7px;
                                text-transform:uppercase;
                                letter-spacing:0.5px;
                            ">
                                כתובת מייל לשליחה:
                            </label>
                            <div style="
                                display:flex; gap:8px; align-items:center;
                            ">
                                <input
                                    type="email"
                                    id="cmEmailInput"
                                    value="${escHtml(currentUserEmail)}"
                                    placeholder="example@company.com"
                                    style="
                                        flex:1;
                                        background:#1f2937;
                                        border:1.5px solid #374151;
                                        border-radius:8px; color:#e0e0e0;
                                        padding:8px 12px; font-size:13px;
                                        direction:ltr; text-align:left;
                                        transition:border-color 0.2s;
                                        outline:none;
                                    "
                                    onfocus="this.style.borderColor='#7c3aed';
                                             this.style.boxShadow=
                                             '0 0 0 2px rgba(124,58,237,0.15)'"
                                    onblur="this.style.borderColor='#374151';
                                            this.style.boxShadow='none'"
                                />
                                <button
                                    onclick="window._cmCalChoice('email_send')"
                                    style="
                                        padding:8px 16px;
                                        background:linear-gradient(
                                            135deg,#320F5B,#7c3aed);
                                        border:1px solid #7c3aed;
                                        border-radius:8px; color:#fff;
                                        font-size:12px; font-weight:700;
                                        cursor:pointer; white-space:nowrap;
                                        display:flex; align-items:center;
                                        gap:6px; transition:all 0.2s;
                                        box-shadow:0 2px 8px
                                            rgba(124,58,237,0.3);
                                    "
                                    onmouseover="
                                        this.style.background=
                                        'linear-gradient(135deg,#4a1a8c,#8b5cf6)';
                                        this.style.transform='translateY(-1px)';
                                    "
                                    onmouseout="
                                        this.style.background=
                                        'linear-gradient(135deg,#320F5B,#7c3aed)';
                                        this.style.transform='';
                                    "
                                >
                                    <i class="fas fa-paper-plane"></i>
                                    שלח
                                </button>
                            </div>

                            <!-- הצג מייל נוכחי אם קיים -->
                            ${currentUserEmail ? `
                            <div style="
                                margin-top:7px; font-size:11px;
                                color:#6b7280; display:flex;
                                align-items:center; gap:5px;
                            ">
                                <i class="fas fa-user-circle"
                                   style="color:#4b5563;"></i>
                                ממולא אוטומטית לפי המשתמש המחובר
                            </div>` : ''}
                        </div>
                    </div>

                    <!-- ── Outlook Web ── -->
                    <button
                        id="cmCalChoiceOutlookBtn"
                        onclick="window._cmCalChoice('outlook')"
                        style="
                            display:flex; align-items:center; gap:14px;
                            padding:12px 16px; background:#1f2937;
                            border:2px solid #374151; border-radius:10px;
                            cursor:pointer; text-align:right;
                            transition:all 0.2s; width:100%; direction:rtl;
                        "
                        onmouseover="
                            this.style.borderColor='#0078d4';
                            this.style.background='#0a1a2a';
                        "
                        onmouseout="
                            this.style.borderColor='#374151';
                            this.style.background='#1f2937';
                        "
                    >
                        <div style="
                            width:38px; height:38px;
                            background:linear-gradient(
                                135deg,#0078d4,#106ebe);
                            border-radius:9px; display:flex;
                            align-items:center; justify-content:center;
                            flex-shrink:0;
                        ">
                            <i class="fas fa-globe"
                               style="color:white; font-size:1rem;"></i>
                        </div>
                        <div style="flex:1; text-align:right;">
                            <div style="
                                font-weight:700; color:#f9fafb;
                                font-size:0.9rem; margin-bottom:2px;
                            ">
                                פתח ב-Outlook Web
                            </div>
                            <div style="font-size:0.75rem; color:#6b7280;">
                                יפתח בדפדפן עם הפרטים ממולאים
                            </div>
                        </div>
                        <i class="fas fa-chevron-left"
                           style="color:#4b5563; font-size:0.8rem;"></i>
                    </button>

                    <!-- ── הורד ICS ── -->
                    <button
                        onclick="window._cmCalChoice('ics')"
                        style="
                            display:flex; align-items:center; gap:14px;
                            padding:12px 16px; background:#1f2937;
                            border:2px solid #374151; border-radius:10px;
                            cursor:pointer; text-align:right;
                            transition:all 0.2s; width:100%; direction:rtl;
                        "
                        onmouseover="
                            this.style.borderColor='#22c55e';
                            this.style.background='#0a2a0a';
                        "
                        onmouseout="
                            this.style.borderColor='#374151';
                            this.style.background='#1f2937';
                        "
                    >
                        <div style="
                            width:38px; height:38px;
                            background:linear-gradient(
                                135deg,#16a34a,#22c55e);
                            border-radius:9px; display:flex;
                            align-items:center; justify-content:center;
                            flex-shrink:0;
                        ">
                            <i class="fas fa-download"
                               style="color:white; font-size:1rem;"></i>
                        </div>
                        <div style="flex:1; text-align:right;">
                            <div style="
                                font-weight:700; color:#f9fafb;
                                font-size:0.9rem; margin-bottom:2px;
                            ">
                                הורד קובץ ICS
                            </div>
                            <div style="font-size:0.75rem; color:#6b7280;">
                                תואם Outlook Desktop, Google Calendar ועוד
                            </div>
                        </div>
                        <i class="fas fa-chevron-left"
                           style="color:#4b5563; font-size:0.8rem;"></i>
                    </button>

                </div>
            </div>

            <!-- הודעת סטטוס -->
            <div id="cmCalChoiceStatus" style="
                display:none; padding:12px 22px; text-align:center;
                border-top:1px solid #374151; font-size:0.88rem;
                font-weight:600; gap:8px; align-items:center;
                justify-content:center;
            "></div>

        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // ── טפל בבחירה ──────────────────────────────────────────────────
        window._cmCalChoice = (choice) => {

            if (choice === 'email_toggle') {
                // *** פתח/סגור שדה מייל ***
                const section = document.getElementById('cmEmailInputSection');
                const arrow = document.getElementById('cmEmailToggleArrow');
                const btn = document.getElementById('cmCalChoiceEmailBtn');

                if (!section) return;

                const isOpen = section.style.display !== 'none';

                if (isOpen) {
                    section.style.display = 'none';
                    if (arrow) arrow.style.transform = '';
                    if (btn) {
                        btn.style.borderColor = '#374151';
                        btn.style.background = '#1f2937';
                        btn.style.borderRadius = '10px';
                    }
                } else {
                    section.style.display = 'block';
                    if (arrow) arrow.style.transform = 'rotate(180deg)';
                    if (btn) {
                        btn.style.borderColor = '#7c3aed';
                        btn.style.background = '#1a1030';
                        btn.style.borderRadius = '10px 10px 0 0';
                    }
                    // פוקוס על שדה המייל
                    setTimeout(() => {
                        const input = document.getElementById('cmEmailInput');
                        if (input) input.focus();
                    }, 100);
                }

            } else if (choice === 'email_send') {
                // *** שלח מייל דרך השרת ***
                const emailInput = document.getElementById('cmEmailInput');
                const email = emailInput?.value?.trim();

                if (!email || !email.includes('@')) {
                    if (emailInput) {
                        emailInput.style.borderColor = '#ef4444';
                        emailInput.style.boxShadow =
                            '0 0 0 2px rgba(239,68,68,0.2)';
                        emailInput.placeholder = 'יש להזין כתובת מייל תקינה';
                        setTimeout(() => {
                            emailInput.style.borderColor = '#374151';
                            emailInput.style.boxShadow = 'none';
                        }, 2000);
                    }
                    return;
                }

                this._sendCalendarInviteViaServer(change, email);

            } else if (choice === 'outlook') {
                const statusDiv = document.getElementById('cmCalChoiceStatus');
                const outlookBtn = document.getElementById('cmCalChoiceOutlookBtn');

                if (statusDiv) {
                    statusDiv.style.display = 'flex';
                    statusDiv.style.color = '#a78bfa';
                    statusDiv.innerHTML =
                        '<i class="fas fa-spinner fa-spin"></i>' +
                        ' פותח את Outlook...';
                }
                if (outlookBtn) {
                    outlookBtn.disabled = true;
                    outlookBtn.style.opacity = '0.6';
                    outlookBtn.style.cursor = 'not-allowed';
                }

                const outlookWebUrl =
                    `https://outlook.office.com/calendar/deeplink/compose` +
                    `?subject=${encodeURIComponent(
                        '[' + change.number + '] ' + (change.name || '')
                    )}` +
                    `&startdt=${encodeURIComponent(fmtOutlook(start))}` +
                    `&enddt=${encodeURIComponent(fmtOutlook(end))}` +
                    `&body=${encodeURIComponent(bodyParts.join('<br>'))}`;

                const newWin = window.open('about:blank', '_blank');

                if (!newWin) {
                    if (statusDiv) statusDiv.style.display = 'none';
                    if (outlookBtn) {
                        outlookBtn.disabled = false;
                        outlookBtn.style.opacity = '1';
                        outlookBtn.style.cursor = 'pointer';
                    }
                    const modal =
                        document.getElementById('cmCalendarChoiceModal');
                    if (modal) {
                        const warn = document.createElement('div');
                        warn.style.cssText = `
                        padding:12px 20px; background:#2a1e0a;
                        border-top:1px solid #92400e; color:#fbbf24;
                        font-size:0.85rem; text-align:center;
                        display:flex; align-items:center;
                        justify-content:center; gap:8px;
                    `;
                        warn.innerHTML = `
                        <i class="fas fa-exclamation-triangle"></i>
                        הדפדפן חסם את הפופאפ.
                        <a href="${outlookWebUrl}" target="_blank"
                           style="color:#60a5fa; font-weight:700;
                                  text-decoration:underline;">
                            לחץ כאן לפתיחה ידנית
                        </a>
                    `;
                        modal.querySelector('div').appendChild(warn);
                    }
                    return;
                }

                setTimeout(() => {
                    newWin.location.href = outlookWebUrl;
                    document.getElementById(
                        'cmCalendarChoiceModal')?.remove();
                }, 100);

            } else if (choice === 'ics') {
                const dtStart = fmtICS(start, hasTime);
                const dtEnd = fmtICS(end, hasTime);

                const lines = [
                    'BEGIN:VCALENDAR',
                    'VERSION:2.0',
                    'PRODID:-//ChangesManager//IL',
                    'CALSCALE:GREGORIAN',
                    'METHOD:PUBLISH',
                    'BEGIN:VEVENT',
                    `UID:${change.number}-${Date.now()}@changes`,
                    `DTSTAMP:${fmtICS(new Date(), true)}`,
                    hasTime
                        ? `DTSTART:${dtStart}`
                        : `DTSTART;VALUE=DATE:${dtStart}`,
                    hasTime
                        ? `DTEND:${dtEnd}`
                        : `DTEND;VALUE=DATE:${dtEnd}`,
                    `SUMMARY:${esc(
                        '[' + change.number + '] ' + (change.name || '')
                    )}`,
                    `DESCRIPTION:${esc(bodyParts.join('\\n'))}`,
                    `CATEGORIES:${esc(change.changeCategory || 'Change')}`,
                    'BEGIN:VALARM',
                    'TRIGGER:-PT15M',
                    'ACTION:DISPLAY',
                    `DESCRIPTION:תזכורת: ${esc(change.number)}`,
                    'END:VALARM',
                    'END:VEVENT',
                    'END:VCALENDAR',
                ];

                const blob = new Blob(
                    [lines.join('\r\n')],
                    { type: 'text/calendar;charset=utf-8' }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${change.number}.ics`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                document.getElementById('cmCalendarChoiceModal')?.remove();
            }
        };
    }

    // -------------------------------------------------------
    // שליחת הזמנת פגישה דרך השרת (EmailService)
    // -------------------------------------------------------
    async _sendCalendarInviteViaServer(change, toEmail) {
        const statusDiv = document.getElementById('cmCalChoiceStatus');

        try {
            // ── הצג טעינה ──────────────────────────────────────
            if (statusDiv) {
                statusDiv.style.display = 'flex';
                statusDiv.style.color = '#a78bfa';
                statusDiv.innerHTML =
                    '<i class="fas fa-spinner fa-spin"></i>' +
                    ' שולח הזמנה...';
            }

            // ── בנה payload ────────────────────────────────────
            const payload = {
                changeNumber: change.number || '',
                changeName: change.name || '',
                toEmail: toEmail,
                toName: toEmail,
                startDate: this.formatDateForDisplay(
                    this._getEffectiveStartTime(change)
                ),
                endDate: this._getEffectiveEndTime(change)
                    ? this.formatDateForDisplay(this._getEffectiveEndTime(change))
                    : '',
                presenter: this.cleanPresenters(change.presenters || ''),
                executingTeam: change.executingTeam || '',
                system: change.system || '',
                status: this.mapStatus(change.status || ''),
                link: change.link || '',
                description: change.description || '',
                notes: change.notes || '',
                changeCategory: change.changeCategory || '',
            };

            // ── קריאה לשרת ─────────────────────────────────────
            const response = await fetch('/Changes/SendCalendarInvite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (data.success) {
                // ── הצלחה ──────────────────────────────────────
                if (statusDiv) {
                    statusDiv.style.color = '#4ade80';
                    statusDiv.innerHTML =
                        '<i class="fas fa-check-circle"></i> ' +
                        `ההזמנה נשלחה בהצלחה אל ${toEmail}`;
                }

                // סגור מודל אחרי 2 שניות
                setTimeout(() => {
                    document.getElementById(
                        'cmCalendarChoiceModal')?.remove();
                }, 2000);

            } else {
                // ── שגיאה מהשרת ────────────────────────────────
                if (statusDiv) {
                    statusDiv.style.color = '#f87171';
                    statusDiv.innerHTML =
                        '<i class="fas fa-exclamation-triangle"></i> ' +
                        `שגיאה: ${data.message}`;
                }
            }

        } catch (err) {
            console.error('[CalendarInvite] שגיאת תקשורת:', err);
            if (statusDiv) {
                statusDiv.style.color = '#f87171';
                statusDiv.innerHTML =
                    '<i class="fas fa-exclamation-triangle"></i> ' +
                    `שגיאת תקשורת: ${err.message}`;
            }
        }
    }

    // *** תאימות לאחור - נקרא מה-HTML ישירות ***
    switchView(view) {
        this.currentView = view;

        // עדכון כפתורים
        document.querySelectorAll('.view-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-view') === view);
        });

        // הצגת/הסתרת חיפוש
        const searchBar = document.getElementById('changesSearchBar');
        if (searchBar) {
            searchBar.style.display = view === 'table' ? 'flex' : 'none';
        }

        // טעינה לפי תצוגה
        this.loadCurrentView();
    }

    // -------------------------------------------------------
    // מאזיני קליק לשינויים בלוח שנה
    // -------------------------------------------------------
    attachChangeClickListeners(container) {
        container.querySelectorAll('.day-change:not(.more-changes)').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const number = el.getAttribute('data-number');
                if (!number) return;
                const change = this.changesData.find(c => c.number === number);
                if (change) this.showChangePopup(change);
            });
        });
    }

    // -------------------------------------------------------
    // מאזיני "עוד שינויים" בלוח שנה
    // -------------------------------------------------------
    attachMoreChangesListeners(container, changesByDate, month, year) {
        container.querySelectorAll('.day-change.more-changes').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();

                const dayElement = button.closest('.calendar-day');
                const dayChangesDiv = dayElement.querySelector('.day-changes');
                const day = parseInt(dayElement.querySelector('.day-number').textContent);
                const dateStr = this.formatDateString(day, month + 1, year);
                const allForDay = changesByDate[dateStr] || [];

                dayChangesDiv.innerHTML = allForDay
                    .map(c => this.buildDayChangeHTML(c))
                    .join('');

                // מאזיני קליק לשינויים שנחשפו
                dayChangesDiv.querySelectorAll('.day-change').forEach(el => {
                    el.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        const number = el.getAttribute('data-number');
                        const change = this.changesData.find(c => c.number === number);
                        if (change) this.showChangePopup(change);
                    });
                });
            });
        });
    }

    // -------------------------------------------------------
    // בניית HTML לשינוי בודד בלוח שנה
    // -------------------------------------------------------
    buildDayChangeHTML(change) {
        const sourceClass = change.source === 'ONIT' ? ' onit-change' : '';
        const inner = `
        <span>
            <span class="change-number">${change.number}</span>
            <span class="change-name">${this.truncateText(change.name, 20)}</span>
        </span>`;

        return `
            <div class="day-change${sourceClass}"
                 title="${change.name || ''}"
                 data-number="${change.number}">
                ${inner}
            </div>
        `;
    }

    // -------------------------------------------------------
    // זיהוי ימי הקפאה - 2 ימי עסקים ראשונים + 2 אחרונים
    // -------------------------------------------------------
    _getFreezeDays(year, month) {
        // month: 0-11
        const isBusinessDay = (date) => {
            const dow = date.getDay();
            return dow !== 5 && dow !== 6; // לא שישי ולא שבת
        };

        const firstBusinessDays = [];
        const lastBusinessDays = [];

        // 2 ימי עסקים ראשונים
        let d = new Date(year, month, 1);
        while (firstBusinessDays.length < 2) {
            if (isBusinessDay(d)) {
                firstBusinessDays.push(d.getDate());
            }
            d.setDate(d.getDate() + 1);
        }

        // 2 ימי עסקים אחרונים
        const lastDay = new Date(year, month + 1, 0).getDate();
        d = new Date(year, month, lastDay);
        while (lastBusinessDays.length < 2) {
            if (isBusinessDay(d)) {
                lastBusinessDays.push(d.getDate());
            }
            d.setDate(d.getDate() - 1);
        }

        return new Set([...firstBusinessDays, ...lastBusinessDays]);
    }

    _isFreezeDay(year, month, day) {
        return this._getFreezeDays(year, month).has(day);
    }

    // -------------------------------------------------------
    // יצירת ימי לוח שנה
    // -------------------------------------------------------
    generateCalendarDays(month, year, changesByDate) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDay = firstDay.getDay();

        let html = '';

        // ימים ריקים
        for (let i = 0; i < startDay; i++) {
            html += '<div class="calendar-day empty"></div>';
        }

        // ימי החודש
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = this.formatDateString(day, month + 1, year);
            const changesForDay = changesByDate[dateStr] || [];
            const isToday = this.isToday(day, month, year);
            const hasChanges = changesForDay.length > 0;
            // *** חדש: בדיקת יום הקפאה ***
            const isFreeze = this._isFreezeDay(year, month, day);

            let classes = 'calendar-day';
            if (isToday) classes += ' today';
            if (hasChanges) classes += ' has-changes';
            if (isFreeze) classes += ' freeze-day';  // *** חדש ***

            html += `
                <div class="${classes}">
                    <div class="day-number">${day}
                    ${isFreeze ? `
                    <div class="freeze-badge" title="יום הקפאה">
                        ❄️ יום הקפאה
                    </div>` : ''}</div>
                    ${hasChanges ? this.generateChangesForDay(changesForDay) : ''}
                </div>
            `;
        }

        return html;
    }

    // -------------------------------------------------------
    // יצירת שינויים ליום בלוח שנה
    // -------------------------------------------------------
    generateChangesForDay(changes) {
        if (!changes || changes.length === 0) return '';

        const display = changes.slice(0, 2);
        const remaining = changes.length - 2;

        let html = '<div class="day-changes">';

        display.forEach(c => { html += this.buildDayChangeHTML(c); });

        if (remaining > 0) {
            html += `
                <div class="day-change more-changes"
                     title="${remaining} שינויים נוספים">
                    <span class="change-more">+ ${remaining} נוספים...</span>
                </div>
            `;
        }

        html += '</div>';
        return html;
    }

    // -------------------------------------------------------
    // פונקציות עזר
    // -------------------------------------------------------
    organizeChangesByDate() {
        // *** סנן מבוטלים לפני ארגון ***
        const filtered = (this.changesData || []).filter(c => {
            const s = (c.status || '').toLowerCase().trim();
            return !['cancelled', 'canceled', 'בוטל', 'pending', 'ממתין'].includes(s);
        });
        return this._organizeChangesByDateFiltered(filtered);
    }

    formatDateString(day, month, year) {
        return `${String(day).padStart(2, '0')}-` +
            `${String(month).padStart(2, '0')}-` +
            `${year}`;
    }

    getHebrewMonthName(monthIndex) {
        return ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
            'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'][monthIndex];
    }

    isToday(day, month, year) {
        const t = new Date();
        return day === t.getDate() && month === t.getMonth() && year === t.getFullYear();
    }

    isChangeToday(dateString) {
        if (!dateString) return false;
        // אם זה אובייקט change - השתמש בתאריך האפקטיבי
        if (typeof dateString === 'object' && dateString !== null) {
            dateString = this._getEffectiveStartTime(dateString);
        }
        if (!dateString) return false;
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const d = this.parseDateString(dateString);
            if (!d) return false;
            d.setHours(0, 0, 0, 0);
            return d.getTime() === today.getTime();
        } catch { return false; }
    }

    // -------------------------------------------------------
    // פורמט תאריך לתצוגה dd/mm/yyyy HH:mm
    // -------------------------------------------------------
    formatDateForDisplay(str) {
        if (!str) return '';
        try {
            const s = String(str).trim();

            // כבר בפורמט dd/mm/yyyy
            const dmy = s.match(
                /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}))?/
            );
            if (dmy) {
                const day = String(dmy[1]).padStart(2, '0');
                const month = String(dmy[2]).padStart(2, '0');
                const time = dmy[4] ? ` ${dmy[4]}` : '';
                return `${day}/${month}/${dmy[3]}${time}`;
            }

            // פורמט ISO: yyyy-mm-dd HH:MM
            const iso = s.match(
                /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}:\d{2}))?/
            );
            if (iso) {
                const day = String(iso[3]).padStart(2, '0');
                const month = String(iso[2]).padStart(2, '0');
                const time = iso[4] ? ` ${iso[4]}` : '';
                return `${day}/${month}/${iso[1]}${time}`;
            }

            // פורמט אנגלי עם & - נקה ופרסר
            const cleaned = s.replace(/\s*&\s*/g, ' ').trim();
            const d = new Date(cleaned);
            if (!isNaN(d.getTime())) {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const hours = String(d.getHours()).padStart(2, '0');
                const mins = String(d.getMinutes()).padStart(2, '0');
                return `${day}/${month}/${d.getFullYear()} ${hours}:${mins}`;
            }

            return s;
        } catch {
            return str;
        }
    }

    truncateText(text, max) {
        if (!text) return '';
        return text.length <= max ? text : text.substring(0, max) + '...';
    }

    showLoading(show) {
        const el = document.getElementById('changesLoadingIndicator');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    showError(msg) {
        const container = document.getElementById('changesTableContainer');
        if (container)
            container.innerHTML = `<p class="no-data-message error">${msg}</p>`;
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.autoRefreshInterval = setInterval(() => {
            this.loadCurrentView();
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }
}

const changesManager = new ChangesManager();
window.changesManager = changesManager;