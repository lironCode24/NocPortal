/**
 * ActivitiesDashboard - דשבורד ניהול פעילויות
 * עוטף את ActivityManager בתוך מסגרת הדשבורד
 */
class ActivitiesDashboard {
    constructor(containerId, currentUser) {
        this.containerId = containerId;
        this.container = null;
        this.currentUser = currentUser;
        this.activityManagerInstance = null;
    }

    async initialize() {
        this.ensurePortalCss();

        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        this.ensureActivityManagerStyles();
        this.renderLayout();
        await this.loadDependencies();
        await this.initActivityManager();
        // ניקוי בעת עזיבת הדף
        window.addEventListener('beforeunload', () => {
            document.body.style.overflow = '';
        });
    }

    ensureFlatpickrHelper() {
        return new Promise((resolve) => {
            if (typeof FlatpickrHelper !== 'undefined') {
                resolve();
                return;
            }
            // צור fallback ישירות - אל תנסה לטעון קובץ
            this.createFallbackFlatpickrHelper();
            resolve();
        });
    }

    ensureNotificationManager() {
        return new Promise((resolve) => {
            if (typeof NotificationManager !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/js/NotificationManager.js';
            script.onload = () => resolve();
            script.onerror = () => {
                window.NotificationManager = {
                    show: (message, type = 'info') => {
                        const colors = {
                            success: '#22c55e',
                            error: '#ef4444',
                            warning: '#f59e0b',
                            info: '#3b82f6'
                        };
                        const toast = document.createElement('div');
                        toast.style.cssText = `
                            position: fixed;
                            bottom: 24px;
                            left: 50%;
                            transform: translateX(-50%);
                            background: ${colors[type] || colors.info};
                            color: white;
                            padding: 10px 20px;
                            border-radius: 8px;
                            font-size: 14px;
                            font-weight: 600;
                            z-index: 99999;
                            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                            direction: rtl;
                        `;
                        toast.textContent = message;
                        document.body.appendChild(toast);
                        setTimeout(() => {
                            if (toast.parentNode) toast.remove();
                        }, 3500);
                    }
                };
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    createFallbackFlatpickrHelper() {
        window.FlatpickrHelper = {
            initHebrewDatePicker: (selector, onChange) => {
                const el = document.querySelector(selector);
                if (!el) return null;

                if (typeof flatpickr === 'undefined') {
                    return {
                        open: () => { },
                        clear: () => { },
                        setDate: () => { },
                        destroy: () => { }
                    };
                }

                return flatpickr(el, {
                    dateFormat: 'Y-m-d',
                    locale: {
                        firstDayOfWeek: 0,
                        weekdays: {
                            shorthand: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
                            longhand: [
                                'ראשון', 'שני', 'שלישי',
                                'רביעי', 'חמישי', 'שישי', 'שבת'
                            ]
                        },
                        months: {
                            shorthand: [
                                'ינו', 'פבר', 'מרץ', 'אפר',
                                'מאי', 'יונ', 'יול', 'אוג',
                                'ספט', 'אוק', 'נוב', 'דצמ'
                            ],
                            longhand: [
                                'ינואר', 'פברואר', 'מרץ',
                                'אפריל', 'מאי', 'יוני',
                                'יולי', 'אוגוסט', 'ספטמבר',
                                'אוקטובר', 'נובמבר', 'דצמבר'
                            ]
                        }
                    },
                    onChange: (selectedDates, dateStr) => {
                        if (onChange) onChange(selectedDates, dateStr);
                    }
                });
            },

            formatDateToDisplay: (isoDate) => {
                if (!isoDate) return '';
                const parts = isoDate.split('-');
                if (parts.length !== 3) return isoDate;
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            },

            formatDateToISO: (displayDate) => {
                if (!displayDate) return '';
                const parts = displayDate.split('/');
                if (parts.length !== 3) return displayDate;
                return `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
        };
    }

    // ─────────────────────────────────────────────
    // אתחול ActivityManager
    // ─────────────────────────────────────────────

    async initActivityManager() {
        if (typeof ActivityManager === 'undefined') {
            console.error('ActivityManager is not defined');
            this.showError('שגיאה: ActivityManager לא נטען');
            return;
        }

        // עצור instance קודם אם קיים
        if (window.activityManager) {
            try {
                window.activityManager.stopAutoRefresh();
                window.activityManager.stopActivityAlarmMonitoring();
            } catch (e) {
                console.warn('Could not stop previous activityManager:', e);
            }
            window.activityManager = null;
        }

        // שמור currentUser ב-sessionStorage
        if (this.currentUser) {
            sessionStorage.setItem('currentUser', JSON.stringify(this.currentUser));
        }

        // צור instance חדש
        window.activityManager = new ActivityManager();

        activityManager = window.activityManager;

        // *** זה מה שחסר - קריאה ל-initialize! ***
        await window.activityManager.initialize();

        this.activityManagerInstance = window.activityManager;
        this.applyUserPermissions();
    }

    applyUserPermissions() {
        const isLoggedIn = this.currentUser &&
            this.currentUser.username &&
            this.currentUser.username.trim() !== '';

        const isAdmin = isLoggedIn &&
            (this.currentUser.role === 'Admin' ||
                this.currentUser.role === 'NOC');

        // ── כפתורי Admin בלבד (פעילות חדשה, ייבוא, טמפלייטים) ──
        document.querySelectorAll('.admin-only-btn').forEach(btn => {
            btn.style.display = isAdmin ? '' : 'none';
        });

        // ── כפתורי פעולה על משימות (עריכה, מחיקה, דילוג) ──
        document.querySelectorAll('.task-action-btn').forEach(btn => {
            btn.style.display = isLoggedIn ? '' : 'none';
        });

        // ── כפתורי פעולה על פעילויות בסיידבר ──
        document.querySelectorAll('.activity-tab-actions').forEach(el => {
            el.style.display = isAdmin ? 'flex' : 'none';
        });

        // ── כפתור הוסף משימה ──
        const addTaskBtn = document.querySelector('.act-add-task-btn');
        if (addTaskBtn) {
            addTaskBtn.style.display = isLoggedIn ? '' : 'none';
        }
        
        // ════════════════════════════════════════════════
        // *** הוסף: הסתרת אלמנטי ניווט כשאין משתמש ***
        // ════════════════════════════════════════════════

        // ── כפתורי ניווט - מוסתרים כשאין משתמש ──
        const navElementIds = [
            'autoSwitchBtn',
            'nextDashboardBtn',
            'prevDashboardBtn',
        ];

        navElementIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = isLoggedIn ? '' : 'none';
        });

        // ── back-to-main-btn - מוסתר כשאין משתמש ──
        const backBtn = document.querySelector('.back-to-main-btn');
        if (backBtn) backBtn.style.display = isLoggedIn ? '' : 'none';

        // ── user-info בתוך user-menu-section ──
        document.querySelectorAll('.user-menu-section .user-info').forEach(el => {
            el.style.display = isLoggedIn ? '' : 'none';
        });

        // ── user-menu-section עצמו - תמיד מוצג ──
        const userMenuSection = document.querySelector('.user-menu-section');
        if (userMenuSection) userMenuSection.style.display = '';

        // ── הצג/הסתר Toolbar לפי מצב התחברות ──
        this._updateToolbarVisibility(isLoggedIn, isAdmin);

        // ── שמור מצב ב-activityManager ──
        if (window.activityManager) {
            window.activityManager.isReadOnly = !isLoggedIn;
            // *** תיקון: וודא שisAdmin מסונכרן גם כ-boolean מפורש ***
            window.activityManager.isAdmin = isAdmin === true;
            window.activityManager._dashboard = this;
            
            // *** חדש: עדכן גם את currentUser אם חסר ***
            if (!window.activityManager.currentUser && this.currentUser) {
                window.activityManager.currentUser = this.currentUser;
            }
        }

        window.activitiesDashboard = this;
    }

    async openAlertCheckFromDashboard() {
        if (!this.currentActivityId) {
            NotificationManager.show('יש לבחור פעילות תחילה', 'warning');
            return;
        }

        if (typeof alertProcedureMappingManager === 'undefined') {
            NotificationManager.show(
                'מנהל מיפויי ההתראות לא נטען', 'warning');
            return;
        }

        await alertProcedureMappingManager.loadMappings();

        // קבל את כל המשימות של הפעילות
        const response = await fetch(
            `/Activities/GetActivityTasks` +
            `?activityId=${this.currentActivityId}` +
            `&date=${this.currentDate}`
        );
        const tasks = await response.json();
        if (!Array.isArray(tasks)) return;

        // עבור על כל המשימות ובדוק התאמות
        const results = [];

        for (const task of tasks) {
            if (!task.alertsToCheck) continue;

            const alertLines = task.alertsToCheck
                .split(/[\n,;]+/)
                .map(l => l.trim())
                .filter(Boolean);

            for (const line of alertLines) {
                const match = alertProcedureMappingManager
                    .findMatchingProcedure(line, '');
                if (match) {
                    results.push({ task, match, alertLine: line });
                }
            }
        }

        this._showDashboardAlertCheckResults(results, tasks);
    }

    _showDashboardAlertCheckResults(results, allTasks) {
        const existing = document.getElementById('dashboardAlertCheckPopup');
        if (existing) existing.remove();

        const activity = this.activities.find(
            a => a.id === this.currentActivityId
        );

        const popup = document.createElement('div');
        popup.id = 'dashboardAlertCheckPopup';
        popup.style.cssText = `
            position:fixed; inset:0;
            background:rgba(0,0,0,0.5);
            z-index:20000;
            display:flex; align-items:center;
            justify-content:center;
            padding:16px;
            backdrop-filter:blur(3px);
        `;

        const tasksWithAlerts = allTasks.filter(t => t.alertsToCheck);

        popup.innerHTML = `
            <div style="
                background:#fff; border-radius:14px;
                width:100%; max-width:600px;
                max-height:85vh;
                box-shadow:0 20px 60px rgba(0,0,0,0.3);
                direction:rtl; display:flex;
                flex-direction:column; overflow:hidden;
            ">
                <div style="
                    padding:16px 20px;
                    background:linear-gradient(135deg,#fff8e1,#fffde7);
                    border-bottom:2px solid #ffe082;
                    display:flex; align-items:center;
                    justify-content:space-between;
                ">
                    <h3 style="margin:0;font-size:0.95rem;
                                font-weight:700;color:#92400e;
                                display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-satellite-dish"
                        style="color:#f59e0b;"></i>
                        בדיקת התראות - ${this._escHtml(activity?.name || '')}
                    </h3>
                    <button onclick="document.getElementById(
                        'dashboardAlertCheckPopup').remove()"
                        style="background:none;border:none;
                            font-size:1.4rem;cursor:pointer;color:#888;">
                        &times;
                    </button>
                </div>

                <div style="padding:16px 20px;overflow-y:auto;flex:1;">

                    ${results.length === 0 ? `
                        <div style="text-align:center;padding:30px;">
                            <i class="fas fa-check-circle"
                            style="font-size:3rem;color:#28a745;
                                    display:block;margin-bottom:12px;"></i>
                            <p style="font-weight:700;color:#15803d;
                                    font-size:0.95rem;">
                                לא נמצאו התאמות לנהלים
                            </p>
                            <p style="color:#aaa;font-size:0.82rem;">
                                ${tasksWithAlerts.length} משימות עם התראות
                                נבדקו ולא נמצאו התאמות
                            </p>
                        </div>
                    ` : `
                        <div style="
                            padding:8px 12px;
                            background:rgba(245,158,11,0.1);
                            border-radius:8px;
                            margin-bottom:14px;
                            font-size:0.85rem;color:#92400e;
                            display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-exclamation-triangle"></i>
                            נמצאו <strong>${results.length}</strong>
                            התאמות ל-${results.length} נהלים
                        </div>

                        ${results.map(r => `
                            <div style="
                                border:1.5px solid #fde68a;
                                border-right:4px solid #f59e0b;
                                border-radius:8px;
                                padding:12px 14px;
                                margin-bottom:10px;
                                background:#fffbf0;
                            ">
                                <div style="font-size:0.85rem;
                                            font-weight:700;color:#78350f;
                                            margin-bottom:6px;">
                                    <i class="fas fa-tasks"
                                    style="color:#f59e0b;"></i>
                                    ${this._escHtml(r.task.title)}
                                </div>
                                <div style="font-size:0.8rem;color:#555;
                                            margin-bottom:6px;">
                                    <i class="fas fa-bell"
                                    style="color:#f59e0b;"></i>
                                    התראה: <code style="
                                        background:#fff3cd;
                                        padding:1px 6px;border-radius:4px;">
                                        ${this._escHtml(r.alertLine)}
                                    </code>
                                </div>
                                <div style="font-size:0.8rem;color:#0d6efd;
                                            display:flex;align-items:center;
                                            gap:6px;">
                                    <i class="fas fa-book-open"></i>
                                    נוהל:
                                    <strong>${this._escHtml(
                                        r.match.procedureName ||
                                        r.match.procedureFileName
                                    )}</strong>
                                    <button onclick="
                                        document.getElementById(
                                            'dashboardAlertCheckPopup'
                                        ).remove();
                                        alertProcedureMappingManager
                                            .openProcedureFromAlert(
                                                ${JSON.stringify(r.match)
                                                .replace(/"/g, '&quot;')}
                                            );"
                                        style="
                                            padding:3px 10px;
                                            background:#0d6efd;
                                            color:#fff;border:none;
                                            border-radius:5px;cursor:pointer;
                                            font-size:0.78rem;margin-right:auto;">
                                        פתח נוהל
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    `}
                </div>

                <div style="padding:12px 20px;border-top:1px solid #f0f0f0;
                            display:flex;justify-content:flex-end;">
                    <button onclick="document.getElementById(
                        'dashboardAlertCheckPopup').remove()"
                        style="padding:8px 20px;
                            background:linear-gradient(
                                135deg,#667eea,#764ba2);
                            color:#fff;border:none;border-radius:8px;
                            cursor:pointer;font-size:0.88rem;
                            font-weight:600;">
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

    _updateToolbarVisibility(isLoggedIn, isAdmin) {
        const toolbar = document.querySelector('.act-dashboard-toolbar');
        if (!toolbar) return;

        // ── אם אין משתמש מחובר - הצג באנר "צפייה בלבד" ──
        const existingBanner = document.getElementById('actReadOnlyBanner');
        if (existingBanner) existingBanner.remove();

        if (!isLoggedIn) {
            const banner = document.createElement('div');
            banner.id = 'actReadOnlyBanner';
            banner.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 16px;
            background: rgba(107,114,128,0.12);
            border-bottom: 1px solid rgba(107,114,128,0.25);
            font-size: 0.8rem;
            color: #9ca3af;
            direction: rtl;
            flex-shrink: 0;
        `;
            banner.innerHTML = `
            <i class="fas fa-eye" style="color:#6b7280"></i>
            <span>מצב צפייה בלבד — 
                <a class="act-login-link" href="/?returnUrl=${encodeURIComponent(window.location.pathname + window.location.search)}">
                    התחבר לביצוע פעולות
                </a>
            </span>
        `;

            // הכנס את הבאנר מעל ה-toolbar
            toolbar.parentNode.insertBefore(banner, toolbar);
        }

        // ── הסתר/הצג את כל ה-toolbar-left כשאין אדמין ──
        const toolbarLeft = toolbar.querySelector('.act-toolbar-left');
        if (toolbarLeft) {
            toolbarLeft.style.display = isAdmin ? 'flex' : 'none';
        }
    }

    showLoginRequired() {
        // הצג toast/notification
        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show(
                'נדרשת התחברות לביצוע פעולה זו',
                'warning'
            );
        }

        // הצג באנר זמני
        this.showLoginBanner();
    }

    showLoginBanner() {
        // הסר באנר קיים
        const existing = document.getElementById('loginRequiredBanner');
        if (existing) existing.remove();

        const banner = document.createElement('div');
        banner.id = 'loginRequiredBanner';
        banner.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: white;
        padding: 12px 24px;
        border-radius: 10px;
        font-size: 0.95rem;
        font-weight: 600;
        z-index: 99999;
        box-shadow: 0 4px 20px rgba(245,158,11,0.4);
        display: flex;
        align-items: center;
        gap: 10px;
        direction: rtl;
        animation: bannerSlideDown 0.3s ease;
    `;
        banner.innerHTML = `
        <i class="fas fa-lock"></i>
        <span>נדרשת התחברות לביצוע פעולה זו</span>
        <button onclick="this.parentElement.remove()" style="
            background: rgba(255,255,255,0.2);
            border: none;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.8rem;
            margin-right: 8px;
        "><i class="fas fa-times"></i></button>
    `;

        document.body.appendChild(banner);

        // הסר אוטומטית אחרי 4 שניות
        setTimeout(() => {
            if (banner.parentNode) {
                banner.style.animation = 'bannerSlideUp 0.3s ease forwards';
                setTimeout(() => banner.remove(), 300);
            }
        }, 4000);
    }

    showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `
            <div style="
                display:flex; flex-direction:column;
                align-items:center; justify-content:center;
                height:60vh; color:#e0e0e0; gap:16px;
            ">
                <i class="fas fa-exclamation-triangle"
                   style="font-size:3rem; color:#f87171;">
                </i>
                <p style="color:#aaa;">${message}</p>
            </div>
        `;
    }

    // ─────────────────────────────────────────────
    // renderLayout
    // ─────────────────────────────────────────────

    renderLayout() {
        this.container.innerHTML = `
        <div class="act-dashboard-wrapper">

            <!-- סרגל כלים עליון -->
            <div class="act-dashboard-toolbar">
                <div class="act-toolbar-right">
                    <div class="act-search-container activity-search">
                        <input
                            type="text"
                            id="activitySearchInput"
                            class="act-search-input"
                            placeholder="חיפוש פעילויות..."
                            oninput="if(window.activityManager) window.activityManager.searchActivities(this.value)"
                        >
                        <i class="fas fa-search act-search-icon"></i>
                        <button
                            class="clear-search-btn"
                            style="display:none"
                            onclick="
                                document.getElementById('activitySearchInput').value='';
                                activityManager.searchActivities('');
                                this.style.display='none';
                            "
                        >
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <!-- *** כפתורים עברו לכאן *** -->
                <div class="act-toolbar-left">
                    <!-- כפתורים אלו יוצגו רק לאדמין - נשלט מ-JS אחרי אתחול -->
                    <button
                        class="act-toolbar-btn act-btn-new-activity admin-only-btn"
                        style="display:none"
                        onclick="if(window.activityManager) window.activityManager.openAddActivityModal()"
                    >
                        <i class="fas fa-plus"></i>
                        פעילות חדשה
                    </button>
                    <button
                        class="act-toolbar-btn act-btn-import-excel admin-only-btn"
                        style="display:none"
                        onclick="if(window.activityManager) window.activityManager.openImportExcelModal()"
                    >
                        <i class="fas fa-file-excel"></i>
                        ייבוא מאקסל
                    </button>
                    <button
                        class="act-toolbar-btn act-btn-templates admin-only-btn"
                        style="display:none"
                        onclick="if(window.activityManager) window.activityManager.openTemplatesModal()"
                    >
                        <i class="fas fa-file-alt"></i>
                        טמפלייטים
                    </button>
                </div>
            </div>

                <!-- תוכן ראשי -->
                <div class="act-dashboard-main">

                    <!-- סיידבר: רשימת פעילויות -->
                    <div class="act-sidebar">
                        <div id="activityTabsContainer"
                             class="act-tabs-container">
                        </div>
                    </div>

                    <!-- תוכן: פרטי פעילות ומשימות -->
                    <div class="act-content">

                        <!-- כותרת פעילות -->
                        <div class="act-activity-header">
                            <div class="act-activity-info">
                                <h2 id="activityNameDisplay"
                                    class="act-activity-name">
                                </h2>
                                <span id="activityDateDisplay"
                                    class="act-activity-date">
                                    לא נבחרה פעילות
                                </span>
                                <!-- *** חדש: מנהל הפעילות *** -->
                                <span id="activityManagerDisplay"
                                    class="act-activity-manager"
                                    style="display:none;">
                                </span>
                            </div>
                            <div class="act-progress-wrap">
                                <div class="act-progress-circle"
                                     id="activityProgressCircle">
                                    <span id="activityProgressText"
                                          class="act-progress-text">
                                        0%
                                    </span>
                                </div>
                                <div id="activityProgressDescription"
                                     class="act-progress-desc">
                                    0 מתוך 0 משימות
                                </div>
                            </div>
                        </div>

                        <!-- שורת בקרות משימות -->
                        <div class="task-controls-row" style="display:none">
                            <div class="act-task-controls">

                                <button
                                    class="act-add-task-btn admin-only-btn"
                                    style="display:none"
                                    onclick="activityManager.openAddTaskModal()"
                                >
                                    <i class="fas fa-plus"></i>
                                    הוסף משימה
                                </button>
                                <div class="act-search-container
                                            task-search-container
                                            task-search"
                                    style="display:none">
                                    <input
                                        type="text"
                                        id="taskSearchInput"
                                        class="act-search-input"
                                        placeholder="חיפוש משימות..."
                                        oninput="activityManager.searchTasks(this.value)"
                                    >
                                    <i class="fas fa-search act-search-icon"></i>
                                    <button
                                        class="clear-search-btn task-search"
                                        style="display:none"
                                        onclick="
                                            document.getElementById('taskSearchInput').value='';
                                            activityManager.searchTasks('');
                                            this.style.display='none';
                                        "
                                    >
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                        
                                <!-- placeholder - ימולא מ-ActivityManager אחרי אתחול -->
                                <span id="taskFiltersBar"></span>
                            </div>
                        </div>
                        
                        <!-- קונטיינר משימות -->
                        <div id="activityTasksContainer"
                             class="act-tasks-container">
                            <div class="tasks-empty">
                                <i class="fas fa-clipboard-list"></i><br>
                                בחר פעילות להצגת משימות
                            </div>
                        </div>

                    </div><!-- /act-content -->
                </div><!-- /act-dashboard-main -->
            </div><!-- /act-dashboard-wrapper -->

            <!-- Add Activity Modal -->
            <div id="addActivityModal" class="add-task-modal">
                <div class="task-modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title" id="activityModalTitle">צור פעילות חדשה</h3>
                        <button class="close-btn" 
                                onclick="activityManager.closeAddActivityModal()">&times;</button>
                    </div>
                    <form id="activityForm" onsubmit="event.preventDefault(); 
                        const formData = {
                            id: document.getElementById('activityId').value,
                            name: document.getElementById('activityName').value,
                            description: document.getElementById('activityDescription').value,
                            activityManager: document.getElementById('activityManagerInput').value
                        };
                        activityManager.saveActivity(formData, !!formData.id);">
                        
                        <input type="hidden" id="activityId">
                        
                        <div class="form-group">
                            <label class="form-label" for="activityName">שם הפעילות *</label>
                            <input type="text" id="activityName" class="form-input" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="activityDescription">תיאור</label>
                            <textarea id="activityDescription" 
                                    class="form-textarea" rows="3"></textarea>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="activityDateInput">
                                תאריך הפעילות *
                            </label>
                            <div class="date-input-wrapper">
                                <input type="date" 
                                    id="activityDateInputHidden" 
                                    class="hidden-date-input"
                                    onchange="activityManager.handleActivityDateChange(this.value)">
                                <input type="text" 
                                    id="activityDateInput" 
                                    placeholder="DD/MM/YYYY" 
                                    readonly
                                    onclick="activityManager.openActivityDatePicker()" 
                                    class="formatted-date-input">
                                <i class="fas fa-calendar-alt date-icon" 
                                onclick="activityManager.openActivityDatePicker()"></i>
                            </div>
                        </div>

                        <!-- *** שדה חדש: מנהל פעילות *** -->
                        <div class="form-group">
                            <label class="form-label" for="activityManagerInput">
                                <i class="fas fa-user-tie"></i>
                                מנהל פעילות
                            </label>
                            <input type="text" 
                                id="activityManagerInput" 
                                class="form-input"
                                placeholder="שם מנהל הפעילות">
                        </div>

                        <div class="form-actions">
                            <button type="button" 
                                    class="btn-secondary" 
                                    onclick="activityManager.closeAddActivityModal()">
                                ביטול
                            </button>
                            <button type="submit" 
                                    class="btn-primary" 
                                    id="activitySubmitBtn">
                                צור פעילות
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- ===== מודל הוספת/עריכת משימה ===== -->
            <!-- Add Activity Task Modal -->
            <div id="addActivityTaskModal" class="add-task-modal">
                <div class="task-modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title" id="activityTaskModalTitle">הוסף משימה לפעילות</h3>
                        <button class="close-btn" onclick="activityManager.closeAddTaskModal()">&times;</button>
                    </div>

                    <!-- Scrollable Body -->
                    <div class="modal-body">
                        <form id="activityTaskForm" onsubmit="event.preventDefault();
                            const formData = {
                                id: document.getElementById('activityTaskId').value,
                                title: document.getElementById('activityTaskTitle').value,
                                description: document.getElementById('activityTaskDescription').value,
                                priority: document.getElementById('activityTaskPriority').value,
                                taskDate: document.getElementById('activityTaskDateHidden').value || null,
                                taskHour: document.getElementById('activityTaskHour').value || null,
                                taskMinute: document.getElementById('activityTaskMinute').value || null,
                                responsiblePerson: document.getElementById('activityTaskResponsible').value || null,
                                secondaryResponsible: document.getElementById('activityTaskSecondary').value || null,
                                status: document.getElementById('activityTaskStatus').value || 'חדש',
                                notes: document.getElementById('activityTaskNotes').value || null,
                                alertsToCheck: document.getElementById('activityTaskAlertsToCheck').value || null,
                            };
                            activityManager.saveTask(formData, !!formData.id);">

                            <input type="hidden" id="activityTaskId">

                            <div class="form-group">
                                <label class="form-label" for="activityTaskTitle">כותרת המשימה *</label>
                                <input type="text" id="activityTaskTitle" class="form-input" required>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="activityTaskDescription">תיאור</label>
                                <textarea id="activityTaskDescription" class="form-textarea" rows="3"></textarea>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="activityTaskPriority">עדיפות</label>
                                <select id="activityTaskPriority" class="form-select">
                                    <option value="low">נמוכה</option>
                                    <option value="medium" selected>בינונית</option>
                                    <option value="high">גבוהה</option>
                                </select>
                            </div>

                        <div class="form-group">
                                <label class="form-label">תאריך ביצוע</label>
                                <div class="date-input-wrapper">
                                    <input type="date" id="activityTaskDateHidden" class="hidden-date-input"
                                        onchange="activityManager.handleTaskDateChange(this.value)">
                                    <input type="text" id="activityTaskDate" class="formatted-date-input"
                                        placeholder="בחר תאריך" readonly
                                        onclick="activityManager.taskDatePicker.open()">
                                    <i class="fas fa-calendar-alt date-icon"
                                    onclick="activityManager.taskDatePicker.open()"></i>
                                </div>
                            </div>


                            <div class="form-group">
                                <label class="form-label">שעת ביצוע משוערת (אופציונלי)</label>
                                <div class="time-picker">
                                    <select id="activityTaskMinute" class="time-select">
                                        <option value="">דקה</option>
                                        <option value="00">00</option>
                                        <option value="05">05</option>
                                        <option value="10">10</option>
                                        <option value="15">15</option>
                                        <option value="20">20</option>
                                        <option value="25">25</option>
                                        <option value="30">30</option>
                                        <option value="35">35</option>
                                        <option value="40">40</option>
                                        <option value="45">45</option>
                                        <option value="50">50</option>
                                        <option value="55">55</option>
                                    </select>
                                    <span class="time-separator">:</span>
                                    <select id="activityTaskHour" class="time-select">
                                        <option value="">שעה</option>
                                        <option value="00">00</option>
                                        <option value="01">01</option>
                                        <option value="02">02</option>
                                        <option value="03">03</option>
                                        <option value="04">04</option>
                                        <option value="05">05</option>
                                        <option value="06">06</option>
                                        <option value="07">07</option>
                                        <option value="08">08</option>
                                        <option value="09">09</option>
                                        <option value="10">10</option>
                                        <option value="11">11</option>
                                        <option value="12">12</option>
                                        <option value="13">13</option>
                                        <option value="14">14</option>
                                        <option value="15">15</option>
                                        <option value="16">16</option>
                                        <option value="17">17</option>
                                        <option value="18">18</option>
                                        <option value="19">19</option>
                                        <option value="20">20</option>
                                        <option value="21">21</option>
                                        <option value="22">22</option>
                                        <option value="23">23</option>
                                    </select>
                                    <button type="button" class="time-clear-btn" onclick="activityManager.clearTaskTimeSelection()" title="נקה בחירת זמן">
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
                                <small class="form-help">בחר שעה ודקות</small>
                            </div>

                            <div class="form-group">
                                <label class="form-label">גורם אחראי</label>
                                <input type="text" id="activityTaskResponsible" class="form-input"
                                    placeholder="שם האחראי">
                            </div>

                            <div class="form-group">
                                <label class="form-label">אחראי משנה</label>
                                <input type="text" id="activityTaskSecondary" class="form-input"
                                    placeholder="שם האחראי המשני">
                            </div>

                            <div class="form-group">
                                <label class="form-label">סטטוס</label>
                                <select id="activityTaskStatus" class="form-select">
                                    <option value="חדש">חדש</option>
                                    <option value="ממתין">ממתין</option>
                                    <option value="בביצוע">בביצוע</option>
                                    <option value="בוצע">בוצע</option>
                                    <option value="מבוטלת">מבוטלת</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label class="form-label">הערות</label>
                                <textarea id="activityTaskNotes" class="form-textarea"
                                        placeholder="הערות נוספות..."></textarea>
                            </div>

                            <!-- ════════════════════════════════════════════
                                שדות חדשים: מערכת, סביבה, תלות, שיבוש, השפעה
                            ════════════════════════════════════════════ -->
                            <div class="form-group-section">
                                <div class="section-divider">
                                    <div class="section-divider-line"></div>
                                    <span class="section-divider-label">
                                        <i class="fas fa-server"></i>
                                        פרטי מערכת ותשתית
                                    </span>
                                    <div class="section-divider-line"></div>
                                </div>

                                <!-- מערכת -->
                                <div class="form-group">
                                    <label class="form-label" for="activityTaskSystemName">
                                        <i class="fas fa-server" style="color:#667eea; margin-left:4px;"></i>
                                        מערכת
                                    </label>
                                    <input type="text" 
                                        id="activityTaskSystemName" 
                                        class="form-input"
                                        placeholder="לדוגמה: Datastage, SAP, Oracle...">
                                </div>

                                <!-- סביבה -->
                                <div class="form-group">
                                    <label class="form-label" for="activityTaskEnvironment">
                                        <i class="fas fa-layer-group" style="color:#667eea; margin-left:4px;"></i>
                                        סביבה
                                    </label>
                                    <input type="text" 
                                        id="activityTaskEnvironment" 
                                        class="form-input"
                                        placeholder="לדוגמה: ALL, Virtual Machine, Kubernetes...">
                                </div>

                                <!-- תלות -->
                                <div class="form-group">
                                    <label class="form-label" for="activityTaskDependency">
                                        <i class="fas fa-project-diagram" style="color:#667eea; margin-left:4px;"></i>
                                        תלות
                                    </label>
                                    <input type="text" 
                                        id="activityTaskDependency" 
                                        class="form-input"
                                        placeholder="לדוגמה: תלוי בסגירת טיקט 1234...">
                                </div>

                                <!-- משך זמן שיבוש -->
                                <div class="form-group">
                                    <label class="form-label" for="activityTaskDisruptionDuration">
                                        <i class="fas fa-hourglass-half" style="color:#f59e0b; margin-left:4px;"></i>
                                        משך זמן שיבוש משוער
                                    </label>
                                    <input type="text" 
                                        id="activityTaskDisruptionDuration" 
                                        class="form-input"
                                        placeholder="לדוגמה: 30 דקות, 2 שעות, ללא שיבוע...">
                                </div>

                                <!-- השפעה -->
                                <div class="form-group">
                                    <label class="form-label" for="activityTaskImpact">
                                        <i class="fas fa-bolt" style="color:#dc3545; margin-left:4px;"></i>
                                        השפעה
                                    </label>
                                    <input type="text" 
                                        id="activityTaskImpact" 
                                        class="form-input"
                                        placeholder="לדוגמה: השבתת שירות X, השפעה על לקוחות Y...">
                                </div>

                            </div>
                            <!-- /שדות מערכת ותשתית -->
                            <!-- התראות לבדיקה -->
                            <div class="form-group">
                                <label class="form-label">
                                    <i class="fas fa-satellite-dish" 
                                    style="color:#f59e0b;margin-left:4px;"></i>
                                    התראות לבדיקה
                                </label>
                                <textarea id="activityTaskAlertsToCheck" 
                                        class="form-textarea" 
                                        rows="3"
                                        placeholder="הזן תיאור התראות שיש לבדוק במשימה זו...
                            דוגמה: ping lost / CPU high / interface down"></textarea>
                                <small class="form-help">
                                    <i class="fas fa-info-circle"></i>
                                    תיאור ההתראות שיש לבדוק בעת ביצוע משימה זו
                                </small>
                            </div>
                                    
                            <!-- ═══════════════════════════════════════════
                                הגדרות מייל לביצוע משימה
                            ═══════════════════════════════════════════ -->
                            <div class="form-group email-config-section">
                                <label class="form-label email-section-header">
                                    <i class="fas fa-envelope" 
                                    style="color:#667eea;margin-left:6px;"></i>
                                    הגדרות מייל אוטומטי עם ביצוע המשימה
                                    <button type="button"
                                            class="email-toggle-btn"
                                            id="emailSectionToggle"
                                            onclick="
                                                const body = document.getElementById('emailConfigBody');
                                                const icon = document.getElementById('emailToggleIcon');
                                                const isOpen = body.style.display !== 'none';
                                                body.style.display = isOpen ? 'none' : 'block';
                                                icon.className = isOpen 
                                                    ? 'fas fa-chevron-down' 
                                                    : 'fas fa-chevron-up';
                                            "
                                            style="
                                                background: none;
                                                border: none;
                                                cursor: pointer;
                                                margin-right: auto;
                                                color: #667eea;
                                                font-size: 0.8rem;
                                                padding: 2px 6px;
                                            ">
                                        <i class="fas fa-chevron-down" 
                                        id="emailToggleIcon"></i>
                                    </button>
                                </label>

                                <!-- גוף מתקפל -->
                                <div id="emailConfigBody" style="display:none;">

                                    <div style="
                                        background: rgba(102,126,234,0.06);
                                        border: 1px solid rgba(102,126,234,0.2);
                                        border-radius: 8px;
                                        padding: 12px 14px;
                                        margin-bottom: 10px;
                                        font-size: 0.8rem;
                                        color: #667eea;
                                        direction: rtl;
                                    ">
                                        <i class="fas fa-info-circle"></i>
                                        כאשר המשימה תסומן כבוצעה, יישלח מייל אוטומטי.
                                        <br>
                                        ניתן להשתמש בתגיות:
                                        <code style="background:rgba(102,126,234,0.12);
                                                    padding:1px 5px;border-radius:3px;">
                                            {task}
                                        </code>
                                        <code style="background:rgba(102,126,234,0.12);
                                                    padding:1px 5px;border-radius:3px;">
                                            {completedBy}
                                        </code>
                                        <code style="background:rgba(102,126,234,0.12);
                                                    padding:1px 5px;border-radius:3px;">
                                            {time}
                                        </code>
                                        <code style="background:rgba(102,126,234,0.12);
                                                    padding:1px 5px;border-radius:3px;">
                                            {date}
                                        </code>
                                    </div>

                                    <!-- נמען TO -->
                                    <div class="form-group" style="margin-bottom:10px;">
                                        <label class="form-label" 
                                            style="font-size:0.82rem;">
                                            <i class="fas fa-at" 
                                            style="color:#667eea;margin-left:4px;"></i>
                                            נמען (TO) *
                                        </label>
                                        <input type="email"
                                            id="activityTaskEmailTo"
                                            class="form-input"
                                            placeholder="example@company.co.il"
                                            style="direction:ltr;text-align:left;">
                                        <small class="form-help">
                                            כתובת מייל אחת בלבד
                                        </small>
                                    </div>

                                    <!-- CC -->
                                    <div class="form-group" style="margin-bottom:10px;">
                                        <label class="form-label"
                                            style="font-size:0.82rem;">
                                            <i class="fas fa-copy" 
                                            style="color:#667eea;margin-left:4px;"></i>
                                            עותק (CC)
                                        </label>
                                        <input type="text"
                                            id="activityTaskEmailCc"
                                            class="form-input"
                                            placeholder="cc1@company.co.il, cc2@company.co.il"
                                            style="direction:ltr;text-align:left;">
                                        <small class="form-help">
                                            ניתן להזין מספר כתובות מופרדות בפסיק
                                        </small>
                                    </div>

                                    <!-- נושא -->
                                    <div class="form-group" style="margin-bottom:10px;">
                                        <label class="form-label"
                                            style="font-size:0.82rem;">
                                            <i class="fas fa-heading" 
                                            style="color:#667eea;margin-left:4px;"></i>
                                            נושא המייל
                                        </label>
                                        <input type="text"
                                            id="activityTaskEmailSubject"
                                            class="form-input"
                                            placeholder="משימה הושלמה: {task}">
                                        <small class="form-help">
                                            ברירת מחדל: "משימה הושלמה: {task}"
                                        </small>
                                    </div>

                                    <!-- גוף מייל -->
                                    <div class="form-group" style="margin-bottom:0;">
                                        <label class="form-label"
                                            style="font-size:0.82rem;">
                                            <i class="fas fa-align-left" 
                                            style="color:#667eea;margin-left:4px;"></i>
                                            גוף המייל
                                        </label>
                                        <textarea id="activityTaskEmailBodyText"
                                                class="form-textarea"
                                                rows="3"
                                                placeholder="המשימה {task} בוצעה על ידי {completedBy} בשעה {time} בתאריך {date}."></textarea>
                                        <small class="form-help">
                                            ניתן להשתמש ב-HTML בסיסי.
                                            ריק = תבנית ברירת מחדל
                                        </small>
                                    </div>

                                </div><!-- /emailConfigBody -->
                            </div><!-- /email-config-section -->
                        </form>
                    </div>

                    <div class="modal-footer">
                        <div class="form-actions">
                            <button type="button" class="btn-secondary" onclick="activityManager.closeAddTaskModal()">ביטול</button>
                            <button type="submit" class="btn-primary" id="activityTaskSubmitBtn"
                                    onclick="document.getElementById('activityTaskForm').requestSubmit()">הוסף משימה</button>
                        </div>
                    </div>
                </div>
            </div>


            <!-- ===== מודל סיבת אי ביצוע ===== -->
            <div id="activitySkipReasonModal" class="add-task-modal">
                <div class="task-modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title">סיבת אי ביצוע משימה</h3>
                        <button class="close-btn" onclick="activityManager.closeSkipModal()">&times;</button>
                    </div>
                    <form id="activitySkipReasonForm" onsubmit="event.preventDefault();
                        const taskId = document.getElementById('activitySkipTaskId').value;
                        const reasonSelect = document.getElementById('activitySkipReasonSelect').value;
                        const customReason = document.getElementById('activitySkipReasonCustom').value;
                        const userName = document.getElementById('activitySkipUserName').value;
                        const skipReason = reasonSelect === 'אחר' ? customReason : reasonSelect;

                        if (!skipReason || !userName) {
                            alert('יש למלא את כל השדות');
                            return;
                        }

                        activityManager.markTaskAsSkipped(taskId, skipReason, userName);
                        activityManager.closeSkipModal();">

                        <input type="hidden" id="activitySkipTaskId">

                        <div class="form-group">
                            <label class="form-label" for="activitySkipUserName">שם העובד: <span class="required">*</span></label>
                            <select id="activitySkipUserName" class="form-select" required>
                                <option value="">בחר עובד...</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="activitySkipReasonSelect">סיבת אי ביצוע *</label>
                            <select id="activitySkipReasonSelect" class="form-select" required
                                    onchange="activityManager.handleSkipReasonChange()">
                                <option value="">בחר סיבה</option>
                                <option value="חוסר זמן">חוסר זמן</option>
                                <option value="תקלה טכנית">תקלה טכנית</option>
                                <option value="חוסר מידע">חוסר מידע</option>
                                <option value="ממתין לאישור">ממתין לאישור</option>
                                <option value="לא רלוונטי">לא רלוונטי</option>
                                <option value="אחר">אחר</option>
                            </select>
                        </div>

                        <div class="form-group" id="activityCustomReasonGroup" style="display: none;">
                            <label class="form-label" for="activitySkipReasonCustom">פרט את הסיבה *</label>
                            <textarea id="activitySkipReasonCustom" class="form-textarea" rows="2"></textarea>
                        </div>

                        <div class="form-actions">
                            <button type="button" class="btn-secondary" onclick="activityManager.closeSkipModal()">ביטול</button>
                            <button type="submit" class="btn-warning">סמן כלא בוצע</button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- מודל השלמת משימה ע"י עובד -->
            <div id="activityEmployeeCompletionModal" class="skip-reason-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h3 class="modal-title">
                            <i class="fas fa-user-check"></i>
                            סימון משימה כהושלמה
                        </h3>
                        <button class="close-btn" onclick="activityManager.closeEmployeeCompletionModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <form id="activityEmployeeCompletionForm" onsubmit="event.preventDefault();
                        const taskId = document.getElementById('activityCompletionTaskId').value;
                        const employeeName = document.getElementById('activityCompletionEmployeeName').value.trim();
                        const executorName = document.getElementById('activityCompletionExecutorName').value.trim();
                        if (employeeName) {
                            activityManager.markTaskAsCompleted(taskId, employeeName, executorName);
                            activityManager.closeEmployeeCompletionModal();
                        } else {
                            NotificationManager.show('נא להזין שם עובד', 'warning');
                        }">
                        <div class="modal-body">
                            <input type="hidden" id="activityCompletionTaskId">

                            <div class="task-title-display">
                                <i class="fas fa-tasks"></i>
                                <span id="activityCompletionTaskTitle"></span>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="activityCompletionEmployeeName">
                                    <i class="fas fa-user"></i>
                                    שם העובד שסימן את המשימה:
                                </label>
                                <select id="activityCompletionEmployeeName"
                                        class="form-select"
                                        required>
                                    <option value="">בחר עובד...</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label class="form-label" for="activityCompletionExecutorName">
                                    <i class="fas fa-user-cog"></i>
                                    שם הגורם שביצע את המשימה:
                                </label>
                                <input type="text" id="activityCompletionExecutorName" class="form-input">
                                <small class="form-help">
                                    <i class="fas fa-info-circle"></i>
                                    השאר ריק אם זהה לעובד שסימן
                                </small>
                            </div>
                        </div>

                        <div class="modal-footer">
                            <div class="form-actions">
                                <button type="submit" class="btn-primary">
                                    <i class="fas fa-check"></i>
                                    אשר ביצוע
                                </button>
                                <button type="button" class="btn-secondary" onclick="activityManager.closeEmployeeCompletionModal()">
                                    <i class="fas fa-times"></i>
                                    ביטול
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            <!-- מודל ייבוא אקסל -->
            <div id="importExcelModal" class="add-task-modal">
                <div class="task-modal-content">

                    <!-- Header נקי -->
                    <div class="modal-header">
                        <h2 id="excelModalTitle">ייבוא פעילות מקובץ אקסל</h2>
                        <button class="close-btn"
                                onclick="activityManager.closeImportExcelModal()">
                            &times;
                        </button>
                    </div>

                    <div class="modal-body">

                        <!-- כפתור טמפלייטים - בתוך ה-body, מסוגנן יפה -->
                        <div class="templates-section" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 10px 14px;
                            background: linear-gradient(135deg, #f0fff4, #e8f5e9);
                            border: 1px solid #28a745;
                            border-radius: 10px;
                            margin-bottom: 16px;
                        ">
                            <div style="display:flex; align-items:center; gap:8px;
                                        color:#155724; font-size:0.9rem; font-weight:600;">
                                <i class="fas fa-file-excel" style="color:#1d6f42; font-size:1.1rem;"></i>
                                הורד טמפלייט לדוגמה
                            </div>
                            <button class="template-download-btn"
                                    onclick="activityManager.openTemplatesModal()"
                                    style="
                                        display:flex; align-items:center; gap:6px;
                                        padding:7px 14px;
                                        background:#28a745; color:white;
                                        border:none; border-radius:6px;
                                        cursor:pointer; font-size:0.85rem;
                                        transition:background 0.2s;
                                    ">
                                <i class="fas fa-download"></i> טמפלייטים
                            </button>
                        </div>

                        <!-- הוראות מתקפלות -->
                        <details class="upload-instructions-collapsible" style="margin-bottom:16px;">
                            <summary style="
                                display: flex;
                                align-items: center;
                                gap: 8px;
                                padding: 10px 14px;
                                background: linear-gradient(135deg, #e3f2fd, #f3e5f5);
                                border-radius: 8px;
                                border-right: 4px solid #667eea;
                                cursor: pointer;
                                font-weight: 600;
                                color: #320F5B;
                                list-style: none;
                                user-select: none;
                            ">
                                <i class="fas fa-info-circle" style="color:#667eea;"></i>
                                הוראות העלאה
                                <i class="fas fa-chevron-down" style="
                                    margin-right:auto; 
                                    color:#667eea; 
                                    font-size:0.8rem;
                                    transition: transform 0.3s;
                                "></i>
                            </summary>
                            
                            <div class="upload-instructions" style="
                                margin-top: 8px;
                                border-right: 4px solid #667eea;
                                padding: 12px 16px;
                                background: rgba(102,126,234,0.05);
                                border-radius: 0 0 8px 8px;
                            ">
                                <ul style="margin:0; padding-right:20px; color:#555; line-height:1.8;">
                                    <li>בחר קובץ אקסל עם רשימת משימות לפעילות</li>
                                    <li>שורה 1: שם הפעילות (תא D1)</li>
                                    <li>שורה 1: ניתן לציין מנהל פעילות בפורמט <code style="padding:1px 5px;border-radius:3px;">מנהל: שם</code> (תאים I1+J1)</li>
                                    <li>שורה 3-4: כותרות טבלה (מזוהות אוטומטית)</li>
                                    <li>שורה 5 ואילך: משימות לפי המבנה הבא:
                                        <ul style="margin-top:6px;">
                                            <li>עמודה A: יום</li>
                                            <li>עמודה B: תאריך</li>
                                            <li>עמודה C: שעה (HH:MM)</li>
                                            <li>עמודה D: תיאור המשימה</li>
                                            <li>עמודה E: גורם אחראי</li>
                                            <li>עמודה F: אחראי משנה</li>
                                            <li>עמודה G: סטטוס</li>
                                            <li>עמודה H: הערות</li>
                                            <li>תיאור - תיאור מורחב</li>
                                            <li>עדיפות - גבוה / בינוני / נמוך</li>
                                            <li>אחראי משנה - שם האחראי המשני</li>
                                            <li>מערכת - שם המערכת / הרכיב</li>
                                            <li>סביבה - סביבת הריצה</li>
                                            <li>תלות - תלויות המשימה</li>
                                            <li>משך שיבוש - זמן שיבוש משוער</li>
                                            <li>השפעה - תיאור ההשפעה</li>
                                            <li>התראות / התראה - התראות לבדיקה</li>
                                            <li>מייל נמען - כתובת TO למייל אוטומטי</li>
                                            <li>CC - כתובת CC</li>
                                            <li>נושא מייל - נושא המייל</li>
                                            <li>גוף מייל - תוכן המייל</li>

                                        </ul>
                                    </li>
                                </ul>
                            </div>
                        </details>

                        <!-- שאר תוכן המודל ללא שינוי -->
                        <div class="form-group">
                            <label class="form-label" for="excelImportDate">
                                תאריך הפעילות:
                            </label>
                            <div class="date-input-wrapper">
                                <input type="date"
                                    id="excelImportDateHidden"
                                    class="hidden-date-input">
                                <input type="text"
                                    id="excelImportDate"
                                    placeholder="DD/MM/YYYY"
                                    readonly
                                    onclick="activityManager.openExcelImportDatePicker()"
                                    class="formatted-date-input">
                                <i class="fas fa-calendar-alt date-icon"
                                    onclick="activityManager.openExcelImportDatePicker()"></i>
                                <button type="button"
                                        id="excelImportDateClear"
                                        class="time-clear-btn"
                                        onclick="activityManager.clearExcelImportDate()"
                                        title="נקה שדה תאריך"
                                        style="display: none;">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>

                        <div class="file-upload-area">
                            <input type="file"
                                id="excelFileInput"
                                accept=".xlsx,.xls,.docx,.doc"
                                onchange="activityManager.handleFileSelect(event)">

                            <label for="excelFileInput" class="file-upload-label">
                                <i class="fas fa-cloud-upload-alt"></i>
                                <span>לחץ לבחירת קובץ או גרור לכאן</span>
                                <small>קבצים נתמכים: XLSX, XLS, DOCX, DOC</small>
                            </label>
                        </div>

                        <div id="uploadActivityPreview"
                            class="upload-preview"
                            style="display: none;">
                            <div class="preview-icon">
                                <i class="fas fa-file-excel"></i>
                            </div>
                            <div class="preview-details">
                                <div class="preview-filename" id="uploadActivityFileName"></div>
                                <div class="preview-filesize" id="uploadActivityFileSize"></div>
                            </div>
                            <button class="preview-remove"
                                    onclick="activityManager.clearSelectedFile();
                                            event.stopPropagation();">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>

                    <div class="modal-footer">
                        <div class="form-actions">
                            <button type="button"
                                    class="btn btn-secondary"
                                    onclick="activityManager.closeImportExcelModal()">
                                ביטול
                            </button>
                            <button type="button"
                                    id="excelImportSubmitBtn"
                                    class="btn btn-primary"
                                    onclick="activityManager.importExcelActivity()">
                                ייבא פעילות
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- מודל טמפלייטים -->
            <div id="activityTemplatesModal" class="add-task-modal">
                <div class="task-modal-content" style="max-width: 650px;">

                    <div class="modal-header">
                        <h2>
                            <i class="fas fa-file-excel"
                            style="color:#1d6f42; margin-left:8px;"></i>
                            טמפלייטים לייבוא פעילויות
                        </h2>
                        <button class="close-btn"
                                onclick="activityManager.closeTemplatesModal()">
                            &times;
                        </button>
                    </div>

                    <div class="modal-body">

                        <!-- אזור העלאת טמפלייט חדש -->
                        <div class="template-upload-section">
                            <div class="template-upload-header">
                                <div class="template-upload-title">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    העלה טמפלייט חדש
                                </div>
                                <span class="template-upload-hint">
                                    קבצי Excel בלבד (.xlsx, .xls)
                                </span>
                            </div>

                            <!-- אזור גרירה -->
                            <div class="template-drop-zone"
                                id="templateDropZone"
                                onclick="activityManager.openUploadTemplateDialog()"
                                ondragover="event.preventDefault();
                                            this.classList.add('drag-over')"
                                ondragleave="this.classList.remove('drag-over')"
                                ondrop="
                                    event.preventDefault();
                                    this.classList.remove('drag-over');
                                    const f = event.dataTransfer.files[0];
                                    if(f) activityManager.uploadTemplate(f);
                                ">
                                <i class="fas fa-file-excel"></i>
                                <span>לחץ לבחירת קובץ או גרור לכאן</span>
                                <small>XLSX, XLS · גודל מקסימלי 10MB</small>

                                <button id="uploadTemplateBtn"
                                        class="upload-template-btn"
                                        onclick="event.stopPropagation();
                                                activityManager.openUploadTemplateDialog()">
                                    <i class="fas fa-upload"></i>
                                    העלה טמפלייט
                                </button>
                            </div>

                            <!-- שורת התקדמות -->
                            <div id="templateUploadProgress"
                                class="template-upload-progress"
                                style="display:none;">
                            </div>
                        </div>

                        <!-- קו הפרדה -->
                        <div class="templates-divider">
                            <span>טמפלייטים קיימים</span>
                        </div>

                        <!-- רשימת טמפלייטים -->
                        <div id="templatesList" class="templates-list">
                            <div class="templates-loading">
                                <i class="fas fa-spinner fa-spin"></i>
                                <span>טוען...</span>
                            </div>
                        </div>

                    </div>

                    <div class="modal-footer">
                        <div class="form-actions">
                            <button type="button"
                                    class="btn btn-secondary"
                                    onclick="activityManager.closeTemplatesModal()">
                                סגור
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ─────────────────────────────────────────────
    // טעינת תלויות (Flatpickr + ActivityManager)
    // ─────────────────────────────────────────────
    async loadDependencies() {
        // 1. טען flatpickr (ספריה חיצונית)
        await this.ensureFlatpickr();

        // 2. טען FlatpickrHelper (wrapper מקומי)
        await this.ensureFlatpickrHelper();

        // 3. וודא NotificationManager
        await this.ensureNotificationManager();

        // 4. טען ActivityManager
        await this.ensureActivityManager();
    }

    ensureFlatpickr() {
        return new Promise((resolve) => {
            if (typeof flatpickr !== 'undefined') {
                resolve();
                return;
            }

            // CSS
            if (!document.getElementById('flatpickrCss')) {
                const link = document.createElement('link');
                link.id = 'flatpickrCss';
                link.rel = 'stylesheet';
                link.href =
                    'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
                document.head.appendChild(link);
            }

            // JS
            const script = document.createElement('script');
            script.src =
                'https://cdn.jsdelivr.net/npm/flatpickr';
            script.onload = () => resolve();
            script.onerror = () => {
                console.warn('Flatpickr failed to load from CDN');
                resolve(); // ממשיכים גם בלי
            };
            document.head.appendChild(script);
        });
    }

    ensureActivityManager() {
        return new Promise((resolve) => {
            if (typeof ActivityManager !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/js/ActivityManager.js';
            script.onload = () => {
                if (typeof ActivityManager !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(() => resolve(), 200);
                }
            };
            script.onerror = () => {
                console.error('Failed to load ActivityManager.js');
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    ensurePortalCss() {
        if (document.getElementById('nocPortalCss')) {
            return;
        }

        const link = document.createElement('link');
        link.id = 'nocPortalCss';
        link.rel = 'stylesheet';
        link.href = '/css/noc-portal.css';

        document.head.appendChild(link);
    }

    ensureActivityManagerStyles() {
        if (document.getElementById('activityManagerDashboardStyles')) return;

        const style = document.createElement('style');
        style.id = 'activityManagerDashboardStyles';
        style.textContent = this.getDashboardStyles();
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────
    // סגנונות CSS
    // ─────────────────────────────────────────────
    getDashboardStyles() {
        return `
    /* ===================================================
       ACTIVITIES DASHBOARD - משתמש ב-CSS Variables של
       noc-portal.css ותומך ב-Dark/Light Mode אוטומטית
       =================================================== */

    /* ── Wrapper ── */
    .act-dashboard-wrapper {
        min-height: calc(100vh - 62px);
        display: flex;
        flex-direction: column;
        font-family: 'Almoni', Arial, sans-serif;
        direction: rtl;
        transition: background 0.3s ease, color 0.3s ease;
    }

    /* ── Toolbar ── */
    .act-dashboard-wrapper .act-dashboard-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        gap: 12px;
        flex-wrap: wrap;
        flex-shrink: 0;
        transition: background 0.3s ease, border-color 0.3s ease;
    }

    .act-dashboard-wrapper .act-toolbar-right,
    .act-dashboard-wrapper .act-toolbar-left {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    /* ── Toolbar Buttons ── */
    .act-dashboard-wrapper .act-toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.88rem;
        font-family: 'Almoni', Arial, sans-serif;
        font-weight: 600;
        transition: all 0.2s ease;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .act-toolbar-btn:hover {
        transform: translateY(-1px);
    }

    .act-dashboard-wrapper .act-btn-new-activity {
        background: linear-gradient(135deg, #667eea, #764ba2) !important;
        border-color: #667eea !important;
        color: #fff !important;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    }

    .act-dashboard-wrapper .act-btn-new-activity:hover {
        background: linear-gradient(135deg, #5a67d8, #6a3f8f) !important;
        box-shadow: 0 4px 14px rgba(102, 126, 234, 0.45) !important;
    }

    .act-dashboard-wrapper .act-btn-import-excel {
        background: linear-gradient(135deg, #1D6F42, #27AE60) !important;
        border-color: #27AE60 !important;
        color: #fff !important;
        box-shadow: 0 2px 8px rgba(29, 111, 66, 0.3);
    }

    .act-dashboard-wrapper .act-btn-import-excel:hover {
        background: linear-gradient(135deg, #27AE60, #1D6F42) !important;
        box-shadow: 0 4px 14px rgba(29, 111, 66, 0.45) !important;
    }

    .act-dashboard-wrapper .act-btn-templates {
        background: linear-gradient(135deg, #17a2b8, #138496) !important;
        border-color: #17a2b8 !important;
        color: #fff !important;
        box-shadow: 0 2px 8px rgba(23, 162, 184, 0.3);
    }

    .act-dashboard-wrapper .act-btn-templates:hover {
        background: linear-gradient(135deg, #138496, #0f6674) !important;
        box-shadow: 0 4px 14px rgba(23, 162, 184, 0.45) !important;
    }

    /* ── Search ── */
    .act-dashboard-wrapper .act-search-container {
        position: relative;
        display: flex;
        align-items: center;
    }

    .act-dashboard-wrapper .act-search-input {
        padding: 8px 36px 8px 12px;
        font-size: 0.88rem;
        width: 240px;
        outline: none;
        transition: all 0.3s ease;
        direction: rtl;
        font-family: 'Almoni', Arial, sans-serif;
    }

    .act-dashboard-wrapper .act-search-input:focus {
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    }


    .act-dashboard-wrapper .act-search-icon {
        position: absolute;
        right: 12px;
        color: #667eea;
        font-size: 0.88rem;
        pointer-events: none;
    }

    .act-dashboard-wrapper .clear-search-btn {
        position: absolute;
        left: 8px;
        background: none !important;
        border: none !important;
        cursor: pointer;
        padding: 4px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
    }

    .act-dashboard-wrapper .clear-search-btn:hover {
        color: #dc3545 !important;
    }

    /* ── Main Layout ── */
    .act-dashboard-wrapper .act-dashboard-main {
        display: flex;
        flex: 1;
        overflow: hidden;
        height: calc(100vh - 110px);
    }

    /* ── Sidebar ── */
    .act-dashboard-wrapper .act-sidebar {
        width: 270px;
        min-width: 220px;
        max-width: 320px;
        overflow-y: auto;
        height: 100%;
        min-height: 0;
        flex-shrink: 0;
        transition: background 0.3s ease, border-color 0.3s ease;
    }

    .act-dashboard-wrapper .act-sidebar::-webkit-scrollbar {
        width: 6px;
    }

    .act-dashboard-wrapper .act-sidebar::-webkit-scrollbar-thumb {
        background: #667eea;
        border-radius: 3px;
    }

    .act-dashboard-wrapper .act-tabs-container {
        padding: 10px;
    }

    /* ── Content Area ── */
    .act-dashboard-wrapper .act-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: background 0.3s ease;
    }

    /* ── Activity Header ── */
    .act-dashboard-wrapper .act-activity-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 20px;
        flex-shrink: 0;
        gap: 12px;
        transition: background 0.3s ease, border-color 0.3s ease;
    }

    .act-dashboard-wrapper .act-activity-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .act-dashboard-wrapper .act-activity-date {
        font-size: 0.85rem;
        display: flex;
        align-items: center;
        gap: 5px;
    }

    /* ── Progress Circle ── */
    .act-dashboard-wrapper .act-progress-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
    }

    .act-dashboard-wrapper .act-progress-circle {
        width: 60px;
        height: 60px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        transition: all 0.5s ease;
    }

    .act-dashboard-wrapper .act-progress-circle::before {
        content: '';
        position: absolute;
        width: 44px;
        height: 44px;
        border-radius: 50%;
    }

    .act-dashboard-wrapper .act-progress-text {
        position: relative;
        z-index: 1;
        font-size: 0.85rem;
        font-weight: bold;
    }

    .act-dashboard-wrapper .act-progress-desc {
        font-size: 0.78rem;
        text-align: center;
        white-space: nowrap;
    }

    /* ── Task Controls Row ── */
    .act-dashboard-wrapper .task-controls-row {
        padding: 10px 16px;
        flex-shrink: 0;
        transition: background 0.3s ease;
    }

    .act-dashboard-wrapper .act-task-controls {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .act-dashboard-wrapper .act-add-task-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.88rem;
        font-weight: 600;
        font-family: 'Almoni', Arial, sans-serif;
        transition: all 0.3s ease;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    }

    .act-dashboard-wrapper .act-add-task-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 14px rgba(102, 126, 234, 0.45);
    }

    .act-dashboard-wrapper .act-add-task-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }

    /* ── Tasks Container ── */
    .act-dashboard-wrapper .act-tasks-container {
        flex: 1;
        overflow-y: auto;
        padding: 16px 20px;
        min-height: 0;
        transition: background 0.3s ease;
    }

    .act-dashboard-wrapper .act-tasks-container::-webkit-scrollbar {
        width: 8px;
    }

    .act-dashboard-wrapper .act-tasks-container::-webkit-scrollbar-track {
        border-radius: 10px;
    }

    .act-dashboard-wrapper .act-tasks-container::-webkit-scrollbar-thumb {
        background: linear-gradient(135deg, #667eea, #764ba2);
        border-radius: 10px;
    }

    /* ── Activity Filters ── */
    .act-dashboard-wrapper .activity-filters {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        transition: background 0.3s ease;
    }

    .act-dashboard-wrapper .filter-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82rem;
    }

    .act-dashboard-wrapper .filter-toggle label {
        font-size: 0.82rem !important;
        font-weight: 500 !important;
        cursor: pointer;
    }

    .act-dashboard-wrapper .filter-toggle input[type="checkbox"] {
        accent-color: #667eea;
        cursor: pointer;
    }

    .act-dashboard-wrapper .sort-options {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82rem;
    }

    .act-dashboard-wrapper .sort-options label {
        font-size: 0.82rem !important;
        font-weight: 500 !important;
    }

    .act-dashboard-wrapper .sort-options select {
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 0.82rem;
        font-family: 'Almoni', Arial, sans-serif;
        cursor: pointer;
        flex: 1;
        transition: border-color 0.2s;
    }

    .act-dashboard-wrapper .sort-options select:focus {
        outline: none;
        border-color: #667eea;
    }

    /* ── Activity Buttons (hidden - moved to toolbar) ── */
    .act-dashboard-wrapper .activity-buttons {
        display: none !important;
    }

    /* ── Activity Tabs ── */
    .act-dashboard-wrapper .activity-tabs-wrapper {
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 6px 0;
    }

    .act-dashboard-wrapper .activity-tab {
        padding: 10px 12px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 6px;
    }

    .act-dashboard-wrapper .activity-tab:hover {
        border-color: #667eea;
        box-shadow: 0 3px 10px rgba(102, 126, 234, 0.15);
    }

    .act-dashboard-wrapper .activity-tab.active {
        background: linear-gradient(135deg, #667eea, #764ba2) !important;
        border-color: #667eea !important;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    }

    .act-dashboard-wrapper .activity-tab.archived {
        opacity: 0.65;
        border-style: dashed !important;
    }

    .act-dashboard-wrapper .activity-tab-content {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1;
    }

    .act-dashboard-wrapper .activity-tab-name {
        font-size: 0.9rem !important;
        font-weight: 600 !important;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .act-dashboard-wrapper .activity-tab.active .activity-tab-name {
        color: #fff !important;
    }

    .act-dashboard-wrapper .activity-tab-date {
        font-size: 0.75rem !important;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .act-dashboard-wrapper .activity-tab.active .activity-tab-date {
        color: rgba(255,255,255,0.8) !important;
    }

    .act-dashboard-wrapper .activity-tab-actions {
        display: flex;
        gap: 3px;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .act-dashboard-wrapper .activity-tab:hover .activity-tab-actions,
    .act-dashboard-wrapper .activity-tab.active .activity-tab-actions {
        opacity: 1;
    }

    .act-dashboard-wrapper .activity-tab-action {
        background: rgba(255,255,255,0.15) !important;
        border: none !important;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 4px;
        font-size: 0.78rem;
        transition: all 0.2s;
    }

    .act-dashboard-wrapper .activity-tab.active .activity-tab-action {
        color: rgba(255,255,255,0.8) !important;
    }

    .act-dashboard-wrapper .activity-tab-action:hover {
        background: rgba(255,255,255,0.25) !important;
        color: #fff !important;
    }

    .act-dashboard-wrapper .activity-tab-action.delete:hover {
        background: rgba(220,53,69,0.3) !important;
        color: #ff8080 !important;
    }

    .act-dashboard-wrapper .activity-tab-action.archive:hover {
        background: rgba(253,126,20,0.3) !important;
        color: #fd7e14 !important;
    }

    /* ── Bottom row: תאריך + כפתורים ── */
    .act-dashboard-wrapper .activity-tab-bottom-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        min-width: 0;
        margin-top: 2px;
    }

    /* ── Activity Tab Actions - מותאם לשורה התחתונה ── */
    .act-dashboard-wrapper .activity-tab-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 0.2s;
        /* *** הסר margin/position שהיה קודם *** */
        align-items: center;
    }

    .act-dashboard-wrapper .activity-tab:hover .activity-tab-actions,
    .act-dashboard-wrapper .activity-tab.active .activity-tab-actions {
        opacity: 1;
    }

    .act-dashboard-wrapper .archived-badge {
        position: absolute;
        top: -2px;
        right: 0%;
        background: #ffc107;
        color: #212529;
        font-size: 0.65rem;
        font-weight: bold;
        padding: 1px 6px;
        border-radius: 8px;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .no-activities {
        text-align: center;
        padding: 30px 10px;
        font-size: 0.9rem;
    }

    .act-dashboard-wrapper .no-activities i {
        font-size: 2.5rem;
        display: block;
        margin-bottom: 10px;
        opacity: 0.6;
    }

    .act-dashboard-wrapper .no-search-results {
        text-align: center;
        padding: 20px 10px;
        font-size: 0.88rem;
    }

    .act-dashboard-wrapper .no-search-results i {
        font-size: 1.8rem;
        display: block;
        margin-bottom: 8px;
    }

    /* ── Task Items ── */
    .act-dashboard-wrapper .tasks-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .act-dashboard-wrapper .tasks-empty {
        text-align: center;
        padding: 60px 20px;
        font-size: 1rem;
        border-radius: 12px;
    }

    .act-dashboard-wrapper .tasks-empty i {
        font-size: 3rem;
        display: block;
        margin-bottom: 15px;
        opacity: 0.5;
    }

    .act-dashboard-wrapper .task-item {
        border-radius: 10px;
        padding: 14px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        transition: all 0.2s ease;
        position: relative;
    }

    .act-dashboard-wrapper .task-item:hover {
        border-color: #667eea;
        box-shadow: 0 4px 14px rgba(102, 126, 234, 0.15);
        transform: translateY(-1px);
    }

    .act-dashboard-wrapper .task-item.completed {
        background: linear-gradient(135deg, rgba(40,167,69,0.08), rgba(40,167,69,0.04)) !important;
        border-color: #28a745 !important;
        border-right: 4px solid #28a745 !important;
    }

    .act-dashboard-wrapper .task-item.skipped {
        background: linear-gradient(135deg, rgba(255,193,7,0.08), rgba(255,193,7,0.04)) !important;
        border-color: #ffc107 !important;
        border-right: 4px solid #ffc107 !important;
    }

    .act-dashboard-wrapper .task-item.past-date {
        opacity: 0.75;
    }
        .act-dashboard-wrapper .drag-handle {
        cursor: grab;
        padding: 2px 4px;
        font-size: 0.9rem;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        transition: color 0.2s;
    }

    .act-dashboard-wrapper .drag-handle:hover {
        color: #667eea;
    }

    .act-dashboard-wrapper .task-checkbox {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: all 0.2s ease;
        margin-top: 1px;
        background: transparent;
        color: transparent;
    }

    .act-dashboard-wrapper .task-item.completed .task-checkbox {
        background: #28a745 !important;
        border-color: #28a745 !important;
        color: #fff !important;
    }

    .act-dashboard-wrapper .task-item.skipped .task-checkbox {
        background: #ffc107 !important;
        border-color: #ffc107 !important;
        color: #212529 !important;
    }

    .act-dashboard-wrapper .task-checkbox:hover {
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    }

    .act-dashboard-wrapper .task-priority {
        width: 4px;
        border-radius: 2px;
        align-self: stretch;
        flex-shrink: 0;
        min-height: 20px;
    }

    .act-dashboard-wrapper .task-priority.high   { background: #dc3545; }
    .act-dashboard-wrapper .task-priority.medium { background: #ffc107; }
    .act-dashboard-wrapper .task-priority.low    { background: #667eea; }

    .act-dashboard-wrapper .task-content {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .act-dashboard-wrapper .task-text {
        font-size: 0.95rem !important;
        font-weight: 600 !important;
        line-height: 1.4;
    }

    .act-dashboard-wrapper .task-item.completed .task-text {
        text-decoration: line-through;
    }

    .act-dashboard-wrapper .task-description {
        font-size: 0.82rem !important;
        line-height: 1.4;
    }

    .act-dashboard-wrapper .task-meta-info {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 2px;
    }

    .act-dashboard-wrapper .task-meta-item {
        font-size: 0.78rem !important;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 6px;
        transition: background 0.2s;
    }

    .act-dashboard-wrapper .task-meta-item i {
        color: #667eea !important;
        font-size: 0.75rem;
    }

    .act-dashboard-wrapper .task-meta-item strong {
        font-weight: 600;
    }

    .act-dashboard-wrapper .task-completed-by {
        font-size: 0.78rem !important;
        color: #28a745 !important;
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 2px;
        background: rgba(40,167,69,0.08);
        padding: 4px 8px;
        border-radius: 6px;
    }

    .act-dashboard-wrapper .completion-time {
        font-size: 0.75rem;
    }

    .act-dashboard-wrapper .executor-name {
        font-size: 0.75rem;
    }

    .act-dashboard-wrapper .task-notes-display {
        font-size: 0.78rem !important;
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin-top: 2px;
        background: rgba(255,193,7,0.08);
        padding: 5px 10px;
        border-radius: 6px;
        border-right: 3px solid #fbbf24;
    }

    .act-dashboard-wrapper .task-notes-display i {
        color: #fbbf24 !important;
        flex-shrink: 0;
        margin-top: 1px;
    }

    .act-dashboard-wrapper .task-notes-display span {
        line-height: 1.4;
    }

    .act-dashboard-wrapper .task-skip-reason {
        font-size: 0.78rem !important;
        color: #dc3545 !important;
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        background: rgba(220,53,69,0.08);
        padding: 4px 8px;
        border-radius: 6px;
        border-right: 3px solid #dc3545;
    }

    .act-dashboard-wrapper .task-skip-reason i {
        color: #dc3545 !important;
        flex-shrink: 0;
    }

    .act-dashboard-wrapper .task-skip-reason strong {
        color: #dc3545 !important;
    }

    /* ── Status Dropdown ── */
    .act-dashboard-wrapper .task-status-dropdown {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .act-dashboard-wrapper .status-label {
        font-size: 0.75rem !important;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .status-select {
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 0.78rem;
        cursor: pointer;
        font-family: 'Almoni', Arial, sans-serif;
        transition: border-color 0.2s;
    }

    .act-dashboard-wrapper .status-select:focus {
        outline: none;
        border-color: #667eea !important;
        box-shadow: 0 0 0 2px rgba(102,126,234,0.15);
    }

    .act-dashboard-wrapper .task-status-container {
        flex-shrink: 0;
    }

    .act-dashboard-wrapper .task-status-badge {
        font-size: 0.75rem !important;
        padding: 3px 10px;
        border-radius: 12px;
        font-weight: 600;
        white-space: nowrap;
        border: 1px solid transparent;
    }

    /* Status badge colors - Light Mode */
    .act-dashboard-wrapper .status-חדש {
        background: rgba(33,150,243,0.12);
        color: #1976D2;
        border-color: rgba(33,150,243,0.3);
    }
    .act-dashboard-wrapper .status-ממתין {
        background: rgba(255,152,0,0.12);
        color: #F57C00;
        border-color: rgba(255,152,0,0.3);
    }
    .act-dashboard-wrapper .status-בביצוע {
        background: rgba(156,39,176,0.12);
        color: #7B1FA2;
        border-color: rgba(156,39,176,0.3);
    }
    .act-dashboard-wrapper .status-בוצע {
        background: rgba(76,175,80,0.12);
        color: #388E3C;
        border-color: rgba(76,175,80,0.3);
    }
    .act-dashboard-wrapper .status-מבוטלת {
        background: rgba(244,67,54,0.12);
        color: #D32F2F;
        border-color: rgba(244,67,54,0.3);
    }

    /* ── Task Actions ── */
    .act-dashboard-wrapper .task-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
        align-items: center;
    }

    .act-dashboard-wrapper .task-action-btn.skip {
        display: none;
    }

    .act-dashboard-wrapper .task-action-btn {
        background: none !important;
        border: none !important;
        cursor: pointer;
        padding: 5px 7px;
        border-radius: 6px;
        font-size: 0.82rem;
        transition: all 0.2s;
    }


    .act-dashboard-wrapper .task-action-btn.edit:hover {
        background: rgba(23,162,184,0.12) !important;
        color: #17a2b8 !important;
    }

    .act-dashboard-wrapper .task-action-btn.delete:hover {
        background: rgba(220,53,69,0.12) !important;
        color: #dc3545 !important;
    }

    .act-dashboard-wrapper .task-action-btn.skip:hover {
        background: rgba(255,193,7,0.12) !important;
        color: #ffc107 !important;
    }

    .act-dashboard-wrapper .task-action-btn.clear-skip:hover {
        background: rgba(40,167,69,0.12) !important;
        color: #28a745 !important;
    }

    .act-dashboard-wrapper .task-action-btn.alarm-active {
        color: #fbbf24 !important;
        background: rgba(251,191,36,0.1) !important;
    }

    /* ── Archived Banner ── */
    .act-dashboard-wrapper .archived-locked {
        pointer-events: none;
    }

    .act-dashboard-wrapper .archived-banner {
        background: rgba(255,193,7,0.1);
        border: 1px solid rgba(255,193,7,0.3);
        border-right: 4px solid #ffc107;
        border-radius: 8px;
        padding: 10px 14px;
        color: #856404;
        font-size: 0.88rem;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
    }

    .act-dashboard-wrapper .archived-banner i {
        color: #ffc107;
    }

    
    .info-value {
        font-size: 0.88rem;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .alarm-icon-active {
        color: #fbbf24;
        font-size: 0.78rem;
        animation: bellRing 2s ease infinite;
    }

    .completion-info {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
    }

    .completion-info span {
        font-size: 0.88rem;
        display: flex;
        align-items: center;
        gap: 5px;
    }

    .completion-info i {
        color: #28a745;
    }

    /* ── Task View Footer ── */
    .task-view-footer {
        display: flex;
        gap: 10px;
        padding: 14px 20px;
        flex-shrink: 0;
        border-radius: 0 0 16px 16px;
    }

    .task-view-btn {
        flex: 1;
        padding: 9px 16px;
        border-radius: 8px;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s;
        font-family: 'Almoni', Arial, sans-serif;
    }

    .task-view-btn.edit-btn {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        box-shadow: 0 2px 8px rgba(102,126,234,0.3);
        display:none;
    }

    .task-view-btn.edit-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 14px rgba(102,126,234,0.45);
    }

    /* ── History ── */
    .task-history-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .task-history-empty {
        text-align: center;
        padding: 40px 20px;
        font-size: 0.9rem;
    }

    .task-history-empty i {
        font-size: 2rem;
        display: block;
        margin-bottom: 10px;
        opacity: 0.5;
    }

    .history-entry-item {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        padding-bottom: 12px;
    }

    .history-entry-item:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }

    .history-entry-icon {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }

    .history-entry-icon i {
        font-size: 0.82rem;
    }

    .history-entry-content {
        flex: 1;
        min-width: 0;
    }

    .history-entry-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
    }

    .history-action-label {
        font-size: 0.88rem;
        font-weight: 700;
    }

    .history-user {
        font-size: 0.78rem;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 10px;
    }

    .history-time {
        font-size: 0.72rem;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-right: auto;
    }

    .history-changes {
        border-radius: 6px;
        padding: 8px 10px;
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .history-change-item {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.78rem;
        flex-wrap: wrap;
    }

    .change-field {
        font-weight: 600;
        min-width: 60px;
    }

    .change-before {
        color: #dc3545;
        background: rgba(220,53,69,0.1);
        padding: 1px 6px;
        border-radius: 4px;
        text-decoration: line-through;
        font-size: 0.75rem;
    }

    .change-arrow {
        font-size: 0.68rem;
    }

    .change-after {
        color: #28a745;
        background: rgba(40,167,69,0.1);
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 0.75rem;
    }

    .history-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 0.78rem;
        background: rgba(251,191,36,0.08);
        border-radius: 6px;
        padding: 6px 10px;
        margin-top: 4px;
        border-right: 3px solid #fbbf24;
    }

    .history-note i {
        color: #fbbf24;
        flex-shrink: 0;
        margin-top: 1px;
    }

    /* ── Alarm Popup ── */
    .activity-alarm-popup {
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 30000;
        width: 330px;
        animation: actModalIn 0.3s ease;
    }

    .activity-alarm-content {
        border-top: 4px solid #f59e0b;
        border-radius: 14px;
        overflow: hidden;
        transition: background 0.3s ease;
    }

    .activity-alarm-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 14px 10px;
        background: rgba(245,158,11,0.1);
    }

    .activity-alarm-header span {
        flex: 1;
        font-size: 0.88rem;
        font-weight: 700;
        color: #92400e;
    }

    .alarm-bell-ring {
        color: #f59e0b;
        font-size: 1rem;
        animation: bellRingFull 1s ease infinite;
    }

    @keyframes bellRingFull {
        0%,100% { transform: rotate(0); }
        10%     { transform: rotate(20deg); }
        20%     { transform: rotate(-18deg); }
        30%     { transform: rotate(14deg); }
        40%     { transform: rotate(-10deg); }
        50%     { transform: rotate(6deg); }
        60%     { transform: rotate(0); }
    }

    .alarm-close-btn {
        background: rgba(0,0,0,0.08);
        border: none;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.75rem;
        transition: all 0.2s;
    }

    .alarm-close-btn:hover {
        background: rgba(220,53,69,0.15);
        color: #dc3545;
    }

    .activity-alarm-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    body {
        font-family: 'Assistant', sans-serif;
    }
    .alarm-activity-name {
        font-size: 0.78rem;
        color: #667eea;
        display: flex;
        align-items: center;
        gap: 5px;
        background: rgba(102,126,234,0.08);
        padding: 4px 8px;
        border-radius: 6px;
    }
    /* ── History Tab Content - גלילה ── */
    .task-view-tab-content#taskViewTabHistory {
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .task-view-tab-content#taskViewTabHistory .task-view-body.history-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
        max-height: 400px;
        padding: 0 !important;
    }

    .task-view-tab-content#taskViewTabHistory .task-history-list {
        padding: 14px 16px;
    }
    /* תיקון גלילה בפופאפ משימה */
    .task-view-popup {
        overflow: hidden !important;
    }

    .task-view-tab-content {
        overflow: hidden;
        min-height: 0;
    }

    .task-view-tab-content.active {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow: hidden;
    }

    .task-view-body {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }

    .history-body {
        padding: 0 !important;
        overflow-y: auto;
    }
    @keyframes bannerSlideDown {
        from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    @keyframes bannerSlideUp {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to   { opacity: 0; transform: translateX(-50%) translateY(-20px); }
    }
    .act-login-link {
        color: #a5b4fc;
        text-decoration: underline;
        cursor: pointer;
    }

    [data-theme="light"] .act-login-link {
        color: #4338ca;
    }

    /* ── Task Alerts Display ── */
    .act-dashboard-wrapper .task-alerts-display {
        font-size: 0.78rem !important;
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin-top: 2px;
        background: rgba(245,158,11,0.08);
        padding: 5px 10px;
        border-radius: 6px;
        border-right: 3px solid #f59e0b;
    }

    .act-dashboard-wrapper .task-alerts-display i {
        color: #f59e0b !important;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .act-dashboard-wrapper .task-action-btn.check-alert:hover {
        background: rgba(245,158,11,0.12) !important;
        color: #f59e0b !important;
    }
    .act-dashboard-wrapper .act-activity-manager {
        font-size: 0.82rem;
        display: flex;
        align-items: center;
        gap: 5px;
        color: #667eea;
        font-weight: 600;
    }
    
    /* ── Permissions Modal - Dark/Light Mode Support ── */
    .permissions-modal .task-modal-content {
        background: var(--card-bg, #1e2433);
        color: var(--text-primary, #e0e0e0);
    }

    .permissions-modal .modal-header {
        background: var(--card-bg, #1e2433);
        border-bottom: 1px solid var(--border-color, #2d3748);
        color: var(--text-primary, #e0e0e0);
    }

    .permissions-modal .modal-body {
        background: var(--card-bg, #1e2433);
    }

    /* סטטיסטיקה - תיבות */
    .permissions-modal .perm-stat-box {
        background: var(--input-bg, #2d3748) !important;
        border: 1px solid var(--border-color, #3d4a5c) !important;
        border-radius: 8px;
        padding: 10px 14px;
        text-align: center;
        flex: 1;
        min-width: 120px;
    }

    .permissions-modal .perm-stat-number {
        font-size: 1.4rem;
        font-weight: 800;
    }

    .permissions-modal .perm-stat-label {
        font-size: 0.75rem;
        color: var(--text-secondary, #9ca3af);
    }

    /* אזור הוספת הרשאה */
    .permissions-modal .perm-add-section {
        background: rgba(102,126,234,0.08) !important;
        border: 1px solid rgba(102,126,234,0.2) !important;
        border-radius: 10px;
        padding: 14px;
        margin-bottom: 16px;
    }

    .permissions-modal .perm-add-section h4 {
        margin: 0 0 12px;
        font-size: 0.9rem;
        color: #667eea;
    }

    /* חיפוש ו-select */
    .permissions-modal #permUserSearch,
    .permissions-modal #permUsernameSelect {
        background: var(--input-bg, #2d3748) !important;
        color: var(--text-primary, #e0e0e0) !important;
        border: 1px solid var(--border-color, #4a5568) !important;
        font-family: inherit;
    }

    .permissions-modal #permUserSearch:focus,
    .permissions-modal #permUsernameSelect:focus {
        outline: none;
        border-color: #667eea !important;
        box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
    }

    .permissions-modal #permUsernameSelect option {
        background: var(--input-bg, #2d3748);
        color: var(--text-primary, #e0e0e0);
    }

    /* פריט הרשאה */
    .permissions-modal .perm-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 6px;
        background: var(--input-bg, #2d3748) !important;
        border: 1px solid var(--border-color, #3d4a5c) !important;
        transition: all 0.2s;
    }

    .permissions-modal .perm-item-name {
        font-weight: 600;
        font-size: 0.88rem;
        color: var(--text-primary, #e0e0e0);
    }

    .permissions-modal .perm-item-meta {
        font-size: 0.72rem;
        color: var(--text-secondary, #9ca3af);
        display: flex;
        gap: 8px;
    }

    .permissions-modal .perm-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 0.85rem;
        font-weight: 700;
        flex-shrink: 0;
    }

    /* כפתור הסרה */
    .permissions-modal .perm-revoke-btn {
        background: rgba(220,53,69,0.08) !important;
        border: 1px solid rgba(220,53,69,0.25) !important;
        color: #dc3545 !important;
        border-radius: 6px;
        padding: 5px 12px;
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 600;
        transition: all 0.2s;
    }

    .permissions-modal .perm-revoke-btn:hover {
        background: rgba(220,53,69,0.2) !important;
    }

    /* רשימה ריקה */
    .permissions-modal .perm-empty {
        text-align: center;
        padding: 24px;
        background: var(--input-bg, #2d3748) !important;
        border-radius: 8px;
        border: 1px dashed var(--border-color, #4a5568) !important;
        color: var(--text-secondary, #9ca3af);
    }

    /* Light Mode overrides */
    [data-theme="light"] .permissions-modal .task-modal-content,
    [data-theme="light"] .permissions-modal .modal-body {
        background: #ffffff;
        color: #1a1a2e;
    }

    .modal-header h3 i {
        color: #163014;
    }

    [data-theme="light"] .permissions-modal .perm-stat-box {
        background: #f8f9fa !important;
        border: 1px solid #dee2e6 !important;
    }

    [data-theme="light"] .permissions-modal .perm-item {
        background: #f8f9fa !important;
        border: 1px solid #e9ecef !important;
    }

    [data-theme="light"] .permissions-modal .perm-item-name {
        color: #212529;
    }

    [data-theme="light"] .permissions-modal #permUserSearch,
    [data-theme="light"] .permissions-modal #permUsernameSelect {
        background: #ffffff !important;
        color: #212529 !important;
        border: 1px solid #ced4da !important;
    }

    [data-theme="light"] .permissions-modal .perm-empty {
        background: #f8f9fa !important;
        border: 1px dashed #dee2e6 !important;
        color: #6c757d;
    }

    /* ═══════════════════════════════════════════════
    PERMISSIONS MODAL
    ═══════════════════════════════════════════════ */

    .permissions-modal .task-modal-content {
        max-width: 600px;
        border-radius: 16px;
        overflow: hidden;
    }

    .permissions-modal .modal-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 18px 20px;
        border-bottom: none !important;
    }

    .permissions-modal .modal-header .modal-title {
        color: #fff !important;
        font-size: 0.95rem;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0;
    }

    .permissions-modal .modal-header .modal-title i {
        background: rgba(255,255,255,0.2);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 0.9rem;
    }

    .permissions-modal .modal-header .close-btn {
        background: rgba(255,255,255,0.15) !important;
        border: 1px solid rgba(255,255,255,0.3) !important;
        color: #fff !important;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1rem;
        cursor: pointer;
        transition: background 0.2s;
        line-height: 1;
        padding: 0;
    }

    .permissions-modal .modal-header .close-btn:hover {
        background: rgba(255,255,255,0.3) !important;
    }

    .permissions-modal .modal-body {
        padding: 18px 18px 20px;
        max-height: 65vh;
        overflow-y: auto;
    }

    /* Stats */
    .perm-stats-row {
        display: flex;
        gap: 10px;
        margin-bottom: 16px;
    }

    .perm-stat-card {
        flex: 1;
        border-radius: 10px;
        padding: 11px 10px;
        text-align: center;
        border: 1px solid transparent;
    }

    .perm-stat-card.blue {
        background: rgba(102,126,234,0.1);
        border-color: rgba(102,126,234,0.22);
    }

    .perm-stat-card.green {
        background: rgba(40,167,69,0.1);
        border-color: rgba(40,167,69,0.22);
    }

    .perm-stat-card.amber {
        background: rgba(245,158,11,0.1);
        border-color: rgba(245,158,11,0.22);
    }

    .perm-stat-number {
        font-size: 1.5rem;
        font-weight: 800;
        line-height: 1.1;
        margin-bottom: 3px;
    }

    .perm-mode-text {
        font-size: 0.78rem !important;
        font-weight: 700 !important;
        line-height: 1.3 !important;
    }

    .perm-stat-card.blue  .perm-stat-number { color: #667eea; }
    .perm-stat-card.green .perm-stat-number { color: #28a745; }
    .perm-stat-card.amber .perm-stat-number { color: #d97706; }

    .perm-stat-label {
        font-size: 0.7rem;
        color: var(--text-secondary, #9ca3af);
        font-weight: 500;
    }

    /* Add section */
    .perm-add-section {
        background: rgba(102,126,234,0.06);
        border: 1px solid rgba(102,126,234,0.16);
        border-radius: 11px;
        padding: 14px;
        margin-bottom: 16px;
    }

    .perm-add-title {
        font-size: 0.87rem;
        font-weight: 700;
        color: #667eea;
        margin: 0 0 11px;
        display: flex;
        align-items: center;
        gap: 7px;
    }

    .perm-search-wrapper {
        position: relative;
        margin-bottom: 9px;
    }

    .perm-search-input {
        width: 100%;
        padding: 8px 34px 8px 11px;
        border-radius: 7px;
        border: 1px solid var(--border-color, #3d4a5c);
        background: var(--input-bg, #2a3347);
        color: var(--text-primary, #e0e0e0);
        font-size: 0.86rem;
        font-family: inherit;
        box-sizing: border-box;
        transition: border-color 0.2s;
        direction: rtl;
    }

    .perm-search-input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102,126,234,0.14);
    }

    .perm-search-icon {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: #667eea;
        font-size: 0.8rem;
        pointer-events: none;
    }

    .perm-select-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
    }

    .perm-user-select {
        flex: 1;
        border-radius: 7px;
        border: 1px solid var(--border-color, #3d4a5c);
        background: var(--input-bg, #2a3347);
        color: var(--text-primary, #e0e0e0);
        font-size: 0.84rem;
        font-family: inherit;
        padding: 5px 9px;
        direction: rtl;
        transition: border-color 0.2s;
        min-height: 90px;
    }

    .perm-user-select:focus {
        outline: none;
        border-color: #667eea;
    }

    .perm-user-select option {
        background: var(--input-bg, #2a3347);
        color: var(--text-primary, #e0e0e0);
        padding: 3px;
    }

    .perm-user-select option:disabled {
        color: var(--text-secondary, #6b7280);
    }

    .perm-grant-btn {
        padding: 0 16px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.86rem;
        font-weight: 600;
        font-family: inherit;
        white-space: nowrap;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 6px;
        align-self: stretch;
        justify-content: center;
    }

    .perm-grant-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102,126,234,0.38);
    }

    .perm-hint {
        font-size: 0.72rem;
        color: var(--text-secondary, #9ca3af);
        margin: 8px 0 0;
        display: flex;
        align-items: center;
        gap: 5px;
    }

    /* Divider */
    .perm-divider {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        font-size: 0.74rem;
        font-weight: 700;
        color: var(--text-secondary, #9ca3af);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .perm-divider::before,
    .perm-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border-color, rgba(255,255,255,0.08));
    }

    /* List */
    .perm-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }

    .perm-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--card-item-bg, rgba(255,255,255,0.04));
        border: 1px solid var(--border-color, rgba(255,255,255,0.07));
        transition: all 0.2s;
    }

    .perm-item:hover {
        border-color: rgba(102,126,234,0.3);
        background: rgba(102,126,234,0.06);
    }

    .perm-item-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }

    .perm-avatar {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: linear-gradient(135deg, #667eea, #764ba2);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 0.88rem;
        font-weight: 700;
        flex-shrink: 0;
        box-shadow: 0 2px 7px rgba(102,126,234,0.28);
    }

    .perm-item-info {
        min-width: 0;
    }

    .perm-item-name {
        font-weight: 600;
        font-size: 0.88rem;
        color: var(--text-primary, #e0e0e0);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .perm-item-meta {
        font-size: 0.71rem;
        color: var(--text-secondary, #9ca3af);
        display: flex;
        gap: 7px;
        margin-top: 2px;
        flex-wrap: wrap;
        align-items: center;
    }

    .perm-badge-auto {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(245,158,11,0.12);
        color: #d97706;
        border: 1px solid rgba(245,158,11,0.25);
        border-radius: 8px;
        font-size: 0.67rem;
        font-weight: 600;
        padding: 1px 6px;
    }

    .perm-revoke-btn {
        flex-shrink: 0;
        padding: 5px 13px;
        background: rgba(220,53,69,0.08);
        border: 1px solid rgba(220,53,69,0.2);
        color: #dc3545;
        border-radius: 7px;
        cursor: pointer;
        font-size: 0.79rem;
        font-weight: 600;
        font-family: inherit;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
    }

    .perm-revoke-btn:hover {
        background: rgba(220,53,69,0.17);
        border-color: rgba(220,53,69,0.38);
    }

    /* Empty */
    .perm-empty {
        text-align: center;
        padding: 26px 18px;
        border-radius: 10px;
        background: var(--card-item-bg, rgba(255,255,255,0.03));
        border: 1.5px dashed var(--border-color, rgba(255,255,255,0.1));
    }

    .perm-empty i {
        font-size: 2rem;
        display: block;
        margin-bottom: 9px;
        color: var(--text-secondary, #9ca3af);
        opacity: 0.55;
    }

    .perm-empty p {
        margin: 0 0 5px;
        font-weight: 600;
        font-size: 0.88rem;
        color: var(--text-primary, #e0e0e0);
    }

    .perm-empty small {
        color: var(--text-secondary, #9ca3af);
        font-size: 0.76rem;
        line-height: 1.5;
    }

    /* ── Light Mode ── */
    [data-theme="light"] .permissions-modal .modal-body {
        background: #f4f6fb;
    }

    [data-theme="light"] .perm-add-section {
        background: rgba(102,126,234,0.05);
        border-color: rgba(102,126,234,0.18);
    }

    [data-theme="light"] .perm-search-input,
    [data-theme="light"] .perm-user-select {
        background: #fff;
        color: #1a1a2e;
        border-color: #d1d5db;
    }

    [data-theme="light"] .perm-user-select option {
        background: #fff;
        color: #1a1a2e;
    }

    [data-theme="light"] .perm-item {
        background: #fff;
        border-color: #e5e7eb;
    }

    [data-theme="light"] .perm-item:hover {
        border-color: rgba(102,126,234,0.35);
        background: #f5f7ff;
    }

    [data-theme="light"] .perm-item-name {
        color: #111827;
    }

    [data-theme="light"] .perm-item-meta {
        color: #6b7280;
    }

    [data-theme="light"] .perm-empty {
        background: #fff;
        border-color: #d1d5db;
    }

    [data-theme="light"] .perm-empty p {
        color: #374151;
    }

    [data-theme="light"] .perm-empty small {
        color: #6b7280;
    }

    [data-theme="light"] .perm-divider {
        color: #9ca3af;
    }

    [data-theme="light"] .perm-divider::before,
    [data-theme="light"] .perm-divider::after {
        background: #e5e7eb;
    }

    [data-theme="light"] .perm-hint {
        color: #6b7280;
    }

    [data-theme="light"] .perm-stat-label {
        color: #6b7280;
    }
    
    /* ══════════════════════════════════════════════
       EMAIL INDICATOR - אינדיקטור מייל במשימה
    ══════════════════════════════════════════════ */

    /* קונטיינר אינדיקטור */
    .act-dashboard-wrapper .task-email-indicator {
        font-size: 0.78rem !important;
        display: flex;
        align-items: center;
        gap: 6px;
        border-radius: 6px;
        width: fit-content;
    }

    /* מייל שנשלח - ירוק */
    .act-dashboard-wrapper .task-email-indicator.email-sent {
        background: rgba(40, 167, 69, 0.08);
        border: 1px solid rgba(40, 167, 69, 0.25);
        color: #28a745 !important;
    }

    .act-dashboard-wrapper .task-email-indicator.email-sent i {
        color: #28a745 !important;
    }

    /* ממתין לשליחה - כחול */
    .act-dashboard-wrapper .task-email-indicator.email-pending {
        background: rgba(102, 126, 234, 0.08);
        border: 1px solid rgba(102, 126, 234, 0.25);
        color: #667eea !important;
    }

    .act-dashboard-wrapper .task-email-indicator.email-pending i {
        color: #667eea !important;
    }

    /* כפתור שליחה מחדש */
    .act-dashboard-wrapper .resend-email-btn {
        background: none !important;
        border: none !important;
        cursor: pointer;
        padding: 2px 5px;
        border-radius: 4px;
        color: #28a745 !important;
        font-size: 0.72rem;
        transition: all 0.2s;
        margin-right: 2px;
    }

    .act-dashboard-wrapper .resend-email-btn:hover {
        background: rgba(40, 167, 69, 0.15) !important;
    }

    /* כותרת קטע מייל */
    .act-dashboard-wrapper .email-section-header {
        display: flex !important;
        align-items: center !important;
        gap: 4px;
        font-size: 0.88rem !important;
        font-weight: 700 !important;
        color: #667eea !important;
        cursor: pointer;
        padding: 8px 12px;
        background: rgba(102,126,234,0.05);
        border-radius: 8px;
        border: 1px solid rgba(102,126,234,0.15);
        margin-bottom: 0 !important;
        transition: background 0.2s;
    }

    .act-dashboard-wrapper .email-section-header:hover {
        background: rgba(102,126,234,0.1);
    }

    /* קטע הגדרות מייל */
    .act-dashboard-wrapper .email-config-section {
        border-radius: 8px;
        overflow: hidden;
    }

    /* אנימציית פתיחה */
    @keyframes emailSectionOpen {
        from { opacity: 0; transform: translateY(-6px); }
        to   { opacity: 1; transform: translateY(0);    }
    }

    #emailConfigBody {
        animation: emailSectionOpen 0.2s ease;
    }

    /* ── Light Mode ── */
    [data-theme="light"] .task-email-indicator.email-sent {
        background: #f0fdf4;
        border-color: #bbf7d0;
    }

    [data-theme="light"] .task-email-indicator.email-pending {
        background: #eff6ff;
        border-color: #bfdbfe;
    }

    /* ═══════════════════════════════════════════
    FILTER BAR - שורת סינון משימות
    ═══════════════════════════════════════════ */

    /* ── כפתור סינון ── */
    .act-dashboard-wrapper .act-filter-toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        background: rgba(102,126,234,0.1);
        border: 1px solid rgba(102,126,234,0.3);
        color: #667eea;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
        font-family: 'Almoni', Arial, sans-serif;
        transition: all 0.2s;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .act-filter-toggle-btn:hover {
        background: rgba(102,126,234,0.2);
        transform: translateY(-1px);
    }

    .act-dashboard-wrapper .act-filter-toggle-btn.active {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        border-color: #667eea;
    }

    /* ── אינדיקטור סינון פעיל ── */
    .act-dashboard-wrapper .filter-active-indicator {
        color: #f59e0b;
        font-size: 0.6rem;
        margin-right: 2px;
    }

    /* ── שורת סינון ── */
    .act-dashboard-wrapper .task-filters-bar {
        display: flex;
        align-items: center;
        gap: 12px;
        border-radius: 10px;
        flex-wrap: wrap;
        direction: rtl;
        animation: filterBarSlideDown 0.2s ease;
        border: 1px solid rgba(102,126,234,0.2);
        background: rgba(102,126,234,0.05);
        max-width: 700px;
    }

    @keyframes filterBarSlideDown {
        from { opacity: 0; transform: translateY(-8px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* ── קבוצת פילטר ── */
    .act-dashboard-wrapper .filter-group {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82rem;
    }

    .act-dashboard-wrapper .filter-group label {
        color: var(--text-secondary, #9ca3af);
        white-space: nowrap;
        font-size: 0.8rem !important;
        font-weight: 500 !important;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .act-dashboard-wrapper .filter-group label i {
        color: #667eea;
    }

    .act-dashboard-wrapper .filter-group select {
        padding: 5px 10px;
        border-radius: 7px;
        border: 1px solid var(--border-color, #3d4a5c);
        background: var(--input-bg, #2a3347);
        color: var(--text-primary, #e0e0e0);
        font-size: 0.82rem;
        cursor: pointer;
        font-family: 'Almoni', Arial, sans-serif;
        transition: border-color 0.2s;
        min-width: 90px;
        max-width: 150px;
    }

    .act-dashboard-wrapper .filter-group select:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 2px rgba(102,126,234,0.15);
    }

    /* ── כפתור ניקוי ── */
    .act-dashboard-wrapper .filter-clear-btn {
        padding: 5px 12px;
        background: rgba(220,53,69,0.08);
        border: 1px solid rgba(220,53,69,0.2);
        color: #dc3545;
        border-radius: 7px;
        cursor: pointer;
        font-size: 0.78rem;
        font-weight: 600;
        font-family: 'Almoni', Arial, sans-serif;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .filter-clear-btn:hover {
        background: rgba(220,53,69,0.15);
        border-color: rgba(220,53,69,0.35);
    }

    /* ── מונה תוצאות ── */
    .act-dashboard-wrapper .filter-results-count {
        font-size: 0.75rem;
        color: #667eea;
        font-weight: 600;
        margin-right: auto;
        background: rgba(102,126,234,0.1);
        padding: 3px 10px;
        border-radius: 10px;
        border: 1px solid rgba(102,126,234,0.2);
    }

    /* Light Mode */
    [data-theme="light"] .act-dashboard-wrapper .task-filters-bar {
        background: #f0f4ff;
        border-color: rgba(102,126,234,0.25);
    }

    [data-theme="light"] .act-dashboard-wrapper .filter-group select {
        background: #fff;
        color: #1a1a2e;
        border-color: #d1d5db;
    }

    /* ═══════════════════════════════════════════
    FILTER BAR
    ═══════════════════════════════════════════ */
    .act-dashboard-wrapper .act-filter-toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        background: rgba(102,126,234,0.1);
        border: 1px solid rgba(102,126,234,0.3);
        color: #667eea;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
        font-family: 'Almoni', Arial, sans-serif;
        transition: all 0.2s;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .act-filter-toggle-btn:hover {
        background: rgba(102,126,234,0.2);
        transform: translateY(-1px);
    }

    .act-dashboard-wrapper .act-filter-toggle-btn.active {
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: #fff;
        border-color: #667eea;
    }

    .act-dashboard-wrapper .filter-active-indicator {
        color: #f59e0b;
        font-size: 0.6rem;
        margin-right: 2px;
    }

    @keyframes filterBarSlideDown {
        from { opacity: 0; transform: translateY(-8px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .act-dashboard-wrapper .filter-group {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .act-dashboard-wrapper .filter-group label {
        color: var(--text-secondary, #9ca3af);
        white-space: nowrap;
        font-size: 0.8rem !important;
        font-weight: 500 !important;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .act-dashboard-wrapper .filter-group label i {
        color: #667eea;
    }

    .act-dashboard-wrapper .filter-group select {
        padding: 5px 10px;
        border-radius: 7px;
        border: 1px solid var(--border-color, #3d4a5c);
        background: var(--input-bg, #2a3347);
        color: var(--text-primary, #e0e0e0);
        font-size: 0.82rem;
        cursor: pointer;
        font-family: 'Almoni', Arial, sans-serif;
        transition: border-color 0.2s;
        min-width: 90px;
    }

    .act-dashboard-wrapper .filter-group select:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 2px rgba(102,126,234,0.15);
    }

    .act-dashboard-wrapper .filter-clear-btn {
        padding: 5px 12px;
        background: rgba(220,53,69,0.08);
        border: 1px solid rgba(220,53,69,0.2);
        color: #dc3545;
        border-radius: 7px;
        cursor: pointer;
        font-size: 0.78rem;
        font-weight: 600;
        font-family: 'Almoni', Arial, sans-serif;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
        white-space: nowrap;
    }

    .act-dashboard-wrapper .filter-clear-btn:hover {
        background: rgba(220,53,69,0.15);
        border-color: rgba(220,53,69,0.35);
    }

    .act-dashboard-wrapper .filter-results-count {
        font-size: 0.75rem;
        color: #667eea;
        font-weight: 600;
        margin-right: auto;
        background: rgba(102,126,234,0.1);
        padding: 3px 10px;
        border-radius: 10px;
        border: 1px solid rgba(102,126,234,0.2);
    }

    /* Light Mode */
    [data-theme="light"] .act-dashboard-wrapper .task-filters-bar {
        background: #f0f4ff;
        border-color: rgba(102,126,234,0.25);
    }

    [data-theme="light"] .act-dashboard-wrapper .filter-group select {
        background: #fff;
        color: #1a1a2e;
        border-color: #d1d5db;
    }
        
    .date-groups-controls {    
        position: fixed;
        right: 92%;
    }
    `;
    }
}