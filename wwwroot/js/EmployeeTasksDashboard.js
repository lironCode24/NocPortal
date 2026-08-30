class EmployeeTasksDashboard {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.employees = [];
        this.allTasks = [];
        this.searchTerm = '';
        this.filterStatus = 'active';
        this.LAST_EMPLOYEE_KEY = 'snLastSelectedEmployee';
        this.selectedEmployee = localStorage.getItem(this.LAST_EMPLOYEE_KEY) || 'ALL';
        this.refreshInterval = null;
        this.REFRESH_MS = 30 * 60 * 1000;

        // מיון
        this.SORT_MODE_KEY = 'snSortMode_v1';
        this.SORT_DIR_KEY = 'snSortDir_v1';
        this.sortMode = localStorage.getItem(this.SORT_MODE_KEY) || 'custom';
        this.sortDirection = localStorage.getItem(this.SORT_DIR_KEY) || 'desc';
        this.FREE_POSITIONS_KEY = 'snFreePositions_v1';
        this.freePositions = this.loadFreePositions();
        this.FREE_MODE_KEY = 'snFreeModeActive';
        this.freeMode = localStorage.getItem(this.FREE_MODE_KEY) === 'true';

        // סדר גרירה בתוך עמודות סטטוס
        this.STATUS_COL_ORDER_KEY = 'snStatusColOrder_v1';
        this.statusColOrder = this.loadStatusColOrder();

        // סדר גרירה
        this.DRAG_ORDER_KEY = 'snTaskDragOrder_v1';
        this.taskOrder = this.loadTaskOrder();

        // מצב גרירה
        this._dragState = null;

        // *** מצב מזעור פתקים ***
        this.MINIMIZED_NOTES_KEY = 'snMinimizedNotes_v1';
        this.minimizedNotes = this.loadMinimizedNotes();

        this.employeeColors = JSON.parse(
            localStorage.getItem('stickyEmployeeColors') || '{}'
        );

        this.PALETTE = [
            '#f9e04b', '#f9a84b', '#f96b6b',
            '#a8e6cf', '#84c5f4', '#d4a8f4',
            '#f4a8d4', '#a8f4e0',
        ];

        // *** צבעי סטטוס בלבד ***
        this.NOTE_COLORS = {
            done: '#d4edda', // ירוק בהיר
            cancelled: '#e2e3e5', // אפור
            overdue: '#f8d7da', // אדום בהיר
            active: '#f9e04b'  // צהוב קלאסי לכולם
        };

        // צבעי פתקים - מצב ברירת מחדל
        this.NOTE_COLOR_MODE = localStorage.getItem('snNoteColorMode') || 'status';
        // 'status' | 'progress' | 'priority' | 'employee' | 'custom'

        // צבעים מותאמים אישית לפתקים
        this.CUSTOM_NOTE_COLORS = JSON.parse(
            localStorage.getItem('snCustomNoteColors') || '{}'
        );

        // *** הרשאות משתמש ***
        this.currentUser = null;
        this.isPrivileged = false; // NOC/Admin
    }


    // ─── method: טעינת הרשאות ───
    async loadPermissions() {
        try {
            const res = await fetch('/EmployeeTasks/GetMyPermissions', {
                credentials: 'include'
            });
            const data = await res.json();
            if (!data.error) {
                this.currentUser = data;
                this.isPrivileged = data.isPrivileged === true;
            }
        } catch (err) {
            console.error('loadPermissions error:', err);
            this.isPrivileged = false;
        }
    }

    // ==========================================
    // אתחול
    // ==========================================
    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container #${this.containerId} not found`);
            return;
        }

        this.addStyles();
        this.renderShell();
        this.bindEvents();

        // *** טען הרשאות לפני הנתונים ***
        await this.loadPermissions();

        await this.loadData();
        this.restoreUIState();

        this.refreshInterval =
            setInterval(() => this.loadData(), this.REFRESH_MS);
    }

    loadMinimizedNotes() {
        try {
            return JSON.parse(
                localStorage.getItem(this.MINIMIZED_NOTES_KEY) || '{}'
            );
        } catch (e) { return {}; }
    }

    saveMinimizedNotes() {
        try {
            localStorage.setItem(
                this.MINIMIZED_NOTES_KEY,
                JSON.stringify(this.minimizedNotes)
            );
        } catch (e) { console.warn('saveMinimizedNotes error:', e); }
    }

    toggleAllNotes() {
        // אם לפחות פתק אחד פתוח - מזער הכל
        // אם הכל סגור - פותח הכל
        const visibleTasks = this.allTasks;
        const hasAnyOpen = visibleTasks.some(
            task => !this.minimizedNotes[task.id]
        );

        if (hasAnyOpen) {
            // מזער הכל
            visibleTasks.forEach(task => {
                this.minimizedNotes[task.id] = true;
            });
            this.showToast('🗜️ כל הפתקים מוזערו', 'info');
        } else {
            // פותח הכל
            this.minimizedNotes = {};
            this.showToast('📋 כל הפתקים הורחבו', 'info');
        }

        this.saveMinimizedNotes();
        this.updateToggleAllBtn();
        this.renderBoard();
    }

    updateToggleAllBtn() {
        const btn = document.getElementById('snToggleAllBtn');
        if (!btn) return;

        const hasAnyOpen = this.allTasks.some(
            task => !this.minimizedNotes[task.id]
        );

        if (hasAnyOpen) {
            btn.innerHTML = '<i class="fas fa-compress-alt"></i>';
            btn.title = 'מזער את כל הפתקים';
            btn.classList.remove('sn-toggle-all-expand');
            btn.classList.add('sn-toggle-all-collapse');
        } else {
            btn.innerHTML = '<i class="fas fa-expand-alt"></i>';
            btn.title = 'הרחב את כל הפתקים';
            btn.classList.remove('sn-toggle-all-collapse');
            btn.classList.add('sn-toggle-all-expand');
        }
    }

    toggleMinimizeNote(taskId) {
        if (this.minimizedNotes[taskId]) {
            delete this.minimizedNotes[taskId];
        } else {
            this.minimizedNotes[taskId] = true;
        }
        this.saveMinimizedNotes();
        this.renderBoard();
    }

    restoreUIState() {
        // שחזר כפתור Free/Grid
        const btn = document.getElementById('snFreeModeBtn');
        if (btn) {
            btn.classList.toggle('active', this.freeMode);
            btn.innerHTML = this.freeMode
                ? '<i class="fas fa-th"></i> Grid'
                : '<i class="fas fa-thumbtack"></i> Free';
        }

        // שחזר מצב סלקט מיון
        this.updateSortSelectState();

        // *** שחזר סדר מיון אחרון ***
        const sortSelect = document.getElementById('snSortSelect');
        if (sortSelect) {
            sortSelect.value = this.sortMode;
        }

        // *** שחזר כיוון מיון ***
        this.updateSortDirBtn();
    }

    updateSortDirBtn() {
        const btn = document.getElementById('snSortDirBtn');
        const icon = document.getElementById('snSortDirIcon');
        if (!btn || !icon) return;

        // הסתר כפתור כיוון במצב custom (גרירה) ו-statusColumns
        const hideDir = (this.sortMode === 'custom' ||
            this.sortMode === 'statusColumns' ||
            this.freeMode);
        btn.style.display = hideDir ? 'none' : 'flex';

        if (this.sortDirection === 'asc') {
            icon.className = 'fas fa-sort-amount-up';
            btn.title = 'מיון עולה - לחץ להפוך';
            btn.classList.remove('sn-sort-dir-desc');
            btn.classList.add('sn-sort-dir-asc');
        } else {
            icon.className = 'fas fa-sort-amount-down';
            btn.title = 'מיון יורד - לחץ להפוך';
            btn.classList.remove('sn-sort-dir-asc');
            btn.classList.add('sn-sort-dir-desc');
        }
    }

    destroy() {
        if (this.refreshInterval)
            clearInterval(this.refreshInterval);
    }

    loadFreePositions() {
        try {
            return JSON.parse(
                localStorage.getItem(this.FREE_POSITIONS_KEY) || '{}'
            );
        } catch (e) { return {}; }
    }

    saveFreePositions() {
        try {
            localStorage.setItem(
                this.FREE_POSITIONS_KEY,
                JSON.stringify(this.freePositions)
            );
        } catch (e) { console.warn('saveFreePositions error:', e); }
    }

    loadTaskOrder() {
        try {
            return JSON.parse(
                localStorage.getItem(this.DRAG_ORDER_KEY) || '{}'
            );
        } catch (e) { return {}; }
    }

    saveTaskOrder() {
        try {
            localStorage.setItem(
                this.DRAG_ORDER_KEY,
                JSON.stringify(this.taskOrder)
            );
        } catch (e) {
            console.warn('saveTaskOrder error:', e);
        }
    }

    sortTasks(tasks, empId) {
        const mode = this.sortMode;
        const dir = this.sortDirection === 'asc' ? 1 : -1;

        if (mode === 'custom') {
            const savedOrder = this.taskOrder[empId] || [];
            if (savedOrder.length === 0) return [...tasks];

            const ordered = [];
            const remaining = [...tasks];

            savedOrder.forEach(id => {
                const idx = remaining.findIndex(t => t.id === id);
                if (idx !== -1) {
                    ordered.push(remaining.splice(idx, 1)[0]);
                }
            });

            return [...ordered, ...remaining];
        }

        const copy = [...tasks];

        if (mode === 'undone-first') {
            return copy.sort((a, b) => {
                const aDone = (a.status === 'בוצע' || a.status === 'מבוטלת') ? 1 : 0;
                const bDone = (b.status === 'בוצע' || b.status === 'מבוטלת') ? 1 : 0;
                return (aDone - bDone) * dir;
            });
        }

        if (mode === 'status') {
            const statusOrder = {
                'בביצוע': 0, 'חדש': 1,
                'ממתין': 2, 'בוצע': 3, 'מבוטלת': 4
            };
            return copy.sort((a, b) =>
                ((statusOrder[a.status] ?? 5) -
                    (statusOrder[b.status] ?? 5)) * dir
            );
        }

        if (mode === 'priority') {
            const priorityOrder = { high: 0, medium: 1, low: 2 };
            return copy.sort((a, b) =>
                ((priorityOrder[a.priority] ?? 3) -
                    (priorityOrder[b.priority] ?? 3)) * dir
            );
        }

        if (mode === 'dueDate') {
            return copy.sort((a, b) => {
                if (!a.dueDate && !b.dueDate) return 0;
                if (!a.dueDate) return 1;   // ללא תאריך - לסוף תמיד
                if (!b.dueDate) return -1;  // ללא תאריך - לסוף תמיד
                return (new Date(a.dueDate) - new Date(b.dueDate)) * dir; // ← תוקן
            });
        }

        if (mode === 'title') {
            return copy.sort((a, b) =>
                (a.title || '').localeCompare(b.title || '', 'he') * dir
            );
        }

        if (mode === 'statusColumns') {
            return copy;
        }

        return copy;
    }

    makeDraggable(noteEl, empId) {
        noteEl.setAttribute('draggable', 'true');
        noteEl.classList.add('sn-draggable');

        noteEl.addEventListener('dragstart', e => {
            const taskId = noteEl.dataset.taskId;
            this._dragState = { taskId, empId, sourceEl: noteEl };
            noteEl.classList.add('sn-note-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', taskId);
            setTimeout(() => { noteEl.style.opacity = '0.35'; }, 0);
        });

        noteEl.addEventListener('dragend', () => {
            noteEl.classList.remove('sn-note-dragging');
            noteEl.style.opacity = '';
            this._dragState = null;
            document.querySelectorAll('.sn-drag-placeholder')
                .forEach(el => el.remove());
            document.querySelectorAll('.sn-notes-grid')
                .forEach(g => g.classList.remove('sn-drag-over'));
        });
    }

    makeDropZone(gridEl, empId) {
        gridEl.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!this._dragState) return;

            gridEl.classList.add('sn-drag-over');

            const afterEl = this.getDragAfterElement(gridEl, e.clientY);
            const existing = gridEl.querySelector('.sn-drag-placeholder');
            if (existing) existing.remove();

            const placeholder = document.createElement('div');
            placeholder.className = 'sn-drag-placeholder';

            if (!afterEl) {
                gridEl.appendChild(placeholder);
            } else {
                gridEl.insertBefore(placeholder, afterEl);
            }
        });

        gridEl.addEventListener('dragleave', e => {
            if (!gridEl.contains(e.relatedTarget)) {
                gridEl.classList.remove('sn-drag-over');
                const ph = gridEl.querySelector('.sn-drag-placeholder');
                if (ph) ph.remove();
            }
        });

        gridEl.addEventListener('drop', e => {
            e.preventDefault();
            gridEl.classList.remove('sn-drag-over');
            if (!this._dragState) return;

            const { taskId } = this._dragState;
            const placeholder = gridEl.querySelector('.sn-drag-placeholder');

            const newOrder = [];
            gridEl.childNodes.forEach(child => {
                if (child.classList?.contains('sn-drag-placeholder')) {
                    newOrder.push(taskId);
                } else if (child.dataset?.taskId &&
                    child.dataset.taskId !== taskId) {
                    newOrder.push(child.dataset.taskId);
                }
            });

            if (!newOrder.includes(taskId)) newOrder.push(taskId);
            if (placeholder) placeholder.remove();

            this.taskOrder[empId] = newOrder;
            this.saveTaskOrder();
            this.renderBoard();
            this.showToast('✅ הסדר נשמר', 'success');
        });
    }

    getDragAfterElement(container, y) {
        const els = [
            ...container.querySelectorAll(
                '.sn-note:not(.sn-note-dragging)'
            )
        ];

        if (els.length === 0) return null;

        // מצא את האלמנט הקרוב ביותר מעל ומתחת
        let closestAbove = null;
        let closestAboveOffset = Number.NEGATIVE_INFINITY;
        let closestBelow = null;
        let closestBelowOffset = Number.POSITIVE_INFINITY;

        els.forEach(child => {
            const box = child.getBoundingClientRect();
            const midpoint = box.top + box.height / 2;
            const offset = y - midpoint;

            if (offset < 0 && offset > closestAboveOffset) {
                // האלמנט נמצא מתחת לעכבר
                closestAboveOffset = offset;
                closestAbove = child;
            } else if (offset >= 0 && offset < closestBelowOffset) {
                // האלמנט נמצא מעל העכבר
                closestBelowOffset = offset;
                closestBelow = child;
            }
        });

        return closestAbove;
    }

    // ==========================================
    // טעינת נתונים
    // ==========================================
    async loadData() {
        try {
            this.showLoading(true);

            // טען עובדים
            const empRes = await fetch('/EmployeeTasks/GetEmployees', {
                credentials: 'include'
            });
            const empData = await empRes.json();

            if (!empData.error) {
                this.employees = empData || [];

                // *** אם לא מורשה - סנן רק את העובד שלו ***
                if (!this.isPrivileged && this.currentUser) {
                    this.employees = this.employees.filter(
                        emp => emp.id === this.currentUser.employeeId
                    );
                    // כפה בחירת העובד שלו
                    this.selectedEmployee =
                        this.currentUser.employeeId || 'ALL';
                }

                this.employees.forEach((emp, i) => {
                    if (!this.employeeColors[emp.id]) {
                        this.employeeColors[emp.id] =
                            this.PALETTE[i % this.PALETTE.length];
                    }
                });
                localStorage.setItem(
                    'stickyEmployeeColors',
                    JSON.stringify(this.employeeColors)
                );
                // עדכן את ה-dropdown של העובדים
                this.populateEmployeeDropdown();
            }

            // טען משימות
            const today = new Date().toISOString().split('T')[0];

            let tasks = [];

            if (this.isPrivileged) {
                // *** NOC/Admin: טען משימות רגילות כמו קודם ***
                const empParam = this.selectedEmployee === 'ALL'
                    ? 'ALL_EMPLOYEES'
                    : this.selectedEmployee;

                const taskRes = await fetch(
                    `/EmployeeTasks/GetEmployeeTasks` +
                    `?employeeId=${empParam}&date=${today}`,
                    { credentials: 'include' }
                );
                const taskData = await taskRes.json();
                if (!taskData.error) {
                    tasks = taskData.tasks || [];
                }
            } else {
                // *** משתמש רגיל: טען רק משימות אישיות ***
                const taskRes = await fetch(
                    `/EmployeeTasks/GetMyTasks?date=${today}`,
                    { credentials: 'include' }
                );
                const taskData = await taskRes.json();
                if (!taskData.error) {
                    tasks = taskData.tasks || [];
                }
            }

            this.allTasks = tasks;
            this.renderBoard();
            this.showLoading(false);

        } catch (err) {
            console.error('EmployeeTasksDashboard loadData error:', err);
            this.showLoading(false);
            this.showError('שגיאה בטעינת הנתונים');
        }
    }

    // ==========================================
    // מילוי dropdown עובדים
    // ==========================================
    populateEmployeeDropdown() {
        const select = document.getElementById('snEmployeeSelect');
        if (!select) return;

        if (!this.isPrivileged) {
            // *** משתמש רגיל: הסתר את ה-dropdown לגמרי ***
            const wrap = select.closest('.sn-emp-select-wrap');
            if (wrap) wrap.style.display = 'none';
            return;
        }

        // שחזר מ-localStorage או מהמצב הנוכחי
        const saved = localStorage.getItem(this.LAST_EMPLOYEE_KEY) || 'ALL';
        const current = this.selectedEmployee || saved;

        select.innerHTML = `<option value="ALL">👥 כל העובדים</option>`;
        this.employees.forEach(emp => {
            const color = this.employeeColors[emp.id] || '#f9e04b';
            const opt = document.createElement('option');
            opt.value = emp.id;
            opt.textContent = emp.name;
            opt.dataset.color = color;
            select.appendChild(opt);
        });

        // שחזר בחירה
        select.value = current;
        if (!select.value) select.value = 'ALL';

        // סנכרן את this.selectedEmployee
        this.selectedEmployee = select.value;
        // עדכן צבע הסלקט
        this.updateSelectColor(select);
        this.updateSortOptions();
    }

    updateSelectColor(select) {
        if (!select) return;
        const val = select.value;
        if (val === 'ALL') {
            select.style.borderColor = '#f9e04b';
            select.style.background = 'rgba(249,224,75,0.08)';
        } else {
            const color = this.employeeColors[val] || '#f9e04b';
            select.style.borderColor = color;
            select.style.background =
                `${color}18`; // 18 = ~10% opacity
        }
    }

    // ==========================================
    // רינדור מעטפת
    // ==========================================
    renderShell() {
        this.container.innerHTML = `
        <div class="sn-root">

            <!-- Header -->
            <div class="sn-header">
                <div class="sn-header-left">

                    <!-- בחירת עובד -->
                    <div class="sn-emp-select-wrap">
                        <i class="fas fa-user sn-emp-select-icon"></i>
                        <select id="snEmployeeSelect"
                                class="sn-emp-select">
                            <option value="ALL">👥 כל העובדים</option>
                        </select>
                    </div>

                    <!-- חיפוש -->
                    <div class="sn-search-wrap">
                        <i class="fas fa-search sn-search-icon"></i>
                        <input id="snSearchInput"
                               class="sn-search-input"
                               type="text"
                               placeholder="Search..."/>
                        <button id="snClearSearch"
                                class="sn-clear-search"
                                style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- סינון סטטוס -->
                    <div class="sn-filter-btns">
                        <button class="sn-filter-btn"
                                data-f="all">
                            <i class="fas fa-list"></i> All
                        </button>
                        <button class="sn-filter-btn active"
                                data-f="active">
                            <i class="fas fa-clock"></i> Active
                        </button>
                        <button class="sn-filter-btn"
                                data-f="overdue">
                            <i class="fas fa-exclamation-triangle"></i>
                            Overdue
                        </button>
                        <button class="sn-filter-btn"
                                data-f="done">
                            <i class="fas fa-check-circle"></i>
                            Done
                        </button>
                    </div>
                </div>
                <div class="sn-sort-wrap">
                    <select id="snSortSelect" class="sn-sort-select">
                        <option value="custom">Custom Order</option>
                        <option value="undone-first">Undone first</option>
                        <option value="status">By Status</option>
                        <option value="priority">By Priority</option>
                        <option value="dueDate">By Due Date</option>
                        <option value="title">By Title</option>
                        <option value="statusColumns" id="snSortStatusColumns">
                            By Status Columns
                        </option>
                    </select>
                    <button class="sn-sort-dir-btn" id="snSortDirBtn"
                            title="כיוון מיון">
                        <i class="fas fa-sort-amount-down" id="snSortDirIcon"></i>
                    </button>
                </div>
                <div class="sn-header-right">
                    <!-- מונה משימות -->
                    <div class="sn-tasks-counter" id="snTasksCounter">
                    </div>
                    <button class="sn-color-mode-btn" id="snColorModeBtn" title="צבעי פתקים">
                        <i class="fas fa-palette"></i>
                    </button>
                    <button class="sn-freemode-btn" id="snFreeModeBtn" title="מצב פתקים חופשיים">
                        <i class="fas fa-thumbtack"></i> Free
                    </button>
                    <button class="sn-add-task-btn" id="snAddTaskBtn" title="הוסף משימה חדשה">
                        <i class="fas fa-plus"></i> Add task
                    </button>
                    <button class="sn-toggle-all-btn" id="snToggleAllBtn" title="מזער/הרחב את כל הפתקים">
                        <i class="fas fa-compress-alt"></i>
                    </button>
                    <button class="sn-export-btn"
                            id="snExportBtn"
                            title="ייצא לאקסל">
                        <i class="fas fa-file-excel"></i>
                    </button>
                    <button class="sn-refresh-btn"
                            id="snRefreshBtn"
                            title="רענן">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <span id="snLastRefresh"
                          class="sn-last-refresh"></span>
                </div>
            </div>

            <!-- הודעות -->
            <div id="snError"
                 class="sn-error"
                 style="display:none"></div>
            <div id="snLoading"
                 class="sn-loading"
                 style="display:none">
                <i class="fas fa-spinner fa-spin"></i>
                טוען נתונים...
            </div>

            <!-- Toast הודעה -->
            <div id="snToast" class="sn-toast"></div>

            <!-- לוח הפתקים -->
            <div class="sn-board" id="snBoard"></div>

        </div>`;
    }

    // ==========================================
    // רינדור הלוח - עם grid דינמי
    // ==========================================
    renderBoard() {
        const board = document.getElementById('snBoard');
        if (!board) return;

        board.innerHTML = '';

        // עדכן מצב סלקט מיון בכל רינדור
        this.updateSortSelectState();

        // מצב Free Placement
        if (this.freeMode && this.selectedEmployee !== 'ALL') {
            board.classList.add('sn-board-free');
            board.classList.remove('sn-board-single-employee');
            board.style.gridTemplateColumns = '';
            this.renderFreeBoard(board);
            this.updateToggleAllBtn();
            this.updateLastRefresh();
            return;
        }

        // אם יצאנו מ-freeMode - הסר class
        board.classList.remove('sn-board-free');

        if (this.sortMode === 'statusColumns' &&
            this.selectedEmployee !== 'ALL') {
            board.classList.add('sn-board-single-employee');
            board.classList.remove('sn-board-status-columns');
            board.classList.add('sn-board-status-columns');
            board.style.gridTemplateColumns = '1fr';
            this.renderStatusColumns(board);
            this.updateToggleAllBtn();
            this.updateLastRefresh();
            return;
        }

        board.classList.remove('sn-board-status-columns');

        if (this.selectedEmployee !== 'ALL') {
            board.classList.add('sn-board-single-employee');
        } else {
            board.classList.remove('sn-board-single-employee');
        }

        const tasksByEmployee = this.getFilteredTasksByEmployee();
        const employeeCount = Object.keys(tasksByEmployee).length;
        const totalVisible = Object.values(tasksByEmployee)
            .reduce((s, d) => s + d.tasks.length, 0);

        // *** עדכון דינמי של grid-template-columns ***
        if (this.selectedEmployee === 'ALL') {
            const cols = Math.min(employeeCount, 8); // מקסימום 8
            const minCols = Math.max(cols, 1);
            board.style.gridTemplateColumns =
                `repeat(${minCols}, 1fr)`;
        } else {
            board.style.gridTemplateColumns = '1fr';
        }

        // עדכן מונה
        const counter = document.getElementById('snTasksCounter');
        if (counter) {
            counter.textContent =
                totalVisible > 0 ? `${totalVisible} Tasks` : '';
        }

        if (employeeCount === 0) {
            board.innerHTML = `
        <div class="sn-empty">
            <i class="fas fa-sticky-note"></i>
            <p>No tasks to show</p>
        </div>`;
            this.updateToggleAllBtn();
            this.updateLastRefresh();
            return;
        }

        Object.entries(tasksByEmployee).forEach(([empId, data]) => {
            board.appendChild(
                this.buildEmployeeColumn(empId, data)
            );
        });
        this.updateToggleAllBtn();
        this.updateLastRefresh();
    }

    openColorModePanel() {
        const existing = document.getElementById('snColorPanel');
        if (existing) { existing.remove(); return; }

        const panel = document.createElement('div');
        panel.id = 'snColorPanel';
        panel.className = 'sn-color-panel';

        panel.innerHTML = `
        <div class="sn-color-panel-header">
            <i class="fas fa-palette"></i>
            <span>צבעי פתקים</span>
            <button class="sn-color-panel-close" id="snColorPanelClose">
                &times;
            </button>
        </div>

        <div class="sn-color-panel-body">
            <p class="sn-color-panel-label">בחר לפי מה נקבע הצבע:</p>

            <div class="sn-color-mode-options">

                <label class="sn-color-mode-opt
                    ${this.NOTE_COLOR_MODE === 'status' ? 'active' : ''}">
                    <input type="radio" name="colorMode"
                           value="status"
                           ${this.NOTE_COLOR_MODE === 'status' ? 'checked' : ''}>
                    <i class="fas fa-info-circle"></i>
                    <span>לפי סטטוס</span>
                    <div class="sn-color-mode-preview">
                        <span style="background:#f9e04b"></span>
                        <span style="background:#d4edda"></span>
                        <span style="background:#f8d7da"></span>
                        <span style="background:#e2e3e5"></span>
                    </div>
                </label>

                <label class="sn-color-mode-opt
                    ${this.NOTE_COLOR_MODE === 'progress' ? 'active' : ''}">
                    <input type="radio" name="colorMode"
                        value="progress"
                        ${this.NOTE_COLOR_MODE === 'progress' ? 'checked' : ''}>
                    <i class="fas fa-tasks"></i>
                    <span>לפי אחוזי התקדמות</span>
                    <div class="sn-color-mode-preview">
                        <span style="background:#ff8a80"></span>
                        <span style="background:#ffd166"></span>
                        <span style="background:#f5ec45"></span>
                        <span style="background:#8de8a0"></span>
                        <span style="background:#3ea346"></span>
                    </div>
                </label>

                <label class="sn-color-mode-opt
                    ${this.NOTE_COLOR_MODE === 'priority' ? 'active' : ''}">
                    <input type="radio" name="colorMode"
                           value="priority"
                           ${this.NOTE_COLOR_MODE === 'priority' ? 'checked' : ''}>
                    <i class="fas fa-flag"></i>
                    <span>לפי עדיפות</span>
                    <div class="sn-color-mode-preview">
                        <span style="background:#fee2e2"></span>
                        <span style="background:#fef9c3"></span>
                        <span style="background:#dcfce7"></span>
                    </div>
                </label>

                <label class="sn-color-mode-opt
                    ${this.NOTE_COLOR_MODE === 'employee' ? 'active' : ''}">
                    <input type="radio" name="colorMode"
                           value="employee"
                           ${this.NOTE_COLOR_MODE === 'employee' ? 'checked' : ''}>
                    <i class="fas fa-user"></i>
                    <span>לפי עובד</span>
                    <div class="sn-color-mode-preview">
                        <span style="background:#f9e04b"></span>
                        <span style="background:#84c5f4"></span>
                        <span style="background:#a8e6cf"></span>
                    </div>
                </label>

                <label class="sn-color-mode-opt
                    ${this.NOTE_COLOR_MODE === 'custom' ? 'active' : ''}">
                    <input type="radio" name="colorMode"
                           value="custom"
                           ${this.NOTE_COLOR_MODE === 'custom' ? 'checked' : ''}>
                    <i class="fas fa-paint-brush"></i>
                    <span>צבע ידני לכל פתק</span>
                    <div class="sn-color-mode-preview">
                        <span style="background: linear-gradient(135deg,#f9e04b,#84c5f4,#f96b6b)"></span>
                    </div>
                </label>

            </div>

            <!-- תצוגה מקדימה של הצבעים -->
            <div class="sn-color-legend" id="snColorLegend">
                ${this.buildColorLegend()}
            </div>
        </div>
    `;

        document.body.appendChild(panel);

        // מיקום ליד כפתור הפלטה
        const colorBtn = document.getElementById('snColorModeBtn');
        if (colorBtn) {
            const rect = colorBtn.getBoundingClientRect();
            const panelW = 320;
            const viewportW = window.innerWidth;

            let leftPos = rect.left + window.scrollX;
            if (leftPos + panelW > viewportW - 100) {
                leftPos = viewportW - panelW - 100;
            }

            panel.style.position = 'fixed'; // fixed כדי לא להיות תלוי בגלילה
            panel.style.top = `${rect.bottom + 8}px`;
            panel.style.left = `${leftPos}px`;
            panel.style.transform = 'none'; // בטל את ה-translateX מה-CSS
        }

        // אירועים
        document.getElementById('snColorPanelClose')
            .addEventListener('click', () => panel.remove());

        panel.querySelectorAll('input[name="colorMode"]')
            .forEach(radio => {
                radio.addEventListener('change', e => {
                    this.NOTE_COLOR_MODE = e.target.value;
                    localStorage.setItem('snNoteColorMode', this.NOTE_COLOR_MODE);

                    // עדכן active class
                    panel.querySelectorAll('.sn-color-mode-opt')
                        .forEach(opt => opt.classList.remove('active'));
                    e.target.closest('.sn-color-mode-opt')
                        .classList.add('active');

                    // עדכן legend
                    const legend = document.getElementById('snColorLegend');
                    if (legend) legend.innerHTML = this.buildColorLegend();

                    this.renderBoard();
                });
            });

        // סגירה בלחיצה מחוץ
        setTimeout(() => {
            document.addEventListener('click', function handler(e) {
                if (!panel.contains(e.target) &&
                    !e.target.closest('#snColorModeBtn')) {
                    panel.remove();
                    document.removeEventListener('click', handler);
                }
            });
        }, 100);
    }

    buildColorLegend() {
        const mode = this.NOTE_COLOR_MODE;

        if (mode === 'status') {
            return `
            <div class="sn-legend-title">מקרא צבעים:</div>
            <div class="sn-legend-items">
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#f9e04b"></span>
                    פעיל
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#d4edda"></span>
                    בוצע
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#f8d7da"></span>
                    באיחור
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#e2e3e5"></span>
                    מבוטל
                </div>
            </div>`;
        }

        if (mode === 'progress') {
            return `
            <div class="sn-legend-title">מקרא צבעים:</div>
            <div class="sn-legend-items">
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#ff8a80"></span>
                    0%
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#ffab76"></span>
                    1% - 20%
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#ffd166"></span>
                    21% - 40%
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#f5ec45"></span>
                    41% - 60%
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#8de8a0"></span>
                    61% - 80%
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#5cd98a"></span>
                    81% - 99%
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                        style="background:#3ea346"></span>
                    100%
                </div>
            </div>`;
        }

        if (mode === 'priority') {
            return `
            <div class="sn-legend-title">מקרא צבעים:</div>
            <div class="sn-legend-items">
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#fee2e2"></span>
                    גבוהה
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#fef9c3"></span>
                    בינונית
                </div>
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:#dcfce7"></span>
                    נמוכה
                </div>
            </div>`;
        }

        if (mode === 'employee') {
            const items = this.employees.map(emp => {
                const color = this.employeeColors[emp.id] || '#f9e04b';
                return `
                <div class="sn-legend-item">
                    <span class="sn-legend-dot"
                          style="background:${color}"></span>
                    ${this.escHtml(emp.name)}
                </div>`;
            }).join('');
            return `
            <div class="sn-legend-title">מקרא צבעים:</div>
            <div class="sn-legend-items">${items}</div>`;
        }

        if (mode === 'custom') {
            return `
            <div class="sn-legend-title">
                לחץ על פתק כדי לשנות את צבעו
            </div>`;
        }

        return '';
    }

    getNoteColor(task) {
        const isDone = task.status === 'בוצע';
        const isCancelled = task.status === 'מבוטלת';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const isOverdue = task.dueDate && !isDone && !isCancelled &&
            new Date(task.dueDate) < today;

        const progress = task.progress || 0;
        const mode = this.NOTE_COLOR_MODE;

        // צבע ידני גובר רק כשמצב הצבע הוא 'custom'
        if (mode === 'custom' && this.CUSTOM_NOTE_COLORS[task.id]) {
            return this.CUSTOM_NOTE_COLORS[task.id];
        }

        if (mode === 'status') {
            if (isDone) return this.NOTE_COLORS.done;
            if (isCancelled) return this.NOTE_COLORS.cancelled;
            if (isOverdue) return this.NOTE_COLORS.overdue;
            return this.NOTE_COLORS.active;
        }

        if (mode === 'progress') {
            if (isCancelled) return '#e2e3e5';
            if (progress === 0) return '#ff8a80'; // אדום רך
            if (progress > 0 && progress <= 20) return '#ffab76'; // כתום רך
            if (progress > 20 && progress <= 40) return '#ffd166'; // צהוב-כתום
            if (progress > 40 && progress <= 60) return '#f5ec45'; // צהוב
            if (progress > 60 && progress <= 80) return '#8de8a0'; // ירוק רך
            if (progress > 80 && progress < 100) return '#5cd98a'; // ירוק בינוני
            return '#3ea346';                                        // 100% ירוק-טורקיז
        }

        if (mode === 'priority') {
            if (isDone) return '#d4edda';
            if (isCancelled) return '#e2e3e5';
            if (task.priority === 'high') return '#fee2e2';
            if (task.priority === 'medium') return '#fef9c3';
            return '#dcfce7';
        }

        if (mode === 'employee') {
            return this.employeeColors[task.employeeId] || '#f9e04b';
        }

        // ברירת מחדל
        if (isDone) return this.NOTE_COLORS.done;
        if (isCancelled) return this.NOTE_COLORS.cancelled;
        if (isOverdue) return this.NOTE_COLORS.overdue;
        return this.NOTE_COLORS.active;
    }

    openColorPicker(taskId, anchorEl) {
        const existing = document.getElementById('snMiniColorPicker');
        if (existing) existing.remove();

        const colors = [
            '#f9e04b', '#f9a84b', '#f96b6b',
            '#a8e6cf', '#84c5f4', '#d4a8f4',
            '#f4a8d4', '#a8f4e0', '#d4edda',
            '#fee2e2', '#fef9c3', '#e2e3e5',
            '#ffffff', '#ffe4b5', '#b0e0e6',
        ];

        const picker = document.createElement('div');
        picker.id = 'snMiniColorPicker';
        picker.className = 'sn-mini-color-picker';

        picker.innerHTML = `
        <div class="sn-mini-picker-title">בחר צבע לפתק</div>
        <div class="sn-mini-picker-grid">
            ${colors.map(c => `
                <button class="sn-mini-color-swatch
                    ${this.CUSTOM_NOTE_COLORS[taskId] === c ? 'selected' : ''}"
                    data-color="${c}"
                    style="background:${c}"
                    title="${c}">
                </button>`).join('')}
        </div>
        <div class="sn-mini-picker-footer">
            <button class="sn-mini-picker-reset" id="snColorReset">
                <i class="fas fa-undo"></i> איפוס
            </button>
            <input type="color"
                   id="snCustomColorInput"
                   class="sn-mini-custom-color"
                   value="${this.CUSTOM_NOTE_COLORS[taskId] || '#f9e04b'}"
                   title="צבע מותאם אישית">
        </div>
    `;

        // מיקום ליד הכפתור - בדיקה שלא יוצא מהמסך
        const rect = anchorEl.getBoundingClientRect();
        const pickerW = 220;
        const viewportW = window.innerWidth;

        let leftPos = rect.left + window.scrollX;

        // אם יוצא מימין - הזז שמאלה
        if (leftPos + pickerW > viewportW - 10) {
            leftPos = viewportW - pickerW - 10;
        }

        picker.style.top = `${rect.bottom + window.scrollY + 6}px`;
        picker.style.left = `${leftPos}px`;

        document.body.appendChild(picker);

        // בחירת צבע מהרשת
        picker.querySelectorAll('.sn-mini-color-swatch')
            .forEach(swatch => {
                swatch.addEventListener('click', () => {
                    const color = swatch.dataset.color;
                    this.CUSTOM_NOTE_COLORS[taskId] = color;
                    localStorage.setItem(
                        'snCustomNoteColors',
                        JSON.stringify(this.CUSTOM_NOTE_COLORS)
                    );
                    picker.remove();
                    this.renderBoard();
                });
            });

        // צבע מותאם אישית
        document.getElementById('snCustomColorInput')
            .addEventListener('change', e => {
                this.CUSTOM_NOTE_COLORS[taskId] = e.target.value;
                localStorage.setItem(
                    'snCustomNoteColors',
                    JSON.stringify(this.CUSTOM_NOTE_COLORS)
                );
                picker.remove();
                this.renderBoard();
            });

        // איפוס - מחק צבע מותאם וחזור לברירת מחדל
        document.getElementById('snColorReset')
            .addEventListener('click', () => {
                delete this.CUSTOM_NOTE_COLORS[taskId];
                localStorage.setItem(
                    'snCustomNoteColors',
                    JSON.stringify(this.CUSTOM_NOTE_COLORS)
                );
                picker.remove();
                this.renderBoard();
            });

        // סגירה בלחיצה מחוץ ל-picker
        setTimeout(() => {
            document.addEventListener('click', function handler(e) {
                if (!picker.contains(e.target) &&
                    !e.target.closest('.sn-color-pick-btn')) {
                    picker.remove();
                    document.removeEventListener('click', handler);
                }
            });
        }, 100);
    }

    renderFreeBoard(board) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // סינון רגיל
        let tasks = this.allTasks.filter(task => {
            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                const title = (task.title || '').toLowerCase();
                const desc = (task.description || '').toLowerCase();
                if (!title.includes(term) && !desc.includes(term))
                    return false;
            }
            switch (this.filterStatus) {
                case 'active':
                    return task.status !== 'בוצע' &&
                        task.status !== 'מבוטלת';
                case 'done':
                    return task.status === 'בוצע' ||
                        task.status === 'מבוטלת';
                case 'overdue': {
                    if (!task.dueDate) return false;
                    if (task.status === 'בוצע' ||
                        task.status === 'מבוטלת') return false;
                    const due = new Date(task.dueDate);
                    due.setHours(0, 0, 0, 0);
                    return due < today;
                }
                default: return true;
            }
        });

        // עדכן מונה
        const counter = document.getElementById('snTasksCounter');
        if (counter) {
            counter.textContent = tasks.length > 0
                ? `${tasks.length} Tasks` : '';
        }

        if (tasks.length === 0) {
            board.innerHTML = `
            <div class="sn-empty">
                <i class="fas fa-sticky-note"></i>
                <p>No tasks to show</p>
            </div>`;
            this.updateLastRefresh();
            return;
        }

        // *** כפתור איפוס סידור - הוסף לפני יצירת canvas ***
        const resetBar = document.createElement('div');
        resetBar.className = 'sn-free-toolbar';
        resetBar.innerHTML = `
    <button class="sn-free-reset-btn" id="snFreeResetBtn"
            title="איפוס מיקום כל הפתקים">
        <i class="fas fa-undo"></i> איפוס סידור
    </button>
    <span class="sn-free-hint">
        <i class="fas fa-info-circle"></i>
        גרור פתקים למיקום הרצוי
    </span>
`;
        board.appendChild(resetBar);

        document.getElementById('snFreeResetBtn')
            .addEventListener('click', () => this.resetFreePositions());

        // מיכל יחסי לפתקים
        const canvas = document.createElement('div');
        canvas.className = 'sn-free-canvas';
        canvas.id = 'snFreeCanvas';
        board.appendChild(canvas);

        // גודל ברירת מחדל לפתק
        const NOTE_W = 220;
        const NOTE_H = 200;
        const PADDING = 20;
        const canvasW = board.clientWidth || 900;

        tasks.forEach((task, i) => {
            const noteEl = this.buildNoteElement(task);
            noteEl.classList.add('sn-free-note');

            // מיקום שמור או ברירת מחדל (סידור אוטומטי ראשוני)
            const saved = this.freePositions[task.id];
            let x, y;

            if (saved) {
                x = saved.x;
                y = saved.y;
            } else {
                // סידור ראשוני - grid אוטומטי
                const cols = Math.floor(
                    (canvasW - PADDING) / (NOTE_W + PADDING)
                ) || 1;
                const col = i % cols;
                const row = Math.floor(i / cols);
                x = PADDING + col * (NOTE_W + PADDING);
                y = PADDING + row * (NOTE_H + PADDING);
            }

            noteEl.style.left = `${x}px`;
            noteEl.style.top = `${y}px`;
            noteEl.style.width = `${NOTE_W}px`;

            this.makeFreeNoteDraggable(noteEl, task.id);
            canvas.appendChild(noteEl);
        });

        // גובה ה-canvas לפי הפתק הכי נמוך
        this.updateCanvasHeight(canvas);
    }

    resetFreePositions() {
        if (!confirm('האם לאפס את מיקום כל הפתקים לסידור אוטומטי?'))
            return;
        this.freePositions = {};
        this.saveFreePositions();
        this.renderBoard();
        this.showToast('🔄 הסידור אופס', 'info');
    }

    makeFreeNoteDraggable(noteEl, taskId) {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        // גרירה רק מהכותרת/גוף - לא מכפתורים
        noteEl.addEventListener('mousedown', e => {
            // אל תתחיל גרירה אם לחצו על כפתור
            if (e.target.closest('button') ||
                e.target.closest('.sn-action-btns') ||
                e.target.closest('.sn-note-edit-actions') ||
                e.target.closest('.sn-note-progress-controls')) {
                return;
            }

            isDragging = true;
            noteEl.classList.add('sn-free-dragging');

            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(noteEl.style.left) || 0;
            startTop = parseInt(noteEl.style.top) || 0;

            // הבא לפני
            noteEl.style.zIndex = '1000';

            e.preventDefault();
        });

        document.addEventListener('mousemove', e => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = startLeft + dx;
            let newTop = startTop + dy;

            // גבולות - לא לצאת מהמסך
            const canvas = document.getElementById('snFreeCanvas');
            if (canvas) {
                const maxX = canvas.offsetWidth - noteEl.offsetWidth;
                const maxY = canvas.offsetHeight - noteEl.offsetHeight;
                newLeft = Math.max(0, Math.min(newLeft, maxX));
                newTop = Math.max(0, Math.min(newTop, maxY));
            }

            noteEl.style.left = `${newLeft}px`;
            noteEl.style.top = `${newTop}px`;
        });

        document.addEventListener('mouseup', e => {
            if (!isDragging) return;
            isDragging = false;
            noteEl.classList.remove('sn-free-dragging');
            noteEl.style.zIndex = '';

            // שמור מיקום
            const x = parseInt(noteEl.style.left) || 0;
            const y = parseInt(noteEl.style.top) || 0;
            this.freePositions[taskId] = { x, y };
            this.saveFreePositions();

            // עדכן גובה canvas
            const canvas = document.getElementById('snFreeCanvas');
            if (canvas) this.updateCanvasHeight(canvas);
        });
    }

    updateCanvasHeight(canvas) {
        let maxBottom = 400; // מינימום
        canvas.querySelectorAll('.sn-free-note').forEach(el => {
            const bottom = (parseInt(el.style.top) || 0) + el.offsetHeight + 40;
            if (bottom > maxBottom) maxBottom = bottom;
        });
        canvas.style.height = `${maxBottom}px`;
    }

    loadStatusColOrder() {
        try {
            return JSON.parse(
                localStorage.getItem(this.STATUS_COL_ORDER_KEY) || '{}'
            );
        } catch (e) { return {}; }
    }

    saveStatusColOrder() {
        try {
            localStorage.setItem(
                this.STATUS_COL_ORDER_KEY,
                JSON.stringify(this.statusColOrder)
            );
        } catch (e) { console.warn('saveStatusColOrder error:', e); }
    }

    renderStatusColumns(board) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // סינון לפי חיפוש בלבד
        let tasks = this.allTasks.filter(task => {
            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                const title = (task.title || '').toLowerCase();
                const desc = (task.description || '').toLowerCase();
                if (!title.includes(term) && !desc.includes(term))
                    return false;
            }
            return true;
        });

        // עדכן מונה
        const counter = document.getElementById('snTasksCounter');
        if (counter) {
            counter.textContent = tasks.length > 0
                ? `${tasks.length} Tasks` : '';
        }

        // הגדרת הטורים
        const statusDefs = [
            {
                key: 'חדש',
                label: 'חדש',
                icon: 'fas fa-star',
                color: '#6366f1',
                bgColor: 'rgba(99,102,241,0.1)',
                borderColor: 'rgba(99,102,241,0.3)'
            },
            {
                key: 'ממתין',
                label: 'ממתין',
                icon: 'fas fa-hourglass-half',
                color: '#f59e0b',
                bgColor: 'rgba(245,158,11,0.1)',
                borderColor: 'rgba(245,158,11,0.3)'
            },
            {
                key: 'בביצוע',
                label: 'בביצוע',
                icon: 'fas fa-spinner',
                color: '#3b82f6',
                bgColor: 'rgba(59,130,246,0.1)',
                borderColor: 'rgba(59,130,246,0.3)'
            },
            {
                key: 'בוצע',
                label: 'בוצע',
                icon: 'fas fa-check-circle',
                color: '#22c55e',
                bgColor: 'rgba(34,197,94,0.1)',
                borderColor: 'rgba(34,197,94,0.3)'
            },
            {
                key: 'מבוטלת',
                label: 'מבוטלת',
                icon: 'fas fa-times-circle',
                color: '#6b7280',
                bgColor: 'rgba(107,114,128,0.1)',
                borderColor: 'rgba(107,114,128,0.3)'
            },
        ];

        // *** כפתור איפוס כל הסדרים ***
        const hasAnyOrder = Object.keys(this.statusColOrder).length > 0;
        if (hasAnyOrder) {
            const resetAllBar = document.createElement('div');
            resetAllBar.className = 'sn-status-reset-bar';
            resetAllBar.innerHTML = `
        <button class="sn-status-reset-all-btn"
                id="snStatusResetAllBtn">
            <i class="fas fa-undo"></i>
            איפוס סדר כל העמודות
        </button>
        <span class="sn-free-hint">
            <i class="fas fa-info-circle"></i>
            גרור פתקים למיקום הרצוי
        </span>
    `;
            board.appendChild(resetAllBar);

            resetAllBar.querySelector('#snStatusResetAllBtn')
                .addEventListener('click', () => {
                    if (!confirm('לאפס את סדר כל העמודות?')) return;
                    this.statusColOrder = {};
                    this.saveStatusColOrder();
                    this.renderBoard();
                    this.showToast('🔄 כל הסדרים אופסו', 'info');
                });
        }

        // עטיפה חיצונית
        const wrapper = document.createElement('div');
        wrapper.className = 'sn-status-columns-wrapper';

        statusDefs.forEach(def => {
            let colTasks = tasks.filter(t =>
                t.status === def.key ||
                (!t.status && def.key === 'חדש')
            );

            // *** החל סדר שמור לעמודה זו ***
            const savedOrder = this.statusColOrder[def.key] || [];
            if (savedOrder.length > 0) {
                const ordered = [];
                const remaining = [...colTasks];

                savedOrder.forEach(id => {
                    const idx = remaining.findIndex(t => t.id === id);
                    if (idx !== -1) {
                        ordered.push(remaining.splice(idx, 1)[0]);
                    }
                });
                // משימות חדשות שאין להן סדר שמור - הוסף בסוף
                colTasks = [...ordered, ...remaining];
            }

            const col = document.createElement('div');
            col.className = 'sn-status-col';
            col.style.cssText = `
            background: ${def.bgColor};
            border: 1px solid ${def.borderColor};
            border-top: 3px solid ${def.color};
        `;

            // כותרת הטור עם כפתור איפוס סדר
            col.innerHTML = `
            <div class="sn-status-col-header"
                 style="color:${def.color}">
                <i class="${def.icon}"></i>
                <span>${def.label}</span>
                <span class="sn-status-col-count"
                      style="background:${def.color}22;
                             color:${def.color}">
                    ${colTasks.length}
                </span>
                ${savedOrder.length > 0 ? `
                <button class="sn-status-col-reset-btn"
                        data-status="${def.key}"
                        title="איפוס סדר עמודה"
                        style="
                            margin-right: auto;
                            background: none;
                            border: none;
                            color: ${def.color};
                            opacity: 0.5;
                            cursor: pointer;
                            font-size: 0.7rem;
                            padding: 2px 4px;
                            border-radius: 3px;
                            transition: opacity 0.2s;
                        ">
                    <i class="fas fa-undo"></i>
                </button>` : ''}
            </div>
            <div class="sn-status-col-body"
                 id="statusCol_${def.key}"
                 data-status-key="${def.key}">
            </div>
        `;

            const body = col.querySelector(`#statusCol_${def.key}`);

            if (colTasks.length === 0) {
                body.innerHTML = `
                <div class="sn-status-col-empty">
                    <i class="fas fa-inbox"></i>
                    <span>אין משימות</span>
                </div>`;
            } else {
                colTasks.forEach(task => {
                    const noteEl = this.buildNoteElement(task);
                    // *** הוסף draggable לכל פתק ***
                    noteEl.setAttribute('draggable', 'true');
                    noteEl.classList.add('sn-status-col-draggable');
                    body.appendChild(noteEl);
                });

                // *** הפוך את גוף העמודה לאזור drop ***
                this.makeStatusColDropZone(body, def.key);
            }

            // *** כפתור איפוס סדר עמודה ***
            const resetBtn = col.querySelector('.sn-status-col-reset-btn');
            if (resetBtn) {
                resetBtn.addEventListener('mouseenter', () => {
                    resetBtn.style.opacity = '1';
                });
                resetBtn.addEventListener('mouseleave', () => {
                    resetBtn.style.opacity = '0.5';
                });
                resetBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    const statusKey = resetBtn.dataset.status;
                    delete this.statusColOrder[statusKey];
                    this.saveStatusColOrder();
                    this.renderBoard();
                    this.showToast('🔄 סדר העמודה אופס', 'info');
                });
            }

            wrapper.appendChild(col);
        });

        board.appendChild(wrapper);
    }

    makeStatusColDropZone(bodyEl, statusKey) {
        // ── dragstart על כל פתק בעמודה ──
        bodyEl.querySelectorAll('.sn-status-col-draggable')
            .forEach(noteEl => {
                noteEl.addEventListener('dragstart', e => {
                    const taskId = noteEl.dataset.taskId;
                    this._statusColDragState = {
                        taskId,
                        statusKey,
                        sourceEl: noteEl
                    };
                    noteEl.classList.add('sn-status-col-dragging');
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', taskId);
                    setTimeout(() => {
                        noteEl.style.opacity = '0.35';
                    }, 0);
                });

                noteEl.addEventListener('dragend', () => {
                    noteEl.classList.remove('sn-status-col-dragging');
                    noteEl.style.opacity = '';
                    this._statusColDragState = null;

                    // נקה placeholders
                    document.querySelectorAll(
                        '.sn-status-col-placeholder'
                    ).forEach(el => el.remove());

                    // נקה drag-over
                    document.querySelectorAll(
                        '.sn-status-col-body'
                    ).forEach(b => b.classList.remove(
                        'sn-status-col-drag-over'
                    ));
                });
            });

        // ── dragover ──
        bodyEl.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!this._statusColDragState) return;

            // רק אם אותה עמודה
            if (this._statusColDragState.statusKey !== statusKey) return;

            bodyEl.classList.add('sn-status-col-drag-over');

            const afterEl = this.getStatusColDragAfter(bodyEl, e.clientY);
            const existing = bodyEl.querySelector(
                '.sn-status-col-placeholder'
            );
            if (existing) existing.remove();

            const placeholder = document.createElement('div');
            placeholder.className = 'sn-status-col-placeholder';

            if (!afterEl) {
                bodyEl.appendChild(placeholder);
            } else {
                bodyEl.insertBefore(placeholder, afterEl);
            }
        });

        // ── dragleave ──
        bodyEl.addEventListener('dragleave', e => {
            if (!bodyEl.contains(e.relatedTarget)) {
                bodyEl.classList.remove('sn-status-col-drag-over');
                const ph = bodyEl.querySelector(
                    '.sn-status-col-placeholder'
                );
                if (ph) ph.remove();
            }
        });

        // ── drop ──
        bodyEl.addEventListener('drop', e => {
            e.preventDefault();
            bodyEl.classList.remove('sn-status-col-drag-over');
            if (!this._statusColDragState) return;

            // רק אם אותה עמודה
            if (this._statusColDragState.statusKey !== statusKey) return;

            const { taskId } = this._statusColDragState;
            const placeholder = bodyEl.querySelector(
                '.sn-status-col-placeholder'
            );

            // בנה סדר חדש
            const newOrder = [];
            bodyEl.childNodes.forEach(child => {
                if (child.classList?.contains(
                    'sn-status-col-placeholder'
                )) {
                    newOrder.push(taskId);
                } else if (
                    child.dataset?.taskId &&
                    child.dataset.taskId !== taskId
                ) {
                    newOrder.push(child.dataset.taskId);
                }
            });

            if (!newOrder.includes(taskId)) newOrder.push(taskId);
            if (placeholder) placeholder.remove();

            // שמור סדר
            this.statusColOrder[statusKey] = newOrder;
            this.saveStatusColOrder();

            this.renderBoard();
            this.showToast('✅ הסדר נשמר', 'success');
        });
    }

    getStatusColDragAfter(container, y) {
        const els = [
            ...container.querySelectorAll(
                '.sn-status-col-draggable:not(.sn-status-col-dragging)'
            )
        ];

        return els.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset, element: child };
            }
            return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    // ==========================================
    // סינון וקיבוץ
    // ==========================================
    getFilteredTasksByEmployee() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let filtered = this.allTasks.filter(task => {
            // סינון לפי חיפוש
            if (this.searchTerm) {
                const term = this.searchTerm.toLowerCase();
                const title = (task.title || '').toLowerCase();
                const desc = (task.description || '').toLowerCase();
                if (!title.includes(term) && !desc.includes(term))
                    return false;
            }

            // סינון לפי סטטוס
            switch (this.filterStatus) {
                case 'active':
                    return task.status !== 'בוצע' &&
                        task.status !== 'מבוטלת';
                case 'done':
                    return task.status === 'בוצע' ||
                        task.status === 'מבוטלת';
                case 'overdue': {
                    if (!task.dueDate) return false;
                    if (task.status === 'בוצע' ||
                        task.status === 'מבוטלת') return false;
                    const due = new Date(task.dueDate);
                    due.setHours(0, 0, 0, 0);
                    return due < today;
                }
                default:
                    return true;
            }
        });

        // קבץ לפי עובד
        const byEmp = {};
        filtered.forEach(task => {
            const empId = task.employeeId;
            if (!byEmp[empId]) {
                const emp = this.employees.find(e => e.id === empId);
                byEmp[empId] = {
                    employee: emp || { id: empId, name: 'לא ידוע' },
                    tasks: []
                };
            }
            byEmp[empId].tasks.push(task);
        });

        // מיין משימות בכל עמודה
        Object.entries(byEmp).forEach(([empId, data]) => {
            data.tasks = this.sortTasks(data.tasks, empId);
        });

        // מיין עובדים לפי שם
        const sorted = {};
        Object.entries(byEmp)
            .sort(([, a], [, b]) =>
                (a.employee.name || '')
                    .localeCompare(b.employee.name || '', 'he'))
            .forEach(([k, v]) => { sorted[k] = v; });

        return sorted;
    }

    // ==========================================
    // בניית עמודת עובד
    // ==========================================
    buildEmployeeColumn(empId, data) {
        const { employee, tasks } = data;
        const color = this.employeeColors[empId] || '#f9e04b';
        const colorDark = this.darkenColor(color, 25);

        const col = document.createElement('div');
        col.className = this.selectedEmployee !== 'ALL'
            ? 'sn-employee-col sn-employee-col-full'
            : 'sn-employee-col';
        col.dataset.empId = empId;

        const total = tasks.length;
        const done = tasks.filter(t => t.status === 'בוצע').length;
        const overdue = tasks.filter(t => {
            if (!t.dueDate) return false;
            if (t.status === 'בוצע' || t.status === 'מבוטלת')
                return false;
            return new Date(t.dueDate) < new Date();
        }).length;
        const progress = total > 0
            ? Math.round((done / total) * 100) : 0;

        const showHeader = this.selectedEmployee === 'ALL';

        if (showHeader) {
            col.innerHTML = `
        <div class="sn-emp-header"
             style="background:${color};
                    border-bottom:3px solid ${colorDark}">
            <div class="sn-emp-header-row">
                <div class="sn-emp-avatar"
                     style="background:${colorDark}">
                    ${this.getInitials(employee.name)}
                </div>
                <div class="sn-emp-info">
                    <div class="sn-emp-name">
                        ${this.escHtml(employee.name)}
                    </div>
                    <div class="sn-emp-stats">
                        <span class="sn-stat-badge total">
                            ${total} משימות
                        </span>
                        ${done > 0 ? `
                        <span class="sn-stat-badge done">
                            <i class="fas fa-check"></i> ${done}
                        </span>` : ''}
                        ${overdue > 0 ? `
                        <span class="sn-stat-badge overdue">
                            <i class="fas fa-exclamation-triangle">
                            </i> ${overdue}
                        </span>` : ''}
                    </div>
                </div>
            </div>
            <div class="sn-emp-progress-wrap">
                <div class="sn-emp-progress-bar"
                     style="width:${progress}%;
                            background:${colorDark}">
                </div>
                <span class="sn-emp-progress-pct">
                    ${progress}%
                </span>
            </div>
        </div>
        <div class="sn-notes-grid" id="notesGrid_${empId}" data-emp-id="${empId}">
        </div>`;
        } else {
            col.innerHTML = `
        <div class="sn-notes-grid" id="notesGrid_${empId}" data-emp-id="${empId}">
        </div>`;
        }

        const grid = col.querySelector(`#notesGrid_${empId}`);
        tasks.forEach(task => {
            const noteEl = this.buildNoteElement(task);
            if (this.sortMode === 'custom') {
                this.makeDraggable(noteEl, empId);
            }
            grid.appendChild(noteEl);
        });

        if (this.sortMode === 'custom') {
            this.makeDropZone(grid, empId);
        }

        return col;
    }

    // ==========================================
    // פתיחת מודל הוספה/עריכה
    // ==========================================
    openTaskModal(taskId = null) {
        // הסר מודל קיים אם יש
        const existing = document.getElementById('snTaskModal');
        if (existing) existing.remove();

        const isEdit = taskId !== null;
        const task = isEdit
            ? this.allTasks.find(t => t.id === taskId)
            : null;

        if (isEdit && !task) {
            this.showToast('משימה לא נמצאה', 'error');
            return;
        }

        // *** משתמש רגיל - תמיד כפה את העובד שלו ***
        const defaultEmpId = !this.isPrivileged && this.currentUser
            ? this.currentUser.employeeId
            : (this.selectedEmployee !== 'ALL' ? this.selectedEmployee : '');

        if (!this.isPrivileged && (!Array.isArray(this.employees) || this.employees.length === 0)) {
            this.employees = [{
                id: this.currentUser.employeeId,
                name: this.currentUser.username
            }];
        }

        // *** אם לא מורשה - רק העובד שלו ***
        const employeesForSelect = this.isPrivileged
            ? this.employees
            : this.employees.filter(
                e => e.id === this.currentUser?.employeeId
            );

        const employeeOptions = employeesForSelect.map(emp =>
            `<option value="${emp.id}"
    ${task
                ? (task.employeeId === emp.id ? 'selected' : '')
                : (emp.id === defaultEmpId ? 'selected' : '')
            }>
    ${this.escHtml(emp.name)}
</option>`
        ).join('');

        // *** disabled אם לא מורשה ***
        const empSelectDisabled = !this.isPrivileged ? 'disabled' : '';

        const modal = document.createElement('div');
        modal.id = 'snTaskModal';
        modal.className = 'sn-modal-overlay';
        modal.innerHTML = `
        <div class="sn-modal">
            <div class="sn-modal-header">
                <h3 class="sn-modal-title">
                    <i class="fas fa-${isEdit ? 'edit' : 'plus-circle'}"></i>
                    ${isEdit ? 'עריכת משימה' : 'הוספת משימה חדשה'}
                </h3>
                <button class="sn-modal-close" id="snModalClose">
                    &times;
                </button>
            </div>

            <div class="sn-modal-body">
                <input type="hidden" id="snModalTaskId"
                       value="${isEdit ? task.id : ''}">

                <!-- עובד -->
                <div class="sn-form-group">
                    <label class="sn-form-label">
                        <i class="fas fa-user"></i> עובד
                    </label>

                    <select id="snModalEmployee"
                            class="sn-form-select"
                            ${empSelectDisabled}>
                        ${!this.isPrivileged ? '' : '<option value="">בחר עובד...</option>'}
                        ${employeeOptions}
                    </select>
                </div>

                <!-- כותרת -->
                <div class="sn-form-group">
                    <label class="sn-form-label">
                        <i class="fas fa-heading"></i> כותרת המשימה
                    </label>
                    <input type="text"
                           id="snModalTitle"
                           class="sn-form-input"
                           placeholder="כותרת המשימה..."
                           value="${isEdit ? this.escHtml(task.title) : ''}"
                           required>
                </div>

                <!-- תיאור -->
                <div class="sn-form-group">
                    <label class="sn-form-label">
                        <i class="fas fa-align-left"></i> תיאור המשימה
                    </label>
                    <textarea id="snModalDesc"
                              class="sn-form-textarea"
                              placeholder="תיאור המשימה (אופציונלי)..."
                              rows="3">${isEdit ? this.escHtml(task.description || '') : ''}</textarea>
                </div>

                <!-- שורה: עדיפות + סטטוס -->
                <div class="sn-form-row">
                    <div class="sn-form-group">
                        <label class="sn-form-label">
                            <i class="fas fa-flag"></i> עדיפות
                        </label>
                        <select id="snModalPriority"
                                class="sn-form-select">
                            <option value="low"
                                ${task?.priority === 'low' ? 'selected' : ''}>
                                נמוכה
                            </option>
                            <option value="medium"
                                ${(!task || task.priority === 'medium') ? 'selected' : ''}>
                                בינונית
                            </option>
                            <option value="high"
                                ${task?.priority === 'high' ? 'selected' : ''}>
                                גבוהה
                            </option>
                        </select>
                    </div>

                    ${isEdit ? `
                    <div class="sn-form-group">
                        <label class="sn-form-label">
                            <i class="fas fa-info-circle"></i> סטטוס
                        </label>
                        <select id="snModalStatus"
                                class="sn-form-select">
                            <option value="חדש"
                                ${task.status === 'חדש' ? 'selected' : ''}>
                                חדש
                            </option>
                            <option value="ממתין"
                                ${task.status === 'ממתין' ? 'selected' : ''}>
                                ממתין
                            </option>
                            <option value="בביצוע"
                                ${task.status === 'בביצוע' ? 'selected' : ''}>
                                בביצוע
                            </option>
                            <option value="בוצע"
                                ${task.status === 'בוצע' ? 'selected' : ''}>
                                בוצע
                            </option>
                            <option value="מבוטלת"
                                ${task.status === 'מבוטלת' ? 'selected' : ''}>
                                מבוטלת
                            </option>
                        </select>
                    </div>` : ''}
                </div>

                <!-- תאריך יעד -->
                <div class="sn-form-group">
                    <label class="sn-form-label">
                        <i class="fas fa-calendar-alt"></i> תאריך לסיום ביצוע (אופציונלי)
                    </label>
                    <div class="sn-form-date-wrap">
                        <input type="date"
                               id="snModalDueDate"
                               class="sn-form-input"
                               value="${isEdit && task.dueDate
                ? task.dueDate.split('T')[0]
                : ''}">
                        <button type="button"
                                class="sn-form-date-clear"
                                id="snModalDueDateClear"
                                title="נקה תאריך">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <!-- זמן משוער -->
                <div class="sn-form-group">
                    <label class="sn-form-label">
                        <i class="fas fa-clock"></i>זמן עבודה משוער (אופציונלי)
                    </label>
                    <input type="text"
                           id="snModalTime"
                           class="sn-form-input"
                           placeholder="לדוגמה: 2 שעות"
                           value="${isEdit ? this.escHtml(task.estimatedTime || '') : ''}">
                </div>
            </div>

            <div class="sn-modal-footer">
                <button class="sn-modal-cancel-btn"
                        id="snModalCancel">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button class="sn-modal-save-btn"
                        id="snModalSave">
                    <i class="fas fa-save"></i>
                    ${isEdit ? 'עדכן משימה' : 'הוסף משימה'}
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(modal);

        // ── אירועים ──
        document.getElementById('snModalClose')
            .addEventListener('click', () => this.closeTaskModal());
        document.getElementById('snModalCancel')
            .addEventListener('click', () => this.closeTaskModal());

        // סגירה בלחיצה על הרקע
        modal.addEventListener('click', e => {
            if (e.target === modal) this.closeTaskModal();
        });

        // ניקוי תאריך יעד
        document.getElementById('snModalDueDateClear')
            .addEventListener('click', () => {
                document.getElementById('snModalDueDate').value = '';
            });

        // שמירה
        document.getElementById('snModalSave')
            .addEventListener('click', () => {
                this.saveTaskFromModal(isEdit, task);
            });
    }

    // ==========================================
    // סגירת מודל
    // ==========================================
    closeTaskModal() {
        const modal = document.getElementById('snTaskModal');
        if (modal) modal.remove();
    }

    // ==========================================
    // שמירת משימה מהמודל
    // ==========================================
    async saveTaskFromModal(isEdit, originalTask) {
        // *** משתמש רגיל - קח את ה-employeeId שלו ישירות ***
        let employeeId = document.getElementById('snModalEmployee').value;

        if (!employeeId && !this.isPrivileged && this.currentUser) {
            employeeId = this.currentUser.employeeId;
        }
        const title = document.getElementById('snModalTitle').value.trim();
        const description = document.getElementById('snModalDesc').value.trim();
        const priority = document.getElementById('snModalPriority').value;
        const dueDate = document.getElementById('snModalDueDate').value || null;
        const estimatedTime = document.getElementById('snModalTime').value.trim();

        // ולידציה
        if (!employeeId) {
            this.showToast('יש לבחור עובד', 'error');
            return;
        }
        if (!title) {
            this.showToast('יש להזין כותרת', 'error');
            return;
        }

        const saveBtn = document.getElementById('snModalSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const today = new Date().toISOString().split('T')[0];

            if (isEdit) {
                // ── עריכה ──
                const status = document.getElementById('snModalStatus').value;

                const url = this.isPrivileged
                    ? '/EmployeeTasks/UpdateTask'
                    : '/EmployeeTasks/UpdateMyTask';
                const body = {
                    taskId: originalTask.id,
                    employeeId,
                    date: today,
                    title,
                    description,
                    priority,
                    dueDate,
                    estimatedTime
                };

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(body)
                });
                const data = await res.json();

                if (!data.success) {
                    throw new Error(data.error || 'שגיאה בעדכון');
                }

                // עדכן סטטוס אם השתנה
                if (status !== originalTask.status) {
                    await this.updateStatusAndProgress(
                        originalTask.id, employeeId, status, today
                    );
                }

                // עדכן מקומי
                const idx = this.allTasks.findIndex(
                    t => t.id === originalTask.id
                );
                if (idx !== -1) {
                    this.allTasks[idx] = {
                        ...this.allTasks[idx],
                        title, description, priority,
                        dueDate, estimatedTime, status
                    };
                }

                this.showToast('✅ המשימה עודכנה בהצלחה!', 'success');

            } else {
                // ── הוספה ──
                const url = this.isPrivileged
                    ? '/EmployeeTasks/AddTask'
                    : '/EmployeeTasks/AddMyTask';
                const body = {
                    employeeId,
                    date: today,
                    title,
                    description,
                    priority,
                    dueDate,
                    estimatedTime,
                    progress: 0,
                    createdAt: today
                };

                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(body)
                });
                const data = await res.json();

                if (!data.success) {
                    throw new Error(data.error || 'שגיאה בהוספה');
                }

                this.showToast('✅ המשימה נוספה בהצלחה!', 'success');
            }

            this.closeTaskModal();
            await this.loadData();

        } catch (err) {
            console.error('saveTaskFromModal error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    `<i class="fas fa-save"></i> ${isEdit ? 'עדכן' : 'הוסף'}`;
            }
        }
    }

    // ==========================================
    // עזר: עדכון סטטוס + התקדמות
    // ==========================================
    async updateStatusAndProgress(taskId, employeeId, status, currentProgress, date) {
        const now = new Date().toLocaleTimeString(
            'he-IL', { hour: '2-digit', minute: '2-digit' }
        );

        // *** חישוב אחוזים לפי סטטוס ***
        let progress = currentProgress || 0;

        if (status === 'בוצע') {
            progress = 100;
        } else if (status === 'חדש') {
            progress = 0;
        } else if (status === 'בביצוע' && progress === 100) {
            // אם היה בוצע ועובר לבביצוע - לא יכול להישאר 100%
            progress = 75;
        } else if (status === 'בביצוע' && progress === 0) {
            // אם לא התחיל ועובר לבביצוע
            progress = 75;
        }
        // ממתין - שומר על האחוזים הנוכחיים
        // מבוטלת - שומר על האחוזים הנוכחיים

        const statusUrl = this.isPrivileged
            ? '/EmployeeTasks/UpdateTaskStatus'
            : '/EmployeeTasks/UpdateMyTaskStatus';
        await fetch(statusUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                taskId,
                employeeId,
                date,
                status,
                completed: status === 'בוצע',
                completedTime: status === 'בוצע' ? now : null,
                skipReason: status === 'מבוטלת' ? 'מבוטלת' : null
            })
        });

        const progressUrl = this.isPrivileged
            ? '/EmployeeTasks/UpdateTaskProgress'
            : '/EmployeeTasks/UpdateMyTaskProgress';
        await fetch(progressUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ taskId, employeeId, date, progress })
        });

        return progress; // מחזיר את האחוזים החדשים לעדכון מקומי
    }

    async changeProgressStep(taskId, empId, direction) {
        const task = this.allTasks.find(t => t.id === taskId);
        if (!task) return;

        let value = task.progress || 0;

        if (direction === 'increase') {
            // זהה ל-increaseProgress ב-Manager
            if (value < 20) value = 20;
            else if (value < 40) value = 40;
            else if (value < 60) value = 60;
            else if (value < 80) value = 80;
            else value = 100;
        } else {
            // זהה ל-decreaseProgress ב-Manager
            if (value > 80) value = 80;
            else if (value > 60) value = 60;
            else if (value > 40) value = 40;
            else if (value > 20) value = 20;
            else value = 0;
        }

        const today = new Date().toISOString().split('T')[0];

        // עדכן אחוזים בשרת
        const success = await this.updateTaskProgress(taskId, empId, value);
        if (!success) {
            this.showToast('שגיאה בעדכון התקדמות', 'error');
            return;
        }

        // עדכן מקומי
        task.progress = value;

        // *** אחוזים משפיעים על סטטוס ***
        const now = new Date().toLocaleTimeString(
            'he-IL', { hour: '2-digit', minute: '2-digit' }
        );

        if (value === 100 && task.status !== 'בוצע') {
            // 100% → סמן כבוצע
            await this.markTaskDoneInternal(taskId, empId, today, now);
            task.status = 'בוצע';
            task.completed = true;
            task.completedTime = now;
            this.showToast('✅ המשימה הושלמה!', 'success');

        } else if (value > 0 && value < 100 &&
            (task.status === 'חדש' || task.status === 'בוצע')) {
            // 1%-99% + סטטוס חדש/בוצע → עבור לבביצוע
            await this.updateStatusOnly(taskId, empId, 'בביצוע', today);
            task.status = 'בביצוע';
            task.completed = false;
            this.showToast('🔄 סטטוס עודכן לבביצוע', 'info');

        } else if (value === 0 && task.status === 'בביצוע') {
            // 0% + בביצוע → חזור לחדש
            await this.updateStatusOnly(taskId, empId, 'חדש', today);
            task.status = 'חדש';
            task.completed = false;
            this.showToast('🔄 סטטוס עודכן לחדש', 'info');
        }

        this.renderBoard();
    }

    // פונקציית עזר - עדכון סטטוס בוצע פנימי (ללא UI)
    async markTaskDoneInternal(taskId, empId, date, completedTime) {
        const statusUrl = this.isPrivileged
            ? '/EmployeeTasks/UpdateTaskStatus'
            : '/EmployeeTasks/UpdateMyTaskStatus';
        await fetch(statusUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                taskId,
                employeeId: empId,
                date,
                status: 'בוצע',
                completed: true,
                completedTime,
                skipReason: null
            })
        });
    }

    // פונקציית עזר - עדכון סטטוס בלבד (ללא שינוי אחוזים)
    async updateStatusOnly(taskId, empId, status, date) {
        const statusUrl = this.isPrivileged
            ? '/EmployeeTasks/UpdateTaskStatus'
            : '/EmployeeTasks/UpdateMyTaskStatus';
        await fetch(statusUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                taskId,
                employeeId: empId,
                date,
                status,
                completed: status === 'בוצע',
                completedTime: null,
                skipReason: status === 'מבוטלת' ? 'מבוטלת' : null
            })
        });
    }

    async updateTaskProgress(taskId, empId, progress) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const progressValue = Math.max(0, Math.min(100, parseInt(progress) || 0));

            const progressUrl = this.isPrivileged
                ? '/EmployeeTasks/UpdateTaskProgress'
                : '/EmployeeTasks/UpdateMyTaskProgress';
            const res = await fetch(progressUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    taskId,
                    employeeId: empId,
                    date: today,
                    progress: progressValue
                })
            });

            const text = await res.text();
            if (!text) {
                console.warn('Empty response from UpdateTaskProgress');
                return false;
            }

            const data = JSON.parse(text);
            return data.success;

        } catch (err) {
            console.error('updateTaskProgress error:', err);
            return false;
        }
    }

    // ==========================================
    // מחיקת משימה
    // ==========================================
    async deleteTask(taskId) {
        if (!confirm('האם אתה בטוח שברצונך למחוק משימה זו?')) return;

        try {
            const url = this.isPrivileged
                ? '/EmployeeTasks/DeleteTask'
                : '/EmployeeTasks/DeleteMyTask';

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ taskId })
            });

            const text = await res.text();
            if (!text) throw new Error('תגובה ריקה מהשרת');

            const data = JSON.parse(text);
            if (!data.success) {
                throw new Error(data.error || 'שגיאה במחיקה');
            }

            // הסר מקומית
            this.allTasks = this.allTasks.filter(t => t.id !== taskId);
            this.renderBoard();
            this.showToast('🗑️ המשימה נמחקה', 'info');

        } catch (err) {
            console.error('deleteTask error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
        }
    }

    // ==========================================
    // בניית פתק כ-DOM Element (לא HTML string)
    // ==========================================
    buildNoteElement(task) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const isDone = task.status === 'בוצע';
        const isCancelled = task.status === 'מבוטלת';
        const isOverdue = task.dueDate &&
            !isDone && !isCancelled &&
            new Date(task.dueDate) < today;

        const progress = task.progress || 0;
        const noteColor = this.getNoteColor(task);

        const priorityIcon =
            task.priority === 'high' ? '🔴' :
                task.priority === 'medium' ? '🟡' : '🟢';

        const statusClass =
            isDone ? 'done' :
                isCancelled ? 'cancelled' :
                    isOverdue ? 'overdue' :
                        task.status === 'בביצוע' ? 'in-progress' :
                            task.status === 'ממתין' ? 'waiting' : 'new';

        // *** בדוק אם הפתק ממוזער ***
        const isMinimized = !!this.minimizedNotes[task.id];

        const note = document.createElement('div');
        note.className =
            `sn-note` +
            `${isDone ? ' sn-note-done' : ''}` +
            `${isCancelled ? ' sn-note-cancelled' : ''}` +
            `${isOverdue ? ' sn-note-overdue' : ''}` +
            `${isMinimized ? ' sn-note-minimized' : ''}`;
        note.style.background = noteColor;
        note.dataset.taskId = task.id;
        note.dataset.empId = task.employeeId;

        note.innerHTML = `
        <!-- פין -->
        <div class="sn-note-pin"></div>

        <div class="sn-note-edit-actions">
            <!-- *** כפתור מזעור חדש *** -->
            <button class="sn-minimize-btn"
                    data-task-id="${task.id}"
                    title="${isMinimized ? 'הרחב פתק' : 'מזער פתק'}">
                <i class="fas fa-${isMinimized ? 'expand-alt' : 'compress-alt'}"></i>
            </button>
            <button class="sn-edit-btn"
                    data-task-id="${task.id}"
                    title="ערוך משימה">
                <i class="fas fa-edit"></i>
            </button>
            <button class="sn-calendar-btn"
                    data-task-id="${task.id}"
                    title="הוסף ליומן Outlook">
                <i class="fas fa-calendar-plus"></i>
            </button>
            <button class="sn-delete-btn"
                    data-task-id="${task.id}"
                    title="מחק משימה">
                <i class="fas fa-trash"></i>
            </button>
            ${this.NOTE_COLOR_MODE === 'custom' ? `
            <button class="sn-color-pick-btn"
                    data-task-id="${task.id}"
                    title="שנה צבע">
                <i class="fas fa-palette"></i>
            </button>` : ''}
        </div>

        <!-- כותרת - תמיד מוצגת -->
        <div class="sn-note-header">
            <span class="sn-note-priority-icon" title="${task.priority}">
                ${priorityIcon}
            </span>
            <span class="sn-note-title" title="${this.escHtml(task.title)}">
                ${this.escHtml(task.title)}
            </span>
            ${isMinimized ? `
            <span class="sn-note-status-badge ${statusClass}" style="margin-right:auto;flex-shrink:0">
                ${task.status || 'חדש'}
            </span>` : ''}
        </div>

        <!-- *** תוכן מוסתר במצב מזעור *** -->
        <div class="sn-note-body ${isMinimized ? 'sn-note-body-hidden' : ''}">

            ${task.description ? `
            <div class="sn-note-desc">
                ${this.escHtml(task.description)}
            </div>` : ''}

            ${task.dueDate ? `
            <div class="sn-note-due ${isOverdue ? 'overdue' : ''}">
                <i class="fas fa-calendar-${isOverdue ? 'times' : 'check'}"></i>
                ${this.formatDate(task.dueDate)}
                ${isOverdue
                    ? '<span class="sn-overdue-badge">באיחור!</span>'
                    : ''}
            </div>` : ''}

            ${!isDone && !isCancelled ? `
            <div class="sn-note-progress">
                <div class="sn-note-progress-track">
                    <div class="sn-note-progress-fill"
                        style="width:${progress}%"></div>
                </div>
                <span class="sn-note-progress-pct">${progress}%</span>
            </div>
            <div class="sn-note-progress-controls">
                <button class="sn-progress-minus-btn"
                        data-task-id="${task.id}"
                        data-emp-id="${task.employeeId}"
                        title="הפחת התקדמות">
                    <i class="fas fa-minus"></i>
                </button>
                <button class="sn-progress-plus-btn"
                        data-task-id="${task.id}"
                        data-emp-id="${task.employeeId}"
                        title="הגדל התקדמות">
                    <i class="fas fa-plus"></i>
                </button>
            </div>` : ''}

            <div class="sn-note-footer">
                <span class="sn-note-status-badge ${statusClass}">
                    ${task.status || 'חדש'}
                </span>
                ${task.completedTime ? `
                <span class="sn-note-time">
                    <i class="fas fa-clock"></i>
                    ${task.completedTime}
                </span>` : ''}
            </div>

            ${!isDone && !isCancelled ? `
            <div class="sn-action-btns">
                <button class="sn-inprogress-btn"
                        data-task-id="${task.id}"
                        data-emp-id="${task.employeeId}"
                        ${task.status === 'בביצוע' ? 'disabled' : ''}
                        title="סמן כבביצוע">
                    <i class="fas fa-spinner"></i>
                    <span>בביצוע</span>
                </button>
                <button class="sn-done-btn"
                        data-task-id="${task.id}"
                        data-emp-id="${task.employeeId}"
                        title="סמן כבוצע">
                    <i class="fas fa-check"></i>
                    <span>בוצע</span>
                </button>
            </div>` : `
            <div class="sn-done-stamp">
                ${isDone ? '✅ בוצע' : '❌ מבוטל'}
            </div>`}

        </div><!-- /sn-note-body -->

        <div class="sn-note-fold"></div>`;

        return note;
    }

    // ==========================================
    // סימון משימה כבוצע
    // ==========================================
    async markTaskDone(taskId, empId, btnEl) {
        // מנע לחיצה כפולה
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const now = new Date().toLocaleTimeString(
                'he-IL',
                { hour: '2-digit', minute: '2-digit' }
            );

            // ===== שלב 1: עדכון סטטוס (בדיוק כמו ב-EmployeeTasksManager) =====
            const statusUrl = this.isPrivileged
                ? '/EmployeeTasks/UpdateTaskStatus'
                : '/EmployeeTasks/UpdateMyTaskStatus';

            const statusRes = await fetch(statusUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        taskId,
                        employeeId: empId,
                        date: today,
                        status: 'בוצע',
                        completed: true,
                        completedTime: now,
                        skipReason: null
                    })
                }
            );

            const statusData = await statusRes.json();

            if (!statusData.success) {
                throw new Error(statusData.error || 'שגיאה בעדכון סטטוס');
            }

            // ===== שלב 2: עדכון התקדמות ל-100% (בדיוק כמו ב-EmployeeTasksManager) =====
            const progressUrl = this.isPrivileged
                ? '/EmployeeTasks/UpdateTaskProgress'
                : '/EmployeeTasks/UpdateMyTaskProgress';

            const progressRes = await fetch(progressUrl,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        taskId,
                        employeeId: empId,
                        date: today,
                        progress: 100
                    })
                }
            );

            // בדיקת תגובה ריקה (כמו ב-EmployeeTasksManager)
            const progressText = await progressRes.text();

            if (!progressText) {
                // סטטוס עודכן בהצלחה, אבל progress נכשל — נמשיך בכל זאת
                console.warn('Empty response from UpdateTaskProgress');
            } else {
                const progressData = JSON.parse(progressText);
                if (!progressData.success) {
                    console.warn(
                        'Progress update failed:',
                        progressData.error
                    );
                    // לא זורקים שגיאה — הסטטוס כבר עודכן
                }
            }

            // ===== שלב 3: עדכון מקומי (כמו ב-EmployeeTasksManager) =====
            const task = this.allTasks.find(t => t.id === taskId);
            if (task) {
                task.status = 'בוצע';
                task.completed = true;
                task.completedTime = now;
                task.progress = 100;
            }

            // ===== שלב 4: אנימציה ורינדור מחדש =====
            const noteEl = document.querySelector(
                `.sn-note[data-task-id="${taskId}"]`
            );
            if (noteEl) {
                noteEl.classList.add('sn-note-completing');
                setTimeout(() => {
                    this.renderBoard();
                }, 500);
            } else {
                this.renderBoard();
            }

            this.showToast('✅ המשימה סומנה כבוצע!', 'success');

        } catch (err) {
            console.error('markTaskDone error:', err);
            this.showToast(
                'שגיאה: ' + (err.message || 'שגיאה בתקשורת עם השרת'),
                'error'
            );
            // שחזר כפתור
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML =
                    '<i class="fas fa-check"></i>' +
                    '<span>בוצע</span>';
            }
        }
    }

    // ==========================================
    // סימון משימה כבביצוע
    // ==========================================
    async markTaskInProgress(taskId, empId, btnEl) {
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const today = new Date().toISOString().split('T')[0];
            const task = this.allTasks.find(t => t.id === taskId);

            const currentProgress = task?.progress || 0;
            const newProgress = currentProgress === 0 ? 75 : currentProgress;

            // שלב 1: עדכון סטטוס
            const statusUrl = this.isPrivileged
                ? '/EmployeeTasks/UpdateTaskStatus'
                : '/EmployeeTasks/UpdateMyTaskStatus';
            const statusRes = await fetch(statusUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    taskId,
                    employeeId: empId,
                    date: today,
                    status: 'בביצוע',
                    completed: false,
                    completedTime: null,
                    skipReason: null
                })
            });

            const statusData = await statusRes.json();
            if (!statusData.success) {
                throw new Error(statusData.error || 'שגיאה בעדכון סטטוס');
            }

            // שלב 2: עדכון התקדמות
            await this.updateTaskProgress(taskId, empId, newProgress);

            // שלב 3: עדכון מקומי
            if (task) {
                task.status = 'בביצוע';
                task.completed = false;
                task.progress = newProgress;
            }

            // שלב 4: אנימציה ורינדור
            const noteEl = document.querySelector(
                `.sn-note[data-task-id="${taskId}"]`
            );
            if (noteEl) {
                noteEl.classList.add('sn-note-updating');
                setTimeout(() => this.renderBoard(), 400);
            } else {
                this.renderBoard();
            }

            this.showToast('🔄 המשימה סומנה כבביצוע!', 'info');

        } catch (err) {
            console.error('markTaskInProgress error:', err);
            this.showToast('שגיאה: ' + (err.message || 'שגיאה בתקשורת'), 'error');
            if (btnEl) {
                btnEl.disabled = false;
                btnEl.innerHTML =
                    '<i class="fas fa-spinner"></i><span>בביצוע</span>';
            }
        }
    }

    // ==========================================
    // אירועים
    // ==========================================
    bindEvents() {
        // חיפוש
        document.addEventListener('input', e => {
            if (e.target.id === 'snSearchInput') {
                this.searchTerm = e.target.value;
                const clearBtn =
                    document.getElementById('snClearSearch');
                if (clearBtn)
                    clearBtn.style.display =
                        e.target.value ? 'flex' : 'none';
                this.renderBoard();
            }
        });

        document.addEventListener('change', e => {
            // בחירת עובד
            if (e.target.id === 'snEmployeeSelect') {
                this.selectedEmployee = e.target.value;
                localStorage.setItem(this.LAST_EMPLOYEE_KEY, e.target.value);
                this.updateSelectColor(e.target);

                // הצג/הסתר אפשרות Status Columns
                this.updateSortOptions();

                // אם עובד ספציפי לא נבחר ומצב statusColumns - אפס מיון
                if (e.target.value === 'ALL' && this.sortMode === 'statusColumns') {
                    this.sortMode = 'custom';
                    const sortSel = document.getElementById('snSortSelect');
                    if (sortSel) sortSel.value = 'custom';
                }

                this.loadData();
            }

            if (e.target.id === 'snSortSelect') {
                this.sortMode = e.target.value;
                // *** שמור מצב מיון ***
                localStorage.setItem(this.SORT_MODE_KEY, this.sortMode);
                this.updateSortDirBtn();
                this.renderBoard();
            }

        });

        document.addEventListener('click', e => {

            // ניקוי חיפוש
            if (e.target.closest('#snClearSearch')) {
                this.searchTerm = '';
                const inp =
                    document.getElementById('snSearchInput');
                if (inp) inp.value = '';
                const clearBtn =
                    document.getElementById('snClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';
                this.renderBoard();
            }

            // כפתורי סינון
            const filterBtn = e.target.closest('.sn-filter-btn');
            if (filterBtn) {
                this.filterStatus =
                    filterBtn.getAttribute('data-f');
                document.querySelectorAll('.sn-filter-btn')
                    .forEach(b => b.classList.remove('active'));
                filterBtn.classList.add('active');
                this.renderBoard();
            }

            // ייצוא לאקסל
            if (e.target.closest('#snExportBtn')) {
                this.exportTasksToExcel();
            }

            // רענון
            if (e.target.closest('#snRefreshBtn'))
                this.loadData();

            // *** סימון כבוצע ***
            const doneBtn = e.target.closest('.sn-done-btn');
            if (doneBtn) {
                e.stopPropagation();
                const taskId = doneBtn.dataset.taskId;
                const empId = doneBtn.dataset.empId;
                this.markTaskDone(taskId, empId, doneBtn);
            }

            // *** סימון כבביצוע ***
            const inProgressBtn = e.target.closest('.sn-inprogress-btn');
            if (inProgressBtn) {
                e.stopPropagation();
                const taskId = inProgressBtn.dataset.taskId;
                const empId = inProgressBtn.dataset.empId;
                this.markTaskInProgress(taskId, empId, inProgressBtn);
            }
            // *** עריכה ***
            const editBtn = e.target.closest('.sn-edit-btn');
            if (editBtn) {
                e.stopPropagation();
                const taskId = editBtn.dataset.taskId;
                this.openTaskModal(taskId);
            }

            // *** מחיקה ***
            const deleteBtn = e.target.closest('.sn-delete-btn');
            if (deleteBtn) {
                e.stopPropagation();
                const taskId = deleteBtn.dataset.taskId;
                this.deleteTask(taskId);
            }

            // *** ייצוא ליומן ***
            const calendarBtn = e.target.closest('.sn-calendar-btn');
            if (calendarBtn) {
                e.stopPropagation();
                const taskId = calendarBtn.dataset.taskId;
                this.exportTaskToCalendar(taskId);
            }

            // *** כפתור הוספת משימה ***
            if (e.target.closest('#snAddTaskBtn')) {
                this.openTaskModal(null);
            }

            // *** הגדלת אחוזים ***
            const progressPlusBtn = e.target.closest('.sn-progress-plus-btn');
            if (progressPlusBtn) {
                e.stopPropagation();
                const taskId = progressPlusBtn.dataset.taskId;
                const empId = progressPlusBtn.dataset.empId;
                this.changeProgressStep(taskId, empId, 'increase');
            }

            // *** הפחתת אחוזים ***
            const progressMinusBtn = e.target.closest('.sn-progress-minus-btn');
            if (progressMinusBtn) {
                e.stopPropagation();
                const taskId = progressMinusBtn.dataset.taskId;
                const empId = progressMinusBtn.dataset.empId;
                this.changeProgressStep(taskId, empId, 'decrease');
            }

            // *** מצב Free Mode ***
            if (e.target.closest('#snFreeModeBtn')) {
                this.freeMode = !this.freeMode;
                localStorage.setItem(this.FREE_MODE_KEY, this.freeMode);
                const btn = document.getElementById('snFreeModeBtn');
                if (btn) {
                    btn.classList.toggle('active', this.freeMode);
                    btn.innerHTML = this.freeMode
                        ? '<i class="fas fa-th"></i> Grid'
                        : '<i class="fas fa-thumbtack"></i> Free';
                }
                this.updateSortSelectState();
                this.renderBoard();
            }

            // *** בחירת צבע ידני ***
            const colorPickBtn = e.target.closest('.sn-color-pick-btn');
            if (colorPickBtn) {
                e.stopPropagation();
                const taskId = colorPickBtn.dataset.taskId;
                this.openColorPicker(taskId, colorPickBtn);
            }

            // *** כפתור palette ***
            if (e.target.closest('#snColorModeBtn')) {
                this.openColorModePanel();
            }

            // *** מזעור פתק ***
            const minimizeBtn = e.target.closest('.sn-minimize-btn');
            if (minimizeBtn) {
                e.stopPropagation();
                const taskId = minimizeBtn.dataset.taskId;
                this.toggleMinimizeNote(taskId);
            }

            if (e.target.closest('#snToggleAllBtn')) {
                this.toggleAllNotes();
            }

            // *** כפתור כיוון מיון ***
            if (e.target.closest('#snSortDirBtn')) {
                this.sortDirection =
                    this.sortDirection === 'asc' ? 'desc' : 'asc';
                // *** שמור כיוון מיון ***
                localStorage.setItem(this.SORT_DIR_KEY, this.sortDirection);
                this.updateSortDirBtn();
                this.renderBoard();
                this.showToast(
                    this.sortDirection === 'asc'
                        ? '⬆️ מיון עולה'
                        : '⬇️ מיון יורד',
                    'info'
                );
            }
        });
    }

    updateSortSelectState() {
        const sortWrap = document.querySelector('.sn-sort-wrap');
        const sortSelect = document.getElementById('snSortSelect');
        if (!sortWrap || !sortSelect) return;

        const disabled = this.freeMode;

        sortSelect.disabled = disabled;
        sortWrap.classList.toggle('sn-sort-disabled', disabled);

        if (disabled) {
            sortWrap.title = 'המיון אינו זמין במצב Free';
        } else {
            sortWrap.title = '';
        }

        // *** עדכן כפתור כיוון ***
        this.updateSortDirBtn();
    }

    updateSortOptions() {
        const opt = document.getElementById('snSortStatusColumns');
        if (!opt) return;

        opt.textContent = 'By Status Columns';
        if (this.selectedEmployee === 'ALL') {
            opt.disabled = true;
            opt.style.color = '#555';
        } else {
            opt.disabled = false;
            opt.style.color = '';
        }
    }

    // ==========================================
    // Toast הודעה
    // ==========================================
    showToast(msg, type = 'info') {
        const toast = document.getElementById('snToast');
        if (!toast) return;

        toast.textContent = msg;
        toast.className = `sn-toast sn-toast-${type} sn-toast-show`;

        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('sn-toast-show');
        }, 3000);
    }

    // ==========================================
    // עזרים
    // ==========================================
    getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(' ');
        if (parts.length >= 2)
            return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    }

    darkenColor(hex, amount) {
        try {
            let r = parseInt(hex.slice(1, 3), 16);
            let g = parseInt(hex.slice(3, 5), 16);
            let b = parseInt(hex.slice(5, 7), 16);
            r = Math.max(0, r - amount);
            g = Math.max(0, g - amount);
            b = Math.max(0, b - amount);
            return `#${r.toString(16).padStart(2, '0')}` +
                `${g.toString(16).padStart(2, '0')}` +
                `${b.toString(16).padStart(2, '0')}`;
        } catch { return hex; }
    }

    formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return `${d.getDate().toString().padStart(2, '0')}/` +
                `${(d.getMonth() + 1).toString().padStart(2, '0')}/` +
                `${d.getFullYear()}`;
        } catch { return dateStr; }
    }

    escHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    showLoading(show) {
        const el = document.getElementById('snLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    showError(msg) {
        const el = document.getElementById('snError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 5000);
        }
    }

    updateLastRefresh() {
        const el = document.getElementById('snLastRefresh');
        if (!el) return;
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const ss = now.getSeconds().toString().padStart(2, '0');
        el.textContent = `Updated: ${hh}:${mm}:${ss}`;
    }

    // ==========================================
    // ייצוא לאקסל
    // ==========================================
    exportTasksToExcel() {
        this._exportTasksToExcelAsync();
    }

    async _exportTasksToExcelAsync() {
        try {
            if (!this.allTasks || this.allTasks.length === 0) {
                this.showToast('אין משימות לייצוא', 'error');
                return;
            }

            // הצג loading על הכפתור
            const exportBtn = document.getElementById('snExportBtn');
            if (exportBtn) {
                exportBtn.disabled = true;
                exportBtn.innerHTML =
                    '<i class="fas fa-spinner fa-spin"></i>';
            }

            // ─── טען ExcelJS ───────────────────────────────────────
            if (typeof ExcelJS === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'exceljs/4.3.0/exceljs.min.js';
                    s.onload = res;
                    s.onerror = () => rej(
                        new Error('נכשלה טעינת ExcelJS')
                    );
                    document.head.appendChild(s);
                });
            }

            // ─── טען FileSaver ─────────────────────────────────────
            if (typeof saveAs === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'FileSaver.js/2.0.5/FileSaver.min.js';
                    s.onload = res;
                    s.onerror = () => rej(
                        new Error('נכשלה טעינת FileSaver')
                    );
                    document.head.appendChild(s);
                });
            }

            // ─── קבל משימות לפי סינון נוכחי ──────────────────────
            const tasksByEmp = this.getFilteredTasksByEmployee();
            const tasksToExport = Object.values(tasksByEmp)
                .flatMap(d => d.tasks);

            if (tasksToExport.length === 0) {
                this.showToast('אין משימות לייצוא לפי הסינון הנוכחי',
                    'error');
                return;
            }

            // ─── צבעים ────────────────────────────────────────────
            const C = {
                headerBg: '667eea',
                headerFont: 'FFFFFF',
                statusDone: 'c8f7c5',
                statusInProg: 'ffeaa7',
                statusWait: 'dfe6e9',
                statusCancel: 'ffcccc',
                statusNew: 'e8f4fd',
                prioHigh: 'ffe0e0',
                prioMed: 'fff8e0',
                prioLow: 'e0f0e0',
                prog100: '3ecf8e',
                prog80: '5cd98a',
                prog60: '8de8a0',
                prog40: 'ffe066',
                prog20: 'ffd166',
                prog10: 'ffab76',
                prog0: 'ff8a80',
                rowEven: 'ffffff',
                rowOdd: 'f8f9ff',
                summaryTitle: '667eea',
                summaryHdr: 'f0f4ff',
                border: 'cccccc',
            };

            // ─── פונקציות עזר ─────────────────────────────────────
            const thinBorder = () => ({
                top: {
                    style: 'thin',
                    color: { argb: 'FF' + C.border }
                },
                bottom: {
                    style: 'thin',
                    color: { argb: 'FF' + C.border }
                },
                left: {
                    style: 'thin',
                    color: { argb: 'FF' + C.border }
                },
                right: {
                    style: 'thin',
                    color: { argb: 'FF' + C.border }
                },
            });

            const medBorder = () => ({
                top: {
                    style: 'medium',
                    color: { argb: 'FF4a5568' }
                },
                bottom: {
                    style: 'medium',
                    color: { argb: 'FF4a5568' }
                },
                left: {
                    style: 'medium',
                    color: { argb: 'FF4a5568' }
                },
                right: {
                    style: 'medium',
                    color: { argb: 'FF4a5568' }
                },
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
                    name: 'Arial', size: fontSize,
                    bold, color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign, vertical: 'middle',
                    wrapText, readingOrder: 2,
                };
                cell.border = border === 'medium'
                    ? medBorder() : thinBorder();
                if (bgColor) {
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            const getStatusBg = s => {
                if (s === 'בוצע') return C.statusDone;
                if (s === 'בביצוע') return C.statusInProg;
                if (s === 'ממתין') return C.statusWait;
                if (s === 'מבוטלת') return C.statusCancel;
                return C.statusNew;
            };

            const getPrioBg = p => {
                if (p === 'high') return C.prioHigh;
                if (p === 'medium') return C.prioMed;
                if (p === 'low') return C.prioLow;
                return C.rowEven;
            };

            const getProgBg = pct => {
                if (pct >= 100) return C.prog100;
                if (pct >= 80) return C.prog80;
                if (pct >= 60) return C.prog60;
                if (pct >= 40) return C.prog40;
                if (pct >= 20) return C.prog20;
                if (pct > 0) return C.prog10;
                return C.prog0;
            };

            const getProgFont = pct =>
                pct >= 60 ? '1a5c2a' : '7f1d1d';

            // ─── עמודות ───────────────────────────────────────────
            const COLS = [
                { key: 'employee', header: 'עובד', width: 22 },
                { key: 'title', header: 'כותרת', width: 32 },
                { key: 'description', header: 'תיאור', width: 40 },
                { key: 'status', header: 'סטטוס', width: 12 },
                { key: 'priority', header: 'עדיפות', width: 12 },
                { key: 'progress', header: 'התקדמות (%)', width: 14 },
                { key: 'createdAt', header: 'תאריך יצירה', width: 14 },
                { key: 'dueDate', header: 'תאריך יעד', width: 14 },
                { key: 'completedTime', header: 'זמן השלמה', width: 14 },
                { key: 'skipReason', header: 'סיבת ביטול', width: 22 },
            ];

            // ─── בנה גליון ────────────────────────────────────────
            const buildSheet = (wb, tasks, sheetName) => {
                const ws = wb.addWorksheet(sheetName, {
                    views: [{
                        state: 'frozen',
                        ySplit: 1,
                        rightToLeft: true
                    }],
                    properties: { defaultRowHeight: 18 },
                });

                ws.columns = COLS.map(c => ({
                    header: c.header,
                    key: c.key,
                    width: c.width,
                }));

                // כותרות
                const hRow = ws.getRow(1);
                hRow.height = 26;
                hRow.eachCell(cell => {
                    applyStyle(cell, {
                        bgColor: C.headerBg,
                        fontColor: C.headerFont,
                        bold: true,
                        hAlign: 'center',
                        fontSize: 11,
                        border: 'medium',
                    });
                });

                // נתונים
                tasks.forEach((task, idx) => {
                    const emp = this.employees.find(
                        e => e.id === task.employeeId
                    );
                    const empName = emp ? emp.name : '';
                    const pct = task.progress || 0;
                    const rowBg = idx % 2 === 0
                        ? C.rowEven : C.rowOdd;

                    const priorityLabel =
                        task.priority === 'high' ? 'גבוהה' :
                            task.priority === 'medium' ? 'בינונית' :
                                task.priority === 'low' ? 'נמוכה' : '';

                    const row = ws.addRow({
                        employee: empName,
                        title: task.title || '',
                        description: task.description || '',
                        status: task.status || '',
                        priority: priorityLabel,
                        progress: pct,
                        createdAt: task.createdAt
                            ? this.formatDate(task.createdAt) : '',
                        dueDate: task.dueDate
                            ? this.formatDate(task.dueDate) : '',
                        completedTime: task.completedTime || '',
                        skipReason: task.skipReason || '',
                    });
                    row.height = 17;

                    row.eachCell((cell, colNum) => {
                        const key = COLS[colNum - 1]?.key;
                        let bg = rowBg;
                        let fontCol = '333333';
                        let hAlign = 'right';
                        let bold = false;
                        let wrapText = false;

                        switch (key) {
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
                            case 'employee':
                                bold = true;
                                break;
                        }

                        applyStyle(cell, {
                            bgColor: bg, fontColor: fontCol,
                            bold, hAlign, wrapText,
                        });
                    });
                });

                return ws;
            };

            // ─── חלק לפי סטטוס ────────────────────────────────────
            const byStatus = status =>
                tasksToExport.filter(t => t.status === status);

            const completed = byStatus('בוצע');
            const inProgress = byStatus('בביצוע');
            const pending = byStatus('ממתין');
            const newTasks = tasksToExport.filter(
                t => t.status === 'חדש' || !t.status
            );
            const cancelled = byStatus('מבוטלת');

            // ─── בנה Workbook ──────────────────────────────────────
            const wb = new ExcelJS.Workbook();
            wb.creator = 'EmployeeTasksDashboard';
            wb.created = new Date();
            wb.modified = new Date();

            buildSheet(wb, tasksToExport, 'כל המשימות');
            if (completed.length > 0) buildSheet(wb, completed, 'בוצע');
            if (inProgress.length > 0) buildSheet(wb, inProgress, 'בביצוע');
            if (pending.length > 0) buildSheet(wb, pending, 'ממתין');
            if (newTasks.length > 0) buildSheet(wb, newTasks, 'חדש');
            if (cancelled.length > 0) buildSheet(wb, cancelled, 'מבוטלת');

            // ─── גליון סיכום ──────────────────────────────────────
            const summaryWs = wb.addWorksheet('סיכום', {
                views: [{ rightToLeft: true }],
            });
            summaryWs.columns = [
                { key: 'label', width: 28 },
                { key: 'value', width: 14 },
            ];

            const avgPct = Math.round(
                tasksToExport.reduce(
                    (s, t) => s + (t.progress || 0), 0
                ) / (tasksToExport.length || 1)
            );

            const summaryRows = [
                {
                    label: 'סיכום משימות', value: '',
                    isTitle: true
                },
                { label: '', value: '' },
                { label: 'סה"כ משימות', value: tasksToExport.length },
                { label: 'בוצע', value: completed.length },
                { label: 'בביצוע', value: inProgress.length },
                { label: 'ממתין', value: pending.length },
                { label: 'חדש', value: newTasks.length },
                { label: 'מבוטלת', value: cancelled.length },
                { label: '', value: '' },
                { label: 'ממוצע התקדמות', value: avgPct + '%' },
                {
                    label: 'תאריך ייצוא',
                    value: new Date().toLocaleDateString('he-IL')
                },
            ];

            summaryRows.forEach((item, i) => {
                const row = summaryWs.addRow(
                    [item.label, item.value]
                );
                row.height = item.isTitle ? 28 : 20;

                row.eachCell((cell, colNum) => {
                    const isTitle = item.isTitle;
                    const isHeader = colNum === 1 &&
                        i > 1 && item.label !== '';

                    applyStyle(cell, {
                        bgColor: isTitle ? C.summaryTitle :
                            isHeader ? C.summaryHdr : 'ffffff',
                        fontColor: isTitle ? 'FFFFFF' : '333333',
                        bold: isTitle || isHeader,
                        hAlign: colNum === 2 ? 'center' : 'right',
                        fontSize: isTitle ? 13 : 11,
                        border: i > 1 ? 'thin' : null,
                    });
                });
            });

            summaryWs.mergeCells('A1:B1');

            // ─── שם קובץ ──────────────────────────────────────────
            const empId = this.selectedEmployee;
            const emp = this.employees.find(e => e.id === empId);
            const empName = empId === 'ALL'
                ? 'כל_העובדים'
                : (emp ? emp.name : empId);
            const dateStr = new Date().toISOString().split('T')[0];
            const fileName =
                `משימות_${empName}_${dateStr}.xlsx`;

            // ─── הורד ─────────────────────────────────────────────
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet',
            });
            saveAs(blob, fileName);

            // ─── הודעת הצלחה ──────────────────────────────────────
            const parts = [
                completed.length > 0
                    ? `${completed.length} בוצעו` : '',
                inProgress.length > 0
                    ? `${inProgress.length} בביצוע` : '',
                pending.length > 0
                    ? `${pending.length} ממתין` : '',
                newTasks.length > 0
                    ? `${newTasks.length} חדש` : '',
                cancelled.length > 0
                    ? `${cancelled.length} מבוטלות` : '',
            ].filter(Boolean).join(' • ');

            this.showToast(
                `📊 ${tasksToExport.length} משימות יוצאו` +
                (parts ? ` (${parts})` : ''),
                'success'
            );

        } catch (err) {
            console.error('exportTasksToExcel error:', err);
            this.showToast(
                'שגיאה בייצוא: ' + err.message,
                'error'
            );
        } finally {
            // שחזר כפתור
            const exportBtn = document.getElementById('snExportBtn');
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML =
                    '<i class="fas fa-file-excel"></i>';
            }
        }
    }

    /**
 * וידוא שה-EmployeeTasksManager נטען
 */
    async ensureEmployeeTasksManagerLoaded() {
        // השתמש ב-instance הגלובלי הקיים
        if (typeof employeeTasksManager !== 'undefined' && employeeTasksManager) {
            window.employeeTasksManager = employeeTasksManager;
            return;
        }

        if (window.employeeTasksManager) {
            return;
        }

        // אם הקלאס קיים אבל אין instance - צור אחד
        if (typeof EmployeeTasksManager !== 'undefined') {
            window.employeeTasksManager = new EmployeeTasksManager();
            return;
        }

        // טען את הקובץ דינמית
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/EmployeeTasksManager.js';
            script.onload = () => {
                window.employeeTasksManager = new EmployeeTasksManager();
                resolve();
            };
            script.onerror = () => reject(
                new Error('Failed to load EmployeeTasksManager')
            );
            document.head.appendChild(script);
        });
    }

    /**
     * ייצוא משימה ליומן Outlook - קורא לפונקציה של EmployeeTasksManager
     */
    async exportTaskToCalendar(taskId) {
        try {
            const task = this.allTasks.find(t => t.id === taskId);
            if (!task) {
                this.showToast('משימה לא נמצאה', 'error');
                return;
            }

            // וודא שה-manager נטען
            await this.ensureEmployeeTasksManagerLoaded();

            // עדכן את הנתונים הנדרשים ב-manager
            window.employeeTasksManager.employeeTasks = this.allTasks;
            window.employeeTasksManager.employees = this.employees;
            window.employeeTasksManager.currentDate =
                new Date().toISOString().split('T')[0];

            // קרא לפונקציה של EmployeeTasksManager
            window.employeeTasksManager.exportTaskToCalendar(taskId);

        } catch (error) {
            console.error('exportTaskToCalendar error:', error);
            this.showToast(
                'שגיאה בייצוא ליומן: ' + error.message,
                'error'
            );
        }
    }

    // ==========================================
    // סגנונות
    // ==========================================
    addStyles() {
        if (document.getElementById('snStyles')) return;

        const style = document.createElement('style');
        style.id = 'snStyles';
        style.textContent = `

        /* ===== Root ===== */
        .sn-root {
            background: #1a1a2e;
            color: #e0e0e0;
            font-family: 'Segoe UI', Arial, sans-serif;
           min-height: 100vh;
            display: flex;
            flex-direction: column;
            direction: rtl;
        }

        /* ===== Header ===== */
        .sn-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            gap: 10px;
            flex-shrink: 0;
            direction: ltr;
        }
        .sn-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .sn-header-right {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        /* ===== Dropdown עובד ===== */
        .sn-emp-select-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .sn-emp-select-icon {
            position: absolute;
            right: 9px;
            color: #888;
            font-size: 0.78rem;
            pointer-events: none;
            z-index: 1;
        }
        .sn-emp-select {
            background: #252535;
            border: 1px solid #f9e04b;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 28px 6px 10px;
            font-size: 0.85rem;
            outline: none;
            cursor: pointer;
            transition: border-color 0.2s, background 0.2s;
            min-width: 160px;
            direction: rtl;
            appearance: none;
            -webkit-appearance: none;
        }
        .sn-emp-select:focus {
            border-color: #f9e04b;
            box-shadow: 0 0 0 2px rgba(249,224,75,0.15);
        }
        .sn-emp-select option {
            background: #252535;
            color: #e0e0e0;
        }

                /* ===== חיפוש ===== */
        .sn-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .sn-search-icon {
            position: absolute;
            right: 9px;
            color: #666;
            font-size: 0.8rem;
            pointer-events: none;
        }
        .sn-search-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 30px 6px 28px;
            font-size: 0.85rem;
            width: 200px;
            outline: none;
            transition: border-color 0.2s;
        }
        .sn-search-input:focus { border-color: #f9e04b; }
        .sn-search-input::placeholder { color: #555; }
        .sn-clear-search {
            position: absolute;
            left: 7px;
            background: none;
            border: none;
            color: #777;
            cursor: pointer;
            display: flex;
            align-items: center;
            padding: 0;
            font-size: 0.8rem;
        }
        .sn-clear-search:hover { color: #ccc; }

        /* ===== כפתורי סינון ===== */
        .sn-filter-btns { display: flex; gap: 6px; }
        .sn-filter-btn {
            padding: 5px 12px;
            border-radius: 5px;
            border: 1px solid #3a3a5a;
            background: #252535;
            color: #999;
            cursor: pointer;
            font-size: 0.8rem;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
        }
        .sn-filter-btn:hover { background: #303050; color: #ccc; }
        .sn-filter-btn.active {
            background: rgba(249,224,75,0.15);
            border-color: #f9e04b;
            color: #f9e04b;
        }

        /* ===== מונה + רענון ===== */
        .sn-tasks-counter {
            font-size: 0.78rem;
            color: #888;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            padding: 3px 10px;
            direction: ltr;
        }
        .sn-last-refresh {
            font-size: 0.75rem;
            color: #555;
        }
        .sn-refresh-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            padding: 5px 10px;
            transition: all 0.2s;
        }
        .sn-refresh-btn:hover { background: #303050; color: #ccc; }

        /* ===== הודעות ===== */
        .sn-error {
            margin: 8px 16px;
            padding: 8px 14px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 6px;
            color: #f87171;
            font-size: 0.85rem;
        }
        .sn-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 20px;
            color: #666;
            font-size: 0.9rem;
        }

        /* ===== Toast ===== */
        .sn-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 10px 24px;
            border-radius: 8px;
            font-size: 0.88rem;
            font-weight: 600;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s ease;
            z-index: 999999;
            direction: rtl;
            white-space: nowrap;
        }
        .sn-toast-show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .sn-toast-success {
            background: #166534;
            border: 1px solid #22c55e;
            color: #4ade80;
        }
        .sn-toast-error {
            background: #7f1d1d;
            border: 1px solid #ef4444;
            color: #fca5a5;
        }
        .sn-toast-info {
            background: #1e3a5f;
            border: 1px solid #3b82f6;
            color: #93c5fd;
        }

        /* ===== לוח ===== */
        .sn-board {
            display: grid;
            
            grid-auto-rows: auto;
            gap: 16px;
            overflow-x: hidden;
            overflow-y: auto;
            flex: 1;
            padding: 16px;
            background: radial-gradient(
                ellipse at top,
                #1e1e3a 0%,
                #111122 100%
            );
            align-content: start;
            direction: ltr;
        }
        .sn-board::-webkit-scrollbar { width: 8px; }
        .sn-board::-webkit-scrollbar-track { background: #111; }
        .sn-board::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 4px;
        }

        /* ===== עמודת עובד ===== */
        .sn-employee-col {
            width: 100%;
            display: flex;
            flex-direction: column;
            border-radius: 12px;
            overflow: hidden;
            box-shadow:
                0 4px 20px rgba(0,0,0,0.4),
                0 1px 4px rgba(0,0,0,0.3);
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            /* גובה קבוע: כותרת + 3 פתקים בערך */
            direction: rtl;
        }

        /* ===== גריד פתקים ===== */
        .sn-notes-grid {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 10px;
            overflow-y: visible;
            flex: 1;
        }
        .sn-notes-grid::-webkit-scrollbar { width: 5px; }
        .sn-notes-grid::-webkit-scrollbar-track {
            background: rgba(0,0,0,0.1);
            border-radius: 3px;
        }
        .sn-notes-grid::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.25);
            border-radius: 3px;
        }
        .sn-notes-grid::-webkit-scrollbar-thumb:hover {
            background: rgba(0,0,0,0.4);
        }

        /* ===== ריק ===== */
        .sn-empty {
            grid-column: 1 / -1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            width: 100%;
            padding: 60px 20px;
            color: #444;
            font-size: 1.1rem;
        }
        .sn-empty i { font-size: 3rem; color: #333; }

        /* ===== כותרת עובד ===== */
        .sn-emp-header {
            padding: 12px 14px 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            flex-shrink: 0;
        }
        .sn-emp-header-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .sn-emp-avatar {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.85rem;
            font-weight: 700;
            color: #fff;
            flex-shrink: 0;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        .sn-emp-info { flex: 1; min-width: 0; }
        .sn-emp-name {
            font-size: 0.95rem;
            font-weight: 700;
            color: #1a1a1a;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sn-emp-stats {
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
            margin-top: 3px;
        }
        .sn-stat-badge {
            font-size: 0.68rem;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            gap: 3px;
        }
        .sn-stat-badge.total {
            background: rgba(0,0,0,0.15);
            color: #333;
        }
        .sn-stat-badge.done {
            background: rgba(34,197,94,0.25);
            color: #166534;
        }
        .sn-stat-badge.overdue {
            background: rgba(239,68,68,0.25);
            color: #991b1b;
        }

        /* Progress בכותרת */
        .sn-emp-progress-wrap {
            position: relative;
            height: 6px;
            background: rgba(0,0,0,0.15);
            border-radius: 3px;
            overflow: visible;
        }
        .sn-emp-progress-bar {
            height: 100%;
            border-radius: 3px;
            transition: width 0.5s ease;
            min-width: 2px;
            opacity: 0.7;
        }
        .sn-emp-progress-pct {
            position: absolute;
            left: 0;
            top: -16px;
            font-size: 0.65rem;
            font-weight: 700;
            color: #333;
        }
        
        .sn-notes-grid::-webkit-scrollbar { width: 4px; }
        .sn-notes-grid::-webkit-scrollbar-track {
            background: transparent;
        }
        .sn-notes-grid::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.2);
            border-radius: 2px;
        }

        /* ===== פתק בודד ===== */
        .sn-note {
            position: relative;
            border-radius: 4px;
            padding: 10px 12px 12px 12px;
            box-shadow:
                2px 3px 8px rgba(0,0,0,0.25),
                0 1px 2px rgba(0,0,0,0.15);
            transition: transform 0.15s ease,
                        box-shadow 0.15s ease,
                        opacity 0.4s ease;
            overflow: hidden;
            animation: snNoteIn 0.2s ease forwards;
            direction: rtl;
        }
        .sn-note:hover {
            transform: translateY(-2px) rotate(0.3deg);
            box-shadow:
                4px 6px 16px rgba(0,0,0,0.35),
                0 2px 4px rgba(0,0,0,0.2);
            z-index: 10;
        }
        .sn-note-done      { opacity: 0.6; }
        .sn-note-cancelled { opacity: 0.45; }
        .sn-note-done .sn-note-title {
            color: #666 !important;
        }
        .sn-note-overdue {
            box-shadow:
                2px 3px 8px rgba(239,68,68,0.3),
                0 0 0 1px rgba(239,68,68,0.4);
        }

        /* אנימציית סיום */
        .sn-note-completing {
            transform: scale(0.95);
            opacity: 0.4;
            transition: all 0.4s ease !important;
        }

        /* ===== פין - סיכה אמיתית ===== */
        .sn-note-pin {
            position: absolute;
            top: 1px;
            left: 50%;
            transform: translateX(-50%) rotate(15deg);  /* ← סיבוב אלכסוני */
            width: 20px;
            height: 32px;
            z-index: 10;
            filter: drop-shadow(0 3px 4px rgba(0,0,0,0.45));
        }

        /* ראש הסיכה - הכדור העגול למעלה */
        .sn-note-pin::before {
            content: '';
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: radial-gradient(
                circle at 35% 35%,
                #ff9999,
                #cc0000 45%,
                #880000
            );
            box-shadow:
                0 2px 4px rgba(0,0,0,0.5),
                inset 0 1px 2px rgba(255,255,255,0.4),
                inset 0 -1px 2px rgba(0,0,0,0.3);
        }

        /* גוף הסיכה - סיבוב אלכסוני */
        .sn-note-pin::after {
            content: '';
            position: absolute;
            top: 11px;
            left: 50%;
            transform: translateX(-50%);
            width: 2px;
            height: 6px;          /* ← גובה ממשי לציר */
            background: linear-gradient(to bottom, #999, #ccc);
            border-radius: 0 0 2px 2px;
            filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
        }

        /* ===== כותרת פתק ===== */
        .sn-note-header {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            margin-top: 6px;
            margin-bottom: 6px;
        }
        .sn-note-priority-icon {
            font-size: 0.75rem;
            flex-shrink: 0;
            line-height: 1.4;
        }
        .sn-note-title {
            flex: 1;
            font-size: 0.85rem;
            font-weight: 700;
            color: #1a1a1a;
            line-height: 1.35;
            word-break: break-word;
        }

        /* ===== תיאור ===== */
        .sn-note-desc {
            font-size: 0.75rem;
            color: #444;
            line-height: 1.4;
            margin-bottom: 6px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
        }

        /* ===== תאריך יעד ===== */
        .sn-note-due {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 0.7rem;
            color: #555;
            margin-bottom: 5px;
        }
        .sn-note-due.overdue {
            color: #c0392b;
            font-weight: 600;
        }
        .sn-note-due i { font-size: 0.65rem; }
        .sn-overdue-badge {
            background: #c0392b;
            color: #fff;
            font-size: 0.6rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px;
        }

        /* ===== Progress ===== */
        .sn-note-progress {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
        }
        .sn-note-progress-track {
            flex: 1;
            height: 5px;
            background: rgba(0,0,0,0.15);
            border-radius: 3px;
            overflow: hidden;
        }
        .sn-note-progress-fill {
            height: 100%;
            background: rgba(0,0,0,0.35);
            border-radius: 3px;
            transition: width 0.4s ease;
            min-width: 2px;
        }
        .sn-note-progress-pct {
            font-size: 0.65rem;
            font-weight: 700;
            color: #333;
            min-width: 28px;
            text-align: left;
        }

        /* ===== Footer ===== */
        .sn-note-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
            margin-top: 4px;
            margin-bottom: 6px;
        }
        .sn-note-status-badge {
            font-size: 0.65rem;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 10px;
        }
        .sn-note-status-badge.new {
            background: rgba(99,102,241,0.2);
            color: #3730a3;
        }
        .sn-note-status-badge.in-progress {
            background: rgba(59,130,246,0.2);
            color: #1d4ed8;
        }
        .sn-note-status-badge.waiting {
            background: rgba(245,158,11,0.2);
            color: #92400e;
        }
        .sn-note-status-badge.done {
            background: rgba(34,197,94,0.2);
            color: #166534;
        }
        .sn-note-status-badge.cancelled {
            background: rgba(107,114,128,0.2);
            color: #374151;
        }
        .sn-note-status-badge.overdue {
            background: rgba(239,68,68,0.2);
            color: #991b1b;
        }
        .sn-note-time {
            font-size: 0.65rem;
            color: #666;
            display: flex;
            align-items: center;
            gap: 3px;
        }

        /* ===== כפתורי פעולה ===== */
        .sn-action-btns {
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }

        /* כפתור בביצוע */
        .sn-inprogress-btn {
            flex: 1;
            padding: 6px 0;
            background: rgba(59,130,246,0.12);
            border: 1px solid rgba(59,130,246,0.25);
            border-radius: 5px;
            color: #1d4ed8;
            font-size: 0.78rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            transition: all 0.2s;
        }
        .sn-inprogress-btn:hover:not(:disabled) {
            background: rgba(59,130,246,0.25);
            border-color: rgba(59,130,246,0.5);
            color: #1e40af;
            transform: translateY(-1px);
        }
        .sn-inprogress-btn:active:not(:disabled) {
            transform: translateY(0);
        }
        .sn-inprogress-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            background: rgba(59,130,246,0.08);
        }

        /* כפתור בוצע — מותאם לתוך flex */
        .sn-action-btns .sn-done-btn {
            flex: 1;
            margin-top: 0;
        }

        /* אנימציית עדכון */
        .sn-note-updating {
            transform: scale(0.97);
            opacity: 0.7;
            transition: all 0.3s ease !important;
        }
        /* ===== כפתור בוצע ===== */
        .sn-done-btn {
            width: 100%;
            padding: 6px 0;
            background: rgba(0,0,0,0.12);
            border: 1px solid rgba(0,0,0,0.18);
            border-radius: 5px;
            color: #1a5c2a;
            font-size: 0.78rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            transition: all 0.2s;
            margin-top: 4px;
        }
        .sn-done-btn:hover:not(:disabled) {
            background: rgba(34,197,94,0.25);
            border-color: rgba(34,197,94,0.5);
            color: #14532d;
            transform: translateY(-1px);
        }
        .sn-done-btn:active:not(:disabled) {
            transform: translateY(0);
        }
        .sn-done-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* ===== חותמת בוצע/מבוטל ===== */
        .sn-done-stamp {
            width: 100%;
            padding: 5px 0;
            text-align: center;
            font-size: 0.75rem;
            font-weight: 700;
            color: #555;
            border-top: 1px dashed rgba(0,0,0,0.15);
            margin-top: 4px;
        }

        /* ===== קיפול פינה ===== */
        .sn-note-fold {
            position: absolute;
            bottom: 0;
            right: 0;
            width: 0;
            height: 0;
            border-style: solid;
            border-width: 0 0 14px 14px;
            border-color: transparent transparent
                          rgba(0,0,0,0.12) transparent;
        }

                /* ===== מצב עובד בודד — כל השורה ===== */

        /* הלוח עצמו עובר ל-1 עמודה */
        .sn-board-single-employee {
            grid-template-columns: 1fr !important;
        }

        /* העמודה תופסת את כל הרוחב */
        .sn-employee-col-full {
            max-height: none !important;
            /* גובה דינמי לפי תוכן + גלילה חיצונית */
        }

        /* גריד הפתקים — 5 בשורה */
        .sn-employee-col-full .sn-notes-grid {
            display: grid !important;
            grid-template-columns: repeat(5, 1fr);
            gap: 12px;
            max-height: none !important;
            overflow-y: visible !important;
            padding: 14px;
        }

        /* הפתקים לא מוגבלים בגובה */
        .sn-employee-col-full .sn-note {
            height: auto;
        }

        /* כותרת העובד — קצת יותר גדולה */
        .sn-employee-col-full .sn-emp-header {
            padding: 14px 18px 12px 18px;
        }
        .sn-employee-col-full .sn-emp-name {
            font-size: 1.05rem;
        }
        .sn-employee-col-full .sn-emp-avatar {
            width: 44px;
            height: 44px;
            font-size: 0.95rem;
        }

        /* ===== אנימציות ===== */
        @keyframes snNoteIn {
            from {
                opacity: 0;
                transform: translateY(-6px) scale(0.97);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        /* ===== כפתורי עריכה/מחיקה על הפתק ===== */
        .sn-note-edit-actions {
            display: flex;
            gap: 4px;
            justify-content: flex-end;
            margin-top: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .sn-note:hover .sn-note-edit-actions {
            opacity: 1;
        }
        .sn-edit-btn, .sn-delete-btn {
            background: rgba(0,0,0,0.1);
            border: 1px solid rgba(0,0,0,0.15);
            border-radius: 4px;
            padding: 3px 7px;
            cursor: pointer;
            font-size: 0.72rem;
            transition: all 0.2s;
        }
        .sn-edit-btn { color: #1d4ed8; }
        .sn-edit-btn:hover {
            background: rgba(59,130,246,0.2);
            border-color: rgba(59,130,246,0.4);
        }
        .sn-delete-btn { color: #991b1b; }
        .sn-delete-btn:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.4);
        }

        /* ===== כפתור יומן על הפתק ===== */
        .sn-calendar-btn {
            background: rgba(0,0,0,0.1);
            border: 1px solid rgba(0,0,0,0.15);
            border-radius: 4px;
            padding: 3px 7px;
            cursor: pointer;
            font-size: 0.72rem;
            color: #0369a1;
            transition: all 0.2s;
        }
        .sn-calendar-btn:hover {
            background: rgba(3,105,161,0.2);
            border-color: rgba(3,105,161,0.4);
            color: #075985;
        }

        /* ===== כפתור הוסף משימה ===== */
        .sn-add-task-btn {
            padding: 6px 14px;
            background: rgba(124,58,237,0.2);
            border: 1px solid rgba(124,58,237,0.4);
            border-radius: 6px;
            color: #a78bfa;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sn-add-task-btn:hover {
            background: rgba(124,58,237,0.35);
            border-color: rgba(124,58,237,0.6);
            color: #c4b5fd;
        }

        /* ===== מודל ===== */
        .sn-modal-overlay {
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: snFadeIn 0.2s ease;
        }
        @keyframes snFadeIn {
            from { opacity: 0; }
            to   { opacity: 1; }
        }
        .sn-modal {
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 12px;
            width: 90%;
            max-width: 520px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            animation: snSlideIn 0.2s ease;
            direction: rtl;
        }
        @keyframes snSlideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to   { transform: translateY(0);     opacity: 1; }
        }
        .sn-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #2a2a4e;
        }
        .sn-modal-title {
            font-size: 1rem;
            font-weight: 700;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
        }
        .sn-modal-title i { color: #a78bfa; }
        .sn-modal-close {
            background: none;
            border: none;
            color: #888;
            font-size: 22px;
            cursor: pointer;
            line-height: 1;
            padding: 0 4px;
            transition: color 0.2s;
        }
        .sn-modal-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .sn-modal-footer {
            display: flex;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid #2a2a4e;
            justify-content: flex-end;
        }

        /* ===== שדות טופס ===== */
        .sn-form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .sn-form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .sn-form-label {
            font-size: 0.82rem;
            font-weight: 600;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .sn-form-label i { color: #a78bfa; }
        .sn-form-input,
        .sn-form-select,
        .sn-form-textarea {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 8px 12px;
            font-size: 0.88rem;
            outline: none;
            transition: border-color 0.2s;
            font-family: inherit;
            direction: rtl;
        }
        .sn-form-input:focus,
        .sn-form-select:focus,
        .sn-form-textarea:focus {
            border-color: #7c3aed;
            box-shadow: 0 0 0 2px rgba(124,58,237,0.15);
        }
        .sn-form-input::placeholder,
        .sn-form-textarea::placeholder {
            color: #555;
        }
        .sn-form-textarea {
            resize: vertical;
            min-height: 80px;
        }
        .sn-form-select option {
            background: #252535;
            color: #e0e0e0;
        }

        /* ===== תאריך יעד ===== */
        .sn-form-date-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .sn-form-date-wrap .sn-form-input {
            flex: 1;
            padding-left: 36px;
        }
        .sn-form-date-clear {
            position: absolute;
            left: 8px;
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 0.8rem;
            padding: 0;
            display: flex;
            align-items: center;
            transition: color 0.2s;
        }
        .sn-form-date-clear:hover { color: #f87171; }

        /* ===== Slider התקדמות ===== */
        .sn-form-range {
            width: 100%;
            accent-color: #7c3aed;
            cursor: pointer;
            height: 4px;
        }
        .sn-form-progress-preview {
            height: 8px;
            background: #333;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 4px;
        }
        .sn-form-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #7c3aed, #a78bfa);
            border-radius: 4px;
            transition: width 0.2s ease;
            min-width: 2px;
        }

        /* ===== כפתורי Footer ===== */
        .sn-modal-cancel-btn {
            padding: 9px 18px;
            background: transparent;
            border: 1px solid #444;
            border-radius: 6px;
            color: #999;
            font-size: 0.88rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sn-modal-cancel-btn:hover {
            background: #2a2a3a;
            color: #ccc;
            border-color: #666;
        }
        .sn-modal-save-btn {
            padding: 9px 20px;
            background: #7c3aed;
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 0.88rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.2s;
        }
        .sn-modal-save-btn:hover { background: #6d28d9; }
        .sn-modal-save-btn:disabled {
            background: #444;
            color: #777;
            cursor: not-allowed;
        }

        /* ===== Scrollbar במודל ===== */
        .sn-modal::-webkit-scrollbar { width: 6px; }
        .sn-modal::-webkit-scrollbar-track { background: #1a1a2e; }
        .sn-modal::-webkit-scrollbar-thumb {
            background: #3a3a5a;
            border-radius: 3px;
        }

        /* ===== גרירה ===== */
        .sn-draggable { cursor: grab; }
        .sn-draggable:active { cursor: grabbing; }

        .sn-note-dragging {
            opacity: 0.35 !important;
            transform: rotate(2deg) scale(1.02);
            box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
        }

        .sn-drag-placeholder {
            height: 60px;
            border: 2px dashed rgba(249,224,75,0.5);
            border-radius: 6px;
            background: rgba(249,224,75,0.06);
            transition: all 0.15s ease;
            animation: snPlaceholderIn 0.15s ease;
        }

        @keyframes snPlaceholderIn {
            from { opacity: 0; transform: scaleY(0.5); }
            to   { opacity: 1; transform: scaleY(1); }
        }

        .sn-drag-over {
            background: rgba(249,224,75,0.04);
            border-radius: 8px;
        }

        /* ===== מיון ===== */
        .sn-sort-wrap {
            position: relative;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .sn-sort-icon {
            position: absolute;
            right: 9px;
            color: #888;
            font-size: 0.78rem;
            pointer-events: none;
            z-index: 1;
        }
        .sn-sort-select {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 28px 6px 10px;
            font-size: 0.85rem;
            outline: none;
            cursor: pointer;
            min-width: 160px;
            direction: rtl;
            appearance: none;
            -webkit-appearance: none;
            transition: border-color 0.2s;
            direction: ltr;
        }
        .sn-sort-select:focus {
            border-color: #f9e04b;
            box-shadow: 0 0 0 2px rgba(249,224,75,0.15);
        }
        .sn-sort-select option {
            background: #252535;
            color: #e0e0e0;
        }

        /* ===== כפתור כיוון מיון ===== */
        .sn-sort-dir-btn {
            padding: 6px 9px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            margin-right: 4px;
            flex-shrink: 0;
        }
        .sn-sort-dir-btn:hover {
            background: #303050;
            color: #ccc;
            border-color: #555;
        }
        .sn-sort-dir-btn.sn-sort-dir-asc {
            color: #4ade80;
            border-color: rgba(74,222,128,0.4);
            background: rgba(74,222,128,0.08);
        }
        .sn-sort-dir-btn.sn-sort-dir-asc:hover {
            background: rgba(74,222,128,0.15);
            border-color: rgba(74,222,128,0.6);
        }
        .sn-sort-dir-btn.sn-sort-dir-desc {
            color: #f9e04b;
            border-color: rgba(249,224,75,0.4);
            background: rgba(249,224,75,0.08);
        }
        .sn-sort-dir-btn.sn-sort-dir-desc:hover {
            background: rgba(249,224,75,0.15);
            border-color: rgba(249,224,75,0.6);
        }

        /* ===== כפתורי שינוי אחוזים על הפתק ===== */
        .sn-note-progress-controls {
            display: flex;
            gap: 4px;
            justify-content: flex-end;
            margin-top: 2px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .sn-note:hover .sn-note-progress-controls {
            opacity: 1;
        }
        .sn-progress-minus-btn,
        .sn-progress-plus-btn {
            background: rgba(0,0,0,0.1);
            border: 1px solid rgba(0,0,0,0.2);
            border-radius: 4px;
            padding: 2px 8px;
            cursor: pointer;
            font-size: 0.7rem;
            color: #333;
            transition: all 0.2s;
            display: flex;
            align-items: center;
        }
        .sn-progress-minus-btn:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.4);
            color: #991b1b;
        }
        .sn-progress-plus-btn:hover {
            background: rgba(34,197,94,0.2);
            border-color: rgba(34,197,94,0.4);
            color: #166534;
        }

        /* ===== Status Columns Layout ===== */
        .sn-board-status-columns {
            display: block !important;
            padding: 16px;
            overflow-y: auto;
        }

        .sn-status-columns-wrapper {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 14px;
            align-items: start;
            direction: rtl;
        }

        /* טור סטטוס בודד */
        .sn-status-col {
            border-radius: 10px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            min-height: 200px;
        }

        /* כותרת הטור */
        .sn-status-col-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 14px;
            font-size: 0.88rem;
            font-weight: 700;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            direction: rtl;
        }
        .sn-status-col-header i {
            font-size: 0.85rem;
        }
        .sn-status-col-count {
            margin-right: auto;  /* דחוף לצד שמאל */
            font-size: 0.72rem;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 10px;
        }

        /* גוף הטור */
        .sn-status-col-body {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 10px;
            flex: 1;
        }

        /* ריק */
        .sn-status-col-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 30px 10px;
            color: #444;
            font-size: 0.78rem;
            text-align: center;
        }
        .sn-status-col-empty i {
            font-size: 1.5rem;
            color: #333;
        }

        /* רספונסיבי */
        @media (max-width: 1200px) {
            .sn-status-columns-wrapper {
                grid-template-columns: repeat(3, 1fr);
            }
        }
        @media (max-width: 768px) {
            .sn-status-columns-wrapper {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        @media (max-width: 480px) {
            .sn-status-columns-wrapper {
                grid-template-columns: 1fr;
            }
        }

        /* ===== Free Mode ===== */
        .sn-board-free {
            display: block !important;
            overflow: auto;
            padding: 0;
        }

        .sn-free-canvas {
            position: relative;
            width: 100%;
            min-height: 100vh;
            background-image:
                radial-gradient(circle,
                    rgba(255,255,255,0.04) 1px,
                    transparent 1px);
            background-size: 28px 28px;
        }

        .sn-free-note {
            position: absolute !important;
            width: 220px;
            cursor: grab;
            transition: box-shadow 0.2s ease,
                        transform 0.1s ease;
            user-select: none;
        }

        .sn-free-note:hover {
            z-index: 100;
        }

        .sn-free-dragging {
            cursor: grabbing !important;
            transform: rotate(2deg) scale(1.04) !important;
            box-shadow: 0 12px 32px rgba(0,0,0,0.5) !important;
            z-index: 1000 !important;
            transition: none !important;
        }

        /* כפתור Free Mode */
        .sn-freemode-btn {
            padding: 6px 14px;
            background: rgba(249,224,75,0.1);
            border: 1px solid rgba(249,224,75,0.3);
            border-radius: 6px;
            color: #f9e04b;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sn-freemode-btn:hover {
            background: rgba(249,224,75,0.2);
            border-color: rgba(249,224,75,0.5);
        }
        .sn-freemode-btn.active {
            background: rgba(249,224,75,0.25);
            border-color: #f9e04b;
            color: #f9e04b;
            box-shadow: 0 0 8px rgba(249,224,75,0.2);
        }
        /* ===== סלקט מיון מושבת במצב Free ===== */
        .sn-sort-disabled {
            opacity: 0.35;
            pointer-events: none;
            position: relative;
        }

        .sn-sort-disabled::after {
            content: '';
            position: absolute;
            inset: 0;
            cursor: not-allowed;
            border-radius: 6px;
        }

        .sn-sort-disabled .sn-sort-select {
            cursor: not-allowed;
            border-color: #2a2a4a;
            color: #555;
        }

        /* ===== Color Mode Panel ===== */
        .sn-color-panel {
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99998;
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 12px;
            width: 320px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            direction: rtl;
            animation: snFadeIn 0.2s ease;
        }

        .sn-color-panel-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 14px 16px;
            border-bottom: 1px solid #2a2a4e;
            font-size: 0.9rem;
            font-weight: 700;
            color: #e0e0e0;
        }
        .sn-color-panel-header i {
            color: #a78bfa;
        }
        .sn-color-panel-close {
            margin-right: auto;
            background: none;
            border: none;
            color: #888;
            font-size: 20px;
            cursor: pointer;
            line-height: 1;
            padding: 0 4px;
            transition: color 0.2s;
        }
        .sn-color-panel-close:hover { color: #ccc; }

        .sn-color-panel-body {
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .sn-color-panel-label {
            font-size: 0.78rem;
            color: #888;
            margin: 0;
        }

        /* ===== אפשרויות מצב צבע ===== */
        .sn-color-mode-options {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .sn-color-mode-opt {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid #2a2a4e;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 0.82rem;
            color: #aaa;
            background: #252535;
        }
        .sn-color-mode-opt:hover {
            background: #2a2a3e;
            border-color: #3a3a5a;
            color: #ccc;
        }
        .sn-color-mode-opt.active {
            background: rgba(124,58,237,0.15);
            border-color: rgba(124,58,237,0.4);
            color: #c4b5fd;
        }
        .sn-color-mode-opt input[type="radio"] {
            display: none;
        }
        .sn-color-mode-opt i {
            font-size: 0.82rem;
            width: 14px;
            text-align: center;
            color: #a78bfa;
            flex-shrink: 0;
        }
        .sn-color-mode-opt span {
            flex: 1;
        }

        /* תצוגה מקדימה של צבעים בשורה */
        .sn-color-mode-preview {
            display: flex;
            gap: 3px;
            flex-shrink: 0;
        }
        .sn-color-mode-preview span {
            width: 14px;
            height: 14px;
            border-radius: 3px;
            flex-shrink: 0;
            border: 1px solid rgba(0,0,0,0.1);
        }

        /* ===== מקרא צבעים ===== */
        .sn-color-legend {
            padding: 10px 12px;
            background: #252535;
            border-radius: 8px;
            border: 1px solid #2a2a4e;
            min-height: 40px;
        }
        .sn-legend-title {
            font-size: 0.75rem;
            color: #888;
            margin-bottom: 8px;
            font-weight: 600;
        }
        .sn-legend-items {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .sn-legend-item {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.75rem;
            color: #aaa;
        }
        .sn-legend-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            flex-shrink: 0;
            border: 1px solid rgba(0,0,0,0.15);
        }

        /* ===== כפתור בחירת צבע על הפתק ===== */
        .sn-color-pick-btn {
            background: rgba(0,0,0,0.1);
            border: 1px solid rgba(0,0,0,0.15);
            border-radius: 4px;
            padding: 3px 7px;
            cursor: pointer;
            font-size: 0.72rem;
            color: #7c3aed;
            transition: all 0.2s;
        }
        .sn-color-pick-btn:hover {
            background: rgba(124,58,237,0.2);
            border-color: rgba(124,58,237,0.4);
        }

        /* ===== Mini Color Picker ===== */
        .sn-mini-color-picker {
            position: absolute;
            z-index: 999999;
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            padding: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.6);
            width: 220px;
            direction: rtl;
            animation: snFadeIn 0.15s ease;
        }

        .sn-mini-picker-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #aaa;
            margin-bottom: 10px;
            text-align: center;
        }

        .sn-mini-picker-grid {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 6px;
            margin-bottom: 10px;
        }

        .sn-mini-color-swatch {
            width: 100%;
            aspect-ratio: 1;
            border-radius: 5px;
            border: 2px solid transparent;
            cursor: pointer;
            transition: transform 0.15s ease,
                        border-color 0.15s ease;
            padding: 0;
        }
        .sn-mini-color-swatch:hover {
            transform: scale(1.15);
            border-color: rgba(255,255,255,0.5);
        }
        .sn-mini-color-swatch.selected {
            border-color: #fff;
            transform: scale(1.1);
            box-shadow: 0 0 0 2px rgba(255,255,255,0.3);
        }

        .sn-mini-picker-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding-top: 8px;
            border-top: 1px solid #2a2a4e;
        }

        .sn-mini-picker-reset {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 5px;
            color: #f87171;
            font-size: 0.75rem;
            font-weight: 600;
            padding: 5px 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
            direction: rtl;
        }
        .sn-mini-picker-reset:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.5);
        }

        .sn-mini-custom-color {
            width: 36px;
            height: 30px;
            border: 1px solid #3a3a5a;
            border-radius: 5px;
            background: #252535;
            cursor: pointer;
            padding: 2px;
            transition: border-color 0.2s;
        }
        .sn-mini-custom-color:hover {
            border-color: #a78bfa;
        }

        /* ===== כפתור מצב צבע ===== */
        .sn-color-mode-btn {
            padding: 6px 10px;
            background: rgba(167,139,250,0.1);
            border: 1px solid rgba(167,139,250,0.3);
            border-radius: 6px;
            color: #a78bfa;
            font-size: 0.85rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sn-color-mode-btn:hover {
            background: rgba(167,139,250,0.2);
            border-color: rgba(167,139,250,0.5);
            color: #c4b5fd;
        }
        .sn-color-mode-btn.active {
            background: rgba(167,139,250,0.25);
            border-color: #a78bfa;
            color: #c4b5fd;
            box-shadow: 0 0 8px rgba(167,139,250,0.2);
        }
        /* ===== מזעור פתק ===== */
        .sn-note-body-hidden {
            display: none !important;
        }

        .sn-note-minimized {
            padding-bottom: 6px !important;
        }

        .sn-note-minimized .sn-note-pin {
            display: none;
        }

        .sn-note-minimized .sn-note-fold {
            display: none;
        }

        .sn-minimize-btn {
            background: rgba(0,0,0,0.1);
            border: 1px solid rgba(0,0,0,0.15);
            border-radius: 4px;
            padding: 3px 7px;
            cursor: pointer;
            font-size: 0.72rem;
            color: #555;
            transition: all 0.2s;
        }
        .sn-minimize-btn:hover {
            background: rgba(0,0,0,0.2);
            color: #222;
        }

        /* ===== Free Mode Toolbar ===== */
        .sn-free-toolbar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 16px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            direction: rtl;
            flex-shrink: 0;
        }

        .sn-free-reset-btn {
            padding: 6px 14px;
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 6px;
            color: #f87171;
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sn-free-reset-btn:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.5);
        }

        .sn-free-hint {
            font-size: 0.75rem;
            color: #555;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        /* ===== Toggle All Btn ===== */
        .sn-toggle-all-btn {
            padding: 6px 10px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 6px;
            color: #aaa;
            font-size: 0.82rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .sn-toggle-all-btn.sn-toggle-all-collapse:hover {
            background: rgba(249,224,75,0.1);
            border-color: rgba(249,224,75,0.3);
            color: #f9e04b;
        }
        .sn-toggle-all-btn.sn-toggle-all-expand:hover {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.3);
            color: #4ade80;
        }
        /* ===== Status Columns Drag & Drop ===== */
        .sn-status-col-draggable {
            cursor: grab;
        }
        .sn-status-col-draggable:active {
            cursor: grabbing;
        }

        .sn-status-col-dragging {
            opacity: 0.35 !important;
            transform: rotate(1.5deg) scale(1.02);
            box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;
        }

        .sn-status-col-placeholder {
            height: 55px;
            border: 2px dashed rgba(255,255,255,0.25);
            border-radius: 6px;
            background: rgba(255,255,255,0.04);
            transition: all 0.15s ease;
            animation: snPlaceholderIn 0.15s ease;
            margin: 2px 0;
        }

        .sn-status-col-drag-over {
            background: rgba(255,255,255,0.04) !important;
            border-radius: 8px;
            outline: 1px dashed rgba(255,255,255,0.1);
            outline-offset: -4px;
        }
        /* ===== Status Reset Bar ===== */
        .sn-status-reset-bar {
            display: flex;
            justify-content: start;
            padding: 0 4px 10px 4px;
            direction: rtl;
            gap: 12px;
        }

        .sn-status-reset-all-btn {
            padding: 5px 12px;
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 6px;
            color: #f87171;
            font-size: 0.78rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            direction: rtl;
        }
        .sn-status-reset-all-btn:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.5);
        }
        /* ===== Legend Progress - עיצוב מיוחד ===== */
        .sn-legend-progress {
            display: flex;
            flex-direction: column !important;
            gap: 6px !important;
        }

        .sn-legend-progress-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 4px 6px;
            border-radius: 6px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.05);
            transition: background 0.15s;
        }
        .sn-legend-progress-item:hover {
            background: rgba(255,255,255,0.07);
        }

        .sn-legend-dot-lg {
            width: 18px !important;
            height: 18px !important;
            border-radius: 4px !important;
            flex-shrink: 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .sn-legend-progress-info {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex: 1;
            gap: 8px;
        }

        .sn-legend-pct {
            font-size: 0.78rem;
            font-weight: 700;
            color: #ccc;
            min-width: 70px;
            direction: ltr;
        }

        .sn-legend-label {
            font-size: 0.72rem;
            color: #777;
            text-align: right;
        }

        /* ===== צבעי פתקים בולטים - progress mode ===== */
        /* גרדיאנט עדין על הפתק לפי צבע הרקע */
        .sn-note[style*="background: #ff4757"],
        .sn-note[style*="background:#ff4757"] {
            box-shadow:
                2px 3px 8px rgba(255,71,87,0.35),
                0 0 0 1px rgba(255,71,87,0.2) !important;
        }
        .sn-note[style*="background: #ff6b35"],
        .sn-note[style*="background:#ff6b35"] {
            box-shadow:
                2px 3px 8px rgba(255,107,53,0.35),
                0 0 0 1px rgba(255,107,53,0.2) !important;
        }
        .sn-note[style*="background: #ffa502"],
        .sn-note[style*="background:#ffa502"] {
            box-shadow:
                2px 3px 8px rgba(255,165,2,0.35),
                0 0 0 1px rgba(255,165,2,0.2) !important;
        }
        .sn-note[style*="background: #7bed9f"],
        .sn-note[style*="background:#7bed9f"] {
            box-shadow:
                2px 3px 8px rgba(123,237,159,0.35),
                0 0 0 1px rgba(123,237,159,0.2) !important;
        }
        .sn-note[style*="background: #2ed573"],
        .sn-note[style*="background:#2ed573"] {
            box-shadow:
                2px 3px 8px rgba(46,213,115,0.35),
                0 0 0 1px rgba(46,213,115,0.2) !important;
        }
        .sn-note[style*="background: #00b894"],
        .sn-note[style*="background:#00b894"] {
            box-shadow:
                2px 3px 8px rgba(0,184,148,0.35),
                0 0 0 1px rgba(0,184,148,0.2) !important;
        }

        /* ===== כפתור ייצוא אקסל ===== */
        .sn-export-btn {
            padding: 6px 10px;
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.3);
            border-radius: 6px;
            color: #4ade80;
            font-size: 0.85rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sn-export-btn:hover {
            background: rgba(34,197,94,0.22);
            border-color: rgba(34,197,94,0.55);
            color: #86efac;
        }
        .sn-export-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        `;

        document.head.appendChild(style);
    }
}