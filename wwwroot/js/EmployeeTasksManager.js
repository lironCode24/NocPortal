class EmployeeTasksManager {
    constructor() {
        this.employees = [];
        this.employeeTasks = [];
        this.currentEmployee = '';

        const today = new Date();
        this.currentDate = today.toISOString().split('T')[0];

        this.activeFilters = { // Track active filters
            status: '',
            priority: '',
            condition: '',
            progress: ''
        };
        this.currentSort = 'default';
        this.dueDatePicker = null;
        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;
    }

    initializeDatePickers() {
        this.dueDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#employeeTaskDueDateHidden",
            (selectedDates, dateStr) => {
                const formattedDate = FlatpickrHelper.formatDateToDisplay(dateStr);
                document.getElementById('employeeTaskDueDate').value = formattedDate;
            }
        );
    }

    initializeEmployeeTasksDatePicker() {
        const employeeTasksDatePicker = FlatpickrHelper.initHebrewDatePicker(
            "#employeeTasksDateHidden",
            (selectedDates, dateStr) => {
                if (dateStr) {
                    this.currentDate = dateStr;
                    const formattedDate = FlatpickrHelper.formatDateToDisplay(dateStr);
                    document.getElementById('employeeTasksDate').value = formattedDate;
                    this.loadEmployeeTasks();
                }
            }
        );

        // עדכן את פונקציית openDatePicker
        this.openDatePicker = function () {
            if (employeeTasksDatePicker) {
                employeeTasksDatePicker.open();
            }
        };
    }

    // Initialize employee tasks
    async initialize() {
        this.setTodayDate();
        await this.loadEmployees();
        this.clearFilterButton();
        this.initializeDatePickers();
        this.initializeEmployeeTasksDatePicker();
        this.startAutoRefresh();
    }

    // Load employees list
    async loadEmployees() {
        try {
            const response = await fetch('/EmployeeTasks/GetEmployees');
            const data = await response.json();

            if (data.error) {
                console.error('Error loading employees:', data.error);
                return;
            }

            this.employees = data;
            this.populateEmployeeSelect();
        } catch (error) {
            console.error('Error fetching employees:', error);
        }
    }

    // Populate employee select dropdown
    populateEmployeeSelect() {
        const select = document.getElementById('employeeSelect');
        select.innerHTML = '<option value="">בחר עובד...</option>';

        // Add "All Employees" option
        const allOption = document.createElement('option');
        allOption.value = 'ALL_EMPLOYEES';
        allOption.textContent = 'כל העובדים';
        allOption.setAttribute("selected", "selected");
        select.appendChild(allOption);

        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.id;
            option.textContent = employee.name;
            select.appendChild(option);
        });
        this.loadEmployeeTasks();
    }

    // Load tasks for selected employee
    async loadEmployeeTasks() {
        const employeeId = document.getElementById('employeeSelect').value;

        if (!employeeId || !this.currentDate) {
            this.currentEmployee = 'ALL_EMPLOYEES';
        } else {
            this.currentEmployee = employeeId;
        }

        try {
            const response = await fetch(`/EmployeeTasks/GetEmployeeTasks?employeeId=${employeeId}&date=${this.currentDate}`);
            const data = await response.json();

            if (data.error) {
                console.error('Error loading employee tasks:', data.error);
                this.displayEmptyState();
                return;
            }

            this.employeeTasks = data.tasks || [];
            this.displayEmployeeTasks();
            this.updateEmployeeProgress();
        } catch (error) {
            console.error('Error fetching employee tasks:', error);
            this.displayEmptyState();
        }
    }

    // Display employee tasks
    displayEmployeeTasks() {
        const container = document.getElementById('employeeTasksContainer');
        const progressSummary = document.getElementById('employeeProgressSummary');
        const section = document.querySelector('.employee-tasks-section');

        if (this.employeeTasks.length === 0) {
            container.innerHTML = `
        <div class="employee-tasks-empty">
            <i class="fas fa-clipboard-list"></i><br>
            אין משימות לעובד זה בתאריך הנבחר
        </div>`;
            progressSummary.style.display = 'none';
            if (section) section.classList.remove('has-scroll');
            return;
        }

        progressSummary.style.display = 'flex';

        // החל סינון ומיון
        let filteredTasks = this.filterTasks(this.employeeTasks);
        filteredTasks = this.sortTasks(filteredTasks);

        // הוסף מונה משימות
        const tasksHTML = `
        <div class="employee-tasks-counter">
            <span>מציג <strong>${filteredTasks.length}</strong> משימות</span>
            ${filteredTasks.length > 10 ?
                '<span class="scroll-hint"><i class="fas fa-arrow-down"></i> גלול למטה לעוד משימות</span>' :
                ''}
        </div>
        <div class="employee-tasks-list">
            ${filteredTasks.map(task => this.createEmployeeTaskHTML(task)).join('')}
        </div>`;

        container.innerHTML = tasksHTML;

        // הוסף אינדיקטור scroll אם יש יותר מ-10 משימות
        if (filteredTasks.length > 10 && section) {
            section.classList.add('has-scroll');
            this.setupScrollIndicators();
        } else if (section) {
            section.classList.remove('has-scroll');
        }
    }

    // Setup scroll indicators
    setupScrollIndicators() {
        const container = document.getElementById('employeeTasksContainer');
        const section = document.querySelector('.employee-tasks-section');
        if (!container) return;

        // הסר listeners קיימים
        if (this.handleScroll) {
            container.removeEventListener('scroll', this.handleScroll);
        }

        // הסר כפתור קיים אם יש
        const existingBtn = container.querySelector('.employee-back-to-top');
        if (existingBtn) {
            existingBtn.remove();
        }

        // צור כפתור חזרה למעלה
        const backToTopBtn = document.createElement('button');
        backToTopBtn.className = 'employee-back-to-top';
        backToTopBtn.innerHTML = '<i class="fas fa-arrow-up"></i> חזור למעלה';
        backToTopBtn.onclick = () => {
            container.scrollTo({ top: 0, behavior: 'smooth' });
        };

        // הוסף את הכפתור לתוך הקונטיינר
        container.appendChild(backToTopBtn);

        // הוסף listener חדש
        this.handleScroll = () => {
            const scrollHint = document.querySelector('.scroll-hint');

            // הסתר/הצג scroll hint
            if (scrollHint && container.scrollTop > 50) {
                scrollHint.style.display = 'none';
            } else if (scrollHint) {
                scrollHint.style.display = 'flex';
            }

            // הצג/הסתר כפתור חזרה למעלה
            if (container.scrollTop > 200) {
                backToTopBtn.classList.add('show');
            } else {
                backToTopBtn.classList.remove('show');
            }

            // בדוק אם הגענו לסוף - אם כן, הסר את has-scroll
            const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 10;
            if (isAtBottom && section) {
                section.classList.remove('has-scroll');
            } else if (section && container.scrollTop > 0) {
                section.classList.add('has-scroll');
            }
        };

        container.addEventListener('scroll', this.handleScroll);
    }

    // Add scroll indicator
    addScrollIndicator() {
        const tasksList = document.querySelector('.employee-tasks-list');
        if (!tasksList) return;

        let scrollTimeout;

        tasksList.addEventListener('scroll', function () {
            // הסר אינדיקטור קיים
            const existingIndicator = document.querySelector('.scroll-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }

            // בדוק אם הגענו לסוף
            const isAtBottom = tasksList.scrollHeight - tasksList.scrollTop <= tasksList.clientHeight + 50;

            if (!isAtBottom) {
                // הצג אינדיקטור
                const indicator = document.createElement('div');
                indicator.className = 'scroll-indicator';
                indicator.innerHTML = '<i class="fas fa-chevron-down"></i>';
                tasksList.parentElement.appendChild(indicator);

                // הסר אחרי 2 שניות
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    indicator.remove();
                }, 2000);
            }
        });
    }

    applyFilters() {
        // Get filter values
        this.activeFilters = {
            status: document.getElementById('filterStatus')?.value || '',
            priority: document.getElementById('filterPriority')?.value || '',
            condition: document.getElementById('filterCondition')?.value || '',
            progress: document.getElementById('filterProgress')?.value || ''
        };

        this.currentSort = document.getElementById('employeeTasksSort')?.value || 'default';

        // Apply filters
        this.displayEmployeeTasks();
        this.updateActiveFiltersDisplay();
    }

    // Check if any filters are active
    hasActiveFilters() {
        return this.activeFilters.status ||
            this.activeFilters.priority ||
            this.activeFilters.condition ||
            this.activeFilters.progress ||
            this.currentSort !== 'default';
    }

    clearFilterButton() {
        const clearBtn = document.querySelector('.employee-tasks-section .clear-filters-btn');
        if (clearBtn) {
            clearBtn.style.display = this.hasActiveFilters() ? 'inline-flex' : 'none';
        }
    }

    // Update active filters display with clickable tags
    updateActiveFiltersDisplay() {
        const display = document.getElementById('activeFiltersDisplay');
        if (!display) return;

        const filterTags = [];

        if (this.activeFilters.status) {
            const statusLabels = {
                'חדש': 'סטטוס: חדש',
                'בביצוע': 'סטטוס: בביצוע',
                'ממתין': 'סטטוס: ממתין',
                'בוצע': 'סטטוס: בוצע',
                'מבוטלת': 'סטטוס: מבוטלת'
            };
            filterTags.push(`
                <div class="filter-tag" onclick="employeeTasksManager.removeFilter('status')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> ${statusLabels[this.activeFilters.status]}
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
                <div class="filter-tag" onclick="employeeTasksManager.removeFilter('priority')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> ${priorityLabels[this.activeFilters.priority]}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.activeFilters.condition) {
            const conditionLabels = {
                'overdue': 'תאריך יעד: באיחור',
                'today': 'תאריך יעד: היום',
                'upcoming': 'תאריך יעד: עתידי',
                'no-due-date': 'תאריך יעד: ללא'
            };
            filterTags.push(`
                <div class="filter-tag" onclick="employeeTasksManager.removeFilter('condition')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> ${conditionLabels[this.activeFilters.condition]}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.activeFilters.progress) {
            const progressLabels = {
                'not-started': 'התקדמות: לא התחיל',
                'in-progress': 'התקדמות: בביצוע',
                'completed': 'התקדמות: הושלם'
            };
            filterTags.push(`
                <div class="filter-tag" onclick="employeeTasksManager.removeFilter('progress')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> ${progressLabels[this.activeFilters.progress]}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.currentSort !== 'default') {
            const sortLabels = {
                'status': 'מיון: סטטוס',
                'priority': 'מיון: עדיפות',
                'dueDate': 'מיון: תאריך יעד',
                'progress': 'מיון: התקדמות',
                'title': 'מיון: שם'
            };
            filterTags.push(`
                <div class="filter-tag" onclick="employeeTasksManager.removeFilter('sort')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> ${sortLabels[this.currentSort]}
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

    // Remove specific filter
    removeFilter(filterType) {
        switch (filterType) {
            case 'status':
                this.activeFilters.status = '';
                const statusFilter = document.getElementById('filterStatus');
                if (statusFilter) statusFilter.value = '';
                break;

            case 'priority':
                this.activeFilters.priority = '';
                const priorityFilter = document.getElementById('filterPriority');
                if (priorityFilter) priorityFilter.value = '';
                break;

            case 'condition':
                this.activeFilters.condition = '';
                const conditionFilter = document.getElementById('filterCondition');
                if (conditionFilter) conditionFilter.value = '';
                break;

            case 'progress':
                this.activeFilters.progress = '';
                const progressFilter = document.getElementById('filterProgress');
                if (progressFilter) progressFilter.value = '';
                break;

            case 'sort':
                this.currentSort = 'default';
                const sortSelect = document.getElementById('employeeTasksSort');
                if (sortSelect) sortSelect.value = 'default';
                break;
        }

        // Re-apply filters
        this.applyFilters();

        NotificationManager.show('הסינון הוסר', 'info');
    }

    filterTasks(tasks) {
        let filtered = [...tasks];

        // Filter by status
        const statusFilter = document.getElementById('filterStatus').value;
        if (statusFilter) {
            filtered = filtered.filter(task => task.status === statusFilter);
        }

        // Filter by priority
        const priorityFilter = document.getElementById('filterPriority').value;
        if (priorityFilter) {
            filtered = filtered.filter(task => task.priority === priorityFilter);
        }

        // Filter by condition
        const conditionFilter = document.getElementById('filterCondition').value;
        if (conditionFilter) {
            filtered = filtered.filter(task => {
                switch (conditionFilter) {
                    case 'overdue':
                        return this.isTaskOverdue(task);
                    case 'today':
                        return task.dueDate && this.isToday(task.dueDate);
                    case 'upcoming':
                        return task.dueDate && new Date(task.dueDate) > new Date() && !this.isToday(task.dueDate);
                    case 'no-due-date':
                        return !task.dueDate || task.dueDate === '';
                    default:
                        return true;
                }
            });
        }

        // Filter by progress
        const progressFilter = document.getElementById('filterProgress').value;
        if (progressFilter) {
            filtered = filtered.filter(task => {
                const progress = task.progress || 0;
                switch (progressFilter) {
                    case 'not-started':
                        return progress === 0;
                    case 'in-progress':
                        return progress > 0 && progress < 100;
                    case 'completed':
                        return progress === 100;
                    default:
                        return true;
                }
            });
        }

        return filtered;
    }

    clearFilters() {

        // Reset filter selects
        const statusFilter = document.getElementById('filterStatus');
        const priorityFilter = document.getElementById('filterPriority');
        const conditionFilter = document.getElementById('filterCondition');
        const progressFilter = document.getElementById('filterProgress');
        const sortSelect = document.getElementById('employeeTasksSort');

        if (statusFilter) statusFilter.value = '';
        if (priorityFilter) priorityFilter.value = '';
        if (conditionFilter) conditionFilter.value = '';
        if (progressFilter) progressFilter.value = '';
        if (sortSelect) sortSelect.value = 'default';

        // Reset internal state
        this.activeFilters = {
            status: '',
            priority: '',
            condition: '',
            progress: ''
        };
        this.currentSort = 'default';

        // Update display
        this.displayEmployeeTasks();
        this.updateActiveFiltersDisplay();

        NotificationManager.show('הסינונים נוקו', 'info');
    }

    isToday(dateString) {
        const date = new Date(dateString);
        const today = new Date();
        return date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear();
    }

    sortTasks(tasks) {
        const sorted = [...tasks];

        switch (this.currentSort) {
            case 'status':
                return sorted.sort((a, b) =>
                    this.getStatusOrder(a.status) - this.getStatusOrder(b.status)
                );
            case 'priority':
                return sorted.sort((a, b) =>
                    this.getPriorityOrder(a.priority) - this.getPriorityOrder(b.priority)
                );
            case 'dueDate':
                return sorted.sort((a, b) => {
                    const dateA = this.parseDueDate(a.dueDate);
                    const dateB = this.parseDueDate(b.dueDate);
                    return dateA - dateB;
                });
            case 'progress':
                return sorted.sort((a, b) => (b.progress || 0) - (a.progress || 0));
            case 'title':
                return sorted.sort((a, b) => a.title.localeCompare(b.title, 'he'));
            default:
                // ברירת המחדל תהיה מיון לפי תאריך יצירה מהחדש לישן
                return sorted.sort((a, b) => {
                    // בדיקה אם קיים שדה createdAt
                    if (a.createdAt && b.createdAt) {
                        return new Date(b.createdAt) - new Date(a.createdAt); // שינוי הסדר מ-b ל-a
                    }
                    // אם אין גם id, החזר את הסדר המקורי
                    return 0;
                });
        }
    }

    getStatusOrder(status) {
        const order = { 'חדש': 1, 'בביצוע': 2, 'ממתין': 3, 'בוצע': 4, 'מבוטלת': 5 };
        return order[status] || 0;
    }

    getPriorityOrder(priority) {
        const order = { 'high': 1, 'medium': 2, 'low': 3 };
        return order[priority] || 4;
    }

    parseDueDate(dueDate) {
        if (!dueDate) return new Date(9999, 11, 31);
        return new Date(dueDate);
    }

    isTaskOverdue(task) {
        if (!task.dueDate || task.progress >= 100) return false;
        if (task.status === 'בוצע' || task.status === 'מבוטלת') return false;
        return new Date(task.dueDate) < new Date();
    }

    // Create employee task HTML
    createEmployeeTaskHTML(task) {
        const isCompleted = task.completed || false;
        const completedTime = task.completedTime || '';
        const skipReason = task.skipReason || '';
        const isPastDate = this.isDateInPast(this.currentDate);
        const progress = task.progress || 0;
        const employee = this.employees.find(emp => emp.id === task.employeeId);
        const employeeName = employee ? employee.name : 'לא ידוע';
        const createdAt = task.createdAt ? this.formatDate(task.createdAt) : ''; // הוספת תאריך יצירה

        // Check if task is overdue
        const isOverdue = task.dueDate &&
            this.isDateInPast(task.dueDate) &&
            progress < 100;

        return `
        <div class="employee-task-item ${progress === 100 ? 'completed' : ''} ${skipReason ? 'skipped' : ''} ${isPastDate ? 'past-date' : ''} ${isOverdue ? 'overdue-task' : ''}"
             ondblclick="editEmployeeTask('${task.id}')">
             <div class="task-status-icon">
            ${isCompleted ? '<i class="fas fa-check-circle"></i>' :
                skipReason ? '<i class="fas fa-times-circle"></i>' :
                    isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' :
                        '<i class="fas fa-clock"></i>'}
            </div>
            
            <div class="task-priority ${task.priority}"></div>
            
            <div class="task-content">
                <div class="task-text ${isOverdue ? 'overdue-text' : ''}">${task.title}</div>
                
                ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
                ${completedTime ? `<div class="task-completed-time">הושלם ב: ${completedTime}</div>` : ''}
                ${skipReason ? `<div class="task-skip-reason">לא בוצע: ${skipReason}</div>` : ''}
                
                <div class="task-dates-container">
                    ${createdAt ? `
                        <div class="task-created-date">
                            <i class="fas fa-calendar-plus"></i>
                            נוצר ב: ${createdAt}
                        </div>
                    ` : ''}
                    ${task.dueDate ? `
                        <div class="task-due-date ${isOverdue ? 'overdue' : ''}">
                            <i class="fas fa-calendar-${isOverdue ? 'times' : 'check'}"></i>
                            תאריך יעד: ${this.formatDate(task.dueDate)}
                            ${isOverdue ? '<span class="overdue-badge"><i class="fas fa-exclamation-circle"></i>שים לב: תאריך יעד חלף</span>' : ''}
                        </div>
                    ` : ''}
                </div>
            
                <!-- Progress Bar -->
                <div class="employee-task-progress-container">
                    <span class="task-progress-label">התקדמות:</span>
                    <div class="employee-task-progress-bar">
                        <div class="employee-task-progress-fill ${progress === 100 ? 'completed' : progress >= 75 ? 'high-progress' : isOverdue ? 'overdue-progress' : ''}"
                            style="width: ${progress}%"></div>
                    </div>
                    <div class="task-progress-control">
                        <button type="button" class="progress-btn minus"
                            ondblclick="event.stopPropagation(); event.preventDefault()"
                            onclick="event.stopPropagation(); employeeTasksManager.decreaseProgress('${task.id}')"
                            ${isPastDate ? 'disabled' : ''}>-</button>
                        <input type="number" class="task-progress-input"
                            value="${progress}" min="0" max="100" step="5"
                            onchange="employeeTasksManager.updateTaskProgress('${task.id}', this.value)"
                            onblur="employeeTasksManager.updateTaskProgress('${task.id}', this.value)"
                            ondblclick="event.stopPropagation(); event.preventDefault()"
                            ${isPastDate ? 'disabled' : ''}>
                        <button type="button" class="progress-btn plus"
                            ondblclick="event.stopPropagation(); event.preventDefault()"
                            onclick="event.stopPropagation(); employeeTasksManager.increaseProgress('${task.id}')" 
                            ${isPastDate ? 'disabled' : ''}>+</button>
                    </div>
                    <span class="employee-task-progress-text">${progress}%</span>
                </div>
            </div>

        <div class="task-right-section">
            <div class="task-assigned-to">
                <i class="fas fa-user"></i>
                <span>משויך ל: <strong>${employeeName}</strong></span>
            </div>

            <div class="task-status">
                <label>סטטוס:</label>
                <select class="status-select ${isOverdue ? 'overdue-select' : ''}" data-task-id="${task.id}" onchange="employeeTasksManager.updateTaskStatus('${task.id}', this.value)">
                    <option value="חדש" ${task.status === 'חדש' ? 'selected' : ''}>חדש</option>
                    <option value="ממתין" ${task.status === 'ממתין' ? 'selected' : ''}>ממתין</option>
                    <option value="בביצוע" ${task.status === 'בביצוע' ? 'selected' : ''}>בביצוע</option>
                    <option value="בוצע" ${task.status === 'בוצע' ? 'selected' : ''}>בוצע</option>
                    <option value="מבוטלת" ${task.status === 'מבוטלת' ? 'selected' : ''}>מבוטלת</option>
                </select>
            </div>

            <div class="task-status-container">
                <div class="task-status-badge status-${task.status || 'חדש'} ${isOverdue ? 'overdue-badge-status' : ''}">
                    ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i> ' : ''}${task.status || 'חדש'}
                </div>
                ${task.status === 'בוצע' && task.completedTime ?
                `<div class="task-time-info">בוצע ב: ${task.completedTime}</div>` : ''}
                ${task.status === 'מבוטלת' && task.skipReason ?
                `<div class="task-skip-info">סיבה: ${task.skipReason}</div>` : ''}
            </div>
        </div>

        <div class="employee-task-actions">
            <button class="employee-task-edit-btn" onclick="editEmployeeTask('${task.id}')" title="ערוך משימה">
                <i class="fas fa-edit"></i>
            </button>
            <button class="employee-task-delete-btn" onclick="deleteEmployeeTask('${task.id}')" title="מחק משימה">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    </div>`;
    }

    increaseProgress(taskId) {
        const taskElement = document.querySelector(`.employee-task-item[ondblclick*="${taskId}"]`);
        if (!taskElement) return;

        const input = taskElement.querySelector('.task-progress-input');
        if (!input) return;

        let value = parseInt(input.value) || 0;

        // עלה לערך הבא בקפיצות של 20%
        if (value < 20) value = 20;
        else if (value < 40) value = 40;
        else if (value < 60) value = 60;
        else if (value < 80) value = 80;
        else value = 100;

        input.value = value;
        this.updateTaskProgress(taskId, value);
    }

    decreaseProgress(taskId) {
        const taskElement = document.querySelector(`.employee-task-item[ondblclick*="${taskId}"]`);
        if (!taskElement) return;

        const input = taskElement.querySelector('.task-progress-input');
        if (!input) return;

        let value = parseInt(input.value) || 0;

        // רד לערך הקודם בקפיצות של 20%
        if (value > 80) value = 80;
        else if (value > 60) value = 60;
        else if (value > 40) value = 40;
        else if (value > 20) value = 20;
        else value = 0;

        input.value = value;
        this.updateTaskProgress(taskId, value);
    }

    async updateTaskProgress(taskId, progress) {
        try {

            // Check if date is set
            if (!this.currentDate) {
                const today = new Date();
                this.currentDate = today.toISOString().split('T')[0];
            }

            const progressValue = Math.max(0, Math.min(100, parseInt(progress) || 0));

            // Find the task to get the correct employee ID
            const task = this.employeeTasks.find(t => t.id == taskId);
            if (!task) {
                console.error('Task not found:', taskId);
                alert('משימה לא נמצאה');
                return;
            }

            const requestData = {
                taskId: taskId,
                employeeId: task.employeeId,
                date: this.currentDate,
                progress: progressValue
            };

            const response = await fetch('/EmployeeTasks/UpdateTaskProgress', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });


            // Check if response has content
            const responseText = await response.text();

            if (!responseText) {
                console.error('Empty response from server');
                alert('תגובה ריקה מהשרת');
                return;
            }

            const result = JSON.parse(responseText);

            if (result.success) {
                task.progress = progressValue;

                // Always reload tasks to show updated progress
                let shouldReload = true;

                if (progressValue === 100 && task.status !== 'בוצע') {
                    await this.updateTaskStatus(taskId, 'בוצע');
                    shouldReload = false; // updateTaskStatus will reload
                } else if (progressValue > 0 && progressValue < 100 && (task.status === 'חדש' || task.status === 'בוצע')) {
                    await this.updateTaskStatus(taskId, 'בביצוע');
                    shouldReload = false; // updateTaskStatus will reload
                } else if (progressValue == 0 && task.status === 'בביצוע') {
                    await this.updateTaskStatus(taskId, 'חדש');
                    shouldReload = false; // updateTaskStatus will reload
                }

                // Reload if status wasn't changed
                if (shouldReload) {
                    await this.loadEmployeeTasks();
                }

                if (typeof showStatusMessage === 'function') {
                    // showStatusMessage(`התקדמות המשימה עודכנה ל: ${progressValue}%`);
                }
            } else {
                console.error('Update failed:', result.error);
                alert('שגיאה בעדכון התקדמות המשימה: ' + (result.error || 'שגיאה לא ידועה'));
            }
        } catch (error) {
            console.error('Exception in updateTaskProgress:', error);
            console.error('Error stack:', error.stack);
            alert('שגיאה בעדכון התקדמות המשימה: ' + error.message);
        }
    }

    async saveEmployeeTask(formData) {
        try {
            const isEdit = formData.taskId && formData.taskId !== '';
            const url = isEdit ? '/EmployeeTasks/UpdateTask' : '/EmployeeTasks/AddTask';

            const requestData = {
                ...(isEdit && { taskId: formData.taskId }),
                employeeId: formData.employeeId,
                date: formData.date,
                title: formData.title,
                description: formData.description,
                priority: formData.priority,
                dueDate: formData.dueDate,
                estimatedTime: formData.estimatedTime,
                progress: formData.progress || 0,
                createdAt: isEdit ? undefined : new Date().toISOString().split('T')[0]
            };


            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                closeAddEmployeeTaskModal();
                alert(isEdit ? 'המשימה עודכנה בהצלחה' : 'המשימה נוספה בהצלחה');
                await this.loadEmployeeTasks();
                return true;
            } else {
                console.error('Error saving task:', result.error);
                alert('שגיאה בשמירת המשימה: ' + (result.error || 'שגיאה לא ידועה'));
                return false;
            }
        } catch (error) {
            console.error('Error saving task:', error);
            alert('שגיאה בשמירת המשימה');
            return false;
        }
    }

    setTodayDate() {
        const today = new Date();
        const isoDate = today.toISOString().split('T')[0];

        this.currentDate = isoDate;

        const hiddenInput = document.getElementById('employeeTasksDateHidden');
        if (hiddenInput) {
            hiddenInput.value = isoDate;
        }

        const displayInput = document.getElementById('employeeTasksDate');
        if (displayInput) {
            const day = today.getDate().toString().padStart(2, '0');
            const month = (today.getMonth() + 1).toString().padStart(2, '0');
            const year = today.getFullYear();
            displayInput.value = `${day}/${month}/${year}`;
        }
    }

    // Update employee progress
    updateEmployeeProgress() {
        const totalTasks = this.employeeTasks.length;

        if (totalTasks === 0) {
            const progressSummary = document.getElementById('employeeProgressSummary');
            progressSummary.style.display = 'none';
            return;
        }

        // Calculate overall progress based on individual task progress
        const totalProgress = this.employeeTasks.reduce((sum, task) => {
            return sum + (task.progress || 0);
        }, 0);

        const averageProgress = Math.round(totalProgress / totalTasks);
        const completedTasks = this.employeeTasks.filter(task => (task.progress || 0) === 100).length;
        const inProgressTasks = this.employeeTasks.filter(task => {
            const progress = task.progress || 0;
            return progress > 0 && progress < 100;
        }).length;
        const notStartedTasks = this.employeeTasks.filter(task => !task.progress || task.progress === 0).length;

        const progressCircle = document.getElementById('employeeProgressCircle');
        const progressText = document.getElementById('employeeProgressText');
        const progressTitle = document.getElementById('employeeProgressTitle');
        const progressDescription = document.getElementById('employeeProgressDescription');

        const selectedEmployee = this.employees.find(emp => emp.id === this.currentEmployee);
        const employeeName = selectedEmployee ? selectedEmployee.name : 'כל העובדים';

        // Update progress circle
        progressCircle.style.setProperty('--progress', `${averageProgress * 3.6}deg`);
        progressText.textContent = `${averageProgress}%`;
        progressTitle.textContent = `התקדמות ${employeeName}`;

        // Create detailed description
        let descriptionParts = [];
        if (completedTasks > 0) descriptionParts.push(`${completedTasks} הושלמו`);
        if (inProgressTasks > 0) descriptionParts.push(`${inProgressTasks} בביצוע`);
        if (notStartedTasks > 0) descriptionParts.push(`${notStartedTasks} לא התחילו`);

        progressDescription.innerHTML = `
        <div>סה"כ ${totalTasks} משימות</div>
        <div style="font-size: 0.8em; color: #666; margin-top: 2px;">
            ${descriptionParts.join(' • ')}
        </div>
    `;

        // Update progress circle color based on average progress
        let circleColor;
        if (averageProgress === 100) {
            circleColor = `conic-gradient(#28a745 0deg, #28a745 360deg, #e9ecef 360deg, #e9ecef 360deg)`;
        } else if (averageProgress >= 75) {
            circleColor = `conic-gradient(#ffc107 0deg, #ffc107 ${averageProgress * 3.6}deg, #e9ecef ${averageProgress * 3.6}deg, #e9ecef 360deg)`;
        } else if (averageProgress >= 50) {
            circleColor = `conic-gradient(#17a2b8 0deg, #17a2b8 ${averageProgress * 3.6}deg, #e9ecef ${averageProgress * 3.6}deg, #e9ecef 360deg)`;
        } else {
            circleColor = `conic-gradient(#667eea 0deg, #667eea ${averageProgress * 3.6}deg, #e9ecef ${averageProgress * 3.6}deg, #e9ecef 360deg)`;
        }

        progressCircle.style.background = circleColor;

        // Show progress summary
        const progressSummary = document.getElementById('employeeProgressSummary');
        progressSummary.style.display = 'flex';
    }

    // Display empty state
    displayEmptyState() {
        const container = document.getElementById('employeeTasksContainer');
        const progressSummary = document.getElementById('employeeProgressSummary');
        const section = document.querySelector('.employee-tasks-section'); // הוסף זאת

        container.innerHTML = `
        <div class="employee-tasks-empty">
            <i class="fas fa-user-clock"></i><br>
            בחר עובד כדי לראות את המשימות שלו
        </div>`;

        progressSummary.style.display = 'none';

        // הסר את המחלקה has-scroll
        if (section) {
            section.classList.remove('has-scroll');
        }
    }

    // Date handling functions
    openDatePicker() {
        document.getElementById('employeeTasksDateHidden').showPicker();
    }

    // Helper methods
    isDateInPast(dateString) {
        const taskDate = new Date(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        taskDate.setHours(0, 0, 0, 0);
        return taskDate < today;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    filterEmployeeTasks(filterType) {
        let filteredTasks = this.employeeTasks;

        switch (filterType) {
            case 'completed':
                filteredTasks = this.employeeTasks.filter(task => task.completed);
                break;
            case 'pending':
                filteredTasks = this.employeeTasks.filter(task => !task.completed && !task.skipReason);
                break;
            case 'skipped':
                filteredTasks = this.employeeTasks.filter(task => task.skipReason);
                break;
            case 'high-priority':
                filteredTasks = this.employeeTasks.filter(task => task.priority === 'high');
                break;
            default:
                filteredTasks = this.employeeTasks;
        }

        // Update display with filtered tasks
        this.displayFilteredTasks(filteredTasks);
    }

    displayFilteredTasks(tasks) {
        const container = document.getElementById('employeeTasksContainer');

        if (tasks.length === 0) {
            container.innerHTML = `
            <div class="employee-tasks-empty">
                <i class="fas fa-filter"></i><br>
                אין משימות התואמות לפילטר הנבחר
            </div>`;
            return;
        }

        const tasksHTML = `
        <div class="employee-tasks-list">
            ${tasks.map(task => this.createEmployeeTaskHTML(task)).join('')}
        </div>`;

        container.innerHTML = tasksHTML;
    }


    // Get employee task data by ID
    getEmployeeTaskData(taskId) {
        return this.employeeTasks.find(task => task.id == taskId);
    }

    async deleteEmployeeTask(taskId) {
        try {
            const response = await fetch('/EmployeeTasks/DeleteTask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ taskId: taskId })
            });

            // Check if response has content before parsing JSON
            const responseText = await response.text();

            if (!responseText) {
                console.error('Empty response from server');
                alert('תגובה ריקה מהשרת');
                return false;
            }

            const result = JSON.parse(responseText);

            if (result.success) {
                // Reload tasks to show updated data
                await this.loadEmployeeTasks();
                alert('המשימה נמחקה בהצלחה');
                return true;
            } else {
                console.error('Error deleting task:', result.error);
                alert('שגיאה במחיקת המשימה: ' + result.error);
                return false;
            }
        } catch (error) {
            console.error('Error deleting task:', error);
            alert('שגיאה במחיקת המשימה');
            return false;
        }
    }

    async updateTaskStatus(taskId, newStatus) {
        try {
            // Find the task to get the correct employee ID
            const task = this.employeeTasks.find(t => t.id == taskId);
            if (!task) {
                console.error('Task not found:', taskId);
                alert('משימה לא נמצאה');
                return;
            }

            // קביעת אחוז התקדמות בהתאם לסטטוס החדש
            let progress = task.progress || 0;

            // אם הסטטוס הוא "בוצע", אחוז ההתקדמות צריך להיות 100%
            if (newStatus === 'בוצע') {
                progress = 100;
            }
            // אם הסטטוס השתנה מ"בוצע" ל"בביצוע", אחוז ההתקדמות לא יכול להישאר 100%
            else if (task.status === 'בוצע' && newStatus === 'בביצוע' && progress === 100) {
                progress = 75; // מגדירים ערך סביר של התקדמות לסטטוס "בביצוע"
            }
            // אם הסטטוס הוא "חדש", אחוז ההתקדמות צריך להיות 0
            else if (newStatus === 'חדש') {
                progress = 0;
            }

            const requestData = {
                taskId: taskId,
                employeeId: task.employeeId,
                date: this.currentDate,
                status: newStatus,
                completed: newStatus === 'בוצע',
                completedTime: newStatus === 'בוצע' ? new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : null,
                skipReason: newStatus === 'מבוטלת' ? 'מבוטלת' : null
            };

            const response = await fetch('/EmployeeTasks/UpdateTaskStatus', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                this.updateTaskProgress(taskId, progress);
                // Reload tasks to show updated status
                await this.loadEmployeeTasks();

                // Show status change message with התקדמות אם השתנתה
                if (typeof showStatusMessage === 'function') {
                    if (progress !== (task.progress || 0)) {
                        showStatusMessage(`סטטוס המשימה עודכן ל: ${newStatus} והתקדמות עודכנה ל-${progress}%`);
                    } else {
                        showStatusMessage(`סטטוס המשימה עודכן ל: ${newStatus}`);
                    }
                }
            } else {
                alert('שגיאה בעדכון סטטוס המשימה');
            }
        } catch (error) {
            console.error('Error in updateTaskStatus:', error);
            alert('שגיאה בעדכון סטטוס המשימה');
        }
    }

    // Auto refresh data
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            if (!this.isModalOpen && this.currentEmployee) {
                // שמור את הפילטרים והמיון הנוכחיים
                const currentFilters = { ...this.activeFilters };
                const currentSort = this.currentSort;

                // טען מחדש את המשימות
                await this.loadEmployeeTasks();

                // החזר את הפילטרים והמיון
                this.activeFilters = currentFilters;
                this.currentSort = currentSort;

                // החל מחדש את הפילטרים
                this.applyFilters();
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
        document.getElementById('employeeTaskDueDateHidden').value = '';
        document.getElementById('employeeTaskDueDate').value = '';
        document.getElementById('employeeTaskDueDateClear').style.display = 'none';
    }
}

// Update progress preview in modal
function updateProgressPreview(value) {
    const progressValue = Math.max(0, Math.min(100, parseInt(value) || 0));
    const previewFill = document.getElementById('progressPreviewFill');
    const previewText = document.getElementById('progressPreviewText');

    if (previewFill && previewText) {
        previewFill.style.width = progressValue + '%';
        previewText.textContent = progressValue + '%';

        // Update color based on progress
        if (progressValue === 100) {
            previewFill.style.background = 'linear-gradient(90deg, #28a745, #20c997)';
        } else if (progressValue >= 75) {
            previewFill.style.background = 'linear-gradient(90deg, #ffc107, #fd7e14)';
        } else {
            previewFill.style.background = 'linear-gradient(90deg, #667eea, #764ba2)';
        }
    }
}

// Edit employee task
function editEmployeeTask(taskId) {
    employeeTasksManager.isModalOpen = true;
    const taskData = employeeTasksManager.getEmployeeTaskData(taskId);

    if (!taskData) {
        alert('לא נמצאה משימה');
        return;
    }

    document.getElementById('employeeTaskId').value = taskId;
    document.getElementById('employeeTaskTitle').value = taskData.title;
    document.getElementById('employeeTaskDescription').value = taskData.description || '';
    document.getElementById('employeeTaskPriority').value = taskData.priority;

    // Set due date if exists
    if (taskData.dueDate) {
        document.getElementById('employeeTaskDueDateHidden').value = taskData.dueDate;
        handleDueDateChange(taskData.dueDate);
        document.getElementById('employeeTaskDueDateClear').style.display = 'inline-block';
    } else {
        document.getElementById('employeeTaskDueDateHidden').value = '';
        document.getElementById('employeeTaskDueDate').value = '';
        document.getElementById('employeeTaskDueDateClear').style.display = 'none';
    }

    document.getElementById('employeeTaskTime').value = taskData.estimatedTime || '';

    populateEmployeeSelectInModal();
    document.getElementById('selectedEmployeeSelect').value = taskData.employeeId || employeeTasksManager.currentEmployee;
    document.getElementById('assignedEmployeeId').value = taskData.employeeId || employeeTasksManager.currentEmployee;
    document.getElementById('employeeTaskAssignDate').value = employeeTasksManager.currentDate;

    document.getElementById('employeeTaskModalTitle').textContent = 'ערוך משימה';
    document.getElementById('employeeTaskSubmitBtn').textContent = 'עדכן משימה';

    document.body.style.overflow = 'hidden';
    document.getElementById('addEmployeeTaskModal').style.display = 'block';
}

// Update form submission handler
document.getElementById('addEmployeeTaskForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const formData = {
        taskId: document.getElementById('employeeTaskId').value,
        employeeId: document.getElementById('selectedEmployeeSelect').value,
        date: document.getElementById('employeeTaskDate').value,
        title: document.getElementById('employeeTaskTitle').value,
        description: document.getElementById('employeeTaskDescription').value,
        priority: document.getElementById('employeeTaskPriority').value,
        dueDate: getDueDate(),
        estimatedTime: getEstimatedTime()
        // progress: parseInt(document.getElementById('employeeTaskProgress').value) || 0
    };

    if (!formData.employeeId || formData.employeeId == "ALL_EMPLOYEES") {
        alert('אנא בחר עובד');
        return;
    }

    // Use the manager method
    employeeTasksManager.saveEmployeeTask(formData);
});

