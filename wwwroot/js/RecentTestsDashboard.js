class RecentTestsDashboard {
    constructor(containerId, currentUser) {
        this.containerId = containerId;
        this.currentUser = currentUser;
        this.container = null;
        this.tests = [];
        this.allTests = [];

        // *** הרשאות ***
        this.canEdit = this.checkEditPermission();

        // סינון
        this.searchTerm = '';
        this.statusFilter = 'all';
        this.hoursFilter = 24; // קבוע - תמיד 24 שעות

        this.projectFilter = [];   // מערך ריק = הכל
        this.priorityFilter = [];  // מערך ריק = הכל

        // מיון
        this.sortColumn = 'lastRunTime';
        this.sortDirection = 'desc';

        // *** מפתח שמירה ב-localStorage ***
        this._storageKey = `rtFilters_${containerId}`;

        // סינון — טען מקאש אם קיים
        const saved = this._loadFiltersFromCache();

        this.searchTerm = saved.searchTerm ?? '';
        this.statusFilter = saved.statusFilter ?? 'all';
        this.hoursFilter = 24;

        this.projectFilter = saved.projectFilter ?? [];
        this.priorityFilter = saved.priorityFilter ?? [];

        // מיון — טען מקאש אם קיים
        this.sortColumn = saved.sortColumn ?? 'lastRunTime';
        this.sortDirection = saved.sortDirection ?? 'desc';

        // רענון
        this.refreshInterval = null;
        this.REFRESH_MS = 60 * 1000;

        // Downtime systems
        this._downtimeNumbers = new Set();

        this._testCaseMappings = [];
        this._testCaseMappingCache = {};
        this._suiteConfigCache = {};
        this._mappingPopupOpen = false;

        this._contactsCache = {}; // { [testId]: [{ id, name, email, phone }] }

        // *** Runner type ***
        this._lastRunnerType =
            localStorage.getItem('rtLastRunnerType') || 'noc';

        // *** Polling ***
        this._pendingRunCaseId = null;
        this._pendingRunTestName = null;
        this._pendingRunStartTime = null;
        this._pollInterval = null;
        this._pollTimeout = null;
    }

    // ==========================================
    // *** חדש: שמירת סינונים ב-localStorage ***
    // ==========================================
    _saveFiltersToCache() {
        try {
            const state = {
                searchTerm: this.searchTerm,
                statusFilter: this.statusFilter,
                projectFilter: this.projectFilter,
                priorityFilter: this.priorityFilter,
                sortColumn: this.sortColumn,
                sortDirection: this.sortDirection,
            };
            localStorage.setItem(
                this._storageKey,
                JSON.stringify(state)
            );
        } catch (err) {
            console.warn('Could not save filters to cache:', err);
        }
    }

    // ==========================================
    // *** חדש: טעינת סינונים מ-localStorage ***
    // ==========================================
    _loadFiltersFromCache() {
        try {
            const raw = localStorage.getItem(this._storageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);

            // *** ולידציה בסיסית ***
            return {
                searchTerm: typeof parsed.searchTerm === 'string'
                    ? parsed.searchTerm : '',

                statusFilter: ['all', 'passed', 'failed', 'warning']
                    .includes(parsed.statusFilter)
                    ? parsed.statusFilter : 'all',

                projectFilter: Array.isArray(parsed.projectFilter)
                    ? parsed.projectFilter : [],

                priorityFilter: Array.isArray(parsed.priorityFilter)
                    ? parsed.priorityFilter : [],

                sortColumn: typeof parsed.sortColumn === 'string'
                    ? parsed.sortColumn : 'lastRunTime',

                sortDirection: ['asc', 'desc']
                    .includes(parsed.sortDirection)
                    ? parsed.sortDirection : 'desc',
            };
        } catch (err) {
            console.warn('Could not load filters from cache:', err);
            return {};
        }
    }

    // ==========================================
    // *** חדש: ניקוי קאש סינונים ***
    // ==========================================
    _clearFiltersCache() {
        try {
            localStorage.removeItem(this._storageKey);
        } catch (err) {
            console.warn('Could not clear filters cache:', err);
        }
    }

    // ==========================================
    // אתחול
    // ==========================================
    initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container #${this.containerId} not found`);
            return;
        }

        this.addStyles();
        this.renderShell();

        // *** שחזר מצב UI מהקאש לאחר renderShell ***
        this._restoreUIFromCache();

        this.bindEvents();

        Promise.all([
            this._loadDowntimeSystems(),
            this._loadTestCaseMappings()
        ]).then(() => this.loadData());

        this.refreshInterval = setInterval(
            () => this.loadData(), this.REFRESH_MS);
    }

    // ==========================================
    // *** חדש: שחזור מצב UI מהקאש ***
    // ==========================================
    _restoreUIFromCache() {

        // --- חיפוש ---
        if (this.searchTerm) {
            const inp = document.getElementById('rtSearchInput');
            if (inp) inp.value = this.searchTerm;

            const clearBtn = document.getElementById('rtClearSearch');
            if (clearBtn) clearBtn.style.display = 'flex';
        }

        // --- כפתורי סטטוס ---
        document.querySelectorAll('.rt-filter-btn').forEach(btn => {
            btn.classList.toggle(
                'active',
                btn.getAttribute('data-f') === this.statusFilter
            );
        });

        // --- אינדיקטורי מיון ---
        this.updateSortIndicators();

        // --- באנר סינונים ---
        this._updateFilterBanner();
    }

    // ==========================================
    // destroy — עצור polling
    // ==========================================
    destroy() {
        if (this.refreshInterval)
            clearInterval(this.refreshInterval);

        // *** עצור polling ***
        this._stopPollingForResult();
    }

    // ==========================================
    // הרשאות
    // ==========================================
    checkEditPermission() {
        if (!this.currentUser) return false;
        const { role, username, privilegedUsers } = this.currentUser;

        // *** privilegedUsers מגיע מהשרת דרך currentUser ***
        const privList = Array.isArray(privilegedUsers)
            ? privilegedUsers.map(u => u.toLowerCase())
            : [];

        if (privList.includes((username || '').toLowerCase())) return true;
        if (role === 'Admin') return true;
        return false;
    }

    // ==========================================
    // טעינת מערכות לילה
    // ==========================================
    async _loadDowntimeSystems() {
        try {
            const res = await fetch('/SuiteResults/GetDowntimeSystems',
                { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                this._downtimeNumbers = new Set(
                    (data.systems || []).map(s => s.num)
                );
            }
        } catch (err) {
            console.warn('Could not load downtime systems:', err);
        }
    }

    _isDowntimeTest(testName) {
        if (!testName) return false;
        const parts = testName.split(' - ');
        if (parts.length < 2) return false;
        const num = parseInt(parts[1], 10);
        return !isNaN(num) && this._downtimeNumbers.has(num);
    }

    // ==========================================
    // הסרת כפילויות - שומר רק ריצה אחרונה לכל טסט
    // ==========================================
    deduplicateTests(tests) {
        const map = new Map();

        tests.forEach(test => {
            // *** מפתח עקבי ***
            const key = (test.resultUid && test.resultUid !== '')
                ? test.resultUid
                : (test.containerName || test.testName || '');

            // *** אל תוסיף אם המפתח ריק לחלוטין ***
            if (!key) return;

            if (!map.has(key)) {
                map.set(key, test);
            } else {
                // שמור את הריצה האחרונה ביותר
                const existing = map.get(key);
                const existingTime = new Date(existing.lastRunTime || 0);
                const newTime = new Date(test.lastRunTime || 0);
                if (newTime > existingTime) {
                    map.set(key, test);
                }
            }
        });

        return Array.from(map.values());
    }

    // ==========================================
    // טעינת נתונים - תמיד 24 שעות
    // ==========================================
    async loadData() {
        try {
            this.showLoading(true);

            // תמיד 48 שעות - ללא אפשרות שינוי
            const res = await fetch(
                `/SuiteResults/GetAllRecentTests?hours=48&size=10000`,
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    credentials: 'include'
                }
            );

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Server error');

            // הסרת כפילויות - שמירת ריצה אחרונה בלבד
            const rawTests = data.tests || [];

            // *** שמור נתונים ישנים לפני עדכון ***
            const prevTests = [...this.allTests];

            this.allTests = this.deduplicateTests(rawTests);
            await this._loadAllContacts();
            this._updateFilterOptions();
            this.updateStats();
            this.renderTable();
            this.updateLastRefresh();
            this.showLoading(false);

            // *** בדוק אם יש תוצאה ממתינה ***
            this._checkPendingRunResult(prevTests);

        } catch (err) {
            console.error('RecentTestsDashboard loadData error:', err);
            this.showLoading(false);
            this.showError(`Error loading data: ${err.message}`);
        }
    }

    _updateFilterOptions() {
        const projects = [...new Set(
            this.allTests.map(t => t.projectName || '').filter(Boolean)
        )].sort();

        const priorities = [...new Set(
            this.allTests.map(t => (t.priority || '').trim()).filter(Boolean)
        )].sort();

        this._renderMultiSelect(
            'rtProjectFilter',
            'rtProjectDropdown',
            projects,
            this.projectFilter,
            p => this.escHtml(this._shortProjectName(p)),
            (selected) => {
                this.projectFilter = selected;
                this._updateFilterBanner();
                this.renderTable();
            }
        );

        this._renderMultiSelect(
            'rtPriorityFilter',
            'rtPriorityDropdown',
            priorities,
            this.priorityFilter,
            p => this.escHtml(p),
            (selected) => {
                this.priorityFilter = selected;
                this._updateFilterBanner();
                this.renderTable();
            }
        );
    }

    _renderMultiSelect(btnId, dropId, options, selected, labelFn, onChange) {
        const btn = document.getElementById(btnId);
        const drop = document.getElementById(dropId);
        if (!btn || !drop) return;

        // *** עדכן תווית הכפתור ***
        const labelEl = btn.querySelector('.rt-ms-label');
        if (labelEl) {
            if (selected.length === 0) {
                labelEl.textContent = btn.dataset.placeholder || 'All';
            } else if (selected.length === 1) {
                labelEl.textContent =
                    labelFn(selected[0]).replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>');
            } else {
                labelEl.textContent = `${selected.length} selected`;
            }
        }

        // *** בנה תוכן הדרופדאון ***
        drop.innerHTML = `
        <div class="rt-ms-search-wrap">
            <input class="rt-ms-search"
                   type="text"
                   placeholder="Search..."
                   data-drop="${dropId}"/>
        </div>
        <div class="rt-ms-options">
            <label class="rt-ms-option rt-ms-all">
                <input type="checkbox"
                       class="rt-ms-chk-all"
                       data-drop="${dropId}"
                       ${selected.length === 0 ? 'checked' : ''}/>
                <span class="rt-ms-chk-box"></span>
                <span class="rt-ms-opt-label">All</span>
            </label>
            <div class="rt-ms-divider"></div>
            ${options.map(opt => `
            <label class="rt-ms-option"
                   data-val="${this.escHtml(opt)}">
                <input type="checkbox"
                       class="rt-ms-chk-item"
                       data-drop="${dropId}"
                       data-val="${this.escHtml(opt)}"
                       ${selected.includes(opt) ? 'checked' : ''}/>
                <span class="rt-ms-chk-box"></span>
                <span class="rt-ms-opt-label"
                      title="${this.escHtml(opt)}">
                    ${labelFn(opt)}
                </span>
            </label>`).join('')}
        </div>`;

        // *** שמור callback על הדרופדאון ***
        drop._onChange = onChange;
        drop._options = options;
        drop._selected = [...selected];
        drop._labelFn = labelFn;
        drop._btnId = btnId;
    }

    // ==========================================
    // סינון ומיון
    // ==========================================
    getFilteredTests() {
        let tests = [...this.allTests];

        // סינון סטטוס
        if (this.statusFilter !== 'all') {
            tests = tests.filter(t =>
                (t.status || '').toLowerCase() === this.statusFilter
            );
        }

        // סינון פרויקט
        if (this.projectFilter.length > 0) {
            tests = tests.filter(t =>
                this.projectFilter.includes(t.projectName || '')
            );
        }

        // סינון עדיפות
        if (this.priorityFilter.length > 0) {
            tests = tests.filter(t =>
                this.priorityFilter.map(p => p.toLowerCase())
                    .includes((t.priority || '').trim().toLowerCase())
            );
        }

        // סינון חיפוש
        if (this.searchTerm.trim()) {
            const term = this.searchTerm.toLowerCase();
            tests = tests.filter(t =>
                (t.containerName || '').toLowerCase().includes(term) ||
                (t.testName || '').toLowerCase().includes(term) ||
                (t.testId || '').toLowerCase().includes(term) ||
                (t.status || '').toLowerCase().includes(term) ||
                this._shortProjectName(t.projectName || '').toLowerCase().includes(term) ||
                (t.parentContainerName || '').toLowerCase().includes(term)
            );
        }

        // מיון
        tests.sort((a, b) => {
            let valA, valB;

            switch (this.sortColumn) {
                case 'containerName':
                    valA = (a.containerName || '').toLowerCase();
                    valB = (b.containerName || '').toLowerCase();
                    break;
                case 'status':
                    valA = (a.status || '').toLowerCase();
                    valB = (b.status || '').toLowerCase();
                    break;
                case 'duration':
                    valA = a.durationSeconds || 0;
                    valB = b.durationSeconds || 0;
                    break;
                case 'priority':
                    valA = (a.priority || 'z').toLowerCase();
                    valB = (b.priority || 'z').toLowerCase();
                    break;
                case 'projectName':
                    valA = (a.projectName || '').toLowerCase();
                    valB = (b.projectName || '').toLowerCase();
                    break;
                case 'lastRunTime':
                default:
                    valA = a.lastRunTime || '';
                    valB = b.lastRunTime || '';
                    break;
            }

            if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        return tests;
    }

    setSort(column) {
        if (this.sortColumn === column) {
            this.sortDirection =
                this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = column === 'lastRunTime' ? 'desc' : 'asc';
        }

        // *** שמור בקאש ***
        this._saveFiltersToCache();

        this.renderTable();
        this.updateSortIndicators();
    }

    // ==========================================
    // עדכון סטטיסטיקות
    // ==========================================
    updateStats() {
        const tests = this.allTests;
        const total = tests.length;
        const passed = tests.filter(t =>
            (t.status || '').toLowerCase() === 'passed').length;
        const failed = tests.filter(t =>
            (t.status || '').toLowerCase() === 'failed').length;
        const warning = tests.filter(t =>
            (t.status || '').toLowerCase() === 'warning').length;
        const rate = total > 0 ? Math.round((passed / total) * 100) : 0;

        const rateColor = rate === 100 ? '#22c55e'
            : rate >= 70 ? '#f59e0b'
                : '#ef4444';

        const el = id => document.getElementById(id);

        if (el('rtTotal')) el('rtTotal').textContent = total;
        if (el('rtPassed')) el('rtPassed').textContent = passed;
        if (el('rtFailed')) el('rtFailed').textContent = failed;
        if (el('rtWarning')) el('rtWarning').textContent = warning;
        if (el('rtRate')) {
            el('rtRate').textContent = `${rate}%`;
            el('rtRate').style.color = rateColor;
        }

        // עדכון progress bar של pass rate
        const bar = document.getElementById('rtRateBar');
        if (bar) {
            bar.style.width = `${rate}%`;
            bar.style.background = rateColor;
        }
    }

    // ==========================================
    // רינדור מעטפת - ללא סינון שעות
    // ==========================================
    renderShell() {
        this.container.innerHTML = `
        <div class="rt-root">

            <!-- Header -->
            <div class="rt-header">
                <div class="rt-header-left">

                    <!-- חיפוש -->
                    <div class="rt-search-wrap">
                        <i class="fas fa-search rt-search-icon"></i>
                        <input id="rtSearchInput"
                               class="rt-search-input"
                               type="text"
                               placeholder="Search tests..."/>
                        <button id="rtClearSearch"
                                class="rt-clear-search"
                                style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- סינון סטטוס -->
                    <div class="rt-filter-btns">
                        <button class="rt-filter-btn active" data-f="all">
                            All
                        </button>
                        <button class="rt-filter-btn passed" data-f="passed">
                            <i class="fas fa-check-circle"></i> Passed
                        </button>
                        <button class="rt-filter-btn failed" data-f="failed">
                            <i class="fas fa-times-circle"></i> Failed
                        </button>
                        <button class="rt-filter-btn warning" data-f="warning">
                            <i class="fas fa-exclamation-circle"></i> Warning
                        </button>
                    </div>

                    <!-- סינון פרויקט -->
                    <div class="rt-ms-wrap">
                        <button class="rt-ms-btn"
                                id="rtProjectFilter"
                                data-drop="rtProjectDropdown"
                                data-placeholder="All Projects">
                            <i class="fas fa-folder"
                            style="color:#7ab3ef;font-size:0.75rem"></i>
                            <span class="rt-ms-label">All Projects</span>
                            <i class="fas fa-chevron-down rt-ms-arrow"></i>
                        </button>
                        <div class="rt-ms-dropdown"
                            id="rtProjectDropdown"
                            style="display:none">
                        </div>
                    </div>

                    <!-- סינון עדיפות -->
                    <div class="rt-ms-wrap">
                        <button class="rt-ms-btn"
                                id="rtPriorityFilter"
                                data-drop="rtPriorityDropdown"
                                data-placeholder="All Priorities">
                            <i class="fas fa-flag"
                            style="color:#a78bfa;font-size:0.75rem"></i>
                            <span class="rt-ms-label">All Priorities</span>
                            <i class="fas fa-chevron-down rt-ms-arrow"></i>
                        </button>
                        <div class="rt-ms-dropdown"
                            id="rtPriorityDropdown"
                            style="display:none">
                        </div>
                    </div>

                </div>

                <div class="rt-header-right">
                    <!-- *** כפתור Export *** -->
                    <button class="rt-export-btn" id="rtExportBtn"
                            title="Export to Excel">
                        <i class="fas fa-file-excel"></i>
                        <span>Export</span>
                    </button>
                    <span class="rt-title-badge">Last 48h</span>
                    <span id="rtLastRefresh" class="rt-last-refresh"></span>
                    ${this.canEdit ? `
                    <button class="rt-manage-mappings-btn"
                            id="rtManageMappingsBtn"
                            title="Manage CloudBeat Mappings">
                        <i class="fas fa-link"></i>
                        <span>CB Mappings</span>
                    </button>` : ''}
                    <button class="rt-refresh-btn" id="rtRefreshBtn" title="Refresh">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                </div>
            </div>

            <!-- באנר סינונים פעילים -->
            <div id="rtFilterBanner" class="rt-filter-banner" style="display:none">
                <i class="fas fa-filter"></i>
                <span style="color:#888;font-size:0.78rem">Active filters:</span>
                <span id="rtFilterBannerTags"
                    style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                </span>
                <button id="rtClearAllFilters"
                        class="rt-filter-banner-clear"
                        title="Clear all filters">
                    <i class="fas fa-times"></i> Clear All
                </button>
            </div>

            <!-- סטטיסטיקות משופרות -->
            <div class="rt-stats-bar">
                <div class="rt-stat-box total">
                    <div class="rt-stat-icon">
                        <i class="fas fa-list-check"></i>
                    </div>
                    <div class="rt-stat-content">
                        <span class="rt-stat-num" id="rtTotal">0</span>
                        <span class="rt-stat-label">Total Tests</span>
                    </div>
                </div>
                <div class="rt-stat-box passed">
                    <div class="rt-stat-icon passed">
                        <i class="fas fa-check-circle"></i>
                    </div>
                    <div class="rt-stat-content">
                        <span class="rt-stat-num passed" id="rtPassed">0</span>
                        <span class="rt-stat-label">Passed</span>
                    </div>
                </div>
                <div class="rt-stat-box failed">
                    <div class="rt-stat-icon failed">
                        <i class="fas fa-times-circle"></i>
                    </div>
                    <div class="rt-stat-content">
                        <span class="rt-stat-num failed" id="rtFailed">0</span>
                        <span class="rt-stat-label">Failed</span>
                    </div>
                </div>
                <div class="rt-stat-box warning">
                    <div class="rt-stat-icon warning">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <div class="rt-stat-content">
                        <span class="rt-stat-num warning" id="rtWarning">0</span>
                        <span class="rt-stat-label">Warning</span>
                    </div>
                </div>
                <div class="rt-stat-box rate">
                    <div class="rt-stat-icon rate">
                        <i class="fas fa-percent"></i>
                    </div>
                    <div class="rt-stat-content">
                        <span class="rt-stat-num" id="rtRate">0%</span>
                        <span class="rt-stat-label">Pass Rate</span>
                        <div class="rt-rate-bar-wrap">
                            <div class="rt-rate-bar" id="rtRateBar"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- הודעות -->
            <div id="rtError"   class="rt-error"   style="display:none"></div>
            <div id="rtLoading" class="rt-loading"  style="display:none">
                <i class="fas fa-spinner fa-spin"></i> Loading tests...
            </div>

            <!-- טבלה -->
            <div class="rt-table-wrap">
                <table class="rt-table">
                    <thead>
                        <tr>
                            <th class="rt-th-sortable" data-col="containerName">
                                Test Name
                                <span class="rt-sort-icon" id="rtSort_containerName"></span>
                            </th>
                            <th class="rt-th-sortable" data-col="status">
                                Status
                                <span class="rt-sort-icon" id="rtSort_status"></span>
                            </th>
                            <th class="rt-th-sortable" data-col="priority">
                                Priority
                                <span class="rt-sort-icon" id="rtSort_priority"></span>
                            </th>
                            <th class="rt-th-sortable" data-col="projectName">
                                Project
                                <span class="rt-sort-icon" id="rtSort_projectName"></span>
                            </th>
                            <th class="rt-th-sortable" data-col="duration">
                                Duration
                                <span class="rt-sort-icon" id="rtSort_duration"></span>
                            </th>
                            <th class="rt-th-sortable" data-col="lastRunTime">
                                Last Run
                                <span class="rt-sort-icon" id="rtSort_lastRunTime">
                                    <i class="fas fa-sort-down"></i>
                                </span>
                            </th>
                            <th><i class="fas fa-moon" title="System goes down 22:00–05:00"></i></th>
                            <th>CloudBeat</th>
                            <th><i class="fas fa-users" title="Contacts"></i></th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="rtTableBody">
                        <tr>
                            <td colspan="10" class="rt-empty">
                                <i class="fas fa-spinner fa-spin"></i>
                                Loading...
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- פופאפ ניהול מיפויים -->
            <div id="rtMappingOverlay"
                class="rt-popup-overlay"
                style="display:none">
                <div class="rt-mapping-popup rt-mapping-popup-wide">
                    <div class="rt-popup-header">
                        <span class="rt-popup-title">
                            <i class="fas fa-link"></i>
                            CloudBeat Mappings
                        </span>
                        <button class="rt-popup-close" id="rtMappingClose">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- *** טאבים *** -->
                    <div class="rt-mapping-tabs">
                        <button class="rt-mapping-tab active"
                                data-tab="mappings">
                            <i class="fas fa-link"></i>
                            Mappings
                        </button>
                        <button class="rt-mapping-tab"
                                data-tab="missing">
                            <i class="fas fa-exclamation-triangle"
                            style="color:#f59e0b"></i>
                            Missing
                            <span class="rt-missing-badge"
                                id="rtMissingBadge"
                                style="display:none">0</span>
                        </button>
                    </div>

                    <!-- *** תוכן טאב מיפויים *** -->
                    <div class="rt-mapping-body"
                        id="rtMappingTabMappings">
                        <!-- טופס הוספה -->
                        <div class="rt-mapping-add-form">
                            <div class="rt-mapping-form-row">
                                <input id="rtMapTestIdInput"
                                    class="rt-map-input"
                                    type="text"
                                    placeholder="Test ID (e.g. 10005) *"
                                    dir="ltr"/>
                                <input id="rtMapCaseIdInput"
                                    class="rt-map-input"
                                    type="text"
                                    placeholder="CloudBeat Case ID *"
                                    dir="ltr"/>
                                <button class="rt-map-add-btn" id="rtMapAddBtn">
                                    <i class="fas fa-plus"></i> Add
                                </button>
                            </div>
                            <div id="rtMapFormMsg" class="rt-map-form-msg"></div>
                        </div>
                        <!-- טבלה -->
                        <div class="rt-mapping-table-wrap">
                            <table class="rt-mapping-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Test ID</th>
                                        <th>CloudBeat Case ID</th>
                                        <th>Added</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="rtMapTableBody">
                                    <tr>
                                        <td colspan="5" class="rt-map-empty">
                                            Loading...
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- *** תוכן טאב Missing *** -->
                    <div class="rt-mapping-body"
                        id="rtMappingTabMissing"
                        style="display:none">
                        <div id="rtMissingContent">
                            <div style="text-align:center;padding:20px;color:#555">
                                <i class="fas fa-spinner fa-spin"></i> Loading...
                            </div>
                        </div>
                    </div>

                </div>
            </div>
            <!-- פופאפ ניהול אנשי קשר -->
            <div id="rtContactsOverlay"
                class="rt-popup-overlay"
                style="display:none">
                <div class="rt-contacts-popup">
                    <div id="rtContactsContent"></div>
                </div>
            </div>
            <!-- פופאפ הרצת טסט -->
            <div id="rtRunTestOverlay"
                class="rt-popup-overlay"
                style="display:none">
                <div class="rt-run-test-popup">
                    <div id="rtRunTestContent"></div>
                </div>
            </div>

            <!-- פופאפ הוספת/עריכת מיפוי מהיר -->
            <div id="rtQuickMapOverlay"
                class="rt-popup-overlay"
                style="display:none">
                <div class="rt-quick-map-popup">
                    <div id="rtQuickMapContent"></div>
                </div>
            </div>
        </div>
        `;
    }

    // ==========================================
    // טעינת מיפויי TestId → CloudBeat
    // ==========================================
    async _loadTestCaseMappings() {
        try {
            const res = await fetch('/SuiteConfig/GetTestCaseMappings',
                { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                this._testCaseMappings = data.mappings || [];
                this._testCaseMappingCache = {};

                this._testCaseMappings.forEach(m => {
                    // *** מיפוי רגיל לפי testId ***
                    this._testCaseMappingCache[m.testId] = m;

                    // *** אם ה-testId הוא UUID (סוויטה) —
                    //     שמור גם בcache הרגיל, הלוגיקה
                    //     של suiteMapping תמצא אותו ***
                });
            }
        } catch (err) {
            console.warn('Could not load test case mappings:', err);
            this._testCaseMappings = [];
            this._testCaseMappingCache = {};
        }

        // *** חדש: טען גם suite_config כדי לקבל cloudBeatId לפי parentContainerUid ***
        try {
            const res = await fetch('/SuiteConfig/GetSuiteConfigs',
                { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                this._suiteConfigCache = {};
                (data.suites || []).forEach(s => {
                    if (s.parentUid && s.cloudBeatId) {
                        this._suiteConfigCache[s.parentUid] = s;
                    }
                });
            }
        } catch (err) {
            console.warn('Could not load suite configs:', err);
            this._suiteConfigCache = {};
        }
    }

    _getSuiteConfigByUid(parentUid) {
        if (!parentUid) return null;
        return this._suiteConfigCache?.[parentUid] || null;
    }

    _parseTestId(containerName, fallbackId = '') {
        if (!containerName) return fallbackId || '';
        const parts = containerName.split(' - ');
        if (parts.length < 2) return fallbackId || '';

        const catalogNum = parts[1].trim();

        // *** אם מספר קטלוגי הוא 9999 — השתמש ב-fallbackId (testId/containerUid) ***
        if (catalogNum === '9999') {
            return fallbackId || containerName;
        }

        return catalogNum;
    }

    // ==========================================
    // טעינת כל אנשי הקשר
    // ==========================================
    async _loadAllContacts() {
        try {
            // אסוף את כל ה-testIds הייחודיים
            const testIds = [...new Set(
                this.allTests
                    .map(t => {
                        const parsed = this._parseTestId(t.containerName, t.testId || t.id || '');
                        return parsed || t.testId || t.id || '';
                    }).filter(Boolean)
            )];

            if (!testIds.length) return;

            // שלוף אנשי קשר לכל testId במקביל (batch של 10)
            const batchSize = 10;
            for (let i = 0; i < testIds.length; i += batchSize) {
                const batch = testIds.slice(i, i + batchSize);
                await Promise.all(batch.map(async testId => {
                    try {
                        const res = await fetch(
                            `/SuiteResults/GetContacts?testId=${encodeURIComponent(testId)}`,
                            { credentials: 'include' }
                        );
                        const data = await res.json();
                        if (data.success) {
                            this._contactsCache[testId] = data.contacts || [];
                        }
                    } catch (err) {
                        // המשך בשקט
                    }
                }));
            }
        } catch (err) {
            console.warn('_loadAllContacts error:', err);
        }
    }

    _getMappingForTest(testId) {
        if (!testId) return null;
        return this._testCaseMappingCache[testId] || null;
    }

    _getStatusColors(statusLow) {
        switch (statusLow) {
            case 'passed':
                return {
                    bg: 'rgba(34,197,94,0.12)',
                    border: 'rgba(34,197,94,0.45)',
                    text: '#4ade80',
                    gFrom: '#16a34a',
                    gTo: '#15803d',
                    shadow: 'rgba(34,197,94,0.35)'
                };
            case 'failed':
                return {
                    bg: 'rgba(239,68,68,0.12)',
                    border: 'rgba(239,68,68,0.45)',
                    text: '#f87171',
                    gFrom: '#b91c1c',
                    gTo: '#991b1b',
                    shadow: 'rgba(239,68,68,0.35)'
                };
            case 'warning':
                return {
                    bg: 'rgba(245,158,11,0.12)',
                    border: 'rgba(245,158,11,0.45)',
                    text: '#fbbf24',
                    gFrom: '#b45309',
                    gTo: '#92400e',
                    shadow: 'rgba(245,158,11,0.35)'
                };
            default:
                return {
                    bg: 'rgba(100,100,100,0.1)',
                    border: '#2a2a4a',
                    text: '#666',
                    gFrom: '#333',
                    gTo: '#222',
                    shadow: 'rgba(0,0,0,0.2)'
                };
        }
    }

    // ==========================================
    // רינדור טבלה
    // ==========================================
    renderTable() {
        const tbody = document.getElementById('rtTableBody');
        if (!tbody) return;

        const tests = this.getFilteredTests();

        if (tests.length === 0) {
            tbody.innerHTML = `
        <tr>
            <td colspan="10" class="rt-empty">
                <i class="fas fa-inbox"></i>
                No tests found
            </td>
        </tr>`;
            return;
        }

        tbody.innerHTML = tests.map(test => {
            const statusLow = (test.status || '').toLowerCase();
            const isPassed = statusLow === 'passed';
            const isFailed = statusLow === 'failed';
            const isWarning = statusLow === 'warning';
            const sc = this._getStatusColors(statusLow);

            const statusIcon = isPassed
                ? `<i class="fas fa-check-circle" style="color:#22c55e"></i>`
                : isFailed
                    ? `<i class="fas fa-times-circle" style="color:#ef4444"></i>`
                    : isWarning
                        ? `<i class="fas fa-exclamation-circle" style="color:#f59e0b"></i>`
                        : `<i class="fas fa-question-circle" style="color:#666"></i>`;

            // Priority — קח מהשדה שמגיע מהשרת
            const priorityRaw = (test.priority || '').trim();
            const priorityHtml = priorityRaw
                ? `<span class="rt-priority ${priorityRaw.toLowerCase()}">
                   ${this.escHtml(priorityRaw)}
               </span>`
                : '<span style="color:#444">—</span>';

            const isNight = this._isDowntimeTest(
                test.containerName || test.testName || '');

            const nightHtml = isNight
                ? `<i class="fas fa-moon" style="color:#fbbf24"
                  title="System goes down 22:00–05:00"></i>`
                : '<span style="color:#333">—</span>';

            const testName = this.escHtml(
                test.containerName || test.testName || '-');

            // *** בנה tooltip עם שם סוויטה אם קיים ***
            const testDisplayName = test.containerName || test.testName || '-';

            const suiteTooltip =
                test.parentContainerName?.includes('Suite - ')
                    ? `${testDisplayName}\nSuite: ${test.parentContainerName}`
                    : testDisplayName;
            const testId = test.testId || test.id || '';
            const parsedId = this._parseTestId(test.containerName, test.testId || test.id || '');

            // הצגת שם פרויקט
            const projectName = test.projectName || '';
            const projectHtml = projectName
                ? `<span class="rt-project-badge"
                     title="${this.escHtml(projectName)}">
                   ${this.escHtml(this._shortProjectName(projectName))}
               </span>`
                : '<span style="color:#333">—</span>';

            // בנה URL לCloudBeat
            // פורמט: https://cloudbeat-prod.menora.co.il/#/cases/{projID}/{}/testID|/results

            const mapping = this._getMappingForTest(testId);
            // אנשי קשר
            const contacts = this._contactsCache?.[parsedId || testId] || [];
            const hasContacts = contacts.length > 0;
            const failedContacts = (test.status || '').toLowerCase() !== 'passed' && hasContacts;

            const mailTo = contacts.map(c => c.email).join(';');
            const cc = 'noc@menora.co.il';
            const mailSubject = encodeURIComponent(
                `[Test Failed] ${test.containerName || test.testName || ''}`
            );
            const mailBody = encodeURIComponent(
                `שלום,\n\nהבדיקה הבאה נכשלה:\n` +
                `שם: ${test.containerName || test.testName || ''}\n` +
                `סטטוס: ${test.status || '-'}\n` +
                `זמן ריצה: ${this.fmtDuration(test.durationSeconds)}\n` +
                `זמן ריצה אחרון: ${test.lastRunTime || '-'}\n` +
                `נא לבדוק.\n\nתודה`
            );
            const mailHref = (failedContacts && mailTo)
                ? `mailto:${mailTo}?cc=${encodeURIComponent(cc)}&subject=${mailSubject}&body=${mailBody}`
                : null;

            // *** בדוק אם הטסט שייך לסוויטה ***
            // *** בדוק אם הטסט שייך לסוויטה ***
            const belongsToSuite = test.parentContainerName?.includes('Suite - ');

            // *** אם הטסט שייך לסוויטה — חפש מיפוי לפי parentContainerUid ***
            // *** שלב 1: חפש ב-test_case_mapping ***
            const suiteMappingFromCache = (
                belongsToSuite &&
                test.parentContainerUid
            )
                ? this._getMappingForTest(test.parentContainerUid)
                : null;

            // *** שלב 2: אם לא נמצא ב-test_case_mapping,
            //            חפש ב-suite_config לפי parentContainerUid ***
            const suiteConfigEntry = (
                belongsToSuite &&
                test.parentContainerUid &&
                !suiteMappingFromCache
            )
                ? this._getSuiteConfigByUid(test.parentContainerUid)
                : null;

            // *** בנה אובייקט מיפוי מ-suite_config אם נמצא ***
            const suiteMappingFromConfig = suiteConfigEntry
                ? {
                    cloudBeatCaseId: suiteConfigEntry.cloudBeatId,
                    mappingType: 'suite',
                    testId: test.parentContainerUid
                }
                : null;

            // *** בחר את המיפוי הפעיל לפי עדיפות:
            //     1. test_case_mapping של הסוויטה
            //     2. suite_config של הסוויטה
            //     3. test_case_mapping של הטסט עצמו ***
            const suiteMapping = suiteMappingFromCache || suiteMappingFromConfig;
            const activeMapping = suiteMapping || mapping;

            const caseId = activeMapping?.cloudBeatCaseId || '';
            const mappingType = suiteMapping
                ? 'suite'
                : (activeMapping?.mappingType || 'case');
            const isSuiteMapping = mappingType === 'suite';
            const projectId = test.projectId || 0;

            const MAX_CHIPS = 2;
            const visibleContacts = contacts.slice(0, MAX_CHIPS);
            const hiddenCount = contacts.length - MAX_CHIPS;
            const allContactNames = contacts.map(c => this.escHtml(c.name)).join('\n');

            // קישור CloudBeat — רק אם יש caseId
            let cbLinkHtml;
            if (caseId && (projectId || isSuiteMapping)) {
                // *** בנה URL לפי סוג מיפוי ***
                const cbUrlFinal = isSuiteMapping
                    ? `https://cloudbeat-prod.menora.co.il/#/suites/${projectId || ''}/${caseId}/results`
                    : `https://cloudbeat-prod.menora.co.il/#/cases/${projectId}/${caseId}/results`;

                const cbTitle = isSuiteMapping
                    ? `CloudBeat Suite — ID: ${this.escHtml(caseId)}`
                    : `CloudBeat Case — ID: ${this.escHtml(caseId)}`;

                cbLinkHtml = `
                <a class="rt-cb-has-id ${isSuiteMapping ? 'rt-cb-suite' : ''}"
                href="${cbUrlFinal}"
                target="_blank"
                rel="noopener noreferrer"
                title="${cbTitle}"
                style="color:${sc.text};
                        background:${sc.bg};
                        border-color:${sc.border}">
                    <i class="fas fa-external-link-alt"></i>
                    <span>CloudBeat</span>
                </a>`;
            } else if (caseId) {
                // יש caseId אבל אין projectId — הצג בלי קישור
                cbLinkHtml = `
                <span class="rt-cb-has-id rt-cb-no-link"
                      title="Case ID: ${this.escHtml(caseId)} (project unknown)"
                        style="color:${sc.text};
                        background:${sc.bg};
                        border-color:${sc.border}">
                    <i class="fas fa-link"></i>
                    <span>${this.escHtml(caseId)}</span>
                </span>`;
            } else {
                cbLinkHtml = `
                <span class="rt-cb-no-id"
                      title="No CloudBeat ID — click + to add">
                    <i class="fas fa-unlink"></i>
                </span>`;
            }

            // כפתור Run — ירוק בולט
            const actionsHtml = `
            <div class="rt-actions-cell">
                <button class="rt-action-btn rt-rerun-btn
                            ${caseId ? '' : 'rt-btn-disabled'}"
                        data-test-id="${this.escHtml(testId)}"
                        data-case-id="${this.escHtml(caseId)}"
                        data-test-name="${this.escHtml(
                test.containerName || test.testName || '')}"
                        ${caseId ? '' : 'disabled'}
                        style="${caseId ? `
                            background: linear-gradient(
                                135deg, ${sc.gFrom} 0%, ${sc.gTo} 100%);
                            border-color: ${sc.border};
                            color: ${sc.text};
                            box-shadow: 0 2px 6px ${sc.shadow};` : ''}"
                        title="${caseId
                    ? 'Re-run this test in CloudBeat'
                    : 'No CloudBeat Case ID'}">
                    <i class="fas fa-play"></i>
                    <span>Run</span>
                </button>
                ${this.canEdit ? `
                <button class="rt-action-btn rt-map-btn"
                    data-test-id="${this.escHtml(testId)}"
                    data-test-name="${this.escHtml(
                        test.containerName || test.testName || '')}"
                        data-case-id="${this.escHtml(caseId)}"
                        data-project-name="${this.escHtml(test.projectName || '')}"
                        data-mapping-type="${this.escHtml(mappingType)}"
                    title="${activeMapping
                        ? 'Edit CloudBeat mapping'
                        : 'Add CloudBeat mapping'}">
                    <i class="fas fa-${activeMapping ? 'edit' : 'plus-circle'}"></i>
                </button>` : ''}
            </div>`;

            return `
            <tr class="rt-row ${statusLow}"
                data-test-id="${this.escHtml(testId)}">
                <td class="rt-td-name">
                    <span class="rt-test-name" title="${this.escHtml(suiteTooltip)}">
                        ${testName}
                    </span>
                </td>
                <td class="rt-td-status">
                    <span class="rt-status-badge ${statusLow}">
                        ${statusIcon}
                        ${this.escHtml(test.status || '-')}
                    </span>
                </td>
                <td class="rt-td-priority">
                    ${priorityHtml}
                </td>
                <td class="rt-td-project">
                    ${projectHtml}
                </td>
                <td class="rt-td-duration">
                    <i class="fas fa-clock"
                       style="color:#555;font-size:0.65rem;margin-left:3px"></i>
                    ${this.escHtml(this.fmtDuration(test.durationSeconds))}
                </td>
                <td class="rt-td-lastrun"
                    title="${this.escHtml(this._fmtFullDate(test.lastRunTime) || '')}">
                    ${this.fmtLastRun(test.lastRunTime)}
                </td>
                <td class="rt-td-night" style="text-align:center">
                    ${nightHtml}
                </td>
                <td class="rt-td-cb" style="text-align:center">
                    ${cbLinkHtml}
                </td>
                <td class="rt-td-contacts" style="text-align:center">
                    <div class="rt-contacts-cell">
                        ${hasContacts
                    ? `
                            ${visibleContacts.map(c => `
                                <div class="rt-contact-chip"
                                    title="${this.escHtml(c.name)}\n${this.escHtml(c.email)}${c.phone ? '\n' + this.escHtml(c.phone) : ''}">
                                    <span class="rt-contact-chip-avatar">
                                        ${this.escHtml(c.name.charAt(0).toUpperCase())}
                                    </span>
                                    <span class="rt-contact-chip-name">
                                        ${this.escHtml(c.name)}
                                    </span>
                                </div>
                            `).join('')}
                            ${hiddenCount > 0 ? `
                                <span class="rt-contact-chip-more"
                                    title="${allContactNames}">
                                    +${hiddenCount}
                                </span>
                            ` : ''}
                            `
                    : `<span class="rt-no-contacts" title="No contacts">—</span>`
                }
                        ${mailHref
                    ? `<a class="rt-contact-mail-icon"
                                href="${mailHref}"
                                target="_blank"
                                title="Send failure email to:\n${contacts.map(c => c.name).join('\n')}"
                                onclick="event.stopPropagation()">
                                <i class="fas fa-envelope"></i>
                            </a>`
                    : `<span class="rt-contact-mail-icon rt-contact-mail-passed"
                                    title="${contacts.map(c => c.name).join(', ')}">
                                <i class="fas fa-envelope"></i>
                            </span>`
                }
                        ${this.canEdit
                    ? `<button class="rt-contacts-manage-btn"
                                    data-test-id="${this.escHtml(parsedId || testId)}"
                                    data-test-name="${this.escHtml(test.containerName || test.testName || '')}"
                                    title="${hasContacts ? 'Manage contacts' : 'Add contacts'}">
                                <i class="fas fa-${hasContacts ? 'users-cog' : 'user-plus'}"></i>
                            </button>`
                    : ''
                }
                    </div>
                </td>
                <td class="rt-td-actions">
                    ${actionsHtml}
                </td>
            </tr>`;
        }).join('');
    }

    // קיצור שם פרויקט לתצוגה בטבלה
    _shortProjectName(projectName) {
        if (!projectName) return '';
        const map = {
            'תשתיות טכנולוגיות': 'תשתיות',
            'קטלוג מערכות - קריטיות תפעולית גבוהה': 'קריטיות',
            'Onit_to_Nihulit_Gvia_Elem_Linux': 'Onit'
        };
        return map[projectName] || projectName.substring(0, 10);
    }

    // ==========================================
    // עדכון אינדיקטורי מיון
    // ==========================================
    updateSortIndicators() {
        const cols = [
            'containerName', 'status', 'priority',
            'projectName', 'duration', 'lastRunTime'
        ];
        cols.forEach(col => {
            const el = document.getElementById(`rtSort_${col}`);
            if (!el) return;
            if (col === this.sortColumn) {
                el.innerHTML = this.sortDirection === 'asc'
                    ? '<i class="fas fa-sort-up"></i>'
                    : '<i class="fas fa-sort-down"></i>';
            } else {
                el.innerHTML =
                    '<i class="fas fa-sort" style="opacity:0.3"></i>';
            }
        });
    }

    _updateFilterBanner() {
        const banner = document.getElementById('rtFilterBanner');
        const tags = document.getElementById('rtFilterBannerTags');
        if (!banner || !tags) return;

        const hasSearch = this.searchTerm.trim().length > 0;
        const hasStatus = this.statusFilter !== 'all';
        const hasProject = this.projectFilter.length > 0;
        const hasPriority = this.priorityFilter.length > 0;

        const isActive = hasSearch || hasStatus || hasProject || hasPriority;

        banner.style.display = isActive ? 'flex' : 'none';

        const parts = [];

        // *** חיפוש ***
        if (hasSearch) {
            parts.push(`
            <span class="rt-filter-tag rt-filter-tag-search">
                <i class="fas fa-search"></i>
                ${this.escHtml(this.searchTerm.trim())}
                <button class="rt-filter-tag-remove"
                        data-clear="search"
                        title="Remove search filter">
                    <i class="fas fa-times"></i>
                </button>
            </span>`);
        }

        // *** סטטוס ***
        if (hasStatus) {
            const isPassed = this.statusFilter === 'passed';
            const isFailed = this.statusFilter === 'failed';
            const isWarning = this.statusFilter === 'warning';

            const color = isPassed ? '#22c55e'
                : isFailed ? '#ef4444'
                    : '#f59e0b';

            const icon = isPassed ? 'check-circle'
                : isFailed ? 'times-circle'
                    : 'exclamation-circle';

            parts.push(`
            <span class="rt-filter-tag"
                  style="border-color:${color}33;
                         background:${color}18;
                         color:${color}">
                <i class="fas fa-${icon}"></i>
                ${this.statusFilter.charAt(0).toUpperCase()
                + this.statusFilter.slice(1)}
                <button class="rt-filter-tag-remove"
                        data-clear="status"
                        title="Remove status filter"
                        style="color:${color}">
                    <i class="fas fa-times"></i>
                </button>
            </span>`);
        }

        // *** פרויקטים ***
        if (hasProject) {
            const label = this.projectFilter.length === 1
                ? this.escHtml(
                    this._shortProjectName(this.projectFilter[0]))
                : `${this.projectFilter.length} projects`;

            parts.push(`
            <span class="rt-filter-tag rt-filter-tag-project">
                <i class="fas fa-folder"></i>
                ${label}
                <button class="rt-filter-tag-remove"
                        data-clear="project"
                        title="Remove project filter">
                    <i class="fas fa-times"></i>
                </button>
            </span>`);
        }

        // *** עדיפויות ***
        if (hasPriority) {
            const label = this.priorityFilter.length === 1
                ? this.escHtml(this.priorityFilter[0])
                : `${this.priorityFilter.length} priorities`;

            parts.push(`
            <span class="rt-filter-tag rt-filter-tag-priority">
                <i class="fas fa-flag"></i>
                ${label}
                <button class="rt-filter-tag-remove"
                        data-clear="priority"
                        title="Remove priority filter">
                    <i class="fas fa-times"></i>
                </button>
            </span>`);
        }

        tags.innerHTML = parts.join(`
        <span style="color:#444;font-size:0.65rem">
            <i class="fas fa-plus"></i>
        </span>`);
    }

    // ==========================================
    // אירועים - ללא rtHoursSelect
    // ==========================================
    bindEvents() {
        // *** חיפוש ***
        document.addEventListener('input', e => {
            if (e.target.id === 'rtSearchInput') {
                this.searchTerm = e.target.value;

                const clearBtn = document.getElementById('rtClearSearch');
                if (clearBtn)
                    clearBtn.style.display =
                        e.target.value ? 'flex' : 'none';

                // *** שמור בקאש ***
                this._saveFiltersToCache();

                this._updateFilterBanner();
                this.renderTable();
            }
        });

        document.addEventListener('change', e => {
            if (e.target.id === 'rtProjectFilter') {
                this.projectFilter = e.target.value;
                this._updateFilterBanner(); // *** הוסף ***
                this.renderTable();
            }
            if (e.target.id === 'rtPriorityFilter') {
                this.priorityFilter = e.target.value;
                this._updateFilterBanner(); // *** הוסף ***
                this.renderTable();
            }
        });

        document.addEventListener('click', e => {

            // *** מעבר בין טאבים בפופאפ מיפויים ***
            const mappingTab = e.target.closest('.rt-mapping-tab');
            if (mappingTab) {
                const tabName = mappingTab.getAttribute('data-tab');
                if (tabName) this._switchMappingTab(tabName);
                return;
            }

            // *** כפתור Add CB מתוך Missing tab ***
            const missingAddCbBtn =
                e.target.closest('.rt-missing-add-cb');
            if (missingAddCbBtn) {
                const testId = missingAddCbBtn.dataset.testId || '';
                const testName = missingAddCbBtn.dataset.testName || '';
                const caseId = missingAddCbBtn.dataset.caseId || '';
                const projectName = missingAddCbBtn.dataset.projectName || '';
                const mappingType = missingAddCbBtn.dataset.mappingType || 'case';
                this.openQuickMapPopup(
                    testId, testName, caseId, projectName, mappingType);
                return;
            }

            // *** כפתור Add Contact מתוך Missing tab ***
            const missingAddContactBtn =
                e.target.closest('.rt-missing-add-contact');
            if (missingAddContactBtn) {
                const testId = missingAddContactBtn.dataset.testId || '';
                const testName = missingAddContactBtn.dataset.testName || '';
                if (testId) this.openContactsPopup(testId, testName);
                return;
            }

            // ניקוי חיפוש
            if (e.target.closest('#rtClearSearch')) {
                this.searchTerm = '';
                const inp = document.getElementById('rtSearchInput');
                if (inp) inp.value = '';
                const clearBtn = document.getElementById('rtClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';

                // *** שמור בקאש ***
                this._saveFiltersToCache();

                this._updateFilterBanner();
                this.renderTable();
            }

            // כפתורי סינון סטטוס
            const filterBtn = e.target.closest('.rt-filter-btn');
            if (filterBtn) {
                this.statusFilter = filterBtn.getAttribute('data-f');

                document.querySelectorAll('.rt-filter-btn')
                    .forEach(btn => {
                        btn.classList.toggle(
                            'active',
                            btn.getAttribute('data-f') === this.statusFilter
                        );
                    });

                // *** שמור בקאש ***
                this._saveFiltersToCache();

                this._updateFilterBanner();
                this.renderTable();
            }

            // רענון
            if (e.target.closest('#rtRefreshBtn'))
                this.loadData();

            // מיון
            const th = e.target.closest('.rt-th-sortable');
            if (th) {
                const col = th.getAttribute('data-col');
                if (col) this.setSort(col);
            }


            // פתיחת ניהול מיפויים
            if (e.target.closest('#rtManageMappingsBtn'))
                this.openMappingPopup();

            // סגירת פופאפ מיפויים
            if (e.target.id === 'rtMappingOverlay')
                this.closeMappingPopup();
            if (e.target.closest('#rtMappingClose'))
                this.closeMappingPopup();

            // הוספת מיפוי
            if (e.target.closest('#rtMapAddBtn'))
                this.addMapping();

            // עריכת מיפוי
            const mapEditBtn = e.target.closest('.rt-map-edit-btn');
            if (mapEditBtn) {
                const id = parseInt(mapEditBtn.dataset.id);
                const caseId = mapEditBtn.dataset.caseId || '';
                this.editMapping(id, caseId);
            }

            // מחיקת מיפוי
            const mapDelBtn = e.target.closest('.rt-map-del-btn');
            if (mapDelBtn) {
                const id = parseInt(mapDelBtn.dataset.id);
                this.deleteMapping(id);
            }

            // כפתור Re-run בשורת טסט
            const rerunBtn = e.target.closest('.rt-rerun-btn');
            if (rerunBtn && !rerunBtn.disabled) {
                const caseId = rerunBtn.dataset.caseId || '';
                const testName = rerunBtn.dataset.testName || '';
                const testId = rerunBtn.dataset.testId || '';
                if (caseId) this.openRunTestPopup(testId, testName, caseId);
            }

            // כפתור Map בשורת טסט
            const mapBtn = e.target.closest('.rt-map-btn');
            if (mapBtn) {
                const testId = mapBtn.dataset.testId || '';
                const testName = mapBtn.dataset.testName || '';
                const caseId = mapBtn.dataset.caseId || '';
                const projectName = mapBtn.dataset.projectName || '';
                const mappingType = mapBtn.dataset.mappingType || 'case';
                this.openQuickMapPopup(testId, testName, caseId, projectName, mappingType);  // *** עדכן ***
            }

            // סגירת Quick Map
            if (e.target.id === 'rtQuickMapOverlay')
                this.closeQuickMapPopup();
            if (e.target.closest('#rtQuickMapClose'))
                this.closeQuickMapPopup();
            if (e.target.closest('#rtQmCancelBtn'))
                this.closeQuickMapPopup();

            // שמירת Quick Map
            const qmSaveBtn = e.target.closest('#rtQmSaveBtn');
            if (qmSaveBtn) {
                const testId = qmSaveBtn.dataset.testId || '';
                const isEdit = qmSaveBtn.dataset.isEdit === '1';
                this.saveQuickMapping(testId, isEdit);
            }

            // סגירת Run Test
            if (e.target.id === 'rtRunTestOverlay')
                this.closeRunTestPopup();
            if (e.target.closest('#rtRunTestClose'))
                this.closeRunTestPopup();
            if (e.target.closest('#rtRunTestCancelBtn'))
                this.closeRunTestPopup();

            // אישור הרצת טסט
            const runTestConfirmBtn = e.target.closest('#rtRunTestConfirmBtn');
            if (runTestConfirmBtn && !runTestConfirmBtn.disabled) {
                const caseId = runTestConfirmBtn.dataset.caseId || '';
                const testName = runTestConfirmBtn.dataset.testName || '';
                if (caseId) this.runTest(caseId, testName);
            }

            // בחירת כרטיס מריץ בפופאפ הרצה
            const runnerCard = e.target.closest('.rt-run-runner-card');
            if (runnerCard) {
                const radio = runnerCard.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    document.querySelectorAll('.rt-run-runner-card')
                        .forEach(c => c.classList.remove('selected'));
                    runnerCard.classList.add('selected');
                    this._lastRunnerType = radio.value;
                    localStorage.setItem('rtLastRunnerType', radio.value);
                }
            }

            // בחירת כרטיס סוג מיפוי
            const qmTypeCard = e.target.closest('.rt-qm-type-card');
            if (qmTypeCard) {
                const radio = qmTypeCard.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    document.querySelectorAll('.rt-qm-type-card')
                        .forEach(c => c.classList.remove('selected'));
                    qmTypeCard.classList.add('selected');
                }
            }

            // *** פתיחת/סגירת dropdown ***
            const msBtn = e.target.closest('.rt-ms-btn');
            if (msBtn) {
                const dropId = msBtn.dataset.drop;
                const drop = document.getElementById(dropId);
                if (!drop) return;

                const isOpen = drop.style.display !== 'none';

                // סגור כל הדרופדאונים
                document.querySelectorAll('.rt-ms-dropdown')
                    .forEach(d => d.style.display = 'none');
                document.querySelectorAll('.rt-ms-btn')
                    .forEach(b => b.classList.remove('open'));

                if (!isOpen) {
                    drop.style.display = 'block';
                    msBtn.classList.add('open');
                    drop.querySelector('.rt-ms-search')?.focus();
                }
                return;
            }

            // *** סגור dropdown בלחיצה מחוץ ***
            if (!e.target.closest('.rt-ms-wrap')) {
                document.querySelectorAll('.rt-ms-dropdown')
                    .forEach(d => d.style.display = 'none');
                document.querySelectorAll('.rt-ms-btn')
                    .forEach(b => b.classList.remove('open'));
            }

            // *** checkbox "All" ***
            const chkAll = e.target.closest('.rt-ms-chk-all');
            if (chkAll) {
                const drop = document.getElementById(chkAll.dataset.drop);
                if (!drop) return;

                drop.querySelectorAll('.rt-ms-chk-item')
                    .forEach(c => c.checked = false);
                chkAll.checked = true;

                drop._selected = [];
                drop._onChange([]);

                // *** שמור בקאש ***
                this._saveFiltersToCache();

                this._syncMultiSelectLabel(drop);
                return;
            }

            // *** checkbox פריט ***
            const chkItem = e.target.closest('.rt-ms-chk-item');
            if (chkItem) {
                const drop = document.getElementById(chkItem.dataset.drop);
                if (!drop) return;

                const val = chkItem.dataset.val;

                if (chkItem.checked) {
                    if (!drop._selected.includes(val))
                        drop._selected.push(val);
                } else {
                    drop._selected =
                        drop._selected.filter(v => v !== val);
                }

                const chkAllEl = drop.querySelector('.rt-ms-chk-all');
                if (chkAllEl)
                    chkAllEl.checked = drop._selected.length === 0;

                drop._onChange([...drop._selected]);

                // *** שמור בקאש ***
                this._saveFiltersToCache();

                this._syncMultiSelectLabel(drop);
                return;
            }

            // *** ניקוי כל הסינונים ***
            if (e.target.closest('#rtClearAllFilters')) {
                this._clearAllFilters();
                return;
            }

            // *** ניקוי סינון בודד מהתג ***
            const tagRemoveBtn = e.target.closest('.rt-filter-tag-remove');
            if (tagRemoveBtn) {
                const clearType = tagRemoveBtn.dataset.clear;
                this._clearSingleFilter(clearType);
                return;
            }

            // פתיחת פופאפ אנשי קשר
            const contactsManageBtn = e.target.closest('.rt-contacts-manage-btn');
            if (contactsManageBtn) {
                const testId = contactsManageBtn.dataset.testId || '';
                const testName = contactsManageBtn.dataset.testName || '';
                if (testId) this.openContactsPopup(testId, testName);
                return;
            }

            // סגירת פופאפ אנשי קשר
            if (e.target.id === 'rtContactsOverlay')
                this.closeContactsPopup();
            if (e.target.closest('#rtContactsClose'))
                this.closeContactsPopup();

            // הוספת איש קשר
            if (e.target.closest('#rtContactAddBtn')) {
                const testId = e.target.closest('#rtContactAddBtn').dataset.testId || '';
                if (testId) this._addContact(testId);
                return;
            }

            // עריכת איש קשר
            const rtContactEditBtn = e.target.closest('.rt-contact-edit-btn');
            if (rtContactEditBtn) {
                const contactId = parseInt(rtContactEditBtn.dataset.contactId);
                const testId = rtContactEditBtn.dataset.testId || '';
                const name = rtContactEditBtn.dataset.contactName || '';
                const email = rtContactEditBtn.dataset.contactEmail || '';
                const phone = rtContactEditBtn.dataset.contactPhone || '';
                this._editContactInline(contactId, testId, name, email, phone);
                return;
            }

            // שמירת עריכה
            const rtContactSaveBtn = e.target.closest('.rt-contact-save-btn');
            if (rtContactSaveBtn) {
                const contactId = parseInt(rtContactSaveBtn.dataset.contactId);
                const testId = rtContactSaveBtn.dataset.testId || '';
                this._saveContact(contactId, testId);
                return;
            }

            // ביטול עריכה
            const rtContactCancelBtn = e.target.closest('.rt-contact-cancel-btn');
            if (rtContactCancelBtn) {
                const contactId = parseInt(rtContactCancelBtn.dataset.contactId);
                this._cancelEditContact(contactId);
                return;
            }

            // מחיקת איש קשר
            const rtContactDelBtn = e.target.closest('.rt-contact-del-btn');
            if (rtContactDelBtn) {
                const contactId = parseInt(rtContactDelBtn.dataset.contactId);
                const testId = rtContactDelBtn.dataset.testId || '';
                this._deleteContact(contactId, testId);
                return;
            }

            // Lookup טלפון — הוספה
            if (e.target.closest('#rtContactLookupBtn')) {
                this._lookupPhone(null);
                return;
            }

            // Lookup טלפון — עריכה
            const rtEditLookupBtn = e.target.closest('[id^="rtEditLookupBtn_"]');
            if (rtEditLookupBtn) {
                const editId = rtEditLookupBtn.dataset.editId || '';
                this._lookupPhone(editId);
                return;
            }

            // Export
            if (e.target.closest('#rtExportBtn'))
                this.exportToExcel();
        });
    }



    _clearAllFilters() {
        this.searchTerm = '';
        this.statusFilter = 'all';
        this.projectFilter = [];
        this.priorityFilter = [];

        const inp = document.getElementById('rtSearchInput');
        if (inp) inp.value = '';

        const clearBtn = document.getElementById('rtClearSearch');
        if (clearBtn) clearBtn.style.display = 'none';

        document.querySelectorAll('.rt-filter-btn').forEach(btn => {
            btn.classList.toggle(
                'active',
                btn.getAttribute('data-f') === 'all'
            );
        });

        ['rtProjectDropdown', 'rtPriorityDropdown'].forEach(dropId => {
            const drop = document.getElementById(dropId);
            if (!drop) return;
            drop._selected = [];
            drop.querySelectorAll('.rt-ms-chk-item')
                .forEach(c => c.checked = false);
            const chkAll = drop.querySelector('.rt-ms-chk-all');
            if (chkAll) chkAll.checked = true;
            this._syncMultiSelectLabel(drop);
        });

        // *** נקה קאש ***
        this._clearFiltersCache();

        this._updateFilterBanner();
        this.renderTable();
    }

    _clearSingleFilter(type) {
        switch (type) {

            case 'search':
                this.searchTerm = '';
                const inp = document.getElementById('rtSearchInput');
                if (inp) inp.value = '';
                const clearBtn = document.getElementById('rtClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';
                break;

            case 'status':
                this.statusFilter = 'all';
                document.querySelectorAll('.rt-filter-btn').forEach(btn => {
                    btn.classList.toggle(
                        'active',
                        btn.getAttribute('data-f') === 'all'
                    );
                });
                break;

            case 'project':
                this.projectFilter = [];
                const projDrop =
                    document.getElementById('rtProjectDropdown');
                if (projDrop) {
                    projDrop._selected = [];
                    projDrop.querySelectorAll('.rt-ms-chk-item')
                        .forEach(c => c.checked = false);
                    const chkAll = projDrop.querySelector('.rt-ms-chk-all');
                    if (chkAll) chkAll.checked = true;
                    this._syncMultiSelectLabel(projDrop);
                }
                break;

            case 'priority':
                this.priorityFilter = [];
                const priDrop =
                    document.getElementById('rtPriorityDropdown');
                if (priDrop) {
                    priDrop._selected = [];
                    priDrop.querySelectorAll('.rt-ms-chk-item')
                        .forEach(c => c.checked = false);
                    const chkAll = priDrop.querySelector('.rt-ms-chk-all');
                    if (chkAll) chkAll.checked = true;
                    this._syncMultiSelectLabel(priDrop);
                }
                break;
        }

        // *** שמור בקאש ***
        this._saveFiltersToCache();

        this._updateFilterBanner();
        this.renderTable();
    }

    _syncMultiSelectLabel(drop) {
        const btn = document.getElementById(drop._btnId);
        if (!btn) return;
        const labelEl = btn.querySelector('.rt-ms-label');
        if (!labelEl) return;

        const placeholder = btn.dataset.placeholder || 'All';

        if (drop._selected.length === 0) {
            labelEl.textContent = placeholder;
        } else if (drop._selected.length === 1) {
            const raw = drop._labelFn(drop._selected[0]);
            // הסר HTML entities בסיסיות
            labelEl.textContent = raw
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
        } else {
            labelEl.textContent = `${drop._selected.length} selected`;
        }
    }

    // ==========================================
    // UI helpers
    // ==========================================
    showLoading(show) {
        const el = document.getElementById('rtLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    showError(msg) {
        const el = document.getElementById('rtError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => {
                el.style.display = 'none';
            }, 6000);
        }
    }

    updateLastRefresh() {
        const el = document.getElementById('rtLastRefresh');
        if (!el) return;
        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const ss = now.getSeconds().toString().padStart(2, '0');
        el.textContent = `Updated: ${hh}:${mm}:${ss}`;
    }

    fmtDuration(sec) {
        if (!sec || sec <= 0) return '-';
        if (sec < 60) return `${Math.round(sec)}s`;
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        return `${m}m ${s}s`;
    }

    fmtLastRun(isoStr) {
        if (!isoStr) return '-';
        try {
            // אם אין Z ואין + — הזמן כבר בשעון ישראל
            const isUtc = isoStr.endsWith('Z') || isoStr.includes('+');
            const d = isUtc ? new Date(isoStr) : new Date(isoStr + 'Z');

            const now = new Date();
            const diffMs = now - d;
            const diffMin = Math.floor(diffMs / 60000);

            if (diffMin < 1) return 'just now';
            if (diffMin < 60) return `${diffMin}m ago`;

            const diffH = Math.floor(diffMin / 60);
            if (diffH < 24) return `${diffH}h ago`;

            const dd = d.getDate().toString().padStart(2, '0');
            const mo = (d.getMonth() + 1).toString().padStart(2, '0');
            const hh = d.getHours().toString().padStart(2, '0');
            const mi = d.getMinutes().toString().padStart(2, '0');
            return `${dd}/${mo} ${hh}:${mi}`;
        } catch { return '-'; }
    }

    _fmtFullDate(isoStr) {
        if (!isoStr) return '-';
        try {
            // אם אין Z ואין + — הזמן כבר בשעון ישראל, אל תוסיף Z
            const isUtc = isoStr.endsWith('Z') || isoStr.includes('+');
            const d = isUtc ? new Date(isoStr) : new Date(isoStr + 'Z');

            // אם UTC — המר לשעון ישראל
            if (isUtc) {
                return new Intl.DateTimeFormat('he-IL', {
                    timeZone: 'Asia/Jerusalem',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                }).format(d);
            }

            // כבר שעון ישראל — הצג ישירות
            const dd = d.getDate().toString().padStart(2, '0');
            const mm = (d.getMonth() + 1).toString().padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh = d.getHours().toString().padStart(2, '0');
            const mi = d.getMinutes().toString().padStart(2, '0');
            const ss = d.getSeconds().toString().padStart(2, '0');
            return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
        } catch { return '-'; }
    }

    escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _switchMappingTab(tabName) {
        // עדכן כפתורי טאב
        document.querySelectorAll('.rt-mapping-tab').forEach(btn => {
            btn.classList.toggle(
                'active',
                btn.getAttribute('data-tab') === tabName
            );
        });

        // הצג/הסתר תוכן
        const mappingsTab = document.getElementById('rtMappingTabMappings');
        const missingTab = document.getElementById('rtMappingTabMissing');

        if (mappingsTab)
            mappingsTab.style.display =
                tabName === 'mappings' ? 'flex' : 'none';
        if (missingTab)
            missingTab.style.display =
                tabName === 'missing' ? 'flex' : 'none';
    }

    _renderMissingMappingsTab() {
        const content = document.getElementById('rtMissingContent');
        const badge = document.getElementById('rtMissingBadge');
        if (!content) return;

        const tests = this.allTests;

        // *** בנה רשימת טסטים חסרים ***
        const missingCb = [];  // חסר CloudBeat ID
        const missingContacts = [];  // חסר אנשי קשר
        const missingBoth = [];  // חסר שניהם

        tests.forEach(test => {
            const testId = test.testId || test.id || '';
            const parsedId = this._parseTestId(
                test.containerName, test.testId || test.id || '');

            // *** בדוק CloudBeat mapping ***
            const mapping = this._getMappingForTest(testId);

            // *** בדוק גם suite mapping ***
            const belongsToSuite =
                test.parentContainerName?.includes('Suite - ');
            const suiteMappingFromCache = (
                belongsToSuite && test.parentContainerUid
            ) ? this._getMappingForTest(test.parentContainerUid) : null;

            const suiteConfigEntry = (
                belongsToSuite &&
                test.parentContainerUid &&
                !suiteMappingFromCache
            ) ? this._getSuiteConfigByUid(test.parentContainerUid) : null;

            const suiteMappingFromConfig = suiteConfigEntry
                ? { cloudBeatCaseId: suiteConfigEntry.cloudBeatId }
                : null;

            const activeMapping =
                suiteMappingFromCache ||
                suiteMappingFromConfig ||
                mapping;

            const hasCb = !!(activeMapping?.cloudBeatCaseId);
            const contacts = this._contactsCache?.[parsedId || testId] || [];
            const hasContacts = contacts.length > 0;

            if (!hasCb && !hasContacts) {
                missingBoth.push(test);
            } else if (!hasCb) {
                missingCb.push(test);
            } else if (!hasContacts) {
                missingContacts.push(test);
            }
        });

        const totalMissing =
            missingBoth.length +
            missingCb.length +
            missingContacts.length;

        // *** עדכן badge ***
        if (badge) {
            badge.textContent = totalMissing;
            badge.style.display = totalMissing > 0 ? 'inline-flex' : 'none';
        }

        if (totalMissing === 0) {
            content.innerHTML = `
        <div class="rt-missing-empty">
            <i class="fas fa-check-circle"
               style="color:#22c55e;font-size:2rem"></i>
            <div style="color:#22c55e;font-weight:600;
                        font-size:0.95rem;margin-top:8px">
                All tests have mappings and contacts!
            </div>
            <div style="color:#555;font-size:0.8rem;margin-top:4px">
                ${tests.length} tests checked
            </div>
        </div>`;
            return;
        }

        // *** בנה HTML ***
        const buildSection = (title, icon, color, items, type) => {
            if (!items.length) return '';

            const rows = items.map(test => {
                const testId = test.testId || test.id || '';
                const parsedId = this._parseTestId(
                    test.containerName,
                    test.testId || test.id || '');
                const name = this.escHtml(
                    test.containerName || test.testName || '-');
                const statusLow = (test.status || '').toLowerCase();

                const statusDot =
                    statusLow === 'passed'
                        ? `<span class="rt-missing-dot passed"></span>`
                        : statusLow === 'failed'
                            ? `<span class="rt-missing-dot failed"></span>`
                            : statusLow === 'warning'
                                ? `<span class="rt-missing-dot warning"></span>`
                                : `<span class="rt-missing-dot"></span>`;

                // *** כפתורי פעולה לפי סוג חסר ***
                const addCbBtn = (type === 'cb' || type === 'both')
                    ? `<button class="rt-missing-action-btn rt-missing-add-cb"
                           data-test-id="${this.escHtml(testId)}"
                           data-test-name="${this.escHtml(
                        test.containerName || test.testName || '')}"
                           data-case-id=""
                           data-project-name="${this.escHtml(
                            test.projectName || '')}"
                           data-mapping-type="case"
                           title="Add CloudBeat ID">
                       <i class="fas fa-plus-circle"
                          style="color:#4ade80"></i>
                       <span>Add CB</span>
                   </button>`
                    : '';

                const addContactBtn = (type === 'contacts' || type === 'both')
                    ? `<button class="rt-missing-action-btn rt-missing-add-contact"
                           data-test-id="${this.escHtml(parsedId || testId)}"
                           data-test-name="${this.escHtml(
                        test.containerName || test.testName || '')}"
                           title="Add Contact">
                       <i class="fas fa-user-plus"
                          style="color:#7ab3ef"></i>
                       <span>Add Contact</span>
                   </button>`
                    : '';

                return `
            <tr class="rt-missing-row">
                <td class="rt-missing-td-name">
                    ${statusDot}
                    <span class="rt-missing-test-name"
                          title="${name}">
                        ${name}
                    </span>
                </td>
                <td class="rt-missing-td-id"
                    style="font-family:monospace;
                           color:#fbbf24;font-size:0.75rem">
                    ${this.escHtml(parsedId || testId || '-')}
                </td>
                <td class="rt-missing-td-project">
                    ${test.projectName
                        ? `<span class="rt-project-badge"
                                 title="${this.escHtml(test.projectName)}">
                               ${this.escHtml(
                            this._shortProjectName(test.projectName))}
                           </span>`
                        : '<span style="color:#333">—</span>'}
                </td>
                <td class="rt-missing-td-actions">
                    <div style="display:flex;gap:5px;
                                justify-content:flex-end">
                        ${addCbBtn}
                        ${addContactBtn}
                    </div>
                </td>
            </tr>`;
            }).join('');

            return `
        <div class="rt-missing-section">
            <div class="rt-missing-section-header"
                 style="border-left-color:${color}">
                <i class="fas fa-${icon}"
                   style="color:${color}"></i>
                <span>${title}</span>
                <span class="rt-missing-count"
                      style="background:${color}22;
                             border-color:${color}55;
                             color:${color}">
                    ${items.length}
                </span>
            </div>
            <div class="rt-mapping-table-wrap">
                <table class="rt-mapping-table rt-missing-table">
                    <thead>
                        <tr>
                            <th style="min-width:280px">Test Name</th>
                            <th>Test ID</th>
                            <th>Project</th>
                            <th style="text-align:right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </div>`;
        };

        content.innerHTML = `
    <div class="rt-missing-summary">
        <div class="rt-missing-summary-item both">
            <i class="fas fa-times-circle"></i>
            <span class="rt-missing-summary-num">
                ${missingBoth.length}
            </span>
            <span class="rt-missing-summary-label">
                Missing Both
            </span>
        </div>
        <div class="rt-missing-summary-item cb">
            <i class="fas fa-unlink"></i>
            <span class="rt-missing-summary-num">
                ${missingCb.length}
            </span>
            <span class="rt-missing-summary-label">
                No CloudBeat ID
            </span>
        </div>
        <div class="rt-missing-summary-item contacts">
            <i class="fas fa-user-slash"></i>
            <span class="rt-missing-summary-num">
                ${missingContacts.length}
            </span>
            <span class="rt-missing-summary-label">
                No Contacts
            </span>
        </div>
        <div class="rt-missing-summary-item total">
            <i class="fas fa-list"></i>
            <span class="rt-missing-summary-num">
                ${tests.length}
            </span>
            <span class="rt-missing-summary-label">
                Total Tests
            </span>
        </div>
    </div>

    <!-- *** חיפוש בתוך Missing *** -->
    <div class="rt-missing-search-wrap">
        <i class="fas fa-search"
           style="position:absolute;left:9px;
                  color:#555;font-size:0.8rem;
                  pointer-events:none"></i>
        <input id="rtMissingSearch"
               class="rt-map-input"
               type="text"
               placeholder="Filter missing tests..."
               style="padding-left:28px;width:100%;
                      box-sizing:border-box"
               dir="ltr"/>
    </div>

    <div id="rtMissingSections">
        ${buildSection(
            'Missing Both — No CloudBeat ID & No Contacts',
            'times-circle', '#ef4444',
            missingBoth, 'both'
        )}
        ${buildSection(
            'Missing CloudBeat ID',
            'unlink', '#f59e0b',
            missingCb, 'cb'
        )}
        ${buildSection(
            'Missing Contacts',
            'user-slash', '#7ab3ef',
            missingContacts, 'contacts'
        )}
    </div>`;

        // *** חיפוש בתוך Missing ***
        const searchInput =
            document.getElementById('rtMissingSearch');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const term = searchInput.value.toLowerCase();
                document.querySelectorAll('.rt-missing-row')
                    .forEach(row => {
                        const text =
                            row.textContent.toLowerCase();
                        row.style.display =
                            text.includes(term) ? '' : 'none';
                    });
            });
        }
    }

    // ==========================================
    // פתיחת פופאפ ניהול מיפויים
    // ==========================================
    async openMappingPopup() {
        const overlay = document.getElementById('rtMappingOverlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // *** הצג תמיד את טאב Mappings ראשון ***
        this._switchMappingTab('mappings');

        await this._renderMappingTable();

        // *** רנדר טאב Missing ברקע ***
        this._renderMissingMappingsTab();
    }

    closeMappingPopup() {
        const overlay = document.getElementById('rtMappingOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    async _renderMappingTable() {
        const tbody = document.getElementById('rtMapTableBody');
        if (!tbody) return;

        await this._loadTestCaseMappings();
        const mappings = this._testCaseMappings;

        if (!mappings.length) {
            tbody.innerHTML = `
        <tr>
            <td colspan="5" class="rt-map-empty">
                No mappings configured
            </td>
        </tr>`;
            return;
        }

        tbody.innerHTML = mappings.map(m => `
        <tr data-id="${m.id}">
            <td style="color:#888">${m.id}</td>
            <td style="font-family:monospace;color:#fbbf24;
                       font-weight:700">
                ${this.escHtml(m.testId)}
            </td>
            <td style="font-family:monospace;color:#4ade80">
                ${this.escHtml(m.cloudBeatCaseId)}
            </td>
            <td style="color:#555;font-size:0.75rem">
                ${this.escHtml(m.addedAt?.substring(0, 10) || '')}
            </td>
            <td>
                <div style="display:flex;gap:5px">
                    <button class="rt-map-edit-btn"
                            data-id="${m.id}"
                            data-case-id="${this.escHtml(m.cloudBeatCaseId)}"
                            title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="rt-map-del-btn"
                            data-id="${m.id}"
                            title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
    }

    async addMapping() {
        const testIdInput = document.getElementById('rtMapTestIdInput');
        const caseIdInput = document.getElementById('rtMapCaseIdInput');
        const addBtn = document.getElementById('rtMapAddBtn');

        const testId = testIdInput?.value?.trim() || '';
        const caseId = caseIdInput?.value?.trim() || '';

        if (!testId) {
            this._showMapMsg('Please enter Test ID', 'error');
            return;
        }
        if (!caseId) {
            this._showMapMsg('Please enter CloudBeat Case ID', 'error');
            return;
        }

        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const res = await fetch('/SuiteConfig/AddTestCaseMapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ testId, cloudBeatCaseId: caseId })
            });
            const data = await res.json();

            if (data.success) {
                this._showMapMsg('Mapping added successfully ✓', 'success');
                if (testIdInput) testIdInput.value = '';
                if (caseIdInput) caseIdInput.value = '';
                await this._loadTestCaseMappings();
                await this._renderMappingTable();
                this._renderMissingMappingsTab();
                this.renderTable();
            } else {
                this._showMapMsg(data.message || 'Error', 'error');
            }
        } catch (err) {
            this._showMapMsg('Communication error', 'error');
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
            }
        }
    }

    async deleteMapping(id) {
        if (!confirm('Delete this mapping?')) return;

        try {
            const res = await fetch('/SuiteConfig/DeleteTestCaseMapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id })
            });
            const data = await res.json();

            if (data.success) {
                this._showMapMsg('Deleted successfully ✓', 'success');
                await this._loadTestCaseMappings();
                await this._renderMappingTable();
                this._renderMissingMappingsTab();
                this.renderTable();
            } else {
                this._showMapMsg(data.message || 'Error', 'error');
            }
        } catch (err) {
            this._showMapMsg('Communication error', 'error');
        }
    }

    async editMapping(id, currentCaseId) {
        const newCaseId = prompt(
            'CloudBeat Case ID:', currentCaseId || '');
        if (newCaseId === null) return;

        if (!newCaseId.trim()) {
            this._showMapMsg('Case ID cannot be empty', 'error');
            return;
        }

        try {
            const res = await fetch('/SuiteConfig/UpdateTestCaseMapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id,
                    cloudBeatCaseId: newCaseId.trim()
                })
            });
            const data = await res.json();

            if (data.success) {
                this._showMapMsg('Updated successfully ✓', 'success');
                await this._loadTestCaseMappings();
                await this._renderMappingTable();
                this._renderMissingMappingsTab();
                this.renderTable();
            } else {
                this._showMapMsg(data.message || 'Error', 'error');
            }
        } catch (err) {
            this._showMapMsg('Communication error', 'error');
        }
    }

    _showMapMsg(msg, type = 'info') {
        const el = document.getElementById('rtMapFormMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `rt-map-form-msg ${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    // ==========================================
    // פופאפ מיפוי מהיר — מכפתור + בשורת טסט
    // ==========================================
    openQuickMapPopup(testId, testName, currentCaseId, projectName = '', currentMappingType = 'case') {
        const overlay = document.getElementById('rtQuickMapOverlay');
        const content = document.getElementById('rtQuickMapContent');
        if (!overlay || !content) return;

        const isEdit = !!currentCaseId;

        content.innerHTML = `
    <div class="rt-popup-header">
        <span class="rt-popup-title">
            <i class="fas fa-link"></i>
            ${isEdit ? 'Edit' : 'Add'} CloudBeat Mapping
        </span>
        <button class="rt-popup-close" id="rtQuickMapClose">
            <i class="fas fa-times"></i>
        </button>
    </div>
    <div class="rt-quick-map-body">

        <div class="rt-qm-test-info">
            <i class="fas fa-vial" style="color:#fbbf24"></i>
            <div>
                <div class="rt-qm-test-name"
                     title="${this.escHtml(testName)}">
                    ${this.escHtml(testName)}
                </div>
                <div class="rt-qm-test-id">
                    Test ID:
                    <strong>${this.escHtml(testId)}</strong>
                </div>
                ${projectName ? `
                <div class="rt-qm-project-name">
                    <i class="fas fa-folder"
                       style="color:#7ab3ef;font-size:0.7rem"></i>
                    <span>${this.escHtml(projectName)}</span>
                </div>` : ''}
            </div>
        </div>

        <div class="rt-qm-form">
            <div class="rt-qm-field">
                <label class="rt-qm-label">
                    <i class="fas fa-play-circle" style="color:#4ade80"></i>
                    CloudBeat ID
                    <span class="rt-qm-required">*</span>
                </label>
                <input id="rtQmCaseIdInput"
                    class="rt-map-input"
                    type="text"
                    value="${this.escHtml(currentCaseId || '')}"
                    placeholder="e.g. 3023"
                    dir="ltr"/>
                <div class="rt-qm-hint">
                    Case ID for re-running, or Suite ID for linking
                </div>
            </div>

            <!-- *** חדש: בחירת סוג מיפוי *** -->
            <div class="rt-qm-field">
                <label class="rt-qm-label">
                    <i class="fas fa-tag" style="color:#a78bfa"></i>
                    Mapping Type
                </label>
                <div class="rt-qm-type-options">
                    <label class="rt-qm-type-card ${currentMappingType !== 'suite' ? 'selected' : ''}">
                        <input type="radio"
                            name="rtQmMappingType"
                            value="case"
                            ${currentMappingType !== 'suite' ? 'checked' : ''}
                            style="display:none"/>
                        <i class="fas fa-vial" style="color:#4ade80"></i>
                        <span>Case (Test)</span>
                        <i class="fas fa-check-circle rt-qm-type-check"></i>
                    </label>
                    <label class="rt-qm-type-card ${currentMappingType === 'suite' ? 'selected' : ''}">
                        <input type="radio"
                            name="rtQmMappingType"
                            value="suite"
                            ${currentMappingType === 'suite' ? 'checked' : ''}
                            style="display:none"/>
                        <i class="fas fa-layer-group" style="color:#7ab3ef"></i>
                        <span>Suite</span>
                        <i class="fas fa-check-circle rt-qm-type-check"></i>
                    </label>
                </div>
                <div class="rt-qm-hint">
                    Suite → links to suite results page
                </div>
            </div>
        </div>

        <div id="rtQmMsg" class="rt-map-form-msg"></div>

        <div class="rt-qm-actions">
            <button class="rt-qm-cancel-btn" id="rtQmCancelBtn">
                <i class="fas fa-times"></i>
                <span>Cancel</span>
            </button>
            <button class="rt-qm-save-btn" id="rtQmSaveBtn"
                    data-test-id="${this.escHtml(testId)}"
                    data-is-edit="${isEdit ? '1' : '0'}">
                <i class="fas fa-check"></i>
                <span>${isEdit ? 'Update' : 'Save'}</span>
            </button>
        </div>

    </div>`;

        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        setTimeout(() => {
            document.getElementById('rtQmCaseIdInput')?.focus();
        }, 100);
    }

    closeQuickMapPopup() {
        const overlay = document.getElementById('rtQuickMapOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    async saveQuickMapping(testId, isEdit) {
        const caseIdInput = document.getElementById('rtQmCaseIdInput');
        const saveBtn = document.getElementById('rtQmSaveBtn');
        const msgEl = document.getElementById('rtQmMsg');

        const caseId = caseIdInput?.value?.trim() || '';

        if (!caseId) {
            if (msgEl) {
                msgEl.textContent = 'Please enter CloudBeat Case ID';
                msgEl.className = 'rt-map-form-msg error';
                msgEl.style.display = 'block';
            }
            caseIdInput?.focus();
            return;
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> <span>Saving...</span>';
        }

        try {
            let res;

            if (isEdit) {
                const existing = this._getMappingForTest(testId);
                if (!existing) throw new Error('Mapping not found');

                res = await fetch('/SuiteConfig/UpdateTestCaseMapping', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        id: existing.id,
                        cloudBeatCaseId: caseId,
                        mappingType: document.querySelector('input[name="rtQmMappingType"]:checked')?.value || 'case'
                    })
                });
            } else {
                res = await fetch('/SuiteConfig/AddTestCaseMapping', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        testId,
                        cloudBeatCaseId: caseId,
                        mappingType: document.querySelector('input[name="rtQmMappingType"]:checked')?.value || 'case'
                    })
                });
            }

            const data = await res.json();

            if (data.success) {
                this.closeQuickMapPopup();
                await this._loadTestCaseMappings();
                this.renderTable();
            } else {
                if (msgEl) {
                    msgEl.textContent = data.message || 'Error';
                    msgEl.className = 'rt-map-form-msg error';
                    msgEl.style.display = 'block';
                }
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        '<i class="fas fa-check"></i> <span>Save</span>';
                }
            }
        } catch (err) {
            if (msgEl) {
                msgEl.textContent = `Error: ${err.message}`;
                msgEl.className = 'rt-map-form-msg error';
                msgEl.style.display = 'block';
            }
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-check"></i> <span>Save</span>';
            }
        }
    }

    // ==========================================
    // פופאפ הרצת טסט
    // ==========================================
    openRunTestPopup(testId, testName, caseId) {
        const overlay = document.getElementById('rtRunTestOverlay');
        const content = document.getElementById('rtRunTestContent');
        if (!overlay || !content) return;

        content.innerHTML = this._buildRunTestHtml(
            testId, testName, caseId);
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeRunTestPopup() {
        const overlay = document.getElementById('rtRunTestOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    _buildRunTestHtml(testId, testName, caseId) {
        const name = this.escHtml(testName || '-');
        const id = this.escHtml(caseId || '');

        return `
    <div class="rt-popup-header">
        <div style="display:flex;align-items:center;
                    gap:8px;font-size:0.9rem;
                    font-weight:600;color:#ddd">
            <i class="fas fa-play-circle"
               style="color:#4ade80"></i>
            <span title="${name}"
                  style="white-space:nowrap;overflow:hidden;
                         text-overflow:ellipsis;max-width:320px">
                Re-run: ${name}
            </span>
        </div>
        <button class="rt-popup-close" id="rtRunTestClose">
            <i class="fas fa-times"></i>
        </button>
    </div>

    <div style="padding:16px;display:flex;
                flex-direction:column;gap:16px">

        <!-- פרטי טסט -->
        <div class="rt-run-detail-row">
            <span class="rt-run-detail-label">Test ID</span>
            <span class="rt-run-detail-value"
                  style="font-family:monospace;color:#fbbf24">
                ${this.escHtml(testId)}
            </span>
        </div>
        <div class="rt-run-detail-row">
            <span class="rt-run-detail-label">Case ID</span>
            <span class="rt-run-detail-value"
                  style="font-family:monospace;color:#4ade80">
                ${id}
            </span>
        </div>

        <!-- בחירת מריץ -->
        <div>
            <div class="rt-run-section-title">
                <i class="fas fa-user-cog"></i> Who are you?
            </div>
            <div class="rt-run-runner-options">

                <label class="rt-run-runner-card
                    ${this._lastRunnerType === 'automation'
                ? 'selected' : ''}"
                    data-runner="automation">
                    <input type="radio"
                           name="rtRunnerType"
                           value="automation"
                           ${this._lastRunnerType === 'automation'
                ? 'checked' : ''}
                           style="display:none"/>
                    <i class="fas fa-robot rt-runner-icon"></i>
                    <span class="rt-runner-label">Automation</span>
                    <i class="fas fa-check-circle rt-runner-check"></i>
                </label>

                <label class="rt-run-runner-card
                    ${this._lastRunnerType === 'noc'
                ? 'selected' : ''}"
                    data-runner="noc">
                    <input type="radio"
                           name="rtRunnerType"
                           value="noc"
                           ${this._lastRunnerType === 'noc'
                ? 'checked' : ''}
                           style="display:none"/>
                    <i class="fas fa-desktop rt-runner-icon"></i>
                    <span class="rt-runner-label">NOC</span>
                    <i class="fas fa-check-circle rt-runner-check"></i>
                </label>

            </div>
        </div>

        <!-- Progress -->
        <div id="rtRunProgressWrap"
             class="rt-run-progress-wrap"
             style="display:none">
            <div style="display:flex;justify-content:space-between;
                        align-items:center;margin-bottom:6px">
                <span id="rtRunProgressLabel"
                      style="font-size:0.8rem;color:#aaa;
                             display:flex;align-items:center;gap:6px">
                    <i class="fas fa-spinner fa-spin"></i>
                    Sending request...
                </span>
                <span id="rtRunProgressPct"
                      style="font-size:0.85rem;font-weight:700;
                             color:#4ade80;font-family:monospace">
                    0%
                </span>
            </div>
            <div class="rt-run-progress-track">
                <div id="rtRunProgressBar"
                     class="rt-run-progress-bar"
                     style="width:0%"></div>
            </div>
        </div>

        <!-- הודעה -->
        <div id="rtRunTestMsg"
             class="rt-map-form-msg"
             style="display:none"></div>

        <!-- כפתורים -->
        <div style="display:flex;gap:10px;justify-content:flex-end">
            <button id="rtRunTestCancelBtn"
                    style="background:#252535;border:1px solid #3a3a5a;
                           border-radius:7px;color:#999;cursor:pointer;
                           padding:8px 16px;font-size:0.85rem;
                           display:flex;align-items:center;gap:6px">
                <i class="fas fa-times"></i>
                <span>Cancel</span>
            </button>
            <button id="rtRunTestConfirmBtn"
                    data-case-id="${id}"
                    data-test-name="${name}"
                    style="background:#1e3a1e;border:1px solid #2a7a2a;
                           border-radius:7px;color:#4ade80;cursor:pointer;
                           padding:8px 16px;font-size:0.85rem;font-weight:600;
                           display:flex;align-items:center;gap:6px">
                <i class="fas fa-redo-alt"></i>
                <span>Run Test</span>
            </button>
        </div>

    </div>`;
    }

    // ==========================================
    // runTest — עדכון לתמיכה ב-polling
    // ==========================================
    async runTest(caseId, testName) {
        const confirmBtn = document.getElementById('rtRunTestConfirmBtn');
        const cancelBtn = document.getElementById('rtRunTestCancelBtn');

        const runnerRadio = document.querySelector(
            'input[name="rtRunnerType"]:checked');
        const runnerType = runnerRadio?.value || this._lastRunnerType;

        this._lastRunnerType = runnerType;
        localStorage.setItem('rtLastRunnerType', runnerType);

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> <span>Running...</span>';
        }
        if (cancelBtn) cancelBtn.disabled = true;

        // הצג progress
        const progressWrap = document.getElementById('rtRunProgressWrap');
        if (progressWrap) progressWrap.style.display = 'block';
        this._setRunTestProgress(30, 'running', 'Sending request...');

        try {
            const res = await fetch('/SuiteResults/RunCloudBeatCase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ cloudBeatId: caseId, runnerType })
            });

            const data = await res.json();

            if (data.success) {
                // *** עדכן progress ל-50% — ממתין לתוצאה ***
                this._setRunTestProgress(
                    50, 'running', 'Test started — waiting for results...');

                const msgEl = document.getElementById('rtRunTestMsg');
                if (msgEl) {
                    msgEl.textContent =
                        `✓ "${testName}" started in CloudBeat — waiting for result...`;
                    msgEl.className = 'rt-map-form-msg success';
                    msgEl.style.display = 'block';
                }

                // *** שמור state לבדיקת תוצאה ***
                this._pendingRunCaseId = caseId;
                this._pendingRunTestName = testName;
                this._pendingRunStartTime = new Date();

                // *** הפעל polling מהיר ***
                this._startPollingForResult();

            } else {
                this._setRunTestProgress(100, 'error', 'Failed to start');

                const msgEl = document.getElementById('rtRunTestMsg');
                if (msgEl) {
                    msgEl.textContent = data.message || 'Unknown error';
                    msgEl.className = 'rt-map-form-msg error';
                    msgEl.style.display = 'block';
                }

                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.innerHTML =
                        '<i class="fas fa-redo-alt"></i> <span>Try Again</span>';
                }
                if (cancelBtn) cancelBtn.disabled = false;
            }

        } catch (err) {
            this._setRunTestProgress(100, 'error', `Error: ${err.message}`);

            const msgEl = document.getElementById('rtRunTestMsg');
            if (msgEl) {
                msgEl.textContent = `Communication error: ${err.message}`;
                msgEl.className = 'rt-map-form-msg error';
                msgEl.style.display = 'block';
            }

            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML =
                    '<i class="fas fa-redo-alt"></i> <span>Try Again</span>';
            }
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }

    // ==========================================
    // *** חדש: Polling לתוצאת ריצת טסט ***
    // ==========================================
    _startPollingForResult() {
        // נקה polling קודם
        this._stopPollingForResult();

        // בדוק כל 15 שניות (טסט בודד מהיר יותר מסוויטה)
        this._pollInterval = setInterval(async () => {
            await this.loadData();
        }, 15 * 1000);

        // timeout של 10 דקות
        this._pollTimeout = setTimeout(() => {
            this._stopPollingForResult();
            this._setRunTestProgress(
                50, 'error',
                'Timeout — no result received after 10 minutes'
            );

            const msgEl = document.getElementById('rtRunTestMsg');
            if (msgEl) {
                msgEl.textContent =
                    'Timeout: no result received after 10 minutes';
                msgEl.className = 'rt-map-form-msg error';
                msgEl.style.display = 'block';
            }

            // שחרר כפתורים
            const confirmBtn = document.getElementById('rtRunTestConfirmBtn');
            const cancelBtn = document.getElementById('rtRunTestCancelBtn');
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML =
                    '<i class="fas fa-redo-alt"></i> <span>Try Again</span>';
            }
            if (cancelBtn) cancelBtn.disabled = false;

            // נקה state
            this._pendingRunCaseId = null;
            this._pendingRunTestName = null;
            this._pendingRunStartTime = null;

        }, 10 * 60 * 1000);
    }

    _stopPollingForResult() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
        if (this._pollTimeout) {
            clearTimeout(this._pollTimeout);
            this._pollTimeout = null;
        }
    }

    // ==========================================
    // *** חדש: בדיקת תוצאה ממתינה ***
    // ==========================================
    _checkPendingRunResult(prevTests) {
        if (!this._pendingRunCaseId) return;

        const caseId = this._pendingRunCaseId;
        const testName = this._pendingRunTestName;
        const startTime = this._pendingRunStartTime;

        // *** מצא testId לפי caseId מהמיפויים ***
        const mapping = Object.values(this._testCaseMappingCache)
            .find(m => String(m.cloudBeatCaseId) === String(caseId));

        let currentTest = null;

        if (mapping) {
            // חפש לפי testId
            currentTest = this.allTests.find(t =>
                String(t.testId || t.id || '') === String(mapping.testId)
            );
        }

        // *** fallback — חפש לפי שם הטסט ***
        if (!currentTest && testName) {
            currentTest = this.allTests.find(t =>
                (t.containerName || t.testName || '') === testName
            );
        }

        if (!currentTest) {
            console.warn('[Polling] test not found in allTests');
            return;
        }

        // *** נרמל זמן מהשרת — הוסף Z אם חסר ***
        const normalizeTime = (isoStr) => {
            if (!isoStr) return null;
            try {
                const normalized = isoStr.endsWith('Z') || isoStr.includes('+')
                    ? isoStr
                    : isoStr + 'Z';
                return new Date(normalized);
            } catch { return null; }
        };

        const newLastRun = normalizeTime(currentTest.lastRunTime);

        // *** מצא טסט ישן ***
        const prevTest = prevTests.find(t =>
            String(t.testId || t.id || '') ===
            String(currentTest.testId || currentTest.id || '')
        );
        const prevLastRun = normalizeTime(prevTest?.lastRunTime);

        // *** בדוק אם התוצאה חדשה יותר מזמן תחילת הריצה ***
        const hasNewResult =
            newLastRun &&
            startTime &&
            newLastRun > startTime;

        if (!hasNewResult) {
            return;
        }

        // *** תוצאה חדשה הגיעה! ***
        this._stopPollingForResult();

        const statusLow = (currentTest.status || '').toLowerCase();
        const isPassed = statusLow === 'passed';

        this._setRunTestProgress(
            100,
            isPassed ? 'success' : 'error',
            isPassed
                ? `✓ Test completed successfully!`
                : `✗ Test failed — status: ${currentTest.status}`
        );

        const msgEl = document.getElementById('rtRunTestMsg');
        if (msgEl) {
            msgEl.textContent = isPassed
                ? `✓ "${testName}" completed successfully!`
                : `"${testName}" finished — status: ${currentTest.status}`;
            msgEl.className = `rt-map-form-msg ${isPassed ? 'success' : 'error'}`;
            msgEl.style.display = 'block';
        }

        const cancelBtn = document.getElementById('rtRunTestCancelBtn');
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.innerHTML =
                '<i class="fas fa-times"></i> <span>Close</span>';
        }

        // *** שחרר כפתור Confirm ***
        const confirmBtn = document.getElementById('rtRunTestConfirmBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                isPassed
                    ? '<i class="fas fa-check-circle"></i> <span>Done</span>'
                    : '<i class="fas fa-times-circle"></i> <span>Failed</span>';
        }

        this._pendingRunCaseId = null;
        this._pendingRunTestName = null;
        this._pendingRunStartTime = null;

        // סגור אוטומטית אחרי 8 שניות
        setTimeout(() => {
            this.closeRunTestPopup();
        }, 2 * 60 * 1000);
    }

    _setRunTestProgress(pct, state, label) {
        const bar = document.getElementById('rtRunProgressBar');
        const pctEl = document.getElementById('rtRunProgressPct');
        const lblEl = document.getElementById('rtRunProgressLabel');

        if (bar) {
            bar.style.width = `${pct}%`;
            bar.className = `rt-run-progress-bar ${state}`;
        }
        if (pctEl) {
            pctEl.textContent = `${pct}%`;
            pctEl.style.color =
                state === 'success' ? '#4ade80' :
                    state === 'error' ? '#ef4444' : '#4ade80';
        }
        if (lblEl) {
            const icon =
                state === 'success'
                    ? '<i class="fas fa-check-circle" style="color:#4ade80"></i>'
                    : state === 'error'
                        ? '<i class="fas fa-times-circle" style="color:#ef4444"></i>'
                        : '<i class="fas fa-spinner fa-spin"></i>';
            lblEl.innerHTML = `${icon} ${label}`;
        }
    }

    // ==========================================
    // פופאפ ניהול אנשי קשר
    // ==========================================
    openContactsPopup(testId, testName) {
        const overlay = document.getElementById('rtContactsOverlay');
        const content = document.getElementById('rtContactsContent');
        if (!overlay || !content) return;

        content.innerHTML = this._buildContactsPopupHtml(testId, testName);
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        this._loadContactsForPopup(testId);
    }

    closeContactsPopup() {
        const overlay = document.getElementById('rtContactsOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    _buildContactsPopupHtml(testId, testName) {
        return `
    <div class="rt-popup-header">
        <span class="rt-popup-title">
            <i class="fas fa-users"></i>
            Manage Contacts
            <span style="font-size:0.72rem;color:#888;font-weight:400;
                         margin-right:6px;font-family:monospace">
                ${this.escHtml(testName || testId)}
            </span>
        </span>
        <button class="rt-popup-close" id="rtContactsClose">
            <i class="fas fa-times"></i>
        </button>
    </div>
    <div class="rt-contacts-body">

        <!-- טופס הוספה -->
        <div class="rt-contacts-add-form">
            <div class="rt-contacts-form-row">
                <input id="rtContactNameInput"
                       class="rt-map-input"
                       type="text"
                       placeholder="Contact name *"
                       dir="rtl"/>
                <input id="rtContactEmailInput"
                       class="rt-map-input"
                       type="text"
                       placeholder="Email address *"
                       dir="ltr"/>
                <div class="rt-contact-phone-wrap">
                    <button class="rt-contact-lookup-btn"
                            id="rtContactLookupBtn"
                            data-test-id="${this.escHtml(testId)}"
                            title="Auto-fill phone from directory">
                        <i class="fas fa-search"></i>
                    </button>
                    <input id="rtContactPhoneInput"
                           class="rt-map-input"
                           type="tel"
                           placeholder="Phone (auto-fill)"
                           dir="ltr"
                           style="max-width:150px"/>
                </div>
                <button class="rt-map-add-btn"
                        id="rtContactAddBtn"
                        data-test-id="${this.escHtml(testId)}">
                    <i class="fas fa-plus"></i> Add
                </button>
            </div>
            <div id="rtContactFormMsg" class="rt-map-form-msg"></div>
        </div>

        <!-- רשימת אנשי קשר -->
        <div class="rt-contacts-list-wrap">
            <div id="rtContactsList" class="rt-contacts-list">
                <div style="text-align:center;padding:20px;color:#555">
                    <i class="fas fa-spinner fa-spin"></i> Loading...
                </div>
            </div>
        </div>

    </div>`;
    }

    async _loadContactsForPopup(testId) {
        const listEl = document.getElementById('rtContactsList');
        if (!listEl) return;

        try {
            const res = await fetch(
                `/SuiteResults/GetContacts?testId=${encodeURIComponent(testId)}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            if (data.success) {
                this._contactsCache[testId] = data.contacts || [];
            }

            this._renderContactsList(testId, data.contacts || []);

        } catch (err) {
            if (listEl) listEl.innerHTML = `
            <div style="text-align:center;padding:20px;color:#f87171">
                <i class="fas fa-exclamation-circle"></i>
                Error loading contacts
            </div>`;
        }
    }

    _renderContactsList(testId, contacts) {
        const listEl = document.getElementById('rtContactsList');
        if (!listEl) return;

        if (!contacts.length) {
            listEl.innerHTML = `
        <div style="text-align:center;padding:20px;color:#555;
                    font-size:0.85rem;display:flex;align-items:center;
                    justify-content:center;gap:8px">
            <i class="fas fa-info-circle"></i>
            No contacts defined
        </div>`;
            return;
        }

        listEl.innerHTML = contacts.map(c => `
    <div class="rt-contact-row" data-contact-id="${c.id}">
        <div class="rt-contact-info">
            <i class="fas fa-user" style="color:#555;font-size:0.75rem;flex-shrink:0"></i>
            <span class="rt-contact-name">${this.escHtml(c.name)}</span>
            <a href="mailto:${this.escHtml(c.email)}"
               class="rt-contact-email">
                ${this.escHtml(c.email)}
            </a>
            ${c.phone ? `
            <a href="tel:${this.escHtml(c.phone)}"
               class="rt-contact-phone"
               title="Call ${this.escHtml(c.phone)}">
                <i class="fas fa-phone"></i>
                ${this.escHtml(c.phone)}
            </a>` : ''}
        </div>
        <div class="rt-contact-actions">
            <button class="rt-contact-edit-btn"
                    data-contact-id="${c.id}"
                    data-contact-name="${this.escHtml(c.name)}"
                    data-contact-email="${this.escHtml(c.email)}"
                    data-contact-phone="${this.escHtml(c.phone || '')}"
                    data-test-id="${this.escHtml(testId)}"
                    title="Edit">
                <i class="fas fa-edit"></i>
            </button>
            <button class="rt-contact-del-btn"
                    data-contact-id="${c.id}"
                    data-test-id="${this.escHtml(testId)}"
                    title="Delete">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    </div>`).join('');
    }

    _editContactInline(contactId, testId, currentName, currentEmail, currentPhone) {
        const listEl = document.getElementById('rtContactsList');
        if (!listEl) return;

        const row = listEl.querySelector(`.rt-contact-row[data-contact-id="${contactId}"]`);
        if (!row) return;

        row._originalHtml = row.outerHTML;

        row.innerHTML = `
    <div class="rt-contact-edit-form">
        <input class="rt-map-input"
               id="rtEditName_${contactId}"
               type="text"
               value="${this.escHtml(currentName)}"
               placeholder="Name *"
               dir="rtl"/>
        <input class="rt-map-input"
               id="rtEditEmail_${contactId}"
               type="text"
               value="${this.escHtml(currentEmail)}"
               placeholder="Email *"
               dir="ltr"/>
        <div class="rt-contact-phone-wrap">
            <button class="rt-contact-lookup-btn"
                    id="rtEditLookupBtn_${contactId}"
                    data-edit-id="${contactId}"
                    title="Auto-fill phone">
                <i class="fas fa-search"></i>
            </button>
            <input class="rt-map-input"
                   id="rtEditPhone_${contactId}"
                   type="tel"
                   value="${this.escHtml(currentPhone || '')}"
                   placeholder="Phone"
                   dir="ltr"
                   style="max-width:130px"/>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
            <button class="rt-map-add-btn rt-contact-save-btn"
                    data-contact-id="${contactId}"
                    data-test-id="${this.escHtml(testId)}"
                    style="padding:6px 12px">
                <i class="fas fa-check"></i> Save
            </button>
            <button class="rt-contact-cancel-btn"
                    data-contact-id="${contactId}"
                    style="background:#252535;border:1px solid #3a3a5a;
                           border-radius:6px;color:#999;cursor:pointer;
                           padding:6px 10px;font-size:0.8rem">
                <i class="fas fa-times"></i>
            </button>
        </div>
    </div>`;

        document.getElementById(`rtEditName_${contactId}`)?.focus();
    }

    _cancelEditContact(contactId) {
        const listEl = document.getElementById('rtContactsList');
        if (!listEl) return;
        const row = listEl.querySelector(`.rt-contact-row[data-contact-id="${contactId}"]`);
        if (row?._originalHtml) row.outerHTML = row._originalHtml;
    }

    async _addContact(testId) {
        const nameInput = document.getElementById('rtContactNameInput');
        const emailInput = document.getElementById('rtContactEmailInput');
        const phoneInput = document.getElementById('rtContactPhoneInput');
        const addBtn = document.getElementById('rtContactAddBtn');

        const name = nameInput?.value?.trim() || '';
        const email = (emailInput?.value?.trim() || '').toLowerCase();
        let phone = phoneInput?.value?.trim() || '';

        if (!name) {
            this._showContactMsg('Please enter a contact name', 'error');
            nameInput?.focus();
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+(\.[^\s@]+)+$/.test(email)) {
            this._showContactMsg('Please enter a valid email address', 'error');
            emailInput?.focus();
            return;
        }

        // Auto-lookup phone אם ריק
        if (!phone) {
            try {
                const params = new URLSearchParams();
                if (name) params.append('name', name);
                if (email) params.append('email', email);
                const res = await fetch(`/SuiteResults/LookupPhoneByNameEmail?${params}`,
                    { credentials: 'include' });
                const data = await res.json();
                if (data.success && data.phone) {
                    phone = data.phone;
                    if (phoneInput) phoneInput.value = phone;
                }
            } catch { /* המשך בלי טלפון */ }
        }

        if (addBtn) { addBtn.disabled = true; addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        try {
            const res = await fetch('/SuiteResults/AddContact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ testId, name, email, phone })
            });
            const data = await res.json();

            if (data.success) {
                this._showContactMsg('Contact added ✓', 'success');
                if (nameInput) nameInput.value = '';
                if (emailInput) emailInput.value = '';
                if (phoneInput) phoneInput.value = '';
                delete this._contactsCache[testId];
                await this._loadContactsForPopup(testId);
                this.renderTable();
            } else {
                this._showContactMsg(data.message || 'Error', 'error');
            }
        } catch (err) {
            this._showContactMsg('Communication error', 'error');
        } finally {
            if (addBtn) { addBtn.disabled = false; addBtn.innerHTML = '<i class="fas fa-plus"></i> Add'; }
        }
    }

    async _saveContact(contactId, testId) {
        const nameInput = document.getElementById(`rtEditName_${contactId}`);
        const emailInput = document.getElementById(`rtEditEmail_${contactId}`);
        const phoneInput = document.getElementById(`rtEditPhone_${contactId}`);

        const name = nameInput?.value?.trim() || '';
        const email = (emailInput?.value?.trim() || '').toLowerCase();
        const phone = phoneInput?.value?.trim() || '';

        if (!name) {
            this._showContactMsg('Please enter a name', 'error');
            nameInput?.focus();
            return;
        }
        if (!email || !/^[^\s@]+@[^\s@]+(\.[^\s@]+)+$/.test(email)) {
            this._showContactMsg('Please enter a valid email', 'error');
            emailInput?.focus();
            return;
        }

        const saveBtn = document.querySelector(`.rt-contact-save-btn[data-contact-id="${contactId}"]`);
        if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        try {
            const res = await fetch('/SuiteResults/UpdateContact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id: parseInt(contactId), name, email, phone })
            });
            const data = await res.json();

            if (data.success) {
                this._showContactMsg('Updated ✓', 'success');
                delete this._contactsCache[testId];
                await this._loadContactsForPopup(testId);
                this.renderTable();
            } else {
                this._showContactMsg(data.message || 'Error', 'error');
                if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-check"></i> Save'; }
            }
        } catch (err) {
            this._showContactMsg('Communication error', 'error');
            if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '<i class="fas fa-check"></i> Save'; }
        }
    }

    async _deleteContact(contactId, testId) {
        if (!confirm('Delete this contact?')) return;

        try {
            const res = await fetch('/SuiteResults/DeleteContact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id: contactId })
            });
            const data = await res.json();

            if (data.success) {
                this._showContactMsg('Deleted ✓', 'success');
                delete this._contactsCache[testId];
                await this._loadContactsForPopup(testId);
                this.renderTable();
            } else {
                this._showContactMsg(data.message || 'Error', 'error');
            }
        } catch (err) {
            this._showContactMsg('Communication error', 'error');
        }
    }

    async _lookupPhone(editId = null) {
        let nameInput, emailInput, phoneInput, lookupBtn;

        if (editId) {
            nameInput = document.getElementById(`rtEditName_${editId}`);
            emailInput = document.getElementById(`rtEditEmail_${editId}`);
            phoneInput = document.getElementById(`rtEditPhone_${editId}`);
            lookupBtn = document.getElementById(`rtEditLookupBtn_${editId}`);
        } else {
            nameInput = document.getElementById('rtContactNameInput');
            emailInput = document.getElementById('rtContactEmailInput');
            phoneInput = document.getElementById('rtContactPhoneInput');
            lookupBtn = document.getElementById('rtContactLookupBtn');
        }

        const name = nameInput?.value?.trim() || '';
        const email = emailInput?.value?.trim() || '';

        if (!name && !email) {
            this._showContactMsg('Enter name or email first', 'error');
            return;
        }

        if (lookupBtn) { lookupBtn.disabled = true; lookupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        try {
            const params = new URLSearchParams();
            if (name) params.append('name', name);
            if (email) params.append('email', email);

            const res = await fetch(`/SuiteResults/LookupPhoneByNameEmail?${params}`,
                { credentials: 'include' });
            const data = await res.json();

            if (data.success && data.phone) {
                if (phoneInput) {
                    phoneInput.value = data.phone;
                    phoneInput.style.borderColor = '#4ade80';
                    setTimeout(() => { phoneInput.style.borderColor = ''; }, 2000);
                }
                this._showContactMsg(`✓ Phone found: ${data.phone}`, 'success');
            } else {
                this._showContactMsg('No phone found in directory', 'error');
            }
        } catch (err) {
            this._showContactMsg(`Lookup error: ${err.message}`, 'error');
        } finally {
            if (lookupBtn) { lookupBtn.disabled = false; lookupBtn.innerHTML = '<i class="fas fa-search"></i>'; }
        }
    }

    _showContactMsg(msg, type = 'info') {
        const el = document.getElementById('rtContactFormMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `rt-map-form-msg ${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    async exportToExcel() {
        if (typeof ExcelJS === 'undefined') {
            this.showError(
                'Excel library not loaded. Please refresh the page.');
            return;
        }

        const tests = this.getFilteredTests();

        if (!tests.length) {
            this.showError('No data to export');
            return;
        }

        const exportBtn = document.getElementById('rtExportBtn');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i>' +
                ' <span>Exporting...</span>';
        }

        try {
            const wb = new ExcelJS.Workbook();
            wb.creator = 'NOC Dashboard';
            wb.created = new Date();
            wb.modified = new Date();

            // ==========================================
            // צבעים
            // ==========================================
            const C = {
                headerBg: '1F3864',
                headerFont: 'FFFFFF',
                passedRowBg: 'E2EFDA',
                passedRowFont: '1E4620',
                failedRowBg: 'FCE4EC',
                failedRowFont: '7B1A1A',
                warnRowBg: 'FFF9C4',
                warnRowFont: '7D6608',
                altRowBg: 'F5F5F5',
                borderColor: 'BDBDBD',
                nightBg: 'FFF9C4',
                nightFont: '7D6608',
            };

            // ==========================================
            // פונקציות עזר
            // ==========================================
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
                hAlign = 'left',
                fontSize = 11,
            } = {}) => {
                cell.font = {
                    name: 'Calibri', size: fontSize,
                    bold, color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign,
                    vertical: 'middle',
                    wrapText: false,
                };
                cell.border = thinBorder();
                if (bgColor) {
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            // ==========================================
            // גיליון — Tests Detail
            // ==========================================
            const ws = wb.addWorksheet('Recent Tests', {
                views: [{ state: 'frozen', ySplit: 1 }],
                properties: { defaultRowHeight: 18 },
            });

            ws.columns = [
                { header: 'Test Name', key: 'testName', width: 52 },
                { header: 'Status', key: 'status', width: 12 },
                { header: 'Priority', key: 'priority', width: 12 },
                { header: 'Project', key: 'project', width: 22 },
                { header: 'Duration', key: 'duration', width: 14 },
                { header: 'Last Run', key: 'lastRun', width: 22 },
                { header: 'Night System', key: 'isNight', width: 14 },
                { header: 'CloudBeat ID', key: 'cloudBeatId', width: 18 },
            ];

            // *** עצב שורת כותרות ***
            const headerRow = ws.getRow(1);
            headerRow.height = 24;
            headerRow.eachCell(cell => {
                applyStyle(cell, {
                    bgColor: C.headerBg,
                    fontColor: C.headerFont,
                    bold: true,
                    hAlign: 'center',
                    fontSize: 12,
                });
            });

            // *** הוסף שורות נתונים ***
            tests.forEach((test, rowIdx) => {
                const statusLow = (test.status || '').toLowerCase();
                const isNight = this._isDowntimeTest(
                    test.containerName || test.testName || '');

                const mapping = this._getMappingForTest(
                    test.testId || test.id || '');
                const caseId = mapping?.cloudBeatCaseId || '';

                const excelRow = ws.addRow([
                    test.containerName || test.testName || '',
                    test.status || '',
                    test.priority || '',
                    test.projectName || '',
                    this.fmtDuration(test.durationSeconds),
                    test.lastRunTime
                        ? this._fmtFullDate(test.lastRunTime) : '',
                    isNight ? '🌙' : '',
                    caseId,
                ]);

                excelRow.height = 17;

                // *** צבע רקע לפי סטטוס ***
                let rowBg = rowIdx % 2 === 1 ? C.altRowBg : null;
                let rowFont = '000000';

                if (statusLow === 'passed') {
                    rowBg = C.passedRowBg;
                    rowFont = C.passedRowFont;
                } else if (statusLow === 'failed') {
                    rowBg = C.failedRowBg;
                    rowFont = C.failedRowFont;
                } else if (statusLow === 'warning') {
                    rowBg = C.warnRowBg;
                    rowFont = C.warnRowFont;
                }

                excelRow.eachCell((cell, colNum) => {
                    let bg = rowBg;
                    let font = rowFont;
                    let bold = false;
                    let hAlign = 'left';

                    switch (colNum) {
                        case 1: // Test Name
                            bold = false;
                            break;
                        case 2: // Status
                            hAlign = 'center';
                            bold = true;
                            break;
                        case 3: // Priority
                            hAlign = 'center';
                            bold = true;
                            break;
                        case 4: // Project
                            hAlign = 'center';
                            break;
                        case 5: // Duration
                            hAlign = 'center';
                            break;
                        case 6: // Last Run
                            hAlign = 'center';
                            break;
                        case 7: // Night
                            hAlign = 'center';
                            if (isNight) {
                                bg = C.nightBg;
                                font = C.nightFont;
                                bold = true;
                            }
                            break;
                        case 8: // CloudBeat ID
                            hAlign = 'center';
                            font = caseId ? '1E4620' : '999999';
                            break;
                    }

                    applyStyle(cell, {
                        bgColor: bg,
                        fontColor: font,
                        bold,
                        hAlign,
                    });
                });
            });

            // ==========================================
            // הורד את הקובץ
            // ==========================================
            const now = new Date();
            const dateStr =
                `${now.getFullYear()}` +
                `${String(now.getMonth() + 1).padStart(2, '0')}` +
                `${String(now.getDate()).padStart(2, '0')}` +
                `_` +
                `${String(now.getHours()).padStart(2, '0')}` +
                `${String(now.getMinutes()).padStart(2, '0')}`;

            const filterSuffix = this.statusFilter !== 'all'
                ? `_${this.statusFilter}` : '';
            const searchSuffix = this.searchTerm.trim()
                ? `_${this.searchTerm.trim()
                    .replace(/[^a-zA-Z0-9]/g, '_')}` : '';

            const filename =
                `RecentTests${filterSuffix}${searchSuffix}_${dateStr}.xlsx`;

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, filename);

            const total = tests.length;
            this.showError(`✓ Exported ${total} tests → ${filename}`);

        } catch (err) {
            console.error('Export error:', err);
            this.showError(`Export failed: ${err.message}`);

        } finally {
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML =
                    '<i class="fas fa-file-excel"></i>' +
                    ' <span>Export</span>';
            }
        }
    }

    // ==========================================
    // סגנונות משופרים
    // ==========================================
    addStyles() {
        if (document.getElementById('rtStyles')) return;

        const style = document.createElement('style');
        style.id = 'rtStyles';
        style.textContent = `

        /* ===== Root ===== */
        .rt-root {
            background: #0d0d1a;
            color: #e0e0e0;
            font-family: 'Segoe UI', Arial, sans-serif;
            min-height: 100%;
            display: flex;
            flex-direction: column;
            direction: ltr;
        }

        /* ===== Header ===== */
        .rt-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 20px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            gap: 8px;
        }

        .rt-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }

        .rt-header-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        /* ===== כותרת ===== */
        .rt-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.95rem;
            font-weight: 700;
            color: #e0e0e0;
            margin-left: 4px;
        }

        .rt-title-badge {
            background: rgba(124,58,237,0.25);
            border: 1px solid rgba(124,58,237,0.5);
            color: #a78bfa;
            font-size: 0.68rem;
            padding: 2px 8px;
            border-radius: 20px;
            font-weight: 600;
            letter-spacing: 0.03em;
        }

        /* ===== חיפוש ===== */
        .rt-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }

        .rt-search-icon {
            position: absolute;
            left: 9px;
            color: #666;
            font-size: 0.8rem;
            pointer-events: none;
        }

        .rt-search-input {
            background: #1e1e32;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            color: #e0e0e0;
            padding: 7px 30px 7px 30px;
            font-size: 0.85rem;
            width: 230px;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .rt-search-input:focus {
            border-color: #7c3aed;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
        }
        .rt-search-input::placeholder { color: #444; }

        .rt-clear-search {
            position: absolute;
            right: 7px;
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            display: flex;
            align-items: center;
            padding: 0;
            font-size: 0.8rem;
        }
        .rt-clear-search:hover { color: #ccc; }

        /* ===== כפתורי סינון ===== */
        .rt-filter-btns {
            display: flex;
            gap: 4px;
        }

        .rt-filter-btn {
            padding: 6px 13px;
            border-radius: 7px;
            border: 1px solid #2a2a4a;
            background: #1a1a2e;
            color: #777;
            cursor: pointer;
            font-size: 0.78rem;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
            font-weight: 500;
        }
        .rt-filter-btn:hover {
            background: #252540;
            color: #bbb;
            border-color: #4a4a6a;
        }

                .rt-filter-btn.active {
            background: #2d1b69;
            border-color: #7c3aed;
            color: #a78bfa;
            box-shadow: 0 0 8px rgba(124,58,237,0.2);
        }
        .rt-filter-btn.passed.active {
            background: rgba(34,197,94,0.15);
            border-color: #22c55e;
            color: #22c55e;
            box-shadow: 0 0 8px rgba(34,197,94,0.15);
        }
        .rt-filter-btn.failed.active {
            background: rgba(239,68,68,0.15);
            border-color: #ef4444;
            color: #ef4444;
            box-shadow: 0 0 8px rgba(239,68,68,0.15);
        }
        .rt-filter-btn.warning.active {
            background: rgba(245,158,11,0.15);
            border-color: #f59e0b;
            color: #f59e0b;
            box-shadow: 0 0 8px rgba(245,158,11,0.15);
        }

        /* ===== כפתור רענון ===== */
        .rt-last-refresh {
            font-size: 0.72rem;
            color: #444;
            font-family: monospace;
        }

        .rt-refresh-btn {
            background: #1a1a2e;
            border: 1px solid #2a2a4a;
            border-radius: 7px;
            color: #777;
            cursor: pointer;
            padding: 6px 11px;
            transition: all 0.2s;
            font-size: 0.85rem;
        }
        .rt-refresh-btn:hover {
            background: #252540;
            color: #a78bfa;
            border-color: #7c3aed;
        }

        /* ===== סטטיסטיקות ===== */
        .rt-stats-bar {
            display: flex;
            align-items: stretch;
            background: linear-gradient(135deg, #12122a 0%, #0f0f20 100%);
            border-bottom: 1px solid #1e1e3a;
            padding: 14px 20px;
            flex-wrap: wrap;
            gap: 12px;
        }

        .rt-stat-box {
            display: flex;
            align-items: center;
            gap: 12px;
            background: #1a1a2e;
            border: 1px solid #2a2a4a;
            border-radius: 10px;
            padding: 12px 18px;
            min-width: 130px;
            flex: 1;
            transition: border-color 0.2s, transform 0.2s;
        }
        .rt-stat-box:hover {
            transform: translateY(-1px);
        }
        .rt-stat-box.passed  { border-color: rgba(34,197,94,0.2); }
        .rt-stat-box.failed  { border-color: rgba(239,68,68,0.2); }
        .rt-stat-box.warning { border-color: rgba(245,158,11,0.2); }
        .rt-stat-box.rate    { border-color: rgba(124,58,237,0.2); }

        .rt-stat-icon {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            background: rgba(255,255,255,0.05);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
            color: #555;
            flex-shrink: 0;
        }
        .rt-stat-icon.passed  {
            background: rgba(34,197,94,0.12);
            color: #22c55e;
        }
        .rt-stat-icon.failed  {
            background: rgba(239,68,68,0.12);
            color: #ef4444;
        }
        .rt-stat-icon.warning {
            background: rgba(245,158,11,0.12);
            color: #f59e0b;
        }
        .rt-stat-icon.rate    {
            background: rgba(124,58,237,0.12);
            color: #a78bfa;
        }

        .rt-stat-content {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
        }

        .rt-stat-num {
            font-size: 1.55rem;
            font-weight: 700;
            line-height: 1.1;
            font-family: monospace;
            color: #ccc;
            transition: color 0.3s;
        }
        .rt-stat-num.passed  { color: #22c55e; }
        .rt-stat-num.failed  { color: #ef4444; }
        .rt-stat-num.warning { color: #f59e0b; }

        .rt-stat-label {
            font-size: 0.65rem;
            color: #444;
            text-transform: uppercase;
            letter-spacing: 0.06em;
            font-weight: 600;
        }

        /* Progress bar של pass rate */
        .rt-rate-bar-wrap {
            width: 100%;
            height: 3px;
            background: #2a2a4a;
            border-radius: 2px;
            margin-top: 5px;
            overflow: hidden;
        }

        .rt-rate-bar {
            height: 100%;
            width: 0%;
            border-radius: 2px;
            background: #22c55e;
            transition: width 0.6s ease, background 0.3s;
        }

        /* ===== הודעות ===== */
        .rt-error {
            margin: 8px 16px;
            padding: 10px 16px;
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.35);
            border-radius: 8px;
            color: #f87171;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .rt-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 24px;
            color: #555;
            font-size: 0.88rem;
        }

        /* ===== טבלה ===== */
        .rt-table-wrap {
            flex: 1;
            overflow: auto;
        }

        .rt-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: ltr;
        }

        /* כותרות */
        .rt-table thead tr {
            background: #13132a;
            position: sticky;
            top: 0;
            z-index: 2;
        }

        .rt-table th {
            color: #6a8fc0;
            padding: 11px 16px;
             text-align: center;
            border-bottom: 2px solid #1e1e3a;
            font-weight: 700;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            white-space: nowrap;
            background: #13132a;
            user-select: none;
        }

        .rt-th-sortable {
            cursor: pointer;
            transition: color 0.2s;
        }
        .rt-th-sortable:hover { color: #9ab8e0; }

        .rt-sort-icon {
            margin-left: 5px;
            font-size: 0.68rem;
            color: #6a8fc0;
        }

        /* תאים */
        .rt-table td {
            padding: 8px 16px;
            border-bottom: 1px solid #141428;
            vertical-align: middle;
            color: #bbb;
            text-align: center;
        }

        /* שורות - border שמאלי לפי סטטוס */
        .rt-row {
            transition: background 0.12s;
            cursor: default;
            border-left: 3px solid transparent;
        }

        .rt-row.passed  { border-left-color: rgba(34,197,94,0.4); }
        .rt-row.failed  { border-left-color: rgba(239,68,68,0.4); }
        .rt-row.warning { border-left-color: rgba(245,158,11,0.4); }

        .rt-row:hover td {
            background: rgba(255,255,255,0.025);
        }
        .rt-row.passed:hover td {
            background: rgba(34,197,94,0.04);
        }
        .rt-row.failed:hover td {
            background: rgba(239,68,68,0.04);
        }
        .rt-row.warning:hover td {
            background: rgba(245,158,11,0.04);
        }

        /* ===== תא שם טסט ===== */
        .rt-td-name {
            max-width: 430px;
        }

        .rt-test-name {
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.82rem;
            color: #d0d0d0;
        }

        /* ===== תג סטטוס ===== */
        .rt-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 6px;
            font-size: 0.73rem;
            font-weight: 600;
            white-space: nowrap;
        }

        .rt-status-badge.passed {
            background: rgba(34,197,94,0.1);
            color: #22c55e;
            border: 1px solid rgba(34,197,94,0.2);
        }
        .rt-status-badge.failed {
            background: rgba(239,68,68,0.1);
            color: #ef4444;
            border: 1px solid rgba(239,68,68,0.2);
        }
        .rt-status-badge.warning {
            background: rgba(245,158,11,0.1);
            color: #f59e0b;
            border: 1px solid rgba(245,158,11,0.2);
        }
        .rt-status-badge.unknown {
            background: rgba(100,100,100,0.1);
            color: #777;
            border: 1px solid #2a2a2a;
        }

        /* ===== עדיפות ===== */
        .rt-priority {
            font-size: 0.68rem;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
        }
        .rt-priority.p0 {
            background: rgba(99,102,241,0.18);
            color: #c7d2fe;
        }
        .rt-priority.p1 {
            background: rgba(239,68,68,0.18);
            color: #fca5a5;
        }
        .rt-priority.p2 {
            background: rgba(245,158,11,0.18);
            color: #fde68a;
        }
        .rt-priority.p3 {
            background: rgba(100,100,100,0.18);
            color: #aaa;
        }

        /* ===== משך / זמן ===== */
        .rt-td-duration,
        .rt-td-lastrun {
            white-space: nowrap;
            color: #666;
            font-size: 0.77rem;
            font-family: monospace;
        }

        /* ===== ריק ===== */
        .rt-empty {
            text-align: center;
            color: #444;
            padding: 50px !important;
            font-size: 0.88rem;
        }
        .rt-empty i {
            margin-left: 8px;
            font-size: 1.2rem;
            opacity: 0.5;
        }

        /* ===== Scrollbar ===== */
        .rt-table-wrap::-webkit-scrollbar       { width: 5px; height: 5px; }
        .rt-table-wrap::-webkit-scrollbar-track { background: #0d0d1a; }
        .rt-table-wrap::-webkit-scrollbar-thumb {
            background: #2a2a4a;
            border-radius: 3px;
        }
        .rt-table-wrap::-webkit-scrollbar-thumb:hover {
            background: #3a3a6a;
        }

        /* ===== כפתור Manage Mappings ===== */
        .rt-manage-mappings-btn {
            background: #1e2e4a;
            border: 1px solid #2a4a8a;
            border-radius: 7px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 6px 12px;
            font-size: 0.78rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            font-weight: 500;
        }
        .rt-manage-mappings-btn:hover {
            background: #253a5a;
            color: #aad4ff;
            border-color: #4a7abf;
        }

        /* ===== עמודות חדשות בטבלה ===== */
        .rt-td-cb {
            text-align: center;
            width: 60px;
        }

        .rt-cb-link {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #4ade80;
            font-size: 0.8rem;
            text-decoration: none;
            padding: 4px 7px;
            border-radius: 5px;
            background: rgba(74,222,128,0.1);
            border: 1px solid rgba(74,222,128,0.25);
            transition: all 0.2s;
        }
        .rt-cb-link:hover {
            background: rgba(74,222,128,0.2);
            border-color: rgba(74,222,128,0.5);
            transform: scale(1.1);
        }

        .rt-cb-has-id {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            color: #4ade80;
            font-size: 0.75rem;
            font-family: monospace;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 5px;
            background: rgba(74,222,128,0.08);
            border: 1px solid rgba(74,222,128,0.3);
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .rt-cb-has-id:hover {
            background: rgba(74,222,128,0.18);
            border-color: #4ade80;
            color: #86efac;
            box-shadow: 0 0 8px rgba(74,222,128,0.25);
            text-decoration: none;
        }

        .rt-cb-no-id {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: #333;
            font-size: 0.75rem;
            padding: 4px 7px;
            border-radius: 5px;
            border: 1px dashed #2a2a4a;
            cursor: default;
        }

        /* ===== כפתורי Actions בשורה ===== */
        .rt-td-actions {
            width: 80px;
        }

        .rt-actions-cell {
            display: flex;
            gap: 4px;
            align-items: center;
            justify-content: center;
        }

        .rt-action-btn {
            background: none;
            border: 1px solid transparent;
            border-radius: 5px;
            cursor: pointer;
            padding: 4px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .rt-rerun-btn {
            color: #fff;
            background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
            border-color: #22c55e;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 0.75rem;
            font-weight: 700;
            gap: 5px;
            letter-spacing: 0.03em;
            box-shadow: 0 2px 6px rgba(34,197,94,0.25);
            transition: all 0.2s;
        }
        .rt-rerun-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            border-color: #4ade80;
            box-shadow: 0 3px 10px rgba(34,197,94,0.45);
            transform: translateY(-1px);
        }
        .rt-rerun-btn:active:not(:disabled) {
            transform: translateY(0px);
            box-shadow: 0 1px 4px rgba(34,197,94,0.3);
        }
        .rt-rerun-btn:disabled,
        .rt-btn-disabled {
            background: #1a1a2e;
            border-color: #2a2a4a;
            color: #444;
            box-shadow: none;
            opacity: 1;
            cursor: not-allowed !important;
        }

        .rt-project-badge {
            display: inline-block;
            font-size: 0.68rem;
            font-weight: 600;
            padding: 2px 7px;
            border-radius: 4px;
            background: rgba(122,179,239,0.1);
            border: 1px solid rgba(122,179,239,0.25);
            color: #7ab3ef;
            white-space: nowrap;
            max-width: 90px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* עמודת פרויקט */
        .rt-td-project {
            white-space: nowrap;
            text-align: center;
        }

        .rt-map-btn {
            color: #7ab3ef;
            border-color: #2a3a5a;
        }
        .rt-map-btn:hover {
            background: rgba(122,179,239,0.15);
            border-color: #7ab3ef;
            transform: scale(1.1);
        }

        /* ===== פופאפ overlay ===== */
        .rt-popup-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(3px);
        }

        .rt-popup-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
        }

        .rt-popup-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #7ab3ef;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .rt-popup-close {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 1.1rem;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .rt-popup-close:hover {
            background: rgba(239,68,68,0.2);
            color: #f87171;
        }

        /* ===== פופאפ ניהול מיפויים ===== */
        .rt-mapping-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 90%;
            max-width: 800px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: ltr;
            animation: rtPopupIn 0.2s ease;
        }

        @keyframes rtPopupIn {
            from { opacity:0; transform:scale(0.95) translateY(-10px); }
            to   { opacity:1; transform:scale(1)    translateY(0);     }
        }

        .rt-mapping-body {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            overflow-y: auto;
            flex: 1;
        }

        /* טופס הוספה */
        .rt-mapping-add-form {
            border-bottom: 1px solid #2a2a4e;
            padding-bottom: 14px;
        }

        .rt-mapping-form-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }

        .rt-map-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 7px 12px;
            font-size: 0.85rem;
            outline: none;
            transition: border-color 0.2s;
            flex: 1;
            min-width: 140px;
            direction: ltr;
        }
        .rt-map-input:focus { border-color: #7c3aed; }
        .rt-map-input::placeholder { color: #555; }

        .rt-map-add-btn {
            background: #1e5f3a;
            border: 1px solid #2a9f5a;
            border-radius: 6px;
            color: #7aefb3;
            cursor: pointer;
            padding: 7px 16px;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .rt-map-add-btn:hover {
            background: #257f4a;
            color: #aaffd4;
        }
        .rt-map-add-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* הודעת טופס */
        .rt-map-form-msg {
            margin-top: 8px;
            font-size: 0.82rem;
            padding: 5px 10px;
            border-radius: 4px;
            display: none;
        }
        .rt-map-form-msg.success {
            background: rgba(34,197,94,0.15);
            color: #4ade80;
            border: 1px solid rgba(34,197,94,0.3);
            display: block;
        }
        .rt-map-form-msg.error {
            background: rgba(239,68,68,0.15);
            color: #f87171;
            border: 1px solid rgba(239,68,68,0.3);
            display: block;
        }

        /* טבלת מיפויים */
        .rt-mapping-table-wrap {
            overflow-x: auto;
            border-radius: 6px;
            border: 1px solid #2a2a4e;
        }

        .rt-mapping-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: ltr;
        }

        .rt-mapping-table thead tr {
            background: #16162a;
            position: sticky;
            top: 0;
            z-index: 1;
        }

        .rt-mapping-table th {
            color: #7ab3ef;
            padding: 8px 12px;
            text-align: left;
            border-bottom: 2px solid #2a2a4e;
            font-weight: 700;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
        }

        .rt-mapping-table td {
            padding: 7px 12px;
            border-bottom: 1px solid #1e1e3a;
            color: #ccc;
            vertical-align: middle;
        }

        .rt-mapping-table tr:hover td {
            background: rgba(122,179,239,0.04);
        }

        .rt-map-empty {
            text-align: center;
            color: #555;
            padding: 24px !important;
            font-size: 0.85rem;
        }

        /* כפתורי פעולה בטבלה */
        .rt-map-edit-btn {
            background: none;
            border: 1px solid #2a4a8a;
            border-radius: 4px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
        }
        .rt-map-edit-btn:hover {
            background: rgba(122,179,239,0.15);
        }

        .rt-map-del-btn {
            background: none;
            border: 1px solid #7a2a2a;
            border-radius: 4px;
            color: #f87171;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
        }
        .rt-map-del-btn:hover {
            background: rgba(239,68,68,0.15);
        }

        /* ===== פופאפ Quick Map ===== */
        .rt-quick-map-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 90%;
            max-width: 440px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: ltr;
            animation: rtPopupIn 0.2s ease;
        }

        .rt-quick-map-body {
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        /* מידע על הטסט */
        .rt-qm-test-info {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 14px;
            background: rgba(251,191,36,0.07);
            border: 1px solid rgba(251,191,36,0.2);
            border-radius: 8px;
            font-size: 0.82rem;
        }

        .rt-qm-test-info i {
            font-size: 1.1rem;
            flex-shrink: 0;
            margin-top: 2px;
        }

        .rt-qm-test-name {
            color: #ddd;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 320px;
            font-size: 0.83rem;
        }

        .rt-qm-test-id {
            color: #888;
            font-size: 0.75rem;
            margin-top: 3px;
        }

        .rt-qm-test-id strong {
            color: #fbbf24;
            font-family: monospace;
        }

        .rt-qm-project-name {
            display: flex;
            align-items: center;
            gap: 5px;
            color: #7ab3ef;
            font-size: 0.72rem;
            margin-top: 4px;
            padding: 2px 6px;
            background: rgba(122,179,239,0.08);
            border: 1px solid rgba(122,179,239,0.2);
            border-radius: 4px;
            width: fit-content;
        }

        /* שדות טופס */
        .rt-qm-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .rt-qm-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        .rt-qm-label {
            font-size: 0.78rem;
            font-weight: 600;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .rt-qm-required {
            color: #ef4444;
            font-size: 0.85rem;
        }

        .rt-qm-hint {
            font-size: 0.7rem;
            color: #555;
            padding-right: 2px;
        }

        /* כפתורי פעולה */
        .rt-qm-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            padding-top: 4px;
            border-top: 1px solid #2a2a4e;
        }

        .rt-qm-cancel-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 7px;
            color: #999;
            cursor: pointer;
            padding: 8px 16px;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .rt-qm-cancel-btn:hover {
            background: #303050;
            color: #ccc;
        }

        .rt-qm-save-btn {
            background: #1e3a1e;
            border: 1px solid #2a7a2a;
            border-radius: 7px;
            color: #4ade80;
            cursor: pointer;
            padding: 8px 18px;
            font-size: 0.85rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .rt-qm-save-btn:hover:not(:disabled) {
            background: #254a25;
            color: #86efac;
        }
        .rt-qm-save-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* ===== פופאפ הרצת טסט ===== */
        .rt-run-test-popup {
            background: #1a1a2e;
            border: 1px solid #2a7a2a;
            border-radius: 10px;
            width: 90%;
            max-width: 420px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: ltr;
            animation: rtPopupIn 0.2s ease;
        }

        /* פרטי ריצה */
        .rt-run-detail-row {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.83rem;
            padding: 6px 0;
            border-bottom: 1px solid #1e1e3a;
        }

        .rt-run-detail-label {
            color: #666;
            min-width: 80px;
            flex-shrink: 0;
            font-size: 0.78rem;
        }

        .rt-run-detail-value {
            color: #ccc;
        }

        /* כותרת סקשן */
        .rt-run-section-title {
            font-size: 0.75rem;
            font-weight: 700;
            color: #7ab3ef;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: flex;
            align-items: center;
            gap: 6px;
            padding-bottom: 8px;
            border-bottom: 1px solid #2a2a4e;
            margin-bottom: 4px;
        }

        /* כרטיסי מריץ */
        .rt-run-runner-options {
            display: flex;
            gap: 10px;
        }

        .rt-run-runner-card {
            flex: 1;
            padding: 12px 14px;
            background: #252535;
            border: 2px solid #3a3a5a;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 5px;
            text-align: center;
            user-select: none;
        }
        .rt-run-runner-card:hover {
            background: #2a2a45;
            border-color: #4ade80;
        }
        .rt-run-runner-card.selected {
            background: rgba(74,222,128,0.1);
            border-color: #4ade80;
        }

        .rt-runner-icon {
            font-size: 1.5rem;
            color: #666;
            transition: color 0.2s;
        }
        .rt-run-runner-card.selected .rt-runner-icon {
            color: #4ade80;
        }

        .rt-runner-label {
            font-size: 0.8rem;
            color: #ccc;
            font-weight: 600;
        }

        .rt-runner-check {
            font-size: 0.85rem;
            color: #4ade80;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .rt-run-runner-card.selected .rt-runner-check {
            opacity: 1;
        }

        /* Progress bar */
        .rt-run-progress-wrap {
            background: #16162a;
            border: 1px solid #2a2a4e;
            border-radius: 8px;
            padding: 12px 14px;
        }

        .rt-run-progress-track {
            height: 8px;
            background: #252535;
            border-radius: 4px;
            overflow: hidden;
        }

        .rt-run-progress-bar {
            height: 100%;
            width: 0%;
            border-radius: 4px;
            transition: width 0.5s ease, background 0.3s;
        }

        .rt-run-progress-bar.running {
            background: linear-gradient(
                90deg,
                #16a34a 0%,
                #4ade80 50%,
                #16a34a 100%
            );
            background-size: 200% 100%;
            animation: rtProgressShimmer 1.8s linear infinite;
        }

        .rt-run-progress-bar.success {
            background: #22c55e;
            animation: none;
        }

        .rt-run-progress-bar.error {
            background: #ef4444;
            animation: none;
        }

        @keyframes rtProgressShimmer {
            0%   { background-position:  200% 0; }
            100% { background-position: -200% 0; }
        }

        /* Scrollbar */
        .rt-mapping-body::-webkit-scrollbar       { width: 4px; }
        .rt-mapping-body::-webkit-scrollbar-track { background: #111; }
        .rt-mapping-body::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }
        .rt-mapping-table-wrap::-webkit-scrollbar { height: 4px; }
        .rt-mapping-table-wrap::-webkit-scrollbar-track { background: #111; }
        .rt-mapping-table-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }

        /* ===== Select סינון ===== */
        .rt-select-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }

        .rt-select-icon {
            position: absolute;
            left: 9px;
            font-size: 0.75rem;
            pointer-events: none;
            z-index: 1;
        }

        .rt-filter-select {
            background: #1e1e32;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            color: #e0e0e0;
            padding: 7px 10px 7px 28px;
            font-size: 0.82rem;
            outline: none;
            cursor: pointer;
            transition: border-color 0.2s, box-shadow 0.2s;
            appearance: none;
            min-width: 130px;
        }
        .rt-filter-select:focus {
            border-color: #7c3aed;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
        }
        .rt-filter-select option {
            background: #1a1a2e;
            color: #e0e0e0;
        }

        /* תיקון: rt-cb-no-link חסר מה-CSS המקורי */
        .rt-cb-no-link {
            cursor: default;
            text-decoration: none;
        }

        /* ===== Multi-Select ===== */
        .rt-ms-wrap {
            position: relative;
        }

        .rt-ms-btn {
            display: flex;
            align-items: center;
            gap: 7px;
            background: #1e1e32;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            color: #ccc;
            cursor: pointer;
            padding: 7px 11px;
            font-size: 0.82rem;
            min-width: 130px;
            transition: border-color 0.2s, box-shadow 0.2s;
            white-space: nowrap;
            user-select: none;
        }
        .rt-ms-btn:hover,
        .rt-ms-btn.open {
            border-color: #7c3aed;
            box-shadow: 0 0 0 3px rgba(124,58,237,0.15);
            color: #e0e0e0;
        }

        .rt-ms-label {
            flex: 1;
            text-align: left;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 110px;
        }

        .rt-ms-arrow {
            font-size: 0.65rem;
            color: #555;
            transition: transform 0.2s;
        }
        .rt-ms-btn.open .rt-ms-arrow {
            transform: rotate(180deg);
        }

        /* Dropdown */
        .rt-ms-dropdown {
            position: absolute;
            top: calc(100% + 5px);
            left: 0;
            z-index: 999;
            background: #1a1a2e;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            min-width: 200px;
            max-width: 280px;
            box-shadow: 0 8px 30px rgba(0,0,0,0.6);
            overflow: hidden;
            animation: rtMsIn 0.15s ease;
        }

        @keyframes rtMsIn {
            from { opacity:0; transform:translateY(-6px); }
            to   { opacity:1; transform:translateY(0);    }
        }

        /* חיפוש */
        .rt-ms-search-wrap {
            padding: 8px 8px 4px;
            border-bottom: 1px solid #2a2a4a;
        }

        .rt-ms-search {
            width: 100%;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 5px 9px;
            font-size: 0.8rem;
            outline: none;
            box-sizing: border-box;
        }
        .rt-ms-search:focus {
            border-color: #7c3aed;
        }
        .rt-ms-search::placeholder { color: #555; }

        /* אפשרויות */
        .rt-ms-options {
            max-height: 220px;
            overflow-y: auto;
            padding: 4px 0;
        }

        .rt-ms-options::-webkit-scrollbar { width: 4px; }
        .rt-ms-options::-webkit-scrollbar-track { background: #111; }
        .rt-ms-options::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }

        .rt-ms-divider {
            height: 1px;
            background: #2a2a4a;
            margin: 3px 0;
        }

        /* שורת אפשרות */
        .rt-ms-option {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            cursor: pointer;
            transition: background 0.12s;
            user-select: none;
        }
        .rt-ms-option:hover {
            background: rgba(124,58,237,0.1);
        }
        .rt-ms-option.rt-ms-all {
            font-weight: 600;
            color: #a78bfa;
        }

        /* Checkbox מותאם */
        .rt-ms-option input[type="checkbox"] {
            display: none;
        }

        .rt-ms-chk-box {
            width: 15px;
            height: 15px;
            border: 2px solid #3a3a5a;
            border-radius: 4px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
            background: #252535;
        }

        .rt-ms-option input:checked + .rt-ms-chk-box {
            background: #7c3aed;
            border-color: #7c3aed;
        }

        .rt-ms-option input:checked + .rt-ms-chk-box::after {
            content: '';
            width: 4px;
            height: 7px;
            border: 2px solid #fff;
            border-top: none;
            border-left: none;
            transform: rotate(45deg) translateY(-1px);
            display: block;
        }

        .rt-ms-opt-label {
            font-size: 0.8rem;
            color: #ccc;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }
        /* ===== באנר סינונים פעילים ===== */
        .rt-filter-banner {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 16px;
            background: linear-gradient(
                135deg,
                rgba(234,179,8,0.08),
                rgba(234,179,8,0.04)
            );
            border-bottom: 1px solid rgba(234,179,8,0.25);
            border-top: 1px solid rgba(234,179,8,0.1);
            font-size: 0.78rem;
            flex-wrap: wrap;
            animation: rtBannerIn 0.2s ease;
        }

        @keyframes rtBannerIn {
            from { opacity:0; transform:translateY(-4px); }
            to   { opacity:1; transform:translateY(0);    }
        }

        /* תג סינון בודד */
        .rt-filter-tag {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px 3px 10px;
            border-radius: 12px;
            font-size: 0.74rem;
            font-weight: 600;
            border: 1px solid;
            white-space: nowrap;
            transition: all 0.15s;
        }

        .rt-filter-tag-search {
            background: rgba(234,179,8,0.12);
            border-color: rgba(234,179,8,0.4);
            color: #fde68a;
            font-family: monospace;
        }

        .rt-filter-tag-project {
            background: rgba(122,179,239,0.12);
            border-color: rgba(122,179,239,0.4);
            color: #7ab3ef;
        }

        .rt-filter-tag-priority {
            background: rgba(167,139,250,0.12);
            border-color: rgba(167,139,250,0.4);
            color: #a78bfa;
        }

        /* כפתור X בתוך תג */
        .rt-filter-tag-remove {
            background: none;
            border: none;
            cursor: pointer;
            padding: 0 0 0 2px;
            font-size: 0.6rem;
            opacity: 0.6;
            display: flex;
            align-items: center;
            transition: opacity 0.15s;
            color: inherit;
            line-height: 1;
        }
        .rt-filter-tag-remove:hover {
            opacity: 1;
        }

        /* כפתור Clear All */
        .rt-filter-banner-clear {
            background: rgba(234,179,8,0.1);
            border: 1px solid rgba(234,179,8,0.3);
            border-radius: 6px;
            color: #fbbf24;
            cursor: pointer;
            padding: 3px 10px;
            font-size: 0.74rem;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
            margin-right: auto;
            white-space: nowrap;
        }
        .rt-filter-banner-clear:hover {
            background: rgba(234,179,8,0.2);
            border-color: rgba(234,179,8,0.55);
            color: #fde68a;
        }

        /* ===== כפתור Export ===== */
        .rt-export-btn {
            background: #123566;
            border: 1px solid #2c2e81;
            border-radius: 7px;
            color: #a0abd6;
            cursor: pointer;
            padding: 6px 11px;
            font-size: 0.8rem;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
        }
        .rt-export-btn:hover {
            background: #1b447f;
            color: #dbe4ff;
            border-color: #355fa8;
        }
        .rt-export-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        /* ===== Contacts Column ===== */
        .rt-td-contacts {
            text-align: center;
            min-width: 200px;
            white-space: nowrap;
            max-width: 280px;          /* ← הגבל רוחב */
        }

        /* ===== Contact Chips ===== */
        .rt-contacts-cell {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: 10px;
            flex-wrap: wrap;
            padding: 2px 0;
            justify-content: center;
        }

        .rt-contact-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: rgba(122,179,239,0.08);
            border: 1px solid rgba(122,179,239,0.2);
            border-radius: 20px;
            padding: 2px 8px 2px 3px;
            font-size: 0.72rem;
            white-space: nowrap;
            max-width: 360px;
            transition: all 0.15s;
            cursor: default;
        }
        .rt-contact-chip:hover {
            background: rgba(122,179,239,0.15);
            border-color: rgba(122,179,239,0.4);
        }

        .rt-contact-chip-avatar {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: linear-gradient(135deg, #2a5a9f, #7ab3ef);
            color: #fff;
            font-size: 0.65rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .rt-contact-chip-name {
            color: #bbb;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 350px;
            font-size: 0.72rem;
            direction: rtl;
        }

        .rt-contact-chip-mail {
            color: rgba(239,68,68,0.6);
            font-size: 0.65rem;
            text-decoration: none;
            display: flex;
            align-items: center;
            padding: 1px 2px;
            border-radius: 3px;
            transition: all 0.15s;
            flex-shrink: 0;
        }
        .rt-contact-chip-mail:hover {
            color: #f87171;
            background: rgba(239,68,68,0.12);
        }

        /* ===== Contact chip - more counter ===== */
        .rt-contact-chip-more {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 24px;
            height: 22px;
            background: rgba(124,58,237,0.18);
            border: 1px solid rgba(124,58,237,0.4);
            border-radius: 20px;
            color: #a78bfa;
            font-size: 0.68rem;
            font-weight: 700;
            padding: 0 6px;
            cursor: default;
            transition: all 0.15s;
            white-space: nowrap;
        }
        .rt-contact-chip-more:hover {
            background: rgba(124,58,237,0.3);
            border-color: rgba(124,58,237,0.7);
            color: #c4b5fd;
            transform: scale(1.08);
        }

        .rt-contact-mail-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: rgba(239,68,68,0.6);
            font-size: 1.0rem;
            text-decoration: none;
            padding: 2px 4px;
            border-radius: 3px;
            transition: all 0.15s;
        }
        .rt-contact-mail-icon:hover {
            color: #f87171;
            background: rgba(239,68,68,0.1);
            transform: scale(1.2);
        }
        .rt-contact-mail-passed {
            color: #444;
            cursor: default;
            pointer-events: none;
        }

        .rt-contacts-count {
            font-size: 0.68rem;
            font-weight: 700;
            color: #7ab3ef;
            background: rgba(122,179,239,0.12);
            border: 1px solid rgba(122,179,239,0.25);
            border-radius: 8px;
            padding: 1px 5px;
            min-width: 16px;
            text-align: center;
        }

        .rt-no-contacts {
            color: #333;
            font-size: 0.8rem;
        }

        .rt-contacts-manage-btn {
            background: none;
            border: 1px solid #2a3a5a;
            border-radius: 4px;
            color: #556a8a;
            cursor: pointer;
            padding: 2px 5px;
            font-size: 0.68rem;
            transition: all 0.2s;
            align-self: center;    /* ← מיושר אנכית במרכז */
            flex-shrink: 0;        /* ← לא מתכווץ */
            margin-right: 2px;     /* ← רווח קטן מה-chips */
            height: 20px;          /* ← גובה אחיד עם ה-chips */
            display: flex;
            align-items: center;
        }
        .rt-contacts-manage-btn:hover {
            background: rgba(122,179,239,0.12);
            border-color: #7ab3ef;
            color: #7ab3ef;
            transform: scale(1.1);
        }

        /* ===== פופאפ אנשי קשר ===== */
        .rt-contacts-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 90%;
            max-width: 600px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: ltr;
            animation: rtPopupIn 0.2s ease;
        }

        .rt-contacts-body {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            max-height: 70vh;
            overflow-y: auto;
        }

        .rt-contacts-add-form {
            border-bottom: 1px solid #2a2a4e;
            padding-bottom: 14px;
        }

        .rt-contacts-form-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }

        .rt-contacts-list-wrap {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .rt-contacts-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        /* שורת איש קשר */
        .rt-contact-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: #252535;
            border-radius: 6px;
            border: 1px solid #2a2a4e;
            gap: 10px;
            transition: background 0.15s;
        }
        .rt-contact-row:hover {
            background: #2a2a45;
        }

        .rt-contact-info {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.83rem;
            min-width: 0;
            flex: 1;
            flex-wrap: wrap;
        }

        .rt-contact-name {
            color: #ccc;
            font-weight: 600;
            white-space: nowrap;
        }

        .rt-contact-email {
            color: #7ab3ef;
            font-size: 0.78rem;
            text-decoration: none;
            white-space: nowrap;
        }
        .rt-contact-email:hover {
            color: #aad4ff;
            text-decoration: underline;
        }

        .rt-contact-phone {
            color: #4ade80;
            font-size: 0.75rem;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            transition: color 0.2s;
        }
        .rt-contact-phone:hover {
            color: #86efac;
            text-decoration: underline;
        }

        .rt-contact-actions {
            display: flex;
            gap: 5px;
            flex-shrink: 0;
        }

        .rt-contact-edit-btn {
            background: none;
            border: 1px solid #2a4a8a;
            border-radius: 4px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
        }
        .rt-contact-edit-btn:hover {
            background: rgba(122,179,239,0.15);
        }

        .rt-contact-del-btn {
            background: none;
            border: 1px solid #7a2a2a;
            border-radius: 4px;
            color: #f87171;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
        }
        .rt-contact-del-btn:hover {
            background: rgba(239,68,68,0.15);
        }

        /* טופס עריכה inline */
        .rt-contact-edit-form {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            width: 100%;
            padding: 4px 0;
        }

        /* Phone wrap */
        .rt-contact-phone-wrap {
            display: flex;
            align-items: center;
            gap: 3px;
        }

        .rt-contact-lookup-btn {
            background: #1e3a5f;
            border: 1px solid #2a5a9f;
            border-radius: 6px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 7px 9px;
            font-size: 0.78rem;
            transition: all 0.2s;
            flex-shrink: 0;
            display: flex;
            align-items: center;
        }
        .rt-contact-lookup-btn:hover {
            background: #254a7f;
            color: #aad4ff;
        }
        .rt-contact-lookup-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* Scrollbar */
        .rt-contacts-body::-webkit-scrollbar       { width: 4px; }
        .rt-contacts-body::-webkit-scrollbar-track { background: #111; }
        .rt-contacts-body::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }
        /* ===== כרטיסי סוג מיפוי ===== */
        .rt-qm-type-options {
            display: flex;
            gap: 8px;
        }

        .rt-qm-type-card {
            flex: 1;
            padding: 8px 12px;
            background: #252535;
            border: 2px solid #3a3a5a;
            border-radius: 7px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 0.8rem;
            color: #aaa;
            user-select: none;
        }
        .rt-qm-type-card:hover {
            background: #2a2a45;
            border-color: #7c3aed;
            color: #ccc;
        }
        .rt-qm-type-card.selected {
            background: rgba(124,58,237,0.12);
            border-color: #7c3aed;
            color: #a78bfa;
        }

        .rt-qm-type-check {
            margin-right: auto;
            color: #7c3aed;
            opacity: 0;
            font-size: 0.8rem;
            transition: opacity 0.2s;
        }
        .rt-qm-type-card.selected .rt-qm-type-check {
            opacity: 1;
        }

        /* Suite link style */
        .rt-cb-suite {
            background: rgba(122,179,239,0.08) !important;
            border-color: rgba(122,179,239,0.3) !important;
            color: #7ab3ef !important;
        }
        .rt-cb-suite:hover {
            background: rgba(122,179,239,0.18) !important;
            border-color: #7ab3ef !important;
            color: #aad4ff !important;
            box-shadow: 0 0 8px rgba(122,179,239,0.25) !important;
        }
        /* ===== Mapping Popup — Wide ===== */
        .rt-mapping-popup-wide {
            max-width: 1000px !important;
        }

        /* ===== Mapping Tabs ===== */
        .rt-mapping-tabs {
            display: flex;
            gap: 0;
            background: #13132a;
            border-bottom: 2px solid #2a2a4e;
            padding: 0 16px;
        }

        .rt-mapping-tab {
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: #666;
            cursor: pointer;
            padding: 10px 18px;
            font-size: 0.82rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 7px;
            transition: all 0.2s;
            margin-bottom: -2px;
            white-space: nowrap;
        }
        .rt-mapping-tab:hover {
            color: #aaa;
            background: rgba(255,255,255,0.03);
        }
        .rt-mapping-tab.active {
            color: #7ab3ef;
            border-bottom-color: #7ab3ef;
            background: rgba(122,179,239,0.05);
        }

        /* Badge על טאב Missing */
        .rt-missing-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 18px;
            height: 18px;
            background: rgba(239,68,68,0.25);
            border: 1px solid rgba(239,68,68,0.5);
            border-radius: 10px;
            color: #f87171;
            font-size: 0.65rem;
            font-weight: 700;
            padding: 0 4px;
        }

        /* ===== Missing Tab Content ===== */
        .rt-missing-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px;
            text-align: center;
        }

        .rt-missing-summary {
            display: flex;
            gap: 10px;
            margin-bottom: 14px;
            flex-wrap: wrap;
        }

        .rt-missing-summary-item {
            flex: 1;
            min-width: 100px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 10px 14px;
            border-radius: 8px;
            border: 1px solid;
            font-size: 0.75rem;
            text-align: center;
        }

        .rt-missing-summary-item.both {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.3);
            color: #f87171;
        }
        .rt-missing-summary-item.cb {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.3);
            color: #fbbf24;
        }
        .rt-missing-summary-item.contacts {
            background: rgba(122,179,239,0.08);
            border-color: rgba(122,179,239,0.3);
            color: #7ab3ef;
        }
        .rt-missing-summary-item.total {
            background: rgba(100,100,100,0.08);
            border-color: rgba(100,100,100,0.3);
            color: #888;
        }

        .rt-missing-summary-num {
            font-size: 1.4rem;
            font-weight: 700;
            font-family: monospace;
            line-height: 1;
        }

        .rt-missing-summary-label {
            font-size: 0.65rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.8;
        }

        /* חיפוש */
        .rt-missing-search-wrap {
            position: relative;
            margin-bottom: 12px;
        }

        /* סקשן */
        .rt-missing-section {
            margin-bottom: 16px;
        }

        .rt-missing-section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(255,255,255,0.03);
            border-radius: 6px 6px 0 0;
            border-left: 3px solid #555;
            font-size: 0.8rem;
            font-weight: 600;
            color: #aaa;
            margin-bottom: 0;
        }

        .rt-missing-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 22px;
            height: 20px;
            border-radius: 10px;
            border: 1px solid;
            font-size: 0.7rem;
            font-weight: 700;
            padding: 0 6px;
            margin-right: auto;
        }

        /* טבלת Missing */
        .rt-missing-table td {
            padding: 6px 12px !important;
        }

        .rt-missing-td-name {
            display: flex;
            align-items: center;
            gap: 7px;
        }

        .rt-missing-test-name {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 320px;
            font-size: 0.8rem;
            color: #ccc;
            display: block;
        }

        /* נקודת סטטוס */
        .rt-missing-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #444;
            flex-shrink: 0;
            display: inline-block;
        }
        .rt-missing-dot.passed  { background: #22c55e; }
        .rt-missing-dot.failed  { background: #ef4444; }
        .rt-missing-dot.warning { background: #f59e0b; }

        /* כפתורי פעולה ב-Missing */
        .rt-missing-action-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            background: none;
            border: 1px solid #2a3a5a;
            border-radius: 5px;
            color: #888;
            cursor: pointer;
            padding: 3px 8px;
            font-size: 0.72rem;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .rt-missing-action-btn:hover {
            background: rgba(255,255,255,0.05);
            border-color: #4a6a9a;
            color: #ccc;
        }
        .rt-missing-add-cb:hover {
            background: rgba(74,222,128,0.08) !important;
            border-color: rgba(74,222,128,0.4) !important;
            color: #4ade80 !important;
        }
        .rt-missing-add-contact:hover {
            background: rgba(122,179,239,0.08) !important;
            border-color: rgba(122,179,239,0.4) !important;
            color: #7ab3ef !important;
        }
        `;

        document.head.appendChild(style);
    }
}

// ==========================================
// רישום גלובלי
// ==========================================
window.RecentTestsDashboard = RecentTestsDashboard;