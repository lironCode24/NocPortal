// ChangesDashboard.js
class ChangesDashboard {
    constructor(containerId, currentUser) {
        this.containerId = containerId;
        this.container = null;
        this.currentUser = currentUser;

        // נתונים
        this.allChanges = [];
        this.filteredChanges = [];
        this.isLoading = false;

        // תצוגה
        this.viewMode = 'calendar'; // calendar | week | day | table | cab
        this.calendarMonth = new Date().getMonth(); // 0-11
        this.calendarYear = new Date().getFullYear();
        this.weekStartDate = this._getWeekStart(new Date());
        this.dayDate = new Date();

        // מצב CAB
        this.cabMode = false;
        this.cabChanges = [];
        this.cabCurrentIndex = 0;
        this.cabDateRange = null;
        this.cabNavDirection = 'next'; // 'next' | 'prev'

        // סינונים
        this.filters = {
            search: '',
            status: '',
            system: '',
            company: '',
            category: '',
            team: '',
            needCab: false,
            cabDate: '',
            dateFrom: '',
            dateTo: ''
        };

        // רענון אוטומטי
        this.refreshInterval = null;
        this.REFRESH_MS = 5 * 60 * 1000;

        this.tableSort = { column: 'date', direction: 'asc' };
        this.tablePage = 1;
        this.tablePageSize = 20;

        // החלטות CAB
        this.cabDecisions = {};        // { changeNumber: { status, notes, timestamp, weekKey } }
        this.cabWeekKey = '';          // מפתח שבוע נוכחי: "2025-W23"
        this.cabSummaryMode = false;   // האם מצב סיכום פעיל

        this.REFRESH_API_URL =
            'https://prod-api-cloudbeat.menora.co.il/cases/api/case/3863' +
            '/run?apiKey=54ae6a3c-c475-48f1-a50d-b200ea335fa5';
        this._refreshPending = false;
        this._postRefreshTimeout = null;
    }

    // -------------------------------------------------------
    // אתחול
    // -------------------------------------------------------
    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        this.renderLayout();
        this.addStyles();
        this.setupEventListeners();
        this.cabDecisions = {};

        // *** הוסף: סמן שהדף נטען לראשונה בסשן זה ***
        this._cabSessionStarted = !sessionStorage.getItem('cab_session_started');

        this._setCabBtnLoading(true);

        await Promise.all([
            this.loadAllChanges(),
            this.loadCabDateRange(),
            this.loadCabDecisions().then(d => { this.cabDecisions = d; })
        ]);

        this._setCabBtnLoading(false);

        if (this.viewMode === 'cab') {
            this.enterCabMode();
        }

        this.startAutoRefresh();
    }

    // -------------------------------------------------------
    // רענון חיצוני מאחורי הקלעים
    // -------------------------------------------------------
    async triggerExternalRefresh() {
        if (this._refreshPending) {
            this._showColOrderSaveIndicator('רענון כבר בתהליך...');
            return;
        }

        try {
            // הצג אינדיקטור טעינה
            const btn = document.getElementById('cdSummaryRefreshBtn');
            if (btn) {
                btn.disabled = true;
                const icon = btn.querySelector('i');
                if (icon) icon.className = 'fas fa-spinner fa-spin';
            }

            // קריאה לשרת לבדוק מה הזמן האחרון
            let fromMs = Date.now() - 2 * 60 * 60 * 1000; // ברירת מחדל: שעתיים אחורה
            try {
                const res = await fetch('/Changes/CheckIfRefreshNeeded');
                const data = await res.json();
                if (data.lastFileTime) {
                    fromMs = new Date(data.lastFileTime).getTime();
                }
            } catch { /* המשך עם ברירת המחדל */ }

            const triggerUrl = this.REFRESH_API_URL + `&var-time=${fromMs}`;

            // קריאה מאחורי הקלעים - לא מחכים לתשובה
            fetch(triggerUrl, { mode: 'no-cors' }).catch(() => { });

            this._refreshPending = true;
            this._showColOrderSaveIndicator('בקשת רענון נשלחה ✓');

            // שחזר כפתור
            if (btn) {
                btn.disabled = false;
                const icon = btn.querySelector('i');
                if (icon) icon.className = 'fas fa-sync-alt';
            }

            // אחרי 10 דקות - רענן נתונים ואפס דגל
            if (this._postRefreshTimeout) clearTimeout(this._postRefreshTimeout);
            this._postRefreshTimeout = setTimeout(async () => {
                this._refreshPending = false;
                await this.loadAllChanges();
                await this.loadCabDateRange();
                const decisions = await this.loadCabDecisions();
                this.cabDecisions = decisions;
                if (this.cabSummaryMode) {
                    this.showCabSummary();
                }
                this._showColOrderSaveIndicator('נתונים עודכנו ✓');
            }, 10 * 60 * 1000);

        } catch (err) {
            this._showErrorIndicator('שגיאה בשליחת בקשת רענון');

            // שחזר כפתור במקרה שגיאה
            const btn = document.getElementById('cdSummaryRefreshBtn');
            if (btn) {
                btn.disabled = false;
                const icon = btn.querySelector('i');
                if (icon) icon.className = 'fas fa-sync-alt';
            }
            this._refreshPending = false;
        }
    }

    // -------------------------------------------------------
    // נעילת/שחרור כפתור CAB בזמן טעינה
    // -------------------------------------------------------
    _setCabBtnLoading(isLoading) {
        this.isLoading = isLoading;

        const cabBtn = this.container.querySelector('[data-view="cab"]');
        if (!cabBtn) return;

        if (isLoading) {
            cabBtn.disabled = true;
            cabBtn.setAttribute('title', 'טוען נתונים...');
            cabBtn.style.opacity = '0.5';
            cabBtn.style.cursor = 'not-allowed';
            cabBtn.style.pointerEvents = 'none';

            // הוסף אייקון טעינה
            const icon = cabBtn.querySelector('i');
            if (icon) {
                icon.setAttribute('data-original-class', icon.className);
                icon.className = 'fas fa-spinner fa-spin';
            }
        } else {
            cabBtn.disabled = false;
            cabBtn.setAttribute('title', 'מצב CAB');
            cabBtn.style.opacity = '';
            cabBtn.style.cursor = '';
            cabBtn.style.pointerEvents = '';

            // שחזר אייקון מקורי
            const icon = cabBtn.querySelector('i');
            if (icon && icon.getAttribute('data-original-class')) {
                icon.className = icon.getAttribute('data-original-class');
                icon.removeAttribute('data-original-class');
            }
        }
    }

    // -------------------------------------------------------
    // טעינת כל השינויים
    // -------------------------------------------------------
    async loadAllChanges() {
        try {
            this.showLoading(true);
            const res = await fetch('/Changes/GetChanges?page=1&pageSize=9999');
            const data = await res.json();
            this.showLoading(false);

            if (!data.success) {
                this.showError('שגיאה בטעינת שינויים: ' + data.message);
                return;
            }

            this.allChanges = data.changes || [];
            this.applyFilters();

            // אם מצב CAB פעיל - רענן אותו עם הנתונים החדשים
            if (this.cabMode) {
                this.enterCabMode();
            } else {
                this.render();
            }

        } catch (err) {
            this.showLoading(false);
            this.showError('שגיאת תקשורת: ' + err.message);
        }
    }

    // -------------------------------------------------------
    // טעינת טווח CAB
    // -------------------------------------------------------
    async loadCabDateRange() {
        try {
            const res = await fetch('/Changes/GetCabDateRange');
            const data = await res.json();
            if (data.success) {
                this.cabDateRange = data;
            }
        } catch (err) {
            console.warn('Could not load CAB date range:', err);
            this._showErrorIndicator('Could not load CAB date range');
        }
    }

    // -------------------------------------------------------
    // יצירת מבנה HTML ראשי
    // -------------------------------------------------------
    renderLayout() {
        this.container.innerHTML = `
        <div class="cd-wrapper">

            <!-- כותרת ובקרות עליונות -->
            <div class="cd-header">
                <div class="cd-header-right">
                    <h2 class="cd-title">
                        <i class="fas fa-calendar-alt"></i>
                        שינויים מתוכננים
                    </h2>
                    <button class="cd-start-cab-btn" id="cdStartCabBtn" style="display:none">
                        <i class="fas fa-play-circle"></i>
                        <span>התחל CAB</span>
                    </button>
                </div>
                <div class="cd-header-left">
                    <!-- כפתורי תצוגה -->
                    <div class="cd-view-btns">
                        <button class="cd-view-btn active" data-view="calendar"
                            title="תצוגת חודש">
                            <i class="fas fa-calendar-alt"></i>
                            <span>חודש</span>
                        </button>
                        <button class="cd-view-btn" data-view="week"
                            title="תצוגת שבוע">
                            <i class="fas fa-calendar-week"></i>
                            <span>שבוע</span>
                        </button>
                        <button class="cd-view-btn" data-view="day"
                            title="תצוגת יום">
                            <i class="fas fa-calendar-day"></i>
                            <span>יום</span>
                        </button>
                        <button class="cd-view-btn" data-view="table"
                            title="תצוגת טבלה">
                            <i class="fas fa-table"></i>
                            <span>טבלה</span>
                        </button>
                        <button class="cd-view-btn cd-cab-btn" data-view="cab"
                            title="מצב CAB">
                            <i class="fas fa-users"></i>
                            <span>CAB</span>
                        </button>
                        <button class="cd-view-btn cd-start-cab-btn" id="cdStartCabBtn"
                            title="התחל ישיבת CAB" style="display:none">
                            <i class="fas fa-play-circle"></i>
                            <span>התחל CAB</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- פס סינון -->
            <div class="cd-filter-bar" id="cdFilterBar">
                <div class="cd-filter-row">
                    <!-- חיפוש חופשי -->
                    <div class="cd-search-wrap">
                        <i class="fas fa-search"></i>
                        <input type="text" id="cdSearchInput"
                            placeholder="חיפוש לפי מספר, שם, מערכת..."
                            class="cd-search-input" />
                        <button class="cd-clear-search" id="cdClearSearch"
                            style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <span class="cd-filter-label">
                        <i class="fas fa-calendar"></i> טווח תאריכים:
                    </span>
                    <div class="cd-date-wrap">
                        <input type="text" id="cdDateFromDisplay" class="cd-date-input"
                            placeholder="dd/mm/yyyy" maxlength="10" readonly
                            title="מתאריך" />
                        <input type="date" id="cdDateFrom" class="cd-date-hidden" />
                    </div>
                    <span class="cd-date-sep">—</span>
                    <div class="cd-date-wrap">
                        <input type="text" id="cdDateToDisplay" class="cd-date-input"
                            placeholder="dd/mm/yyyy" maxlength="10" readonly
                            title="עד תאריך" />
                        <input type="date" id="cdDateTo" class="cd-date-hidden" />
                    </div>

                    <!-- כפתור CAB קרוב -->
                    <button class="cd-cab-range-btn" id="cdCabRangeBtn">
                        <i class="fas fa-calendar-week"></i>
                        CAB קרוב
                    </button>

                    <!-- אינדיקטור סינון פעיל -->
                    <div class="cd-active-filters" id="cdActiveFilters"
                        style="display:none">
                        <i class="fas fa-filter"></i>
                        <span id="cdActiveFiltersText"></span>
                    </div>

                    <!-- סינון לפי צוות -->
                    <select class="cd-filter-select" id="cdTeamFilter">
                        <option value="">כל הצוותים</option>
                    </select>

                    <!-- כפתור ניקוי סינונים -->
                    <button class="cd-clear-filters-btn" id="cdClearFilters">
                        <i class="fas fa-filter-circle-xmark"></i>
                        נקה סינונים
                    </button>

                    <button class="cd-prepare-cab-btn" id="cdPrepareCabBtn"
                        title="הכן קובץ Excel לישיבת CAB">
                        <i class="fas fa-file-excel"></i>
                        הכן CAB
                    </button>

                    <button class="cd-global-refresh-btn" id="cdGlobalRefreshBtn"
                        title="רענן נתונים מהשרת">
                        <i class="fas fa-sync-alt"></i>
                        רענן
                    </button>
                </div>
            </div>

            <!-- אזור תוכן ראשי -->
            <div class="cd-content" id="cdContent">
                <div class="cd-loading" id="cdLoading" style="display:none">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>טוען שינויים...</span>
                </div>
            </div>

            <!-- פופאפ פרטי שינוי -->
            <div class="cd-popup-overlay" id="cdPopupOverlay"
                style="display:none"></div>
            <div class="cd-popup" id="cdPopup" style="display:none"></div>

        </div>
        `;
    }

    // המרת תאריך מ-yyyy-mm-dd ל-dd/mm/yyyy
    toDisplayDate(str) {
        if (!str) return '';
        const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return str;
    }

    // המרת תאריך מ-dd/mm/yyyy ל-yyyy-mm-dd (לשדות input type=date)
    toInputDate(str) {
        if (!str) return '';
        const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) return `${m[3]}-${m[2]}-${m[1]}`;
        return str;
    }

    // -------------------------------------------------------
    // הגדרת מאזיני אירועים
    // -------------------------------------------------------
    setupEventListeners() {
        // כפתורי תצוגה
        this.container.querySelectorAll('.cd-view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.getAttribute('data-view');
                this.switchView(view);
            });
        });

        // חיפוש
        const searchInput = document.getElementById('cdSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.filters.search = searchInput.value.trim();
                const clearBtn = document.getElementById('cdClearSearch');
                if (clearBtn) {
                    clearBtn.style.display =
                        this.filters.search ? 'flex' : 'none';
                }
                this.applyFilters();
                this.render();
            });
        }

        const clearSearch = document.getElementById('cdClearSearch');
        if (clearSearch) {
            clearSearch.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                this.filters.search = '';
                clearSearch.style.display = 'none';
                this.applyFilters();
                this.render();
            });
        }

        // Need CAB checkbox
        const needCabFilter = document.getElementById('cdNeedCabFilter');
        if (needCabFilter) {
            needCabFilter.addEventListener('change', () => {
                this.filters.needCab = needCabFilter.checked;
                this.applyFilters();
                this.render();
            });
        }

        // סינון סטטוס
        const statusFilter = document.getElementById('cdStatusFilter');
        if (statusFilter) {
            statusFilter.addEventListener('change', () => {
                this.filters.status = statusFilter.value;
                this.applyFilters();
                this.render();
            });
        }

        // סינון מערכת
        const systemFilter = document.getElementById('cdSystemFilter');
        if (systemFilter) {
            systemFilter.addEventListener('change', () => {
                this.filters.system = systemFilter.value;
                this.applyFilters();
                this.render();
            });
        }

        // סינון חברה
        const companyFilter = document.getElementById('cdCompanyFilter');
        if (companyFilter) {
            companyFilter.addEventListener('change', () => {
                this.filters.company = companyFilter.value;
                this.applyFilters();
                this.render();
            });
        }

        // סינון קטגוריה
        const categoryFilter = document.getElementById('cdCategoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', () => {
                this.filters.category = categoryFilter.value;
                this.applyFilters();
                this.render();
            });
        }

        // סינון צוות
        const teamFilter = document.getElementById('cdTeamFilter');
        if (teamFilter) {
            teamFilter.addEventListener('change', () => {
                this.filters.team = teamFilter.value;
                this.applyFilters();
                this.render();
            });
        }

        // ניקוי סינונים
        const clearFilters = document.getElementById('cdClearFilters');
        if (clearFilters) {
            clearFilters.addEventListener('click', () => this.clearAllFilters());
        }

        // תאריכים
        const dateFrom = document.getElementById('cdDateFrom');
        const dateFromDisplay = document.getElementById('cdDateFromDisplay');
        const dateTo = document.getElementById('cdDateTo');
        const dateToDisplay = document.getElementById('cdDateToDisplay');

        // קליק על שדה התצוגה פותח את הפיקר הנסתר
        if (dateFromDisplay) {
            dateFromDisplay.addEventListener('click', () => {
                dateFrom?.showPicker?.();
                dateFrom?.click();
            });
        }
        if (dateToDisplay) {
            dateToDisplay.addEventListener('click', () => {
                dateTo?.showPicker?.();
                dateTo?.click();
            });
        }

        // שינוי בפיקר - עדכון שדה התצוגה
        if (dateFrom) {
            dateFrom.addEventListener('change', () => {
                const display = this.toDisplayDate(dateFrom.value);
                if (dateFromDisplay) dateFromDisplay.value = display;
                this.filters.dateFrom = dateFrom.value;
                this.applyFilters();
                this.render();
            });
        }
        if (dateTo) {
            dateTo.addEventListener('change', () => {
                const display = this.toDisplayDate(dateTo.value);
                if (dateToDisplay) dateToDisplay.value = display;
                this.filters.dateTo = dateTo.value;
                this.applyFilters();
                this.render();
            });
        }

        // כפתור CAB קרוב
        const cabRangeBtn = document.getElementById('cdCabRangeBtn');
        if (cabRangeBtn) {
            cabRangeBtn.addEventListener('click', () => {
                this.applyCabDateRange();
            });
        }

        // CAB ניווט
        const cabPrev = document.getElementById('cdCabPrev');
        const cabNext = document.getElementById('cdCabNext');
        const cabExit = document.getElementById('cdCabExit');

        if (cabPrev) {
            cabPrev.addEventListener('click', () => this.cabNavigate(-1));
        }
        if (cabNext) {
            cabNext.addEventListener('click', () => this.cabNavigate(1));
        }
        if (cabExit) {
            cabExit.addEventListener('click', () => this.exitCabMode());
        }

        // סגירת פופאפ
        const overlay = document.getElementById('cdPopupOverlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.closePopup());
        }

        // מקלדת
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closePopup();
            if (this.cabMode) {
                // *** תיקון: בדוק שאין פופאפ פתוח לפני ניווט ***
                const popupVisible = document.getElementById('cdPopup')?.style.display !== 'none';
                const decisionModalVisible = !!document.getElementById('cdCabDecisionModal');
                const calendarModalVisible = !!document.getElementById('cdCalendarChoiceModal');

                if (!popupVisible && !decisionModalVisible && !calendarModalVisible) {
                    if (e.key === 'ArrowLeft') this.cabNavigate(1);
                    if (e.key === 'ArrowRight') this.cabNavigate(-1);
                }
            }
        });

        const prepareCabBtn = document.getElementById('cdPrepareCabBtn');
        if (prepareCabBtn) {
            prepareCabBtn.addEventListener('click', async () => {
                try {
                    prepareCabBtn.disabled = true;

                    const icon = prepareCabBtn.querySelector('i');
                    if (icon) {
                        icon.className = 'fas fa-spinner fa-spin';
                    }

                    const manager = await this.ensureChangesManagerLoaded();

                    if (!manager) {
                        throw new Error('ChangesManager לא נטען');
                    }

                    await manager.buildAndDownloadExcel('cab');

                } catch (err) {
                    console.error('[CAB Export]', err);
                    this._showErrorIndicator(
                        'שגיאה בהכנת קובץ CAB: ' + err.message
                    );
                } finally {
                    prepareCabBtn.disabled = false;

                    const icon = prepareCabBtn.querySelector('i');
                    if (icon) {
                        icon.className = 'fas fa-file-excel';
                    }
                }
            });
        }

        const globalRefreshBtn = document.getElementById('cdGlobalRefreshBtn');
        if (globalRefreshBtn) {
            globalRefreshBtn.addEventListener('click', async () => {
                // עדכן אייקון לספינר
                const icon = globalRefreshBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-spinner fa-spin';
                globalRefreshBtn.disabled = true;

                try {
                    await this.triggerExternalRefresh();
                } finally {
                    // שחזר אייקון
                    setTimeout(() => {
                        if (icon) icon.className = 'fas fa-sync-alt';
                        globalRefreshBtn.disabled = false;
                    }, 5 * 60 * 1000);
                }
            });
        }

        const startCabBtn = document.getElementById('cdStartCabBtn');
        if (startCabBtn) {
            startCabBtn.addEventListener('click', () => {
                // הסתר את הכפתור מיד
                startCabBtn.style.display = 'none';
                // פתח פופאפ ברכה
                this.showCabWelcomePopup();
            });
        }
    }

    showCabWelcomePopup() {
        document.getElementById('cdCabWelcomePopup')?.remove();

        const now = new Date();
        const dateStr = now.toLocaleDateString('he-IL', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });

        // שעה נוכחית
        const timeStr = now.toLocaleTimeString('he-IL', {
            hour: '2-digit',
            minute: '2-digit'
        });

        // חישוב שבוע CAB
        const sun = new Date(now);
        sun.setDate(now.getDate() - now.getDay());
        const sat = new Date(sun);
        sat.setDate(sun.getDate() + 6);
        const fmtD = d =>
            `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const weekLabel = `${fmtD(sun)} — ${fmtD(sat)}`;

        const popupHtml = `
<div id="cdCabWelcomePopup" style="
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.82);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    direction: rtl;
    backdrop-filter: blur(8px);
">
    <!-- הכרטיס הראשי -->
    <div style="
        width: min(85vw, 700px);
        height: min(75vh, 520px);
        background: #111827;
        border: 1px solid #374151;
        border-radius: 24px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow:
            0 40px 100px rgba(0,0,0,0.7),
            0 0 0 1px rgba(124,58,237,0.15);
        animation: cdCabWelcomeIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
    ">

        <!-- אזור עליון - גרדיאנט סגול -->
        <div style="
            flex: 1;
            background: linear-gradient(160deg,
                #0f0720 0%,
                #1a0a3a 25%,
                #320F5B 55%,
                #4c1d95 80%,
                #6d28d9 100%
            );
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 20px;
            padding: 40px 48px;
            position: relative;
            overflow: hidden;
        ">
            <!-- עיגולים דקורטיביים ברקע -->
            <div style="
                position: absolute;
                top: -80px; right: -80px;
                width: 300px; height: 300px;
                background: radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 70%);
                border-radius: 50%;
                pointer-events: none;
            "></div>
            <div style="
                position: absolute;
                bottom: -60px; left: -60px;
                width: 250px; height: 250px;
                background: radial-gradient(circle, rgba(167,139,250,0.12) 0%, transparent 70%);
                border-radius: 50%;
                pointer-events: none;
            "></div>
            <div style="
                position: absolute;
                top: 30%; left: 10%;
                width: 6px; height: 6px;
                background: rgba(167,139,250,0.5);
                border-radius: 50%;
            "></div>
            <div style="
                position: absolute;
                top: 20%; right: 15%;
                width: 4px; height: 4px;
                background: rgba(196,181,253,0.4);
                border-radius: 50%;
            "></div>
            <div style="
                position: absolute;
                bottom: 25%; left: 20%;
                width: 5px; height: 5px;
                background: rgba(139,92,246,0.5);
                border-radius: 50%;
            "></div>

            <!-- אמוג'י שמש -->
            <div style="
                font-size: 5rem;
                line-height: 1;
                filter: drop-shadow(0 8px 24px rgba(251,191,36,0.4));
                position: relative;
                z-index: 1;
            ">☀️</div>

            <!-- כותרת ראשית -->
            <div style="
                text-align: center;
                position: relative;
                z-index: 1;
            ">
                <h1 style="
                    margin: 0 0 10px 0;
                    font-size: 3.5rem;
                    font-weight: 900;
                    color: #ffffff;
                    letter-spacing: -0.5px;
                    line-height: 1.1;
                    text-shadow: 0 2px 20px rgba(0,0,0,0.3);
                ">בוקר טוב, כבר מתחילים!</h1>

                <p style="
                    margin: 0;
                    font-size: 1.1rem;
                    color: rgba(196,181,253,0.85);
                    font-weight: 500;
                    letter-spacing: 0.2px;
                ">${dateStr}</p>
            </div>
        </div>

        <!-- אזור תחתון - כפתור -->
        <div style="
            background: #1f2937;
            border-top: 1px solid #374151;
            padding: 24px 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            flex-shrink: 0;
        ">
            <button id="cdCabWelcomeClose" style="
                flex: 1;
                max-width: 320px;
                padding: 16px 32px;
                background: linear-gradient(135deg, #4c1d95, #7c3aed, #8b5cf6);
                border: none;
                border-radius: 14px;
                color: #fff;
                font-size: 1.1rem;
                font-weight: 800;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                letter-spacing: 0.3px;
                box-shadow:
                    0 4px 20px rgba(124,58,237,0.5),
                    inset 0 1px 0 rgba(255,255,255,0.15);
                transition: all 0.2s;
                position: relative;
                overflow: hidden;
            "
            onmouseover="
                this.style.transform='translateY(-2px)';
                this.style.boxShadow='0 8px 28px rgba(124,58,237,0.65), inset 0 1px 0 rgba(255,255,255,0.2)';
                this.style.background='linear-gradient(135deg,#5b21b6,#8b5cf6,#a78bfa)';
            "
            onmouseout="
                this.style.transform='';
                this.style.boxShadow='0 4px 20px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)';
                this.style.background='linear-gradient(135deg,#4c1d95,#7c3aed,#8b5cf6)';
            "
            >
                <i class="fas fa-gavel" style="font-size:1rem;"></i>
                יאללה, מתחילים!
            </button>
        </div>

    </div>
</div>

<style>
@keyframes cdCabWelcomeIn {
    from {
        opacity: 0;
        transform: scale(0.88) translateY(20px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}
</style>`;

        document.body.insertAdjacentHTML('beforeend', popupHtml);

        // סגירה בלחיצה על הכפתור
        document.getElementById('cdCabWelcomeClose')
            ?.addEventListener('click', () => {
                document.getElementById('cdCabWelcomePopup')?.remove();
            });

        // סגירה בלחיצה על ה-overlay
        document.getElementById('cdCabWelcomePopup')
            ?.addEventListener('click', (e) => {
                if (e.target.id === 'cdCabWelcomePopup') {
                    document.getElementById('cdCabWelcomePopup')?.remove();
                }
            });

        // סגירה ב-Escape
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                document.getElementById('cdCabWelcomePopup')?.remove();
                document.removeEventListener('keydown', onEsc);
            }
        };
        document.addEventListener('keydown', onEsc);
    }

    async ensureChangesManagerLoaded() {
        // שלב 1: בדוק אם changesManager קיים כמשתנה גלובלי
        if (typeof changesManager !== 'undefined') {
            // השתמש ב-instance הגלובלי הקיים
            window.changesManager = changesManager;
            return window.changesManager;
        }

        // שלב 2: בדוק אם כבר קיים על window
        if (window.changesManager) {
            return window.changesManager;
        }

        // שלב 3: בדוק אם הקלאס קיים אבל instance לא נוצר
        if (typeof ChangesManager !== 'undefined') {
            window.changesManager = new ChangesManager();
            return window.changesManager;
        }

        // שלב 4: טען את הסקריפט דינמית
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/ChangesManager.js';
            script.onload = () => {
                // ChangesManager.js יצור את changesManager אוטומטית
                window.changesManager = changesManager;
                resolve(window.changesManager);
            };
            script.onerror = () => reject(
                new Error('Failed to load ChangesManager')
            );
            document.head.appendChild(script);
        });
    }

    showCabWelcomeModal() {
        document.getElementById('cdCabWelcomeModal')?.remove();

        const weekDecisions = this.getCurrentWeekDecisions();
        const decidedCount = Object.keys(weekDecisions).length;
        const totalCount = this.cabChanges.length;
        const undecidedCount = totalCount - decidedCount;

        // חישוב תאריך ושעה
        const now = new Date();
        const timeStr = now.toLocaleTimeString('he-IL', {
            hour: '2-digit', minute: '2-digit'
        });
        const dateStr = now.toLocaleDateString('he-IL', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        });

        // חישוב שבוע CAB
        const sun = new Date(now);
        sun.setDate(now.getDate() - now.getDay());
        const sat = new Date(sun);
        sat.setDate(sun.getDate() + 7);
        const fmtD = d =>
            `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const weekLabel = `${fmtD(sun)} — ${fmtD(sat)}`;

        // בדוק אם יש החלטות קודמות
        const hasPrevDecisions = decidedCount > 0;

        const modalHtml = `
    <div id="cdCabWelcomeModal" style="
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.82);
        z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        direction: rtl;
        backdrop-filter: blur(8px);
        animation: cdFadeIn 0.3s ease;
    ">
        <div style="
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 20px;
            width: 92%; max-width: 560px;
            box-shadow: 0 30px 80px rgba(0,0,0,0.7),
                        0 0 0 1px rgba(124,58,237,0.2);
            overflow: hidden;
            animation: cdPopupIn 0.35s cubic-bezier(0.34,1.56,0.64,1);
            direction: rtl;
        ">
            <!-- כותרת גרדיאנט -->
            <div style="
                background: linear-gradient(135deg, #1a1030, #320F5B, #4c1d95, #7c3aed);
                padding: 32px 28px 28px;
                text-align: center;
                position: relative;
                overflow: hidden;
            ">
                <!-- עיגולים דקורטיביים -->
                <div style="
                    position: absolute; top: -40px; right: -40px;
                    width: 160px; height: 160px;
                    background: rgba(255,255,255,0.04);
                    border-radius: 50%;
                    pointer-events: none;
                "></div>
                <div style="
                    position: absolute; bottom: -30px; left: -30px;
                    width: 120px; height: 120px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 50%;
                    pointer-events: none;
                "></div>

                <!-- אמוג'י ברכה -->
                <div style="
                    font-size: 3.5rem;
                    margin-bottom: 12px;
                    animation: cdBounceIn 0.6s cubic-bezier(0.34,1.56,0.64,1) 0.2s both;
                    display: block;
                    line-height: 1;
                ">☀️</div>

                <h2 style="
                    margin: 0 0 6px 0;
                    font-size: 1.6rem;
                    font-weight: 800;
                    color: #fff;
                    letter-spacing: 0.3px;
                    animation: cdFadeUp 0.4s ease 0.3s both;
                ">בוקר טוב, כבר מתחילים!</h2>

                <p style="
                    margin: 0;
                    font-size: 0.9rem;
                    color: rgba(255,255,255,0.65);
                    animation: cdFadeUp 0.4s ease 0.4s both;
                ">${dateStr} • ${timeStr}</p>
            </div>

            <!-- גוף -->
            <div style="padding: 24px 28px; display: flex; flex-direction: column; gap: 18px;">

                <!-- כרטיס שבוע -->
                <div style="
                    background: rgba(124,58,237,0.1);
                    border: 1px solid rgba(124,58,237,0.25);
                    border-radius: 12px;
                    padding: 14px 18px;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                ">
                    <div style="
                        width: 40px; height: 40px;
                        background: rgba(124,58,237,0.2);
                        border-radius: 10px;
                        display: flex; align-items: center; justify-content: center;
                        font-size: 1.2rem; flex-shrink: 0;
                    ">📅</div>
                    <div>
                        <div style="font-size: 11px; color: #9ca3af; font-weight: 600;
                                    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px;">
                            ישיבת CAB שבועית
                        </div>
                        <div style="font-size: 15px; font-weight: 700; color: #c4b5fd;">
                            שבוע ${weekLabel}
                        </div>
                    </div>
                </div>

                <!-- סטטיסטיקות -->
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
                    <div style="
                        background: #111827;
                        border: 1px solid #374151;
                        border-radius: 10px;
                        padding: 12px;
                        text-align: center;
                    ">
                        <div style="font-size: 1.8rem; font-weight: 800; color: #a78bfa; line-height: 1;">
                            ${totalCount}
                        </div>
                        <div style="font-size: 11px; color: #6b7280; margin-top: 4px; font-weight: 600;">
                            שינויים לדיון
                        </div>
                    </div>
                    <div style="
                        background: ${undecidedCount > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.08)'};
                        border: 1px solid ${undecidedCount > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(34,197,94,0.25)'};
                        border-radius: 10px;
                        padding: 12px;
                        text-align: center;
                    ">
                        <div style="font-size: 1.8rem; font-weight: 800;
                                    color: ${undecidedCount > 0 ? '#fbbf24' : '#4ade80'}; line-height: 1;">
                            ${undecidedCount}
                        </div>
                        <div style="font-size: 11px; color: #6b7280; margin-top: 4px; font-weight: 600;">
                            ממתינים להחלטה
                        </div>
                    </div>
                    <div style="
                        background: rgba(34,197,94,0.08);
                        border: 1px solid rgba(34,197,94,0.25);
                        border-radius: 10px;
                        padding: 12px;
                        text-align: center;
                    ">
                        <div style="font-size: 1.8rem; font-weight: 800; color: #4ade80; line-height: 1;">
                            ${decidedCount}
                        </div>
                        <div style="font-size: 11px; color: #6b7280; margin-top: 4px; font-weight: 600;">
                            טופלו
                        </div>
                    </div>
                </div>

                <!-- הודעה אם יש החלטות קודמות -->
                ${hasPrevDecisions ? `
                <div style="
                    background: rgba(59,130,246,0.08);
                    border: 1px solid rgba(59,130,246,0.2);
                    border-radius: 10px;
                    padding: 12px 16px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    font-size: 13px;
                    color: #93c5fd;
                ">
                    <i class="fas fa-info-circle" style="flex-shrink:0; font-size:15px;"></i>
                    <span>
                        <strong>${decidedCount} שינויים</strong> כבר טופלו השבוע.
                        תוכל להמשיך מהמקום שעצרת.
                    </span>
                </div>` : ''}

                <!-- כפתורי פעולה -->
                <div style="display: flex; gap: 10px; margin-top: 4px;">
                    <button id="cdCabWelcomeStart" style="
                        flex: 1;
                        padding: 13px 20px;
                        background: linear-gradient(135deg, #320F5B, #7c3aed);
                        border: 1px solid #7c3aed;
                        border-radius: 10px;
                        color: #fff;
                        font-size: 14px;
                        font-weight: 800;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        transition: all 0.2s;
                        box-shadow: 0 4px 16px rgba(124,58,237,0.35);
                        letter-spacing: 0.3px;
                    "
                    onmouseover="this.style.background='linear-gradient(135deg,#4a1a8c,#8b5cf6)';this.style.transform='translateY(-1px)';this.style.boxShadow='0 6px 20px rgba(124,58,237,0.5)'"
                    onmouseout="this.style.background='linear-gradient(135deg,#320F5B,#7c3aed)';this.style.transform='';this.style.boxShadow='0 4px 16px rgba(124,58,237,0.35)'"
                    >
                        <i class="fas fa-play-circle"></i>
                        ${hasPrevDecisions ? 'המשך ישיבה' : 'התחל ישיבה'}
                    </button>
                    <button id="cdCabWelcomeCancel" style="
                        padding: 13px 18px;
                        background: #374151;
                        border: 1px solid #4b5563;
                        border-radius: 10px;
                        color: #9ca3af;
                        font-size: 13px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.2s;
                    "
                    onmouseover="this.style.background='#4b5563';this.style.color='#fff'"
                    onmouseout="this.style.background='#374151';this.style.color='#9ca3af'"
                    >
                        ביטול
                    </button>
                </div>

            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // אירועים
        document.getElementById('cdCabWelcomeStart')
            ?.addEventListener('click', () => {
                document.getElementById('cdCabWelcomeModal')?.remove();
                this.enterCabMode();
            });

        document.getElementById('cdCabWelcomeCancel')
            ?.addEventListener('click', () => {
                document.getElementById('cdCabWelcomeModal')?.remove();
            });

        // סגירה בלחיצה על overlay
        document.getElementById('cdCabWelcomeModal')
            ?.addEventListener('click', (e) => {
                if (e.target.id === 'cdCabWelcomeModal') {
                    document.getElementById('cdCabWelcomeModal')?.remove();
                }
            });
    }

    // -------------------------------------------------------
    // החלפת תצוגה
    // -------------------------------------------------------
    switchView(view) {
        if (view === 'cab' && this.isLoading) {
            console.warn('נתונים עדיין נטענים, אנא המתן...');
            return;
        }

        this.viewMode = view;

        this.container.querySelectorAll('.cd-view-btn').forEach(btn => {
            btn.classList.toggle('active',
                btn.getAttribute('data-view') === view);
        });

        const filterBar = document.getElementById('cdFilterBar');
        if (filterBar) {
            filterBar.style.display = view === 'cab' ? 'none' : 'flex';
        }

        // *** הצג כפתור התחל CAB רק בכניסה לטאב ***
        const startCabBtn = document.getElementById('cdStartCabBtn');
        if (startCabBtn) {
            startCabBtn.style.display = view === 'cab' ? 'flex' : 'none';
        }

        if (view === 'cab') {
            this.enterCabMode();
        } else {
            this.exitCabMode();
            this.render();
        }
    }

    // -------------------------------------------------------
    // החלת סינונים
    // -------------------------------------------------------
    applyFilters() {
        let result = [...this.allChanges];

        // *** סנן שינויים מבוטלים תמיד ***
        result = result.filter(c => {
            const s = (c.status || '').toLowerCase().trim();
            return !['cancelled', 'canceled', 'pending', 'ממתין'].includes(s);
        });
        // חיפוש חופשי
        if (this.filters.search) {
            const s = this.filters.search.toLowerCase();
            result = result.filter(c =>
                (c.number || '').toLowerCase().includes(s) ||
                (c.name || '').toLowerCase().includes(s) ||
                (c.system || '').toLowerCase().includes(s) ||
                (c.company || '').toLowerCase().includes(s) ||
                (c.notes || '').toLowerCase().includes(s) ||
                (c.presenters || '').toLowerCase().includes(s)
            );
        }

        // סטטוס
        if (this.filters.status) {
            result = result.filter(c => (c.status || '') === this.filters.status);
        }

        // מערכת
        if (this.filters.system) {
            result = result.filter(c => (c.system || '') === this.filters.system);
        }

        // חברה
        if (this.filters.company) {
            result = result.filter(c => (c.company || '') === this.filters.company);
        }

        // קטגוריה
        if (this.filters.category) {
            result = result.filter(c => (c.changeCategory || '') === this.filters.category);
        }

        // צוות
        if (this.filters.team) {
            result = result.filter(c => (c.executingTeam || '') === this.filters.team);
        }

        // ===== CAB MODE: סינון משולב needCab + תאריכים =====
        if (this.filters.needCab) {
            const from = this.filters.dateFrom ? new Date(this.filters.dateFrom) : null;
            const to = this.filters.dateTo ? new Date(this.filters.dateTo) : null;
            if (to) to.setDate(to.getDate() + 1);
            result = result.filter(c => {
                const s = (c.status || '').toLowerCase().trim();
                return !['cancelled', 'canceled', 'pending', 'ממתין'].includes(s);
            });
            result = result.filter(c => {
                const needCabVal = (c.needCab || '').toLowerCase().trim();
                const isCab = needCabVal === 'cab' ||
                    needCabVal === 'yes' ||
                    needCabVal === 'כן';

                // אם אין טווח תאריכים - הצג את כולם
                if (!from && !to) return true;

                // בדוק cabDate בטווח
                const cabDateObj = this.parseToDate(c.cabDate);
                const cabInRange = isCab && cabDateObj &&
                    (!from || cabDateObj >= from) &&
                    (!to || cabDateObj < to);

                // בדוק activityDate בטווח
                var actualStartTime = (c.actualStartTime || '').trim();
                if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                    actualStartTime = this._normalizeActualDate(c.actualStartTime)
                } else {
                    actualStartTime = c.plannedStartTime || c.date
                }
                const activityDate = this.parseDate(actualStartTime);
                const activityInRange = activityDate &&
                    (!from || activityDate >= from) &&
                    (!to || activityDate < to);

                // רק אם אחד מהם בטווח
                return cabInRange || activityInRange;
            });
        } else {
            // ===== מצב רגיל: סינון תאריכים לפי date =====
            if (this.filters.dateFrom) {
                const from = new Date(this.filters.dateFrom);
                result = result.filter(c => {
                    var actualStartTime = (c.actualStartTime || '').trim();
                    if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                        actualStartTime = this._normalizeActualDate(c.actualStartTime)
                    } else {
                        actualStartTime = c.plannedStartTime || c.date
                    }
                    const dateField = this.parseDate(actualStartTime);
                    return dateField && dateField >= from;
                });
            }

            if (this.filters.dateTo) {
                const to = new Date(this.filters.dateTo);
                to.setDate(to.getDate() + 1);
                result = result.filter(c => {

                    var actualStartTime = (c.actualStartTime || '').trim();
                    if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                        actualStartTime = this._normalizeActualDate(c.actualStartTime)
                    } else {
                        actualStartTime = c.plannedStartTime || c.date
                    }
                    const dateField = this.parseDate(actualStartTime);
                    return dateField && dateField < to;
                });
            }
        }

        this.filteredChanges = result;
        this.updateStats();
        this.updateFilterDropdowns();
        this.updateActiveFiltersIndicator();
    }

    // -------------------------------------------------------
    // עדכון dropdown-ים לפי נתונים קיימים
    // -------------------------------------------------------
    updateFilterDropdowns() {
        const getUnique = (field) => {
            const vals = this.allChanges
                .map(c => c[field] || '')
                .filter(v => v.trim() !== '');
            return [...new Set(vals)].sort();
        };

        const updateSelect = (id, values, currentVal) => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const prev = sel.value || currentVal;
            sel.innerHTML = `<option value="">${sel.options[0]?.text || ''}</option>`;
            values.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                if (v === prev) opt.selected = true;
                sel.appendChild(opt);
            });
        };

        updateSelect('cdStatusFilter',
            getUnique('status'), this.filters.status);
        updateSelect('cdSystemFilter',
            getUnique('system'), this.filters.system);
        updateSelect('cdCompanyFilter',
            getUnique('company'), this.filters.company);
        updateSelect('cdCategoryFilter',
            getUnique('changeCategory'), this.filters.category);
        updateSelect('cdTeamFilter',
            getUnique('executingTeam'), this.filters.team);
    }

    // -------------------------------------------------------
    // עדכון אינדיקטור סינונים פעילים
    // -------------------------------------------------------
    updateActiveFiltersIndicator() {
        const active = [];
        if (this.filters.search) active.push(`חיפוש: "${this.filters.search}"`);
        if (this.filters.needCab) active.push('CAB בלבד');
        if (this.filters.status) active.push(`סטטוס: ${this.filters.status}`);
        if (this.filters.system) active.push(`מערכת: ${this.filters.system}`);
        if (this.filters.company) active.push(`חברה: ${this.filters.company}`);
        if (this.filters.category) active.push(`קטגוריה: ${this.filters.category}`);
        if (this.filters.team) active.push(`צוות: ${this.filters.team}`);
        if (this.filters.dateFrom || this.filters.dateTo) {
            const from = this.toDisplayDate(this.filters.dateFrom) || '...';
            const to = this.toDisplayDate(this.filters.dateTo) || '...';
            active.push(`תאריכים: ${from} — ${to}`);
        }

        const el = document.getElementById('cdActiveFilters');
        const textEl = document.getElementById('cdActiveFiltersText');
        if (el && textEl) {
            if (active.length > 0) {
                textEl.textContent = active.join(' | ');
                el.style.display = 'flex';
            } else {
                el.style.display = 'none';
            }
        }
    }

    // -------------------------------------------------------
    // ניקוי כל הסינונים
    // -------------------------------------------------------
    clearAllFilters() {
        this.filters = {
            search: '', status: '', system: '', company: '',
            category: '', team: '', needCab: false,
            cabDate: '', dateFrom: '', dateTo: ''
        };

        this.clearColumnFilters();

        const ids = [
            'cdSearchInput', 'cdStatusFilter', 'cdSystemFilter',
            'cdCompanyFilter', 'cdCategoryFilter', 'cdTeamFilter'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        // ניקוי שדות תאריך
        const dfEl = document.getElementById('cdDateFrom');
        const dtEl = document.getElementById('cdDateTo');
        const dfDisplay = document.getElementById('cdDateFromDisplay');
        const dtDisplay = document.getElementById('cdDateToDisplay');
        if (dfEl) dfEl.value = '';
        if (dtEl) dtEl.value = '';
        if (dfDisplay) dfDisplay.value = '';
        if (dtDisplay) dtDisplay.value = '';

        const needCab = document.getElementById('cdNeedCabFilter');
        if (needCab) needCab.checked = false;

        const clearSearch = document.getElementById('cdClearSearch');
        if (clearSearch) clearSearch.style.display = 'none';

        // *** ניקוי כפתור CAB קרוב ***
        const cabRangeBtn = document.getElementById('cdCabRangeBtn');
        if (cabRangeBtn) cabRangeBtn.classList.remove('active');

        this.applyFilters();
        this.render();
    }

    // -------------------------------------------------------
    // החלת טווח CAB
    // -------------------------------------------------------
    applyCabDateRange() {
        if (!this.cabDateRange) return;

        const btn = document.getElementById('cdCabRangeBtn');

        // *** אם כבר לחוץ - בטל את הסינון ***
        if (btn?.classList.contains('active')) {
            btn.classList.remove('active');

            // נקה תאריכים ו-needCab
            this.filters.dateFrom = '';
            this.filters.dateTo = '';
            this.filters.needCab = false;

            const dateFrom = document.getElementById('cdDateFrom');
            const dateTo = document.getElementById('cdDateTo');
            const dateFromDisplay = document.getElementById('cdDateFromDisplay');
            const dateToDisplay = document.getElementById('cdDateToDisplay');
            const needCabEl = document.getElementById('cdNeedCabFilter');

            if (dateFrom) dateFrom.value = '';
            if (dateTo) dateTo.value = '';
            if (dateFromDisplay) dateFromDisplay.value = '';
            if (dateToDisplay) dateToDisplay.value = '';
            if (needCabEl) needCabEl.checked = false;

            this.applyFilters();
            this.render();
            return;
        }

        // *** הפעל סינון - הוסף קלאס active ***
        btn?.classList.add('active');

        const dateFrom = document.getElementById('cdDateFrom');
        const dateTo = document.getElementById('cdDateTo');
        const dateFromDisplay = document.getElementById('cdDateFromDisplay');
        const dateToDisplay = document.getElementById('cdDateToDisplay');

        if (dateFrom) {
            dateFrom.value = this.cabDateRange.fromDate;
            this.filters.dateFrom = this.cabDateRange.fromDate;
        }
        if (dateFromDisplay) {
            dateFromDisplay.value = this.toDisplayDate(this.cabDateRange.fromDate);
        }
        if (dateTo) {
            dateTo.value = this.cabDateRange.toDate;
            this.filters.dateTo = this.cabDateRange.toDate;
        }
        if (dateToDisplay) {
            dateToDisplay.value = this.toDisplayDate(this.cabDateRange.toDate);
        }

        this.filters.needCab = true;
        const needCabEl = document.getElementById('cdNeedCabFilter');
        if (needCabEl) needCabEl.checked = true;

        this.applyFilters();
        this.render();
    }

    // -------------------------------------------------------
    // עדכון סטטיסטיקות
    // -------------------------------------------------------
    updateStats() {
        const total = this.filteredChanges.length;

        // CAB קרוב - זהה ל-ChangesManager
        let cabCount = 0;
        if (this.cabDateRange) {
            const from = new Date(this.cabDateRange.fromDate);
            const to = new Date(this.cabDateRange.toDate);

            cabCount = this.filteredChanges.filter(c => {
                const needCabVal = (c.needCab || '').toLowerCase().trim();
                const isCab = needCabVal === 'cab' ||
                    needCabVal === 'yes' ||
                    needCabVal === 'כן';

                // CAB Date בטווח
                const cabDateObj = this.parseToDate(c.cabDate);
                const cabThisWeek = isCab && cabDateObj &&
                    cabDateObj >= from &&
                    cabDateObj <= to;

                // Activity Date בטווח

                var actualStartTime = (c.actualStartTime || '').trim();
                if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                    actualStartTime = this._normalizeActualDate(c.actualStartTime)
                } else {
                    actualStartTime = c.plannedStartTime || c.date
                }
                const d = this.parseDate(actualStartTime);
                if (!d) return false;
                const activityThisWeek = d >= from && d <= to;
                return cabThisWeek || activityThisWeek;
            }).length;
        }

        // סיכון גבוה
        const riskCount = this.filteredChanges.filter(c =>
            this.isHighRisk(c)
        ).length;

        // התנגשויות
        const conflicts = this.detectConflicts(this.filteredChanges);
        const conflictCount = conflicts.size;

        const el = id => document.getElementById(id);
        if (el('cdStatTotal')) el('cdStatTotal').textContent = total;
        if (el('cdStatCab')) el('cdStatCab').textContent = cabCount;
        if (el('cdStatRisk')) el('cdStatRisk').textContent = riskCount;
        if (el('cdStatConflict')) el('cdStatConflict').textContent = conflictCount;
    }

    // -------------------------------------------------------
    // זיהוי סיכון גבוה
    // -------------------------------------------------------
    isHighRisk(change) {
        const yesFields = [
            'affectsCoreSystems',
            'affectsCustomers',
            'regulatoryRisk',
            'affectsMultipleSystems'
        ];
        return yesFields.some(f =>
            (change[f] || '').toLowerCase() === 'yes' ||
            (change[f] || '').toLowerCase() === 'כן'
        );
    }

    // -------------------------------------------------------
    // זיהוי התנגשויות
    // -------------------------------------------------------
    detectConflicts(changes) {
        const conflictSet = new Set();

        for (let i = 0; i < changes.length; i++) {
            for (let j = i + 1; j < changes.length; j++) {
                const a = changes[i];
                const b = changes[j];

                // *** המר ל-Date objects עם שעה מדויקת ***
                const aStartDate = this.parseDateWithTime(
                    this._getEffectiveStartTime(a)
                );
                const aEndDate = this.parseDateWithTime(
                    this._getEffectiveEndTime(a)
                ) || (aStartDate
                    ? new Date(aStartDate.getTime() + 60 * 60 * 1000)
                    : null);

                const bStartDate = this.parseDateWithTime(
                    this._getEffectiveStartTime(b)
                );
                const bEndDate = this.parseDateWithTime(
                    this._getEffectiveEndTime(b)
                ) || (bStartDate
                    ? new Date(bStartDate.getTime() + 60 * 60 * 1000)
                    : null);

                // *** ולידציה: חייבים תאריכי התחלה תקינים ***
                if (!aStartDate || !bStartDate) continue;
                if (!aEndDate || !bEndDate) continue;

                // *** דלג אם פעילות ארוכה מיום אחד ***
                const MS_PER_DAY = 24 * 60 * 60 * 1000;

                const aDuration = aEndDate - aStartDate;
                const bDuration = bEndDate - bStartDate;

                if (aDuration > MS_PER_DAY) continue;
                if (bDuration > MS_PER_DAY) continue;

                // *** בדיקת חפיפת זמן אמיתית ***
                const timeOverlap = aStartDate < bEndDate &&
                    bStartDate < aEndDate;

                if (timeOverlap) {
                    conflictSet.add(a.number);
                    conflictSet.add(b.number);
                }
            }
        }

        return conflictSet;
    }

    // -------------------------------------------------------
    // רינדור ראשי - לפי תצוגה
    // -------------------------------------------------------
    render() {
        if (this.cabMode) return;

        switch (this.viewMode) {
            case 'calendar':
                this.renderCalendar();
                break;
            case 'week':
                this.renderWeekView();
                break;
            case 'day':
                this.renderDayView();
                break;
            case 'table':
                this.renderTableView();
                break;
        }
    }

    // -------------------------------------------------------
    // תצוגת לוח שנה - חודש
    // -------------------------------------------------------
    renderCalendar() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const month = this.calendarMonth;
        const year = this.calendarYear;

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startDow = firstDay.getDay(); // 0=ראשון

        const byDate = this.organizeByDate(this.filteredChanges);
        const conflicts = this.detectConflicts(this.filteredChanges);

        const monthNames = [
            'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
            'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
        ];

        // שמות ימים לכותרת הלוח
        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

        const today = new Date();
        const todayKey = this.formatDateKey(
            today.getDate(), today.getMonth() + 1, today.getFullYear()
        );

        let html = `
    <div class="cd-calendar">
        <div class="cd-cal-nav">
            <button class="cd-cal-nav-btn" id="cdCalNext">
                <i class="fas fa-chevron-left"></i>
            </button>
            <h3 class="cd-cal-title">
                ${monthNames[month]} ${year}
                <span class="cd-cal-count">(${this.filteredChanges.length} שינויים)</span>
            </h3>
            <button class="cd-cal-nav-btn" id="cdCalPrev">
                <i class="fas fa-chevron-right"></i>
            </button>
            <button class="cd-today-btn" id="cdCalToday">היום</button>
        </div>

        <div class="cd-cal-grid">
            <div class="cd-cal-weekdays">`;

        // כותרות ימים
        dayNames.forEach(d => {
            html += `<div>${d}</div>`;
        });

        html += `</div><div class="cd-cal-days">`;

        // תאים ריקים לפני תחילת החודש
        for (let i = 0; i < startDow; i++) {
            html += `<div class="cd-cal-day cd-cal-empty"></div>`;
        }

        // ימי החודש
        for (let day = 1; day <= daysInMonth; day++) {
            const dk = this.formatDateKey(day, month + 1, year);
            const dc = byDate[dk] || [];
            const isToday = dk === todayKey;
            const hasConflict = dc.some(c => conflicts.has(c.number));
            const hasChanges = dc.length > 0;

            // חישוב כמה שינויים מציגים
            const CELL_HEIGHT = 130;
            const DAY_NUM_H = 20;
            const CHANGE_H = 20;   // גובה מינימלי לשינוי
            const MORE_H = 18;

            const available = CELL_HEIGHT - DAY_NUM_H;
            let MAX_VISIBLE;

            if (dc.length <= 1) {
                MAX_VISIBLE = dc.length;   // 0 או 1 - הצג הכל
            } else {
                MAX_VISIBLE = Math.floor(available / CHANGE_H);
                if (dc.length > MAX_VISIBLE) {
                    MAX_VISIBLE = Math.max(
                        1,
                        Math.floor((available - MORE_H) / CHANGE_H)
                    );
                }
            }

            const visible = dc.slice(0, MAX_VISIBLE);
            const extra = dc.length - MAX_VISIBLE;

            // קלאס מיוחד לשינוי יחיד
            const singleClass = dc.length === 1 ? 'cd-day-changes--single' : '';
            // קביעת קלאס לפי מספר שינויים גלויים
            let changesClass = '';
            if (visible.length === 1 && extra === 0) {
                changesClass = 'cd-day-changes--single';
            } else if (visible.length === 2 && extra === 0) {
                changesClass = 'cd-day-changes--two';
            } else if (visible.length === 3 && extra === 0) {
                changesClass = 'cd-day-changes--three';
            } else if (visible.length >= 4) {
                changesClass = 'cd-day-changes--many';
            }

            html += `
        <div class="cd-cal-day 
            ${isToday ? 'cd-today' : ''} 
            ${hasChanges ? 'cd-has-changes' : ''} 
            ${hasConflict ? 'cd-has-conflict' : ''}"
            data-date="${dk}">
            <div class="cd-day-num">
                ${day}
                ${hasConflict
                    ? '<i class="fas fa-bolt cd-conflict-icon" title="התנגשות"></i>'
                    : ''}
                ${dc.some(c => this.isHighRisk(c))
                    ? '<i class="fas fa-exclamation-triangle cd-risk-icon" title="סיכון גבוה"></i>'
                    : ''}
            </div>
            <div class="cd-day-changes ${changesClass}">`;

            visible.forEach(c => {
                const rc = this.isHighRisk(c) ? ' cd-chg-risk' : '';
                const cc = conflicts.has(c.number) ? ' cd-chg-conflict' : '';
                html += `
            <div class="cd-day-change${rc}${cc}"
                data-number="${this.escHtml(c.number)}"
                title="${this.escHtml(c.name || '')}">
                <span class="cd-chg-num">${this.escHtml(c.number)}</span>
                <span class="cd-chg-name">${this.escHtml(c.name || '')}</span>
            </div>`;
            });

            if (extra > 0) {
                html += `
            <div class="cd-day-more" data-date="${dk}">
                +${extra} נוספים
            </div>`;
            }

            html += `</div></div>`;
        }

        html += `</div></div>`;
        content.innerHTML = html;

        // כפתורי ניווט חודש
        document.getElementById('cdCalPrev')?.addEventListener('click', () => {
            this.calendarMonth--;
            if (this.calendarMonth < 0) {
                this.calendarMonth = 11;
                this.calendarYear--;
            }
            this.renderCalendar();
        });

        document.getElementById('cdCalNext')?.addEventListener('click', () => {
            this.calendarMonth++;
            if (this.calendarMonth > 11) {
                this.calendarMonth = 0;
                this.calendarYear++;
            }
            this.renderCalendar();
        });

        document.getElementById('cdCalToday')?.addEventListener('click', () => {
            this.calendarMonth = new Date().getMonth();
            this.calendarYear = new Date().getFullYear();
            this.renderCalendar();
        });

        // קליק על שינוי בודד
        content.querySelectorAll('.cd-day-change').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const c = this.allChanges.find(
                    x => x.number === el.getAttribute('data-number'));
                if (c) this.showChangePopup(c);
            });
        });

        // קליק על "+X נוספים" - פותח רשימת יום
        content.querySelectorAll('.cd-day-more').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const dk = el.getAttribute('data-date');
                const dc = byDate[dk] || [];
                if (dc.length > 0) this.showDayListPopup(dk, dc);
            });
        });

        // קליק על תא יום - פותח רשימת יום
        content.querySelectorAll('.cd-cal-day:not(.cd-cal-empty)').forEach(el => {
            el.addEventListener('click', () => {
                const dk = el.getAttribute('data-date');
                const dc = byDate[dk] || [];
                if (dc.length > 0) this.showDayListPopup(dk, dc);
            });
        });
    }

    renderDayView() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const d = this.dayDate;
        const dk = this.formatDateKey(
            d.getDate(), d.getMonth() + 1, d.getFullYear());
        const byDate = this.organizeByDate(this.filteredChanges);
        const dc = byDate[dk] || [];
        const conflicts = this.detectConflicts(this.filteredChanges);
        const today = new Date();
        const isToday = dk === this.formatDateKey(
            today.getDate(), today.getMonth() + 1, today.getFullYear());

        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי',
            'חמישי', 'שישי', 'שבת'];
        const fmt = dt =>
            `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;

        let html = `
        <div class="cd-day-view">
            <div class="cd-day-nav">
                <button class="cd-cal-nav-btn" id="cdDayNext">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <h3 class="cd-day-title ${isToday ? 'cd-today-title' : ''}">
                    יום ${dayNames[d.getDay()]} — ${fmt(d)}
                    ${isToday ? '<span class="cd-today-badge">היום</span>' : ''}
                </h3>
                <button class="cd-cal-nav-btn" id="cdDayPrev">
                    <i class="fas fa-chevron-right"></i>
                </button>
                <button class="cd-today-btn" id="cdDayToday">היום</button>
            </div>`;

        if (dc.length === 0) {
            html += `
            <div class="cd-day-empty">
                <i class="fas fa-calendar-check"></i>
                <p>אין שינויים מתוכננים ליום זה</p>
            </div>`;
        } else {
            html += `
            <div class="cd-day-count">
                ${dc.length} שינויים מתוכננים
            </div>
            <div class="cd-day-list">`;

            dc.forEach(c => {
                const rc = this.isHighRisk(c) ? ' cd-card-risk' : '';
                const cc = conflicts.has(c.number) ? ' cd-card-conflict' : '';
                html += `
                <div class="cd-day-card${rc}${cc}"
                     data-number="${this.escHtml(c.number)}">
                    <div class="cd-day-card-header">
                        <span class="cd-day-card-num">
                            ${this.escHtml(c.number)}
                        </span>
                        <span class="cd-day-card-status
                            ${this.getStatusClass(c.status)}">
                            ${this.escHtml(this.mapStatus(c.status))}
                        </span>
                        ${this.isHighRisk(c)
                        ? '<span class="cd-risk-badge"><i class="fas fa-exclamation-triangle"></i> סיכון גבוה</span>'
                        : ''}
                        ${conflicts.has(c.number)
                        ? '<span class="cd-conflict-badge"><i class="fas fa-bolt"></i> התנגשות</span>'
                        : ''}
                    </div>
                    <div class="cd-day-card-name">
                        ${this.escHtml(c.name || '')}
                    </div>
                    <div class="cd-day-card-meta">
                        ${this._getEffectiveStartTime(c)
                        ? `<span><i class="fas fa-clock"></i>
                        ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(c)))}</span>`
                        : ''}
                        ${c.system
                        ? `<span><i class="fas fa-server"></i>
                               ${this.escHtml(c.system)}</span>`
                        : ''}
                        ${c.executingTeam
                        ? `<span><i class="fas fa-users"></i>
                               ${this.escHtml(c.executingTeam)}</span>`
                        : ''}
                    </div>
                </div>`;
            });

            html += `</div>`;
        }

        html += `</div>`;
        content.innerHTML = html;

        document.getElementById('cdDayPrev')?.addEventListener('click', () => {
            this.dayDate.setDate(this.dayDate.getDate() - 1);
            this.renderDayView();
        });
        document.getElementById('cdDayNext')?.addEventListener('click', () => {
            this.dayDate.setDate(this.dayDate.getDate() + 1);
            this.renderDayView();
        });
        document.getElementById('cdDayToday')?.addEventListener('click', () => {
            this.dayDate = new Date();
            this.renderDayView();
        });

        content.querySelectorAll('.cd-day-card').forEach(el => {
            el.addEventListener('click', () => {
                const c = this.allChanges.find(
                    x => x.number === el.getAttribute('data-number'));
                if (c) this.showChangePopup(c);
            });
        });
    }

    renderWeekView() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const weekStart = new Date(this.weekStartDate);
        const today = new Date();

        // בניית מערך 7 ימים
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            days.push(d);
        }

        const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        const byDate = this.organizeByDate(this.filteredChanges);
        const conflicts = this.detectConflicts(this.filteredChanges);

        const fmt = dt =>
            `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
        const fmtFull = dt =>
            `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

        const weekStartFmt = fmt(days[0]);
        const weekEndFmt = fmt(days[6]);

        let html = `
    <div class="cd-week-view">
        <div class="cd-week-nav">
            <button class="cd-cal-nav-btn" id="cdWeekNext">
                <i class="fas fa-chevron-left"></i>
            </button>
            <h3 class="cd-week-title">
                שבוע ${weekStartFmt} — ${weekEndFmt}
            </h3>
            <button class="cd-cal-nav-btn" id="cdWeekPrev">
                <i class="fas fa-chevron-right"></i>
            </button>
            <button class="cd-today-btn" id="cdWeekToday">היום</button>
        </div>
        <div class="cd-week-grid">`;

        days.forEach((d) => {
            const dk = this.formatDateKey(
                d.getDate(), d.getMonth() + 1, d.getFullYear());
            const dc = byDate[dk] || [];
            const isToday = fmtFull(d) === fmtFull(today);
            const hasConflict = dc.some(c => conflicts.has(c.number));

            html += `
        <div class="cd-week-col ${isToday ? 'cd-today' : ''}
                    ${hasConflict ? 'cd-has-conflict' : ''}">
            <div class="cd-week-col-header">
                <span class="cd-week-dow">${dayNames[d.getDay()]}</span>
                <span class="cd-week-date">${fmt(d)}</span>
                ${dc.length
                    ? `<span class="cd-week-count">${dc.length}</span>`
                    : ''}
            </div>
            <div class="cd-week-changes">`;

            dc.forEach(c => {
                const rc = this.isHighRisk(c) ? ' cd-chg-risk' : '';
                const cc = conflicts.has(c.number) ? ' cd-chg-conflict' : '';
                html += `
            <div class="cd-week-change${rc}${cc}"
                 data-number="${this.escHtml(c.number)}"
                 title="${this.escHtml(c.name || '')}">
                <span class="cd-chg-num">${this.escHtml(c.number)}</span>
                <span class="cd-chg-name">
                    ${this.escHtml(this.truncate(c.name, 130))}
                </span>
                ${this._getEffectiveStartTime(c)
                        ? `<span class="cd-chg-time">
                            ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(c)))}
                        </span>`
                        : ''}
                ${this.isHighRisk(c)
                        ? '<i class="fas fa-exclamation-triangle cd-risk-icon"></i>'
                        : ''}
            </div>`;
            });

            if (dc.length === 0) {
                html += `<div class="cd-week-empty">אין שינויים</div>`;
            }

            html += `</div></div>`;
        });

        html += `</div></div>`;
        content.innerHTML = html;

        // כפתורי ניווט שבוע
        document.getElementById('cdWeekPrev')?.addEventListener('click', () => {
            this.weekStartDate.setDate(this.weekStartDate.getDate() - 7);
            this.renderWeekView();
        });
        document.getElementById('cdWeekNext')?.addEventListener('click', () => {
            this.weekStartDate.setDate(this.weekStartDate.getDate() + 7);
            this.renderWeekView();
        });
        document.getElementById('cdWeekToday')?.addEventListener('click', () => {
            this.weekStartDate = this._getWeekStart(new Date());
            this.renderWeekView();
        });

        // קליק על שינוי
        content.querySelectorAll('.cd-week-change').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const c = this.allChanges.find(
                    x => x.number === el.getAttribute('data-number'));
                if (c) this.showChangePopup(c);
            });
        });
    }

    // -------------------------------------------------------
    // Column Order Cache - LocalStorage
    // -------------------------------------------------------

    _getColumnOrderKey() {
        const user = this.currentUser || 'default';
        return `table_column_order_${user}`;
    }

    saveColumnOrder(order) {
        try {
            localStorage.setItem(this._getColumnOrderKey(), JSON.stringify(order));
        } catch (err) {
            console.warn('[TABLE] שגיאה בשמירת סדר עמודות:', err);
            this._showErrorIndicator('[TABLE] שגיאה בשמירת סדר עמודות');
        }
    }

    loadColumnOrder() {
        try {
            const raw = localStorage.getItem(this._getColumnOrderKey());
            if (!raw) return null;
            const order = JSON.parse(raw);
            if (!Array.isArray(order) || order.length === 0) return null;
            return order;
        } catch (err) {
            console.warn('[TABLE] שגיאה בטעינת סדר עמודות', err);
            this._showErrorIndicator('[TABLE] שגיאה בטעינת סדר עמודות');
            return null;
        }
    }

    clearColumnOrder() {
        try {
            localStorage.removeItem(this._getColumnOrderKey());
        } catch (err) {
            console.warn('[TABLE] שגיאה בניקוי סדר עמודות', err);
            this._showErrorIndicator('[TABLE] שגיאה בניקוי סדר עמודות');
        }
    }

    // הגדרת עמודות ברירת מחדל - סדר חדש לפי הדרישה
    _getDefaultColumns() {
        return [
            { key: 'number', label: 'מספר', sortable: true },
            { key: 'status', label: 'סטטוס', sortable: true },
            { key: 'date', label: 'זמן התחלה', sortable: true },
            { key: 'endDate', label: 'זמן סיום', sortable: true },
            { key: 'system', label: 'מערכת', sortable: true },
            { key: 'name', label: 'שם השינוי', sortable: true },
            { key: 'team', label: 'צוות מבצע', sortable: true },
            { key: 'risk', label: 'סיכון', sortable: false },
        ];
    }

    // טעינת סדר עמודות - עם fallback לברירת מחדל
    _getActiveColumns() {
        const defaults = this._getDefaultColumns();
        const saved = this.loadColumnOrder();
        if (!saved) return defaults;

        // בנה מפה של כל העמודות הקיימות
        const defaultMap = new Map(defaults.map(c => [c.key, c]));

        // סדר לפי השמור, הוסף חסרים בסוף
        const ordered = [];
        const seen = new Set();

        saved.forEach(key => {
            if (defaultMap.has(key)) {
                ordered.push(defaultMap.get(key));
                seen.add(key);
            }
        });

        // עמודות חדשות שלא היו בסדר השמור
        defaults.forEach(col => {
            if (!seen.has(col.key)) {
                ordered.push(col);
            }
        });

        return ordered;
    }

    // -------------------------------------------------------
    // Column Filters - סינון per-עמודה בטבלה
    // -------------------------------------------------------

    _getColumnFilterKey() {
        const user = this.currentUser || 'default';
        return `table_col_filters_${user}`;
    }

    saveColumnFilters() {
        try {
            localStorage.setItem(
                this._getColumnFilterKey(),
                JSON.stringify(this.columnFilters)
            );
        } catch (err) {
            console.warn('[TABLE] שגיאה בשמירת סינוני עמודות:', err);
            this._showErrorIndicator('[TABLE] שגיאה בשמירת סינוני עמודות');
        }
    }

    loadColumnFilters() {
        try {
            const raw = localStorage.getItem(this._getColumnFilterKey());
            if (!raw) return {};
            return JSON.parse(raw) || {};
        } catch (err) {
            console.warn('[TABLE] שגיאה בטעינת סינוני עמודות:', err);
            this._showErrorIndicator('[TABLE] שגיאה בטעינת סינוני עמודות');
            return {};
        }
    }

    clearColumnFilters() {
        this.columnFilters = {};
        try {
            localStorage.removeItem(this._getColumnFilterKey());
        } catch (err) {
            console.warn('[TABLE] שגיאה בניקוי סינוני עמודות:', err);
            this._showErrorIndicator('[TABLE] שגיאה בניקוי סינוני עמודות');
        }
    }

    // החלת סינוני עמודות על הנתונים
    applyColumnFilters(items) {
        if (!this.columnFilters ||
            Object.keys(this.columnFilters).length === 0) {
            return items;
        }

        // חשב conflicts פעם אחת
        const hasConflictFilter =
            this.columnFilters['risk'] === 'התנגשות' ||
            this.columnFilters['risk'] === 'conflict';
        const conflicts = hasConflictFilter
            ? this.detectConflicts(items)
            : new Set();

        return items.filter(c => {
            return Object.entries(this.columnFilters).every(([key, val]) => {
                if (!val || String(val).trim() === '') return true;
                const v = String(val).toLowerCase().trim();

                switch (key) {
                    case 'number':
                        return (c.number || '').toLowerCase().includes(v);

                    case 'name':
                        return (c.name || '').toLowerCase().includes(v);

                    case 'status': {
                        const filterVals = Array.isArray(val)
                            ? val
                            : (val ? [val] : []);
                        if (filterVals.length === 0) return true;
                        const mappedStatus = this.mapStatus(c.status || '').toLowerCase();
                        return filterVals.some(fv => mappedStatus === fv.toLowerCase());
                    }

                    //  סינון תאריך - השוואה מדויקת לפי יום
                    case 'date': {
                        if (!val) return true;
                        const filterDate = this._parseColFilterDate(val);
                        if (!filterDate) return true;
                        const itemDate = this.parseDate(
                            this._getEffectiveStartTime(c)
                        );
                        if (!itemDate) return false;
                        return filterDate.getFullYear() ===
                            itemDate.getFullYear() &&
                            filterDate.getMonth() ===
                            itemDate.getMonth() &&
                            filterDate.getDate() ===
                            itemDate.getDate();
                    }

                    case 'endDate': {
                        if (!val) return true;
                        const filterDate = this._parseColFilterDate(val);
                        if (!filterDate) return true;
                        const itemDate = this.parseDate(this._getEffectiveEndTime(c));
                        if (!itemDate) return false;
                        return filterDate.getFullYear() ===
                            itemDate.getFullYear() &&
                            filterDate.getMonth() ===
                            itemDate.getMonth() &&
                            filterDate.getDate() ===
                            itemDate.getDate();
                    }

                    case 'system': {
                        const filterVals = Array.isArray(val)
                            ? val
                            : (val ? [val] : []);
                        if (filterVals.length === 0) return true;
                        const sysName = this._extractSystemName(c.system || '').toLowerCase();
                        return filterVals.some(fv => sysName === fv.toLowerCase());
                    }

                    case 'team': {
                        const filterVals = Array.isArray(val)
                            ? val
                            : (val ? [val] : []);
                        if (filterVals.length === 0) return true;
                        const team = (c.executingTeam || '').toLowerCase();
                        return filterVals.some(fv => team === fv.toLowerCase());
                    }

                    case 'risk': {
                        const filterVals = Array.isArray(val)
                            ? val
                            : (val ? [val] : []);
                        if (filterVals.length === 0) return true;

                        // חשב conflicts רק אם צריך
                        const needsConflict = filterVals.some(fv =>
                            fv.toLowerCase() === 'התנגשות' || fv.toLowerCase() === 'conflict'
                        );
                        const conflictsSet = needsConflict
                            ? this.detectConflicts(items)
                            : new Set();

                        return filterVals.some(fv => {
                            const v = fv.toLowerCase();
                            if (v === 'סיכון' || v === 'risk') return this.isHighRisk(c);
                            if (v === 'התנגשות' || v === 'conflict') return conflictsSet.has(c.number);
                            return false;
                        });
                    }

                    default:
                        return true;
                }
            });
        });
    }

    // פרסור תאריך סינון - תומך ב-dd/mm/yyyy וב-yyyy-mm-dd
    _parseColFilterDate(val) {
        if (!val) return null;
        // dd/mm/yyyy
        const dmy = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (dmy) {
            return new Date(
                parseInt(dmy[3]),
                parseInt(dmy[2]) - 1,
                parseInt(dmy[1]),
                12, 0, 0
            );
        }
        // yyyy-mm-dd
        const iso = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) {
            return new Date(
                parseInt(iso[1]),
                parseInt(iso[2]) - 1,
                parseInt(iso[3]),
                12, 0, 0
            );
        }
        return null;
    }

    // המרת dd/mm/yyyy → yyyy-mm-dd לשדה input[type=date]
    _colFilterDateToInput(displayDate) {
        if (!displayDate) return '';
        // פורמט dd/mm/yyyy
        const m = displayDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
            return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        }
        // כבר בפורמט yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(displayDate)) {
            return displayDate;
        }
        return '';
    }

    // המרת yyyy-mm-dd → dd/mm/yyyy לתצוגה
    _colFilterInputToDisplay(inputDate) {
        if (!inputDate) return '';
        const m = inputDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        return inputDate;
    }

    // בניית HTML לשורת סינון עמודות
    _buildColumnFilterRowHtml(activeCols) {
        const cells = activeCols.map(col => {
            const currentVal = (this.columnFilters || {})[col.key] || '';

            switch (col.key) {
                case 'number':
                case 'name':
                    return `<td class="cd-col-filter-cell">
                    <div class="cd-col-filter-wrap">
                        <i class="fas fa-search cd-col-filter-icon"></i>
                        <input
                            type="text"
                            class="cd-col-filter-input"
                            data-filter-col="${col.key}"
                            placeholder="חפש..."
                            value="${this.escHtml(currentVal)}"
                        />
                        ${currentVal
                            ? `<button class="cd-col-filter-clear"
                                data-filter-col="${col.key}">
                                <i class="fas fa-times"></i>
                               </button>`
                            : ''}
                    </div>
                </td>`;

                case 'status': {
                    const statuses = [...new Set(
                        this.filteredChanges
                            .map(c => this.mapStatus(c.status || ''))
                            .filter(v => v.trim() !== '')
                    )].sort();

                    // currentVal יכול להיות string או array
                    const selectedVals = Array.isArray(this.columnFilters[col.key])
                        ? this.columnFilters[col.key]
                        : (this.columnFilters[col.key] ? [this.columnFilters[col.key]] : []);

                    const hasActive = selectedVals.length > 0;
                    const displayText = hasActive
                        ? selectedVals.join(', ')
                        : 'הכל';

                    const allSelected = selectedVals.length === 0; // אם אין סינון = הכל נבחר
                    const optionsHtml = statuses.map(s => `
                    <div class="cd-multi-option ${(allSelected || selectedVals.includes(s)) ? 'cd-multi-option--selected' : ''}"
                        data-value="${this.escHtml(s)}">
                        <span class="cd-multi-checkbox">
                            ${(allSelected || selectedVals.includes(s)) ? '✓' : ''}
                        </span>
                        <span>${this.escHtml(s)}</span>
                    </div>
                `).join('');


                    return `<td class="cd-col-filter-cell">
        <div class="cd-multi-select-wrap" data-filter-col="${col.key}">
            <div class="cd-multi-select-trigger ${hasActive ? 'cd-multi-select-trigger--active' : ''}"
                 data-filter-col="${col.key}">
                <span class="cd-multi-select-text">${this.escHtml(displayText)}</span>
                ${hasActive ? `<span class="cd-multi-select-count">${selectedVals.length}</span>` : ''}
                <i class="fas fa-chevron-down cd-multi-select-arrow"></i>
            </div>
            <div class="cd-multi-select-dropdown" style="display:none;">
                <div class="cd-multi-option cd-multi-option--all"
                     data-value="">
                    <span class="cd-multi-checkbox">
                        ${selectedVals.length === 0 ? '✓' : ''}
                    </span>
                    <span>הכל</span>
                </div>
                ${optionsHtml}
            </div>
        </div>
    </td>`;
                }

                case 'system': {
                    const systems = [
                        ...new Set(
                            this.filteredChanges
                                .map(c => this._extractSystemName(c.system || ''))
                                .filter(v => v.trim() !== '')
                        )
                    ].sort();

                    const selectedVals = Array.isArray(this.columnFilters[col.key])
                        ? this.columnFilters[col.key]
                        : (this.columnFilters[col.key] ? [this.columnFilters[col.key]] : []);

                    const hasActive = selectedVals.length > 0;
                    const displayText = hasActive ? selectedVals.join(', ') : 'הכל';

                    const allSelected = selectedVals.length === 0; // אם אין סינון = הכל נבחר
                    const optionsHtml = systems.map(s => `
                    <div class="cd-multi-option ${(allSelected || selectedVals.includes(s)) ? 'cd-multi-option--selected' : ''}"
                        data-value="${this.escHtml(s)}">
                        <span class="cd-multi-checkbox">
                            ${(allSelected || selectedVals.includes(s)) ? '✓' : ''}
                        </span>
                        <span>${this.escHtml(s)}</span>
                    </div>
                `).join('');

                    return `<td class="cd-col-filter-cell">
        <div class="cd-multi-select-wrap" data-filter-col="${col.key}">
            <div class="cd-multi-select-trigger ${hasActive ? 'cd-multi-select-trigger--active' : ''}"
                 data-filter-col="${col.key}">
                <span class="cd-multi-select-text">${this.escHtml(displayText)}</span>
                ${hasActive ? `<span class="cd-multi-select-count">${selectedVals.length}</span>` : ''}
                <i class="fas fa-chevron-down cd-multi-select-arrow"></i>
            </div>
            <div class="cd-multi-select-dropdown" style="display:none;">
                <div class="cd-multi-option cd-multi-option--all" data-value="">
                    <span class="cd-multi-checkbox">
                        ${selectedVals.length === 0 ? '✓' : ''}
                    </span>
                    <span>הכל</span>
                </div>
                ${optionsHtml}
            </div>
        </div>
    </td>`;
                }

                case 'team': {
                    const teams = [
                        ...new Set(
                            this.filteredChanges
                                .map(c => c.executingTeam || '')
                                .filter(v => v.trim() !== '')
                        )
                    ].sort();

                    const selectedVals = Array.isArray(this.columnFilters[col.key])
                        ? this.columnFilters[col.key]
                        : (this.columnFilters[col.key] ? [this.columnFilters[col.key]] : []);

                    const hasActive = selectedVals.length > 0;
                    const displayText = hasActive ? selectedVals.join(', ') : 'הכל';

                    const allSelected = selectedVals.length === 0; // אם אין סינון = הכל נבחר
                    const optionsHtml = teams.map(s => `
                    <div class="cd-multi-option ${(allSelected || selectedVals.includes(s)) ? 'cd-multi-option--selected' : ''}"
                        data-value="${this.escHtml(s)}">
                        <span class="cd-multi-checkbox">
                            ${(allSelected || selectedVals.includes(s)) ? '✓' : ''}
                        </span>
                        <span>${this.escHtml(s)}</span>
                    </div>
                `).join('');

                    return `<td class="cd-col-filter-cell">
        <div class="cd-multi-select-wrap" data-filter-col="${col.key}">
            <div class="cd-multi-select-trigger ${hasActive ? 'cd-multi-select-trigger--active' : ''}"
                 data-filter-col="${col.key}">
                <span class="cd-multi-select-text">${this.escHtml(displayText)}</span>
                ${hasActive ? `<span class="cd-multi-select-count">${selectedVals.length}</span>` : ''}
                <i class="fas fa-chevron-down cd-multi-select-arrow"></i>
            </div>
            <div class="cd-multi-select-dropdown" style="display:none;">
                <div class="cd-multi-option cd-multi-option--all" data-value="">
                    <span class="cd-multi-checkbox">
                        ${selectedVals.length === 0 ? '✓' : ''}
                    </span>
                    <span>הכל</span>
                </div>
                ${optionsHtml}
            </div>
        </div>
    </td>`;
                }

                //  תאריכים - date picker עם לוח שנה
                case 'date':
                case 'endDate': {
                    // המר ערך שמור (dd/mm/yyyy) ל-yyyy-mm-dd לשדה input[type=date]
                    const inputVal = this._colFilterDateToInput(currentVal);
                    const displayVal = currentVal || '';
                    const colKey = col.key;

                    return `<td class="cd-col-filter-cell">
                    <div class="cd-col-filter-date-wrap"
                         data-filter-col="${colKey}">

                        <!-- שדה תצוגה - לחיצה פותחת picker -->
                        <div class="cd-col-filter-date-display
                             ${currentVal ? 'cd-col-filter-date-display--active' : ''}"
                             data-filter-col="${colKey}"
                             title="בחר תאריך">
                            <i class="fas fa-calendar-alt
                               cd-col-filter-date-icon"></i>
                            <span class="cd-col-filter-date-text">
                                ${displayVal || 'תאריך'}
                            </span>
                            ${currentVal
                            ? `<button class="cd-col-filter-date-clear"
                                    data-filter-col="${colKey}"
                                    title="נקה תאריך">
                                    <i class="fas fa-times"></i>
                                   </button>`
                            : ''}
                        </div>

                        <!-- input נסתר -->
                        <input
                            type="date"
                            class="cd-col-filter-date-input"
                            data-filter-col="${colKey}"
                            value="${inputVal}"
                        />
                    </div>
                </td>`;
                }


                case 'risk': {
                    const riskOptions = [
                        { value: 'סיכון', label: '⚠️ סיכון גבוה' },
                        { value: 'התנגשות', label: '⚡ התנגשות' }
                    ];

                    const selectedVals = Array.isArray(this.columnFilters[col.key])
                        ? this.columnFilters[col.key]
                        : (this.columnFilters[col.key] ? [this.columnFilters[col.key]] : []);

                    const hasActive = selectedVals.length > 0;
                    const displayText = hasActive ? selectedVals.join(', ') : 'הכל';

                    const allSelected = selectedVals.length === 0; // אם אין סינון = הכל נבחר
                    const optionsHtml = riskOptions.map(opt => `
                    <div class="cd-multi-option ${(allSelected || selectedVals.includes(opt.value)) ? 'cd-multi-option--selected' : ''}"
                        data-value="${this.escHtml(opt.value)}">
                        <span class="cd-multi-checkbox">
                            ${(allSelected || selectedVals.includes(opt.value)) ? '✓' : ''}
                        </span>
                        <span>${this.escHtml(opt.value)}</span>
                    </div>
                `).join('');

                    return `<td class="cd-col-filter-cell">
        <div class="cd-multi-select-wrap" data-filter-col="${col.key}">
            <div class="cd-multi-select-trigger ${hasActive ? 'cd-multi-select-trigger--active' : ''}"
                 data-filter-col="${col.key}">
                <span class="cd-multi-select-text">${this.escHtml(displayText)}</span>
                ${hasActive ? `<span class="cd-multi-select-count">${selectedVals.length}</span>` : ''}
                <i class="fas fa-chevron-down cd-multi-select-arrow"></i>
            </div>
            <div class="cd-multi-select-dropdown" style="display:none;">
                <div class="cd-multi-option cd-multi-option--all" data-value="">
                    <span class="cd-multi-checkbox">
                        ${selectedVals.length === 0 ? '✓' : ''}
                    </span>
                    <span>הכל</span>
                </div>
                ${optionsHtml}
            </div>
        </div>
    </td>`;
                }

                default:
                    return `<td class="cd-col-filter-cell"></td>`;
            }
        });

        const hasActiveFilters = Object.values(this.columnFilters || {})
            .some(v => v && String(v).trim() !== '');

        return `<tr class="cd-col-filter-row" id="cdColFilterRow">
        <td class="cd-col-filter-cell cd-col-filter-row-num">
            ${hasActiveFilters
                ? `<button class="cd-col-filter-clear-all"
                    id="cdClearColFilters"
                    title="נקה את כל סינוני העמודות">
                    <i class="fas fa-filter-circle-xmark"></i>
                   </button>`
                : `<i class="fas fa-filter cd-col-filter-row-icon"
                    title="סינון עמודות"></i>`}
        </td>
        ${cells.join('')}
    </tr>`;
    }

    // אתחול אירועי סינון עמודות
    _initColumnFilterEvents(content) {
        if (!this.columnFilters) {
            this.columnFilters = this.loadColumnFilters();
        }

        // ---- input חופשי - debounce ----
        content.querySelectorAll('.cd-col-filter-input').forEach(input => {
            let timer = null;
            input.addEventListener('input', () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const col = input.getAttribute('data-filter-col');
                    const val = input.value.trim();
                    if (val) {
                        this.columnFilters[col] = val;
                    } else {
                        delete this.columnFilters[col];
                    }
                    this.saveColumnFilters();
                    this.tablePage = 1;
                    this.renderTableView();
                }, 300);
            });

            // Enter מיידי
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(timer);
                    const col = input.getAttribute('data-filter-col');
                    const val = input.value.trim();
                    if (val) {
                        this.columnFilters[col] = val;
                    } else {
                        delete this.columnFilters[col];
                    }
                    this.saveColumnFilters();
                    this.tablePage = 1;
                    this.renderTableView();
                }
            });
        });

        // ---- select ----
        content.querySelectorAll('.cd-col-filter-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const col = sel.getAttribute('data-filter-col');
                const val = sel.value;
                if (val) {
                    this.columnFilters[col] = val;
                } else {
                    delete this.columnFilters[col];
                }
                this.saveColumnFilters();
                this.tablePage = 1;
                this.renderTableView();
            });
        });

        // ---- כפתורי ניקוי לכל עמודה (text inputs) ----
        content.querySelectorAll('.cd-col-filter-clear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const col = btn.getAttribute('data-filter-col');
                delete this.columnFilters[col];
                this.saveColumnFilters();
                this.tablePage = 1;
                this.renderTableView();
            });
        });

        // ---- Date picker - לחיצה על שדה התצוגה ----
        content.querySelectorAll('.cd-col-filter-date-display').forEach(display => {
            display.addEventListener('click', (e) => {
                // אם לחצו על כפתור הניקוי - אל תפתח picker
                if (e.target.closest('.cd-col-filter-date-clear')) return;

                const col = display.getAttribute('data-filter-col');
                const wrap = display.closest('.cd-col-filter-date-wrap');
                const hiddenInput = wrap?.querySelector(
                    `.cd-col-filter-date-input[data-filter-col="${col}"]`
                );

                if (hiddenInput) {
                    // פתח את ה-date picker
                    try {
                        hiddenInput.showPicker?.();
                    } catch {
                        hiddenInput.click();
                    }
                }
            });
        });

        // ---- Date picker - שינוי ערך ----
        content.querySelectorAll('.cd-col-filter-date-input').forEach(input => {
            input.addEventListener('change', () => {
                const col = input.getAttribute('data-filter-col');
                const val = input.value; // yyyy-mm-dd

                if (val) {
                    // שמור בפורמט dd/mm/yyyy לעקביות עם שאר הסינונים
                    const displayVal = this._colFilterInputToDisplay(val);
                    this.columnFilters[col] = displayVal;
                } else {
                    delete this.columnFilters[col];
                }

                this.saveColumnFilters();
                this.tablePage = 1;
                this.renderTableView();
            });
        });

        // ---- ניקוי תאריך ----
        content.querySelectorAll('.cd-col-filter-date-clear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const col = btn.getAttribute('data-filter-col');
                delete this.columnFilters[col];
                this.saveColumnFilters();
                this.tablePage = 1;
                this.renderTableView();
            });
        });

        // ---- ניקוי כל הסינונים ----
        document.getElementById('cdClearColFilters')
            ?.addEventListener('click', () => {
                this.clearColumnFilters();
                this.tablePage = 1;
                this.renderTableView();
            });

        // ---- Multi-select dropdowns ----
        content.querySelectorAll('.cd-multi-select-trigger').forEach(trigger => {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const col = trigger.getAttribute('data-filter-col');
                const wrap = trigger.closest('.cd-multi-select-wrap');
                const dropdown = wrap?.querySelector('.cd-multi-select-dropdown');
                if (!dropdown) return;

                // סגור כל שאר ה-dropdowns
                content.querySelectorAll('.cd-multi-select-dropdown').forEach(d => {
                    if (d !== dropdown) d.style.display = 'none';
                });

                const isOpen = dropdown.style.display !== 'none';
                dropdown.style.display = isOpen ? 'none' : 'block';
                trigger.querySelector('.cd-multi-select-arrow')
                    ?.classList.toggle('cd-multi-select-arrow--open', !isOpen);
            });
        });

        content.querySelectorAll('.cd-multi-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation(); // *** חשוב: מונע סגירה ***
                const wrap = option.closest('.cd-multi-select-wrap');
                const col = wrap?.getAttribute('data-filter-col');
                if (!col) return;

                const val = option.getAttribute('data-value');

                if (val === '') {
                    // "הכל" - נקה סינון
                    delete this.columnFilters[col];
                } else {
                    let current = Array.isArray(this.columnFilters[col])
                        ? [...this.columnFilters[col]]
                        : (this.columnFilters[col] ? [this.columnFilters[col]] : []);

                    if (current.includes(val)) {
                        current = current.filter(v => v !== val);
                    } else {
                        current.push(val);
                    }

                    if (current.length === 0) {
                        delete this.columnFilters[col];
                    } else {
                        this.columnFilters[col] = current;
                    }
                }

                this.saveColumnFilters();
                this.tablePage = 1;

                // *** רנדר מחדש רק את שורת הסינון - לא את כל הטבלה ***
                this._refreshColumnFilterRow(content, col);
            });
        });

        // סגור dropdowns בלחיצה מחוץ - רק אם לא על dropdown
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.cd-multi-select-wrap')) {
                content.querySelectorAll('.cd-multi-select-dropdown')
                    .forEach(d => d.style.display = 'none');
                content.querySelectorAll('.cd-multi-select-arrow')
                    .forEach(a => a.classList.remove('cd-multi-select-arrow--open'));
            }
        });

        // סגור dropdowns בלחיצה מחוץ
        document.addEventListener('click', () => {
            content.querySelectorAll('.cd-multi-select-dropdown')
                .forEach(d => d.style.display = 'none');
        }, { once: false });
    }

    _refreshColumnFilterRow(content, changedCol) {
        // רנדר מחדש רק את שורת הסינון ואת הטבלה
        // שמור איזה dropdown פתוח
        const openDropdowns = new Set();
        content.querySelectorAll('.cd-multi-select-dropdown').forEach(d => {
            if (d.style.display !== 'none') {
                const wrap = d.closest('.cd-multi-select-wrap');
                const col = wrap?.getAttribute('data-filter-col');
                if (col) openDropdowns.add(col);
            }
        });

        // רנדר מחדש את כל הטבלה
        this.renderTableView();

        // פתח מחדש את ה-dropdown שהיה פתוח
        setTimeout(() => {
            openDropdowns.forEach(col => {
                const wrap = content.querySelector(
                    `.cd-multi-select-wrap[data-filter-col="${col}"]`
                );
                const dropdown = wrap?.querySelector('.cd-multi-select-dropdown');
                const arrow = wrap?.querySelector('.cd-multi-select-arrow');
                if (dropdown) {
                    dropdown.style.display = 'block';
                    arrow?.classList.add('cd-multi-select-arrow--open');
                }
            });
        }, 0);
    }

    // -------------------------------------------------------
    // renderTableView - מתוקן עם סדר עמודות חדש + drag & drop
    // -------------------------------------------------------
    renderTableView() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const conflicts = this.detectConflicts(this.filteredChanges);

        // אתחל סינוני עמודות אם לא קיימים
        if (!this.columnFilters) {
            this.columnFilters = this.loadColumnFilters();
        }

        const activeCols = this._getActiveColumns();

        // החל סינוני עמודות
        const colFilteredChanges = this.applyColumnFilters(this.filteredChanges);

        // ספירת סינונים פעילים
        const activeColFilterCount = Object.values(this.columnFilters || {})
            .filter(v => {
                if (Array.isArray(v)) return v.length > 0;
                return v && String(v).trim() !== '';
            }).length;

        // מיון
        const col = this.tableSort.column;
        const dir = this.tableSort.direction === 'asc' ? 1 : -1;

        const sorted = [...colFilteredChanges].sort((a, b) => {
            let va, vb;
            switch (col) {
                case 'number':
                    va = a.number || ''; vb = b.number || '';
                    return va.localeCompare(vb, 'he') * dir;
                case 'name':
                    va = a.name || ''; vb = b.name || '';
                    return va.localeCompare(vb, 'he') * dir;
                case 'date':
                    va = this.parseDate(this._getEffectiveStartTime(a));
                    vb = this.parseDate(this._getEffectiveStartTime(b));
                    if (!va && !vb) return 0;
                    if (!va) return 1 * dir;
                    if (!vb) return -1 * dir;
                    return (va - vb) * dir;
                case 'endDate':
                    va = this.parseDate(this._getEffectiveEndTime(a));
                    vb = this.parseDate(this._getEffectiveEndTime(b));
                    if (!va && !vb) return 0;
                    if (!va) return 1 * dir;
                    if (!vb) return -1 * dir;
                    return (va - vb) * dir;
                case 'system':
                    va = a.system || ''; vb = b.system || '';
                    return va.localeCompare(vb, 'he') * dir;
                case 'status':
                    va = this.mapStatus(a.status) || '';
                    vb = this.mapStatus(b.status) || '';
                    return va.localeCompare(vb, 'he') * dir;
                case 'team':
                    va = a.executingTeam || ''; vb = b.executingTeam || '';
                    return va.localeCompare(vb, 'he') * dir;
                default:
                    return 0;
            }
        });

        // pagination
        const totalItems = sorted.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / this.tablePageSize));
        if (this.tablePage > totalPages) this.tablePage = totalPages;
        const startIdx = (this.tablePage - 1) * this.tablePageSize;
        const endIdx = Math.min(startIdx + this.tablePageSize, totalItems);
        const pageItems = sorted.slice(startIdx, endIdx);

        // ---- בניית כותרות עמודות עם drag & drop ----
        const thHtml = activeCols.map((c, colIdx) => {
            if (!c.sortable) {
                return `<th class="cd-th-nosort cd-th-draggable"
                        draggable="true"
                        data-col-key="${c.key}"
                        data-col-idx="${colIdx}">
                        <span class="cd-th-drag-handle" title="גרור לשינוי סדר">
                            <i class="fas fa-grip-vertical"></i>
                        </span>
                        ${c.label}
                    </th>`;
            }
            const isActive = this.tableSort.column === c.key;
            const arrow = isActive
                ? (this.tableSort.direction === 'asc'
                    ? '<i class="fas fa-sort-up cd-sort-icon cd-sort-active"></i>'
                    : '<i class="fas fa-sort-down cd-sort-icon cd-sort-active"></i>')
                : '<i class="fas fa-sort cd-sort-icon"></i>';
            return `<th class="cd-th-sort cd-th-draggable ${isActive ? 'cd-th-active' : ''}"
                    data-col="${c.key}"
                    data-col-key="${c.key}"
                    data-col-idx="${colIdx}"
                    draggable="true">
                    <span class="cd-th-drag-handle" title="גרור לשינוי סדר">
                        <i class="fas fa-grip-vertical"></i>
                    </span>
                    ${c.label} ${arrow}
                </th>`;
        }).join('');

        // ---- בניית שורות לפי סדר עמודות פעיל ----
        let rowsHtml = '';
        if (pageItems.length === 0) {
            rowsHtml = `<tr>
            <td colspan="${activeCols.length + 1}" class="cd-table-empty">
                <i class="fas fa-search"></i>
                <span>לא נמצאו שינויים</span>
            </td>
        </tr>`;
        } else {
            pageItems.forEach((c, idx) => {
                const rc = this.isHighRisk(c) ? ' cd-row-risk' : '';
                const cc = conflicts.has(c.number) ? ' cd-row-conflict' : '';
                const rowNum = startIdx + idx + 1;

                // בנה תאים לפי סדר העמודות הפעיל
                const cellsHtml = activeCols.map(col => {
                    switch (col.key) {
                        case 'number':
                            return `<td class="cd-td-number">
                            ${c.link
                                    ? `<a href="${this.escHtml(c.link)}"
                                      target="_blank"
                                      class="cd-link"
                                      onclick="event.stopPropagation()">
                                       <i class="fas fa-external-link-alt cd-link-icon"></i>
                                       ${this.escHtml(c.number)}
                                   </a>`
                                    : `<span class="cd-td-num-plain">${this.escHtml(c.number)}</span>`}
                        </td>`;

                        case 'status':
                            return `<td class="cd-td-status">
                            <span class="cd-status-badge ${this.getStatusClass(c.status)}">
                                ${this.escHtml(this.mapStatus(c.status))}
                            </span>
                        </td>`;

                        case 'date':
                            return `<td class="cd-td-date">
                            <span class="cd-date-chip">
                                <i class="fas fa-calendar-alt"></i>
                                ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(c)))}
                            </span>
                        </td>`;

                        case 'endDate':
                            return `<td class="cd-td-date">
                                ${this._getEffectiveEndTime(c)
                                    ? `<span class="cd-date-chip cd-date-chip--end">
                                        <i class="fas fa-flag-checkered"></i>
                                        ${this.escHtml(this.formatDateDisplay(this._getEffectiveEndTime(c)))}
                                    </span>`
                                    : '<span class="cd-td-empty">—</span>'}
                            </td>`;

                        case 'system':
                            return `<td class="cd-td-system">
                            ${c.system
                                    ? `<span class="cd-system-chip">
                                       <i class="fas fa-server"></i>
                                       ${this.escHtml(this._extractSystemName(c.system))}
                                   </span>`
                                    : '<span class="cd-td-empty">—</span>'}
                        </td>`;

                        case 'name':
                            return `<td class="cd-td-name"
                                    title="${this.escHtml(c.name || '')}">
                            ${this.escHtml(this.truncate(c.name, 120))}
                        </td>`;

                        case 'team':
                            return `<td class="cd-td-team">
                            ${c.executingTeam
                                    ? `<span class="cd-team-chip">
                                       <i class="fas fa-users"></i>
                                       ${this.escHtml(c.executingTeam)}
                                   </span>`
                                    : '<span class="cd-td-empty">—</span>'}
                        </td>`;

                        case 'risk':
                            return `<td class="cd-td-center">
                            ${this.isHighRisk(c)
                                    ? '<span class="cd-risk-badge-sm" title="סיכון גבוה"><i class="fas fa-exclamation-triangle"></i></span>'
                                    : ''}
                            ${conflicts.has(c.number)
                                    ? '<span class="cd-conflict-badge-sm" title="התנגשות"><i class="fas fa-bolt"></i></span>'
                                    : ''}
                        </td>`;

                        default:
                            return '<td></td>';
                    }
                }).join('');

                rowsHtml += `
            <tr class="cd-table-row${rc}${cc}"
                data-number="${this.escHtml(c.number)}">
                <td class="cd-td-rownum">${rowNum}</td>
                ${cellsHtml}
            </tr>`;
            });
        }

        // pagination HTML
        const paginationHtml = this._buildPaginationHtml(
            totalPages, totalItems, startIdx, endIdx
        );

        // page size selector
        const pageSizeOptions = [10, 20, 50, 100].map(n =>
            `<option value="${n}" ${this.tablePageSize === n ? 'selected' : ''}>${n}</option>`
        ).join('');

        // כפתור איפוס סדר עמודות
        const hasSavedOrder = !!this.loadColumnOrder();
        const resetColBtnHtml = hasSavedOrder
            ? `<button class="cd-reset-col-order-btn" id="cdResetColOrder"
                title="איפוס סדר עמודות לברירת מחדל">
                <i class="fas fa-rotate-left"></i>
                איפוס סדר עמודות
           </button>`
            : '';

        content.innerHTML = `
    <div class="cd-table-view">

        <!-- כותרת + בקרות -->
        <div class="cd-table-toolbar">
            <div class="cd-table-toolbar-right">
                <div class="cd-table-total-badge">
                    <i class="fas fa-list"></i>
                    <span>${colFilteredChanges.length} שינויים
                        ${activeColFilterCount > 0
                ? `<span class="cd-col-filter-active-badge">
                                (${activeColFilterCount} סינוני עמודות)
                            </span>`
                : ''}
                    </span>
                </div>
                ${conflicts.size > 0
                ? `<div class="cd-table-conflict-badge">
                           <i class="fas fa-bolt"></i>
                           ${conflicts.size} התנגשויות
                       </div>`
                : ''}
                ${this.filteredChanges.filter(c => this.isHighRisk(c)).length > 0
                ? `<div class="cd-table-risk-badge">
                           <i class="fas fa-exclamation-triangle"></i>
                           ${this.filteredChanges.filter(c => this.isHighRisk(c)).length} סיכון גבוה
                       </div>`
                : ''}
                ${resetColBtnHtml}
            </div>
            <div class="cd-table-toolbar-left">
                <span class="cd-col-order-hint">
                    <i class="fas fa-grip-vertical"></i>
                    גרור כותרות לשינוי סדר עמודות
                </span>
                <label class="cd-pagesize-label">
                    שורות בעמוד:
                    <select class="cd-pagesize-select" id="cdTablePageSize">
                        ${pageSizeOptions}
                    </select>
                </label>
            </div>
        </div>

        <!-- טבלה -->
        <div class="cd-table-wrap">
            <table class="cd-table" id="cdMainTable">
                <thead>
                    <tr id="cdTableHeaderRow">
                        <th class="cd-th-nosort cd-th-rownum">#</th>
                        ${thHtml}
                    </tr>
                    ${this._buildColumnFilterRowHtml(activeCols)}
                </thead>
                <tbody id="cdTableBody">
                    ${rowsHtml}
                </tbody>
            </table>
        </div>

        <!-- pagination -->
        ${paginationHtml}

    </div>`;

        // ---- אירועי מיון ----
        content.querySelectorAll('.cd-th-sort').forEach(th => {
            th.addEventListener('click', (e) => {
                // אל תמיין אם לחצו על ידית הגרירה
                if (e.target.closest('.cd-th-drag-handle')) return;
                const colKey = th.getAttribute('data-col');
                if (!colKey) return;
                if (this.tableSort.column === colKey) {
                    this.tableSort.direction =
                        this.tableSort.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    this.tableSort.column = colKey;
                    this.tableSort.direction = 'asc';
                }
                this.tablePage = 1;
                this.renderTableView();
            });
        });

        // ---- אירועי pagination ----
        content.querySelectorAll('.cd-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = parseInt(btn.getAttribute('data-page'));
                if (!isNaN(p) && p !== this.tablePage) {
                    this.tablePage = p;
                    this.renderTableView();
                    content.querySelector('.cd-table-wrap')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });

        // ---- page size ----
        document.getElementById('cdTablePageSize')
            ?.addEventListener('change', (e) => {
                this.tablePageSize = parseInt(e.target.value);
                this.tablePage = 1;
                this.renderTableView();
            });

        // ---- קליק על שורה ----
        content.querySelectorAll('.cd-table-row').forEach(row => {
            row.addEventListener('click', () => {
                const c = this.allChanges.find(
                    x => x.number === row.getAttribute('data-number'));
                if (c) this.showChangePopup(c);
            });
        });

        // ---- איפוס סדר עמודות ----
        document.getElementById('cdResetColOrder')
            ?.addEventListener('click', () => {
                if (confirm('לאפס את סדר העמודות לברירת מחדל?')) {
                    this.clearColumnOrder();
                    this._showColOrderSaveIndicator('סדר עמודות אופס');
                    this.renderTableView();
                }
            });

        // ---- Drag & Drop לסדר עמודות ----
        this._initColumnDragSort(content);

        // אתחל אירועי סינון עמודות
        this._initColumnFilterEvents(content);
    }

    // -------------------------------------------------------
    // Drag & Drop לסדר עמודות בטבלה
    // -------------------------------------------------------
    _initColumnDragSort(content) {
        const headerRow = content.querySelector('#cdTableHeaderRow');
        if (!headerRow) return;

        // אסוף רק th עם data-col-key (לא עמודת #)
        const ths = Array.from(
            headerRow.querySelectorAll('th[data-col-key]')
        );

        let dragSrcKey = null;
        let dragSrcIdx = null;

        ths.forEach(th => {
            th.addEventListener('dragstart', (e) => {
                dragSrcKey = th.getAttribute('data-col-key');
                dragSrcIdx = parseInt(th.getAttribute('data-col-idx'));
                th.classList.add('cd-th-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', dragSrcKey);
            });

            th.addEventListener('dragend', () => {
                th.classList.remove('cd-th-dragging');
                ths.forEach(t => t.classList.remove('cd-th-drag-over'));
            });

            th.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                ths.forEach(t => t.classList.remove('cd-th-drag-over'));
                if (th.getAttribute('data-col-key') !== dragSrcKey) {
                    th.classList.add('cd-th-drag-over');
                }
            });

            th.addEventListener('dragleave', () => {
                th.classList.remove('cd-th-drag-over');
            });

            th.addEventListener('drop', (e) => {
                e.preventDefault();
                th.classList.remove('cd-th-drag-over');

                const dropKey = th.getAttribute('data-col-key');
                if (!dragSrcKey || dragSrcKey === dropKey) return;

                // קבל סדר נוכחי
                const currentCols = this._getActiveColumns();
                const srcIdx = currentCols.findIndex(c => c.key === dragSrcKey);
                const dstIdx = currentCols.findIndex(c => c.key === dropKey);

                if (srcIdx === -1 || dstIdx === -1) return;

                // הזז
                const newOrder = currentCols.map(c => c.key);
                const [moved] = newOrder.splice(srcIdx, 1);
                newOrder.splice(dstIdx, 0, moved);

                // שמור
                this.saveColumnOrder(newOrder);
                this._showColOrderSaveIndicator('סדר עמודות נשמר');

                // רנדר מחדש
                this.renderTableView();
            });
        });
    }

    // -------------------------------------------------------
    // אינדיקטור שמירת סדר עמודות
    // -------------------------------------------------------
    _showColOrderSaveIndicator(msg = 'נשמר') {
        document.getElementById('cdColOrderIndicator')?.remove();

        const el = document.createElement('div');
        el.id = 'cdColOrderIndicator';
        el.innerHTML = `<i class="fas fa-check-circle"></i> <span>${msg}</span>`;
        el.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        border: 1px solid #374151;
        border-right: 3px solid #22c55e;
        border-radius: 8px;
        padding: 8px 16px;
        color: #4ade80;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 7px;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        white-space: nowrap;
        direction: rtl;
        animation: cdFadeIn 0.2s ease;
    `;
        document.body.appendChild(el);

        setTimeout(() => {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 2000);
    }

    // -------------------------------------------------------
    // CAB Order Cache - LocalStorage
    // -------------------------------------------------------

    // מפתח ייחודי לפי משתמש (אם קיים)
    _getCabCacheKey() {
        const user = this.currentUser || 'default';
        return `cab_order_${user}`;
    }

    // שמירת הסדר הנוכחי
    saveCabOrder() {
        try {
            // שמור רק את מספרי השינויים לפי הסדר
            const order = this.cabChanges.map(c => c.number);
            const key = this._getCabCacheKey();

            const payload = {
                order,
                savedAt: new Date().toISOString(),
                changeIds: order  // גיבוי
            };

            localStorage.setItem(key, JSON.stringify(payload));
            console.log(`[CAB] סדר נשמר: ${order.length} שינויים`);
        } catch (err) {
            console.warn('[CAB] שגיאה בשמירת סדר:', err);
            this._showErrorIndicator('[CAB] שגיאה בשמירת סדר');
        }
    }

    // טעינת הסדר השמור
    loadCabOrder() {
        try {
            const key = this._getCabCacheKey();
            const raw = localStorage.getItem(key);
            if (!raw) return null;

            const payload = JSON.parse(raw);

            // בדוק תקינות
            if (!Array.isArray(payload.order) || payload.order.length === 0) {
                return null;
            }

            return payload;
        } catch (err) {
            console.warn('[CAB] שגיאה בטעינת סדר:', err);
            this._showErrorIndicator('[CAB] שגיאה בטעינת סדר');
            return null;
        }
    }

    // החלת הסדר השמור על רשימת שינויים
    applySavedCabOrder(changes) {
        const payload = this.loadCabOrder();
        if (!payload) return changes;

        const savedOrder = payload.order;

        // בנה מפה: number → change
        const map = new Map(changes.map(c => [c.number, c]));

        const sorted = [];
        const unsorted = [];

        // קודם כל - שינויים שיש להם מיקום שמור, לפי הסדר
        savedOrder.forEach(num => {
            if (map.has(num)) {
                sorted.push(map.get(num));
                map.delete(num);
            }
        });

        // שינויים חדשים שלא היו בסדר השמור - הוסף בסוף
        map.forEach(c => unsorted.push(c));

        const result = [...sorted, ...unsorted];

        if (unsorted.length > 0) {
            console.log(
                `[CAB] ${unsorted.length} שינויים חדשים נוספו לסוף הרשימה`
            );
        }

        return result;
    }

    // ניקוי הסדר השמור
    clearCabOrder() {
        try {
            localStorage.removeItem(this._getCabCacheKey());
            console.log('[CAB] סדר נוקה');
        } catch (err) {
            console.warn('[CAB] שגיאה בניקוי סדר:', err);
            this._showErrorIndicator('[CAB] שגיאה בניקוי סדר');
        }
    }

    // -------------------------------------------------------
    // CAB Decisions - ניהול החלטות
    // -------------------------------------------------------
    _getCabWeekKey() {
        const now = new Date();
        // חישוב מספר שבוע ISO
        const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }

    _getCabDecisionsKey() {
        const user = this.currentUser || 'default';
        return `cab_decisions_${user}`;
    }

    async loadCabDecisions() {
        try {
            const response = await fetch('/Changes/GetCabDecisions');
            const data = await response.json();
            if (!data.success) return {};

            const decisions = data.decisions || {};
            const normalized = {};

            Object.entries(decisions).forEach(([key, val]) => {
                const status = val.status || val.Status || '';
                // *** דלג על החלטות שאופסו ***
                if (status === 'reset' || status === '') return;

                normalized[key] = {
                    changeNumber: val.changeNumber || val.ChangeNumber || '',
                    status: status,
                    notes: val.notes || val.Notes || '',
                    weekKey: val.weekKey || val.WeekKey || '',
                    timestamp: val.decisionDate || val.DecisionDate ||
                        val.timestamp || '',
                    decidedBy: val.decidedBy || val.DecidedBy || ''
                };
            });

            return normalized;
        } catch (err) {
            console.warn('[CAB] שגיאה בטעינת החלטות:', err);
            return {};
        }
    }

    saveCabDecisions(decision) {
        fetch('/Changes/SaveCabDecision', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(decision)
        })
            .catch(err => {
                console.warn('[CAB] שגיאה בשמירת החלטות:', err);
                this._showErrorIndicator('[CAB] שגיאה בשמירת החלטות');
            });
    }

    _showErrorIndicator(msg) {
        document.getElementById('cdErrorIndicator')?.remove();

        const el = document.createElement('div');
        el.id = 'cdErrorIndicator';
        el.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <span>${msg}</span>`;
        el.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        border: 1px solid #374151;
        border-right: 3px solid #ef4444;
        border-radius: 8px;
        padding: 10px 18px;
        color: #f87171;
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        white-space: nowrap;
        direction: rtl;
        max-width: 500px;
        white-space: normal;
    `;
        document.body.appendChild(el);

        setTimeout(() => {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 5000);
    }

    // שמירת החלטה בודדת לשרת
    async _saveDecisionToServer(decision) {
        if (!decision || !decision.changeNumber || !decision.status) {
            console.warn('[CAB] החלטה לא תקינה:', decision);
            this._showErrorIndicator('[CAB] החלטה לא תקינה - לא נשלחה לשרת');
            return;
        }

        // *** תיקון: DecidedBy - חלץ רק את שם המשתמש ***
        const decidedByStr = (() => {
            const db = decision.decidedBy || this.currentUser;
            if (!db) return 'unknown';
            // אם זה אובייקט - חלץ את השם
            if (typeof db === 'object') {
                return db.displayName || db.username || db.userId || 'unknown';
            }
            // אם זה string - החזר כמו שהוא
            return String(db);
        })();

        const payload = {
            ChangeNumber: decision.changeNumber,
            Status: decision.status,
            Notes: decision.notes || '',
            WeekKey: decision.weekKey || '',
            DecidedBy: decidedByStr,  // *** תמיד string ***
            DecisionDate: decision.timestamp || new Date().toISOString()
        };

        console.log('[CAB] 📤 שולח לשרת:', JSON.stringify(payload));

        try {
            const response = await fetch('/Changes/SaveCabDecision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            console.log('[CAB] 📥 תשובה:', data);

            if (!data.success) {
                console.error('[CAB] ❌ שגיאה:', data.message);
                this._showErrorIndicator(`שגיאה: ${data.message}`);
            } else {
                console.log('[CAB] ✅ נשמר בהצלחה');
            }

        } catch (err) {
            console.error('[CAB] ❌ שגיאת תקשורת:', err);
            this._showErrorIndicator(`שגיאת תקשורת: ${err.message}`);
        }
    }

    // ניקוי ישן - לא שולח לשרת (רק מנקה זיכרון מקומי)
    _cleanOldDecisions() {
        const allKeys = Object.keys(this.cabDecisions);
        const weeks = [...new Set(
            allKeys.map(k => this.cabDecisions[k]?.weekKey).filter(Boolean)
        )].sort();

        const toKeep = weeks.slice(-4);
        const cleaned = {};

        allKeys.forEach(k => {
            const d = this.cabDecisions[k];
            if (d && toKeep.includes(d.weekKey)) {
                cleaned[k] = d;
            }
        });

        this.cabDecisions = cleaned;
    }

    // קבלת החלטה לשינוי ספציפי בשבוע הנוכחי
    getCabDecision(changeNumber) {
        const weekKey = this._getCabWeekKey();
        const key = `${weekKey}_${changeNumber}`;
        return this.cabDecisions[key] || null;
    }

    // מחזיר את כל ההחלטות לשינוי ספציפי, ממוינות מהחדשה לישנה
    getAllCabDecisions(changeNumber) {
        return Object.values(this.cabDecisions)
            .filter(d => d.changeNumber === changeNumber && d.status && d.status !== 'pending')
            .sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            });
    }

    // Returns the most recent CAB decision for a change number, regardless of week
    getLastCabDecision(changeNumber) {
        const allDecisions = Object.values(this.cabDecisions)
            .filter(d => d.changeNumber === changeNumber && d.status && d.status !== 'pending');

        if (allDecisions.length === 0) return null;

        // Sort by timestamp descending - return the most recent
        allDecisions.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });

        return allDecisions[0];
    }

    // שמירת החלטה
    setCabDecision(changeNumber, status, notes) {
        const weekKey = this._getCabWeekKey();
        const key = `${weekKey}_${changeNumber}`;

        // *** ולידציה לפני שמירה ***
        if (!changeNumber || !status) {
            this._showErrorIndicator('[CAB] נתונים חסרים - לא נשמר');
            return;
        }

        const decision = {
            changeNumber,
            status,
            notes: notes || '',
            weekKey,
            timestamp: new Date().toISOString(),
            decidedBy: this.currentUser || 'unknown'
        };

        this.cabDecisions[key] = decision;
        this._saveDecisionToServer(decision);

        console.log(`[CAB] החלטה נשמרה: ${changeNumber} → ${status}`);
    }

    // האם שינוי כבר טופל השבוע
    isDecided(changeNumber) {
        const d = this.getCabDecision(changeNumber);
        return d && d.status && d.status !== 'pending';
    }

    // קבלת כל ההחלטות של השבוע הנוכחי
    getCurrentWeekDecisions() {
        const weekKey = this._getCabWeekKey();
        const result = {};

        Object.entries(this.cabDecisions).forEach(([key, val]) => {
            if (val.weekKey === weekKey) {
                result[val.changeNumber] = val;
            }
        });

        return result;
    }

    // בדיקה אם יש סדר שמור
    hasSavedCabOrder() {
        const payload = this.loadCabOrder();
        if (!payload) return false;

        // בדוק שלפחות חלק מהשינויים עדיין קיימים
        const currentNumbers = new Set(
            this.cabChanges.map(c => c.number)
        );
        return payload.order.some(num => currentNumbers.has(num));
    }

    // מתודה פנימית - כניסה למצב CAB ועדכון UI
    _enterCabViewMode() {
        this.viewMode = 'cab';

        // עדכן כפתורים
        this.container.querySelectorAll('.cd-view-btn').forEach(btn => {
            btn.classList.toggle('active',
                btn.getAttribute('data-view') === 'cab');
        });

        // הסתר filter bar
        const filterBar = document.getElementById('cdFilterBar');
        if (filterBar) filterBar.style.display = 'none';

        this.enterCabMode();
    }

    // fallback - סינון מקומי אם הבקאנד לא זמין
    _filterCabChangesLocally() {
        if (!this.cabDateRange) return [];

        const fromD = new Date(this.cabDateRange.fromDate);
        const toD = new Date(this.cabDateRange.toDate);
        toD.setHours(23, 59, 59, 999);

        return this.filteredChanges.filter(c => {
            const s = (c.status || '').toLowerCase().trim();
            if (s === 'cancelled' || s === 'canceled' || s === 'בוטל')
                return false;

            const needCabVal = (c.needCab || '').toLowerCase().trim();
            const isCab = needCabVal === 'cab' ||
                needCabVal === 'yes' ||
                needCabVal === 'כן';

            const cabDateObj = this.parseToDate(c.cabDate);
            const cabThisWeek = isCab && cabDateObj &&
                cabDateObj >= fromD && cabDateObj <= toD;

            var actualStartTime = (c.actualStartTime || '').trim();
            if (actualStartTime &&
                actualStartTime.toLowerCase() !== 'none' &&
                actualStartTime !== '') {
                actualStartTime = this._normalizeActualDate(c.actualStartTime);
            } else {
                actualStartTime = c.plannedStartTime || c.date;
            }

            const d = this.parseDate(actualStartTime);
            if (!d) return false;

            const activityThisWeek = d >= fromD && d <= toD;
            return cabThisWeek || activityThisWeek;
        });
    }

    async enterCabMode() {
        this.cabMode = true;
        this._cleanOldDecisions();
        this.cabWeekKey = this._getCabWeekKey();

        this.container.querySelectorAll('.cd-view-btn').forEach(btn => {
            btn.classList.toggle('active',
                btn.getAttribute('data-view') === 'cab');
        });
        this.cabNavDirection = 'next';

        let cabList = [];
        try {
            const res = await fetch('/Changes/GetCabChanges');
            const data = await res.json();

            if (data.success) {
                cabList = data.changes || [];
                if (!this.cabDateRange && data.fromDate) {
                    this.cabDateRange = {
                        from: data.from,
                        to: data.to,
                        fromDate: data.fromDate,
                        toDate: data.toDate
                    };
                }
            }
        } catch (err) {
            console.warn('[CAB] שגיאה בטעינת שינויי CAB:', err);
            cabList = this._filterCabChangesLocally();
        }

        cabList = this.applySavedCabOrder(cabList);

        // *** שמור את כל השינויים (כולל no_cab) לשימוש בסיכום ***
        this.allCabChanges = [...cabList];

        // *** סנן no_cab מהניווט הראשי ***
        this.cabChanges = cabList.filter(c => {
            const decision = this.getCabDecision(c.number);
            return !decision || decision.status !== 'no_cab';
        });

        this.cabCurrentIndex = 0;

        const panel = document.getElementById('cdCabPanel');
        if (panel) panel.style.display = 'flex';

        this.renderCabView();
    }

    _buildPaginationHtml(totalPages, totalItems, startIdx, endIdx) {
        if (totalPages <= 1) return '';

        const current = this.tablePage;
        const WINDOW = 2; // כמה עמודים מכל צד

        let pages = [];

        // תמיד הצג עמוד ראשון
        pages.push(1);

        // ... אם יש פער
        if (current - WINDOW > 2) pages.push('...');

        // עמודים סביב הנוכחי
        for (let p = Math.max(2, current - WINDOW);
            p <= Math.min(totalPages - 1, current + WINDOW); p++) {
            pages.push(p);
        }

        // ... אם יש פער
        if (current + WINDOW < totalPages - 1) pages.push('...');

        // תמיד הצג עמוד אחרון
        if (totalPages > 1) pages.push(totalPages);

        const btnHtml = pages.map(p => {
            if (p === '...') {
                return `<span class="cd-page-ellipsis">...</span>`;
            }
            return `<button class="cd-page-btn ${p === current ? 'cd-page-btn--active' : ''}"
                        data-page="${p}">${p}</button>`;
        }).join('');

        return `
    <div class="cd-pagination">
        <div class="cd-pagination-info">
            מציג ${startIdx + 1}–${endIdx} מתוך ${totalItems}
        </div>
        <div class="cd-pagination-btns">
            <button class="cd-page-btn cd-page-btn--nav ${current === 1 ? 'disabled' : ''}"
                    data-page="${current - 1}"
                    ${current === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
            ${btnHtml}
            <button class="cd-page-btn cd-page-btn--nav ${current === totalPages ? 'disabled' : ''}"
                    data-page="${current + 1}"
                    ${current === totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
        </div>
    </div>`;
    }

    exitCabMode() {
        this.cabMode = false;
        this.cabSummaryMode = false;

        // *** הסתר כפתור התחל CAB ***
        const startCabBtn = document.getElementById('cdStartCabBtn');
        if (startCabBtn) startCabBtn.style.display = 'none';

        this.closePopup();
    }

    cabNavigate(dir) {
        if (this.cabChanges.length === 0) return;

        const total = this.cabChanges.length;
        this.cabNavDirection = dir > 0 ? 'next' : 'prev';

        // חפש את הבקשה הבאה/הקודמת שלא טופלה
        let nextIdx = this.cabCurrentIndex;
        let found = false;

        for (let i = 1; i <= total; i++) {
            const candidateIdx =
                (this.cabCurrentIndex + (dir * i) + total) % total;
            const candidate = this.cabChanges[candidateIdx];

            if (!this.isDecided(candidate.number)) {
                nextIdx = candidateIdx;
                found = true;
                break;
            }
        }

        // אם לא נמצאה בקשה שלא טופלה - עבור לבאה/הקודמת בסדר רגיל
        if (!found) {
            nextIdx =
                (this.cabCurrentIndex + dir + total) % total;
        }

        this.cabCurrentIndex = nextIdx;
        this.renderCabViewAnimated();
    }

    renderCabViewAnimated() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const existing = content.querySelector('.cab2-root');
        if (!existing) {
            this.renderCabView();
            this._animateCabContentIn(content);
            return;
        }

        // ── קביעת כיוון (RTL: next = מגיע משמאל) ──
        // dir: next=1 → האלמנט החדש מגיע מ-translateX(-SLIDE_PX)
        //      prev=-1 → האלמנט החדש מגיע מ-translateX(+SLIDE_PX)
        const dir = this.cabNavDirection === 'next' ? 1 : -1;
        // ── חישוב SLIDE_PX אמין ──
        const SLIDE_PX = Math.max(content.offsetWidth || 600, 300);

        const EXIT_DURATION = 250;
        const ENTER_DURATION = 350;
        const OVERLAP = 50;

        // ── שמור גובה נוכחי למניעת קפיצה ──
        const currentHeight = content.offsetHeight;
        content.style.minHeight = currentHeight + 'px';
        content.style.position = 'relative';
        content.style.overflow = 'hidden';

        // ── שלב 1: הכן את הישן ליציאה ──
        existing.style.transition = 'none';
        existing.style.position = 'absolute';
        existing.style.inset = '0';
        existing.style.width = '100%';
        existing.style.zIndex = '1';
        existing.style.willChange = 'transform, opacity';

        // ── שלב 2: הפעל אנימציית יציאה ──
        // next: הישן יוצא לשמאל (translateX חיובי ב-RTL)
        // prev: הישן יוצא לימין (translateX שלילי ב-RTL)
        requestAnimationFrame(() => {
            existing.style.transition =
                `transform ${EXIT_DURATION}ms cubic-bezier(0.4, 0, 1, 1),` +
                `opacity   ${EXIT_DURATION}ms ease`;
            existing.style.transform = `translateX(${dir * SLIDE_PX}px)`;
            existing.style.opacity = '0';
        });

        // ── שלב 3: רנדר חדש לאחר חפיפה קצרה ──
        setTimeout(() => {
            // רנדר התוכן החדש (מחליף innerHTML)
            this.renderCabView();

            const newEl = content.querySelector('.cab2-root');
            if (!newEl) {
                // ניקוי במקרה כשל
                content.style.position = '';
                content.style.overflow = '';
                content.style.minHeight = '';
                return;
            }

            // ── הסתר את כל אלמנטי התוכן לפני הכניסה ──
            this._prepareCabElementsForAnimation(newEl);

            newEl.style.transition = 'none';
            newEl.style.transform = `translateX(${dir * -SLIDE_PX}px)`;
            newEl.style.opacity = '0';
            newEl.style.willChange = 'transform, opacity';

            // ── שלב 4: כניסה חלקה ──
            // Double RAF מובטח עם forceReflow
            requestAnimationFrame(() => {
                // Force reflow - מבטיח שהדפדפן "ראה" את המצב ההתחלתי
                void newEl.offsetHeight;

                requestAnimationFrame(() => {
                    newEl.style.transition =
                        `transform ${ENTER_DURATION}ms cubic-bezier(0.2, 0, 0.2, 1),` +
                        `opacity   ${ENTER_DURATION}ms ease`;
                    newEl.style.transform = 'translateX(0)';
                    newEl.style.opacity = '1';

                    // ── הפעל fade-in לתוכן אחרי שהכרטיס נכנס ──
                    setTimeout(() => {
                        this._animateCabContentIn(newEl);
                    }, ENTER_DURATION * 0.4); // מתחיל ב-40% מהכניסה
                });
            });

            // ── שלב 5: ניקוי אחרי הכניסה ──
            setTimeout(() => {
                newEl.style.transition = '';
                newEl.style.transform = '';
                newEl.style.opacity = '';
                newEl.style.willChange = '';
                content.style.position = '';
                content.style.overflow = '';
                content.style.minHeight = '';
            }, ENTER_DURATION + 50);

        }, EXIT_DURATION - OVERLAP);
    }

    // ── הסתר את כל אלמנטי התוכן לפני האנימציה ──
    _prepareCabElementsForAnimation(root) {
        const selectors = [
            // Topbar
            '.cab2-topbar-right',
            '.cab2-topbar-center',
            '.cab2-topbar-times',
            '.cab2-topbar-left',

            // כרטיסי גוף
            '.cab2-card',

            // שורות צוות
            '.cab2-team-row',

            // בלוקי תיאור
            '.cab2-desc',

            // פריטי סיכון
            '.cab2-risk-item',

            // thumbnails
            '.cab2-thumb',

            // pills
            '.cab2-pill',
        ];

        selectors.forEach(sel => {
            root.querySelectorAll(sel).forEach(el => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(8px)';
                el.style.transition = 'none';
            });
        });
    }

    // ── הפעל fade-in מדורג לכל האלמנטים ──
    _animateCabContentIn(root) {
        // קבוצות אנימציה עם delay שונה
        const groups = [
            {
                // קבוצה 1: Topbar - מהיר
                selectors: [
                    '.cab2-topbar-right',
                    '.cab2-topbar-center',
                    '.cab2-topbar-times',
                    '.cab2-topbar-left',
                ],
                baseDelay: 0,
                stagger: 40,   // ms בין כל אלמנט
                duration: 1050,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '-6px', // מגיע מלמעלה
            },
            {
                // קבוצה 2: כרטיסי גוף
                selectors: ['.cab2-card'],
                baseDelay: 80,
                stagger: 60,
                duration: 1020,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '12px',
            },
            {
                // קבוצה 3: שורות צוות
                selectors: ['.cab2-team-row'],
                baseDelay: 180,
                stagger: 35,
                duration: 1050,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '6px',
            },
            {
                // קבוצה 4: בלוקי תיאור
                selectors: ['.cab2-desc'],
                baseDelay: 200,
                stagger: 45,
                duration: 1000,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '8px',
            },
            {
                // קבוצה 5: פריטי סיכון
                selectors: ['.cab2-risk-item'],
                baseDelay: 220,
                stagger: 30,
                duration: 1000,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '6px',
            },
            {
                // קבוצה 6: Thumbnails
                selectors: ['.cab2-thumb'],
                baseDelay: 300,
                stagger: 20,
                duration: 1020,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '10px',
            },
            {
                // קבוצה 7: Pills
                selectors: ['.cab2-pill'],
                baseDelay: 60,
                stagger: 25,
                duration: 1000,
                easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
                translateY: '-4px',
            },
        ];

        groups.forEach(group => {
            // אסוף את כל האלמנטים מכל הסלקטורים בקבוצה
            const elements = [];
            group.selectors.forEach(sel => {
                root.querySelectorAll(sel).forEach(el => elements.push(el));
            });

            elements.forEach((el, index) => {
                const delay = group.baseDelay + (index * group.stagger);

                // וודא שהאלמנט מוסתר
                el.style.opacity = '0';
                el.style.transform = `translateY(${group.translateY})`;
                el.style.transition = 'none';

                setTimeout(() => {
                    requestAnimationFrame(() => {
                        void el.offsetHeight; // force reflow

                        el.style.transition =
                            `opacity   ${group.duration}ms ${group.easing},` +
                            `transform ${group.duration}ms ${group.easing}`;
                        el.style.opacity = '1';
                        el.style.transform = 'translateY(0)';

                        // ניקוי אחרי האנימציה
                        setTimeout(() => {
                            el.style.transition = '';
                            el.style.transform = '';
                            el.style.opacity = '';
                        }, group.duration + 50);
                    });
                }, delay);
            });
        });
    }

    // -------------------------------------------------------
    // *** עזר: נרמול תאריך אמריקאי mm/dd/yyyy → dd/mm/yyyy ***
    // -------------------------------------------------------
    _normalizeActualDate(dateStr) {
        if (!dateStr) return '';

        const d = new Date(dateStr);

        if (isNaN(d.getTime())) {
            return dateStr;
        }

        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();

        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');

        return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    // -------------------------------------------------------
    // *** חדש: קבל תאריך התחלה אפקטיבי - בפועל אם קיים ***
    // -------------------------------------------------------
    _getEffectiveStartTime(change) {
        const actual = (change.actualStartTime || '').trim();
        if (actual && actual.toLowerCase() !== 'none' && actual !== '') {
            return this._normalizeActualDate(actual); // *** נרמל פורמט ***
        }
        return change.plannedStartTime || change.date || '';
    }

    // *** חדש: קבל תאריך סיום אפקטיבי - בפועל אם קיים ***
    _getEffectiveEndTime(change) {
        const actual = (change.actualEndTime || '').trim();
        if (actual && actual.toLowerCase() !== 'none' && actual !== '') {
            return this._normalizeActualDate(actual); // *** נרמל פורמט ***
        }
        return change.plannedEndTime || '';
    }

    renderCabView() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const total = this.cabChanges.length;
        const idx = this.cabCurrentIndex;
        const c = this.cabChanges[idx];

        if (!c) {
            content.innerHTML = `
        <div class="cd-cab-empty">
            <i class="fas fa-calendar-check"></i>
            <p>אין שינויים להצגה במצב CAB</p>
        </div>`;
            return;
        }

        // כפתור החלטת CAB
        const decision = this.getCabDecision(c.number);
        const decisionHtml = this._buildCabDecisionBtnHtml(c.number, decision);


        const conflicts = this.detectConflicts(this.cabChanges);
        const isRisk = this.isHighRisk(c);
        const isConflict = conflicts.has(c.number);

        // thumbnails
        let thumbsHtml = '';
        this.cabChanges.forEach((ch, i) => {
            const isActive = i === idx;
            const chDecision = this.getCabDecision(ch.number);
            const chDecided = this.isDecided(ch.number);
            thumbsHtml += `
    <div class="cab2-thumb
                ${isActive ? 'cab2-thumb--active' : ''}
                ${chDecided
                    ? 'cab2-thumb--decided cab2-thumb--decided-' +
                    chDecision.status
                    : ''}
            ${this.isHighRisk(ch) ? 'cab2-thumb--risk' : ''}
            ${conflicts.has(ch.number) ? 'cab2-thumb--conflict' : ''}"
             data-index="${i}"
             title="${this.escHtml(ch.name || ch.number)}">
            <span class="cab2-thumb-num">${this.escHtml(ch.number)}</span>
            <span class="cab2-thumb-name">
                ${this.escHtml(this.truncate(ch.name || '', 45))}
            </span>
            <span class="cab2-thumb-name">
                ${this.escHtml(this.truncate(this.cleanPresenters(ch.presenters) || '', 45))}
            </span>
            <span class="cd-cab-thumb-date">
                ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(ch)))}
            </span>
        </div>`;
        });

        // risk items
        const risks = [
            ['סיכון לנזק כספי/רגולטורי?', c.regulatoryRisk,
                'האם כישלון השינוי עשוי להוביל לנזק כספי או לפגיעה במחויבות רגולטורית?'],

            ['משפיע על מערכות ליבה?', c.affectsCoreSystems,
                'האם השינוי משפיע על מערכות ליבה?'],

            ['משפיע על יותר ממערכת אחת?', c.affectsMultipleSystems,
                'האם השינוי משפיע על יותר ממערכת אחת?'],

            ['משפיע על לקוחות הארגון?', c.affectsCustomers,
                'האם השינוי משפיע על לקוחות הארגון?'],

            ['משפיע על משתמשי מערכת?', c.affectsSystemUsers,
                'האם השינוי משפיע על משתמשי מערכת?'],

            ['מתבצע בשעות פעילות עסקית?', c.duringBusinessHours,
                'האם השינוי מתוכנן להתבצע במהלך שעות פעילות עסקית?'],

            ['כולל שינוי בארכיטקטורה?', c.architectureChange,
                'האם השינוי כולל שינוי בארכיטקטורה?'],

            ['מעורבים מספר צוותים?', c.multipleTeams,
                'האם מעורבים יותר מצוות אחד ביישום השינוי?'],

            ['קיימים פערי ידע לביצוע?', c.knowledgeGaps,
                'האם קיימים פערי ידע לצוות המיישם לצורך ביצוע המשימה?'],

            ['נדרשות בדיקות עסקיות?', c.businessTestsRequired,
                'האם נדרשות בדיקות מטעם משתמש עסקי?'],

            ['בדיקות בסביבות נמוכות נכשלו?', c.lowerEnvTestsFailed,
                'האם הבדיקה בסביבות נמוכות נכשלה?'],
        ];

        const risksHtml = risks
            .filter(([, v]) => v && String(v).trim())
            .map(([label, val, tooltip]) => {
                const yes = ['yes', 'כן', 'cab']
                    .includes((val || '').toLowerCase().trim());
                return `
            <div class="cab2-risk-item ${yes ? 'cab2-risk-item--yes' : 'cab2-risk-item--no'}"
                title="${this.escHtml(tooltip || label)}">
                <span class="cab2-risk-dot"></span>
                <span class="cab2-risk-lbl">${this.escHtml(label)}</span>
                <span class="cab2-risk-val">${yes ? 'כן' : 'לא'}</span>
            </div>`;
            }).join('');

        // desc blocks
        const descs = [
            ['📝', 'תיאור', c.description, ''],
            ['💡', 'הצורך בשינוי', c.changeNeed, ''],
            ['🔧', 'תוכנית יישום', c.implementationPlan, ''],
            ['↩️', 'תוכנית חזרה', c.rollbackPlan, 'cab2-desc--warn'],
            ['✅', 'תוכנית בדיקה', c.testPlan, 'cab2-desc--ok'],
            ['⚠️', 'תקלות אפשריות', c.possibleFailures, 'cab2-desc--danger'],
            ['💬', 'הערות', c.notes, 'cab2-desc--info'],
        ];

        const descsHtml = descs
            .filter(([, , v]) => v && String(v).trim())
            .map(([icon, label, val, cls]) => `
        <div class="cab2-desc ${cls}">
            <div class="cab2-desc-title">${icon} ${this.escHtml(label)}</div>
            <div class="cab2-desc-body">${this.escHtml(String(val))}</div>
        </div>`).join('');

        // team rows
        const team = [
            [c.presenters
                ? this.cleanPresenters(c.presenters)
                : null, 'אחראי', 'teal', 'fa-user-tie'],
            [c.executingTeam, 'צוות מבצע', 'blue', 'fa-user-gear'],
            [c.involvedTeams, 'צוותים מעורבים', 'gray', 'fa-users'],
            [
                c.vendorInvolved === 'כן'
                    ? `${c.vendorName}`
                    : c.vendorInvolved,
                'מעורב ספק',
                'orange', 'fa-user-check'
            ]
        ];

        const teamHtml = team
            .filter(([v]) => v && String(v).trim())
            .map(([val, role, color, icon]) => `
        <div class="cab2-team-row">
                <div class="cab2-avatar cab2-avatar--${color}">
                    <i class="fas ${icon}"></i>
                </div>
            <div class="cab2-team-info">
                <div class="cab2-team-role">${this.escHtml(role)}</div>
                <div class="cab2-team-name">${this.escHtml(String(val))}</div>
            </div>
        </div>`).join('');

        // meta pills
        const pills = [
            [c.changeType, '⚙️', 'סוג שינוי'],
            [
                c.changeReason && c.changeReason.trim() !== 'אחר'
                    ? c.changeReason
                    : null,
                '📌',
                'סיבת שינוי'
            ],
            [c.changeCategory, '🗄️', 'קטגוריית שינוי'],
            [c.environment, '🌐', 'סביבת השינוי'],
            [c.company, '🏢', 'חברה'],
        ];

        const pillsHtml = pills
            .filter(([v]) => v && String(v).trim())
            .map(([val, icon, label]) => `
        <span class="cab2-pill" title="${label}: ${this.escHtml(String(val))}">
            ${icon} ${this.escHtml(String(val))}
        </span>`).join('');

        const _currentDecision = this.getCabDecision(c.number);
        const _isDecidedNow = this.isDecided(c.number);

        content.innerHTML = `
    <div class="cab2-root ${_isDecidedNow
                ? 'cab2-root--decided cab2-root--decided-' +
                _currentDecision.status
                : ''}">

        <!-- TOP BAR -->
        <div class="cab2-topbar">
            <div class="cab2-topbar-right">
                ${c.link
                ? `<a href="${this.escHtml(c.link)}" 
                    target="_blank" 
                    class="cab2-topbar-num cab2-topbar-num--link"
                    title="פתח קישור לשינוי">
                        ${this.escHtml(c.number)}
                </a>`
                : `<div class="cab2-topbar-num">${this.escHtml(c.number)}</div>`
            }
                <div class="cab2-topbar-title" title="שם מערכת">
                    ${this.escHtml(c.name || '')}
                    ${c.system ? `<span class="cab2-topbar-system">${this.escHtml(this._extractSystemName(c.system))}</span>` : ''}
                </div>
            </div>

            <div class="cab2-topbar-center">
                ${pillsHtml}
            </div>


        <div class="cab2-topbar-left">
            <span class="cab2-status-badge ${this.getStatusClass(c.status)}">
                ${this.escHtml(this.mapStatus(c.status))}
            </span>
            ${isRisk ? `<span class="cab2-flag cab2-flag--risk">⚠️ סיכון</span>` : ''}
            ${isConflict ? `<span class="cab2-flag cab2-flag--conflict">⚡ התנגשות</span>` : ''}
            <button class="cd-popup-export-cal" id="cdCabExportCal"
                title="הוסף ללוח שנה (.ics)">
                <i class="fas fa-calendar-plus"></i>
            </button>
            <span class="cab2-counter">${idx + 1} / ${total}</span>
            ${this._buildCabDecisionBtnHtml(
                c.number,
                this.getCabDecision(c.number)
            )}
        </div>
    </div>

        <!-- BODY: 3 COLUMNS -->
        <div class="cab2-body">

            <!-- עמודה 1: לוח זמנים + גורמים מעורבים -->
            <div class="cab2-col">

                <!-- כרטיס 1: לוח זמנים -->
                <div class="cab2-card" style="height: 30%;">
                    <div class="cab2-card-hdr">📅 לוח זמנים</div>
                    <div class="cab2-card-body">
                        <div class="cab2-time-card-row cab2-time-card-row--start">
                            <div class="cab2-time-card-label-wrap">
                                <i class="fas fa-calendar-day"></i>
                                <span class="cab2-time-card-lbl">התחלה</span>
                            </div>
                            <span class="cab2-time-card-val cab2-time-card-val--start">
                                ${this.escHtml(
                this.formatDateDisplay(this._getEffectiveStartTime(c))
            ) || '—'}
                            </span>
                        </div>
                        ${c.plannedEndTime ? `
                        <div class="cab2-time-card-connector">
                            <div class="cab2-time-card-connector-line"></div>
                        </div>
                        <div class="cab2-time-card-row cab2-time-card-row--end">
                            <div class="cab2-time-card-label-wrap">
                                <i class="fas fa-calendar-check"></i>
                                <span class="cab2-time-card-lbl">סיום</span>
                            </div>
                            <span class="cab2-time-card-val cab2-time-card-val--end">
                                ${this.escHtml(this.formatDateDisplay(this._getEffectiveEndTime(c)))}
                            </span>
                        </div>` : ''}
                    </div>
                </div>

                <!-- כרטיס 2: גורמים מעורבים -->
                <div class="cab2-card" style="flex:1; overflow:hidden;">
                    <div class="cab2-card-hdr">👥 גורמים מעורבים</div>
                    <div class="cab2-card-body cab2-card-body--team">
                        ${teamHtml || '<span class="cab2-empty-msg">אין נתונים</span>'}
                    </div>
                </div>
            </div>
            <!-- עמודה 2: תיאור -->
            <div class="cab2-col cab2-col--wide">
                <div class="cab2-card cab2-card--scroll">
                    <div class="cab2-card-hdr">📄 תיאור השינוי</div>
                    <div class="cab2-card-body">
                        ${descsHtml || '<span class="cab2-empty-msg">אין תיאור</span>'}
                    </div>
                    <!-- כרטיס קבצים מצורפים -->
                <div class="cab2-card" id="cabAttCard_${this._safeId(c.number)}"
                    style="max-height:160px; flex-shrink:0;">
                    <div class="cab2-card-hdr">📎 קבצים מצורפים</div>
                    <div class="cab2-card-body" style="
                        display:flex; align-items:center;
                        justify-content:center; color:#6b7280; font-size:12px; gap:6px;">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>טוען...</span>
                    </div>
                </div>
                </div>
            </div>

            <!-- עמודה 3: סיכונים -->
            <div class="cab2-col">
                <div class="cab2-card">
                    <div class="cab2-card-hdr">🛡️ סיכונים</div>
                    <div class="cab2-card-body">
                        ${risksHtml || '<span class="cab2-empty-msg">אין נתונים</span>'}
                    </div>
                </div>
            </div>

        </div>

        <!-- FOOTER: thumbnails + nav -->
        <div class="cab2-footer">
                    <button class="cab2-summary-open-btn"
                    id="cdCabOpenSummary"
                    title="סיכום CAB">
                <i class="fas fa-file-alt"></i>
                <span class="cab2-summary-open-btn-text">סיכום CAB</span>
                ${Object.keys(this.getCurrentWeekDecisions()).length > 0
                ? `<span class="cab2-summary-open-btn-badge">
                           ${Object.keys(
                    this.getCurrentWeekDecisions()
                ).length}
                       </span>`
                : ''}
            </button>
            <button class="cab2-reset-order-btn" id="cdCabResetOrder"
                title="איפוס סדר לברירת מחדל"
                style="${this.hasSavedCabOrder() ? '' : 'display:none'}">
                <i class="fas fa-rotate-left"></i>
            </button>
            <button class="cab2-nav-btn" id="cdCabViewPrev"
                ${this._hasUndecidedOtherThan(idx) ? '' : 'disabled'}
                title="${this._hasUndecidedOtherThan(idx)
                ? 'עבור לבקשה הקודמת שלא טופלה'
                : 'אין בקשות נוספות שלא טופלו'}">
                <i class="fas fa-chevron-right"></i>
            </button>

            <div class="cab2-thumbs-wrap">
                <div class="cab2-thumbs" id="cdCabThumbs">
                    ${thumbsHtml}
                </div>
            </div>

            <button class="cab2-nav-btn" id="cdCabViewNext"
                ${this._hasUndecidedOtherThan(idx) ? '' : 'disabled'}
                title="${this._hasUndecidedOtherThan(idx)
                ? 'עבור לבקשה הבאה שלא טופלה'
                : 'אין בקשות נוספות שלא טופלו'}">
                <i class="fas fa-chevron-left"></i>
            </button>
        </div>

    </div>`;


        // *** טען קבצים מצורפים באופן אסינכרוני ***
        this._loadAndRenderAttachments(c.number, content);

        // events
        document.getElementById('cdCabViewPrev')
            ?.addEventListener('click', () => {
                // *** תיקון: בדוק שאין פופאפ פתוח ***
                const decisionModalVisible = !!document.getElementById('cdCabDecisionModal');
                const calendarModalVisible = !!document.getElementById('cdCalendarChoiceModal');
                if (!decisionModalVisible && !calendarModalVisible) {
                    this.cabNavigate(-1);
                }
            });

        document.getElementById('cdCabViewNext')
            ?.addEventListener('click', () => {
                // *** תיקון: בדוק שאין פופאפ פתוח ***
                const decisionModalVisible = !!document.getElementById('cdCabDecisionModal');
                const calendarModalVisible = !!document.getElementById('cdCalendarChoiceModal');
                if (!decisionModalVisible && !calendarModalVisible) {
                    this.cabNavigate(1);
                }
            });

        document.querySelectorAll('.cab2-thumb').forEach(el => {
            el.addEventListener('click', () => {
                const i = parseInt(el.getAttribute('data-index'));
                if (!isNaN(i) && i !== this.cabCurrentIndex) {
                    this.cabNavDirection = i > this.cabCurrentIndex ? 'next' : 'prev';
                    this.cabCurrentIndex = i;
                    this.renderCabViewAnimated();
                }
            });
        });

        document.getElementById('cdCabResetOrder')
            ?.addEventListener('click', () => {
                if (confirm('לאפס את סדר השינויים לברירת מחדל?')) {
                    this.clearCabOrder();
                    // מיון מחדש לפי תאריך
                    this.cabChanges.sort((a, b) => {
                        const da = this.parseDate(
                            this._getEffectiveStartTime(a)
                        );
                        const db = this.parseDate(
                            this._getEffectiveStartTime(b)
                        );
                        if (!da && !db) return 0;
                        if (!da) return 1;
                        if (!db) return -1;
                        return da - db;
                    });
                    this.cabCurrentIndex = 0;
                    this.renderCabView();
                }
            });
        // כפתור החלטת CAB
        document.getElementById('cdCabDecisionBtn')
            ?.addEventListener('click', () => {
                const existing = this.getCabDecision(c.number);
                this.showCabDecisionModal(
                    c.number, c.name, existing
                );
            });

        // ערוך החלטה מה-banner
        document.getElementById('cdDecidedBannerEdit')
            ?.addEventListener('click', () => {
                const existing = this.getCabDecision(c.number);
                this.showCabDecisionModal(
                    c.number, c.name, existing
                );
            });

        // כפתור סיכום CAB
        document.getElementById('cdCabOpenSummary')
            ?.addEventListener('click', () => {
                this.showCabSummary();
            });

        this._scrollThumbIntoView(idx);
        document.getElementById('cdCabExportCal')
            ?.addEventListener('click', () => {
                this.exportChangeToCalendar(c);
            });
        this.initCabThumbDragSort();
    }

    // -------------------------------------------------------
    // טעינה ורינדור קבצים מצורפים לכרטיס CAB
    // -------------------------------------------------------
    async _loadAndRenderAttachments(changeNumber, container) {
        const safeId = this._safeId(changeNumber);
        const card = container.querySelector(`#cabAttCard_${safeId}`);
        if (!card) return;

        try {
            const html = await this._buildAttachmentsHtml(changeNumber);
            card.insertAdjacentHTML('afterend', html);
            card.remove();
            this._initAttachmentEvents(container, changeNumber);
        } catch (err) {
            console.warn('[Attachments] שגיאה בטעינה:', err);
            // *** הצג הודעת שגיאה בכרטיס ***
            card.querySelector('.cab2-card-body').innerHTML =
                `<span style="color:#f87171;font-size:11px;">
                <i class="fas fa-exclamation-triangle"></i> 
                שגיאה בטעינת קבצים
            </span>`;
        }
    }

    // הוסף מתודה עזר:
    _safeId(str) {
        return (str || '').replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    // בדיקה אם יש בקשות שלא טופלו מלבד הנוכחית
    _hasUndecidedOtherThan(currentIdx) {
        return this.cabChanges.some((c, i) =>
            i !== currentIdx && !this.isDecided(c.number)
        );
    }

    _getDecisionIcon(status) {
        const icons = {
            'approved': 'check-circle',
            'rejected': 'times-circle',
            'approved_tentative': 'check-circle',   // אושר טנטטיבית
            'rescheduled': 'times-circle',   // יתואם מחדש - אייקון כמו נדחה
            'pending': 'hourglass-half',
            'no_cab': 'ban'
        };
        return icons[status] || 'circle';
    }

    _getDecisionLabel(status) {
        const labels = {
            'approved': '✅ אושר',
            'rejected': '❌ נדחה',
            'approved_tentative': '🟠 אושר טנטטיבית',
            'rescheduled': '🔴 יתואם מחדש',
            'pending': '⏳ ממתין להחלטה',
            'no_cab': '🚫 אין צורך ב-CAB'
        };
        return labels[status] || status;
    }

    _getDecisionColor(status) {
        const colors = {
            'approved': '#22c55e',
            'rejected': '#ef4444',
            'approved_tentative': '#f97316',
            'rescheduled': '#ef4444',   // אדום - כמו נדחה
            'pending': '#6b7280',
            'no_cab': '#6b7280'
        };
        return colors[status] || '#6b7280';
    }

    // Export CAB summary to Excel using ExcelJS
    async exportCabSummaryToExcel() {
        try {
            // Load ExcelJS and FileSaver if not already loaded
            await this._loadExcelLibraries();

            const weekKey = this._getCabWeekKey();
            const weekDecisions = this.getCurrentWeekDecisions();

            // Calculate week label
            const now = new Date();
            const sun = new Date(now);
            sun.setDate(now.getDate() - now.getDay());
            const sat = new Date(sun);
            sat.setDate(sun.getDate() + 7);
            const fmtDate = d =>
                `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            const weekLabel = `${fmtDate(sun)} - ${fmtDate(sat)}`;

            // Export timestamp
            const exportTime = now.toLocaleString('he-IL', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const fileName = `CAB_Summary_${weekLabel}.xlsx`;
            const sheetTitle = `סיכום ישיבת CAB\n${weekLabel}`;

            // Statistics
            const allDecisions = Object.values(weekDecisions);
            const stats = {
                total: this.cabChanges.length,
                decided: allDecisions.filter(d => d.status !== 'pending').length,
                approved: allDecisions.filter(d => d.status === 'approved').length,
                approved_tentative: allDecisions.filter(d => d.status === 'approved_tentative').length,
                rejected: allDecisions.filter(d => d.status === 'rejected').length,
                rescheduled: allDecisions.filter(d => d.status === 'rescheduled').length,
                undecided: this.cabChanges.filter(c => !this.isDecided(c.number)).length,
            };

            // Sort changes by date ascending
            const sortedChanges = [...this.cabChanges]
                .filter(c => {
                    const s = (c.status || '').toLowerCase().trim();
                    return !['cancelled', 'canceled', 'pending', 'ממתין'].includes(s);
                })
                .sort((a, b) => {
                    const da = this.parseDateWithTime(this._getEffectiveStartTime(a));
                    const db = this.parseDateWithTime(this._getEffectiveStartTime(b));
                    if (!da && !db) return 0;
                    if (!da) return 1;
                    if (!db) return -1;
                    return da - db;
                });

            // Color palette
            const C = {
                headerBg: '320F5B',
                headerFont: 'FFFFFF',
                subHeaderBg: '667eea',
                subHeaderFont: 'FFFFFF',
                altRowBg: 'F0F4FF',
                borderColor: 'D0D5DD',
                numberFont: '667eea',
                approvedBg: 'C6EFCE', approvedFg: '276221',
                rejectedBg: 'FFC7CE', rejectedFg: '9C0006',
                tentativeBg: 'FCE4D6', tentativeFg: 'C55A11',
                rescheduledBg: 'FFC7CE', rescheduledFg: '9C0006',   // אדום - כמו נדחה
                undecidedBg: 'F2F2F2', undecidedFg: '595959',
                statTotalBg: 'EDE9FE', statTotalFg: '4C1D95',
                metaBg: 'F9FAFB', metaFg: '6B7280',
            };

            // Helpers
            const thinBorder = () => ({
                top: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                bottom: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                left: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                right: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            });

            const applyStyle = (cell, {
                bgColor = null,
                fontColor = '000000',
                bold = false,
                hAlign = 'center',
                fontSize = 11,
                wrapText = false,
                italic = false,
            } = {}) => {
                cell.font = {
                    name: 'Arial', size: fontSize,
                    bold, italic,
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
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            // Status colors per decision
            const statusColors = {
                approved: { bg: C.approvedBg, fg: C.approvedFg },
                rejected: { bg: C.rejectedBg, fg: C.rejectedFg },
                approved_tentative: { bg: C.tentativeBg, fg: C.tentativeFg },
                rescheduled: { bg: C.rescheduledBg, fg: C.rescheduledFg },
                undecided: { bg: C.undecidedBg, fg: C.undecidedFg },
            };

            // =====================================================
            // Create workbook
            // =====================================================
            const wb = new ExcelJS.Workbook();
            wb.creator = 'NOC Portal';
            wb.created = new Date();

            // =====================================================
            // SHEET 1 - Main changes list
            // =====================================================
            const ws1Name = sheetTitle.replace(/[*?:\\/\[\]]/g, '-').substring(0, 31);
            const ws1 = wb.addWorksheet(ws1Name, {
                views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
                properties: { defaultRowHeight: 18 },
            });

            const headers = ['מספר שינוי', 'שם השינוי', 'מערכת', 'אחראי', 'צוות מבצע', 'החלטת CAB', 'הערות'];
            const colWidths = [18, 42, 20, 22, 22, 20, 36];
            const COLS = headers.length;

            // Row 1 - merged title
            ws1.mergeCells(`A1:${String.fromCharCode(64 + COLS)}1`);
            const titleCell = ws1.getCell('A1');
            titleCell.value = sheetTitle;
            applyStyle(titleCell, {
                bgColor: C.headerBg,
                fontColor: C.headerFont,
                bold: true,
                hAlign: 'center',
                fontSize: 14,
                wrapText: true
            });

            ws1.getRow(1).height = 40;

            // Row 2 - column headers
            headers.forEach((h, i) => {
                const cell = ws1.getCell(2, i + 1);
                cell.value = h;
                applyStyle(cell, {
                    bgColor: C.subHeaderBg, fontColor: C.subHeaderFont,
                    bold: true, hAlign: 'center', fontSize: 11
                });
                ws1.getColumn(i + 1).width = colWidths[i];
            });
            ws1.getRow(2).height = 22;

            // Data rows starting at row 3
            let excelRow = 3;
            let isAlt = false;

            sortedChanges.forEach(c => {
                const d = this.getCabDecision(c.number);
                const status = d?.status || 'undecided';
                const colors = statusColors[status] || statusColors.undecided;
                const rowBg = isAlt ? C.altRowBg : null;

                const rowData = [
                    c.number || '',
                    c.name || '',
                    this._extractSystemName(c.system || ''),
                    c.presenters ? this.cleanPresenters(c.presenters) : '',
                    c.executingTeam || '',
                    this._getDecisionLabelPlain(status),
                    d?.notes || '',
                ];

                rowData.forEach((val, colIdx) => {
                    const cell = ws1.getCell(excelRow, colIdx + 1);
                    cell.value = val;

                    applyStyle(cell, {
                        bgColor: rowBg,
                        hAlign: 'center',
                        wrapText: colIdx === 1 || colIdx === 6,
                        fontSize: 10,
                    });

                    // Change number - bold blue
                    if (colIdx === 0 && val) {
                        cell.font = {
                            name: 'Arial', size: 11, bold: true,
                            color: { argb: 'FF' + C.numberFont },
                        };
                        cell.border = thinBorder();
                    }

                    // CAB decision - colored background + bold
                    if (colIdx === 5) {
                        cell.font = {
                            name: 'Arial', size: 10, bold: true,
                            color: { argb: 'FF' + colors.fg },
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: 'FF' + colors.bg },
                        };
                        cell.border = thinBorder();
                    }
                });

                ws1.getRow(excelRow).height = 17;
                isAlt = !isAlt;
                excelRow++;
            });

            // =====================================================
            // SHEET 2 - Statistics summary
            // =====================================================
            const ws2 = wb.addWorksheet('סטטיסטיקות', {
                views: [{ rightToLeft: true }],
                properties: { defaultRowHeight: 18 },
            });

            ws2.getColumn(1).width = 28;
            ws2.getColumn(2).width = 18;

            // Title
            ws2.mergeCells('A1:B1');
            const ws2Title = ws2.getCell('A1');
            ws2Title.value = `סיכום ישיבת CAB\n${weekLabel}`;

            applyStyle(ws2Title, {
                bgColor: C.headerBg,
                fontColor: C.headerFont,
                bold: true,
                hAlign: 'center',
                fontSize: 13,
                wrapText: true
            });

            ws2.getRow(1).height = 40;

            // Export timestamp row
            ws2.mergeCells('A2:B2');
            const ws2Meta = ws2.getCell('A2');
            ws2Meta.value = `יוצא מהמערכת: ${exportTime}`;
            applyStyle(ws2Meta, {
                bgColor: C.metaBg, fontColor: C.metaFg,
                hAlign: 'center', fontSize: 9, italic: true,
            });
            ws2.getRow(2).height = 16;

            // Spacer
            ws2.mergeCells('A3:B3');
            ws2.getRow(3).height = 8;

            // Stats header row
            const statsHeaderData = [
                ['קטגוריה', 'כמות'],
            ];
            statsHeaderData.forEach(([label, val]) => {
                const r = ws2.addRow([label, val]);
                [1, 2].forEach(col => {
                    applyStyle(r.getCell(col), {
                        bgColor: C.subHeaderBg, fontColor: C.subHeaderFont,
                        bold: true, hAlign: 'center', fontSize: 11,
                    });
                });
                r.height = 22;
            });

            // Stats data rows
            const statsRows = [
                { label: 'סה"כ שינויים', value: stats.total, bg: C.statTotalBg, fg: C.statTotalFg },
                { label: 'אושרו', value: stats.approved, bg: C.approvedBg, fg: C.approvedFg },
                { label: 'נדחו', value: stats.rejected, bg: C.rejectedBg, fg: C.rejectedFg },
                { label: 'אושרו טנטטיבית', value: stats.approved_tentative, bg: C.tentativeBg, fg: C.tentativeFg },
                { label: 'יתואמו מחדש', value: stats.rescheduled, bg: C.rescheduledBg, fg: C.rescheduledFg },
                { label: 'לא טופלו', value: stats.undecided, bg: C.undecidedBg, fg: C.undecidedFg },
            ];

            statsRows.forEach(({ label, value, bg, fg }) => {
                const r = ws2.addRow([label, value]);
                applyStyle(r.getCell(1), {
                    bgColor: bg, fontColor: fg,
                    bold: false, hAlign: 'right', fontSize: 11,
                });
                applyStyle(r.getCell(2), {
                    bgColor: bg, fontColor: fg,
                    bold: true, hAlign: 'center', fontSize: 13,
                });
                r.height = 22;
            });

            // Spacer
            ws2.addRow([]);
            ws2.lastRow.height = 8;

            // Download
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, fileName);

            this._showColOrderSaveIndicator('קובץ Excel יוצא בהצלחה ✓');

        } catch (error) {
            console.error('שגיאה בייצוא:', error);
            this._showErrorIndicator('שגיאה בייצוא לאקסל: ' + error.message);
        }
    }

    // Load ExcelJS and FileSaver libraries dynamically
    async _loadExcelLibraries() {
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

    // תווית החלטה ללא אמוג'י (לאקסל)
    _getDecisionLabelPlain(status) {
        const labels = {
            'approved': 'אושר',
            'rejected': 'נדחה',
            'approved_tentative': 'אושר טנטטיבית',
            'rescheduled': 'יתואם מחדש',
            'pending': 'ממתין להחלטה',
            'undecided': 'לא טופל'
        };
        return labels[status] || status || 'לא טופל';
    }

    _buildCabDecisionBtnHtml(changeNumber, decision) {
        if (decision && decision.status && decision.status !== 'pending') {
            return `
        <button class="cab2-decision-btn cab2-decision-btn--decided 
                       cab2-decision-btn--${decision.status}"
                data-number="${this.escHtml(changeNumber)}"
                id="cdCabDecisionBtn"
                title="שנה החלטה">
            <i class="fas fa-${this._getDecisionIcon(decision.status)}"></i>
            <span>${this._getDecisionLabel(decision.status)}</span>
        </button>`;
        }

        return `
    <button class="cab2-decision-btn cab2-decision-btn--undecided"
            data-number="${this.escHtml(changeNumber)}"
            id="cdCabDecisionBtn"
            title="קבע החלטת CAB">
        <i class="fas fa-gavel"></i>
        <span>החלטת CAB</span>
    </button>`;
    }

    showCabDecisionModal(changeNumber, changeName, existingDecision) {
        document.getElementById('cdCabDecisionModal')?.remove();

        const history = this.getAllCabDecisions(changeNumber);
        const currentStatus = existingDecision?.status || '';
        const currentNotes = existingDecision?.notes || '';

        const statuses = [
            { value: 'approved', label: '✅ אושר' },
            { value: 'rejected', label: '❌ נדחה' },
            { value: 'approved_tentative', label: '🔵 אושר טנטטיבית' },
            { value: 'rescheduled', label: '🔴 יתואם מחדש' },
            { value: 'no_cab', label: '🚫 אין צורך ב-CAB' },
        ];

        const statusBtnsHtml = statuses.map(s => `
        <button
            class="cab2-decision-status-btn
                   ${currentStatus === s.value
                ? 'cab2-decision-status-btn--active'
                : ''}"
            data-status="${s.value}">
            ${s.label}
        </button>
    `).join('');

        const modalHtml = `
        <div id="cdCabDecisionModal"
             class="cab2-decision-modal-overlay">

            <div class="cab2-decision-modal">

                <!-- כותרת -->
                <div class="cab2-decision-modal-header">
                    <div class="cab2-decision-modal-header-left">
                        <div class="cab2-decision-modal-icon">⚖️</div>
                        <div>
                            <div class="cab2-decision-modal-title">
                                החלטת CAB
                            </div>
                            <div class="cab2-decision-modal-subtitle">
                                [${this.escHtml(changeNumber)}]
                                ${this.escHtml(changeName || '')}
                            </div>
                        </div>
                    </div>
                    <button class="cab2-decision-modal-close"
                            id="cdCabDecisionModalClose">
                        ✕
                    </button>
                </div>

                <!-- גוף -->
                <div class="cab2-decision-modal-body">

                    <!-- כפתורי סטטוס -->
                    <div>
                        <div class="cab2-decision-section-label">
                            בחר החלטה:
                        </div>
                        <div class="cab2-decision-status-grid">
                            ${statusBtnsHtml}
                        </div>
                    </div>

                    <!-- הערות -->
                    <div>
                        <div class="cab2-decision-section-label">
                            הערות ודגשים:
                        </div>
                        <textarea
                            id="cdCabDecisionNotes"
                            class="cab2-decision-notes-textarea"
                            placeholder="הזן הערות, תנאים, דגשים..."
                        >${this.escHtml(currentNotes)}</textarea>
                    </div>
                    <div class="cab2-decision-history">
                        <div class="cab2-decision-section-label">
                            החלטות CAB קודמות
                        </div>

                        ${history.map(h => `
                            <div class="cab2-decision-history-row">
                                <span>${this._getDecisionLabel(h.status)}</span>
                                <span title="${h.weekKey}">
                                    ${this._weekKeyToDateRange(h.weekKey)}
                                </span>
                                <span>${h.notes || ''}</span>
                            </div>
                        `).join('')}
                    </div>
                    <!-- כפתורי פעולה -->
                    <div class="cab2-decision-modal-footer">
                        <button class="cab2-decision-cancel-btn"
                                id="cdCabDecisionModalClose2">
                            ביטול
                        </button>
                        <button class="cab2-decision-save-btn"
                                id="cdCabDecisionSaveBtn"
                                ${!currentStatus || currentStatus === 'pending'
                ? 'disabled'
                : ''}>
                            <i class="fas fa-save"></i>
                            שמור החלטה
                        </button>
                    </div>

                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // ---- סגירה ----
        document.getElementById('cdCabDecisionModalClose')
            ?.addEventListener('click', () => {
                document.getElementById('cdCabDecisionModal')?.remove();
            });

        document.getElementById('cdCabDecisionModalClose2')
            ?.addEventListener('click', () => {
                document.getElementById('cdCabDecisionModal')?.remove();
            });

        // ---- בחירת סטטוס ----
        let selectedStatus = currentStatus;

        const updateSaveBtn = () => {
            const btn = document.getElementById('cdCabDecisionSaveBtn');
            if (!btn) return;
            const isValid = selectedStatus && selectedStatus !== 'pending';
            btn.disabled = !isValid;
        };

        document.querySelectorAll('.cab2-decision-status-btn')
            .forEach(btn => {
                btn.addEventListener('click', () => {
                    // הסר active מכולם
                    document.querySelectorAll('.cab2-decision-status-btn')
                        .forEach(b => b.classList.remove(
                            'cab2-decision-status-btn--active'
                        ));
                    // הוסף active לנבחר
                    btn.classList.add('cab2-decision-status-btn--active');
                    selectedStatus = btn.getAttribute('data-status');
                    updateSaveBtn();
                });
            });

        updateSaveBtn();

        // ---- שמירה ----
        document.getElementById('cdCabDecisionSaveBtn')
            ?.addEventListener('click', () => {
                if (!selectedStatus) return;

                const notes = document.getElementById('cdCabDecisionNotes')
                    ?.value?.trim() || '';

                this.setCabDecision(changeNumber, selectedStatus, notes);

                document.getElementById('cdCabDecisionModal')?.remove();

                this._showDecisionSavedIndicator(selectedStatus);

                if (selectedStatus === 'no_cab') {
                    this.enterCabMode();
                } else {
                    this.renderCabView();
                }
            });
    }

    _weekKeyToDateRange(weekKey) {
        if (!weekKey) return weekKey;

        // פורמט: "2025-W31"
        const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
        if (!match) return weekKey;

        const year = parseInt(match[1]);
        const week = parseInt(match[2]);

        // חישוב תאריך ראשון של השבוע (ISO week)
        const jan4 = new Date(year, 0, 4); // ינואר 4 תמיד בשבוע 1
        const startOfWeek1 = new Date(jan4);
        startOfWeek1.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);

        const weekStart = new Date(startOfWeek1);
        weekStart.setDate(startOfWeek1.getDate() + (week - 1) * 7);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const fmt = d =>
            `${String(d.getDate()).padStart(2, '0')}/` +
            `${String(d.getMonth() + 1).padStart(2, '0')}/` +
            `${d.getFullYear()}`;

        // return `${fmt(weekStart)} — ${fmt(weekEnd)}`;
        return `${fmt(weekStart)}`;
    }

    // -------------------------------------------------------
    // דילוג לשינוי הבא שלא טופל
    // -------------------------------------------------------
    _advanceToNextUndecided() {
        const total = this.cabChanges.length;
        if (total === 0) return;

        // חפש את הבא שלא טופל, החל מהאינדקס הנוכחי + 1
        for (let i = 1; i <= total; i++) {
            const nextIdx = (this.cabCurrentIndex + i) % total;
            const nextChange = this.cabChanges[nextIdx];
            if (!this.isDecided(nextChange.number)) {
                this.cabNavDirection = 'next';
                this.cabCurrentIndex = nextIdx;
                this.renderCabViewAnimated();
                return;
            }
        }

        // כולם טופלו - הצג סיכום
        this._showAllDecidedMessage();
    }

    // -------------------------------------------------------
    // הודעה שכל השינויים טופלו
    // -------------------------------------------------------
    _showAllDecidedMessage() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        const weekDecisions = this.getCurrentWeekDecisions();
        const approved = Object.values(weekDecisions).filter(d => d.status === 'approved').length;
        const tentative = Object.values(weekDecisions).filter(d => d.status === 'approved_tentative').length;
        const rejected = Object.values(weekDecisions).filter(d => d.status === 'rejected').length;
        const rescheduled = Object.values(weekDecisions).filter(d => d.status === 'rescheduled').length;

        content.innerHTML = `
    <div class="cab2-all-decided">
        <div class="cab2-all-decided-icon">🎉</div>
        <h2>כל השינויים טופלו!</h2>
        <p>ישיבת ה-CAB הסתיימה בהצלחה</p>
        
        <div class="cab2-all-decided-stats">
            <div class="cab2-all-decided-stat cab2-all-decided-stat--approved">
                <span class="cab2-all-decided-stat-val">${approved}</span>
                <span class="cab2-all-decided-stat-lbl">אושרו</span>
            </div>
            <div class="cab2-all-decided-stat cab2-all-decided-stat--tentative">
                <span class="cab2-all-decided-stat-val">${tentative}</span>
                <span class="cab2-all-decided-stat-lbl">אושרו טנטטיבית</span>
            </div>
            <div class="cab2-all-decided-stat cab2-all-decided-stat--rejected">
                <span class="cab2-all-decided-stat-val">${rejected}</span>
                <span class="cab2-all-decided-stat-lbl">נדחו</span>
            </div>
            <div class="cab2-all-decided-stat cab2-all-decided-stat--rescheduled">
                <span class="cab2-all-decided-stat-val">${rescheduled}</span>
                <span class="cab2-all-decided-stat-lbl">יתואמו מחדש</span>
            </div>
        </div>

        <div class="cab2-all-decided-actions">
            <button class="cab2-all-decided-btn cab2-all-decided-btn--summary"
                    id="cdShowSummaryFromDone">
                <i class="fas fa-file-alt"></i>
                הצג סיכום CAB
            </button>
            <button class="cab2-all-decided-btn cab2-all-decided-btn--back"
                    id="cdBackToListFromDone">
                <i class="fas fa-list"></i>
                חזור לרשימה
            </button>
        </div>
    </div>`;

        document.getElementById('cdShowSummaryFromDone')
            ?.addEventListener('click', () => this.showCabSummary());
        document.getElementById('cdBackToListFromDone')
            ?.addEventListener('click', () => {
                this.cabCurrentIndex = 0;
                this.renderCabView();
            });
    }

    // -------------------------------------------------------
    // אינדיקטור שמירת החלטה
    // -------------------------------------------------------
    _showDecisionSavedIndicator(status) {
        document.getElementById('cdDecisionIndicator')?.remove();

        const label = this._getDecisionLabel(status);
        const color = this._getDecisionColor(status);

        const el = document.createElement('div');
        el.id = 'cdDecisionIndicator';
        el.innerHTML = `<i class="fas fa-${this._getDecisionIcon(status)}"></i> <span>${label} — נשמר</span>`;
        el.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        border: 1px solid #374151;
        border-right: 3px solid ${color};
        border-radius: 8px;
        padding: 10px 18px;
        color: ${color};
        font-size: 13px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        white-space: nowrap;
        direction: rtl;
        animation: cdFadeIn 0.2s ease;
    `;
        document.body.appendChild(el);

        setTimeout(() => {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 2000);
    }


    // -------------------------------------------------------
    // סיכום CAB
    // -------------------------------------------------------
    showCabSummary() {
        const content = document.getElementById('cdContent');
        if (!content) return;

        this.cabSummaryMode = true;

        const weekKey = this._getCabWeekKey();
        const weekDecisions = this.getCurrentWeekDecisions();
        const allDecided = Object.values(weekDecisions);

        const stats = {
            total: this.cabChanges.length,
            decided: allDecided.filter(d => d.status !== 'pending').length,
            approved: allDecided.filter(d => d.status === 'approved').length,
            approved_tentative: allDecided.filter(d => d.status === 'approved_tentative').length,
            rejected: allDecided.filter(d => d.status === 'rejected').length,
            rescheduled: allDecided.filter(d => d.status === 'rescheduled').length,
            undecided: this.cabChanges.filter(c => !this.isDecided(c.number)).length
        };

        // בניית שורת שינוי לטבלת סיכום
        const buildRow = (c) => {
            const d = this.getCabDecision(c.number);
            const status = d?.status || 'undecided';
            const notes = d?.notes || '';
            const time = d?.timestamp
                ? new Date(d.timestamp).toLocaleTimeString('he-IL', {
                    hour: '2-digit', minute: '2-digit'
                })
                : '';

            const statusLabel = d
                ? this._getDecisionLabel(d.status)
                : '⬜ לא טופל';
            const statusColor = d
                ? this._getDecisionColor(d.status)
                : '#6b7280';

            // *** כפתור איפוס - מוצג רק לשינויי no_cab ***
            const isNoCab = status === 'no_cab';

            return `
<tr class="cab2-summary-row cab2-summary-row--${status}">
    <td class="cab2-summary-td-num">
        ${c.link
                    ? `<a href="${this.escHtml(c.link)}"
                  target="_blank"
                  class="cab2-summary-link"
                  onclick="event.stopPropagation()">
                   ${this.escHtml(c.number)}
               </a>`
                    : `<span>${this.escHtml(c.number)}</span>`}
    </td>
    <td class="cab2-summary-td-name"
        title="${this.escHtml(c.name || '')}">
        ${this.escHtml(this.truncate(c.name || '', 60))}
    </td>
    <td class="cab2-summary-td-system">
        ${c.system
                    ? `<span class="cab2-summary-system-chip">
                   ${this.escHtml(this._extractSystemName(c.system))}
               </span>`
                    : '<span class="cab2-summary-empty">—</span>'}
    </td>
    <td class="cab2-summary-td-presenter">
        ${c.presenters
                    ? this.escHtml(this.cleanPresenters(c.presenters))
                    : '<span class="cab2-summary-empty">—</span>'}
    </td>
    <td class="cab2-summary-td-status">
        <span class="cab2-summary-status-badge"
              style="
                  color:${statusColor};
                  background:${statusColor}22;
                  border:1px solid ${statusColor}55;
              ">
            ${statusLabel}
        </span>
    </td>
    <td class="cab2-summary-td-notes">
        ${notes
                    ? `<span class="cab2-summary-notes-text">
                   ${this.escHtml(notes)}
               </span>`
                    : '<span class="cab2-summary-empty">—</span>'}
    </td>
    <td class="cab2-summary-td-time">
        <span class="cab2-summary-time">${time}</span>
    </td>
    <td class="cab2-summary-td-actions">
        ${isNoCab
                    ? `<button class="cab2-summary-reset-btn"
                       data-number="${this.escHtml(c.number)}"
                       title="אפס החלטה - החזר לרשימת CAB">
                   <i class="fas fa-rotate-left"></i>
               </button>`
                    : `<button class="cab2-summary-edit-btn"
                       data-number="${this.escHtml(c.number)}"
                       title="ערוך החלטה">
                   <i class="fas fa-edit"></i>
               </button>`}
    </td>
</tr>`;
        };

        // קבוצות לפי סטטוס
        const groups = [
            { status: 'approved', label: '✅ אושרו' },
            { status: 'approved_tentative', label: '🔵 אושרו טנטטיבית' },
            { status: 'rejected', label: '❌ נדחו' },
            { status: 'rescheduled', label: '🔴 יתואמו מחדש' },
            { status: 'undecided', label: '⬜ לא טופלו' },
            { status: 'no_cab', label: '🚫 אין צורך ב-CAB' },
        ];

        const groupsHtml = groups.map(g => {
            // *** לקבוצת no_cab - השתמש ב-allCabChanges ***
            const sourceList = (g.status === 'no_cab')
                ? (this.allCabChanges || this.cabChanges)
                : this.cabChanges;

            const items = sourceList.filter(c => {
                const d = this.getCabDecision(c.number);
                if (g.status === 'undecided') {
                    return !d || !d.status || d.status === 'pending';
                }
                return d && d.status === g.status;
            });

            if (items.length === 0) return '';

            const color = g.status === 'undecided' || g.status === 'no_cab'
                ? '#6b7280'
                : this._getDecisionColor(g.status);

            return `
<div class="cab2-summary-group">
    <div class="cab2-summary-group-header"
         style="border-right:3px solid ${color};">
        <span class="cab2-summary-group-label"
              style="color:${color};">
            ${g.label}
        </span>
        <span class="cab2-summary-group-count"
              style="
                  background:${color}22;
                  border:1px solid ${color}44;
                  color:${color};
              ">
            ${items.length}
        </span>
        ${g.status === 'no_cab' ? `
        <span style="
            font-size:11px;
            color:#6b7280;
            margin-right:8px;
            font-style:italic;
        ">
            שינויים אלו לא יוצגו בניווט CAB
        </span>` : ''}
    </div>
    <div class="cab2-summary-table-wrap">
        <table class="cab2-summary-table">
            <thead>
                <tr>
                    <th>מספר</th>
                    <th>שם השינוי</th>
                    <th>מערכת</th>
                    <th>אחראי</th>
                    <th>החלטה</th>
                    <th>הערות</th>
                    <th>שעה</th>
                    <th></th>
                </tr>
            </thead>
            <tbody>
                ${items.map(c => buildRow(c)).join('')}
            </tbody>
        </table>
    </div>
</div>`;
        }).join('');

        // חישוב אחוז השלמה
        const pct = stats.total > 0
            ? Math.round((stats.decided / stats.total) * 100)
            : 0;

        // תאריך השבוע
        const weekLabel = (() => {
            const now = new Date();
            const sun = new Date(now);
            sun.setDate(now.getDate() - now.getDay());
            const sat = new Date(sun);
            sat.setDate(sun.getDate() + 7);
            const fmt = d =>
                `${String(d.getDate()).padStart(2, '0')}/` +
                `${String(d.getMonth() + 1).padStart(2, '0')}/` +
                `${d.getFullYear()}`;
            return `${fmt(sun)} — ${fmt(sat)}`;
        })();

        content.innerHTML = `
    <div class="cab2-summary-root">

        <!-- כותרת סיכום -->
        <div class="cab2-summary-header">
            <div class="cab2-summary-header-right">
                <div class="cab2-summary-header-icon">📋</div>
                <div>
                    <div class="cab2-summary-header-title">
                        סיכום ישיבת CAB
                    </div>
                    <div class="cab2-summary-header-week">
                        שבוע ${weekLabel}
                    </div>
                </div>
            </div>
            <div class="cab2-summary-header-left">
                <button class="cab2-summary-back-btn"
                        id="cdSummaryBackBtn">
                    <i class="fas fa-arrow-right"></i>
                    חזור ל-CAB
                </button>
                <button class="cab2-summary-refresh-btn"
                        id="cdSummaryRefreshBtn"
                        title="רענן נתונים מתוך הטסט האוטומטי">
                    <i class="fas fa-sync-alt"></i>
                    רענן
                </button>
                <button class="cab2-summary-attendance-btn"
                        id="cdSummaryAttendanceBtn"
                        title="צור סיכום CAB - העלה דוח נוכחות Teams">
                    <i class="fas fa-users"></i>
                    צור סיכום CAB
                </button>
                <button class="cab2-summary-print-btn"
                        id="cdSummaryPrintBtn">
                    <i class="fas fa-print"></i>
                    הדפס
                </button>
                <button class="cab2-summary-export-btn"
                        id="cdSummaryExportBtn">
                    <i class="fas fa-file-excel"></i>
                    יצוא Excel
                </button>
            </div>
        </div>

        <!-- סטטיסטיקות -->
        <div class="cab2-summary-stats">
            <div class="cab2-summary-stat-card cab2-summary-stat-card--total">
                <div class="cab2-summary-stat-val">${stats.total}</div>
                <div class="cab2-summary-stat-lbl">סה"כ שינויים</div>
            </div>
            <div class="cab2-summary-stat-card cab2-summary-stat-card--approved">
                <div class="cab2-summary-stat-val">${stats.approved}</div>
                <div class="cab2-summary-stat-lbl">אושרו</div>
            </div>
            <div class="cab2-summary-stat-card cab2-summary-stat-card--tentative">
                <div class="cab2-summary-stat-val">${stats.approved_tentative}</div>
                <div class="cab2-summary-stat-lbl">אושרו טנטטיבית</div>
            </div>
            <div class="cab2-summary-stat-card cab2-summary-stat-card--rejected">
                <div class="cab2-summary-stat-val">${stats.rejected}</div>
                <div class="cab2-summary-stat-lbl">נדחו</div>
            </div>
            <div class="cab2-summary-stat-card cab2-summary-stat-card--rescheduled">
                <div class="cab2-summary-stat-val">${stats.rescheduled}</div>
                <div class="cab2-summary-stat-lbl">יתואמו מחדש</div>
            </div>
            <div class="cab2-summary-stat-card cab2-summary-stat-card--undecided">
                <div class="cab2-summary-stat-val">${stats.undecided}</div>
                <div class="cab2-summary-stat-lbl">לא טופלו</div>
            </div>
        </div>

        <!-- פס התקדמות -->
        <div class="cab2-summary-progress-wrap">
            <div class="cab2-summary-progress-label">
                <span>התקדמות הישיבה</span>
                <span>${stats.decided} / ${stats.total} טופלו (${pct}%)</span>
            </div>
            <div class="cab2-summary-progress-bar">
                <div class="cab2-summary-progress-fill"
                     style="width:${pct}%"></div>
            </div>
        </div>

        <!-- קבוצות שינויים -->
        <div class="cab2-summary-groups">
            ${groupsHtml || `
            <div class="cab2-summary-empty-state">
                <i class="fas fa-inbox"></i>
                <p>טרם נקבעו החלטות לשבוע זה</p>
            </div>`}
        </div>

    </div>`;

        // ---- אירועים ----
        document.getElementById('cdSummaryBackBtn')
            ?.addEventListener('click', () => {
                this.cabSummaryMode = false;
                this.renderCabView();
            });

        document.getElementById('cdSummaryRefreshBtn')
            ?.addEventListener('click', () => {
                this.triggerExternalRefresh();
            });

        document.getElementById('cdSummaryExportBtn')
            ?.addEventListener('click', () => {
                this.exportCabSummaryToExcel();
            });

        document.getElementById('cdSummaryAttendanceBtn')
            ?.addEventListener('click', () => {
                this.showAttendanceUploadModal();
            });

        document.getElementById('cdSummaryPrintBtn')
            ?.addEventListener('click', () => {
                this.printCabSummary();
            });

        // *** כפתורי איפוס no_cab ***
        content.querySelectorAll('.cab2-summary-reset-btn')
            .forEach(btn => {
                btn.addEventListener('click', () => {
                    const num = btn.getAttribute('data-number');
                    if (!num) return;

                    // אישור מהמשתמש
                    const change = (this.allCabChanges || this.cabChanges)
                        .find(c => c.number === num);
                    const name = change?.name || num;

                    if (!confirm(
                        `לאפס את ההחלטה עבור ${num}?\n` +
                        `"${name}"\n\n` +
                        `השינוי יחזור לרשימת ה-CAB.`
                    )) return;

                    // *** מחק את ההחלטה מהזיכרון המקומי ***
                    const weekKey = this._getCabWeekKey();
                    const key = `${weekKey}_${num}`;
                    delete this.cabDecisions[key];

                    // *** שלח לשרת - שמור עם סטטוס ריק (מחיקה) ***
                    this._resetDecisionOnServer(num, weekKey);

                    // *** עדכן cabChanges - הוסף חזרה ***
                    if (this.allCabChanges) {
                        const c = this.allCabChanges.find(x => x.number === num);
                        if (c && !this.cabChanges.find(x => x.number === num)) {
                            this.cabChanges.push(c);
                        }
                    }

                    this._showColOrderSaveIndicator(`${num} אופס - יוצג שוב ב-CAB ✓`);

                    // *** רענן את הסיכום ***
                    this.showCabSummary();
                });
            });

        // כפתורי עריכה בטבלה
        content.querySelectorAll('.cab2-summary-edit-btn')
            .forEach(btn => {
                btn.addEventListener('click', () => {
                    const num = btn.getAttribute('data-number');
                    const change = this.cabChanges.find(
                        c => c.number === num
                    );
                    if (!change) return;
                    const existing = this.getCabDecision(num);
                    this.showCabDecisionModal(
                        num, change.name, existing
                    );
                    // אחרי סגירת המודל - רענן סיכום
                    const observer = new MutationObserver(() => {
                        if (!document.getElementById(
                            'cdCabDecisionModal')) {
                            observer.disconnect();
                            this.showCabSummary();
                        }
                    });
                    observer.observe(document.body, {
                        childList: true
                    });
                });
            });
    }

    async _resetDecisionOnServer(changeNumber, weekKey) {
        try {
            // שלח החלטה עם סטטוס ריק - השרת ידע למחוק
            const payload = {
                ChangeNumber: changeNumber,
                Status: 'reset',          // סטטוס מיוחד למחיקה
                Notes: '',
                WeekKey: weekKey || this._getCabWeekKey(),
                DecidedBy: (() => {
                    const db = this.currentUser;
                    if (!db) return 'unknown';
                    if (typeof db === 'object')
                        return db.displayName || db.username || 'unknown';
                    return String(db);
                })(),
                DecisionDate: new Date().toISOString()
            };

            await fetch('/Changes/SaveCabDecision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            console.log(`[CAB] ✅ איפוס נשלח לשרת: ${changeNumber}`);
        } catch (err) {
            console.warn('[CAB] שגיאה באיפוס:', err);
        }
    }

    // -------------------------------------------------------
    // הדפסת סיכום CAB - HTML יפה
    // -------------------------------------------------------
    printCabSummary() {
        const weekDecisions = this.getCurrentWeekDecisions();
        const allDecided = Object.values(weekDecisions);

        const stats = {
            total: this.cabChanges.length,
            decided: allDecided.filter(d => d.status !== 'pending').length,
            approved: allDecided.filter(d => d.status === 'approved').length,
            approved_tentative: allDecided.filter(d => d.status === 'approved_tentative').length,
            rejected: allDecided.filter(d => d.status === 'rejected').length,
            rescheduled: allDecided.filter(d => d.status === 'rescheduled').length,
            undecided: this.cabChanges.filter(c => !this.isDecided(c.number)).length
        };

        // תאריך השבוע
        const now = new Date();
        const sun = new Date(now);
        sun.setDate(now.getDate() - now.getDay());
        const sat = new Date(sun);
        sat.setDate(sun.getDate() + 7);
        const fmtD = d =>
            `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        const weekLabel = `${fmtD(sun)} — ${fmtD(sat)}`;

        const printTime = now.toLocaleString('he-IL', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // מיון שינויים לפי תאריך
        const sortedChanges = [...this.cabChanges]
            .filter(c => {
                const decision = this.getCabDecision(c.number);
                return !decision || decision.status !== 'no_cab';
            })
            .sort((a, b) => {
                const da = this.parseDateWithTime(this._getEffectiveStartTime(a));
                const db = this.parseDateWithTime(this._getEffectiveStartTime(b));
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });

        // צבעים לפי סטטוס
        const statusColors = {
            approved: { bg: '#d1fae5', fg: '#065f46', border: '#6ee7b7', label: '✅ אושר' },
            approved_tentative: { bg: '#fff3e0', fg: '#e65100', border: '#ffb74d', label: '🟠 אושר טנטטיבית' },
            rejected: { bg: '#fee2e2', fg: '#7f1d1d', border: '#fca5a5', label: '❌ נדחה' },
            rescheduled: { bg: '#fee2e2', fg: '#7f1d1d', border: '#fca5a5', label: '🔴 יתואם מחדש' },
            undecided: { bg: '#f3f4f6', fg: '#374151', border: '#d1d5db', label: '⬜ לא טופל' },
        };

        // בניית שורות טבלה
        const buildRows = () => {
            return sortedChanges.map((c, i) => {
                const d = this.getCabDecision(c.number);
                const status = d?.status || 'undecided';
                const sc = statusColors[status] || statusColors.undecided;
                const notes = d?.notes || '';
                const rowBg = i % 2 === 0 ? '#ffffff' : '#f9fafb';

                return `
            <tr style="background:${rowBg};">
                <td style="padding:8px 10px; font-weight:700; color:#1e3a8a;
                           border:1px solid #e5e7eb; font-size:11pt;
                           white-space:nowrap; text-align:center;">
                    ${this.escHtml(c.number || '')}
                </td>
                <td style="padding:8px 10px; border:1px solid #e5e7eb;
                           font-size:10pt; line-height:1.4;">
                    ${this.escHtml(c.name || '')}
                </td>
                <td style="padding:8px 10px; border:1px solid #e5e7eb;
                           font-size:10pt; white-space:nowrap; text-align:center;">
                    ${this.escHtml(this._extractSystemName(c.system || ''))}
                </td>
                <td style="padding:8px 10px; border:1px solid #e5e7eb;
                           font-size:10pt; white-space:nowrap;">
                    ${this.escHtml(c.presenters ? this.cleanPresenters(c.presenters) : '—')}
                </td>
                <td style="padding:8px 10px; border:1px solid #e5e7eb;
                           font-size:10pt; white-space:nowrap; text-align:center;">
                    ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(c)))}
                </td>
                <td style="padding:8px 10px; border:1px solid #e5e7eb; text-align:center;">
                    <span style="
                        display:inline-block;
                        padding:3px 10px;
                        border-radius:12px;
                        font-size:9pt;
                        font-weight:700;
                        background:${sc.bg};
                        color:${sc.fg};
                        border:1px solid ${sc.border};
                        white-space:nowrap;
                    ">${sc.label}</span>
                </td>
                <td style="padding:8px 10px; border:1px solid #e5e7eb;
                           font-size:9.5pt; color:#4b5563; font-style:italic;">
                    ${notes ? this.escHtml(notes) : '—'}
                </td>
            </tr>`;
            }).join('');
        };

        // כרטיסי סטטיסטיקות
        const statCards = [
            { label: 'סה"כ', value: stats.total, bg: '#ede9fe', fg: '#4c1d95' },
            { label: 'אושרו', value: stats.approved, bg: '#d1fae5', fg: '#065f46' },
            { label: 'טנטטיבי', value: stats.approved_tentative, bg: '#dbeafe', fg: '#1e3a8a' },
            { label: 'נדחו', value: stats.rejected, bg: '#fee2e2', fg: '#7f1d1d' },
            { label: 'יתואמו', value: stats.rescheduled, bg: '#fee2e2', fg: '#7f1d1d' },
            { label: 'לא טופלו', value: stats.undecided, bg: '#f3f4f6', fg: '#374151' },
        ].map(s => `
        <div style="
            flex:1; min-width:80px;
            background:${s.bg};
            border-radius:10px;
            padding:12px 8px;
            text-align:center;
            border:1px solid ${s.fg}33;
        ">
            <div style="font-size:22pt; font-weight:800; color:${s.fg}; line-height:1;">
                ${s.value}
            </div>
            <div style="font-size:9pt; font-weight:600; color:${s.fg}; margin-top:4px; opacity:0.8;">
                ${s.label}
            </div>
        </div>
    `).join('');

        // פס התקדמות
        const pct = stats.total > 0
            ? Math.round((stats.decided / stats.total) * 100)
            : 0;

        const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<title>סיכום CAB - ${weekLabel}</title>
<style>
    * { box-sizing: border-box; }
    
    @page {
        size: A4 landscape;
        margin: 1.5cm 1.8cm;
    }
    
    body {
        font-family: Arial, 'Segoe UI', sans-serif;
        direction: rtl;
        color: #111827;
        background: #ffffff;
        margin: 0;
        padding: 0;
        font-size: 11pt;
        line-height: 1.5;
    }

    /* ---- כותרת ---- */
    .print-header {
        background: linear-gradient(135deg, #1e1b4b, #4c1d95, #7c3aed);
        color: white;
        padding: 20px 24px;
        border-radius: 12px;
        margin-bottom: 18px;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .print-header-right h1 {
        margin: 0;
        font-size: 18pt;
        font-weight: 800;
        letter-spacing: 0.5px;
    }

    .print-header-right .week-label {
        font-size: 11pt;
        opacity: 0.8;
        margin-top: 4px;
    }

    .print-header-left {
        text-align: left;
        font-size: 9pt;
        opacity: 0.75;
    }

    /* ---- סטטיסטיקות ---- */
    .stats-row {
        display: flex;
        gap: 10px;
        margin-bottom: 16px;
        flex-wrap: wrap;
    }

    /* ---- פס התקדמות ---- */
    .progress-wrap {
        margin-bottom: 18px;
        background: #f3f4f6;
        border-radius: 8px;
        padding: 10px 14px;
    }

    .progress-label {
        display: flex;
        justify-content: space-between;
        font-size: 9pt;
        color: #6b7280;
        font-weight: 600;
        margin-bottom: 6px;
    }

    .progress-bar {
        height: 10px;
        background: #e5e7eb;
        border-radius: 5px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #7c3aed, #22c55e);
        border-radius: 5px;
        width: ${pct}%;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    /* ---- טבלה ---- */
    .changes-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 10pt;
        margin-bottom: 20px;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    .changes-table thead th {
        background: #1e1b4b;
        color: #ffffff;
        padding: 10px 10px;
        text-align: right;
        font-weight: 700;
        font-size: 9.5pt;
        border: 1px solid #312e81;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }

    .changes-table tbody tr:hover {
        background: #f0f4ff !important;
    }

    /* ---- פוטר ---- */
    .print-footer {
        margin-top: 16px;
        padding-top: 10px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        font-size: 8.5pt;
        color: #9ca3af;
    }

    /* ---- הסתרה בהדפסה ---- */
    @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .no-print { display: none !important; }
        
        .changes-table thead th {
            background: #1e1b4b !important;
            color: #ffffff !important;
        }
        
        .print-header {
            background: linear-gradient(135deg, #1e1b4b, #4c1d95) !important;
        }
    }
</style>
</head>
<body>

    <!-- כותרת -->
    <div class="print-header">
        <div class="print-header-right">
            <h1>📋 סיכום ישיבת CAB</h1>
            <div class="week-label">שבוע ${weekLabel}</div>
        </div>
        <div class="print-header-left">
            <div>הודפס: ${printTime}</div>
            <div style="margin-top:4px;">סה"כ ${stats.total} שינויים</div>
        </div>
    </div>

    <!-- סטטיסטיקות -->
    <div class="stats-row">
        ${statCards}
    </div>

    <!-- פס התקדמות -->
    <div class="progress-wrap">
        <div class="progress-label">
            <span>התקדמות הישיבה</span>
            <span>${stats.decided} / ${stats.total} טופלו (${pct}%)</span>
        </div>
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
    </div>

    <!-- טבלת שינויים -->
    <table class="changes-table">
        <thead>
            <tr>
                <th style="width:10%; text-align:center;">מספר שינוי</th>
                <th style="width:28%;">שם השינוי</th>
                <th style="width:12%;">מערכת</th>
                <th style="width:14%;">אחראי</th>
                <th style="width:11%; text-align:center;">תאריך</th>
                <th style="width:13%; text-align:center;">החלטת CAB</th>
                <th style="width:12%;">הערות</th>
            </tr>
        </thead>
        <tbody>
            ${buildRows()}
        </tbody>
    </table>

    <!-- פוטר -->
    <div class="print-footer">
        <span>NOC Portal — סיכום CAB</span>
        <span>שבוע ${weekLabel}</span>
        <span>הודפס: ${printTime}</span>
    </div>

    <!-- כפתור הדפסה (נסתר בהדפסה) -->
    <div class="no-print" style="
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 10px;
        z-index: 9999;
    ">
        <button onclick="window.print()" style="
            padding: 10px 24px;
            background: #7c3aed;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(124,58,237,0.4);
        ">
            🖨️ הדפס
        </button>
        <button onclick="window.close()" style="
            padding: 10px 24px;
            background: #374151;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
        ">
            ✕ סגור
        </button>
    </div>

</body>
</html>`;

        // פתח חלון הדפסה
        const printWin = window.open('', '_blank', 'width=1200,height=800');
        if (!printWin) {
            this._showErrorIndicator('הדפדפן חסם את חלון ההדפסה. אנא אפשר פופאפים.');
            return;
        }

        printWin.document.write(htmlContent);
        printWin.document.close();

        // הדפס אוטומטית אחרי טעינה
        printWin.onload = () => {
            setTimeout(() => {
                printWin.focus();
                // לא מדפיסים אוטומטית - המשתמש יראה תצוגה מקדימה ויחליט
            }, 300);
        };
    }

    initCabThumbDragSort() {
        const thumbsContainer = document.getElementById('cdCabThumbs');
        if (!thumbsContainer) return;

        let dragSrcIndex = null;

        thumbsContainer.querySelectorAll('.cab2-thumb').forEach(thumb => {
            thumb.setAttribute('draggable', 'true');

            thumb.addEventListener('dragstart', (e) => {
                dragSrcIndex = parseInt(thumb.getAttribute('data-index'));
                thumb.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });

            thumb.addEventListener('dragend', () => {
                thumb.style.opacity = '';
                thumbsContainer
                    .querySelectorAll('.cab2-thumb')
                    .forEach(t => t.classList.remove('cab2-thumb--drag-over'));
            });

            thumb.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                thumbsContainer
                    .querySelectorAll('.cab2-thumb')
                    .forEach(t => t.classList.remove('cab2-thumb--drag-over'));
                thumb.classList.add('cab2-thumb--drag-over');
            });

            thumb.addEventListener('dragleave', () => {
                thumb.classList.remove('cab2-thumb--drag-over');
            });

            thumb.addEventListener('drop', (e) => {
                e.preventDefault();
                const dropIndex = parseInt(thumb.getAttribute('data-index'));
                if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;

                // סידור מחדש של המערך
                const moved = this.cabChanges.splice(dragSrcIndex, 1)[0];
                this.cabChanges.splice(dropIndex, 0, moved);

                // עדכון האינדקס הנוכחי
                if (this.cabCurrentIndex === dragSrcIndex) {
                    this.cabCurrentIndex = dropIndex;
                } else if (
                    dragSrcIndex < this.cabCurrentIndex &&
                    dropIndex >= this.cabCurrentIndex
                ) {
                    this.cabCurrentIndex--;
                } else if (
                    dragSrcIndex > this.cabCurrentIndex &&
                    dropIndex <= this.cabCurrentIndex
                ) {
                    this.cabCurrentIndex++;
                }

                // *** שמור את הסדר החדש ב-Cache ***
                this.saveCabOrder();

                // *** הצג אינדיקטור שמירה ***
                this._showSaveIndicator();

                this.renderCabView();
            });
        });
    }

    _showSaveIndicator() {
        // הסר אינדיקטור קודם
        document.getElementById('cdCabSaveIndicator')?.remove();

        const el = document.createElement('div');
        el.id = 'cdCabSaveIndicator';
        el.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>הסדר נשמר</span>
    `;
        el.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        border: 1px solid #374151;
        border-right: 3px solid #22c55e;
        border-radius: 8px;
        padding: 8px 16px;
        color: #4ade80;
        font-size: 12px;
        display: flex;
        align-items: center;
        gap: 7px;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        animation: cdFadeIn 0.2s ease;
        white-space: nowrap;
        direction: rtl;
    `;

        document.body.appendChild(el);

        // היעלם אחרי 2 שניות
        setTimeout(() => {
            el.style.transition = 'opacity 0.3s';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 2000);
    }

    // -------------------------------------------------------
    // ייצוא שינוי ליומן - מאציל ל-ChangesManager למניעת כפילות
    // -------------------------------------------------------
    async exportChangeToCalendar(change) {
        // וודא שהמנהל טעון לפני השימוש
        const manager = await this.ensureChangesManagerLoaded();

        if (manager) {
            manager.exportChangeToCalendar(change);
        } else {
            this._showErrorIndicator('לא ניתן לטעון את מנהל השינויים');
        }
    }

    _showChangeCalendarChoiceModal({
        change, start, end, hasTime,
        fmtICS, fmtOutlook, esc, bodyParts
    }) {
        // הסר מודל קיים
        document.getElementById('cdCalendarChoiceModal')?.remove();

        const pad = n => String(n).padStart(2, '0');

        const modalHTML = `
    <div id="cdCalendarChoiceModal" style="
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0,0,0,0.65);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        direction: rtl;
        backdrop-filter: blur(4px);
        animation: cdFadeIn 0.2s ease;
    ">
        <div style="
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 16px;
            padding: 0;
            width: 92%;
            max-width: 420px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            overflow: hidden;
            animation: cdPopupIn 0.25s ease;
            direction: rtl;
        ">

            <!-- כותרת -->
            <div style="
                background: linear-gradient(135deg, #320F5B, #4c1d95, #6d28d9);
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
                            הוסף ללוח שנה
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
                            [${this.escHtml(change.number)}]
                            ${this.escHtml(change.name || '')}
                        </div>
                    </div>
                </div>
                <button
                    onclick="document.getElementById(
                        'cdCalendarChoiceModal').remove()"
                    style="
                        background: rgba(255,255,255,0.15);
                        border: 1px solid rgba(255,255,255,0.25);
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
                    onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                    onmouseout="this.style.background='rgba(255,255,255,0.15)'"
                >✕</button>
            </div>

            <!-- פרטי אירוע -->
            <div style="
                padding: 14px 22px;
                background: #111827;
                border-bottom: 1px solid #374151;
                font-size: 0.85rem;
                color: #9ca3af;
            ">
                <div style="display:flex; gap:16px; flex-wrap:wrap;">
                    <span style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-calendar"
                           style="color:#a78bfa;"></i>
                        ${this.escHtml(
            this.formatDateDisplay(
                this._getEffectiveStartTime(change)
            )
        )}
                    </span>
                    ${this._getEffectiveEndTime(change) ? `
                    <span style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-flag-checkered"
                           style="color:#a78bfa;"></i>
                        ${this.escHtml(
            this.formatDateDisplay(this._getEffectiveEndTime(change))
        )}
                    </span>` : ''}
                    ${change.system ? `
                    <span style="display:flex; align-items:center; gap:5px;">
                        <i class="fas fa-server"
                           style="color:#a78bfa;"></i>
                        ${this.escHtml(change.system)}
                    </span>` : ''}
                </div>
            </div>

            <!-- כפתורי בחירה -->
            <div style="padding: 22px;">
                <p style="
                    margin: 0 0 16px 0;
                    font-size: 0.9rem;
                    color: #d1d5db;
                    font-weight: 600;
                    text-align: center;
                ">
                    בחר כיצד להוסיף את האירוע ללוח השנה:
                </p>

                <div style="
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                ">

                    <!-- Outlook Web -->
                    <button
                        id="cdCalChoiceOutlookBtn"
                        onclick="window._cdCalChoice('outlook')"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 14px;
                            padding: 14px 18px;
                            background: #1f2937;
                            border: 2px solid #374151;
                            border-radius: 12px;
                            cursor: pointer;
                            text-align: right;
                            transition: all 0.2s;
                            width: 100%;
                            direction: rtl;
                        "
                        onmouseover="
                            this.style.borderColor='#7c3aed';
                            this.style.background='#1a1030';
                            this.style.transform='translateY(-1px)';
                            this.style.boxShadow='0 4px 12px rgba(124,58,237,0.3)';
                        "
                        onmouseout="
                            this.style.borderColor='#374151';
                            this.style.background='#1f2937';
                            this.style.transform='translateY(0)';
                            this.style.boxShadow='none';
                        "
                    >
                        <div style="
                            width: 42px; height: 42px;
                            background: linear-gradient(135deg, #0078d4, #106ebe);
                            border-radius: 10px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                        ">
                            <i class="fas fa-globe"
                               style="color:white; font-size:1.1rem;"></i>
                        </div>
                        <div style="flex:1; text-align:right;">
                            <div style="
                                font-weight: 700;
                                color: #f9fafb;
                                font-size: 0.95rem;
                                margin-bottom: 3px;
                            ">
                                פתח ב-Outlook Web
                            </div>
                            <div style="font-size:0.78rem; color:#6b7280;">
                                יפתח בדפדפן עם הפרטים ממולאים
                            </div>
                        </div>
                        <i class="fas fa-chevron-left"
                           style="color:#4b5563; font-size:0.8rem;"></i>
                    </button>

                    <!-- הורד ICS -->
                    <button
                        onclick="window._cdCalChoice('ics')"
                        style="
                            display: flex;
                            align-items: center;
                            gap: 14px;
                            padding: 14px 18px;
                            background: #1f2937;
                            border: 2px solid #374151;
                            border-radius: 12px;
                            cursor: pointer;
                            text-align: right;
                            transition: all 0.2s;
                            width: 100%;
                            direction: rtl;
                        "
                        onmouseover="
                            this.style.borderColor='#22c55e';
                            this.style.background='#0a2a0a';
                            this.style.transform='translateY(-1px)';
                            this.style.boxShadow='0 4px 12px rgba(34,197,94,0.2)';
                        "
                        onmouseout="
                            this.style.borderColor='#374151';
                            this.style.background='#1f2937';
                            this.style.transform='translateY(0)';
                            this.style.boxShadow='none';
                        "
                    >
                        <div style="
                            width: 42px; height: 42px;
                            background: linear-gradient(135deg, #16a34a, #22c55e);
                            border-radius: 10px;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            flex-shrink: 0;
                        ">
                            <i class="fas fa-download"
                               style="color:white; font-size:1.1rem;"></i>
                        </div>
                        <div style="flex:1; text-align:right;">
                            <div style="
                                font-weight: 700;
                                color: #f9fafb;
                                font-size: 0.95rem;
                                margin-bottom: 3px;
                            ">
                                הורד קובץ ICS
                            </div>
                            <div style="font-size:0.78rem; color:#6b7280;">
                                תואם Outlook Desktop, Google Calendar ועוד
                            </div>
                        </div>
                        <i class="fas fa-chevron-left"
                           style="color:#4b5563; font-size:0.8rem;"></i>
                    </button>

                </div>
            </div>

            <!-- הודעת טעינה -->
            <div id="cdCalChoiceLoading" style="
                display: none;
                padding: 14px 22px;
                text-align: center;
                border-top: 1px solid #374151;
                color: #a78bfa;
                font-size: 0.88rem;
                font-weight: 600;
                gap: 10px;
                align-items: center;
                justify-content: center;
            ">
                <i class="fas fa-spinner fa-spin"></i>
                <span id="cdCalChoiceLoadingText">פותח את Outlook...</span>
            </div>

        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // ── טפל בבחירה ────────────────────────────────────────────
        window._cdCalChoice = (choice) => {

            if (choice === 'outlook') {

                const loadingDiv = document.getElementById('cdCalChoiceLoading');
                const outlookBtn = document.getElementById('cdCalChoiceOutlookBtn');

                if (loadingDiv) loadingDiv.style.display = 'flex';
                if (outlookBtn) {
                    outlookBtn.disabled = true;
                    outlookBtn.style.opacity = '0.6';
                    outlookBtn.style.cursor = 'not-allowed';
                }

                const outlookWebUrl =
                    `https://outlook.office.com/calendar/deeplink/compose` +
                    `?subject=${encodeURIComponent(
                        '[' + change.number + '] ' + (change.name || '')
                    )}` +
                    `&startdt=${encodeURIComponent(fmtOutlook(start))}` +
                    `&enddt=${encodeURIComponent(fmtOutlook(end))}` +
                    `&body=${encodeURIComponent(bodyParts.join('<br>'))}`;

                // פתח חלון מיד (בתוך user gesture)
                const newWin = window.open('about:blank', '_blank');

                if (!newWin) {
                    // הדפדפן חסם פופאפ
                    if (loadingDiv) loadingDiv.style.display = 'none';
                    if (outlookBtn) {
                        outlookBtn.disabled = false;
                        outlookBtn.style.opacity = '1';
                        outlookBtn.style.cursor = 'pointer';
                    }

                    const modal = document.getElementById('cdCalendarChoiceModal');
                    if (modal) {
                        const warningDiv = document.createElement('div');
                        warningDiv.style.cssText = `
                        padding: 12px 20px;
                        background: #2a1e0a;
                        border-top: 1px solid #92400e;
                        color: #fbbf24;
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
                           style="color:#60a5fa; font-weight:700;
                                  text-decoration:underline;">
                            לחץ כאן לפתיחה ידנית
                        </a>
                    `;
                        modal.querySelector('div').appendChild(warningDiv);
                    }
                    return;
                }

                setTimeout(() => {
                    newWin.location.href = outlookWebUrl;

                    document.getElementById('cdCalendarChoiceModal')?.remove();
                }, 100);

            } else if (choice === 'ics') {

                const dtStart = fmtICS(start, hasTime);
                const dtEnd = fmtICS(end, hasTime);

                const lines = [
                    'BEGIN:VCALENDAR',
                    'VERSION:2.0',
                    'PRODID:-//ChangesDashboard//IL',
                    'CALSCALE:GREGORIAN',
                    'METHOD:PUBLISH',
                    'BEGIN:VEVENT',
                    `UID:${change.number}-${Date.now()}@changes`,
                    `DTSTAMP:${fmtICS(new Date(), true)}`,
                    hasTime
                        ? `DTSTART:${dtStart}`
                        : `DTSTART;VALUE=DATE:${dtStart}`,
                    hasTime
                        ? `DTEND:${dtEnd}`
                        : `DTEND;VALUE=DATE:${dtEnd}`,
                    `SUMMARY:${esc(
                        '[' + change.number + '] ' + (change.name || '')
                    )}`,
                    `DESCRIPTION:${esc(bodyParts.join('\\n'))}`,
                    `CATEGORIES:${esc(change.changeCategory || 'Change')}`,
                    'BEGIN:VALARM',
                    'TRIGGER:-PT15M',
                    'ACTION:DISPLAY',
                    `DESCRIPTION:תזכורת: ${esc(change.number)}`,
                    'END:VALARM',
                    'END:VEVENT',
                    'END:VCALENDAR',
                ];

                const blob = new Blob(
                    [lines.join('\r\n')],
                    { type: 'text/calendar;charset=utf-8' }
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${change.number}.ics`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);

                document.getElementById('cdCalendarChoiceModal')?.remove();
            }
        };
    }

    parseDateWithTime(str) {
        if (!str) return null;
        try {
            const s = String(str).trim();

            // yyyy-mm-dd HH:MM:SS  או  yyyy-mm-dd HH:MM
            const iso = s.match(
                /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
            );
            if (iso) {
                const h = iso[4] ? parseInt(iso[4]) : 0;
                const mi = iso[5] ? parseInt(iso[5]) : 0;
                const se = iso[6] ? parseInt(iso[6]) : 0;
                const d = new Date(
                    parseInt(iso[1]),
                    parseInt(iso[2]) - 1,
                    parseInt(iso[3]),
                    h, mi, se
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // dd/mm/yyyy HH:MM  או  dd/mm/yyyy
            const dmy = s.match(
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
            );
            if (dmy) {
                const h = dmy[4] ? parseInt(dmy[4]) : 0;
                const mi = dmy[5] ? parseInt(dmy[5]) : 0;
                const se = dmy[6] ? parseInt(dmy[6]) : 0;
                const d = new Date(
                    parseInt(dmy[3]),
                    parseInt(dmy[2]) - 1,
                    parseInt(dmy[1]),
                    h, mi, se
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // פורמט אנגלי עם & (למשל "Jun 15 & 2026 12:30 PM")
            const cleaned = s.replace(/\s*&\s*/g, ' ').trim();
            const d = new Date(cleaned);
            if (!isNaN(d.getTime())) return d;

            return null;
        } catch { return null; }
    }

    // גלילה לקוביה הפעילה
    _scrollThumbIntoView(idx) {
        setTimeout(() => {
            const thumbs = document.getElementById('cdCabThumbs');
            const active = thumbs?.querySelector('.cab2-thumb--active');
            if (active && thumbs) {
                const thumbLeft = active.offsetLeft;
                const thumbWidth = active.offsetWidth;
                const containerWidth = thumbs.parentElement.offsetWidth;
                thumbs.parentElement.scrollLeft =
                    thumbLeft - (containerWidth / 2) + (thumbWidth / 2);
            }
        }, 50);
    }

    cabField(label, value) {
        if (!value || String(value).trim() === '') return '';

        let displayValue = String(value);

        // החלפת " & " ב-","
        displayValue = displayValue.replace(/\s* & \s*/g, ', ');

        // פורמט תאריכים
        const dateLabels = ['זמן התחלה', 'זמן סיום', 'תאריך', 'CAB Date', 'CAB date'];
        if (dateLabels.some(l => label.includes(l))) {
            displayValue = this.formatDateDisplay(displayValue);
        }

        // ניקוי מציגים
        if (label === 'אחראי') {
            displayValue = this.cleanPresenters(displayValue);
        }

        if (!displayValue || displayValue.trim() === '') return '';

        const MAX_CHARS = 50;
        const isLong = displayValue.length > MAX_CHARS;
        const shortText = isLong
            ? displayValue.substring(0, MAX_CHARS) + '...'
            : displayValue;

        // ID ייחודי לכל שדה
        const fieldId = 'cabField_' + Math.random().toString(36).substr(2, 9);

        return `
<div class="cd-cab-field">
    <span class="cd-cab-field-label">${this.escHtml(label)}</span>
    <span class="cd-cab-field-val" id="${fieldId}">
        <span class="cd-field-short">${this.escHtml(shortText)}</span>
        ${isLong ? `
        <span class="cd-field-full" style="display:none">
            ${this.escHtml(displayValue)}
        </span>
        <button class="cd-field-toggle-btn"
            onclick="(function(btn){
                var s=btn.previousElementSibling;
                var sh=s.previousElementSibling;
                if(s.style.display==='none'){
                    s.style.display='inline';
                    sh.style.display='none';
                    btn.textContent='הצג פחות';
                } else {
                    s.style.display='none';
                    sh.style.display='inline';
                    btn.textContent='הצג הכל';
                }
            })(this)">הצג הכל</button>
        ` : ''}
    </span>
</div>`;
    }

    cabRiskField(label, value) {
        if (!value || String(value).trim() === '') return '';
        const isYes = value.toLowerCase() === 'yes' ||
            value.toLowerCase() === 'כן';
        return `
        <div class="cd-cab-risk-item ${isYes ? 'cd-risk-yes' : 'cd-risk-no'}">
            <i class="fas ${isYes ? 'fa-exclamation-circle' : 'fa-check-circle'}"></i>
            <span>${this.escHtml(label)}</span>
            <span class="cd-risk-val">${this.escHtml(value)}</span>
        </div>`;
    }

    showChangePopup(c) {
        const overlay = document.getElementById('cdPopupOverlay');
        const popup = document.getElementById('cdPopup');
        if (!overlay || !popup) return;

        const conflicts = this.detectConflicts(this.filteredChanges);
        const isRisk = this.isHighRisk(c);
        const isConflict = conflicts.has(c.number);

        // pills
        const pills = [
            [c.changeType, '⚙️', 'סוג שינוי'],
            [
                c.changeReason && c.changeReason.trim() !== 'אחר'
                    ? c.changeReason
                    : null,
                '📌',
                'סיבת שינוי'
            ],
            [c.changeCategory, '🗄️', 'קטגוריית שינוי'],
            [c.environment, '🌐', 'סביבת השינוי'],
            [c.company, '🏢', 'חברה'],
        ];

        const pillsHtml = pills
            .filter(([v]) => v && String(v).trim())
            .map(([val, icon, label]) => `
            <span class="cab2-pill" title="${label}: ${this.escHtml(String(val))}">
                ${icon} ${this.escHtml(String(val))}
            </span>`).join('');

        // team rows
        const team = [
            [c.presenters
                ? this.cleanPresenters(c.presenters)
                : null, 'אחראי', 'teal', 'fa-user-tie'],
            [c.executingTeam, 'צוות מבצע', 'blue', 'fa-user-gear'],
            [c.involvedTeams, 'צוותים מעורבים', 'gray', 'fa-users'],
            [
                c.vendorInvolved === 'כן'
                    ? `${c.vendorName}`
                    : c.vendorInvolved,
                'מעורב ספק',
                'orange', 'fa-user-check'
            ]
        ];
        const teamHtml = team
            .filter(([v]) => v && String(v).trim())
            .map(([val, role, color, icon]) => `
            <div class="cab2-team-row">
                <div class="cab2-avatar cab2-avatar--${color}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="cab2-team-info">
                    <div class="cab2-team-role">${this.escHtml(role)}</div>
                    <div class="cab2-team-name">
                        ${this.escHtml(String(val))}
                    </div>
                </div>
            </div>`).join('');

        // desc blocks
        const descs = [
            ['📝', 'תיאור', c.description, ''],
            ['💡', 'הצורך בשינוי', c.changeNeed, ''],
            ['🔧', 'תוכנית יישום', c.implementationPlan, ''],
            ['↩️', 'תוכנית חזרה', c.rollbackPlan, 'cab2-desc--warn'],
            ['✅', 'תוכנית בדיקה', c.testPlan, 'cab2-desc--ok'],
            ['⚠️', 'תקלות אפשריות', c.possibleFailures, 'cab2-desc--danger'],
            ['💬', 'הערות', c.notes, 'cab2-desc--info'],
        ];
        const descsHtml = descs
            .filter(([, , v]) => v && String(v).trim())
            .map(([icon, label, val, cls]) => `
            <div class="cab2-desc ${cls}">
                <div class="cab2-desc-title">
                    ${icon} ${this.escHtml(label)}
                </div>
                <div class="cab2-desc-body">
                    ${this.escHtml(String(val))}
                </div>
            </div>`).join('');

        // risk items
        const risks = [
            ['סיכון לנזק כספי/רגולטורי?', c.regulatoryRisk,
                'האם כישלון השינוי עשוי להוביל לנזק כספי או לפגיעה במחויבות רגולטורית?'],

            ['משפיע על מערכות ליבה?', c.affectsCoreSystems,
                'האם השינוי משפיע על מערכות ליבה?'],

            ['משפיע על יותר ממערכת אחת?', c.affectsMultipleSystems,
                'האם השינוי משפיע על יותר ממערכת אחת?'],

            ['משפיע על לקוחות הארגון?', c.affectsCustomers,
                'האם השינוי משפיע על לקוחות הארגון?'],

            ['משפיע על משתמשי מערכת?', c.affectsSystemUsers,
                'האם השינוי משפיע על משתמשי מערכת?'],

            ['מתבצע בשעות פעילות עסקית?', c.duringBusinessHours,
                'האם השינוי מתוכנן להתבצע במהלך שעות פעילות עסקית?'],

            ['כולל שינוי בארכיטקטורה?', c.architectureChange,
                'האם השינוי כולל שינוי בארכיטקטורה?'],

            ['מעורבים מספר צוותים?', c.multipleTeams,
                'האם מעורבים יותר מצוות אחד ביישום השינוי?'],

            ['קיימים פערי ידע לביצוע?', c.knowledgeGaps,
                'האם קיימים פערי ידע לצוות המיישם לצורך ביצוע המשימה?'],

            ['נדרשות בדיקות עסקיות?', c.businessTestsRequired,
                'האם נדרשות בדיקות מטעם משתמש עסקי?'],

            ['בדיקות בסביבות נמוכות נכשלו?', c.lowerEnvTestsFailed,
                'האם הבדיקה בסביבות נמוכות נכשלה?'],
        ];
        const risksHtml = risks
            .filter(([, v]) => v && String(v).trim())
            .map(([label, val, tooltip]) => {
                const yes = ['yes', 'כן', 'cab']
                    .includes((val || '').toLowerCase().trim());
                return `
                <div class="cab2-risk-item ${yes ? 'cab2-risk-item--yes' : 'cab2-risk-item--no'}"
                    title="${this.escHtml(tooltip || label)}">
                    <span class="cab2-risk-dot"></span>
                    <span class="cab2-risk-lbl">${this.escHtml(label)}</span>
                    <span class="cab2-risk-val">${yes ? 'כן' : 'לא'}</span>
                </div>`;
            }).join('');

        popup.innerHTML = `

    <div class="cab2-root">
        <div class="cd-popup-cab2">

            <!-- TOPBAR -->
            <div class="cab2-topbar cd-popup-topbar">
                <div class="cab2-topbar-right">
                    ${c.link
                ? `<a href="${this.escHtml(c.link)}"
                                target="_blank"
                                class="cab2-topbar-num cab2-topbar-num--link"
                                onclick="event.stopPropagation()"
                                title="פתח קישור לשינוי">
                                ${this.escHtml(c.number)}
                        </a>`
                : `<div class="cab2-topbar-num">
                                ${this.escHtml(c.number)}
                        </div>`
            }
                    <div class="cab2-topbar-title">
                        ${this.escHtml(c.name || '')}
                        ${c.system ? `<span class="cab2-topbar-system">${this.escHtml(this._extractSystemName(c.system))}</span>` : ''}
                    </div>
                </div>

                <div class="cab2-topbar-center">
                    ${pillsHtml}
                </div>

                <div class="cab2-topbar-left">
                    <span class="cab2-status-badge
                        ${this.getStatusClass(c.status)}">
                        ${this.escHtml(this.mapStatus(c.status))}
                    </span>
                    ${isRisk
                ? `<span class="cab2-flag cab2-flag--risk">
                                ⚠️ סיכון
                        </span>`
                : ''}
                    ${isConflict
                ? `<span class="cab2-flag cab2-flag--conflict">
                                ⚡ התנגשות
                        </span>`
                : ''}
                    <button class="cd-popup-export-cal" id="cdPopupExportCal"
                        title="הוסף ללוח שנה (.ics)">
                        <i class="fas fa-calendar-plus"></i>
                    </button>
                    <button class="cd-popup-close-cab2" id="cdPopupClose">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>
            ${(() => {
                const allDecisions = this.getAllCabDecisions(c.number);
                if (allDecisions.length === 0) return '';

                const lastDecision = allDecisions[0];
                const hasMultiple = allDecisions.length > 1;
                const isCurrentWeek = lastDecision.weekKey === this._getCabWeekKey();

                const decisionDate = lastDecision.timestamp
                    ? new Date(lastDecision.timestamp).toLocaleDateString('he-IL', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    })
                    : '';

                const weekLabel = isCurrentWeek
                    ? 'שבוע זה'
                    : (lastDecision.weekKey
                        ? this._weekKeyToDateRange(lastDecision.weekKey)
                        : '');

                // בניית שורות היסטוריה
                const historyRowsHtml = hasMultiple
                    ? allDecisions.slice(1).map(d => {
                        const dDate = d.timestamp
                            ? new Date(d.timestamp).toLocaleDateString('he-IL', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                            })
                            : '';
                        const dColor = this._getDecisionColor(d.status);
                        return `
                <div class="cab2-decision-history-row">
                    <i class="fas fa-${this._getDecisionIcon(d.status)}"
                       style="color:${dColor}; font-size:12px; flex-shrink:0;"></i>
                    <span class="cab2-decision-history-label"
                          style="color:${dColor};">
                        ${this._getDecisionLabel(d.status)}
                    </span>
                    ${d.notes
                                ? `<span class="cab2-decision-history-notes">
                               "${this.escHtml(d.notes)}"
                           </span>`
                                : ''}
                    <span class="cab2-decision-history-meta">
                        ${d.weekKey
                                ? `<span class="cab2-decided-banner-week">
                                        <i class="fas fa-calendar-alt"></i>
                                        ${this.escHtml(this._weekKeyToDateRange(d.weekKey))}
                                    </span>`
                                : ''}
                        ${dDate
                                ? `<span style="font-size:10px; opacity:0.6;">
                                   ${dDate}
                               </span>`
                                : ''}
                        ${d.decidedBy
                                ? `<span class="cab2-decided-banner-by">
                                   <i class="fas fa-user"></i>
                                   ${this.escHtml(
                                    typeof d.decidedBy === 'object'
                                        ? (d.decidedBy.displayName || d.decidedBy.username || '')
                                        : d.decidedBy
                                )}
                               </span>`
                                : ''}
                    </span>
                </div>`;
                    }).join('')
                    : '';

                return `
<div class="cab2-decided-banner cab2-decided-banner--${lastDecision.status}">
    <i class="fas fa-${this._getDecisionIcon(lastDecision.status)}"></i>
    <span>${this._getDecisionLabel(lastDecision.status)}</span>
    ${lastDecision.notes
                        ? `<span class="cab2-decided-notes">"${this.escHtml(lastDecision.notes)}"</span>`
                        : '<span class="cab2-decided-notes"></span>'}
    <span class="cab2-decided-banner-meta">
        ${isCurrentWeek
                        ? `<span class="cab2-decided-banner-week">
                                   <i class="fas fa-calendar-alt"></i>
                                   שבוע זה
                               </span>`
                        : `
                   ${weekLabel
                            ? `<span class="cab2-decided-banner-week">
                                   <i class="fas fa-calendar-alt"></i>
                                   ${this.escHtml(weekLabel)}
                               </span>`
                            : ''}
                `}

                        ${decisionDate
                        ? `<span style="font-size:10px; opacity:0.6;">
                                   ${decisionDate}
                               </span>`
                        : ''}
               </span>
        ${lastDecision.decidedBy
                        ? `<span class="cab2-decided-banner-by">
                   <i class="fas fa-user"></i> ${this.escHtml(
                            typeof lastDecision.decidedBy === 'object'
                                ? (lastDecision.decidedBy.displayName || lastDecision.decidedBy.username || '')
                                : lastDecision.decidedBy
                        )}
               </span>`
                        : ''}
    </span>
    ${hasMultiple
                        ? `<button class="cab2-decisions-history-toggle"
                   id="cdDecisionsHistoryToggle"
                   title="הצג את כל ההחלטות (${allDecisions.length})">
               <i class="fas fa-history"></i>
               <span>${allDecisions.length} החלטות</span>
               <i class="fas fa-chevron-down cab2-history-chevron"></i>
           </button>`
                        : ''}
</div>
${hasMultiple
                        ? `<div class="cab2-decisions-history-panel" id="cdDecisionsHistoryPanel"
            style="display:none;">
           <div class="cab2-decisions-history-title">
               <i class="fas fa-history"></i>
               היסטוריית החלטות CAB
               <span class="cab2-decisions-history-count">${allDecisions.length}</span>
           </div>
           ${historyRowsHtml}
       </div>`
                        : ''}`;
            })()}
            <!-- BODY: 3 עמודות -->
            <div class="cab2-body cd-popup-body-cab2">

            <!-- עמודה 1: לוח זמנים + גורמים מעורבים -->
            <div class="cab2-col">

                <!-- כרטיס 1: לוח זמנים -->
                <div class="cab2-card" style="height: 30%;">
                    <div class="cab2-card-hdr">📅 לוח זמנים</div>
                    <div class="cab2-card-body">
                        <div class="cab2-time-card-row cab2-time-card-row--start">
                            <div class="cab2-time-card-label-wrap">
                                <i class="fas fa-calendar-day"></i>
                                <span class="cab2-time-card-lbl">התחלה</span>
                            </div>
                            <span class="cab2-time-card-val cab2-time-card-val--start">
                                ${this.escHtml(
                this.formatDateDisplay(this._getEffectiveStartTime(c))
            ) || '—'}
                            </span>
                        </div>
                        ${c.plannedEndTime ? `
                        <div class="cab2-time-card-connector">
                            <div class="cab2-time-card-connector-line"></div>
                        </div>
                        <div class="cab2-time-card-row cab2-time-card-row--end">
                            <div class="cab2-time-card-label-wrap">
                                <i class="fas fa-calendar-check"></i>
                                <span class="cab2-time-card-lbl">סיום</span>
                            </div>
                            <span class="cab2-time-card-val cab2-time-card-val--end">
                                ${this.escHtml(this.formatDateDisplay(this._getEffectiveEndTime(c)))}
                            </span>
                        </div>` : ''}
                    </div>
                </div>

                <!-- כרטיס 2: גורמים מעורבים -->
                <div class="cab2-card" style="flex:1; overflow:hidden;">
                    <div class="cab2-card-hdr">👥 גורמים מעורבים</div>
                    <div class="cab2-card-body cab2-card-body--team">
                        ${teamHtml || '<span class="cab2-empty-msg">אין נתונים</span>'}
                    </div>
                </div>

            </div>

                <!-- עמודה 2: תיאור -->
                <div class="cab2-col cab2-col--wide">
                    <div class="cab2-card cab2-card--scroll">
                        <div class="cab2-card-hdr">📄 תיאור השינוי</div>
                        <div class="cab2-card-body">
                            ${descsHtml ||
            '<span class="cab2-empty-msg">אין תיאור</span>'}
                        </div>
                    </div>
                    <!-- כרטיס קבצים מצורפים -->
                    <div class="cab2-card" id="cabAttCard_${this._safeId(c.number)}"
                        style="max-height:160px; flex-shrink:0;">
                        <div class="cab2-card-hdr">📎 קבצים מצורפים</div>
                        <div class="cab2-card-body" style="
                            display:flex; align-items:center;
                            justify-content:center; color:#6b7280; font-size:12px; gap:6px;">
                            <i class="fas fa-spinner fa-spin"></i>
                            <span>טוען...</span>
                        </div>
                    </div>
                </div>

                <!-- עמודה 3: סיכונים -->
                <div class="cab2-col">
                    <div class="cab2-card">
                        <div class="cab2-card-hdr">🛡️ סיכונים</div>
                        <div class="cab2-card-body">
                            ${risksHtml ||
            '<span class="cab2-empty-msg">אין נתונים</span>'}
                        </div>
                    </div>
                </div>

            </div>

        </div>
    </div>`;

        overlay.style.display = 'block';
        popup.style.display = 'flex';

        document.getElementById('cdPopupClose')
            ?.addEventListener('click', () => this.closePopup());

        document.getElementById('cdPopupExportCal')
            ?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportChangeToCalendar(c);
            });

        // Toggle היסטוריית החלטות
        document.getElementById('cdDecisionsHistoryToggle')
            ?.addEventListener('click', (e) => {
                e.stopPropagation();
                const panel = document.getElementById('cdDecisionsHistoryPanel');
                const chevron = document.querySelector('.cab2-history-chevron');
                if (!panel) return;

                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'block';

                if (chevron) {
                    chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
                }
            });

        overlay.style.display = 'block';
        popup.style.display = 'flex';
        this._loadAndRenderAttachments(c.number, popup);
    }

    // -------------------------------------------------------
    // חילוץ שם מערכת - אם יש | קח את [1] (האינדקס השני)
    // -------------------------------------------------------
    _extractSystemName(system) {
        if (!system) return '';
        const parts = system.split('|');
        if (parts.length > 1) {
            return parts[1].trim();
        }
        return system.trim();
    }

    popupField(label, value) {
        if (!value || String(value).trim() === '') return '';

        let displayValue = String(value);

        // *** פורמט תאריכים ***
        const dateLabels = [
            'זמן התחלה', 'זמן סיום', 'תאריך', 'CAB Date', 'CAB date'
        ];
        if (dateLabels.some(l => label.includes(l))) {
            displayValue = this.formatDateDisplay(displayValue);
        }

        // *** ניקוי מציגים ***
        if (label === 'אחראי') {
            displayValue = this.cleanPresenters(displayValue);
        }

        if (!displayValue || displayValue.trim() === '') return '';

        return `
    <div class="cd-popup-field">
        <span class="cd-popup-label">${this.escHtml(label)}</span>
        <span class="cd-popup-val">${this.escHtml(displayValue)}</span>
    </div>`;
    }

    showDayListPopup(dateKey, changes) {
        const overlay = document.getElementById('cdPopupOverlay');
        const popup = document.getElementById('cdPopup');
        if (!overlay || !popup) return;

        const conflicts = this.detectConflicts(this.filteredChanges);

        let html = `
        <div class="cd-popup-header">
            <div class="cd-popup-title">
                <span class="cd-popup-name">
                    שינויים ל-${dateKey.replace(/-/g, '/')}
                </span>
            </div>
            <button class="cd-popup-close" id="cdPopupClose">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="cd-popup-body">
            <div class="cd-day-list">`;

        changes.forEach(c => {
            const rc = this.isHighRisk(c) ? ' cd-card-risk' : '';
            const cc = conflicts.has(c.number) ? ' cd-card-conflict' : '';
            html += `
            <div class="cd-day-card${rc}${cc} cd-day-card-clickable"
                 data-number="${this.escHtml(c.number)}">
                <div class="cd-day-card-header">
                    <span class="cd-day-card-num">
                        ${this.escHtml(c.number)}
                    </span>
                    <span class="cd-status-badge ${this.getStatusClass(c.status)}">
                        ${this.escHtml(this.mapStatus(c.status))}
                    </span>
                    ${this.isHighRisk(c)
                    ? '<span class="cd-risk-badge"><i class="fas fa-exclamation-triangle"></i> סיכון</span>'
                    : ''}
                </div>
                <div class="cd-day-card-name">
                    ${this.escHtml(c.name || '')}
                </div>
                <div class="cd-day-card-meta">
                    ${c.system
                    ? `<span><i class="fas fa-server"></i>
                           ${this.escHtml(c.system)}</span>`
                    : ''}
                    ${this._getEffectiveStartTime(c)
                    ? `<span><i class="fas fa-clock"></i>
                    ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(c)))}</span>`
                    : ''}
                </div>
            </div>`;
        });

        html += `</div></div>`;
        popup.innerHTML = html;
        overlay.style.display = 'block';
        popup.style.display = 'flex';

        document.getElementById('cdPopupClose')
            ?.addEventListener('click', () => this.closePopup());

        popup.querySelectorAll('.cd-day-card-clickable').forEach(el => {
            el.addEventListener('click', () => {
                const c = this.allChanges.find(
                    x => x.number === el.getAttribute('data-number'));
                if (c) this.showChangePopup(c);
            });
        });
    }

    cabInfoRow(label, value) {
        if (!value || String(value).trim() === '') return '';
        return `
    <div class="cd-cab-info-row">
        <span class="cd-cab-info-label">${this.escHtml(label)}</span>
        <span class="cd-cab-info-value">${this.escHtml(String(value))}</span>
    </div>`;
    }

    cabRiskFieldNew(label, value) {
        if (!value || String(value).trim() === '') return '';
        const isYes = value.toLowerCase() === 'yes' ||
            value.toLowerCase() === 'כן';
        return `
    <div class="cd-cab-risk-item-new ${isYes
                ? 'cd-cab-risk-yes'
                : 'cd-cab-risk-no'}">
        <span class="cd-cab-risk-icon">
            ${isYes ? '⚠️' : '✅'}
        </span>
        <span class="cd-cab-risk-label">${this.escHtml(label)}</span>
        <span class="cd-cab-risk-val">
            ${isYes ? 'כן' : 'לא'}
        </span>
    </div>`;
    }

    closePopup() {
        const overlay = document.getElementById('cdPopupOverlay');
        const popup = document.getElementById('cdPopup');
        if (overlay) overlay.style.display = 'none';
        if (popup) popup.style.display = 'none';
        if (popup) popup.innerHTML = '';
    }

    // -------------------------------------------------------
    // פונקציות עזר
    // -------------------------------------------------------
    organizeByDate(changes) {
        const byDate = {};
        changes.forEach(c => {
            var actualStartTime = (c.actualStartTime || '').trim();
            if (actualStartTime && actualStartTime.toLowerCase() !== 'none' && actualStartTime !== '') {
                actualStartTime = this._normalizeActualDate(c.actualStartTime)
            } else {
                actualStartTime = c.plannedStartTime || c.date
            }
            const d = this.parseDate(actualStartTime);
            if (!d) return;
            const key = this.formatDateKey(
                d.getDate(), d.getMonth() + 1, d.getFullYear());
            if (!byDate[key]) byDate[key] = [];
            byDate[key].push(c);
        });
        return byDate;
    }

    parseDate(str) {
        if (!str) return null;
        try {
            const s = String(str).trim();

            // yyyy-mm-dd HH:MM:SS  או  yyyy-mm-dd
            const iso = s.match(
                /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/
            );
            if (iso) {
                const d = new Date(
                    parseInt(iso[1]),
                    parseInt(iso[2]) - 1,
                    parseInt(iso[3]), 12, 0, 0
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // dd/mm/yyyy HH:MM  או  dd/mm/yyyy
            const dmy = s.match(
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/
            );
            if (dmy) {
                const d = new Date(
                    parseInt(dmy[3]),
                    parseInt(dmy[2]) - 1,
                    parseInt(dmy[1]), 12, 0, 0
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // dd/mm/yy
            const dmyShort = s.match(
                /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/
            );
            if (dmyShort) {
                const d = new Date(
                    parseInt(dmyShort[3]) + 2000,
                    parseInt(dmyShort[2]) - 1,
                    parseInt(dmyShort[1]), 12, 0, 0
                );
                return isNaN(d.getTime()) ? null : d;
            }

            // *** תיקון: פורמט אנגלי עם & (למשל "Jun 15 & 2026 12:30 PM") ***
            const cleaned = s.replace(/\s*&\s*/g, ' ').trim();
            if (cleaned !== s) {
                // רק אם היה & - נסה לפרסר
                const d = new Date(cleaned);
                if (!isNaN(d.getTime())) {
                    return new Date(
                        d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0
                    );
                }
            }

            // *** תיקון: fallback כללי - נסה Date() המובנה ***
            const fallback = new Date(s);
            if (!isNaN(fallback.getTime())) {
                return new Date(
                    fallback.getFullYear(),
                    fallback.getMonth(),
                    fallback.getDate(), 12, 0, 0
                );
            }

            return null;
        } catch { return null; }
    }

    parseToDate(str) {
        if (!str) return null;
        // פורמט mm/dd/yyyy (כפי שמגיע מהשרת)
        const parts = str.split('/');
        if (parts.length === 3) {
            const [month, day, year] = parts.map(Number);
            if (!isNaN(month) && !isNaN(day) && !isNaN(year)) {
                return new Date(year, month - 1, day, 12, 0, 0);
            }
        }
        // fallback
        return this.parseDate(str);
    }

    formatDateKey(day, month, year) {
        return `${String(day).padStart(2, '0')}-` +
            `${String(month).padStart(2, '0')}-` +
            `${year}`;
    }

    formatTime(str) {
        if (!str) return '';
        const m = String(str).match(/(\d{1,2}:\d{2})/);
        return m ? m[1] : '';
    }

    // *** הוספה: ניקוי סיומת [עובד מנורה] ***
    cleanPresenters(presenters) {
        if (!presenters) return '';
        return presenters
            .replace(/\s*\[עובד מנורה\]/g, '')
            .trim();
    }

    // *** הוספה: פורמט תאריך אחיד dd/MM/yyyy HH:mm ***
    formatDateDisplay(str) {
        if (!str) return '';
        try {
            const s = String(str).trim();

            // *** כבר בפורמט הנכון dd/mm/yyyy HH:MM ***
            const already = s.match(
                /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}))?/
            );
            if (already) {
                const day = String(already[1]).padStart(2, '0');
                const month = String(already[2]).padStart(2, '0');
                const year = already[3];
                const time = already[4] ? ` ${already[4]}` : '';
                return `${day}/${month}/${year}${time}`;
            }

            // *** פורמט ISO: yyyy-mm-dd HH:MM ***
            const iso = s.match(
                /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}:\d{2}))?/
            );
            if (iso) {
                const day = String(iso[3]).padStart(2, '0');
                const month = String(iso[2]).padStart(2, '0');
                const year = iso[1];
                const time = iso[4] ? ` ${iso[4]}` : '';
                return `${day}/${month}/${year}${time}`;
            }

            // *** פורמט אנגלי: "Jun 10 & 2026 12:30 PM" ***
            // *** ניקוי ה-& המיותר שמגיע מהקובץ ***
            const cleaned = s.replace(/\s*&\s*/g, ' ').trim();
            const d = new Date(cleaned);
            if (!isNaN(d.getTime())) {
                const day = String(d.getDate()).padStart(2, '0');
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const year = d.getFullYear();
                const hours = String(d.getHours()).padStart(2, '0');
                const mins = String(d.getMinutes()).padStart(2, '0');
                return `${day}/${month}/${year} ${hours}:${mins}`;
            }

            // *** fallback: החזר כמו שהוא ***
            return s;
        } catch {
            return str;
        }
    }

    _getWeekStart(date) {
        const d = new Date(date);
        d.setDate(d.getDate() - d.getDay());
        d.setHours(0, 0, 0, 0);
        return d;
    }

    // -------------------------------------------------------
    // מיפוי סטטוסים מאנגלית לעברית
    // -------------------------------------------------------
    mapStatus(status) {
        if (!status) return '';
        const map = {
            'Draft': 'טיוטה',
            'Request For Authorization': 'לאישור מנהל',
            'Request For Change': 'ממתין לאישור',
            'Planning In Progress': 'בתכנון',
            'Scheduled For Review': 'בבדיקה',
            'Scheduled For Approval': 'לאישור CAB',
            'Scheduled for Approval': 'לאישור CAB',
            'Scheduled': 'אושר',
            'Implementation In Progress': 'בביצוע',
            'Completed': 'בוצע',
            'Closed': 'בוצע',
        };
        return map[status] ?? status;
    }

    getStatusClass(status) {
        if (!status) return '';
        const s = status.toLowerCase();
        if (s.includes('אושר') || s.includes('הושלם') || s.includes('בוצע') ||
            s.includes('approved') || s.includes('complete') || s.includes('scheduled'))
            return 'cd-status-green';
        if (s.includes('בוטל') || s.includes('נדחה') ||
            s.includes('cancel') || s.includes('reject'))
            return 'cd-status-red';
        if (s.includes('ממתין') || s.includes('pending') || s.includes('open') ||
            s.includes('לאישור') || s.includes('בביצוע') || s.includes('progress'))
            return 'cd-status-yellow';
        return 'cd-status-default';
    }

    truncate(text, max) {
        if (!text) return '';
        return text.length <= max ? text : text.substring(0, max) + '...';
    }

    escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    showLoading(show) {
        const el = document.getElementById('cdLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    showError(msg) {
        const content = document.getElementById('cdContent');
        if (content) content.innerHTML =
            `<div class="cd-error">
                <i class="fas fa-exclamation-triangle"></i>
                <p>${this.escHtml(msg)}</p>
             </div>`;
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(async () => {
            // שמור מצב CAB נוכחי
            const wasCabMode = this.cabMode;
            const savedIndex = this.cabCurrentIndex;

            await this.loadAllChanges();
            await this.loadCabDateRange();
            await this.loadCabDecisions();

            // אם היה במצב CAB - שחזר עם הנתונים החדשים
            if (wasCabMode && this.cabMode) {
                this.cabCurrentIndex = Math.min(
                    savedIndex,
                    this.cabChanges.length - 1
                );
                this.renderCabView();
            }
        }, this.REFRESH_MS);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // -------------------------------------------------------
    // מיפוי תחומים - שליפה מ-PhoneDirectory (כמו ב-ServersDashboard)
    // -------------------------------------------------------
    async _getDomainMappingFromDirectory(participantNames) {
        const domainMap = {};
        const notFound = [];

        for (const name of participantNames) {
            if (!name || name.trim().length < 2) continue;

            // *** חלץ שם עברי אם יש " - " ***
            const hebrewName = name.includes(' - ')
                ? name.split(' - ')[0].trim()
                : name.trim();

            try {
                const res = await fetch(
                    `/PhoneDirectory/GetEmployeeOrgInfo?name=${encodeURIComponent(hebrewName)}`,
                    { credentials: 'include' }
                );
                const data = await res.json();

                if (data.success && data.employee) {
                    domainMap[name] = data.employee.domain || '';
                } else {
                    notFound.push(name);
                }
            } catch {
                notFound.push(name);
            }
            await new Promise(r => setTimeout(r, 60));
        }

        return { domainMap, notFound };
    }

    // -------------------------------------------------------
    // פרסור קובץ CSV של Teams Attendance
    // -------------------------------------------------------
    parseTeamsAttendanceCsv(csvText) {
        const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);

        const participants = [];
        let inParticipantsSection = false;
        let headerParsed = false;
        let colMap = {};

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // זיהוי תחילת סעיף משתתפים
            if (line.match(/^2\.\s*(Participants|משתתפים)/i)) {
                inParticipantsSection = true;
                headerParsed = false;
                colMap = {};
                continue;
            }

            // עצירה בסעיף הבא
            if (inParticipantsSection && line.match(/^\d+\./)) {
                break;
            }

            if (!inParticipantsSection) continue;

            // פרסור כותרות
            if (!headerParsed) {
                const cols = this._splitCsvLine(line);
                cols.forEach((c, idx) => {
                    // שמור לפי lowercase ללא רווחים
                    colMap[c.trim().toLowerCase()] = idx;
                });
                headerParsed = true;
                continue;
            }

            // פרסור שורת משתתף
            const cols = this._splitCsvLine(line);
            if (cols.length < 2) continue;

            // Name - תמיד עמודה 0 או לפי colMap
            const nameIdx = colMap['name'] ?? 0;
            let name = (cols[nameIdx] || '').trim();
            // אם השם בפורמט "עברית - English" - קח רק את העברית
            if (name.includes(' - ')) {
                const hebrewPart = name.split(' - ')[0].trim();
                // בדוק שהחלק הראשון מכיל עברית
                if (/[\u0590-\u05FF]/.test(hebrewPart)) {
                    name = hebrewPart;
                }
            }

            if (!name) continue;

            // סנן Unverified
            if (name.includes('(Unverified)')) continue;

            // Email - חפש לפי שמות אפשריים בcolMap
            const emailIdx =
                colMap['email'] ??
                colMap['e-mail'] ??
                colMap['mail'] ??
                colMap['participant id (upn)'] ??
                null;

            let email = emailIdx !== null ? (cols[emailIdx] || '').trim() : '';

            // אם לא נמצא מייל תקין - סרוק את כל העמודות
            if (!email.includes('@')) {
                for (let ci = 0; ci < cols.length; ci++) {
                    const val = (cols[ci] || '').trim();
                    if (val.includes('@') && val.includes('.') && ci !== nameIdx) {
                        email = val;
                        break;
                    }
                }
            }

            // Role
            const roleIdx =
                colMap['role'] ??
                colMap['תפקיד'] ??
                null;
            const role = roleIdx !== null ? (cols[roleIdx] || '').trim() : '';

            participants.push({ name, email, role });
        }
        return participants;
    }

    // פיצול שורת CSV תוך התחשבות במרכאות ו-Tab
    _splitCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
                inQuotes = !inQuotes;
            } else if ((ch === '\t' || ch === ',') && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        result.push(current.trim());
        return result;
    }

    // -------------------------------------------------------
    // בניית מבנה נוכחות תחומים - שליפה מ-PhoneDirectory
    // -------------------------------------------------------
    async buildDomainAttendance(participants) {
        const DOMAIN_ORDER = [
            'תחום מערכות אלמנטרי וכספים',
            'תחום דאטה',
            'תחום אבטחת מידע וסייבר',
            'תחום תשתיות ותפעול',
            'תחום חווית לקוח',
            'פלטפורמות טכנולוגיות',
            'תחום מערכות חיסכון ארוך טווח ובריאות',
            'תחום OCIO',
        ];

        const names = participants.map(p => p.name);

        this._showColOrderSaveIndicator('מחפש נתוני תחומים...');

        const { domainMap, notFound } = await this._getDomainMappingFromDirectory(names);

        const domains = {};
        const unknown = [];

        participants.forEach(p => {
            const domain = domainMap[p.name];
            if (domain && domain.trim()) {
                const d = domain.trim();
                if (!domains[d]) domains[d] = [];
                domains[d].push(p.name);
            } else {
                unknown.push(p.name);
            }
        });

        // *** תיקון: תמיד הצג את כל התחומים לפי הסדר הקבוע ***
        const ordered = [];

        DOMAIN_ORDER.forEach(d => {
            if (domains[d] && domains[d].length > 0) {
                // יש נציגים
                ordered.push({ domain: d, members: domains[d], hasMembers: true });
            } else {
                // אין נציגים - הוסף עם הודעה
                ordered.push({ domain: d, members: [], hasMembers: false });
            }
        });

        // תחומים שלא בסדר הקבוע (אם יש)
        Object.keys(domains).forEach(d => {
            if (!DOMAIN_ORDER.includes(d)) {
                ordered.push({ domain: d, members: domains[d], hasMembers: true });
            }
        });

        return { ordered, unknown, notFound };
    }

    // -------------------------------------------------------
    // הצגת מודל העלאת קובץ נוכחות
    // -------------------------------------------------------
    showAttendanceUploadModal() {
        document.getElementById('cdAttendanceModal')?.remove();

        const modalHtml = `
    <div id="cdAttendanceModal" style="
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.72);
        z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        direction: rtl;
        backdrop-filter: blur(5px);
        animation: cdFadeIn 0.2s ease;
    ">
        <div style="
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 16px;
            width: 92%; max-width: 600px;
            box-shadow: 0 25px 60px rgba(0,0,0,0.6);
            overflow: hidden;
            animation: cdPopupIn 0.25s ease;
            direction: rtl;
        ">
            <!-- כותרת -->
            <div style="
                background: linear-gradient(135deg,#1a1030,#320F5B,#4c1d95);
                padding: 18px 22px;
                display: flex; justify-content: space-between; align-items: center;
            ">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="
                        width:42px; height:42px;
                        background: rgba(167,139,250,0.18);
                        border: 1px solid rgba(167,139,250,0.35);
                        border-radius: 11px;
                        display:flex; align-items:center; justify-content:center;
                        font-size:1.3rem;
                    ">📋</div>
                    <div>
                        <div style="font-size:1rem; font-weight:800; color:#fff;">
                            העלאת דוח נוכחות Teams
                        </div>
                        <div style="font-size:0.75rem; color:rgba(255,255,255,0.6); margin-top:3px;">
                            העלה קובץ CSV מדוח נוכחות פגישת CAB
                        </div>
                    </div>
                </div>
                <button onclick="document.getElementById('cdAttendanceModal').remove()"
                    style="
                        background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2);
                        color:rgba(255,255,255,0.8); width:32px; height:32px;
                        border-radius:50%; cursor:pointer; font-size:0.9rem;
                        display:flex; align-items:center; justify-content:center;
                    ">✕</button>
            </div>

            <!-- גוף -->
            <div style="padding:24px; display:flex; flex-direction:column; gap:18px;">

                <!-- אזור גרירה -->
                <div id="cdAttendanceDropZone" style="
                    border: 2px dashed #4b5563;
                    border-radius: 12px;
                    padding: 36px 20px;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    background: #111827;
                ">
                    <div style="font-size:2.5rem; margin-bottom:10px;">📂</div>
                    <div style="font-size:14px; font-weight:700; color:#d1d5db; margin-bottom:6px;">
                        גרור קובץ CSV לכאן
                    </div>
                    <div style="font-size:12px; color:#6b7280; margin-bottom:14px;">
                        או לחץ לבחירת קובץ
                    </div>
                    <input type="file" id="cdAttendanceFileInput"
                        accept=".csv,.txt"
                        style="display:none" />
                    <button onclick="document.getElementById('cdAttendanceFileInput').click()"
                        style="
                            padding:8px 20px;
                            background:rgba(124,58,237,0.2);
                            border:1px solid rgba(124,58,237,0.4);
                            border-radius:8px; color:#a78bfa;
                            font-size:13px; font-weight:700; cursor:pointer;
                        ">
                        <i class="fas fa-folder-open"></i> בחר קובץ
                    </button>
                    <div id="cdAttendanceFileName" style="
                        margin-top:10px; font-size:12px; color:#6b7280;
                    "></div>
                </div>

                <!-- אינדיקטור טעינה -->
                <div id="cdAttendanceLoading" style="
                    display:none; align-items:center; justify-content:center;
                    gap:10px; padding:14px;
                    background:rgba(124,58,237,0.08);
                    border:1px solid rgba(124,58,237,0.2);
                    border-radius:8px; color:#a78bfa; font-size:13px;
                ">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span id="cdAttendanceLoadingText">מעבד קובץ...</span>
                </div>

                <!-- תוצאה -->
                <div id="cdAttendanceResult" style="display:none;"></div>

                <!-- כפתורי פעולה -->
                <div id="cdAttendanceActions" style="
                    display:none; gap:10px; justify-content:flex-end; flex-wrap:wrap;
                ">
                    <button id="cdAttendanceExportWord" style="
                        padding:9px 18px;
                        background:rgba(59,130,246,0.15);
                        border:1px solid rgba(59,130,246,0.4);
                        border-radius:8px; color:#60a5fa;
                        font-size:13px; font-weight:700; cursor:pointer;
                        display:flex; align-items:center; gap:7px;
                        transition:all 0.2s;
                    ">
                        <i class="fas fa-file-word"></i> הורד Word
                    </button>
                    <button id="cdAttendanceExportEml" style="
                        padding:9px 18px;
                        background:rgba(34,197,94,0.15);
                        border:1px solid rgba(34,197,94,0.4);
                        border-radius:8px; color:#4ade80;
                        font-size:13px; font-weight:700; cursor:pointer;
                        display:flex; align-items:center; gap:7px;
                        transition:all 0.2s;
                    ">
                        <i class="fas fa-envelope-open-text"></i> שלח סיכום במייל
                    </button>
                </div>

            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this._initAttendanceModalEvents();
    }

    // -------------------------------------------------------
    // אירועי מודל נוכחות
    // -------------------------------------------------------
    _initAttendanceModalEvents() {
        const fileInput = document.getElementById('cdAttendanceFileInput');
        const dropZone = document.getElementById('cdAttendanceDropZone');
        const resultDiv = document.getElementById('cdAttendanceResult');
        const actionsDiv = document.getElementById('cdAttendanceActions');
        const fileNameEl = document.getElementById('cdAttendanceFileName');
        const loadingEl = document.getElementById('cdAttendanceLoading');
        const loadingTxt = document.getElementById('cdAttendanceLoadingText');

        const processFile = async (file) => {
            if (!file) return;
            fileNameEl.textContent = `📄 ${file.name}`;

            // הצג loading
            if (loadingEl) loadingEl.style.display = 'flex';
            if (actionsDiv) actionsDiv.style.display = 'none';
            if (resultDiv) resultDiv.style.display = 'none';

            try {
                const text = await file.text();
                const parsedParticipants = this.parseTeamsAttendanceCsv(text);

                if (parsedParticipants.length === 0) {
                    this._showErrorIndicator('לא נמצאו משתתפים בקובץ');
                    if (loadingEl) loadingEl.style.display = 'none';
                    return;
                }

                if (loadingTxt) loadingTxt.textContent =
                    `מחפש נתוני תחומים עבור ${parsedParticipants.length} משתתפים...`;

                // שלוף תחומים מ-PhoneDirectory
                const domainResult = await this.buildDomainAttendance(parsedParticipants);

                if (loadingEl) loadingEl.style.display = 'none';

                this._renderAttendanceResult(
                    resultDiv, actionsDiv,
                    parsedParticipants, domainResult
                );

                // שמור לשימוש בייצוא
                this._lastAttendanceData = {
                    participants: parsedParticipants,
                    domainResult,
                    fileName: file.name
                };

            } catch (err) {
                if (loadingEl) loadingEl.style.display = 'none';
                this._showErrorIndicator('שגיאה בעיבוד הקובץ: ' + err.message);
            }
        };

        // בחירת קובץ
        fileInput?.addEventListener('change', () => {
            if (fileInput.files[0]) processFile(fileInput.files[0]);
        });

        // גרירה
        dropZone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#7c3aed';
            dropZone.style.background = '#1a1030';
        });

        dropZone?.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#4b5563';
            dropZone.style.background = '#111827';
        });

        dropZone?.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#4b5563';
            dropZone.style.background = '#111827';
            if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
        });

        // כפתורי ייצוא
        document.getElementById('cdAttendanceExportWord')
            ?.addEventListener('click', () => {
                if (this._lastAttendanceData) {
                    this.exportAttendanceToWord(this._lastAttendanceData);
                }
            });

        document.getElementById('cdAttendanceExportEml')
            ?.addEventListener('click', () => {
                if (this._lastAttendanceData) {
                    this.exportAttendanceToEml(this._lastAttendanceData);
                }
            });
    }

    // -------------------------------------------------------
    // הצגת תוצאת הפרסור
    // -------------------------------------------------------
    _renderAttendanceResult(resultDiv, actionsDiv, participants, domainResult) {
        const { ordered, unknown } = domainResult;

        let html = `
    <div style="
        background:#111827; border:1px solid #374151;
        border-radius:10px; overflow:hidden;
        max-height:320px; overflow-y:auto;
    ">
        <div style="
            padding:10px 14px;
            background:#1f2937; border-bottom:1px solid #374151;
            font-size:13px; font-weight:700; color:#a78bfa;
            display:flex; align-items:center; gap:8px;
        ">
            <i class="fas fa-users"></i>
            נוכחות תחומים (${participants.length} משתתפים)
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
            <thead>
                <tr style="background:#1f2937;">
                    <th style="padding:8px 12px; text-align:right; color:#6b7280;
                            border-bottom:1px solid #374151; font-weight:700;">
                        שם תחום
                    </th>
                    <th style="padding:8px 12px; text-align:right; color:#6b7280;
                            border-bottom:1px solid #374151; font-weight:700;">
                        נציגים
                    </th>
                </tr>
            </thead>
            <tbody>`;

        ordered.forEach((row, i) => {
            const bg = i % 2 === 0 ? '#111827' : '#141414';

            // *** תיקון: הצג "לא נכח נציג" אם אין נציגים ***
            const membersDisplay = row.hasMembers
                ? row.members.join(', ')
                : 'לא נכח נציג';

            const membersColor = row.hasMembers ? '#9ca3af' : '#6b7280';
            const membersStyle = row.hasMembers
                ? ''
                : 'font-style:italic; color:#6b7280;';

            html += `
        <tr style="background:${bg};">
            <td style="padding:8px 12px; color:#d1d5db;
                    border-bottom:1px solid #1f2937; font-weight:600;
                    white-space:nowrap;">
                ${this.escHtml(row.domain)}
            </td>
            <td style="padding:8px 12px; color:${membersColor};
                    border-bottom:1px solid #1f2937; ${membersStyle}">
                ${this.escHtml(membersDisplay)}
            </td>
        </tr>`;
        });

        if (unknown.length > 0) {
            html += `
        <tr style="background:#2a1e0a;">
            <td style="padding:8px 12px; color:#fbbf24;
                    border-bottom:1px solid #1f2937; font-weight:600;">
                ⚠️ לא זוהה תחום
            </td>
            <td style="padding:8px 12px; color:#fbbf24;
                    border-bottom:1px solid #1f2937;">
                ${this.escHtml(unknown.join(', '))}
            </td>
        </tr>`;
        }

        html += `</tbody></table></div>`;

        resultDiv.innerHTML = html;
        resultDiv.style.display = 'block';
        actionsDiv.style.display = 'flex';
    }

    // -------------------------------------------------------
    // עזר: חלץ תאריך משם קובץ
    // -------------------------------------------------------
    _extractDateFromFileName(fileName) {
        if (!fileName) return null;
        // דוגמה: "CAB - Attendance report 7-19-26.csv"
        // נסה לחלץ תאריך בפורמטים שונים
        const patterns = [
            // M-D-YY או M-D-YYYY
            /(\d{1,2})-(\d{1,2})-(\d{2,4})/,
            // DD/MM/YYYY
            /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/,
            // YYYY-MM-DD
            /(\d{4})-(\d{2})-(\d{2})/,
        ];

        for (const pattern of patterns) {
            const m = fileName.match(pattern);
            if (m) {
                // בדוק אם זה M-D-YY (כמו בשם הקובץ לדוגמה)
                if (m[3] && m[3].length <= 2) {
                    const year = 2000 + parseInt(m[3]);
                    const month = String(m[1]).padStart(2, '0');
                    const day = String(m[2]).padStart(2, '0');
                    return `${day}/${month}/${year}`;
                }
                // DD/MM/YYYY
                if (m[0].includes('/')) {
                    return `${String(m[1]).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}/${m[3]}`;
                }
                // YYYY-MM-DD
                if (m[1].length === 4) {
                    return `${m[3]}/${m[2]}/${m[1]}`;
                }
            }
        }
        return null;
    }

    // -------------------------------------------------------
    // עזר: פורמט תאריך עברי
    // -------------------------------------------------------
    _formatDateHebrew(date) {
        const d = String(date.getDate()).padStart(2, '0');
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const y = date.getFullYear();
        return `${d}/${m}/${y}`;
    }

    // -------------------------------------------------------
    // בנה טבלת שינויים HTML למייל
    // -------------------------------------------------------
    // -------------------------------------------------------
    // בנה טבלת שינויים HTML למייל בלבד - 5 עמודות (ללא צוות מבצע)
    // זהה למייל האמיתי
    // -------------------------------------------------------
    _buildChangesTableHtmlEmail(weekDecisions) {
        const sortedChanges = [...this.cabChanges]
            .filter(c => {
                const decision = this.getCabDecision(c.number);
                return !decision || decision.status !== 'no_cab';
            })
            .sort((a, b) => {
                const da = this.parseDateWithTime(this._getEffectiveStartTime(a));
                const db = this.parseDateWithTime(this._getEffectiveStartTime(b));
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });

        let html = `
<table border="1" cellpadding="6" cellspacing="0"
       style="border-collapse:collapse; width:100%; max-width:900px; table-layout:fixed;
              font-family:Arial,sans-serif; font-size:10pt; direction:rtl;">
    <colgroup>
        <col style="width:10%;" />
        <col style="width:35%;" />
        <col style="width:12%;" />
        <col style="width:15%;" />
        <col style="width:28%;" />
    </colgroup>
    <thead>
        <tr style="background:#dce6f1;">
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                מספר שינוי
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                נושא/פעולה לביצוע
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                תאריך לביצוע
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                אחראי
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                סטטוס CAB
            </th>
        </tr>
    </thead>
    <tbody>`;

        sortedChanges.forEach((c, i) => {
            const d = this.getCabDecision(c.number);
            const history = this.getAllCabDecisions(c.number);

            const lastDecision = history[0];

            const statusLabel = lastDecision
                ? this._getDecisionLabelPlain(lastDecision.status)
                : 'לא טופל';

            const notes = history.length
                ? history.map(h =>
                    (h.notes ? `${h.notes}` : '')
                ).join('\n')
                : '';
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f5f8ff';

            // צבע סטטוס
            let statusColor = '#555555';
            if (lastDecision?.status === 'approved') statusColor = '#23a823';
            else if (lastDecision?.status === 'approved_tentative') statusColor = '#e65100';
            else if (lastDecision?.status === 'rejected' || lastDecision?.status === 'rescheduled')
                statusColor = '#ba0606';

            // bullet points מהערות - זהה למייל האמיתי
            let bulletHtml = '';
            if (notes && notes.trim()) {
                const bullets = notes
                    .split(/[\n;]/)
                    .map(b => b.trim())
                    .filter(b => b.length > 0);

                if (bullets.length > 0) {
                    bulletHtml = `
<ul style="margin:5px 0 0 0; padding-right:16px; padding-left:0;
           list-style-type:disc; font-size:9.5pt;
           font-family:Arial,sans-serif; line-height:1.6; color:#000;">
    ${bullets.map(b =>
                        `<li style="margin-bottom:3px;">${this.escHtml(b)}</li>`
                    ).join('')}
</ul>`;
                }
            }

            html += `
    <tr style="background:${rowBg};">
         <td style="padding:6px 8px; font-weight:bold; text-align:center;
                word-break:break-word; border:1px solid #aaa;
                font-family:Arial,sans-serif; font-size:10pt;
                vertical-align:middle; color:#1f3864;">
            ${this.escHtml(c.number || '')}
        </td>
        <td style="padding:6px 8px; word-wrap:break-word; word-break:break-word;
                   white-space:normal; line-height:1.5; border:1px solid #aaa;
                   font-family:Arial,sans-serif; font-size:10pt;
                   vertical-align:middle;">
            ${this.escHtml(c.name || '')}
        </td>
        <td style="padding:6px 8px; text-align:center; white-space:normal;
                   word-break:break-word; border:1px solid #aaa; vertical-align:middle;text-align:center;
                   font-family:Arial,sans-serif; font-size:9pt;">
            ${this.escHtml(
                this.formatDateDisplay(this._getEffectiveStartTime(c))
            )}
        </td>
        <td style="padding:6px 8px; word-wrap:break-word; word-break:break-word;
           border:1px solid #aaa; vertical-align:middle;text-align:center;
           font-family:Arial,sans-serif; font-size:10pt;
                   vertical-align:middle;">
            <strong style="color:#4274d6;">
                ${this.escHtml(
                c.presenters ? this.cleanPresenters(c.presenters) : ''
            )}
            </strong>
        </td>
        <td style="padding:6px 8px; border:1px solid #aaa; vertical-align:top;
                   font-family:Arial,sans-serif; font-size:10pt;">
            <strong style="color:${statusColor}; font-size:10pt;">
                ${this.escHtml(statusLabel)}
            </strong>
            ${bulletHtml}
        </td>
    </tr>`;
        });

        html += `</tbody></table>`;
        return html;
    }

    // -------------------------------------------------------
    // בנה טבלת שינויים HTML לייצוא - עמודות רחבות
    // -------------------------------------------------------
    _buildChangesTableHtml(weekDecisions) {
        const sortedChanges = [...this.cabChanges]
            .filter(c => {
                const decision = this.getCabDecision(c.number);
                return !decision || decision.status !== 'no_cab';
            })
            .sort((a, b) => {
                const da = this.parseDateWithTime(this._getEffectiveStartTime(a));
                const db = this.parseDateWithTime(this._getEffectiveStartTime(b));
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });

        let html = `
<table border="1" cellpadding="5" cellspacing="0"
       style="border-collapse:collapse; width:100%; max-width:900px; table-layout:fixed;
              font-family:Arial,sans-serif; font-size:10pt; direction:rtl;">
    <colgroup>
        <col style="width:7%;" />
        <col style="width:35%;" />
        <col style="width:7%;" />
        <col style="width:17%;" />
        <col style="width:34%;" />
    </colgroup>
    <thead>
        <tr style="background:#dce6f1;">
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                מספר שינוי
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                נושא/פעולה לביצוע
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                תאריך לביצוע
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                אחראי
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt;
                       border:1px solid #aaa; font-family:Arial,sans-serif;
                       vertical-align:middle; font-weight:bold;">
                סטטוס CAB
            </th>
        </tr>
    </thead>
    <tbody>`;

        sortedChanges.forEach((c, i) => {
            const d = this.getCabDecision(c.number);
            const history = this.getAllCabDecisions(c.number);

            const lastDecision = history[0];

            const statusLabel = lastDecision
                ? this._getDecisionLabelPlain(lastDecision.status)
                : 'לא טופל';

            const notes = history.length
                ? history.map(h =>
                    (h.notes ? `${h.notes}` : '')
                ).join('\n')
                : '';
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f5f8ff';

            // צבע סטטוס
            let statusColor = '#555555';
            if (lastDecision?.status === 'approved') statusColor = '#23a823';
            else if (lastDecision?.status === 'approved_tentative') statusColor = '#e65100';
            else if (lastDecision?.status === 'rejected' || lastDecision?.status === 'rescheduled') statusColor = '#ba0606';

            // bullet points מהערות
            let bulletHtml = '';
            if (notes && notes.trim()) {
                const bullets = notes
                    .split(/[\n;]/)
                    .map(b => b.trim())
                    .filter(b => b.length > 0);

                if (bullets.length > 0) {
                    bulletHtml = `
                <ul style="margin:5px 0 0 0;padding-right:14px;padding-left:0;list-style-type:disc;font-size:9.5pt;font-family:Arial,sans-serif;line-height:1.5; color:#000;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;">
    ${bullets.map(b =>
                        `<li style="margin-bottom:2px;mso-margin-top-alt:0pt;mso-margin-bottom-alt:0pt;">${this.escHtml(b)}</li>`
                    ).join('')}
</ul>`;
                }
            }

            html += `
    <tr style="background:${rowBg};">
        <td style="padding:6px 8px; font-weight:bold; text-align:center;
                   word-break:break-word; border:1px solid #aaa;
                   font-family:Arial,sans-serif; font-size:10pt;
                   vertical-align:middle;text-align:center; color:#1f3864;">
            ${this.escHtml(c.number || '')}
        </td>
        <td style="padding:6px 8px; word-wrap:break-word; word-break:break-word;
                   white-space:normal; line-height:1.5; border:1px solid #aaa;
                   font-family:Arial,sans-serif; font-size:10pt;
                   vertical-align:middle;text-align:center;">
            ${this.escHtml(c.name || '')}
        </td>
        <td style="padding:6px 8px; text-align:center; white-space:normal;
                   word-break:break-word; border:1px solid #aaa; vertical-align:middle;text-align:center;
                   font-family:Arial,sans-serif; font-size:9pt;">
            ${this.escHtml(this.formatDateDisplay(this._getEffectiveStartTime(c)))}
        </td>
        <td style="padding:6px 8px; word-wrap:break-word; word-break:break-word;
           border:1px solid #aaa; vertical-align:middle;text-align:center;
           font-family:Arial,sans-serif; font-size:10pt;">
            <strong style="color:#4274d6;">
                ${this.escHtml(c.presenters ? this.cleanPresenters(c.presenters) : '')}
            </strong>
        </td>
        <td style="padding:6px 8px; border:1px solid #aaa; vertical-align:top;
                   font-family:Arial,sans-serif; font-size:10pt;">
            <strong style="color:${statusColor}; font-size:10pt;">
                ${this.escHtml(statusLabel)}
            </strong>
            ${bulletHtml}
        </td>
    </tr>`;
        });

        html += `</tbody></table>`;
        return html;
    }

    // -------------------------------------------------------
    // ייצוא Word (DOC) - דוח נוכחות - טבלאות רחבות
    // -------------------------------------------------------
    async exportAttendanceToWord(data) {
        const { participants, domainResult, fileName } = data;
        const { ordered, unknown } = domainResult;

        const meetingDate = this._extractDateFromFileName(fileName)
            || this._formatDateHebrew(new Date());

        const allParticipantNames = participants.map(p => p.name).join('; ');

        const weekDecisions = this.getCurrentWeekDecisions();
        const changesTableHtml = this._buildChangesTableHtml(weekDecisions);

        // *** טבלת תחומים - תמיד כל התחומים ***
        let domainTableHtml = `
<table border="1" cellpadding="6" cellspacing="0"
       style="border-collapse:collapse; width:100%; max-width:900px; table-layout:fixed;
              font-family:Arial,sans-serif; font-size:10pt; direction:rtl;">
    <colgroup>
        <col style="width:35%;" />
        <col style="width:65%;" />
    </colgroup>
    <thead>
        <tr style="background:#dce6f1;">
            <th style="text-align:center; padding:7px 8px; font-size:10pt; font-weight:bold;
                       border:1px solid #aaa; font-family:Arial,sans-serif;">
                שם תחום
            </th>
            <th style="text-align:center; padding:7px 8px; font-size:10pt; font-weight:bold;
                       border:1px solid #aaa; font-family:Arial,sans-serif;">
                נציגים
            </th>
        </tr>
    </thead>
    <tbody>`;

        ordered.forEach((row, i) => {
            const bg = i % 2 === 0 ? '#ffffff' : '#f5f8ff';

            // *** תיקון: הצג "לא נכח נציג" אם אין נציגים ***
            const membersText = row.hasMembers
                ? row.members.join(', ')
                : 'לא נכח נציג';

            const membersStyle = row.hasMembers
                ? ''
                : 'font-style:italic; color:#888888;';

            domainTableHtml += `
    <tr style="background:${bg};">
        <td style="padding:6px 8px; font-weight:bold;
                word-wrap:break-word; word-break:break-word;
                border:1px solid #aaa; font-family:Arial,sans-serif;
                font-size:10pt; vertical-align:top;">
            ${this.escHtml(row.domain)}
        </td>
        <td style="padding:6px 8px; word-wrap:break-word;
                word-break:break-word; line-height:1.5;
                border:1px solid #aaa; font-family:Arial,sans-serif;
                font-size:10pt; vertical-align:top; ${membersStyle}">
            ${this.escHtml(membersText)}
        </td>
    </tr>`;
        });


        if (unknown.length > 0) {
            domainTableHtml += `
    <tr style="background:#fff3e0;">
        <td style="padding:6px 8px; font-weight:bold; color:#c65000;
                   border:1px solid #aaa; font-family:Arial,sans-serif; font-size:10pt;">
            לא זוהה תחום
        </td>
        <td style="padding:6px 8px; color:#c65000;
                   word-wrap:break-word; word-break:break-word;
                   border:1px solid #aaa; font-family:Arial,sans-serif; font-size:10pt;">
            ${this.escHtml(unknown.join(', '))}
        </td>
    </tr>`;
        }

        domainTableHtml += `</tbody></table>`;

        const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
<style>
    /* ===== Word Page Settings ===== */
    @page {
        size: 29.7cm 21cm;
        mso-page-orientation: landscape;
       margin: 1.2cm 1.5cm 1.2cm 1.5cm;
    }

    /* MSO - זה מה שWord באמת קורא */
    body {
        font-family: Arial, sans-serif;
        direction: rtl;
        font-size: 10pt;
        margin: 0;
        padding: 0;
        color: #000;

        /* הגדרות שוליים ל-Word */
        mso-margin-top-alt: 0cm;
        mso-margin-bottom-alt: 0cm;
    }

    /* Word-specific page setup */
    div.Section1 {
        page: Section1;
    }

    @page Section1 {
        size: 29.7cm 21cm;
        mso-page-orientation: landscape;
        margin-top: 1.2cm;
        margin-bottom: 1.2cm;
        margin-left: 1.5cm;
        margin-right: 1.5cm;
        mso-header-margin: 0.5cm;
        mso-footer-margin: 0.5cm;
        mso-paper-source: 0;
    }

    table {
        border-collapse: collapse;
        width: 100%;
        margin-bottom: 12px;
        table-layout: fixed;
        direction: rtl;
    }
    th, td {
        border: 1px solid #aaa;
        padding: 6px 8px;
        text-align: right;
        word-wrap: break-word;
        word-break: break-word;
        vertical-align: top;
        font-family: Arial, sans-serif;
    }
    th {
        background: #dce6f1;
        font-weight: bold;
        font-size: 10pt;
        text-align: center;
        vertical-align: middle;
    }
    td {
        font-size: 10pt;
        line-height: 1.4;
    }
    h2 {
        font-family: Arial, sans-serif;
        font-size: 11pt;
        font-weight: bold;
        margin-top: 40px;
        margin-bottom: 15px;
        color: #1f3864;
        text-align: right;
        border-bottom: 1px solid #aaa;
        padding-bottom: 3px;
    }
    .label-cell {
        font-weight: bold;
        background: #dce6f1;
        text-align: right;
        vertical-align: middle;
        white-space: nowrap;
        font-size: 10pt;
        font-family: Arial, sans-serif;
    }
    .value-cell {
        text-align: right;
        vertical-align: middle;
        font-size: 10pt;
        font-family: Arial, sans-serif;
    }
</style>
</head>
<body>
<div class="Section1">

<!-- טבלת כותרת -->
<table style="margin-bottom:10px;">
    <colgroup>
        <col style="width:8%;" />
        <col style="width:28%;" />
        <col style="width:6%;" />
        <col style="width:9%;" />
        <col style="width:9%;" />
        <col style="width:40%;" />
    </colgroup>
    <tr>
        <td class="label-cell"><strong>נושא:</strong></td>
        <td class="value-cell" colspan="5">
            <strong>סיכום ישיבת CAB כללי</strong>
        </td>
    </tr>
    <tr>
        <td class="label-cell"><strong>נערך ביום:</strong></td>
        <td class="value-cell">${this.escHtml(meetingDate)}</td>
        <td class="label-cell"><strong>שעה:</strong></td>
        <td class="value-cell">10:00</td>
        <td class="label-cell"><strong>במקום:</strong></td>
        <td class="value-cell">בוצע ב-Teams</td>
    </tr>
    <tr>
        <td class="label-cell"><strong>נוהל ע"י :</strong></td>
        <td class="value-cell" colspan="2"><strong>טל יוחאי</strong></td>
        <td class="value-cell"></td>
        <td class="label-cell"><strong>סוכם ע"י</strong></td>
        <td class="value-cell">טל יוחאי</td>
    </tr>
    <tr>
        <td class="label-cell" style="vertical-align:top;">
            <strong>נוכחים:</strong>
        </td>
        <td class="value-cell" colspan="5"
            style="word-wrap:break-word; word-break:break-word;
                   line-height:1.6; font-size:9.5pt;">
            ${this.escHtml(allParticipantNames)}
        </td>
    </tr>
</table>

<h2>סיכום פגישה:</h2>
${changesTableHtml}

<h2>נוכחות תחומים:</h2>
${domainTableHtml}

</div>
</body>
</html>`;

        const blob = new Blob(['\ufeff' + htmlContent], {
            type: 'application/msword;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CAB_Summary_${meetingDate.replace(/\//g, '-')}.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        this._showColOrderSaveIndicator('קובץ Word הורד בהצלחה ✓');
    }

    // -------------------------------------------------------
    // ייצוא EML - מייל סיכום CAB
    // -------------------------------------------------------
    exportAttendanceToEml(data) {
        const { participants, domainResult, fileName } = data;
        const { ordered, unknown } = domainResult;

        const meetingDate = this._extractDateFromFileName(fileName)
            || this._formatDateHebrew(new Date());

        const encodeRfc2047 = (str) => {
            if (!str) return '';
            const hasNonAscii = /[^\x00-\x7F]/.test(str);
            if (!hasNonAscii) return str;
            return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(str)))}?=`;
        };

        const toAddresses = participants.map(p => {
            if (p.email && p.email.includes('@')) {
                const encodedName = encodeRfc2047(p.name);
                return `${encodedName} <${p.email}>`;
            } else {
                return encodeRfc2047(p.name);
            }
        });

        const ccAddresses = [
            'PDL-MANAGEMENTINFORMATIONCAB@menoramivt.net',
            'PDL-ITDEPTMGR@menoramivt.net',
            'noc@menoramivt.co.il'
        ];

        // ---- טבלת שינויים ----
        const weekDecisions = this.getCurrentWeekDecisions();
        const sortedChanges = [...this.cabChanges]
            .filter(c => {
                const decision = this.getCabDecision(c.number);
                return !decision || decision.status !== 'no_cab';
            })
            .sort((a, b) => {
                const da = this.parseDateWithTime(this._getEffectiveStartTime(a));
                const db = this.parseDateWithTime(this._getEffectiveStartTime(b));
                if (!da && !db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da - db;
            });

        // בניית שורות טבלת שינויים
        let changesRowsHtml = '';
        sortedChanges.forEach((c, i) => {
            const d = this.getCabDecision(c.number);
            const history = this.getAllCabDecisions(c.number);

            const lastDecision = history[0];

            const statusLabel = lastDecision
                ? this._getDecisionLabelPlain(lastDecision.status)
                : 'לא טופל';

            const notes = history.length
                ? history.map(h =>
                    (h.notes ? `${h.notes}` : '')
                ).join('\n')
                : '';
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f5f8ff';

            let statusColor = '#555555';
            if (lastDecision?.status === 'approved') statusColor = '#23a823';
            else if (lastDecision?.status === 'approved_tentative') statusColor = '#e65100';
            else if (lastDecision?.status === 'rejected' || lastDecision?.status === 'rescheduled')
                statusColor = '#ba0606';

            // bullet points מהערות
            let notesHtml = '';
            if (notes && notes.trim()) {
                const bullets = notes
                    .split(/[\n;]/)
                    .map(b => b.trim())
                    .filter(b => b.length > 0);
                if (bullets.length > 0) {
                    notesHtml = '<br>' + bullets
                        .map(b => `• ${this.escHtml(b)}`)
                        .join('<br>');
                }
            }

            changesRowsHtml += `
        <tr style="background:${rowBg};">
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; border:1px solid #aaa;
                       font-weight:bold; color:#1f3864;
                       text-align:center; vertical-align:middle;">
                ${this.escHtml(c.number || '')}
            </td>
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; border:1px solid #aaa;
                       vertical-align:middle; word-break:break-word;">
                ${this.escHtml(c.name || '')}
            </td>
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;
                       white-space:nowrap;">
                ${this.escHtml(
                this.formatDateDisplay(this._getEffectiveStartTime(c))
            )}
            </td>
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; border:1px solid #aaa;
                       vertical-align:middle;">
                <strong style="color:#4274d6;">
                    ${this.escHtml(
                c.presenters ? this.cleanPresenters(c.presenters) : ''
            )}
                </strong>
            </td>
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; border:1px solid #aaa;
                       vertical-align:top;">
                <strong style="color:${statusColor};">
                    ${this.escHtml(statusLabel)}
                </strong>
                ${notesHtml}
            </td>
        </tr>`;
        });

        // ---- טבלת תחומים - תמיד כל התחומים ----
        let domainRowsHtml = '';
        ordered.forEach((row, i) => {
            const rowBg = i % 2 === 0 ? '#ffffff' : '#f5f8ff';

            // *** תיקון: הצג "לא נכח נציג" אם אין נציגים ***
            const membersText = row.hasMembers
                ? row.members.join(', ')
                : 'לא נכח נציג';

            const membersStyle = row.hasMembers
                ? ''
                : 'font-style:italic; color:#888888;';

            domainRowsHtml += `
        <tr style="background:${rowBg};">
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                    font-size:10pt; border:1px solid #aaa;
                    font-weight:bold; vertical-align:top;">
                ${this.escHtml(row.domain)}
            </td>
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                    font-size:10pt; border:1px solid #aaa;
                    vertical-align:top; word-break:break-word; ${membersStyle}">
                ${this.escHtml(membersText)}
            </td>
        </tr>`;
        });

        if (unknown.length > 0) {
            domainRowsHtml += `
        <tr style="background:#fff3e0;">
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                    font-size:10pt; border:1px solid #aaa;
                    font-weight:bold; color:#c65000; vertical-align:top;">
                לא זוהה תחום
            </td>
            <td style="padding:6px 8px; font-family:Arial,sans-serif;
                    font-size:10pt; border:1px solid #aaa;
                    color:#c65000; vertical-align:top;
                    word-break:break-word;">
                ${this.escHtml(unknown.join(', '))}
            </td>
        </tr>`;
        }

        // ---- גוף המייל ----
        const bodyHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="UTF-8">
</head>
<body dir="rtl" style="
    font-family: Arial, sans-serif;
    font-size: 11pt;
    direction: rtl;
    margin: 20px;
    padding: 0;
    color: #000000;
    background: #ffffff;
">

<p style="font-family:Arial,sans-serif; font-size:11pt; margin:0 0 16px 0;">
    שלום,
</p>

<p style="font-family:Arial,sans-serif;
          font-size:11pt;
          font-weight:bold;
          margin:0 0 12px 0;">
    סיכום ישיבת <span dir="ltr">CAB</span> ${this.escHtml(meetingDate)}:
</p>

<!-- טבלת שינויים -->
<table border="1" cellpadding="0" cellspacing="0"
       style="border-collapse:collapse; width:100%; max-width:860px;
              font-family:Arial,sans-serif; font-size:10pt;
              direction:rtl; margin-bottom:24px; table-layout:fixed;">
    <colgroup>
        <col style="width:10%;" />
        <col style="width:35%;" />
        <col style="width:12%;" />
        <col style="width:15%;" />
        <col style="width:28%;" />
    </colgroup>
    <thead>
        <tr style="background:#dce6f1;">
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                מספר שינוי
            </th>
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                נושא/פעולה לביצוע
            </th>
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                תאריך לביצוע
            </th>
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                אחראי
            </th>
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                סטטוס CAB
            </th>
        </tr>
    </thead>
    <tbody>
        ${changesRowsHtml}
    </tbody>
</table>
<br></br>
<p style="font-family:Arial,sans-serif; font-size:11pt;
          font-weight:bold; margin:0 0 10px 0;">
    נציגות תחומים:
</p>

<!-- טבלת תחומים -->
<table border="1" cellpadding="0" cellspacing="0"
       style="border-collapse:collapse; width:100%; max-width:860px;
              font-family:Arial,sans-serif; font-size:10pt;
              direction:rtl; margin-bottom:28px; table-layout:fixed;">
    <colgroup>
        <col style="width:35%;" />
        <col style="width:65%;" />
    </colgroup>
    <thead>
        <tr style="background:#dce6f1;">
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                שם תחום
            </th>
            <th style="padding:7px 8px; font-family:Arial,sans-serif;
                       font-size:10pt; font-weight:bold; border:1px solid #aaa;
                       text-align:center; vertical-align:middle;">
                נציגים
            </th>
        </tr>
    </thead>
    <tbody>
        ${domainRowsHtml}
    </tbody>
</table>

<br></br>
<br></br>
<!-- חתימה -->
<p style="font-family:Arial,sans-serif; font-size:11pt;
          margin:0 0 4px 0;">
    שבוע טוב
</p>

</body>
</html>`;

        const subject = `סיכום ישיבת CAB לתאריך ${meetingDate}`;

        const toLine = toAddresses.join(';\r\n\t');
        const ccLine = ccAddresses.join(';\r\n\t');
        const finalBodyBase64 = btoa(unescape(encodeURIComponent(bodyHtml)));
        const encodedSubject =
            `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

        const emlContent = [
            `To: ${toLine}`,
            `CC: ${ccLine}`,
            `Subject: ${encodedSubject}`,
            `MIME-Version: 1.0`,
            `Content-Type: multipart/alternative; boundary="cab_boundary_001"`,
            `X-Mailer: CAB Dashboard`,
            `X-Unsent: 1`,
            ``,
            `--cab_boundary_001`,
            `Content-Type: text/plain; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            ``,
            btoa(unescape(encodeURIComponent(
                `שלום,\n\nסיכום ישיבת CAB ${meetingDate}\n\nשבוע טוב,\nטל יוחאי`
            ))),
            ``,
            `--cab_boundary_001`,
            `Content-Type: text/html; charset=UTF-8`,
            `Content-Transfer-Encoding: base64`,
            ``,
            finalBodyBase64,
            ``,
            `--cab_boundary_001--`,
        ].join('\r\n');

        const blob = new Blob([emlContent], { type: 'message/rfc822' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CAB_Summary_${meetingDate.replace(/\//g, '-')}.eml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        this._showColOrderSaveIndicator('קובץ מייל הורד בהצלחה ✓');
    }

    // -------------------------------------------------------
    // ATTACHMENTS MODULE - הוסף לתוך class ChangesDashboard
    // -------------------------------------------------------

    // -------------------------------------------------------
    // טעינת קבצים מצורפים לשינוי
    // -------------------------------------------------------
    async loadAttachments(changeNumber) {
        try {
            const res = await fetch(
                `/Changes/GetAttachments?changeNumber=` +
                encodeURIComponent(changeNumber)
            );
            const data = await res.json();
            return data.success ? (data.attachments || []) : [];
        } catch {
            return [];
        }
    }

    // -------------------------------------------------------
    // בניית HTML לאזור קבצים מצורפים
    // -------------------------------------------------------
    async _buildAttachmentsHtml(changeNumber) {
        const attachments = await this.loadAttachments(changeNumber);

        const iconMap = {
            '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️',
            '.gif': '🖼️', '.webp': '🖼️', '.bmp': '🖼️',
            '.pdf': '📄', '.doc': '📝', '.docx': '📝',
            '.xls': '📊', '.xlsx': '📊',
            '.txt': '📃', '.csv': '📃',
            '.zip': '🗜️', '.msg': '✉️', '.eml': '✉️',
        };

        const formatSize = (bytes) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024)
                return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        const hasFiles = attachments.length > 0;

        const listHtml = !hasFiles
            ? `<div class="cab2-att-empty"></div>`
            : attachments.map(att => {
                const icon = iconMap[att.extension] || '📎';
                const isImage = [
                    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
                ].includes(att.extension);
                const isPdf = att.extension === '.pdf';
                const isEmail = att.extension === '.eml' || att.extension === '.msg';
                const isOffice = ['.doc', '.docx', '.xls', '.xlsx'].includes(att.extension);
                const canPreview = isImage || isPdf || isEmail || isOffice;

                return `
            <div class="cab2-att-item"
                data-filename="${this.escHtml(att.fileName)}"
                data-change="${this.escHtml(changeNumber)}">
                <div class="cab2-att-icon">${icon}</div>
                <div class="cab2-att-info">
                    <div class="cab2-att-name"
                        title="${this.escHtml(att.originalName)}">
                        ${this.escHtml(this.truncate(att.originalName, 95))}
                    </div>
                    <div class="cab2-att-meta">
                        <span>${formatSize(att.fileSize)}</span>
                        <span>•</span>
                        <span>${att.uploadedAt}</span>
                    </div>
                </div>
                <div class="cab2-att-actions">
                    ${canPreview ? `
                    <button class="cab2-att-btn cab2-att-btn--preview"
                            data-filename="${this.escHtml(att.fileName)}"
                            data-change="${this.escHtml(changeNumber)}"
                            data-type="${att.extension}"
                            title="תצוגה מקדימה">
                        <i class="fas fa-eye"></i>
                    </button>` : ''}
                    <a class="cab2-att-btn cab2-att-btn--download"
                    href="/Changes/DownloadAttachment?changeNumber=${encodeURIComponent(changeNumber)}&fileName=${encodeURIComponent(att.fileName)}"
                    download="${this.escHtml(att.originalName)}"
                    title="הורד">
                        <i class="fas fa-download"></i>
                    </a>
                    <button class="cab2-att-btn cab2-att-btn--delete"
                            data-filename="${this.escHtml(att.fileName)}"
                            data-change="${this.escHtml(changeNumber)}"
                            title="מחק">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>`;
            }).join('');

        const safeNum = this._safeId(changeNumber);

        return `
    <div class="cab2-att-panel" id="cabAttCard_${safeNum}">
        <div class="cab2-card-hdr">
            📎 קבצים מצורפים
            ${hasFiles
                ? `<span class="cab2-att-count">${attachments.length}</span>`
                : ''}
            <button class="cab2-att-add-btn" 
                    id="cabAttAddBtn_${safeNum}"
                    title="הוסף קובץ">
                <i class="fas fa-plus"></i>
            </button>
        </div>
        <div class="cab2-att-dropzone cab2-att-dropzone--hidden cab2-att-dropzone--add"
            id="cabAttDropzoneAdd_${safeNum}">
            <i class="fas fa-cloud-upload-alt"></i>
            <span>גרור קובץ לכאן או לחץ להעלאה</span>
            <input type="file"
                id="cabAttFileInputAdd_${safeNum}"
                class="cab2-att-file-input"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,
                        .txt,.csv,.zip,.msg,.eml" />
        </div>
        <div class="cab2-att-progress"
            id="cabAttProgress_${safeNum}"
            style="display:none">
            <div class="cab2-att-progress-bar"
                id="cabAttProgressBar_${safeNum}">
            </div>
            <span class="cab2-att-progress-text"
                id="cabAttProgressText_${safeNum}">
                מעלה...
            </span>
        </div>
        <div class="cab2-att-list"
            id="cabAttList_${safeNum}">
            ${listHtml}
        </div>
    </div>`;
    }

    // -------------------------------------------------------
    // אתחול אירועי אזור קבצים
    // -------------------------------------------------------
    _initAttachmentEvents(container, changeNumber) {
        const safeNum = this.escHtml(changeNumber);

        const dropzone = container.querySelector(`#cabAttDropzone_${safeNum}`);
        const fileInput = container.querySelector(`#cabAttFileInput_${safeNum}`);
        const dropzoneAdd = container.querySelector(`#cabAttDropzoneAdd_${safeNum}`);
        const fileInputAdd = container.querySelector(`#cabAttFileInputAdd_${safeNum}`);
        const addBtn = container.querySelector(`#cabAttAddBtn_${safeNum}`);

        // *** פונקציה משותפת לטיפול בקבצים ***
        const handleFiles = (files) => {
            if (files.length > 0)
                this._uploadFiles(files, changeNumber, container);
        };

        // ---- dropzone ראשי (מוצג כשאין קבצים) ----
        if (dropzone && fileInput) {
            dropzone.addEventListener('click', (e) => {
                if (e.target === fileInput) return;
                fileInput.click();
            });

            dropzone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzone.classList.add('cab2-att-dropzone--active');
            });

            dropzone.addEventListener('dragleave', () => {
                dropzone.classList.remove('cab2-att-dropzone--active');
            });

            dropzone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzone.classList.remove('cab2-att-dropzone--active');
                handleFiles(Array.from(e.dataTransfer.files));
            });

            fileInput.addEventListener('change', () => {
                handleFiles(Array.from(fileInput.files));
                fileInput.value = '';
            });
        }

        // ---- כפתור הוספה (מוצג תמיד בכותרת) ----
        if (addBtn && dropzoneAdd && fileInputAdd) {
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // *** הצג/הסתר את dropzone ההוספה ***
                const isVisible = !dropzoneAdd.classList.contains(
                    'cab2-att-dropzone--hidden'
                );
                if (isVisible) {
                    dropzoneAdd.classList.add('cab2-att-dropzone--hidden');
                } else {
                    dropzoneAdd.classList.remove('cab2-att-dropzone--hidden');
                }
            });

            dropzoneAdd.addEventListener('click', (e) => {
                if (e.target === fileInputAdd) return;
                fileInputAdd.click();
            });

            dropzoneAdd.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropzoneAdd.classList.add('cab2-att-dropzone--active');
            });

            dropzoneAdd.addEventListener('dragleave', () => {
                dropzoneAdd.classList.remove('cab2-att-dropzone--active');
            });

            dropzoneAdd.addEventListener('drop', (e) => {
                e.preventDefault();
                dropzoneAdd.classList.remove('cab2-att-dropzone--active');
                handleFiles(Array.from(e.dataTransfer.files));
            });

            fileInputAdd.addEventListener('change', () => {
                handleFiles(Array.from(fileInputAdd.files));
                fileInputAdd.value = '';
            });
        }

        container.querySelectorAll('.cab2-att-item').forEach(item => {
            item.addEventListener('dblclick', () => {
                const previewBtn = item.querySelector('.cab2-att-btn--preview');
                if (previewBtn) {
                    previewBtn.click();
                }
            });
        });

        // ---- תצוגה מקדימה ----
        container.querySelectorAll('.cab2-att-btn--preview').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const fn = btn.getAttribute('data-filename');
                const cn = btn.getAttribute('data-change');
                const ext = btn.getAttribute('data-type');
                this._showAttachmentPreview(cn, fn, ext);
            });
        });

        // ---- מחיקה ----
        container.querySelectorAll('.cab2-att-btn--delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const fn = btn.getAttribute('data-filename');
                const cn = btn.getAttribute('data-change');

                if (!confirm('למחוק את הקובץ?')) return;

                try {
                    const res = await fetch('/Changes/DeleteAttachment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ changeNumber: cn, fileName: fn })
                    });
                    const data = await res.json();

                    if (data.success) {
                        await this._refreshAttachmentList(cn, container);
                        this._showColOrderSaveIndicator('קובץ נמחק ✓');
                    } else {
                        this._showErrorIndicator('שגיאה במחיקה: ' + data.message);
                    }
                } catch (err) {
                    this._showErrorIndicator('שגיאת תקשורת: ' + err.message);
                }
            });
        });
    }

    // -------------------------------------------------------
    // העלאת קבצים
    // -------------------------------------------------------
    async _uploadFiles(files, changeNumber, container) {
        const safeNum = this.escHtml(changeNumber);
        const progressEl = container.querySelector(`#cabAttProgress_${safeNum}`);
        const progressBar = container.querySelector(`#cabAttProgressBar_${safeNum}`);
        const progressText = container.querySelector(`#cabAttProgressText_${safeNum}`);

        if (progressEl) progressEl.style.display = 'flex';

        let uploaded = 0;
        let errors = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const pct = Math.round((i / files.length) * 100);

            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) progressText.textContent =
                `מעלה ${i + 1}/${files.length}: ${file.name}`;

            try {
                const formData = new FormData();
                formData.append('changeNumber', changeNumber);
                formData.append('file', file);

                const res = await fetch('/Changes/UploadAttachment', {
                    method: 'POST', body: formData
                });
                const data = await res.json();

                if (data.success) { uploaded++; }
                else {
                    errors++;
                    this._showErrorIndicator(
                        `שגיאה בהעלאת ${file.name}: ${data.message}`);
                }
            } catch (err) {
                errors++;
                this._showErrorIndicator(`שגיאת תקשורת: ${err.message}`);
            }
        }

        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent =
            `הועלו ${uploaded} קבצים` + (errors > 0 ? ` (${errors} שגיאות)` : '');

        setTimeout(() => {
            if (progressEl) progressEl.style.display = 'none';
            if (progressBar) progressBar.style.width = '0%';
        }, 1500);

        if (uploaded > 0) {
            await this._refreshAttachmentList(changeNumber, container);

            // *** הסתר את dropzone ההוספה לאחר העלאה מוצלחת ***
            const dropzoneAdd = container.querySelector(
                `#cabAttDropzoneAdd_${safeNum}`
            );
            if (dropzoneAdd) {
                dropzoneAdd.classList.add('cab2-att-dropzone--hidden');
            }

            this._showColOrderSaveIndicator(`${uploaded} קבצים הועלו בהצלחה ✓`);
        }
    }

    // -------------------------------------------------------
    // רענון רשימת קבצים
    // -------------------------------------------------------
    async _refreshAttachmentList(changeNumber, container) {
        const safeNum = this.escHtml(changeNumber);
        const listEl = container.querySelector(
            `#cabAttList_${safeNum}`);
        const titleEl = container.querySelector('.cab2-att-title');

        if (!listEl) return;

        const attachments = await this.loadAttachments(changeNumber);

        const iconMap = {
            '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️',
            '.gif': '🖼️', '.webp': '🖼️', '.bmp': '🖼️',
            '.pdf': '📄', '.doc': '📝', '.docx': '📝',
            '.xls': '📊', '.xlsx': '📊',
            '.txt': '📃', '.csv': '📃',
            '.zip': '🗜️', '.msg': '✉️', '.eml': '✉️',
        };

        const formatSize = (bytes) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024)
                return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        if (attachments.length === 0) {
            listEl.innerHTML = `
            <div class="cab2-att-empty">
                <i class="fas fa-paperclip"></i>
                <span>אין קבצים מצורפים</span>
            </div>`;
        } else {
            listEl.innerHTML = attachments.map(att => {
                const icon = iconMap[att.extension] || '📎';
                const isImage = [
                    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
                ].includes(att.extension);
                const isPdf = att.extension === '.pdf';
                const isEmail = att.extension === '.eml' || att.extension === '.msg';
                const isOffice = ['.doc', '.docx', '.xls', '.xlsx'].includes(att.extension);
                const canPreview = isImage || isPdf || isEmail || isOffice;

                return `
            <div class="cab2-att-item"
                 data-filename="${this.escHtml(att.fileName)}"
                 data-change="${this.escHtml(changeNumber)}">
                <div class="cab2-att-icon">${icon}</div>
                <div class="cab2-att-info">
                    <div class="cab2-att-name"
                         title="${this.escHtml(att.originalName)}">
                        ${this.escHtml(
                    this.truncate(att.originalName, 95)
                )}
                    </div>
                    <div class="cab2-att-meta">
                        <span>${formatSize(att.fileSize)}</span>
                        <span>•</span>
                        <span>${att.uploadedAt}</span>
                    </div>
                </div>
                <div class="cab2-att-actions">
                    ${canPreview ? `
                    <button class="cab2-att-btn cab2-att-btn--preview"
                            data-filename="${this.escHtml(att.fileName)}"
                            data-change="${this.escHtml(changeNumber)}"
                            data-type="${att.extension}"
                            title="תצוגה מקדימה">
                        <i class="fas fa-eye"></i>
                    </button>` : ''}
                    <a class="cab2-att-btn cab2-att-btn--download"
                       href="/Changes/DownloadAttachment?changeNumber=${encodeURIComponent(changeNumber)
                    }&fileName=${encodeURIComponent(att.fileName)}"
                       download="${this.escHtml(att.originalName)}"
                       title="הורד">
                        <i class="fas fa-download"></i>
                    </a>
                    <button class="cab2-att-btn cab2-att-btn--delete"
                            data-filename="${this.escHtml(att.fileName)}"
                            data-change="${this.escHtml(changeNumber)}"
                            title="מחק">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>`;
            }).join('');
        }

        // *** עדכן מונה בכותרת ***
        if (titleEl) {
            const countBadge = titleEl.querySelector('.cab2-att-count');
            if (attachments.length > 0) {
                if (countBadge) {
                    countBadge.textContent = attachments.length;
                } else {
                    titleEl.insertAdjacentHTML('beforeend',
                        `<span class="cab2-att-count">
                         ${attachments.length}
                     </span>`
                    );
                }
            } else {
                countBadge?.remove();
            }
        }

        // *** חבר אירועים מחדש ***
        this._initAttachmentEvents(container, changeNumber);
    }

    // -------------------------------------------------------
    // תצוגה מקדימה של קובץ
    // -------------------------------------------------------
    _showAttachmentPreview(changeNumber, fileName, ext) {
        document.getElementById('cabAttPreviewModal')?.remove();

        // *** URL להורדה ***
        const downloadUrl =
            `/Changes/DownloadAttachment` +
            `?changeNumber=${encodeURIComponent(changeNumber)}` +
            `&fileName=${encodeURIComponent(fileName)}`;

        // *** URL לצפייה - תיקון: changeNumber + fileName נפרדים ***
        const viewUrl =
            `/Changes/ViewAttachment` +
            `?changeNumber=${encodeURIComponent(changeNumber)}` +
            `&fileName=${encodeURIComponent(fileName)}`;

        const isImage = [
            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
        ].includes(ext);

        const isPdf = ext === '.pdf';
        const isEmail = ext === '.eml' || ext === '.msg';
        const isOffice = [
            '.doc', '.docx', '.xls', '.xlsx'
        ].includes(ext);

        // *** EML/MSG - מודל מיוחד ***
        if (isEmail) {
            this._showEmailPreviewModal(changeNumber, fileName, downloadUrl);
            return;
        }

        let previewContent = '';

        if (isImage) {
            previewContent = `
        <div class="cab2-preview-img-wrap">
            <img src="${downloadUrl}"
                 class="cab2-preview-img"
                 alt="${this.escHtml(fileName)}"
                 onload="this.style.opacity='1'"
                 onerror="
                     this.style.display='none';
                     document.getElementById('cabPreviewImgError')
                         .style.display='flex';
                 " />
            <div id="cabPreviewImgError"
                 class="cab2-preview-error"
                 style="display:none">
                <i class="fas fa-exclamation-triangle"></i>
                <span>לא ניתן לטעון את התמונה</span>
            </div>
        </div>`;

        } else if (isPdf || isOffice) {
            // *** תיקון: השתמש ב-viewUrl הנכון ***
            previewContent = `
        <div class="cab2-preview-pdf-wrap">
            <iframe
                src="${viewUrl}"
                class="cab2-preview-pdf"
                title="${this.escHtml(fileName)}"
                frameborder="0"
                onload="this.style.display='block'">
            </iframe>
        </div>`;

        } else {
            previewContent = `
        <div style="
            display:flex; flex-direction:column;
            align-items:center; justify-content:center;
            height:100%; color:#9ca3af; gap:16px; padding:40px;
        ">
            <i class="fas fa-file" style="font-size:3rem;"></i>
            <p>לא ניתן להציג קובץ מסוג ${this.escHtml(ext)}</p>
            <a href="${downloadUrl}"
               download="${this.escHtml(fileName)}"
               style="
                   padding:10px 20px;
                   background:#374151; color:#fff;
                   border-radius:8px; text-decoration:none;
                   display:inline-flex; align-items:center; gap:8px;
               ">
                <i class="fas fa-download"></i> הורד קובץ
            </a>
        </div>`;
        }

        const typeIcon = isImage ? '🖼️'
            : isPdf ? '📄'
                : isOffice ? '📝'
                    : '📎';

        const modalHtml = `
    <div id="cabAttPreviewModal" style="
        position:fixed; inset:0;
        background:rgba(0,0,0,0.88);
        z-index:999999;
        display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        direction:rtl;
        backdrop-filter:blur(6px);
        padding:16px;
    ">
        <!-- כותרת -->
        <div style="
            width:100%; max-width:1100px;
            display:flex; align-items:center;
            justify-content:space-between;
            padding:10px 16px;
            background:#1f2937;
            border:1px solid #374151;
            border-radius:12px 12px 0 0;
            border-bottom:none;
            gap:12px; flex-shrink:0;
        ">
            <div style="
                display:flex; align-items:center;
                gap:10px; min-width:0;
            ">
                <span style="font-size:1.3rem; flex-shrink:0;">
                    ${typeIcon}
                </span>
                <span style="
                    font-size:13px; font-weight:700; color:#f9fafb;
                    overflow:hidden; text-overflow:ellipsis;
                    white-space:nowrap;
                ">
                    ${this.escHtml(fileName)}
                </span>
            </div>
            <div style="
                display:flex; align-items:center;
                gap:8px; flex-shrink:0;
            ">
                <a href="${downloadUrl}"
                download="${this.escHtml(fileName)}"
                style="
                    display:inline-flex; align-items:center; gap:6px;
                    padding:6px 14px;
                    background:rgba(34,197,94,0.15);
                    border:1px solid rgba(34,197,94,0.35);
                    border-radius:7px; color:#4ade80;
                    font-size:12px; font-weight:700;
                    text-decoration:none;
                ">
                    <i class="fas fa-download"></i> הורד
                </a>
                <button
                    onclick="document.getElementById(
                        'cabAttPreviewModal').remove()"
                    style="
                        background:rgba(239,68,68,0.15);
                        border:1px solid rgba(239,68,68,0.35);
                        color:#f87171; width:34px; height:34px;
                        border-radius:8px; cursor:pointer;
                        font-size:14px;
                        display:flex; align-items:center;
                        justify-content:center;
                    ">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>

        <!-- תוכן -->
        <div style="
            width:100%; max-width:1100px; flex:1;
            background:#111827; border:1px solid #374151;
            border-radius:0 0 12px 12px; overflow:hidden;
            display:flex; align-items:center; justify-content:center;
            min-height:0; max-height:calc(90vh - 80px);
        ">
            ${previewContent}
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // סגירה ב-Escape
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                document.getElementById('cabAttPreviewModal')?.remove();
                document.removeEventListener('keydown', onEsc);
            }
        };
        document.addEventListener('keydown', onEsc);

        // סגירה בלחיצה על הרקע
        document.getElementById('cabAttPreviewModal')
            ?.addEventListener('click', (e) => {
                if (e.target.id === 'cabAttPreviewModal') {
                    document.getElementById('cabAttPreviewModal')?.remove();
                    document.removeEventListener('keydown', onEsc);
                }
            });
    }

    async _showEmailPreviewModal(changeNumber, fileName, downloadUrl) {
        // הצג מודל עם loader
        document.getElementById('cabAttPreviewModal')?.remove();

        const modalHtml = `
<div id="cabAttPreviewModal" style="
    position:fixed; inset:0;
    background:rgba(0,0,0,0.88);
    z-index:999999;
    display:flex; flex-direction:column;
    align-items:center; justify-content:center;
    direction:rtl;
    backdrop-filter:blur(6px);
    padding:16px;
">
    <div style="
        width:100%; max-width:1100px;
        display:flex; align-items:center;
        justify-content:space-between;
        padding:10px 16px;
        background:#1f2937;
        border:1px solid #374151;
        border-radius:12px 12px 0 0;
        border-bottom:none;
        gap:12px; flex-shrink:0;
    ">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
            <span style="font-size:1.3rem;">✉️</span>
            <span style="
                font-size:13px; font-weight:700; color:#f9fafb;
                overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
            ">
                ${this.escHtml(fileName)}
            </span>
        </div>
        <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
            <a href="${downloadUrl}" download="${this.escHtml(fileName)}" style="
                display:inline-flex; align-items:center; gap:6px;
                padding:6px 14px;
                background:rgba(34,197,94,0.15);
                border:1px solid rgba(34,197,94,0.35);
                border-radius:7px; color:#4ade80;
                font-size:12px; font-weight:700;
                text-decoration:none;
            ">
                <i class="fas fa-download"></i> הורד
            </a>
            <button onclick="document.getElementById('cabAttPreviewModal').remove()"
                style="
                    background:rgba(239,68,68,0.15);
                    border:1px solid rgba(239,68,68,0.35);
                    color:#f87171; width:34px; height:34px;
                    border-radius:8px; cursor:pointer; font-size:14px;
                    display:flex; align-items:center; justify-content:center;
                ">
                <i class="fas fa-times"></i>
            </button>
        </div>
    </div>
    <div id="cabEmailPreviewBody" style="
        width:100%; max-width:1100px; flex:1;
        background:#111827; border:1px solid #374151;
        border-radius:0 0 12px 12px; overflow:hidden;
        display:flex; align-items:center; justify-content:center;
        min-height:0; max-height:calc(90vh - 80px);
    ">
        <div style="color:#9ca3af; display:flex; flex-direction:column;
                    align-items:center; gap:12px;">
            <i class="fas fa-spinner fa-spin" style="font-size:2rem;"></i>
            <span>טוען מייל...</span>
        </div>
    </div>
</div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // סגירה ב-Escape
        const onEsc = (e) => {
            if (e.key === 'Escape') {
                document.getElementById('cabAttPreviewModal')?.remove();
                document.removeEventListener('keydown', onEsc);
            }
        };
        document.addEventListener('keydown', onEsc);

        document.getElementById('cabAttPreviewModal')
            ?.addEventListener('click', (e) => {
                if (e.target.id === 'cabAttPreviewModal') {
                    document.getElementById('cabAttPreviewModal')?.remove();
                    document.removeEventListener('keydown', onEsc);
                }
            });

        // *** טען את תוכן המייל מהשרת ***
        try {
            const encodedPath = encodeURIComponent(
                `${changeNumber}/${fileName}`
            );

            // *** קרא ל-endpoint המרת EML ל-HTML ***
            const response = await fetch(
                `/Changes/ConvertEmailToHtml` +
                `?changeNumber=${encodeURIComponent(changeNumber)}` +
                `&fileName=${encodeURIComponent(fileName)}`
            );

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();

            if (!result.success) throw new Error(result.error || 'שגיאה');

            const body = document.getElementById('cabEmailPreviewBody');
            if (!body) return;

            // *** הצג ב-iframe ***
            body.innerHTML = `
        <iframe id="cabEmailIframe"
                style="width:100%; height:100%; border:none;"
                sandbox="allow-same-origin">
        </iframe>`;

            const iframe = document.getElementById('cabEmailIframe');
            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(result.htmlContent);
            doc.close();

        } catch (err) {
            const body = document.getElementById('cabEmailPreviewBody');
            if (body) {
                body.innerHTML = `
            <div style="
                color:#f87171; display:flex; flex-direction:column;
                align-items:center; gap:12px; padding:40px;
                text-align:center;
            ">
                <i class="fas fa-exclamation-triangle"
                   style="font-size:2.5rem;"></i>
                <p style="font-size:1rem;">
                    לא ניתן להציג את המייל
                </p>
                <p style="font-size:0.85rem; color:#6b7280;">
                    ${this.escHtml(err.message)}
                </p>
                <a href="${downloadUrl}"
                   download="${this.escHtml(fileName)}"
                   style="
                       padding:10px 20px;
                       background:#374151; color:#fff;
                       border-radius:8px; text-decoration:none;
                       display:inline-flex; align-items:center; gap:8px;
                   ">
                    <i class="fas fa-download"></i>
                    הורד קובץ במקום
                </a>
            </div>`;
            }
        }
    }

    // -------------------------------------------------------
    // CSS Styles
    // -------------------------------------------------------
    addStyles() {
        if (document.getElementById('cdStyles')) return;
        const style = document.createElement('style');
        style.id = 'cdStyles';
        style.textContent = `
        /* ===== WRAPPER ===== */
        .cd-wrapper {
            background: #121212;
            min-height: calc(100vh - 60px);
            color: #e0e0e0;
            font-family: Arial, sans-serif;
            direction: rtl;
            display: flex;
            flex-direction: column;
        }

        /* ===== HEADER ===== */
        .cd-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #1e1e1e;
            border-bottom: 1px solid #333;
            padding: 10px 16px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .cd-header-right {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .cd-title {
            font-size: 1.2rem;
            font-weight: bold;
            color: #fff;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .cd-title i { color: #a78bfa; }

        /* ===== STATS ===== */
        .cd-stats-bar {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .cd-stat {
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 8px;
            padding: 4px 12px;
            text-align: center;
            min-width: 70px;
        }
        .cd-stat-val {
            display: block;
            font-size: 1.2rem;
            font-weight: bold;
            color: #fff;
        }
        .cd-stat-lbl {
            font-size: 10px;
            color: #888;
        }
        .cd-stat-cab     { border-color: #7c3aed; }
        .cd-stat-cab .cd-stat-val { color: #a78bfa; }
        .cd-stat-risk    { border-color: #f59e0b; }
        .cd-stat-risk .cd-stat-val { color: #fbbf24; }
        .cd-stat-conflict{ border-color: #ef4444; }
        .cd-stat-conflict .cd-stat-val { color: #f87171; }

        /* ===== VIEW BUTTONS ===== */
        .cd-view-btns {
            display: flex;
            gap: 4px;
        }
        
        .cd-view-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 6px 12px;
            background: #2c2c2c;
            color: #aaa;
            border: 1px solid #444;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
        }
        .cd-view-btn:hover {
            background: #3a3a3a;
            color: #fff;
        }
        .cd-view-btn.active {
            background: #320F5B;
            color: #fff;
            border-color: #7c3aed;
        }
        .cd-cab-mode-btn.active {
            background: #1d4ed8;
            border-color: #3b82f6;
        }

        /* ===== FILTER BAR ===== */
        .cd-filter-bar {
            background: #1a1a1a;
            border-bottom: 1px solid #2a2a2a;
            padding: 8px 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .cd-filter-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .cd-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .cd-search-wrap > i {
            position: absolute;
            right: 10px;
            color: #666;
            font-size: 13px;
            pointer-events: none;
        }
        .cd-search-input {
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 32px 6px 30px;
            font-size: 13px;
            width: 220px;
            direction: rtl;
        }
        .cd-search-input:focus {
            outline: none;
            border-color: #7c3aed;
        }
        .cd-clear-search {
            position: absolute;
            left: 8px;
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            display: flex;
            align-items: center;
            padding: 0;
        }
        .cd-clear-search:hover { color: #fff; }
        .cd-filter-select {
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 5px 8px;
            font-size: 12px;
            cursor: pointer;
            max-width: 150px;
        }
        .cd-filter-select:focus {
            outline: none;
            border-color: #7c3aed;
        }
        .cd-toggle-label {
            display: flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
            font-size: 13px;
            color: #aaa;
            white-space: nowrap;
        }
        .cd-toggle-label input { cursor: pointer; }
        .cd-toggle-label:hover { color: #fff; }
        .cd-clear-filters-btn {
            padding: 5px 10px;
            background: #2c2c2c;
            border: 1px solid #555;
            border-radius: 6px;
            color: #aaa;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
        }
        .cd-clear-filters-btn:hover {
            background: #3a3a3a;
            color: #fff;
        }
        .cd-filter-label {
            color: #888;
            font-size: 12px;
            white-space: nowrap;
        }
        .cd-date-input {
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 5px 8px;
            font-size: 12px;
            width: 90px;
            text-align: center;
            letter-spacing: 0.5px;
        }
        .cd-date-input::placeholder {
            color: #555;
            font-size: 11px;
        }
        .cd-date-input:focus {
            outline: none;
            border-color: #7c3aed;
        }
        .cd-date-sep { color: #666; }
        /* ===== מצב רגיל - לא נבחר ===== */
        .cd-cab-range-btn {
            padding: 5px 12px;
            background: #2c2c2c;        /* אפור כמו שאר הכפתורים */
            border: 1px solid #444;
            border-radius: 6px;
            color: #aaa;                /* טקסט אפור */
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
        }

        .cd-cab-range-btn:hover {
            background: #3a3a3a;
            color: #fff;
            border-color: #666;
        }

        /* ===== מצב נבחר - סגול ===== */
        .cd-cab-range-btn.active {
            background: #320F5B;
            border-color: #7c3aed;
            color: #fff;
        }

        .cd-cab-range-btn.active:hover {
            background: #4a1a8c;
        }
        .cd-active-filters {
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(124,58,237,0.15);
            border: 1px solid rgba(124,58,237,0.3);
            border-radius: 6px;
            padding: 3px 10px;
            font-size: 12px;
            color: #a78bfa;
        }

        /* ===== CONTENT ===== */
        .cd-content {
            flex: 1;
            overflow: auto;
            padding: 12px;
        }
        .cd-loading, .cd-error {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 60px 20px;
            color: #666;
            font-size: 16px;
        }
        .cd-error { color: #f87171; }
        .cd-loading i { font-size: 2rem; color: #7c3aed; }

        /* ===== CALENDAR ===== */
        .cd-calendar { width: 100%; }
        .cd-cal-nav {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            direction: ltr;
        }
        .cd-cal-title {
            font-size: 1.1rem;
            font-weight: bold;
            color: #fff;
            margin: 0;
            flex: 1;
            text-align: center;
        }
        .cd-cal-count {
            font-size: 0.8rem;
            color: #888;
            font-weight: normal;
        }
        .cd-cal-nav-btn, .cd-today-btn {
            padding: 5px 10px;
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 5px;
            color: #e0e0e0;
            cursor: pointer;
            transition: all 0.2s;
        }
        .cd-cal-nav-btn:hover, .cd-today-btn:hover {
            background: #3a3a3a;
        }
        .cd-cal-grid { width: 100%; }
        .cd-cal-weekdays {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
            margin-bottom: 2px;
        }
        .cd-cal-weekdays > div {
            text-align: center;
            font-size: 12px;
            color: #888;
            padding: 4px;
            background: #1e1e1e;
            border-radius: 4px;
        }
        .cd-cal-days {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
        }
        .cd-cal-day {
            background: #1e1e1e;
            border: 1px solid #2a2a2a;
            border-radius: 6px;
            height: 130px;
            min-height: unset;
            padding: 4px;
            transition: border-color 0.2s;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .cd-cal-empty { background: #161616; border-color: #1e1e1e; }
        .cd-cal-day.cd-today {
            border-color: #7c3aed;
            background: #1a1030;
        }
        .cd-cal-day.cd-has-changes { border-color: #374151;}
        .cd-cal-day.cd-has-conflict { border-color: #ef4444 !important; }
        .cd-day-num {
            font-size: 12px;
            font-weight: bold;
            color: #aaa;
            margin-bottom: 3px;
            display: flex;
            align-items: center;
            flex-shrink: 0;
            gap: 3px;
        }
        .cd-today .cd-day-num { color: #a78bfa; }
        .cd-risk-icon    { color: #f59e0b; font-size: 10px; }
        .cd-conflict-icon{ color: #ef4444; font-size: 10px; }
        .cd-day-changes {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;                /* תופס את כל המקום הנותר */
            overflow: hidden;       /* חותך תוכן עודף */
            min-height: 0;
        }
        .cd-day-change:hover { background: #3a3a3a; }
        .cd-day-change.cd-chg-conflict {
            background: #2a0a0a;
            border-right: 2px solid #ef4444;
        }
        .cd-day-changes {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            overflow: hidden;
            min-height: 0;
        }

        /* מספר שינויים - כל אחד שורה אחת */
        .cd-day-change {
            background: #2b2f36;
            border-radius: 3px;
            padding: 2px 5px;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            gap: 4px;
            align-items: flex-start;
            transition: background 0.15s;
            overflow: hidden;
            flex: 1;                    /* חלוקה שווה של הגובה */
            min-height: 0;
        }

        .cd-day-change:hover { background: #3a3a3a; }
        .cd-day-change.cd-chg-risk    { border-right: 2px solid #f59e0b; }
        .cd-day-change.cd-chg-conflict { background: #2a0a0a; border-right: 2px solid #ef4444; }


        .cd-chg-num {
            color: #a78bfa;
            font-weight: bold;
            white-space: nowrap;
            font-size: 10px;
            flex-shrink: 0;
        }

        /* שם - שורה אחת כשיש כמה שינויים */
        .cd-chg-name {
            color: #ccc;
            overflow: hidden;
            text-overflow: ellipsis;
            overflow-wrap: break-word;
            word-break: break-word;
            font-size: 11px;
            flex: 1;
            min-width: 0;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            overflow: hidden;
            -webkit-line-clamp: 2;
        }
        .cd-day-more {
            font-size: 10px;
            color: #7c3aed;
            cursor: pointer;
            padding: 1px 4px;
            text-align: center;
            background: #2b2f36;
            flex-shrink: 0;
            margin-top: auto;       /* דחוף לתחתית */
        }
        
        /* שינוי אחד - תופס הכל, טקסט יכול לגלוש */
        .cd-day-changes--single .cd-day-change {
            flex: 1;
            max-height: unset;
            flex-wrap: wrap;
        }

        .cd-day-changes--single .cd-chg-name {
            white-space: normal;        /* גלישת טקסט */
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 4;      /* מקסימום 4 שורות */
            -webkit-box-orient: vertical;
            line-height: 1.4;
        }

        /* 2 שינויים - עד 2 שורות כל אחד */
        .cd-day-changes--two .cd-chg-name {
            -webkit-line-clamp: 2;
        }

        /* 3 שינויים - שורה וחצי כל אחד */
        .cd-day-changes--three .cd-chg-name {
            -webkit-line-clamp: 1;
        }

        /* 4+ שינויים - שורה אחת */
        .cd-day-changes--many .cd-chg-name {
            -webkit-line-clamp: 1;
        }

        /* max-height מותאם לפי כמות */
        .cd-day-changes--two .cd-day-change {
            max-height: 48px;       /* מספיק ל-2 שורות */
        }

        .cd-day-changes--three .cd-day-change {
            max-height: 36px;
        }

        .cd-day-changes--many .cd-day-change {
            max-height: 26px;
        }
        .cd-day-more:hover { color: #a78bfa; }

        /* ===== WEEK VIEW ===== */
        .cd-week-view { width: 100%; }
        .cd-week-nav {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            direction: ltr;
        }
        .cd-week-title {
            flex: 1;
            text-align: center;
            font-weight: bold;
            color: #fff;
        }
        .cd-week-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 4px;
        }
        .cd-week-col {
            background: #1e1e1e;
            border: 1px solid #2a2a2a;
            border-radius: 8px;
            min-height: 200px;
            display: flex;
            flex-direction: column;
        }
        .cd-week-col.cd-today { border-color: #7c3aed; }
        .cd-week-col.cd-has-conflict { border-color: #ef4444; }
        .cd-week-col-header {
            background: #252525;
            border-radius: 8px 8px 0 0;
            padding: 6px 8px;
            display: flex;
            align-items: center;
            gap: 4px;
            border-bottom: 1px solid #333;
        }
        .cd-week-dow {
            font-weight: bold;
            color: #aaa;
            font-size: 12px;
        }
        .cd-week-date { color: #666; font-size: 11px; }
        .cd-week-count {
            margin-right: auto;
            background: #7c3aed;
            color: #fff;
            border-radius: 10px;
            padding: 1px 6px;
            font-size: 10px;
        }
        .cd-week-changes {
            padding: 4px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            flex: 1;
        }
        .cd-week-change {
            background: #2b2f36;
            border-radius: 4px;
            padding: 4px 6px;
            font-size: 11px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 2px;
            transition: background 0.15s;
        }
        .cd-week-change:hover { background: #3a3a3a; }
        .cd-week-change.cd-chg-risk {
            border-right: 2px solid #f59e0b;
        }
        .cd-week-change.cd-chg-conflict {
            border-right: 2px solid #ef4444;
            background: #2a0a0a;
        }
        .cd-chg-time { color: #888; font-size: 10px; }
        .cd-week-empty {
            color: #444;
            font-size: 11px;
            text-align: center;
            padding: 20px 8px;
        }

        /* ===== DAY VIEW ===== */
        .cd-day-view { width: 100%; }
        .cd-day-nav {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            direction: ltr;
        }
        .cd-day-title {
            flex: 1;
            text-align: center;
            font-size: 1.1rem;
            font-weight: bold;
            color: #fff;
            margin: 0;
        }
        .cd-today-title { color: #a78bfa; }
        .cd-today-badge {
            background: #7c3aed;
            color: #fff;
            border-radius: 10px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: normal;
            margin-right: 8px;
        }
        .cd-day-count {
            color: #888;
            font-size: 13px;
            margin-bottom: 10px;
        }
        .cd-day-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .cd-day-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 60px 20px;
            color: #444;
            font-size: 16px;
        }
        .cd-day-empty i { font-size: 3rem; }
        .cd-day-card {
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 12px 16px;
            cursor: pointer;
            transition: all 0.2s;
        }
        .cd-day-card:hover {
            background: #252525;
            border-color: #555;
        }
        .cd-day-card.cd-card-risk {
            border-right: 3px solid #f59e0b;
        }
        .cd-day-card.cd-card-conflict {
            border-right: 3px solid #ef4444;
        }
        .cd-day-card-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        }
        .cd-day-card-num {
            font-weight: bold;
            color: #a78bfa;
            font-size: 14px;
        }
        .cd-day-card-name {
            font-size: 14px;
            color: #e0e0e0;
            margin-bottom: 6px;
        }
        .cd-day-card-meta {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            font-size: 12px;
            color: #888;
        }
        .cd-day-card-meta span {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        /* ===== TABLE VIEW ===== */
        .cd-table-view { width: 100%; }
        .cd-table-info {
            color: #888;
            font-size: 13px;
            margin-bottom: 8px;
        }
        .cd-table-wrap {
            overflow-x: auto;
            border-radius: 8px;
            border: 1px solid #333;
        }
        .cd-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        .cd-table thead th {
            background: #252525;
            color: #aaa;
            padding: 10px 12px;
            text-align: right;
            border-bottom: 2px solid #333;
            white-space: nowrap;
        }
        .cd-table-row {
            cursor: pointer;
            transition: background 0.15s;
        }
        .cd-table-row:hover td { background: #252525; }
        .cd-table-row td {
            padding: 8px 12px;
            border-bottom: 1px solid #2a2a2a;
            color: #ccc;
            vertical-align: middle;
        }
        .cd-table-row.cd-row-conflict td {
            border-right: 2px solid #ef4444;
        }
        .cd-td-name { max-width: 280px; }

        /* ===== STATUS BADGES ===== */
        .cd-status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap;
        }
                .cd-status-green  { background: #14532d; color: #4ade80; }
        .cd-status-red    { background: #450a0a; color: #f87171; }
        .cd-status-yellow { background: #451a03; color: #fbbf24; }
        .cd-status-default{ background: #1e1e2e; color: #94a3b8; }

        /* ===== RISK / CONFLICT BADGES ===== */
        .cd-risk-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #451a03;
            color: #fbbf24;
            border: 1px solid #92400e;
            border-radius: 10px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap;
        }
        .cd-conflict-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #450a0a;
            color: #f87171;
            border: 1px solid #7f1d1d;
            border-radius: 10px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap;
        }
        .cd-cab-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: #1e1b4b;
            color: #a78bfa;
            border: 1px solid #4c1d95;
            border-radius: 10px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: bold;
            white-space: nowrap;
        }
        .cd-risk-badge-sm {
            color: #fbbf24;
            font-size: 13px;
        }
        .cd-conflict-badge-sm {
            color: #f87171;
            font-size: 13px;
        }

        /* ===== POPUP ===== */
        .cd-popup-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.7);
            z-index: 10000;
        }
        .cd-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 12px;
            width: 90%;
            max-width: 1800px;
            max-height: 85vh;
            z-index: 10001;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            animation: cdPopupIn 0.2s ease;
        }
        @keyframes cdPopupIn {
            from { opacity: 0; transform: translate(-50%,-48%); }
            to   { opacity: 1; transform: translate(-50%,-50%); }
        }
        .cd-popup-header {
            background: #252525;
            padding: 14px 16px;
            border-bottom: 1px solid #333;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            flex-wrap: wrap;
        }
        .cd-popup-title {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .cd-popup-num {
            font-size: 1rem;
            font-weight: bold;
            color: #a78bfa;
        }
        .cd-popup-name {
            font-size: 1rem;
            color: #fff;
            font-weight: bold;
        }
        .cd-popup-badges {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            align-items: center;
        }
        .cd-popup-close {
            background: none;
            border: none;
            color: #888;
            font-size: 18px;
            cursor: pointer;
            padding: 2px 6px;
            border-radius: 4px;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .cd-popup-close:hover {
            background: #333;
            color: #fff;
        }
        .cd-popup-body {
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .cd-popup-section h4 {
            color: #a78bfa;
            font-size: 13px;
            margin: 0 0 10px 0;
            display: flex;
            align-items: center;
            gap: 6px;
            border-bottom: 1px solid #2a2a2a;
            padding-bottom: 6px;
        }
        .cd-popup-fields {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 8px;
        }
        .cd-popup-field {
            background: #252525;
            border-radius: 6px;
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .cd-popup-label {
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .cd-popup-val {
            font-size: 13px;
            color: #e0e0e0;
            word-break: break-word;
        }
        .cd-popup-risk-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 6px;
        }

        /* ===== CAB RISK GRID ===== */
        .cd-cab-risk-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 6px;
        }
        .cd-cab-risk-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            border-radius: 6px;
            font-size: 12px;
        }
        .cd-risk-yes {
            background: #2a1e0a;
            border: 1px solid #92400e;
            color: #fbbf24;
        }
        .cd-risk-yes i { color: #f59e0b; }
        .cd-risk-no {
            background: #0a2a0a;
            border: 1px solid #14532d;
            color: #4ade80;
        }
        .cd-risk-no i { color: #22c55e; }
        .cd-risk-val {
            margin-right: auto;
            font-weight: bold;
            font-size: 11px;
        }

        /* ===== CAB VIEW ===== */
        .cd-cab-view {
            display: flex;
            flex-direction: column;
            gap: 0;
            height: 100%;
        }
        /* ===== CAB VIEW ===== */
        .cd-cab-view-header {
            background: #1a1030;
            border: 1px solid #4c1d95;
            border-radius: 10px;
            padding: 16px 20px;
            margin-bottom: 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .cd-cab-view-top-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }

        .cd-cab-view-num {
            font-size: 1rem;
            font-weight: bold;
            color: #a78bfa;
            flex-shrink: 0;
        }

        .cd-cab-view-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            justify-content: flex-end;
            margin-right: auto;
            padding-right: 12px;
        }
        .cd-cab-view-num {
            font-size: 1rem;
            font-weight: bold;
            color: #a78bfa;
        }
        .cd-cab-view-title {
            font-size: 1.1rem;
            font-weight: bold;
            color: #fff;
            flex: 1;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            padding: 0 12px;
        }
        .cd-cab-view-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        .cd-cab-view-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
            flex: 1;
        }
        .cd-cab-section {
            background: #1e1e1e;
            border: 1px solid #2a2a2a;
            border-radius: 8px;
            padding: 14px 16px;
        }
        .cd-cab-section-title {
            color: #a78bfa;
            font-size: 13px;
            margin: 0 0 12px 0;
            display: flex;
            align-items: center;
            gap: 6px;
            border-bottom: 1px solid #2a2a2a;
            padding-bottom: 8px;
        }
        .cd-cab-fields {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 8px;
        }
        .cd-cab-field {
            background: #252525;
            border-radius: 6px;
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .cd-cab-field-label {
            font-size: 10px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .cd-cab-field-val {
            font-size: 13px;
            color: #e0e0e0;
            word-break: break-word;
        }
        .cd-cab-view-footer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 12px 0 0 0;
            border-top: 1px solid #2a2a2a;
            margin-top: 12px;
        }
        .cd-cab-prev-btn,
        .cd-cab-next-btn {
            padding: 8px 20px;
            background: #320F5B;
            border: 1px solid #7c3aed;
            border-radius: 6px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .cd-cab-prev-btn:hover,
        .cd-cab-next-btn:hover { background: #4a1a8c; }
        .cd-cab-progress {
            color: #888;
            font-size: 14px;
            min-width: 60px;
            text-align: center;
        }
        .cd-cab-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 60px 20px;
            color: #444;
            font-size: 16px;
        }
        .cd-cab-empty i { font-size: 3rem; }

        /* ===== CAB PANEL (תחתון) ===== */
        .cd-cab-panel {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: #1a1030;
            border-top: 2px solid #7c3aed;
            z-index: 9000;
            padding: 8px 16px;
        }
        .cd-cab-panel-inner {
            display: flex;
            align-items: center;
            gap: 16px;
            max-width: 1200px;
            margin: 0 auto;
            flex-wrap: wrap;
        }
        .cd-cab-nav-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .cd-cab-nav-btn {
            padding: 5px 10px;
            background: #320F5B;
            border: 1px solid #7c3aed;
            border-radius: 5px;
            color: #fff;
            cursor: pointer;
            transition: all 0.2s;
        }
        .cd-cab-nav-btn:hover { background: #4a1a8c; }
        .cd-cab-counter {
            color: #a78bfa;
            font-weight: bold;
            font-size: 14px;
            min-width: 50px;
            text-align: center;
        }
        .cd-cab-info {
            flex: 1;
            display: flex;
            gap: 10px;
            align-items: center;
            overflow: hidden;
        }
        .cd-cab-num {
            color: #a78bfa;
            font-weight: bold;
            white-space: nowrap;
        }
        .cd-cab-name-lbl {
            color: #ccc;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .cd-cab-exit-btn {
            padding: 6px 14px;
            background: rgba(239,68,68,0.2);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 6px;
            color: #f87171;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .cd-cab-exit-btn:hover {
            background: rgba(239,68,68,0.35);
        }

        /* ===== LINK ===== */
        .cd-link {
            color: #60a5fa;
            text-decoration: none;
        }
        .cd-link:hover {
            color: #93c5fd;
            text-decoration: underline;
        }

        /* ===== LIGHT MODE ===== */
        [data-theme="light"] .cd-wrapper {
            background: #f0f2f5;
            color: #1a1a2e;
        }
        [data-theme="light"] .cd-header {
            background: #fff;
            border-bottom: 1px solid #ddd;
        }
        [data-theme="light"] .cd-title { color: #1a1a2e; }
        [data-theme="light"] .cd-stat {
            background: #f5f5f5;
            border: 1px solid #ddd;
        }
        [data-theme="light"] .cd-stat-val { color: #1a1a2e; }
        [data-theme="light"] .cd-view-btn {
            background: #fff;
            color: #555;
            border: 1px solid #ccc;
        }
        [data-theme="light"] .cd-view-btn.active {
            background: #4a1a8c;
            color: #fff;
            border-color: #6a2aac;
        }
        [data-theme="light"] .cd-filter-bar {
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
        }
        [data-theme="light"] .cd-search-input,
        [data-theme="light"] .cd-filter-select,
        [data-theme="light"] .cd-date-input {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }
        [data-theme="light"] .cd-cal-day {
            background: #fff;
            border: 1px solid #e0e0e0;
        }
        [data-theme="light"] .cd-cal-day.cd-today {
            background: #f0e8ff;
            border-color: #7c3aed;
        }
        [data-theme="light"] .cd-day-change {
            background: #f0f0f8;
        }
        [data-theme="light"] .cd-day-change:hover {
            background: #e0e0f0;
        }
        [data-theme="light"] .cd-week-col {
            background: #fff;
            border: 1px solid #e0e0e0;
        }
        [data-theme="light"] .cd-week-col-header {
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
        }
        [data-theme="light"] .cd-week-change {
            background: #f0f0f8;
        }
        [data-theme="light"] .cd-day-card {
            background: #fff;
            border: 1px solid #e0e0e0;
        }
        [data-theme="light"] .cd-day-card:hover {
            background: #f5f5f5;
        }
        [data-theme="light"] .cd-table thead th {
            background: #e8e8f0;
            color: #444;
            border-bottom: 2px solid #ccc;
        }
        [data-theme="light"] .cd-table-row td {
            border-bottom: 1px solid #eee;
            color: #333;
        }
        [data-theme="light"] .cd-table-row:hover td {
            background: #f0f0f8;
        }
        [data-theme="light"] .cd-popup {
            background: #fff;
            border: 1px solid #ccc;
        }
        [data-theme="light"] .cd-popup-header {
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
        }
        [data-theme="light"] .cd-popup-field {
            background: #f0f0f8;
        }
        [data-theme="light"] .cd-popup-val { color: #1a1a2e; }
        [data-theme="light"] .cd-cab-section {
            background: #fff;
            border: 1px solid #e0e0e0;
        }
        [data-theme="light"] .cd-cab-field {
            background: #f0f0f8;
        }
        [data-theme="light"] .cd-cab-field-val { color: #1a1a2e; }
        [data-theme="light"] .cd-cab-view-header {
            background: #f0e8ff;
            border: 1px solid #c4b5fd;
        }

        /* ===== FIELD TOGGLE ===== */
        .cd-field-toggle-btn {
            display: inline-block;
            margin-right: 6px;
            padding: 1px 8px;
            background: rgba(124,58,237,0.2);
            border: 1px solid rgba(124,58,237,0.4);
            border-radius: 10px;
            color: #a78bfa;
            font-size: 10px;
            cursor: pointer;
            transition: all 0.2s;
            vertical-align: middle;
        }
        .cd-field-toggle-btn:hover {
            background: rgba(124,58,237,0.4);
            color: #fff;
        }
        /* ===== CAB FOOTER THUMBNAILS ===== */
        .cd-cab-view-footer {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 12px 0 0 0;
            border-top: 1px solid #2a2a2a;
            margin-top: 12px;
            min-height: 90px;
        }

        .cd-cab-thumbs-wrap {
            flex: 1;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-behavior: smooth;
            scrollbar-width: thin;
            scrollbar-color: #4c1d95 #1a1a1a;
            padding-bottom: 4px;
            display: flex;
            justify-content: center;
        }

        .cd-cab-thumbs-wrap::-webkit-scrollbar {
            height: 4px;
        }
        .cd-cab-thumbs-wrap::-webkit-scrollbar-track {
            background: #1a1a1a;
            border-radius: 2px;
        }
        .cd-cab-thumbs-wrap::-webkit-scrollbar-thumb {
            background: #4c1d95;
            border-radius: 2px;
        }

        .cd-cab-thumbs {
            display: flex;
            gap: 6px;
            padding: 4px 2px;
            flex-wrap: nowrap;
            width: max-content;
            margin: 0 auto;
        }

        .cd-cab-thumb {
            position: relative;
            background: #252525;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 8px 10px;
            cursor: pointer;
            transition: all 0.2s;
            min-width: 140px;
            max-width: 160px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            flex-shrink: 0;
            user-select: none;
        }

        .cd-cab-thumb:hover {
            background: #2e2e2e;
            border-color: #555;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        }

        /* קוביה פעילה */
        .cd-cab-thumb-active {
            background: #1a1030 !important;
            border-color: #7c3aed !important;
            border-width: 2px;
            box-shadow: 0 0 12px rgba(124,58,237,0.4);
        }

        /* קוביה עם סיכון */
        .cd-cab-thumb-risk {
            border-right: 3px solid #f59e0b;
        }

        /* קוביה עם התנגשות */
        .cd-cab-thumb-conflict {
            border-right: 3px solid #ef4444;
        }

        .cd-cab-thumb-num {
            font-size: 11px;
            font-weight: bold;
            color: #a78bfa;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cd-cab-thumb-active .cd-cab-thumb-num {
            color: #c4b5fd;
        }

        .cd-cab-thumb-name {
            font-size: 11px;
            color: #ccc;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.3;
        }

        .cd-cab-thumb-date {
            font-size: 10px;
            color: #666;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cd-cab-thumb-active .cd-cab-thumb-date {
            color: #888;
        }

        /* אייקוני סיכון/התנגשות על הקוביה */
        .cd-cab-thumb-icon-risk {
            position: absolute;
            top: 5px;
            left: 6px;
            color: #f59e0b;
            font-size: 9px;
        }

        .cd-cab-thumb-icon-conflict {
            position: absolute;
            top: 5px;
            left: 18px;
            color: #ef4444;
            font-size: 9px;
        }

        /* כפתורי ניווט - disabled state */
        .cd-cab-prev-btn:disabled,
        .cd-cab-next-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
            pointer-events: none;
        }

        /* Light mode */
        [data-theme="light"] .cd-cab-thumb {
            background: #f5f5f5;
            border: 1px solid #ddd;
        }
        [data-theme="light"] .cd-cab-thumb:hover {
            background: #ece8f8;
            border-color: #9c6fdc;
        }
        [data-theme="light"] .cd-cab-thumb-active {
            background: #ede9fe !important;
            border-color: #7c3aed !important;
        }
        [data-theme="light"] .cd-cab-thumb-name {
            color: #333;
        }
        [data-theme="light"] .cd-cab-thumb-date {
            color: #888;
        }
        [data-theme="light"] .cd-cab-thumbs-wrap {
            scrollbar-color: #9c6fdc #e0e0e0;
        }
        /* ===== DATE PICKER WRAP ===== */
        .cd-date-wrap {
            position: relative;
            display: inline-flex;
            align-items: center;
        }

        .cd-date-input {
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 5px 8px;
            font-size: 12px;
            width: 90px;
            text-align: center;
            letter-spacing: 0.5px;
            cursor: pointer;
        }

        .cd-date-input:hover {
            border-color: #7c3aed;
        }

        .cd-date-input::placeholder {
            color: #555;
            font-size: 11px;
        }

        /* הפיקר הנסתר - מוסתר מאחורי שדה התצוגה */
        .cd-date-hidden {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            pointer-events: none;
            border: none;
            padding: 0;
        }

        /* Light mode */
        [data-theme="light"] .cd-date-input {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }
        [data-theme="light"] .cd-date-input:hover {
            border-color: #7c3aed;
        }
        /* ===================================
        CAB PAGE - עיצוב חדש
        =================================== */

        .cd-cab-page {
            display: flex;
            flex-direction: column;
            gap: 0;
            background: #f0f4f8;
            min-height: 100%;
            direction: rtl;
            font-family: 'Heebo', Arial, sans-serif;
            color: #1a2332;
        }

        /* --- HEADER --- */
        .cd-cab-page-header {
            background: linear-gradient(
                135deg, #1a3a6b 0%, #2a5298 60%, #3a6fd8 100%);
            padding: 0;
            position: relative;
            overflow: hidden;
            border-radius: 12px 12px 0 0;
            margin-bottom: 0;
        }

        .cd-cab-page-header::before {
            content: '';
            position: absolute;
            top: -60px; left: -60px;
            width: 300px; height: 300px;
            background: rgba(255,255,255,0.04);
            border-radius: 50%;
            pointer-events: none;
        }

        .cd-cab-page-header-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 28px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.12);
            flex-wrap: wrap;
            gap: 10px;
        }

        .cd-cab-logo-area {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .cd-cab-logo-icon {
            width: 44px; height: 44px;
            background: linear-gradient(135deg, #e8a020, #f5c842);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            box-shadow: 0 4px 14px rgba(232,160,32,0.4);
            flex-shrink: 0;
        }

        .cd-cab-logo-title {
            font-size: 17px;
            font-weight: 800;
            color: #fff;
            letter-spacing: 0.5px;
        }

        .cd-cab-logo-sub {
            font-size: 11px;
            color: rgba(255,255,255,0.7);
            font-weight: 400;
        }

        .cd-cab-header-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .cd-cab-meta-badge {
            background: rgba(255,255,255,0.12);
            border: 1px solid rgba(255,255,255,0.2);
            color: #fff;
            padding: 5px 12px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 500;
        }

        .cd-cab-meta-counter {
            background: rgba(232,160,32,0.25);
            border-color: rgba(232,160,32,0.5);
            color: #fde68a;
            font-weight: 700;
        }

        .cd-cab-page-header-main {
            padding: 20px 28px 24px;
            position: relative;
            z-index: 1;
        }

        .cd-cab-crq-number {
            font-size: 12px;
            color: rgba(255,255,255,0.6);
            font-weight: 500;
            letter-spacing: 1px;
            margin-bottom: 5px;
            text-transform: uppercase;
        }

        .cd-cab-crq-title {
            font-size: 24px;
            font-weight: 800;
            color: #fff;
            margin-bottom: 14px;
            line-height: 1.3;
        }

        .cd-cab-header-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            align-items: center;
        }

        .cd-cab-hbadge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 16px;
            font-size: 12px;
            font-weight: 600;
        }

        .cd-cab-badge-dot {
            width: 7px; height: 7px;
            border-radius: 50%;
            background: currentColor;
            animation: cdPulse 2s infinite;
        }

        @keyframes cdPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50%       { opacity: 0.6; transform: scale(0.85); }
        }

        .cd-cab-hbadge-status {
            background: rgba(232,160,32,0.2);
            border: 1.5px solid rgba(232,160,32,0.5);
            color: #fde68a;
        }

        .cd-cab-hbadge-normal {
            background: rgba(255,255,255,0.12);
            border: 1.5px solid rgba(255,255,255,0.25);
            color: rgba(255,255,255,0.9);
        }

        .cd-cab-hbadge-risk {
            background: rgba(245,158,11,0.2);
            border: 1.5px solid rgba(245,158,11,0.5);
            color: #fde68a;
        }

        .cd-cab-hbadge-conflict {
            background: rgba(239,68,68,0.2);
            border: 1.5px solid rgba(239,68,68,0.5);
            color: #fca5a5;
        }

        .cd-cab-hbadge-cab {
            background: rgba(139,92,246,0.2);
            border: 1.5px solid rgba(139,92,246,0.5);
            color: #c4b5fd;
        }

        /* --- METRICS --- */
        .cd-cab-metrics {
            display: flex;
            gap: 12px;
            padding: 16px 20px;
            background: #fff;
            border-bottom: 1px solid #e2e8f0;
            flex-wrap: wrap;
        }

        .cd-cab-metric {
            flex: 1;
            min-width: 140px;
            background: #fff;
            border-radius: 12px;
            padding: 16px 18px;
            box-shadow: 0 4px 24px rgba(26,58,107,0.08);
            border: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            gap: 14px;
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }

        .cd-cab-metric::before {
            content: '';
            position: absolute;
            top: 0; right: 0;
            width: 4px;
            height: 100%;
            border-radius: 0 12px 12px 0;
        }

        .cd-cab-metric:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 32px rgba(26,58,107,0.14);
        }

        .cd-cab-metric-blue::before   { background: #2a5298; }
        .cd-cab-metric-green::before  { background: #27ae60; }
        .cd-cab-metric-orange::before { background: #e8a020; }
        .cd-cab-metric-purple::before { background: #8b5cf6; }
        .cd-cab-metric-teal::before   { background: #0891b2; }

        .cd-cab-metric-icon {
            font-size: 24px;
            flex-shrink: 0;
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .cd-cab-metric-blue   .cd-cab-metric-icon { background: rgba(42,82,152,0.08); }
        .cd-cab-metric-green  .cd-cab-metric-icon { background: rgba(39,174,96,0.08); }
        .cd-cab-metric-orange .cd-cab-metric-icon { background: rgba(232,160,32,0.08); }
        .cd-cab-metric-purple .cd-cab-metric-icon { background: rgba(139,92,246,0.08); }
        .cd-cab-metric-teal   .cd-cab-metric-icon { background: rgba(8,145,178,0.08); }

        .cd-cab-metric-label {
            font-size: 11px;
            font-weight: 600;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .cd-cab-metric-value {
            font-size: 14px;
            font-weight: 700;
            color: #1a2332;
            line-height: 1.2;
        }

        /* --- MAIN GRID --- */
        .cd-cab-main-grid {
            display: grid;
            grid-template-columns: 340px 1fr;
            gap: 16px;
            padding: 16px 20px;
            background: #f0f4f8;
            flex: 1;
        }

        .cd-cab-col-left,
        .cd-cab-col-right {
            display: flex;
            flex-direction: column;
        }

        /* --- CARDS --- */
        .cd-cab-card {
            background: #fff;
            border-radius: 14px;
            box-shadow: 0 4px 24px rgba(26,58,107,0.08);
            border: 1px solid #e2e8f0;
            overflow: hidden;
            transition: box-shadow 0.3s ease;
        }

        .cd-cab-card:hover {
            box-shadow: 0 8px 32px rgba(26,58,107,0.14);
        }

        .cd-cab-card-header {
            padding: 14px 20px 12px;
            border-bottom: 1px solid #f0f4f8;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .cd-cab-card-icon {
            width: 34px;
            height: 34px;
            border-radius: 9px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 17px;
            flex-shrink: 0;
        }

        .cd-cab-card-header h3 {
            font-size: 14px;
            font-weight: 700;
            color: #1a2332;
            margin: 0;
        }

        .cd-cab-card-body {
            padding: 16px 20px;
        }

        /* --- INFO ROWS --- */
        .cd-cab-info-row {
            display: flex;
            align-items: flex-start;
            padding: 9px 0;
            border-bottom: 1px solid #f7f8fa;
            gap: 10px;
        }

        .cd-cab-info-row:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .cd-cab-info-row:first-child {
            padding-top: 0;
        }

        .cd-cab-info-label {
            font-size: 12px;
            font-weight: 600;
            color: #718096;
            min-width: 120px;
            flex-shrink: 0;
            padding-top: 1px;
        }

        .cd-cab-info-value {
            font-size: 13px;
            font-weight: 500;
            color: #1a2332;
            flex: 1;
            line-height: 1.5;
            word-break: break-word;
        }

        /* --- TEAM MEMBERS --- */
        .cd-cab-team-member {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 0;
            border-bottom: 1px solid #f7f8fa;
        }

        .cd-cab-team-member:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        .cd-cab-team-member:first-child {
            padding-top: 0;
        }

        .cd-cab-avatar {
            width: 38px;
            height: 38px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            font-weight: 700;
            color: #fff;
            flex-shrink: 0;
        }

        .cd-cab-avatar-blue   {
            background: linear-gradient(135deg, #1a3a6b, #2a5298);
        }
        .cd-cab-avatar-orange {
            background: linear-gradient(135deg, #e8a020, #f5c842);
        }
        .cd-cab-avatar-green  {
            background: linear-gradient(135deg, #27ae60, #2ecc71);
        }
        .cd-cab-avatar-purple {
            background: linear-gradient(135deg, #7c3aed, #8b5cf6);
        }
        .cd-cab-avatar-teal   {
            background: linear-gradient(135deg, #0891b2, #06b6d4);
        }
        .cd-cab-avatar-gray   {
            background: linear-gradient(135deg, #4a5568, #718096);
        }

        .cd-cab-team-name {
            font-size: 13px;
            font-weight: 700;
            color: #1a2332;
        }

        .cd-cab-team-role {
            font-size: 11px;
            color: #718096;
            font-weight: 500;
            margin-top: 2px;
        }

        /* --- SCHEDULE --- */
        .cd-cab-schedule {
            display: flex;
            gap: 10px;
            align-items: stretch;
        }

        .cd-cab-schedule-item {
            flex: 1;
            background: linear-gradient(135deg, #f8faff, #eef2ff);
            border: 1px solid #dde8ff;
            border-radius: 10px;
            padding: 12px 14px;
            text-align: center;
        }

        .cd-cab-schedule-label {
            font-size: 11px;
            font-weight: 700;
            color: #2a5298;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }

        .cd-cab-schedule-value {
            font-size: 15px;
            font-weight: 800;
            color: #1a3a6b;
            line-height: 1.3;
        }

        .cd-cab-schedule-arrow {
            display: flex;
            align-items: center;
            color: #718096;
            font-size: 20px;
            padding: 0 4px;
        }

        /* --- DESCRIPTION BLOCKS --- */
        .cd-cab-desc-block {
            background: linear-gradient(135deg, #f8faff, #f0f4ff);
            border: 1px solid #dde8ff;
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 10px;
        }

        .cd-cab-desc-block:last-child {
            margin-bottom: 0;
        }

        .cd-cab-desc-block.cd-cab-desc-warning {
            background: linear-gradient(135deg, #fffbeb, #fef3c7);
            border-color: #fcd34d;
        }

        .cd-cab-desc-block.cd-cab-desc-success {
            background: linear-gradient(135deg, #f0fff4, #dcfce7);
            border-color: #86efac;
        }

        .cd-cab-desc-block.cd-cab-desc-danger {
            background: linear-gradient(135deg, #fff5f5, #fee2e2);
            border-color: #fca5a5;
        }

        .cd-cab-desc-block.cd-cab-desc-info {
            background: linear-gradient(135deg, #eff6ff, #dbeafe);
            border-color: #93c5fd;
        }

        .cd-cab-desc-title {
            font-size: 12px;
            font-weight: 700;
            color: #2a5298;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .cd-cab-desc-block.cd-cab-desc-warning .cd-cab-desc-title {
            color: #92400e;
        }
        .cd-cab-desc-block.cd-cab-desc-success .cd-cab-desc-title {
            color: #166534;
        }
        .cd-cab-desc-block.cd-cab-desc-danger .cd-cab-desc-title {
            color: #991b1b;
        }
        .cd-cab-desc-block.cd-cab-desc-info .cd-cab-desc-title {
            color: #1e40af;
        }

        .cd-cab-desc-content {
            font-size: 13px;
            color: #4a5568;
            line-height: 1.7;
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* --- RISK GRID --- */
        .cd-cab-risk-grid-new {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
            gap: 8px;
        }

        .cd-cab-risk-item-new {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-radius: 10px;
            font-size: 12px;
            transition: transform 0.2s;
        }

        .cd-cab-risk-item-new:hover {
            transform: translateY(-1px);
        }

        .cd-cab-risk-yes {
            background: linear-gradient(135deg, #fffbeb, #fef3c7);
            border: 1px solid #fcd34d;
            color: #92400e;
        }

        .cd-cab-risk-no {
            background: linear-gradient(135deg, #f0fff4, #dcfce7);
            border: 1px solid #86efac;
            color: #166534;
        }

        .cd-cab-risk-icon {
            font-size: 16px;
            flex-shrink: 0;
        }

        .cd-cab-risk-label {
            flex: 1;
            font-weight: 500;
            line-height: 1.3;
        }

        .cd-cab-risk-val {
            font-weight: 700;
            font-size: 11px;
            flex-shrink: 0;
        }

        /* --- PAGE FOOTER --- */
        .cd-cab-page-footer {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 20px;
            background: #fff;
            border-top: 1px solid #e2e8f0;
            border-radius: 0 0 12px 12px;
            min-height: 90px;
            position: sticky;
            bottom: 0;
            z-index: 10;
            box-shadow: 0 -4px 16px rgba(26,58,107,0.08);
        }

        .cd-cab-prev-btn,
        .cd-cab-next-btn {
            padding: 9px 20px;
            background: linear-gradient(135deg, #1a3a6b, #2a5298);
            border: none;
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(26,58,107,0.25);
            flex-shrink: 0;
        }

        .cd-cab-prev-btn:hover,
        .cd-cab-next-btn:hover {
            background: linear-gradient(135deg, #2a5298, #3a6fd8);
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(26,58,107,0.35);
        }

        .cd-cab-prev-btn:disabled,
        .cd-cab-next-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
            pointer-events: none;
            transform: none;
            box-shadow: none;
        }

        /* --- RESPONSIVE --- */
        @media (max-width: 900px) {
            .cd-cab-main-grid {
                grid-template-columns: 1fr;
            }
            .cd-cab-metrics {
                gap: 8px;
            }
            .cd-cab-metric {
                min-width: 120px;
            }
            .cd-cab-crq-title {
                font-size: 18px;
            }
            .cd-cab-page-header-top {
                padding: 12px 16px;
            }
            .cd-cab-page-header-main {
                padding: 16px 16px 20px;
            }
            .cd-cab-main-grid {
                padding: 12px;
            }
        }

        @media (max-width: 600px) {
            .cd-cab-schedule {
                flex-direction: column;
            }
            .cd-cab-schedule-arrow {
                transform: rotate(90deg);
                justify-content: center;
            }
            .cd-cab-risk-grid-new {
                grid-template-columns: 1fr;
            }
            .cd-cab-metrics {
                flex-direction: column;
            }
        }
        /* ============================================
        CAB2 - Compact Dark/Light
        ============================================ */

        /* משתני צבע - dark (ברירת מחדל) */
        .cab2-root {
            --cab2-bg:          #111827;
            --cab2-surface:     #1f2937;
            --cab2-surface2:    #374151;
            --cab2-border:      #374151;
            --cab2-border2:     #4b5563;
            --cab2-text:        #f9fafb;
            --cab2-text2:       #d1d5db;
            --cab2-text3:       #9ca3af;
            --cab2-accent:      #7c3aed;
            --cab2-accent2:     #a78bfa;
            --cab2-topbar-bg:   #1a1030;
            --cab2-topbar-bdr:  #4c1d95;
            --cab2-timebar-bg:  #1f2937;
            --cab2-timebar-bdr: #374151;
            --cab2-hdr-bg:      #111827;
            --cab2-hdr-bdr:     #374151;
            --cab2-footer-bg:   #1f2937;
            --cab2-footer-bdr:  #374151;
            --cab2-thumb-bg:    #374151;
            --cab2-thumb-bdr:   #4b5563;
            --cab2-thumb-act:   #1a1030;
            --cab2-thumb-actbdr:#7c3aed;
            --cab2-pill-bg:     #374151;
            --cab2-pill-bdr:    #4b5563;
            --cab2-pill-text:   #d1d5db;
            --cab2-desc-bg:     #1f2937;
            --cab2-desc-bdr:    #374151;
            --cab2-desc-text:   #d1d5db;
            --cab2-desc-title:  #a78bfa;
            --cab2-risk-yes-bg: #2a1e0a;
            --cab2-risk-yes-bdr:#92400e;
            --cab2-risk-yes-txt:#fbbf24;
            --cab2-risk-no-bg:  #0a2a0a;
            --cab2-risk-no-bdr: #14532d;
            --cab2-risk-no-txt: #4ade80;
            --cab2-nav-bg:      #320F5B;
            --cab2-nav-bdr:     #7c3aed;
            --cab2-nav-hover:   #4a1a8c;
            --cab2-shadow:      0 2px 12px rgba(0,0,0,0.4);
        }

        /* light mode */
        [data-theme="light"] .cab2-root {
            --cab2-bg:          #f0f4f8;
            --cab2-surface:     #ffffff;
            --cab2-surface2:    #f8fafc;
            --cab2-border:      #e2e8f0;
            --cab2-border2:     #cbd5e1;
            --cab2-text:        #1a2332;
            --cab2-text2:       #4a5568;
            --cab2-text3:       #718096;
            --cab2-accent:      #2a5298;
            --cab2-accent2:     #1a3a6b;
            --cab2-topbar-bg:   linear-gradient(135deg,#1a3a6b,#2a5298,#3a6fd8);
            --cab2-topbar-bdr:  #1a3a6b;
            --cab2-timebar-bg:  #ffffff;
            --cab2-timebar-bdr: #e2e8f0;
            --cab2-hdr-bg:      #f8fafc;
            --cab2-hdr-bdr:     #e2e8f0;
            --cab2-footer-bg:   #ffffff;
            --cab2-footer-bdr:  #e2e8f0;
            --cab2-thumb-bg:    #f0f4f8;
            --cab2-thumb-bdr:   #e2e8f0;
            --cab2-thumb-act:   #ede9fe;
            --cab2-thumb-actbdr:#7c3aed;
            --cab2-pill-bg:     #eef2ff;
            --cab2-pill-bdr:    #c7d2fe;
            --cab2-pill-text:   #1a3a6b;
            --cab2-desc-bg:     #f8faff;
            --cab2-desc-bdr:    #dde8ff;
            --cab2-desc-text:   #4a5568;
            --cab2-desc-title:  #2a5298;
            --cab2-risk-yes-bg: #fffbeb;
            --cab2-risk-yes-bdr:#fcd34d;
            --cab2-risk-yes-txt:#92400e;
            --cab2-risk-no-bg:  #f0fff4;
            --cab2-risk-no-bdr: #86efac;
            --cab2-risk-no-txt: #166534;
            --cab2-nav-bg:      linear-gradient(135deg,#1a3a6b,#2a5298);
            --cab2-nav-bdr:     #1a3a6b;
            --cab2-nav-hover:   linear-gradient(135deg,#2a5298,#3a6fd8);
            --cab2-shadow:      0 2px 12px rgba(26,58,107,0.10);
        }

        /* ROOT */
        .cab2-root {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 120px);
            background: var(--cab2-bg);
            border-radius: 10px;
            overflow: hidden;
            font-family: 'Heebo', Arial, sans-serif;
            direction: rtl;
            color: var(--cab2-text);
        }

        /* ---- TOPBAR ---- */
        .cab2-topbar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            background: var(--cab2-topbar-bg);
            border-bottom: 2px solid var(--cab2-topbar-bdr);
            flex-shrink: 0;
            min-height: 52px;
            overflow: hidden;
            flex-wrap: nowrap;     /* אסור לרדת שורה */
        }

        [data-theme="light"] .cab2-topbar {
            background: linear-gradient(135deg,#1a3a6b,#2a5298,#3a6fd8);
        }

        /* ימין: מספר + שם */
        .cab2-topbar-right {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-shrink: 0;
        }

        .cab2-topbar-num {
            font-size: 13px;
            font-weight: 800;
            color: #a78bfa;
            white-space: nowrap;
            flex-shrink: 0;
        }

        /* מספר שינוי - עם קישור */
        .cab2-topbar-num--link {
            text-decoration: none;
            color: #a78bfa;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 3px 8px;
            border-radius: 6px;
            border: 1px solid rgba(124,58,237,0.35);
            background: rgba(124,58,237,0.12);
            transition: all 0.2s;
            cursor: pointer;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .cab2-topbar-num--link:hover {
            background: rgba(124,58,237,0.28);
            border-color: rgba(124,58,237,0.6);
            color: #c4b5fd;
            transform: translateY(-1px);
            box-shadow: 0 3px 10px rgba(124,58,237,0.3);
        }

        .cab2-topbar-num-icon {
            font-size: 10px;
            opacity: 0.7;
            transition: opacity 0.2s;
        }

        .cab2-topbar-num--link:hover .cab2-topbar-num-icon {
            opacity: 1;
        }

        /* light mode */
        [data-theme="light"] .cab2-topbar-num--link {
            color: #fde68a;
            border-color: rgba(253,230,138,0.4);
            background: rgba(253,230,138,0.12);
        }

        [data-theme="light"] .cab2-topbar-num--link:hover {
            background: rgba(253,230,138,0.25);
            border-color: rgba(253,230,138,0.7);
            color: #fff;
        }

        [data-theme="light"] .cab2-topbar-num {
            color: #fde68a;
        }

        .cab2-topbar-title {
            font-size: 17px;
            font-weight: 700;
            color: #fff;
            max-width: 700px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        /* שם מערכת ליד שם השינוי */
        .cab2-topbar-system {
            display: inline-flex;
            align-items: center;
            margin-right: 8px;
            padding: 2px 8px;
            background: rgba(8, 145, 178, 0.2);
            border: 1px solid rgba(8, 145, 178, 0.4);
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            color: #67e8f9;
            white-space: nowrap;
            vertical-align: middle;
            flex-shrink: 0;
        }

        [data-theme="light"] .cab2-topbar-system {
            background: rgba(8, 145, 178, 0.72);
            border-color: rgba(8, 145, 178, 0.35);
            color: #b6f1ff;
        }

        /* מרכז: pills */
        .cab2-topbar-center {
            flex: 1;
            display: flex;
            gap: 5px;
            flex-wrap: nowrap;
            justify-content: center;
            overflow: hidden;
            min-width: 0;
        }

        /* זמנים: התחלה → סיום + קישור */
        .cab2-topbar-times {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 8px;
            padding: 4px 10px;
            white-space: nowrap;
        }

        .cab2-time-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .cab2-time-lbl {
            font-size: 10px;
            color: rgba(255,255,255,0.55);
            font-weight: 500;
        }

        .cab2-time-sep {
            color: rgba(255,255,255,0.4);
            font-size: 12px;
        }

        .cab2-topbar-link {
            font-size: 11px;
            font-weight: 600;
            color: #93c5fd;
            text-decoration: none;
            padding: 2px 6px;
            background: rgba(96,165,250,0.15);
            border-radius: 5px;
            border: 1px solid rgba(96,165,250,0.3);
            transition: all 0.2s;
        }

        .cab2-topbar-link:hover {
            background: rgba(96,165,250,0.3);
            color: #fff;
        }

        [data-theme="light"] .cab2-topbar-link {
            color: #fde68a;
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.3);
        }

        /* שמאל: סטטוס + דגלים + מונה */
        .cab2-topbar-left {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-shrink: 0;
            flex-wrap: nowrap;
        }

        /* pills בתוך topbar - קטנים יותר */
        .cab2-topbar .cab2-pill {
            padding: 2px 8px;
            font-size: 12px;
        }

        /* responsive */
        @media (max-width: 900px) {
            .cab2-topbar {
                height: auto;
                flex-wrap: wrap;
                padding: 8px 12px;
                gap: 6px;
            }
            .cab2-topbar-right {
                max-width: 100%;
            }
            .cab2-topbar-center {
                flex-wrap: wrap;
                justify-content: flex-start;
            }
        }

        /* pills */
        .cab2-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: var(--cab2-pill-bg);
            border: 1px solid var(--cab2-pill-bdr);
            color: var(--cab2-pill-text);
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
        }

        [data-theme="light"] .cab2-pill {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.3);
            color: #fff;
        }

        /* flags */
        .cab2-flag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
        }

        .cab2-flag--risk {
            background: rgba(245,158,11,0.2);
            border: 1px solid rgba(245,158,11,0.4);
            color: #fbbf24;
        }

        .cab2-flag--conflict {
            background: rgba(239,68,68,0.2);
            border: 1px solid rgba(239,68,68,0.4);
            color: #f87171;
        }

        /* counter */
        .cab2-counter {
            background: rgba(124,58,237,0.25);
            border: 1px solid rgba(124,58,237,0.5);
            color: #a78bfa;
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
            direction: ltr;
        }

        [data-theme="light"] .cab2-counter {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.3);
            color: #fff;
        }

        /* status badge */
        .cab2-status-badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
        }

        /* ---- TIME BAR ---- */
        .cab2-timebar {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 7px 16px;
            background: var(--cab2-timebar-bg);
            border-bottom: 1px solid var(--cab2-timebar-bdr);
            flex-shrink: 0;
            flex-wrap: wrap;
        }
        .cab2-time-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .cab2-time-lbl {
            font-size: 11px;
            color: var(--cab2-text3);
            font-weight: 500;
        }

        .cab2-time-val {
            font-size: 13px;
            font-weight: 700;
            color: var(--cab2-text);
        }

        .cab2-time-val--cab {
            color: #a78bfa;
        }

        [data-theme="light"] .cab2-time-val--cab {
            color: #7c3aed;
        }

        .cab2-time-sep {
            color: var(--cab2-text3);
            font-size: 14px;
        }

        .cab2-time-link {
            margin-right: auto;
        }

        .cab2-link {
            color: #60a5fa;
            text-decoration: none;
            font-size: 12px;
            font-weight: 600;
        }

        .cab2-link:hover {
            color: #93c5fd;
            text-decoration: underline;
        }

        [data-theme="light"] .cab2-link {
            color: #2a5298;
        }

        /* ---- BODY ---- */
        .cab2-body {
            display: grid;
            grid-template-columns: 180px 1fr 190px;
            gap: 5px;
            padding: 5px 7px;
            flex: 1;
            overflow: hidden;
            min-height: 0;
        }

        .cab2-col {
            display: flex;
            flex-direction: column;
            min-height: 0;
            overflow: hidden;
            gap: 5px;
        }

        .cab2-col--wide {
            min-width: 0;
        }

        /* ---- CARDS ---- */
        .cab2-card {
            background: var(--cab2-surface);
            border: 1px solid var(--cab2-border);
            border-radius: 8px;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
            box-shadow: var(--cab2-shadow);
        }

        .cab2-card--scroll .cab2-card-body {
            overflow-y: auto;
        }

        .cab2-card-hdr {
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 700;
            color: var(--cab2-accent2);
            background: var(--cab2-hdr-bg);
            border-bottom: 1px solid var(--cab2-hdr-bdr);
            flex-shrink: 0;
            letter-spacing: 0.3px;
        }

        .cab2-card-body {
            padding: 8px 8px;
            flex: 1;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: var(--cab2-border2) transparent;
        }

        .cab2-card-body::-webkit-scrollbar {
            width: 4px;
        }

        .cab2-card-body::-webkit-scrollbar-thumb {
            background: var(--cab2-border2);
            border-radius: 2px;
        }

        .cab2-empty-msg {
            font-size: 12px;
            color: var(--cab2-text3);
        }

        /* ---- TEAM ---- */
        .cab2-card-body--team {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .cab2-team-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 4px;
            border-radius: 6px;
            transition: background 0.15s;
        }

        .cab2-team-row:hover {
            background: var(--cab2-surface2);
        }

        .cab2-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
            color: #fff;
            flex-shrink: 0;
        }

        .cab2-avatar--blue   { background: linear-gradient(135deg,#1a3a6b,#2a5298); }
        .cab2-avatar--orange { background: linear-gradient(135deg,#e8a020,#f5c842); }
        .cab2-avatar--green  { background: linear-gradient(135deg,#27ae60,#2ecc71); }
        .cab2-avatar--purple { background: linear-gradient(135deg,#7c3aed,#8b5cf6); }
        .cab2-avatar--teal   { background: linear-gradient(135deg,#0891b2,#06b6d4); }
        .cab2-avatar--gray   { background: linear-gradient(135deg,#4a5568,#718096); }

        .cab2-team-info {
            min-width: 0;
        }

        .cab2-team-name {
            font-size: 14px;
            font-weight: 600;
            color: var(--cab2-text);
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cab2-team-role {
            font-size: 13px;
            font-weight: 600;
            color: #c4b5fd;
            letter-spacing: .2px;
        }

        /* ---- DESC BLOCKS ---- */
        .cab2-desc {
            background: var(--cab2-desc-bg);
            border: 1px solid var(--cab2-desc-bdr);
            border-radius: 6px;
            padding: 8px 10px;
            margin-bottom: 6px;
        }

        .cab2-desc:last-child {
            margin-bottom: 0;
        }

        .cab2-desc--warn {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.25);
        }

        .cab2-desc--ok {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.25);
        }

        .cab2-desc--danger {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.25);
        }

        .cab2-desc--info {
            background: rgba(59,130,246,0.08);
            border-color: rgba(59,130,246,0.25);
        }

        [data-theme="light"] .cab2-desc--warn {
            background: #fffbeb;
            border-color: #fcd34d;
        }

        [data-theme="light"] .cab2-desc--ok {
            background: #f0fff4;
            border-color: #86efac;
        }

        [data-theme="light"] .cab2-desc--danger {
            background: #fff5f5;
            border-color: #fca5a5;
        }

        [data-theme="light"] .cab2-desc--info {
            background: #eff6ff;
            border-color: #93c5fd;
        }

        .cab2-desc-title {
            font-size: 12px;
            font-weight: 700;
            color: var(--cab2-desc-title);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .cab2-desc--warn  .cab2-desc-title { color: #f59e0b; }
        .cab2-desc--ok    .cab2-desc-title { color: #22c55e; }
        .cab2-desc--danger .cab2-desc-title { color: #ef4444; }
        .cab2-desc--info   .cab2-desc-title { color: #3b82f6; }

        [data-theme="light"] .cab2-desc--warn   .cab2-desc-title { color: #92400e; }
        [data-theme="light"] .cab2-desc--ok     .cab2-desc-title { color: #166534; }
        [data-theme="light"] .cab2-desc--danger .cab2-desc-title { color: #991b1b; }
        [data-theme="light"] .cab2-desc--info   .cab2-desc-title { color: #1e40af; }

        .cab2-desc-body {
            font-size: 15px;
            font-weight: bold;
            color: var(--cab2-desc-text);
            line-height: 1.6;
            white-space: inherit;
            word-break: break-word;
        }

        .cd-popup-cab2 .cab2-desc-body {
            line-height: 1.3;
        }
        /* ---- RISK ITEMS ---- */
        .cab2-risk-item {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 6px 8px;
            border-radius: 6px;
            margin-bottom: 4px;
            font-size: 12px;
            transition: transform 0.15s;
        }

        .cab2-risk-item:last-child {
            margin-bottom: 0;
        }

        .cab2-risk-item:hover {
            transform: translateX(-2px);
        }

        .cab2-risk-item--yes {
            background: var(--cab2-risk-yes-bg);
            border: 1px solid var(--cab2-risk-yes-bdr);
            color: var(--cab2-risk-yes-txt);
        }

        .cab2-risk-item--no {
            background: var(--cab2-risk-no-bg);
            border: 1px solid var(--cab2-risk-no-bdr);
            color: var(--cab2-risk-no-txt);
        }

        .cab2-risk-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: currentColor;
            flex-shrink: 0;
        }

        .cab2-risk-lbl {
            flex: 1;
            font-weight: 500;
            line-height: 1.3;
        }

        .cab2-risk-val {
            font-weight: bold;
            font-size: 14px;
            flex-shrink: 0;
            opacity: 0.85;
        }

        /* ---- FOOTER ---- */
        .cab2-footer {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: var(--cab2-footer-bg);
            border-top: 1px solid var(--cab2-footer-bdr);
            flex-shrink: 0;
            min-height: 72px;
        }

        /* nav buttons */
        .cab2-nav-btn {
            width: 34px;
            height: 34px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--cab2-nav-bg);
            border: 1px solid var(--cab2-nav-bdr);
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
            flex-shrink: 0;
            transition: all 0.2s;
        }

        .cab2-nav-btn:hover {
            background: var(--cab2-nav-hover);
            transform: scale(1.05);
        }

        .cab2-nav-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
            pointer-events: none;
            transform: none;
        }

        [data-theme="light"] .cab2-nav-btn {
            background: linear-gradient(135deg, #1a3a6b, #2a5298);
            border-color: #1a3a6b;
        }

        [data-theme="light"] .cab2-nav-btn:hover {
            background: linear-gradient(135deg, #2a5298, #3a6fd8);
        }

        /* thumbs */
        .cab2-thumbs-wrap {
            flex: 1;
            overflow-x: auto;
            overflow-y: hidden;
            scroll-behavior: smooth;
            scrollbar-width: thin;
            scrollbar-color: var(--cab2-border2) transparent;
            padding-bottom: 2px;
            display: flex;
            justify-content: center;
        }

        .cab2-thumbs-wrap::-webkit-scrollbar {
            height: 3px;
        }

        .cab2-thumbs-wrap::-webkit-scrollbar-thumb {
            background: var(--cab2-border2);
            border-radius: 2px;
        }

        .cab2-thumbs {
            display: flex;
            gap: 5px;
            padding: 2px 1px;
            width: max-content;
        }

        .cab2-thumb {
            position: relative;
            background: var(--cab2-thumb-bg);
            border: 1px solid var(--cab2-thumb-bdr);
            border-radius: 7px;
            padding: 6px 10px;
            cursor: pointer;
            transition: all 0.18s;
            min-width: 120px;
            max-width: 200px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex-shrink: 0;
            user-select: none;
        }

        .cab2-thumb:hover {
            border-color: var(--cab2-accent);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(124,58,237,0.2);
        }

        .cab2-thumb--active {
            background: var(--cab2-thumb-act) !important;
            border: 2px solid var(--cab2-thumb-actbdr) !important;
            box-shadow: 0 0 10px rgba(124,58,237,0.35);
        }

        .cab2-thumb--risk {
            border-right: 3px solid #f59e0b;
        }

        .cab2-thumb--conflict {
            border-right: 3px solid #ef4444;
        }

        .cab2-thumb-num {
            font-size: 10px;
            font-weight: 700;
            color: var(--cab2-accent2);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cab2-thumb--active .cab2-thumb-num {
            color: #c4b5fd;
        }

        [data-theme="light"] .cab2-thumb--active .cab2-thumb-num {
            color: #7c3aed;
        }

        .cab2-thumb-name {
            font-size: 10px;
            color: var(--cab2-text2);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.3;
        }

        /* ---- RESPONSIVE ---- */
        @media (max-width: 900px) {
            .cab2-body {
                grid-template-columns: 1fr 1fr;
                overflow-y: auto;
            }

            .cab2-col:last-child {
                grid-column: 1 / -1;
            }

            .cab2-root {
                height: auto;
                min-height: calc(100vh - 120px);
            }
        }

        @media (max-width: 600px) {
            .cab2-body {
                grid-template-columns: 1fr;
                overflow-y: auto;
            }

            .cab2-topbar {
                flex-direction: column;
                align-items: flex-start;
                gap: 6px;
            }

            .cab2-topbar-center {
                justify-content: flex-start;
            }

            .cab2-thumb {
                min-width: 100px;
            }
        }
        /* ===== POPUP - CAB2 STYLE ===== */
        .cd-popup-cab2 {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: var(--cab2-bg, #111827);
            border-radius: 12px;
            direction: rtl;
        }

        /* topbar בתוך popup - גובה קצת יותר גדול */
        .cd-popup-topbar {
            border-radius: 12px 12px 0 0;
            min-height: 56px;
            flex-wrap: nowrap;
        }

        /* body בתוך popup - גובה מוגבל */
        .cd-popup-body-cab2 {
            flex: 1;
            overflow: hidden;
            min-height: 0;
            padding: 8px;
            gap: 8px;
        }

        /* כפתור סגירה בסגנון CAB */
        .cd-popup-close-cab2 {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: rgba(255,255,255,0.8);
            font-size: 14px;
            cursor: pointer;
            padding: 5px 9px;
            border-radius: 6px;
            transition: all 0.2s;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 4px;
        }

        .cd-popup-close-cab2:hover {
            background: rgba(239,68,68,0.3);
            border-color: rgba(239,68,68,0.5);
            color: #fff;
        }

        /* light mode */
        [data-theme="light"] .cd-popup-cab2 {
            background: var(--cab2-bg, #f0f4f8);
        }

        [data-theme="light"] .cd-popup-topbar {
            background: linear-gradient(135deg, #1a3a6b, #2a5298, #3a6fd8);
        }

        .cab2-thumb--drag-over {
            border: 2px dashed #7c3aed !important;
            background: rgba(124,58,237,0.15) !important;
            transform: scale(1.03);
        }

        .cab2-thumb[draggable="true"] {
            cursor: grab;
        }

        .cab2-thumb[draggable="true"]:active {
            cursor: grabbing;
        }
        .cd-popup-export-cal {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 10px;
            background: rgba(34,197,94,0.15);
            border: 1px solid rgba(34,197,94,0.35);
            border-radius: 6px;
            color: #4ade80;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .cd-popup-export-cal:hover {
            background: rgba(34,197,94,0.3);
            border-color: rgba(34,197,94,0.6);
            color: #fff;
            transform: translateY(-1px);
        }

        /* ===== CAB DRAG & DROP ===== */
        .cab2-thumb--drag-over {
            border: 2px dashed #7c3aed !important;
            background: rgba(124,58,237,0.15) !important;
            transform: scale(1.03);
            transition: all 0.15s;
        }

        .cab2-thumb[draggable="true"] {
            cursor: grab;
        }

        .cab2-thumb[draggable="true"]:active {
            cursor: grabbing;
        }

        /* כפתור איפוס סדר */
        .cab2-reset-order-btn {
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 6px;
            color: #f87171;
            cursor: pointer;
            font-size: 12px;
            flex-shrink: 0;
            transition: all 0.2s;
            title: 'איפוס סדר';
        }

        .cab2-reset-order-btn:hover {
            background: rgba(239,68,68,0.3);
            border-color: rgba(239,68,68,0.6);
            color: #fff;
            transform: rotate(-30deg);
        }

        /* אנימציה כללית */
        @keyframes cdFadeIn {
            from { opacity: 0; transform: translateX(-50%) translateY(8px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0);   }
        }

        /* Light mode */
        [data-theme="light"] .cab2-reset-order-btn {
            background: rgba(220,38,38,0.08);
            border-color: rgba(220,38,38,0.25);
            color: #dc2626;
        }

        [data-theme="light"] .cab2-reset-order-btn:hover {
            background: rgba(220,38,38,0.2);
            color: #fff;
        }
        /* ================================================
        LIGHT MODE - COMPLETE FIX
        ================================================ */

        /* ---- GENERAL ---- */
        [data-theme="light"] .cd-wrapper {
            background: #f0f4f8;
            color: #1a2332;
        }

        /* ---- HEADER ---- */
        [data-theme="light"] .cd-header {
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.07);
        }

        [data-theme="light"] .cd-title {
            color: #1a2332;
        }

        [data-theme="light"] .cd-title i {
            color: #7c3aed;
        }

        /* ---- STATS ---- */
        [data-theme="light"] .cd-stat {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.06);
        }

        [data-theme="light"] .cd-stat-val {
            color: #1a2332;
        }

        [data-theme="light"] .cd-stat-lbl {
            color: #718096;
        }

        [data-theme="light"] .cd-stat-cab {
            border-color: #c4b5fd;
        }

        [data-theme="light"] .cd-stat-cab .cd-stat-val {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-stat-risk {
            border-color: #fcd34d;
        }

        [data-theme="light"] .cd-stat-risk .cd-stat-val {
            color: #d97706;
        }

        [data-theme="light"] .cd-stat-conflict {
            border-color: #fca5a5;
        }

        [data-theme="light"] .cd-stat-conflict .cd-stat-val {
            color: #dc2626;
        }

        /* ---- VIEW BUTTONS ---- */
        [data-theme="light"] .cd-view-btn {
            background: #ffffff;
            color: #4a5568;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px rgba(26,58,107,0.06);
        }

        [data-theme="light"] .cd-view-btn:hover {
            background: #f0f4f8;
            color: #1a2332;
            border-color: #cbd5e1;
        }

        [data-theme="light"] .cd-view-btn.active {
            background: #7c3aed;
            color: #ffffff;
            border-color: #7c3aed;
            box-shadow: 0 2px 8px rgba(124,58,237,0.3);
        }

        /* ---- FILTER BAR ---- */
        [data-theme="light"] .cd-filter-bar {
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.05);
        }

        [data-theme="light"] .cd-filter-label {
            color: #718096;
        }

        [data-theme="light"] .cd-filter-row {
            color: #1a2332;
        }

        [data-theme="light"] .cd-search-wrap > i {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-search-input {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-search-input:focus {
            border-color: #7c3aed;
            background: #ffffff;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cd-search-input::placeholder {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-clear-search {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-clear-search:hover {
            color: #1a2332;
        }

        [data-theme="light"] .cd-filter-select {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-filter-select:focus {
            border-color: #7c3aed;
            background: #ffffff;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cd-date-input {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-date-input:hover {
            border-color: #7c3aed;
        }

        [data-theme="light"] .cd-date-input::placeholder {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-date-sep {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-toggle-label {
            color: #4a5568;
        }

        [data-theme="light"] .cd-toggle-label:hover {
            color: #1a2332;
        }

        [data-theme="light"] .cd-clear-filters-btn {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #4a5568;
        }

        [data-theme="light"] .cd-clear-filters-btn:hover {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #dc2626;
        }

        [data-theme="light"] .cd-cab-range-btn {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #4a5568;
        }

        [data-theme="light"] .cd-cab-range-btn:hover {
            background: #f0f4f8;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        [data-theme="light"] .cd-cab-range-btn.active {
            background: #7c3aed;
            border-color: #7c3aed;
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(124,58,237,0.3);
        }

        [data-theme="light"] .cd-cab-range-btn.active:hover {
            background: #6d28d9;
        }

        [data-theme="light"] .cd-active-filters {
            background: rgba(124,58,237,0.08);
            border: 1px solid rgba(124,58,237,0.2);
            color: #7c3aed;
        }

        /* ---- LOADING / ERROR ---- */
        [data-theme="light"] .cd-loading {
            color: #718096;
        }

        [data-theme="light"] .cd-loading i {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-error {
            color: #dc2626;
        }

        /* ---- CONTENT AREA ---- */
        [data-theme="light"] .cd-content {
            background: #f0f4f8;
        }

        /* ---- CALENDAR ---- */
        [data-theme="light"] .cd-cal-nav-btn,
        [data-theme="light"] .cd-today-btn {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            color: #4a5568;
            box-shadow: 0 1px 3px rgba(26,58,107,0.06);
        }

        [data-theme="light"] .cd-cal-nav-btn:hover,
        [data-theme="light"] .cd-today-btn:hover {
            background: #f0f4f8;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        [data-theme="light"] .cd-cal-title {
            color: #1a2332;
        }

        [data-theme="light"] .cd-cal-count {
            color: #718096;
        }

        [data-theme="light"] .cd-cal-weekdays > div {
            background: #e8edf5;
            color: #4a5568;
            font-weight: 600;
        }

        [data-theme="light"] .cd-cal-day {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px rgba(26,58,107,0.04);
        }

        [data-theme="light"] .cd-cal-empty {
            background: #f8fafc;
            border-color: #edf2f7;
            box-shadow: none;
        }

        [data-theme="light"] .cd-cal-day.cd-today {
            background: #faf5ff;
            border-color: #7c3aed;
            box-shadow: 0 0 0 1px rgba(124,58,237,0.15);
        }

        [data-theme="light"] .cd-cal-day.cd-has-changes {
            border-color: #c7d2fe;
        }

        [data-theme="light"] .cd-cal-day.cd-has-conflict {
            border-color: #fca5a5 !important;
            background: #fff5f5;
        }

        [data-theme="light"] .cd-day-num {
            color: #4a5568;
            font-weight: 700;
        }

        [data-theme="light"] .cd-today .cd-day-num {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-risk-icon {
            color: #d97706;
        }

        [data-theme="light"] .cd-conflict-icon {
            color: #dc2626;
        }

        [data-theme="light"] .cd-day-change {
            background: #eef2ff;
            border: 1px solid #e0e7ff;
        }

        [data-theme="light"] .cd-day-change:hover {
            background: #e0e7ff;
            border-color: #c7d2fe;
        }

        [data-theme="light"] .cd-day-change.cd-chg-risk {
            border-right: 2px solid #fef3c7;
        }

        [data-theme="light"] .cd-day-change.cd-chg-conflict {
            background: #fff5f5;
            border-right: 2px solid #dc2626;
            border-color: #fee2e2;
        }

        [data-theme="light"] .cd-chg-num {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-chg-name {
            color: #374151;
        }

        [data-theme="light"] .cd-day-more {
            color: #7c3aed;
            background: #f5f3ff;
            border-top: 1px solid #e0e7ff;
        }

        [data-theme="light"] .cd-day-more:hover {
            color: #5b21b6;
            background: #ede9fe;
        }

        /* ---- WEEK VIEW ---- */
        [data-theme="light"] .cd-week-view {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-week-title {
            color: #1a2332;
        }

        [data-theme="light"] .cd-week-col {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.05);
        }

        [data-theme="light"] .cd-week-col.cd-today {
            border-color: #7c3aed;
            background: #faf5ff;
            box-shadow: 0 0 0 1px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cd-week-col.cd-has-conflict {
            border-color: #fca5a5;
            background: #fff5f5;
        }

        [data-theme="light"] .cd-week-col-header {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-week-dow {
            color: #1a2332;
            font-weight: 700;
        }

        [data-theme="light"] .cd-week-date {
            color: #718096;
        }

        [data-theme="light"] .cd-week-count {
            background: #7c3aed;
            color: #ffffff;
        }

        [data-theme="light"] .cd-week-change {
            background: #eef2ff;
            border: 1px solid #e0e7ff;
        }

        [data-theme="light"] .cd-week-change:hover {
            background: #e0e7ff;
            border-color: #c7d2fe;
        }

        [data-theme="light"] .cd-week-change.cd-chg-risk {
            border-right: 2px solid #fef3c7;
        }

        [data-theme="light"] .cd-week-change.cd-chg-conflict {
            background: #fff5f5;
            border-right: 2px solid #dc2626;
            border-color: #fee2e2;
        }

        [data-theme="light"] .cd-chg-time {
            color: #718096;
        }

        [data-theme="light"] .cd-week-empty {
            color: #a0aec0;
        }

        /* ---- DAY VIEW ---- */
        [data-theme="light"] .cd-day-view {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-day-title {
            color: #1a2332;
        }

        [data-theme="light"] .cd-today-title {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-today-badge {
            background: #7c3aed;
            color: #ffffff;
        }

        [data-theme="light"] .cd-day-count {
            color: #718096;
        }

        [data-theme="light"] .cd-day-empty {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-day-empty i {
            color: #cbd5e1;
        }

        [data-theme="light"] .cd-day-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.06);
        }

        [data-theme="light"] .cd-day-card:hover {
            background: #f8fafc;
            border-color: #c7d2fe;
            box-shadow: 0 4px 12px rgba(26,58,107,0.1);
        }

        [data-theme="light"] .cd-day-card.cd-card-risk {
            border-right: 3px solid #d97706;
        }

        [data-theme="light"] .cd-day-card.cd-card-conflict {
            border-right: 3px solid #dc2626;
            background: #fff5f5;
        }

        [data-theme="light"] .cd-day-card-num {
            color: #7c3aed;
            font-weight: 700;
        }

        [data-theme="light"] .cd-day-card-name {
            color: #1a2332;
        }

        [data-theme="light"] .cd-day-card-meta {
            color: #718096;
        }

        [data-theme="light"] .cd-day-card-meta i {
            color: #a0aec0;
        }

        /* ---- TABLE VIEW ---- */
        [data-theme="light"] .cd-table-view {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-table-info {
            color: #718096;
        }

        [data-theme="light"] .cd-table-wrap {
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.06);
            border-radius: 8px;
            overflow: hidden;
        }

        [data-theme="light"] .cd-table {
            background: #ffffff;
        }

        [data-theme="light"] .cd-table thead th {
            background: #f0f4f8;
            color: #4a5568;
            border-bottom: 2px solid #e2e8f0;
            font-weight: 700;
        }

        [data-theme="light"] .cd-table-row td {
            border-bottom: 1px solid #f0f4f8;
            color: #1a2332;
            background: #ffffff;
        }

        [data-theme="light"] .cd-table-row:hover td {
            background: #f8fafc;
        }

        [data-theme="light"] .cd-table-row.cd-row-conflict td {
            border-right: 2px solid #dc2626;
            background: #fff8f8;
        }

        [data-theme="light"] .cd-td-name {
            color: #1a2332;
            font-weight: 500;
        }

        [data-theme="light"] .cd-link {
            color: #2a5298;
            font-weight: 600;
        }

        [data-theme="light"] .cd-link:hover {
            color: #1a3a6b;
            text-decoration: underline;
        }

        /* ---- STATUS BADGES ---- */
        .cd-day-card-status {
            display: inline-flex;
            align-items: center;
            gap: 6px;

            padding: 4px 10px;
            border-radius: 999px;

            font-size: 11px;
            font-weight: 700;
            line-height: 1;

            border: 1px solid rgba(255,255,255,0.15);
            background: rgba(255,255,255,0.08);

            backdrop-filter: blur(4px);
            white-space: nowrap;
        }
        [data-theme="light"] .cd-status-green {
            background: #dcfce7;
            color: #166534;
            border: 1px solid #86efac;
        }

        [data-theme="light"] .cd-status-red {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }

        [data-theme="light"] .cd-status-yellow {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fcd34d;
        }

        [data-theme="light"] .cd-status-default {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #cbd5e1;
        }

        /* ---- RISK / CONFLICT / CAB BADGES ---- */
        [data-theme="light"] .cd-risk-badge {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fcd34d;
        }

        [data-theme="light"] .cd-conflict-badge {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }

        [data-theme="light"] .cd-cab-badge {
            background: #ede9fe;
            color: #5b21b6;
            border: 1px solid #c4b5fd;
        }

        [data-theme="light"] .cd-risk-badge-sm {
            color: #d97706;
        }

        [data-theme="light"] .cd-conflict-badge-sm {
            color: #dc2626;
        }

        /* ---- POPUP ---- */
        [data-theme="light"] .cd-popup-overlay {
            background: rgba(15,23,42,0.5);
            backdrop-filter: blur(3px);
        }

        [data-theme="light"] .cd-popup {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 20px 60px rgba(26,58,107,0.2);
        }

        [data-theme="light"] .cd-popup-header {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-popup-num {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-popup-name {
            color: #1a2332;
        }

        [data-theme="light"] .cd-popup-close {
            color: #718096;
        }

        [data-theme="light"] .cd-popup-close:hover {
            background: #fee2e2;
            color: #dc2626;
        }

        [data-theme="light"] .cd-popup-body {
            background: #ffffff;
        }

        [data-theme="light"] .cd-popup-section h4 {
            color: #7c3aed;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-popup-field {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-popup-label {
            color: #718096;
        }

        [data-theme="light"] .cd-popup-val {
            color: #1a2332;
        }

        /* ---- DAY LIST POPUP ---- */
        [data-theme="light"] .cd-day-card-clickable {
            background: #ffffff;
            border: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-day-card-clickable:hover {
            background: #f8fafc;
            border-color: #c7d2fe;
        }

        /* ---- FIELD TOGGLE ---- */
        [data-theme="light"] .cd-field-toggle-btn {
            background: rgba(124,58,237,0.1);
            border: 1px solid rgba(124,58,237,0.25);
            color: #7c3aed;
        }

        [data-theme="light"] .cd-field-toggle-btn:hover {
            background: rgba(124,58,237,0.2);
            color: #5b21b6;
        }

        /* ---- CAB RISK GRID (old style) ---- */
        [data-theme="light"] .cd-risk-yes {
            background: #fef3c7;
            border: 1px solid #fcd34d;
            color: #92400e;
        }

        [data-theme="light"] .cd-risk-yes i {
            color: #d97706;
        }

        [data-theme="light"] .cd-risk-no {
            background: #dcfce7;
            border: 1px solid #86efac;
            color: #166534;
        }

        [data-theme="light"] .cd-risk-no i {
            color: #16a34a;
        }

        /* ---- CAB2 - TOPBAR ---- */
        [data-theme="light"] .cab2-topbar {
            background: linear-gradient(135deg, #1a3a6b, #2a5298, #3a6fd8);
            border-bottom: 2px solid #1a3a6b;
        }

        [data-theme="light"] .cab2-topbar-title {
            color: #ffffff;
        }

        [data-theme="light"] .cab2-topbar-num {
            color: #fde68a;
        }

        [data-theme="light"] .cab2-topbar-num--link {
            color: #fde68a;
            border-color: rgba(253,230,138,0.4);
            background: rgba(253,230,138,0.12);
        }

        [data-theme="light"] .cab2-topbar-num--link:hover {
            background: rgba(253,230,138,0.25);
            border-color: rgba(253,230,138,0.7);
            color: #ffffff;
        }

        [data-theme="light"] .cab2-topbar-times {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.25);
        }

        [data-theme="light"] .cab2-time-lbl {
            color: rgba(255,255,255,0.7);
        }

        [data-theme="light"] .cab2-time-val {
            color: #ffffff;
            font-weight: 700;
        }

        [data-theme="light"] .cab2-time-sep {
            color: rgba(255,255,255,0.5);
        }

        [data-theme="light"] .cab2-topbar-system {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.3);
            color: #e0f2fe;
        }

        /* ---- CAB2 - PILLS / FLAGS / COUNTER ---- */
        [data-theme="light"] .cab2-pill {
            background: rgba(255,255,255,0.18);
            border-color: rgba(255,255,255,0.35);
            color: #ffffff;
        }

        [data-theme="light"] .cab2-flag--risk {
            background: rgba(245,158,11,0.25);
            border-color: rgba(245,158,11,0.5);
            color: #fde68a;
        }

        [data-theme="light"] .cab2-flag--conflict {
            background: rgba(239,68,68,0.25);
            border-color: rgba(239,68,68,0.5);
            color: #fca5a5;
        }

        [data-theme="light"] .cab2-counter {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.3);
            color: #ffffff;
        }

        /* ---- CAB2 - BODY ---- */
        [data-theme="light"] .cab2-root {
            background: #f0f4f8;
        }

        [data-theme="light"] .cab2-body {
            background: #f0f4f8;
            padding: 8px;
            gap: 8px;
        }

        /* ---- CAB2 - CARDS ---- */
        [data-theme="light"] .cab2-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 2px 12px rgba(26,58,107,0.08);
        }

        [data-theme="light"] .cab2-card-hdr {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            color: #2a5298;
        }

        [data-theme="light"] .cab2-card-body {
            scrollbar-color: #cbd5e1 transparent;
        }

        [data-theme="light"] .cab2-empty-msg {
            color: #a0aec0;
        }

        /* ---- CAB2 - TEAM ---- */
        [data-theme="light"] .cab2-team-row:hover {
            background: #f0f4f8;
        }

        [data-theme="light"] .cab2-team-name {
            color: #1a2332;
        }

        [data-theme="light"] .cab2-team-role {
            color: #718096;
        }

        /* ---- CAB2 - DESC BLOCKS ---- */
        [data-theme="light"] .cab2-desc {
            background: #f8faff;
            border: 1px solid #dde8ff;
        }

        [data-theme="light"] .cab2-desc-title {
            color: #2a5298;
        }

        [data-theme="light"] .cab2-desc-body {
            color: #374151;
        }

        [data-theme="light"] .cab2-desc--warn {
            background: #fffbeb;
            border-color: #fcd34d;
        }

        [data-theme="light"] .cab2-desc--warn .cab2-desc-title {
            color: #92400e;
        }

        [data-theme="light"] .cab2-desc--ok {
            background: #f0fff4;
            border-color: #86efac;
        }

        [data-theme="light"] .cab2-desc--ok .cab2-desc-title {
            color: #166534;
        }

        [data-theme="light"] .cab2-desc--danger {
            background: #fff5f5;
            border-color: #fca5a5;
        }

        [data-theme="light"] .cab2-desc--danger .cab2-desc-title {
            color: #991b1b;
        }

        [data-theme="light"] .cab2-desc--info {
            background: #eff6ff;
            border-color: #93c5fd;
        }

        [data-theme="light"] .cab2-desc--info .cab2-desc-title {
            color: #1e40af;
        }

        /* ---- CAB2 - RISK ITEMS ---- */
        [data-theme="light"] .cab2-risk-item--yes {
            background: #fffbeb;
            border: 1px solid #fcd34d;
            color: #92400e;
        }

        [data-theme="light"] .cab2-risk-item--no {
            background: #f0fff4;
            border: 1px solid #86efac;
            color: #166534;
        }

        /* ---- CAB2 - FOOTER ---- */
        [data-theme="light"] .cab2-footer {
            background: #ffffff;
            border-top: 1px solid #e2e8f0;
            box-shadow: 0 -2px 8px rgba(26,58,107,0.06);
        }

        /* ---- CAB2 - NAV BUTTONS ---- */
        [data-theme="light"] .cab2-nav-btn {
            background: linear-gradient(135deg, #1a3a6b, #2a5298);
            border-color: #1a3a6b;
            color: #ffffff;
            box-shadow: 0 2px 6px rgba(26,58,107,0.25);
        }

        [data-theme="light"] .cab2-nav-btn:hover {
            background: linear-gradient(135deg, #2a5298, #3a6fd8);
            box-shadow: 0 4px 10px rgba(26,58,107,0.35);
        }

        [data-theme="light"] .cab2-nav-btn:disabled {
            opacity: 0.3;
        }

        /* ---- CAB2 - THUMBS ---- */
        [data-theme="light"] .cab2-thumbs-wrap {
            scrollbar-color: #cbd5e1 transparent;
        }

        [data-theme="light"] .cab2-thumb {
            background: #f0f4f8;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px rgba(26,58,107,0.06);
        }

        [data-theme="light"] .cab2-thumb:hover {
            background: #ede9fe;
            border-color: #7c3aed;
            box-shadow: 0 4px 12px rgba(124,58,237,0.15);
        }

        [data-theme="light"] .cab2-thumb--active {
            background: #ede9fe !important;
            border: 2px solid #7c3aed !important;
            box-shadow: 0 0 12px rgba(124,58,237,0.25) !important;
        }

        [data-theme="light"] .cab2-thumb--risk {
            border-right: 3px solid #d97706;
        }

        [data-theme="light"] .cab2-thumb--conflict {
            border-right: 3px solid #dc2626;
        }

        [data-theme="light"] .cab2-thumb-num {
            color: #7c3aed;
        }

        [data-theme="light"] .cab2-thumb--active .cab2-thumb-num {
            color: #5b21b6;
        }

        [data-theme="light"] .cab2-thumb-name {
            color: #4a5568;
        }

        [data-theme="light"] .cab2-thumb--active .cab2-thumb-name {
            color: #374151;
        }

        [data-theme="light"] .cd-cab-thumb-date {
            color: #718096;
        }

        [data-theme="light"] .cab2-thumb--drag-over {
            border: 2px dashed #7c3aed !important;
            background: rgba(124,58,237,0.08) !important;
        }

        /* ---- CAB2 - RESET ORDER BTN ---- */
        [data-theme="light"] .cab2-reset-order-btn {
            background: rgba(220,38,38,0.08);
            border: 1px solid rgba(220,38,38,0.25);
            color: #dc2626;
        }

        [data-theme="light"] .cab2-reset-order-btn:hover {
            background: rgba(220,38,38,0.18);
            border-color: rgba(220,38,38,0.5);
            color: #991b1b;
        }

        /* ---- CAB2 - POPUP ---- */
        [data-theme="light"] .cd-popup {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 20px 60px rgba(26,58,107,0.18);
        }

        [data-theme="light"] .cd-popup-cab2 {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-popup-topbar {
            background: linear-gradient(135deg, #1a3a6b, #2a5298, #3a6fd8);
            border-bottom: 2px solid #1a3a6b;
            border-radius: 12px 12px 0 0;
        }

        [data-theme="light"] .cd-popup-body-cab2 {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-popup-close-cab2 {
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.3);
            color: rgba(255,255,255,0.9);
        }

        [data-theme="light"] .cd-popup-close-cab2:hover {
            background: rgba(239,68,68,0.35);
            border-color: rgba(239,68,68,0.6);
            color: #ffffff;
        }

        [data-theme="light"] .cd-popup-export-cal {
            background: rgba(22,163,74,0.12);
            border: 1px solid rgba(22,163,74,0.3);
            color: #75c392;
        }

        [data-theme="light"] .cd-popup-export-cal:hover {
            background: rgba(22,163,74,0.22);
            border-color: rgba(22,163,74,0.5);
            color: #14532d;
        }

        /* ---- STATUS BADGES - FULL LIGHT FIX ---- */
        [data-theme="light"] .cd-status-green {
            background: #dcfce7;
            color: #166534;
            border: 1px solid #86efac;
        }

        [data-theme="light"] .cd-status-red {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }

        [data-theme="light"] .cd-status-yellow {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fcd34d;
        }

        [data-theme="light"] .cd-status-default {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #cbd5e1;
        }

        /* ---- CAB2 STATUS BADGE IN TOPBAR ---- */
        [data-theme="light"] .cab2-topbar .cd-status-green {
            background: rgba(220,252,231,0.25);
            color: #bbf7d0;
            border-color: rgba(134,239,172,0.4);
        }

        [data-theme="light"] .cab2-topbar .cd-status-red {
            background: rgba(254,226,226,0.25);
            color: #fecaca;
            border-color: rgba(252,165,165,0.4);
        }

        [data-theme="light"] .cab2-topbar .cd-status-yellow {
            background: rgba(254,243,199,0.25);
            color: #fde68a;
            border-color: rgba(252,211,77,0.4);
        }

        [data-theme="light"] .cab2-topbar .cd-status-default {
            background: rgba(241,245,249,0.2);
            color: #e2e8f0;
            border-color: rgba(203,213,225,0.35);
        }

        /* ---- CAB2 STATUS BADGE OUTSIDE TOPBAR ---- */
        [data-theme="light"] .cab2-status-badge.cd-status-green {
            background: #dcfce7;
            color: #166534;
            border: 1px solid #86efac;
        }

        [data-theme="light"] .cab2-status-badge.cd-status-red {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }

        [data-theme="light"] .cab2-status-badge.cd-status-yellow {
            background: #fef3c7;
            color: #92400e;
            border: 1px solid #fcd34d;
        }

        [data-theme="light"] .cab2-status-badge.cd-status-default {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #cbd5e1;
        }

        /* ---- SCROLLBARS - LIGHT ---- */
        [data-theme="light"] .cd-content::-webkit-scrollbar {
            width: 6px;
        }

        [data-theme="light"] .cd-content::-webkit-scrollbar-track {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-content::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 3px;
        }

        [data-theme="light"] .cd-content::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
        }

        [data-theme="light"] .cab2-card-body::-webkit-scrollbar-thumb {
            background: #cbd5e1;
        }

        [data-theme="light"] .cab2-card-body::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
        }

        /* ---- FILTER BAR - LIGHT - COMPLETE ---- */
        [data-theme="light"] .cd-filter-bar {
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
            box-shadow: 0 1px 4px rgba(26,58,107,0.05);
        }

        [data-theme="light"] .cd-filter-label {
            color: #718096;
        }

        [data-theme="light"] .cd-search-wrap > i {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-search-input {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-search-input::placeholder {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-search-input:focus {
            border-color: #7c3aed;
            background: #ffffff;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cd-filter-select {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-filter-select:focus {
            border-color: #7c3aed;
            background: #ffffff;
        }

        [data-theme="light"] .cd-date-input {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #1a2332;
            cursor: pointer;
        }

        [data-theme="light"] .cd-date-input:hover {
            border-color: #7c3aed;
        }

        [data-theme="light"] .cd-date-sep {
            color: #a0aec0;
        }

        [data-theme="light"] .cd-clear-filters-btn {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #4a5568;
        }

        [data-theme="light"] .cd-clear-filters-btn:hover {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #dc2626;
        }

        [data-theme="light"] .cd-cab-range-btn {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            color: #4a5568;
        }

        [data-theme="light"] .cd-cab-range-btn:hover {
            background: #f0f4f8;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        [data-theme="light"] .cd-cab-range-btn.active {
            background: #7c3aed;
            border-color: #7c3aed;
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(124,58,237,0.3);
        }

        [data-theme="light"] .cd-active-filters {
            background: rgba(124,58,237,0.08);
            border: 1px solid rgba(124,58,237,0.2);
            color: #7c3aed;
        }

        /* ---- GENERAL TRANSITIONS ---- */
        [data-theme="light"] .cd-cal-day,
        [data-theme="light"] .cd-week-col,
        [data-theme="light"] .cd-day-card,
        [data-theme="light"] .cd-table-row td,
        [data-theme="light"] .cab2-card,
        [data-theme="light"] .cab2-thumb {
            transition: all 0.2s ease;
        }
        /* ===== TABLE VIEW - ENHANCED ===== */
        .cd-table-view {
            display: flex;
            flex-direction: column;
            gap: 0;
            height: 100%;
        }

        /* ---- TOOLBAR ---- */
        .cd-table-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: #1e1e1e;
            border: 1px solid #2a2a2a;
            border-radius: 10px 10px 0 0;
            border-bottom: none;
            flex-wrap: wrap;
            gap: 8px;
        }

        .cd-table-toolbar-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .cd-table-toolbar-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .cd-table-total-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 20px;
            padding: 4px 12px;
            font-size: 13px;
            font-weight: 600;
            color: #e0e0e0;
        }

        .cd-table-total-badge i { color: #a78bfa; }

        .cd-table-conflict-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.35);
            border-radius: 20px;
            padding: 4px 12px;
            font-size: 12px;
            font-weight: 600;
            color: #f87171;
        }

        .cd-table-risk-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(245,158,11,0.15);
            border: 1px solid rgba(245,158,11,0.35);
            border-radius: 20px;
            padding: 4px 12px;
            font-size: 12px;
            font-weight: 600;
            color: #fbbf24;
        }

        .cd-pagesize-label {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #888;
            white-space: nowrap;
        }

        .cd-pagesize-select {
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
        }

        .cd-pagesize-select:focus {
            outline: none;
            border-color: #7c3aed;
        }

        /* ---- TABLE WRAP ---- */
        .cd-table-wrap {
            overflow-x: auto;
            border: 1px solid #2a2a2a;
            border-top: none;
            border-bottom: none;
            flex: 1;
            overflow: visible !important;
        }

        /* ---- TABLE ---- */
        .cd-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            table-layout: auto;
        }

        /* ---- HEADERS ---- */
        .cd-table thead tr {
            background: #252525;
            position: sticky;
            top: 0;
            z-index: 5;
        }

        .cd-table thead th {
            background: #252525;
            color: #9ca3af;
            padding: 11px 14px;
            text-align: right;
            border-bottom: 2px solid #374151;
            white-space: nowrap;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.3px;
            user-select: none;
        }

        .cd-th-sort {
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
        }

        .cd-th-sort:hover {
            background: #2e2e2e !important;
            color: #e0e0e0;
        }

        .cd-th-active {
            background: #1a1030 !important;
            color: #a78bfa !important;
            border-bottom-color: #7c3aed !important;
        }

        .cd-th-nosort {
            cursor: default;
        }

        .cd-th-rownum {
            width: 40px;
            text-align: center;
            color: #555 !important;
            font-size: 11px !important;
        }

        .cd-sort-icon {
            margin-right: 4px;
            font-size: 10px;
            opacity: 0.4;
            transition: opacity 0.15s;
        }

        .cd-th-sort:hover .cd-sort-icon {
            opacity: 0.8;
        }

        .cd-sort-active {
            opacity: 1 !important;
            color: #a78bfa;
        }

        /* ---- ROWS ---- */
        .cd-table-row {
            cursor: pointer;
            transition: background 0.12s;
            border-bottom: 1px solid #1e1e1e;
        }

        .cd-table-row:hover td {
            background: #1e2433 !important;
        }

        .cd-table-row:nth-child(even) td {
            background: #181818;
        }

        .cd-table-row:nth-child(odd) td {
            background: #141414;
        }

        .cd-table-row td {
            padding: 10px 14px;
            color: #d1d5db;
            vertical-align: middle;
            border-bottom: 1px solid #222;
        }

        .cd-table-row.cd-row-conflict td {
            border-right: 3px solid #ef4444;
        }

        /* ---- CELL TYPES ---- */
        .cd-td-rownum {
            text-align: center;
            color: #555 !important;
            font-size: 11px;
            width: 40px;
        }

        .cd-td-number {
            white-space: nowrap;
            font-weight: 700;
            width:50px;
        }

        .cd-td-num-plain {
            color: #a78bfa;
            font-weight: 700;
        }

        .cd-td-name {
            max-width: 260px;
            font-weight: 500;
            color: #e0e0e0 !important;
        }

        .cd-td-date {
            white-space: nowrap;
            width: 40px;
        }

        .cd-td-system {
            white-space: nowrap;
            width: 120px;
        }

        .cd-td-status {
            width: 30px;
        }

        .cd-td-team {
            white-space: nowrap;
            width: 120px;
        }

        .cd-td-center {
            text-align: center;
        }

        .cd-td-empty {
            color: #444;
            font-size: 12px;
        }

        /* ---- CHIPS ---- */
        .cd-date-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(124,58,237,0.1);
            border: 1px solid rgba(124,58,237,0.2);
            border-radius: 6px;
            padding: 3px 8px;
            font-size: 12px;
            color: #c4b5fd;
            white-space: nowrap;
        }

        .cd-date-chip i { font-size: 10px; opacity: 0.7; }

        .cd-date-chip--end {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.2);
            color: #86efac;
        }

        .cd-system-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(8,145,178,0.1);
            border: 1px solid rgba(8,145,178,0.2);
            border-radius: 6px;
            padding: 3px 8px;
            font-size: 12px;
            color: #67e8f9;
            white-space: nowrap;
        }

        .cd-system-chip i { font-size: 10px; opacity: 0.7; }

        .cd-team-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(251,191,36,0.08);
            border: 1px solid rgba(251,191,36,0.2);
            border-radius: 6px;
            padding: 3px 8px;
            font-size: 12px;
            color: #fde68a;
            white-space: nowrap;
        }

        .cd-team-chip i { font-size: 10px; opacity: 0.7; }

        .cd-link-icon {
            font-size: 9px;
            opacity: 0.6;
            margin-left: 3px;
        }

        /* ---- EMPTY STATE ---- */
        .cd-table-empty {
            text-align: center !important;
            padding: 60px 20px !important;
            color: #555 !important;
            font-size: 15px;
            cursor: default !important;
        }

        .cd-table-empty i {
            font-size: 2rem;
            display: block;
            margin-bottom: 10px;
            color: #444;
        }

        .cd-table-empty span {
            display: block;
        }

        /* ---- PAGINATION ---- */
        .cd-pagination {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: #1e1e1e;
            border: 1px solid #2a2a2a;
            border-top: 2px solid #2a2a2a;
            border-radius: 0 0 10px 10px;
            flex-wrap: wrap;
            gap: 8px;
        }

        .cd-pagination-info {
            font-size: 12px;
            color: #888;
            white-space: nowrap;
        }

        .cd-pagination-btns {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
        }

        .cd-page-btn {
            min-width: 34px;
            height: 34px;
            padding: 0 10px;
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #aaa;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
            white-space: nowrap;
        }

        .cd-page-btn:hover:not(.disabled):not(.cd-page-btn--active) {
            background: #3a3a3a;
            color: #fff;
            border-color: #666;
        }

        .cd-page-btn--active {
            background: #320F5B;
            border-color: #7c3aed;
            color: #fff;
            cursor: default;
            box-shadow: 0 0 8px rgba(124,58,237,0.3);
        }

        .cd-page-btn--nav {
            background: #252525;
            color: #888;
        }

        .cd-page-btn--nav:hover:not(.disabled) {
            background: #3a3a3a;
            color: #fff;
        }

        .cd-page-btn.disabled,
        .cd-page-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
            pointer-events: none;
        }

        .cd-page-ellipsis {
            color: #555;
            font-size: 13px;
            padding: 0 4px;
            display: inline-flex;
            align-items: center;
            height: 34px;
        }

        /* ---- LIGHT MODE - TABLE ---- */
        [data-theme="light"] .cd-table-toolbar {
            background: #ffffff;
            border-color: #e2e8f0;
        }

        [data-theme="light"] .cd-table-total-badge {
            background: #f0f4f8;
            border-color: #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-table-total-badge i { color: #7c3aed; }

        [data-theme="light"] .cd-table-conflict-badge {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #dc2626;
        }

        [data-theme="light"] .cd-table-risk-badge {
            background: #fef3c7;
            border-color: #fcd34d;
            color: #92400e;
        }

        [data-theme="light"] .cd-pagesize-label { color: #718096; }

        [data-theme="light"] .cd-pagesize-select {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-table-wrap {
            border-color: #e2e8f0;
        }

        [data-theme="light"] .cd-table {
            background: #ffffff;
        }

        [data-theme="light"] .cd-table thead tr {
            background: #f0f4f8;
        }

        [data-theme="light"] .cd-table thead th {
            background: #f0f4f8;
            color: #4a5568;
            border-bottom-color: #e2e8f0;
        }

        [data-theme="light"] .cd-th-sort:hover {
            background: #e8edf5 !important;
            color: #1a2332;
        }

        [data-theme="light"] .cd-th-active {
            background: #ede9fe !important;
            color: #7c3aed !important;
            border-bottom-color: #7c3aed !important;
        }

        [data-theme="light"] .cd-sort-active { color: #7c3aed; }

        [data-theme="light"] .cd-table-row:nth-child(even) td {
            background: #f8fafc;
        }

        [data-theme="light"] .cd-table-row:nth-child(odd) td {
            background: #ffffff;
        }

        [data-theme="light"] .cd-table-row:hover td {
            background: #eef2ff !important;
        }

        [data-theme="light"] .cd-table-row td {
            color: #1a2332;
            border-bottom-color: #f0f4f8;
        }

        [data-theme="light"] .cd-table-row.cd-row-conflict td {
            border-right-color: #dc2626;
        }
        [data-theme="light"] .cd-td-num-plain {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-td-name {
            color: #1a2332 !important;
        }

        [data-theme="light"] .cd-td-empty {
            color: #94a3b8;
        }

        /* chips */
        [data-theme="light"] .cd-date-chip {
            background: #f3e8ff;
            border-color: #ddd6fe;
            color: #6d28d9;
        }

        [data-theme="light"] .cd-date-chip--end {
            background: #dcfce7;
            border-color: #86efac;
            color: #166534;
        }

        [data-theme="light"] .cd-system-chip {
            background: #ecfeff;
            border-color: #a5f3fc;
            color: #0e7490;
        }

        [data-theme="light"] .cd-team-chip {
            background: #fef3c7;
            border-color: #fcd34d;
            color: #92400e;
        }

        /* empty state */
        [data-theme="light"] .cd-table-empty {
            color: #94a3b8 !important;
        }

        [data-theme="light"] .cd-table-empty i {
            color: #cbd5e1;
        }

        /* pagination */
        [data-theme="light"] .cd-pagination {
            background: #ffffff;
            border-color: #e2e8f0;
        }

        [data-theme="light"] .cd-pagination-info {
            color: #64748b;
        }

        [data-theme="light"] .cd-page-btn {
            background: #ffffff;
            border-color: #cbd5e1;
            color: #475569;
        }

        [data-theme="light"] .cd-page-btn:hover:not(.disabled):not(.cd-page-btn--active) {
            background: #f8fafc;
            border-color: #94a3b8;
            color: #1e293b;
        }

        [data-theme="light"] .cd-page-btn--active {
            background: #7c3aed;
            border-color: #7c3aed;
            color: #ffffff;
        }

        [data-theme="light"] .cd-page-btn--nav {
            background: #f8fafc;
            color: #64748b;
        }

        [data-theme="light"] .cd-page-ellipsis {
            color: #94a3b8;
        }
        /* ===== COLUMN DRAG & DROP ===== */
        .cd-th-draggable {
            position: relative;
        }

        .cd-th-drag-handle {
            display: inline-flex;
            align-items: center;
            margin-left: 5px;
            color: #555;
            cursor: grab;
            font-size: 10px;
            opacity: 0.5;
            transition: opacity 0.15s;
            vertical-align: middle;
        }

        .cd-th-draggable:hover .cd-th-drag-handle {
            opacity: 1;
            color: #a78bfa;
        }

        .cd-th-dragging {
            opacity: 0.4;
            background: #2a1a4a !important;
        }

        .cd-th-drag-over {
            background: #1a1030 !important;
            border-bottom: 3px solid #7c3aed !important;
            color: #a78bfa !important;
        }

        .cd-col-order-hint {
            font-size: 11px;
            color: #555;
            display: flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }

        .cd-col-order-hint i {
            color: #666;
            font-size: 10px;
        }

        .cd-reset-col-order-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.25);
            border-radius: 6px;
            color: #f87171;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .cd-reset-col-order-btn:hover {
            background: rgba(239,68,68,0.25);
            border-color: rgba(239,68,68,0.5);
            color: #fff;
        }

        /* Light mode */
        [data-theme="light"] .cd-th-drag-handle {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-th-draggable:hover .cd-th-drag-handle {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-th-dragging {
            opacity: 0.4;
            background: #ede9fe !important;
        }

        [data-theme="light"] .cd-th-drag-over {
            background: #f5f3ff !important;
            border-bottom: 3px solid #7c3aed !important;
            color: #7c3aed !important;
        }

        [data-theme="light"] .cd-col-order-hint {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-reset-col-order-btn {
            background: rgba(220,38,38,0.08);
            border-color: rgba(220,38,38,0.2);
            color: #dc2626;
        }

        [data-theme="light"] .cd-reset-col-order-btn:hover {
            background: rgba(220,38,38,0.18);
            color: #991b1b;
        }
        /* ===== COLUMN FILTERS ROW ===== */
        .cd-col-filter-row {
            background: #161616;
            border-bottom: 2px solid #2a2a2a;
            position: sticky;
            top: 41px; /* גובה שורת הכותרות */
            z-index: 4;
        }

        .cd-col-filter-cell {
            padding: 5px 6px;
            border-bottom: 1px solid #222;
            vertical-align: middle;
        }

        .cd-col-filter-row-num {
            text-align: center;
            width: 40px;
        }

        .cd-col-filter-row-icon {
            color: #555;
            font-size: 11px;
        }

        /* ---- WRAP ---- */
        .cd-col-filter-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }

        .cd-col-filter-icon {
            position: absolute;
            right: 7px;
            color: #555;
            font-size: 10px;
            pointer-events: none;
            z-index: 1;
        }

        /* ---- INPUT ---- */
        .cd-col-filter-input {
            width: 100%;
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 5px;
            color: #d1d5db;
            padding: 4px 24px 4px 22px;
            font-size: 11px;
            direction: rtl;
            transition: border-color 0.15s, background 0.15s;
            min-width: 60px;
        }

        .cd-col-filter-input:focus {
            outline: none;
            border-color: #7c3aed;
            background: #1a1030;
            box-shadow: 0 0 0 2px rgba(124,58,237,0.15);
        }

        .cd-col-filter-input::placeholder {
            color: #444;
            font-size: 10px;
        }

        /* input עם ערך פעיל */
        .cd-col-filter-input:not(:placeholder-shown) {
            border-color: #7c3aed;
            background: #1a1030;
            color: #c4b5fd;
        }

        /* ---- SELECT ---- */
        .cd-col-filter-select {
            width: 100%;
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 5px;
            color: #d1d5db;
            padding: 4px 6px;
            font-size: 11px;
            cursor: pointer;
            direction: rtl;
            transition: border-color 0.15s;
            min-width: 60px;
        }

        .cd-col-filter-select:focus {
            outline: none;
            border-color: #7c3aed;
            box-shadow: 0 0 0 2px rgba(124,58,237,0.15);
        }

        /* select עם ערך פעיל */
        .cd-col-filter-select:not([value=""]) {
            border-color: #7c3aed;
            color: #c4b5fd;
        }

        /* ---- CLEAR BUTTON ---- */
        .cd-col-filter-clear {
            position: absolute;
            left: 4px;
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            padding: 2px 4px;
            font-size: 9px;
            display: flex;
            align-items: center;
            border-radius: 3px;
            transition: all 0.15s;
            z-index: 2;
        }

        .cd-col-filter-clear:hover {
            color: #f87171;
            background: rgba(239,68,68,0.15);
        }

        /* ---- CLEAR ALL ---- */
        .cd-col-filter-clear-all {
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.25);
            border-radius: 5px;
            color: #f87171;
            cursor: pointer;
            padding: 4px 6px;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            width: 28px;
            height: 28px;
        }

        .cd-col-filter-clear-all:hover {
            background: rgba(239,68,68,0.25);
            border-color: rgba(239,68,68,0.5);
            color: #fff;
        }

        /* ---- ACTIVE BADGE ---- */
        .cd-col-filter-active-badge {
            font-size: 10px;
            color: #a78bfa;
            font-weight: 600;
            margin-right: 4px;
        }

        /* ---- LIGHT MODE ---- */
        [data-theme="light"] .cd-col-filter-row {
            background: #f0f4f8;
            border-bottom: 2px solid #e2e8f0;
        }

        [data-theme="light"] .cd-col-filter-cell {
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-col-filter-row-icon {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-col-filter-input {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-col-filter-input:focus {
            border-color: #7c3aed;
            background: #faf5ff;
            box-shadow: 0 0 0 2px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cd-col-filter-input::placeholder {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-col-filter-input:not(:placeholder-shown) {
            border-color: #7c3aed;
            background: #faf5ff;
            color: #6d28d9;
        }

        [data-theme="light"] .cd-col-filter-select {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cd-col-filter-select:focus {
            border-color: #7c3aed;
            box-shadow: 0 0 0 2px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cd-col-filter-clear {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-col-filter-clear:hover {
            color: #dc2626;
            background: rgba(220,38,38,0.1);
        }

        [data-theme="light"] .cd-col-filter-clear-all {
            background: rgba(220,38,38,0.08);
            border-color: rgba(220,38,38,0.2);
            color: #dc2626;
        }

        [data-theme="light"] .cd-col-filter-clear-all:hover {
            background: rgba(220,38,38,0.18);
            color: #991b1b;
        }

        [data-theme="light"] .cd-col-filter-active-badge {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-col-filter-icon {
            color: #94a3b8;
        }
        /* ===== COLUMN DATE FILTER ===== */
        .cd-col-filter-date-wrap {
            position: relative;
            display: flex;
            align-items: center;
            min-width: 90px;
        }

        /* שדה תצוגה - נראה כמו כפתור */
        .cd-col-filter-date-display {
            display: flex;
            align-items: center;
            gap: 5px;
            width: 100%;
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 5px;
            padding: 4px 8px;
            cursor: pointer;
            transition: all 0.15s;
            min-height: 28px;
            user-select: none;
            white-space: nowrap;
            overflow: hidden;
        }

        .cd-col-filter-date-display:hover {
            border-color: #7c3aed;
            background: #1a1030;
        }

        /* מצב פעיל - יש ערך */
        .cd-col-filter-date-display--active {
            border-color: #7c3aed !important;
            background: #1a1030 !important;
        }

        .cd-col-filter-date-icon {
            color: #555;
            font-size: 10px;
            flex-shrink: 0;
            transition: color 0.15s;
        }

        .cd-col-filter-date-display:hover .cd-col-filter-date-icon,
        .cd-col-filter-date-display--active .cd-col-filter-date-icon {
            color: #a78bfa;
        }

        .cd-col-filter-date-text {
            font-size: 11px;
            color: #666;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            direction: ltr;
            text-align: center;
        }

        .cd-col-filter-date-display--active .cd-col-filter-date-text {
            color: #c4b5fd;
            font-weight: 600;
        }

        /* כפתור ניקוי תאריך */
        .cd-col-filter-date-clear {
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            padding: 1px 3px;
            font-size: 9px;
            display: flex;
            align-items: center;
            border-radius: 3px;
            transition: all 0.15s;
            flex-shrink: 0;
            margin-right: auto;
        }

        .cd-col-filter-date-clear:hover {
            color: #f87171;
            background: rgba(239,68,68,0.15);
        }

        /* input נסתר מאחורי שדה התצוגה */
        .cd-col-filter-date-input {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0;
            pointer-events: none;
            border: none;
            padding: 0;
            z-index: -1;
        }

        /* ---- LIGHT MODE ---- */
        [data-theme="light"] .cd-col-filter-date-display {
            background: #ffffff;
            border: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cd-col-filter-date-display:hover {
            border-color: #7c3aed;
            background: #faf5ff;
        }

        [data-theme="light"] .cd-col-filter-date-display--active {
            border-color: #7c3aed !important;
            background: #faf5ff !important;
        }

        [data-theme="light"] .cd-col-filter-date-icon {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-col-filter-date-display:hover
            .cd-col-filter-date-icon,
        [data-theme="light"] .cd-col-filter-date-display--active
            .cd-col-filter-date-icon {
            color: #7c3aed;
        }

        [data-theme="light"] .cd-col-filter-date-text {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-col-filter-date-display--active
            .cd-col-filter-date-text {
            color: #6d28d9;
        }

        [data-theme="light"] .cd-col-filter-date-clear {
            color: #94a3b8;
        }

        [data-theme="light"] .cd-col-filter-date-clear:hover {
            color: #dc2626;
            background: rgba(220,38,38,0.1);
        }
        /* ================================================
        CAB DECISIONS - COMPLETE CSS
        תומך ב-Dark Mode (ברירת מחדל) + Light Mode
        ================================================ */

        /* -----------------------------------------------
        1. כפתור החלטה (Decision Button)
        ----------------------------------------------- */
        .cab2-decision-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s ease;
            white-space: nowrap;
            flex-shrink: 0;
            border: 1.5px solid;
            letter-spacing: 0.2px;
            position: relative;
            overflow: hidden;
        }

        /* ripple effect */
        .cab2-decision-btn::after {
            content: '';
            position: absolute;
            inset: 0;
            background: rgba(255,255,255,0.08);
            opacity: 0;
            transition: opacity 0.2s;
            border-radius: inherit;
        }

        .cab2-decision-btn:hover::after {
            opacity: 1;
        }

        /* --- לא הוחלט --- */
        .cab2-decision-btn--undecided {
            background: rgba(124,58,237,0.15);
            border-color: rgba(124,58,237,0.45);
            color: #a78bfa;
            box-shadow: 0 2px 8px rgba(124,58,237,0.15);
        }

        .cab2-decision-btn--undecided:hover {
            background: rgba(124,58,237,0.28);
            border-color: rgba(124,58,237,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(124,58,237,0.3);
        }

        /* --- אושר --- */
        .cab2-decision-btn--approved {
            background: rgba(34,197,94,0.15);
            border-color: rgba(34,197,94,0.45);
            color: #4ade80;
            box-shadow: 0 2px 8px rgba(34,197,94,0.15);
        }

        .cab2-decision-btn--approved:hover {
            background: rgba(34,197,94,0.28);
            border-color: rgba(34,197,94,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(34,197,94,0.3);
        }

        /* --- נדחה --- */
        .cab2-decision-btn--rejected {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.45);
            color: #f87171;
            box-shadow: 0 2px 8px rgba(239,68,68,0.15);
        }

        .cab2-decision-btn--rejected:hover {
            background: rgba(239,68,68,0.28);
            border-color: rgba(239,68,68,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(239,68,68,0.3);
        }

        /* --- נדחה לשבוע הבא --- */
        .cab2-decision-btn--postponed {
            background: rgba(245,158,11,0.15);
            border-color: rgba(245,158,11,0.45);
            color: #fbbf24;
            box-shadow: 0 2px 8px rgba(245,158,11,0.15);
        }

        .cab2-decision-btn--postponed:hover {
            background: rgba(245,158,11,0.28);
            border-color: rgba(245,158,11,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(245,158,11,0.3);
        }

        /* --- נדרש מידע --- */
        .cab2-decision-btn--info_needed {
            background: rgba(59,130,246,0.15);
            border-color: rgba(59,130,246,0.45);
            color: #60a5fa;
            box-shadow: 0 2px 8px rgba(59,130,246,0.15);
        }

        .cab2-decision-btn--info_needed:hover {
            background: rgba(59,130,246,0.28);
            border-color: rgba(59,130,246,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(59,130,246,0.3);
        }

        /* --- כפתור שטופל (decided) --- */
        .cab2-decision-btn--decided {
            position: relative;
        }

        .cab2-decision-btn--decided:hover {
            filter: brightness(1.15);
            transform: translateY(-1px);
        }

        /* -----------------------------------------------
        2. Light Mode - כפתור החלטה
        ----------------------------------------------- */
        [data-theme="light"] .cab2-decision-btn--undecided {
            background: #f5f3ff;
            border-color: #c4b5fd;
            color: #6d28d9;
            box-shadow: 0 2px 6px rgba(124,58,237,0.12);
        }

        [data-theme="light"] .cab2-decision-btn--undecided:hover {
            background: #ede9fe;
            border-color: #7c3aed;
            color: #5b21b6;
            box-shadow: 0 4px 12px rgba(124,58,237,0.2);
        }

        [data-theme="light"] .cab2-decision-btn--approved {
            background: #dcfce7;
            border-color: #86efac;
            color: #166534;
            box-shadow: 0 2px 6px rgba(34,197,94,0.12);
        }

        [data-theme="light"] .cab2-decision-btn--approved:hover {
            background: #bbf7d0;
            border-color: #4ade80;
            color: #14532d;
            box-shadow: 0 4px 12px rgba(34,197,94,0.2);
        }

        [data-theme="light"] .cab2-decision-btn--rejected {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #991b1b;
            box-shadow: 0 2px 6px rgba(239,68,68,0.12);
        }

        [data-theme="light"] .cab2-decision-btn--rejected:hover {
            background: #fecaca;
            border-color: #f87171;
            color: #7f1d1d;
            box-shadow: 0 4px 12px rgba(239,68,68,0.2);
        }

        [data-theme="light"] .cab2-decision-btn--postponed {
            background: #fef3c7;
            border-color: #fcd34d;
            color: #92400e;
            box-shadow: 0 2px 6px rgba(245,158,11,0.12);
        }

        [data-theme="light"] .cab2-decision-btn--postponed:hover {
            background: #fde68a;
            border-color: #f59e0b;
            color: #78350f;
            box-shadow: 0 4px 12px rgba(245,158,11,0.2);
        }

        [data-theme="light"] .cab2-decision-btn--info_needed {
            background: #dbeafe;
            border-color: #93c5fd;
            color: #1e40af;
            box-shadow: 0 2px 6px rgba(59,130,246,0.12);
        }

        [data-theme="light"] .cab2-decision-btn--info_needed:hover {
            background: #bfdbfe;
            border-color: #60a5fa;
            color: #1e3a8a;
            box-shadow: 0 4px 12px rgba(59,130,246,0.2);
        }

        /* -----------------------------------------------
        3. Banner החלטה (Decided Banner)
        ----------------------------------------------- */
        .cab2-decided-banner {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 9px 16px;
            font-size: 13px;
            font-weight: 600;
            flex-shrink: 0;
            flex-wrap: wrap;
            border-bottom: 1px solid;
            animation: cdSlideDown 0.3s ease;
        }

        @keyframes cdSlideDown {
            from {
                opacity: 0;
                transform: translateY(-8px);
                max-height: 0;
            }
            to {
                opacity: 1;
                transform: translateY(0);
                max-height: 60px;
            }
        }

        .cab2-decided-banner i {
            font-size: 15px;
            flex-shrink: 0;
        }

        /* --- approved --- */
        .cab2-decided-banner--approved {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.25);
            color: #4ade80;
        }

        /* --- rejected --- */
        .cab2-decided-banner--rejected {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #f87171;
        }

        /* --- postponed --- */
        .cab2-decided-banner--postponed {
            background: rgba(245,158,11,0.1);
            border-color: rgba(245,158,11,0.25);
            color: #fbbf24;
        }

        /* --- info_needed --- */
        .cab2-decided-banner--info_needed {
            background: rgba(59,130,246,0.1);
            border-color: rgba(59,130,246,0.25);
            color: #60a5fa;
        }

        /* הערות בתוך ה-banner */
        .cab2-decided-notes {
            color: inherit;
            opacity: 0.75;
            font-style: italic;
            font-weight: 400;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px;
        }

        /* כפתור עריכה בתוך ה-banner */
        .cab2-decided-edit {
            margin-right: auto;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 6px;
            color: inherit;
            padding: 4px 10px;
            font-size: 11px;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .cab2-decided-edit:hover {
            background: rgba(255,255,255,0.18);
            border-color: rgba(255,255,255,0.35);
        }

        /* -----------------------------------------------
        4. Light Mode - Banner
        ----------------------------------------------- */
        [data-theme="light"] .cab2-decided-banner--approved {
            background: #f0fdf4;
            border-color: #86efac;
            color: #166534;
        }

        [data-theme="light"] .cab2-decided-banner--rejected {
            background: #fff5f5;
            border-color: #fca5a5;
            color: #991b1b;
        }

        [data-theme="light"] .cab2-decided-banner--postponed {
            background: #fffbeb;
            border-color: #fcd34d;
            color: #92400e;
        }

        [data-theme="light"] .cab2-decided-banner--info_needed {
            background: #eff6ff;
            border-color: #93c5fd;
            color: #1e40af;
        }

        [data-theme="light"] .cab2-decided-edit {
            background: rgba(0,0,0,0.05);
            border-color: rgba(0,0,0,0.12);
            color: inherit;
        }

        [data-theme="light"] .cab2-decided-edit:hover {
            background: rgba(0,0,0,0.1);
            border-color: rgba(0,0,0,0.2);
        }

        /* -----------------------------------------------
        5. כרטיס שטופל - עמעום גוף
        ----------------------------------------------- */
        .cab2-root--decided .cab2-body {
            opacity: 0.72;
            transition: opacity 0.3s ease;
        }

        .cab2-root--decided .cab2-body:hover {
            opacity: 1;
        }

        /* גבול צבעוני לפי סטטוס */
        .cab2-root--decided-approved {
            border-top: 3px solid rgba(34,197,94,0.5);
        }

        .cab2-root--decided-rejected {
            border-top: 3px solid rgba(239,68,68,0.5);
        }

        .cab2-root--decided-postponed {
            border-top: 3px solid rgba(245,158,11,0.5);
        }

        .cab2-root--decided-info_needed {
            border-top: 3px solid rgba(59,130,246,0.5);
        }

        /* -----------------------------------------------
        6. Thumbnails - אינדיקטור החלטה
        ----------------------------------------------- */
        .cab2-thumb--decided {
            position: relative;
        }

        /* נקודת סטטוס */
        .cab2-thumb--decided::after {
            content: '';
            position: absolute;
            top: 5px;
            left: 5px;
            width: 9px;
            height: 9px;
            border-radius: 50%;
            border: 1.5px solid rgba(0,0,0,0.3);
            z-index: 2;
        }

        .cab2-thumb--decided-approved::after {
            background: #22c55e;
            box-shadow: 0 0 6px rgba(34,197,94,0.7);
            border-color: rgba(34,197,94,0.4);
        }

        .cab2-thumb--decided-rejected::after {
            background: #ef4444;
            box-shadow: 0 0 6px rgba(239,68,68,0.7);
            border-color: rgba(239,68,68,0.4);
        }

        .cab2-thumb--decided-postponed::after {
            background: #f59e0b;
            box-shadow: 0 0 6px rgba(245,158,11,0.7);
            border-color: rgba(245,158,11,0.4);
        }

        .cab2-thumb--decided-info_needed::after {
            background: #3b82f6;
            box-shadow: 0 0 6px rgba(59,130,246,0.7);
            border-color: rgba(59,130,246,0.4);
        }

        /* עמעום קל לתמונות ממוזערות שטופלו */
        .cab2-thumb--decided:not(.cab2-thumb--active) {
            opacity: 0.75;
        }

        .cab2-thumb--decided:not(.cab2-thumb--active):hover {
            opacity: 1;
        }

        /* -----------------------------------------------
        7. Light Mode - Thumbnails
        ----------------------------------------------- */
        [data-theme="light"] .cab2-thumb--decided::after {
            border-color: rgba(255,255,255,0.6);
        }

        [data-theme="light"] .cab2-thumb--decided-approved::after {
            background: #16a34a;
            box-shadow: 0 0 5px rgba(22,163,74,0.5);
        }

        [data-theme="light"] .cab2-thumb--decided-rejected::after {
            background: #dc2626;
            box-shadow: 0 0 5px rgba(220,38,38,0.5);
        }

        [data-theme="light"] .cab2-thumb--decided-postponed::after {
            background: #d97706;
            box-shadow: 0 0 5px rgba(217,119,6,0.5);
        }

        [data-theme="light"] .cab2-thumb--decided-info_needed::after {
            background: #2563eb;
            box-shadow: 0 0 5px rgba(37,99,235,0.5);
        }

        /* -----------------------------------------------
        8. מודל החלטה (Decision Modal)
        ----------------------------------------------- */

        /* Overlay */
        .cab2-decision-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.72);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            direction: rtl;
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            animation: cdFadeInOverlay 0.2s ease;
        }

        @keyframes cdFadeInOverlay {
            from { opacity: 0; }
            to   { opacity: 1; }
        }

        /* Container */
        .cab2-decision-modal {
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 16px;
            width: 92%;
            max-width: 520px;
            box-shadow:
                0 25px 60px rgba(0,0,0,0.6),
                0 0 0 1px rgba(255,255,255,0.04);
            overflow: hidden;
            animation: cdPopupIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
            direction: rtl;
        }

        @keyframes cdPopupIn {
            from {
                opacity: 0;
                transform: scale(0.92) translateY(10px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        /* כותרת מודל */
        .cab2-decision-modal-header {
            background: linear-gradient(135deg, #1a1030, #320F5B, #4c1d95);
            padding: 18px 22px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
        }

        .cab2-decision-modal-header-left {
            display: flex;
            align-items: center;
            gap: 12px;
            flex: 1;
            min-width: 0;
        }

        .cab2-decision-modal-icon {
            width: 42px;
            height: 42px;
            background: rgba(167,139,250,0.18);
            border: 1px solid rgba(167,139,250,0.35);
            border-radius: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            flex-shrink: 0;
        }

        .cab2-decision-modal-title {
            font-size: 1rem;
            font-weight: 800;
            color: #fff;
            margin: 0;
            line-height: 1.2;
        }

        .cab2-decision-modal-subtitle {
            font-size: 0.75rem;
            color: rgba(255,255,255,0.6);
            margin-top: 3px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 340px;
        }

        .cab2-decision-modal-close {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: rgba(255,255,255,0.8);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .cab2-decision-modal-close:hover {
            background: rgba(239,68,68,0.3);
            border-color: rgba(239,68,68,0.5);
            color: #fff;
            transform: rotate(90deg);
        }

        /* גוף מודל */
        .cab2-decision-modal-body {
            padding: 22px;
            display: flex;
            flex-direction: column;
            gap: 18px;
        }

        /* כותרת סעיף */
        .cab2-decision-section-label {
            font-size: 0.82rem;
            color: #9ca3af;
            font-weight: 700;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .cab2-decision-section-label::before {
            content: '';
            display: inline-block;
            width: 3px;
            height: 12px;
            background: #7c3aed;
            border-radius: 2px;
        }

        /* גריד כפתורי סטטוס */
        .cab2-decision-status-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px;
        }

        /* כפתור סטטוס */
        .cab2-decision-status-btn {
            padding: 11px 14px;
            background: #111827;
            border: 2px solid #374151;
            border-radius: 10px;
            color: #9ca3af;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            text-align: center;
            transition: all 0.2s ease;
            direction: rtl;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            position: relative;
            overflow: hidden;
        }

        .cab2-decision-status-btn[data-status="no_cab"] {
            right: 50%;
        }

        .cab2-decision-status-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            opacity: 0;
            transition: opacity 0.2s;
            background: rgba(255,255,255,0.05);
        }

        .cab2-decision-status-btn:hover::before {
            opacity: 1;
        }

        .cab2-decision-status-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        /* כפתור פעיל */
        .cab2-decision-status-btn--active {
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(0,0,0,0.35);
        }


/* ---- מצב פעיל לפי סטטוס ---- */

/* אושר */
.cab2-decision-status-btn[data-status="approved"].cab2-decision-status-btn--active {
    background: rgba(34,197,94,0.2);
    border-color: #22c55e;
    border-width: 2px;
    color: #4ade80;
    box-shadow:
        0 0 0 3px rgba(34,197,94,0.15),
        0 4px 14px rgba(34,197,94,0.25);
    transform: translateY(-1px);
}

/* נדחה */
.cab2-decision-status-btn[data-status="rejected"].cab2-decision-status-btn--active {
    background: rgba(239,68,68,0.2);
    border-color: #ef4444;
    border-width: 2px;
    color: #f87171;
    box-shadow:
        0 0 0 3px rgba(239,68,68,0.15),
        0 4px 14px rgba(239,68,68,0.25);
    transform: translateY(-1px);
}

/* נדחה לשבוע הבא */
.cab2-decision-status-btn[data-status="postponed"].cab2-decision-status-btn--active {
    background: rgba(245,158,11,0.2);
    border-color: #f59e0b;
    border-width: 2px;
    color: #fbbf24;
    box-shadow:
        0 0 0 3px rgba(245,158,11,0.15),
        0 4px 14px rgba(245,158,11,0.25);
    transform: translateY(-1px);
}

/* נדרש מידע */
.cab2-decision-status-btn[data-status="info_needed"].cab2-decision-status-btn--active {
    background: rgba(59,130,246,0.2);
    border-color: #3b82f6;
    border-width: 2px;
    color: #60a5fa;
    box-shadow:
        0 0 0 3px rgba(59,130,246,0.15),
        0 4px 14px rgba(59,130,246,0.25);
    transform: translateY(-1px);
}

/* hover על כפתור פעיל - הבהרה קלה */
.cab2-decision-status-btn--active:hover {
    filter: brightness(1.1);
}

/* -----------------------------------------------
   Light Mode
   ----------------------------------------------- */

/* אושר */
[data-theme="light"] .cab2-decision-status-btn[data-status="approved"].cab2-decision-status-btn--active {
    background: #dcfce7;
    border-color: #16a34a;
    color: #166534;
    box-shadow:
        0 0 0 3px rgba(22,163,74,0.12),
        0 4px 12px rgba(22,163,74,0.2);
}

/* נדחה */
[data-theme="light"] .cab2-decision-status-btn[data-status="rejected"].cab2-decision-status-btn--active {
    background: #fee2e2;
    border-color: #dc2626;
    color: #991b1b;
    box-shadow:
        0 0 0 3px rgba(220,38,38,0.12),
        0 4px 12px rgba(220,38,38,0.2);
}

/* נדחה לשבוע הבא */
[data-theme="light"] .cab2-decision-status-btn[data-status="postponed"].cab2-decision-status-btn--active {
    background: #fef3c7;
    border-color: #d97706;
    color: #92400e;
    box-shadow:
        0 0 0 3px rgba(217,119,6,0.12),
        0 4px 12px rgba(217,119,6,0.2);
}

/* נדרש מידע */
[data-theme="light"] .cab2-decision-status-btn[data-status="info_needed"].cab2-decision-status-btn--active {
    background: #dbeafe;
    border-color: #2563eb;
    color: #1e40af;
    box-shadow:
        0 0 0 3px rgba(37,99,235,0.12),
        0 4px 12px rgba(37,99,235,0.2);
}

        /* צבעים לפי סטטוס */
        .cab2-decision-status-btn[data-status="approved"]:hover,
        .cab2-decision-status-btn[data-status="approved"].cab2-decision-status-btn--active {
            background: rgba(34,197,94,0.15);
            border-color: rgba(34,197,94,0.5);
            color: #4ade80;
        }

        .cab2-decision-status-btn[data-status="rejected"]:hover,
        .cab2-decision-status-btn[data-status="rejected"].cab2-decision-status-btn--active {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.5);
            color: #f87171;
        }

        .cab2-decision-status-btn[data-status="postponed"]:hover,
        .cab2-decision-status-btn[data-status="postponed"].cab2-decision-status-btn--active {
            background: rgba(245,158,11,0.15);
            border-color: rgba(245,158,11,0.5);
            color: #fbbf24;
        }

        .cab2-decision-status-btn[data-status="info_needed"]:hover,
        .cab2-decision-status-btn[data-status="info_needed"].cab2-decision-status-btn--active {
            background: rgba(59,130,246,0.15);
            border-color: rgba(59,130,246,0.5);
            color: #60a5fa;
        }

        /* Textarea הערות */
        .cab2-decision-notes-textarea {
            width: 100%;
            min-height: 90px;
            background: #111827;
            border: 1.5px solid #374151;
            border-radius: 9px;
            color: #e0e0e0;
            padding: 10px 13px;
            font-size: 13px;
            resize: vertical;
            direction: rtl;
            font-family: inherit;
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s;
            line-height: 1.6;
        }

        .cab2-decision-notes-textarea:focus {
            outline: none;
            border-color: #7c3aed;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
            background: #0f172a;
        }

        .cab2-decision-notes-textarea::placeholder {
            color: #4b5563;
            font-size: 12px;
        }

        /* פוטר מודל */
        .cab2-decision-modal-footer {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            align-items: center;
            padding-top: 4px;
        }

        /* כפתור ביטול */
        .cab2-decision-cancel-btn {
            padding: 9px 18px;
            background: #374151;
            border: 1px solid #4b5563;
            border-radius: 8px;
            color: #9ca3af;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .cab2-decision-cancel-btn:hover {
            background: #4b5563;
            color: #fff;
            border-color: #6b7280;
        }

        /* כפתור שמירה */
        .cab2-decision-save-btn {
            padding: 9px 22px;
            background: linear-gradient(135deg, #320F5B, #7c3aed);
            border: 1px solid #7c3aed;
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 7px;
            transition: all 0.2s;
            box-shadow: 0 2px 10px rgba(124,58,237,0.3);
            position: relative;
            overflow: hidden;
        }

        .cab2-decision-save-btn::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(
                135deg,
                rgba(255,255,255,0.1),
                transparent
            );
            opacity: 0;
            transition: opacity 0.2s;
        }

        .cab2-decision-save-btn:hover::before {
            opacity: 1;
        }

        .cab2-decision-save-btn:hover {
            background: linear-gradient(135deg, #4a1a8c, #8b5cf6);
            transform: translateY(-1px);
            box-shadow: 0 4px 16px rgba(124,58,237,0.45);
        }

        /* מצב disabled */
        .cab2-decision-save-btn:disabled,
        .cab2-decision-save-btn[disabled] {
            opacity: 0.4;
            pointer-events: none;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        /* -----------------------------------------------
        9. Light Mode - מודל החלטה
        ----------------------------------------------- */
        [data-theme="light"] .cab2-decision-modal {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow:
                0 25px 60px rgba(26,58,107,0.18),
                0 0 0 1px rgba(0,0,0,0.04);
        }

        [data-theme="light"] .cab2-decision-modal-body {
            background: #ffffff;
        }

        [data-theme="light"] .cab2-decision-section-label {
            color: #64748b;
        }

        [data-theme="light"] .cab2-decision-status-btn {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #4a5568;
        }

        [data-theme="light"] .cab2-decision-status-btn:hover {
            border-color: #cbd5e1;
            background: #f0f4f8;
            color: #1a2332;
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="approved"]:hover,
        [data-theme="light"] .cab2-decision-status-btn[data-status="approved"].cab2-decision-status-btn--active {
            background: #dcfce7;
            border-color: #86efac;
            color: #166534;
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="rejected"]:hover,
        [data-theme="light"] .cab2-decision-status-btn[data-status="rejected"].cab2-decision-status-btn--active {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #991b1b;
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="postponed"]:hover,
        [data-theme="light"] .cab2-decision-status-btn[data-status="postponed"].cab2-decision-status-btn--active {
            background: #fef3c7;
            border-color: #fcd34d;
            color: #92400e;
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="info_needed"]:hover,
        [data-theme="light"] .cab2-decision-status-btn[data-status="info_needed"].cab2-decision-status-btn--active {
            background: #dbeafe;
            border-color: #93c5fd;
            color: #1e40af;
        }

        [data-theme="light"] .cab2-decision-notes-textarea {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cab2-decision-notes-textarea:focus {
            border-color: #7c3aed;
            background: #faf5ff;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cab2-decision-notes-textarea::placeholder {
            color: #94a3b8;
        }

        [data-theme="light"] .cab2-decision-cancel-btn {
            background: #f1f5f9;
            border-color: #e2e8f0;
            color: #64748b;
        }

        [data-theme="light"] .cab2-decision-cancel-btn:hover {
            background: #e2e8f0;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        [data-theme="light"] .cab2-decision-save-btn {
            background: linear-gradient(135deg, #5b21b6, #7c3aed);
            border-color: #7c3aed;
            box-shadow: 0 2px 10px rgba(124,58,237,0.25);
        }

        [data-theme="light"] .cab2-decision-save-btn:hover {
            background: linear-gradient(135deg, #6d28d9, #8b5cf6);
            box-shadow: 0 4px 16px rgba(124,58,237,0.35);
        }

        /* -----------------------------------------------
        10. אינדיקטור שמירת החלטה (Toast)
        ----------------------------------------------- */
        .cab2-decision-toast {
            position: fixed;
            bottom: 90px;
            left: 50%;
            transform: translateX(-50%) translateY(0);
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 10px;
            padding: 11px 20px;
            display: flex;
            align-items: center;
            gap: 9px;
            z-index: 99999;
            box-shadow:
                0 8px 24px rgba(0,0,0,0.45),
                0 0 0 1px rgba(255,255,255,0.04);
            white-space: nowrap;
            direction: rtl;
            font-size: 13px;
            font-weight: 700;
            animation: cdToastIn 0.3s cubic-bezier(0.34,1.56,0.64,1);
            pointer-events: none;
        }

        @keyframes cdToastIn {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(16px) scale(0.92);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0) scale(1);
            }
        }

        /* צבע גבול ימני לפי סטטוס */
        .cab2-decision-toast--approved {
            border-right: 3px solid #22c55e;
            color: #4ade80;
        }

        .cab2-decision-toast--rejected {
            border-right: 3px solid #ef4444;
            color: #f87171;
        }

        .cab2-decision-toast--postponed {
            border-right: 3px solid #f59e0b;
            color: #fbbf24;
        }

        .cab2-decision-toast--info_needed {
            border-right: 3px solid #3b82f6;
            color: #60a5fa;
        }

        .cab2-decision-toast i {
            font-size: 15px;
            flex-shrink: 0;
        }

        /* Light Mode - Toast */
        [data-theme="light"] .cab2-decision-toast {
            background: #ffffff;
            border-color: #e2e8f0;
            box-shadow:
                0 8px 24px rgba(26,58,107,0.15),
                0 0 0 1px rgba(0,0,0,0.04);
        }

        [data-theme="light"] .cab2-decision-toast--approved {
            border-right-color: #16a34a;
            color: #166534;
        }

        [data-theme="light"] .cab2-decision-toast--rejected {
            border-right-color: #dc2626;
            color: #991b1b;
        }

        [data-theme="light"] .cab2-decision-toast--postponed {
            border-right-color: #d97706;
            color: #92400e;
        }

        [data-theme="light"] .cab2-decision-toast--info_needed {
            border-right-color: #2563eb;
            color: #1e40af;
        }

        /* -----------------------------------------------
        11. סיכום CAB - טבלה ושורות
        ----------------------------------------------- */
        .cab2-summary-root {
            display: flex;
            flex-direction: column;
            gap: 0;
            background: #111827;
            border-radius: 10px;
            overflow: hidden;
            direction: rtl;
            height: calc(100vh - 120px);
        }

        /* כותרת */
        .cab2-summary-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 20px;
            background: linear-gradient(135deg, #1a1030, #320F5B, #4c1d95);
            border-bottom: 2px solid #4c1d95;
            flex-shrink: 0;
            flex-wrap: wrap;
            gap: 10px;
        }

        .cab2-summary-header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .cab2-summary-header-icon {
            font-size: 1.8rem;
            line-height: 1;
        }

        .cab2-summary-header-title {
            font-size: 1.1rem;
            font-weight: 800;
            color: #fff;
            line-height: 1.2;
        }

        .cab2-summary-header-week {
            font-size: 0.78rem;
            color: rgba(255,255,255,0.6);
            margin-top: 3px;
            font-weight: 500;
        }

        .cab2-summary-header-left {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }

        /* כפתורי כותרת */
        .cab2-summary-back-btn,
        .cab2-summary-print-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid;
            white-space: nowrap;
        }

        .cab2-summary-export-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid;
            white-space: nowrap;
            background: rgba(34,197,94,0.15);
            border-color: rgba(34,197,94,0.35);
            color: #4ade80;
        }

        .cab2-summary-export-btn:hover {
            background: rgba(34,197,94,0.28);
            border-color: rgba(34,197,94,0.6);
            color: #fff;
            transform: translateY(-1px);
        }

        [data-theme="light"] .cab2-summary-export-btn {
            background: #dcfce7;
            border-color: #86efac;
            color: #166534;
        }

        [data-theme="light"] .cab2-summary-export-btn:hover {
            background: #bbf7d0;
            border-color: #4ade80;
            color: #14532d;
        }
        .cab2-summary-back-btn {
            background: rgba(255,255,255,0.1);
            border-color: rgba(255,255,255,0.2);
            color: #fff;
        }

        .cab2-summary-back-btn:hover {
            background: rgba(255,255,255,0.2);
            border-color: rgba(255,255,255,0.35);
            transform: translateY(-1px);
        }

        .cab2-summary-print-btn {
            background: rgba(34,197,94,0.15);
            border-color: rgba(34,197,94,0.35);
            color: #4ade80;
        }

        .cab2-summary-print-btn:hover {
            background: rgba(34,197,94,0.28);
            border-color: rgba(34,197,94,0.6);
            color: #fff;
            transform: translateY(-1px);
        }

        /* סטטיסטיקות */
        .cab2-summary-stats {
            display: flex;
            gap: 8px;
            padding: 12px 16px;
            background: #1f2937;
            border-bottom: 1px solid #374151;
            flex-shrink: 0;
            flex-wrap: wrap;
        }

        .cab2-summary-stat-card {
            flex: 1;
            min-width: 80px;
            padding: 10px 14px;
            border-radius: 10px;
            text-align: center;
            border: 1px solid;
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: default;
        }

        .cab2-summary-stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        .cab2-summary-stat-val {
            font-size: 1.7rem;
            font-weight: 800;
            line-height: 1;
            display: block;
        }

        .cab2-summary-stat-lbl {
            font-size: 11px;
            font-weight: 600;
            opacity: 0.8;
            display: block;
            margin-top: 4px;
            white-space: nowrap;
        }

        .cab2-summary-stat-card--total {
            background: rgba(124,58,237,0.12);
            border-color: rgba(124,58,237,0.3);
            color: #a78bfa;
        }

        .cab2-summary-stat-card--approved {
            background: rgba(34,197,94,0.12);
            border-color: rgba(34,197,94,0.3);
            color: #4ade80;
        }

        .cab2-summary-stat-card--rejected {
            background: rgba(239,68,68,0.12);
            border-color: rgba(239,68,68,0.3);
            color: #f87171;
        }

        .cab2-summary-stat-card--postponed {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.3);
            color: #fbbf24;
        }

        .cab2-summary-stat-card--info {
            background: rgba(59,130,246,0.12);
            border-color: rgba(59,130,246,0.3);
            color: #60a5fa;
        }

        .cab2-summary-stat-card--undecided {
            background: rgba(107,114,128,0.12);
            border-color: rgba(107,114,128,0.3);
            color: #9ca3af;
        }

        /* פס התקדמות */
        .cab2-summary-progress-wrap {
            padding: 10px 16px;
            background: #1f2937;
            border-bottom: 1px solid #374151;
            flex-shrink: 0;
        }

        .cab2-summary-progress-label {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #9ca3af;
            margin-bottom: 7px;
            font-weight: 600;
        }

        .cab2-summary-progress-bar {
            height: 8px;
            background: #374151;
            border-radius: 4px;
            overflow: hidden;
        }

        .cab2-summary-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #7c3aed, #22c55e);
            border-radius: 4px;
            transition: width 0.7s cubic-bezier(0.4,0,0.2,1);
            position: relative;
            overflow: hidden;
        }

        /* shimmer על פס ההתקדמות */
        .cab2-summary-progress-fill::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 60%;
            height: 100%;
            background: linear-gradient(
                90deg,
                transparent,
                rgba(255,255,255,0.25),
                transparent
            );
            animation: cdProgressShimmer 2s infinite;
        }

        @keyframes cdProgressShimmer {
            from { left: -60%; }
            to   { left: 120%; }
        }

        /* קבוצות */
        .cab2-summary-groups {
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            scrollbar-width: thin;
            scrollbar-color: #374151 transparent;
        }

        .cab2-summary-groups::-webkit-scrollbar {
            width: 5px;
        }

        .cab2-summary-groups::-webkit-scrollbar-thumb {
            background: #374151;
            border-radius: 3px;
        }

        .cab2-summary-group {
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 10px;
            overflow: hidden;
            transition: box-shadow 0.2s;
        }

        .cab2-summary-group:hover {
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }

        .cab2-summary-group-header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 16px;
            background: #111827;
            border-bottom: 1px solid #374151;
            border-right: 3px solid;
        }

        .cab2-summary-group-label {
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 0.2px;
        }

        .cab2-summary-group-count {
            padding: 2px 10px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 800;
            margin-right: auto;
        }

        /* טבלת סיכום */
        .cab2-summary-table-wrap {
            overflow-x: auto;
            scrollbar-width: thin;
            scrollbar-color: #374151 transparent;
        }

        .cab2-summary-table-wrap::-webkit-scrollbar {
            height: 4px;
        }

        .cab2-summary-table-wrap::-webkit-scrollbar-thumb {
            background: #374151;
            border-radius: 2px;
        }

        .cab2-summary-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }

        .cab2-summary-table thead th {
            background: #111827;
            color: #6b7280;
            padding: 8px 12px;
            text-align: right;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
            border-bottom: 1px solid #374151;
            letter-spacing: 0.3px;
            text-transform: uppercase;
        }

        .cab2-summary-table tbody tr {
            border-bottom: 1px solid #1f2937;
            transition: background 0.15s;
        }

        .cab2-summary-table tbody tr:last-child {
            border-bottom: none;
        }

        .cab2-summary-table tbody tr:hover {
            background: #1e2433;
        }

        .cab2-summary-table tbody td {
            padding: 9px 12px;
            color: #d1d5db;
            vertical-align: middle;
        }

        /* שורות לפי סטטוס */
        .cab2-summary-row--approved td:first-child {
            border-right: 3px solid rgba(34,197,94,0.5);
        }

        .cab2-summary-row--rejected td:first-child {
            border-right: 3px solid rgba(239,68,68,0.5);
        }

        .cab2-summary-row--postponed td:first-child {
            border-right: 3px solid rgba(245,158,11,0.5);
        }

        .cab2-summary-row--info_needed td:first-child {
            border-right: 3px solid rgba(59,130,246,0.5);
        }

        .cab2-summary-row--undecided {
            opacity: 0.65;
        }

        .cab2-summary-row--undecided td:first-child {
            border-right: 3px solid rgba(107,114,128,0.4);
        }

        /* תאים ספציפיים */
        .cab2-summary-td-num {
            white-space: nowrap;
            font-weight: 700;
            width: 100px;
        }

        .cab2-summary-link {
            color: #a78bfa;
            text-decoration: none;
            font-weight: 700;
            transition: color 0.15s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .cab2-summary-link:hover {
            color: #c4b5fd;
            text-decoration: underline;
        }

        .cab2-summary-td-name {
            max-width: 220px;
            font-weight: 500;
        }

        .cab2-summary-td-system {
            white-space: nowrap;
        }

        .cab2-summary-td-presenter {
            white-space: nowrap;
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .cab2-summary-td-status {
            white-space: nowrap;
        }

        .cab2-summary-td-notes {
            max-width: 200px;
        }

        .cab2-summary-td-time {
            white-space: nowrap;
            text-align: center;
        }

        .cab2-summary-td-actions {
            text-align: center;
            width: 50px;
        }

        /* chips בטבלה */
        .cab2-summary-system-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            background: rgba(8,145,178,0.1);
            border: 1px solid rgba(8,145,178,0.25);
            border-radius: 5px;
            padding: 2px 8px;
            font-size: 11px;
            color: #67e8f9;
            white-space: nowrap;
            font-weight: 600;
        }

        .cab2-summary-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 9px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
        }

        .cab2-summary-notes-text {
            font-size: 12px;
            color: #9ca3af;
            font-style: italic;
            max-width: 500px;
            display: block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .cab2-summary-time {
            font-size: 11px;
            color: #6b7280;
            white-space: nowrap;
            font-weight: 600;
            font-variant-numeric: tabular-nums;
        }

        .cab2-summary-empty {
            color: #4b5563;
            font-size: 12px;
        }

        /* כפתור עריכה */
        .cab2-summary-edit-btn {
            background: rgba(124,58,237,0.1);
            border: 1px solid rgba(124,58,237,0.25);
            border-radius: 6px;
            color: #a78bfa;
            cursor: pointer;
            padding: 5px 9px;
            font-size: 11px;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        }

        .cab2-summary-edit-btn:hover {
            background: rgba(124,58,237,0.25);
            border-color: rgba(124,58,237,0.5);
            color: #fff;
            transform: translateY(-1px);
        }

        /* Empty state */
        .cab2-summary-empty-state {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 14px;
            padding: 60px 20px;
            color: #4b5563;
            text-align: center;
        }

        .cab2-summary-empty-state i {
            font-size: 3rem;
            color: #374151;
            opacity: 0.6;
        }

        .cab2-summary-empty-state p {
            margin: 0;
            font-size: 15px;
            font-weight: 500;
        }

        /* -----------------------------------------------
        12. Light Mode - סיכום CAB
        ----------------------------------------------- */
        [data-theme="light"] .cab2-summary-root {
            background: #f0f4f8;
        }

        [data-theme="light"] .cab2-summary-stats {
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cab2-summary-stat-card:hover {
            box-shadow: 0 4px 12px rgba(26,58,107,0.12);
        }

        [data-theme="light"] .cab2-summary-stat-card--total {
            background: #f5f3ff;
            border-color: #ddd6fe;
            color: #6d28d9;
        }

        [data-theme="light"] .cab2-summary-stat-card--approved {
            background: #f0fdf4;
            border-color: #bbf7d0;
            color: #166534;
        }

        [data-theme="light"] .cab2-summary-stat-card--rejected {
            background: #fff5f5;
            border-color: #fecaca;
            color: #991b1b;
        }

        [data-theme="light"] .cab2-summary-stat-card--postponed {
            background: #fffbeb;
            border-color: #fde68a;
            color: #92400e;
        }

        [data-theme="light"] .cab2-summary-stat-card--info {
            background: #eff6ff;
            border-color: #bfdbfe;
            color: #1e40af;
        }

        [data-theme="light"] .cab2-summary-stat-card--undecided {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #64748b;
        }

        [data-theme="light"] .cab2-summary-progress-wrap {
            background: #ffffff;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cab2-summary-progress-label {
            color: #64748b;
        }

        [data-theme="light"] .cab2-summary-progress-bar {
            background: #e2e8f0;
        }

        [data-theme="light"] .cab2-summary-groups {
            scrollbar-color: #cbd5e1 transparent;
        }

        [data-theme="light"] .cab2-summary-groups::-webkit-scrollbar-thumb {
            background: #cbd5e1;
        }

        [data-theme="light"] .cab2-summary-group {
            background: #ffffff;
            border: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cab2-summary-group:hover {
            box-shadow: 0 4px 16px rgba(26,58,107,0.1);
        }

        [data-theme="light"] .cab2-summary-group-header {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cab2-summary-table-wrap::-webkit-scrollbar-thumb {
            background: #cbd5e1;
        }

        [data-theme="light"] .cab2-summary-table {
            background: #ffffff;
        }

        [data-theme="light"] .cab2-summary-table thead th {
            background: #f0f4f8;
            color: #64748b;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cab2-summary-table tbody tr {
            border-bottom: 1px solid #f0f4f8;
        }

        [data-theme="light"] .cab2-summary-table tbody tr:hover {
            background: #f8fafc;
        }

        [data-theme="light"] .cab2-summary-table tbody td {
            color: #1a2332;
        }

        [data-theme="light"] .cab2-summary-row--approved td:first-child {
            border-right-color: #16a34a;
        }

        [data-theme="light"] .cab2-summary-row--rejected td:first-child {
            border-right-color: #dc2626;
        }

        [data-theme="light"] .cab2-summary-row--postponed td:first-child {
            border-right-color: #d97706;
        }

        [data-theme="light"] .cab2-summary-row--info_needed td:first-child {
            border-right-color: #2563eb;
        }

        [data-theme="light"] .cab2-summary-link {
            color: #7c3aed;
        }

        [data-theme="light"] .cab2-summary-link:hover {
            color: #5b21b6;
        }

        [data-theme="light"] .cab2-summary-system-chip {
            background: #ecfeff;
            border-color: #a5f3fc;
            color: #0e7490;
        }

        [data-theme="light"] .cab2-summary-notes-text {
            color: #64748b;
        }

        [data-theme="light"] .cab2-summary-time {
            color: #94a3b8;
        }

        [data-theme="light"] .cab2-summary-empty {
            color: #94a3b8;
        }

        [data-theme="light"] .cab2-summary-edit-btn {
            background: rgba(124,58,237,0.07);
            border-color: rgba(124,58,237,0.2);
            color: #7c3aed;
        }

        [data-theme="light"] .cab2-summary-edit-btn:hover {
            background: rgba(124,58,237,0.15);
            border-color: rgba(124,58,237,0.4);
            color: #5b21b6;
        }

        [data-theme="light"] .cab2-summary-empty-state {
            color: #94a3b8;
        }

        [data-theme="light"] .cab2-summary-empty-state i {
            color: #cbd5e1;
        }

        [data-theme="light"] .cab2-summary-back-btn {
            background: rgba(255,255,255,0.15);
            border-color: rgba(255,255,255,0.3);
        }

        [data-theme="light"] .cab2-summary-print-btn {
            background: #dcfce7;
            border-color: #86efac;
            color: #15803d;
        }

        [data-theme="light"] .cab2-summary-print-btn:hover {
            background: #bbf7d0;
            border-color: #4ade80;
            color: #14532d;
        }

        /* -----------------------------------------------
        13. "כולם טופלו" - All Decided Screen
        ----------------------------------------------- */
        .cab2-all-decided {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 18px;
            padding: 60px 20px;
            text-align: center;
            min-height: 400px;
            background: var(--cab2-bg, #111827);
            border-radius: 10px;
        }

        .cab2-all-decided-icon {
            font-size: 4.5rem;
            animation: cdBounceIn 0.6s cubic-bezier(0.34,1.56,0.64,1);
            line-height: 1;
        }

        @keyframes cdBounceIn {
            0%   { transform: scale(0.3) rotate(-10deg); opacity: 0; }
            60%  { transform: scale(1.15) rotate(3deg); }
            80%  { transform: scale(0.95) rotate(-1deg); }
            100% { transform: scale(1) rotate(0); opacity: 1; }
        }

        .cab2-all-decided h2 {
            font-size: 1.7rem;
            font-weight: 800;
            color: #fff;
            margin: 0;
            animation: cdFadeUp 0.4s ease 0.2s both;
        }

        .cab2-all-decided p {
            color: #9ca3af;
            font-size: 1rem;
            margin: 0;
            animation: cdFadeUp 0.4s ease 0.3s both;
        }

        @keyframes cdFadeUp {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        .cab2-all-decided-stats {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
            margin-top: 6px;
            animation: cdFadeUp 0.4s ease 0.4s both;
        }

        .cab2-all-decided-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 5px;
            padding: 16px 22px;
            border-radius: 14px;
            min-width: 95px;
            border: 1px solid;
            transition: transform 0.2s, box-shadow 0.2s;
            cursor: default;
        }

        .cab2-all-decided-stat:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 18px rgba(0,0,0,0.3);
        }

        .cab2-all-decided-stat-val {
            font-size: 2.2rem;
            font-weight: 800;
            line-height: 1;
        }

        .cab2-all-decided-stat-lbl {
            font-size: 12px;
            font-weight: 600;
            opacity: 0.8;
            white-space: nowrap;
        }

        .cab2-all-decided-stat--approved {
            background: rgba(34,197,94,0.12);
            border-color: rgba(34,197,94,0.3);
            color: #4ade80;
        }

        .cab2-all-decided-stat--rejected {
            background: rgba(239,68,68,0.12);
            border-color: rgba(239,68,68,0.3);
            color: #f87171;
        }

        .cab2-all-decided-stat--postponed {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.3);
            color: #fbbf24;
        }

        .cab2-all-decided-stat--info {
            background: rgba(59,130,246,0.12);
            border-color: rgba(59,130,246,0.3);
            color: #60a5fa;
        }

        /* כפתורי פעולה */
        .cab2-all-decided-actions {
            display: flex;
            gap: 12px;
            margin-top: 6px;
            flex-wrap: wrap;
            justify-content: center;
            animation: cdFadeUp 0.4s ease 0.5s both;
        }

        .cab2-all-decided-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 11px 24px;
            border-radius: 10px;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid;
        }

        .cab2-all-decided-btn--summary {
            background: rgba(124,58,237,0.18);
            border-color: rgba(124,58,237,0.45);
            color: #a78bfa;
            box-shadow: 0 2px 10px rgba(124,58,237,0.2);
        }

        .cab2-all-decided-btn--summary:hover {
            background: rgba(124,58,237,0.32);
            border-color: rgba(124,58,237,0.7);
            color: #fff;
            transform: translateY(-2px);
            box-shadow: 0 6px 18px rgba(124,58,237,0.35);
        }

        .cab2-all-decided-btn--back {
            background: rgba(255,255,255,0.06);
            border-color: rgba(255,255,255,0.14);
            color: #9ca3af;
        }

        .cab2-all-decided-btn--back:hover {
            background: rgba(255,255,255,0.12);
            border-color: rgba(255,255,255,0.25);
            color: #fff;
            transform: translateY(-2px);
        }

        /* -----------------------------------------------
        14. Light Mode - All Decided
        ----------------------------------------------- */
        [data-theme="light"] .cab2-all-decided {
            background: #f0f4f8;
        }

        [data-theme="light"] .cab2-all-decided h2 {
            color: #1a2332;
        }

        [data-theme="light"] .cab2-all-decided p {
            color: #64748b;
        }

        [data-theme="light"] .cab2-all-decided-stat--approved {
            background: #f0fdf4;
            border-color: #bbf7d0;
            color: #166534;
        }

        [data-theme="light"] .cab2-all-decided-stat--rejected {
            background: #fff5f5;
            border-color: #fecaca;
            color: #991b1b;
        }

        [data-theme="light"] .cab2-all-decided-stat--postponed {
            background: #fffbeb;
            border-color: #fde68a;
            color: #92400e;
        }

        [data-theme="light"] .cab2-all-decided-stat--info {
            background: #eff6ff;
            border-color: #bfdbfe;
            color: #1e40af;
        }

        [data-theme="light"] .cab2-all-decided-stat:hover {
            box-shadow: 0 6px 18px rgba(26,58,107,0.12);
        }

        [data-theme="light"] .cab2-all-decided-btn--summary {
            background: #f5f3ff;
            border-color: #c4b5fd;
            color: #6d28d9;
            box-shadow: 0 2px 8px rgba(124,58,237,0.12);
        }

        [data-theme="light"] .cab2-all-decided-btn--summary:hover {
            background: #ede9fe;
            border-color: #7c3aed;
            color: #5b21b6;
            box-shadow: 0 6px 16px rgba(124,58,237,0.2);
        }

        [data-theme="light"] .cab2-all-decided-btn--back {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #64748b;
        }

        [data-theme="light"] .cab2-all-decided-btn--back:hover {
            background: #f0f4f8;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        /* -----------------------------------------------
        15. כפתור סיכום CAB (Summary Open Button)
        ----------------------------------------------- */
        .cab2-summary-open-btn {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 7px 14px;
            background: rgba(124,58,237,0.14);
            border: 1.5px solid rgba(124,58,237,0.35);
            border-radius: 8px;
            color: #a78bfa;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
            position: relative;
        }

        .cab2-summary-open-btn:hover {
            background: rgba(124,58,237,0.28);
            border-color: rgba(124,58,237,0.6);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(124,58,237,0.3);
        }

        .cab2-summary-open-btn-text {
            display: inline;
        }

        .cab2-summary-open-btn-badge {
            background: #7c3aed;
            color: #fff;
            border-radius: 10px;
            padding: 1px 7px;
            font-size: 10px;
            font-weight: 800;
            line-height: 1.6;
            box-shadow: 0 1px 4px rgba(124,58,237,0.4);
        }

        /* Light Mode */
        [data-theme="light"] .cab2-summary-open-btn {
            background: #f5f3ff;
            border-color: #c4b5fd;
            color: #6d28d9;
        }

        [data-theme="light"] .cab2-summary-open-btn:hover {
            background: #ede9fe;
            border-color: #7c3aed;
            color: #5b21b6;
            box-shadow: 0 4px 12px rgba(124,58,237,0.18);
        }

        [data-theme="light"] .cab2-summary-open-btn-badge {
            background: #7c3aed;
            color: #fff;
        }

        /* -----------------------------------------------
        16. Print Styles
        ----------------------------------------------- */
        @media print {
            .cab2-summary-header-left,
            .cab2-summary-edit-btn,
            .cab2-summary-open-btn,
            .cab2-decision-btn,
            .cab2-nav-btn,
            .cab2-reset-order-btn,
            .cab2-footer {
                display: none !important;
            }

            .cab2-summary-root {
                height: auto !important;
                overflow: visible !important;
                background: #fff !important;
                color: #000 !important;
            }

            .cab2-summary-groups {
                overflow: visible !important;
            }

            .cab2-summary-group {
                break-inside: avoid;
                margin-bottom: 20px;
                border: 1px solid #ccc !important;
                background: #fff !important;
            }

            .cab2-summary-group-header {
                background: #f5f5f5 !important;
                border-bottom: 1px solid #ccc !important;
            }

            .cab2-summary-table thead th {
                background: #f0f0f0 !important;
                color: #333 !important;
                border-bottom: 1px solid #ccc !important;
            }

            .cab2-summary-table tbody td {
                color: #000 !important;
                border-bottom: 1px solid #eee !important;
            }

            .cab2-summary-stat-card {
                border: 1px solid #ccc !important;
                background: #f9f9f9 !important;
                color: #000 !important;
            }

            .cab2-summary-progress-bar {
                background: #e0e0e0 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .cab2-summary-progress-fill {
                background: #7c3aed !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }

            .cab2-summary-status-badge {
                border: 1px solid #ccc !important;
                background: #f5f5f5 !important;
                color: #000 !important;
            }
        }

        /* -----------------------------------------------
        17. Responsive
        ----------------------------------------------- */
        @media (max-width: 768px) {
            .cab2-decision-status-grid {
                grid-template-columns: 1fr;
            }

            .cab2-decision-modal {
                width: 96%;
                max-width: 100%;
                border-radius: 12px 12px 0 0;
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                margin: 0;
                animation: cdSlideUp 0.3s cubic-bezier(0.34,1.56,0.64,1);
            }

            @keyframes cdSlideUp {
                from {
                    opacity: 0;
                    transform: translateY(100%);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            .cab2-summary-stats {
                gap: 6px;
            }

            .cab2-summary-stat-card {
                min-width: 70px;
                padding: 8px 10px;
            }

            .cab2-summary-stat-val {
                font-size: 1.4rem;
            }

            .cab2-all-decided-stats {
                gap: 8px;
            }

            .cab2-all-decided-stat {
                min-width: 80px;
                padding: 12px 16px;
            }

            .cab2-all-decided-stat-val {
                font-size: 1.8rem;
            }

            .cab2-summary-td-notes,
            .cab2-summary-td-presenter {
                display: none;
            }

            .cab2-decision-toast {
                width: 90%;
                justify-content: center;
                text-align: center;
            }
        }

        @media (max-width: 480px) {
            .cab2-all-decided h2 {
                font-size: 1.3rem;
            }

            .cab2-all-decided-btn {
                padding: 9px 18px;
                font-size: 13px;
            }

            .cab2-summary-header {
                padding: 12px 14px;
            }

            .cab2-summary-header-title {
                font-size: 0.95rem;
            }

            .cab2-summary-groups {
                padding: 8px 10px;
            }
        }
        /* -----------------------------------------------
            Decision Modal - Overlay
        ----------------------------------------------- */
        .cab2-decision-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.72);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            direction: rtl;
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
            animation: cdFadeInOverlay 0.2s ease;
        }

        @keyframes cdFadeInOverlay {
            from { opacity: 0; }
            to   { opacity: 1; }
        }

        /* -----------------------------------------------
        Decision Modal - Container
        ----------------------------------------------- */
        .cab2-decision-modal {
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 16px;
            width: 92%;
            max-width: 520px;
            box-shadow:
                0 25px 60px rgba(0,0,0,0.6),
                0 0 0 1px rgba(255,255,255,0.04);
            overflow: hidden;
            animation: cdPopupIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
            direction: rtl;
        }

        @keyframes cdPopupIn {
            from {
                opacity: 0;
                transform: scale(0.92) translateY(10px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        /* -----------------------------------------------
        Decision Modal - Header
        ----------------------------------------------- */
        .cab2-decision-modal-header {
            background: linear-gradient(135deg, #1a1030, #320F5B, #4c1d95);
            padding: 18px 22px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
        }

        .cab2-decision-modal-header-left {
            display: flex;
            align-items: center;
            gap: 12px;
            flex: 1;
            min-width: 0;
        }

        .cab2-decision-modal-icon {
            width: 42px;
            height: 42px;
            background: rgba(167,139,250,0.18);
            border: 1px solid rgba(167,139,250,0.35);
            border-radius: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            flex-shrink: 0;
        }

        .cab2-decision-modal-title {
            font-size: 1rem;
            font-weight: 800;
            color: #fff;
            line-height: 1.2;
        }

        .cab2-decision-modal-subtitle {
            font-size: 0.75rem;
            color: rgba(255,255,255,0.6);
            margin-top: 3px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 340px;
        }

        .cab2-decision-modal-close {
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            color: rgba(255,255,255,0.8);
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }

        .cab2-decision-modal-close:hover {
            background: rgba(239,68,68,0.3);
            border-color: rgba(239,68,68,0.5);
            color: #fff;
            transform: rotate(90deg);
        }

        /* -----------------------------------------------
        Decision Modal - Body
        ----------------------------------------------- */
        .cab2-decision-modal-body {
            padding: 22px;
            display: flex;
            flex-direction: column;
            gap: 18px;
            background: #1f2937;
        }

        .cab2-decision-section-label {
            font-size: 0.82rem;
            color: #9ca3af;
            font-weight: 700;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .cab2-decision-section-label::before {
            content: '';
            display: inline-block;
            width: 3px;
            height: 12px;
            background: #7c3aed;
            border-radius: 2px;
            flex-shrink: 0;
        }

        /* -----------------------------------------------
        Status Grid + Buttons
        ----------------------------------------------- */
        .cab2-decision-status-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px;
        }

        .cab2-decision-status-btn {
            padding: 11px 14px;
            background: #111827;
            border: 2px solid #374151;
            border-radius: 10px;
            color: #9ca3af;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            text-align: center;
            transition: all 0.2s ease;
            direction: rtl;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        }

        /* ביטול ה-✓ המוזר */
        .cab2-decision-status-btn::after,
        .cab2-decision-status-btn::before {
            display: none !important;
            content: none !important;
        }

        .cab2-decision-status-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            border-color: #4b5563;
            color: #e0e0e0;
        }

        /* פעיל לפי סטטוס */
        .cab2-decision-status-btn[data-status="approved"].cab2-decision-status-btn--active {
            background: rgba(34,197,94,0.2);
            border-color: #22c55e;
            color: #4ade80;
            box-shadow: 0 0 0 3px rgba(34,197,94,0.15),
                        0 4px 14px rgba(34,197,94,0.2);
            transform: translateY(-1px);
        }

        .cab2-decision-status-btn[data-status="rejected"].cab2-decision-status-btn--active {
            background: rgba(239,68,68,0.2);
            border-color: #ef4444;
            color: #f87171;
            box-shadow: 0 0 0 3px rgba(239,68,68,0.15),
                        0 4px 14px rgba(239,68,68,0.2);
            transform: translateY(-1px);
        }

        .cab2-decision-status-btn[data-status="postponed"].cab2-decision-status-btn--active {
            background: rgba(245,158,11,0.2);
            border-color: #f59e0b;
            color: #fbbf24;
            box-shadow: 0 0 0 3px rgba(245,158,11,0.15),
                        0 4px 14px rgba(245,158,11,0.2);
            transform: translateY(-1px);
        }

        .cab2-decision-status-btn[data-status="info_needed"].cab2-decision-status-btn--active {
            background: rgba(59,130,246,0.2);
            border-color: #3b82f6;
            color: #60a5fa;
            box-shadow: 0 0 0 3px rgba(59,130,246,0.15),
                        0 4px 14px rgba(59,130,246,0.2);
            transform: translateY(-1px);
        }

        /* -----------------------------------------------
        Textarea
        ----------------------------------------------- */
        .cab2-decision-notes-textarea {
            width: 100%;
            min-height: 90px;
            background: #111827;
            border: 1.5px solid #374151;
            border-radius: 9px;
            color: #e0e0e0;
            padding: 10px 13px;
            font-size: 13px;
            resize: vertical;
            direction: rtl;
            font-family: inherit;
            box-sizing: border-box;
            transition: border-color 0.2s, box-shadow 0.2s;
            line-height: 1.6;
        }

        .cab2-decision-notes-textarea:focus {
            outline: none;
            border-color: #7c3aed;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
            background: #0f172a;
        }

        .cab2-decision-notes-textarea::placeholder {
            color: #4b5563;
            font-size: 12px;
        }

        /* -----------------------------------------------
        Footer Buttons
        ----------------------------------------------- */
        .cab2-decision-modal-footer {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            align-items: center;
        }

        .cab2-decision-cancel-btn {
            padding: 9px 18px;
            background: #374151;
            border: 1px solid #4b5563;
            border-radius: 8px;
            color: #9ca3af;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .cab2-decision-cancel-btn:hover {
            background: #4b5563;
            color: #fff;
            border-color: #6b7280;
        }

        .cab2-decision-save-btn {
            padding: 9px 22px;
            background: linear-gradient(135deg, #320F5B, #7c3aed);
            border: 1px solid #7c3aed;
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 7px;
            transition: all 0.2s;
            box-shadow: 0 2px 10px rgba(124,58,237,0.3);
        }

        .cab2-decision-save-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, #4a1a8c, #8b5cf6);
            transform: translateY(-1px);
            box-shadow: 0 4px 16px rgba(124,58,237,0.45);
        }

        .cab2-decision-save-btn:disabled {
            opacity: 0.4;
            pointer-events: none;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        /* ===============================================
        LIGHT MODE - כל המודל
        =============================================== */
        [data-theme="light"] .cab2-decision-modal {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow:
                0 25px 60px rgba(26,58,107,0.18),
                0 0 0 1px rgba(0,0,0,0.04);
        }

        [data-theme="light"] .cab2-decision-modal-body {
            background: #ffffff;
        }

        [data-theme="light"] .cab2-decision-section-label {
            color: #64748b;
        }

        /* כפתורי סטטוס - light */
        [data-theme="light"] .cab2-decision-status-btn {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #4a5568;
        }

        [data-theme="light"] .cab2-decision-status-btn:hover {
            background: #f0f4f8;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="approved"].cab2-decision-status-btn--active {
            background: #dcfce7;
            border-color: #16a34a;
            color: #166534;
            box-shadow: 0 0 0 3px rgba(22,163,74,0.12),
                        0 4px 12px rgba(22,163,74,0.15);
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="rejected"].cab2-decision-status-btn--active {
            background: #fee2e2;
            border-color: #dc2626;
            color: #991b1b;
            box-shadow: 0 0 0 3px rgba(220,38,38,0.12),
                        0 4px 12px rgba(220,38,38,0.15);
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="postponed"].cab2-decision-status-btn--active {
            background: #fef3c7;
            border-color: #d97706;
            color: #92400e;
            box-shadow: 0 0 0 3px rgba(217,119,6,0.12),
                        0 4px 12px rgba(217,119,6,0.15);
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="info_needed"].cab2-decision-status-btn--active {
            background: #dbeafe;
            border-color: #2563eb;
            color: #1e40af;
            box-shadow: 0 0 0 3px rgba(37,99,235,0.12),
                        0 4px 12px rgba(37,99,235,0.15);
        }

        /* textarea - light */
        [data-theme="light"] .cab2-decision-notes-textarea {
            background: #f8fafc;
            border-color: #e2e8f0;
            color: #1a2332;
        }

        [data-theme="light"] .cab2-decision-notes-textarea:focus {
            border-color: #7c3aed;
            background: #faf5ff;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.1);
        }

        [data-theme="light"] .cab2-decision-notes-textarea::placeholder {
            color: #94a3b8;
        }

        /* כפתורי footer - light */
        [data-theme="light"] .cab2-decision-cancel-btn {
            background: #f1f5f9;
            border-color: #e2e8f0;
            color: #64748b;
        }

        [data-theme="light"] .cab2-decision-cancel-btn:hover {
            background: #e2e8f0;
            border-color: #cbd5e1;
            color: #1a2332;
        }

        [data-theme="light"] .cab2-decision-save-btn {
            background: linear-gradient(135deg, #5b21b6, #7c3aed);
            border-color: #7c3aed;
            box-shadow: 0 2px 10px rgba(124,58,237,0.2);
        }

        [data-theme="light"] .cab2-decision-save-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, #6d28d9, #8b5cf6);
            box-shadow: 0 4px 14px rgba(124,58,237,0.3);
        }
        /* ---- CAB Decision Banner - Meta Info ---- */
        .cab2-decided-banner-meta {
            margin-right: auto;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }

        .cab2-decided-banner-week {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 600;
            opacity: 0.75;
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 6px;
            padding: 2px 8px;
        }

        .cab2-decided-banner-week--current {
            opacity: 1;
            background: rgba(255,255,255,0.12);
            border-color: rgba(255,255,255,0.25);
            color: inherit;
        }

        .cab2-decided-banner-by {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 500;
            opacity: 0.65;
        }

        /* Light mode */
        [data-theme="light"] .cab2-decided-banner-week {
            background: rgba(0,0,0,0.06);
            border-color: rgba(0,0,0,0.12);
        }

        [data-theme="light"] .cab2-decided-banner-week--current {
            background: rgba(0,0,0,0.08);
            border-color: rgba(0,0,0,0.18);
            color: inherit;
        }
        /* ===== CAB DECISIONS HISTORY ===== */
        .cab2-decisions-history-toggle {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            background: rgba(255,255,255,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 6px;
            color: inherit;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: auto;
        }

        .cab2-decisions-history-toggle:hover {
            background: rgba(255,255,255,0.2);
            border-color: rgba(255,255,255,0.35);
        }

        .cab2-history-chevron {
            font-size: 9px;
            transition: transform 0.25s ease;
        }

        /* Panel */
        .cab2-decisions-history-panel {
            background: #111827;
            border-bottom: 1px solid #374151;
            padding: 10px 16px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            animation: cdSlideDown 0.2s ease;
            flex-shrink: 0;
        }

        @keyframes cdSlideDown {
            from { opacity: 0; transform: translateY(-6px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        .cab2-decisions-history-title {
            font-size: 11px;
            font-weight: 700;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
            padding-bottom: 6px;
            border-bottom: 1px solid #1f2937;
        }

        .cab2-decisions-history-count {
            background: #374151;
            color: #9ca3af;
            border-radius: 10px;
            padding: 1px 7px;
            font-size: 10px;
            font-weight: 800;
        }

        /* שורת היסטוריה */
        .cab2-decision-history-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 10px;
            background: #1f2937;
            border: 1px solid #374151;
            border-radius: 7px;
            flex-wrap: wrap;
            transition: background 0.15s;
        }

        .cab2-decision-history-row:hover {
            background: #252f3e;
        }

        .cab2-decision-history-label {
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .cab2-decision-history-notes {
            font-size: 11px;
            color: #9ca3af;
            font-style: italic;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }

        .cab2-decision-history-meta {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            margin-right: auto;
            flex-shrink: 0;
        }

        /* Light Mode */
        [data-theme="light"] .cab2-decisions-history-panel {
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }

        [data-theme="light"] .cab2-decisions-history-title {
            color: #94a3b8;
            border-bottom-color: #e2e8f0;
        }

        [data-theme="light"] .cab2-decisions-history-count {
            background: #e2e8f0;
            color: #64748b;
        }

        [data-theme="light"] .cab2-decision-history-row {
            background: #ffffff;
            border-color: #e2e8f0;
        }

        [data-theme="light"] .cab2-decision-history-row:hover {
            background: #f0f4f8;
        }

        [data-theme="light"] .cab2-decision-history-notes {
            color: #64748b;
        }

        [data-theme="light"] .cab2-decisions-history-toggle {
            background: rgba(0,0,0,0.08);
            border-color: rgba(0,0,0,0.15);
            color: inherit;
        }

        [data-theme="light"] .cab2-decisions-history-toggle:hover {
            background: rgba(0,0,0,0.14);
        }
        /* ---- כפתור רענון בסיכום CAB ---- */
        .cab2-summary-refresh-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid;
            white-space: nowrap;
            background: rgba(59,130,246,0.15);
            border-color: rgba(59,130,246,0.35);
            color: #60a5fa;
        }

        .cab2-summary-refresh-btn:hover:not(:disabled) {
            background: rgba(59,130,246,0.28);
            border-color: rgba(59,130,246,0.6);
            color: #fff;
            transform: translateY(-1px);
        }

        .cab2-summary-refresh-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            pointer-events: none;
        }

        .cab2-summary-refresh-btn i.fa-spin {
            animation: fa-spin 1s infinite linear;
        }

        /* Light mode */
        [data-theme="light"] .cab2-summary-refresh-btn {
            background: #dbeafe;
            border-color: #93c5fd;
            color: #1e40af;
        }

        [data-theme="light"] .cab2-summary-refresh-btn:hover:not(:disabled) {
            background: #bfdbfe;
            border-color: #60a5fa;
            color: #1e3a8a;
        }
        /* ---- אושר טנטטיבית ---- */
        .cab2-decision-btn--approved_tentative {
            background: rgba(59,130,246,0.15);
            border-color: rgba(59,130,246,0.45);
            color: #60a5fa;
            box-shadow: 0 2px 8px rgba(59,130,246,0.15);
        }
        .cab2-decision-btn--approved_tentative:hover {
            background: rgba(59,130,246,0.28);
            border-color: rgba(59,130,246,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(59,130,246,0.3);
        }

        /* ---- יתואם מחדש (אדום כמו נדחה) ---- */
        .cab2-decision-btn--rescheduled {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.45);
            color: #f87171;
            box-shadow: 0 2px 8px rgba(239,68,68,0.15);
        }
        .cab2-decision-btn--rescheduled:hover {
            background: rgba(239,68,68,0.28);
            border-color: rgba(239,68,68,0.7);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(239,68,68,0.3);
        }

        /* ---- Banner ---- */
        .cab2-decided-banner--approved_tentative {
            background: rgba(59,130,246,0.1);
            border-color: rgba(59,130,246,0.25);
            color: #60a5fa;
        }

        .cab2-decided-banner--rescheduled {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #f87171;
        }

        /* ---- Thumbnails ---- */
        .cab2-thumb--decided-approved_tentative::after {
            background: #3b82f6;
            box-shadow: 0 0 6px rgba(59,130,246,0.7);
            border-color: rgba(59,130,246,0.4);
        }
        .cab2-thumb--decided-rescheduled::after {
            background: #ef4444;
            box-shadow: 0 0 6px rgba(239,68,68,0.7);
            border-color: rgba(239,68,68,0.4);
        }

        /* ---- cab2-root border ---- */
        .cab2-root--decided-approved_tentative {
            border-top: 3px solid rgba(59,130,246,0.5);
        }
        .cab2-root--decided-rescheduled {
            border-top: 3px solid rgba(239,68,68,0.5);
        }

        /* ---- סטטיסטיקות סיכום ---- */
        .cab2-summary-stat-card--tentative {
            background: rgba(59,130,246,0.12);
            border-color: rgba(59,130,246,0.3);
            color: #60a5fa;
        }
        .cab2-summary-stat-card--rescheduled {
            background: rgba(239,68,68,0.12);
            border-color: rgba(239,68,68,0.3);
            color: #f87171;
        }

        /* ---- All Decided stats ---- */
        .cab2-all-decided-stat--tentative {
            background: rgba(59,130,246,0.12);
            border-color: rgba(59,130,246,0.3);
            color: #60a5fa;
        }
        .cab2-all-decided-stat--rescheduled {
            background: rgba(239,68,68,0.12);
            border-color: rgba(239,68,68,0.3);
            color: #f87171;
        }

        /* ---- כפתורי סטטוס במודל - active ---- */
        .cab2-decision-status-btn[data-status="approved_tentative"].cab2-decision-status-btn--active {
            background: rgba(59,130,246,0.2);
            border-color: #3b82f6;
            color: #60a5fa;
            box-shadow: 0 0 0 3px rgba(59,130,246,0.15),
                        0 4px 14px rgba(59,130,246,0.2);
            transform: translateY(-1px);
        }
        .cab2-decision-status-btn[data-status="rescheduled"].cab2-decision-status-btn--active {
            background: rgba(239,68,68,0.2);
            border-color: #ef4444;
            color: #f87171;
            box-shadow: 0 0 0 3px rgba(239,68,68,0.15),
                        0 4px 14px rgba(239,68,68,0.2);
            transform: translateY(-1px);
        }

        /* ---- Light Mode ---- */
        [data-theme="light"] .cab2-decision-btn--approved_tentative {
            background: #dbeafe;
            border-color: #93c5fd;
            color: #1e40af;
        }
        [data-theme="light"] .cab2-decision-btn--rescheduled {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #991b1b;
        }
        [data-theme="light"] .cab2-decided-banner--approved_tentative {
            background: #eff6ff;
            border-color: #93c5fd;
            color: #1e40af;
        }
        [data-theme="light"] .cab2-decided-banner--rescheduled {
            background: #fff5f5;
            border-color: #fca5a5;
            color: #991b1b;
        }
        [data-theme="light"] .cab2-summary-stat-card--tentative {
            background: #eff6ff;
            border-color: #bfdbfe;
            color: #1e40af;
        }
        [data-theme="light"] .cab2-summary-stat-card--rescheduled {
            background: #fff5f5;
            border-color: #fecaca;
            color: #991b1b;
        }
        [data-theme="light"] .cab2-all-decided-stat--tentative {
            background: #eff6ff;
            border-color: #bfdbfe;
            color: #1e40af;
        }
        [data-theme="light"] .cab2-all-decided-stat--rescheduled {
            background: #fff5f5;
            border-color: #fecaca;
            color: #991b1b;
        }
        [data-theme="light"] .cab2-decision-status-btn[data-status="approved_tentative"].cab2-decision-status-btn--active {
            background: #dbeafe;
            border-color: #2563eb;
            color: #1e40af;
            box-shadow: 0 0 0 3px rgba(37,99,235,0.12),
                        0 4px 12px rgba(37,99,235,0.15);
        }
        [data-theme="light"] .cab2-decision-status-btn[data-status="rescheduled"].cab2-decision-status-btn--active {
            background: #fee2e2;
            border-color: #dc2626;
            color: #991b1b;
            box-shadow: 0 0 0 3px rgba(220,38,38,0.12),
                        0 4px 12px rgba(220,38,38,0.15);
        }
        /* ---- approved_tentative hover ---- */
        .cab2-decision-status-btn[data-status="approved_tentative"]:hover {
            background: rgba(59,130,246,0.15);
            border-color: rgba(59,130,246,0.5);
            color: #60a5fa;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59,130,246,0.25);
        }

        /* ---- rescheduled hover ---- */
        .cab2-decision-status-btn[data-status="rescheduled"]:hover {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.5);
            color: #f87171;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(239,68,68,0.25);
        }

        /* ---- Light Mode ---- */
        [data-theme="light"] .cab2-decision-status-btn[data-status="approved_tentative"]:hover {
            background: #dbeafe;
            border-color: #93c5fd;
            color: #1e40af;
        }

        [data-theme="light"] .cab2-decision-status-btn[data-status="rescheduled"]:hover {
            background: #fee2e2;
            border-color: #fca5a5;
            color: #991b1b;
        }
        /* ---- כפתור נוכחות בסיכום CAB ---- */
        .cab2-summary-attendance-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid;
            white-space: nowrap;
            background: rgba(124,58,237,0.15);
            border-color: rgba(124,58,237,0.35);
            color: #a78bfa;
        }

        .cab2-summary-attendance-btn:hover {
            background: rgba(124,58,237,0.28);
            border-color: rgba(124,58,237,0.6);
            color: #fff;
            transform: translateY(-1px);
        }

        [data-theme="light"] .cab2-summary-attendance-btn {
            background: #f5f3ff;
            border-color: #c4b5fd;
            color: #6d28d9;
        }

        [data-theme="light"] .cab2-summary-attendance-btn:hover {
            background: #ede9fe;
            border-color: #7c3aed;
            color: #5b21b6;
        }

        /* ===== MULTI-SELECT COLUMN FILTER ===== */
    .cd-multi-select-wrap {
        position: relative;
        min-width: 80px;
    }

    .cd-multi-select-trigger {
        display: flex;
        align-items: center;
        gap: 5px;
        width: 100%;
        background: #1e1e1e;
        border: 1px solid #333;
        border-radius: 5px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.15s;
        min-height: 28px;
        user-select: none;
        white-space: nowrap;
        overflow: hidden;
    }

    .cd-multi-select-trigger:hover {
        border-color: #7c3aed;
        background: #1a1030;
    }

    .cd-multi-select-trigger--active {
        border-color: #7c3aed !important;
        background: #1a1030 !important;
    }

    .cd-multi-select-text {
        font-size: 11px;
        color: #666;
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .cd-multi-select-trigger--active .cd-multi-select-text {
        color: #c4b5fd;
        font-weight: 600;
    }

    .cd-multi-select-count {
        background: #7c3aed;
        color: #fff;
        border-radius: 10px;
        padding: 1px 6px;
        font-size: 9px;
        font-weight: 800;
        flex-shrink: 0;
    }

    .cd-multi-select-arrow {
        font-size: 9px;
        color: #555;
        flex-shrink: 0;
        transition: transform 0.2s;
    }

    .cd-multi-select-arrow--open {
        transform: rotate(180deg);
    }

    .cd-multi-select-dropdown {
        position: absolute;
        top: calc(100% + 3px);
        right: 0;
        min-width: 160px;
        max-width: 240px;
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        z-index: 9999;
        max-height: 220px;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: #374151 transparent;
        direction: rtl;
    }

    .cd-multi-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        cursor: pointer;
        font-size: 12px;
        color: #d1d5db;
        transition: background 0.12s;
        white-space: nowrap;
    }

    .cd-multi-option:hover {
        background: #374151;
        color: #fff;
    }

    .cd-multi-option--selected {
        background: rgba(124,58,237,0.15);
        color: #c4b5fd;
    }

    .cd-multi-option--selected:hover {
        background: rgba(124,58,237,0.25);
    }

    .cd-multi-option--all {
        border-bottom: 1px solid #374151;
        font-weight: 700;
        color: #9ca3af;
    }

    .cd-multi-checkbox {
        width: 16px;
        height: 16px;
        border: 1px solid #4b5563;
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        color: #a78bfa;
        flex-shrink: 0;
        background: #111827;
    }

    .cd-multi-option--selected .cd-multi-checkbox {
        background: #7c3aed;
        border-color: #7c3aed;
        color: #fff;
    }

    /* Light Mode */
    [data-theme="light"] .cd-multi-select-trigger {
        background: #ffffff;
        border-color: #e2e8f0;
    }

    [data-theme="light"] .cd-multi-select-trigger:hover {
        border-color: #7c3aed;
        background: #faf5ff;
    }

    [data-theme="light"] .cd-multi-select-trigger--active {
        border-color: #7c3aed !important;
        background: #faf5ff !important;
    }

    [data-theme="light"] .cd-multi-select-text {
        color: #94a3b8;
    }

    [data-theme="light"] .cd-multi-select-trigger--active .cd-multi-select-text {
        color: #6d28d9;
    }

    [data-theme="light"] .cd-multi-select-dropdown {
        background: #ffffff;
        border-color: #e2e8f0;
        box-shadow: 0 8px 24px rgba(26,58,107,0.15);
    }

    [data-theme="light"] .cd-multi-option {
        color: #1a2332;
    }

    [data-theme="light"] .cd-multi-option:hover {
        background: #f0f4f8;
        color: #1a2332;
    }

    [data-theme="light"] .cd-multi-option--selected {
        background: #f5f3ff;
        color: #6d28d9;
    }

    [data-theme="light"] .cd-multi-option--all {
        border-bottom-color: #e2e8f0;
        color: #64748b;
    }

    [data-theme="light"] .cd-multi-checkbox {
        background: #f8fafc;
        border-color: #cbd5e1;
        color: #7c3aed;
    }

    [data-theme="light"] .cd-multi-option--selected .cd-multi-checkbox {
        background: #7c3aed;
        border-color: #7c3aed;
        color: #fff;
    }
    /* כפתור הכן CAB */
    .cd-prepare-cab-btn {
        padding: 5px 12px;
        background: linear-gradient(135deg, #1D6F42, #27AE60);
        border: 1px solid #1D6F42;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
        white-space: nowrap;
        position: fixed;
        left: 1%
    }

    .cd-prepare-cab-btn:hover {
        background: linear-gradient(135deg, #27AE60, #1D6F42);
        box-shadow: 0 4px 12px rgba(29, 111, 66, 0.4);
        transform: translateY(-1px);
    }

    .cd-prepare-cab-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
    }

    /* Light mode */
    [data-theme="light"] .cd-prepare-cab-btn {
        background: linear-gradient(135deg, #1D6F42, #27AE60);
        border-color: #1D6F42;
        color: #fff;
    }
    /* ===== כפתור התחל CAB ===== */
    .cd-start-cab-btn {
        display: none; /* מוסתר כברירת מחדל */
        align-items: center;
        gap: 7px;
        padding: 7px 16px;
        background: linear-gradient(135deg, #320F5B, #7c3aed);
        border: 1px solid #7c3aed;
        border-radius: 8px;
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
        box-shadow: 0 2px 10px rgba(124,58,237,0.3);
        letter-spacing: 0.3px;
        animation: cdFadeIn 0.3s ease;
    }

    .cd-start-cab-btn:hover {
        background: linear-gradient(135deg, #4a1a8c, #8b5cf6);
        transform: translateY(-1px);
        box-shadow: 0 4px 16px rgba(124,58,237,0.5);
    }

    .cd-start-cab-btn i {
        font-size: 14px;
    }

    /* Light mode */
    [data-theme="light"] .cd-start-cab-btn {
        background: linear-gradient(135deg, #5b21b6, #7c3aed);
        border-color: #7c3aed;
        box-shadow: 0 2px 10px rgba(124,58,237,0.2);
    }

    [data-theme="light"] .cd-start-cab-btn:hover {
        background: linear-gradient(135deg, #6d28d9, #8b5cf6);
        box-shadow: 0 4px 14px rgba(124,58,237,0.35);
    }
    /* ===== TIME DISPLAY - BOLD & CLEAR ===== */
    .cab2-topbar-times {
        /* קיים - הוסף: */
        font-size: 14px !important;
        font-weight: 800 !important;
        background: rgba(124,58,237,0.18) !important;
        border: 1.5px solid rgba(124,58,237,0.45) !important;
        border-radius: 10px !important;
        padding: 6px 14px !important;
        gap: 12px !important;
    }

    .cab2-time-val {
        /* קיים - הוסף: */
        font-size: 15px !important;
        font-weight: 900 !important;
        color: #e0d0ff !important;
        letter-spacing: 0.3px;
    }

    .cab2-time-lbl {
        font-size: 11px !important;
        color: rgba(255,255,255,0.75) !important;
        font-weight: 700 !important;
    }

    /* כרטיס זמן בתחתית עמודת הצוות */
    .cab2-time-card {
        margin-top: auto;
        background: linear-gradient(135deg,
            rgba(124,58,237,0.18),
            rgba(124,58,237,0.08));
        border: 1.5px solid rgba(124,58,237,0.4);
        border-radius: 10px;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    /* שורת זמן - עמודה במקום שורה */
    .cab2-time-card-row {
        display: flex;
        flex-direction: column;      /* ← שינוי מ-row ל-column */
        align-items: flex-start;     /* ← יישור לימין */
        gap: 5px;
        padding: 5px 2px;
    }

    /* עטיפת תווית + נקודה - נשאר שורה */
    .cab2-time-card-label-wrap {
        display: flex;
        align-items: center;
        gap: 7px;
        flex-shrink: 0;
    }

    .cab2-time-card-divider {
        height: 1px;
        background: rgba(124,58,237,0.25);
        margin: 2px 0;
    }

    /* Light mode */
    [data-theme="light"] .cab2-time-card {
        background: linear-gradient(135deg, #f5f3ff, #ede9fe);
        border-color: #c4b5fd;
    }

    [data-theme="light"] .cab2-time-card-val {
        color: #5b21b6;
    }

    [data-theme="light"] .cab2-time-card-divider {
        background: #ddd6fe;
    }
    /* ===== כפתור רענון גלובלי ===== */
    .cd-global-refresh-btn {
        padding: 5px 12px;
        background: rgba(59,130,246,0.15);
        border: 1px solid rgba(59,130,246,0.35);
        border-radius: 6px;
        color: #60a5fa;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: all 0.2s;
        white-space: nowrap;
        position: fixed;
        left: 6%;
    }

    .cd-global-refresh-btn:hover:not(:disabled) {
        background: rgba(59,130,246,0.28);
        border-color: rgba(59,130,246,0.6);
        color: #fff;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(59,130,246,0.25);
    }

    .cd-global-refresh-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        pointer-events: none;
    }

    /* Light mode */
    [data-theme="light"] .cd-global-refresh-btn {
        background: #dbeafe;
        border-color: #93c5fd;
        color: #1e40af;
    }

    [data-theme="light"] .cd-global-refresh-btn:hover:not(:disabled) {
        background: #bfdbfe;
        border-color: #60a5fa;
        color: #1e3a8a;
    }
    /* ===== TIME CARD - כרטיס זמן בולט ===== */
    .cab2-time-card {
        background: linear-gradient(
            160deg,
            rgba(124,58,237,0.14) 0%,
            rgba(124,58,237,0.06) 100%
        );
        border: 1.5px solid rgba(124,58,237,0.35);
        border-radius: 10px;
        padding: 6px 8px;
        display: flex;
        flex-direction: column;
        gap: 0;
        flex-shrink: 0;
    }

    /* כותרת הכרטיס */
    .cab2-time-card-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 700;
        color: #a78bfa;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 8px;
        padding-bottom: 7px;
        border-bottom: 1px solid rgba(124,58,237,0.2);
    }

    .cab2-time-card-header-icon {
        font-size: 15px;
        color: #a78bfa;
    }

    /* נקודת צבע */
    .cab2-time-card-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
        position: relative;
    }

    .cab2-time-card-dot--start {
        background: #22c55e;
        box-shadow: 0 0 6px rgba(34,197,94,0.6);
    }

    .cab2-time-card-dot--end {
        background: #f87171;
        box-shadow: 0 0 6px rgba(248,113,113,0.6);
    }

    /* תווית */
    .cab2-time-card-lbl {
        font-size: 13px;
        font-weight: 700;
        color: #9ca3af;
        white-space: nowrap;
        min-width: 32px;
    }

    /* ערך תאריך */
    .cab2-time-card-val {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 15px;
        font-weight: 800;
        white-space: nowrap;
        border-radius: 7px;
        letter-spacing: 0.2px;
        direction: ltr;
    }

    .cab2-time-card-val i {
        font-size: 8px;
        flex-shrink: 0;
        opacity: 0.85;
    }

    /* קו מחבר בין התחלה לסיום */
    .cab2-time-card-connector {
        display: flex;
        align-items: center;
        padding: 0 4px;
        height: 12px;
    }

    .cab2-time-card-connector-line {
        width: 2px;
        height: 100%;
        background: linear-gradient(
            to bottom,
            rgba(34,197,94,0.5),
            rgba(248,113,113,0.5)
        );
        border-radius: 1px;
        margin-right: 3px;
    }

    /* ===== LIGHT MODE ===== */
    [data-theme="light"] .cab2-time-card {
        background: linear-gradient(
            160deg,
            rgba(124,58,237,0.07) 0%,
            rgba(124,58,237,0.03) 100%
        );
        border-color: rgba(124,58,237,0.25);
    }

    [data-theme="light"] .cab2-time-card-header {
        color: #7c3aed;
        border-bottom-color: rgba(124,58,237,0.15);
    }

    [data-theme="light"] .cab2-time-card-header-icon {
        color: #7c3aed;
    }

    [data-theme="light"] .cab2-time-card-lbl {
        color: #6b7280;
    }

    [data-theme="light"] .cab2-time-card-dot--start {
        box-shadow: 0 0 5px rgba(22,163,74,0.5);
    }

    [data-theme="light"] .cab2-time-card-dot--end {
        box-shadow: 0 0 5px rgba(220,38,38,0.5);
    }

    [data-theme="light"] .cab2-time-card-connector-line {
        background: linear-gradient(
            to bottom,
            rgba(22,163,74,0.4),
            rgba(220,38,38,0.4)
        );
    }
    
    /* ===== CAB History ===== */
    .cab2-decision-history {
        margin-top: 12px;
        border: 1px solid #374151;
        border-radius: 10px;
        background: #111827;
        overflow: hidden;
    }

    .cab2-decision-history-row {
        display: grid;
        grid-template-columns: 80px 90px 1fr 400px;
        gap: 12px;
        align-items: center;

        padding: 10px 12px;
        border-top: 1px solid #374151;

        font-size: 12px;
    }

    .cab2-decision-history-row:first-child {
        border-top: none;
    }

    .cab2-decision-history-row:hover {
        background: rgba(124,58,237,0.08);
    }

    .cab2-decision-history-row span:nth-child(1) {
        font-weight: 700;
        color: #c4b5fd;
    }

    .cab2-decision-history-row span:nth-child(2) {
        color: #9ca3af;
        font-size: 11px;
        text-align: center;
    }

    .cab2-decision-history-row span:nth-child(3) {
        color: #d1d5db;
        word-break: break-word;
    }
    [data-theme="light"] .cab2-decision-history {
        background: #fff;
        border-color: #e2e8f0;
    }

    [data-theme="light"] .cab2-decision-history-row {
        border-color: #e2e8f0;
    }

    [data-theme="light"] .cab2-decision-history-row:hover {
        background: #f8fafc;
    }

    [data-theme="light"] .cab2-decision-history-row span:nth-child(1) {
        color: #6d28d9;
    }

    [data-theme="light"] .cab2-decision-history-row span:nth-child(2) {
        color: #64748b;
    }

    [data-theme="light"] .cab2-decision-history-row span:nth-child(3) {
        color: #374151;
    }
    // *** הוסף בתוך addStyles(), בתוך style.textContent ***

/* ===== ATTACHMENTS PANEL ===== */
.cab2-att-panel {
    display: flex;
    flex-direction: column;
    gap: 0;
    height: 100%;
}

/* ---- כותרת ---- */
.cab2-att-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--cab2-hdr-bg, #111827);
    border-bottom: 1px solid var(--cab2-hdr-bdr, #374151);
    flex-shrink: 0;
}

.cab2-att-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 700;
    color: var(--cab2-accent2, #a78bfa);
}

.cab2-att-count {
    background: #7c3aed;
    color: #fff;
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 800;
}

/* ---- כפתור העלאה ---- */
.cab2-att-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: rgba(124,58,237,0.15);
    border: 1px solid rgba(124,58,237,0.35);
    border-radius: 6px;
    color: #a78bfa;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
}

.cab2-att-upload-btn:hover {
    background: rgba(124,58,237,0.28);
    border-color: rgba(124,58,237,0.6);
    color: #fff;
    transform: translateY(-1px);
}

/* ---- אזור גרירה ---- */
.cab2-att-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 8px;
    margin: 8px;
    border: 2px dashed #374151;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
    font-size: 10px;
    color: #6b7280;
    text-align: center;
    flex-shrink: 0;
    position: relative;
}

.cab2-att-dropzone i {
    font-size: 1.1rem;
    color: #4b5563;
    transition: color 0.2s;
}

.cab2-att-dropzone:hover,
.cab2-att-dropzone--active {
    border-color: #7c3aed;
    background: rgba(124,58,237,0.06);
    color: #a78bfa;
}

.cab2-att-dropzone:hover i,
.cab2-att-dropzone--active i {
    color: #a78bfa;
}

/* input נסתר בתוך dropzone */
.cab2-att-file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
}

/* ---- פס התקדמות ---- */
.cab2-att-progress {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px 10px;
    flex-shrink: 0;
}

.cab2-att-progress-bar {
    height: 4px;
    background: #7c3aed;
    border-radius: 2px;
    width: 0%;
    transition: width 0.3s ease;
}

.cab2-att-progress-text {
    font-size: 10px;
    color: #9ca3af;
    text-align: center;
}

/* ---- רשימת קבצים ---- */
.cab2-att-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scrollbar-width: thin;
    scrollbar-color: #374151 transparent;
}

.cab2-att-list::-webkit-scrollbar { width: 3px; }
.cab2-att-list::-webkit-scrollbar-thumb {
    background: #374151;
    border-radius: 2px;
}

/* ---- פריט קובץ ---- */
.cab2-att-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    background: var(--cab2-surface2, #374151);
    border: 1px solid var(--cab2-border, #374151);
    border-radius: 7px;
    transition: all 0.15s;
}

.cab2-att-item:hover {
    background: #2d3748;
    border-color: #4b5563;
}

.cab2-att-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
    line-height: 1;
}

.cab2-att-info {
    flex: 1;
    min-width: 10px;
}

.cab2-att-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--cab2-text, #f9fafb);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cab2-att-meta {
    display: flex;
    gap: 5px;
    font-size: 10px;
    color: var(--cab2-text3, #9ca3af);
    margin-top: 2px;
}

/* ---- כפתורי פעולה ---- */
.cab2-att-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}

.cab2-att-btn {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    border: 1px solid;
    text-decoration: none;
}

.cab2-att-btn--preview {
    background: rgba(59,130,246,0.12);
    border-color: rgba(59,130,246,0.3);
    color: #60a5fa;
}
.cab2-att-btn--preview:hover {
    background: rgba(59,130,246,0.25);
    color: #fff;
    transform: scale(1.1);
}

.cab2-att-btn--download {
    background: rgba(34,197,94,0.12);
    border-color: rgba(34,197,94,0.3);
    color: #4ade80;
}
.cab2-att-btn--download:hover {
    background: rgba(34,197,94,0.25);
    color: #fff;
    transform: scale(1.1);
}

.cab2-att-btn--delete {
    background: rgba(239,68,68,0.12);
    border-color: rgba(239,68,68,0.3);
    color: #f87171;
}
.cab2-att-btn--delete:hover {
    background: rgba(239,68,68,0.25);
    color: #fff;
    transform: scale(1.1);
}

/* ---- תצוגה מקדימה - תמונה ---- */
.cab2-preview-img-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    overflow: auto;
}

.cab2-preview-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    opacity: 0;
    transition: opacity 0.3s ease;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.cab2-preview-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: #f87171;
    font-size: 14px;
}

.cab2-preview-error i { font-size: 2rem; }

/* ---- תצוגה מקדימה - PDF ---- */
.cab2-preview-pdf-wrap {
    width: 100%;
    height: 100%;
}

.cab2-preview-pdf {
    width: 100%;
    height: 100%;
    min-height: 500px;
    border: none;
}

/* ---- Light Mode ---- */
[data-theme="light"] .cab2-att-dropzone {
    border-color: #e2e8f0;
    color: #94a3b8;
}

[data-theme="light"] .cab2-att-dropzone:hover,
[data-theme="light"] .cab2-att-dropzone--active {
    border-color: #7c3aed;
    background: rgba(124,58,237,0.04);
    color: #7c3aed;
}

[data-theme="light"] .cab2-att-item {
    background: #f8fafc;
    border-color: #e2e8f0;
}

[data-theme="light"] .cab2-att-item:hover {
    background: #f0f4f8;
    border-color: #cbd5e1;
}

[data-theme="light"] .cab2-att-name { color: #1a2332; }
[data-theme="light"] .cab2-att-meta { color: #94a3b8; }

[data-theme="light"] .cab2-att-upload-btn {
    background: #f5f3ff;
    border-color: #c4b5fd;
    color: #6d28d9;
}

[data-theme="light"] .cab2-att-upload-btn:hover {
    background: #ede9fe;
    border-color: #7c3aed;
    color: #5b21b6;
}
/* ---- כפתור הוספה בכותרת הכרטיס ---- */
.cab2-card-hdr {
    display: flex;
    align-items: center;
    gap: 6px;
}

.cab2-att-add-btn {
    margin-right: auto;  /* דחוף לשמאל */
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(124,58,237,0.15);
    border: 1px solid rgba(124,58,237,0.35);
    border-radius: 4px;
    color: #a78bfa;
    font-size: 10px;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
}

.cab2-att-add-btn:hover {
    background: rgba(124,58,237,0.3);
    border-color: rgba(124,58,237,0.6);
    color: #fff;
    transform: scale(1.1);
}

/* ---- הסתרת dropzone ---- */
.cab2-att-dropzone--hidden {
    display: none !important;
}

/* Light mode */
[data-theme="light"] .cab2-att-add-btn {
    background: #f5f3ff;
    border-color: #c4b5fd;
    color: #6d28d9;
}

[data-theme="light"] .cab2-att-add-btn:hover {
    background: #ede9fe;
    border-color: #7c3aed;
    color: #5b21b6;
}
/* ===== NO CAB STATUS ===== */
.cab2-decision-btn--no_cab {
    background: rgba(107,114,128,0.15);
    border-color: rgba(107,114,128,0.45);
    color: #9ca3af;
    box-shadow: 0 2px 8px rgba(107,114,128,0.15);
}

.cab2-decision-btn--no_cab:hover {
    background: rgba(107,114,128,0.28);
    border-color: rgba(107,114,128,0.7);
    color: #fff;
    transform: translateY(-1px);
}

.cab2-decided-banner--no_cab {
    background: rgba(107,114,128,0.1);
    border-color: rgba(107,114,128,0.25);
    color: #9ca3af;
}

.cab2-thumb--decided-no_cab::after {
    background: #6b7280;
    box-shadow: 0 0 6px rgba(107,114,128,0.7);
    border-color: rgba(107,114,128,0.4);
}

.cab2-root--decided-no_cab {
    border-top: 3px solid rgba(107,114,128,0.5);
}

.cab2-decision-status-btn[data-status="no_cab"].cab2-decision-status-btn--active {
    background: rgba(107,114,128,0.2);
    border-color: #6b7280;
    color: #9ca3af;
    box-shadow: 0 0 0 3px rgba(107,114,128,0.15),
                0 4px 14px rgba(107,114,128,0.2);
    transform: translateY(-1px);
}

.cab2-decision-status-btn[data-status="no_cab"]:hover {
    background: rgba(107,114,128,0.15);
    border-color: rgba(107,114,128,0.5);
    color: #d1d5db;
    transform: translateY(-1px);
}

/* Light Mode */
[data-theme="light"] .cab2-decision-btn--no_cab {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #64748b;
}

[data-theme="light"] .cab2-decision-btn--no_cab:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
    color: #1a2332;
}

[data-theme="light"] .cab2-decided-banner--no_cab {
    background: #f8fafc;
    border-color: #e2e8f0;
    color: #64748b;
}

[data-theme="light"] .cab2-decision-status-btn[data-status="no_cab"].cab2-decision-status-btn--active {
    background: #f1f5f9;
    border-color: #64748b;
    color: #374151;
    box-shadow: 0 0 0 3px rgba(100,116,139,0.12),
                0 4px 12px rgba(100,116,139,0.15);
}

[data-theme="light"] .cab2-decision-status-btn[data-status="no_cab"]:hover {
    background: #e2e8f0;
    border-color: #94a3b8;
    color: #1a2332;
}
/* ===== SUMMARY RESET BUTTON ===== */
.cab2-summary-reset-btn {
    background: rgba(107,114,128,0.12);
    border: 1px solid rgba(107,114,128,0.3);
    border-radius: 6px;
    color: #9ca3af;
    cursor: pointer;
    padding: 5px 9px;
    font-size: 11px;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.cab2-summary-reset-btn:hover {
    background: rgba(124,58,237,0.2);
    border-color: rgba(124,58,237,0.5);
    color: #a78bfa;
    transform: translateY(-1px);
}

/* Light Mode */
[data-theme="light"] .cab2-summary-reset-btn {
    background: #f1f5f9;
    border-color: #e2e8f0;
    color: #64748b;
}

[data-theme="light"] .cab2-summary-reset-btn:hover {
    background: #f5f3ff;
    border-color: #c4b5fd;
    color: #7c3aed;
}
            `;
        document.head.appendChild(style);
    }
}