function showStatusMessage(message) {
    // Create or update status message element
    let statusMsg = document.getElementById('statusMessage');
    if (!statusMsg) {
        statusMsg = document.createElement('div');
        statusMsg.id = 'statusMessage';
        statusMsg.className = 'status-message';
        document.body.appendChild(statusMsg);
    }

    statusMsg.textContent = message;
    statusMsg.style.display = 'block';

    // Hide after 3 seconds
    setTimeout(() => {
        statusMsg.style.display = 'none';
    }, 3000);
}

// Populate employee select in modal
function populateEmployeeSelectInModal() {
    const modalSelect = document.getElementById('selectedEmployeeSelect');
    const mainSelect = document.getElementById('employeeSelect');

    // Clear existing options
    modalSelect.innerHTML = '<option value="">בחר עובד...</option>';

    // Copy options from main employee select
    for (let i = 1; i < mainSelect.options.length; i++) {
        const option = mainSelect.options[i];
        const newOption = document.createElement('option');
        newOption.value = option.value;
        newOption.textContent = option.textContent;
        modalSelect.appendChild(newOption);
    }
}

// Open add employee task modal
function openAddEmployeeTaskModal() {
    const selectedEmployee = document.getElementById('employeeSelect').value;

    if (!selectedEmployee) {
        alert('אנא בחר עובד תחילה');
        return;
    }

    employeeTasksManager.isModalOpen = true;
    // Reset form
    document.getElementById('addEmployeeTaskForm').reset();
    document.getElementById('employeeTaskId').value = '';

    // Clear due date fields
    document.getElementById('employeeTaskDueDateHidden').value = '';
    document.getElementById('employeeTaskDueDate').value = '';
    document.getElementById('employeeTaskDueDateClear').style.display = 'none';

    // Populate employee dropdown and set selected employee
    populateEmployeeSelectInModal();
    document.getElementById('selectedEmployeeSelect').value = selectedEmployee;
    document.getElementById('assignedEmployeeId').value = selectedEmployee;

    // Update modal title and button
    document.getElementById('employeeTaskModalTitle').textContent = 'הוסף משימה לעובד';
    document.getElementById('employeeTaskSubmitBtn').textContent = 'הוסף משימה';

    document.body.style.overflow = 'hidden';
    document.getElementById('addEmployeeTaskModal').style.display = 'block';
}

