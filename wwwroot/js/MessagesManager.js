class MessagesManager {
    constructor() {
        this.allMessages = [];
        this.bookmarkedMessages = JSON.parse(localStorage.getItem('bookmarkedMessages') || '[]');
        this.draggedElement = null;
        this.draggedMessageId = null;
        this.employees = [];
        this.dueDatePicker = null;
        this.searchDatePicker = null; // New property for search date picker
        this.currentSearchText = ''; // Track current search text
        this.currentSearchDate = ''; // Track current search date
        this.currentTimeFilter = 'today'; // today, future, history, all
        this.currentCategoryFilter = 'all';

        this.attachedEmails = []; // מערך לשמירת קבצי המייל המצורפים

        this.alarmCheckInterval = null;
        this.shownAlarms = new Set(); // למעקב אחרי התראות שכבר הוצגו

        // Pagination properties
        this.itemsPerPage = 9; // 9 משימות בעמוד
        this.currentPage = 1;
        this.totalPages = 1;
        this.paginatedMessages = [];

        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;

        // הוסף שדות חדשים למיפוי מיילים
        this.emailMappingPath = '/Messages/GetEmailMapping'; // נתיב לקבלת מיפוי מיילים מהשרת
        this.emailMappingCache = null; // מטמון למיפוי מיילים
        this.missingEmailMappings = new Set(); // שמירת שמות שלא נמצאו במיפוי


        this.setupSearch();
        this.setupFilters();
        this.initializeFilterCollapse();
        this.updateActiveFiltersDisplay();
        this.setupCategoryListener();
        this.setupEmailDragDrop();
        this.setupExcelJobsUpload();
        this.startAlarmMonitoring();
        this.preloadEmailCache();
        this.setupPopupClickHandling();
        this.setupShiftAttachmentsUpload();
        this.setupPasteImageListener();
        this.setupAlertImageDragDrop();
        this.setupTablePasteSupport();
        this.addTableStyles();
    }

    async loadEmployees() {
        try {
            const response = await fetch('/EmployeeTasks/GetEmployees');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const employees = await response.json();
            this.employees = employees;
            this.populateAuthorSelect();
        } catch (error) {
            console.error('Error fetching employees:', error);
            // Fallback to text input if employees can't be loaded
            this.handleEmployeeLoadError();
        }
    }

    // פונקציה מונעת סגירה של כל הפופאפים בלחיצה מחוץ להם
    setupPopupClickHandling() {
        // מאזין לאירועי לחיצה על כפתורי סגירה בלבד
        document.addEventListener('click', (e) => {
            // רשימת כל הפופאפים וכפתורי הסגירה שלהם
            const popups = [
                { id: 'messagePopup', closeSelector: '.message-popup-close', closeFunction: () => this.closeMessagePopup() },
                { id: 'addMessageModal', closeSelector: '.close-btn', closeFunction: () => this.closeAddMessageModal() },
                { id: 'simpleDocumentModal', closeSelector: '.close-btn', closeFunction: () => this.closeDocumentModal() },
                { id: 'employeeSelectionModal', closeSelector: '.close-btn', closeFunction: () => this.closeEmployeeSelectionModal() },
                { id: 'runningEmployeeSelectionModal', closeSelector: '.close-btn', closeFunction: () => this.closeRunningEmployeeSelectionModal() },
            ];

            // בדוק אם הלחיצה היא על כפתור סגירה של אחד הפופאפים
            for (const popup of popups) {
                const popupElement = document.getElementById(popup.id);
                if (!popupElement || popupElement.style.display !== 'block') continue;

                const closeBtn = popupElement.querySelector(popup.closeSelector);
                if (closeBtn && closeBtn.contains(e.target)) {
                    // הלחיצה היא על כפתור סגירה, הפעל את פונקציית הסגירה המתאימה
                    popup.closeFunction();
                    return;
                }
            }
        });

        // מניעת סגירה בלחיצה מחוץ לפופאפ - הוסף מאזין לכל פופאפ
        const preventOutsideClick = (e) => {
            // אם הלחיצה היא על הרקע של הפופאפ (ולא על התוכן)
            if (e.target.classList.contains('modal-overlay') ||
                e.target.id === 'messagePopup' ||
                e.target.id === 'addMessageModal' ||
                e.target.id === 'simpleDocumentModal' ||
                e.target.id === 'employeeSelectionModal' ||
                e.target.id === 'runningEmployeeSelectionModal') {

                // מנע את ברירת המחדל (סגירת הפופאפ)
                e.stopPropagation();
                e.preventDefault();
            }
        };

        // הוסף את מאזין האירועים לכל הפופאפים
        document.addEventListener('click', preventOutsideClick, true);
    }

    saveLastSelectedAuthor(authorName) {
        if (authorName && authorName !== '' && authorName !== 'other') {
            localStorage.setItem('lastSelectedEmployee', authorName);
        }
    }

    // Get last selected author from localStorage
    getLastSelectedAuthor() {
        return localStorage.getItem('lastSelectedEmployee') || '';
    }

    // Set default author in select dropdown
    setDefaultAuthor() {
        const authorSelect = document.getElementById('messageAuthor');
        if (!authorSelect) return;

        const lastAuthor = this.getLastSelectedAuthor();
        if (lastAuthor) {
            // Check if author exists in options
            const optionExists = Array.from(authorSelect.options).some(
                option => option.value === lastAuthor
            );

            if (optionExists) {
                authorSelect.value = lastAuthor;
            }
        }
    }

    // Get current active filter/category
    getCurrentCategory() {
        const activeTab = document.querySelector('.notices-category-filter-tab.active');
        if (!activeTab) return '';

        const filterText = activeTab.textContent.trim();

        // Map filter names to category values
        const categoryMap = {
            'רשימות': 'רשימות',
            'דוחות UC4': 'דוחות UC4',
            'סיכומי משמרת': 'סיכומי משמרת',
            'בקשות וביצוע': 'בקשות וביצוע',
            'כללי': 'כללי',
            'דחוף': 'דחוף',
            'אישורי כניסה': 'אישורי כניסה',
        };

        return categoryMap[filterText] || 'כללי';
    }

    // Set default category based on current filter
    setDefaultCategory() {
        const categorySelect = document.getElementById('messageCategory');
        if (!categorySelect) return;

        const category = this.getCurrentCategory();
        categorySelect.value = category
        this.updateFormFieldsByCategory(category);
    }

    populateAuthorSelect() {
        const authorSelect = document.getElementById('messageAuthor');
        if (!authorSelect) return;

        // Clear existing options except the first one
        authorSelect.innerHTML = '<option value="">בחר מחבר...</option>';

        // Add employee options
        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.name;
            option.textContent = employee.name;
            authorSelect.appendChild(option);
        });

        // Set last selected author as default (shared with DailyTasksManager)
        this.setDefaultAuthor();
    }

    handleEmployeeLoadError() {
        const authorSelect = document.getElementById('messageAuthor');
        if (authorSelect) {
            // Convert select back to input if needed
            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'messageAuthor';
            input.className = 'form-input';
            input.placeholder = 'מנהל מערכת';
            authorSelect.parentNode.replaceChild(input, authorSelect);
        }
    }

    // פונקציה חדשה להצגת דיאלוג עם שמות חסרים במיפוי
    showMissingEmailMappingsDialog(missingNames, callback) {
        // יצירת מודל אם לא קיים
        let modal = document.getElementById('missingEmailMappingsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'missingEmailMappingsModal';
            modal.className = 'modal-overlay';

            modal.innerHTML = `
            <div class="modal-content missing-emails-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-exclamation-triangle"></i> שמות חסרים במיפוי מיילים</h3>
                    <button class="modal-close" id="closeMissingEmailsBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p>השמות הבאים לא נמצאו במיפוי המיילים:</p>
                    <div id="missingNamesContainer" class="missing-names-container"></div>
                    <p>האם ברצונך להוסיף מיפויים אלה?</p>
                    <div id="addMappingsForm" class="add-mappings-form">
                        <table id="mappingsTable" class="mappings-table">
                            <thead>
                                <tr>
                                    <th>שם</th>
                                    <th>כתובת מייל</th>
                                </tr>
                            </thead>
                            <tbody id="mappingsTableBody">
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="modal-footer">
                    <button id="saveMappingsBtn" class="btn-primary">
                        <i class="fas fa-save"></i> שמור מיפויים
                    </button>
                    <button id="skipMappingsBtn" class="btn-secondary">
                        <i class="fas fa-forward"></i> דלג והמשך
                    </button>
                </div>
            </div>`;

            document.body.appendChild(modal);

            // הוסף CSS
            const style = document.createElement('style');
            style.textContent = `
            .missing-emails-modal {
                max-width: 600px;
                width: 90%;
            }
            .missing-names-container {
                margin: 15px 0;
                max-height: 150px;
                overflow-y: auto;
                padding: 10px;
                background: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 5px;
            }
            .missing-name-item {
                padding: 5px 10px;
                margin-bottom: 5px;
                background: #e9ecef;
                border-radius: 3px;
                display: inline-block;
                margin-left: 5px;
            }
            .mappings-table {
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
            }
            .mappings-table th, .mappings-table td {
                padding: 8px;
                border: 1px solid #dee2e6;
            }
            .mappings-table input {
                width: 100%;
                padding: 5px;
                border: 1px solid #ced4da;
                border-radius: 4px;
            }
            `;
            document.head.appendChild(style);
        }

        // מילוי השמות החסרים
        const missingNamesContainer = document.getElementById('missingNamesContainer');
        missingNamesContainer.innerHTML = '';

        missingNames.forEach(name => {
            const nameItem = document.createElement('span');
            nameItem.className = 'missing-name-item';
            nameItem.textContent = name;
            missingNamesContainer.appendChild(nameItem);
        });

        // מילוי טבלת המיפויים
        const mappingsTableBody = document.getElementById('mappingsTableBody');
        mappingsTableBody.innerHTML = '';

        missingNames.forEach(name => {
            const row = document.createElement('tr');

            // תא שם
            const nameCell = document.createElement('td');
            nameCell.textContent = name;
            row.appendChild(nameCell);

            // תא מייל
            const emailCell = document.createElement('td');
            const emailInput = document.createElement('input');
            emailInput.type = 'email';
            emailInput.placeholder = 'הזן כתובת מייל';
            emailInput.dataset.name = name;

            emailCell.appendChild(emailInput);
            row.appendChild(emailCell);

            mappingsTableBody.appendChild(row);
        });

        // הגדרת פעולות לכפתורים
        const closeMissingEmailsBtn = document.getElementById('closeMissingEmailsBtn');
        const saveMappingsBtn = document.getElementById('saveMappingsBtn');
        const skipMappingsBtn = document.getElementById('skipMappingsBtn');

        // הסרת מאזיני אירועים קודמים
        const newCloseMissingEmailsBtn = closeMissingEmailsBtn.cloneNode(true);
        const newSaveMappingsBtn = saveMappingsBtn.cloneNode(true);
        const newSkipMappingsBtn = skipMappingsBtn.cloneNode(true);

        closeMissingEmailsBtn.parentNode.replaceChild(newCloseMissingEmailsBtn, closeMissingEmailsBtn);
        saveMappingsBtn.parentNode.replaceChild(newSaveMappingsBtn, saveMappingsBtn);
        skipMappingsBtn.parentNode.replaceChild(newSkipMappingsBtn, skipMappingsBtn);

        // הוספת מאזיני אירועים חדשים
        newCloseMissingEmailsBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            // המשתמש בחר לבטל את שליחת המייל
            NotificationManager.show('שליחת המייל בוטלה', 'info');
        });

        newSkipMappingsBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            if (callback) callback();
        });

        newSaveMappingsBtn.addEventListener('click', async () => {
            // איסוף המיפויים החדשים
            const newMappings = [];
            const inputs = document.querySelectorAll('#mappingsTableBody input[type="email"]');

            inputs.forEach(input => {
                if (input.value && input.value.includes('@')) {
                    newMappings.push({
                        name: input.dataset.name,
                        email: input.value
                    });
                }
            });

            if (newMappings.length > 0) {
                // שמירת המיפויים החדשים
                const result = await this.saveNewEmailMappings(newMappings);

                if (result.success) {
                    NotificationManager.show('מיפויי המיילים נשמרו בהצלחה', 'success');

                    // עדכון המטמון המקומי
                    if (!this.emailMappingCache) {
                        this.emailMappingCache = {};
                    }

                    newMappings.forEach(mapping => {
                        this.emailMappingCache[mapping.name.toLowerCase()] = mapping.email;
                    });
                } else {
                    NotificationManager.show('שגיאה בשמירת מיפויי המיילים', 'error');
                }
            }

            modal.style.display = 'none';
            if (callback) callback();
        });

        // הצגת המודל
        modal.style.display = 'flex';
    }

    // פונקציה חדשה לשמירת מיפויי מיילים חדשים
    async saveNewEmailMappings(mappings) {
        try {
            const response = await fetch('/Messages/AddEmailMappings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ mappings })
            });

            return await response.json();
        } catch (error) {
            console.error('Error saving email mappings:', error);
            return { success: false, error: error.message };
        }
    }

    // פונקציה להכנת רשימות נמענים למייל UC4
    prepareUC4EmailRecipients(processedData) {
        const { jobsByResponsible, nullResponsibleJobs } = processedData;

        // בניית רשימת נמענים
        let toAddresses = ['NOC@MENORAMIVT.CO.IL']; // חדר מחשב

        // מערך עזר לעקוב אחרי כתובות שכבר נוספו (בצורת lowercase)
        let addedEmails = new Set(['noc@menoramivt.co.il']);

        // פונקציית עזר להוספת מיילים עם טיפול בפיצול לפי נקודה-פסיק
        const addEmailToList = (emailList, email, skipIfExists = true) => {
            if (!email) return;

            // פיצול במקרה של מספר מיילים מופרדים בנקודה-פסיק
            const emailParts = email.split(';');

            for (let part of emailParts) {
                part = part.trim();
                if (!part) continue;

                const emailLower = part.toLowerCase();

                // בדוק אם המייל כבר קיים (אם skipIfExists=true)
                if (skipIfExists && addedEmails.has(emailLower)) continue;

                emailList.push(part);
                addedEmails.add(emailLower);
            }
        };

        // הוספת אחראים לרשימת הנמענים
        for (const responsible of Object.keys(jobsByResponsible)) {
            // הוספת האחראי כנמען
            const email = this.getEmailByName(responsible);
            if (email) {
                addEmailToList(toAddresses, email);
            }
        }

        // רשימת עותקים קבועה
        let ccAddresses = [];
        const fixedCCs = [
            "yanivkat@menoramivt.co.il",
            "anata@menora.co.il",
            "borisk@menora.co.il"
        ];

        // הוסף את הכתובות הקבועות לרשימת העותקים אם הן לא כבר ברשימת הנמענים
        for (const ccEmail of fixedCCs) {
            addEmailToList(ccAddresses, ccEmail);
        }

        // הוספת אחראים משניים לעותקים
        for (const jobs of Object.values(jobsByResponsible)) {
            jobs.forEach(job => {
                if (job.responsibleUser1 && job.responsibleUser1 !== 'NULL') {
                    const email = this.getEmailByName(job.responsibleUser1);
                    if (email) {
                        addEmailToList(ccAddresses, email);
                    }
                }
            });
        }

        // הוספת אחראים משניים מג'ובים ללא אחראי
        nullResponsibleJobs.forEach(job => {
            if (job.responsibleUser1 && job.responsibleUser1 !== 'NULL') {
                const email = this.getEmailByName(job.responsibleUser1);
                if (email) {
                    addEmailToList(ccAddresses, email);
                }
            }
        });

        // אם יש ג'ובים ללא אחראי, הוסף את רשימת תפוצה צוות אוטומציה תהליכים לנמענים
        if (nullResponsibleJobs.length > 0) {
            const automationTeamEmail = "pdl-automationteam@menoramivt.net";
            addEmailToList(toAddresses, automationTeamEmail);
        }

        return { toAddresses, ccAddresses };
    }

    // פונקציה חדשה להעלאת קובץ מיפוי מיילים
    async uploadEmailMappingFile(file) {
        try {
            if (!file) {
                NotificationManager.show('לא נבחר קובץ', 'error');
                return { success: false };
            }

            // בדיקת סוג הקובץ
            const extension = file.name.split('.').pop().toLowerCase();
            if (extension !== 'csv') {
                NotificationManager.show('יש להעלות קובץ CSV בלבד', 'error');
                return { success: false };
            }

            // יצירת FormData
            const formData = new FormData();
            formData.append('file', file);

            // שליחת הקובץ לשרת
            const response = await fetch('/Messages/UploadEmailMapping', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show('קובץ מיפוי מיילים הועלה בהצלחה', 'success');

                // טעינה מחדש של המיפוי
                this.emailMappingCache = null;
                await this.loadEmailMapping();
                return { success: true };
            } else {
                NotificationManager.show(result.error || 'שגיאה בהעלאת הקובץ', 'error');
                return { success: false };
            }
        } catch (error) {
            console.error('Error uploading email mapping file:', error);
            NotificationManager.show('שגיאה בהעלאת קובץ מיפוי מיילים', 'error');
            return { success: false };
        }
    }

    // פונקציה לעיבוד נתוני הג'ובים מ-UC4
    processUC4JobData(tableData) {
        try {
            // מיפוי אינדקסים של העמודות הרלוונטיות
            const headers = tableData[0];
            const jobTypeIndex = headers.indexOf('Job Type');
            const jobNameIndex = headers.indexOf('Job Name');
            const jobParentIndex = headers.indexOf('Job Parent');
            const startTimeIndex = headers.indexOf('Start Time');
            const activationTimeIndex = headers.indexOf('Activation Time');
            const statusIndex = headers.indexOf('Status');
            const responsibleUserIndex = headers.indexOf('Responsible User');
            const responsibleUser1Index = headers.indexOf('Responsible User1');
            const departmentsIndex = headers.indexOf('Departments');

            // סינון רק ג'ובים מסוג JOBS
            const filteredJobs = tableData.slice(1).filter(row => {
                return row[jobTypeIndex] === 'JOBS';
            }).map(row => {
                // טיפול בתאריך Start Time
                let startTime = row[startTimeIndex];
                if (startTime && startTime.includes('1900')) {
                    startTime = row[activationTimeIndex]; // השתמש ב-Activation Time במקום
                }

                // החזר רק את העמודות הרלוונטיות
                return {
                    jobName: row[jobNameIndex] || '',
                    jobParent: row[jobParentIndex] || '',
                    startTime: startTime || '',
                    status: row[statusIndex] || '',
                    responsibleUser: row[responsibleUserIndex] || '',
                    responsibleUser1: row[responsibleUser1Index] || '',
                    departments: row[departmentsIndex] || ''
                };
            });

            // מיון לפי Start Time
            filteredJobs.sort((a, b) => {
                // פרסור תאריכים בפורמט DD.MM.YYYY HH:MM:SS
                const parseDate = (dateStr) => {
                    if (!dateStr) return new Date(0);

                    // פיצול התאריך והשעה
                    const [datePart, timePart] = dateStr.split(' ');

                    // פיצול חלקי התאריך
                    const [day, month, year] = datePart.split('.');

                    // יצירת מחרוזת תאריך בפורמט שנתמך: YYYY-MM-DD HH:MM:SS
                    const formattedDate = `${year}-${month}-${day} ${timePart}`;

                    return new Date(formattedDate);
                };

                const dateA = parseDate(a.startTime);
                const dateB = parseDate(b.startTime);

                return dateA - dateB; // מיון עולה (מוקדם לפני מאוחר)
            });

            // חלוקה לקבוצות לפי אחראים
            const jobsByResponsible = {};
            const nullResponsibleJobs = [];

            filteredJobs.forEach(job => {
                // אם אין אחראי ראשי או שהאחראי הראשי הוא NULL
                if (!job.responsibleUser || job.responsibleUser === 'NULL') {
                    // בדוק אם יש אחראי משנה תקין
                    if (job.responsibleUser1 && job.responsibleUser1 !== 'NULL') {
                        // אם יש אחראי משנה תקין, הוסף לרשימה שלו
                        if (!jobsByResponsible[job.responsibleUser1]) {
                            jobsByResponsible[job.responsibleUser1] = [];
                        }
                        jobsByResponsible[job.responsibleUser1].push(job);
                    } else {
                        // אם אין אחראי משנה תקין, הוסף לרשימת nullResponsibleJobs
                        nullResponsibleJobs.push(job);
                    }
                }
                // אם יש אחראי ראשי
                else {
                    // הוסף לרשימת האחראי הראשי
                    if (!jobsByResponsible[job.responsibleUser]) {
                        jobsByResponsible[job.responsibleUser] = [];
                    }
                    jobsByResponsible[job.responsibleUser].push(job);
                }
            });

            return {
                jobsByResponsible,
                nullResponsibleJobs,
                allJobs: filteredJobs
            };
        } catch (error) {
            console.error('Error processing UC4 job data:', error);
            throw error;
        }
    }

    // פונקציה חדשה לעיבוד קובץ CSV של דוחות UC4
    async processUC4CsvFile(messageId) {
        try {
            // הצג אינדיקטור טעינה
            const overlay = document.getElementById('shiftsLoadingOverlay') || this.createLoadingOverlay();
            overlay.classList.add('show');

            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.csvFilePath) {
                NotificationManager.show('קובץ CSV לא נמצא', 'error');
                overlay.classList.remove('show');
                return null;
            }

            // קבל את הנתונים מהקובץ המקורי
            const response = await fetch(`/Messages/ParseCsv?filePath=${encodeURIComponent(message.csvFilePath)}`);
            const result = await response.json();

            if (!result.success || !result.data || result.data.length === 0) {
                NotificationManager.show('שגיאה בקריאת קובץ CSV', 'error');
                overlay.classList.remove('show');
                return null;
            }

            // מיזוג שורות עברית שנחתכו
            const mergedData = this.mergeHebrewLines(result.data);

            // מיפוי אינדקסים של העמודות הרלוונטיות
            const headers = mergedData[0];
            const jobTypeIndex = headers.indexOf('Job Type');
            const jobNameIndex = headers.indexOf('Job Name');
            const jobParentIndex = headers.indexOf('Job Parent');
            const startTimeIndex = headers.indexOf('Start Time');
            const activationTimeIndex = headers.indexOf('Activation Time');
            const statusIndex = headers.indexOf('Status');
            const responsibleUserIndex = headers.indexOf('Responsible User');
            const responsibleUser1Index = headers.indexOf('Responsible User1');
            const departmentsIndex = headers.indexOf('Departments');

            // רשימת העמודות שנרצה לשמור
            const columnsToKeep = [
                'Job Type', 'Job Name', 'Job Parent', 'Start Time',
                'Status', 'Responsible User', 'Responsible User1'
            ];

            // יצירת מערך אינדקסים של העמודות שנרצה לשמור
            const indicesToKeep = columnsToKeep.map(col => headers.indexOf(col))
                .filter(index => index !== -1);

            // סינון רק ג'ובים מסוג JOBS ושמירת רק העמודות הרצויות
            const filteredData = [
                // שורת כותרות
                indicesToKeep.map(index => headers[index])
            ];

            // סינון השורות
            for (let i = 1; i < mergedData.length; i++) {
                const row = mergedData[i];

                // בדוק אם זה ג'וב מסוג JOBS
                if (jobTypeIndex !== -1 && row[jobTypeIndex] === 'JOBS') {
                    // טיפול בתאריך Start Time
                    if (startTimeIndex !== -1 && row[startTimeIndex] && row[startTimeIndex].includes('1900')) {
                        if (activationTimeIndex !== -1) {
                            row[startTimeIndex] = row[activationTimeIndex]; // השתמש ב-Activation Time במקום
                        }
                    }

                    // פורמט תאריכים ושעות
                    if (startTimeIndex !== -1 && row[startTimeIndex]) {
                        row[startTimeIndex] = this.formatDateTime(row[startTimeIndex]);
                    }

                    // שמור רק את העמודות הרצויות
                    const filteredRow = indicesToKeep.map(index => row[index] || '');
                    filteredData.push(filteredRow);
                }
            }

            // מיון לפי Start Time
            const startTimeFilteredIndex = filteredData[0].indexOf('Start Time');
            if (startTimeFilteredIndex !== -1) {
                const headerRow = filteredData.shift(); // שמור את שורת הכותרות

                filteredData.sort((a, b) => {
                    // פרסור תאריכים בפורמט DD.MM.YYYY HH:MM:SS
                    const parseDate = (dateStr) => {
                        if (!dateStr) return new Date(0);

                        // פיצול התאריך והשעה
                        const [datePart, timePart] = dateStr.split(' ');

                        // פיצול חלקי התאריך
                        const [day, month, year] = datePart.split('.');

                        // יצירת מחרוזת תאריך בפורמט שנתמך: YYYY-MM-DD HH:MM:SS
                        const formattedDate = `${year}-${month}-${day} ${timePart}`;

                        return new Date(formattedDate);
                    };

                    const dateA = parseDate(a[startTimeFilteredIndex]);
                    const dateB = parseDate(b[startTimeFilteredIndex]);

                    return dateA - dateB; // מיון עולה (מוקדם לפני מאוחר)
                });

                filteredData.unshift(headerRow); // החזר את שורת הכותרות
            }

            // יצירת תוכן CSV חדש
            const csvContent = filteredData.map(row => {
                // הקף כל תא במרכאות כפולות ודאג לטפל במרכאות כפולות בתוך התאים
                return row.map(cell => {
                    // המר את התא למחרוזת (למקרה שהוא מספר או null)
                    const cellStr = cell !== null && cell !== undefined ? String(cell) : '';

                    // אם התא מכיל פסיק, מרכאות כפולות או שורה חדשה, הקף אותו במרכאות כפולות
                    // והחלף מרכאות כפולות בתוך התא בזוג מרכאות כפולות
                    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                        return '"' + cellStr.replace(/"/g, '""') + '"';
                    }
                    return cellStr;
                }).join(',');
            }).join('\n');

            // שמירת הקובץ המעובד
            const fileName = `UC4_Jobs_Processed_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });

            // הסר את אינדיקטור הטעינה
            overlay.classList.remove('show');

            return {
                fileName: fileName,
                blob: blob,
                data: filteredData
            };
        } catch (error) {
            console.error('Error processing UC4 CSV file:', error);
            const overlay = document.getElementById('shiftsLoadingOverlay');
            if (overlay) overlay.classList.remove('show');
            NotificationManager.show('שגיאה בעיבוד קובץ CSV', 'error');
            return null;
        }
    }

    // פונקציה מעודכנת להכנת מייל UC4
    async prepareUC4JobsEmail(messageId) {
        try {
            // הצג אינדיקטור טעינה
            const overlay = document.getElementById('shiftsLoadingOverlay') || this.createLoadingOverlay();
            overlay.classList.add('show');

            // איפוס רשימת השמות החסרים
            this.missingEmailMappings.clear();

            // טען את מיפוי המיילים אם עוד לא נטען
            if (!this.emailMappingCache) {
                await this.loadEmailMapping();
            }

            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.tableData || message.tableData.length === 0) {
                NotificationManager.show('אין נתונים להכנת מייל', 'error');
                overlay.classList.remove('show');
                return;
            }

            // עיבוד קובץ ה-CSV
            const processedCsv = await this.processUC4CsvFile(messageId);
            if (!processedCsv) {
                overlay.classList.remove('show');
                return;
            }

            // עיבוד נתוני הטבלה מהקובץ המעובד
            const processedData = this.processUC4JobData(processedCsv.data);

            // בניית תוכן המייל
            const emailContent = await this.buildUC4JobsEmail(processedData, message.title);

            // הכנת רשימות נמענים
            const { toAddresses, ccAddresses } = this.prepareUC4EmailRecipients(processedData);

            // הגדר את קובץ ה-CSV המעובד כקובץ מצורף
            this.attachmentPaths = [];

            // יצירת URL לקובץ המעובד
            const csvUrl = URL.createObjectURL(processedCsv.blob);
            const csvLink = document.createElement('a');
            csvLink.href = csvUrl;
            csvLink.download = processedCsv.fileName;

            // הוסף את הקובץ המעובד לרשימת הקבצים המצורפים
            this.attachmentBlobs = [{
                name: processedCsv.fileName,
                blob: processedCsv.blob,
                type: 'text/csv'
            }];

            // הסר את אינדיקטור הטעינה
            overlay.classList.remove('show');

            // בדוק אם יש שמות חסרים במיפוי
            if (this.missingEmailMappings.size > 0) {
                this.showMissingEmailMappingsDialog([...this.missingEmailMappings], () => {
                    // פתח את המייל באאוטלוק עם הנמענים והעותקים אחרי שהמשתמש סגר את הדיאלוג
                    const subject = `דוח ג'ובים שנכשלו - ${message.title}`;
                    this.openEmailInOutlookWithBlobs(subject, emailContent, toAddresses.join(';'), ccAddresses.join(';'));
                });
            } else {
                // פתח את המייל באאוטלוק עם הנמענים והעותקים
                const subject = `דוח ג'ובים שנכשלו - ${message.title}`;
                this.openEmailInOutlookWithBlobs(subject, emailContent, toAddresses.join(';'), ccAddresses.join(';'));
            }

        } catch (error) {
            console.error('Error preparing UC4 jobs email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');

            const overlay = document.getElementById('shiftsLoadingOverlay');
            if (overlay) overlay.classList.remove('show');
        }
    }

    // פונקציה חדשה לפתיחת מייל עם קבצים מצורפים מ-Blob
    async openEmailInOutlookWithBlobs(subject, htmlBody, to, cc = "") {
        try {
            // יצירת גבול ייחודי להפרדת חלקי המייל
            const boundary = `----=_NextPart_${Math.random().toString(36).substring(2)}`;

            // הוסף קידוד UTF-8 מפורש
            let emlContent = `X-Unsent: 1
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"
To: ${to}`;

            // הוסף שדה CC אם יש
            if (cc) {
                emlContent += `
Cc: ${cc}`;
            }

            emlContent += `
Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=

--${boundary}
Content-Type: text/html; charset=UTF-8

${htmlBody}`;

            // הוסף קבצים מצורפים מ-Blob אם יש
            if (this.attachmentBlobs && this.attachmentBlobs.length > 0) {
                // הודעה למשתמש שמכינים את הקבצים המצורפים
                NotificationManager.show(`מכין ${this.attachmentBlobs.length} קבצים מצורפים...`, 'info');

                // הוסף כל קובץ מצורף
                for (const attachment of this.attachmentBlobs) {
                    try {
                        // המר את ה-Blob ל-base64
                        const reader = new FileReader();
                        const base64Promise = new Promise(resolve => {
                            reader.onloadend = () => {
                                const base64data = reader.result.split(',')[1];
                                resolve(base64data);
                            };
                        });
                        reader.readAsDataURL(attachment.blob);

                        const base64Data = await base64Promise;

                        // הוסף את הקובץ המצורף ל-EML
                        emlContent += `
--${boundary}
Content-Type: ${attachment.type}
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="${attachment.name}"

${base64Data}`;
                    } catch (error) {
                        console.error(`Error processing blob attachment ${attachment.name}:`, error);
                    }
                }
            }

            // סגור את הגבול
            emlContent += `
--${boundary}--`;

            const blob = new Blob([emlContent], { type: "message/rfc822" });
            const url = URL.createObjectURL(blob);

            // Create download link
            const a = document.createElement("a");
            a.href = url;
            a.download = `${subject.replace(/[^א-תa-zA-Z0-9]/g, '_')}.eml`;
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

            // Show user instructions with attachment info
            setTimeout(() => {
                this.showEmailInstructionsModal();
            }, 2000);

        } catch (error) {
            console.error('Error creating email with blobs:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
        }
    }

    // פונקציה לבניית תוכן המייל
    async buildUC4JobsEmail(processedData, title) {
        const { jobsByResponsible, nullResponsibleJobs, allJobs } = processedData;

        // יצירת רשימת אחראים לתצוגה בכותרת
        const responsibleList = Object.keys(jobsByResponsible).join(', ');

        let htmlContent = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; direction: rtl; }
            table { border-collapse: collapse; width: 100%; margin-top: 20px; margin-bottom: 30px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: right; }
            th { background-color: #f2f2f2; }
            .header { font-size: 18px; font-weight: bold; margin-bottom: 20px; }
            .section-header { 
                background-color: #e7f3fe;
                padding: 10px;
                margin-top: 30px;
                margin-bottom: 10px;
                border-right: 4px solid #2196F3;
                font-weight: bold;
            }
            .footer {
                margin-top: 30px;
                font-size: 12px;
                color: #666;
                border-top: 1px solid #ddd;
                padding-top: 10px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h2>דוח ג'ובים שנכשלו - ${title}</h2>
            <p>סה"כ: ${allJobs.length} ג'ובים</p>
        </div>`;

        // הוספת טבלה לג'ובים ללא אחראי אם יש כאלה
        if (nullResponsibleJobs.length > 0) {
            htmlContent += `
        <div class="section-header warning" style="background-color: #ffebee; color: #d32f2f; font-weight: bold; border-right: 4px solid #d32f2f !important;">
            ג'ובים ללא אחראי - צוות אוטומציה תהליכים, נדרש לעדכן אחראי (סה"כ: ${nullResponsibleJobs.length})
        </div>
        <table>
            <tr>
                <th>שם הג'וב</th>
                <th>Job Parent</th>
                <th>זמן התחלה</th>
                <th>סטטוס</th>
                <th>אחראי</th>
                <th>אחראי משנה / מנהל מחלקה</th>
                <th>מחלקות</th>
            </tr>`;

            // הוספת שורות הטבלה
            nullResponsibleJobs.forEach(job => {
                htmlContent += `
            <tr>
                <td>${job.jobName}</td>
                <td>${job.jobParent}</td>
                <td>${this.formatDateTime(job.startTime)}</td>
                <td>${job.status}</td>
                <td>${job.responsibleUser}</td>
                <td>${job.responsibleUser1}</td>
                <td>${job.departments}</td>
            </tr>`;
            });

            htmlContent += `</table>`;
        }

        // הוספת טבלה לכל אחראי
        for (const [responsible, jobs] of Object.entries(jobsByResponsible)) {
            htmlContent += `
        <div class="section-header">
            ג'ובים באחריות: ${responsible} (סה"כ: ${jobs.length})
        </div>
        
        <table>
            <tr>
                <th>שם הג'וב</th>
                <th>Job Parent</th>
                <th>זמן התחלה</th>
                <th>סטטוס</th>
                <th>אחראי משנה / מנהל מחלקה</th>
                <th>מחלקות</th>
            </tr>`;

            // הוספת שורות הטבלה
            jobs.forEach(job => {
                htmlContent += `
            <tr>
                <td>${job.jobName}</td>
                <td>${job.jobParent}</td>
                <td>${this.formatDateTime(job.startTime)}</td>
                <td>${job.status}</td>
                <td>${job.responsibleUser1}</td>
                <td>${job.departments}</td>
            </tr>`;
            });

            htmlContent += `</table>`;
        }

        htmlContent += `
        <p style="color:gray">הודעה זו נוצרה אוטומטית ממערכת NOC Portal</p>
</body>
</html>`;

        return htmlContent;
    }

    // Merge split Hebrew lines
    mergeHebrewLines(tableData) {
        if (!tableData || tableData.length <= 1) return tableData;

        const mergedData = [tableData[0]]; // Keep headers
        const columnCount = tableData[0].length;

        for (let i = 1; i < tableData.length; i++) {
            const currentRow = tableData[i];

            // בדיקה אם השורה מתחילה בעברית
            const startsWithHebrew = currentRow[0] && /[\u0590-\u05FF]/.test(currentRow[0][0]);

            // בדיקה אם השורה קצרה מדי (סימן שזה המשך של שורה קודמת)
            const isTooShort = currentRow.length < columnCount / 2;

            // בדיקה אם השורה ריקה ברובה
            const mostlyEmpty = currentRow.filter(cell => cell && cell.trim()).length < 3;

            if ((startsWithHebrew || isTooShort || mostlyEmpty) && mergedData.length > 1) {
                // אם זו שורה שנראית כהמשך של שורה קודמת
                const prevRow = mergedData[mergedData.length - 1];

                // מיזוג התוכן של השורה הנוכחית עם השורה הקודמת
                for (let j = 0; j < Math.min(currentRow.length, prevRow.length); j++) {
                    if (currentRow[j] && currentRow[j].trim()) {
                        prevRow[j] = (prevRow[j] || '') + ' ' + currentRow[j].trim();
                    }
                }
            } else {
                // אם זו שורה רגילה, הוסף אותה כרגיל
                mergedData.push(currentRow);
            }
        }

        return mergedData;
    }

    // פונקציה עזר לפורמט תאריך ושעה
    formatDateTime(dateTimeStr) {
        try {
            const date = new Date(dateTimeStr);
            if (isNaN(date.getTime())) return dateTimeStr;

            return date.toLocaleString('he-IL', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            }).replace(',', ''); // הסר את הפסיק
        } catch (error) {
            return dateTimeStr;
        }
    }

    async sendUC4JobsEmail(processedData, title) {
        try {
            const { jobsByResponsible, nullResponsibleJobs } = processedData;

            // בניית רשימת נמענים
            let toAddresses = ['NOC@MENORAMIVT.CO.IL']; // חדר מחשב
            let ccAddresses = [
                "yanivkat@menoramivt.co.il",
                "anata@menora.co.il",
                "borisk@menora.co.il"
            ];

            // הוספת אחראים לרשימת הנמענים
            for (const responsible of Object.keys(jobsByResponsible)) {
                // הוספת האחראי כנמען
                const email = this.getEmailByName(responsible);
                if (email && !toAddresses.includes(email)) {
                    toAddresses.push(email);
                }
            }

            // הוספת אחראים משניים לעותקים
            for (const jobs of Object.values(jobsByResponsible)) {
                jobs.forEach(job => {
                    if (job.responsibleUser1 && job.responsibleUser1 !== 'NULL') {
                        const email = this.getEmailByName(job.responsibleUser1);
                        if (email && !ccAddresses.includes(email)) {
                            ccAddresses.push(email);
                        }
                    }
                });
            }

            // הוספת אחראים משניים מג'ובים ללא אחראי
            nullResponsibleJobs.forEach(job => {
                if (job.responsibleUser1 && job.responsibleUser1 !== 'NULL') {
                    const email = this.getEmailByName(job.responsibleUser1);
                    if (email && !ccAddresses.includes(email)) {
                        ccAddresses.push(email);
                    }
                }
            });

            // בניית תוכן המייל
            const htmlContent = await this.buildUC4JobsEmail(processedData, title);

            // כותרת המייל
            const subject = `דוח ג'ובים שנכשלו - ${title}`;

            // שליחת המייל
            this.openEmailInOutlook(subject, htmlContent, toAddresses.join(';'), ccAddresses.join(';'));

            return { success: true };
        } catch (error) {
            console.error('Error sending UC4 jobs email:', error);
            NotificationManager.show('שגיאה בשליחת המייל', 'error');
            return { success: false, error: error.message };
        }
    }

    // פונקציה משופרת להמרת שם לכתובת מייל
    getEmailByName(name) {
        if (!name) return '';

        // Trim and clean the name
        name = name.trim();

        // Check if it's already an email address
        if (name.includes('@')) {
            return name;
        }

        // Handle comma-separated names by splitting and processing each name separately
        if (name.includes(',')) {
            // Split by comma and process each name
            const names = name.split(',').map(n => n.trim()).filter(n => n);

            // For each individual name, check mapping and add to missing if needed
            names.forEach(individualName => {
                if (individualName &&
                    !individualName.includes('@') &&
                    (!this.emailMappingCache || !this.emailMappingCache[individualName.toLowerCase()])) {
                    this.missingEmailMappings.add(individualName);
                }
            });

            // Return semicolon-separated list of emails
            const emails = names.map(n => this.getEmailByName(n));
            return emails.join(';');
        }

        // Check in mapping cache
        if (this.emailMappingCache && this.emailMappingCache[name.toLowerCase()]) {
            return this.emailMappingCache[name.toLowerCase()];
        }

        // Handle distribution lists
        if (name.includes("רשימת תפוצה")) {
            this.missingEmailMappings.add(name);
            return name;
        }

        // Check if name is in Hebrew
        const isHebrew = /[\u0590-\u05FF]/.test(name);

        if (isHebrew) {
            this.missingEmailMappings.add(name);
            return "noc@menoramivt.co.il";
        }

        this.missingEmailMappings.add(name);
        return `${name.replace(/\s+/g, '.')}@menoramivt.co.il`;
    }

    // פונקציה חדשה לטעינת מיפוי מיילים מהשרת
    async loadEmailMapping() {
        try {
            const response = await fetch(this.emailMappingPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success && data.mappings) {
                // יצירת מטמון למיפוי מיילים
                this.emailMappingCache = {};

                // מילוי המטמון
                data.mappings.forEach(mapping => {
                    if (mapping.users && mapping.emails) {
                        const userName = mapping.users.trim();
                        const email = mapping.emails.trim();

                        if (userName && email) {
                            this.emailMappingCache[userName.toLowerCase()] = email;
                        }
                    }
                });

                return true;
            } else {
                console.warn('No email mappings found or error in response');
                return false;
            }
        } catch (error) {
            console.error('Error loading email mappings:', error);
            return false;
        }
    }

    // Load messages from server
    async loadMessages() {
        if (!this.dueDatePicker) {
            this.initializeDatePickers();
        }
        if (!this.searchDatePicker) {
            this.initializeSearchDatePicker();
        }
        try {
            const response = await fetch('/Messages/GetMessages');
            const data = await response.json();

            if (data.error) {
                console.error('Error loading messages:', data.error);
                return;
            }

            // המרת קטגוריות ישנות לחדשות
            data.forEach(message => {
                // המרת 'ביצוע' ל'בקשות וביצוע'
                if (message.category === 'ביצוע') {
                    message.category = 'בקשות וביצוע';
                }
                // המרת 'בקשות' ל'בקשות וביצוע' אם יש משימות
                if (message.category === 'בקשות' && message.jobs && message.jobs.length > 0) {
                    message.category = 'בקשות וביצוע';
                }
                // המרת 'דוחות' ל'רשימות'
                if (message.category === 'דוחות') {
                    message.category = 'רשימות';
                }
            });

            // Don't sort by bookmark here - preserve server order
            this.allMessages = data;

            // Apply current filters and search
            this.applyFiltersAndSearch(true);

            if (!this.refreshInterval) {
                this.startAutoRefresh();
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
        }
    }

    // Setup filter event listeners
    setupFilters() {
        // Time filters
        document.querySelectorAll('.time-filter').forEach(filter => {
            filter.addEventListener('click', (e) => {
                const timeFilter = e.currentTarget.getAttribute('data-time');
                this.handleTimeFilterClick(timeFilter);
            });
        });

        // Category filters
        document.querySelectorAll('.notices-category-filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const category = e.currentTarget.getAttribute('data-category');
                this.handleCategoryFilterClick(category);
            });
            tab.addEventListener('dblclick', (e) => {
                const category = e.currentTarget.getAttribute('data-category');

                // אם זה טאב אישורי כניסה, פתח את מודל אישור הכניסה
                if (category === 'אישורי כניסה') {
                    this.openEntryPermitModal();
                } else {
                    // אחרת, פתח את מודל ההודעה הרגיל
                    this.openAddMessageModal();
                }
            });
        });
    }

    // Handle time filter clicks
    handleTimeFilterClick(timeFilter) {
        // Remove active class from all time filters
        document.querySelectorAll('.time-filter').forEach(f => f.classList.remove('active'));

        // Add active class to clicked filter
        const clickedFilter = document.querySelector(`.time-filter[data-time="${timeFilter}"]`);
        if (clickedFilter) {
            clickedFilter.classList.add('active');
        }

        // Update current time filter
        this.currentTimeFilter = timeFilter;

        // Update date search visibility
        this.updateDateSearchVisibility();

        // Reset pagination when filter changes
        this.resetPagination();

        // Apply filters
        this.applyFiltersAndSearch();
    }

    // Handle category filter clicks
    handleCategoryFilterClick(category) {
        // Remove active class from all category filters
        document.querySelectorAll('.notices-category-filter-tab').forEach(t => t.classList.remove('active'));

        // Add active class to clicked filter
        const clickedTab = document.querySelector(`.notices-category-filter-tab[data-category="${category}"]`);
        if (clickedTab) {
            clickedTab.classList.add('active');
        }

        // Update current category filter
        this.currentCategoryFilter = category;

        // Reset pagination when filter changes
        this.resetPagination();

        // Apply filters
        this.applyFiltersAndSearch();
    }

    // Setup search functionality
    setupSearch() {
        // Setup text search
        const searchInput = document.querySelector('#messagesContent .search-box input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearchInput(e);

                // Show/hide clear button based on input value
                const clearBtn = document.getElementById('clearMessagesSearchText');
                if (clearBtn) {
                    clearBtn.style.display = e.target.value ? 'flex' : 'none';
                }
            });
        }

        // Add clear button for text search
        const clearTextBtn = document.getElementById('clearMessagesSearchText');
        if (clearTextBtn) {
            clearTextBtn.addEventListener('click', () => this.clearSearchText());
        }

        // Add clear button for date search
        const clearDateBtn = document.getElementById('clearSearchDate');
        if (clearDateBtn) {
            clearDateBtn.addEventListener('click', () => this.clearSearchDate());
        }

        // Setup filter tabs
        this.setupFilterTabs();

        // Set initial date search visibility based on current filter
        this.updateDateSearchVisibility();
    }

    // Clear search text
    clearSearchText() {
        this.currentSearchText = '';
        const searchInput = document.querySelector('#messagesContent .search-box input');
        if (searchInput) {
            searchInput.value = '';
        }
        document.getElementById('clearMessagesSearchText').style.display = 'none';
        this.applyFiltersAndSearch();
    }


    // Display messages with pagination
    displayMessages(messages) {
        const noticesGrid = document.querySelector('.notices-grid');
        const staticCards = noticesGrid.querySelectorAll('.notice-card:not([data-message-id])');

        // Add paginated class to grid
        noticesGrid.classList.add('paginated');

        // Clear grid
        noticesGrid.innerHTML = '';

        // Re-add static cards
        staticCards.forEach(card => noticesGrid.appendChild(card));

        // Apply pagination
        const paginatedMessages = this.applyPagination(messages);

        // Only sort by bookmark if we're filtering by bookmarks
        const currentFilter = document.querySelector('.notices-category-filter-tab.active')?.textContent.trim();
        let displayMessages = paginatedMessages;

        if (currentFilter === 'מועדפים') {
            displayMessages = this.sortMessagesByBookmark(displayMessages);
        }

        // Add messages from file
        displayMessages.forEach(message => {
            const messageCard = this.createMessageCard(message);
            noticesGrid.appendChild(messageCard);
        });

        // Add drag and drop event listeners
        document.querySelectorAll('.notice-card[data-message-id]').forEach(card => {
            card.addEventListener('dragleave', this.handleDragLeave);
        });

        // Create pagination controls
        this.createPaginationControls(messages.length);
        this.showEntryPermitHistoryButton();
    }

    handleMessageDoubleClick(messageId) {
        const message = this.allMessages.find(m => m.id === messageId);
        if (!message) {
            NotificationManager.show('הודעה לא נמצאה', 'error');
            return;
        }

        try {
            this.openMessagePopup(messageId);
        } catch (error) {
            console.error('Error opening message popup:', error);
            this.openEditMessageModal(messageId);
        }
    }

    // Create message card HTML
    createMessageCard(message) {
        const card = document.createElement('div');
        const isBookmarked = this.isMessageBookmarked(message.id);
        const dueDateStatus = this.getDueDateStatus(message.dueDate);

        card.className = `notice-card ${this.getPriorityClass(message.priority)} ${isBookmarked ? 'bookmarked' : ''} ${dueDateStatus.class}`;
        card.setAttribute('data-message-id', message.id);
        card.setAttribute('draggable', 'true');
        card.setAttribute('ondragstart', `messagesManager.handleDragStart(event)`);
        card.setAttribute('ondragover', `messagesManager.handleDragOver(event)`);
        card.setAttribute('ondrop', `messagesManager.handleDrop(event)`);
        card.setAttribute('ondragend', `messagesManager.handleDragEnd(event)`);
        card.setAttribute('ondblclick', `messagesManager.handleMessageDoubleClick('${message.id}')`);

        const timeAgo = this.getTimeAgo(message.date);

        // יצירת תוכן לפי קטגוריה - ללא truncateText כאן!
        let contentHtml = '';

        switch (message.category) {
            case 'בקשות וביצוע':
                contentHtml = this.createExecutionContent(message);
                break;
            case 'בקשות':
                contentHtml = this.createRequestContent(message);
                break;
            case 'רשימות':
                contentHtml = this.createReportContent(message);
                break;
            case 'דוחות UC4':
                contentHtml = this.createReportContent(message);
                break;
            case 'סיכומי משמרת':
                contentHtml = this.createShiftSummaryContent(message);
                break;
            default:
                contentHtml = this.createGeneralContent(message);
        }

        card.innerHTML = `
        ${isBookmarked ? '<div class="bookmarked-indicator">★</div>' : ''}
        <div class="drag-handle" title="גרור לשינוי סדר">
            <i class="fas fa-grip-vertical"></i>
        </div>
        <div class="message-actions">
            <button class="duplicate-btn" onclick="messagesManager.duplicateMessage('${message.id}')" title="שכפל הודעה">
                <i class="fas fa-copy"></i>
            </button>
            <button class="edit-btn" onclick="messagesManager.openEditMessageModal('${message.id}')">
                <i class="fas fa-edit"></i>
            </button>
            <button class="delete-btn" onclick="messagesManager.deleteMessage('${message.id}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <div class="notice-header">
            <div class="notice-category">${message.category}</div>
            <div class="notice-update">
                ${message.lastModified ? '<i class="fas fa-clock"></i><br><small>עודכן: ' + this.getTimeAgo(message.lastModified) + '</small>' : ''}
            </div>
        </div>
        <h3 class="notice-title">${message.title}</h3>
        ${dueDateStatus.html} 
        ${contentHtml}
        <div class="notice-date">
            <i class="fas fa-clock"></i>
            ${timeAgo ? '<br><small>נוצר: ' + timeAgo + '</small>' : ''}
        </div>
        <div class="notice-footer">
            <div class="notice-author">
                <div class="author-avatar">${message.author.charAt(0)}</div>
                <span>${message.author}</span>
            </div>
            <div class="notice-actions">
                <button class="action-btn ${isBookmarked ? 'bookmarked' : ''}" onclick="messagesManager.toggleBookmark('${message.id}', this)">
                    <i class="fas fa-bookmark"></i>
                </button>
            </div>
        </div>
    `;

        return card;
    }

    createExecutionContent(message) {
        let html = '';
        if (message.jobs && message.jobs.length > 0) {
            // מיון הג'ובים לפני תצוגה
            const sortedJobs = [...message.jobs].sort((a, b) => {
                if (a.Order === -1 && b.Order === -1) return 0;
                if (a.Order === -1) return -1;
                if (b.Order === -1) return 1;
                return a.Order - b.Order;
            });

            html = '<div class="execution-jobs-preview">';

            if (sortedJobs.length > 0) {
                html += `<p class="more-jobs">בטבלת הביצוע קיימים ${sortedJobs.length} ג'ובים</p>`;
            }

            html += `<span class="read-more-btn" onclick="messagesManager.openMessagePopup('${message.id}')">צפה בטבלה המלאה</span>`;

        }

        // בדיקה אם יש מערך מיילים או מייל בודד
        let emailsHtml = '';
        if (message.attachedEmails && message.attachedEmails.length > 0) {
            // שימוש ב-encodeURIComponent כדי למנוע בעיות בקידוד
            const encodedPaths = encodeURIComponent(JSON.stringify(message.attachedEmails));
            emailsHtml = `<div class="attached-email" onclick="messagesManager.downloadAttachment('${encodedPaths}')">
            <i class="fas fa-envelope"></i>
            <span>${message.attachedEmails.length} מיילים מצורפים - לחץ לפתיחה</span>
        </div>`;
        } else if (message.attachedEmail) {
            // קידוד גם למייל בודד למקרה שיש בו תווים מיוחדים
            const encodedPath = encodeURIComponent(message.attachedEmail);
            emailsHtml = `<div class="attached-email" onclick="messagesManager.downloadAttachment('${encodedPath}')">
            <i class="fas fa-envelope"></i>
            <span>מייל מצורף - לחץ לפתיחה</span>
        </div>`;
        }

        html += emailsHtml;

        html += '</div>';
        return html;
    }

    createRequestContent(message) {
        const content = message.content || '';
        const truncatedContent = this.truncateText(content, 120);
        const needsReadMore = content.length > 120;

        let html = `<p class="notice-content">${truncatedContent}`;
        if (needsReadMore) {
            html += `<span class="read-more-btn" onclick="messagesManager.openMessagePopup('${message.id}')">קרא עוד</span>`;
        }
        html += '</p>';

        if (message.attachedEmail) {
            html += `<div class="attached-email" onclick="messagesManager.downloadAttachment('${message.attachedEmail}')">`;
            html += '<i class="fas fa-envelope"></i>';
            html += '<span>מייל מצורף - לחץ לפתיחה</span>';
            html += '</div>';
        }

        return html;
    }

    createReportContent(message) {
        let html = '<div class="report-preview">';
        html += '<i class="fas fa-table"></i>';
        html += '<p>דוח CSV</p>';

        if (message.tableData && message.tableData.length > 0) {
            html += `<small>${message.tableData.length} שורות</small>`;
        }

        html += `<span class="read-more-btn" onclick="messagesManager.openMessagePopup('${message.id}')">צפה בדוח המלא</span>`;

        html += '</div>';
        return html;
    }

    createShiftSummaryContent(message) {
        let html = '<div class="shift-summary-preview">';

        if (message.incidents) {
            html += `<div class="summary-section">`;
            html += `<strong><i class="fas fa-exclamation-triangle"></i> תקלות:</strong> `;

            // Check if content contains tables
            if (message.incidents.includes('<table')) {
                html += `<span class="table-indicator"><i class="fas fa-table"></i> מכיל טבלה</span>`;
            } else {
                html += `${this.truncateText(message.incidents, 50)}`;
            }

            html += `</div>`;
        }

        if (message.openAlerts) {
            html += `<div class="summary-section">`;
            html += `<strong><i class="fas fa-bell"></i> התראות פתוחות:</strong> `;

            // Check if content contains tables
            if (message.openAlerts.includes('<table')) {
                html += `<span class="table-indicator"><i class="fas fa-table"></i> מכיל טבלה</span>`;
            } else {
                html += `${this.truncateText(message.openAlerts, 50)}`;
            }

            html += `</div>`;
        }

        if (message.specialActions) {
            html += `<div class="summary-section">`;
            html += `<strong><i class="fas fa-tasks"></i> פעולות מיוחדות:</strong> `;

            // Check if content contains tables
            if (message.specialActions.includes('<table')) {
                html += `<span class="table-indicator"><i class="fas fa-table"></i> מכיל טבלה</span>`;
            } else {
                html += `${this.truncateText(message.specialActions, 50)}`;
            }

            html += `</div>`;
        }

        if (message.generalInfo) {
            html += `<div class="summary-section">`;
            html += `<strong><i class="fas fa-info-circle"></i> מידע כללי:</strong> `;

            // Check if content contains tables
            if (message.generalInfo.includes('<table')) {
                html += `<span class="table-indicator"><i class="fas fa-table"></i> מכיל טבלה</span>`;
            } else {
                html += `${this.truncateText(message.generalInfo, 50)}`;
            }

            html += `</div>`;
        }

        if (message.openItems) {
            html += `<div class="summary-section">`;
            html += `<strong><i class="fas fa-clipboard-list"></i> דברים פתוחים:</strong> `;

            // Check if content contains tables
            if (message.openItems.includes('<table')) {
                html += `<span class="table-indicator"><i class="fas fa-table"></i> מכיל טבלה</span>`;
            } else {
                html += `${this.truncateText(message.openItems, 50)}`;
            }

            html += `</div>`;
        }

        if (message.attachedEmails && message.attachedEmails.length > 0) {
            const encodedPaths = encodeURIComponent(JSON.stringify(message.attachedEmails));
            html += `<div class="attached-email" onclick="messagesManager.downloadAttachment('${encodedPaths}');">`;
            html += '<i class="fas fa-envelope"></i>';
            html += '<span>מייל מצורף - לחץ לפתיחה</span>';
            html += '</div>';
            html += '</br>';
        }

        html += `<span class="read-more-btn" onclick="messagesManager.openMessagePopup('${message.id}')">צפה בסיכום המלא</span>`;
        html += '</div>';

        return html;
    }

    createGeneralContent(message) {
        const content = message.content || ''; // הגנה מפני undefined
        const truncatedContent = this.truncateText(content, 120);
        const needsReadMore = content.length > 120;

        let html = `<p class="notice-content">${truncatedContent}`;
        if (needsReadMore) {
            html += `<span class="read-more-btn" onclick="messagesManager.openMessagePopup('${message.id}')">קרא עוד</span>`;
        }
        html += '</p>';

        return html;
    }

    getDueDateStatus(dueDate) {
        if (!dueDate) {
            return { class: '', html: '' };
        }

        let due;

        // Handle both DD/MM/YYYY and YYYY-MM-DD formats
        if (dueDate.includes('/')) {
            const [day, month, year] = dueDate.split('/');
            due = new Date(year, month - 1, day);
        } else {
            due = new Date(dueDate + 'T00:00:00');
        }

        if (isNaN(due.getTime())) {
            console.error('Invalid due date:', dueDate);
            return { class: '', html: '' };
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);

        const diffDays = Math.floor((due - now) / (1000 * 60 * 60 * 24));
        const formattedDate = `${String(due.getDate()).padStart(2, '0')}/${String(due.getMonth() + 1).padStart(2, '0')}/${due.getFullYear()}`;

        if (diffDays === 0) {
            return {
                class: 'due-today',
                html: `<div class="due-date due-today"><i class="fas fa-calendar-day"></i> תאריך יעד: היום</div>`
            };
        } else {
            return {
                class: 'due-future',
                html: `<div class="due-date due-future"><i class="fas fa-calendar"></i> תאריך יעד: ${formattedDate}</div>`
            };
        }
    }

    isMessagePast(message) {
        if (!message.dueDate) return false;

        let due;

        // Handle both DD/MM/YYYY and YYYY-MM-DD formats
        if (message.dueDate.includes('/')) {
            const [day, month, year] = message.dueDate.split('/');
            due = new Date(year, month - 1, day);
        } else {
            due = new Date(message.dueDate + 'T00:00:00');
        }

        if (isNaN(due.getTime())) {
            return false;
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);

        return due < now;
    }

    isMessageFuture(message) {
        if (!message.dueDate) return false;

        let due;

        // Handle both DD/MM/YYYY and YYYY-MM-DD formats
        if (message.dueDate.includes('/')) {
            const [day, month, year] = message.dueDate.split('/');
            due = new Date(year, month - 1, day);
        } else {
            due = new Date(message.dueDate + 'T00:00:00');
        }

        if (isNaN(due.getTime())) {
            return false;
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);

        return due > now;
    }

    // Add/Edit message
    async saveMessage(messageData, isEditing = false) {
        try {
            if (!messageData.title) {
                NotificationManager.show('כותרת נדרשת', 'error');
                return;
            }

            if (!messageData.author || messageData.author === "מנהל מערכת") {
                NotificationManager.show('חובה לבחור שם המחבר', 'error');
                return;
            }

            // Validation: Due date is required for "בקשות וביצוע" and 'סיכומי משמרת' category
            if (messageData.category === 'בקשות וביצוע' || messageData.category === 'סיכומי משמרת') {
                const dueDateValue = document.getElementById('messageDueDateHidden').value;
                if (!dueDateValue || dueDateValue.trim() === '') {
                    NotificationManager.show('תאריך יעד הוא שדה חובה עבור קטגוריית "' + messageData.category + '"', 'error');

                    // Highlight the due date field
                    const dueDateInput = document.getElementById('messageDueDate');
                    if (dueDateInput) {
                        dueDateInput.classList.add('error-highlight');
                        dueDateInput.focus();

                        // Remove highlight after 3 seconds
                        setTimeout(() => {
                            dueDateInput.classList.remove('error-highlight');
                        }, 3000);
                    }

                    return;
                }
            }


            // מערך לשמירת כל הבטחות העלאת הקבצים
            const uploadPromises = [];
            const uploadedFiles = {
                alertImages: [],
                attachments: []
            };

            // טיפול בקטגוריית סיכומי משמרת
            if (messageData.category === 'סיכומי משמרת') {
                // 1. איסוף כל הקבצים להעלאה - תמונות התראות
                const alertItemElements = document.querySelectorAll('.alert-item');
                for (const element of alertItemElements) {
                    const text = element.querySelector('.alert-text').value;

                    // אם יש קובץ תמונה חדש להעלאה
                    if (element.file) {
                        // יצירת שם ייחודי לקובץ אם צריך
                        if (element.file.name === 'image.png' || element.file.name === 'Screenshot.png') {
                            const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
                            const fileExtension = element.file.name.split('.').pop();
                            const newFileName = `alert_${uniqueId}.${fileExtension}`;
                            element.file = new File([element.file], newFileName, { type: element.file.type });
                        }

                        // הוספת הבטחת העלאה למערך
                        uploadPromises.push(
                            (async () => {
                                try {
                                    const uploadResult = await this.uploadFile(element.file, messageData.id || 'temp');
                                    if (uploadResult.success) {
                                        uploadedFiles.alertImages.push({
                                            text: text,
                                            imagePath: uploadResult.filePath
                                        });
                                    }
                                } catch (error) {
                                    console.error("Error uploading alert image:", error);
                                }
                            })()
                        );
                    } else if (element.dataset.imagePath) {
                        // אם יש נתיב תמונה קיים
                        uploadedFiles.alertImages.push({
                            text: text,
                            imagePath: element.dataset.imagePath
                        });
                    } else {
                        // אם אין תמונה, רק טקסט
                        uploadedFiles.alertImages.push({
                            text: text,
                            imagePath: null
                        });
                    }
                }

                // 2. איסוף קבצים מצורפים רגילים
                const attachmentsContainer = document.getElementById('shiftAttachmentsContainer');
                if (attachmentsContainer) {
                    const attachmentItems = attachmentsContainer.querySelectorAll('.attachment-preview-item');

                    for (const item of attachmentItems) {
                        if (item.file) {
                            // יצירת שם ייחודי לקובץ אם צריך
                            if (item.file.name === 'image.png' || item.file.name === 'Screenshot.png') {
                                const uniqueId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
                                const fileExtension = item.file.name.split('.').pop();
                                const newFileName = `attachment_${uniqueId}.${fileExtension}`;
                                item.file = new File([item.file], newFileName, { type: item.file.type });
                            }

                            // הוספת הבטחת העלאה למערך
                            uploadPromises.push(
                                (async () => {
                                    try {
                                        const uploadResult = await this.uploadFile(item.file, messageData.id || 'temp');
                                        if (uploadResult.success) {
                                            uploadedFiles.attachments.push(uploadResult.filePath);
                                        } else {
                                            console.error("Attachment upload failed:", uploadResult.error);
                                        }
                                    } catch (error) {
                                        console.error("Error uploading attachment:", error);
                                    }
                                })()
                            );
                        } else if (item.filePath) {
                            // אם יש נתיב קובץ קיים
                            uploadedFiles.attachments.push(item.filePath);
                        }
                    }
                }

                // 3. המתנה לסיום כל העלאות הקבצים
                await Promise.all(uploadPromises);

                // 4. עדכון נתוני ההודעה עם הקבצים שהועלו
                if (uploadedFiles.alertImages.length > 0) {
                    messageData.alertItems = uploadedFiles.alertImages;
                }

                if (uploadedFiles.attachments.length > 0) {
                    messageData.attachments = uploadedFiles.attachments;
                }

                // שאר שדות סיכום המשמרת
                messageData.incidents = document.getElementById('incidentsInput')?.value || '';
                messageData.openAlerts = document.getElementById('openAlertsInput')?.value || '';
                messageData.specialActions = document.getElementById('specialActionsInput')?.value || '';
                messageData.generalInfo = document.getElementById('generalInfoInput')?.value || '';
                messageData.openItems = document.getElementById('openItemsInput')?.value || '';
            }

            // טיפול בהעלאת קבצים
            const emailFile = document.getElementById('emailFileInput')?.files[0];
            const csvFile = document.getElementById('csvFileInput')?.files[0];
            const existingEmailPath = document.getElementById('existingEmailPath')?.value;
            const existingCsvPath = document.getElementById('existingCsvPath')?.value;

            let attachedEmail = null;
            let csvFilePath = null;

            // טיפול בהעלאת מספר קבצי מייל
            const emailsContainer = document.getElementById('emailsContainer');
            if (emailsContainer) {
                const emailItems = emailsContainer.querySelectorAll('.email-preview-item');

                if (emailItems.length > 0) {
                    const emailPaths = [];

                    // אסוף את כל נתיבי המיילים
                    for (const item of emailItems) {
                        // אם זה קובץ חדש שהועלה

                        if (item.file) {
                            const ext = item.file.name.split('.').pop().toLowerCase();
                            const allowed = ['eml', 'msg'];
                            if (!allowed.includes(ext)) {
                                NotificationManager.show(
                                    'לשדה מייל ניתן לצרף רק קבצי EML או MSG',
                                    'error'
                                );
                                return; // מפסיק שמירה
                            }

                            const uploadResult = await this.uploadFile(item.file, messageData.id || 'temp')

                            if (uploadResult.success) {
                                emailPaths.push(uploadResult.filePath);
                            }
                        }
                        // אם זה קובץ קיים
                        else if (item.filePath) {
                            emailPaths.push(item.filePath);
                        }
                    }

                    // שמירת נתיבי הקבצים בהודעה
                    if (emailPaths.length > 0) {
                        messageData.attachedEmails = emailPaths;
                    }
                }
            }
            // תאימות לאחור - טיפול במייל בודד
            else if (existingEmailPath) {
                messageData.attachedEmail = existingEmailPath;
            }

            // בפונקציה saveMessage, וודא שהנתיבים מועברים כראוי
            if (messageData.category === 'בקשות וביצוע' || messageData.category === 'בקשות') {
                if (messageData.attachedEmails && messageData.attachedEmails.length > 0) {
                    // וודא שהנתיבים מנורמלים
                    messageData.attachedEmails = messageData.attachedEmails.map(path => path.replace(/\\/g, '/'));
                } else if (attachedEmail) {
                    messageData.attachedEmail = attachedEmail.replace(/\\/g, '/');
                }
            }

            if (existingCsvPath) {
                csvFilePath = existingCsvPath;
            }

            // טיפול בקובץ CSV/Excel
            if (csvFile) {
                const fileExtension = csvFile.name.split('.').pop().toLowerCase();

                // בדיקה אם זה קובץ Excel
                if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                    // המרת Excel ל-CSV
                    const convertResult = await this.convertExcelToCsv(csvFile, messageData.id || 'temp');
                    if (convertResult.success) {
                        csvFilePath = convertResult.filePath;
                        messageData.tableData = convertResult.data;
                    } else {
                        NotificationManager.show(convertResult.error || 'שגיאה בהמרת קובץ Excel', 'error');
                        return;
                    }
                } else if (fileExtension === 'csv') {
                    // העלאת CSV רגיל
                    const uploadResult = await this.uploadFile(csvFile, messageData.id || 'temp');
                    if (uploadResult.success) {
                        csvFilePath = uploadResult.filePath;

                        // פרסור CSV
                        const parseResult = await this.parseCsvFile(csvFilePath);
                        if (parseResult.success) {
                            messageData.tableData = parseResult.data;
                        }
                    }
                } else {
                    NotificationManager.show('יש להעלות קובץ CSV או Excel בלבד', 'error');
                    return;
                }
            }
            else {
                if ((messageData.category === 'רשימות' || messageData.category === 'דוחות UC4') && !existingCsvPath) {
                    const errorMessage = "חובה להעלות קובץ CSV בקטגוריה זו";
                    NotificationManager.show(errorMessage, 'error');
                    return;
                }
            }

            // הוספת נתונים ספציפיים לקטגוריה
            if (messageData.category === 'בקשות וביצוע') {
                messageData.jobs = this.collectJobsData();
                messageData.attachedEmail = attachedEmail || '';
            } else if (messageData.category === 'בקשות') {
                messageData.attachedEmail = attachedEmail || '';
            }
            else if (messageData.category === 'רשימות' || messageData.category === 'דוחות UC4') {
                // אם מעלים קובץ חדש, נתיב הקובץ ונתוני הטבלה כבר מוגדרים
                if (csvFile) {
                    const fileExtension = csvFile.name.split('.').pop().toLowerCase();

                    // בדיקה אם זה קובץ Excel
                    if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                        // המרת Excel ל-CSV
                        const convertResult = await this.convertExcelToCsv(csvFile, messageData.id || 'temp');
                        if (convertResult.success) {
                            csvFilePath = convertResult.filePath;
                            messageData.tableData = convertResult.data;
                        } else {
                            NotificationManager.show(convertResult.error || 'שגיאה בהמרת קובץ Excel', 'error');
                            return;
                        }
                    } else if (fileExtension === 'csv') {
                        // העלאת CSV רגיל
                        const uploadResult = await this.uploadFile(csvFile, messageData.id || 'temp');
                        if (uploadResult.success) {
                            csvFilePath = uploadResult.filePath;

                            // פרסור CSV
                            const parseResult = await this.parseCsvFile(csvFilePath);
                            if (parseResult.success) {
                                messageData.tableData = parseResult.data;
                            }
                        }
                    }
                    messageData.csvFilePath = csvFilePath;
                }
                // אם משתמשים בקובץ קיים
                else if (existingCsvPath) {
                    csvFilePath = existingCsvPath;
                    messageData.csvFilePath = csvFilePath;

                    // העלאת הקובץ הקיים מחדש ופרסור שלו
                    try {
                        // קבל את הקובץ מהשרת
                        const response = await fetch(`/Messages/GetCsvFile?filePath=${encodeURIComponent(existingCsvPath)}`);
                        if (response.ok) {
                            const blob = await response.blob();
                            const file = new File([blob], "existing_file.csv", { type: "text/csv" });

                            // העלאת הקובץ מחדש
                            const uploadResult = await this.uploadFile(file, messageData.id || 'temp');
                            if (uploadResult.success) {
                                csvFilePath = uploadResult.filePath;
                                messageData.csvFilePath = csvFilePath;

                                // פרסור CSV
                                const parseResult = await this.parseCsvFile(csvFilePath);
                                if (parseResult.success) {
                                    messageData.tableData = parseResult.data;
                                }
                            }
                        } else {
                            // אם לא הצלחנו לקבל את הקובץ, ננסה לפרסר את הקובץ הקיים
                            const parseResult = await this.parseCsvFile(existingCsvPath);
                            if (parseResult.success) {
                                messageData.tableData = parseResult.data;
                            }
                        }
                    } catch (error) {
                        console.error('Error processing existing CSV file:', error);
                        // אם יש שגיאה, ננסה לפרסר את הקובץ הקיים
                        const parseResult = await this.parseCsvFile(existingCsvPath);
                        if (parseResult.success) {
                            messageData.tableData = parseResult.data;
                        }
                    }
                } else {
                    // אם אין קובץ חדש ואין קובץ קיים, הצג שגיאה
                    const errorMessage = "חובה להעלות קובץ CSV בקטגוריה זו";
                    NotificationManager.show(errorMessage, 'error');
                    return;
                }
            } else if (messageData.category === 'סיכומי משמרת') {
                messageData.incidents = document.getElementById('incidentsInput')?.value || '';
                messageData.openAlerts = document.getElementById('openAlertsInput')?.value || '';
                messageData.specialActions = document.getElementById('specialActionsInput')?.value || '';
                messageData.generalInfo = document.getElementById('generalInfoInput')?.value || '';
                messageData.openItems = document.getElementById('openItemsInput')?.value || '';
            }

            // טיפול בטבלאות בסיכומי משמרת
            if (messageData.category === 'סיכומי משמרת') {
                const textareaFields = ['incidents', 'openAlerts', 'specialActions', 'generalInfo', 'openItems'];

                textareaFields.forEach(field => {
                    const textarea = document.getElementById(`${field}Input`);
                    if (textarea) {
                        let content = textarea.value;

                        // החלף פלייסהולדרים בטבלאות אמיתיות
                        const tablePlaceholders = content.match(/\[טבלה: table_\d+_\d+\]/g);
                        if (tablePlaceholders) {
                            tablePlaceholders.forEach(placeholder => {
                                const tableId = placeholder.match(/table_\d+_\d+/)[0];
                                const tableHtml = textarea.dataset[tableId];

                                if (tableHtml) {
                                    content = content.replace(placeholder, tableHtml);
                                }
                            });
                        }

                        // עדכן את התוכן המעובד
                        messageData[field] = content;
                    }
                });
            }

            // שמירה לשרת
            if (!isEditing && messageData.author) {
                this.saveLastSelectedAuthor(messageData.author);
            }

            const url = isEditing ? '/Messages/EditMessage' : '/Messages/AddMessage';
            const method = isEditing ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(messageData)
            });

            const result = await response.json();

            if (result.success) {
                this.closeAddMessageModal();
                await this.loadMessages();

                const successMessage = isEditing ? 'הודעה עודכנה בהצלחה!' : 'הודעה נוספה בהצלחה!';
                NotificationManager.show(successMessage, 'success');

                // Check if it's a shift summary and ask about sending email
                if (messageData.category === 'סיכומי משמרת') {
                    // שמור את המשימה המעודכנת לשימוש בשליחת המייל
                    const updatedMessage = result.message || this.allMessages.find(m => m.id === result.id || m.id === messageData.id);
                    if (updatedMessage) {
                        this.askToSendShiftSummaryEmail(updatedMessage);
                    } else {
                        // אם לא מצאנו את המשימה המעודכנת, נטען את כל המשימות מחדש ואז נשאל
                        await this.loadMessages();
                        const freshMessage = this.allMessages.find(m => m.id === result.id || m.id === messageData.id);
                        if (freshMessage) {
                            this.askToSendShiftSummaryEmail(freshMessage);
                        }
                    }
                }
                // הוספת בדיקה לדוחות UC4
                else if (messageData.category === 'דוחות UC4') {
                    // שמור את המשימה המעודכנת לשימוש בשליחת המייל
                    const updatedMessage = result.message || this.allMessages.find(m => m.id === result.id || m.id === messageData.id);
                    if (updatedMessage) {
                        this.askToSendUC4Email(updatedMessage);
                    } else {
                        // אם לא מצאנו את המשימה המעודכנת, נטען את כל המשימות מחדש ואז נשאל
                        await this.loadMessages();
                        const freshMessage = this.allMessages.find(m => m.id === result.id || m.id === messageData.id);
                        if (freshMessage) {
                            this.askToSendUC4Email(freshMessage);
                        }
                    }
                }
            } else {
                const errorMessage = isEditing ? 'שגיאה בעדכון ההודעה' : 'שגיאה בהוספת ההודעה';
                NotificationManager.show(result.error || errorMessage, 'error');
            }
        } catch (error) {
            console.error('Error saving message:', error);
            const errorMessage = isEditing ? 'שגיאה בעדכון ההודעה' : 'שגיאה בהוספת ההודעה';
            NotificationManager.show(errorMessage, 'error');
        }
    }

    // פונקציה חדשה להמרת Excel ל-CSV
    async convertExcelToCsv(file, messageId) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('messageId', messageId);

            const response = await fetch('/Messages/ConvertExcelToCsv', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error converting Excel to CSV:', error);
            return { success: false, error: error.message };
        }
    }

    // Ask user if they want to send shift summary via email
    askToSendShiftSummaryEmail(messageData) {
        // Create confirmation modal if it doesn't exist
        let modal = document.getElementById('sendEmailConfirmModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sendEmailConfirmModal';
            modal.className = 'send-email-modal';

            modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>שליחת סיכום משמרת במייל</h3>
                    <button class="close-btn" onclick="document.getElementById('sendEmailConfirmModal').style.display='none'">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <p>האם ברצונך לשלוח את סיכום המשמרת במייל?</p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-primary" id="confirmSendEmailBtn">
                        <i class="fas fa-envelope"></i> כן, פתח מייל
                    </button>
                    <button class="btn btn-secondary" onclick="document.getElementById('sendEmailConfirmModal').style.display='none'">
                        לא, תודה
                    </button>
                </div>
            </div>
        `;

            document.body.appendChild(modal);
        }

        // Set up the confirm button action
        const confirmBtn = document.getElementById('confirmSendEmailBtn');
        confirmBtn.onclick = () => {
            // שמור את המשימה בתוך המודל כדי שנוכל לגשת אליה אחרי שהקבצים נשמרו
            modal.setAttribute('data-message-id', messageData.id);

            // הצג אינדיקטור טעינה
            const loadingOverlay = document.getElementById('shiftsLoadingOverlay') || this.createLoadingOverlay();
            loadingOverlay.classList.add('show');

            // המתן מעט כדי לוודא שהקבצים נשמרו
            setTimeout(async () => {
                try {
                    // טען את המשימה המעודכנת מהשרת
                    await this.loadMessages();

                    // מצא את המשימה המעודכנת
                    const messageId = modal.getAttribute('data-message-id');
                    const updatedMessage = this.allMessages.find(m => m.id === messageId);

                    if (updatedMessage) {
                        // שלח את המייל עם המשימה המעודכנת
                        await this.createShiftSummaryEmail(updatedMessage);
                    } else {
                        NotificationManager.show('לא נמצאה המשימה המעודכנת', 'error');
                    }
                } catch (error) {
                    console.error('Error sending email:', error);
                    NotificationManager.show('שגיאה בשליחת המייל', 'error');
                } finally {
                    // הסר את אינדיקטור הטעינה
                    loadingOverlay.classList.remove('show');
                    // סגור את המודל
                    modal.style.display = 'none';
                }
            }, 1500); // המתן 1.5 שניות כדי לוודא שהקבצים נשמרו
        };

        // Show the modal
        modal.style.display = 'block';
    }

    // Ask user if they want to send UC4 report via email
    askToSendUC4Email(messageData) {
        // Create confirmation modal if it doesn't exist
        let modal = document.getElementById('sendUC4EmailConfirmModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sendUC4EmailConfirmModal';
            modal.className = 'send-email-modal';

            modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>שליחת דוח UC4 במייל</h3>
                <button class="close-btn" onclick="document.getElementById('sendUC4EmailConfirmModal').style.display='none'">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <p>האם ברצונך לשלוח את דוח UC4 במייל?</p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" id="confirmSendUC4EmailBtn">
                    <i class="fas fa-envelope"></i> כן, פתח מייל
                </button>
                <button class="btn btn-secondary" onclick="document.getElementById('sendUC4EmailConfirmModal').style.display='none'">
                    לא, תודה
                </button>
            </div>
        </div>
    `;

            document.body.appendChild(modal);
        }

        // Set up the confirm button action
        const confirmBtn = document.getElementById('confirmSendUC4EmailBtn');
        confirmBtn.onclick = () => {
            // שמור את המשימה בתוך המודל כדי שנוכל לגשת אליה אחרי שהקבצים נשמרו
            modal.setAttribute('data-message-id', messageData.id);

            // הצג אינדיקטור טעינה
            const loadingOverlay = document.getElementById('shiftsLoadingOverlay') || this.createLoadingOverlay();
            loadingOverlay.classList.add('show');

            // המתן מעט כדי לוודא שהקבצים נשמרו
            setTimeout(async () => {
                try {
                    // טען את המשימה המעודכנת מהשרת
                    await this.loadMessages();

                    // מצא את המשימה המעודכנת
                    const messageId = modal.getAttribute('data-message-id');
                    const updatedMessage = this.allMessages.find(m => m.id === messageId);

                    if (updatedMessage) {
                        // שלח את המייל עם המשימה המעודכנת
                        await this.prepareUC4JobsEmail(updatedMessage.id);
                    } else {
                        NotificationManager.show('לא נמצאה המשימה המעודכנת', 'error');
                    }
                } catch (error) {
                    console.error('Error sending email:', error);
                    NotificationManager.show('שגיאה בשליחת המייל', 'error');
                } finally {
                    // הסר את אינדיקטור הטעינה
                    loadingOverlay.classList.remove('show');
                    // סגור את המודל
                    modal.style.display = 'none';
                }
            }, 1500); // המתן 1.5 שניות כדי לוודא שהקבצים נשמרו
        };

        // Show the modal
        modal.style.display = 'block';
    }

    setupAlertItemEventListeners(alertItem) {
        // Add event listeners after the element is added to the DOM
        const imageInput = alertItem.querySelector('.alert-image-input');
        if (imageInput) {
            imageInput.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const preview = alertItem.querySelector('.alert-image-preview img');
                        if (preview) {
                            preview.src = e.target.result;
                            alertItem.querySelector('.alert-image-upload').style.display = 'none';
                            alertItem.querySelector('.alert-image-preview').style.display = 'block';
                        }
                    };
                    reader.readAsDataURL(file);
                    alertItem.file = file;

                    // Remove any existing image path when a new file is selected
                    delete alertItem.dataset.imagePath;
                }
            });
        }

        // Add listener for removing image
        const removeImageBtn = alertItem.querySelector('.remove-alert-image');
        if (removeImageBtn) {
            removeImageBtn.addEventListener('click', () => {
                alertItem.querySelector('.alert-image-upload').style.display = 'block';
                alertItem.querySelector('.alert-image-preview').style.display = 'none';
                alertItem.querySelector('.alert-image-input').value = '';
                delete alertItem.file;
                delete alertItem.dataset.imagePath;
            });
        }

        // Add listener for removing alert item
        const removeItemBtn = alertItem.querySelector('.remove-alert-item');
        if (removeItemBtn) {
            removeItemBtn.addEventListener('click', () => {
                alertItem.parentNode.removeChild(alertItem);
            });
        }

        // Make the upload area clickable
        const uploadArea = alertItem.querySelector('.alert-image-upload');
        if (uploadArea) {
            uploadArea.addEventListener('click', () => {
                imageInput.click();
            });

            if (!uploadArea.querySelector('.drag-hint')) {
                const dragHint = document.createElement('div');
                dragHint.className = 'drag-hint';
                dragHint.innerHTML = '<small>או גרור תמונה לכאן</small>';
                uploadArea.appendChild(dragHint);
            }
        }
    }

    addAlertItem() {
        const alertsContainer = document.getElementById('alertItemsContainer');
        if (!alertsContainer) return;

        const alertItem = document.createElement('div');
        alertItem.className = 'alert-item';
        alertItem.innerHTML = `
        <div class="alert-text-container">
            <textarea class="alert-text form-textarea" placeholder="תוכן ההתראה"></textarea>
        </div>
        <div class="alert-image-container">
            <div class="alert-image-upload">
                <i class="fas fa-image"></i>
                <span>הוסף תמונה</span>
                <input type="file" class="alert-image-input" accept="image/*">
            </div>
            <div class="alert-image-preview" style="display:none;">
                <img src="" alt="תצוגה מקדימה">
                <button type="button" class="remove-alert-image">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
        <button type="button" class="remove-alert-item">
            <i class="fas fa-trash"></i>
        </button>
    `;

        alertsContainer.appendChild(alertItem);

        // Use the helper function to set up event listeners
        this.setupAlertItemEventListeners(alertItem);
    }

    // פונקציה ליצירת אינדיקטור טעינה
    createLoadingOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'shiftsLoadingOverlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = `
        <div class="loading-spinner"></div>
        <div class="loading-text">מכין את המייל...</div>
    `;
        document.body.appendChild(overlay);

        // הוסף CSS
        const style = document.createElement('style');
        style.textContent = `
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s, visibility 0.3s;
        }
        
        .loading-overlay.show {
            opacity: 1;
            visibility: visible;
        }
        
        .loading-spinner {
            width: 60px;
            height: 60px;
            border: 5px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
        }
        
        .loading-text {
            color: white;
            margin-top: 20px;
            font-size: 18px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
        document.head.appendChild(style);

        return overlay;
    }

    // בניית תוכן HTML למייל
    async buildHtmlEmail(messageData) {
        // נמיר תמונות ל-base64 ונטמיע אותן ב-HTML
        let imagesHtml = '';

        let attachmentsHtml = '';
        // יצירת מערך לקבצים מצורפים אם לא קיים
        if (!this.attachmentPaths) {
            this.attachmentPaths = [];
        }

        if (messageData.attachments && messageData.attachments.length > 0) {
            // מיון הקבצים לתמונות וקבצים אחרים
            const imageAttachments = [];
            const otherAttachments = [];

            for (const path of messageData.attachments) {
                const extension = path.split('.').pop().toLowerCase();
                if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(extension)) {
                    imageAttachments.push(path);
                } else {
                    otherAttachments.push(path);
                }
            }

            // הוסף תמונות מוטמעות
            if (imageAttachments.length > 0) {
                imagesHtml = '<h3 style="margin-top:30px; border-top:1px solid #ddd; padding-top:15px;">📷 תמונות מצורפות</h3>';
                imagesHtml += '<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:15px;">';

                for (const imagePath of imageAttachments) {
                    try {
                        // נסה להמיר את התמונה ל-base64
                        const base64Image = await this.convertImageToBase64ForEmail(imagePath);

                        // בדוק אם ה-base64 תקין
                        if (base64Image && typeof base64Image === 'string' && base64Image.includes('base64,')) {
                            imagesHtml += `
            <div style="max-height:100px; margin-bottom:15px; text-align:center;">
                <img src="${base64Image}" alt="${this.getFileDisplayName(imagePath)}" style="max-width:100%; max-height:100px; border:1px solid #ddd;object-fit: contain; border-radius:5px; box-shadow:0 2px 5px rgba(0,0,0,0.1);" />
            </div>`;
                        } else {
                            console.error(`Invalid base64 string for image: ${imagePath}`, typeof base64Image);
                            imagesHtml += `
            <div style="margin-bottom:15px; text-align:center;">
                <div style="padding:15px; background:#f8f9fa; border:1px solid #ddd; border-radius:5px;">
                    <p style="color:#dc3545;">לא ניתן להציג את התמונה: ${this.getFileDisplayName(imagePath)}</p>
                </div>
            </div>`;
                        }
                    } catch (error) {
                        console.error(`Error processing image ${imagePath}:`, error);
                        imagesHtml += `
        <div style="margin-bottom:15px; text-align:center;">
            <div style="padding:15px; background:#f8f9fa; border:1px solid #ddd; border-radius:5px;">
                <p style="color:#dc3545;">שגיאה בטעינת התמונה: ${this.getFileDisplayName(imagePath)}</p>
                <p style="color:#6c757d; font-size:0.9em;">${error.message}</p>
            </div>
        </div>`;
                    }
                }

                imagesHtml += '</div>';
            }

            // הוסף קבצים אחרים כקישורים להורדה
            if (otherAttachments.length > 0) {
                attachmentsHtml = '<h3 style="margin-top:30px; border-top:1px solid #ddd; padding-top:15px;">📎 קבצים מצורפים</h3>';
                attachmentsHtml += '<ul style="list-style-type:none; padding:0;">';

                for (const attachmentPath of otherAttachments) {
                    const fileName = this.getFileDisplayName(attachmentPath);
                    const extension = fileName.split('.').pop().toLowerCase();
                    let iconClass = 'fa-file';

                    if (extension === 'pdf') {
                        iconClass = 'fa-file-pdf';
                    } else if (['doc', 'docx'].includes(extension)) {
                        iconClass = 'fa-file-word';
                    } else if (['xls', 'xlsx'].includes(extension)) {
                        iconClass = 'fa-file-excel';
                    }

                    // הוסף את הקובץ לרשימת הקבצים המצורפים למייל
                    this.attachmentPaths.push(attachmentPath);

                    attachmentsHtml += `
                <li style="margin-bottom:10px; padding:10px; background:#f8f9fa; border:1px solid #ddd; border-radius:5px; display:flex; align-items:center;">
                    <i class="fas ${iconClass}" style="margin-left:10px; color:#007bff;"></i>
                    <span>${fileName}</span>
                </li>`;
                }

                attachmentsHtml += '</ul>';
            }
        }

        // Add alert items section
        let alertItemsHtml = '';
        if (messageData.alertItems && messageData.alertItems.length > 0) {
            alertItemsHtml = `
<h3 style="margin-top:30px; border-top:1px solid #ddd; padding-top:15px;">🔔 התראות</h3>
<div style="margin-top:15px;">`;

            for (const item of messageData.alertItems) {
                alertItemsHtml += `
    <div style="margin-bottom:20px; padding:15px; background:#f8f9fa; border:1px solid #ddd; border-radius:5px;">
        <p style="margin-bottom:10px;">${item.Text || ''}</p>`;

                if (item.ImagePath) {
                    try {
                        // Convert image to base64
                        const base64Image = await this.convertImageToBase64ForEmail(item.ImagePath);

                        if (base64Image) {
                            alertItemsHtml += `
                <div style="text-align:center;">
                    <img src="${base64Image}" alt="תמונת התראה" style="max-width:100%; max-height:300px; border:1px solid #ddd; border-radius:5px; box-shadow:0 2px 5px rgba(0,0,0,0.1);" />
                </div>`;
                        }
                    } catch (error) {
                        console.error(`Error processing alert image ${item.ImagePath}:`, error);
                    }
                }

                alertItemsHtml += `</div>`;
            }

            alertItemsHtml += `</div>`;
        }

        // וודא שיש DOCTYPE ותגיות HTML מלאות
        return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <title>${messageData.title}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            direction: rtl;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
        h2 {
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
            margin-top: 25px;
        }
        h3 {
            color: #2980b9;
            margin-top: 20px;
            border-right: 4px solid #3498db;
            padding-right: 10px;
        }
        pre {
            background: #f8f9fa;
            padding: 15px;
            border: 1px solid #e9ecef;
            border-radius: 5px;
            white-space: pre-wrap;
            font-family: Arial, sans-serif;
        }
        .header-section {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            border-right: 5px solid #3498db;
        }
        .section-empty {
            color: #6c757d;
            font-style: italic;
        }
        .footer-table {
            margin-top: 30px;
            border-collapse: collapse;
            width: 100%;
        }
        .footer-table td, .footer-table th {
            border: 1px solid #ddd;
            padding: 8px;
        }
        .footer-table tr:nth-child(even) {
            background-color: #f2f2f2;
        }
        .footer-note {
            color: #6c757d;
            font-size: 0.9em;
            margin-top: 20px;
            border-top: 1px solid #ddd;
            padding-top: 10px;
        }
        .icon {
            margin-left: 5px;
        }
    </style>
</head>
<body>
    <div class="header-section">
        <h2>📋 סיכום משמרת: ${messageData.title}</h2>
    </div>

    ${messageData.incidents ? `
    <h3>⚠️ תקלות במשמרת</h3>
    <pre>
${this.formatContentWithTables(messageData.incidents)}
    </pre>
    ` : '<h3>⚠️ תקלות במשמרת</h3><p class="section-empty">לא דווחו תקלות במשמרת זו</p>'}

    ${messageData.openAlerts ? `
    <h3>🔔 התראות פתוחות</h3>
    <pre>
${this.formatContentWithTables(messageData.openAlerts)}
    </pre>
    ` : ''}

    ${alertItemsHtml}

    ${messageData.specialActions ? `
    <h3>✅ פעולות מיוחדות</h3>
    <pre>
${this.formatContentWithTables(messageData.specialActions)}
    </pre>
    ` : '<h3>✅ פעולות מיוחדות</h3><p class="section-empty">לא בוצעו פעולות מיוחדות</p>'}

    ${messageData.generalInfo ? `
    <h3>ℹ️ מידע כללי</h3>
    <pre>
${this.formatContentWithTables(messageData.generalInfo)}
    </pre>
    ` : '<h3>ℹ️ מידע כללי</h3><p class="section-empty">אין מידע כללי נוסף</p>'}

    ${messageData.openItems ? `
    <h3>📝 דברים פתוחים ממשמרות קודמות</h3>
    <pre>
${this.formatContentWithTables(messageData.openItems)}
    </pre>
    ` : '<h3>📝 דברים פתוחים ממשמרות קודמות</h3><p class="section-empty">אין פריטים פתוחים ממשמרות קודמות</p>'}

    ${imagesHtml}
    ${attachmentsHtml}

    <br><br>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:50%">
        <tr>
            <td>מחבר</td>
            <td>${messageData.author}</td>
        </tr>
        <tr>
            <td>תאריך</td>
            <td>${new Date().toLocaleDateString("he-IL")}</td>
        </tr>
    </table>
    <p style="color:gray">הודעה זו נוצרה אוטומטית ממערכת NOC Portal</p>
</body>
</html>`;
    }

    async convertImageToBase64ForEmail(imagePath) {
        try {

            // נרמל את הנתיב
            const normalizedPath = this.normalizeFilePath(imagePath);

            // קבל את סוג הקובץ
            const extension = imagePath.split('.').pop().toLowerCase();
            const mimeType = this.getImageMimeType(extension);

            // בקשה לשרת להמרת התמונה ל-base64
            const response = await fetch(`/Messages/GetImageAsBase64?filePath=${encodeURIComponent(imagePath)}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }

            // וודא שמה שמוחזר הוא מחרוזת
            if (typeof data.base64Data !== 'string') {
                console.error('Base64 data is not a string:', typeof data.base64Data);
                return null;
            }

            // בדוק אם ה-base64 מתחיל כבר עם data:image
            if (data.base64Data.startsWith('data:image')) {
                return data.base64Data;
            }

            // החזר את ה-base64 עם ה-prefix המתאים
            const fullBase64 = `data:${mimeType};base64,${data.base64Data}`;
            return fullBase64;
        } catch (error) {
            console.error('Error converting image to base64 for email:', error);
            return null;
        }
    }

    getImageMimeType(extension) {
        switch (extension) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'bmp':
                return 'image/bmp';
            default:
                return 'application/octet-stream';
        }
    }

    // פונקציה חדשה להמרת תמונה ל-base64
    async convertImageToBase64(imagePath) {
        try {
            // בדוק אם הקובץ קיים
            if (!await this.fileExists(imagePath)) {
                throw new Error(`File not found: ${imagePath}`);
            }

            // קרא את הקובץ כ-ArrayBuffer
            const response = await fetch(`/Messages/GetImageAsBase64?filePath=${encodeURIComponent(imagePath)}`);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Unknown error');
            }

            return data.base64Data;
        } catch (error) {
            console.error('Error converting image to base64:', error);
            return null;
        }
    }

    // בדיקה אם קובץ קיים
    async fileExists(filePath) {
        try {
            const response = await fetch(`/Messages/FileExists?filePath=${encodeURIComponent(filePath)}`);
            const data = await response.json();
            return data.exists;
        } catch (error) {
            console.error('Error checking if file exists:', error);
            return false;
        }
    }

    // יצירת קובץ EML ופתיחתו אוטומטית במצב עריכה
    async openEmailInOutlook(subject, htmlBody, to, cc = "") {
        try {
            // יצירת גבול ייחודי להפרדת חלקי המייל
            const boundary = `----=_NextPart_${Math.random().toString(36).substring(2)}`;

            // הוסף קידוד UTF-8 מפורש
            let emlContent = `X-Unsent: 1
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"
To: ${to}`;

            // הוסף שדה CC אם יש
            if (cc) {
                emlContent += `
Cc: ${cc}`;
            }

            emlContent += `
Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=

--${boundary}
Content-Type: text/html; charset=UTF-8

${htmlBody}`;

            // הוסף קבצים מצורפים אם יש
            if (this.attachmentPaths && this.attachmentPaths.length > 0) {
                // הודעה למשתמש שמכינים את הקבצים המצורפים
                NotificationManager.show(`מכין ${this.attachmentPaths.length} קבצים מצורפים...`, 'info');

                // הוסף כל קובץ מצורף
                for (const filePath of this.attachmentPaths) {
                    try {
                        // נרמל את הנתיב
                        const normalizedPath = this.normalizeFilePath(filePath);

                        // קבל את שם הקובץ
                        const fileName = this.getFileDisplayName(filePath);

                        // קבל את סוג התוכן
                        const extension = fileName.split('.').pop().toLowerCase();
                        const contentType = this.getAttachmentContentType(extension);

                        // קבל את תוכן הקובץ מהשרת
                        const response = await fetch(`/Messages/GetFileAsBase64?filePath=${encodeURIComponent(filePath)}`);
                        if (!response.ok) {
                            console.error(`Failed to fetch file: ${filePath}`);
                            continue;
                        }

                        const data = await response.json();
                        if (!data.success || !data.base64Data) {
                            console.error(`Invalid base64 data for file: ${filePath}`);
                            continue;
                        }

                        // הוסף את הקובץ המצורף ל-EML
                        emlContent += `
--${boundary}
Content-Type: ${contentType}
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="${fileName}"

${data.base64Data}`;
                    } catch (error) {
                        console.error(`Error processing attachment ${filePath}:`, error);
                    }
                }
            }

            // סגור את הגבול
            emlContent += `
--${boundary}--`;

            const blob = new Blob([emlContent], { type: "message/rfc822" });
            const url = URL.createObjectURL(blob);

            // Create download link
            const a = document.createElement("a");
            a.href = url;
            a.download = `${subject.replace(/[^א-תa-zA-Z0-9]/g, '_')}.eml`;
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

            // Show user instructions with attachment info
            setTimeout(() => {
                this.showEmailInstructionsModal();
            }, 2000);

        } catch (error) {
            console.error('Error creating email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
        }
    }

    // פונקציה חדשה לקביעת סוג התוכן לפי סיומת הקובץ
    getAttachmentContentType(extension) {
        switch (extension.toLowerCase()) {
            case 'pdf': return 'application/pdf';
            case 'doc': return 'application/msword';
            case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            case 'xls': return 'application/vnd.ms-excel';
            case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            case 'ppt': return 'application/vnd.ms-powerpoint';
            case 'pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'png': return 'image/png';
            case 'gif': return 'image/gif';
            case 'bmp': return 'image/bmp';
            case 'txt': return 'text/plain';
            case 'csv': return 'text/csv';
            case 'zip': return 'application/zip';
            case 'rar': return 'application/x-rar-compressed';
            case '7z': return 'application/x-7z-compressed';
            default: return 'application/octet-stream';
        }
    }

    // הצגת מודל עם הנחיות לפתיחת קובץ EML
    showEmailInstructionsModal() {
        // יצירת מודל אם לא קיים
        let modal = document.getElementById('emailInstructionsModal');
        if (!modal) {
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
                                <p>קובץ <strong>.eml</strong> הורד לתיקיית ההורדות שלך.</p>
                            </div>
                        </div>
                        <div class="instruction-step highlight-step">
                            <div class="step-number">2</div>
                            <div class="step-content">
                                <h4>פתח את הקובץ</h4>
                                <p><strong class="important-text">חשוב: לחץ על הקובץ שהורדת כדי לפתוח אותו ב-Outlook.</strong></p>
                                <p>הקובץ יפתח כטיוטת מייל מוכנה לשליחה עם כל הקבצים המצורפים.</p>
                            </div>
                        </div>
                        <div class="instruction-step">
                            <div class="step-number">3</div>
                            <div class="step-content">
                                <h4>בדוק ושלח</h4>
                                <p>בדוק את תוכן המייל והקבצים המצורפים ולחץ על "שלח" כדי לשלוח אותו.</p>
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

    // Create and open email with shift summary content
    async createShiftSummaryEmail(message) {
        try {
            // יצירת כותרת למייל
            const subject = `${message.title}`;
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // בניית תוכן HTML למייל עם תמונות מוטמעות
            const htmlBody = await this.buildHtmlEmail(message);

            // הכנת קבצים מצורפים
            let attachmentPaths = [];
            if (message.attachments && message.attachments.length > 0) {
                // סנן רק קבצים שאינם תמונות
                attachmentPaths = message.attachments.filter(path => {
                    const extension = path.split('.').pop().toLowerCase();
                    return !['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(extension);
                }).map(path => this.normalizeFilePath(path));
            }

            // הוסף קבצי מייל מצורפים
            if (message.attachedEmails && message.attachedEmails.length > 0) {
                attachmentPaths = [...attachmentPaths, ...message.attachedEmails.map(path => this.normalizeFilePath(path))];
            } else if (message.attachedEmail) {
                attachmentPaths.push(this.normalizeFilePath(message.attachedEmail));
            }

            // פתיחת המייל ב-Outlook עם תוכן HTML מועשר וקבצים מצורפים
            this.attachmentPaths = attachmentPaths;
            await this.openEmailInOutlook(subject, htmlBody, recipient, "");
        } catch (error) {
            console.error('Error creating email:', error);
            NotificationManager.show('שגיאה בפתיחת המייל', 'error');
        }
    }

    // Helper method to normalize file paths
    normalizeFilePath(path) {
        if (!path) return path;

        // Keep relative paths unchanged; server-side endpoints will resolve them from the portal/files root.
        return path;
    }

    // Duplicate message
    async duplicateMessage(messageId) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message) {
                NotificationManager.show('הודעה לא נמצאה', 'error');
                return;
            }
            if (message.category === 'אישורי כניסה') {
                this.openEntryPermitModal(message, true);
                return;
            }

            // פתיחת המודל עם נתוני ההודעה המקורית
            this.isModalOpen = true;
            document.getElementById('addMessageForm').reset();
            document.getElementById('messageId').value = '';

            // Reset email upload area
            const dropZone = document.getElementById('emailDropZone');
            const preview = document.getElementById('emailPreview');
            const existingDisplay = document.getElementById('existingEmailDisplay');

            if (dropZone) dropZone.style.display = 'block';
            if (preview) preview.style.display = 'none';
            if (existingDisplay) existingDisplay.style.display = 'none';

            document.getElementById('existingEmailPath').value = '';
            document.getElementById('emailFileInput').value = '';

            // קודם כל נגדיר את הקטגוריה כדי שהשדות הנכונים יוצגו
            document.getElementById('messageCategory').value = message.category;
            // עכשיו נעדכן את השדות המוצגים לפי הקטגוריה
            this.updateFormFieldsByCategory(message.category);

            // מילוי הטופס עם נתוני ההודעה המקורית
            document.getElementById('messageTitle').value = `${message.title} (עותק)`;
            document.getElementById('messagePriority').value = message.priority;

            // טיפול בשדות ספציפיים לפי קטגוריה
            if (message.category === 'בקשות וביצוע') {
                this.loadJobsData(message.jobs);

                // טיפול במייל מצורף
                if (message.attachedEmail) {
                    this.showExistingEmails([message.attachedEmail]);
                }
            } else if (message.category === 'בקשות') {
                document.getElementById('messageContent').value = message.content || '';

                // טיפול במייל מצורף
                if (message.attachedEmail) {
                    this.showExistingEmails([message.attachedEmail]);
                }
            } else if (message.category === 'כללי' || message.category === 'דחוף') {
                document.getElementById('messageContent').value = message.content || '';
            } else if (message.category === 'סיכומי משמרת') {
                document.getElementById('incidentsInput').value = message.incidents || '';
                document.getElementById('openAlertsInput').value = message.openAlerts || '';
                document.getElementById('specialActionsInput').value = message.specialActions || '';
                document.getElementById('generalInfoInput').value = message.generalInfo || '';
                document.getElementById('openItemsInput').value = message.openItems || '';

                // טיפול במייל מצורף
                if (message.attachedEmails && message.attachedEmails.length > 0) {
                    this.showExistingEmails(message.attachedEmails);
                } else if (message.attachedEmail) {
                    this.showExistingEmails([message.attachedEmail]);
                }
            } else if (message.category === 'רשימות' || message.category === 'דוחות UC4') {
                if (message.csvFilePath) {
                    this.showExistingCsvFile(message.csvFilePath);
                }
            }

            // טיפול בתאריך יעד
            document.getElementById('messageDueDateHidden').value = '';
            document.getElementById('messageDueDate').value = '';
            document.getElementById('messageDueDateClear').style.display = 'none';

            document.getElementById('messageAuthor').value = '';
            // טיפול במחבר
            this.loadEmployees().then(() => {
                const authorSelect = document.getElementById('messageAuthor');
                if (authorSelect) {
                    const authorExists = this.employees.some(emp => emp.name === message.author);
                    if (authorExists) {
                        authorSelect.value = '';
                    } else {
                        authorSelect.value = 'other';
                        this.handleCustomAuthorInput(message.author);
                    }
                }
            });

            // שינוי כותרת המודל
            document.getElementById('modalTitle').textContent = 'שכפול הודעה';
            document.getElementById('submitBtn').textContent = 'שמור עותק';

            // הצג את המודל
            document.getElementById('addMessageModal').style.display = 'block';
            document.body.style.overflow = 'hidden';

            NotificationManager.show('הודעה הועתקה, ערוך ושמור', 'info');
        } catch (error) {
            console.error('Error duplicating message:', error);
            NotificationManager.show('שגיאה בשכפול ההודעה', 'error');
        }
    }

    handleCustomAuthorInput(defaultValue = '') {
        const authorSelect = document.getElementById('messageAuthor');
        const customAuthorContainer = document.getElementById('customAuthorContainer');
        const customAuthorInput = document.getElementById('customAuthorInput');

        if (authorSelect && customAuthorContainer && customAuthorInput) {
            if (authorSelect.value === 'other') {
                customAuthorContainer.style.display = 'block';
                customAuthorInput.value = defaultValue;
                customAuthorInput.focus();
            } else {
                customAuthorContainer.style.display = 'none';
            }
        }
    }

    // Delete message
    async deleteMessage(messageId) {
        if (!confirm('האם אתה בטוח שברצונך למחוק הודעה זו?')) {
            return;
        }

        try {
            const response = await fetch(`/Messages/DeleteMessage?id=${messageId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                this.loadMessages();
                NotificationManager.show('הודעה נמחקה בהצלחה!', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקת ההודעה', 'error');
            }
        } catch (error) {
            console.error('Error deleting message:', error);
            NotificationManager.show('שגיאה במחיקת ההודעה', 'error');
        }
    }

    // Modal functions
    openAddMessageModal() {
        this.isModalOpen = true;
        document.getElementById('addMessageForm').reset();
        document.getElementById('messageId').value = '';

        // איפוס הקבצים המצורפים
        this.resetAttachments();

        // הצג/הסתר שדות לפי קטגוריה
        this.updateFormFieldsByCategory('כללי');
        this.updateEmailFieldLabel('כללי');

        document.getElementById('messageDueDate').value = '';
        document.getElementById('messageDueDateHidden').value = '';
        document.getElementById('messageDueDateClear').style.display = 'none';
        document.getElementById('modalTitle').textContent = 'הוסף הודעה חדשה';
        document.getElementById('submitBtn').textContent = 'הוסף הודעה';

        this.loadEmployees().then(() => {
            this.setDefaultAuthor();
            this.setDefaultCategory();
        });

        // איפוס תצוגות מקדימות של טבלאות
        const tablePreviewContainers = document.querySelectorAll('.table-preview-container');
        tablePreviewContainers.forEach(container => {
            container.style.display = 'none';
        });

        document.getElementById('addMessageModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Update form fields based on category
    updateFormFieldsByCategory(category) {
        // הסתר את כל השדות הספציפיים
        document.getElementById('contentField').style.display = 'none';
        document.getElementById('jobsTableField').style.display = 'none';
        document.getElementById('emailUploadField').style.display = 'none';
        document.getElementById('csvUploadField').style.display = 'none';
        document.getElementById('shiftSummaryFields').style.display = 'none';
        document.getElementById('shiftAttachmentsField').style.display = 'none';

        // הצג שדות רלוונטיים
        switch (category) {
            case 'בקשות וביצוע':
                document.getElementById('jobsTableField').style.display = 'block';
                document.getElementById('emailUploadField').style.display = 'block';
                // שמור את המיקום המקורי של שדה המייל
                if (document.getElementById('emailUploadField').parentNode !== document.getElementById('addMessageForm').querySelector('.form-body')) {
                    document.getElementById('addMessageForm').querySelector('.form-body').insertBefore(
                        document.getElementById('emailUploadField'),
                        document.getElementById('messageAuthor').parentNode
                    );
                }
                this.updateExcelUploadVisibility();
                break;
            case 'בקשות':
                document.getElementById('contentField').style.display = 'block';
                document.getElementById('emailUploadField').style.display = 'block';
                // שמור את המיקום המקורי של שדה המייל
                if (document.getElementById('emailUploadField').parentNode !== document.getElementById('addMessageForm').querySelector('.form-body')) {
                    document.getElementById('addMessageForm').querySelector('.form-body').insertBefore(
                        document.getElementById('emailUploadField'),
                        document.getElementById('messageAuthor').parentNode
                    );
                }
                break;
            case 'רשימות':
                document.getElementById('csvUploadField').style.display = 'block';
                break;
            case 'דוחות UC4':
                document.getElementById('csvUploadField').style.display = 'block';
                break;
            case 'סיכומי משמרת':
                document.getElementById('shiftSummaryFields').style.display = 'block';
                document.getElementById('shiftAttachmentsField').style.display = 'block';

                // הסתר את שדה openAlertsInput אם הוא ריק
                const openAlertsInput = document.getElementById('openAlertsInput');
                if (openAlertsInput) {
                    openAlertsInput.style.display = openAlertsInput.value ? 'block' : 'none';
                }

                // הזז את שדה המייל מתחת לשדה הקבצים המצורפים
                document.getElementById('emailUploadField').style.display = 'block';

                // העבר את שדה המייל מתחת לשדה הקבצים המצורפים
                const shiftAttachmentsField = document.getElementById('shiftAttachmentsField');
                if (shiftAttachmentsField && document.getElementById('emailUploadField')) {
                    // בדוק אם צריך להזיז את האלמנט
                    if (shiftAttachmentsField.nextSibling !== document.getElementById('emailUploadField')) {
                        // הוסף כותרת מותאמת לשדה המייל בסיכומי משמרת
                        document.querySelector('#emailUploadField .form-label').textContent = 'צרף מייל לסיכום המשמרת';

                        // הזז את שדה המייל אחרי שדה הקבצים המצורפים
                        shiftAttachmentsField.after(document.getElementById('emailUploadField'));
                    }
                }
                break;
            case 'אישורי כניסה':
                // אין שדות נוספים - הכל מנוהל במודל הייעודי
                break;
            case 'כללי':
            case 'דחוף':
                document.getElementById('contentField').style.display = 'block';
                break;
        }
    }

    // הוסף פונקציה חדשה לעדכון כותרת שדה המייל לפי קטגוריה
    updateEmailFieldLabel(category) {
        const emailFieldLabel = document.querySelector('#emailUploadField .form-label');
        if (emailFieldLabel) {
            if (category === 'סיכומי משמרת') {
                emailFieldLabel.textContent = 'צרף מייל לסיכום המשמרת';
            } else {
                emailFieldLabel.textContent = 'גרור מייל';
            }
        }
    }

    setupPasteImageListener() {
        // מאזין להדבקה בכל המסמך
        document.addEventListener('paste', (e) => {
            // בדוק אם המודל פתוח
            if (!this.isModalOpen) return;

            // בדוק אם אנחנו בקטגוריית סיכומי משמרת
            const category = document.getElementById('messageCategory').value;
            if (category !== 'סיכומי משמרת') return;

            // בדוק אם יש תמונות בלוח
            const items = e.clipboardData.items;
            if (!items) return;

            // חפש תמונה בפריטים שהודבקו
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    // קבל את הקובץ מהלוח
                    const file = items[i].getAsFile();
                    if (file) {
                        // בדוק אם ההדבקה היא בתוך textarea של התראה
                        const activeElement = document.activeElement;
                        if (activeElement && activeElement.classList.contains('alert-text')) {
                            // מצא את ה-alert-item המכיל את ה-textarea
                            const alertItem = activeElement.closest('.alert-item');
                            if (alertItem) {
                                // מנע את ברירת המחדל של הדבקה
                                e.preventDefault();

                                // טפל בקובץ כמו בהעלאה רגילה
                                const imageInput = alertItem.querySelector('.alert-image-input');
                                const preview = alertItem.querySelector('.alert-image-preview img');
                                const uploadArea = alertItem.querySelector('.alert-image-upload');

                                if (imageInput && preview && uploadArea) {
                                    // הגדר את הקובץ ב-FileList של ה-input
                                    const dataTransfer = new DataTransfer();
                                    dataTransfer.items.add(file);
                                    imageInput.files = dataTransfer.files;

                                    // הצג תצוגה מקדימה
                                    const reader = new FileReader();
                                    reader.onload = (e) => {
                                        preview.src = e.target.result;
                                        uploadArea.style.display = 'none';
                                        alertItem.querySelector('.alert-image-preview').style.display = 'block';
                                    };
                                    reader.readAsDataURL(file);

                                    // שמור את הקובץ באלמנט
                                    alertItem.file = file;

                                    // הסר כל נתיב תמונה קיים
                                    delete alertItem.dataset.imagePath;

                                    // הצג הודעה
                                    NotificationManager.show('תמונה הודבקה בהצלחה', 'success');
                                }
                                return;
                            }
                        } else {
                            // אם לא בתוך textarea של התראה, טפל כרגיל
                            this.handleShiftAttachmentFile(file);
                            e.preventDefault();
                            NotificationManager.show('תמונה הודבקה בהצלחה', 'success');
                        }
                        break;
                    }
                }
            }
        });

        // הוסף מאזין לכפתור הדבקת תמונה
        document.addEventListener('click', (e) => {
            if (e.target.closest('.paste-image-btn')) {
                // הצג הודעה למשתמש
                NotificationManager.show('הדבק תמונה באמצעות Ctrl+V או לחץ ימני -> הדבק', 'info');
            }
        });
    }

    // הוסף פונקציה חדשה לטיפול בהעלאת קבצים לסיכומי משמרת
    setupShiftAttachmentsUpload() {
        const dropZone = document.getElementById('shiftAttachmentsDropZone');
        const fileInput = document.getElementById('shiftAttachmentsFileInput');

        if (!dropZone || !fileInput) return;

        dropZone.innerHTML = `
    <i class="fas fa-cloud-upload-alt"></i>
    <p>גרור קבצים לכאן</p>
    <span>או לחץ לבחירה</span>
    <small>תומך בתמונות ומסמכים (JPG, PNG, PDF, DOC, XLS)</small>
`;
        // לחיצה לבחירת קובץ
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        // שינוי בקובץ שנבחר
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                Array.from(e.target.files).forEach(file => {
                    this.handleShiftAttachmentFile(file);
                });
            }
        });

        // מניעת התנהגויות ברירת מחדל של גרירה
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // הדגשת אזור הגרירה בעת גרירה מעליו
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-over');
            });
        });

        // טיפול בקבצים שנגררו
        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                Array.from(files).forEach(file => {
                    // בדוק את סוג הקובץ
                    const fileExt = file.name.split('.').pop().toLowerCase();
                    const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'];
                    if (allowedExtensions.includes(fileExt)) {
                        this.handleShiftAttachmentFile(file);
                    } else {
                        NotificationManager.show(`סוג קובץ לא נתמך: ${fileExt}. יש להעלות רק קבצי תמונה או מסמכים נתמכים.`, 'error');
                    }
                });
            }
        });
    }

    // פונקציה לטיפול בקובץ מצורף לסיכום משמרת
    handleShiftAttachmentFile(file) {
        const preview = document.getElementById('shiftAttachmentsPreview');
        const dropZone = document.getElementById('shiftAttachmentsDropZone');
        const attachmentsContainer = document.getElementById('shiftAttachmentsContainer') || this.createShiftAttachmentsContainer();

        // בדוק אם הגענו למקסימום קבצים
        const existingAttachments = attachmentsContainer.querySelectorAll('.attachment-preview-item').length;
        if (existingAttachments >= 5) {
            NotificationManager.show('ניתן להעלות עד 5 קבצים', 'warning');
            return;
        }

        // בדוק את סוג הקובץ
        const fileExt = file.name.split('.').pop().toLowerCase();
        const allowedExtensions = ['jpg', 'jpeg', 'png', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'];

        if (!allowedExtensions.includes(fileExt)) {
            NotificationManager.show(`סוג קובץ לא נתמך: ${fileExt}. יש להעלות רק קבצי תמונה או מסמכים נתמכים.`, 'error');
            return;
        }

        // הצג את אזור התצוגה המקדימה
        preview.style.display = 'block';

        // יצירת שם קובץ לתמונה מהלוח אם אין שם
        let fileName = file.name;
        if (!fileName || fileName === 'image.png') {
            const date = new Date();
            fileName = `תמונה_מהלוח_${date.getDate()}-${date.getMonth() + 1}-${date.getFullYear()}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}.png`;

            // אם זו תמונה מהלוח, נצטרך ליצור קובץ חדש עם השם המעודכן
            if (file.name === 'image.png') {
                file = new File([file], fileName, { type: file.type });
            }
        }

        // יצירת אלמנט תצוגה מקדימה לקובץ הנוכחי
        const attachmentItem = document.createElement('div');
        attachmentItem.className = 'attachment-preview-item';

        // קבע את סוג האייקון לפי סוג הקובץ
        let iconClass = 'fa-file';

        if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExt)) {
            iconClass = 'fa-file-image';

            // אם זו תמונה, הצג תצוגה מקדימה
            if (file instanceof File) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const imgPreview = attachmentItem.querySelector('.preview-icon');
                    if (imgPreview) {
                        imgPreview.innerHTML = `<img src="${e.target.result}" alt="תצוגה מקדימה" class="thumbnail-preview">`;
                    }
                };
                reader.readAsDataURL(file);
            }
        } else if (['pdf'].includes(fileExt)) {
            iconClass = 'fa-file-pdf';
        } else if (['doc', 'docx'].includes(fileExt)) {
            iconClass = 'fa-file-word';
        } else if (['xls', 'xlsx'].includes(fileExt)) {
            iconClass = 'fa-file-excel';
        }

        attachmentItem.innerHTML = `
    <div class="preview-icon attachment">
        <i class="fas ${iconClass}"></i>
    </div>
    <div class="preview-details">
        <div class="preview-filename">${fileName}</div>
        <div class="preview-filesize">${this.formatFileSize(file.size)}</div>
    </div>
    <button class="preview-remove" onclick="messagesManager.removeShiftAttachmentItem(this)">
        <i class="fas fa-times"></i>
    </button>
    `;

        // שמירת הקובץ באלמנט
        attachmentItem.file = file;

        // הוספת האלמנט לרשימת הקבצים המצורפים
        attachmentsContainer.appendChild(attachmentItem);

        // הסתר את אזור הגרירה רק אם הגענו ל-5 קבצים
        if (attachmentsContainer.querySelectorAll('.attachment-preview-item').length >= 5) {
            dropZone.style.display = 'none';
        }
    }

    // יצירת מיכל לקבצים מצורפים של סיכום משמרת
    createShiftAttachmentsContainer() {
        const container = document.createElement('div');
        container.id = 'shiftAttachmentsContainer';
        container.className = 'attachments-container';

        const preview = document.getElementById('shiftAttachmentsPreview');
        if (preview) {
            preview.appendChild(container);
        }

        return container;
    }

    // הסרת פריט קובץ מצורף בודד
    removeShiftAttachmentItem(button) {
        const item = button.closest('.attachment-preview-item');
        const container = item.parentElement;
        const dropZone = document.getElementById('shiftAttachmentsDropZone');

        // הסר את הפריט
        container.removeChild(item);

        // בדוק אם זה היה הפריט האחרון
        if (container.children.length === 0) {
            // הסתר את אזור התצוגה המקדימה
            document.getElementById('shiftAttachmentsPreview').style.display = 'none';
        }

        // וודא שאזור הגרירה תמיד מוצג אם יש פחות מ-5 קבצים
        if (container.children.length < 5) {
            dropZone.style.display = 'block';
        }
    }

    async checkFileExists(filePath) {
        try {
            const normalizedPath = filePath.replace(/\\/g, '/');
            const encodedPath = this.encodeFilePath(normalizedPath);

            const response = await fetch(`/Messages/FileExists?filePath=${encodedPath}`);
            const data = await response.json();

            return data.exists;
        } catch (error) {
            console.error('Error checking if file exists:', error);
            return false;
        }
    }

    encodeFilePath(filePath) {
        // First decode in case it's already encoded to avoid double encoding
        let decodedPath = decodeURIComponent(filePath);
        // Then encode properly
        return encodeURIComponent(decodedPath);
    }

    loadPdfInIframe(viewUrl, iframe, fileName, loader, fullPath, folderPath = '') {
        iframe.src = 'about:blank';
        iframe.srcdoc = '';

        loader.style.display = 'flex';
        iframe.style.display = 'none';

        // If fullPath not provided, try to get it
        if (!fullPath) {
            const encodedFileName = encodeURIComponent(fileName);
            const encodedFolderPath = folderPath ? encodeURIComponent(folderPath) : '';
            const editUrl = `/Messages/ViewAttachment?filePath=${encodedFileName}`;

            fetch(editUrl)
                .then(response => response.json())
                .then(result => {
                    fullPath = result.fullPath || 'נתיב לא זמין';
                    this.renderPdfWithHeader(viewUrl, iframe, fileName, loader, fullPath, folderPath);
                })
                .catch(() => {
                    this.renderPdfWithHeader(viewUrl, iframe, fileName, loader, 'נתיב לא זמין', folderPath);
                });
        } else {
            this.renderPdfWithHeader(viewUrl, iframe, fileName, loader, fullPath, folderPath);
        }
    }

    renderPdfWithHeader(viewUrl, iframe, fileName, loader, fullPath, folderPath = '') {
        iframe.srcdoc = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    background: #f8fafc;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }
                .pdf-header {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    padding: 20px 30px;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                    z-index: 100;
                }
                .header-content {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 20px;
                    flex-wrap: wrap;
                }
                .header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
                .header-btn {
                    padding: 10px 18px;
                    background: rgba(255, 255, 255, 0.2);
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    backdrop-filter: blur(10px);
                }
                .header-btn:hover {
                    background: rgba(255, 255, 255, 0.3);
                    border-color: rgba(255, 255, 255, 0.5);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }
                .header-btn:active { transform: translateY(0); }
                .header-btn.copied {
                    background: rgba(16, 185, 129, 0.3);
                    border-color: rgba(16, 185, 129, 0.5);
                }
                .header-btn i { font-size: 1rem; }
                .path-display {
                    background: rgba(255, 255, 255, 0.15);
                    padding: 12px 16px;
                    border-radius: 8px;
                    color: white;
                    font-family: 'Segoe UI', 'Consolas', 'Monaco', monospace;
                    font-size: 0.9rem;
                    font-weight: 500;
                    word-break: break-all;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    direction: ltr;
                    text-align: left;
                    flex: 1;
                    max-width: 90%;
                    line-height: 1.4;
                    letter-spacing: 0.3px;
                }
                #pdf-container {
                    flex: 1;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                }
                embed, object {
                    width: 100%;
                    height: 100%;
                    border: none;
                    display: none;
                }
                embed.loaded, object.loaded {
                    display: block;
                }

                /* Loader Styles */
                .loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                    z-index: 10;
                }
                .loading.hidden {
                    display: none;
                }
                .spinner {
                    width: 60px;
                    height: 60px;
                    border: 5px solid rgba(255, 255, 255, 0.2);
                    border-top: 5px solid white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .error-container {
                    display: none;
                    text-align: center;
                    padding: 40px;
                }
                .error-btn {
                    padding: 12px 30px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 1rem;
                    transition: all 0.3s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    font-family: 'Segoe UI', Arial, sans-serif;
                }
                /* Loader Styles - Enhanced */
                .loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                    z-index: 1;
                    background: rgba(44, 62, 80, 0.95);
                    padding: 40px 60px;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

                .loading.hidden {
                    opacity: 0;
                    pointer-events: none;
                }

                .spinner {
                    width: 60px;
                    height: 60px;
                    border: 5px solid rgba(255, 255, 255, 0.2);
                    border-top: 5px solid white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin-bottom: 20px;
                }

                .loading-text {
                    color: white;
                    font-size: 1.2rem;
                    font-weight: 600;
                    margin-bottom: 10px;
                }

                .loading-subtext {
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 0.9rem;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                @media (max-width: 768px) {
                    .pdf-header { padding: 15px 20px; }
                    .header-content { flex-direction: column; align-items: stretch; }
                    .header-actions { width: 100%; }
                    .header-btn { flex: 1; justify-content: center; }
                    .path-display { max-width: 100%; }
                    .error-box { padding: 30px 20px; }
                    .error-icon { font-size: 3.5rem; }
                    .error-title { font-size: 1.4rem; }
                    .error-message { font-size: 1rem; }
                    .error-actions { flex-direction: column; }
                    .error-btn { width: 100%; justify-content: center; }
                }
            </style>
        </head>
        <body>
            <div class="pdf-header">
                <div class="header-content">
                    <div class="header-actions">
                        <button class="header-btn" onclick="downloadFile()">
                            <i class="fas fa-download"></i>
                            הורד קובץ
                        </button>
                    </div>
                </div>
            </div>

            <div id="pdf-container">
                <!-- Loader -->
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <div class="loading-text">טוען PDF...</div>
                    <div class="loading-subtext">אנא המתן</div>
                </div>
                <embed id="pdf-embed" 
                    src="${viewUrl}#toolbar=1&navpanes=1&scrollbar=1"
                    type="application/pdf"
                    style="display: none;">

                <div class="error-container" id="error">
                    <div class="error-icon">⚠️</div>
                    <h2>לא ניתן להציג את ה-PDF</h2>
                    <p>הדפדפן שלך לא תומך בתצוגת PDF מוטמעת</p>
                    <button class="btn" onclick="openInNewTab()">פתח בחלון חדש</button>
                    <button class="btn" onclick="downloadFile()">הורד קובץ</button>
            </div>

            <script>
                const pdfEmbed = document.getElementById('pdf-embed');
                const loading = document.getElementById('loading');
                const errorDiv = document.getElementById('error');

                let loadTimeout;
                let loaded = false;

                pdfEmbed.style.display = 'block';

                loadTimeout = setTimeout(() => {
                    if (!loaded) {
                        loading.classList.add('hidden');
                        pdfEmbed.style.display = 'none';
                        errorDiv.style.display = 'block';
                    }
                }, 20000);

                pdfEmbed.onload = () => {
                    clearTimeout(loadTimeout);
                    loaded = true;
                    loading.classList.add('hidden');
                    parent.postMessage('pdfLoaded', '*');
                };

                pdfEmbed.onerror = () => {
                    clearTimeout(loadTimeout);
                    loading.classList.add('hidden');
                    pdfEmbed.style.display = 'none';
                    errorDiv.style.display = 'block';
                };

                function copyPath() {
                    const pathText = document.getElementById('pathDisplay').textContent;
                    const btn = document.getElementById('copyBtn');

                    const textarea = document.createElement('textarea');
                    textarea.value = pathText;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);

                    textarea.select();
                    textarea.setSelectionRange(0, 99999);

                    try {
                        document.execCommand('copy');
                        btn.classList.add('copied');
                        btn.innerHTML = '<i class="fas fa-check"></i> הועתק!';

                        setTimeout(() => {
                            btn.classList.remove('copied');
                            btn.innerHTML = '<i class="fas fa-copy"></i> העתק נתיב';
                        }, 2000);
                    } catch (err) {
                        console.error('Copy failed:', err);
                        alert('שגיאה בהעתקת הנתיב');
                    }

                    document.body.removeChild(textarea);
                }

                function openInNewTab() {
                    window.open('${viewUrl}', '_blank');
                }
                
                function downloadFile() {
                    parent.postMessage({
                        action: 'download',
                        fileName: '${fileName}',
                        folderPath: '${folderPath || ''}'
                    }, '*');
                }
            </script>
        </body>
        </html>
    `;

        // Listen for PDF loaded message
        const messageHandler = (event) => {
            if (event.data === 'pdfLoaded') {
                loader.style.display = 'none';
                iframe.style.display = 'block';
                window.removeEventListener('message', messageHandler);
            }
        };

        window.addEventListener('message', messageHandler);

        iframe.onload = () => {
            setTimeout(() => {
                if (loader.style.display !== 'none') {
                    loader.style.display = 'none';
                    iframe.style.display = 'block';
                }
            }, 2000);
        };
    }

    // הוסף פונקציה חדשה לפתיחת קובץ מצורף בפופאפ
    openAttachmentInModal(filePath, fileName) {
        this.isModalOpen = true;

        // הכן את המודל
        document.getElementById('simpleDocumentTitle').textContent = fileName || this.getFileDisplayName(filePath);
        document.getElementById('simpleDocumentTitle').setAttribute('data-filepath', filePath);

        const iframe = document.getElementById('simpleDocumentFrame');
        const loader = document.getElementById('documentLoader');

        // נקה תוכן קודם
        iframe.src = 'about:blank';
        iframe.srcdoc = '';
        iframe.style.display = 'none';
        iframe.onload = null;

        // הצג מודל עם לוודר
        document.getElementById('simpleDocumentModal').style.display = 'block';
        document.body.style.overflow = 'hidden';

        // הצג לוודר
        loader.style.display = 'flex';

        // קבל את סוג הקובץ
        const extension = fileName ? fileName.split('.').pop().toLowerCase() :
            filePath.split('.').pop().toLowerCase();


        // Prepare URL for viewing file
        const normalizedPath = filePath.replace(/\\/g, '/');
        const encodedPath = this.encodeFilePath(normalizedPath);
        const viewUrl = `/Messages/ViewAttachment?filePath=${encodedPath}`;

        // Word and Excel files - convert to PDF and display
        if (['doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
            // Show converting message
            iframe.srcdoc = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                body {
                    background: #2c3e50;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    color: white;
                    font-family: Arial, sans-serif;
                    text-align: center;
                }
                .loading {
                    padding: 40px;
                }
                .spinner {
                    border: 4px solid rgba(255, 255, 255, 0.3);
                    border-top: 4px solid white;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .message {
                    font-size: 1.2rem;
                    margin-bottom: 10px;
                }
                .submessage {
                    font-size: 0.9rem;
                    color: rgba(255, 255, 255, 0.7);
                }
            </style>
        </head>
        <body>
            <div class="loading">
                <div class="spinner"></div>
                <div class="message">ממיר קובץ ל-PDF...</div>
                <div class="submessage">זה עשוי לקחת מספר שניות</div>
            </div>
        </body>
        </html>
    `;

            iframe.style.display = 'block';
            loader.style.display = 'none';

            // Load the converted PDF after short delay
            setTimeout(() => {
                this.loadPdfInIframe(viewUrl, iframe, fileName, loader, filePath, '');
            }, 500);


        }
        // קבצי טקסט
        else if (extension === 'txt') {
            fetch(viewUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('שגיאה בטעינת הקובץ');
                    }
                    return response.text();
                })
                .then(text => {
                    iframe.srcdoc = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            background: #f8fafc;
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            min-height: 100vh;
                            display: flex;
                            flex-direction: column;
                        }

                        .text-file-header {
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            padding: 20px 30px;
                            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                            position: sticky;
                            top: 0;
                            z-index: 100;
                        }

                        .header-content {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            gap: 20px;
                            flex-wrap: wrap;
                        }

                        .file-info {
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            color: white;
                        }

                        .file-info i {
                            font-size: 1.5rem;
                        }

                        .file-info span {
                            font-size: 1.1rem;
                            font-weight: 600;
                        }

                        .header-actions {
                            display: flex;
                            gap: 10px;
                            flex-wrap: wrap;
                        }

                        .header-btn {
                            padding: 10px 18px;
                            background: rgba(255, 255, 255, 0.2);
                            border: 2px solid rgba(255, 255, 255, 0.3);
                            color: white;
                            border-radius: 10px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 0.9rem;
                            transition: all 0.3s ease;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            backdrop-filter: blur(10px);
                        }

                        .header-btn:hover {
                            background: rgba(255, 255, 255, 0.3);
                            border-color: rgba(255, 255, 255, 0.5);
                            transform: translateY(-2px);
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                        }

                        .header-btn:active {
                            transform: translateY(0);
                        }

                        .header-btn.copied {
                            background: rgba(16, 185, 129, 0.3);
                            border-color: rgba(16, 185, 129, 0.5);
                        }

                        .header-btn i {
                            font-size: 1rem;
                        }

                        .path-display {
                            background: rgba(255, 255, 255, 0.15);
                            padding: 12px 16px;
                            border-radius: 8px;
                            color: white;
                            font-family: 'Courier New', monospace;
                            font-size: 0.85rem;
                            word-break: break-all;
                            margin-top: 10px;
                            border: 1px solid rgba(255, 255, 255, 0.2);
                            direction: ltr;
                            text-align: left;
                        }

                        .text-content {
                            flex: 1;
                            padding: 30px;
                            overflow: auto;
                        }

                        pre {
                            background: white;
                            padding: 25px;
                            border-radius: 12px;
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                            border: 1px solid #e2e8f0;
                            font-family: 'Courier New', monospace;
                            color: #1e293b;
                            line-height: 1.8;
                            font-size: 14px;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            margin: 0;
                        }

                        ::-webkit-scrollbar {
                            width: 10px;
                            height: 10px;
                        }

                        ::-webkit-scrollbar-track {
                            background: #f1f5f9;
                        }

                        ::-webkit-scrollbar-thumb {
                            background: #cbd5e1;
                            border-radius: 5px;
                        }

                        ::-webkit-scrollbar-thumb:hover {
                            background: #94a3b8;
                        }

                        @media (max-width: 768px) {
                            .text-file-header {
                                padding: 15px 20px;
                            }

                            .header-content {
                                flex-direction: column;
                                align-items: stretch;
                            }

                            .header-actions {
                                width: 100%;
                            }

                            .header-btn {
                                flex: 1;
                                justify-content: center;
                            }

                            .text-content {
                                padding: 20px;
                            }

                            pre {
                                padding: 15px;
                                font-size: 12px;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="text-file-header">
                        <div class="header-content">
                            <div class="file-info">
                                <i class="fas fa-file-alt"></i>
                                <span>${fileName || this.getFileDisplayName(filePath)}</span>
                            </div>
                            <div class="header-actions">
                                <button class="header-btn" onclick="downloadFile()">
                                    <i class="fas fa-download"></i>
                                    הורד קובץ
                                </button>
                            </div>
                        </div>
                        <div class="path-display" id="pathDisplay">${filePath}</div>
                    </div>
                    
                    <div class="text-content">
                        <pre>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                    </div>

                    <script>
                        function downloadFile() {
                            parent.postMessage({
                                action: 'download',
                                fileName: '${filePath}'
                            }, '*');
                        }
                    </script>
                </body>
                </html>
            `;

                    // Hide loader when content is ready
                    iframe.onload = () => {
                        loader.style.display = 'none';
                        iframe.style.display = 'block';
                    };
                })
                .catch(error => {
                    console.error('Error loading file:', error);
                    iframe.srcdoc = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        .error-container {
                            text-align: center;
                            max-width: 600px;
                            width: 100%;
                            background: white;
                            padding: 50px 40px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                        }
                        .error-icon {
                            font-size: 5rem;
                            color: #dc3545;
                            margin-bottom: 25px;
                            animation: shake 0.5s;
                        }
                        @keyframes shake {
                            0%, 100% { transform: translateX(0); }
                            25% { transform: translateX(-10px); }
                            75% { transform: translateX(10px); }
                        }
                        h3 {
                            color: #320F5B;
                            font-size: 1.8rem;
                            font-weight: bold;
                            margin-bottom: 15px;
                        }
                        p {
                            color: #666;
                            font-size: 1.1rem;
                            line-height: 1.6;
                            margin-bottom: 25px;
                        }
                        .error-details {
                            background: #f8f9fa;
                            padding: 15px;
                            border-radius: 10px;
                            border-right: 4px solid #dc3545;
                            text-align: right;
                            margin-top: 20px;
                        }
                        .error-details code {
                            color: #dc3545;
                            font-family: 'Courier New', monospace;
                            font-size: 0.9rem;
                        }
                        .retry-btn {
                            margin-top: 25px;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            color: white;
                            border: none;
                            border-radius: 10px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 1rem;
                            transition: all 0.3s ease;
                            display: inline-flex;
                            align-items: center;
                            gap: 10px;
                        }
                        .retry-btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <i class="fas fa-exclamation-triangle error-icon"></i>
                        <h3>שגיאה בטעינת הקובץ</h3>
                        <p>לא ניתן להציג את תוכן הקובץ</p>
                        <div class="error-details">
                            <code>${error.message}</code>
                        </div>
                        <button class="retry-btn" onclick="downloadFile()">
                            <i class="fas fa-download"></i>
                            הורד קובץ במקום
                        </button>
                    </div>

                    <script>
                        function downloadFile() {
                            parent.postMessage({
                                action: 'download',
                                fileName: '${filePath}'
                            }, '*');
                        }
                    </script>
                </body>
                </html>
            `;
                });
        }
        // PDF files
        else if (extension === 'pdf') {
            // Use the same method as converted PDFs to show header with buttons
            this.loadPdfInIframe(viewUrl, iframe, fileName, loader, filePath, '');
        }
        // תמונות
        else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
            iframe.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    body {
                        background: #2c3e50;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        padding: 20px;
                    }
                    img {
                        max-width: 100%;
                        max-height: calc(100vh - 40px);
                        height: auto;
                        border-radius: 10px;
                        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                        transition: transform 0.3s ease;
                    }
                    img:hover {
                        transform: scale(1.02);
                    }
                </style>
            </head>
            <body>
                <img src="${viewUrl}" alt="${fileName || 'תמונה'}" onload="parent.postMessage('loaded', '*')">
            </body>
            </html>
        `;

            // הסתר לוודר כשהתמונה נטענת
            iframe.onload = () => {
                setTimeout(() => {
                    loader.style.display = 'none';
                    iframe.style.display = 'block';
                }, 300);
            };
        }
        // קבצי HTML
        else if (['html', 'htm'].includes(extension)) {
            // טען תוכן HTML והזרק אותו ל-iframe
            fetch(viewUrl)
                .then(response => {
                    if (!response.ok) {
                        throw new Error('שגיאה בטעינת הקובץ');
                    }
                    return response.text();
                })
                .then(htmlContent => {
                    // הזרק תוכן HTML ל-iframe באמצעות srcdoc
                    iframe.srcdoc = htmlContent;

                    // הסתר לוודר כשה-HTML נטען
                    iframe.onload = () => {
                        setTimeout(() => {
                            loader.style.display = 'none';
                            iframe.style.display = 'block';
                        }, 300);
                    };
                })
                .catch(error => {
                    console.error('Error loading HTML:', error);
                    loader.style.display = 'none';
                    iframe.srcdoc = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        .error-container {
                            text-align: center;
                            max-width: 600px;
                            width: 100%;
                            background: white;
                            padding: 50px 40px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                        }
                        .error-icon {
                            font-size: 5rem;
                            color: #dc3545;
                            margin-bottom: 25px;
                        }
                        h3 {
                            color: #320F5B;
                            font-size: 1.8rem;
                            font-weight: bold;
                            margin-bottom: 15px;
                        }
                        p {
                            color: #666;
                            font-size: 1.1rem;
                            line-height: 1.6;
                            margin-bottom: 25px;
                        }
                        .error-details {
                            background: #f8f9fa;
                            padding: 15px;
                            border-radius: 10px;
                            border-right: 4px solid #dc3545;
                            text-align: right;
                            margin-top: 20px;
                        }
                        .error-details code {
                            color: #dc3545;
                            font-family: 'Courier New', monospace;
                            font-size: 0.9rem;
                        }
                        .btn {
                            margin-top: 25px;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            color: white;
                            border: none;
                            border-radius: 10px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 1rem;
                            transition: all 0.3s ease;
                            display: inline-flex;
                            align-items: center;
                            gap: 10px;
                        }
                        .btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <i class="fas fa-exclamation-triangle error-icon"></i>
                        <h3>שגיאה בטעינת קובץ HTML</h3>
                        <p>לא ניתן להציג את תוכן הקובץ</p>
                        <div class="error-details">
                            <code>${error.message}</code>
                        </div>
                        <button class="btn" onclick="parent.messagesManager.downloadAttachment('${filePath}')">
                            <i class="fas fa-download"></i>
                            הורד קובץ במקום
                        </button>
                    </div>
                </body>
                </html>
            `;
                    iframe.style.display = 'block';
                });
        }
        // קבצים אחרים
        else {
            iframe.srcdoc = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <link rel="stylesheet" href="/css/noc-portal.css">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                background: #f8fafc;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
            }

            .text-file-header {
                background: linear-gradient(135deg, #667eea, #764ba2);
                padding: 20px 30px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                position: sticky;
                top: 0;
                z-index: 100;
            }

            .header-content {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 20px;
                flex-wrap: wrap;
            }

            .file-info {
                display: flex;
                align-items: center;
                gap: 12px;
                color: white;
            }

            .file-info i {
                font-size: 1.5rem;
            }

            .file-info span {
                font-size: 1.1rem;
                font-weight: 600;
            }

            .header-actions {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }

            .header-btn {
                padding: 10px 18px;
                background: rgba(255, 255, 255, 0.2);
                border: 2px solid rgba(255, 255, 255, 0.3);
                color: white;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 600;
                font-size: 0.9rem;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 8px;
                backdrop-filter: blur(10px);
            }

            .header-btn:hover {
                background: rgba(255, 255, 255, 0.3);
                border-color: rgba(255, 255, 255, 0.5);
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            }

            .header-btn:active {
                transform: translateY(0);
            }

            .header-btn.copied {
                background: rgba(16, 185, 129, 0.3);
                border-color: rgba(16, 185, 129, 0.5);
            }

            .header-btn i {
                font-size: 1rem;
            }

            .path-display {
                background: rgba(255, 255, 255, 0.15);
                padding: 12px 16px;
                border-radius: 8px;
                color: white;
                font-family: 'Courier New', monospace;
                font-size: 0.85rem;
                word-break: break-all;
                margin-top: 10px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                direction: ltr;
                text-align: left;
            }

            .file-message {
                flex: 1;
                padding: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .message-box {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
                text-align: center;
                max-width: 500px;
            }

            .message-box i {
                font-size: 3rem;
                color: #667eea;
                margin-bottom: 20px;
            }

            .message-box h3 {
                color: #320F5B;
                font-size: 1.5rem;
                margin-bottom: 15px;
            }

            .message-box p {
                color: #666;
                font-size: 1rem;
                line-height: 1.6;
            }

            ::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }

            ::-webkit-scrollbar-track {
                background: #f1f5f9;
            }

            ::-webkit-scrollbar-thumb {
                background: #cbd5e1;
                border-radius: 5px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
            }

            @media (max-width: 768px) {
                .text-file-header {
                    padding: 15px 20px;
                }

                .header-content {
                    flex-direction: column;
                    align-items: stretch;
                }

                .header-actions {
                    width: 100%;
                }

                .header-btn {
                    flex: 1;
                    justify-content: center;
                }

                .file-message {
                    padding: 20px;
                }

                .message-box {
                    padding: 30px 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="text-file-header">
            <div class="header-content">
                <div class="file-info">
                    <i class="fas fa-file-alt"></i>
                    <span>${fileName || this.getFileDisplayName(filePath)}</span>
                </div>
                <div class="header-actions">
                    <button class="header-btn" onclick="downloadFile()">
                        <i class="fas fa-download"></i>
                        הורד קובץ
                    </button>
                </div>
            </div>
            <div class="path-display" id="pathDisplay">${filePath}</div>
        </div>

        <div class="file-message">
            <div class="message-box">
                <i class="fas fa-info-circle"></i>
                <h3>קובץ זה אינו נתמך לתצוגה ישירה</h3>
                <p>השתמש בכפתור "הורד קובץ" למעלה לפתיחה ישירה</p>
            </div>
        </div>

        <script>
            function downloadFile() {
                parent.postMessage({
                    action: 'download',
                    fileName: '${filePath}'
                }, '*');
            }
        </script>
    </body>
    </html>
    `;

            // הסתר לוודר אחרי השהייה קצרה
            iframe.onload = () => {
                loader.style.display = 'none';
                iframe.style.display = 'block';
            };
        }

        // הגדר מאזין הודעות
        this.setupDocumentMessageListener();
    }

    // הוסף פונקציה להגדרת מאזין הודעות עבור iframe
    setupDocumentMessageListener() {
        // הסר מאזין קיים אם יש
        if (this.documentMessageListener) {
            window.removeEventListener('message', this.documentMessageListener);
        }

        // צור מאזין חדש
        this.documentMessageListener = (event) => {
            if (event.data && event.data.action) {
                const { action, fileName, folderPath } = event.data;

                if (action === 'download') {
                    const filePath = document.getElementById('simpleDocumentTitle').getAttribute('data-filepath');
                    if (filePath) {
                        this.downloadAttachment(filePath);
                    }
                }
            }
        };

        window.addEventListener('message', this.documentMessageListener);
    }

    // הוסף פונקציה לסגירת מודל המסמך
    closeDocumentModal() {
        this.isModalOpen = false;

        // קבל את נתיב הקובץ הנוכחי לפני הסגירה
        const filePath = document.getElementById('simpleDocumentTitle').getAttribute('data-filepath');

        // סגור מודל
        document.getElementById('simpleDocumentModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('simpleDocumentFrame').src = 'about:blank';

        // הסר מאזין הודעות
        if (this.documentMessageListener) {
            window.removeEventListener('message', this.documentMessageListener);
            this.documentMessageListener = null;
        }

        // מחק PDF מומר אם היה קובץ Word/Excel
        if (filePath) {
            const extension = filePath.split('.').pop().toLowerCase();
            if (['doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
                this.deleteCachedAttachmentPdf(filePath);
            }
        }
    }

    // פונקציה למחיקת PDF מומר
    async deleteCachedAttachmentPdf(filePath) {
        try {
            const extension = filePath.split('.').pop().toLowerCase();

            // מחק רק עבור קבצי Word/Excel
            if (['doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
                const response = await fetch(`/Messages/DeleteCachedPdf?filePath=${encodeURIComponent(filePath)}`, {
                    method: 'DELETE'
                });

                const result = await response.json();
            }
        } catch (error) {
            console.error('Error deleting cached PDF:', error);
            // אל תציג שגיאה למשתמש - זה ניקוי רקע
        }
    }

    // עדכון פונקציית העלאת אקסל עם טיפול בשגיאות ואינדיקטור טעינה
    async uploadExcelForJobs(file) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/Messages/ParseExcelForJobs', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            // הסרת אינדיקטור הטעינה בכל מקרה
            this.hideExcelLoadingIndicator();
            if (result.success && result.jobs && Array.isArray(result.jobs)) {
                const normalizedJobs = result.jobs.map(job => ({
                    IsCompleted: job.isCompleted,
                    IsRunning: job.isRunning,
                    Order: job.order,
                    JobName: job.jobName,
                    Notes: job.notes,
                    Responsible: job.responsible,
                    CompletedBy: job.completedBy,
                    CompletedDate: job.completedDate,
                    RunningBy: job.runningBy,
                    RunningDate: job.runningDate,
                    ExecutionTime: job.executionTime || '',
                    HasAlarm: job.hasAlarm || false
                }));

                // מילוי טבלת הג'ובים
                this.loadJobsData(normalizedJobs);
                NotificationManager.show('קובץ אקסל נטען בהצלחה', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בטעינת קובץ האקסל', 'error');
            }
        } catch (error) {
            console.error('Error uploading Excel file:', error);
            NotificationManager.show('שגיאה בטעינת קובץ האקסל', 'error');
            this.hideExcelLoadingIndicator();
        }
        this.updateExcelUploadVisibility();
    }

    // הוספת פונקציה להצגת אינדיקטור טעינה בזמן העלאת אקסל
    setupExcelJobsUpload() {
        const dropZone = document.getElementById('excelJobsDropZone');
        const fileInput = document.getElementById('excelJobsFileInput');

        if (!dropZone || !fileInput) return;

        // לחיצה לבחירת קובץ
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        // שינוי בקובץ שנבחר
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.showExcelLoadingIndicator(); // הוספת אינדיקטור טעינה
                this.uploadExcelForJobs(e.target.files[0]);
            }
        });

        // מניעת התנהגויות ברירת מחדל של גרירה
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // הדגשת אזור הגרירה בעת גרירה מעליו
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-over');
            });
        });

        // טיפול בקבצים שנגררו
        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // בדיקת סוג הקובץ
                const file = files[0];
                const validTypes = ['.xlsx', '.xls'];
                const fileExt = '.' + file.name.split('.').pop().toLowerCase();

                if (validTypes.includes(fileExt)) {
                    this.showExcelLoadingIndicator(); // הוספת אינדיקטור טעינה
                    this.uploadExcelForJobs(file);
                } else {
                    NotificationManager.show('נא להעלות קובץ אקסל בפורמט XLSX או XLS', 'error');
                }
            }
        });
    }

    // פונקציה חדשה להצגת אינדיקטור טעינה
    showExcelLoadingIndicator() {
        const uploadSection = document.querySelector('.excel-jobs-upload-section');
        if (!uploadSection) return;

        // בדוק אם כבר קיים אינדיקטור טעינה
        if (uploadSection.querySelector('.excel-loading-indicator')) return;

        // יצירת אינדיקטור טעינה
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'excel-loading-indicator';
        loadingIndicator.innerHTML = `
        <div class="loader-spinner">
        </div>
        <p>מעלה ומעבד את קובץ האקסל...</p>
    `;

        // הוספת האינדיקטור לאזור ההעלאה
        const dropZone = uploadSection.querySelector('#excelJobsDropZone');
        if (dropZone) {
            dropZone.style.display = 'none';
        }

        uploadSection.appendChild(loadingIndicator);
    }

    // פונקציה חדשה להסרת אינדיקטור הטעינה
    hideExcelLoadingIndicator() {
        const uploadSection = document.querySelector('.excel-jobs-upload-section');
        if (!uploadSection) return;

        const loadingIndicator = uploadSection.querySelector('.excel-loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }

        // החזרת אזור הגרירה אם אין שורות בטבלה
        const tbody = document.getElementById('jobsTableBody');
        if (tbody && tbody.rows.length === 0) {
            const dropZone = uploadSection.querySelector('#excelJobsDropZone');
            if (dropZone) {
                dropZone.style.display = 'block';
            }
        }
    }

    // פונקציה חדשה לבדיקת מספר השורות בטבלה ועדכון תצוגת אזור העלאת האקסל
    updateExcelUploadVisibility() {
        const tbody = document.getElementById('jobsTableBody');
        const uploadSection = document.querySelector('.excel-jobs-upload-section');

        if (tbody && uploadSection) {
            const rowCount = tbody.rows.length;

            // אם יש לפחות שורה אחת, הסתר את אזור העלאת האקסל
            uploadSection.style.display = rowCount > 0 ? 'none' : 'block';
        }
        this.updateTimeClearButton();
    }

    // Add job row to table
    addJobRow() {
        const tbody = document.getElementById('jobsTableBody');
        const rowCount = tbody.rows.length + 1;

        const row = tbody.insertRow();

        // Enhanced status selection with visual indicators
        let statusSelectorHtml = `
    <div class="status-selector-edit">
        <div class="status-option-edit active" data-status="none">
            <i class="fas fa-minus-circle"></i>
            <span>לא התחיל</span>
        </div>
        <div class="status-option-edit" data-status="running">
            <i class="fas fa-circle running-icon"></i>
            <span>בריצה</span>
        </div>
        <div class="status-option-edit" data-status="completed">
            <i class="fas fa-check-circle completed-icon"></i>
            <span>בוצע</span>
        </div>
        <input type="hidden" class="job-status-value" value="none">
    </div>`;

        // יצירת אפשרויות לשעות ודקות
        let hoursOptions = '';
        for (let i = 0; i < 24; i++) {
            hoursOptions += `<option value="${i.toString().padStart(2, '0')}">${i.toString().padStart(2, '0')}</option>`;
        }

        let minutesOptions = '';
        for (let i = 0; i < 60; i += 5) {
            minutesOptions += `<option value="${i.toString().padStart(2, '0')}">${i.toString().padStart(2, '0')}</option>`;
        }

        row.innerHTML = `
        <td>${statusSelectorHtml}</td>
        <td><input type="number" class="job-order" value="" min="1"></td>
        <td><input type="text" class="job-name" placeholder="שם הג'וב"></td>
        <td><input type="text" class="job-notes" placeholder="הערות"></td>
        <td><input type="text" class="job-responsible" placeholder="שם אחראי"></td>
        <td>
            <div class="time-input-group">
                <select id="jobMinute" class="job-minute">
                    <option value="">דקות</option>
                    ${minutesOptions}
                </select>
                <span class="time-separator">:</span>
                <select id="jobHour" class="job-hour">
                    <option value="">שעה</option>
                    ${hoursOptions}
                </select>
                <button type="button" class="time-job-clear-btn" onclick="messagesManager.clearTimeSelection(event)" title="נקה בחירת זמן">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </td>
        <td>
            <label class="alarm-checkbox-container">
                <input type="checkbox" class="job-has-alarm" disabled>
                <span class="alarm-label">
                    <i class="fas fa-bell"></i>
                </span>
            </label>
        </td>
        <td><button type="button" class="delete-job-btn" onclick="messagesManager.deleteJobRow(this)">
            <i class="fas fa-trash"></i>
        </button></td>
    `;

        // הוסף מאזין לשדות השעה והדקות
        const hourSelect = row.querySelector('.job-hour');
        const minuteSelect = row.querySelector('.job-minute');
        const alarmCheckbox = row.querySelector('.job-has-alarm');

        const updateAlarmAvailability = () => {
            if (hourSelect.value && minuteSelect.value) {
                alarmCheckbox.disabled = false;
                this.updateTimeClearButton();
            } else {
                alarmCheckbox.disabled = true;
                alarmCheckbox.checked = false;
            }
        };

        hourSelect.addEventListener('change', updateAlarmAvailability);
        minuteSelect.addEventListener('change', updateAlarmAvailability);
        this.updateTimeClearButton();

        // Add event listeners to status options
        const statusOptions = row.querySelectorAll('.status-option-edit');
        statusOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                // Remove active class from all options
                statusOptions.forEach(opt => opt.classList.remove('active'));

                // Add active class to clicked option
                option.classList.add('active');

                // Update hidden input value
                const statusValue = option.getAttribute('data-status');
                row.querySelector('.job-status-value').value = statusValue;

                // Handle status change
                if (statusValue === 'completed') {
                    this.handleJobCompletionInEditForm(option, {
                        JobName: row.querySelector('.job-name').value || 'משימה חדשה'
                    });
                } else if (statusValue === 'running') {
                    this.handleJobRunningInEditForm(option, {
                        JobName: row.querySelector('.job-name').value || 'משימה חדשה'
                    });
                }
            });
        });

        this.updateExcelUploadVisibility();
    }

    // Delete job row
    deleteJobRow(button) {
        const row = button.closest('tr');
        row.remove();
        this.reorderJobs();
        this.updateExcelUploadVisibility();
    }

    // Reorder jobs after deletion
    reorderJobs() {
        const tbody = document.getElementById('jobsTableBody');
        const rows = tbody.querySelectorAll('tr');
        rows.forEach((row, index) => {
            const orderInput = row.querySelector('.job-order');
            if (orderInput) {
                orderInput.value = index + 1;
            }
        });
    }

    // Collect jobs data from table
    collectJobsData() {
        const tbody = document.getElementById('jobsTableBody');
        const rows = tbody.querySelectorAll('tr');
        const jobs = [];
        const messageId = document.getElementById('messageId').value;
        const existingMessage = messageId ? this.allMessages.find(m => m.id === messageId) : null;
        const existingJobs = existingMessage?.jobs || [];

        rows.forEach((row, index) => {
            const orderValue = row.querySelector('.job-order').value;
            const jobName = row.querySelector('.job-name').value || '';
            const hasAlarm = row.querySelector('.job-has-alarm').checked;
            // Get status from hidden input or from status select
            const statusInput = row.querySelector('.job-status-value');
            const statusSelect = row.querySelector('.job-status-select');
            const status = statusInput ? statusInput.value : (statusSelect ? statusSelect.value : 'none');

            // קבלת ערכי השעה והדקות מתיבות הבחירה
            const hourSelect = row.querySelector('.job-hour');
            const minuteSelect = row.querySelector('.job-minute');
            let executionTime = null;

            if (hourSelect && hourSelect.value && minuteSelect && minuteSelect.value) {
                executionTime = `${hourSelect.value}:${minuteSelect.value}`;
                this.updateTimeClearButton();
            }

            const isCompleted = status === 'completed';
            const isRunning = status === 'running';

            // קבל מידע על השלמה מ-dataset של השורה או מהמשימה הקיימת
            let completedBy = null;
            let completedDate = null;
            let runningBy = null;
            let runningDate = null;

            if (isCompleted) {
                // בדוק קודם ב-dataset של השורה (למשימות שהושלמו כעת)
                if (row.dataset.completedBy) {
                    completedBy = row.dataset.completedBy;
                    completedDate = row.dataset.completedDate || new Date().toISOString();
                }
                // אחרת בדוק בנתוני המשימה הקיימת (למשימות שהושלמו בעבר)
                else {
                    const existingJob = existingJobs.find(j => j.JobName === jobName && j.IsCompleted);
                    if (existingJob && existingJob.CompletedBy) {
                        completedBy = existingJob.CompletedBy;
                        completedDate = existingJob.CompletedDate;
                    }
                }

                // אם עדיין אין מידע על השלמה, השתמש במשתמש הנוכחי
                if (!completedBy) {
                    completedBy = this.getCurrentUser();
                    completedDate = new Date().toISOString();
                }
            }

            if (isRunning) {
                // בדוק קודם ב-dataset של השורה (למשימות שהחלו לרוץ כעת)
                if (row.dataset.runningBy) {
                    runningBy = row.dataset.runningBy;
                    runningDate = row.dataset.runningDate || new Date().toISOString();
                }
                // אחרת בדוק בנתוני המשימה הקיימת (למשימות שהחלו לרוץ בעבר)
                else {
                    const existingJob = existingJobs.find(j => j.JobName === jobName && j.IsRunning);
                    if (existingJob && existingJob.RunningBy) {
                        runningBy = existingJob.RunningBy;
                        runningDate = existingJob.RunningDate;
                    }
                }

                // אם עדיין אין מידע על ריצה, השתמש במשתמש הנוכחי
                if (!runningBy) {
                    runningBy = this.getCurrentUser();
                    runningDate = new Date().toISOString();
                }
            }

            const job = {
                IsCompleted: isCompleted,
                IsRunning: isRunning,
                Order: orderValue === '' ? -1 : parseInt(orderValue),
                JobName: jobName,
                Notes: row.querySelector('.job-notes').value,
                Responsible: row.querySelector('.job-responsible').value || '',
                ExecutionTime: executionTime,
                HasAlarm: hasAlarm,
                CompletedBy: completedBy,
                CompletedDate: completedDate,
                RunningBy: runningBy,
                RunningDate: runningDate
            };
            jobs.push(job);
        });

        // מיון: ריקים קודם, אחר כך לפי מספר
        jobs.sort((a, b) => {
            if (a.Order === -1 && b.Order === -1) return 0;
            if (a.Order === -1) return -1;
            if (b.Order === -1) return 1;
            return a.Order - b.Order;
        });

        return jobs;
    }

    setupAlertImageDragDrop() {
        // מאזין לאירועי גרירה על כל אזורי העלאת התמונות להתראות
        document.addEventListener('dragover', (e) => {
            // בדוק אם המודל פתוח
            if (!this.isModalOpen) return;

            // בדוק אם הגרירה היא מעל אזור העלאת תמונה להתראה
            const uploadArea = e.target.closest('.alert-image-upload');
            if (uploadArea) {
                e.preventDefault();
                e.stopPropagation();
                uploadArea.classList.add('drag-over');
            }
        });

        document.addEventListener('dragleave', (e) => {
            const uploadArea = e.target.closest('.alert-image-upload');
            if (uploadArea) {
                e.preventDefault();
                e.stopPropagation();
                uploadArea.classList.remove('drag-over');
            }
        });

        document.addEventListener('drop', (e) => {
            // בדוק אם הגרירה היא מעל אזור העלאת תמונה להתראה
            const uploadArea = e.target.closest('.alert-image-upload');
            if (uploadArea) {
                e.preventDefault();
                e.stopPropagation();
                uploadArea.classList.remove('drag-over');

                // בדוק אם יש קבצים בגרירה
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];

                    // בדוק אם זה קובץ תמונה
                    if (file.type.startsWith('image/')) {
                        // מצא את ה-alert-item המכיל את אזור ההעלאה
                        const alertItem = uploadArea.closest('.alert-item');
                        if (alertItem) {
                            // מצא את האלמנטים הרלוונטיים
                            const imageInput = alertItem.querySelector('.alert-image-input');
                            const preview = alertItem.querySelector('.alert-image-preview img');

                            if (imageInput && preview) {
                                // הגדר את הקובץ ב-FileList של ה-input
                                const dataTransfer = new DataTransfer();
                                dataTransfer.items.add(file);
                                imageInput.files = dataTransfer.files;

                                // הצג תצוגה מקדימה
                                const reader = new FileReader();
                                reader.onload = (e) => {
                                    preview.src = e.target.result;
                                    uploadArea.style.display = 'none';
                                    alertItem.querySelector('.alert-image-preview').style.display = 'block';
                                };
                                reader.readAsDataURL(file);

                                // שמור את הקובץ באלמנט
                                alertItem.file = file;

                                // הסר כל נתיב תמונה קיים
                                delete alertItem.dataset.imagePath;

                                // הצג הודעה
                                NotificationManager.show('תמונה הועלתה בהצלחה', 'success');
                            }
                        }
                    } else {
                        NotificationManager.show('יש להעלות קובץ תמונה בלבד', 'error');
                    }
                }
            }
        });
    }

    // Setup email drag and drop
    setupEmailDragDrop() {
        const dropZone = document.getElementById('emailDropZone');
        const fileInput = document.getElementById('emailFileInput');

        if (!dropZone || !fileInput) return;

        // Click to select file
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                // טיפול במספר קבצים
                Array.from(e.target.files).forEach(file => {
                    this.handleEmailFile(file);
                });
            }
        });

        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // Highlight drop zone when dragging over
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-over');
            });
        });

        // Handle dropped files
        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                // טיפול במספר קבצים
                Array.from(files).forEach(file => {
                    // Validate file type
                    const fileExt = '.' + file.name.split('.').pop().toLowerCase();
                    const validTypes = ['.msg', '.eml'];

                    if (validTypes.includes(fileExt)) {
                        this.handleEmailFile(file);
                    } else {
                        NotificationManager.show('נא להעלות קובץ מייל בפורמט MSG או EML', 'error');
                    }
                });
            }
        });
    }

    // פונקציה חדשה ליצירת מיכל המיילים
    createEmailsContainer() {
        const container = document.createElement('div');
        container.id = 'emailsContainer';
        container.className = 'emails-container';

        const preview = document.getElementById('emailPreview');
        if (preview) {
            preview.appendChild(container);
        }

        return container;
    }

    // פונקציה חדשה להסרת פריט מייל בודד
    removeEmailFileItem(button) {
        const item = button.closest('.email-preview-item');
        const container = item.parentElement;
        const dropZone = document.getElementById('emailDropZone');

        // הסר את הפריט
        container.removeChild(item);

        // בדוק אם זה היה הפריט האחרון
        if (container.children.length === 0) {
            // הסתר את אזור התצוגה המקדימה
            document.getElementById('emailPreview').style.display = 'none';
        }

        // וודא שאזור הגרירה תמיד מוצג אם יש פחות מ-5 קבצים
        if (container.children.length < 5) {
            dropZone.style.display = 'block';
        }
    }

    // Handle email file selection/drop
    handleEmailFile(file) {
        const preview = document.getElementById('emailPreview');
        const dropZone = document.getElementById('emailDropZone');
        const emailsContainer = document.getElementById('emailsContainer') || this.createEmailsContainer();

        // בדוק אם הגענו למקסימום קבצים
        const existingEmails = emailsContainer.querySelectorAll('.email-preview-item').length;
        if (existingEmails >= 5) {
            NotificationManager.show('ניתן להעלות עד 5 קבצי מייל', 'warning');
            return;
        }

        // הצג את אזור התצוגה המקדימה
        preview.style.display = 'block';

        // נקה את שם הקובץ מתווים אסורים
        const sanitizedFileName = this.sanitizeFileName(file.name);

        // יצירת אלמנט תצוגה מקדימה לקובץ הנוכחי
        const emailItem = document.createElement('div');
        emailItem.className = 'email-preview-item';
        emailItem.innerHTML = `
        <div class="preview-icon email">
            <i class="fas fa-envelope"></i>
        </div>
        <div class="preview-details">
            <div class="preview-filename">${sanitizedFileName}</div>
            <div class="preview-filesize">${this.formatFileSize(file.size)}</div>
        </div>
        <button class="preview-remove" onclick="messagesManager.removeEmailFileItem(this)">
            <i class="fas fa-times"></i>
        </button>
    `;

        // שמירת הקובץ באלמנט
        emailItem.file = file;

        // הוספת האלמנט לרשימת המיילים
        emailsContainer.appendChild(emailItem);

        // הסתר את אזור הגרירה רק אם הגענו ל-5 קבצים
        if (emailsContainer.querySelectorAll('.email-preview-item').length >= 5) {
            dropZone.style.display = 'none';
        }
    }

    // פונקציה חדשה לניקוי שם קובץ
    sanitizeFileName(fileName) {
        if (!fileName) return 'file';

        // החלף תווים אסורים בקו תחתון
        const invalidChars = /[<>:"\/\\|?*']/g;
        let sanitized = fileName.replace(invalidChars, '_');

        // וודא שהשם לא ארוך מדי
        if (sanitized.length > 200) {
            const extension = sanitized.split('.').pop();
            sanitized = sanitized.substring(0, 196) + '.' + extension;
        }

        return sanitized;
    }

    // Remove email file
    removeEmailFile() {
        const preview = document.getElementById('emailPreview');
        const dropZone = document.getElementById('emailDropZone');
        const fileInput = document.getElementById('emailFileInput');

        if (!preview || !dropZone || !fileInput) return;

        // Hide preview, show drop zone
        preview.style.display = 'none';
        dropZone.style.display = 'block';

        // Clear file input
        fileInput.value = '';
    }

    // Format file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    setupCategoryListener() {
        const categorySelect = document.getElementById('messageCategory');
        if (categorySelect) {
            categorySelect.addEventListener('change', (e) => {
                const selectedCategory = e.target.value;
                this.updateFormFieldsByCategory(selectedCategory);
                this.updateEmailFieldLabel(selectedCategory);
            });
        }
    }

    // פונקציה לטיפול בהעלאת קבצים
    async uploadFile(file, messageId) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('messageId', messageId);

        try {
            const response = await fetch('/Messages/UploadFile', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error uploading file:', error);
            return { success: false, error: error.message };
        }
    }

    // Parse CSV file
    async parseCsvFile(filePath) {
        try {
            const response = await fetch(`/Messages/ParseCsv?filePath=${encodeURIComponent(filePath)}`);
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error parsing CSV:', error);
            return { success: false, error: error.message };
        }
    }

    openEditMessageModal(messageId) {
        this.isModalOpen = true;
        const message = this.allMessages.find(m => m.id === messageId);
        if (!message) {
            NotificationManager.show('הודעה לא נמצאה', 'error');
            return;
        }

        if (message.category === 'אישורי כניסה') {
            this.openEntryPermitModal(message, false);
            return;
        }
        document.getElementById('messageId').value = message.id;
        document.getElementById('messageTitle').value = message.title;
        document.getElementById('messageCategory').value = message.category;
        document.getElementById('messagePriority').value = message.priority;

        // הצג שדות לפי קטגוריה
        this.updateFormFieldsByCategory(message.category);
        this.updateEmailFieldLabel(message.category);

        // נקה את כל השדות תחילה
        document.getElementById('messageContent').value = '';
        const tbody = document.getElementById('jobsTableBody');
        if (tbody) tbody.innerHTML = '';

        // Reset email upload area
        const dropZone = document.getElementById('emailDropZone');
        const preview = document.getElementById('emailPreview');
        const existingDisplay = document.getElementById('existingEmailDisplay');

        if (dropZone) dropZone.style.display = 'block';
        if (preview) preview.style.display = 'none';
        if (existingDisplay) existingDisplay.style.display = 'none';

        document.getElementById('existingEmailPath').value = '';
        document.getElementById('emailFileInput').value = '';
        // טען נתונים ספציפיים לפי קטגוריה
        if (message.category === 'בקשות וביצוע') {
            document.getElementById('messageContent').value = message.content || '';
            this.loadJobsData(message.jobs);

            // טיפול במייל מצורף
            if (message.attachedEmails && message.attachedEmails.length > 0) {
                // טיפול במערך מיילים
                this.showExistingEmails(message.attachedEmails);
            } else if (message.attachedEmail) {
                // טיפול במייל בודד (לתאימות לאחור) 
                this.showExistingEmails([message.attachedEmail]);
            }
            this.updateTimeClearButton();
        } else if (message.category === 'כללי' || message.category === 'דחוף') {
            document.getElementById('messageContent').value = message.content || '';
        } else if (message.category === 'סיכומי משמרת') {
            document.getElementById('incidentsInput').value = message.incidents || '';
            document.getElementById('openAlertsInput').value = message.openAlerts || '';
            document.getElementById('specialActionsInput').value = message.specialActions || '';
            document.getElementById('generalInfoInput').value = message.generalInfo || '';
            document.getElementById('openItemsInput').value = message.openItems || '';

            // איפוס תצוגות מקדימות של טבלאות
            const tablePreviewContainers = document.querySelectorAll('.table-preview-container');
            tablePreviewContainers.forEach(container => {
                container.style.display = 'none';
            });

            // טיפול במייל מצורף
            if (message.attachedEmails && message.attachedEmails.length > 0) {
                // טיפול במערך מיילים
                this.showExistingEmails(message.attachedEmails);
            } else if (message.attachedEmail) {
                // טיפול במייל בודד (לתאימות לאחור) 
                this.showExistingEmails([message.attachedEmail]);
            }

            const openAlertsInput = document.getElementById('openAlertsInput');
            if (openAlertsInput) {
                openAlertsInput.style.display = openAlertsInput.value ? 'block' : 'none';
            }

            // Load existing alert items
            const alertsContainer = document.getElementById('alertItemsContainer');
            if (alertsContainer && message.alertItems && Array.isArray(message.alertItems)) {
                // Clear existing items
                alertsContainer.innerHTML = '';

                // Add each alert item
                message.alertItems.forEach(item => {
                    const alertItem = document.createElement('div');
                    alertItem.className = 'alert-item';
                    alertItem.innerHTML = `
                <div class="alert-text-container">
                    <textarea class="alert-text form-textarea">${item.Text || ''}</textarea>
                </div>
                <div class="alert-image-container">
                    <div class="alert-image-upload" ${item.ImagePath ? 'style="display:none;"' : ''}>
                        <i class="fas fa-image"></i>
                        <span>הוסף תמונה</span>
                        <input type="file" class="alert-image-input" accept="image/*">
                    </div>
                    <div class="alert-image-preview" ${item.ImagePath ? '' : 'style="display:none;"'}>
                        <img src="${item.ImagePath ? `/Messages/GetImageFile?filePath=${encodeURIComponent(item.ImagePath)}` : ''}" alt="תצוגה מקדימה">
                        <button type="button" class="remove-alert-image">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <button type="button" class="remove-alert-item">
                    <i class="fas fa-trash"></i>
                </button>
            `;

                    // Store the image path in the element's dataset
                    if (item.ImagePath) {
                        alertItem.dataset.imagePath = item.ImagePath;
                    }

                    alertsContainer.appendChild(alertItem);

                    // Add event listeners
                    this.setupAlertItemEventListeners(alertItem);
                });
            }

            // טיפול בקבצים מצורפים
            if (message.attachments && message.attachments.length > 0) {
                this.showExistingShiftAttachments(message.attachments);
            }

            // For each textarea field that might contain tables
            const textFields = ['incidents', 'openAlerts', 'specialActions', 'generalInfo', 'openItems'];
            textFields.forEach(field => {
                const fieldId = field + 'Input';
                const textarea = document.getElementById(fieldId);

                if (textarea && message[field]) {
                    // Check if the content contains tables
                    if (message[field].includes('<table')) {
                        // Extract tables
                        const tableRegex = /<table[\s\S]*?<\/table>/gi;
                        let processedValue = message[field];
                        let match;
                        let index = 0;

                        // Replace each table with a placeholder
                        while ((match = tableRegex.exec(message[field])) !== null) {
                            const tableHtml = match[0];
                            const tableId = `table_${Date.now()}_${index++}`;
                            const placeholder = `[טבלה: ${tableId}]`;

                            // Store the HTML in a data attribute
                            textarea.dataset[tableId] = tableHtml;

                            // Replace the HTML with the placeholder
                            processedValue = processedValue.replace(tableHtml, placeholder);
                        }

                        textarea.value = processedValue;
                    } else {
                        textarea.value = message[field];
                    }

                    // Update the preview
                    const previewContainer = document.getElementById(`${fieldId}Preview`);
                    if (previewContainer) {
                        this.updateTablePreview(textarea, previewContainer);
                    }
                }
            });
        } else if (message.category === 'רשימות' || message.category === 'דוחות UC4') {
            if (message.csvFilePath) {
                this.showExistingCsvFile(message.csvFilePath);

                // שמור את נתוני הטבלה בשדה נסתר כדי שיהיו זמינים בעת השמירה
                const tableDataInput = document.createElement('input');
                tableDataInput.type = 'hidden';
                tableDataInput.id = 'existingTableData';
                tableDataInput.value = JSON.stringify(message.tableData || []);
                document.getElementById('addMessageForm').appendChild(tableDataInput);
            }
        }

        if (message.dueDate) {
            document.getElementById('messageDueDateHidden').value = message.dueDate;
            document.getElementById('messageDueDate').value = this.formatDateForDisplay(message.dueDate);
            document.getElementById('messageDueDateClear').style.display = 'inline-block';
        } else {
            document.getElementById('messageDueDateHidden').value = '';
            document.getElementById('messageDueDate').value = '';
            document.getElementById('messageDueDateClear').style.display = 'none';
        }

        document.getElementById('modalTitle').textContent = 'ערוך הודעה';
        document.getElementById('submitBtn').textContent = 'עדכן הודעה';

        this.loadEmployees().then(() => {
            const authorSelect = document.getElementById('messageAuthor');
            if (authorSelect) {
                const authorExists = this.employees.some(emp => emp.name === message.author);
                if (authorExists) {
                    authorSelect.value = message.author;
                } else {
                    authorSelect.value = 'other';
                    this.handleCustomAuthorInput(message.author);
                }
            }
        });

        document.getElementById('addMessageModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }


    // פונקציה חדשה להצגת קבצים מצורפים קיימים
    showExistingShiftAttachments(attachmentPaths) {
        if (!attachmentPaths || attachmentPaths.length === 0) return;

        const preview = document.getElementById('shiftAttachmentsPreview');
        const dropZone = document.getElementById('shiftAttachmentsDropZone');

        // הצג תצוגת preview
        if (preview) {
            preview.style.display = 'block';

            // יצירת מיכל הקבצים אם לא קיים
            let attachmentsContainer = document.getElementById('shiftAttachmentsContainer');
            if (!attachmentsContainer) {
                attachmentsContainer = this.createShiftAttachmentsContainer();
            } else {
                attachmentsContainer.innerHTML = ''; // נקה את המיכל אם קיים
            }

            // הוסף כל קובץ לתצוגה
            attachmentPaths.forEach(path => {
                const fileName = this.getFileDisplayName(path);
                const fileExt = fileName.split('.').pop().toLowerCase();

                // קבע את סוג האייקון לפי סוג הקובץ
                let iconClass = 'fa-file';
                if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExt)) {
                    iconClass = 'fa-file-image';
                } else if (['pdf'].includes(fileExt)) {
                    iconClass = 'fa-file-pdf';
                } else if (['doc', 'docx'].includes(fileExt)) {
                    iconClass = 'fa-file-word';
                } else if (['xls', 'xlsx'].includes(fileExt)) {
                    iconClass = 'fa-file-excel';
                }

                // יצירת אלמנט תצוגה מקדימה לקובץ
                const attachmentItem = document.createElement('div');
                attachmentItem.className = 'attachment-preview-item';
                attachmentItem.innerHTML = `
                <div class="preview-icon attachment">
                    <i class="fas ${iconClass}"></i>
                </div>
                <div class="preview-details">
                    <div class="preview-filename">${fileName}</div>
                    <div class="preview-filesize">קובץ מצורף קיים</div>
                </div>
                <button class="preview-remove" onclick="messagesManager.removeShiftAttachmentItem(this)">
                    <i class="fas fa-times"></i>
                </button>
            `;

                // שמירת הנתיב באלמנט
                attachmentItem.filePath = path;

                // הוספת האלמנט לרשימת הקבצים
                attachmentsContainer.appendChild(attachmentItem);
            });

            // הסתר את אזור הגרירה רק אם הגענו ל-5 קבצים
            if (attachmentsContainer.querySelectorAll('.attachment-preview-item').length >= 5) {
                dropZone.style.display = 'none';
            } else {
                dropZone.style.display = 'block';
            }
        }
    }

    // הצג מספר קבצי מייל קיימים
    showExistingEmails(filePaths) {
        if (!filePaths || filePaths.length === 0) return;

        const dropZone = document.getElementById('emailDropZone');
        const preview = document.getElementById('emailPreview');
        const existingDisplay = document.getElementById('existingEmailDisplay');

        // הצג תצוגת preview במקום existingDisplay
        if (preview) {
            preview.style.display = 'block';

            // יצירת מיכל המיילים אם לא קיים
            let emailsContainer = document.getElementById('emailsContainer');
            if (!emailsContainer) {
                emailsContainer = this.createEmailsContainer();
            } else {
                emailsContainer.innerHTML = ''; // נקה את המיכל אם קיים
            }

            // הוסף כל קובץ מייל לתצוגה
            filePaths.forEach(path => {
                const fileName = this.getFileDisplayName(path);

                // יצירת אלמנט תצוגה מקדימה לקובץ
                const emailItem = document.createElement('div');
                emailItem.className = 'email-preview-item';
                emailItem.innerHTML = `
                <div class="preview-icon email">
                    <i class="fas fa-envelope"></i>
                </div>
                <div class="preview-details">
                    <div class="preview-filename">${fileName}</div>
                    <div class="preview-filesize">קובץ מייל קיים</div>
                </div>
                <button class="preview-remove" onclick="messagesManager.removeEmailFileItem(this)">
                    <i class="fas fa-times"></i>
                </button>
            `;

                // שמירת הנתיב באלמנט
                emailItem.filePath = path;

                // הוספת האלמנט לרשימת המיילים
                emailsContainer.appendChild(emailItem);
            });

            // הסתר את אזור הגרירה רק אם הגענו ל-5 קבצים
            if (emailsContainer.querySelectorAll('.email-preview-item').length >= 5) {
                dropZone.style.display = 'none';
            } else {
                dropZone.style.display = 'block';
            }
        }

        // הסתר תצוגת קובץ בודד
        if (existingDisplay) {
            existingDisplay.style.display = 'none';
        }
    }

    // הצג קובץ CSV קיים
    showExistingCsvFile(filePath) {
        if (!filePath) return;

        // חלץ שם קובץ מהנתיב
        const fileName = this.getFileDisplayName(filePath);

        // הצג את התצוגה
        const existingDisplay = document.getElementById('existingCsvDisplay');
        if (existingDisplay) {
            existingDisplay.style.display = 'block';
            document.getElementById('existingCsvName').textContent = fileName;
            document.getElementById('existingCsvPath').value = filePath;

            // הסתר את input ההעלאה
            const csvFileInput = document.getElementById('csvFileInput');
            if (csvFileInput) {
                csvFileInput.style.display = 'none';
            }
        }
    }

    // צפה בקובץ CSV קיים
    viewExistingCsv() {
        const filePath = document.getElementById('existingCsvPath').value;
        if (!filePath) {
            NotificationManager.show('לא נמצא קובץ', 'error');
            return;
        }

        this.downloadCsv(this.allMessages.find(m => m.csvFilePath === filePath)?.id);
    }

    // הסר קובץ CSV קיים
    removeExistingCsv() {
        if (!confirm('האם אתה בטוח שברצונך להסיר את הקובץ המצורף?')) {
            return;
        }

        // הסתר תצוגת קובץ קיים
        const existingDisplay = document.getElementById('existingCsvDisplay');
        if (existingDisplay) {
            existingDisplay.style.display = 'none';
            document.getElementById('existingCsvPath').value = '';

            // הצג את input ההעלאה
            document.getElementById('csvFileInput').style.display = 'block';
            document.getElementById('csvFileInput').value = '';
        }

        NotificationManager.show('הקובץ הוסר', 'info');
    }

    // צפה בקובץ מייל קיים
    viewExistingEmail() {
        const filePath = document.getElementById('existingEmailPath').value;
        if (!filePath) {
            NotificationManager.show('לא נמצא קובץ', 'error');
            return;
        }

        this.downloadAttachment(filePath);
    }

    // הסר קובץ מייל קיים
    removeExistingEmail() {
        if (!confirm('האם אתה בטוח שברצונך להסיר את הקובץ המצורף?')) {
            return;
        }

        const dropZone = document.getElementById('emailDropZone');
        const preview = document.getElementById('emailPreview');
        const existingDisplay = document.getElementById('existingEmailDisplay');

        // הסתר תצוגת קובץ קיים
        if (existingDisplay) {
            existingDisplay.style.display = 'none';
            document.getElementById('existingEmailPath').value = '';
        }

        // הצג drop zone
        if (dropZone) dropZone.style.display = 'block';
        if (preview) preview.style.display = 'none';

        // נקה input
        existingDisplay.style.display = 'none';
        document.getElementById('emailFileInput').value = '';

        NotificationManager.show('הקובץ הוסר', 'info');
    }

    // Load jobs data into table
    loadJobsData(jobs) {
        const tbody = document.getElementById('jobsTableBody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (!jobs || jobs.length === 0) {
            this.addJobRow();
            return;
        }

        // יצירת אפשרויות לשעות ודקות
        let hoursOptions = '';
        for (let i = 0; i < 24; i++) {
            hoursOptions += `<option value="${i.toString().padStart(2, '0')}">${i.toString().padStart(2, '0')}</option>`;
        }

        let minutesOptions = '';
        for (let i = 0; i < 60; i += 5) {
            minutesOptions += `<option value="${i.toString().padStart(2, '0')}">${i.toString().padStart(2, '0')}</option>`;
        }

        jobs.forEach(job => {
            const row = tbody.insertRow();

            // הוסף נתוני השלמה לשורה אם המשימה הושלמה
            if (job.IsCompleted && job.CompletedBy) {
                row.dataset.completedBy = job.CompletedBy;
                row.dataset.completedDate = job.CompletedDate || '';
                row.classList.add('completed-job-row');
            }

            // הוסף נתוני ריצה לשורה אם המשימה בריצה
            if (job.IsRunning && job.RunningBy) {
                row.dataset.runningBy = job.RunningBy;
                row.dataset.runningDate = job.RunningDate || '';
                row.classList.add('running-job-row');
            }

            let executionHour = '';
            let executionMinute = '';

            if (job.ExecutionTime) {
                const timeParts = job.ExecutionTime.split(':');
                if (timeParts.length === 2) {
                    executionHour = timeParts[0];
                    executionMinute = timeParts[1];
                }
            }

            let statusSelectorHtml = `
        <div class="status-selector-edit">
            <div class="status-option-edit ${(!job.IsCompleted && !job.IsRunning) ? 'active' : ''}" data-status="none">
                <i class="fas fa-minus-circle"></i>
                <span>לא התחיל</span>
            </div>
            <div class="status-option-edit ${job.IsRunning ? 'active' : ''}" data-status="running">
                <i class="fas fa-circle running-icon"></i>
                <span>בריצה</span>
            </div>
            <div class="status-option-edit ${job.IsCompleted ? 'active' : ''}" data-status="completed">
                <i class="fas fa-check-circle completed-icon"></i>
                <span>בוצע</span>
            </div>
            <input type="hidden" class="job-status-value" value="${job.IsCompleted ? 'completed' : (job.IsRunning ? 'running' : 'none')}">
        </div>`;

            row.innerHTML = `
        <td>${statusSelectorHtml}</td>
        <td><input type="number" class="job-order" value="${job.Order === -1 ? '' : job.Order}" min="1"></td>
        <td><input type="text" class="job-name" value="${this.escapeHtml(job.JobName || '')}"></td>
        <td><input type="text" class="job-notes" value="${this.escapeHtml(job.Notes || '')}"></td>
        <td><input type="text" class="job-responsible" value="${this.escapeHtml(job.Responsible || '')}"></td>
        <td>
            <div class="time-input-group">
                <select id="jobMinute" class="job-minute">
                    <option value="">דקות</option>
                    ${minutesOptions}
                </select>
                <span class="time-separator">:</span>
                <select id="jobHour" class="job-hour">
                    <option value="">שעה</option>
                    ${hoursOptions}
                </select>
                <button type="button" class="time-job-clear-btn" onclick="messagesManager.clearTimeSelection(event)" title="נקה בחירת זמן">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </td>
        <td>
            <label class="alarm-checkbox-container">
                <input type="checkbox" class="job-has-alarm" ${job.HasAlarm ? 'checked' : ''} ${job.ExecutionTime ? '' : 'disabled'}>
                <span class="alarm-label">
                    <i class="fas fa-bell"></i>
                </span>
            </label>
        </td>
        <td><button type="button" class="delete-job-btn" onclick="messagesManager.deleteJobRow(this)">
            <i class="fas fa-trash"></i>
        </button></td>
        `;

            // עדכון ערכי השעה והדקות בתיבות הבחירה
            const hourSelect = row.querySelector('.job-hour');
            const minuteSelect = row.querySelector('.job-minute');

            if (executionHour) {
                hourSelect.value = executionHour;
            }

            if (executionMinute) {
                if (!minuteSelect.querySelector(`option[value="${executionMinute}"]`)) {
                    const newOption = document.createElement('option');
                    newOption.value = executionMinute;
                    newOption.textContent = executionMinute;
                    minuteSelect.appendChild(newOption);
                }
                minuteSelect.value = executionMinute;
            }

            // הוסף מאזין לשדות השעה והדקות
            const alarmCheckbox = row.querySelector('.job-has-alarm');

            const updateAlarmAvailability = () => {
                if (hourSelect.value && minuteSelect.value) {
                    this.updateTimeClearButton();
                    alarmCheckbox.disabled = false;
                } else {
                    alarmCheckbox.disabled = true;
                    alarmCheckbox.checked = false;
                }
            };

            hourSelect.addEventListener('change', updateAlarmAvailability);
            minuteSelect.addEventListener('change', updateAlarmAvailability);

            // Add event listeners to status options
            const statusOptions = row.querySelectorAll('.status-option-edit');
            statusOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    // Remove active class from all options
                    statusOptions.forEach(opt => opt.classList.remove('active'));

                    // Add active class to clicked option
                    option.classList.add('active');

                    // Update hidden input value
                    const statusValue = option.getAttribute('data-status');
                    row.querySelector('.job-status-value').value = statusValue;

                    // Clear previous status classes
                    row.classList.remove('completed-job-row', 'running-job-row');
                    delete row.dataset.completedBy;
                    delete row.dataset.completedDate;
                    delete row.dataset.runningBy;
                    delete row.dataset.runningDate;

                    // Handle status change
                    if (statusValue === 'completed') {
                        this.handleJobCompletionInEditForm(option, {
                            JobName: row.querySelector('.job-name').value || 'משימה חדשה'
                        });
                    } else if (statusValue === 'running') {
                        this.handleJobRunningInEditForm(option, {
                            JobName: row.querySelector('.job-name').value || 'משימה חדשה'
                        });
                    }
                });
            });
        });
        this.updateExcelUploadVisibility();
    }

    clearTimeSelection(event) {
        // מצא את האלמנט שעליו נלחץ (הכפתור)
        const clearBtn = event.currentTarget;

        // מצא את קבוצת הזמן שמכילה את הכפתור
        const timeGroup = clearBtn.closest('.time-input-group');

        if (timeGroup) {
            // מצא את האלמנטים הרלוונטיים בתוך הקבוצה הספציפית
            const hourInput = timeGroup.querySelector('.job-hour');
            const minuteInput = timeGroup.querySelector('.job-minute');

            // נקה את הערכים
            if (hourInput) hourInput.value = '';
            if (minuteInput) minuteInput.value = '';

            // עדכן את מצב הכפתור
            this.updateTimeClearButton();
        }
    }

    updateTimeClearButton() {
        // מצא את כל קבוצות הזמן בטבלה
        const timeGroups = document.querySelectorAll('.time-input-group');

        // עבור על כל קבוצת זמן
        timeGroups.forEach(group => {
            // מצא את האלמנטים הרלוונטיים בתוך הקבוצה הנוכחית
            const hourInput = group.querySelector('.job-hour');
            const minuteInput = group.querySelector('.job-minute');
            const clearBtn = group.querySelector('.time-job-clear-btn');

            if (!clearBtn) return;

            // הצג את הכפתור רק אם יש ערך בשעה או בדקות בשורה הספציפית הזו
            if (hourInput?.value || minuteInput?.value) {
                clearBtn.style.display = 'inline-block';
            } else {
                clearBtn.style.display = 'none';
            }
        });
    }

    handleJobRunningInEditForm(selectElement, job) {
        const row = selectElement.closest('tr');

        // שמור הפניה לאלמנט הבחירה ולשורה לשימוש מאוחר יותר
        this._tempEditFormStatusSelect = selectElement;
        this._tempEditFormRow = row;

        // קבל את שם המשימה
        const jobName = job.JobName || row.querySelector('.job-name').value || 'משימה חדשה';

        // הגדר ערכים במודל
        document.getElementById('runningMessageId').value = 'edit-form';
        document.getElementById('runningJobIndex').value = '-1'; // ערך מיוחד לטופס עריכה
        document.getElementById('runningJobTitle').textContent = jobName;

        // נקה בחירה קודמת
        const select = document.getElementById('runningActivityEmployeeName');
        if (select) select.value = '';

        // מלא את רשימת העובדים
        this.loadEmployees().then(() => {
            const select = document.getElementById('runningActivityEmployeeName');
            select.innerHTML = '<option value="">בחר עובד...</option>';

            // הוסף אפשרויות עובדים
            this.employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.name;
                option.textContent = employee.name;
                select.appendChild(option);
            });

            // הגדר עובד ברירת מחדל
            const lastEmployee = this.getLastSelectedAuthor();
            if (lastEmployee) {
                const optionExists = Array.from(select.options).some(
                    option => option.value === lastEmployee
                );

                if (optionExists) {
                    select.value = lastEmployee;
                }
            }
        });

        // הצג את המודל
        document.getElementById('runningEmployeeSelectionModal').style.display = 'block';

        // הוסף מאזין אירועים ישיר לכפתור השליחה
        const submitBtn = document.querySelector('#runningEmployeeSelectionForm button[type="submit"]');
        if (submitBtn) {
            submitBtn.onclick = (e) => {
                e.preventDefault();
                const employeeName = document.getElementById('runningActivityEmployeeName').value.trim();
                if (employeeName) {
                    // עדכן את תפריט הבחירה
                    selectElement.value = 'running';

                    // עדכן נתוני שורה
                    row.dataset.runningBy = employeeName;
                    row.dataset.runningDate = new Date().toISOString();
                    row.classList.add('running-job-row');
                    row.classList.remove('completed-job-row');
                    delete row.dataset.completedBy;
                    delete row.dataset.completedDate;

                    // שמור עובד שנבחר
                    this.saveLastSelectedAuthor(employeeName);

                    // סגור מודל
                    document.getElementById('runningEmployeeSelectionModal').style.display = 'none';

                    // הצג הודעה
                    NotificationManager.show(`משימה סומנה כבריצה ע"י ${employeeName}`, 'success');
                } else {
                    NotificationManager.show('נא לבחור עובד', 'warning');
                }
            };
        }
    }

    showEmployeeSelectionModalForRunning(messageId, jobIndex) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('runningEmployeeSelectionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'runningEmployeeSelectionModal';
            modal.className = 'employee-job-running-modal employee-job-completed-modal';

            modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">
                        <i class="fas fa-user-check"></i>
                        סימון משימה כהתחילה ריצה
                    </h3>
                    <button class="close-btn" onclick="messagesManager.closeRunningEmployeeSelectionModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="job-title-display">
                    <i class="fas fa-tasks"></i>
                    <span id="runningJobTitle"></span>
                </div>
                    <input type="hidden" id="runningMessageId">
                    <input type="hidden" id="runningJobIndex">
                <form id="runningEmployeeSelectionForm">
                    <div class="form-group">
                        <label class="form-label" for="runningActivityEmployeeName">
                            <i class="fas fa-user"></i>
                            שם העובד שמסמן התחלת ריצה
                        </label>
                        <select id="runningActivityEmployeeName"
                                class="form-select"
                                required>
                            <option value="">בחר עובד...</option>
                        </select>
                        <small class="form-help">
                            <i class="fas fa-info-circle"></i>
                            נא לבחור את העובד שמסמן התחלת ריצה
                        </small>
                    </div>
                    <div class="modal-footer">
                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary">אישור</button>
                            <button type="button" class="btn btn-secondary" onclick="messagesManager.closeRunningEmployeeSelectionModal()">ביטול</button>
                        </div>
                    </div>
                </form>
            </div>
        `;
            document.body.appendChild(modal);
        }

        const message = this.allMessages.find(m => m.id === messageId);
        if (!message || !message.jobs || !message.jobs[jobIndex]) {
            NotificationManager.show('משימה לא נמצאה', 'error');
            return;
        }

        const job = message.jobs[jobIndex];

        // Set values in the modal
        document.getElementById('runningMessageId').value = messageId;
        document.getElementById('runningJobIndex').value = jobIndex;
        document.getElementById('runningJobTitle').textContent = job.JobName || 'משימה';

        // Populate employee dropdown
        this.loadEmployees().then(() => {
            const select = document.getElementById('runningActivityEmployeeName');
            select.innerHTML = '<option value="">בחר עובד...</option>';

            // Add employee options
            this.employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.name;
                option.textContent = employee.name;
                select.appendChild(option);
            });

            // Set default employee
            const lastEmployee = this.getLastSelectedAuthor();
            if (lastEmployee) {
                const optionExists = Array.from(select.options).some(
                    option => option.value === lastEmployee
                );

                if (optionExists) {
                    select.value = lastEmployee;
                }
            }
        });

        // Add event listener to form
        const form = document.getElementById('runningEmployeeSelectionForm');
        form.onsubmit = async (e) => {
            e.preventDefault();
            const employeeName = document.getElementById('runningActivityEmployeeName').value.trim();
            if (employeeName) {
                // Save selected employee
                this.saveLastSelectedAuthor(employeeName);

                // Close modal
                modal.style.display = 'none';

                // Update job running status
                await this.updateJobRunningStatus(messageId, jobIndex, true, employeeName);
            } else {
                NotificationManager.show('נא לבחור עובד', 'warning');
            }
        };

        // Show the modal
        modal.style.display = 'block';
        // סמן שיש שינויים לא שמורים
        const messageFind = this.allMessages.find(m => m.id === messageId);
        if (messageFind) {
            messageFind._hasUnsavedChanges = true;
            this.updateSaveChangesButton(messageId);
        }
    }

    closeRunningEmployeeSelectionModal() {
        const messageId = document.getElementById('runningMessageId').value;
        const jobIndex = document.getElementById('runningJobIndex').value;

        // אם זה מטופס עריכה ולא נבחר עובד, אל תשנה את הסטטוס
        if (messageId === 'edit-form') {
            // אל תשנה את הסטטוס, רק סגור את המודל
        } else if (messageId && jobIndex !== undefined && jobIndex !== '') {
            // שחזר את הסטטוס הקודם אם המשתמש ביטל
            const message = this.allMessages.find(m => m.id === messageId);
            if (message && message.jobs && message.jobs[jobIndex] && message.jobs[jobIndex]._previousStatus) {
                const job = message.jobs[jobIndex];
                const prev = job._previousStatus;

                // שחזר את הסטטוס הקודם
                job.IsCompleted = prev.isCompleted;
                job.IsRunning = prev.isRunning;
                job.CompletedBy = prev.completedBy;
                job.RunningBy = prev.runningBy;

                // עדכן את התצוגה
                this.updatePopupJobsDisplay(messageId);
            }
        }

        // סגור את המודל
        document.getElementById('runningEmployeeSelectionModal').style.display = 'none';
    }

    async updateJobRunningStatus(messageId, jobIndex, isRunning, runningBy) {
        try {
            // Special case for edit form
            if (messageId === 'edit-form') {
                if (this._tempEditFormRunningCheckbox && this._tempEditFormRunningRow) {
                    if (runningBy) {
                        // Force the checkbox to be checked
                        setTimeout(() => {
                            this._tempEditFormRunningCheckbox.checked = true;
                        }, 0);

                        // Update row data
                        this._tempEditFormRunningRow.dataset.runningBy = runningBy;
                        this._tempEditFormRunningRow.dataset.runningDate = new Date().toISOString();
                        this._tempEditFormRunningRow.classList.add('running-job-row');
                        this.saveLastSelectedAuthor(runningBy);

                        // Show notification
                        NotificationManager.show(`משימה סומנה כבריצה ע"י ${runningBy}`, 'success');
                    } else {
                        // If no employee selected, uncheck
                        setTimeout(() => {
                            this._tempEditFormRunningCheckbox.checked = false;
                        }, 0);

                        delete this._tempEditFormRunningRow.dataset.runningBy;
                        delete this._tempEditFormRunningRow.dataset.runningDate;
                        this._tempEditFormRunningRow.classList.remove('running-job-row');
                    }
                } else {
                    console.error('Temporary checkbox or row reference is missing');
                }
                return;
            }

            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || !message.jobs[jobIndex]) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            // עדכון נתונים מקומיים
            message.jobs[jobIndex].IsRunning = isRunning;

            if (isRunning) {
                message.jobs[jobIndex].RunningBy = runningBy || this.getCurrentUser();
                message.jobs[jobIndex].RunningDate = new Date().toISOString();
                // אם מסמנים כבריצה, וודא שלא מסומן גם כבוצע
                message.jobs[jobIndex].IsCompleted = false;
                message.jobs[jobIndex].CompletedBy = null;
                message.jobs[jobIndex].CompletedDate = null;
            } else {
                message.jobs[jobIndex].RunningBy = null;
                message.jobs[jobIndex].RunningDate = null;
            }

            // שליחה לשרת
            const response = await fetch('/Messages/UpdateJobRunning', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messageId: messageId,
                    jobIndex: jobIndex,
                    isRunning: isRunning,
                    runningBy: isRunning ? message.jobs[jobIndex].RunningBy : null,
                    runningDate: isRunning ? message.jobs[jobIndex].RunningDate : null
                })
            });

            const result = await response.json();

            if (result.success) {
                // עדכון תצוגת הפופאפ
                this.updatePopupJobsDisplay(messageId);

                // עדכון התצוגה הנוכחית בלבד
                const messageCard = document.querySelector(`.notice-card[data-message-id="${messageId}"]`);
                if (messageCard) {
                    // עדכון תצוגת הכרטיס
                    const updatedMessage = this.allMessages.find(m => m.id === messageId);
                    if (updatedMessage) {
                        const updatedCard = this.createMessageCard(updatedMessage);
                        messageCard.parentNode.replaceChild(updatedCard, messageCard);
                    }
                }

                NotificationManager.show(
                    isRunning ? `משימה סומנה כבריצה ע"י ${message.jobs[jobIndex].RunningBy}` : 'סימון בריצה הוסר',
                    'success'
                );
            } else {
                // שחזור שינויים במקרה של שגיאה
                if (message.jobs[jobIndex]._previousStatus) {
                    const prev = message.jobs[jobIndex]._previousStatus;
                    message.jobs[jobIndex].IsCompleted = prev.isCompleted;
                    message.jobs[jobIndex].CompletedBy = prev.completedBy;
                    message.jobs[jobIndex].IsRunning = prev.isRunning;
                    message.jobs[jobIndex].RunningBy = prev.runningBy;
                } else {
                    message.jobs[jobIndex].IsRunning = !isRunning;
                    message.jobs[jobIndex].RunningBy = null;
                    message.jobs[jobIndex].RunningDate = null;
                }

                // עדכון התצוגה
                this.updatePopupJobsDisplay(messageId);

                NotificationManager.show(result.error || 'שגיאה בעדכון סטטוס ריצה', 'error');
            }
        } catch (error) {
            console.error('Error updating job running status:', error);
            NotificationManager.show('שגיאה בעדכון סטטוס ריצה', 'error');
        }
    }

    handleJobCompletionInEditForm(selectElement, job) {
        const row = selectElement.closest('tr');

        // שמור הפניה לאלמנט הבחירה ולשורה לשימוש מאוחר יותר
        this._tempEditFormStatusSelect = selectElement;
        this._tempEditFormRow = row;

        // קבל את שם המשימה
        const jobName = job.JobName || row.querySelector('.job-name').value || 'משימה חדשה';

        // הגדר ערכים במודל
        document.getElementById('completionMessageId').value = 'edit-form';
        document.getElementById('completionJobIndex').value = '-1'; // ערך מיוחד לטופס עריכה
        document.getElementById('completionJobTitle').textContent = jobName;

        // נקה בחירה קודמת
        const select = document.getElementById('completionActivityEmployeeName');
        if (select) select.value = '';

        // מלא את רשימת העובדים
        this.loadEmployees().then(() => {
            const select = document.getElementById('completionActivityEmployeeName');
            select.innerHTML = '<option value="">בחר עובד...</option>';

            // הוסף אפשרויות עובדים
            this.employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.name;
                option.textContent = employee.name;
                select.appendChild(option);
            });

            // הגדר עובד ברירת מחדל
            const lastEmployee = this.getLastSelectedAuthor();
            if (lastEmployee) {
                const optionExists = Array.from(select.options).some(
                    option => option.value === lastEmployee
                );

                if (optionExists) {
                    select.value = lastEmployee;
                }
            }
        });

        // הצג את המודל
        document.getElementById('employeeSelectionModal').style.display = 'block';

        // הוסף מאזין אירועים ישיר לכפתור השליחה של הטופס
        const submitBtn = document.querySelector('#employeeSelectionForm button[type="submit"]');
        if (submitBtn) {
            submitBtn.onclick = (e) => {
                e.preventDefault();
                const employeeName = document.getElementById('completionActivityEmployeeName').value.trim();
                if (employeeName) {
                    // עדכן את תפריט הבחירה
                    selectElement.value = 'completed';

                    // עדכן נתוני שורה
                    row.dataset.completedBy = employeeName;
                    row.dataset.completedDate = new Date().toISOString();
                    row.classList.add('completed-job-row');
                    row.classList.remove('running-job-row');
                    delete row.dataset.runningBy;
                    delete row.dataset.runningDate;

                    // שמור עובד שנבחר
                    this.saveLastSelectedAuthor(employeeName);

                    // סגור מודל
                    document.getElementById('employeeSelectionModal').style.display = 'none';

                    // הצג הודעה
                    NotificationManager.show(`משימה סומנה כבוצעה ע"י ${employeeName}`, 'success');
                } else {
                    NotificationManager.show('נא לבחור עובד', 'warning');
                }
            };
        }
    }

    // Show employee selection modal for edit form
    showEmployeeSelectionModalForEditForm(job, callback) {
        // Create modal if it doesn't exist
        let modal = document.getElementById('employeeSelectionModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'employeeSelectionEditModal';
            modal.className = 'modal';

            modal.innerHTML = `
            <div class="modal-content employee-selection-modal">
                <span class="close-btn" onclick="document.getElementById('employeeSelectionEditModal').style.display='none'">&times;</span>
                <h3>בחר מבצע</h3>
                <p>מי ביצע את המשימה?</p>
                <div class="job-title-display">
                    <i class="fas fa-tasks"></i>
                    <span id="editCompletionJobTitle"></span>
                </div>
                <select id="editCompletionEmployeeName" class="form-input">
                    <option value="">בחר עובד...</option>
                </select>
                <div class="modal-buttons">
                    <button id="confirmEditEmployeeBtn" class="btn btn-primary">אישור</button>
                    <button class="btn btn-secondary" onclick="messagesManager.closeEmployeeSelectionEditModal(null)">ביטול</button>
                </div>
            </div>
        `;
            document.body.appendChild(modal);
        }

        // Set job title
        document.getElementById('editCompletionJobTitle').textContent = job.JobName;

        // Populate employee dropdown
        this.loadEmployees().then(() => {
            const select = document.getElementById('editCompletionEmployeeName');
            select.innerHTML = '<option value="">בחר עובד...</option>';

            // Add employee options
            this.employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.name;
                option.textContent = employee.name;
                select.appendChild(option);
            });

            // Set default employee
            const lastEmployee = this.getLastSelectedAuthor();
            if (lastEmployee) {
                const optionExists = Array.from(select.options).some(
                    option => option.value === lastEmployee
                );

                if (optionExists) {
                    select.value = lastEmployee;
                }
            }
        });

        // Set up confirm button
        const confirmBtn = document.getElementById('confirmEditEmployeeBtn');
        confirmBtn.onclick = () => {
            const selectedEmployee = document.getElementById('editCompletionEmployeeName').value;
            if (!selectedEmployee) {
                NotificationManager.show('יש לבחור עובד', 'warning');
                return;
            }

            // Save selected employee as last used
            this.saveLastSelectedAuthor(selectedEmployee);

            // Close modal and call callback with selected employee
            modal.style.display = 'none';
            callback(selectedEmployee);
        };

        // Store callback for cancel button
        this.closeEmployeeSelectionEditModalCallback = callback;

        // Show modal
        modal.style.display = 'block';
    }

    // Close the edit form employee selection modal
    closeEmployeeSelectionEditModal(selectedEmployee) {
        document.getElementById('employeeSelectionEditModal').style.display = 'none';

        // Call callback with null to indicate cancellation
        if (this.closeEmployeeSelectionEditModalCallback) {
            this.closeEmployeeSelectionEditModalCallback(selectedEmployee);
            this.closeEmployeeSelectionEditModalCallback = null;
        }
    }

    // Helper function to escape HTML
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    closeAddMessageModal() {
        this.isModalOpen = false;
        document.getElementById('addMessageModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('addMessageForm').reset();
        document.getElementById('messageId').value = '';

        // נקה את טבלת הג'ובים
        const tbody = document.getElementById('jobsTableBody');
        if (tbody) tbody.innerHTML = '';

        // נקה את כל הדאטה-אטריביוטים של טבלאות
        const textareaFields = ['incidentsInput', 'openAlertsInput', 'specialActionsInput', 'generalInfoInput', 'openItemsInput'];
        textareaFields.forEach(fieldId => {
            const textarea = document.getElementById(fieldId);
            if (textarea) {
                // מחק את כל הדאטה-אטריביוטים שמתחילים ב-table_
                Object.keys(textarea.dataset).forEach(key => {
                    if (key.startsWith('table_')) {
                        delete textarea.dataset[key];
                    }
                });
            }
        });

        const tablePreviewContainers = document.querySelectorAll('.table-preview-container');
        tablePreviewContainers.forEach(container => {
            container.style.display = 'none';
        });

        // נקה תצוגת קובץ מייל קיים
        document.getElementById('existingEmailDisplay').style.display = 'none';
        document.getElementById('existingEmailPath').value = '';
        document.getElementById('emailFileInput').style.display = 'block';
        document.getElementById('emailFileInput').value = '';

        // נקה תצוגת קובץ CSV קיים
        const existingCsvDisplay = document.getElementById('existingCsvDisplay');
        if (existingCsvDisplay) {
            existingCsvDisplay.style.display = 'none';
            document.getElementById('existingCsvPath').value = '';
            document.getElementById('csvFileInput').style.display = 'block';
            document.getElementById('csvFileInput').value = '';
        }

        document.getElementById('modalTitle').textContent = 'הוסף הודעה חדשה';
        document.getElementById('submitBtn').textContent = 'הוסף הודעה';

        // איפוס הקבצים המצורפים
        this.resetAttachments();
    }

    // פונקציה חדשה לאיפוס הקבצים המצורפים
    resetAttachments() {
        // איפוס קבצים מצורפים לסיכומי משמרת
        const shiftAttachmentsContainer = document.getElementById('shiftAttachmentsContainer');
        if (shiftAttachmentsContainer) {
            shiftAttachmentsContainer.innerHTML = '';
        }

        const shiftAttachmentsPreview = document.getElementById('shiftAttachmentsPreview');
        if (shiftAttachmentsPreview) {
            shiftAttachmentsPreview.style.display = 'none';
        }

        const shiftAttachmentsDropZone = document.getElementById('shiftAttachmentsDropZone');
        if (shiftAttachmentsDropZone) {
            shiftAttachmentsDropZone.style.display = 'block';
        }

        // איפוס התראות עם תמונות
        const alertItemsContainer = document.getElementById('alertItemsContainer');
        if (alertItemsContainer) {
            alertItemsContainer.innerHTML = '';

            // הוסף התראה ריקה אחת כברירת מחדל
            this.addAlertItem();
        }

        // איפוס קבצי מייל מצורפים
        const emailsContainer = document.getElementById('emailsContainer');
        if (emailsContainer) {
            emailsContainer.innerHTML = '';
        }

        const emailPreview = document.getElementById('emailPreview');
        if (emailPreview) {
            emailPreview.style.display = 'none';
        }

        const emailDropZone = document.getElementById('emailDropZone');
        if (emailDropZone) {
            emailDropZone.style.display = 'block';
        }

        // איפוס שדות נסתרים
        const existingEmailPath = document.getElementById('existingEmailPath');
        if (existingEmailPath) {
            existingEmailPath.value = '';
        }

        const existingCsvPath = document.getElementById('existingCsvPath');
        if (existingCsvPath) {
            existingCsvPath.value = '';
        }

        // איפוס קבצי CSV
        const existingCsvDisplay = document.getElementById('existingCsvDisplay');
        if (existingCsvDisplay) {
            existingCsvDisplay.style.display = 'none';
        }

        const csvFileInput = document.getElementById('csvFileInput');
        if (csvFileInput) {
            csvFileInput.value = '';
            csvFileInput.style.display = 'block';
        }

        // איפוס שדות קלט קובץ
        const emailFileInput = document.getElementById('emailFileInput');
        if (emailFileInput) {
            emailFileInput.value = '';
        }

        const shiftAttachmentsFileInput = document.getElementById('shiftAttachmentsFileInput');
        if (shiftAttachmentsFileInput) {
            shiftAttachmentsFileInput.value = '';
        }

        // איפוס תצוגת קובץ מייל קיים
        const existingEmailDisplay = document.getElementById('existingEmailDisplay');
        if (existingEmailDisplay) {
            existingEmailDisplay.style.display = 'none';
        }

        // איפוס שדות טקסט של סיכומי משמרת
        const incidentsInput = document.getElementById('incidentsInput');
        if (incidentsInput) {
            incidentsInput.value = '';
        }

        const openAlertsInput = document.getElementById('openAlertsInput');
        if (openAlertsInput) {
            openAlertsInput.value = '';
            // הסתר את שדה openAlertsInput כשהוא ריק
            openAlertsInput.style.display = 'none';
        }

        const specialActionsInput = document.getElementById('specialActionsInput');
        if (specialActionsInput) {
            specialActionsInput.value = '';
        }

        const generalInfoInput = document.getElementById('generalInfoInput');
        if (generalInfoInput) {
            generalInfoInput.value = '';
        }

        const openItemsInput = document.getElementById('openItemsInput');
        if (openItemsInput) {
            openItemsInput.value = '';
        }

        // איפוס תצוגות מקדימות של טבלאות
        const tablePreviewContainers = document.querySelectorAll('.table-preview-container');
        tablePreviewContainers.forEach(container => {
            container.style.display = 'none';
        });

        // איפוס מערכים פנימיים
        this.attachedEmails = [];
    }

    // פונקציה לחלץ ולהציג שם קובץ יפה
    getFileDisplayName(filePath) {
        if (!filePath) return 'קובץ מצורף';

        // חלץ שם קובץ מהנתיב
        let fileName = filePath.split('/').pop().split('\\').pop();

        // הסר תווים מיוחדים מתחילת השם (GUID וכו')
        fileName = fileName.replace(/^[a-f0-9-]+_/i, '');

        // קיצור שם ארוך - שיפור התצוגה
        if (fileName.length > 25) {
            const ext = fileName.split('.').pop();
            const name = fileName.substring(0, 20);
            fileName = `${name}...${ext}`;
        }

        return fileName;
    }

    // Message popup
    openMessagePopup(messageId) {
        this.isModalOpen = true;
        const message = this.allMessages.find(m => m.id === messageId);
        if (!message) {
            NotificationManager.show('הודעה לא נמצאה', 'error');
            return;
        }

        document.getElementById('popupCategory').textContent = message.category;
        document.getElementById('popupTitle').textContent = message.title;
        // שמור את ה-ID של ההודעה כמאפיין של הכותרת
        document.getElementById('popupTitle').setAttribute('data-message-id', message.id);
        document.getElementById('popupAuthor').textContent = message.author;
        document.getElementById('popupAuthorAvatar').textContent = message.author.charAt(0);
        document.getElementById('popupDate').textContent = this.getTimeAgo(message.date);

        // תוכן לפי קטגוריה
        let contentHtml = '';

        switch (message.category) {
            case 'בקשות וביצוע':
                contentHtml = this.createFullExecutionContent(message);
                break;
            case 'בקשות':
                contentHtml = this.createFullRequestContent(message);
                break;
            case 'רשימות':
                contentHtml = this.createFullReportContent(message);
                break;
            case 'דוחות UC4':
                contentHtml = this.createFullUc4ReportContent(message);
                break;
            case 'סיכומי משמרת':
                contentHtml = this.createFullShiftSummaryContent(message);
                break;
            default:
                contentHtml = `<p>${message.content}</p>`;
        }

        document.getElementById('popupContent').innerHTML = contentHtml;

        const priorityElement = document.getElementById('popupPriority');
        priorityElement.textContent = message.priority;
        priorityElement.className = 'message-popup-priority';

        switch (message.priority) {
            case 'דחוף':
                priorityElement.classList.add('urgent');
                break;
            case 'חשוב':
                priorityElement.classList.add('important');
                break;
            default:
                priorityElement.classList.add('normal');
        }

        document.getElementById('messagePopup').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    createFullExecutionContent(message) {
        let html = '<div class="execution-jobs-full">';

        if (message.jobs && message.jobs.length > 0) {
            // מיון הג'ובים
            const sortedJobs = [...message.jobs].sort((a, b) => {
                if (a.Order === -1 && b.Order === -1) return 0;
                if (a.Order === -1) return -1;
                if (b.Order === -1) return 1;
                return a.Order - b.Order;
            });

            // הוסף מעקב אחר שינויים
            message._hasUnsavedChanges = false;

            html += '<table class="jobs-full-table">';
            html += '<thead><tr>';
            html += '<th>סטטוס</th>';
            html += '<th>סדר</th>';
            html += '<th>שם ג\'וב</th>';
            html += '<th>הערות</th>';
            html += '<th>אחראי</th>';
            html += '<th>שעת ביצוע</th>';
            html += '<th>התראה</th>';
            html += '<th>בוצע/בריצה ע"י</th>';
            html += '</tr></thead>';
            html += '<tbody>';

            sortedJobs.forEach((job, index) => {
                // שמור את הסטטוס הנוכחי למקרה של ביטול
                job._previousStatus = {
                    isCompleted: job.IsCompleted,
                    isRunning: job.IsRunning,
                    completedBy: job.CompletedBy,
                    runningBy: job.RunningBy
                };

                html += `<tr class="${job.IsCompleted ? 'completed-job' : ''} ${job.IsRunning ? 'running-job' : ''}">`;

                html += `<td class="job-status">
                <div class="status-selector">
                    <div class="status-option ${(!job.IsCompleted && !job.IsRunning) ? 'active' : ''}" 
                         onclick="messagesManager.handleStatusChange('${message.id}', ${index}, 'none')">
                        <i class="fas fa-minus-circle"></i>
                        <span>לא התחיל</span>
                    </div>
                    <div class="status-option ${job.IsRunning ? 'active' : ''}" 
                         onclick="messagesManager.handleStatusChange('${message.id}', ${index}, 'running')">
                        <i class="fas fa-circle running-icon"></i>
                        <span>בריצה</span>
                    </div>
                    <div class="status-option ${job.IsCompleted ? 'active' : ''}" 
                         onclick="messagesManager.handleStatusChange('${message.id}', ${index}, 'completed')">
                        <i class="fas fa-check-circle completed-icon"></i>
                        <span>בוצע</span>
                    </div>
                </div>
            </td>`;

                html += `<td>${job.Order !== -1 ? job.Order : '-'}</td>`;
                html += `<td>${job.JobName}</td>`;
                html += `<td>${job.Notes || '-'}</td>`;
                html += `<td>${job.Responsible || '-'}</td>`;

                // עמודת שעת ביצוע
                html += '<td>';
                if (job.ExecutionTime) {
                    html += `<span class="execution-time"><i class="fas fa-clock"></i> ${job.ExecutionTime}</span>`;
                } else {
                    html += '-';
                }
                html += '</td>';

                // עמודת התראה
                html += '<td>';
                if (job.HasAlarm && job.ExecutionTime) {
                    html += `<span class="alarm-indicator active" title="שעון מעורר פעיל"><i class="fas fa-bell"></i></span>`;
                } else if (job.ExecutionTime) {
                    html += `<span class="alarm-indicator inactive" title="אין שעון מעורר"><i class="far fa-bell-slash"></i></span>`;
                } else {
                    html += '-';
                }
                html += '</td>';

                // עמודה מאוחדת למבצע
                html += '<td>';
                if (job.IsCompleted && job.CompletedBy) {
                    html += `<span class="completed-by" title="בוצע ע"י ${job.CompletedBy}">✓ ${job.CompletedBy}</span>`;
                } else if (job.IsRunning && job.RunningBy) {
                    html += `<span class="running-by" title="בריצה ע"י ${job.RunningBy}">● ${job.RunningBy}</span>`;
                } else {
                    html += '-';
                }
                html += '</td>';

                html += '</tr>';
            });

            html += '</tbody></table>';

            // סטטיסטיקה
            const completed = message.jobs.filter(j => j.IsCompleted).length;
            const running = message.jobs.filter(j => j.IsRunning).length;
            const total = message.jobs.length;
            const percentage = Math.round((completed / total) * 100);

            html += '<div class="jobs-stats">';
            html += `<div class="stat-item">`;
            html += `<span class="stat-label">בוצעו:</span>`;
            html += `<span class="stat-value">${completed}/${total} (${percentage}%)</span>`;
            html += `</div>`;
            html += `<div class="stat-item">`;
            html += `<span class="stat-label">בריצה:</span>`;
            html += `<span class="stat-value">${running}/${total}</span>`;
            html += `</div>`;
            html += '</div>';
        }

        // בדיקה אם יש מערך מיילים או מייל בודד
        if (message.attachedEmails && message.attachedEmails.length > 0) {
            const encodedPaths = encodeURIComponent(JSON.stringify(message.attachedEmails));
            html += '<div class="attached-file-section">';
            html += '<i class="fas fa-envelope"></i>';
            html += `<a href="#" onclick="messagesManager.downloadAttachment('${encodedPaths}'); return false;">`;
            html += '<i class="fas fa-download"></i>';
            html += `הורד/פתח ${message.attachedEmails.length} מיילים מצורפים`;
            html += '</a>';
            html += '</div>';
        } else if (message.attachedEmail) {
            const encodedPath = encodeURIComponent(message.attachedEmail);
            html += '<div class="attached-file-section">';
            html += '<i class="fas fa-envelope"></i>';
            html += `<a href="#" onclick="messagesManager.downloadAttachment('${encodedPath}'); return false;">`;
            html += '<i class="fas fa-download"></i>';
            html += 'הורד/פתח מייל מצורף';
            html += '</a>';
            html += '</div>';
        }

        html += '</div>';

        // כפתורי פעולה - הוספת כפתור שליחת מייל
        if (message.jobs && message.jobs.length > 0) {
            html += `<div class="print-actions">
            <button class="btn-download-pdf" onclick="messagesManager.downloadJobsTableAsPdf('${message.id}')">
                <i class="fas fa-file-pdf"></i> הורד טבלת ביצוע כ-PDF
            </button>
            <button class="btn-send-email" onclick="messagesManager.sendJobsTableEmail('${message.id}')">
                <i class="fas fa-envelope"></i> שלח טבלת ביצוע במייל
            </button>
        </div>`;
        }

        html += `</div>`;

        return html;
    }

    // יצירת HTML לטבלת ג'ובים
    buildJobsHtmlEmail(message) {
        // מיון הג'ובים
        const sortedJobs = [...message.jobs].sort((a, b) => {
            if (a.Order === -1 && b.Order === -1) return 0;
            if (a.Order === -1) return -1;
            if (b.Order === -1) return 1;
            return a.Order - b.Order;
        });

        // חישוב סטטיסטיקה
        const completed = sortedJobs.filter(j => j.IsCompleted).length;
        const running = sortedJobs.filter(j => j.IsRunning).length;
        const total = sortedJobs.length;
        const percentage = Math.round((completed / total) * 100);

        // בניית שורות הטבלה
        let jobRows = '';
        sortedJobs.forEach(job => {
            const statusIcon = job.IsCompleted ? '✓' : (job.IsRunning ? '●' : '-');
            const statusColor = job.IsCompleted ? '#4caf50' : (job.IsRunning ? '#ff9800' : '#999');
            const rowStyle = job.IsCompleted ? 'background-color: #e8f5e9;' : (job.IsRunning ? 'background-color: #fff8e1;' : '');

            jobRows += `
        <tr style="${rowStyle}">
            <td style="text-align:center"><span style="color:${statusColor};font-weight:bold">${statusIcon}</span></td>
            <td>${job.Order !== -1 ? job.Order : '-'}</td>
            <td>${job.JobName || ''}</td>
            <td>${job.Notes || '-'}</td>
            <td>${job.Responsible || '-'}</td>
            <td style="text-align:center">${job.ExecutionTime || '-'}</td>
            <td style="text-align:center">${job.HasAlarm && job.ExecutionTime ? '🔔' : (job.ExecutionTime ? '🔕' : '-')}</td>
            <td>${job.IsCompleted && job.CompletedBy ? `✓ ${job.CompletedBy}` :
                    (job.IsRunning && job.RunningBy ? `● ${job.RunningBy}` : '-')}</td>
        </tr>
        `;
        });

        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
</head>
<body dir="rtl" style="font-family:Arial; font-size:14px">
    <h2>📋 טבלת ביצוע: ${message.title}</h2>
    
    <div style="margin-bottom:15px">
        <strong>קטגוריה:</strong> ${message.category} | 
        <strong>מחבר:</strong> ${message.author} | 
        <strong>תאריך:</strong> ${this.formatDateForDisplay(message.date)}
        ${message.dueDate ? ` | <strong>תאריך יעד:</strong> ${this.formatDateForDisplay(message.dueDate)}` : ''}
    </div>
    
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%">
        <thead>
            <tr style="background:#f2f2f2">
                <th>סטטוס</th>
                <th>סדר</th>
                <th>שם ג'וב</th>
                <th>הערות</th>
                <th>אחראי</th>
                <th>שעת ביצוע</th>
                <th>התראה</th>
                <th>בוצע/בריצה ע"י</th>
            </tr>
        </thead>
        <tbody>
            ${jobRows}
        </tbody>
    </table>
    
    <div style="margin-top:15px">
        <p><strong>סטטוס:</strong> ${completed}/${total} משימות בוצעו (${percentage}%)</p>
        <p><strong>בריצה:</strong> ${running}/${total} משימות</p>
    </div>
    
    <hr/>
    <p style="color:gray">הופק בתאריך ${new Date().toLocaleDateString('he-IL')} בשעה ${new Date().toLocaleTimeString('he-IL')}</p>
</body>
</html>
`;
    }

    // שליחת טבלת ג'ובים במייל עם HTML מלא
    createJobsEmailWithEml(message) {
        try {
            // יצירת כותרת למייל
            const subject = `טבלת ביצוע: ${message.title}`;
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // בניית תוכן HTML למייל
            const htmlBody = this.buildJobsHtmlEmail(message);

            // פתיחת המייל ב-Outlook
            this.openEmailInOutlook(subject, htmlBody, recipient);
        } catch (error) {
            console.error('Error creating jobs email:', error);
            NotificationManager.show('שגיאה בפתיחת המייל', 'error');
        }
    }

    // שליחת טבלת ג'ובים במייל
    async sendJobsTableEmail(messageId) {
        try {
            // הצג אינדיקטור טעינה
            const overlay = document.getElementById('shiftsLoadingOverlay');
            if (overlay) overlay.classList.add('show');

            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || message.jobs.length === 0) {
                NotificationManager.show('אין משימות לשליחה במייל', 'error');
                if (overlay) overlay.classList.remove('show');
                return;
            }

            // שימוש בפתרון החדש - יצירת מייל HTML ופתיחתו ב-Outlook
            this.createJobsEmailWithEml(message);

            if (overlay) overlay.classList.remove('show');
        } catch (error) {
            console.error('Error sending jobs table email:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
            const overlay = document.getElementById('shiftsLoadingOverlay');
            if (overlay) overlay.classList.remove('show');
        }
    }

    // יצירת מייל עם צילום מסך של טבלת הג'ובים
    async createJobsEmailWithAttachment(message, imageBlob) {
        try {
            // יצירת כותרת למייל
            const subject = `טבלת ביצוע: ${message.title}`;

            // יצירת קישור להורדת התמונה
            const tempLink = document.createElement('a');
            tempLink.download = `טבלת_ביצוע_${message.title.replace(/\s+/g, '_')}.png`;
            tempLink.href = URL.createObjectURL(imageBlob);

            // יצירת תצוגה מקדימה של התמונה
            const imagePreview = document.createElement('img');
            imagePreview.src = tempLink.href;
            imagePreview.style.maxWidth = '100%';
            imagePreview.style.height = 'auto';
            imagePreview.style.borderRadius = '4px';
            imagePreview.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';

            // הצגת מודל עם אפשרויות שליחה
            this.showJobsEmailOptionsModal(subject, message, tempLink, imagePreview);

        } catch (error) {
            console.error('Error creating email with attachment:', error);
            NotificationManager.show('שגיאה בהכנת המייל', 'error');
        }
    }

    // הצגת מודל עם אפשרויות שליחת מייל
    showJobsEmailOptionsModal(subject, message, imageLink, imagePreview) {
        // יצירת מודל אם לא קיים
        if (!document.getElementById('jobsEmailOptionsModal')) {
            const modalHTML = `
        <div id="jobsEmailOptionsModal" class="modal-overlay">
            <div class="modal-content email-options-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-envelope"></i> שליחת טבלת ביצוע במייל</h3>
                    <button class="modal-close" onclick="messagesManager.closeJobsEmailOptionsModal()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="image-preview-container" id="jobsImagePreviewContainer"></div>
                    <p class="email-instructions" id="jobsEmailInstructions"></p>
                    <div class="email-options">
                        <button id="btnSendJobsMailto" class="btn-option">
                            <i class="fas fa-envelope"></i>
                            <span>שלח במייל</span>
                            <small>הורד את התמונה וצרף אותה למייל</small>
                        </button>
                        <button id="btnDownloadJobsImage" class="btn-option">
                            <i class="fas fa-download"></i>
                            <span>הורד תמונה</span>
                            <small>שמור את טבלת הביצוע כתמונה</small>
                        </button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-cancel" onclick="messagesManager.closeJobsEmailOptionsModal()">
                        <i class="fas fa-times"></i> סגור
                    </button>
                </div>
            </div>
        </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        // הצגת המודל
        const modal = document.getElementById('jobsEmailOptionsModal');
        modal.style.display = 'flex';

        // הוספת תצוגה מקדימה של התמונה
        const previewContainer = document.getElementById('jobsImagePreviewContainer');
        previewContainer.innerHTML = '';
        previewContainer.appendChild(imagePreview);

        // עדכון כותרת המשימה
        document.getElementById('jobsEmailInstructions').textContent = `טבלת ביצוע: ${message.title}`;

        // הגדרת פעולות לכפתורים
        const btnMailto = document.getElementById('btnSendJobsMailto');
        const btnDownload = document.getElementById('btnDownloadJobsImage');

        // הסרת מאזיני אירועים קודמים
        const newBtnMailto = btnMailto.cloneNode(true);
        const newBtnDownload = btnDownload.cloneNode(true);
        btnMailto.parentNode.replaceChild(newBtnMailto, btnMailto);
        btnDownload.parentNode.replaceChild(newBtnDownload, btnDownload);

        // הוספת מאזיני אירועים חדשים
        newBtnMailto.addEventListener('click', () => {
            // שימוש בתו RTL לתצוגה נכונה של עברית
            const rtl = '\u200F';

            // יצירת גוף המייל
            let body = '';
            body += `${rtl}טבלת ביצוע: ${message.title}\n\n`;
            body += `${rtl}(יש לצרף את צילום המסך מתוך הפופאפ המוצג)\n\n`;
            body += `${rtl}--------------------------------\n`;
            body += `${rtl}מייל זה נשלח ממערכת ניהול המשימות\n`;
            body += `${rtl}נשלח בתאריך: ${new Date().toLocaleDateString('he-IL')}\n`;

            // הגדרת נמען
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // קידוד עבור קישור mailto
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(body);

            // יצירת קישור mailto
            const mailtoLink = `mailto:${recipient}?subject=${encodedSubject}&body=${encodedBody}`;

            // פתיחת תוכנת המייל
            window.location.href = mailtoLink;

            // הצגת הודעה
            NotificationManager.show('פותח את תוכנת המייל...', 'info');
        });

        newBtnDownload.addEventListener('click', () => {
            // הורדת התמונה
            document.body.appendChild(imageLink);
            imageLink.click();
            document.body.removeChild(imageLink);

            // הצגת הודעה
            NotificationManager.show('התמונה הורדה בהצלחה', 'success');
        });
    }

    // סגירת מודל אפשרויות שליחת מייל
    closeJobsEmailOptionsModal() {
        const modal = document.getElementById('jobsEmailOptionsModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // יצירת מייל טקסטואלי לטבלת ג'ובים (גיבוי במקרה של שגיאה בצילום מסך)
    createJobsTextEmail(message) {
        try {
            // יצירת כותרת למייל
            const subject = `טבלת ביצוע: ${message.title}`;

            // שימוש בתו RTL לתצוגה נכונה של עברית
            const rtl = '\u200F';

            // יצירת גוף המייל
            let body = '';
            body += `${rtl}טבלת ביצוע: ${message.title}\n\n`;

            // הוספת מידע על המשימה
            body += `${rtl}קטגוריה: ${message.category}\n`;
            body += `${rtl}מחבר: ${message.author}\n`;
            if (message.dueDate) {
                body += `${rtl}תאריך יעד: ${this.formatDateForDisplay(message.dueDate)}\n`;
            }
            body += '\n';

            // מיון הג'ובים
            const sortedJobs = [...message.jobs].sort((a, b) => {
                if (a.Order === -1 && b.Order === -1) return 0;
                if (a.Order === -1) return -1;
                if (b.Order === -1) return 1;
                return a.Order - b.Order;
            });

            // הוספת מידע על הג'ובים
            body += `${rtl}רשימת משימות:\n`;
            body += `${rtl}--------------------------------\n`;

            sortedJobs.forEach((job, index) => {
                const status = job.IsCompleted ? '✓ בוצע' : (job.IsRunning ? '● בריצה' : '- לא התחיל');
                const order = job.Order !== -1 ? job.Order : '-';
                const executedBy = job.IsCompleted && job.CompletedBy ?
                    `בוצע ע"י: ${job.CompletedBy}` :
                    (job.IsRunning && job.RunningBy ? `בריצה ע"י: ${job.RunningBy}` : '');

                body += `${rtl}${index + 1}. ${job.JobName} (${status}, סדר: ${order})\n`;
                if (job.Notes) body += `${rtl}   הערות: ${job.Notes}\n`;
                if (job.Responsible) body += `${rtl}   אחראי: ${job.Responsible}\n`;
                if (job.ExecutionTime) body += `${rtl}   שעת ביצוע: ${job.ExecutionTime}\n`;
                if (executedBy) body += `${rtl}   ${executedBy}\n`;
                body += '\n';
            });

            // הוספת סטטיסטיקה
            const completed = sortedJobs.filter(j => j.IsCompleted).length;
            const running = sortedJobs.filter(j => j.IsRunning).length;
            const total = sortedJobs.length;
            const percentage = Math.round((completed / total) * 100);

            body += `${rtl}--------------------------------\n`;
            body += `${rtl}סטטוס: ${completed}/${total} משימות בוצעו (${percentage}%)\n`;
            body += `${rtl}בריצה: ${running}/${total} משימות\n\n`;

            // הוספת פוטר
            body += `${rtl}--------------------------------\n`;
            body += `${rtl}מייל זה נשלח ממערכת ניהול המשימות\n`;
            body += `${rtl}נשלח בתאריך: ${new Date().toLocaleDateString('he-IL')}\n`;

            // הגדרת נמען
            const recipient = "NOC@MENORAMIVT.CO.IL";

            // קידוד עבור קישור mailto
            const encodedSubject = encodeURIComponent(subject);
            const encodedBody = encodeURIComponent(body);

            // יצירת קישור mailto
            const mailtoLink = `mailto:${recipient}?subject=${encodedSubject}&body=${encodedBody}`;

            // פתיחת תוכנת המייל
            window.location.href = mailtoLink;

            // הצגת הודעה
            NotificationManager.show('פותח את תוכנת המייל...', 'info');
        } catch (error) {
            console.error('Error creating text email:', error);
            NotificationManager.show('שגיאה בפתיחת המייל', 'error');
        }
    }

    async saveAllJobChanges(messageId) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || message.jobs.length === 0) {
                NotificationManager.show('לא נמצאו משימות לשמירה', 'error');
                return;
            }

            // עדכן את כפתור השמירה למצב "שומר"
            const saveBtn = document.getElementById('saveAllChangesBtn');
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר שינויים...';
                saveBtn.classList.add('saving');
                saveBtn.disabled = true;
            }

            // הכן את הנתונים לשמירה
            const jobsData = message.jobs.map((job, index) => ({
                JobIndex: index,
                IsCompleted: job.IsCompleted,
                IsRunning: job.IsRunning,
                CompletedBy: job.CompletedBy,
                RunningBy: job.RunningBy,
                CompletedDate: job.CompletedDate,
                RunningDate: job.RunningDate
            }));

            const requestData = {
                MessageId: messageId,
                Jobs: jobsData
            };

            // שלח את כל הנתונים לשרת בקריאה אחת
            const response = await fetch('/Messages/UpdateAllJobStatuses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                // עדכן את כפתור השמירה למצב "הצלחה"
                if (saveBtn) {
                    saveBtn.innerHTML = '<i class="fas fa-check"></i> השינויים נשמרו';
                    saveBtn.classList.remove('saving');
                    saveBtn.classList.add('success');

                    // החזר את הכפתור למצב רגיל אחרי 2 שניות
                    setTimeout(() => {
                        saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
                        saveBtn.classList.remove('success');
                        saveBtn.disabled = false;
                    }, 2000);
                }

                // שמור את כל המשימות בלוקל סטורג'
                message.jobs.forEach((job, index) => {
                    this.saveJobStatusToLocalStorage(messageId, index, job);
                });

                // עדכן את התצוגה הנוכחית בלבד
                const messageCard = document.querySelector(`.notice-card[data-message-id="${messageId}"]`);
                if (messageCard) {
                    const updatedCard = this.createMessageCard(message);
                    messageCard.parentNode.replaceChild(updatedCard, messageCard);
                }
                message._hasUnsavedChanges = false;

                NotificationManager.show('כל השינויים נשמרו בהצלחה', 'success');
            } else {
                // עדכן את כפתור השמירה למצב "שגיאה"
                if (saveBtn) {
                    saveBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> שגיאה בשמירה';
                    saveBtn.classList.remove('saving');
                    saveBtn.classList.add('error');

                    // החזר את הכפתור למצב רגיל אחרי 2 שניות
                    setTimeout(() => {
                        saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
                        saveBtn.classList.remove('error');
                        saveBtn.disabled = false;
                    }, 2000);
                }

                NotificationManager.show(result.error || 'שגיאה בשמירת השינויים', 'error');
            }
        } catch (error) {
            console.error('Error saving all job changes:', error);

            // עדכן את כפתור השמירה למצב "שגיאה"
            const saveBtn = document.getElementById('saveAllChangesBtn');
            if (saveBtn) {
                saveBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i> שגיאה בשמירה';
                saveBtn.classList.remove('saving');
                saveBtn.classList.add('error');

                // החזר את הכפתור למצב רגיל אחרי 2 שניות
                setTimeout(() => {
                    saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
                    saveBtn.classList.remove('error');
                    saveBtn.disabled = false;
                }, 2000);
            }

            NotificationManager.show('שגיאה בשמירת השינויים', 'error');
        }
        this.updateSaveChangesButton(messageId);
    }

    saveJobStatusToLocalStorage(messageId, jobIndex, job) {
        try {
            // יצירת מפתח ייחודי למשימה
            const key = `job_status_${messageId}_${jobIndex}`;

            // שמירת נתוני המשימה
            const jobData = {
                messageId: messageId,
                jobIndex: jobIndex,
                jobName: job.JobName,
                isCompleted: job.IsCompleted,
                isRunning: job.IsRunning,
                completedBy: job.CompletedBy,
                runningBy: job.RunningBy,
                timestamp: new Date().toISOString()
            };

            localStorage.setItem(key, JSON.stringify(jobData));

            // שמור גם רשימה של כל המשימות שעודכנו
            let updatedJobs = JSON.parse(localStorage.getItem('updated_jobs') || '[]');
            if (!updatedJobs.includes(key)) {
                updatedJobs.push(key);
                localStorage.setItem('updated_jobs', JSON.stringify(updatedJobs));
            }

        } catch (error) {
            console.error('Error saving job status to localStorage:', error);
        }
    }

    updateSaveChangesButton(messageId) {
        const saveBtn = document.getElementById('saveAllChangesBtn');
        if (!saveBtn) return;

        const message = this.allMessages.find(m => m.id === messageId);
        if (!message) return;

        if (message._hasUnsavedChanges) {
            saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים <span class="unsaved-indicator">*</span>';
            saveBtn.disabled = false;
            saveBtn.style.display = "flex";
            saveBtn.classList.add('has-changes');
        } else {
            saveBtn.style.display = "none";
            saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
            saveBtn.classList.remove('has-changes');
        }
    }

    // טיפול בשינוי סטטוס משימה
    async handleStatusChange(messageId, jobIndex, status) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || !message.jobs[jobIndex]) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            // קבל את המשימה הנוכחית
            const job = message.jobs[jobIndex];

            // שמור את הסטטוס הקודם למקרה של ביטול
            job._previousStatus = {
                isCompleted: job.IsCompleted,
                isRunning: job.IsRunning,
                completedBy: job.CompletedBy,
                runningBy: job.RunningBy
            };

            // סמן שיש שינויים לא שמורים
            message._hasUnsavedChanges = true;

            switch (status) {
                case 'none':
                    // איפוס סטטוס
                    job.IsCompleted = false;
                    job.IsRunning = false;
                    job.CompletedBy = null;
                    job.RunningBy = null;

                    // עדכן את התצוגה
                    this.updatePopupJobsDisplay(messageId);
                    break;

                case 'running':
                    // הגדר כבריצה
                    if (!job.IsRunning) {
                        // אם המשימה מסומנת כבוצעה, יש לאפס קודם את סטטוס הביצוע
                        if (job.IsCompleted) {
                            job.IsCompleted = false;
                            job.CompletedBy = null;
                        }

                        // אם לא בריצה כבר, הצג דיאלוג בחירת עובד
                        this.showEmployeeSelectionModalForRunning(messageId, jobIndex);
                    }
                    break;

                case 'completed':
                    // הגדר כבוצע
                    if (!job.IsCompleted) {
                        // אם המשימה מסומנת כבריצה, יש לאפס קודם את סטטוס הריצה
                        if (job.IsRunning) {
                            job.IsRunning = false;
                            job.RunningBy = null;
                        }

                        // אם לא בוצע כבר, הצג דיאלוג בחירת עובד
                        this.showEmployeeSelectionModal(messageId, jobIndex, true);
                    }
                    break;
            }

            // עדכן את כפתור השמירה
            this.updateSaveChangesButton(messageId);
        } catch (error) {
            console.error('Error changing job status:', error);
            NotificationManager.show('שגיאה בעדכון סטטוס המשימה', 'error');
        }
    }

    // Handle running status toggle
    async toggleJobRunning(messageId, jobIndex, isRunning) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || !message.jobs[jobIndex]) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            // If marking as running, show employee selection dialog
            if (isRunning) {
                this.showEmployeeSelectionModalForRunning(messageId, jobIndex, isRunning);
            } else {
                // If unchecking, just update with null values
                await this.updateJobRunningStatus(messageId, jobIndex, isRunning, null);
            }
        } catch (error) {
            console.error('Error toggling job running status:', error);
            NotificationManager.show('שגיאה בעדכון סטטוס ריצה', 'error');
        }
    }

    // פונקציה להורדת טבלת ביצוע כ-PDF ישירות
    downloadJobsTableAsPdf(messageId) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || message.jobs.length === 0) {
                NotificationManager.show('אין משימות להורדה', 'error');
                return;
            }

            // מיון הג'ובים
            const sortedJobs = [...message.jobs].sort((a, b) => {
                if (a.Order === -1 && b.Order === -1) return 0;
                if (a.Order === -1) return -1;
                if (b.Order === -1) return 1;
                return a.Order - b.Order;
            });

            // יצירת תוכן HTML להדפסה
            let printContent = `
        <!DOCTYPE html>
        <html dir="rtl" lang="he">
        <head>
            <meta charset="UTF-8">
            <title>טבלת ביצוע - ${message.title}</title>
            <style>
                @page {
                    size: A4 landscape; /* שינוי לרוחב */
                    margin: 1cm;
                }
                body {
                    font-family: Arial, sans-serif;
                    direction: rtl;
                    padding: 0;
                    margin: 0;
                }
                h1 {
                    text-align: center;
                    margin-bottom: 10px;
                    font-size: 24px;
                    page-break-after: avoid; /* מונע חיתוך אחרי הכותרת */
                }
                h2 {
                    text-align: center;
                    margin-top: 0;
                    margin-bottom: 20px;
                    font-size: 18px;
                    color: #666;
                    page-break-after: avoid; /* מונע חיתוך אחרי הכותרת */
                }
                .print-header {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 20px;
                    border-bottom: 1px solid #ccc;
                    padding-bottom: 10px;
                    flex-wrap: wrap;
                    page-break-after: avoid; /* מונע חיתוך אחרי הכותרת */
                }
                .print-header-item {
                    font-size: 14px;
                    margin: 5px;
                }
                .print-header-label {
                    font-weight: bold;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                    page-break-inside: auto; /* מאפשר חיתוך של הטבלה */
                    font-size: 11px;
                }
                thead {
                    display: table-header-group; /* חוזר על הכותרות בכל עמוד */
                }
                tbody {
                    display: table-row-group;
                }
                tr {
                    page-break-inside: avoid; /* מונע חיתוך של שורה באמצע */
                    page-break-after: auto;
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 6px;
                    text-align: right;
                }
                th {
                    background-color: #f2f2f2;
                    font-weight: bold;
                }
                .completed-job {
                    background-color: #e8f5e9;
                }
                .completed-job td {
                    color: #666;
                }
                .running-job {
                    background-color: #fff8e1;
                }
                .running-job td {
                    color: #ff9800;
                }
                .status-icon {
                    display: inline-block;
                    text-align: center;
                    width: 20px;
                    height: 20px;
                }
                .status-icon.completed {
                    color: #4caf50;
                }
                .status-icon.running {
                    color: #ff9800;
                }
                .alarm-indicator {
                    display: inline-block;
                    text-align: center;
                }
                .alarm-indicator.active {
                    color: #ff9800;
                }
                .alarm-indicator.inactive {
                    color: #ccc;
                }
                .stats {
                    margin-top: 20px;
                    text-align: left;
                    font-weight: bold;
                    page-break-inside: avoid; /* מונע חיתוך של הסטטיסטיקה */
                }
                .print-footer {
                    margin-top: 30px;
                    text-align: center;
                    font-size: 12px;
                    color: #666;
                    border-top: 1px solid #ccc;
                    padding-top: 10px;
                    page-break-inside: avoid; /* מונע חיתוך של הפוטר */
                }
            </style>
        </head>
        <body>
            <h1>${message.title}</h1>
            <h2>טבלת ביצוע</h2>
            
            <div class="print-header">
                <div class="print-header-item">
                    <span class="print-header-label">קטגוריה:</span> ${message.category}
                </div>
                <div class="print-header-item">
                    <span class="print-header-label">מחבר:</span> ${message.author}
                </div>
                <div class="print-header-item">
                    <span class="print-header-label">תאריך:</span> ${this.formatDateForDisplay(message.date)}
                </div>
                ${message.dueDate ? `
                <div class="print-header-item">
                    <span class="print-header-label">תאריך יעד:</span> ${this.formatDateForDisplay(message.dueDate)}
                </div>` : ''}
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th style="width: 50px;">סטטוס</th>
                        <th style="width: 40px;">סדר</th>
                        <th style="width: 150px;">שם ג'וב</th>
                        <th style="width: 120px;">הערות</th>
                        <th style="width: 80px;">אחראי</th>
                        <th style="width: 60px;">שעת ביצוע</th>
                        <th style="width: 50px;">התראה</th>
                        <th style="width: 100px;">בוצע/בריצה ע"י</th>
                    </tr>
                </thead>
                <tbody>`;

            // הוספת שורות הטבלה
            sortedJobs.forEach(job => {
                const rowClass = job.IsCompleted ? 'completed-job' : (job.IsRunning ? 'running-job' : '');

                printContent += `
            <tr class="${rowClass}">
                <td style="text-align: center;">`;

                // עמודת סטטוס
                if (job.IsCompleted) {
                    printContent += '<span class="status-icon completed">✓</span>';
                } else if (job.IsRunning) {
                    printContent += '<span class="status-icon running">●</span>';
                } else {
                    printContent += '-';
                }

                printContent += `</td>
                <td style="text-align: center;">${job.Order !== -1 ? job.Order : '-'}</td>
                <td>${job.JobName || ''}</td>
                <td>${job.Notes || '-'}</td>
                <td>${job.Responsible || '-'}</td>`;

                // עמודת שעת ביצוע
                printContent += '<td style="text-align: center;">';
                if (job.ExecutionTime) {
                    printContent += `<span>🕐 ${job.ExecutionTime}</span>`;
                } else {
                    printContent += '-';
                }
                printContent += '</td>';

                // עמודת התראה
                printContent += '<td style="text-align: center;">';
                if (job.HasAlarm && job.ExecutionTime) {
                    printContent += '<span class="alarm-indicator active">🔔</span>';
                } else if (job.ExecutionTime) {
                    printContent += '<span class="alarm-indicator inactive">🔕</span>';
                } else {
                    printContent += '-';
                }
                printContent += '</td>';

                // עמודה מאוחדת למבצע
                printContent += '<td>';
                if (job.IsCompleted && job.CompletedBy) {
                    printContent += `✓ ${job.CompletedBy}`;
                } else if (job.IsRunning && job.RunningBy) {
                    printContent += `● ${job.RunningBy}`;
                } else {
                    printContent += '-';
                }

                printContent += `</td>
            </tr>`;
            });

            // סטטיסטיקה וסיום HTML
            const completed = sortedJobs.filter(j => j.IsCompleted).length;
            const running = sortedJobs.filter(j => j.IsRunning).length;
            const total = sortedJobs.length;
            const percentage = Math.round((completed / total) * 100);

            printContent += `
            </tbody>
            </table>
            
            <div class="stats">
                <div>סטטוס: ${completed}/${total} משימות בוצעו (${percentage}%)</div>
                <div>בריצה: ${running}/${total} משימות</div>
            </div>
            
            <div class="print-footer">
                הופק בתאריך ${new Date().toLocaleDateString('he-IL')} בשעה ${new Date().toLocaleTimeString('he-IL')}
            </div>
            
            <script>
                // הפעל הדפסה אוטומטית כשהדף נטען
                window.onload = function() {
                    window.print();
                    // סגור את החלון אחרי הדפסה (אופציונלי)
                    // window.onafterprint = function() { window.close(); };
                };
            </script>
        </body>
        </html>`;

            // יצירת iframe נסתר
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            // כתיבת התוכן ל-iframe
            const iframeDoc = iframe.contentWindow.document;
            iframeDoc.open();
            iframeDoc.write(printContent);
            iframeDoc.close();

            // הודעה למשתמש
            NotificationManager.show('מכין להדפסה...', 'info');

            // הסרת ה-iframe אחרי זמן קצר
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 2000);

        } catch (error) {
            console.error('Error generating PDF:', error);
            NotificationManager.show('שגיאה ביצירת PDF', 'error');
        }
    }

    // Toggle job completion status from popup view
    async toggleJobCompletion(messageId, jobIndex, isCompleted) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || !message.jobs[jobIndex]) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            // If marking as completed, show employee selection dialog
            if (isCompleted) {
                this.showEmployeeSelectionModal(messageId, jobIndex, isCompleted);
            } else {
                // If unchecking, just update with null values
                await this.updateJobCompletionStatus(messageId, jobIndex, isCompleted, null);
            }
        } catch (error) {
            console.error('Error toggling job completion:', error);
            NotificationManager.show('שגיאה בעדכון הסטטוס', 'error');
        }
    }

    // Show employee selection modal
    showEmployeeSelectionModal(messageId, jobIndex, isCompleted) {
        // קבלת ההודעה והמשימה
        const message = this.allMessages.find(m => m.id === messageId);
        if (!message || !message.jobs || !message.jobs[jobIndex]) {
            NotificationManager.show('משימה לא נמצאה', 'error');
            return;
        }

        const job = message.jobs[jobIndex];

        // הגדרת ערכי הטופס
        document.getElementById('completionMessageId').value = messageId;
        document.getElementById('completionJobIndex').value = jobIndex;
        document.getElementById('completionJobTitle').textContent = job.JobName || 'משימה';

        // מילוי רשימת העובדים
        this.loadEmployees().then(() => {
            const select = document.getElementById('completionActivityEmployeeName');
            select.innerHTML = '<option value="">בחר עובד...</option>';

            // הוספת אפשרויות עובדים
            this.employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.name;
                option.textContent = employee.name;
                select.appendChild(option);
            });

            // הגדרת עובד ברירת מחדל
            const lastEmployee = this.getLastSelectedAuthor();
            if (lastEmployee) {
                const optionExists = Array.from(select.options).some(
                    option => option.value === lastEmployee
                );

                if (optionExists) {
                    select.value = lastEmployee;
                }
            }

            // הוספת מאזין אירועים לכפתור השליחה
            const submitBtn = document.querySelector('#employeeSelectionForm button[type="submit"]');
            if (submitBtn) {
                // הסרת מאזינים קודמים למניעת כפילויות
                const newSubmitBtn = submitBtn.cloneNode(true);
                submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

                newSubmitBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    const employeeName = document.getElementById('completionActivityEmployeeName').value.trim();
                    if (employeeName) {
                        // שמירת העובד שנבחר
                        this.saveLastSelectedAuthor(employeeName);

                        // סגירת המודל
                        document.getElementById('employeeSelectionModal').style.display = 'none';

                        // עדכון סטטוס המשימה
                        await this.updateJobCompletionStatus(messageId, jobIndex, true, employeeName);
                    } else {
                        NotificationManager.show('נא לבחור עובד', 'warning');
                    }
                });
            }
        });

        // הצגת המודל
        document.getElementById('employeeSelectionModal').style.display = 'block';

        // סמן שיש שינויים לא שמורים
        const messageFind = this.allMessages.find(m => m.id === messageId);
        if (messageFind) {
            messageFind._hasUnsavedChanges = true;
            this.updateSaveChangesButton(messageId);
        }
    }

    // Close employee selection modal
    closeEmployeeSelectionModal() {
        const messageId = document.getElementById('completionMessageId').value;
        const jobIndex = document.getElementById('completionJobIndex').value;

        // אם זה מטופס עריכה ולא נבחר עובד, אל תשנה את הסטטוס
        if (messageId === 'edit-form') {
            // אל תשנה את הסטטוס, רק סגור את המודל
        } else if (messageId && jobIndex !== undefined && jobIndex !== '') {
            // שחזר את הסטטוס הקודם אם המשתמש ביטל
            const message = this.allMessages.find(m => m.id === messageId);
            if (message && message.jobs && message.jobs[jobIndex] && message.jobs[jobIndex]._previousStatus) {
                const job = message.jobs[jobIndex];
                const prev = job._previousStatus;

                // שחזר את הסטטוס הקודם
                job.IsCompleted = prev.isCompleted;
                job.IsRunning = prev.isRunning;
                job.CompletedBy = prev.completedBy;
                job.RunningBy = prev.runningBy;

                // עדכן את התצוגה
                this.updatePopupJobsDisplay(messageId);
            }
        }

        // סגור את המודל
        document.getElementById('employeeSelectionModal').style.display = 'none';
    }

    // New method to update job completion status
    async updateJobCompletionStatus(messageId, jobIndex, isCompleted, completedBy) {
        try {
            // Special case for edit form
            if (messageId === 'edit-form') {
                if (this._tempEditFormCheckbox && this._tempEditFormRow) {
                    if (completedBy) {
                        // Force the checkbox to be checked
                        setTimeout(() => {
                            this._tempEditFormCheckbox.checked = true;
                        }, 0);

                        // Update row data
                        this._tempEditFormRow.dataset.completedBy = completedBy;
                        this._tempEditFormRow.dataset.completedDate = new Date().toISOString();
                        this._tempEditFormRow.classList.add('completed-job-row');
                        this.saveLastSelectedAuthor(completedBy);

                        // Show notification
                        NotificationManager.show(`משימה סומנה כבוצעה ע"י ${completedBy}`, 'success');
                    } else {
                        // If no employee selected, uncheck
                        setTimeout(() => {
                            this._tempEditFormCheckbox.checked = false;
                        }, 0);

                        delete this._tempEditFormRow.dataset.completedBy;
                        delete this._tempEditFormRow.dataset.completedDate;
                        this._tempEditFormRow.classList.remove('completed-job-row');
                    }
                } else {
                    console.error('Temporary checkbox or row reference is missing');
                }
                return;
            } else {
                const message = this.allMessages.find(m => m.id === messageId);
                if (!message || !message.jobs || !message.jobs[jobIndex]) {
                    NotificationManager.show('משימה לא נמצאה', 'error');
                    return;
                }

                // עדכון נתונים מקומיים
                message.jobs[jobIndex].IsCompleted = isCompleted;

                if (isCompleted) {
                    message.jobs[jobIndex].CompletedBy = completedBy || this.getCurrentUser();
                    message.jobs[jobIndex].CompletedDate = new Date().toISOString();
                    // אם מסמנים כבוצע, וודא שלא מסומן גם כבריצה
                    message.jobs[jobIndex].IsRunning = false;
                    message.jobs[jobIndex].RunningBy = null;
                    message.jobs[jobIndex].RunningDate = null;
                } else {
                    message.jobs[jobIndex].CompletedBy = null;
                    message.jobs[jobIndex].CompletedDate = null;
                }

                // שליחה לשרת
                const response = await fetch('/Messages/UpdateJobCompletion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messageId: messageId,
                        jobIndex: jobIndex,
                        isCompleted: isCompleted,
                        completedBy: isCompleted ? message.jobs[jobIndex].CompletedBy : null,
                        completedDate: isCompleted ? message.jobs[jobIndex].CompletedDate : null
                    })
                });

                const result = await response.json();

                if (result.success) {
                    // עדכון תצוגת הפופאפ
                    this.updatePopupJobsDisplay(messageId);

                    // עדכון התצוגה הנוכחית בלבד
                    const messageCard = document.querySelector(`.notice-card[data-message-id="${messageId}"]`);
                    if (messageCard) {
                        // עדכון תצוגת הכרטיס
                        const updatedMessage = this.allMessages.find(m => m.id === messageId);
                        if (updatedMessage) {
                            const updatedCard = this.createMessageCard(updatedMessage);
                            messageCard.parentNode.replaceChild(updatedCard, messageCard);
                        }
                    }

                    NotificationManager.show(
                        isCompleted ? `משימה סומנה כבוצעה ע"י ${message.jobs[jobIndex].CompletedBy}` : 'סימון בוצע הוסר',
                        'success'
                    );
                } else {
                    // שחזור שינויים במקרה של שגיאה
                    if (message.jobs[jobIndex]._previousStatus) {
                        const prev = message.jobs[jobIndex]._previousStatus;
                        message.jobs[jobIndex].IsCompleted = prev.isCompleted;
                        message.jobs[jobIndex].CompletedBy = prev.completedBy;
                        message.jobs[jobIndex].IsRunning = prev.isRunning;
                        message.jobs[jobIndex].RunningBy = prev.runningBy;
                    } else {
                        message.jobs[jobIndex].IsCompleted = !isCompleted;
                        message.jobs[jobIndex].CompletedBy = null;
                        message.jobs[jobIndex].CompletedDate = null;
                    }

                    // עדכון התצוגה
                    this.updatePopupJobsDisplay(messageId);

                    NotificationManager.show(result.error || 'שגיאה בעדכון הסטטוס', 'error');
                }
            }
        } catch (error) {
            console.error('Error updating job completion:', error);
            NotificationManager.show('שגיאה בעדכון הסטטוס', 'error');
        }
    }

    // Get last selected employee from localStorage
    getCurrentUser() {
        return localStorage.getItem('lastSelectedEmployee') || '';
    }

    updatePopupJobsDisplay(messageId) {
        const message = this.allMessages.find(m => m.id === messageId);
        if (!message) return;

        // עדכון הסטטיסטיקה
        const completed = message.jobs.filter(j => j.IsCompleted).length;
        const running = message.jobs.filter(j => j.IsRunning).length;
        const total = message.jobs.length;
        const percentage = Math.round((completed / total) * 100);

        // Update completed stats
        const completedStatsElement = document.querySelector('.jobs-stats .stat-value');
        if (completedStatsElement) {
            completedStatsElement.textContent = `${completed}/${total} (${percentage}%)`;
        }

        // Update running stats
        const runningStatsElements = document.querySelectorAll('.jobs-stats .stat-item');
        if (runningStatsElements.length > 1) {
            const runningValueElement = runningStatsElements[1].querySelector('.stat-value');
            if (runningValueElement) {
                runningValueElement.textContent = `${running}/${total}`;
            }
        }

        // עדכון מראה השורות ותוכן התאים
        const rows = document.querySelectorAll('.jobs-full-table tbody tr');
        rows.forEach((row, index) => {
            if (index < message.jobs.length) {
                const job = message.jobs[index];

                // עדכון מחלקות CSS של השורה - קודם הסר את כל המחלקות
                row.classList.remove('completed-job', 'running-job');

                // הוסף את המחלקות המתאימות
                if (job.IsCompleted) {
                    row.classList.add('completed-job');
                } else if (job.IsRunning) {
                    row.classList.add('running-job');
                }

                // עדכון אפשרויות הסטטוס (status-selector)
                const statusOptions = row.querySelectorAll('.status-selector .status-option');
                if (statusOptions.length === 3) {
                    // הסר את המחלקה 'active' מכל האפשרויות
                    statusOptions.forEach(option => option.classList.remove('active'));

                    // הוסף את המחלקה 'active' לאפשרות המתאימה
                    if (job.IsCompleted) {
                        statusOptions[2].classList.add('active'); // אפשרות "בוצע"
                    } else if (job.IsRunning) {
                        statusOptions[1].classList.add('active'); // אפשרות "בריצה"
                    } else {
                        statusOptions[0].classList.add('active'); // אפשרות "לא התחיל"
                    }
                }

                // עדכון תא המבצע
                const cells = row.querySelectorAll('td');
                if (cells.length >= 8) {
                    const executorCell = cells[7];

                    if (job.IsCompleted && job.CompletedBy) {
                        executorCell.innerHTML = `<span class="completed-by" title="בוצע ע"י ${job.CompletedBy}">✓ ${job.CompletedBy}</span>`;
                    } else if (job.IsRunning && job.RunningBy) {
                        executorCell.innerHTML = `<span class="running-by" title="בריצה ע"י ${job.RunningBy}">● ${job.RunningBy}</span>`;
                    } else {
                        executorCell.textContent = '-';
                    }
                }
            }
        });

        // עדכן את כפתור השמירה
        this.updateSaveChangesButton(messageId);
    }

    createFullRequestContent(message) {
        let html = `<div class="request-content-full">`;
        html += `<p>${message.content}</p>`;

        if (message.attachedEmail) {
            html += '<div class="attached-file-section">';
            html += '<i class="fas fa-envelope"></i>';
            html += `<a href="#" onclick="messagesManager.downloadAttachment('${message.attachedEmail}'); return false;">`;
            html += '<i class="fas fa-download"></i>';
            html += 'הורד/פתח מייל מצורף';
            html += '</a>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    createFullReportContent(message) {
        let html = '<div class="report-content-full">';

        if (message.tableData && message.tableData.length > 0) {
            html += '<div class="csv-table-container">';
            html += '<table class="csv-table">';

            // כותרות - שורה ראשונה
            if (message.tableData[0]) {
                html += '<thead><tr>';
                message.tableData[0].forEach(header => {
                    html += `<th>${this.escapeHtml(header || '')}</th>`;
                });
                html += '</tr></thead>';
            }

            // נתונים
            html += '<tbody>';
            for (let i = 1; i < message.tableData.length; i++) {
                html += '<tr>';
                message.tableData[i].forEach(cell => {
                    html += `<td>${this.escapeHtml(cell || '')}</td>`;
                });
                html += '</tr>';
            }
            html += '</tbody>';

            html += '</table>';
            html += '</div>';

            // סטטיסטיקה
            html += '<div class="csv-stats">';
            html += `<div class="stat-item">`;
            html += `<i class="fas fa-table"></i>`;
            html += `<span class="stat-label">סה"כ שורות:</span>`;
            html += `<span class="stat-value">${message.tableData.length - 1}</span>`;
            html += `</div>`;
            html += '</div>';

            // כפתור הורדה
            if (message.csvFilePath) {
                html += '<div class="download-csv-section">';
                html += `<button class="btn-download-csv" onclick="messagesManager.downloadCsv('${message.id}')">`;
                html += '<i class="fas fa-download"></i> הורד קובץ CSV';
                html += '</button>';
                html += '</div>';
            }
        } else {
            html += '<div class="no-data-message">';
            html += '<i class="fas fa-table"></i>';
            html += '<p>אין נתונים להצגה</p>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    createFullUc4ReportContent(message) {
        let html = '<div class="report-content-full">';

        if (message.tableData && message.tableData.length > 0) {
            html += '<div class="csv-table-container">';
            html += '<table class="csv-table">';

            // כותרות - שורה ראשונה
            if (message.tableData[0]) {
                html += '<thead><tr>';
                message.tableData[0].forEach(header => {
                    html += `<th>${this.escapeHtml(header || '')}</th>`;
                });
                html += '</tr></thead>';
            }

            // נתונים
            html += '<tbody>';
            for (let i = 1; i < message.tableData.length; i++) {
                html += '<tr>';
                message.tableData[i].forEach(cell => {
                    html += `<td>${this.escapeHtml(cell || '')}</td>`;
                });
                html += '</tr>';
            }
            html += '</tbody>';

            html += '</table>';
            html += '</div>';

            // סטטיסטיקה
            html += '<div class="csv-stats">';
            html += `<div class="stat-item">`;
            html += `<i class="fas fa-table"></i>`;
            html += `<span class="stat-label">סה"כ שורות:</span>`;
            html += `<span class="stat-value">${message.tableData.length - 1}</span>`;
            html += `</div>`;
            html += '</div>';

            // כפתורי פעולה - הוספת כפתור שליחת מייל
            if (message.category === 'דוחות UC4') {
                html += `<div class="report-actions print-actions">
                <button class="btn-download-pdf btn-download-csv" onclick="messagesManager.downloadCsv('${message.id}')">
                    <i class="fas fa-download"></i> הורד קובץ CSV
                </button>
                <button class="btn-send-uc4-email btn-send-email" onclick="messagesManager.prepareUC4JobsEmail('${message.id}')">
                    <i class="fas fa-envelope"></i> הכן מייל דוחות UC4
                </button>
            </div>`;
            } else {
                // כפתור הורדה רגיל לקטגוריות אחרות
                html += '<div class="download-csv-section">';
                html += `<button class="btn-download-csv" onclick="messagesManager.downloadCsv('${message.id}')">`;
                html += '<i class="fas fa-download"></i> הורד קובץ CSV';
                html += '</button>';
                html += '</div>';
            }
        } else {
            html += '<div class="no-data-message">';
            html += '<i class="fas fa-table"></i>';
            html += '<p>אין נתונים להצגה</p>';
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // גישה פשוטה יותר לטיפול בהדבקת טבלאות
    setupTablePasteSupport() {
        // מצא את כל שדות הטקסט בסיכומי משמרת
        const textareaFields = [
            'incidentsInput',
            'openAlertsInput',
            'specialActionsInput',
            'generalInfoInput',
            'openItemsInput'
        ];

        textareaFields.forEach(fieldId => {
            const textarea = document.getElementById(fieldId);
            if (textarea) {
                textarea.addEventListener('paste', (e) => {
                    // Check if there's HTML content with a table
                    const htmlContent = e.clipboardData.getData('text/html');

                    if (htmlContent && (htmlContent.includes('<table') || htmlContent.includes('<tr') || htmlContent.includes('<td'))) {
                        e.preventDefault();

                        // Clean up the HTML to remove unnecessary Word metadata and styling
                        const cleanedHtml = this.sanitizeHtml(htmlContent);

                        // Get cursor position
                        const cursorPosition = textarea.selectionStart;
                        const textBefore = textarea.value.substring(0, cursorPosition);
                        const textAfter = textarea.value.substring(cursorPosition);

                        // Create a unique ID for this table
                        const tableId = `table_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

                        // Add placeholder text in the textarea
                        const tablePlaceholder = `[טבלה: ${tableId}]`;

                        // Determine if we need line breaks before/after based on surrounding content
                        const needsBreakBefore = textBefore.length > 0 && !textBefore.endsWith('\n');
                        const needsBreakAfter = textAfter.length > 0 && !textAfter.startsWith('\n');

                        const newText =
                            textBefore +
                            (needsBreakBefore ? '\n' : '') +
                            tablePlaceholder +
                            (needsBreakAfter ? '\n' : '') +
                            textAfter;

                        textarea.value = newText;

                        // Store the actual HTML in a data attribute
                        textarea.dataset[tableId] = cleanedHtml;

                        // Update cursor position
                        const newPosition = cursorPosition + tablePlaceholder.length + (needsBreakBefore ? 1 : 0);
                        textarea.selectionStart = newPosition;
                        textarea.selectionEnd = newPosition;

                        // Create or update table preview
                        this.updateTablePreview(textarea);

                        // Show success notification
                        NotificationManager.show('טבלה הוצמדה בהצלחה', 'success');
                    }
                });

                // Update preview when content changes
                textarea.addEventListener('input', () => {
                    this.updateTablePreview(textarea);
                });

                // Initial preview update
                this.updateTablePreview(textarea);
            }
        });
    }

    // Update table previews
    updateTablePreview(textarea) {
        // Check if we already have a preview container
        let previewContainer = document.getElementById(`${textarea.id}Preview`);

        // If not, create one
        if (!previewContainer) {
            previewContainer = document.createElement('div');
            previewContainer.id = `${textarea.id}Preview`;
            previewContainer.className = 'table-preview-container';
            previewContainer.style.display = 'none';

            // Insert after textarea
            textarea.parentNode.insertBefore(previewContainer, textarea.nextSibling);
        }

        // Clear existing previews
        previewContainer.innerHTML = '';

        // Check if there are table placeholders
        const tablePlaceholders = textarea.value.match(/\[טבלה: table_\d+_\d+\]/g);

        if (tablePlaceholders && tablePlaceholders.length > 0) {
            previewContainer.style.display = 'block';

            // Create header for previews
            const header = document.createElement('div');
            header.className = 'table-preview-header';
            header.innerHTML = '<i class="fas fa-table"></i> טבלאות מצורפות:';
            previewContainer.appendChild(header);

            // Add each table preview
            tablePlaceholders.forEach(placeholder => {
                const tableId = placeholder.match(/table_\d+_\d+/)[0];
                const tableHtml = textarea.dataset[tableId];

                if (tableHtml) {
                    const previewItem = document.createElement('div');
                    previewItem.className = 'table-preview-item';

                    // Add the actual table HTML
                    previewItem.innerHTML = tableHtml;

                    // Add a remove button
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'remove-table-btn';
                    removeBtn.innerHTML = '<i class="fas fa-times"></i> הסר טבלה';
                    removeBtn.onclick = () => {
                        // Remove the placeholder from textarea
                        textarea.value = textarea.value.replace(placeholder, '');

                        // Clean up extra line breaks
                        textarea.value = textarea.value.replace(/\n\n+/g, '\n\n');

                        // Remove the data attribute - חשוב!
                        delete textarea.dataset[tableId];

                        // Update preview
                        this.updateTablePreview(textarea);

                        // Show notification
                        NotificationManager.show('הטבלה הוסרה', 'info');
                    };

                    previewItem.appendChild(removeBtn);
                    previewContainer.appendChild(previewItem);
                }
            });
        } else {
            previewContainer.style.display = 'none';
            previewContainer.innerHTML = ''; // ניקוי התוכן
        }
    }

    // פונקציה לניקוי HTML מתגים מסוכנים אך שמירה על מבנה הטבלה
    sanitizeHtml(html) {
        // First, let's remove all the Word-specific metadata and styling
        let cleanedHtml = html
            // Remove Word XML declarations
            .replace(/<\?xml[^>]*>/gi, '')
            // Remove Word namespace declarations
            .replace(/<html[^>]*xmlns[^>]*>/gi, '<html>')
            // Remove Word metadata
            .replace(/<meta[^>]*>/gi, '')
            // Remove Word specific comments
            .replace(/<!--\[if[^>]*>[\s\S]*?<!\[endif\]-->/gi, '')
            // Remove Word specific styles
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            // Remove Word specific links
            .replace(/<link[^>]*>/gi, '')
            // Remove Word specific scripts
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            // Remove Word specific XML
            .replace(/<xml[^>]*>[\s\S]*?<\/xml>/gi, '')
            // Remove Word specific head content
            .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
            // Remove unnecessary body attributes
            .replace(/<body[^>]*>/gi, '<body>')
            // Remove StartFragment and EndFragment comments
            .replace(/<!--StartFragment-->/gi, '')
            .replace(/<!--EndFragment-->/gi, '')
            // Remove empty paragraphs
            .replace(/<p[^>]*>\s*<\/p>/gi, '')
            // Remove excessive line breaks and spaces
            .replace(/\n\s*\n/g, '\n')
            .replace(/\s{2,}/g, ' ')
            .trim();

        // Extract just the table content if it exists
        const tableMatch = cleanedHtml.match(/<table[\s\S]*?<\/table>/i);
        if (tableMatch) {
            cleanedHtml = tableMatch[0];
        }

        // Create a temporary div to parse the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cleanedHtml;

        // Remove any remaining scripts
        const scripts = tempDiv.querySelectorAll('script');
        scripts.forEach(script => script.remove());

        // Remove any on* attributes from all elements
        const allElements = tempDiv.querySelectorAll('*');
        allElements.forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('on')) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        // Clean up table styles to make it more compact
        const tables = tempDiv.querySelectorAll('table');
        tables.forEach(table => {
            // Add a class for styling
            table.classList.add('pasted-table');

            // Remove unnecessary attributes
            table.removeAttribute('width');
            table.removeAttribute('height');
            table.removeAttribute('border');
            table.removeAttribute('cellspacing');
            table.removeAttribute('cellpadding');

            // Process all cells
            const cells = table.querySelectorAll('td, th');
            cells.forEach(cell => {
                // Remove excessive padding
                cell.style.padding = '4px 8px';

                // Remove width/height constraints
                cell.removeAttribute('width');
                cell.removeAttribute('height');
            });
        });

        // המר את הטבלה לפורמט טקסט מעוצב
        return tempDiv.innerHTML;
    }

    // פונקציה להמרת טבלה ל-HTML לתצוגה בסיכומי משמרת
    convertTableToFormattedText(tableHtml) {
        // יצירת אלמנט זמני לפרסור ה-HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = tableHtml;

        const table = tempDiv.querySelector('table');
        if (!table) return tableHtml;

        let result = '';

        // עבור על כל השורות בטבלה
        const rows = table.querySelectorAll('tr');
        rows.forEach(row => {
            const cells = row.querySelectorAll('th, td');
            const rowContent = Array.from(cells).map(cell => cell.textContent.trim()).join(' | ');
            result += rowContent + '\n';

            // הוסף קו מפריד אחרי שורת כותרת
            if (row.querySelector('th')) {
                result += '-'.repeat(rowContent.length) + '\n';
            }
        });

        return result;
    }

    createFullShiftSummaryContent(message) {
        let html = '<div class="shift-summary-full">';

        if (message.incidents) {
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-exclamation-triangle"></i> תקלות במשמרת</h4>';
            html += `<div class="formatted-content">${this.formatContentWithTables(message.incidents)}</div>`;
            html += '</div>';
        }

        // Display alert items if they exist
        if (message.alertItems && Array.isArray(message.alertItems) && message.alertItems.length > 0) {
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-bell"></i> התראות</h4>';

            message.alertItems.forEach(item => {
                html += '<div class="alert-item-display">';
                html += `<div class="alert-text-display">${item.Text || ''}</div>`;

                if (item.ImagePath) {
                    const encodedPath = encodeURIComponent(item.ImagePath);
                    html += `<div class="alert-image-display">
                    <img src="/Messages/GetImageFile?filePath=${encodedPath}" alt="תמונת התראה" 
                         onclick="messagesManager.openImageInFullscreen('${encodedPath}', 'תמונת התראה')">
                    <div class="image-actions">
                        <button class="image-action-btn" onclick="messagesManager.downloadAttachment('${encodedPath}'); return false;" title="הורד תמונה">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="image-action-btn" onclick="messagesManager.openImageInFullscreen('${encodedPath}', 'תמונת התראה'); return false;" title="הגדל תמונה">
                            <i class="fas fa-search-plus"></i>
                        </button>
                    </div>
                </div>`;
                }

                html += '</div>';
            });

            html += '</div>';
        } else if (message.openAlerts) {
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-bell"></i> התראות פתוחות</h4>';
            html += `<div class="formatted-content">${this.formatContentWithTables(message.openAlerts)}</div>`;
            html += '</div>';
        }

        if (message.specialActions) {
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-tasks"></i> פעולות מיוחדות</h4>';
            html += `<div class="formatted-content">${this.formatContentWithTables(message.specialActions)}</div>`;
            html += '</div>';
        }

        if (message.generalInfo) {
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-info-circle"></i> מידע כללי</h4>';
            html += `<div class="formatted-content">${this.formatContentWithTables(message.generalInfo)}</div>`;
            html += '</div>';
        }

        if (message.openItems) {
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-clipboard-list"></i> דברים פתוחים ממשמרות קודמות</h4>';
            html += `<div class="formatted-content">${this.formatContentWithTables(message.openItems)}</div>`;
            html += '</div>';
        }

        // הוספת קבצים מצורפים
        if (message.attachments && message.attachments.length > 0) {
            html += '<div class="summary-section-full attachments-section">';
            html += '<h4><i class="fas fa-paperclip"></i> קבצים מצורפים</h4>';

            // חלוקה לתמונות וקבצים אחרים
            const images = [];
            const otherFiles = [];

            message.attachments.forEach(path => {
                const fileName = this.getFileDisplayName(path);
                const fileExt = fileName.split('.').pop().toLowerCase();

                if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(fileExt)) {
                    images.push({ path, fileName });
                } else {
                    otherFiles.push({ path, fileName, fileExt });
                }
            });

            // הצגת קבצים שאינם תמונות
            if (otherFiles.length > 0) {
                html += '<div class="attachments-list">';
                otherFiles.forEach(file => {
                    // קבע את סוג האייקון לפי סוג הקובץ
                    let iconClass = 'fa-file';
                    if (['pdf'].includes(file.fileExt)) {
                        iconClass = 'fa-file-pdf';
                    } else if (['doc', 'docx'].includes(file.fileExt)) {
                        iconClass = 'fa-file-word';
                    } else if (['xls', 'xlsx'].includes(file.fileExt)) {
                        iconClass = 'fa-file-excel';
                    }

                    const encodedPath = encodeURIComponent(file.path);
                    html += `
                <div class="attachment-item">
                    <i class="fas ${iconClass}"></i>
                    <a class="preview-filename" href="#" onclick="messagesManager.openAttachmentInModal('${encodedPath}', '${file.fileName}'); return false;">
                        ${file.fileName}
                    </a>
                </div>`;
                });
                html += '</div>';
            }

            // הצגת תמונות
            if (images.length > 0) {
                html += '<div class="images-gallery">';
                images.forEach(image => {
                    const encodedPath = encodeURIComponent(image.path);
                    html += `
                <div class="attachment-image-container">
                    <img src="/Messages/GetImageFile?filePath=${encodedPath}" alt="${image.fileName}" 
                         onclick="messagesManager.openImageInFullscreen('${encodedPath}', '${image.fileName}')">
                    <div class="image-actions">
                        <button class="image-action-btn" onclick="messagesManager.downloadAttachment('${encodedPath}'); return false;" title="הורד תמונה">
                            <i class="fas fa-download"></i>
                        </button>
                        <button class="image-action-btn" onclick="messagesManager.openImageInFullscreen('${encodedPath}', '${image.fileName}'); return false;" title="הגדל תמונה">
                            <i class="fas fa-search-plus"></i>
                        </button>
                    </div>
                    <div class="image-caption">${image.fileName}</div>
                </div>`;
                });
                html += '</div>';
            }

            html += '</div>';
        }

        // הוספת מיילים מצורפים
        if (message.attachedEmails && message.attachedEmails.length > 0) {
            const encodedPaths = encodeURIComponent(JSON.stringify(message.attachedEmails));
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-envelope"></i> מיילים מצורפים</h4>';
            html += `<div class="attached-file-section">
            <a href="#" onclick="messagesManager.downloadAttachment('${encodedPaths}'); return false;">
                <i class="fas fa-download"></i>
                הורד/פתח ${message.attachedEmails.length} מיילים מצורפים
            </a>
        </div>`;
            html += '</div>';
        } else if (message.attachedEmail) {
            const encodedPath = encodeURIComponent(message.attachedEmail);
            html += '<div class="summary-section-full">';
            html += '<h4><i class="fas fa-envelope"></i> מייל מצורף</h4>';
            html += `<div class="attached-file-section">
            <a href="#" onclick="messagesManager.downloadAttachment('${encodedPath}'); return false;">
                <i class="fas fa-download"></i>
                הורד/פתח מייל מצורף
            </a>
        </div>`;
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // הוסף סגנון CSS לטבלאות בסיכומי משמרת
    addTableStyles() {
        const style = document.createElement('style');
        style.textContent = `
        .formatted-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 8px 0;
            font-size: 0.95em;
        }
        
        .formatted-content th, .formatted-content td {
            border: 1px solid #ddd;
            padding: 6px;
            text-align: right;
        }
        
        .formatted-content th {
            background-color: #f2f2f2;
            font-weight: bold;
        }
        
        .formatted-content tr:nth-child(even) {
            background-color: #f9f9f9;
        }
        
        .formatted-content tr:hover {
            background-color: #f1f1f1;
        }
        
        .table-container {
            margin: 5px 0;
            overflow-x: auto;
        }
        
        .formatted-content p {
            margin: 5px 0;
        }

        .table-preview-container {
            margin-top: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 10px;
            background-color: #f9f9f9;
        }

        .table-preview-header {
            font-weight: bold;
            margin-bottom: 10px;
            color: #333;
        }

        .table-preview-item {
            margin-bottom: 15px;
            padding-bottom: 15px;
            border-bottom: 1px dashed #ccc;
        }

        .table-preview-item:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }

        .remove-table-btn {
            margin-top: 8px;
            padding: 4px 8px;
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }

        .remove-table-btn:hover {
            background-color: #f5c6cb;
        }
    `;
        document.head.appendChild(style);
    }

    // פונקציה חדשה לפורמט תוכן עם טבלאות
    formatContentWithTables(content) {
        if (!content) return '';

        // בדוק אם התוכן מכיל פלייסהולדרים של טבלאות
        const tablePlaceholders = content.match(/\[טבלה: table_\d+_\d+\]/g);

        if (tablePlaceholders && tablePlaceholders.length > 0) {
            // החלף כל פלייסהולדר בטבלה האמיתית
            let processedContent = content;

            // יצירת אלמנט זמני לאחסון הנתונים
            const tempElement = document.createElement('div');
            tempElement.innerHTML = content;

            tablePlaceholders.forEach(placeholder => {
                const tableId = placeholder.match(/table_\d+_\d+/)[0];

                // נסה למצוא את הטבלה בדאטה-אטריביוטים של אלמנטים בדף
                const textareas = document.querySelectorAll('textarea');
                let tableHtml = null;

                // חפש את הטבלה בכל ה-textareas
                for (const textarea of textareas) {
                    if (textarea.dataset[tableId]) {
                        tableHtml = textarea.dataset[tableId];
                        break;
                    }
                }

                // אם מצאנו את הטבלה, החלף את הפלייסהולדר
                if (tableHtml) {
                    processedContent = processedContent.replace(placeholder, tableHtml);
                }
            });

            return processedContent;
        }
        // בדוק אם התוכן מכיל HTML
        else if (content.includes('<table') || content.includes('<tr') || content.includes('<td')) {
            // אם כן, החזר את התוכן כ-HTML
            return content;
        } else {
            // אחרת, החזר את התוכן עם שמירה על שורות חדשות
            return content.replace(/\n/g, '<br>');
        }
    }

    // פונקציה מעודכנת לפתיחת תמונה במסך מלא
    openImageInFullscreen(imagePath, fileName) {
        const fullscreenViewer = document.createElement('div');
        fullscreenViewer.className = 'fullscreen-image-viewer';
        fullscreenViewer.innerHTML = `
        <div class="fullscreen-image-container">
            <div class="fullscreen-header">
                <span class="fullscreen-title">${fileName || 'תמונה'}</span>
                <div class="fullscreen-actions">
                    <button class="fullscreen-action-btn" onclick="messagesManager.downloadAttachment('${imagePath}'); return false;" title="הורד תמונה">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="fullscreen-action-btn close-fullscreen-btn" onclick="this.closest('.fullscreen-image-viewer').remove()" title="סגור">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            <div class="fullscreen-image-wrapper">
                <img src="/Messages/GetImageFile?filePath=${imagePath}" alt="${fileName || 'תמונה בגודל מלא'}">
            </div>
        </div>
    `;
        document.body.appendChild(fullscreenViewer);

        // הוסף מאזין אירועים לסגירה בלחיצה מחוץ לתמונה
        fullscreenViewer.addEventListener('click', function (e) {
            if (e.target === this) {
                this.remove();
            }
        });

        // הוסף מאזין אירועים לסגירה בלחיצה על Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                fullscreenViewer.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    // פונקציה להורדת/פתיחת קובץ מצורף
    async downloadAttachment(filePath) {
        try {
            // בדיקה אם מדובר במערך נתיבים (JSON)
            if (typeof filePath === 'string' &&
                (filePath.startsWith('[') || filePath.startsWith('%5B'))) {
                try {
                    // נסה לפענח את ה-JSON
                    let paths;
                    if (filePath.startsWith('%')) {
                        // אם זה מקודד URL, פענח אותו קודם
                        const decodedPath = decodeURIComponent(filePath);
                        paths = JSON.parse(decodedPath);
                    } else {
                        // אחרת פרסר ישירות
                        paths = JSON.parse(filePath);
                    }
                    return this.viewEmailInPopup(paths);
                } catch (e) {
                    console.error('Error parsing JSON paths:', e);
                }
            }

            // טיפול בנתיב בודד
            if (!filePath) {
                NotificationManager.show('נתיב קובץ לא תקין', 'error');
                return;
            }

            // בנה URL עם הנתיב המקורי
            const downloadUrl = `/Messages/DownloadFile?filePath=${encodeURIComponent(filePath)}`;

            // פתח בחלון חדש
            const newWindow = window.open(downloadUrl, '_blank');

            if (!newWindow) {
                NotificationManager.show('אנא אפשר חלונות קופצים בדפדפן', 'warning');
            } else {
                NotificationManager.show('פותח קובץ...', 'info');
            }

        } catch (error) {
            console.error('Error downloading attachment:', error);
            NotificationManager.show('שגיאה בפתיחת הקובץ', 'error');
        }
    }

    // הצגת מייל בפופאפ
    async viewEmailInPopup(filePaths) {
        try {
            // בדיקה אם מדובר במחרוזת מקודדת של מערך
            const isEncodedArray = typeof filePaths === 'string' &&
                (filePaths.startsWith('%5B') || filePaths.startsWith('['));

            // יצירת פופאפ עם loader
            const emailPopup = document.createElement('div');
            emailPopup.id = 'emailViewerPopup';
            emailPopup.className = 'email-viewer-popup';

            emailPopup.innerHTML = `
        <div class="email-viewer-content">
            <div class="email-viewer-header">
                <h3>צפייה במייל</h3>
                <button class="close-btn" onclick="document.getElementById('emailViewerPopup').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="email-viewer-body">
                <div id="emailLoadingIndicator" class="email-loading-indicator">
                    <div class="loader-spinner"></div>
                    <p>טוען את המיילים...</p>
                </div>
                <div id="emailsContentContainer" style="display:none;"></div>
            </div>
            <div class="email-viewer-footer">
                <button class="btn btn-secondary" onclick="document.getElementById('emailViewerPopup').remove()">סגור</button>
                <button class="btn btn-primary" onclick="messagesManager.downloadAllEmails('${encodeURIComponent(JSON.stringify(filePaths))}')">
                    <i class="fas fa-download"></i> הורד את כל המיילים
                </button>
            </div>
        </div>
        `;

            document.body.appendChild(emailPopup);

            // מיכל לתוכן המיילים
            const emailsContainer = document.getElementById('emailsContentContainer');
            const loadingIndicator = document.getElementById('emailLoadingIndicator');

            try {
                if (isEncodedArray) {
                    // אם זה מערך מקודד, השתמש בפונקציה החדשה
                    const encodedPaths = encodeURIComponent(filePaths);
                    const response = await fetch(`/Messages/ConvertMultipleEmailsToHtml?filePaths=${encodedPaths}`);

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const result = await response.json();

                    if (!result.success) {
                        throw new Error(result.error || 'שגיאה לא ידועה');
                    }

                    // הצג את כל המיילים
                    if (result.htmlContents && Array.isArray(result.htmlContents)) {
                        result.htmlContents.forEach((htmlContent, index) => {
                            const emailContainer = document.createElement('div');
                            emailContainer.className = 'email-content-wrapper';
                            emailContainer.innerHTML = `
                        <div class="email-header">
                            <h4>מייל ${index + 1} מתוך ${result.htmlContents.length}</h4>
                        </div>
                        <iframe class="email-content-frame" style="width:100%; height:400px; border:none;"></iframe>
                        `;

                            emailsContainer.appendChild(emailContainer);

                            // הזרקת תוכן ה-HTML לתוך ה-iframe
                            const iframe = emailContainer.querySelector('.email-content-frame');
                            const iframeDoc = iframe.contentWindow.document;
                            iframeDoc.open();
                            iframeDoc.write(htmlContent);
                            iframeDoc.close();
                        });
                    }
                } else {
                    // טיפול בנתיב בודד או מערך
                    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];

                    // טעינת כל המיילים
                    for (let i = 0; i < paths.length; i++) {
                        const path = paths[i];

                        // יצירת מיכל למייל הנוכחי
                        const emailContainer = document.createElement('div');
                        emailContainer.className = 'email-content-wrapper';
                        emailContainer.innerHTML = `
                    <div class="email-header">
                        <h4>מייל ${i + 1} מתוך ${paths.length}</h4>
                    </div>
                    <iframe class="email-content-frame" style="width:100%; height:400px; border:none;"></iframe>
                    `;

                        emailsContainer.appendChild(emailContainer);

                        // טעינת תוכן המייל
                        try {
                            const encodedPath = encodeURIComponent(path);

                            const response = await fetch(`/Messages/ConvertEmailToHtml?filePath=${encodedPath}`);

                            if (!response.ok) {
                                emailContainer.innerHTML = `
                            <div class="email-error">
                                <i class="fas fa-exclamation-circle"></i>
                                <p>שגיאה בטעינת המייל. נסה להוריד את הקובץ המקורי.</p>
                                <p>קוד שגיאה: ${response.status}</p>
                            </div>
                            `;
                                continue;
                            }

                            const result = await response.json();

                            if (!result.success) {
                                emailContainer.innerHTML = `
                            <div class="email-error">
                                <i class="fas fa-exclamation-circle"></i>
                                <p>שגיאה בטעינת המייל: ${result.error || 'שגיאה לא ידועה'}</p>
                            </div>
                            `;
                                continue;
                            }

                            // הזרקת תוכן ה-HTML לתוך ה-iframe
                            const iframe = emailContainer.querySelector('.email-content-frame');
                            const iframeDoc = iframe.contentWindow.document;
                            iframeDoc.open();
                            iframeDoc.write(result.htmlContent);
                            iframeDoc.close();
                        } catch (error) {
                            emailContainer.innerHTML = `
                        <div class="email-error">
                            <i class="fas fa-exclamation-circle"></i>
                            <p>שגיאה בטעינת המייל: ${error.message || 'שגיאה לא ידועה'}</p>
                        </div>
                        `;
                        }
                    }
                }

                // הסתר את ה-loader והצג את התוכן
                loadingIndicator.style.display = 'none';
                emailsContainer.style.display = 'block';

                return true;
            } catch (error) {
                console.error("Error in viewEmailInPopup:", error); // לוג לדיבוג

                // הצג שגיאה במקרה של כישלון
                emailsContainer.innerHTML = `
            <div class="email-error">
                <i class="fas fa-exclamation-circle"></i>
                <p>שגיאה בטעינת המיילים: ${error.message || 'שגיאה לא ידועה'}</p>
                <button class="btn btn-primary" onclick="messagesManager.downloadAllEmails('${encodeURIComponent(JSON.stringify(filePaths))}')">
                    <i class="fas fa-download"></i> נסה להוריד את המיילים במקום
                </button>
            </div>
            `;

                loadingIndicator.style.display = 'none';
                emailsContainer.style.display = 'block';

                return true;
            }
        } catch (error) {
            console.error('Error viewing emails in popup:', error);
            return false;
        }
    }

    // פונקציה חדשה להורדת כל המיילים
    downloadAllEmails(encodedPathsJson) {
        try {
            let paths = [];

            // בדיקה אם זו מחרוזת או מערך
            if (typeof encodedPathsJson === 'string') {
                try {
                    // נסה לפענח את המחרוזת
                    const decodedJson = decodeURIComponent(encodedPathsJson);
                    // נסה לפרסר כ-JSON
                    paths = JSON.parse(decodedJson);
                } catch (e) {
                    console.error("Error parsing JSON:", e); // לוג לדיבוג

                    // אם הפרסור נכשל, נסה לטפל בנתיב בודד
                    paths = [encodedPathsJson];
                }
            } else if (Array.isArray(encodedPathsJson)) {
                // אם זה כבר מערך, השתמש בו ישירות
                paths = encodedPathsJson;
            } else {
                // אם זה לא מחרוזת ולא מערך, טפל בו כנתיב בודד
                paths = [String(encodedPathsJson)];
            }

            // הורדת כל המיילים בזה אחר זה
            paths.forEach((path, index) => {
                setTimeout(() => {
                    // שימוש בנתיב המקורי ללא פענוח נוסף
                    const downloadUrl = `/Messages/DownloadFile?filePath=${encodeURIComponent(path)}`;

                    window.open(downloadUrl, '_blank');
                }, index * 500); // השהייה קצרה בין הורדות
            });

            NotificationManager.show(`מוריד ${paths.length} קבצי מייל...`, 'info');
        } catch (error) {
            console.error('Error downloading all emails:', error);
            NotificationManager.show('שגיאה בהורדת המיילים', 'error');
        }
    }

    // פונקציה להורדת המייל המקורי
    downloadOriginalEmail(filePath) {
        const normalizedPath = filePath.replace(/\\/g, '/');
        const encodedPath = encodeURIComponent(normalizedPath);
        const downloadUrl = `/Messages/DownloadFile?filePath=${encodedPath}`;

        window.open(downloadUrl, '_blank');
        NotificationManager.show('מוריד את קובץ המייל המקורי...', 'info');
    }

    async downloadCsv(messageId) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.csvFilePath) {
                NotificationManager.show('קובץ לא נמצא', 'error');
                return;
            }

            window.location.href = `/Messages/DownloadFile?filePath=${encodeURIComponent(message.csvFilePath)}`;
        } catch (error) {
            console.error('Error downloading CSV:', error);
            NotificationManager.show('שגיאה בהורדת הקובץ', 'error');
        }
    }

    closeMessagePopup() {
        // בדוק אם יש שינויים לא שמורים ושמור אותם
        const messageId = document.getElementById('popupTitle').getAttribute('data-message-id');
        if (messageId) {
            const message = this.allMessages.find(m => m.id === messageId);
            if (message && message._hasUnsavedChanges) {
                this.saveAllJobChanges(messageId);
            }
        }

        this.isModalOpen = false;
        document.getElementById('messagePopup').style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // Bookmark functionality
    isMessageBookmarked(messageId) {
        return this.bookmarkedMessages.includes(messageId);
    }

    toggleBookmark(messageId, buttonElement) {
        const isCurrentlyBookmarked = this.isMessageBookmarked(messageId);

        if (isCurrentlyBookmarked) {
            this.bookmarkedMessages = this.bookmarkedMessages.filter(id => id !== messageId);
            buttonElement.classList.remove('bookmarked');
            NotificationManager.show('הודעה הוסרה מהמועדפים', 'success');
        } else {
            this.bookmarkedMessages.push(messageId);
            buttonElement.classList.add('bookmarked');
            NotificationManager.show('הודעה נוספה למועדפים', 'success');
        }

        localStorage.setItem('bookmarkedMessages', JSON.stringify(this.bookmarkedMessages));

        const currentFilter = document.querySelector('.notices-category-filter-tab.active').textContent.trim();
        this.filterMessages(currentFilter);
    }

    // Initialize the search date picker
    initializeSearchDatePicker() {
        this.searchDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#searchDateInput",
            (selectedDates, dateStr) => {
                this.handleSearchDateChange(dateStr);
            }
        );
    }

    // Handle search date changes
    handleSearchDateChange(dateStr) {
        if (dateStr) {
            // Format and display the date in the same input
            const formattedDate = FlatpickrHelper.formatDateToDisplay(dateStr);
            this.currentSearchDate = dateStr;
            document.getElementById('searchDateInput').value = formattedDate;
            document.getElementById('clearSearchDate').style.display = 'flex';
            // Reset pagination when date changes
            this.resetPagination();
            this.applyFiltersAndSearch();
        } else {
            document.getElementById('clearSearchDate').style.display = 'none';
        }
    }

    // Clear search date
    clearSearchDate() {
        if (this.searchDatePicker) {
            this.searchDatePicker.clear();
        }
        this.currentSearchDate = '';
        document.getElementById('searchDateInput').value = '';
        this.applyFiltersAndSearch();
    }

    // Handle search input
    handleSearchInput(event) {
        this.currentSearchText = event.target.value.trim().toLowerCase();
        // Reset pagination when search changes
        this.resetPagination();
        this.applyFiltersAndSearch();
    }

    // Apply filters and search
    applyFiltersAndSearch(preservePagination = false) {
        const currentFilter = document.querySelector('.notices-category-filter-tab.active').textContent.trim();

        // Reset pagination only if not explicitly preserving it
        if (!preservePagination) {
            this.resetPagination();
        }

        this.filterMessages();
        this.updateActiveFiltersDisplay();
    }

    filterMessages() {
        let filteredMessages = this.allMessages;

        // First apply time filter
        filteredMessages = this.applyTimeFilter(filteredMessages);

        // Then apply category filter
        filteredMessages = this.applyCategoryFilter(filteredMessages);

        // Then apply text search if there's search text
        if (this.currentSearchText) {
            const searchTerm = this.currentSearchText.toLowerCase().trim();

            filteredMessages = filteredMessages.filter(message =>
                // חיפוש בשדות הבסיסיים
                (message.title && message.title.toLowerCase().includes(searchTerm)) ||
                (message.content && message.content.toLowerCase().includes(searchTerm)) ||
                (message.author && message.author.toLowerCase().includes(searchTerm)) ||
                (message.category && message.category.toLowerCase().includes(searchTerm)) ||

                // חיפוש בשמות ג'ובים ושדות אחרים במשימות
                (message.jobs && Array.isArray(message.jobs) && message.jobs.some(job =>
                    (job.JobName && job.JobName.toLowerCase().includes(searchTerm)) ||
                    (job.Notes && job.Notes.toLowerCase().includes(searchTerm)) ||
                    (job.Responsible && job.Responsible.toLowerCase().includes(searchTerm)) ||
                    (job.CompletedBy && job.CompletedBy && job.CompletedBy.toLowerCase().includes(searchTerm)) ||
                    (job.RunningBy && job.RunningBy && job.RunningBy.toLowerCase().includes(searchTerm))
                )) ||

                // חיפוש בתוכן טבלאות
                (message.tableData && Array.isArray(message.tableData) && message.tableData.some(row =>
                    Array.isArray(row) && row.some(cell =>
                        cell && cell.toString().toLowerCase().includes(searchTerm)
                    )
                )) ||

                // חיפוש בשדות של סיכומי משמרת
                (message.category === 'סיכומי משמרת' && (
                    (message.incidents && message.incidents.toLowerCase().includes(searchTerm)) ||
                    (message.openAlerts && message.openAlerts.toLowerCase().includes(searchTerm)) ||
                    (message.specialActions && message.specialActions.toLowerCase().includes(searchTerm)) ||
                    (message.generalInfo && message.generalInfo.toLowerCase().includes(searchTerm)) ||
                    (message.openItems && message.openItems.toLowerCase().includes(searchTerm))
                ))
            );
        }

        // Then apply date search if there's a search date
        if (this.currentSearchDate && (this.currentTimeFilter === 'all' || this.currentTimeFilter === 'history' || this.currentTimeFilter === 'future')) {
            filteredMessages = filteredMessages.filter(message => {
                if (message.dueDate) {
                    let dueDate;

                    if (message.dueDate.includes('/')) {
                        const [day, month, year] = message.dueDate.split('/');
                        dueDate = new Date(year, month - 1, day);
                    } else {
                        dueDate = new Date(message.dueDate + 'T00:00:00');
                    }

                    if (!isNaN(dueDate.getTime())) {
                        const searchDate = new Date(this.currentSearchDate);
                        return dueDate.getDate() === searchDate.getDate() &&
                            dueDate.getMonth() === searchDate.getMonth() &&
                            dueDate.getFullYear() === searchDate.getFullYear();
                    }
                }
                return false;
            });
        }

        this.displayMessages(filteredMessages);
    }

    // Apply time filter
    applyTimeFilter(messages) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinutes = now.getMinutes();
        const isBeforeSevenThirty = currentHour < 7 || (currentHour === 7 && currentMinutes < 30);

        // Create a date object for today at 00:00
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Create a date object for yesterday at 00:00
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        switch (this.currentTimeFilter) {
            case 'today':
                // Show messages without due date OR with today's due date (only after 7:30 AM) OR with yesterday's due date if before 7:30 AM
                return messages.filter(message => {
                    if (!message.dueDate) return true;

                    let dueDate = this.parseDueDate(message.dueDate);
                    if (!dueDate) return true;

                    dueDate.setHours(0, 0, 0, 0);

                    // If it's today's due date, show only after 7:30 AM
                    if (dueDate.getTime() === today.getTime()) {
                        return !isBeforeSevenThirty; // Show today's tasks only after 7:30 AM
                    }

                    // If it's yesterday's due date, show only before 7:30 AM
                    if (dueDate.getTime() === yesterday.getTime()) {
                        return isBeforeSevenThirty; // Show yesterday's tasks only before 7:30 AM
                    }

                    return false;
                });

            case 'future':
                // Show only messages with future due dates
                return messages.filter(message => {
                    if (!message.dueDate) return false;

                    let dueDate = this.parseDueDate(message.dueDate);
                    if (!dueDate) return false;

                    dueDate.setHours(0, 0, 0, 0);
                    return dueDate > today;
                });

            case 'history':
                // Show only messages with past due dates
                // For yesterday's tasks, if before 7:30 AM, don't show in history yet
                return messages.filter(message => {
                    if (!message.dueDate) return false;

                    let dueDate = this.parseDueDate(message.dueDate);
                    if (!dueDate) return false;

                    dueDate.setHours(0, 0, 0, 0);

                    // If it's yesterday's due date AND current time is before 7:30 AM, don't show in history
                    if (dueDate.getTime() === yesterday.getTime() && isBeforeSevenThirty) return false;

                    return dueDate < today;
                });

            case 'all':
            default:
                // Show all messages
                return messages;
        }
    }

    // Apply category filter
    applyCategoryFilter(messages) {
        if (this.currentCategoryFilter === 'all') {
            return messages;
        }

        if (this.currentCategoryFilter === 'favorites') {
            return messages.filter(message => this.isMessageBookmarked(message.id));
        }

        // Filter by specific category
        return messages.filter(message => message.category === this.currentCategoryFilter);
    }

    // Helper function to parse due date
    parseDueDate(dueDateString) {
        if (!dueDateString) return null;

        let dueDate;

        if (dueDateString.includes('/')) {
            const [day, month, year] = dueDateString.split('/');
            dueDate = new Date(year, month - 1, day);
        } else {
            dueDate = new Date(dueDateString + 'T00:00:00');
        }

        return isNaN(dueDate.getTime()) ? null : dueDate;
    }

    // Handle filter tab clicks
    setupFilterTabs() {
        const filterTabs = document.querySelectorAll('.notices-category-filter-tab');
        filterTabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Remove active class from all tabs
                filterTabs.forEach(t => t.classList.remove('active'));

                // Add active class to clicked tab
                e.currentTarget.classList.add('active');

                // Apply filter with current search text and date
                const filterType = e.currentTarget.textContent.trim();

                // Show/hide date search based on category
                this.updateDateSearchVisibility(filterType);

                // Apply filters
                this.filterMessages(filterType);
            });
        });
    }

    // Update date search visibility based on time filter
    updateDateSearchVisibility() {
        const dateSearchBox = document.querySelector('.date-search-box');
        if (dateSearchBox) {
            // Show date search only for history or future or all
            if (this.currentTimeFilter === 'all' || this.currentTimeFilter === 'history' || this.currentTimeFilter === 'future') {
                dateSearchBox.style.display = 'flex';
            } else {
                dateSearchBox.style.display = 'none';
                // Clear date search when switching away
                if (this.currentSearchDate) {
                    this.clearSearchDate();
                }
            }
        }
    }

    // Update active filters display
    updateActiveFiltersDisplay() {
        const display = document.getElementById('messagesActiveFiltersDisplay');
        if (!display) return;

        const filterTags = [];

        // Category filter
        if (this.currentCategoryFilter !== 'all') {
            const categoryLabels = {
                'favorites': 'מועדפים',
                'רשימות': 'רשימות',
                'דוחות UC4': 'דוחות UC4',
                'סיכומי משמרת': 'סיכומי משמרת',
                'בקשות': 'בקשות',
                'בקשות וביצוע': 'בקשות וביצוע',
                'אישורי כניסה': 'אישורי כניסה',
                'כללי': 'כללי',
                'דחוף': 'דחוף'
            };
            filterTags.push(`
            <div class="filter-tag" onclick="messagesManager.removeFilter('category')" title="לחץ להסרה">
                <i class="fas fa-filter"></i> קטגוריה: ${categoryLabels[this.currentCategoryFilter]}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        // Time filter
        if (this.currentTimeFilter !== 'today') {
            const timeLabels = {
                'future': 'תצוגה: עתידי',
                'history': 'תצוגה: היסטוריה',
                'all': 'תצוגה: הכל'
            };
            filterTags.push(`
            <div class="filter-tag" onclick="messagesManager.removeFilter('time')" title="לחץ להסרה">
                <i class="fas fa-filter"></i> ${timeLabels[this.currentTimeFilter]}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        // Search text filter
        if (this.currentSearchText) {
            filterTags.push(`
            <div class="filter-tag" onclick="messagesManager.removeFilter('search')" title="לחץ להסרה">
                <i class="fas fa-search"></i> חיפוש: "${this.currentSearchText}"
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        // Search date filter
        if (this.currentSearchDate) {
            const formattedDate = this.formatDateForDisplay(this.currentSearchDate);
            filterTags.push(`
            <div class="filter-tag" onclick="messagesManager.removeFilter('searchDate')" title="לחץ להסרה">
                <i class="fas fa-calendar"></i> תאריך: ${formattedDate}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        if (filterTags.length > 0) {
            display.innerHTML = `<div class="active-filters-tags">${filterTags.join('')}</div>`;
            display.style.display = 'block';
        } else {
            display.style.display = 'none';
        }

        this.updateClearFiltersButton();
    }

    updateClearFiltersButton() {
        const clearBtn = document.querySelector('.messages-section .clear-filters-btn');
        if (clearBtn) {
            if (this.currentCategoryFilter !== 'all' ||
                this.currentTimeFilter !== 'today' ||
                this.currentSearchText ||
                this.currentSearchDate) {
                clearBtn.style.display = 'inline-flex';
            } else {
                clearBtn.style.display = 'none';
            }
        }
    }

    // Remove specific filter
    removeFilter(filterType) {
        if (filterType === 'category') {
            this.handleCategoryFilterClick('all');
        } else if (filterType === 'time') {
            this.handleTimeFilterClick('today');
        } else if (filterType === 'search') {
            this.clearSearchText();
            this.applyFiltersAndSearch();
        } else if (filterType === 'searchDate') {
            this.clearSearchDate();
        }

        NotificationManager.show('הסינון הוסר', 'info');
    }

    // Clear all filters
    clearAllFilters() {
        this.handleCategoryFilterClick('all');
        this.handleTimeFilterClick('today');
        this.clearSearchText();
        this.clearSearchDate();
        NotificationManager.show('הסינונים נוקו', 'info');
    }

    // Helper methods
    getPriorityClass(priority) {
        switch (priority) {
            case 'דחוף': return 'urgent priority-high';
            case 'חשוב': return 'info';
            default: return '';
        }
    }

    getTimeAgo(dateString) {
        const messageDate = new Date(dateString);
        const now = new Date();
        const diffInHours = Math.floor((now - messageDate) / (1000 * 60 * 60));

        if (diffInHours < 1) return 'לפני פחות משעה';
        if (diffInHours < 24) return `לפני ${diffInHours} שעות`;

        const diffInDays = Math.floor(diffInHours / 24);
        if (diffInDays === 1) return 'אתמול';
        if (diffInDays < 7) return `לפני ${diffInDays} ימים`;

        return messageDate.toLocaleDateString('he-IL');
    }

    truncateText(text, maxLength) {
        if (!text) return ''; // הגנה מפני null/undefined
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    }

    sortMessagesByBookmark(messages) {
        return messages.sort((a, b) => {
            const aBookmarked = this.isMessageBookmarked(a.id);
            const bBookmarked = this.isMessageBookmarked(b.id);

            if (aBookmarked && !bBookmarked) return -1;
            if (!aBookmarked && bBookmarked) return 1;

            return new Date(b.date) - new Date(a.date);
        });
    }

    // Drag and drop functionality
    handleDragStart(event) {
        this.draggedElement = event.currentTarget;
        this.draggedMessageId = event.currentTarget.getAttribute('data-message-id');
        event.currentTarget.style.opacity = '0.5';
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', event.currentTarget.outerHTML);
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        const messageCard = event.currentTarget;
        if (messageCard !== this.draggedElement && messageCard.hasAttribute('data-message-id')) {
            messageCard.classList.add('drag-over');
        }
    }

    handleDragLeave(event) {
        event.currentTarget.classList.remove('drag-over');
    }


    handleDrop(event) {
        event.preventDefault();
        const dropTarget = event.currentTarget;
        const dropMessageId = dropTarget.getAttribute('data-message-id');

        if (!dropMessageId || this.draggedMessageId === dropMessageId) {
            dropTarget.classList.remove('drag-over');
            return;
        }

        const draggedIndex = this.allMessages.findIndex(m => m.id === this.draggedMessageId);
        const dropIndex = this.allMessages.findIndex(m => m.id === dropMessageId);

        if (draggedIndex !== -1 && dropIndex !== -1) {
            // Reorder messages array
            const draggedMessage = this.allMessages[draggedIndex];
            this.allMessages.splice(draggedIndex, 1);
            this.allMessages.splice(dropIndex, 0, draggedMessage);

            // Save new order and refresh display
            this.saveMessageOrder();

            // Don't call displayMessages here, wait for save to complete
            NotificationManager.show('סדר ההודעות עודכן', 'success');
        }

        dropTarget.classList.remove('drag-over');
    }

    handleDragEnd(event) {
        event.currentTarget.style.opacity = '1';

        document.querySelectorAll('.notice-card').forEach(card => {
            card.classList.remove('drag-over');
        });

        this.draggedElement = null;
        this.draggedMessageId = null;
    }

    // Save message order
    async saveMessageOrder() {
        try {
            const messageOrder = this.allMessages.map((message, index) => ({
                id: message.id,
                order: index
            }));

            const response = await fetch('/Messages/UpdateMessageOrder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messageOrder: messageOrder
                })
            });

            const result = await response.json();

            if (result.success) {
                // Reload messages to get the updated order from server
                await this.loadMessages();
            } else {
                console.error('Failed to save message order:', result.error);
                // Reload messages if save failed
                this.loadMessages();
            }
        } catch (error) {
            console.error('Error saving message order:', error);
            // Reload messages if save failed
            this.loadMessages();
        }
    }

    initializeDatePickers() {
        this.dueDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#messageDueDateHidden",
            (selectedDates, dateStr) => {
                this.handleDueDateChange(dateStr);
            }
        );
    }

    openDueDatePicker() {
        if (this.dueDatePicker) {
            this.dueDatePicker.open();
        }
    }

    formatDateForDisplay(dateString) {
        if (!dateString) return '';

        try {
            // Check if dateString is already in DD/MM/YYYY format
            if (dateString.includes('/') && dateString.split('/').length === 3) {
                return dateString;
            }

            // Parse the date - handle both YYYY-MM-DD format and ISO strings
            const date = new Date(dateString);

            if (isNaN(date.getTime())) {
                console.error('Invalid date:', dateString);
                return '';
            }

            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        } catch (error) {
            console.error('Error formatting date:', error, dateString);
            return dateString; // Return the original string if parsing fails
        }
    }

    formatDateForServer(displayDate) {
        if (!displayDate) return null;
        const [day, month, year] = displayDate.split('/');
        return `${year}-${month}-${day}`;
    }

    handleDueDateChange(value) {
        if (value) {
            const formattedDate = FlatpickrHelper.formatDateToDisplay(value);
            document.getElementById('messageDueDate').value = formattedDate;
            document.getElementById('messageDueDateClear').style.display = 'inline-block';
        } else {
            document.getElementById('messageDueDate').value = '';
            document.getElementById('messageDueDateClear').style.display = 'none';
        }
    }

    // פונקציה להתחלת מעקב אחרי התראות
    startAlarmMonitoring() {
        // בדוק כל דקה
        this.alarmCheckInterval = setInterval(() => {
            this.checkPendingAlarms();
        }, 60000); // 60 שניות

        // בדיקה ראשונית מיידית
        this.checkPendingAlarms();
    }

    // פונקציה לבדיקת התראות ממתינות
    async checkPendingAlarms() {
        try {
            const response = await fetch('/Messages/GetPendingAlarms');
            const result = await response.json();

            if (result.success && result.alarms && result.alarms.length > 0) {
                // *** מיון ההתראות לפי שעת ביצוע - מהמוקדמת למאוחרת ***
                const sortedAlarms = result.alarms.sort((a, b) => {
                    // המר את השעות ל-TimeSpan להשוואה
                    const timeA = a.executionTime.split(':');
                    const timeB = b.executionTime.split(':');

                    const minutesA = parseInt(timeA[0]) * 60 + parseInt(timeA[1]);
                    const minutesB = parseInt(timeB[0]) * 60 + parseInt(timeB[1]);

                    return minutesB - minutesA; // מיון עולה (מוקדם לפני מאוחר)
                });

                // הצג את ההתראות לפי הסדר הממוין
                sortedAlarms.forEach(alarm => {
                    const alarmKey = `${alarm.messageId}_${alarm.jobIndex}`;

                    // הצג התראה רק אם לא הוצגה כבר
                    if (!this.shownAlarms.has(alarmKey)) {
                        this.showAlarmNotification(alarm);
                        this.shownAlarms.add(alarmKey);

                        // הסר מהרשימה אחרי 10 דקות
                        setTimeout(() => {
                            this.shownAlarms.delete(alarmKey);
                        }, 600000); // 10 דקות
                    }
                });
            }
        } catch (error) {
            console.error('Error checking pending alarms:', error);
        }
    }

    // פונקציה להצגת התראה
    showAlarmNotification(alarm) {
        // יצירת פופאפ התראה
        const alarmPopup = document.createElement('div');
        alarmPopup.className = 'alarm-notification-popup';
        alarmPopup.innerHTML = `
        <div class="alarm-notification-content">
                <button class="alarm-close-btn" onclick="this.closest('.alarm-notification-popup').remove()">
                    <i class="fas fa-times"></i>
                </button>
            <div class="alarm-notification-header">
                <h3> <i class="fas fa-bell alarm-bell-icon"></i> הגיע הזמן!⏰ </h3>
            </div>
            <div class="alarm-notification-body">
                <div class="alarm-message-title">
                    <i class="fas fa-file-alt"></i>
                    <strong>${alarm.messageTitle}</strong>
                </div>
                <div class="alarm-job-name">
                    <i class="fas fa-tasks"></i>
                    ${alarm.jobName}
                </div>
                <div class="alarm-execution-time">
                    <i class="fas fa-clock"></i>
                    שעת ביצוע: <strong>${alarm.executionTime}</strong>
                </div>
                ${alarm.responsible ? `
                <div class="alarm-responsible">
                    <i class="fas fa-user"></i>
                    אחראי: ${alarm.responsible}
                </div>
                ` : ''}
            </div>
            <div class="alarm-notification-footer">
                <button class="btn btn-primary" onclick="messagesManager.openMessageFromAlarm('${alarm.messageId}'); this.closest('.alarm-notification-popup').remove();">
                    <i class="fas fa-eye"></i> פתח הודעה
                </button>
                <button class="btn btn-secondary" onclick="messagesManager.snoozeAlarm('${alarm.messageId}', ${alarm.jobIndex}); this.closest('.alarm-notification-popup').remove();">
                    <i class="fas fa-clock"></i> דחה ל-5 דקות
                </button>
                <button class="btn btn btn-secondary btn-success" onclick="messagesManager.markJobAsRunningFromAlarm('${alarm.messageId}', ${alarm.jobIndex}); this.closest('.alarm-notification-popup').remove();">
                    <i class="fas fa-play"></i> התחל ביצוע
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(alarmPopup);

        // הפעל אנימציה
        setTimeout(() => {
            alarmPopup.classList.add('show');
        }, 10);

        // הסר אוטומטית אחרי 2 דקות אם לא נסגר
        setTimeout(() => {
            if (alarmPopup.parentNode) {
                alarmPopup.classList.remove('show');
                setTimeout(() => alarmPopup.remove(), 300);
            }
        }, 120000); // 2 דקות
    }

    // פונקציה לפתיחת הודעה מהתראה
    openMessageFromAlarm(messageId) {
        this.openMessagePopup(messageId);
        NotificationManager.show('הודעה נפתחה', 'info');
    }

    // פונקציה לדחיית התראה
    snoozeAlarm(messageId, jobIndex) {
        const alarmKey = `${messageId}_${jobIndex}`;
        this.shownAlarms.delete(alarmKey);

        // הגדר התראה חדשה ל-5 דקות
        setTimeout(() => {
            this.checkPendingAlarms();
        }, 300000); // 5 דקות

        NotificationManager.show('ההתראה נדחתה ל-5 דקות', 'info');
    }

    // פונקציה לסימון משימה כבריצה מההתראה
    async markJobAsRunningFromAlarm(messageId, jobIndex) {
        try {
            const message = this.allMessages.find(m => m.id === messageId);
            if (!message || !message.jobs || !message.jobs[jobIndex]) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            // הצג דיאלוג בחירת עובד
            this.showEmployeeSelectionModalForRunning(messageId, jobIndex);
        } catch (error) {
            console.error('Error marking job as running from alarm:', error);
            NotificationManager.show('שגיאה בסימון המשימה', 'error');
        }
    }

    // פונקציה לטעינת מיילים מאחורי הקלעים
    async preloadEmailCache() {
        try {
            // קריאה לשרת לטעינת מיילים למטמון
            fetch('/Messages/PreloadEmailCache')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // console.log(`Email cache preloading: ${data.message}`);
                    } else {
                        console.error('Error preloading email cache:', data.error);
                    }
                })
                .catch(error => {
                    console.error('Error calling preload email cache:', error);
                });
        } catch (error) {
            console.error('Error in preloadEmailCache:', error);
        }
    }


    // Apply pagination to messages
    applyPagination(messages) {
        // Calculate total pages
        this.totalPages = Math.ceil(messages.length / this.itemsPerPage);

        // Ensure current page is valid
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages || 1;
        }

        // Get messages for current page
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        this.paginatedMessages = messages.slice(startIndex, endIndex);

        return this.paginatedMessages;
    }

    // Create pagination controls
    createPaginationControls(totalItems) {
        // Check if pagination container exists, if not create it
        let paginationContainer = document.querySelector('.pagination-container');
        if (!paginationContainer) {
            paginationContainer = document.createElement('div');
            paginationContainer.className = 'pagination-container';

            // Add pagination container after notices grid
            const noticesGrid = document.querySelector('.notices-grid');
            if (noticesGrid && noticesGrid.parentNode) {
                noticesGrid.parentNode.insertBefore(paginationContainer, noticesGrid.nextSibling);
            }
        }

        // Clear existing pagination controls
        paginationContainer.innerHTML = '';

        // If there's only one page or no items, don't show pagination
        if (this.totalPages <= 1 || totalItems === 0) {
            paginationContainer.style.display = 'none';
            return;
        }

        // Show pagination container
        paginationContainer.style.display = 'flex';

        // Create pagination info
        const paginationInfo = document.createElement('div');
        paginationInfo.className = 'pagination-info';
        paginationInfo.textContent = `עמוד ${this.currentPage} מתוך ${this.totalPages} (${totalItems} פריטים)`;

        // Create pagination controls
        const paginationControls = document.createElement('div');
        paginationControls.className = 'pagination-controls';

        // Previous button
        const prevBtn = document.createElement('button');
        prevBtn.className = 'pagination-btn';
        prevBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
        prevBtn.disabled = this.currentPage === 1;
        prevBtn.addEventListener('click', () => this.changePage(this.currentPage - 1));

        // Next button
        const nextBtn = document.createElement('button');
        nextBtn.className = 'pagination-btn';
        nextBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
        nextBtn.disabled = this.currentPage === this.totalPages;
        nextBtn.addEventListener('click', () => this.changePage(this.currentPage + 1));

        // Page numbers
        const paginationNumbers = document.createElement('div');
        paginationNumbers.className = 'pagination-numbers';

        // Determine which page numbers to show
        let startPage = Math.max(1, this.currentPage - 2);
        let endPage = Math.min(this.totalPages, startPage + 4);

        // Adjust if we're near the end
        if (endPage - startPage < 4 && startPage > 1) {
            startPage = Math.max(1, endPage - 4);
        }

        // First page button if not showing page 1
        if (startPage > 1) {
            const firstPageBtn = document.createElement('button');
            firstPageBtn.className = 'page-number';
            firstPageBtn.textContent = '1';
            firstPageBtn.addEventListener('click', () => this.changePage(1));
            paginationNumbers.appendChild(firstPageBtn);

            // Add ellipsis if needed
            if (startPage > 2) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'pagination-ellipsis';
                ellipsis.textContent = '...';
                paginationNumbers.appendChild(ellipsis);
            }
        }

        // Page number buttons
        for (let i = startPage; i <= endPage; i++) {
            const pageBtn = document.createElement('button');
            pageBtn.className = 'page-number';
            if (i === this.currentPage) {
                pageBtn.classList.add('active');
            }
            pageBtn.textContent = i;
            pageBtn.addEventListener('click', () => this.changePage(i));
            paginationNumbers.appendChild(pageBtn);
        }

        // Last page button if not showing the last page
        if (endPage < this.totalPages) {
            // Add ellipsis if needed
            if (endPage < this.totalPages - 1) {
                const ellipsis = document.createElement('span');
                ellipsis.className = 'pagination-ellipsis';
                ellipsis.textContent = '...';
                paginationNumbers.appendChild(ellipsis);
            }

            const lastPageBtn = document.createElement('button');
            lastPageBtn.className = 'page-number';
            lastPageBtn.textContent = this.totalPages;
            lastPageBtn.addEventListener('click', () => this.changePage(this.totalPages));
            paginationNumbers.appendChild(lastPageBtn);
        }

        // Assemble pagination controls
        paginationControls.appendChild(prevBtn);
        paginationControls.appendChild(paginationNumbers);
        paginationControls.appendChild(nextBtn);

        // Add to container
        paginationContainer.appendChild(paginationInfo);
        paginationContainer.appendChild(paginationControls);
    }

    // Change page
    changePage(pageNumber) {
        if (pageNumber < 1 || pageNumber > this.totalPages) {
            return;
        }

        this.currentPage = pageNumber;

        // Re-apply filters and search with new page, but preserve pagination
        this.applyFiltersAndSearch(true);

        // Scroll to top of notices grid
        const noticesGrid = document.querySelector('.notices-grid');
        if (noticesGrid) {
            noticesGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // Reset pagination to first page
    resetPagination() {
        this.currentPage = 1;
    }

    // Auto refresh data
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            if (!this.isModalOpen) {
                // שמור את הפילטרים הנוכחיים
                const currentSearchText = this.currentSearchText;
                const currentSearchDate = this.currentSearchDate;
                const currentTimeFilter = this.currentTimeFilter;
                const currentCategoryFilter = this.currentCategoryFilter;

                // טען מחדש את ההודעות
                await this.loadMessages();

                // החזר את הפילטרים
                this.currentSearchText = currentSearchText;
                this.currentSearchDate = currentSearchDate;
                this.currentTimeFilter = currentTimeFilter;
                this.currentCategoryFilter = currentCategoryFilter;

                // החל מחדש את הפילטרים
                this.applyFiltersAndSearch(true);
                // התחל מעקב אחרי התראות אם עדיין לא התחיל
                if (!this.alarmCheckInterval) {
                    this.startAlarmMonitoring();
                }
                this.preloadEmailCache();
            }
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    clearDueDate() {
        document.getElementById('messageDueDate').value = '';
        document.getElementById('messageDueDateHidden').value = '';
        document.getElementById('messageDueDateClear').style.display = 'none';
        this.updateTimeClearButton();
    }

    initializeFilterCollapse() {
        // Load saved state from localStorage
        const isCollapsed = localStorage.getItem('messagesFiltersSectionCollapsed');

        // Default to collapsed if no saved state (null) or if explicitly set to 'true'
        if (isCollapsed === null || isCollapsed === 'true') {
            const content = document.getElementById('filterTabsContent');
            const btn = document.getElementById('filterCollapseBtn');

            if (content) content.classList.add('collapsed');
            if (btn) btn.classList.add('collapsed');
        }
    }

    // ========== אישורי כניסה ==========
    createEntryPermitContent(message) {
        const data = message.entryPermitData || {};
        let html = '<div class="entry-permit-preview">';

        // אתר - תמיכה במערך
        const siteDisplay = data.sites && data.sites.length > 1
            ? data.sites.join(' ו')
            : (data.site || '');

        if (siteDisplay) {
            html += `<div class="permit-field">
            <i class="fas fa-map-marker-alt"></i>
            <span>אתר: <strong>${siteDisplay}</strong></span>
        </div>`;
        }

        if (data.date) {
            html += `<div class="permit-field">
            <i class="fas fa-calendar"></i>
            <span>תאריך: <strong>${data.date}</strong></span>
        </div>`;
        }

        // שמות - תמיכה במערך
        if (data.names && data.names.length > 0) {
            if (data.names.length === 1) {
                html += `<div class="permit-field">
                <i class="fas fa-user"></i>
                <span>שם: <strong>${data.names[0]}</strong></span>
            </div>`;
            } else {
                html += `<div class="permit-field">
                <i class="fas fa-users"></i>
                <span>אנשים: <strong>${data.names.length}</strong>
                    <small>(${data.names[0]} ואחרים)</small>
                </span>
            </div>`;
            }
        } else if (data.fullName) {
            html += `<div class="permit-field">
            <i class="fas fa-user"></i>
            <span>שם: <strong>${data.fullName}</strong></span>
        </div>`;
        }

        if (data.company) {
            html += `<div class="permit-field">
            <i class="fas fa-building"></i>
            <span>חברה: <strong>${data.company}</strong></span>
        </div>`;
        }

        // רכבים - תמיכה במערך
        if (data.carNumbers && data.carNumbers.length > 0) {
            if (data.carNumbers.length === 1) {
                html += `<div class="permit-field">
                <i class="fas fa-car"></i>
                <span>רכב: <strong>${data.carNumbers[0]}</strong></span>
            </div>`;
            } else {
                html += `<div class="permit-field">
                <i class="fas fa-car"></i>
                <span>רכבים: <strong>${data.carNumbers.join(', ')}</strong></span>
            </div>`;
            }
        } else if (data.carNumber) {
            html += `<div class="permit-field">
            <i class="fas fa-car"></i>
            <span>רכב: <strong>${data.carNumber}</strong></span>
        </div>`;
        }

        // ת"ז - רק אם קיים
        if (data.idNumber) {
            html += `<div class="permit-field">
            <i class="fas fa-id-card"></i>
            <span>ת.ז.: <strong>${data.idNumber}</strong></span>
        </div>`;
        }

        // מלווה - רק אם קיים
        if (data.escort) {
            html += `<div class="permit-field">
            <i class="fas fa-user-friends"></i>
            <span>מלווה: <strong>${data.escort}</strong></span>
        </div>`;
        }

        if (data.time) {
            html += `<div class="permit-field">
            <i class="fas fa-clock"></i>
            <span>שעה: <strong>${data.time}</strong></span>
        </div>`;
        }

        html += `<span class="read-more-btn" 
        onclick="messagesManager.openEntryPermitModal(
            messagesManager.allMessages.find(m => m.id === '${message.id}')
        )">
        ערוך אישור
    </span>`;

        html += '</div>';
        return html;
    }

    clearPermitTime() {
        document.getElementById('permitTimeHour').value = '';
        document.getElementById('permitTimeMinute').value = '';
        document.getElementById('permitTimeClearBtn').style.display = 'none';
    }

    _initPermitTimeSelects() {
        const hourSelect = document.getElementById('permitTimeHour');
        const minuteSelect = document.getElementById('permitTimeMinute');
        const clearBtn = document.getElementById('permitTimeClearBtn');

        if (!hourSelect || !minuteSelect) return;

        // מלא שעות רק אם ריק
        if (hourSelect.options.length <= 1) {
            for (let i = 0; i < 24; i++) {
                const option = document.createElement('option');
                option.value = i.toString().padStart(2, '0');
                option.textContent = i.toString().padStart(2, '0');
                hourSelect.appendChild(option);
            }
        }

        // מלא דקות רק אם ריק
        if (minuteSelect.options.length <= 1) {
            for (let i = 0; i < 60; i += 5) {
                const option = document.createElement('option');
                option.value = i.toString().padStart(2, '0');
                option.textContent = i.toString().padStart(2, '0');
                minuteSelect.appendChild(option);
            }
        }

        // מאזינים להצגת כפתור ניקוי
        const updateClearBtn = () => {
            if (clearBtn) {
                clearBtn.style.display =
                    (hourSelect.value || minuteSelect.value) ? 'inline-block' : 'none';
            }
        };

        // הסר מאזינים ישנים והוסף חדשים
        const newHourSelect = hourSelect.cloneNode(true);
        const newMinuteSelect = minuteSelect.cloneNode(true);
        hourSelect.parentNode.replaceChild(newHourSelect, hourSelect);
        minuteSelect.parentNode.replaceChild(newMinuteSelect, minuteSelect);

        newHourSelect.addEventListener('change', updateClearBtn);
        newMinuteSelect.addEventListener('change', updateClearBtn);
    }

    _populatePermitAuthorSelect() {
        const select = document.getElementById('permitAuthor');
        if (!select) return;

        // שמור ערך נוכחי אם יש
        const currentValue = select.value;

        // נקה אפשרויות קיימות
        select.innerHTML = '<option value="">בחר מחבר...</option>';

        // הוסף עובדים
        if (this.employees && this.employees.length > 0) {
            this.employees.forEach(employee => {
                const option = document.createElement('option');
                option.value = employee.name;
                option.textContent = employee.name;
                select.appendChild(option);
            });
        }

        // הוסף אפשרות "אחר"
        const otherOption = document.createElement('option');
        otherOption.value = 'other';
        otherOption.textContent = 'אחר...';
        select.appendChild(otherOption);

        // הגדר ברירת מחדל - העובד האחרון שנבחר
        const lastAuthor = this.getLastSelectedAuthor();
        if (lastAuthor) {
            const optionExists = Array.from(select.options)
                .some(opt => opt.value === lastAuthor);
            if (optionExists) {
                select.value = lastAuthor;
            }
        }

        // אם הרשימה ריקה, טען עובדים
        if (!this.employees || this.employees.length === 0) {
            this.loadEmployees().then(() => {
                this._populatePermitAuthorSelect();
            });
        }
    }

    openEntryPermitModal(existingMessage = null, isDuplicate = false) {
        const isEditing = existingMessage !== null && !isDuplicate;

        let modal = document.getElementById('entryPermitModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'entryPermitModal';
            modal.className = 'modal-overlay';

            modal.innerHTML = `
            <div class="modal-content entry-permit-modal">
                <div class="modal-header">
                    <h3 id="entryPermitModalTitle">
                        <i class="fas fa-id-badge"></i> אישור כניסה
                    </h3>
                    <button class="close-btn" id="entryPermitCloseBtn">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="entryPermitForm" novalidate>
                        <div class="form-group">
                            <label class="form-label required-field">
                                <i class="fas fa-map-marker-alt"></i> אתר
                                <span class="optional-label">(ניתן לבחור יותר מאחד)</span>
                            </label>
                            <div class="site-selector">
                                <label class="site-option">
                                    <input type="checkbox" name="permitSite" value='ר"ג' id="siteRG">
                                    <span class="site-btn">ר"ג</span>
                                </label>
                                <label class="site-option">
                                    <input type="checkbox" name="permitSite" value='פ"ת' id="sitePT">
                                    <span class="site-btn">פ"ת</span>
                                </label>
                            </div>
                            <div class="field-error" id="siteError" style="display:none;">
                                <i class="fas fa-exclamation-circle"></i> יש לבחור לפחות אתר אחד
                            </div>
                        </div>

                        <!-- תאריך -->
                        <div class="form-group">
                            <label class="form-label required-field" for="permitDate">
                                <i class="fas fa-calendar"></i> תאריך
                            </label>
                            <div class="date-input-wrapper">
                                <input type="text" id="permitDate" class="form-input" 
                                    placeholder="בחר תאריך" readonly>
                                <input type="hidden" id="permitDateHidden">
                            </div>
                            <div class="field-error" id="dateError" style="display:none;">
                                <i class="fas fa-exclamation-circle"></i> יש לבחור תאריך
                            </div>
                        </div>


                        <div class="form-group">
                            <label class="form-label required-field">
                                <i class="fas fa-users"></i> אנשים
                                <span class="optional-label">(ניתן להוסיף מספר אנשים)</span>
                            </label>
                            <div class="person-columns-header">
                                <span class="person-col-label col-name">שם מלא *</span>
                                <span class="person-col-label col-car">מס' רכב</span>
                                <span class="person-col-label col-id">ת.ז.</span>
                                <span class="person-col-label col-phone">טלפון</span>
                            </div>

                            <div id="permitNamesContainer">
                                ${this._buildNameRowHtml(0)}
                            </div>

                            <button type="button" class="add-entry-btn" 
                                    onclick="messagesManager._addPersonRow()">
                                <i class="fas fa-plus"></i> הוסף אדם
                            </button>

                            <div class="field-error" id="nameError" style="display:none;">
                                <i class="fas fa-exclamation-circle"></i> יש להזין לפחות שם אחד
                            </div>
                            <div class="field-error" id="carError" style="display:none;">
                                <i class="fas fa-exclamation-circle"></i> יש להזין מספר רכב תקין לכל אדם
                            </div>
                        </div > 

                        <!-- חברה -->
                        <div class="form-group">
                            <label class="form-label required-field" for="permitCompany">
                                <i class="fas fa-building"></i> חברה
                            </label>
                            <input type="text" id="permitCompany" class="form-input" 
                                placeholder="שם החברה" maxlength="100">
                            <div class="field-error" id="companyError" style="display:none;">
                                <i class="fas fa-exclamation-circle"></i> יש להזין שם חברה
                            </div>
                        </div>

                        <!-- מי מלווה - לא חובה -->
                        <div class="form-group">
                            <label class="form-label" for="permitEscort">
                                <i class="fas fa-user-friends"></i> מי מלווה
                                <span class="optional-label">(רשות)</span>
                            </label>
                            <input type="text" id="permitEscort" class="form-input" 
                                placeholder="שם המלווה מהחברה" maxlength="100">
                        </div>

                        <!-- שעה -->
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-clock"></i> שעה
                                <span class="optional-label">(רשות)</span>
                            </label>
                            <div class="time-input-group permit-time-group">
                                <select id="permitTimeMinute" class="job-minute">
                                    <option value="">דקות</option>
                                </select>
                                <span class="time-separator">:</span>
                                <select id="permitTimeHour" class="job-hour">
                                    <option value="">שעה</option>
                                </select>
                                <button type="button" class="time-job-clear-btn" id="permitTimeClearBtn"
                                        onclick="messagesManager.clearPermitTime()"
                                        title="נקה בחירת זמן" style="display:none;">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>

                        <!-- מחבר -->
                        <div class="form-group">
                            <label class="form-label required-field" for="permitAuthor">
                                <i class="fas fa-user-edit"></i> מחבר
                            </label>
                            <select id="permitAuthor" class="form-input form-select">
                                <option value="">בחר מחבר...</option>
                            </select>
                            <div id="permitCustomAuthorContainer" style="display:none; margin-top:8px;">
                                <input type="text"
                                       id="permitCustomAuthorInput"
                                       class="form-input"
                                       placeholder="הזן שם מחבר"
                                       maxlength="100">
                            </div>
                            <div class="field-error" id="authorError" style="display:none;">
                                <i class="fas fa-exclamation-circle"></i> יש לבחור מחבר
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" id="entryPermitHistoryBtn">
                        <i class="fas fa-history"></i> היסטוריית בקשות
                    </button>
                    <button class="btn btn-primary" id="entryPermitSubmitBtn">
                        <i class="fas fa-envelope"></i> צור מייל אישור כניסה
                    </button>
                    <button class="btn btn-secondary" id="entryPermitCancelBtn">
                        <i class="fas fa-times"></i> ביטול
                    </button>
                </div>
            </div>
        `;
            document.body.appendChild(modal);

            this._addEntryPermitStyles();


            document.getElementById('entryPermitCloseBtn')
                .addEventListener('click', () => this.closeEntryPermitModal());
            document.getElementById('entryPermitCancelBtn')
                .addEventListener('click', () => this.closeEntryPermitModal());
            document.getElementById('entryPermitSubmitBtn')
                .addEventListener('click', () => this.submitEntryPermit());

            // מאזין לחברה
            document.getElementById('permitCompany')
                .addEventListener('input', () => {
                    this._clearFieldError('companyError', 'permitCompany');
                });

            // מאזין לשדה הרכב הראשון - ניקוי מקפים
            const firstCarInput = document.querySelector('.permit-car-input');
            if (firstCarInput) {
                firstCarInput.addEventListener('input', (e) => {
                    const cleaned = e.target.value.replace(/[-\s]/g, '');
                    if (e.target.value !== cleaned) {
                        e.target.value = cleaned;
                    }
                    // נקה שגיאה אם יש ערך תקין
                    const carRegex = /^\d{5,8}$/;
                    const hasValidCar = Array.from(carInputs).some(input => {
                        const cleaned = input.value.trim().replace(/[-\s]/g, ''); // ← הסר מקפים
                        input.value = cleaned; // ← עדכן את השדה
                        return cleaned !== '' && carRegex.test(cleaned);
                    });
                });

                firstCarInput.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
                    const cleaned = pastedText.replace(/[-\s]/g, '');
                    const start = e.target.selectionStart;
                    const end = e.target.selectionEnd;
                    const currentValue = e.target.value;
                    e.target.value = currentValue.substring(0, start) + cleaned + currentValue.substring(end);
                    const newPos = start + cleaned.length;
                    e.target.setSelectionRange(newPos, newPos);
                });
            }

            // מאזין לשדה השם הראשון
            const firstNameInput = document.querySelector('.permit-name-input');
            if (firstNameInput) {
                firstNameInput.addEventListener('input', () => {
                    if (firstNameInput.value.trim() !== '') {
                        document.getElementById('nameError').style.display = 'none';
                        firstNameInput.classList.remove('input-error');
                    }
                });
            }

            // מאזיני checkboxes של אתר
            document.querySelectorAll('input[name="permitSite"]').forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    document.getElementById('siteError').style.display = 'none';
                    // עדכן מראה הכפתור
                    checkbox.nextElementSibling.classList.toggle('selected', checkbox.checked);
                });
            });

            const historyBtn = document.getElementById('entryPermitHistoryBtn');
            if (historyBtn) {
                historyBtn.addEventListener('click', () => this.openEntryPermitHistory());
            }

            // מאזין לשדה המחבר
            const permitAuthorSelect = document.getElementById('permitAuthor');
            if (permitAuthorSelect) {
                permitAuthorSelect.addEventListener('change', () => {
                    const customContainer = document.getElementById('permitCustomAuthorContainer');
                    const customInput = document.getElementById('permitCustomAuthorInput');
                    if (permitAuthorSelect.value === 'other') {
                        customContainer.style.display = 'block';
                        if (customInput) customInput.focus();
                    } else {
                        customContainer.style.display = 'none';
                    }
                    // נקה שגיאה
                    document.getElementById('authorError').style.display = 'none';
                    permitAuthorSelect.classList.remove('input-error');
                });
            }


            this._initEntryPermitDatePicker();
            this._initPermitTimeSelects();
        }

        // *** שמור מצב על המודל ***
        modal.dataset.editingMessageId = isEditing ? existingMessage.id : '';
        modal.dataset.isDuplicate = isDuplicate ? 'true' : 'false';

        // אכלוס רשימת עובדים בשדה המחבר
        this._populatePermitAuthorSelect();

        // *** עדכן כותרת וכפתור ***
        const titleEl = document.getElementById('entryPermitModalTitle');
        const submitBtn = document.getElementById('entryPermitSubmitBtn');

        if (isEditing) {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-edit"></i> עריכת אישור כניסה';
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים ושלח מייל';
        } else if (isDuplicate) {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-copy"></i> שכפול אישור כניסה';
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-envelope"></i> צור מייל אישור כניסה';
        } else {
            if (titleEl) titleEl.innerHTML = '<i class="fas fa-id-badge"></i> אישור כניסה';
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-envelope"></i> צור מייל אישור כניסה';
        }

        // איפוס הטופס
        this._resetEntryPermitForm();

        if (existingMessage) {

            let permitData = null;
            if (existingMessage.entryPermitData) {
                permitData = existingMessage.entryPermitData;
            } else {
                permitData = this._extractPermitDataFromMessage(existingMessage);
            }

            if (permitData) {
                this._fillEntryPermitForm(permitData, isDuplicate);
            }
        } else {
            // הודעה חדשה - הגדר תאריך ברירת מחדל
            this._setEntryPermitDefaultDate();
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            const firstNameInput = document.querySelector('#permitNamesContainer .permit-name-input');
            if (firstNameInput) firstNameInput.focus();
        }, 100);
    }

    _addPersonRow() {
        const container = document.getElementById('permitNamesContainer');
        if (!container) return;

        const rows = container.querySelectorAll('.person-row');
        const newIndex = rows.length;

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this._buildNameRowHtml(newIndex);
        const newRow = tempDiv.firstElementChild;

        container.appendChild(newRow);
        this._updateRemoveButtons(container);

        // ← תיקון: הוסף מאזינים לשדה הרכב החדש
        const carInput = newRow.querySelector('.permit-car-input');
        if (carInput) this._attachCarInputListeners(carInput);

        const nameInput = newRow.querySelector('.permit-name-input');
        if (nameInput) nameInput.focus();
    }

    // פתיחת מודל היסטוריית אישורי כניסה
    openEntryPermitHistory() {
        // איסוף כל הודעות אישורי כניסה
        const permits = this.allMessages
            .filter(m => m.category === 'אישורי כניסה')
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        // יצירת מודל אם לא קיים
        let modal = document.getElementById('entryPermitHistoryModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'entryPermitHistoryModal';
            modal.className = 'modal-overlay';
            modal.innerHTML = `
            <div class="modal-content entry-permit-history-modal">
                <div class="modal-header">
                    <h3>
                        <i class="fas fa-history"></i> היסטוריית אישורי כניסה
                    </h3>
                    <button class="close-btn" 
                            onclick="document.getElementById('entryPermitHistoryModal')
                                     .style.display='none'">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="history-search-bar">
                        <input type="text" 
                               id="historySearchInput" 
                               class="form-input" 
                               placeholder="חפש לפי שם, חברה, רכב..."
                               oninput="messagesManager.filterPermitHistory(this.value)">
                        <i class="fas fa-search history-search-icon"></i>
                    </div>
                    <div id="entryPermitHistoryContent"></div>
                </div>
                <div class="modal-footer">
                    <div class="history-footer-actions">
                        <button class="btn btn-success"
                                onclick="messagesManager.exportPermitHistoryToExcel()"
                                title="ייצא לקובץ Excel/CSV">
                            <i class="fas fa-file-excel"></i> ייצא לאקסל
                        </button>
                        <button class="btn btn-info"
                                onclick="messagesManager.printPermitHistory()"
                                title="הדפס היסטוריה">
                            <i class="fas fa-print"></i> הדפס
                        </button>
                    </div>
                    <button class="btn btn-secondary"
                            onclick="document.getElementById('entryPermitHistoryModal')
                                    .style.display='none'">
                        <i class="fas fa-times"></i> סגור
                    </button>
                </div>
            </div>
        `;
            document.body.appendChild(modal);
            this._addEntryPermitHistoryStyles();
            this._addEntryPermitStyles();
        }

        // שמור את הרשימה לשימוש בחיפוש
        this._allPermitsForHistory = permits;

        // מלא את הטבלה
        this._renderPermitHistoryTable(permits);

        modal.style.display = 'flex';
        modal.style.zIndex = '10000';
    }

    // סינון היסטוריה לפי חיפוש
    filterPermitHistory(searchText) {
        if (!this._allPermitsForHistory) return;

        const term = searchText.trim().toLowerCase();

        if (!term) {
            this._renderPermitHistoryTable(this._allPermitsForHistory);
            return;
        }

        const filtered = this._allPermitsForHistory.filter(m => {
            const data = m.entryPermitData ||
                this._extractPermitDataFromMessage(m) || {};

            // קבל אנשים
            const persons = this._getPersonsFromData(data);

            // חיפוש בכל שדות האנשים
            const personsText = persons.map(p =>
                [p.name, p.carNumber, p.idNumber, p.phone].filter(Boolean).join(' ')
            ).join(' ').toLowerCase();

            // אתרים
            const sitesText = (Array.isArray(data.Sites)
                ? data.Sites.join(' ')
                : (data.Site || '')).toLowerCase();

            const checks = [
                (m.title || '').toLowerCase(),
                personsText,
                sitesText,
                (data.company || '').toLowerCase(),
                (data.date || '').toLowerCase(),
                (data.escort || '').toLowerCase(),
                (m.content || '').toLowerCase(),
            ];

            return checks.some(field => field.includes(term));
        });

        this._renderPermitHistoryTable(filtered);
    }

    // רינדור טבלת ההיסטוריה
    _renderPermitHistoryTable(permits) {
        const container = document.getElementById('entryPermitHistoryContent');
        if (!container) return;

        if (permits.length === 0) {
            container.innerHTML = `
            <div class="history-empty">
                <i class="fas fa-inbox"></i>
                <p>לא נמצאו אישורי כניסה</p>
            </div>`;
            return;
        }

        // ספור סה"כ אנשים
        let totalPersons = 0;
        permits.forEach(m => {
            const data = m.entryPermitData || this._extractPermitDataFromMessage(m) || {};
            const persons = this._getPersonsFromData(data);
            totalPersons += persons.length || 1;
        });

        let html = `
    <div class="history-summary">
        <span><i class="fas fa-list"></i> סה"כ: ${permits.length} בקשות</span>
        <span><i class="fas fa-users"></i> סה"כ: ${totalPersons} אנשים</span>
    </div>
    <div class="history-table-wrapper">
        <table class="history-table">
            <thead>
                <tr>
                    <th>תאריך בקשה</th>
                    <th>תאריך כניסה</th>
                    <th>שעה</th>
                    <th>אתר</th>
                    <th>שם</th>
                    <th>חברה</th>
                    <th>מס' רכב</th>
                    <th>ת"ז</th>
                    <th>טלפון</th>
                    <th>מלווה</th>
                </tr>
            </thead>
            <tbody>`;

        permits.forEach(message => {
            const data = message.entryPermitData ||
                this._extractPermitDataFromMessage(message) || {};

            // אתר
            const siteDisplay = (Array.isArray(data.Sites) && data.Sites.length > 1)
                ? data.Sites.join(' + ')
                : (data.Site || '-');

            const siteClass = siteDisplay.includes('ר"ג') && siteDisplay.includes('פ"ת')
                ? 'both'
                : (siteDisplay.includes('ר"ג') ? 'rg' : 'pt');

            // תאריך בקשה
            const requestDate = this.getTimeAgo(message.date);

            // שעה
            const timeDisplay = data.Time || '-';

            // מלווה
            const escortDisplay = data.Escort || '-';

            // קבל רשימת אנשים
            const persons = this._getPersonsFromData(data);

            if (persons.length === 0) {
                // אין אנשים - שורה ריקה
                html += `
            <tr class="history-row permit-group-first permit-group-last">
                <td rowspan="1">
                    <span class="date-badge">${requestDate}</span>
                </td>
                <td rowspan="1"><strong>${data.Date || '-'}</strong></td>
                <td rowspan="1">
                    ${timeDisplay !== '-'
                        ? `<span class="time-badge"><i class="fas fa-clock"></i> ${timeDisplay}</span>`
                        : '<span class="empty-cell">-</span>'}
                </td>
                <td rowspan="1">
                    <span class="site-badge site-${siteClass}">${siteDisplay}</span>
                </td>
                <td><span class="empty-cell">-</span></td>
                <td rowspan="1">${data.Company || '-'}</td>
                <td><span class="empty-cell">-</span></td>
                <td><span class="empty-cell">-</span></td>
                <td><span class="empty-cell">-</span></td>
                <td rowspan="1">
                    ${escortDisplay !== '-'
                        ? `<span class="escort-badge"><i class="fas fa-user-friends"></i> ${escortDisplay}</span>`
                        : '<span class="empty-cell">-</span>'}
                </td>
            </tr>`;
            } else {
                // שורה לכל אדם - עם rowspan לשדות המשותפים
                persons.forEach((person, personIndex) => {
                    const isFirst = personIndex === 0;
                    const isLast = personIndex === persons.length - 1;
                    const rowspan = persons.length;

                    const rowClass = [
                        'history-row',
                        isFirst ? 'permit-group-first' : '',
                        isLast ? 'permit-group-last' : '',
                        personIndex % 2 === 1 ? 'person-row-alt' : ''
                    ].filter(Boolean).join(' ');

                    html += `<tr class="${rowClass}">`;

                    // עמודות עם rowspan - רק בשורה הראשונה
                    if (isFirst) {
                        html += `
                    <td rowspan="${rowspan}" class="shared-cell">
                        <span class="date-badge">${requestDate}</span>
                    </td>
                    <td rowspan="${rowspan}" class="shared-cell">
                        <strong>${data.date || data.Date || '-'}</strong>
                        ${data.dateLabel && data.dateLabel !== data.date
                                ? `<br><small class="date-label">${data.dateLabel}</small>`
                                : ''}
                    </td>
                    <td rowspan="${rowspan}" class="shared-cell">
                        ${timeDisplay !== '-'
                                ? `<span class="time-badge"><i class="fas fa-clock"></i> ${timeDisplay}</span>`
                                : '<span class="empty-cell">-</span>'}
                    </td>
                    <td rowspan="${rowspan}" class="shared-cell">
                        <span class="site-badge site-${siteClass}">${siteDisplay}</span>
                    </td>`;
                    }

                    // שם האדם
                    html += `
                <td class="person-name-cell">
                    <span class="person-index">${personIndex + 1}</span>
                    ${person.name || '-'}
                </td>`;

                    // חברה - rowspan בשורה הראשונה
                    if (isFirst) {
                        html += `
                    <td rowspan="${rowspan}" class="shared-cell">
                        ${data.company || data.Company || '-'}
                    </td>`;
                    }

                    // רכב
                    const carDisplay = person.carNumber || '-';
                    html += `
                <td class="cars-cell" dir="rtl">
                    ${carDisplay !== '-'
                            ? `<span class="car-badge">${carDisplay}</span>`
                            : '<span class="empty-cell">-</span>'}
                </td>`;

                    // ת"ז
                    const idDisplay = person.idNumber || '-';
                    html += `
                <td class="id-cell" dir="rtl">
                    ${idDisplay !== '-'
                            ? `<span class="id-badge">${idDisplay}</span>`
                            : '<span class="empty-cell">-</span>'}
                </td>`;

                    // טלפון
                    const phoneDisplay = person.phone || '-';
                    html += `
                <td class="phone-cell" dir="rtl">
                    ${phoneDisplay !== '-'
                            ? `<a href="tel:${phoneDisplay}" class="phone-link">${phoneDisplay}</a>`
                            : '<span class="empty-cell">-</span>'}
                </td>`;

                    // מלווה - rowspan בשורה הראשונה
                    if (isFirst) {
                        html += `
                    <td rowspan="${rowspan}" class="shared-cell escort-cell">
                        ${escortDisplay !== '-'
                                ? `<span class="escort-badge">
                                <i class="fas fa-user-friends"></i> ${escortDisplay}
                               </span>`
                                : '<span class="empty-cell">-</span>'}
                    </td>`;
                    }

                    html += `</tr>`;
                });
            }
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

        // עדכן CSS
        this._updateHistoryTableStyles();
    }

    _updateHistoryTableStyles() {
        // וודא שה-CSS קיים
        if (!document.getElementById('historyTableDynamicStyles')) {
            const style = document.createElement('style');
            style.id = 'historyTableDynamicStyles';
            style.textContent = `
            .permit-group-first td { border-top: 2px solid #c8d6f5 !important; }
            .permit-group-last td { border-bottom: 2px solid #c8d6f5 !important; }
            .person-row-alt td:not(.shared-cell) { background-color: #f8f9ff; }
            .shared-cell { vertical-align: middle !important; background-color: #fafbff; }
            .person-name-cell { white-space: nowrap; }
            .person-index {
                display: inline-flex; align-items: center; justify-content: center;
                width: 20px; height: 20px; min-width: 20px;
                background: linear-gradient(135deg, #667eea, #764ba2);
                color: white; border-radius: 50%;
                font-size: 0.72rem; font-weight: bold;
                margin-left: 6px; flex-shrink: 0;
            }
            .car-badge {
                font-family: monospace; font-size: 0.85rem;
                padding: 2px 6px; background: #f0fff4; color: #276749;
                border-radius: 6px; border: 1px solid #c6f6d5;
            }
        `;
            document.head.appendChild(style);
        }
    }

    // פונקציית עזר - חילוץ רשימת אנשים מנתוני האישור
    _getPersonsFromData(data) {
        // פורמט חדש - persons[]
        if (data.Persons) {
            let personsArray = data.Persons;

            // ← תיקון: טיפול בכל סוגי האובייקטים
            if (!Array.isArray(personsArray)) {
                // אם זה object עם מפתחות מספריים
                if (typeof personsArray === 'object') {
                    personsArray = Object.values(personsArray);
                } else {
                    personsArray = [];
                }
            }

            // ← תיקון: וודא שכל אלמנט הוא אובייקט תקין
            const filtered = personsArray.filter(p => {
                if (!p) return false;
                // תמיכה גם ב-PascalCase (מ-C#) וגם ב-camelCase
                const name = p.name || p.Name || '';
                return name.trim() !== '';
            }).map(p => ({
                name: p.name || p.Name || '',
                carNumber: p.carNumber || p.CarNumber || '',
                idNumber: p.idNumber || p.IdNumber || '',
                phone: p.phone || p.Phone || ''
            }));

            if (filtered.length > 0) return filtered;
        }

        // פורמט ישן - בנה מהשדות הנפרדים
        let names = [];
        if (Array.isArray(data.names)) {
            names = data.names.filter(n => n && n.trim() !== '');
        } else if (data.names && typeof data.names === 'object') {
            names = Object.values(data.names).filter(n => n && n.trim() !== '');
        } else if (data.fullName) {
            names = data.fullName.split(',').map(n => n.trim()).filter(n => n !== '');
        }

        let cars = [];
        if (Array.isArray(data.carNumbers)) {
            cars = data.carNumbers.filter(c => c && c.trim() !== '');
        } else if (data.carNumbers && typeof data.carNumbers === 'object') {
            cars = Object.values(data.carNumbers).filter(c => c && c.trim() !== '');
        } else if (data.carNumber) {
            cars = data.carNumber.split(',').map(c => c.trim()).filter(c => c !== '');
        }

        return names.map((name, i) => ({
            name: name,
            carNumber: cars[i] || '',
            idNumber: (names.length === 1 && data.idNumber) ? data.idNumber : '',
            phone: (names.length === 1 && data.phone) ? data.phone : ''
        }));
    }

    // CSS לטבלת ההיסטוריה
    _addEntryPermitHistoryStyles() {
        if (document.getElementById('entryPermitHistoryStyles')) return;

        const style = document.createElement('style');
        style.id = 'entryPermitHistoryStyles';
        style.textContent = `
        .entry-permit-history-modal {
            max-width: 1200px;
            width: 95%;
            height: 90%;
            display: flex;
            flex-direction: column;
        }

        .entry-permit-history-modal .modal-body {
            overflow-y: auto;
            flex: 1;
            padding: 15px 20px;
        }

        #entryPermitHistoryContent{
            height: 90%;
        }

        /* שורת חיפוש */
        .history-search-bar {
            position: relative;
            margin-bottom: 15px;
        }

        .history-search-bar .form-input {
            padding-left: 38px;
            border-radius: 8px;
        }

        .history-search-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            color: #aaa;
            pointer-events: none;
        }

        /* סיכום */
        .history-summary {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
            color: #666;
            font-size: 0.9rem;
        }

        .history-summary i {
            color: #667eea;
        }

        /* עטיפת טבלה */
        .history-table-wrapper {
            overflow-x: auto;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            height:95%;
        }

        /* טבלה */
        .history-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.88rem;
        }

        .history-table thead tr {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
        }

        .history-table th {
            padding: 10px 12px;
            text-align: right;
            font-weight: 600;
            white-space: nowrap;
        }

        .history-table tbody tr {
            border-bottom: 1px solid #f0f0f0;
            transition: background 0.15s;
        }

        .history-table tbody tr:hover {
            background: #f8f9ff;
        }

        .history-table td {
            padding: 10px 12px;
            vertical-align: middle;
        }

        /* תגיות */
        .date-badge {
            font-size: 0.8rem;
            color: #888;
        }

        .date-label {
            color: #667eea;
            font-size: 0.78rem;
        }

        .site-badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 0.82rem;
            font-weight: 600;
        }

        .site-badge.site-rg {
            background: #e8f4fd;
            color: #2980b9;
            border: 1px solid #bee3f8;
        }

        .site-badge.site-pt {
            background: #fef3e2;
            color: #d68910;
            border: 1px solid #fde8b4;
        }

        .site-badge.site-both {
            background: linear-gradient(135deg, #e8f4fd, #fef3e2);
            color: #555;
            border: 1px solid #ddd;
        }

        /* שמות */
        .names-cell {
            min-width: 100px;
            word-break: break-all;
        }

        .names-main {
            display: block;
        }

        .names-more {
            display: inline-block;
            margin-top: 2px;
            padding: 1px 6px;
            background: #eef2ff;
            color: #667eea;
            border-radius: 10px;
            font-size: 0.78rem;
            cursor: help;
        }

        /* רכבים */
        .cars-cell {
            font-family: monospace;
            font-size: 0.85rem;
            letter-spacing: 0.5px;
            min-width: 90px;
            word-break: break-all;
        }

        /* שעה */
        .time-cell {
            white-space: nowrap;
        }

        .time-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            background: #e8f4fd;
            color: #2980b9;
            border-radius: 10px;
            font-size: 0.82rem;
            font-weight: 600;
        }

        /* ת"ז */
        .id-cell {
            font-family: monospace;
            font-size: 0.85rem;
        }

        .id-badge {
            padding: 2px 6px;
            background: #f0fff4;
            color: #276749;
            border-radius: 6px;
            border: 1px solid #c6f6d5;
            font-size: 0.82rem;
        }

        /* מלווה */
        .escort-cell {
            min-width: 80px;
        }

        .escort-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.85rem;
            color: #553c9a;
        }

        .escort-badge i {
            color: #805ad5;
            font-size: 0.78rem;
        }

        /* טלפון */
        .phone-cell {
            white-space: nowrap;
        }

        .phone-link {
            color: #2b6cb0;
            text-decoration: none;
            font-family: monospace;
            font-size: 0.85rem;
            padding: 2px 6px;
            background: #ebf8ff;
            border-radius: 6px;
            border: 1px solid #bee3f8;
            transition: background 0.15s;
        }

        .phone-link:hover {
            background: #bee3f8;
            text-decoration: underline;
        }

        /* תא ריק */
        .empty-cell {
            color: #ccc;
            font-size: 0.85rem;
        }

        /* ריק */
        .history-empty {
            text-align: center;
            padding: 50px 20px;
            color: #aaa;
        }

        .history-empty i {
            font-size: 3rem;
            margin-bottom: 15px;
            display: block;
        }

        /* כפתור היסטוריה */
        .btn-info {
            background: linear-gradient(135deg, #17a2b8, #138496);
            color: white;
            border: none;
        }

        .btn-info:hover {
            background: linear-gradient(135deg, #138496, #117a8b);
            transform: translateY(-1px);
        }

        @media (max-width: 768px) {
            .entry-permit-history-modal {
                width: 100%;
                max-height: 100vh;
            }

            .history-table {
                font-size: 0.78rem;
            }

            .history-table th,
            .history-table td {
                padding: 7px 8px;
            }
        }
    `;
        document.head.appendChild(style);
    }

    // הסרת שורה
    _removeEntryRow(button) {
        const row = button.closest('.multi-entry-row');
        const container = row.parentElement;

        // לא מסיר אם זו השורה היחידה
        if (container.querySelectorAll('.multi-entry-row').length <= 1) return;

        container.removeChild(row);
        this._updateRemoveButtons(container);
    }

    // עדכון נראות כפתורי הסרה
    _updateRemoveButtons(container) {
        const rows = container.querySelectorAll('.multi-entry-row');
        rows.forEach(row => {
            const removeBtn = row.querySelector('.remove-entry-btn');
            if (removeBtn) {
                removeBtn.style.display = rows.length > 1 ? 'flex' : 'none';
            }
        });
    }

    // *** פונקציה חדשה לחילוץ נתונים מהודעה ישנה ***
    _extractPermitDataFromMessage(message) {
        try {
            // אם יש entryPermitData - השתמש בו ישירות
            if (message.entryPermitData) {
                return message.entryPermitData;
            }

            // אחרת נסה לחלץ מהתוכן
            const content = message.content || '';
            const title = message.title || '';

            // ===== חילוץ אתרים =====
            let sites = [];
            if (content.includes('ר"ג') || title.includes('ר"ג')) sites.push('ר"ג');
            if (content.includes('פ"ת') || title.includes('פ"ת')) sites.push('פ"ת');

            // ===== חילוץ תאריך מהכותרת =====
            // פורמט: "אישור כניסה - שם - DD/MM/YYYY"
            let date = null;
            const titleDateMatch = title.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (titleDateMatch) {
                date = titleDateMatch[1];
            }

            // ===== חילוץ שמות =====
            // פורמט חדש עם מספור:
            // "שמות  :\n  1. שם1\n  2. שם2"
            let names = [];

            // נסה פורמט מספור (מספר שמות)
            const numberedNamesMatch = content.match(/שמות\s*:\s*\n((?:\s+\d+\.\s*.+\n?)+)/);
            if (numberedNamesMatch) {
                const namesBlock = numberedNamesMatch[1];
                const nameLines = namesBlock.match(/\d+\.\s*(.+)/g);
                if (nameLines) {
                    names = nameLines.map(line => line.replace(/^\d+\.\s*/, '').trim())
                        .filter(n => n !== '');
                }
            }

            // נסה פורמט שם בודד: "שם    : שם פרטי ושם משפחה"
            if (names.length === 0) {
                const singleNameMatch = content.match(/שם\s*:\s*(.+)/);
                if (singleNameMatch) {
                    names = [singleNameMatch[1].trim()];
                }
            }

            // ===== חילוץ חברה =====
            let company = null;
            const companyMatch = content.match(/חברה\s*:\s*(.+)/);
            if (companyMatch) {
                company = companyMatch[1].trim();
            }

            // ===== חילוץ רכבים =====
            // פורמט חדש עם מספור:
            // "מס' רכב:\n  1. 12345678\n  2. 87654321"
            let carNumbers = [];

            // נסה פורמט מספור (מספר רכבים)
            const numberedCarsMatch = content.match(/מס['׳]?\s*רכב\s*:\s*\n((?:\s+\d+\.\s*.+\n?)+)/);
            if (numberedCarsMatch) {
                const carsBlock = numberedCarsMatch[1];
                const carLines = carsBlock.match(/\d+\.\s*(.+)/g);
                if (carLines) {
                    carNumbers = carLines
                        .map(line => line.replace(/^\d+\.\s*/, '').trim().replace(/[-\s]/g, ''))
                        .filter(c => c !== '');
                }
            }

            // נסה פורמט רכב בודד: "מס' רכב: 12345678"
            if (carNumbers.length === 0) {
                const singleCarMatch = content.match(/מס['׳]?\s*רכב\s*:\s*(\d[\d\s,-]+)/);
                if (singleCarMatch) {
                    carNumbers = singleCarMatch[1]
                        .split(',')
                        .map(c => c.trim().replace(/[-\s]/g, ''))
                        .filter(c => c !== '');
                }
            }

            // ===== חילוץ שדות אופציונליים =====
            const idMatch = content.match(/ת\.ז\.\s*:\s*(.+)/);
            const escortMatch = content.match(/מלווה\s*:\s*(.+)/);
            const timeMatch = content.match(/בשעה\s+(\d{1,2}:\d{2})/);
            const phoneMatch = content.match(/טלפון\s*:\s*(.+)/);

            const result = {
                sites: sites.length > 0 ? sites : null,
                site: sites.join(' ו'),
                date: date,
                names: names.length > 0 ? names : null,
                fullName: names.join(', '),
                company: company,
                carNumbers: carNumbers.length > 0 ? carNumbers : null,
                carNumber: carNumbers.join(', '),
                idNumber: idMatch ? idMatch[1].trim() : null,
                escort: escortMatch ? escortMatch[1].trim() : null,
                time: timeMatch ? timeMatch[1].trim() : null,
                phone: phoneMatch ? phoneMatch[1].trim() : null
            };
            return result;

        } catch (error) {
            console.error('Error extracting permit data from message:', error);
            return null;
        }
    }

    _fillEntryPermitForm(data, isDuplicate = false) {
        // ← תיקון: תמיכה ב-PascalCase מ-C#
        const sites = data.sites || data.Sites ||
            (data.site || data.Site ? [data.site || data.Site] : []);

        // ===== אתר =====
        document.querySelectorAll('input[name="permitSite"]').forEach(cb => {
            const shouldCheck = sites.some(s => s === cb.value);
            cb.checked = shouldCheck;
            cb.nextElementSibling.classList.toggle('selected', shouldCheck);
        });

        // ===== תאריך =====
        const dateValue = data.date || data.Date || '';
        if (!isDuplicate && dateValue) {
            let dateStr = dateValue;
            const dateMatch = dateStr.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (dateMatch) dateStr = dateMatch[1];

            document.getElementById('permitDate').value = dateStr;
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                const isoDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                document.getElementById('permitDateHidden').value = isoDate;
                if (this.entryPermitDatePicker) {
                    try {
                        this.entryPermitDatePicker.setDate(
                            new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0])), false
                        );
                    } catch (e) { this._setEntryPermitDefaultDate(); }
                }
            } else {
                this._setEntryPermitDefaultDate();
            }
        } else {
            this._setEntryPermitDefaultDate();
        }

        // ===== בניית persons =====
        const personsToFill = this._getPersonsFromData(data);

        // ===== מלא שורות אנשים =====
        const namesContainer = document.getElementById('permitNamesContainer');
        if (namesContainer) {
            namesContainer.innerHTML = '';

            if (personsToFill.length > 0) {
                personsToFill.forEach((person, index) => {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = this._buildNameRowHtml(
                        index,
                        person.name || '',
                        person.carNumber || '',
                        person.idNumber || '',
                        person.phone || ''
                    );
                    const newRow = tempDiv.firstElementChild;
                    namesContainer.appendChild(newRow);

                    const carInput = newRow.querySelector('.permit-car-input');
                    if (carInput) this._attachCarInputListeners(carInput);
                });
            } else {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = this._buildNameRowHtml(0);
                const newRow = tempDiv.firstElementChild;
                namesContainer.appendChild(newRow);

                const carInput = newRow.querySelector('.permit-car-input');
                if (carInput) this._attachCarInputListeners(carInput);
            }

            this._updateRemoveButtons(namesContainer);
        }

        // ===== חברה =====
        const companyField = document.getElementById('permitCompany');
        if (companyField) companyField.value = data.company || data.Company || '';

        // ===== מלווה =====
        const escortField = document.getElementById('permitEscort');
        if (escortField) escortField.value = data.escort || data.Escort || '';

        // ===== שעה =====
        const timeValue = data.time || data.Time || '';
        if (timeValue) {
            const timeParts = timeValue.split(':');
            if (timeParts.length === 2) {
                const hourSel = document.getElementById('permitTimeHour');
                const minuteSel = document.getElementById('permitTimeMinute');
                const clearBtn = document.getElementById('permitTimeClearBtn');
                if (hourSel) hourSel.value = timeParts[0].padStart(2, '0');
                if (minuteSel) minuteSel.value = timeParts[1].padStart(2, '0');
                if (clearBtn && (hourSel?.value || minuteSel?.value)) {
                    clearBtn.style.display = 'inline-block';
                }
            }
        }

        // ===== מחבר =====
        const authorValue = data.author || data.Author || '';
        const authorSelect = document.getElementById('permitAuthor');
        const customContainer = document.getElementById('permitCustomAuthorContainer');
        const customInput = document.getElementById('permitCustomAuthorInput');

        if (authorSelect && authorValue) {
            const optionExists = Array.from(authorSelect.options)
                .some(opt => opt.value === authorValue);

            if (optionExists) {
                authorSelect.value = authorValue;
                if (customContainer) customContainer.style.display = 'none';
            } else {
                // מחבר לא ברשימה - הצג שדה חופשי
                authorSelect.value = 'other';
                if (customContainer) customContainer.style.display = 'block';
                if (customInput) customInput.value = authorValue;
            }
        }
    }

    // ========== פונקציות עזר פנימיות ==========
    _attachCarInputListeners(carInput) {
        carInput.addEventListener('input', (e) => {
            const cleaned = e.target.value.replace(/[-\s]/g, '');
            if (e.target.value !== cleaned) e.target.value = cleaned;
        });

        carInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            const cleaned = pastedText.replace(/[-\s]/g, '');
            const start = e.target.selectionStart;
            const end = e.target.selectionEnd;
            const currentValue = e.target.value;
            e.target.value = currentValue.substring(0, start) + cleaned + currentValue.substring(end);
            e.target.setSelectionRange(start + cleaned.length, start + cleaned.length);
        });
    }

    // הצגת כפתור היסטוריה כשנמצאים בטאב אישורי כניסה
    showEntryPermitHistoryButton() {
        const noticesGrid = document.querySelector('.notices-grid');
        if (!noticesGrid) return;

        // הסר כפתור קיים אם יש
        const existingBtn = document.getElementById('entryPermitHistoryGridBtn');
        if (existingBtn) existingBtn.remove();

        // בדוק אם הטאב הפעיל הוא אישורי כניסה
        if (this.currentCategoryFilter !== 'אישורי כניסה') return;

        // ספור כמה אישורים יש
        const permitsCount = this.allMessages.filter(
            m => m.category === 'אישורי כניסה'
        ).length;

        // צור את הכפתור
        const btnWrapper = document.createElement('div');
        btnWrapper.id = 'entryPermitHistoryGridBtn';
        btnWrapper.className = 'entry-permit-history-grid-btn-wrapper';
        btnWrapper.innerHTML = `
        <button class="entry-permit-new-grid-btn"
                onclick="messagesManager.openEntryPermitModal()">
            <i class="fas fa-plus"></i>
            <span>אישור כניסה חדש</span>
        </button>
        <button class="entry-permit-history-grid-btn"
                onclick="messagesManager.openEntryPermitHistory()">
            <i class="fas fa-history"></i>
            <span>היסטוריית אישורי כניסה</span>
            ${permitsCount > 0
                ? `<span class="permits-count-badge">${permitsCount}</span>`
                : ''}
        </button>
    `;

        // הוסף לפני הכרטיסים
        noticesGrid.insertBefore(btnWrapper, noticesGrid.firstChild);

        // הוסף CSS אם לא קיים
        this._addEntryPermitGridBtnStyles();
    }

    _addEntryPermitGridBtnStyles() {
        if (document.getElementById('entryPermitGridBtnStyles')) return;

        const style = document.createElement('style');
        style.id = 'entryPermitGridBtnStyles';
        style.textContent = `
        .entry-permit-history-grid-btn-wrapper {
            grid-column: 1 / -1;
            display: flex;
            gap: 12px;
            align-items: center;
            padding: 14px 18px;
            background: linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%);
            border: 1.5px solid #c3d0f7;
            border-radius: 12px;
            margin-bottom: 4px;
            flex-wrap: wrap;
        }

        .entry-permit-history-grid-btn,
        .entry-permit-new-grid-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            border: none;
            border-radius: 9px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.22s ease;
            font-family: inherit;
        }

        .entry-permit-history-grid-btn {
            right: 100%;
            position: sticky;
        }

        .entry-permit-history-grid-btn {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            box-shadow: 0 3px 10px rgba(102, 126, 234, 0.3);
        }

        .entry-permit-history-grid-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 18px rgba(102, 126, 234, 0.45);
        }

        .entry-permit-history-grid-btn:active {
            transform: translateY(0);
        }

        .entry-permit-new-grid-btn {
            background: linear-gradient(135deg, #38a169, #276749);
            color: white;
            box-shadow: 0 3px 10px rgba(56, 161, 105, 0.3);
        }

        .entry-permit-new-grid-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 18px rgba(56, 161, 105, 0.45);
        }

        .entry-permit-new-grid-btn:active {
            transform: translateY(0);
        }

        .permits-count-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 22px;
            height: 22px;
            padding: 0 6px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 11px;
            font-size: 0.8rem;
            font-weight: 700;
            border: 1.5px solid rgba(255, 255, 255, 0.5);
        }

        @media (max-width: 600px) {
            .entry-permit-history-grid-btn-wrapper {
                flex-direction: column;
                align-items: stretch;
            }

            .entry-permit-history-grid-btn,
            .entry-permit-new-grid-btn {
                justify-content: center;
                width: 100%;
            }
        }
    `;
        document.head.appendChild(style);
    }

    _initEntryPermitDatePicker() {
        if (typeof FlatpickrHelper !== 'undefined') {
            this.entryPermitDatePicker = FlatpickrHelper.initHebrewDatePicker(
                '#permitDateHidden',
                (selectedDates, dateStr) => {
                    if (dateStr) {
                        const formatted = FlatpickrHelper.formatDateToDisplay(dateStr);
                        document.getElementById('permitDate').value = formatted;
                        document.getElementById('permitDateHidden').value = dateStr;

                        // נקה שגיאת תאריך
                        const dateErrorEl = document.getElementById('dateError');
                        dateErrorEl.style.display = 'none';
                        dateErrorEl.innerHTML =
                            `<i class="fas fa-exclamation-circle"></i> יש לבחור תאריך`;
                        document.getElementById('permitDate')
                            .classList.remove('input-error');
                    }
                },
                {
                    // חסום תאריכים שעברו
                    minDate: 'today'
                }
            );

            // לחיצה על שדה התאריך פותחת את ה-datepicker
            document.getElementById('permitDate').addEventListener('click', () => {
                if (this.entryPermitDatePicker) {
                    this.entryPermitDatePicker.open();
                }
            });
        } else {
            // fallback
            const dateInput = document.getElementById('permitDate');
            dateInput.removeAttribute('readonly');
            dateInput.type = 'date';

            // הגדר מינימום לתאריך היום
            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            dateInput.min = `${yyyy}-${mm}-${dd}`;

            dateInput.addEventListener('change', (e) => {
                document.getElementById('permitDateHidden').value = e.target.value;
            });
        }
    }

    _setEntryPermitDefaultDate() {
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();

        document.getElementById('permitDate').value = `${dd}/${mm}/${yyyy}`;
        document.getElementById('permitDateHidden').value =
            `${yyyy}-${mm}-${dd}`;

        if (this.entryPermitDatePicker) {
            this.entryPermitDatePicker.setDate(today, false);
        }
    }

    _resetEntryPermitForm() {
        // איפוס checkboxes של אתר
        document.querySelectorAll('input[name="permitSite"]').forEach(cb => {
            cb.checked = false;
        });
        document.querySelectorAll('.site-btn').forEach(btn =>
            btn.classList.remove('selected')
        );

        // איפוס שגיאות
        ['siteError', 'dateError', 'nameError', 'companyError', 'carError']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

        document.getElementById('permitCompany')?.classList.remove('input-error');

        // איפוס תאריך
        document.getElementById('permitDate').value = '';
        document.getElementById('permitDateHidden').value = '';
        if (this.entryPermitDatePicker) this.entryPermitDatePicker.clear();

        // איפוס שמות - שורה אחת ריקה
        const namesContainer = document.getElementById('permitNamesContainer');
        if (namesContainer) {
            namesContainer.innerHTML = '';
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this._buildNameRowHtml(0);
            const newRow = tempDiv.firstElementChild;
            namesContainer.appendChild(newRow);

            const carInput = newRow.querySelector('.permit-car-input');
            if (carInput) this._attachCarInputListeners(carInput);
        }

        // איפוס שדות אחרים
        const companyField = document.getElementById('permitCompany');
        if (companyField) companyField.value = '';

        const escortField = document.getElementById('permitEscort');
        if (escortField) escortField.value = '';

        // איפוס שעה
        const hourSel = document.getElementById('permitTimeHour');
        const minuteSel = document.getElementById('permitTimeMinute');

        // איפוס מחבר - הגדר ברירת מחדל
        const authorSelect = document.getElementById('permitAuthor');
        const customContainer = document.getElementById('permitCustomAuthorContainer');
        const customInput = document.getElementById('permitCustomAuthorInput');
        const authorError = document.getElementById('authorError');

        if (authorSelect) {
            const lastAuthor = this.getLastSelectedAuthor();
            if (lastAuthor) {
                const optionExists = Array.from(authorSelect.options)
                    .some(opt => opt.value === lastAuthor);
                authorSelect.value = optionExists ? lastAuthor : '';
            } else {
                authorSelect.value = '';
            }
        }
        if (customContainer) customContainer.style.display = 'none';
        if (customInput) customInput.value = '';
        if (authorError) authorError.style.display = 'none';
    }

    _clearFieldError(errorId, inputId) {
        const errorEl = document.getElementById(errorId);
        const inputEl = document.getElementById(inputId);
        if (errorEl) errorEl.style.display = 'none';
        if (inputEl) inputEl.classList.remove('input-error');
    }

    closeEntryPermitModal() {
        const modal = document.getElementById('entryPermitModal');
        if (modal) {
            modal.style.display = 'none';
        }
        document.body.style.overflow = 'auto';
    }

    // ========== ולידציה ושליחה ==========
    async _saveEntryPermitAsMessage(data, editingMessageId = null) {
        try {
            const isEditing = editingMessageId !== null && editingMessageId !== '';

            let titleName = data.fullName;
            if (data.names && data.names.length > 1) {
                titleName = `${data.names[0]} ואחרים`;
            }

            const titleSite = data.sites && data.sites.length > 1
                ? data.sites.join(' ו')
                : data.site;

            // וודא שמערכים נשמרים כמערכים אמיתיים
            const personsArray = Array.isArray(data.persons)
                ? data.persons.filter(p => p && p.name && p.name.trim() !== '')
                : [];

            // אם אין persons, בנה מהשדות הישנים
            if (personsArray.length === 0 && data.names) {
                const namesArr = Array.isArray(data.names) ? data.names : [data.names];
                const carsArr = Array.isArray(data.carNumbers) ? data.carNumbers :
                    (data.carNumber ? [data.carNumber] : []);

                namesArr.forEach((name, i) => {
                    if (name && name.trim()) {
                        personsArray.push({
                            name: name.trim(),
                            carNumber: (carsArr[i] || '').replace(/[-\s]/g, ''),
                            idNumber: '',
                            phone: ''
                        });
                    }
                });
            }

            const namesArray = personsArray.map(p => p.name);
            const carsArray = personsArray.map(p => p.carNumber).filter(c => c !== '');

            const messageData = {
                id: isEditing ? editingMessageId : '',
                title: `אישור כניסה - ${titleName} - ${data.date}`,
                category: 'אישורי כניסה',
                priority: 'רגיל',
                author: data.author || this.getLastSelectedAuthor() || 'NOC',
                content: this._buildEntryPermitEmailBody(data),
                entryPermitData: {
                    sites: Array.isArray(data.sites) ? [...data.sites] : [data.site],
                    site: titleSite,
                    date: data.date,
                    dateLabel: data.dateLabel || data.date,
                    // ← שמור persons[] המלא - זה הכי חשוב!
                    persons: personsArray.map(p => ({
                        name: p.name || '',
                        carNumber: p.carNumber || '',
                        idNumber: p.idNumber || '',
                        phone: p.phone || ''
                    })),
                    names: namesArray,
                    fullName: namesArray.join(', '),
                    company: data.company,
                    carNumbers: carsArray,
                    carNumber: carsArray.join(', '),
                    idNumber: personsArray.length === 1 ? (personsArray[0].idNumber || null) : null,
                    escort: data.escort || null,
                    time: data.time || '',
                    phone: personsArray.length === 1 ? (personsArray[0].phone || '') : ''
                },
                isEntryPermit: true
            };

            const url = isEditing ? '/Messages/EditMessage' : '/Messages/AddMessage';
            const method = isEditing ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(messageData)
            });

            const result = await response.json();

            if (result.success) {
                const msg = isEditing
                    ? 'אישור הכניסה עודכן בהצלחה'
                    : 'אישור הכניסה נשמר בהצלחה';
                NotificationManager.show(msg, 'success');
                await this.loadMessages();
                return result;
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירה', 'error');
                return null;
            }
        } catch (error) {
            console.error('Error saving entry permit as message:', error);
            NotificationManager.show('שגיאה בשמירת אישור הכניסה', 'error');
            return null;
        }
    }

    submitEntryPermit() {
        if (!this._validateEntryPermitForm()) {
            return;
        }

        const data = this._collectEntryPermitData();

        // *** קבל את ה-ID של ההודעה הנערכת מהמודל ***
        const modal = document.getElementById('entryPermitModal');
        const editingMessageId = modal ? modal.dataset.editingMessageId : '';
        const isDuplicate = modal ? modal.dataset.isDuplicate === 'true' : false;
        const isEditing = !!(editingMessageId && editingMessageId !== '' && !isDuplicate);

        // שמור מחבר שנבחר
        if (data.author && data.author !== 'other') {
            this.saveLastSelectedAuthor(data.author);
        }

        // שמור את האישור כהודעה
        this._saveEntryPermitAsMessage(data, isEditing ? editingMessageId : null)
            .then(savedMessage => {
                this._openEntryPermitEmail(data);
                this.closeEntryPermitModal();
            });
    }

    // ========== ולידציה מורחבת ==========

    _validateEntryPermitForm() {
        let isValid = true;

        // נקה שגיאות קודמות
        this._clearAllPermitErrors();

        // ===== אתר =====
        const sitesSelected = document.querySelectorAll(
            'input[name="permitSite"]:checked'
        );
        if (sitesSelected.length === 0) {
            document.getElementById('siteError').style.display = 'flex';
            isValid = false;
        }

        // ===== תאריך =====
        const dateValue = document.getElementById('permitDateHidden').value;
        if (!dateValue || dateValue.trim() === '') {
            document.getElementById('dateError').style.display = 'flex';
            document.getElementById('permitDate').classList.add('input-error');
            isValid = false;
        }

        // ===== חברה =====
        const company = document.getElementById('permitCompany').value.trim();
        if (!company) {
            document.getElementById('companyError').style.display = 'flex';
            document.getElementById('permitCompany').classList.add('input-error');
            isValid = false;
        }

        // ===== אנשים =====
        const personValidation = this._validatePersonRows();
        if (!personValidation.isValid) {
            isValid = false;
        }

        // ===== מחבר =====
        const authorSelect = document.getElementById('permitAuthor');
        const customAuthorInput = document.getElementById('permitCustomAuthorInput');
        const authorError = document.getElementById('authorError');

        if (authorSelect) {
            if (!authorSelect.value || authorSelect.value === '') {
                if (authorError) authorError.style.display = 'flex';
                authorSelect.classList.add('input-error');
                isValid = false;
            } else if (authorSelect.value === 'other') {
                const customVal = customAuthorInput?.value.trim() || '';
                if (!customVal) {
                    if (authorError) {
                        authorError.style.display = 'flex';
                        authorError.innerHTML =
                            '<i class="fas fa-exclamation-circle"></i> יש להזין שם מחבר';
                    }
                    if (customAuthorInput) customAuthorInput.classList.add('input-error');
                    isValid = false;
                }
            }
        }

        // גלול לשגיאה הראשונה
        if (!isValid) {
            const firstError = document.querySelector(
                '.field-error[style*="flex"], .input-error'
            );
            if (firstError) {
                firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        return isValid;
    }

    _validatePersonRows() {
        const personRows = document.querySelectorAll(
            '#permitNamesContainer .person-row'
        );

        const carRegex = /^\d{5,8}$/;
        const idRegex = /^\d{9}$/;
        const phoneRegex = /^0\d{1,2}[-]?\d{3}[-]?\d{4}$/;

        let isValid = true;
        let hasValidName = false;

        // מפות לזיהוי כפילויות
        const seenIds = new Map(); // idNumber  → rowIndex
        const seenPhones = new Map(); // phone     → rowIndex

        // --- מעבר ראשון: ניקוי + איסוף ערכים ---
        const persons = [];
        personRows.forEach((row, idx) => {
            const nameInput = row.querySelector('.permit-name-input');
            const carInput = row.querySelector('.permit-car-input');
            const idInput = row.querySelector('.permit-id-input');
            const phoneInput = row.querySelector('.permit-phone-input');

            // נקה שגיאות שדה
            [nameInput, carInput, idInput, phoneInput].forEach(inp => {
                if (inp) {
                    inp.classList.remove('input-error');
                    this._removeInlineError(inp);
                }
            });

            // נרמל רכב (הסר מקפים/רווחים)
            if (carInput) {
                carInput.value = carInput.value.replace(/[-\s]/g, '');
            }

            persons.push({
                idx,
                row,
                nameInput,
                carInput,
                idInput,
                phoneInput,
                name: nameInput?.value.trim() || '',
                car: carInput?.value.trim() || '',
                id: idInput?.value.trim() || '',
                phone: phoneInput?.value.trim() || ''
            });
        });

        // --- מעבר שני: ולידציה ---
        persons.forEach(p => {

            // שם - חובה
            if (p.name !== '') {
                hasValidName = true;
            }

            // רכב - אם הוזן, חייב להיות תקין
            if (p.car !== '' && !carRegex.test(p.car)) {
                this._markFieldError(
                    p.carInput,
                    'מספר רכב חייב להכיל 5-8 ספרות בלבד'
                );
                isValid = false;
            }

            // ת"ז - אם הוזנה, חייבת להיות 9 ספרות
            if (p.id !== '') {
                if (!idRegex.test(p.id)) {
                    this._markFieldError(
                        p.idInput,
                        'תעודת זהות חייבת להכיל בדיוק 9 ספרות'
                    );
                    isValid = false;
                } else {
                    // בדיקת כפילות ת"ז
                    if (seenIds.has(p.id)) {
                        const firstIdx = seenIds.get(p.id) + 1;
                        this._markFieldError(
                            p.idInput,
                            `ת"ז זו כבר הוזנה עבור אדם מספר ${firstIdx}`
                        );
                        // סמן גם את השורה הראשונה שהכילה את הת"ז
                        const firstRow = persons[seenIds.get(p.id)];
                        if (firstRow?.idInput) {
                            this._markFieldError(
                                firstRow.idInput,
                                `ת"ז זו מופיעה גם עבור אדם מספר ${p.idx + 1}`
                            );
                        }
                        isValid = false;
                    } else {
                        seenIds.set(p.id, p.idx);
                    }
                }
            }

            // טלפון - אם הוזן, חייב להיות תקין
            if (p.phone !== '') {
                if (!phoneRegex.test(p.phone)) {
                    this._markFieldError(
                        p.phoneInput,
                        'מספר טלפון חייב להתחיל ב-0 ולהכיל 9-10 ספרות'
                    );
                    isValid = false;
                } else {
                    // בדיקת כפילות טלפון
                    if (seenPhones.has(p.phone)) {
                        const firstIdx = seenPhones.get(p.phone) + 1;
                        this._markFieldError(
                            p.phoneInput,
                            `מספר טלפון זה כבר הוזן עבור אדם מספר ${firstIdx}`
                        );
                        // סמן גם את השורה הראשונה
                        const firstRow = persons[seenPhones.get(p.phone)];
                        if (firstRow?.phoneInput) {
                            this._markFieldError(
                                firstRow.phoneInput,
                                `מספר טלפון זה מופיע גם עבור אדם מספר ${p.idx + 1}`
                            );
                        }
                        isValid = false;
                    } else {
                        seenPhones.set(p.phone, p.idx);
                    }
                }
            }
        });

        // לפחות שם אחד חובה
        if (!hasValidName) {
            document.getElementById('nameError').style.display = 'flex';
            const firstNameInput = document.querySelector('.permit-name-input');
            if (firstNameInput) {
                firstNameInput.classList.add('input-error');
            }
            isValid = false;
        }

        return { isValid };
    }

    // ===== פונקציות עזר לשגיאות =====

    _markFieldError(inputEl, message) {
        if (!inputEl) return;

        inputEl.classList.add('input-error');

        // הסר שגיאה קיימת אם יש
        this._removeInlineError(inputEl);

        // צור אלמנט שגיאה inline מתחת לשדה
        const errorEl = document.createElement('div');
        errorEl.className = 'inline-field-error';
        errorEl.innerHTML =
            `<i class="fas fa-exclamation-circle"></i> ${message}`;

        inputEl.parentNode.insertBefore(errorEl, inputEl.nextSibling);
    }

    _removeInlineError(inputEl) {
        if (!inputEl) return;
        const next = inputEl.nextSibling;
        if (next && next.classList &&
            next.classList.contains('inline-field-error')) {
            next.remove();
        }
    }

    _clearAllPermitErrors() {
        // שגיאות כלליות
        ['siteError', 'dateError', 'nameError', 'companyError', 'carError', 'authorError']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });

        // שגיאות שדות
        document.querySelectorAll(
            '#entryPermitModal .input-error'
        ).forEach(el => el.classList.remove('input-error'));

        // שגיאות inline
        document.querySelectorAll('.inline-field-error')
            .forEach(el => el.remove());
    }

    // HTML של שורת שם - עם שדות נוספים
    _buildNameRowHtml(index, name = '', carNumber = '', idNumber = '', phone = '') {
        return `
    <div class="multi-entry-row person-row" data-index="${index}">
        <div class="person-inline-fields">
            <input type="text" 
                   class="form-input permit-name-input" 
                   placeholder="שם פרטי ושם משפחה" 
                   maxlength="100"
                   value="${this.escapeHtml(name)}">

            <input type="text" 
                   class="form-input permit-car-input" 
                   placeholder="מס' רכב (רשות)"
                   maxlength="8" 
                   dir="rtl"
                   value="${this.escapeHtml(carNumber)}">

            <input type="text" 
                   class="form-input permit-id-input" 
                   placeholder="ת.ז. (רשות)" 
                   maxlength="9" 
                   dir="rtl"
                   value="${this.escapeHtml(idNumber)}">

            <input type="tel" 
                   class="form-input permit-phone-input" 
                   placeholder="טלפון (רשות)" 
                   maxlength="11" 
                   dir="rtl"
                   value="${this.escapeHtml(phone)}">
        </div>
        <button type="button" class="remove-entry-btn" 
                onclick="messagesManager._removeEntryRow(this)" 
                style="display:none;" title="הסר">
            <i class="fas fa-times"></i>
        </button>
    </div>`;
    }

    _collectEntryPermitData() {
        const selectedSites = Array.from(
            document.querySelectorAll('input[name="permitSite"]:checked')
        ).map(cb => cb.value);

        const dateDisplay = document.getElementById('permitDate').value;
        const hourVal = document.getElementById('permitTimeHour')?.value;
        const minuteVal = document.getElementById('permitTimeMinute')?.value;
        const time = (hourVal && minuteVal) ? `${hourVal}:${minuteVal}` : null;
        const escort = document.getElementById('permitEscort')?.value.trim() || null;

        const persons = Array.from(
            document.querySelectorAll('#permitNamesContainer .person-row')
        ).map(row => ({
            name: row.querySelector('.permit-name-input')?.value.trim() || '',
            carNumber: (row.querySelector('.permit-car-input')?.value.trim() || '')
                .replace(/[-\s]/g, ''),
            idNumber: row.querySelector('.permit-id-input')?.value.trim() || '',
            phone: row.querySelector('.permit-phone-input')?.value.trim() || ''
        })).filter(p => p.name !== '');

        // תאריך לתצוגה
        let dateLabel = dateDisplay;
        const today = new Date();
        const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = `${String(tomorrow.getDate()).padStart(2, '0')}/${String(tomorrow.getMonth() + 1).padStart(2, '0')}/${tomorrow.getFullYear()}`;

        if (dateDisplay === todayStr) dateLabel = `היום (${dateDisplay})`;
        else if (dateDisplay === tomorrowStr) dateLabel = `מחר (${dateDisplay})`;

        // איסוף מחבר
        const authorSelect = document.getElementById('permitAuthor');
        const customAuthorInput = document.getElementById('permitCustomAuthorInput');
        let author = '';

        if (authorSelect) {
            if (authorSelect.value === 'other') {
                author = customAuthorInput?.value.trim() || '';
            } else {
                author = authorSelect.value;
            }
        }

        return {
            sites: selectedSites,
            site: selectedSites.join(' ו'),
            date: dateDisplay,
            dateLabel: dateLabel,
            persons: persons,
            names: persons.map(p => p.name),
            fullName: persons.map(p => p.name).join(', '),
            company: document.getElementById('permitCompany').value.trim(),
            carNumbers: persons.map(p => p.carNumber).filter(c => c !== ''),
            carNumber: persons.map(p => p.carNumber).filter(c => c !== '').join(', '),
            escort: escort,
            time: time || null,
            author: author
        };
    }

    // ========== בניית המייל ==========

    _openEntryPermitEmail(data) {
        // קבל נמענים לפי האתרים שנבחרו
        const sites = data.sites && data.sites.length > 0
            ? data.sites
            : [data.site];

        // איסוף כל הנמענים מכל האתרים
        let allToAddresses = new Set();
        let allCcAddresses = new Set();

        sites.forEach(site => {
            const recipients = this._getEntryPermitRecipients(site);

            // הוסף נמענים TO
            recipients.to.split(';').forEach(email => {
                const trimmed = email.trim();
                if (trimmed) allToAddresses.add(trimmed);
            });

            // הוסף נמענים CC
            recipients.cc.split(';').forEach(email => {
                const trimmed = email.trim();
                if (trimmed) allCcAddresses.add(trimmed);
            });
        });

        // בנה כותרת עם כל האתרים
        let siteDisplay = '';
        if (sites.length > 1) {
            siteDisplay = sites.map(s => s === 'פ"ת' ? `אתר ${s}` : s).join(' ו');
        } else {
            const site = sites[0];
            siteDisplay = site === 'פ"ת' ? `אתר ${site}` : site;
        }

        var subject;

        // בדוק אם dateLabel מתחיל ב"היום" או "מחר"
        const isRelativeDate = data.dateLabel && (
            data.dateLabel.startsWith('היום') ||
            data.dateLabel.startsWith('מחר')
        );

        // שורת פתיחה - "בתאריך" רק אם זה תאריך מספרי בלבד
        if (isRelativeDate) {
            subject = `אישור כניסה ל${data.dateLabel} ב${siteDisplay}`;
        } else {
            subject = `אישור כניסה בתאריך ${data.dateLabel} ב${siteDisplay}`;
        }
        // בנה נתונים עם כל האתרים לגוף המייל
        const emailData = {
            ...data,
            site: siteDisplay
        };

        const body = this._buildEntryPermitEmailBody(emailData);

        const toStr = Array.from(allToAddresses).join(';');
        const ccStr = Array.from(allCcAddresses).join(';');

        this._openEntryPermitOutlookEmail(subject, body, toStr, ccStr);
    }

    _getEntryPermitRecipients(site) {
        // נמענים בהתאם לאתר - מבוסס על המיילים לדוגמה
        const recipientsBySite = {
            'ר"ג': {
                to: 'lobbymenora@menoramivt.co.il;binyaminra@menoramivt.co.il;securityroomusr@menoramivt.co.il',
                cc: 'noc@menoramivt.co.il'
            },
            'פ"ת': {
                to: 'BAKARA@il.ibm.com;HananBD1@kyndryl.com',
                cc: 'noc@menoramivt.co.il'
            }
        };

        return recipientsBySite[site] || { to: '', cc: '' };
    }

    _buildEntryPermitEmailBody(data) {
        let body = 'שלום רב,\n\n';

        // בדוק אם dateLabel מתחיל ב"היום" או "מחר"
        const isRelativeDate = data.dateLabel && (
            data.dateLabel.startsWith('היום') ||
            data.dateLabel.startsWith('מחר')
        );

        // שורת פתיחה - "בתאריך" רק אם זה תאריך מספרי בלבד
        if (isRelativeDate) {
            body += `נא לאשר כניסה ל${data.dateLabel}`;
        } else {
            body += `נא לאשר כניסה בתאריך ${data.dateLabel}`;
        }

        if (data.time) body += ` בשעה ${data.time}`;
        body += ` ל${data.site}:\n\n`;

        // חברה
        body += `חברה    : ${data.company}\n\n`;

        // אנשים
        if (data.persons && data.persons.length > 0) {

            if (data.persons.length === 1) {
                const p = data.persons[0];
                body += `שם      : ${p.name}\n`;

                if (p.idNumber && p.idNumber.trim() !== '')
                    body += `ת.ז.    : ${p.idNumber}\n`;

                if (p.carNumber && p.carNumber.trim() !== '')
                    body += `מס' רכב : ${p.carNumber}\n`;

                if (p.phone && p.phone.trim() !== '')
                    body += `טלפון   : ${p.phone}\n`;

                body += '\n';

            } else {
                body += `שמות    :\n\n`;

                data.persons.forEach((p, i) => {
                    body += `  ${i + 1}.\tשם      : ${p.name}\n`;

                    if (p.idNumber && p.idNumber.trim() !== '')
                        body += `\t\tת.ז.    : ${p.idNumber}\n`;

                    if (p.carNumber && p.carNumber.trim() !== '')
                        body += `\t\tמס' רכב : ${p.carNumber}\n`;

                    if (p.phone && p.phone.trim() !== '')
                        body += `\t\tטלפון   : ${p.phone}\n`;

                    body += '\n';
                });
            }
        }

        if (data.escort) {
            body += `מלווה   : ${data.escort}\n\n`;
        }

        body += 'נא לאשר כניסה וחניה.\n\nתודה.';

        return body;
    }

    _openEntryPermitOutlookEmail(subject, body, to, cc) {
        try {
            const boundary = `----=_EntryPermit_${Date.now()}`;
            const htmlBody = this._buildEntryPermitHtmlEmail(body);

            let emlContent = `X-Unsent: 1
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="${boundary}"
To: ${to}`;

            if (cc) {
                emlContent += `\nCc: ${cc}`;
            }

            emlContent += `
Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=

--${boundary}
Content-Type: text/plain; charset=UTF-8

${body}

--${boundary}
Content-Type: text/html; charset=UTF-8

${htmlBody}

--${boundary}--`;

            const blob = new Blob([emlContent], { type: 'message/rfc822' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `אישור_כניסה_${subject.replace(/[^א-תa-zA-Z0-9]/g, '_')}.eml`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 2000);

            // הצג הנחיות
            setTimeout(() => {
                this.showEmailInstructionsModal();
            }, 1500);

            NotificationManager.show('קובץ המייל הורד - פתח אותו לשליחה ב-Outlook', 'success');

        } catch (error) {
            console.error('Error creating entry permit email:', error);
            NotificationManager.show('שגיאה ביצירת המייל', 'error');
        }
    }

    _buildEntryPermitHtmlEmail(plainBody) {
        const lines = plainBody.split('\n');
        let htmlLines = '';

        lines.forEach((line, index) => {
            // שורה ריקה לחלוטין - רווח גדול
            if (line.trim() === '') {
                htmlLines += `<div style="height:12px; line-height:12px;">&nbsp;</div>`;
                return;
            }

            // זיהוי רמת הכניסה לפי tabs
            const tabCount = (line.match(/^\t+/) || [''])[0].length;
            const trimmed = line.replace(/^\t+/, '').trim();
            const paddingRight = tabCount * 25;

            // שורת מספור (1. 2. וכו')
            if (/^\s*\d+\.\s/.test(line)) {
                htmlLines += `
                <div style="
                    padding: 4px 0 4px ${paddingRight}px;
                    font-weight: bold;
                    color: #222;
                    line-height: 1.6;
                ">
                    ${trimmed}
                </div>`;
                return;
            }

            // שורות עם נקודותיים - שדות נתונים
            if (trimmed.includes(':')) {
                const colonIdx = trimmed.indexOf(':');
                const label = trimmed.substring(0, colonIdx).trim();
                const value = trimmed.substring(colonIdx + 1).trim();

                const knownLabels = [
                    'שם', 'שמות', 'חברה', "מס' רכב",
                    'ת.ז.', 'מלווה', 'טלפון'
                ];
                const isKnownLabel = knownLabels.some(l => label.trim() === l);

                if (isKnownLabel) {
                    htmlLines += `
                    <div style="
                        padding: 4px 0 4px ${paddingRight}px;
                        line-height: 1.6;
                    ">
                        <span style="
                            font-weight: bold;
                            color: #444;
                            display: inline-block;
                            min-width: 90px;
                        ">${label}:</span>
                        <span style="
                            color: #222;
                            margin-right: 8px;
                        ">${value}</span>
                    </div>`;
                    return;
                }
            }

            // שורה רגילה (שלום רב, נא לאשר וכו')
            htmlLines += `
            <div style="
                padding: 4px 0 4px ${paddingRight}px;
                color: #333;
                line-height: 1.6;
            ">
                ${trimmed}
            </div>`;
        });

        return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>
<body style="
    margin: 0;
    padding: 25px 30px;
    font-family: Arial, sans-serif;
    direction: rtl;
    font-size: 14px;
    color: #333;
    line-height: 1.8;
    background: #ffffff;
">
    <div style="max-width: 600px;">
        ${htmlLines}
    </div>
</body>
</html>`;
    }

    // ========== ייצוא היסטוריית אישורי כניסה ==========

    exportPermitHistoryToExcel() {
        const permits = this._allPermitsForHistory;
        if (!permits || permits.length === 0) {
            NotificationManager.show('אין נתונים לייצוא', 'warning');
            return;
        }

        try {
            // בניית נתוני הטבלה
            const headers = [
                'תאריך בקשה',
                'תאריך כניסה',
                'שעה',
                'אתר',
                'שם',
                'חברה',
                "מס' רכב",
                'ת"ז',
                'טלפון',
                'מלווה'
            ];

            const dataRows = [];

            permits.forEach(message => {
                const data = message.entryPermitData ||
                    this._extractPermitDataFromMessage(message) || {};

                const siteDisplay = (Array.isArray(data.Sites) && data.Sites.length > 1)
                    ? data.Sites.join(' + ')
                    : (data.Site || data.site || '-');

                const requestDate = new Date(message.date)
                    .toLocaleDateString('he-IL');
                const timeDisplay = data.Time || data.time || '';
                const escortDisplay = data.Escort || data.escort || '';
                const companyDisplay = data.Company || data.company || '';
                const dateDisplay = data.Date || data.date || '';

                const persons = this._getPersonsFromData(data);

                if (persons.length === 0) {
                    dataRows.push([
                        requestDate, dateDisplay, timeDisplay,
                        siteDisplay, '', companyDisplay,
                        '', '', '', escortDisplay
                    ]);
                } else {
                    persons.forEach(person => {
                        dataRows.push([
                            requestDate, dateDisplay, timeDisplay,
                            siteDisplay,
                            person.name || '',
                            companyDisplay,
                            person.carNumber || '',
                            person.idNumber || '',
                            person.phone || '',
                            escortDisplay
                        ]);
                    });
                }
            });

            // ========== בניית XLSX ידני ==========
            const xlsxBlob = this._buildXlsxBlob(headers, dataRows);

            // הורדה
            const url = URL.createObjectURL(xlsxBlob);
            const a = document.createElement('a');
            a.href = url;

            const now = new Date();
            const dateStr = `${now.getDate()}-${now.getMonth() + 1}-${now.getFullYear()}`;
            a.download = `היסטוריית_אישורי_כניסה_${dateStr}.xlsx`;
            a.style.display = 'none';

            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 2000);

            NotificationManager.show(
                `הקובץ יוצא בהצלחה (${permits.length} בקשות)`,
                'success'
            );

        } catch (error) {
            console.error('Error exporting permit history to Excel:', error);
            NotificationManager.show('שגיאה בייצוא הקובץ', 'error');
        }
    }

    // ========== בניית קובץ XLSX ללא ספריות חיצוניות ==========
    _buildXlsxBlob(headers, dataRows) {

        // --- עזר: המרת מחרוזת ל-ArrayBuffer של UTF-16LE ---
        const strToAB = str => {
            const buf = new ArrayBuffer(str.length * 2);
            const view = new Uint16Array(buf);
            for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i);
            return buf;
        };

        // --- עזר: escape XML ---
        const esc = v => String(v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        // --- בניית shared strings ---
        const sharedStrings = [];
        const ssIndex = {};

        const getSS = val => {
            const s = String(val ?? '');
            if (ssIndex[s] === undefined) {
                ssIndex[s] = sharedStrings.length;
                sharedStrings.push(s);
            }
            return ssIndex[s];
        };

        // --- בניית תאי הגיליון ---
        const colLetter = idx => {
            let s = '';
            let n = idx + 1;
            while (n > 0) {
                const r = (n - 1) % 26;
                s = String.fromCharCode(65 + r) + s;
                n = Math.floor((n - 1) / 26);
            }
            return s;
        };

        const allRows = [headers, ...dataRows];
        const colCount = headers.length;
        const rowCount = allRows.length;

        let sheetRows = '';

        allRows.forEach((row, rIdx) => {
            const rowNum = rIdx + 1;
            const isHeader = rIdx === 0;
            let cells = '';

            row.forEach((cell, cIdx) => {
                const col = colLetter(cIdx);
                const cellRef = `${col}${rowNum}`;
                const ssIdx = getSS(cell);

                // סגנון: 1 = כותרת, 0 = רגיל
                const styleId = isHeader ? 1 : 0;

                cells += `<c r="${cellRef}" t="s" s="${styleId}">` +
                    `<v>${ssIdx}</v></c>`;
            });

            sheetRows += `<row r="${rowNum}">${cells}</row>`;
        });

        // רוחב עמודות (בתווים)
        const colWidths = [14, 14, 8, 10, 22, 18, 12, 12, 14, 18];
        let colDefs = '';
        colWidths.forEach((w, i) => {
            colDefs += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
        });

        // ========== קבצי ה-XLSX ==========

        // [Content_Types].xml
        const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/xl/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

        // _rels/.rels
        const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="xl/workbook.xml"/>
</Relationships>`;

        // xl/_rels/workbook.xml.rels
        const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
    Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"
    Target="sharedStrings.xml"/>
  <Relationship Id="rId3"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`;

        // xl/workbook.xml
        const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="אישורי כניסה" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

        // xl/sharedStrings.xml
        const ssItems = sharedStrings
            .map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
            .join('');

        const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
     count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
  ${ssItems}
</sst>`;

        // xl/styles.xml  (סגנון 0=רגיל, 1=כותרת מודגשת עם רקע)
        const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font>
      <sz val="11"/>
      <name val="Arial"/>
    </font>
    <font>
      <b/>
      <sz val="11"/>
      <color rgb="FFFFFFFF"/>
      <name val="Arial"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FF667EEA"/>
      </patternFill>
    </fill>
  </fills>
  <borders count="2">
    <border>
      <left/><right/><top/><bottom/><diagonal/>
    </border>
    <border>
      <left  style="thin"><color rgb="FFCCCCCC"/></left>
      <right style="thin"><color rgb="FFCCCCCC"/></right>
      <top   style="thin"><color rgb="FFCCCCCC"/></top>
      <bottom style="thin"><color rgb="FFCCCCCC"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1"
        xfId="0" applyFont="1" applyFill="1" applyBorder="1">
      <alignment horizontal="right" vertical="center" readingOrder="2"/>
    </xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1"
        xfId="0" applyFont="1" applyFill="1" applyBorder="1">
      <alignment horizontal="center" vertical="center" readingOrder="2"/>
    </xf>
  </cellXfs>
</styleSheet>`;

        // xl/worksheets/sheet1.xml
        const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetView workbookViewId="0" rightToLeft="1"/>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colDefs}</cols>
  <sheetData>${sheetRows}</sheetData>
  <autoFilter ref="A1:${colLetter(colCount - 1)}1"/>
</worksheet>`;

        // ========== אריזה ל-ZIP (XLSX) ידנית ==========
        return this._packZip({
            '[Content_Types].xml': contentTypes,
            '_rels/.rels': rels,
            'xl/_rels/workbook.xml.rels': wbRels,
            'xl/workbook.xml': workbook,
            'xl/sharedStrings.xml': sharedStringsXml,
            'xl/styles.xml': styles,
            'xl/worksheets/sheet1.xml': sheet
        });
    }

    // ========== ZIP packer מינימלי (Deflate-store) ==========
    _packZip(files) {

        // CRC-32 table
        const crcTable = (() => {
            const t = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++)
                    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[i] = c;
            }
            return t;
        })();

        const crc32 = bytes => {
            let crc = 0xFFFFFFFF;
            for (let i = 0; i < bytes.length; i++)
                crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
            return (crc ^ 0xFFFFFFFF) >>> 0;
        };

        const enc = new TextEncoder();
        const parts = [];
        const central = [];
        let offset = 0;

        const u32 = n => {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setUint32(0, n, true);
            return b;
        };
        const u16 = n => {
            const b = new Uint8Array(2);
            new DataView(b.buffer).setUint16(0, n, true);
            return b;
        };

        for (const [name, content] of Object.entries(files)) {
            const nameBytes = enc.encode(name);
            const dataBytes = enc.encode(content);
            const crc = crc32(dataBytes);
            const size = dataBytes.length;

            // Local file header
            const local = new Uint8Array([
                0x50, 0x4B, 0x03, 0x04,   // signature
                0x14, 0x00,             // version needed
                0x00, 0x00,             // flags
                0x00, 0x00,             // compression (store)
                0x00, 0x00,             // mod time
                0x00, 0x00,             // mod date
                ...u32(crc),
                ...u32(size),
                ...u32(size),
                ...u16(nameBytes.length),
                0x00, 0x00,             // extra length
                ...nameBytes
            ]);

            parts.push(local, dataBytes);

            // Central directory entry
            central.push({
                nameBytes,
                crc,
                size,
                offset
            });

            offset += local.length + size;
        }

        // Central directory
        const cdParts = central.map(e => new Uint8Array([
            0x50, 0x4B, 0x01, 0x02,   // signature
            0x14, 0x00,             // version made by
            0x14, 0x00,             // version needed
            0x00, 0x00,             // flags
            0x00, 0x00,             // compression
            0x00, 0x00,             // mod time
            0x00, 0x00,             // mod date
            ...u32(e.crc),
            ...u32(e.size),
            ...u32(e.size),
            ...u16(e.nameBytes.length),
            0x00, 0x00,             // extra
            0x00, 0x00,             // comment
            0x00, 0x00,             // disk start
            0x00, 0x00,             // int attr
            0x00, 0x00, 0x00, 0x00,   // ext attr
            ...u32(e.offset),
            ...e.nameBytes
        ]));

        const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
        const cdOffset = offset;

        // End of central directory
        const eocd = new Uint8Array([
            0x50, 0x4B, 0x05, 0x06,
            0x00, 0x00,
            0x00, 0x00,
            ...u16(central.length),
            ...u16(central.length),
            ...u32(cdSize),
            ...u32(cdOffset),
            0x00, 0x00
        ]);

        // חיבור הכל
        const all = [...parts, ...cdParts, eocd];
        const total = all.reduce((s, p) => s + p.length, 0);
        const buf = new Uint8Array(total);
        let pos = 0;

        for (const p of all) {
            buf.set(p, pos);
            pos += p.length;
        }

        return new Blob(
            [buf],
            { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        );
    }

    printPermitHistory() {
        const permits = this._allPermitsForHistory;
        if (!permits || permits.length === 0) {
            NotificationManager.show('אין נתונים להדפסה', 'warning');
            return;
        }

        try {
            // חישוב סה"כ אנשים
            let totalPersons = 0;
            permits.forEach(m => {
                const data = m.entryPermitData ||
                    this._extractPermitDataFromMessage(m) || {};
                const persons = this._getPersonsFromData(data);
                totalPersons += persons.length || 1;
            });

            // בניית תוכן HTML להדפסה
            let tableRows = '';

            permits.forEach(message => {
                const data = message.entryPermitData ||
                    this._extractPermitDataFromMessage(message) || {};

                const siteDisplay = (Array.isArray(data.Sites) && data.Sites.length > 1)
                    ? data.Sites.join(' + ')
                    : (data.Site || '-');

                const requestDate = new Date(message.date)
                    .toLocaleDateString('he-IL');
                const timeDisplay = data.Time || data.time || '-';
                const escortDisplay = data.Escort || data.escort || '-';
                const companyDisplay = data.Company || data.company || '-';
                const dateDisplay = data.Date || data.date || '-';

                const persons = this._getPersonsFromData(data);

                if (persons.length === 0) {
                    tableRows += `
                <tr>
                    <td>${requestDate}</td>
                    <td><strong>${dateDisplay}</strong></td>
                    <td>${timeDisplay}</td>
                    <td>${siteDisplay}</td>
                    <td>-</td>
                    <td>${companyDisplay}</td>
                    <td>-</td>
                    <td>-</td>
                    <td>-</td>
                    <td>${escortDisplay}</td>
                </tr>`;
                } else {
                    persons.forEach((person, personIndex) => {
                        const isFirst = personIndex === 0;
                        const rowspan = persons.length;

                        tableRows += `<tr>`;

                        if (isFirst) {
                            tableRows += `
                        <td rowspan="${rowspan}"
                            style="vertical-align:middle; background:#fafbff;">
                            ${requestDate}
                        </td>
                        <td rowspan="${rowspan}"
                            style="vertical-align:middle; background:#fafbff;">
                            <strong>${dateDisplay}</strong>
                        </td>
                        <td rowspan="${rowspan}"
                            style="vertical-align:middle; background:#fafbff;">
                            ${timeDisplay}
                        </td>
                        <td rowspan="${rowspan}"
                            style="vertical-align:middle; background:#fafbff;">
                            ${siteDisplay}
                        </td>`;
                        }

                        tableRows += `
                    <td>${personIndex + 1}. ${person.name || '-'}</td>`;

                        if (isFirst) {
                            tableRows += `
                        <td rowspan="${rowspan}"
                            style="vertical-align:middle; background:#fafbff;">
                            ${companyDisplay}
                        </td>`;
                        }

                        tableRows += `
                    <td dir="rtl">${person.carNumber || '-'}</td>
                    <td dir="rtl">${person.idNumber || '-'}</td>
                    <td dir="rtl">${person.phone || '-'}</td>`;

                        if (isFirst) {
                            tableRows += `
                        <td rowspan="${rowspan}"
                            style="vertical-align:middle; background:#fafbff;">
                            ${escortDisplay}
                        </td>`;
                        }

                        tableRows += `</tr>`;
                    });
                }
            });

            const now = new Date();
            const printDateStr = now.toLocaleDateString('he-IL') +
                ' ' + now.toLocaleTimeString('he-IL');

            const printContent = `
        <!DOCTYPE html>
        <html dir="rtl" lang="he">
        <head>
            <meta charset="UTF-8">
            <title>היסטוריית אישורי כניסה</title>
            <style>
                @page {
                    size: A4 landscape;
                    margin: 1.5cm;
                }

                * {
                    box-sizing: border-box;
                }

                body {
                    font-family: Arial, sans-serif;
                    direction: rtl;
                    font-size: 11px;
                    color: #222;
                    margin: 0;
                    padding: 0;
                }

                .print-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 15px;
                    padding-bottom: 10px;
                    border-bottom: 2px solid #667eea;
                }

                .print-title {
                    font-size: 18px;
                    font-weight: bold;
                    color: #333;
                }

                .print-subtitle {
                    font-size: 12px;
                    color: #666;
                    margin-top: 4px;
                }

                .print-meta {
                    text-align: left;
                    font-size: 10px;
                    color: #888;
                }

                .summary-bar {
                    display: flex;
                    gap: 20px;
                    margin-bottom: 12px;
                    padding: 8px 12px;
                    background: #f0f4ff;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    color: #444;
                }

                table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 10.5px;
                    page-break-inside: auto;
                }

                thead {
                    display: table-header-group;
                }

                thead tr {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }

                th {
                    padding: 8px 6px;
                    text-align: right;
                    font-weight: 600;
                    white-space: nowrap;
                    border: 1px solid #5a6fd6;
                }

                td {
                    padding: 6px;
                    border: 1px solid #ddd;
                    vertical-align: top;
                }

                tr {
                    page-break-inside: avoid;
                }

                tbody tr:nth-child(even) td:not([rowspan]) {
                    background-color: #f9f9ff;
                }

                tbody tr:hover td {
                    background-color: #f0f4ff;
                }

                .group-border-top td {
                    border-top: 2px solid #c8d6f5 !important;
                }

                .print-footer {
                    margin-top: 15px;
                    padding-top: 8px;
                    border-top: 1px solid #ddd;
                    font-size: 9px;
                    color: #999;
                    display: flex;
                    justify-content: space-between;
                }

                @media print {
                    body { margin: 0; }
                    .no-print { display: none !important; }
                }
            </style>
        </head>
        <body>
            <div class="print-header">
                <div>
                    <div class="print-title">
                        📋 היסטוריית אישורי כניסה
                    </div>
                    <div class="print-subtitle">
                        NOC Portal - מערכת ניהול הודעות
                    </div>
                </div>
                <div class="print-meta">
                    <div>הופק: ${printDateStr}</div>
                </div>
            </div>

            <div class="summary-bar">
                <span>📊 סה"כ בקשות: ${permits.length}</span>
                <span>👥 סה"כ אנשים: ${totalPersons}</span>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>תאריך בקשה</th>
                        <th>תאריך כניסה</th>
                        <th>שעה</th>
                        <th>אתר</th>
                        <th>שם</th>
                        <th>חברה</th>
                        <th>מס' רכב</th>
                        <th>ת"ז</th>
                        <th>טלפון</th>
                        <th>מלווה</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>

            <div class="print-footer">
                <span>NOC Portal - מערכת ניהול הודעות</span>
                <span>הופק בתאריך: ${printDateStr}</span>
                <span>סה"כ ${permits.length} בקשות | ${totalPersons} אנשים</span>
            </div>

            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>`;

            // פתח חלון הדפסה
            const printWindow = window.open('', '_blank', 'width=1200,height=800');
            if (!printWindow) {
                NotificationManager.show(
                    'אנא אפשר חלונות קופצים בדפדפן',
                    'warning'
                );
                return;
            }

            printWindow.document.open();
            printWindow.document.write(printContent);
            printWindow.document.close();

            NotificationManager.show('מכין להדפסה...', 'info');

        } catch (error) {
            console.error('Error printing permit history:', error);
            NotificationManager.show('שגיאה בהדפסה', 'error');
        }
    }

    // ========== CSS ==========

    _addEntryPermitStyles() {
        if (document.getElementById('entryPermitStyles')) return;

        const style = document.createElement('style');
        style.id = 'entryPermitStyles';
        style.textContent = `
        /* מודל אישור כניסה */
        .entry-permit-modal {
            max-width: 1200px;
            width: 95%;
            max-height: 90vh;
            overflow-y: auto;
            border-radius: 12px;
        }

        .entry-permit-modal .modal-header {
            padding-bottom: 5px;
        }

        .entry-permit-modal .modal-body {
            padding: 2px 25px;
        }

        .entry-permit-modal .form-group {
            margin-bottom: 18px;
        }

        .entry-permit-modal .form-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            margin-bottom: 6px;
            color: #333;
            font-size: 0.95rem;
        }

        .entry-permit-modal .form-label i {
            color: #667eea;
            width: 16px;
        }

        .required-field::after {
            content: ' *';
            color: #e53e3e;
            font-weight: bold;
        }

        .optional-label {
            font-weight: normal;
            color: #888;
            font-size: 0.85rem;
        }

        .entry-permit-modal .form-input {
            width: 100%;
            padding: 10px 12px;
            border: 1.5px solid #ddd;
            border-radius: 8px;
            font-size: 0.95rem;
            transition: border-color 0.2s, box-shadow 0.2s;
            box-sizing: border-box;
            font-family: inherit;
        }

        .entry-permit-modal .form-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
        }

        .entry-permit-modal .form-input.input-error {
            border-color: #e53e3e;
            box-shadow: 0 0 0 3px rgba(229, 62, 62, 0.15);
        }

        .entry-permit-modal .form-help {
            display: block;
            color: #888;
            font-size: 0.8rem;
            margin-top: 4px;
        }

        /* בחירת אתר */
        .site-selector {
            display: flex;
            gap: 12px;
        }

        .site-option {
            cursor: pointer;
        }

        .site-option input[type="radio"] {
            display: none;
        }

        .site-btn {
            display: inline-block;
            padding: 10px 28px;
            border: 2px solid #ddd;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            background: #f8f9fa;
            color: #555;
            user-select: none;
        }

        .site-btn:hover {
            border-color: #667eea;
            color: #667eea;
            background: #f0f2ff;
        }

        .site-option input[type="radio"]:checked + .site-btn,
        .site-btn.selected {
            border-color: #667eea;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            box-shadow: 0 3px 10px rgba(102, 126, 234, 0.35);
        }

        /* שגיאות */
        .field-error {
            display: flex;
            align-items: center;
            gap: 5px;
            color: #e53e3e;
            font-size: 0.82rem;
            margin-top: 5px;
            padding: 4px 8px;
            background: #fff5f5;
            border-radius: 4px;
            border-right: 3px solid #e53e3e;
        }

        /* שגיאת שדה inline */
        .inline-field-error {
            display: flex;
            align-items: center;
            gap: 4px;
            color: #e53e3e;
            font-size: 0.78rem;
            margin-top: 3px;
            padding: 3px 8px;
            background: #fff5f5;
            border-radius: 4px;
            border-right: 3px solid #e53e3e;
            animation: fadeInError 0.2s ease;
        }

        .inline-field-error i {
            flex-shrink: 0;
            font-size: 0.75rem;
        }

        @keyframes fadeInError {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0);    }
        }

        /* הדגשת שדה עם שגיאה */
        .entry-permit-modal .form-input.input-error {
            border-color: #e53e3e !important;
            box-shadow: 0 0 0 3px rgba(229, 62, 62, 0.15) !important;
            background-color: #fff8f8;
        }

        /* אנימציית רעידה לשגיאה */
        .entry-permit-modal .form-input.input-error {
            animation: shakeField 0.35s ease;
        }

        @keyframes shakeField {
            0%,100% { transform: translateX(0);  }
            20%     { transform: translateX(-5px); }
            40%     { transform: translateX(5px);  }
            60%     { transform: translateX(-3px); }
            80%     { transform: translateX(3px);  }
        }
        .field-error i {
            flex-shrink: 0;
        }

        /* date input wrapper */
        .date-input-wrapper {
            position: relative;
        }

        .date-input-wrapper .form-input {
            cursor: pointer;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23667eea' stroke-width='2'%3E%3Crect x='3' y='4' width='18' height='18' rx='2' ry='2'%3E%3C/rect%3E%3Cline x1='16' y1='2' x2='16' y2='6'%3E%3C/line%3E%3Cline x1='8' y1='2' x2='8' y2='6'%3E%3C/line%3E%3Cline x1='3' y1='10' x2='21' y2='10'%3E%3C/line%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: left 12px center;
            padding-left: 38px;
        }

        /* footer */
        .entry-permit-modal .modal-footer {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            padding: 15px 25px;
            border-top: 1px solid #eee;
            background: #f8f9fa;
            border-radius: 0 0 12px 12px;
        }

        /* שורת אדם - כל השדות בשורה אחת */
        .person-row {
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .person-inline-fields {
            display: flex;
            flex: 1;
            gap: 8px;
            align-items: center;
            flex-wrap: nowrap;  /* שמור הכל בשורה אחת */
        }

        /* רוחב כל שדה בשורה */
        .person-inline-fields .permit-name-input {
            flex: 2.5;          /* שם - הכי רחב */
            min-width: 130px;
        }

        .person-inline-fields .permit-car-input {
            flex: 1.2;          /* רכב */
            min-width: 90px;
        }

        .person-inline-fields .permit-id-input {
            flex: 1;            /* ת"ז */
            min-width: 80px;
        }

        .person-inline-fields .permit-phone-input {
            flex: 1.3;          /* טלפון */
            min-width: 95px;
        }

        /* כותרות עמודות מעל השורה הראשונה */
        .person-columns-header {
            display: flex;
            gap: 8px;
            margin-bottom: 4px;
            padding-right: 0;
        }

        .person-col-label {
            font-size: 0.78rem;
            color: #888;
            font-weight: 600;
        }

        .person-col-label.col-name    { flex: 1.7; width: 95px;}
        .person-col-label.col-car     { flex: 1.7; width: 95px;  }
        .person-col-label.col-id      { flex: 1.7;   width: 95px;  }
        .person-col-label.col-phone   { flex: 1.7; width: 95px;  }

        /* מסך קטן - עבור לעמודות */
        @media (max-width: 560px) {
            .person-inline-fields {
                flex-wrap: wrap;  /* במסך קטן - ירד לשורה */
            }

            .person-inline-fields .permit-name-input {
                flex: 1 1 100%;   /* שם - שורה שלמה */
            }

            .person-inline-fields .permit-car-input,
            .person-inline-fields .permit-id-input,
            .person-inline-fields .permit-phone-input {
                flex: 1 1 calc(33% - 8px);  /* שלושה בשורה */
            }

            .person-columns-header {
                display: none;  /* הסתר כותרות במסך קטן */
            }
        }

        /* responsive */
        @media (max-width: 480px) {
            .entry-permit-modal {
                width: 100%;
                max-height: 100vh;
                border-radius: 12px 12px 0 0;
                margin-top: auto;
            }

            .site-selector {
                flex-direction: row;
            }

            .site-btn {
                padding: 10px 20px;
            }
        }

        #permitDateHidden{
            visibility: hidden;
        }

        /* תצוגת כרטיס אישור כניסה */
        .entry-permit-preview {
            padding: 8px 0;
        }

        .permit-field {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            font-size: 0.9rem;
            color: #444;
        }

        .permit-field i {
            color: #667eea;
            width: 14px;
            flex-shrink: 0;
        }
        /* שורות דינמיות */
        .multi-entry-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .multi-entry-row .form-input {
            flex: 1;
            margin-bottom: 0;
        }

        .remove-entry-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 32px;
            min-width: 32px;
            background: #fff5f5;
            border: 1.5px solid #feb2b2;
            border-radius: 6px;
            color: #e53e3e;
            cursor: pointer;
            transition: all 0.2s;
            padding: 0;
            flex-shrink: 0;
        }

        .remove-entry-btn:hover {
            background: #fed7d7;
            border-color: #e53e3e;
        }

        .add-entry-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            background: #f0f4ff;
            border: 1.5px dashed #667eea;
            border-radius: 7px;
            color: #667eea;
            font-size: 0.88rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 4px;
            font-family: inherit;
        }

        .add-entry-btn:hover {
            background: #e8edff;
            border-style: solid;
        }

        /* checkbox אתר */
        .site-option input[type="checkbox"] {
            display: none;
        }

        .site-option input[type="checkbox"]:checked + .site-btn,
        .site-btn.selected {
            border-color: #667eea;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            box-shadow: 0 3px 10px rgba(102, 126, 234, 0.35);
        }

        /* כפתורי footer */
        .history-footer-actions {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .btn-success {
            background: linear-gradient(135deg, #38a169, #276749);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .btn-success:hover {
            background: linear-gradient(135deg, #276749, #1e4d35);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(56, 161, 105, 0.35);
        }

        .btn-info {
            background: linear-gradient(135deg, #3182ce, #2b6cb0);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .btn-info:hover {
            background: linear-gradient(135deg, #2b6cb0, #1a4a8a);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(49, 130, 206, 0.35);
        }

        /* footer עם כפתורים */
        .entry-permit-history-modal .modal-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 20px;
            border-top: 1px solid #eee;
            background: #f8f9fa;
            border-radius: 0 0 12px 12px;
            flex-wrap: wrap;
            gap: 10px;
        }
    `;
        document.head.appendChild(style);
    }
}

// Toggle Filter Tabs
function toggleFilterTabs() {
    const content = document.getElementById('filterTabsContent');
    const btn = document.getElementById('filterCollapseBtn');

    content.classList.toggle('collapsed');
    btn.classList.toggle('collapsed');

    // Save state to localStorage
    const isCollapsed = content.classList.contains('collapsed');
    localStorage.setItem('messagesFiltersSectionCollapsed', isCollapsed);
}