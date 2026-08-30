// file: SystemsCatalogDashboard.js
class SystemsCatalogDashboard {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.allSystems = [];
        this.filteredSystems = [];
        this.searchTerm = '';
        this.filters = {
            name: 'all',
            nameEn: 'all',
            number: 'all',
            status: 'all',
            domain: 'all',
            department: 'all',
            team: 'all',
            businessDivision: 'all',
            appClassification: 'all',
            appType: 'all',
            businessCriticality: 'all',
            availabilityRequirement: 'all',
            environment: 'all',
            publisher: 'all',
            supportVendor: 'all',
            systemManager: 'all',
            hasAutomation: 'all',
            departmentManager: 'all',
            requiresValidation: 'all',
        };
        this.sortColumn = 'number';
        this.sortDirection = 'asc';
        this.currentPage = 1;
        this.pageSize = 50;
        this.LS_COL_ORDER = 'scColOrder_v1';
        this.LS_COL_VISIBLE = 'scColVisible_v1';

        this.visibleColumns = this.getDefaultColumns();
        this.columnOrder = Object.keys(this.visibleColumns);
        this.viewMode = 'table';
        window._scDashboard = null;

        this.LS_FILTERS = 'scFilters_v1';
        this.LS_SORT = 'scSort_v1';
        this.LS_VIEW = 'scView_v1';
        this.LS_PAGE_SIZE = 'scPageSize_v1';

        this._loadPreferences();

        this.isAdmin = false;
        this.isAutomationOnly = false;
        this.currentUser = '';
        // ─── Multi-Select ───
        this.selectedSystems = new Set();
    }

    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container #${this.containerId} not found`);
            return;
        }
        window._scDashboard = this;
        this.addStyles();
        this.renderShell();
        this.bindEvents();
        // ─── בדוק אם יש פילטר ממתין מדשבורד שרתים ───
        this._applyPendingFilter();
        await this._loadCurrentUser();
        await this.loadData();
    }

    // ══════════════════════════════════════════════════════════
    // החל פילטר ממתין (מניווט מדשבורד שרתים)
    // ══════════════════════════════════════════════════════════

    _applyPendingFilter() {
        const urlParams = new URLSearchParams(window.location.search);

        // ─── בדוק פילטר לפי מספר קטלוג (עדיפות ראשונה) ───// תמוך בשני הפרמטרים
        const rawFilterNumber = urlParams.get('filterNumber') ||
            urlParams.get('filterCatalogNumber');
        let filterNumber = rawFilterNumber
            ? decodeURIComponent(rawFilterNumber)
            : null;
        let catalogNumber = filterNumber;

        if (!catalogNumber) {
            try {
                catalogNumber = sessionStorage.getItem('srv_pending_filter_catalogNumber');
                if (catalogNumber) sessionStorage.removeItem('srv_pending_filter_catalogNumber');
            } catch (e) { }
        }

        if (catalogNumber) {
            this.filters.number = String(filterNumber);
            this._savePreferences();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this._restoreFilterSelects();

            setTimeout(() => {
                this.showToast(`🔍 מסנן שרתים לפי מספר קטלוג: ${catalogNumber}`, 'info');
            }, 600);

            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        // ─── fallback: פילטר לפי שם מערכת ───
        let systemName = urlParams.get('filterSystemName')
            ? decodeURIComponent(urlParams.get('filterSystemName'))
            : null;

        if (!systemName) {
            try {
                systemName = sessionStorage.getItem('srv_pending_filter_systemName');
                if (systemName) sessionStorage.removeItem('srv_pending_filter_systemName');
            } catch (e) { }
        }

        if (!systemName) return;

        this.filters.name = systemName;
        this._savePreferences();
        this.applyFiltersAndSort();
        this.renderContent();
        this.updateStats();
        this._restoreFilterSelects();

        setTimeout(() => {
            this.showToast(`🔍 מסנן שרתים לפי מערכת: ${systemName}`, 'info');
        }, 600);

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async _loadCurrentUser() {
        try {
            const res = await fetch('/SystemsCatalog/GetCurrentUser',
                { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                this.isAdmin = data.isAdmin || false;
                this.isAutomationOnly = data.isAutomationOnly || false;
                this.currentUser = data.username || '';
            }
            this._updateAdminUI();
        } catch (err) {
            console.warn('_loadCurrentUser error:', err);
            this.isAdmin = false;
            this.isAutomationOnly = false;
        }
    }

    _updateAdminUI() {
        // ── הסתר/הצג כפתורי Admin ──
        document.querySelectorAll('.sc-admin-only').forEach(el => {
            el.style.display = this.isAdmin ? 'flex' : 'none';
        });

        // ── הצג כפתור עריכה מרובה רק לאדמין ──
        const multiEditBtn = document.getElementById('scMultiEditBtn');
        if (multiEditBtn) {
            multiEditBtn.style.display = this.isAdmin ? 'flex' : 'none';
        }

        const isLoggedIn = this.currentUser &&
            this.currentUser.trim() !== '' &&
            this.currentUser.trim() !== 'מערכת';

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
        // מוסתר כשאין משתמש (הכפתור לוגין יחליף אותו)
        document.querySelectorAll('.user-menu-section .user-info').forEach(el => {
            el.style.display = isLoggedIn ? '' : 'none';
        });

        // ── user-menu-section עצמו - תמיד מוצג ──
        // (כשמחובר - מציג user-info, כשלא - מציג כפתור לוגין)
        const userMenuSection = document.querySelector('.user-menu-section');
        if (userMenuSection) userMenuSection.style.display = '';

        // ── הצג כפתור עריכה גם לעורכי אוטומציה ──
        if (this.isAutomationOnly && !this.isAdmin) {
            document.querySelectorAll('.sc-admin-only').forEach(el => {
                el.style.display = 'none'; // הסתר כפתורי admin
            });
        }

        // ── הצג/הסתר כפתור לוגין ──
        // this._renderLoginButton(isLoggedIn);
    }

    // ── כפתור לוגין - מוצג רק כשאין משתמש מחובר ──
    _renderLoginButton(isLoggedIn) {
        const LOGIN_BTN_ID = 'scLoginBtn';

        // ─── הסר כפתור קיים ───
        const existing = document.getElementById(LOGIN_BTN_ID);
        if (existing) existing.remove();

        // ─── אם מחובר - אין צורך בכפתור ───
        if (isLoggedIn) return;

        const btn = document.createElement('a');
        btn.id = LOGIN_BTN_ID;
        btn.href = '/?returnUrl=' +
            encodeURIComponent(
                window.location.pathname + window.location.search
            );
        btn.className = 'sc-login-btn btn-header-logout';
        btn.innerHTML = `
        <i class="fas fa-sign-in-alt"></i>
        <span>Log In</span>
    `;

        // ─── הכנס לתוך user-menu-section ───
        const userMenuSection = document.querySelector('.user-menu-section');
        if (userMenuSection) {
            // ─── נקה את התוכן הקיים של user-menu-section ───
            // (user-info כבר מוסתר, אבל נוסיף את הכפתור בתוכו)
            userMenuSection.appendChild(btn);
            // ─── ודא שה-section עצמו מוצג ───
            userMenuSection.style.display = '';
            return;
        }

        // ─── fallback: אם אין user-menu-section - הוסף ל-sc-header ───
        const headerRight = document.querySelector('.sc-header-right');
        if (headerRight) {
            headerRight.insertBefore(btn, headerRight.firstChild);
        }
    }

    async loadData() {
        try {
            this.showLoading(true);
            const res = await fetch('/SystemsCatalog/GetSystems',
                { credentials: 'include' });
            const data = await res.json();
            if (!data.success) {
                this.showError(data.error || 'שגיאה בטעינת נתונים');
                return;
            }
            this.allSystems = data.systems || [];
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this.showLoading(false);
        } catch (err) {
            console.error('loadData error:', err);
            this.showLoading(false);
            this.showError('שגיאה בטעינת הנתונים: ' + err.message);
        }
    }

    applyFiltersAndSort() {
        let result = [...this.allSystems];

        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            result = result.filter(s => {
                const num = String(s.number ?? s.Number ?? '').toLowerCase();

                // ─── חיפוש רגיל בשדות המערכת ───
                const matchesSystem =
                    (s.name || '').toLowerCase().includes(term) ||
                    (s.nameEn || '').toLowerCase().includes(term) ||
                    (s.description || '').toLowerCase().includes(term) ||
                    (s.systemManager || '').toLowerCase().includes(term) ||
                    (s.department || '').toLowerCase().includes(term) ||
                    (s.team || '').toLowerCase().includes(term) ||
                    (s.publisher || '').toLowerCase().includes(term) ||
                    (s.supportVendor || '').toLowerCase().includes(term) ||
                    num.includes(term);

                // ─── חיפוש לפי שרתים מקושרים ───
                const matchesServer = this._serverSearchResults &&
                    this._serverSearchResults.has(s.id);

                return matchesSystem || matchesServer;
            });
        }

        const f = this.filters;

        if (f.requiresValidation && f.requiresValidation !== 'all') {

            if (f.requiresValidation === 'נדרש תיקוף') {
                result = result.filter(s => s.requiresValidation === true);
            }

            if (f.requiresValidation === 'לא נדרש תיקוף') {
                result = result.filter(s =>
                    s.requiresValidation === false ||
                    s.requiresValidation === undefined ||
                    s.requiresValidation === null
                );
            }
        }
        const filterField = (arr, filterVal, getFn) => {
            if (filterVal === 'all') return arr;
            if (filterVal === '__empty__')
                return arr.filter(s => {
                    const v = getFn(s);
                    return !v || v.trim() === '';
                });
            return arr.filter(s => getFn(s) === filterVal);
        };

        result = filterField(result, f.number,
            s => String(s.number || ''));
        result = filterField(result, f.name,
            s => s.name || '');
        result = filterField(result, f.nameEn,
            s => s.nameEn || '');
        result = filterField(result, f.status,
            s => s.status || '');
        result = filterField(result, f.domain,
            s => s.domain || '');
        result = filterField(result, f.department,
            s => s.department || '');
        result = filterField(result, f.team,
            s => s.team || '');
        result = filterField(result, f.businessDivision,
            s => s.businessDivision || '');
        result = filterField(result, f.appClassification,
            s => s.appClassification || '');
        result = filterField(result, f.appType,
            s => s.appType || '');
        result = filterField(result, f.businessCriticality,
            s => s.businessCriticality || '');
        result = filterField(result, f.availabilityRequirement,
            s => s.availabilityRequirement || '');
        result = filterField(result, f.environment,
            s => s.environment || '');
        result = filterField(result, f.publisher,
            s => s.publisher || '');
        result = filterField(result, f.supportVendor,
            s => s.supportVendor || '');
        result = filterField(result, f.systemManager,
            s => s.systemManager || '');
        result = filterField(result, f.departmentManager,
            s => s.departmentManager || '');
        if (f.hasAutomation && f.hasAutomation !== 'all') {
            result = result.filter(s =>
                (s.hasAutomation || 'לא קיימות') === f.hasAutomation
            );
        }
        const col = this.sortColumn;
        const dir = this.sortDirection === 'asc' ? 1 : -1;

        result.sort((a, b) => {
            if (col === 'number') {
                return String(a.number).localeCompare(
                    String(b.number),
                    undefined,
                    { numeric: true }
                ) * dir;
            }

            // ─── מיון לפי תאריך ───
            if (col === 'createdAt' || col === 'lastValidatedAt') {
                const parseDate = (str) => {
                    if (!str) return 0;
                    // פורמט: DD/MM/YYYY HH:MM או DD/MM/YYYY
                    const parts = str.trim().split(' ');
                    const dateParts = parts[0].split('/');
                    if (dateParts.length !== 3) return 0;
                    const [day, month, year] = dateParts;
                    const timePart = parts[1] || '00:00';
                    const [hours, minutes] = timePart.split(':');
                    return new Date(
                        parseInt(year),
                        parseInt(month) - 1,
                        parseInt(day),
                        parseInt(hours) || 0,
                        parseInt(minutes) || 0
                    ).getTime();
                };
                return (parseDate(a[col]) - parseDate(b[col])) * dir;
            }

            const av = (a[col] || '').toString().toLowerCase();
            const bv = (b[col] || '').toString().toLowerCase();
            return av.localeCompare(bv, 'he') * dir;
        });

        this.filteredSystems = result;
        this.currentPage = 1;
        this._updateFilterCounter();
    }

    // ══════════════════════════════════════════════════════════
    // חיפוש שרת לפי שם/IP וקישור למערכות
    // ══════════════════════════════════════════════════════════
    async _searchByServer(term) {
        if (!term || term.length < 2) {
            this._serverSearchResults = null;
            this._serverSearchInfo = null;
            return;
        }

        try {
            const res = await fetch(
                `/Servers/SearchServerForCatalog?term=${encodeURIComponent(term)}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            if (!data.success || !data.matchedSystems?.length) {
                this._serverSearchResults = null;
                this._serverSearchInfo = null;
                return;
            }

            // ─── בנה Set של מזהי מערכות שנמצאו ───
            this._serverSearchResults = new Set(data.matchedSystems.map(s => s.systemId));
            this._serverSearchInfo = data;

        } catch (err) {
            console.warn('_searchByServer error:', err);
            this._serverSearchResults = null;
            this._serverSearchInfo = null;
        }
    }

    renderShell() {
        this.container.innerHTML = `
        <div class="sc-root">
            <div class="sc-header">
                <div class="sc-header-left">
                    <div class="sc-search-wrap">
                        <i class="fas fa-search sc-search-icon"></i>
                        <input id="scSearch" class="sc-search-input"
                               type="text"
                               placeholder="חיפוש מערכת, מנהל, מחלקה..."/>
                        <button id="scClearSearch"
                                class="sc-clear-btn" style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <div class="sc-filters-wrap">
                        <div class="sc-filters-toggle-row">
                            <button id="scFiltersToggle"
                                    class="sc-filters-toggle-btn">
                                <i class="fas fa-filter"></i>
                                פילטרים
                                <span id="scFiltersBadge"
                                      class="sc-filters-badge"
                                      style="display:none">0</span>
                                <i class="fas fa-chevron-down sc-filters-chevron"
                                   id="scFiltersChevron"></i>
                            </button>
                            <div id="scActiveFilterTags"
                                 class="sc-active-filter-tags"></div>
                        </div>

                        <div id="scFiltersPopup"
                             class="sc-filters-popup"
                             style="display:none">
                            <div class="sc-filters-popup-header">
                                <span class="sc-filters-popup-title">
                                    <i class="fas fa-filter"></i>
                                    סינון מערכות
                                </span>
                                <button id="scClearFilters"
                                        class="sc-clear-filters-btn">
                                    <i class="fas fa-filter-circle-xmark"></i>
                                    נקה הכל
                                </button>
                            </div>
                            <div class="sc-filters-popup-grid">
                                ${this._buildFilterGroups()}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="sc-header-right">
                    <div class="sc-counter" id="scCounter"></div>
                    <div class="sc-view-btns">
                        <button class="sc-view-btn active"
                                id="scViewTable" title="טבלה">
                            <i class="fas fa-table"></i>
                        </button>
                        <button class="sc-view-btn"
                                id="scViewCards" title="כרטיסים">
                            <i class="fas fa-th-large"></i>
                        </button>
                        <button class="sc-view-btn"
                                id="scViewStats" title="סטטיסטיקות">
                            <i class="fas fa-chart-bar"></i>
                        </button>
                    </div>
                    <select id="scPageSize" class="sc-select">
                        <option value="25"   ${this.pageSize === 25 ? 'selected' : ''}>25 שורות</option>
                        <option value="50"   ${this.pageSize === 50 ? 'selected' : ''}>50 שורות</option>
                        <option value="100"  ${this.pageSize === 100 ? 'selected' : ''}>100 שורות</option>
                        <option value="9999" ${this.pageSize === 9999 ? 'selected' : ''}>הכל</option>
                    </select>
                    <button id="scAddSystemBtn"
                            class="sc-add-system-btn sc-admin-only"
                            title="הוסף מערכת חדשה לקטלוג"
                            style="display:none">
                        <i class="fas fa-plus"></i>
                        הוסף מערכת
                    </button>
                    <button id="scAutoFillBulkBtn"
                            class="sc-admin-only"
                            title="Auto-fill ארגוני לכל המערכות"
                            style="display:none">
                        <i class="fas fa-magic"></i>
                        Auto-fill
                    </button>
                    <button id="scGapsBtn"
                            class="sc-gaps-btn sc-admin-only"
                            title="הצג פערים בין קטלוג לשרתים"
                            style="display:none">
                        <i class="fas fa-not-equal"></i>
                        פערים
                    </button>
                    <button id="scImportBtn"
                            class="sc-import-btn sc-admin-only"
                            title="ייבא קטלוג מאקסל"
                            style="display:none">
                        <i class="fas fa-file-excel"></i>
                        ייבא אקסל
                    </button>
                    <button id="scImportAutoBtn"
                            class="sc-import-auto-btn sc-admin-only"
                            title="ייבא סטטוס אוטומציה מאקסל"
                            style="display:none">
                        <i class="fas fa-robot"></i>
                        ייבא אוטומציה
                    </button>
                    <button id="scColManagerBtn"
                            class="sc-col-manager-btn"
                            title="ניהול עמודות">
                        <i class="fas fa-columns"></i>
                    </button>
                    <button id="scExportBtn"
                            class="sc-export-btn"
                            title="ייצא לאקסל">
                        <i class="fas fa-file-excel"></i>
                    </button>
                    <button id="scRefreshBtn"
                            class="sc-refresh-btn" title="רענן">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <span id="scLastUpdate" class="sc-last-update"></span>
                </div>
            </div>

            <div class="sc-stats-bar" id="scStatsBar"></div>

            <div id="scError"   class="sc-error"   style="display:none"></div>
            <div id="scLoading" class="sc-loading"  style="display:none">
                <i class="fas fa-spinner fa-spin"></i> טוען נתונים...
            </div>

            <div id="scToast" class="sc-toast"></div>

            <!-- ══ Multi-Select Toolbar ══ -->
            <div id="scMultiToolbar" class="sc-multi-toolbar" style="display:none">
                <div class="sc-multi-toolbar-right">
                    <span class="sc-multi-count">
                        <i class="fas fa-check-square"></i>
                        <span id="scMultiCount">0</span>
                        מערכות נבחרו
                    </span>
                    <button class="sc-multi-clear-btn" id="scMultiClear">
                        <i class="fas fa-times"></i> בטל בחירה
                    </button>
                </div>
                <div class="sc-multi-toolbar-left">
                    <button id="scBulkValidateBtn"
                            class="sc-multi-action-btn sc-multi-validate-btn"
                            title="שלח תיקוף לנבחרים"
                            style="display:none">
                        <i class="fas fa-envelope"></i>
                        שלח תיקוף לנבחרים
                    </button>
                    <button class="sc-multi-action-btn sc-multi-edit-btn"
                            id="scMultiEditBtn"
                            style="display:none">
                        <i class="fas fa-edit"></i> ערוך נבחרים
                    </button>
                    <button class="sc-multi-action-btn sc-multi-delete-btn"
                            id="scMultiDeleteBtn"
                            style="display:none">
                        <i class="fas fa-trash-alt"></i> מחק נבחרים
                    </button>
                </div>
            </div>

            <div class="sc-scroll-wrapper">
                <div id="scContent"    class="sc-content"></div>
                <div id="scPagination" class="sc-pagination"></div>
            </div>
        </div>`;
    }

    _updateMultiToolbar() {
        const toolbar = document.getElementById('srvMultiToolbar');
        if (toolbar) toolbar.style.display = 'none'; // תמיד מוסתר

        this.updateStats(); // מעדכן את ה-stats bar כולל multi info
    }


    async _openBulkValidationModal() {
        if (!this.isAdmin || this.selectedSystems.size === 0) return;

        // בנה מפה של מנהל → מייל (דרך PhoneDirectory)
        const systemIds = [...this.selectedSystems];
        const systems = systemIds.map(id =>
            this.allSystems.find(s => s.id === id)).filter(Boolean);

        // הצג מודל עם רשימת מערכות + שדות מייל
        const modal = document.createElement('div');
        modal.id = 'scBulkValidateModal';
        modal.className = 'sc-modal-overlay';

        const rowsHtml = systems.map(s => `
        <tr>
            <td style="padding:6px 10px;font-size:0.82rem;
                       color:#e0e0e0;font-weight:600">
                ${this.escHtml(s.name || '')}
            </td>
            <td style="padding:6px 10px;font-size:0.78rem;color:#888">
                ${this.escHtml(s.systemManager || '—')}
            </td>
            <td style="padding:6px 10px">
                <input type="email"
                       id="scBVEmail_${this.escHtml(s.id)}"
                       class="sc-edit-input"
                       style="font-size:0.78rem;padding:4px 8px;
                              direction:ltr"
                       placeholder="מייל מנהל..."
                       value=""/>
            </td>
        </tr>`).join('');

        modal.innerHTML = `
    <div class="sc-modal" style="max-width:680px;width:95%">
        <div class="sc-modal-header">
            <h3 class="sc-modal-title">
                <i class="fas fa-envelope" style="color:#6366f1"></i>
                שליחת תיקוף מרובה
                <span class="sc-multi-edit-count-badge">
                    ${systems.length} מערכות
                </span>
            </h3>
            <button class="sc-modal-close"
                    id="scBVClose">&times;</button>
        </div>
        <div class="sc-modal-body" style="max-height:60vh;overflow-y:auto">
            <div style="font-size:0.82rem;color:#888;margin-bottom:12px;
                        padding:8px 12px;background:rgba(99,102,241,0.06);
                        border-radius:6px;border:1px solid rgba(99,102,241,0.2)">
                <i class="fas fa-info-circle" style="color:#6366f1"></i>
                המערכות יסומנו כ"נדרש תיקוף" ומייל יישלח לכל מנהל.
                מערכות ללא מנהל/מחלקה יישלח סיכום ל-talyoh.
            </div>
            <table style="width:100%;border-collapse:collapse;
                          font-size:0.82rem;direction:rtl">
                <thead>
                    <tr style="background:#1a1a2e">
                        <th style="padding:8px 10px;color:#888;
                                   text-align:right;font-weight:600;
                                   border-bottom:2px solid #2a2a4e">
                            מערכת
                        </th>
                        <th style="padding:8px 10px;color:#888;
                                   text-align:right;font-weight:600;
                                   border-bottom:2px solid #2a2a4e">
                            מנהל מערכת
                        </th>
                        <th style="padding:8px 10px;color:#888;
                                   text-align:right;font-weight:600;
                                   border-bottom:2px solid #2a2a4e">
                            מייל מנהל
                        </th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>
        <div class="sc-modal-footer">
            <button class="sc-modal-cancel-btn" id="scBVCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button id="scBVSend"
                    style="padding:8px 18px;
                           background:linear-gradient(135deg,#4f46e5,#7c3aed);
                           border:none;border-radius:6px;color:white;
                           font-size:0.85rem;font-weight:700;cursor:pointer;
                           display:flex;align-items:center;gap:6px;
                           font-family:inherit">
                <i class="fas fa-paper-plane"></i>
                שלח תיקוף (${systems.length})
            </button>
        </div>
    </div>`;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();
        document.getElementById('scBVClose')
            .addEventListener('click', closeModal);
        document.getElementById('scBVCancel')
            .addEventListener('click', closeModal);

        // ─── נעל כפתור שליחה בזמן טעינה ───
        const sendBtn = document.getElementById('scBVSend');
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> טוען מיילים...';
        }

        // ─── פונקציית Auto-fill מיילים ───
        const autoFillEmails = async () => {
            for (const s of systems) {
                if (!s.systemManager) continue;
                try {
                    const res = await fetch(
                        `/PhoneDirectory/GetManagerEmail?name=` +
                        `${encodeURIComponent(s.systemManager)}`,
                        { credentials: 'include' }
                    );
                    const data = await res.json();
                    if (data.success && data.email) {
                        const inp = document.getElementById(`scBVEmail_${s.id}`);
                        if (inp && !inp.value) inp.value = data.email;
                    }
                } catch (err) {
                    console.warn('GetManagerEmail error:', err);
                }
            }
        };

        // ─── הפעל אוטומטית, ואחרי סיום - שחרר כפתור שליחה ───
        autoFillEmails().finally(() => {
            if (sendBtn) {
                sendBtn.disabled = false;
                sendBtn.innerHTML =
                    `<i class="fas fa-paper-plane"></i> שלח תיקוף (${systems.length})`;
            }
        });

        // שלח
        document.getElementById('scBVSend')
            ?.addEventListener('click', async () => {
                const sendBtn = document.getElementById('scBVSend');
                if (sendBtn) {
                    sendBtn.disabled = true;
                    sendBtn.innerHTML =
                        '<i class="fas fa-spinner fa-spin"></i> שולח...';
                }

                const managerEmailMap = {};
                systems.forEach(s => {
                    const inp = document.getElementById(`scBVEmail_${s.id}`);
                    if (inp?.value?.trim())
                        managerEmailMap[s.id] = inp.value.trim();
                });

                try {
                    const res = await fetch(
                        '/SystemsCatalog/SendBulkValidationEmails',
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({
                                systemIds: systemIds,
                                managerEmailMap
                            })
                        }
                    );
                    const data = await res.json();

                    if (!data.success)
                        throw new Error(data.error || 'שגיאה בשליחה');

                    modal.remove();
                    this.selectedSystems.clear();
                    this._updateMultiToolbar();

                    // עדכן requiresValidation מקומית
                    systemIds.forEach(id => {
                        const sys = this.allSystems.find(s => s.id === id);
                        if (sys) sys.requiresValidation = true;
                    });

                    this.applyFiltersAndSort();
                    this.renderContent();
                    this.updateStats();

                    this.showToast(
                        `✅ ${data.message}` +
                        (data.noManagerCount > 0
                            ? ` | ⚠️ ${data.noManagerCount} ללא מנהל`
                            : ''),
                        'success'
                    );
                } catch (err) {
                    this.showToast('שגיאה: ' + err.message, 'error');
                    if (sendBtn) {
                        sendBtn.disabled = false;
                        sendBtn.innerHTML =
                            `<i class="fas fa-paper-plane"></i> שלח תיקוף`;
                    }
                }
            });
    }

    // ══════════════════════════════════════════════════════════
    // מודל עריכה מרובה - מערכות
    // ══════════════════════════════════════════════════════════
    openMultiEditModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לעריכה', 'error');
            return;
        }
        if (this.selectedSystems.size === 0) {
            this.showToast('לא נבחרו מערכות', 'error');
            return;
        }

        const existing = document.getElementById('scMultiEditModal');
        if (existing) existing.remove();

        const count = this.selectedSystems.size;

        const getUniqueValues = (field) => {
            return [...new Set(
                this.allSystems
                    .map(s => (s[field] || '').trim())
                    .filter(v => v.length > 0)
            )].sort((a, b) => a.localeCompare(b, 'he'));
        };

        const buildSelectOptions = (values, emptyLabel = '— ללא שינוי —') => {
            return `<option value="">${emptyLabel}</option>` +
                values.map(v =>
                    `<option value="${this.escHtml(v)}">${this.escHtml(v)}</option>`
                ).join('');
        };

        const statuses = ['פעיל', 'פעילה', 'לא פעיל', 'לא פעילה',
            'בפיתוח', 'בהקמה', 'פיילוט', 'בהקפאה',
            'מיועד לסגירה', 'מבוטלת'];
        const domains = getUniqueValues('domain');
        const departments = getUniqueValues('department');
        const teams = getUniqueValues('team');
        const bizDivisions = getUniqueValues('businessDivision');
        const appClasses = getUniqueValues('appClassification');
        const appTypes = getUniqueValues('appType');
        const criticalities = getUniqueValues('businessCriticality');
        const availabilities = getUniqueValues('availabilityRequirement');
        const environments = getUniqueValues('environment');
        const managers = getUniqueValues('systemManager');
        const deptManagers = getUniqueValues('departmentManager');

        const modal = document.createElement('div');
        modal.id = 'scMultiEditModal';
        modal.className = 'sc-modal-overlay';

        modal.innerHTML = `
<div class="sc-modal sc-multi-edit-modal">

    <div class="sc-modal-header sc-multi-edit-header">
        <h3 class="sc-modal-title">
            <i class="fas fa-edit" style="color:#6366f1"></i>
            עריכה מרובה
            <span class="sc-multi-edit-count-badge">
                ${count} מערכות
            </span>
        </h3>
        <button class="sc-modal-close"
                id="scMultiEditClose">&times;</button>
    </div>

    <div class="sc-multi-edit-info">
        <i class="fas fa-info-circle"></i>
        <span>רק שדות שתמלא <strong>יעודכנו</strong>.
              שדות ריקים לא ישנו את הערך הקיים.</span>
    </div>

    <div class="sc-modal-body sc-multi-edit-body">

        <!-- שורה 1: סטטוס + מנהל מערכת + מנהל מחלקה + סביבה -->
        <div class="sc-edit-row">
            <div class="sc-edit-field">
                <label class="sc-edit-label">
                    <i class="fas fa-circle-dot"></i> סטטוס
                </label>
                <select id="scMEStatus" class="sc-select sc-edit-select">
                    <option value="">— ללא שינוי —</option>
                    ${statuses.map(v =>
            `<option value="${this.escHtml(v)}">${this.escHtml(v)}</option>`
        ).join('')}
                </select>
            </div>
            <div class="sc-edit-field">
                <label class="sc-edit-label">
                    <i class="fas fa-industry"></i> סביבה
                </label>
                <select id="scMEEnv" class="sc-select sc-edit-select">
                    ${buildSelectOptions(environments)}
                </select>
            </div>
        </div>
        <div class="sc-edit-row">
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-user-tie"></i> מנהל מערכת
                    <button type="button" id="scMEAutoFillBtn"
                            class="sc-autofill-btn"
                            title="מלא אוטומטית">
                        <i class="fas fa-magic"></i>
                    </button>
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEManagerSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(managers)}
                    </select>
                    <input type="text" id="scMEManager"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-user-shield"></i> מנהל מחלקה
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEDeptManagerSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(deptManagers)}
                    </select>
                    <input type="text" id="scMEDeptManager"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
        </div>

        <!-- שורה 2: תחום + מחלקה + צוות -->
        <div class="sc-edit-row">
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-sitemap"></i> תחום
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEDomainSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(domains)}
                    </select>
                    <input type="text" id="scMEDomain"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-building"></i> מחלקה
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEDeptSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(departments)}
                    </select>
                    <input type="text" id="scMEDept"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-users"></i> צוות
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMETeamSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(teams)}
                    </select>
                    <input type="text" id="scMETeam"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
        </div>

        <!-- שורה 3: אגף עסקי + סיווג יישום + סוג יישום -->
        <div class="sc-edit-row">
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-briefcase"></i> אגף עסקי
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEBizDivSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(bizDivisions)}
                    </select>
                    <input type="text" id="scMEBizDiv"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-tag"></i> סיווג יישום
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEAppClassSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(appClasses)}
                    </select>
                    <input type="text" id="scMEAppClass"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-cube"></i> סוג יישום
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEAppTypeSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(appTypes)}
                    </select>
                    <input type="text" id="scMEAppType"
                           class="sc-edit-input sc-me-combo-input"
                           placeholder="או הקלד ידנית..."/>
                </div>
            </div>
        </div>

        <!-- שורה 4: קריטיות עסקית + דרישת זמינות -->
        <div class="sc-edit-row">
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-exclamation-triangle"></i>
                    קריטיות עסקית
                </label>
                <select id="scMECriticality"
                        class="sc-select sc-edit-select">
                    ${buildSelectOptions(criticalities)}
                </select>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-clock"></i> דרישת זמינות
                </label>
                <select id="scMEAvailability"
                        class="sc-select sc-edit-select">
                    ${buildSelectOptions(availabilities)}
                </select>
            </div>
        </div>

        <!-- שורה 5: מפרסם + ספק תמיכה + הערת אוטומציה -->
        <div class="sc-edit-row">
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-building-user"></i> מפרסם
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEPublisherSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(getUniqueValues('publisher'))}
                    </select>
                    <input type="text" id="scMEPublisher"
                        class="sc-edit-input sc-me-combo-input"
                        placeholder="או הקלד ידנית..."/>
                </div>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-headset"></i> ספק תמיכה
                </label>
                <div class="sc-me-combo-wrap">
                    <select id="scMEVendorSelect"
                            class="sc-select sc-edit-select sc-me-combo-select">
                        ${buildSelectOptions(getUniqueValues('supportVendor'))}
                    </select>
                    <input type="text" id="scMEVendor"
                        class="sc-edit-input sc-me-combo-input"
                        placeholder="או הקלד ידנית..."/>
                </div>
            </div>
        </div>

        <!-- שורה 6: אוטומציה + הערת אוטומציה -->
        <div class="sc-edit-row sc-edit-row-automation">
            <div class="sc-edit-field">
                <label class="sc-edit-label">
                    <i class="fas fa-robot"></i> אוטומציה
                </label>
                <select id="scMEAutomation" class="sc-select sc-edit-select">
                    <option value="">— ללא שינוי —</option>
                    <option value="קיימות">קיימות</option>
                    <option value="לא קיימות">לא קיימות</option>
                    <option value="לא רלוונטי">לא רלוונטי</option>
                </select>
            </div>
            <div class="sc-edit-field sc-edit-field-wide">
                <label class="sc-edit-label">
                    <i class="fas fa-sticky-note"></i> הערת אוטומציה
                </label>
                <input type="text" id="scMEAutomationNote"
                    class="sc-edit-input"
                    placeholder="— ללא שינוי —"/>
            </div>
        </div>

        <!-- שורה 7: נדרש תיקוף -->
        <div class="sc-edit-row">
            <div class="sc-edit-field">
                <label class="sc-edit-label">
                    <i class="fas fa-circle-check"></i> נדרש תיקוף
                </label>
                <select id="scMERequiresValidation" class="sc-select sc-edit-select">
                    <option value="">— ללא שינוי —</option>
                    <option value="true">נדרש תיקוף</option>
                    <option value="false">לא נדרש תיקוף</option>
                </select>
            </div>
        </div>

        <!-- רשימת מערכות נבחרות -->
        <div class="sc-multi-selected-list">
            <div class="sc-multi-selected-title">
                <i class="fas fa-list"></i>
                מערכות שיעודכנו:
            </div>
            <div class="sc-multi-selected-names">
                ${[...this.selectedSystems].map(id => {
            const sys = this.allSystems.find(s => s.id === id);
            return `<span class="sc-multi-selected-tag">
                        ${this.escHtml(sys?.name || id)}
                    </span>`;
        }).join('')}
            </div>
        </div>

    </div>

    <div class="sc-modal-footer">
        <button class="sc-modal-cancel-btn" id="scMultiEditCancel">
            <i class="fas fa-times"></i> ביטול
        </button>
        <button class="sc-edit-save-btn" id="scMultiEditSave">
            <i class="fas fa-save"></i>
            עדכן ${count} מערכות
        </button>
    </div>

</div>`;

        document.body.appendChild(modal);

        // ─── קשר combos ───
        const comboPairs = [
            { selectId: 'scMEManagerSelect', inputId: 'scMEManager' },
            { selectId: 'scMEDeptManagerSelect', inputId: 'scMEDeptManager' },
            { selectId: 'scMEDomainSelect', inputId: 'scMEDomain' },
            { selectId: 'scMEDeptSelect', inputId: 'scMEDept' },
            { selectId: 'scMETeamSelect', inputId: 'scMETeam' },
            { selectId: 'scMEBizDivSelect', inputId: 'scMEBizDiv' },
            { selectId: 'scMEAppClassSelect', inputId: 'scMEAppClass' },
            { selectId: 'scMEAppTypeSelect', inputId: 'scMEAppType' },
            { selectId: 'scMEPublisherSelect', inputId: 'scMEPublisher' },
            { selectId: 'scMEVendorSelect', inputId: 'scMEVendor' },
        ];

        comboPairs.forEach(({ selectId, inputId }) => {
            const sel = document.getElementById(selectId);
            const inp = document.getElementById(inputId);
            if (!sel || !inp) return;

            sel.addEventListener('change', () => {
                if (sel.value) {
                    inp.value = sel.value;
                    inp.classList.add('sc-autofilled');
                    setTimeout(() => inp.classList.remove('sc-autofilled'), 2000);
                } else {
                    inp.value = '';
                }
            });

            inp.addEventListener('input', () => { sel.value = ''; });
        });

        const closeModal = () => modal.remove();

        document.getElementById('scMultiEditClose')
            .addEventListener('click', closeModal);
        document.getElementById('scMultiEditCancel')
            .addEventListener('click', closeModal);

        document.getElementById('scMultiEditSave')
            .addEventListener('click', () => this._saveMultiEdit(modal));

        document.getElementById('scMEAutoFillBtn')
            ?.addEventListener('click', () => {
                const name = document.getElementById('scMEManager')?.value?.trim();
                name
                    ? this._autoFillOrgInfo(name, 'scME')
                    : this.showToast('הזן שם מנהל מערכת תחילה', 'info');
            });

        document.getElementById('scMEManager')
            ?.addEventListener('blur', e => {
                const val = e.target.value?.trim();
                if (val?.length >= 2) this._autoFillOrgInfo(val, 'scME');
            });
    }

    async _saveMultiEdit(modal) {
        const saveBtn = document.getElementById('scMultiEditSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const getComboValue = (inputId, selectId) => {
                const inputVal = document.getElementById(inputId)?.value?.trim();
                if (inputVal) return inputVal;
                const selectVal = document.getElementById(selectId)?.value;
                return selectVal || '';
            };

            const updates = {};

            const status = document.getElementById('scMEStatus')?.value;
            if (status) updates.status = status;

            const env = document.getElementById('scMEEnv')?.value;
            if (env) updates.environment = env;

            const automation = document.getElementById('scMEAutomation')?.value;
            if (automation) updates.hasAutomation = automation;

            const manager = getComboValue('scMEManager', 'scMEManagerSelect');
            if (manager) updates.systemManager = manager;

            const deptManager = getComboValue('scMEDeptManager', 'scMEDeptManagerSelect');
            if (deptManager) updates.departmentManager = deptManager;

            const domain = getComboValue('scMEDomain', 'scMEDomainSelect');
            if (domain) updates.domain = domain;

            const dept = getComboValue('scMEDept', 'scMEDeptSelect');
            if (dept) updates.department = dept;

            const team = getComboValue('scMETeam', 'scMETeamSelect');
            if (team) updates.team = team;

            const bizDiv = getComboValue('scMEBizDiv', 'scMEBizDivSelect');
            if (bizDiv) updates.businessDivision = bizDiv;

            const appClass = getComboValue('scMEAppClass', 'scMEAppClassSelect');
            if (appClass) updates.appClassification = appClass;

            const appType = getComboValue('scMEAppType', 'scMEAppTypeSelect');
            if (appType) updates.appType = appType;

            const criticality = document.getElementById('scMECriticality')?.value;
            if (criticality) updates.businessCriticality = criticality;

            const availability = document.getElementById('scMEAvailability')?.value;
            if (availability) updates.availabilityRequirement = availability;
            const publisher = getComboValue('scMEPublisher', 'scMEPublisherSelect');
            if (publisher) updates.publisher = publisher;

            const vendor = getComboValue('scMEVendor', 'scMEVendorSelect');
            if (vendor) updates.supportVendor = vendor;

            const automationNote = document.getElementById('scMEAutomationNote')?.value?.trim();
            if (automationNote) updates.automationNote = automationNote;

            const requiresValidation = document.getElementById('scMERequiresValidation')?.value;
            if (requiresValidation !== '' && requiresValidation !== undefined) {
                updates.requiresValidation = requiresValidation === 'true';
            }

            if (Object.keys(updates).length === 0) {
                this.showToast('לא הוזנו שדות לעדכון', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        `<i class="fas fa-save"></i> עדכן ${this.selectedSystems.size} מערכות`;
                }
                return;
            }

            const payload = {
                systemIds: [...this.selectedSystems],
                updates
            };

            const res = await fetch('/SystemsCatalog/UpdateMultipleSystems', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            const updatedAt = new Date().toISOString()
                .replace('T', ' ').substring(0, 16);

            this.selectedSystems.forEach(id => {
                const sys = this.allSystems.find(s => s.id === id);
                if (sys) {
                    Object.assign(sys, updates);
                    sys.lastUpdated = updatedAt;
                    sys.updatedBy = this.currentUser || '';
                }
            });

            modal.remove();
            this.selectedSystems.clear();
            this._updateMultiToolbar();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            this.showToast(
                `✅ עודכנו ${data.updatedCount} מערכות בהצלחה`,
                'success'
            );

        } catch (err) {
            console.error('_saveMultiEdit error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    `<i class="fas fa-save"></i> עדכן ${this.selectedSystems.size} מערכות`;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל מחיקה מרובה - מערכות
    // ══════════════════════════════════════════════════════════
    _openMultiDeleteModal() {
        if (this.selectedSystems.size === 0) {
            this.showToast('לא נבחרו מערכות', 'error');
            return;
        }

        const existing = document.getElementById('scMultiDeleteModal');
        if (existing) existing.remove();

        const count = this.selectedSystems.size;
        const selectedList = [...this.selectedSystems];

        const systemsInfo = selectedList.map(id => {
            return this.allSystems.find(s => s.id === id) ||
                { id, name: id, number: '' };
        });

        const modal = document.createElement('div');
        modal.id = 'scMultiDeleteModal';
        modal.className = 'sc-modal-overlay';

        modal.innerHTML = `
    <div class="sc-modal" style="max-width:500px;width:95%">

        <div class="sc-modal-header" style="
            border-bottom:2px solid rgba(239,68,68,0.35);
            background:linear-gradient(135deg,
                rgba(239,68,68,0.08),rgba(220,38,38,0.05))">
            <h3 class="sc-modal-title">
                <i class="fas fa-trash-alt" style="color:#ef4444"></i>
                מחיקת מערכות
                <span style="
                    display:inline-flex;align-items:center;
                    padding:2px 10px;
                    background:rgba(239,68,68,0.15);
                    border:1px solid rgba(239,68,68,0.35);
                    border-radius:8px;color:#fca5a5;
                    font-size:0.82rem;font-weight:700;
                    margin-right:6px">
                    ${count} מערכות
                </span>
            </h3>
            <button class="sc-modal-close"
                    id="scMultiDeleteClose">&times;</button>
        </div>

        <!-- אזהרה -->
        <div style="
            display:flex;gap:14px;align-items:flex-start;
            padding:14px 20px;
            background:rgba(239,68,68,0.08);
            border-bottom:1px solid rgba(239,68,68,0.2);
            color:#fda4af">
            <i class="fas fa-exclamation-triangle"
               style="color:#ef4444;font-size:1.4rem;
                      flex-shrink:0;margin-top:2px"></i>
            <div>
                <div style="font-size:0.9rem;font-weight:600;
                            margin-bottom:4px">
                    פעולה זו תמחק לצמיתות
                    <strong style="color:#ef4444">${count}</strong>
                    מערכות
                </div>
                <div style="font-size:0.78rem;opacity:0.8">
                    לא ניתן לבטל פעולה זו לאחר האישור.
                </div>
            </div>
        </div>

        <!-- רשימת מערכות -->
        <div class="sc-modal-body" style="gap:12px">
            <div style="
                background:rgba(255,255,255,0.02);
                border:1px solid rgba(255,255,255,0.07);
                border-radius:8px;overflow:hidden">
                <div style="
                    font-size:0.78rem;font-weight:600;color:#777;
                    padding:8px 12px;
                    border-bottom:1px solid rgba(255,255,255,0.05);
                    background:rgba(255,255,255,0.02);
                    display:flex;align-items:center;gap:6px">
                    <i class="fas fa-list" style="color:#6366f1"></i>
                    מערכות שיימחקו:
                </div>
                <div style="max-height:200px;overflow-y:auto;padding:4px">
                    ${systemsInfo.map(s => `
                    <div style="
                        display:flex;align-items:center;
                        justify-content:space-between;
                        padding:6px 10px;
                        border-bottom:1px dashed rgba(255,255,255,0.04)">
                        <span style="
                            font-size:0.82rem;font-weight:600;
                            color:#e0e0e0;display:flex;
                            align-items:center;gap:6px">
                            <i class="fas fa-layer-group"
                               style="color:#555;font-size:0.7rem"></i>
                            ${this.escHtml(s.name || '')}
                        </span>
                        ${s.number ? `
                        <span style="
                            font-family:monospace;font-size:0.72rem;
                            color:#6366f1;
                            background:rgba(99,102,241,0.12);
                            border:1px solid rgba(99,102,241,0.25);
                            border-radius:4px;padding:1px 6px">
                            #${this.escHtml(String(s.number))}
                        </span>` : ''}
                    </div>`).join('')}
                </div>
            </div>

            <!-- אישור הקלדה -->
            <div style="display:flex;flex-direction:column;gap:6px">
                <label style="
                    font-size:0.82rem;color:#aaa;
                    display:flex;align-items:center;gap:6px">
                    <i class="fas fa-keyboard" style="color:#6366f1"></i>
                    הקלד <strong style="color:#ef4444;
                                        font-family:monospace">מחק</strong>
                    לאישור:
                </label>
                <input type="text"
                       id="scMultiDeleteConfirmInput"
                       style="
                           background:#252535;
                           border:1px solid #3a3a5a;
                           border-radius:6px;color:#e0e0e0;
                           padding:8px 12px;font-size:0.88rem;
                           outline:none;direction:rtl;
                           width:100%;box-sizing:border-box;
                           transition:border-color 0.2s"
                       placeholder='הקלד "מחק"'
                       autocomplete="off"/>
            </div>
        </div>

        <div class="sc-modal-footer">
            <button class="sc-modal-cancel-btn"
                    id="scMultiDeleteCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button id="scMultiDeleteConfirm"
                    disabled
                    style="
                        padding:8px 18px;
                        background:rgba(239,68,68,0.15);
                        border:1px solid rgba(239,68,68,0.4);
                        border-radius:6px;color:#fca5a5;
                        font-size:0.85rem;font-weight:700;
                        cursor:not-allowed;opacity:0.4;
                        display:flex;align-items:center;gap:6px;
                        transition:all 0.2s;font-family:inherit">
                <i class="fas fa-trash-alt"></i>
                מחק ${count} מערכות
            </button>
        </div>
    </div>`;

        document.body.appendChild(modal);

        // ─── הפעל כפתור רק אחרי הקלדת "מחק" ───
        const confirmInput = document.getElementById(
            'scMultiDeleteConfirmInput'
        );
        const confirmBtn = document.getElementById('scMultiDeleteConfirm');

        confirmInput.addEventListener('input', () => {
            const isValid = confirmInput.value.trim() === 'מחק';
            confirmBtn.disabled = !isValid;
            confirmBtn.style.opacity = isValid ? '1' : '0.4';
            confirmBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
            confirmInput.style.borderColor = isValid
                ? '#22c55e' : '#3a3a5a';
        });

        const closeModal = () => modal.remove();

        document.getElementById('scMultiDeleteClose')
            .addEventListener('click', closeModal);
        document.getElementById('scMultiDeleteCancel')
            .addEventListener('click', closeModal);

        confirmBtn.addEventListener('click', () =>
            this._executeMultiDelete(modal)
        );
    }

    // ─── בצע מחיקה מרובה ─────────────────────────────────────────
    async _executeMultiDelete(modal) {
        const confirmBtn = document.getElementById('scMultiDeleteConfirm');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> מוחק...';
        }

        const toDelete = [...this.selectedSystems];

        try {
            // ─── מחק מהרשימה המקומית ───
            this.allSystems = this.allSystems.filter(
                s => !toDelete.includes(s.id)
            );

            // ─── שמור לשרת ───
            const res = await fetch('/SystemsCatalog/SaveSystems', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ systems: this.allSystems })
            });

            const data = await res.json();
            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            modal.remove();

            this.selectedSystems.clear();
            this._updateMultiToolbar();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            this.showToast(
                `🗑️ נמחקו ${toDelete.length} מערכות בהצלחה`,
                'success'
            );

        } catch (err) {
            console.error('_executeMultiDelete error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            // ─── Rollback ───
            await this.loadData();

            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML =
                    `<i class="fas fa-trash-alt"></i> מחק ${toDelete.length} מערכות`;
            }
        }
    }

    _buildFilterGroups() {
        const groups = [
            { key: 'status', id: 'scFltStatus', label: 'סטטוס', icon: 'fa-circle-dot', default: 'כל הסטטוסים' },
            { key: 'systemManager', id: 'scFltManager', label: 'מנהל מערכת', icon: 'fa-user-tie', default: 'כל המנהלים' },
            { key: 'departmentManager', id: 'scFltDeptManager', label: 'מנהל מחלקה', icon: 'fa-user-shield', default: 'כל מנהלי המחלקה' },
            { key: 'team', id: 'scFltTeam', label: 'צוות', icon: 'fa-users', default: 'כל הצוותים' },
            { key: 'department', id: 'scFltDept', label: 'מחלקה', icon: 'fa-building', default: 'כל המחלקות' },
            { key: 'domain', id: 'scFltDomain', label: 'תחום', icon: 'fa-sitemap', default: 'כל התחומים' },
            { key: 'businessDivision', id: 'scFltBizDiv', label: 'אגף עסקי', icon: 'fa-briefcase', default: 'כל האגפים' },
            { key: 'appClassification', id: 'scFltAppClass', label: 'סיווג יישום', icon: 'fa-tag', default: 'כל הסיווגים' },
            { key: 'appType', id: 'scFltAppType', label: 'סוג יישום', icon: 'fa-cube', default: 'כל הסוגים' },
            { key: 'businessCriticality', id: 'scFltCriticality', label: 'קריטיות עסקית', icon: 'fa-exclamation-triangle', default: 'כל הרמות' },
            { key: 'availabilityRequirement', id: 'scFltAvailability', label: 'דרישת זמינות', icon: 'fa-clock', default: 'כל הדרישות' },
            { key: 'environment', id: 'scFltEnv', label: 'סביבה', icon: 'fa-industry', default: 'כל הסביבות' },
            { key: 'publisher', id: 'scFltPublisher', label: 'מפרסם', icon: 'fa-building-user', default: 'כל המפרסמים' },
            { key: 'supportVendor', id: 'scFltVendor', label: 'ספק תמיכה', icon: 'fa-headset', default: 'כל הספקים' },
            { key: 'hasAutomation', id: 'scFltAutomation', label: 'אוטומציה', icon: 'fa-robot', default: 'הכל' },
            { key: 'requiresValidation', id: 'scFltRequiresValidation', label: 'נדרש תיקוף', icon: 'fa-circle-check', default: 'הכל' }
        ];

        return groups.map(g => `
            <div class="sc-filter-group" data-filter-key="${g.key}">
                <label class="sc-filter-label">
                    <i class="fas ${g.icon}"
                       style="color:#6366f1;font-size:0.7rem"></i>
                    ${g.label}
                </label>
                <select id="${g.id}" class="sc-select">
                    <option value="all">${g.default}</option>
                </select>
            </div>`).join('');
    }

    renderContent() {
        // הצג header-left ו-stats-bar
        const filters = document.querySelector('.sc-filters-toggle-row');
        if (filters) filters.style.display = '';
        const search = document.querySelector('.sc-search-input');
        if (search) search.style.display = '';

        const statsBar = document.getElementById('scStatsBar');
        if (statsBar) statsBar.style.display = '';

        switch (this.viewMode) {
            case 'table': this.renderTable(); break;
            case 'cards': this.renderCards(); break;
            case 'stats': this.renderStatsView(); break;
        }

        if (this.viewMode !== 'table') {
            this.selectedSystems.clear();
            this._updateMultiToolbar();
        }
        this._updateViewBtns();
        this._updateLastUpdate();
    }

    renderTable() {
        const content = document.getElementById('scContent');
        if (!content) return;

        const { page, total, pages } = this._getPaginationInfo();

        if (this.filteredSystems.length === 0) {
            content.innerHTML = `
            <div class="sc-empty">
                <i class="fas fa-layer-group"></i>
                <p>לא נמצאו מערכות</p>
            </div>`;
            this.renderPagination(0, 0);
            return;
        }

        // ── הגדרת כל העמודות האפשריות ──
        const allColDefs = {
            number: { label: 'מספר', width: '70px' },
            name: { label: 'שם', width: '80px' },
            nameEn: { label: 'שם אנגלית', width: '80px' },
            description: { label: 'תיאור', width: '200px' },
            status: { label: 'סטטוס', width: '50px' },
            systemManager: { label: 'מנהל מערכת', width: '70px' },
            departmentManager: { label: 'מנהל מחלקה', width: '70px' },
            team: { label: 'צוות', width: '60px' },
            department: { label: 'מחלקה', width: '60px' },
            domain: { label: 'תחום', width: '60px' },
            businessDivision: { label: 'אגף עסקי', width: '50px' },
            appClassification: { label: 'סיווג', width: '40px' },
            appType: { label: 'סוג', width: '50px' },
            businessCriticality: { label: 'קריטיות', width: '45px' },
            availabilityRequirement: { label: 'זמינות', width: '48px' },
            environment: { label: 'סביבה', width: '60px' },
            publisher: { label: 'מפרסם', width: '50px' },
            supportVendor: { label: 'ספק', width: '50px' },
            hasAutomation: { label: 'אוטומציה', width: '55px' },
            createdAt: { label: 'נוצר', width: '48px' },
            lastValidatedAt: { label: 'תיקוף אחרון', width: '48px' },
            requiresValidation: { label: 'נדרש תיקוף', width: '55px' },
            buttons: { label: '', width: '45px' },
        };

        // ── בנה רשימת עמודות לפי הסדר והנראות ──
        const cols = this.columnOrder
            .filter(key => this.visibleColumns[key] && allColDefs[key])
            .map(key => ({ key, ...allColDefs[key] }));

        // ─── הוסף עמודת checkbox בתחילה ───
        // ─── הוסף עמודת checkbox רק לאדמין ───
        if (this.isAdmin) {
            cols.unshift({ key: '_select', label: '', width: '36px' });
        }

        const filterableColumns = {
            'name': 'name',
            'nameEn': 'nameEn',
            'status': 'status',
            'systemManager': 'systemManager',
            'departmentManager': 'departmentManager',
            'team': 'team',
            'department': 'department',
            'domain': 'domain',
            'businessDivision': 'businessDivision',
            'appClassification': 'appClassification',
            'appType': 'appType',
            'businessCriticality': 'businessCriticality',
            'availabilityRequirement': 'availabilityRequirement',
            'environment': 'environment',
            'publisher': 'publisher',
            'supportVendor': 'supportVendor',
        };

        const headerHtml = cols.map(c => {
            const isFilterable = !!filterableColumns[c.key];
            const isFiltered = isFilterable &&
                this.filters[c.key] && this.filters[c.key] !== 'all';

            // ─── עמודת checkbox ───
            if (c.key === '_select') {
                if (!this.isAdmin) return `<th class="srv-th srv-th-select" style="min-width:0px;width:0px"></th>`;

                const allSelected = page.length > 0 &&
                    page.every(s => this.selectedSystems.has(s.id));
                return `
    <th class="sc-th sc-th-select"
        style="min-width:36px;width:36px;cursor:default">
        <input type="checkbox" class="sc-cb sc-cb-all"
               ${allSelected ? 'checked' : ''}
               title="בחר הכל">
    </th>`;
            }

            // ─── עמודת buttons - לא ניתנת למיון/פילטר ───
            const isSortable = c.key !== 'buttons';

            const filterIndicator = isFiltered
                ? `<span class="sc-th-filter-dot"
             title="פילטר פעיל: ${this.escHtml(this.filters[c.key])}">
           </span>`
                : '';

            const filterBtn = isFilterable
                ? `<button class="sc-th-filter-btn
                 ${isFiltered ? 'sc-th-filter-active' : ''}"
           data-col="${c.key}"
           title="${isFiltered
                    ? 'פילטר פעיל - לחץ לניקוי/שינוי'
                    : 'לחץ לסינון עמודה זו'}"
           onclick="event.stopPropagation();
                    window._scDashboard
                        ._toggleColumnFilter('${c.key}')">
           <i class="fas fa-filter"></i>
       </button>`
                : '';

            // ─── אייקון מיון - רק לעמודות שניתן למיין ───
            const sortIcon = isSortable
                ? (this.sortColumn === c.key
                    ? `<i class="fas fa-sort-${this.sortDirection === 'asc'
                        ? 'up' : 'down'} sc-th-sort-icon"></i>`
                    : '<i class="fas fa-sort sc-sort-icon-dim"></i>')
                : '';  // ← ריק לעמודת buttons

            return `
    <th class="sc-th ${this.sortColumn === c.key ? 'sorted' : ''}
               ${isFiltered ? 'sc-th-filtered' : ''}"
        ${isSortable ? `data-col="${c.key}"` : ''}
        style="min-width:${c.width};
               ${!isSortable ? 'cursor:default;' : ''}">
        <div class="sc-th-content">
            <span class="sc-th-label">${c.label}</span>
            ${filterIndicator}
            <div class="sc-th-actions">
                ${filterBtn}
                ${sortIcon}
            </div>
        </div>
        <div class="sc-th-filter-popup"
             id="scThFilter_${c.key}"
             style="display:none"
             onclick="event.stopPropagation()">
        </div>
    </th>`;
        }).join('');

        const rowsHtml = page.map(s => {
            const statusClass = this._getStatusClass(s.status);
            const critClass = this._getCriticalityClass(s.businessCriticality);
            const envClass = this._getEnvClass(s.environment);
            const isSelected = this.selectedSystems.has(s.id);

            // ── בנה תאים לפי הסדר הדינמי ──
            const cells = cols.map(c => {
                switch (c.key) {
                    case '_select':
                        return `
    <td class="sc-td sc-td-select">
        ${this.isAdmin ? `<input type="checkbox" class="sc-cb sc-cb-row"
            data-id="${this.escHtml(s.id)}"
            ${isSelected ? 'checked' : ''}>` : ''}
    </td>`;

                    case 'number':
                        return `
                <td class="sc-td sc-td-center sc-td-number">
                    <span class="sc-catalog-num-link"
                        data-id="${this.escHtml(s.id || '')}"
                        title="${this.isAdmin
                                ? 'לחץ לעריכת מערכת'
                                : 'לחץ לצפייה בפרטי מערכת'}">
                        ${this.escHtml(String(s.number || ''))}
                    </span>
                </td>`;

                    case 'name':
                        return `
                <td class="sc-td sc-td-name"
                    title="${this.escHtml(s.name || '')}">
                    ${this.escHtml(s.name || '')}
                </td>`;

                    case 'nameEn':
                        return `
                <td class="sc-td sc-td-truncate" dir="ltr"
                    title="${this.escHtml(s.nameEn || '')}">
                    ${this.escHtml(s.nameEn || '')}
                </td>`;

                    case 'description':
                        return `
                <td class="sc-td sc-td-desc"
                    title="${this.escHtml(
                            this._cleanDescription(s.description))}">
                    <span class="sc-desc-text">
                        ${this.escHtml(
                                this._cleanDescription(s.description))}
                    </span>
                </td>`;

                    case 'status':
                        return `
                <td class="sc-td sc-td-center">
                    <span class="sc-badge ${statusClass}">
                        ${this.escHtml(s.status || '')}
                    </span>
                </td>`;

                    case 'systemManager':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.systemManager || '')}">
                    ${this.escHtml(s.systemManager || '')}
                </td>`;

                    case 'departmentManager':
                        return `
                    <td class="sc-td sc-td-truncate"
                        title="${this.escHtml(s.departmentManager || '')}">
                        ${this.escHtml(s.departmentManager || '')}
                    </td>`;

                    case 'team':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.team || '')}">
                    ${this.escHtml(s.team || '')}
                </td>`;

                    case 'department':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.department || '')}">
                    ${this.escHtml(s.department || '')}
                </td>`;

                    case 'domain':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.domain || '')}">
                    ${this.escHtml(s.domain || '')}
                </td>`;

                    case 'businessDivision':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.businessDivision || '')}">
                    ${this.escHtml(s.businessDivision || '')}
                </td>`;

                    case 'appClassification':
                        return `
                <td class="sc-td sc-td-center">
                    <span class="sc-badge sc-badge-neutral">
                        ${this.escHtml(s.appClassification || '')}
                    </span>
                </td>`;

                    case 'appType':
                        return `
                <td class="sc-td sc-td-center">
                    <span class="sc-badge sc-badge-type">
                        ${this.escHtml(s.appType || '')}
                    </span>
                </td>`;

                    case 'businessCriticality':
                        return `
                <td class="sc-td sc-td-center">
                    <span class="sc-badge ${critClass}">
                        ${this.escHtml(s.businessCriticality || '')}
                    </span>
                </td>`;

                    case 'availabilityRequirement':
                        return `
                <td class="sc-td sc-td-center">
                    <span class="sc-badge sc-badge-avail">
                        ${this.escHtml(s.availabilityRequirement || '')}
                    </span>
                </td>`;

                    case 'environment':
                        return `
                <td class="sc-td sc-td-center sc-td-truncate"
                    style="direction:ltr">
                    <span class="sc-badge ${envClass}">
                        ${this.escHtml(s.environment || '')}
                    </span>
                </td>`;

                    case 'publisher':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.publisher || '')}">
                    ${this.escHtml(s.publisher || '')}
                </td>`;

                    case 'supportVendor':
                        return `
                <td class="sc-td sc-td-truncate"
                    title="${this.escHtml(s.supportVendor || '')}">
                    ${this.escHtml(s.supportVendor || '')}
                </td>`;

                    case 'hasAutomation':
                        return `
                <td class="sc-td sc-td-center"
                    title="${this.escHtml(s.automationNote || '')}">
                    ${this._renderAutomationBadge(
                            s.hasAutomation, s.automationNote)}
                </td>`;

                    case 'createdAt':
                        return `
                <td class="sc-td sc-td-center sc-td-date"
                    title="${this._stripTime(s.createdAt || '')}">
                    <span class="sc-date-text">
                        ${this.escHtml(
                            this._stripTime(s.createdAt || ''))}
                    </span>
                </td>`;

                    case 'lastValidatedAt':
                        return `
                        <td class="sc-td sc-td-center sc-td-date"
                            title="${this._stripTime(s.lastValidatedAt || '')}">
                            <span class="sc-date-text ${s.lastValidatedAt ? 'sc-validated-date' : 'sc-not-validated'}">
                                ${s.lastValidatedAt
                                ? this._stripTime(this._stripTime(s.lastValidatedAt))
                                : '—'}
                            </span>
                        </td>`;

                    case 'requiresValidation':
                        return `
                        <td class="sc-td sc-td-center">
                            ${s.requiresValidation
                                ? `<span class="sc-badge sc-badge-requires-validation"
                                        title="מערכת זו מסומנת כדורשת תיקוף">
                                    <i class="fas fa-circle-check"></i>
                                    נדרש תיקוף
                                </span>`
                                : `<span class="sc-badge sc-badge-neutral"
                                        style="opacity:0.35"
                                        title="לא נדרש תיקוף">
                                    —
                                </span>`}
                        </td>`;
                    case 'buttons':
                        return `
                <td class="sc-td sc-td-center sc-td-servers">
                    <button class="sc-view-servers-btn"
                            data-system-name="${this.escHtml(s.name || '')}"
                            title="צפה בשרתים של: ${this.escHtml(s.name || '')}">
                        <i class="fas fa-server"></i>
                    </button>
                    ${(this.isAdmin || this.isAutomationOnly) ? `
                    <button class="sc-row-edit-btn"
                            data-id="${this.escHtml(s.id || '')}"
                            title="${this.isAdmin ? 'ערוך מערכת' : 'ערוך אוטומציה'}">
                        <i class="fas ${this.isAdmin ? 'fa-edit' : 'fa-robot'}"></i>
                    </button>` : ''}
                </td>`;
                    default:
                        return `<td class="sc-td"></td>`;
                }
            }).join('');

            return `
    <tr class="sc-tr ${isSelected ? 'sc-tr-selected' : ''}"
        data-id="${this.escHtml(s.id || '')}">
        ${cells}
    </tr>`;
        }).join('');

        const colgroupHtml = cols.map(c =>
            `<col style="width:${c.width};min-width:${c.width}">`
        ).join('');

        content.innerHTML = `
        <table class="sc-table">
            <colgroup>${colgroupHtml}</colgroup>
            <thead><tr>${headerHtml}</tr></thead>
            <tbody id="scTbody">${rowsHtml}</tbody>
        </table>`;

        this.renderPagination(total, pages);
    }

    // ══════════════════════════════════════════════════════════
    // סינון מהכותרת - פתח/סגור popup
    // ══════════════════════════════════════════════════════════
    _toggleColumnFilter(colKey) {
        document.querySelectorAll('.sc-th-filter-popup').forEach(p => {
            if (p.id !== `scThFilter_${colKey}`) {
                p.style.display = 'none';
            }
        });

        const popup = document.getElementById(`scThFilter_${colKey}`);
        if (!popup) return;

        const isOpen = popup.style.display !== 'none';
        if (isOpen) {
            popup.style.display = 'none';
            return;
        }

        popup.innerHTML = this._buildColumnFilterContent(colKey);
        popup.style.display = 'block';

        const searchInput = popup.querySelector('.sc-col-filter-search');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 50);
        }
    }

    _applyColumnSort(colKey, direction) {
        this.sortColumn = colKey;
        this.sortDirection = direction;
        this._savePreferences();
        this.applyFiltersAndSort();
        this.renderContent();

        const popup = document.getElementById(`scThFilter_${colKey}`);
        if (popup && popup.style.display !== 'none') {
            popup.innerHTML = this._buildColumnFilterContent(colKey);
            const searchInput = popup.querySelector('.sc-col-filter-search');
            if (searchInput) searchInput.focus();
        }
    }

    // ══════════════════════════════════════════════════════════
    // בנה תוכן popup סינון לעמודה
    // ══════════════════════════════════════════════════════════
    _buildColumnFilterContent(colKey) {
        const currentVal = this.filters[colKey] || 'all';
        const isSortedHere = this.sortColumn === colKey;
        const sortDir = this.sortDirection;

        const uniqueValues = [...new Set(
            this.allSystems
                .map(s => s[colKey])
                .filter(v => v !== null && v !== undefined && v !== '')
        )].sort((a, b) => String(a).localeCompare(String(b), 'he'));

        const emptyCount = this.allSystems.filter(
            s => s[colKey] === null ||
                s[colKey] === undefined ||
                s[colKey] === ''
        ).length;

        const sortIndicator = isSortedHere ? `
    <div class="sc-col-sort-indicator">
        <i class="fas fa-sort-${sortDir === 'asc' ? 'up' : 'down'}"></i>
        <span>ממוין ${sortDir === 'asc' ? 'א → ת' : 'ת → א'}</span>
        <button class="sc-col-sort-flip-btn"
                title="הפוך כיוון מיון"
                onclick="event.stopPropagation();
                         window._scDashboard._applyColumnSort(
                             '${colKey}',
                             '${sortDir === 'asc' ? 'desc' : 'asc'}'
                         )">
            <i class="fas fa-exchange-alt"></i>
        </button>
    </div>
    <div class="sc-col-filter-divider"></div>` : '';

        const isSearchable = uniqueValues.length > 5;
        const searchHtml = isSearchable
            ? `<div class="sc-col-filter-search-wrap">
           <i class="fas fa-search sc-col-filter-search-icon"></i>
           <input type="text"
                  class="sc-col-filter-search"
                  placeholder="חפש..."
                  oninput="window._scDashboard
                               ._filterColumnOptions(this, '${colKey}')"/>
       </div>`
            : '';

        const buildOption = (value, label, isActive, count) => {
            return `
        <div class="sc-col-filter-option
                    ${isActive ? 'sc-col-filter-option-active' : ''}"
             data-value="${this.escHtml(String(value))}"
             onclick="window._scDashboard
                          ._applyColumnFilter('${colKey}',
                              '${this.escHtml(String(value))}')">
            ${isActive
                    ? '<i class="fas fa-check sc-col-filter-check"></i>'
                    : '<i class="fas fa-circle sc-col-filter-dot"></i>'}
            <span class="sc-col-filter-option-label">
                ${this.escHtml(String(label || value || '— ריק —'))}
            </span>
            <span class="sc-col-filter-option-count">${count}</span>
        </div>`;
        };

        const allOption = buildOption(
            'all', 'הכל', currentVal === 'all', this.allSystems.length
        );

        const optionsHtml = uniqueValues
            .map(v => buildOption(
                v, v,
                currentVal === v,
                this._countForFilter(colKey, v)
            )).join('');

        const emptyOption = emptyCount > 0
            ? buildOption(
                '__empty__', '— ריק —',
                currentVal === '__empty__',
                emptyCount
            )
            : '';

        const clearBtn = currentVal !== 'all'
            ? `<div class="sc-col-filter-clear"
            onclick="window._scDashboard
                         ._applyColumnFilter('${colKey}', 'all')">
           <i class="fas fa-times"></i>
           נקה פילטר
       </div>`
            : '';

        return `
    <div class="sc-col-filter-inner">
        ${sortIndicator}
        ${searchHtml}
        <div class="sc-col-filter-options" id="scColOpts_${colKey}">
            ${allOption}
            ${optionsHtml}
            ${emptyOption}
        </div>
        ${clearBtn}
    </div>`;
    }

    // ══════════════════════════════════════════════════════════
    // ספור מערכות לפי ערך פילטר
    // ══════════════════════════════════════════════════════════
    _countForFilter(colKey, value) {
        if (value === 'all') return this.allSystems.length;

        if (value === '__empty__') {
            return this.allSystems.filter(s =>
                !s[colKey] || String(s[colKey]).trim() === ''
            ).length;
        }

        return this.allSystems.filter(s =>
            (s[colKey] || '') === value
        ).length;
    }

    // ══════════════════════════════════════════════════════════
    // החל פילטר מהכותרת
    // ══════════════════════════════════════════════════════════
    _applyColumnFilter(colKey, value) {
        this.filters[colKey] = value;
        this._savePreferences();
        this.applyFiltersAndSort();
        this.renderContent();
        this.updateStats();

        const popup = document.getElementById(`scThFilter_${colKey}`);
        if (popup) popup.style.display = 'none';
    }

    // ══════════════════════════════════════════════════════════
    // סינון אפשרויות בתוך popup
    // ══════════════════════════════════════════════════════════
    _filterColumnOptions(inputEl, colKey) {
        const term = (inputEl.value || '').toLowerCase().trim();
        const container = document.getElementById(`scColOpts_${colKey}`);
        if (!container) return;

        container.querySelectorAll('.sc-col-filter-option').forEach(opt => {
            const label = (opt.querySelector(
                '.sc-col-filter-option-label'
            )?.textContent || '').toLowerCase();
            const value = (opt.dataset.value || '').toLowerCase();

            if (opt.dataset.value === 'all') {
                opt.style.display = '';
                return;
            }

            opt.style.display = (
                !term ||
                label.includes(term) ||
                value.includes(term)
            ) ? '' : 'none';
        });
    }

    _stripTime(dateStr) {
        if (!dateStr) return '';
        // חתוך הכל אחרי הרווח הראשון (מסיר שעה)
        return dateStr.split(' ')[0];
    }

    renderCards() {
        const content = document.getElementById('scContent');
        if (!content) return;

        const { page, total, pages } = this._getPaginationInfo();

        if (this.filteredSystems.length === 0) {
            content.innerHTML = `
            <div class="sc-empty">
                <i class="fas fa-layer-group"></i>
                <p>לא נמצאו מערכות</p>
            </div>`;
            this.renderPagination(0, 0);
            return;
        }

        const cardsHtml = page.map(s => {
            const statusClass = this._getStatusClass(s.status);
            const critClass = this._getCriticalityClass(s.businessCriticality);
            const envClass = this._getEnvClass(s.environment);

            return `
            <div class="sc-card" data-id="${this.escHtml(s.id || '')}">
                <div class="sc-card-header">
                    <div class="sc-card-number">#${this.escHtml(String(s.number || ''))}</div>
                    <div class="sc-card-title-wrap">
                       <div class="sc-card-name sc-system-name-link"
                            data-system-name="${this.escHtml(s.name || '')}"
                            title="לחץ לצפייה בשרתים של: ${this.escHtml(s.name || '')}">
                            ${this.escHtml(s.name || '')}
                        </div>
                        <div class="sc-card-name-en"
                             title="${this.escHtml(s.nameEn || '')}">
                            ${this.escHtml(s.nameEn || '')}
                        </div>
                    </div>
                    <div class="sc-card-badges">
                        <span class="sc-badge ${statusClass}">
                            ${this.escHtml(s.status || '')}
                        </span>
                        <span class="sc-badge ${critClass}">
                            ${this.escHtml(s.businessCriticality || '')}
                        </span>
                    </div>
                </div>
                ${this._cleanDescription(s.description) ? `
                <div class="sc-card-desc">
                    ${this.escHtml(this._cleanDescription(s.description))}
                </div>` : ''}
                <div class="sc-card-body">
                    ${s.systemManager ? `
                    <div class="sc-card-row">
                        <i class="fas fa-user-tie"></i>
                        <span>${this.escHtml(s.systemManager)}</span>
                    </div>` : ''}
                    ${s.departmentManager ? `
                    <div class="sc-card-row">
                        <i class="fas fa-user-shield"></i>
                        <span>${this.escHtml(s.departmentManager)}</span>
                    </div>` : ''}
                    ${s.department ? `
                    <div class="sc-card-row">
                        <i class="fas fa-building"></i>
                        <span>${this.escHtml(s.department)}</span>
                    </div>` : ''}
                    ${s.team ? `
                    <div class="sc-card-row">
                        <i class="fas fa-users"></i>
                        <span>${this.escHtml(s.team)}</span>
                    </div>` : ''}
                    ${s.domain ? `
                    <div class="sc-card-row">
                        <i class="fas fa-sitemap"></i>
                        <span>${this.escHtml(s.domain)}</span>
                    </div>` : ''}
                    ${s.appType ? `
                    <div class="sc-card-row">
                        <i class="fas fa-cube"></i>
                        <span>${this.escHtml(s.appType)}</span>
                    </div>` : ''}
                    ${s.supportVendor ? `
                    <div class="sc-card-row">
                        <i class="fas fa-headset"></i>
                        <span>${this.escHtml(s.supportVendor)}</span>
                    </div>` : ''}
                </div>
                <div class="sc-card-footer">
                    ${s.environment ? `
                    <span class="sc-badge ${envClass}">
                        ${this.escHtml(s.environment)}
                    </span>` : ''}
                    ${s.availabilityRequirement ? `
                    <span class="sc-badge sc-badge-avail">
                        ${this.escHtml(s.availabilityRequirement)}
                    </span>` : ''}
                    ${s.hasAutomation && s.hasAutomation !== 'לא קיימות' ? `
                    <div class="sc-card-automation">
                        ${this._renderAutomationBadge(s.hasAutomation, s.automationNote)}
                    </div>` : ''}
                    ${(this.isAdmin || this.isAutomationOnly) ? `
                    <button class="sc-row-edit-btn sc-card-edit-btn"
                            data-id="${this.escHtml(s.id || '')}"
                            title="${this.isAdmin ? 'ערוך מערכת' : 'ערוך אוטומציה'}">
                        <i class="fas ${this.isAdmin ? 'fa-edit' : 'fa-robot'}"></i>
                    </button>` : ''}
                </div>
            </div>`;
        }).join('');

        content.innerHTML = `
        <div class="sc-cards-grid">${cardsHtml}</div>`;

        this.renderPagination(total, pages);
    }

    renderStatsView() {

        const content = document.getElementById('scContent');
        if (!content) return;

        // הסתר header-left ו-stats-bar
        const filters = document.querySelector('.sc-filters-toggle-row');
        if (filters) filters.style.display = 'none';
        const search = document.querySelector('.sc-search-input');
        if (search) search.style.display = 'none';

        const statsBar = document.getElementById('scStatsBar');
        if (statsBar) statsBar.style.display = 'none';

        const s = this.allSystems;
        const total = s.length;

        const active = s.filter(x => x.status === 'פעילה').length;
        const inactive = s.filter(x => x.status === 'לא פעילה').length;

        const byStatus = this._groupBy(s, x => x.status || 'לא ידוע');
        const byDomain = this._groupBy(s, x => x.domain || 'לא ידוע');
        const byDept = this._groupBy(s, x => x.department || 'לא ידוע');
        const byCriticality = this._groupBy(s, x => x.businessCriticality || 'לא ידוע');
        const byAppType = this._groupBy(s, x => x.appType || 'לא ידוע');
        const byEnv = this._groupBy(s, x => x.environment || 'לא ידוע');
        const byTeam = this._groupBy(s, x => x.team || 'לא ידוע');
        const byManager = this._groupBy(s, x => x.systemManager || 'לא ידוע');
        const byAvailability = this._groupBy(s, x => x.availabilityRequirement || 'לא ידוע');

        content.innerHTML = `
        <div class="sc-stats-view">
            <div class="sc-kpi-grid">
                ${this._kpiCard('fas fa-layer-group', 'סה"כ מערכות', total, '#6366f1')}
                ${this._kpiCard('fas fa-check-circle', 'פעילות', active, '#22c55e')}
                ${this._kpiCard('fas fa-times-circle', 'לא פעילות', inactive, '#ef4444')}
                ${this._kpiCard('fas fa-user-cog', 'מנהלי מערכת', Object.keys(byManager).length, '#3b82f6')}
                ${this._kpiCard('fas fa-cube', 'צוותים', Object.keys(byTeam).length, '#f59e0b')}
                ${this._kpiCard('fas fa-building', 'מחלקות', Object.keys(byDept).length, '#8b5cf6')}
                ${this._kpiCard('fas fa-sitemap', 'תחומים', Object.keys(byDomain).length, '#3b82f6')}
                ${this._kpiCard(
            'fas fa-robot',
            'עם אוטומציה',
            s.filter(x => x.hasAutomation === 'קיימות').length,
            '#22c55e'
        )}
            </div>

            <div class="sc-charts-grid">
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-circle-dot"></i> לפי סטטוס
                    </div>
                    ${this._renderBarChart(byStatus, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-exclamation-triangle"></i> לפי קריטיות עסקית
                    </div>
                    ${this._renderBarChart(byCriticality, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-cube"></i> לפי דרישת זמינות
                    </div>
                    ${this._renderBarChart(byAvailability, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-industry"></i> לפי סביבה
                    </div>
                    ${this._renderBarChart(byEnv, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-user-cog"></i> לפי מנהל מערכת
                    </div>
                    ${this._renderBarChart(byManager, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-users"></i> לפי צוות
                    </div>
                    ${this._renderBarChart(byTeam, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-building"></i> לפי מחלקה
                    </div>
                    ${this._renderBarChart(byDept, total)}
                </div>
                <div class="sc-chart-card">
                    <div class="sc-chart-title">
                        <i class="fas fa-sitemap"></i> לפי תחום
                    </div>
                    ${this._renderBarChart(byDomain, total)}
                </div>
            </div>
        </div>`;

        const pag = document.getElementById('scPagination');
        if (pag) pag.innerHTML = '';
    }

    _kpiCard(icon, label, value, color) {
        return `
        <div class="sc-kpi-card" style="border-top:3px solid ${color}">
            <div class="sc-kpi-icon" style="color:${color}">
                <i class="${icon}"></i>
            </div>
            <div class="sc-kpi-value" style="color:${color}">${value}</div>
            <div class="sc-kpi-label">${label}</div>
        </div>`;
    }

    _renderBarChart(groupMap, total) {
        const colors = [
            '#6366f1', '#3b82f6', '#22c55e', '#f59e0b',
            '#ef4444', '#8b5cf6', '#10b981', '#f43f5e',
            '#06b6d4', '#84cc16'
        ];
        const sorted = Object.entries(groupMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        return sorted.map(([label, count], i) => {
            const pct = total > 0
                ? Math.round((count / total) * 100) : 0;
            return `
            <div class="sc-bar-row">
                <div class="sc-bar-label" title="${this.escHtml(label)}">
                    ${this.escHtml(label)}
                </div>
                <div class="sc-bar-track">
                    <div class="sc-bar-fill"
                         style="width:${pct}%;
                                background:${colors[i % colors.length]}">
                    </div>
                </div>
                <div class="sc-bar-count">${count}</div>
            </div>`;
        }).join('');
    }

    // ══════════════════════════════════════════════════════════
    // Stats Bar - עם מחזוריות בין ערכים
    // ══════════════════════════════════════════════════════════
    updateStats() {
        const bar = document.getElementById('scStatsBar');
        if (!bar) return;

        const s = this.allSystems;
        const total = s.length;
        const f = this.filters;

        // ─── פונקציה ליצירת pill עם מחזוריות ערכים ───
        const cyclePill = (filterKey, label, color, icon, values) => {
            const currentValue = f[filterKey] || 'all';
            const isActive = currentValue !== 'all';

            // ── קבע צבע לפי מצב תצוגה ──
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const lightColorMap = {
                '#86efac': '#16a34a',
                '#fca5a5': '#dc2626',
                '#67e8f9': '#0e7490',
                '#c4b5fd': '#7c3aed',
                '#fcd34d': '#b45309',
                '#93c5fd': '#1d4ed8',
            };
            const activeColor = isLight ? (lightColorMap[color] || color) : color;

            const currentIndex = values.indexOf(currentValue);
            const nextIndex = (currentIndex + 1) % values.length;
            const nextValue = values[nextIndex];

            // ספירה לערך הנוכחי
            let count = 0;
            if (currentValue !== 'all') {
                count = s.filter(sys => {
                    const val = sys[filterKey] || '';
                    return val === currentValue;
                }).length;
            }

            return `
        <div class="sc-stat-pill sc-stat-pill-clickable
                    ${isActive ? 'sc-stat-pill-active' : ''}"
            data-filter-key="${filterKey}"
            data-values='${JSON.stringify(values)}'
            style="color:${activeColor};border-color:${activeColor}33"
            title="${label}${isActive ? ': ' + currentValue : ''} (לחץ למחזור)">
            <i class="${icon}"></i>
            <span>${label}${isActive ? ': ' + currentValue : ''}</span>
            ${isActive ? `<span class="sc-stat-pill-count">${count}</span>` : ''}
            ${isActive ? `<i class="fas fa-times sc-stat-pill-clear"
                            data-filter-key="${filterKey}"></i>` : ''}
        </div>`;
        };

        // ─── הגדרת ערכים אפשריים לכל פילטר ───
        const statusValues = ['all', 'פעילה', 'לא פעילה', 'בהקמה', 'פיילוט', 'מבוטלת'];
        const criticalityValues = ['all', 'גבוהה', 'בינונית', 'נמוכה'];
        const availabilityValues = ['all', ...this._getUniqueValues('availabilityRequirement')];
        const envValues = ['all', ...this._getUniqueValues('environment')];
        const appClassValues = ['all', ...this._getUniqueValues('appClassification')];
        const appTypeValues = ['all', ...this._getUniqueValues('appType')];

        bar.innerHTML = `
        <div class="sc-stat-pill" style="color:#a5b4fc;border-color:#6366f133">
            <i class="fas fa-layer-group"></i>
            <span>סה"כ: ${total}</span>
        </div>
        
        ${cyclePill('status', 'סטטוס', '#86efac', 'fa-circle-dot', statusValues)}
        
        ${cyclePill('businessCriticality', 'קריטיות', '#fca5a5', 'fa-exclamation-triangle', criticalityValues)}
        
        ${cyclePill('availabilityRequirement', 'זמינות', '#67e8f9', 'fa-clock', availabilityValues)}
        
        ${cyclePill('environment', 'סביבה', '#c4b5fd', 'fa-industry', envValues)}
        
        ${cyclePill('appClassification', 'סיווג', '#fcd34d', 'fa-tag', appClassValues)}
        
        ${cyclePill('appType', 'סוג', '#93c5fd', 'fa-cube', appTypeValues)}

        ${cyclePill('hasAutomation', 'אוטומציה', '#86efac', 'fa-robot',
            ['all', 'קיימות', 'לא קיימות', 'לא רלוונטי'])}
    `;

        this._populateDropdownFilters();
        this._renderActiveFilterTags();
        this._updateMultiInStatsBar();
    }

    _updateMultiInStatsBar() {
        const bar = document.getElementById('scStatsBar');
        if (!bar) return;

        // הסר multi-info קיים
        bar.querySelector('.sc-multi-inline')?.remove();

        if (!this.isAdmin || this.selectedSystems.size === 0) return;

        const count = this.selectedSystems.size;

        const multiEl = document.createElement('div');
        multiEl.className = 'sc-multi-inline';
        multiEl.style.cssText = `
        display:flex;align-items:center;gap:8px;
        margin-right:auto;padding:0 4px;
        border-right:1px solid rgba(99,102,241,0.25);
        padding-right:12px;
    `;
        multiEl.innerHTML = `
        <span style="font-size:0.78rem;font-weight:700;color:#a5b4fc;
                     display:flex;align-items:center;gap:5px">
            <i class="fas fa-check-square" style="color:#6366f1"></i>
            ${count} נבחרו
        </span>
        <button id="scMultiClearInline"
                style="background:none;border:none;color:#666;
                       cursor:pointer;font-size:0.7rem;padding:1px 4px;
                       border-radius:3px;transition:color 0.15s;
                       font-family:inherit"
                title="בטל בחירה">
            <i class="fas fa-times"></i>בטל בחירה
        </button>
        <button id="scMultiEditInline"
                style="padding:3px 10px;
                       background:rgba(99,102,241,0.2);
                       border:1px solid rgba(99,102,241,0.45);
                       border-radius:5px;color:#a5b4fc;
                       font-size:0.75rem;font-weight:600;
                       cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;gap:4px">
            <i class="fas fa-edit"></i> ערוך נבחרים
        </button>
        <button id="scMultiDeleteInline"
                style="padding:3px 10px;
                       background:rgba(239,68,68,0.12);
                       border:1px solid rgba(239,68,68,0.35);
                       border-radius:5px;color:#fca5a5;
                       font-size:0.75rem;font-weight:600;
                       cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;gap:4px">
            <i class="fas fa-trash-alt"></i> מחק נבחרים
        </button>
        <button id="scBulkValidateBtn"
                style="padding:3px 10px;
                       background:rgba(245,158,11,0.12);
                       border:1px solid rgba(245,158,11,0.35);
                       border-radius:5px;color:#fcd34d;
                       font-size:0.75rem;font-weight:600;
                       cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;gap:4px">
            <i class="fas fa-envelope"></i> שלח תיקוף לנבחרים
        </button>
    `;

        bar.appendChild(multiEl);

        // אירועים
        document.getElementById('scMultiClearInline')?.addEventListener('click', () => {
            this.selectedSystems.clear();
            document.querySelectorAll('.sc-cb-row').forEach(cb => {
                cb.checked = false;
                cb.closest('tr.sc-tr')?.classList.remove('sc-tr-selected');
            });
            const cbAll = document.querySelector('.sc-cb-all');
            if (cbAll) cbAll.checked = false;
            this._updateMultiToolbar();
        });

        document.getElementById('scMultiEditInline')?.addEventListener('click', () => {
            this.openMultiEditModal();
        });

        document.getElementById('scMultiDeleteInline')?.addEventListener('click', () => {
            this._openMultiDeleteModal();
        });

        document.getElementById('scBulkValidateInline')?.addEventListener('click', () => {
            this._openBulkValidationModal();
        });
    }

    // ─── פונקציית עזר לקבלת ערכים ייחודיים ───────────────────
    _getUniqueValues(field) {
        return [...new Set(
            this.allSystems
                .map(s => s[field])
                .filter(v => v && v.trim() !== '')
        )].sort((a, b) => String(a).localeCompare(String(b), 'he'));
    }

    // ─── פונקציית עזר לתרגום שמות פילטרים ─────────────────────
    _getFilterLabel(filterKey) {
        const labels = {
            status: 'סטטוס',
            businessCriticality: 'קריטיות עסקית',
            availabilityRequirement: 'דרישת זמינות',
            environment: 'סביבה',
            appClassification: 'סיווג יישום',
            appType: 'סוג יישום',
            domain: 'תחום',
            department: 'מחלקה',
            team: 'צוות',
            systemManager: 'מנהל מערכת',
            departmentManager: 'מנהל מחלקה',
            publisher: 'מפרסם',
            supportVendor: 'ספק תמיכה',
        };
        return labels[filterKey] || filterKey;
    }

    // הוסף פונקציה חדשה לשני הקבצים:
    _normalizeDeptValue(value) {
        if (!value) return '';
        return value
            .trim()
            // נרמל & ו-, ו-ו- לצורת השוואה אחידה
            .replace(/\s*&\s*/g, ' ו-')
            .replace(/\s*,\s*/g, ' ו-')
            .replace(/\s+ו-\s+/g, ' ו-')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    // ══════════════════════════════════════════════════════════════
    // Auto-fill ארגוני לכל המערכות (Bulk)
    // ══════════════════════════════════════════════════════════════
    async _autoFillOrgInfoBulk() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לביצוע פעולה זו', 'error');
            return;
        }

        const managers = [...new Set(
            this.allSystems
                .map(s => (s.systemManager || '').trim())
                .filter(m => m.length >= 2)
        )];

        if (managers.length === 0) {
            this.showToast('לא נמצאו מנהלי מערכת', 'error');
            return;
        }

        this.showToast(`מחפש נתונים עבור ${managers.length} מנהלים...`, 'info', 10 * 1000);

        // ─── שלב 1: אסוף נתוני ארגון לכל מנהל ──────────────────
        const managerOrgMap = {};
        let fetchedCount = 0;
        let notFoundCount = 0;
        const notFoundList = [];

        for (const managerName of managers) {
            try {
                const res = await fetch(
                    `/PhoneDirectory/GetEmployeeOrgInfo?name=${encodeURIComponent(managerName)}`,
                    { credentials: 'include' }
                );
                const data = await res.json();

                if (data.success && data.employee) {
                    managerOrgMap[managerName] = {
                        fullName: data.employee.fullName || '',
                        team: data.employee.team || '',
                        department: data.employee.department || '',
                        domain: data.employee.domain || '',
                    };
                    fetchedCount++;
                } else {
                    notFoundCount++;
                    notFoundList.push(managerName);
                }
            } catch (err) {
                notFoundCount++;
                notFoundList.push(managerName);
                console.error(`❌ שגיאה עבור "${managerName}":`, err.message);
            }

            await new Promise(r => setTimeout(r, 80));
        }


        // ─── שלב 1.5: אסוף מנהלי מחלקה לפי מחלקה ──────────────────
        const departmentManagerMap = {};

        // ─── אסוף כל המחלקות הייחודיות ───
        const uniqueDepartments = [...new Set(
            this.allSystems
                .map(s => (s.department || '').trim())
                .filter(d => d.length >= 2)
        )];

        // ─── גם מחלקות שנמצאו מהמנהלים ───
        Object.values(managerOrgMap).forEach(org => {
            if (org.department && !uniqueDepartments.includes(org.department)) {
                uniqueDepartments.push(org.department);
            }
        });

        for (const dept of uniqueDepartments) {
            try {
                const res = await fetch(
                    `/PhoneDirectory/GetDepartmentManager?department=${encodeURIComponent(dept)}`,
                    { credentials: 'include' }
                );
                const data = await res.json();

                if (data.success && data.departmentManager) {
                    departmentManagerMap[dept] = data.departmentManager;
                }
            } catch (err) {
                console.warn(`לא נמצא מנהל מחלקה עבור "${dept}":`, err.message);
            }

            await new Promise(r => setTimeout(r, 50));
        }

        // ─── שלב 2: בנה טבלת כל הנתונים (קיים + חדש) ───────────
        const FIELDS = ['team', 'department', 'domain', 'departmentManager'];
        const FIELD_LABELS = {
            team: 'צוות',
            department: 'מחלקה',
            domain: 'תחום',
            departmentManager: 'מנהל מחלקה',
        };

        const allRows = [];        // כל השורות לאקסל
        const plannedChanges = []; // רק שינויים

        for (const sys of this.allSystems) {
            const managerName = (sys.systemManager || '').trim();
            const orgInfo = managerOrgMap[managerName] || null;

            for (const field of FIELDS) {
                const oldVal = (sys[field] || '').trim();
                let newVal = '';
                if (field === 'departmentManager') {
                    // ─── מנהל מחלקה: חפש לפי המחלקה של המנהל ───
                    const dept = orgInfo ? (orgInfo.department || '').trim() :
                        (sys.department || '').trim();
                    newVal = dept ? (departmentManagerMap[dept] || '') : '';
                } else {
                    newVal = orgInfo ? (orgInfo[field] || '').trim() : '';
                }

                let status = '';
                if (!managerName) {
                    status = 'אין מנהל';
                } else if (!orgInfo) {
                    status = 'מנהל לא נמצא';
                } else if (!newVal) {
                    status = 'אין ערך חדש';
                } else if (this._normalizeDeptValue(oldVal) === this._normalizeDeptValue(newVal)) {
                    status = 'זהה - אין שינוי';
                } else if (!oldVal) {
                    status = 'מילוי חדש';
                } else {
                    status = 'שינוי';
                }

                allRows.push({
                    systemName: sys.name || '',
                    systemNumber: String(sys.number || ''),
                    manager: managerName,
                    managerFound: orgInfo ? 'כן' : 'לא',
                    field: FIELD_LABELS[field],
                    oldVal: oldVal || '',
                    newVal: newVal || '',
                    status,
                });

                const notFoundManagersAdded = new Set();

                // ─── אסוף שינויים בלבד ───────────────────────────
                if (!orgInfo && managerName && !notFoundManagersAdded.has(managerName)) {
                    notFoundManagersAdded.add(managerName);

                    plannedChanges.push({
                        systemId: sys.id,
                        systemName: sys.name,
                        field: '',
                        fieldLabel: 'מנהל מערכת',
                        oldVal: '',
                        newVal: 'מנהל לא נמצא',
                        manager: managerName,
                        selected: false,
                        infoOnly: true
                    });
                }
                else if (newVal && this._normalizeDeptValue(oldVal) !== this._normalizeDeptValue(newVal)) {
                    plannedChanges.push({
                        systemId: sys.id,
                        systemName: sys.name,
                        field,
                        fieldLabel: FIELD_LABELS[field],
                        oldVal: oldVal || '(ריק)',
                        newVal,
                        manager: managerName,
                        selected: true,
                        infoOnly: false
                    });
                }
            }
        }

        // ─── שלב 4: הצג מודל תצוגה מקדימה ──────────────────────
        const result = await this._showBulkPreviewModal(
            allRows,
            plannedChanges,
            fetchedCount,
            notFoundCount,
            notFoundList
        );

        if (!result) {
            this.showToast('הפעולה בוטלה', 'info');
            return;
        }

        if (result === 'export_only') {
            await this._exportBulkToExcel(allRows, plannedChanges);
            return;
        }

        // ─── סנן רק שינויים שנבחרו ───
        const selectedChanges = plannedChanges.filter(c => c.selected);

        if (selectedChanges.length === 0) {
            this.showToast('✅ לא נבחרו שינויים להחיל', 'info');
            return;
        }

        let appliedCount = 0;
        for (const change of selectedChanges) {
            const sys = this.allSystems.find(s => s.id === change.systemId);
            if (!sys) continue;
            sys[change.field] = change.newVal;
            appliedCount++;
        }

        // ─── שלב 6: שמור לשרת ────────────────────────────────────
        try {
            this.showToast('שומר שינויים...', 'info');

            const res = await fetch('/SystemsCatalog/SaveSystems', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ systems: this.allSystems })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'שגיאה בשמירה');

            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this._populateDropdownFilters();

            const affectedSystems = new Set(
                selectedChanges.map(c => c.systemId)
            ).size;

            this.showToast(
                `✅ עודכנו ${affectedSystems} מערכות (${appliedCount} שינויים)`,
                'success'
            );

            // ─── ייצוא אחרי שמירה ────────────────────────────────
            if (result === 'apply_and_export') {
                await this._exportBulkToExcel(allRows, plannedChanges);
            }

        } catch (err) {
            console.error('שגיאה בשמירה:', err);
            this.showToast('שגיאה בשמירה: ' + err.message, 'error');

            // ─── Rollback - רק שינויים שהוחלו ───
            for (const change of selectedChanges) {
                const sys = this.allSystems.find(s => s.id === change.systemId);
                if (sys) {
                    sys[change.field] = change.oldVal === '(ריק)' ? '' : change.oldVal;
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // מודל תצוגה מקדימה - Auto-fill Bulk
    // ══════════════════════════════════════════════════════════════
    _showBulkPreviewModal(allRows, plannedChanges, fetchedCount, notFoundCount, notFoundList) {
        return new Promise(resolve => {
            const existing = document.getElementById('scBulkPreviewModal');
            if (existing) existing.remove();

            // ─── שמור reference לשינויים ───
            this._bulkPlannedChanges = plannedChanges;

            const statusColors = {
                'שינוי': { bg: 'rgba(245,158,11,0.15)', color: '#fcd34d', border: 'rgba(245,158,11,0.4)' },
                'מילוי חדש': { bg: 'rgba(34,197,94,0.12)', color: '#86efac', border: 'rgba(34,197,94,0.35)' },
                'זהה - אין שינוי': { bg: 'rgba(107,114,128,0.1)', color: '#9ca3af', border: 'rgba(107,114,128,0.25)' },
                'אין ערך חדש': { bg: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: 'rgba(99,102,241,0.25)' },
                'מנהל לא נמצא': { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: 'rgba(239,68,68,0.35)' },
                'אין מנהל': { bg: 'rgba(107,114,128,0.08)', color: '#6b7280', border: 'rgba(107,114,128,0.2)' },
            };

            // ─── סטטיסטיקות ───
            const byStatus = {};
            allRows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

            const statsHtml = Object.entries(byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => {
                    const cfg = statusColors[status] || {
                        bg: 'rgba(255,255,255,0.05)', color: '#aaa',
                        border: 'rgba(255,255,255,0.1)'
                    };
                    return `
                <div style="display:flex;align-items:center;gap:8px;
                            padding:6px 12px;border-radius:8px;
                            background:${cfg.bg};border:1px solid ${cfg.border};
                            color:${cfg.color};font-size:0.8rem;font-weight:600;
                            white-space:nowrap">
                    <span>${this.escHtml(status)}</span>
                    <span style="background:rgba(255,255,255,0.15);padding:1px 7px;
                                 border-radius:8px;font-size:0.72rem">${count}</span>
                </div>`;
                }).join('');

            // ─── קבץ שינויים זהים לפי מנהל + שדה + ערך ───
            const changesByManager = {};
            plannedChanges.forEach((change, globalIdx) => {
                const mgr = change.manager || '(ללא מנהל)';
                if (!changesByManager[mgr]) changesByManager[mgr] = {};

                const changeKey = `${change.field}||${change.oldVal}||${change.newVal}`;

                if (!changesByManager[mgr][changeKey]) {
                    changesByManager[mgr][changeKey] = {
                        field: change.field,
                        fieldLabel: change.fieldLabel,
                        oldVal: change.oldVal,
                        newVal: change.newVal,
                        manager: mgr,
                        indices: [],
                        selected: true,
                        infoOnly: change.infoOnly
                    };
                }
                changesByManager[mgr][changeKey].indices.push(globalIdx);
            });

            // ─── שמור מפה לשימוש ב-checkboxes ───
            this._bulkGroupMap = changesByManager;
            const sortedManagers = Object.entries(changesByManager)
                .sort(([, a], [, b]) => {

                    const aInfoOnly = Object.values(a)
                        .every(x => x.infoOnly);

                    const bInfoOnly = Object.values(b)
                        .every(x => x.infoOnly);

                    if (aInfoOnly && !bInfoOnly) return 1;
                    if (!aInfoOnly && bInfoOnly) return -1;

                    return 0;
                });

            const tableRowsHtml = sortedManagers
                .map(([manager, changeMap]) => {
                    const changeEntries = Object.values(changeMap)
                        .sort((a, b) => {
                            if (a.infoOnly && !b.infoOnly) return 1;
                            if (!a.infoOnly && b.infoOnly) return -1;
                            return 0;
                        });
                    const totalChanges = changeEntries.reduce(
                        (s, c) => s + c.indices.length, 0
                    );

                    const isInfoOnlyManager =
                        changeEntries.every(c => c.infoOnly);
                    const managerHeader = `
                <tr style="background:rgba(99,102,241,0.08);
                           border-bottom:1px solid rgba(99,102,241,0.2)">
                    <td style="padding:6px 10px;width:32px">
                ${isInfoOnlyManager
                            ? `<i class="fas fa-exclamation-triangle"
                        style="color:#fca5a5"
                        title="מנהל לא נמצא"></i>`
                            : `<input type="checkbox"
                        class="sc-bulk-manager-cb"
                        data-manager="${this.escHtml(manager)}"
                        checked
                        style="accent-color:#6366f1;width:14px;
                                height:14px;cursor:pointer">`
                        }
                    </td>
                    <td colspan="5"
                        style="padding:6px 10px;color:#a5b4fc;
                               font-weight:700;font-size:0.8rem">
                        <i class="fas fa-user-tie"
                           style="color:#6366f1;margin-left:6px"></i>
                        ${this.escHtml(manager)}
                        ${isInfoOnlyManager
                            ? `<span style="
                            background:rgba(239,68,68,0.15);
                            padding:1px 7px;
                            border-radius:8px;
                            font-size:0.72rem;
                            margin-right:8px;
                            color:#fca5a5">
                            מנהל לא נמצא
                        </span>`
                            : `<span style="
                            background:rgba(99,102,241,0.2);
                            padding:1px 7px;
                            border-radius:8px;
                            font-size:0.72rem;
                            margin-right:8px">
                            ${totalChanges} שינויים
                            (${changeEntries.length} ייחודיים)
                        </span>`
                        }
                    </td>
                </tr>`;

                    const changeRows = changeEntries.map(c => {
                        const groupKey = `${manager}||${c.field}||${c.oldVal}||${c.newVal}`;
                        const count = c.indices.length;

                        return `
        ${c.infoOnly ? `
        <tr>
            <td colspan="4"
                style="padding:6px 10px;
                    color:#fca5a5;
                    font-size:0.75rem;
                    font-weight:700">
                ${this.escHtml(c.fieldLabel)} - מנהל לא נמצא
            </td>
        </tr>
    ` : `
        <tr>
            <td style="padding:4px 10px;color:#aaa;font-size:0.75rem">
                ${this.escHtml(c.fieldLabel)}
            </td>
            <td style="padding:4px 10px;font-size:0.75rem;
                    color:#fca5a5;text-decoration:line-through;
                    opacity:0.8">
                ${this.escHtml(c.oldVal || '(ריק)')}
            </td>
            <td style="padding:4px 10px;color:#555;font-size:0.72rem">
                ←
            </td>
            <td style="padding:4px 10px;font-size:0.75rem;
                    color:#86efac;font-weight:600">
                ${this.escHtml(c.newVal)}
            </td>
        </tr>
    `}
    `;
                    }).join('');

                    return managerHeader + changeRows;
                }).join('');

            const modal = document.createElement('div');
            modal.id = 'scBulkPreviewModal';
            modal.className = 'sc-modal-overlay';

            modal.innerHTML = `
    <div class="sc-modal" style="max-width:1100px;width:96%">

        <!-- כותרת -->
        <div class="sc-modal-header" style="
            border-bottom:2px solid rgba(99,102,241,0.35);
            background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(124,58,237,0.05))">
            <h3 class="sc-modal-title">
                <i class="fas fa-magic" style="color:#6366f1"></i>
                Auto-fill ארגוני - תצוגה מקדימה
            </h3>
            <button class="sc-modal-close" id="srvBulkPreviewClose">&times;</button>
        </div>

        <!-- גוף -->
        <div class="sc-modal-body" style="max-height:70vh;overflow-y:auto;gap:14px;padding:16px 20px">

            <!-- סיכום מנהלים -->
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;
                        background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.07);
                        border-radius:8px;flex-wrap:wrap">
                <span style="font-size:0.82rem;color:#888">
                    <i class="fas fa-users" style="color:#6366f1"></i>
                    מנהלים: <strong style="color:#a5b4fc">${fetchedCount + notFoundCount}</strong>
                </span>
                <span style="font-size:0.82rem;color:#86efac">
                    <i class="fas fa-check-circle"></i>
                    נמצאו: <strong>${fetchedCount}</strong>
                </span>
                ${notFoundCount > 0 ? `
                <span style="font-size:0.82rem;color:#fca5a5"
                        title="${this.escHtml(notFoundList.join(', '))}">
                    <i class="fas fa-question-circle"></i>
                    לא נמצאו: <strong>${notFoundCount}</strong>
                </span>` : ''}
                <span style="font-size:0.82rem;color:#fcd34d;margin-right:auto">
                    <i class="fas fa-edit"></i>
                    שינויים צפויים: <strong id="srvBulkSelectedCount">${plannedChanges.length}</strong>
                    מתוך <strong>${plannedChanges.length}</strong>
                </span>
            </div>

            <!-- סטטיסטיקות לפי סטטוס -->
            <div style="display:flex;gap:8px;flex-wrap:wrap">${statsHtml}</div>

            <!-- כפתורי בחר/בטל הכל -->
            ${plannedChanges.length > 0 ? `
            <div style="display:flex;align-items:center;gap:10px;
                        padding:8px 12px;background:rgba(99,102,241,0.06);
                        border:1px solid rgba(99,102,241,0.2);border-radius:8px;
                        flex-wrap:wrap">
                <span style="font-size:0.78rem;color:#888;font-weight:600">
                    <i class="fas fa-check-square" style="color:#6366f1"></i>
                    בחירת שינויים:
                </span>
                <button id="srvBulkSelectAll"
                        style="padding:4px 12px;background:rgba(34,197,94,0.12);
                                border:1px solid rgba(34,197,94,0.35);border-radius:5px;
                                color:#86efac;font-size:0.75rem;font-weight:600;
                                cursor:pointer;font-family:inherit">
                    <i class="fas fa-check-double"></i> בחר הכל
                </button>
                <button id="srvBulkDeselectAll"
                        style="padding:4px 12px;background:rgba(239,68,68,0.1);
                                border:1px solid rgba(239,68,68,0.3);border-radius:5px;
                                color:#fca5a5;font-size:0.75rem;font-weight:600;
                                cursor:pointer;font-family:inherit">
                    <i class="fas fa-times"></i> בטל הכל
                </button>
                <span style="font-size:0.75rem;color:#666;margin-right:auto">
                    סמן/בטל שינויים ספציפיים בטבלה למטה
                </span>
            </div>` : ''}

            <!-- טבלת שינויים עם Checkboxes -->
            ${plannedChanges.length > 0 ? `
            <div>
                <div style="font-size:0.78rem;font-weight:600;color:#777;
                            margin-bottom:8px;display:flex;align-items:center;gap:6px">
                    <i class="fas fa-eye" style="color:#6366f1"></i>
                    שינויים לפי מנהל מערכת (בחר אילו שינויים להחיל):
                </div>
                <div style="overflow-x:auto;border-radius:8px;
                            border:1px solid rgba(255,255,255,0.07)">
                    <table style="width:100%;border-collapse:collapse;
                                    font-size:0.8rem;direction:rtl">
                        <thead>
                            <tr style="background:#1a1a2e">
                                <th style="padding:8px 10px;color:#888;text-align:center;
                                            font-weight:600;border-bottom:2px solid #2a2a4e;
                                            width:36px">
                                    <input type="checkbox" id="srvBulkHeaderCb" checked
                                            style="accent-color:#6366f1;width:14px;height:14px;cursor:pointer"
                                            title="בחר/בטל הכל">
                                </th>
                                <th style="padding:8px 10px;color:#888;text-align:right;
                                            font-weight:600;border-bottom:2px solid #2a2a4e">שרת</th>
                                <th style="padding:8px 10px;color:#888;text-align:right;
                                            font-weight:600;border-bottom:2px solid #2a2a4e">שדה</th>
                                <th style="padding:8px 10px;color:#888;text-align:right;
                                            font-weight:600;border-bottom:2px solid #2a2a4e">ערך קיים</th>
                                <th style="padding:8px 10px;border-bottom:2px solid #2a2a4e;width:20px"></th>
                                <th style="padding:8px 10px;color:#888;text-align:right;
                                            font-weight:600;border-bottom:2px solid #2a2a4e">ערך חדש</th>
                            </tr>
                        </thead>
                        <tbody id="srvBulkChangesBody">
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>` : `
            <div style="display:flex;align-items:center;gap:10px;padding:16px;
                        background:rgba(107,114,128,0.08);border:1px solid rgba(107,114,128,0.2);
                        border-radius:8px;color:#888;font-size:0.85rem">
                <i class="fas fa-info-circle" style="color:#6366f1"></i>
                <span>לא נמצאו שינויים לביצוע. ניתן לייצא לאקסל לבדיקה.</span>
            </div>`}

            <!-- אזהרה -->
            ${plannedChanges.length > 0 ? `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;
                        background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);
                        border-radius:8px;font-size:0.8rem;color:#fcd34d;line-height:1.5">
                <i class="fas fa-exclamation-triangle" style="color:#f59e0b;flex-shrink:0;margin-top:2px"></i>
                <span>פעולת "החל שינויים" תדרוס ערכים קיימים. מומלץ לייצא לאקסל תחילה לבדיקה.</span>
            </div>` : ''}

        </div>

        <!-- Footer -->
        <div class="sc-modal-footer" style="gap:8px;flex-wrap:wrap">
            <button class="sc-modal-cancel-btn" id="srvBulkPreviewCancel">
                <i class="fas fa-times"></i> ביטול
            </button>

            <button id="srvBulkExportOnlyBtn"
                    style="padding:8px 16px;background:rgba(34,197,94,0.12);
                            border:1px solid rgba(34,197,94,0.4);border-radius:6px;
                            color:#86efac;font-size:0.85rem;font-weight:600;
                            cursor:pointer;display:flex;align-items:center;gap:6px;
                            transition:all 0.2s;font-family:inherit"
                    title="ייצא את כל הנתונים לאקסל ללא שינויים">
                <i class="fas fa-file-excel"></i> ייצא לאקסל
            </button>

            ${plannedChanges.length > 0 ? `

            <button id="srvBulkApplyOnlyBtn"
                    style="padding:8px 18px;
                            background:linear-gradient(135deg,#4f46e5,#7c3aed);
                            border:none;border-radius:6px;color:white;
                            font-size:0.85rem;font-weight:700;cursor:pointer;
                            display:flex;align-items:center;gap:6px;
                            transition:all 0.2s;font-family:inherit">
                <i class="fas fa-check"></i>
                החל שינויים
                (<span id="srvBulkApplyCount">${plannedChanges.length}</span>)
            </button>` : ''}
        </div>

    </div>`;

            document.body.appendChild(modal);

            // ─── פונקציה לעדכון מונה נבחרים ───
            const updateSelectedCount = () => {
                const selected = plannedChanges.filter(
                    c => !c.infoOnly && c.selected
                ).length;
                const countEl = document.getElementById('srvBulkSelectedCount');
                const applyCountEl = document.getElementById('srvBulkApplyCount');
                const applyBtn = document.getElementById('srvBulkApplyOnlyBtn');
                const applyExportBtn = document.getElementById('srvBulkApplyAndExportBtn');

                if (countEl) countEl.textContent = selected;
                if (applyCountEl) applyCountEl.textContent = selected;

                if (applyBtn) {
                    applyBtn.disabled = selected === 0;
                    applyBtn.style.opacity = selected === 0 ? '0.4' : '1';
                    applyBtn.style.cursor = selected === 0 ? 'not-allowed' : 'pointer';
                }
                if (applyExportBtn) {
                    applyExportBtn.disabled = selected === 0;
                    applyExportBtn.style.opacity = selected === 0 ? '0.4' : '1';
                    applyExportBtn.style.cursor = selected === 0 ? 'not-allowed' : 'pointer';
                }

                // ─── עדכן header checkbox ───
                const headerCb = document.getElementById('srvBulkHeaderCb');
                if (headerCb) {
                    const total = plannedChanges.filter(
                        c => !c.infoOnly
                    ).length;
                    headerCb.checked = selected === total;
                    headerCb.indeterminate = selected > 0 && selected < total;
                }
            };

            // ─── פונקציה לעדכון מראה שורה ───
            const updateRowAppearance = (idx, isSelected) => {
                const row = document.querySelector(
                    `.sc-bulk-change-row[data-idx="${idx}"]`
                );
                if (row) {
                    row.style.opacity = isSelected ? '1' : '0.35';
                    row.style.background = isSelected
                        ? ''
                        : 'rgba(107,114,128,0.05)';
                }
            };

            // ─── פונקציה לעדכון manager checkbox לפי מצב ילדיו ───
            const updateManagerCheckbox = (managerName) => {
                const managerCb = document.querySelector(
                    `.sc-bulk-manager-cb[data-manager="${CSS.escape(managerName)}"]`
                );
                if (!managerCb) return;

                const mgr = this._bulkGroupMap?.[managerName];
                if (!mgr) return;

                const groups = Object.values(mgr);
                const selectedCount = groups.filter(g => g.selected).length;
                const total = groups.length;

                managerCb.checked = selectedCount === total;
                managerCb.indeterminate = selectedCount > 0 && selectedCount < total;
            };

            // ─── אירוע: checkbox בודד לשינוי ───
            document.getElementById('srvBulkChangesBody')
                ?.addEventListener('change', e => {

                    // ── Checkbox קבוצה (שינויים זהים) ──
                    const groupCb = e.target.closest('.sc-bulk-group-cb');
                    if (groupCb) {
                        const groupKey = groupCb.dataset.groupKey;
                        const managerName = groupCb.dataset.manager;
                        const isChecked = groupCb.checked;

                        // ─── מצא את הקבוצה ───
                        const mgr = this._bulkGroupMap?.[managerName];
                        if (mgr) {
                            // מצא את הקבוצה לפי groupKey
                            const entry = Object.values(mgr).find(c => {
                                const key = `${managerName}||${c.field}||${c.oldVal}||${c.newVal}`;
                                return key === groupKey;
                            });

                            if (entry) {
                                entry.selected = isChecked;

                                // ─── עדכן את כל ה-plannedChanges המשויכים ───
                                entry.indices.forEach(idx => {
                                    if (plannedChanges[idx]) {
                                        plannedChanges[idx].selected = isChecked;
                                    }
                                });
                            }
                        }

                        // ─── עדכן מראה השורה ───
                        const row = document.querySelector(
                            `.sc-bulk-group-row[data-group-key=
                    "${CSS.escape(groupKey)}"]`
                        );
                        if (row) {
                            row.style.opacity = isChecked ? '1' : '0.4';
                        }

                        // ─── עדכן manager checkbox ───
                        updateManagerCheckbox(managerName);
                        updateSelectedCount();
                        return;
                    }

                    // ── Checkbox מנהל ──
                    const managerCb = e.target.closest('.sc-bulk-manager-cb');
                    if (managerCb) {
                        const managerName = managerCb.dataset.manager;
                        const isChecked = managerCb.checked;

                        const mgr = this._bulkGroupMap?.[managerName];
                        if (mgr) {
                            Object.values(mgr).forEach(entry => {
                                entry.selected = isChecked;
                                entry.indices.forEach(idx => {
                                    if (plannedChanges[idx]) {
                                        plannedChanges[idx].selected = isChecked;
                                    }
                                });
                            });
                        }

                        // ─── עדכן כל שורות הקבוצה של המנהל ───
                        document.querySelectorAll(
                            `.sc-bulk-group-cb[data-manager=
                    "${CSS.escape(managerName)}"]`
                        ).forEach(cb => {
                            cb.checked = isChecked;
                            const row = cb.closest('.sc-bulk-group-row');
                            if (row) row.style.opacity = isChecked ? '1' : '0.4';
                        });

                        updateSelectedCount();
                        return;
                    }
                });

            // ─── Header Checkbox - בחר/בטל הכל ───
            document.getElementById('srvBulkHeaderCb')
                ?.addEventListener('change', e => {
                    const isChecked = e.target.checked;

                    plannedChanges.forEach(c => {
                        if (!c.infoOnly) {
                            c.selected = isChecked;
                        }
                    });


                    if (this._bulkGroupMap) {
                        Object.values(this._bulkGroupMap).forEach(mgr => {
                            Object.values(mgr).forEach(g => {
                                if (!g.infoOnly) {
                                    g.selected = isChecked;
                                }
                            });
                        });
                    }

                    document.querySelectorAll('.sc-bulk-group-cb').forEach(cb => {
                        cb.checked = isChecked;
                        const row = cb.closest('.sc-bulk-group-row');
                        if (row) row.style.opacity = isChecked ? '1' : '0.4';
                    });

                    document.querySelectorAll('.sc-bulk-manager-cb').forEach(cb => {
                        cb.checked = isChecked;
                        cb.indeterminate = false;
                    });

                    updateSelectedCount();
                });

            // ─── כפתור "בחר הכל" ───
            document.getElementById('srvBulkSelectAll')
                ?.addEventListener('click', () => {
                    // ─── עדכן plannedChanges ───
                    plannedChanges.forEach(c => {
                        if (!c.infoOnly) {
                            c.selected = true;
                        }
                    });

                    // ─── עדכן _bulkGroupMap ───
                    if (this._bulkGroupMap) {
                        Object.values(this._bulkGroupMap).forEach(mgr => {
                            Object.values(mgr).forEach(g => {
                                if (!g.infoOnly) {
                                    g.selected = true;
                                }
                            });
                        });
                    }

                    // ─── עדכן UI ───
                    document.querySelectorAll('.sc-bulk-group-cb').forEach(cb => {
                        if (cb.dataset.infoOnly === 'true') return;

                        cb.checked = true;

                        const row = cb.closest('.sc-bulk-group-row');
                        if (row) row.style.opacity = '1';
                    });

                    document.querySelectorAll('.sc-bulk-manager-cb').forEach(cb => {
                        cb.checked = true;
                        cb.indeterminate = false;
                    });
                    const headerCb = document.getElementById('srvBulkHeaderCb');
                    if (headerCb) {
                        headerCb.checked = true;
                        headerCb.indeterminate = false;
                    }
                    updateSelectedCount();
                });

            document.getElementById('srvBulkDeselectAll')
                ?.addEventListener('click', () => {
                    // ─── עדכן plannedChanges ───
                    plannedChanges.forEach(c => { c.selected = false; });

                    // ─── עדכן _bulkGroupMap ───
                    if (this._bulkGroupMap) {
                        Object.values(this._bulkGroupMap).forEach(mgr => {
                            Object.values(mgr).forEach(g => { g.selected = false; });
                        });
                    }

                    // ─── עדכן UI ───
                    document.querySelectorAll('.sc-bulk-group-cb').forEach(cb => {
                        cb.checked = false;
                        const row = cb.closest('.sc-bulk-group-row');
                        if (row) row.style.opacity = '0.4';
                    });
                    document.querySelectorAll('.sc-bulk-manager-cb').forEach(cb => {
                        cb.checked = false;
                        cb.indeterminate = false;
                    });
                    const headerCb = document.getElementById('srvBulkHeaderCb');
                    if (headerCb) {
                        headerCb.checked = false;
                        headerCb.indeterminate = false;
                    }
                    updateSelectedCount();
                });

            // ─── כפתור "בטל הכל" ───
            document.getElementById('srvBulkDeselectAll')
                ?.addEventListener('click', () => {
                    plannedChanges.forEach((change, idx) => {
                        change.selected = false;

                        const cb = document.querySelector(
                            `.sc-bulk-change-cb[data-idx="${idx}"]`
                        );
                        if (cb) cb.checked = false;

                        updateRowAppearance(idx, false);
                    });

                    document.querySelectorAll('.sc-bulk-manager-cb').forEach(cb => {
                        cb.checked = false;
                        cb.indeterminate = false;
                    });

                    const headerCb = document.getElementById('srvBulkHeaderCb');
                    if (headerCb) {
                        headerCb.checked = false;
                        headerCb.indeterminate = false;
                    }

                    updateSelectedCount();
                });

            // ─── סגירת מודל ───
            const closeModal = (result) => {
                modal.remove();
                this._bulkPlannedChanges = null;
                this._bulkGroupMap = null;
                resolve(result);
            };

            document.getElementById('srvBulkPreviewClose')
                ?.addEventListener('click', () => closeModal(null));

            document.getElementById('srvBulkPreviewCancel')
                ?.addEventListener('click', () => closeModal(null));

            // ─── ייצוא בלבד ───
            document.getElementById('srvBulkExportOnlyBtn')
                ?.addEventListener('click', async () => {
                    const btn = document.getElementById('srvBulkExportOnlyBtn');
                    if (btn) {
                        btn.disabled = true;
                        btn.innerHTML =
                            '<i class="fas fa-spinner fa-spin"></i> מייצא...';
                    }
                    await this._exportBulkToExcel(allRows, plannedChanges);
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML =
                            '<i class="fas fa-file-excel"></i> ייצא לאקסל';
                    }
                    // ─── המודל נשאר פתוח ───
                });

            // ─── החל + ייצא ───
            document.getElementById('srvBulkApplyAndExportBtn')
                ?.addEventListener('click', () => {
                    const selected = plannedChanges.filter(
                        c => !c.infoOnly && c.selected
                    ).length;
                    if (selected === 0) {
                        this.showToast('לא נבחרו שינויים', 'error');
                        return;
                    }
                    closeModal('apply_and_export');
                });

            // ─── החל שינויים בלבד ───
            document.getElementById('srvBulkApplyOnlyBtn')
                ?.addEventListener('click', () => {
                    const selected = plannedChanges.filter(
                        c => !c.infoOnly && c.selected
                    ).length;
                    if (selected === 0) {
                        this.showToast('לא נבחרו שינויים', 'error');
                        return;
                    }
                    closeModal('apply_only');
                });

            // ─── אתחל מצב כפתורים ───
            updateSelectedCount();
        });
    }

    async _exportBulkToExcel(allRows, plannedChanges) {
        try {
            this.showToast('מכין קובץ אקסל...', 'info');

            // ─── טען ספריות ──────────────────────────────────────
            if (typeof ExcelJS === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'exceljs/4.3.0/exceljs.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                    document.head.appendChild(s);
                });
            }

            if (typeof saveAs === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'FileSaver.js/2.0.5/FileSaver.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                    document.head.appendChild(s);
                });
            }

            const wb = new ExcelJS.Workbook();
            wb.creator = 'SystemsCatalogDashboard';
            wb.created = new Date();

            // ══════════════════════════════════════════════════════
            // גיליון 1: כל הנתונים
            // ══════════════════════════════════════════════════════
            const wsAll = wb.addWorksheet('כל הנתונים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            wsAll.columns = [
                { header: 'שם מערכת', key: 'systemName', width: 28 },
                { header: 'מספר קטלוג', key: 'systemNumber', width: 14 },
                { header: 'מנהל מערכת', key: 'manager', width: 22 },
                { header: 'מנהל נמצא', key: 'managerFound', width: 12 },
                { header: 'שדה', key: 'field', width: 12 },
                { header: 'ערך קיים', key: 'oldVal', width: 28 },
                { header: 'ערך חדש', key: 'newVal', width: 28 },
                { header: 'סטטוס', key: 'status', width: 18 },
            ];

            // ─── עיצוב כותרות ────────────────────────────────────
            const styleHeader = (ws, color = 'FF1e1b4b') => {
                const hRow = ws.getRow(1);
                hRow.height = 26;
                hRow.eachCell(cell => {
                    cell.font = {
                        name: 'Arial', size: 11,
                        bold: true, color: { argb: 'FFFFFFFF' }
                    };
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: color }
                    };
                    cell.alignment = {
                        horizontal: 'center', vertical: 'middle',
                        readingOrder: 2
                    };
                    cell.border = {
                        bottom: {
                            style: 'medium',
                            color: { argb: 'FF6366f1' }
                        }
                    };
                });
            };

            styleHeader(wsAll);

            // ─── צבעים לפי סטטוס ─────────────────────────────────
            const statusStyle = {
                'שינוי': {
                    rowBg: 'FFfffbeb',
                    statusFg: 'FFb45309',
                    statusBg: 'FFfef3c7'
                },
                'מילוי חדש': {
                    rowBg: 'FFf0fdf4',
                    statusFg: 'FF166534',
                    statusBg: 'FFdcfce7'
                },
                'זהה - אין שינוי': {
                    rowBg: 'FFf9fafb',
                    statusFg: 'FF6b7280',
                    statusBg: 'FFf3f4f6'
                },
                'אין ערך חדש': {
                    rowBg: 'FFf5f3ff',
                    statusFg: 'FF4338ca',
                    statusBg: 'FFede9fe'
                },
                'מנהל לא נמצא': {
                    rowBg: 'FFfff1f2',
                    statusFg: 'FFb91c1c',
                    statusBg: 'FFfee2e2'
                },
                'אין מנהל': {
                    rowBg: 'FFf9fafb',
                    statusFg: 'FF9ca3af',
                    statusBg: 'FFf3f4f6'
                },
            };

            // ─── הוסף נתונים ─────────────────────────────────────
            allRows.forEach((r, idx) => {
                const st = statusStyle[r.status] || {
                    rowBg: 'FFFFFFFF',
                    statusFg: 'FF333333',
                    statusBg: 'FFf3f4f6'
                };

                const row = wsAll.addRow({
                    systemName: r.systemName,
                    systemNumber: r.systemNumber,
                    manager: r.manager,
                    managerFound: r.managerFound,
                    field: r.field,
                    oldVal: r.oldVal,
                    newVal: r.newVal,
                    status: r.status,
                });

                row.height = 16;

                row.eachCell((cell, colNum) => {
                    cell.font = { name: 'Arial', size: 10 };
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: st.rowBg }
                    };
                    cell.alignment = {
                        horizontal: 'right',
                        vertical: 'middle',
                        readingOrder: 2
                    };
                    cell.border = {
                        bottom: {
                            style: 'thin',
                            color: { argb: 'FFe5e7eb' }
                        }
                    };

                    // ─── עמודת ערך קיים - אדום אם יש שינוי ───────
                    if (colNum === 6 && r.status === 'שינוי' && r.oldVal) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            color: { argb: 'FFdc2626' },
                            strikethrough: true
                        };
                    }

                    // ─── עמודת ערך חדש - ירוק אם יש שינוי ────────
                    if (colNum === 7 &&
                        (r.status === 'שינוי' || r.status === 'מילוי חדש') &&
                        r.newVal) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: 'FF16a34a' }
                        };
                    }

                    // ─── עמודת סטטוס - צבע מיוחד ──────────────────
                    if (colNum === 8) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: st.statusFg }
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: st.statusBg }
                        };
                        cell.alignment = {
                            horizontal: 'center',
                            vertical: 'middle',
                            readingOrder: 2
                        };
                    }

                    // ─── עמודת מנהל נמצא ──────────────────────────
                    if (colNum === 4) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: {
                                argb: r.managerFound === 'כן'
                                    ? 'FF16a34a'
                                    : 'FFdc2626'
                            }
                        };
                        cell.alignment = {
                            horizontal: 'center',
                            vertical: 'middle'
                        };
                    }
                });
            });

            // ══════════════════════════════════════════════════════
            // גיליון 2: שינויים בלבד
            // ══════════════════════════════════════════════════════
            const wsChanges = wb.addWorksheet('שינויים בלבד', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            wsChanges.columns = [
                { header: 'שם מערכת', key: 'systemName', width: 28 },
                { header: 'מספר קטלוג', key: 'number', width: 14 },
                { header: 'מנהל מערכת', key: 'manager', width: 22 },
                { header: 'שדה', key: 'field', width: 12 },
                { header: 'ערך קיים', key: 'oldVal', width: 28 },
                { header: 'ערך חדש', key: 'newVal', width: 28 },
            ];

            styleHeader(wsChanges, 'FF78350f');

            if (plannedChanges.length === 0) {
                const emptyRow = wsChanges.addRow({
                    systemName: 'אין שינויים לביצוע'
                });
                emptyRow.getCell('systemName').font = {
                    name: 'Arial', size: 10,
                    italic: true,
                    color: { argb: 'FF6b7280' }
                };
                emptyRow.getCell('systemName').alignment = {
                    horizontal: 'center', readingOrder: 2
                };
            } else {
                plannedChanges.forEach((c, idx) => {
                    // ─── מצא מספר קטלוג ───────────────────────────
                    const sys = this.allSystems.find(
                        s => s.id === c.systemId
                    );
                    const catalogNum = sys
                        ? String(sys.number || '')
                        : '';

                    const row = wsChanges.addRow({
                        systemName: c.systemName,
                        number: catalogNum,
                        manager: c.manager,
                        field: c.fieldLabel,
                        oldVal: c.oldVal === '(ריק)' ? '' : c.oldVal,
                        newVal: c.newVal,
                    });

                    row.height = 16;
                    const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFfffbeb';

                    row.eachCell((cell, colNum) => {
                        cell.font = { name: 'Arial', size: 10 };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: rowBg }
                        };
                        cell.alignment = {
                            horizontal: 'right',
                            vertical: 'middle',
                            readingOrder: 2
                        };
                        cell.border = {
                            bottom: {
                                style: 'thin',
                                color: { argb: 'FFe5e7eb' }
                            }
                        };

                        // ─── ערך קיים - אדום עם קו ────────────────
                        if (colNum === 5) {
                            cell.font = {
                                name: 'Arial', size: 10,
                                color: { argb: 'FFdc2626' },
                                strikethrough: true
                            };
                        }

                        // ─── ערך חדש - ירוק מודגש ─────────────────
                        if (colNum === 6) {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true,
                                color: { argb: 'FF16a34a' }
                            };
                        }
                    });
                });
            }

            // ══════════════════════════════════════════════════════
            // גיליון 3: מנהלים שלא נמצאו
            // ══════════════════════════════════════════════════════
            const notFoundManagers = [...new Set(
                allRows
                    .filter(r => r.managerFound === 'לא' && r.manager)
                    .map(r => r.manager)
            )];

            const wsNotFound = wb.addWorksheet('מנהלים שלא נמצאו', {
                views: [{ rightToLeft: true }]
            });

            wsNotFound.columns = [
                { header: 'שם מנהל', key: 'manager', width: 25 },
                { header: 'מספר מערכות', key: 'systemCount', width: 14 },
                { header: 'מערכות', key: 'systems', width: 60 },
            ];

            styleHeader(wsNotFound, 'FF7f1d1d');

            if (notFoundManagers.length === 0) {
                const emptyRow = wsNotFound.addRow({
                    manager: 'כל המנהלים נמצאו ✅'
                });
                emptyRow.getCell('manager').font = {
                    name: 'Arial', size: 10,
                    italic: true,
                    color: { argb: 'FF16a34a' }
                };
                emptyRow.getCell('manager').alignment = {
                    horizontal: 'center', readingOrder: 2
                };
            } else {
                notFoundManagers.forEach((manager, idx) => {
                    const systems = allRows
                        .filter(r =>
                            r.manager === manager &&
                            r.managerFound === 'לא'
                        )
                        .map(r => r.systemName);

                    const uniqueSystems = [...new Set(systems)];

                    const row = wsNotFound.addRow({
                        manager,
                        systemCount: uniqueSystems.length,
                        systems: uniqueSystems.join(', '),
                    });

                    row.height = 16;
                    const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFfff1f2';

                    row.eachCell((cell, colNum) => {
                        cell.font = {
                            name: 'Arial', size: 10,
                            color: {
                                argb: colNum === 1
                                    ? 'FFdc2626'
                                    : 'FF6b7280'
                            }
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: rowBg }
                        };
                        cell.alignment = {
                            horizontal: colNum === 2 ? 'center' : 'right',
                            vertical: 'middle',
                            readingOrder: 2,
                            wrapText: colNum === 3
                        };
                        cell.border = {
                            bottom: {
                                style: 'thin',
                                color: { argb: 'FFfecaca' }
                            }
                        };
                    });
                });
            }

            // ══════════════════════════════════════════════════════
            // גיליון 4: סיכום
            // ══════════════════════════════════════════════════════
            const wsSummary = wb.addWorksheet('סיכום', {
                views: [{ rightToLeft: true }]
            });

            wsSummary.columns = [
                { key: 'label', width: 25 },
                { key: 'value', width: 20 },
            ];

            const summaryData = [
                { label: 'תאריך הפקה', value: new Date().toLocaleString('he-IL') },
                { label: 'סה"כ מערכות', value: this.allSystems.length },
                { label: 'סה"כ שורות', value: allRows.length },
                { label: 'שינויים צפויים', value: plannedChanges.length },
                { label: 'מילויים חדשים', value: allRows.filter(r => r.status === 'מילוי חדש').length },
                { label: 'זהה - אין שינוי', value: allRows.filter(r => r.status === 'זהה - אין שינוי').length },
                { label: 'אין ערך חדש', value: allRows.filter(r => r.status === 'אין ערך חדש').length },
                { label: 'מנהל לא נמצא', value: allRows.filter(r => r.status === 'מנהל לא נמצא').length },
                { label: 'אין מנהל', value: allRows.filter(r => r.status === 'אין מנהל').length },
                { label: 'מנהלים שנמצאו', value: [...new Set(allRows.filter(r => r.managerFound === 'כן').map(r => r.manager))].length },
                { label: 'מנהלים שלא נמצאו', value: notFoundManagers.length },
            ];

            const summaryColors = [
                'FFe0e7ff', 'FFf0fdf4', 'FFf0fdf4',
                'FFfffbeb', 'FFf0fdf4', 'FFf9fafb',
                'FFf5f3ff', 'FFfff1f2', 'FFf9fafb',
                'FFf0fdf4', 'FFfff1f2',
            ];

            summaryData.forEach((item, idx) => {
                const row = wsSummary.addRow(item);
                row.height = 22;

                const labelCell = row.getCell('label');
                labelCell.font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: 'FF374151' }
                };
                labelCell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: summaryColors[idx] || 'FFFFFFFF' }
                };
                labelCell.alignment = {
                    horizontal: 'right',
                    vertical: 'middle',
                    readingOrder: 2
                };
                labelCell.border = {
                    bottom: {
                        style: 'thin',
                        color: { argb: 'FFe5e7eb' }
                    }
                };

                const valueCell = row.getCell('value');
                valueCell.font = {
                    name: 'Arial', size: 12,
                    bold: true, color: { argb: 'FF1e1b4b' }
                };
                valueCell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: summaryColors[idx] || 'FFFFFFFF' }
                };
                valueCell.alignment = {
                    horizontal: 'center',
                    vertical: 'middle'
                };
                valueCell.border = {
                    bottom: {
                        style: 'thin',
                        color: { argb: 'FFe5e7eb' }
                    }
                };
            });

            // ─── הורד קובץ ───────────────────────────────────────
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });

            const date = new Date().toISOString()
                .replace('T', '_')
                .substring(0, 16)
                .replace(':', '-');

            saveAs(blob, `autofill_preview_${date}.xlsx`);

            this.showToast(
                `📊 יוצאו ${allRows.length} שורות ` +
                `(${plannedChanges.length} שינויים)`,
                'success'
            );

        } catch (err) {
            console.error('_exportBulkToExcel error:', err);
            this.showToast('שגיאה בייצוא: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════════
    // מודל אישור Bulk Auto-fill (קטלוג מערכות)
    // ══════════════════════════════════════════════════════════════
    _showBulkConfirmModal(plannedChanges, fetchedCount, notFoundCount) {
        return new Promise(resolve => {
            const existing = document.getElementById('scBulkConfirmModal');
            if (existing) existing.remove();

            const affectedSystems = new Set(
                plannedChanges.map(c => c.systemId)
            ).size;

            // ─── קבץ לפי שדה לסיכום ──────────────────────────────
            const byField = {};
            plannedChanges.forEach(c => {
                byField[c.fieldLabel] = (byField[c.fieldLabel] || 0) + 1;
            });

            const fieldSummaryHtml = Object.entries(byField)
                .map(([label, count]) => `
            <div class="sc-bulk-field-row">
                <span class="sc-bulk-field-label">
                    ${this.escHtml(label)}
                </span>
                <span class="sc-bulk-field-count">
                    ${count} שינויים
                </span>
            </div>
        `).join('');

            // ─── דוגמאות שינויים (עד 8) ──────────────────────────
            const samplesHtml = plannedChanges.slice(0, 8).map(c => `
        <tr>
            <td class="sc-bulk-sample-td"
                title="${this.escHtml(c.systemName)}">
                ${this.escHtml(c.systemName)}
            </td>
            <td class="sc-bulk-sample-td">
                ${this.escHtml(c.fieldLabel)}
            </td>
            <td class="sc-bulk-sample-td sc-bulk-old-val">
                ${this.escHtml(c.oldVal)}
            </td>
            <td class="sc-bulk-sample-td">→</td>
            <td class="sc-bulk-sample-td sc-bulk-new-val">
                ${this.escHtml(c.newVal)}
            </td>
        </tr>
    `).join('');

            const moreCount = plannedChanges.length - 8;

            const modal = document.createElement('div');
            modal.id = 'scBulkConfirmModal';
            modal.className = 'sc-modal-overlay';

            modal.innerHTML = `
    <div class="sc-modal" style="max-width:620px">

        <!-- כותרת -->
        <div class="sc-modal-header" style="
            border-bottom:2px solid rgba(99,102,241,0.35);
            background:linear-gradient(135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05))">
            <h3 class="sc-modal-title">
                <i class="fas fa-magic" style="color:#6366f1"></i>
                Auto-fill ארגוני - אישור
            </h3>
            <button class="sc-modal-close"
                    id="scBulkConfirmClose">&times;</button>
        </div>

        <!-- גוף -->
        <div class="sc-modal-body" style="
            max-height:65vh;overflow-y:auto;gap:14px">

            <!-- סיכום -->
            <div style="display:grid;
                        grid-template-columns:repeat(auto-fit,minmax(100px,1fr));
                        gap:10px">

                <div style="display:flex;flex-direction:column;
                            align-items:center;gap:4px;padding:12px 8px;
                            border-radius:8px;text-align:center;
                            background:rgba(99,102,241,0.1);
                            border:1px solid rgba(99,102,241,0.3);
                            color:#a5b4fc">
                    <i class="fas fa-edit" style="font-size:1.1rem"></i>
                    <div style="font-size:1.5rem;font-weight:800;line-height:1">
                        ${plannedChanges.length}
                    </div>
                    <div style="font-size:0.7rem;opacity:0.8">שינויים</div>
                </div>

                <div style="display:flex;flex-direction:column;
                            align-items:center;gap:4px;padding:12px 8px;
                            border-radius:8px;text-align:center;
                            background:rgba(59,130,246,0.1);
                            border:1px solid rgba(59,130,246,0.3);
                            color:#93c5fd">
                    <i class="fas fa-layer-group" style="font-size:1.1rem"></i>
                    <div style="font-size:1.5rem;font-weight:800;line-height:1">
                        ${affectedSystems}
                    </div>
                    <div style="font-size:0.7rem;opacity:0.8">מערכות</div>
                </div>

                <div style="display:flex;flex-direction:column;
                            align-items:center;gap:4px;padding:12px 8px;
                            border-radius:8px;text-align:center;
                            background:rgba(34,197,94,0.1);
                            border:1px solid rgba(34,197,94,0.3);
                            color:#86efac">
                    <i class="fas fa-check-circle" style="font-size:1.1rem"></i>
                    <div style="font-size:1.5rem;font-weight:800;line-height:1">
                        ${fetchedCount}
                    </div>
                    <div style="font-size:0.7rem;opacity:0.8">מנהלים נמצאו</div>
                </div>

                ${notFoundCount > 0 ? `
                <div style="display:flex;flex-direction:column;
                            align-items:center;gap:4px;padding:12px 8px;
                            border-radius:8px;text-align:center;
                            background:rgba(245,158,11,0.1);
                            border:1px solid rgba(245,158,11,0.3);
                            color:#fcd34d">
                    <i class="fas fa-question-circle" style="font-size:1.1rem"></i>
                    <div style="font-size:1.5rem;font-weight:800;line-height:1">
                        ${notFoundCount}
                    </div>
                    <div style="font-size:0.7rem;opacity:0.8">לא נמצאו</div>
                </div>` : ''}
            </div>

            <!-- לפי שדה -->
            <div style="background:rgba(255,255,255,0.02);
                        border:1px solid rgba(255,255,255,0.07);
                        border-radius:8px;padding:12px 14px">
                <div style="font-size:0.78rem;font-weight:600;
                            color:#777;margin-bottom:8px;
                            display:flex;align-items:center;gap:6px">
                    <i class="fas fa-list" style="color:#6366f1"></i>
                    שינויים לפי שדה:
                </div>
                ${fieldSummaryHtml}
            </div>

            <!-- אזהרה -->
            <div style="display:flex;align-items:flex-start;gap:10px;
                        padding:10px 14px;
                        background:rgba(245,158,11,0.08);
                        border:1px solid rgba(245,158,11,0.25);
                        border-radius:8px;font-size:0.8rem;
                        color:#fcd34d;line-height:1.5">
                <i class="fas fa-exclamation-triangle"
                   style="color:#f59e0b;flex-shrink:0;margin-top:2px"></i>
                <span>
                    פעולה זו <strong>תדרוס</strong> ערכים קיימים.
                    הנתונים יישמרו לשרת לאחר האישור.
                    ניתן לראות את כל השינויים בקונסול הדפדפן.
                </span>
            </div>

            <!-- דוגמאות -->
            <div style="background:rgba(255,255,255,0.02);
                        border:1px solid rgba(255,255,255,0.07);
                        border-radius:8px;padding:12px 14px">
                <div style="font-size:0.78rem;font-weight:600;
                            color:#777;margin-bottom:8px;
                            display:flex;align-items:center;gap:6px">
                    <i class="fas fa-eye" style="color:#6366f1"></i>
                    דוגמאות שינויים:
                </div>
                <div style="overflow-x:auto">
                    <table style="width:100%;border-collapse:collapse;
                                  font-size:0.78rem;direction:rtl">
                        <thead>
                            <tr>
                                <th style="background:#1a1a2e;color:#888;
                                           padding:6px 10px;text-align:right;
                                           font-weight:600;
                                           border-bottom:1px solid #2a2a4e">
                                    מערכת
                                </th>
                                <th style="background:#1a1a2e;color:#888;
                                           padding:6px 10px;text-align:right;
                                           font-weight:600;
                                           border-bottom:1px solid #2a2a4e">
                                    שדה
                                </th>
                                <th style="background:#1a1a2e;color:#888;
                                           padding:6px 10px;text-align:right;
                                           font-weight:600;
                                           border-bottom:1px solid #2a2a4e">
                                    ערך ישן
                                </th>
                                <th style="background:#1a1a2e;
                                           border-bottom:1px solid #2a2a4e">
                                </th>
                                <th style="background:#1a1a2e;color:#888;
                                           padding:6px 10px;text-align:right;
                                           font-weight:600;
                                           border-bottom:1px solid #2a2a4e">
                                    ערך חדש
                                </th>
                            </tr>
                        </thead>
                        <tbody>${samplesHtml}</tbody>
                    </table>
                    ${moreCount > 0 ? `
                    <div style="font-size:0.72rem;color:#555;
                                text-align:center;padding:6px;
                                font-style:italic">
                        ועוד ${moreCount} שינויים נוספים...
                        (ראה קונסול לרשימה מלאה)
                    </div>` : ''}
                </div>
            </div>

        </div>

        <!-- Footer -->
        <div class="sc-modal-footer">
            <button class="sc-modal-cancel-btn"
                    id="scBulkConfirmCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button style="
                padding:8px 20px;
                background:linear-gradient(135deg,#4f46e5,#7c3aed);
                border:none;border-radius:6px;color:white;
                font-size:0.85rem;font-weight:700;cursor:pointer;
                display:flex;align-items:center;gap:6px;
                transition:all 0.2s;font-family:inherit"
                    id="scBulkConfirmOk">
                <i class="fas fa-magic"></i>
                החל ${plannedChanges.length} שינויים
            </button>
        </div>

    </div>`;

            document.body.appendChild(modal);

            const closeModal = (result) => {
                modal.remove();
                resolve(result);
            };

            document.getElementById('scBulkConfirmClose')
                .addEventListener('click', () => closeModal(false));
            document.getElementById('scBulkConfirmCancel')
                .addEventListener('click', () => closeModal(false));
            document.getElementById('scBulkConfirmOk')
                .addEventListener('click', () => closeModal(true));
            modal.addEventListener('click', e => {
                if (e.target === modal) closeModal(false);
            });
        });
    }

    // ══════════════════════════════════════════════════════════════
    // Auto-fill שיוך ארגוני לפי שם מנהל מערכת
    // ══════════════════════════════════════════════════════════════
    async _autoFillOrgInfo(managerName, prefix = 'scEdit') {
        if (!managerName || managerName.trim().length < 2) return;

        const btn = document.getElementById(`${prefix}AutoFillBtn`);
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const res = await fetch(
                `/PhoneDirectory/GetEmployeeOrgInfo?name=` +
                `${encodeURIComponent(managerName.trim())}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            if (!data.success || !data.employee) {
                this.showToast(
                    `⚠️ לא נמצא עובד בשם: ${managerName}`, 'info'
                );
                return;
            }

            const emp = data.employee;

            // ─── מלא שדות ריקים בלבד ──────────────────────────────
            const fields = [
                { id: `${prefix}Team`, val: emp.team, label: 'צוות', field: 'team' },
                { id: `${prefix}Dept`, val: emp.department, label: 'מחלקה', field: 'department' },
                { id: `${prefix}Domain`, val: emp.domain, label: 'תחום', field: 'domain' },
                {
                    id: `${prefix}DeptManager`, val: null, label: 'מנהל מחלקה', field: 'departmentManager',
                    fetchDeptManager: true
                },
            ];
            const filled = [];

            fields.forEach(({ id, val, label, field }) => {
                const el = document.getElementById(id);
                if (!el || !val) return;

                // בדוק אם ריק (עובד גם עבור select וגם input)
                const isEmpty = !el.value || el.value.trim() === '';
                if (!isEmpty) return;

                // אם select - בדוק אם הערך קיים ברשימה, אם לא - הוסף אותו
                if (el.tagName === 'SELECT') {
                    const exists = [...el.options].some(o => o.value === val);
                    if (!exists) {
                        const opt = document.createElement('option');
                        opt.value = val;
                        opt.textContent = val;
                        el.appendChild(opt);
                    }
                    el.value = val;
                } else {
                    el.value = val;
                }

                el.classList.add('sc-autofilled');
                filled.push(label);
                setTimeout(() =>
                    el.classList.remove('sc-autofilled'), 3000);
            });

            // ─── מלא מנהל מחלקה אוטומטית ───
            const deptManagerField = fields.find(f => f.fetchDeptManager);
            if (deptManagerField) {
                const deptEl = document.getElementById(`${prefix}Dept`);
                const deptManagerEl = document.getElementById(`${prefix}DeptManager`);

                if (deptManagerEl && (!deptManagerEl.value || deptManagerEl.value.trim() === '')) {
                    const dept = deptEl?.value?.trim() || emp.department || '';

                    if (dept) {
                        try {
                            const deptRes = await fetch(
                                `/PhoneDirectory/GetDepartmentManager?department=${encodeURIComponent(dept)}`,
                                { credentials: 'include' }
                            );
                            const deptData = await deptRes.json();

                            if (deptData.success && deptData.departmentManager) {
                                deptManagerEl.value = deptData.departmentManager;
                                deptManagerEl.classList.add('sc-autofilled');
                                filled.push('מנהל מחלקה');
                                setTimeout(() =>
                                    deptManagerEl.classList.remove('sc-autofilled'), 3000);
                            }
                        } catch (err) {
                            console.warn('GetDepartmentManager error:', err);
                        }
                    }
                }
            }

            if (filled.length > 0) {
                this.showToast(
                    `✅ מולאו: ${filled.join(', ')} (${emp.fullName})`,
                    'success'
                );
            } else {
                this.showToast(
                    `ℹ️ כל השדות כבר מלאים (${emp.fullName})`, 'info'
                );
            }

        } catch (err) {
            console.error('_autoFillOrgInfo error:', err);
            this.showToast('שגיאה בחיפוש עובד', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-magic"></i>';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // Pagination
    // ══════════════════════════════════════════════════════════
    renderPagination(total, pages) {
        const pag = document.getElementById('scPagination');
        if (!pag) return;
        if (pages <= 1) { pag.innerHTML = ''; return; }

        const cur = this.currentPage;
        let html = `<div class="sc-pag-wrap">`;

        html += `
        <button class="sc-pag-btn ${cur === 1 ? 'disabled' : ''}"
                data-page="1" title="ראשון">
            <i class="fas fa-angle-double-right"></i>
        </button>
        <button class="sc-pag-btn ${cur === 1 ? 'disabled' : ''}"
                data-page="${cur - 1}" title="קודם">
            <i class="fas fa-angle-right"></i>
        </button>`;

        this._pageRange(cur, pages).forEach(p => {
            if (p === '...') {
                html += `<span class="sc-pag-dots">...</span>`;
            } else {
                html += `
                <button class="sc-pag-btn ${p === cur ? 'active' : ''}"
                        data-page="${p}">${p}</button>`;
            }
        });

        html += `
        <button class="sc-pag-btn ${cur === pages ? 'disabled' : ''}"
                data-page="${cur + 1}" title="הבא">
            <i class="fas fa-angle-left"></i>
        </button>
        <button class="sc-pag-btn ${cur === pages ? 'disabled' : ''}"
                data-page="${pages}" title="אחרון">
            <i class="fas fa-angle-double-left"></i>
        </button>
        <span class="sc-pag-info">
            עמוד ${cur} מתוך ${pages} | ${total} מערכות
        </span>`;

        html += `</div>`;
        pag.innerHTML = html;
    }

    // ══════════════════════════════════════════════════════════
    // בנה אפשרויות select מהנתונים הקיימים
    // ══════════════════════════════════════════════════════════
    _buildSelectOptions(field, currentValue, placeholder, readOnly = false) {
        const uniqueValues = [...new Set(
            this.allSystems
                .map(s => s[field])
                .filter(v => v && String(v).trim() !== '')
        )].sort((a, b) => String(a).localeCompare(String(b), 'he'));

        // אם readOnly - הצג כ-input רגיל
        if (readOnly) {
            return `<input type="text"
                    class="sc-edit-input sc-edit-input-readonly"
                    value="${this.escHtml(currentValue || '')}"
                    disabled/>`;
        }

        const options = uniqueValues.map(v =>
            `<option value="${this.escHtml(v)}"
                 ${currentValue === v ? 'selected' : ''}>
             ${this.escHtml(v)}
         </option>`
        ).join('');

        // הוסף את הערך הנוכחי אם לא קיים ברשימה
        const currentNotInList = currentValue &&
            !uniqueValues.includes(currentValue);

        const currentOption = currentNotInList
            ? `<option value="${this.escHtml(currentValue)}" selected>
               ${this.escHtml(currentValue)}
           </option>`
            : '';

        return `
        <select class="sc-select sc-edit-select sc-dynamic-select"
                data-field="${field}">
            <option value="">${placeholder}</option>
            ${currentOption}
            ${options}
        </select>`;
    }

    // ══════════════════════════════════════════════════════════
    // בנה option tags מהנתונים הקיימים
    // ══════════════════════════════════════════════════════════
    _buildDynamicOptions(field, currentValue) {
        const uniqueValues = [...new Set(
            this.allSystems
                .map(s => s[field])
                .filter(v => v && String(v).trim() !== '')
        )].sort((a, b) => String(a).localeCompare(String(b), 'he'));

        // הוסף ערך נוכחי אם לא קיים ברשימה
        if (currentValue && !uniqueValues.includes(currentValue)) {
            uniqueValues.unshift(currentValue);
        }

        return uniqueValues.map(v =>
            `<option value="${this.escHtml(v)}"
                 ${currentValue === v ? 'selected' : ''}>
             ${this.escHtml(v)}
         </option>`
        ).join('');
    }

    // ══════════════════════════════════════════════════════════
    // מודל עריכת מערכת
    // ══════════════════════════════════════════════════════════
    openEditModal(systemId, readOnly = false) {
        // אם עורך אוטומציה בלבד - פתח במצב עריכה חלקית
        const isAutomationEditor = this.isAutomationOnly && !this.isAdmin;

        // אם לא אדמין ולא עורך אוטומציה - פתח במצב צפייה בלבד
        if (!this.isAdmin && !this.isAutomationOnly) readOnly = true;

        const system = this.allSystems.find(s => s.id === systemId);
        if (!system) return;

        const existing = document.getElementById('scEditModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'scEditModal';
        modal.className = 'sc-modal-overlay';

        const modalTitle = readOnly
            ? 'פרטי מערכת'
            : isAutomationEditor
                ? 'עריכת אוטומציה'
                : 'עריכת מערכת';

        const modalIcon = readOnly
            ? 'fa-eye'
            : isAutomationEditor
                ? 'fa-robot'
                : 'fa-edit';

        const modalColor = readOnly
            ? '#6366f1'
            : isAutomationEditor
                ? '#22c55e'
                : '#f59e0b';

        modal.innerHTML = `
        <div class="sc-modal sc-edit-modal">
            <div class="sc-modal-header">
                <h3 class="sc-modal-title">
                    <i class="fas ${modalIcon}"
                    style="color:${modalColor}"></i>
                    ${modalTitle}
                    <span class="sc-edit-name-badge">
                        ${this.escHtml(system.name || '')}
                    </span>
                </h3>
                ${!readOnly ? `
                <button class="sc-copy-link-btn" id="scCopyValidateLink"
                        title="העתק קישור לתיקוף מערכת">
                    <i class="fas fa-link"></i>
                    תיקוף מערכת
                </button>
                <button class="sc-requires-validation-btn
                            ${system.requiresValidation ? 'sc-requires-validation-active' : ''}"
                        id="scToggleRequiresValidation"
                        title="${system.requiresValidation
                    ? 'מערכת זו מסומנת כדורשת תיקוף - לחץ לביטול'
                    : 'סמן מערכת זו כדורשת תיקוף'}"
                        data-system-id="${this.escHtml(system.id)}"
                        data-current="${system.requiresValidation ? 'true' : 'false'}">
                    <i class="fas fa-circle-check"></i>
                    ${system.requiresValidation ? 'מסומן: נדרש תיקוף' : 'נדרש תיקוף'}
                </button>` : ''}
                <button class="sc-modal-close" id="scEditClose">&times;</button>
            </div>

            <div class="sc-modal-body sc-edit-modal-body">

                <div class="sc-edit-row">
                    <div class="sc-edit-field">
                        <label class="sc-edit-label">
                            <i class="fas fa-hashtag"></i> מספר קטלוג
                            <span style="color:#ef4444;margin-right:3px" title="שדה חובה">*</span>
                        </label>
                        <input type="text" id="scEditNumber"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(String(system.number || ''))}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-layer-group"></i> שם מערכת
                            <span style="color:#ef4444;margin-right:3px" title="שדה חובה">*</span>
                        </label>
                        <input type="text" id="scEditName"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(system.name || '')}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-font"></i> שם אנגלית
                            <span style="color:#ef4444;margin-right:3px" title="שדה חובה">*</span>
                        </label>
                        <input type="text" id="scEditNameEn"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            dir="ltr"
                            value="${this.escHtml(system.nameEn || '')}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                </div>

                <div class="sc-edit-field sc-edit-field-full">
                    <label class="sc-edit-label">
                        <i class="fas fa-align-left"></i> תיאור
                    </label>
                    <textarea id="scEditDesc"
                            class="sc-form-textarea ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            rows="2"
                            placeholder="תיאור המערכת..."
                            ${readOnly ? 'disabled' : ''}
                    >${this.escHtml(this._cleanDescription(system.description))}</textarea>
                </div>

                <div class="sc-edit-row">
                    <div class="sc-edit-field">
                        <label class="sc-edit-label">
                            <i class="fas fa-circle-dot"></i> סטטוס
                        </label>
                        <select id="scEditStatus"
                                class="sc-select sc-edit-select"
                                ${readOnly ? 'disabled' : ''}>
                            ${['', 'פעיל', 'פעילה', 'לא פעיל', 'לא פעילה',
                'בפיתוח', 'בהקמה', 'פיילוט', 'בהקפאה',
                'מיועד לסגירה', 'מבוטלת']
                .map(v => `<option value="${v}"
                                    ${system.status === v ? 'selected' : ''}>
                                    ${v || '— לא הוגדר —'}
                                </option>`)
                .join('')}
                        </select>
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-user-tie"></i> מנהל מערכת
                            <span style="color:#ef4444;margin-right:3px" title="שדה חובה">*</span>
                            ${!readOnly ? `
                            <button type="button"
                                    id="scEditAutoFillBtn"
                                    class="sc-autofill-btn"
                                    title="מלא אוטומטית צוות/מחלקה/תחום/אגף לפי שם המנהל">
                                <i class="fas fa-magic"></i>
                            </button>` : ''}
                        </label>
                        <input type="text" id="scEditManager"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(system.systemManager || '')}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-user-shield"></i> מנהל מחלקה
                        </label>
                        <input type="text" id="scEditDeptManager"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(system.departmentManager || '')}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field">
                        <label class="sc-edit-label">
                            <i class="fas fa-industry"></i> סביבה
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditEnv"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.environment || '')}"
                                   disabled/>`
                : `<select id="scEditEnv"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר סביבה —</option>
                                   ${this._buildDynamicOptions('environment', system.environment)}
                               </select>`}
                    </div>
                </div>

                <div class="sc-edit-row">
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-sitemap"></i> תחום
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditDomain"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.domain || '')}"
                                   disabled/>`
                : `<select id="scEditDomain"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר תחום —</option>
                                   ${this._buildDynamicOptions('domain', system.domain)}
                               </select>`}
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-building"></i> מחלקה
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditDept"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.department || '')}"
                                   disabled/>`
                : `<select id="scEditDept"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר מחלקה —</option>
                                   ${this._buildDynamicOptions('department', system.department)}
                               </select>`}
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-users"></i> צוות
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditTeam"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.team || '')}"
                                   disabled/>`
                : `<select id="scEditTeam"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר צוות —</option>
                                   ${this._buildDynamicOptions('team', system.team)}
                               </select>`}
                    </div>
                </div>

                <div class="sc-edit-row">
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-briefcase"></i> אגף עסקי
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditBizDiv"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.businessDivision || '')}"
                                   disabled/>`
                : `<select id="scEditBizDiv"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר אגף עסקי —</option>
                                   ${this._buildDynamicOptions('businessDivision', system.businessDivision)}
                               </select>`}
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-tag"></i> סיווג יישום
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditAppClass"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.appClassification || '')}"
                                   disabled/>`
                : `<select id="scEditAppClass"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר סיווג —</option>
                                   ${this._buildDynamicOptions('appClassification', system.appClassification)}
                               </select>`}
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-cube"></i> סוג יישום
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditAppType"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.appType || '')}"
                                   disabled/>`
                : `<select id="scEditAppType"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר סוג —</option>
                                   ${this._buildDynamicOptions('appType', system.appType)}
                               </select>`}
                    </div>
                </div>

                <div class="sc-edit-row">
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-exclamation-triangle"></i> קריטיות עסקית
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditCriticality"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.businessCriticality || '')}"
                                   disabled/>`
                : `<select id="scEditCriticality"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר קריטיות —</option>
                                   ${this._buildDynamicOptions('businessCriticality', system.businessCriticality)}
                               </select>`}
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-clock"></i> דרישת זמינות
                        </label>
                        ${readOnly
                ? `<input type="text" id="scEditAvailability"
                                   class="sc-edit-input sc-edit-input-readonly"
                                   value="${this.escHtml(system.availabilityRequirement || '')}"
                                   disabled/>`
                : `<select id="scEditAvailability"
                                      class="sc-select sc-edit-select">
                                   <option value="">— בחר זמינות —</option>
                                   ${this._buildDynamicOptions('availabilityRequirement', system.availabilityRequirement)}
                               </select>`}
                    </div>
                </div>

                                <div class="sc-edit-row">
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-building-user"></i> מפרסם
                        </label>
                        <input type="text" id="scEditPublisher"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(system.publisher || '')}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide">
                        <label class="sc-edit-label">
                            <i class="fas fa-headset"></i> ספק תמיכה
                        </label>
                        <input type="text" id="scEditVendor"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(system.supportVendor || '')}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field">
                        <label class="sc-edit-label">
                            <i class="fas fa-calendar"></i> נוצר
                        </label>
                        <input type="text" id="scEditCreated"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(this._stripTime(system.createdAt || ''))}"
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                    <div class="sc-edit-field">
                        <label class="sc-edit-label">
                            <i class="fas fa-check-circle" style="color:#22c55e"></i> תיקוף אחרון
                        </label>
                        <input type="text" id="scEditLastValidated"
                            class="sc-edit-input sc-edit-input-readonly"
                            value="${this.escHtml(this._stripTime(system.lastValidatedAt || ''))}"
                            disabled/>
                    </div>
                </div>

                <div class="sc-edit-row sc-edit-row-automation">
                    <div class="sc-edit-field">
                        <label class="sc-edit-label">
                            <i class="fas fa-robot"></i> אוטומציה
                        </label>
                        <select id="scEditHasAutomation"
                                class="sc-select sc-edit-select"
                                ${readOnly ? 'disabled' : ''}>
                            <option value="לא קיימות"
                                ${(system.hasAutomation || 'לא קיימות') === 'לא קיימות'
                ? 'selected' : ''}>
                                לא קיימות
                            </option>
                            <option value="קיימות"
                                ${system.hasAutomation === 'קיימות' ? 'selected' : ''}>
                                קיימות
                            </option>
                            <option value="לא רלוונטי"
                                ${system.hasAutomation === 'לא רלוונטי' ? 'selected' : ''}>
                                לא רלוונטי
                            </option>
                        </select>
                    </div>
                    <div class="sc-edit-field sc-edit-field-wide"
                        id="scEditAutomationNoteWrap"
                        style="${system.hasAutomation && system.hasAutomation !== 'לא קיימות'
                ? '' : 'opacity:0.4;pointer-events:none'}">
                        <label class="sc-edit-label">
                            <i class="fas fa-sticky-note"></i> הערת אוטומציה
                        </label>
                        <input type="text"
                            id="scEditAutomationNote"
                            class="sc-edit-input ${readOnly ? 'sc-edit-input-readonly' : ''}"
                            value="${this.escHtml(system.automationNote || '')}"
                            placeholder="פרטים על הבדיקות האוטומטיות..."
                            ${readOnly ? 'disabled' : ''}/>
                    </div>
                </div>

                <div class="sc-edit-servers-section" id="scEditServersSection">
                    <div class="sc-edit-servers-header">
                        <i class="fas fa-server" style="color:#6366f1"></i>
                        <span>שרתים משויכים</span>
                        <span class="sc-edit-servers-count" id="scEditServersCount">
                            טוען...
                        </span>
                    </div>
                    <div class="sc-edit-servers-list" id="scEditServersList">
                        <div class="sc-servers-modal-loading">
                            <i class="fas fa-spinner fa-spin"
                            style="color:#6366f1;font-size:0.9rem"></i>
                            <span style="font-size:0.8rem">טוען שרתים...</span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="sc-modal-footer">
                <button class="sc-modal-cancel-btn" id="scEditCancel">
                    <i class="fas fa-times"></i>
                    ${readOnly ? 'סגור' : 'ביטול'}
                </button>
                ${!readOnly ? `
                <button class="sc-edit-save-btn" id="scEditSave">
                    <i class="fas fa-save"></i> שמור שינויים
                </button>` : ''}
            </div>
        </div>`;

        document.body.appendChild(modal);
        // ─── אם עורך אוטומציה בלבד - Disable כל השדות חוץ מאוטומציה ───
        if (isAutomationEditor) {
            const allInputs = modal.querySelectorAll(
                'input, select, textarea'
            );
            allInputs.forEach(el => {
                // השאר פעיל רק שדות אוטומציה
                if (el.id !== 'scEditHasAutomation' &&
                    el.id !== 'scEditAutomationNote') {
                    el.disabled = true;
                    el.classList.add('sc-edit-input-readonly');
                }
            });

            // ─── הסתר כפתור Auto-fill ───
            const autoFillBtn = document.getElementById('scEditAutoFillBtn');
            if (autoFillBtn) autoFillBtn.style.display = 'none';

            // ─── הסתר כפתור תיקוף ───
            const validateBtn = document.getElementById('scCopyValidateLink');
            if (validateBtn) validateBtn.style.display = 'none';

        }

        // ─── סגירה ───
        const closeModal = () => modal.remove();

        this._loadServersForEditModal(systemId, system.number);
        document.getElementById('scEditClose')
            .addEventListener('click', closeModal);
        document.getElementById('scEditCancel')
            .addEventListener('click', closeModal);

        // ─── אירועי עריכה - רק אם לא readOnly ───
        if (!readOnly) {
            document.getElementById('scCopyValidateLink')
                ?.addEventListener('click', async () => {
                    const managerName = document.getElementById('scEditManager')
                        ?.value?.trim() || '';
                    const systemName = document.getElementById('scEditName')
                        ?.value?.trim() || system.name || '';

                    // ─── בקש טוקן מהשרת ───
                    let validateUrl = '';
                    try {
                        const tokenRes = await fetch(
                            `/SystemsCatalog/GenerateValidationToken?systemId=${encodeURIComponent(systemId)}`,
                            { credentials: 'include' }
                        );
                        const tokenData = await tokenRes.json();
                        if (tokenData.success) {
                            validateUrl = tokenData.url;
                        } else {
                            this.showToast('שגיאה ביצירת קישור', 'error');
                            return;
                        }
                    } catch (err) {
                        this.showToast('שגיאה ביצירת קישור', 'error');
                        return;
                    }

                    // ─── חפש מייל ───
                    let managerEmail = '';
                    if (managerName) {
                        try {
                            const res = await fetch(
                                `/PhoneDirectory/GetManagerEmail?name=${encodeURIComponent(managerName)}`
                            );
                            const data = await res.json();
                            if (data.success && data.email) {
                                managerEmail = data.email;
                            }
                        } catch (err) {
                            console.warn('GetManagerEmail error:', err);
                        }
                    }

                    this._showValidateLinkPopup(
                        validateUrl, managerName, systemName,
                        managerEmail, systemId
                    );
                });

            if (!isAutomationEditor) {
                document.getElementById('scEditAutoFillBtn')
                    ?.addEventListener('click', () => {
                        const name = document.getElementById('scEditManager')?.value?.trim();
                        name
                            ? this._autoFillOrgInfo(name, 'scEdit')
                            : this.showToast('הזן שם מנהל מערכת תחילה', 'info');
                    });

                document.getElementById('scEditManager')
                    ?.addEventListener('blur', e => {
                        const val = e.target.value?.trim();
                        if (val?.length >= 2)
                            this._autoFillOrgInfo(val, 'scEdit');
                    });
            }
            document.getElementById('scEditManager')
                ?.addEventListener('blur', e => {
                    const val = e.target.value?.trim();
                    if (val?.length >= 2)
                        this._autoFillOrgInfo(val, 'scEdit');
                });

            document.getElementById('scEditSave')
                ?.addEventListener('click', () =>
                    this._saveSystemEdit(systemId, modal));
        }
        // ─── כפתור "נדרש תיקוף" ───
        if (!readOnly) {
            document.getElementById('scToggleRequiresValidation')
                ?.addEventListener('click', async () => {
                    const btn = document.getElementById('scToggleRequiresValidation');
                    if (!btn) return;

                    const currentVal = btn.dataset.current === 'true';
                    const newVal = !currentVal;

                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';

                    try {
                        const res = await fetch('/SystemsCatalog/UpdateSystem', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({
                                systemId,
                                requiresValidation: newVal
                            })
                        });
                        const data = await res.json();

                        if (!data.success)
                            throw new Error(data.error || 'שגיאה בשמירה');

                        // ─── עדכן allSystems ───
                        const idx = this.allSystems.findIndex(s => s.id === systemId);
                        if (idx !== -1) {
                            this.allSystems[idx].requiresValidation = newVal;
                        }

                        // ─── עדכן כפתור ───
                        btn.dataset.current = newVal ? 'true' : 'false';
                        btn.disabled = false;
                        btn.className = `sc-requires-validation-btn${newVal
                            ? ' sc-requires-validation-active' : ''}`;
                        btn.title = newVal
                            ? 'מערכת זו מסומנת כדורשת תיקוף - לחץ לביטול'
                            : 'סמן מערכת זו כדורשת תיקוף';
                        btn.innerHTML = `
                    <i class="fas fa-circle-check"></i>
                    ${newVal ? 'מסומן: נדרש תיקוף' : 'נדרש תיקוף'}`;

                        this.applyFiltersAndSort();
                        this.renderContent();
                        this.updateStats();

                        this.showToast(
                            newVal
                                ? `✅ המערכת סומנה כדורשת תיקוף`
                                : `✅ הסימון הוסר`,
                            'success'
                        );

                    } catch (err) {
                        console.error('toggleRequiresValidation error:', err);
                        this.showToast('שגיאה: ' + err.message, 'error');
                        btn.disabled = false;
                        btn.innerHTML = `<i class="fas fa-circle-check"></i>
                    ${currentVal ? 'מסומן: נדרש תיקוף' : 'נדרש תיקוף'}`;
                    }
                });
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל הוספת מערכת חדשה
    // ══════════════════════════════════════════════════════════
    openAddModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה להוספת מערכת', 'error');
            return;
        }

        const existing = document.getElementById('scAddModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'scAddModal';
        modal.className = 'sc-modal-overlay';

        modal.innerHTML = `
    <div class="sc-modal sc-edit-modal">
        <div class="sc-modal-header">
            <h3 class="sc-modal-title">
                <i class="fas fa-plus-circle" 
                   style="color:#22c55e"></i>
                הוספת מערכת חדשה לקטלוג
            </h3>
            <button class="sc-modal-close" 
                    id="scAddClose">&times;</button>
        </div>

        <div class="sc-modal-body sc-edit-modal-body">

            <div class="sc-edit-row">
                <div class="sc-edit-field">
                    <label class="sc-edit-label">
                        <i class="fas fa-hashtag"></i> מספר קטלוג
                        <button type="button"
                                id="scAddGenerateNumberBtn"
                                class="sc-autofill-btn"
                                title="גנרט מספר קטלוגי פנוי">
                            <i class="fas fa-magic"></i>
                        </button>
                    </label>
                    <div class="sc-add-number-wrap">
                        <input type="text" id="scAddNumber"
                            class="sc-edit-input"
                            placeholder="APM0000001..."/>
                        <span id="scAddNumberStatus"
                            class="sc-add-number-status"></span>
                    </div>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-layer-group"></i> שם מערכת
                    </label>
                    <input type="text" id="scAddName"
                           class="sc-edit-input"
                           placeholder="שם המערכת בעברית..."/>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-font"></i> שם אנגלית
                    </label>
                    <input type="text" id="scAddNameEn"
                           class="sc-edit-input" dir="ltr"
                           placeholder="System name in English..."/>
                </div>
            </div>

            <div class="sc-edit-field sc-edit-field-full">
                <label class="sc-edit-label">
                    <i class="fas fa-align-left"></i> תיאור
                </label>
                <textarea id="scAddDesc" class="sc-form-textarea"
                          rows="2"
                          placeholder="תיאור המערכת..."></textarea>
            </div>

            <div class="sc-edit-row">
                <div class="sc-edit-field">
                    <label class="sc-edit-label">
                        <i class="fas fa-circle-dot"></i> סטטוס
                    </label>
                    <select id="scAddStatus" 
                            class="sc-select sc-edit-select">
                        ${['', 'פעיל', 'פעילה', 'לא פעיל',
                'לא פעילה', 'בפיתוח', 'בהקמה',
                'פיילוט', 'בהקפאה', 'מיועד לסגירה',
                'מבוטלת']
                .map(v => `<option value="${v}">
                                ${v || '— לא הוגדר —'}
                               </option>`)
                .join('')}
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-user-tie"></i> מנהל מערכת
                        <button type="button"
                                id="scAddAutoFillBtn"
                                class="sc-autofill-btn"
                                title="מלא אוטומטית צוות/מחלקה/תחום/אגף לפי שם המנהל">
                            <i class="fas fa-magic"></i>
                        </button>
                    </label>
                    <input type="text" id="scAddManager"
                           class="sc-edit-input"
                           placeholder="שם מנהל המערכת..."/>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-user-shield"></i> מנהל מחלקה
                    </label>
                    <input type="text" id="scAddDeptManager"
                        class="sc-edit-input"
                        placeholder="שם מנהל המחלקה..."/>
                </div>
                <div class="sc-edit-field">
                    <label class="sc-edit-label">
                        <i class="fas fa-industry"></i> סביבה
                    </label>
                    <select id="scAddEnv" class="sc-select sc-edit-select">
                        <option value="">— בחר סביבה —</option>
                        ${this._buildDynamicOptions('environment', '')}
                    </select>
                </div>
            </div>

            <div class="sc-edit-row">
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-sitemap"></i> תחום
                    </label>
                    <select id="scAddDomain" class="sc-select sc-edit-select">
                        <option value="">— בחר תחום —</option>
                        ${this._buildDynamicOptions('domain', '')}
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-building"></i> מחלקה
                    </label>
                    <select id="scAddDept" class="sc-select sc-edit-select">
                        <option value="">— בחר מחלקה —</option>
                        ${this._buildDynamicOptions('department', '')}
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-users"></i> צוות
                    </label>
                    <select id="scAddTeam" class="sc-select sc-edit-select">
                        <option value="">— בחר צוות —</option>
                        ${this._buildDynamicOptions('team', '')}
                    </select>
                </div>
            </div>

            <div class="sc-edit-row">
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-briefcase"></i> אגף עסקי
                    </label>
                    <select id="scAddBizDiv" class="sc-select sc-edit-select">
                        <option value="">— בחר אגף עסקי —</option>
                        ${this._buildDynamicOptions('businessDivision', '')}
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-tag"></i> סיווג יישום
                    </label>
                    <select id="scAddAppClass" class="sc-select sc-edit-select">
                        <option value="">— בחר סיווג —</option>
                        ${this._buildDynamicOptions('appClassification', '')}
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-cube"></i> סוג יישום
                    </label>
                    <select id="scAddAppType" class="sc-select sc-edit-select">
                        <option value="">— בחר סוג —</option>
                        ${this._buildDynamicOptions('appType', '')}
                    </select>
                </div>
            </div>

            <div class="sc-edit-row">
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-exclamation-triangle"></i>
                        קריטיות עסקית
                    </label>
                    <select id="scAddCriticality" class="sc-select sc-edit-select">
                        <option value="">— בחר קריטיות —</option>
                        ${this._buildDynamicOptions('businessCriticality', '')}
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-clock"></i> דרישת זמינות
                    </label>
                    <select id="scAddAvailability" class="sc-select sc-edit-select">
                        <option value="">— בחר זמינות —</option>
                        ${this._buildDynamicOptions('availabilityRequirement', '')}
                    </select>
                </div>
            </div>

            <div class="sc-edit-row">
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-building-user"></i> מפרסם
                    </label>
                    <input type="text" id="scAddPublisher"
                           class="sc-edit-input"
                           placeholder="מפרסם..."/>
                </div>
                <div class="sc-edit-field sc-edit-field-wide">
                    <label class="sc-edit-label">
                        <i class="fas fa-headset"></i> ספק תמיכה
                    </label>
                    <input type="text" id="scAddVendor"
                           class="sc-edit-input"
                           placeholder="ספק תמיכה..."/>
                </div>
                <div class="sc-edit-field">
                    <label class="sc-edit-label">
                        <i class="fas fa-calendar"></i> תאריך יצירה
                    </label>
                    <input type="text" id="scAddCreated"
                           class="sc-edit-input"
                           placeholder="DD/MM/YYYY"/>
                </div>
            </div>
            <div class="sc-edit-row sc-edit-row-automation">
                <div class="sc-edit-field">
                    <label class="sc-edit-label">
                        <i class="fas fa-robot"></i> אוטומציה
                    </label>
                    <select id="scAddHasAutomation"
                            class="sc-select sc-edit-select">
                        <option value="לא קיימות" selected>לא קיימות</option>
                        <option value="קיימות">קיימות</option>
                        <option value="לא רלוונטי">לא רלוונטי</option>
                    </select>
                </div>
                <div class="sc-edit-field sc-edit-field-wide"
                    id="scAddAutomationNoteWrap"
                    style="opacity:0.4;pointer-events:none">
                    <label class="sc-edit-label">
                        <i class="fas fa-sticky-note"></i> הערת אוטומציה
                    </label>
                    <input type="text"
                        id="scAddAutomationNote"
                        class="sc-edit-input"
                        placeholder="פרטים על הבדיקות האוטומטיות..."/>
                </div>
            </div>

        </div>

        <div class="sc-modal-footer">
            <button class="sc-modal-cancel-btn" id="scAddCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button class="sc-add-save-btn" id="scAddSave">
                <i class="fas fa-plus-circle"></i> הוסף מערכת
            </button>
        </div>
    </div>`;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();

        document.getElementById('scAddClose')
            .addEventListener('click', closeModal);
        document.getElementById('scAddCancel')
            .addEventListener('click', closeModal);
        document.getElementById('scAddGenerateNumberBtn')
            ?.addEventListener('click', () =>
                this._generateNextCatalogNumber()
            );
        // ─── Auto-fill לפי מנהל מערכת ────────────────────────────────
        document.getElementById('scAddAutoFillBtn')
            ?.addEventListener('click', () => {
                const name = document
                    .getElementById('scAddManager')?.value?.trim();
                name
                    ? this._autoFillOrgInfo(name, 'scAdd')
                    : this.showToast('הזן שם מנהל מערכת תחילה', 'info');
            });

        document.getElementById('scAddManager')
            ?.addEventListener('blur', e => {
                const val = e.target.value?.trim();
                if (val?.length >= 2)
                    this._autoFillOrgInfo(val, 'scAdd');
            });

        document.getElementById('scAddSave')
            .addEventListener('click', () =>
                this._saveNewSystem(modal));
    }

    // ══════════════════════════════════════════════════════════
    // גנרציית מספר קטלוגי פנוי
    // ══════════════════════════════════════════════════════════
    async _generateNextCatalogNumber() {
        const btn = document.getElementById('scAddGenerateNumberBtn');
        const input = document.getElementById('scAddNumber');
        const statusEl = document.getElementById('scAddNumberStatus');

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            // ─── אסוף את כל המספרים הקיימים ───
            const existingNumbers = this.allSystems
                .map(s => String(s.number || '').trim().toUpperCase())
                .filter(n => /^APM\d+$/.test(n));

            // ─── מצא את המספר הגבוה ביותר ───
            let maxNum = 0;
            existingNumbers.forEach(n => {
                const num = parseInt(n.replace('APM', ''), 10);
                if (!isNaN(num) && num > maxNum) maxNum = num;
            });

            // ─── מצא מספר פנוי (לא בשימוש) ───
            // ← קודם נסה את הבא אחרי המקסימום
            let nextNum = maxNum + 1;
            const existingSet = new Set(existingNumbers);
            const MIN_CATALOG_NUMBER = 5; // Start catalog number auto-generation from 5
            2
            // ← חפש חורים ברצף (מספרים שדולגו)
            for (let i = MIN_CATALOG_NUMBER; i < nextNum; i++) {
                const candidate = 'APM' + String(i).padStart(7, '0');
                if (!existingSet.has(candidate)) {
                    nextNum = i;
                    break;
                }
            }

            const newNumber = 'APM' + String(nextNum).padStart(7, '0');

            // ─── בדוק שהמספר אכן פנוי ───
            const isDuplicate = existingSet.has(newNumber);

            if (isDuplicate) {
                // ← אם יש כפילות (לא אמור לקרות) - קח את הבא
                const fallback = 'APM' + String(maxNum + 1).padStart(7, '0');
                if (input) input.value = fallback;
                if (statusEl) {
                    statusEl.textContent = '✓ פנוי';
                    statusEl.className = 'sc-add-number-status sc-number-ok';
                }
                this.showToast(`מספר קטלוגי: ${fallback}`, 'success');
            } else {
                if (input) {
                    input.value = newNumber;
                    input.classList.add('sc-autofilled');
                    setTimeout(() =>
                        input.classList.remove('sc-autofilled'), 2000
                    );
                }
                if (statusEl) {
                    statusEl.textContent = '✓ פנוי';
                    statusEl.className =
                        'sc-add-number-status sc-number-ok';
                    setTimeout(() => {
                        if (statusEl) statusEl.textContent = '';
                    }, 3000);
                }
                this.showToast(
                    `✅ מספר קטלוגי פנוי: ${newNumber}`, 'success'
                );
            }

        } catch (err) {
            console.error('_generateNextCatalogNumber error:', err);
            this.showToast('שגיאה בגנרציית מספר: ' + err.message, 'error');
            if (statusEl) {
                statusEl.textContent = '✗ שגיאה';
                statusEl.className = 'sc-add-number-status sc-number-error';
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-magic"></i>';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // הדגש שדה כפול במודל הוספת מערכת
    // ══════════════════════════════════════════════════════════
    _highlightDuplicateField(duplicateField, duplicateSystem) {
        const fieldToInputId = {
            number: 'scAddNumber',
            name: 'scAddName',
            nameEn: 'scAddNameEn',
        };

        const inputId = fieldToInputId[duplicateField];
        if (!inputId) return;

        const input = document.getElementById(inputId);
        if (!input) return;

        // ─── הסר הודעה קיימת ───
        const existingMsg = document.getElementById(`scDupMsg_${inputId}`);
        if (existingMsg) existingMsg.remove();

        // ─── הדגש בצבע אדום ───
        input.style.borderColor = '#ef4444';
        input.style.boxShadow = '0 0 0 3px rgba(239,68,68,0.25)';
        input.style.background = 'rgba(239,68,68,0.08)';

        // ─── מצא את ה-form-group האב (לא ה-wrap הפנימי) ───
        // עבור שדה מספר: input → .sc-add-number-wrap → .sc-edit-field
        // עבור שאר השדות: input → .sc-edit-field
        const wrap = input.closest('.sc-add-number-wrap');
        const container = wrap
            ? wrap.closest('.sc-edit-field')
            : input.closest('.sc-edit-field');

        const insertTarget = container || input.parentNode;

        // ─── בנה הודעת שגיאה ───
        const msg = document.createElement('div');
        msg.id = `scDupMsg_${inputId}`;
        msg.style.cssText = `
        font-size: 0.72rem;
        color: #fca5a5;
        margin-top: 5px;
        display: flex;
        align-items: center;
        gap: 5px;
        animation: scFadeIn 0.2s ease;
        width: 100%;
    `;

        const fieldLabels = {
            number: 'מספר קטלוג',
            name: 'שם מערכת',
            nameEn: 'שם אנגלי',
        };

        const systemInfo = duplicateSystem
            ? ` (מערכת: "${duplicateSystem.name}"${duplicateSystem.number
                ? `, #${duplicateSystem.number}` : ''})`
            : '';

        msg.innerHTML = `
        <i class="fas fa-exclamation-circle"
           style="color:#ef4444;flex-shrink:0"></i>
        <span>${fieldLabels[duplicateField] || duplicateField} כבר קיים${systemInfo}</span>
    `;

        // ─── הוסף את ההודעה אחרי ה-container (לא בתוך ה-wrap) ───
        insertTarget.appendChild(msg);

        // ─── גלול לשדה הבעייתי ───
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();

        // ─── נקה הדגשה אחרי שינוי ───
        const clearHighlight = () => {
            input.style.borderColor = '';
            input.style.boxShadow = '';
            input.style.background = '';
            const msgEl = document.getElementById(`scDupMsg_${inputId}`);
            if (msgEl) msgEl.remove();
            input.removeEventListener('input', clearHighlight);
        };

        input.addEventListener('input', clearHighlight);
    }

    async _saveNewSystem(modal) {
        const saveBtn = document.getElementById('scAddSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const payload = {
                number: document.getElementById('scAddNumber')
                    ?.value?.trim() || '',
                name: document.getElementById('scAddName')
                    ?.value?.trim() || '',
                nameEn: document.getElementById('scAddNameEn')
                    ?.value?.trim() || '',
                description: document.getElementById('scAddDesc')
                    ?.value?.trim() || '',
                status: document.getElementById('scAddStatus')
                    ?.value || '',
                systemManager: document.getElementById('scAddManager')
                    ?.value?.trim() || '',
                departmentManager: document.getElementById('scAddDeptManager')
                    ?.value?.trim() || '',
                environment: document.getElementById('scAddEnv')
                    ?.value?.trim() || '',
                domain: document.getElementById('scAddDomain')
                    ?.value?.trim() || '',
                department: document.getElementById('scAddDept')
                    ?.value?.trim() || '',
                team: document.getElementById('scAddTeam')
                    ?.value?.trim() || '',
                businessDivision: document.getElementById('scAddBizDiv')
                    ?.value?.trim() || '',
                appClassification: document.getElementById('scAddAppClass')
                    ?.value?.trim() || '',
                appType: document.getElementById('scAddAppType')
                    ?.value?.trim() || '',
                businessCriticality: document.getElementById('scAddCriticality')
                    ?.value?.trim() || '',
                availabilityRequirement: document.getElementById('scAddAvailability')
                    ?.value?.trim() || '',
                publisher: document.getElementById('scAddPublisher')
                    ?.value?.trim() || '',
                supportVendor: document.getElementById('scAddVendor')
                    ?.value?.trim() || '',
                createdAt: document.getElementById('scAddCreated')
                    ?.value?.trim() || '',
                hasAutomation: document.getElementById('scAddHasAutomation')
                    ?.value || 'לא קיימות',
                automationNote: document.getElementById('scAddAutomationNote')
                    ?.value?.trim() || '',
            };

            if (!payload.number) {
                this.showToast('מספר קטלוגי הוא שדה חובה', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-plus-circle"></i> הוסף מערכת';
                }
                document.getElementById('scAddNumber')?.focus();
                return;
            }
            // ולידציה למספר קטלוגי
            // פורמט מלא: APM0000033
            const catalogNumberRegex = /^APM0000\d+$/;

            if (!catalogNumberRegex.test(payload.number)) {
                this.showToast(
                    'המספר הקטלוגי חייב להתחיל ב-APM0000 (לדוגמה: APM0000033)',
                    'error'
                );
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        '<i class="fas fa-plus-circle"></i> הוסף מערכת';
                }
                document.getElementById('scAddNumber')?.focus();
                return;
            }

            // ─── ולידציה בצד לקוח לפני שליחה לשרת ───
            if (!payload.name) {
                this.showToast('שם מערכת הוא שדה חובה', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        '<i class="fas fa-plus-circle"></i> הוסף מערכת';
                }
                document.getElementById('scAddName')?.focus();
                return;
            }


            if (!payload.nameEn) {
                this.showToast('שם באנגלית הוא שדה חובה', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-plus-circle"></i> הוסף מערכת';
                }
                document.getElementById('scAddNameEn')?.focus();
                return;
            }

            // ולידציה לשם מערכת - אנגלית בלבד
            const englishNameRegex = /^[A-Za-z0-9\s\-_().]+$/;

            if (!englishNameRegex.test(payload.nameEn)) {
                this.showToast('שם באנגלית חייב להכיל אותיות באנגלית בלבד (ללא עברית)', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        '<i class="fas fa-plus-circle"></i> הוסף מערכת';
                }
                document.getElementById('scAddNameEn')?.focus();
                return;
            }

            if (!payload.systemManager) {
                this.showToast('מנהל מערכת הוא שדה חובה', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML = '<i class="fas fa-plus-circle"></i> הוסף מערכת';
                }
                document.getElementById('scAddManager')?.focus();
                return;
            }

            const res = await fetch('/SystemsCatalog/AddSystem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!data.success) {
                // ─── הדגש שדה כפול אם קיים ───────────────────────
                if (data.duplicateField) {
                    this._highlightDuplicateField(
                        data.duplicateField,
                        data.duplicateSystem
                    );
                }
                throw new Error(data.error || 'שגיאה בהוספה');
            }

            // ─── הוסף לרשימה המקומית ───
            if (data.system) {
                this.allSystems.push(data.system);
            }

            modal.remove();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            const name = payload.name || 'מערכת חדשה';
            this.showToast(`✅ המערכת "${name}" נוספה בהצלחה`, 'success');

        } catch (err) {
            console.error('_saveNewSystem error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-plus-circle"></i> הוסף מערכת';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // פופאפ תיקוף מערכת - העתק / שלח מייל
    // ══════════════════════════════════════════════════════════
    _showValidateLinkPopup(url, managerName, systemName, managerEmail = '', systemId = '') {
        // ─── הסר פופאפ קיים ───
        const existing = document.getElementById('scValidateLinkPopup');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'scValidateLinkPopup';
        overlay.className = 'sc-modal-overlay';
        overlay.style.zIndex = '999999';

        const emailSubject = encodeURIComponent(`בקשה לתיקוף פרטי מערכת: ${systemName}`);

        const fullName = managerName || 'שלום';

        // ─── נוסח המייל המעודכן ───
        const emailBodyText =
            `שלום ${fullName},\n\n` +
            `יש להשלים את עדכון פרטי המערכת שבאחריותך.\n` +
            `ניתן ללחוץ על הקישור מטה ולעדכן את הפרטים הרלוונטיים בשדות הטופס.\n` +
            `הסבר על השדה ניתן למצא בריחוף העכבר על שם השדה.\n\n` +
            `לתיקוף נתוני מערכת ${systemName} לחץ כאן:\n` +
            `${url}\n\n` +
            `לשאלות נוספות ניתן לפנות אלינו במייל חוזר.\n\n` +
            `תודה`;

        const emailBody = encodeURIComponent(emailBodyText);

        overlay.innerHTML = `
    <div class="sc-modal sc-validate-popup"
         style="max-width:460px;width:95%">

        <!-- כותרת -->
        <div class="sc-modal-header">
            <h3 class="sc-modal-title">
                <i class="fas fa-link" style="color:#6366f1"></i>
                תיקוף מערכת
            </h3>
            <button class="sc-modal-close"
                    id="scValidatePopupClose">&times;</button>
        </div>

        <!-- גוף -->
        <div class="sc-modal-body" style="gap:16px">

            <!-- שם מערכת -->
            <div class="sc-validate-system-name">
                <i class="fas fa-layer-group"
                   style="color:#6366f1;font-size:0.8rem"></i>
                <span>${this.escHtml(systemName)}</span>
            </div>

            <!-- תצוגת הקישור -->
            <div class="sc-validate-url-box">
                <span class="sc-validate-url-text"
                      title="${this.escHtml(url)}">
                    ${this.escHtml(url)}
                </span>
            </div>

            <!-- כפתורי פעולה -->
            <div class="sc-validate-actions">

                <!-- שלח מייל (mailto) -->
                <!-- שלח מייל אוטומטי -->
                <button class="sc-validate-btn sc-validate-btn-email"
                        id="scValidateDownloadEml"
                        title="${managerEmail
                ? 'שלח מייל ל: ' + managerEmail
                : 'שלח מייל (אין כתובת מנהל)'}"
                        ${managerEmail ? '' : 'disabled style="opacity:0.5;cursor:not-allowed"'}>
                    <i class="fas fa-envelope"></i>
                    <span>
                        שלח מייל
                        ${managerEmail
                ? `<span class="sc-validate-email-to">
                                ${this.escHtml(managerName)}
                            </span>`
                : `<span class="sc-validate-email-missing">
                                (אין כתובת מנהל)
                            </span>`}
                    </span>
                </button>

                <!-- העתק קישור -->
                <button class="sc-validate-btn sc-validate-btn-copy"
                        id="scValidateCopyBtn"
                        title="העתק קישור ללוח">
                    <i class="fas fa-copy"></i>
                    <span>העתק קישור</span>
                </button>
            </div>

            <!-- הערה אם אין מייל -->
            ${!managerEmail ? `
            <div class="sc-validate-no-email-note">
                <i class="fas fa-info-circle"
                   style="color:#f59e0b"></i>
                <span>
                    לא הוגדרה כתובת מייל למנהל המערכת.
                    ניתן להעתיק את הקישור ולשלוח ידנית.
                </span>
            </div>` : ''}

        </div>

        <!-- Footer -->
        <div class="sc-modal-footer">
            <button class="sc-modal-cancel-btn"
                    id="scValidatePopupCancel">
                <i class="fas fa-times"></i> סגור
            </button>
        </div>

    </div>`;

        document.body.appendChild(overlay);

        // ─── סגירה ───
        const closePopup = () => overlay.remove();

        document.getElementById('scValidatePopupClose')
            .addEventListener('click', closePopup);
        document.getElementById('scValidatePopupCancel')
            .addEventListener('click', closePopup);

        // ─── העתק קישור ───
        document.getElementById('scValidateCopyBtn')
            .addEventListener('click', () => {
                navigator.clipboard.writeText(url)
                    .then(() => {
                        const btn = document.getElementById('scValidateCopyBtn');
                        if (btn) {
                            btn.innerHTML =
                                '<i class="fas fa-check"></i><span>הועתק!</span>';
                            btn.style.background = 'rgba(34,197,94,0.2)';
                            btn.style.borderColor = 'rgba(34,197,94,0.5)';
                            btn.style.color = '#86efac';
                            setTimeout(() => {
                                btn.innerHTML =
                                    '<i class="fas fa-copy"></i>' +
                                    '<span>העתק קישור</span>';
                                btn.style.background = '';
                                btn.style.borderColor = '';
                                btn.style.color = '';
                            }, 2000);
                        }
                        this.showToast('🔗 הקישור הועתק ללוח', 'success');
                    })
                    .catch(() => {
                        const ta = document.createElement('textarea');
                        ta.value = url;
                        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                        this.showToast('🔗 הקישור הועתק ללוח', 'success');
                    });
            });

        // ─── שלח מייל אוטומטי ───
        document.getElementById('scValidateDownloadEml')
            .addEventListener('click', async () => {
                if (!managerEmail) {
                    this.showToast('לא נמצאה כתובת מייל למנהל', 'error');
                    return;
                }

                const btn = document.getElementById('scValidateDownloadEml');
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML =
                        '<i class="fas fa-spinner fa-spin"></i>' +
                        '<span>שולח...</span>';
                }

                try {
                    const res = await fetch('/SystemsCatalog/SendValidationEmail', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            systemId: systemId,
                            managerEmail: managerEmail
                        })
                    });

                    const data = await res.json();

                    if (!data.success)
                        throw new Error(data.error || 'שגיאה בשליחה');

                    // ─── עדכן UI של כפתור התיקוף במודל העריכה ───
                    if (data.requiresValidation) {
                        const validateBtn = document.getElementById(
                            'scToggleRequiresValidation'
                        );
                        if (validateBtn) {
                            validateBtn.dataset.current = 'true';
                            validateBtn.className =
                                'sc-requires-validation-btn sc-requires-validation-active';
                            validateBtn.innerHTML = `
                        <i class="fas fa-circle-check"></i>
                        מסומן: נדרש תיקוף`;
                        }

                        // ─── עדכן allSystems מקומית ───
                        const sys = this.allSystems.find(s => s.id === systemId);
                        if (sys) sys.requiresValidation = true;

                        this.applyFiltersAndSort();
                        this.renderContent();
                        this.updateStats();
                    }

                    // ─── עדכן כפתור לאישור ───
                    if (btn) {
                        btn.innerHTML =
                            '<i class="fas fa-check"></i>' +
                            '<span>נשלח בהצלחה!</span>';
                        btn.style.background = 'rgba(34,197,94,0.2)';
                        btn.style.borderColor = 'rgba(34,197,94,0.5)';
                        btn.style.color = '#86efac';

                        setTimeout(() => {
                            if (btn) {
                                btn.disabled = false;
                                btn.innerHTML =
                                    `<i class="fas fa-envelope"></i>` +
                                    `<span>שלח מייל` +
                                    `<span class="sc-validate-email-to">` +
                                    `${this.escHtml(managerName)}</span></span>`;
                                btn.style.background = '';
                                btn.style.borderColor = '';
                                btn.style.color = '';
                            }
                        }, 3000);
                    }

                    this.showToast(
                        `📧 מייל תיקוף נשלח ל-${managerName}`,
                        'success'
                    );

                } catch (err) {
                    console.error('SendValidationEmail error:', err);
                    this.showToast('שגיאה בשליחת מייל: ' + err.message, 'error');

                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML =
                            '<i class="fas fa-envelope"></i>' +
                            `<span>שלח מייל` +
                            `<span class="sc-validate-email-to">` +
                            `${this.escHtml(managerName)}</span></span>`;
                    }
                }
            });
    }

    // ══════════════════════════════════════════════════════════
    // המרת לוגו ל-Base64 להטמעה במייל
    // ══════════════════════════════════════════════════════════
    async _getLogoBase64() {
        try {
            const res = await fetch('/images/menora-logo.png');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            console.warn('_getLogoBase64 error:', err);
            // fallback — תמונה שקופה 1x1
            return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
    }

    // ══════════════════════════════════════════════════════════
    // הורדת קובץ EML לתיקוף מערכת
    // ══════════════════════════════════════════════════════════

    async _downloadValidationEml(toEmail, subject, url, systemName, fullName, plainTextBody) {
        try {
            // ─── המר לוגו ל-Base64 ───
            const logoBase64 = await this._getLogoBase64();

            const htmlBody = `<!DOCTYPE html>
<html dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>${systemName}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;
            font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;direction:rtl;">

    <table width="100%" cellpadding="0" cellspacing="0"
           style="background-color:#f4f4f4;padding:30px 0;">
        <tr>
            <td align="center">
                <table width="760" cellpadding="0" cellspacing="0"
                       style="background-color:#ffffff;">

                    <!-- פס עליון -->
                    <tr>
                        <td style="background-color:#1e1b4b;
                                   height:4px;font-size:0;line-height:0;">
                            &nbsp;
                        </td>
                    </tr>

                    <tr>
                        <td style="background-color:#f5c518;
                                padding:16px 28px;
                                text-align:center;
                                border:0;">

                            <div style="display:inline-flex;
                                        align-items:center;
                                        gap:10px;">

                                <!-- ─── תמונה מוטמעת Base64 ─── -->
                                <img src="${logoBase64}"
                                    width="32" height="32"
                                    alt="מנורה מבטחים"
                                    style="display:block;
                                            border-radius:6px;"/>

                                <div>
                                    <div style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;
                                                font-size:20px;
                                                font-weight:800;
                                                color:#1e1b4b;
                                                letter-spacing:0.3px;
                                                white-space:nowrap;
                                                line-height:1.2;">
                                        קטלוג מערכות
                                    </div>
                                </div>

                            </div>
                        </td>
                    </tr>
                    <!-- פס הפרדה סגול -->
                    <tr>
                        <td style="background-color:#1e1b4b;
                                height:4px;
                                font-size:0;
                                line-height:0;">
                            &nbsp;
                        </td>
                    </tr>
                    <!-- גוף המייל -->
                    <tr>
                        <td style="padding:36px 40px 28px 40px;
                                   color:#222222;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:19px;
                                   line-height:1.8;">

                            <p style="margin:0 0 18px 0;">
                                שלום ${this.escHtml(fullName)},
                            </p>

                            <p style="margin:0 0 18px 0;">
                                יש להשלים את עדכון פרטי המערכת שבאחריותך.
                            </p>

                            <p style="margin:0 0 18px 0;">
                                ניתן ללחוץ על הקישור מטה ולעדכן את הפרטים
                                הרלוונטיים בשדות הטופס.
                            </p>

                            <p style="margin:0 0 28px 0;">
                                הסבר על השדה ניתן למצוא בריחוף העכבר על שם השדה.
                            </p>

                            <!-- שורת קישור -->
                            <p style="margin:0 0 28px 0;">
                                לתיקוף נתוני מערכת
                                <strong style="color:#1e1b4b;">
                                    ${this.escHtml(systemName)}
                                </strong>
                                &nbsp;
                                <a href="${this.escHtml(url)}"
                                   style="color:#1e1b4b;
                                          text-decoration:underline;
                                          font-weight:600;">
                                    לחץ כאן
                                </a>
                            </p>

                            <p style="margin:0 0 18px 0;">
                                לשאלות נוספות ניתן לפנות אלינו במייל חוזר.
                            </p>

                            <p style="margin:0;">תודה</p>

                        </td>
                    </tr>

                    <!-- פס הפרדה -->
                    <tr>
                        <td style="padding:0 40px;">
                            <hr style="border:none;border-top:1px solid #eeeeee;
                                       margin:0;">
                        </td>
                    </tr>

                    <!-- footer -->
                    <tr>
                        <td style="padding:16px 40px 24px 40px;
                                   font-size:11px;color:#aaaaaa;
                                   text-align:center;">
                            מייל זה נשלח בעזרת קטלוג המערכות <span style="color:#1e1b4b;font-weight:600;">NOC Portal</span>
                            &nbsp;
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>

</body>
</html>`;

            const decodedSubject = decodeURIComponent(subject);
            const emlContent =
                `X-Unsent: 1\r\n` +
                `To: ${toEmail || ''}\r\n` +
                `Subject: ${decodedSubject}\r\n` +
                `MIME-Version: 1.0\r\n` +
                `Content-Type: text/html; charset=UTF-8\r\n` +
                `\r\n` +
                htmlBody;

            const blob = new Blob([emlContent], { type: 'message/rfc822' });
            const blobUrl = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `תיקוף_${systemName.replace(/[^א-תa-zA-Z0-9]/g, '_')}.eml`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            }, 2000);

            this.showToast('📧 קובץ EML הורד - פתח אותו ב-Outlook לשליחה', 'success');

        } catch (error) {
            console.error('_downloadValidationEml error:', error);
            this.showToast('שגיאה ביצירת קובץ המייל', 'error');
        }
    }

    async _saveSystemEdit(systemId, modal) {
        const saveBtn = document.getElementById('scEditSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const payload = {
                systemId,
                number: document.getElementById('scEditNumber')?.value?.trim() || null,
                name: document.getElementById('scEditName')?.value?.trim() || null,
                nameEn: document.getElementById('scEditNameEn')?.value?.trim() || null,
                description: document.getElementById('scEditDesc')?.value?.trim() || null,
                status: document.getElementById('scEditStatus')?.value || null,
                systemManager: document.getElementById('scEditManager')?.value?.trim() || null,
                departmentManager: document.getElementById('scEditDeptManager')?.value?.trim() || null,
                environment: document.getElementById('scEditEnv')?.value?.trim() || null,
                domain: document.getElementById('scEditDomain')?.value?.trim() || null,
                department: document.getElementById('scEditDept')?.value?.trim() || null,
                team: document.getElementById('scEditTeam')?.value?.trim() || null,
                businessDivision: document.getElementById('scEditBizDiv')?.value?.trim() || null,
                appClassification: document.getElementById('scEditAppClass')?.value?.trim() || null,
                appType: document.getElementById('scEditAppType')?.value?.trim() || null,
                businessCriticality: document.getElementById('scEditCriticality')?.value?.trim() || null,
                availabilityRequirement: document.getElementById('scEditAvailability')?.value?.trim() || null,
                publisher: document.getElementById('scEditPublisher')?.value?.trim() || null,
                supportVendor: document.getElementById('scEditVendor')?.value?.trim() || null,
                createdAt: document.getElementById('scEditCreated')?.value?.trim() || null,
                hasAutomation: document.getElementById('scEditHasAutomation')?.value || 'לא קיימות',
                automationNote: document.getElementById('scEditAutomationNote')?.value?.trim() || null,
            };

            const res = await fetch('/SystemsCatalog/UpdateSystem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            const idx = this.allSystems.findIndex(s => s.id === systemId);
            if (idx !== -1 && data.system) {
                Object.assign(this.allSystems[idx], data.system);
            }

            modal.remove();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this.showToast(`✅ מערכת עודכנה בהצלחה`, 'success');

        } catch (err) {
            console.error('_saveSystemEdit error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל פערים בין קטלוג מערכות לשרתים
    // ══════════════════════════════════════════════════════════
    async openGapsModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לצפייה בפערים', 'error');
            return;
        }

        const existing = document.getElementById('scGapsModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'scGapsModal';
        modal.className = 'sc-modal-overlay';

        // ─── הצג loading ───
        modal.innerHTML = `
    <div class="sc-modal sc-gaps-modal">
        <div class="sc-modal-header sc-gaps-modal-header">
            <h3 class="sc-modal-title">
                <i class="fas fa-not-equal" style="color:#f59e0b"></i>
                פערים בין קטלוג מערכות לשרתים
            </h3>
            <button class="sc-modal-close" id="scGapsClose">&times;</button>
        </div>
        <div class="sc-gaps-modal-body">
            <div class="sc-gaps-loading">
                <i class="fas fa-spinner fa-spin" style="color:#6366f1;font-size:1.2rem"></i>
                <span>מנתח פערים...</span>
            </div>
        </div>
    </div>`;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();
        document.getElementById('scGapsClose')
            .addEventListener('click', closeModal);

        // ─── טען נתונים ───
        try {
            const res = await fetch('/Servers/GetSystemsGaps',
                { credentials: 'include' });
            const data = await res.json();

            const body = modal.querySelector('.sc-gaps-modal-body');

            if (!data.success) {
                body.innerHTML = `
            <div class="sc-gaps-error">
                <i class="fas fa-exclamation-triangle" style="color:#f59e0b"></i>
                <span>${this.escHtml(data.error || 'שגיאה בטעינת פערים')}</span>
            </div>`;
                return;
            }

            this._renderGapsContent(body, data);

        } catch (err) {
            const body = modal.querySelector('.sc-gaps-modal-body');
            if (body) {
                body.innerHTML = `
            <div class="sc-gaps-error">
                <i class="fas fa-exclamation-triangle" style="color:#f59e0b"></i>
                <span>שגיאה: ${this.escHtml(err.message)}</span>
            </div>`;
            }
        }
    }

    // ─── רנדר תוכן הפערים ────────────────────────────────────────
    _renderGapsContent(container, data) {
        const gaps = data.gaps || [];
        const summary = data.summary || {};
        const totalGaps = gaps.length;

        if (totalGaps === 0) {
            container.innerHTML = `
        <div class="sc-gaps-empty">
            <i class="fas fa-check-circle" style="color:#22c55e;font-size:2rem"></i>
            <div>
                <div style="font-size:1rem;font-weight:700;color:#86efac;margin-bottom:6px">
                    אין פערים!
                </div>
                <div style="font-size:0.82rem;color:#555">
                    כל המערכות בקטלוג תואמות לנתוני השרתים
                </div>
            </div>
        </div>`;
            return;
        }

        // ─── סוגי פערים לצבעים ───
        const gapTypeConfig = {
            'name_mismatch': { color: '#f59e0b', icon: 'fa-tag', label: 'שם מערכת שונה' },
            'manager_mismatch': { color: '#ef4444', icon: 'fa-user-tie', label: 'מנהל מערכת שונה' },
            'dept_mismatch': { color: '#8b5cf6', icon: 'fa-building', label: 'מחלקה שונה' },
            'team_mismatch': { color: '#3b82f6', icon: 'fa-users', label: 'צוות שונה' },
            'domain_mismatch': { color: '#06b6d4', icon: 'fa-sitemap', label: 'תחום שונה' },
            'catalog_missing': { color: '#ef4444', icon: 'fa-hashtag', label: 'מספר קטלוג חסר בשרת' },
            'system_not_in_catalog': { color: '#f43f5e', icon: 'fa-layer-group', label: 'מערכת לא בקטלוג' },
            'catalog_not_in_servers': { color: '#6366f1', icon: 'fa-server', label: 'קטלוג ללא שרתים' },
        };

        // ─── בנה סיכום לפי סוג ───
        const byType = {};
        gaps.forEach(g => {
            if (!byType[g.gapType]) byType[g.gapType] = 0;
            byType[g.gapType]++;
        });

        const summaryHtml = Object.entries(byType)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
                const cfg = gapTypeConfig[type] || {
                    color: '#888',
                    icon: 'fa-question',
                    label: type
                };
                return `
            <div class="sc-gaps-summary-pill"
                 style="border-color:${cfg.color}33;color:${cfg.color}"
                 onclick="window._scDashboard._filterGapsTable('${type}')"
                 title="לחץ לסינון">
                <i class="fas ${cfg.icon}"></i>
                <span>${cfg.label}</span>
                <span class="sc-gaps-summary-count"
                      style="background:${cfg.color}22">
                    ${count}
                </span>
            </div>`;
            }).join('');

        // ─── בנה שורות טבלה ───
        const rowsHtml = gaps.map((g, i) => {
            const cfg = gapTypeConfig[g.gapType] || {
                color: '#888',
                icon: 'fa-question',
                label: g.gapType
            };

            return `
        <tr class="sc-gaps-tr" data-gap-type="${this.escHtml(g.gapType)}">
            <td class="sc-gaps-td sc-gaps-td-type">
                <span class="sc-gaps-type-badge"
                      style="color:${cfg.color};
                             background:${cfg.color}18;
                             border-color:${cfg.color}33">
                    <i class="fas ${cfg.icon}"></i>
                    ${cfg.label}
                </span>
            </td>
            <td class="sc-gaps-td sc-gaps-td-catalog">
                ${g.catalogNumber
                    ? `<span class="sc-gaps-catalog-num">#${this.escHtml(g.catalogNumber)}</span>`
                    : '<span class="sc-gaps-empty-val">—</span>'}
            </td>
            <td class="sc-gaps-td sc-gaps-td-name">
                <div class="sc-gaps-name-wrap">
                    <span class="sc-gaps-name-catalog"
                          title="בקטלוג: ${this.escHtml(g.catalogValue || '')}">
                        <i class="fas fa-layer-group"
                           style="color:#6366f1;font-size:0.65rem"></i>
                        ${this.escHtml(g.catalogValue || '—')}
                    </span>
                    ${g.serverValue && g.serverValue !== g.catalogValue ? `
                    <span class="sc-gaps-name-server"
                          title="בשרתים: ${this.escHtml(g.serverValue || '')}">
                        <i class="fas fa-server"
                           style="color:#f59e0b;font-size:0.65rem"></i>
                        ${this.escHtml(g.serverValue || '—')}
                    </span>` : ''}
                </div>
            </td>
            <td class="sc-gaps-td sc-gaps-td-servers">
                <span class="sc-gaps-server-count"
                      title="${this.escHtml((g.affectedServers || []).join(', '))}">
                    ${g.affectedServers?.length || 0} שרתים
                    ${g.affectedServers?.length > 0 ? `
                    <i class="fas fa-info-circle"
                       style="color:#555;font-size:0.65rem"></i>` : ''}
                </span>
            </td>
            <td class="sc-gaps-td sc-gaps-td-action">
                ${g.catalogSystemId ? `
                <button class="sc-gaps-quick-fix-catalog-btn"
                        data-system-id="${this.escHtml(g.catalogSystemId)}"
                        data-gap-type="${this.escHtml(g.gapType)}"
                        data-server-value="${this.escHtml(g.serverValue || '')}"
                        data-catalog-value="${this.escHtml(g.catalogValue || '')}"
                        data-catalog-number="${this.escHtml(g.catalogNumber || '')}"
                        title="עדכן קטלוג לפי ערך השרת"
                        onclick="event.stopPropagation();
                                window._scDashboard._quickFixCatalog(this)">
                    <i class="fas fa-layer-group"></i>
                    <span>שנה בקטלוג</span>
                </button>` : ''}
                ${g.affectedServers?.length > 0 && g.serverValue ? `
                <button class="sc-gaps-quick-fix-server-btn"
                        data-system-id="${this.escHtml(g.catalogSystemId || '')}"
                        data-gap-type="${this.escHtml(g.gapType)}"
                        data-server-value="${this.escHtml(g.serverValue || '')}"
                        data-catalog-value="${this.escHtml(g.catalogValue || '')}"
                        data-catalog-number="${this.escHtml(g.catalogNumber || '')}"
                        data-affected-servers='${JSON.stringify(g.affectedServers || [])}'
                        title="עדכן שרתים לפי ערך הקטלוג"
                        onclick="event.stopPropagation();
                                window._scDashboard._quickFixServers(this)">
                    <i class="fas fa-server"></i>
                    <span>שנה בשרתים</span>
                </button>` : ''}
            </td>
        </tr>`;
        }).join('');

        container.innerHTML = `

    <!-- ── סיכום ── -->
    <div class="sc-gaps-summary-bar">
        <div class="sc-gaps-total-badge">
            <i class="fas fa-not-equal"></i>
            <span>סה"כ פערים: <strong>${totalGaps}</strong></span>
        </div>
        <div class="sc-gaps-summary-pills">
            ${summaryHtml}
        </div>
        <button class="sc-gaps-clear-filter-btn"
                id="scGapsClearFilter"
                style="display:none"
                onclick="window._scDashboard._filterGapsTable(null)">
            <i class="fas fa-times"></i>
            הצג הכל
        </button>
    </div>

    <!-- ── מידע נוסף ── -->
    <div class="sc-gaps-meta">
        <span>
            <i class="fas fa-layer-group" style="color:#6366f1"></i>
            מערכות בקטלוג: <strong>${data.catalogCount}</strong>
        </span>
        <span>
            <i class="fas fa-server" style="color:#f59e0b"></i>
            שרתים עם מערכת: <strong>${data.serversWithSystem}</strong>
        </span>
        <span>
            <i class="fas fa-clock" style="color:#555"></i>
            עודכן: ${new Date().toLocaleTimeString('he-IL')}
        </span>
    </div>

    <!-- ── טבלה ── -->
    <div class="sc-gaps-table-wrap">
        <table class="sc-gaps-table">
            <thead>
                <tr>
                    <th class="sc-gaps-th">סוג פער</th>
                    <th class="sc-gaps-th">מס׳ קטלוג</th>
                    <th class="sc-gaps-th">ערך בקטלוג / בשרתים</th>
                    <th class="sc-gaps-th">שרתים מושפעים</th>
                    <th class="sc-gaps-th" style="text-align: center;min-width:200px">תיקון מהיר</th>
                </tr>
            </thead>
            <tbody id="scGapsTbody">
                ${rowsHtml}
            </tbody>
        </table>
    </div>

    <!-- ── Footer ── -->
    <div class="sc-gaps-footer">
        <button class="sc-gaps-export-btn"
                onclick="window._scDashboard._exportGapsToExcel()">
            <i class="fas fa-file-excel"></i>
            ייצא פערים לאקסל
        </button>
        <button class="sc-gaps-refresh-btn"
                onclick="window._scDashboard._refreshGaps()">
            <i class="fas fa-sync-alt"></i>
            רענן
        </button>
    </div>`;

        // ─── שמור נתונים לייצוא ───
        this._currentGaps = gaps;
        this._currentGapsData = data;
    }

    // ─── סנן טבלת פערים לפי סוג ──────────────────────────────────
    _filterGapsTable(gapType) {
        const tbody = document.getElementById('scGapsTbody');
        if (!tbody) return;

        const clearBtn = document.getElementById('scGapsClearFilter');

        tbody.querySelectorAll('tr.sc-gaps-tr').forEach(row => {
            if (!gapType || row.dataset.gapType === gapType) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });

        if (clearBtn) {
            clearBtn.style.display = gapType ? 'flex' : 'none';
        }

        // ─── הדגש pill פעיל ───
        document.querySelectorAll('.sc-gaps-summary-pill').forEach(pill => {
            pill.classList.toggle(
                'sc-gaps-summary-pill-active',
                pill.onclick?.toString().includes(`'${gapType}'`)
            );
        });
    }

    // ─── טפל בפעולה על פער ───────────────────────────────────────
    _handleGapAction(systemId, gapType) {
        // ─── סגור מודל פערים ───
        document.getElementById('scGapsModal')?.remove();

        // ─── פתח עריכת מערכת ───
        this.openEditModal(systemId);
    }

    // ══════════════════════════════════════════════════════════
    // תיקון מהיר - עדכן קטלוג לפי ערך השרת
    // ══════════════════════════════════════════════════════════
    async _quickFixCatalog(btn) {
        const systemId = btn.dataset.systemId;
        const gapType = btn.dataset.gapType;
        const serverValue = btn.dataset.serverValue;
        const catalogValue = btn.dataset.catalogValue;
        const catalogNumber = btn.dataset.catalogNumber;

        if (!systemId || !gapType) return;

        // ─── מפה: סוג פער → שדה לעדכון ───
        const gapFieldMap = {
            'name_mismatch': 'name',
            'manager_mismatch': 'systemManager',
            'dept_mismatch': 'department',
            'team_mismatch': 'team',
            'domain_mismatch': 'domain',
            'catalog_missing': 'number',
        };

        const field = gapFieldMap[gapType];
        if (!field) {
            this.showToast('סוג פער זה אינו נתמך לתיקון מהיר', 'error');
            return;
        }

        // ─── אם אין ערך שרת - אין מה לעדכן ───
        if (!serverValue || serverValue === 'חסר מספר קטלוג') {
            this.showToast('אין ערך שרת לעדכון', 'error');
            return;
        }

        // ─── אנימציה על הכפתור ───
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const payload = {
                systemId,
                [field]: serverValue
            };

            const res = await fetch('/SystemsCatalog/UpdateSystem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!data.success) throw new Error(data.error || 'שגיאה בעדכון');

            // ─── עדכן את allSystems ───
            const idx = this.allSystems.findIndex(s => s.id === systemId);
            if (idx !== -1 && data.system) {
                Object.assign(this.allSystems[idx], data.system);
            }

            // ─── הסתר את השורה בטבלת הפערים ───
            const row = btn.closest('tr.sc-gaps-tr');
            if (row) {
                row.style.transition = 'opacity 0.4s, background 0.4s';
                row.style.background = 'rgba(34,197,94,0.12)';
                setTimeout(() => {
                    row.style.opacity = '0';
                    setTimeout(() => row.remove(), 400);
                }, 600);
            }

            this.showToast(`✅ קטלוג עודכן: ${field} → "${serverValue}"`, 'success');

            // ─── רענן תצוגה ───
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

        } catch (err) {
            console.error('_quickFixCatalog error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    // ══════════════════════════════════════════════════════════
    // תיקון מהיר - עדכן שרתים לפי ערך הקטלוג
    // ══════════════════════════════════════════════════════════
    async _quickFixServers(btn) {
        const gapType = btn.dataset.gapType;
        const catalogValue = btn.dataset.catalogValue;
        const serverValue = btn.dataset.serverValue;
        const catalogNumber = btn.dataset.catalogNumber;

        let affectedServers = [];
        try {
            affectedServers = JSON.parse(btn.dataset.affectedServers || '[]');
        } catch (e) { affectedServers = []; }

        if (!affectedServers.length) {
            this.showToast('אין שרתים מושפעים לעדכון', 'error');
            return;
        }

        // ─── מפה: סוג פער → שדה לעדכון בשרת ───
        const gapFieldMap = {
            'name_mismatch': 'systemName',
            'manager_mismatch': 'systemManager',
            'dept_mismatch': 'department',
            'team_mismatch': 'team',
            'domain_mismatch': 'domain',
            'catalog_missing': 'catalogNumber',
        };

        const field = gapFieldMap[gapType];
        if (!field) {
            this.showToast('סוג פער זה אינו נתמך לתיקון מהיר', 'error');
            return;
        }

        // ─── קבע את הערך לעדכון ───
        // עבור name_mismatch: הערך בקטלוג הוא "עברית / אנגלית" - קח רק העברי
        let valueToSet = catalogValue;
        if (gapType === 'name_mismatch' && catalogValue.includes(' / ')) {
            valueToSet = catalogValue.split(' / ')[0].trim();
        }
        if (gapType === 'catalog_missing') {
            valueToSet = catalogNumber;
        }

        if (!valueToSet) {
            this.showToast('אין ערך קטלוג לעדכון', 'error');
            return;
        }

        // ─── אנימציה על הכפתור ───
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        try {
            const res = await fetch('/Servers/UpdateMultipleServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    serverNames: affectedServers,
                    updates: { [field]: valueToSet }
                })
            });
            const data = await res.json();

            if (!data.success) throw new Error(data.error || 'שגיאה בעדכון שרתים');

            // ─── הסתר את השורה בטבלת הפערים ───
            const row = btn.closest('tr.sc-gaps-tr');
            if (row) {
                row.style.transition = 'opacity 0.4s, background 0.4s';
                row.style.background = 'rgba(34,197,94,0.12)';
                setTimeout(() => {
                    row.style.opacity = '0';
                    setTimeout(() => row.remove(), 400);
                }, 600);
            }

            this.showToast(
                `✅ עודכנו ${data.updatedCount} שרתים: ${field} → "${valueToSet}"`,
                'success'
            );

        } catch (err) {
            console.error('_quickFixServers error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    // ─── רענן פערים ──────────────────────────────────────────────
    async _refreshGaps() {
        const body = document.querySelector(
            '#scGapsModal .sc-gaps-modal-body');
        if (!body) return;

        body.innerHTML = `
    <div class="sc-gaps-loading">
        <i class="fas fa-spinner fa-spin" style="color:#6366f1;font-size:1.2rem"></i>
        <span>מרענן פערים...</span>
    </div>`;

        try {
            const res = await fetch('/Servers/GetSystemsGaps',
                { credentials: 'include' });
            const data = await res.json();

            if (!data.success) {
                body.innerHTML = `
            <div class="sc-gaps-error">
                <i class="fas fa-exclamation-triangle"></i>
                <span>${this.escHtml(data.error)}</span>
            </div>`;
                return;
            }

            this._renderGapsContent(body, data);
        } catch (err) {
            body.innerHTML = `
        <div class="sc-gaps-error">
            <i class="fas fa-exclamation-triangle"></i>
            <span>שגיאה: ${this.escHtml(err.message)}</span>
        </div>`;
        }
    }

    // ─── ייצוא פערים לאקסל ───────────────────────────────────────
    async _exportGapsToExcel() {
        if (!this._currentGaps || this._currentGaps.length === 0) {
            this.showToast('אין פערים לייצוא', 'error');
            return;
        }

        try {
            if (typeof ExcelJS === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'exceljs/4.3.0/exceljs.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                    document.head.appendChild(s);
                });
            }

            if (typeof saveAs === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'FileSaver.js/2.0.5/FileSaver.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                    document.head.appendChild(s);
                });
            }

            const wb = new ExcelJS.Workbook();
            wb.creator = 'SystemsCatalogDashboard';
            wb.created = new Date();

            const ws = wb.addWorksheet('פערים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            ws.columns = [
                { header: 'סוג פער', key: 'gapType', width: 24 },
                { header: 'מספר קטלוג', key: 'catalogNumber', width: 14 },
                { header: 'ערך בקטלוג', key: 'catalogValue', width: 30 },
                { header: 'ערך בשרתים', key: 'serverValue', width: 30 },
                { header: 'שרתים מושפעים', key: 'affectedServers', width: 40 },
            ];

            // ─── כותרות ───
            const hRow = ws.getRow(1);
            hRow.height = 24;
            hRow.eachCell(cell => {
                cell.font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF4a1a8c' }
                };
                cell.alignment = {
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2
                };
            });

            const gapTypeLabels = {
                'name_mismatch': 'שם מערכת שונה',
                'manager_mismatch': 'מנהל מערכת שונה',
                'dept_mismatch': 'מחלקה שונה',
                'team_mismatch': 'צוות שונה',
                'domain_mismatch': 'תחום שונה',
                'catalog_missing': 'מספר קטלוג חסר בשרת',
                'system_not_in_catalog': 'מערכת לא בקטלוג',
                'catalog_not_in_servers': 'קטלוג ללא שרתים',
            };

            this._currentGaps.forEach((g, idx) => {
                const row = ws.addRow({
                    gapType: gapTypeLabels[g.gapType] || g.gapType,
                    catalogNumber: g.catalogNumber || '',
                    catalogValue: g.catalogValue || '',
                    serverValue: g.serverValue || '',
                    affectedServers: (g.affectedServers || []).join(', '),
                });

                row.height = 16;
                const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF5F3FF';

                row.eachCell(cell => {
                    cell.font = { name: 'Arial', size: 10 };
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: rowBg }
                    };
                    cell.alignment = {
                        horizontal: 'right', vertical: 'middle',
                        readingOrder: 2, wrapText: true
                    };
                    cell.border = {
                        bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } }
                    };
                });
            });

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });
            const date = new Date().toISOString().split('T')[0];
            saveAs(blob, `systems_gaps_${date}.xlsx`);

            this.showToast(
                `📊 יוצאו ${this._currentGaps.length} פערים`,
                'success'
            );

        } catch (err) {
            console.error('_exportGapsToExcel error:', err);
            this.showToast('שגיאה בייצוא: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // ייבוא מאקסל
    // ══════════════════════════════════════════════════════════
    openImportDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (file) await this.processImportFile(file);
            document.body.removeChild(input);
        });

        input.click();
    }

    async processImportFile(file) {
        try {
            this.showToast('מעבד קובץ...', 'info');

            if (typeof XLSX === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת XLSX'));
                    document.head.appendChild(s);
                });
            }

            const parsed = await this._parseExcelFile(file);

            if (!parsed || parsed.length === 0) {
                this.showToast('לא נמצאו מערכות בקובץ', 'error');
                return;
            }

            await this._showImportPreview(parsed, file.name);

        } catch (err) {
            console.error('processImportFile error:', err);
            this.showToast('שגיאה בעיבוד הקובץ: ' + err.message, 'error');
        }
    }

    async _parseExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = e => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

                    if (!jsonData || jsonData.length === 0) {
                        resolve([]);
                        return;
                    }

                    // ─── מיפוי עמודות ───
                    const colMap = {
                        number: ['מספר', 'number', 'Number', '#'],
                        name: ['שם', 'שם מערכת', 'name', 'Name'],
                        nameEn: ['שם מערכת - אנגלית', 'שם אנגלית', 'nameEn', 'Name EN', 'English Name'],
                        description: ['תיאור', 'description', 'Description'],
                        status: ['סטטוס', 'status', 'Status'],
                        systemManager: ['מנהל מערכת', 'systemManager', 'System Manager'],
                        departmentManager: ['מנהל מחלקה', 'departmentManager', 'Department Manager'],
                        domain: ['תחום', 'domain', 'Domain'],
                        department: ['מחלקה', 'department', 'Department'],
                        team: ['צוות', 'team', 'Team'],
                        businessDivision: ['אגף עסקי - ראשי', 'אגף עסקי', 'businessDivision', 'Business Division'],
                        appClassification: ['סיווג יישום', 'appClassification', 'App Classification'],
                        appType: ['סוג יישום', 'appType', 'App Type'],
                        businessCriticality: ['קריטיות עסקית', 'businessCriticality', 'Business Criticality'],
                        availabilityRequirement: ['דרישת זמינות', 'availabilityRequirement', 'Availability'],
                        environment: ['סביבה', 'environment', 'Environment'],
                        publisher: ['מפרסם', 'publisher', 'Publisher'],
                        supportVendor: ['ספק תמיכה', 'supportVendor', 'Support Vendor'],
                        createdAt: ['נוצר', 'createdAt', 'Created', 'Created At'],
                        hasAutomation: [
                            'אוטומציה', 'בדיקות אוטומטיות', 'automation',
                            'Automation', 'HasAutomation'
                        ],
                        automationNote: [
                            'הערת אוטומציה', 'automation note', 'AutomationNote'
                        ],
                    };

                    const getVal = (row, keys) => {
                        for (const key of keys) {
                            if (row[key] !== undefined && row[key] !== null) {

                                // ─── אם זה Date object ────────────────────────────
                                if (row[key] instanceof Date) {
                                    const d = row[key];
                                    const day = d.getDate().toString().padStart(2, '0');
                                    const month = (d.getMonth() + 1).toString().padStart(2, '0');
                                    const year = d.getFullYear();
                                    const hours = d.getHours().toString().padStart(2, '0');
                                    const minutes = d.getMinutes().toString().padStart(2, '0');

                                    if (hours !== '00' || minutes !== '00') {
                                        return `${day}/${month}/${year} ${hours}:${minutes}`;
                                    }
                                    return `${day}/${month}/${year}`;
                                }

                                const v = String(row[key]).trim();
                                if (v && v !== '#N/A' && v !== 'N/A') return v;
                            }
                        }
                        return '';
                    };

                    const systems = jsonData
                        .map(row => {
                            const name = getVal(row, colMap.name);
                            if (!name) return null;

                            return {
                                id: `sys_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                number: getVal(row, colMap.number),
                                name,
                                nameEn: getVal(row, colMap.nameEn),
                                description: getVal(row, colMap.description),
                                status: getVal(row, colMap.status),
                                systemManager: getVal(row, colMap.systemManager),
                                departmentManager: getVal(row, colMap.departmentManager),
                                domain: getVal(row, colMap.domain),
                                department: getVal(row, colMap.department),
                                team: getVal(row, colMap.team),
                                businessDivision: getVal(row, colMap.businessDivision),
                                appClassification: getVal(row, colMap.appClassification),
                                appType: getVal(row, colMap.appType),
                                businessCriticality: getVal(row, colMap.businessCriticality),
                                availabilityRequirement: getVal(row, colMap.availabilityRequirement),
                                environment: getVal(row, colMap.environment),
                                publisher: getVal(row, colMap.publisher),
                                supportVendor: getVal(row, colMap.supportVendor),
                                createdAt: this._formatExcelDate(getVal(row, colMap.createdAt)),
                            };
                        })
                        .filter(Boolean);

                    resolve(systems);
                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
            reader.readAsArrayBuffer(file);
        });
    }

    // ─── המרת תאריך Excel למחרוזת קריאה ─────────────────────────
    _formatExcelDate(value) {
        if (!value || value === '') return '';

        const str = String(value).trim();

        // ─── בדוק אם זה מספר (תאריך Excel) ───────────────────────
        // Excel שומר תאריכים כמספר ימים מ-1/1/1900
        const num = parseFloat(str);

        if (!isNaN(num) && num > 1000 && num < 100000) {
            try {
                // ─── המרת מספר Excel לתאריך JavaScript ────────────
                // Excel: יום 1 = 1/1/1900
                // JavaScript Date: milliseconds מ-1/1/1970
                // הפרש: 25569 ימים בין 1/1/1900 ל-1/1/1970
                // כפול 86400000 (milliseconds ביום)

                // ─── תיקון באג Excel: Excel סופר 29/2/1900 שלא היה ─
                const excelEpoch = num > 59 ? num - 1 : num;
                const milliseconds = (excelEpoch - 25569) * 86400 * 1000;
                const date = new Date(milliseconds);

                if (isNaN(date.getTime())) return str;

                // ─── פורמט: DD/MM/YYYY ─────────────────────────────
                const day = date.getUTCDate().toString().padStart(2, '0');
                const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
                const year = date.getUTCFullYear();

                // ─── בדוק אם יש גם שעה (חלק עשרוני) ─────────────
                const timePart = num - Math.floor(num);

                if (timePart > 0.0001) {
                    const totalSeconds = Math.round(timePart * 86400);
                    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
                    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
                    return `${day}/${month}/${year} ${hours}:${minutes}`;
                }

                return `${day}/${month}/${year}`;

            } catch {
                return str;
            }
        }

        // ─── אם כבר מחרוזת תאריך - נסה לפרסר ────────────────────
        // תמיכה בפורמטים: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
        try {
            // YYYY-MM-DD או YYYY-MM-DD HH:MM
            if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
                const date = new Date(str);
                if (!isNaN(date.getTime())) {
                    const day = date.getDate().toString().padStart(2, '0');
                    const month = (date.getMonth() + 1).toString().padStart(2, '0');
                    const year = date.getFullYear();

                    const hours = date.getHours().toString().padStart(2, '0');
                    const minutes = date.getMinutes().toString().padStart(2, '0');

                    // ─── הצג שעה רק אם לא חצות ───────────────────
                    if (hours !== '00' || minutes !== '00') {
                        return `${day}/${month}/${year} ${hours}:${minutes}`;
                    }
                    return `${day}/${month}/${year}`;
                }
            }

            // DD/MM/YYYY - כבר בפורמט הנכון
            if (/^\d{2}\/\d{2}\/\d{4}/.test(str)) {
                return str;
            }

            // MM/DD/YYYY - המר ל-DD/MM/YYYY
            if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
                const parts = str.split('/');
                if (parts.length === 3) {
                    const day = parts[1].padStart(2, '0');
                    const month = parts[0].padStart(2, '0');
                    const year = parts[2];
                    return `${day}/${month}/${year}`;
                }
            }

        } catch {
            // fallback
        }

        // ─── החזר כפי שהוא אם לא הצלחנו לפרסר ───────────────────
        return str;
    }

    async _showImportPreview(parsed, fileName) {
        return new Promise(resolve => {
            const existing = document.getElementById('scImportModal');
            if (existing) existing.remove();

            // ─── זהה חדשים מול קיימים ───
            const existingNames = new Set(
                this.allSystems.map(s => (s.name || '').toLowerCase())
            );

            const added = parsed.filter(s => !existingNames.has((s.name || '').toLowerCase()));
            const updated = parsed.filter(s => existingNames.has((s.name || '').toLowerCase()));

            const rowsHtml = parsed.map((s, i) => {
                const isNew = !existingNames.has((s.name || '').toLowerCase());
                return `
                <tr class="sc-import-row ${isNew ? 'sc-import-row-added' : 'sc-import-row-changed'}">
                    <td class="sc-import-td sc-import-td-icon">
                        ${isNew
                        ? '<i class="fas fa-plus-circle" style="color:#22c55e"></i>'
                        : '<i class="fas fa-edit"        style="color:#f59e0b"></i>'}
                    </td>
                    <td class="sc-import-td" style="font-weight:600">
                        ${this.escHtml(s.name || '')}
                    </td>
                    <td class="sc-import-td" dir="ltr">
                        ${this.escHtml(s.nameEn || '')}
                    </td>
                    <td class="sc-import-td">
                        ${s.status
                        ? `<span class="sc-badge ${this._getStatusClass(s.status)}">${this.escHtml(s.status)}</span>`
                        : ''}
                    </td>
                    <td class="sc-import-td">
                        ${this.escHtml(s.department || '')}
                    </td>
                    <td class="sc-import-td">
                        ${isNew
                        ? '<span class="sc-import-badge-new">חדש</span>'
                        : '<span class="sc-import-badge-changed">עדכון</span>'}
                    </td>
                </tr>`;
            }).join('');

            const modal = document.createElement('div');
            modal.id = 'scImportModal';
            modal.className = 'sc-import-modal-overlay';
            modal.innerHTML = `
            <div class="sc-import-modal">

                <!-- כותרת -->
                <div class="sc-import-modal-header">
                    <div class="sc-import-modal-title-wrap">
                        <i class="fas fa-file-excel"></i>
                        <div>
                            <div class="sc-import-modal-title">
                                ייבוא קטלוג מערכות
                            </div>
                            <div class="sc-import-modal-subtitle">
                                ${this.escHtml(fileName)}
                            </div>
                        </div>
                    </div>
                    <button class="sc-import-modal-close"
                            id="scImportClose">&times;</button>
                </div>

                <!-- סטטיסטיקות -->
                <div class="sc-import-stats-bar">
                    <div class="sc-import-stat sc-import-stat-total">
                        <i class="fas fa-layer-group"></i>
                        <span>סה"כ בקובץ: <strong>${parsed.length}</strong></span>
                    </div>
                    <div class="sc-import-stat sc-import-stat-added">
                        <i class="fas fa-plus-circle"></i>
                        <span>חדשים: <strong>${added.length}</strong></span>
                    </div>
                    <div class="sc-import-stat sc-import-stat-changed">
                        <i class="fas fa-edit"></i>
                        <span>עדכונים: <strong>${updated.length}</strong></span>
                    </div>
                </div>

                <!-- אפשרות דריסה -->
                ${updated.length > 0 ? `
                <div class="sc-import-overwrite-section">
                    <label class="sc-import-overwrite-label">
                        <input type="checkbox"
                               id="scImportOverwrite"
                               class="sc-import-checkbox"
                               checked>
                        <span class="sc-import-overwrite-text">
                            <i class="fas fa-exclamation-triangle"
                               style="color:#f59e0b"></i>
                            דרוס מערכות קיימות עם נתונים מהקובץ
                            <span class="sc-import-overwrite-hint">
                                (${updated.length} מערכות ישתנו)
                            </span>
                        </span>
                    </label>
                </div>` : ''}

                <!-- טאבים -->
                <div class="sc-import-tabs">
                    <button class="sc-import-tab active"
                            id="scImportTabAll"
                            onclick="window._scSwitchTab('all')">
                        הכל (${parsed.length})
                    </button>
                    <button class="sc-import-tab sc-import-tab-added"
                            id="scImportTabAdded"
                            onclick="window._scSwitchTab('added')">
                        <i class="fas fa-plus-circle"></i>
                        חדשים (${added.length})
                    </button>
                    <button class="sc-import-tab sc-import-tab-changed"
                            id="scImportTabChanged"
                            onclick="window._scSwitchTab('changed')">
                        <i class="fas fa-edit"></i>
                        עדכונים (${updated.length})
                    </button>
                </div>

                <!-- טבלה -->
                <div class="sc-import-table-wrap">
                    <table class="sc-import-table">
                        <thead>
                            <tr>
                                <th class="sc-import-th" style="width:36px"></th>
                                <th class="sc-import-th">שם מערכת</th>
                                <th class="sc-import-th">שם אנגלית</th>
                                <th class="sc-import-th">סטטוס</th>
                                <th class="sc-import-th">מחלקה</th>
                                <th class="sc-import-th">סטטוס ייבוא</th>
                            </tr>
                        </thead>
                        <tbody id="scImportTbody">
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Footer -->
                <div class="sc-import-footer">
                    <div class="sc-import-footer-info">
                        <i class="fas fa-info-circle" style="color:#6366f1"></i>
                        יתווספו <strong style="color:#22c55e">${added.length}</strong> מערכות חדשות
                        ${updated.length > 0
                    ? `ו-<strong style="color:#f59e0b">${updated.length}</strong> יעודכנו`
                    : ''}
                    </div>
                    <div class="sc-import-footer-btns">
                        <button class="sc-import-cancel-btn"
                                id="scImportCancel">
                            <i class="fas fa-times"></i> ביטול
                        </button>
                        <button class="sc-import-confirm-btn"
                                id="scImportConfirm"
                                ${parsed.length === 0 ? 'disabled' : ''}>
                            <i class="fas fa-file-import"></i>
                            ייבא ${parsed.length} מערכות
                        </button>
                    </div>
                </div>

            </div>`;

            document.body.appendChild(modal);

            // ─── פונקציית החלפת טאב ───
            window._scSwitchTab = tab => {
                ['All', 'Added', 'Changed'].forEach(t => {
                    const btn = document.getElementById(`scImportTab${t}`);
                    if (btn) btn.classList.remove('active');
                });
                const activeMap = { all: 'All', added: 'Added', changed: 'Changed' };
                const activeBtn = document.getElementById(
                    `scImportTab${activeMap[tab]}`);
                if (activeBtn) activeBtn.classList.add('active');

                const tbody = document.getElementById('scImportTbody');
                if (!tbody) return;

                tbody.querySelectorAll('tr.sc-import-row').forEach(row => {
                    if (tab === 'all') {
                        row.style.display = '';
                    } else if (tab === 'added') {
                        row.style.display = row.classList.contains(
                            'sc-import-row-added') ? '' : 'none';
                    } else if (tab === 'changed') {
                        row.style.display = row.classList.contains(
                            'sc-import-row-changed') ? '' : 'none';
                    }
                });
            };

            // ─── אירועים ───
            const closeModal = () => {
                modal.remove();
                resolve(null);
            };

            document.getElementById('scImportClose')
                .addEventListener('click', closeModal);
            document.getElementById('scImportCancel')
                .addEventListener('click', closeModal);

            document.getElementById('scImportConfirm')
                .addEventListener('click', async () => {
                    const overwrite = document.getElementById(
                        'scImportOverwrite')?.checked ?? true;

                    modal.remove();

                    await this._executeImport(parsed, overwrite);
                    resolve(true);
                });
        });
    }

    async _executeImport(systems, overwrite) {
        try {
            const res = await fetch('/SystemsCatalog/ImportSystems', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ systems, overwrite })
            });
            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בייבוא');

            // ─── רענן נתונים ───
            await this.loadData();

            this.showToast(
                `✅ יובאו ${data.addedCount} חדשות` +
                (data.updatedCount > 0
                    ? ` + ${data.updatedCount} עודכנו` : ''),
                'success'
            );
        } catch (err) {
            console.error('_executeImport error:', err);
            this.showToast('שגיאה בייבוא: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // ייבוא אוטומציה מאקסל
    // ══════════════════════════════════════════════════════════
    openImportAutomationDialog() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לייבוא', 'error');
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async e => {
            const file = e.target.files[0];
            if (file) await this.processImportAutomationFile(file);
            document.body.removeChild(input);
        });

        input.click();
    }

    async processImportAutomationFile(file) {
        try {
            this.showToast('מעבד קובץ אוטומציה...', 'info');

            if (typeof XLSX === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.sheetjs.com/xlsx-latest/' +
                        'package/dist/xlsx.full.min.js';
                    s.onload = res;
                    s.onerror = () =>
                        rej(new Error('נכשלה טעינת XLSX'));
                    document.head.appendChild(s);
                });
            }

            // ─── ודא שהנתונים טעונים ───
            if (this.allSystems.length === 0) {
                this.showToast('טוען נתוני קטלוג...', 'info');
                await this.loadData();
            }

            const parsed = await this._parseAutomationExcelFile(file);

            if (!parsed || parsed.length === 0) {
                this.showToast('לא נמצאו נתונים בקובץ', 'error');
                return;
            }

            // ─── חשב _systemName עכשיו שהנתונים טעונים ───
            parsed.forEach(item => {
                item._systemName = this._findSystemName(
                    item.catalogNumber
                );
            });

            await this._showImportAutomationPreview(parsed, file.name);

        } catch (err) {
            console.error('processImportAutomationFile error:', err);
            this.showToast(
                'שגיאה בעיבוד הקובץ: ' + err.message, 'error'
            );
        }
    }

    async _parseAutomationExcelFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = e => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(
                        sheet, { defval: '' }
                    );

                    if (!jsonData || jsonData.length === 0) {
                        resolve([]);
                        return;
                    }

                    const firstRow = jsonData[0];
                    const allColumns = Object.keys(firstRow);

                    // ─── זהה עמודת מספר קטלוג ───
                    const numberColKeywords = [
                        'מספר', 'number', 'catalog', '#', 'קטלוג'
                    ];
                    const numberCol = allColumns.find(col =>
                        numberColKeywords.some(kw =>
                            col.toLowerCase()
                                .includes(kw.toLowerCase())
                        )
                    );

                    // ─── זהה עמודת אוטומציה ───
                    const autoColKeywords = [
                        'בדיקות אוטומטיות',
                        'אוטומציה',
                        'automation',
                        'hasautomation',
                        'automated',
                        'בדיקות'
                    ];
                    const autoCol = allColumns.find(col =>
                        autoColKeywords.some(kw =>
                            col.toLowerCase()
                                .includes(kw.toLowerCase())
                        )
                    );

                    // ─── זהה עמודת הערה ───
                    const noteColKeywords = [
                        'הערה', 'note', 'פרטים', 'comment'
                    ];
                    const noteCol = allColumns.find(col =>
                        noteColKeywords.some(kw =>
                            col.toLowerCase()
                                .includes(kw.toLowerCase())
                        )
                    );

                    if (!numberCol) {
                        reject(new Error(
                            `לא נמצאה עמודת מספר קטלוג.\n` +
                            `עמודות בקובץ: ${allColumns.join(', ')}`
                        ));
                        return;
                    }

                    if (!autoCol) {
                        reject(new Error(
                            `לא נמצאה עמודת אוטומציה.\n` +
                            `עמודות בקובץ: ${allColumns.join(', ')}`
                        ));
                        return;
                    }

                    // ─── נרמול ערך אוטומציה ───
                    const normalizeAutomation = raw => {
                        if (!raw) return 'לא קיימות';
                        const r = raw.toString().trim().toLowerCase();

                        if (r === 'קיימות' ||
                            r === 'yes' ||
                            r === 'true' ||
                            r === '1' ||
                            r === 'כן' ||
                            r === 'exists')
                            return 'קיימות';

                        if (r === 'לא רלוונטי' ||
                            r === 'לא רלוונטית' ||
                            r === 'n/a' ||
                            r === 'na' ||
                            r === 'not relevant' ||
                            r === 'irrelevant')
                            return 'לא רלוונטי';

                        return 'לא קיימות';
                    };

                    const items = jsonData
                        .map(row => {
                            const rawNumber = row[numberCol];
                            if (rawNumber === undefined ||
                                rawNumber === null ||
                                rawNumber === '')
                                return null;

                            const catalogNumber = String(rawNumber)
                                .trim()
                                .replace(/\s+/g, '');

                            return {
                                catalogNumber,
                                hasAutomation: normalizeAutomation(
                                    row[autoCol]
                                ),
                                automationNote: String(
                                    noteCol ? row[noteCol] : ''
                                ).trim(),
                                _rawAutomation: String(
                                    row[autoCol] || ''
                                ),
                                // ─── _systemName יחושב אחרי הטעינה ───
                                _systemName: '',
                            };
                        })
                        .filter(Boolean);

                    resolve(items);

                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = () =>
                reject(new Error('שגיאה בקריאת הקובץ'));
            reader.readAsArrayBuffer(file);
        });
    }

    // ─── מצא שם מערכת לפי מספר קטלוג ────────────────────────────
    _findSystemName(catalogNumber) {
        const system = this.allSystems.find(s =>
            String(s.number || '').trim().toLowerCase() ===
            String(catalogNumber || '').trim().toLowerCase()
        );
        return system?.name || '';
    }

    async _showImportAutomationPreview(parsed, fileName) {
        return new Promise(resolve => {
            const existing = document.getElementById('scImportAutoModal');
            if (existing) existing.remove();

            // ─── סטטיסטיקות ───
            const found = parsed.filter(p => p._systemName);
            const notFound = parsed.filter(p => !p._systemName);

            const byStatus = {
                'קיימות': parsed.filter(p => p.hasAutomation === 'קיימות').length,
                'לא קיימות': parsed.filter(p => p.hasAutomation === 'לא קיימות').length,
                'לא רלוונטי': parsed.filter(p => p.hasAutomation === 'לא רלוונטי').length,
            };

            const rowsHtml = parsed.map(item => {
                const statusClass = item.hasAutomation === 'קיימות'
                    ? 'sc-auto-badge-yes'
                    : item.hasAutomation === 'לא רלוונטי'
                        ? 'sc-auto-badge-na'
                        : 'sc-auto-badge-no';

                const foundClass = item._systemName
                    ? 'sc-auto-row-found'
                    : 'sc-auto-row-notfound';

                return `
            <tr class="sc-auto-import-row ${foundClass}">
                <td class="sc-auto-import-td sc-auto-import-td-center">
                    ${item._systemName
                        ? '<i class="fas fa-check-circle" style="color:#22c55e"></i>'
                        : '<i class="fas fa-question-circle" style="color:#f59e0b"></i>'}
                </td>
                <td class="sc-auto-import-td sc-auto-import-td-num">
                    <span class="sc-auto-catalog-num">
                        ${this.escHtml(item.catalogNumber)}
                    </span>
                </td>
                <td class="sc-auto-import-td">
                    ${item._systemName
                        ? `<span class="sc-auto-system-name">
                               ${this.escHtml(item._systemName)}
                           </span>`
                        : `<span class="sc-auto-not-found">
                               לא נמצא בקטלוג
                           </span>`}
                </td>
                <td class="sc-auto-import-td sc-auto-import-td-center">
                    <span class="sc-auto-status-badge ${statusClass}">
                        ${this.escHtml(item.hasAutomation)}
                    </span>
                </td>
                <td class="sc-auto-import-td sc-auto-import-td-note">
                    ${this.escHtml(item.automationNote || '')}
                </td>
            </tr>`;
            }).join('');

            const modal = document.createElement('div');
            modal.id = 'scImportAutoModal';
            modal.className = 'sc-import-modal-overlay';

            modal.innerHTML = `
        <div class="sc-import-modal sc-auto-import-modal">

            <!-- ── כותרת ── -->
            <div class="sc-import-modal-header sc-auto-import-header">
                <div class="sc-import-modal-title-wrap">
                    <i class="fas fa-robot" style="font-size:1.4rem"></i>
                    <div>
                        <div class="sc-import-modal-title">
                            ייבוא סטטוס אוטומציה מאקסל
                        </div>
                        <div class="sc-import-modal-subtitle">
                            ${this.escHtml(fileName)}
                        </div>
                    </div>
                </div>
                <button class="sc-import-modal-close"
                        id="scImportAutoClose">&times;</button>
            </div>

            <!-- ── סטטיסטיקות ── -->
            <div class="sc-auto-import-stats">
                <div class="sc-auto-stat sc-auto-stat-total">
                    <i class="fas fa-layer-group"></i>
                    <span>סה"כ שורות: <strong>${parsed.length}</strong></span>
                </div>
                <div class="sc-auto-stat sc-auto-stat-found">
                    <i class="fas fa-check-circle"></i>
                    <span>נמצאו בקטלוג: <strong>${found.length}</strong></span>
                </div>
                ${notFound.length > 0 ? `
                <div class="sc-auto-stat sc-auto-stat-notfound">
                    <i class="fas fa-question-circle"></i>
                    <span>לא נמצאו: <strong>${notFound.length}</strong></span>
                </div>` : ''}
                                <div class="sc-auto-stat sc-auto-stat-yes">
                    <i class="fas fa-robot"></i>
                    <span>קיימות: <strong>${byStatus['קיימות']}</strong></span>
                </div>
                <div class="sc-auto-stat sc-auto-stat-no">
                    <i class="fas fa-times-circle"></i>
                    <span>לא קיימות: <strong>${byStatus['לא קיימות']}</strong></span>
                </div>
                <div class="sc-auto-stat sc-auto-stat-na">
                    <i class="fas fa-minus-circle"></i>
                    <span>לא רלוונטי: <strong>${byStatus['לא רלוונטי']}</strong></span>
                </div>
            </div>

            <!-- ── טאבים ── -->
            <div class="sc-import-tabs">
                <button class="sc-import-tab active"
                        id="scAutoTabAll"
                        onclick="window._scAutoSwitchTab('all')">
                    הכל (${parsed.length})
                </button>
                <button class="sc-import-tab sc-auto-tab-found"
                        id="scAutoTabFound"
                        onclick="window._scAutoSwitchTab('found')">
                    <i class="fas fa-check-circle"></i>
                    נמצאו (${found.length})
                </button>
                ${notFound.length > 0 ? `
                <button class="sc-import-tab sc-auto-tab-notfound"
                        id="scAutoTabNotFound"
                        onclick="window._scAutoSwitchTab('notfound')">
                    <i class="fas fa-question-circle"></i>
                    לא נמצאו (${notFound.length})
                </button>` : ''}
            </div>

            <!-- ── טבלה ── -->
            <div class="sc-import-table-wrap">
                <table class="sc-import-table">
                    <thead>
                        <tr>
                            <th class="sc-import-th"
                                style="width:40px;text-align:center">
                                סטטוס
                            </th>
                            <th class="sc-import-th"
                                style="width:100px">
                                מס׳ קטלוג
                            </th>
                            <th class="sc-import-th">שם מערכת</th>
                            <th class="sc-import-th"
                                style="width:120px;text-align:center">
                                אוטומציה
                            </th>
                            <th class="sc-import-th">הערה</th>
                        </tr>
                    </thead>
                    <tbody id="scAutoImportTbody">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <!-- ── הורד תבנית ── -->
            <div class="sc-auto-import-template-bar">
                <i class="fas fa-info-circle"
                style="color:#6366f1;flex-shrink:0"></i>
                <span>
                    הקובץ צריך לכלול עמודות:
                    <strong>מספר</strong>,
                    <strong>בדיקות אוטומטיות</strong>
                    (קיימות / לא קיימות / לא רלוונטי),
                    <strong>הערת אוטומציה</strong> (אופציונלי)
                </span>
                <button class="sc-auto-template-btn"
                        id="scAutoDownloadTemplate"
                        title="הורד קובץ תבנית לדוגמה">
                    <i class="fas fa-download"></i>
                    הורד תבנית
                </button>
            </div>

            <!-- ── Footer ── -->
            <div class="sc-import-footer">
                <div class="sc-import-footer-info">
                    <i class="fas fa-info-circle"
                       style="color:#6366f1"></i>
                    יעודכנו
                    <strong style="color:#22c55e">${found.length}</strong>
                    מערכות
                    ${notFound.length > 0 ? `
                    | <strong style="color:#f59e0b">
                        ${notFound.length}
                      </strong> לא יעודכנו (לא נמצאו)` : ''}
                </div>
                <div class="sc-import-footer-btns">
                    <button class="sc-import-cancel-btn"
                            id="scImportAutoCancel">
                        <i class="fas fa-times"></i> ביטול
                    </button>
                    <button class="sc-auto-import-confirm-btn"
                            id="scImportAutoConfirm"
                            ${found.length === 0 ? 'disabled' : ''}>
                        <i class="fas fa-robot"></i>
                        עדכן ${found.length} מערכות
                    </button>
                </div>
            </div>

        </div>`;

            document.body.appendChild(modal);

            // ─── פונקציית החלפת טאב ───
            window._scAutoSwitchTab = tab => {
                ['All', 'Found', 'NotFound'].forEach(t => {
                    const btn = document.getElementById(`scAutoTab${t}`);
                    if (btn) btn.classList.remove('active');
                });

                const activeMap = {
                    all: 'All', found: 'Found', notfound: 'NotFound'
                };
                const activeBtn = document.getElementById(
                    `scAutoTab${activeMap[tab]}`
                );
                if (activeBtn) activeBtn.classList.add('active');

                const tbody = document.getElementById('scAutoImportTbody');
                if (!tbody) return;

                tbody.querySelectorAll('tr.sc-auto-import-row').forEach(row => {
                    if (tab === 'all') {
                        row.style.display = '';
                    } else if (tab === 'found') {
                        row.style.display = row.classList.contains(
                            'sc-auto-row-found') ? '' : 'none';
                    } else if (tab === 'notfound') {
                        row.style.display = row.classList.contains(
                            'sc-auto-row-notfound') ? '' : 'none';
                    }
                });
            };

            // ─── אירועים ───
            const closeModal = () => {
                modal.remove();
                resolve(null);
            };

            document.getElementById('scImportAutoClose')
                .addEventListener('click', closeModal);
            document.getElementById('scImportAutoCancel')
                .addEventListener('click', closeModal);

            // ─── הורד תבנית ───
            document.getElementById('scAutoDownloadTemplate')
                .addEventListener('click', () =>
                    this._downloadAutomationTemplate()
                );

            // ─── אישור ייבוא ───
            document.getElementById('scImportAutoConfirm')
                .addEventListener('click', async () => {
                    // ─── שלח רק פריטים שנמצאו ───
                    const itemsToSend = parsed
                        .filter(p => p._systemName)
                        .map(p => ({
                            catalogNumber: p.catalogNumber,
                            automationStatus: p.hasAutomation,
                            automationNote: p.automationNote,
                        }));

                    modal.remove();
                    await this._executeImportAutomation(itemsToSend);
                    resolve(true);
                });
        });
    }

    async _executeImportAutomation(items) {
        try {
            this.showToast('מעדכן נתוני אוטומציה...', 'info');

            const res = await fetch(
                '/SystemsCatalog/ImportAutomationFromExcel',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ items })
                }
            );
            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בעדכון');

            // ─── רענן נתונים ───
            await this.loadData();

            let msg = `✅ עודכנו ${data.updatedCount} מערכות`;
            if (data.notFoundCount > 0) {
                msg += ` | ⚠️ ${data.notFoundCount} לא נמצאו`;
            }
            this.showToast(msg, 'success');

            // ─── הצג פירוט אם יש לא נמצאו ───
            if (data.notFoundList && data.notFoundList.length > 0) {
                console.warn(
                    'מספרי קטלוג שלא נמצאו:',
                    data.notFoundList.join(', ')
                );
            }

        } catch (err) {
            console.error('_executeImportAutomation error:', err);
            this.showToast('שגיאה בעדכון: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // הורד קובץ תבנית אקסל לאוטומציה
    // ══════════════════════════════════════════════════════════
    async _downloadAutomationTemplate() {
        try {
            if (typeof ExcelJS === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'exceljs/4.3.0/exceljs.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                    document.head.appendChild(s);
                });
            }

            if (typeof saveAs === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'FileSaver.js/2.0.5/FileSaver.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                    document.head.appendChild(s);
                });
            }

            const wb = new ExcelJS.Workbook();
            wb.creator = 'SystemsCatalogDashboard';
            wb.created = new Date();

            const ws = wb.addWorksheet('אוטומציה', {
                views: [{ rightToLeft: true }]
            });

            // ─── הגדרת עמודות ───
            ws.columns = [
                { header: 'מספר', key: 'catalogNumber', width: 16 },
                { header: 'בדיקות אוטומטיות', key: 'hasAutomation', width: 20 },
                { header: 'הערת אוטומציה', key: 'automationNote', width: 40 },
            ];

            // ─── עיצוב כותרות ───
            const hRow = ws.getRow(1);
            hRow.height = 26;
            hRow.eachCell(cell => {
                cell.font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF1e1b4b' }
                };
                cell.alignment = {
                    horizontal: 'center',
                    vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: { style: 'medium', color: { argb: 'FF6366f1' } }
                };
            });

            // ─── שורות דוגמה ───
            const examples = [
                {
                    catalogNumber: 'APM0000001',
                    hasAutomation: 'קיימות',
                    automationNote: 'בדיקות Selenium + API'
                },
                {
                    catalogNumber: 'APM0000002',
                    hasAutomation: 'לא קיימות',
                    automationNote: ''
                },
                {
                    catalogNumber: 'APM0000003',
                    hasAutomation: 'לא רלוונטי',
                    automationNote: 'מערכת legacy'
                },
                {
                    catalogNumber: 'APM0000004',
                    hasAutomation: 'קיימות',
                    automationNote: 'Jenkins pipeline'
                },
                {
                    catalogNumber: 'APM0000005',
                    hasAutomation: 'לא קיימות',
                    automationNote: ''
                },
            ];

            // ─── צבעים לפי ערך ───
            const statusColors = {
                'קיימות': { bg: 'FFdcfce7', font: 'FF166534' },
                'לא קיימות': { bg: 'FFfee2e2', font: 'FF991b1b' },
                'לא רלוונטי': { bg: 'FFfef9c3', font: 'FF854d0e' },
            };

            examples.forEach((ex, idx) => {
                const row = ws.addRow(ex);
                row.height = 18;

                const colors = statusColors[ex.hasAutomation] || {
                    bg: 'FFFFFFFF', font: 'FF333333'
                };

                row.eachCell((cell, colNum) => {
                    cell.font = {
                        name: 'Arial', size: 10,
                        color: { argb: 'FF333333' }
                    };
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: {
                            argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8F8FF'
                        }
                    };
                    cell.alignment = {
                        horizontal: colNum === 1 ? 'center' : 'right',
                        vertical: 'middle',
                        readingOrder: 2
                    };
                    cell.border = {
                        bottom: {
                            style: 'thin',
                            color: { argb: 'FFe2e8f0' }
                        }
                    };

                    // ─── צבע מיוחד לעמודת אוטומציה ───
                    if (colNum === 2) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: colors.font }
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: colors.bg }
                        };
                        cell.alignment = {
                            horizontal: 'center',
                            vertical: 'middle',
                            readingOrder: 2
                        };
                    }
                });
            });

            // ─── הוסף Validation לעמודת אוטומציה ───
            ws.getColumn(2).eachCell({ includeEmpty: false }, (cell, rowNum) => {
                if (rowNum === 1) return;
                cell.dataValidation = {
                    type: 'list',
                    allowBlank: false,
                    formulae: ['"קיימות,לא קיימות,לא רלוונטי"'],
                    showErrorMessage: true,
                    errorStyle: 'stop',
                    errorTitle: 'ערך לא חוקי',
                    error: 'יש לבחור: קיימות / לא קיימות / לא רלוונטי',
                    showInputMessage: true,
                    promptTitle: 'בדיקות אוטומטיות',
                    prompt: 'בחר אחד מהערכים: קיימות / לא קיימות / לא רלוונטי',
                };
            });

            // ─── גיליון הוראות ───
            const wsInfo = wb.addWorksheet('הוראות שימוש');
            wsInfo.views = [{ rightToLeft: true }];

            const instructions = [
                ['שדה', 'תיאור', 'חובה'],
                ['מספר', 'המספר הקטלוגי של המערכת (לדוגמה: APM0000003)', 'כן'],
                ['בדיקות אוטומטיות', 'קיימות / לא קיימות / לא רלוונטי', 'כן'],
                ['הערת אוטומציה', 'פרטים נוספים על הבדיקות האוטומטיות', 'לא'],
            ];

            wsInfo.columns = [
                { key: 'field', width: 20 },
                { key: 'desc', width: 50 },
                { key: 'required', width: 10 },
            ];

            instructions.forEach((row, idx) => {
                const wsRow = wsInfo.addRow(row);
                wsRow.height = 20;

                wsRow.eachCell(cell => {
                    cell.font = {
                        name: 'Arial',
                        size: idx === 0 ? 11 : 10,
                        bold: idx === 0,
                        color: {
                            argb: idx === 0 ? 'FFFFFFFF' : 'FF333333'
                        }
                    };
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: {
                            argb: idx === 0
                                ? 'FF1e1b4b'
                                : idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8F8FF'
                        }
                    };
                    cell.alignment = {
                        horizontal: 'right',
                        vertical: 'middle',
                        readingOrder: 2,
                        wrapText: true
                    };
                    cell.border = {
                        bottom: {
                            style: 'thin',
                            color: { argb: 'FFe2e8f0' }
                        }
                    };
                });
            });

            // ─── שמור ───
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, 'automation_import_template.xlsx');

            this.showToast('📥 תבנית הורדה בהצלחה', 'success');

        } catch (err) {
            console.error('_downloadAutomationTemplate error:', err);
            this.showToast('שגיאה בהורדת התבנית: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // ייצוא לאקסל
    // ══════════════════════════════════════════════════════════
    async exportToExcel() {
        try {
            const exportBtn = document.getElementById('scExportBtn');
            if (exportBtn) {
                exportBtn.disabled = true;
                exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }

            // ─── שאל את המשתמש אילו עמודות לייצא ───
            const exportChoice = await this._showExportOptionsModal();
            if (!exportChoice) {
                // ביטול
                if (exportBtn) {
                    exportBtn.disabled = false;
                    exportBtn.innerHTML = '<i class="fas fa-file-excel"></i>';
                }
                return;
            }

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

            const wb = new ExcelJS.Workbook();
            wb.creator = 'SystemsCatalogDashboard';
            wb.created = new Date();

            const ws = wb.addWorksheet('קטלוג מערכות', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            // ─── הגדרת כל העמודות האפשריות ───
            const allColumnDefs = [
                { header: 'מספר קטלוג', key: 'number', width: 11, colKey: 'number' },
                { header: 'שם מערכת', key: 'name', width: 28, colKey: 'name' },
                { header: 'שם אנגלית', key: 'nameEn', width: 28, colKey: 'nameEn' },
                { header: 'תיאור', key: 'description', width: 40, colKey: 'description' },
                { header: 'סטטוס', key: 'status', width: 14, colKey: 'status' },
                { header: 'מנהל מערכת', key: 'systemManager', width: 22, colKey: 'systemManager' },
                { header: 'מנהל מחלקה', key: 'departmentManager', width: 22, colKey: 'departmentManager' },
                { header: 'תחום', key: 'domain', width: 18, colKey: 'domain' },
                { header: 'מחלקה', key: 'department', width: 22, colKey: 'department' },
                { header: 'צוות', key: 'team', width: 20, colKey: 'team' },
                { header: 'אגף עסקי - ראשי', key: 'businessDivision', width: 22, colKey: 'businessDivision' },
                { header: 'סיווג יישום', key: 'appClassification', width: 18, colKey: 'appClassification' },
                { header: 'סוג יישום', key: 'appType', width: 16, colKey: 'appType' },
                { header: 'קריטיות עסקית', key: 'businessCriticality', width: 16, colKey: 'businessCriticality' },
                { header: 'דרישת זמינות', key: 'availabilityRequirement', width: 16, colKey: 'availabilityRequirement' },
                { header: 'סביבה', key: 'environment', width: 14, colKey: 'environment' },
                { header: 'מפרסם', key: 'publisher', width: 20, colKey: 'publisher' },
                { header: 'ספק תמיכה', key: 'supportVendor', width: 20, colKey: 'supportVendor' },
                { header: 'בדיקות אוטומטיות', key: 'hasAutomation', width: 18, colKey: 'hasAutomation' },
                { header: 'הערת אוטומציה', key: 'automationNote', width: 30, colKey: 'hasAutomation' }, // תמיד עם hasAutomation
                { header: 'נדרש תיקוף', key: 'requiresValidation', width: 14, colKey: 'requiresValidation' },
                { header: 'תיקוף אחרון', key: 'lastValidatedAt', width: 16, colKey: 'lastValidatedAt' },
                { header: 'נוצר', key: 'createdAt', width: 14, colKey: 'createdAt' },
            ];

            // ─── סנן עמודות לפי בחירת המשתמש ───
            let columnsToExport;
            if (exportChoice === 'visible') {
                // רק עמודות גלויות במסך (לפי visibleColumns)
                columnsToExport = allColumnDefs.filter(col => {
                    if (col.key === 'automationNote') return this.visibleColumns['hasAutomation'];
                    if (col.key === 'requiresValidation') return this.visibleColumns['requiresValidation'] !== false;
                    if (col.key === 'lastValidatedAt') return this.visibleColumns['lastValidatedAt'] !== false;
                    return this.visibleColumns[col.colKey] !== false;
                });
            } else {
                // כל העמודות
                columnsToExport = allColumnDefs;
            }

            ws.columns = columnsToExport.map(c => ({
                header: c.header,
                key: c.key,
                width: c.width
            }));

            // ─── עיצוב כותרות ───
            const hRow = ws.getRow(1);
            hRow.height = 24;
            hRow.eachCell(cell => {
                cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF320F5B' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 2 };
                cell.border = { bottom: { style: 'medium', color: { argb: 'FF7c3aed' } } };
            });

            // ─── נתונים ───
            this.filteredSystems.forEach((s, idx) => {
                // ─── תאריך ללא שעה ───
                const stripTime = (dateStr) => {
                    if (!dateStr) return '';
                    return dateStr.split(' ')[0]; // קח רק DD/MM/YYYY
                };

                // ─── בנה שורה דינמית לפי עמודות שנבחרו ───
                const rowData = {};
                columnsToExport.forEach(col => {
                    switch (col.key) {
                        case 'number': rowData.number = s.number || ''; break;
                        case 'name': rowData.name = s.name || ''; break;
                        case 'nameEn': rowData.nameEn = s.nameEn || ''; break;
                        case 'description': rowData.description = s.description || ''; break;
                        case 'status': rowData.status = s.status || ''; break;
                        case 'systemManager': rowData.systemManager = s.systemManager || ''; break;
                        case 'departmentManager': rowData.departmentManager = s.departmentManager || ''; break;
                        case 'domain': rowData.domain = s.domain || ''; break;
                        case 'department': rowData.department = s.department || ''; break;
                        case 'team': rowData.team = s.team || ''; break;
                        case 'businessDivision': rowData.businessDivision = s.businessDivision || ''; break;
                        case 'appClassification': rowData.appClassification = s.appClassification || ''; break;
                        case 'appType': rowData.appType = s.appType || ''; break;
                        case 'businessCriticality': rowData.businessCriticality = s.businessCriticality || ''; break;
                        case 'availabilityRequirement': rowData.availabilityRequirement = s.availabilityRequirement || ''; break;
                        case 'environment': rowData.environment = s.environment || ''; break;
                        case 'publisher': rowData.publisher = s.publisher || ''; break;
                        case 'supportVendor': rowData.supportVendor = s.supportVendor || ''; break;
                        case 'hasAutomation': rowData.hasAutomation = s.hasAutomation || 'לא קיימות'; break;
                        case 'automationNote': rowData.automationNote = s.automationNote || ''; break;
                        case 'createdAt': rowData.createdAt = stripTime(s.createdAt); break;
                        case 'requiresValidation': rowData.requiresValidation = s.requiresValidation ? 'נדרש תיקוף' : ''; break;
                        case 'lastValidatedAt': rowData.lastValidatedAt = stripTime(s.lastValidatedAt); break;
                    }
                });

                const row = ws.addRow(rowData);
                row.height = 16;
                const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF5F3FF';

                row.eachCell((cell, colNum) => {
                    cell.font = { name: 'Arial', size: 10 };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
                    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 2 };
                    cell.border = { bottom: { style: 'thin', color: { argb: 'FFe2e8f0' } } };

                    // ─── עיצוב מיוחד לעמודת "נדרש תיקוף" ───
                    const colDef = columnsToExport[colNum - 1];
                    if (colDef?.key === 'requiresValidation' && cell.value === 'נדרש תיקוף') {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: 'FFb45309' }
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: 'FFfef3c7' }
                        };
                    }

                    // ─── עיצוב מיוחד לעמודת "תיקוף אחרון" ───
                    if (colDef?.key === 'lastValidatedAt' && cell.value) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            color: { argb: 'FF166534' }
                        };
                    }
                });
            });

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            const date = new Date().toISOString().split('T')[0];
            saveAs(blob, `systems_catalog_${date}.xlsx`);

            this.showToast(
                `📊 יוצאו ${this.filteredSystems.length} מערכות (${columnsToExport.length} עמודות)`,
                'success'
            );

        } catch (err) {
            console.error('exportToExcel error:', err);
            this.showToast('שגיאה בייצוא: ' + err.message, 'error');
        } finally {
            const exportBtn = document.getElementById('scExportBtn');
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML = '<i class="fas fa-file-excel"></i>';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל אפשרויות ייצוא לאקסל
    // ══════════════════════════════════════════════════════════
    _showExportOptionsModal() {
        return new Promise(resolve => {
            const existing = document.getElementById('scExportOptionsModal');
            if (existing) existing.remove();

            // ─── בדוק כמה עמודות גלויות ───
            const visibleCount = Object.values(this.visibleColumns)
                .filter(v => v === true).length;
            const totalCols = 23; // סה"כ עמודות אפשריות

            const modal = document.createElement('div');
            modal.id = 'scExportOptionsModal';
            modal.className = 'sc-modal-overlay';
            modal.style.zIndex = '999999';

            modal.innerHTML = `
<div class="sc-modal" style="max-width:420px;width:95%">

    <div class="sc-modal-header" style="
        border-bottom:2px solid rgba(34,197,94,0.35);
        background:linear-gradient(135deg,
            rgba(34,197,94,0.08),rgba(16,185,129,0.05))">
        <h3 class="sc-modal-title">
            <i class="fas fa-file-excel" style="color:#22c55e"></i>
            ייצוא לאקסל
        </h3>
        <button class="sc-modal-close"
                id="scExportOptClose">&times;</button>
    </div>

    <div class="sc-modal-body" style="gap:14px">

        <!-- מידע -->
        <div style="
            display:flex;align-items:center;gap:8px;
            padding:10px 14px;
            background:rgba(34,197,94,0.06);
            border:1px solid rgba(34,197,94,0.2);
            border-radius:8px;font-size:0.82rem;color:#888">
            <i class="fas fa-info-circle" style="color:#22c55e"></i>
            <span>
                יוצאו
                <strong style="color:#86efac">
                    ${this.filteredSystems.length}
                </strong>
                מערכות (לפי הפילטרים הנוכחיים)
            </span>
        </div>

        <!-- בחירת עמודות -->
        <div style="display:flex;flex-direction:column;gap:8px">
            <div style="font-size:0.78rem;font-weight:600;
                        color:#777;margin-bottom:4px">
                <i class="fas fa-columns"
                   style="color:#6366f1"></i>
                בחר עמודות לייצוא:
            </div>

            <!-- אפשרות 1: כל העמודות -->
            <label style="
                display:flex;align-items:flex-start;gap:12px;
                padding:12px 14px;
                background:rgba(255,255,255,0.03);
                border:2px solid rgba(255,255,255,0.08);
                border-radius:8px;cursor:pointer;
                transition:all 0.15s;user-select:none"
                id="scExportOptAllLabel">
                <input type="radio"
                       name="scExportCols"
                       value="all"
                       id="scExportOptAll"
                       checked
                       style="accent-color:#6366f1;
                              width:16px;height:16px;
                              margin-top:1px;flex-shrink:0;
                              cursor:pointer">
                <div>
                    <div style="font-size:0.88rem;font-weight:700;
                                color:#e0e0e0;margin-bottom:3px">
                        <i class="fas fa-table"
                           style="color:#6366f1;font-size:0.8rem"></i>
                        כל העמודות
                    </div>
                    <div style="font-size:0.75rem;color:#666">
                        ייצא את כל
                        <strong style="color:#a5b4fc">${totalCols}</strong>
                        העמודות הזמינות
                        (כולל תיקוף, אוטומציה וכו')
                    </div>
                </div>
            </label>

            <!-- אפשרות 2: עמודות גלויות בלבד -->
            <label style="
                display:flex;align-items:flex-start;gap:12px;
                padding:12px 14px;
                background:rgba(255,255,255,0.03);
                border:2px solid rgba(255,255,255,0.08);
                border-radius:8px;cursor:pointer;
                transition:all 0.15s;user-select:none"
                id="scExportOptVisibleLabel">
                <input type="radio"
                       name="scExportCols"
                       value="visible"
                       id="scExportOptVisible"
                       style="accent-color:#6366f1;
                              width:16px;height:16px;
                              margin-top:1px;flex-shrink:0;
                              cursor:pointer">
                <div>
                    <div style="font-size:0.88rem;font-weight:700;
                                color:#e0e0e0;margin-bottom:3px">
                        <i class="fas fa-eye"
                           style="color:#22c55e;font-size:0.8rem"></i>
                        עמודות גלויות בלבד
                    </div>
                    <div style="font-size:0.75rem;color:#666">
                        ייצא רק את
                        <strong style="color:#86efac">${visibleCount}</strong>
                        העמודות המוצגות כרגע במסך
                    </div>
                </div>
            </label>
        </div>

    </div>

    <div class="sc-modal-footer">
        <button class="sc-modal-cancel-btn"
                id="scExportOptCancel">
            <i class="fas fa-times"></i> ביטול
        </button>
        <button id="scExportOptConfirm"
                style="
                    padding:8px 20px;
                    background:linear-gradient(
                        135deg,
                        rgba(34,197,94,0.8),
                        rgba(22,163,74,0.9));
                    border:1px solid rgba(34,197,94,0.6);
                    border-radius:6px;color:#052e16;
                    font-size:0.85rem;font-weight:700;
                    cursor:pointer;display:flex;
                    align-items:center;gap:6px;
                    transition:all 0.2s;font-family:inherit">
            <i class="fas fa-file-excel"></i>
            ייצא לאקסל
        </button>
    </div>

</div>`;

            document.body.appendChild(modal);

            // ─── הדגש label נבחר ───
            const highlightSelected = () => {
                const allLabel = document.getElementById('scExportOptAllLabel');
                const visLabel = document.getElementById('scExportOptVisibleLabel');
                const allRadio = document.getElementById('scExportOptAll');

                if (allLabel && visLabel) {
                    if (allRadio?.checked) {
                        allLabel.style.borderColor = 'rgba(99,102,241,0.5)';
                        allLabel.style.background = 'rgba(99,102,241,0.08)';
                        visLabel.style.borderColor = 'rgba(255,255,255,0.08)';
                        visLabel.style.background = 'rgba(255,255,255,0.03)';
                    } else {
                        visLabel.style.borderColor = 'rgba(34,197,94,0.5)';
                        visLabel.style.background = 'rgba(34,197,94,0.06)';
                        allLabel.style.borderColor = 'rgba(255,255,255,0.08)';
                        allLabel.style.background = 'rgba(255,255,255,0.03)';
                    }
                }
            };

            // ─── אתחל הדגשה ───
            highlightSelected();

            // ─── אירועי radio ───
            document.querySelectorAll('input[name="scExportCols"]')
                .forEach(radio => {
                    radio.addEventListener('change', highlightSelected);
                });

            // ─── לחיצה על label ───
            ['scExportOptAllLabel', 'scExportOptVisibleLabel'].forEach(id => {
                document.getElementById(id)?.addEventListener('click', () => {
                    setTimeout(highlightSelected, 10);
                });
            });

            // ─── סגירה ───
            const closeModal = (result) => {
                modal.remove();
                resolve(result);
            };

            document.getElementById('scExportOptClose')
                ?.addEventListener('click', () => closeModal(null));
            document.getElementById('scExportOptCancel')
                ?.addEventListener('click', () => closeModal(null));

            document.getElementById('scExportOptConfirm')
                ?.addEventListener('click', () => {
                    const selected = document.querySelector(
                        'input[name="scExportCols"]:checked'
                    )?.value || 'all';
                    closeModal(selected);
                });

            // ─── סגור ברקע ───
            modal.addEventListener('click', e => {
                if (e.target === modal) closeModal(null);
            });
        });
    }

    // ══════════════════════════════════════════════════════════
    // הצג banner כאשר החיפוש מצא שרתים
    // ══════════════════════════════════════════════════════════
    _renderServerSearchBanner() {
        // ─── הסר banner קיים ───
        document.getElementById('scServerSearchBanner')?.remove();

        if (!this._serverSearchInfo || !this._serverSearchResults?.size) return;

        const info = this._serverSearchInfo;
        const content = document.getElementById('scContent');
        if (!content) return;

        const banner = document.createElement('div');
        banner.id = 'scServerSearchBanner';
        banner.className = 'sc-server-search-banner';
        banner.innerHTML = `
        <div class="sc-server-search-banner-inner">
            <i class="fas fa-server" style="color:#6366f1"></i>
            <div class="sc-server-search-banner-text">
                <strong>חיפוש שרת:</strong>
                נמצא שרת
                <span class="sc-server-search-name">
                    ${this.escHtml(info.serverName || this.searchTerm)}
                </span>
                ${info.serverIp ? `
                <span class="sc-server-search-ip">
                    (${this.escHtml(info.serverIp)})
                </span>` : ''}
                — מקושר ל-
                <strong>${this._serverSearchResults.size}</strong>
                מערכות
            </div>
            <button class="sc-server-search-clear"
                    onclick="
                        window._scDashboard._serverSearchResults = null;
                        window._scDashboard._serverSearchInfo = null;
                        window._scDashboard.applyFiltersAndSort();
                        window._scDashboard.renderContent();
                        document.getElementById('scServerSearchBanner')?.remove();
                    "
                    title="נקה חיפוש שרת">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;

        content.parentNode?.insertBefore(banner, content);
    }

    // ══════════════════════════════════════════════════════════
    // אירועים
    // ══════════════════════════════════════════════════════════
    bindEvents() {

        // ─── חיפוש ───
        document.addEventListener('input', e => {
            if (e.target.id === 'scSearch') {
                this.searchTerm = e.target.value;
                const clr = document.getElementById('scClearSearch');
                if (clr) clr.style.display = e.target.value ? 'flex' : 'none';
                this.applyFiltersAndSort();
                this.renderContent();
                // ─── debounce לחיפוש שרתים ───
                clearTimeout(this._searchDebounce);
                this._searchDebounce = setTimeout(async () => {
                    await this._searchByServer(this.searchTerm);
                    this.applyFiltersAndSort();
                    this.renderContent();
                    this._renderServerSearchBanner(); // ← הצג banner
                }, 400);
            }
        });

        // ─── שינוי פילטרים ───
        document.addEventListener('change', e => {
            const filterMap = {
                scFltStatus: 'status',
                scFltDomain: 'domain',
                scFltDept: 'department',
                scFltTeam: 'team',
                scFltBizDiv: 'businessDivision',
                scFltAppClass: 'appClassification',
                scFltAppType: 'appType',
                scFltCriticality: 'businessCriticality',
                scFltAvailability: 'availabilityRequirement',
                scFltEnv: 'environment',
                scFltPublisher: 'publisher',
                scFltVendor: 'supportVendor',
                scFltManager: 'systemManager',
                scFltDeptManager: 'departmentManager',
                scFltAutomation: 'hasAutomation',
                scFltRequiresValidation: 'requiresValidation',
            };

            if (filterMap[e.target.id]) {
                this.filters[filterMap[e.target.id]] = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
                this.updateStats();
            }

            if (e.target.id === 'scPageSize') {
                this.pageSize = parseInt(e.target.value);
                this._savePreferences();
                this.currentPage = 1;
                this.renderContent();
            }
        });

        // ─── לחיצות ───
        document.addEventListener('click', e => {
            if (e.target.closest('#scAutoFillBulkBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה', 'error');
                    return;
                }
                this._autoFillOrgInfoBulk();
                return;
            }

            // ניקוי חיפוש
            if (e.target.closest('#scClearSearch')) {
                this.searchTerm = '';
                const inp = document.getElementById('scSearch');
                if (inp) inp.value = '';
                const clr = document.getElementById('scClearSearch');
                if (clr) clr.style.display = 'none';
                this.applyFiltersAndSort();
                this.renderContent();
            }

            // ניקוי פילטרים
            if (e.target.closest('#scClearFilters')) {
                Object.keys(this.filters).forEach(k => {
                    this.filters[k] = 'all';
                });
                this._restoreFilterSelects();
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
                this.updateStats();
                const popup = document.getElementById('scFiltersPopup');
                if (popup) popup.style.display = 'none';
                const chevron = document.getElementById('scFiltersChevron');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }

            // הסרת תגית פילטר
            const removeTag = e.target.closest('.sc-active-tag-remove');
            if (removeTag) {
                const key = removeTag.dataset.filterKey;
                if (key && this.filters.hasOwnProperty(key)) {
                    this.filters[key] = 'all';
                    this._restoreFilterSelects();
                    this._savePreferences();
                    this.applyFiltersAndSort();
                    this.renderContent();
                    this.updateStats();
                }
            }
            // ─── Checkbox - בחר שורה ───
            const cbRow = e.target.closest('.sc-cb-row');
            if (cbRow) {
                e.stopPropagation();
                const id = cbRow.dataset.id;
                if (cbRow.checked) {
                    this.selectedSystems.add(id);
                } else {
                    this.selectedSystems.delete(id);
                }
                const row = cbRow.closest('tr.sc-tr');
                if (row) row.classList.toggle('sc-tr-selected', cbRow.checked);
                this._updateMultiToolbar();
                return;
            }

            // ─── Checkbox - בחר הכל ───
            const cbAll = e.target.closest('.sc-cb-all');
            if (cbAll) {
                e.stopPropagation();
                const { page } = this._getPaginationInfo();
                if (cbAll.checked) {
                    page.forEach(s => this.selectedSystems.add(s.id));
                } else {
                    page.forEach(s => this.selectedSystems.delete(s.id));
                }
                document.querySelectorAll('.sc-cb-row').forEach(cb => {
                    const id = cb.dataset.id;
                    cb.checked = this.selectedSystems.has(id);
                    const row = cb.closest('tr.sc-tr');
                    if (row) row.classList.toggle('sc-tr-selected', cb.checked);
                });
                this._updateMultiToolbar();
                return;
            }

            // ─── Multi Toolbar - בטל בחירה ───
            if (e.target.closest('#scMultiClear')) {
                this.selectedSystems.clear();
                document.querySelectorAll('.sc-cb-row').forEach(cb => {
                    cb.checked = false;
                    const row = cb.closest('tr.sc-tr');
                    if (row) row.classList.remove('sc-tr-selected');
                });
                const cbAll = document.querySelector('.sc-cb-all');
                if (cbAll) cbAll.checked = false;
                this._updateMultiToolbar();
                return;
            }

            // ─── Multi Toolbar - שלח תיקוף נבחרים ───
            if (e.target.closest('#scBulkValidateBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה לשליחת תיקוף נבחרים', 'error');
                    return;
                }
                this._openBulkValidationModal();
                return;
            }

            // ─── Multi Toolbar - ערוך נבחרים ───
            if (e.target.closest('#scMultiEditBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה לעריכה', 'error');
                    return;
                }
                this.openMultiEditModal();
                return;
            }

            // ─── Multi Toolbar - מחק נבחרים ───
            if (e.target.closest('#scMultiDeleteBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה למחיקה', 'error');
                    return;
                }
                this._openMultiDeleteModal();
                return;
            }

            // רענון
            if (e.target.closest('#scRefreshBtn'))
                this.loadData();

            // הוספת מערכת חדשה
            if (e.target.closest('#scAddSystemBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה להוספת מערכת', 'error');
                    return;
                }
                this.openAddModal();
                return;
            }

            // פערים
            if (e.target.closest('#scGapsBtn')) {
                this.openGapsModal();
                return;
            }

            // ייבוא
            if (e.target.closest('#scImportBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה לייבוא', 'error');
                    return;
                }
                this.openImportDialog();
            }
            if (e.target.closest('#scImportAutoBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה לייבוא', 'error');
                    return;
                }
                this.openImportAutomationDialog();
                return;
            }

            // ניהול עמודות
            if (e.target.closest('#scColManagerBtn')) {
                this.openColumnManagerModal();
                return;
            }

            // ייצוא
            if (e.target.closest('#scExportBtn'))
                this.exportToExcel();

            // מצב תצוגה
            if (e.target.closest('#scViewTable')) {
                this.viewMode = 'table';
                this._savePreferences();
                this.renderContent();
            }
            if (e.target.closest('#scViewCards')) {
                this.viewMode = 'cards';
                this._savePreferences();
                this.renderContent();
            }
            if (e.target.closest('#scViewStats')) {
                this.viewMode = 'stats';
                this._savePreferences();
                this.renderContent();
            }

            // מיון עמודה
            const th = e.target.closest('.sc-th');
            if (th && th.dataset.col) {
                const col = th.dataset.col;
                if (this.sortColumn === col) {
                    this.sortDirection =
                        this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = col;
                    this.sortDirection = 'asc';
                }
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }

            // עריכת שורה
            const editBtn = e.target.closest('.sc-row-edit-btn');
            if (editBtn) {
                e.stopPropagation();
                this.openEditModal(editBtn.dataset.id);
            }

            // ─── לחיצה על שם מערכת → פתח פופאפ שרתים ───
            const systemNameLink = e.target.closest('.sc-system-name-link');
            if (systemNameLink) {
                e.stopPropagation();
                const systemName = systemNameLink.dataset.systemName;
                if (systemName) {
                    this.openSystemServersModal(systemName);
                }
                return;
            }

            // ─── לחיצה על כפתור שרתים בטבלה ───
            const viewServersBtn = e.target.closest('.sc-view-servers-btn');
            if (viewServersBtn) {
                e.stopPropagation();
                const systemName = viewServersBtn.dataset.systemName;
                if (systemName) {
                    this.openSystemServersModal(systemName);
                }
                return;
            }

            // ─── Stats Bar pill - מחזוריות בין ערכים ───
            const statPill = e.target.closest('.sc-stat-pill-clickable');
            if (statPill && !e.target.closest('.sc-stat-pill-clear')) {
                const filterKey = statPill.dataset.filterKey;
                const valuesStr = statPill.dataset.values;

                if (filterKey && valuesStr) {
                    try {
                        const values = JSON.parse(valuesStr);
                        const currentValue = this.filters[filterKey] || 'all';

                        // מצא את הערך הבא במחזור
                        const currentIndex = values.indexOf(currentValue);
                        const nextIndex = (currentIndex + 1) % values.length;
                        const nextValue = values[nextIndex];

                        // עדכן את הפילטר
                        this.filters[filterKey] = nextValue;
                        this._restoreFilterSelects();
                        this._savePreferences();
                        this.applyFiltersAndSort();
                        this.renderContent();
                        this.updateStats();

                        // הצג הודעה קצרה
                        if (nextValue === 'all') {
                            this.showToast(`✓ הוסר סינון ${this._getFilterLabel(filterKey)}`, 'info');
                        } else {
                            this.showToast(`✓ ${this._getFilterLabel(filterKey)}: ${nextValue}`, 'info');
                        }
                    } catch (err) {
                        console.error('Error parsing values:', err);
                    }
                }
                return;
            }

            // ─── Stats Bar pill clear - ניקוי מיידי ל-all ───
            const statClear = e.target.closest('.sc-stat-pill-clear');
            if (statClear) {
                e.stopPropagation();
                const filterKey = statClear.dataset.filterKey;
                if (filterKey) {
                    this.filters[filterKey] = 'all';
                    this._restoreFilterSelects();
                    this._savePreferences();
                    this.applyFiltersAndSort();
                    this.renderContent();
                    this.updateStats();
                    this.showToast(`✓ הוסר סינון ${this._getFilterLabel(filterKey)}`, 'info');
                }
                return;
            }

            // pagination
            const pagBtn = e.target.closest('.sc-pag-btn');
            if (pagBtn && !pagBtn.classList.contains('disabled')) {
                const pg = parseInt(pagBtn.dataset.page);
                if (!isNaN(pg)) {
                    this.currentPage = pg;
                    this.renderContent();
                    const wrap = document.querySelector('.sc-scroll-wrapper');
                    if (wrap) wrap.scrollTop = 0;
                }
            }

            // פתיחת/סגירת פופאפ פילטרים
            const toggle = e.target.closest('#scFiltersToggle');
            const popup = document.getElementById('scFiltersPopup');
            const wrap = e.target.closest('.sc-filters-wrap');

            if (toggle && popup) {
                const isOpen = popup.style.display !== 'none';
                popup.style.display = isOpen ? 'none' : 'block';
                const chevron = document.getElementById('scFiltersChevron');
                if (chevron) chevron.style.transform =
                    isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
                return;
            }

            if (!wrap && popup) {
                popup.style.display = 'none';
                const chevron = document.getElementById('scFiltersChevron');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }

            // ── סגור column filter popups בלחיצה מחוץ ──
            if (!e.target.closest('.sc-th-filter-popup') &&
                !e.target.closest('.sc-th-filter-btn')) {
                document.querySelectorAll('.sc-th-filter-popup').forEach(p => {
                    p.style.display = 'none';
                });
            }

            // ─── קליק על מספר קטלוג → פתח פרטים/עריכה ───
            const catalogNumLink = e.target.closest('.sc-catalog-num-link');
            if (catalogNumLink) {
                e.stopPropagation();
                const systemId = catalogNumLink.dataset.id;
                if (systemId) {
                    const readOnly = !this.isAdmin && !this.isAutomationOnly;
                    this.openEditModal(systemId, readOnly);
                }
                return;
            }

            // ─── לחיצה על כפתור "שייך שרתים" ───
            const assignBtn = e.target.closest('#scAssignServersBtn');
            if (assignBtn) {
                e.stopPropagation();
                const systemName = assignBtn.dataset.systemName;
                const catalogNumber = assignBtn.dataset.catalogNumber;
                if (systemName) {
                    this._openAssignServersModal(systemName, catalogNumber);
                }
                return;
            }
        });

        // ─── דאבל-קליק לעריכה / צפייה ───
        document.addEventListener('dblclick', e => {
            if (this.viewMode !== 'table') return;
            const row = e.target.closest('tr.sc-tr');
            if (!row) return;
            if (e.target.closest('button')) return;
            const systemId = row.dataset.id;
            if (systemId) {
                // אדמין או עורך אוטומציה - פתח עריכה, אחרים - צפייה בלבד
                const readOnly = !this.isAdmin && !this.isAutomationOnly;
                this.openEditModal(systemId, readOnly);
            }
        });
    }

    async _loadServersForEditModal(systemId, catalogNumber) {
        const listEl = document.getElementById('scEditServersList');
        const countEl = document.getElementById('scEditServersCount');
        if (!listEl) return;

        try {
            const system = this.allSystems.find(s => s.id === systemId);
            if (!system) return;

            const params = new URLSearchParams({
                systemName: system.name || ''
            });
            if (catalogNumber) {
                params.append('catalogNumber', String(catalogNumber));
            }

            const res = await fetch(
                `/Servers/GetServersBySystem?${params.toString()}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            const servers = data.servers || [];

            if (countEl) {
                countEl.textContent = `${servers.length} שרתים`;
            }

            if (servers.length === 0) {
                listEl.innerHTML = `
                <div class="sc-assign-empty-msg">
                    <i class="fas fa-info-circle"
                       style="color:#555"></i>
                    אין שרתים משויכים למערכת זו
                </div>`;
                return;
            }

            listEl.innerHTML = servers.map(s => {
                const envClass = s.environment === 'PROD'
                    ? 'srv-badge-prod' : 'srv-badge-nonprod';
                return `
                <div class="sc-edit-server-item">
                    <i class="fas fa-server"
                       style="color:#555;font-size:0.65rem;
                              flex-shrink:0"></i>
                    <span class="sc-edit-server-name"
                          title="${this.escHtml(s.name || '')}">
                        ${this.escHtml(s.name || '')}
                    </span>
                    <span class="srv-badge ${envClass}"
                          style="font-size:0.62rem;flex-shrink:0">
                        ${this.escHtml(s.environment || '—')}
                    </span>
                    ${s.isHealthy ? `
                    <span class="srv-badge ${s.isHealthy === 'תקין'
                            ? 'srv-badge-healthy'
                            : 'srv-badge-unhealthy'
                        }" style="font-size:0.62rem;flex-shrink:0">
                        ${this.escHtml(s.isHealthy)}
                    </span>` : ''}
                </div>`;
            }).join('');

        } catch (err) {
            console.warn('_loadServersForEditModal error:', err);
            if (listEl) {
                listEl.innerHTML = `
                <div class="sc-assign-empty-msg"
                     style="color:#f87171">
                    <i class="fas fa-exclamation-triangle"></i>
                    שגיאה בטעינת שרתים
                </div>`;
            }
            if (countEl) countEl.textContent = '';
        }
    }

    // ══════════════════════════════════════════════════════════════
    // מודל שיוך שרתים למערכת
    // ══════════════════════════════════════════════════════════════
    async _openAssignServersModal(systemName, catalogNumber) {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לשיוך שרתים', 'error');
            return;
        }

        // ─── סגור מודל שרתים קיים ───
        document.getElementById('scSystemServersModal')?.remove();

        const existing = document.getElementById('scAssignServersModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'scAssignServersModal';
        modal.className = 'sc-modal-overlay';

        // ─── הצג loading ───
        modal.innerHTML = `
    <div class="sc-modal sc-assign-modal">
        <div class="sc-modal-header sc-assign-modal-header">
            <h3 class="sc-modal-title">
                <i class="fas fa-link" style="color:#6366f1"></i>
                שיוך שרתים למערכת
                <span class="sc-assign-system-badge">
                    ${this.escHtml(systemName)}
                </span>
            </h3>
            <button class="sc-modal-close"
                    id="scAssignModalClose">&times;</button>
        </div>
        <div class="sc-assign-modal-body">
            <div class="sc-servers-modal-loading">
                <i class="fas fa-spinner fa-spin"
                   style="color:#6366f1;font-size:1.2rem"></i>
                <span>טוען שרתים...</span>
            </div>
        </div>
    </div>`;

        document.body.appendChild(modal);

        const closeModal = () => modal.remove();
        document.getElementById('scAssignModalClose')
            .addEventListener('click', closeModal);

        try {
            // ─── טען שרתים משויכים כבר ───
            const params = new URLSearchParams({ systemName });
            if (catalogNumber) params.append('catalogNumber', catalogNumber);

            const res = await fetch(
                `/Servers/GetServersBySystem?${params.toString()}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            // ─── טען את כל השרתים הזמינים ───
            const allRes = await fetch('/Servers/GetServers',
                { credentials: 'include' });
            const allData = await allRes.json();

            const body = modal.querySelector('.sc-assign-modal-body');

            const assignedNames = new Set(
                (data.servers || []).map(s =>
                    (s.name || '').toLowerCase()
                )
            );

            const allServers = (allData.servers || []);

            // ─── שרתים לא משויכים (זמינים לשיוך) ───
            const availableServers = allServers.filter(s =>
                !assignedNames.has((s.name || '').toLowerCase())
            );

            this._renderAssignModalContent(
                body,
                systemName,
                catalogNumber,
                data.servers || [],
                availableServers,
                modal
            );

        } catch (err) {
            console.error('_openAssignServersModal error:', err);
            const body = modal.querySelector('.sc-assign-modal-body');
            if (body) {
                body.innerHTML = `
            <div class="sc-servers-modal-empty">
                <i class="fas fa-exclamation-triangle"
                   style="color:#f59e0b"></i>
                <div style="color:#f87171">
                    שגיאה: ${this.escHtml(err.message)}
                </div>
            </div>`;
            }
        }
    }

    // ─── רנדר תוכן מודל השיוך ────────────────────────────────────
    _renderAssignModalContent(
        container,
        systemName,
        catalogNumber,
        assignedServers,
        availableServers,
        modal
    ) {
        // ─── שרתים שנבחרו לשיוך ───
        const selectedToAssign = new Set();

        // ─── בנה שורות שרתים משויכים ───
        const assignedRowsHtml = assignedServers.length === 0
            ? `<div class="sc-assign-empty-msg">
               <i class="fas fa-info-circle"></i>
               אין שרתים משויכים כרגע
           </div>`
            : assignedServers.map(s => {
                const envClass = s.environment === 'PROD'
                    ? 'srv-badge-prod' : 'srv-badge-nonprod';
                return `
            <div class="sc-assign-server-item sc-assign-server-assigned">
                <i class="fas fa-server"
                   style="color:#6366f1;font-size:0.7rem;flex-shrink:0"></i>
                <span class="sc-assign-server-name"
                      title="${this.escHtml(s.name)}">
                    ${this.escHtml(s.name)}
                </span>
                <span class="srv-badge ${envClass}"
                      style="font-size:0.65rem">
                    ${this.escHtml(s.environment || '—')}
                </span>
                <span class="sc-assign-already-badge">
                    <i class="fas fa-check"></i> משויך
                </span>
            </div>`;
            }).join('');

        // ─── בנה שורות שרתים זמינים ───
        const availableRowsHtml = availableServers.length === 0
            ? `<div class="sc-assign-empty-msg">
               <i class="fas fa-info-circle"></i>
               כל השרתים כבר משויכים למערכת זו
           </div>`
            : availableServers.map(s => {
                const envClass = s.environment === 'PROD'
                    ? 'srv-badge-prod' : 'srv-badge-nonprod';
                return `
            <div class="sc-assign-server-item sc-assign-server-available"
                 data-name="${this.escHtml(s.name)}">
                <input type="checkbox"
                       class="sc-assign-cb"
                       data-name="${this.escHtml(s.name)}"
                       style="accent-color:#6366f1;
                              width:14px;height:14px;
                              cursor:pointer;flex-shrink:0">
                <i class="fas fa-server"
                   style="color:#555;font-size:0.7rem;flex-shrink:0"></i>
                <span class="sc-assign-server-name"
                      title="${this.escHtml(s.name)}">
                    ${this.escHtml(s.name)}
                </span>
                <span class="srv-badge ${envClass}"
                      style="font-size:0.65rem">
                    ${this.escHtml(s.environment || '—')}
                </span>
                ${s.systemName ? `
                <span style="font-size:0.68rem;color:#555;
                             white-space:nowrap;overflow:hidden;
                             text-overflow:ellipsis;max-width:100px"
                      title="${this.escHtml(s.systemName)}">
                    ${this.escHtml(s.systemName)}
                </span>` : ''}
            </div>`;
            }).join('');

        container.innerHTML = `

        <!-- ── חיפוש ── -->
        <div class="sc-assign-search-wrap">
            <i class="fas fa-search sc-assign-search-icon"></i>
            <input type="text"
                   id="scAssignSearch"
                   class="sc-assign-search-input"
                   placeholder="חפש שרת לשיוך..."/>
        </div>

        <!-- ── כפתורי בחר/בטל הכל ── -->
        ${availableServers.length > 0 ? `
        <div class="sc-assign-controls">
            <button id="scAssignSelectAll"
                    class="sc-assign-ctrl-btn sc-assign-ctrl-select">
                <i class="fas fa-check-double"></i> בחר הכל
            </button>
            <button id="scAssignDeselectAll"
                    class="sc-assign-ctrl-btn sc-assign-ctrl-deselect">
                <i class="fas fa-times"></i> בטל הכל
            </button>
            <span id="scAssignSelectedCount"
                  class="sc-assign-count-badge">
                0 נבחרו
            </span>
        </div>` : ''}

        <!-- ── שרתים זמינים לשיוך ── -->
        <div class="sc-assign-section">
            <div class="sc-assign-section-title">
                <i class="fas fa-plus-circle"
                   style="color:#22c55e"></i>
                שרתים זמינים לשיוך
                <span class="sc-assign-section-count">
                    ${availableServers.length}
                </span>
            </div>
            <div class="sc-assign-list" id="scAssignAvailableList">
                ${availableRowsHtml}
            </div>
        </div>

        <!-- ── שרתים משויכים כבר ── -->
        <div class="sc-assign-section">
            <div class="sc-assign-section-title">
                <i class="fas fa-check-circle"
                   style="color:#6366f1"></i>
                שרתים משויכים כבר
                <span class="sc-assign-section-count">
                    ${assignedServers.length}
                </span>
            </div>
            <div class="sc-assign-list sc-assign-list-assigned">
                ${assignedRowsHtml}
            </div>
        </div>

        <!-- ── Footer ── -->
        <div class="sc-assign-footer">
            <button class="sc-modal-cancel-btn"
                    id="scAssignCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button class="sc-assign-save-btn"
                    id="scAssignSave"
                    disabled>
                <i class="fas fa-link"></i>
                שייך נבחרים
                (<span id="scAssignSaveCount">0</span>)
            </button>
        </div>`;

        // ─── אירועים ─────────────────────────────────────────────
        // ── סגירה ──
        document.getElementById('scAssignCancel')
            ?.addEventListener('click', () => modal.remove());

        // ── חיפוש ──
        document.getElementById('scAssignSearch')
            ?.addEventListener('input', e => {
                const term = e.target.value.toLowerCase().trim();
                document.querySelectorAll(
                    '#scAssignAvailableList .sc-assign-server-item'
                ).forEach(item => {
                    const name = (item.dataset.name || '').toLowerCase();
                    item.style.display =
                        !term || name.includes(term) ? '' : 'none';
                });
            });

        // ── עדכן מונה נבחרים ──
        const updateCount = () => {
            const checked = document.querySelectorAll(
                '.sc-assign-cb:checked'
            );
            const count = checked.length;

            const countEl = document.getElementById('scAssignSelectedCount');
            const saveBtn = document.getElementById('scAssignSave');
            const saveCount = document.getElementById('scAssignSaveCount');

            if (countEl) countEl.textContent = `${count} נבחרו`;
            if (saveCount) saveCount.textContent = count;
            if (saveBtn) {
                saveBtn.disabled = count === 0;
                saveBtn.style.opacity = count === 0 ? '0.4' : '1';
            }

            // ─── עדכן selectedToAssign ───
            selectedToAssign.clear();
            checked.forEach(cb => selectedToAssign.add(cb.dataset.name));
        };

        // ── checkbox בודד ──
        document.getElementById('scAssignAvailableList')
            ?.addEventListener('change', e => {
                if (e.target.classList.contains('sc-assign-cb')) {
                    const item = e.target.closest('.sc-assign-server-item');
                    if (item) {
                        item.classList.toggle(
                            'sc-assign-item-selected',
                            e.target.checked
                        );
                    }
                    updateCount();
                }
            });

        // ── לחיצה על שורה (לא על checkbox) ──
        document.getElementById('scAssignAvailableList')
            ?.addEventListener('click', e => {
                const item = e.target.closest('.sc-assign-server-item');
                if (!item) return;
                if (e.target.type === 'checkbox') return;

                const cb = item.querySelector('.sc-assign-cb');
                if (cb) {
                    cb.checked = !cb.checked;
                    item.classList.toggle(
                        'sc-assign-item-selected', cb.checked
                    );
                    updateCount();
                }
            });

        // ── בחר הכל ──
        document.getElementById('scAssignSelectAll')
            ?.addEventListener('click', () => {
                document.querySelectorAll(
                    '#scAssignAvailableList ' +
                    '.sc-assign-server-item:not([style*="display: none"]) ' +
                    '.sc-assign-cb'
                ).forEach(cb => {
                    cb.checked = true;
                    cb.closest('.sc-assign-server-item')
                        ?.classList.add('sc-assign-item-selected');
                });
                updateCount();
            });

        // ── בטל הכל ──
        document.getElementById('scAssignDeselectAll')
            ?.addEventListener('click', () => {
                document.querySelectorAll('.sc-assign-cb').forEach(cb => {
                    cb.checked = false;
                    cb.closest('.sc-assign-server-item')
                        ?.classList.remove('sc-assign-item-selected');
                });
                updateCount();
            });

        // ── שמור שיוך ──
        document.getElementById('scAssignSave')
            ?.addEventListener('click', () =>
                this._saveServerAssignment(
                    systemName,
                    catalogNumber,
                    [...selectedToAssign],
                    modal
                )
            );
    }

    // ─── שמור שיוך שרתים למערכת ──────────────────────────────────
    async _saveServerAssignment(
        systemName,
        catalogNumber,
        serverNames,
        modal
    ) {
        if (!serverNames || serverNames.length === 0) {
            this.showToast('לא נבחרו שרתים לשיוך', 'error');
            return;
        }

        const saveBtn = document.getElementById('scAssignSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> משייך...';
        }

        try {
            // ─── עדכן כל שרת נבחר עם שם המערכת ומספר הקטלוג ───
            const updates = {};
            if (systemName) updates.systemName = systemName;
            if (catalogNumber) updates.catalogNumber = catalogNumber;
            console.log(updates)
            const res = await fetch('/Servers/UpdateMultipleServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    serverNames,
                    updates
                })
            });

            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בשיוך');

            modal.remove();

            this.showToast(
                `✅ שויכו ${data.updatedCount} שרתים למערכת "${systemName}"`,
                'success'
            );

        } catch (err) {
            console.error('_saveServerAssignment error:', err);
            this.showToast('שגיאה בשיוך: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    `<i class="fas fa-link"></i> שייך נבחרים ` +
                    `(<span id="scAssignSaveCount">${serverNames.length}</span>)`;
            }
        }
    }

    _renderAutomationBadge(status, note) {
        const s = status || 'לא קיימות';

        if (s === 'קיימות') {
            return `
        <span class="sc-badge sc-badge-automation-yes"
              title="${this.escHtml(note || 'יש בדיקות אוטומטיות')}">
            <i class="fas fa-robot"></i> קיימות
        </span>`;
        }

        if (s === 'לא רלוונטי') {
            return `
        <span class="sc-badge sc-badge-automation-na"
              title="${this.escHtml(note || 'לא רלוונטי')}">
            <i class="fas fa-minus"></i> לא רלוונטי
        </span>`;
        }

        // לא קיימות
        return `
    <span class="sc-badge sc-badge-automation-no"
          title="אין בדיקות אוטומטיות">
        <i class="fas fa-times"></i> לא קיימות
    </span>`;
    }

    // ══════════════════════════════════════════════════════════
    // מודל שרתי מערכת
    // ══════════════════════════════════════════════════════════
    async openSystemServersModal(systemName) {

        // ─── הסר מודל קיים ───
        const existing = document.getElementById('scSystemServersModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'scSystemServersModal';
        modal.className = 'sc-modal-overlay';

        // ─── מצא מספר קטלוג ───
        const system = this.allSystems.find(s =>
            (s.name || '').toLowerCase() === (systemName || '').toLowerCase()
        );
        const catalogNumber = system?.number ? String(system.number) : null;

        // ─── הצג כפתור מעבר רק למשתמשים מחוברים עם הרשאות ───
        const isLoggedIn = this.currentUser &&
            this.currentUser.trim() !== '' &&
            this.currentUser.trim() !== 'מערכת';

        const showGotoBtn = isLoggedIn && (this.isAdmin || this.isAutomationOnly);
        const displayLabel = `פתח בדשבורד שרתים`;

        // ─── הצג loading ───
        modal.innerHTML = `
    <div class="sc-modal sc-servers-modal">

        <div class="sc-modal-header sc-servers-modal-header">
            <h3 class="sc-modal-title">
                <i class="fas fa-server" style="color:#6366f1"></i>
                שרתי המערכת
                <span class="sc-servers-modal-name-badge">
                    ${this.escHtml(systemName)}
                </span>
            </h3>
            <button class="sc-modal-close"
                    id="scServersModalClose">&times;</button>
        </div>

        <div class="sc-servers-modal-body">
            <div class="sc-servers-modal-loading">
                <i class="fas fa-spinner fa-spin"
                style="color:#6366f1;font-size:1.2rem"></i>
                <span>טוען שרתים...</span>
            </div>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ─── אירועי סגירה ───
        const closeModal = () => modal.remove();
        document.getElementById('scServersModalClose')
            .addEventListener('click', closeModal);

        // ─── טען שרתים מהשרת ───
        try {

            // ─── בנה URL עם שני הפרמטרים ───
            const params = new URLSearchParams({ systemName });
            if (catalogNumber) params.append('catalogNumber', catalogNumber);

            const res = await fetch(
                `/Servers/GetServersBySystem?${params.toString()}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            const body = modal.querySelector('.sc-servers-modal-body');

            // ─── שרתים לא נמצאו ───
            if (!data.success || !data.servers || data.servers.length === 0) {
                body.innerHTML = `
            <div class="sc-servers-modal-empty">
                <i class="fas fa-server"></i>
                <div>
                    <div style="font-size:0.9rem;color:#888;
                                margin-bottom:6px">
                        לא נמצאו שרתים עבור המערכת
                        <strong style="color:#a5b4fc">
                            "${this.escHtml(systemName)}"
                        </strong>
                    </div>
                    <div style="font-size:0.78rem;color:#555">
                        ייתכן שהשרתים אינם משויכים למערכת זו
                    </div>
                </div>
            </div>


            ${(this.isAdmin || showGotoBtn) ? `
            <div class="sc-servers-modal-footer">

                ${this.isAdmin ? `
                <button class="sc-servers-assign-btn"
                        id="scAssignServersBtn"
                        data-system-name="${this.escHtml(systemName)}"
                        data-catalog-number="${this.escHtml(catalogNumber || '')}"
                        title="שייך שרתים נוספים למערכת זו">
                    <i class="fas fa-link"></i>
                    שייך שרתים
                </button>
                ` : ''}

                ${showGotoBtn ? `
                <button class="sc-servers-goto-btn"
                        onclick="
                            document.getElementById('scSystemServersModal')?.remove();
                            window._scDashboard._openInServersDashboard('${this.escHtml(systemName)}');">
                    <i class="fas fa-external-link-alt"></i>
                    ${displayLabel}
                </button>
                ` : ''}

            </div>` : ''}`;
                return;
            }

            const servers = data.servers;

            // ─── בנה סטטיסטיקות ───
            const total = servers.length;
            const prod = servers.filter(s =>
                s.environment === 'PROD').length;
            const nonProd = servers.filter(s =>
                s.environment === 'NONPROD').length;
            const virtual_ = servers.filter(s =>
                (s.isVirtual || '').toUpperCase() === 'TRUE').length;
            const healthy = servers.filter(s =>
                s.isHealthy === 'תקין').length;
            const unhealthy = servers.filter(s =>
                s.isHealthy === 'לא תקין').length;

            // ─── בנה שורות טבלה ───
            const rowsHtml = servers.map(s => {

                const envClass = s.environment === 'PROD'
                    ? 'srv-badge-prod' : 'srv-badge-nonprod';

                const healthClass = s.isHealthy === 'תקין'
                    ? 'srv-badge-healthy'
                    : s.isHealthy === 'לא תקין'
                        ? 'srv-badge-unhealthy'
                        : 'srv-badge-neutral';

                const virtIcon = (s.isVirtual || '')
                    .toUpperCase() === 'TRUE'
                    ? '☁️' : '🖥️';

                return `
            <tr class="sc-servers-modal-tr">
                <td class="sc-servers-modal-td
                        sc-servers-modal-td-name">
                    <i class="fas fa-server"
                    style="color:#555;font-size:0.7rem;
                            margin-left:5px"></i>
                    ${this.escHtml(s.name || '')}
                </td>
                <td class="sc-servers-modal-td
                        sc-servers-modal-td-center">
                    <span class="srv-badge ${envClass}">
                        ${this.escHtml(s.environment || '—')}
                    </span>
                </td>
                <td class="sc-servers-modal-td
                        sc-servers-modal-td-center">
                    ${virtIcon}
                </td>
                <td class="sc-servers-modal-td
                        sc-servers-modal-td-ip">
                    ${this.escHtml(s.scannedVia || '—')}
                </td>
                <td class="sc-servers-modal-td
                        sc-servers-modal-td-center">
                    <span class="srv-badge ${healthClass}">
                        ${this.escHtml(s.isHealthy || '—')}
                    </span>
                </td>
                <td class="sc-servers-modal-td
                        sc-servers-modal-td-center">
                    <span class="srv-badge srv-badge-neutral"
                        style="font-size:0.65rem">
                        ${this.escHtml(s.systemStatus || '—')}
                    </span>
                </td>
            </tr>`;
            }).join('');

            body.innerHTML = `

            <!-- ── סטטיסטיקות ── -->
            <div class="sc-servers-modal-stats">
                <div class="sc-servers-modal-stat"
                    style="color:#a5b4fc;
                            border-color:rgba(99,102,241,0.3)">
                    <i class="fas fa-server"></i>
                    <span>סה"כ: <strong>${total}</strong></span>
                </div>
                <div class="sc-servers-modal-stat"
                    style="color:#fca5a5;
                            border-color:rgba(239,68,68,0.3)">
                    <i class="fas fa-industry"></i>
                    <span>PROD: <strong>${prod}</strong></span>
                </div>
                <div class="sc-servers-modal-stat"
                    style="color:#fcd34d;
                            border-color:rgba(245,158,11,0.3)">
                    <i class="fas fa-flask"></i>
                    <span>NONPROD: <strong>${nonProd}</strong></span>
                </div>
                <div class="sc-servers-modal-stat"
                    style="color:#93c5fd;
                            border-color:rgba(59,130,246,0.3)">
                    <i class="fas fa-cloud"></i>
                    <span>וירטואלי: <strong>${virtual_}</strong></span>
                </div>
                ${healthy > 0 ? `
                <div class="sc-servers-modal-stat"
                    style="color:#86efac;
                            border-color:rgba(34,197,94,0.3)">
                    <i class="fas fa-heart"></i>
                    <span>תקין: <strong>${healthy}</strong></span>
                </div>` : ''}
                ${unhealthy > 0 ? `
                <div class="sc-servers-modal-stat"
                    style="color:#fca5a5;
                            border-color:rgba(239,68,68,0.4);
                            background:rgba(239,68,68,0.08)">
                    <i class="fas fa-heart-broken"></i>
                    <span>לא תקין: <strong>${unhealthy}</strong></span>
                </div>` : ''}
            </div>

            <!-- ── טבלת שרתים ── -->
            <div class="sc-servers-modal-table-wrap">
                <table class="sc-servers-modal-table">
                    <thead>
                        <tr>
                            <th class="sc-servers-modal-th">
                                שם שרת
                            </th>
                            <th class="sc-servers-modal-th
                                    sc-servers-modal-th-center">
                                סביבה
                            </th>
                            <th class="sc-servers-modal-th
                                    sc-servers-modal-th-center">
                                סוג
                            </th>
                            <th class="sc-servers-modal-th">
                                כתובת IP
                            </th>
                            <th class="sc-servers-modal-th
                                    sc-servers-modal-th-center">
                                תקינות
                            </th>
                            <th class="sc-servers-modal-th
                                    sc-servers-modal-th-center">
                                סטטוס
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            ${(this.isAdmin || showGotoBtn) ? `
            <div class="sc-servers-modal-footer">

                ${this.isAdmin ? `
                <button class="sc-servers-assign-btn"
                        id="scAssignServersBtn"
                        data-system-name="${this.escHtml(systemName)}"
                        data-catalog-number="${this.escHtml(catalogNumber || '')}"
                        title="שייך שרתים נוספים למערכת זו">
                    <i class="fas fa-link"></i>
                    שייך שרתים
                </button>
                ` : ''}

                ${showGotoBtn ? `
                <button class="sc-servers-goto-btn"
                        onclick="
                            document.getElementById('scSystemServersModal')?.remove();
                            window._scDashboard._openInServersDashboard('${this.escHtml(systemName)}');">
                    <i class="fas fa-external-link-alt"></i>
                    ${displayLabel}
                </button>
                ` : ''}

            </div>
            ` : ''}`;

        } catch (err) {
            console.error('openSystemServersModal error:', err);
            const body = modal.querySelector('.sc-servers-modal-body');
            if (body) {
                body.innerHTML = `
            <div class="sc-servers-modal-empty">
                <i class="fas fa-exclamation-triangle"
                style="color:#f59e0b"></i>
                <div style="color:#f87171">
                    שגיאה בטעינת שרתים: ${this.escHtml(err.message)}
                </div>
            </div>`;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // מעבר לדשבורד שרתים 
    // ══════════════════════════════════════════════════════════
    _openInServersDashboard(systemName) {
        // ─── מצא את מספר הקטלוג של המערכת ───
        const system = this.allSystems.find(s =>
            (s.name || '').toLowerCase() === (systemName || '').toLowerCase()
        );
        const catalogNumber = system?.number ? String(system.number) : null;

        if (window._srvDashboard) {
            // ─── סנן לפי מספר קטלוג אם קיים, אחרת לפי שם ───
            if (catalogNumber) {
                window._srvDashboard.filters.catalogNumber = catalogNumber;
                window._srvDashboard.filters.systemName = 'all';
            } else {
                window._srvDashboard.filters.systemName = systemName;
            }
            window._srvDashboard._savePreferences();
            window._srvDashboard.applyFiltersAndSort();
            window._srvDashboard.renderContent();
            window._srvDashboard.updateStats();

            const serversTab = document.querySelector(
                '[data-dashboard="servers"], [href*="servers"], #serversDashboardTab, .tab-servers'
            );
            if (serversTab) serversTab.click();

            window.scrollTo({ top: 0, behavior: 'smooth' });

            if (window._srvDashboard.showToast) {
                const label = catalogNumber
                    ? `מספר קטלוג: ${catalogNumber}`
                    : `מערכת: ${systemName}`;
                window._srvDashboard.showToast(`🔍 מסנן שרתים לפי ${label}`, 'info');
            }
            return;
        }

        // ─── דפים נפרדים ───
        try {
            if (catalogNumber) {
                sessionStorage.setItem('srv_pending_filter_catalogNumber', catalogNumber);
            } else {
                sessionStorage.setItem('srv_pending_filter_systemName', systemName);
            }
        } catch (e) { /* ignore */ }

        const filterParam = catalogNumber
            ? `filterNumber=${encodeURIComponent(catalogNumber)}`
            : `filterSystem=${encodeURIComponent(systemName)}`;

        window.location.href = `/dashboards?dashboard=servers&${filterParam}`;
    }

    // ══════════════════════════════════════════════════════════
    // פילטרי Dropdown
    // ══════════════════════════════════════════════════════════
    _populateDropdownFilters() {
        const buildOptions = (selectEl, defaultLabel, values, curVal) => {
            if (!selectEl) return;
            const hasEmpty = this.allSystems.some(s => {
                const key = Object.keys(this.filters).find(k => {
                    const idMap = {
                        status: 'scFltStatus',
                        domain: 'scFltDomain',
                        department: 'scFltDept',
                        team: 'scFltTeam',
                        businessDivision: 'scFltBizDiv',
                        appClassification: 'scFltAppClass',
                        appType: 'scFltAppType',
                        businessCriticality: 'scFltCriticality',
                        availabilityRequirement: 'scFltAvailability',
                        environment: 'scFltEnv',
                        publisher: 'scFltPublisher',
                        supportVendor: 'scFltVendor',
                        systemManager: 'scFltManager',
                    };
                    return idMap[k] === selectEl.id;
                });
                if (!key) return false;
                return !s[key] || s[key].trim() === '';
            });

            selectEl.innerHTML =
                `<option value="all">${defaultLabel}</option>` +
                values.map(v =>
                    `<option value="${this.escHtml(v)}"
                     ${curVal === v ? 'selected' : ''}>
                     ${this.escHtml(v)}
                     </option>`
                ).join('') +
                (hasEmpty
                    ? `<option value="__empty__"
                       ${curVal === '__empty__' ? 'selected' : ''}>
                       — ריק —</option>`
                    : '');
        };

        const getUnique = field => [...new Set(
            this.allSystems.map(s => s[field]).filter(Boolean)
        )].sort((a, b) => String(a).localeCompare(String(b), 'he'));

        const selectors = [
            { id: 'scFltStatus', field: 'status', label: 'כל הסטטוסים' },
            { id: 'scFltDomain', field: 'domain', label: 'כל התחומים' },
            { id: 'scFltDept', field: 'department', label: 'כל המחלקות' },
            { id: 'scFltTeam', field: 'team', label: 'כל הצוותים' },
            { id: 'scFltBizDiv', field: 'businessDivision', label: 'כל האגפים' },
            { id: 'scFltAppClass', field: 'appClassification', label: 'כל הסיווגים' },
            { id: 'scFltAppType', field: 'appType', label: 'כל הסוגים' },
            { id: 'scFltCriticality', field: 'businessCriticality', label: 'כל הרמות' },
            { id: 'scFltAvailability', field: 'availabilityRequirement', label: 'כל הדרישות' },
            { id: 'scFltEnv', field: 'environment', label: 'כל הסביבות' },
            { id: 'scFltPublisher', field: 'publisher', label: 'כל המפרסמים' },
            { id: 'scFltVendor', field: 'supportVendor', label: 'כל הספקים' },
            { id: 'scFltManager', field: 'systemManager', label: 'כל המנהלים' },
            { id: 'scFltDeptManager', field: 'departmentManager', label: 'כל מנהלי המחלקה' },
        ];

        selectors.forEach(({ id, field, label }) => {
            const el = document.getElementById(id);
            const cur = this.filters[field] || 'all';
            buildOptions(el, label, getUnique(field), cur);
        });

        // ─── פילטר אוטומציה - מיוחד (boolean) ───
        const autoEl = document.getElementById('scFltAutomation');
        if (autoEl) {
            const cur = this.filters.hasAutomation || 'all';
            autoEl.innerHTML =
                `<option value="all">הכל</option>` +
                `<option value="קיימות"      ${cur === 'קיימות' ? 'selected' : ''}>קיימות</option>` +
                `<option value="לא קיימות"   ${cur === 'לא קיימות' ? 'selected' : ''}>לא קיימות</option>` +
                `<option value="לא רלוונטי"  ${cur === 'לא רלוונטי' ? 'selected' : ''}>לא רלוונטי</option>`;
        }

        // ─── פילטר נדרש תיקוף ───
        const validationEl =
            document.getElementById('scFltRequiresValidation');

        if (validationEl) {
            const cur = this.filters.requiresValidation || 'all';

            validationEl.innerHTML = `
    <option value="all">הכל</option>
    <option value="נדרש תיקוף"
        ${cur === 'נדרש תיקוף' ? 'selected' : ''}>
        נדרש תיקוף
    </option>
    <option value="לא נדרש תיקוף"
        ${cur === 'לא נדרש תיקוף' ? 'selected' : ''}>
        לא נדרש תיקוף
    </option>
`;
        }

        this._renderActiveFilterTags();
    }

    _renderActiveFilterTags() {
        const container = document.getElementById('scActiveFilterTags');
        if (!container) return;

        const labelMap = {
            number: 'מס׳ קטלוג',
            status: 'סטטוס',
            domain: 'תחום',
            department: 'מחלקה',
            team: 'צוות',
            businessDivision: 'אגף עסקי',
            appClassification: 'סיווג יישום',
            appType: 'סוג יישום',
            businessCriticality: 'קריטיות',
            availabilityRequirement: 'זמינות',
            environment: 'סביבה',
            publisher: 'מפרסם',
            supportVendor: 'ספק תמיכה',
            systemManager: 'מנהל מערכת',
            departmentManager: 'מנהל מחלקה',
            requiresValidation: 'נדרש תיקוף',
        };

        const displayMap = { '__empty__': '— ריק —' };

        const activeTags = Object.entries(this.filters)
            .filter(([, val]) => val !== 'all')
            .map(([key, val]) => ({
                key,
                label: labelMap[key] || key,
                display: displayMap[val] || val,
            }));

        if (activeTags.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = activeTags.map(tag => `
            <span class="sc-active-tag"
                  data-filter-key="${this.escHtml(tag.key)}">
                <span class="sc-active-tag-label">
                    ${this.escHtml(tag.label)}:
                </span>
                <span class="sc-active-tag-value">
                    ${this.escHtml(tag.display)}
                </span>
                <button class="sc-active-tag-remove"
                        data-filter-key="${this.escHtml(tag.key)}"
                        title="הסר פילטר">
                    <i class="fas fa-times"></i>
                </button>
            </span>`).join('');
    }

    _restoreFilterSelects() {
        const map = {
            scFltNumber: this.filters.number,
            scFltStatus: this.filters.status,
            scFltDomain: this.filters.domain,
            scFltDept: this.filters.department,
            scFltTeam: this.filters.team,
            scFltBizDiv: this.filters.businessDivision,
            scFltAppClass: this.filters.appClassification,
            scFltAppType: this.filters.appType,
            scFltCriticality: this.filters.businessCriticality,
            scFltAvailability: this.filters.availabilityRequirement,
            scFltEnv: this.filters.environment,
            scFltPublisher: this.filters.publisher,
            scFltVendor: this.filters.supportVendor,
            scFltManager: this.filters.systemManager,
            scFltDeptManager: this.filters.departmentManager,
            scPageSize: String(this.pageSize),
        };

        Object.entries(map).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });
    }

    _updateFilterCounter() {
        const counter = document.getElementById('scCounter');
        if (!counter) return;

        const total = this.allSystems.length;
        const filtered = this.filteredSystems.length;
        counter.textContent = filtered < total
            ? `${filtered} / ${total} מערכות`
            : `${total} מערכות`;

        const activeCount = Object.values(this.filters)
            .filter(v => v !== 'all').length;

        const badge = document.getElementById('scFiltersBadge');
        if (badge) {
            badge.textContent = activeCount;
            badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
        }

        const toggleBtn = document.getElementById('scFiltersToggle');
        if (toggleBtn) {
            toggleBtn.classList.toggle('sc-filters-active', activeCount > 0);
        }

        this._renderActiveFilterTags();
    }

    // ══════════════════════════════════════════════════════════
    // עזרים
    // ══════════════════════════════════════════════════════════
    _getPaginationInfo() {
        const total = this.filteredSystems.length;
        const pages = Math.ceil(total / this.pageSize);
        const start = (this.currentPage - 1) * this.pageSize;
        const page = this.filteredSystems.slice(start, start + this.pageSize);
        return { page, total, pages };
    }

    _pageRange(cur, total) {
        const delta = 2;
        const range = [];
        const left = cur - delta;
        const right = cur + delta;

        for (let i = 1; i <= total; i++) {
            if (i === 1 || i === total || (i >= left && i <= right))
                range.push(i);
        }

        const result = [];
        let prev = null;
        for (const i of range) {
            if (prev && i - prev > 1) result.push('...');
            result.push(i);
            prev = i;
        }
        return result;
    }

    _updateViewBtns() {
        ['Table', 'Cards', 'Stats'].forEach(v => {
            const btn = document.getElementById(`scView${v}`);
            if (btn) btn.classList.toggle(
                'active', this.viewMode === v.toLowerCase()
            );
        });
    }

    _updateLastUpdate() {
        const el = document.getElementById('scLastUpdate');
        if (!el) return;
        const now = new Date();
        el.textContent =
            `עודכן: ${now.getHours().toString().padStart(2, '0')}:` +
            `${now.getMinutes().toString().padStart(2, '0')}`;
    }

    _groupBy(arr, keyFn) {
        return arr.reduce((acc, item) => {
            const k = keyFn(item) || 'לא ידוע';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
        }, {});
    }

    _getStatusClass(status) {
        if (!status) return 'sc-badge-neutral';
        const s = status.toLowerCase();
        if (s.includes('פעיל') && !s.includes('לא')) return 'sc-badge-active';
        if (s.includes('לא פעיל')) return 'sc-badge-inactive';
        if (s.includes('פיתוח')) return 'sc-badge-dev';
        if (s.includes('הקפאה') || s.includes('סגירה')) return 'sc-badge-frozen';
        return 'sc-badge-neutral';
    }

    _getCriticalityClass(crit) {
        if (!crit) return 'sc-badge-neutral';
        const c = crit.toLowerCase();
        if (c.includes('קריטי') || c.includes('גבוה')) return 'sc-badge-critical';
        if (c.includes('בינוני') || c.includes('medium')) return 'sc-badge-medium';
        if (c.includes('נמוך') || c.includes('low')) return 'sc-badge-low';
        return 'sc-badge-neutral';
    }

    _getEnvClass(env) {
        if (!env) return 'sc-badge-neutral';
        const e = env.toLowerCase();
        if (e.includes('prod') || e.includes('ייצור')) return 'sc-badge-prod';
        if (e.includes('dev') || e.includes('פיתוח')) return 'sc-badge-dev';
        if (e.includes('test') || e.includes('בדיקה')) return 'sc-badge-test';
        return 'sc-badge-neutral';
    }

    _savePreferences() {
        try {
            localStorage.setItem(this.LS_FILTERS,
                JSON.stringify(this.filters));
            localStorage.setItem(this.LS_SORT,
                JSON.stringify({
                    col: this.sortColumn,
                    dir: this.sortDirection
                }));
            localStorage.setItem(this.LS_VIEW, this.viewMode);
            localStorage.setItem(this.LS_PAGE_SIZE, String(this.pageSize));

            // ── חדש: עמודות ──
            localStorage.setItem(this.LS_COL_ORDER,
                JSON.stringify(this.columnOrder));
            localStorage.setItem(this.LS_COL_VISIBLE,
                JSON.stringify(this.visibleColumns));
        } catch (e) { /* ignore */ }
    }

    _loadPreferences() {
        try {
            const f = localStorage.getItem(this.LS_FILTERS);
            if (f) this.filters = { ...this.filters, ...JSON.parse(f) };

            const s = localStorage.getItem(this.LS_SORT);
            if (s) {
                const { col, dir } = JSON.parse(s);
                this.sortColumn = col || 'number';
                this.sortDirection = dir || 'asc';
            }

            const v = localStorage.getItem(this.LS_VIEW);
            if (v) this.viewMode = v;

            const ps = localStorage.getItem(this.LS_PAGE_SIZE);
            if (ps) this.pageSize = parseInt(ps) || 50;

            // ── חדש: עמודות ──
            const co = localStorage.getItem(this.LS_COL_ORDER);
            if (co) this.columnOrder = JSON.parse(co);

            const cv = localStorage.getItem(this.LS_COL_VISIBLE);
            if (cv) this.visibleColumns = {
                ...this.visibleColumns,
                ...JSON.parse(cv)
            };
        } catch (e) { /* ignore */ }
    }

    getColumnDefinitions() {
        return {
            number: { label: 'מספר', alwaysVisible: true, canReorder: true },
            name: { label: 'שם', alwaysVisible: false, canReorder: true },
            nameEn: { label: 'שם אנגלית', alwaysVisible: false, canReorder: true },
            description: { label: 'תיאור', alwaysVisible: false, canReorder: true },
            status: { label: 'סטטוס', alwaysVisible: false, canReorder: true },
            systemManager: { label: 'מנהל מערכת', alwaysVisible: false, canReorder: true },
            departmentManager: { label: 'מנהל מחלקה', alwaysVisible: false, canReorder: true },
            team: { label: 'צוות', alwaysVisible: false, canReorder: true },
            department: { label: 'מחלקה', alwaysVisible: false, canReorder: true },
            domain: { label: 'תחום', alwaysVisible: false, canReorder: true },
            businessDivision: { label: 'אגף עסקי', alwaysVisible: false, canReorder: true },
            appClassification: { label: 'סיווג יישום', alwaysVisible: false, canReorder: true },
            appType: { label: 'סוג יישום', alwaysVisible: false, canReorder: true },
            businessCriticality: { label: 'קריטיות עסקית', alwaysVisible: false, canReorder: true },
            availabilityRequirement: { label: 'דרישת זמינות', alwaysVisible: false, canReorder: true },
            environment: { label: 'סביבה', alwaysVisible: false, canReorder: true },
            publisher: { label: 'מפרסם', alwaysVisible: false, canReorder: true },
            supportVendor: { label: 'ספק תמיכה', alwaysVisible: false, canReorder: true },
            hasAutomation: { label: 'אוטומציה', alwaysVisible: false, canReorder: true },
            createdAt: { label: 'נוצר', alwaysVisible: false, canReorder: true },
            lastValidatedAt: { label: 'תיקוף אחרון', alwaysVisible: false, canReorder: true },
            requiresValidation: { label: 'נדרש תיקוף', alwaysVisible: false, canReorder: true },
            buttons: { label: '', alwaysVisible: true, canReorder: false }
        };
    }

    openColumnManagerModal() {
        const existing = document.getElementById('scCatalogColModal');
        if (existing) existing.remove();

        const defs = this.getColumnDefinitions();

        // רק עמודות שניתן לסדר מחדש, בסדר הנוכחי - ללא היפוך
        const reorderableCols = this.columnOrder
            .filter(col => defs[col] && defs[col].canReorder);

        const itemsHTML = reorderableCols.map(col => {          // ← הוסר .reverse()
            const isAlwaysVisible = defs[col].alwaysVisible;    // ← חדש
            return `
        <div class="sc-col-mgr-item"
             data-col="${col}"
             draggable="${!isAlwaysVisible}">
            <i class="fas fa-grip-vertical sc-col-mgr-grip"
               style="${isAlwaysVisible ? 'opacity:0.3;cursor:default' : ''}"></i>
            <input type="checkbox"
                   id="scCatalogCol-${col}"
                   ${this.visibleColumns[col] ? 'checked' : ''}
                   ${isAlwaysVisible ? 'disabled' : ''}
                   onchange="window._scDashboard
                       .toggleCatalogColumnVisibility(
                           '${col}', this.checked)">
            <label for="scCatalogCol-${col}"
                   style="${isAlwaysVisible
                    ? 'color:#6366f1;font-weight:700'
                    : ''}">
                ${defs[col].label}
                ${isAlwaysVisible
                    ? '<span style="font-size:0.65rem;color:#555;margin-right:4px">(חובה)</span>'
                    : ''}
            </label>
        </div>`
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'scCatalogColModal';
        modal.className = 'sc-modal-overlay';

        modal.innerHTML = `
    <div class="sc-modal" style="max-width:420px;width:95%">

        <div class="sc-modal-header"
             style="background:linear-gradient(
                        135deg,#1e1b4b,#312e81);
                    border-bottom:2px solid rgba(99,102,241,0.4)">
            <h3 class="sc-modal-title">
                <i class="fas fa-columns"
                   style="color:#a5b4fc"></i>
                ניהול עמודות
            </h3>
            <button class="sc-modal-close"
                    id="scCatalogColClose">&times;</button>
        </div>

        <div style="padding:10px 20px 6px;
                    background:rgba(99,102,241,0.06);
                    border-bottom:1px solid rgba(99,102,241,0.15);
                    font-size:0.78rem;color:#888;
                    display:flex;align-items:center;gap:6px">
            <i class="fas fa-info-circle"
               style="color:#6366f1"></i>
            <span>גרור לשינוי סדר • סמן/בטל לחשיפה/הסתרה</span>
        </div>

        <div id="scCatalogColList"
             style="padding:14px 18px;
                    overflow-y:auto;
                    max-height:55vh">
            ${itemsHTML}
        </div>

        <div class="sc-modal-footer"
             style="justify-content:space-between">
            <button onclick="window._scDashboard
                                 .resetCatalogColumnSettings()"
                    style="padding:7px 14px;
                           background:rgba(107,114,128,0.15);
                           border:1px solid rgba(107,114,128,0.35);
                           border-radius:6px;color:#9ca3af;
                           font-size:0.82rem;font-weight:600;
                           cursor:pointer;display:flex;
                           align-items:center;gap:5px;
                           font-family:inherit">
                <i class="fas fa-undo"></i> איפוס
            </button>
            <div style="display:flex;gap:8px">
                <button onclick="document.getElementById(
                                     'scCatalogColModal').remove()"
                        class="sc-modal-cancel-btn">
                    <i class="fas fa-times"></i> סגור
                </button>
                <button onclick="window._scDashboard
                                     .applyCatalogColumnSettings()"
                        style="padding:7px 16px;
                               background:linear-gradient(
                                   135deg,#4f46e5,#7c3aed);
                               border:none;border-radius:6px;
                               color:white;font-size:0.82rem;
                               font-weight:700;cursor:pointer;
                               display:flex;align-items:center;
                               gap:5px;font-family:inherit">
                    <i class="fas fa-check"></i> החל
                </button>
            </div>
        </div>
    </div>`;

        document.body.appendChild(modal);

        // ── Drag & Drop ──
        this._initCatalogColDragDrop();

        document.getElementById('scCatalogColClose')
            .addEventListener('click', () => modal.remove());
    }

    _initCatalogColDragDrop() {
        const list = document.getElementById('scCatalogColList');
        if (!list) return;

        const defs = this.getColumnDefinitions();
        let draggedItem = null;

        list.querySelectorAll('.sc-col-mgr-item').forEach(item => {
            const colName = item.getAttribute('data-col');
            const isAlwaysVisible = defs[colName]?.alwaysVisible;

            // ── מנע גרירה של עמודות חובה ──
            if (isAlwaysVisible) {
                item.setAttribute('draggable', 'false');
                return; // ← דלג על הוספת event listeners לגרירה
            }

            item.addEventListener('dragstart', e => {
                draggedItem = item;
                item.style.opacity = '0.5';
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
                draggedItem = null;
                list.querySelectorAll('.sc-col-mgr-item').forEach(i => {
                    i.style.borderColor = '';
                    i.style.background = '';
                });
            });

            item.addEventListener('dragover', e => {
                e.preventDefault();
                if (item !== draggedItem) {
                    item.style.borderColor = '#6366f1';
                    item.style.background = 'rgba(99,102,241,0.1)';
                }
            });

            item.addEventListener('dragleave', () => {
                item.style.borderColor = '';
                item.style.background = '';
            });

            item.addEventListener('drop', e => {
                e.preventDefault();
                if (draggedItem && item !== draggedItem) {
                    const all = [...list.querySelectorAll('.sc-col-mgr-item')];
                    const fromI = all.indexOf(draggedItem);
                    const toI = all.indexOf(item);
                    if (fromI < toI) list.insertBefore(draggedItem, item.nextSibling);
                    else list.insertBefore(draggedItem, item);
                }
                item.style.borderColor = '';
                item.style.background = '';
            });
        });
    }

    toggleCatalogColumnVisibility(colName, isVisible) {
        const defs = this.getColumnDefinitions();

        // ── מנע הסתרת עמודות חובה ──
        if (defs[colName]?.alwaysVisible) {
            // החזר את ה-checkbox למצב מסומן
            const cb = document.getElementById(`scCatalogCol-${colName}`);
            if (cb) cb.checked = true;
            this.showToast(`עמודת "${defs[colName].label}" חייבת להיות מוצגת`, 'info');
            return;
        }

        this.visibleColumns[colName] = isVisible;
    }

    applyCatalogColumnSettings() {
        const list = document.getElementById('scCatalogColList');
        if (!list) return;

        const defs = this.getColumnDefinitions();

        // קרא סדר חדש מה-DOM - ללא היפוך (הסדר ב-DOM הוא הסדר הנכון)
        const newReorderable = [...list.querySelectorAll('.sc-col-mgr-item')]
            .map(item => item.getAttribute('data-col'));
        // ← הוסר .reverse()

        // עמודות קבועות (לא ניתנות לסידור מחדש)
        const fixedCols = this.columnOrder
            .filter(col => defs[col] && !defs[col].canReorder);

        this.columnOrder = [...newReorderable, ...fixedCols];

        // ── ודא ש-number תמיד גלוי ──
        this.visibleColumns['number'] = true;   // ← חדש

        this._savePreferences();

        document.getElementById('scCatalogColModal')?.remove();
        this.renderContent();

        if (typeof this.showToast === 'function') {
            this.showToast('✅ הגדרות עמודות נשמרו', 'success');
        }
    }

    getDefaultColumns() {
        return {
            number: true,
            name: true,
            nameEn: true,
            description: true,
            status: true,
            systemManager: true,
            departmentManager: true,
            team: true,
            department: true,
            domain: true,
            businessDivision: true,
            appClassification: true,
            appType: true,
            businessCriticality: true,
            availabilityRequirement: true,
            environment: true,
            publisher: true,
            supportVendor: true,
            hasAutomation: false,
            createdAt: true,
            lastValidatedAt: false,
            requiresValidation: false,
            buttons: true
        };
    }

    resetCatalogColumnSettings() {
        this.visibleColumns = this.getDefaultColumns();
        this.columnOrder = Object.keys(this.visibleColumns);
        this._savePreferences();
        document.getElementById('scCatalogColModal')?.remove();
        this.renderContent();

        if (typeof this.showToast === 'function') {
            this.showToast('✅ עמודות אופסו לברירת מחדל', 'success');
        }
    }

    showToast(msg, type = 'info', duration = 3000) {
        // ─── הסר toast קיים ───
        const existing = document.getElementById('scToastFloating');
        if (existing) existing.remove();

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            info: 'fa-info-circle',
        };

        const colors = {
            success: { bg: '#166534', border: '#22c55e', color: '#4ade80' },
            error: { bg: '#7f1d1d', border: '#ef4444', color: '#fca5a5' },
            info: { bg: '#1e3a5f', border: '#3b82f6', color: '#93c5fd' },
        };

        const c = colors[type] || colors.info;
        const icon = icons[type] || icons.info;

        const toast = document.createElement('div');
        toast.id = 'scToastFloating';
        toast.style.cssText = `
        position: fixed;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        z-index: 9999999;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 22px;
        background: ${c.bg};
        border: 1.5px solid ${c.border};
        border-radius: 10px;
        color: ${c.color};
        font-size: 0.9rem;
        font-weight: 600;
        font-family: 'Segoe UI', Arial, sans-serif;
        direction: rtl;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        opacity: 0;
        transition: opacity 0.25s ease, transform 0.25s ease;
    `;

        toast.innerHTML = `
        <i class="fas ${icon}" style="font-size:1rem;flex-shrink:0"></i>
        <span>${msg}</span>
    `;

        document.body.appendChild(toast);

        // ─── אנימציה כניסה ───
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
        });

        // ─── הסר אחרי duration שניות ───
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    showLoading(show) {
        const el = document.getElementById('scLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
        const content = document.getElementById('scContent');
        if (content) content.style.opacity = show ? '0.4' : '1';
    }

    showError(msg) {
        const el = document.getElementById('scError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 6000);
        }
    }

    _cleanDescription(text) {
        if (!text) return '';
        // הסר נקודות מהתחלת הטקסט (כולל רווחים לפני/אחרי)
        return text.replace(/^[\s.]+/, '').trim();
    }

    escHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ══════════════════════════════════════════════════════════
    // סגנונות
    // ══════════════════════════════════════════════════════════
    addStyles() {
        if (document.getElementById('scStyles')) return;
        const style = document.createElement('style');
        style.id = 'scStyles';
        style.textContent = `
        .sc-root {
            background: #0f0f1a;
            color: #e0e0e0;
            font-family: 'Segoe UI', Arial, sans-serif;
            height: 95vh;
            display: flex;
            flex-direction: column;
            direction: rtl;
            overflow: hidden;
        }
        .sc-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            gap: 10px;
            flex-shrink: 0;
        }
        .sc-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            flex: 1;
        }
        .sc-header-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .sc-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .sc-search-icon {
            position: absolute;
            right: 9px;
            color: #666;
            font-size: 0.8rem;
            pointer-events: none;
        }
        .sc-search-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 7px 30px 7px 28px;
            font-size: 0.85rem;
            width: 240px;
            outline: none;
            transition: border-color 0.2s;
        }
        .sc-search-input:focus { border-color: #6366f1; }
        .sc-search-input::placeholder { color: #555; }
        .sc-clear-btn {
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
        .sc-clear-btn:hover { color: #ccc; }
        .sc-select {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 10px;
            font-size: 0.82rem;
            outline: none;
            cursor: pointer;
            direction: rtl;
        }
        .sc-select:focus { border-color: #6366f1; }
        .sc-select option { background: #252535; }
        .sc-import-btn {
            padding: 6px 14px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sc-import-btn:hover { background: rgba(99,102,241,0.28); }
        .sc-export-btn {
            padding: 6px 10px;
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.3);
            border-radius: 6px;
            color: #4ade80;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .sc-export-btn:hover { background: rgba(34,197,94,0.22); }
        .sc-refresh-btn {
            padding: 6px 10px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            transition: all 0.2s;
        }
        .sc-refresh-btn:hover { background: #303050; color: #ccc; }
        .sc-view-btns { display: flex; gap: 4px; }
        .sc-view-btn {
            padding: 6px 10px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #777;
            cursor: pointer;
            font-size: 0.82rem;
            transition: all 0.2s;
        }
        .sc-view-btn:hover { background: #303050; color: #ccc; }
        .sc-view-btn.active {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.5);
            color: #a5b4fc;
        }
        .sc-counter {
            font-size: 0.78rem;
            color: #888;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            padding: 3px 10px;
            white-space: nowrap;
        }
        .sc-last-update { font-size: 0.72rem; color: #555; white-space: nowrap; }
        .sc-stats-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 16px;
            background: #13132a;
            border-bottom: 1px solid #1e1e3a;
            flex-wrap: wrap;
            flex-shrink: 0;
        }
        .sc-stat-pill {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.78rem;
            padding: 3px 10px;
            border-radius: 10px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.08);
            color: #aaa;
        }
        .sc-stat-pill-clickable {
            cursor: pointer;
            transition: all 0.18s ease;
            user-select: none;
        }
        .sc-stat-pill-clickable:hover {
            transform: translateY(-1px);
            filter: brightness(1.2);
        }
        .sc-stat-pill-active { font-weight: 700; }
        .sc-stat-pill-clear {
            font-size: 0.6rem !important;
            opacity: 0.7;
            margin-right: 2px;
            padding: 1px 3px;
            border-radius: 50%;
            transition: all 0.15s;
            cursor: pointer;
        }
        .sc-stat-pill-clear:hover {
            opacity: 1;
            background: rgba(239,68,68,0.3);
            color: #fca5a5 !important;
        }
        .sc-error {
            margin: 8px 16px;
            padding: 8px 14px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 6px;
            color: #f87171;
            font-size: 0.85rem;
        }
        .sc-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 30px;
            color: #666;
            font-size: 0.9rem;
        }
        .sc-toast {
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
        .sc-toast-show { opacity:1; transform:translateX(-50%) translateY(0); }
        .sc-toast-success { background:#166534; border:1px solid #22c55e; color:#4ade80; }
        .sc-toast-error   { background:#7f1d1d; border:1px solid #ef4444; color:#fca5a5; }
        .sc-toast-info    { background:#1e3a5f; border:1px solid #3b82f6; color:#93c5fd; }
        .sc-scroll-wrapper {
            flex: 1;
            overflow-y: auto;
            overflow-x: auto;
            min-height: 0;
            direction: ltr;
        }
        .sc-scroll-wrapper::-webkit-scrollbar { width:7px; height:7px; }
        .sc-scroll-wrapper::-webkit-scrollbar-track { background:#111; }
        .sc-scroll-wrapper::-webkit-scrollbar-thumb {
            background:#333; border-radius:4px;
        }
        .sc-scroll-wrapper .sc-content,
        .sc-scroll-wrapper .sc-pagination { direction: rtl; }
        .sc-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
            table-layout: fixed;
        }
        .sc-th {
            position: sticky;
            top: 0;
            background: #1a1a2e;
            color: #aaa;
            padding: 10px 8px;
            text-align: center;
            font-weight: 600;
            font-size: 0.78rem;
            border-bottom: 2px solid #2a2a4e;
            cursor: pointer;
            white-space: nowrap;
            user-select: none;
            z-index: 20;
        }
        .sc-th:hover { color:#e0e0e0; background:#222240; }
        .sc-th.sorted { color:#a5b4fc; }
        .sc-th-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
        }
        .sc-th-label { flex:1; text-align:center; }
        .sc-th-sort-icon { font-size:0.65rem; color:#a5b4fc; }
        .sc-sort-icon-dim { opacity:0.25; font-size:0.65rem; }
        .sc-tr {
            border-bottom: 1px solid #1a1a2e;
            transition: background 0.15s;
        }
        .sc-tr:hover { background: rgba(99,102,241,0.07); }
        .sc-tr:nth-child(odd)  { background: #0f0f1a; }
        .sc-tr:nth-child(even) { background: rgba(255,255,255,0.045); }
        .sc-tr:nth-child(even):hover { background: rgba(99,102,241,0.07); }
        .sc-td {
            padding: 6px 8px;
            color: #ccc;
            vertical-align: middle;
            text-align: center;
        }
        .sc-td-center { text-align: center; }
        .sc-td-number {
            font-weight: 700;
            color: #a5b4fc;
            font-size: 0.8rem;
        }
        .sc-catalog-num-link {
            cursor: pointer;
            user-select: text;
            color: #a5b4fc;
            font-weight: 700;
            transition: all 0.15s;
            display: inline-block;
            padding: 1px 4px;
            border-radius: 4px;
        }

        .sc-catalog-num-link:hover {
            border-color: rgba(99,102,241,0.6);
            color: #c4b5fd;
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(99,102,241,0.3);
            text-decoration: underline dotted;
            text-underline-offset: 2px;
        }

        .sc-catalog-num-link:active {
            transform: translateY(0);
            box-shadow: none;
        }

        [data-theme="light"] .sc-catalog-num-link:hover {
            background: rgba(99,102,241,0.18);
            border-color: rgba(99,102,241,0.45);
            color: #3730a3;
        }
        .sc-td-name {
            font-weight: 600;
            color: #e0e0e0;
        }
        .sc-system-name {
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 160px;
        }

        /* ══ System Name Link ══ */
        .sc-system-name-link {
            cursor: pointer;
            color: #a5b4fc;
            text-decoration: underline dotted;
            text-underline-offset: 2px;
            transition: color 0.15s;
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .sc-system-name-link:hover {
            color: #c4b5fd;
            text-decoration: underline solid;
        }

        /* tooltip אינדיקטור */
        .sc-system-name-link::after {
            content: ' ↗';
            font-size: 0.6rem;
            opacity: 0;
            transition: opacity 0.15s;
            vertical-align: super;
        }

        .sc-system-name-link:hover::after {
            opacity: 0.6;
        }

        .sc-td-truncate {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 130px;
            cursor: default;
        }
        .sc-td-truncate[dir="ltr"] { direction:ltr; text-align:center; }
        .sc-td-desc { max-width: 180px; text-align: right; }
        .sc-desc-text {
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.78rem;
            color: #888;
        }
        /* ══ Column Header Filter ══ */
        .sc-th-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            position: relative;
        }
        .sc-th-label { flex:1; text-align:center; }
        .sc-th-actions {
            display: flex;
            align-items: center;
            gap: 1px;
            flex-shrink: 0;
        }
        .sc-th-filter-btn {
            background: none;
            border: none;
            color: #444;
            cursor: pointer;
            font-size: 0.6rem;
            padding: 1px 2px;
            border-radius: 1px;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            opacity: 0;
            line-height: 1;
        }
        .sc-th:hover .sc-th-filter-btn { opacity: 1; }
        .sc-th-filter-btn:hover {
            background: rgba(99,102,241,0.2);
            color: #a5b4fc;
        }
        .sc-th-filter-btn.sc-th-filter-active {
            opacity: 1 !important;
            color: #6366f1 !important;
            background: rgba(99,102,241,0.15);
        }
        .sc-th-filter-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: #6366f1;
            display: inline-block;
            flex-shrink: 0;
            box-shadow: 0 0 4px rgba(99,102,241,0.8);
        }
        .sc-th-filtered { color: #a5b4fc !important; }

        /* ══ Column Filter Popup ══ */
        .sc-th-filter-popup {
            position: absolute;
            top: calc(100% + 2px);
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.6);
            min-width: 200px;
            max-width: 280px;
            overflow: hidden;
        }
        @keyframes scDropIn {
            from { opacity:0; transform:translateX(-50%) translateY(-4px); }
            to   { opacity:1; transform:translateX(-50%) translateY(0); }
        }
        .sc-col-filter-inner { display:flex; flex-direction:column; }
        .sc-col-filter-search-wrap {
            position: relative;
            padding: 8px 10px 6px;
            border-bottom: 1px solid #2a2a4e;
        }
        .sc-col-filter-search-icon {
            position: absolute;
            right: 18px;
            top: 50%;
            transform: translateY(-50%);
            color: #555;
            font-size: 0.7rem;
            pointer-events: none;
            margin-top: 1px;
        }
        .sc-col-filter-search {
            width: 100%;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 5px 26px 5px 8px;
            font-size: 0.78rem;
            outline: none;
            box-sizing: border-box;
            direction: rtl;
            transition: border-color 0.2s;
        }
        .sc-col-filter-search:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
        .sc-col-filter-search::placeholder { color:#444; }
        .sc-col-filter-options {
            max-height: 220px;
            overflow-y: auto;
            padding: 4px;
        }
        .sc-col-filter-options::-webkit-scrollbar { width:5px; }
        .sc-col-filter-options::-webkit-scrollbar-track { background:#111; }
        .sc-col-filter-options::-webkit-scrollbar-thumb {
            background:#333; border-radius:3px;
        }
        .sc-col-filter-option {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 6px 10px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.78rem;
            color: #ccc;
            transition: background 0.12s;
            user-select: none;
        }
        .sc-col-filter-option:hover {
            background: rgba(99,102,241,0.12);
            color: #e0e0e0;
        }
        .sc-col-filter-option-active {
            background: rgba(99,102,241,0.18) !important;
            color: #a5b4fc !important;
            font-weight: 600;
        }
        .sc-col-filter-check {
            color: #6366f1;
            font-size: 0.65rem;
            flex-shrink: 0;
            width: 10px;
        }
        .sc-col-filter-dot {
            color: #333;
            font-size: 0.4rem;
            flex-shrink: 0;
            width: 10px;
        }
        .sc-col-filter-option-label {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sc-col-filter-option-count {
            font-size: 0.68rem;
            color: #555;
            background: rgba(255,255,255,0.05);
            padding: 1px 5px;
            border-radius: 8px;
            flex-shrink: 0;
            min-width: 20px;
            text-align: center;
        }
        .sc-col-filter-clear {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 12px;
            border-top: 1px solid #2a2a4e;
            color: #f87171;
            font-size: 0.75rem;
            cursor: pointer;
            transition: background 0.12s;
            font-weight: 600;
        }
        .sc-col-filter-clear:hover { background:rgba(239,68,68,0.1); }
        .sc-col-filter-clear i { font-size:0.65rem; }
        .sc-col-sort-indicator {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 7px 10px;
            background: rgba(99,102,241,0.08);
            color: #a5b4fc;
            font-size: 0.78rem;
            font-weight: 600;
        }
        .sc-col-sort-indicator i:first-child {
            color: #6366f1;
            font-size: 0.75rem;
            flex-shrink: 0;
        }
        .sc-col-sort-indicator span { flex:1; }
        .sc-col-sort-flip-btn {
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 5px;
            color: #818cf8;
            cursor: pointer;
            font-size: 0.65rem;
            padding: 3px 6px;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            gap: 3px;
            flex-shrink: 0;
        }
        .sc-col-sort-flip-btn:hover {
            background: rgba(99,102,241,0.28);
            border-color: rgba(99,102,241,0.6);
            color: #a5b4fc;
        }
        .sc-col-filter-divider {
            height: 1px;
            background: #2a2a4e;
            margin: 0;
        }

        .sc-date-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
            flex-shrink: 1;
            font-size: 0.75rem;
            color: #666;
        }
        .sc-td-date {
            white-space: nowrap;
            overflow: hidden;
            padding: 4px 6px !important;
        }
        .sc-badge {
            display: inline-block;
            padding: 2px 7px;
            border-radius: 10px;
            font-size: 0.68rem;
            font-weight: 600;
            white-space: nowrap;
        }
        /* Dark Mode - ניגודיות גבוהה יותר */
        .sc-badge-active   { background:rgba(34,197,94,0.18);  color:#86efac; border:1px solid rgba(34,197,94,0.45);  }
        .sc-badge-inactive { background:rgba(239,68,68,0.18);  color:#fca5a5; border:1px solid rgba(239,68,68,0.45);  }
        .sc-badge-critical { background:rgba(239,68,68,0.22);  color:#fca5a5; border:1px solid rgba(239,68,68,0.55); font-weight:700; }
        .sc-badge-medium   { background:rgba(245,158,11,0.18); color:#fcd34d; border:1px solid rgba(245,158,11,0.45); }
        .sc-badge-low      { background:rgba(34,197,94,0.15);  color:#86efac; border:1px solid rgba(34,197,94,0.35);  }
        .sc-badge-prod     { background:rgba(239,68,68,0.18);  color:#fca5a5; border:1px solid rgba(239,68,68,0.45);  }
        .sc-badge-neutral  { background:rgba(107,114,128,0.18);color:#d1d5db; border:1px solid rgba(107,114,128,0.4); }
        .sc-badge-type     { background:rgba(99,102,241,0.18); color:#c4b5fd; border:1px solid rgba(99,102,241,0.45); }
        .sc-badge-avail    { background:rgba(6,182,212,0.18);  color:#67e8f9; border:1px solid rgba(6,182,212,0.4);   }
        .sc-badge-env      { background:rgba(139,92,246,0.12); color:#c4b5fd; border:1px solid rgba(139,92,246,0.25);}
        .sc-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 80px 20px;
            color: #444;
            font-size: 1rem;
        }
        .sc-empty i { font-size:3rem; color:#333; }
        .sc-pagination {
            padding: 10px 16px;
            background: #13132a;
            border-top: 1px solid #1e1e3a;
            position: sticky;
            bottom: 0;
            z-index: 20;
        }
        .sc-pag-wrap {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
            direction: rtl;
        }
        .sc-pag-btn {
            min-width: 32px;
            height: 32px;
            padding: 0 8px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 5px;
            color: #aaa;
            cursor: pointer;
            font-size: 0.82rem;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .sc-pag-btn:hover:not(.disabled):not(.active) {
            background:#303050; color:#e0e0e0;
        }
        .sc-pag-btn.active {
            background:rgba(99,102,241,0.25);
            border-color:rgba(99,102,241,0.5);
            color:#a5b4fc; font-weight:700;
        }
        .sc-pag-btn.disabled { opacity:0.3; cursor:not-allowed; }
        .sc-pag-dots { color:#555; padding:0 4px; }
        .sc-pag-info {
            margin-right: auto;
            font-size: 0.75rem;
            color: #666;
            padding-right: 8px;
        }
        .sc-cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px,1fr));
            gap: 14px;
            padding: 16px;
        }
        .sc-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 10px;
            overflow: hidden;
            transition: transform 0.15s, box-shadow 0.15s;
        }
        .sc-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            border-color: rgba(99,102,241,0.3);
        }
        .sc-card-header {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 14px 10px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .sc-card-number {
            font-size: 0.72rem;
            font-weight: 700;
            color: #6366f1;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 6px;
            padding: 2px 7px;
            flex-shrink: 0;
        }
        .sc-card-title-wrap { flex:1; min-width:0; }
                .sc-card-name {
            font-size: 0.88rem;
            font-weight: 700;
            color: #e0e0e0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sc-card-name-en {
            font-size: 0.72rem;
            color: #666;
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            direction: ltr;
            text-align: left;
        }
        .sc-card-badges {
            display: flex;
            flex-direction: column;
            gap: 3px;
            align-items: flex-end;
            flex-shrink: 0;
        }
        .sc-card-desc {
            padding: 8px 14px;
            font-size: 0.75rem;
            color: #777;
            border-bottom: 1px dashed rgba(255,255,255,0.05);
            max-height: 80px;
            overflow-y: auto;
            overflow-x: hidden;
            line-height: 1.5;
            scrollbar-width: thin;
            scrollbar-color: #333 transparent;
        }

        .sc-card-desc::-webkit-scrollbar {
            width: 4px;
        }
        .sc-card-desc::-webkit-scrollbar-track {
            background: transparent;
        }
        .sc-card-desc::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }
        .sc-card-desc:hover::-webkit-scrollbar-thumb {
            background: #555;
        }
        .sc-card-body {
            padding: 10px 14px;
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .sc-card-row {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 0.78rem;
            color: #aaa;
        }
        .sc-card-row i {
            width: 14px;
            text-align: center;
            color: #555;
            font-size: 0.72rem;
            flex-shrink: 0;
        }
        .sc-card-footer {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            border-top: 1px solid rgba(255,255,255,0.05);
            flex-wrap: wrap;
        }
        .sc-card-edit-btn { margin-right: auto; }
        .sc-stats-view {
            padding: 5px;
            overflow-y: auto;
            height: calc(100vh - 160px);
        }
        .sc-kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px,1fr));
            gap: 12px;
            margin-bottom: 12px;
        }
        .sc-kpi-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 10px;
            padding: 7px 4px;
            text-align: center;
            transition: transform 0.15s;
        }
        .sc-kpi-card:hover { transform: translateY(-2px); }
        .sc-kpi-icon { font-size:1.1rem; margin-bottom:8px; }
        .sc-kpi-value { font-size:1.4rem; font-weight:700; line-height:1; margin-bottom:4px; }
        .sc-kpi-label { font-size:0.75rem; color:#888; }
        .sc-charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px,1fr));
            gap: 16px;
        }
        .sc-chart-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 5px;
            padding: 10px;
        }
        .sc-chart-title {
            font-size: 0.88rem;
            font-weight: 600;
            color: #aaa;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 7px;
        }
        .sc-chart-title i { color:#6366f1; }
        .sc-bar-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 4px;
        }
        .sc-bar-label {
            width: 140px;
            font-size: 0.75rem;
            color: #aaa;
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex-shrink: 0;
        }
        .sc-bar-track {
            flex: 1;
            height: 8px;
            background: rgba(255,255,255,0.06);
            border-radius: 4px;
            overflow: hidden;
        }
        .sc-bar-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.5s ease;
            min-width: 2px;
        }
        .sc-bar-count {
            width: 30px;
            font-size: 0.72rem;
            color: #888;
            text-align: left;
            flex-shrink: 0;
        }
        .sc-filters-wrap { position: relative; }
        .sc-filters-toggle-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .sc-filters-toggle-btn {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 7px 14px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #aaa;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .sc-filters-toggle-btn:hover { background:#303050; color:#e0e0e0; }
        .sc-filters-toggle-btn.sc-filters-active {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.5);
            color: #a5b4fc;
        }
        .sc-filters-chevron { font-size:0.7rem; transition:transform 0.2s; }
        .sc-filters-badge {
            background: #6366f1;
            color: white;
            font-size: 0.65rem;
            font-weight: 700;
            min-width: 16px;
            height: 16px;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 4px;
        }
        .sc-filters-popup {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            z-index: 9999;
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            padding: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            min-width: 640px;
            animation: scFadeIn 0.15s ease;
            direction: rtl;
        }
        @keyframes scFadeIn { from{opacity:0} to{opacity:1} }
        @keyframes scSlideIn {
            from{transform:translateY(-20px);opacity:0}
            to{transform:translateY(0);opacity:1}
        }
        .sc-filters-popup-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 1px solid #2a2a4e;
        }
        .sc-filters-popup-title {
            font-size: 0.88rem;
            font-weight: 700;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 7px;
        }
        .sc-filters-popup-title i { color:#6366f1; }
        .sc-clear-filters-btn {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 6px;
            color: #f87171;
            padding: 5px 10px;
            cursor: pointer;
            font-size: 0.82rem;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .sc-clear-filters-btn:hover { background:rgba(239,68,68,0.2); }
        .sc-filters-popup-grid {
            display: grid;
            grid-template-columns: repeat(3,1fr);
            gap: 12px;
        }
        .sc-filter-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .sc-filter-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: #777;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .sc-filter-group .sc-select { width:100%; }
        .sc-active-filter-tags {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-wrap: wrap;
        }
        .sc-active-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 6px 3px 4px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 12px;
            font-size: 0.73rem;
            color: #a5b4fc;
            white-space: nowrap;
            animation: scFadeIn 0.15s ease;
        }
        .sc-active-tag-label { color:#7c7caa; font-weight:600; font-size:0.7rem; }
        .sc-active-tag-value { color:#c4b5fd; font-weight:700; }
        .sc-active-tag-remove {
            background: none;
            border: none;
            color: #6366f1;
            cursor: pointer;
            padding: 1px 3px;
            border-radius: 50%;
            font-size: 0.58rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
        }
        .sc-active-tag-remove:hover {
            background: rgba(239,68,68,0.2);
            color: #f87171;
        }
        .sc-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: scFadeIn 0.2s ease;
        }
        .sc-modal {
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 12px;
            width: 90%;
            max-width: 780px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            animation: scSlideIn 0.2s ease;
            direction: rtl;
        }
        .sc-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #2a2a4e;
        }
        .sc-modal-title {
            font-size: 1rem;
            font-weight: 700;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
        }
        .sc-edit-name-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            background: rgba(245,158,11,0.15);
            border: 1px solid rgba(245,158,11,0.35);
            border-radius: 8px;
            color: #fcd34d;
            font-size: 0.82rem;
            font-weight: 700;
        }
        .sc-modal-close {
            background: none;
            border: none;
            color: #888;
            font-size: 22px;
            cursor: pointer;
            transition: color 0.2s;
        }
        .sc-modal-close:hover { color:#ccc; }
        .sc-modal-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .sc-edit-modal-body {
            max-height: 65vh;
            overflow-y: auto;
        }
        .sc-edit-modal-body::-webkit-scrollbar { width:6px; }
        .sc-edit-modal-body::-webkit-scrollbar-track { background:#111; }
        .sc-edit-modal-body::-webkit-scrollbar-thumb {
            background:#333; border-radius:3px;
        }
        .sc-edit-row {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            align-items: flex-end;
        }
        .sc-edit-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
            flex: 1;
            min-width: 130px;
        }
        .sc-edit-field-wide { flex:2; min-width:180px; }
        .sc-edit-field-full { width:100%; flex:none; }
        .sc-edit-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: #888;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .sc-edit-label i { color:#6366f1; font-size:0.68rem; }
        .sc-edit-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 7px 10px;
            font-size: 0.83rem;
            outline: none;
            transition: border-color 0.2s;
            direction: rtl;
            width: 100%;
            box-sizing: border-box;
            font-family: inherit;
        }
        .sc-edit-input:focus {
            border-color: #f59e0b;
            box-shadow: 0 0 0 2px rgba(245,158,11,0.15);
        }
        .sc-edit-input::placeholder { color:#444; font-size:0.78rem; }
        .sc-edit-select {
            width: 100%;
            padding: 7px 10px !important;
            font-size: 0.83rem !important;
        }
        .sc-edit-select:focus {
            border-color: #f59e0b !important;
            box-shadow: 0 0 0 2px rgba(245,158,11,0.15) !important;
        }
        .sc-form-textarea {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 8px 12px;
            font-size: 0.85rem;
            outline: none;
            resize: vertical;
            min-height: 60px;
            font-family: inherit;
            direction: rtl;
            transition: border-color 0.2s;
            width: 100%;
            box-sizing: border-box;
        }
        .sc-form-textarea:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
        .sc-modal-footer {
            display: flex;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid #2a2a4e;
            justify-content: flex-end;
        }
        .sc-modal-cancel-btn {
            padding: 8px 16px;
            background: transparent;
            border: 1px solid #444;
            border-radius: 6px;
            color: #999;
            font-size: 0.85rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sc-modal-cancel-btn:hover { background:#2a2a3a; color:#ccc; }
        .sc-edit-save-btn {
            padding: 8px 20px;
            background: linear-gradient(135deg,rgba(245,158,11,0.8),rgba(217,119,6,0.9));
            border: 1px solid rgba(245,158,11,0.6);
            border-radius: 6px;
            color: #1a1000;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sc-edit-save-btn:hover:not(:disabled) {
            box-shadow: 0 4px 14px rgba(245,158,11,0.35);
            transform: translateY(-1px);
        }
        .sc-edit-save-btn:disabled {
            background:#333; border-color:#444;
            color:#666; cursor:not-allowed;
        }

        .sc-copy-link-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }
        .sc-copy-link-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
            transform: translateY(-1px);
        }
        .sc-copy-link-btn i { font-size: 0.75rem; }
        .sc-row-edit-btn {
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            font-size: 0.72rem;
            padding: 3px 6px;
            border-radius: 4px;
            opacity: 0;
            transition: all 0.2s;
            vertical-align: middle;
        }
        /* Light Mode */
        [data-theme="light"] .sc-copy-link-btn {
            background: rgba(99, 102, 241, 0.18);
            border-color: rgba(99, 102, 241, 0.55);
            color: #4338ca;
        }

        [data-theme="light"] .sc-copy-link-btn:hover {
            background: rgba(99, 102, 241, 0.28);
            border-color: rgba(99, 102, 241, 0.75);
            color: #312e81;
        }
        .sc-tr:hover .sc-row-edit-btn { opacity:1; }
        .sc-row-edit-btn:hover {
            background: rgba(245,158,11,0.18);
            color: #fcd34d;
            opacity: 1;
        }

        /* ══ View Servers Button ══ */
        .sc-view-servers-btn {
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.3);
            border-radius: 5px;
            color: #a5b4fc;
            cursor: pointer;
            font-size: 0.72rem;
            padding: 3px 6px;
            transition: all 0.18s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .sc-view-servers-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(99,102,241,0.25);
        }

        [data-theme="light"] .sc-view-servers-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.2);
            color: #4338ca;
        }
        .sc-import-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: scFadeIn 0.2s ease;
            direction: rtl;
        }
        .sc-import-modal {
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 14px;
            width: 92%;
            max-width: 700px;
            max-height: 88vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            overflow: hidden;
            animation: scSlideIn 0.2s ease;
        }
        .sc-import-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: linear-gradient(135deg,#4f46e5,#7c3aed);
            flex-shrink: 0;
        }
        .sc-import-modal-title-wrap {
            display: flex;
            align-items: center;
            gap: 12px;
            color: white;
            font-size: 1.3rem;
        }
        .sc-import-modal-title {
            font-size: 1rem;
            font-weight: 700;
            color: white;
            margin: 0;
        }
        .sc-import-modal-subtitle {
            font-size: 0.75rem;
            color: rgba(255,255,255,0.7);
            margin-top: 2px;
        }
        .sc-import-modal-close {
            background: rgba(255,255,255,0.15);
            border: 2px solid rgba(255,255,255,0.25);
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 1.1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .sc-import-modal-close:hover { background:rgba(255,255,255,0.3); }
        .sc-import-stats-bar {
            display: flex;
            gap: 10px;
            padding: 12px 20px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            flex-shrink: 0;
        }
        .sc-import-stat {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.82rem;
            padding: 4px 12px;
            border-radius: 12px;
            font-weight: 600;
        }
        .sc-import-stat-total   { background:rgba(99,102,241,0.15); color:#a5b4fc; border:1px solid rgba(99,102,241,0.3); }
        .sc-import-stat-added   { background:rgba(34,197,94,0.12);  color:#86efac; border:1px solid rgba(34,197,94,0.3);  }
        .sc-import-stat-changed { background:rgba(245,158,11,0.12); color:#fcd34d; border:1px solid rgba(245,158,11,0.3); }
        .sc-import-overwrite-section {
            padding: 10px 20px;
            background: rgba(245,158,11,0.07);
            border-bottom: 1px solid rgba(245,158,11,0.2);
            flex-shrink: 0;
        }
        .sc-import-overwrite-label {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            user-select: none;
        }
        .sc-import-checkbox {
            width: 16px;
            height: 16px;
            accent-color: #f59e0b;
            cursor: pointer;
        }
        .sc-import-overwrite-text {
            font-size: 0.85rem;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            gap: 7px;
        }
        .sc-import-overwrite-hint {
            font-size: 0.75rem;
            color: #f59e0b;
            font-weight: 600;
        }
        .sc-import-tabs {
            display: flex;
            border-bottom: 2px solid #2a2a4e;
            flex-shrink: 0;
            background: #16162a;
        }
        .sc-import-tab {
            flex: 1;
            padding: 10px 8px;
            border: none;
            background: transparent;
            color: #777;
            cursor: pointer;
            font-size: 0.82rem;
            font-weight: 600;
            transition: all 0.2s;
            border-bottom: 3px solid transparent;
            margin-bottom: -2px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        }
        .sc-import-tab:hover { color:#ccc; background:rgba(255,255,255,0.04); }
        .sc-import-tab.active { color:#a5b4fc; border-bottom-color:#6366f1; background:rgba(99,102,241,0.08); }
        .sc-import-tab-added.active   { color:#86efac; border-bottom-color:#22c55e; }
        .sc-import-tab-changed.active { color:#fcd34d; border-bottom-color:#f59e0b; }
        .sc-import-table-wrap {
            overflow-y: auto;
            flex: 1;
            min-height: 0;
        }
        .sc-import-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
        }
        .sc-import-th {
            position: sticky;
            top: 0;
            background: #1a1a2e;
            color: #888;
            padding: 9px 12px;
            text-align: right;
            font-weight: 600;
            font-size: 0.75rem;
            border-bottom: 2px solid #2a2a4e;
            z-index: 5;
        }
        .sc-import-td {
            padding: 8px 12px;
            color: #ccc;
            vertical-align: middle;
            border-bottom: 1px solid #1a1a2e;
        }
        .sc-import-td-icon { text-align:center; width:36px; font-size:0.9rem; }
        .sc-import-row { transition: background 0.15s; }
        .sc-import-row:hover { background:rgba(255,255,255,0.03); }
        .sc-import-row-added   { border-right:3px solid #22c55e; }
        .sc-import-row-changed { border-right:3px solid #f59e0b; }
        .sc-import-badge-new {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: rgba(34,197,94,0.15);
            color: #86efac;
            border: 1px solid rgba(34,197,94,0.3);
        }
        .sc-import-badge-changed {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: rgba(245,158,11,0.15);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.3);
        }
        .sc-import-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 20px;
            border-top: 1px solid #2a2a4e;
            background: #16162a;
            flex-shrink: 0;
            gap: 12px;
            flex-wrap: wrap;
        }
        .sc-import-footer-info {
            font-size: 0.82rem;
            color: #888;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .sc-import-footer-btns { display:flex; gap:10px; }
        .sc-import-cancel-btn {
            padding: 8px 16px;
            background: transparent;
            border: 1px solid #444;
            border-radius: 7px;
            color: #999;
            font-size: 0.85rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sc-import-cancel-btn:hover { background:#2a2a3a; color:#ccc; }
        .sc-import-confirm-btn {
            padding: 8px 18px;
            background: linear-gradient(135deg,#4f46e5,#7c3aed);
            border: none;
            border-radius: 7px;
            color: white;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sc-import-confirm-btn:hover:not(:disabled) {
            background: linear-gradient(135deg,#4338ca,#6d28d9);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99,102,241,0.4);
        }
        .sc-import-confirm-btn:disabled {
            background:#333; color:#666; cursor:not-allowed;
        }

        .sc-stat-pill-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 18px;
            padding: 0 5px;
            background: rgba(255,255,255,0.15);
            border-radius: 9px;
            font-size: 0.68rem;
            font-weight: 700;
            margin: 0 2px;
        }

        .sc-stat-pill-clickable {
            cursor: pointer;
            transition: all 0.18s ease;
            user-select: none;
            position: relative;
        }

        .sc-stat-pill-clickable:hover {
            transform: translateY(-1px);
            filter: brightness(1.2);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .sc-stat-pill-clickable:active {
            transform: translateY(0);
        }

        .sc-stat-pill-active {
            font-weight: 700;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
        }

        .sc-stat-pill-clear {
            font-size: 0.6rem !important;
            opacity: 0.7;
            margin-right: 4px;
            padding: 2px 4px;
            border-radius: 50%;
            transition: all 0.15s;
            cursor: pointer;
        }

        .sc-stat-pill-clear:hover {
            opacity: 1;
            background: rgba(239,68,68,0.3);
            color: #fca5a5 !important;
            transform: scale(1.1);
        }

        /* ══ Servers Modal ══ */
        .sc-servers-modal {
            max-width: 700px;
            width: 95%;
        }

        .sc-servers-modal-header {
            border-bottom: 2px solid rgba(99,102,241,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05)
            ) !important;
        }

        .sc-servers-modal-name-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 8px;
            color: #a5b4fc;
            font-size: 0.82rem;
            font-weight: 700;
            margin-right: 6px;
        }

        /* ── Body ── */
        .sc-servers-modal-body {
            display: flex;
            flex-direction: column;
            max-height: 65vh;
            overflow: hidden;
        }

        /* ── Loading ── */
        .sc-servers-modal-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 40px;
            color: #666;
            font-size: 0.9rem;
        }

        /* ── Empty ── */
        .sc-servers-modal-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 14px;
            padding: 40px 20px;
            color: #555;
            text-align: center;
        }

        .sc-servers-modal-empty i {
            font-size: 2.5rem;
            color: #333;
        }

        /* ── Stats Bar ── */
        .sc-servers-modal-stats {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 16px;
            background: #13132a;
            border-bottom: 1px solid #1e1e3a;
            flex-wrap: wrap;
            flex-shrink: 0;
        }

        .sc-servers-modal-stat {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.78rem;
            padding: 3px 10px;
            border-radius: 10px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            white-space: nowrap;
        }

        .sc-servers-modal-stat i {
            font-size: 0.7rem;
        }

        /* ── Table ── */
        .sc-servers-modal-table-wrap {
            overflow-y: auto;
            flex: 1;
            min-height: 0;
        }

        .sc-servers-modal-table-wrap::-webkit-scrollbar {
            width: 6px;
        }
        .sc-servers-modal-table-wrap::-webkit-scrollbar-track {
            background: #111;
        }
        .sc-servers-modal-table-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        .sc-servers-modal-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
        }

        .sc-servers-modal-th {
            position: sticky;
            top: 0;
            background: #1a1a2e;
            color: #888;
            padding: 9px 12px;
            text-align: right;
            font-weight: 600;
            font-size: 0.75rem;
            border-bottom: 2px solid #2a2a4e;
            z-index: 5;
            white-space: nowrap;
        }

        .sc-servers-modal-th-center {
            text-align: center !important;
        }

        .sc-servers-modal-tr {
            border-bottom: 1px solid #1a1a2e;
            transition: background 0.12s;
        }

        .sc-servers-modal-tr:hover {
            background: rgba(99,102,241,0.06);
        }

        .sc-servers-modal-td {
            padding: 7px 12px;
            color: #ccc;
            vertical-align: middle;
        }

        .sc-servers-modal-td-name {
            font-weight: 600;
            color: #e0e0e0;
            white-space: nowrap;
        }

        .sc-servers-modal-td-center {
            text-align: center;
        }

        .sc-servers-modal-td-ip {
            font-family: monospace;
            font-size: 0.75rem;
            color: #888;
            white-space: nowrap;
        }

        /* ── Footer ── */
        .sc-servers-modal-footer {
            display: flex;
            justify-content: flex-end;
            padding: 12px 16px;
            border-top: 1px solid #2a2a4e;
            background: #16162a;
            flex-shrink: 0;
        }

        .sc-servers-goto-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 16px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 7px;
            color: #a5b4fc;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }

        .sc-servers-goto-btn:hover {
            background: rgba(99,102,241,0.28);
            border-color: rgba(99,102,241,0.65);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99,102,241,0.25);
        }

        /* ══ Gaps Button ══ */
        .sc-gaps-btn {
            padding: 6px 14px;
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.4);
            border-radius: 6px;
            color: #fcd34d;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .sc-gaps-btn:hover {
            background: rgba(245,158,11,0.22);
            border-color: rgba(245,158,11,0.6);
        }

        /* ══ Gaps Modal ══ */
        .sc-gaps-modal {
            max-width: 900px;
            width: 96%;
        }

        .sc-gaps-modal-header {
            border-bottom: 2px solid rgba(245,158,11,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(245,158,11,0.08),
                rgba(217,119,6,0.05)
            ) !important;
        }

        .sc-gaps-modal-body {
            display: flex;
            flex-direction: column;
            max-height: 75vh;
            overflow: hidden;
        }

        /* ── Loading / Error / Empty ── */
        .sc-gaps-loading,
        .sc-gaps-error,
        .sc-gaps-empty {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            padding: 50px 20px;
            color: #666;
            font-size: 0.9rem;
            text-align: center;
            flex-direction: column;
        }

        .sc-gaps-error {
            color: #f87171;
        }

        /* ── Summary Bar ── */
        .sc-gaps-summary-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            background: #13132a;
            border-bottom: 1px solid #1e1e3a;
            flex-wrap: wrap;
            flex-shrink: 0;
        }

        .sc-gaps-total-badge {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.82rem;
            font-weight: 700;
            color: #fcd34d;
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.3);
            border-radius: 10px;
            padding: 4px 12px;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .sc-gaps-summary-pills {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            flex: 1;
        }

        .sc-gaps-summary-pill {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.75rem;
            padding: 3px 10px;
            border-radius: 10px;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.08);
            cursor: pointer;
            transition: all 0.15s;
            user-select: none;
            white-space: nowrap;
        }

        .sc-gaps-summary-pill:hover {
            filter: brightness(1.3);
            transform: translateY(-1px);
        }

        .sc-gaps-summary-pill-active {
            font-weight: 700;
            box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
        }

        .sc-gaps-summary-count {
            font-size: 0.68rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 8px;
            min-width: 18px;
            text-align: center;
        }

        .sc-gaps-clear-filter-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 6px;
            color: #fca5a5;
            font-size: 0.75rem;
            cursor: pointer;
            transition: all 0.15s;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .sc-gaps-clear-filter-btn:hover {
            background: rgba(239,68,68,0.22);
        }

        /* ── Meta Info ── */
        .sc-gaps-meta {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 8px 16px;
            background: rgba(255,255,255,0.02);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.78rem;
            color: #666;
            flex-shrink: 0;
            flex-wrap: wrap;
        }

        .sc-gaps-meta span {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .sc-gaps-meta strong {
            color: #aaa;
        }

        /* ── Table ── */
        .sc-gaps-table-wrap {
            overflow-y: auto;
            flex: 1;
            min-height: 0;
        }

        .sc-gaps-table-wrap::-webkit-scrollbar { width: 6px; }
        .sc-gaps-table-wrap::-webkit-scrollbar-track { background: #111; }
        .sc-gaps-table-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        .sc-gaps-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
        }

        .sc-gaps-th {
            position: sticky;
            top: 0;
            background: #1a1a2e;
            color: #888;
            padding: 9px 12px;
            text-align: right;
            font-weight: 600;
            font-size: 0.75rem;
            border-bottom: 2px solid #2a2a4e;
            z-index: 5;
            white-space: nowrap;
        }

        .sc-gaps-tr {
            border-bottom: 1px solid #1a1a2e;
            transition: background 0.12s;
        }

        .sc-gaps-tr:hover {
            background: rgba(245,158,11,0.05);
        }

        .sc-gaps-td {
            padding: 8px 12px;
            color: #ccc;
            vertical-align: middle;
        }

        /* ── Type Badge ── */
        .sc-gaps-type-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 9px;
            border-radius: 8px;
            font-size: 0.72rem;
            font-weight: 700;
            border: 1px solid;
            white-space: nowrap;
        }

        /* ── Catalog Number ── */
        .sc-gaps-catalog-num {
            font-family: monospace;
            font-size: 0.8rem;
            font-weight: 700;
            color: #a5b4fc;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 5px;
            padding: 1px 6px;
        }

        /* ── Name Wrap ── */
        .sc-gaps-name-wrap {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .sc-gaps-name-catalog {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.8rem;
            color: #e0e0e0;
            font-weight: 600;
        }

        .sc-gaps-name-server {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.75rem;
            color: #f59e0b;
            opacity: 0.85;
        }

        /* ── Server Count ── */
        .sc-gaps-server-count {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.75rem;
            color: #888;
            cursor: help;
        }

        /* ── Empty Value ── */
        .sc-gaps-empty-val {
            color: #333;
            font-style: italic;
        }

        /* ── Action Buttons ── */
        .sc-gaps-td-action {
            white-space: nowrap;
        }

        .sc-gaps-edit-btn,
        .sc-gaps-view-servers-btn {
            background: none;
            border: 1px solid transparent;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.72rem;
            padding: 3px 7px;
            transition: all 0.15s;
            margin-left: 4px;
        }

        /* ══ Quick Fix Buttons ══ */
        .sc-gaps-quick-fix-catalog-btn,
        .sc-gaps-quick-fix-server-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 0.72rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.18s;
            border: 1px solid;
            font-family: inherit;
            white-space: nowrap;
            margin-left: 4px;
        }

        .sc-gaps-quick-fix-catalog-btn {
            background: rgba(99,102,241,0.12);
            border-color: rgba(99,102,241,0.35);
            color: #a5b4fc;
        }

        .sc-gaps-quick-fix-catalog-btn:hover:not(:disabled) {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
            transform: translateY(-1px);
            box-shadow: 0 3px 10px rgba(99,102,241,0.25);
        }

        .sc-gaps-quick-fix-server-btn {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.35);
            color: #fcd34d;
        }

        .sc-gaps-quick-fix-server-btn:hover:not(:disabled) {
            background: rgba(245,158,11,0.25);
            border-color: rgba(245,158,11,0.6);
            transform: translateY(-1px);
            box-shadow: 0 3px 10px rgba(245,158,11,0.2);
        }

        .sc-gaps-quick-fix-catalog-btn:disabled,
        .sc-gaps-quick-fix-server-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }

        .sc-gaps-quick-fix-catalog-btn i,
        .sc-gaps-quick-fix-server-btn i {
            font-size: 0.65rem;
        }

        /* Light mode */
        [data-theme="light"] .sc-gaps-quick-fix-catalog-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.25);
            color: #4338ca;
        }

        [data-theme="light"] .sc-gaps-quick-fix-server-btn {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.25);
            color: #b45309;
        }

        .sc-gaps-edit-btn {
            color: #f59e0b;
        }

        .sc-gaps-edit-btn:hover {
            background: rgba(245,158,11,0.15);
            border-color: rgba(245,158,11,0.4);
        }

        .sc-gaps-view-servers-btn {
            color: #6366f1;
        }

        .sc-gaps-view-servers-btn:hover {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.4);
        }

        /* ── Footer ── */
        .sc-gaps-footer {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            padding: 12px 16px;
            border-top: 1px solid #2a2a4e;
            background: #16162a;
            flex-shrink: 0;
        }

        .sc-gaps-export-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 16px;
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.35);
            border-radius: 7px;
            color: #86efac;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }

        .sc-gaps-export-btn:hover {
            background: rgba(34,197,94,0.22);
            border-color: rgba(34,197,94,0.55);
            transform: translateY(-1px);
        }

        .sc-gaps-refresh-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 7px;
            color: #aaa;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }

        .sc-gaps-refresh-btn:hover {
            background: rgba(255,255,255,0.1);
            color: #e0e0e0;
        }

        /* ===== LIGHT MODE — SystemsCatalogDashboard ===== */
        [data-theme="light"] .sc-root {
            background: #f0f2f5;
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-header {
            background: #f8f8ff;
            border-bottom: 2px solid #d0d0e8;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }

        [data-theme="light"] .sc-stats-bar {
            background: #f0f0fa;
            border-bottom: 1px solid #d0d0e8;
        }

        [data-theme="light"] .sc-search-input {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-search-input::placeholder { color: #aaa; }

        [data-theme="light"] .sc-select {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-select option { background: #fff; }

        [data-theme="light"] .sc-stats-bar {
            background: #e8e8f0;
            border-bottom: 1px solid #c8c8e0;
        }

        [data-theme="light"] .sc-stat-pill {
            background: #ffffff;
            border: 1px solid rgba(0,0,0,0.15);
            color: #374151;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        [data-theme="light"] .sc-stat-pill-clickable:hover {
            box-shadow: 0 3px 10px rgba(0,0,0,0.12);
        }

        [data-theme="light"] .sc-stat-pill-active {
            box-shadow: 0 0 0 2px rgba(99,102,241,0.25),
                        0 2px 6px rgba(0,0,0,0.1);
        }

        [data-theme="light"] .sc-table thead tr {
            background: #e8e8f0;
        }

        [data-theme="light"] .sc-th {
            background: #e8e8f0;
            color: #4a5568;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .sc-th:hover {
            color: #1a1a2e;
            background: #dde0f0;
        }

        [data-theme="light"] .sc-tr {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-tr:hover {
            background: rgba(99,102,241,0.05);
        }

        [data-theme="light"] .sc-tr:nth-child(odd)  { background: #ffffff; }
        [data-theme="light"] .sc-tr:nth-child(even) { background: #f3f4f8; }
        [data-theme="light"] .sc-tr:hover           { background: rgba(99,102,241,0.08) !important; }

        [data-theme="light"] .sc-td { color: #2d3748; }
        [data-theme="light"] .sc-td-name { color: #1a1a2e; }
        [data-theme="light"] .sc-td-truncate { color: #444; }
        [data-theme="light"] .sc-desc-text { color: #666; }
        [data-theme="light"] .sc-td-number { color: #4338ca; }

        [data-theme="light"] .sc-scroll-wrapper {
            background: #f0f2f5;
        }

        [data-theme="light"] .sc-pagination {
            background: #e8e8f0;
            border-top: 1px solid #c8c8e0;
        }

        [data-theme="light"] .sc-pag-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .sc-pag-btn:hover:not(.disabled):not(.active) {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .sc-pag-btn.active {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.4);
            color: #4338ca;
        }

        [data-theme="light"] .sc-counter {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .sc-last-update { color: #888; }

        [data-theme="light"] .sc-refresh-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .sc-refresh-btn:hover {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .sc-export-btn {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.3);
            color: #15803d;
        }

        [data-theme="light"] .sc-import-btn {
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.35);
            color: #4338ca;
        }
        [data-theme="light"] .sc-import-btn:hover {
            background: rgba(99,102,241,0.18);
        }

        [data-theme="light"] .sc-gaps-btn {
            background: rgba(245,158,11,0.1);
            border: 1px solid rgba(245,158,11,0.35);
            color: #b45309;
        }
        [data-theme="light"] .sc-gaps-btn:hover {
            background: rgba(245,158,11,0.18);
        }

        [data-theme="light"] .sc-add-system-btn {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.35);
            color: #15803d;
        }
        [data-theme="light"] .sc-add-system-btn:hover {
            background: rgba(34,197,94,0.18);
        }

        [data-theme="light"] #scAutoFillBulkBtn {
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.3);
            color: #4338ca;
        }
        [data-theme="light"] #scAutoFillBulkBtn:hover {
            background: rgba(99,102,241,0.16);
        }
        [data-theme="light"] .sc-view-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .sc-view-btn.active {
            background: rgba(99,102,241,0.12);
            border-color: rgba(99,102,241,0.4);
            color: #4338ca;
        }

        [data-theme="light"] .sc-filters-toggle-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .sc-filters-toggle-btn:hover {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .sc-filters-popup {
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .sc-filters-popup-header {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-filters-popup-title { color: #555; }
        [data-theme="light"] .sc-filter-label { color: #555; }

        [data-theme="light"] .sc-active-tag {
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.3);
            color: #4338ca;
        }

        [data-theme="light"] .sc-active-tag-label { color: #6366f1; }
        [data-theme="light"] .sc-active-tag-value { color: #4338ca; }

        [data-theme="light"] .sc-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .sc-modal-header {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-modal-title { color: #1a1a2e; }
        [data-theme="light"] .sc-modal-close { color: #888; }

        [data-theme="light"] .sc-modal-footer {
            border-top: 1px solid #eee;
            background: #f9f9f9;
        }

        [data-theme="light"] .sc-edit-input {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-edit-input::placeholder { color: #aaa; }

        [data-theme="light"] .sc-form-textarea {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-kpi-card {
            background: #fff;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .sc-kpi-label { color: #666; }

        [data-theme="light"] .sc-chart-card {
            background: #fff;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .sc-chart-title { color: #555; }
        [data-theme="light"] .sc-bar-label { color: #666; }

        [data-theme="light"] .sc-bar-track {
            background: rgba(0,0,0,0.08);
        }

        [data-theme="light"] .sc-bar-count { color: #666; }

        [data-theme="light"] .sc-empty { color: #aaa; }
        [data-theme="light"] .sc-empty i { color: #ccc; }

        [data-theme="light"] .sc-th-filter-popup {
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 8px 28px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .sc-col-filter-search {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-col-filter-option { color: #333; }

        [data-theme="light"] .sc-col-filter-option:hover {
            background: rgba(99,102,241,0.06);
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-col-filter-option-active {
            background: rgba(99,102,241,0.1) !important;
            color: #4338ca !important;
        }

        [data-theme="light"] .sc-col-filter-option-count {
            background: rgba(0,0,0,0.05);
            color: #888;
        }

        [data-theme="light"] .sc-col-filter-clear { color: #dc2626; }
        [data-theme="light"] .sc-col-filter-clear:hover {
            background: rgba(239,68,68,0.06);
        }

        [data-theme="light"] .sc-col-sort-indicator {
            background: rgba(99,102,241,0.06);
            color: #4338ca;
        }

        [data-theme="light"] .sc-col-sort-flip-btn {
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.25);
            color: #4338ca;
        }

        [data-theme="light"] .sc-col-sort-flip-btn:hover {
            background: rgba(99,102,241,0.18);
        }

        [data-theme="light"] .sc-col-filter-divider {
            background: #eee;
        }

        [data-theme="light"] .sc-system-name-link { color: #4338ca; }
        [data-theme="light"] .sc-system-name-link:hover { color: #3730a3; }

        [data-theme="light"] .sc-card {
            background: rgba(0,0,0,0.03);
            border: 1px solid rgba(0,0,0,0.08);
        }

        [data-theme="light"] .sc-card:hover {
            box-shadow: 0 6px 20px rgba(0,0,0,0.12);
            border-color: rgba(99,102,241,0.25);
        }

        [data-theme="light"] .sc-card-header {
            background: rgba(0,0,0,0.02);
            border-bottom: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .sc-card-number {
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .sc-card-name { color: #1a1a2e; }
        [data-theme="light"] .sc-card-name-en { color: #888; }

        [data-theme="light"] .sc-card-desc {
            color: #555;
            border-bottom: 1px dashed rgba(0,0,0,0.08);
        }

        [data-theme="light"] .sc-card-row { color: #555; }
        [data-theme="light"] .sc-card-row i { color: #888; }

        [data-theme="light"] .sc-card-footer {
            border-top: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .sc-import-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .sc-import-stats-bar {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .sc-import-table thead tr {
            background: #e8e8f0;
        }

        [data-theme="light"] .sc-import-th {
            background: #e8e8f0;
            color: #555;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .sc-import-td {
            color: #333;
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-import-row:hover {
            background: rgba(0,0,0,0.02);
        }

        [data-theme="light"] .sc-import-footer {
            background: #f0f0f8;
            border-top: 1px solid #ddd;
        }

        [data-theme="light"] .sc-import-footer-info { color: #666; }

        [data-theme="light"] .sc-import-overwrite-section {
            background: rgba(245,158,11,0.05);
            border-bottom: 1px solid rgba(245,158,11,0.15);
        }

        [data-theme="light"] .sc-import-overwrite-text { color: #333; }
        [data-theme="light"] .sc-import-overwrite-hint { color: #b45309; }

        [data-theme="light"] .sc-gaps-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .sc-gaps-modal-body {
            background: #fff;
        }

        [data-theme="light"] .sc-gaps-summary-bar {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .sc-gaps-total-badge {
            background: rgba(245,158,11,0.1);
            border: 1px solid rgba(245,158,11,0.3);
            color: #b45309;
        }

        [data-theme="light"] .sc-gaps-summary-pill {
            background: rgba(255,255,255,0.7);
            border: 1px solid rgba(0,0,0,0.1);
        }

        [data-theme="light"] .sc-gaps-meta {
            background: rgba(0,0,0,0.02);
            border-bottom: 1px solid rgba(0,0,0,0.05);
            color: #888;
        }

        [data-theme="light"] .sc-gaps-table-wrap {
            background: #fff;
        }

        [data-theme="light"] .sc-gaps-th {
            background: #e8e8f0;
            color: #555;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .sc-gaps-tr {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-gaps-tr:hover {
            background: rgba(245,158,11,0.03);
        }

        [data-theme="light"] .sc-gaps-td { color: #333; }

        [data-theme="light"] .sc-gaps-catalog-num {
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .sc-gaps-name-catalog { color: #1a1a2e; }
        [data-theme="light"] .sc-gaps-name-server { color: #b45309; }
        [data-theme="light"] .sc-gaps-server-count { color: #666; }
        [data-theme="light"] .sc-gaps-empty-val { color: #aaa; }

        [data-theme="light"] .sc-gaps-footer {
            background: #f0f0f8;
            border-top: 1px solid #ddd;
        }

        [data-theme="light"] .sc-gaps-loading,
        [data-theme="light"] .sc-gaps-error,
        [data-theme="light"] .sc-gaps-empty {
            color: #888;
        }

        [data-theme="light"] .sc-servers-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .sc-servers-modal-stats {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .sc-servers-modal-stat {
            background: rgba(255,255,255,0.7);
            border: 1px solid rgba(0,0,0,0.08);
        }

        [data-theme="light"] .sc-servers-modal-th {
            background: #e8e8f0;
            color: #555;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .sc-servers-modal-tr {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-servers-modal-tr:hover {
            background: rgba(99,102,241,0.04);
        }

        [data-theme="light"] .sc-servers-modal-td { color: #333; }
        [data-theme="light"] .sc-servers-modal-td-name { color: #1a1a2e; }
        [data-theme="light"] .sc-servers-modal-td-ip { color: #666; }

        [data-theme="light"] .sc-servers-modal-footer {
            background: #f0f0f8;
            border-top: 1px solid #ddd;
        }

        [data-theme="light"] .sc-servers-modal-empty { color: #888; }
        [data-theme="light"] .sc-servers-modal-loading { color: #888; }

        [data-theme="light"] .sc-date-text { color: #888; }

        /* ══ Light Mode - Badges ══ */
        [data-theme="light"] .sc-badge-active {
            background: rgba(34,197,94,0.12);
            color: #14532d;
            border: 1px solid rgba(34,197,94,0.4);
        }
        [data-theme="light"] .sc-badge-inactive {
            background: rgba(239,68,68,0.1);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.35);
        }
        [data-theme="light"] .sc-badge-critical {
            background: rgba(239,68,68,0.12);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.45);
            font-weight: 700;
        }
        [data-theme="light"] .sc-badge-medium {
            background: rgba(245,158,11,0.12);
            color: #92400e;
            border: 1px solid rgba(245,158,11,0.4);
        }
        [data-theme="light"] .sc-badge-low {
            background: rgba(34,197,94,0.1);
            color: #14532d;
            border: 1px solid rgba(34,197,94,0.3);
        }
        [data-theme="light"] .sc-badge-prod {
            background: rgba(239,68,68,0.1);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.35);
        }
        [data-theme="light"] .sc-badge-neutral {
            background: rgba(107,114,128,0.1);
            color: #374151;
            border: 1px solid rgba(107,114,128,0.35);
        }
        [data-theme="light"] .sc-badge-type {
            background: rgba(99,102,241,0.1);
            color: #4338ca;
            border: 1px solid rgba(99,102,241,0.3);
        }
        [data-theme="light"] .sc-badge-avail {
            background: rgba(6,182,212,0.1);
            color: #0e7490;
            border: 1px solid rgba(6,182,212,0.3);
        }
        [data-theme="light"] .sc-badge-dev {
            background: rgba(59,130,246,0.1);
            color: #1d4ed8;
            border: 1px solid rgba(59,130,246,0.3);
        }
        [data-theme="light"] .sc-badge-frozen {
            background: rgba(107,114,128,0.1);
            color: #374151;
            border: 1px solid rgba(107,114,128,0.3);
        }
        [data-theme="light"] .sc-badge-test {
            background: rgba(245,158,11,0.1);
            color: #92400e;
            border: 1px solid rgba(245,158,11,0.3);
        }
        @media (max-width:900px) {
            .sc-search-input { width:160px; }
            .sc-charts-grid  { grid-template-columns:1fr; }
            .sc-filters-popup { min-width:calc(100vw - 32px); }
            .sc-filters-popup-grid { grid-template-columns:1fr 1fr; }
        }
        @media (max-width:600px) {
            .sc-kpi-grid { grid-template-columns:repeat(2,1fr); }
            .sc-cards-grid { grid-template-columns:1fr; }
            .sc-filters-popup-grid { grid-template-columns:1fr; }
        }

        /* ══ Validate Link Popup ══ */
        .sc-validate-system-name {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            font-weight: 700;
            color: #e0e0e0;
            padding: 8px 12px;
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 8px;
        }

        .sc-validate-url-box {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            padding: 10px 14px;
            direction: ltr;
            text-align: left;
        }

        .sc-validate-url-text {
            font-family: monospace;
            font-size: 0.78rem;
            color: #a5b4fc;
            word-break: break-all;
            display: block;
        }

        .sc-validate-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .sc-validate-btn {
            flex: 1;
            min-width: 160px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 0.88rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            font-family: inherit;
            border: 1px solid;
            flex-direction: column;
            gap: 4px;
        }

        .sc-validate-btn i {
            font-size: 1.1rem;
        }

        .sc-validate-btn-copy {
            background: rgba(99,102,241,0.12);
            border-color: rgba(99,102,241,0.4);
            color: #a5b4fc;
        }

        .sc-validate-btn-copy:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.65);
            transform: translateY(-2px);
            box-shadow: 0 4px 14px rgba(99,102,241,0.25);
        }

        .sc-validate-btn-email {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.4);
            color: #fcd34d;
            text-align: center;
        }

        .sc-validate-btn-email:hover {
            background: rgba(245,158,11,0.25);
            border-color: rgba(245,158,11,0.65);
            transform: translateY(-2px);
            box-shadow: 0 4px 14px rgba(245,158,11,0.2);
        }

        .sc-validate-email-to {
            display: block;
            font-size: 0.72rem;
            opacity: 0.8;
            font-weight: 400;
            margin-top: 2px;
            direction: ltr;
        }

        .sc-validate-email-missing {
            display: block;
            font-size: 0.7rem;
            opacity: 0.6;
            font-weight: 400;
            margin-top: 2px;
        }

        .sc-validate-no-email-note {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(245,158,11,0.08);
            border: 1px solid rgba(245,158,11,0.2);
            border-radius: 8px;
            font-size: 0.78rem;
            color: #fcd34d;
            line-height: 1.5;
        }
        [data-theme="light"] .sc-validate-btn-email {
            background: rgba(245, 158, 11, 0.18);
            border-color: rgba(245, 158, 11, 0.55);
            color: #b45309;
        }

        [data-theme="light"] .sc-validate-btn-copy {
            background: rgba(99, 102, 241, 0.18);
            border-color: rgba(99, 102, 241, 0.55);
            color: #4338ca;
        }
        [data-theme="light"] .sc-validate-btn-email:hover {
            background: rgba(245, 158, 11, 0.28);
        }

        [data-theme="light"] .sc-validate-btn-copy:hover {
            background: rgba(99, 102, 241, 0.28);
        }
        /* Light mode */
        [data-theme="light"] .sc-validate-url-box {
            background: #f5f5f5;
            border: 1px solid #ccc;
        }

        [data-theme="light"] .sc-validate-url-text { color: #4338ca; }

        [data-theme="light"] .sc-validate-system-name {
            background: rgba(99,102,241,0.06);
            border: 1px solid rgba(99,102,241,0.15);
            color: #1a1a2e;
        }

        /* ══ Add System Button ══ */
        .sc-add-system-btn {
            padding: 6px 14px;
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.4);
            border-radius: 6px;
            color: #86efac;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .sc-add-system-btn:hover {
            background: rgba(34,197,94,0.22);
            border-color: rgba(34,197,94,0.6);
        }

        /* ══ Add Save Button ══ */
        .sc-add-save-btn {
            padding: 8px 20px;
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.8),
                rgba(22,163,74,0.9)
            );
            border: 1px solid rgba(34,197,94,0.6);
            border-radius: 6px;
            color: #052e16;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sc-add-save-btn:hover:not(:disabled) {
            box-shadow: 0 4px 14px rgba(34,197,94,0.35);
            transform: translateY(-1px);
        }
        .sc-add-save-btn:disabled {
            background: #333;
            border-color: #444;
            color: #666;
            cursor: not-allowed;
        }

        /* Light mode */
        [data-theme="light"] .sc-add-system-btn {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.3);
            color: #15803d;
        }
        [data-theme="light"] .sc-add-save-btn {
            color: #fff;
        }
        /* ══ Automation Column ══ */
        .sc-td-automation {
            white-space: nowrap;
        }

        .sc-automation-cell {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
        }

        .sc-badge-automation-yes {
            background: rgba(34,197,94,0.12);
            color: #4ade80;
            border: 1px solid rgba(34,197,94,0.3);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .sc-badge-automation-no {
            background: rgba(107,114,128,0.1);
            color: #555;
            border: 1px solid rgba(107,114,128,0.2);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        /* ══ Automation Toggle ══ */
        .sc-automation-toggle-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .sc-automation-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
        }

        .sc-automation-checkbox {
            display: none;
        }

        .sc-automation-slider {
            position: relative;
            width: 40px;
            height: 22px;
            background: #3a3a5a;
            border-radius: 11px;
            transition: background 0.2s;
            flex-shrink: 0;
        }

        .sc-automation-slider::after {
            content: '';
            position: absolute;
            top: 3px;
            left: 3px;
            width: 16px;
            height: 16px;
            background: #888;
            border-radius: 50%;
            transition: transform 0.2s, background 0.2s;
        }

        .sc-automation-checkbox:checked + .sc-automation-slider {
            background: rgba(34,197,94,0.3);
            border: 1px solid rgba(34,197,94,0.5);
        }

        .sc-automation-checkbox:checked + .sc-automation-slider::after {
            transform: translateX(18px);
            background: #4ade80;
        }

        .sc-automation-toggle-label {
            font-size: 0.82rem;
            font-weight: 600;
            color: #888;
            min-width: 20px;
            transition: color 0.2s;
        }

        .sc-automation-checkbox:checked ~ .sc-automation-toggle-label {
            color: #4ade80;
        }

        .sc-edit-row-automation {
            align-items: center;
            padding: 8px 0;
            border-top: 1px dashed rgba(99,102,241,0.2);
            margin-top: 4px;
        }

        /* Light mode */
        [data-theme="light"] .sc-badge-automation-yes {
            background: rgba(34,197,94,0.1);
            color: #15803d;
            border: 1px solid rgba(34,197,94,0.25);
        }

        [data-theme="light"] .sc-badge-automation-no {
            background: rgba(107,114,128,0.08);
            color: #888;
            border: 1px solid rgba(107,114,128,0.15);
        }

        [data-theme="light"] .sc-automation-slider {
            background: #ddd;
        }

        [data-theme="light"] .sc-automation-slider::after {
            background: #aaa;
        }
        /* ══ Import Automation Modal ══ */
        .sc-auto-import-modal {
            max-width: 760px;
        }

        .sc-auto-import-header {
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.15),
                rgba(16,185,129,0.1)
            ) !important;
            border-bottom: 2px solid rgba(34,197,94,0.35) !important;
        }

        /* ── Stats Bar ── */
        .sc-auto-import-stats {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            flex-shrink: 0;
        }

        .sc-auto-stat {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.8rem;
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 12px;
            border: 1px solid;
            white-space: nowrap;
        }

        .sc-auto-stat-total {
            background: rgba(99,102,241,0.12);
            border-color: rgba(99,102,241,0.3);
            color: #a5b4fc;
        }

        .sc-auto-stat-found {
            background: rgba(34,197,94,0.12);
            border-color: rgba(34,197,94,0.3);
            color: #86efac;
        }

        .sc-auto-stat-notfound {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.3);
            color: #fcd34d;
        }

        .sc-auto-stat-yes {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.25);
            color: #4ade80;
        }

        .sc-auto-stat-no {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #fca5a5;
        }

        .sc-auto-stat-na {
            background: rgba(245,158,11,0.1);
            border-color: rgba(245,158,11,0.25);
            color: #fcd34d;
        }

        /* ── Table Rows ── */
        .sc-auto-import-row { transition: background 0.12s; }
        .sc-auto-import-row:hover { background: rgba(255,255,255,0.03); }

        .sc-auto-row-found {
            border-right: 3px solid rgba(34,197,94,0.5);
        }

        .sc-auto-row-notfound {
            border-right: 3px solid rgba(245,158,11,0.5);
            opacity: 0.65;
        }

        /* ── Table Cells ── */
        .sc-auto-import-td {
            padding: 8px 12px;
            color: #ccc;
            vertical-align: middle;
            border-bottom: 1px solid #1a1a2e;
            font-size: 0.82rem;
        }

        .sc-auto-import-td-center { text-align: center; }

        .sc-auto-import-td-num {
            font-family: monospace;
            font-weight: 700;
        }

        .sc-auto-import-td-note {
            font-size: 0.75rem;
            color: #777;
            max-width: 200px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ── Catalog Number Badge ── */
        .sc-auto-catalog-num {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.8rem;
            font-weight: 700;
        }

        /* ── System Name ── */
        .sc-auto-system-name {
            font-weight: 600;
            color: #e0e0e0;
        }

        .sc-auto-not-found {
            font-size: 0.75rem;
            color: #f59e0b;
            font-style: italic;
        }

        /* ── Status Badges ── */
        .sc-auto-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 0.72rem;
            font-weight: 700;
            border: 1px solid;
            white-space: nowrap;
        }

        .sc-auto-badge-yes {
            background: rgba(34,197,94,0.12);
            border-color: rgba(34,197,94,0.3);
            color: #4ade80;
        }

        .sc-auto-badge-no {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #fca5a5;
        }

        .sc-auto-badge-na {
            background: rgba(245,158,11,0.1);
            border-color: rgba(245,158,11,0.25);
            color: #fcd34d;
        }

        /* ── Template Bar ── */
        .sc-auto-import-template-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 20px;
            background: rgba(99,102,241,0.06);
            border-top: 1px solid rgba(99,102,241,0.15);
            border-bottom: 1px solid rgba(99,102,241,0.15);
            font-size: 0.78rem;
            color: #888;
            flex-shrink: 0;
            flex-wrap: wrap;
        }

        .sc-auto-import-template-bar strong { color: #a5b4fc; }

        .sc-auto-template-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 12px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.78rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
            white-space: nowrap;
            margin-right: auto;
        }

        .sc-auto-template-btn:hover {
            background: rgba(99,102,241,0.22);
            border-color: rgba(99,102,241,0.55);
            transform: translateY(-1px);
        }

        /* ── Confirm Button ── */
        .sc-auto-import-confirm-btn {
            padding: 8px 18px;
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.8),
                rgba(16,185,129,0.9)
            );
            border: none;
            border-radius: 7px;
            color: #052e16;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            font-family: inherit;
        }

        .sc-auto-import-confirm-btn:hover:not(:disabled) {
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.95),
                rgba(16,185,129,1)
            );
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(34,197,94,0.35);
        }

        .sc-auto-import-confirm-btn:disabled {
            background: #333;
            color: #666;
            cursor: not-allowed;
        }

        /* ── Import Auto Button (Header) ── */
        .sc-import-auto-btn {
            padding: 6px 14px;
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.35);
            border-radius: 6px;
            color: #86efac;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .sc-import-auto-btn:hover {
            background: rgba(34,197,94,0.2);
            border-color: rgba(34,197,94,0.55);
        }

        /* ── Automation Badge (3 states) ── */
        .sc-badge-automation-na {
            background: rgba(245,158,11,0.1);
            color: #9d8843;
            border: 1px solid rgba(245,158,11,0.25);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        /* ── Tabs ── */
        .sc-auto-tab-found.active {
            color: #86efac;
            border-bottom-color: #22c55e;
            background: rgba(34,197,94,0.08);
        }

        .sc-auto-tab-notfound.active {
            color: #fcd34d;
            border-bottom-color: #f59e0b;
            background: rgba(245,158,11,0.08);
        }

        /* ── Light Mode ── */
        [data-theme="light"] .sc-auto-import-header {
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.08),
                rgba(16,185,129,0.05)
            ) !important;
            border-bottom: 2px solid rgba(34,197,94,0.25) !important;
        }

        [data-theme="light"] .sc-auto-import-stats {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .sc-auto-import-td {
            color: #333;
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .sc-auto-import-row:hover {
            background: rgba(0,0,0,0.02);
        }

        [data-theme="light"] .sc-auto-catalog-num {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .sc-auto-system-name { color: #1a1a2e; }
        [data-theme="light"] .sc-auto-not-found   { color: #b45309; }

        [data-theme="light"] .sc-auto-import-template-bar {
            background: rgba(99,102,241,0.04);
            border-color: rgba(99,102,241,0.1);
            color: #666;
        }

        [data-theme="light"] .sc-auto-import-template-bar strong {
            color: #4338ca;
        }

        [data-theme="light"] .sc-auto-template-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.25);
            color: #4338ca;
        }

        [data-theme="light"] .sc-auto-template-btn:hover {
            background: rgba(99,102,241,0.15);
        }

        [data-theme="light"] .sc-import-auto-btn {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.25);
            color: #15803d;
        }

        [data-theme="light"] .sc-import-auto-btn:hover {
            background: rgba(34,197,94,0.15);
        }

        [data-theme="light"] .sc-badge-automation-yes {
            background: rgba(34,197,94,0.1);
            color: #15803d;
            border-color: rgba(34,197,94,0.25);
        }

        [data-theme="light"] .sc-badge-automation-no {
            background: rgba(107,114,128,0.08);
            color: #666;
            border-color: rgba(107,114,128,0.15);
        }

        [data-theme="light"] .sc-badge-automation-na {
            background: rgba(245,158,11,0.08);
            color: #b45309;
            border-color: rgba(245,158,11,0.2);
        }

        [data-theme="light"] .sc-auto-badge-yes {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.25);
            color: #15803d;
        }

        [data-theme="light"] .sc-auto-badge-no {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.2);
            color: #dc2626;
        }

        [data-theme="light"] .sc-auto-badge-na {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.2);
            color: #b45309;
        }

        [data-theme="light"] .sc-auto-stat-total {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .sc-auto-stat-found {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.2);
            color: #15803d;
        }

        [data-theme="light"] .sc-auto-stat-notfound {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.2);
            color: #b45309;
        }

        [data-theme="light"] .sc-auto-stat-yes {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.2);
            color: #15803d;
        }

        [data-theme="light"] .sc-auto-stat-no {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.2);
            color: #dc2626;
        }

        [data-theme="light"] .sc-auto-stat-na {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.2);
            color: #b45309;
        }

        [data-theme="light"] .sc-auto-row-found {
            border-right: 3px solid rgba(34,197,94,0.4);
        }

        [data-theme="light"] .sc-auto-row-notfound {
            border-right: 3px solid rgba(245,158,11,0.4);
        }

        [data-theme="light"] .sc-auto-import-confirm-btn {
            color: #fff;
        }

        /* ══ Server Search Banner ══ */
        .sc-server-search-banner {
            padding: 8px 16px;
            background: rgba(99,102,241,0.08);
            border-bottom: 1px solid rgba(99,102,241,0.25);
            flex-shrink: 0;
            animation: scFadeIn 0.2s ease;
        }

        .sc-server-search-banner-inner {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.82rem;
            color: #aaa;
            direction: rtl;
        }

        .sc-server-search-banner-text {
            flex: 1;
        }

        .sc-server-search-name {
            color: #a5b4fc;
            font-weight: 700;
            font-family: monospace;
            background: rgba(99,102,241,0.12);
            padding: 1px 6px;
            border-radius: 4px;
        }

        .sc-server-search-ip {
            color: #6b7280;
            font-family: monospace;
            font-size: 0.75rem;
        }

        .sc-server-search-clear {
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            transition: all 0.15s;
        }

        .sc-server-search-clear:hover {
            background: rgba(239,68,68,0.15);
            color: #f87171;
        }

        /* Light mode */
        [data-theme="light"] .sc-server-search-banner {
            background: rgba(99,102,241,0.05);
            border-bottom: 1px solid rgba(99,102,241,0.15);
        }

        [data-theme="light"] .sc-server-search-banner-inner { color: #555; }
        [data-theme="light"] .sc-server-search-name { color: #4338ca; }
        /* ══ Auto-fill Button ══ */
        .sc-autofill-btn {
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.3);
            border-radius: 4px;
            color: #818cf8;
            cursor: pointer;
            font-size: 0.65rem;
            padding: 2px 6px;
            margin-right: 5px;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            vertical-align: middle;
            line-height: 1;
        }
        .sc-autofill-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
            color: #a5b4fc;
            transform: scale(1.08);
        }
        .sc-autofill-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        /* ── שדה שמולא אוטומטית ── */
        .sc-autofilled {
            border-color: #6366f1 !important;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.25) !important;
            background: rgba(99,102,241,0.06) !important;
        }
        /* ══ Bulk Confirm Modal - Systems Catalog ══ */
        .sc-bulk-field-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px dashed rgba(255,255,255,0.05);
            font-size: 0.82rem;
        }
        .sc-bulk-field-row:last-child { border-bottom: none; }
        .sc-bulk-field-label { color: #ccc; }
        .sc-bulk-field-count {
            color: #a5b4fc;
            font-weight: 700;
            font-size: 0.78rem;
        }
        .sc-bulk-sample-td {
            padding: 5px 10px;
            color: #ccc;
            vertical-align: middle;
            max-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            border-bottom: 1px solid #1a1a2e;
        }
        .sc-bulk-old-val {
            color: #fca5a5;
            text-decoration: line-through;
            opacity: 0.8;
        }
        .sc-bulk-new-val {
            color: #86efac;
            font-weight: 600;
        }

        /* ══ Bulk Auto-fill Button ══ */
        #scAutoFillBulkBtn {
            padding: 6px 12px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        #scAutoFillBulkBtn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.65);
            transform: translateY(-1px);
        }
        /* ══════════════════════════════════════════════════════════
        CATALOG COLUMN MANAGER MODAL
        ══════════════════════════════════════════════════════════ */

        /* כפתור ניהול עמודות בקטלוג */
        .sc-col-manager-btn {
            padding: 6px 10px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .sc-col-manager-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
            transform: translateY(-1px);
            box-shadow: 0 3px 10px rgba(99,102,241,0.25);
        }

        /* פריט עמודה בתוך המודל */
        .sc-col-mgr-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 9px 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 7px;
            margin-bottom: 6px;
            cursor: grab;
            user-select: none;
            transition: background 0.15s, border-color 0.15s;
        }

        .sc-col-mgr-item:hover {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.25);
        }

        .sc-col-mgr-item:last-child { margin-bottom: 0; }

        /* אייקון גרירה */
        .sc-col-mgr-grip {
            color: #444;
            font-size: 0.75rem;
            cursor: grab;
            flex-shrink: 0;
            transition: color 0.15s;
        }

        .sc-col-mgr-item:hover .sc-col-mgr-grip { color: #6366f1; }

        /* Checkbox */
        .sc-col-mgr-item input[type="checkbox"] {
            width: 15px;
            height: 15px;
            accent-color: #6366f1;
            cursor: pointer;
            flex-shrink: 0;
        }

        /* תווית */
        .sc-col-mgr-item label {
            flex: 1;
            font-size: 0.85rem;
            color: #ccc;
            cursor: pointer;
            margin: 0;
            transition: color 0.15s;
        }

        .sc-col-mgr-item:hover label { color: #e0e0e0; }

        .sc-col-mgr-item input[type="checkbox"]:checked + label {
            color: #a5b4fc;
            font-weight: 600;
        }

        /* מצב גרירה */
        .sc-col-mgr-item[style*="opacity: 0.5"],
        .sc-col-mgr-item[style*="opacity:0.5"] {
            box-shadow: 0 4px 14px rgba(0,0,0,0.3);
            border-color: rgba(99,102,241,0.5);
        }

        /* ── Light Mode ── */
        [data-theme="light"] .sc-col-manager-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.25);
            color: #4338ca;
        }

        [data-theme="light"] .sc-col-manager-btn:hover {
            background: rgba(99,102,241,0.16);
            border-color: rgba(99,102,241,0.45);
        }

        [data-theme="light"] .sc-col-mgr-item {
            background: #f8f8ff;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .sc-col-mgr-item:hover {
            background: rgba(99,102,241,0.05);
            border-color: rgba(99,102,241,0.2);
        }

        [data-theme="light"] .sc-col-mgr-grip { color: #bbb; }
        [data-theme="light"] .sc-col-mgr-item:hover .sc-col-mgr-grip {
            color: #6366f1;
        }

        [data-theme="light"] .sc-col-mgr-item label { color: #374151; }
        [data-theme="light"] .sc-col-mgr-item:hover label { color: #1a1a2e; }

        [data-theme="light"] .sc-col-mgr-item
            input[type="checkbox"]:checked + label {
            color: #4338ca;
        }
        /* ══ Multi-Select Checkbox ══ */
        .sc-td-select {
            text-align: center;
            width: 36px;
            padding: 4px !important;
        }

        .sc-cb {
            width: 14px;
            height: 14px;
            accent-color: #6366f1;
            cursor: pointer;
        }

        .sc-tr-selected {
            background: rgba(99,102,241,0.1) !important;
            outline: 1px solid rgba(99,102,241,0.3);
        }

        .sc-tr-selected:hover {
            background: rgba(99,102,241,0.15) !important;
        }

        /* Light mode */
        [data-theme="light"] .sc-tr-selected {
            background: rgba(99,102,241,0.08) !important;
            outline: 1px solid rgba(99,102,241,0.2);
        }

        /* ══ Multi Edit Modal ══ */
        .sc-multi-edit-modal {
            max-width: 780px;
            width: 95%;
        }

        .sc-multi-edit-header {
            border-bottom: 2px solid rgba(99,102,241,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05)
            ) !important;
        }

        .sc-multi-edit-count-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 8px;
            color: #a5b4fc;
            font-size: 0.82rem;
            font-weight: 700;
            margin-right: 6px;
        }

        .sc-multi-edit-info {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            background: rgba(99,102,241,0.06);
            border-bottom: 1px solid rgba(99,102,241,0.15);
            font-size: 0.82rem;
            color: #888;
            flex-shrink: 0;
        }

        .sc-multi-edit-info i { color: #6366f1; }

        .sc-multi-edit-body {
            max-height: 65vh;
            overflow-y: auto;
            padding: 18px 20px !important;
            gap: 12px !important;
        }

        .sc-multi-edit-body::-webkit-scrollbar { width: 6px; }
        .sc-multi-edit-body::-webkit-scrollbar-track { background: #111; }
        .sc-multi-edit-body::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        .sc-me-combo-wrap {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .sc-me-combo-select {
            width: 100%;
        }

        .sc-me-combo-input {
            width: 100%;
            box-sizing: border-box;
        }

        .sc-multi-selected-list {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            padding: 10px 12px;
        }

        .sc-multi-selected-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #777;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .sc-multi-selected-title i { color: #6366f1; }

        .sc-multi-selected-names {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }

        .sc-multi-selected-tag {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.75rem;
            font-weight: 600;
        }

        .sc-multi-field-hint {
            font-size: 0.68rem;
            color: #555;
            font-weight: 400;
            margin-right: 6px;
        }

        /* Light mode */
        [data-theme="light"] .sc-multi-edit-info {
            background: rgba(99,102,241,0.04);
            border-bottom: 1px solid rgba(99,102,241,0.1);
            color: #555;
        }

        [data-theme="light"] .sc-multi-selected-list {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .sc-multi-selected-title { color: #555; }

        [data-theme="light"] .sc-multi-selected-tag {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .sc-tr-selected {
            background: rgba(99,102,241,0.06) !important;
        }
        /* ══ Multi Delete Button ══ */
        .sc-multi-delete-btn {
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            color: #fca5a5;
        }

        .sc-multi-delete-btn:hover {
            background: rgba(239,68,68,0.28);
            border-color: rgba(239,68,68,0.65);
            transform: translateY(-1px);
        }

        [data-theme="light"] .sc-multi-delete-btn {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.3);
            color: #dc2626;
        }
        /* ══ Multi-Select Toolbar ══ */
        .sc-multi-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 16px;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.15),
                rgba(124,58,237,0.12)
            );
            border-bottom: 1px solid rgba(99,102,241,0.35);
            flex-shrink: 0;
            animation: scFadeIn 0.2s ease;
            gap: 12px;
            flex-wrap: wrap;
        }

        .sc-multi-toolbar-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .sc-multi-toolbar-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .sc-multi-count {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 0.88rem;
            font-weight: 700;
            color: #a5b4fc;
        }

        .sc-multi-count i {
            color: #6366f1;
            font-size: 1rem;
        }

        .sc-multi-clear-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 12px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 6px;
            color: #aaa;
            font-size: 0.8rem;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }

        .sc-multi-clear-btn:hover {
            background: rgba(255,255,255,0.1);
            color: #e0e0e0;
        }

        .sc-multi-action-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 6px;
            font-size: 0.83rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid transparent;
            font-family: inherit;
        }

        .sc-multi-edit-btn {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.45);
            color: #a5b4fc;
        }

        .sc-multi-edit-btn:hover {
            background: rgba(99,102,241,0.32);
            border-color: rgba(99,102,241,0.65);
            transform: translateY(-1px);
        }

        /* Light mode */
        [data-theme="light"] .sc-multi-toolbar {
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.06)
            );
            border-bottom: 1px solid rgba(99,102,241,0.2);
        }

        [data-theme="light"] .sc-multi-count { color: #4338ca; }

        [data-theme="light"] .sc-multi-clear-btn {
            background: rgba(0,0,0,0.04);
            border-color: rgba(0,0,0,0.12);
            color: #555;
        }

        [data-theme="light"] .sc-multi-clear-btn:hover {
            background: rgba(0,0,0,0.08);
            color: #333;
        }

        [data-theme="light"] .sc-multi-edit-btn {
            background: rgba(99,102,241,0.1);
            border-color: rgba(99,102,241,0.3);
            color: #4338ca;
        }

        [data-theme="light"] .sc-multi-edit-btn:hover {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.5);
        }

        /* ══ Bulk Validate Button ══ */
        .sc-multi-validate-btn {
            background: rgba(245,158,11,0.2);
            border-color: rgba(245,158,11,0.45);
            color: #fcd34d;
        }

        .sc-multi-validate-btn:hover {
            background: rgba(245,158,11,0.32);
            border-color: rgba(245,158,11,0.65);
            transform: translateY(-1px);
        }

        /* Light mode */
        [data-theme="light"] .sc-multi-validate-btn {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.35);
            color: #b45309;
        }

        [data-theme="light"] .sc-multi-validate-btn:hover {
            background: rgba(245,158,11,0.22);
            border-color: rgba(245,158,11,0.55);
        }

        /* ══ Assign Servers Modal ══ */
        .sc-assign-modal {
            max-width: 680px;
            width: 95%;
        }

        .sc-assign-modal-header {
            border-bottom: 2px solid rgba(99,102,241,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05)
            ) !important;
        }

        .sc-assign-system-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 8px;
            color: #a5b4fc;
            font-size: 0.82rem;
            font-weight: 700;
            margin-right: 6px;
        }

        .sc-assign-modal-body {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px 20px;
            max-height: 65vh;
            overflow-y: auto;
        }

        .sc-assign-modal-body::-webkit-scrollbar { width: 6px; }
        .sc-assign-modal-body::-webkit-scrollbar-track { background: #111; }
        .sc-assign-modal-body::-webkit-scrollbar-thumb {
            background: #333; border-radius: 3px;
        }

        /* ── חיפוש ── */
        .sc-assign-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }

        .sc-assign-search-icon {
            position: absolute;
            right: 10px;
            color: #555;
            font-size: 0.78rem;
            pointer-events: none;
        }

        .sc-assign-search-input {
            width: 100%;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 7px 32px 7px 10px;
            font-size: 0.83rem;
            outline: none;
            box-sizing: border-box;
            direction: rtl;
            transition: border-color 0.2s;
        }

        .sc-assign-search-input:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }

        .sc-assign-search-input::placeholder { color: #444; }

        /* ── כפתורי שליטה ── */
        .sc-assign-controls {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        .sc-assign-ctrl-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            border: 1px solid;
            font-family: inherit;
        }

        .sc-assign-ctrl-select {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.3);
            color: #86efac;
        }

        .sc-assign-ctrl-select:hover {
            background: rgba(34,197,94,0.2);
            border-color: rgba(34,197,94,0.5);
        }

        .sc-assign-ctrl-deselect {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #fca5a5;
        }

        .sc-assign-ctrl-deselect:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.45);
        }

        .sc-assign-count-badge {
            font-size: 0.78rem;
            font-weight: 700;
            color: #a5b4fc;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 8px;
            padding: 2px 10px;
            margin-right: auto;
        }

        /* ── סקציות ── */
        .sc-assign-section {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            overflow: hidden;
        }

        .sc-assign-section-title {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 8px 12px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.8rem;
            font-weight: 600;
            color: #aaa;
        }

        .sc-assign-section-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 18px;
            padding: 0 6px;
            background: rgba(255,255,255,0.08);
            border-radius: 9px;
            font-size: 0.7rem;
            font-weight: 700;
            color: #888;
            margin-right: auto;
        }

        /* ── רשימת שרתים ── */
        .sc-assign-list {
            max-height: 200px;
            overflow-y: auto;
            padding: 4px;
        }

        .sc-assign-list::-webkit-scrollbar { width: 5px; }
        .sc-assign-list::-webkit-scrollbar-track { background: #111; }
        .sc-assign-list::-webkit-scrollbar-thumb {
            background: #333; border-radius: 3px;
        }

        .sc-assign-list-assigned {
            max-height: 150px;
        }

        /* ── פריט שרת ── */
        .sc-assign-server-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 10px;
            border-radius: 6px;
            border-bottom: 1px dashed rgba(255,255,255,0.04);
            transition: background 0.12s;
            cursor: pointer;
            user-select: none;
        }

        .sc-assign-server-item:last-child {
            border-bottom: none;
        }

        .sc-assign-server-available:hover {
            background: rgba(99,102,241,0.08);
        }

        .sc-assign-item-selected {
            background: rgba(99,102,241,0.12) !important;
            border-color: rgba(99,102,241,0.2) !important;
        }

        .sc-assign-server-assigned {
            opacity: 0.65;
            cursor: default;
        }

        .sc-assign-server-name {
            flex: 1;
            font-size: 0.82rem;
            font-weight: 600;
            color: #e0e0e0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }

        .sc-assign-already-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 7px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 8px;
            color: #a5b4fc;
            font-size: 0.68rem;
            font-weight: 700;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .sc-assign-empty-msg {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 14px 12px;
            color: #555;
            font-size: 0.8rem;
            font-style: italic;
        }

        /* ── Footer ── */
        .sc-assign-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 12px 0 0;
            border-top: 1px solid rgba(255,255,255,0.06);
            margin-top: 4px;
        }

        .sc-assign-save-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 18px;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
        }

        .sc-assign-save-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, #4338ca, #6d28d9);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99,102,241,0.4);
        }

        .sc-assign-save-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            box-shadow: none;
            transform: none;
        }

        .sc-assign-save-btn i {
            font-size: 0.8rem;
        }

        /* כפתור שיוך שרתים בחלון שרתי מערכת */
        .sc-servers-assign-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            border: none;
            border-radius: 6px;
            color: #fff;
            font-size: 0.82rem;
            font-weight: 600;
            font-family: inherit;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .sc-servers-assign-btn:hover {
            background: linear-gradient(135deg, #4338ca, #6d28d9);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99,102,241,.35);
        }

        .sc-servers-modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 12px;
            flex-wrap: wrap;
        }

        @media (max-width: 768px) {
            .sc-assign-modal {
                width: 98%;
                max-width: 98%;
            }

            .sc-assign-modal-body {
                padding: 12px;
            }

            .sc-assign-footer {
                flex-direction: column;
            }

            .sc-assign-save-btn,
            .sc-modal-cancel-btn {
                width: 100%;
                justify-content: center;
            }

            .sc-assign-controls {
                flex-direction: column;
                align-items: stretch;
            }

            .sc-assign-ctrl-btn {
                justify-content: center;
            }
        }

        /* ══ Edit Modal - Servers Section ══ */
        .sc-edit-servers-section {
            background: rgba(99,102,241,0.04);
            border: 1px solid rgba(99,102,241,0.18);
            border-radius: 8px;
            overflow: hidden;
            margin-top: 4px;
        }

        .sc-edit-servers-header {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 8px 12px;
            background: rgba(99,102,241,0.08);
            border-bottom: 1px solid rgba(99,102,241,0.15);
            font-size: 0.8rem;
            font-weight: 600;
            color: #aaa;
        }

        .sc-edit-servers-count {
            margin-right: auto;
            font-size: 0.72rem;
            color: #6366f1;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 8px;
            padding: 1px 8px;
            font-weight: 700;
        }

        .sc-edit-servers-list {
            max-height: 130px;
            overflow-y: auto;
            padding: 4px;
        }

        .sc-edit-servers-list::-webkit-scrollbar { width: 4px; }
        .sc-edit-servers-list::-webkit-scrollbar-track { background: #111; }
        .sc-edit-servers-list::-webkit-scrollbar-thumb {
            background: #333; border-radius: 2px;
        }

        .sc-edit-server-item {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 5px 10px;
            border-radius: 5px;
            border-bottom: 1px dashed rgba(255,255,255,0.04);
            font-size: 0.78rem;
        }

        .sc-edit-server-item:last-child { border-bottom: none; }

        .sc-edit-server-name {
            flex: 1;
            font-weight: 600;
            color: #ccc;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }

        .sc-edit-servers-btn {
            font-size: 0.78rem !important;
            padding: 4px 10px !important;
        }

        /* Light mode */
        [data-theme="light"] .sc-edit-servers-section {
            background: rgba(99,102,241,0.03);
            border-color: rgba(99,102,241,0.12);
        }

        [data-theme="light"] .sc-edit-servers-header {
            background: rgba(99,102,241,0.05);
            border-bottom-color: rgba(99,102,241,0.1);
            color: #555;
        }

        [data-theme="light"] .sc-edit-server-name { color: #333; }
        /* ══ Edit Modal Layout ══ */
        .sc-modal.sc-edit-modal {
            display: flex;
            flex-direction: column;
            max-height: 90vh;
        }

        .sc-edit-modal-body {
            flex: 1;
            overflow-y: auto;
            min-height: 0;
        }

        .sc-edit-servers-section {
            flex-shrink: 0;  /* ← לא מתכווץ */
            border-top: 1px solid rgba(99,102,241,0.2);
            border-radius: 0 !important;
            border-left: none !important;
            border-right: none !important;
            border-bottom: none !important;
            margin: 0 !important;
        }
        /* ══ Add Number Wrap ══ */
        .sc-add-number-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .sc-add-number-wrap .sc-edit-input {
            flex: 1;
        }

        .sc-add-number-status {
            font-size: 0.72rem;
            font-weight: 700;
            white-space: nowrap;
            flex-shrink: 0;
            transition: all 0.2s;
        }

        .sc-number-ok {
            color: #86efac;
        }

        .sc-number-error {
            color: #fca5a5;
        }

        /* Light mode */
        [data-theme="light"] .sc-number-ok  { color: #15803d; }
        [data-theme="light"] .sc-number-error { color: #dc2626; }

        /* ══ Requires Validation Button ══ */
        .sc-requires-validation-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            background: rgba(107,114,128,0.12);
            border: 1px solid rgba(107,114,128,0.3);
            border-radius: 6px;
            color: #9ca3af;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
            white-space: nowrap;
        }

        .sc-requires-validation-btn:hover {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.45);
            color: #a5b4fc;
            transform: translateY(-1px);
        }

        .sc-requires-validation-btn.sc-requires-validation-active {
            background: rgba(245,158,11,0.15);
            border-color: rgba(245,158,11,0.45);
            color: #fcd34d;
            box-shadow: 0 0 8px rgba(245,158,11,0.2);
        }

        .sc-requires-validation-btn.sc-requires-validation-active:hover {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.45);
            color: #fca5a5;
        }

        /* Light mode */
        [data-theme="light"] .sc-requires-validation-btn {
            background: rgba(107,114,128,0.08);
            border-color: rgba(107,114,128,0.2);
            color: #6b7280;
        }

        [data-theme="light"] .sc-requires-validation-btn:hover {
            background: rgba(99,102,241,0.1);
            border-color: rgba(99,102,241,0.3);
            color: #4338ca;
        }

        [data-theme="light"] .sc-requires-validation-btn.sc-requires-validation-active {
            background: rgba(245,158,11,0.1);
            border-color: rgba(245,158,11,0.35);
            color: #b45309;
        }
        .sc-validated-date {
            color: #86efac;
            font-weight: 600;
        }
        .sc-not-validated {
            color: #444;
            font-style: italic;
        }
        [data-theme="light"] .sc-validated-date { color: #15803d; }
        [data-theme="light"] .sc-not-validated  { color: #bbb; }
        /* ── שגיאת כפילות - הודעה מתחת לשדה ── */
        .sc-edit-field .sc-duplicate-msg {
            width: 100%;
            margin-top: 5px;
            flex-shrink: 0;
            /* וודא שלא נכנס לתוך flex-row */
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.72rem;
            color: #fca5a5;
        }

        [data-theme="light"] .sc-edit-field .sc-duplicate-msg {
            color: #dc2626;
        }

        /* ══ Requires Validation Badge (Table Column) ══ */
        .sc-badge-requires-validation {
            background: rgba(245,158,11,0.15);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.4);
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.65rem;
        }

        [data-theme="light"] .sc-badge-requires-validation {
            background: rgba(245,158,11,0.1);
            color: #b45309;
            border: 1px solid rgba(245,158,11,0.3);
        }
        `;
        document.head.appendChild(style);
    }
}