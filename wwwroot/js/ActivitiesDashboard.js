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
                                    onclick="activityManager
                                        .openAddTaskModal()"
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
                                        oninput="activityManager
                                            .searchTasks(this.value)"
                                    >
                                    <i class="fas fa-search
                                              act-search-icon"></i>
                                    <button
                                        class="clear-search-btn task-search"
                                        style="display:none"
                                        onclick="
                                            document.getElementById(
                                                'taskSearchInput').value='';
                                            activityManager.searchTasks('');
                                            this.style.display='none';
                                        "
                                    >
                                        <i class="fas fa-times"></i>
                                    </button>
                                </div>
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
                        <button class="close-btn" onclick="activityManager.closeAddActivityModal()">&times;</button>
                    </div>
                    <form id="activityForm" onsubmit="event.preventDefault();
                        const formData = {
                            id: document.getElementById('activityId').value,
                            name: document.getElementById('activityName').value,
                            description: document.getElementById('activityDescription').value
                        };
                        activityManager.saveActivity(formData, !!formData.id);">

                        <input type="hidden" id="activityId">

                        <div class="form-group">
                            <label class="form-label" for="activityName">שם הפעילות *</label>
                            <input type="text" id="activityName" class="form-input" required>
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="activityDescription">תיאור</label>
                            <textarea id="activityDescription" class="form-textarea" rows="3"></textarea>
                        </div>

                        <div class="form-group">
                        <label class="form-label" for="activityDateInput">תאריך הפעילות *</label>
                        <div class="date-input-wrapper">
                            <input type="date" id="activityDateInputHidden" class="hidden-date-input"
                                onchange="activityManager.handleActivityDateChange(this.value)">
                            <input type="text" id="activityDateInput" placeholder="DD/MM/YYYY" readonly
                                onclick="activityManager.openActivityDatePicker()" class="formatted-date-input">
                            <i class="fas fa-calendar-alt date-icon" onclick="activityManager.openActivityDatePicker()"></i>
                        </div>
                    </div>

                        <div class="form-actions">
                            <button type="button" class="btn-secondary" onclick="activityManager.closeAddActivityModal()">ביטול</button>
                            <button type="submit" class="btn-primary" id="activitySubmitBtn">צור פעילות</button>
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
                                notes: document.getElementById('activityTaskNotes').value || null
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
                                <ul style="margin:0; padding-right:20px; color:#555;">
                                    <li>בחר קובץ אקסל עם רשימת משימות לפעילות</li>
                                    <li>שורה 1: שם הפעילות (תא D1)</li>
                                    <li>שורה 3-4: כותרות טבלה</li>
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
        padding: 14px 20px;
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
        transform: translateX(-2px);
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
        display:none;
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

    .act-dashboard-wrapper .task-action-btn {
        background: none !important;
        border: none !important;
        cursor: pointer;
        padding: 5px 7px;
        border-radius: 6px;
        font-size: 0.82rem;
        transition: all 0.2s;
        display:none;
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

    `;
    }
}