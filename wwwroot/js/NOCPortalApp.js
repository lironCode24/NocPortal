class NOCPortalApp {
    constructor() {
        this.shiftsManager = new ShiftsManager();
        this.messagesManager = new MessagesManager();
        this.proceduresManager = new ProceduresManager();
        this.dailyTasksManager = new DailyTasksManager();
        this.sectionManager = new SectionManager();
        this.refreshInterval = null;
        this.midnightRefreshTimeout = null;
    }

    // Initialize the application
    async initialize() {
        try {
            // Initialize section states
            this.sectionManager.initializeSectionStates();

            // Load all data
            await Promise.all([
                this.shiftsManager.loadShiftsTable(),
                this.messagesManager.loadMessages(),
                this.proceduresManager.loadProcedures()
            ]);

            // Initialize daily tasks
            this.dailyTasksManager.initializeDailyTasks();

            // Update current shift indicator
            this.shiftsManager.updateCurrentShiftIndicator();

            // Setup event listeners
            this.setupEventListeners();

            // Start auto-refresh
            this.startAutoRefresh();

            // Schedule midnight refresh
            this.scheduleRefresh();
        } catch (error) {
            console.error('Error initializing NOC Portal:', error);
            NotificationManager.show('שגיאה באתחול המערכת', 'error');
        }
    }

    // Setup event listeners
    setupEventListeners() {
        // Filter tabs functionality
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const filterType = tab.textContent.trim();
                this.messagesManager.filterMessages(filterType);
            });
        });

        // Search functionality for messages
        const messageSearchInput = document.querySelector('.search-box input');
        if (messageSearchInput) {
            messageSearchInput.addEventListener('input', (e) => {
                this.searchMessages(e.target.value.toLowerCase());
            });
        }

        // Search functionality for procedures
        const proceduresSearchInput = document.getElementById('proceduresSearchInput');
        if (proceduresSearchInput) {
            proceduresSearchInput.addEventListener('input', (e) => {
                this.proceduresManager.searchProcedures(e.target.value.toLowerCase().trim());
            });
        }

        // Form submissions
        this.setupFormSubmissions();

        // Modal close events
        this.setupModalEvents();

        // Date picker events
        this.setupDatePickerEvents();
    }

    // Setup form submissions
    setupFormSubmissions() {
        // Message form
        const messageForm = document.getElementById('addMessageForm');
        if (messageForm) {
            messageForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const messageId = document.getElementById('messageId').value;
                const isEditing = messageId !== '';

                const messageData = {
                    title: document.getElementById('messageTitle').value,
                    content: document.getElementById('messageContent').value,
                    category: document.getElementById('messageCategory').value,
                    author: document.getElementById('messageAuthor').value || 'מנהל מערכת',
                    priority: document.getElementById('messagePriority').value,
                    dueDate: document.getElementById('messageDueDate').value
                };

                if (isEditing) {
                    messageData.id = messageId;
                }

                await this.messagesManager.saveMessage(messageData, isEditing);
            });
        }

        // Task form
        const taskForm = document.getElementById('addTaskForm');
        if (taskForm) {
            taskForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const taskId = document.getElementById('taskId').value;
                const isEditing = taskId !== '';

                const taskData = {
                    id: taskId,
                    title: document.getElementById('taskTitle').value,
                    description: document.getElementById('taskDescription').value,
                    priority: document.getElementById('taskPriority').value,
                    time: document.getElementById('taskTime').value,
                    taskHour: document.getElementById('taskHour').value,
                    taskMinute: document.getElementById('taskMinute').value,
                    date: this.dailyTasksManager.currentTaskDate,
                    completed: false,
                    enableAlarm: document.getElementById('taskEnableAlarm').checked || false
                };

                await this.dailyTasksManager.saveTask(taskData, isEditing);
            });
        }

        // Skip reason form
        const skipReasonForm = document.getElementById('skipReasonForm');
        if (skipReasonForm) {
            skipReasonForm.addEventListener('submit', async (e) => {
                e.preventDefault();

                const taskId = document.getElementById('skipTaskId').value;
                const selectedReason = document.getElementById('skipReasonSelect').value;
                const customReason = document.getElementById('skipReasonCustom').value;
                const userName = document.getElementById('skipUserName').value.trim();

                const skipReason = selectedReason === 'אחר' ? customReason : selectedReason;

                if (!skipReason) {
                    NotificationManager.show('יש לבחור או להזין סיבה', 'error');
                    return;
                }

                if (skipReason.trim().length < 4) {
                    NotificationManager.show('סיבה לא תקינה', 'error');
                    return;
                }

                if (!userName || userName.trim().length < 2) {
                    NotificationManager.show('יש להזין שם משתמש', 'error');
                    return;
                }

                await this.dailyTasksManager.markTaskAsSkipped(taskId, skipReason, userName);
                this.dailyTasksManager.closeSkipReasonModal();
            });
        }
    }

    // Setup modal events
    setupModalEvents() {
        // Close modals when clicking outside
        window.addEventListener('click', (event) => {
            const modals = [
                { element: document.getElementById('messagePopup'), closeFunc: () => this.messagesManager.closeMessagePopup() },
                { element: document.getElementById('addMessageModal'), closeFunc: () => this.messagesManager.closeAddMessageModal() },
                { element: document.getElementById('addTaskModal'), closeFunc: () => this.dailyTasksManager.closeAddTaskModal() },
                { element: document.getElementById('skipReasonModal'), closeFunc: () => this.dailyTasksManager.closeSkipReasonModal() },
                { element: document.getElementById('simpleDocumentModal'), closeFunc: () => this.proceduresManager.closeSimpleDocumentModal() }
            ];

            modals.forEach(modal => {
                if (modal.element && event.target === modal.element) {
                    modal.closeFunc();
                }
            });
        });

        // Close modals with Escape key
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.messagesManager.closeMessagePopup();
                this.messagesManager.closeAddMessageModal();
                this.dailyTasksManager.closeAddTaskModal();
                this.dailyTasksManager.closeSkipReasonModal();
                this.proceduresManager.closeSimpleDocumentModal();
            }
        });
    }

    // Setup date picker events
    setupDatePickerEvents() {
        const tasksDateHidden = document.getElementById('tasksDateHidden');
        if (tasksDateHidden) {
            tasksDateHidden.addEventListener('change', (e) => {
                this.dailyTasksManager.handleDatePickerChange(e.target.value);
            });
        }

        // Skip reason select change
        const skipReasonSelect = document.getElementById('skipReasonSelect');
        if (skipReasonSelect) {
            skipReasonSelect.addEventListener('change', () => {
                this.dailyTasksManager.handleSkipReasonChange();
            });
        }
    }

    // Search messages
    searchMessages(searchTerm) {
        document.querySelectorAll('.notice-card').forEach(card => {
            const title = card.querySelector('.notice-title')?.textContent.toLowerCase() || '';
            const content = card.querySelector('.notice-content')?.textContent.toLowerCase() || '';

            if (title.includes(searchTerm) || content.includes(searchTerm)) {
                card.style.display = 'block';
            } else {
                card.style.display = searchTerm === '' ? 'block' : 'none';
            }
        });
    }

    // Start auto-refresh
    startAutoRefresh() {
        // Refresh all data every 5 minutes
        this.refreshInterval = setInterval(async () => {
            try {
                await Promise.all([
                    this.shiftsManager.loadShiftsTable(),
                    this.shiftsManager.updateCurrentShiftIndicator(),
                    this.messagesManager.loadMessages(),
                    this.proceduresManager.loadProcedures(),
                    this.dailyTasksManager.loadTasksForDate(this.dailyTasksManager.currentTaskDate)

                ]);
            } catch (error) {
                console.error('Error during auto-refresh:', error);
            }
        }, 5 * 60 * 1000);
    }

    // Schedule refresh - refreshes the entire page at 07:30
    scheduleRefresh() {
        const scheduleNext = () => {
            const now = new Date();
            const tomorrow = new Date(now);

            const nextRefresh = new Date(now);
            nextRefresh.setDate(tomorrow.getDate());

            nextRefresh.setHours(7, 30, 0, 0); // Set to 07:30 AM

            // If time already passed today, schedule for tomorrow
            if (nextRefresh.getTime() <= now.getTime()) {
                nextRefresh.setDate(nextRefresh.getDate() + 1);
            }

            const timeUntilRefresh = nextRefresh.getTime() - now.getTime();
            // Clear existing timeout if any
            if (this.midnightRefreshTimeout) {
                clearTimeout(this.midnightRefreshTimeout);
            }

            // Schedule the page refresh
            this.midnightRefreshTimeout = setTimeout(() => {

                // Show notification before refresh
                NotificationManager.show('מרענן את המערכת ליום חדש...', 'info');

                // Wait a moment for notification to show, then reload
                setTimeout(() => {
                    location.reload();
                }, 1000);

            }, timeUntilRefresh);
        };

        // Start the scheduling
        scheduleNext();
    }

    // Stop auto-refresh
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }

        // Also clear midnight refresh timeout
        if (this.midnightRefreshTimeout) {
            clearTimeout(this.midnightRefreshTimeout);
            this.midnightRefreshTimeout = null;
        }
    }

    // Manual refresh
    async refreshAll() {
        try {
            await Promise.all([
                this.shiftsManager.loadShiftsTable(),
                this.messagesManager.loadMessages(),
                this.proceduresManager.loadProcedures(),
                this.dailyTasksManager.loadTasksForDate(this.dailyTasksManager.currentTaskDate)
            ]);

            this.shiftsManager.updateCurrentShiftIndicator();
            NotificationManager.show('הנתונים עודכנו בהצלחה', 'success');
        } catch (error) {
            console.error('Error refreshing data:', error);
            NotificationManager.show('שגיאה בעדכון הנתונים', 'error');
        }
    }
}