// Open due date picker
function openDueDatePicker() {
    if (employeeTasksManager && employeeTasksManager.dueDatePicker) {
        employeeTasksManager.dueDatePicker.open();
    }
}

// Handle due date change
function handleDueDateChange(isoDate) {
    if (isoDate) {
        const formattedDate = FlatpickrHelper.formatDateToDisplay(isoDate);
        document.getElementById('employeeTaskDueDate').value = formattedDate;
        document.getElementById('employeeTaskDueDateClear').style.display = 'inline-block';
    }
}

// Get due date
function getDueDate() {
    const dueDateInput = document.getElementById('employeeTaskDueDateHidden');
    return dueDateInput ? (dueDateInput.value || '') : '';
}

async function handleEmployeeTaskSubmit(event) {
    event.preventDefault();
    event.stopPropagation();

    const btn = event.target;
    btn.disabled = true;

    try {
        const form = document.getElementById('addEmployeeTaskForm');

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const employeeId = document.getElementById('selectedEmployeeSelect').value;

        // הוסף בדיקה אם נבחר עובד תקין
        if (!employeeId || employeeId === "ALL_EMPLOYEES") {
            alert('אנא בחר עובד');
            return;
        }
        const formData = {
            taskId: document.getElementById('employeeTaskId').value,
            employeeId: document.getElementById('selectedEmployeeSelect').value,
            date: document.getElementById('employeeTaskAssignDate').value, // תאריך המשימה
            title: document.getElementById('employeeTaskTitle').value,
            description: document.getElementById('employeeTaskDescription').value,
            priority: document.getElementById('employeeTaskPriority').value,
            dueDate: getDueDate(), // תאריך היעד
            estimatedTime: document.getElementById('employeeTaskTime').value,
            progress: 0
        };

        await employeeTasksManager.saveEmployeeTask(formData);

    } finally {
        btn.disabled = false;
    }
}

