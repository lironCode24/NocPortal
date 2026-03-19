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
            // פתח את מודל בחירת העובד
            await this.openEmployeeSelectionModal(taskId);
            NotificationManager.show('בחר עובד לסימון המשימה כבוצעה', 'info');
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
        this.isModalOpen = true;
        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('completionTaskId').value = taskId;
        document.getElementById('completionTaskTitle').textContent = task.title;

        // Populate employee dropdown
        await this.populateEmployeeSelect('completionEmployeeName');

        document.getElementById('employeeCompletionModal').style.display = 'block';
        document.body.style.overflow = 'hidden';
    }

    // Open skip reason modal
    async openSkipReasonModal(taskId) {
        if (this.isDateInPast(this.currentTaskDate)) {
            NotificationManager.show('לא ניתן לסמן משימה כלא בוצעה בתאריך שעבר', 'warning');
            return;
        }
        this.isModalOpen = true;

        const task = this.dailyTasks.find(t => t.id === taskId);
        if (!task) return;

        document.getElementById('skipTaskId').value = taskId;
        document.getElementById('skipTaskTitle').textContent = task.title;
        document.getElementById('skipReasonSelect').value = '';
        document.getElementById('skipReasonCustom').value = '';

        // Populate employee dropdown for skip reason
        await this.populateEmployeeSelect('skipUserName');

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
        const userNameSelect = document.getElementById('noteUserName');
        if (userNameSelect && noteToEdit.userName) {
            userNameSelect.value = noteToEdit.userName;
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

        // Reset edit mode
        document.getElementById('noteEditIndex').value = '';
        document.getElementById('noteModalTitle').textContent = 'הוסף הערה';
        document.getElementById('noteSubmitBtn').textContent = 'הוסף הערה';

        // Populate employee dropdown for notes
        this.populateEmployeeSelect('noteUserName');

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
        var selectedDays = task.daysOfWeek
            .sort((a, b) => a - b) // Sort by day number
            .map(day => dayNames[day])
            .join(', ');

        if (!task.daysOfWeek || task.daysOfWeek.length === 0 || task.daysOfWeek.length === 7) {
            selectedDays = 'כל ימות השבוע'
        }

        return `<span class="task-days-badge" title="ימי ביצוע: ${selectedDays}">
        <i class="fas fa-calendar-week"></i> ${selectedDays}
    </span>`;
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
