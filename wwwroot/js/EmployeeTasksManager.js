class EmployeeTasksManager {
    constructor() {
        this.employees = [];
        this.employeeTasks = [];
        this.currentEmployee = '';

        const today = new Date();
        this.currentDate = today.toISOString().split('T')[0];

        this.activeFilters = {
            status: [],
            priority: [],
            condition: [],
            progress: [],
            search: ''
        };
        this.sortDirection = 'desc';

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
        this._initClearSearchButton();
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
        this.updateImportButtonVisibility();
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

        this.updateImportButtonVisibility();


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
        // קרא ערכים מרובים מ-checkboxes
        this.activeFilters = {
            status: this._getCheckedValues('filterStatusGroup'),
            priority: this._getCheckedValues('filterPriorityGroup'),
            condition: this._getCheckedValues('filterConditionGroup'),
            progress: this._getCheckedValues('filterProgressGroup'),
            search: document.getElementById('filterSearch')?.value || ''
        };

        this.currentSort =
            document.getElementById('employeeTasksSort')?.value || 'default';
        this.sortDirection =
            document.getElementById('employeeTasksSortDirection')?.value || 'desc';

        // הצג/הסתר כפתור ניקוי חיפוש
        const clearSearchBtn = document.getElementById('clearTaskSearch');
        if (clearSearchBtn) {
            clearSearchBtn.style.display =
                this.activeFilters.search ? 'flex' : 'none';
        }

        this.displayEmployeeTasks();
        this.updateActiveFiltersDisplay();
    }

    _getCheckedValues(groupId) {
        const group = document.getElementById(groupId);
        if (!group) return [];
        const checked = group.querySelectorAll(
            'input[type="checkbox"]:checked'
        );
        return Array.from(checked).map(cb => cb.value);
    }

    // Check if any filters are active
    hasActiveFilters() {
        return (this.activeFilters.status?.length > 0) ||
            (this.activeFilters.priority?.length > 0) ||
            (this.activeFilters.condition?.length > 0) ||
            (this.activeFilters.progress?.length > 0) ||
            this.activeFilters.search ||
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

        // ── תגיות סטטוס ────────────────────────────────────
        const statusLabels = {
            'חדש': 'חדש', 'בביצוע': 'בביצוע',
            'ממתין': 'ממתין', 'בוצע': 'בוצע', 'מבוטלת': 'מבוטלת'
        };
        (this.activeFilters.status || []).forEach(val => {
            filterTags.push(`
            <div class="filter-tag" 
                 onclick="employeeTasksManager.removeFilter('status','${val}')"
                 title="לחץ להסרה">
                <i class="fas fa-tag"></i>
                סטטוס: ${statusLabels[val] || val}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        });

        // ── תגיות עדיפות ────────────────────────────────────
        const priorityLabels = {
            'high': 'גבוהה', 'medium': 'בינונית', 'low': 'נמוכה'
        };
        (this.activeFilters.priority || []).forEach(val => {
            filterTags.push(`
            <div class="filter-tag"
                 onclick="employeeTasksManager.removeFilter('priority','${val}')"
                 title="לחץ להסרה">
                <i class="fas fa-flag"></i>
                עדיפות: ${priorityLabels[val] || val}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        });

        // ── תגיות תאריך יעד ─────────────────────────────────
        const conditionLabels = {
            'overdue': 'פג תוקף',
            'today': 'יעד היום',
            'upcoming': 'יעד עתידי',
            'no-due-date': 'ללא תאריך'
        };
        (this.activeFilters.condition || []).forEach(val => {
            filterTags.push(`
            <div class="filter-tag"
                 onclick="employeeTasksManager.removeFilter('condition','${val}')"
                 title="לחץ להסרה">
                <i class="fas fa-calendar-alt"></i>
                תאריך: ${conditionLabels[val] || val}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        });

        // ── תגיות התקדמות ────────────────────────────────────
        const progressLabels = {
            'not-started': 'לא התחיל',
            'in-progress': 'בתהליך',
            'completed': 'הושלם'
        };
        (this.activeFilters.progress || []).forEach(val => {
            filterTags.push(`
            <div class="filter-tag"
                 onclick="employeeTasksManager.removeFilter('progress','${val}')"
                 title="לחץ להסרה">
                <i class="fas fa-tasks"></i>
                התקדמות: ${progressLabels[val] || val}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        });

        // ── תגית חיפוש ──────────────────────────────────────
        if (this.activeFilters.search) {
            filterTags.push(`
            <div class="filter-tag"
                 onclick="employeeTasksManager.removeFilter('search')"
                 title="לחץ להסרה">
                <i class="fas fa-search"></i>
                חיפוש: ${this.activeFilters.search}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        // ── תגית מיון ───────────────────────────────────────
        if (this.currentSort !== 'default') {
            const sortLabels = {
                'status': 'מיון: סטטוס',
                'priority': 'מיון: עדיפות',
                'dueDate': 'מיון: תאריך יעד',
                'progress': 'מיון: התקדמות',
                'title': 'מיון: שם'
            };
            filterTags.push(`
            <div class="filter-tag"
                 onclick="employeeTasksManager.removeFilter('sort')"
                 title="לחץ להסרה">
                <i class="fas fa-sort"></i>
                ${sortLabels[this.currentSort]}
                <i class="fas fa-times filter-tag-remove"></i>
            </div>
        `);
        }

        if (filterTags.length > 0) {
            display.innerHTML = `
            <div class="active-filters-tags">
                ${filterTags.join('')}
            </div>`;
            display.style.display = 'block';
        } else {
            display.style.display = 'none';
        }

        this.clearFilterButton();
    }

    // Remove specific filter
    removeFilter(filterType, value = null) {
        if (filterType === 'sort') {
            this.currentSort = 'default';
            const sortSelect = document.getElementById('employeeTasksSort');
            if (sortSelect) sortSelect.value = 'default';

        } else if (filterType === 'search') {
            this.activeFilters.search = '';
            const searchFilter = document.getElementById('filterSearch');
            if (searchFilter) searchFilter.value = '';

        } else {
            // פילטרים עם מערכים (status, priority, condition, progress)
            const groupMap = {
                status: 'filterStatusGroup',
                priority: 'filterPriorityGroup',
                condition: 'filterConditionGroup',
                progress: 'filterProgressGroup'
            };

            if (value !== null) {
                // הסר ערך ספציפי
                this.activeFilters[filterType] =
                    this.activeFilters[filterType].filter(v => v !== value);

                // בטל את ה-checkbox המתאים
                const group = document.getElementById(groupMap[filterType]);
                if (group) {
                    const cb = group.querySelector(
                        `input[value="${value}"]`
                    );
                    if (cb) cb.checked = false;
                }
            } else {
                // הסר את כל הערכים של הפילטר
                this.activeFilters[filterType] = [];
                const group = document.getElementById(groupMap[filterType]);
                if (group) {
                    group.querySelectorAll('input[type="checkbox"]')
                        .forEach(cb => cb.checked = false);
                }
            }
        }

        this.applyFilters();
        NotificationManager.show('הסינון הוסר', 'info');
    }

    filterTasks(tasks) {
        let filtered = [...tasks];

        // ── סינון סטטוס מרובה ──────────────────────────────
        if (this.activeFilters.status?.length > 0) {
            filtered = filtered.filter(task =>
                this.activeFilters.status.includes(task.status)
            );
        }

        // ── סינון עדיפות מרובה ─────────────────────────────
        if (this.activeFilters.priority?.length > 0) {
            filtered = filtered.filter(task =>
                this.activeFilters.priority.includes(task.priority)
            );
        }

        // ── סינון תאריך יעד מרובה ──────────────────────────
        if (this.activeFilters.condition?.length > 0) {
            filtered = filtered.filter(task => {
                // המשימה עוברת אם היא מתאימה לפחות לתנאי אחד
                return this.activeFilters.condition.some(cond => {
                    switch (cond) {
                        case 'overdue':
                            return this.isTaskOverdue(task);
                        case 'today':
                            return task.dueDate &&
                                this.isToday(task.dueDate);
                        case 'upcoming':
                            return task.dueDate &&
                                new Date(task.dueDate) > new Date() &&
                                !this.isToday(task.dueDate);
                        case 'no-due-date':
                            return !task.dueDate || task.dueDate === '';
                        default:
                            return true;
                    }
                });
            });
        }

        // ── סינון התקדמות מרובה ────────────────────────────
        if (this.activeFilters.progress?.length > 0) {
            filtered = filtered.filter(task => {
                const progress = task.progress || 0;
                return this.activeFilters.progress.some(prog => {
                    switch (prog) {
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
            });
        }

        // ── סינון חיפוש טקסט ───────────────────────────────
        const searchFilter = this.activeFilters.search?.trim().toLowerCase();
        if (searchFilter) {
            filtered = filtered.filter(task =>
                task.title?.toLowerCase().includes(searchFilter) ||
                task.description?.toLowerCase().includes(searchFilter)
            );
        }

        return filtered;
    }

    clearFilters() {
        // נקה את כל ה-checkboxes
        const groups = [
            'filterStatusGroup',
            'filterPriorityGroup',
            'filterConditionGroup',
            'filterProgressGroup'
        ];
        groups.forEach(groupId => {
            const group = document.getElementById(groupId);
            if (group) {
                group.querySelectorAll('input[type="checkbox"]')
                    .forEach(cb => cb.checked = false);
            }
        });

        // נקה חיפוש ומיון
        const sortSelect = document.getElementById('employeeTasksSort');
        const searchFilter = document.getElementById('filterSearch');
        if (sortSelect) sortSelect.value = 'default';
        if (searchFilter) searchFilter.value = '';

        // אפס state פנימי
        this.activeFilters = {
            status: [],
            priority: [],
            condition: [],
            progress: [],
            search: ''
        };
        this.currentSort = 'default';

        // הצג/הסתר כפתור ניקוי חיפוש
        const clearSearchBtn = document.getElementById('clearTaskSearch');
        if (clearSearchBtn) {
            clearSearchBtn.style.display =
                this.activeFilters.search ? 'flex' : 'none';
        }
        this.displayEmployeeTasks();
        this.updateActiveFiltersDisplay();
        NotificationManager.show('הסינונים נוקו', 'info');
    }

    _initClearSearchButton() {
        const searchInput = document.getElementById('filterSearch');
        if (!searchInput) return;

        // בדוק אם כבר קיים wrapper
        if (searchInput.parentElement?.classList.contains('search-input-wrapper')) {
            return;
        }

        // ─── עטוף את שדה החיפוש ב-wrapper ────────────────────────
        const wrapper = document.createElement('div');
        wrapper.className = 'search-input-wrapper';
        wrapper.style.cssText = `
        position: relative;
        display: inline-flex;
        align-items: center;
        width: 100%;
    `;

        // הכנס את ה-wrapper לפני שדה החיפוש
        searchInput.parentNode.insertBefore(wrapper, searchInput);
        wrapper.appendChild(searchInput);

        // ─── צור כפתור ניקוי ──────────────────────────────────────
        const clearBtn = document.createElement('button');
        clearBtn.id = 'clearTaskSearch';
        clearBtn.type = 'button';
        clearBtn.title = 'נקה חיפוש';
        clearBtn.innerHTML = '<i class="fas fa-times"></i>';
        clearBtn.style.cssText = `
        display: none;
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        cursor: pointer;
        color: #999;
        padding: 2px 4px;
        border-radius: 50%;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        line-height: 1;
        transition: color 0.2s, background 0.2s;
        z-index: 2;
    `;

        // אפקט hover
        clearBtn.addEventListener('mouseenter', () => {
            clearBtn.style.color = '#e74c3c';
            clearBtn.style.background = '#ffeaea';
        });
        clearBtn.addEventListener('mouseleave', () => {
            clearBtn.style.color = '#999';
            clearBtn.style.background = 'none';
        });

        // לחיצה על כפתור הניקוי
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            this.activeFilters.search = '';
            clearBtn.style.display = 'none';

            // החל פילטרים מחדש
            this.applyFilters();

            // התמקד בשדה החיפוש
            searchInput.focus();

            // הצג הודעה
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('החיפוש נוקה', 'info');
            }
        });

        // הוסף padding לשדה החיפוש כדי שהטקסט לא יחפוף לכפתור
        searchInput.style.paddingLeft = '28px';

        wrapper.appendChild(clearBtn);

        // ─── מאזין לשינוי בשדה החיפוש ────────────────────────────
        searchInput.addEventListener('input', () => {
            clearBtn.style.display =
                searchInput.value ? 'flex' : 'none';
        });

        // ─── מאזין ל-Escape ───────────────────────────────────────
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchInput.value) {
                e.preventDefault();
                clearBtn.click();
            }
        });

        // הצג כפתור אם יש כבר ערך בשדה
        if (searchInput.value) {
            clearBtn.style.display = 'flex';
        }
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
        const dir = this.sortDirection === 'asc' ? 1 : -1;

        switch (this.currentSort) {
            case 'status':
                return sorted.sort((a, b) =>
                    (this.getStatusOrder(a.status) - this.getStatusOrder(b.status)) * dir
                );
            case 'priority':
                return sorted.sort((a, b) =>
                    (this.getPriorityOrder(a.priority) - this.getPriorityOrder(b.priority)) * dir
                );
            case 'dueDate':
                return sorted.sort((a, b) => {
                    const dateA = this.parseDueDate(a.dueDate);
                    const dateB = this.parseDueDate(b.dueDate);
                    return (dateA - dateB) * dir;
                });
            case 'progress':
                return sorted.sort((a, b) =>
                    ((a.progress || 0) - (b.progress || 0)) * dir
                );
            case 'title':
                return sorted.sort((a, b) =>
                    a.title.localeCompare(b.title, 'he') * dir
                );
            default:
                // ברירת המחדל תהיה מיון לפי תאריך יצירה מהחדש לישן
                return sorted.sort((a, b) => {
                    // בדיקה אם קיים שדה createdAt
                    if (a.createdAt && b.createdAt) {
                        return (new Date(b.createdAt) - new Date(a.createdAt)) * dir;
                    }
                    // אם אין גם id, החזר את הסדר המקורי
                    return 0;
                });
        }
    }

    toggleSortDirection() {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';

        // עדכן אייקון וטולטיפ
        const icon = document.getElementById('sortDirectionIcon');
        const btn = document.getElementById('sortDirectionBtn');

        if (icon) {
            icon.className = this.sortDirection === 'asc'
                ? 'fas fa-sort-amount-up'
                : 'fas fa-sort-amount-down';
        }
        if (btn) {
            btn.title = this.sortDirection === 'asc'
                ? 'מיון: מישן לחדש (לחץ להפוך)'
                : 'מיון: מחדש לישן (לחץ להפוך)';
        }

        this.displayEmployeeTasks();
        this.updateActiveFiltersDisplay();
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
            <button class="employee-task-calendar-btn"
                    onclick="event.stopPropagation();
                            employeeTasksManager.exportTaskToCalendar('${task.id}')"
                    title="הוסף ליומן Outlook">
                <i class="fas fa-calendar-plus"></i>
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

    // בדוק אם העובד הנוכחי הוא דני בירון
    isDaniBiron() {
        const selectedOption = document.getElementById('employeeSelect')
            ?.selectedOptions[0];
        if (!selectedOption) return false;
        const name = selectedOption.textContent?.trim().toLowerCase();
        const id = selectedOption.value;
        // בדוק לפי שם או ID - עדכן לפי הנתונים האמיתיים
        return name.includes('דני') && name.includes('בירון') ||
            name.includes('dani') && name.includes('biron') ||
            id === 'DANI_BIRON_ID'; // ← עדכן ל-ID האמיתי
    }

    // הצג/הסתר כפתור ייבוא אקסל
    updateImportButtonVisibility() {
        const importBtn = document.getElementById('importExcelTasksBtn');
        if (!importBtn) return;
        importBtn.style.display = this.isDaniBiron() ? 'inline-flex' : 'none';
    }

    // פתח dialog לבחירת קובץ אקסל
    openImportExcelDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls,.csv';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.processExcelFile(file);
            }
            document.body.removeChild(input);
        });

        input.click();
    }

    // עבד קובץ אקסל
    async processExcelFile(file) {
        const employeeId = document.getElementById('employeeSelect').value;
        if (!employeeId || employeeId === 'ALL_EMPLOYEES') {
            NotificationManager.show('אנא בחר עובד תחילה', 'error');
            return;
        }

        try {
            NotificationManager.show('מעבד קובץ...', 'info');

            const tasks = await this.parseExcelFile(file);

            if (!tasks || tasks.length === 0) {
                NotificationManager.show('לא נמצאו משימות בקובץ', 'warning');
                return;
            }

            // ← שלב חדש: סמן אילו משימות כבר קיימות
            const existingTitles = new Set(
                this.employeeTasks
                    .map(t => t.title?.trim().toLowerCase())
                    .filter(t => t)
            );

            // הוסף לכל משימה דגל האם היא כבר קיימת
            const tasksWithStatus = tasks.map(task => ({
                ...task,
                alreadyExists: existingTitles.has(
                    task.title?.trim().toLowerCase()
                )
            }));

            // הצג תצוגה מקדימה עם המידע על כפילויות
            const confirmed = await this.showImportPreview(
                tasksWithStatus,
                file.name
            );
            if (!confirmed) return;

            // שלח לשרת רק משימות שלא קיימות
            // (השרת גם בודק, אבל זה חוסך תעבורה)
            const response = await fetch('/EmployeeTasks/ImportTasksFromExcel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: employeeId,
                    tasks: tasksWithStatus // השרת יסנן לבד
                })
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(result.message, 'success');
                if (result.errors && result.errors.length > 0) {
                    console.warn('שגיאות בייבוא:', result.errors);
                }
                await this.loadEmployeeTasks();
            } else {
                NotificationManager.show(
                    'שגיאה בייבוא: ' + result.error,
                    'error'
                );
            }
        } catch (error) {
            console.error('Error processing Excel file:', error);
            NotificationManager.show(
                'שגיאה בעיבוד הקובץ: ' + error.message,
                'error'
            );
        }
    }

    // פרסר קובץ אקסל (דורש ספריית SheetJS)
    async parseExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    // בדוק אם SheetJS זמין
                    if (typeof XLSX === 'undefined') {
                        reject(new Error('ספריית XLSX לא נטענה. הוסף: <script src="https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js"></script>'));
                        return;
                    }

                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const tasks = [];

                    // עבור על כל הגיליונות
                    workbook.SheetNames.forEach(sheetName => {
                        const worksheet = workbook.Sheets[sheetName];
                        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                            header: 1,
                            defval: ''
                        });

                        if (jsonData.length < 2) return;

                        // מצא שורת כותרות
                        const headers = jsonData[0].map(h =>
                            String(h || '').trim().toLowerCase()
                        );

                        // מיפוי עמודות
                        const colMap = {
                            title: this.findColumnIndex(headers,
                                ['תיאור משימה', 'משימה', 'title', 'task']),
                            status: this.findColumnIndex(headers,
                                ['סטאטוס', 'סטטוס', 'status']),
                            progress: this.findColumnIndex(headers,
                                ['התקדמות', 'progress']),
                            notes: this.findColumnIndex(headers,
                                ['הערות', 'notes']),
                            priority: this.findColumnIndex(headers,
                                ['עדיפות', 'priority']),
                            completedDate: this.findColumnIndex(headers,
                                ['תאריך ביצוע', 'completed date', 'date']),
                            project: this.findColumnIndex(headers,
                                ['פרוייקט עבור', 'project', 'פרויקט'])
                        };

                        // עבד שורות נתונים
                        for (let i = 1; i < jsonData.length; i++) {
                            const row = jsonData[i];
                            if (!row || row.length === 0) continue;

                            const titleIdx = colMap.title;
                            if (titleIdx === -1) continue;

                            const title = String(row[titleIdx] || '').trim();
                            if (!title || title === 'NaN') continue;

                            // בנה תיאור מ-project אם קיים
                            let description = '';
                            if (colMap.project !== -1) {
                                const proj = String(row[colMap.project] || '').trim();
                                if (proj && proj !== 'NaN') {
                                    description = `פרויקט: ${proj}`;
                                }
                            }

                            // עבד תאריך
                            let completedDate = '';
                            if (colMap.completedDate !== -1) {
                                const dateVal = row[colMap.completedDate];
                                if (dateVal && dateVal !== 'NaN') {
                                    completedDate = this.parseExcelDate(dateVal);
                                }
                            }

                            // עבד התקדמות
                            let progress = null;
                            if (colMap.progress !== -1) {
                                const progVal = row[colMap.progress];
                                if (progVal !== '' && progVal !== 'NaN' &&
                                    progVal !== null && progVal !== undefined) {
                                    const num = parseFloat(progVal);
                                    if (!isNaN(num)) {
                                        // אם הערך > 1, כנראה כבר באחוזים
                                        const converted = num > 1 ? Math.round(num) : Math.round(num * 100);
                                        progress = Math.min(100, Math.max(0, converted)); // הגבל לטווח 0-100
                                    }
                                }
                            }

                            tasks.push({
                                title: title,
                                description: description,
                                status: colMap.status !== -1 ?
                                    String(row[colMap.status] || '').trim() : '',
                                priority: colMap.priority !== -1 ?
                                    String(row[colMap.priority] || '').trim() : '',
                                notes: colMap.notes !== -1 ?
                                    String(row[colMap.notes] || '').trim() : '',
                                completedDate: completedDate,
                                dueDate: completedDate || '',
                                progress: progress
                            });
                        }
                    });

                    resolve(tasks);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
            reader.readAsArrayBuffer(file);
        });
    }

    // מצא אינדקס עמודה לפי שמות אפשריים
    findColumnIndex(headers, possibleNames) {
        for (const name of possibleNames) {
            const idx = headers.findIndex(h =>
                h.includes(name.toLowerCase())
            );
            if (idx !== -1) return idx;
        }
        return -1;
    }

    // פרסר תאריך מאקסל
    parseExcelDate(value) {
        if (!value || value === 'NaN') return '';

        // מספר סידורי של אקסל
        if (typeof value === 'number') {
            const date = new Date((value - 25569) * 86400 * 1000);
            return date.toISOString().split('T')[0];
        }

        const str = String(value).trim();
        if (!str || str === 'NaN') return '';

        // פורמטים שונים
        const formats = [
            /^(\d{4})-(\d{2})-(\d{2})/, // yyyy-mm-dd
            /^(\d{2})\.(\d{2})\.(\d{4})/, // dd.mm.yyyy
            /^(\d{2})\/(\d{2})\/(\d{4})/, // dd/mm/yyyy
        ];

        for (const fmt of formats) {
            const match = str.match(fmt);
            if (match) {
                if (fmt === formats[0]) {
                    return `${match[1]}-${match[2]}-${match[3]}`;
                } else {
                    return `${match[3]}-${match[2]}-${match[1]}`;
                }
            }
        }

        // נסה Date.parse
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }

        return '';
    }

    exportTaskToCalendar(taskId) {
        try {
            const task = this.employeeTasks.find(t => t.id == taskId);
            if (!task) {
                NotificationManager.show('משימה לא נמצאה', 'error');
                return;
            }

            const employee = this.employees.find(
                emp => emp.id === task.employeeId
            );
            const employeeName = employee ? employee.name : '';

            // ── תאריך התחלה ──────────────────────────────────────
            const startDateStr = task.dueDate || this.currentDate;
            let startDate = new Date(startDateStr);

            if (isNaN(startDate.getTime())) {
                startDate = new Date();
            }

            startDate.setHours(9, 0, 0, 0);
            const endDate = new Date(startDate);
            endDate.setHours(10, 0, 0, 0);

            // ── פורמט תאריך ───────────────────────────────────────
            const formatDate = (date) => {
                const pad = (n) => String(n).padStart(2, '0');
                return (
                    `${date.getFullYear()}-` +
                    `${pad(date.getMonth() + 1)}-` +
                    `${pad(date.getDate())}` +
                    `T` +
                    `${pad(date.getHours())}:` +
                    `${pad(date.getMinutes())}:` +
                    `${pad(date.getSeconds())}`
                );
            };

            // ── פורמט תאריך ל-ICS ─────────────────────────────────
            const formatICSDate = (date) => {
                const pad = (n) => String(n).padStart(2, '0');
                return (
                    `${date.getFullYear()}` +
                    `${pad(date.getMonth() + 1)}` +
                    `${pad(date.getDate())}` +
                    `T` +
                    `${pad(date.getHours())}` +
                    `${pad(date.getMinutes())}` +
                    `${pad(date.getSeconds())}`
                );
            };

            // ── בניית תיאור ───────────────────────────────────────
            const priorityLabel =
                task.priority === 'high' ? 'גבוהה' :
                    task.priority === 'medium' ? 'בינונית' :
                        task.priority === 'low' ? 'נמוכה' : '';

            const bodyParts = [];
            if (task.description) bodyParts.push(task.description);
            if (employeeName) bodyParts.push(`משויך ל: ${employeeName}`);
            if (priorityLabel) bodyParts.push(`עדיפות: ${priorityLabel}`);
            if (task.status) bodyParts.push(`סטטוס: ${task.status}`);
            if (task.progress !== undefined && task.progress !== null) {
                bodyParts.push(`התקדמות: ${task.progress}%`);
            }

            // ── הצג מודל בחירה ────────────────────────────────────
            this._showCalendarChoiceModal({
                task,
                startDate,
                endDate,
                bodyParts,
                formatDate,
                formatICSDate,
                priorityLabel,
                employeeName
            });

        } catch (error) {
            console.error('Error opening calendar:', error);
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    'שגיאה בפתיחת היומן: ' + error.message,
                    'error'
                );
            }
        }
    }

    // ============================================================
    // מודל בחירת שיטת ייצוא ליומן
    // ============================================================
    _showCalendarChoiceModal({
        task, startDate, endDate,
        bodyParts, formatDate, formatICSDate,
        priorityLabel, employeeName
    }) {
        // הסר מודל קיים אם יש
        const existing = document.getElementById('calendarChoiceModal');
        if (existing) existing.remove();

        const modalHTML = `
        <div id="calendarChoiceModal" style="
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.55);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            direction: rtl;
            backdrop-filter: blur(4px);
            animation: fadeInModal 0.2s ease;
        ">
            <div style="
                background: white;
                border-radius: 16px;
                padding: 0;
                width: 92%;
                max-width: 420px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                overflow: hidden;
                animation: slideUpModal 0.25s ease;
            ">

                <!-- כותרת -->
                <div style="
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    padding: 18px 22px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                ">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="fas fa-calendar-plus" 
                           style="font-size:1.3rem;"></i>
                        <div>
                            <div style="font-size:1rem; font-weight:700;">
                                הוסף ליומן
                            </div>
                            <div style="
                                font-size:0.78rem; 
                                opacity:0.85; 
                                margin-top:2px;
                                max-width: 260px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                            ">
                                ${task.title || 'משימה'}
                            </div>
                        </div>
                    </div>
                    <button 
                        onclick="document.getElementById(
                            'calendarChoiceModal').remove()"
                        style="
                            background: rgba(255,255,255,0.2);
                            border: 2px solid rgba(255,255,255,0.3);
                            color: white;
                            width: 32px; height: 32px;
                            border-radius: 50%;
                            cursor: pointer;
                            font-size: 0.95rem;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            transition: all 0.2s;
                        "
                        onmouseover="this.style.background='rgba(255,255,255,0.35)'"
                        onmouseout="this.style.background='rgba(255,255,255,0.2)'"
                    >✕</button>
                </div>

                <!-- פרטי אירוע -->
                <div style="
                    padding: 16px 22px;
                    background: #f8f9ff;
                    border-bottom: 1px solid #e8e8f0;
                    font-size: 0.85rem;
                    color: #555;
                ">
                    <div style="
                        display: flex; 
                        gap: 16px; 
                        flex-wrap: wrap;
                    ">
                        <span style="
                            display:flex; 
                            align-items:center; 
                            gap:5px;
                        ">
                            <i class="fas fa-calendar" 
                               style="color:#667eea;"></i>
                            ${startDate.toLocaleDateString('he-IL')}
                        </span>
                        <span style="
                            display:flex; 
                            align-items:center; 
                            gap:5px;
                        ">
                            <i class="fas fa-clock" 
                               style="color:#667eea;"></i>
                            09:00 – 10:00
                        </span>
                        ${priorityLabel ? `
                        <span style="
                            display:flex; 
                            align-items:center; 
                            gap:5px;
                        ">
                            <i class="fas fa-flag" 
                               style="color:#667eea;"></i>
                            ${priorityLabel}
                        </span>` : ''}
                    </div>
                </div>

                <!-- כפתורי בחירה -->
                <div style="padding: 22px;">
                    <p style="
                        margin: 0 0 16px 0;
                        font-size: 0.9rem;
                        color: #444;
                        font-weight: 600;
                        text-align: center;
                    ">
                        בחר כיצד להוסיף את האירוע ליומן:
                    </p>

                    <div style="
                        display: flex; 
                        flex-direction: column; 
                        gap: 12px;
                    ">

                        <!-- Outlook Web -->
                        <button 
                            id="calendarChoiceOutlookBtn"
                            onclick="window._calendarChoice('outlook')"
                            style="
                                display: flex;
                                align-items: center;
                                gap: 14px;
                                padding: 14px 18px;
                                background: white;
                                border: 2px solid #e0e0f0;
                                border-radius: 12px;
                                cursor: pointer;
                                text-align: right;
                                transition: all 0.2s;
                                width: 100%;
                            "
                            onmouseover="
                                this.style.borderColor='#667eea';
                                this.style.background='#f0f4ff';
                                this.style.transform='translateY(-1px)';
                                this.style.boxShadow='0 4px 12px rgba(102,126,234,0.2)';
                            "
                            onmouseout="
                                this.style.borderColor='#e0e0f0';
                                this.style.background='white';
                                this.style.transform='translateY(0)';
                                this.style.boxShadow='none';
                            "
                        >
                            <div style="
                                width: 42px; height: 42px;
                                background: linear-gradient(
                                    135deg, #0078d4, #106ebe);
                                border-radius: 10px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                flex-shrink: 0;
                            ">
                                <i class="fas fa-globe" 
                                   style="color:white; font-size:1.1rem;">
                                </i>
                            </div>
                            <div style="flex: 1;">
                                <div style="
                                    font-weight: 700;
                                    color: #222;
                                    font-size: 0.95rem;
                                    margin-bottom: 3px;
                                ">
                                    פתח ב-Outlook Web
                                </div>
                                <div style="
                                    font-size: 0.78rem;
                                    color: #888;
                                ">
                                    יפתח בדפדפן עם הפרטים ממולאים
                                </div>
                            </div>
                            <i class="fas fa-chevron-left" 
                               style="color:#ccc; font-size:0.8rem;">
                            </i>
                        </button>

                        <!-- הורד ICS -->
                        <button 
                            onclick="window._calendarChoice('ics')"
                            style="
                                display: flex;
                                align-items: center;
                                gap: 14px;
                                padding: 14px 18px;
                                background: white;
                                border: 2px solid #e0e0f0;
                                border-radius: 12px;
                                cursor: pointer;
                                text-align: right;
                                transition: all 0.2s;
                                width: 100%;
                            "
                            onmouseover="
                                this.style.borderColor='#28a745';
                                this.style.background='#f0fff4';
                                this.style.transform='translateY(-1px)';
                                this.style.boxShadow='0 4px 12px rgba(40,167,69,0.2)';
                            "
                            onmouseout="
                                this.style.borderColor='#e0e0f0';
                                this.style.background='white';
                                this.style.transform='translateY(0)';
                                this.style.boxShadow='none';
                            "
                        >
                            <div style="
                                width: 42px; height: 42px;
                                background: linear-gradient(
                                    135deg, #28a745, #20c997);
                                border-radius: 10px;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                flex-shrink: 0;
                            ">
                                <i class="fas fa-download" 
                                   style="color:white; font-size:1.1rem;">
                                </i>
                            </div>
                            <div style="flex: 1;">
                                <div style="
                                    font-weight: 700;
                                    color: #222;
                                    font-size: 0.95rem;
                                    margin-bottom: 3px;
                                ">
                                    הורד קובץ ICS
                                </div>
                                <div style="
                                    font-size: 0.78rem;
                                    color: #888;
                                ">
                                    תואם Outlook Desktop, Google Calendar ועוד
                                </div>
                            </div>
                            <i class="fas fa-chevron-left" 
                               style="color:#ccc; font-size:0.8rem;">
                            </i>
                        </button>

                    </div>
                </div>

                <!-- הודעת טעינה (מוסתרת בהתחלה) -->
                <div id="calendarChoiceLoading" style="
                    display: none;
                    padding: 18px 22px;
                    text-align: center;
                    border-top: 1px solid #f0f0f0;
                    color: #667eea;
                    font-size: 0.88rem;
                    font-weight: 600;
                    gap: 10px;
                    align-items: center;
                    justify-content: center;
                ">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span id="calendarChoiceLoadingText">
                        פותח את Outlook...
                    </span>
                </div>

            </div>
        </div>

        <style>
            @keyframes fadeInModal {
                from { opacity: 0; }
                to   { opacity: 1; }
            }
            @keyframes slideUpModal {
                from { transform: translateY(30px); opacity: 0; }
                to   { transform: translateY(0);    opacity: 1; }
            }
        </style>
    `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // ── טפל בבחירה ────────────────────────────────────────────
        window._calendarChoice = (choice) => {

            if (choice === 'outlook') {

                // ── הצג טעינה ──────────────────────────────────────
                const loadingDiv = document.getElementById(
                    'calendarChoiceLoading'
                );
                const outlookBtn = document.getElementById(
                    'calendarChoiceOutlookBtn'
                );

                if (loadingDiv) {
                    loadingDiv.style.display = 'flex';
                }
                if (outlookBtn) {
                    outlookBtn.disabled = true;
                    outlookBtn.style.opacity = '0.6';
                    outlookBtn.style.cursor = 'not-allowed';
                }

                // ── בנה URL ────────────────────────────────────────
                const outlookWebUrl =
                    `https://outlook.office.com/calendar/deeplink/compose` +
                    `?subject=${encodeURIComponent(task.title || 'משימה')}` +
                    `&startdt=${encodeURIComponent(formatDate(startDate))}` +
                    `&enddt=${encodeURIComponent(formatDate(endDate))}` +
                    `&body=${encodeURIComponent(bodyParts.join('\n'))}`;

                // ── פתח חלון מיד (בתוך user gesture) ────────────────
                const newWin = window.open('about:blank', '_blank');

                if (!newWin) {
                    // ── הדפדפן חסם את הפופאפ ──────────────────────
                    if (loadingDiv) loadingDiv.style.display = 'none';
                    if (outlookBtn) {
                        outlookBtn.disabled = false;
                        outlookBtn.style.opacity = '1';
                        outlookBtn.style.cursor = 'pointer';
                    }

                    // הצג הודעה למשתמש
                    const modal = document.getElementById('calendarChoiceModal');
                    if (modal) {
                        const warningDiv = document.createElement('div');
                        warningDiv.style.cssText = `
                padding: 12px 20px;
                background: #fff3cd;
                border-top: 1px solid #ffc107;
                color: #856404;
                font-size: 0.85rem;
                text-align: center;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            `;
                        warningDiv.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                הדפדפן חסם את הפופאפ. 
                <a href="${outlookWebUrl}" target="_blank" 
                   style="color:#0078d4; font-weight:700; 
                          text-decoration:underline;">
                    לחץ כאן לפתיחה ידנית
                </a>
            `;
                        modal.querySelector('div').appendChild(warningDiv);
                    }
                    return;
                }

                // ── המתן 0.1 שניות ואז נווט לURL ─────────────────────
                // החלון כבר פתוח - רק מנווטים אותו לכתובת הנכונה
                // זה עובד כי החלון כבר נפתח בתוך ה-user gesture
                setTimeout(() => {
                    newWin.location.href = outlookWebUrl;

                    // סגור מודל
                    const modal = document.getElementById('calendarChoiceModal');
                    if (modal) modal.remove();

                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(
                            'נפתח יומן Outlook Web',
                            'success'
                        );
                    }
                }, 100);
            } else if (choice === 'ics') {

                // ── הורד קובץ ICS ──────────────────────────────────────
                const icsPriority =
                    task.priority === 'high' ? '1' :
                        task.priority === 'medium' ? '5' :
                            task.priority === 'low' ? '9' : '5';

                // ── תיקון: bodyParts במקום descriptionParts ─────────────
                const cleanDescription = bodyParts
                    .join('\\n')
                    .replace(/,/g, '\\,')
                    .replace(/;/g, '\\;');

                const cleanTitle = (task.title || 'משימה')
                    .replace(/,/g, '\\,')
                    .replace(/;/g, '\\;');

                // ── תיקון: הגדר uid ו-createdStamp כאן ─────────────────
                const uid = `task-${task.id}-${Date.now()}@noc-system`;
                const createdStamp = formatICSDate(new Date());

                // ── בניית קובץ ICS ──────────────────────────────────────
                const icsContent = [
                    'BEGIN:VCALENDAR',
                    'VERSION:2.0',
                    'PRODID:-//NOC System//Employee Tasks//HE',
                    'CALSCALE:GREGORIAN',
                    'METHOD:PUBLISH',
                    'BEGIN:VEVENT',
                    `UID:${uid}`,
                    `DTSTAMP:${createdStamp}`,
                    `DTSTART:${formatICSDate(startDate)}`,
                    `DTEND:${formatICSDate(endDate)}`,
                    `SUMMARY:${cleanTitle}`,
                    `DESCRIPTION:${cleanDescription}`,
                    `PRIORITY:${icsPriority}`,
                    'STATUS:NEEDS-ACTION',
                    'TRANSP:OPAQUE',
                    'BEGIN:VALARM',
                    'TRIGGER:-PT15M',
                    'ACTION:DISPLAY',
                    `DESCRIPTION:תזכורת: ${cleanTitle}`,
                    'END:VALARM',
                    'END:VEVENT',
                    'END:VCALENDAR'
                ].join('\r\n');

                // ── הורדת הקובץ ─────────────────────────────────────────
                const blob = new Blob(
                    ['\uFEFF' + icsContent],
                    { type: 'text/calendar;charset=utf-8' }
                );

                const safeTitle = (task.title || 'משימה')
                    .replace(/[^a-zA-Z0-9\u0590-\u05FF\s]/g, '')
                    .trim()
                    .replace(/\s+/g, '_')
                    .substring(0, 50);

                // ── תיקון: startDateStr לא קיים בסקופ - חשב מחדש ────────
                const startDateForFile = task.dueDate ||
                    (typeof employeeTasksManager !== 'undefined'
                        ? employeeTasksManager.currentDate
                        : new Date().toISOString().split('T')[0]);

                const fileName = `task_${safeTitle}_${startDateForFile}.ics`;

                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                setTimeout(() => URL.revokeObjectURL(link.href), 1000);

                // סגור מודל
                const modal = document.getElementById('calendarChoiceModal');
                if (modal) modal.remove();

                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(
                        `קובץ יומן הורד: ${fileName}`,
                        'success'
                    );
                }
            }
        };
    }

    // הצג תצוגה מקדימה לפני ייבוא
    showImportPreview(tasks, fileName) {
        return new Promise((resolve) => {

            // חשב סטטיסטיקות
            const newTasks = tasks.filter(t => !t.alreadyExists);
            const existingTasks = tasks.filter(t => t.alreadyExists);
            const completedNew = newTasks.filter(t =>
                t.status?.includes('בוצע')).length;
            const inProgressNew = newTasks.filter(t =>
                t.status?.includes('ביצוע') ||
                t.status?.includes('המשך')).length;

            // פונקציה לצבע סטטוס
            const statusColor = (status) => {
                if (!status) return { bg: '#f3e5f5', color: '#6a1b9a' };
                if (status.includes('בוצע'))
                    return { bg: '#e8f5e9', color: '#2e7d32' };
                if (status.includes('ביצוע') || status.includes('המשך'))
                    return { bg: '#fff3e0', color: '#e65100' };
                if (status.includes('בוטל'))
                    return { bg: '#ffebee', color: '#c62828' };
                return { bg: '#f3e5f5', color: '#6a1b9a' };
            };

            const previewHTML = `
        <div id="importPreviewModal" style="
            position: fixed; top: 0; left: 0; 
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.65); 
            z-index: 9999;
            display: flex; align-items: center; 
            justify-content: center;
            direction: rtl;
            backdrop-filter: blur(4px);
        ">
            <div style="
                background: white; border-radius: 16px; padding: 0;
                width: 90%; max-width: 750px; 
                max-height: 88vh;
                display: flex; flex-direction: column;
                box-shadow: 0 20px 60px rgba(0,0,0,0.35);
                overflow: hidden;
            ">

                <!-- כותרת -->
                <div style="
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white; padding: 18px 22px;
                    display: flex; justify-content: space-between; 
                    align-items: center; flex-shrink: 0;
                ">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <i class="fas fa-file-excel" 
                           style="font-size:1.4rem;"></i>
                        <div>
                            <div style="font-size:1.15rem; font-weight:700;">
                                תצוגה מקדימה - ייבוא משימות
                            </div>
                            <div style="font-size:0.8rem; opacity:0.85; 
                                        margin-top:2px;">
                                ${fileName}
                            </div>
                        </div>
                    </div>
                    <button 
                        onclick="
                            document.getElementById(
                                'importPreviewModal').remove();
                            window._importResolve(false);"
                        style="
                            background:rgba(255,255,255,0.2); 
                            border:2px solid rgba(255,255,255,0.3);
                            color:white; width:34px; height:34px; 
                            border-radius:50%; cursor:pointer; 
                            font-size:1rem; display:flex;
                            align-items:center; justify-content:center;
                            transition: all 0.2s;
                        ">✕</button>
                </div>

                <!-- סטטיסטיקות -->
                <div style="
                    padding: 16px 22px; 
                    background: #f8f9ff;
                    border-bottom: 1px solid #e8e8f0;
                    flex-shrink: 0;
                ">
                    <div style="
                        display: flex; gap: 10px; 
                        flex-wrap: wrap; margin-bottom: 12px;
                    ">
                        <!-- סה"כ -->
                        <div style="
                            background: #e3f2fd; color: #1565c0;
                            padding: 8px 14px; border-radius: 20px;
                            font-weight: 700; font-size: 0.9rem;
                            display: flex; align-items: center; gap: 6px;
                        ">
                            <i class="fas fa-list"></i>
                            סה"כ בקובץ: ${tasks.length}
                        </div>

                        <!-- חדשות -->
                        <div style="
                            background: #e8f5e9; color: #1b5e20;
                            padding: 8px 14px; border-radius: 20px;
                            font-weight: 700; font-size: 0.9rem;
                            display: flex; align-items: center; gap: 6px;
                        ">
                            <i class="fas fa-plus-circle"></i>
                            יתווספו: ${newTasks.length}
                        </div>

                        <!-- קיימות -->
                        <div style="
                            background: ${existingTasks.length > 0
                    ? '#fff3e0' : '#f5f5f5'}; 
                            color: ${existingTasks.length > 0
                    ? '#e65100' : '#999'};
                            padding: 8px 14px; border-radius: 20px;
                            font-weight: 700; font-size: 0.9rem;
                            display: flex; align-items: center; gap: 6px;
                        ">
                            <i class="fas fa-ban"></i>
                            כבר קיימות: ${existingTasks.length}
                        </div>

                        <!-- בוצעו -->
                        ${completedNew > 0 ? `
                        <div style="
                            background: #e0f2f1; color: #004d40;
                            padding: 8px 14px; border-radius: 20px;
                            font-weight: 700; font-size: 0.9rem;
                            display: flex; align-items: center; gap: 6px;
                        ">
                            <i class="fas fa-check-double"></i>
                            בוצעו: ${completedNew}
                        </div>` : ''}

                        <!-- בביצוע -->
                        ${inProgressNew > 0 ? `
                        <div style="
                            background: #fce4ec; color: #880e4f;
                            padding: 8px 14px; border-radius: 20px;
                            font-weight: 700; font-size: 0.9rem;
                            display: flex; align-items: center; gap: 6px;
                        ">
                            <i class="fas fa-spinner"></i>
                            בביצוע: ${inProgressNew}
                        </div>` : ''}
                    </div>

                    <!-- הסבר צבעים -->
                    <div style="
                        display: flex; gap: 16px; 
                        font-size: 0.8rem; color: #666;
                        flex-wrap: wrap;
                    ">
                        <span style="display:flex; align-items:center; gap:5px;">
                            <span style="
                                width:12px; height:12px; 
                                background:#e8f5e9; 
                                border:2px solid #4caf50;
                                border-radius:3px; display:inline-block;
                            "></span>
                            משימה חדשה - תתווסף
                        </span>
                        <span style="display:flex; align-items:center; gap:5px;">
                            <span style="
                                width:12px; height:12px; 
                                background:#fff8e1; 
                                border:2px solid #ff9800;
                                border-radius:3px; display:inline-block;
                            "></span>
                            כבר קיימת - תדולג
                        </span>
                    </div>
                </div>

                <!-- טאבים -->
                <div style="
                    display: flex; 
                    border-bottom: 2px solid #e0e0e0;
                    flex-shrink: 0;
                    background: white;
                ">
                    <button id="tabAll"
                        onclick="switchImportTab('all')"
                        style="
                            flex: 1; padding: 11px; border: none;
                            background: linear-gradient(
                                135deg, #667eea, #764ba2);
                            color: white; cursor: pointer;
                            font-weight: 700; font-size: 0.9rem;
                            border-bottom: 3px solid #667eea;
                        ">
                        הכל (${tasks.length})
                    </button>
                    <button id="tabNew"
                        onclick="switchImportTab('new')"
                        style="
                            flex: 1; padding: 11px; border: none;
                            background: white; color: #2e7d32;
                            cursor: pointer; font-weight: 600;
                            font-size: 0.9rem;
                            border-bottom: 3px solid transparent;
                        ">
                        <i class="fas fa-plus"></i>
                        חדשות (${newTasks.length})
                    </button>
                    <button id="tabExisting"
                        onclick="switchImportTab('existing')"
                        style="
                            flex: 1; padding: 11px; border: none;
                            background: white; 
                            color: ${existingTasks.length > 0
                    ? '#e65100' : '#bbb'};
                            cursor: pointer; font-weight: 600;
                            font-size: 0.9rem;
                            border-bottom: 3px solid transparent;
                        ">
                        <i class="fas fa-ban"></i>
                        קיימות (${existingTasks.length})
                    </button>
                </div>

                <!-- טבלת משימות -->
                <div style="
                    overflow-y: auto; flex: 1; 
                    min-height: 0;
                ">
                    <table id="importPreviewTable" style="
                        width: 100%; border-collapse: collapse;
                        font-size: 0.85rem;
                    ">
                        <thead style="
                            position: sticky; top: 0; z-index: 5;
                            background: #f5f5f5;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.08);
                        ">
                            <tr>
                                <th style="
                                    padding: 10px 8px; text-align:right;
                                    color: #555; font-weight: 700;
                                    width: 35px;
                                ">#</th>
                                <th style="
                                    padding: 10px 8px; text-align:right;
                                    color: #555; font-weight: 700;
                                ">משימה</th>
                                <th style="
                                    padding: 10px 8px; text-align:right;
                                    color: #555; font-weight: 700;
                                    width: 100px;
                                ">סטטוס</th>
                                <th style="
                                    padding: 10px 8px; text-align:center;
                                    color: #555; font-weight: 700;
                                    width: 75px;
                                ">התקדמות</th>
                                <th style="
                                    padding: 10px 8px; text-align:center;
                                    color: #555; font-weight: 700;
                                    width: 90px;
                                ">מצב</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tasks.map((t, i) => {
                        const sc = statusColor(t.status);
                        const prog = t.progress !== null && t.progress !== undefined
                            ? Math.round(t.progress || 0)
                            : (t.status?.includes('בוצע') ? 100 : 0);
                        const rowBg = t.alreadyExists
                            ? '#fffde7'
                            : (i % 2 === 0 ? '#ffffff' : '#fafffe');
                        const rowBorder = t.alreadyExists
                            ? 'border-right: 3px solid #ff9800;'
                            : 'border-right: 3px solid #4caf50;';

                        return `
                                <tr class="import-row" 
                                    data-exists="${t.alreadyExists}"
                                    style="
                                        border-bottom: 1px solid #f0f0f0;
                                        background: ${rowBg};
                                        ${rowBorder}
                                        transition: background 0.15s;
                                    ">
                                    <td style="
                                        padding: 8px; 
                                        color: #aaa; 
                                        text-align: center;
                                        font-size: 0.78rem;
                                    ">${i + 1}</td>

                                    <td style="padding: 8px 10px;">
                                        <div style="
                                            font-weight: 500;
                                            color: ${t.alreadyExists
                                ? '#999' : '#222'};
                                            max-width: 320px;
                                            overflow: hidden;
                                            text-overflow: ellipsis;
                                            white-space: nowrap;
                                            ${t.alreadyExists
                                ? 'text-decoration: line-through;'
                                : ''}
                                        " title="${t.title}">
                                            ${t.title}
                                        </div>
                                        ${t.notes && t.notes !== 'NaN'
                                && t.notes !== '' ? `
                                            <div style="
                                                font-size: 0.75rem; 
                                                color: #888; 
                                                margin-top: 2px;
                                                overflow: hidden;
                                                text-overflow: ellipsis;
                                                white-space: nowrap;
                                                max-width: 320px;
                                            " title="${t.notes}">
                                                💬 ${t.notes}
                                            </div>
                                        ` : ''}
                                    </td>

                                    <td style="padding: 8px;">
                                        <span style="
                                            padding: 3px 8px; 
                                            border-radius: 10px;
                                            font-size: 0.78rem;
                                            font-weight: 600;
                                            background: ${sc.bg};
                                            color: ${sc.color};
                                            white-space: nowrap;
                                        ">
                                            ${t.status || 'חדש'}
                                        </span>
                                    </td>

                                    <td style="
                                        padding: 8px; 
                                        text-align: center;
                                    ">
                                        <div style="
                                            display: flex; 
                                            align-items: center; 
                                            gap: 5px;
                                            justify-content: center;
                                        ">
                                            <div style="
                                                width: 45px; height: 6px;
                                                background: #e0e0e0;
                                                border-radius: 3px;
                                                overflow: hidden;
                                            ">
                                                <div style="
                                                    width: ${prog}%;
                                                    height: 100%;
                                                    background: ${prog === 100
                                ? '#4caf50'
                                : prog >= 75
                                    ? '#ff9800'
                                    : '#667eea'};
                                                    border-radius: 3px;
                                                "></div>
                                            </div>
                                            <span style="
                                                font-size: 0.78rem;
                                                color: #666;
                                                min-width: 28px;
                                            ">${prog}%</span>
                                        </div>
                                    </td>

                                    <td style="
                                        padding: 8px; 
                                        text-align: center;
                                    ">
                                        ${t.alreadyExists ? `
                                            <span style="
                                                display: inline-flex;
                                                align-items: center;
                                                gap: 4px;
                                                background: #fff3e0;
                                                color: #e65100;
                                                padding: 3px 8px;
                                                border-radius: 10px;
                                                font-size: 0.75rem;
                                                font-weight: 600;
                                                white-space: nowrap;
                                            ">
                                                <i class="fas fa-ban" 
                                                   style="font-size:0.7rem;">
                                                </i>
                                                קיימת
                                            </span>
                                        ` : `
                                            <span style="
                                                display: inline-flex;
                                                align-items: center;
                                                gap: 4px;
                                                background: #e8f5e9;
                                                color: #2e7d32;
                                                padding: 3px 8px;
                                                border-radius: 10px;
                                                font-size: 0.75rem;
                                                font-weight: 600;
                                                white-space: nowrap;
                                            ">
                                                <i class="fas fa-plus" 
                                                   style="font-size:0.7rem;">
                                                </i>
                                                חדשה
                                            </span>
                                        `}
                                    </td>
                                </tr>`;
                    }).join('')}
                        </tbody>
                    </table>

                    <!-- אם אין משימות חדשות -->
                    ${newTasks.length === 0 ? `
                        <div style="
                            text-align: center; padding: 30px;
                            color: #ff9800;
                        ">
                            <i class="fas fa-exclamation-triangle" 
                               style="font-size:2rem; margin-bottom:10px; 
                                      display:block;"></i>
                            <strong>כל המשימות בקובץ כבר קיימות במערכת</strong>
                            <p style="color:#999; margin-top:8px; 
                                      font-size:0.9rem;">
                                אין משימות חדשות לייבוא
                            </p>
                        </div>
                    ` : ''}
                </div>

                <!-- כפתורי פעולה -->
                <div style="
                    padding: 14px 20px; 
                    border-top: 1px solid #e8e8f0;
                    display: flex; gap: 10px; 
                    justify-content: space-between;
                    align-items: center;
                    background: #fafafa; 
                    flex-shrink: 0;
                ">
                    <div style="
                        font-size: 0.85rem; color: #666;
                    ">
                        ${newTasks.length > 0
                    ? `<i class="fas fa-info-circle" 
                                  style="color:#667eea;"></i>
                               יתווספו <strong 
                                   style="color:#2e7d32;">
                                   ${newTasks.length}
                               </strong> משימות חדשות`
                    : `<i class="fas fa-info-circle" 
                                  style="color:#ff9800;"></i>
                               אין משימות חדשות לייבוא`
                }
                    </div>

                    <div style="display:flex; gap:10px;">
                        <button 
                            onclick="
                                document.getElementById(
                                    'importPreviewModal').remove();
                                window._importResolve(false);"
                            style="
                                padding: 10px 20px; 
                                background: #f0f0f0;
                                border: none; border-radius: 8px;
                                cursor: pointer; font-weight: 600;
                                font-size: 0.9rem; color: #555;
                            ">
                            ביטול
                        </button>

                        <button 
                            onclick="
                                document.getElementById(
                                    'importPreviewModal').remove();
                                window._importResolve(true);"
                            ${newTasks.length === 0 ? 'disabled' : ''}
                            style="
                                padding: 10px 22px;
                                background: ${newTasks.length === 0
                    ? '#ccc'
                    : 'linear-gradient(135deg,#667eea,#764ba2)'};
                                color: white; border: none;
                                border-radius: 8px; cursor: ${newTasks.length === 0
                    ? 'not-allowed' : 'pointer'};
                                font-weight: 700; font-size: 0.9rem;
                                display: flex; align-items: center;
                                gap: 8px;
                            ">
                            <i class="fas fa-file-import"></i>
                            ייבא ${newTasks.length} משימות חדשות
                        </button>
                    </div>
                </div>

            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', previewHTML);
            window._importResolve = resolve;

            // הגדר פונקציית החלפת טאב
            window.switchImportTab = (tab) => {
                const rows = document.querySelectorAll('.import-row');
                const tabAll = document.getElementById('tabAll');
                const tabNew = document.getElementById('tabNew');
                const tabExisting = document.getElementById('tabExisting');

                // עדכן סגנון טאבים
                const activeStyle = `
                background: linear-gradient(135deg,#667eea,#764ba2);
                color: white;
                border-bottom: 3px solid #667eea;
            `;
                const inactiveStyle = `
                background: white;
                color: #555;
                border-bottom: 3px solid transparent;
            `;

                tabAll.style.cssText += inactiveStyle;
                tabNew.style.cssText += inactiveStyle;
                tabExisting.style.cssText += inactiveStyle;

                if (tab === 'all') {
                    tabAll.style.cssText += activeStyle;
                    tabAll.style.color = 'white';
                } else if (tab === 'new') {
                    tabNew.style.cssText += activeStyle;
                    tabNew.style.color = 'white';
                } else {
                    tabExisting.style.cssText += activeStyle;
                    tabExisting.style.color = 'white';
                }

                // הצג/הסתר שורות
                rows.forEach(row => {
                    const exists = row.dataset.exists === 'true';
                    if (tab === 'all') {
                        row.style.display = '';
                    } else if (tab === 'new') {
                        row.style.display = exists ? 'none' : '';
                    } else {
                        row.style.display = exists ? '' : 'none';
                    }
                });
            };
        });
    }

    exportTasksToExcel() {
        // ← שנה ל-async
        this._exportTasksToExcelAsync();
    }

    async _exportTasksToExcelAsync() {
        try {
            if (!this.employeeTasks || this.employeeTasks.length === 0) {
                NotificationManager.show('אין משימות לייצוא', 'warning');
                return;
            }

            // ─── טען ExcelJS + FileSaver ───────────────────────────────
            if (typeof ExcelJS === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                    document.head.appendChild(s);
                });
            }
            if (typeof saveAs === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                    document.head.appendChild(s);
                });
            }

            // קבל משימות מסוננות ומסודרות
            let tasksToExport = this.filterTasks(this.employeeTasks);
            tasksToExport = this.sortTasks(tasksToExport);

            // ─── צבעים ────────────────────────────────────────────────
            const C = {
                headerBg: '667eea',
                headerFont: 'FFFFFF',
                // סטטוס
                statusDone: 'c8f7c5',
                statusInProg: 'ffeaa7',
                statusWait: 'dfe6e9',
                statusCancel: 'ffcccc',
                statusNew: 'e8f4fd',
                // עדיפות
                prioHigh: 'ffe0e0',
                prioMed: 'fff8e0',
                prioLow: 'e0f0e0',
                // התקדמות
                prog100: '00b894',
                prog75: 'fdcb6e',
                prog50: '74b9ff',
                prog25: 'a29bfe',
                prog0: 'f0f0f0',
                // שורות
                rowEven: 'ffffff',
                rowOdd: 'f8f9ff',
                // סיכום
                summaryTitle: '667eea',
                summaryHeader: 'f0f4ff',
                border: 'cccccc',
            };

            // ─── פונקציות עזר ─────────────────────────────────────────
            const thinBorder = () => ({
                top: { style: 'thin', color: { argb: 'FF' + C.border } },
                bottom: { style: 'thin', color: { argb: 'FF' + C.border } },
                left: { style: 'thin', color: { argb: 'FF' + C.border } },
                right: { style: 'thin', color: { argb: 'FF' + C.border } },
            });

            const medBorder = () => ({
                top: { style: 'medium', color: { argb: 'FF4a5568' } },
                bottom: { style: 'medium', color: { argb: 'FF4a5568' } },
                left: { style: 'medium', color: { argb: 'FF4a5568' } },
                right: { style: 'medium', color: { argb: 'FF4a5568' } },
            });

            const applyStyle = (cell, {
                bgColor = null,
                fontColor = '333333',
                bold = false,
                hAlign = 'right',
                fontSize = 10,
                wrapText = false,
                border = 'thin',
            } = {}) => {
                cell.font = {
                    name: 'Arial',
                    size: fontSize,
                    bold,
                    color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign,
                    vertical: 'middle',
                    wrapText,
                    readingOrder: 2, // RTL
                };
                cell.border = border === 'medium' ? medBorder() : thinBorder();
                if (bgColor) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            // ─── צבע לפי סטטוס ────────────────────────────────────────
            const getStatusBg = (s) => {
                if (s === 'בוצע') return C.statusDone;
                if (s === 'בביצוע') return C.statusInProg;
                if (s === 'ממתין') return C.statusWait;
                if (s === 'מבוטלת') return C.statusCancel;
                return C.statusNew;
            };

            // ─── צבע לפי עדיפות ───────────────────────────────────────
            const getPrioBg = (p) => {
                if (p === 'high') return C.prioHigh;
                if (p === 'medium') return C.prioMed;
                if (p === 'low') return C.prioLow;
                return C.rowEven;
            };

            // ─── צבע לפי אחוז התקדמות ─────────────────────────────────
            const getProgBg = (pct) => {
                if (pct >= 100) return C.prog100;
                if (pct >= 75) return C.prog75;
                if (pct >= 50) return C.prog50;
                if (pct >= 25) return C.prog25;
                return C.prog0;
            };

            const getProgFont = (pct) => pct >= 50 ? 'FFFFFF' : '333333';

            // ─── כותרות עמודות ────────────────────────────────────────
            const COLS = [
                { key: 'title', header: 'כותרת', width: 32 },
                { key: 'description', header: 'תיאור', width: 42 },
                { key: 'status', header: 'סטטוס', width: 12 },
                { key: 'priority', header: 'עדיפות', width: 12 },
                { key: 'progress', header: 'התקדמות (%)', width: 14 },
                { key: 'employee', header: 'עובד', width: 22 },
                { key: 'createdAt', header: 'תאריך יצירה', width: 14 },
                { key: 'dueDate', header: 'תאריך יעד', width: 14 },
                { key: 'completedTime', header: 'זמן השלמה', width: 14 },
                { key: 'skipReason', header: 'סיבת ביטול', width: 22 },
            ];

            // ─── בנה גליון ────────────────────────────────────────────
            const buildWorksheet = (wb, tasks, sheetName) => {
                const ws = wb.addWorksheet(sheetName, {
                    views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }],
                    properties: { defaultRowHeight: 18 },
                });

                ws.columns = COLS.map(c => ({
                    header: c.header,
                    key: c.key,
                    width: c.width,
                }));

                // ── עיצוב שורת כותרות ──
                const headerRow = ws.getRow(1);
                headerRow.height = 26;
                headerRow.eachCell(cell => {
                    applyStyle(cell, {
                        bgColor: C.headerBg,
                        fontColor: C.headerFont,
                        bold: true,
                        hAlign: 'center',
                        fontSize: 11,
                        border: 'medium',
                    });
                });

                // ── הוסף שורות נתונים ──
                tasks.forEach((task, rowIdx) => {
                    const employee = this.employees.find(
                        emp => emp.id === task.employeeId
                    );
                    const empName = employee ? employee.name : '';
                    const pct = task.progress || 0;

                    const priorityLabel =
                        task.priority === 'high' ? 'גבוהה' :
                            task.priority === 'medium' ? 'בינונית' :
                                task.priority === 'low' ? 'נמוכה' : '';

                    const rowBg = rowIdx % 2 === 0 ? C.rowEven : C.rowOdd;

                    const rowData = {
                        title: task.title || '',
                        description: task.description || '',
                        status: task.status || '',
                        priority: priorityLabel,
                        progress: pct,
                        employee: empName,
                        createdAt: task.createdAt
                            ? this.formatDate(task.createdAt) : '',
                        dueDate: task.dueDate
                            ? this.formatDate(task.dueDate) : '',
                        completedTime: task.completedTime || '',
                        skipReason: task.skipReason || '',
                    };

                    const excelRow = ws.addRow(rowData);
                    excelRow.height = 17;

                    excelRow.eachCell((cell, colNum) => {
                        const colKey = COLS[colNum - 1]?.key;
                        let bg = rowBg;
                        let fontCol = '333333';
                        let hAlign = 'right';
                        let bold = false;
                        let wrapText = false;
                        let fontSize = 10;

                        switch (colKey) {
                            case 'status':
                                bg = getStatusBg(task.status);
                                hAlign = 'center';
                                bold = true;
                                break;
                            case 'priority':
                                bg = getPrioBg(task.priority);
                                hAlign = 'center';
                                bold = true;
                                break;
                            case 'progress':
                                bg = getProgBg(pct);
                                fontCol = getProgFont(pct);
                                hAlign = 'center';
                                bold = true;
                                // הוסף סימן אחוז
                                cell.numFmt = '0"%"';
                                break;
                            case 'createdAt':
                            case 'dueDate':
                            case 'completedTime':
                                hAlign = 'center';
                                break;
                            case 'description':
                            case 'skipReason':
                                wrapText = true;
                                break;
                            case 'title':
                                bold = true;
                                break;
                        }

                        applyStyle(cell, {
                            bgColor: bg,
                            fontColor: fontCol,
                            bold,
                            hAlign,
                            wrapText,
                            fontSize,
                        });
                    });
                });

                return ws;
            };

            // ─── חלוקה לגליונות לפי סטטוס ────────────────────────────
            const completed = tasksToExport.filter(t => t.status === 'בוצע');
            const inProgress = tasksToExport.filter(t => t.status === 'בביצוע');
            const pending = tasksToExport.filter(t => t.status === 'ממתין');
            const newTasks = tasksToExport.filter(
                t => t.status === 'חדש' || !t.status
            );
            const cancelled = tasksToExport.filter(t => t.status === 'מבוטלת');

            // ─── בנה Workbook ──────────────────────────────────────────
            const wb = new ExcelJS.Workbook();
            wb.creator = 'EmployeeTasksManager';
            wb.created = new Date();
            wb.modified = new Date();

            // גליון ראשי
            buildWorksheet(wb, tasksToExport, 'כל המשימות');

            // גליונות לפי סטטוס
            if (completed.length > 0)
                buildWorksheet(wb, completed, 'בוצע');
            if (inProgress.length > 0)
                buildWorksheet(wb, inProgress, 'בביצוע');
            if (pending.length > 0)
                buildWorksheet(wb, pending, 'ממתין');
            if (newTasks.length > 0)
                buildWorksheet(wb, newTasks, 'חדש');
            if (cancelled.length > 0)
                buildWorksheet(wb, cancelled, 'מבוטלת');

            // ─── גליון סיכום ──────────────────────────────────────────
            const summaryWs = wb.addWorksheet('סיכום', {
                views: [{ rightToLeft: true }],
            });
            summaryWs.columns = [
                { key: 'label', width: 32 },
                { key: 'value', width: 16 },
            ];

            const avgProgress = Math.round(
                tasksToExport.reduce((s, t) => s + (t.progress || 0), 0) /
                (tasksToExport.length || 1)
            );

            const summaryRows = [
                { label: 'סיכום משימות', value: '', isTitle: true },
                { label: '', value: '', isTitle: false },
                { label: 'סה"כ משימות', value: tasksToExport.length },
                { label: 'בוצע', value: completed.length },
                { label: 'בביצוע', value: inProgress.length },
                { label: 'ממתין', value: pending.length },
                { label: 'חדש', value: newTasks.length },
                { label: 'מבוטלת', value: cancelled.length },
                { label: '', value: '' },
                { label: 'ממוצע התקדמות', value: avgProgress + '%' },
                {
                    label: 'תאריך ייצוא',
                    value: new Date().toLocaleDateString('he-IL')
                },
            ];

            summaryRows.forEach((item, idx) => {
                const row = summaryWs.addRow([item.label, item.value]);
                row.height = item.isTitle ? 28 : 20;

                row.eachCell((cell, colNum) => {
                    const isTitle = item.isTitle;
                    const isHeader = colNum === 1 && idx > 1 && item.label !== '';

                    applyStyle(cell, {
                        bgColor: isTitle ? C.summaryTitle :
                            isHeader ? C.summaryHeader : 'ffffff',
                        fontColor: isTitle ? 'FFFFFF' : '333333',
                        bold: isTitle || isHeader,
                        hAlign: colNum === 2 ? 'center' : 'right',
                        fontSize: isTitle ? 13 : 11,
                        border: idx > 1 ? 'thin' : null,
                    });
                });
            });

            // מיזוג כותרת
            summaryWs.mergeCells('A1:B1');

            // ─── הורד קובץ ────────────────────────────────────────────
            const employeeId = document.getElementById('employeeSelect')?.value;
            const employee = this.employees.find(e => e.id === employeeId);
            const employeeName = employee ? employee.name : 'כל_העובדים';
            const dateStr = this.currentDate
                || new Date().toISOString().split('T')[0];
            const fileName = `משימות_${employeeName}_${dateStr}.xlsx`;

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            saveAs(blob, fileName);

            NotificationManager.show(
                `${tasksToExport.length} משימות יוצאו לאקסל (${[
                    completed.length > 0 ? `${completed.length} בוצעו` : '',
                    inProgress.length > 0 ? `${inProgress.length} בביצוע` : '',
                    pending.length > 0 ? `${pending.length} ממתין` : '',
                    newTasks.length > 0 ? `${newTasks.length} חדש` : '',
                    cancelled.length > 0 ? `${cancelled.length} מבוטלות` : '',
                ].filter(Boolean).join(' • ')
                })`,
                'success'
            );

        } catch (error) {
            console.error('Error exporting tasks to Excel:', error);
            NotificationManager.show(
                'שגיאה בייצוא לאקסל: ' + error.message,
                'error'
            );
        }
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