// Close add employee task modal
function closeAddEmployeeTaskModal() {
    employeeTasksManager.isModalOpen = false;
    // Restore background scroll
    document.body.style.overflow = '';

    document.getElementById('addEmployeeTaskModal').style.display = 'none';
}

// Form submission handler
document.getElementById('addEmployeeTaskForm').addEventListener('submit', function (e) {
    e.preventDefault();

    const formData = {
        taskId: document.getElementById('employeeTaskId').value,
        employeeId: document.getElementById('selectedEmployeeSelect').value,
        date: document.getElementById('employeeTaskDate').value,
        title: document.getElementById('employeeTaskTitle').value,
        description: document.getElementById('employeeTaskDescription').value,
        priority: document.getElementById('employeeTaskPriority').value,
        dueDate: getDueDate(),
        estimatedTime: document.getElementById('employeeTaskTime').value
    };

    if (!formData.employeeId || formData.employeeId == "ALL_EMPLOYEES") {
        alert('אנא בחר עובד');
        return;
    }

    employeeTasksManager.saveEmployeeTask(formData);
});

function getEstimatedTime() {
    return document.getElementById('employeeTaskTime').value || '';
}

// Handle employee selection change in modal
document.addEventListener('DOMContentLoaded', function () {
    const selectedEmployeeSelect = document.getElementById('selectedEmployeeSelect');
    if (selectedEmployeeSelect) {
        selectedEmployeeSelect.addEventListener('change', function () {
            document.getElementById('assignedEmployeeId').value = this.value;
        });
    }
});

