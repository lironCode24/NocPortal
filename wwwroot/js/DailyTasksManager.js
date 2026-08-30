class DailyTasksManager {
    constructor() {
        this.dailyTasks = [];
        this.filteredTasks = []; // For filtered tasks
        this.originalTasksOrder = [];
        this.currentTaskDate = '';
        this.draggedElement = null;
        this.draggedTaskId = null;
        this.sortMode = 'auto';
        this.activeFilters = { // Track active filters
            status: '',
            priority: '',
            time: ''
        };
        this.currentSort = 'time';
        this.employees = [];
        this.flatpickrInstance = null;

        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;
        this.alarmCheckInterval = null;
        this.shownAlarms = new Set(); // למעקב אחרי התראות שכבר הוצגו
        this.setupPopupClickHandling();

        this.currentUser = null;
        this.loadCurrentUser();
    }

    async loadCurrentUser() {
        try {
            const cached = sessionStorage.getItem('currentUser');
            if (cached) {
                this.currentUser = JSON.parse(cached);
                return;
            }
            const response = await fetch('/Auth/Me', { credentials: 'include' });
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

    // ← הוסף פונקציה עזר:
    getCurrentUserName() {
        if (this.currentUser?.displayName) return this.currentUser.displayName;
        if (this.currentUser?.username) return this.currentUser.username;
        return this.getLastSelectedEmployee() || '';
    }

    // Load employees from server
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

    // Save last selected employee to localStorage
    saveLastSelectedEmployee(employeeName) {
        if (employeeName && employeeName !== '') {
            localStorage.setItem('lastSelectedEmployee', employeeName);
        }
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

    // Populate employee select dropdown
    populateEmployeeSelect(selectId, defaultValue = null) {
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = '<option value="">בחר עובד...</option>';

        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.name;
            option.textContent = employee.name;
            select.appendChild(option);
        });

        // ← קבע את הערך לפי סדר עדיפויות:
        // 1. defaultValue שהועבר (יוזר מחובר)
        // 2. lastSelectedEmployee מ-localStorage
        const valueToSet = defaultValue || this.getLastSelectedEmployee();

        if (valueToSet) {
            const optionExists = Array.from(select.options)
                .some(opt => opt.value === valueToSet);

            if (optionExists) {
                select.value = valueToSet;
            } else if (defaultValue) {
                // ← הוסף את היוזר המחובר אם לא קיים ברשימה
                const option = document.createElement('option');
                option.value = defaultValue;
                option.textContent = defaultValue;
                select.appendChild(option);
                select.value = defaultValue;
            }
        }
    }

    // Initialize time input listeners
    initializeTimeInputListeners() {
        const hourInput = document.getElementById('taskHour');
        const minuteInput = document.getElementById('taskMinute');

        if (hourInput) {
            // When hour is selected, auto-fill minutes with 00 if empty
            hourInput.addEventListener('change', () => {
                if (hourInput.value && !minuteInput.value) {
                    minuteInput.value = '00';
                }
                this.updateTimeClearButton();
                this.updateAlarmCheckboxVisibility();
            });

            // Update button on input (real-time)
            hourInput.addEventListener('input', () => {
                this.updateTimeClearButton();
                this.updateAlarmCheckboxVisibility();
            });
        }

        if (minuteInput) {
            // Update button when minute changes
            minuteInput.addEventListener('change', () => {
                this.updateTimeClearButton();
                this.updateAlarmCheckboxVisibility();
            });

            // Update button on input (real-time)
            minuteInput.addEventListener('input', () => {
                this.updateTimeClearButton();
                this.updateAlarmCheckboxVisibility();
            });
        }
        this.updateAlarmCheckboxVisibility();
    }

    // פונקציה להתחלת מעקב אחרי התראות
    startAlarmMonitoring() {
        // נקה מרווח קודם אם קיים
        if (this.alarmCheckInterval) {
            clearInterval(this.alarmCheckInterval);
        }

        // בדוק כל דקה
        this.alarmCheckInterval = setInterval(() => {
            this.checkPendingAlarms();
        }, 60000); // 60 שניות

        // בדיקה ראשונית מיידית
        this.checkPendingAlarms();
    }

    stopAlarmMonitoring() {
        if (this.alarmCheckInterval) {
            clearInterval(this.alarmCheckInterval);
            this.alarmCheckInterval = null;
        }
    }

    // פונקציה לבדיקת התראות ממתינות
    async checkPendingAlarms() {
        try {
            // קבל את התאריך והשעה הנוכחיים
            const now = new Date();
            const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
            const currentHour = now.getHours().toString().padStart(2, '0');
            const currentMinute = now.getMinutes().toString().padStart(2, '0');
            const currentTime = `${currentHour}:${currentMinute}`;

            // בדוק אם יש משימות עם שעת ביצוע בטווח של 10 דקות קדימה
            const response = await fetch(`/DailyTasks/GetPendingAlarms?date=${currentDate}&time=${currentTime}`);

            // בדוק אם התגובה תקינה
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status}`);
                return;
            }

            const result = await response.json();

            if (result.success && result.alarms && result.alarms.length > 0) {
                // הצג התראות
                result.alarms.forEach(alarm => {
                    // דלג על משימות שנמחקו
                    if (alarm.isDeleted) {
                        return;
                    }

                    const alarmKey = `${alarm.taskId}_${alarm.date}_${alarm.executionTime}`;

                    // הצג התראה רק אם לא הוצגה כבר
                    if (!this.shownAlarms.has(alarmKey)) {
                        // בדוק אם השעה הנוכחית קרובה לשעת ההתראה (בטווח של 10 דקות)
                        const [alarmHour, alarmMinute] = alarm.executionTime.split(':').map(Number);
                        const alarmTimeInMinutes = alarmHour * 60 + alarmMinute;
                        const currentTimeInMinutes = parseInt(currentHour) * 60 + parseInt(currentMinute);

                        // הצג התראה רק אם השעה הנוכחית קרובה לשעת ההתראה
                        // או אם השעה הנוכחית כבר עברה את שעת ההתראה (עד 5 דקות)
                        const timeDiff = currentTimeInMinutes - alarmTimeInMinutes;
                        if (timeDiff >= -10 && timeDiff <= 5) {
                            this.showAlarmNotification(alarm);
                            this.shownAlarms.add(alarmKey);

                            // הסר מהרשימה אחרי 10 דקות
                            setTimeout(() => {
                                this.shownAlarms.delete(alarmKey);
                            }, 600000); // 10 דקות
                        }
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
            <h3> <i class="fas fa-bell alarm-bell-icon"></i> הגיע זמן המשימה! ⏰</h3>
        </div>
        <div class="alarm-notification-body">
            <div class="alarm-message-title">
                <i class="fas fa-tasks"></i>
                <strong>${alarm.title}</strong>
            </div>
            <div class="alarm-execution-time">
                <i class="fas fa-clock"></i>
                שעת ביצוע: <strong>${alarm.executionTime}</strong>
            </div>
            ${alarm.description ? `
            <div class="alarm-description">
                <i class="fas fa-info-circle"></i>
                ${alarm.description}
            </div>
            ` : ''}
        </div>
        <div class="alarm-notification-footer">
            <button class="btn btn-primary" onclick="dailyTasksManager.openTaskFromAlarm('${alarm.taskId}'); this.closest('.alarm-notification-popup').remove();">
                <i class="fas fa-eye"></i> פתח משימה
            </button>
            <button class="btn btn-secondary" onclick="dailyTasksManager.snoozeAlarm('${alarm.taskId}', '${alarm.date}', '${alarm.executionTime}'); this.closest('.alarm-notification-popup').remove();">
                <i class="fas fa-clock"></i> דחה ל-5 דקות
            </button>
            <button class="btn btn btn-secondary btn-success" onclick="dailyTasksManager.markTaskAsCompletedFromAlarm('${alarm.taskId}'); this.closest('.alarm-notification-popup').remove();">
                <i class="fas fa-check"></i> סמן כבוצע
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

    // פונקציה לפתיחת משימה מהתראה
    openTaskFromAlarm(taskId) {
        // מצא את המשימה
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (task) {
            this.viewTask(taskId);
            NotificationManager.show('משימה נפתחה', 'info');
        } else {
            // אם המשימה לא נמצאת ברשימה הנוכחית, נסה לטעון אותה
            this.loadTaskById(taskId);
        }
    }

    // פונקציה חדשה לטעינת משימה לפי מזהה
    async loadTaskById(taskId) {
        try {
            const response = await fetch(`/DailyTasks/GetTaskById?id=${taskId}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.success && result.task) {
                // בדוק אם המשימה נמחקה
                if (result.task.isDeleted) {
                    NotificationManager.show('משימה זו נמחקה ואינה זמינה יותר', 'warning');
                    return;
                }

                // פתח את המשימה בצפייה
                this.viewTask(taskId);
                NotificationManager.show('משימה נפתחה', 'info');
            } else {
                NotificationManager.show('לא ניתן למצוא את המשימה', 'error');
            }
        } catch (error) {
            console.error('Error loading task by ID:', error);
            NotificationManager.show('שגיאה בטעינת המשימה', 'error');
        }
    }

    // פונקציה לדחיית התראה
    snoozeAlarm(taskId, date, executionTime) {
        const alarmKey = `${taskId}_${date}_${executionTime}`;
        this.shownAlarms.delete(alarmKey);

        // הגדר התראה חדשה ל-5 דקות
        setTimeout(() => {
            // יצירת התראה חדשה עם אותם פרטים
            const alarm = {
                taskId: taskId,
                date: date,
                executionTime: executionTime
            };
            this.showAlarmNotification(alarm);
        }, 300000); // 5 דקות

        NotificationManager.show('ההתראה נדחתה ל-5 דקות', 'info');
    }

    // פונקציה לסימון משימה כבוצעה מההתראה
    async markTaskAsCompletedFromAlarm(taskId) {
        try {
            const currentUser = this.getCurrentUserName();

            if (currentUser) {
                // ← שנה: סמן ישירות עם היוזר המחובר
                await this.markTaskAsCompleted(taskId, currentUser);
                NotificationManager.show('המשימה סומנה כבוצעה', 'success');
            } else {
                // fallback - פתח דיאלוג
                await this.openEmployeeSelectionModal(taskId);
                NotificationManager.show(
                    'בחר עובד לסימון המשימה כבוצעה',
                    'info'
                );
            }
        } catch (error) {
            console.error('Error marking task as completed from alarm:', error);
            NotificationManager.show('שגיאה בסימון המשימה', 'error');
        }
    }

    // Initialize tasks for today
    async initializeDailyTasks() {
        const today = new Date();
        const todayISO = today.toISOString().split('T')[0];
        const day = today.getDate().toString().padStart(2, '0');
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const year = today.getFullYear();
        const todayFormatted = `${day}/${month}/${year}`;

        document.getElementById('tasksDateHidden').value = todayISO;
        document.getElementById('tasksDate').value = todayFormatted;

        this.currentTaskDate = todayISO;

        // Load employees first
        await this.loadEmployees();

        this.loadTasksForDate(todayISO);

        const filtersCollapsed = localStorage.getItem('dailyTaskFiltersSectionCollapsed');
        if (filtersCollapsed === 'true' || filtersCollapsed == null) {
            document.getElementById('dailyTasksFiltersContent')?.classList.add('collapsed');
            document.getElementById('dailyTasksFiltersCollapseBtn')?.classList.add('collapsed');
        }

        this.clearFilterButton();
        this.initializeFlatpickr();
        this.startAutoRefresh();
        this.startAlarmMonitoring();
    }

    initializeFlatpickr() {
        this.flatpickrInstance = FlatpickrHelper.initHebrewDatePicker(
            "#tasksDateHidden",
            (selectedDates, dateStr) => {
                const formattedDate = FlatpickrHelper.formatDateToDisplay(dateStr);
                document.getElementById('tasksDate').value = formattedDate;
                this.loadTasksForDate(dateStr);
            },
            {
                defaultDate: this.currentTaskDate || new Date()
            }
        );
    }

    // Open employee selection modal
    async openEmployeeSelectionModal(taskId) {
        const currentUser = this.getCurrentUserName();
        if (currentUser) {
            await this.markTaskAsCompleted(taskId, currentUser);
            return;
        }

        this.isModalOpen = true;
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('completionTaskId').value = taskId;
        document.getElementById('completionTaskTitle').textContent = task.title;

        // ← עדכן display ו-hidden input
        const userName = this.getLastSelectedEmployee() || '';
        const displayEl = document.getElementById('completionCurrentUserDisplay');
        const hiddenInput = document.getElementById('completionEmployeeName');
        if (displayEl) displayEl.textContent = userName || 'לא מזוהה';
        if (hiddenInput) hiddenInput.value = userName;

        document.getElementById('employeeCompletionModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Open skip reason modal
    async openSkipReasonModal(taskId) {
        if (this.isDateInPast(this.currentTaskDate)) {
            NotificationManager.show(
                'לא ניתן לסמן משימה כלא בוצעה בתאריך שעבר',
                'warning'
            );
            return;
        }
        this.isModalOpen = true;

        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('skipTaskId').value = taskId;
        document.getElementById('skipTaskTitle').textContent = task.title;
        document.getElementById('skipReasonSelect').value = '';
        document.getElementById('skipReasonCustom').value = '';

        const currentUser = this.getCurrentUserName();
        const skipSelect = document.getElementById('skipUserName');
        await this.populateEmployeeSelect('skipUserName', currentUser);
        if (skipSelect && currentUser) {
            // ← שינוי: הצג שם קבוע
            skipSelect.style.display = 'none';
            let readonlyDiv = skipSelect.parentNode.querySelector('.readonly-user-display');
            if (!readonlyDiv) {
                readonlyDiv = document.createElement('div');
                readonlyDiv.className = 'readonly-user-display';
                skipSelect.parentNode.insertBefore(readonlyDiv, skipSelect);
            }
            readonlyDiv.textContent = currentUser;
            readonlyDiv.dataset.value = currentUser;
            skipSelect.value = currentUser;
        }

        document.getElementById('customReasonGroup').style.display = 'none';
        document.getElementById('skipReasonModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Create task HTML
    createTaskHTML(task) {
        const completionDates = task.completionDates || [];
        const skipReasons = task.skipReasons || {};
        const skipUserNames = task.skipUserNames || {};
        const completedByEmployees = task.completedByEmployees || {};
        const completionTimes = task.completionTimes || {};
        const skipTimes = task.skipTimes || {};

        const notesByDate = task.notesByDate || {};
        const notesForCurrentDate = notesByDate[this.currentTaskDate] || [];

        const isCompletedForDate = completionDates.includes(this.currentTaskDate);
        const skipReason = skipReasons[this.currentTaskDate];
        const skipUserName = skipUserNames[this.currentTaskDate];
        const isPastDate = this.isDateInPast(this.currentTaskDate);
        const completedByEmployee = completedByEmployees[this.currentTaskDate];
        const completionTime = completionTimes[this.currentTaskDate];
        const skipTime = skipTimes[this.currentTaskDate];
        const showSkipReason = skipReason && !isCompletedForDate;

        const dayOfWeek = new Date(this.currentTaskDate).getDay();
        const relevantDays = task.daysOfWeek || [0, 1, 2, 3, 4, 5, 6];
        const isShownOnlyDueToHistory = !relevantDays.includes(dayOfWeek) &&
            this.taskHasHistoryForDate(task, this.currentTaskDate);

        this.sortMode = this.currentSort == 'selfOrder' ? 'manual' : 'auto';
        const isDraggable = this.sortMode === 'manual' &&
            !isPastDate &&
            this.currentSort === 'selfOrder';

        // כל משימה עם שעת ביצוע תקבל אייקון התראה
        const hasExecutionTime = task.taskHour && task.taskMinute;

        return `
        <div class="task-item ${isCompletedForDate ? 'completed' : ''} 
                            ${showSkipReason ? 'skipped' : ''} 
                            ${isPastDate ? 'past-date' : ''}
                            ${isShownOnlyDueToHistory ? 'history-only' : ''}" 
            data-task-id="${task.id}"
            draggable="${isDraggable}"
            ${isDraggable ? `
            ondragstart="dailyTasksManager.handleDragStart(event)"
            ondragover="dailyTasksManager.handleDragOver(event)"
            ondrop="dailyTasksManager.handleDrop(event)"
            ondragend="dailyTasksManager.handleDragEnd(event)"
            ` : ''}
            ondblclick="dailyTasksManager.viewTask('${task.id}')">

            ${!isPastDate && isDraggable ? `
            <div class="drag-handle" title="גרור לשינוי סדר">
                <i class="fas fa-grip-vertical"></i>
            </div>
            ` : ''}
        
            <div class="task-checkbox"
                ${!isPastDate ? `onclick="dailyTasksManager.toggleTask('${task.id}')"` : ''}>
                ${isCompletedForDate ? '<i class="fas fa-check"></i>' : ''}
                ${showSkipReason ? '<i class="fas fa-times"></i>' : ''}
                ${isPastDate && !isCompletedForDate && !showSkipReason ? '<i class="fas fa-lock"></i>' : ''}
            </div>
        
            <div class="task-priority ${task.priority}"></div>
            <div class="task-content">
                <div class="task-text">
                    ${task.title}
                    ${this.getTaskDaysDisplay(task)}
                    ${isShownOnlyDueToHistory ? '<span class="history-badge" title="משימה זו מוצגת רק בגלל היסטוריה"><i class="fas fa-history"></i> כבר לא נמצאת ביום זה</span>' : ''}
                </div>
                ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
                ${isCompletedForDate && completedByEmployee ?
                `<div class="task-completed-by">
                    <i class="fas fa-user-check"></i>
                    בוצע על ידי: <strong>${completedByEmployee}</strong>
                    ${completionTime ? `<span class="completion-time">בשעה <strong>${completionTime}</strong></span>` : ''}
                </div>` : ''}
                
                ${showSkipReason ? `<div class="task-skip-reason">
                    <i class="fas fa-ban"></i> לא בוצע על ידי <strong>${skipUserName || 'לא ידוע'}</strong>
                    ${skipTime ? `בשעה <strong>${skipTime}</strong>` : ''}
                    : ${skipReason}
                </div>` : ''}
                ${isPastDate ? `<div class="task-past-notice">תאריך עבר - לא ניתן לעדכן סטטוס</div>` : ''}
            </div>

            
            ${hasExecutionTime ?
                `<div class="task-scheduled-time">
                שעת ביצוע: ${task.taskHour}:${task.taskMinute}
                ${task.enableAlarm !== false ?
                    '<i class="fas fa-bell" title="התראה מופעלת"></i>' :
                    '<i class="fas fa-bell-slash" title="התראה מושבתת"></i>'}
            </div>` : ''}

            <span class="task-notes-badge ${notesForCurrentDate.length > 0 ? 'has-notes' : 'no-notes'}" 
                title="${notesForCurrentDate.length > 0 ? `יש ${notesForCurrentDate.length} הערות ליום ${this.formatDate(this.currentTaskDate)}` : 'אין הערות ליום זה - לחץ להוספה'}"
                onclick="event.stopPropagation(); dailyTasksManager.openAddNoteModal('${task.id}')">
                <i class="fas fa-comment-dots"></i> 
                <span class="notes-count">${notesForCurrentDate.length}</span>
                <button class="badge-add-note-btn" 
                        title="הוסף הערה">
                    <i class="fas fa-plus"></i>
                </button>
                
                ${notesForCurrentDate.length > 0 ? `
                    <!-- Notes Popup for CURRENT DATE ONLY -->
                    <div class="task-notes-popup" onclick="event.stopPropagation()">
                        <div class="notes-popup-header">
                            <i class="fas fa-sticky-note"></i>
                            <span>הערות ליום ${this.formatDate(this.currentTaskDate)} (${notesForCurrentDate.length})</span>
                        </div>
                        <div class="notes-popup-list">
                            ${notesForCurrentDate.map((note, index) => `
                                <div class="note-popup-item">
                                    <div class="note-popup-header">
                                        <div class="note-popup-meta">
                                            <div class="note-popup-user">
                                                <i class="fas fa-user"></i>
                                                ${note.userName}
                                            </div>
                                            <div class="note-popup-datetime">
                                                <span>
                                                    <i class="fas fa-calendar"></i>
                                                    ${this.formatDate(note.date)}
                                                </span>
                                                <span>
                                                    <i class="fas fa-clock"></i>
                                                    ${note.time}
                                                </span>
                                            </div>
                                        </div>
                                        <div class="note-popup-buttons">
                                            <button class="note-popup-edit"
                                                    onclick="event.stopPropagation(); dailyTasksManager.editNoteFromPopup('${task.id}', ${index}, '${note.text.replace(/'/g, "\\'")}')"
                                                    title="ערוך הערה">
                                                <i class="fas fa-edit"></i>
                                            </button>
                                            <button class="note-popup-delete" 
                                                    onclick="event.stopPropagation(); dailyTasksManager.deleteNoteFromPopup('${task.id}', ${index})"
                                                    title="מחק הערה">
                                                <i class="fas fa-trash"></i>
                                            </button>
                                            </div>
                                    </div>
                                    <div class="note-popup-text">${note.text}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </span>
            <div class="task-actions">
                ${!isPastDate ? (
                !isCompletedForDate && !showSkipReason ?
                    `<button class="task-action-btn skip" onclick="dailyTasksManager.openSkipReasonModal('${task.id}')" title="סמן כלא בוצע">
                            <i class="fas fa-ban"></i>
                        </button>` :
                    isCompletedForDate ?
                        `<div class="task-action-spacer" title="משימה הושלמה">
                                <i class="fas fa-check-circle"></i>
                            </div>` : ''
            ) : ''}
                ${!isPastDate && showSkipReason ?
                `<button class="task-action-btn clear-skip" onclick="dailyTasksManager.clearSkipReason('${task.id}')" title="בטל סיבת אי ביצוע">
                    <i class="fas fa-undo"></i>
                </button>` : ''}
                ${!isPastDate ? `
                    <button class="task-action-btn edit" onclick="dailyTasksManager.editTask('${task.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="task-action-btn delete" onclick="dailyTasksManager.deleteTask('${task.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                ` : `
                    <div class="task-action-spacer" title="לא ניתן לערוך תאריך שעבר">
                        <i class="fas fa-lock"></i>
                    </div>
                `}
            </div>

    </div>`;
    }

    // Edit note from popup
    async editNoteFromPopup(taskId, noteIndex, currentText) {
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        // Open the annotation model in edit mode
        const notesByDate = task.notesByDate || {};
        const notesForCurrentDate = notesByDate[this.currentTaskDate] || [];
        const noteToEdit = notesForCurrentDate[noteIndex];

        if (!noteToEdit) return;

        // Fill in the details in the model
        document.getElementById('noteTaskId').value = taskId;
        document.getElementById('noteTaskTitle').textContent = task.title;
        document.getElementById('noteText').value = noteToEdit.text;

        // Save the index for editing
        document.getElementById('noteEditIndex').value = noteIndex;

        // Change the model title and save button
        document.getElementById('noteModalTitle').textContent = 'ערוך הערה';
        document.getElementById('noteSubmitBtn').textContent = 'עדכן הערה';

        // Fill in the employee's name (if there is a dropdown)
        const currentUser = this.getCurrentUserName();
        const userNameSelect = document.getElementById('noteUserName');
        if (userNameSelect) {
            const displayUser = currentUser || noteToEdit.userName;
            this.populateEmployeeSelect('noteUserName', currentUser);
            // ← שינוי: הצג שם קבוע
            userNameSelect.style.display = 'none';
            let readonlyDiv = userNameSelect.parentNode.querySelector('.readonly-user-display');
            if (!readonlyDiv) {
                readonlyDiv = document.createElement('div');
                readonlyDiv.className = 'readonly-user-display';
                userNameSelect.parentNode.insertBefore(readonlyDiv, userNameSelect);
            }
            readonlyDiv.textContent = displayUser || '';
            readonlyDiv.dataset.value = displayUser || '';
            userNameSelect.value = displayUser || '';
        }

        // Open the model
        document.getElementById('addNoteModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Delete note from popup (with confirmation)
    async deleteNoteFromPopup(taskId, noteIndex) {
        if (!confirm('האם אתה בטוח שברצונך למחוק הערה זו?')) {
            return;
        }

        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        const notesByDate = task.notesByDate || {};
        const notesForCurrentDate = notesByDate[this.currentTaskDate] || [];
        const noteDate = notesForCurrentDate[noteIndex]?.date || this.currentTaskDate;

        const deleteNoteData = {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            time: task.time,
            completed: task.completed,
            date: task.date,
            taskMinute: task.taskMinute,
            taskHour: task.taskHour,
            completionDate: noteDate,
            deleteNoteIndex: noteIndex
        };

        try {
            const response = await fetch('/DailyTasks/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(deleteNoteData)
            });

            const result = await response.json();

            if (result.success) {
                if (result.task) {
                    task.notesByDate = result.task.notesByDate || [];
                    task.history = result.task.history || [];
                }

                // עדכון מיידי של התצוגה
                if (this.hasActiveFilters()) {
                    this.applyFilters();
                } else {
                    this.displayTasks();
                }

                NotificationManager.show('ההערה נמחקה בהצלחה', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקת ההערה', 'error');
            }
        } catch (error) {
            console.error('Error deleting note:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Toggle task completion
    async toggleTask(taskId) {
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        // בדוק אם המשימה מסומנת כ"לא בוצעה" (skipped)
        const skipReasons = task.skipReasons || {};
        const isSkipped = skipReasons[this.currentTaskDate];

        // אם המשימה skipped - נקה את הסיבה במקום לסמן כהושלמה
        if (isSkipped) {
            await this.clearSkipReason(taskId);
            return;
        }

        // אם המשימה כבר מסומנת כהושלמה - פשוט בטל
        if (task.completed) {
            const wasCompleted = task.completed;
            task.completed = false;

            if (!task.completionDates) {
                task.completionDates = [];
            }

            const completionData = {
                id: task.id,
                title: task.title,
                description: task.description,
                priority: task.priority,
                time: task.time,
                completed: false,
                date: task.date,
                taskMinute: task.taskMinute,
                taskHour: task.taskHour,
                completionDate: this.currentTaskDate
            };

            try {
                const response = await fetch('/DailyTasks/UpdateTask', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(completionData)
                });

                const result = await response.json();

                if (result.success) {
                    if (result.task && result.task.completionDates) {
                        task.completionDates = result.task.completionDates;
                    }
                    task.completed = task.completionDates && task.completionDates.includes(this.currentTaskDate);
                    task.history = result.task.history || [];

                    // עדכון מיידי של התצוגה - שמירה על סינון ומיון
                    if (this.hasActiveFilters()) {
                        this.applyFilters();
                    } else {
                        this.displayTasks();
                    }
                    this.updateProgress();
                    NotificationManager.show(`משימה בוטלה: ${task.title}`, 'info');
                } else {
                    task.completed = wasCompleted;
                    NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
                }
            } catch (error) {
                task.completed = wasCompleted;
                console.error('Error updating task:', error);
                NotificationManager.show('שגיאה בחיבור לשרת', 'error');
            }
            return;
        }

        // אם המשימה לא הושלמה ולא skipped - פתח מודל בחירת עובד
        await this.openEmployeeSelectionModal(taskId);
    }

    // סגירת מודל בחירת עובד
    closeEmployeeCompletionModal() {
        this.isModalOpen = false;
        document.getElementById('employeeCompletionModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('employeeCompletionForm').reset();
    }

    // סימון משימה כהושלמה עם שם עובד
    async markTaskAsCompleted(taskId, employeeName) {
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        // Save last selected employee
        this.saveLastSelectedEmployee(employeeName);

        const wasCompleted = task.completed;
        task.completed = true;

        if (!task.completionDates) {
            task.completionDates = [];
        }

        const now = new Date();
        const completionTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const completionData = {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            time: task.time,
            completed: true,
            date: task.date,
            taskMinute: task.taskMinute,
            taskHour: task.taskHour,
            completionDate: this.currentTaskDate,
            completedByEmployee: employeeName,
            completionTime: completionTime,
            skipReason: ''
        };

        try {
            const response = await fetch('/DailyTasks/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(completionData)
            });

            const result = await response.json();

            if (result.success) {
                if (result.task) {
                    task.completionDates = result.task.completionDates || [];
                    task.completedByEmployees = result.task.completedByEmployees || {};
                    task.skipReasons = result.task.skipReasons || {};
                    task.skipTimes = result.task.skipTimes || {};
                    task.skipUserNames = result.task.skipUserNames || {};
                    task.completionTimes = result.task.completionTimes || {};
                    task.history = result.task.history || [];
                }

                task.completed = task.completionDates && task.completionDates.includes(this.currentTaskDate);

                // עדכון מיידי של התצוגה - שמירה על סינון ומיון
                if (this.hasActiveFilters()) {
                    this.applyFilters();
                } else {
                    this.displayTasks();
                }
                this.updateProgress();

                NotificationManager.show(`משימה הושלמה על ידי ${employeeName}: ${task.title}`, 'success');
            } else {
                task.completed = wasCompleted;
                NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
            }
        } catch (error) {
            task.completed = wasCompleted;
            console.error('Error updating task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Get selected days of week
    getSelectedDays() {
        const days = [];
        const dayCheckboxes = [
            'daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday',
            'dayThursday', 'dayFriday', 'daySaturday'
        ];

        dayCheckboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox && checkbox.checked) {
                days.push(parseInt(checkbox.value));
            }
        });

        return days;
    }

    // Set selected days in modal
    setSelectedDays(days) {
        const dayCheckboxes = [
            'daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday',
            'dayThursday', 'dayFriday', 'daySaturday'
        ];

        dayCheckboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                const dayValue = parseInt(checkbox.value);
                checkbox.checked = days.includes(dayValue);
            }
        });
    }

    // Add/Edit task
    async saveTask(taskData, isEditing = false) {
        try {
            const url = isEditing ? '/DailyTasks/UpdateTask' : '/DailyTasks/AddTask';
            const method = isEditing ? 'PUT' : 'POST';

            // Get selected days
            const selectedDays = this.getSelectedDays();

            if (selectedDays.length === 0) {
                NotificationManager.show('יש לבחור לפחות יום אחד', 'warning');
                return;
            }

            const requestData = {
                ...taskData,
                description: taskData.description || '',
                priority: taskData.priority || 'medium',
                time: taskData.time || '',
                taskHour: taskData.taskHour || '',
                taskMinute: taskData.taskMinute || '',
                daysOfWeek: selectedDays,
                enableAlarm: taskData.enableAlarm || false
            };

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                await this.loadTasksForDate(this.currentTaskDate);
                this.closeAddTaskModal();
                const successMessage = isEditing ? 'משימה עודכנה בהצלחה!' : 'משימה נוספה בהצלחה!';
                NotificationManager.show(successMessage, 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירת המשימה', 'error');
            }
        } catch (error) {
            console.error('Error saving task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Delete task
    async deleteTask(taskId) {
        if (this.isDateInPast(this.currentTaskDate)) {
            NotificationManager.show('לא ניתן למחוק משימות בתאריך שעבר', 'warning');
            return;
        }
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        if (!confirm(`האם אתה בטוח שברצונך למחוק את המשימה "${task.title}"?\n\n📅 המשימה תיעלם מהיום ואילך\n✅ ההיסטוריה של תאריכים קודמים תישמר\n\n⚠️ פעולה זו לא ניתנת לביטול`)) {
            return;
        }

        try {
            const response = await fetch(`/DailyTasks/DeleteTask?id=${taskId}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                await this.loadTasksForDate(this.currentTaskDate);
                NotificationManager.show('המשימה נמחקה מהיום ואילך. ההיסטוריה נשמרה.', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקת המשימה', 'error');
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    updateTimeClearButton() {
        const hourInput = document.getElementById('taskHour');
        const minuteInput = document.getElementById('taskMinute');
        const clearBtn = document.querySelector('.time-task-clear-btn');

        if (!clearBtn) return;

        // Show button only if hour OR minute has a value
        if ((hourInput?.value || minuteInput?.value) &&
            !(document.getElementById('taskHour').disabled || document.getElementById('taskMinute').disabled)) {
            clearBtn.style.display = 'inline-block';
        } else {
            clearBtn.style.display = 'none';
        }

        document.querySelectorAll('.readonly-user-display').forEach(div => {
            const select = div.nextElementSibling || div.parentNode.querySelector('select');
            if (select) select.style.display = '';
            div.remove();
        });
    }

    // Select/Deselect all days
    selectAllDays() {
        const dayCheckboxes = [
            'daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday',
            'dayThursday', 'dayFriday', 'daySaturday'
        ];

        dayCheckboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = true;
            }
        });
    }

    deselectAllDays() {
        const dayCheckboxes = [
            'daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday',
            'dayThursday', 'dayFriday', 'daySaturday'
        ];

        dayCheckboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox && !checkbox.disabled) {
                checkbox.checked = false;
            }
        });
    }

    // Show or hide days selection buttons - FIXED VERSION
    showDaysSelectionButtons(show) {
        // Find the existing days selection container
        const daysContainer = document.querySelector('.days-selection');

        if (!daysContainer) {
            console.error('Could not find days selection container');
            return;
        }

        // Find or create the parent form-group
        let formGroup = daysContainer.closest('.form-group');

        if (!formGroup) {
            console.error('Could not find form-group parent');
            return;
        }

        // Check if fieldset wrapper already exists
        let fieldset = formGroup.querySelector('.days-of-week-fieldset');

        if (!fieldset) {
            // Create fieldset wrapper
            fieldset = document.createElement('fieldset');
            fieldset.className = 'days-of-week-fieldset';

            // Move the label content
            const existingLabel = formGroup.querySelector('.form-label');
            const labelText = existingLabel ? existingLabel.innerHTML : '<i class="fas fa-calendar-week"></i> ימי הופעה בשבוע';

            // Move days-selection and form-help into fieldset
            const daysSelection = formGroup.querySelector('.days-selection');
            const formHelp = formGroup.querySelector('.form-help');

            if (daysSelection) {
                fieldset.appendChild(daysSelection);
            }

            if (formHelp) {
                fieldset.appendChild(formHelp);
            }

            // Replace form-group content with fieldset
            if (existingLabel) {
                existingLabel.remove();
            }
            formGroup.appendChild(fieldset);
        }

        // Check if header already exists
        let header = fieldset.querySelector('.days-of-week-header');

        if (show) {
            if (!header) {
                // Create header with title and buttons
                header = document.createElement('div');
                header.className = 'days-of-week-header';

                header.innerHTML = `
                <div class="days-of-week-title">
                    <i class="fas fa-calendar-week"></i>
                    <span>ימי הופעה בשבוע</span>
                </div>
                <div class="days-selection-buttons">
                    <button type="button" id="selectAllDaysBtn">
                        <i class="fas fa-check-double"></i>
                        <span>סמן הכל</span>
                    </button>
                    <button type="button" id="deselectAllDaysBtn">
                        <i class="fas fa-times"></i>
                        <span>הסר הכל</span>
                    </button>
                </div>
            `;

                // Insert header at the beginning of fieldset
                fieldset.insertBefore(header, fieldset.firstChild);

                // Add event listeners
                const selectAllBtn = document.getElementById('selectAllDaysBtn');
                const deselectAllBtn = document.getElementById('deselectAllDaysBtn');

                if (selectAllBtn) {
                    selectAllBtn.onclick = () => this.selectAllDays();
                }

                if (deselectAllBtn) {
                    deselectAllBtn.onclick = () => this.deselectAllDays();
                }
            } else {
                // Show existing header
                header.style.display = 'flex';
            }
        } else {
            // Hide header in view mode
            if (header) {
                header.style.display = 'none';
            }
        }
    }

    openAddTaskModal() {
        this.isModalOpen = true;
        document.getElementById('taskModalTitle').textContent = 'הוסף משימה חדשה';
        document.getElementById('taskSubmitBtn').textContent = 'הוסף משימה';
        document.getElementById('addTaskForm').reset();
        document.getElementById('taskId').value = '';
        document.getElementById('taskDate').value = this.currentTaskDate;

        // אתחל את תיבת הסימון של ההתראה
        document.getElementById('taskEnableAlarm').checked = true;

        // עדכן את מצב האייקון
        const alarmLabel = document.querySelector('.alarm-label');
        if (alarmLabel) {
            alarmLabel.classList.add('active');
        }

        this.updateAlarmCheckboxVisibility();

        // Default: all days checked
        this.setSelectedDays([0, 1, 2, 3, 4, 5, 6]);

        // Show days selection buttons
        this.showDaysSelectionButtons(true);

        this.updateTimeClearButton();

        // Initialize listeners for this modal instance
        this.initializeTimeInputListeners();

        document.getElementById('addTaskModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    closeAddTaskModal() {
        this.isModalOpen = false;
        document.getElementById('addTaskModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('addTaskForm').reset();
        document.getElementById('taskHour').value = '';
        document.getElementById('taskMinute').value = '';

        // Re-enable all inputs
        document.getElementById('taskTitle').disabled = false;
        document.getElementById('taskDescription').disabled = false;
        document.getElementById('taskPriority').disabled = false;
        document.getElementById('taskHour').disabled = false;
        document.getElementById('taskMinute').disabled = false;
        document.getElementById('taskTime').disabled = false;

        // הסר את מחלקת view-only מהאייקון
        const alarmLabel = document.querySelector('.alarm-label');
        if (alarmLabel) {
            alarmLabel.classList.remove('view-only');
        }

        // אפשר מחדש את הצ'קבוקס
        const alarmCheckbox = document.getElementById('taskEnableAlarm');
        if (alarmCheckbox) {
            alarmCheckbox.disabled = false;
        }

        // Re-enable day checkboxes
        const dayCheckboxes = [
            'daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday',
            'dayThursday', 'dayFriday', 'daySaturday'
        ];
        dayCheckboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.disabled = false;
            }
        });

        // Show submit button
        document.getElementById('taskSubmitBtn').style.display = 'inline-block';

        // Remove history section completely
        const historySection = document.getElementById('taskHistorySection');
        if (historySection) {
            historySection.remove();
        }

        // **FIX: Remove only the header, keep the fieldset structure**
        const header = document.querySelector('.days-of-week-header');
        if (header) {
            header.remove();
        }

        this.updateTimeClearButton();
    }

    editTask(taskId) {
        if (this.isDateInPast(this.currentTaskDate)) {
            NotificationManager.show('לא ניתן לערוך משימות בתאריך שעבר', 'warning');
            return;
        }
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('taskModalTitle').textContent = 'ערוך משימה';
        document.getElementById('taskSubmitBtn').textContent = 'עדכן משימה';
        document.getElementById('taskId').value = task.id;
        document.getElementById('taskDate').value = task.date;
        document.getElementById('taskTitle').value = task.title;
        document.getElementById('taskDescription').value = task.description || '';
        document.getElementById('taskPriority').value = task.priority;
        document.getElementById('taskHour').value = task.taskHour || '';
        document.getElementById('taskMinute').value = task.taskMinute || '';
        document.getElementById('taskTime').value = task.time || '';

        // עדכן את תיבת הסימון של ההתראה
        const alarmCheckbox = document.getElementById('taskEnableAlarm');
        alarmCheckbox.checked = task.enableAlarm !== false;

        // עדכן את מצב האייקון
        const alarmLabel = document.querySelector('.alarm-label');
        if (alarmLabel) {
            if (task.enableAlarm !== false) {
                alarmLabel.classList.add('active');
            } else {
                alarmLabel.classList.remove('active');
            }
        }

        this.updateAlarmCheckboxVisibility();

        // Set selected days
        if (task.daysOfWeek && task.daysOfWeek.length > 0) {
            this.setSelectedDays(task.daysOfWeek);
        } else {
            // Default: all days checked
            this.setSelectedDays([0, 1, 2, 3, 4, 5, 6]);
        }

        // Show days selection buttons
        this.showDaysSelectionButtons(true);

        this.updateTimeClearButton();

        // Initialize listeners for this modal instance
        this.initializeTimeInputListeners();

        document.getElementById('addTaskModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // פונקציה להפעלה/כיבוי של ההתראה
    toggleAlarm() {
        const checkbox = document.getElementById('taskEnableAlarm');
        if (checkbox) {
            checkbox.checked = !checkbox.checked;

            // עדכון המראה החזותי של האייקון
            const alarmLabel = document.querySelector('.alarm-label');
            if (alarmLabel) {
                if (checkbox.checked) {
                    alarmLabel.classList.add('active');
                } else {
                    alarmLabel.classList.remove('active');
                }
            }
        }
    }

    // פונקציה חדשה לעדכון תצוגת תיבת הסימון של ההתראה
    updateAlarmCheckboxVisibility() {
        const hourSelect = document.getElementById('taskHour');
        const minuteSelect = document.getElementById('taskMinute');
        const alarmContainer = document.querySelector('.alarm-checkbox-container');
        const alarmCheckbox = document.getElementById('taskEnableAlarm');
        const alarmLabel = document.querySelector('.alarm-label');

        if (!alarmContainer) return;

        // הצג את תיבת הסימון רק אם נבחרו גם שעה וגם דקות
        if (hourSelect?.value && minuteSelect?.value) {
            alarmContainer.style.display = 'flex';

            // עדכון מצב האייקון לפי מצב תיבת הסימון
            if (alarmLabel && alarmCheckbox) {
                if (alarmCheckbox.checked) {
                    alarmLabel.classList.add('active');
                } else {
                    alarmLabel.classList.remove('active');
                }
            }
        } else {
            alarmContainer.style.display = 'none';

            // כאשר אין שעה או דקות, וודא שתיבת הסימון מסומנת כברירת מחדל
            if (alarmCheckbox) {
                alarmCheckbox.checked = true;
            }
        }
    }

    viewTask(taskId) {
        if (this.isDateInPast(this.currentTaskDate)) {
            // Allow viewing past tasks
        }

        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('taskModalTitle').textContent = 'צפייה במשימה';
        document.getElementById('taskSubmitBtn').style.display = 'none';
        document.getElementById('taskId').value = task.id;
        document.getElementById('taskDate').value = task.date;
        document.getElementById('taskTitle').value = task.title;
        document.getElementById('taskDescription').value = task.description || '';
        document.getElementById('taskPriority').value = task.priority;
        document.getElementById('taskHour').value = task.taskHour || '';
        document.getElementById('taskMinute').value = task.taskMinute || '';
        document.getElementById('taskTime').value = task.time || '';

        // עדכן את תיבת הסימון של ההתראה
        const alarmCheckbox = document.getElementById('taskEnableAlarm');
        if (alarmCheckbox) {
            alarmCheckbox.checked = task.enableAlarm !== false;
        }

        // עדכן את מצב האייקון
        const alarmLabel = document.querySelector('.alarm-label');
        if (alarmLabel) {
            if (task.enableAlarm !== false) {
                alarmLabel.classList.add('active');
            } else {
                alarmLabel.classList.remove('active');
            }
            // הוסף מחלקה שתמנע אינטראקציה עם האייקון במצב צפייה
            alarmLabel.classList.add('view-only');
        }

        this.updateAlarmCheckboxVisibility();

        // Set selected days (view mode)
        if (task.daysOfWeek && task.daysOfWeek.length > 0) {
            this.setSelectedDays(task.daysOfWeek);
        } else {
            // Default: all days checked
            this.setSelectedDays([0, 1, 2, 3, 4, 5, 6]);
        }

        // Hide days selection buttons in view mode
        this.showDaysSelectionButtons(false);

        // Disable all inputs
        document.getElementById('taskTitle').disabled = true;
        document.getElementById('taskDescription').disabled = true;
        document.getElementById('taskPriority').disabled = true;
        document.getElementById('taskHour').disabled = true;
        document.getElementById('taskMinute').disabled = true;
        document.getElementById('taskTime').disabled = true;

        // Disable day checkboxes
        const dayCheckboxes = [
            'daySunday', 'dayMonday', 'dayTuesday', 'dayWednesday',
            'dayThursday', 'dayFriday', 'daySaturday'
        ];
        dayCheckboxes.forEach(id => {
            const checkbox = document.getElementById(id);
            if (checkbox) {
                checkbox.disabled = true;
            }
        });

        // Show history section
        this.displayTaskHistory(task);

        document.getElementById('addTaskModal').style.display = 'block';
        this.updateTimeClearButton();
        document.body.style.overflow = 'hidden';
    }

    // Display history
    displayTaskHistory(task) {
        // Wait for modal to be fully rendered
        setTimeout(() => {
            let historyContainer = document.getElementById('taskHistoryContainer');

            if (!historyContainer) {
                // Find the modal body (not the form!)
                const modalBody = document.querySelector('#addTaskModal .form-body');

                if (!modalBody) {
                    console.error('Modal body not found');
                    return;
                }

                // Create history section
                const historySection = document.createElement('div');
                historySection.id = 'taskHistorySection';
                historySection.className = 'form-group';
                historySection.style.cssText = `
                margin-top: 20px;
                padding: 15px;
                background: linear-gradient(135deg, #f8f9ff, #ffffff);
                border-radius: 12px;
                border-right: 4px solid #667eea;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
            `;

                historySection.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; cursor: pointer;" onclick="dailyTasksManager.toggleTaskHistory()">
                    <h4 style="color: #320F5B; margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 8px; font-weight: 700;">
                        <i class="fas fa-history" style="color: #667eea; font-size: 1.2rem;"></i>
                        היסטוריית שינויים
                    </h4>
                    <button type="button" class="history-toggle-btn" style="background: rgba(102, 126, 234, 0.1); border: none; color: #667eea; padding: 8px 12px; border-radius: 8px; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 0.9rem;">
                        <span class="history-toggle-text">הצג</span>
                        <i class="fas fa-chevron-down history-toggle-icon" style="transition: transform 0.3s ease;"></i>
                    </button>
                </div>
                <div id="taskHistoryContainer" style="max-height: 0; overflow-y: auto; transition: max-height 0.4s ease, opacity 0.4s ease; opacity: 0; padding-left: 5px;"></div>            `;

                // Append to modal body (inside the scrollable area)
                modalBody.appendChild(historySection);

                // Get the newly created container
                historyContainer = document.getElementById('taskHistoryContainer');
            } else {
                // Show existing history section and reset to collapsed state
                const historySection = document.getElementById('taskHistorySection');
                if (historySection) {
                    historySection.style.display = 'block';
                    // Reset to collapsed
                    historyContainer.style.maxHeight = '0';
                    historyContainer.style.opacity = '0';
                    const toggleBtn = historySection.querySelector('.history-toggle-btn');
                    const toggleText = historySection.querySelector('.history-toggle-text');
                    const toggleIcon = historySection.querySelector('.history-toggle-icon');
                    if (toggleText) toggleText.textContent = 'הצג';
                    if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
                }
            }

            if (!historyContainer) {
                console.error('Failed to create history container');
                return;
            }

            // Clear previous content
            historyContainer.innerHTML = '';
            if (!task.history || task.history.length === 0) {
                historyContainer.innerHTML = `
                <div style="text-align: center; color: #666; padding: 20px; font-style: italic;">
                    <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 10px; display: block;"></i>
                    אין היסטוריית שינויים למשימה זו
                </div>
            `;
                return;
            }


            const filteredHistory = task.history.filter(entry => {
                if (!entry) return false;

                // בדוק אם targetDate קיים ותואם לתאריך הנוכחי
                if (entry.targetDate && entry.targetDate === this.currentTaskDate) {
                    return true;
                }

                // אם אין targetDate, בדוק אם timestamp מכיל את התאריך הנוכחי
                if (entry.timestamp) {
                    // Extract the date part from timestamp (YYYY-MM-DD)
                    const timestampDate = entry.timestamp.split(' ')[0];
                    return timestampDate === this.currentTaskDate;
                }

                return false;
            });

            if (filteredHistory.length === 0) {
                historyContainer.innerHTML = `
                <div style="text-align: center; color: #666; padding: 20px; font-style: italic;">
                    <i class="fas fa-info-circle" style="font-size: 1.5rem; margin-bottom: 10px; display: block;"></i>
                    אין היסטוריית שינויים ליום ${this.formatDate(this.currentTaskDate)}
                </div>
            `;
                return;
            }

            // Sort history by timestamp (newest first)
            const sortedHistory = [...filteredHistory].sort((a, b) =>
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            const historyHTML = sortedHistory.map(entry => {
                const date = new Date(entry.timestamp);
                const formattedDate = date.toLocaleDateString('he-IL');
                const formattedTime = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

                let actionIcon = 'fa-edit';
                let actionColor = '#667eea';

                if (entry.action === 'הושלמה') {
                    actionIcon = 'fa-check-circle';
                    actionColor = '#28a745';
                } else if (entry.action === 'לא בוצעה') {
                    actionIcon = 'fa-times-circle';
                    actionColor = '#ffc107';
                } else if (entry.action === 'ביטול סטטוס') {
                    actionIcon = 'fa-undo';
                    actionColor = '#6c757d';
                } else if (entry.action === 'ביטול סיבת אי-ביצוע') {
                    actionIcon = 'fa-eraser';
                    actionColor = '#17a2b8';
                }

                return `
                <div class="history-entry" style="--action-color: ${actionColor}; border-right: 4px solid ${actionColor};">
                    
                    <div class="history-header">
                        <div class="history-action-wrapper">
                            <div class="history-action-icon">
                                <i class="fas ${actionIcon}"></i>
                            </div>
                            <strong class="history-action-title">${entry.action}</strong>
                        </div>
                        <div class="history-date-box">
                            <span class="history-date">
                                <i class="fas fa-calendar-alt"></i>
                                ${formattedDate}
                            </span>
                            <span class="history-time">
                                <i class="fas fa-clock"></i>
                                ${formattedTime}
                            </span>
                        </div>
                    </div>
                    
                    
                    <div class="history-details">
                        ${entry.details} 
                    ${entry.userName != "משתמש" ? `
                        ע"י <div class="history-user-info">
                            <div class="history-user-avatar">
                                <i class="fas fa-user"></i>
                            </div>
                            <strong class="history-user-name">${entry.userName}</strong>
                        </div>
                    ` : ''}
                    </div>
                    
                    ${entry.previousValue && entry.newValue ? `
                        <div class="history-comparison">
                            <div class="history-comparison-header">
                                <i class="fas fa-exchange-alt"></i>
                                <strong>השוואת שינויים</strong>
                            </div>
                            <div class="history-comparison-grid">
                                <div class="history-value-box before">
                                    <div class="history-value-label">לפני</div>
                                    <div class="history-value-text">${entry.previousValue || 'ללא'}</div>
                                </div>
                                <i class="fas fa-arrow-left history-comparison-arrow"></i>
                                <div class="history-value-box after">
                                    <div class="history-value-label">אחרי</div>
                                    <div class="history-value-text">${entry.newValue || 'ללא'}</div>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
            }).join('');

            historyContainer.innerHTML = historyHTML;

        }, 150);
    }

    // Toggle function for history
    toggleTaskHistory() {
        const historyContainer = document.getElementById('taskHistoryContainer');
        const toggleBtn = document.querySelector('.history-toggle-btn');
        const toggleText = document.querySelector('.history-toggle-text');
        const toggleIcon = document.querySelector('.history-toggle-icon');

        if (!historyContainer) return;

        // שיפור הבדיקה אם ההיסטוריה מוסתרת
        const isCollapsed = historyContainer.style.maxHeight === '0px' ||
            historyContainer.style.maxHeight === '' ||
            parseInt(historyContainer.style.maxHeight) === 0;

        if (isCollapsed) {
            // Expand - set to scrollHeight to show all content, but limit visual height with CSS
            historyContainer.style.maxHeight = '545px';
            historyContainer.style.opacity = '1';
            if (toggleText) toggleText.textContent = 'הסתר';
            if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
            if (toggleBtn) toggleBtn.style.background = 'rgba(102, 126, 234, 0.2)';
        } else {
            // Collapse
            historyContainer.style.maxHeight = '0';
            historyContainer.style.opacity = '0';
            if (toggleText) toggleText.textContent = 'הצג';
            if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
            if (toggleBtn) toggleBtn.style.background = 'rgba(102, 126, 234, 0.1)';
        }
    }

    closeSkipReasonModal() {
        this.isModalOpen = false;
        document.getElementById('skipReasonModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('skipReasonForm').reset();
    }

    // Mark task as skipped
    async markTaskAsSkipped(taskId, skipReason, userName) {
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        // Save last selected employee
        this.saveLastSelectedEmployee(userName);

        const now = new Date();
        const skipTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const skipData = {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            time: task.time,
            completed: false,
            date: task.date,
            taskMinute: task.taskMinute,
            taskHour: task.taskHour,
            completionDate: this.currentTaskDate,
            skipReason: skipReason,
            skipUserName: userName,
            skipTime: skipTime
        };

        try {
            const response = await fetch('/DailyTasks/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(skipData)
            });

            const result = await response.json();

            if (result.success) {
                if (result.task) {
                    task.completionDates = result.task.completionDates || [];
                    task.skipReasons = result.task.skipReasons || {};
                    task.skipUserNames = result.task.skipUserNames || {};
                    task.skipTimes = result.task.skipTimes || {};
                    task.completedByEmployees = result.task.completedByEmployees || {};
                    task.history = result.task.history || [];
                }

                task.completed = task.completionDates && task.completionDates.includes(this.currentTaskDate);

                // עדכון מיידי של התצוגה - שמירה על סינון ומיון
                if (this.hasActiveFilters()) {
                    this.applyFilters();
                } else {
                    this.displayTasks();
                }
                this.updateProgress();
                NotificationManager.show(`משימה סומנה כלא בוצעה על ידי ${userName}: ${skipReason}`, 'info');
            } else {
                NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
            }
        } catch (error) {
            console.error('Error marking task as skipped:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Clear skip reason
    async clearSkipReason(taskId, skipConfirmation = false) {

        if (!skipConfirmation && !confirm('האם לבטל את סיבת אי הביצוע?')) {
            return;
        }
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        const clearData = {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            time: task.time,
            taskMinute: task.taskMinute,
            taskHour: task.taskHour,
            completed: false,
            date: task.date,
            completionDate: this.currentTaskDate,
            skipReason: ''
        };

        try {
            const response = await fetch('/DailyTasks/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(clearData)
            });

            const result = await response.json();

            if (result.success) {
                if (result.task) {
                    task.completionDates = result.task.completionDates || [];
                    task.skipReasons = result.task.skipReasons || {};
                    task.skipUserNames = result.task.skipUserNames || {};
                    task.completedByEmployees = result.task.completedByEmployees || {};
                    task.history = result.task.history || [];
                }

                task.completed = task.completionDates && task.completionDates.includes(this.currentTaskDate);

                // עדכון מיידי של התצוגה - שמירה על סינון ומיון
                if (this.hasActiveFilters()) {
                    this.applyFilters();
                } else {
                    this.displayTasks();
                }
                this.updateProgress();
                NotificationManager.show('סיבת האי ביצוע בוטלה', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בעדכון המשימה', 'error');
            }
        } catch (error) {
            console.error('Error clearing skip reason:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Open add note modal
    openAddNoteModal(taskId) {
        this.isModalOpen = true;
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('noteTaskId').value = taskId;
        document.getElementById('noteTaskTitle').textContent = task.title;
        document.getElementById('noteText').value = '';

        document.getElementById('noteEditIndex').value = '';
        document.getElementById('noteModalTitle').textContent = 'הוסף הערה';
        document.getElementById('noteSubmitBtn').textContent = 'הוסף הערה';

        // מלא את שם המשתמש המחובר אוטומטית
        const currentUser = this.getCurrentUserName();

        const noteSelect = document.getElementById('noteUserName');
        if (noteSelect && currentUser) {
            // ← שינוי: הצג שם קבוע
            noteSelect.style.display = 'none';
            this.populateEmployeeSelect('noteUserName', currentUser);
            let readonlyDiv = noteSelect.parentNode.querySelector('.readonly-user-display');
            if (!readonlyDiv) {
                readonlyDiv = document.createElement('div');
                readonlyDiv.className = 'readonly-user-display';
                noteSelect.parentNode.insertBefore(readonlyDiv, noteSelect);
            }
            readonlyDiv.textContent = currentUser;
            readonlyDiv.dataset.value = currentUser;
            noteSelect.value = currentUser;
        }
        document.getElementById('addNoteModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Close add note modal
    closeAddNoteModal() {
        this.isModalOpen = false;
        document.getElementById('addNoteModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('addNoteForm').reset();

        // Reset edit mode
        document.getElementById('noteEditIndex').value = '';
        document.getElementById('noteModalTitle').textContent = 'הוסף הערה';
        document.getElementById('noteSubmitBtn').textContent = 'הוסף הערה';
    }

    // Add/Edit note to task
    async addNoteToTask(taskId, noteText, userName) {
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        // Save last selected employee
        this.saveLastSelectedEmployee(userName);

        const now = new Date();
        const noteTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        // Check if this is an edit or an addition
        const editIndexInput = document.getElementById('noteEditIndex');
        const isEditing = editIndexInput && editIndexInput.value !== '';
        const editIndex = isEditing ? parseInt(editIndexInput.value) : null;

        const notesByDate = task.notesByDate || {};
        const notesForCurrentDate = notesByDate[this.currentTaskDate] || [];
        const noteDate = isEditing && notesForCurrentDate[editIndex]
            ? notesForCurrentDate[editIndex].date
            : this.currentTaskDate;

        const noteData = {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            time: task.time,
            completed: task.completed,
            date: task.date,
            taskMinute: task.taskMinute,
            taskHour: task.taskHour,
            completionDate: noteDate,
            noteText: isEditing ? null : noteText,
            noteUserName: isEditing ? null : userName,
            noteTime: isEditing ? null : noteTime,
            noteDate: isEditing ? null : this.currentTaskDate,
            editNoteIndex: isEditing ? editIndex : null,
            editNoteText: isEditing ? noteText : null,
            editNoteUserName: isEditing ? userName : null
        };

        try {
            const response = await fetch('/DailyTasks/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(noteData)
            });

            const result = await response.json();

            if (result.success) {
                if (result.task) {
                    task.notesByDate = result.task.notesByDate || [];
                    task.history = result.task.history || [];
                }

                // עדכון מיידי של התצוגה
                if (this.hasActiveFilters()) {
                    this.applyFilters();
                } else {
                    this.displayTasks();
                }

                this.closeAddNoteModal();
                const successMsg = isEditing ? 'ההערה עודכנה בהצלחה' : `הערה נוספה על ידי ${userName}`;
                NotificationManager.show(successMsg, 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירת ההערה', 'error');
            }
        } catch (error) {
            console.error('Error saving note:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Delete note from task
    async deleteNote(taskId, noteIndex) {
        if (!confirm('האם אתה בטוח שברצונך למחוק הערה זו?')) {
            return;
        }

        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        const deleteNoteData = {
            id: task.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            time: task.time,
            completed: task.completed,
            date: task.date,
            taskMinute: task.taskMinute,
            taskHour: task.taskHour,
            completionDate: this.currentTaskDate,
            deleteNoteIndex: noteIndex
        };

        try {
            const response = await fetch('/DailyTasks/UpdateTask', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(deleteNoteData)
            });

            const result = await response.json();

            if (result.success) {
                if (result.task) {
                    task.notesByDate = result.task.notesByDate || [];
                    task.history = result.task.history || [];
                }

                // עדכון מיידי של התצוגה
                if (this.hasActiveFilters()) {
                    this.applyFilters();
                } else {
                    this.displayTasks();
                }

                NotificationManager.show('ההערה נמחקה בהצלחה', 'success');
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקת ההערה', 'error');
            }
        } catch (error) {
            console.error('Error deleting note:', error);
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // Drag and drop functionality
    handleDragStart(event) {
        // Clean any previous drag states first
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        document.querySelectorAll('.dragging').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        if (this.sortMode !== 'manual' || this.isDateInPast(this.currentTaskDate)) {
            event.preventDefault();

            event.currentTarget.classList.remove('dragging', 'drag-over');
            event.currentTarget.style.opacity = '1';

            document.querySelectorAll('.dragging, .drag-over').forEach(item => {
                item.classList.remove('dragging', 'drag-over');
                item.style.opacity = '1';
            });

            if (this.isDateInPast(this.currentTaskDate)) {
                NotificationManager.show('לא ניתן לשנות סדר משימות בתאריך שעבר', 'warning');
            }

            return;
        }

        this.draggedElement = event.currentTarget;
        this.draggedTaskId = event.currentTarget.getAttribute('data-task-id');

        // Now add dragging class
        event.currentTarget.classList.add('dragging');

        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/html', event.currentTarget.outerHTML);
    }

    addDropIndicator(element) {
        // הסר סמנים קודמים
        this.removeDropIndicators();

        // צור סמן חדש
        const indicator = document.createElement('div');
        indicator.className = 'task-drop-indicator';

        // הוסף לDOM
        element.parentNode.insertBefore(indicator, element);

        // הפעל אנימציה (setTimeout נדרש כדי שהאנימציה תעבוד)
        setTimeout(() => {
            indicator.classList.add('active');
        }, 10);
    }

    removeDropIndicators() {
        document.querySelectorAll('.task-drop-indicator').forEach(indicator => {
            indicator.remove();
        });
    }

    handleDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';

        const taskItem = event.currentTarget;
        if (taskItem !== this.draggedElement) {
            // נקה מכל המשימות האחרות
            document.querySelectorAll('.task-item').forEach(item => {
                if (item !== taskItem && item !== this.draggedElement) {
                    item.classList.remove('drag-over');
                }
            });

            // הוסף רק למשימה הנוכחית
            taskItem.classList.add('drag-over');
        }
    }

    handleDrop(event) {
        if (this.sortMode !== 'manual') {
            return;
        }

        event.preventDefault();
        const dropTarget = event.currentTarget;
        const dropTaskId = dropTarget.getAttribute('data-task-id');

        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1'; // Force reset
        });

        if (this.draggedTaskId !== dropTaskId) {
            const draggedIndex = this.dailyTasks.findIndex(t => t.id === this.draggedTaskId);
            const dropIndex = this.dailyTasks.findIndex(t => t.id === dropTaskId);

            if (draggedIndex !== -1 && dropIndex !== -1) {
                const draggedTask = this.dailyTasks[draggedIndex];
                this.dailyTasks.splice(draggedIndex, 1);
                this.dailyTasks.splice(dropIndex, 0, draggedTask);

                this.saveTaskOrder();
            }
        }

        this.draggedElement = null;
        this.draggedTaskId = null;
    }

    handleDragEnd(event) {
        // Force cleanup
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        this.draggedElement = null;
        this.draggedTaskId = null;
    }

    // Save task order
    async saveTaskOrder() {
        try {
            const taskOrder = this.dailyTasks.map((task, index) => ({
                id: task.id,
                order: index
            }));

            const response = await fetch('/DailyTasks/UpdateTaskOrder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: this.currentTaskDate,
                    taskOrder: taskOrder
                })
            });

            const result = await response.json();

            if (result.success) {
                // **תיקון: טען מחדש מהשרת כדי לסנכרן את הסדר**
                await this.loadTasksForDate(this.currentTaskDate);
                NotificationManager.show('סדר המשימות עודכן', 'success');
            } else {
                console.error('Failed to save task order:', result.error);
                await this.loadTasksForDate(this.currentTaskDate);
            }
        } catch (error) {
            console.error('Error saving task order:', error);
            await this.loadTasksForDate(this.currentTaskDate);
        }
    }

    // Update progress display
    updateProgress() {
        const completedTasks = this.dailyTasks.filter(task => {
            const completionDates = task.completionDates || [];
            return completionDates.includes(this.currentTaskDate);
        }).length;

        const totalTasks = this.dailyTasks.length;
        const percentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        const progressCircle = document.getElementById('progressCircle');
        const progressText = document.getElementById('progressText');
        const progressDescription = document.getElementById('progressDescription');

        progressCircle.style.setProperty('--progress', `${percentage * 3.6}deg`);
        progressText.textContent = `${percentage}%`;
        progressDescription.textContent = `${completedTasks} מתוך ${totalTasks} משימות הושלמו`;

        if (percentage === 100) {
            progressCircle.style.background = `conic-gradient(#28a745 0deg, #28a745 360deg, #e9ecef 360deg, #e9ecef 360deg)`;
        } else if (percentage >= 75) {
            progressCircle.style.background = `conic-gradient(#ffa502 0deg, #ffa502 ${percentage * 3.6}deg, #e9ecef ${percentage * 3.6}deg, #e9ecef 360deg)`;
        } else {
            progressCircle.style.background = `conic-gradient(#667eea 0deg, #667eea ${percentage * 3.6}deg, #e9ecef ${percentage * 3.6}deg, #e9ecef 360deg)`;
        }
    }

    // Date handling functions
    openDatePicker() {
        document.getElementById('tasksDateHidden').click();
    }

    handleDatePickerChange(isoDate) {
        if (isoDate) {
            const date = new Date(isoDate);
            const day = date.getDate().toString().padStart(2, '0');
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            const year = date.getFullYear();
            const formattedDate = `${day}/${month}/${year}`;

            document.getElementById('tasksDate').value = formattedDate;
            this.loadTasksForDate(isoDate);
        }
    }

    setToday() {
        const today = new Date();
        const todayISO = today.toISOString().split('T')[0];
        const day = today.getDate().toString().padStart(2, '0');
        const month = (today.getMonth() + 1).toString().padStart(2, '0');
        const year = today.getFullYear();
        const todayFormatted = `${day}/${month}/${year}`;

        document.getElementById('tasksDateHidden').value = todayISO;
        document.getElementById('tasksDate').value = todayFormatted;

        this.loadTasksForDate(todayISO);
    }

    // Helper methods
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

    formatDate(dateString) {
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    handleSkipReasonChange() {
        const select = document.getElementById('skipReasonSelect');
        const customGroup = document.getElementById('customReasonGroup');

        if (select.value === 'אחר') {
            customGroup.style.display = 'block';
            document.getElementById('skipReasonCustom').required = true;
        } else {
            customGroup.style.display = 'none';
            document.getElementById('skipReasonCustom').required = false;
            document.getElementById('skipReasonCustom').value = '';
        }
    }

    clearTimeSelection() {
        document.getElementById('taskHour').value = '';
        document.getElementById('taskMinute').value = '';
        this.updateTimeClearButton();
        this.updateAlarmCheckboxVisibility();
    }

    // Sort tasks by scheduled time
    sortTasksByTime() {
        this.dailyTasks.sort((a, b) => {
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

    applyFilters() {
        // Get filter values
        this.activeFilters = {
            status: document.getElementById('dailyFilterStatus')?.value || '',
            priority: document.getElementById('dailyFilterPriority')?.value || '',
            time: document.getElementById('dailyFilterTime')?.value || ''
        };

        this.currentSort = document.getElementById('dailyTasksSort')?.value || 'time';
        if (this.currentSort === 'selfOrder' && this.originalTasksOrder.length > 0) {
            this.dailyTasks = [...this.originalTasksOrder];
        }

        // Start with all tasks
        this.filteredTasks = [...this.dailyTasks];

        // Apply status filter
        if (this.activeFilters.status) {
            this.filteredTasks = this.filteredTasks.filter(task => {
                const isCompleted = task.completionDates && task.completionDates.includes(this.currentTaskDate);
                const isSkipped = task.skipReasons && task.skipReasons[this.currentTaskDate];

                if (this.activeFilters.status === 'completed') return isCompleted;
                if (this.activeFilters.status === 'skipped') return isSkipped;
                if (this.activeFilters.status === 'pending') return !isCompleted && !isSkipped;
                return true;
            });
        }

        // Apply time filter
        if (this.activeFilters.time) {
            this.filteredTasks = this.filteredTasks.filter(task => {
                const hasTime = task.taskHour && task.taskMinute;
                if (this.activeFilters.time === 'with-time') return hasTime;
                if (this.activeFilters.time === 'without-time') return !hasTime;
                return true;
            });
        }

        if (this.activeFilters.priority) {
            this.filteredTasks = this.filteredTasks.filter(task => {
                return task.priority === this.activeFilters.priority;
            });

        }

        // Apply sorting
        this.applySorting();

        // Update display
        this.displayFilteredTasks();
        this.updateActiveFiltersDisplay();
        this.clearFilterButton();
    }

    // Apply sorting to filtered tasks
    applySorting() {
        if (this.currentSort === 'selfOrder') {
            // Keep original order (manual or from server)
            return;
        }

        this.filteredTasks.sort((a, b) => {
            switch (this.currentSort) {
                case 'priority':
                    const priorityOrder = { high: 1, medium: 2, low: 3 };
                    return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);

                case 'time':
                    const aHasTime = a.taskHour && a.taskMinute;
                    const bHasTime = b.taskHour && b.taskMinute;

                    if (aHasTime && !bHasTime) return -1;
                    if (!aHasTime && bHasTime) return 1;
                    if (!aHasTime && !bHasTime) return 0;

                    const aHour = parseInt(a.taskHour);
                    const bHour = parseInt(b.taskHour);

                    const aAdjustedHour = aHour < 7 ? aHour + 24 : aHour;
                    const bAdjustedHour = bHour < 7 ? bHour + 24 : bHour;

                    const aTime = aAdjustedHour * 60 + parseInt(a.taskMinute);
                    const bTime = bAdjustedHour * 60 + parseInt(b.taskMinute);

                    return aTime - bTime;

                case 'status':
                    const aCompleted = a.completionDates && a.completionDates.includes(this.currentTaskDate);
                    const bCompleted = b.completionDates && b.completionDates.includes(this.currentTaskDate);
                    const aSkipped = a.skipReasons && a.skipReasons[this.currentTaskDate];
                    const bSkipped = b.skipReasons && b.skipReasons[this.currentTaskDate];

                    if (aCompleted && !bCompleted) return 1;
                    if (!aCompleted && bCompleted) return -1;
                    if (aSkipped && !bSkipped) return 1;
                    if (!aSkipped && bSkipped) return -1;
                    return 0;

                case 'title':
                    return a.title.localeCompare(b.title, 'he');

                default:
                    return 0;
            }
        });
    }

    // Display filtered tasks
    displayFilteredTasks() {
        const container = document.getElementById('tasksContainer');
        const tasksToDisplay = this.filteredTasks.length > 0 ? this.filteredTasks :
            (this.hasActiveFilters() ? [] : this.dailyTasks);

        if (tasksToDisplay.length === 0) {
            if (this.hasActiveFilters()) {
                container.innerHTML = `
            <div class="tasks-empty">
                <i class="fas fa-filter"></i><br>
                לא נמצאו משימות התואמות את הסינון
            </div>`;
            } else {
                container.innerHTML = `
            <div class="tasks-empty">
                <i class="fas fa-clipboard-list"></i><br>
                אין משימות להיום
            </div>`;
            }
            return;
        }

        const tasksHTML = `
    <div class="tasks-list">
        ${tasksToDisplay.map(task => this.createTaskHTML(task)).join('')}
    </div>`;

        container.innerHTML = tasksHTML;

        // Enable/disable dragging based on sort mode
        const isPastDate = this.isDateInPast(this.currentTaskDate);

        document.querySelectorAll('.task-item').forEach(item => {
            const dragHandle = item.querySelector('.drag-handle');

            if (this.sortMode === 'manual' && !isPastDate) {
                item.setAttribute('draggable', 'true');
                if (dragHandle) {
                    dragHandle.style.display = 'flex';
                }
            } else {
                item.setAttribute('draggable', 'false');
                if (dragHandle) {
                    dragHandle.style.display = 'none';
                }
            }
        });
    }

    // Check if any filters are active
    hasActiveFilters() {
        return this.activeFilters.status ||
            this.activeFilters.priority ||
            this.activeFilters.time ||
            this.currentSort !== 'time';
    }


    clearFilterButton() {
        const clearBtn = document.querySelector('.daily-tasks-section .clear-filters-btn');
        if (clearBtn) {
            if (this.hasActiveFilters()) {
                clearBtn.style.display = 'inline-flex';
            } else {
                clearBtn.style.display = 'none';
            }
        }
    }

    // Update active filters display with clickable tags
    updateActiveFiltersDisplay() {
        const display = document.getElementById('dailyTasksActiveFiltersDisplay');
        if (!display) return;

        const filterTags = [];

        if (this.activeFilters.status) {
            const statusLabels = {
                'completed': 'סטטוס: הושלם',
                'skipped': 'סטטוס: לא בוצע',
                'pending': 'סטטוס: ממתין'
            };
            filterTags.push(`
            <div class="filter-tag" onclick="dailyTasksManager.removeFilter('status')" title="לחץ להסרה">
                <i class="fas fas fa-filter"></i> ${statusLabels[this.activeFilters.status]}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        if (this.activeFilters.priority) {
            const priorityLabels = {
                'high': 'עדיפות: גבוהה',
                'medium': 'עדיפות: בינונית',
                'low': 'עדיפות: נמוכה'
            };
            filterTags.push(`
            <div class="filter-tag" onclick="dailyTasksManager.removeFilter('priority')" title="לחץ להסרה">
                <i class="fas fas fa-filter"></i> ${priorityLabels[this.activeFilters.priority]}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        if (this.activeFilters.time) {
            const timeLabels = {
                'with-time': 'עם שעת ביצוע',
                'without-time': 'ללא שעת ביצוע'
            };
            filterTags.push(`
            <div class="filter-tag" onclick="dailyTasksManager.removeFilter('time')" title="לחץ להסרה">
                <i class="fas fas fa-filter"></i> ${timeLabels[this.activeFilters.time]}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        if (this.currentSort !== 'time') {
            const sortLabels = {
                'priority': 'מיון: עדיפות',
                'selfOrder': 'מיון: סידור חופשי',
                'status': 'מיון: סטטוס',
                'title': 'מיון: שם'
            };
            filterTags.push(`
            <div class="filter-tag" onclick="dailyTasksManager.removeFilter('sort')" title="לחץ להסרה">
                <i class="fas fas fa-filter"></i> ${sortLabels[this.currentSort]}
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

        this.clearFilterButton();
    }

    // Clear all filters
    clearFilters() {
        // Reset filter selects
        const statusFilter = document.getElementById('dailyFilterStatus');
        const priorityFilter = document.getElementById('dailyFilterPriority');
        const timeFilter = document.getElementById('dailyFilterTime');
        const sortSelect = document.getElementById('dailyTasksSort');

        if (statusFilter) statusFilter.value = '';
        if (priorityFilter) priorityFilter.value = '';
        if (timeFilter) timeFilter.value = '';
        if (sortSelect) sortSelect.value = 'time';

        // Reset internal state
        this.activeFilters = {
            status: '',
            priority: '',
            time: ''
        };

        this.currentSort = 'time';
        this.filteredTasks = [...this.dailyTasks];

        if (this.currentSort == 'time') {
            this.sortTasksByTime();
        }

        // Update display
        this.displayTasks();
        this.updateActiveFiltersDisplay();
        this.clearFilterButton();

        NotificationManager.show('הסינונים נוקו', 'info');
    }

    removeFilter(filterType) {
        switch (filterType) {
            case 'status':
                this.activeFilters.status = '';
                const statusFilter = document.getElementById('dailyFilterStatus');
                if (statusFilter) statusFilter.value = '';
                break;

            case 'priority':
                this.activeFilters.priority = '';
                const priorityFilter = document.getElementById('dailyFilterPriority');
                if (priorityFilter) priorityFilter.value = '';
                break;

            case 'time':
                this.activeFilters.time = '';
                const timeFilter = document.getElementById('dailyFilterTime');
                if (timeFilter) timeFilter.value = '';
                break;

            case 'sort':
                this.currentSort = 'time';
                const sortSelect = document.getElementById('dailyTasksSort');
                if (sortSelect) sortSelect.value = 'time';
                break;
        }

        // Re-apply filters
        this.applyFilters();

        NotificationManager.show('הסינון הוסר', 'info');
    }

    displayTasks() {
        const container = document.getElementById('tasksContainer');

        // Clean up any drag states BEFORE rendering
        document.querySelectorAll('.task-item').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        document.querySelectorAll('.dragging').forEach(item => {
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';
        });

        if (this.dailyTasks.length === 0) {
            container.innerHTML = `
            <div class="tasks-empty">
                <i class="fas fa-clipboard-list"></i><br>
                אין משימות להיום
            </div>`;
            return;
        }

        const tasksHTML = `
    <div class="tasks-list">
        ${this.dailyTasks.map(task => this.createTaskHTML(task)).join('')}
    </div>`;

        container.innerHTML = tasksHTML;

        this.applyCurrentSort();

        // Enable/disable dragging based on sort mode and past date
        const isPastDate = this.isDateInPast(this.currentTaskDate);

        const canDrag = this.sortMode === 'manual' &&
            !isPastDate &&
            this.currentSort === 'selfOrder';

        document.querySelectorAll('.task-item').forEach(item => {
            // Ensure clean state
            item.classList.remove('dragging', 'drag-over');
            item.style.opacity = '1';

            const dragHandle = item.querySelector('.drag-handle');

            if (canDrag) {
                item.setAttribute('draggable', 'true');
                if (dragHandle) {
                    dragHandle.style.display = 'flex';
                }
            } else {
                item.setAttribute('draggable', 'false');
                if (dragHandle) {
                    dragHandle.style.display = 'none';
                }
            }
        });
    }

    // Apply current sort to dailyTasks
    applyCurrentSort() {
        if (this.currentSort === 'selfOrder') {
            // Keep original order from server
            return;
        }

        if (this.currentSort === 'time') {
            this.sortTasksByTime();
        } else if (this.currentSort === 'priority') {
            this.dailyTasks.sort((a, b) => {
                const priorityOrder = { high: 1, medium: 2, low: 3 };
                return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);
            });
        } else if (this.currentSort === 'status') {
            this.dailyTasks.sort((a, b) => {
                const aCompleted = a.completionDates && a.completionDates.includes(this.currentTaskDate);
                const bCompleted = b.completionDates && b.completionDates.includes(this.currentTaskDate);
                const aSkipped = a.skipReasons && a.skipReasons[this.currentTaskDate];
                const bSkipped = b.skipReasons && b.skipReasons[this.currentTaskDate];

                if (aCompleted && !bCompleted) return 1;
                if (!aCompleted && bCompleted) return -1;
                if (aSkipped && !bSkipped) return 1;
                if (!aSkipped && bSkipped) return -1;
                return 0;
            });
        } else if (this.currentSort === 'title') {
            this.dailyTasks.sort((a, b) => a.title.localeCompare(b.title, 'he'));
        }
    }

    // Load tasks for specific date
    async loadTasksForDate(date) {
        this.currentTaskDate = date;
        try {
            const response = await fetch(`/DailyTasks/GetTasks?date=${date}`);
            const data = await response.json();

            if (data.error) {
                console.error('Error loading tasks:', data.error);
                this.dailyTasks = [];
                this.originalTasksOrder = [];
                NotificationManager.show('שגיאה בטעינת המשימות', 'error');
            } else {
                const selectedDate = new Date(date);
                selectedDate.setHours(0, 0, 0, 0);

                const dayOfWeek = selectedDate.getDay();

                this.dailyTasks = data
                    .filter(task => {
                        const createdDate = new Date(task.createdAt);
                        createdDate.setHours(0, 0, 0, 0);

                        const wasCreatedByThisDate = createdDate <= selectedDate;
                        const wasDeletedBeforeThisDate = task.isDeleted &&
                            task.deletionDate &&
                            new Date(task.deletionDate) <= selectedDate;

                        // Check if there is a history for this day
                        const hasHistoryForThisDate = this.taskHasHistoryForDate(task, date);

                        // Find the relevant days for the selected date
                        let relevantDays = task.daysOfWeek || [0, 1, 2, 3, 4, 5, 6];

                        if (task.daysOfWeekHistory && task.daysOfWeekHistory.length > 0) {
                            // Sort by date (oldest to newest)
                            const sortedHistory = [...task.daysOfWeekHistory].sort((a, b) =>
                                new Date(a.changeDate) - new Date(b.changeDate)
                            );

                            // Find the last change that happened before or on the selected date
                            for (let i = sortedHistory.length - 1; i >= 0; i--) {
                                const changeDate = new Date(sortedHistory[i].changeDate);
                                changeDate.setHours(0, 0, 0, 0);

                                if (changeDate <= selectedDate) {
                                    relevantDays = sortedHistory[i].newDays;
                                    break;
                                } else if (i === 0) {
                                    // If all changes happened after the selected date, use the first few days
                                    relevantDays = sortedHistory[0].oldDays;
                                }
                            }
                        }

                        const shouldShowOnThisDay = !relevantDays ||
                            relevantDays.length === 0 ||
                            relevantDays.includes(dayOfWeek);

                        // Show the task if:
                        // 1. It was created before this date
                        // 2. It was not deleted before this date
                        // 3. (It is set to this day OR it has a history on this day)
                        return wasCreatedByThisDate &&
                            !wasDeletedBeforeThisDate &&
                            (shouldShowOnThisDay || hasHistoryForThisDate);
                    })
                    .map(task => {
                        if (!task.completionDates) task.completionDates = [];
                        if (!task.skipReasons) task.skipReasons = {};
                        if (!task.skipUserNames) task.skipUserNames = {};
                        if (!task.completedByEmployees) task.completedByEmployees = {};

                        return {
                            ...task,
                            completed: task.completionDates.includes(date)
                        };
                    });

                this.originalTasksOrder = [...this.dailyTasks];
                this.applyCurrentSort();

                if (this.sortMode === 'auto') {
                    this.sortTasksByTime();
                }
            }

            if (this.hasActiveFilters()) {
                this.applyFilters();
            } else {
                this.displayTasks();
            }
            this.updateProgress();
            this.updateDateDisplay();
        } catch (error) {
            console.error('Error fetching tasks:', error);
            this.dailyTasks = [];
            this.originalTasksOrder = [];

            if (this.hasActiveFilters()) {
                this.applyFilters();
            } else {
                this.displayTasks();
            }
            this.updateProgress();
            this.updateDateDisplay();
            NotificationManager.show('שגיאה בחיבור לשרת', 'error');
        }
    }

    // מניעת סגירת פופאפים בלחיצה מחוץ להם
    setupPopupClickHandling() {
        // מניעת סגירה בלחיצה מחוץ לפופאפ
        const preventOutsideClick = (e) => {
            // רשימת כל הפופאפים שרוצים למנוע סגירה בלחיצה מחוץ להם
            const popupIds = ['addTaskModal', 'employeeCompletionModal', 'skipReasonModal', 'addNoteModal'];

            // בדוק אם הלחיצה היא על אחד מהפופאפים עצמם (הרקע)
            for (const popupId of popupIds) {
                const popupElement = document.getElementById(popupId);

                // אם הפופאפ מוצג והלחיצה היא על הרקע שלו (לא על התוכן)
                if (popupElement &&
                    popupElement.style.display === 'block' &&
                    e.target === popupElement) {

                    // מנע את ברירת המחדל (סגירת הפופאפ)
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
        };

        // הוסף את מאזין האירועים לכל הפופאפים
        document.addEventListener('click', preventOutsideClick, true);

        // טיפול בכפתורי סגירה
        document.addEventListener('click', (e) => {
            // מיפוי של פופאפים לפונקציות הסגירה שלהם
            const closeButtonMap = [
                { selector: '#addTaskModal .close-btn', closeFunction: () => this.closeAddTaskModal() },
                { selector: '#employeeCompletionModal .close-btn', closeFunction: () => this.closeEmployeeCompletionModal() },
                { selector: '#skipReasonModal .close-btn', closeFunction: () => this.closeSkipReasonModal() },
                { selector: '#addNoteModal .close-btn', closeFunction: () => this.closeAddNoteModal() }
            ];

            // בדוק אם הלחיצה היא על כפתור סגירה
            for (const mapping of closeButtonMap) {
                const closeBtn = e.target.closest(mapping.selector);
                if (closeBtn) {
                    mapping.closeFunction();
                    return;
                }
            }
        });
    }

    // Check if task has any history for specific date
    taskHasHistoryForDate(task, date) {
        // Check if the task was completed on this date
        if (task.completionDates && task.completionDates.includes(date)) {
            return true;
        }

        // Check if there is a reason to skip this date
        if (task.skipReasons && task.skipReasons[date]) {
            return true;
        }

        // Check if there are any comments for this date
        if (task.notesByDate && task.notesByDate[date] && task.notesByDate[date].length > 0) {
            return true;
        }

        // Check if there are history records for this date
        if (task.history && task.history.length > 0) {
            const hasHistoryEntry = task.history.some(entry => {
                if (!entry) return false;

                // בדוק אם targetDate קיים ותואם לתאריך הנוכחי
                if (entry.targetDate && entry.targetDate === date) {
                    return true;
                }

                // אם אין targetDate, בדוק אם timestamp מכיל את התאריך הנוכחי
                if (entry.timestamp) {
                    // Extract the date part from timestamp (YYYY-MM-DD)
                    const timestampDate = entry.timestamp.split(' ')[0];
                    return timestampDate === date;
                }

                return false;
            });

            if (hasHistoryEntry) {
                return true;
            }
        }

        return false;
    }

    toggleFilterSection(sectionId) {

        const content = document.getElementById('dailyTasksFiltersContent');
        const collapseBtn = document.getElementById('dailyTasksFiltersCollapseBtn');

        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            collapseBtn.classList.remove('collapsed');
        } else {
            content.classList.add('collapsed');
            collapseBtn.classList.add('collapsed');
        }

        localStorage.setItem('dailyTaskFiltersSectionCollapsed', content.classList.contains('collapsed'));
    }

    // Get task days display
    getTaskDaysDisplay(task) {
        const dayNames = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\''];

        if (!task.daysOfWeek || task.daysOfWeek.length === 0 || task.daysOfWeek.length === 7) {
            return `<span class="task-days-badge" title="ימי ביצוע: כל ימות השבוע">
            <i class="fas fa-calendar-week"></i> כל ימות השבוע
        </span>`;
        }

        const selectedDays = task.daysOfWeek
            .sort((a, b) => a - b)
            .map(day => dayNames[day])
            .join(', ');

        return `<span class="task-days-badge" title="ימי ביצוע: ${selectedDays}">
        <i class="fas fa-calendar-week"></i> ${selectedDays}
    </span>`;
    }

    // ==========================================
    // EXCEL EXPORT - ייצוא משימות לאקסל
    // ==========================================

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

    showExportDialog() {
        // הסר דיאלוג קיים
        document.getElementById('tasksExportDialog')?.remove();

        // תאריך ברירת מחדל: חודש אחורה עד היום
        const today = new Date();
        const monthAgo = new Date();
        monthAgo.setMonth(monthAgo.getMonth() - 1);

        const formatForInput = (d) =>
            `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        const dialog = document.createElement('div');
        dialog.id = 'tasksExportDialog';
        dialog.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.55); z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        direction: rtl; backdrop-filter: blur(4px);
    `;

        dialog.innerHTML = `
        <div style="
            background: white; border-radius: 16px; padding: 28px;
            width: 90%; max-width: 520px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.25);
            direction: rtl; animation: modalSlideIn 0.25s ease;
        ">
            <!-- כותרת -->
            <div style="
                display: flex; justify-content: space-between;
                align-items: center; margin-bottom: 20px;
                padding-bottom: 14px; border-bottom: 2px solid #f0f0f0;
            ">
                <h3 style="margin:0; font-size:1.3rem; font-weight:700;
                           color:#320F5B; display:flex; align-items:center; gap:10px;">
                    <i class="fas fa-file-excel" style="color:#1D6F42;"></i>
                    ייצוא משימות לאקסל
                </h3>
                <button onclick="document.getElementById('tasksExportDialog').remove()"
                    style="background:#f5f5f5; border:none; width:32px; height:32px;
                           border-radius:50%; cursor:pointer; font-size:1rem;
                           color:#666; display:flex; align-items:center;
                           justify-content:center; transition:all 0.2s;">✕</button>
            </div>

            <!-- אפשרויות ייצוא -->
            <p style="color:#64748b; font-size:0.95rem; margin:0 0 16px 0;
                      text-align:center; font-weight:500;">
                בחר סוג ייצוא:
            </p>

            <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:20px;">

                <!-- ייצוא הכל -->
                <button id="exportAllTasksBtn"
                    onclick="dailyTasksManager._handleExportChoice('all')"
                    style="
                        display:flex; align-items:center; gap:14px;
                        padding:14px 18px; background:white;
                        border:2px solid #d1d5db; border-radius:12px;
                        cursor:pointer; text-align:right; transition:all 0.2s;
                        width:100%; direction:rtl; font-family:inherit;
                    "
                    onmouseover="this.style.borderColor='#1D6F42';this.style.background='#f0fff4';"
                    onmouseout="this.style.borderColor='#d1d5db';this.style.background='white';">
                    <div style="
                        width:42px; height:42px;
                        background:linear-gradient(135deg,#1D6F42,#27AE60);
                        border-radius:10px; display:flex; align-items:center;
                        justify-content:center; flex-shrink:0;
                    ">
                        <i class="fas fa-table" style="color:white; font-size:1.1rem;"></i>
                    </div>
                    <div style="flex:1; text-align:right;">
                        <div style="font-weight:700; color:#111827;
                                    font-size:0.95rem; margin-bottom:3px;">
                            ייצוא הכל
                        </div>
                        <div style="font-size:0.78rem; color:#9ca3af;">
                            כל המשימות מכל הזמנים
                        </div>
                    </div>
                    <i class="fas fa-chevron-left" style="color:#9ca3af; font-size:0.8rem;"></i>
                </button>

                <!-- ייצוא לפי טווח -->
                <button id="exportRangeTasksBtn"
                    onclick="dailyTasksManager._handleExportChoice('range')"
                    style="
                        display:flex; align-items:center; gap:14px;
                        padding:14px 18px; background:white;
                        border:2px solid #d1d5db; border-radius:12px;
                        cursor:pointer; text-align:right; transition:all 0.2s;
                        width:100%; direction:rtl; font-family:inherit;
                    "
                    onmouseover="this.style.borderColor='#667eea';this.style.background='#f5f3ff';"
                    onmouseout="this.style.borderColor='#d1d5db';this.style.background='white';">
                    <div style="
                        width:42px; height:42px;
                        background:linear-gradient(135deg,#667eea,#764ba2);
                        border-radius:10px; display:flex; align-items:center;
                        justify-content:center; flex-shrink:0;
                    ">
                        <i class="fas fa-calendar-alt" style="color:white; font-size:1.1rem;"></i>
                    </div>
                    <div style="flex:1; text-align:right;">
                        <div style="font-weight:700; color:#111827;
                                    font-size:0.95rem; margin-bottom:3px;">
                            ייצוא לפי טווח תאריכים
                        </div>
                        <div style="font-size:0.78rem; color:#9ca3af;">
                            בחר תאריך התחלה וסיום
                        </div>
                    </div>
                    <i class="fas fa-chevron-left" style="color:#9ca3af; font-size:0.8rem;"></i>
                </button>

            </div>

            <!-- אזור בחירת טווח - מוסתר בהתחלה -->
            <div id="tasksDateRangeSection" style="display:none;">
                <div style="
                    display:flex; gap:16px; justify-content:center;
                    flex-wrap:wrap; padding:16px;
                    background:#f8f9ff; border-radius:10px;
                    border:1px solid #e0e7ff; margin-bottom:14px;
                ">
                    <div style="display:flex; flex-direction:column; gap:6px; min-width:160px;">
                        <label style="font-size:13px; font-weight:600;
                                      color:#4a5568; text-align:right;">
                            מתאריך:
                        </label>
                        <div style="position:relative; display:flex; align-items:center;">
                            <input type="text" id="tasksExportFromDate"
                                placeholder="dd/mm/yyyy"
                                maxlength="10"
                                value="${formatForInput(monthAgo)}"
                                style="
                                    padding:8px 12px 8px 32px;
                                    border:1px solid #c3d0e8; border-radius:6px;
                                    font-size:14px; color:#2d3748;
                                    background:white; width:160px;
                                    text-align:center; direction:ltr;
                                    font-family:inherit;
                                " />
                            <i class="fas fa-calendar-alt" style="
                                position:absolute; left:10px; color:#667eea;
                                pointer-events:none; font-size:14px;
                            "></i>
                        </div>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:6px; min-width:160px;">
                        <label style="font-size:13px; font-weight:600;
                                      color:#4a5568; text-align:right;">
                            עד תאריך:
                        </label>
                        <div style="position:relative; display:flex; align-items:center;">
                            <input type="text" id="tasksExportToDate"
                                placeholder="dd/mm/yyyy"
                                maxlength="10"
                                value="${formatForInput(today)}"
                                style="
                                    padding:8px 12px 8px 32px;
                                    border:1px solid #c3d0e8; border-radius:6px;
                                    font-size:14px; color:#2d3748;
                                    background:white; width:160px;
                                    text-align:center; direction:ltr;
                                    font-family:inherit;
                                " />
                            <i class="fas fa-calendar-alt" style="
                                position:absolute; left:10px; color:#667eea;
                                pointer-events:none; font-size:14px;
                            "></i>
                        </div>
                    </div>
                </div>

                <div id="tasksExportRangeError"
                    style="color:#dc2626; text-align:center;
                           margin-bottom:10px; display:none; font-size:13px;">
                </div>

                <div style="text-align:center;">
                    <button onclick="dailyTasksManager._confirmRangeExport()"
                        style="
                            display:inline-flex; align-items:center; gap:8px;
                            padding:11px 24px;
                            background:linear-gradient(135deg,#667eea,#764ba2);
                            color:white; border:none; border-radius:9px;
                            font-size:0.95rem; font-weight:700;
                            cursor:pointer; font-family:inherit;
                            box-shadow:0 3px 12px rgba(102,126,234,0.3);
                            transition:all 0.2s;
                        "
                        onmouseover="this.style.transform='translateY(-2px)';
                                     this.style.boxShadow='0 6px 20px rgba(102,126,234,0.4)';"
                        onmouseout="this.style.transform='translateY(0)';
                                    this.style.boxShadow='0 3px 12px rgba(102,126,234,0.3)';">
                        <i class="fas fa-file-excel"></i>
                        ייצא טווח נבחר
                    </button>
                </div>
            </div>

        </div>
    `;

        document.body.appendChild(dialog);

        // סגירה בלחיצה על הרקע
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) dialog.remove();
        });

        // מסכה אוטומטית לשדות תאריך
        this._applyDateMask('tasksExportFromDate');
        this._applyDateMask('tasksExportToDate');
    }

    _applyDateMask(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        // אם Flatpickr זמין - השתמש בו
        if (typeof flatpickr !== 'undefined') {
            flatpickr(input, {
                dateFormat: 'd/m/Y',
                allowInput: true,
                disableMobile: false,
            });
            return;
        }

        // fallback - מסכה ידנית
        input.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length >= 3) val = val.slice(0, 2) + '/' + val.slice(2);
            if (val.length >= 6) val = val.slice(0, 5) + '/' + val.slice(5, 9);
            e.target.value = val;
        });
    }

    _handleExportChoice(type) {
        if (type === 'all') {
            document.getElementById('tasksExportDialog')?.remove();
            this._buildAndDownloadTasksExcel({ type: 'all' });
        } else if (type === 'range') {
            // הצג אזור תאריכים
            const rangeSection = document.getElementById('tasksDateRangeSection');
            if (rangeSection) rangeSection.style.display = 'block';

            // הדגש כפתור נבחר
            document.getElementById('exportRangeTasksBtn').style.borderColor = '#667eea';
            document.getElementById('exportRangeTasksBtn').style.background = '#f5f3ff';
        }
    }

    _parseDdMmYyyy(str) {
        if (!str || str.length < 8) return null;
        const parts = str.split('/');
        if (parts.length !== 3) return null;
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
        if (day < 1 || day > 31 || month < 0 || month > 11) return null;
        if (year < 2000 || year > 2100) return null;
        const d = new Date(year, month, day);
        if (d.getDate() !== day || d.getMonth() !== month) return null;
        return d;
    }

    _toIsoDate(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _confirmRangeExport() {
        const fromVal = document.getElementById('tasksExportFromDate')?.value;
        const toVal = document.getElementById('tasksExportToDate')?.value;
        const errEl = document.getElementById('tasksExportRangeError');

        if (!fromVal || !toVal) {
            errEl.textContent = 'יש לבחור תאריך התחלה וסיום';
            errEl.style.display = 'block';
            return;
        }

        const fromDate = this._parseDdMmYyyy(fromVal);
        const toDate = this._parseDdMmYyyy(toVal);

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
        document.getElementById('tasksExportDialog')?.remove();

        this._buildAndDownloadTasksExcel({
            type: 'range',
            from: this._toIsoDate(fromDate),
            to: this._toIsoDate(toDate),
            fromDisplay: fromVal,
            toDisplay: toVal,
        });
    }

    // -------------------------------------------------------
    // פונקציה ראשית לבניית קובץ האקסל
    // -------------------------------------------------------
    async _buildAndDownloadTasksExcel(options = {}) {
        try {
            await this.loadExcelJS();

            const response = await fetch('/DailyTasks/GetAllTasksForExport');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'שגיאה בטעינת משימות');
            }

            const allTasks = result.tasks || [];

            let fromDate = null;
            let toDate = null;
            let sheetTitle = 'כל המשימות';
            let fileName =
                `Tasks_All_${new Date().toISOString().slice(0, 10)}.xlsx`;

            if (options.type === 'range') {
                fromDate = new Date(options.from);
                toDate = new Date(options.to);
                toDate.setHours(23, 59, 59, 999);
                sheetTitle =
                    `משימות ${options.fromDisplay} - ${options.toDisplay}`;
                fileName =
                    `Tasks_${options.from}_to_${options.to}.xlsx`;
            }

            const rows = this._buildExportRows(allTasks, fromDate, toDate);

            if (rows.length === 0) {
                NotificationManager.show(
                    'לא נמצאו משימות לייצוא בטווח שנבחר',
                    'warning'
                );
                return;
            }

            //חדש: בניית קובץ עם גליון לכל יום
            await this._writeExcelFile(rows, sheetTitle, fileName);

            NotificationManager.show(
                `הקובץ יוצא בהצלחה! ${rows.length} שורות`,
                'success'
            );

        } catch (error) {
            console.error('שגיאה בייצוא משימות:', error);
            NotificationManager.show('שגיאה בייצוא: ' + error.message, 'error');
        }
    }

    // -------------------------------------------------------
    // בניית שורות הנתונים לאקסל
    // כל שורה = משימה ביום מסוים
    // -------------------------------------------------------
    _buildExportRows(allTasks, fromDate, toDate) {
        const rows = [];
        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

        allTasks.forEach(task => {
            // ── קבע את טווח התאריכים הרלוונטי למשימה ──────────────
            const taskCreated = new Date(task.createdAt);
            taskCreated.setHours(0, 0, 0, 0);

            const taskDeleted = task.isDeleted && task.deletionDate
                ? new Date(task.deletionDate)
                : null;
            if (taskDeleted) taskDeleted.setHours(23, 59, 59, 999);

            // ── קבע את טווח הסריקה ──────────────────────────────────
            const scanFrom = fromDate
                ? new Date(Math.max(fromDate.getTime(), taskCreated.getTime()))
                : new Date(taskCreated);

            const scanTo = toDate
                ? (taskDeleted
                    ? new Date(Math.min(toDate.getTime(), taskDeleted.getTime()))
                    : new Date(toDate))
                : (taskDeleted
                    ? new Date(taskDeleted)
                    : new Date()); // עד היום אם לא נמחקה

            scanTo.setHours(23, 59, 59, 999);

            if (scanFrom > scanTo) return; // אין טווח תקין

            // ── סרוק כל יום בטווח ───────────────────────────────────
            const current = new Date(scanFrom);
            current.setHours(0, 0, 0, 0);

            while (current <= scanTo) {
                const dateStr = this._toIsoDate(current);
                const dayOfWeek = current.getDay();

                // בדוק אם המשימה רלוונטית ליום זה
                const relevantDays = this._getRelevantDaysForDate(task, dateStr);
                const isScheduledDay = !relevantDays ||
                    relevantDays.length === 0 ||
                    relevantDays.includes(dayOfWeek);

                const hasHistory = this.taskHasHistoryForDate(task, dateStr);

                if (!isScheduledDay && !hasHistory) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }

                // ── נתוני הסטטוס ליום זה ────────────────────────────
                const isCompleted = task.completionDates &&
                    task.completionDates.includes(dateStr);
                const skipReason = task.skipReasons &&
                    task.skipReasons[dateStr];
                const skipUserName = task.skipUserNames &&
                    task.skipUserNames[dateStr];
                const completedBy = task.completedByEmployees &&
                    task.completedByEmployees[dateStr];
                const completionTime = task.completionTimes &&
                    task.completionTimes[dateStr];
                const skipTime = task.skipTimes &&
                    task.skipTimes[dateStr];

                // ── הערות ליום זה ────────────────────────────────────
                const notesForDay = (task.notesByDate && task.notesByDate[dateStr])
                    ? task.notesByDate[dateStr]
                    : [];
                const notesText = notesForDay
                    .map(n => `[${n.time || ''} ${n.userName || ''}]: ${n.text || ''}`)
                    .join('\n');

                // ── סטטוס ────────────────────────────────────────────
                let status = 'ממתין';
                if (isCompleted) status = 'הושלם';
                else if (skipReason) status = 'לא בוצע';

                // ── עדיפות בעברית ────────────────────────────────────
                const priorityMap = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
                const priorityHe = priorityMap[task.priority] || task.priority || '';

                // ── שעת ביצוע ────────────────────────────────────────
                const execTime = (task.taskHour && task.taskMinute)
                    ? `${task.taskHour}:${task.taskMinute}`
                    : '';

                // ── ימי ביצוע ────────────────────────────────────────
                const daysText = relevantDays && relevantDays.length > 0 && relevantDays.length < 7
                    ? relevantDays.sort((a, b) => a - b)
                        .map(d => dayNames[d])
                        .join(', ')
                    : 'כל ימות השבוע';

                rows.push({
                    date: dateStr,
                    dayName: dayNames[dayOfWeek],
                    taskTitle: task.title || '',
                    taskDescription: task.description || '',
                    priority: priorityHe,
                    execTime: execTime,
                    daysOfWeek: daysText,
                    status: status,
                    completedBy: completedBy || '',
                    completionTime: completionTime || '',
                    skipReason: skipReason || '',
                    skipUserName: skipUserName || '',
                    skipTime: skipTime || '',
                    notes: notesText,
                    isScheduledDay: isScheduledDay,
                    hasAlarm: task.enableAlarm !== false && !!execTime,
                });

                current.setDate(current.getDate() + 1);
            }
        });

        // ── מיון לפי תאריך ואז שם משימה ────────────────────────────
        rows.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.taskTitle.localeCompare(b.taskTitle, 'he');
        });

        return rows;
    }

    // -------------------------------------------------------
    // קבלת ימי הביצוע הרלוונטיים לתאריך מסוים
    // -------------------------------------------------------
    _getRelevantDaysForDate(task, dateStr) {
        const selectedDate = new Date(dateStr);
        selectedDate.setHours(0, 0, 0, 0);

        let relevantDays = task.daysOfWeek || [0, 1, 2, 3, 4, 5, 6];

        if (task.daysOfWeekHistory && task.daysOfWeekHistory.length > 0) {
            const sortedHistory = [...task.daysOfWeekHistory].sort(
                (a, b) => new Date(a.changeDate) - new Date(b.changeDate)
            );

            for (let i = sortedHistory.length - 1; i >= 0; i--) {
                const changeDate = new Date(sortedHistory[i].changeDate);
                changeDate.setHours(0, 0, 0, 0);

                if (changeDate <= selectedDate) {
                    relevantDays = sortedHistory[i].newDays;
                    break;
                } else if (i === 0) {
                    relevantDays = sortedHistory[0].oldDays;
                }
            }
        }

        return relevantDays;
    }

    // -------------------------------------------------------
    // כתיבת קובץ האקסל
    // -------------------------------------------------------

    // ── כתיבת קובץ האקסל - מעודכן עם גליון לכל יום ──
    async _writeExcelFile(rows, sheetTitle, fileName) {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'NOC Portal';
        wb.created = new Date();

        // ── צבעים ──────────────────────────────────────────────────────
        const C = {
            headerBg: '320F5B',
            headerFont: 'FFFFFF',
            subHeaderBg: '667eea',
            subHeaderFont: 'FFFFFF',
            completedBg: 'E8F5E9',
            completedBorder: '28A745',
            skippedBg: 'FFF3CD',
            skippedBorder: 'FFC107',
            pendingBg: 'FFFFFF',
            altBg: 'F8F9FF',
            historyOnlyBg: 'FFF9E6',
            borderColor: 'D0D5DD',
            completedFont: '1B5E20',
            skippedFont: '856404',
            pendingFont: '334155',
        };

        const totalCols = 14;

        // ── פונקציות עזר ───────────────────────────────────────────────
        const thinBorder = () => ({
            top: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            bottom: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            left: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            right: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
        });

        const mediumTopBorder = () => ({
            top: { style: 'medium', color: { argb: 'FF' + C.borderColor } },
            bottom: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            left: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            right: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
        });

        const applyStyle = (cell, {
            bgColor = null,
            fontColor = '000000',
            bold = false,
            hAlign = 'center',
            fontSize = 10,
            wrapText = false,
            italic = false,
        } = {}) => {
            cell.font = {
                name: 'Arial',
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

        const colWidths = [14, 10, 30, 30, 12, 14, 28, 12, 16, 14, 28, 16, 14, 35];

        const headers = [
            'תאריך', 'יום', 'שם משימה', 'תיאור', 'עדיפות',
            'שעת ביצוע', 'ימי ביצוע', 'סטטוס', 'בוצע ע"י',
            'שעת השלמה', 'סיבת אי ביצוע', 'לא בוצע ע"י',
            'שעת אי ביצוע', 'הערות',
        ];

        // ── פונקציה לכתיבת כותרות גליון ──────────────────────────────
        const writeSheetHeaders = (ws, title) => {
            ws.views = [{
                rightToLeft: true,
                state: 'frozen',
                ySplit: 2
            }];
            ws.properties = { defaultRowHeight: 18 };

            // שורה 1 - כותרת ראשית
            ws.mergeCells(1, 1, 1, totalCols);
            const titleCell = ws.getCell(1, 1);
            titleCell.value = title;
            applyStyle(titleCell, {
                bgColor: C.headerBg,
                fontColor: C.headerFont,
                bold: true,
                hAlign: 'center',
                fontSize: 14,
            });
            ws.getRow(1).height = 30;

            // שורה 2 - כותרות עמודות
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
        };

        // ── פונקציה לכתיבת שורת נתונים ───────────────────────────────
        const writeDataRow = (ws, row, excelRow, rowBg, fontColor) => {
            const dateDisplay = row.date
                ? row.date.split('-').reverse().join('/')
                : '';

            const rowData = [
                dateDisplay,
                row.dayName,
                row.taskTitle,
                row.taskDescription,
                row.priority,
                row.execTime,
                row.daysOfWeek,
                row.status,
                row.completedBy,
                row.completionTime,
                row.skipReason,
                row.skipUserName,
                row.skipTime,
                row.notes,
            ];

            rowData.forEach((val, colIdx) => {
                const cell = ws.getCell(excelRow, colIdx + 1);
                cell.value = val || '';

                applyStyle(cell, {
                    bgColor: rowBg,
                    fontColor: fontColor,
                    hAlign: (colIdx === 2 || colIdx === 3 ||
                        colIdx === 6 || colIdx === 13)
                        ? 'right' : 'center',
                    wrapText: (colIdx === 2 || colIdx === 3 ||
                        colIdx === 6 || colIdx === 10 ||
                        colIdx === 13),
                    fontSize: 10,
                });

                // עמודת סטטוס - צבע מיוחד
                if (colIdx === 7) {
                    let statusBg, statusFont;
                    if (val === 'הושלם') {
                        statusBg = '28A745'; statusFont = 'FFFFFF';
                    } else if (val === 'לא בוצע') {
                        statusBg = 'FFC107'; statusFont = '212529';
                    } else {
                        statusBg = '6C757D'; statusFont = 'FFFFFF';
                    }
                    applyStyle(cell, {
                        bgColor: statusBg,
                        fontColor: statusFont,
                        bold: true,
                        hAlign: 'center',
                        fontSize: 10,
                    });
                }

                // עמודת שם משימה - מודגש
                if (colIdx === 2 && val) {
                    cell.font = {
                        name: 'Arial',
                        size: 10,
                        bold: true,
                        color: { argb: 'FF' + fontColor },
                    };
                }

                // עמודת עדיפות - צבע לפי ערך
                if (colIdx === 4 && val) {
                    let priorityColor = '667EEA';
                    if (val === 'גבוהה') priorityColor = 'DC3545';
                    else if (val === 'בינונית') priorityColor = 'FFA502';
                    else if (val === 'נמוכה') priorityColor = '28A745';

                    cell.font = {
                        name: 'Arial',
                        size: 10,
                        bold: true,
                        color: { argb: 'FF' + priorityColor },
                    };
                }
            });

            //רוחב עמודות מותאם לתוכן
            rowData.forEach((val, colIdx) => {
                if (val) {
                    const col = ws.getColumn(colIdx + 1);
                    const contentLen = String(val).length;
                    const currentWidth = col.width || colWidths[colIdx];
                    // הגדל רוחב אם התוכן ארוך, עד מקסימום 60
                    col.width = Math.min(
                        60,
                        Math.max(currentWidth, contentLen * 1.1)
                    );
                }
            });

            // חישוב גובה שורה דינמי לפי אורך התוכן
            // עמודות עם wrapText שיכולות להגדיל את גובה השורה
            const wrappedColumns = [
                { val: row.taskTitle, width: colWidths[2] },  // שם משימה
                { val: row.taskDescription, width: colWidths[3] },  // תיאור
                { val: row.daysOfWeek, width: colWidths[6] },  // ימי ביצוע
                { val: row.skipReason, width: colWidths[10] },  // סיבת אי ביצוע
                { val: row.notes, width: colWidths[13] },  // הערות
            ];

            // חשב כמה שורות טקסט נדרשות לכל עמודה
            const LINE_HEIGHT = 15; // גובה שורת טקסט בסיסית בפיקסלים
            const MIN_HEIGHT = 17; // גובה מינימלי
            const MAX_HEIGHT = 120; // גובה מקסימלי

            let maxLines = 1;

            wrappedColumns.forEach(({ val, width }) => {
                if (!val) return;

                const text = String(val);
                const charsPerLine = Math.floor(width * 1.8); // הערכת תווים לשורה לפי רוחב עמודה

                // ספור שורות חדשות ידניות (\n)
                const manualLines = text.split('\n');

                // חשב כמה שורות נדרשות לכל פסקה
                let totalLines = 0;
                manualLines.forEach(line => {
                    const linesNeeded = Math.ceil(line.length / charsPerLine) || 1;
                    totalLines += linesNeeded;
                });

                if (totalLines > maxLines) {
                    maxLines = totalLines;
                }
            });

            // קבע גובה שורה לפי מספר השורות המקסימלי
            const calculatedHeight = Math.min(
                MAX_HEIGHT,
                Math.max(MIN_HEIGHT, maxLines * LINE_HEIGHT)
            );

            ws.getRow(excelRow).height = calculatedHeight;
        };

        // ── פונקציה לכתיבת שורת סיכום ────────────────────────────────
        const writeSummaryRow = (ws, excelRow, rowsForSheet) => {
            ws.mergeCells(excelRow, 1, excelRow, totalCols);
            const summaryCell = ws.getCell(excelRow, 1);

            const completedCount =
                rowsForSheet.filter(r => r.status === 'הושלם').length;
            const skippedCount =
                rowsForSheet.filter(r => r.status === 'לא בוצע').length;
            const pendingCount =
                rowsForSheet.filter(r => r.status === 'ממתין').length;

            summaryCell.value =
                `סה"כ: ${rowsForSheet.length} שורות | ` +
                `הושלמו: ${completedCount} | ` +
                `לא בוצעו: ${skippedCount} | ` +
                `ממתינות: ${pendingCount}`;

            applyStyle(summaryCell, {
                bgColor: C.headerBg,
                fontColor: C.headerFont,
                bold: true,
                hAlign: 'center',
                fontSize: 11,
            });
            ws.getRow(excelRow).height = 22;
        };

        // ── פונקציה לכתיבת גליון ─────────────────────────────────────
        const writeWorksheet = (ws, rowsForSheet, title) => {
            writeSheetHeaders(ws, title);

            let excelRow = 3;
            let prevDate = '';
            let isAlt = false;

            rowsForSheet.forEach(row => {
                //שמור prevDate לפני עדכון לבדיקת גבול
                const isNewDate = row.date !== prevDate;

                if (isNewDate) {
                    isAlt = !isAlt;
                    prevDate = row.date;
                }

                // קבע צבעי שורה לפי סטטוס
                let rowBg, fontColor;
                if (row.status === 'הושלם') {
                    rowBg = C.completedBg; fontColor = C.completedFont;
                } else if (row.status === 'לא בוצע') {
                    rowBg = C.skippedBg; fontColor = C.skippedFont;
                } else {
                    rowBg = isAlt ? C.altBg : C.pendingBg;
                    fontColor = C.pendingFont;
                }

                if (!row.isScheduledDay) {
                    rowBg = C.historyOnlyBg;
                }

                writeDataRow(ws, row, excelRow, rowBg, fontColor);

                //גבול עבה בין תאריכים שונים
                if (isNewDate && excelRow > 3) {
                    for (let c = 1; c <= totalCols; c++) {
                        ws.getCell(excelRow, c).border = mediumTopBorder();
                    }
                }

                excelRow++;
            });

            writeSummaryRow(ws, excelRow, rowsForSheet);
        };

        // ── 1. גליון "הכל" ────────────────────────────────────────────
        const wsAllName = sheetTitle
            .replace(/[*?:\\/\[\]]/g, '-')
            .substring(0, 31);

        const wsAll = wb.addWorksheet(wsAllName, {
            views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
            properties: { defaultRowHeight: 18 },
        });

        writeWorksheet(wsAll, rows, sheetTitle);

        // ── 2. גליון לכל יום ─────────────────────────────────────────
        // קבץ שורות לפי תאריך
        const rowsByDate = {};
        rows.forEach(row => {
            if (!rowsByDate[row.date]) {
                rowsByDate[row.date] = [];
            }
            rowsByDate[row.date].push(row);
        });

        // מיין תאריכים
        const sortedDates = Object.keys(rowsByDate).sort();

        sortedDates.forEach(dateStr => {
            const rowsForDay = rowsByDate[dateStr];

            // שם הגליון: dd/mm/yyyy -> dd-mm-yyyy (תווים לא חוקיים)
            const dateDisplay = dateStr.split('-').reverse().join('-');
            const dayName = rowsForDay[0]?.dayName || '';

            // שם גליון: "01-01-2025 ראשון" (מקסימום 31 תווים)
            const wsName = `${dateDisplay} ${dayName}`.substring(0, 31);

            const wsDayTitle =
                `משימות ליום ${dateDisplay} (${dayName})`;

            const wsDay = wb.addWorksheet(wsName, {
                views: [{
                    rightToLeft: true,
                    state: 'frozen',
                    ySplit: 2
                }],
                properties: { defaultRowHeight: 18 },
            });

            writeWorksheet(wsDay, rowsForDay, wsDayTitle);
        });

        // ── הורד את הקובץ ────────────────────────────────────────────
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        saveAs(blob, fileName);
    }

    // Get Hebrew day name
    getHebrewDayName(dateString) {
        const date = new Date(dateString);
        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        return `יום ${dayNames[date.getDay()]}`;
    }

    // Check if date is today
    isToday(dateString) {
        const date = new Date(dateString);
        const today = new Date();

        date.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        return date.getTime() === today.getTime();
    }

    // Update day display and today button
    updateDateDisplay() {
        // Update day name
        const dayNameElement = document.getElementById('currentDayName');
        if (dayNameElement) {
            const dayName = this.getHebrewDayName(this.currentTaskDate);
            const formattedDate = this.formatDate(this.currentTaskDate);

            if (this.isToday(this.currentTaskDate)) {
                dayNameElement.innerHTML = `<strong>${dayName}</strong> - ${formattedDate} <span class="today-badge">היום</span>`;
            } else {
                dayNameElement.innerHTML = `<strong>${dayName}</strong> - ${formattedDate}`;
            }
        }

        // Show/hide today button
        const todayBtn = document.querySelector('.today-btn');
        if (todayBtn) {
            if (this.isToday(this.currentTaskDate)) {
                todayBtn.style.display = 'none';
            } else {
                todayBtn.style.display = 'inline-flex';
            }
        }
    }

    // Auto refresh data
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            if (!this.isModalOpen && this.currentTaskDate) {
                // שמור את הפילטרים והמיון הנוכחיים
                const currentFilters = { ...this.activeFilters };
                const currentSort = this.currentSort;
                const hasFilters = this.hasActiveFilters();

                // טען מחדש את המשימות
                await this.loadTasksForDate(this.currentTaskDate);

                // החזר את הפילטרים והמיון
                this.activeFilters = currentFilters;
                this.currentSort = currentSort;

                // החל מחדש את הפילטרים אם היו פעילים
                if (hasFilters) {
                    this.applyFilters();
                }
            }
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}