function getEstimatedTime() {
    return document.getElementById('employeeTaskTime').value || '';
}

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
// ============================================================
// אתחול - בלוק יחיד מאוחד
// ============================================================
let employeeTasksManager;

document.addEventListener('DOMContentLoaded', function () {

    // ── אתחול Manager ────────────────────────────────────────
    employeeTasksManager = new EmployeeTasksManager();
    employeeTasksManager.initialize();

    // ── Form Submit (פעם אחת בלבד!) ──────────────────────────
    const taskForm = document.getElementById('addEmployeeTaskForm');
    if (taskForm) {
        taskForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const formData = {
                taskId: document.getElementById('employeeTaskId')?.value || '',
                employeeId: document.getElementById('selectedEmployeeSelect')?.value || '',
                date: document.getElementById('employeeTaskAssignDate')?.value || '',
                title: document.getElementById('employeeTaskTitle')?.value || '',
                description: document.getElementById('employeeTaskDescription')?.value || '',
                priority: document.getElementById('employeeTaskPriority')?.value || '',
                dueDate: getDueDate(),
                estimatedTime: getEstimatedTime(),
                progress: 0
            };

            if (!formData.employeeId || formData.employeeId === 'ALL_EMPLOYEES') {
                alert('אנא בחר עובד');
                return;
            }

            employeeTasksManager.saveEmployeeTask(formData);
        });
    }

    // ── Employee Select Change ────────────────────────────────
    const empSelect = document.getElementById('employeeSelect');
    if (empSelect) {
        empSelect.addEventListener('change', function () {
            updateEmployeeTaskButtons();
            employeeTasksManager.loadEmployeeTasks();
        });
    }

    // ── Modal Employee Select Change ──────────────────────────
    const selectedEmployeeSelect = document.getElementById('selectedEmployeeSelect');
    if (selectedEmployeeSelect) {
        selectedEmployeeSelect.addEventListener('change', function () {
            const assignedId = document.getElementById('assignedEmployeeId');
            if (assignedId) assignedId.value = this.value;
        });
    }

    // ── שחזור מצב סקציית פילטרים ─────────────────────────────
    const employeeFiltersCollapsed = localStorage.getItem(
        'employeeFiltersSectionCollapsed'
    );
    if (employeeFiltersCollapsed === 'true' || employeeFiltersCollapsed == null) {
        document.getElementById('employeeFiltersContent')
            ?.classList.add('collapsed');
        document.getElementById('employeeFiltersCollapseBtn')
            ?.classList.add('collapsed');
    }
});