// Clear employee task time selection
function clearEmployeeTaskTime() {
    document.getElementById('employeeTaskHour').value = '';
    document.getElementById('employeeTaskMinute').value = '';
}

// Delete employee task
function deleteEmployeeTask(taskId) {
    if (confirm('האם אתה בטוח שברצונך למחוק משימה זו?')) {
        employeeTasksManager.deleteEmployeeTask(taskId);
    }
}

// Enable/disable buttons based on employee selection
function updateEmployeeTaskButtons() {
    const selectedEmployee = document.getElementById('employeeSelect').value;
    const addBtn = document.getElementById('addEmployeeTaskBtn');

    if (selectedEmployee && addBtn) {
        addBtn.disabled = false;
    } else {
        if (addBtn) addBtn.disabled = true;
    }
}

function toggleFilterSection(section) {

    if (section === 'employeeFilters') {
        const content = document.getElementById('employeeFiltersContent');
        const btn = document.getElementById('employeeFiltersCollapseBtn');

        content.classList.toggle('collapsed');
        btn.classList.toggle('collapsed');

        // Update filters display when collapsing
        if (content.classList.contains('collapsed')) {
            updateFiltersDisplay();
        }

        localStorage.setItem('employeeFiltersSectionCollapsed', content.classList.contains('collapsed'));
    } else {
        const content = document.getElementById(section === 'filters' ? 'filtersContent' : 'sortContent');
        const btn = document.getElementById(section === 'filters' ? 'filtersCollapseBtn' : 'sortCollapseBtn');

        content.classList.toggle('collapsed');
        btn.classList.toggle('collapsed');

        localStorage.setItem(`${section}SectionCollapsed`, content.classList.contains('collapsed'));
    }
}

