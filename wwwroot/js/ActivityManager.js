class ActivityManager {
    constructor() {
        this.activities = [];
        this.currentActivityId = null;
        this.currentDate = '';
        this.draggedElement = null;
        this.draggedTaskElement = null;

        this.employees = [];
        this.activityDatePicker = null;
        this.taskDatePicker = null;

        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;

        this.currentSearchTerm = '';
        this.sortMode = 'auto';
        this.currentSort = 'timeGrouped';
        this.originalTasksOrder = [];

        this.currentUser = null;
        this.alarmCheckInterval = null;
        this.shownAlarms = new Set();
        this.currentTaskPopup = null;
        this.isReadOnly = false;
        this.isAdmin = false;

        this.currentActivityPermissions = []; // הרשאות לפעילות הנוכחית
        this.currentUserHasPermission = false; // האם למשתמש יש הרשאה לפעילות הנוכחית
    }

    async checkCurrentUserPermission(activityId) {
        try {
            const response = await fetch(
                `/Activities/CheckUserPermission?activityId=${activityId}`,
                { credentials: 'include' }
            );
            const result = await response.json();
            if (result.success) {
                this.currentUserHasPermission = result.hasPermission;
            } else {
                this.currentUserHasPermission = false;
            }
        } catch (err) {
            console.warn('Could not check permission:', err);
            this.currentUserHasPermission = false;
        }
    }

    async loadEmployees() {
        try {
            const response = await fetch('/EmployeeTasks/GetEmployees');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const employees = await response.json();
            this.employees = employees;
        } catch (error) {
            console.error('Error fetching employees:', error);
            this.employees = [];
        }
    }

    populateEmployeeSelect(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        // Clear existing options except the first one
        select.innerHTML = '<option value="">בחר עובד...</option>';

        // Add employee options
        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.name;
            option.textContent = employee.name;
            select.appendChild(option);
        });

        // Set last selected employee as default
        this.setDefaultEmployee(selectId);
    }

    // Get last selected employee from localStorage
    getLastSelectedEmployee() {
        return userSettings.getItem('lastSelectedEmployee') || '';
    }

    // Set default employee in select dropdown
    setDefaultEmployee(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        const lastEmployee = this.getLastSelectedEmployee();
        if (lastEmployee) {
            // Check if employee exists in options
            const optionExists = Array.from(select.options).some(
                option => option.value === lastEmployee
            );

            if (optionExists) {
                select.value = lastEmployee;
            }
        }
    }

    formatDate(isoDate) {
        if (!isoDate) return '';
        const date = new Date(isoDate);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    // Initialize
    async initialize() {
        this.currentDate = new Date().toISOString().split('T')[0];

        // *** טען משתמש נוכחי ***
        await this.loadCurrentUser();

        // Load employees first
        await this.loadEmployees();

        // אתחל את בוררי התאריכים
        this.initializeDatePickers();

        // הוסף פקדי מיון
        this.addSortControls();

        document.querySelector('.task-controls-row').style.display = 'none';
        await this.loadActivities();
        this.injectFiltersBar();

        // Auto-archive expired activities
        await this.autoArchiveExpiredActivities();

        this.renderActivityTabs();

        if (this.activities.length > 0) {
            this.displayEmptyState();
        } else {
            // No activities - show default message
            const dateDisplay = document.getElementById('activityDateDisplay');
            if (dateDisplay) {
                dateDisplay.textContent = 'לא נבחרה פעילות';
            }
        }
        this.startActivityAlarmMonitoring();
        this.startAutoRefresh();
    }

    injectFiltersBar() {
        const placeholder = document.getElementById('taskFiltersBar');
        if (!placeholder) {
            console.warn('taskFiltersBar not found');
            return;
        }

        const html = this.getFiltersBarHTML();

        placeholder.insertAdjacentHTML('afterend', html);
        placeholder.remove();
    }

    isUserAdmin() {
        if (!this.currentUser) return false;
        return this.currentUser.role === 'Admin' || 
            this.currentUser.role === 'NOC' ||
            this.isAdmin === true;  // ← גם הדגל מה-Dashboard
    }

    async loadCurrentUser() {
        try {
            // *** נסה קודם מ-sessionStorage ***
            const cached = sessionStorage.getItem('currentUser');
            if (cached) {
                this.currentUser = JSON.parse(cached);
                return;
            }

            const response = await fetch('/Auth/Me', {
                credentials: 'include'
            });
            if (response.ok) {
                this.currentUser = await response.json();
                sessionStorage.setItem(
                    'currentUser',
                    JSON.stringify(this.currentUser)
                );
            }
        } catch (err) {
            console.warn('Could not load current user:', err);
            this.currentUser = null;
        }
    }

    handleApiResponse(response) {
        if (response && response.requireLogin === true) {
            if (window.activitiesDashboard &&
                typeof window.activitiesDashboard.showLoginRequired === 'function') {
                window.activitiesDashboard.showLoginRequired();
            }
            return false;
        }
        return true;
    }

    // Load activities from server
    async loadActivities() {
        try {
            const showArchived = document.getElementById('showArchivedActivities')?.checked || false;
            const response = await fetch(`/Activities/GetActivities?includeArchived=${showArchived}`);
            const data = await response.json();

            if (data.error) {
                console.error('Error loading activities:', data.error);
                this.activities = [];
            } else {
                this.activities = data;
            }

            // *** תיקון: בדוק אם האלמנט קיים לפני קריאת הערך ***
            const sortOrderEl = document.getElementById('activitySortOrder');
            const sortOrder = sortOrderEl ? sortOrderEl.value : 'date';
            this.sortActivities(sortOrder);

        } catch (error) {
            console.error('Error fetching activities:', error);
            this.activities = [];
        }
    }

    // Display empty state
    displayEmptyState() {

        document.querySelector('.task-controls-row').style.display = 'none';

        // הסתר כפתור סינון ושורת סינון
        const filterBtn = document.getElementById('filterToggleBtn');
        if (filterBtn) filterBtn.style.display = 'none';

        const filterBar = document.getElementById('taskFiltersBar');
        if (filterBar) filterBar.style.display = 'none';

        const container = document.getElementById('activityTasksContainer');

        if (!container) {
            console.error('Element with ID "activityTasksContainer" not found in the document');
            return;
        }

        container.innerHTML = `
    <div class="tasks-empty">
        <i class="fas fa-clipboard-list"></i><br>
        בחר פעילות להצגת משימות
    </div>`;

        const searchTask = document.querySelector('.task-search-container');
        if (searchTask) {
            searchTask.style.display = 'none';
        }

        document.getElementById('taskSearchInput').value = ''

        const clearBtn = document.querySelector('.task-search .clear-search-btn');
        if (clearBtn) {
            clearBtn.style.display = 'none';
        }
    }

    sortActivities(sortBy) {
        switch (sortBy) {
            case 'date':
                this.activities.sort((a, b) => {
                    if (!a.activityDate) return 1;
                    if (!b.activityDate) return -1;
                    return new Date(a.activityDate) - new Date(b.activityDate);
                });
                break;
            case 'name':
                this.activities.sort((a, b) => a.name.localeCompare(b.name));
                break;
        }

        this.renderActivityTabs();
    }

    // הוסף פונקציה לסינון פעילויות לפי סטטוס ארכיון
    async filterActivitiesByArchiveStatus() {
        const showArchivedCheckbox = document.getElementById('showArchivedActivities');
        if (!showArchivedCheckbox) {
            console.error('Element with ID "showArchivedActivities" not found');
            return;
        }

        const showArchived = showArchivedCheckbox.checked;

        // טען מחדש את הפעילויות מהשרת עם הפרמטר המתאים
        await this.loadActivities();
        this.renderActivityTabs();

        const activitySearchValue = document.getElementById('activitySearchInput').value;
        this.searchActivities(activitySearchValue);

        // אם יש פעילות נוכחית נבחרת, בדוק אם היא עדיין בתוך הפעילויות
        if (this.currentActivityId) {
            const currentActivityStillVisible = this.activities.some(a => a.id === this.currentActivityId);

            // אם הפעילות הנוכחית לא נמצאת בפעילויות, נקה את התצוגה
            if (!currentActivityStillVisible) {
                this.currentActivityId = null;

                const nameDisplay = document.getElementById('activityNameDisplay');
                if (nameDisplay) {
                    nameDisplay.textContent = '';
                }

                const dateDisplay = document.getElementById('activityDateDisplay');
                if (dateDisplay) {
                    dateDisplay.textContent = 'לא נבחרה פעילות';
                }

                this.displayEmptyState();
            }
        }
    }

    // סנן את הפעילויות לפי מונח החיפוש
    searchActivities(searchTerm) {

        // הצג/הסתר את כפתור הניקוי בהתאם לתוכן החיפוש
        const clearBtn = document.querySelector('.activity-search .clear-search-btn');
        if (clearBtn) {
            clearBtn.style.display = searchTerm ? 'flex' : 'none';
        }

        if (!searchTerm || searchTerm.trim() === '') {
            // אם אין מונח חיפוש, הצג את כל הפעילויות
            this.loadActivities().then(() => {
                this.renderActivityTabs();

                // הסר הודעת "אין תוצאות חיפוש" אם קיימת
                const tabsWrapper = document.querySelector('.activity-tabs-wrapper');
                const noSearchResults = tabsWrapper.querySelector('.no-search-results');
                if (noSearchResults) {
                    noSearchResults.remove();
                }

                // הסר את המחלקה hidden מ-no-activities אם קיימת
                const noActivities = document.querySelector('.no-activities');
                if (noActivities) {
                    noActivities.classList.remove('hidden');
                }
            });
            return;
        }

        searchTerm = searchTerm.trim().toLowerCase();

        // סנן את הפעילויות לפי מונח החיפוש
        const filteredActivities = this.activities.filter(activity => {
            const name = activity.name.toLowerCase();
            const description = activity.description ? activity.description.toLowerCase() : '';
            const date = activity.activityDate ? this.formatDate(activity.activityDate).toLowerCase() : '';

            return name.includes(searchTerm) ||
                description.includes(searchTerm) ||
                date.includes(searchTerm);
        });

        // שמור את הפעילויות המקוריות זמנית
        const originalActivities = [...this.activities];

        // החלף זמנית את מערך הפעילויות עם התוצאות המסוננות
        this.activities = filteredActivities;

        // רנדר את הטאבים עם התוצאות המסוננות
        this.renderActivityTabs();

        // הוסף הודעה אם אין תוצאות
        const tabsWrapper = document.querySelector('.activity-tabs-wrapper');
        if (filteredActivities.length === 0 && tabsWrapper) {
            // הסתר את no-activities אם קיים
            const container = document.getElementById('activityTabsContainer');
            const noActivities = container.querySelector('.no-activities');
            if (noActivities) {
                noActivities.classList.add('hidden');
            }

            // הסר הודעת חיפוש קודמת אם קיימת
            const oldNoSearchResults = tabsWrapper.querySelector('.no-search-results');
            if (oldNoSearchResults) {
                oldNoSearchResults.remove();
            }

            // הוסף הודעת "אין תוצאות חיפוש"
            const noSearchResults = document.createElement('div');
            noSearchResults.className = 'no-search-results';
            noSearchResults.innerHTML = `
            <i class="fas fa-search"></i>
            <p>לא נמצאו פעילויות התואמות לחיפוש "${searchTerm}"</p>
        `;
            tabsWrapper.appendChild(noSearchResults);

            document.getElementById('taskSearchInput').value = ''

            // הצג/הסתר את כפתור הניקוי בהתאם לתוכן החיפוש
            const clearBtn = document.querySelector('.task-search .clear-search-btn');
            if (clearBtn) {
                clearBtn.style.display = searchTerm ? 'flex' : 'none';
            }

            // אפס את התצוגה
            this.currentActivityId = null;

            // אפס את שם הפעילות
            const nameDisplay = document.getElementById('activityNameDisplay');
            if (nameDisplay) {
                nameDisplay.textContent = '';
            }

            // אפס את תאריך הפעילות
            const dateDisplay = document.getElementById('activityDateDisplay');
            if (dateDisplay) {
                dateDisplay.textContent = 'לא נבחרה פעילות';
            }

            // הצג מצב ריק
            this.displayEmptyState();
        }

        // החזר את מערך הפעילויות המקורי
        this.activities = originalActivities;
    }

    _applySearchFilter(tasks) {
        const term = this.currentSearchTerm.toLowerCase();
        if (!term) return tasks;

        return tasks.filter(task => {
            return [
                task.title,
                task.description,
                task.responsiblePerson,
                task.secondaryResponsible,
                task.notes,
                task.systemName,
                task.environment,
                task.dependency,
                task.disruptionDuration,
                task.impact,
                task.alertsToCheck
            ].some(field => (field || '').toLowerCase().includes(term));
        });
    }

    // סנן את המשימות לפי מונח החיפוש
    searchTasks(searchTerm) {
        if (!this.currentActivityId) return;

        const clearBtn = document.querySelector('.task-search .clear-search-btn');
        if (clearBtn) {
            clearBtn.style.display = searchTerm ? 'flex' : 'none';
        }

        // שמור את מונח החיפוש ב-state
        this.currentSearchTerm = (searchTerm || '').trim();

        // טען מחדש עם שניהם ביחד
        this.loadActivityTasks(this.currentActivityId, this.currentDate);
    }

    // הוסף פונקציה לארכוב פעילות
    async archiveActivity(activityId) {
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        const newStatus = !activity.archived;

        // *** חדש: הוצאה מארכיון רק לאדמין ***
        if (activity.archived && !this.isUserAdmin()) {
            // newStatus = false = הוצאה מארכיון
        }

        if (activity.archived && !this.isUserAdmin()) {
            NotificationManager.show(
                'רק מנהל מערכת יכול להוציא פעילות מהארכיון',
                'warning'
            );
            return;
        }
        const actionText = newStatus ? 'להעביר לארכיון' : 'להוציא מהארכיון';

        if (!confirm(`האם ${actionText} את הפעילות "${activity.name}"?`)) {
            return;
        }

        try {
            const response = await fetch('/Activities/UpdateActivity', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: activityId,
                    archived: newStatus
                })
            });

            const result = await response.json();

            if (result.success) {
                await this.loadActivities();
                this.filterActivitiesByArchiveStatus();

                const message = newStatus ?
                    'הפעילות הועברה לארכיון בהצלחה' :
                    'הפעילות הוצאה מהארכיון בהצלחה';
                NotificationManager.show(message, 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בעדכון הפעילות', 'error');
            }
        } catch (error) {
            console.error('Error archiving activity:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    /**
     * Auto-archive activities whose date has passed
     * Checks all non-archived activities and archives those with past dates
     */
    async autoArchiveExpiredActivities() {
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0); // Reset time to start of day for accurate comparison

            let archivedCount = 0;
            const activitiesToArchive = [];

            // Find activities that need to be archived
            for (const activity of this.activities) {
                // Skip if already archived or has no date
                if (activity.archived || !activity.activityDate) {
                    continue;
                }

                const activityDate = new Date(activity.activityDate);
                activityDate.setHours(0, 0, 0, 0);

                // If activity date is in the past, mark for archiving
                if (activityDate < today) {
                    activitiesToArchive.push(activity);
                }
            }

            // Archive each expired activity
            for (const activity of activitiesToArchive) {
                try {
                    const response = await fetch('/Activities/UpdateActivity', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: activity.id,
                            archived: true
                        })
                    });

                    const result = await response.json();

                    if (result.success) {
                        archivedCount++;
                    } else {
                        console.error(`Failed to auto-archive activity ${activity.name}:`, result.error);
                    }
                } catch (error) {
                    console.error(`Error auto-archiving activity ${activity.name}:`, error);
                }
            }

            // If any activities were archived, reload and update display
            if (archivedCount > 0) {
                await this.loadActivities();
                this.renderActivityTabs();

                // If current activity was archived, clear selection
                if (this.currentActivityId && activitiesToArchive.some(a => a.id === this.currentActivityId)) {
                    this.currentActivityId = null;
                    document.getElementById('activityNameDisplay').textContent = '';
                    document.getElementById('activityDateDisplay').textContent = 'לא נבחרה פעילות';
                    this.displayEmptyState();
                }

                // Optional: Show notification to user
                NotificationManager.show(
                    `${archivedCount} פעילויות שתאריכן עבר הועברו אוטומטית לארכיון`,
                    'info'
                );
            }

            return archivedCount;
        } catch (error) {
            console.error('Error in auto-archive process:', error);
            return 0;
        }
    }

    // הוסף פונקציה לאתחול אירועי גרירה ושחרור לאזור העלאת קבצים
    initializeFileDragDrop() {
        const fileUploadArea = document.querySelector('#importExcelModal .file-upload-area');
        if (!fileUploadArea) return;

        // מנע ברירת מחדל כדי לאפשר שחרור קבצים
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            fileUploadArea.addEventListener(eventName, this.preventDefaults, false);
        });

        // הוסף/הסר מחלקות כדי לשנות את המראה בזמן גרירה
        ['dragenter', 'dragover'].forEach(eventName => {
            fileUploadArea.addEventListener(eventName, () => {
                fileUploadArea.classList.add('highlight');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            fileUploadArea.addEventListener(eventName, () => {
                fileUploadArea.classList.remove('highlight');
            }, false);
        });

        // טיפול בשחרור קבצים
        fileUploadArea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;

            if (files.length > 0) {
                // עדכן את שדה הקלט עם הקובץ שנגרר
                const fileInput = document.getElementById('excelFileInput');
                if (fileInput) {
                    // לא ניתן להגדיר ישירות את files, אז נשתמש בDataTransfer
                    const newDt = new DataTransfer();
                    newDt.items.add(files[0]);
                    fileInput.files = newDt.files;

                    // הפעל את אירוע השינוי ידנית
                    const event = new Event('change', { bubbles: true });
                    fileInput.dispatchEvent(event);
                }
            }
        }, false);

        // אתחול בורר תאריך לייבוא אקסל
        this.excelImportDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#excelImportDateHidden",
            (selectedDates, dateStr) => {
                this.handleExcelImportDateChange(dateStr);
            }
        );
    }

    // הוסף כפתור ניקוי לתאריך ייבוא אקסל
    addExcelImportDateClearButton() {
        const dateInputWrapper = document.querySelector('#importExcelModal .date-input-wrapper');
        if (!dateInputWrapper) return;

        // בדוק אם כפתור כבר קיים
        if (!dateInputWrapper.querySelector('.date-clear-btn')) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'date-clear-btn';
            clearBtn.innerHTML = '<i class="fas fa-times"></i>';
            clearBtn.style.display = 'none';
            clearBtn.title = 'נקה תאריך';
            clearBtn.onclick = () => this.clearExcelImportDate();

            dateInputWrapper.appendChild(clearBtn);
        }
    }

    // עדכן את הצגת כפתור ניקוי תאריך ייבוא אקסל
    updateExcelImportDateClearButton(show) {
        const clearBtn = document.querySelector('#importExcelModal .date-input-wrapper .date-clear-btn');
        if (clearBtn) {
            clearBtn.style.display = show ? 'block' : 'none';
        }
    }

    // פתיחת בורר תאריך לייבוא אקסל
    openExcelImportDatePicker() {
        if (this.excelImportDatePicker) {
            this.excelImportDatePicker.open();
        }
    }

    // טיפול בשינוי תאריך ייבוא אקסל
    handleExcelImportDateChange(dateStr) {
        if (dateStr) {
            const formattedDate = FlatpickrHelper.formatDateToDisplay(dateStr);
            document.getElementById('excelImportDate').value = formattedDate;
            document.getElementById('excelImportDateClear').style.display = 'inline-block';
        } else {
            document.getElementById('excelImportDate').value = '';
            document.getElementById('excelImportDateClear').style.display = 'none';
        }
    }

    // ניקוי תאריך ייבוא אקסל
    clearExcelImportDate() {
        if (this.excelImportDatePicker) {
            this.excelImportDatePicker.clear();
        }
        document.getElementById('excelImportDate').value = '';
        document.getElementById('excelImportDateHidden').value = '';
        document.getElementById('excelImportDateClear').style.display = 'none';
    }

    // פונקציית עזר למניעת התנהגות ברירת מחדל
    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // הוסף פונקציה לפתיחת מודל העלאת אקסל
    openImportExcelModal() {
        this.isModalOpen = true;
        document.getElementById('importExcelModal').style.display = 'block';
        document.body.style.overflow = 'hidden';

        document.getElementById('excelImportDateHidden').value = '';
        document.getElementById('excelImportDate').value = '';

        // אתחל את אירועי הגרירה והשחרור
        this.initializeFileDragDrop();
    }

    // הוסף פונקציה לסגירת מודל העלאת אקסל
    closeImportExcelModal() {
        this.isModalOpen = false;
        document.getElementById('importExcelModal').style.display = 'none';
        document.body.style.overflow = 'auto';

        // נקה את הקובץ שנבחר
        this.clearSelectedFile();

        // נקה את התאריך
        this.clearExcelImportDate();
    }

    // הוסף פונקציה להעלאת קובץ אקסל
    async importExcelActivity() {
        const fileInput = document.querySelector('#importExcelModal #excelFileInput');
        if (!fileInput.files || fileInput.files.length === 0) {
            NotificationManager.show('יש לבחור קובץ', 'warning');
            return;
        }

        const file = fileInput.files[0];
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const isWord = file.name.endsWith('.docx') || file.name.endsWith('.doc');

        if (!isExcel && !isWord) {
            NotificationManager.show(
                'יש לבחור קובץ אקסל (.xlsx/.xls) או Word (.docx/.doc)',
                'warning'
            );
            return;
        }

        const submitBtn = document.getElementById('excelImportSubmitBtn');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מייבא...';

        try {
            const formData = new FormData();

            if (isWord) {
                formData.append('wordFile', file);   //מתאים ל-ImportFromWord(IFormFile wordFile)
            } else {
                formData.append('excelFile', file);  //מתאים ל-ImportFromExcel(IFormFile excelFile)
            }

            const activityDateInput = document.getElementById('excelImportDateHidden');
            if (activityDateInput && activityDateInput.value) {
                formData.append('activityDate', activityDateInput.value);
            }

            const endpoint = isWord
                ? '/Activities/ImportFromWord'
                : '/Activities/ImportFromExcel';

            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(
                    `הקובץ יובא בהצלחה! נוספה פעילות: ${result.activityName}`,
                    'success'
                );
                this.closeImportExcelModal();
                await this.loadActivities();
                this.renderActivityTabs();

                // *** הענק הרשאה אוטומטית למנהל הפעילות שיובא מהאקסל ***
                if (result.activityId && result.activityManager) {
                    await this.grantManagerPermissionAuto(
                        result.activityId,
                        result.activityManager
                    );
                }

                if (result.activityId) {
                    this.selectActivity(result.activityId);
                }
            } else {
                NotificationManager.show(result.error || 'שגיאה בייבוא הקובץ', 'error');
            }
        } catch (error) {
            console.error('Error importing file:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }

    // טיפול בבחירת קובץ
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // בדוק אם הקובץ הוא אקסל
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const isWord = file.name.endsWith('.docx') || file.name.endsWith('.doc');

        if (!isExcel && !isWord) {
            NotificationManager.show('יש לבחור קובץ אקסל (.xlsx/.xls) או Word (.docx/.doc)', 'warning');
            event.target.value = '';
            return;
        }

        // הצג את פרטי הקובץ שנבחר
        const fileUploadArea = document.querySelector('#importExcelModal .file-upload-area');
        const uploadPreview = document.getElementById('uploadActivityPreview');
        const uploadFileName = document.getElementById('uploadActivityFileName');
        const uploadFileSize = document.getElementById('uploadActivityFileSize');

        // וודא שכל האלמנטים קיימים
        if (!fileUploadArea || !uploadPreview || !uploadFileName || !uploadFileSize) {
            console.error('Missing required elements for file preview');
            return;
        }

        // הגדר את שם הקובץ וגודלו
        uploadFileName.textContent = file.name;

        // הצג גודל קובץ בפורמט מתאים
        let fileSize = file.size;
        let fileSizeDisplay = '';

        if (fileSize < 1024) {
            fileSizeDisplay = fileSize + ' bytes';
        } else if (fileSize < 1024 * 1024) {
            fileSizeDisplay = (fileSize / 1024).toFixed(2) + ' KB';
        } else {
            fileSizeDisplay = (fileSize / (1024 * 1024)).toFixed(2) + ' MB';
        }

        uploadFileSize.textContent = fileSizeDisplay;

        // הסתר את אזור גרירת הקובץ והצג את תצוגת הקובץ
        const fileUploadLabel = fileUploadArea.querySelector('#importExcelModal .file-upload-label');
        if (fileUploadLabel) {
            fileUploadLabel.style.display = 'none';
        }

        uploadPreview.style.display = 'flex';
    }

    // ניקוי קובץ שנבחר
    clearSelectedFile() {
        const fileInput = document.querySelector('#importExcelModal #excelFileInput');
        const uploadPreview = document.getElementById('uploadActivityPreview');
        const fileUploadLabel = document.querySelector('#importExcelModal .file-upload-label');
        const fileUploadArea = document.querySelector('#importExcelModal .file-upload-area');

        if (fileInput) {
            fileInput.value = '';
        }

        if (uploadPreview) {
            uploadPreview.style.display = 'none';
        }

        if (fileUploadLabel) {
            fileUploadLabel.style.display = 'flex';
        }
    }

    // Render activity tabs
    renderActivityTabs() {
        const container = document.getElementById('activityTabsContainer');

        // בדיקה אם האלמנט קיים בדף
        if (!container) {
            console.error('Element with ID "activityTabsContainer" not found in the document');
            return; // יציאה מהפונקציה אם האלמנט לא קיים
        }

        // בדוק אם יש צורך לאתחל את המבנה הבסיסי
        let tabsWrapper = container.querySelector('.activity-tabs-wrapper');

        // אם אין wrapper, צור את המבנה הבסיסי פעם אחת
        if (!tabsWrapper) {
            // שמור את הפילטרים אם קיימים
            const existingFilters = container.querySelector('.activity-filters');

            if (!existingFilters) {
                // צור את אזור הפילטרים רק אם הוא לא קיים
                const filtersDiv = document.createElement('div');
                filtersDiv.className = 'activity-filters';
                filtersDiv.innerHTML = `
                    <div class="filter-toggle">
                        <input type="checkbox" 
                            id="showArchivedActivities" 
                            onchange="activityManager.filterActivitiesByArchiveStatus()">
                        <label for="showArchivedActivities">הצג פעילויות בארכיון</label>
                    </div>
                    <div class="sort-options">
                        <select id="activitySortOrder" 
                                onchange="activityManager.sortActivities(this.value)">
                            <option value="date">לפי תאריך</option>
                            <option value="name">לפי שם</option>
                        </select>
                    </div>
                `;
                container.appendChild(filtersDiv);
            }

            // צור את ה-wrapper לטאבים
            tabsWrapper = document.createElement('div');
            tabsWrapper.className = 'activity-tabs-wrapper';
            container.appendChild(tabsWrapper);
        }

        // עכשיו עדכן רק את תוכן ה-wrapper
        if (this.activities.length === 0) {
            // אם אין פעילויות, הצג הודעה
            tabsWrapper.innerHTML = '';

            // בדוק אם כבר יש הודעת "אין פעילויות"
            let noActivitiesMsg = container.querySelector('.no-activities');
            if (!noActivitiesMsg) {
                noActivitiesMsg = document.createElement('div');
                noActivitiesMsg.className = 'no-activities';
                noActivitiesMsg.style.marginTop = '15px';
                noActivitiesMsg.innerHTML = `
                <i class="fas fa-folder-open"></i>
                <p>אין פעילויות. צור פעילות חדשה להתחלה</p>
            `;
                container.appendChild(noActivitiesMsg);
            }
        } else {
            // הסר הודעת "אין פעילויות" אם קיימת
            const noActivitiesMsg = container.querySelector('.no-activities');
            if (noActivitiesMsg) {
                noActivitiesMsg.remove();
            }

            // עדכן את הטאבים
            const tabsHTML = this.activities.map(activity => {
                const isAdmin = this.isUserAdmin();

                return `
                <div class="activity-tab 
                            ${activity.id === this.currentActivityId ? 'active' : ''} 
                            ${activity.archived ? 'archived' : ''}" 
                    data-activity-id="${activity.id}"
                    draggable="true"
                    onclick="activityManager.selectActivity('${activity.id}')">

                    <div class="activity-tab-content">
                        <span class="activity-tab-name">
                            ${activity.name.length > 30
                                ? activity.name.substring(0, 30) + '...'
                                : activity.name}
                        </span>

                        <!-- *** שורה תחתונה: תאריך + כפתורים זה ליד זה *** -->
                        <div class="activity-tab-bottom-row">

                            ${activity.activityDate
                                ? `<span class="activity-tab-date">
                                    <i class="fas fa-calendar-alt"></i>
                                    ${this.formatDate(activity.activityDate)}
                                </span>`
                                : '<span></span>'}

                            ${isAdmin ? `
                            <div class="activity-tab-actions">
                                ${!activity.archived ? `
                                <button class="activity-tab-action"
                                        onclick="event.stopPropagation();
                                                activityManager.editActivity('${activity.id}')"
                                        title="ערוך">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="activity-tab-action"
                                        onclick="event.stopPropagation();
                                                activityManager.openPermissionsModal('${activity.id}')"
                                        title="הרשאות">
                                    <i class="fas fa-user-shield"></i>
                                </button>
                                ` : ''}
                                <button class="activity-tab-action"
                                        onclick="event.stopPropagation();
                                                activityManager.duplicateActivity('${activity.id}')"
                                        title="שכפל">
                                    <i class="fas fa-copy"></i>
                                </button>
                                ${activity.archived
                                    ? `<button class="activity-tab-action archive"
                                                onclick="event.stopPropagation();
                                                        activityManager.archiveActivity('${activity.id}')"
                                                title="הוצא מארכיון">
                                        <i class="fas fa-box-open"></i>
                                    </button>`
                                    : `<button class="activity-tab-action archive"
                                                onclick="event.stopPropagation();
                                                        activityManager.archiveActivity('${activity.id}')"
                                                title="ארכיון">
                                        <i class="fas fa-archive"></i>
                                    </button>`
                                }
                                <button class="activity-tab-action delete"
                                        onclick="event.stopPropagation();
                                                activityManager.deleteActivity('${activity.id}')"
                                        title="מחק">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                            ` : ''}

                        </div>
                    </div>

                    ${activity.archived
                        ? '<span class="archived-badge">ארכיון</span>'
                        : ''}
                </div>
                `;
            }).join('');

            tabsWrapper.innerHTML = tabsHTML;
        }

        // הוסף כפתורים להוספת פעילות חדשה וייבוא מאקסל אם לא קיימים
        if (!container.querySelector('.activity-buttons')) {
            const buttonsDiv = document.createElement('div');
            buttonsDiv.className = 'activity-buttons';

            const addButton = document.createElement('button');
            addButton.className = 'activity-tab add-activity-tab';
            addButton.onclick = () => this.openAddActivityModal();
            addButton.innerHTML = '<i class="fas fa-plus"></i> פעילות חדשה';

            const importButton = document.createElement('button');
            importButton.className = 'activity-tab import-excel-tab';
            importButton.onclick = () => this.openImportExcelModal();
            importButton.innerHTML = '<i class="fas fa-file-excel"></i> ייבוא מאקסל';

            buttonsDiv.appendChild(addButton);
            buttonsDiv.appendChild(importButton);

            // הוסף לאזור הפילטרים
            const filtersDiv = container.querySelector('.activity-filters');
            if (filtersDiv) {
                filtersDiv.appendChild(buttonsDiv);
            } else {
                container.appendChild(buttonsDiv);
            }
        }

        // אתחל את גרירה ושחרור אחרי הרינדור
        this.initializeDragAndDrop();
    }

    // Initialize drag and drop for activity tabs
    initializeDragAndDrop() {
        const tabsWrapper = document.querySelector('.activity-tabs-wrapper');
        if (!tabsWrapper) return;

        const tabs = tabsWrapper.querySelectorAll('.activity-tab:not(.add-activity-tab)');
        if (!tabs || tabs.length === 0) return;

        tabs.forEach(tab => {
            tab.addEventListener('dragstart', (e) => this.handleDragStart(e));
            tab.addEventListener('dragend', (e) => this.handleDragEnd(e));
            tab.addEventListener('dragover', (e) => this.handleDragOver(e));
            tab.addEventListener('drop', (e) => this.handleDrop(e));
            tab.addEventListener('dragenter', (e) => this.handleDragEnter(e));
            tab.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        });
    }

    // הוסף פונקציה לאתחול מאזיני שדות שעה
    initializeTaskTimeInputListeners() {
        const hourInput = document.getElementById('activityTaskHour');
        const minuteInput = document.getElementById('activityTaskMinute');

        if (hourInput) {
            // כאשר שעה נבחרת, מלא דקות עם 00 אם ריק
            hourInput.addEventListener('change', () => {
                if (hourInput.value && !minuteInput.value) {
                    minuteInput.value = '00';
                }
                this.updateTaskTimeClearButton();
            });

            // עדכן כפתור בזמן אמת
            hourInput.addEventListener('input', () => {
                this.updateTaskTimeClearButton();
            });
        }

        if (minuteInput) {
            // עדכן כפתור כאשר דקות משתנות
            minuteInput.addEventListener('change', () => {
                this.updateTaskTimeClearButton();
            });

            // עדכן כפתור בזמן אמת
            minuteInput.addEventListener('input', () => {
                this.updateTaskTimeClearButton();
            });
        }
    }

    handleDragStart(e) {
        this.draggedElement = e.currentTarget;
        e.currentTarget.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.currentTarget.innerHTML);
    }

    handleDragEnd(e) {
        e.currentTarget.style.opacity = '1';

        // Remove all drag-over classes
        const tabs = document.querySelectorAll('.activity-tab');
        tabs.forEach(tab => {
            tab.classList.remove('drag-over');
        });
    }

    handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        return false;
    }

    handleDragEnter(e) {
        if (e.currentTarget !== this.draggedElement) {
            e.currentTarget.classList.add('drag-over');
        }
    }

    handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }

    async handleDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }

        e.currentTarget.classList.remove('drag-over');

        if (this.draggedElement !== e.currentTarget) {
            const draggedId = this.draggedElement.dataset.activityId;
            const targetId = e.currentTarget.dataset.activityId;

            // Reorder activities array
            const draggedIndex = this.activities.findIndex(a => a.id === draggedId);
            const targetIndex = this.activities.findIndex(a => a.id === targetId);

            if (draggedIndex !== -1 && targetIndex !== -1) {
                const [draggedActivity] = this.activities.splice(draggedIndex, 1);
                this.activities.splice(targetIndex, 0, draggedActivity);

                // Save new order to server
                await this.saveActivityOrder();

                // Re-render tabs
                this.renderActivityTabs();
            }
        }

        return false;
    }

    async saveActivityOrder() {
        try {
            const orderData = this.activities.map((activity, index) => ({
                id: activity.id,
                order: index
            }));

            const response = await fetch('/Activities/UpdateActivityOrder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activities: orderData })
            });

            const result = await response.json();

            if (!result.success) {
                console.error('Error saving activity order:', result.error);
                NotificationManager.show('שגיאה בשמירת סדר הפעילויות', 'error');
            }
        } catch (error) {
            console.error('Error saving activity order:', error);
        }
    }

    // Select activity
    async selectActivity(activityId) {
        
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        this.currentSearchTerm = '';
        const searchInput = document.getElementById('taskSearchInput');
        if (searchInput) searchInput.value = '';
        const clearBtn = document.querySelector('.task-search .clear-search-btn');
        if (clearBtn) clearBtn.style.display = 'none';

        // אם הפעילות בארכיון - הצג הודעה ואפשר צפייה בלבד
        if (activity && activity.archived) {
            NotificationManager.show('פעילות זו נמצאת בארכיון - מצב צפייה בלבד', 'info');
        }

        // הצג כפתור סינון
        const filterBtn = document.getElementById('filterToggleBtn');
        if (filterBtn) filterBtn.style.display = '';

        const searchTask = document.querySelector('.task-search-container');
        if (searchTask) {
            searchTask.style.display = 'flex';
        }

        this.currentActivityId = activityId;

        // *** הוסף אחרי שמוצאת הפעילות ***
        // בדוק הרשאת סימון למשתמש הנוכחי
        await this.checkCurrentUserPermission(activityId);

        // *** חדש: בדוק אם המשתמש הוא מנהל הפעילות ***
        await this.checkIfUserIsActivityManager(activityId, activity);

        const nameDisplay = document.getElementById('activityNameDisplay');
        if (nameDisplay) nameDisplay.textContent = activity.name;

        const dateDisplay = document.getElementById('activityDateDisplay');
        if (dateDisplay) {
            if (activity && activity.activityDate) {
                this.currentDate = activity.activityDate;
                dateDisplay.textContent = this.formatDate(activity.activityDate);
            } else {
                this.currentDate = new Date().toISOString().split('T')[0];
                dateDisplay.textContent = this.formatDate(this.currentDate);
            }
        }

        // *** חדש: הצגת מנהל הפעילות ברמת הפעילות ***
        const managerDisplay = document.getElementById('activityManagerDisplay');
        if (managerDisplay) {
            if (activity.activityManager) {
                managerDisplay.textContent =
                    `מנהל פעילות: ${activity.activityManager}`;
                managerDisplay.style.display = '';
            } else {
                managerDisplay.style.display = 'none';
            }
        }

        document.querySelector('.task-controls-row').style.display = 'flex';

        // אפס את כפתור הוספת המשימה במקרה שהיה נעול
        const addTaskBtn = document.querySelector('[onclick*="activityManager.openAddTaskModal"]'); if (addTaskBtn) {
            addTaskBtn.disabled = false;
            addTaskBtn.style.opacity = '';
            addTaskBtn.style.cursor = '';
            addTaskBtn.title = '';
        }

        if (window.activitiesDashboard){
            activityManager.toggleFiltersBar(); // פותח את הסינונים

            const filterBtn = document.getElementById('filterToggleBtn');
            if (filterBtn) {
                filterBtn.style.display = 'none';
            }
        }



        this.renderActivityTabs();
        await this.loadActivityTasks(activityId, this.currentDate);
    }

    async checkIfUserIsActivityManager(activityId, activity) {
        if (!this.currentUser) return;

        // קבל שם משתמש נוכחי בכל הפורמטים האפשריים
        const currentUserName = (
            this.currentUser.displayName ||
            this.currentUser.username ||
            this.currentUser.name ||
            ''
        ).trim().toLowerCase();

        if (!currentUserName) return;

        // בדוק אם המשתמש הוא מנהל הפעילות ברמת הפעילות
        const activityManagerName = (activity.activityManager || '').trim().toLowerCase();
        if (activityManagerName && activityManagerName === currentUserName) {
            this.currentUserHasPermission = true;
            return;
        }

        // בדוק אם המשתמש הוא מנהל פעילות ברמת אחת המשימות
        try {
            const response = await fetch(
                `/Activities/GetActivityTasks?activityId=${activityId}&date=${this.currentDate}`
            );
            const tasks = await response.json();
            if (!Array.isArray(tasks)) return;

            const isManagerInTask = tasks.some(task => {
                const taskManagerName = (task.activityManager || '').trim().toLowerCase();
                return taskManagerName && taskManagerName === currentUserName;
            });

            if (isManagerInTask) {
                this.currentUserHasPermission = true;
            }
        } catch (err) {
            console.warn('Could not check task managers:', err);
        }
    }

    // הצגת/הסתרת שורת הסינונים
    toggleFiltersBar() {
        let bar = document.getElementById('taskFiltersBar');
        const btn = document.getElementById('filterToggleBtn');

        //  אם ה-HTML עדיין לא הוזרק (למקרה קצה) - הזרק אותו עכשיו
        if (!bar) {
            const placeholder = document.getElementById('taskFiltersBar');
            if (placeholder) {
                placeholder.outerHTML = this.getFiltersBarHTML();
            } else {
                // אין placeholder ואין bar - הוסף אחרי act-task-controls
                const controls = document.querySelector('.act-task-controls');
                if (controls) {
                    controls.insertAdjacentHTML(
                        'afterend',
                        this.getFiltersBarHTML()
                    );
                }
            }
            // קבל reference חדש אחרי ההזרקה
            bar = document.getElementById('taskFiltersBar');
            if (!bar) return;
        }

        const isVisible = bar.style.display !== 'none';

        if (isVisible) {
            bar.style.display = 'none';
            if (btn) btn.classList.remove('active');
        } else {
            bar.style.display = 'flex';
            if (btn) btn.classList.add('active');
            // מלא אחראים בכל פתיחה (ייתכן שהמשימות השתנו)
            this.populateResponsibleFilter();
        }
    }

    // מלא את רשימת האחראים מהמשימות הקיימות
    async populateResponsibleFilter() {
        if (!this.currentActivityId) return;

        const response = await fetch(
            `/Activities/GetActivityTasks` +
            `?activityId=${this.currentActivityId}&date=${this.currentDate}`
        );
        const tasks = await response.json();
        if (!Array.isArray(tasks)) return;

        // ── פונקציית עזר: מלא select מ-Set ──
        const fillSelect = (selectId, values) => {
            const select = document.getElementById(selectId);
            if (!select) return;
            const currentVal = select.value;
            select.innerHTML = '<option value="">הכל</option>';
            [...values].sort().forEach(val => {
                const opt = document.createElement('option');
                opt.value = val;
                opt.textContent = val;
                select.appendChild(opt);
            });
            // שמור ערך נוכחי אם עדיין קיים
            if ([...values].includes(currentVal)) {
                select.value = currentVal;
            }
        };

        // ── אסוף ערכים ייחודיים לכל שדה ──
        const responsibles   = new Set();
        const systems        = new Set();
        const environments   = new Set();
        const dependencies   = new Set();
        const disruptions    = new Set();
        const impacts        = new Set();

        tasks.forEach(t => {
            if (t.responsiblePerson)    responsibles.add(t.responsiblePerson);
            if (t.secondaryResponsible) responsibles.add(t.secondaryResponsible);
            if (t.systemName)           systems.add(t.systemName);
            if (t.environment)          environments.add(t.environment);
            if (t.dependency)           dependencies.add(t.dependency);
            if (t.disruptionDuration)   disruptions.add(t.disruptionDuration);
            if (t.impact)               impacts.add(t.impact);
        });

        fillSelect('taskResponsibleFilter',  responsibles);
        fillSelect('taskSystemFilter',       systems);
        fillSelect('taskEnvironmentFilter',  environments);
        fillSelect('taskDependencyFilter',   dependencies);
        fillSelect('taskDisruptionFilter',   disruptions);
        fillSelect('taskImpactFilter',       impacts);
    }

    // ─── מחזיר את ה-HTML של שורת הסינון ───
    getFiltersBarHTML() {
        return `
            <div class="task-filters-bar" id="taskFiltersBar" style="display:none;">

                <div class="filters-title">
                    <i class="fas fa-filter"></i>
                    סינונים:
                </div>

                <div class="filter-group">
                    <label>
                        <i class="fas fa-circle" style="font-size:0.6rem;"></i>
                        סטטוס:
                    </label>
                    <select id="taskStatusFilter"
                            onchange="activityManager.applyFiltersAndRefresh()">
                        <option value="">הכל</option>
                        <option value="חדש">חדש</option>
                        <option value="ממתין">ממתין</option>
                        <option value="בביצוע">בביצוע</option>
                        <option value="בוצע">בוצע</option>
                        <option value="מבוטלת">מבוטלת</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label>
                        <i class="fas fa-user" style="font-size:0.7rem;"></i>
                        אחראי:
                    </label>
                    <select id="taskResponsibleFilter"
                            onchange="activityManager.applyFiltersAndRefresh()">
                        <option value="">הכל</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label>
                        <i class="fas fa-server" style="font-size:0.7rem;"></i>
                        מערכת:
                    </label>
                    <select id="taskSystemFilter"
                            onchange="activityManager.applyFiltersAndRefresh()">
                        <option value="">הכל</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label>
                        <i class="fas fa-layer-group" style="font-size:0.7rem;"></i>
                        סביבה:
                    </label>
                    <select id="taskEnvironmentFilter"
                            onchange="activityManager.applyFiltersAndRefresh()">
                        <option value="">הכל</option>
                    </select>
                </div>

                <button class="filter-clear-btn"
                        onclick="activityManager.clearAllFilters()"
                        title="נקה כל הסינונים">
                    <i class="fas fa-times"></i>
                    נקה
                </button>

                <span class="filter-results-count"
                    id="filterResultsCount"
                    style="display:none;">
                </span>

            </div>
        `;
    }

    // החל סינונים ורענן תצוגה
    async applyFiltersAndRefresh() {
        await this.loadActivityTasks(
            this.currentActivityId,
            this.currentDate
        );
        this.updateFilterResultsCount();
        this.updateFilterActiveIndicator();
    }

    // פונקציה חדשה - עדכן אינדיקטור סינון פעיל
    updateFilterActiveIndicator() {
        const filters = [
            'taskStatusFilter',
            'taskResponsibleFilter',
            'taskSystemFilter',
            'taskEnvironmentFilter',
            'taskDependencyFilter',
            'taskDisruptionFilter',
            'taskImpactFilter'
        ];

        const isActive = filters.some(id => 
            !!(document.getElementById(id)?.value)
        );

        const indicator = document.getElementById('filterActiveIndicator');
        const btn       = document.getElementById('filterToggleBtn');

        if (indicator) {
            indicator.style.display = isActive ? 'inline' : 'none';
        }

        if (btn) {
            if (isActive) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    }

    // עדכן מונה תוצאות
    updateFilterResultsCount(count) {
        if(count==undefined)
            count=0;
        const countEl = document.getElementById('filterResultsCount');
        if (!countEl) return;

        const hasFilters = [
            'taskStatusFilter',
            'taskResponsibleFilter',
            'taskSystemFilter',
            'taskEnvironmentFilter',
            'taskDependencyFilter',
            'taskDisruptionFilter',
            'taskImpactFilter'
        ].some(id => !!document.getElementById(id)?.value);

        const hasSearch = !!this.currentSearchTerm;

        if (hasFilters || hasSearch) {
            const parts = [];
            if (hasSearch)  parts.push(`חיפוש: "${this.currentSearchTerm}"`);
            if (hasFilters) parts.push('סינון פעיל');

            countEl.textContent = `מציג ${count} משימות · ${parts.join(' + ')}`;
            countEl.style.display = 'inline';
        } else {
            countEl.style.display = 'none';
        }
    }

    // נקה כל הסינונים
    clearAllFilters() {
        [
            'taskStatusFilter',
            'taskResponsibleFilter',
            'taskSystemFilter',
            'taskEnvironmentFilter',
            'taskDependencyFilter',
            'taskDisruptionFilter',
            'taskImpactFilter'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // נקה גם את שדה החיפוש
        this.currentSearchTerm = '';
        const searchInput = document.getElementById('taskSearchInput');
        if (searchInput) searchInput.value = '';

        const clearBtn = document.querySelector('.task-search .clear-search-btn');
        if (clearBtn) clearBtn.style.display = 'none';

        this.applyFiltersAndRefresh();
    }

    renderActivityTasksGroupedByDate(tasks) {
        const container = document.getElementById('activityTasksContainer');
        if (!container) return;

        if (tasks.length === 0) {
            container.innerHTML = `
                <div class="tasks-empty">
                    <i class="fas fa-clipboard-list"></i><br>
                    אין משימות בפעילות זו
                </div>`;
            return;
        }

        // קבץ משימות לפי תאריך
        const groups = {};
        const noDateKey = '__nodate__';

        tasks.forEach(task => {
            const key = task.taskDate || noDateKey;
            if (!groups[key]) groups[key] = [];
            groups[key].push(task);
        });

        // מיין קבוצות לפי תאריך
        const sortedKeys = Object.keys(groups).sort((a, b) => {
            if (a === noDateKey) return 1;
            if (b === noDateKey) return -1;
            return new Date(a) - new Date(b);
        });

        // שמות ימים עברית
        const hebrewDays = [
            'ראשון', 'שני', 'שלישי', 'רביעי', 
            'חמישי', 'שישי', 'שבת'
        ];

        let html = `<div class="tasks-grouped-list">`;

        sortedKeys.forEach((dateKey, index) => {
            const groupTasks = groups[dateKey];
            const isToday = dateKey === new Date().toISOString().split('T')[0];
            // היום תמיד פתוח, שאר הימים פתוחים כברירת מחדל
            const isOpen = true; 
            const groupId = `date-group-${dateKey.replace(/_/g, '-')}`;
            
            // ─── כותרת קבוצה ───
            if (dateKey === noDateKey) {
                html += `
                    <div class="task-date-group-header no-date-header collapsible-header"
                        onclick="activityManager.toggleDateGroup('${groupId}')"
                        data-group-id="${groupId}">
                        <div class="date-group-line"></div>
                        <div class="date-group-label">
                            <i class="fas fa-calendar-times"></i>
                            <span>ללא תאריך</span>
                            <span class="date-group-count">${groupTasks.length}</span>
                            <i class="fas fa-chevron-up date-group-chevron"></i>
                        </div>
                        <div class="date-group-line"></div>
                    </div>`;
            } else {
                const d = new Date(dateKey);
                const dayName = hebrewDays[d.getDay()];
                const formattedDate = this.formatDate(dateKey);
                const isPast = d < new Date(new Date().toDateString());

                const completedCount = groupTasks.filter(t => 
                    t.completionDates && t.completionDates.includes(this.currentDate)
                ).length;
                
                html += `
                    <div class="task-date-group-header 
                                ${isToday ? 'today-header' : ''} 
                                ${isPast && !isToday ? 'past-header' : ''}
                                collapsible-header"
                        onclick="activityManager.toggleDateGroup('${groupId}')"
                        data-group-id="${groupId}">
                        <div class="date-group-line"></div>
                        <div class="date-group-label">
                            <i class="fas fa-calendar-day"></i>
                            <span class="date-group-day">יום ${dayName}</span>
                            <span class="date-group-date">${formattedDate}</span>
                            ${isToday ? '<span class="today-badge">היום</span>' : ''}
                            <span class="date-group-count">${groupTasks.length}</span>
                            ${completedCount > 0 
                                ? `<span class="date-group-completed-count">
                                    <i class="fas fa-check"></i>${completedCount}/${groupTasks.length}
                                </span>` 
                                : ''}
                            <i class="fas fa-chevron-up date-group-chevron"></i>
                        </div>
                        <div class="date-group-line"></div>
                    </div>`;
            }

            // ─── משימות בקבוצה ───
            html += `<div class="date-group-tasks" id="${groupId}">`;
            groupTasks.forEach(task => {
                html += this.createTaskHTML(task);
            });
            html += `</div>`;
        });

        html += '</div>';
        container.innerHTML = html;

        this.updateActivityProgress(tasks);
        this.initializeTaskDragAndDrop();
    }

    // ─── פתח/סגור קבוצת תאריך ───
    toggleDateGroup(groupId) {
        const groupEl  = document.getElementById(groupId);
        const headerEl = document.querySelector(
            `.collapsible-header[data-group-id="${groupId}"]`
        );
        if (!groupEl || !headerEl) return;

        const isOpen = !groupEl.classList.contains('collapsed');

        if (isOpen) {
            groupEl.classList.add('collapsed');
            headerEl.classList.add('group-collapsed');
        } else {
            groupEl.classList.remove('collapsed');
            headerEl.classList.remove('group-collapsed');
        }

        // ─── עדכן את הכפתור הראשי לפי המצב החדש ───
        this._syncToggleBtn();
    }

    // ─── סנכרן טקסט/אייקון של הכפתור לפי מצב הקבוצות ───
    _syncToggleBtn() {
        const btn    = document.getElementById('dateGroupsToggleBtn');
        if (!btn) return;

        const groups  = document.querySelectorAll('.date-group-tasks');
        const anyOpen = [...groups].some(g => !g.classList.contains('collapsed'));

        if (anyOpen) {
            btn.innerHTML = `<i class="fas fa-compress-alt"></i><span>סגור הכל</span>`;
            btn.title = 'סגור הכל';
        } else {
            btn.innerHTML = `<i class="fas fa-expand-alt"></i><span>פתח הכל</span>`;
            btn.title = 'פתח הכל';
        }
    }

    // ─── פתח הכל / סגור הכל ───
    toggleAllDateGroups(forceOpen) {
        const groups  = document.querySelectorAll('.date-group-tasks');
        const headers = document.querySelectorAll('.collapsible-header');
        const btn     = document.getElementById('dateGroupsToggleBtn');

        // אם forceOpen הוגדר מבחוץ - השתמש בו,
        // אחרת בדוק אם לפחות קבוצה אחת פתוחה
        const anyOpen = forceOpen !== undefined
            ? !forceOpen
            : [...groups].some(g => !g.classList.contains('collapsed'));

        // anyOpen=true  → יש פתוחים → צריך לסגור הכל
        // anyOpen=false → הכל סגור   → צריך לפתוח הכל
        const shouldClose = anyOpen;

        groups.forEach(g => {
            if (shouldClose) {
                g.classList.add('collapsed');
            } else {
                g.classList.remove('collapsed');
            }
        });

        headers.forEach(h => {
            if (shouldClose) {
                h.classList.add('group-collapsed');
            } else {
                h.classList.remove('group-collapsed');
            }
        });

        // עדכן טקסט ואייקון הכפתור
        if (btn) {
            if (shouldClose) {
                btn.innerHTML = `<i class="fas fa-expand-alt"></i><span>פתח הכל</span>`;
                btn.title = 'פתח הכל';
            } else {
                btn.innerHTML = `<i class="fas fa-compress-alt"></i><span>סגור הכל</span>`;
                btn.title = 'סגור הכל';
            }
        }
    }

    // Load tasks for activity
    async loadActivityTasks(activityId, date) {
        try {
            const response = await fetch(
                `/Activities/GetActivityTasks?activityId=${activityId}&date=${date}`
            );
            const data = await response.json();

            if (data.error) {
                this.renderActivityTasks([]);
            } else {
                this.originalTasksOrder = [...data];
                let tasksToRender = [...data];

                // ── מיון ──
                switch (this.currentSort) {
                    case 'timeGrouped':
                        tasksToRender = this.sortTasksByDateAndTime(tasksToRender);
                        break;
                    case 'status':
                        tasksToRender = this.sortTasksByStatus(tasksToRender);
                        break;
                    case 'responsible':
                        tasksToRender = this.sortTasksByResponsible(tasksToRender);
                        break;
                    case 'priority':
                        tasksToRender = this.sortTasksByPriority(tasksToRender);
                        break;
                    case 'selfOrder':
                    default:
                        tasksToRender = tasksToRender.sort(
                            (a, b) => (a.order || 0) - (b.order || 0)
                        );
                        break;
                }

                // ── סינון dropdowns ──
                tasksToRender = this.filterTasks(tasksToRender);

                // ── חיפוש טקסט ── ← הוסף שורה זו
                tasksToRender = this._applySearchFilter(tasksToRender);

                // ── הצג/הסתר כפתורי פתח-סגור הכל ──
                this._updateDateGroupControls(
                    this.currentSort === 'timeGrouped'
                );

                if (this.currentSort === 'timeGrouped') {
                    this.renderActivityTasksGroupedByDate(tasksToRender);
                } else {
                    this.renderActivityTasks(tasksToRender);
                }

                // ── הצג מונה תוצאות ──
                this.updateFilterResultsCount(tasksToRender.length); // ← עדכן

                const activity = this.activities.find(a => a.id === activityId);
                if (activity && activity.archived) {
                    this.lockArchivedActivityTasks();
                }
            }
        } catch (error) {
            this.renderActivityTasks([]);
        }
    }

    // ─── הצג/הסתר כפתורי פתח הכל / סגור הכל בתוך task-controls-row ───
    _updateDateGroupControls(show) {
        const row = document.querySelector('.task-controls-row');
        if (!row) return;

        const existing = row.querySelector('.date-groups-controls');
        if (existing) existing.remove();

        if (!show) return;

        const controls = document.createElement('div');
        controls.className = 'date-groups-controls';
        controls.innerHTML = `
            <button class="date-groups-toggle-btn"
                    id="dateGroupsToggleBtn"
                    onclick="activityManager.toggleAllDateGroups()"
                    title="פתח/סגור הכל">
                <i class="fas fa-compress-alt"></i>
                <span>סגור הכל</span>
            </button>
        `;

        row.appendChild(controls);
    }

    // נעילת כל הכפתורים והאינטראקציות במשימות של פעילות בארכיון
    lockArchivedActivityTasks() {
        const container = document.getElementById('activityTasksContainer');
        if (!container) return;

        // הוסף שכבת נעילה על כל הקונטיינר
        container.classList.add('archived-locked');

        // נעל את כל הכפתורים
        container.querySelectorAll('button').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
            btn.title = 'לא ניתן לערוך פעילות בארכיון';
        });

        // נעל את כל ה-select (dropdown סטטוס)
        container.querySelectorAll('select').forEach(select => {
            select.disabled = true;
            select.style.opacity = '0.4';
            select.style.cursor = 'not-allowed';
        });

        // נעל את תיבות הסימון (checkbox של השלמת משימה)
        container.querySelectorAll('.task-checkbox').forEach(checkbox => {
            checkbox.style.pointerEvents = 'none';
            checkbox.style.opacity = '0.4';
            checkbox.style.cursor = 'not-allowed';
        });

        // נעל גרירה של משימות
        container.querySelectorAll('.task-item').forEach(item => {
            item.setAttribute('draggable', 'false');
            item.style.cursor = 'default';
            const dragHandle = item.querySelector('.drag-handle');
            if (dragHandle) dragHandle.style.display = 'none';
        });
        // נעל את כפתור הוספת משימה
        const addTaskBtn = document.querySelector('[onclick*="activityManager.openAddTaskModal"]'); if (addTaskBtn) {
            addTaskBtn.disabled = true;
            addTaskBtn.style.opacity = '0.4';
            addTaskBtn.style.cursor = 'not-allowed';
            addTaskBtn.title = 'לא ניתן להוסיף משימות לפעילות בארכיון';
        }

        // הוסף באנר הודעה בראש הקונטיינר
        const existingBanner = container.querySelector('.archived-banner');
        if (!existingBanner) {
            const banner = document.createElement('div');
            banner.className = 'archived-banner';
            banner.innerHTML = `
            <i class="fas fa-archive"></i>
            פעילות זו נמצאת בארכיון - מצב צפייה בלבד
        `;
            container.insertBefore(banner, container.firstChild);
        }
    }

    // Render activity tasks
    renderActivityTasks(tasks) {
        const container = document.getElementById('activityTasksContainer');

        if (tasks.length === 0) {
            container.innerHTML = `
            <div class="tasks-empty">
                <i class="fas fa-clipboard-list"></i><br>
                אין משימות בפעילות זו
            </div>
        `;
            return;
        }

        const tasksHTML = tasks.map(task => this.createTaskHTML(task)).join('');
        container.innerHTML = `<div class="tasks-list">${tasksHTML}</div>`;

        this.updateActivityProgress(tasks);

        // Initialize drag and drop for tasks
        this.initializeTaskDragAndDrop();
    }

    initializeTaskDragAndDrop() {
        const tasksList = document.querySelector('#activityTasksContainer .tasks-list');
        if (!tasksList) return;

        const taskItems = tasksList.querySelectorAll('.task-item');

        taskItems.forEach(item => {
            item.addEventListener('dragstart', (e) => this.handleTaskDragStart(e));
            item.addEventListener('dragend', (e) => this.handleTaskDragEnd(e));
            item.addEventListener('dragover', (e) => this.handleTaskDragOver(e));
            item.addEventListener('drop', (e) => this.handleTaskDrop(e));
            item.addEventListener('dragenter', (e) => this.handleTaskDragEnter(e));
        });
    }

    handleTaskDragStart(e) {
        // נקה מצבי גרירה קודמים
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        document.querySelectorAll('.dragging').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        this.draggedTaskElement = e.currentTarget;
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.taskId);
    }

    handleTaskDragEnd(e) {
        // נקה את כל מצבי הגרירה
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        this.draggedTaskElement = null;
    }

    handleTaskDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';

        const taskItem = e.currentTarget;
        if (taskItem !== this.draggedTaskElement) {
            // נקה מכל המשימות האחרות
            document.querySelectorAll('.task-item').forEach(item => {
                if (item !== taskItem && item !== this.draggedTaskElement) {
                    item.classList.remove('drag-over');
                }
            });

            // הוסף רק למשימה הנוכחית
            taskItem.classList.add('drag-over');
        }

        return false;
    }

    handleTaskDragEnter(e) {
        if (e.currentTarget !== this.draggedTaskElement) {
            e.currentTarget.classList.add('drag-over');
        }
    }

    async handleTaskDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }

        // נקה את כל מצבי הגרירה
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        if (!this.draggedTaskElement || this.draggedTaskElement === e.currentTarget) {
            return false;
        }

        const draggedId = this.draggedTaskElement.dataset.taskId;
        const targetId = e.currentTarget.dataset.taskId;

        if (!draggedId || !targetId) {
            console.error('Missing task IDs for drag and drop');
            return false;
        }

        try {
            // Get current tasks
            const response = await fetch(`/Activities/GetActivityTasks?activityId=${this.currentActivityId}&date=${this.currentDate}`);
            const tasks = await response.json();

            // Reorder tasks array
            const draggedIndex = tasks.findIndex(t => t.id === draggedId);
            const targetIndex = tasks.findIndex(t => t.id === targetId);

            if (draggedIndex !== -1 && targetIndex !== -1) {
                // שמור את המשימה הנגררת עם כל המידע שלה
                const draggedTask = tasks[draggedIndex];

                // הסר את המשימה מהמיקום הנוכחי
                tasks.splice(draggedIndex, 1);

                // הכנס את המשימה למיקום החדש
                tasks.splice(targetIndex, 0, draggedTask);

                // הכן מערך עם מזהה ומיקום בלבד לשמירת הסדר
                const orderData = tasks.map((task, index) => ({
                    id: task.id,
                    order: index
                }));

                // שלח רק את נתוני הסדר לשרת, לא את כל המשימה
                const saveResponse = await fetch('/Activities/UpdateTaskOrder', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        activityId: this.currentActivityId,
                        tasks: orderData
                    })
                });

                const result = await saveResponse.json();

                if (!result.success) {
                    console.error('Error saving task order:', result.error);
                    NotificationManager.show('שגיאה בשמירת סדר המשימות', 'error');
                }

                // טען מחדש את המשימות כדי לשקף את השינויים
                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
            }
        } catch (error) {
            console.error('Error during task drop handling:', error);
        }

        this.draggedTaskElement = null;
        return false;
    }

    async saveTaskOrder(tasks) {
        try {
            const orderData = tasks.map((task, index) => ({
                id: task.id,
                order: index
            }));

            const response = await fetch('/Activities/UpdateTaskOrder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    activityId: this.currentActivityId,
                    tasks: orderData
                })
            });

            const result = await response.json();

            if (!this.handleApiResponse(result)) return;
            if (result.success) {
                NotificationManager.show('סדר המשימות עודכן בהצלחה', 'success');
            } else {
                console.error('Error saving task order:', result.error);
                NotificationManager.show('שגיאה בשמירת סדר המשימות', 'error');
            }
        } catch (error) {
            console.error('Error saving task order:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Check if date is in the past
    isDateInPast(dateString) {
        const taskDate = new Date(dateString);
        const now = new Date();

        // Reset time for comparison
        const taskDateOnly = new Date(taskDate);
        taskDateOnly.setHours(0, 0, 0, 0);

        const todayOnly = new Date(now);
        todayOnly.setHours(0, 0, 0, 0);

        // Calculate difference in days
        const diffTime = todayOnly - taskDateOnly;
        const diffDays = diffTime / (1000 * 60 * 60 * 24);

        // If it's yesterday and current time is before 07:30, allow editing
        if (diffDays === 1) {
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();

            // Allow editing until 07:30
            if (currentHour < 7 || (currentHour === 7 && currentMinute < 30)) {
                return false; // Not considered "past" - allow editing
            }
        }

        // For dates older than yesterday, or after 07:30 - consider as past
        return diffDays >= 1;
    }

    // Open employee selection modal
    async openEmployeeCompletionModal(taskId) {
        this.isModalOpen = true;

        try {
            const response = await fetch(
                `/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`
            );
            const result = await response.json();

            if (!result.success || !result.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const task = result.task;

            document.getElementById('activityCompletionTaskId').value = taskId;
            document.getElementById('activityCompletionTaskTitle').textContent = task.title;

            // *** שינוי: קבל שם יוזר מחובר ***
            const currentUserName = this.currentUser
                ? (this.currentUser.displayName || this.currentUser.username || this.currentUser.name || 'משתמש')
                : 'משתמש';

            // עדכן שדה נסתר
            const employeeHidden = document.getElementById('activityCompletionEmployeeName');
            if (employeeHidden) {
                employeeHidden.value = currentUserName;
            }

            // עדכן תצוגה
            const userDisplay = document.getElementById('completionCurrentUserDisplay');
            if (userDisplay) {
                userDisplay.textContent = currentUserName;
            }

            // executor name
            let defaultExecutor = '';
            if (task.responsiblePerson) {
                defaultExecutor = task.responsiblePerson;
            }
            if (task.secondaryResponsible) {
                defaultExecutor = defaultExecutor
                    ? `${defaultExecutor}, ${task.secondaryResponsible}`
                    : task.secondaryResponsible;
            }
            document.getElementById('activityCompletionExecutorName').value = defaultExecutor;

            document.getElementById('activityEmployeeCompletionModal').style.display = 'block';
            document.body.style.overflow = 'hidden';

        } catch (error) {
            console.error('Error loading task details:', error);
            NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
        }
    }

    // Close employee completion modal
    closeEmployeeCompletionModal() {
        this.isModalOpen = false;
        document.getElementById('activityEmployeeCompletionModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('activityEmployeeCompletionForm').reset();
    }

    // Mark task as completed with employee name
    async markTaskAsCompleted(taskId, employeeName, executorName) {
        try {
            // Save last selected employee
            this.saveLastSelectedEmployee(employeeName);

            // First, get the current task data to preserve all fields
            const taskResponse = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const taskResult = await taskResponse.json();

            if (!taskResult.success || !taskResult.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const task = taskResult.task;

            // Get current time for completion timestamp
            const now = new Date();
            const completionTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            // Prepare notes about who completed the task
            let completionNote = `בוצע על ידי: ${employeeName}`;
            if (executorName && executorName !== employeeName) {
                completionNote += `, גורם מבצע: ${executorName}`;
            }

            // Send the toggle request with all task fields preserved
            const response = await fetch('/Activities/ToggleTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: taskId,
                    activityId: this.currentActivityId,
                    date: this.currentDate,
                    title: task.title,
                    description: task.description || "",
                    priority: task.priority || "medium",
                    taskDate: task.taskDate || "",
                    taskHour: task.taskHour || "",
                    taskMinute: task.taskMinute || "",
                    responsiblePerson: task.responsiblePerson || "",
                    secondaryResponsible: task.secondaryResponsible || "",
                    notes: task.notes || "",
                    completedByEmployee: employeeName,
                    completionTime: completionTime,
                    executorName: executorName
                })
            });

            const result = await response.json();

            if (!this.handleApiResponse(result)) return;
            if (result.success) {
                // Add a note about who completed the task
                const noteResponse = await fetch('/Activities/UpdateTask', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: taskId,
                        activityId: this.currentActivityId,
                        status: 'בוצע',
                        title: task.title,
                        description: task.description || "",
                        priority: task.priority || "medium",
                        taskDate: task.taskDate || "",
                        taskHour: task.taskHour || "",
                        taskMinute: task.taskMinute || "",
                        responsiblePerson: task.responsiblePerson || "",
                        secondaryResponsible: task.secondaryResponsible || "",
                        notes: task.notes || "",
                        noteText: completionNote,
                        noteUserName: "מערכת",
                        noteTime: completionTime,
                        completedByEmployee: employeeName,
                        completionTime: completionTime,
                        executorName: executorName
                    })
                });

                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                NotificationManager.show(
                    `משימה הושלמה על ידי ${employeeName}!`,
                    'success'
                );
            } else {
                NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
            }
        } catch (error) {
            console.error('Error completing task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Create task HTML 
    createTaskHTML(task) {
        const isCompleted = task.completionDates && task.completionDates.includes(this.currentDate);
        const skipReason = task.skipReasons && task.skipReasons[this.currentDate];
        const skipUserName = task.skipUserNames && task.skipUserNames[this.currentDate];
        const isPastDate = this.isDateInPast(this.currentDate);
        const isDraggable = this.sortMode === 'manual' && !isPastDate && this.currentSort === 'selfOrder';

        // מידע על מי ביצע את המשימה - הצגת הביצוע האחרון
        let completedByEmployee = null;
        let completionTime = null;
        let executorName = null;
        let lastCompletionDate = null;

        // בדיקה אם יש מידע על ביצוע המשימה
        if (task.completedByEmployees && Object.keys(task.completedByEmployees).length > 0) {
            // מצא את התאריך האחרון שבו בוצעה המשימה
            const completionDates = Object.keys(task.completedByEmployees).sort((a, b) => {
                return new Date(b) - new Date(a); // מיון יורד - מהתאריך החדש ביותר לישן ביותר
            });

            if (completionDates.length > 0) {
                lastCompletionDate = completionDates[0]; // התאריך האחרון
                completedByEmployee = task.completedByEmployees[lastCompletionDate];
                completionTime = task.completionTimes && task.completionTimes[lastCompletionDate];
                executorName = task.executorNames && task.executorNames[lastCompletionDate];
            }
        }

        // Format task date
        const taskDateDisplay = task.taskDate ? this.formatDate(task.taskDate) : '';

        return `
    <div class="task-item ${isCompleted ? 'completed' : ''} ${skipReason ? 'skipped' : ''} ${isPastDate ? 'past-date' : ''}" 
        data-task-id="${task.id}"
        draggable="${isDraggable}"
        ondblclick="activityManager.openTaskViewPopup('${task.id}')"
        ${isDraggable ? `
        ondragstart="activityManager.handleTaskDragStart(event)"
        ondragover="activityManager.handleTaskDragOver(event)"
        ondrop="activityManager.handleTaskDrop(event)"
        ondragend="activityManager.handleTaskDragEnd(event)"` : ''}>
        
        ${!isPastDate && isDraggable ? `
        <div class="drag-handle" title="גרור לשינוי סדר">
            <i class="fas fa-grip-vertical"></i>
        </div>
        ` : ''}
        
        <div class="task-checkbox" onclick="activityManager.toggleTask('${task.id}')">
            ${isCompleted ? '<i class="fas fa-check"></i>' : ''}
            ${skipReason ? '<i class="fas fa-times"></i>' : ''}
        </div>
        
        <div class="task-priority ${task.priority}"></div>
        
        <div class="task-content">
            <div class="task-text">${task.title}</div>
            
            ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
            
            <div class="task-meta-info">
                ${taskDateDisplay ? `
                    <span class="task-meta-item">
                        <i class="fas fa-calendar"></i>
                        ${taskDateDisplay}
                    </span>
                ` : ''}
                
                ${task.taskHour && task.taskMinute ? `
                    <span class="task-meta-item">
                        <i class="fas fa-clock"></i>
                        ${task.taskHour}:${task.taskMinute}
                    </span>
                ` : ''}
                
                ${task.responsiblePerson ? `
                    <span class="task-meta-item">
                        <i class="fas fa-user"></i>
                        <strong>אחראי:</strong> ${task.responsiblePerson}
                    </span>
                ` : ''}
                
                ${task.secondaryResponsible ? `
                    <span class="task-meta-item">
                        <i class="fas fa-user-friends"></i>
                        <strong>אחראי משנה:</strong> ${task.secondaryResponsible}
                    </span>
                ` : ''}

                ${task.systemName ? `
                    <span class="task-meta-item">
                        <i class="fas fa-server"></i>
                        <strong>מערכת:</strong> ${task.systemName}
                    </span>
                ` : ''}

                ${task.environment ? `
                    <span class="task-meta-item">
                        <i class="fas fa-layer-group"></i>
                        <strong>סביבה:</strong> ${task.environment}
                    </span>
                ` : ''}

                ${task.dependency ? `
                    <span class="task-meta-item">
                        <i class="fas fa-project-diagram"></i>
                        <strong>תלות:</strong>
                        ${task.dependency.length > 50
                            ? task.dependency.substring(0, 50) + '...'
                            : task.dependency}
                    </span>
                ` : ''}

                ${task.disruptionDuration ? `
                    <span class="task-meta-item">
                        <i class="fas fa-hourglass-half"></i>
                        <strong>זמן שיבוע:</strong> ${task.disruptionDuration}
                    </span>
                ` : ''}

                ${task.impact ? `
                    <span class="task-meta-item">
                        <i class="fas fa-bolt"></i>
                        <strong>השפעה:</strong>
                        ${task.impact.length > 50
                            ? task.impact.substring(0, 50) + '...'
                            : task.impact}
                    </span>
                ` : ''}

                ${task.emailTo ? `
                    <span class="task-meta-item task-email-indicator ${task.emailSent ? 'email-sent' : 'email-pending'}"
                        title="${task.emailSent 
                                    ? 'מייל נשלח בהצלחה ב-' + (task.emailSentAt || '') 
                                    : 'מוגדר לשליחת מייל עם הביצוע'}">
                        <i class="fas fa-envelope"></i>
                        <span>${task.emailSent 
                                ? 'מייל נשלח' + (task.emailSentAt ? ' · ' + task.emailSentAt.substring(0,16) : '')
                                : 'ממתין לשליחה'}</span>
                        ${task.emailSent ? `
                            <button class="resend-email-btn" 
                                    onclick="event.stopPropagation(); 
                                            activityManager.resendTaskEmail('${task.id}')"
                                    title="שלח מייל שוב">
                                <i class="fas fa-redo"></i>
                            </button>
                        ` : ''}
                    </span>
                ` : ''}
            </div>
            
            ${isCompleted && completedByEmployee ? `
                <div class="task-completed-by">
                    <i class="fas fa-user-check"></i>
                    <strong>בוצע על ידי:</strong> ${completedByEmployee}
                    ${completionTime ? `<span class="completion-time">בשעה ${completionTime}</span>` : ''}
                    ${executorName && executorName !== completedByEmployee ? `<span class="executor-name"><strong>גורם מבצע:</strong> ${executorName}</span>` : ''}
                </div>
            ` : ''}
            
            ${task.notes ? `
                <div class="task-notes-display">
                    <i class="fas fa-sticky-note"></i>
                    <span>${task.notes}</span>
                </div>
            ` : ''}

            ${task.alertsToCheck ? `
                <div class="task-alerts-display">
                    <i class="fas fa-satellite-dish"></i>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <strong style="font-size:0.78rem;">התראות לבדיקה:</strong>
                        <span style="font-size:0.78rem;">
                            ${task.alertsToCheck.length > 60
                                ? task.alertsToCheck.substring(0, 60) + '...'
                                : task.alertsToCheck}
                        </span>
                    </div>
                </div>
            ` : ''}
            
            ${skipReason ? `
            <div class="task-skip-reason">
                <i class="fas fa-ban"></i>
                לא בוצע על ידי <strong>${skipUserName || 'לא ידוע'}</strong>: ${skipReason}
            </div>
        ` : ''
            }

        </div>

        <div class="task-status-dropdown">
            <label class="status-label">סטטוס:</label>
            <select class="status-select"
                    onchange="activityManager.updateTaskStatus('${task.id}', this.value)">
                <option value="חדש" ${task.status === 'חדש' ? 'selected' : ''}>חדש</option>
                <option value="ממתין" ${task.status === 'ממתין' ? 'selected' : ''}>ממתין</option>
                <option value="בביצוע" ${task.status === 'בביצוע' ? 'selected' : ''}>בביצוע</option>
                <option value="בוצע" ${task.status === 'בוצע' ? 'selected' : ''}>בוצע</option>
                <option value="מבוטלת" ${task.status === 'מבוטלת' ? 'selected' : ''}>מבוטלת</option>
            </select>
        </div>

        <div class="task-status-container">
            <div class="task-status-badge status-${task.status || 'חדש'} ">
                ${task.status || 'חדש'}
            </div>
        </div>
        
        <div class="task-actions">
            ${!isCompleted && !skipReason && (this.isUserAdmin() || this.currentUserHasPermission) ? `
                <button class="task-action-btn skip"
                        onclick="activityManager.openSkipModal('${task.id}')">
                    <i class="fas fa-ban"></i>
                </button>
            ` : ''}
            ${skipReason && (this.isUserAdmin() || this.currentUserHasPermission) ? `
                <button class="task-action-btn clear-skip"
                        onclick="activityManager.clearSkipReason('${task.id}')"
                        title="בטל סיבת אי ביצוע">
                    <i class="fas fa-undo"></i>
                </button>
            ` : ''}
            ${task.taskHour && task.taskMinute ? `
                <button class="task-action-btn alarm ${task.hasAlarm ? 'alarm-active' : ''}"
                        onclick="activityManager.toggleTaskAlarm('${task.id}')"
                        title="${task.hasAlarm ? 'בטל תזכורת' : 'הגדר תזכורת'}">
                    <i class="fas fa-bell"></i>
                </button>
            ` : ''}
            <button class="task-action-btn check-alert"
                    id="alertBtn_${task.id}"
                    onclick="activityManager.checkTaskOpenAlert('${task.id}')"
                    title="בדוק התראה פתוחה"
                    style="color:#6b7280;">
                <i class="fas fa-satellite-dish"></i>
            </button>
            ${this.isUserAdmin() ? `
            <button class="task-action-btn edit"
                    onclick="activityManager.editTask('${task.id}')">
                <i class="fas fa-edit"></i>
            </button>
            <button class="task-action-btn delete"
                    onclick="activityManager.deleteTask('${task.id}')">
                <i class="fas fa-trash"></i>
            </button>
            ` : ''}
        </div>
    </div>
`;
    }


    _escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ─────────────────────────────────────────────────────────
    // בדיקת התראה פתוחה למשימה
    // ─────────────────────────────────────────────────────────
    async checkTaskOpenAlert(taskId) {
        try {
            const taskResponse = await fetch(
                `/Activities/GetTask?taskId=${taskId}` +
                `&activityId=${this.currentActivityId}`
            );
            const taskResult = await taskResponse.json();
            if (!taskResult.success || !taskResult.task) return;

            const task = taskResult.task;

            if (!task.alertsToCheck || !task.alertsToCheck.trim()) {
                this._showTaskAlertCheckResult(task, [], false);
                return;
            }

            // כל שורה = חיפוש נפרד
            const searchLines = task.alertsToCheck
                .split(/[\n]+/)           // *** שורה חדשה = מחיצה ***
                .map(l => l.trim())
                .filter(Boolean);

            if (searchLines.length === 0) {
                this._showTaskAlertCheckResult(task, [], false);
                return;
            }

            // טען התראות פתוחות
            let openAlerts = [];
            let alertsFetched = false;

            try {
                const alertsResponse = await fetch('/Alerts/GetAlerts', {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    credentials: 'include'
                });

                if (alertsResponse.ok) {
                    const alertsData = await alertsResponse.json();
                    const allAlerts = alertsData.alerts !== undefined
                        ? alertsData.alerts
                        : (Array.isArray(alertsData) ? alertsData : []);

                    openAlerts = allAlerts.filter(a =>
                        ['OPEN', 'ACK', 'ASSIGN'].includes(a.status)
                    );
                    alertsFetched = true;
                }
            } catch (alertErr) {
                console.warn('GetAlerts failed:', alertErr);
            }

            if (!alertsFetched) {
                this._showTaskAlertCheckResult(task, [], alertsFetched);
                return;
            }

            // *** חפש כל שורה בנפרד ***
            const results = [];

            for (const line of searchLines) {
                const lineTrimmed = line.trim();
                if (!lineTrimmed) continue;

                // *** בדוק אם יש מקף - לפני המקף = HOST, אחרי = הודעה ***
                let searchHost    = null;
                let searchMessage = null;

                if (lineTrimmed.includes(' - ')) {
                    const dashIdx = lineTrimmed.indexOf(' - ');
                    searchHost    = lineTrimmed.substring(0, dashIdx).trim();
                    searchMessage = lineTrimmed.substring(dashIdx + 1).trim();
                } else {
                    searchMessage = lineTrimmed;
                }

                let matchedAlert = null;

                for (const alert of openAlerts) {
                    const alertMessage = (alert.message || '').toLowerCase();
                    const alertHost    = (alert.host    || '').toLowerCase();

                    if (searchHost && searchMessage) {
                        // *** חיפוש עם HOST + הודעה ***
                        const hostMatch    = alertHost.includes(searchHost.toLowerCase()) ||
                                            searchHost.toLowerCase().includes(alertHost);
                        const messageMatch = alertMessage.includes(searchMessage.toLowerCase()) ||
                                            searchMessage.toLowerCase().includes(alertMessage);

                        if (hostMatch && messageMatch) {
                            matchedAlert = alert;
                            break;
                        }
                    } else {
                        // *** חיפוש רגיל - רק הודעה ***
                        const msgLower = searchMessage.toLowerCase();
                        if (alertMessage.includes(msgLower) ||
                            msgLower.includes(alertMessage)) {
                            matchedAlert = alert;
                            break;
                        }
                    }
                }

                results.push({
                    line:         lineTrimmed,
                    searchHost,
                    searchMessage,
                    matchedAlert
                });
            }

            this._showTaskAlertCheckResult(task, results, alertsFetched);

        } catch (error) {
            console.error('Error checking task alert:', error);
            NotificationManager.show('שגיאה בבדיקת התראה', 'error');
        }
    }

    // ─── פונקציית עזר: קבל שורות חיפוש מהמשימה ───
    _getSearchLinesFromTask(task) {
        const lines = [];
        
        if (task.alertsToCheck && task.alertsToCheck.trim()) {
            const alertLines = task.alertsToCheck
                .split(/[\n,;]+/)
                .map(l => l.trim())
                .filter(Boolean);
            lines.push(...alertLines);
        } else {
            // fallback לשדות המשימה
            if (task.title)             lines.push(task.title);
            if (task.description)       lines.push(task.description);
            if (task.notes)             lines.push(task.notes);
            if (task.responsiblePerson) lines.push(task.responsiblePerson);
        }
        
        return lines;
    }

    // ─── פונקציית עזר: קבל טקסט מאוחד מהמשימה ───
    _getSearchTextFromTask(task) {
        if (task.alertsToCheck && task.alertsToCheck.trim()) {
            return task.alertsToCheck;
        }
        return [
            task.title,
            task.description,
            task.notes,
            task.responsiblePerson
        ].filter(Boolean).join(' ');
    }

   _showTaskAlertCheckResult(task, results = [], alertsFetched = false) {
        const existing = document.getElementById('taskAlertCheckPopup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'taskAlertCheckPopup';
        popup.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 20000;
            display: flex; align-items: center; justify-content: center;
            padding: 16px;
            backdrop-filter: blur(3px);
        `;

        const noApiHTML = !alertsFetched ? `
            <div style="background:#f8f9fa;border:1px dashed #dee2e6;
                        border-radius:8px;padding:10px 12px;margin-bottom:12px;
                        font-size:0.8rem;color:#6c757d;
                        display:flex;align-items:center;gap:8px;">
                <i class="fas fa-info-circle" style="color:#adb5bd;"></i>
                <span>מערכת ההתראות לא זמינה כרגע</span>
            </div>
        ` : '';

        // בנה תצוגה לכל שורת חיפוש
        const hasAnyMatch = results.some(r => r.matchedAlert);

        const resultsHTML = results.map(r => {
            if (r.matchedAlert) {
                const alert = r.matchedAlert;
                return `
                <div style="border:2px solid #ffd54f;border-radius:10px;
                            padding:12px 14px;margin-bottom:10px;
                            background:#fff8e1;">

                    <!-- שורת החיפוש -->
                    <div style="font-size:0.78rem;color:#555;margin-bottom:8px;
                                display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-search" style="color:#667eea;"></i>
                        <span>חיפוש:</span>
                        <code style="background:#e8eaf6;padding:1px 6px;
                                    border-radius:4px;font-size:0.78rem;">
                            ${this._escHtml(r.line)}
                        </code>
                        ${r.searchHost ? `
                            <span style="font-size:0.72rem;color:#888;">
                                (host: <strong>${this._escHtml(r.searchHost)}</strong>)
                            </span>
                        ` : ''}
                    </div>

                    <!-- ההתראה שנמצאה -->
                    <div style="font-size:0.85rem;font-weight:700;
                                color:#e65100;margin-bottom:8px;
                                display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-exclamation-circle"></i>
                        נמצאה התראה פתוחה!
                    </div>
                    <div style="background:#fff;border:1px solid #ffe082;
                                border-radius:6px;padding:8px 10px;
                                font-family:monospace;font-size:0.8rem;
                                color:#333;word-break:break-word;
                                direction:ltr;text-align:left;
                                margin-bottom:8px;">
                        ${this._escHtml(alert.message || '')}
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.82rem;">
                        ${alert.host ? `
                        <span>
                            <i class="fas fa-server" style="color:#667eea;"></i>
                            <strong>Host:</strong> ${this._escHtml(alert.host)}
                        </span>` : ''}
                        ${alert.severity ? `
                        <span>
                            <i class="fas fa-exclamation-triangle" style="color:#dc3545;"></i>
                            <strong>חומרה:</strong> ${this._escHtml(alert.severity)}
                        </span>` : ''}
                        ${alert.status ? `
                        <span>
                            <i class="fas fa-info-circle" style="color:#667eea;"></i>
                            <strong>סטטוס:</strong> ${this._escHtml(alert.status)}
                        </span>` : ''}
                    </div>
                </div>`;
            } else {
                return `
                <div style="border:1px solid #e9ecef;border-radius:8px;
                            padding:10px 12px;margin-bottom:8px;
                            background:#f8f9fa;
                            display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-check-circle" style="color:#28a745;"></i>
                    <div style="flex:1;font-size:0.82rem;">
                        <code style="background:#e8eaf6;padding:1px 6px;
                                    border-radius:4px;font-size:0.78rem;">
                            ${this._escHtml(r.line)}
                        </code>
                        ${r.searchHost ? `
                            <span style="font-size:0.72rem;color:#888;margin-right:6px;">
                                (host: <strong>${this._escHtml(r.searchHost)}</strong>)
                            </span>
                        ` : ''}
                    </div>
                    <span style="font-size:0.78rem;color:#28a745;font-weight:600;
                                white-space:nowrap;">
                        אין התראה פתוחה
                    </span>
                </div>`;
            }
        }).join('');

        popup.innerHTML = `
            <div style="background:#fff;border-radius:14px;
                        width:100%;max-width:600px;max-height:80vh;
                        overflow:hidden;display:flex;flex-direction:column;
                        box-shadow:0 20px 60px rgba(0,0,0,0.3);direction:rtl;">

                <!-- Header -->
                <div style="padding:16px 20px;border-bottom:2px solid #f0f0f0;
                            display:flex;align-items:center;
                            justify-content:space-between;flex-shrink:0;
                            background:${hasAnyMatch ? '#fff3e0' : '#f3f4f6'};">
                    <h3 style="margin:0;font-size:1rem;font-weight:700;
                                color:${hasAnyMatch ? '#e65100' : '#374151'};
                                display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-satellite-dish"
                        style="color:${hasAnyMatch ? '#f59e0b' : '#6b7280'};"></i>
                        בדיקת התראות פתוחות
                        ${hasAnyMatch
                            ? `<span style="background:#ef4444;color:#fff;
                                            border-radius:10px;padding:2px 8px;
                                            font-size:0.72rem;">
                                ${results.filter(r => r.matchedAlert).length} נמצאו
                            </span>`
                            : ''}
                    </h3>
                    <button onclick="document.getElementById(
                                        'taskAlertCheckPopup').remove()"
                            style="background:none;border:none;
                                font-size:1.4rem;cursor:pointer;
                                color:#888;line-height:1;">
                        &times;
                    </button>
                </div>

                <!-- Body -->
                <div style="padding:16px 20px;overflow-y:auto;flex:1;">

                    <!-- שורת החיפוש -->
                    <div style="background:#f8f9fa;border:1px solid #e9ecef;
                                border-radius:8px;padding:8px 12px;
                                margin-bottom:12px;font-size:0.82rem;color:#555;">
                        <i class="fas fa-tasks" style="color:#667eea;"></i>
                        <strong>משימה:</strong> ${this._escHtml(task.title)}
                        <span style="color:#aaa;margin-right:8px;">
                            (${results.length} שורות לחיפוש)
                        </span>
                    </div>

                    ${noApiHTML}
                    ${results.length > 0 ? resultsHTML : `
                        <div style="text-align:center;padding:30px;">
                            <i class="fas fa-search" style="font-size:2rem;
                                                            color:#aaa;
                                                            display:block;
                                                            margin-bottom:10px;"></i>
                            <p style="color:#666;">אין שורות חיפוש מוגדרות</p>
                        </div>
                    `}
                </div>

                <!-- Footer -->
                <div style="padding:12px 20px;border-top:1px solid #f0f0f0;
                            display:flex;justify-content:flex-end;flex-shrink:0;">
                    <button onclick="document.getElementById(
                                        'taskAlertCheckPopup').remove()"
                            style="padding:9px 20px;
                                background:linear-gradient(135deg,#667eea,#764ba2);
                                color:#fff;border:none;border-radius:8px;
                                cursor:pointer;font-size:0.88rem;font-weight:600;">
                        סגור
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(popup);
        popup.addEventListener('click', e => {
            if (e.target === popup) popup.remove();
        });
    }

    // Update progress
    updateActivityProgress(tasks) {
        const completed = tasks.filter(t =>
            t.completionDates && t.completionDates.includes(this.currentDate)
        ).length;

        const total = tasks.length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        const progressCircle = document.getElementById('activityProgressCircle');
        const progressText = document.getElementById('activityProgressText');
        const progressDescription = document.getElementById('activityProgressDescription');

        if (!progressCircle || !progressText || !progressDescription) {
            console.warn('One or more progress elements not found in the document');
            return;
        }

        progressCircle.style.setProperty('--progress', `${percentage * 3.6}deg`);
        progressText.textContent = `${percentage}%`;
        progressDescription.textContent = `${completed} מתוך ${total} משימות הושלמו`;

        if (percentage === 100) {
            progressCircle.style.background = `conic-gradient(#28a745 0deg, #28a745 360deg, #e9ecef 360deg, #e9ecef 360deg)`;
        } else if (percentage >= 75) {
            progressCircle.style.background = `conic-gradient(#ffa502 0deg, #ffa502 ${percentage * 3.6}deg, #e9ecef ${percentage * 3.6}deg, #e9ecef 360deg)`;
        } else {
            progressCircle.style.background = `conic-gradient(#667eea 0deg, #667eea ${percentage * 3.6}deg, #e9ecef ${percentage * 3.6}deg, #e9ecef 360deg)`;
        }
    }

    // Add new activity
    openAddActivityModal() {
        this.isModalOpen = true;
        document.getElementById('activityModalTitle').textContent = 'צור פעילות חדשה';
        document.getElementById('activitySubmitBtn').textContent  = 'צור פעילות';
        document.getElementById('activityForm').reset();
        document.getElementById('activityId').value = '';

        // ── תאריך ──
        const hiddenDateInput    = document.getElementById('activityDateInputHidden');
        const formattedDateInput = document.getElementById('activityDateInput');
        if (hiddenDateInput)    hiddenDateInput.value    = '';
        if (formattedDateInput) formattedDateInput.value = '';

        // ── מנהל פעילות ──
        const managerInput = document.getElementById('activityManagerInput');
        if (managerInput) managerInput.value = '';

        document.getElementById('addActivityModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeAddActivityModal() {
        this.isModalOpen = false;
        document.getElementById('addActivityModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('activityForm').reset();

        // ── נקה תאריך ──
        const hiddenDateInput    = document.getElementById('activityDateInputHidden');
        const formattedDateInput = document.getElementById('activityDateInput');
        if (hiddenDateInput)    hiddenDateInput.value    = '';
        if (formattedDateInput) formattedDateInput.value = '';

        // ── נקה מנהל פעילות ──
        const managerInput = document.getElementById('activityManagerInput');
        if (managerInput) managerInput.value = '';
    }

    async saveActivity(activityData, isEditing = false) {
        try {
            
            // Get the date from the hidden input (ISO format)
            const dateInput = document.getElementById('activityDateInputHidden');
            if (dateInput && dateInput.value) {
                activityData.activityDate = dateInput.value; // This is already in ISO format (YYYY-MM-DD)
            } else {
                activityData.activityDate = null;
            }

            const url = isEditing ? '/Activities/UpdateActivity' : '/Activities/AddActivity';
            const method = isEditing ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(activityData)
            });

            const result = await response.json();

            if (result.success) {
                // *** חדש: הענק הרשאה אוטומטית למנהל הפעילות ***
                const savedActivityId = isEditing
                    ? activityData.id
                    : result.activity?.id;

                if (savedActivityId && activityData.activityManager) {
                    await this.grantManagerPermissionAuto(
                        savedActivityId,
                        activityData.activityManager
                    );
                }

                activityData.activityManager = document.getElementById('activityManagerInput')?.value || '';

                await this.loadActivities();
                this.renderActivityTabs();

                if (!isEditing && result.activity) {
                    this.selectActivity(result.activity.id);
                } else if (isEditing && this.currentActivityId) {
                    // Refresh the current activity after edit
                    this.selectActivity(this.currentActivityId);
                }

                this.closeAddActivityModal();
                NotificationManager.show(
                    isEditing ? 'פעילות עודכנה בהצלחה!' : 'פעילות נוספה בהצלחה!',
                    'success'
                );
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירת הפעילות', 'error');
            }
        } catch (error) {
            console.error('Error saving activity:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Edit activity
    async editActivity(activityId) {
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        // מניעת עריכת פעילות בארכיון
        if (activity.archived) {
            NotificationManager.show(
                'לא ניתן לערוך פעילות שנמצאת בארכיון', 
                'warning'
            );
            return;
        }

        // ── עדכן כותרות מודל ──
        document.getElementById('activityModalTitle').textContent = 'ערוך פעילות';
        document.getElementById('activitySubmitBtn').textContent  = 'עדכן פעילות';
        document.getElementById('activityId').value               = activity.id;
        document.getElementById('activityName').value             = activity.name;
        document.getElementById('activityDescription').value      = activity.description || '';

        // ── שדה מנהל פעילות (בדוק קיום לפני גישה) ──
        const managerInput = document.getElementById('activityManagerInput');
        if (managerInput) {
            managerInput.value = activity.activityManager || '';
        }

        // ── תאריך: בדוק קיום שניהם לפני גישה ──
        const hiddenDateInput    = document.getElementById('activityDateInputHidden');
        const formattedDateInput = document.getElementById('activityDateInput');

        if (hiddenDateInput && formattedDateInput) {
            if (activity.activityDate) {
                hiddenDateInput.value    = activity.activityDate;
                formattedDateInput.value = this.formatDate(activity.activityDate);
            } else {
                hiddenDateInput.value    = '';
                formattedDateInput.value = '';
            }
        }

        // ── פתח מודל ──
        this.isModalOpen = true;
        document.getElementById('addActivityModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Duplicate activity
    async duplicateActivity(activityId) {
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        if (!confirm(`האם לשכפל את הפעילות "${activity.name}"?`)) return;

        try {
            const response = await fetch('/Activities/DuplicateActivity', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ activityId: activityId })
            });

            const result = await response.json();

            if (result.success) {
                await this.loadActivities();
                this.renderActivityTabs();
                NotificationManager.show('הפעילות שוכפלה בהצלחה!', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בשכפול הפעילות', 'error');
            }
        } catch (error) {
            console.error('Error duplicating activity:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Delete activity
    async deleteActivity(activityId) {
        if (!this.isUserAdmin()) {
            NotificationManager.show('רק מנהל מערכת יכול למחוק פעילויות', 'warning');
            return;
        }
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        if (!confirm(`האם למחוק את הפעילות "${activity.name}"?\n\n⚠️ פעולה זו תמחק גם את כל המשימות בפעילות!`)) {
            return;
        }

        try {
            const response = await fetch(`/Activities/DeleteActivity?id=${activityId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                await this.loadActivities();
                this.renderActivityTabs();

                if (this.currentActivityId === activityId) {
                    if (this.activities.length > 0) {
                        // יש פעילויות אחרות - בחר את הראשונה
                        this.selectActivity(this.activities[0].id);
                    } else {
                        // אין פעילויות אחרות - אפס את התצוגה
                        this.currentActivityId = null;

                        // אפס את שם הפעילות
                        const nameDisplay = document.getElementById('activityNameDisplay');
                        if (nameDisplay) {
                            nameDisplay.textContent = '';
                        }

                        // אפס את תאריך הפעילות
                        const dateDisplay = document.getElementById('activityDateDisplay');
                        if (dateDisplay) {
                            dateDisplay.textContent = 'לא נבחרה פעילות';
                        }

                        // הצג מצב ריק
                        this.displayEmptyState();
                    }
                }

                NotificationManager.show('הפעילות נמחקה בהצלחה', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקת הפעילות', 'error');
            }
        } catch (error) {
            console.error('Error deleting activity:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // *** פונקציה חדשה - הוסף אחרי toggleTask ***
    async markTaskAsCompletedByCurrentUser(taskId, task) {
        try {
            // קבל את שם היוזר המחובר
            const employeeName = this.currentUser
                ? (this.currentUser.displayName || this.currentUser.username || this.currentUser.name || 'משתמש')
                : 'משתמש';

            const now = new Date();
            const completionTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            const response = await fetch('/Activities/ToggleTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: taskId,
                    activityId: this.currentActivityId,
                    date: this.currentDate,
                    title: task.title,
                    description: task.description || "",
                    priority: task.priority || "medium",
                    taskDate: task.taskDate || "",
                    taskHour: task.taskHour || "",
                    taskMinute: task.taskMinute || "",
                    responsiblePerson: task.responsiblePerson || "",
                    secondaryResponsible: task.secondaryResponsible || "",
                    notes: task.notes || "",
                    completedByEmployee: employeeName,
                    completionTime: completionTime,
                    executorName: ""
                })
            });

            const result = await response.json();

            if (result.success) {
                // עדכן סטטוס ל"בוצע"
                await fetch('/Activities/UpdateTask', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: taskId,
                        activityId: this.currentActivityId,
                        status: 'בוצע',
                        title: task.title,
                        description: task.description || "",
                        priority: task.priority || "medium",
                        taskDate: task.taskDate || "",
                        taskHour: task.taskHour || "",
                        taskMinute: task.taskMinute || "",
                        responsiblePerson: task.responsiblePerson || "",
                        secondaryResponsible: task.secondaryResponsible || "",
                        notes: task.notes || "",
                        completedByEmployee: employeeName,
                        completionTime: completionTime,
                        executorName: ""
                    })
                });

                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                NotificationManager.show(
                    `משימה הושלמה על ידי ${employeeName}!`,
                    'success'
                );
            } else {
                NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
            }
        } catch (error) {
            console.error('Error completing task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Toggle task completion
    async toggleTask(taskId) {
        try {
            // *** תיקון הלוגיקה: Admin/NOC תמיד יכולים ***
            if (this.isUserAdmin()) {
                // ממשיך ללא בדיקה נוספת
            } else if (this.isReadOnly || !this.currentUser) {
                // לא מחובר כלל
                if (window.activitiesDashboard?.showLoginRequired) {
                    window.activitiesDashboard.showLoginRequired();
                }
                return;
            } else if (!this.currentUserHasPermission) {
                // מחובר אבל אין הרשאה ספציפית לפעילות
                NotificationManager.show(
                    'אין לך הרשאה לסמן משימות בפעילות זו',
                    'warning'
                );
                return;
            }
            if (this.isReadOnly) {
                if (window.activitiesDashboard &&
                    typeof window.activitiesDashboard.showLoginRequired === 'function') {
                    window.activitiesDashboard.showLoginRequired();
                }
                return;
            }
            const taskResponse = await fetch(
                `/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`
            );
            const taskResult = await taskResponse.json();

            if (!taskResult.success || !taskResult.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const task = taskResult.task;
            const isSkipped = task.skipReasons && task.skipReasons[this.currentDate];

            if (isSkipped) {
                await this.clearSkipReason(taskId);
                return;
            }

            const isCompleted = task.completionDates &&
                task.completionDates.includes(this.currentDate);

            if (isCompleted) {
                // ביטול ביצוע - כמו קודם
                const response = await fetch('/Activities/ToggleTask', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        taskId: taskId,
                        activityId: this.currentActivityId,
                        date: this.currentDate,
                        title: task.title,
                        description: task.description || "",
                        priority: task.priority || "medium",
                        taskDate: task.taskDate || "",
                        taskHour: task.taskHour || "",
                        taskMinute: task.taskMinute || "",
                        responsiblePerson: task.responsiblePerson || "",
                        secondaryResponsible: task.secondaryResponsible || "",
                        notes: task.notes || ""
                    })
                });

                const result = await response.json();
                if (result.success) {
                    // Determine new status based on completion
                    const newStatus = result.completed ? 'בוצע' : 'חדש';

                    // Update the task with new status while preserving all fields
                    const updateResponse = await fetch('/Activities/UpdateTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: taskId,
                            activityId: this.currentActivityId,
                            status: newStatus,
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || ""
                        })
                    });
                    await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                    NotificationManager.show('משימה בוטלה', 'info');
                } else {
                    NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
                }
            } else {
                // *** שינוי: סמן ביצוע עם היוזר המחובר - ללא מודל ***
                await this.markTaskAsCompletedByCurrentUser(taskId, task);
            }
        } catch (error) {
            console.error('Error toggling task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    async openPermissionsModal(activityId) {
        if (!this.isUserAdmin()) {
            NotificationManager.show('רק מנהל מערכת יכול לנהל הרשאות', 'warning');
            return;
        }

        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        // טען הרשאות קיימות
        const permResponse = await fetch(
            `/Activities/GetActivityPermissions?activityId=${activityId}`
        );
        const permResult  = await permResponse.json();
        const permissions = permResult.success ? permResult.permissions : [];

        // טען משתמשים
        let allUsers = [];
        try {
            const usersResponse = await fetch(
                '/Auth/GetAllUsersForPermissions',
                { credentials: 'include' }
            );
            if (usersResponse.ok) {
                const usersData = await usersResponse.json();
                if (usersData.success) allUsers = usersData.users || [];
            }
        } catch (err) {
            console.warn('Could not load users:', err);
            allUsers = this.employees.map(e => ({
                username:    e.name,
                displayName: e.name,
                role:        'unknown'
            }));
        }

        // בנה options לרשימה
        const roleEmoji = {
            'Admin': '👑', 'NOC': '🖥️',
            'Dashboard': '👤', 'Viewer': '👁️'
        };

        const usersOptionsHTML = allUsers.map(u => {
            const hasPerm = permissions.some(p => p.username === u.username);
            const emoji   = roleEmoji[u.role] || '👤';
            const label   = (u.displayName && u.displayName !== u.username)
                ? `${emoji} ${u.displayName} (${u.username})`
                : `${emoji} ${u.username}`;
            return `<option value="${u.username}" ${hasPerm ? 'disabled' : ''}>` +
                `${label}${hasPerm ? ' ✓' : ''}` +
                `</option>`;
        }).join('');

        const modeText = permissions.length === 0 ? 'מוגבל לכולם' : 'מוגבל';

        // הסר מודל קיים
        const existing = document.getElementById('activityPermissionsModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id            = 'activityPermissionsModal';
        modal.className     = 'permissions-modal';

        // *** שינוי עיקרי: עיצוב inline במקום הסתמכות על CSS חיצוני ***
        modal.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 19000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            backdrop-filter: blur(3px);
        `;

        modal.innerHTML = `
            <div style="
                background: var(--card-bg, #1e2433);
                border-radius: 16px;
                width: 100%;
                max-width: 600px;
                max-height: 85vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0,0,0,0.4);
                direction: rtl;
            ">
                <!-- ── Header ── -->
                <div style="
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 18px 20px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    flex-shrink: 0;
                ">
                    <h3 style="
                        margin: 0;
                        color: #fff;
                        font-size: 0.95rem;
                        font-weight: 700;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    ">
                        <span style="
                            background: rgba(255,255,255,0.2);
                            width: 32px; height: 32px;
                            border-radius: 50%;
                            display: flex; align-items: center;
                            justify-content: center;
                            font-size: 0.9rem;
                            flex-shrink: 0;
                        "><i class="fas fa-user-shield"></i></span>
                        הרשאות סימון — ${activity.name}
                    </h3>
                    <button onclick="
                        document.getElementById('activityPermissionsModal').remove();
                        document.body.style.overflow='auto';"
                        style="
                            background: rgba(255,255,255,0.15);
                            border: 1px solid rgba(255,255,255,0.3);
                            color: #fff;
                            width: 30px; height: 30px;
                            border-radius: 50%;
                            cursor: pointer;
                            font-size: 1rem;
                            display: flex; align-items: center;
                            justify-content: center;
                            transition: background 0.2s;
                            flex-shrink: 0;
                        "
                        onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                        onmouseout="this.style.background='rgba(255,255,255,0.15)'"
                    >&times;</button>
                </div>

                <!-- ── Body ── -->
                <div style="
                    padding: 18px 18px 20px;
                    overflow-y: auto;
                    flex: 1;
                    min-height: 0;
                    background: var(--card-bg, #1e2433);
                ">
                    <!-- Stats -->
                    <div style="display:flex; gap:10px; margin-bottom:16px;">
                        <div style="
                            flex:1; border-radius:10px; padding:11px 10px;
                            text-align:center;
                            background: rgba(102,126,234,0.1);
                            border: 1px solid rgba(102,126,234,0.22);
                        ">
                            <div style="font-size:1.5rem; font-weight:800; color:#667eea; line-height:1.1; margin-bottom:3px;">
                                ${allUsers.length}
                            </div>
                            <div style="font-size:0.7rem; color:var(--text-secondary,#9ca3af); font-weight:500;">
                                משתמשים
                            </div>
                        </div>
                        <div style="
                            flex:1; border-radius:10px; padding:11px 10px;
                            text-align:center;
                            background: rgba(40,167,69,0.1);
                            border: 1px solid rgba(40,167,69,0.22);
                        ">
                            <div style="font-size:1.5rem; font-weight:800; color:#28a745; line-height:1.1; margin-bottom:3px;">
                                ${permissions.length}
                            </div>
                            <div style="font-size:0.7rem; color:var(--text-secondary,#9ca3af); font-weight:500;">
                                עם הרשאה
                            </div>
                        </div>
                        <div style="
                            flex:1; border-radius:10px; padding:11px 10px;
                            text-align:center;
                            background: rgba(245,158,11,0.1);
                            border: 1px solid rgba(245,158,11,0.22);
                        ">
                            <div style="font-size:0.85rem; font-weight:700; color:#d97706; line-height:1.3; margin-bottom:3px;">
                                ${modeText}
                            </div>
                            <div style="font-size:0.7rem; color:var(--text-secondary,#9ca3af); font-weight:500;">
                                מצב גישה
                            </div>
                        </div>
                    </div>

                    <!-- Add section -->
                    <div style="
                        background: rgba(102,126,234,0.06);
                        border: 1px solid rgba(102,126,234,0.16);
                        border-radius: 11px;
                        padding: 14px;
                        margin-bottom: 16px;
                    ">
                        <p style="
                            font-size: 0.87rem; font-weight: 700;
                            color: #667eea; margin: 0 0 11px;
                            display: flex; align-items: center; gap: 7px;
                        ">
                            <i class="fas fa-user-plus"></i> הוספת הרשאה
                        </p>
                        <div style="position:relative; margin-bottom:9px;">
                            <input type="text" id="permUserSearch"
                                placeholder="חיפוש משתמש..."
                                style="
                                    width: 100%; padding: 8px 34px 8px 11px;
                                    border-radius: 7px;
                                    border: 1px solid var(--border-color, #3d4a5c);
                                    background: var(--input-bg, #2a3347);
                                    color: var(--text-primary, #e0e0e0);
                                    font-size: 0.86rem;
                                    font-family: inherit;
                                    box-sizing: border-box;
                                    direction: rtl;
                                    outline: none;
                                "
                                oninput="
                                    var t=this.value.toLowerCase();
                                    document.querySelectorAll('#permUsernameSelect option')
                                    .forEach(function(o){
                                        o.style.display=(!t||o.textContent.toLowerCase().includes(t))?'':'none';
                                    });">
                            <i class="fas fa-search" style="
                                position:absolute; right:10px; top:50%;
                                transform:translateY(-50%);
                                color:#667eea; font-size:0.8rem;
                                pointer-events:none;
                            "></i>
                        </div>
                        <div style="display:flex; gap:8px; align-items:stretch;">
                            <select id="permUsernameSelect" size="4" style="
                                flex: 1;
                                border-radius: 7px;
                                border: 1px solid var(--border-color, #3d4a5c);
                                background: var(--input-bg, #2a3347);
                                color: var(--text-primary, #e0e0e0);
                                font-size: 0.84rem;
                                font-family: inherit;
                                padding: 5px 9px;
                                direction: rtl;
                                min-height: 150px;
                                outline: none;
                            ">
                                <option value="">— בחר משתמש —</option>
                                ${usersOptionsHTML}
                            </select>
                            <button onclick="
                                var s=document.getElementById('permUsernameSelect');
                                activityManager.grantPermission('${activityId}',s.value);"
                                style="
                                    padding: 0 16px;
                                    background: linear-gradient(135deg, #667eea, #764ba2);
                                    color: #fff; border: none;
                                    border-radius: 8px; cursor: pointer;
                                    font-size: 0.86rem; font-weight: 600;
                                    font-family: inherit;
                                    display: flex; align-items: center;
                                    justify-content: center; gap: 6px;
                                    white-space: nowrap;
                                    align-self: stretch;
                                    transition: all 0.2s;height: 50px;
                                "
                                onmouseover="this.style.transform='translateY(-1px)';this.style.boxShadow='0 4px 12px rgba(102,126,234,0.38)'"
                                onmouseout="this.style.transform='';this.style.boxShadow=''"
                            >
                                <i class="fas fa-plus"></i> הוסף
                            </button>
                        </div>
                        <p style="
                            font-size: 0.72rem;
                            color: var(--text-secondary, #9ca3af);
                            margin: 8px 0 0;
                            display: flex; align-items: center; gap: 5px;
                        ">
                            <i class="fas fa-info-circle" style="color:#667eea;"></i>
                            Admin ו-NOC יכולים לסמן תמיד ללא הגדרה
                        </p>
                    </div>

                    <!-- Divider -->
                    <div style="
                        display: flex; align-items: center; gap: 10px;
                        margin-bottom: 12px;
                        font-size: 0.74rem; font-weight: 700;
                        color: var(--text-secondary, #9ca3af);
                        text-transform: uppercase; letter-spacing: 0.05em;
                    ">
                        <div style="flex:1; height:1px; background:var(--border-color, rgba(255,255,255,0.08));"></div>
                        <span>הרשאות פעילות</span>
                        <div style="flex:1; height:1px; background:var(--border-color, rgba(255,255,255,0.08));"></div>
                    </div>

                    <!-- List -->
                    <div id="permissionsList">
                        ${this._renderPermissionsList(permissions, activityId)}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        // סגירה בלחיצה על הרקע
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                modal.remove();
                document.body.style.overflow = 'auto';
            }
        });
    }

    _renderPermissionsList(permissions, activityId) {
        if (!permissions || permissions.length === 0) {
            return '<div style="' +
                'text-align:center; padding:26px 18px; border-radius:10px;' +
                'background:var(--card-item-bg,rgba(255,255,255,0.03));' +
                'border:1.5px dashed var(--border-color,rgba(255,255,255,0.1));' +
            '">' +
                '<i class="fas fa-users-slash" style="' +
                    'font-size:2rem; display:block; margin-bottom:9px;' +
                    'color:var(--text-secondary,#9ca3af); opacity:0.55;' +
                '"></i>' +
                '<p style="margin:0 0 5px; font-weight:600; font-size:0.88rem;' +
                    'color:var(--text-primary,#e0e0e0);">אין הרשאות מוגדרות</p>' +
                '<small style="color:var(--text-secondary,#9ca3af); font-size:0.76rem; line-height:1.5;">' +
                    'כאשר אין הרשאות — כל משתמש מחובר יכול לסמן משימות' +
                '</small>' +
            '</div>';
        }

        var itemsHTML = '';

        for (var i = 0; i < permissions.length; i++) {
            var p         = permissions[i];
            var isAuto = p.autoGranted === true || 
                        p.AutoGranted === true ||
                        p.grantedBy === 'מערכת' || 
                        p.GrantedBy === 'מערכת';
            var initial   = (p.username || '?').charAt(0).toUpperCase();
            var grantedBy = p.grantedBy || p.GrantedBy || '';
            var grantedByDisplay = (isAuto || grantedBy === 'מערכת' || 
                        grantedBy === 'ע"י מערכת') ? '' : 
                       (grantedBy ? 'ע"י ' + grantedBy : '');
            var grantedAt = p.grantedAt || p.GrantedAt || '';


            var autoBadgeHTML = isAuto ? (
                '<span style="' +
                    'display:inline-flex; align-items:center; gap:3px;' +
                    'background:rgba(245,158,11,0.12); color:#d97706;' +
                    'border:1px solid rgba(245,158,11,0.25);' +
                    'border-radius:8px; font-size:0.67rem; font-weight:600;' +
                    'padding:1px 6px;' +
                '">' +
                    '<i class="fas fa-magic"></i> מנהל פעילות' +
                '</span>'
            ) : '';

            // *** הצג grantedBy אלא אם כן זה "מערכת" (כבר מצוין ב-badge) ***
            var grantedByDisplay = (isAuto || grantedBy === 'ע"י מערכת') ? '' : grantedBy;

            itemsHTML +=
                '<div style="' +
                    'display:flex; align-items:center;' +
                    'justify-content:space-between; gap:10px;' +
                    'padding:10px 12px; border-radius:10px;' +
                    'margin-bottom:7px;' +
                    'background:var(--card-item-bg,rgba(255,255,255,0.04));' +
                    'border:1px solid var(--border-color,rgba(255,255,255,0.07));' +
                    'transition:all 0.2s;' +
                '"' +
                ' onmouseover="this.style.borderColor=\'rgba(102,126,234,0.3)\';this.style.background=\'rgba(102,126,234,0.06)\'"' +
                ' onmouseout="this.style.borderColor=\'var(--border-color,rgba(255,255,255,0.07))\';this.style.background=\'var(--card-item-bg,rgba(255,255,255,0.04))\'"' +
                '>' +
                    '<div style="display:flex; align-items:center; gap:10px; min-width:0;">' +
                        '<div style="' +
                            'width:36px; height:36px; border-radius:50%;' +
                            'background:linear-gradient(135deg,#667eea,#764ba2);' +
                            'display:flex; align-items:center; justify-content:center;' +
                            'color:#fff; font-size:0.88rem; font-weight:700;' +
                            'flex-shrink:0;' +
                            'box-shadow:0 2px 7px rgba(102,126,234,0.28);' +
                        '">' + initial + '</div>' +
                        '<div style="min-width:0;">' +
                            '<div style="' +
                                'font-weight:600; font-size:0.88rem;' +
                                'color:var(--text-primary,#e0e0e0);' +
                                'white-space:nowrap; overflow:hidden; text-overflow:ellipsis;' +
                            '">' + p.username + '</div>' +
                            '<div style="' +
                                'font-size:0.71rem;' +
                                'color:var(--text-secondary,#9ca3af);' +
                                'display:flex; gap:7px; margin-top:2px;' +
                                'flex-wrap:wrap; align-items:center;' +
                            '">' +
                                (grantedByDisplay ? '<span>' + grantedByDisplay + '</span>' : '') +
                                (grantedAt ? '<span>' + grantedAt + '</span>' : '') +
                                autoBadgeHTML +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<button onclick="activityManager.revokePermission(\'' + activityId + '\',\'' + p.username + '\');"' +
                        ' style="' +
                            'flex-shrink:0; padding:5px 13px;' +
                            'background:rgba(220,53,69,0.08);' +
                            'border:1px solid rgba(220,53,69,0.2);' +
                            'color:#dc3545; border-radius:7px; cursor:pointer;' +
                            'font-size:0.79rem; font-weight:600;' +
                            'font-family:inherit; transition:all 0.2s;' +
                            'display:flex; align-items:center; gap:5px;' +
                            'white-space:nowrap;' +
                        '"' +
                        ' onmouseover="this.style.background=\'rgba(220,53,69,0.17)\';this.style.borderColor=\'rgba(220,53,69,0.38)\'"' +
                        ' onmouseout="this.style.background=\'rgba(220,53,69,0.08)\';this.style.borderColor=\'rgba(220,53,69,0.2)\'"' +
                    '>' +
                        '<i class="fas fa-times"></i> הסר' +
                    '</button>' +
                '</div>';
        }

        return '<div style="display:flex; flex-direction:column; gap:0;">' + itemsHTML + '</div>';
    }

    async grantPermission(activityId, username) {
        if (!username) {
            NotificationManager.show('יש לבחור משתמש', 'warning');
            return;
        }
        try {
            const response = await fetch('/Activities/SetActivityPermission', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    activityId,
                    username,
                    canToggle: true
                })
            });
            const result = await response.json();
            if (result.success) {
                NotificationManager.show(
                    `הרשאה ניתנה ל-${username}`, 'success');
                // רענן את המודל
                await this.openPermissionsModal(activityId);
            } else {
                NotificationManager.show(result.error || 'שגיאה', 'error');
            }
        } catch (err) {
            NotificationManager.show('שגיאת רשת', 'error');
        }
    }

    async revokePermission(activityId, username) {
        if (!confirm(`להסיר הרשאה מ-${username}?`)) return;
        try {
            const response = await fetch(
                `/Activities/RemoveActivityPermission` +
                `?activityId=${activityId}&username=${encodeURIComponent(username)}`,
                { method: 'DELETE' }
            );
            const result = await response.json();
            if (result.success) {
                NotificationManager.show(
                    `הרשאה הוסרה מ-${username}`, 'success');
                await this.openPermissionsModal(activityId);
            } else {
                NotificationManager.show(result.error || 'שגיאה', 'error');
            }
        } catch (err) {
            NotificationManager.show('שגיאת רשת', 'error');
        }
    }

    async updateTaskStatus(taskId, newStatus, showNotification = true) {
        try {
            if (this.isReadOnly) {
                if (window.activitiesDashboard &&
                    typeof window.activitiesDashboard.showLoginRequired === 'function') {
                    window.activitiesDashboard.showLoginRequired();
                }
                // החזר את ה-select לערך הקודם
                const taskResponse = await fetch(
                    `/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`
                );
                const taskResult = await taskResponse.json();
                if (taskResult.success && taskResult.task) {
                    const select = document.querySelector(
                        `.task-item[data-task-id="${taskId}"] .status-select`
                    );
                    if (select) select.value = taskResult.task.status || 'חדש';
                }
                return false;
            }
            // *** קבל את שם המשתמש המחובר ***
            const currentUserName = this.currentUser
                ? (this.currentUser.displayName ||
                    this.currentUser.username ||
                    this.currentUser.name ||
                    'משתמש')
                : 'משתמש';

            // Get current task data to preserve all fields
            const taskResponse = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const taskResult = await taskResponse.json();

            if (!taskResult.success || !taskResult.task) {
                if (showNotification) {
                    NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                }
                return false;
            }

            const task = taskResult.task;

            // Check if task is currently completed or skipped
            const isCurrentlyCompleted = task.completionDates && task.completionDates.includes(this.currentDate);
            const isCurrentlySkipped = task.skipReasons && task.skipReasons[this.currentDate];

            // Handle completion/skip status based on new status
            if (newStatus === 'בוצע') {
                // Remove skip if exists
                if (isCurrentlySkipped) {
                    await fetch('/Activities/UpdateTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: taskId,
                            activityId: this.currentActivityId,
                            status: task.status,
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || "",
                            clearSkipForDate: this.currentDate
                        })
                    });
                }

                // Mark as completed if not already
                if (!isCurrentlyCompleted) {
                    await fetch('/Activities/ToggleTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            taskId: taskId,
                            activityId: this.currentActivityId,
                            date: this.currentDate,
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || ""
                        })
                    });
                }
            } else if (newStatus === 'מבוטלת') {
                // Remove completion if exists
                if (isCurrentlyCompleted) {
                    await fetch('/Activities/ToggleTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            taskId: taskId,
                            activityId: this.currentActivityId,
                            date: this.currentDate,
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || ""
                        })
                    });
                }

                // Mark as skipped if not already
                if (!isCurrentlySkipped) {
                    await fetch('/Activities/SkipTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            taskId: taskId,
                            activityId: this.currentActivityId,
                            date: this.currentDate,
                            skipReason: 'שונה סטטוס למבוטלת',
                            skipUserName: currentUserName,  // *** שם המשתמש המחובר ***
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || ""
                        })
                    });
                }
            } else {
                // For other statuses (חדש, ממתין, בביצוע) - remove both completion and skip
                if (isCurrentlyCompleted) {
                    await fetch('/Activities/ToggleTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            taskId: taskId,
                            activityId: this.currentActivityId,
                            date: this.currentDate,
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || ""
                        })
                    });
                }

                if (isCurrentlySkipped) {
                    await fetch('/Activities/UpdateTask', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: taskId,
                            activityId: this.currentActivityId,
                            status: task.status,
                            title: task.title,
                            description: task.description || "",
                            priority: task.priority || "medium",
                            taskDate: task.taskDate || "",
                            taskHour: task.taskHour || "",
                            taskMinute: task.taskMinute || "",
                            responsiblePerson: task.responsiblePerson || "",
                            secondaryResponsible: task.secondaryResponsible || "",
                            notes: task.notes || "",
                            clearSkipForDate: this.currentDate
                        })
                    });
                }
            }

            // Finally update the task status
            const response = await fetch('/Activities/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: taskId,
                    activityId: this.currentActivityId,
                    status: newStatus,
                    title: task.title,
                    description: task.description || "",
                    priority: task.priority || "medium",
                    taskDate: task.taskDate || "",
                    taskHour: task.taskHour || "",
                    taskMinute: task.taskMinute || "",
                    responsiblePerson: task.responsiblePerson || "",
                    secondaryResponsible: task.secondaryResponsible || "",
                    notes: task.notes || ""
                })
            });

            const result = await response.json();

            if (result.success) {
                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                if (showNotification) {
                    NotificationManager.show(`סטטוס המשימה עודכן ל: ${newStatus}`, 'success');
                }
                return true;
            } else {
                if (showNotification) {
                    NotificationManager.show(result.error || 'שגיאה בעדכון הסטטוס', 'error');
                }
                return false;
            }
        } catch (error) {
            console.error('Error updating task status:', error);
            if (showNotification) {
                NotificationManager.show('שגיאה בחיבור לשרת', 'error');
            }
            return false;
        }
    }

    // Add task to activity
    openAddTaskModal() {
        const canAdd = this.isAdmin || this.isUserAdmin();
        
        if (!canAdd) {
            if (this.isReadOnly) {
                if (window.activitiesDashboard &&
                    typeof window.activitiesDashboard.showLoginRequired === 'function') {
                    window.activitiesDashboard.showLoginRequired();
                }
            } else {
                NotificationManager.show('אין הרשאה להוסיף משימות', 'warning');
            }
            return;
        }

        this.isModalOpen = true;
        if (!this.currentActivityId) {
            NotificationManager.show('יש לבחור פעילות תחילה', 'warning');
            return;
        }

        document.getElementById('activityTaskModalTitle').textContent = 'הוסף משימה לפעילות';
        document.getElementById('activityTaskSubmitBtn').textContent  = 'הוסף משימה';
        document.getElementById('activityTaskForm').reset();
        document.getElementById('activityTaskId').value          = '';
        document.getElementById('activityTaskDateHidden').value  = '';
        document.getElementById('activityTaskDate').value        = '';

        // *** חדש: איפוס שדות מייל ***
        const emailFields = [
            'activityTaskEmailTo',
            'activityTaskEmailCc', 
            'activityTaskEmailSubject',
            'activityTaskEmailBodyText'
        ];
        emailFields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // *** איפוס שדות חדשים ***
        ['activityTaskSystemName', 'activityTaskEnvironment',
        'activityTaskDependency', 'activityTaskDisruptionDuration',
        'activityTaskImpact'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // *** סגור קטע מייל בפתיחה ***
        const emailBody = document.getElementById('emailConfigBody');
        if (emailBody) emailBody.style.display = 'none';
        const emailIcon = document.getElementById('emailToggleIcon');
        if (emailIcon) emailIcon.className = 'fas fa-chevron-down';

        this.initializeTaskTimeInputListeners();
        this.updateTaskTimeClearButton();

        document.getElementById('addActivityTaskModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeAddTaskModal() {
        this.isModalOpen = false;
        document.getElementById('addActivityTaskModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('activityTaskForm').reset();

        // ── תאריך ──
        const hiddenDate = document.getElementById('activityTaskDateHidden');
        const visDate    = document.getElementById('activityTaskDate');
        if (hiddenDate) hiddenDate.value = '';
        if (visDate)    visDate.value    = '';

        // ── שדות קיימים ──
        ['activityTaskManager', 'activityTaskAlertsToCheck',
        'activityTaskEmailTo', 'activityTaskEmailCc',
        'activityTaskEmailSubject', 'activityTaskEmailBodyText'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // ── שדות חדשים ──
        ['activityTaskSystemName', 'activityTaskEnvironment',
        'activityTaskDependency', 'activityTaskDisruptionDuration',
        'activityTaskImpact'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // ── סגור קטע מייל ──
        const emailBody = document.getElementById('emailConfigBody');
        if (emailBody) emailBody.style.display = 'none';
        const emailIcon = document.getElementById('emailToggleIcon');
        if (emailIcon) emailIcon.className = 'fas fa-chevron-down';
    }

    async saveTask(taskData, isEditing = false) {
        try {
            taskData.activityId = this.currentActivityId;

            // ── תאריך ──
            const taskDateHidden = document.getElementById('activityTaskDateHidden');
            if (taskDateHidden && taskDateHidden.value) {
                taskData.taskDate = taskDateHidden.value;
            }

            // ── שעה ──
            taskData.taskHour   = document.getElementById('activityTaskHour')?.value   || '';
            taskData.taskMinute = document.getElementById('activityTaskMinute')?.value || '';

            // ── שדות טקסט קיימים ──
            taskData.alertsToCheck = document.getElementById('activityTaskAlertsToCheck')?.value || '';
            taskData.notes         = document.getElementById('activityTaskNotes')?.value         ?? '';
            taskData.emailTo       = document.getElementById('activityTaskEmailTo')?.value       || '';
            taskData.emailCc       = document.getElementById('activityTaskEmailCc')?.value       || '';
            taskData.emailSubject  = document.getElementById('activityTaskEmailSubject')?.value  || '';
            taskData.emailBody     = document.getElementById('activityTaskEmailBodyText')?.value || '';

            // ── שדות חדשים - טקסט חופשי ──
            taskData.systemName         = document.getElementById('activityTaskSystemName')?.value         || '';
            taskData.environment        = document.getElementById('activityTaskEnvironment')?.value        || '';
            taskData.dependency         = document.getElementById('activityTaskDependency')?.value         || '';
            taskData.disruptionDuration = document.getElementById('activityTaskDisruptionDuration')?.value || '';
            taskData.impact             = document.getElementById('activityTaskImpact')?.value             || '';

            const url    = isEditing ? '/Activities/UpdateTask' : '/Activities/AddTask';
            const method = isEditing ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(taskData)
            });

            const result = await response.json();

            if (result.success) {
                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                this.closeAddTaskModal();
                NotificationManager.show(
                    isEditing ? 'משימה עודכנה בהצלחה!' : 'משימה נוספה בהצלחה!',
                    'success'
                );
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירת המשימה', 'error');
            }
        } catch (error) {
            console.error('Error saving task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    async grantManagerPermissionAuto(activityId, managerName) {
        if (!managerName || !managerName.trim()) return;

        try {
            // חפש את המשתמש לפי שם תצוגה / username
            const usersResponse = await fetch(
                '/Auth/GetAllUsersForPermissions',
                { credentials: 'include' }
            );

            if (!usersResponse.ok) return;

            const usersData = await usersResponse.json();
            if (!usersData.success) return;

            const allUsers = usersData.users || [];
            const managerLower = managerName.trim().toLowerCase();

            // מצא התאמה לפי displayName או username
            const matchedUser = allUsers.find(u =>
                (u.displayName || '').toLowerCase() === managerLower ||
                (u.username    || '').toLowerCase() === managerLower
            );

            if (!matchedUser) {
                console.log(`Manager "${managerName}" not found in system users - skipping auto-grant`);
                return;
            }

            // בדוק אם כבר יש הרשאה
            const permResponse = await fetch(
                `/Activities/GetActivityPermissions?activityId=${activityId}`
            );
            const permResult = await permResponse.json();
            const permissions = permResult.success ? permResult.permissions : [];

            const alreadyHasPermission = permissions.some(
                p => p.username === matchedUser.username
            );

            if (alreadyHasPermission) return; // כבר יש הרשאה

            // *** הוסף grantedBy: "מערכת" כדי לסמן כאוטומטי ***
            const grantResponse = await fetch('/Activities/SetActivityPermission', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    activityId,
                    username:  matchedUser.username,
                    canToggle: true,
                    grantedBy: 'מערכת'   // *** חדש: מסמן כהרשאה אוטומטית ***
                })
            });

            const grantResult = await grantResponse.json();

            if (grantResult.success) {
                NotificationManager.show(
                    `הרשאת סימון ניתנה אוטומטית ל-${matchedUser.username} (מנהל פעילות)`,
                    'info'
                );
            }
        } catch (err) {
            console.warn('Auto-grant permission failed:', err);
        }
    }

    // Edit task
    async editTask(taskId) {
        try {
            const response = await fetch(
                `/Activities/GetTask?taskId=${taskId}` +
                `&activityId=${this.currentActivityId}`
            );
            const result = await response.json();

            if (!result.success || !result.task) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            const task = result.task;

            // *** פונקציית עזר פנימית - setBySafeId ***
            const setVal = (id, value) => {
                const el = document.getElementById(id);
                if (el) {
                    el.value = value ?? '';
                } else {
                    console.warn(`editTask: element #${id} not found in DOM`);
                }
            };

            const setText = (id, value) => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = value ?? '';
                } else {
                    console.warn(`editTask: element #${id} not found in DOM`);
                }
            };

            // *** עדכן כותרת מודל ***
            setText('activityTaskModalTitle', 'ערוך משימה');

            const submitBtn = document.getElementById('activityTaskSubmitBtn');
            if (submitBtn) submitBtn.textContent = 'עדכן משימה';

            // *** מלא שדות ***
            setVal('activityTaskId',          task.id);
            setVal('activityTaskTitle',       task.title);
            setVal('activityTaskDescription', task.description || '');
            setVal('activityTaskPriority',    task.priority    || 'medium');
            setVal('activityTaskStatus',      task.status      || 'חדש');
            setVal('activityTaskResponsible', task.responsiblePerson    || '');
            setVal('activityTaskSecondary',   task.secondaryResponsible || '');
            setVal('activityTaskNotes',       task.notes       || '');
            setVal('activityTaskHour',        task.taskHour    || '');
            setVal('activityTaskMinute',      task.taskMinute  || '');

            // *** שדות שאולי חדשים/אופציונליים ***
            setVal('activityTaskAlertsToCheck',  task.alertsToCheck    || '');
            setVal('activityTaskEmailTo',       task.emailTo      || '');
            setVal('activityTaskEmailCc',       task.emailCc      || '');
            setVal('activityTaskEmailSubject',  task.emailSubject || '');
            setVal('activityTaskEmailBodyText', task.emailBody    || '');
            setVal('activityTaskSystemName',         task.systemName         || '');
            setVal('activityTaskEnvironment',        task.environment        || '');
            setVal('activityTaskDependency',         task.dependency         || '');
            setVal('activityTaskDisruptionDuration', task.disruptionDuration || '');
            setVal('activityTaskImpact',             task.impact             || '');


            // *** תאריך ***
            if (task.taskDate) {
                setVal('activityTaskDateHidden', task.taskDate);
                setVal('activityTaskDate',       this.formatDate(task.taskDate));
            } else {
                setVal('activityTaskDateHidden', '');
                setVal('activityTaskDate',       '');
            }

            // *** עדכון כפתור ניקוי שעה ***
            this.updateTaskTimeClearButton();

            // *** פתח מודל ***
            const modal = document.getElementById('addActivityTaskModal');
            if (modal) {
                modal.style.display = 'block';
                document.body.style.overflow = 'hidden';
            } else {
                console.error('editTask: modal #addActivityTaskModal not found!');
            }

        } catch (error) {
            console.error('Error loading task:', error);
            NotificationManager.show('שגיאה בטעינת המשימה', 'error');
        }
    }

    async resendTaskEmail(taskId) {
        if (!confirm('לשלוח את המייל שוב?')) return;
        try {
            const currentUserName = this.currentUser
                ? (this.currentUser.displayName || 
                this.currentUser.username    || 
                this.currentUser.name        || 
                'מערכת')
                : 'מערכת';

            const response = await fetch('/Activities/SendTaskEmail', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId:      taskId,
                    completedBy: currentUserName
                })
            });

            const result = await response.json();
            if (result.success) {
                NotificationManager.show('מייל נשלח בהצלחה!', 'success');
                await this.loadActivityTasks(
                    this.currentActivityId, 
                    this.currentDate
                );
            } else {
                NotificationManager.show(
                    result.error || 'שגיאה בשליחת מייל', 
                    'error'
                );
            }
        } catch (error) {
            console.error('Error resending email:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Delete task
    async deleteTask(taskId) {
        if (!confirm('האם למחוק את המשימה?')) return;

        try {
            const response = await fetch(`/Activities/DeleteTask?taskId=${taskId}&activityId=${this.currentActivityId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (!this.handleApiResponse(result)) return;
            if (result.success) {
                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                NotificationManager.show('המשימה נמחקה בהצלחה', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקת המשימה', 'error');
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Skip reason modal
    async openSkipModal(taskId) {
        if (this.isReadOnly) {
            if (window.activitiesDashboard &&
                typeof window.activitiesDashboard.showLoginRequired === 'function') {
                window.activitiesDashboard.showLoginRequired();
            }
            return;
        }
        this.isModalOpen = true;
        document.getElementById('activitySkipTaskId').value = taskId;
        document.getElementById('activitySkipReasonSelect').value = '';
        document.getElementById('activitySkipReasonCustom').value = '';
        document.getElementById('activityCustomReasonGroup').style.display = 'none';

        // *** שינוי: קבל שם יוזר מחובר ***
        const currentUserName = this.currentUser
            ? (this.currentUser.displayName || this.currentUser.username || this.currentUser.name || 'משתמש')
            : 'משתמש';

        // עדכן את השדה הנסתר
        const userNameHidden = document.getElementById('activitySkipUserName');
        if (userNameHidden) {
            userNameHidden.value = currentUserName;
        }

        // עדכן את תצוגת השם
        const userDisplay = document.getElementById('skipCurrentUserDisplay');
        if (userDisplay) {
            userDisplay.textContent = currentUserName;
        }

        document.getElementById('activitySkipReasonModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeSkipModal() {
        this.isModalOpen = false;
        document.getElementById('activitySkipReasonModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('activitySkipReasonForm').reset();
    }

    handleTaskDateChange(isoDate) {
        if (isoDate) {
            const formattedDate = this.formatDate(isoDate);
            document.getElementById('activityTaskDate').value = formattedDate;
        }
    }

    // Save last selected employee to localStorage
    saveLastSelectedEmployee(employeeName) {
        if (employeeName && employeeName !== '') {
            userSettings.setItem('lastSelectedEmployee', employeeName);
        }
    }

    async markTaskAsSkipped(taskId, skipReason, userName) {
        try {
            // First, get the current task data to preserve all fields
            const taskResponse = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const taskResult = await taskResponse.json();

            if (!taskResult.success || !taskResult.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const task = taskResult.task;

            this.saveLastSelectedEmployee(userName);

            // Send the skip request with all task fields preserved
            const response = await fetch('/Activities/SkipTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taskId: taskId,
                    activityId: this.currentActivityId,
                    date: this.currentDate,
                    skipReason: skipReason,
                    skipUserName: userName,
                    title: task.title,
                    description: task.description || "",
                    priority: task.priority || "medium",
                    taskDate: task.taskDate || "",
                    taskHour: task.taskHour || "",
                    taskMinute: task.taskMinute || "",
                    responsiblePerson: task.responsiblePerson || "",
                    secondaryResponsible: task.secondaryResponsible || "",
                    notes: task.notes || ""
                })
            });

            const result = await response.json();

            if (!this.handleApiResponse(result)) return;
            if (result.success) {
                // Update task status to "מבוטלת" while preserving all fields
                const updateResponse = await fetch('/Activities/UpdateTask', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: taskId,
                        activityId: this.currentActivityId,
                        status: 'מבוטלת',
                        title: task.title,
                        description: task.description || "",
                        priority: task.priority || "medium",
                        taskDate: task.taskDate || "",
                        taskHour: task.taskHour || "",
                        taskMinute: task.taskMinute || "",
                        responsiblePerson: task.responsiblePerson || "",
                        secondaryResponsible: task.secondaryResponsible || "",
                        notes: task.notes || ""
                    })
                });

                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                NotificationManager.show(`משימה סומנה כלא בוצעה: ${skipReason}`, 'info');
            } else {
                NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
            }
        } catch (error) {
            console.error('Error marking task as skipped:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Clear skip reason for activity task
    async clearSkipReason(taskId, skipConfirmation = false) {

        if (!skipConfirmation && !confirm('האם לבטל את סיבת אי הביצוע?')) {
            return;
        }

        try {
            // Get current task data to preserve all fields
            const taskResponse = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const taskResult = await taskResponse.json();

            if (!taskResult.success || !taskResult.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const currentTask = taskResult.task;

            // Clear skip reason by updating task - and set status to "חדש"
            const clearData = {
                id: taskId,
                activityId: this.currentActivityId,
                title: currentTask.title,
                description: currentTask.description || "",
                priority: currentTask.priority || "medium",
                taskDate: currentTask.taskDate || "",
                taskHour: currentTask.taskHour || "",
                taskMinute: currentTask.taskMinute || "",
                responsiblePerson: currentTask.responsiblePerson || "",
                secondaryResponsible: currentTask.secondaryResponsible || "",
                notes: currentTask.notes || "",
                status: "חדש",
                clearSkipForDate: this.currentDate
            };

            const response = await fetch('/Activities/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(clearData)
            });

            const result = await response.json();

            if (!this.handleApiResponse(result)) return;
            if (result.success) {
                // Reload tasks to reflect changes
                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                NotificationManager.show('סיבת אי הביצוע בוטלה והסטטוס שונה ל"חדש"', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בביטול סיבת אי הביצוע', 'error');
            }
        } catch (error) {
            console.error('Error clearing skip reason:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // ─────────────────────────────────────────────
    // 1. HISTORY - היסטוריית שינויים
    // ─────────────────────────────────────────────

    async loadTaskHistory(taskId) {
        try {
            const response = await fetch(
                `/Activities/GetTaskHistory?taskId=${taskId}&activityId=${this.currentActivityId}`
            );
            const result = await response.json();
            if (result.success) {
                return result.history || [];
            }
            return [];
        } catch (error) {
            console.error('Error loading task history:', error);
            return [];
        }
    }

    renderTaskHistory(history) {
        if (!history || history.length === 0) {
            return `
            <div class="task-history-empty">
                <i class="fas fa-history"></i>
                <p>אין היסטוריית שינויים</p>
            </div>`;
        }

        const actionIcons = {
            'created': { icon: 'fas fa-plus-circle', color: '#28a745', label: 'נוצרה' },
            'updated': { icon: 'fas fa-edit', color: '#667eea', label: 'עודכנה' },
            'completed': { icon: 'fas fa-check-circle', color: '#28a745', label: 'הושלמה' },
            'uncompleted': { icon: 'fas fa-undo', color: '#ffc107', label: 'בוטל ביצוע' },
            'skipped': { icon: 'fas fa-ban', color: '#dc3545', label: 'לא בוצעה' },
            'unskipped': { icon: 'fas fa-undo', color: '#17a2b8', label: 'בוטל דילוג' },
            'status_changed': { icon: 'fas fa-exchange-alt', color: '#764ba2', label: 'שונה סטטוס' },
            'deleted': { icon: 'fas fa-trash', color: '#dc3545', label: 'נמחקה' },
        };

        return history.map(entry => {
            const actionInfo = actionIcons[entry.action] ||
                { icon: 'fas fa-circle', color: '#999', label: entry.action };

            const date = entry.timestamp
                ? new Date(entry.timestamp).toLocaleDateString('he-IL')
                : '';
            const time = entry.timestamp
                ? new Date(entry.timestamp).toLocaleTimeString('he-IL',
                    { hour: '2-digit', minute: '2-digit' })
                : '';

            let detailsHtml = '';
            if (entry.changes && Object.keys(entry.changes).length > 0) {
                const fieldLabels = {
                    title: 'כותרת',
                    description: 'תיאור',
                    priority: 'עדיפות',
                    status: 'סטטוס',
                    taskDate: 'תאריך',
                    taskHour: 'שעה',
                    taskMinute: 'דקות',
                    responsiblePerson: 'אחראי',
                    secondaryResponsible: 'אחראי משנה',
                    notes: 'הערות',
                };

                detailsHtml = `<div class="history-changes">`;
                Object.entries(entry.changes).forEach(([field, change]) => {
                    const label = fieldLabels[field] || field;
                    detailsHtml += `
                    <div class="history-change-item">
                        <span class="change-field">${label}:</span>
                        <span class="change-before">${change.before || '(ריק)'}</span>
                        <i class="fas fa-arrow-left change-arrow"></i>
                        <span class="change-after">${change.after || '(ריק)'}</span>
                    </div>`;
                });
                detailsHtml += `</div>`;
            }

            if (entry.note) {
                detailsHtml += `
                <div class="history-note">
                    <i class="fas fa-comment"></i>
                    <span>${entry.note}</span>
                </div>`;
            }

            return `
            <div class="history-entry-item">
                <div class="history-entry-icon"
                     style="background:${actionInfo.color}20;
                            border:2px solid ${actionInfo.color}40;">
                    <i class="${actionInfo.icon}"
                       style="color:${actionInfo.color};"></i>
                </div>
                <div class="history-entry-content">
                    <div class="history-entry-header">
                        <span class="history-action-label"
                              style="color:${actionInfo.color};">
                            ${actionInfo.label}
                        </span>
                        ${entry.userName
                    ? `<span class="history-user">
                                   <i class="fas fa-user"></i> ${entry.userName}
                               </span>`
                    : ''}
                        <span class="history-time">
                            <i class="fas fa-clock"></i> ${date} ${time}
                        </span>
                    </div>
                    ${detailsHtml}
                </div>
            </div>`;
        }).join('');
    }

    // ─────────────────────────────────────────────
    // 2. TASK POPUP - פופאפ צפייה במשימה
    // ─────────────────────────────────────────────

    async openTaskViewPopup(taskId) {
        try {
            const response = await fetch(
                `/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`
            );
            const result = await response.json();

            if (!result.success || !result.task) {
                NotificationManager.show('שגיאה בטעינת המשימה', 'error');
                return;
            }

            const task = result.task;
            const history = await this.loadTaskHistory(taskId);

            // סגור פופאפ קיים
            this.closeTaskViewPopup();

            const isCompleted = task.completionDates &&
                task.completionDates.includes(this.currentDate);
            const skipReason = task.skipReasons &&
                task.skipReasons[this.currentDate];

            const priorityLabels = {
                high: { label: 'גבוהה', color: '#dc3545' },
                medium: { label: 'בינונית', color: '#ffc107' },
                low: { label: 'נמוכה', color: '#667eea' },
            };
            const pInfo = priorityLabels[task.priority] ||
                { label: task.priority, color: '#999' };

            const statusColors = {
                'חדש': '#2196F3',
                'ממתין': '#FF9800',
                'בביצוע': '#9C27B0',
                'בוצע': '#4CAF50',
                'מבוטלת': '#F44336',
            };
            const statusColor = statusColors[task.status] || '#999';

            const popup = document.createElement('div');
            popup.id = 'taskViewPopup';
            popup.className = 'task-view-popup-overlay';
            popup.innerHTML = `
            <div class="task-view-popup">
                <!-- Header -->
                <div class="task-view-header">
                    <div class="task-view-title-row">
                        <div class="task-priority-dot"
                             style="background:${pInfo.color};"
                             title="עדיפות ${pInfo.label}"></div>
                        <h2 class="task-view-title">${task.title}</h2>
                        <button class="task-view-close"
                                onclick="activityManager.closeTaskViewPopup()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    ${(task.systemName || task.environment || 
                        task.dependency || task.disruptionDuration || task.impact) ? `
                            <div class="task-view-section">
                                <div class="task-view-section-label">
                                    <i class="fas fa-server" style="color:#667eea;"></i>
                                    פרטי מערכת ותשתית
                                </div>
                                <div style="
                                    display: flex;
                                    flex-direction: column;
                                    gap: 6px;
                                    background: rgba(102,126,234,0.04);
                                    border: 1px solid rgba(102,126,234,0.15);
                                    border-radius: 8px;
                                    padding: 10px 12px;
                                    font-size: 0.84rem;
                                ">
                                    ${task.systemName ? `
                                    <div style="display:flex; gap:8px; align-items:flex-start;">
                                        <span style="color:#667eea; font-weight:600; 
                                                    min-width:120px; flex-shrink:0;">
                                            <i class="fas fa-server"></i> מערכת:
                                        </span>
                                        <span>${task.systemName}</span>
                                    </div>` : ''}

                                    ${task.environment ? `
                                    <div style="display:flex; gap:8px; align-items:flex-start;">
                                        <span style="color:#667eea; font-weight:600; 
                                                    min-width:120px; flex-shrink:0;">
                                            <i class="fas fa-layer-group"></i> סביבה:
                                        </span>
                                        <span>${task.environment}</span>
                                    </div>` : ''}

                                    ${task.dependency ? `
                                    <div style="display:flex; gap:8px; align-items:flex-start;">
                                        <span style="color:#667eea; font-weight:600; 
                                                    min-width:120px; flex-shrink:0;">
                                            <i class="fas fa-project-diagram"></i> תלות:
                                        </span>
                                        <span>${task.dependency}</span>
                                    </div>` : ''}

                                    ${task.disruptionDuration ? `
                                    <div style="display:flex; gap:8px; align-items:flex-start;">
                                        <span style="color:#f59e0b; font-weight:600; 
                                                    min-width:120px; flex-shrink:0;">
                                            <i class="fas fa-hourglass-half"></i> זמן שיבוש:
                                        </span>
                                        <span>${task.disruptionDuration}</span>
                                    </div>` : ''}

                                    ${task.impact ? `
                                    <div style="display:flex; gap:8px; align-items:flex-start;">
                                        <span style="color:#dc3545; font-weight:600; 
                                                    min-width:120px; flex-shrink:0;">
                                            <i class="fas fa-bolt"></i> השפעה:
                                        </span>
                                        <span>${task.impact}</span>
                                    </div>` : ''}
                                </div>
                            </div>
                        ` : ''}
                    <div class="task-view-badges">
                        <span class="task-view-badge"
                              style="background:${statusColor}20;
                                     color:${statusColor};
                                     border:1px solid ${statusColor}40;">
                            ${task.status || 'חדש'}
                        </span>
                        <span class="task-view-badge priority-badge"
                              style="background:${pInfo.color}20;
                                     color:${pInfo.color};
                                     border:1px solid ${pInfo.color}40;">
                            <i class="fas fa-flag"></i> ${pInfo.label}
                        </span>
                        ${isCompleted
                    ? `<span class="task-view-badge"
                                     style="background:#28a74520;color:#28a745;
                                            border:1px solid #28a74540;">
                                   <i class="fas fa-check"></i> הושלם
                               </span>`
                    : ''}
                        ${skipReason
                    ? `<span class="task-view-badge"
                                     style="background:#dc354520;color:#dc3545;
                                            border:1px solid #dc354540;">
                                   <i class="fas fa-ban"></i> לא בוצע
                               </span>`
                    : ''}
                    </div>
                </div>

                <!-- Tabs -->
                <div class="task-view-tabs">
                    <button class="task-view-tab active"
                            onclick="activityManager.switchTaskViewTab('details', this)">
                        <i class="fas fa-info-circle"></i> פרטים
                    </button>
                    <button class="task-view-tab"
                            onclick="activityManager.switchTaskViewTab('history', this)">
                        <i class="fas fa-history"></i>
                        היסטוריה
                        ${history.length > 0
                    ? `<span class="tab-badge">${history.length}</span>`
                    : ''}
                    </button>
                </div>

                <!-- Tab: Details -->
                <div id="taskViewTabDetails" class="task-view-tab-content active">
                    <div class="task-view-body">
                        ${task.description
                    ? `<div class="task-view-section">
                                   <div class="task-view-section-label">
                                       <i class="fas fa-align-left"></i> תיאור
                                   </div>
                                   <div class="task-view-section-value">
                                       ${task.description}
                                   </div>
                               </div>`
                    : ''}

                        <div class="task-view-grid">
                            ${task.taskDate
                    ? `<div class="task-view-info-item">
                                       <i class="fas fa-calendar" style="color:#667eea;"></i>
                                       <div>
                                           <div class="info-label">תאריך</div>
                                           <div class="info-value">
                                               ${this.formatDate(task.taskDate)}
                                           </div>
                                       </div>
                                   </div>`
                    : ''}
                            ${task.taskHour && task.taskMinute
                    ? `<div class="task-view-info-item">
                                       <i class="fas fa-clock" style="color:#667eea;"></i>
                                       <div>
                                           <div class="info-label">שעה</div>
                                           <div class="info-value">
                                               ${task.taskHour}:${task.taskMinute}
                                               ${task.hasAlarm
                        ? `<i class="fas fa-bell alarm-icon-active"
                                                         title="תזכורת פעילה"></i>`
                        : ''}
                                           </div>
                                       </div>
                                   </div>`
                    : ''}
                            ${task.responsiblePerson
                    ? `<div class="task-view-info-item">
                                       <i class="fas fa-user" style="color:#667eea;"></i>
                                       <div>
                                           <div class="info-label">אחראי</div>
                                           <div class="info-value">
                                               ${task.responsiblePerson}
                                           </div>
                                       </div>
                                   </div>`
                    : ''}
                            ${task.secondaryResponsible
                    ? `<div class="task-view-info-item">
                                       <i class="fas fa-user-friends"
                                          style="color:#667eea;"></i>
                                       <div>
                                           <div class="info-label">אחראי משנה</div>
                                           <div class="info-value">
                                               ${task.secondaryResponsible}
                                           </div>
                                       </div>
                                   </div>`
                    : ''}
                    ${task.activityManager ? `
                        <div class="task-view-info-item">
                            <i class="fas fa-user-tie" style="color:#667eea;"></i>
                            <div>
                                <div class="info-label">מנהל פעילות</div>
                                <div class="info-value">
                                    ${task.activityManager}
                                </div>
                            </div>
                        </div>
                    ` : ''}
                        </div>

                        ${task.notes
                    ? `<div class="task-view-section">
                                   <div class="task-view-section-label">
                                       <i class="fas fa-sticky-note"></i> הערות
                                   </div>
                                   <div class="task-view-section-value notes-value">
                                       ${task.notes}
                                   </div>
                               </div>`
                    : ''}

                    ${task.alertsToCheck ? `
                        <div class="task-view-section">
                            <div class="task-view-section-label">
                                <i class="fas fa-satellite-dish"
                                style="color:#f59e0b;"></i>
                                התראות לבדיקה
                            </div>
                            <div class="task-view-section-value" style="
                                background:rgba(245,158,11,0.06);
                                border:1px solid rgba(245,158,11,0.2);
                                border-right:3px solid #f59e0b;
                                border-radius:8px;
                                padding:10px 12px;
                                font-size:0.88rem;
                                line-height:1.6;
                            ">
                                ${task.alertsToCheck}
                            </div>
                        </div>
                    ` : ''}

                    ${task.emailTo ? `
                        <div class="task-view-section">
                            <div class="task-view-section-label">
                                <i class="fas fa-envelope"
                                style="color:#667eea;"></i>
                                הגדרות מייל
                            </div>
                            <div style="
                                border-radius: 8px;
                                padding: 10px 12px;
                                background: rgba(102,126,234,0.06);
                                border: 1px solid rgba(102,126,234,0.2);
                                font-size: 0.82rem;
                                display: flex;
                                flex-direction: column;
                                gap: 5px;
                            ">
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <span style="color:#667eea; font-weight:600; 
                                                min-width:50px;">TO:</span>
                                    <span style="direction:ltr;">${task.emailTo}</span>
                                </div>
                                ${task.emailCc ? `
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <span style="color:#667eea; font-weight:600;
                                                min-width:50px;">CC:</span>
                                    <span style="direction:ltr;">${task.emailCc}</span>
                                </div>
                                ` : ''}
                                ${task.emailSent ? `
                                <div style="
                                    display:flex; align-items:center; gap:6px;
                                    margin-top:4px;
                                    padding: 4px 8px;
                                    background: rgba(40,167,69,0.1);
                                    border-radius: 5px;
                                    color: #28a745;
                                    font-size: 0.78rem;
                                    font-weight: 600;
                                ">
                                    <i class="fas fa-check-circle"></i>
                                    מייל נשלח
                                    ${task.emailSentAt 
                                        ? `<span style="font-weight:400;color:#555;">
                                            · ${task.emailSentAt.substring(0,16)}
                                        </span>` 
                                        : ''}
                                    <button onclick="activityManager.resendTaskEmail('${task.id}')"
                                            style="
                                                margin-right: auto;
                                                background: rgba(40,167,69,0.12);
                                                border: 1px solid rgba(40,167,69,0.3);
                                                color: #28a745;
                                                border-radius: 5px;
                                                padding: 3px 8px;
                                                cursor: pointer;
                                                font-size: 0.75rem;
                                                font-weight: 600;
                                            ">
                                        <i class="fas fa-redo"></i> שלח שוב
                                    </button>
                                </div>
                                ` : `
                                <div style="
                                    display:flex; align-items:center; gap:6px;
                                    margin-top:4px;
                                    padding: 4px 8px;
                                    background: rgba(102,126,234,0.08);
                                    border-radius: 5px;
                                    color: #667eea;
                                    font-size: 0.78rem;
                                ">
                                    <i class="fas fa-clock"></i>
                                    ממתין לשליחה עם ביצוע המשימה
                                </div>
                                `}
                            </div>
                        </div>
                    ` : ''}

                        ${isCompleted && task.completedByEmployees
                    ? (() => {
                        const dates = Object.keys(task.completedByEmployees)
                            .sort((a, b) => new Date(b) - new Date(a));
                        if (!dates.length) return '';
                        const d = dates[0];
                        return `
                                    <div class="task-view-section completion-section">
                                        <div class="task-view-section-label">
                                            <i class="fas fa-user-check"></i> ביצוע
                                        </div>
                                        <div class="completion-info">
                                            <span>
                                                <i class="fas fa-user"></i>
                                                ${task.completedByEmployees[d]}
                                            </span>
                                            ${task.completionTimes && task.completionTimes[d]
                                ? `<span>
                                                       <i class="fas fa-clock"></i>
                                                       ${task.completionTimes[d]}
                                                   </span>`
                                : ''}
                                        </div>
                                    </div>`;
                    })()
                    : ''}

                        ${skipReason
                    ? `<div class="task-view-section skip-section">
                                   <div class="task-view-section-label">
                                       <i class="fas fa-ban"></i> סיבת אי ביצוע
                                   </div>
                                   <div class="task-view-section-value">
                                       ${skipReason}
                                   </div>
                               </div>`
                    : ''}
                    </div>
                </div>

                <!-- Tab: History -->
                <div id="taskViewTabHistory"
                     class="task-view-tab-content"
                     style="display:none;">
                    <div class="task-view-body history-body">
                        <div class="task-history-list">
                            ${this.renderTaskHistory(history)}
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="task-view-footer">
                    <button class="task-view-btn edit-btn"
                            onclick="activityManager.closeTaskViewPopup();
                                     activityManager.editTask('${taskId}')">
                        <i class="fas fa-edit"></i> ערוך
                    </button>
                    <button class="task-view-btn close-btn"
                            onclick="activityManager.closeTaskViewPopup()">
                        <i class="fas fa-times"></i> סגור
                    </button>
                </div>
            </div>`;

            document.body.appendChild(popup);
            this.currentTaskPopup = popup;
            this.isModalOpen = true;

            // סגירה בלחיצה על הרקע
            popup.addEventListener('click', (e) => {
                if (e.target === popup) this.closeTaskViewPopup();
            });

            // סגירה ב-Escape
            this._taskPopupEscHandler = (e) => {
                if (e.key === 'Escape') this.closeTaskViewPopup();
            };
            document.addEventListener('keydown', this._taskPopupEscHandler);

        } catch (error) {
            console.error('Error opening task view popup:', error);
            NotificationManager.show('שגיאה בפתיחת המשימה', 'error');
        }
    }

    closeTaskViewPopup() {
        if (this.currentTaskPopup) {
            this.currentTaskPopup.remove();
            this.currentTaskPopup = null;
        }
        if (this._taskPopupEscHandler) {
            document.removeEventListener('keydown', this._taskPopupEscHandler);
            this._taskPopupEscHandler = null;
        }
        this.isModalOpen = false;
    }

    switchTaskViewTab(tabName, btnEl) {
        // הסר active מכל הטאבים
        document.querySelectorAll('.task-view-tab').forEach(t =>
            t.classList.remove('active')
        );
        document.querySelectorAll('.task-view-tab-content').forEach(c =>
            c.style.display = 'none'
        );

        // הפעל את הטאב הנבחר
        btnEl.classList.add('active');
        const content = document.getElementById(
            `taskViewTab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`
        );
        if (content) content.style.display = 'block';
    }

    // ─────────────────────────────────────────────
    // 3. ALARM - תזכורת (פעמון) למשימה
    // ─────────────────────────────────────────────
    startActivityAlarmMonitoring() {
        if (this.alarmCheckInterval) return;

        this.alarmCheckInterval = setInterval(() => {
            this.checkActivityAlarms();
        }, 60000); // כל דקה - בסדר

        // המתן קצת כדי שהפעילויות יטענו קודם
        setTimeout(() => {
            this.checkActivityAlarms();
        }, 2000);
    }

    stopActivityAlarmMonitoring() {
        if (this.alarmCheckInterval) {
            clearInterval(this.alarmCheckInterval);
            this.alarmCheckInterval = null;
        }
    }

    async checkActivityAlarms() {
        try {
            const today = new Date().toISOString().split('T')[0];

            // בדוק את כל הפעילויות הלא מאורכבות
            const activitiesToCheck = this.activities.filter(a => !a.archived);

            for (const activity of activitiesToCheck) {
                const response = await fetch(
                    `/Activities/GetActivityTasks?activityId=${activity.id}&date=${today}`
                );
                const tasks = await response.json();
                if (!Array.isArray(tasks)) continue;

                const now = new Date();
                const currentTime = now.getHours() * 60 + now.getMinutes();

                tasks.forEach(task => {
                    if (!task.hasAlarm || !task.taskHour || !task.taskMinute) return;

                    const isCompleted = task.completionDates &&
                        task.completionDates.includes(today);
                    if (isCompleted) return;

                    const taskTime = parseInt(task.taskHour) * 60 + parseInt(task.taskMinute);
                    const diff = taskTime - currentTime;

                    if (diff >= -5 && diff <= 5) {
                        const alarmKey = `${task.id}_${today}_${task.taskHour}:${task.taskMinute}`;
                        if (!this.shownAlarms.has(alarmKey)) {
                            // שמור את ה-activityId הנכון לתזכורת
                            this.showActivityAlarmNotification(task, diff, activity.id);
                            this.shownAlarms.add(alarmKey);
                            setTimeout(() => this.shownAlarms.delete(alarmKey), 900000);
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error checking activity alarms:', error);
        }
    }

    showActivityAlarmNotification(task, diffMinutes, activityId = null) {
    const resolvedActivityId = activityId || 
                               task.activityId || 
                               this.currentActivityId;
        const currentActivity = this.activities.find(a => a.id === resolvedActivityId);
        const activityName = currentActivity ? currentActivity.name : '';

        const popup = document.createElement('div');
        popup.className = 'activity-alarm-popup';

        const timeText = diffMinutes === 0
            ? 'עכשיו!'
            : diffMinutes > 0
                ? `בעוד ${diffMinutes} דקות`
                : `לפני ${Math.abs(diffMinutes)} דקות`;

        popup.innerHTML = `
    <div class="activity-alarm-content">
        <div class="activity-alarm-header">
            <i class="fas fa-bell alarm-bell-ring"></i>
            <span>תזכורת משימה</span>
            <button class="alarm-close-btn"
                    onclick="this.closest('.activity-alarm-popup').remove()">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="activity-alarm-body">
            ${activityName ? `
            <div class="alarm-activity-name">
                <i class="fas fa-folder-open"></i>
                <span>פעילות: <strong>${activityName}</strong></span>
            </div>
            ` : ''}
            <div class="alarm-task-name">${task.title}</div>
            <div class="alarm-time-info">
                <i class="fas fa-clock"></i>
                ${task.taskHour}:${task.taskMinute} — ${timeText}
            </div>
            ${task.responsiblePerson
                ? `<div class="alarm-responsible">
                       <i class="fas fa-user"></i>
                       ${task.responsiblePerson}
                   </div>`
                : ''}
        </div>
        <div class="activity-alarm-footer">

            <button class="alarm-action-btn primary"
                    onclick="
                        const btn = this;
                        btn.disabled = true;
                        const popupEl = btn.closest('.activity-alarm-popup');
                        activityManager.selectActivity('${resolvedActivityId}')
                            .then(() => activityManager.toggleTask('${task.id}'))
                            .then(() => popupEl.remove())
                            .catch(() => { btn.disabled = false; });
                    ">
                <i class="fas fa-check"></i> סמן כבוצע
            </button>

            <button class="alarm-action-btn navigate"
                    onclick="activityManager.navigateToAlarmTask(
                                '${resolvedActivityId}',
                                '${task.id}',
                                this.closest('.activity-alarm-popup')
                             )">
                <i class="fas fa-external-link-alt"></i> עבור למשימה
            </button>

            <button class="alarm-action-btn secondary"
                    onclick="this.closest('.activity-alarm-popup').remove();">
                <i class="fas fa-times"></i> סגור
            </button>
        </div>
    </div>`;

        document.body.appendChild(popup);

        // הסר אוטומטית אחרי 2 דקות
        setTimeout(() => {
            if (popup.parentNode) popup.remove();
        }, 120000);
    }

    // *** פונקציה חדשה: ניווט לפעילות ומשימה מתוך התזכורת ***
    async navigateToAlarmTask(activityId, taskId, popupElement) {
        // סגור את הפופאפ
        if (popupElement) popupElement.remove();

        // אם הפעילות כבר נבחרת - רק פתח את פופאפ המשימה
        if (this.currentActivityId === activityId) {
            await this.openTaskViewPopup(taskId);
            this.scrollToTask(taskId);
            return;
        }

        // בחר את הפעילות (טוען את המשימות שלה)
        await this.selectActivity(activityId);

        // המתן שהמשימות יטענו ואז פתח את הפופאפ
        setTimeout(async () => {
            await this.openTaskViewPopup(taskId);
            this.scrollToTask(taskId);
        }, 500);
    }

    // *** פונקציה חדשה: גלילה למשימה ספציפית והדגשתה ***
    scrollToTask(taskId) {
        const taskElement = document.querySelector(
            `.task-item[data-task-id="${taskId}"]`
        );
        if (!taskElement) return;

        // גלול למשימה
        taskElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // הדגש את המשימה לרגע
        taskElement.classList.add('task-highlight-pulse');
        setTimeout(() => {
            taskElement.classList.remove('task-highlight-pulse');
        }, 3000);
    }

    async toggleTaskAlarm(taskId) {
        try {
            const taskResponse = await fetch(
                `/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`
            );
            const taskResult = await taskResponse.json();
            if (!taskResult.success || !taskResult.task) return;

            const task = taskResult.task;
            const newAlarm = !task.hasAlarm;

            const response = await fetch('/Activities/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: taskId,
                    activityId: this.currentActivityId,
                    title: task.title,
                    description: task.description || '',
                    priority: task.priority || 'medium',
                    taskDate: task.taskDate || '',
                    taskHour: task.taskHour || '',
                    taskMinute: task.taskMinute || '',
                    responsiblePerson: task.responsiblePerson || '',
                    secondaryResponsible: task.secondaryResponsible || '',
                    notes: task.notes || '',
                    status: task.status || 'חדש',
                    hasAlarm: newAlarm
                })
            });

            const result = await response.json();
            if (result.success) {
                await this.loadActivityTasks(this.currentActivityId, this.currentDate);
                NotificationManager.show(
                    newAlarm ? 'תזכורת הוגדרה!' : 'תזכורת בוטלה',
                    newAlarm ? 'success' : 'info'
                );
            }
        } catch (error) {
            console.error('Error toggling alarm:', error);
            NotificationManager.show('שגיאה בעדכון התזכורת', 'error');
        }
    }

    // Date handling
    handleDateChange(isoDate) {
        if (isoDate) {
            this.currentDate = isoDate;
            const date = new Date(isoDate);
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            const formattedDate = `${day}/${month}/${year}`;

            document.getElementById('activityDate').value = formattedDate;

            if (this.currentActivityId) {
                this.loadActivityTasks(this.currentActivityId, this.currentDate);
            }
        }
    }

    // Open date picker for activity date
    openActivityDatePicker() {
        if (this.activityDatePicker) {
            this.activityDatePicker.open();
        }
    }

    // Handle activity date change
    handleActivityDateChange(value) {
        if (value) {
            const formattedDate = FlatpickrHelper.formatDateToDisplay(value);
            document.getElementById('activityDateInput').value = formattedDate;
        }
    }

    // הוסף פונקציה לאתחול כל בוררי התאריכים
    initializeDatePickers() {
        // אתחול בורר תאריך פעילות
        this.activityDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#activityDateInputHidden",
            (selectedDates, dateStr) => {
                this.handleActivityDateChange(dateStr);
            }
        );

        // אתחול בורר תאריך משימה
        this.taskDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#activityTaskDateHidden",
            (selectedDates, dateStr) => {
                this.handleTaskDateChange(dateStr);
            }
        );

        // הוסף אירועי לחיצה לשדות התאריך הנראים
        document.getElementById('activityDateInput')?.addEventListener('click', () => {
            this.activityDatePicker.open();
        });

        document.getElementById('activityTaskDate')?.addEventListener('click', () => {
            this.taskDatePicker.open();
        });
    }

    // הוסף פונקציה לעדכון כפתור ניקוי שעה
    updateTaskTimeClearButton() {
        const hourInput = document.getElementById('activityTaskHour');
        const minuteInput = document.getElementById('activityTaskMinute');
        const clearBtn = document.querySelector('.time-clear-btn');

        if (!clearBtn) return;

        // הצג כפתור רק אם יש ערך בשעה או בדקות
        if (hourInput?.value || minuteInput?.value) {
            clearBtn.style.display = 'inline-block';
        } else {
            clearBtn.style.display = 'none';
        }
    }

    // הוסף פונקציה לניקוי שדות השעה
    clearTaskTimeSelection() {
        document.getElementById('activityTaskHour').value = '';
        document.getElementById('activityTaskMinute').value = '';
        this.updateTaskTimeClearButton();
    }

    handleSkipReasonChange() {
        const select = document.getElementById('activitySkipReasonSelect');
        const customGroup = document.getElementById('activityCustomReasonGroup');

        if (select.value === 'אחר') {
            customGroup.style.display = 'block';
            document.getElementById('activitySkipReasonCustom').required = true;
        } else {
            customGroup.style.display = 'none';
            document.getElementById('activitySkipReasonCustom').required = false;
            document.getElementById('activitySkipReasonCustom').value = '';
        }
    }

    // Add sort controls to the UI
    addSortControls() {
        const container = document.querySelector('.task-controls-row');
        if (!container) return;
        // בדוק אם כבר קיימים פקדי מיון
        if (container.querySelector('.sort-options')) return;

        const sortOptions = document.createElement('div');
        sortOptions.className = 'sort-options';
        sortOptions.innerHTML = `
            <label for="activityTasksSort">
                <i class="fas fa-sort"></i> מיון:
            </label>
            <select id="activityTasksSort" 
                    onchange="activityManager.changeSortMode(this.value)">
                <option value="timeGrouped">📅 לפי תאריך</option>
                <option value="status">🔖 לפי סטטוס</option>
                <option value="responsible">👤 לפי אחראי</option>
                <option value="priority">🚨 לפי עדיפות</option>
                <option value="selfOrder">✋ סידור חופשי</option>
            </select>
            <button class="filter-toggle-btn" id="filterToggleBtn"
                    onclick="activityManager.toggleFiltersBar()"
                    title="סינון">
                <i class="fas fa-filter"></i>
            </button>`;

        container.appendChild(sortOptions);
    }

    // Change sort mode
    changeSortMode(sortMode) {
        this.currentSort = sortMode;
        this.sortMode    = sortMode === 'selfOrder' ? 'manual' : 'auto';

        // הסתר כפתורים אם לא timeGrouped
        this._updateDateGroupControls(sortMode === 'timeGrouped');

        const messages = {
            'timeGrouped': 'ממוין לפי שעה',
            'status':      'ממוין לפי סטטוס',
            'responsible': 'ממוין לפי אחראי',
            'priority':    'ממוין לפי עדיפות',
            'selfOrder':   'סידור חופשי - גרור להזזה'
        };

        NotificationManager.show(messages[sortMode] || '', 'info');

        if (this.currentActivityId) {
            this.loadActivityTasks(this.currentActivityId, this.currentDate);
        }
    }

    sortTasksByDateAndTime(tasks) {
        return [...tasks].sort((a, b) => {
            // מיין קודם לפי תאריך
            const dateA = a.taskDate || '9999-99-99';
            const dateB = b.taskDate || '9999-99-99';
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            // אז לפי שעה
            const timeA = (parseInt(a.taskHour || 99) * 60) + 
                        parseInt(a.taskMinute || 0);
            const timeB = (parseInt(b.taskHour || 99) * 60) + 
                        parseInt(b.taskMinute || 0);
            return timeA - timeB;
        });
    }

    sortTasksByStatus(tasks) {
        const statusOrder = {
            'בביצוע': 0, 'ממתין': 1, 'חדש': 2, 
            'בוצע': 3, 'מבוטלת': 4
        };
        return [...tasks].sort((a, b) => {
            const oA = statusOrder[a.status] ?? 9;
            const oB = statusOrder[b.status] ?? 9;
            return oA - oB;
        });
    }

    sortTasksByResponsible(tasks) {
        return [...tasks].sort((a, b) => {
            const rA = (a.responsiblePerson || 'תתת').toLowerCase();
            const rB = (b.responsiblePerson || 'תתת').toLowerCase();
            return rA.localeCompare(rB, 'he');
        });
    }

    sortTasksByPriority(tasks) {
        const priorityOrder = { 'high': 0, 'medium': 1, 'low': 2 };
        return [...tasks].sort((a, b) => {
            const pA = priorityOrder[a.priority] ?? 1;
            const pB = priorityOrder[b.priority] ?? 1;
            return pA - pB;
        });
    }

    filterTasks(tasks) {
        const statusFilter      = document.getElementById('taskStatusFilter')?.value      || '';
        const responsibleFilter = document.getElementById('taskResponsibleFilter')?.value || '';
        const systemFilter      = document.getElementById('taskSystemFilter')?.value      || '';
        const environmentFilter = document.getElementById('taskEnvironmentFilter')?.value || '';
        const dependencyFilter  = document.getElementById('taskDependencyFilter')?.value  || '';
        const disruptionFilter  = document.getElementById('taskDisruptionFilter')?.value  || '';
        const impactFilter      = document.getElementById('taskImpactFilter')?.value      || '';

        return tasks.filter(task => {
            const matchStatus = !statusFilter ||
                task.status === statusFilter;

            const matchResponsible = !responsibleFilter ||
                task.responsiblePerson === responsibleFilter ||
                task.secondaryResponsible === responsibleFilter;

            const matchSystem = !systemFilter ||
                task.systemName === systemFilter;

            const matchEnvironment = !environmentFilter ||
                task.environment === environmentFilter;

            const matchDependency = !dependencyFilter ||
                task.dependency === dependencyFilter;

            const matchDisruption = !disruptionFilter ||
                task.disruptionDuration === disruptionFilter;

            const matchImpact = !impactFilter ||
                task.impact === impactFilter;

            return matchStatus      &&
                matchResponsible &&
                matchSystem      &&
                matchEnvironment &&
                matchDependency  &&
                matchDisruption  &&
                matchImpact;
        });
    }

    // Open templates modal and load templates list
    async openTemplatesModal() {
        this.isModalOpen = true;
        document.getElementById('activityTemplatesModal').style.display = 'block';
        document.body.style.overflow = 'hidden';

        // Load templates when modal opens
        await this.loadTemplates();
    }

    // Close templates modal
    closeTemplatesModal() {
        this.isModalOpen = false;
        document.getElementById('activityTemplatesModal').style.display = 'none';
        document.body.style.overflow = 'auto';
    }

    // Load templates from server
    async loadTemplates() {
        const listContainer = document.getElementById('templatesList');
        if (!listContainer) return;

        // Show loading state
        listContainer.innerHTML = `
        <div class="templates-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>טוען טמפלייטים...</span>
        </div>
    `;

        try {
            const response = await fetch('/Activities/GetActivityTemplates');
            const result = await response.json();

            if (!result.success) {
                listContainer.innerHTML = `
                <div class="templates-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>${result.error || 'שגיאה בטעינת הטמפלייטים'}</span>
                </div>
            `;
                return;
            }

            const templates = result.templates;

            if (!templates || templates.length === 0) {
                listContainer.innerHTML = `
                <div class="templates-empty">
                    <i class="fas fa-folder-open"></i>
                    <p>לא נמצאו טמפלייטים זמינים.</p>
                    <small>העלה טמפלייט ראשון באמצעות הכפתור למעלה</small>
                </div>
            `;
                return;
            }

            // *** כפתור מחיקה לכל שורה ***
            listContainer.innerHTML = templates.map(template => `
            <div class="template-item" id="template-${template.fileName.replace(/\./g, '-')}">
                <div class="template-info">
                    <i class="fas fa-file-excel template-icon"></i>
                    <div class="template-details">
                        <span class="template-name">${template.displayName}</span>
                        <span class="template-meta">
                            ${this.formatFileSize(template.fileSize)} · 
                            עודכן: ${template.lastModified}
                        </span>
                    </div>
                </div>
                <div class="template-actions">
                    <button class="template-download-btn" 
                            onclick="activityManager.downloadTemplate('${template.fileName}')"
                            title="הורד טמפלייט">
                        <i class="fas fa-download"></i>
                        הורד
                    </button>
                    ${this.isUserAdmin() ? `
                    <button class="template-delete-btn" 
                            onclick="activityManager.deleteTemplate('${template.fileName}')"
                            title="מחק טמפלייט">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        `).join('');

        } catch (error) {
            console.error('Error loading templates:', error);
            listContainer.innerHTML = `
            <div class="templates-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>שגיאה בחיבור לשרת</span>
            </div>
        `;
        }
    }

    // Download a specific template
    downloadTemplate(fileName) {
        // Trigger file download via direct link
        const downloadUrl = `/Activities/DownloadTemplate?fileName=${encodeURIComponent(fileName)}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        NotificationManager.show(`מוריד: ${fileName}`, 'info');
    }

    // פתיחת בורר קבצים להעלאת טמפלייט
    openUploadTemplateDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.style.display = 'none';

        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadTemplate(file);
            }
            document.body.removeChild(input);
        });

        document.body.appendChild(input);
        input.click();
    }

    // העלאת טמפלייט לשרת
    async uploadTemplate(file) {
        // ולידציה
        if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
            NotificationManager.show(
                'יש לבחור קובץ אקסל בלבד (.xlsx או .xls)',
                'warning'
            );
            return;
        }

        // הצג אינדיקטור טעינה
        const uploadBtn = document.getElementById('uploadTemplateBtn');
        if (uploadBtn) {
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מעלה...';
        }

        // הצג שורת התקדמות
        this.showTemplateUploadProgress(file.name);

        try {
            const formData = new FormData();
            formData.append('templateFile', file);

            const response = await fetch('/Activities/UploadTemplate', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(
                    `הטמפלייט "${file.name}" הועלה בהצלחה!`,
                    'success'
                );
                // רענן את רשימת הטמפלייטים
                await this.loadTemplates();
            } else {
                NotificationManager.show(
                    result.error || 'שגיאה בהעלאת הטמפלייט',
                    'error'
                );
            }
        } catch (error) {
            console.error('Error uploading template:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        } finally {
            // החזר כפתור למצב רגיל
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.innerHTML =
                    '<i class="fas fa-upload"></i> העלה טמפלייט';
            }
            this.hideTemplateUploadProgress();
        }
    }

    // הצג שורת התקדמות העלאה
    showTemplateUploadProgress(fileName) {
        const container = document.getElementById('templateUploadProgress');
        if (!container) return;

        container.style.display = 'flex';
        container.innerHTML = `
        <div class="template-upload-progress-inner">
            <i class="fas fa-spinner fa-spin"></i>
            <span>מעלה: <strong>${fileName}</strong></span>
        </div>
    `;
    }

    // הסתר שורת התקדמות
    hideTemplateUploadProgress() {
        const container = document.getElementById('templateUploadProgress');
        if (container) {
            container.style.display = 'none';
            container.innerHTML = '';
        }
    }

    // מחיקת טמפלייט
    async deleteTemplate(fileName) {
        if (!confirm(`האם למחוק את הטמפלייט "${fileName}"?`)) return;

        try {
            const response = await fetch(
                `/Activities/DeleteTemplate?fileName=${encodeURIComponent(fileName)}`,
                { method: 'DELETE' }
            );

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(
                    `הטמפלייט "${fileName}" נמחק בהצלחה`,
                    'success'
                );
                await this.loadTemplates();
            } else {
                NotificationManager.show(
                    result.error || 'שגיאה במחיקת הטמפלייט',
                    'error'
                );
            }
        } catch (error) {
            console.error('Error deleting template:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Format file size to human-readable string
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // Auto refresh data
    startAutoRefresh() {
        // נקה interval קיים אם יש
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        // הגדר interval חדש
        this.refreshInterval = setInterval(async () => {
            // רק אם אין מודל פתוח
            if (!this.isModalOpen) {
                // שמור את הפעילות הנוכחית לפני הטעינה מחדש
                const currentActivityId = this.currentActivityId;

                // שמור את מצב החיפוש הנוכחי
                const searchInput = document.getElementById('activitySearchInput');
                const currentSearchTerm = searchInput ? searchInput.value.trim() : '';

                await this.loadActivities();
                // Check for expired activities to archive
                await this.autoArchiveExpiredActivities();

                // החל מחדש את החיפוש אם היה פעיל
                if (currentSearchTerm) {
                    this.searchActivities(currentSearchTerm);
                } else {
                    this.renderActivityTabs();
                }

                // אם הייתה פעילות נבחרת, טען אותה מחדש
                if (currentActivityId) {
                    // בדוק אם הפעילות עדיין קיימת
                    const activityExists = this.activities.some(a => a.id === currentActivityId);
                    if (activityExists) {
                        await this.loadActivityTasks(currentActivityId, this.currentDate);
                    }
                }
            }
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000); // המרה לאלפיות שניה
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// Global instance
let activityManager;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    // אם ActivitiesDashboard כבר יצר instance - אל תיצור שוב
    if (!window.activityManager) {
        activityManager = new ActivityManager();
        activityManager.initialize();
    }
});

