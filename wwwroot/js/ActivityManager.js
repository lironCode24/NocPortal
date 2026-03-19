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

        this.sortMode = 'auto';
        this.currentSort = 'time';
        this.originalTasksOrder = [];
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
        return localStorage.getItem('lastSelectedEmployee') || '';
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
        // Load employees first
        await this.loadEmployees();

        // אתחל את בוררי התאריכים
        this.initializeDatePickers();

        // הוסף פקדי מיון
        this.addSortControls();

        document.querySelector('.task-controls-row').style.display = 'none';
        await this.loadActivities();
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
        this.startAutoRefresh();
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

            const sortOrder = document.getElementById('activitySortOrder').value;
            this.sortActivities(sortOrder);
        } catch (error) {
            console.error('Error fetching activities:', error);
            this.activities = [];
        }
    }

    // Display empty state
    displayEmptyState() {

        document.querySelector('.task-controls-row').style.display = 'none';

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

    // סנן את המשימות לפי מונח החיפוש
    searchTasks(searchTerm) {
        if (!this.currentActivityId) {
            return;
        }

        // הצג/הסתר את כפתור הניקוי בהתאם לתוכן החיפוש
        const clearBtn = document.querySelector('.task-search .clear-search-btn');
        if (clearBtn) {
            clearBtn.style.display = searchTerm ? 'flex' : 'none';
        }

        // אם אין מונח חיפוש, טען מחדש את כל המשימות
        if (!searchTerm || searchTerm.trim() === '') {
            this.loadActivityTasks(this.currentActivityId, this.currentDate);
            return;
        }

        searchTerm = searchTerm.trim().toLowerCase();

        // טען את כל המשימות ואז סנן אותן בצד הלקוח
        fetch(`/Activities/GetActivityTasks?activityId=${this.currentActivityId}&date=${this.currentDate}`)
            .then(response => response.json())
            .then(tasks => {
                if (Array.isArray(tasks)) {
                    // סנן את המשימות לפי מונח החיפוש
                    const filteredTasks = tasks.filter(task => {
                        const title = task.title.toLowerCase();
                        const description = task.description ? task.description.toLowerCase() : '';
                        const responsible = task.responsiblePerson ? task.responsiblePerson.toLowerCase() : '';

                        return title.includes(searchTerm) ||
                            description.includes(searchTerm) ||
                            responsible.includes(searchTerm);
                    });

                    // הצג את המשימות המסוננות
                    this.renderActivityTasks(filteredTasks);

                    // הוסף הודעה אם אין תוצאות
                    const container = document.getElementById('activityTasksContainer');
                    if (filteredTasks.length === 0 && container) {
                        container.innerHTML = `
                        <div class="tasks-empty search-no-results">
                            <i class="fas fa-search"></i><br>
                            לא נמצאו משימות התואמות לחיפוש "${searchTerm}"
                        </div>
                    `;
                    }
                }
            })
            .catch(error => {
                console.error('Error searching tasks:', error);
            });
    }

    // הוסף פונקציה לארכוב פעילות
    async archiveActivity(activityId) {
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        const newStatus = !activity.archived;
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
            NotificationManager.show('יש לבחור קובץ אקסל', 'warning');
            return;
        }

        const file = fileInput.files[0];
        if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
            NotificationManager.show('יש לבחור קובץ אקסל בלבד (.xlsx או .xls)', 'warning');
            return;
        }

        // הצג אינדיקטור טעינה
        const submitBtn = document.getElementById('excelImportSubmitBtn');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מייבא...';

        try {
            const formData = new FormData();
            formData.append('excelFile', file);
            // הוסף את תאריך הפעילות לבקשה
            const activityDateInput = document.getElementById('excelImportDateHidden');
            if (activityDateInput && activityDateInput.value) {
                formData.append('activityDate', activityDateInput.value);
            }

            const response = await fetch('/Activities/ImportFromExcel', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(`הקובץ יובא בהצלחה! נוספה פעילות: ${result.activityName}`, 'success');
                this.closeImportExcelModal();

                // רענן את רשימת הפעילויות
                await this.loadActivities();
                this.renderActivityTabs();

                // בחר את הפעילות החדשה
                if (result.activityId) {
                    this.selectActivity(result.activityId);
                }
            } else {
                NotificationManager.show(result.error || 'שגיאה בייבוא הקובץ', 'error');
            }
        } catch (error) {
            console.error('Error importing Excel file:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        } finally {
            // החזר את הכפתור למצב הרגיל
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
        }
    }

    // טיפול בבחירת קובץ
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // בדוק אם הקובץ הוא אקסל
        if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
            NotificationManager.show('יש לבחור קובץ אקסל בלבד (.xlsx או .xls)', 'warning');
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
                    <input type="checkbox" id="showArchivedActivities" onchange="activityManager.filterActivitiesByArchiveStatus()">
                    <label for="showArchivedActivities">הצג פעילויות בארכיון</label>
                </div>
                <div class="sort-options">
                    <select id="activitySortOrder" onchange="activityManager.sortActivities(this.value)">
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
            const tabsHTML = this.activities.map(activity => `
            <div class="activity-tab ${activity.id === this.currentActivityId ? 'active' : ''} ${activity.archived ? 'archived' : ''}" 
                data-activity-id="${activity.id}"
                draggable="true"
                onclick="activityManager.selectActivity('${activity.id}')">
                <div class="activity-tab-content">
                    <span class="activity-tab-name">${activity.name.length > 20 ? activity.name.substring(0, 20) + '...' : activity.name}</span>
                    ${activity.activityDate ? `<span class="activity-tab-date"><i class="fas fa-calendar-alt"></i> ${this.formatDate(activity.activityDate)}</span>` : ''}
                </div>
                <div class="activity-tab-actions">
                    <button class="activity-tab-action" onclick="event.stopPropagation(); activityManager.editActivity('${activity.id}')" title="ערוך פרטי פעילות">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="activity-tab-action" onclick="event.stopPropagation(); activityManager.duplicateActivity('${activity.id}')" title="שכפל">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button class="activity-tab-action archive" onclick="event.stopPropagation(); activityManager.archiveActivity('${activity.id}')" title="${activity.archived ? 'הוצא מארכיון' : 'העבר לארכיון'}">
                        <i class="fas fa-${activity.archived ? 'box-open' : 'archive'}"></i>
                    </button>
                    <button class="activity-tab-action delete" onclick="event.stopPropagation(); activityManager.deleteActivity('${activity.id}')" title="מחק">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                ${activity.archived ? '<span class="archived-badge">ארכיון</span>' : ''}
            </div>
        `).join('');

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

        const searchTask = document.querySelector('.task-search-container');
        if (searchTask) {
            searchTask.style.display = 'flex';
        }

        this.currentActivityId = activityId;

        // Get the selected activity
        const activity = this.activities.find(a => a.id === activityId);
        if (!activity) return;

        const nameDisplay = document.getElementById('activityNameDisplay');
        if (nameDisplay) {
            nameDisplay.textContent = activity.name;
        }

        // Update the date display with activity date
        const dateDisplay = document.getElementById('activityDateDisplay');
        if (dateDisplay) {
            if (activity && activity.activityDate) {
                this.currentDate = activity.activityDate;
                const formattedDate = this.formatDate(activity.activityDate);
                dateDisplay.textContent = formattedDate;
            } else {
                // If no activity date, show current date
                this.currentDate = new Date().toISOString().split('T')[0];
                dateDisplay.textContent = this.formatDate(this.currentDate);
            }
        }

        document.querySelector('.task-controls-row').style.display = 'block';

        this.renderActivityTabs();
        await this.loadActivityTasks(activityId, this.currentDate);
    }

    // Load tasks for activity
    async loadActivityTasks(activityId, date) {
        try {
            const response = await fetch(`/Activities/GetActivityTasks?activityId=${activityId}&date=${date}`);
            const data = await response.json();

            if (data.error) {
                console.error('Error loading tasks:', data.error);
                this.renderActivityTasks([]);
            } else {
                // שמור את הסדר המקורי
                this.originalTasksOrder = [...data];

                let tasksToRender = [...data];


                // שמור את מצב החיפוש הנוכחי
                const searchInput = document.getElementById('activitySearchInput');
                const currentSearchTerm = searchInput ? searchInput.value.trim() : '';
                this.searchActivities(currentSearchTerm);

                // החל את המיון הנוכחי
                if (this.currentSort === 'time') {
                    tasksToRender = this.sortTasksByTime(tasksToRender);
                } else if (this.currentSort === 'selfOrder') {
                    // שמור על הסדר המקורי
                }

                this.renderActivityTasks(tasksToRender);
            }
        } catch (error) {
            console.error('Error fetching tasks:', error);
            this.renderActivityTasks([]);
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

        // Get the task data
        try {
            const response = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const result = await response.json();

            if (!result.success || !result.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const task = result.task;

            document.getElementById('activityCompletionTaskId').value = taskId;
            document.getElementById('activityCompletionTaskTitle').textContent = task.title;

            // Pre-fill executor name with responsible person if available
            let defaultExecutor = '';
            if (task.responsiblePerson) {
                defaultExecutor = task.responsiblePerson;
            }
            if (task.secondaryResponsible) {
                defaultExecutor = defaultExecutor ? `${defaultExecutor}, ${task.secondaryResponsible}` : task.secondaryResponsible;
            }
            document.getElementById('activityCompletionExecutorName').value = defaultExecutor;

            // Populate employee dropdown
            await this.populateEmployeeSelect('activityCompletionEmployeeName');

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

    // Save last selected employee to localStorage
    saveLastSelectedEmployee(employeeName) {
        if (employeeName && employeeName !== '') {
            localStorage.setItem('lastSelectedEmployee', employeeName);
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
         ${isDraggable ? `
         ondragstart="activityManager.handleTaskDragStart(event)"
         ondragover="activityManager.handleTaskDragOver(event)"
         ondrop="activityManager.handleTaskDrop(event)"
         ondragend="activityManager.handleTaskDragEnd(event)"
         ` : ''}>
        
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
            ${!isCompleted && !skipReason ? `
                <button class="task-action-btn skip" onclick="activityManager.openSkipModal('${task.id}')">
                    <i class="fas fa-ban"></i>
                </button>
            ` : ''}
            ${skipReason ?
                `<button class="task-action-btn clear-skip" onclick="activityManager.clearSkipReason('${task.id}')" title="בטל סיבת אי ביצוע">
                <i class="fas fa-undo"></i>
            </button>` : ''}
            <button class="task-action-btn edit" onclick="activityManager.editTask('${task.id}')">
                <i class="fas fa-edit"></i>
            </button>
            <button class="task-action-btn delete" onclick="activityManager.deleteTask('${task.id}')">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    </div>
`;
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
        document.getElementById('activitySubmitBtn').textContent = 'צור פעילות';
        document.getElementById('activityForm').reset();
        document.getElementById('activityId').value = '';
        document.getElementById('addActivityModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeAddActivityModal() {
        this.isModalOpen = false;
        document.getElementById('addActivityModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('activityForm').reset();
        document.getElementById('activityDateInput').value = '';
        document.getElementById('activityDateInputHidden').value = '';
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

        document.getElementById('activityModalTitle').textContent = 'ערוך פעילות';
        document.getElementById('activitySubmitBtn').textContent = 'עדכן פעילות';
        document.getElementById('activityId').value = activity.id;
        document.getElementById('activityName').value = activity.name;
        document.getElementById('activityDescription').value = activity.description || '';

        // Set both hidden and visible date fields
        if (activity.activityDate) {
            document.getElementById('activityDateInputHidden').value = activity.activityDate;
            document.getElementById('activityDateInput').value = this.formatDate(activity.activityDate);
        } else {
            document.getElementById('activityDateInputHidden').value = '';
            document.getElementById('activityDateInput').value = '';
        }

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

    // Toggle task completion
    async toggleTask(taskId) {
        try {
            // First, get the current task data to preserve all fields
            const taskResponse = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const taskResult = await taskResponse.json();

            if (!taskResult.success || !taskResult.task) {
                NotificationManager.show('שגיאה בטעינת נתוני המשימה', 'error');
                return;
            }

            const task = taskResult.task;

            // Check if task is currently skipped
            const isSkipped = task.skipReasons && task.skipReasons[this.currentDate];

            // If task is skipped, clear the skip reason instead of marking as completed
            if (isSkipped) {
                await this.clearSkipReason(taskId);
                return;
            }

            // Check if task is already completed
            const isCompleted = task.completionDates && task.completionDates.includes(this.currentDate);

            if (isCompleted) {
                // If already completed, toggle it off
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
                // If not completed, open the employee selection modal
                await this.openEmployeeCompletionModal(taskId);
            }
        } catch (error) {
            console.error('Error toggling task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    async updateTaskStatus(taskId, newStatus, showNotification = true) {
        try {
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
                    // Clear skip by updating task without skip data
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
                            clearSkipForDate: this.currentDate  // Signal to clear skip
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
                            skipUserName: 'מערכת',
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
                    // Remove completion by toggling
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
                    // Clear skip by updating task
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
                            clearSkipForDate: this.currentDate  // Signal to clear skip
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
        this.isModalOpen = true;
        if (!this.currentActivityId) {
            NotificationManager.show('יש לבחור פעילות תחילה', 'warning');
            return;
        }

        document.getElementById('activityTaskModalTitle').textContent = 'הוסף משימה לפעילות';
        document.getElementById('activityTaskSubmitBtn').textContent = 'הוסף משימה';
        document.getElementById('activityTaskForm').reset();
        document.getElementById('activityTaskId').value = '';

        // אפס את שדות התאריך
        document.getElementById('activityTaskDateHidden').value = '';
        document.getElementById('activityTaskDate').value = '';

        // אתחל את מאזיני השעה
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
        document.getElementById('activityTaskDateHidden').value = '';
        document.getElementById('activityTaskDate').value = '';
    }

    async saveTask(taskData, isEditing = false) {
        try {
            taskData.activityId = this.currentActivityId;

            // טיפול בתאריך
            const taskDateHidden = document.getElementById('activityTaskDateHidden');
            if (taskDateHidden && taskDateHidden.value) {
                taskData.taskDate = taskDateHidden.value;
            }

            // טיפול בשעת ביצוע - הוסף שדות שעה ודקה
            const taskHour = document.getElementById('activityTaskHour')?.value || '';
            const taskMinute = document.getElementById('activityTaskMinute')?.value || '';
            taskData.taskHour = taskHour;
            taskData.taskMinute = taskMinute;

            const url = isEditing ? '/Activities/UpdateTask' : '/Activities/AddTask';
            const method = isEditing ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
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

    // Edit task
    async editTask(taskId) {
        try {
            const response = await fetch(`/Activities/GetTask?taskId=${taskId}&activityId=${this.currentActivityId}`);
            const result = await response.json();

            if (result.success && result.task) {
                const task = result.task;

                document.getElementById('activityTaskModalTitle').textContent = 'ערוך משימה';
                document.getElementById('activityTaskSubmitBtn').textContent = 'עדכן משימה';
                document.getElementById('activityTaskId').value = task.id;
                document.getElementById('activityTaskTitle').value = task.title;
                document.getElementById('activityTaskDescription').value = task.description || '';
                document.getElementById('activityTaskPriority').value = task.priority;

                if (task.taskDate) {
                    document.getElementById('activityTaskDateHidden').value = task.taskDate;
                    document.getElementById('activityTaskDate').value = this.formatDate(task.taskDate);
                }

                // מילוי שדות שעה ודקה
                document.getElementById('activityTaskHour').value = task.taskHour || '';
                document.getElementById('activityTaskMinute').value = task.taskMinute || '';

                document.getElementById('activityTaskResponsible').value = task.responsiblePerson || '';
                document.getElementById('activityTaskSecondary').value = task.secondaryResponsible || '';
                document.getElementById('activityTaskStatus').value = task.status || 'חדש';
                document.getElementById('activityTaskNotes').value = task.notes || '';

                // עדכון כפתור ניקוי שעה
                this.updateTaskTimeClearButton();

                document.getElementById('addActivityTaskModal').style.display = 'block';
                document.body.style.overflow = 'hidden';
            } else {
                NotificationManager.show('משימה לא נמצאה', 'error');
            }
        } catch (error) {
            console.error('Error loading task:', error);
            NotificationManager.show('שגיאה בטעינת המשימה', 'error');
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
        this.isModalOpen = true;
        document.getElementById('activitySkipTaskId').value = taskId;
        document.getElementById('activitySkipReasonSelect').value = '';
        document.getElementById('activitySkipReasonCustom').value = '';

        // Populate employee dropdown
        await this.populateEmployeeSelect('activitySkipUserName');

        document.getElementById('activityCustomReasonGroup').style.display = 'none';
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
            localStorage.setItem('lastSelectedEmployee', employeeName);
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

        const container = document.querySelector('.activity-filters');
        if (!container) return;

        // בדוק אם כבר קיימים פקדי מיון
        if (container.querySelector('.sort-options')) return;

        const sortOptions = document.createElement('div');
        sortOptions.className = 'sort-options';
        sortOptions.innerHTML = `
        <label for="activityTasksSort">מיון משימות:</label>
        <select id="activityTasksSort" onchange="activityManager.changeSortMode(this.value)">
            <option value="time">לפי שעה</option>
            <option value="selfOrder">סידור חופשי</option>
        </select>
    `;

        container.appendChild(sortOptions);
    }

    // Change sort mode
    changeSortMode(sortMode) {
        this.currentSort = sortMode;

        if (sortMode === 'time') {
            this.sortMode = 'auto';
            // עדכן את הממשק המשתמש
            document.querySelectorAll('.task-item').forEach(item => {
                item.setAttribute('draggable', 'false');
                const dragHandle = item.querySelector('.drag-handle');
                if (dragHandle) dragHandle.style.display = 'none';
            });

            NotificationManager.show('המשימות ממוינות לפי שעה', 'info');
        } else if (sortMode === 'selfOrder') {
            this.sortMode = 'manual';
            // עדכן את הממשק המשתמש רק אם התאריך אינו בעבר
            if (!this.isDateInPast(this.currentDate)) {
                document.querySelectorAll('.task-item').forEach(item => {
                    item.setAttribute('draggable', 'true');
                    const dragHandle = item.querySelector('.drag-handle');
                    if (dragHandle) dragHandle.style.display = 'flex';
                });

                NotificationManager.show('ניתן לגרור משימות לסידור חופשי', 'info');
            } else {
                NotificationManager.show('לא ניתן לסדר משימות בתאריך שעבר', 'warning');
            }
        }

        // טען מחדש את המשימות עם המיון החדש
        if (this.currentActivityId) {
            this.loadActivityTasks(this.currentActivityId, this.currentDate);
        }
    }

    // Sort tasks by scheduled time
    sortTasksByTime(tasks) {
        if (!tasks || !Array.isArray(tasks)) return tasks;

        return tasks.sort((a, b) => {
            // Tasks with time come before tasks without time
            const aHasTime = a.taskHour && a.taskMinute;
            const bHasTime = b.taskHour && b.taskMinute;

            if (aHasTime && !bHasTime) return -1;
            if (!aHasTime && bHasTime) return 1;
            if (!aHasTime && !bHasTime) return 0;

            // Convert to minutes from 07:00 (not 00:00)
            const aHour = parseInt(a.taskHour);
            const bHour = parseInt(b.taskHour);

            // Adjust hours: treat 00:00-06:59 as end of day (after 23:59)
            const aAdjustedHour = aHour < 7 ? aHour + 24 : aHour;
            const bAdjustedHour = bHour < 7 ? bHour + 24 : bHour;

            const aTime = aAdjustedHour * 60 + parseInt(a.taskMinute);
            const bTime = bAdjustedHour * 60 + parseInt(b.taskMinute);

            return aTime - bTime;
        });
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
    activityManager = new ActivityManager();
    activityManager.initialize();
});

