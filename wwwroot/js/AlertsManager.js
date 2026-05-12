class AlertsManager {
    constructor() {
        this.alerts = [];
        this.filteredAlerts = [];
        this.searchTerm = "";
        this.colorMode = this.loadFromLocalStorage('alertsColorMode') || 'background'; // ערכים אפשריים: 'background' | 'text-light' | 'text-dark'

        // טעינת הסינונים מה-localStorage אם קיימים
        this.severityFilters = this.loadFromLocalStorage('alertsSeverityFilters') || ['CRITICAL', 'MAJOR', 'UNKNOWN'];
        this.statusFilters = this.loadFromLocalStorage('alertsStatusFilters') || ['OPEN', 'ACK', 'ASSIGN'];

        this.selectedAlerts = []; // מערך לשמירת התראות נבחרות
        this.isCtrlPressed = false; // מעקב אחר מצב מקש CTRL
        this.isShiftPressed = false; // מעקב אחר מצב מקש SHIFT
        this.lastSelectedAlertId = null; // שמירת ההתראה האחרונה שנבחרה
        this.isFullscreenMode = false;
        this.sortColumn = this.isFullscreenMode ? null : (this.loadFromLocalStorage('alertsSortColumn') || null); // עמודה נוכחית למיון
        this.sortDirection = this.isFullscreenMode ? 'asc' : (this.loadFromLocalStorage('alertsSortDirection') || 'asc'); // כיוון מיון: 'asc' או 'desc'

        this.columnOrder = this.loadFromLocalStorage('alertsColumnOrder') || [
            'hostAddress', 'modified', 'notes', 'message', 'host',
            'email', 'contacts', 'timestamp', 'priority', 'severity', 'status', 'actions', 'checkbox'
        ];

        this.visibleColumns = this.loadFromLocalStorage('alertsVisibleColumns') || {
            hostAddress: true,
            modified: true,
            notes: true,
            message: true,
            host: true,
            email: true,
            contacts: true,
            timestamp: true,
            priority: true,
            severity: true,
            status: true,
            actions: true,
            checkbox: true
        };
    }

    // פונקציה לטעינת נתונים מ-localStorage
    loadFromLocalStorage(key) {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error(`Error loading ${key} from localStorage:`, error);
            return null;
        }
    }

    // פונקציה לשמירת נתונים ב-localStorage
    saveToLocalStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error(`Error saving ${key} to localStorage:`, error);
        }
    }

    // הוספת פונקציות חדשות לניהול תצוגת המסך
    async initialize() {
        try {
            if (!this.isFullscreenMode) {
                // מציג את סקשן ההתראות רק אם לא במצב מסך מלא
                this.showAlertsSection();
                this.colorMode = this.loadFromLocalStorage('alertsColorMode') || 'background';
            } else {
                this.colorMode = this.loadFromLocalStorage('dashboardColorMode') || 'background';
            }
            this.updateBulkActionsBar();
            // הוסף מאזינים לאירועים רק אם האלמנטים קיימים
            const searchInput = document.getElementById('alertSearchInput');
            const clearSearchBtn = document.getElementById('clearAlertSearch');

            if (searchInput) {
                // הגדר את ערך החיפוש השמור
                searchInput.value = this.searchTerm;

                searchInput.addEventListener('input', (e) => {
                    this.searchTerm = e.target.value;
                    this.applyFilters();
                    // הצג או הסתר את כפתור הניקוי בהתאם לתוכן שדה החיפוש
                    if (clearSearchBtn) {
                        clearSearchBtn.style.display = e.target.value ? 'flex' : 'none';
                    }

                    // בדוק אם הסינון הפעיל השתנה
                    this.savedFiltersManager?.checkAndClearIfModified();
                });
            }

            // הוסף מאזין לכפתור הניקוי
            if (clearSearchBtn) {
                clearSearchBtn.addEventListener('click', () => {
                    if (searchInput) {
                        searchInput.value = '';
                        this.searchTerm = '';
                        this.applyFilters();
                        clearSearchBtn.style.display = 'none';

                        // התמקד בשדה החיפוש אחרי הניקוי
                        searchInput.focus();
                    }
                    // בדוק אם הסינון הפעיל השתנה
                    this.savedFiltersManager?.checkAndClearIfModified();
                });
            }

            // עדכון מצב כפתורי סינון חומרה לפי הערכים השמורים
            const severityFilterButtons = document.querySelectorAll('.severity-filter-btn');
            if (severityFilterButtons.length > 0) {
                severityFilterButtons.forEach(btn => {
                    // הוסף צ'קבוקס לכל כפתור
                    const checkbox = document.createElement('span');
                    checkbox.className = 'filter-checkbox';
                    btn.prepend(checkbox);

                    const value = btn.getAttribute('data-value');

                    // הגדר את מצב הכפתור לפי הערכים השמורים
                    if (this.severityFilters.includes(value)) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }

                    btn.addEventListener('click', (e) => {
                        btn.classList.toggle('active');

                        if (btn.classList.contains('active')) {
                            // הוסף את הערך לרשימת הפילטרים אם הוא לא קיים כבר
                            if (!this.severityFilters.includes(value)) {
                                this.severityFilters.push(value);
                            }
                        } else {
                            // הסר את הערך מרשימת הפילטרים
                            this.severityFilters = this.severityFilters.filter(v => v !== value);
                        }

                        // שמור את הפילטרים המעודכנים ב-localStorage
                        this.saveToLocalStorage('alertsSeverityFilters', this.severityFilters);
                        this.applyFilters();

                        // בדוק אם הסינון הפעיל השתנה
                        this.savedFiltersManager?.checkAndClearIfModified();
                    });
                });
            }

            // עדכון מצב כפתורי סינון סטטוס לפי הערכים השמורים
            const statusFilterButtons = document.querySelectorAll('.status-filter-btn');
            if (statusFilterButtons.length > 0) {
                statusFilterButtons.forEach(btn => {
                    // הוסף צ'קבוקס לכל כפתור
                    const checkbox = document.createElement('span');
                    checkbox.className = 'filter-checkbox';
                    btn.prepend(checkbox);

                    const value = btn.getAttribute('data-value');

                    // הגדר את מצב הכפתור לפי הערכים השמורים
                    if (this.statusFilters.includes(value)) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }

                    btn.addEventListener('click', (e) => {
                        btn.classList.toggle('active');

                        if (btn.classList.contains('active')) {
                            // הוסף את הערך לרשימת הפילטרים אם הוא לא קיים כבר
                            if (!this.statusFilters.includes(value)) {
                                this.statusFilters.push(value);
                            }
                        } else {
                            // הסר את הערך מרשימת הפילטרים
                            this.statusFilters = this.statusFilters.filter(v => v !== value);
                        }

                        // שמור את הפילטרים המעודכנים ב-localStorage
                        this.saveToLocalStorage('alertsStatusFilters', this.statusFilters);
                        this.applyFilters();

                        // בדוק אם הסינון הפעיל השתנה
                        this.savedFiltersManager?.checkAndClearIfModified();
                    });
                });
            }

            // הוספת מאזינים למקשי המקלדת
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Control') {
                    this.isCtrlPressed = true;
                }
                if (e.key === 'Shift') {
                    this.isShiftPressed = true;
                }
            });

            document.addEventListener('keyup', (e) => {
                if (e.key === 'Control') {
                    this.isCtrlPressed = false;
                }
                if (e.key === 'Shift') {
                    this.isShiftPressed = false;
                }
            });

            // ==========================================
            // אתחול מנהל הסינונים השמורים
            // ==========================================
            try {
                if (typeof SavedFiltersManager === 'undefined') {
                    await new Promise((resolve) => {
                        const script = document.createElement('script');
                        script.src = '/js/SavedFiltersManager.js';
                        script.onload = resolve;
                        script.onerror = resolve; // המשך גם אם נכשל
                        document.head.appendChild(script);
                    });
                }

                if (typeof SavedFiltersManager !== 'undefined') {
                    this.savedFiltersManager = new SavedFiltersManager(this);
                    this.savedFiltersManager.injectStyles();
                    await this.savedFiltersManager.initialize();
                }
            } catch (sfError) {
                console.warn('SavedFiltersManager failed to load:', sfError);
            }

            // ==========================================
            // הוספת כפתורים ב-2 שורות ל-alerts-controls
            // ==========================================
            const alertsControls = document.querySelector('.alerts-controls');
            if (alertsControls && !this.isFullscreenMode) {

                // יצירת מיכל הכפתורים עם 2 שורות
                const btnGrid = document.createElement('div');
                btnGrid.className = 'alerts-btn-grid';

                // -----------------------------------------------
                // שורה ראשונה (משמאל לימין):
                // toggleFiltersBtn | savedFiltersBtn | clearActiveFilterBtn
                // -----------------------------------------------
                const btnRow1 = document.createElement('div');
                btnRow1.className = 'alerts-btn-row';

                // 1. כפתור הסתרת/הצגת סינונים
                const toggleFiltersBtn = document.createElement('button');
                toggleFiltersBtn.id = 'toggleFiltersBtn';
                toggleFiltersBtn.className = 'toggle-filters-btn';
                toggleFiltersBtn.innerHTML = '<i class="fas fa-angle-up"></i>';
                toggleFiltersBtn.title = 'הסתר סינונים';
                toggleFiltersBtn.addEventListener('click', () => this.toggleFiltersVisibility());

                btnRow1.appendChild(toggleFiltersBtn);

                // 2 + 3. savedFiltersBtn ו-clearActiveFilterBtn
                // נוספים על ידי savedFiltersManager.renderSavedFiltersButton
                // הפונקציה מוסיפה את שני הכפתורים לשורה 1
                this.savedFiltersManager.renderSavedFiltersButton(btnRow1, null);

                // -----------------------------------------------
                // שורה שנייה (משמאל לימין):
                // columnManagerBtn | alertsColorModeBtn | expandAlertsBtn
                // -----------------------------------------------
                const btnRow2 = document.createElement('div');
                btnRow2.className = 'alerts-btn-row';

                // 1. כפתור ניהול עמודות
                const columnManagerBtn = document.createElement('button');
                columnManagerBtn.id = 'columnManagerBtn';
                columnManagerBtn.className = 'column-manager-btn';
                columnManagerBtn.innerHTML = '<i class="fas fa-columns"></i>';
                columnManagerBtn.title = 'ניהול עמודות';
                columnManagerBtn.addEventListener('click', () => this.openColumnManagerModal());

                // 2. כפתור מצב צבע
                const colorModeBtn = document.createElement('button');
                colorModeBtn.id = 'alertsColorModeBtn';
                colorModeBtn.className = 'alerts-color-mode-btn';
                colorModeBtn.innerHTML = this.colorMode === 'background'
                    ? '<i class="fas fa-fill-drip"></i>'
                    : '<i class="fas fa-font"></i>';
                colorModeBtn.title = this.colorMode === 'background'
                    ? 'עבור לצבע טקסט'
                    : 'עבור לצבע רקע';
                colorModeBtn.addEventListener('click', () => this.toggleColorMode());

                // 3. כפתור הגדלת מסך
                const expandBtn = document.createElement('button');
                expandBtn.id = 'expandAlertsBtn';
                expandBtn.className = 'expand-alerts-btn';
                expandBtn.innerHTML = '<i class="fas fa-expand"></i>';
                expandBtn.title = 'הגדל מסך';
                expandBtn.addEventListener('click', () => this.toggleExpandAlerts());

                btnRow2.appendChild(columnManagerBtn);
                btnRow2.appendChild(colorModeBtn);
                btnRow2.appendChild(expandBtn);

                // הוספת השורות למיכל
                btnGrid.appendChild(btnRow1);
                btnGrid.appendChild(btnRow2);

                // הוספת המיכל ל-alerts-controls
                alertsControls.appendChild(btnGrid);
            }
            if (this.isFullscreenMode && this.savedFiltersManager) {
                // הפעל שחזור סינון שמור פעיל אם קיים
                const activeFilterName = this.savedFiltersManager.getActiveSavedFilterName?.();
                if (activeFilterName) {
                    this.savedFiltersManager.applyActiveFilterIndicator?.();
                }
            }

            // מאזין לכפתור ניקוי פילטרים אם קיים ב-HTML
            const existingClearFiltersBtn = document.getElementById('alerts-clear-filters-btn');
            if (existingClearFiltersBtn) {
                existingClearFiltersBtn.addEventListener('click', () => {
                    this.clearFilters();
                });
            }

            // הוספת מאזיני מיון לכותרות הטבלה
            this.initializeSortableHeaders();

            // טען התראות בפעם הראשונה
            this.loadAlerts();

            // עדכן את המטמון בפעם הראשונה
            this.updateAlertsCache();

            // הגדר עדכון מטמון כל 1 דקות
            setInterval(() => this.updateAlertsCache(), 1 * 60 * 1000);

            // עדכן את המטמון בפעם הראשונה אחרי טעינת ההתראות הקיימות
            setTimeout(() => this.updateAlertsCache(), 1000);

        } catch (error) {
            console.error('Error initializing alerts manager:', error);
            this.showError('שגיאה באתחול מנהל ההתראות');
        }
    }

    initializeSortableHeaders() {
        // מיפוי בין טקסט הכותרת לשם השדה במערך הנתונים
        const columnMapping = {
            'IP Address': 'hostAddress',
            'Last Update': 'modified',
            'Notes': 'notes',
            'Message': 'message',
            'Host': 'host',
            'Responsible Team': 'contacts',
            'Date & Time': 'timestamp',
            'Priority': 'priority',
            'Severity': 'severity',
            'Status': 'status'
        };

        const headers = document.querySelectorAll('.alerts-table thead th');
        headers.forEach(th => {
            const headerText = th.textContent.trim() || th.title.trim();
            const sortField = columnMapping[headerText];
            // רק אם יש מיפוי לעמודה זו
            if (sortField) {
                // הוסף attribute לזיהוי
                th.setAttribute('data-sort', sortField);
                th.classList.add('sortable');

                // סגנון - הצג שהעמודה ניתנת למיון
                th.style.cursor = 'pointer';
                th.style.userSelect = 'none';
                th.style.position = 'relative';

                // הוסף אייקון מיון ניטרלי
                const neutralIcon = document.createElement('span');
                neutralIcon.className = 'sort-icon-neutral';
                neutralIcon.innerHTML = ' <i class="fas fa-sort" style="opacity: 0.3;"></i>';
                th.appendChild(neutralIcon);

                // מאזין לחיצה
                th.addEventListener('click', () => {
                    this.sortAlerts(sortField);
                });

                // אפקט hover
                th.addEventListener('mouseenter', () => {
                    th.style.backgroundColor = 'rgba(0,0,0,0.05)';
                });
                th.addEventListener('mouseleave', () => {
                    th.style.backgroundColor = '';
                });
            }
        });
    }

    // פונקציה לטיפול בבחירת שורה
    toggleRowSelection(row, alertId) {
        // אם Shift לחוץ ויש התראה אחרונה שנבחרה, בחר את כל הטווח
        if (this.isShiftPressed && this.lastSelectedAlertId && alertId !== this.lastSelectedAlertId) {
            // מצא את האינדקסים של ההתראה הנוכחית והאחרונה שנבחרה
            const currentIndex = this.filteredAlerts.findIndex(alert => alert.id === alertId);
            const lastIndex = this.filteredAlerts.findIndex(alert => alert.id === this.lastSelectedAlertId);

            if (currentIndex !== -1 && lastIndex !== -1) {
                // קבע את הטווח (מהקטן לגדול)
                const startIndex = Math.min(currentIndex, lastIndex);
                const endIndex = Math.max(currentIndex, lastIndex);

                // נקה בחירות קודמות אם CTRL לא לחוץ
                if (!this.isCtrlPressed) {
                    document.querySelectorAll('.alerts-table tr.selected').forEach(selectedRow => {
                        selectedRow.classList.remove('selected');
                        // עדכן את הצ'קבוקס
                        const checkbox = selectedRow.querySelector('.alert-checkbox');
                        if (checkbox) checkbox.checked = false;
                    });
                    this.selectedAlerts = [];
                }

                // בחר את כל ההתראות בטווח
                for (let i = startIndex; i <= endIndex; i++) {
                    const alertInRange = this.filteredAlerts[i];
                    const rowInRange = document.querySelector(`.alerts-table tr[data-alert-id="${alertInRange.id}"]`);

                    if (rowInRange && !rowInRange.classList.contains('selected')) {
                        rowInRange.classList.add('selected');
                        // עדכן את הצ'קבוקס
                        const checkbox = rowInRange.querySelector('.alert-checkbox');
                        if (checkbox) checkbox.checked = true;

                        if (!this.selectedAlerts.includes(alertInRange.id)) {
                            this.selectedAlerts.push(alertInRange.id);
                        }
                    }
                }

                // עדכן את ההתראה האחרונה שנבחרה
                this.lastSelectedAlertId = alertId;
            }
        } else {
            // התנהגות רגילה כאשר Shift לא לחוץ
            // אם CTRL לא לחוץ, נקה את כל הבחירות הקודמות
            if (!this.isCtrlPressed) {
                document.querySelectorAll('.alerts-table tr.selected').forEach(selectedRow => {
                    if (selectedRow !== row) {
                        selectedRow.classList.remove('selected');
                        // עדכן את הצ'קבוקס
                        const checkbox = selectedRow.querySelector('.alert-checkbox');
                        if (checkbox) checkbox.checked = false;
                    }
                });
                this.selectedAlerts = [];
            }

            // הוסף או הסר את השורה הנוכחית מהבחירה
            if (row.classList.contains('selected')) {
                row.classList.remove('selected');
                // עדכן את הצ'קבוקס
                const checkbox = row.querySelector('.alert-checkbox');
                if (checkbox) checkbox.checked = false;

                this.selectedAlerts = this.selectedAlerts.filter(id => id !== alertId);
            } else {
                row.classList.add('selected');
                // עדכן את הצ'קבוקס
                const checkbox = row.querySelector('.alert-checkbox');
                if (checkbox) checkbox.checked = true;

                if (!this.selectedAlerts.includes(alertId)) {
                    this.selectedAlerts.push(alertId);
                }
            }

            // עדכן את ההתראה האחרונה שנבחרה
            this.lastSelectedAlertId = alertId;
        }

        // עדכן את מצב כפתור צילום המסך
        const screenshotBtn = document.getElementById('screenshotBtn');
        if (screenshotBtn) {
            screenshotBtn.disabled = this.selectedAlerts.length === 0;
        }

        // עדכן את מצב הצ'קבוקס הראשי
        const masterCheckbox = document.querySelector('.master-checkbox');
        if (masterCheckbox) {
            const allSelected = this.filteredAlerts.length > 0 &&
                this.filteredAlerts.every(alert => this.selectedAlerts.includes(alert.id));

            // אם יש לפחות התראה אחת נבחרת אבל לא כולן - מצב indeterminate
            const someSelected = this.selectedAlerts.length > 0 && !allSelected;

            masterCheckbox.checked = allSelected;
            masterCheckbox.indeterminate = someSelected;
        }

        // עדכן את סרגל הפעולות
        this.updateBulkActionsBar();
    }

    // פונקציה חדשה להגדלת/הקטנת מסך ההתראות
    toggleExpandAlerts() {
        const alertsTableContainer = document.querySelector('.alerts-table-container');
        const expandBtn = document.getElementById('expandAlertsBtn');
        if (alertsTableContainer) {
            if (alertsTableContainer.classList.contains('expanded')) {
                // הקטן את המסך
                alertsTableContainer.classList.remove('expanded');
                expandBtn.innerHTML = '<i class="fas fa-expand"></i>';
                expandBtn.title = 'הגדל מסך';

                // החזר את הגודל המקורי
                alertsTableContainer.style.maxHeight = '400px';
            } else {
                // הגדל את המסך
                alertsTableContainer.classList.add('expanded');
                expandBtn.innerHTML = '<i class="fas fa-compress"></i>';
                expandBtn.title = 'הקטן מסך';

                // הגדר את הסקשן למסך מלא
                alertsTableContainer.style.maxHeight = '750px';
            }
        }
    }

    // פונקציה חדשה להסתרת/הצגת סינונים
    toggleFiltersVisibility() {
        const filtersGroup = document.querySelectorAll('.alerts-filter-group');
        const buttons = document.querySelectorAll('.alerts-btn-row button:not(.toggle-filters-btn)');
        const toggleFiltersBtn = document.getElementById('toggleFiltersBtn');
        const btnGrid = document.querySelector('.alerts-btn-grid');

        if (filtersGroup.length > 0) {
            const isVisible = filtersGroup[0].style.display !== 'none';

            if (isVisible) {
                // הסתר את הסינונים
                filtersGroup.forEach(group => {
                    group.style.display = 'none';
                });
                toggleFiltersBtn.innerHTML = '<i class="fas fa-angle-down"></i>';
                toggleFiltersBtn.title = 'הצג סינונים';

                // *** כל הכפתורים בשורה אחת ***
                if (btnGrid) {

                    // נקה את ה-grid הקיים
                    btnGrid.innerHTML = '';

                    // צור שורה אחת עם כל הכפתורים
                    const singleRow = document.createElement('div');
                    singleRow.className = 'alerts-btn-row alerts-btn-row-single';
                    singleRow.style.flexWrap = 'nowrap';

                    [...buttons].forEach(btn => {
                        singleRow.appendChild(btn);
                    });
                    singleRow.appendChild(toggleFiltersBtn);

                    btnGrid.appendChild(singleRow);
                    btnGrid.setAttribute('data-collapsed', 'true');
                }

            } else {
                // הצג את הסינונים
                filtersGroup.forEach(group => {
                    group.style.display = 'block';
                });
                toggleFiltersBtn.innerHTML = '<i class="fas fa-angle-up"></i>';
                toggleFiltersBtn.title = 'הסתר סינונים';

                // *** חזור לשתי שורות ***
                if (btnGrid && btnGrid.getAttribute('data-collapsed') === 'true') {
                    // נקה את ה-grid
                    btnGrid.innerHTML = '';

                    // שורה ראשונה - expandBtn + toggleFiltersBtn + savedFilters
                    const btnRow1 = document.createElement('div');
                    btnRow1.className = 'alerts-btn-row';

                    // שורה שנייה - colorMode + columnManager + savedFilters
                    const btnRow2 = document.createElement('div');
                    btnRow2.className = 'alerts-btn-row';

                    // חלק את הכפתורים לפי ה-id שלהם
                    [...buttons].forEach(btn => {
                        const id = btn.id;
                        if (
                            id === 'clearActiveFilterBtn' ||
                            id === 'toggleFiltersBtn' ||
                            btn.classList.contains('saved-filters-btn') ||
                            btn.classList.contains('clear-active-filter-btn')
                        ) {
                            btnRow1.appendChild(btn);
                        } else {
                            btnRow2.appendChild(btn);
                        }
                    });

                    btnRow1.appendChild(toggleFiltersBtn);
                    btnGrid.appendChild(btnRow1);
                    btnGrid.appendChild(btnRow2);
                    btnGrid.removeAttribute('data-collapsed');
                }
            }
        }
    }

    // פונקציה חדשה להסתרת סקשן ההתראות
    hideAlertsSection() {
        const alertsSection = document.querySelector('.alerts-row');
        if (alertsSection) {
            alertsSection.style.display = 'none';
        }
    }

    // פונקציה חדשה להצגת סקשן ההתראות
    showAlertsSection() {
        const alertsSection = document.querySelector('.alerts-row');
        if (alertsSection) {
            alertsSection.style.display = 'block';
        }
    }

    async loadAlerts() {
        try {
            // הצג אינדיקטור טעינה
            this.showLoading(true);

            // קריאה לנקודת הקצה החדשה שקוראת מהקובץ המקומי
            const response = await fetch('/Alerts/GetAlerts', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.showError('שגיאה בהבאת נתונים מהשרת. אנא נסה שוב מאוחר יותר.');
                console.error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                return;
            }

            // קבל את ההתראות מהקובץ המקומי
            this.alerts = await response.json();

            // החל את הסינונים ורנדר את ההתראות
            this.applyFilters();

            // הסתר אינדיקטור טעינה
            this.showLoading(false);

        } catch (error) {
            console.error('Error loading alerts:', error);
            this.showLoading(false);
            this.showError('שגיאה בטעינת התראות: ' + error.message);
        }
    }

    // הוסף פונקציה חדשה לעדכון המטמון
    async updateAlertsCache() {
        try {
            // קריאה לנקודת הקצה החדשה שמעדכנת את המטמון
            const response = await fetch('/Alerts/UpdateAlertsCache', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.showError('שגיאה בהבאת נתונים מהשרת. אנא נסה שוב מאוחר יותר.');
                console.error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                return;
            }

            const result = await response.json();

            // טען את ההתראות המעודכנות מהמטמון רק אם המטמון עודכן
            if (result.updated) {
                this.loadAlerts();
            }

        } catch (error) {
            console.error('Error updating alerts cache:', error);
            // אל תציג שגיאה למשתמש כי זה קורה ברקע
        }
    }

    // הצג/הסתר אינדיקטור טעינה
    showLoading(show) {
        let loadingIndicator = document.getElementById('alertsLoadingIndicator');

        if (!loadingIndicator && show) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.id = 'alertsLoadingIndicator';
            loadingIndicator.className = 'alerts-loading';
            loadingIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i> טוען התראות...';

            const container = document.querySelector('.alerts-container');
            if (container) {
                container.prepend(loadingIndicator);
            }
        } else if (loadingIndicator) {
            if (show) {
                loadingIndicator.style.display = 'block';
            } else {
                loadingIndicator.style.display = 'none';
            }
        }
    }

    // הצג הודעת שגיאה
    showError(message) {
        let errorElement = document.getElementById('alertsErrorMessage');

        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'alertsErrorMessage';
            errorElement.className = 'alerts-error';

            const container = document.querySelector('.alerts-container');
            if (container) {
                container.prepend(errorElement);
            }
        }

        errorElement.textContent = message;
        errorElement.style.display = 'block';

        // הסתר את ההודעה אחרי 5 שניות
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }

    sortAlerts(column) {
        // אם לוחצים על אותה עמודה - הפוך את הכיוון
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            // עמודה חדשה - התחל עם עלייה
            this.sortColumn = column;
            this.sortDirection = 'asc';
        }

        // *** הוסף: שמור מיון ב-localStorage (רק אם לא במצב fullscreen) ***
        if (!this.isFullscreenMode) {
            this.saveToLocalStorage('alertsSortColumn', this.sortColumn);
            this.saveToLocalStorage('alertsSortDirection', this.sortDirection);
        }


        // עדכן אייקוני מיון בכותרות
        this.updateSortIcons();

        this.applySortToFilteredAlerts();

        // רנדר מחדש את הטבלה עם הנתונים הממוינים
        this.renderAlerts();
    }

    applySortToFilteredAlerts() {
        if (!this.sortColumn) return;

        this.filteredAlerts.sort((a, b) => {
            let valA = a[this.sortColumn];
            let valB = b[this.sortColumn];

            if (valA === null || valA === undefined || valA === '') return 1;
            if (valB === null || valB === undefined || valB === '') return -1;

            switch (this.sortColumn) {
                case 'timestamp':
                case 'modified':
                    valA = new Date(valA).getTime();
                    valB = new Date(valB).getTime();
                    break;
                case 'priority':
                    valA = Number(valA) || 0;
                    valB = Number(valB) || 0;
                    break;
                case 'severity':
                    const severityOrder = { 'CRITICAL': 1, 'MAJOR': 2, 'UNKNOWN': 3 };
                    valA = severityOrder[valA] || 99;
                    valB = severityOrder[valB] || 99;
                    break;
                case 'status':
                    const statusOrder = { 'OPEN': 1, 'ACK': 2, 'ASSIGN': 3, 'CLOSED': 4 };
                    valA = statusOrder[valA] || 99;
                    valB = statusOrder[valB] || 99;
                    break;
                case 'notes':
                    valA = Array.isArray(valA) ? valA.length : (valA ? 1 : 0);
                    valB = Array.isArray(valB) ? valB.length : (valB ? 1 : 0);
                    break;
                default:
                    valA = String(valA).toLowerCase();
                    valB = String(valB).toLowerCase();
            }

            if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    updateSortIcons() {
        // הסר אייקוני מיון קיימים מכל הכותרות
        document.querySelectorAll('.alerts-table th .sort-icon').forEach(icon => {
            icon.remove();
        });

        // הסר קלאסים של מיון מכל הכותרות
        document.querySelectorAll('.alerts-table th.sortable').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
        });

        // הוסף אייקון לעמודה הממוינת הנוכחית
        if (this.sortColumn) {

            const activeHeader = document.querySelector(
                `.alerts-table th[data-sort="${this.sortColumn}"]`
            );
            if (activeHeader) {
                activeHeader.classList.add(
                    this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc'
                );

                const sortIcon = document.createElement('span');
                sortIcon.className = 'sort-icon';
                sortIcon.innerHTML = this.sortDirection === 'asc'
                    ? ' <i class="fas fa-sort-up"></i>'
                    : ' <i class="fas fa-sort-down"></i>';
                activeHeader.appendChild(sortIcon);
            }
        }
    }

    applyFilters() {
        // בדיקה: אם לא נבחר אף סטטוס או לא נבחר אף חומרה (Severity) - אל תציג כלום
        if (this.severityFilters.length === 0 || this.statusFilters.length === 0) {
            this.filteredAlerts = []; // רשימה ריקה

            // ניקוי בחירות קיימות - תוספת חדשה
            this.clearSelection();
            this.renderAlerts();  // רינדור הטבלה הריקה
            return;// יציאה מהפונקציה
        }

        // סנן לפי חומרה וסטטוס
        this.filteredAlerts = this.alerts.filter(alert => {
            // סינון לפי חומרה - בדוק אם החומרה נמצאת ברשימת הפילטרים
            if (this.severityFilters.length > 0 && !this.severityFilters.includes(alert.severity)) {
                return false;
            }

            // סינון לפי סטטוס - בדוק אם הסטטוס נמצא ברשימת הפילטרים
            if (this.statusFilters.length > 0 && !this.statusFilters.includes(alert.status)) {
                return false;
            }

            // סינון לפי טקסט חיפוש
            if (this.searchTerm) {
                const searchLower = this.searchTerm.toLowerCase();

                // פונקציה לבדיקת התאמת תאריך בפורמטים שונים
                const isDateMatch = (dateValue) => {
                    if (!dateValue) return false;

                    try {
                        const date = new Date(dateValue);
                        if (isNaN(date.getTime())) return false;

                        // יצירת פורמטים שונים של תאריך לחיפוש
                        const day = date.getDate().toString().padStart(2, '0');
                        const month = (date.getMonth() + 1).toString().padStart(2, '0');
                        const year = date.getFullYear();
                        const hours = date.getHours().toString().padStart(2, '0');
                        const minutes = date.getMinutes().toString().padStart(2, '0');

                        // פורמטים שונים לחיפוש
                        const formats = [
                            `${day}/${month}/${year}`, // DD/MM/YYYY
                            `${day}.${month}.${year}`, // DD.MM.YYYY
                            `${day}-${month}-${year}`, // DD-MM-YYYY
                            `${day}${month}${year}`,   // DDMMYYYY
                            `${day}${month}.${year}`,  // DDMM.YYYY
                            `${day}/${month}`,         // DD/MM
                            `${day}.${month}`,         // DD.MM
                            `${day}-${month}`,         // DD-MM
                            `${day}${month}`,          // DDMM
                            `${month}/${year}`,        // MM/YYYY
                            `${month}.${year}`,        // MM.YYYY
                            `${month}-${year}`,        // MM-YYYY
                            `${year}`,                 // YYYY
                            `${hours}:${minutes}`,     // HH:MM
                            `${day}/${month}/${year} ${hours}:${minutes}` // DD/MM/YYYY HH:MM
                        ];

                        // בדיקה אם אחד הפורמטים מתאים לחיפוש
                        return formats.some(format => format.includes(searchLower));
                    } catch (e) {
                        return false;
                    }
                };

                return (
                    // כתובת IP
                    (alert.hostAddress && alert.hostAddress.toLowerCase().includes(searchLower)) ||
                    // עדכון אחרון - בדיקת התאמת תאריך
                    isDateMatch(alert.modified) ||
                    // הערות - טיפול מיוחד בהתאם לסוג
                    (alert.notes && (
                        // אם זה מחרוזת
                        (typeof alert.notes === 'string' && alert.notes.toLowerCase().includes(searchLower)) ||
                        // אם זה מערך של אובייקטים
                        (Array.isArray(alert.notes) && alert.notes.some(note =>
                            (note.text && note.text.toLowerCase().includes(searchLower)) ||
                            (typeof note === 'string' && note.toLowerCase().includes(searchLower))
                        ))
                    )) ||
                    // הודעה
                    (alert.message && alert.message.toLowerCase().includes(searchLower)) ||
                    // מארח
                    (alert.host && alert.host.toLowerCase().includes(searchLower)) ||
                    // אנשי קשר
                    (alert.contacts && alert.contacts.toLowerCase().includes(searchLower)) ||
                    // תאריך ושעה - בדיקת התאמת תאריך
                    isDateMatch(alert.timestamp) ||
                    // חומרה
                    (alert.severity && alert.severity.toLowerCase().includes(searchLower)) ||
                    // סטטוס
                    (alert.status && alert.status.toLowerCase().includes(searchLower)) ||
                    // עדיפות
                    (alert.priority && alert.priority.toString().includes(searchLower))
                );
            }

            return true;
        });

        // בדיקה אם יש התראות נבחרות שכבר לא מופיעות ברשימה המסוננת
        const visibleAlertIds = this.filteredAlerts.map(alert => alert.id);
        const hasInvisibleSelections = this.selectedAlerts.some(id => !visibleAlertIds.includes(id));

        // אם יש התראות נבחרות שלא מופיעות יותר, נקה את כל הבחירות
        if (hasInvisibleSelections) {
            this.clearSelection();
        }

        if (this.sortColumn) {
            this.applySortToFilteredAlerts();
        }

        this.renderAlerts();
        // Add/remove search-active class based on search term
        const alertsTable = document.querySelector('.alerts-table');
        if (alertsTable) {
            alertsTable.classList.remove('dark-mode-active');
            if (this.colorMode === 'text-dark') {
                alertsTable.classList.add('dark-mode-active');
            }
        }
        const alertsSearch = document.querySelector('.alerts-search');
        if (this.searchTerm && this.searchTerm.trim() !== '' && !this._suppressSearchHighlight) {
            if (alertsTable) alertsTable.classList.add('search-active');
            if (alertsSearch) alertsSearch.classList.add('has-search-text');

            // Mark matching rows
            this.filteredAlerts.forEach(alert => {
                const row = document.querySelector(`.alerts-table tr[data-alert-id="${alert.id}"]`);
                if (row) row.classList.add('search-match');
            });
        } else {
            if (alertsTable) alertsTable.classList.remove('search-active');
            if (alertsSearch) alertsSearch.classList.remove('has-search-text');

            // Remove search-match class from all rows
            document.querySelectorAll('.alerts-table tr.search-match').forEach(row => {
                row.classList.remove('search-match');
            });
        }
        this.saveActiveFilterState();
    }

    saveActiveFilterState() {
        const activeState = {
            severityFilters: this.severityFilters,
            statusFilters: this.statusFilters,
            searchTerm: this.searchTerm,
            sortColumn: this.sortColumn,
            sortDirection: this.sortDirection,
            timestamp: new Date().toISOString()
        };
        this.saveToLocalStorage('alertsActiveFilterState', activeState);
    }

    clearFilters() {
        // איפוס כל הפילטרים
        this.severityFilters = ['CRITICAL', 'MAJOR', 'UNKNOWN']; // איפוס לכל החומרות
        this.statusFilters = ['OPEN', 'ACK', 'ASSIGN', 'CLOSED']; // איפוס לכל הסטטוסים
        this.searchTerm = '';

        // שמירת הערכים המאופסים ב-localStorage
        this.saveToLocalStorage('alertsSeverityFilters', this.severityFilters);
        this.saveToLocalStorage('alertsStatusFilters', this.statusFilters);
        this.saveToLocalStorage('alertsSearchTerm', this.searchTerm);

        // איפוס הערכים בממשק המשתמש
        const searchInput = document.getElementById('alertSearchInput');
        if (searchInput) {
            searchInput.value = '';
        }

        // איפוס כפתורי סינון החומרה - כולם מסומנים
        const severityFilterButtons = document.querySelectorAll('.severity-filter-btn');
        if (severityFilterButtons.length > 0) {
            severityFilterButtons.forEach(btn => btn.classList.add('active'));
        }

        // איפוס כפתורי סינון הסטטוס - כולם מסומנים
        const statusFilterButtons = document.querySelectorAll('.status-filter-btn');
        if (statusFilterButtons.length > 0) {
            statusFilterButtons.forEach(btn => btn.classList.add('active'));
        }

        // החל את הפילטרים המאופסים
        this.applyFilters();
    }

    // פונקציה חדשה לספירת התראות לפי קטגוריה
    countAlertsByCategory() {
        // יצירת אובייקט לספירת התראות לפי חומרה
        const severityCounts = {
            'CRITICAL': 0,
            'MAJOR': 0,
            'UNKNOWN': 0
        };

        // יצירת אובייקט לספירת התראות לפי סטטוס
        const statusCounts = {
            'OPEN': 0,
            'ACK': 0,
            'ASSIGN': 0,
            'CLOSED': 0
        };

        // ספירת ההתראות המסוננות במקום כל ההתראות
        this.filteredAlerts.forEach(alert => {
            // ספירה לפי חומרה
            if (severityCounts.hasOwnProperty(alert.severity)) {
                severityCounts[alert.severity]++;
            }

            // ספירה לפי סטטוס
            if (statusCounts.hasOwnProperty(alert.status)) {
                statusCounts[alert.status]++;
            }
        });

        return { severityCounts, statusCounts };
    }

    // פונקציה חדשה לעדכון מוני הסינון
    updateFilterCounters() {
        // קבל את הספירות
        const { severityCounts, statusCounts } = this.countAlertsByCategory();

        // עדכן את כפתורי חומרה
        const severityButtons = document.querySelectorAll('.severity-filter-btn');
        severityButtons.forEach(btn => {
            const value = btn.getAttribute('data-value');
            const count = severityCounts[value] || 0;

            // מצא או צור את אלמנט הספירה
            let countSpan = btn.querySelector('.filter-count');
            if (!countSpan) {
                countSpan = document.createElement('span');
                countSpan.className = 'filter-count';
                btn.appendChild(countSpan);
            }

            // עדכן את הספירה
            countSpan.textContent = `(${count})`;
        });

        // עדכן את כפתורי סטטוס
        const statusButtons = document.querySelectorAll('.status-filter-btn');
        statusButtons.forEach(btn => {
            const value = btn.getAttribute('data-value');
            const count = statusCounts[value] || 0;

            // מצא או צור את אלמנט הספירה
            let countSpan = btn.querySelector('.filter-count');
            if (!countSpan) {
                countSpan = document.createElement('span');
                countSpan.className = 'filter-count';
                btn.appendChild(countSpan);
            }

            // עדכן את הספירה
            countSpan.textContent = `(${count})`;
        });
    }

    // פונקציה חדשה להצגת סך כל ההתראות המוצגות
    updateTotalAlertsCounter() {
        // בדוק אם קיים אלמנט להצגת סך ההתראות
        let totalCounter = document.getElementById('totalAlertsCounter');

        // אם לא קיים, צור אותו
        if (!totalCounter) {
            totalCounter = document.createElement('div');
            totalCounter.id = 'totalAlertsCounter';
            totalCounter.className = 'total-alerts-counter';

            // הוסף את האלמנט אחרי הטבלה במקום לפניה
            const tableContainer = document.querySelector('.alerts-table-container');
            if (tableContainer) {
                // בדוק אם יש אלמנט אחרי הטבלה שאליו אפשר להוסיף
                const parentElement = tableContainer.parentElement;
                if (parentElement) {
                    // הוסף את המונה אחרי מיכל הטבלה
                    parentElement.insertBefore(totalCounter, tableContainer.nextSibling);

                    // הוסף סגנון כדי שהמונה יהיה תמיד נראה בתחתית
                    totalCounter.style.position = 'sticky';
                    totalCounter.style.bottom = '0';
                    totalCounter.style.backgroundColor = '#f8f9fa'; // רקע בהיר
                    totalCounter.style.padding = '8px 15px';
                    totalCounter.style.borderTop = '1px solid #ddd';
                    totalCounter.style.boxShadow = '0 -2px 5px rgba(0,0,0,0.05)';
                    totalCounter.style.zIndex = '10';
                    totalCounter.style.textAlign = 'center';
                    totalCounter.style.fontWeight = 'bold';
                    totalCounter.style.width = '100%';
                    totalCounter.style.boxSizing = 'border-box';
                }
            }
        }

        // עדכן את הטקסט עם מספר ההתראות המוצגות
        totalCounter.textContent = `סה"כ התראות מוצגות: ${this.filteredAlerts.length}`;
    }

    // פונקציה חדשה לעדכון סרגל הפעולות על התראות מרובות
    updateBulkActionsBar() {
        // אם במצב מסך מלא, אל תציג את סרגל הפעולות
        if (this.isFullscreenMode) {
            const existingBar = document.getElementById('bulkActionsBar');
            if (existingBar && existingBar.parentNode) {
                existingBar.parentNode.removeChild(existingBar);
            }
            this.sortColumn = null;
            this.sortDirection = 'asc';
            return;
        }

        // בדוק אם קיים אלמנט לסרגל פעולות
        let bulkActionsBar = document.getElementById('bulkActionsBar');

        // אם לא קיים, צור אותו
        if (!bulkActionsBar) {
            bulkActionsBar = document.createElement('div');
            bulkActionsBar.id = 'bulkActionsBar';
            bulkActionsBar.className = 'bulk-actions-bar';

            // עיצוב הסרגל
            bulkActionsBar.style.display = 'flex';
            bulkActionsBar.style.justifyContent = 'space-between';
            bulkActionsBar.style.padding = '8px 15px';
            bulkActionsBar.style.backgroundColor = '#f0f8ff';
            bulkActionsBar.style.borderRadius = '5px';
            bulkActionsBar.style.margin = '10px 0';
            bulkActionsBar.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
            bulkActionsBar.style.border = '1px solid #d1e6ff';

            // הוסף את הסרגל לפני הטבלה
            const tableContainer = document.querySelector('.alerts-table-container');
            if (tableContainer) {
                tableContainer.parentElement.insertBefore(bulkActionsBar, tableContainer);
            }
        }

        // בדוק אם יש התראות נבחרות
        const hasSelectedAlerts = this.selectedAlerts.length > 0;

        // עדכן את תוכן הסרגל
        bulkActionsBar.innerHTML = `
    <div class="bulk-actions-info">
        <button class="bulk-action-btn bulk-clear-btn" title="ניקוי בחירה" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="fas fa-times"></i> Clear Selection
        </button>
        <span class="selected-count">${this.selectedAlerts.length}</span> התראות נבחרו
    </div>
    <div class="bulk-actions-buttons">
        <button class="bulk-action-btn bulk-close-btn" title="Close Selected - סגירת התראות נבחרות" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="fas fa-times-circle"></i>
        </button>
        <button class="bulk-action-btn bulk-note-btn" title="Add Notes - הוספת הערה להתראות נבחרות" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="fas fa-comment-dots"></i>
        </button>
        <button class="bulk-action-btn bulk-assign-btn" title="Assign Selected - שיוך התראות נבחרות" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="far fa-user-circle"></i>
        </button>
        <button class="bulk-action-btn bulk-ack-btn" title="Acknowledge Selected - אישור התראות נבחרות" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="far fa-check-circle"></i>
        </button>
        <button id="screenshotBtn" class="bulk-action-btn screenshot-btn" title="Screenshot Selected - צילום מסך" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="fas fa-camera"></i>
        </button>
        <button id="exportExcelBtn" class="bulk-action-btn export-excel-btn"
                title="Export to Excel - ייצוא לאקסל" ${!hasSelectedAlerts ? 'disabled' : ''}>
            <i class="fas fa-file-excel"></i>
        </button>
    </div>
    `;

        // הוסף סגנון לכפתורים מאופרים
        if (!hasSelectedAlerts) {
            const buttons = bulkActionsBar.querySelectorAll('button[disabled]');
            buttons.forEach(button => {
                button.style.opacity = '0.5';
                button.style.cursor = 'not-allowed';
            });
        }

        // הוסף מאזיני אירועים לכפתורים רק אם יש התראות נבחרות
        if (hasSelectedAlerts) {
            bulkActionsBar.querySelector('.bulk-ack-btn').addEventListener('click', () => this.bulkAcknowledgeAlerts());
            bulkActionsBar.querySelector('.bulk-assign-btn').addEventListener('click', () => this.bulkAssignAlerts());
            bulkActionsBar.querySelector('.bulk-close-btn').addEventListener('click', () => this.bulkCloseAlerts());
            bulkActionsBar.querySelector('.bulk-note-btn').addEventListener('click', () => this.bulkAddNote());
            bulkActionsBar.querySelector('.bulk-clear-btn').addEventListener('click', () => this.clearSelection());
            bulkActionsBar.querySelector('.screenshot-btn').addEventListener('click', () => this.captureScreenshot());
            bulkActionsBar.querySelector('.export-excel-btn')
                .addEventListener('click', () => this.exportToExcel());
        }

        // הצג את הסרגל תמיד
        bulkActionsBar.style.display = 'flex';
    }

    // פונקציה לניקוי בחירת התראות
    clearSelection() {
        // הסר את הקלאס 'selected' מכל השורות
        document.querySelectorAll('.alerts-table tr.selected').forEach(row => {
            row.classList.remove('selected');

            // נקה את הצ'קבוקס
            const checkbox = row.querySelector('.alert-checkbox');
            if (checkbox) checkbox.checked = false;
        });

        // נקה את הצ'קבוקס הראשי
        const masterCheckbox = document.querySelector('.master-checkbox');
        if (masterCheckbox) {
            masterCheckbox.checked = false;
            masterCheckbox.indeterminate = false;
        }

        // נקה את מערך ההתראות הנבחרות
        this.selectedAlerts = [];
        this.lastSelectedAlertId = null;

        // עדכן את סרגל הפעולות
        this.updateBulkActionsBar();

        // עדכן את מצב כפתור צילום המסך
        const screenshotBtn = document.getElementById('screenshotBtn');
        if (screenshotBtn) {
            screenshotBtn.disabled = true;
        }
    }

    // פעולת Acknowledge על מספר התראות
    async bulkAcknowledgeAlerts() {
        if (this.selectedAlerts.length === 0) return;

        try {
            // מצא את מזהי ה-Helix של ההתראות הנבחרות
            const selectedHelixIds = this.selectedAlerts
                .map(alertId => {
                    const alert = this.alerts.find(a => a.id === alertId);
                    return alert ? alert.idHelix : null;
                })
                .filter(id => id !== null && id !== undefined);

            if (selectedHelixIds.length === 0) {
                this.showError('לא נמצאו מזהי Helix להתראות הנבחרות');
                return;
            }

            // פתח מודל לאישור פעולה מרובה
            this.openBulkActionModal('ACK', selectedHelixIds);
        } catch (error) {
            console.error('Error in bulkAcknowledgeAlerts:', error);
            this.showError('שגיאה בביצוע פעולת Acknowledge מרובה: ' + error.message);
        }
    }

    // פעולת Assign על מספר התראות
    async bulkAssignAlerts() {
        if (this.selectedAlerts.length === 0) return;

        try {
            // מצא את מזהי ה-Helix של ההתראות הנבחרות
            const selectedHelixIds = this.selectedAlerts
                .map(alertId => {
                    const alert = this.alerts.find(a => a.id === alertId);
                    return alert ? alert.idHelix : null;
                })
                .filter(id => id !== null && id !== undefined);

            if (selectedHelixIds.length === 0) {
                this.showError('לא נמצאו מזהי Helix להתראות הנבחרות');
                return;
            }

            // פתח מודל לשיוך פעולה מרובה
            this.openBulkActionModal('ASSIGN', selectedHelixIds);
        } catch (error) {
            console.error('Error in bulkAssignAlerts:', error);
            this.showError('שגיאה בביצוע פעולת Assign מרובה: ' + error.message);
        }
    }

    // פעולת Close על מספר התראות
    async bulkCloseAlerts() {
        if (this.selectedAlerts.length === 0) return;

        try {
            // מצא את מזהי ה-Helix של ההתראות הנבחרות
            const selectedHelixIds = this.selectedAlerts
                .map(alertId => {
                    const alert = this.alerts.find(a => a.id === alertId);
                    return alert ? alert.idHelix : null;
                })
                .filter(id => id !== null && id !== undefined);

            if (selectedHelixIds.length === 0) {
                this.showError('לא נמצאו מזהי Helix להתראות הנבחרות');
                return;
            }

            // פתח מודל לסגירת פעולה מרובה
            this.openBulkActionModal('CLOSE', selectedHelixIds);
        } catch (error) {
            console.error('Error in bulkCloseAlerts:', error);
            this.showError('שגיאה בביצוע פעולת Close מרובה: ' + error.message);
        }
    }

    // פעולת הוספת הערה למספר התראות
    async bulkAddNote() {
        if (this.selectedAlerts.length === 0) return;

        try {
            // מצא את מזהי ה-Helix של ההתראות הנבחרות
            const selectedHelixIds = this.selectedAlerts
                .map(alertId => {
                    const alert = this.alerts.find(a => a.id === alertId);
                    return alert ? alert.idHelix : null;
                })
                .filter(id => id !== null && id !== undefined);

            if (selectedHelixIds.length === 0) {
                this.showError('לא נמצאו מזהי Helix להתראות הנבחרות');
                return;
            }

            // פתח מודל להוספת הערה מרובה
            this.openBulkActionModal('NOTE', selectedHelixIds);
        } catch (error) {
            console.error('Error in bulkAddNote:', error);
            this.showError('שגיאה בביצוע פעולת הוספת הערה מרובה: ' + error.message);
        }
    }

    // פתיחת מודל לפעולה מרובה
    async openBulkActionModal(action, helixIds) {
        try {
            this.isModalOpen = true;

            let modalTitle, actionText, defaultUser = '';
            let warningHtml = '';

            switch (action) {
                case 'ACK':
                    modalTitle = 'אישור התראות מרובות';
                    actionText = 'אשר התראות';
                    warningHtml = `
                <div style="background-color: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; border: 1px solid #ffeeba; margin-bottom: 15px; font-size: 0.9rem; display: flex; align-items: center;">
                    <i class="fas fa-exclamation-triangle" style="margin-left: 10px;"></i>
                    <span><strong>שים לב!</strong> פעולה זו תשנה את הסטטוס של ${helixIds.length} התראות ל-Acknowledge</span>
                </div>`;
                    break;
                case 'ASSIGN':
                    modalTitle = 'שיוך התראות מרובות';
                    actionText = 'שייך התראות';
                    defaultUser = 'mafil@menoramivt.net';
                    warningHtml = `
                <div style="background-color: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; border: 1px solid #ffeeba; margin-bottom: 15px; font-size: 0.9rem; display: flex; align-items: center;">
                    <i class="fas fa-exclamation-triangle" style="margin-left: 10px;"></i>
                    <span><strong>שים לב!</strong> פעולה זו תשייך ${helixIds.length} התראות</span>
                </div>`;
                    break;
                case 'CLOSE':
                    modalTitle = 'סגירת התראות מרובות';
                    actionText = 'סגור התראות';
                    warningHtml = `
                <div style="background-color: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; border: 1px solid #ffeeba; margin-bottom: 15px; font-size: 0.9rem; display: flex; align-items: center;">
                    <i class="fas fa-exclamation-triangle" style="margin-left: 10px;"></i>
                    <span><strong>שים לב!</strong> פעולה זו תסגור ${helixIds.length} התראות</span>
                </div>`;
                    break;
                case 'NOTE':
                    modalTitle = 'הוספת הערה להתראות מרובות';
                    actionText = 'הוסף הערה';
                    warningHtml = `
                <div style="background-color: #e7f3fe; color: #0c5460; padding: 10px; border-radius: 4px; border: 1px solid #bee5eb; margin-bottom: 15px; font-size: 0.9rem; display: flex; align-items: center;">
                    <i class="fas fa-info-circle" style="margin-left: 10px;"></i>
                    <span>הערה זו תתווסף ל-${helixIds.length} התראות</span>
                </div>`;
                    break;
            }

            // יצירת אלמנט המודל
            const modal = document.createElement('div');
            modal.id = 'bulkActionModal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            modal.style.zIndex = '9999';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.direction = 'rtl';

            // תוכן המודל
            modal.innerHTML = `
            <div style="background-color: white; padding: 20px; border-radius: 8px; width: 500px; max-width: 90%; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                    <h2 style="margin: 0; color: #320F5B; font-size: 1.5rem;">${modalTitle}</h2>
                    <button id="closeBulkModalBtn" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
                </div>
                
                <!-- כאן נכנסת האזהרה -->
                ${warningHtml}
                
                <form id="bulkActionForm" style="margin: 0;">
                    <input type="hidden" id="bulkAction" value="${action}">
                    
                    <div style="margin-bottom: 20px; max-height: 70vh; overflow-y: auto; padding-right: 5px;">
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">
                                <i class="fas fa-user" style="color: #667eea; margin-left: 8px;"></i>
                                שם המשתמש *
                            </label>
                            <select id="bulkUserName" class="form-select" required>
                                <option value="">בחר עובד...</option>
                                ${action === 'ASSIGN' ? `<option value="mafil@menoramivt.net" selected>mafil@menoramivt.net</option>` : ''}
                            </select>
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">
                                <i class="fas fa-sticky-note" style="color: #667eea; margin-left: 8px;"></i>
                                ${action === 'ASSIGN' ? 'מספר קריאה / הערה *' : 'הערה'}
                            </label>
                            <textarea id="bulkNote" class="form-textarea"
                                placeholder="${action === 'ASSIGN' ? 'הזן מספר קריאה או הערה...' : 'הזן הערה...'}" 
                                ${action === 'ASSIGN' || action === 'CLOSE' ? 'required' : ''}></textarea>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 15px;">
                        <button type="button" id="cancelBulkBtn" class="btn-secondary">
                            <i class="fas fa-times" style="margin-left: 5px;"></i>
                            ביטול
                        </button>
                        <button type="submit" id="bulkSubmitBtn" class="btn-primary">
                            <i class="fas fa-save" style="margin-left: 5px;"></i>
                            ${actionText}
                        </button>
                    </div>
                </form>
            </div>
        `;

            // הוספת המודל לדף
            document.body.appendChild(modal);

            // הוספת מאזיני אירועים
            document.getElementById('closeBulkModalBtn').addEventListener('click', () => this.closeBulkActionModal());
            document.getElementById('cancelBulkBtn').addEventListener('click', () => this.closeBulkActionModal());
            document.getElementById('bulkActionForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitBulkAction(action, helixIds);
            });

            await this.populateEmployeeSelect('bulkUserName');

            // התמקד בשדה הבחירה
            document.getElementById('bulkUserName').focus();

        } catch (error) {
            console.error("שגיאה בפתיחת מודל פעולה מרובה:", error);
            alert(`שגיאה בפתיחת חלון פעולה מרובה: ${error.message}`);
        }
    }

    // סגירת מודל פעולה מרובה
    closeBulkActionModal() {
        this.isModalOpen = false;
        const modal = document.getElementById('bulkActionModal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }

    // שליחת פעולה מרובה
    async submitBulkAction(action, helixIds) {
        const userName = document.getElementById('bulkUserName').value;
        const note = document.getElementById('bulkNote').value;

        if (!userName || ((action === 'ASSIGN' || action === 'CLOSE') && !note)) {
            this.showError(action === 'ASSIGN' ? 'יש למלא את כל השדות' : 'יש לבחור שם משתמש');
            return;
        }

        // שמור את העובד האחרון שנבחר
        this.saveLastSelectedEmployee(userName);

        try {
            this.showLoading(true);
            this.closeBulkActionModal();

            // *** הוסף דגל לסימון פעולה מרובה ***
            this._isBulkOperation = true;

            // מיפוי helixId → alertId
            const alertsMap = {};
            this.selectedAlerts.forEach(alertId => {
                const alert = this.alerts.find(a => a.id === alertId);
                if (alert && alert.idHelix) {
                    alertsMap[alert.idHelix] = alertId;
                }
            });

            let successCount = 0;
            let failCount = 0;
            let errors = [];

            // עבור על כל התראה בנפרד
            const newStatus = this.getNewStatusFromAction(action);

            for (const helixId of helixIds) {
                const alertId = alertsMap[helixId];
                if (!alertId) continue;

                try {
                    // קריאה לפונקציה עם הפרמטרים הנכונים ובדיקת הערך המוחזר
                    const success = await this.submitStatusUpdate(
                        alertId, helixId, action, userName, note
                    );

                    if (success) {
                        successCount++;

                        // *** תיקון: עדכן סטטוס מקומי מיד אחרי הצלחה ***
                        if (newStatus) {
                            const alertIndex = this.alerts.findIndex(a => a.id === alertId);
                            if (alertIndex !== -1) {
                                this.alerts[alertIndex].status = newStatus;
                                this.alerts[alertIndex].modified = new Date().toISOString();

                                // *** תיקון: עדכן הערה מקומית מיד ***
                                if (note) {
                                    const newNoteObj = {
                                        text: note,
                                        date: new Date().toISOString(),
                                        userName: userName
                                    };
                                    const currentNotes = this.alerts[alertIndex].notes;
                                    if (Array.isArray(currentNotes)) {
                                        this.alerts[alertIndex].notes = [newNoteObj, ...currentNotes];
                                    } else if (currentNotes) {
                                        this.alerts[alertIndex].notes = [
                                            {
                                                text: currentNotes,
                                                date: this.alerts[alertIndex].timestamp,
                                                userName: "משתמש"
                                            },
                                            newNoteObj
                                        ];
                                    } else {
                                        this.alerts[alertIndex].notes = [newNoteObj];
                                    }
                                }
                            }
                        }
                    } else {
                        failCount++;
                        errors.push(`התראה ${helixId}: פעולה נכשלה`);
                    }
                } catch (error) {
                    failCount++;
                    errors.push(`התראה ${helixId}: ${error.message}`);
                    console.error(`Error processing alert ${helixId}:`, error);
                }
                finally {
                    // *** הסר דגל בסיום ***
                    this._isBulkOperation = false;
                }
            }

            // עדכון התצוגה
            this.applyFilters();
            // ניקוי הבחירה
            this.clearSelection();

            // הצגת הודעת סיכום
            let actionText;
            switch (action) {
                case 'ACK': actionText = 'אושרו'; break;
                case 'ASSIGN': actionText = 'שויכו'; break;
                case 'CLOSE': actionText = 'נסגרו'; break;
                case 'NOTE': actionText = 'נוספה הערה ל'; break;
            }

            const successMessage = `${successCount} התראות ${actionText} בהצלחה על ידי ${userName}`;

            if (failCount > 0) {
                const errorMessage = `${failCount} התראות נכשלו: ${errors.join(', ')}`;
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(successMessage, 'success');
                    NotificationManager.show(errorMessage, 'error');
                } else {
                    this.showSuccess(successMessage);
                    this.showError(errorMessage);
                }
            } else {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(successMessage, 'success');
                } else {
                    this.showSuccess(successMessage);
                }
            }

            this.showLoading(false);

        } catch (error) {
            console.error(`Error in bulk action (${action}):`, error);
            this.showLoading(false);
            this.showError('שגיאה בביצוע פעולה מרובה: ' + error.message);
        }
    }

    // *** פונקציה חדשה - ממפה action לסטטוס החדש ***
    getNewStatusFromAction(action) {
        switch (action) {
            case 'ACK': return 'ACK';
            case 'ASSIGN': return 'ASSIGN';
            case 'CLOSE': return 'CLOSED';
            case 'OPEN': return 'OPEN';
            case 'NOTE': return null; // הערה לא משנה סטטוס
            default: return null;
        }
    }

    // פונקציה להוספת הערות מרובות
    async addBulkNotes(helixIds, userName, note) {
        if (!note || !userName) return;

        try {
            // מצא את מזהי ההתראות המקומיים המתאימים למזהי ה-Helix
            const alertsMap = {};
            this.selectedAlerts.forEach(alertId => {
                const alert = this.alerts.find(a => a.id === alertId);
                if (alert && alert.idHelix) {
                    alertsMap[alert.idHelix] = alertId;
                }
            });

            // הוסף הערה לכל התראה
            for (const helixId of helixIds) {
                const alertId = alertsMap[helixId];
                if (!alertId) continue;

                try {
                    await fetch('/Alerts/AddNote', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({
                            eventId: helixId,
                            alertId: alertId,
                            note: userName + ":" + note,
                            userName: userName
                        }),
                        credentials: 'include'
                    });

                    // עדכון מקומי של ההערה
                    const alertIndex = this.alerts.findIndex(a => a.id === alertId);
                    if (alertIndex !== -1) {
                        const currentNotes = this.alerts[alertIndex].notes;
                        const newNoteObj = {
                            text: note,  // שמור רק את תוכן ההערה ללא שם המשתמש
                            date: new Date().toISOString(),
                            userName: userName  // שמור את שם המשתמש בשדה נפרד
                        };

                        if (Array.isArray(currentNotes)) {
                            this.alerts[alertIndex].notes = [newNoteObj, ...currentNotes];
                        } else if (currentNotes) {
                            this.alerts[alertIndex].notes = [
                                { text: currentNotes, date: this.alerts[alertIndex].modified || this.alerts[alertIndex].timestamp, userName: "משתמש" },
                                newNoteObj
                            ];
                        } else {
                            this.alerts[alertIndex].notes = [newNoteObj];
                        }

                        this.alerts[alertIndex].modified = new Date().toISOString();
                    }
                } catch (error) {
                    console.error(`Error adding note to alert ${alertId}:`, error);
                }
            }

            // עדכון התצוגה
            this.applyFilters();

            // ניקוי הבחירה
            this.clearSelection();

            // הצגת הודעת הצלחה
            const successMessage = `הערה נוספה בהצלחה ל-${helixIds.length} התראות על ידי ${userName}`;
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(successMessage, 'success');
            } else {
                this.showSuccess(successMessage);
            }
        } catch (error) {
            console.error('Error in addBulkNotes:', error);
            this.showError('שגיאה בהוספת הערות מרובות: ' + error.message);
        }
    }

    // פונקציה חדשה שיוצרת פופאפים אמיתיים במקום תפריטים מוטמעים
    movePopupsOutsideTableContainer() {
        // יצירת מיכל לפופאפים אם לא קיים
        let popupsContainer = document.getElementById('alerts-popups-container');
        if (!popupsContainer) {
            popupsContainer = document.createElement('div');
            popupsContainer.id = 'alerts-popups-container';
            document.body.appendChild(popupsContainer);
        }

        // טיפול בפופאפים של הערות
        document.querySelectorAll('.alert-notes-badge').forEach(badge => {
            // שמירת התוכן של הפופאפ המקורי
            const notesPopupList = badge.querySelector('.alert-notes-popup .notes-popup-list');

            if (notesPopupList) {
                // הסרת הפופאפ המקורי
                const originalPopup = badge.querySelector('.alert-notes-popup');
                if (originalPopup && originalPopup.parentNode) {
                    originalPopup.parentNode.removeChild(originalPopup);
                }

                // הוספת מאזין hover לתג
                badge.addEventListener('mouseenter', (e) => {
                    e.stopPropagation();

                    // סגירת כל הפופאפים הפתוחים
                    document.querySelectorAll('.popup-overlay').forEach(popup => {
                        if (popup.parentNode) {
                            popup.parentNode.removeChild(popup);
                        }
                    });

                    // שימוש בתוכן ההערות המקורי
                    const notesContent = notesPopupList.innerHTML;
                    this.showNotesPopup(badge, notesContent);
                });

                // הוספת מאזין לעזיבת העכבר
                badge.addEventListener('mouseleave', (e) => {
                    // נחכה רגע לפני סגירת הפופאפ כדי לאפשר למשתמש להזיז את העכבר לפופאפ
                    setTimeout(() => {
                        const popup = document.querySelector('.popup-overlay');
                        if (popup) {
                            const popupElement = popup.querySelector('.notes-popup');
                            if (popupElement) {
                                const rect = popupElement.getBoundingClientRect();
                                if (
                                    e.clientX < rect.left ||
                                    e.clientX > rect.right ||
                                    e.clientY < rect.top ||
                                    e.clientY > rect.bottom
                                ) {
                                    if (popup.parentNode) {
                                        popup.parentNode.removeChild(popup);
                                    }
                                }
                            }
                        }
                    }, 100);
                });
            }
        });

        // טיפול בתפריטי פעולות
        document.querySelectorAll('.actions-dropdown').forEach(dropdown => {
            const actionsBtn = dropdown.querySelector('.actions-btn');
            const originalMenu = dropdown.querySelector('.actions-dropdown-content');

            if (actionsBtn && originalMenu) {
                // שמירת התוכן של התפריט המקורי
                const menuLinks = [];
                originalMenu.querySelectorAll('a').forEach(link => {
                    menuLinks.push({
                        text: link.textContent,
                        onclick: link.getAttribute('onclick'),
                        href: link.href
                    });
                });

                // הסרת התפריט המקורי
                if (originalMenu.parentNode) {
                    originalMenu.parentNode.removeChild(originalMenu);
                }

                // הוספת מאזין לחיצה לכפתור
                actionsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();

                    // סגירת כל הפופאפים הפתוחים
                    document.querySelectorAll('.popup-overlay').forEach(popup => {
                        if (popup.parentNode) {
                            popup.parentNode.removeChild(popup);
                        }
                    });

                    this.showActionsPopup(actionsBtn, menuLinks);
                });
            }
        });
    }

    // פונקציה להצגת פופאפ הערות
    showNotesPopup(badge, notesContent) {
        const rect = badge.getBoundingClientRect();

        // יצירת שכבת רקע לפופאפ - שינוי לשקיפות חלקית
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.1)'; // שקיפות חלקית
        overlay.style.zIndex = '9999';
        overlay.style.display = 'block'; // שינוי מ-flex ל-block
        overlay.style.pointerEvents = 'none'; // מאפשר לחיצות לעבור דרך הרקע

        // יצירת תוכן הפופאפ
        const popup = document.createElement('div');
        popup.className = 'notes-popup';
        popup.style.backgroundColor = 'white';
        popup.style.borderRadius = '8px';
        popup.style.padding = '5px';
        popup.style.maxWidth = '350px';
        popup.style.width = 'auto';
        popup.style.maxHeight = '80vh';
        popup.style.overflow = 'auto';
        popup.style.position = 'absolute';
        popup.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        popup.style.pointerEvents = 'auto'; // מאפשר אינטראקציה עם הפופאפ

        // מיקום הפופאפ ליד התג
        // בדיקה אם יש מספיק מקום מעל התג
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceBelow > 300) { // אם יש מספיק מקום למטה
            popup.style.top = `${rect.bottom + 5}px`;
            popup.style.left = `${rect.left}px`;
        } else if (spaceAbove > 300) { // אם יש מספיק מקום למעלה
            popup.style.bottom = `${window.innerHeight - rect.top + 5}px`;
            popup.style.left = `${rect.left}px`;
        } else { // אחרת, הצג במרכז המסך
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
        }

        // תוכן ההערות
        const content = document.createElement('div');
        content.className = 'notes-content';

        // יצירת רשימת הערות
        const notesList = document.createElement('div');
        notesList.className = 'notes-popup-list';
        notesList.innerHTML = notesContent;

        content.appendChild(notesList);

        // הסרת סגנונות מיותרים מתוכן ההערות
        content.querySelectorAll('.note-popup-item').forEach(item => {
            item.style.padding = '5px';
            item.style.marginBottom = '2px';
            item.style.borderBottom = '1px solid #eee';
            item.style.borderRadius = '8px';
            item.style.background = '#f9f9f9';
        });

        // הוספת כל האלמנטים לפופאפ
        popup.appendChild(content);
        overlay.appendChild(popup);

        // הוספת הפופאפ לדף
        document.body.appendChild(overlay);

        // הוספת מאזין hover לפופאפ כדי שיישאר פתוח כשהעכבר עליו
        popup.addEventListener('mouseenter', () => {
            // הפופאפ נשאר פתוח
        });

        popup.addEventListener('mouseleave', () => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        });

        // סגירת הפופאפ בלחיצה על הרקע
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }
        });
    }

    // פונקציה להצגת פופאפ פעולות
    showActionsPopup(actionsBtn, menuLinks) {
        const rect = actionsBtn.getBoundingClientRect();

        // יצירת שכבת רקע לפופאפ
        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.1)'; // שקיפות חלקית
        overlay.style.zIndex = '9999';
        overlay.style.display = 'block';
        overlay.style.pointerEvents = 'all'; // מאפשר לחיצות על הרקע לסגירת הפופאפ

        // יצירת תוכן הפופאפ
        const popup = document.createElement('div');
        popup.className = 'actions-popup';
        popup.style.backgroundColor = 'white';
        popup.style.borderRadius = '8px';
        popup.style.padding = '5px';
        popup.style.maxWidth = '250px';
        popup.style.width = 'auto';
        popup.style.position = 'absolute';
        popup.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        popup.style.pointerEvents = 'auto'; // מאפשר אינטראקציה עם הפופאפ

        // מיקום הפופאפ ליד הכפתור
        // בדיקה אם יש מספיק מקום מעל הכפתור
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceBelow > 200) { // אם יש מספיק מקום למטה
            popup.style.top = `${rect.bottom + 10}px`;
            popup.style.left = `${rect.left}px`;
        } else if (spaceAbove > 200) { // אם יש מספיק מקום למעלה
            popup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
            popup.style.left = `${rect.left}px`;
        } else { // אחרת, הצג במרכז המסך
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
        }

        // תוכן הפעולות
        const content = document.createElement('div');
        content.className = 'actions-content';

        // יצירת כפתורי פעולות מהקישורים
        menuLinks.forEach(link => {
            const actionBtn = document.createElement('button');
            actionBtn.className = 'action-popup-btn';
            actionBtn.textContent = link.text;
            actionBtn.style.display = 'block';
            actionBtn.style.width = '100%';
            actionBtn.style.padding = '10px 5px';
            actionBtn.style.margin = '2px 0';
            actionBtn.style.backgroundColor = '#f8f9fa';
            actionBtn.style.border = '1px solid #ddd';
            actionBtn.style.borderRadius = '8px';
            actionBtn.style.textAlign = 'center';
            actionBtn.style.cursor = 'pointer';
            actionBtn.style.transition = 'all 0.2s';
            actionBtn.style.fontSize = '1rem';

            // העתקת אירוע ה-onclick מהקישור המקורי
            if (link.onclick) {
                actionBtn.setAttribute('onclick', link.onclick);
            } else if (link.href) {
                actionBtn.onclick = () => {
                    window.location.href = link.href;
                    document.body.removeChild(overlay);
                };
            }

            // הוספת אפקט hover
            actionBtn.onmouseover = () => {
                actionBtn.style.backgroundColor = '#e9ecef';
                actionBtn.style.borderColor = '#ced4da';
            };
            actionBtn.onmouseout = () => {
                actionBtn.style.backgroundColor = '#f8f9fa';
                actionBtn.style.borderColor = '#ddd';
            };

            content.appendChild(actionBtn);
        });

        // הוספת כל האלמנטים לפופאפ
        popup.appendChild(content);
        overlay.appendChild(popup);

        // הוספת הפופאפ לדף
        document.body.appendChild(overlay);

        // סגירת הפופאפ בלחיצה על הרקע
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }
        });

        // סגירת הפופאפ כאשר העכבר יוצא ממנו
        popup.addEventListener('mouseleave', () => {
            // נחכה רגע קט לפני הסגירה למקרה שהמשתמש מזיז את העכבר בתוך הפופאפ
            setTimeout(() => {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
            }, 100);
        });

        // מניעת התפשטות אירועי לחיצה מהפופאפ לרקע
        popup.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // סגירת הפופאפ בלחיצה מחוץ לפופאפ
        document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target) && e.target !== actionsBtn) {
                if (overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                document.removeEventListener('click', closePopup);
            }
        });
    }

    // הגדרת מטא-דאטה של עמודות
    getColumnDefinitions() {
        return {
            hostAddress: { label: 'IP Address', alwaysVisible: false, canReorder: true },
            modified: { label: 'Last Update', alwaysVisible: false, canReorder: true },
            notes: { label: 'Notes', alwaysVisible: false, canReorder: true },
            message: { label: 'Message', alwaysVisible: false, canReorder: true },
            host: { label: 'Host', alwaysVisible: false, canReorder: true },
            email: { label: 'Mail', alwaysVisible: false, canReorder: true },
            contacts: { label: 'Responsible Team', alwaysVisible: false, canReorder: true },
            timestamp: { label: 'Date & Time', alwaysVisible: false, canReorder: true },
            priority: { label: 'Priority', alwaysVisible: false, canReorder: true },
            severity: { label: 'Severity', alwaysVisible: false, canReorder: true },
            status: { label: 'Status', alwaysVisible: false, canReorder: true },
            actions: { label: 'Actions', alwaysVisible: true, canReorder: false },
            checkbox: { label: 'Select', alwaysVisible: true, canReorder: false }
        };
    }

    toggleColorMode() {
        // מחזור בין 3 מצבים
        const modes = ['background', 'text-light', 'text-dark'];
        const currentIndex = modes.indexOf(this.colorMode);
        this.colorMode = modes[(currentIndex + 1) % modes.length];

        if (this.isFullscreenMode) {
            this.saveToLocalStorage('dashboardColorMode', this.colorMode);
        } else {
            this.saveToLocalStorage('alertsColorMode', this.colorMode);
        }

        // עדכון כפתור
        const iconMap = {
            'background': '<i class="fas fa-fill-drip"></i>',
            'text-light': '<i class="fas fa-font"></i>',
            'text-dark': '<i class="fas fa-moon"></i>'
        };
        const titleMap = {
            'background': 'מצב: צבע רקע',
            'text-light': 'מצב: טקסט על רקע בהיר',
            'text-dark': 'מצב: טקסט על רקע כהה'
        };

        [
            document.getElementById('alertsColorModeBtn'),
            document.getElementById('dashboardColorModeBtn')
        ].forEach(btn => {
            if (btn) {
                btn.innerHTML = iconMap[this.colorMode];
                btn.title = titleMap[this.colorMode];
            }
        });

        this.renderAlerts();

        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show(titleMap[this.colorMode], 'success');
        }
    }

    openColumnManagerModal() {
        // סגור מודל קיים אם פתוח
        const existing = document.getElementById('columnManagerModal');
        if (existing) existing.remove();

        const defs = this.getColumnDefinitions();

        const modal = document.createElement('div');
        modal.id = 'columnManagerModal';
        modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 10000;
        display: flex; justify-content: center; align-items: center; direction: rtl;
    `;

        // בנה רשימת עמודות לפי הסדר הנוכחי (רק עמודות שניתן לסדר מחדש)
        const reorderableColumns = this.columnOrder.filter(col => defs[col] && defs[col].canReorder);

        const itemsHTML = [...reorderableColumns].reverse().map(col => `
        <div class="col-manager-item" data-col="${col}" 
             draggable="true"
             style="display:flex; align-items:center; gap:10px; padding:10px 12px;
                    background:#f8f9fa; border:1px solid #dee2e6; border-radius:6px;
                    margin-bottom:6px; cursor:grab; user-select:none;
                    transition: background 0.15s, box-shadow 0.15s;">
            <i class="fas fa-grip-vertical" style="color:#adb5bd; cursor:grab;"></i>
            <input type="checkbox" 
                   id="alertCol-${col}" 
                   ${this.visibleColumns[col] ? 'checked' : ''}
                   style="width:16px; height:16px; cursor:pointer;"
                   onchange="alertsManager.toggleColumnVisibility('${col}', this.checked)">
            <label for="alertCol-${col}" 
                   style="flex:1; cursor:pointer; font-size:0.95rem; margin:0;">
                ${defs[col].label}
            </label>
        </div>
    `).join('');

        modal.innerHTML = `
        <div style="background:white; border-radius:10px; width:420px; max-width:95%;
                    max-height:90vh; overflow:hidden; display:flex; flex-direction:column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.2);">
            
            <!-- כותרת -->
            <div style="display:flex; justify-content:space-between; align-items:center;
                        padding:16px 20px; border-bottom:1px solid #eee; background:#320F5B;">
                <h3 style="margin:0; color:white; font-size:1.1rem;">
                    <i class="fas fa-columns" style="margin-left:8px;"></i>
                    ניהול עמודות
                </h3>
                <button onclick="document.getElementById('columnManagerModal').remove()"
                        style="background:none; border:none; color:white; font-size:22px; 
                               cursor:pointer; line-height:1;">&times;</button>
            </div>

            <!-- הוראות -->
            <div style="padding:10px 20px; background:#f0f4ff; border-bottom:1px solid #e0e7ff;
                        font-size:0.85rem; color:#555; display:flex; align-items:center; gap:8px;">
                <i class="fas fa-info-circle" style="color:#667eea;"></i>
                <span>גרור לשינוי סדר • סמן/בטל לחשיפה/הסתרה</span>
            </div>

            <!-- רשימת עמודות -->
            <div id="colManagerList" style="padding:16px 20px; overflow-y:auto; flex:1;">
                ${itemsHTML}
            </div>

            <!-- כפתורים -->
            <div style="padding:14px 20px; border-top:1px solid #eee; 
                        display:flex; justify-content:space-between; gap:10px; background:#fafafa;">
                <button onclick="alertsManager.resetColumnSettings()"
                        style="padding:8px 16px; background:#6c757d; color:white; border:none;
                               border-radius:6px; cursor:pointer; font-size:0.9rem; display:flex;
                               align-items:center; gap:6px;">
                    <i class="fas fa-undo"></i> איפוס
                </button>
                <div style="display:flex; gap:8px;">
                    <button onclick="document.getElementById('columnManagerModal').remove()"
                            style="padding:8px 16px; background:#e9ecef; color:#333; border:none;
                                   border-radius:6px; cursor:pointer; font-size:0.9rem;">
                        סגור
                    </button>
                    <button onclick="alertsManager.applyColumnSettings()"
                            style="padding:8px 16px; background:#320F5B; color:white; border:none;
                                   border-radius:6px; cursor:pointer; font-size:0.9rem; display:flex;
                                   align-items:center; gap:6px;">
                        <i class="fas fa-check"></i> החל
                    </button>
                </div>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // אתחול Drag & Drop
        this.initColumnDragDrop();

        // סגירה בלחיצה על הרקע
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    initColumnDragDrop() {
        const list = document.getElementById('colManagerList');
        if (!list) return;

        let draggedItem = null;

        list.querySelectorAll('.col-manager-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                item.style.opacity = '0.5';
                item.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
                item.style.boxShadow = 'none';
                item.style.background = '#f8f9fa';
                draggedItem = null;
                // הסר הדגשות
                list.querySelectorAll('.col-manager-item').forEach(i => {
                    i.style.borderColor = '#dee2e6';
                    i.style.background = '#f8f9fa';
                });
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (item !== draggedItem) {
                    item.style.borderColor = '#667eea';
                    item.style.background = '#f0f4ff';
                }
            });

            item.addEventListener('dragleave', () => {
                item.style.borderColor = '#dee2e6';
                item.style.background = '#f8f9fa';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedItem && item !== draggedItem) {
                    const allItems = [...list.querySelectorAll('.col-manager-item')];
                    const draggedIndex = allItems.indexOf(draggedItem);
                    const targetIndex = allItems.indexOf(item);

                    if (draggedIndex < targetIndex) {
                        list.insertBefore(draggedItem, item.nextSibling);
                    } else {
                        list.insertBefore(draggedItem, item);
                    }
                }
                item.style.borderColor = '#dee2e6';
                item.style.background = '#f8f9fa';
            });
        });
    }

    toggleColumnVisibility(colName, isVisible) {
        this.visibleColumns[colName] = isVisible;
    }

    applyColumnSettings() {
        const list = document.getElementById('colManagerList');
        if (!list) return;

        // קרא את הסדר החדש מה-DOM והפוך אותו חזרה
        const newReorderableOrder = [...list.querySelectorAll('.col-manager-item')]
            .map(item => item.getAttribute('data-col'))
            .reverse(); // ← הוסף reverse כאן

        const defs = this.getColumnDefinitions();
        const fixedColumns = this.columnOrder.filter(col => defs[col] && !defs[col].canReorder);

        this.columnOrder = [...newReorderableOrder, ...fixedColumns];

        // שמור ב-localStorage
        this.saveToLocalStorage('alertsColumnOrder', this.columnOrder);
        this.saveToLocalStorage('alertsVisibleColumns', this.visibleColumns);

        // סגור מודל ורנדר מחדש
        document.getElementById('columnManagerModal')?.remove();
        this.renderAlerts();

        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show('הגדרות עמודות נשמרו', 'success');
        }
    }

    resetColumnSettings() {
        this.columnOrder = [
            'hostAddress', 'modified', 'notes', 'message', 'host',
            'email', 'contacts', 'timestamp', 'priority', 'severity', 'status', 'actions', 'checkbox'
        ];
        this.visibleColumns = {
            hostAddress: true, modified: true, notes: true, message: true,
            host: true, email: true, contacts: true, timestamp: true,
            priority: true, severity: true, status: true, actions: true, checkbox: true
        };
        this.saveToLocalStorage('alertsColumnOrder', this.columnOrder);
        this.saveToLocalStorage('alertsVisibleColumns', this.visibleColumns);

        document.getElementById('columnManagerModal')?.remove();
        this.renderAlerts();

        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show('הגדרות עמודות אופסו', 'success');
        }
    }

    renderAlerts() {
        const tableBody = document.getElementById('alertsTableBody');
        if (!tableBody) {
            console.error('Table body element not found');
            return;
        }

        const alertsTable = document.querySelector('.alerts-table');
        if (alertsTable) {
            alertsTable.classList.remove('dark-mode-active');
            if (this.colorMode === 'text-dark') {
                alertsTable.classList.add('dark-mode-active');
            }
        }

        // נקה את הטבלה
        tableBody.innerHTML = '';

        // עדכן מונים וכו'
        this.updateFilterCounters();
        this.updateTotalAlertsCounter();

        // בדוק אם יש התראות להצגה
        if (this.filteredAlerts.length === 0) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            // התאם את מספר העמודות בהתאם למצב מסך מלא
            emptyCell.colSpan = this.isFullscreenMode ? 11 : 13;
            emptyCell.textContent = 'אין התראות להצגה';
            emptyCell.className = 'empty-alerts-message';
            emptyRow.appendChild(emptyCell);
            tableBody.appendChild(emptyRow);
            return;
        }

        // הוסף כותרת לעמודת הצ'קבוקס אם לא קיימת ואם לא במצב מסך מלא

        // בנה כותרות לפי הסדר
        const headerRow = document.querySelector('.alerts-table thead tr');
        if (headerRow) {
            headerRow.innerHTML = ''; // נקה כותרות קיימות

            this.columnOrder.forEach(col => {
                if (!this.visibleColumns[col]) return;
                if (col === 'checkbox' && this.isFullscreenMode) return;
                if (col === 'actions' && this.isFullscreenMode) return;

                const th = document.createElement('th');

                if (col === 'actions') {
                    th.title = 'Bulk Actions';
                    th.style.position = 'relative';

                    const bulkMenuBtn = document.createElement('button');
                    bulkMenuBtn.className = 'actions-btn header-bulk-actions-btn';
                    bulkMenuBtn.title = 'פעולות מרובות';

                    bulkMenuBtn.innerHTML = '<i class="fas fa-ellipsis-v"></i>';

                    bulkMenuBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showBulkActionsPopup(bulkMenuBtn);
                    });

                    th.appendChild(bulkMenuBtn);
                }
                if (col === 'checkbox') {
                    th.className = 'checkbox-header';
                    th.style.width = '40px';
                    const masterCheckbox = document.createElement('input');
                    masterCheckbox.type = 'checkbox';
                    masterCheckbox.className = 'master-checkbox';
                    masterCheckbox.title = 'בחר הכל';
                    masterCheckbox.addEventListener('change', (e) => {
                        const isChecked = e.target.checked;
                        document.querySelectorAll('.alerts-table tbody tr').forEach(row => {
                            const checkbox = row.querySelector('.alert-checkbox');
                            if (checkbox) {
                                checkbox.checked = isChecked;
                                const alertId = row.getAttribute('data-alert-id');
                                if (alertId) {
                                    if (isChecked) {
                                        row.classList.add('selected');
                                        if (!this.selectedAlerts.includes(alertId)) {
                                            this.selectedAlerts.push(alertId);
                                        }
                                    } else {
                                        row.classList.remove('selected');
                                        this.selectedAlerts = this.selectedAlerts.filter(id => id !== alertId);
                                    }
                                }
                            }
                        });
                        masterCheckbox.indeterminate = false;
                        this.updateBulkActionsBar();
                        const screenshotBtn = document.getElementById('screenshotBtn');
                        if (screenshotBtn) screenshotBtn.disabled = this.selectedAlerts.length === 0;
                    });
                    th.appendChild(masterCheckbox);
                } else {
                    // כותרות רגילות עם מיון
                    const columnMapping = {
                        hostAddress: { text: 'IP Address', icon: null },
                        modified: { text: 'Last Update', icon: null },
                        notes: { text: 'Notes', icon: null },
                        message: { text: 'Message', icon: null },
                        host: { text: 'Host', icon: null },
                        email: { text: null, title: 'Send Email', icon: 'fas fa-envelope' },
                        contacts: { text: 'Responsible Team', icon: null },
                        timestamp: { text: 'Date & Time', icon: null },
                        priority: { text: null, title: 'Priority', icon: 'fas fa-flag' },
                        severity: { text: null, title: 'Severity', icon: 'fas fa-triangle-exclamation' },
                        status: { text: null, title: 'Status', icon: 'fas fa-info-circle' }
                    };

                    const colDef = columnMapping[col];
                    if (colDef) {
                        if (colDef.title) th.title = colDef.title;
                        if (colDef.icon) {
                            const i = document.createElement('i');
                            i.className = colDef.icon;
                            th.appendChild(i);
                        } else if (colDef.text) {
                            th.textContent = colDef.text;
                        }
                    }

                    const sortableColumns = ['hostAddress', 'modified', 'notes', 'message', 'host', 'contacts', 'timestamp', 'priority', 'severity', 'status'];
                    if (sortableColumns.includes(col)) {
                        th.setAttribute('data-sort', col);
                        th.classList.add('sortable');
                        th.style.cursor = 'pointer';
                        th.style.userSelect = 'none';
                        th.style.position = 'relative';

                        const neutralIcon = document.createElement('span');
                        neutralIcon.className = 'sort-icon-neutral';
                        neutralIcon.innerHTML = ' <i class="fas fa-sort" style="opacity: 0.3;"></i>';
                        th.appendChild(neutralIcon);

                        th.addEventListener('click', () => this.sortAlerts(col));
                        th.addEventListener('mouseenter', () => { th.style.backgroundColor = 'rgba(0,0,0,0.05)'; });
                        th.addEventListener('mouseleave', () => { th.style.backgroundColor = ''; });

                        // הוסף אייקון מיון אם זו העמודה הממוינת
                        if (this.sortColumn === col) {
                            th.classList.add(this.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
                            const sortIcon = document.createElement('span');
                            sortIcon.className = 'sort-icon';
                            sortIcon.innerHTML = this.sortDirection === 'asc'
                                ? ' <i class="fas fa-sort-up"></i>'
                                : ' <i class="fas fa-sort-down"></i>';
                            th.appendChild(sortIcon);
                        }
                    }
                }
                headerRow.appendChild(th);
            });
        }

        // הצג את ההתראות
        this.filteredAlerts.forEach(alert => {
            const row = document.createElement('tr');

            // הוסף class בסיסי תמיד
            row.setAttribute('data-severity', alert.severity.toLowerCase());

            // הוסף class לפי מצב הצבע
            switch (this.colorMode) {
                case 'background':
                    row.className = `severity-${alert.severity.toLowerCase()}`;
                    break;
                case 'text-light':
                    row.className = `severity-text-light-${alert.severity.toLowerCase()}`;
                    break;
                case 'text-dark':
                    row.className = `severity-text-dark-${alert.severity.toLowerCase()}`;
                    break;
                default:
                    row.className = `severity-${alert.severity.toLowerCase()}`;
            }

            switch (alert.status) {
                case 'OPEN': row.classList.add('status-open-row'); break;
                case 'ACK': row.classList.add('status-ack-row'); break;
                case 'ASSIGN': row.classList.add('status-assign-row'); break;
                case 'CLOSED': row.classList.add('status-closed'); break;
                default: row.classList.add('status-open-row');
            }

            row.setAttribute('data-alert-id', alert.id);

            if (this.selectedAlerts.includes(alert.id)) {
                row.classList.add('selected');
            }

            if (!this.isFullscreenMode) {
                row.addEventListener('click', (e) => {
                    if (e.target.type === 'checkbox') return;
                    if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'A' && e.target.tagName !== 'I') {
                        const selection = window.getSelection();
                        if (selection && selection.toString().length > 0) return;
                        this.toggleRowSelection(row, alert.id);
                        const checkbox = row.querySelector('.alert-checkbox');
                        if (checkbox) checkbox.checked = row.classList.contains('selected');
                    }
                });
            }

            // בנה תאים לפי הסדר
            this.columnOrder.forEach(col => {
                if (!this.visibleColumns[col]) return;
                if (col === 'checkbox' && this.isFullscreenMode) return;
                if (col === 'actions' && this.isFullscreenMode) return;

                const td = document.createElement('td');
                switch (col) {
                    case 'hostAddress':
                        td.textContent = alert.hostAddress;
                        td.style.maxWidth = '110px';
                        td.style.minWidth = '70px';
                        td.style.overflow = 'hidden';
                        td.style.textOverflow = 'ellipsis';
                        td.style.whiteSpace = 'nowrap';
                        td.title = alert.hostAddress;
                        addCopyOnClickToCell(td, alert.hostAddress);
                        break;

                    case 'modified':
                        td.textContent = alert.modified ? this.formatDate(alert.modified) : '-';
                        td.style.minWidth = '120px';
                        break;

                    case 'notes':
                        if (alert.notes) {
                            const notesArray = Array.isArray(alert.notes)
                                ? alert.notes
                                : [{ text: alert.notes, date: alert.modified || alert.timestamp, userName: "משתמש" }];
                            const notesCount = notesArray.length;
                            td.innerHTML = `
                        <span class="alert-notes-badge has-notes" title="יש ${notesCount} הערות">
                            <i class="fas fa-comment-dots"></i>
                            <span class="notes-count">${notesCount}</span>
                            <div class="alert-notes-popup">
                                <div class="notes-popup-list">
                                    ${notesArray.map(note => `
                                        <div class="note-popup-item">
                                            <div class="note-popup-header">
                                                <div class="note-popup-meta">
                                                    <div class="note-popup-user">${note.userName || 'משתמש'}</div>
                                                    <div class="note-popup-datetime">
                                                        <span><i class="fas fa-calendar"></i> ${this.formatDate(note.date)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="note-popup-text">${note.text || note}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </span>`;
                        }
                        break;

                    case 'message':
                        td.textContent = alert.message;
                        td.style.maxWidth = '500px';
                        td.style.minWidth = '200px';
                        td.style.overflow = 'hidden';
                        td.style.textOverflow = 'ellipsis';
                        td.style.whiteSpace = 'nowrap';
                        td.title = alert.message;
                        addCopyOnClickToCell(td, alert.message);
                        break;

                    case 'host':
                        td.textContent = alert.host;
                        td.style.maxWidth = '150px';
                        td.style.overflow = 'hidden';
                        td.style.textOverflow = 'ellipsis';
                        td.style.whiteSpace = 'nowrap';
                        td.title = alert.host;
                        addCopyOnClickToCell(td, alert.host);
                        break;

                    case 'email': {
                        let emailIcon = 'fa-envelope';
                        if (alert.status === 'ACK') emailIcon = 'fa-envelope-open';
                        else if (alert.status === 'ASSIGN') emailIcon = 'fa-user-circle';
                        if (this.isFullscreenMode) {
                            td.innerHTML = `<i class="fas ${emailIcon}"></i>`;
                        } else {
                            td.innerHTML = `<button class="send-mail-btn" onclick="alertsManager.sendMail('${alert.id}'); return false;"><i class="fas ${emailIcon}"></i></button>`;
                        }
                        break;
                    }

                    case 'contacts':
                        td.textContent = alert.contacts || '-';
                        td.style.maxWidth = '230px';
                        td.style.minWidth = '100px';
                        td.style.overflow = 'hidden';
                        td.style.textOverflow = 'ellipsis';
                        td.style.whiteSpace = 'nowrap';
                        td.title = alert.contacts || '-';
                        addCopyOnClickToCell(td, alert.contacts);
                        break;

                    case 'timestamp':
                        td.textContent = this.formatDate(alert.timestamp);
                        td.style.minWidth = '120px';
                        break;

                    case 'priority':
                        if (alert.priority === 1) {
                            // קבע צבע לפי מצב colorMode
                            const flagColor = this.colorMode === 'background' ? 'white' : 'red';

                            td.innerHTML = `
                                <i class="fas fa-flag" 
                                style="color: ${flagColor}; font-size: 1rem;">
                                </i>`;
                            td.title = "Highest";
                        } else {
                            td.title = "Lowest";
                        }
                        break;

                    case 'severity': {
                        const severityIcon = document.createElement('div');
                        severityIcon.className = `severity-icon ${alert.severity.toLowerCase()}`;
                        severityIcon.title = alert.severity;
                        const icon = document.createElement('i');
                        switch (alert.severity) {
                            case 'CRITICAL': icon.className = 'fas fa-bolt'; break;
                            case 'MAJOR': icon.className = 'far fa-exclamation'; break;
                            case 'UNKNOWN': icon.className = 'fas fa-question'; break;
                            default: icon.className = 'fas fa-info-circle';
                        }
                        severityIcon.appendChild(icon);
                        td.appendChild(severityIcon);
                        break;
                    }

                    case 'status': {
                        const statusIcon = document.createElement('i');
                        statusIcon.className = this.getStatusIconClass(alert.status);
                        if (alert.status === 'ASSIGN' && alert.assignee) {
                            statusIcon.title = `Assigned to: ${alert.assignee}`;
                            statusIcon.setAttribute('data-assignee', alert.assignee);
                        } else {
                            statusIcon.title = this.getStatusText(alert.status);
                        }
                        td.appendChild(statusIcon);
                        break;
                    }

                    case 'actions': {
                        td.className = 'actions-cell';
                        let actionsMenu = '';
                        if (alert.status != 'ACK') actionsMenu += `<a href="#" onclick="alertsManager.acknowledgeAlert('${alert.id}','${alert.idHelix}'); return false;">Acknowledge Event</a>`;
                        if (alert.status !== 'ASSIGN') actionsMenu += `<a href="#" onclick="alertsManager.assignAlert('${alert.id}'); return false;">Assign Event</a>`;
                        actionsMenu += `<a href="#" onclick="alertsManager.addNoteToAlert('${alert.id}'); return false;">Add Note</a>`;
                        if (alert.status !== 'CLOSED') actionsMenu += `<a href="#" onclick="alertsManager.closeAlert('${alert.id}','${alert.idHelix}'); return false;">Close Event</a>`;
                        if (alert.status == 'ACK') actionsMenu += `<a href="#" onclick="alertsManager.setAlertToOpen('${alert.id}','${alert.idHelix}'); return false;">UnAcknowledge Event</a>`;
                        if (alert.status == 'ASSIGN') actionsMenu += `<a href="#" onclick="alertsManager.setAlertToOpen('${alert.id}','${alert.idHelix}'); return false;">UnAssign Event</a>`;

                        td.innerHTML = `
                    <div class="actions-dropdown">
                        <button class="actions-btn" title="פעולות"><i class="fas fa-ellipsis-v"></i></button>
                        <div class="actions-dropdown-content">${actionsMenu}</div>
                    </div>`;

                        const actionsBtn = td.querySelector('.actions-btn');
                        if (actionsBtn) {
                            actionsBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                if (this.selectedAlerts.length > 0) this.clearSelection();
                                this.toggleRowSelection(row, alert.id);
                                const checkbox = row.querySelector('.alert-checkbox');
                                if (checkbox) checkbox.checked = true;
                            });
                        }
                        break;
                    }

                    case 'checkbox': {
                        td.className = 'checkbox-cell';
                        td.style.width = '40px';
                        td.style.textAlign = 'center';
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'alert-checkbox';
                        checkbox.checked = this.selectedAlerts.includes(alert.id);
                        checkbox.addEventListener('change', (e) => {
                            e.stopPropagation();
                            if (e.target.checked) {
                                row.classList.add('selected');
                                if (!this.selectedAlerts.includes(alert.id)) this.selectedAlerts.push(alert.id);
                            } else {
                                row.classList.remove('selected');
                                this.selectedAlerts = this.selectedAlerts.filter(id => id !== alert.id);
                            }
                            const masterCheckbox = document.querySelector('.master-checkbox');
                            if (masterCheckbox) {
                                const allSelected = this.filteredAlerts.length > 0 &&
                                    this.filteredAlerts.every(a => this.selectedAlerts.includes(a.id));
                                const someSelected = this.selectedAlerts.length > 0 && !allSelected;
                                masterCheckbox.checked = allSelected;
                                masterCheckbox.indeterminate = someSelected;
                            }
                            this.updateBulkActionsBar();
                            const screenshotBtn = document.getElementById('screenshotBtn');
                            if (screenshotBtn) screenshotBtn.disabled = this.selectedAlerts.length === 0;
                        });
                        td.appendChild(checkbox);
                        break;
                    }
                }

                row.appendChild(td);
            });

            tableBody.appendChild(row);
        });

        // עדכן את מצב הצ'קבוקס הראשי אם לא במצב מסך מלא
        if (!this.isFullscreenMode) {
            const masterCheckbox = document.querySelector('.master-checkbox');
            if (masterCheckbox) {
                const allSelected = this.filteredAlerts.length > 0 &&
                    this.filteredAlerts.every(alert => this.selectedAlerts.includes(alert.id));

                // אם יש לפחות התראה אחת נבחרת אבל לא כולן - מצב indeterminate
                const someSelected = this.selectedAlerts.length > 0 && !allSelected;

                masterCheckbox.checked = allSelected;
                masterCheckbox.indeterminate = someSelected;
            }
        }

        this.updateSortIcons();

        this.movePopupsOutsideTableContainer();
    }

    showBulkActionsPopup(actionsBtn) {
        const rect = actionsBtn.getBoundingClientRect();
        const hasSelected = this.selectedAlerts.length > 0;
        const selectedCount = this.selectedAlerts.length;

        // סגור פופאפים פתוחים
        document.querySelectorAll('.popup-overlay').forEach(p => {
            if (p.parentNode) p.parentNode.removeChild(p);
        });

        // בניית menuLinks בדיוק כמו בשורה רגילה
        const menuLinks = [];

        menuLinks.push({
            text: `Acknowledge Event${hasSelected ? ` (${selectedCount})` : ''}`,
            action: () => this.bulkAcknowledgeAlerts(),
            disabled: !hasSelected
        });

        menuLinks.push({
            text: `Assign Event${hasSelected ? ` (${selectedCount})` : ''}`,
            action: () => this.bulkAssignAlerts(),
            disabled: !hasSelected
        });

        menuLinks.push({
            text: `Add Note${hasSelected ? ` (${selectedCount})` : ''}`,
            action: () => this.bulkAddNote(),
            disabled: !hasSelected
        });

        menuLinks.push({
            text: `Close Event${hasSelected ? ` (${selectedCount})` : ''}`,
            action: () => this.bulkCloseAlerts(),
            disabled: !hasSelected
        });

        // ====================================================
        // אותו קוד בדיוק של showActionsPopup - רק עם actions
        // ====================================================

        const overlay = document.createElement('div');
        overlay.className = 'popup-overlay';
        overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background-color: rgba(0,0,0,0.1);
        z-index: 9999;
        display: block;
        pointer-events: all;
    `;

        const popup = document.createElement('div');
        popup.className = 'actions-popup';
        popup.style.cssText = `
        background-color: white;
        border-radius: 8px;
        padding: 5px;
        max-width: 250px;
        width: auto;
        position: absolute;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        pointer-events: auto;
    `;

        // מיקום הפופאפ - אותה לוגיקה של showActionsPopup
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceBelow > 200) {
            popup.style.top = `${rect.bottom + 10}px`;
            popup.style.left = `${rect.left}px`;
        } else if (spaceAbove > 200) {
            popup.style.bottom = `${window.innerHeight - rect.top + 10}px`;
            popup.style.left = `${rect.left}px`;
        } else {
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
        }

        const content = document.createElement('div');
        content.className = 'actions-content';

        menuLinks.forEach(link => {
            // divider
            if (link.divider) {
                const divider = document.createElement('div');
                divider.style.cssText = `
                height: 1px;
                background: #eee;
                margin: 4px 0;
            `;
                content.appendChild(divider);
                return;
            }

            const actionBtn = document.createElement('button');
            actionBtn.className = 'action-popup-btn';
            actionBtn.textContent = link.text;
            actionBtn.style.cssText = `
            display: block;
            width: 100%;
            padding: 10px 5px;
            margin: 2px 0;
            background-color: #f8f9fa;
            border: 1px solid #ddd;
            border-radius: 8px;
            text-align: center;
            cursor: ${link.disabled ? 'not-allowed' : 'pointer'};
            transition: all 0.2s;
            font-size: 1rem;
            opacity: ${link.disabled ? '0.4' : '1'};
            color: #333;
        `;

            if (!link.disabled) {
                actionBtn.onmouseover = () => {
                    actionBtn.style.backgroundColor = '#e9ecef';
                    actionBtn.style.borderColor = '#ced4da';
                };
                actionBtn.onmouseout = () => {
                    actionBtn.style.backgroundColor = '#f8f9fa';
                    actionBtn.style.borderColor = '#ddd';
                };
                actionBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    link.action();
                });
            }

            content.appendChild(actionBtn);
        });

        popup.appendChild(content);
        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // סגירה בלחיצה על הרקע
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
        });

        // סגירה כשהעכבר יוצא
        popup.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 100);
        });

        popup.addEventListener('click', (e) => e.stopPropagation());

        document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target) && e.target !== actionsBtn) {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                document.removeEventListener('click', closePopup);
            }
        });
    }

    // פונקציה לצילום מסך של השורות הנבחרות
    async captureScreenshot() {
        try {
            // בדוק אם יש שורות נבחרות
            if (this.selectedAlerts.length === 0) {
                alert('יש לבחור לפחות שורה אחת לצילום');
                return;
            }

            // הצג פופאפ עם מחוון טעינה מיד
            this.createScreenshotLoadingPopup();

            // יצירת אלמנט זמני לצילום
            const tempDiv = document.createElement('div');
            tempDiv.style.position = 'absolute';
            tempDiv.style.left = '-9999px';
            tempDiv.style.background = 'white';
            tempDiv.style.padding = '20px';
            tempDiv.style.borderRadius = '8px';
            tempDiv.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.1)';

            // יצירת כותרת
            const title = document.createElement('h2');
            title.textContent = 'התראות';
            title.style.marginBottom = '15px';
            title.style.color = '#320F5B';
            title.style.textAlign = 'center';
            tempDiv.appendChild(title);

            // יצירת טבלה חדשה
            const table = document.createElement('table');
            table.className = 'alerts-table-screenshot';
            table.style.width = '100%';
            table.style.borderCollapse = 'collapse';
            table.style.direction = 'rtl';

            // הגדרת העמודות שיש לדלג עליהן
            const skipColumns = [];
            const actionsColumnIndex = []; // נשמור את האינדקס של עמודת הפעולות

            // העתקת כותרות הטבלה
            const headerRow = document.createElement('tr');

            // מערך של כותרות הטבלה - נשתמש בו כדי לדעת איזה עמודה היא איזו
            const headers = [];
            const columnsToSkip = ['IP Address', 'Last Update', 'Notes', 'פעולות', ''];

            document.querySelectorAll('.alerts-table th').forEach((th, index) => {
                const headerText = th.textContent.trim();
                const headerHTML = th.innerHTML.trim();

                // בדיקה אם זו עמודת הפעולות או אחת מהעמודות שרוצים לדלג עליהן
                if (columnsToSkip.includes(headerText) ||
                    (headerText === '' && th.querySelector('.fas.fa-ellipsis-v'))) {
                    skipColumns.push(index);
                    if (headerText === '' || headerText === 'פעולות') {
                        actionsColumnIndex.push(index);
                    }
                    return; // דילוג על העמודה
                }

                headers.push(headerText);

                const newTh = document.createElement('th');
                newTh.innerHTML = headerHTML; // שימוש ב-innerHTML כדי לשמר אייקונים
                newTh.style.padding = '10px';
                newTh.style.backgroundColor = '#f2f2f2';
                newTh.style.border = '1px solid #ddd';
                newTh.style.textAlign = 'left';
                headerRow.appendChild(newTh);
            });
            table.appendChild(headerRow);

            // מציאת האינדקסים של עמודות MESSAGE ו-HOST בטבלה החדשה
            const messageIndex = headers.findIndex(header => header === 'Message' || header === 'הודעה');
            const hostIndex = headers.findIndex(header => header === 'Host' || header === 'מארח');

            // העתקת השורות הנבחרות
            this.selectedAlerts.forEach(alertId => {
                const alert = this.alerts.find(a => a.id === alertId);
                if (!alert) return;

                const originalRow = document.querySelector(`.alerts-table tr[data-alert-id="${alertId}"]`);
                if (originalRow) {
                    const newRow = document.createElement('tr');

                    // שמירה על צבע הרקע המקורי של השורה לפי חומרה
                    newRow.style.backgroundColor = this.getSeverityColor(alert.severity);

                    // העתקת כל התאים
                    let adjustedColumnIndex = 0; // אינדקס מותאם לאחר דילוג על עמודות

                    originalRow.querySelectorAll('td').forEach((td, index) => {
                        // דילוג על עמודות שאין צורך להעתיק
                        if (skipColumns.includes(index)) {
                            return;
                        }

                        const newTd = document.createElement('td');

                        // טיפול מיוחד בעמודות MESSAGE ו-HOST
                        if (adjustedColumnIndex === messageIndex || adjustedColumnIndex === hostIndex) {
                            // שימוש בטקסט המלא מהאובייקט המקורי במקום בתצוגה החתוכה
                            if (adjustedColumnIndex === messageIndex) {
                                newTd.textContent = alert.message || td.textContent;
                            } else if (adjustedColumnIndex === hostIndex) {
                                newTd.textContent = alert.host || td.textContent;
                            }

                            // סגנון לתאים עם טקסט ארוך
                            newTd.style.maxWidth = adjustedColumnIndex === messageIndex ? '850px' : '250px';
                            newTd.style.wordBreak = 'break-word';
                            newTd.style.whiteSpace = 'normal';
                        } else {
                            // העתקת התוכן כולל אייקונים
                            if (td.querySelector('.severity-icon') || td.querySelector('.status-open') ||
                                td.querySelector('.status-ack') || td.querySelector('.status-assign')) {
                                // העתקת האייקונים
                                newTd.innerHTML = td.innerHTML;
                            } else {
                                // העתקת טקסט רגיל
                                newTd.textContent = td.textContent;
                            }
                        }

                        // סגנון בסיסי לכל התאים
                        newTd.style.padding = '10px';
                        newTd.style.border = '1px solid #ddd';
                        newTd.style.textAlign = 'left';

                        newRow.appendChild(newTd);
                        adjustedColumnIndex++; // קידום האינדקס המותאם רק אם לא דילגנו על העמודה
                    });

                    table.appendChild(newRow);
                }
            });

            tempDiv.appendChild(table);
            document.body.appendChild(tempDiv);

            // שימוש ב-html2canvas לצילום האלמנט
            try {
                const canvas = await html2canvas(tempDiv, {
                    backgroundColor: '#ffffff',
                    scale: 1.5,
                    logging: false
                });

                // המרה ל-URL של תמונה
                const imgData = canvas.toDataURL('image/png');

                // עדכון הפופאפ הקיים עם התמונה
                this.updateScreenshotPopup(imgData);

            } catch (error) {
                console.error('Error capturing screenshot:', error);
                alert('שגיאה בצילום המסך: ' + error.message);

                // הסר את פופאפ הטעינה במקרה של שגיאה
                const existingPopup = document.getElementById('screenshotPopup');
                if (existingPopup) {
                    document.body.removeChild(existingPopup);
                }
            } finally {
                // הסרת האלמנט הזמני
                document.body.removeChild(tempDiv);
            }

        } catch (error) {
            console.error('Error in screenshot process:', error);
            alert('שגיאה בתהליך צילום המסך: ' + error.message);

            // הסר את פופאפ הטעינה במקרה של שגיאה
            const existingPopup = document.getElementById('screenshotPopup');
            if (existingPopup) {
                document.body.removeChild(existingPopup);
            }
        }
    }

    // פונקציה ליצירת פופאפ עם מחוון טעינה
    createScreenshotLoadingPopup() {
        // בדיקה אם כבר קיים פופאפ ומחיקתו
        const existingPopup = document.getElementById('screenshotPopup');
        if (existingPopup) {
            document.body.removeChild(existingPopup);
        }

        // יצירת אלמנט הפופאפ
        const popup = document.createElement('div');
        popup.id = 'screenshotPopup';
        popup.className = 'message-popup';
        popup.style.position = 'fixed';
        popup.style.top = '0';
        popup.style.left = '0';
        popup.style.width = '100%';
        popup.style.height = '100%';
        popup.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        popup.style.zIndex = '1000';
        popup.style.display = 'flex';
        popup.style.justifyContent = 'center';
        popup.style.alignItems = 'center';

        // תוכן הפופאפ
        const popupContent = document.createElement('div');
        popupContent.className = 'message-popup-content';
        popupContent.style.backgroundColor = '#fff';
        popupContent.style.borderRadius = '8px';
        popupContent.style.padding = '20px';
        popupContent.style.maxWidth = '90%';
        popupContent.style.maxHeight = '90%';
        popupContent.style.overflow = 'auto';
        popupContent.style.position = 'relative';
        popupContent.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.3)';

        // כותרת הפופאפ
        const header = document.createElement('div');
        header.className = 'message-popup-header';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '15px';
        header.style.borderBottom = '1px solid #eee';
        header.style.paddingBottom = '10px';

        const title = document.createElement('h2');
        title.className = 'message-popup-title';
        title.textContent = 'צילום מסך התראות';
        title.style.margin = '0';
        title.style.color = '#320F5B';

        const closeButton = document.createElement('button');
        closeButton.className = 'alerts-popup-close';
        closeButton.innerHTML = '&times;';
        closeButton.style.background = 'none';
        closeButton.style.border = 'none';
        closeButton.style.fontSize = '24px';
        closeButton.style.cursor = 'pointer';
        closeButton.style.color = '#666';
        closeButton.onclick = () => document.body.removeChild(popup);

        header.appendChild(title);
        header.appendChild(closeButton);

        // מחוון טעינה
        const loaderContainer = document.createElement('div');
        loaderContainer.style.textAlign = 'center';
        loaderContainer.style.padding = '40px 20px';

        const loader = document.createElement('div');
        loader.className = 'loader-spinner';
        loader.style.width = '60px';
        loader.style.height = '60px';
        loader.style.margin = '0 auto 20px';
        loader.style.border = '5px solid rgba(102, 126, 234, 0.2)';
        loader.style.borderTop = '5px solid #667eea';
        loader.style.borderRadius = '50%';
        loader.style.animation = 'spin 1s linear infinite';

        const loaderText = document.createElement('p');
        loaderText.textContent = 'מכין צילום מסך...';
        loaderText.style.color = '#667eea';
        loaderText.style.fontSize = '1.1rem';
        loaderText.style.fontWeight = '600';

        loaderContainer.appendChild(loader);
        loaderContainer.appendChild(loaderText);

        // הוספת כל האלמנטים לפופאפ
        popupContent.appendChild(header);
        popupContent.appendChild(loaderContainer);
        popup.appendChild(popupContent);

        // הוספת הפופאפ לדף
        document.body.appendChild(popup);

        // הוספת אנימציה לסיבוב הלודר אם לא קיימת
        if (!document.querySelector('style#loader-animation')) {
            const style = document.createElement('style');
            style.id = 'loader-animation';
            style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
            document.head.appendChild(style);
        }
    }

    // פונקציה לעדכון הפופאפ עם התמונה שנוצרה
    updateScreenshotPopup(imgData) {
        const popup = document.getElementById('screenshotPopup');
        if (!popup) return;

        const popupContent = popup.querySelector('.message-popup-content');
        if (!popupContent) return;

        // שמירת הכותרת והכפתור סגירה
        const header = popupContent.querySelector('.message-popup-header');

        // ניקוי תוכן הפופאפ
        popupContent.innerHTML = '';

        // החזרת הכותרת
        popupContent.appendChild(header);

        // יצירת מיכל לתמונה
        const imageContainer = document.createElement('div');
        imageContainer.style.textAlign = 'center';
        imageContainer.style.marginBottom = '20px';
        imageContainer.style.maxWidth = '100%';
        imageContainer.style.overflow = 'auto';

        // יצירת התמונה
        const image = document.createElement('img');
        image.alt = 'צילום מסך התראות';
        image.style.maxWidth = '100%';
        image.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
        image.src = imgData;

        imageContainer.appendChild(image);

        // כפתורים
        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.justifyContent = 'center';
        buttonsContainer.style.gap = '10px';
        buttonsContainer.style.marginTop = '15px';

        // כפתור הורדה
        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'הורד תמונה';
        downloadButton.style.padding = '10px 20px';
        downloadButton.style.backgroundColor = '#4CAF50';
        downloadButton.style.color = 'white';
        downloadButton.style.border = 'none';
        downloadButton.style.borderRadius = '5px';
        downloadButton.style.cursor = 'pointer';
        downloadButton.style.fontWeight = 'bold';
        downloadButton.onclick = () => {
            const link = document.createElement('a');
            link.href = imgData;
            link.download = `alerts_screenshot_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
            link.click();
        };

        buttonsContainer.appendChild(downloadButton);

        // הוספת כל האלמנטים לפופאפ
        popupContent.appendChild(imageContainer);
        popupContent.appendChild(buttonsContainer);
    }

    // פונקציה עזר לקבלת צבע רקע לפי חומרה
    getSeverityColor(severity) {
        switch (severity.toLowerCase()) {
            case 'critical':
                return '#FF3333'; // אדום
            case 'major':
                return '#FF8C00'; // כתום
            case 'unknown':
                return ' #B04DFF'; // סגול בהיר
            default:
                return 'transparent';
        }
    }

    // ============================================================
    // טעינה דינמית של ExcelJS + FileSaver
    // ============================================================
    async loadExcelJS() {
        return new Promise(async (resolve, reject) => {
            // *** טען ExcelJS אם לא קיים ***
            if (typeof ExcelJS === 'undefined') {
                await new Promise((res, rej) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js';
                    script.onload = res;
                    script.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                    document.head.appendChild(script);
                });
            }

            // *** טען FileSaver אם לא קיים ***
            if (typeof saveAs === 'undefined') {
                await new Promise((res, rej) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';
                    script.onload = res;
                    script.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                    document.head.appendChild(script);
                });
            }

            resolve();
        });
    }


    // ============================================================
    // exportToExcel — מחליף את הגרסה הישנה במלואה
    // ============================================================
    async exportToExcel() {
        try {
            if (this.selectedAlerts.length === 0) {
                alert('יש לבחור לפחות שורה אחת לייצוא');
                return;
            }

            // *** טען ספריות אם צריך ***
            if (typeof ExcelJS === 'undefined' || typeof saveAs === 'undefined') {
                await this.loadExcelJS();
            }

            const exportData = this.prepareExcelData();

            if (exportData.length === 0) {
                alert('לא נמצאו נתונים לייצוא');
                return;
            }

            // ==========================================
            // צבעים
            // ==========================================
            const C = {
                headerBg: '320F5B',   // סגול כהה
                headerFont: 'FFFFFF',

                criticalBg: 'FF4444',   // אדום
                criticalFont: 'FFFFFF',

                majorBg: 'FF8C00',   // כתום
                majorFont: 'FFFFFF',

                unknownBg: 'B04DFF',   // סגול
                unknownFont: 'FFFFFF',

                altRowBg: 'F5F5F5',   // שורות זוגיות
                borderColor: 'BDBDBD',
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
                hAlign = 'left',
                fontSize = 11,
                wrapText = false,
            } = {}) => {
                cell.font = {
                    name: 'Calibri',
                    size: fontSize,
                    bold,
                    color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign,
                    vertical: 'middle',
                    wrapText,
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
            wb.creator = 'NOC Alerts';
            wb.created = new Date();
            wb.modified = new Date();

            const ws = wb.addWorksheet('התראות', {
                views: [{ state: 'frozen', ySplit: 1 }],   // *** הקפאת כותרת ***
                properties: { defaultRowHeight: 18 },
            });

            // ==========================================
            // הגדרת עמודות
            // ==========================================
            const columnLabels = {
                hostAddress: 'IP Address',
                host: 'Host',
                message: 'Message',
                severity: 'Severity',
                status: 'Status',
                priority: 'Priority',
                contacts: 'Responsible Team',
                timestamp: 'Date & Time',
                modified: 'Last Update',
                notes: 'Notes',
            };

            // *** בנה רשימת עמודות לפי הסדר הנוכחי ***
            const exportColumns = this.columnOrder
                .filter(col =>
                    col !== 'actions' &&
                    col !== 'checkbox' &&
                    col !== 'email' &&
                    this.visibleColumns[col] &&
                    columnLabels[col]          // רק עמודות עם תווית
                )
                .reverse();

            // *** הגדר רוחב לכל עמודה ***
            const colWidthMap = {
                hostAddress: 16,
                host: 24,
                message: 50,
                severity: 12,
                status: 12,
                priority: 12,
                contacts: 28,
                timestamp: 20,
                modified: 20,
                notes: 40,
            };

            ws.columns = exportColumns.map(col => ({
                header: columnLabels[col],
                key: col,
                width: colWidthMap[col] || 16,
            }));

            // ==========================================
            // עיצוב שורת כותרות
            // ==========================================
            const headerRow = ws.getRow(1);
            headerRow.height = 24;
            headerRow.eachCell(cell => {
                applyStyle(cell, {
                    bgColor: C.headerBg,
                    fontColor: C.headerFont,
                    bold: true,
                    hAlign: 'center',
                    fontSize: 12,
                });
            });

            // ==========================================
            // הוספת שורות נתונים
            // ==========================================
            exportData.forEach((rowData, rowIdx) => {
                const severity = (rowData['_severity'] || '').toUpperCase();

                // *** בנה שורה לפי סדר העמודות ***
                const rowValues = exportColumns.map(col => {
                    const label = columnLabels[col];
                    return rowData[label] !== undefined ? rowData[label] : '';
                });

                const excelRow = ws.addRow(rowValues);
                excelRow.height = 17;

                // *** קבע צבע לפי Severity ***
                let rowBg = rowIdx % 2 === 1 ? C.altRowBg : null;
                let rowFont = '000000';

                switch (severity) {
                    case 'CRITICAL':
                        rowBg = C.criticalBg;
                        rowFont = C.criticalFont;
                        break;
                    case 'MAJOR':
                        rowBg = C.majorBg;
                        rowFont = C.majorFont;
                        break;
                    case 'UNKNOWN':
                        rowBg = C.unknownBg;
                        rowFont = C.unknownFont;
                        break;
                }

                // *** עצב כל תא ***
                excelRow.eachCell((cell, colNumber) => {
                    const col = exportColumns[colNumber - 1];

                    let bg = rowBg;
                    let font = rowFont;
                    let bold = false;
                    let hAlign = 'left';
                    let wrapText = false;

                    switch (col) {
                        case 'severity':
                        case 'status':
                            hAlign = 'center';
                            bold = true;
                            break;

                        case 'priority':
                            hAlign = 'center';
                            bold = true;
                            break;

                        case 'timestamp':
                        case 'modified':
                            hAlign = 'center';
                            break;

                        case 'notes':
                            wrapText = true;
                            break;

                        case 'hostAddress':
                            hAlign = 'center';
                            break;
                    }

                    applyStyle(cell, { bgColor: bg, fontColor: font, bold, hAlign, wrapText });
                });
            });

            // ==========================================
            // הורד את הקובץ
            // ==========================================
            const now = new Date();
            const dateStr =
                `${now.getDate().toString().padStart(2, '0')}-` +
                `${(now.getMonth() + 1).toString().padStart(2, '0')}-` +
                `${now.getFullYear()}`;
            const timeStr =
                `${now.getHours().toString().padStart(2, '0')}-` +
                `${now.getMinutes().toString().padStart(2, '0')}`;

            const fileName = `alerts_${dateStr}_${timeStr}.xlsx`;

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, fileName);

            const successMessage =
                `${this.selectedAlerts.length} התראות יוצאו בהצלחה לקובץ ${fileName}`;

            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(successMessage, 'success');
            } else {
                this.showSuccess(successMessage);
            }

        } catch (error) {
            console.error('Error exporting to Excel:', error);
            this.showError('שגיאה בייצוא לאקסל: ' + error.message);
        }
    }

    // *** פונקציה חדשה - מחליפה את styleExcelHeaders ***
    styleExcelSheet(ws, cleanData, rawData) {
        if (!cleanData || cleanData.length === 0) return;

        const headers = Object.keys(cleanData[0]);

        // ========================================
        // עיצוב שורת כותרת
        // ========================================
        const headerStyle = {
            font: {
                bold: true,
                color: { rgb: 'FFFFFF' },
                sz: 11
            },
            fill: {
                patternType: 'solid',
                fgColor: { rgb: '320F5B' }  // סגול כהה
            },
            alignment: {
                horizontal: 'center',
                vertical: 'center',
                wrapText: false
            },
            border: {
                top: { style: 'thin', color: { rgb: 'FFFFFF' } },
                bottom: { style: 'thin', color: { rgb: 'FFFFFF' } },
                left: { style: 'thin', color: { rgb: 'FFFFFF' } },
                right: { style: 'thin', color: { rgb: 'FFFFFF' } }
            }
        };

        headers.forEach((header, colIndex) => {
            const cellAddress = XLSXStyle.utils.encode_cell({ r: 0, c: colIndex });
            if (!ws[cellAddress]) return;
            ws[cellAddress].s = headerStyle;
        });

        // ========================================
        // מיפוי צבעי Severity
        // ========================================
        const severityColors = {
            'CRITICAL': {
                bg: 'FF4444',       // אדום
                font: 'FFFFFF'      // טקסט לבן
            },
            'MAJOR': {
                bg: 'FF8C00',       // כתום
                font: 'FFFFFF'      // טקסט לבן
            },
            'UNKNOWN': {
                bg: 'B04DFF',       // סגול
                font: 'FFFFFF'      // טקסט לבן
            }
        };

        // ========================================
        // עיצוב שורות נתונים
        // ========================================
        rawData.forEach((rawRow, rowIndex) => {
            const severity = (rawRow['_severity'] || '').toUpperCase();
            const colorDef = severityColors[severity];

            headers.forEach((header, colIndex) => {
                const cellAddress = XLSXStyle.utils.encode_cell({
                    r: rowIndex + 1,    // +1 כי שורה 0 היא הכותרת
                    c: colIndex
                });

                // *** צור תא אם לא קיים ***
                if (!ws[cellAddress]) {
                    ws[cellAddress] = { t: 's', v: '' };
                }

                // *** בנה סגנון בסיסי לכל תא ***
                const cellStyle = {
                    alignment: {
                        vertical: 'center',
                        wrapText: header === 'Notes' // עטיפת טקסט רק בעמודת הערות
                    },
                    border: {
                        top: { style: 'thin', color: { rgb: 'DDDDDD' } },
                        bottom: { style: 'thin', color: { rgb: 'DDDDDD' } },
                        left: { style: 'thin', color: { rgb: 'DDDDDD' } },
                        right: { style: 'thin', color: { rgb: 'DDDDDD' } }
                    }
                };

                // *** הוסף צבע רקע אם יש Severity מוכר ***
                if (colorDef) {
                    cellStyle.fill = {
                        patternType: 'solid',
                        fgColor: { rgb: colorDef.bg }
                    };
                    cellStyle.font = {
                        color: { rgb: colorDef.font },
                        sz: 10
                    };
                } else {
                    // שורות ללא Severity - רקע לבן
                    cellStyle.fill = {
                        patternType: 'solid',
                        fgColor: { rgb: 'FFFFFF' }
                    };
                    cellStyle.font = {
                        color: { rgb: '333333' },
                        sz: 10
                    };
                }

                ws[cellAddress].s = cellStyle;
            });
        });
    }

    // הכנת הנתונים לייצוא
    prepareExcelData() {
        const exportRows = [];

        const columnLabels = {
            hostAddress: 'IP Address',
            host: 'Host',
            message: 'Message',
            severity: 'Severity',
            status: 'Status',
            priority: 'Priority',
            contacts: 'Responsible Team',
            timestamp: 'Date & Time',
            modified: 'Last Update',
            notes: 'Notes'
        };

        this.selectedAlerts.forEach(alertId => {
            const alert = this.alerts.find(a => a.id === alertId);
            if (!alert) return;

            const exportColumns = this.columnOrder
                .filter(col =>
                    col !== 'actions' &&
                    col !== 'checkbox' &&
                    col !== 'email' &&
                    this.visibleColumns[col]
                )
                .reverse(); // ← הפיכת סדר העמודות: STATUS ראשון, IP אחרון

            const row = {};

            exportColumns.forEach(col => {
                const label = columnLabels[col] || col;

                switch (col) {
                    case 'timestamp':
                    case 'modified':
                        row[label] = alert[col] ? this.formatDate(alert[col]) : '-';
                        break;

                    case 'notes':
                        if (!alert.notes) {
                            row[label] = '';
                        } else if (Array.isArray(alert.notes)) {
                            row[label] = alert.notes
                                .map(n => {
                                    const user = n.userName || 'משתמש';
                                    const date = n.date ? this.formatDate(n.date) : '';
                                    const text = n.text || n;
                                    return `[${user} - ${date}]: ${text}`;
                                })
                                .join('\n');
                        } else {
                            row[label] = String(alert.notes);
                        }
                        break;

                    case 'priority':
                        // *** דגל במקום HIGHEST ***
                        row[label] = alert.priority === 1 ? '🚩' : '';
                        break;

                    default:
                        row[label] = alert[col] !== null && alert[col] !== undefined
                            ? String(alert[col])
                            : '';
                }
            });

            // *** שמירת severity לצביעה פנימית (לא יוצג כעמודה) ***
            row['_severity'] = alert.severity; // ← שדה פנימי לצביעה

            exportRows.push(row);
        });

        return exportRows;
    }

    // פונקציה לפורמט תאריך בפופאפ הערות
    formatNoteDate(dateString) {
        if (!dateString) return '-';
        try {
            const date = new Date(dateString);
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();

            return `${day}/${month}/${year}`;
        } catch (error) {
            console.error('Error formatting note date:', error);
            return dateString || '-';
        }
    }

    getStatusIconClass(status) {
        switch (status) {
            case 'OPEN':
                return 'fas fa-asterisk status-open';
            case 'ACK':
                return 'far fa-check-circle status-ack';
            case 'ASSIGN':
                return 'far fa-user-circle status-assign';
            case 'CLOSED':
                return 'fas fa-times-circle status-closed';
            default:
                return 'fas fa-question-circle status-unknown';
        }
    }

    getStatusText(status) {
        switch (status) {
            case 'OPEN':
                return 'Open';
            case 'ACK':
                return 'Acknowledge';
            case 'ASSIGN':
                return 'Assigned';
            case 'CLOSED':
                return 'Closed';
            default:
                return 'Unknown';
        }
    }

    getStatusIcon(status) {
        switch (status) {
            case 'OPEN':
                return '<i class="fas fa-asterisk status-open"></i>';
            case 'ACK':
                return '<i class="far fa-check-circle status-ack"></i>';
            case 'ASSIGN':
                return '<i class="far fa-user-circle status-assign"></i>';
            case 'CLOSED':
                return '<i class="fas fa-times-circle status-closed"></i>';
            default:
                return '<i class="fas fa-question-circle status-unknown"></i>';
        }
    }

    formatDate(timestamp) {
        if (!timestamp) return '-';
        try {
            // המרת התאריך לאובייקט Date
            const date = new Date(timestamp);

            // בדיקה אם התאריך תקין
            if (isNaN(date.getTime())) return '-';

            // קבלת הערכים בהתאם לאזור הזמן המקומי
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            const hours = date.getHours().toString().padStart(2, '0');
            const minutes = date.getMinutes().toString().padStart(2, '0');

            return `${day}/${month}/${year} ${hours}:${minutes}`;
        } catch (error) {
            console.error('Error formatting date:', error);
            return '-';
        }
    }

    async setAlertToOpen(alertId, idHelix) {
        // פתח את המודל לעדכון סטטוס במקום לבצע את הפעולה ישירות
        this.openStatusUpdateModal(alertId, idHelix, 'OPEN');
    }

    async closeAlert(alertId, idHelix) {
        // פתח את המודל לעדכון סטטוס עם פעולת סגירה
        this.openStatusUpdateModal(alertId, idHelix, 'CLOSE');
    }

    // הוספת פונקציה להצגת הודעת הצלחה
    showSuccess(message) {
        let successElement = document.getElementById('alertsSuccessMessage');

        if (!successElement) {
            successElement = document.createElement('div');
            successElement.id = 'alertsSuccessMessage';
            successElement.className = 'alerts-success';
            successElement.style.backgroundColor = '#4CAF50';
            successElement.style.color = 'white';
            successElement.style.padding = '10px';
            successElement.style.margin = '10px 0';
            successElement.style.borderRadius = '4px';
            successElement.style.textAlign = 'center';

            const container = document.querySelector('.alerts-container');
            if (container) {
                container.prepend(successElement);
            }
        }

        successElement.textContent = message;
        successElement.style.display = 'block';

        // הסתר את ההודעה אחרי 5 שניות
        setTimeout(() => {
            successElement.style.display = 'none';
        }, 5000);
    }

    // הוספת פונקציות לניהול רשימת עובדים
    async loadEmployees() {
        try {
            const response = await fetch('/EmployeeTasks/GetEmployees');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.employees = await response.json();
        } catch (error) {
            console.error('Error fetching employees:', error);
            this.employees = [];
        }
    }

    // שמירת העובד האחרון שנבחר ב-localStorage
    saveLastSelectedEmployee(employeeName) {
        if (employeeName && employeeName !== '') {
            localStorage.setItem('lastSelectedEmployee', employeeName);
        }
    }

    // קבלת העובד האחרון שנבחר מ-localStorage
    getLastSelectedEmployee() {
        return localStorage.getItem('lastSelectedEmployee') || '';
    }

    // הגדרת עובד ברירת מחדל בתיבת הבחירה
    setDefaultEmployee(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        const lastEmployee = this.getLastSelectedEmployee();
        if (lastEmployee) {
            // בדיקה אם העובד קיים באפשרויות
            const optionExists = Array.from(select.options).some(
                option => option.value === lastEmployee
            );

            if (optionExists) {
                select.value = lastEmployee;
            }
        }
    }

    // אכלוס תיבת הבחירה של העובדים
    async populateEmployeeSelect(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        // ניקוי אפשרויות קיימות למעט הראשונה
        select.innerHTML = '<option value="">בחר עובד...</option>';

        // טעינת העובדים אם עדיין לא נטענו
        if (!this.employees || this.employees.length === 0) {
            await this.loadEmployees();
        }

        // הוספת אפשרויות העובדים
        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.name;
            option.textContent = employee.name;
            select.appendChild(option);
        });

        // הגדרת העובד האחרון שנבחר כברירת מחדל
        this.setDefaultEmployee(selectId);
    }

    // הוספת מודל לעדכון סטטוס התראה
    async openStatusUpdateModal(alertId, idHelix, action) {
        try {
            this.isModalOpen = true;
            const alert = this.alerts.find(a => a.id === alertId);
            let modalTitle, actionText, defaultUser = '';
            let warningHtml = ''; // משתנה חדש להודעת האזהרה
            switch (action) {
                case 'ACK':
                    modalTitle = 'שינוי סטאטוס ל-Acknowledge';
                    actionText = 'שנה סטטוס';
                    break;
                case 'OPEN':
                    modalTitle = 'שינוי סטאטוס ל-Open';
                    actionText = 'שנה סטטוס';
                    // הוספת הודעת האזהרה הספציפית
                    warningHtml = `
                    <div style="background-color: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; border: 1px solid #ffeeba; margin-bottom: 15px; font-size: 0.9rem; display: flex; align-items: center;">
                        <i class="fas fa-exclamation-triangle" style="margin-left: 10px;"></i>
                        <span><strong>שים לב!</strong> ההתראה תחזור ממצב ACK למצב OPEN</span>
                    </div>`;
                    break;
                case 'CLOSE':
                    modalTitle = 'סגירת התראה';
                    actionText = 'סגור התראה';
                    // הוספת הודעת האזהרה הספציפית
                    warningHtml = `
                    <div style="background-color: #fff3cd; color: #856404; padding: 10px; border-radius: 4px; border: 1px solid #ffeeba; margin-bottom: 15px; font-size: 0.9rem; display: flex; align-items: center;">
                        <i class="fas fa-exclamation-triangle" style="margin-left: 10px;"></i>
                        <span><strong>שים לב!</strong> ההתראה תיסגר</span>
                    </div>`;
                    break;
                case 'ASSIGN':
                    modalTitle = 'שיוך התראה';
                    actionText = 'שייך התראה';
                    defaultUser = 'mafil@menoramivt.net';
                    break;
                case 'NOTE':
                    modalTitle = 'הוספת הערה להתראה';
                    actionText = 'הוסף הערה';
                    break;
                default:
                    modalTitle = 'עדכון סטטוס התראה';
                    actionText = 'עדכן סטטוס';
            }

            // הגדר את תוכן המודל
            const alertMessage = alert ? alert.message : 'התראה';

            // יצירת אלמנט המודל עם סגנון מוטמע מלא
            const modal = document.createElement('div');
            modal.id = 'statusUpdateModal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            modal.style.zIndex = '9999';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.direction = 'rtl';

            // תוכן המודל
            modal.innerHTML = `
            <div style="background-color: white; padding: 20px; border-radius: 8px; width: 500px; max-width: 90%; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">
                    <h2 style="margin: 0; color: #320F5B; font-size: 1.5rem;">${modalTitle}</h2>
                    <button id="closeStatusModalBtn" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
                </div>
                
                <!-- כאן נכנסת האזהרה אם היא קיימת -->
                ${warningHtml}
                <form id="statusUpdateForm" style="margin: 0;">
                    <input type="hidden" id="statusAlertId" value="${alertId}">
                    <input type="hidden" id="statusAction" value="${action}">
                    
                    <div style="margin-bottom: 20px; max-height: 70vh; overflow-y: auto; padding-right: 5px;">
                        <div style="margin-bottom: 15px;">
                            <span id="statusAlertTitle" style="font-weight: 500;">${alertMessage}</span>
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">
                                <i class="fas fa-user" style="color: #667eea; margin-left: 8px;"></i>
                                שם המשתמש *
                            </label>
                            <select id="statusUserName" class="form-select" required>
                                <option value="">בחר עובד...</option>
                                ${action === 'ASSIGN' ? `<option value="mafil@menoramivt.net" selected>mafil@menoramivt.net</option>` : ''}
                            </select>
                        </div>
                        <div style="margin-bottom: 15px;">
                            <label style="display: block; margin-bottom: 5px; font-weight: 500;">
                                <i class="fas fa-sticky-note" style="color: #667eea; margin-left: 8px;"></i>
                                ${action === 'ASSIGN' ? 'מספר קריאה / הערה *' : 'הערה'}
                            </label>
                            <textarea id="statusNote" class="form-textarea"
                                placeholder="${action === 'ASSIGN' ? 'הזן מספר קריאה או הערה...' : 'הזן הערה...'}" 
                                ${action === 'ASSIGN' || action === 'CLOSE' ? 'required' : ''}></textarea>
                        </div>
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #eee; padding-top: 15px;">
                        <button type="button" id="cancelStatusBtn" class="btn-secondary">
                            <i class="fas fa-times" style="margin-left: 5px;"></i>
                            ביטול
                        </button>
                        <button type="submit" id="statusSubmitBtn" class="btn-primary">
                            <i class="fas fa-save" style="margin-left: 5px;"></i>
                            ${actionText}
                        </button>
                    </div>
                </form>
            </div>
        `;

            // הוספת המודל לדף
            document.body.appendChild(modal);

            // הוספת מאזיני אירועים
            document.getElementById('closeStatusModalBtn').addEventListener('click', () => this.closeStatusUpdateModal());
            document.getElementById('cancelStatusBtn').addEventListener('click', () => this.closeStatusUpdateModal());
            document.getElementById('statusUpdateForm').addEventListener('submit', (e) => {
                e.preventDefault();
                this.submitStatusUpdate(alertId, idHelix, action);
            });

            await this.populateEmployeeSelect('statusUserName');

            // התמקד בשדה הבחירה
            document.getElementById('statusUserName').focus();

        } catch (error) {
            console.error("שגיאה בפתיחת מודל עדכון סטטוס:", error);
            alert(`שגיאה בפתיחת חלון עדכון סטטוס: ${error.message}`);
        }
    }

    // סגירת מודל עדכון סטטוס
    closeStatusUpdateModal() {
        this.isModalOpen = false;
        const modal = document.getElementById('statusUpdateModal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }

    // שליחת עדכון סטטוס
    async submitStatusUpdate(alertId, idHelix, action, userName = null, note = null) {
        // אם לא סופקו שם משתמש והערה כפרמטרים, נסה לקחת אותם מהטופס
        if (userName === null || note === null) {
            const userNameElement = document.getElementById('statusUserName');
            const noteElement = document.getElementById('statusNote');
            if (userNameElement) userName = userNameElement.value;
            if (noteElement) note = noteElement.value;
        }

        if (!userName || ((action === 'ASSIGN' || action === 'CLOSE') && !note)) {
            this.showError(action === 'ASSIGN' ? 'יש למלא את כל השדות' : 'יש לבחור שם משתמש');
            return false; // החזרת ערך שמציין כישלון
        }

        // שמור את העובד האחרון שנבחר
        this.saveLastSelectedEmployee(userName);

        try {
            this.showLoading(true);
            this.closeStatusUpdateModal();

            let endpoint, requestData;
            switch (action) {
                case 'ACK':
                    endpoint = '/Alerts/AcknowledgeEvents';
                    requestData = {
                        eventIds: [idHelix],
                        note: userName + ":" + note
                    };
                    break;
                case 'OPEN':
                    endpoint = '/Alerts/SetAlertStatus';
                    requestData = {
                        eventId: idHelix,
                        status: 'OPEN',
                        note: userName + ":" + note
                    };
                    break;
                case 'ASSIGN':
                    endpoint = '/Alerts/AssignEvents';
                    requestData = {
                        eventIds: [idHelix],
                        assignedUser: "mafil@menoramivt.net",
                        note: userName + ":" + note
                    };
                    break;
                case 'CLOSE':
                    endpoint = '/Alerts/CloseEvents';
                    requestData = {
                        eventIds: [idHelix],
                        note: userName + ":" + note
                    };
                    break;
                case 'NOTE':
                    endpoint = '/Alerts/AddNote';
                    requestData = {
                        eventId: idHelix,
                        alertId: alertId,
                        note: userName + ":" + note
                    };
                    break;
                default:
                    throw new Error('פעולה לא מוכרת');
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestData),
                credentials: 'include'
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }

            const result = await response.json();

            if (result.success) {
                // עדכון מקומי של סטטוס ההתראה (רק אם זה לא הוספת הערה)
                const newStatus = this.getNewStatusFromAction(action);
                if (newStatus) {
                    const alertIndex = this.alerts.findIndex(a => a.id === alertId);
                    if (alertIndex !== -1) {
                        this.alerts[alertIndex].status = newStatus;
                        this.alerts[alertIndex].modified = new Date().toISOString();
                    }
                }

                // עדכון הערות אם יש
                if (note) {
                    const alertIndex = this.alerts.findIndex(a => a.id === alertId);
                    if (alertIndex !== -1) {
                        const newNoteObj = {
                            text: note,
                            date: new Date().toISOString(),
                            userName: userName
                        };
                        const currentNotes = this.alerts[alertIndex].notes;
                        if (Array.isArray(currentNotes)) {
                            this.alerts[alertIndex].notes = [newNoteObj, ...currentNotes];
                        } else if (currentNotes) {
                            this.alerts[alertIndex].notes = [
                                {
                                    text: currentNotes,
                                    date: this.alerts[alertIndex].modified || this.alerts[alertIndex].timestamp,
                                    userName: "משתמש"
                                },
                                newNoteObj
                            ];
                        } else {
                            this.alerts[alertIndex].notes = [newNoteObj];
                        }
                        this.alerts[alertIndex].modified = new Date().toISOString();
                    }
                }

                // בפעולה מרובה - submitBulkAction מטפל בעדכון התצוגה
                if (!this._isBulkOperation) {
                    this.applyFilters();

                    let successMessage;
                    switch (action) {
                        case 'ACK': successMessage = `ההתראה אושרה בהצלחה על ידי ${userName}`; break;
                        case 'OPEN': successMessage = `ההתראה נפתחה מחדש בהצלחה על ידי ${userName}`; break;
                        case 'ASSIGN': successMessage = `ההתראה שויכה בהצלחה ל-${userName}`; break;
                        case 'CLOSE': successMessage = `ההתראה נסגרה בהצלחה על ידי ${userName}`; break;
                        case 'NOTE': successMessage = `ההערה נוספה בהצלחה על ידי ${userName}`; break;
                    }

                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(successMessage, 'success');
                    } else {
                        this.showSuccess(successMessage);
                    }
                }

                // הוספת הערה אחרי ACK/OPEN/ASSIGN
                if ((action === 'ACK' || action === 'OPEN' || action === 'ASSIGN') && note) {
                    setTimeout(async () => {
                        try {
                            await fetch('/Alerts/AddNote', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Accept': 'application/json'
                                },
                                body: JSON.stringify({
                                    eventId: idHelix,
                                    alertId: alertId,
                                    note: userName + ":" + note
                                }),
                                credentials: 'include'
                            });
                        } catch (noteError) {
                            console.error('Error adding note after status update:', noteError);
                        }
                    }, 3000);
                }

                this.showLoading(false);
                return true;

            } else {
                this.showError(result.message || 'שגיאה בביצוע הפעולה');
                this.showLoading(false);
                return false;
            }

        } catch (error) {
            console.error(`Error in action (${action}):`, error);
            this.showLoading(false);
            this.showError('שגיאה בביצוע הפעולה: ' + error.message);
            return false;
        }
    }

    async acknowledgeAlert(alertId, idHelix) {
        // פתח את המודל לעדכון סטטוס במקום לבצע את הפעולה ישירות
        this.openStatusUpdateModal(alertId, idHelix, 'ACK');
    }

    async assignAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (!alert) return;

        // פתח את המודל לעדכון סטטוס במקום לבצע את הפעולה ישירות
        this.openStatusUpdateModal(alertId, alert.idHelix, 'ASSIGN');
    }

    async addNoteToAlert(alertId) {
        try {
            const alert = this.alerts.find(a => a.id === alertId);
            if (!alert) return;

            // פתח את המודל להוספת הערה באמצעות הפונקציה הקיימת
            // נשתמש בפעולה מיוחדת 'NOTE' שתטופל בתוך openStatusUpdateModal
            this.openStatusUpdateModal(alertId, alert.idHelix, 'NOTE');
        } catch (error) {
            console.error("שגיאה בפתיחת מודל הוספת הערה:", error);
            this.showError(`שגיאה בפתיחת חלון הוספת הערה: ${error.message}`);
        }
    }

    updateAlertStatus(alertId, newStatus) {
        const alertIndex = this.alerts.findIndex(a => a.id === alertId);
        if (alertIndex !== -1) {
            this.alerts[alertIndex].status = newStatus;
            this.alerts[alertIndex].modified = new Date().toISOString(); // *** תיקון: ISO string במקום Date.now() ***
            this.applyFilters(); // רענן את התצוגה
        }
    }

    removeAlert(alertId) {
        // הסרה מקומית של התראה
        this.alerts = this.alerts.filter(a => a.id !== alertId);
        this.applyFilters(); // רענן את התצוגה
    }

    sendMail(alertId) {
        try {
            const alert = this.alerts.find(a => a.id === alertId);
            if (!alert) {
                throw new Error('התראה לא נמצאה');
            }

            // יצירת כתובת מייל עם פרטי ההתראה
            const subject = `Problem: ${alert.host} - ${alert.message}`;
            const body = `${alert.message}`;
            const cc = 'noc@menora.co.il'; // כתובת ה-NOC

            // בדיקה שיש כתובת אימייל תקינה
            if (!alert.contacts || !alert.contacts.includes('@')) {
                throw new Error('כתובת אימייל לא תקינה או ריקה');
            }

            // פתיחת חלון מייל חדש
            window.location.href = `mailto:${alert.contacts}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}&cc=${encodeURIComponent(cc)}`;
        } catch (error) {
            console.error('Error sending mail:', error);
            this.showError('שגיאה בשליחת אימייל: ' + error.message);
        }
    }
}

function addCopyOnClickToCell(cell, content) {
    cell.addEventListener('dblclick', (e) => {
        // הסרת שורת הקוד הזו כדי לאפשר לאירוע להתפשט לשורה
        // e.stopPropagation(); 

        // יצירת אלמנט זמני להעתקה
        const tempElement = document.createElement('textarea');
        tempElement.value = content;
        document.body.appendChild(tempElement);
        tempElement.select();

        try {
            // ניסיון להעתיק את הטקסט
            const successful = document.execCommand('copy');

            if (successful) {
                // הצגת אנימציה או הודעה שהתוכן הועתק
                const originalBackground = cell.style.backgroundColor;

                setTimeout(() => {
                    cell.style.backgroundColor = originalBackground;
                }, 300);

                // הצגת הודעה קטנה
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(`הערך "${content}" הועתק ללוח`, 'success');
                } else {
                    // אם NotificationManager לא קיים, נציג הודעה פשוטה
                    const notification = document.createElement('div');
                    notification.textContent = `הערך "${content}" הועתק ללוח`;
                    notification.style.position = 'fixed';
                    notification.style.bottom = '20px';
                    notification.style.right = '20px';
                    notification.style.backgroundColor = '#28a745';
                    notification.style.color = 'white';
                    notification.style.padding = '10px 20px';
                    notification.style.borderRadius = '4px';
                    notification.style.zIndex = '9999';
                    notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';

                    document.body.appendChild(notification);

                    setTimeout(() => {
                        document.body.removeChild(notification);
                    }, 2000);
                }
            }
        } catch (err) {
            console.error('שגיאה בהעתקת הטקסט:', err);
        }

        // הסרת האלמנט הזמני
        document.body.removeChild(tempElement);
    });
}

// יצירת מופע של מנהל ההתראות
const alertsManager = new AlertsManager();
document.addEventListener('DOMContentLoaded', () => {
    alertsManager.initialize();
});