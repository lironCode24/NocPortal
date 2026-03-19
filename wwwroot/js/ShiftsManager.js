class ShiftsManager {
    constructor() {
        this.currentShift = null;
        this.shiftsData = [];
        this.shiftsTable = [];
        this.isEditMode = false;
        this.originalData = null;
        this.modifiedCells = new Set();
        this.editPassword = 'Menora99'; // Password for edit mode
        this.autoRefreshInterval = null; // Auto refresh interval

        // Employee colors map 
        this.employeeColors = {
            'אריה': '#4BAB46',
            'דני': '#87CEEB',
            'גלית': '#FF6B6B',
            'אבי': '#DDA0DD',
            'רונן': '#00CED1',
            'יוני': '#9A8C8C ',
            'יבגני': '#E6D558',
            'טל': '#FFB6C1'
        };
        this.colorMode = 'background';
        this.previousColorMode = null;
        this.AUTO_REFRESH_MINUTES = 5;

        // Password cache
        this.passwordCache = {
            isAuthenticated: false,
            timestamp: null,
            timeoutId: null,
            CACHE_DURATION: 5 * 60 * 1000 // 5 minutes in milliseconds
        };

        // Restart auto refresh after exiting edit mode
        this.startAutoRefresh();

        // בדיקת משמרות עתידיות בעת אתחול
        this.loadShiftsTable().then(() => {
            this.checkFutureShifts();
        });
    }

    // Get employee color by first name
    getEmployeeColor(employeeName) {
        if (!employeeName || employeeName.trim() === '') return null;
        const normalizedName = employeeName.trim();
        return this.employeeColors[normalizedName] || null;
    }

    // Set color mode
    setColorMode(mode) {
        const validModes = ['background', 'border', 'text', 'gradient', 'dot', 'underline', 'none'];
        if (validModes.includes(mode)) {
            this.colorMode = mode;
            // Save preference to localStorage
            localStorage.setItem('shiftsColorMode', mode);
            this.loadShiftsTable(); // Reload table with new color mode
        }
    }

    // Load color mode preference
    loadColorModePreference() {
        const savedMode = localStorage.getItem('shiftsColorMode');
        if (savedMode) {
            this.colorMode = savedMode;
            // Update selector if exists
            const selector = document.getElementById('colorModeSelect');
            if (selector) {
                selector.value = savedMode;
            }
        }
    }

    // Get current shift based on time
    getCurrentShift() {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTime = currentHour * 60 + currentMinute;

        const shifts = [
            { name: 'בוקר', start: 7 * 60, end: 15 * 60, icon: 'fas fa-sun', color: '#f7db4d' },
            { name: 'צהריים', start: 15 * 60, end: 23 * 60, icon: 'fas fa-cloud-sun', color: '#a5cbd6' },
            { name: 'לילה', start: 23 * 60, end: 24 * 60 + 7 * 60, icon: 'fas fa-moon', color: '#819DBA' }
        ];

        for (let shift of shifts) {
            if (shift.name === 'לילה') {
                if (currentTime >= shift.start || currentTime < 7 * 60) {
                    return shift;
                }
            } else {
                if (currentTime >= shift.start && currentTime < shift.end) {
                    return shift;
                }
            }
        }

        return { name: 'לא מוגדר', start: 0, end: 0, icon: 'fas fa-question', color: '#E0E0E0' };
    }

    // Update current shift indicator
    updateCurrentShiftIndicator() {
        const currentShift = this.getCurrentShift();
        const indicator = document.getElementById('currentShiftIndicator');

        if (indicator) {
            let timeRange = '';
            if (currentShift.name !== 'לא מוגדר') {
                const startHour = Math.floor(currentShift.start / 60);
                let endHour = Math.floor(currentShift.end / 60);

                if (currentShift.name === 'לילה') {
                    endHour = endHour > 23 ? endHour - 24 : endHour;
                }

                timeRange = `${startHour.toString().padStart(2, '0')}:00 - ${endHour.toString().padStart(2, '0')}:00`;
            }

            indicator.innerHTML = `
                <i class="${currentShift.icon}"></i>
                <span>משמרת נוכחית: ${currentShift.name} ${timeRange}</span>
            `;

            indicator.style.background = `linear-gradient(135deg, ${currentShift.color}, ${this.adjustColor(currentShift.color, -20)})`;
        }
    }

    // Load shifts table
    async loadShiftsTable() {
        try {
            const response = await fetch('/Shifts/GetShiftsTable');
            const data = await response.json();

            if (data.error) {
                console.error('Error loading shifts table:', data.error);
                document.getElementById('shiftsTableContainer').innerHTML =
                    '<p style="text-align: center; color: #ff4757;">שגיאה בטעינת לוח המשמרות</p>';
                return;
            }

            this.createShiftsTable(data);
            this.checkExcelFileChanges();

            // בדיקה אם יש משמרות עתידיות
            await this.checkFutureShifts();
        } catch (error) {
            console.error('Error fetching shifts table:', error);
            document.getElementById('shiftsTableContainer').innerHTML =
                '<p style="text-align: center; color: #ff4757;">שגיאה בטעינת לוח המשמרות</p>';
        }
    }

    // Helper methods
    adjustColor(color, amount) {
        const usePound = color[0] === '#';
        const col = usePound ? color.slice(1) : color;
        const num = parseInt(col, 16);
        let r = (num >> 16) + amount;
        let g = (num >> 8 & 0x00FF) + amount;
        let b = (num & 0x0000FF) + amount;
        r = r > 255 ? 255 : r < 0 ? 0 : r;
        g = g > 255 ? 255 : g < 0 ? 0 : g;
        b = b > 255 ? 255 : b < 0 ? 0 : b;
        return (usePound ? '#' : '') + (r << 16 | g << 8 | b).toString(16).padStart(6, '0');
    }

    isDateToday(dateString) {
        if (!dateString || dateString.trim() === '') return false;

        try {
            // Get today's date at midnight for accurate comparison
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Try to parse DD.MM.YY format (like 16.08.25)
            const datePattern = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/;
            const match = dateString.trim().match(datePattern);

            if (match) {
                const day = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1; // Months are 0-indexed
                let year = parseInt(match[3], 10);

                // Handle 2-digit year
                if (year < 100) {
                    year = 2000 + year;
                }

                const parsedDate = new Date(year, month, day);
                parsedDate.setHours(0, 0, 0, 0);

                // Compare timestamps
                return parsedDate.getTime() === today.getTime();
            }

            // Try standard date parsing as fallback
            const parsedDate = new Date(dateString);
            if (!isNaN(parsedDate.getTime())) {
                parsedDate.setHours(0, 0, 0, 0);
                return parsedDate.getTime() === today.getTime();
            }

            return false;
        } catch (error) {
            console.error('Error parsing date:', dateString, error);
            return false;
        }
    }

    getShiftClass(shiftName) {
        switch (shiftName) {
            case 'בוקר': return 'shift-morning';
            case 'צהריים': return 'shift-afternoon';
            case 'לילה': return 'shift-night';
            case 'חופשה': return 'shift-vacation';
            default: return '';
        }
    }

    isHebrewToday(dayName) {
        const today = new Date();
        const todayHebrew = this.getHebrewDayName(today.getDay());
        return dayName === todayHebrew;
    }

    getHebrewDayName(dayIndex) {
        const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        return days[dayIndex];
    }

    isColumnToday(columnIndex, headers, dayHeaders) {
        const today = new Date();
        const todayHebrew = this.getHebrewDayName(today.getDay());
        // Check date header
        if (columnIndex < headers.length) {
            const header = headers[columnIndex];
            if (this.isDateToday(header)) {
                return true;
            }
        }

        if (columnIndex < dayHeaders.length) {
            return dayHeaders[columnIndex] === todayHebrew;
        }

        return false;
    }

    // בדיקה אם יש משמרות עתידיות בעת טעינת הדף
    async checkFutureShifts() {
        try {
            const response = await fetch('/Shifts/CheckFutureShiftsExist');
            const result = await response.json();

            if (result.exists) {
                // הצגת כפתור צפייה במשמרות עתידיות
                const futureButton = document.querySelector('.btn-future-shifts');
                const shiftsEditActive = document.querySelector('.shifts-edit-active');
                if (futureButton && !shiftsEditActive) {
                    futureButton.style.display = 'flex';
                }

                // בדיקה אם צריך להעביר את המשמרות העתידיות ללוח הנוכחי
                if (result.shouldMigrate) {
                    this.migrateFutureShifts();
                }
            } else {
                // הסתרת כפתור צפייה במשמרות עתידיות
                const futureButton = document.querySelector('.btn-future-shifts');
                if (futureButton) {
                    futureButton.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error checking future shifts:', error);
        }
    }

    // יצירת קובץ EML ופתיחתו אוטומטית במצב עריכה
    async openEmailInOutlook(subject, htmlBody, to) {
        try {
            // Create EML with X-Unsent header to open in draft/edit mode
            const emlContent = `X-Unsent: 1
To: ${to}
Subject: ${subject}
MIME-Version: 1.0
Content-Type: text/html; charset=UTF-8

${htmlBody}`;

            const blob = new Blob([emlContent], { type: "message/rfc822" });
            const url = URL.createObjectURL(blob);

            // Create download link
            const a = document.createElement("a");
            a.href = url;
            a.download = "לוח_משמרות.eml";
            a.style.display = "none";

            document.body.appendChild(a);

            // Download the file
            a.click();

            NotificationManager.show('מוריד את קובץ המייל...', 'info');

            // Clean up
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 2000);

            // הצג הנחיות למשתמש
            setTimeout(() => {
                this.showEmailInstructionsModal();
            }, 2000);

        } catch (error) {
            console.error('Error creating email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
        }
    }

    // Create MHTML content with X-Unsent header for draft mode
    createMHTMLContent(subject, htmlBody, to) {
        const boundary = "----=_NextPart_" + Date.now();

        const mhtml = `MIME-Version: 1.0
            Content-Type: multipart/related; boundary="${boundary}"
            X-Unsent: 1
            To: ${to}
            Subject: ${subject}

            This is a multi-part message in MIME format.

            --${boundary}
            Content-Type: text/html; charset="utf-8"
            Content-Transfer-Encoding: quoted-printable

            ${this.encodeQuotedPrintable(htmlBody)}

            --${boundary}--`;

        return mhtml;
    }

    // Encode HTML to quoted-printable format
    encodeQuotedPrintable(str) {
        // Simple quoted-printable encoding
        return str
            .replace(/[\u0080-\uFFFF]/g, (c) => {
                const hex = c.charCodeAt(0).toString(16).toUpperCase();
                return '=' + (hex.length === 2 ? hex : '0' + hex);
            })
            .replace(/\r\n|\r|\n/g, '\r\n')
            .replace(/(.{75})/g, '$1=\r\n');
    }

    // Create MSG file content (simplified version - for full MSG support, use a library)
    createMSGContent(subject, htmlBody, to) {
        // For proper MSG file creation, we'll use a simpler approach
        // that creates an Outlook-compatible HTML file that opens in edit mode

        const msgTemplate = `MIME-Version: 1.0
            Content-Type: multipart/alternative; boundary="----=_NextPart_000_0001"
            X-Unsent: 1
            To: ${to}
            Subject: ${subject}

            ------=_NextPart_000_0001
            Content-Type: text/html; charset="utf-8"
            Content-Transfer-Encoding: quoted-printable

            ${htmlBody}

            ------=_NextPart_000_0001--`;

        return msgTemplate;
    }

    // הצגת מודל עם הנחיות לפתיחת קובץ EML
    showEmailInstructionsModal() {
        // יצירת מודל אם לא קיים
        if (!document.getElementById('emailInstructionsModal')) {
            const modalHTML = `
        <div id="emailInstructionsModal" class="modal-overlay">
            <div class="modal-content email-instructions-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-envelope"></i> פתיחת המייל</h3>
                    <button class="modal-close" onclick="document.getElementById('emailInstructionsModal').style.display='none'">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="instructions-container">
                        <div class="instruction-step">
                            <div class="step-number">1</div>
                            <div class="step-content">
                                <h4>הקובץ הורד למחשב שלך</h4>
                                <p>קובץ <strong>לוח_משמרות.eml</strong> הורד לתיקיית ההורדות שלך.</p>
                            </div>
                        </div>
                        <div class="instruction-step highlight-step">
                            <div class="step-number">2</div>
                            <div class="step-content">
                                <h4>פתח את הקובץ</h4>
                                <p><strong class="important-text">חשוב: לחץ על הקובץ שהורדת כדי לפתוח אותו ב-Outlook.</strong></p>
                                <p>הקובץ יפתח כטיוטת מייל מוכנה לשליחה.</p>
                            </div>
                        </div>
                        <div class="instruction-step">
                            <div class="step-number">3</div>
                            <div class="step-content">
                                <h4>בדוק ושלח</h4>
                                <p>בדוק את תוכן המייל ולחץ על "שלח" כדי לשלוח אותו.</p>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-primary" onclick="document.getElementById('emailInstructionsModal').style.display='none'">
                        <i class="fas fa-check"></i> הבנתי
                    </button>
                </div>
            </div>
        </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // הוספת CSS למודל
            const style = document.createElement('style');
            style.textContent = `
            .email-instructions-modal {
                max-width: 500px;
            }
            .instructions-container {
                padding: 10px 0;
            }
            .instruction-step {
                display: flex;
                margin-bottom: 15px;
                align-items: flex-start;
                padding: 10px;
                border-radius: 5px;
            }
            .highlight-step {
                background-color: #fff8e1;
                border: 1px solid #ffecb3;
            }
            .step-number {
                width: 30px;
                height: 30px;
                background: #4285f4;
                color: white;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                margin-left: 15px;
                flex-shrink: 0;
            }
            .step-content {
                flex-grow: 1;
            }
            .step-content h4 {
                margin-top: 0;
                margin-bottom: 5px;
            }
            .step-content p {
                margin: 5px 0;
            }
            .important-text {
                color: #d32f2f;
                font-weight: bold;
            }
        `;
            document.head.appendChild(style);
        }

        // הצגת המודל
        document.getElementById('emailInstructionsModal').style.display = 'flex';

        // הדגשת השלב השני אם נדרש
        const step2 = document.querySelector('.highlight-step');
        if (step2) {
            step2.style.animation = 'pulse 1.5s infinite';
            setTimeout(() => {
                step2.style.animation = '';
            }, 6000);
        }
    }

    // בניית HTML ללוח משמרות
    buildShiftsHtmlEmail(data) {
        // הכנת נתונים
        const firstDate = data.headers[0] || '';
        const lastDate = data.headers[data.headers.length - 1] || '';
        const dateRange = firstDate && lastDate ? `${firstDate} - ${lastDate}` : '';

        // יצירת טבלה
        let tableRows = '';

        // כותרות תאריכים
        tableRows += '<tr><th></th>';
        data.headers.forEach(header => {
            tableRows += `<th style="background-color:#f2f2f2;padding:8px;text-align:center;border:1px solid #ddd;">${header}</th>`;
        });
        tableRows += '</tr>';

        // כותרות ימים
        tableRows += '<tr><td style="background-color:#f2f2f2;padding:8px;text-align:center;border:1px solid #ddd;"></td>';
        data.dayHeaders.forEach(day => {
            tableRows += `<td style="background-color:#f2f2f2;padding:8px;text-align:center;border:1px solid #ddd;">${day}</td>`;
        });
        tableRows += '</tr>';

        // שורות משמרות
        data.rows.forEach((shiftGroup, shiftIndex) => {
            // קביעת צבע רקע לפי סוג משמרת
            let shiftBgColor;
            switch (shiftGroup.shiftName) {
                case 'בוקר': shiftBgColor = '#e3f2fd'; break;
                case 'צהריים': shiftBgColor = '#fff8e1'; break;
                case 'לילה': shiftBgColor = '#e8eaf6'; break;
                case 'חופשה': shiftBgColor = '#f1f8e9'; break;
                default: shiftBgColor = '#f5f5f5';
            }

            shiftGroup.rows.forEach((row, rowIndex) => {
                tableRows += '<tr>';

                if (rowIndex === 0) {
                    tableRows += `<td style="background-color:#f2f2f2;padding:8px;text-align:center;border:1px solid #ddd;font-weight:bold;" rowspan="${shiftGroup.rows.length}">
                    ${shiftGroup.shiftName}
                </td>`;
                }

                for (let i = 1; i < row.length; i++) {
                    const cellValue = row[i] || '';

                    // קבלת צבע עובד
                    const employeeColor = this.getEmployeeColorMail(cellValue);
                    let cellStyle = `background-color:${shiftBgColor};padding:8px;text-align:center;border:1px solid #ddd;`;

                    // הוספת סגנון צבע לעובד
                    if (employeeColor) {
                        cellStyle = `background-color:${employeeColor};color:white;padding:8px;text-align:center;border:1px solid #ddd;font-weight:bold;`;
                    }

                    tableRows += `<td style="${cellStyle}">${cellValue}</td>`;
                }

                tableRows += '</tr>';
            });

            // הוספת שורת הפרדה בין המשמרות (אם זו לא המשמרת האחרונה)
            if (shiftIndex < data.rows.length - 1) {
                tableRows += `<tr>
                <td colspan="${data.headers.length + 1}" style="height:10px;background-color:#f9f9f9;border-bottom:2px solid #e0e0e0;"></td>
            </tr>`;
            }
        });

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>לוח משמרות</title>
        </head>
        <body dir="rtl" style="font-family:Arial, sans-serif; font-size:14px; margin:0; padding:20px;">
            <h2 style="text-align:center; margin-bottom:20px;">לוח משמרות לתאריכים ${dateRange}</h2>
            
            <table style="width:80%; border-collapse:collapse; margin-bottom:20px; margin:0 auto;">
                ${tableRows}
            </table>
            
            <div style="margin-top:30px; text-align:center; font-size:12px; color:#666; border-top:1px solid #ccc; padding-top:10px;">
                <p>הופק בתאריך ${new Date().toLocaleDateString('he-IL')} בשעה ${new Date().toLocaleTimeString('he-IL')}</p>
                <p>מייל זה נשלח ממערכת ניהול המשמרות</p>
            </div>
        </body>
        </html>
        `;
    }

    // Employee colors map - צבעים כהים יותר לעובדים
    getEmployeeColorMail(name) {
        const employeeColors = {
            'רונן': '#00CCFF',    // תכלת
            'גלית': '#FF6699',    // ורוד
            'אבי': '#CC99FF',     // סגול בהיר
            'יבגני': '#FFCC33',   // צהוב
            'יוני': '#999999',    // אפור
            'אריה': '#66CC66',    // ירוק
            'דני': '#3366CC',     // כחול
            'טל': '#FF9966'       // כתום-ורוד
        };
        return employeeColors[name] || null;
    }

    // שליחת לוח משמרות במייל עם HTML מלא
    createShiftsEmailWithEml(data) {
        try {
            // יצירת כותרת למייל
            const firstDate = data.headers[0] || '';
            const lastDate = data.headers[data.headers.length - 1] || '';
            const dateRange = firstDate && lastDate ? `${firstDate} - ${lastDate}` : '';

            const subject = `לוח משמרות לתאריכים ${dateRange}`;
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // בניית תוכן HTML למייל
            const htmlBody = this.buildShiftsHtmlEmail(data);

            // פתיחת המייל ב-Outlook
            this.openEmailInOutlook(subject, htmlBody, recipient);

        } catch (error) {
            console.error('Error creating shifts email:', error);
            NotificationManager.show('שגיאה בפתיחת המייל', 'error');
        }
    }

    // Send shifts table by email with screenshot
    async sendShiftsEmail() {
        try {
            // Show loading overlay
            const overlay = document.getElementById('shiftsLoadingOverlay');
            overlay.classList.add('show');

            // Get shifts table data
            const response = await fetch('/Shifts/GetShiftsTable');
            const data = await response.json();

            if (data.error) {
                NotificationManager.show('שגיאה בטעינת נתוני המשמרות', 'error');
                overlay.classList.remove('show');
                return;
            }

            // שימוש בפתרון החדש - יצירת מייל HTML ופתיחתו ב-Outlook
            this.createShiftsEmailWithEml(data);

            overlay.classList.remove('show');
        } catch (error) {
            console.error('Error sending email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
            const overlay = document.getElementById('shiftsLoadingOverlay');
            overlay.classList.remove('show');
        }
    }

    // Create and open email with shifts table screenshot
    async createShiftsEmailWithAttachment(data, imageBlob) {
        try {
            // Get date range from the headers
            const firstDate = data.headers[0] || '';
            const lastDate = data.headers[data.headers.length - 1] || '';
            const dateRange = firstDate && lastDate ? `${firstDate} - ${lastDate}` : '';

            // Create email subject with date range
            const subject = `לוח משמרות לתאריכים ${dateRange}`;

            // Create a temporary download link for the image
            const tempLink = document.createElement('a');
            tempLink.download = `לוח_משמרות_${dateRange.replace(/\./g, '_')}.png`;
            tempLink.href = URL.createObjectURL(imageBlob);

            // Create a temporary image element to show in the modal
            const imagePreview = document.createElement('img');
            imagePreview.src = tempLink.href;
            imagePreview.style.maxWidth = '100%';
            imagePreview.style.height = 'auto';
            imagePreview.style.borderRadius = '4px';
            imagePreview.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';

            // Show email options modal with image preview
            this.showEmailOptionsModalWithPreview(subject, dateRange, tempLink, imagePreview);

        } catch (error) {
            console.error('Error creating email with attachment:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
        }
    }

    // Show email options modal with image preview
    showEmailOptionsModalWithPreview(subject, dateRange, imageLink, imagePreview) {
        // Create modal if it doesn't exist
        if (!document.getElementById('emailOptionsModal')) {
            const modalHTML = `
        <div id="emailOptionsModal" class="modal-overlay email-options-modal">
            <div class="modal-content email-options-modal-content">
                <div class="modal-header">
                    <h3><i class="fas fa-envelope"></i> שליחת לוח משמרות במייל</h3>
                    <button class="modal-close" onclick="shiftsManager.closeEmailOptionsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="image-preview-container" id="imagePreviewContainer"></div>
                    <p class="email-instructions">לוח המשמרות לתאריכים ${dateRange}</p>
                    <div class="email-options">
                        <button id="btnSendMailto" class="btn-option">
                            <i class="fas fa-envelope"></i>
                            <span>שלח במייל</span>
                            <small>הורד את התמונה וצרף אותה למייל</small>
                        </button>
                        <button id="btnDownloadImage" class="btn-option">
                            <i class="fas fa-download"></i>
                            <span>הורד תמונה</span>
                            <small>שמור את לוח המשמרות כתמונה</small>
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" onclick="shiftsManager.closeEmailOptionsModal()">
                        <i class="fas fa-times"></i> סגור
                    </button>
                </div>
            </div>
        </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // Show modal
        const modal = document.getElementById('emailOptionsModal');
        modal.style.display = 'flex';

        // Add image preview
        const previewContainer = document.getElementById('imagePreviewContainer');
        previewContainer.innerHTML = '';
        previewContainer.appendChild(imagePreview);

        // Set up button actions
        const btnMailto = document.getElementById('btnSendMailto');
        const btnDownload = document.getElementById('btnDownloadImage');

        // Remove previous event listeners
        const newBtnMailto = btnMailto.cloneNode(true);
        const newBtnDownload = btnDownload.cloneNode(true);
        btnMailto.parentNode.replaceChild(newBtnMailto, btnMailto);
        btnDownload.parentNode.replaceChild(newBtnDownload, btnDownload);

        // Add new event listeners
        newBtnMailto.addEventListener('click', () => {

            // Use RTL mark character for proper Hebrew display
            const rtl = '\u200F';

            // Create simple email body
            let body = '';
            body += `${rtl}לוח משמרות לתאריכים ${dateRange}\n\n`;
            body += `${rtl}(יש לצרף את צילום המסך מתוך הפופאפ המוצג)\n\n`;
            body += `${rtl}--------------------------------\n`;
            body += `${rtl}מייל זה נשלח ממערכת ניהול המשמרות\n`;
            body += `${rtl}נשלח בתאריך: ${new Date().toLocaleDateString('he-IL')}\n`;

            // Set recipient
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // Encode for mailto URL
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(body);

            // Create mailto link
            const mailtoLink = `mailto:${recipient}?subject=${encodedSubject}&body=${encodedBody}`;

            // Open default email client
            window.location.href = mailtoLink;

            // Show notification
            NotificationManager.show('פותח את תוכנת המייל...', 'info');
        });

        newBtnDownload.addEventListener('click', () => {
            // Trigger download
            document.body.appendChild(imageLink);
            imageLink.click();
            document.body.removeChild(imageLink);

            // Show notification
            NotificationManager.show('התמונה הורדה בהצלחה', 'success');
        });
    }

    // Show email options modal
    showEmailOptionsModal(subject, body, recipient, imageLink) {
        // Create modal if it doesn't exist
        if (!document.getElementById('emailOptionsModal')) {
            const modalHTML = `
        <div id="emailOptionsModal" class="modal-overlay email-options-modal">
            <div class="modal-content email-options-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-envelope"></i> אפשרויות שליחת מייל</h3>
                    <button class="modal-close" onclick="shiftsManager.closeEmailOptionsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p>בחר אפשרות לשליחת לוח המשמרות:</p>
                    <div class="email-options">
                        <button id="btnSendMailto" class="btn-option">
                            <i class="fas fa-envelope"></i>
                            <span>פתח בתוכנת המייל</span>
                            <small>שליחה דרך תוכנת המייל המקומית</small>
                        </button>
                        <button id="btnDownloadImage" class="btn-option">
                            <i class="fas fa-download"></i>
                            <span>הורד תמונה</span>
                            <small>שמור את לוח המשמרות כתמונה</small>
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" onclick="shiftsManager.closeEmailOptionsModal()">
                        <i class="fas fa-times"></i> סגור
                    </button>
                </div>
            </div>
        </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // Show modal
        const modal = document.getElementById('emailOptionsModal');
        modal.style.display = 'flex';

        // Set up button actions
        const btnMailto = document.getElementById('btnSendMailto');
        const btnDownload = document.getElementById('btnDownloadImage');

        // Remove previous event listeners
        const newBtnMailto = btnMailto.cloneNode(true);
        const newBtnDownload = btnDownload.cloneNode(true);
        btnMailto.parentNode.replaceChild(newBtnMailto, btnMailto);
        btnDownload.parentNode.replaceChild(newBtnDownload, btnDownload);

        // Add new event listeners
        newBtnMailto.addEventListener('click', () => {
            // Encode for mailto URL
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(body);

            // Create mailto link
            const mailtoLink = `mailto:${recipient}?subject=${encodedSubject}&body=${encodedBody}`;

            // Open default email client
            window.location.href = mailtoLink;

            // Show notification
            NotificationManager.show('פותח את תוכנת המייל...', 'info');
            NotificationManager.show('הורד את התמונה והוסף אותה למייל', 'info');

            // Close modal
            this.closeEmailOptionsModal();
        });

        newBtnDownload.addEventListener('click', () => {
            // Trigger download
            document.body.appendChild(imageLink);
            imageLink.click();
            document.body.removeChild(imageLink);

            // Show notification
            NotificationManager.show('התמונה הורדה בהצלחה', 'success');
        });
    }

    // Close email options modal
    closeEmailOptionsModal() {
        const modal = document.getElementById('emailOptionsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Create and open email with shifts table
    createShiftsEmail(data) {
        try {
            // Get date range from the headers
            const firstDate = data.headers[0] || '';
            const lastDate = data.headers[data.headers.length - 1] || '';
            const dateRange = firstDate && lastDate ? `${firstDate} - ${lastDate}` : '';

            // Create email subject with date range
            const subject = `לוח משמרות לתאריכים ${dateRange}`;

            // Use RTL mark character for proper Hebrew display
            const rtl = '\u200F';

            // Start building email body
            let body = '';

            // Add header
            body += `${rtl}לוח משמרות לתאריכים ${dateRange}\n\n`;

            // Add table preview
            body += `${rtl}תצוגה מקדימה של לוח המשמרות:\n`;
            body += `${rtl}--------------------------------\n`;

            // Add date headers
            body += `${rtl}תאריכים: ${data.headers.join(', ')}\n`;
            body += `${rtl}ימים: ${data.dayHeaders.join(', ')}\n\n`;

            // Add shift information
            data.rows.forEach(shiftGroup => {
                body += `${rtl}${shiftGroup.shiftName}:\n`;

                shiftGroup.rows.forEach((row, rowIndex) => {
                    // Skip first column (shift name)
                    const employees = row.slice(1).filter(cell => cell && cell.trim() !== '');
                    if (employees.length > 0) {
                        body += `${rtl}  ${employees.join(', ')}\n`;
                    }
                });

                body += '\n';
            });

            // Add footer
            body += `${rtl}--------------------------------\n`;
            body += `${rtl}מייל זה נשלח ממערכת ניהול המשמרות\n`;
            body += `${rtl}נשלח בתאריך: ${new Date().toLocaleDateString('he-IL')}\n`;

            // Set recipient
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // Encode for mailto URL
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(body);

            // Create mailto link
            const mailtoLink = `mailto:${recipient}?subject=${encodedSubject}&body=${encodedBody}`;

            // Open default email client
            window.location.href = mailtoLink;

            // Show notification
            NotificationManager.show('פותח את תוכנת המייל...', 'info');
        } catch (error) {
            console.error('Error creating email:', error);
            NotificationManager.show('שגיאה בפתיחת המייל', 'error');
        }
    }

    // העברת משמרות עתידיות ללוח הנוכחי
    async migrateFutureShifts() {
        const overlay = document.getElementById('shiftsLoadingOverlay');
        overlay.classList.add('show');

        const maxRetries = 3;
        let retryCount = 0;
        let success = false;

        while (!success && retryCount < maxRetries) {
            try {
                const response = await fetch('/Shifts/MigrateFutureShifts', {
                    method: 'POST'
                });

                const result = await response.json();

                if (result.success) {
                    success = true;
                    NotificationManager.show('המשמרות העתידיות הועברו בהצלחה ללוח הנוכחי', 'success');

                    // עדכון הטבלה
                    if (result.data) {
                        this.createShiftsTable(result.data);
                    } else {
                        await this.loadShiftsTable();
                    }

                    // הסתרת כפתור צפייה במשמרות עתידיות
                    const futureButton = document.querySelector('.btn-future-shifts');
                    if (futureButton) {
                        futureButton.style.display = 'none';
                    }
                } else {
                    // אם זו שגיאת גישה לקובץ, ננסה שוב
                    if (result.message && result.message.includes("cannot access the file")) {
                        retryCount++;
                        await new Promise(resolve => setTimeout(resolve, 1000)); // המתנה של שנייה
                    } else {
                        // שגיאה אחרת - לא ננסה שוב
                        NotificationManager.show(result.message || 'שגיאה בהעברת המשמרות העתידיות', 'error');
                        break;
                    }
                }
            } catch (error) {
                console.error('Error migrating future shifts:', error);
                retryCount++;

                if (retryCount >= maxRetries) {
                    NotificationManager.show('שגיאה בהעברת המשמרות העתידיות', 'error');
                } else {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // המתנה של שנייה
                }
            }
        }

        overlay.classList.remove('show');
    }

    // צפייה במשמרות עתידיות
    async viewFutureShifts() {
        try {
            const response = await fetch('/Shifts/GetFutureShifts');
            const result = await response.json();

            if (result.success) {
                this.showFutureShiftsPreview(result.data);
            } else {
                NotificationManager.show(result.message || 'לא נמצאו משמרות עתידיות', 'info');
            }
        } catch (error) {
            console.error('Error loading future shifts:', error);
            NotificationManager.show('שגיאה בטעינת משמרות עתידיות', 'error');
        }
    }

    // הצגת משמרות עתידיות
    showFutureShiftsPreview(data) {
        // יצירת מודל אם לא קיים
        if (!document.getElementById('futureShiftsModal')) {
            const modalHTML = `
        <div id="futureShiftsModal" class="modal-overlay">
            <div class="modal-content future-shifts-modal backup-preview-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-calendar-alt"></i> משמרות עתידיות</h3>
                    <button class="modal-close" onclick="shiftsManager.closeFutureShiftsPreview()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="future-shifts-container" id="futureShiftsContainer"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel btn-secondary" onclick="shiftsManager.closeFutureShiftsPreview()">
                        <i class="fas fa-times"></i> סגור
                    </button>
                    <button class="btn-email btn-primary" onclick="shiftsManager.sendPreviewEmail('future')">
                        <i class="fas fa-envelope"></i> שלח במייל
                    </button>
                </div>
            </div>
        </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        const container = document.getElementById('futureShiftsContainer');

        // יצירת טבלה עם הנתונים
        if (data && data.headers && data.dayHeaders) {
            let tableHTML = '<table class="shifts-table preview-table">';

            // כותרות תאריכים
            tableHTML += '<tr><th></th>';
            data.headers.forEach((header, index) => {
                const isToday = this.isDateToday(header);
                tableHTML += `<th class="date-header ">${header}</th>`;
            });
            tableHTML += '</tr>';

            // כותרות ימים
            tableHTML += '<tr><td class="shift-name"></td>';
            data.dayHeaders.forEach((day, index) => {
                const isToday = this.isHebrewToday(day);
                tableHTML += `<td class="day-header ">${day}</td>`;
            });
            tableHTML += '</tr>';

            // שורות משמרות
            for (let i = 0; i < data.rows.length; i++) {
                const shiftGroup = data.rows[i];
                const shiftClass = this.getShiftClass(shiftGroup.shiftName);

                shiftGroup.rows.forEach((row, rowIndex) => {
                    tableHTML += '<tr>';

                    if (rowIndex === 0) {
                        tableHTML += `<td class="shift-name" rowspan="${shiftGroup.rows.length}">
                        <i class="${shiftGroup.icon}"></i> ${shiftGroup.shiftName}
                    </td>`;
                    }

                    for (let i = 1; i < row.length; i++) {
                        const cellValue = row[i] || '';
                        const isToday = i <= data.headers.length && this.isColumnToday(i - 1, data.headers, data.dayHeaders);

                        // קבלת צבע עובד
                        const employeeColor = this.getEmployeeColor(cellValue);

                        // בניית מחלקות תא
                        let cellClasses = `${shiftClass} `;
                        let cellStyle = '';

                        // הוספת סגנון צבע
                        if (employeeColor) {
                            if (this.colorMode !== 'none') {
                                cellClasses += ` color-${this.colorMode}`;

                                if (this.colorMode === 'gradient') {
                                    cellStyle = `data-employee-color="${employeeColor}" style="--employee-color: ${employeeColor}; color: #000; font-weight: 600;"`;
                                } else {
                                    cellStyle = `data-employee-color="${employeeColor}" style="--employee-color: ${employeeColor}; color: white; font-weight: 600;"`;
                                }
                            } else {
                                cellStyle = `style="color: white; font-weight: 600;"`;
                            }
                        }
                        tableHTML += `<td class="${cellClasses}" ${cellStyle}>${cellValue}</td>`;
                    }

                    tableHTML += '</tr>';
                });

                // הוספת שורת רווח בין המשמרות (אם זו לא המשמרת האחרונה)
                if (i < data.rows.length - 1) {
                    tableHTML += '<tr class="shift-separator">';
                    tableHTML += `<td colspan="${data.headers.length + 1}" class="separator-cell"></td>`;
                    tableHTML += '</tr>';
                }
            }

            tableHTML += '</table>';
            container.innerHTML = tableHTML;
        } else {
            container.innerHTML = '<p class="no-data-message">לא נמצאו נתוני משמרות עתידיות</p>';
        }

        // הצגת המודל
        document.getElementById('futureShiftsModal').style.display = 'flex';
    }

    // סגירת תצוגת משמרות עתידיות
    closeFutureShiftsPreview() {
        const modal = document.getElementById('futureShiftsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Open upload modal
    openUploadModal() {
        document.getElementById('uploadShiftsModal').style.display = 'flex';

        // הוספת הסבר על העלאת משמרות עתידיות
        const uploadDescription = document.querySelector('#uploadShiftsModal .modal-description');
        if (uploadDescription) {
            uploadDescription.innerHTML = `
            <p>העלה קובץ משמרות חדש.</p>
            <p>המערכת תזהה אוטומטית אם מדובר במשמרות לשבוע הנוכחי או העתידי:</p>
            <ul>
                <li>אם התאריך הראשון בקובץ הוא בשבוע הנוכחי (שבת עד שישי) - הקובץ יוצג בלוח המשמרות הרגיל.</li>
                <li>אם התאריך הראשון בקובץ הוא בשבוע הבא או מאוחר יותר - הקובץ יוצג בלוח המשמרות העתידי.</li>
            </ul>
        `;
        }

        // הגדרת גרירה ושחרור
        this.setupDragAndDrop();
    }

    // Close upload modal
    closeUploadModal() {
        document.getElementById('uploadShiftsModal').style.display = 'none';
        document.getElementById('shiftsFileInput').value = '';
        document.getElementById('uploadPreview').style.display = 'none';
    }

    // Handle file selection
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        const allowedExtensions = ['.csv', '.xlsx', '.xls'];
        const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

        if (!allowedExtensions.includes(fileExtension)) {
            NotificationManager.show('יש להעלות קובץ CSV או Excel בלבד', 'error');
            event.target.value = '';
            return;
        }

        // Show preview
        const preview = document.getElementById('uploadPreview');
        const fileName = document.getElementById('uploadFileName');
        const fileSize = document.getElementById('uploadFileSize');

        fileName.textContent = file.name;
        fileSize.textContent = this.formatFileSize(file.size);
        preview.style.display = 'flex';
    }

    // Setup drag and drop for file upload
    setupDragAndDrop() {
        const uploadLabel = document.querySelector('#uploadShiftsModal .file-upload-label');

        if (!uploadLabel) return;

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadLabel.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // Highlight drop area when item is dragged over it
        ['dragenter', 'dragover'].forEach(eventName => {
            uploadLabel.addEventListener(eventName, () => {
                uploadLabel.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadLabel.addEventListener(eventName, () => {
                uploadLabel.classList.remove('drag-over');
            }, false);
        });

        // Handle dropped files
        uploadLabel.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;

            if (files.length > 0) {
                const fileInput = document.getElementById('shiftsFileInput');
                fileInput.files = files;

                // Trigger the change event
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        }, false);
    }

    // Upload shifts file
    async uploadShiftsFile() {
        const fileInput = document.getElementById('shiftsFileInput');
        const file = fileInput.files[0];

        if (!file) {
            NotificationManager.show('אנא בחר קובץ להעלאה', 'error');
            return;
        }

        const uploadBtn = document.getElementById('uploadShiftsBtn');
        uploadBtn.disabled = true;
        uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מעלה...';

        try {
            let csvContent;
            const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

            // המרת Excel ל-CSV במידת הצורך
            if (extension === '.xlsx' || extension === '.xls') {
                NotificationManager.show('ממיר קובץ Excel ל-CSV...', 'info');
                csvContent = await this.convertExcelToCSV(file);
            } else {
                // קריאת קובץ CSV
                csvContent = await this.readFileAsText(file);
            }

            // יצירת אובייקט File חדש עם תוכן ה-CSV
            const csvFile = new File([csvContent], 'shifts.csv', { type: 'text/csv' });

            const formData = new FormData();
            formData.append('file', csvFile);

            const response = await fetch('/Shifts/UploadFutureShiftsFile', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                if (result.isCurrent) {
                    NotificationManager.show('הקובץ הועלה בהצלחה ללוח המשמרות הנוכחי!', 'success');
                } else {
                    NotificationManager.show('הקובץ הועלה בהצלחה ללוח המשמרות העתידי!', 'success');
                }

                this.closeUploadModal();

                // טעינת טבלת המשמרות המתאימה
                if (result.data) {
                    // שאל את המשתמש אם ברצונו לשלוח את לוח המשמרות החדש במייל
                    if (confirm('האם ברצונך לשלוח את לוח המשמרות החדש במייל?')) {
                        // במקום לקרוא לפונקציה הרגילה, נשתמש בפונקציה מותאמת שתיצור צילום מסך של הנתונים שהועלו
                        await this.sendUploadedShiftsEmail(result.data);
                    }

                    if (result.isCurrent) {
                        this.createShiftsTable(result.data);
                    }
                }

                // רענון הטבלה הנוכחית
                await this.loadShiftsTable();
            } else {
                NotificationManager.show(result.message || 'שגיאה בהעלאת הקובץ', 'error');
            }
        } catch (error) {
            console.error('Error uploading file:', error);
            NotificationManager.show('שגיאה בהעלאת הקובץ: ' + error.message, 'error');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = '<i class="fas fa-upload"></i> העלה קובץ';
        }
    }

    // Send uploaded shifts data by email
    async sendUploadedShiftsEmail(data) {
        try {
            // Show loading overlay
            const overlay = document.getElementById('shiftsLoadingOverlay');
            overlay.classList.add('show');

            // שימוש בפתרון החדש - יצירת מייל HTML ופתיחתו ב-Outlook
            this.createShiftsEmailWithEml(data);

            overlay.classList.remove('show');
        } catch (error) {
            console.error('Error sending email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
            const overlay = document.getElementById('shiftsLoadingOverlay');
            overlay.classList.remove('show');
        }
    }

    // Convert Excel file to CSV
    async convertExcelToCSV(file) {
        return new Promise((resolve, reject) => {
            // בדיקה אם הספרייה קיימת
            if (typeof XLSX === 'undefined') {
                reject(new Error('ספריית XLSX לא נטענה. אנא הוסף את ספריית SheetJS לפרויקט.'));
                return;
            }

            const reader = new FileReader();

            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    // בדיקה אם יש גיליונות בקובץ
                    if (workbook.SheetNames.length === 0) {
                        reject(new Error('קובץ האקסל אינו מכיל גיליונות'));
                        return;
                    }

                    // Get first sheet
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];

                    // Convert to CSV
                    const csv = XLSX.utils.sheet_to_csv(worksheet, {
                        FS: ',',  // Field separator
                        RS: '\n',  // Record separator
                        blankrows: false  // לא לכלול שורות ריקות
                    });

                    resolve(csv);
                } catch (error) {
                    console.error('Excel conversion error:', error);
                    reject(new Error('שגיאה בהמרת קובץ Excel: ' + error.message));
                }
            };

            reader.onerror = function (error) {
                console.error('File reading error:', error);
                reject(new Error('שגיאה בקריאת הקובץ'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    // Read file as text
    async readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = function (e) {
                resolve(e.target.result);
            };

            reader.onerror = function () {
                reject(new Error('שגיאה בקריאת הקובץ'));
            };

            reader.readAsText(file, 'UTF-8');
        });
    }

    // Open backup modal
    async openBackupModal() {
        document.getElementById('backupShiftsModal').style.display = 'flex';
        await this.loadBackupFiles();
    }

    // Close backup modal
    closeBackupModal() {
        document.getElementById('backupShiftsModal').style.display = 'none';
    }

    // Load backup files list
    async loadBackupFiles() {
        const container = document.getElementById('backupFilesList');
        container.innerHTML = '<p style="text-align: center; color: #666;">טוען קבצי משמרות היסטורים...</p>';

        try {
            const response = await fetch('/Shifts/GetBackupFiles');
            const backups = await response.json();

            if (backups.error) {
                container.innerHTML = '<p style="text-align: center; color: #ff4757;">שגיאה בטעינת קבצי משמרות היסטורים</p>';
                return;
            }

            if (backups.length === 0) {
                container.innerHTML = '<p style="text-align: center; color: #666;">אין קבצי משמרות היסטורים זמינים</p>';
                return;
            }

            let html = '<div class="backup-files-list">';
            backups.forEach(backup => {
                const date = new Date(backup.date);
                const formattedDate = date.toLocaleString('he-IL');

                html += `
            <div class="backup-file-item">
                <div class="backup-file-info">
                    <i class="fas fa-file-csv"></i>
                    <div class="backup-file-details">
                        <div class="backup-file-name">${backup.fileName}</div>
                        <div class="backup-file-meta">
                            <span><i class="fas fa-clock"></i> ${formattedDate}</span>
                            <span><i class="fas fa-hdd"></i> ${this.formatFileSize(backup.size)}</span>
                        </div>
                    </div>
                </div>
                <div class="backup-file-actions">
                    <button class="btn-view" onclick="shiftsManager.viewBackup('${backup.fileName}')">
                        <i class="fas fa-eye"></i> צפה
                    </button>
                    <button class="btn-restore" onclick="shiftsManager.restoreBackup('${backup.fileName}')">
                        <i class="fas fa-undo"></i> שחזר
                    </button>
                    <button class="btn-delete-backup" onclick="shiftsManager.deleteBackup('${backup.fileName}')">
                        <i class="fas fa-trash"></i> מחק
                    </button>
                </div>
            </div>
        `;
            });
            html += '</div>';

            container.innerHTML = html;
        } catch (error) {
            console.error('Error loading backups:', error);
            container.innerHTML = '<p style="text-align: center; color: #ff4757;">שגיאה בטעינת קבצי משמרות היסטורים</p>';
        }
    }

    // Restore backup file
    async restoreBackup(fileName) {
        if (!confirm(`האם אתה בטוח שברצונך לשחזר את הקובץ "${fileName}"?\nהקובץ הנוכחי יגובה אוטומטית.`)) {
            return;
        }

        try {
            const response = await fetch('/Shifts/RestoreBackup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(fileName)
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show('הקובץ שוחזר בהצלחה!', 'success');
                this.closeBackupModal();

                // Reload shifts table
                if (result.data) {
                    this.createShiftsTable(result.data);
                } else {
                    await this.loadShiftsTable();
                }
            } else {
                NotificationManager.show(result.message || 'שגיאה בשחזור הקובץ', 'error');
            }
        } catch (error) {
            console.error('Error restoring backup:', error);
            NotificationManager.show('שגיאה בשחזור הקובץ', 'error');
        }
    }

    // Delete backup file
    async deleteBackup(fileName) {
        if (!confirm(`האם אתה בטוח שברצונך למחוק את הגיבוי "${fileName}"?\nפעולה זו אינה ניתנת לביטול.`)) {
            return;
        }

        try {
            const response = await fetch('/Shifts/DeleteBackup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(fileName)
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show('הגיבוי נמחק בהצלחה!', 'success');

                // Reload backup files list
                await this.loadBackupFiles();
            } else {
                NotificationManager.show(result.message || 'שגיאה במחיקת הגיבוי', 'error');
            }
        } catch (error) {
            console.error('Error deleting backup:', error);
            NotificationManager.show('שגיאה במחיקת הגיבוי', 'error');
        }
    }

    // Format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Toggle Edit Mode with password protection
    toggleEditMode() {
        // Check password before entering edit mode
        if (!this.isEditMode) {
            // Check if password is cached
            if (this.isPasswordCached()) {
                this.enterEditMode();
                return;
            }

            // Need to show password modal
            this.showPasswordModal();
            return;
        }

        this.exitEditMode();
    }

    // Enter edit mode (separated from toggleEditMode)
    enterEditMode() {
        this.isEditMode = true;

        const table = document.querySelector('.shifts-table');
        const btnEdit = document.getElementById('btnEditShifts');
        const btnSave = document.getElementById('btnSaveShifts');
        const btnCancel = document.getElementById('btnCancelEdit');
        const indicator = document.getElementById('editModeIndicator');
        const message = document.getElementById('editModeMessage');
        const colorModeSelector = document.querySelector('.shifts-controls');
        const editControls = document.querySelector('.shifts-edit-controls');

        const uploadButton = document.querySelector('.btn-upload-shifts');
        const backupButton = document.querySelector('.btn-backup-shifts');
        const futureButton = document.querySelector('.btn-future-shifts');

        // Enter edit mode
        this.stopAutoRefresh(); // Stop auto refresh during edit
        this.originalData = this.cloneTableData();

        this.previousColorMode = this.colorMode;
        if (colorModeSelector) {
            colorModeSelector.style.display = 'none';
        }

        table.classList.add('edit-mode');
        if (editControls) {
            editControls.classList.add('edit-mode-active');
        }
        document.body.classList.add('shifts-edit-active');
        this.makeTableEditable();

        btnEdit.style.display = 'none';
        btnSave.style.display = 'flex';
        btnCancel.style.display = 'flex';
        indicator.style.display = 'inline-flex';
        message.style.display = 'inline-flex';
        uploadButton.style.display = 'none';
        backupButton.style.display = 'none';
        futureButton.style.display = 'none';

        this.loadShiftsTable().then(() => {
            table.classList.add('edit-mode');
            this.makeTableEditable();
        });

        NotificationManager.show('מצב עריכה פעיל - לחץ על תא לעריכה', 'info');
    }

    // Show password modal
    showPasswordModal() {
        // Create modal HTML if it doesn't exist
        if (!document.getElementById('passwordModal')) {
            const modalHTML = `
            <div id="passwordModal" class="modal-overlay">
                <div class="modal-content password-modal">
                    <div class="modal-header">
                        <h3><i class="fas fa-lock"></i> הזן סיסמה לעריכת משמרות</h3>
                        <button class="modal-close" onclick="shiftsManager.closePasswordModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="password-input-group">
                            <input 
                                type="password" 
                                id="editPasswordInput" 
                                class="password-input"
                                placeholder="הכנס סיסמה"
                                autocomplete="off"
                            />
                            <button class="btn-toggle-password" onclick="shiftsManager.togglePasswordVisibility()">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                        <div class="password-error" id="passwordError" style="display: none;">
                            <i class="fas fa-exclamation-circle"></i>
                            <span>סיסמה שגויה</span>
                        </div>
                        <div class="password-cache-info">
                            <i class="fas fa-info-circle"></i>
                            <span>הסיסמה תישמר למשך 5 דקות</span>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-cancel" onclick="shiftsManager.closePasswordModal()">
                            <i class="fas fa-times"></i> ביטול
                        </button>
                        <button class="btn-confirm" onclick="shiftsManager.verifyPassword()">
                            <i class="fas fa-check"></i> אישור
                        </button>
                    </div>
                </div>
            </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // Show modal
        const modal = document.getElementById('passwordModal');
        modal.style.display = 'flex';

        // Focus on input
        setTimeout(() => {
            const input = document.getElementById('editPasswordInput');
            input.value = '';
            input.focus();

            // Hide error if visible
            document.getElementById('passwordError').style.display = 'none';

            // Add Enter key listener
            input.onkeypress = (e) => {
                if (e.key === 'Enter') {
                    this.verifyPassword();
                }
            };
        }, 100);
    }

    // Check if password is still valid in cache
    isPasswordCached() {
        // First check memory
        if (this.passwordCache.isAuthenticated) {
            const now = Date.now();
            const elapsed = now - this.passwordCache.timestamp;

            if (elapsed < this.passwordCache.CACHE_DURATION) {
                this.extendPasswordCache();
                return true;
            }
        }

        // Check localStorage
        try {
            const cached = localStorage.getItem('shiftsPasswordCache');
            if (cached) {
                const data = JSON.parse(cached);
                const now = Date.now();
                const elapsed = now - data.timestamp;

                if (elapsed < this.passwordCache.CACHE_DURATION) {
                    // Restore to memory
                    this.passwordCache.isAuthenticated = true;
                    this.passwordCache.timestamp = data.timestamp;

                    // Set timeout for remaining time
                    const remainingTime = this.passwordCache.CACHE_DURATION - elapsed;
                    this.passwordCache.timeoutId = setTimeout(() => {
                        this.clearPasswordCache();
                        NotificationManager.show('פג תוקף האימות - יש להזין סיסמה מחדש', 'info');
                    }, remainingTime);

                    return true;
                } else {
                    // Expired - clear it
                    localStorage.removeItem('shiftsPasswordCache');
                }
            }
        } catch (error) {
            console.error('Error reading password cache:', error);
        }

        // Password expired or not found
        this.clearPasswordCache();
        return false;
    }

    // Set password as authenticated in cache
    setPasswordCache() {
        this.passwordCache.isAuthenticated = true;
        this.passwordCache.timestamp = Date.now();

        // Save to localStorage
        localStorage.setItem('shiftsPasswordCache', JSON.stringify({
            isAuthenticated: true,
            timestamp: this.passwordCache.timestamp
        }));

        // Clear any existing timeout
        if (this.passwordCache.timeoutId) {
            clearTimeout(this.passwordCache.timeoutId);
        }

        // Set timeout to clear cache after duration
        this.passwordCache.timeoutId = setTimeout(() => {
            this.clearPasswordCache();
            NotificationManager.show('פג תוקף האימות - יש להזין סיסמה מחדש', 'info');
        }, this.passwordCache.CACHE_DURATION);
    }

    // Extend password cache timeout
    extendPasswordCache() {
        this.passwordCache.timestamp = Date.now();

        // Update localStorage
        localStorage.setItem('shiftsPasswordCache', JSON.stringify({
            isAuthenticated: true,
            timestamp: this.passwordCache.timestamp
        }));

        // Clear existing timeout
        if (this.passwordCache.timeoutId) {
            clearTimeout(this.passwordCache.timeoutId);
        }

        // Set new timeout
        this.passwordCache.timeoutId = setTimeout(() => {
            this.clearPasswordCache();
            NotificationManager.show('פג תוקף האימות - יש להזין סיסמה מחדש', 'info');
        }, this.passwordCache.CACHE_DURATION);
    }

    // Clear password cache
    clearPasswordCache() {
        this.passwordCache.isAuthenticated = false;
        this.passwordCache.timestamp = null;

        // Clear from localStorage
        localStorage.removeItem('shiftsPasswordCache');

        if (this.passwordCache.timeoutId) {
            clearTimeout(this.passwordCache.timeoutId);
            this.passwordCache.timeoutId = null;
        }
    }

    // Get remaining cache time in seconds
    getRemainingCacheTime() {
        if (!this.passwordCache.isAuthenticated) {
            return 0;
        }

        const now = Date.now();
        const elapsed = now - this.passwordCache.timestamp;
        const remaining = this.passwordCache.CACHE_DURATION - elapsed;

        return Math.max(0, Math.floor(remaining / 1000));
    }

    // Format remaining time as MM:SS
    formatRemainingTime() {
        const seconds = this.getRemainingCacheTime();
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    // Close password modal
    closePasswordModal() {
        const modal = document.getElementById('passwordModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Toggle password visibility
    togglePasswordVisibility() {
        const input = document.getElementById('editPasswordInput');
        const button = document.querySelector('.btn-toggle-password i');

        if (input.type === 'password') {
            input.type = 'text';
            button.className = 'fas fa-eye-slash';
        } else {
            input.type = 'password';
            button.className = 'fas fa-eye';
        }
    }

    // Verify password
    verifyPassword() {
        const input = document.getElementById('editPasswordInput');
        const password = input.value;
        const errorDiv = document.getElementById('passwordError');

        if (password === this.editPassword) {
            // Correct password - cache it
            this.setPasswordCache();
            this.closePasswordModal();
            this.enterEditMode();
        } else {
            // Wrong password
            errorDiv.style.display = 'flex';
            input.value = '';
            input.focus();

            // Shake animation
            input.classList.add('shake');
            setTimeout(() => {
                input.classList.remove('shake');
            }, 500);
        }
    }

    // Make table editable
    makeTableEditable() {
        const table = document.querySelector('.shifts-table');
        const cells = table.querySelectorAll('td:not(.shift-name):not(.day-header):not(.date-header)');

        cells.forEach(cell => {
            cell.contentEditable = true;
            cell.addEventListener('input', (e) => this.handleCellEdit(e));
            cell.addEventListener('keydown', (e) => this.handleCellKeydown(e));
            cell.addEventListener('blur', (e) => this.handleCellBlur(e));
        });
    }

    // Handle cell edit
    handleCellEdit(event) {
        const cell = event.target;
        const cellId = this.getCellId(cell);

        if (!this.modifiedCells.has(cellId)) {
            this.modifiedCells.add(cellId);
            cell.classList.add('cell-modified');
            this.showUnsavedWarning();
        }
    }

    // Handle cell keydown
    handleCellKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.moveToNextCell(event.target, 'down');
        } else if (event.key === 'Tab') {
            event.preventDefault();
            this.moveToNextCell(event.target, event.shiftKey ? 'left' : 'right');
        } else if (event.key === 'Escape') {
            event.target.blur();
        }
    }

    // Handle cell blur
    handleCellBlur(event) {
        const cell = event.target;
        cell.textContent = cell.textContent.trim();
    }

    // Move to next cell
    moveToNextCell(currentCell, direction) {
        const table = document.querySelector('.shifts-table');
        const cells = Array.from(table.querySelectorAll('td[contenteditable="true"]'));
        const currentIndex = cells.indexOf(currentCell);

        let nextIndex;
        const rowLength = table.rows[0].cells.length - 1; // Exclude shift name column

        switch (direction) {
            case 'right':
                nextIndex = currentIndex + 1;
                break;
            case 'left':
                nextIndex = currentIndex - 1;
                break;
            case 'down':
                nextIndex = currentIndex + rowLength;
                break;
            case 'up':
                nextIndex = currentIndex - rowLength;
                break;
        }

        if (nextIndex >= 0 && nextIndex < cells.length) {
            cells[nextIndex].focus();
        }
    }

    // Get cell ID
    getCellId(cell) {
        const row = cell.parentElement.rowIndex;
        const col = cell.cellIndex;
        return `${row}-${col}`;
    }

    // Clone table data
    cloneTableData() {
        const table = document.querySelector('.shifts-table');
        const data = [];

        for (let i = 0; i < table.rows.length; i++) {
            const row = [];
            for (let j = 0; j < table.rows[i].cells.length; j++) {
                row.push(table.rows[i].cells[j].textContent.trim());
            }
            data.push(row);
        }

        return data;
    }

    // Show unsaved warning
    showUnsavedWarning() {
        const warning = document.getElementById('unsavedChangesWarning');
        warning.classList.add('show');
    }

    // Hide unsaved warning
    hideUnsavedWarning() {
        const warning = document.getElementById('unsavedChangesWarning');
        warning.classList.remove('show');
    }

    // Save changes
    async saveChanges() {
        if (this.modifiedCells.size === 0) {
            NotificationManager.show('אין שינויים לשמירה', 'info');
            return;
        }

        if (!confirm(`האם לשמור ${this.modifiedCells.size} שינויים?`)) {
            return;
        }

        const overlay = document.getElementById('shiftsLoadingOverlay');
        overlay.classList.add('show');

        try {
            // Get current table data
            const response = await fetch('/Shifts/GetShiftsTable');
            const originalData = await response.json();

            // Apply changes to original data
            const updatedData = this.applyChangesToOriginalData(originalData);
            const csvContent = this.convertStructuredDataToCSV(updatedData);

            const saveResponse = await fetch('/Shifts/SaveShiftsTable', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ csvContent })
            });

            const result = await saveResponse.json();

            if (result.success) {
                NotificationManager.show('השינויים נשמרו בהצלחה!', 'success');
                this.modifiedCells.clear();
                this.hideUnsavedWarning();
                this.exitEditMode();
                await this.loadShiftsTable();
            } else {
                NotificationManager.show(result.message || 'שגיאה בשמירת השינויים', 'error');
            }
        } catch (error) {
            console.error('Error saving changes:', error);
            NotificationManager.show('שגיאה בשמירת השינויים', 'error');
        } finally {
            overlay.classList.remove('show');
        }
    }

    // Apply changes to original structured data
    applyChangesToOriginalData(originalData) {
        const table = document.querySelector('.shifts-table');

        // עדכון כותרות
        for (let i = 0; i < originalData.headers.length; i++) {
            const headerCell = table.rows[0].cells[i + 1]; // +1 לעמודת שם המשמרת
            if (headerCell) {
                originalData.headers[i] = headerCell.textContent.trim();
            }
        }

        // עדכון כותרות ימים
        for (let i = 0; i < originalData.dayHeaders.length; i++) {
            const dayCell = table.rows[1].cells[i + 1]; // +1 לעמודת שם המשמרת
            if (dayCell) {
                originalData.dayHeaders[i] = dayCell.textContent.trim();
            }
        }

        // מעקב אחר אינדקס השורה בטבלה
        let tableRowIndex = 2; // התחלה אחרי הכותרות

        // עדכון נתוני המשמרות
        for (let shiftIndex = 0; shiftIndex < originalData.rows.length; shiftIndex++) {
            const shiftGroup = originalData.rows[shiftIndex];

            for (let rowIndex = 0; rowIndex < shiftGroup.rows.length; rowIndex++) {
                if (tableRowIndex < table.rows.length) {
                    const tableRow = table.rows[tableRowIndex];
                    const dataRow = shiftGroup.rows[rowIndex];

                    // קביעת היסט התאים בהתאם לשורה
                    let cellOffset = (rowIndex === 0) ? 1 : 0;

                    // עדכון תאי הנתונים
                    for (let i = 1; i < dataRow.length; i++) {
                        const cellIndex = i - 1 + cellOffset;
                        if (cellIndex < tableRow.cells.length) {
                            dataRow[i] = tableRow.cells[cellIndex].textContent.trim();
                        }
                    }

                    tableRowIndex++;
                }
            }

            // דילוג על שורת ההפרדה בין המשמרות (אם קיימת)
            if (shiftIndex < originalData.rows.length - 1 &&
                tableRowIndex < table.rows.length &&
                table.rows[tableRowIndex].classList.contains('shift-separator')) {
                tableRowIndex++;
            }
        }

        return originalData;
    }

    // Convert structured data back to CSV
    convertStructuredDataToCSV(data) {
        const lines = [];

        // הוספת כותרות תאריכים
        lines.push(',' + data.headers.join(','));

        // הוספת כותרות ימים
        lines.push(',' + data.dayHeaders.join(','));

        // הוספת שורות המשמרות
        data.rows.forEach(shiftGroup => {
            shiftGroup.rows.forEach((row, rowIndex) => {
                // טיפול בשורה הראשונה של כל משמרת
                if (rowIndex === 0) {
                    // שורה ראשונה של משמרת - כולל שם המשמרת
                    lines.push(shiftGroup.shiftName + ',' + row.slice(1).map(cell => this.escapeCsvValue(cell)).join(','));
                } else {
                    // שורות אחרות - עמודה ראשונה ריקה
                    lines.push(',' + row.slice(1).map(cell => this.escapeCsvValue(cell)).join(','));
                }
            });
        });

        return lines.join('\n');
    }

    // פונקציית עזר לטיפול בתווים מיוחדים ב-CSV
    escapeCsvValue(value) {
        if (!value) return '';

        // אם הערך מכיל פסיק, גרש או שורה חדשה, עטוף אותו במרכאות כפולות
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    // Extract table data
    extractTableData() {
        const table = document.querySelector('.shifts-table');
        const data = [];

        // Create a map to track rowspan cells
        const rowspanMap = new Map();

        for (let i = 0; i < table.rows.length; i++) {
            const row = [];
            const tableRow = table.rows[i];
            let colOffset = 0;

            for (let j = 0; j < tableRow.cells.length; j++) {
                const cell = tableRow.cells[j];

                // Check if there are rowspan cells from previous rows that should be in this position
                while (rowspanMap.has(`${i}-${j + colOffset}`)) {
                    row.push(rowspanMap.get(`${i}-${j + colOffset}`));
                    colOffset++;
                }

                const value = cell.textContent.trim();
                row.push(value);

                // If this cell has rowspan, store it for future rows
                if (cell.rowSpan > 1) {
                    for (let k = 1; k < cell.rowSpan; k++) {
                        rowspanMap.set(`${i + k}-${j + colOffset}`, value);
                    }
                }

                // If this cell has colspan, add empty cells
                if (cell.colSpan > 1) {
                    for (let k = 1; k < cell.colSpan; k++) {
                        row.push('');
                    }
                }
            }

            // Add any remaining rowspan cells at the end of the row
            let finalColIndex = row.length;
            while (rowspanMap.has(`${i}-${finalColIndex}`)) {
                row.push(rowspanMap.get(`${i}-${finalColIndex}`));
                finalColIndex++;
            }

            data.push(row);
        }

        return data;
    }

    // Convert to CSV
    convertToCSV(data) {
        return data.map(row => {
            return row.map(cell => {
                // Escape commas and quotes
                if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
                    return `"${cell.replace(/"/g, '""')}"`;
                }
                return cell;
            }).join(',');
        }).join('\n');
    }

    // Cancel edit
    cancelEdit() {
        if (this.modifiedCells.size > 0) {
            if (!confirm('יש שינויים שלא נשמרו. האם לבטל את העריכה?')) {
                return;
            }
        }

        this.exitEditMode();

        NotificationManager.show('העריכה בוטלה', 'info');
    }

    // Exit edit mode
    exitEditMode() {
        const table = document.querySelector('.shifts-table');
        const btnEdit = document.getElementById('btnEditShifts');
        const btnSave = document.getElementById('btnSaveShifts');
        const btnCancel = document.getElementById('btnCancelEdit');
        const indicator = document.getElementById('editModeIndicator');
        const message = document.getElementById('editModeMessage');
        const colorModeSelector = document.querySelector('.shifts-controls');
        const editControls = document.querySelector('.shifts-edit-controls');

        const uploadButton = document.querySelector('.btn-upload-shifts');
        const backupButton = document.querySelector('.btn-backup-shifts');
        const futureButton = document.querySelector('.btn-future-shifts');

        this.isEditMode = false;
        table.classList.remove('edit-mode');

        if (editControls) {
            editControls.classList.remove('edit-mode-active');
        }
        document.body.classList.remove('shifts-edit-active');

        // Remove contentEditable from all cells
        const cells = table.querySelectorAll('td[contenteditable="true"]');
        cells.forEach(cell => {
            cell.contentEditable = false;
            cell.classList.remove('cell-modified');
        });

        btnEdit.style.display = 'flex';
        btnSave.style.display = 'none';
        btnCancel.style.display = 'none';
        indicator.style.display = 'none';
        message.style.display = 'none';
        uploadButton.style.display = 'flex';
        backupButton.style.display = 'flex';
        futureButton.style.display = 'flex';

        if (this.previousColorMode !== null) {
            this.colorMode = this.previousColorMode;
            this.previousColorMode = null;
        }

        if (colorModeSelector) {
            colorModeSelector.style.display = 'flex';
        }

        this.modifiedCells.clear();
        this.hideUnsavedWarning();

        this.loadShiftsTable();
        // Restart auto refresh after exiting edit mode
        this.startAutoRefresh();
    }

    // Restore table data
    restoreTableData(data) {
        const table = document.querySelector('.shifts-table');

        for (let i = 0; i < data.length && i < table.rows.length; i++) {
            for (let j = 0; j < data[i].length && j < table.rows[i].cells.length; j++) {
                table.rows[i].cells[j].textContent = data[i][j];
            }
        }
    }

    // Prevent navigation when unsaved changes
    setupBeforeUnload() {
        window.addEventListener('beforeunload', (e) => {
            if (this.isEditMode && this.modifiedCells.size > 0) {
                e.preventDefault();
                e.returnValue = 'יש שינויים שלא נשמרו. האם לעזוב את הדף?';
                return e.returnValue;
            }
        });
    }

    createShiftsTable(data) {
        const container = document.getElementById('shiftsTableContainer');
        let tableHTML = '<table class="shifts-table">';

        // Date headers
        tableHTML += '<tr><th></th>';
        data.headers.forEach((header, index) => {
            const isToday = this.isDateToday(header);
            tableHTML += `<th class="date-header ${isToday ? 'today-column' : ''}">${header}</th>`;
        });
        tableHTML += '</tr>';

        // Day headers
        tableHTML += '<tr><td class="shift-name"></td>';
        data.dayHeaders.forEach((day, index) => {
            const isToday = this.isHebrewToday(day);
            tableHTML += `<td class="day-header ${isToday ? 'today-column' : ''}">${day}</td>`;
        });
        tableHTML += '</tr>';

        // Shift rows
        for (let i = 0; i < data.rows.length; i++) {
            const shiftGroup = data.rows[i];
            const shiftClass = this.getShiftClass(shiftGroup.shiftName);

            shiftGroup.rows.forEach((row, rowIndex) => {
                tableHTML += '<tr>';

                if (rowIndex === 0) {
                    tableHTML += `<td class="shift-name" rowspan="${shiftGroup.rows.length}">
                    <i class="${shiftGroup.icon}"></i> ${shiftGroup.shiftName}
                </td>`;
                }

                for (let i = 1; i < row.length; i++) {
                    const cellValue = row[i] || '';
                    const isToday = i <= data.headers.length && this.isColumnToday(i - 1, data.headers, data.dayHeaders);

                    // Get employee color
                    const employeeColor = this.getEmployeeColor(cellValue);

                    // Build cell classes
                    let cellClasses = `${shiftClass} ${isToday ? 'today-column' : ''}`;
                    let cellStyle = '';

                    // Add color styling
                    if (employeeColor) {
                        if (this.colorMode !== 'none') {
                            cellClasses += ` color-${this.colorMode}`;

                            // במצב גרדיאנט - טקסט שחור, בשאר המצבים - טקסט לבן
                            if (this.colorMode === 'gradient') {
                                cellStyle = `data-employee-color="${employeeColor}" style="--employee-color: ${employeeColor}; color: #000; font-weight: 600;"`;
                            } else {
                                cellStyle = `data-employee-color="${employeeColor}" style="--employee-color: ${employeeColor}; color: white; font-weight: 600;"`;
                            }
                        } else {
                            // טקסט לבן לעובדים
                            cellStyle = `style="color: white; font-weight: 600;"`;
                        }
                    }
                    tableHTML += `<td class="${cellClasses}" ${cellStyle}>${cellValue}</td>`;
                }

                tableHTML += '</tr>';
            });

            // הוספת שורת רווח בין המשמרות (אם זו לא המשמרת האחרונה)
            if (i < data.rows.length - 1) {
                tableHTML += '<tr class="shift-separator" style="height:0.1px;">';
                tableHTML += `<td colspan="0" class="separator-cell" style="height:0.5px;"></td>`;
                tableHTML += '</tr>';
            }
        }

        tableHTML += '</table>';
        container.innerHTML = tableHTML;
    }

    // Check if Excel file has changes
    async checkExcelFileChanges() {
        try {
            const response = await fetch('/Shifts/CheckExcelFileModified');
            const result = await response.json();
            const updateButton = document.querySelector('.btn-load-excel');
            if (updateButton) {
                if (result.hasChanges) {
                    updateButton.style.display = 'flex';
                } else {
                    updateButton.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error checking Excel file changes:', error);
        }
    }

    // View backup file without restoring
    async viewBackup(fileName) {
        try {
            const response = await fetch('/Shifts/ViewBackup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(fileName)
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(`צפייה בגיבוי: ${fileName}`, 'info');

                // Set current preview file name
                this.currentPreviewFileName = fileName;
                // Create preview container if it doesn't exist
                this.showBackupPreview(result.data, fileName);

                // Close backup modal
                this.closeBackupModal();
            } else {
                NotificationManager.show(result.message || 'שגיאה בטעינת הגיבוי', 'error');
            }
        } catch (error) {
            console.error('Error viewing backup:', error);
            NotificationManager.show('שגיאה בטעינת הגיבוי', 'error');
        }
    }

    // Show backup preview
    showBackupPreview(data, fileName) {
        // Create modal if it doesn't exist
        if (!document.getElementById('backupPreviewModal')) {
            const modalHTML = `
            <div id="backupPreviewModal" class="modal-overlay">
                <div class="modal-content backup-preview-modal">
                    <div class="modal-header">
                        <h3><i class="fas fa-file-alt"></i> <span id="previewFileName"></span></h3>
                        <button class="modal-close" onclick="shiftsManager.closeBackupPreview()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="backup-preview-container" id="backupPreviewContainer"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn-email btn-primary" onclick="shiftsManager.sendPreviewEmail('backup')">
                            <i class="fas fa-envelope"></i> שלח במייל
                        </button>
                        <button class="btn-restore" onclick="shiftsManager.restoreFromPreview('${fileName}')">
                            <i class="fas fa-undo"></i> שחזר גיבוי זה
                        </button>
                        <button class="btn-cancel btn-secondary" onclick="shiftsManager.closeBackupPreview()">
                            <i class="fas fa-times"></i> סגור
                        </button>
                    </div>
                </div>
            </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // Update preview content
        document.getElementById('previewFileName').textContent = fileName;
        const container = document.getElementById('backupPreviewContainer');

        // Create table with the data
        let tableHTML = '<table class="shifts-table preview-table">';

        // Date headers
        tableHTML += '<tr><th></th>';
        data.headers.forEach((header, index) => {
            const isToday = this.isDateToday(header);
            tableHTML += `<th class="date-header ">${header}</th>`;
        });
        tableHTML += '</tr>';

        // Day headers
        tableHTML += '<tr><td class="shift-name"></td>';
        data.dayHeaders.forEach((day, index) => {
            const isToday = this.isHebrewToday(day);
            tableHTML += `<td class="day-header ">${day}</td>`;
        });
        tableHTML += '</tr>';

        // Shift rows
        for (let i = 0; i < data.rows.length; i++) {
            const shiftGroup = data.rows[i];
            const shiftClass = this.getShiftClass(shiftGroup.shiftName);

            shiftGroup.rows.forEach((row, rowIndex) => {
                tableHTML += '<tr>';

                if (rowIndex === 0) {
                    tableHTML += `<td class="shift-name" rowspan="${shiftGroup.rows.length}">
                <i class="${shiftGroup.icon}"></i> ${shiftGroup.shiftName}
            </td>`;
                }

                for (let i = 1; i < row.length; i++) {
                    const cellValue = row[i] || '';
                    const isToday = i <= data.headers.length && this.isColumnToday(i - 1, data.headers, data.dayHeaders);

                    // Get employee color
                    const employeeColor = this.getEmployeeColor(cellValue);

                    // Build cell classes
                    let cellClasses = `${shiftClass} `;
                    let cellStyle = '';

                    // Add color styling
                    if (employeeColor) {
                        if (this.colorMode !== 'none') {
                            cellClasses += ` color-${this.colorMode}`;

                            if (this.colorMode === 'gradient') {
                                cellStyle = `data-employee-color="${employeeColor}" style="--employee-color: ${employeeColor}; color: #000; font-weight: 600;"`;
                            } else {
                                cellStyle = `data-employee-color="${employeeColor}" style="--employee-color: ${employeeColor}; color: white; font-weight: 600;"`;
                            }
                        } else {
                            cellStyle = `style="color: white; font-weight: 600;"`;
                        }
                    }
                    tableHTML += `<td class="${cellClasses}" ${cellStyle}>${cellValue}</td>`;
                }

                tableHTML += '</tr>';
            });

            // הוספת שורת רווח בין המשמרות (אם זו לא המשמרת האחרונה)
            if (i < data.rows.length - 1) {
                tableHTML += '<tr class="shift-separator">';
                tableHTML += `<td colspan="${data.headers.length + 1}" class="separator-cell"></td>`;
                tableHTML += '</tr>';
            }
        }

        tableHTML += '</table>';
        container.innerHTML = tableHTML;

        // Show modal
        document.getElementById('backupPreviewModal').style.display = 'flex';
    }

    // Send email for preview tables (future shifts or backup)
    async sendPreviewEmail(type) {
        try {
            // Show loading overlay
            const overlay = document.getElementById('shiftsLoadingOverlay');
            overlay.classList.add('show');

            // Get the appropriate data based on type
            let data;
            let title;
            let currentModal;

            if (type === 'future') {
                // Get future shifts data
                const response = await fetch('/Shifts/GetFutureShifts');
                const result = await response.json();
                if (result.success) {
                    data = result.data;
                    title = 'משמרות עתידיות';
                    currentModal = document.getElementById('futureShiftsModal');
                } else {
                    NotificationManager.show('שגיאה בטעינת נתוני משמרות עתידיות', 'error');
                    overlay.classList.remove('show');
                    return;
                }
            } else if (type === 'backup') {
                // Get backup data
                const fileName = document.getElementById('previewFileName').textContent;
                const response = await fetch('/Shifts/ViewBackup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(fileName)
                });
                const result = await response.json();
                if (result.success) {
                    data = result.data;
                    title = fileName;
                    currentModal = document.getElementById('backupPreviewModal');
                } else {
                    NotificationManager.show('שגיאה בטעינת נתוני גיבוי', 'error');
                    overlay.classList.remove('show');
                    return;
                }
            }

            if (!data) {
                NotificationManager.show('לא נמצאו נתוני משמרות להצגה', 'error');
                overlay.classList.remove('show');
                return;
            }

            // סגירת המודל הנוכחי
            if (currentModal) {
                currentModal.style.display = 'none';
            }

            // שימוש בפתרון החדש - יצירת מייל HTML ופתיחתו ב-Outlook
            this.createShiftsEmailWithEml(data);

            overlay.classList.remove('show');
        } catch (error) {
            console.error('Error sending email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
            const overlay = document.getElementById('shiftsLoadingOverlay');
            overlay.classList.remove('show');
        }
    }

    // Close backup preview
    closeBackupPreview() {
        const modal = document.getElementById('backupPreviewModal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentPreviewFileName = null;
    }

    // Restore from preview
    restoreFromPreview(fileName) {
        if (fileName) {
            this.closeBackupPreview();
            this.restoreBackup(fileName);
        }
    }

    // Load shifts from Excel file
    async loadFromExcel() {
        if (!confirm('האם לטעון את המשמרות המעודכנות מתיקיית המשמרות?\nהקובץ הנוכחי יגובה אוטומטית.')) {
            return;
        }

        const overlay = document.getElementById('shiftsLoadingOverlay');
        overlay.classList.add('show');

        try {
            const response = await fetch('/Shifts/LoadFromExcel', {
                method: 'POST'
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show('המשמרות עודכנו בהצלחה!', 'success');

                // Hide the update button after successful load
                const updateButton = document.querySelector('.btn-load-excel');
                if (updateButton) {
                    updateButton.style.display = 'none';
                }

                // Reload shifts table
                if (result.data) {
                    this.createShiftsTable(result.data);
                } else {
                    await this.loadShiftsTable();
                }
            } else {
                NotificationManager.show(result.message || 'שגיאה בטעינת קובץ Excel', 'error');
            }
        } catch (error) {
            console.error('Error loading from Excel:', error);
            NotificationManager.show('שגיאה בטעינת קובץ Excel', 'error');
        } finally {
            overlay.classList.remove('show');
        }
    }

    // Start auto refresh
    startAutoRefresh() {
        // Clear existing interval if any
        this.stopAutoRefresh();

        // Set new interval - refresh every this.AUTO_REFRESH_MINUTES
        this.autoRefreshInterval = setInterval(() => {
            if (!this.isEditMode) {
                this.loadShiftsTable();
            }
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000);
    }

    // Stop auto refresh
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }
}