function getActiveFiltersText() {
    const filters = [];

    // Status filter
    const status = document.getElementById('filterStatus')?.value;
    if (status) {
        const statusText = document.querySelector('#filterStatus option:checked')?.textContent;
        filters.push(`סטטוס: ${statusText}`);
    }

    // Priority filter
    const priority = document.getElementById('filterPriority')?.value;
    if (priority) {
        const priorityText = document.querySelector('#filterPriority option:checked')?.textContent;
        filters.push(`עדיפות: ${priorityText}`);
    }

    // Condition filter
    const condition = document.getElementById('filterCondition')?.value;
    if (condition) {
        const conditionText = document.querySelector('#filterCondition option:checked')?.textContent;
        filters.push(`תאריך יעד: ${conditionText}`);
    }

    // Progress filter
    const progress = document.getElementById('filterProgress')?.value;
    if (progress) {
        const progressText = document.querySelector('#filterProgress option:checked')?.textContent;
        filters.push(`התקדמות: ${progressText}`);
    }

    // Sort
    const sort = document.getElementById('employeeTasksSort')?.value;
    if (sort && sort !== 'default') {
        const sortText = document.querySelector('#employeeTasksSort option:checked')?.textContent;
        filters.push(`מיון: ${sortText}`);
    }

    return filters;
}

function updateFiltersDisplay() {
    if (employeeTasksManager) {
        employeeTasksManager.updateActiveFiltersDisplay();
    }
}

// Update DOMContentLoaded
document.addEventListener('DOMContentLoaded', function () {
    // Restore employee filters section state
    const employeeFiltersCollapsed = localStorage.getItem('employeeFiltersSectionCollapsed');
    if (employeeFiltersCollapsed === 'true' || employeeFiltersCollapsed == null) {
        document.getElementById('employeeFiltersContent')?.classList.add('collapsed');
        document.getElementById('employeeFiltersCollapseBtn')?.classList.add('collapsed');
    }
});

// Update the employee select change handler
document.getElementById('employeeSelect').addEventListener('change', function () {
    updateEmployeeTaskButtons();
    employeeTasksManager.loadEmployeeTasks();
});

// Initialize employee tasks manager
let employeeTasksManager;
document.addEventListener('DOMContentLoaded', function () {
    employeeTasksManager = new EmployeeTasksManager();
    employeeTasksManager.initialize();
});


