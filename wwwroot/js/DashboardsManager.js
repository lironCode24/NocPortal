class DashboardsManager {
    constructor() {
        this.currentDashboard = null;
        this.availableDashboards = [
            {
                id: 'alerts',
                name: 'NOC Events',
                component: 'AlertsManager',
                allowedUsers: []
            },
            {
                id: 'rack-metrics',
                name: 'Data Center',
                component: 'RackMetricsDashboard',
                allowedUsers: []
            },
            {
                id: 'suite-results',
                name: 'Suites Results',
                component: 'SuiteResultsDashboard',
                allowedUsers: []
            },
            {
                id: 'recent-tests',
                name: 'Tests Results',
                component: 'RecentTestsDashboard',
                allowedUsers: []
            },
            {
                id: 'servers',
                name: 'Servers & Systems',
                component: 'ServersDashboard',
                allowedUsers: []
            },
            {
                id: 'systems-catalog',
                name: 'Systems Catalog',
                component: 'SystemsCatalogDashboard',
                allowedUsers: []
            },
            {
                id: 'changes',
                name: 'Changes & CAB',
                component: 'ChangesDashboard',
                allowedUsers: []
            },
            {
                id: 'activities',
                name: 'Activity Manager',
                component: 'ActivitiesDashboard',
                allowedUsers: []
            },
            {
                id: 'org-tree',
                name: 'IT Structure',
                component: 'OrgTreeDashboard',
                allowedUsers: []
            },
            {
                id: 'employee-tasks',
                name: 'Manage Tasks',
                component: 'EmployeeTasksDashboard',
                allowedUsers: []
            },
            {
                id: 'achievements',
                name: 'Achievements & Goals',
                component: 'AchievementsDashboard',
                allowedUsers: []
            },
            // {
            //     id: 'grafana-dashboard',
            //     name: 'Grafana Dashboard',
            //     component: 'GrafanaDashboard',
            //     allowedUsers: []
            // },
        ];
        this.currentUser = null;

        // *** משתנים לניהול מעבר אוטומטי ***
        this.autoSwitchEnabled = false;
        this.autoSwitchInterval = null;
        this.autoSwitchDashboards = [];
        this.autoSwitchCurrentIndex = 0;
        this.autoSwitchIntervalTime = 180 * 1000;
        this.autoSwitchProgressTimer = null;
        this.autoSwitchProgressElapsed = 0;

        this.dashboardOrder = [];

        // *** ניהול Dark/Light Mode ***
        this.colorTheme = localStorage.getItem('dashboardColorTheme') || 'dark';
    }

    applyColorTheme(theme) {
        this.colorTheme = theme;
        localStorage.setItem('dashboardColorTheme', theme);

        const root = document.documentElement;

        if (theme === 'light') {
            root.setAttribute('data-theme', 'light');
        } else {
            root.setAttribute('data-theme', 'dark');
        }

        // עדכן אייקון הכפתור
        const btn = document.getElementById('colorThemeBtn');
        if (btn) {
            btn.innerHTML = theme === 'light'
                ? '<i class="fas fa-moon" style="font-size:18px"></i>'
                : '<i class="fas fa-sun"  style="font-size:18px"></i>';
            btn.title = theme === 'light'
                ? 'עבור ל-Dark Mode'
                : 'עבור ל-Light Mode';

            btn.classList.toggle('theme-light-active', theme === 'light');
        }
    }

    async initialize() {
        try {
            await this.fetchCurrentUser();
            this.loadDashboardOrder();

            if (!this.currentUser) {
                this.showError('לא ניתן לאמת את המשתמש');
                return;
            }
            // *** הוסף: שחזר מצב auto switch אחרי רענון ***
            const savedAutoSwitch = sessionStorage.getItem('autoSwitch');
            if (savedAutoSwitch) {
                const state = JSON.parse(savedAutoSwitch);

                const allowedIds = this.getAllowedDashboards().map(d => d.id);
                state.dashboards = state.dashboards.filter(id => allowedIds.includes(id));

                this.autoSwitchEnabled = state.enabled;
                this.autoSwitchDashboards = state.dashboards;
                this.autoSwitchIntervalTime = state.intervalTime;
                this.autoSwitchCurrentIndex = state.currentIndex;
            }

            this.loadDashboardFromUrl();

            this.showBackToPortalButtonIfAllowed();

            // הוסף כפתור חזרה לדף הראשי
            this.addBackButton();

            // הוסף כותרת לדשבורד
            this.addDashboardTitle();

            // *** החל theme שמור ***
            this.applyColorTheme(this.colorTheme);

            // *** הוסף: הפעל מחדש טיימר אחרי רענון ***
            if (this.autoSwitchEnabled) {
                this.autoSwitchInterval = setInterval(() => {
                    this.switchToNextDashboard();
                }, this.autoSwitchIntervalTime);
                this.startProgressTimer();

                // עדכן UI של כפתור וסינדיקטור
                const autoSwitchBtn = document.getElementById('autoSwitchBtn');
                if (autoSwitchBtn) autoSwitchBtn.classList.add('active');

                const indicator = document.getElementById('autoSwitchActiveIndicator');
                if (indicator) indicator.classList.add('visible');
            }

        } catch (error) {
            console.error('Error initializing dashboards manager:', error);
            this.showError('שגיאה באתחול מנהל הדשבורדים');
        }
    }

    loadDashboardOrder() {
        if (!this.currentUser) return;

        const key = `dashboardOrder_${this.currentUser.username}`;
        const saved = localStorage.getItem(key);

        if (saved) {
            try {
                const savedOrder = JSON.parse(saved);
                const validIds = this.availableDashboards.map(d => d.id);
                const filteredOrder = savedOrder.filter(id => validIds.includes(id));
                // הוסף דשבורדים חדשים שלא היו בסדר השמור
                const missingIds = validIds.filter(id => !filteredOrder.includes(id));
                this.dashboardOrder = [...filteredOrder, ...missingIds];
            } catch (e) {
                console.warn('Failed to parse dashboard order:', e);
                this.dashboardOrder = this.availableDashboards.map(d => d.id);
            }
        } else {
            this.dashboardOrder = this.availableDashboards.map(d => d.id);
        }

        this._applyDashboardOrder();
    }

    saveDashboardOrder() {
        if (!this.currentUser) return;
        const key = `dashboardOrder_${this.currentUser.username}`;
        localStorage.setItem(key, JSON.stringify(this.dashboardOrder));
    }

    _applyDashboardOrder() {
        const ordered = [];
        this.dashboardOrder.forEach(id => {
            const dashboard = this.availableDashboards.find(d => d.id === id);
            if (dashboard) ordered.push(dashboard);
        });
        // הוסף דשבורדים שלא נמצאו בסדר
        this.availableDashboards.forEach(d => {
            if (!ordered.find(o => o.id === d.id)) ordered.push(d);
        });
        this.availableDashboards = ordered;
    }

    showBackToPortalButtonIfAllowed() {
        if (!this.currentUser) return;

        const { role } = this.currentUser;

        if (role === 'Admin' || role === 'NOC') {
            const btn = document.getElementById('backToPortalBtn');
            if (btn) {
                btn.style.display = 'inline-flex';
            }
        }
    }

    async fetchCurrentUser() {
        try {
            const response = await fetch('/Auth/Me', {
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/login';
                    return null;
                }
                throw new Error(`HTTP error: ${response.status}`);
            }

            const user = await response.json();
            this.currentUser = user;
            sessionStorage.setItem('currentUser', JSON.stringify(user));
            return user;

        } catch (error) {
            console.error('Error fetching current user:', error);
            const cached = sessionStorage.getItem('currentUser');
            if (cached) {
                this.currentUser = JSON.parse(cached);
                return this.currentUser;
            } else {
                this.currentUser = {
                    username: "",
                    role: "",
                    displayName: "",
                    userId: "",
                    allowedDashboards: []
                };
                return this.currentUser;
            }
            return null;
        }
    }

    isUserAllowedForDashboard(dashboard) {
        if (dashboard.id == "systems-catalog") {
            return true;
        }
        if (!this.currentUser) return false;

        const { role, allowedDashboards } = this.currentUser;

        // Admin\NOC רואה הכל
        if (role === 'Admin' || role === 'NOC') return true;

        // Dashboard - לפי רשימת הרשאות מהשרת
        if (role === 'Dashboard') {
            if (!allowedDashboards || allowedDashboards.length === 0) {
                return false; // אין הרשאות - אין גישה
            }
            return allowedDashboards.includes(dashboard.id);
        }

        return false;
    }

    getAllowedDashboards() {
        return this.availableDashboards.filter(d =>
            this.isUserAllowedForDashboard(d)
        );
    }

    loadDashboardFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const dashboardId = urlParams.get('dashboard');

        if (dashboardId) {
            const dashboard = this.availableDashboards.find(d => d.id === dashboardId);

            if (!dashboard) {
                this.showError(`דשבורד לא נמצא: ${dashboardId}`);
                this.showDashboardsList();
                return;
            }

            // בדוק הרשאה לפני loadDashboard
            if (!this.isUserAllowedForDashboard(dashboard)) {
                // אם משתמש Dashboard - הפנה לדשבורד הראשון המותר לו
                const allowedDashboards = this.getAllowedDashboards();
                if (allowedDashboards.length > 0) {
                    window.location.href = `?dashboard=${allowedDashboards[0].id}`;
                    return;
                }
                // אם אין דשבורדים מותרים בכלל - הצג שגיאה
                this.addFullscreenStyles();
                this.showAccessDenied(dashboard);
                return;
            }

            this.currentDashboard = dashboard;
            this.loadDashboard(dashboard);

        } else {

            // Admin/NOC - הצג רשימה רגילה
            this.showDashboardsList();
        }

        this.addFullscreenStyles();
    }

    loadDashboard(dashboard) {
        try {
            // הסתר את רשימת הדשבורדים אם מוצגת
            const dashboardsList = document.getElementById('dashboardsList');
            if (dashboardsList) {
                dashboardsList.style.display = 'none';
            }

            // *** הוסף: נקה תוכן קודם ***
            const existingContent = document.getElementById('dashboardContent');
            if (existingContent) {
                existingContent.innerHTML = '';
            }

            // עדכן את כותרת הדשבורד
            const titleElement = document.getElementById('dashboardTitle');
            if (titleElement) {
                titleElement.textContent = dashboard.name;
            }

            // *** הוסף: עדכן כרטיס פעיל בפופאפ ***
            this.updateAutoSwitchPopupActiveState(dashboard.id);

            // טען את הדשבורד המבוקש
            switch (dashboard.component) {
                case 'AlertsManager':
                    this.loadAlertsManager();
                    break;
                case 'RackMetricsDashboard':
                    this.loadRackMetricsDashboard();
                    break;
                case 'SuiteResultsDashboard':
                    this.loadSuiteResultsDashboard();
                    break;
                case 'RecentTestsDashboard':
                    this.loadRecentTestsDashboard();
                    break;
                case 'EmployeeTasksDashboard':
                    this.loadEmployeeTasksDashboard();
                    break;
                case 'ServersDashboard':
                    this.loadServersDashboard();
                    break;
                case 'SystemsCatalogDashboard':
                    this.loadSystemsCatalogDashboard();
                    break;
                case 'ChangesDashboard':
                    this.loadChangesDashboard();
                    break;
                case 'AchievementsDashboard':
                    this.loadAchievementsDashboard();
                    break;
                case 'ActivitiesDashboard':
                    this.loadActivitiesDashboard();
                    break;
                case 'OrgTreeDashboard':
                    this.loadOrgTreeDashboard();
                    break;
                case 'GrafanaDashboard':
                    this.loadGrafanaDashboard();
                    break;
                default:
                    this.showError(`סוג דשבורד לא נתמך: ${dashboard.component}`);
            }
        } catch (error) {
            console.error(`Error loading dashboard ${dashboard.id}:`, error);
            this.showError(`שגיאה בטעינת דשבורד: ${error.message}`);
        }
    }

    // הוסף את הפונקציות:
    loadOrgTreeDashboard() {
        if (typeof OrgTreeDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/OrgTreeDashboard.js';
            script.onload = () => {
                if (typeof OrgTreeDashboard !== 'undefined') {
                    this.initializeOrgTreeDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof OrgTreeDashboard !== 'undefined') {
                            this.initializeOrgTreeDashboard();
                        } else {
                            this.showError('OrgTreeDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () =>
                this.showError('שגיאה בטעינת OrgTreeDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeOrgTreeDashboard();
        }
    }

    initializeOrgTreeDashboard() {
        if (typeof OrgTreeDashboard === 'undefined') {
            this.showError('OrgTreeDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="orgTreeDashboardRoot"></div>';

        window.orgTreeDashboard = new OrgTreeDashboard(
            'orgTreeDashboardRoot',
            this.currentUser
        );
        window.orgTreeDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    loadRackMetricsDashboard() {
        if (typeof RackMetricsDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/RackMetricsDashboard.js';
            script.onload = () => this.initializeRackMetricsDashboard();
            script.onerror = () => this.showError('שגיאה בטעינת RackMetricsDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeRackMetricsDashboard();
        }
    }

    initializeRackMetricsDashboard() {
        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="rackMetricsDashboardRoot"></div>';
        window.rackMetricsDashboard = new RackMetricsDashboard(
            'rackMetricsDashboardRoot'
        );
        window.rackMetricsDashboard.initialize();

        // *** העבר currentUser ל-DataCenterManager ***
        if (window.dataCenterManager && this.currentUser) {
            window.dataCenterManager.currentUser = this.currentUser;
            window.dataCenterManager.canEdit =
                window.dataCenterManager.checkEditPermission();
        }
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }


    loadSuiteResultsDashboard() {
        if (typeof SuiteResultsDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/SuiteResultsDashboard.js';

            script.onload = () => {
                // *** המתן שה-class יהיה זמין ***
                if (typeof SuiteResultsDashboard !== 'undefined') {
                    this.initializeSuiteResultsDashboard();
                } else {
                    // *** נסה שוב אחרי 100ms ***
                    setTimeout(() => {
                        if (typeof SuiteResultsDashboard !== 'undefined') {
                            this.initializeSuiteResultsDashboard();
                        } else {
                            this.showError('SuiteResultsDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };

            script.onerror = () => {
                this.showError('שגיאה בטעינת SuiteResultsDashboard');
            };

            document.head.appendChild(script);
        } else {
            this.initializeSuiteResultsDashboard();
        }
    }

    initializeSuiteResultsDashboard() {
        // *** הגנה: וודא שה-class קיים ***
        if (typeof SuiteResultsDashboard === 'undefined') {
            this.showError('SuiteResultsDashboard class is not defined');
            console.error('SuiteResultsDashboard is not defined — check script loading');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="suiteResultsDashboardRoot"></div>';

        const user = this.currentUser;
        window.suiteResultsDashboard = new SuiteResultsDashboard(
            'suiteResultsDashboardRoot',
            user
        );
        window.suiteResultsDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    // הוסף את שתי הפונקציות:
    loadEmployeeTasksDashboard() {
        if (typeof EmployeeTasksDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/EmployeeTasksDashboard.js';
            script.onload = () => this.initializeEmployeeTasksDashboard();
            script.onerror = () => this.showError('שגיאה בטעינת EmployeeTasksDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeEmployeeTasksDashboard();
        }
    }

    initializeEmployeeTasksDashboard() {
        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="stickyNotesDashboardRoot"></div>';
        window.stickyNotesDashboard = new EmployeeTasksDashboard(
            'stickyNotesDashboardRoot'
        );
        window.stickyNotesDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    loadRecentTestsDashboard() {
        if (typeof RecentTestsDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/RecentTestsDashboard.js';
            script.onload = () => {
                if (typeof RecentTestsDashboard !== 'undefined') {
                    this.initializeRecentTestsDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof RecentTestsDashboard !== 'undefined') {
                            this.initializeRecentTestsDashboard();
                        } else {
                            this.showError('RecentTestsDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () => {
                this.showError('שגיאה בטעינת RecentTestsDashboard');
            };
            document.head.appendChild(script);
        } else {
            this.initializeRecentTestsDashboard();
        }
    }

    initializeRecentTestsDashboard() {
        if (typeof RecentTestsDashboard === 'undefined') {
            this.showError('RecentTestsDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="recentTestsDashboardRoot"></div>';

        const user = this.currentUser;
        window.recentTestsDashboard = new RecentTestsDashboard(
            'recentTestsDashboardRoot',
            user
        );
        window.recentTestsDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    loadAlertsManager() {
        // בדוק אם ה-AlertsManager כבר נטען
        if (typeof AlertsManager === 'undefined') {
            // טען את הסקריפט של AlertsManager
            const script = document.createElement('script');
            script.src = '/js/AlertsManager.js';
            script.onload = () => {
                // אחרי טעינת הסקריפט, אתחל את AlertsManager
                this.initializeAlertsManager();
            };
            script.onerror = (error) => {
                console.error('Error loading AlertsManager script:', error);
                this.showError('שגיאה בטעינת סקריפט AlertsManager');
            };
            document.head.appendChild(script);
        } else {
            // אם הסקריפט כבר נטען, אתחל את AlertsManager
            this.initializeAlertsManager();
        }
    }

    initializeAlertsManager() {
        try {
            let alertsContainer = document.getElementById('dashboardContent');
            if (!alertsContainer) {
                alertsContainer = document.createElement('div');
                alertsContainer.id = 'dashboardContent';
                alertsContainer.className = 'dashboard-content';
                document.body.appendChild(alertsContainer);
            }

            alertsContainer.innerHTML = '';

            alertsContainer.innerHTML = `
    <div class="alerts-container fullscreen-mode">
        <div class="alerts-controls">
             <div class="alerts-search">
                <input type="text" id="alertSearchInput" placeholder="חיפוש התראות...">
                <i class="fas fa-search"></i>
                <button id="clearAlertSearch" class="clear-search-btn" style="display: none;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="alerts-filters">
                <div class="alerts-filter-group">
                    <label>Severity:</label>
                    <div class="filter-buttons-group">
                        <button class="severity-filter-btn active" data-value="CRITICAL">
                            <i class="fas fa-bolt"></i> Critical
                        </button>
                        <button class="severity-filter-btn active" data-value="MAJOR">
                            <i class="far fa-exclamation"></i> Major
                        </button>
                        <button class="severity-filter-btn active" data-value="UNKNOWN">
                            <i class="far fa-question-circle"></i> Unknown
                        </button>
                    </div>
                </div>
                <div class="alerts-filter-group">
                    <label>Status:</label>
                    <div class="filter-buttons-group">
                        <button class="status-filter-btn active" data-value="OPEN">
                            <i class="fas fa-asterisk"></i> Open
                        </button>
                        <button class="status-filter-btn active" data-value="ACK">
                            <i class="far fa-check-circle"></i> Acknowledge
                        </button>
                        <button class="status-filter-btn active" data-value="ASSIGN">
                            <i class="far fa-user-circle"></i> Assigned
                        </button>
                        <button class="status-filter-btn" data-value="CLOSED">
                            <i class="fas fa-times-circle"></i> Closed
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <div class="alerts-table-container">
            <table class="alerts-table">
                <thead>
                    <tr>
                        <th title="Status"><i class="fas fa-info-circle"></i></th>
                        <th title="Severity"><i class="fas fa-triangle-exclamation"></i></th>
                        <th title="Priority"><i class="fas fa-flag"></i></th>
                        <th>Date & Time</th>
                        <th>Host</th>
                        <th>Message</th>
                        <th>IP Address</th>
                        <th>Responsible Team</th>
                        <th>Notes</th>
                        <th>Last Update</th>
                    </tr>
                </thead>
                <tbody id="alertsTableBody">
                    <tr>
                        <td colspan="11" class="loading-message">טוען התראות...</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
`;

            window.alertsManager = new AlertsManager();
            window.alertsManager.isFullscreenMode = true;

            window.alertsManager.colorMode =
                window.alertsManager.loadFromLocalStorage('dashboardColorMode') || 'background';

            // הגדר columnOrder ו-visibleColumns לפני initialize
            window.alertsManager.columnOrder = [
                'status', 'severity', 'priority', 'timestamp', 'host',
                'message', 'hostAddress', 'contacts', 'notes', 'modified'
            ].reverse();

            window.alertsManager.visibleColumns = {
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
                actions: false,
                checkbox: false
            };

            // *** initialize רץ קודם ***
            window.alertsManager.initialize();

            // *** וודא ש-NotificationManager זמין גלובלית ***
            if (typeof NotificationManager === 'undefined') {
                window.NotificationManager = {
                    show: (message, type = 'info') => {
                        console.warn(`[NotificationManager fallback] ${type}: ${message}`);
                        // Fallback פשוט - toast קטן
                        const toast = document.createElement('div');
                        toast.style.cssText = `
                position: fixed; bottom: 20px; left: 50%;
                transform: translateX(-50%);
                background: ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
                color: white; padding: 10px 20px;
                border-radius: 8px; font-size: 0.9rem;
                z-index: 99999; font-weight: 600;
                box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                animation: sfpSlideIn 0.2s ease;
                direction: rtl;
            `;
                        toast.textContent = message;
                        document.body.appendChild(toast);
                        setTimeout(() => toast.remove(), 3500);
                    }
                };
            }

            // הוסף כפתור סינונים שמורים
            setTimeout(async () => {

                // *** שלב 1: צור את alertsInlineButtons קודם ***
                if (this._pendingAlertsButtons) {
                    this._injectAlertsControlButtons();
                    this._pendingAlertsButtons = false;
                }

                // *** שלב 2: אחרי שה-wrapper קיים, הכנס savedFilters לתוכו ***
                if (window.alertsManager.savedFiltersManager) {
                    const alertsInlineButtons = document.getElementById('alertsInlineButtons');
                    if (alertsInlineButtons) {
                        window.alertsManager.savedFiltersManager
                            .renderSavedFiltersButton(alertsInlineButtons);
                    }

                    setTimeout(() => {
                        if (window.alertsManager.savedFiltersManager) {
                            window.alertsManager.savedFiltersManager
                                .restoreActiveFilterIndicator();
                        }
                    }, 100);
                }
            }, 500);

            // *** שחזר מיון אחרון מ-localStorage - רק אחרי initialize ***
            const savedSortColumn = localStorage.getItem('dashboardSortColumn');
            const savedSortDirection = localStorage.getItem('dashboardSortDirection');
            if (savedSortColumn) {
                window.alertsManager.sortColumn = savedSortColumn;
                window.alertsManager.sortDirection = savedSortDirection || 'asc';
                // רנדר מחדש עם המיון השמור
                if (typeof window.alertsManager.renderAlerts === 'function') {
                    window.alertsManager.renderAlerts();
                } else if (typeof window.alertsManager.refreshAlerts === 'function') {
                    window.alertsManager.refreshAlerts();
                } else if (typeof window.alertsManager.render === 'function') {
                    window.alertsManager.render();
                }
            }

            // *** שחזר מצב הסתרת פילטרים - תמיד הצג קודם, אז הסתר אם צריך ***
            setTimeout(() => {
                const filtersHidden = localStorage.getItem('dashboardFiltersHidden') === 'true';
                if (filtersHidden) {
                    const controls = document.querySelector('.alerts-controls');
                    controls.style.display = 'none';

                    const filterGroups = document.querySelectorAll('.alerts-filter-group');
                    filterGroups.forEach(group => {
                        group.style.display = 'none';
                    });

                    const searchContainer = document.querySelector('.alerts-search');
                    if (searchContainer) {
                        searchContainer.style.display = 'none';
                    }
                }
            }, 50);

            // *** האזן לשינויי מיון ושמור אותם ***
            const alertsTable = document.querySelector('.alerts-table thead');
            if (alertsTable) {
                alertsTable.addEventListener('click', (e) => {
                    const th = e.target.closest('th');
                    if (th) {
                        // 300ms כדי לוודא ש-AlertsManager סיים לעדכן את המשתנים
                        setTimeout(() => this.saveSortState(), 300);
                    }
                });
            }
            setTimeout(() => this.reinitScrollToTopButton(), 600);

        } catch (error) {
            console.error('Error initializing AlertsManager:', error);
            this.showError(`שגיאה באתחול AlertsManager: ${error.message}`);
        }
    }

    _injectAlertsControlButtons() {
        const alertsContainer = document.querySelector('.alerts-container');
        if (!alertsContainer) return;

        if (document.getElementById('dashboardColorModeBtn')) return;

        // *** wrapper חיצוני - שורה אחת עם justify-content: space-between ***
        const topBar = document.createElement('div');
        topBar.id = 'alertsInlineControlsBar';
        topBar.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 10px;
        gap: 8px;
        flex-wrap: nowrap;
        min-height: 36px;
    `;

        // *** Slot ל-alertsLastUpdated - צד ימין (RTL) ***
        const lastUpdatedPlaceholder = document.createElement('div');
        lastUpdatedPlaceholder.id = 'alertsLastUpdatedSlot';
        lastUpdatedPlaceholder.style.cssText = `
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
        overflow: hidden;
    `;

        // *** wrapper לכפתורים - צד שמאל ***
        const btnWrapper = document.createElement('div');
        btnWrapper.id = 'alertsInlineButtons';
        btnWrapper.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    `;

        // *** Color Mode Toggle Button ***
        const colorModeBtn = document.createElement('button');
        colorModeBtn.id = 'dashboardColorModeBtn';
        colorModeBtn.className = 'toggle-filters-btn';

        const savedDashboardColorMode = localStorage.getItem('dashboardColorMode');
        const initialDashboardMode = savedDashboardColorMode
            ? JSON.parse(savedDashboardColorMode)
            : 'background';

        colorModeBtn.innerHTML = initialDashboardMode === 'background'
            ? '<i class="fas fa-fill-drip"></i>'
            : '<i class="fas fa-font"></i>';
        colorModeBtn.title = initialDashboardMode === 'background'
            ? 'עבור לצבע טקסט'
            : 'עבור לצבע רקע';

        colorModeBtn.addEventListener('click', () => {
            if (window.alertsManager) {
                window.alertsManager.toggleColorMode();
                const currentMode = window.alertsManager.colorMode;
                colorModeBtn.innerHTML = currentMode === 'background'
                    ? '<i class="fas fa-fill-drip"></i>'
                    : '<i class="fas fa-font"></i>';
                colorModeBtn.title = currentMode === 'background'
                    ? 'עבור לצבע טקסט'
                    : 'עבור לצבע רקע';
            }
        });

        // *** Toggle Filters Button ***
        const toggleFiltersBtn = document.createElement('button');
        toggleFiltersBtn.id = 'toggleFiltersBtn1';
        toggleFiltersBtn.className = 'toggle-filters-btn';
        toggleFiltersBtn.innerHTML = this.toggleButtonLook();

        toggleFiltersBtn.addEventListener('click', () => {
            const filterGroups = document.querySelectorAll('.alerts-filter-group');
            const searchContainer = document.querySelector('.alerts-search');

            if (filterGroups.length > 0) {
                const isVisible = filterGroups[0].style.display !== 'none';

                const controls = document.querySelector('.alerts-controls');
                if (controls) controls.style.display = isVisible ? 'none' : '';

                filterGroups.forEach(group => {
                    group.style.display = isVisible ? 'none' : '';
                });

                if (searchContainer) {
                    searchContainer.style.display = isVisible ? 'none' : '';
                }

                toggleFiltersBtn.innerHTML = this.toggleButtonLook();
                localStorage.setItem('dashboardFiltersHidden', isVisible ? 'true' : 'false');
            }
        });

        // *** הרכב: כפתורים קודם, אחר כך savedFilters יתווסף מבחוץ ***
        btnWrapper.appendChild(colorModeBtn);
        btnWrapper.appendChild(toggleFiltersBtn);

        // *** הרכב topBar: lastUpdated משמאל, כפתורים מימין ***
        // בגלל RTL: lastUpdatedSlot בצד ימין, btnWrapper בצד שמאל
        topBar.appendChild(lastUpdatedPlaceholder);  // ימין (flex: 1)
        topBar.appendChild(btnWrapper);               // שמאל (flex-shrink: 0)

        // *** הכנס בתחילת alerts-container ***
        alertsContainer.insertBefore(topBar, alertsContainer.firstChild);
    }

    loadServersDashboard() {
        if (typeof ServersDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/ServersDashboard.js';
            script.onload = () => this.initializeServersDashboard();
            script.onerror = () =>
                this.showError('שגיאה בטעינת ServersDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeServersDashboard();
        }
    }

    initializeServersDashboard() {
        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML =
            '<div id="serversDashboardRoot"></div>';

        window.serversDashboard = new ServersDashboard(
            'serversDashboardRoot'
        );
        window.serversDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    loadSystemsCatalogDashboard() {
        if (typeof SystemsCatalogDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/SystemsCatalogDashboard.js';
            script.onload = () => {
                if (typeof SystemsCatalogDashboard !== 'undefined') {
                    this.initializeSystemsCatalogDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof SystemsCatalogDashboard !== 'undefined') {
                            this.initializeSystemsCatalogDashboard();
                        } else {
                            this.showError('SystemsCatalogDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () =>
                this.showError('שגיאה בטעינת SystemsCatalogDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeSystemsCatalogDashboard();
        }
    }

    initializeSystemsCatalogDashboard() {
        if (typeof SystemsCatalogDashboard === 'undefined') {
            this.showError('SystemsCatalogDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML =
            '<div id="systemsCatalogDashboardRoot"></div>';

        window.systemsCatalogDashboard = new SystemsCatalogDashboard(
            'systemsCatalogDashboardRoot'
        );
        window.systemsCatalogDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    loadChangesDashboard() {
        if (typeof ChangesDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/ChangesDashboard.js';
            script.onload = () => {
                if (typeof ChangesDashboard !== 'undefined') {
                    this.initializeChangesDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof ChangesDashboard !== 'undefined') {
                            this.initializeChangesDashboard();
                        } else {
                            this.showError('ChangesDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () =>
                this.showError('שגיאה בטעינת ChangesDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeChangesDashboard();
        }
    }

    initializeChangesDashboard() {
        if (typeof ChangesDashboard === 'undefined') {
            this.showError('ChangesDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML =
            '<div id="changesDashboardRoot"></div>';

        const user = this.currentUser;
        window.changesDashboard = new ChangesDashboard(
            'changesDashboardRoot',
            user
        );
        window.changesDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    saveSortState() {
        if (window.alertsManager) {
            if (window.alertsManager.sortColumn) {
                localStorage.setItem('dashboardSortColumn', window.alertsManager.sortColumn);
                localStorage.setItem('dashboardSortDirection', window.alertsManager.sortDirection || 'asc');
            } else {
                localStorage.removeItem('dashboardSortColumn');
                localStorage.removeItem('dashboardSortDirection');
            }
        }
    }

    addFullscreenStyles() {
        // הוסף סגנונות מיוחדים למצב מסך מלא עם דארק מוד
        const style = document.createElement('style');
        style.textContent = `
         body {
                margin: 0;
                padding: 0;
                overflow: hidden;
            }

            .dashboard-header {
                background-color: #320F5B;
                color: white;
                padding: 10px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                height: 42px;
            }

            .dashboard-content {
                background: #121212;
                height: calc(100vh - 40px);
                overflow: auto;
            }

        /* מיכל ההתראות */
        .alerts-container.fullscreen-mode {
            height: 100%;
            max-height: none;
            padding: 0;
            background-color: #121212;
        }
        
        /* מיכל הטבלה */
        .alerts-table-container {
                max-height: calc(100vh - 200px);
                height: calc(100vh - 200px);
        }
        
        /* טבלת התראות */
        .alerts-table {
            background-color: #ffff;
            color: #e0e0e0;
            border-collapse: collapse;
        }
        
        /* כותרות הטבלה */
        .alerts-table thead th {
            background-color: #2c2c2c;
            color: #ffffff;
            border-bottom: 2px solid #333;
            padding: 10px;
        }
        
        /* תאי הטבלה */
        .alerts-table td {
            border-bottom: 1px solid #333;
            padding: 8px;
        }
        
        .alerts-table tr.status-closed{
            background-color: #f5f5f5;
        }

        .alerts-table tr.status-closed:hover {
            background-color: #dec1c1;
        }

        /* שורות הטבלה - hover */
        .alerts-table tbody tr:hover {
            background-color: #dec1c1;
        }
        
        /* כפתורי סינון */
        .filter-buttons-group button {
            background-color: #2c2c2c;
            color: #999;
            border: 1px solid #444;
        }
        
        .filter-buttons-group button.active {
            background-color: #320F5B;
            color: black;
            border-color: #4a1a8c;
        }
        
        /* אזור הסינונים */
        .alerts-filters {
            background-color: #1e1e1e;
            border: 1px solid #333;
            border-radius: 5px;
        }

        .alerts-controls{
            background: none;
        }

        .alerts-search{
            border:0;
        }

        .alerts-filter-group {
            border-bottom: 1px solid #333;
            background-color: #3f403f;
        }
        
        .alerts-filter-group label {
            color: #bbb;
        }
        
        /* כפתור ניקוי סינונים */
        .clear-filters-btn {
            background-color: #2c2c2c;
            color: #e0e0e0;
            border: 1px solid #444;
        }
        
        .clear-filters-btn:hover {
            background-color: #3c3c3c;
        }
        
        /* כפתור חזרה */
        .back-to-main-btn {
            padding: 8px 15px;
            background-color: rgba(255,255,255,0.1);
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: background-color 0.3s;
        }
        
        .back-to-main-btn:hover {
            background-color: rgba(255,255,255,0.2);
        }
        
        /* מונה התראות */
        .total-alerts-counter {
            background-color: #1e1e1e !important;
            color: #e0e0e0 !important;
            border-top: 1px solid #333 !important;
            height: 47px;
        }
        
        /* הודעת טעינה */
        .loading-message {
            color: #999;
        }
        
        /* הודעת אין התראות */
        .empty-alerts-message {
            color: #999;
        }
        
        /* פופאפ הערות */
        .notes-popup {
            background-color: #2c2c2c !important;
            color: #e0e0e0 !important;
            border: 1px solid #444 !important;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
        }
        
        .note-popup-item {
            background-color: #1e1e1e !important;
            border-bottom: 1px solid #333 !important;
        }

        .note-popup-text{
            color: white
        }

        .note-popup-user {
            color: #bbb !important;
        }
        
        .note-popup-datetime {
            color: #999 !important;
        }

        /* אזור כפתורים בצד שמאל */
        .dashboard-left-controls {
            display: flex;
            gap: 10px;
        }

        /* אזור כפתורים בצד ימין */
        .dashboard-right-controls {
            display: flex;
            gap: 10px;
        }

        /* כפתור הצגת/הסתרת פילטרים */
        .toggle-filters-btn {
            padding: 8px 15px;
            background-color: rgba(255,255,255,0.1);
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: background-color 0.3s;
        }

        .toggle-filters-btn:hover {
            background-color: rgba(255,255,255,0.2);
        }

        /* Auto Switch Button */
        .auto-switch-btn {
            padding: 8px 15px;
            background-color: rgba(255,255,255,0.1);
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: background-color 0.3s;
        }
        .auto-switch-btn:hover { background-color: rgba(255,255,255,0.2); }
        .auto-switch-btn.active {
            background-color: rgba(50,200,100,0.4);
            border: 1px solid rgba(50,200,100,0.7);
        }

        /* Active Indicator */
        .auto-switch-active-indicator {
            display: none;
            align-items: center;
            gap: 6px;
            font-size: 0.8rem;
            color: #86efac;
            background-color: rgba(50,200,100,0.15);
            border: 1px solid rgba(50,200,100,0.3);
            border-radius: 12px;
            padding: 3px 10px;
        }
        .auto-switch-active-indicator.visible { display: flex; }
        .auto-switch-active-dot {
            width: 7px; height: 7px;
            background-color: #4ade80;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
            0%,100% { opacity:1; transform:scale(1); }
            50% { opacity:0.5; transform:scale(0.8); }
        }

        /* Popup Overlay */
        .auto-switch-overlay {
            position: fixed; top:0; left:0;
            width:100%; height:100%;
            background-color: rgba(0,0,0,0.6);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
            animation: fadeIn 0.2s ease;
        }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideIn { from{transform:translateY(-20px);opacity:0} to{transform:translateY(0);opacity:1} }

        /* Popup Box */
        .auto-switch-popup {
            background-color: #1e1e1e;
            border: 1px solid #444;
            border-radius: 12px;
            padding: 24px;
            min-width: 50%;
            max-width: 90%;
            max-height: 90%;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            color: #e0e0e0;
            animation: slideIn 0.2s ease;
        }
        .auto-switch-popup-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 12px;
            border-bottom: 1px solid #333;
        }
        .auto-switch-popup-title {
            font-size: 1.2rem; font-weight: bold; color: #fff;
            display: flex; align-items: center; gap: 8px;
        }
        .auto-switch-popup-title i { color: #a78bfa; }
        .auto-switch-close-btn {
            background:none; border:none; color:#999;
            font-size:22px; cursor:pointer; padding:0 4px;
            line-height:1; transition:color 0.2s;
        }
        .auto-switch-close-btn:hover { color:#fff; }
        .auto-switch-section-label {
            font-size:0.85rem; color:#aaa;
            margin-bottom:10px;
            text-transform:uppercase; letter-spacing:0.5px;
        }

        /* Dashboard Cards Grid */
        .auto-switch-dashboards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
            gap: 10px;
            margin-bottom: 20px;
        }
        .auto-switch-dashboard-card {
            background-color: #2c2c2c;
            border: 2px solid #444;
            border-radius: 8px;
            padding: 14px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: all 0.2s;
            user-select: none;
        }
        .auto-switch-dashboard-card:hover { background-color:#3a3a3a; border-color:#666; }
        .auto-switch-dashboard-card.selected {
            background-color: rgba(50,15,91,0.5);
            border-color: #7c3aed;
        }
        .auto-switch-card-checkbox {
            width:18px; height:18px;
            border: 2px solid #666; border-radius:4px;
            display:flex; align-items:center; justify-content:center;
            flex-shrink:0; transition:all 0.2s;
        }
        .auto-switch-dashboard-card.selected .auto-switch-card-checkbox {
            background-color:#7c3aed; border-color:#7c3aed;
        }
        .auto-switch-card-checkbox i { color:white; font-size:10px; display:none; }
        .auto-switch-dashboard-card.selected .auto-switch-card-checkbox i { display:block; }
        .auto-switch-card-icon { font-size:1.3rem; color:#a78bfa; }
        .auto-switch-card-name { font-size:0.9rem; font-weight:500; color:#e0e0e0; }

        /* Interval Input */
        .auto-switch-interval-section { margin-bottom:20px; }
        .auto-switch-interval-row {
            display:flex; align-items:center; gap:10px;
            background-color:#2c2c2c;
            border:1px solid #444; border-radius:8px;
            padding:10px 14px;
        }
        .auto-switch-interval-row i { color:#a78bfa; }
        .auto-switch-interval-input {
            width:60px; background-color:#1e1e1e;
            border:1px solid #555; border-radius:4px;
            color:#e0e0e0; padding:4px 8px;
            font-size:0.95rem; text-align:center;
        }
        .auto-switch-interval-input:focus { outline:none; border-color:#7c3aed; }
        .auto-switch-interval-label { color:#bbb; font-size:0.9rem; }

        /* Progress Bar */
        .auto-switch-progress-section { margin-bottom:20px; display:none; }
        .auto-switch-progress-section.visible { display:block; }
        .auto-switch-progress-info {
            display:flex; justify-content:space-between;
            margin-bottom:6px; font-size:0.85rem; color:#aaa;
        }
        .auto-switch-progress-bar-container {
            height:6px; background-color:#333; border-radius:3px; overflow:hidden;
        }
        .auto-switch-progress-bar {
            height:100%;
            background: linear-gradient(90deg, #7c3aed, #a78bfa);
            border-radius:3px;
            transition: width 1s linear;
            width:0%;
        }

        /* Action Buttons */
        .auto-switch-actions { display:flex; gap:10px; }
        .auto-switch-start-btn {
            flex:1; padding:10px;
            background-color:#7c3aed; color:white;
            border:none; border-radius:6px;
            cursor:pointer; font-weight:bold; font-size:0.95rem;
            display:flex; align-items:center; justify-content:center; gap:6px;
            transition:background-color 0.2s;
        }
        .auto-switch-start-btn:hover { background-color:#6d28d9; }
        .auto-switch-start-btn:disabled { background-color:#444; color:#777; cursor:not-allowed; }
        .auto-switch-stop-btn {
            flex:1; padding:10px;
            background-color:rgba(239,68,68,0.2); color:#f87171;
            border:1px solid rgba(239,68,68,0.4); border-radius:6px;
            cursor:pointer; font-weight:bold; font-size:0.95rem;
            display:flex; align-items:center; justify-content:center; gap:6px;
            transition:all 0.2s;
        }
        .auto-switch-stop-btn:hover { background-color:rgba(239,68,68,0.35); }
        .auto-switch-stop-btn:disabled { opacity:0.4; cursor:not-allowed; }

        /* Error Message */
        .auto-switch-error {
            background-color:rgba(239,68,68,0.15);
            border:1px solid rgba(239,68,68,0.4);
            color:#f87171; border-radius:6px;
            padding:8px 12px; font-size:0.85rem;
            margin-bottom:12px; display:none;
        }
        .auto-switch-error.visible { display:block; }
        .auto-switch-section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        /* בטל margin-bottom מה-label כי עכשיו ה-header מטפל בזה */
        .auto-switch-section-header .auto-switch-section-label {
            margin-bottom: 0;
        }

        .auto-switch-select-all-btn {
            background-color: transparent;
            border: 1px solid #555;
            color: #a78bfa;
            border-radius: 5px;
            padding: 3px 10px;
            font-size: 0.8rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
        }

        .auto-switch-select-all-btn:hover {
            background-color: rgba(124, 58, 237, 0.2);
            border-color: #7c3aed;
        }

        /* ===== Dark / Light Mode Theme ===== */

        /* כפתור theme פעיל (light mode) */
        .auto-switch-btn.theme-light-active {
            background-color: rgba(255, 200, 50, 0.25);
            border: 1px solid rgba(255, 200, 50, 0.6);
            color: #fde68a;
        }
        .auto-switch-btn.theme-light-active:hover {
            background-color: rgba(255, 200, 50, 0.4);
        }

        /* ===== LIGHT MODE — כל הדשבורד ===== */
        [data-theme="light"] body {
            background: #f0f2f5;
            color: #1a1a2e;
        }

        [data-theme="light"] .dashboard-header {
            background-color: #4a1a8c;
        }

        [data-theme="light"] .dashboard-content {
            background: #f0f2f5;
        }

        /* ===== LIGHT MODE — Alerts Dashboard ===== */
        [data-theme="light"] .alerts-container.fullscreen-mode {
            background-color: #f0f2f5;
        }

        [data-theme="light"] .alerts-table-container {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
        }

        [data-theme="light"] .alerts-table {
            background-color: #fff;
            color: #1a1a2e;
        }

        [data-theme="light"] .alerts-table thead th {
            background-color: #e8e8f0;
            color: #1a1a2e;
            border-bottom: 2px solid #ccc;
        }

        [data-theme="light"] .alerts-table td {
            border-bottom: 1px solid #e8e8e8;
            color: #1a1a2e;
        }

        [data-theme="light"] .alerts-table tbody tr:hover {
            background-color: #f0e8ff;
        }

        [data-theme="light"] .alerts-table tr.status-closed {
            background-color: #f5f5f5;
        }

        [data-theme="light"] .alerts-table tr.status-closed:hover {
            background-color: #e8d8d8;
        }

        [data-theme="light"] .alerts-controls {
            background: #fff;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .alerts-filters {
            background-color: #f5f5f5;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .alerts-filter-group {
            background-color: #ebebeb;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .alerts-filter-group label {
            color: #444;
        }

        [data-theme="light"] .filter-buttons-group button {
            background-color: #fff;
            color: #555;
            border: 1px solid #ccc;
        }

        [data-theme="light"] .filter-buttons-group button.active {
            background-color: #4a1a8c;
            border-color: #6a2aac;
        }

        [data-theme="light"] .total-alerts-counter {
            background-color: #f5f5f5 !important;
            color: #1a1a2e !important;
            border-top: 1px solid #ddd !important;
        }

        /* ===== LIGHT MODE — Recent Tests Dashboard ===== */
        [data-theme="light"] .rt-root {
            background: #f0f2f5;
            color: #1a1a2e;
        }

        [data-theme="light"] .rt-header {
            background: linear-gradient(135deg, #e8e8f8 0%, #dde0f0 100%);
            border-bottom: 1px solid #c8c8e0;
        }

        [data-theme="light"] .rt-search-input {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .rt-search-input::placeholder { color: #aaa; }

        [data-theme="light"] .rt-filter-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .rt-filter-btn:hover {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .rt-filter-btn.active {
            background: #ede9fe;
            border-color: #7c3aed;
            color: #5b21b6;
        }

        [data-theme="light"] .rt-filter-btn.passed.active {
            background: #dcfce7;
            border-color: #22c55e;
            color: #15803d;
        }

        [data-theme="light"] .rt-filter-btn.failed.active {
            background: #fee2e2;
            border-color: #ef4444;
            color: #b91c1c;
        }

        [data-theme="light"] .rt-filter-btn.warning.active {
            background: #fef9c3;
            border-color: #f59e0b;
            color: #b45309;
        }

        [data-theme="light"] .rt-stats-bar {
            background: linear-gradient(135deg, #e8e8f8 0%, #dde0f0 100%);
            border-bottom: 1px solid #c8c8e0;
        }

        [data-theme="light"] .rt-stat-box {
            background: #fff;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .rt-stat-num { color: #1a1a2e; }

        [data-theme="light"] .rt-stat-label { color: #888; }

        [data-theme="light"] .rt-table-wrap {
            background: #fff;
        }

        [data-theme="light"] .rt-table thead tr {
            background: #e8e8f0;
        }

        [data-theme="light"] .rt-table th {
            background: #e8e8f0;
            color: #4a5568;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .rt-table td {
            border-bottom: 1px solid #eee;
            color: #2d3748;
        }

        [data-theme="light"] .rt-row:hover td {
            background: rgba(124,58,237,0.04);
        }

        [data-theme="light"] .rt-test-name { color: #2d3748; }

        [data-theme="light"] .rt-td-duration,
        [data-theme="light"] .rt-td-lastrun { color: #888; }

        [data-theme="light"] .rt-ms-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #444;
        }

        [data-theme="light"] .rt-ms-dropdown {
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 8px 30px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .rt-ms-option { color: #333; }
        [data-theme="light"] .rt-ms-option:hover { background: rgba(124,58,237,0.06); }
        [data-theme="light"] .rt-ms-opt-label { color: #333; }

        [data-theme="light"] .rt-ms-search {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #333;
        }

        [data-theme="light"] .rt-filter-banner {
            background: linear-gradient(
                135deg,
                rgba(234,179,8,0.12),
                rgba(234,179,8,0.06)
            );
            border-bottom: 1px solid rgba(234,179,8,0.3);
        }

        [data-theme="light"] .rt-refresh-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .rt-refresh-btn:hover {
            background: #f0f0f8;
            color: #5b21b6;
            border-color: #7c3aed;
        }

        [data-theme="light"] .rt-manage-mappings-btn {
            background: #e8f0fe;
            border: 1px solid #93c5fd;
            color: #1d4ed8;
        }

        [data-theme="light"] .rt-export-btn {
            background: #dbeafe;
            border: 1px solid #93c5fd;
            color: #1d4ed8;
        }

        /* ===== LIGHT MODE — Popup ===== */
        [data-theme="light"] .rt-mapping-popup,
        [data-theme="light"] .rt-quick-map-popup,
        [data-theme="light"] .rt-run-test-popup,
        [data-theme="light"] .rt-contacts-popup {
            background: #fff;
            border: 1px solid #c8c8e0;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }

        [data-theme="light"] .rt-popup-header {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .rt-map-input {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .rt-map-input::placeholder { color: #aaa; }

        [data-theme="light"] .rt-contact-row {
            background: #f5f5f5;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .rt-contact-row:hover { background: #ebebf5; }

        [data-theme="light"] .rt-contact-name { color: #1a1a2e; }

        /* ===== LIGHT MODE — Auto Switch Popup ===== */
        [data-theme="light"] .auto-switch-popup {
            background: #fff;
            border: 1px solid #c8c8e0;
            color: #1a1a2e;
        }

        [data-theme="light"] .auto-switch-popup-title { color: #1a1a2e; }

        [data-theme="light"] .auto-switch-dashboard-card {
            background: #f5f5f5;
            border: 2px solid #ddd;
        }

        [data-theme="light"] .auto-switch-dashboard-card:hover {
            background: #ebebf5;
            border-color: #aaa;
        }

        [data-theme="light"] .auto-switch-dashboard-card.selected {
            background: rgba(124,58,237,0.08);
            border-color: #7c3aed;
        }

        [data-theme="light"] .auto-switch-interval-row {
            background: #f5f5f5;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .auto-switch-interval-input {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .auto-switch-section-label { color: #666; }

        [data-theme="light"] .auto-switch-progress-bar-container {
            background: #ddd;
        }

        /* ===== LIGHT MODE — Dashboards List ===== */
        [data-theme="light"] .dashboards-list {
            background: #f0f2f5;
        }

        [data-theme="light"] .dashboard-card {
            background-color: #5b21b6;
            border: 1px solid #7c3aed;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .dashboard-card:hover {
            background-color: #4c1d95;
            border-color: #a78bfa;
            box-shadow: 0 10px 30px rgba(124,58,237,0.3);
        }
    `;
        document.head.appendChild(style);
    }

    _applyOptimalGrid(gridElement, count) {
        // חישוב מספר עמודות ושורות אופטימלי
        let cols, rows;

        if (count <= 2) {
            cols = count; rows = 1;
        } else if (count <= 4) {
            cols = 2; rows = Math.ceil(count / 2);
        } else if (count <= 6) {
            cols = 3; rows = Math.ceil(count / 3);
        } else if (count <= 8) {
            cols = 4; rows = Math.ceil(count / 4);
        } else if (count <= 9) {
            cols = 3; rows = 3;
        } else if (count <= 12) {
            cols = 4; rows = Math.ceil(count / 4);
        } else {
            cols = 5; rows = Math.ceil(count / 5);
        }

        gridElement.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        gridElement.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        gridElement.style.height = '100%';
        gridElement.style.gap = '0';
    }

    showDashboardsList() {
        // יצירת מיכל לרשימת הדשבורדים
        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }

        // נקה את המיכל
        container.innerHTML = '';

        // יצירת רשימת דשבורדים
        const listContainer = document.createElement('div');
        listContainer.id = 'dashboardsList';
        listContainer.className = 'dashboards-list';

        // רשימת דשבורדים
        const list = document.createElement('div');
        list.className = 'dashboards-grid';

        const allowedDashboards = this.getAllowedDashboards();

        if (allowedDashboards.length === 0) {
            list.innerHTML = `
            <div style="grid-column:1/-1; text-align:center; color:#aaa; padding:40px;">
                <i class="fas fa-lock" style="font-size:2rem; color:#f87171; display:block; margin-bottom:10px;"></i>
                <p>אין דשבורדים זמינים עבור המשתמש שלך</p>
            </div>
        `;
            listContainer.appendChild(list);
            container.appendChild(listContainer);
            this.addDashboardsListStyles(0);
            return;
        }

        // *** חישוב מספר עמודות לפי כמות דשבורדים ***
        const count = allowedDashboards.length;
        let cols;

        if (count <= 5) {
            cols = count; // 1-5: הכל בשורה אחת
        } else {
            // מעל 5 - מצא חלוקה זוגית אופטימלית (מקסימום 5 בשורה)
            cols = 5;
            // נסה למצוא חלוקה שנותנת שורות שלמות
            for (let c = 5; c >= 2; c--) {
                if (count % c === 0) {
                    cols = c;
                    break;
                }
            }
            // אם לא נמצאה חלוקה זוגית מושלמת - השתמש ב-5 או פחות
            if (count % cols !== 0) {
                cols = Math.min(5, count);
            }
        }

        const rows = Math.ceil(count / cols);

        // *** הזרק CSS דינמי לגריד ***
        list.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        list.style.gridTemplateRows = `repeat(${rows}, 1fr)`;

        allowedDashboards.forEach(dashboard => {
            const dashboardCard = document.createElement('div');
            dashboardCard.className = 'dashboard-card';
            dashboardCard.draggable = true;
            dashboardCard.dataset.dashboardId = dashboard.id;
            dashboardCard.innerHTML = `
                <div class="dashboard-card-drag-handle" title="גרור לסידור מחדש">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                <div class="dashboard-card-icon">
                    <i class="fas ${this.getDashboardIcon(dashboard.id)}"></i>
                </div>
                <div class="dashboard-card-title">${dashboard.name}</div>
            `;

            dashboardCard.addEventListener('click', (e) => {
                // אל תנווט אם לחצו על ידית הגרירה
                if (e.target.closest('.dashboard-card-drag-handle')) return;
                window.location.href = `?dashboard=${dashboard.id}`;
            });

            list.appendChild(dashboardCard);
        });

        // הפעל גרירה אחרי בניית הרשימה
        this._initDragAndDrop(list);

        listContainer.appendChild(list);
        container.appendChild(listContainer);
        // הוסף סגנונות לרשימת הדשבורדים
        this.addDashboardsListStyles(allowedDashboards.length);
    }

    _isOrderChanged() {
        if (!this.currentUser) return false;

        const key = `dashboardOrder_${this.currentUser.username}`;
        const saved = localStorage.getItem(key);

        // אם אין שמירה בכלל - הסדר הוא ברירת מחדל
        if (!saved) return false;

        const defaultOrder = [
            'alerts', 'rack-metrics', 'suite-results',
            'recent-tests', 'employee-tasks', 'servers',
            'systems-catalog', 'changes'
        ];

        try {
            const savedOrder = JSON.parse(saved);
            // השווה רק דשבורדים שקיימים בשני הרשימות
            const relevantDefault = defaultOrder.filter(id =>
                savedOrder.includes(id)
            );
            const relevantSaved = savedOrder.filter(id =>
                defaultOrder.includes(id)
            );

            return JSON.stringify(relevantDefault) !== JSON.stringify(relevantSaved);
        } catch (e) {
            return false;
        }
    }

    resetDashboardOrder() {
        if (!this.currentUser) return;

        const key = `dashboardOrder_${this.currentUser.username}`;
        localStorage.removeItem(key);

        this.dashboardOrder = [
            'alerts', 'rack-metrics', 'suite-results',
            'recent-tests', 'employee-tasks', 'servers',
            'systems-catalog', 'changes'
        ];

        this._applyDashboardOrder();

        // סדר מחדש את הכרטיסים ב-DOM
        const grid = document.querySelector('.dashboards-grid');
        if (grid) {
            const allowedDashboards = this.getAllowedDashboards();
            grid.querySelectorAll('.dashboard-card').forEach(card => card.remove());

            allowedDashboards.forEach(dashboard => {
                const dashboardCard = document.createElement('div');
                dashboardCard.className = 'dashboard-card';
                dashboardCard.draggable = true;
                dashboardCard.dataset.dashboardId = dashboard.id;
                dashboardCard.innerHTML = `
                <div class="dashboard-card-drag-handle" title="גרור לסידור מחדש">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                <div class="dashboard-card-icon">
                    <i class="fas ${this.getDashboardIcon(dashboard.id)}"></i>
                </div>
                <div class="dashboard-card-title">${dashboard.name}</div>
            `;
                dashboardCard.addEventListener('click', (e) => {
                    if (e.target.closest('.dashboard-card-drag-handle')) return;
                    window.location.href = `?dashboard=${dashboard.id}`;
                });
                grid.appendChild(dashboardCard);
            });

            this._initDragAndDrop(grid);
            // *** עדכן גריד דינמי אחרי איפוס ***
            const newCount = this.getAllowedDashboards().length;
            let newCols;

            if (newCount <= 5) {
                newCols = newCount;
            } else {
                newCols = 5;
                for (let c = 5; c >= 2; c--) {
                    if (newCount % c === 0) {
                        newCols = c;
                        break;
                    }
                }
                if (newCount % newCols !== 0) {
                    newCols = Math.min(5, newCount);
                }
            }

            const newRows = Math.ceil(newCount / newCols);
            grid.style.gridTemplateColumns = `repeat(${newCols}, 1fr)`;
            grid.style.gridTemplateRows = `repeat(${newRows}, 1fr)`;
        }

        // *** הסתר את הכפתור אחרי איפוס ***
        const resetBtn = document.getElementById('resetOrderBtn');
        if (resetBtn) resetBtn.style.display = 'none';

        this._showResetToast();
    }

    _showResetToast() {
        const existing = document.getElementById('orderResetToast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'orderResetToast';
        toast.innerHTML = '<i class="fas fa-undo"></i> הסידור אופס לברירת המחדל';
        toast.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #374151, #6b7280);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 0.9rem;
        z-index: 99999;
        font-weight: 600;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 8px;
        direction: rtl;
        animation: toastFadeIn 0.3s ease;
    `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    _initDragAndDrop(container) {
        let draggedEl = null;
        let draggedOverEl = null;

        const onDragStart = (e) => {
            draggedEl = e.currentTarget;
            draggedEl.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            // נדרש לפיירפוקס
            e.dataTransfer.setData('text/plain', draggedEl.dataset.dashboardId);
        };

        const onDragEnd = () => {
            if (draggedEl) draggedEl.classList.remove('dragging');
            document.querySelectorAll('.dashboard-card').forEach(card => {
                card.classList.remove('drag-over');
            });
            draggedEl = null;
            draggedOverEl = null;
        };

        const onDragOver = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const card = e.currentTarget;
            if (card === draggedEl) return;

            if (draggedOverEl && draggedOverEl !== card) {
                draggedOverEl.classList.remove('drag-over');
            }
            draggedOverEl = card;
            card.classList.add('drag-over');
        };

        const onDragLeave = (e) => {
            e.currentTarget.classList.remove('drag-over');
        };

        const onDrop = (e) => {
            e.preventDefault();
            const targetCard = e.currentTarget;
            if (!draggedEl || draggedEl === targetCard) return;

            targetCard.classList.remove('drag-over');

            // קבע מיקום הכנסה (לפני או אחרי)
            const rect = targetCard.getBoundingClientRect();
            const midX = rect.left + rect.width / 2;
            const insertBefore = e.clientX < midX;

            if (insertBefore) {
                container.insertBefore(draggedEl, targetCard);
            } else {
                container.insertBefore(draggedEl, targetCard.nextSibling);
            }

            // שמור סדר חדש
            this._saveDraggedOrder(container);
        };

        // צרף אירועים לכל הכרטיסים
        container.querySelectorAll('.dashboard-card').forEach(card => {
            card.addEventListener('dragstart', onDragStart);
            card.addEventListener('dragend', onDragEnd);
            card.addEventListener('dragover', onDragOver);
            card.addEventListener('dragleave', onDragLeave);
            card.addEventListener('drop', onDrop);
        });
    }

    _saveDraggedOrder(container) {
        const newOrder = [];
        container.querySelectorAll('.dashboard-card').forEach(card => {
            newOrder.push(card.dataset.dashboardId);
        });

        this.dashboardOrder = [
            ...newOrder,
            ...this.availableDashboards
                .filter(d => !newOrder.includes(d.id))
                .map(d => d.id)
        ];

        this.saveDashboardOrder();
        this._applyDashboardOrder();

        // *** הצג כפתור איפוס אחרי גרירה ***
        const resetBtn = document.getElementById('resetOrderBtn');
        if (resetBtn) resetBtn.style.display = 'flex';

        this._showOrderSavedToast();
    }

    _showOrderSavedToast() {
        // הסר toast קיים
        const existing = document.getElementById('orderSavedToast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'orderSavedToast';
        toast.innerHTML = '<i class="fas fa-check-circle"></i> סדר הדשבורדים נשמר';
        toast.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #7c3aed, #a78bfa);
        color: white;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 0.9rem;
        z-index: 99999;
        font-weight: 600;
        box-shadow: 0 4px 20px rgba(124,58,237,0.4);
        display: flex;
        align-items: center;
        gap: 8px;
        direction: rtl;
        animation: toastFadeIn 0.3s ease;
    `;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }

    getDashboardIcon(dashboardId) {
        switch (dashboardId) {
            case 'alerts':
                return 'fas fa-list-ul';
            case 'rack-metrics':
                return 'fas fa-server fa-rotate-90';
            case 'suite-results':
                return 'fa-chart-bar';
            case 'employee-tasks':
                return 'fa-sticky-note';
            case 'recent-tests':
                return 'fa-history';
            case 'servers':
                return 'fa-server';
            case 'systems-catalog':
                return 'fa-layer-group';
            case 'changes':
                return 'fa-calendar-check';
            case 'achievements':
                return 'fa-trophy';
            case 'activities':
                return 'fa-tasks';
            case 'org-tree':
                return 'fa-sitemap';
            case 'grafana-dashboard':
                return 'fa-external-link-alt';
            default:
                return 'fa-chart-bar';
        }
    }

    addDashboardsListStyles(count = 5) {
        const style = document.createElement('style');
        style.textContent = `
            /* ── מיכל חיצוני ── */
            .dashboards-list {
                width: 100%;
                height: calc(100vh - 62px);
                padding: 16px;
                box-sizing: border-box;
                direction: ltr;
                overflow: hidden;
            }

            /* ── גריד ── */
            .dashboards-grid {
                display: grid;
                gap: 16px;
                width: 100%;
                height: 100%;
                box-sizing: border-box;
            }

            /* ── כרטיס ── */
            .dashboard-card {
                background-color: #320F5B;
                border: 1px solid #3c0066;
                border-radius: 16px;
                padding: 20px;
                text-align: center;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                position: relative;
                min-height: 0;
                overflow: hidden;
            }

            .dashboard-card:hover {
                background-color: #241b35;
                border-color: #9d50ff;
                box-shadow: 0 10px 30px rgba(60, 0, 102, 0.6);
                transform: scale(1.02);
            }

            /* ── אייקון - גודל מותאם לכמות ── */
            .dashboard-card-icon {
                font-size: clamp(1.8rem, 3.5vw, 4rem);
                color: #fff;
                margin-bottom: clamp(8px, 1.5vh, 20px);
                filter: drop-shadow(0 0 5px rgba(138, 43, 226, 0.3));
                transition: all 0.3s ease;
            }

            .dashboard-card:hover .dashboard-card-icon {
                color: #9d50ff;
                filter: drop-shadow(0 0 15px rgba(157, 80, 255, 0.6));
            }

            /* ── כותרת - גודל מותאם לכמות ── */
            .dashboard-card-title {
                font-size: clamp(0.7rem, 1.2vw, 1.2rem);
                font-weight: 600;
                color: #efefff;
                letter-spacing: 0.8px;
            }

            /* ── ידית גרירה ── */
            .dashboard-card-drag-handle {
                position: absolute;
                top: 8px;
                right: 10px;
                color: rgba(255,255,255,0.3);
                font-size: 0.9rem;
                cursor: grab;
                transition: color 0.2s;
                padding: 4px;
            }

            .dashboard-card:hover .dashboard-card-drag-handle {
                color: rgba(255,255,255,0.7);
            }

            .dashboard-card-drag-handle:active {
                cursor: grabbing;
            }

            /* ── מצבי גרירה ── */
            .dashboard-card.dragging {
                opacity: 0.4;
                transform: scale(0.97);
                border-color: #7c3aed;
            }

            .dashboard-card.drag-over {
                border-color: #a78bfa;
                background-color: rgba(124,58,237,0.25);
                transform: scale(1.03);
                box-shadow: 0 8px 24px rgba(124,58,237,0.4);
            }

            /* ── Toast ── */
            @keyframes toastFadeIn {
                from { opacity: 0; transform: translateX(-50%) translateY(10px); }
                to   { opacity: 1; transform: translateX(-50%) translateY(0); }
            }

            /* ── כפתור איפוס ── */
            .reset-order-btn {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 7px 14px;
                background-color: rgba(239,68,68,0.25);
                color: #f87171;
                border: 1px solid rgba(239,68,68,0.4);
                border-radius: 6px;
                cursor: pointer;
                font-size: 0.85rem;
                font-weight: 500;
                transition: all 0.2s ease;
                direction: rtl;
            }

            .reset-order-btn:hover {
                background-color: rgba(239,68,68,0.55);
                color: #f87171;
                border-color: rgba(239,68,68,0.4);
            }
        `;
        document.head.appendChild(style);
    }

    addBackButton() {
        // Create dashboard header if it doesn't exist
        let header = document.getElementById('dashboardHeader');
        if (!header) {
            header = document.createElement('div');
            header.id = 'dashboardHeader';
            header.className = 'dashboard-header';

            // Back button
            const backButton = document.createElement('button');
            backButton.className = 'back-to-main-btn';
            backButton.innerHTML = '<i class="fas fa-home" style="font-size: 20px;"></i><i class="fas fa-reply" style="font-size: 16px; transform: scaleX(-1);"></i>';
            backButton.title = 'חזרה לדשבורדים';
            backButton.addEventListener('click', () => {
                // Clear sessionStorage to stop auto switch
                sessionStorage.removeItem('autoSwitch');
                window.location.href = '/dashboards'; // Return to main page
            });

            // Title
            const title = document.createElement('h1');
            title.id = 'dashboardTitle';
            title.textContent = this.currentDashboard ? this.currentDashboard.name : 'Dashboards';

            // Left controls area
            this._leftControlsEl = document.createElement('div');
            this._leftControlsEl.className = 'dashboard-left-controls';
            const leftControls = this._leftControlsEl;

            // Right controls area
            const rightControls = document.createElement('div');
            rightControls.className = 'dashboard-right-controls';

            // *** כפתור איפוס סידור - מוצג רק בדף הראשי (ללא dashboard בURL) ***
            // *** ורק אם הסדר שונה מברירת המחדל ***
            const urlParams = new URLSearchParams(window.location.search);
            const isMainPage = !urlParams.get('dashboard');

            if (isMainPage && this._isOrderChanged()) {
                const resetOrderBtn = document.createElement('button');
                resetOrderBtn.id = 'resetOrderBtn';
                resetOrderBtn.className = 'reset-order-btn';
                resetOrderBtn.innerHTML = '<i class="fas fa-undo"></i> אפס סידור דשבורדים';
                resetOrderBtn.title = 'החזר לסידור ברירת המחדל';
                resetOrderBtn.addEventListener('click', () => this.resetDashboardOrder());
                leftControls.appendChild(resetOrderBtn);
            }

            // Show/Hide filters button (only for alerts dashboard)
            if (this.currentDashboard && this.currentDashboard.id === 'alerts') {
                this._pendingAlertsButtons = true; // *** דגל להכנסה מאוחרת ***
            }

            if (this.currentDashboard) {
                rightControls.appendChild(backButton);
            }

            // Active indicator
            const activeIndicator = document.createElement('div');
            activeIndicator.id = 'autoSwitchActiveIndicator';
            activeIndicator.className = 'auto-switch-active-indicator';
            activeIndicator.innerHTML = '<div class="auto-switch-active-dot"></div><span id="autoSwitchCountdown"></span>';
            rightControls.appendChild(activeIndicator);

            // Dark/Light Mode Toggle Button
            const colorThemeBtn = document.createElement('button');
            colorThemeBtn.id = 'colorThemeBtn';
            colorThemeBtn.className = 'auto-switch-btn';
            colorThemeBtn.innerHTML = this.colorTheme === 'light'
                ? '<i class="fas fa-moon" style="font-size:18px"></i>'
                : '<i class="fas fa-sun"  style="font-size:18px"></i>';
            colorThemeBtn.title = this.colorTheme === 'light'
                ? 'עבור ל-Dark Mode'
                : 'עבור ל-Light Mode';
            colorThemeBtn.classList.toggle(
                'theme-light-active', this.colorTheme === 'light');
            colorThemeBtn.addEventListener('click', () => {
                const newTheme = this.colorTheme === 'dark' ? 'light' : 'dark';
                this.applyColorTheme(newTheme);
            });
            rightControls.appendChild(colorThemeBtn);

            // Auto Switch button
            const autoSwitchBtn = document.createElement('button');
            autoSwitchBtn.id = 'autoSwitchBtn';
            autoSwitchBtn.className = 'auto-switch-btn';
            autoSwitchBtn.innerHTML = `
                <span style="display: flex; align-items: center; gap: 3px;">
                    <i class="fas fa-desktop" style="font-size: 20px;"></i>
                    <i class="fas fa-exchange-alt" style="font-size: 11px;"></i>
                    <i class="fas fa-desktop" style="font-size: 20px;"></i>
                </span>
            `;
            autoSwitchBtn.title = 'מעבר אוטומטי בין דשבורדים';
            autoSwitchBtn.addEventListener('click', () => this.openAutoSwitchPopup());
            rightControls.appendChild(autoSwitchBtn);

            // *** כפתור "דשבורד הבא" ***
            const nextDashboardBtn = document.createElement('button');
            nextDashboardBtn.id = 'nextDashboardBtn';
            nextDashboardBtn.className = 'auto-switch-btn';
            nextDashboardBtn.innerHTML = `
            <span style="display: flex; align-items: center; gap: 3px;">
                <i class="fas fa-forward" style="font-size: 16px;"></i>
                <i class="fas fa-desktop" style="font-size: 20px;"></i>
            </span>
`;
            nextDashboardBtn.title = 'עבור לדשבורד הבא';
            nextDashboardBtn.addEventListener('click', () => this.goToNextDashboard());
            rightControls.appendChild(nextDashboardBtn);

            // *** כפתור "דשבורד קודם" ***
            const prevDashboardBtn = document.createElement('button');
            prevDashboardBtn.id = 'prevDashboardBtn';
            prevDashboardBtn.className = 'auto-switch-btn';
            prevDashboardBtn.innerHTML = `
    <span style="display: flex; align-items: center; gap: 3px;">
        <i class="fas fa-desktop" style="font-size: 20px;"></i>
        <i class="fas fa-backward" style="font-size: 16px;"></i>
    </span>
`;
            prevDashboardBtn.title = 'עבור לדשבורד הקודם';
            prevDashboardBtn.addEventListener('click', () => this.goToPrevDashboard());
            rightControls.appendChild(prevDashboardBtn);


            header.appendChild(rightControls);
            header.appendChild(title);

            const userMenuTemplate = document.getElementById('userMenuTemplate');
            if (userMenuTemplate) {
                const userMenu = userMenuTemplate.firstElementChild;
                if (userMenu) {
                    userMenu.style.display = 'flex';
                    leftControls.appendChild(userMenu); // *** הועבר לתוך leftControls ***
                }
            }
            header.appendChild(leftControls);

            // Add header to the beginning of body
            document.body.insertBefore(header, document.body.firstChild);
        }
    }

    toggleButtonLook() {
        const filterGroups = document.querySelectorAll('.alerts-filter-group');

        if (filterGroups.length > 0) {
            const isVisible = filterGroups[0].style.display !== 'none';

            if (isVisible)
                return '<i class="fas fa-angle-up"></i>';
            else
                return '<i class="fas fa-angle-down"></i>';
        }
        return '<i class="fas fa-angle-down"></i>';
    }

    addDashboardTitle() {
        const titleElement = document.getElementById('dashboardTitle');
        if (titleElement && this.currentDashboard) {
            titleElement.textContent = this.currentDashboard.name;
        }
        this.addScrollToTopButton();
    }

    addScrollToTopButton() {
        const btn = document.createElement('button');
        btn.id = 'scrollToTopBtn';
        btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        btn.title = 'חזרה לראש הדף';
        btn.setAttribute('aria-label', 'חזרה לראש הדף');

        btn.style.cssText = `
        position: fixed;
        bottom: 30px;
        left: 30px;
        width: 46px;
        height: 46px;
        border-radius: 50%;
        background: linear-gradient(135deg, #7c3aed, #a78bfa);
        color: white;
        border: none;
        cursor: pointer;
        font-size: 1.1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(124,58,237,0.45);
        z-index: 9999;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
        transform: translateY(10px);
    `;

        document.body.appendChild(btn);

        // *** נקה listeners קודמים ***
        this._scrollListeners = this._scrollListeners || [];
        this._scrollListeners.forEach(({ target, fn }) => {
            target.removeEventListener('scroll', fn);
        });
        this._scrollListeners = [];

        const showBtn = () => {
            btn.style.opacity = '1';
            btn.style.pointerEvents = 'auto';
            btn.style.transform = 'translateY(0)';
        };

        const hideBtn = () => {
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
            btn.style.transform = 'translateY(10px)';
        };

        const checkScroll = (scrollTop) => {
            const halfScreen = window.innerHeight / 2;
            if (scrollTop > halfScreen) {
                showBtn();
            } else {
                hideBtn();
            }
        };

        const addListenerTo = (target) => {
            // מנע כפילויות
            const alreadyAdded = this._scrollListeners.some(
                ({ target: t }) => t === target
            );
            if (alreadyAdded) return;

            const onScroll = () => {
                const scrollTop = target === window
                    ? (window.scrollY || document.documentElement.scrollTop)
                    : target.scrollTop;
                checkScroll(scrollTop);
            };

            target.addEventListener('scroll', onScroll, { passive: true });
            this._scrollListeners.push({ target, fn: onScroll });
        };

        // *** האזן תמיד ל-window ***
        addListenerTo(window);

        // *** האזן לכל הקונטיינרים הספציפיים שקיימים עכשיו ***
        const specificSelectors = [
            '.alerts-table-container',
            '.sn-board',
            '.rmd-wrapper',
            '.sd-columns-wrap',
            '.sd-list-table-wrap',
            '#dashboardContent',
            '.dashboard-content',
            '.srv-scroll-wrapper',
        ];

        specificSelectors.forEach(selector => {
            const el = document.querySelector(selector);
            if (el) addListenerTo(el);
        });

        // *** MutationObserver - מוסיף listeners לאלמנטים שייטענו בעתיד ***
        this._setupScrollObserver(addListenerTo);

        // לחיצה - גלול לראש בכל הקונטיינרים
        btn.addEventListener('click', () => {
            // גלול את כל הקונטיינרים לראש
            specificSelectors.forEach(selector => {
                const el = document.querySelector(selector);
                if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
            document.documentElement.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // hover effect
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'translateY(-3px) scale(1.08)';
            btn.style.boxShadow = '0 8px 24px rgba(124,58,237,0.55)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translateY(0) scale(1)';
            btn.style.boxShadow = '0 4px 16px rgba(124,58,237,0.45)';
        });
    }

    // *** MutationObserver - מאזין לשינויים ב-DOM ומוסיף listeners חדשים ***
    _setupScrollObserver(addListenerTo) {
        // נקה observer קודם
        if (this._scrollObserver) {
            this._scrollObserver.disconnect();
            this._scrollObserver = null;
        }

        const selectors = [
            '.alerts-table-container',
            '.sn-board',
            '.rmd-wrapper',
            '.sd-columns-wrap',
            '.sd-list-table-wrap',
            '#dashboardContent',
            '.dashboard-content',
        ];

        this._scrollObserver = new MutationObserver(() => {
            selectors.forEach(selector => {
                const el = document.querySelector(selector);
                if (el) addListenerTo(el);
            });
        });

        this._scrollObserver.observe(document.body, {
            childList: true,
            subtree: false, // *** subtree: false - מהיר יותר ***
        });

        // עצור אחרי 15 שניות
        setTimeout(() => {
            if (this._scrollObserver) {
                this._scrollObserver.disconnect();
                this._scrollObserver = null;
            }
        }, 15000);
    }

    // פונקציית עזר - מחזירה את מיכל הגלילה הרלוונטי לכל דשבורד
    getScrollContainer() {
        const candidates = [
            document.querySelector('.alerts-table-container'),
            document.querySelector('.sn-board'),
            document.querySelector('.rmd-wrapper'),
            document.querySelector('.sd-columns-wrap'),
            document.querySelector('.sd-list-table-wrap'),
            document.getElementById('dashboardContent'),
            document.querySelector('.dashboard-content'),
            document.querySelector('.srv-scroll-wrapper'),
        ];

        for (const el of candidates) {
            if (!el) continue;

            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            const overflow = style.overflow;

            if (
                overflowY === 'auto' ||
                overflowY === 'scroll' ||
                overflow === 'auto' ||
                overflow === 'scroll'
            ) {
                if (el.scrollHeight > el.clientHeight) {
                    return el;
                }
            }
        }

        // *** Fallback: בדוק אם document.documentElement או body גולל ***
        if (document.documentElement.scrollHeight > window.innerHeight) {
            return window;
        }

        return window;
    }

    reinitScrollToTopButton() {
        // הסר כפתור קיים
        const existing = document.getElementById('scrollToTopBtn');
        if (existing) existing.remove();

        // נקה listeners קודמים
        if (this._scrollListeners) {
            this._scrollListeners.forEach(({ target, fn }) => {
                target.removeEventListener('scroll', fn);
            });
            this._scrollListeners = [];
        }

        // נקה observer קודם
        if (this._scrollObserver) {
            this._scrollObserver.disconnect();
            this._scrollObserver = null;
        }

        // *** נסה מספר פעמים עד שהדשבורד נטען ***
        const attempts = [300, 800, 1500, 3000];
        attempts.forEach(delay => {
            setTimeout(() => {
                const existing = document.getElementById('scrollToTopBtn');
                if (!existing) {
                    this.addScrollToTopButton();
                }
            }, delay);
        });
    }

    showAccessDenied(dashboard) {
        this.addFullscreenStyles();

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }

        const userRole = this.currentUser?.role || 'unknown';
        const userName = this.currentUser?.username || 'משתמש';

        container.innerHTML = `
        <div style="
            display:flex; flex-direction:column;
            align-items:center; justify-content:center;
            height:100%; color:#e0e0e0;
            text-align:center; gap:20px;
        ">
            <i class="fas fa-lock" style="
                font-size:4rem; color:#f87171;
                filter:drop-shadow(0 0 10px rgba(248,113,113,0.4));
            "></i>
            <h2 style="color:#f87171; margin:0;">אין הרשאה</h2>
            <p style="color:#aaa; max-width:400px; line-height:1.6;">
                שלום <strong style="color:#e0e0e0">${userName}</strong>,
                אין לך הרשאה לצפות בדשבורד
                <strong style="color:#a78bfa">${dashboard.name}</strong>.
            </p>
            <button onclick="window.location.href='/dashboards'" style="
                padding:10px 24px; background-color:#7c3aed;
                color:white; border:none; border-radius:8px;
                cursor:pointer; font-size:1rem; font-weight:bold;
            ">
                <i class="fas fa-arrow-right"></i> חזרה לדשבורדים
            </button>
        </div>
    `;
    }

    openAutoSwitchPopup() {
        if (document.getElementById('autoSwitchOverlay')) return;

        const allowedDashboards = this.getAllowedDashboards();
        const overlay = document.createElement('div');
        overlay.id = 'autoSwitchOverlay';
        overlay.className = 'auto-switch-overlay';

        const intervalSeconds = this.autoSwitchIntervalTime / 1000;

        overlay.innerHTML = `
        <div class="auto-switch-popup">
            <div class="auto-switch-popup-header">
                <div class="auto-switch-popup-title">
                    <i class="fas fa-sync-alt"></i>
                    מעבר אוטומטי בין דשבורדים
                </div>
                <button class="auto-switch-close-btn" id="autoSwitchCloseBtn">&times;</button>
            </div>

            <div class="auto-switch-error" id="autoSwitchError"></div>

            <div class="auto-switch-section-header">
                <div class="auto-switch-section-label">בחר דשבורדים למעבר:</div>
                <button class="auto-switch-select-all-btn" id="autoSwitchSelectAllBtn">
                    <i class="fas fa-check-double"></i> בחר הכל
                </button>
            </div>
            <div class="auto-switch-dashboards-grid" id="autoSwitchDashboardsGrid">
                    ${allowedDashboards.map(d => `
                    <div class="auto-switch-dashboard-card ${this.autoSwitchDashboards.includes(d.id) ? 'selected' : ''}" 
                         data-dashboard-id="${d.id}">
                        <div class="auto-switch-card-checkbox">
                            <i class="fas fa-check"></i>
                        </div>
                        <i class="fas ${this.getDashboardIcon(d.id)} auto-switch-card-icon"></i>
                        <div class="auto-switch-card-name">${d.name}</div>
                    </div>
                `).join('')}
            </div>

            <div class="auto-switch-interval-section">
                <div class="auto-switch-section-label">מרווח זמן בין מעברים:</div>
                <div class="auto-switch-interval-row">
                    <i class="fas fa-clock"></i>
                    <input type="number" id="autoSwitchIntervalInput" 
                           class="auto-switch-interval-input" 
                           value="${intervalSeconds}" min="5" max="3600">
                    <span class="auto-switch-interval-label">שניות</span>
                </div>
            </div>

            <div class="auto-switch-progress-section ${this.autoSwitchEnabled ? 'visible' : ''}" id="autoSwitchProgressSection">
                <div class="auto-switch-section-label">התקדמות:</div>
                <div class="auto-switch-progress-info">
                    <span id="autoSwitchProgressLabel">ממתין...</span>
                    <span id="autoSwitchProgressTime"></span>
                </div>
                <div class="auto-switch-progress-bar-container">
                    <div class="auto-switch-progress-bar" id="autoSwitchProgressBar"></div>
                </div>
            </div>

            <div class="auto-switch-actions">
                <button class="auto-switch-start-btn" id="autoSwitchStartBtn"
                    ${this.autoSwitchEnabled ? 'disabled' : ''}>
                    <i class="fas fa-play"></i> התחל
                </button>
                <button class="auto-switch-stop-btn" id="autoSwitchStopBtn"
                    ${!this.autoSwitchEnabled ? 'disabled' : ''}>
                    <i class="fas fa-stop"></i> עצור
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(overlay);

        // אירועים
        document.getElementById('autoSwitchCloseBtn')
            .addEventListener('click', () => this.closeAutoSwitchPopup());

        document.getElementById('autoSwitchStartBtn')
            .addEventListener('click', () => this.startAutoSwitch());

        document.getElementById('autoSwitchStopBtn')
            .addEventListener('click', () => this.stopAutoSwitch());

        // בחר הכל
        document.getElementById('autoSwitchSelectAllBtn')
            .addEventListener('click', () => {
                const allSelected = this.autoSwitchDashboards.length === this.availableDashboards.length;

                if (allSelected) {
                    // בטל בחירת הכל
                    this.autoSwitchDashboards = [];
                    document.querySelectorAll('.auto-switch-dashboard-card').forEach(card => {
                        card.classList.remove('selected');
                    });
                    document.getElementById('autoSwitchSelectAllBtn').innerHTML =
                        '<i class="fas fa-check-double"></i> בחר הכל';
                } else {
                    // בחר הכל
                    this.autoSwitchDashboards = this.availableDashboards.map(d => d.id);
                    document.querySelectorAll('.auto-switch-dashboard-card').forEach(card => {
                        card.classList.add('selected');
                    });
                    document.getElementById('autoSwitchSelectAllBtn').innerHTML =
                        '<i class="fas fa-times"></i> בטל הכל';
                }
            });

        // בחירת כרטיסי דשבורד
        document.querySelectorAll('.auto-switch-dashboard-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.getAttribute('data-dashboard-id');
                card.classList.toggle('selected');
                if (card.classList.contains('selected')) {
                    if (!this.autoSwitchDashboards.includes(id)) {
                        this.autoSwitchDashboards.push(id);
                    }
                } else {
                    this.autoSwitchDashboards = this.autoSwitchDashboards.filter(d => d !== id);
                }

                // *** הוסף: עדכן כפתור בחר הכל ***
                const selectAllBtn = document.getElementById('autoSwitchSelectAllBtn');
                if (selectAllBtn) {
                    const allSelected = this.autoSwitchDashboards.length === this.availableDashboards.length;
                    selectAllBtn.innerHTML = allSelected
                        ? '<i class="fas fa-times"></i> בטל הכל'
                        : '<i class="fas fa-check-double"></i> בחר הכל';
                }
            });
        });

        // עדכון מחוון התקדמות אם פעיל
        if (this.autoSwitchEnabled) {
            this.updateProgressBar();
        }
    }

    closeAutoSwitchPopup() {
        const overlay = document.getElementById('autoSwitchOverlay');
        if (overlay) {
            document.body.removeChild(overlay);
        }
    }

    startAutoSwitch() {
        // ולידציה
        const errorEl = document.getElementById('autoSwitchError');

        if (this.autoSwitchDashboards.length < 2) {
            errorEl.textContent = 'יש לבחור לפחות 2 דשבורדים';
            errorEl.classList.add('visible');
            return;
        }

        errorEl.classList.remove('visible');

        // קרא את הזמן מהשדה
        const intervalInput = document.getElementById('autoSwitchIntervalInput');
        const seconds = parseInt(intervalInput.value);
        if (isNaN(seconds) || seconds < 5) {
            errorEl.textContent = 'מרווח זמן מינימלי הוא 5 שניות';
            errorEl.classList.add('visible');
            return;
        }

        this.autoSwitchIntervalTime = seconds * 1000;
        this.autoSwitchEnabled = true;
        this.autoSwitchCurrentIndex = 0;
        this.autoSwitchProgressElapsed = 0;

        // עדכן UI בפופאפ
        document.getElementById('autoSwitchStartBtn').disabled = true;
        document.getElementById('autoSwitchStopBtn').disabled = false;
        document.getElementById('autoSwitchProgressSection').classList.add('visible');

        // עדכן כפתור בהדר
        const autoSwitchBtn = document.getElementById('autoSwitchBtn');
        if (autoSwitchBtn) autoSwitchBtn.classList.add('active');

        // הצג אינדיקטור
        const indicator = document.getElementById('autoSwitchActiveIndicator');
        if (indicator) indicator.classList.add('visible');

        sessionStorage.setItem('autoSwitch', JSON.stringify({
            enabled: true,
            dashboards: this.autoSwitchDashboards,
            intervalTime: this.autoSwitchIntervalTime,
            currentIndex: 0
        }));

        // עבור לדשבורד הראשון ברשימה
        window.location.href = `?dashboard=${this.autoSwitchDashboards[0]}`;

        // התחל טיימר
        this.autoSwitchInterval = setInterval(() => {
            this.switchToNextDashboard();
        }, this.autoSwitchIntervalTime);

        // התחל מחוון התקדמות
        this.startProgressTimer();
    }

    stopAutoSwitch() {
        sessionStorage.removeItem('autoSwitch');
        this.autoSwitchEnabled = false;

        if (this.autoSwitchInterval) {
            clearInterval(this.autoSwitchInterval);
            this.autoSwitchInterval = null;
        }

        if (this.autoSwitchProgressTimer) {
            clearInterval(this.autoSwitchProgressTimer);
            this.autoSwitchProgressTimer = null;
        }

        this.autoSwitchProgressElapsed = 0;

        // עדכן UI בפופאפ אם פתוח
        const startBtn = document.getElementById('autoSwitchStartBtn');
        const stopBtn = document.getElementById('autoSwitchStopBtn');
        const progressSection = document.getElementById('autoSwitchProgressSection');

        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (progressSection) progressSection.classList.remove('visible');

        // עדכן כפתור בהדר
        const autoSwitchBtn = document.getElementById('autoSwitchBtn');
        if (autoSwitchBtn) autoSwitchBtn.classList.remove('active');

        // הסתר אינדיקטור
        const indicator = document.getElementById('autoSwitchActiveIndicator');
        if (indicator) indicator.classList.remove('visible');
    }

    switchToNextDashboard() {
        this.autoSwitchCurrentIndex =
            (this.autoSwitchCurrentIndex + 1) % this.autoSwitchDashboards.length;

        const nextId = this.autoSwitchDashboards[this.autoSwitchCurrentIndex];

        sessionStorage.setItem('autoSwitch', JSON.stringify({
            enabled: true,
            dashboards: this.autoSwitchDashboards,
            intervalTime: this.autoSwitchIntervalTime,
            currentIndex: this.autoSwitchCurrentIndex
        }));
        window.location.href = `?dashboard=${nextId}`;
    }

    startProgressTimer() {
        if (this.autoSwitchProgressTimer) {
            clearInterval(this.autoSwitchProgressTimer);
        }

        this.autoSwitchProgressElapsed = 0;
        const totalSeconds = this.autoSwitchIntervalTime / 1000;

        this.autoSwitchProgressTimer = setInterval(() => {
            this.autoSwitchProgressElapsed++;
            this.updateProgressBar();

            // עדכן countdown באינדיקטור
            const remaining = totalSeconds - this.autoSwitchProgressElapsed;
            const countdownEl = document.getElementById('autoSwitchCountdown');
            if (countdownEl) {
                countdownEl.textContent = `${remaining}s`;
            }

            if (this.autoSwitchProgressElapsed >= totalSeconds) {
                clearInterval(this.autoSwitchProgressTimer);
            }
        }, 1000);
    }

    updateProgressBar() {
        const progressBar = document.getElementById('autoSwitchProgressBar');
        const progressLabel = document.getElementById('autoSwitchProgressLabel');
        const progressTime = document.getElementById('autoSwitchProgressTime');

        if (!progressBar) return;

        const totalSeconds = this.autoSwitchIntervalTime / 1000;
        const percent = Math.min((this.autoSwitchProgressElapsed / totalSeconds) * 100, 100);
        const remaining = Math.max(totalSeconds - this.autoSwitchProgressElapsed, 0);

        progressBar.style.width = `${percent}%`;

        if (progressLabel && this.currentDashboard) {
            progressLabel.textContent = `כעת: ${this.currentDashboard.name}`;
        }

        if (progressTime) {
            progressTime.textContent = `${remaining}s`;
        }
    }

    updateAutoSwitchPopupActiveState(activeDashboardId) {
        document.querySelectorAll('.auto-switch-dashboard-card').forEach(card => {
            const id = card.getAttribute('data-dashboard-id');
            if (id === activeDashboardId) {
                card.style.outline = '2px solid #a78bfa';
            } else {
                card.style.outline = 'none';
            }
        });
    }

    loadAchievementsDashboard() {
        if (typeof AchievementsDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/AchievementsDashboard.js';
            script.onload = () => {
                if (typeof AchievementsDashboard !== 'undefined') {
                    this.initializeAchievementsDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof AchievementsDashboard !== 'undefined') {
                            this.initializeAchievementsDashboard();
                        } else {
                            this.showError(
                                'AchievementsDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () =>
                this.showError('שגיאה בטעינת AchievementsDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeAchievementsDashboard();
        }
    }

    loadActivitiesDashboard() {
        if (typeof ActivitiesDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/ActivitiesDashboard.js';
            script.onload = () => {
                if (typeof ActivitiesDashboard !== 'undefined') {
                    this.initializeActivitiesDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof ActivitiesDashboard !== 'undefined') {
                            this.initializeActivitiesDashboard();
                        } else {
                            this.showError('ActivitiesDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () =>
                this.showError('שגיאה בטעינת ActivitiesDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeActivitiesDashboard();
        }
    }

    initializeActivitiesDashboard() {
        if (typeof ActivitiesDashboard === 'undefined') {
            this.showError('ActivitiesDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="activitiesDashboardRoot"></div>';

        window.activitiesDashboard = new ActivitiesDashboard(
            'activitiesDashboardRoot',
            this.currentUser
        );
        window.activitiesDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    initializeAchievementsDashboard() {
        if (typeof AchievementsDashboard === 'undefined') {
            this.showError('AchievementsDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML =
            '<div id="achievementsDashboardRoot"></div>';

        window.achievementsDashboard = new AchievementsDashboard(
            'achievementsDashboardRoot'
        );
        window.achievementsDashboard.initialize();
        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    loadGrafanaDashboard() {
        if (typeof GrafanaDashboard === 'undefined') {
            const script = document.createElement('script');
            script.src = '/js/GrafanaDashboardManager.js';
            script.onload = () => {
                if (typeof GrafanaDashboard !== 'undefined') {
                    this.initializeGrafanaDashboard();
                } else {
                    setTimeout(() => {
                        if (typeof GrafanaDashboard !== 'undefined') {
                            this.initializeGrafanaDashboard();
                        } else {
                            this.showError('GrafanaDashboard לא נטען כראוי');
                        }
                    }, 100);
                }
            };
            script.onerror = () =>
                this.showError('שגיאה בטעינת GrafanaDashboard');
            document.head.appendChild(script);
        } else {
            this.initializeGrafanaDashboard();
        }
    }

    initializeGrafanaDashboard() {
        if (typeof GrafanaDashboard === 'undefined') {
            this.showError('GrafanaDashboard class is not defined');
            return;
        }

        let container = document.getElementById('dashboardContent');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dashboardContent';
            container.className = 'dashboard-content';
            document.body.appendChild(container);
        }
        container.innerHTML = '<div id="itsmDashboardRoot"></div>';

        window.itsmDashboard = new GrafanaDashboard('itsmDashboardRoot');
        window.itsmDashboard.initialize();

        setTimeout(() => this.reinitScrollToTopButton(), 600);
    }

    goToPrevDashboard() {
        const allowedDashboards = this.getAllowedDashboards();

        if (allowedDashboards.length === 0) return;

        const currentId = this.currentDashboard ? this.currentDashboard.id : null;

        let prevIndex = allowedDashboards.length - 1; // ברירת מחדל: אחרון

        if (currentId) {
            const currentIndex = allowedDashboards.findIndex(d => d.id === currentId);
            // אם לא נמצא (-1) - עבור לאחרון, אחרת עבור לקודם
            if (currentIndex <= 0) {
                prevIndex = allowedDashboards.length - 1; // חזור לאחרון
            } else {
                prevIndex = currentIndex - 1;
            }
        }

        const prevDashboard = allowedDashboards[prevIndex];
        window.location.href = `?dashboard=${prevDashboard.id}`;
    }

    goToNextDashboard() {
        // השתמש רק בדשבורדים מורשים
        const allowedDashboards = this.getAllowedDashboards();

        if (allowedDashboards.length === 0) return;

        const currentId = this.currentDashboard ? this.currentDashboard.id : null;

        let nextIndex = 0;

        if (currentId) {
            const currentIndex = allowedDashboards.findIndex(d => d.id === currentId);
            // אם לא נמצא (-1) או אחרון ברשימה - חזור לראשון
            nextIndex = (currentIndex + 1) % allowedDashboards.length;
        }

        const nextDashboard = allowedDashboards[nextIndex];
        window.location.href = `?dashboard=${nextDashboard.id}`;
    }

    showError(message) {
        console.error(message);

        // יצירת אלמנט להודעת שגיאה
        const errorElement = document.createElement('div');
        errorElement.className = 'dashboard-error';
        errorElement.textContent = message;
        errorElement.style.backgroundColor = '#f8d7da';
        errorElement.style.color = '#721c24';
        errorElement.style.padding = '10px 15px';
        errorElement.style.margin = '10px 0';
        errorElement.style.borderRadius = '4px';
        errorElement.style.textAlign = 'center';

        // הוסף את הודעת השגיאה לתחילת התוכן
        const content = document.getElementById('dashboardContent');
        if (content) {
            content.insertBefore(errorElement, content.firstChild);
        } else {
            document.body.appendChild(errorElement);
        }

        // הסתר את ההודעה אחרי 5 שניות
        setTimeout(() => {
            if (errorElement.parentNode) {
                errorElement.parentNode.removeChild(errorElement);
            }
        }, 5000);
    }
}

// יצירת מופע של מנהל הדשבורדים
const dashboardsManager = new DashboardsManager();
document.addEventListener('DOMContentLoaded', () => {
    dashboardsManager.initialize();
});