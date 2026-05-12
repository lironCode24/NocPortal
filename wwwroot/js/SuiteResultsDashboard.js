class SuiteResultsDashboard {
    constructor(containerId, currentUser) {

        this.containerId = containerId;
        this.currentUser = currentUser;

        this.canEdit = this.checkEditPermission(); // רק ספציפיים
        this.canRun = this.checkRunPermission();

        this.container = null;
        this.suites = [];
        this.currentTestData = null;
        this.contactsCache = {}; // מטמון אנשי קשר לפי testId

        // סינון
        this.searchTerm = '';
        this.statusFilter = 'all';

        // רענון
        this.refreshInterval = null;
        this.REFRESH_MS = 60 * 1000;

        // מצב פאנל ניהול
        this.managePanelOpen = false;
        this._lastRunnerType = localStorage.getItem('sdLastRunnerType') || 'noc';

        // *** מצב תצוגה קומפקטית ***
        this.compactView = false;

        // *** מצב collapse של סוויטות בודדות ב-List View ***
        this._collapsedListSuites = new Set(); // Set של suiteKeys

        // מצב קריסת עמודות
        this.collapsedSuites = new Set(); // אינדקסים מקורסים
        this.allCollapsed = false;

        // *** Run All state ***
        this._runAllStartTime = null;
        this._runAllRunnerType = null;
        this._runAllLastRunTime = null;
        this._runAllPollInterval = null;
        this._runAllPollTimeout = null;

        this._pollInterval = null;
        this._pollTimeout = null;

        this._runPatchSuites = false;

        this.viewMode = localStorage.getItem('sdViewMode') || 'grid'; // 'grid' | 'list'

        this.listViewCollapsed = false;

        // *** זמן הריצה האחרון של Run All (מהשרת) ***
        this._runAllLastTime = null;

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

        this.compactView = localStorage.getItem('sdCompactView') === '1';

        this.addStyles();
        this.renderShell();
        this.bindEvents();

        // *** applyPermissions מטפל בשני סוגי הרשאות ***
        this.applyPermissions();

        this._loadDowntimeSystems().then(() => this.loadData());

        this.refreshInterval = setInterval(
            () => this.loadData(), this.REFRESH_MS);

        this._checkRunAllCooldownOnLoad();
    }

    applyPermissions() {
        // *** כפתורי עריכה — רק למשתמשים ספציפיים ***
        // NOC לא יראה את אלה
        if (!this.canEdit) {
            [
                '#sdManageBtn',
                '#sdSyncNamesBtn'
            ].forEach(sel => {
                const el = document.querySelector(sel);
                if (el) {
                    el.disabled = true;
                    el.style.display = 'none';
                }
            });
        }

        // *** כפתורי הרצה — NOC כן יראה, אחרים לא ***
        if (!this.canRun) {
            [
                '#sdRunAllBtn'
            ].forEach(sel => {
                const el = document.querySelector(sel);
                if (el) {
                    el.disabled = true;
                    el.style.display = 'none';
                }
            });
        }

        // *** אם אין הרשאת הרצה בכלל — הסתר גם כפתורי Run בפופאפים ***
        if (!this.canRun) {
            document.getElementById(this.containerId)
                ?.classList.add('sd-readonly');
        }
    }

    // ==========================================
    // הרשאות
    // ==========================================
    checkEditPermission() {
        if (!this.currentUser) return false;
        const { role, username } = this.currentUser;
        // רק משתמשים ספציפיים יכולים לערוך סוויטות ולסנכרן שמות
        if (['lirongo', 'rinaja', 'dekelra'].includes(username)) return true;
        if (role === 'Admin') return true;
        return false;
    }

    // *** האם המשתמש יכול להריץ (NOC + Admin + ספציפיים) ***
    checkRunPermission() {
        if (!this.currentUser) return false;
        const { role, username } = this.currentUser;
        if (['Admin', 'NOC'].includes(role)) return true;
        if (['lirongo', 'rinaja', 'dekelra'].includes(username)) return true;
        return false;
    }

    _updateRunAllHeaderBtnFromServer(timeLeftSecs, triggeredBy = '', triggeredAt = '') {
        const btn = document.getElementById('sdRunAllBtn');
        if (!btn) return;

        btn.disabled = true;
        btn.classList.add('sd-run-all-btn-cooldown');

        // *** בנה tooltip עם מידע על מי הריץ ***
        const buildTooltip = (remaining) => {
            let tooltip = ``;

            if (triggeredBy || triggeredAt) {
                if (triggeredBy && triggeredAt) {
                    tooltip += `${triggeredBy} ran all suites at ${triggeredAt}`;
                } else if (triggeredBy) {
                    tooltip += `Triggered by: ${triggeredBy}`;
                } else if (triggeredAt) {
                    tooltip += `Triggered at: ${triggeredAt}`;
                }
            }

            return tooltip;
        };

        let remaining = timeLeftSecs;

        const tick = () => {
            if (remaining <= 0) {
                btn.disabled = false;
                btn.classList.remove('sd-run-all-btn-cooldown');
                btn.title = 'Run All';
                btn.innerHTML = `
            <i class="fas fa-play-circle"></i>
            <span>Run All</span>`;
                return;
            }

            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const str = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

            // *** עדכן tooltip בכל tick ***
            btn.title = buildTooltip(remaining);

            btn.innerHTML = `
        <i class="fas fa-clock"></i>
        <span>${str}</span>`;

            remaining--;
            setTimeout(tick, 1000);
        };

        tick();
    }

    async _checkRunAllCooldownOnLoad() {
        try {
            const res = await fetch(
                '/SuiteResults/GetRunAllLockStatus',
                { credentials: 'include' });
            const data = await res.json();

            this._serverLockStatus = data;

            if (data.isLocked) {
                const timeLeft = data.timeLeftSecs || 0;
                if (timeLeft > 0) {
                    // *** העבר גם triggeredBy ו-triggeredAt ***
                    this._updateRunAllHeaderBtnFromServer(
                        timeLeft,
                        data.triggeredBy || '',
                        data.triggeredAt || ''
                    );
                }
            }
        } catch (err) {
            console.warn('Could not check run-all cooldown:', err);
            if (!this.canEdit) {
                const lastRunTime = localStorage.getItem('sdRunAllLastTime');
                if (!lastRunTime) return;
                const COOLDOWN_MS = 5 * 60 * 1000;
                const timeLeft = COOLDOWN_MS -
                    (Date.now() - parseInt(lastRunTime));
                if (timeLeft > 0) {
                    this._updateRunAllHeaderBtn();
                }
            }
        }
    }

    destroy() {
        if (this.refreshInterval)
            clearInterval(this.refreshInterval);
    }

    // ==========================================
    // טעינת נתונים
    // ==========================================

    async loadData() {
        try {
            const prevSuites = [...this.suites];
            this.showLoading(true);

            const response = await fetch(
                '/SuiteResults/GetAllSuites',
                {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    credentials: 'include'
                }
            );

            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);

            const data = await response.json();

            if (!data.success)
                throw new Error(data.error || 'Server error');

            this.suites = data.suites || [];

            // *** שמור זמן Run All האחרון ***
            if (data.runAllLastTime) {
                this._runAllLastTime = new Date(data.runAllLastTime);
            }

            this.renderColumns();
            this.updateLastRefresh();
            this.showLoading(false);
            this._checkPendingRunResult(prevSuites);

        } catch (err) {
            console.error('Error loading suites:', err);
            this.showLoading(false);
            this.showError('Error loading data');
        }
    }

    // ==========================================
    // *** בדיקה אם סוויטה ישנה לפי זמן Run All ***
    // ==========================================
    _isSuiteStale(suite) {
        // *** אם אין זמן Run All — fallback ל-12 שעות ***
        if (!this._runAllLastTime) {
            if (!suite.lastRunTime) return true;
            try {
                const diff = Date.now() - new Date(suite.lastRunTime).getTime();
                return diff > 12 * 60 * 60 * 1000;
            } catch { return false; }
        }

        // *** אם אין זמן ריצה לסוויטה — ישנה ***
        if (!suite.lastRunTime) return true;

        try {
            const suiteTime = new Date(suite.lastRunTime);
            const runAllTime = this._runAllLastTime;

            // *** אם Run All רץ אחרי הסוויטה — הסוויטה ישנה ***
            return runAllTime > suiteTime;
        } catch {
            return false;
        }
    }

    // ==========================================
    // רינדור מעטפת
    // ==========================================

    renderShell() {
        this.container.innerHTML = `
            <div class="sd-root">

                <!-- Header -->
                <div class="sd-header">
                    <div class="sd-header-left">
                        <div class="sd-search-wrap">
                            <i class="fas fa-search sd-search-icon"></i>
                            <input
                                id="sdSearchInput"
                                class="sd-search-input"
                                type="text"
                                placeholder="Search..."/>
                            <button id="sdClearSearch"
                                    class="sd-clear-search"
                                    style="display:none">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>

                        <div class="sd-filter-btns">
                            <button class="sd-filter-btn active"
                                    data-f="all">All</button>
                            <button class="sd-filter-btn passed"
                                    data-f="passed">
                                <i class="fas fa-check-circle"></i> Passed
                            </button>
                            <button class="sd-filter-btn failed"
                                    data-f="failed">
                                <i class="fas fa-times-circle"></i> Failed
                            </button>
                        </div>
                        <button class="sd-export-btn"
                                id="sdExportBtn"
                                title="Export">
                            <i class="fas fa-file-export"></i>
                            <span>Export</span>
                        </button>
                        <button class="sd-view-mode-btn ${this.viewMode === 'list' ? 'active' : ''}"
                                id = "sdViewModeBtn"
                                title = "Toggle List/Grid View" >
                            <i class="fas fa-${this.viewMode === 'list' ? 'list' : 'th-large'}"></i>
                            <span id="sdViewModeLabel">
                                        ${this.viewMode === 'list' ? 'Grid View' : 'List View'}
                            </span>
                        </button >
                    </div>

                    <div id="sdSearchBanner" class="sd-search-banner" style="display:none">
                        <i class="fas fa-filter"></i>
                        <span id="sdSearchBannerTerm" class="sd-search-banner-term"></span>
                        <button id="sdSearchBannerClear" class="sd-search-banner-clear">
                            <i class="fas fa-times"></i> Clear
                        </button>
                    </div>

                    <div class="sd-header-right">
                        <button class="sd-collapse-all-btn" id="sdCollapseAllBtn" title="Close/Open All">
                            <i class="fas fa-compress-alt"></i>
                            <span id="sdCollapseAllLabel">Collapse All</span>
                        </button>
                        <button class="sd-compact-btn ${this.compactView ? 'active' : ''}"
                                id="sdCompactBtn"
                                title="Compact View"
                                ${this.viewMode === 'list' ? 'disabled' : ''}>
                            <i class="fas fa-th"></i>
                            <span id="sdCompactLabel">
                                ${this.compactView ? 'Detailed' : 'Compact'}
                            </span>
                        </button>
                        <button class="sd-run-all-btn"
                                id="sdRunAllBtn"
                                title="Run All">
                            <i class="fas fa-play-circle"></i>
                            <span>Run All</span>
                        </button>
                        <button class="sd-sync-btn"
                                id="sdSyncNamesBtn"
                                title="Sync Names">
                            <i class="fas fa-sync"></i>
                            <span>Sync Names</span>
                        </button>
                        <button class="sd-manage-btn"
                                id="sdManageBtn"
                                title="Manage Suites">
                            <i class="fas fa-cog"></i> Manage Suites
                        </button>
                        <span id="sdLastRefresh"
                              class="sd-last-refresh"></span>
                        <button class="sd-refresh-btn"
                                id="sdRefreshBtn"
                                title="Refresh">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                    </div>
                </div>

                <!-- הודעות -->
                <div id="sdError"
                     class="sd-error"
                     style="display:none"></div>
                <div id="sdLoading"
                     class="sd-loading"
                     style="display:none">
                    <i class="fas fa-spinner fa-spin"></i> Loading data...
                </div>

                <!-- פאנל ניהול סוויטות -->
                <div id="sdPopupOverlay" class="sd-popup-overlay" style="display:none">
                    <div class="sd-popup">
                        ${this.buildManagePopupHtml()}
                    </div>
                </div>

                <div id="sdTestActionOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-test-action-popup">
                        <div id="sdTestActionContent"></div>
                    </div>
                </div>
                <div id="sdSuiteActionOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-suite-action-popup">
                        <div id="sdSuiteActionContent"></div>
                    </div>
                </div>
                <!-- פופאפ Sync Names -->
                <div id="sdSyncOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-sync-popup">
                        <div class="sd-popup-header">
                            <span class="sd-popup-title">
                                <i class="fas fa-sync"></i> Update Suite Names
                            </span>
                            <button class="sd-popup-close" id="sdSyncClose">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="sd-sync-body" id="sdSyncBody">
                            <div class="sd-loading">
                                <i class="fas fa-spinner fa-spin"></i>
                                Checking names...
                            </div>
                        </div>
                    </div>
                </div>
                <!-- פופאפ הרצת כל הסוויטות -->
                <div id="sdRunAllOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-run-all-popup">
                        <div id="sdRunAllContent"></div>
                    </div>
                </div>
                <!-- פופאפ הרצת סוויטה -->
                <div id="sdRunSuiteOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-run-suite-popup">
                        <div id="sdRunSuiteContent"></div>
                    </div>
                </div>
                <!-- גריד עמודות -->
                <div class="sd-columns-wrap"
                     id="sdColumnsWrap"></div>
                <!-- פופאפ ניהול אנשי קשר -->
                <div id="sdContactsOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-contacts-popup">
                        <div id="sdContactsContent"></div>
                    </div>
                </div>
                <!-- פופאפ בחירת Export -->
                <div id="sdExportChoiceOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-export-choice-popup">
                        <div class="sd-popup-header">
                            <span class="sd-popup-title">
                                <i class="fas fa-file-export"></i> Export Report
                            </span>
                            <button class="sd-popup-close" id="sdExportChoiceClose">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="sd-export-choice-body">
                            <p class="sd-export-choice-desc">
                                Choose how you want to export the current data:
                            </p>
                            <div class="sd-export-choice-options">

                                <button class="sd-export-choice-btn excel"
                                        id="sdExportChoiceExcel">
                                    <div class="sd-export-choice-icon">
                                        <i class="fas fa-file-excel"></i>
                                    </div>
                                    <div class="sd-export-choice-info">
                                        <div class="sd-export-choice-title">
                                            Export to Excel
                                        </div>
                                        <div class="sd-export-choice-sub">
                                            Download .xlsx file with all test data
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-left
                                            sd-export-choice-arrow"></i>
                                </button>

                                <button class="sd-export-choice-btn email"
                                        id="sdExportChoiceEmail">
                                    <div class="sd-export-choice-icon">
                                        <i class="fas fa-envelope"></i>
                                    </div>
                                    <div class="sd-export-choice-info">
                                        <div class="sd-export-choice-title">
                                            Email Report
                                        </div>
                                        <div class="sd-export-choice-sub">
                                            Download .eml file to send via Outlook
                                        </div>
                                    </div>
                                    <i class="fas fa-chevron-left
                                            sd-export-choice-arrow"></i>
                                </button>

                            </div>
                        </div>
                    </div>
                </div>
                <!-- פופאפ ניהול מערכות לילה -->
                <div id="sdDowntimeMgmtOverlay"
                    class="sd-popup-overlay"
                    style="display:none">
                    <div class="sd-popup" style="max-width:900px">
                        <div class="sd-popup-header">
                            <span class="sd-popup-title">
                                <i class="fas fa-moon" style="color:#fbbf24"></i>
                                ניהול מערכות לילה
                            </span>
                            <button class="sd-popup-close" id="sdDowntimeMgmtClose">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="sd-popup-body" style="padding:16px;display:flex;flex-direction:column;gap:14px">
                            <!-- טופס הוספה -->
                            <div class="sd-mp-add-form">
                                <div class="sd-mp-form-row">
                                    <input id="sdDtNumInput" class="sd-mp-input"
                                        type="number" placeholder="מספר מערכת *"
                                        style="max-width:130px" dir="rtl"/>
                                    <input id="sdDtEnInput" class="sd-mp-input"
                                        type="text" placeholder="שם באנגלית *" dir="rtl"/>
                                    <input id="sdDtHeInput" class="sd-mp-input"
                                        type="text" placeholder="שם בעברית *" dir="rtl"/>
                                    <button class="sd-mp-add-btn" id="sdDtAddBtn">
                                        <i class="fas fa-plus"></i> הוסף
                                    </button>
                                </div>
                                <div id="sdDtFormMsg" class="sd-mp-form-msg"></div>
                            </div>
                            <!-- טבלה -->
                            <div class="sd-mp-table-wrap">
                                <table class="sd-mp-table">
                                    <thead>
                                        <tr>
                                            <th>מספר</th>
                                            <th>שם באנגלית</th>
                                            <th>שם בעברית</th>
                                            <th>פעולות</th>
                                        </tr>
                                    </thead>
                                    <tbody id="sdDtTableBody">
                                        <tr><td colspan="4" class="sd-mp-empty">
                                            <i class="fas fa-spinner fa-spin"></i>
                                        </td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // ==========================================
    // פאנל ניהול — HTML
    // ==========================================
    buildManagePopupHtml() {
        return `
        <div class="sd-popup-header">
            <span class="sd-popup-title">
                <i class="fas fa-list-ul"></i> ניהול סוויטות
            </span>
            <button class="sd-popup-close" id="sdPopupClose">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="sd-popup-body">
            <div class="sd-mp-add-form">
                <div class="sd-mp-form-row">
                    <input id="sdMpUidInput" class="sd-mp-input"
                        type="text" placeholder="parent_container_uid *" dir="ltr"/>
                    <input id="sdMpCbIdInput" class="sd-mp-input"
                        type="text" placeholder="CloudBeat Suite ID (optional)" dir="ltr"
                        style="max-width:220px"/>
                    <label class="sd-mp-patch-label" id="sdMpPatchLabel"
                        title="Mark if this is a post-patch suite">
                        <input type="checkbox"
                            id="sdMpPatchChk"
                            style="display:none"/>
                        <span class="sd-mp-patch-custom-chk"
                            id="sdMpPatchCustomChk">
                            <i class="fas fa-code-branch"></i>
                            Is Post-Patch
                        </span>
                    </label>
                    <button class="sd-mp-add-btn" id="sdMpAddBtn">
                        <i class="fas fa-plus"></i> הוסף
                    </button>

                    <div class="sd-mp-search-wrap">
                        <i class="fas fa-search sd-mp-search-icon"></i>
                        <input id="sdMpSearchInput" class="sd-mp-input sd-mp-search-input"
                            type="text" placeholder="חיפוש בטבלה..." dir="rtl"/>
                        <button id="sdMpClearSearch" class="sd-mp-clear-search" style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <div id="sdMpFormMsg" class="sd-mp-form-msg"></div>
            </div>
            <div class="sd-mp-table-wrap">
                <div id="sdMpTableLoading" class="sd-mp-loading" style="display:none">
                    <i class="fas fa-spinner fa-spin"></i> Loading...
                </div>
                <table class="sd-mp-table">
                    <thead>
                        <tr>
                            <th>#</th><th>UID</th><th>שם תצוגה</th>
                            <th>מספר</th><th>צוות</th><th>דפדפן</th>
                            <th>CloudBeat ID</th>
                            <th>Patch</th>
                            <th>נוסף</th><th>פעולות</th>
                        </tr>
                    </thead>
                    <tbody id="sdMpTableBody">
                        <tr><td colspan="9" class="sd-mp-empty">Loading...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
    }

    // ==========================================
    // פאנל ניהול — פתיחה / סגירה
    // ==========================================
    async openManagePopup() {
        const overlay = document.getElementById('sdPopupOverlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        await this.loadManageTable();
    }

    closeManagePopup() {
        const overlay = document.getElementById('sdPopupOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    // ==========================================
    // פאנל ניהול — טעינת טבלה
    // ==========================================
    async loadManageTable() {
        const tbody = document.getElementById('sdMpTableBody');
        const loading = document.getElementById('sdMpTableLoading');
        if (!tbody) return;

        if (loading) loading.style.display = 'flex';

        try {
            const res = await fetch('/SuiteConfig/GetSuiteConfigs',
                { credentials: 'include' });
            const data = await res.json();

            if (loading) loading.style.display = 'none';

            if (!data.success || !data.suites?.length) {
                tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="sd-mp-empty">
                        No suites configured
                    </td>
                </tr>`;
                return;
            }

            tbody.innerHTML = data.suites.map(s => `
                <tr data-id="${s.id}">
                    <td>${s.id}</td>
                    <td class="sd-mp-uid"
                        title="${this.escHtml(s.parentUid)}">
                        ${this.escHtml(s.parentUid.substring(0, 10) + '...')}
                    </td>
                    <td>
                        <span class="sd-mp-display-name"
                            data-id="${s.id}">
                            ${this.escHtml(s.displayName || s.suiteName)}
                        </span>
                    </td>
                    <td>${this.escHtml(s.suiteNumber)}</td>
                    <td>${this.escHtml(s.suiteTeam)}</td>
                    <td>${this.escHtml(s.suiteBrowser)}</td>
                    <td class="sd-mp-cbid-cell">
                        ${s.cloudBeatId
                    ? `<span class="sd-mp-cbid-badge" title="CloudBeat ID: ${this.escHtml(s.cloudBeatId)}">
                                <i class="fas fa-play-circle" style="color:#4ade80;font-size:0.7rem"></i>
                                ${this.escHtml(s.cloudBeatId)}
                            </span>`
                    : `<span class="sd-mp-cbid-empty">—</span>`
                }
                    </td>
                    <td>
                    <button class="sd-mp-patch-btn"
                            data-id="${s.id}"
                            data-is-patch="${s.isPatchSuite ? '1' : '0'}"
                            title="${s.isPatchSuite
                    ? 'Remove Patch marking'
                    : 'Mark as Patch suite'}">
                        <i class="fas fa-code-branch"
                        style="color:${s.isPatchSuite ? '#a78bfa' : '#444'}"></i>
                    </button>
                    </td>
                    <td class="sd-mp-date">
                        ${this.escHtml(s.addedAt?.substring(0, 10))}
                    </td>
                    <td class="sd-mp-actions">
                        <button class="sd-mp-edit-btn"
                                data-id="${s.id}"
                                data-name="${this.escHtml(s.displayName || s.suiteName)}"
                                title="Edit name">
                            <i class="fas fa-edit"></i>
                        </button>
                        <!-- *** כפתור עריכת CloudBeat ID *** -->
                        <button class="sd-mp-cbid-btn"
                                data-id="${s.id}"
                                data-cbid="${this.escHtml(s.cloudBeatId || '')}"
                                title="Set CloudBeat ID">
                            <i class="fas fa-play-circle"></i>
                        </button>
                        <button class="sd-mp-del-btn"
                                data-id="${s.id}"
                                title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            const currentSearch = document.getElementById('sdMpSearchInput')?.value || '';
            if (currentSearch) this.filterManageTable(currentSearch);

        } catch (err) {
            if (loading) loading.style.display = 'none';
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="sd-mp-empty sd-mp-err">
                        Loading error
                    </td>
                </tr>`;
        }
    }

    // ==========================================
    // פאנל ניהול — הוספת סוויטה
    // ==========================================
    async addSuiteConfig() {
        const uidInput = document.getElementById('sdMpUidInput');
        const cbIdInput = document.getElementById('sdMpCbIdInput');
        const addBtn = document.getElementById('sdMpAddBtn');
        const patchChk = document.getElementById('sdMpPatchChk'); // *** חדש ***

        const uid = uidInput?.value?.trim() || '';
        const cloudBeatId = cbIdInput?.value?.trim() || '';
        const isPatchSuite = patchChk?.checked === true; // *** חדש ***

        if (!uid) {
            this.showMpMsg('Please enter parent_container_uid', 'error');
            return;
        }

        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const res = await fetch('/SuiteConfig/AddSuiteConfig', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    parentUid: uid,
                    cloudBeatId: cloudBeatId || null,
                    isPatchSuite
                })
            });
            const data = await res.json();

            if (data.success) {
                this.showMpMsg('Suite added successfully ✓', 'success');
                if (uidInput) uidInput.value = '';
                if (cbIdInput) cbIdInput.value = ''; // *** חדש ***
                await this.loadManageTable();
                await this.loadData();
            } else {
                this.showMpMsg(data.message || 'Error', 'error');
            }

        } catch (err) {
            this.showMpMsg('Communication error', 'error');
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML = '<i class="fas fa-plus"></i> Add';
            }
        }
    }

    async togglePatchSuite(id, currentIsPatch) {
        try {
            const res = await fetch('/SuiteConfig/UpdateSuiteConfig', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id,
                    isPatchSuite: !currentIsPatch
                })
            });

            const data = await res.json();

            if (data.success) {
                this.showMpMsg(
                    !currentIsPatch
                        ? 'Marked as Post-Patch suite ✓'
                        : 'Removed Patch marking ✓',
                    'success'
                );
                await this.loadManageTable();
                await this.loadData();
            } else {
                this.showMpMsg(data.message || 'Error', 'error');
            }
        } catch (err) {
            this.showMpMsg('Communication error', 'error');
        }
    }

    async editCloudBeatId(id, currentCbId) {
        const newId = prompt(
            'Enter CloudBeat Suite ID\n(Leave empty to delete):',
            currentCbId || ''
        );
        if (newId === null) return; // ביטול

        try {
            const res = await fetch('/SuiteConfig/UpdateSuiteConfig', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id,
                    cloudBeatId: newId.trim() || null
                })
            });

            const data = await res.json();

            if (data.success) {
                this.showMpMsg('CloudBeat ID updated successfully ✓', 'success');
                await this.loadManageTable();
                await this.loadData();
            } else {
                this.showMpMsg(data.message || 'Error', 'error');
            }

        } catch (err) {
            this.showMpMsg('Communication error', 'error');
        }
    }

    openRunSuitePopup(suite, runFailedOnly = false) {
        if (!this.canRun) return;

        // *** בדוק שיש CloudBeat ID ***
        if (!suite.cloudBeatId) {
            this.showError('No CloudBeat ID configured for this suite. Set it in the Manage panel.');
            return;
        }
        this._currentRunFailedOnly = runFailedOnly;
        const overlay = document.getElementById('sdRunSuiteOverlay');
        const content = document.getElementById('sdRunSuiteContent');
        if (!overlay || !content) return;

        content.innerHTML = this.buildRunSuiteHtml(suite, runFailedOnly);
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeRunSuitePopup() {
        const overlay = document.getElementById('sdRunSuiteOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';

        // *** עצור polling אם הפופאפ נסגר ידנית ***
        this._stopPollingForResult();
        this._pendingRunCloudBeatId = null;
        this._pendingRunSuiteName = null;
        this._pendingRunStartTime = null;
        this._currentRunFailedOnly = false;
    }

    buildRunSuiteHtml(suite, runFailedOnly = false) {
        const name = this.escHtml(suite.suiteName || '-');
        const cbId = this.escHtml(suite.cloudBeatId || '');

        const modeLabel = runFailedOnly
            ? `<span class="sd-run-mode-badge failed-only">
               <i class="fas fa-redo-alt"></i> Re-run Failed Only
           </span>`
            : `<span class="sd-run-mode-badge full-run">
               <i class="fas fa-play"></i> Full Run
           </span>`;

        return `
        <div class="sd-tap-header">
            <div class="sd-tap-title">
                <i class="fas fa-play-circle" style="color:#4ade80"></i>
                <span class="sd-tap-name" title="${name}">
                    ${runFailedOnly ? 'Re-run Failed:' : 'Run Suite:'} ${name}
                </span>
            </div>
            <button class="sd-popup-close" id="sdRunSuiteClose">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="sd-tap-body">

            <!-- פרטי סוויטה -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-info-circle"></i> Suite Details
                </div>
                <div class="sd-tap-details-grid">
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Name</span>
                        <span class="sd-tap-detail-value">${name}</span>
                    </div>
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">CloudBeat ID</span>
                        <span class="sd-tap-detail-value sd-tap-mono">${cbId}</span>
                    </div>
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Run Mode</span>
                        <span class="sd-tap-detail-value">${modeLabel}</span>
                    </div>
                </div>
            </div>

            <!-- בחירת מריץ -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-user-cog"></i> Who are you?
                </div>
                <div class="sd-run-runner-options">

                    <label class="sd-run-runner-card ${this._lastRunnerType === 'automation' ? 'selected' : ''}" 
                        data-runner="automation">
                        <input type="radio" name="sdRunnerType"
                            value="automation" 
                            ${this._lastRunnerType === 'automation' ? 'checked' : ''}
                            style="display:none"/>
                        <div class="sd-run-runner-icon">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="sd-run-runner-label">Automation Team</div>
                        <div class="sd-run-runner-check">
                            <i class="fas fa-check-circle"></i>
                        </div>
                    </label>

                    <label class="sd-run-runner-card ${this._lastRunnerType === 'noc' ? 'selected' : ''}" 
                        data-runner="noc">
                        <input type="radio" name="sdRunnerType"
                            value="noc"
                            ${this._lastRunnerType === 'noc' ? 'checked' : ''}
                            style="display:none"/>
                        <div class="sd-run-runner-icon">
                            <i class="fas fa-desktop"></i>
                        </div>
                        <div class="sd-run-runner-label">NOC Team</div>
                        <div class="sd-run-runner-check">
                            <i class="fas fa-check-circle"></i>
                        </div>
                    </label>

                </div>
            </div>

            <!-- Progress -->
            <div id="sdRunProgressWrap" class="sd-run-progress-wrap" style="display:none">
                <div class="sd-run-progress-header">
                    <span id="sdRunProgressLabel" class="sd-run-progress-label">
                        <i class="fas fa-spinner fa-spin"></i> Waiting for response...
                    </span>
                    <span id="sdRunProgressPct" class="sd-run-progress-pct">0%</span>
                </div>
                <div class="sd-run-progress-track">
                    <div id="sdRunProgressBar" class="sd-run-progress-bar" style="width:0%"></div>
                </div>
            </div>

            <!-- הודעת תוצאה -->
            <div id="sdRunSuiteMsg" class="sd-mp-form-msg" style="display:none"></div>

            <!-- כפתורי פעולה -->
            <div class="sd-tap-actions" style="justify-content:flex-end">
                <a class="sd-tap-action-btn sd-tap-cblink-btn
                        ${cbId ? '' : 'sd-tap-run-btn-disabled'}"
                href="${cbId
                ? `https://cloudbeat-prod.menora.co.il/#/suites/138/${cbId}/results`
                : 'javascript:void(0)'}"
                ${cbId ? 'target="_blank"' : ''}
                title="${cbId
                ? 'Open suite results in CloudBeat'
                : 'No CloudBeat ID configured'}">
                    <i class="fas fa-external-link-alt"></i>
                    <span>CloudBeat</span>
                    ${!cbId
                ? `<span class="sd-tap-coming-soon">
                            <i class="fas fa-exclamation-triangle"
                                style="font-size:0.6rem"></i> No ID
                        </span>`
                : ''}
                </a>

                <button class="sd-tap-action-btn"
                        id="sdRunSuiteCancelBtn"
                        style="background:#252535;border-color:#3a3a5a;color:#999">
                    <i class="fas fa-times"></i>
                    <span>Cancel</span>
                </button>

                <button class="sd-tap-action-btn sd-tap-run-btn
                            ${cbId ? '' : 'sd-tap-run-btn-disabled'}"
                        id="sdRunSuiteConfirmBtn"
                        data-suite-id="${cbId}"
                        data-suite-name="${this.escHtml(suite.suiteName || '')}"
                        data-run-failed-only="${runFailedOnly ? '1' : '0'}"
                        ${cbId ? '' : 'disabled'}
                        title="${cbId
                ? (runFailedOnly ? 'Re-run failed tests only' : 'Run suite in CloudBeat')
                : 'No CloudBeat ID configured for this suite'}">
                        <i class="fas fa-${runFailedOnly ? 'redo-alt' : 'play'}"></i>
                        <span>${runFailedOnly ? 'Re-run Failed' : 'Run Suite'}</span>
                    ${!cbId
                ? `<span class="sd-tap-coming-soon">
                            <i class="fas fa-exclamation-triangle"
                                style="font-size:0.6rem"></i> No ID
                        </span>`
                : ''}
                </button>
            </div>

        </div>
    `;
    }

    async runSuite(cloudBeatId, suiteName, runFailedOnly = false) {
        const confirmBtn = document.getElementById('sdRunSuiteConfirmBtn');
        const cancelBtn = document.getElementById('sdRunSuiteCancelBtn');

        // *** קבל את סוג המריץ שנבחר ***
        const runnerRadio = document.querySelector('input[name="sdRunnerType"]:checked');
        const runnerType = runnerRadio?.value || this._lastRunnerType;
        const runnerLabel = runnerType === 'automation' ? 'Automation Team' : 'NOC Team';

        this._lastRunnerType = runnerType;
        localStorage.setItem('sdLastRunnerType', runnerType);

        // *** נעל כפתורים ***
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> <span>Running...</span>';
        }
        if (cancelBtn) cancelBtn.disabled = true;

        // *** הצג progress ועלה ל-50% ***
        this._showRunProgress(true);
        this._setProgressBar(50, 'running', 'Sending request...');

        try {
            const res = await fetch('/SuiteResults/RunCloudBeatSuite', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ cloudBeatId, runnerType, runFailedOnly })
            });

            const data = await res.json();

            if (data.success) {
                // *** נשאר על 50% — ממתין לתוצאה חדשה מ-loadData ***
                this._setProgressBar(50, 'running', 'Waiting for test results...');

                // *** שמור מה רץ כדי ש-loadData ידע לבדוק ***
                this._pendingRunCloudBeatId = cloudBeatId;
                this._pendingRunSuiteName = suiteName;
                this._pendingRunStartTime = new Date();

                // *** הפעל loadData מהיר יותר בזמן המתנה ***
                this._startPollingForResult();

            } else {
                this._setProgressBar(50, 'error', 'Failed to start');
                this.showRunSuiteMsg(data.message || 'Unknown error', 'error');
                this.resetRunSuiteBtn(confirmBtn, cancelBtn);
            }

        } catch (err) {
            this._setProgressBar(50, 'error', `Error: ${err.message}`);
            this.showRunSuiteMsg(`Communication error: ${err.message}`, 'error');
            this.resetRunSuiteBtn(confirmBtn, cancelBtn);
        }
    }

    showRunSuiteMsg(msg, type = 'info') {
        const el = document.getElementById('sdRunSuiteMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `sd-mp-form-msg ${type}`;
        el.style.display = 'block';
    }

    resetRunSuiteBtn(confirmBtn, cancelBtn) {
        // *** הסתר progress ועצור polling ***
        this._showRunProgress(false);
        this._stopPollingForResult();

        // *** נקה state ***
        this._pendingRunCloudBeatId = null;
        this._pendingRunSuiteName = null;
        this._pendingRunStartTime = null;

        if (confirmBtn) {
            confirmBtn.disabled = false;
            // *** קרא מה-instance variable ***
            const runFailedOnly = this._currentRunFailedOnly === true;
            confirmBtn.innerHTML = runFailedOnly
                ? '<i class="fas fa-redo-alt"></i> <span>Re-run Failed</span>'
                : '<i class="fas fa-play"></i> <span>Run Suite</span>';
        }
        if (cancelBtn) cancelBtn.disabled = false;
    }

    // ==========================================
    // Progress helpers
    // ==========================================
    _startPollingForResult() {
        // *** נקה polling קודם אם קיים ***
        this._stopPollingForResult();

        // *** ירוץ כל 40 שניות במקום 60 ***
        this._pollInterval = setInterval(async () => {
            await this.loadData();
        }, 40 * 1000);

        // *** timeout של 10 דקות — אם לא הגיעה תוצאה, בטל ***
        this._pollTimeout = setTimeout(() => {
            this._stopPollingForResult();
            this._setProgressBar(50, 'error', 'Timeout — no result received');
            this.showRunSuiteMsg('Timeout: no result received after 10 minutes', 'error');

            const confirmBtn = document.getElementById('sdRunSuiteConfirmBtn');
            const cancelBtn = document.getElementById('sdRunSuiteCancelBtn');
            this.resetRunSuiteBtn(confirmBtn, cancelBtn);
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

    _setProgressBar(pct, state = 'running', label = '') {
        const bar = document.getElementById('sdRunProgressBar');
        const pctEl = document.getElementById('sdRunProgressPct');
        const lblEl = document.getElementById('sdRunProgressLabel');

        if (bar) {
            bar.style.width = `${pct}%`;
            bar.className = `sd-run-progress-bar ${state}`;
        }

        if (pctEl) {
            pctEl.textContent = `${pct}%`;
            pctEl.style.color =
                state === 'success' ? '#4ade80' :
                    state === 'error' ? '#ef4444' :
                        '#4ade80';
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

    _showRunProgress(show) {
        const wrap = document.getElementById('sdRunProgressWrap');
        if (!wrap) return;

        if (show) {
            const bar = document.getElementById('sdRunProgressBar');
            const pctEl = document.getElementById('sdRunProgressPct');
            if (bar) { bar.style.width = '0%'; bar.className = 'sd-run-progress-bar'; }
            if (pctEl) { pctEl.textContent = '0%'; pctEl.style.color = '#4ade80'; }
            wrap.style.display = 'block';
        } else {
            wrap.style.display = 'none';
        }
    }

    _checkPendingRunResult(prevSuites) {
        // *** אין ריצה ממתינה — לא צריך לבדוק ***
        if (!this._pendingRunCloudBeatId) return;

        // *** מצא את הסוויטה לפי cloudBeatId ***
        const suite = this.suites.find(
            s => s.cloudBeatId === this._pendingRunCloudBeatId
        );

        if (!suite) return;

        // *** מצא את הסוויטה הישנה להשוואה ***
        const prevSuite = prevSuites.find(
            s => s.cloudBeatId === this._pendingRunCloudBeatId
        );

        const prevLastRun = prevSuite?.lastRunTime ? new Date(prevSuite.lastRunTime) : null;
        const newLastRun = suite.lastRunTime ? new Date(suite.lastRunTime) : null;
        const runStartTime = this._pendingRunStartTime;

        // *** בדוק אם lastRunTime חדש יותר מזמן תחילת הריצה ***
        const hasNewResult =
            newLastRun &&
            runStartTime &&
            newLastRun > runStartTime &&
            (!prevLastRun || newLastRun > prevLastRun);

        if (!hasNewResult) return;

        // *** תוצאה חדשה הגיעה! ***
        this._stopPollingForResult();

        const stats = this.calcSuiteStats(suite.tests || []);
        const isSuccess = stats.passRate === 100;

        this._setProgressBar(
            100,
            isSuccess ? 'success' : 'error',
            isSuccess
                ? `✓ Suite completed — ${stats.passed}/${stats.total} passed`
                : `✗ Suite completed — ${stats.failed}/${stats.total} failed`
        );

        // *** הצג הודעה ***
        this.showRunSuiteMsg(
            isSuccess
                ? `✓ "${this._pendingRunSuiteName}" completed successfully!`
                : `"${this._pendingRunSuiteName}" finished — ${stats.failed} test(s) failed`,
            isSuccess ? 'success' : 'error'
        );

        // *** נקה state ***
        this._pendingRunCloudBeatId = null;
        this._pendingRunSuiteName = null;
        this._pendingRunStartTime = null;

        // *** סגור אחרי 10 שניות ***
        setTimeout(() => {
            this.closeRunSuitePopup();
            this.closeSuiteActionPopup();
        }, 10 * 1000);
    }

    _setProgressTo50() {
        const bar = document.getElementById('sdRunProgressBar');
        const pctEl = document.getElementById('sdRunProgressPct');
        const lblEl = document.getElementById('sdRunProgressLabel');

        if (!bar) return;

        // *** CSS transition מטפל באנימציה — אנחנו רק קובעים 50% ***
        bar.className = 'sd-run-progress-bar running';
        bar.style.width = '50%';

        if (pctEl) pctEl.textContent = '50%';
        if (lblEl) lblEl.innerHTML =
            '<i class="fas fa-spinner fa-spin"></i> Waiting for response...';
    }

    _setProgressDone(success) {
        const bar = document.getElementById('sdRunProgressBar');
        const pctEl = document.getElementById('sdRunProgressPct');
        const lblEl = document.getElementById('sdRunProgressLabel');

        if (!bar) return;

        bar.style.width = '100%';
        if (success) {
            bar.className = 'sd-run-progress-bar success';

            if (pctEl) {
                pctEl.textContent = '100%';
                pctEl.style.color = '#4ade80';
            }
            if (lblEl) lblEl.innerHTML =
                '<i class="fas fa-check-circle" style="color:#4ade80"></i>' +
                ' Suite started successfully!';
        } else {
            bar.className = 'sd-run-progress-bar error';

            if (pctEl) {
                pctEl.textContent = '100%';
                pctEl.style.color = '#ef4444';
            }
            if (lblEl) lblEl.innerHTML =
                '<i class="fas fa-times-circle" style="color:#ef4444"></i>' +
                ' Failed to start';
        }
    }

    filterManageTable(term) {
        const tbody = document.getElementById('sdMpTableBody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr[data-id]');
        const t = term.trim().toLowerCase();

        rows.forEach(row => {
            if (!t) {
                row.style.display = '';
                return;
            }
            // חיפוש בכל התאים
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(t) ? '' : 'none';
        });

        // הצג הודעה אם אין תוצאות
        const visible = [...rows].filter(r => r.style.display !== 'none');
        let noResults = tbody.querySelector('.sd-mp-no-results');

        if (visible.length === 0 && t) {
            if (!noResults) {
                noResults = document.createElement('tr');
                noResults.className = 'sd-mp-no-results';
                noResults.innerHTML = `
                <td colspan="8" class="sd-mp-empty">
                    <i class="fas fa-search"></i> No results for "${this.escHtml(term)}"
                </td>`;
                tbody.appendChild(noResults);
            }
        } else {
            noResults?.remove();
        }
    }

    // ==========================================
    // פאנל ניהול — עריכת שם
    // ==========================================

    async editSuiteConfig(id, currentName) {
        const newName = prompt('New display name:', currentName);
        if (newName === null) return;

        try {
            const res = await fetch(
                '/SuiteConfig/UpdateSuiteConfig',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        id,
                        displayName: newName.trim()
                    })
                }
            );

            const data = await res.json();

            if (data.success) {
                this.showMpMsg('Updated successfully ✓', 'success');
                await this.loadManageTable();
                await this.loadData();
            } else {
                this.showMpMsg(data.message || 'Error', 'error');
            }

        } catch (err) {
            this.showMpMsg('Communication error', 'error');
        }
    }

    // ==========================================
    // פאנל ניהול — מחיקה
    // ==========================================

    async deleteSuiteConfig(id) {
        if (!confirm('Delete this suite?')) return;

        try {
            const res = await fetch(
                '/SuiteConfig/DeleteSuiteConfig',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ id })
                }
            );

            const data = await res.json();

            if (data.success) {
                this.showMpMsg('Deleted successfully ✓', 'success');
                await this.loadManageTable();
                await this.loadData();
            } else {
                this.showMpMsg(data.message || 'Error', 'error');
            }

        } catch (err) {
            this.showMpMsg('Communication error', 'error');
        }
    }

    showMpMsg(msg, type = 'info') {
        const el = document.getElementById('sdMpFormMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `sd-mp-form-msg ${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    // ==========================================
    // Sync Names — פתיחת פופאפ ובדיקת שינויים
    // ==========================================

    async openSyncNamesPopup() {
        const overlay = document.getElementById('sdSyncOverlay');
        const body = document.getElementById('sdSyncBody');
        if (!overlay || !body) return;

        // הצג loading
        body.innerHTML = `
        <div class="sd-loading">
            <i class="fas fa-spinner fa-spin"></i> 
            Fetching latest names from API...
        </div>`;

        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // הפעל כפתור
        const btn = document.getElementById('sdSyncNamesBtn');
        if (btn) {
            btn.disabled = true;
            btn.classList.add('syncing');
        }

        try {
            // שלוף את הקונפיגורציה הנוכחית
            const configRes = await fetch(
                '/SuiteConfig/GetSuiteConfigs',
                { credentials: 'include' });
            const configData = await configRes.json();

            if (!configData.success || !configData.suites?.length) {
                body.innerHTML = `
                <div class="sd-tap-no-contacts">
                    <i class="fas fa-info-circle"></i>
                    No suites configured
                </div>`;
                return;
            }

            // שלוף שמות עדכניים מ-Elastic לכל סוויטה
            const syncRes = await fetch(
                '/SuiteResults/FetchLatestSuiteNames',
                { credentials: 'include' });
            const syncData = await syncRes.json();

            if (!syncData.success) {
                body.innerHTML = `
                <div class="sd-tap-no-contacts sd-mp-err">
                    <i class="fas fa-exclamation-circle"></i>
                    Error fetching names: ${this.escHtml(syncData.message || '')}
                </div>`;
                return;
            }

            // השווה שמות
            this._syncResults = this.compareSuiteNames(
                configData.suites,
                syncData.names);

            body.innerHTML = this.buildSyncResultsHtml(
                this._syncResults);

        } catch (err) {
            body.innerHTML = `
            <div class="sd-tap-no-contacts sd-mp-err">
                <i class="fas fa-exclamation-circle"></i>
                Communication error: ${this.escHtml(err.message)}
            </div>`;
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('syncing');
            }
        }
    }

    closeSyncPopup() {
        const overlay = document.getElementById('sdSyncOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
        this._syncResults = null;
    }

    // ==========================================
    // השוואת שמות — מה השתנה?
    // ==========================================

    compareSuiteNames(currentSuites, latestNames) {
        // latestNames = { [uid]: "שם חדש מ-Elastic" }
        return currentSuites.map(suite => {
            const latestName = latestNames[suite.parentUid];
            const currentName = suite.displayName || suite.suiteName;

            if (!latestName) {
                return {
                    id: suite.id,
                    uid: suite.parentUid,
                    currentName,
                    newName: null,
                    status: 'failed',
                    reason: 'Not found in Elastic'
                };
            }

            const changed = latestName !== currentName;
            return {
                id: suite.id,
                uid: suite.parentUid,
                currentName,
                newName: latestName,
                status: changed ? 'updated' : 'unchanged',
                reason: changed ? '' : 'No change'
            };
        });
    }

    // ==========================================
    // בניית HTML לתוצאות Sync
    // ==========================================

    buildSyncResultsHtml(results) {
        const updated = results.filter(r => r.status === 'updated');
        const unchanged = results.filter(r => r.status === 'unchanged');
        const failed = results.filter(r => r.status === 'failed');

        const hasChanges = updated.length > 0;

        const summaryHtml = `
        <div class="sd-sync-summary">
            <div class="sd-sync-stat-box updated">
                <div class="sd-sync-stat-num">${updated.length}</div>
                <div>Will change</div>
            </div>
            <div class="sd-sync-stat-box unchanged">
                <div class="sd-sync-stat-num">${unchanged.length}</div>
                <div>Unchanged</div>
            </div>
            <div class="sd-sync-stat-box failed">
                <div class="sd-sync-stat-num">${failed.length}</div>
                <div>Error</div>
            </div>
        </div>`;

        const tableRows = results.map(r => `
        <tr class="${r.status}">
            <td class="sd-mp-uid" title="${this.escHtml(r.uid)}">
                ${this.escHtml(r.uid.substring(0, 8))}...
            </td>
            <td>
                ${r.status === 'updated' ? `
                    <div class="sd-sync-old-name">
                        ${this.escHtml(r.currentName)}
                    </div>
                    <div class="sd-sync-new-name">
                        ${this.escHtml(r.newName)}
                    </div>
                ` : `
                    <span style="color:#888">
                        ${this.escHtml(r.currentName)}
                    </span>
                `}
            </td>
            <td>
                <span class="sd-sync-status-badge ${r.status}">
                    ${r.status === 'updated' ? '✓ Will change' :
                r.status === 'unchanged' ? '— No change' :
                    '✗ Error'}
                </span>
                ${r.reason ? `
                    <span style="font-size:0.7rem;color:#666;
                                 margin-right:4px">
                        ${this.escHtml(r.reason)}
                    </span>` : ''}
            </td>
        </tr>
    `).join('');

        const applyBtn = hasChanges ? `
        <button class="sd-sync-apply-btn" id="sdSyncApplyBtn">
            <i class="fas fa-check"></i>
            Apply ${updated.length} changes
        </button>` : `
        <div class="sd-tap-no-contacts" 
             style="justify-content:center">
            <i class="fas fa-check-circle" 
               style="color:#22c55e"></i>
            All names are up to date
        </div>`;

        return `
        ${summaryHtml}
        <div style="overflow-x:auto">
            <table class="sd-sync-table">
                <thead>
                    <tr>
                        <th>UID</th>
                        <th>Name</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
        ${applyBtn}
    `;
    }

    // ==========================================
    // החלת שינויים — שמירה ל-Server
    // ==========================================

    async applySyncChanges() {
        if (!this._syncResults) return;

        const toUpdate = this._syncResults
            .filter(r => r.status === 'updated');

        if (!toUpdate.length) return;

        const applyBtn = document.getElementById('sdSyncApplyBtn');
        if (applyBtn) {
            applyBtn.disabled = true;
            applyBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> Updating...';
        }

        try {
            const res = await fetch(
                '/SuiteResults/BulkUpdateSuiteNames',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        updates: toUpdate.map(r => ({
                            id: r.id,
                            displayName: r.newName
                        }))
                    })
                });

            const data = await res.json();

            if (data.success) {
                this.closeSyncPopup();
                await this.loadData();
                this.showError(
                    `✓ ${data.updatedCount} names updated successfully`);
            } else {
                if (applyBtn) {
                    applyBtn.disabled = false;
                    applyBtn.innerHTML =
                        '<i class="fas fa-check"></i> Try again';
                }
            }
        } catch (err) {
            if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.innerHTML =
                    '<i class="fas fa-check"></i> Try again';
            }
        }
    }

    // ==========================================
    // *** החלפת מצב תצוגה קומפקטית ***
    // ==========================================
    toggleCompactView() {
        this.compactView = !this.compactView;

        // *** שמור העדפה ***
        localStorage.setItem('sdCompactView',
            this.compactView ? '1' : '0');

        const btn = document.getElementById('sdCompactBtn');
        const label = document.getElementById('sdCompactLabel');
        if (btn) btn.classList.toggle('active', this.compactView);
        if (label)
            label.textContent = this.compactView ? 'Detailed' : 'Compact';

        const wrap = document.getElementById('sdColumnsWrap');
        if (wrap)
            wrap.classList.toggle('sd-compact-mode', this.compactView);

        this.renderColumns();
    }

    // ==========================================
    // קריסת / פתיחת עמודות
    // ==========================================
    toggleCollapseAll() {
        // *** טיפול מיוחד ב-List View ***
        if (this.viewMode === 'list') {
            this._toggleListViewCollapse();
            return;
        }

        if (this.allCollapsed) {
            this.expandAll();
            const label = document.getElementById('sdCollapseAllLabel');
            const icon = document.querySelector('#sdCollapseAllBtn i');
            if (label) label.textContent = 'Collapse All';
            if (icon) icon.className = 'fas fa-compress-alt';
        } else {
            this.collapseAll();
            const label = document.getElementById('sdCollapseAllLabel');
            const icon = document.querySelector('#sdCollapseAllBtn i');
            if (label) label.textContent = 'Expand All';
            if (icon) icon.className = 'fas fa-expand-alt';
        }
    }

    _toggleListViewCollapse() {
        this.listViewCollapsed = !this.listViewCollapsed;

        const label = document.getElementById('sdCollapseAllLabel');
        const icon = document.querySelector('#sdCollapseAllBtn i');

        if (this.listViewCollapsed) {
            if (label) label.textContent = 'Expand All';
            if (icon) icon.className = 'fas fa-expand-alt';
        } else {
            if (label) label.textContent = 'Collapse All';
            if (icon) icon.className = 'fas fa-compress-alt';

            // *** נקה מצב collapse שמור כשפותחים הכל ***
            this._collapsedListSuites.clear();
        }

        this._applyListViewCollapse();
    }

    _applyListViewCollapse() {
        const tbody = document.getElementById('sdListTableBody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr[data-row-idx]');

        rows.forEach(row => {
            const rowType = row.dataset.type;

            if (this.listViewCollapsed) {
                if (rowType === 'test') {
                    const hasSuiteCell =
                        row.querySelector('.sd-list-suite-first');

                    if (!hasSuiteCell) {
                        row.style.display = 'none';
                    } else {
                        row.style.display = '';

                        // *** קבל שם סוויטה מתא הסוויטה ***
                        const suiteNameCell = row.querySelector(
                            '.sd-list-td-suite[data-suite-name]'
                        );
                        const suiteName =
                            suiteNameCell?.dataset.suiteName || '';

                        // *** הוסף ל-Set ***
                        const suiteKey = row.dataset.suiteKey;
                        if (suiteKey) this._collapsedListSuites.add(suiteKey);

                        this._collapseListRow(row, suiteName);
                    }
                } else {
                    row.style.display = '';
                }
            } else {
                row.style.display = '';
                this._expandListRow(row);
            }
        });
    }

    // ==========================================
    // שורה 1: מצא את מספר העמודות הנכון
    // ==========================================
    _collapseListRow(row, suiteName = '') {
        const testCells = row.querySelectorAll(
            '.sd-list-td-test, .sd-list-td-status, ' +
            '.sd-list-td-priority, .sd-list-td-duration, ' +
            '.sd-list-td-lastrun'
        );
        testCells.forEach(cell => { cell.style.display = 'none'; });

        // עדכן rowspan של תאי הסוויטה ל-1
        const suiteCells = row.querySelectorAll('.sd-list-suite-first');
        suiteCells.forEach(cell => {
            // *** שמור את ה-rowspan המקורי לפני שינוי ***
            if (!cell.dataset.originalRowspan) {
                cell.dataset.originalRowspan = cell.rowSpan;
            }
            cell.rowSpan = 1;
        });

        // *** שמור גם על תא ה-Rate ***
        const rateCells = row.querySelectorAll(
            '.sd-list-td-rate.sd-list-suite-first'
        );
        rateCells.forEach(cell => {
            if (!cell.dataset.originalRowspan) {
                cell.dataset.originalRowspan = cell.rowSpan;
            }
            cell.rowSpan = 1;
        });

        // *** שמור את מספר הטסטים על השורה עצמה ***
        const suiteCell = row.querySelector('.sd-list-suite-first');
        const testCount = suiteCell?.dataset.originalRowspan
            || suiteCell?.rowSpan
            || '1';
        row.dataset.suiteTestCount = testCount;

        const suiteNameCell = row.querySelector(
            '.sd-list-td-suite[data-suite-name]'
        );
        const resolvedSuiteName = suiteName ||
            suiteNameCell?.dataset.suiteName || '';
        // אם כבר קיים תא סיכום בשורה – לא מוסיפים שוב
        if (row.querySelector('.sd-list-td-collapsed-summary')) {
            return;
        }
        const summaryCell = document.createElement('td');
        summaryCell.className = 'sd-list-td-collapsed-summary';
        summaryCell.colSpan = 5;
        summaryCell.setAttribute('data-collapse-cell', '1');
        summaryCell.setAttribute('data-suite-name', resolvedSuiteName);
        summaryCell.style.cursor = 'pointer';
        summaryCell.title = `Click to expand "${resolvedSuiteName}"`;

        summaryCell.innerHTML = `
    <div class="sd-list-collapsed-summary-inner">
        <span class="sd-list-collapsed-label">
            ${resolvedSuiteName
                ? `<span class="sd-list-collapsed-suite-name">
                   ${this.escHtml(resolvedSuiteName)}
               </span>
               <span class="sd-list-collapsed-hint">
                   — click to expand tests
               </span>`
                : 'Click to expand tests'
            }
        </span>
    </div>`;

        const rateCell = row.querySelector('.sd-list-td-rate');
        if (rateCell) {
            row.insertBefore(summaryCell, rateCell);
        } else {
            row.appendChild(summaryCell);
        }
    }

    _expandListRow(row) {
        // הצג תאי טסט
        const testCells = row.querySelectorAll(
            '.sd-list-td-test, .sd-list-td-status, ' +
            '.sd-list-td-priority, .sd-list-td-duration, ' +
            '.sd-list-td-lastrun'
        );
        testCells.forEach(cell => { cell.style.display = ''; });

        // שחזר rowspan מקורי של תא הסוויטה
        const suiteCells = row.querySelectorAll('.sd-list-suite-first');
        suiteCells.forEach(cell => {
            if (cell.dataset.originalRowspan) {
                cell.rowSpan = parseInt(cell.dataset.originalRowspan);
                delete cell.dataset.originalRowspan;
            }
        });

        // הסר תא סיכום
        const collapseCell = row.querySelector('[data-collapse-cell]');
        if (collapseCell) collapseCell.remove();

        // נקה שמירת testCount
        delete row.dataset.suiteTestCount;
    }

    _updatePatchDividerIcon() {
        const divider = document.querySelector(
            '.sd-patch-divider[data-patch-indices]'
        );
        if (!divider) return;

        const indices = divider.dataset.patchIndices
            .split(',')
            .map(Number)
            .filter(Boolean);

        if (!indices.length) return;

        const allCollapsed = indices.every(
            idx => this.collapsedSuites.has(idx)
        );

        const icon = divider.querySelector(
            '.sd-patch-divider-toggle-icon i'
        );
        const label = divider.querySelector(
            '.sd-patch-divider-clickable'
        );

        if (icon) {
            icon.className = `fas fa-chevron-${allCollapsed ? 'down' : 'up'}`;
        }
        if (label) {
            label.title = allCollapsed
                ? 'Click to expand all Post-Patch suites'
                : 'Click to collapse all Post-Patch suites';
        }
    }

    toggleCollapseColumn(index) {
        const idx = parseInt(index);

        if (!this._manuallyExpandedPatch)
            this._manuallyExpandedPatch = new Set();

        if (this.collapsedSuites.has(idx)) {
            this.collapsedSuites.delete(idx);
            this._manuallyExpandedPatch.add(idx);
        } else {
            this.collapsedSuites.add(idx);
            this._manuallyExpandedPatch.delete(idx);
        }
        this._applyCollapseState(idx);

        // *** עדכן אייקון המפריד אם זו סוויטת Patch ***
        this._updatePatchDividerIcon();
    }

    collapseAll() {
        this.allCollapsed = true;
        const filtered = this.getFilteredSuites();
        filtered.forEach((_, i) => {
            this.collapsedSuites.add(i + 1);
            this._applyCollapseState(i + 1);
        });
        // *** נקה פתיחות ידניות של Patch ***
        this._manuallyExpandedPatch?.clear();
    }

    expandAll() {
        this.allCollapsed = false;

        const filtered = this.getFilteredSuites();

        filtered.forEach((suite, i) => {
            const idx = i + 1;

            // *** אל תפתח סוויטות Patch ***
            if (suite.isPatchSuite) {
                this.collapsedSuites.add(idx);
                this._manuallyExpandedPatch?.delete(idx);
                return;
            }

            this.collapsedSuites.delete(idx);
            this._applyCollapseState(idx);
        });
    }

    _applyCollapseState(idx) {
        const col = document.querySelector(`.sd-column[data-index="${idx}"]`);
        if (!col) return;

        const isCollapsed = this.collapsedSuites.has(idx);
        const header = col.querySelector('.sd-col-header');
        const body = col.querySelector('.sd-col-body');
        const btn = col.querySelector('.sd-col-toggle-btn');
        const icon = btn?.querySelector('i');

        if (header) header.classList.toggle('sd-collapsed', isCollapsed);

        if (body) {
            if (isCollapsed) {
                // סגירה — slide up
                body.style.maxHeight = body.scrollHeight + 'px';
                body.style.overflow = 'hidden';
                body.getBoundingClientRect(); // force reflow
                body.style.transition = 'max-height 0.3s ease, padding 0.3s ease';
                body.style.maxHeight = '0';
                body.style.paddingTop = '0';
                body.style.paddingBottom = '0';

                body.addEventListener('transitionend', () => {
                    if (this.collapsedSuites.has(idx)) {
                        body.classList.add('sd-body-hidden');
                        body.style.transition = '';
                        body.style.maxHeight = '';
                        body.style.paddingTop = '';
                        body.style.paddingBottom = '';
                        body.style.overflow = '';
                    }
                }, { once: true });

            } else {
                // פתיחה — slide down
                body.classList.remove('sd-body-hidden');
                body.style.overflow = 'hidden';
                body.style.maxHeight = '0';
                body.style.paddingTop = '0';
                body.style.paddingBottom = '0';
                body.getBoundingClientRect(); // force reflow
                body.style.transition = 'max-height 0.3s ease, padding 0.3s ease';
                body.style.maxHeight = body.scrollHeight + 'px';
                body.style.paddingTop = '';
                body.style.paddingBottom = '';

                body.addEventListener('transitionend', () => {
                    if (!this.collapsedSuites.has(idx)) {
                        body.style.transition = '';
                        body.style.maxHeight = '';
                        body.style.overflow = '';
                    }
                }, { once: true });
            }
        }

        if (icon) icon.className = `fas fa-chevron-${isCollapsed ? 'down' : 'up'}`;
        if (btn) btn.title = isCollapsed ? 'Expand' : 'Collapse';
    }

    _updateSearchIndicator() {
        const banner = document.getElementById('sdSearchBanner');
        const bannerTerm = document.getElementById('sdSearchBannerTerm');
        const searchInput = document.getElementById('sdSearchInput');
        const searchWrap = document.querySelector('.sd-search-wrap');

        const hasSearch = this.searchTerm.trim().length > 0;
        const hasFilter = this.statusFilter !== 'all';
        const isActive = hasSearch || hasFilter;

        // *** הצג/הסתר באנר ***
        if (banner) banner.style.display = isActive ? 'flex' : 'none';

        // *** עדכן טקסט הבאנר ***
        if (bannerTerm) {
            const parts = [];
            if (hasSearch)
                parts.push(`"${this.escHtml(this.searchTerm.trim())}"`);
            if (hasFilter)
                parts.push(this.statusFilter === 'passed' ? 'Passed ✓' : 'Failed ✗');
            bannerTerm.innerHTML = parts.join(' + ');
        }

        // *** הדגש שדה חיפוש בצהוב כשפעיל ***
        if (searchInput) {
            searchInput.classList.toggle('sd-search-active', hasSearch);
        }

        // *** הדגש עטיפת החיפוש ***
        if (searchWrap) {
            searchWrap.classList.toggle('sd-search-wrap-active', isActive);
        }
    }

    // ==========================================
    // רינדור עמודות
    // ==========================================

    renderColumns() {
        const wrap = document.getElementById('sdColumnsWrap');
        if (!wrap) return;

        wrap.classList.toggle('sd-compact-mode', this.compactView);
        wrap.innerHTML = '';

        const filtered = this.getFilteredSuites();

        // *** תצוגת רשימה ***
        if (this.viewMode === 'list') {
            this.buildListView(filtered);
            return;
        }

        if (filtered.length === 0) {
            wrap.innerHTML = `
            <div class="sd-no-data">
                <i class="fas fa-inbox"></i>
                <p>No data to display</p>
            </div>`;
            return;
        }

        // *** הפרד לשתי קבוצות ***
        const regularSuites = filtered
            .filter(s => !s.isPatchSuite)
            .sort((a, b) =>
                (a.suiteName || '').toLowerCase()
                    .localeCompare((b.suiteName || '').toLowerCase()));

        const patchSuites = filtered
            .filter(s => s.isPatchSuite)
            .sort((a, b) =>
                (a.suiteName || '').toLowerCase()
                    .localeCompare((b.suiteName || '').toLowerCase()));

        let idx = 1;

        // *** רנדר סוויטות רגילות ***
        if (regularSuites.length > 0) {
            regularSuites.forEach(suite => {
                wrap.appendChild(this.buildSuiteColumn(suite, idx++));
            });
        }

        // *** *** הוסף טבלת מערכות לילה בין הקבוצות *** ***
        if (patchSuites.length > 0 || regularSuites.length > 0) {
            wrap.appendChild(this.buildDowntimeDivider());
        }

        // *** רנדר מפריד + סוויטות פאצ' ***
        if (patchSuites.length > 0) {

            // *** חשב אינדקסים של סוויטות Patch ***
            const patchStartIdx = idx;
            const patchIndices = patchSuites.map((_, i) => patchStartIdx + i);

            // *** קרוס אוטומטית בטעינה ראשונה ***
            patchIndices.forEach(pIdx => {
                if (!this._manuallyExpandedPatch?.has(pIdx)) {
                    this.collapsedSuites.add(pIdx);
                }
            });

            // *** בדוק אם כולן סגורות כרגע ***
            const allPatchCollapsed = patchIndices.every(
                pIdx => this.collapsedSuites.has(pIdx)
            );

            // *** בנה מפריד עם כפתור toggle ***
            const divider = document.createElement('div');
            divider.className = 'sd-patch-divider';
            divider.dataset.patchIndices = patchIndices.join(',');
            divider.innerHTML = `
            <div class="sd-patch-divider-line"></div>
            <div class="sd-patch-divider-label sd-patch-divider-clickable"
                title="${allPatchCollapsed
                    ? 'Click to expand all Post-Patch suites'
                    : 'Click to collapse all Post-Patch suites'}">
                <i class="fas fa-code-branch"></i>
                Run Only After Security Updates
                <span class="sd-patch-divider-count">
                    ${patchSuites.length}
                </span>
                <span class="sd-patch-divider-toggle-icon">
                    <i class="fas fa-chevron-${allPatchCollapsed ? 'down' : 'up'}"></i>
                </span>
            </div>
            <div class="sd-patch-divider-line"></div>
        `;

            // *** הוסף event listener ישירות על המפריד ***
            const label = divider.querySelector('.sd-patch-divider-clickable');
            label.addEventListener('click', () => {
                this._toggleAllPatchSuites(patchIndices, divider);
            });

            wrap.appendChild(divider);

            patchSuites.forEach(suite => {
                wrap.appendChild(this.buildSuiteColumn(suite, idx++));
            });
        }
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'grid' ? 'list' : 'grid';
        localStorage.setItem('sdViewMode', this.viewMode);

        this.listViewCollapsed = false;

        // *** שמות משתנים ברורים ונפרדים ***
        const collapseLabel = document.getElementById('sdCollapseAllLabel');
        const collapseIcon = document.querySelector('#sdCollapseAllBtn i');
        const viewModeBtn = document.getElementById('sdViewModeBtn');
        const viewModeLabel = document.getElementById('sdViewModeLabel');

        // *** כפתור Compact — מושבת ב-List View ***
        const compactBtn = document.getElementById('sdCompactBtn');
        const compactLabel = document.getElementById('sdCompactLabel');
        if (compactBtn) {
            compactBtn.disabled = this.viewMode === 'list';
            compactBtn.title = this.viewMode === 'list'
                ? 'Compact View is not available in List View'
                : 'Compact View';
        }

        // *** אפס מצב Collapse ***
        if (collapseLabel) collapseLabel.textContent = 'Collapse All';
        if (collapseIcon) collapseIcon.className = 'fas fa-compress-alt';

        // *** עדכן כפתור View Mode ***
        if (viewModeBtn) {
            viewModeBtn.classList.toggle('active', this.viewMode === 'list');
            const btnIcon = viewModeBtn.querySelector('i');
            if (btnIcon) {
                btnIcon.className = this.viewMode === 'list'
                    ? 'fas fa-list'
                    : 'fas fa-th-large';
            }
        }

        // *** עדכן תווית View Mode — בנפרד מ-Collapse ***
        if (viewModeLabel) {
            viewModeLabel.textContent = this.viewMode === 'list'
                ? 'Grid View'
                : 'List View';
        }

        this.renderColumns();
    }

    buildListView(filtered) {
        const wrap = document.getElementById('sdColumnsWrap');
        if (!wrap) return;

        wrap.innerHTML = '';
        wrap.classList.remove('sd-compact-mode');

        const container = document.createElement('div');
        container.className = 'sd-list-view';
        container.style.gridColumn = '1 / -1';

        // *** חשב סטטיסטיקות כלליות ***
        let totalPassed = 0, totalFailed = 0, totalTests = 0;
        filtered.forEach(suite => {
            const stats = this.calcSuiteStats(suite.tests || []);
            totalPassed += stats.passed;
            totalFailed += stats.failed;
            totalTests += stats.total;
        });

        const overallRate = totalTests > 0
            ? Math.round((totalPassed / totalTests) * 100) : 0;

        const overallColor = overallRate === 100
            ? '#22c55e'
            : overallRate >= 70
                ? '#f59e0b'
                : '#ef4444';

        // *** בנה שורות — כל טסט שורה נפרדת ***
        const allRows = [];
        filtered.forEach(suite => {
            const stats = this.calcSuiteStats(suite.tests || []);
            const tests = suite.tests || [];

            if (tests.length === 0) {
                allRows.push({
                    type: 'empty-suite',
                    suite,
                    stats,
                    test: null
                });
            } else {
                tests.forEach((test, testIdx) => {
                    allRows.push({
                        type: 'test',
                        suite,
                        stats,
                        test,
                        testIdx,
                        isFirstInSuite: testIdx === 0,
                        suiteTestCount: tests.length
                    });
                });
            }
        });

        container.innerHTML = `
        <!-- ===== סיכום כללי ===== -->
        <div class="sd-list-summary">
            <div class="sd-list-summary-stat">
                <span class="sd-list-summary-num"
                      style="color:#22c55e">${totalPassed}</span>
                <span class="sd-list-summary-label">Passed</span>
            </div>
            <div class="sd-list-summary-stat">
                <span class="sd-list-summary-num"
                      style="color:#ef4444">${totalFailed}</span>
                <span class="sd-list-summary-label">Failed</span>
            </div>
            <div class="sd-list-summary-stat">
                <span class="sd-list-summary-num"
                      style="color:#aaa">${totalTests}</span>
                <span class="sd-list-summary-label">Total Tests</span>
            </div>
            <div class="sd-list-summary-stat">
                <span class="sd-list-summary-num"
                      style="color:#7ab3ef">${filtered.length}</span>
                <span class="sd-list-summary-label">Suites</span>
            </div>
        </div>

        <!-- ===== טבלת טסטים ===== -->
        <div class="sd-list-table-wrap">
            <table class="sd-list-table">
                <thead>
                    <tr>
                        <th class="sd-list-th-suite">Suite</th>
                        <th class="sd-list-th-test">Test Name</th>
                        <th class="sd-list-th-status">Status</th>
                        <th class="sd-list-th-priority">Priority</th>
                        <th class="sd-list-th-duration">Duration</th>
                        <th class="sd-list-th-lastrun">Last Run</th>
                        <th class="sd-list-th-rate">Suite Rate</th>
                    </tr>
                </thead>
                <tbody id="sdListTableBody">
                    ${allRows.map((row, rowIdx) => {

            if (row.type === 'empty-suite') {
                const rateColor = row.stats.passRate === 100
                    ? '#22c55e'
                    : row.stats.hasFailure
                        ? '#ef4444'
                        : row.stats.hasWarning
                            ? '#f59e0b'
                            : '#ef4444';
                const isSuiteStale = this._isSuiteStale(row.suite);
                const suiteKey = this._getSuiteKey(row.suite);

                return `
                <tr class="sd-list-row sd-list-row-empty-suite
                        ${isSuiteStale ? 'sd-list-row-stale' : ''}"
                        data-row-idx="${rowIdx}"
                        data-type="suite">
                    <td class="sd-list-td-suite sd-list-suite-first"
                        data-suite-key="${this.escHtml(suiteKey)}">
                        <div class="sd-list-suite-cell-inline">
                            <button class="sd-list-suite-collapse-btn"
                                    data-suite-key="${this.escHtml(suiteKey)}"
                                    data-collapsed="0"
                                    title="Collapse suite">
                                <i class="fas fa-chevron-up"></i>
                            </button>
                            ${row.suite.isPatchSuite
                        ? `<i class="fas fa-code-branch sd-list-patch-icon"></i>`
                        : ''}
                            <span class="sd-list-suite-name"
                                  title="${this.escHtml(row.suite.suiteName)}">
                                ${this.escHtml(this.shortenSuiteName(row.suite.suiteName))}
                            </span>
                            <span class="sd-list-suite-stats-inline">
                                <span class="sd-list-suite-stat-passed">${row.stats.passed}</span>
                                <span class="sd-list-suite-stat-sep">/</span>
                                <span class="sd-list-suite-stat-failed">${row.stats.failed}</span>
                                <span class="sd-list-suite-stat-sep">/</span>
                                <span class="sd-list-suite-stat-total">${row.stats.total}</span>
                            </span>
                            <span class="sd-list-suite-team-inline">
                                ${this.escHtml(row.suite.suiteTeam || '-')}
                            </span>
                            <span class="sd-list-suite-browser-inline">
                                <i class="fas fa-globe sd-list-browser-icon"></i>
                                ${this.escHtml(row.suite.suiteBrowser || '-')}
                            </span>
                        </div>
                    </td>
                    <td colspan="5"
                        class="sd-list-td-no-tests">
                        <i class="fas fa-info-circle"></i>
                        No tests
                    </td>
                    <td class="sd-list-td-rate">
                        <div class="sd-list-rate-wrap">
                            <div class="sd-list-rate-bar-track">
                                <div class="sd-list-rate-bar"
                                     style="width:${row.stats.passRate}%;
                                            background:${rateColor}">
                                </div>
                            </div>
                            <span style="color:${rateColor};
                                         font-weight:700;
                                         font-size:0.75rem;
                                         min-width:36px">
                                ${row.stats.passRate}%
                            </span>
                        </div>
                    </td>
                </tr>`;
            }

            // *** שורת טסט רגילה ***
            const test = row.test;
            const suite = row.suite;
            const statusLow = (test.status || '').toLowerCase();
            const isPassed = statusLow === 'passed';
            const isFailed = statusLow === 'failed';
            const isWarning = statusLow === 'warning';

            const statusIcon = isPassed
                ? `<i class="fas fa-check-circle sd-list-status-icon passed"></i>`
                : isFailed
                    ? `<i class="fas fa-times-circle sd-list-status-icon failed"></i>`
                    : isWarning
                        ? `<i class="fas fa-exclamation-circle sd-list-status-icon warning"></i>`
                        : `<i class="fas fa-question-circle sd-list-status-icon unknown"></i>`;

            const isOldTestRun = (() => {
                if (!test.lastRunTime) return true;
                try {
                    const diff = Date.now() - new Date(test.lastRunTime).getTime();
                    return diff > 12 * 60 * 60 * 1000;
                } catch { return false; }
            })();

            const rateColor = row.stats.passRate === 100
                ? '#22c55e'
                : row.stats.hasFailure
                    ? '#ef4444'
                    : row.stats.hasWarning
                        ? '#f59e0b'
                        : '#ef4444';

            const priorityHtml = test.priority
                ? `<span class="sd-list-priority ${(test.priority).toLowerCase()}">
                   ${this.escHtml(test.priority)}
               </span>`
                : '<span class="sd-list-priority-empty">—</span>';

            const contacts =
                (test.testId && this.contactsCache[test.testId])
                    ? this.contactsCache[test.testId]
                    : (test.contacts || []);
            const mailTo = contacts.map(c => c.email).join(';');
            const cc = 'noc@menora.co.il';
            const mailSubject = encodeURIComponent(
                `[Test Failed] ${test.containerName || test.testName || ''}`
            );
            const mailBody = encodeURIComponent(
                `שלום,\n\nהבדיקה הבאה נכשלה:\n` +
                `שם: ${test.containerName || test.testName || ''}\n` +
                `Suite: ${suite.suiteName || ''}\n` +
                `סטטוס: ${test.status || '-'}\n` +
                `זמן ריצה: ${this.fmtDuration(test.durationSeconds)}\n` +
                `זמן ריצה אחרון: ${this.fmtFullDate(test.lastRunTime)}\n` +
                `נא לבדוק.\n\nתודה`
            );
            const mailHref = (!isPassed && mailTo)
                ? `mailto:${mailTo}?cc=${encodeURIComponent(cc)}&subject=${mailSubject}&body=${mailBody}`
                : null;

            const mailIconHtml = mailHref
                ? `<a class="sd-list-mail-icon"
                  href="${mailHref}"
                  target="_blank"
                  title="Send failure email"
                  onclick="event.stopPropagation()">
                   <i class="fas fa-envelope"></i>
               </a>`
                : '';

            const isSuiteStale = this._isSuiteStale(row.suite);
            const suiteKey = this._getSuiteKey(suite);

            // *** תא סוויטה — מוצג רק בשורה הראשונה ***
            const suiteCellHtml = row.isFirstInSuite
                ? `<td class="sd-list-td-suite sd-list-suite-first"
                  rowspan="${row.suiteTestCount}"
                  data-suite-key="${this.escHtml(suiteKey)}"
                  data-suite-name="${this.escHtml(suite.suiteName)}">
                   <div class="sd-list-suite-cell-inline">
                       <button class="sd-list-suite-collapse-btn"
                               data-suite-key="${this.escHtml(suiteKey)}"
                               data-collapsed="0"
                               title="Collapse suite">
                           <i class="fas fa-chevron-up"></i>
                       </button>
                       ${suite.isPatchSuite
                    ? `<i class="fas fa-code-branch sd-list-patch-icon"></i>`
                    : ''}
                       <span class="sd-list-suite-name"
                             title="${this.escHtml(suite.suiteName)}">
                           ${this.escHtml(this.shortenSuiteName(suite.suiteName))}
                       </span>
                       <span class="sd-list-suite-stats-inline">
                           <span class="sd-list-suite-stat-passed">${row.stats.passed}</span>
                           <span class="sd-list-suite-stat-sep">/</span>
                           <span class="sd-list-suite-stat-failed">${row.stats.failed}</span>
                           <span class="sd-list-suite-stat-sep">/</span>
                           <span class="sd-list-suite-stat-total">${row.stats.total}</span>
                       </span>
                       <span class="sd-list-suite-team-inline">
                           ${this.escHtml(suite.suiteTeam || '-')}
                       </span>
                       <span class="sd-list-suite-browser-inline">
                           <i class="fas fa-globe sd-list-browser-icon"></i>
                           ${this.escHtml(suite.suiteBrowser || '-')}
                       </span>
                   </div>
               </td>`
                : '';

            return `
            <tr class="sd-list-row
                    sd-list-row-test
                    ${statusLow}
                    ${isSuiteStale ? 'sd-list-row-stale' : ''}
                    ${row.isFirstInSuite ? 'sd-list-row-suite-first' : ''}
                    ${row.testIdx === row.suiteTestCount - 1 ? 'sd-list-row-suite-last' : ''}"
                    data-row-idx="${rowIdx}"
                    data-type="test"
                    data-suite-key="${this.escHtml(suiteKey)}">

                ${suiteCellHtml}

                <!-- שם טסט -->
                <td class="sd-list-td-test">
                    <div class="sd-list-test-cell">
                        ${statusIcon}
                        <span class="sd-list-test-name"
                            title="${this.escHtml(test.containerName || test.testName || '')}">
                            ${this.escHtml(test.containerName || test.testName || '-')}
                        </span>
                        ${this._isDowntimeTest(test.containerName || test.testName || '')
                    ? `<i class="fas fa-moon sd-list-night-icon"
                                title="System goes down 22:00–05:00"></i>`
                    : ''}
                        ${mailIconHtml}
                    </div>
                </td>

                <!-- סטטוס -->
                <td class="sd-list-td-status">
                    <span class="sd-list-status-badge ${statusLow}">
                        ${statusIcon}
                        ${this.escHtml(test.status || '-')}
                    </span>
                </td>

                <!-- עדיפות -->
                <td class="sd-list-td-priority">
                    ${priorityHtml}
                </td>

                <!-- משך -->
                <td class="sd-list-td-duration">
                    <i class="fas fa-clock sd-list-clock-icon"></i>
                    ${this.escHtml(this.fmtDuration(test.durationSeconds))}
                </td>

                <!-- זמן ריצה אחרון -->
                <td class="sd-list-td-lastrun ${isOldTestRun ? 'sd-list-td-lastrun-old' : ''}"
                    title="${this.escHtml(test.lastRunTime || '')}">
                    ${this.fmtLastRun(test.lastRunTime)}
                </td>

                <!-- אחוז הצלחה של הסוויטה -->
                ${row.isFirstInSuite
                    ? `<td class="sd-list-td-rate sd-list-suite-first"
                          rowspan="${row.suiteTestCount}">
                       <div class="sd-list-rate-wrap">
                           <div class="sd-list-rate-bar-track">
                               <div class="sd-list-rate-bar"
                                    style="width:${row.stats.passRate}%;
                                           background:${rateColor}">
                               </div>
                           </div>
                           <span style="color:${rateColor};
                                        font-weight:700;
                                        font-size:0.75rem;
                                        min-width:36px">
                               ${row.stats.passRate}%
                           </span>
                       </div>
                   </td>`
                    : ''}
            </tr>`;
        }).join('')}
                </tbody>
            </table>
        </div>
    `;

        wrap.appendChild(container);

        // *** Event listeners ***
        const tbody = container.querySelector('#sdListTableBody');
        if (tbody) {
            tbody.addEventListener('click', e => {

                // *** כפתור collapse של סוויטה בודדת ***
                const collapseBtn = e.target.closest('.sd-list-suite-collapse-btn');
                if (collapseBtn) {
                    e.stopPropagation();
                    const suiteKey = collapseBtn.dataset.suiteKey;
                    this._toggleSingleSuiteCollapse(suiteKey, collapseBtn, allRows);
                    return;
                }

                const row = e.target.closest('tr[data-row-idx]');
                if (!row) return;

                const rowIdx = parseInt(row.dataset.rowIdx);
                const rowData = allRows[rowIdx];
                if (!rowData) return;

                // *** לחיצה על תא סוויטה — פתח פופאפ סוויטה ***
                if (e.target.closest('.sd-list-td-suite')) {
                    if (rowData.suite) {
                        this.openSuiteActionPopup(rowData.suite);
                    }
                    return;
                }

                // *** לחיצה על שורת טסט — פתח פופאפ טסט ***
                if (rowData.type === 'test' && rowData.test) {
                    const enrichedTest = {
                        ...rowData.test,
                        suiteCbId: rowData.suite.cloudBeatId || '',
                        suiteName: rowData.suite.suiteName || ''
                    };
                    this.openTestActionPopup(enrichedTest);
                }

                // *** לחיצה על שורת סוויטה ריקה ***
                if (rowData.type === 'empty-suite' && rowData.suite) {
                    this.openSuiteActionPopup(rowData.suite);
                }
            });
        }
        // *** החל מצב collapse שמור — אחרי שה-DOM מוכן ***
        // *** setTimeout(0) מבטיח שה-DOM עודכן לפני ההחלה ***
        setTimeout(() => {
            this._applyListSuiteCollapseState(allRows);
        }, 0);
    }

    // ==========================================
    // *** מפתח ייחודי לסוויטה ***
    // ==========================================
    _getSuiteKey(suite) {
        // שימוש ב-parentUid אם קיים, אחרת suiteName
        return suite.suiteUid || suite.suiteKey || suite.parentUid || suite.suiteName || '';
    }

    // ==========================================
    // *** Toggle collapse של סוויטה בודדת ב-List View ***
    // ==========================================
    _toggleSingleSuiteCollapse(suiteKey, btn, allRows) {
        const tbody = document.getElementById('sdListTableBody');
        if (!tbody) return;

        const isCollapsed = btn.dataset.collapsed === '1';
        const rows = tbody.querySelectorAll('tr[data-row-idx]');

        if (isCollapsed) {
            // ==========================================
            // פתיחה
            // ==========================================

            // *** הסר מה-Set ***
            this._collapsedListSuites.delete(suiteKey);

            // מצא את השורה הראשונה של הסוויטה
            let firstRow = null;
            rows.forEach(row => {
                if (row.dataset.suiteKey === suiteKey &&
                    row.querySelector('.sd-list-suite-first')) {
                    firstRow = row;
                }
            });

            if (!firstRow) return;

            // *** קרא את מספר הטסטים שנשמר ***
            const testCount = parseInt(
                firstRow.dataset.suiteTestCount || '1'
            );

            // *** שחזר את השורה הראשונה ***
            this._expandListRow(firstRow);

            // *** הצג את שאר השורות של הסוויטה ***
            let shown = 1;
            rows.forEach(row => {
                if (row === firstRow) return;
                if (row.dataset.suiteKey !== suiteKey) return;
                if (shown >= testCount) return;

                row.style.display = '';
                shown++;
            });

            btn.dataset.collapsed = '0';
            btn.title = 'Collapse suite';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fas fa-chevron-up';

        } else {
            // ==========================================
            // סגירה
            // ==========================================

            // *** הוסף ל-Set ***
            this._collapsedListSuites.add(suiteKey);

            rows.forEach(row => {
                if (row.dataset.suiteKey !== suiteKey) return;

                const hasSuiteCell =
                    row.querySelector('.sd-list-suite-first');

                if (!hasSuiteCell) {
                    // שורות נוספות — הסתר
                    row.style.display = 'none';
                } else {
                    // שורה ראשונה — הצג עם סיכום
                    row.style.display = '';

                    const suiteNameCell = row.querySelector(
                        '.sd-list-td-suite[data-suite-name]'
                    );
                    const suiteName =
                        suiteNameCell?.dataset.suiteName || '';

                    this._collapseListRow(row, suiteName);
                }
            });

            btn.dataset.collapsed = '1';
            btn.title = 'Expand suite';
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'fas fa-chevron-down';
        }
    }

    // ==========================================
    // *** החלת מצב collapse שמור על List View ***
    // ==========================================
    _applyListSuiteCollapseState(allRows) {
        if (!this._collapsedListSuites.size) return;

        const tbody = document.getElementById('sdListTableBody');
        if (!tbody) {
            console.warn('tbody not found!');
            return;
        }

        const rows = tbody.querySelectorAll('tr[data-row-idx]');

        this._collapsedListSuites.forEach(suiteKey => {
            let collapseBtn = null;
            let firstRow = null;

            rows.forEach(row => {
                if (row.dataset.suiteKey !== suiteKey) return;
                const btn = row.querySelector('.sd-list-suite-collapse-btn');
                if (btn && row.querySelector('.sd-list-suite-first')) {
                    collapseBtn = btn;
                    firstRow = row;
                }
            });

            if (!collapseBtn || !firstRow) return;

            // *** בדוק כמה שורות יש לסוויטה ***
            let suiteRows = [];
            rows.forEach(row => {
                if (row.dataset.suiteKey === suiteKey) suiteRows.push(row);
            });

            // החל collapse
            rows.forEach(row => {
                if (row.dataset.suiteKey !== suiteKey) return;

                const hasSuiteCell = row.querySelector('.sd-list-suite-first');

                if (!hasSuiteCell) {
                    row.style.display = 'none';
                } else {
                    row.style.display = '';
                    const suiteNameCell = row.querySelector(
                        '.sd-list-td-suite[data-suite-name]'
                    );
                    const suiteName = suiteNameCell?.dataset.suiteName || '';
                    this._collapseListRow(row, suiteName);
                }
            });

            collapseBtn.dataset.collapsed = '1';
            collapseBtn.title = 'Expand suite';
            const icon = collapseBtn.querySelector('i');
            if (icon) icon.className = 'fas fa-chevron-down';
        });
    }

    _expandSingleSuite(suiteName) {
        const tbody = document.getElementById('sdListTableBody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr[data-row-idx]');

        // *** מצא את כל השורות של הסוויטה הזו ***
        let firstRow = null;

        rows.forEach(row => {
            const rowType = row.dataset.type;
            if (rowType !== 'test') return;

            // *** שורה ראשונה של הסוויטה — יש לה תא סוויטה ***
            const suiteCell = row.querySelector(
                `.sd-list-td-suite[data-suite-name=
            "${CSS.escape(suiteName)}"]`
            );

            if (suiteCell) {
                firstRow = row;
            }
        });

        if (!firstRow) return;

        // *** שחזר את השורה הראשונה ***
        this._expandListRow(firstRow);

        // *** מצא את מספר הטסטים מה-rowspan המקורי ***
        const suiteCell = firstRow.querySelector(
            '.sd-list-td-suite'
        );
        const testCount = suiteCell
            ? parseInt(suiteCell.rowSpan) || 1
            : 1;

        // *** הצג את שאר השורות של הסוויטה ***
        const firstRowIdx = parseInt(firstRow.dataset.rowIdx);
        let shown = 1;

        rows.forEach(row => {
            if (row === firstRow) return;
            const rowType = row.dataset.type;
            if (rowType !== 'test') return;

            const rowIdx = parseInt(row.dataset.rowIdx);

            // *** שורות שמיד אחרי השורה הראשונה ואין להן תא סוויטה ***
            if (rowIdx > firstRowIdx &&
                shown < testCount &&
                !row.querySelector('.sd-list-suite-first')) {
                row.style.display = '';
                shown++;
            }
        });

        // *** אנימציית highlight ***
        this._highlightExpandedSuite(firstRow, testCount);
    }

    _highlightExpandedSuite(firstRow, testCount) {
        const tbody = document.getElementById('sdListTableBody');
        if (!tbody) return;

        const rows = tbody.querySelectorAll('tr[data-row-idx]');
        const firstRowIdx = parseInt(firstRow.dataset.rowIdx);

        let count = 0;
        rows.forEach(row => {
            const rowIdx = parseInt(row.dataset.rowIdx);
            if (rowIdx >= firstRowIdx && count < testCount) {
                row.classList.add('sd-list-row-just-expanded');
                count++;
            }
        });

        // *** הסר highlight אחרי 1.5 שניות ***
        setTimeout(() => {
            tbody.querySelectorAll('.sd-list-row-just-expanded')
                .forEach(r =>
                    r.classList.remove('sd-list-row-just-expanded')
                );
        }, 1500);

        // *** גלול לשורה ***
        firstRow.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }

    // ==========================================
    // מפריד טבלת מערכות לילה
    // ==========================================
    buildDowntimeDivider() {
        const divider = document.createElement('div');
        divider.className = 'sd-downtime-divider';
        divider.dataset.collapsed =
            localStorage.getItem('sdDowntimeCollapsed') === '1'
                ? '1' : '0';

        const isCollapsed = divider.dataset.collapsed === '1';

        divider.innerHTML = `

        <!-- ===== כותרת מפריד — ניתנת ללחיצה ===== -->
        <div class="sd-downtime-divider-header"
             id="sdDowntimeDividerHeader"
             title="${isCollapsed
                ? 'לחץ להצגת טבלת מערכות לילה'
                : 'לחץ להסתרת טבלת מערכות לילה'}">

            <div class="sd-downtime-divider-line"></div>

            <div class="sd-downtime-divider-label">
                <i class="fas fa-moon"
                   style="color:#fbbf24;font-size:0.85rem"></i>
                <span>מערכות שיורדות 22:00 – 05:00</span>
                <span class="sd-downtime-divider-count">
                    ${this._getDowntimeTotalCount()} מערכות
                </span>
                ${this.canEdit ? `
                <button class="sd-dt-manage-btn" id="sdDtManageBtn"
                        title="ניהול מערכות לילה">
                    <i class="fas fa-cog"></i>
                </button>` : ''}
                <span class="sd-downtime-divider-toggle">
                    <i class="fas fa-chevron-${isCollapsed ? 'down' : 'up'}"></i>
                </span>
            </div>

            <div class="sd-downtime-divider-line"></div>
        </div>

        <!-- ===== גוף הטבלה — ניתן לקריסה ===== -->
        <div class="sd-downtime-divider-body
                    ${isCollapsed ? 'sd-downtime-body-hidden' : ''}"
             id="sdDowntimeDividerBody">
            ${this.buildDowntimeTableHtml()}
        </div>
    `;

        // *** Event listener על הכותרת ***
        const header = divider.querySelector('#sdDowntimeDividerHeader');
        header.addEventListener('click', () => {
            this._toggleDowntimeDivider(divider);
        });

        return divider;
    }

    // ==========================================
    // Toggle קריסת טבלת מערכות לילה
    // ==========================================
    _toggleDowntimeDivider(divider) {
        const body = divider.querySelector('#sdDowntimeDividerBody');
        const icon = divider.querySelector(
            '.sd-downtime-divider-toggle i');
        const header = divider.querySelector(
            '#sdDowntimeDividerHeader');

        const isCollapsed = divider.dataset.collapsed === '1';

        if (isCollapsed) {
            // *** פתח ***
            body.classList.remove('sd-downtime-body-hidden');
            body.style.overflow = 'hidden';
            body.style.maxHeight = '0';
            body.getBoundingClientRect(); // force reflow
            body.style.transition = 'max-height 0.4s ease';
            body.style.maxHeight = body.scrollHeight + 'px';

            body.addEventListener('transitionend', () => {
                body.style.transition = '';
                body.style.maxHeight = '';
                body.style.overflow = '';
            }, { once: true });

            if (icon) icon.className = 'fas fa-chevron-up';
            if (header) header.title =
                'לחץ להסתרת טבלת מערכות לילה';

            divider.dataset.collapsed = '0';
            localStorage.setItem('sdDowntimeCollapsed', '0');

        } else {
            // *** סגור ***
            body.style.overflow = 'hidden';
            body.style.maxHeight = body.scrollHeight + 'px';
            body.getBoundingClientRect(); // force reflow
            body.style.transition = 'max-height 0.4s ease';
            body.style.maxHeight = '0';

            body.addEventListener('transitionend', () => {
                body.classList.add('sd-downtime-body-hidden');
                body.style.transition = '';
                body.style.maxHeight = '';
                body.style.overflow = '';
            }, { once: true });

            if (icon) icon.className = 'fas fa-chevron-down';
            if (header) header.title =
                'לחץ להצגת טבלת מערכות לילה';

            divider.dataset.collapsed = '1';
            localStorage.setItem('sdDowntimeCollapsed', '1');
        }
    }

    // ==========================================
    // ספירת סה"כ מערכות לילה
    // ==========================================
    _getDowntimeTotalCount() {
        return this._getAllDowntimeSystems().length; // סה"כ שורות בכל 4 הטבלאות
    }

    _getDowntimeSystemNumbers() {
        if (this._downtimeNumbers) return this._downtimeNumbers;
        this._downtimeNumbers = new Set(
            this._getAllDowntimeSystems().map(s => s.num)
        );
        return this._downtimeNumbers;
    }

    _isDowntimeTest(testName) {
        if (!testName) return false;
        // המספר הקטלוגי הוא הפריט השני בפיצול לפי רווחים
        // לדוגמה: "TASHTIT - 10005 - Test description"
        const parts = testName.split(' - ');
        if (parts.length < 2) return false;

        const catalogNum = parseInt(parts[1], 10);
        if (isNaN(catalogNum)) return false;
        return this._getDowntimeSystemNumbers().has(catalogNum);
    }

    // ==========================================
    // רשימת מערכות לילה — מקור יחיד
    // *** כל המערכות ברשימה אחת — ממוינות לפי מספר ***
    // ==========================================
    _getAllDowntimeSystems() {
        return this._downtimeSystemsCache || [];
    }

    async _loadDowntimeSystems() {
        try {
            const res = await fetch('/SuiteResults/GetDowntimeSystems',
                { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                this._downtimeSystemsCache = data.systems || [];
                this._downtimeNumbers = new Set(
                    this._downtimeSystemsCache.map(s => s.num)
                );
            }
        } catch (err) {
            console.warn('Could not load downtime systems:', err);
            this._downtimeSystemsCache = [];
        }
    }

    // ==========================================
    // ניהול מערכות לילה
    // ==========================================

    openDowntimeMgmtPopup() {
        const overlay = document.getElementById('sdDowntimeMgmtOverlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        this._renderDowntimeMgmtTable();
    }

    closeDowntimeMgmtPopup() {
        const overlay = document.getElementById('sdDowntimeMgmtOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    _renderDowntimeMgmtTable() {
        const tbody = document.getElementById('sdDtTableBody');
        if (!tbody) return;

        const systems = this._getAllDowntimeSystems();

        if (!systems.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="sd-mp-empty">אין מערכות</td></tr>`;
            return;
        }

        tbody.innerHTML = systems.map(s => `
        <tr data-num="${s.num}" id="sdDtRow_${s.num}">
            <td style="font-weight:700;color:#fbbf24">${s.num}</td>
            <td style="font-family:monospace;font-size:0.78rem;color:#7ab3ef">
                ${this.escHtml(s.en)}
            </td>
            <td style="direction:rtl">${this.escHtml(s.he)}</td>
            <td class="sd-mp-actions">
                <button class="sd-mp-edit-btn sd-dt-edit-btn"
                        data-num="${s.num}"
                        data-en="${this.escHtml(s.en)}"
                        data-he="${this.escHtml(s.he)}"
                        title="ערוך">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="sd-mp-del-btn sd-dt-del-btn"
                        data-num="${s.num}"
                        title="מחק">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
    }

    _editDowntimeSystem(num, currentEn, currentHe) {
        const row = document.getElementById(`sdDtRow_${num}`);
        if (!row) return;

        // שמור HTML מקורי לביטול
        row._originalHtml = row.innerHTML;

        row.innerHTML = `
        <td>
            <input class="sd-mp-input sd-dt-edit-input"
                   id="sdDtEditNum_${num}"
                   type="number"
                   value="${num}"
                   style="max-width:90px"
                   dir="ltr"/>
        </td>
        <td>
            <input class="sd-mp-input sd-dt-edit-input"
                   id="sdDtEditEn_${num}"
                   type="text"
                   value="${this.escHtml(currentEn)}"
                   dir="ltr"/>
        </td>
        <td>
            <input class="sd-mp-input sd-dt-edit-input"
                   id="sdDtEditHe_${num}"
                   type="text"
                   value="${this.escHtml(currentHe)}"
                   dir="rtl"/>
        </td>
        <td class="sd-mp-actions">
            <button class="sd-contact-save-btn sd-dt-save-btn"
                    data-original-num="${num}"
                    title="שמור">
                <i class="fas fa-check"></i>
                <span>שמור</span>
            </button>
            <button class="sd-contact-cancel-btn sd-dt-cancel-btn"
                    data-num="${num}"
                    title="ביטול">
                <i class="fas fa-times"></i>
            </button>
        </td>
    `;

        document.getElementById(`sdDtEditNum_${num}`)?.focus();
    }

    async _saveDowntimeSystem(originalNum) {
        const newNum = parseInt(document.getElementById(`sdDtEditNum_${originalNum}`)?.value);
        const newEn = document.getElementById(`sdDtEditEn_${originalNum}`)?.value?.trim() || '';
        const newHe = document.getElementById(`sdDtEditHe_${originalNum}`)?.value?.trim() || '';

        if (!newNum || newNum <= 0) {
            this._showDtMsg('נא להזין מספר מערכת תקין', 'error'); return;
        }
        if (!newEn) { this._showDtMsg('נא להזין שם אנגלי', 'error'); return; }
        if (!newHe) { this._showDtMsg('נא להזין שם עברי', 'error'); return; }

        const saveBtn = document.querySelector(`.sd-dt-save-btn[data-original-num="${originalNum}"]`);
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            // אם המספר השתנה — מחק את הישן והוסף חדש
            if (newNum !== originalNum) {
                const delRes = await fetch('/SuiteResults/DeleteDowntimeSystem', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ num: originalNum })
                });
                const delData = await delRes.json();
                if (!delData.success) {
                    this._showDtMsg(delData.message || 'שגיאה במחיקה', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>שמור</span>';
                    }
                    return;
                }

                const addRes = await fetch('/SuiteResults/AddDowntimeSystem', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ num: newNum, en: newEn, he: newHe })
                });
                const addData = await addRes.json();
                if (!addData.success) {
                    this._showDtMsg(addData.message || 'שגיאה בהוספה', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>שמור</span>';
                    }
                    return;
                }

            } else {
                // רק עדכן שם
                const res = await fetch('/SuiteResults/UpdateDowntimeSystem', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ num: newNum, en: newEn, he: newHe })
                });
                const data = await res.json();
                if (!data.success) {
                    this._showDtMsg(data.message || 'שגיאה', 'error');
                    if (saveBtn) {
                        saveBtn.disabled = false;
                        saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>שמור</span>';
                    }
                    return;
                }
            }

            this._showDtMsg('המערכת עודכנה בהצלחה ✓', 'success');
            await this._loadDowntimeSystems();
            this._renderDowntimeMgmtTable();
            this.renderColumns();

        } catch (err) {
            this._showDtMsg('שגיאת תקשורת', 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-check"></i> <span>שמור</span>';
            }
        }
    }

    _cancelEditDowntimeSystem(num) {
        const row = document.getElementById(`sdDtRow_${num}`);
        if (!row || !row._originalHtml) return;
        row.innerHTML = row._originalHtml;
    }

    async _addDowntimeSystem() {
        const numInput = document.getElementById('sdDtNumInput');
        const enInput = document.getElementById('sdDtEnInput');
        const heInput = document.getElementById('sdDtHeInput');
        const addBtn = document.getElementById('sdDtAddBtn');

        const num = parseInt(numInput?.value);
        const en = enInput?.value?.trim() || '';
        const he = heInput?.value?.trim() || '';

        if (!num || num <= 0) {
            this._showDtMsg('נא להזין מספר מערכת תקין', 'error'); return;
        }
        if (!en) { this._showDtMsg('נא להזין שם באנגלית', 'error'); return; }
        if (!he) { this._showDtMsg('נא להזין שם בעברית', 'error'); return; }

        if (addBtn) { addBtn.disabled = true; addBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        try {
            const res = await fetch('/SuiteResults/AddDowntimeSystem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ num, en, he })
            });
            const data = await res.json();

            if (data.success) {
                this._showDtMsg('המערכת נוספה בהצלחה ✓', 'success');
                if (numInput) numInput.value = '';
                if (enInput) enInput.value = '';
                if (heInput) heInput.value = '';
                await this._loadDowntimeSystems();
                this._renderDowntimeMgmtTable();
                this.renderColumns();
            } else {
                this._showDtMsg(data.message || 'שגיאה', 'error');
            }
        } catch (err) {
            this._showDtMsg('שגיאת תקשורת', 'error');
        } finally {
            if (addBtn) { addBtn.disabled = false; addBtn.innerHTML = '<i class="fas fa-plus"></i> הוסף'; }
        }
    }

    async _deleteDowntimeSystem(num) {
        if (!confirm(`למחוק מערכת מספר ${num}?`)) return;

        try {
            const res = await fetch('/SuiteResults/DeleteDowntimeSystem', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ num })
            });
            const data = await res.json();

            if (data.success) {
                this._showDtMsg('המערכת נמחקה ✓', 'success');
                await this._loadDowntimeSystems();
                this._renderDowntimeMgmtTable();
                this.renderColumns();
            } else {
                this._showDtMsg(data.message || 'שגיאה', 'error');
            }
        } catch (err) {
            this._showDtMsg('שגיאת תקשורת', 'error');
        }
    }

    _showDtMsg(msg, type = 'info') {
        const el = document.getElementById('sdDtFormMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `sd-mp-form-msg ${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    // ==========================================
    // בניית תוכן טבלת מערכות לילה
    // ==========================================
    buildDowntimeTableHtml() {

        // *** כל המערכות ברשימה אחת — ממוינות לפי מספר ***
        const allSystems = this._getAllDowntimeSystems();

        // *** חלק לארבע עמודות שוות ***
        const total = allSystems.length;
        const colSize = Math.ceil(total / 4);
        const columns = [0, 1, 2, 3].map(i =>
            allSystems.slice(i * colSize, (i + 1) * colSize)
        );

        // *** בנה טבלה אחת לכל עמודה ***
        const buildTable = (rows) => `
        <table class="sd-dt-table">
            <thead>
                <tr>
                    <th>שם מערכת באנגלית</th>
                    <th>מס' מערכת</th>
                    <th>שם מערכת</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((r, i) => `
                    <tr class="${i % 2 === 0 ? 'sd-dt-even' : ''}">
                        <td class="sd-dt-en">
                            ${this.escHtml(r.en)}
                        </td>
                        <td class="sd-dt-num">${r.num}</td>
                        <td class="sd-dt-he">
                            ${this.escHtml(r.he)}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

        return `
        <div class="sd-dt-inner">
            ${columns.map(col => `
                <div class="sd-dt-col">
                    ${buildTable(col)}
                </div>
            `).join('')}
        </div>
    `;
    }

    _toggleAllPatchSuites(patchIndices, divider) {
        // *** בדוק אם כולן סגורות ***
        const allCollapsed = patchIndices.every(
            idx => this.collapsedSuites.has(idx)
        );

        if (!this._manuallyExpandedPatch)
            this._manuallyExpandedPatch = new Set();

        if (allCollapsed) {
            // *** פתח את כולן ***
            patchIndices.forEach(idx => {
                this.collapsedSuites.delete(idx);
                this._manuallyExpandedPatch.add(idx);
                this._applyCollapseState(idx);
            });
        } else {
            // *** סגור את כולן ***
            patchIndices.forEach(idx => {
                this.collapsedSuites.add(idx);
                this._manuallyExpandedPatch.delete(idx);
                this._applyCollapseState(idx);
            });
        }

        // *** עדכן אייקון המפריד ***
        const icon = divider?.querySelector('.sd-patch-divider-toggle-icon i');
        const label = divider?.querySelector('.sd-patch-divider-clickable');
        const nowAllCollapsed = patchIndices.every(
            idx => this.collapsedSuites.has(idx)
        );

        if (icon) {
            icon.className = `fas fa-chevron-${nowAllCollapsed ? 'down' : 'up'}`;
        }
        if (label) {
            label.title = nowAllCollapsed
                ? 'Click to expand all Post-Patch suites'
                : 'Click to collapse all Post-Patch suites';
        }
    }

    // ==========================================
    // כרטיסיית בדיקה (תצוגה מפורטת)
    // ==========================================

    // ==========================================
    // buildTestCard 
    // ==========================================

    buildTestCard(test) {
        const card = document.createElement('div');
        const statusLow = (test.status || '').toLowerCase();
        card.className = `sd-test-card ${statusLow}`;

        const durationStr = this.fmtDuration(test.durationSeconds);
        const lastRunStr = this.fmtLastRun(test.lastRunTime);

        const priorityBadge = test.priority
            ? `<span class="sd-priority ${(test.priority).toLowerCase()}">
            ${this.escHtml(test.priority)}</span>`
            : '';

        const contacts = (test.testId && this.contactsCache[test.testId])
            ? this.contactsCache[test.testId]
            : (test.contacts || []);

        const mailTo = contacts.map(c => c.email).join(';');
        const cc = 'noc@menora.co.il';
        const isPassed = statusLow === 'passed';

        const mailSubject = encodeURIComponent(
            `[Test ${isPassed ? 'Passed' : 'Failed'}] ` +
            `${test.containerName || test.testName || ''}`
        );
        const mailBody = encodeURIComponent(
            `שלום,\n\nהבדיקה הבאה ` +
            `${isPassed ? 'עברה בהצלחה' : 'נכשלה'}:\n` +
            `שם: ${test.containerName || test.testName || ''}\n` +
            `סטטוס: ${test.status || '-'}\n` +
            `זמן ריצה: ${this.fmtDuration(test.durationSeconds)}\n` +
            `זמן ריצה אחרון: ${this.fmtFullDate(test.lastRunTime)}\n` +
            `${isPassed ? '' : 'נא לבדוק.\n'}\nתודה`
        );

        const mailtoHref = mailTo
            ? `mailto:${mailTo}?cc=${encodeURIComponent(cc)}&subject=${mailSubject}&body=${mailBody}`
            : null;

        // *** אייקון מייל — מוצג רק אם הטסט נכשל ויש אנשי קשר ***
        const mailIconHtml = (!isPassed && mailtoHref)
            ? `<a class="sd-card-mail-icon"
              href="${mailtoHref}"
              target="_blank"
              title="Send failure email to ${contacts.length} contact(s)"
              onclick="event.stopPropagation()">
               <i class="fas fa-envelope"></i>
           </a>`
            : '';

        card.innerHTML = `
        <div class="sd-card-name"
            title="${this.escHtml(test.containerName || '')}">
            ${this.escHtml(
            test.containerName || test.testName || '-')}
        </div>
        <div class="sd-card-footer">
                ${priorityBadge}
            <span class="sd-card-duration">
            ${mailIconHtml}
                <i class="fas fa-clock"></i> ${durationStr}
            </span>
        <div class="sd-card-lastrun"
            title="Last run: ${this.escHtml(test.lastRunTime || '')}">
            <i class="fas fa-calendar-alt"></i> ${lastRunStr}
        </div>
        </div>
    `;
        card.style.cursor = 'pointer';
        card.classList.add('sd-test-card-clickable');
        card._testData = test;

        return card;
    }

    // ==========================================
    // buildCompactDot
    // ==========================================

    buildCompactDot(test) {
        const dot = document.createElement('div');
        const statusLow = (test.status || '').toLowerCase();
        dot.className = `sd-compact-dot ${statusLow}`;

        const name = test.containerName || test.testName || '-';
        const dur = this.fmtDuration(test.durationSeconds);
        const lastRunStr = this.fmtLastRun(test.lastRunTime);

        dot.title = `${name}\n⏱ ${dur}\n📅 ${lastRunStr}`;

        dot.classList.add('sd-test-card-clickable');
        dot.style.cursor = 'pointer';
        dot._testData = test;

        return dot;
    }

    // ==========================================
    // buildSuiteColumn
    // ==========================================

    buildSuiteColumn(suite, index) {
        const col = document.createElement('div');
        // *** בדוק אם הסוויטה כולה ישנה לפי זמן Run All ***
        const isSuiteStale = this._isSuiteStale(suite);

        col.className = `sd-column${isSuiteStale ? ' sd-column-stale' : ''}`;
        col.dataset.index = index;

        const stats = this.calcSuiteStats(suite.tests || []);
        const headerClass = stats.passRate === 100
            ? 'good'
            : stats.hasFailure
                ? 'bad'
                : 'warning';
        const shortName = this.shortenSuiteName(suite.suiteName);
        const isCollapsed = this.collapsedSuites.has(index);
        const lastRunStr = this.fmtLastRun(suite.lastRunTime);

        // *** בדוק אם הסוויטה לא רצה ב-12 שעות האחרונות ***
        const isOldRun = (() => {
            if (!suite.lastRunTime) return true;
            try {
                const diff = Date.now() - new Date(suite.lastRunTime).getTime();
                return diff > 12 * 60 * 60 * 1000;
            } catch {
                return false;
            }
        })();

        // *** בנה mailto לכותרת סוויטה ***
        const failedTests = (suite.tests || [])
            .filter(t => (t.status || '').toLowerCase() === 'failed');

        const allRecipients = [];
        const seenEmails = new Set();
        failedTests.forEach(t => {
            const contacts =
                (t.testId && this.contactsCache[t.testId])
                    ? this.contactsCache[t.testId]
                    : (t.contacts || []);
            contacts.forEach(c => {
                const email = (c.email || '').trim().toLowerCase();
                if (email && !seenEmails.has(email)) {
                    seenEmails.add(email);
                    allRecipients.push({ name: c.name || '', email });
                }
            });
        });

        const cc = 'noc@menora.co.il';
        const mailTo = allRecipients.map(r => r.email).join(';');

        const failedTestLines = failedTests
            .map((t, i) => `  ${i + 1}. ${t.containerName || t.testName || '-'}`)
            .join('\n');

        const mailSubject = encodeURIComponent(
            `[Suite Failed] ${suite.suiteName || ''} — ` +
            `${stats.failed}/${stats.total} tests failed`
        );
        const mailBody = encodeURIComponent(
            `שלום,\n\nהסוויטה הבאה נכשלה:\n` +
            `Suite: ${suite.suiteName || ''}\n` +
            `Pass Rate: ${stats.passRate}% ` +
            `(${stats.passed} passed, ${stats.failed} failed)\n` +
            `Last Run: ${this.fmtFullDate(suite.lastRunTime)}\n\n` +
            `בדיקות שנכשלו:\n${failedTestLines}\n\nתודה`
        );

        // *** אייקון מייל בכותרת — רק אם יש כשלונות ואנשי קשר ***
        const suiteMailIconHtml = (stats.passRate < 100 && mailTo && !this.compactView)
            ? `<a class="sd-col-mail-icon"
              href="mailto:${mailTo}?cc=${encodeURIComponent(cc)}&subject=${mailSubject}&body=${mailBody}"
              target="_blank"
              title="Send failure email (${allRecipients.length} recipients)"
              onclick="event.stopPropagation()">
               <i class="fas fa-envelope"></i>
           </a>`
            : '';

        col.innerHTML = `
        <div class="sd-col-header ${headerClass} 
            ${suite.isPatchSuite ? 'sd-col-header-patch' : ''}
            ${isCollapsed ? 'sd-collapsed' : ''}"
                data-col-index="${index}">
                <div class="sd-col-title-row">
                    <div class="sd-col-title"
                        title="${this.escHtml(suite.suiteName)}">
                        <span class="sd-col-index">
                            ${String(index).padStart(2, '0')}
                        </span>
                        ${this.escHtml(shortName)}
                        ${suite.isPatchSuite
                ? `<span class="sd-col-patch-badge">
                            <i class="fas fa-code-branch"></i>
                        </span>`
                : ''}
                    </div>
                    <button class="sd-suite-info-btn"
                            data-suite-index="${index}"
                            title="Suite Details">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <button class="sd-col-toggle-btn"
                            data-col-index="${index}"
                            title="${isCollapsed ? 'Expand' : 'Collapse'}">
                        <i class="fas fa-chevron-${isCollapsed ? 'down' : 'up'}"></i>
                    </button>
                </div>
                <div class="sd-col-meta">
                    <span class="sd-col-stat passed"
                        title="Passed">${stats.passed}</span>
                    <span class="sd-col-stat-sep">/</span>
                    <span class="sd-col-stat failed"
                        title="Failed">${stats.failed}</span>
                    <span class="sd-col-stat-sep">/</span>
                    <span class="sd-col-stat total"
                        title="Total">${stats.total}</span>

                    <span class="sd-col-lastrun ${isOldRun ? 'sd-col-lastrun-old' : ''}"
                        title="Last run: ${this.escHtml(suite.lastRunTime || '')}">
                        <i class="fas fa-history"></i> ${lastRunStr}
                        ${suiteMailIconHtml}
                    </span>
                </div>
            </div>
            <div class="sd-col-body ${isCollapsed ? 'sd-body-hidden' : ''}"
                id="colBody_${index}"></div>
            `;

        const body = col.querySelector(`#colBody_${index}`);
        const tests = suite._suiteNameMatch
            ? this.filterTestsByStatusOnly(
                suite.tests || [],
                suite.lastRunTime)
            : this.filterTests(
                suite.tests || [],
                suite.lastRunTime);

        if (tests.length === 0) {
            body.innerHTML = `<div class="sd-no-tests">No tests</div>`;
        } else {
            if (this.compactView) {
                const grid = document.createElement('div');
                grid.className = 'sd-compact-grid';
                tests.forEach(test => {
                    const enrichedTest = {
                        ...test,
                        suiteCbId: suite.cloudBeatId || '',
                        suiteName: suite.suiteName || ''
                    };
                    grid.appendChild(this.buildCompactDot(enrichedTest));
                });
                body.appendChild(grid);
            } else {
                // *** אם יותר מ-10 טסטים — 2 עמודות ***
                if (tests.length > 10) {
                    body.classList.add('sd-col-body-two-cols');
                }
                tests.forEach(test => {
                    const enrichedTest = {
                        ...test,
                        suiteCbId: suite.cloudBeatId || '',
                        suiteName: suite.suiteName || ''
                    };
                    body.appendChild(this.buildTestCard(enrichedTest));
                });
            }
        }

        return col;
    }

    fmtLastRun(isoStr) {
        if (!isoStr) return '-';

        try {
            const d = new Date(isoStr);
            const now = new Date();

            // הפרש בדקות
            const diffMs = now - d;
            const diffMin = Math.floor(diffMs / 60000);

            if (diffMin < 1) return 'just now';
            if (diffMin < 60) return `${diffMin}m ago`;

            const diffH = Math.floor(diffMin / 60);
            if (diffH < 24) return `${diffH}h ago`;

            const diffD = Math.floor(diffH / 24);
            if (diffD < 7) return `${diffD}d ago`;

            // יותר משבוע — הצג תאריך
            const dd = d.getDate().toString().padStart(2, '0');
            const mm = (d.getMonth() + 1).toString().padStart(2, '0');
            const hh = d.getHours().toString().padStart(2, '0');
            const mi = d.getMinutes().toString().padStart(2, '0');
            return `${dd}/${mm} ${hh}:${mi}`;

        } catch {
            return '-';
        }
    }

    fmtFullDate(isoStr) {
        if (!isoStr) return '-';
        try {
            const d = new Date(isoStr);
            const dd = d.getDate().toString().padStart(2, '0');
            const mm = (d.getMonth() + 1).toString().padStart(2, '0');
            const yyyy = d.getFullYear();
            const hh = d.getHours().toString().padStart(2, '0');
            const mi = d.getMinutes().toString().padStart(2, '0');
            const ss = d.getSeconds().toString().padStart(2, '0');
            return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
        } catch {
            return '-';
        }
    }

    // ==========================================
    // סינון
    // ==========================================

    getFilteredSuites() {
        return this.suites.map(suite => {
            const term = this.searchTerm.trim().toLowerCase();

            // *** בדוק אם שם הסוויטה תואם לחיפוש ***
            const suiteNameMatch = term
                ? (suite.suiteName || '').toLowerCase().includes(term) ||
                (suite.displayName || '').toLowerCase().includes(term) ||
                (suite.suiteTeam || '').toLowerCase().includes(term) ||
                (suite.suiteBrowser || '').toLowerCase().includes(term)
                : false;

            // *** אם שם הסוויטה תואם — הצג את כל הטסטים (רק סנן סטטוס) ***
            // *** אחרת — סנן גם לפי טקסט ***
            const filteredTests = suiteNameMatch
                ? this.filterTestsByStatusOnly(
                    suite.tests || [],
                    suite.lastRunTime)
                : this.filterTests(
                    suite.tests || [],
                    suite.lastRunTime);

            return {
                ...suite,
                tests: filteredTests,
                _suiteNameMatch: suiteNameMatch
            };
        }).filter(suite => {
            if (this.statusFilter !== 'all' || this.searchTerm)
                return suite._suiteNameMatch || suite.tests.length > 0;
            return true;
        });
    }

    // *** בדיקה אם טסט רלוונטי לפי זמן ריצה ***
    // אם הפער בין lastRunTime של הסוויטה לבין lastRunTime של הטסט
    // הוא יותר מ12 שעות — הטסט לא רלוונטי
    isTestRelevantByTime(test, suiteLastRunTime) {
        if (!suiteLastRunTime || !test.lastRunTime) return true;

        try {
            const suiteTime = new Date(suiteLastRunTime);
            const testTime = new Date(test.lastRunTime);

            const TWO_HOURS_MS = 12 * 60 * 60 * 1000;

            // הפרש מוחלט בין זמן הסוויטה לזמן הטסט
            const diffMs = Math.abs(suiteTime - testTime);
            return diffMs <= TWO_HOURS_MS;

        } catch {
            return true; // אם יש שגיאה — הצג את הטסט
        }
    }

    filterTests(tests, suiteLastRunTime = null) {
        return tests.filter(test => {

            // *** סנן טסטים ישנים ***
            if (!this.isTestRelevantByTime(test, suiteLastRunTime))
                return false;

            if (this.statusFilter !== 'all') {
                if ((test.status || '').toLowerCase() !==
                    this.statusFilter)
                    return false;
            }

            if (this.searchTerm.trim()) {
                const term = this.searchTerm.toLowerCase();
                return (
                    (test.containerName || '')
                        .toLowerCase().includes(term) ||
                    (test.testName || '')
                        .toLowerCase().includes(term) ||
                    (test.testId || '')
                        .toLowerCase().includes(term)
                );
            }

            return true;
        });
    }

    // *** סינון לפי סטטוס בלבד — ללא סינון טקסט ***
    // *** משמש כאשר שם הסוויטה עצמה תואם לחיפוש ***
    filterTestsByStatusOnly(tests, suiteLastRunTime = null) {
        // *** סנן טסטים ישנים ***
        const relevantTests = tests.filter(
            test => this.isTestRelevantByTime(test, suiteLastRunTime)
        );

        if (this.statusFilter === 'all') return relevantTests;

        return relevantTests.filter(test =>
            (test.status || '').toLowerCase() === this.statusFilter
        );
    }

    setStatusFilter(filter) {
        this.statusFilter = filter;
        document.querySelectorAll('.sd-filter-btn').forEach(btn => {
            btn.classList.toggle('active',
                btn.getAttribute('data-f') === filter);
        });
        // *** עדכן אינדיקטור ***
        this._updateSearchIndicator();
        this.renderColumns();
    }

    calcSuiteStats(tests) {
        const stats = { total: 0, passed: 0, failed: 0, warning: 0 };
        tests.forEach(t => {
            stats.total++;
            const s = (t.status || '').toLowerCase();
            if (s === 'passed') stats.passed++;
            else if (s === 'failed') stats.failed++;
            else if (s === 'warning') stats.warning++;
        });
        stats.passRate = stats.total > 0
            ? Math.round((stats.passed / stats.total) * 100)
            : 0;
        // *** אם יש warning אבל אין failed — סוויטה "warning" (לא failed) ***
        stats.hasWarning = stats.warning > 0;
        stats.hasFailure = stats.failed > 0;
        return stats;
    }

    // ==========================================
    // אירועים
    // ==========================================

    bindEvents() {
        // חיפוש
        document.addEventListener('input', e => {

            // חיפוש ראשי
            if (e.target.id === 'sdSearchInput') {
                this.searchTerm = e.target.value;
                const clearBtn = document.getElementById('sdClearSearch');
                if (clearBtn)
                    clearBtn.style.display = e.target.value ? 'flex' : 'none';

                // *** עדכן אינדיקטור חיפוש ***
                this._updateSearchIndicator();
                this.renderColumns();
            }

            // חיפוש בטבלת ניהול
            if (e.target.id === 'sdMpSearchInput') {
                const term = e.target.value;
                const clearBtn = document.getElementById('sdMpClearSearch');
                if (clearBtn)
                    clearBtn.style.display = term ? 'flex' : 'none';
                this.filterManageTable(term);
            }

        });

        document.addEventListener('click', e => {

            // Collapse All
            if (e.target.closest('#sdCollapseAllBtn'))
                this.toggleCollapseAll();

            // Toggle עמודה בודדת
            const toggleBtn = e.target.closest('.sd-col-toggle-btn');
            if (toggleBtn) {
                const idx = toggleBtn.dataset.colIndex;
                this.toggleCollapseColumn(idx);
            }

            // לחיצה על כותרת עמודה לקריסה/פתיחה
            const colHeader = e.target.closest('.sd-col-header[data-col-index]');
            if (colHeader && !e.target.closest('.sd-col-toggle-btn')) {
                const idx = colHeader.dataset.colIndex;
                this.toggleCollapseColumn(idx);
            }

            // ניקוי חיפוש
            if (e.target.closest('#sdClearSearch')) {
                this.searchTerm = '';
                const inp = document.getElementById('sdSearchInput');
                if (inp) inp.value = '';
                const clearBtn = document.getElementById('sdClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';

                // *** עדכן אינדיקטור ***
                this._updateSearchIndicator();
                this.renderColumns();
            }

            // גם בלחיצה על כפתור הבאנר sdSearchBannerClear:
            if (e.target.closest('#sdSearchBannerClear')) {
                this.searchTerm = '';
                this.statusFilter = 'all';
                const inp = document.getElementById('sdSearchInput');
                if (inp) inp.value = '';
                const clearBtn = document.getElementById('sdClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';
                document.querySelectorAll('.sd-filter-btn').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-f') === 'all');
                });
                this._updateSearchIndicator();
                this.renderColumns();
            }

            // כפתורי סינון
            const filterBtn = e.target.closest('.sd-filter-btn');
            if (filterBtn)
                this.setStatusFilter(
                    filterBtn.getAttribute('data-f'));

            // רענון
            if (e.target.closest('#sdRefreshBtn'))
                this.loadData();

            // *** תצוגה קומפקטית ***
            if (e.target.closest('#sdCompactBtn'))
                this.toggleCompactView();

            // פתיחת פאנל ניהול
            if (e.target.closest('#sdManageBtn'))
                this.openManagePopup();

            if (e.target.closest('#sdPopupClose'))
                this.closeManagePopup();

            if (e.target.id === 'sdPopupOverlay')
                this.closeManagePopup();

            // Run All Suites
            if (e.target.closest('#sdRunAllBtn'))
                this.openRunAllPopup();

            // סגירת פופאפ Run All
            if (e.target.id === 'sdRunAllOverlay')
                this.closeRunAllPopup();

            if (e.target.closest('#sdRunAllClose'))
                this.closeRunAllPopup();

            if (e.target.closest('#sdRunAllCancelBtn'))
                this.closeRunAllPopup();

            // אישור הרצת הכל
            const runAllConfirmBtn = e.target.closest('#sdRunAllConfirmBtn');
            if (runAllConfirmBtn && !runAllConfirmBtn.disabled) {
                const runnerType = runAllConfirmBtn.dataset.runnerType;
                this.runAllSuites(runnerType);
            }

            // *** צ'קבוקס Patch Suites ***
            const patchLabel = e.target.closest('#sdRunAllPatchLabel');
            if (patchLabel) {
                const chk = document.getElementById('sdRunPatchSuitesChk');
                if (chk && e.target !== chk) {
                    // *** לחיצה על ה-label — הפוך את הצ'קבוקס ***
                    chk.checked = !chk.checked;
                    e.preventDefault();
                }
                this._runPatchSuites = chk?.checked === true;
                this._updatePatchCheckboxStyle();
            }

            // בחירת כרטיס מריץ ב-Run All
            const runAllRunnerCard = e.target.closest('.sd-run-all-runner-card');
            if (runAllRunnerCard) {
                const radio = runAllRunnerCard.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    document.querySelectorAll('.sd-run-all-runner-card')
                        .forEach(c => c.classList.remove('selected'));
                    runAllRunnerCard.classList.add('selected');

                    // *** עדכן את הכפתור לפי הבחירה ***
                    this._updateRunAllConfirmBtn(radio.value);
                }
            }

            // *** Toggle Patch Suite ***
            const patchBtn = e.target.closest('.sd-mp-patch-btn');
            if (patchBtn) {
                const id = parseInt(patchBtn.dataset.id);
                const isPatch = patchBtn.dataset.isPatch === '1';
                this.togglePatchSuite(id, isPatch);
            }

            // *** לחיצה על label של Patch בטופס הוספה ***
            const mpPatchLabel = e.target.closest('#sdMpPatchLabel');
            if (mpPatchLabel) {
                const chk = document.getElementById('sdMpPatchChk');
                if (chk && e.target !== chk) {
                    chk.checked = !chk.checked;
                    e.preventDefault();
                }
                this._updateMpPatchStyle();
            }

            // Sync Names
            if (e.target.closest('#sdSyncNamesBtn'))
                this.openSyncNamesPopup();

            // סגירת פופאפ Sync
            if (e.target.id === 'sdSyncOverlay')
                this.closeSyncPopup();

            if (e.target.closest('#sdSyncClose'))
                this.closeSyncPopup();

            // אישור החלת שינויים
            if (e.target.closest('#sdSyncApplyBtn'))
                this.applySyncChanges();

            // כפתור הוספה
            if (e.target.closest('#sdMpAddBtn'))
                this.addSuiteConfig();

            // כפתור עריכה
            const editBtn = e.target.closest('.sd-mp-edit-btn');
            if (editBtn && editBtn.dataset.id) {
                const id = parseInt(editBtn.dataset.id);
                const name = editBtn.dataset.name || '';
                this.editSuiteConfig(id, name);
            }

            // *** עריכת איש קשר ***
            const contactEditBtn = e.target.closest('.sd-contact-edit-btn');
            if (contactEditBtn) {
                const contactId = parseInt(contactEditBtn.dataset.contactId);
                const testId = contactEditBtn.dataset.testId;
                const name = contactEditBtn.dataset.contactName;
                const email = contactEditBtn.dataset.contactEmail;
                const phone = contactEditBtn.dataset.contactPhone;
                this.editContact(contactId, testId, name, email, phone);
            }

            // *** Lookup טלפון — טופס הוספה ***
            if (e.target.closest('#sdContactLookupBtn'))
                this.lookupPhoneFromDirectory(null);

            // *** Lookup טלפון — טופס עריכה ***
            const editLookupBtn = e.target.closest(
                '[id^="sdContactLookupBtn_"]'
            );
            if (editLookupBtn) {
                const contactId = editLookupBtn.dataset.editContactId;
                this.lookupPhoneFromDirectory(contactId);
            }

            // *** שמירת עריכת איש קשר ***
            const contactSaveBtn = e.target.closest('.sd-contact-save-btn');
            if (contactSaveBtn) {
                const contactId = parseInt(contactSaveBtn.dataset.contactId);
                const testId = contactSaveBtn.dataset.testId;
                this.saveContact(contactId, testId);
            }

            // *** ביטול עריכת איש קשר ***
            const contactCancelBtn = e.target.closest('.sd-contact-cancel-btn');
            if (contactCancelBtn) {
                const contactId = parseInt(contactCancelBtn.dataset.contactId);
                this.cancelEditContact(contactId);
            }

            // כפתור מחיקה
            const delBtn = e.target.closest('.sd-mp-del-btn');
            if (delBtn) {
                const id = parseInt(delBtn.dataset.id);
                this.deleteSuiteConfig(id);
            }

            if (e.target.closest('#sdMpClearSearch')) {
                const inp = document.getElementById('sdMpSearchInput');
                if (inp) inp.value = '';
                const clearBtn = document.getElementById('sdMpClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';
                this.filterManageTable('');
            }

            const copyUidBtn = e.target.closest('#sdSapCopyUidBtn');
            if (copyUidBtn) {
                const uid = copyUidBtn.dataset.uid || '';
                navigator.clipboard.writeText(uid).then(() => {
                    copyUidBtn.innerHTML = '<i class="fas fa-check"></i> <span>Copied!</span>';
                    setTimeout(() => {
                        copyUidBtn.innerHTML = '<i class="fas fa-copy"></i> <span>Copy UID</span>';
                    }, 2000);
                }).catch(() => {
                    this.showError('Copy error');
                });
            }
            // פתיחת פופאפ פעולות טסט
            const testCard = e.target.closest('.sd-test-card-clickable');
            if (testCard && testCard._testData) {
                this.openTestActionPopup(testCard._testData);
                return;
            }

            // סגירת פופאפ פעולות טסט
            if (e.target.id === 'sdTestActionOverlay')
                this.closeTestActionPopup();

            if (e.target.closest('#sdTestActionClose'))
                this.closeTestActionPopup();


            // פתיחת פופאפ ניהול אנשי קשר
            if (e.target.closest('#sdManageContactsBtn')) {
                const btn = e.target.closest('#sdManageContactsBtn');
                const testId = btn?.dataset?.testId;
                if (testId) {
                    this.closeTestActionPopup();
                    this.openContactsPopup(testId);
                }
            }

            // סגירת פופאפ אנשי קשר
            if (e.target.id === 'sdContactsOverlay')
                this.closeContactsPopup();

            if (e.target.closest('#sdContactsClose'))
                this.closeContactsPopup();

            // הוספת איש קשר
            const contactAddBtn = e.target.closest('#sdContactAddBtn');
            if (contactAddBtn) {
                const testId = contactAddBtn.dataset.testId;
                if (testId) this.addContact(testId);
            }

            // מחיקת איש קשר
            const contactDelBtn = e.target.closest('.sd-contact-del-btn');
            if (contactDelBtn) {
                const contactId = parseInt(contactDelBtn.dataset.contactId);
                const testId = contactDelBtn.dataset.testId;
                this.deleteContact(contactId, testId);
            }

            // פתיחת פופאפ סוויטה
            const suiteInfoBtn = e.target.closest('.sd-suite-info-btn');
            if (suiteInfoBtn) {
                e.stopPropagation(); // מניעת קריסת עמודה
                const idx = parseInt(suiteInfoBtn.dataset.suiteIndex) - 1;
                const suite = this.getFilteredSuites()[idx];
                if (suite) this.openSuiteActionPopup(suite);
            }

            // סגירת פופאפ סוויטה
            if (e.target.id === 'sdSuiteActionOverlay')
                this.closeSuiteActionPopup();
            if (e.target.closest('#sdSuiteActionClose'))
                this.closeSuiteActionPopup();

            // *** כפתור CloudBeat ID בטבלת ניהול ***
            const cbIdBtn = e.target.closest('.sd-mp-cbid-btn');
            if (cbIdBtn) {
                const id = parseInt(cbIdBtn.dataset.id);
                const cbid = cbIdBtn.dataset.cbid || '';
                this.editCloudBeatId(id, cbid);
            }

            const sapRerunBtn = e.target.closest('#sdSapRerunBtn');
            if (sapRerunBtn && !sapRerunBtn.disabled) {
                const cbId = sapRerunBtn.dataset.suiteCbId;
                const sName = sapRerunBtn.dataset.suiteName;
                if (cbId) {
                    this.closeSuiteActionPopup();
                    this.openRunSuitePopup({ cloudBeatId: cbId, suiteName: sName }, true);
                }
            }
            // *** כפתור Run Suite בפופאפ סוויטה ***
            const sapRunBtn = e.target.closest('#sdSapRunBtn');
            if (sapRunBtn && !sapRunBtn.disabled) {
                const cbId = sapRunBtn.dataset.suiteCbId;
                const sName = sapRunBtn.dataset.suiteName;
                if (cbId) {
                    // *** סגור פופאפ סוויטה ופתח פופאפ הרצה ***
                    this.closeSuiteActionPopup();
                    this.openRunSuitePopup({
                        cloudBeatId: cbId,
                        suiteName: sName
                    });
                }
            }

            const tapRerunBtn = e.target.closest('#sdTapRerunBtn');
            if (tapRerunBtn && !tapRerunBtn.disabled) {
                const cbId = tapRerunBtn.dataset.suiteCbId;
                const sName = tapRerunBtn.dataset.suiteName;
                if (cbId) {
                    this.closeTestActionPopup();
                    this.openRunSuitePopup({ cloudBeatId: cbId, suiteName: sName }, true);
                }
            }
            // *** כפתור Run Test בפופאפ טסט ***
            const tapRunBtn = e.target.closest('#sdTapRunBtn');
            if (tapRunBtn && !tapRunBtn.disabled) {
                const cbId = tapRunBtn.dataset.suiteCbId;
                const sName = tapRunBtn.dataset.suiteName;
                if (cbId) {
                    this.closeTestActionPopup();
                    this.openRunSuitePopup({
                        cloudBeatId: cbId,
                        suiteName: sName
                    });
                }
            }

            // *** סגירת פופאפ הרצה ***
            if (e.target.id === 'sdRunSuiteOverlay')
                this.closeRunSuitePopup();

            if (e.target.closest('#sdRunSuiteClose'))
                this.closeRunSuitePopup();

            if (e.target.closest('#sdRunSuiteCancelBtn'))
                this.closeRunSuitePopup();

            // *** אישור הרצה ***
            const runConfirmBtn = e.target.closest('#sdRunSuiteConfirmBtn');
            if (runConfirmBtn && !runConfirmBtn.disabled) {
                const cbId = runConfirmBtn.dataset.suiteId;
                const sName = runConfirmBtn.dataset.suiteName;
                const failedOnly = this._currentRunFailedOnly === true;
                if (cbId) this.runSuite(cbId, sName, failedOnly);
            }

            // *** בחירת כרטיס מריץ ***
            const runnerCard = e.target.closest('.sd-run-runner-card');
            if (runnerCard) {
                const radio = runnerCard.querySelector('input[type="radio"]');
                if (radio) {
                    radio.checked = true;
                    // *** עדכן סגנון כל הכרטיסים ***
                    document.querySelectorAll('.sd-run-runner-card')
                        .forEach(c => c.classList.remove('selected'));
                    runnerCard.classList.add('selected');

                    // *** שמור בחירה ***
                    this._lastRunnerType = radio.value;
                    localStorage.setItem('sdLastRunnerType', radio.value);
                }
            }

            if (e.target.closest('#sdExportBtn'))
                this.openExportChoicePopup();

            if (e.target.id === 'sdExportChoiceOverlay')
                this.closeExportChoicePopup();

            if (e.target.closest('#sdExportChoiceClose'))
                this.closeExportChoicePopup();

            if (e.target.closest('#sdExportChoiceExcel')) {
                this.closeExportChoicePopup();
                this.exportToExcel();
            }

            if (e.target.closest('#sdExportChoiceEmail')) {
                this.closeExportChoicePopup();
                this.sendEmailReport();
            }

            if (e.target.closest('#sdViewModeBtn'))
                this.toggleViewMode();

            // פתיחת ניהול מערכות לילה
            if (e.target.closest('#sdDtManageBtn')) {
                e.stopPropagation();
                this.openDowntimeMgmtPopup();
                return;
            }

            // סגירת פופאפ
            if (e.target.id === 'sdDowntimeMgmtOverlay')
                this.closeDowntimeMgmtPopup();
            if (e.target.closest('#sdDowntimeMgmtClose'))
                this.closeDowntimeMgmtPopup();

            // הוספת מערכת
            if (e.target.closest('#sdDtAddBtn'))
                this._addDowntimeSystem();

            // עריכת מערכת
            const dtEditBtn = e.target.closest('.sd-dt-edit-btn');
            if (dtEditBtn) {
                const num = parseInt(dtEditBtn.dataset.num);
                const en = dtEditBtn.dataset.en;
                const he = dtEditBtn.dataset.he;
                this._editDowntimeSystem(num, en, he);
            }

            // מחיקת מערכת
            const dtDelBtn = e.target.closest('.sd-dt-del-btn');
            if (dtDelBtn) {
                const num = parseInt(dtDelBtn.dataset.num);
                this._deleteDowntimeSystem(num);
            }

            // שמירת עריכת מערכת לילה
            const dtSaveBtn = e.target.closest('.sd-dt-save-btn');
            if (dtSaveBtn) {
                const originalNum = parseInt(dtSaveBtn.dataset.originalNum);
                this._saveDowntimeSystem(originalNum);
            }

            // ביטול עריכת מערכת לילה
            const dtCancelBtn = e.target.closest('.sd-dt-cancel-btn');
            if (dtCancelBtn) {
                const num = parseInt(dtCancelBtn.dataset.num);
                this._cancelEditDowntimeSystem(num);
            }
        });

        // Enter בשדה UID
        document.addEventListener('keydown', e => {
            if (e.key === 'Enter' &&
                e.target.id === 'sdMpUidInput')
                this.addSuiteConfig();
        });
    }

    async exportToExcel() {
        if (typeof ExcelJS === 'undefined') {
            this.showError('Excel library not loaded. Please refresh the page.');
            return;
        }

        const filtered = this.getFilteredSuites();

        if (!filtered.length) {
            this.showError('No data to export');
            return;
        }

        const exportBtn = document.getElementById('sdExportBtn');
        if (exportBtn) {
            exportBtn.disabled = true;
            exportBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> <span>Exporting...</span>';
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

                altRowBg: 'F5F5F5',

                suiteFont: '1A3A5C',

                patchBg: 'EDE7F6',
                patchFont: '4A148C',

                nightBg: 'FFF9C4',
                nightFont: '7D6608',

                borderColor: 'BDBDBD',
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
                    name: 'Calibri',
                    size: fontSize,
                    bold,
                    color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign,
                    vertical: 'middle',
                    wrapText: false,
                };
                cell.border = thinBorder();
                if (bgColor) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            // ==========================================
            // בנה נתונים
            // ==========================================
            const rows = [];

            filtered.forEach(suite => {
                const stats = this.calcSuiteStats(suite.tests || []);

                if (suite.tests?.length) {
                    suite.tests.forEach(test => {
                        const statusLow =
                            (test.status || '').toLowerCase();
                        const isNight = this._isDowntimeTest(
                            test.containerName || test.testName || ''
                        );
                        rows.push({
                            suiteName: suite.suiteName || '',
                            suiteTeam: suite.suiteTeam || '',
                            testName:
                                test.containerName ||
                                test.testName || '',
                            status: test.status || '',
                            statusLow,
                            priority: test.priority || '',
                            duration: test.durationSeconds || 0,
                            lastRun: test.lastRunTime
                                ? this.fmtFullDate(test.lastRunTime)
                                : '',
                            isPatch: suite.isPatchSuite || false,
                            isNight,
                        });
                    });
                } else {
                    rows.push({
                        suiteName: suite.suiteName || '',
                        suiteTeam: suite.suiteTeam || '',
                        testName: '(no tests)',
                        status: '',
                        statusLow: '',
                        priority: '',
                        duration: 0,
                        lastRun: suite.lastRunTime
                            ? this.fmtFullDate(suite.lastRunTime)
                            : '',
                        isPatch: suite.isPatchSuite || false,
                        isNight: false,
                    });
                }
            });

            // ==========================================
            // גיליון — Tests Detail
            // ==========================================
            const ws = wb.addWorksheet('Tests Detail', {
                views: [{ state: 'frozen', ySplit: 1 }],
                properties: { defaultRowHeight: 18 },
            });

            // הגדר עמודות
            ws.columns = [
                { header: 'Suite Name', key: 'suiteName', width: 36 },
                { header: 'Suite Team', key: 'suiteTeam', width: 16 },
                { header: 'Test Name', key: 'testName', width: 48 },
                { header: 'Status', key: 'status', width: 12 },
                { header: 'Priority', key: 'priority', width: 12 },
                { header: 'Duration (sec)', key: 'duration', width: 16 },
                { header: 'Last Run', key: 'lastRun', width: 22 },
                { header: 'Is Patch Suite', key: 'isPatch', width: 15 },
                { header: 'Goes Down at Night', key: 'isNight', width: 18 },
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
            rows.forEach((row, rowIdx) => {
                const excelRow = ws.addRow([
                    row.suiteName,
                    row.suiteTeam,
                    row.testName,
                    row.status,
                    row.priority,
                    row.duration,
                    row.lastRun,
                    row.isPatch ? '✦ Post-Patch' : '',
                    row.isNight ? '🌙' : '',
                ]);

                excelRow.height = 17;

                // *** צבע רקע לפי סטטוס הטסט ***
                let rowBg = rowIdx % 2 === 1 ? C.altRowBg : null;
                let rowFont = '000000';

                if (row.statusLow === 'passed') {
                    rowBg = C.passedRowBg;
                    rowFont = C.passedRowFont;
                } else if (row.statusLow === 'failed') {
                    rowBg = C.failedRowBg;
                    rowFont = C.failedRowFont;
                }

                excelRow.eachCell((cell, colNumber) => {
                    let bg = rowBg;
                    let font = rowFont;
                    let bold = false;
                    let hAlign = 'left';

                    switch (colNumber) {

                        // Suite Name
                        case 1:
                            font = C.suiteFont;
                            bold = true;
                            break;

                        // Suite Team
                        case 2:
                            hAlign = 'center';
                            break;

                        // Test Name — שמור על צבע השורה
                        case 3:
                            bg = rowBg;
                            font = rowFont;
                            break;

                        // Status
                        case 4:
                            hAlign = 'center';
                            bold = true;
                            // שמור על צבע השורה — הסטטוס כבר מוצג ע"י הרקע
                            bg = rowBg;
                            font = rowFont;
                            break;

                        // Priority
                        case 5:
                            hAlign = 'center';
                            bold = true;
                            {
                                bg = rowBg;
                                font = rowFont;
                            }
                            break;

                        // Duration
                        case 6:
                            hAlign = 'center';
                            bg = rowBg;
                            font = rowFont;
                            break;

                        // Last Run
                        case 7:
                            hAlign = 'center';
                            bg = rowBg;
                            font = rowFont;
                            break;

                        // Is Patch Suite
                        case 8:
                            hAlign = 'center';
                            if (row.isPatch) {
                                bg = C.patchBg;
                                font = C.patchFont;
                                bold = true;
                            } else {
                                bg = rowBg;
                                font = rowFont;
                            }
                            break;

                        // Goes Down at Night
                        case 9:
                            hAlign = 'center';
                            if (row.isNight) {
                                bg = C.nightBg;
                                font = C.nightFont;
                                bold = true;
                            } else {
                                bg = rowBg;
                                font = rowFont;
                            }
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
                    .replace(/[^a-zA-Z0-9]/g, '_')}`
                : '';

            const filename =
                `SuiteResults${filterSuffix}${searchSuffix}_${dateStr}.xlsx`;

            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, filename);

            // *** הצג הודעת הצלחה ***
            const totalTests = filtered.reduce(
                (sum, s) => sum + (s.tests?.length || 0), 0
            );
            this.showError(
                `✓ Exported ${filtered.length} suites, ` +
                `${totalTests} tests → ${filename}`
            );

        } catch (err) {
            console.error('Export error:', err);
            this.showError(`Export failed: ${err.message}`);

        } finally {
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML =
                    '<i class="fas fa-file-excel"></i> <span>Export</span>';
            }
        }
    }

    // ==========================================
    // פופאפ בחירת Export
    // ==========================================

    openExportChoicePopup() {
        const overlay = document.getElementById('sdExportChoiceOverlay');
        if (!overlay) return;
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeExportChoicePopup() {
        const overlay = document.getElementById('sdExportChoiceOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    // ==========================================
    // שליחת דו"ח במייל (EML) — כמו לוח משמרות
    // ==========================================

    async sendEmailReport() {
        const btn = document.getElementById('sdEmailReportBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Preparing...</span>';
        }

        try {
            const filtered = this.getFilteredSuites();

            if (!filtered.length) {
                this.showError('No data to send');
                return;
            }

            // *** אסוף את כל הנמענים מאנשי קשר של טסטים כושלים ***
            const allRecipients = [];
            const seenEmails = new Set();

            filtered.forEach(suite => {
                (suite.tests || []).forEach(test => {
                    const statusLow = (test.status || '').toLowerCase();
                    if (statusLow !== 'failed') return;

                    const contacts =
                        (test.testId && this.contactsCache[test.testId])
                            ? this.contactsCache[test.testId]
                            : (test.contacts || []);

                    contacts.forEach(c => {
                        const email = (c.email || '').trim().toLowerCase();
                        if (email && !seenEmails.has(email)) {
                            seenEmails.add(email);
                            allRecipients.push({ name: c.name || '', email });
                        }
                    });
                });
            });

            const toEmails = allRecipients.map(r => r.email).join(';');
            const ccEmails = 'NOC@MENORAMIVT.CO.IL; PDL-AutomationProd@menoramivt.net';

            // *** בנה נושא ***
            const now = new Date();
            const dateStr = now.toLocaleDateString('he-IL');
            const timeStr = now.toLocaleTimeString('he-IL');

            const filterLabel = this.statusFilter !== 'all'
                ? ` — ${this.statusFilter === 'passed' ? 'Passed Only' : 'Failed Only'}`
                : '';
            const searchLabel = this.searchTerm.trim()
                ? ` — Filter: "${this.searchTerm.trim()}"`
                : '';

            const subject = `Suite Results Report${filterLabel}${searchLabel} — ${dateStr} ${timeStr}`;

            // *** בנה HTML ***
            const htmlBody = this._buildEmailReportHtml(filtered, dateStr, timeStr);

            // *** צור EML ***
            this._downloadReportEml(subject, htmlBody, toEmails, ccEmails);

            // *** הצג הנחיות ***
            setTimeout(() => this._showReportEmailInstructions(), 1500);

        } catch (err) {
            console.error('sendEmailReport error:', err);
            this.showError(`Error preparing email: ${err.message}`);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-envelope"></i> <span>Export</span>';
            }
        }
    }

    // ==========================================
    // בניית HTML לדו"ח המייל
    // ==========================================

    _buildEmailReportHtml(filtered, dateStr, timeStr) {

        // *** סטטיסטיקות כלליות ***
        let totalPassed = 0, totalFailed = 0, totalTests = 0;
        filtered.forEach(suite => {
            const stats = this.calcSuiteStats(suite.tests || []);
            totalPassed += stats.passed;
            totalFailed += stats.failed;
            totalTests += stats.total;
        });

        const overallRate = totalTests > 0
            ? Math.round((totalPassed / totalTests) * 100) : 0;

        const overallColor = overallRate === 100
            ? '#22c55e'
            : overallRate >= 70
                ? '#f59e0b'
                : '#ef4444';

        // *** פילטר פעיל ***
        const filterInfo = [];
        if (this.statusFilter !== 'all') {
            filterInfo.push(
                `Status Filter: <strong>${this.statusFilter === 'passed' ? '✓ Passed' : '✗ Failed'}</strong>`
            );
        }
        if (this.searchTerm.trim()) {
            filterInfo.push(
                `Search: <strong>"${this._escHtmlEmail(this.searchTerm.trim())}"</strong>`
            );
        }

        const filterBanner = filterInfo.length > 0
            ? `<div style="background:#fff8e1;border:1px solid #f59e0b;
                       border-radius:6px;padding:8px 14px;
                       margin-bottom:16px;font-size:13px;color:#92400e;">
               <strong>⚠ Active Filters:</strong> ${filterInfo.join(' | ')}
           </div>`
            : '';

        // *** בנה שורות טבלה ***
        let tableRows = '';

        filtered.forEach(suite => {
            const stats = this.calcSuiteStats(suite.tests || []);
            const tests = suite.tests || [];

            const suiteRateColor = stats.passRate === 100
                ? '#22c55e'
                : '#ef4444';

            const suiteBg = stats.passRate === 100
                ? '#f0fdf4'
                : '#fef2f2';

            if (tests.length === 0) {

                tableRows += `
                <tr>
                    <td style="padding:8px 12px;border:1px solid #e5e7eb;
                            background:${suiteBg};font-weight:700;
                            color:#1e3a5c;font-size:13px;
                            border-right:4px solid ${suiteRateColor}">
                        ${this._escHtmlEmail(suite.suiteName || '-')}
                    </td>
                    <td style="padding:8px 12px;border:1px solid #e5e7eb;
                            color:#6b7280;font-size:12px;
                            background:${suiteBg}">
                        ${this._escHtmlEmail(suite.suiteTeam || '-')}
                    </td>
                    <td colspan="5"
                        style="padding:8px 12px;border:1px solid #e5e7eb;
                            color:#9ca3af;font-style:italic;
                            font-size:12px;background:${suiteBg}">
                        No tests
                    </td>
                    <td style="padding:8px 12px;border:1px solid #e5e7eb;
                            text-align:center;background:${suiteBg}">
                        ${suite.isPatchSuite
                        ? `<span style="font-size:11px;font-weight:700;
                                        padding:2px 7px;border-radius:4px;
                                        background:#ede9fe;color:#6d28d9">
                            ⎇ Patch
                        </span>`
                        : '<span style="color:#d1d5db">—</span>'}
                    </td>
                    <td style="padding:8px 12px;border:1px solid #e5e7eb;
                            text-align:center;background:${suiteBg}">
                        <span style="color:#d1d5db">—</span>
                    </td>
                    <td style="padding:8px 12px;border:1px solid #e5e7eb;
                            text-align:center;background:${suiteBg}">
                        <span style="color:${suiteRateColor};
                                    font-weight:700;font-size:13px">
                            ${stats.passRate}%
                        </span>
                    </td>
                </tr>`;

                return;
            }

            tests.forEach((test, testIdx) => {
                const statusLow = (test.status || '').toLowerCase();
                const isPassed = statusLow === 'passed';
                const isFailed = statusLow === 'failed';

                const statusIcon = isPassed ? '✓' : isFailed ? '✗' : '?';
                const statusColor = isPassed ? '#16a34a' : isFailed ? '#dc2626' : '#6b7280';
                const statusBg = isPassed
                    ? '#f0fdf4'
                    : isFailed
                        ? '#fef2f2'
                        : '#f9fafb';

                const rowBg = testIdx % 2 === 0 ? statusBg : this._lightenColor(statusBg);

                const priorityHtml = test.priority
                    ? `<span style="font-size:10px;font-weight:700;
                               padding:1px 5px;border-radius:3px;
                               background:${test.priority.toLowerCase() === 'p1'
                        ? '#fee2e2' : test.priority.toLowerCase() === 'p2'
                            ? '#fef3c7' : '#ede9fe'};
                               color:${test.priority.toLowerCase() === 'p1'
                        ? '#991b1b' : test.priority.toLowerCase() === 'p2'
                            ? '#92400e' : '#5b21b6'}">
                       ${this._escHtmlEmail(test.priority)}
                   </span>`
                    : '<span style="color:#d1d5db">—</span>';

                const isNight = this._isDowntimeTest(
                    test.containerName || test.testName || ''
                );
                const nightIcon = isNight
                    ? ' <span title="Goes down 22:00-05:00" style="font-size:11px">🌙</span>'
                    : '';

                // *** תא סוויטה — רק בשורה הראשונה ***
                const suiteCellHtml = testIdx === 0
                    ? `<td rowspan="${tests.length}"
                       style="padding:8px 12px;border:1px solid #e5e7eb;
                              background:#f8fafc;font-weight:700;
                              color:#1e3a5c;font-size:13px;
                              vertical-align:top;
                              border-right:4px solid ${suiteRateColor};
                              min-width:160px">
                       ${this._escHtmlEmail(suite.suiteName || '-')}
                       ${suite.isPatchSuite
                        ? '<br><span style="font-size:10px;color:#7c3aed">⎇ Patch</span>'
                        : ''}
                   </td>
                   <td rowspan="${tests.length}"
                       style="padding:8px 12px;border:1px solid #e5e7eb;
                              background:#f8fafc;color:#6b7280;
                              font-size:12px;vertical-align:top;
                              text-align:center">
                       ${this._escHtmlEmail(suite.suiteTeam || '-')}
                   </td>`
                    : '';

                tableRows += `
                <tr>
                    ${suiteCellHtml}
                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                               background:${rowBg};font-size:12px;
                               color:#374151;max-width:280px">
                        <span style="color:${statusColor};
                                     font-weight:700;margin-left:5px">
                            ${statusIcon}
                        </span>
                        ${this._escHtmlEmail(
                    test.containerName || test.testName || '-'
                )}
                    </td>
                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                               background:${rowBg};text-align:center">
                        <span style="font-size:11px;font-weight:700;
                                     padding:2px 8px;border-radius:4px;
                                     background:${isPassed ? '#dcfce7' : isFailed ? '#fee2e2' : '#f3f4f6'};
                                     color:${statusColor}">
                            ${statusIcon} ${this._escHtmlEmail(test.status || '-')}
                        </span>
                    </td>
                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                               background:${rowBg};text-align:center">
                        ${priorityHtml}
                    </td>
                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                               background:${rowBg};text-align:center;
                               color:#6b7280;font-size:12px">
                        ⏱ ${this._escHtmlEmail(this.fmtDuration(test.durationSeconds))}
                    </td>
                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                               background:${rowBg};text-align:center;
                               color:#6b7280;font-size:11px;
                               white-space:nowrap">
                        ${this._escHtmlEmail(this.fmtFullDate(test.lastRunTime))}
                    </td>

                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                            background:${rowBg};text-align:center">
                        ${suite.isPatchSuite
                        ? `<span style="font-size:11px;font-weight:700;
                                            padding:2px 7px;border-radius:4px;
                                            background:#ede9fe;color:#6d28d9">
                                ⎇ Patch
                            </span>`
                        : '<span style="color:#d1d5db">—</span>'}
                    </td>
                    <td style="padding:7px 12px;border:1px solid #e5e7eb;
                            background:${rowBg};text-align:center">
                        ${isNight
                        ? `<span style="font-size:13px"
                                    title="System goes down 22:00–05:00">
                                🌙
                            </span>`
                        : '<span style="color:#d1d5db">—</span>'}
                    </td>
                    ${testIdx === 0
                        ? `<td rowspan="${tests.length}"
                            style="padding:8px 12px;border:1px solid #e5e7eb;
                                    background:#f8fafc;text-align:center;
                                    vertical-align:middle;min-width:90px">
                            <div style="font-size:16px;font-weight:700;
                                        color:${suiteRateColor}">
                                ${stats.passRate}%
                            </div>
                            <div style="font-size:10px;color:#9ca3af;
                                        margin-top:2px">
                                ${stats.passed}✓ ${stats.failed}✗
                            </div>
                        </td>`
                        : ''}

                </tr>`;
            });

            // *** שורת הפרדה בין סוויטות ***
            tableRows += `
            <tr>
                <td colspan="10"
                    style="height:4px;background:#e5e7eb;
                           border:none;padding:0"></td>
            </tr>`;
        });

        return `<!DOCTYPE html>
<html dir="ltr">
<head>
    <meta charset="UTF-8">
    <title>Suite Results Report</title>
</head>
<body style="font-family:Arial,sans-serif;font-size:14px;
             margin:0;padding:20px;background:#f9fafb;
             color:#111827;direction:ltr">

    ${filterBanner}

    <!-- ===== טבלה ===== -->
    <div style="background:white;border-radius:10px;overflow:hidden;
                border:1px solid #e5e7eb;
                box-shadow:0 2px 8px rgba(0,0,0,0.06)">
        <table style="width:100%;border-collapse:collapse;
                      font-size:13px">
            <thead>
                <tr style="background:linear-gradient(135deg,#1e3a5f,#1a2e4a)">
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;
                               font-size:12px;min-width:160px">
                        Suite
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;font-size:12px">
                        Team
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;
                               font-size:12px;min-width:200px">
                        Test Name
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;font-size:12px">
                        Status
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;font-size:12px">
                        Priority
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;font-size:12px">
                        Duration
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                               color:black;font-weight:700;
                               border:1px solid #2a4a7f;font-size:12px">
                        Last Run
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                            color:black;font-weight:700;
                            border:1px solid #2a4a7f;
                            font-size:12px;min-width:80px">
                        Is Patch Suite
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                            color:black;font-weight:700;
                            border:1px solid #2a4a7f;
                            font-size:12px;min-width:80px">
                        Goes Down at Night
                    </th>
                    <th style="padding:10px 12px;text-align:center;
                            color:black;font-weight:700;
                            border:1px solid #2a4a7f;font-size:12px">
                        Suite Rate
                    </th>       
                </tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    </div>

    <!-- ===== פוטר ===== -->
    <div style="margin-top:24px;text-align:center;
                font-size:11px;color:#9ca3af;
                border-top:1px solid #e5e7eb;padding-top:14px">
        <p style="margin:0">
            Generated by NOC Suite Results Dashboard
            — ${dateStr} ${timeStr}
        </p>
        <p style="margin:4px 0 0 0">
            This report was automatically generated.
        </p>
    </div>

</body>
</html>`;
    }

    // ==========================================
    // הורדת קובץ EML
    // ==========================================

    _downloadReportEml(subject, htmlBody, to, cc) {
        try {
            const emlContent =
                `X-Unsent: 1\r\n` +
                `To: ${to}\r\n` +
                `CC: ${cc}\r\n` +
                `Subject: ${subject}\r\n` +
                `MIME-Version: 1.0\r\n` +
                `Content-Type: text/html; charset=UTF-8\r\n` +
                `\r\n` +
                htmlBody;

            const blob = new Blob([emlContent], { type: 'message/rfc822' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `Suite_Report_${new Date()
                .toISOString()
                .slice(0, 10)}.eml`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();

            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 2000);

            this.showError('✓ Email report downloaded — open the .eml file to send');

        } catch (err) {
            console.error('_downloadReportEml error:', err);
            this.showError(`Error creating email file: ${err.message}`);
        }
    }

    // ==========================================
    // הנחיות פתיחת EML
    // ==========================================

    _showReportEmailInstructions() {
        if (document.getElementById('sdReportEmailModal')) {
            document.getElementById('sdReportEmailModal')
                .style.display = 'flex';
            return;
        }

        const modalHTML = `
    <div id="sdReportEmailModal"
         class="sd-popup-overlay"
         style="display:flex">
        <div style="background:#1a1a2e;border:1px solid #2a5a9f;
                    border-radius:10px;width:90%;max-width:460px;
                    overflow:hidden;
                    box-shadow:0 20px 60px rgba(0,0,0,0.7);
                    direction:ltr;animation:sdPopupIn 0.2s ease">

            <!-- Header -->
            <div style="display:flex;align-items:center;
                        justify-content:space-between;
                        padding:14px 18px;background:#16162a;
                        border-bottom:1px solid #2a2a4e">
                <span style="font-size:1rem;font-weight:600;
                             color:#7ab3ef;display:flex;
                             align-items:center;gap:8px">
                    <i class="fas fa-envelope"></i>
                    Send Email Report
                </span>
                <button onclick="document.getElementById(
                                    'sdReportEmailModal'
                                 ).style.display='none'"
                        style="background:none;border:none;
                               color:#666;cursor:pointer;
                               font-size:1.1rem;padding:4px 8px;
                               border-radius:4px;transition:all 0.2s">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- Body -->
            <div style="padding:20px;display:flex;
                        flex-direction:column;gap:14px">

                <!-- Step 1 -->
                <div style="display:flex;gap:12px;
                            align-items:flex-start">
                    <div style="width:28px;height:28px;
                                background:#4285f4;color:white;
                                border-radius:50%;display:flex;
                                align-items:center;
                                justify-content:center;
                                font-weight:700;flex-shrink:0">
                        1
                    </div>
                    <div>
                        <div style="font-weight:600;color:#ddd;
                                    margin-bottom:3px">
                            File Downloaded
                        </div>
                        <div style="font-size:13px;color:#888">
                            The file
                            <strong style="color:#ccc">
                                Suite_Report_*.eml
                            </strong>
                            was saved to your Downloads folder.
                        </div>
                    </div>
                </div>

                <!-- Step 2 -->
                <div style="display:flex;gap:12px;
                            align-items:flex-start;
                            background:#fff8e1;
                            border:1px solid #ffecb3;
                            border-radius:8px;padding:12px">
                    <div style="width:28px;height:28px;
                                background:#f59e0b;color:white;
                                border-radius:50%;display:flex;
                                align-items:center;
                                justify-content:center;
                                font-weight:700;flex-shrink:0">
                        2
                    </div>
                    <div>
                        <div style="font-weight:700;color:#92400e;
                                    margin-bottom:3px">
                            Open the File
                        </div>
                        <div style="font-size:13px;color:#78350f">
                            <strong>
                                Double-click the downloaded .eml file
                            </strong>
                            to open it in Outlook as a draft.
                        </div>
                    </div>
                </div>

                <!-- Step 3 -->
                <div style="display:flex;gap:12px;
                            align-items:flex-start">
                    <div style="width:28px;height:28px;
                                background:#4285f4;color:white;
                                border-radius:50%;display:flex;
                                align-items:center;
                                justify-content:center;
                                font-weight:700;flex-shrink:0">
                        3
                    </div>
                    <div>
                        <div style="font-weight:600;color:#ddd;
                                    margin-bottom:3px">
                            Review &amp; Send
                        </div>
                        <div style="font-size:13px;color:#888">
                            Check the recipients and content,
                            then click <strong style="color:#ccc">
                            Send</strong>.
                        </div>
                    </div>
                </div>

            </div>

            <!-- Footer -->
            <div style="padding:12px 18px;
                        border-top:1px solid #2a2a4e;
                        display:flex;justify-content:flex-end">
                <button onclick="document.getElementById(
                                    'sdReportEmailModal'
                                 ).style.display='none'"
                        style="background:#1e3a5f;
                               border:1px solid #2a5a9f;
                               border-radius:6px;color:#7ab3ef;
                               cursor:pointer;padding:7px 18px;
                               font-size:0.85rem;
                               display:flex;align-items:center;
                               gap:6px;transition:all 0.2s">
                    <i class="fas fa-check"></i> Got it
                </button>
            </div>

           </div>
    `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    // ==========================================
    // פונקציות עזר לבניית HTML המייל
    // ==========================================

    _escHtmlEmail(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _lightenColor(hexOrRgb) {
        // מחזיר גרסה בהירה יותר של הצבע לשורות זוגיות
        if (hexOrRgb === '#f0fdf4') return '#f7fef9';
        if (hexOrRgb === '#fef2f2') return '#fff5f5';
        if (hexOrRgb === '#fffbeb') return '#fffdf5';
        return '#fafafa';
    }

    _updateMpPatchStyle() {
        const chk = document.getElementById('sdMpPatchChk');
        const label = document.getElementById('sdMpPatchLabel');
        if (!label) return;
        label.classList.toggle('sd-mp-patch-checked', chk?.checked === true);
    }

    // ==========================================
    // פופאפ פעולות סוויטה
    // ==========================================

    openSuiteActionPopup(suite) {
        this.currentSuiteData = suite;
        const overlay = document.getElementById('sdSuiteActionOverlay');
        const content = document.getElementById('sdSuiteActionContent');
        if (!overlay || !content) return;

        content.innerHTML = this.buildSuiteActionHtml(suite);
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeSuiteActionPopup() {
        const overlay = document.getElementById('sdSuiteActionOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
        this.currentSuiteData = null;
    }

    buildSuiteActionHtml(suite) {
        const stats = this.calcSuiteStats(suite.tests || []);
        const statusLow = stats.passRate === 100 ? 'passed' : 'failed';
        const statusIcon = statusLow === 'passed'
            ? '<i class="fas fa-check-circle" style="color:#22c55e"></i>'
            : '<i class="fas fa-times-circle" style="color:#ef4444"></i>';

        const name = this.escHtml(suite.suiteName || '-');
        const lastRunFull = suite.lastRunTime
            ? this.escHtml(this.fmtFullDate(suite.lastRunTime))
            : '-';
        const lastRunRel = this.fmtLastRun(suite.lastRunTime);
        const duration = this.fmtDuration(
            (suite.duration || 0) / 1000);
        const passRate = stats.passRate;
        const passRateColor = passRate === 100
            ? '#22c55e'
            : passRate >= 70
                ? '#f59e0b'
                : '#ef4444';

        // ===== Progress bar =====
        const progressHtml = `
        <div class="sd-sap-progress-wrap">
            <div class="sd-sap-progress-bar"
                 style="width:${passRate}%;
                        background:${passRateColor}">
            </div>
        </div>
        <span style="color:${passRateColor};
                     font-weight:700;
                     font-size:0.85rem">
            ${passRate}%
        </span>`;

        // ===== רשימת טסטים כושלים =====
        const failedTests = (suite.tests || [])
            .filter(t => (t.status || '').toLowerCase() === 'failed');

        const failedHtml = failedTests.length === 0
            ? `<div class="sd-tap-no-contacts">
               <i class="fas fa-check-circle"
                  style="color:#22c55e"></i>
               All tests passed successfully
           </div>`
            : failedTests.slice(0, 8).map(t => `
            <div class="sd-sap-failed-test">
                <i class="fas fa-times-circle"
                   style="color:#ef4444;font-size:0.7rem;
                          flex-shrink:0"></i>
                <span class="sd-sap-failed-name"
                      title="${this.escHtml(
                t.containerName || t.testName || '')}">
                    ${this.escHtml(
                    t.containerName || t.testName || '-')}
                </span>
                <span class="sd-sap-failed-dur">
                    ${this.fmtDuration(t.durationSeconds)}
                </span>
            </div>`).join('') +
            (failedTests.length > 8
                ? `<div class="sd-tap-no-contacts"
                      style="justify-content:center;
                             font-size:0.75rem">
                     And ${failedTests.length - 8} more...
                 </div>`
                : '');

        // ===== מייל =====
        const cc = 'noc@menora.co.il';

        // *** אסוף את כל הנמענים מאנשי הקשר של הטסטים הכושלים ***
        // contactsCache מכיל { [testId]: [{ name, email }] }
        const allRecipients = [];
        const seenEmails = new Set();

        failedTests.forEach(t => {
            // נסה קודם מה-cache, אחר כך מהטסט עצמו
            const contacts =
                (t.testId && this.contactsCache[t.testId])
                    ? this.contactsCache[t.testId]
                    : (t.contacts || []);

            contacts.forEach(c => {
                const email = (c.email || '').trim().toLowerCase();
                if (email && !seenEmails.has(email)) {
                    seenEmails.add(email);
                    allRecipients.push({
                        name: c.name || '',
                        email: email
                    });
                }
            });
        });

        const mailTo = allRecipients.map(r => r.email).join(';');

        // *** בנה רשימת שמות טסטים כושלים לגוף המייל ***
        const failedTestLines = failedTests
            .map((t, i) => {
                const testName = t.containerName || t.testName || '-';
                const dur = this.fmtDuration(t.durationSeconds);
                const lastRun = this.fmtFullDate(t.lastRunTime);
                return `  ${i + 1}. ${testName}\n` +
                    `     Duration: ${dur}\n` +
                    `     Last Run: ${lastRun}`;
            })
            .join('\n\n');

        const mailSubject = encodeURIComponent(
            `[Suite Failed] ${suite.suiteName || ''} — ` +
            `${stats.failed}/${stats.total} tests failed`);

        const mailBody = encodeURIComponent(
            `שלום,\n\n` +
            `הסוויטה הבאה נכשלה:\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `Suite:      ${suite.suiteName || ''}\n` +
            `Team:       ${suite.suiteTeam || '-'}\n` +
            `Browser:    ${suite.suiteBrowser || '-'}\n` +
            `Last Run:   ${this.fmtFullDate(suite.lastRunTime)}\n` +
            `Pass Rate:  ${passRate}% ` +
            `(${stats.passed} passed, ${stats.failed} failed)\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `בדיקות שנכשלו (${failedTests.length}):\n\n` +
            `${failedTestLines}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `נא לבדוק ולטפל.\n\n` +
            `תודה`
        );

        const mailtoHref =
            `mailto:${mailTo}` +
            `?cc=${encodeURIComponent(cc)}` +
            `&subject=${mailSubject}` +
            `&body=${mailBody}`;

        // ===== UID =====
        const uid = this.escHtml(suite.suiteUid || suite.suiteKey || '-');

        // ===== HTML של הנמענים =====
        const recipientsHtml = allRecipients.length > 0
            ? `<div class="sd-sap-recipients-wrap">
               ${allRecipients.map(r => `
                   <div class="sd-sap-recipient"
                        title="${this.escHtml(r.email)}">
                       <i class="fas fa-user"
                          style="font-size:0.65rem;
                                 color:#666"></i>
                       <span class="sd-sap-recipient-name">
                           ${this.escHtml(r.name || r.email)}
                       </span>
                       <span class="sd-sap-recipient-email">
                           ${this.escHtml(r.email)}
                       </span>
                   </div>`).join('')}
           </div>`
            : `<div class="sd-tap-no-contacts"
                style="font-size:0.75rem">
               <i class="fas fa-exclamation-triangle"
                  style="color:#f59e0b"></i>
              No contacts defined for failed tests
           </div>`;

        return `
        <div class="sd-tap-header">
            <div class="sd-tap-title">
                ${statusIcon}
                <span class="sd-tap-name" title="${name}">
                    ${name}
                </span>
            </div>
            <button class="sd-popup-close"
                    id="sdSuiteActionClose">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="sd-tap-body">

            <!-- ===== סטטיסטיקות ===== -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-chart-bar"></i> Statistics
                </div>
                <div class="sd-sap-stats-row">
                    <div class="sd-sap-stat-card passed">
                        <div class="sd-sap-stat-num">
                            ${stats.passed}
                        </div>
                        <div class="sd-sap-stat-label">Passed</div>
                    </div>
                    <div class="sd-sap-stat-card failed">
                        <div class="sd-sap-stat-num">
                            ${stats.failed}
                        </div>
                        <div class="sd-sap-stat-label">Failed</div>
                    </div>
                    <div class="sd-sap-stat-card total">
                        <div class="sd-sap-stat-num">
                            ${stats.total}
                        </div>
                        <div class="sd-sap-stat-label">Total</div>
                    </div>
                </div>
                <div class="sd-sap-progress-row">
                    ${progressHtml}
                </div>
            </div>

            <!-- ===== פרטים ===== -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-info-circle"></i> Details
                </div>
                <div class="sd-tap-details-grid">

                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Status</span>
                        <span class="sd-tap-detail-value
                                     sd-tap-status ${statusLow}">
                            ${statusIcon}
                            ${statusLow === 'passed'
                ? 'Passed' : 'Failed'}
                        </span>
                    </div>

                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Team</span>
                        <span class="sd-tap-detail-value">
                            ${this.escHtml(suite.suiteTeam || '-')}
                        </span>
                    </div>

                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Browser</span>
                        <span class="sd-tap-detail-value">
                            <i class="fas fa-globe"
                               style="color:#666"></i>
                            ${this.escHtml(suite.suiteBrowser || '-')}
                        </span>
                    </div>

                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Duration</span>
                        <span class="sd-tap-detail-value">
                            <i class="fas fa-clock"></i> ${duration}
                        </span>
                    </div>

                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Last Run</span>
                        <span class="sd-tap-detail-value">
                            <i class="fas fa-calendar-alt"></i>
                            ${lastRunFull}
                            <span class="sd-tap-relative-time">
                                (${lastRunRel})
                            </span>
                        </span>
                    </div>

                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Suite UID</span>
                        <span class="sd-tap-detail-value sd-tap-mono"
                              title="${uid}">
                            ${uid.substring(0, 18)}...
                        </span>
                    </div>

                </div>
            </div>

            <!-- ===== פעולות ===== -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-bolt"></i> Actions
                </div>
                <div class="sd-tap-actions">
                    <button class="sd-tap-action-btn sd-tap-run-btn
                                ${suite.cloudBeatId ? '' : 'sd-tap-run-btn-disabled'}"
                            id="sdSapRunBtn"
                            data-suite-cb-id="${this.escHtml(suite.cloudBeatId || '')}"
                            data-suite-name="${this.escHtml(suite.suiteName || '')}"
                            ${suite.cloudBeatId ? '' : 'disabled'}
                            title="${suite.cloudBeatId
                ? 'Run suite in CloudBeat'
                : 'No CloudBeat ID configured — set it in the Manage panel'}">
                        <i class="fas fa-play"></i>
                        <span>Run Suite</span>
                        ${!suite.cloudBeatId
                ? `<span class="sd-tap-coming-soon">
                                <i class="fas fa-exclamation-triangle"
                                    style="font-size:0.6rem"></i> No ID
                            </span>`
                : ''}
                    </button>

                    <!-- כפתור Re-run Failed — פעיל רק אם הסוויטה נכשלה -->
                    <button class="sd-tap-action-btn sd-tap-rerun-btn
                                ${(suite.cloudBeatId && stats.passRate < 100) ? '' : 'sd-tap-run-btn-disabled'}"
                            id="sdSapRerunBtn"
                            data-suite-cb-id="${this.escHtml(suite.cloudBeatId || '')}"
                            data-suite-name="${this.escHtml(suite.suiteName || '')}"
                            ${(suite.cloudBeatId && stats.passRate < 100) ? '' : 'disabled'}
                            title="${!suite.cloudBeatId
                ? 'No CloudBeat ID configured'
                : stats.passRate === 100
                    ? 'Suite passed — no re-run needed'
                    : 'Re-run failed tests only'}">
                        <i class="fas fa-redo-alt"></i>
                        <span>Re-run Failed</span>
                    </button>

                    <a class="sd-tap-action-btn sd-tap-mail-btn
                              ${allRecipients.length === 0
                ? 'sd-tap-mail-btn-disabled' : ''}"
                       href="${mailtoHref}"
                       target="_blank"
                       title="${allRecipients.length === 0
                ? 'No contacts — cannot send'
                : `Send email to ${allRecipients.length} recipients`}">
                        <i class="fas fa-envelope"></i>
                        <span>Email Failures</span>
                        ${allRecipients.length > 0
                ? `<span class="sd-sap-email-count">
                                   ${allRecipients.length}
                               </span>`
                : ''}
                    </a>
                    <a class="sd-tap-action-btn sd-tap-cblink-btn
                            ${suite.cloudBeatId ? '' : 'sd-tap-run-btn-disabled'}"
                    href="${suite.cloudBeatId
                ? `https://cloudbeat-prod.menora.co.il/#/suites/138/${this.escHtml(suite.cloudBeatId)}/results`
                : 'javascript:void(0)'}"
                    ${suite.cloudBeatId ? 'target="_blank"' : ''}
                    title="${suite.cloudBeatId
                ? 'Open suite results in CloudBeat'
                : 'No CloudBeat ID configured'}">
                        <i class="fas fa-external-link-alt"></i>
                        <span>CloudBeat</span>
                        ${!suite.cloudBeatId
                ? `<span class="sd-tap-coming-soon">
                                <i class="fas fa-exclamation-triangle"
                                    style="font-size:0.6rem"></i> No ID
                            </span>`
                : ''}
                    </a>

                    <button class="sd-tap-action-btn sd-sap-copy-btn"
                            id="sdSapCopyUidBtn"
                            data-uid="${uid}"
                            title="Copy Suite UID">
                        <i class="fas fa-copy"></i>
                        <span>Copy UID</span>
                    </button>
                </div>
            </div>

            <!-- ===== נמענים ===== -->
            ${failedTests.length > 0 ? `
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-paper-plane"></i> Recipients
                    ${allRecipients.length > 0
                    ? `<span class="sd-sap-failed-badge"
                                 style="background:rgba(122,179,239,0.2);
                                        color:#7ab3ef">
                               ${allRecipients.length}
                           </span>`
                    : ''}
                </div>
                ${recipientsHtml}
            </div>` : ''}

            <!-- ===== בדיקות כושלות ===== -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-times-circle"
                       style="color:#ef4444"></i>
                    Failed Tests
                    ${failedTests.length > 0
                ? `<span class="sd-sap-failed-badge">
                               ${failedTests.length}
                           </span>`
                : ''}
                </div>
                <div class="sd-sap-failed-list">
                    ${failedHtml}
                </div>
            </div>

        </div>
    `;
    }

    // ==========================================
    // פופאפ פעולות טסט
    // ==========================================

    openTestActionPopup(testData) {
        this.currentTestData = testData;
        const overlay = document.getElementById('sdTestActionOverlay');
        const content = document.getElementById('sdTestActionContent');
        if (!overlay || !content) return;

        content.innerHTML = this.buildTestActionHtml(testData);
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    closeTestActionPopup() {
        const overlay = document.getElementById('sdTestActionOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
        this.currentTestData = null;
    }

    buildTestActionHtml(test) {
        const cc = 'noc@menora.co.il'; // כתובת ה-NOC
        const name = this.escHtml(test.containerName || test.testName || '-');
        const statusLow = (test.status || 'unknown').toLowerCase();
        const statusIcon = statusLow === 'passed'
            ? '<i class="fas fa-check-circle" style="color:#22c55e"></i>'
            : statusLow === 'failed'
                ? '<i class="fas fa-times-circle" style="color:#ef4444"></i>'
                : '<i class="fas fa-question-circle" style="color:#888"></i>';

        const duration = this.escHtml(this.fmtDuration(test.durationSeconds));
        const lastRun = this.escHtml(this.fmtLastRun(test.lastRunTime));
        const lastRunFull = test.lastRunTime
            ? this.escHtml(this.fmtFullDate(test.lastRunTime))
            : '-';
        const testId = this.escHtml(test.testId || '-');
        const priority = this.escHtml(test.priority || '-');

        const suiteCbId = test.suiteCbId || '';
        const suiteName = test.suiteName || '';

        const defaultContacts =
            this.contactsCache[test.testId] || test.contacts || [];

        const contactsHtml = defaultContacts.length > 0
            ? defaultContacts.map(c => `
            <div class="sd-tap-contact">
                <i class="fas fa-user"></i>
                <span>${this.escHtml(c.name)}</span>
                <a href="mailto:${this.escHtml(c.email)}"
                class="sd-tap-contact-email">
                    ${this.escHtml(c.email)}
                </a>
                ${c.phone ? `
                <a href="tel:${this.escHtml(c.phone)}"
                class="sd-contact-phone"
                title="Call ${this.escHtml(c.phone)}">
                    <i class="fas fa-phone"></i>
                    ${this.escHtml(c.phone)}
                </a>` : ''}
            </div>`).join('')
            : `<div class="sd-tap-no-contacts">
                <i class="fas fa-info-circle"></i>
                No contacts defined
            </div>`;

        // כותרת וטקסט ברירת מחדל למייל
        const mailSubject = encodeURIComponent(
            `[Test ${statusLow === 'passed' ? 'Passed' : 'Failed'}] ${test.containerName || test.testName || ''}`);
        const mailBody = encodeURIComponent(
            `שלום,\n\nהבדיקה הבאה ${statusLow === 'passed' ? 'עברה בהצלחה' : 'נכשלה'}:\n` +
            `שם: ${test.containerName || test.testName || ''}\n` +
            `סטטוס: ${test.status || '-'}\n` +
            `זמן ריצה: ${this.fmtDuration(test.durationSeconds)}\n` +
            `זמן ריצה אחרון: ${this.fmtFullDate(test.lastRunTime)}\n` +
            `${statusLow === 'passed' ? '' : 'נא לבדוק.\n'}\nתודה`);

        // כתובות מייל מאנשי קשר (אם קיימים)
        const mailTo = defaultContacts.map(c => c.email).join(';');
        const mailtoHref = `mailto:${mailTo}?cc=${cc}&subject=${mailSubject}&body=${mailBody}`;

        // *** בדיקה אם הטסט עבר - אם כן, נשבית את כפתור המייל ***
        const isPassed = statusLow === 'passed';
        const mailBtnDisabled = isPassed || defaultContacts.length === 0;
        const mailBtnClass = mailBtnDisabled ? 'sd-tap-mail-btn-disabled' : '';
        const mailBtnTitle = isPassed
            ? 'Test passed — no need to send email'
            : defaultContacts.length === 0
                ? 'No contacts — cannot send'
                : 'Send email';

        return `
        <div class="sd-tap-header">
            <div class="sd-tap-title">
                ${statusIcon}
                <span class="sd-tap-name" title="${name}">${name}</span>
            </div>
            <button class="sd-popup-close" id="sdTestActionClose">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <div class="sd-tap-body">

            <!-- פרטי טסט -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-info-circle"></i> Details
                </div>
                <div class="sd-tap-details-grid">
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Status</span>
                        <span class="sd-tap-detail-value sd-tap-status ${statusLow}">
                            ${statusIcon} ${this.escHtml(test.status || '-')}
                        </span>
                    </div>
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Priority</span>
                        <span class="sd-tap-detail-value">${priority}</span>
                    </div>
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Duration</span>
                        <span class="sd-tap-detail-value">
                            <i class="fas fa-clock"></i> ${duration}
                        </span>
                    </div>
                    <div class="sd-tap-detail-row">
                        <span class="sd-tap-detail-label">Last Run Date</span>
                        <span class="sd-tap-detail-value">
                            <i class="fas fa-calendar-alt"></i> ${lastRunFull}
                            <span class="sd-tap-relative-time">(${lastRun})</span>
                        </span>
                    </div>
                </div>
            </div>

            <!-- פעולות -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-bolt"></i> Actions
                </div>
                <div class="sd-tap-actions">

                    <button class="sd-tap-action-btn sd-tap-run-btn
                                ${suiteCbId ? '' : 'sd-tap-run-btn-disabled'}"
                            id="sdTapRunBtn"
                            data-suite-cb-id="${this.escHtml(suiteCbId)}"
                            data-suite-name="${this.escHtml(suiteName)}"
                            ${suiteCbId ? '' : 'disabled'}
                            title="${suiteCbId
                ? 'Run the test suite in CloudBeat'
                : 'No CloudBeat ID configured for this suite'}">
                        <i class="fas fa-play"></i>
                        <span>Run Suite</span>
                        ${!suiteCbId
                ? `<span class="sd-tap-coming-soon">
                                <i class="fas fa-exclamation-triangle"
                                    style="font-size:0.6rem"></i> No ID
                    </span>`
                : ''}
                </button>
                <!--  Re-run Failed — פעיל רק אם הטסט נכשל -->
                <button class="sd-tap-action-btn sd-tap-rerun-btn
                            ${(suiteCbId && statusLow === 'failed') ? '' : 'sd-tap-run-btn-disabled'}"
                        id="sdTapRerunBtn"
                        data-suite-cb-id="${this.escHtml(suiteCbId)}"
                        data-suite-name="${this.escHtml(suiteName)}"
                        ${(suiteCbId && statusLow === 'failed') ? '' : 'disabled'}
                        title="${!suiteCbId
                ? 'No CloudBeat ID configured for this suite'
                : statusLow !== 'failed'
                    ? 'Test passed — no re-run needed'
                    : 'Re-run only failed tests in the suite'}">
                    <i class="fas fa-redo-alt"></i>
                    <span>Re-run Failed</span>
                </button>
                <!-- שליחת מייל - מושבת אם הטסט עבר -->
                <a class="sd-tap-action-btn sd-tap-mail-btn ${mailBtnClass}"
                   href="${mailBtnDisabled ? 'javascript:void(0)' : mailtoHref}"
                   ${mailBtnDisabled ? '' : 'target="_blank"'}
                   title="${mailBtnTitle}"
                   ${mailBtnDisabled ? 'onclick="return false;"' : ''}>
                    <i class="fas fa-envelope"></i>
                    <span>Send Email</span>
                </a>

                <button class="sd-tap-action-btn sd-tap-contacts-btn"
                        id="sdManageContactsBtn"
                        data-test-id="${this.escHtml(test.testId || '')}">
                    <i class="fas fa-users"></i>
                    <span>Manage Contacts</span>
                </button>
                <a class="sd-tap-action-btn sd-tap-cblink-btn
                        ${suiteCbId ? '' : 'sd-tap-run-btn-disabled'}"
                href="${suiteCbId
                ? `https://cloudbeat-prod.menora.co.il/#/suites/138/${this.escHtml(suiteCbId)}/results`
                : 'javascript:void(0)'}"
                ${suiteCbId ? 'target="_blank"' : ''}
                title="${suiteCbId
                ? 'Open suite results in CloudBeat'
                : 'No CloudBeat ID configured for this suite'}">
                    <i class="fas fa-external-link-alt"></i>
                    <span>CloudBeat</span>
                    ${!suiteCbId
                ? `<span class="sd-tap-coming-soon">
                            <i class="fas fa-exclamation-triangle"
                                style="font-size:0.6rem"></i> No ID
                        </span>`
                : ''}
                </a>

            </div>
        </div>

            <!-- אנשי קשר -->
            <div class="sd-tap-section">
                <div class="sd-tap-section-title">
                    <i class="fas fa-users"></i> Contacts
                </div>
                <div class="sd-tap-contacts">
                    ${contactsHtml}
                </div>
            </div>

        </div>
    `;
    }

    // ==========================================
    // *** פופאפ ניהול אנשי קשר ***
    // ==========================================

    async openContactsPopup(testId) {
        const overlay = document.getElementById('sdContactsOverlay');
        const content = document.getElementById('sdContactsContent');
        if (!overlay || !content) return;

        content.innerHTML = this.buildContactsPopupHtml(testId);
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        await this.loadContacts(testId);
    }

    closeContactsPopup() {
        const overlay = document.getElementById('sdContactsOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';
    }

    buildContactsPopupHtml(testId) {
        return `
    <div class="sd-popup-header">
        <span class="sd-popup-title">
            <i class="fas fa-users"></i> Manage Contacts
        </span>
        <button class="sd-popup-close" id="sdContactsClose">
            <i class="fas fa-times"></i>
        </button>
    </div>
    <div class="sd-contacts-body">

        <!-- טופס הוספה -->
        <div class="sd-contacts-add-form">
            <div class="sd-contacts-form-row">
                <input id="sdContactNameInput"
                       class="sd-mp-input"
                       type="text"
                       placeholder="Contact name *"
                       dir="rtl"/>
                <input id="sdContactEmailInput"
                       class="sd-mp-input"
                       type="email"
                       placeholder="Email address *"
                       dir="ltr"/>

                <!-- *** עטיפת טלפון עם כפתור lookup *** -->
                <div class="sd-contact-phone-wrap">
                    <button class="sd-contact-lookup-btn"
                            id="sdContactLookupBtn"
                            title="Auto-fill phone from directory">
                        <i class="fas fa-search"></i>
                    </button>
                    <input id="sdContactPhoneInput"
                        class="sd-mp-input"
                        type="tel"
                        placeholder="Phone (auto-fill)"
                        dir="ltr"
                        style="max-width:160px"/>
                </div>

                <button class="sd-mp-add-btn"
                        id="sdContactAddBtn"
                        data-test-id="${this.escHtml(testId)}">
                    <i class="fas fa-plus"></i> Add
                </button>
            </div>
            <div id="sdContactFormMsg"
                 class="sd-mp-form-msg"></div>
        </div>

        <!-- רשימת אנשי קשר -->
        <div class="sd-contacts-list-wrap">
            <div id="sdContactsLoading"
                 class="sd-mp-loading"
                 style="display:none">
                <i class="fas fa-spinner fa-spin"></i> Loading...
            </div>
            <div id="sdContactsList"
                 class="sd-contacts-list">
                <div class="sd-tap-no-contacts">
                    <i class="fas fa-spinner fa-spin"></i>
                    Loading contacts...
                </div>
            </div>
        </div>

    </div>
`;
    }

    // ==========================================
    // *** Lookup טלפון מספר הטלפונים ***
    // ==========================================
    async lookupPhoneFromDirectory(editContactId = null) {

        let nameInput, emailInput, phoneInput, lookupBtn;

        if (editContactId) {
            // *** מצב עריכה ***
            nameInput = document.getElementById(`sdEditNameInput_${editContactId}`);
            emailInput = document.getElementById(`sdEditEmailInput_${editContactId}`);
            phoneInput = document.getElementById(`sdEditPhoneInput_${editContactId}`);
            lookupBtn = document.getElementById(`sdContactLookupBtn_${editContactId}`);
        } else {
            // *** מצב הוספה ***
            nameInput = document.getElementById('sdContactNameInput');
            emailInput = document.getElementById('sdContactEmailInput');
            phoneInput = document.getElementById('sdContactPhoneInput');
            lookupBtn = document.getElementById('sdContactLookupBtn');
        }

        const name = nameInput?.value?.trim() || '';
        const email = emailInput?.value?.trim() || '';

        if (!name && !email) {
            this.showContactMsg(
                'Please enter a name or email first', 'error');
            nameInput?.focus();
            return;
        }

        if (lookupBtn) {
            lookupBtn.disabled = true;
            lookupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const params = new URLSearchParams();
            if (name) params.append('name', name);
            if (email) params.append('email', email);

            const res = await fetch(
                `/SuiteResults/LookupPhoneByNameEmail?${params}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            if (data.success && data.phone) {
                if (phoneInput) phoneInput.value = data.phone;

                const matchedBy = data.matchedBy === 'email'
                    ? 'email' : 'name';

                this.showContactMsg(
                    `✓ Phone found by ${matchedBy}: ${data.phone}`,
                    'success'
                );

                if (phoneInput) {
                    phoneInput.classList.add('sd-input-highlight');
                    setTimeout(() => {
                        phoneInput.classList.remove('sd-input-highlight');
                    }, 2000);
                }

            } else {
                this.showContactMsg(
                    'No phone found in directory for this name/email',
                    'error'
                );
            }

        } catch (err) {
            this.showContactMsg(
                `Lookup error: ${err.message}`, 'error');
        } finally {
            if (lookupBtn) {
                lookupBtn.disabled = false;
                lookupBtn.innerHTML = '<i class="fas fa-search"></i>';
            }
        }
    }

    async loadContacts(testId) {
        const listEl = document.getElementById('sdContactsList');
        const loadingEl = document.getElementById('sdContactsLoading');
        if (!listEl) return;

        if (loadingEl) loadingEl.style.display = 'flex';

        try {
            const res = await fetch(
                `/SuiteResults/GetContacts?testId=${encodeURIComponent(testId)}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            if (loadingEl) loadingEl.style.display = 'none';

            if (data.success) {
                this.contactsCache[testId] = data.contacts || [];
            }

            this.renderContactsList(testId, data.contacts || []);

        } catch (err) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (listEl) listEl.innerHTML = `
            <div class="sd-tap-no-contacts sd-mp-err">
                <i class="fas fa-exclamation-circle"></i>
                Error loading contacts
            </div>`;
        }
    }

    renderContactsList(testId, contacts) {
        const listEl = document.getElementById('sdContactsList');
        if (!listEl) return;

        if (!contacts.length) {
            listEl.innerHTML = `
            <div class="sd-tap-no-contacts">
                <i class="fas fa-info-circle"></i>
                No contacts defined
            </div>`;
            return;
        }

        listEl.innerHTML = contacts.map(c => `
        <div class="sd-contact-row" data-contact-id="${c.id}">
            <div class="sd-contact-info">
                <i class="fas fa-user sd-contact-icon"></i>
                <span class="sd-contact-name">
                    ${this.escHtml(c.name)}
                </span>
                <a href="mailto:${this.escHtml(c.email)}"
                class="sd-tap-contact-email">
                    ${this.escHtml(c.email)}
                </a>
                ${c.phone ? `
                <a href="tel:${this.escHtml(c.phone)}"
                class="sd-contact-phone"
                title="Call ${this.escHtml(c.phone)}">
                    <i class="fas fa-phone"></i>
                    ${this.escHtml(c.phone)}
                </a>` : ''}
            </div>
            <div class="sd-contact-actions">
                <button class="sd-contact-edit-btn"
                        data-contact-id="${c.id}"
                        data-contact-name="${this.escHtml(c.name)}"
                        data-contact-email="${this.escHtml(c.email)}"
                        data-contact-phone="${this.escHtml(c.phone || '')}"
                        data-test-id="${this.escHtml(testId)}"
                        title="Edit contact">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="sd-contact-del-btn"
                        data-contact-id="${c.id}"
                        data-test-id="${this.escHtml(testId)}"
                        title="Delete contact">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
    }

    editContact(contactId, testId, currentName, currentEmail, currentPhone) {
        const listEl = document.getElementById('sdContactsList');
        if (!listEl) return;

        const row = listEl.querySelector(
            `.sd-contact-row[data-contact-id="${contactId}"]`
        );
        if (!row) return;

        const originalHtml = row.outerHTML;

        row.innerHTML = `
    <div class="sd-contact-edit-form">
        <input class="sd-mp-input sd-contact-edit-input"
               id="sdEditNameInput_${contactId}"
               type="text"
               value="${this.escHtml(currentName)}"
               placeholder="Contact name *"
               dir="rtl"/>
        <input class="sd-mp-input sd-contact-edit-input"
               id="sdEditEmailInput_${contactId}"
               type="email"
               value="${this.escHtml(currentEmail)}"
               placeholder="Email address *"
               dir="ltr"/>

        <div class="sd-contact-phone-wrap">
            <!-- *** ID שונה + data-contact-id כדי לזהות הקשר עריכה *** -->
            <button class="sd-contact-lookup-btn"
                    id="sdContactLookupBtn_${contactId}"
                    data-edit-contact-id="${contactId}"
                    title="Auto-fill phone from directory">
                <i class="fas fa-search"></i>
            </button>
            <input class="sd-mp-input sd-contact-edit-input"
                   id="sdEditPhoneInput_${contactId}"
                   type="tel"
                   value="${this.escHtml(currentPhone || '')}"
                   placeholder="Phone (auto-fill)"
                   dir="ltr"
                   style="max-width:140px"/>
        </div>

        <div class="sd-contact-edit-actions">
            <button class="sd-contact-save-btn"
                    data-contact-id="${contactId}"
                    data-test-id="${this.escHtml(testId)}"
                    title="Save changes">
                <i class="fas fa-check"></i>
                <span>Save</span>
            </button>
            <button class="sd-contact-cancel-btn"
                    data-contact-id="${contactId}"
                    title="Cancel">
                <i class="fas fa-times"></i>
            </button>
        </div>
    </div>`;

        row._originalHtml = originalHtml;
        document.getElementById(`sdEditNameInput_${contactId}`)?.focus();
    }

    cancelEditContact(contactId) {
        const listEl = document.getElementById('sdContactsList');
        if (!listEl) return;

        const row = listEl.querySelector(
            `.sd-contact-row[data-contact-id="${contactId}"]`
        );
        if (!row || !row._originalHtml) return;

        // *** שחזר HTML מקורי ***
        row.outerHTML = row._originalHtml;
    }

    async addContact(testId) {
        const nameInput = document.getElementById('sdContactNameInput');
        const emailInput = document.getElementById('sdContactEmailInput');
        const phoneInput = document.getElementById('sdContactPhoneInput');
        const addBtn = document.getElementById('sdContactAddBtn');

        const name = nameInput?.value?.trim() || '';
        const email = emailInput?.value?.trim() || '';
        let phone = phoneInput?.value?.trim() || '';

        // *** ולידציה ***
        if (!name) {
            this.showContactMsg(
                'Please enter a contact name', 'error');
            nameInput?.focus();
            return;
        }
        if (!email || !this.isValidEmail(email)) {
            this.showContactMsg(
                'Please enter a valid email address', 'error');
            emailInput?.focus();
            return;
        }

        // *** אם אין טלפון — נסה auto-lookup ***
        if (!phone) {
            try {
                const params = new URLSearchParams();
                if (name) params.append('name', name);
                if (email) params.append('email', email);

                const res = await fetch(
                    `/SuiteResults/LookupPhoneByNameEmail?${params}`,
                    { credentials: 'include' }
                );
                const data = await res.json();

                if (data.success && data.phone) {
                    phone = data.phone;
                    // *** עדכן את השדה בממשק ***
                    if (phoneInput) phoneInput.value = phone;
                }
            } catch (err) {
                // *** אם ה-lookup נכשל — המשך בלי טלפון ***
                console.warn('Phone lookup failed:', err.message);
            }
        }

        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const res = await fetch('/SuiteResults/AddContact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ testId, name, email, phone })
            });

            const data = await res.json();

            if (data.success) {
                this.showContactMsg(
                    'Contact added successfully ✓', 'success');
                if (nameInput) nameInput.value = '';
                if (emailInput) emailInput.value = '';
                if (phoneInput) phoneInput.value = '';

                // *** נקה מטמון ורענן ***
                delete this.contactsCache[testId];
                await this.loadContacts(testId);
            } else {
                this.showContactMsg(
                    data.message || 'Error', 'error');
            }

        } catch (err) {
            this.showContactMsg(
                'Communication error', 'error');
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML =
                    '<i class="fas fa-plus"></i> Add';
            }
        }
    }

    async saveContact(contactId, testId) {
        const nameInput = document.getElementById(`sdEditNameInput_${contactId}`);
        const emailInput = document.getElementById(`sdEditEmailInput_${contactId}`);
        const phoneInput = document.getElementById(`sdEditPhoneInput_${contactId}`);

        const name = nameInput?.value?.trim() || '';
        const email = emailInput?.value?.trim() || '';
        const phone = phoneInput?.value?.trim() || '';

        // *** ולידציה ***
        if (!name) {
            this.showContactMsg('Please enter a contact name', 'error');
            nameInput?.focus();
            return;
        }
        if (!email || !this.isValidEmail(email)) {
            this.showContactMsg('Please enter a valid email address', 'error');
            emailInput?.focus();
            return;
        }

        const saveBtn = document.querySelector(
            `.sd-contact-save-btn[data-contact-id="${contactId}"]`
        );
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        try {
            const res = await fetch('/SuiteResults/UpdateContact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id: parseInt(contactId),
                    name,
                    email,
                    phone
                })
            });

            const data = await res.json();

            if (data.success) {
                this.showContactMsg('Contact updated successfully ✓', 'success');

                // *** נקה מטמון ורענן ***
                delete this.contactsCache[testId];
                await this.loadContacts(testId);
            } else {
                this.showContactMsg(data.message || 'Error', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        '<i class="fas fa-check"></i> <span>Save</span>';
                }
            }

        } catch (err) {
            this.showContactMsg('Communication error', 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-check"></i> <span>Save</span>';
            }
        }
    }

    async deleteContact(contactId, testId) {
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
                this.showContactMsg('Deleted successfully ✓', 'success');

                // *** נקה מטמון ורענן ***
                delete this.contactsCache[testId];
                await this.loadContacts(testId);
            } else {
                this.showContactMsg(data.message || 'Error', 'error');
            }

        } catch (err) {
            this.showContactMsg('Communication error', 'error');
        }
    }

    showContactMsg(msg, type = 'info') {
        const el = document.getElementById('sdContactFormMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `sd-mp-form-msg ${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
    }

    // *** ולידציית מייל ***
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // ==========================================
    // UI helpers
    // ==========================================

    showLoading(show) {
        const el = document.getElementById('sdLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    showError(msg) {
        const el = document.getElementById('sdError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => {
                el.style.display = 'none';
            }, 6000);
        }
    }

    updateLastRefresh() {
        const el = document.getElementById('sdLastRefresh');
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

    shortenSuiteName(name) {
        if (!name) return 'Suite';
        const parts = name.split(' - ');
        return parts.length > 1
            ? parts.slice(1).join(' - ')
            : name;
    }

    escHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ==========================================
    // Run All Suites — פתיחת פופאפ
    // ==========================================
    async openRunAllPopup() {
        const overlay = document.getElementById('sdRunAllOverlay');
        const content = document.getElementById('sdRunAllContent');
        if (!overlay || !content) return;

        // *** הצג skeleton תחילה ***
        content.innerHTML = `
    <div class="sd-tap-header">
        <div class="sd-tap-title">
            <i class="fas fa-play-circle" style="color:#4ade80"></i>
            <span class="sd-tap-name">Run All Suites</span>
        </div>
        <button class="sd-popup-close" id="sdRunAllClose">
            <i class="fas fa-times"></i>
        </button>
    </div>
    <div style="padding:30px;text-align:center;color:#666">
        <i class="fas fa-spinner fa-spin"></i> Loading...
    </div>`;

        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        try {
            const [lockRes, lastRunRes] = await Promise.all([
                fetch('/SuiteResults/GetRunAllLockStatus',
                    { credentials: 'include' }),
                fetch('/SuiteResults/GetRunAllLastResult',
                    { credentials: 'include' })
            ]);

            const lockData = await lockRes.json();
            const lastRunData = await lastRunRes.json();

            // *** שמור מצב נעילה — כבר מחושב לפי הרשאות בשרת ***
            this._serverLockStatus = lockData;

            if (lastRunData.success && lastRunData.hasResult) {
                this._runAllLastRunTime = lastRunData.lastRunTime;
            }

        } catch (err) {
            console.warn('Could not fetch lock/last run status:', err);
            // *** fallback: אם privileged — אל תחסום ***
            this._serverLockStatus = {
                canRun: true,
                isLocked: false,
                isPrivileged: this.canEdit
            };
        }

        content.innerHTML = this.buildRunAllHtml();
    }

    closeRunAllPopup() {
        const overlay = document.getElementById('sdRunAllOverlay');
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = '';

        // *** עצור polling אם הפופאפ נסגר ידנית ***
        this._stopPollingForRunAllResult();
        this._runAllStartTime = null;
        this._runAllRunnerType = null;
    }

    // ==========================================
    // Run All Suites — בניית HTML
    // ==========================================
    buildRunAllHtml() {
        const serverLock = this._serverLockStatus || {};
        const isPrivileged = serverLock.isPrivileged === true;

        // *** חסום רק NOC ***
        const isOnCooldown = serverLock.isLocked === true;

        // *** יש נעילה פעילה — מוצג לכולם ***
        const hasActiveLock = serverLock.hasActiveLock === true
            || serverLock.isLocked === true;

        const timeLeftStr = isOnCooldown
            ? (serverLock.timeLeftStr || '5m')
            : '';

        const triggeredBy = serverLock.triggeredBy || '';
        const triggeredAt = serverLock.triggeredAt || '';

        const latestRunStr = this._runAllLastRunTime
            ? this.fmtFullDate(this._runAllLastRunTime) : '-';
        const latestRunRel = this._runAllLastRunTime
            ? this.fmtLastRun(this._runAllLastRunTime) : '-';

        // *** Banner לNOC — חסום ***
        const cooldownHtml = isOnCooldown ? `
    <div class="sd-run-all-cooldown-banner">
        <i class="fas fa-clock"></i>
        <div>
            <div class="sd-run-all-cooldown-title">
                Tests were recently triggered
            </div>
            <div class="sd-run-all-cooldown-sub">
                You can run again in
                <strong>${timeLeftStr}</strong>
            </div>
        </div>
    </div>` : '';

        // *** Banner מידע — מוצג לכולם אם יש נעילה פעילה ***
        const triggeredInfoHtml = (hasActiveLock && (triggeredBy || triggeredAt)) ? `
    <div class="sd-run-all-triggered-info">
        <i class="fas fa-user-clock"></i>
        <span>
            ${triggeredBy && triggeredAt
                ? `<strong>${this.escHtml(triggeredBy)}</strong>
                   ran all suites at
                   <strong>${this.escHtml(triggeredAt)}</strong>`
                : triggeredBy
                    ? `Triggered by: <strong>${this.escHtml(triggeredBy)}</strong>`
                    : `Triggered at: <strong>${this.escHtml(triggeredAt)}</strong>`
            }
        </span>
    </div>` : '';

        // *** Banner לפריווילג'ד — יכול לעקוף ***
        const privilegedInfoHtml = (isPrivileged && hasActiveLock) ? `
    <div class="sd-run-all-privileged-banner">
        <i class="fas fa-shield-alt" style="color:#a78bfa"></i>
        <div>
            <div style="font-weight:600;color:#c4b5fd;font-size:0.82rem">
                Privileged Access
            </div>
            <div style="font-size:0.75rem;color:#9ca3af">
                You can override the cooldown and run again
            </div>
        </div>
    </div>` : '';

        // *** tooltip לכפתור Confirm ***
        let confirmBtnTitle = isOnCooldown
            ? `Please wait ${timeLeftStr} before running again`
            : 'Run all suites';

        if (hasActiveLock && triggeredBy && triggeredAt) {
            confirmBtnTitle += `\n${triggeredBy} ran all suites at ${triggeredAt}`;
        }

        return `
    <div class="sd-tap-header">
        <div class="sd-tap-title">
            <i class="fas fa-play-circle"
               style="color:#4ade80"></i>
            <span class="sd-tap-name">Run All Suites</span>
        </div>
        <button class="sd-popup-close" id="sdRunAllClose">
            <i class="fas fa-times"></i>
        </button>
    </div>

    <div class="sd-tap-body">

        ${cooldownHtml}
        ${triggeredInfoHtml}
        ${privilegedInfoHtml}

        <!-- סטטיסטיקות -->
        <div class="sd-tap-section">
            <div class="sd-tap-section-title">
                <i class="fas fa-info-circle"></i> Overview
            </div>
            <div class="sd-run-all-last-run"
                 id="sdRunAllLastRunRow">
                <i class="fas fa-history"
                   style="color:#666"></i>
                <span style="color:#888;font-size:0.82rem">
                    Last run:
                </span>
                <span id="sdRunAllLastRunStr"
                      style="color:#ccc;font-size:0.82rem">
                    ${latestRunStr}
                </span>
                ${this._runAllLastRunTime ? `
                <span class="sd-tap-relative-time"
                      id="sdRunAllLastRunRel">
                    (${latestRunRel})
                </span>` : ''}
            </div>
        </div>

        <!-- בחירת מריץ -->
        <div class="sd-tap-section">
            <div class="sd-tap-section-title">
                <i class="fas fa-user-cog"></i> Who are you?
            </div>
            <div class="sd-run-runner-options">

                <label class="sd-run-all-runner-card
                    ${this._lastRunnerType === 'automation'
                ? 'selected' : ''}"
                    data-runner="automation">
                    <input type="radio"
                        name="sdRunAllRunnerType"
                        value="automation"
                        ${this._lastRunnerType === 'automation'
                ? 'checked' : ''}
                        style="display:none"/>
                    <div class="sd-run-runner-icon">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div class="sd-run-runner-label">
                        Automation Team
                    </div>
                    <div class="sd-run-runner-check">
                        <i class="fas fa-check-circle"></i>
                    </div>
                </label>

                <label class="sd-run-all-runner-card
                    ${this._lastRunnerType === 'noc'
                ? 'selected' : ''}"
                    data-runner="noc">
                    <input type="radio"
                        name="sdRunAllRunnerType"
                        value="noc"
                        ${this._lastRunnerType === 'noc'
                ? 'checked' : ''}
                        style="display:none"/>
                    <div class="sd-run-runner-icon">
                        <i class="fas fa-desktop"></i>
                    </div>
                    <div class="sd-run-runner-label">
                        NOC Team
                    </div>
                    <div class="sd-run-runner-check">
                        <i class="fas fa-check-circle"></i>
                    </div>
                </label>

            </div>

            <div id="sdRunAllRunnerInfo"
                 class="sd-run-all-runner-info">
                <i class="fas fa-info-circle"
                   style="color:#666"></i>
                <span id="sdRunAllRunnerInfoText">
                    Will trigger CloudBeat API for each suite
                </span>
            </div>
        </div>

        <!-- Options -->
        <div class="sd-tap-section">
            <div class="sd-tap-section-title">
                <i class="fas fa-cog"></i> Options
            </div>
            <label class="sd-run-all-patch-label"
                   id="sdRunAllPatchLabel">
                <div class="sd-run-all-patch-checkbox-wrap">
                    <input type="checkbox"
                           id="sdRunPatchSuitesChk"
                           class="sd-run-all-patch-chk"
                           ${this._runPatchSuites ? 'checked' : ''}/>
                    <span class="sd-run-all-patch-custom-chk">
                        <i class="fas fa-code-branch"
                           style="color:#a78bfa;
                                  font-size:0.85rem"></i>
                        Run Post-Patch Suites
                    </span>
                </div>
            </label>
        </div>

        <!-- Progress -->
        <div id="sdRunAllProgressWrap"
             class="sd-run-progress-wrap"
             style="display:none">
            <div class="sd-run-progress-header">
                <span id="sdRunAllProgressLabel"
                      class="sd-run-progress-label">
                    <i class="fas fa-spinner fa-spin"></i>
                    Sending request...
                </span>
                <span id="sdRunAllProgressPct"
                      class="sd-run-progress-pct">0%</span>
            </div>
            <div class="sd-run-progress-track">
                <div id="sdRunAllProgressBar"
                     class="sd-run-progress-bar"
                     style="width:0%"></div>
            </div>
        </div>

        <!-- הודעת תוצאה -->
        <div id="sdRunAllMsg"
             class="sd-mp-form-msg"
             style="display:none"></div>

        <!-- כפתורי פעולה -->
        <div class="sd-tap-actions"
             style="justify-content:flex-end">
            <button class="sd-tap-action-btn"
                    id="sdRunAllCancelBtn"
                    style="background:#252535;
                           border-color:#3a3a5a;
                           color:#999">
                <i class="fas fa-times"></i>
                <span>Cancel</span>
            </button>

            <button class="sd-tap-action-btn sd-tap-run-btn
                           ${isOnCooldown
                ? 'sd-tap-run-btn-disabled' : ''}"
                    id="sdRunAllConfirmBtn"
                    data-runner-type="${this._lastRunnerType}"
                    ${isOnCooldown ? 'disabled' : ''}
                    title="${this.escHtml(confirmBtnTitle)}">
                <i class="fas fa-play-circle"></i>
                <span>Run All</span>
                ${isOnCooldown ? `
                <span class="sd-tap-coming-soon">
                    <i class="fas fa-clock"
                       style="font-size:0.6rem"></i>
                    ${timeLeftStr}
                </span>` : ''}
            </button>
        </div>

    </div>
    `;
    }

    // ==========================================
    // Run All Suites — עדכון כפתור לפי מריץ
    // ==========================================
    _updateRunAllConfirmBtn(runnerType) {
        const btn = document.getElementById('sdRunAllConfirmBtn');
        const infoText = document.getElementById('sdRunAllRunnerInfoText');

        if (btn) btn.dataset.runnerType = runnerType;

        // *** עדכן זיכרון ***
        this._lastRunnerType = runnerType;

        if (infoText) {
            infoText.textContent = "Will run all suites with ";
            infoText.textContent += runnerType === 'noc'
                ? 'NOC user'
                : 'Automation Team user';
        }
    }

    // ==========================================
    // Run All Suites — ביצוע הרצה
    // ==========================================
    async runAllSuites(runnerType) {
        const confirmBtn = document.getElementById('sdRunAllConfirmBtn');
        const cancelBtn = document.getElementById('sdRunAllCancelBtn');

        const patchChk = document.getElementById('sdRunPatchSuitesChk');
        const runPatchSuites = patchChk?.checked === true;
        this._runPatchSuites = runPatchSuites;

        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i>' +
                ' <span>Running...</span>';
        }
        if (cancelBtn) cancelBtn.disabled = true;

        this._showRunAllProgress(true);
        this._setRunAllProgressBar(
            20, 'running', 'Sending request to server...');

        try {
            const res = await fetch('/SuiteResults/RunAllSuites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ runnerType, runPatchSuites })
            });

            this._setRunAllProgressBar(
                60, 'running', 'Processing response...');

            const data = await res.json();

            // *** השרת החזיר שגיאת נעילה ***
            if (!data.success && data.isLocked) {
                this._setRunAllProgressBar(0, 'error', '');
                this._showRunAllProgress(false);

                const timeLeft = data.timeLeftStr || '5m';

                this._showRunAllMsg(
                    `⏳ Tests were recently triggered. ` +
                    `Please wait ${timeLeft} before running again.`,
                    'error'
                );

                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.classList.add('sd-tap-run-btn-disabled');
                    confirmBtn.innerHTML = `
        <i class="fas fa-clock"></i>
        <span>Wait ${timeLeft}</span>`;
                }
                if (cancelBtn) cancelBtn.disabled = false;

                // *** עדכן כפתור Header עם מידע על מי הריץ ***
                if (data.timeLeftSecs > 0) {
                    this._updateRunAllHeaderBtnFromServer(
                        data.timeLeftSecs,
                        data.triggeredBy || '',
                        data.triggeredAt || ''
                    );
                }
                return;
            }

            if (data.success) {
                this._setRunAllProgressBar(
                    50, 'running',
                    'Waiting for test results...');

                this._runAllStartTime = new Date();
                this._runAllRunnerType = runnerType;

                const now = new Date();
                const hh = now.getHours().toString().padStart(2, '0');
                const mm = now.getMinutes().toString().padStart(2, '0');
                const ss = now.getSeconds().toString().padStart(2, '0');
                localStorage.setItem('sdRunAllLastTime', Date.now().toString());
                localStorage.setItem('sdRunAllTriggeredBy',
                    this.currentUser?.username || '');
                localStorage.setItem('sdRunAllTriggeredAt',
                    `${hh}:${mm}:${ss}`);

                // *** עדכן כפתור Header — NOC יראה cooldown ***
                // *** Admin/Automation לא יחסמו (השרת מחזיר isLocked=false) ***
                this._updateRunAllHeaderBtn();
                this._startPollingForRunAllResult();

                if (runPatchSuites && !data.patchSuccess) {
                    this._showRunAllMsg(
                        `Main suites triggered ✓, but post-patch ` +
                        `suites failed: ${data.patchBody || ''}`,
                        'error'
                    );
                }

            } else {
                this._setRunAllProgressBar(
                    100, 'error',
                    `Failed: ${data.message || 'Unknown error'}`
                );
                this._showRunAllMsg(
                    data.message || 'Unknown error', 'error');
                this._resetRunAllBtn(confirmBtn, cancelBtn);
            }

        } catch (err) {
            this._setRunAllProgressBar(
                100, 'error', `Network error: ${err.message}`);
            this._showRunAllMsg(
                `Communication error: ${err.message}`, 'error');
            this._resetRunAllBtn(confirmBtn, cancelBtn);
        }
    }

    // ==========================================
    // Run All — Polling לתוצאה
    // ==========================================

    _startPollingForRunAllResult() {
        // *** נקה polling קודם ***
        this._stopPollingForRunAllResult();

        // *** בדוק כל 40 שניות ***
        this._runAllPollInterval = setInterval(async () => {
            await this._checkRunAllResult();
        }, 40 * 1000);

        // *** timeout של 15 דקות ***
        this._runAllPollTimeout = setTimeout(() => {
            this._stopPollingForRunAllResult();
            this._setRunAllProgressBar(
                50, 'error',
                'Timeout — no result received after 15 minutes'
            );
            this._showRunAllMsg(
                'Timeout: no result received after 15 minutes',
                'error'
            );
            const confirmBtn =
                document.getElementById('sdRunAllConfirmBtn');
            const cancelBtn =
                document.getElementById('sdRunAllCancelBtn');
            this._resetRunAllBtn(confirmBtn, cancelBtn);
        }, 15 * 60 * 1000);
    }

    _stopPollingForRunAllResult() {
        if (this._runAllPollInterval) {
            clearInterval(this._runAllPollInterval);
            this._runAllPollInterval = null;
        }
        if (this._runAllPollTimeout) {
            clearTimeout(this._runAllPollTimeout);
            this._runAllPollTimeout = null;
        }
    }

    _updatePatchCheckboxStyle() {
        const chk = document.getElementById('sdRunPatchSuitesChk');
        const label = document.getElementById('sdRunAllPatchLabel');
        if (!label) return;

        const isChecked = chk?.checked === true;
        label.classList.toggle('sd-run-all-patch-checked', isChecked);
    }

    async _checkRunAllResult() {
        try {
            const res = await fetch(
                '/SuiteResults/GetRunAllLastResult',
                { credentials: 'include' }
            );
            const data = await res.json();
            if (!data.success || !data.hasResult) return;

            // *** בדוק אם התוצאה חדשה יותר מזמן תחילת הריצה ***
            const resultTime = data.lastRunTime
                ? new Date(data.lastRunTime) : null;
            const startTime = this._runAllStartTime;

            if (!resultTime || !startTime) return;
            if (resultTime <= startTime) return;

            // *** תוצאה חדשה הגיעה! ***
            this._stopPollingForRunAllResult();

            // *** שמור לתצוגה בפופאפ ***
            this._runAllLastRunTime = data.lastRunTime;

            const isSuccess =
                (data.status || '').toLowerCase() === 'passed';

            this._setRunAllProgressBar(
                100,
                isSuccess ? 'success' : 'error',
                isSuccess
                    ? '✓ Run completed successfully!'
                    : '✗ Run completed with failures'
            );

            this._showRunAllMsg(
                isSuccess
                    ? `✓ All suites completed successfully! ` +
                    `(${this.fmtLastRun(data.lastRunTime)})`
                    : `Run finished with failures ` +
                    `(${this.fmtLastRun(data.lastRunTime)})`,
                isSuccess ? 'success' : 'error'
            );

            // *** עדכן את שורת Last Run בפופאפ ***
            this._updateRunAllLastRunDisplay(data.lastRunTime);

            // *** סגור אחרי 8 שניות ***
            setTimeout(() => this.closeRunAllPopup(), 8 * 1000);

        } catch (err) {
            console.error('_checkRunAllResult error:', err);
        }
    }

    _updateRunAllLastRunDisplay(isoStr) {
        const strEl = document.getElementById('sdRunAllLastRunStr');
        const relEl = document.getElementById('sdRunAllLastRunRel');

        if (strEl) strEl.textContent = this.fmtFullDate(isoStr);

        if (relEl) {
            relEl.textContent = `(${this.fmtLastRun(isoStr)})`;
        } else {
            // *** צור את האלמנט אם לא קיים ***
            const row = document.getElementById('sdRunAllLastRunRow');
            if (row) {
                const span = document.createElement('span');
                span.id = 'sdRunAllLastRunRel';
                span.className = 'sd-tap-relative-time';
                span.textContent = `(${this.fmtLastRun(isoStr)})`;
                row.appendChild(span);
            }
        }
    }

    // ==========================================
    // Run All — helpers
    // ==========================================

    _showRunAllProgress(show) {
        const wrap = document.getElementById('sdRunAllProgressWrap');
        if (!wrap) return;

        if (show) {
            const bar = document.getElementById('sdRunAllProgressBar');
            const pctEl = document.getElementById('sdRunAllProgressPct');
            if (bar) {
                bar.style.width = '0%';
                bar.className = 'sd-run-progress-bar';
            }
            if (pctEl) {
                pctEl.textContent = '0%';
                pctEl.style.color = '#4ade80';
            }
            wrap.style.display = 'block';
        } else {
            wrap.style.display = 'none';
        }
    }

    _setRunAllProgressBar(pct, state = 'running', label = '') {
        const bar = document.getElementById('sdRunAllProgressBar');
        const pctEl = document.getElementById('sdRunAllProgressPct');
        const lblEl = document.getElementById('sdRunAllProgressLabel');

        if (bar) {
            bar.style.width = `${pct}%`;
            bar.className = `sd-run-progress-bar ${state}`;
        }

        if (pctEl) {
            pctEl.textContent = `${pct}%`;
            pctEl.style.color =
                state === 'success' ? '#4ade80' :
                    state === 'error' ? '#ef4444' :
                        '#4ade80';
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

    _showRunAllMsg(msg, type = 'info') {
        const el = document.getElementById('sdRunAllMsg');
        if (!el) return;
        el.textContent = msg;
        el.className = `sd-mp-form-msg ${type}`;
        el.style.display = 'block';
    }

    _resetRunAllBtn(confirmBtn, cancelBtn) {
        this._showRunAllProgress(false);

        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML =
                '<i class="fas fa-play-circle"></i> <span>Run All</span>';
        }
        if (cancelBtn) cancelBtn.disabled = false;
    }

    // ==========================================
    // Run All — מצא את הריצה האחרונה מבין כל הסוויטות
    // ==========================================

    _getLatestRunTime() {
        let latest = null;

        this.suites.forEach(suite => {
            if (!suite.lastRunTime) return;
            try {
                const d = new Date(suite.lastRunTime);
                if (!latest || d > latest) latest = d;
            } catch { /* ignore */ }
        });

        return latest;
    }

    // ==========================================
    // Run All — עדכון כפתור בהדר (cooldown)
    // ==========================================
    _updateRunAllHeaderBtn() {
        const btn = document.getElementById('sdRunAllBtn');
        if (!btn) return;

        // *** אם המשתמש הוא privileged — אל תחסום ***
        if (this.canEdit) return;

        const COOLDOWN_MS = 5 * 60 * 1000;

        // *** קרא מידע על מי הריץ ***
        const triggeredBy = localStorage.getItem('sdRunAllTriggeredBy') || '';
        const triggeredAt = localStorage.getItem('sdRunAllTriggeredAt') || '';

        btn.disabled = true;
        btn.classList.add('sd-run-all-btn-cooldown');

        const updateLabel = () => {
            const lastRunTime = localStorage.getItem('sdRunAllLastTime');
            if (!lastRunTime) {
                btn.disabled = false;
                btn.classList.remove('sd-run-all-btn-cooldown');
                btn.title = 'Run All';
                btn.innerHTML = `
            <i class="fas fa-play-circle"></i>
            <span>Run All</span>`;
                return;
            }

            const timeLeft = COOLDOWN_MS -
                (Date.now() - parseInt(lastRunTime));

            if (timeLeft <= 0) {
                btn.disabled = false;
                btn.classList.remove('sd-run-all-btn-cooldown');
                btn.title = 'Run All';
                btn.innerHTML = `
            <i class="fas fa-play-circle"></i>
            <span>Run All</span>`;
                // *** נקה localStorage ***
                localStorage.removeItem('sdRunAllTriggeredBy');
                localStorage.removeItem('sdRunAllTriggeredAt');
                return;
            }

            const mins = Math.floor(timeLeft / 60000);
            const secs = Math.floor((timeLeft % 60000) / 1000);
            const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

            // *** בנה tooltip ***
            let tooltip = `Cooldown active — ${timeStr} remaining`;
            if (triggeredBy && triggeredAt) {
                tooltip += `\n${triggeredBy} ran all suites at ${triggeredAt}`;
            } else if (triggeredBy) {
                tooltip += `\nTriggered by: ${triggeredBy}`;
            } else if (triggeredAt) {
                tooltip += `\nTriggered at: ${triggeredAt}`;
            }

            btn.title = tooltip;
            btn.innerHTML = `
        <i class="fas fa-clock"></i>
        <span>${timeStr}</span>`;

            setTimeout(updateLabel, 1000);
        };

        updateLabel();
    }

    // ==========================================
    // Run All — פורמט זמן שנותר
    // ==========================================

    _formatTimeLeft(ms) {
        if (ms <= 0) return '0s';
        const totalSecs = Math.ceil(ms / 1000);
        const mins = Math.floor(totalSecs / 60);
        const secs = totalSecs % 60;

        if (mins === 0) return `${secs}s`;
        if (secs === 0) return `${mins}m`;
        return `${mins}m ${secs}s`;
    }

    // ==========================================
    // סגנונות
    // ==========================================

    addStyles() {
        if (document.getElementById('sdStyles')) return;

        const style = document.createElement('style');
        style.id = 'sdStyles';
        style.textContent = `

        /* ===== Root ===== */
        .sd-root {
            background: #111;
            color: #e0e0e0;
            font-family: 'Segoe UI', Arial, sans-serif;
            min-height: 100%;
            display: flex;
            flex-direction: column;
            direction: ltr;
        }

        /* ===== Header ===== */
        .sd-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: #1a1a2e;
            border-bottom: 1px solid #2a2a3e;
            flex-wrap: wrap;
            gap: 4px;
        }

        .sd-header-left {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .sd-header-right {
            display: flex;
            align-items: center;
            gap: 5px;
        }

        /* חיפוש */
        .sd-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .sd-search-icon {
            position: absolute;
            left: 9px;
            color: #666;
            font-size: 0.8rem;
            pointer-events: none;
        }
        .sd-search-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 28px 6px 28px;
            font-size: 0.85rem;
            width: 200px;
            outline: none;
            transition: border-color 0.2s;
        }
        .sd-search-input:focus { border-color: #7c3aed; }
        .sd-search-input::placeholder { color: #555; }

        .sd-clear-search {
            position: absolute;
            right: 7px;
            background: none;
            border: none;
            color: #777;
            cursor: pointer;
            display: flex;
            align-items: center;
            padding: 0;
            font-size: 0.8rem;
        }
        .sd-clear-search:hover { color: #ccc; }

        /* כפתורי סינון */
        .sd-filter-btns { display: flex; gap: 3px; }

        .sd-filter-btn {
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
        .sd-filter-btn:hover { background: #303050; color: #ccc; }

        .sd-filter-btn.active {
            background: #320F5B;
            border-color: #7c3aed;
            color: #fff;
        }
        .sd-filter-btn.passed.active {
            background: rgba(34,197,94,0.2);
            border-color: #22c55e;
            color: #22c55e;
        }
        .sd-filter-btn.failed.active {
            background: rgba(239, 68, 68, 0.2);
            border-color: #ef4444;
            color: #ef4444;
        }

        /* *** כפתור תצוגה קומפקטית *** */
        .sd-compact-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            padding: 5px 12px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sd-compact-btn:hover {
            background: #303050;
            color: #ccc;
        }
        .sd-compact-btn.active {
            background: rgba(20, 184, 166, 0.15);
            border-color: #14b8a6;
            color: #14b8a6;
        }

        /* כפתור ניהול */
        .sd-manage-btn {
            background: #1e3a5f;
            border: 1px solid #2a5a9f;
            border-radius: 6px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 5px 12px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            direction: rtl;
        }
        .sd-manage-btn:hover {
            background: #254a7f;
            color: #aad4ff;
        }

        /* רענון */
        .sd-last-refresh {
            font-size: 0.75rem;
            color: #555;
        }
        .sd-refresh-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            padding: 5px 10px;
            transition: all 0.2s;
        }
        .sd-refresh-btn:hover {
            background: #303050;
            color: #ccc;
        }

        /* ===== הודעות ===== */
        .sd-error {
            margin: 8px 16px;
            padding: 8px 14px;
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.4);
            border-radius: 6px;
            color: #f87171;
            font-size: 0.85rem;
            direction: rtl;
        }
        .sd-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 16px;
            color: #666;
            font-size: 0.9rem;
        }

        /* ===== פופאפ ניהול ===== */
        .sd-popup-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(3px);
        }

        .sd-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 90%;
            max-width: 1500px;
            height: 90%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        @keyframes sdPopupIn {
            from { opacity: 0; transform: scale(0.95) translateY(-10px); }
            to   { opacity: 1; transform: scale(1)    translateY(0);     }
        }

        .sd-popup-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-bottom: 1px solid #2a2a4e;
            background: #16162a;
            flex-shrink: 0;
        }

        .sd-popup-title {
            font-size: 1rem;
            font-weight: 600;
            color: #7ab3ef;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .sd-popup-close {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 1.1rem;
            padding: 4px 8px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .sd-popup-close:hover {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
        }

        .sd-popup-body {
            overflow-y: auto;
            flex: 1;
            padding: 0;
        }

        .sd-mp-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            border-bottom: 1px solid #2a2a4e;
            background: #16162a;
        }
        .sd-mp-title {
            font-size: 0.95rem;
            font-weight: 600;
            color: #7ab3ef;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .sd-mp-close {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            font-size: 1rem;
            padding: 2px 6px;
            border-radius: 4px;
            transition: all 0.2s;
        }
        .sd-mp-close:hover {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
        }

        /* טופס הוספה */
        .sd-mp-add-form {
            padding: 12px 16px;
            border-bottom: 1px solid #2a2a4e;
        }
        .sd-mp-form-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .sd-mp-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 7px 12px;
            font-size: 0.85rem;
            outline: none;
            transition: border-color 0.2s;
            flex: 1;
            max-width: 40%;
            direction: ltr;
        }
        .sd-mp-input:focus { border-color: #7c3aed; }
        .sd-mp-input::placeholder { color: #555; }

        #sdDtNumInput,#sdDtEnInput,#sdDtHeInput {
            direction: rtl;

        }
        .sd-mp-add-btn {
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
        }
        .sd-mp-add-btn:hover {
            background: #257f4a;
            color: #aaffd4;
        }
        .sd-mp-add-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* ===== Phone Lookup ===== */
        .sd-contact-phone-wrap {
            position: relative;
            display: flex;
            align-items: center;
            gap: 2px;
        }

        .sd-contact-lookup-btn {
            background: #1e3a5f;
            border: 1px solid #2a5a9f;
            border-radius: 6px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 7px 10px;
            font-size: 0.8rem;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
            height: 100%;
            display: flex;
            align-items: center;
        }
        .sd-contact-lookup-btn:hover {
            background: #254a7f;
            color: #aad4ff;
        }
        .sd-contact-lookup-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* הדגשת שדה טלפון אחרי מילוי אוטומטי */
        .sd-input-highlight {
            border-color: #4ade80 !important;
            background: rgba(74, 222, 128, 0.08) !important;
            transition: all 0.3s ease;
        }

        /* ===== עריכת איש קשר ===== */
        .sd-contact-edit-btn {
            background: none;
            border: 1px solid #2a4a8a;
            border-radius: 4px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
        }
        .sd-contact-edit-btn:hover {
            background: rgba(122, 179, 239, 0.15);
        }

        .sd-contact-edit-form {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            width: 100%;
            padding: 4px 0;
        }

        .sd-contact-edit-input {
            flex: 1;
            min-width: 100px;
            max-width: none !important;
            font-size: 0.8rem;
            padding: 5px 10px;
        }

        .sd-contact-edit-actions {
            display: flex;
            gap: 5px;
            flex-shrink: 0;
        }

        .sd-contact-save-btn {
            background: #1e5f3a;
            border: 1px solid #2a9f5a;
            border-radius: 5px;
            color: #7aefb3;
            cursor: pointer;
            padding: 4px 10px;
            font-size: 0.78rem;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
        }
        .sd-contact-save-btn:hover {
            background: #257f4a;
            color: #aaffd4;
        }
        .sd-contact-save-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .sd-contact-cancel-btn {
            background: none;
            border: 1px solid #3a3a5a;
            border-radius: 5px;
            color: #666;
            cursor: pointer;
            padding: 4px 8px;
            font-size: 0.78rem;
            transition: all 0.2s;
        }
        .sd-contact-cancel-btn:hover {
            background: rgba(239, 68, 68, 0.15);
            border-color: #7a2a2a;
            color: #f87171;
        }

        /* הודעת טופס */
        .sd-mp-form-msg {
            margin-top: 8px;
            font-size: 0.82rem;
            padding: 5px 10px;
            border-radius: 4px;
            display: none;
        }
        .sd-mp-form-msg.success {
            background: rgba(34, 197, 94, 0.15);
            color: #4ade80;
            border: 1px solid rgba(34, 197, 94, 0.3);
        }
        .sd-mp-form-msg.error {
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        /* טבלת סוויטות */
        .sd-mp-table-wrap {
            padding: 12px 16px;
            max-height: 90%;
            overflow-y: auto;
        }
        .sd-mp-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
        }
        .sd-mp-table th {
            background: #16162a;
            color: #7ab3ef;
            padding: 7px 10px;
            text-align: right;
            border-bottom: 1px solid #2a2a4e;
            font-weight: 600;
            position: sticky;
            top: 0;
            z-index: 1;
        }
        .sd-mp-table td {
            padding: 6px 10px;
            border-bottom: 1px solid #1e1e3a;
            color: #ccc;
            vertical-align: middle;
        }
        .sd-mp-table tr:hover td {
            background: rgba(122, 179, 239, 0.05);
        }
        .sd-mp-uid {
            font-family: monospace;
            font-size: 0.78rem;
            color: #888;
            cursor: help;
        }
        .sd-mp-date {
            font-size: 0.75rem;
            color: #666;
        }
        .sd-mp-empty {
            text-align: center;
            color: #555;
            padding: 20px !important;
        }
        .sd-mp-err { color: #f87171 !important; }

        .sd-mp-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px;
            color: #666;
            font-size: 0.85rem;
        }

        /* כפתורי פעולה בטבלה */
        .sd-mp-actions {
            display: flex;
            gap: 6px;
            justify-content: flex-end;
        }
        .sd-mp-edit-btn,
        .sd-mp-del-btn {
            background: none;
            border: 1px solid transparent;
            border-radius: 4px;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.78rem;
            transition: all 0.2s;
        }
        .sd-mp-edit-btn {
            color: #7ab3ef;
            border-color: #2a5a9f;
        }
        .sd-mp-edit-btn:hover {
            background: rgba(122, 179, 239, 0.15);
        }
        .sd-mp-del-btn {
            color: #f87171;
            border-color: #7a2a2a;
        }
        .sd-mp-del-btn:hover {
            background: rgba(239, 68, 68, 0.15);
        }

        /* ===== גריד עמודות ===== */
        .sd-columns-wrap {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 3px;
            overflow-x: hidden;
            overflow-y: auto;
            flex: 1;
            align-items: stretch;
            padding: 0;
        }

        /* ===== עמודה בודדת ===== */
        .sd-column {
            min-width: 0;
            width: 100%;
            display: flex;
            flex-direction: column;
            border-right: 1px solid #222;
            background: #161616;
        }
        .sd-column:last-child { border-right: none; }

        /* כותרת עמודה */
        .sd-col-header {
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 4px;
            position: sticky;
            top: 0;
            z-index: 2;
            border-bottom: 2px solid #333;
        }
        .sd-col-header.good {
            background: #1a2e1a;
            border-bottom-color: #22c55e;
        }
        .sd-col-header.bad {
            background: #2e1a1a;
            border-bottom-color: #ef4444;
        }
        .sd-col-header.warning {
            background: #2e1e0a;
            border-bottom-color: #f59e0b;
        }

        .sd-col-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #ddd;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .sd-col-index {
            font-size: 0.7rem;
            color: #888;
            background: #333;
            border-radius: 3px;
            padding: 1px 5px;
            flex-shrink: 0;
        }
        .sd-col-meta {
            display: flex;
            align-items: center;
            gap: 3px;
            font-size: 0.75rem;
        }
        .sd-col-stat          { font-weight: 700; }
        .sd-col-stat.passed   { color: #22c55e; }
        .sd-col-stat.failed   { color: #ef4444; }
        .sd-col-stat.total    { color: #aaa; }
        .sd-col-stat-sep      { color: #555; }

        /* גוף עמודה */
        .sd-col-body {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 4px;
            overflow-y: auto;
            flex: 1;
        }

        /* ===== כרטיסיית בדיקה (תצוגה מפורטת) ===== */
        .sd-test-card {
            border-radius: 4px;
            padding: 7px 9px;
            cursor: default;
            transition: filter 0.15s;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .sd-test-card:hover   { filter: brightness(1.15); }

        .sd-test-card.passed  {
            background: linear-gradient(135deg, #3d9970, #2ecc71cc);
            border-left: 3px solid #2ecc71;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .sd-test-card.failed  {
            background: linear-gradient(135deg, #9b2020, #c94040);
            border-left: 3px solid #e74c3c;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .sd-test-card.warning {
            background: linear-gradient(135deg, #b45309, #f59e0bcc);
            border-left: 3px solid #f59e0b;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .sd-test-card.unknown { background: #3a3a3a; }

        .sd-card-name {
            font-size: 0.75rem;
            color: #fff;
            line-height: 1.3;
            word-break: break-word;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sd-card-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
        }
        .sd-card-duration {
            font-size: 0.68rem;
            color: rgba(255, 255, 255, 0.6);
            display: flex;
            align-items: center;
            gap: 3px;
            margin-left: auto;
        }

        /* תג עדיפות */
        .sd-priority {
            font-size: 0.65rem;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px;
            text-transform: uppercase;
        }
        .sd-priority.p1 {
            background: rgba(239, 68, 68, 0.4);
            color: #fca5a5;
        }
        .sd-priority.p2 {
            background: rgba(245, 158, 11, 0.4);
            color: #fde68a;
        }
        .sd-priority.p0 {
            background: rgba(99, 102, 241, 0.4);
            color: #c7d2fe;
        }

        /* ===== *** תצוגה קומפקטית *** ===== */

        /* בתצוגה קומפקטית — יותר עמודות בגריד */
        .sd-columns-wrap.sd-compact-mode {
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 5px;
            min-height: 50px;
        }

        /* גריד הריבועים בתוך כל עמודה */
        .sd-compact-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
            padding: 4px;
            align-content: flex-start;
        }

        /* ריבוע בודד */
        .sd-compact-dot {
            width: 20px;
            height: 20px;
            border-radius: 2px;
            cursor: default;
            transition: transform 0.1s, filter 0.1s;
            flex-shrink: 0;
        }
        .sd-compact-dot:hover {
            transform: scale(1.4);
            filter: brightness(1.3);
            z-index: 10;
            position: relative;
        }

        /* *** צבעי ריבועים — passed = teal *** */
        .sd-compact-dot.passed  {
            background: linear-gradient(135deg, #3d9970, #2ecc71cc);
            box-shadow: 0 0 3px rgba(39,174,96,0.4);
        }
        .sd-compact-dot.failed  {
            background: linear-gradient(135deg, #b96c6c, #ef2727);
            box-shadow: 0 0 3px rgba(192,57,43,0.4);
        }
        .sd-compact-dot.warning {
            background: linear-gradient(135deg, #92400e, #d97706);
            box-shadow: 0 0 3px rgba(217,119,6,0.5);
        }
        .sd-compact-dot.unknown {
            background: #444;
        }

        /* ===== אין נתונים ===== */
        .sd-no-data {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 60px 20px;
            color: #555;
            width: 100%;
            font-size: 1rem;
        }
        .sd-no-data i { font-size: 2.5rem; color: #333; }
        .sd-no-tests {
            padding: 12px;
            text-align: center;
            color: #555;
            font-size: 0.78rem;
        }

        /* ===== Scrollbar ===== */
        .sd-columns-wrap::-webkit-scrollbar       { height: 6px; }
        .sd-columns-wrap::-webkit-scrollbar-track { background: #111; }
        .sd-columns-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }
        .sd-col-body::-webkit-scrollbar       { width: 4px; }
        .sd-col-body::-webkit-scrollbar-track { background: transparent; }
        .sd-col-body::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }

        /* ===== 2 עמודות בתוך סוויטה (יותר מ-10 טסטים) ===== */
        .sd-col-body-two-cols {
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 2px;
            align-content: flex-start;
        }

        .sd-col-body-two-cols .sd-test-card {
            padding: 4px 6px;
            gap: 2px;
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
        }

        .sd-col-body-two-cols .sd-card-name {
            font-size: 0.68rem;
            min-width: 0;
            width: 100%;
            height: 25px;
        }

        .sd-col-body-two-cols .sd-card-footer {
            gap: 3px;
            min-width: 0;
            flex-wrap: wrap;
        }

        .sd-col-body-two-cols .sd-card-duration {
            font-size: 0.6rem;
        }

        .sd-col-body-two-cols .sd-card-lastrun {
            font-size: 0.58rem;
        }

        .sd-col-body-two-cols .sd-priority {
            font-size: 0.58rem;
            padding: 1px 3px;
        }

        /* ===== פופאפ פעולות טסט ===== */
        .sd-test-action-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 60%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        .sd-tap-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            gap: 10px;
            direction: ltr;
        }

        .sd-tap-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            color: #ddd;
            min-width: 0;
        }

        .sd-tap-name {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 380px;
            min-width: 250px;
        }

        .sd-tap-body {
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            overflow-y: auto;
            max-height: 70vh;
            direction: ltr;
        }

        .sd-tap-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .sd-tap-section-title {
            font-size: 0.78rem;
            font-weight: 700;
            color: #7ab3ef;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            display: flex;
            align-items: center;
            gap: 6px;
            padding-bottom: 4px;
            border-bottom: 1px solid #2a2a4e;
        }

        /* גריד פרטים */
        .sd-tap-details-grid {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .sd-tap-detail-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.82rem;
        }

        .sd-tap-detail-label {
            color: #666;
            min-width: 90px;
            flex-shrink: 0;
        }

        .sd-tap-detail-value {
            color: #ccc;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .sd-tap-detail-value.passed { color: #22c55e; }
        .sd-tap-detail-value.failed { color: #ef4444; }

        .sd-tap-mono {
            font-family: monospace;
            font-size: 0.78rem;
            color: #888;
            word-break: break-all;
        }

        /* כפתורי פעולה */
        .sd-tap-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .sd-tap-action-btn {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 8px 16px;
            border-radius: 7px;
            font-size: 0.85rem;
            cursor: pointer;
            text-decoration: none;
            transition: all 0.2s;
            border: 1px solid transparent;
            position: relative;
        }

        .sd-tap-run-btn {
            background: #1e3a1e;
            border-color: #2a7a2a;
            color: #4ade80;
        }
        .sd-tap-run-btn:not(:disabled):hover {
            background: #254a25;
            color: #86efac;
        }
        .sd-tap-run-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        .sd-tap-mail-btn {
            background: #1e2e4a;
            border-color: #2a4a8a;
            color: #7ab3ef;
        }
        .sd-tap-mail-btn:hover {
            background: #253a5a;
            color: #aad4ff;
        }
        /* *** כפתור Email מושבת *** */
        .sd-tap-mail-btn-disabled {
            opacity: 0.4;
            cursor: not-allowed !important;
            pointer-events: none;
        }

        .sd-tap-mail-btn-disabled:hover {
            background: #1e2e4a !important;
            color: #7ab3ef !important;
        }
        /* תג "בקרוב" */
        .sd-tap-coming-soon {
            font-size: 0.6rem;
            background: rgba(124,58,237,0.3);
            color: #a78bfa;
            border-radius: 3px;
            padding: 1px 5px;
            border: 1px solid rgba(124,58,237,0.4);
        }

        /* אנשי קשר */
        .sd-tap-contacts {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .sd-tap-contact {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.82rem;
            padding: 6px 10px;
            background: #252535;
            border-radius: 6px;
            border: 1px solid #2a2a4e;
        }

        .sd-tap-contact i {
            color: #666;
            font-size: 0.75rem;
            flex-shrink: 0;
        }

        .sd-tap-contact span {
            color: #ccc;
            flex: 1;
        }

        .sd-tap-contact-email {
            color: #7ab3ef;
            font-size: 0.78rem;
            text-decoration: none;
        }
        .sd-tap-contact-email:hover {
            color: #aad4ff;
            text-decoration: underline;
        }

        .sd-tap-no-contacts {
            font-size: 0.82rem;
            color: #555;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 10px;
            background: #1a1a2a;
            border-radius: 6px;
            border: 1px dashed #2a2a4e;
        }

        .sd-tap-relative-time {
            font-size: 0.72rem;
            color: #555;
            margin-right: 4px;
        }

        .sd-mp-table-wrap::-webkit-scrollbar       { width: 4px; }
        .sd-mp-table-wrap::-webkit-scrollbar-track { background: #111; }
        .sd-mp-table-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 2px;
        }
        
        /* ===== פופאפ ניהול אנשי קשר ===== */
        .sd-contacts-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 50%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        .sd-contacts-body {
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
            max-height: 70vh;
            overflow-y: auto;
        }

        .sd-contacts-add-form {
            border-bottom: 1px solid #2a2a4e;
            padding-bottom: 14px;
        }

        .sd-contacts-form-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }

        .sd-contacts-list-wrap {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .sd-contacts-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .sd-contact-row {
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
        .sd-contact-row:hover {
            background: #2a2a45;
        }

        .sd-contact-info {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.83rem;
            min-width: 0;
            flex: 1;
        }

        .sd-contact-icon {
            color: #555;
            font-size: 0.75rem;
            flex-shrink: 0;
        }

        .sd-contact-name {
            color: #ccc;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 80px;
        }

        .sd-contact-actions {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        }

        .sd-contact-del-btn {
            background: none;
            border: 1px solid #7a2a2a;
            border-radius: 4px;
            color: #f87171;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.75rem;
            transition: all 0.2s;
        }
        .sd-contact-del-btn:hover {
            background: rgba(239,68,68,0.15);
        }

        /* כפתור Manage Contacts בפופאפ טסט */
        .sd-tap-contacts-btn {
            background: #1e2e4a;
            border-color: #2a4a8a;
            color: #7ab3ef;
        }
        .sd-tap-contacts-btn:hover {
            background: #253a5a;
            color: #aad4ff;
        }

        /* טלפון באיש קשר */
        .sd-contact-phone {
            color: #4ade80;
            font-size: 0.75rem;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            transition: color 0.2s;
        }
        .sd-contact-phone:hover {
            color: #86efac;
            text-decoration: underline;
        }
        .sd-contact-phone i {
            font-size: 0.65rem;
        }

        /* ===== כפתור Re-run Failed ===== */
        .sd-tap-rerun-btn {
            background: #2e1a3a;
            border-color: #7c3aed;
            color: #a78bfa;
        }
        .sd-tap-rerun-btn:not(:disabled):hover {
            background: #3a2050;
            color: #c4b5fd;
        }
        .sd-tap-rerun-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        /* ===== תגי Run Mode ===== */
        .sd-run-mode-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 5px;
            font-size: 0.78rem;
            font-weight: 600;
        }
        .sd-run-mode-badge.full-run {
            background: rgba(74, 222, 128, 0.15);
            color: #4ade80;
            border: 1px solid rgba(74, 222, 128, 0.3);
        }
        .sd-run-mode-badge.failed-only {
            background: rgba(167, 139, 250, 0.15);
            color: #a78bfa;
            border: 1px solid rgba(167, 139, 250, 0.3);
        }

        /* חיפוש בטבלת ניהול */
        .sd-mp-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
            flex: 1;
            max-width: 30%;
            margin-right: auto;
        }
        .sd-mp-search-icon {
            position: absolute;
            right: 9px;
            color: #555;
            font-size: 0.78rem;
            pointer-events: none;
        }
        .sd-mp-search-input {
            padding-right: 28px !important;
            padding-left: 26px !important;
            max-width: 100%;
            direction: rtl;
        }
        .sd-mp-clear-search {
            position: absolute;
            left: 7px;
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            display: flex;
            align-items: center;
            padding: 0;
            font-size: 0.75rem;
            transition: color 0.2s;
        }
        .sd-mp-clear-search:hover { color: #ccc; }

        /* ===== כפתורי Collapse/Expand ===== */
        .sd-collapse-btns {
            display: flex;
            gap: 6px;
        }

        .sd-collapse-all-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            padding: 5px 10px;
            font-size: 0.8rem;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
        }
        .sd-collapse-all-btn:hover {
            background: #303050;
            color: #ccc;
        }

        /* כפתור toggle בכותרת עמודה */
        .sd-col-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 4px;
        }

        .sd-col-toggle-btn {
            background: none;
            border: none;
            color: #888;
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 0.7rem;
            flex-shrink: 0;
            transition: all 0.2s;
            line-height: 1;
        }
        .sd-col-toggle-btn:hover {
            background: rgba(255,255,255,0.1);
            color: #ccc;
        }

        .sd-col-header {
            cursor: pointer;
        }

        /* גוף מוסתר */
        .sd-body-hidden {
            display: none !important;
        }
        .sd-column:has(.sd-body-hidden) {
            flex: 0 0 auto;
            min-height: 0;
        }

        /* ===== זמן ריצה אחרון — כותרת סוויטה ===== */
        .sd-col-lastrun {
            font-size: 0.68rem;
            color: #888;
            display: flex;
            align-items: center;
            gap: 3px;
            margin-right: auto;   /* דחוף לימין */
            white-space: nowrap;
        }
        .sd-col-lastrun i { color: #666; }
        .sd-col-lastrun-old {
            font-weight: 800;
        }

        /* ===== זמן ריצה אחרון — כרטיסיית טסט ===== */
        .sd-card-lastrun {
            font-size: 0.65rem;
            color: rgba(255, 255, 255, 0.45);
            display: flex;
            align-items: center;
            gap: 3px;
            margin-top: 1px;
        }
        .sd-card-lastrun i { font-size: 0.6rem; }

        /* אייקון מייל בכרטיסיית טסט */
        .sd-card-mail-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: rgba(255, 255, 255, 0.45);
            font-size: 0.6rem;
            margin-right: 3px;
            text-decoration: none;
            transition: color 0.2s, transform 0.15s;
            line-height: 1;
            padding: 1px 2px;
            border-radius: 2px;
        }
        .sd-card-mail-icon:hover {
            color: #7ab3ef;
            transform: scale(1.3);
        }

        /* אייקון מייל בכותרת סוויטה */
        .sd-col-mail-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: rgba(239, 68, 68, 0.5);
            font-size: 0.62rem;
            margin-right: 4px;
            text-decoration: none;
            transition: color 0.2s, transform 0.15s;
            line-height: 1;
            padding: 1px 3px;
            border-radius: 2px;
        }
        .sd-col-mail-icon:hover {
            color: #f87171;
            transform: scale(1.25);
        }
        /* ===== כפתור Sync Names ===== */
        .sd-sync-btn {
            background: #1a2e1a;
            border: 1px solid #2a7a2a;
            border-radius: 6px;
            color: #4ade80;
            cursor: pointer;
            padding: 5px 12px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sd-sync-btn:hover {
            background: #254a25;
            color: #86efac;
        }
        .sd-sync-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .sd-sync-btn.syncing i {
            animation: fa-spin 1s linear infinite;
        }

        /* פופאפ תוצאות Sync */
        .sd-sync-popup {
            background: #1a1a2e;
            border: 1px solid #2a7a2a;
            border-radius: 10px;
            width: 60%;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        .sd-sync-body {
            padding: 16px;
            overflow-y: auto;
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .sd-sync-summary {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .sd-sync-stat-box {
            flex: 1;
            min-width: 100px;
            padding: 10px 14px;
            border-radius: 8px;
            text-align: center;
            font-size: 0.82rem;
        }
        .sd-sync-stat-box.updated {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.3);
            color: #4ade80;
        }
        .sd-sync-stat-box.unchanged {
            background: rgba(100,100,100,0.1);
            border: 1px solid #333;
            color: #888;
        }
        .sd-sync-stat-box.failed {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            color: #f87171;
        }
        .sd-sync-stat-num {
            font-size: 1.6rem;
            font-weight: 700;
            line-height: 1.2;
        }

        .sd-sync-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8rem;
            direction: ltr;
        }
        .sd-sync-table th {
            background: #16162a;
            color: #7ab3ef;
            padding: 6px 10px;
            border-bottom: 1px solid #2a2a4e;
            position: sticky;
            top: 0;
        }
        .sd-sync-table td {
            padding: 5px 10px;
            border-bottom: 1px solid #1e1e3a;
            color: #ccc;
            vertical-align: middle;
        }
        .sd-sync-table tr.updated td {
            background: rgba(34,197,94,0.05);
        }
        .sd-sync-table tr.failed td  {
            background: rgba(239,68,68,0.05);
        }
        .sd-sync-old-name {
            color: #888;
            text-decoration: line-through;
            font-size: 0.75rem;
        }
        .sd-sync-new-name {
            color: #4ade80;
            font-size: 0.8rem;
        }
        .sd-sync-status-badge {
            font-size: 0.7rem;
            padding: 2px 7px;
            border-radius: 3px;
            font-weight: 600;
        }
        .sd-sync-status-badge.updated {
            background: rgba(34,197,94,0.2);
            color: #4ade80;
        }
        .sd-sync-status-badge.unchanged {
            background: rgba(100,100,100,0.15);
            color: #888;
        }
        .sd-sync-status-badge.failed {
            background: rgba(239,68,68,0.2);
            color: #f87171;
        }

        .sd-sync-apply-btn {
            background: #1e5f3a;
            border: 1px solid #2a9f5a;
            border-radius: 6px;
            color: #7aefb3;
            cursor: pointer;
            padding: 8px 20px;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            align-self: flex-end;
        }
        .sd-sync-apply-btn:hover {
            background: #257f4a;
            color: #aaffd4;
        }
        .sd-sync-apply-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        /* ===== פופאפ סוויטה ===== */
        .sd-suite-action-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 60%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        /* כרטיסי סטטיסטיקה */
        .sd-sap-stats-row {
            display: flex;
            gap: 10px;
        }

        .sd-sap-stat-card {
            flex: 1;
            padding: 10px 14px;
            border-radius: 8px;
            text-align: center;
        }
        .sd-sap-stat-card.passed {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.3);
        }
        .sd-sap-stat-card.failed {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
        }
        .sd-sap-stat-card.total {
            background: rgba(100,100,100,0.1);
            border: 1px solid #333;
        }

        .sd-sap-stat-num {
            font-size: 1.8rem;
            font-weight: 700;
            line-height: 1.1;
        }
        .sd-sap-stat-card.passed .sd-sap-stat-num { color: #22c55e; }
        .sd-sap-stat-card.failed .sd-sap-stat-num { color: #ef4444; }
        .sd-sap-stat-card.total  .sd-sap-stat-num { color: #aaa;    }

        .sd-sap-stat-label {
            font-size: 0.72rem;
            color: #888;
            margin-top: 2px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        /* Progress bar */
        .sd-sap-progress-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 4px;
        }
        .sd-sap-progress-wrap {
            flex: 1;
            height: 8px;
            background: #2a2a4e;
            border-radius: 4px;
            overflow: hidden;
        }
        .sd-sap-progress-bar {
            height: 100%;
            border-radius: 4px;
            transition: width 0.4s ease;
            min-width: 2px;
        }

        /* רשימת כושלים */
        .sd-sap-failed-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
            max-height: 200px;
            overflow-y: auto;
        }
        .sd-sap-failed-test {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 5px 9px;
            background: rgba(239,68,68,0.07);
            border: 1px solid rgba(239,68,68,0.15);
            border-radius: 5px;
            font-size: 0.78rem;
        }
        .sd-sap-failed-name {
            flex: 1;
            color: #fca5a5;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .sd-sap-failed-dur {
            color: #666;
            font-size: 0.7rem;
            flex-shrink: 0;
        }

        /* תג מספר כושלים */
        .sd-sap-failed-badge {
            background: rgba(239,68,68,0.25);
            color: #f87171;
            border-radius: 10px;
            padding: 1px 7px;
            font-size: 0.7rem;
            font-weight: 700;
            margin-right: 4px;
        }

        /* מספר מיילים */
        .sd-sap-email-count {
            background: rgba(122,179,239,0.2);
            color: #7ab3ef;
            border-radius: 10px;
            padding: 1px 6px;
            font-size: 0.7rem;
            font-weight: 700;
        }

        /* כפתור Copy UID */
        .sd-sap-copy-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            color: #999;
        }
        .sd-sap-copy-btn:hover {
            background: #303050;
            color: #ccc;
        }

        /* כפתור ⋮ בכותרת עמודה */
        .sd-col-header-btns {
            display: flex;
            align-items: center;
            gap: 2px;
            flex-shrink: 0;
        }

        .sd-suite-info-btn {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            padding: 2px 5px;
            border-radius: 3px;
            font-size: 0.7rem;
            transition: all 0.2s;
            line-height: 1;
        }
        .sd-suite-info-btn:hover {
            background: rgba(255,255,255,0.1);
            color: #aaa;
        }

        /* כפתור העתקת UID בטבלת ניהול */
        .sd-mp-cbid-btn {
            background: none;
            border: 1px solid #2a3a5a;
            border-radius: 4px;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.78rem;
            color: #556a8a;
            transition: all 0.2s;
        }
        .sd-mp-cbid-btn:hover {
            background: rgba(122, 179, 239, 0.1);
            border-color: #4a7abf;
            color: #7ab3ef;
        }
        .sd-mp-cbid-btn:active {
            background: rgba(122, 179, 239, 0.2);
            transform: scale(0.95);
        }

        /* מצב אחרי העתקה */
        .sd-mp-cbid-btn.copied {
            border-color: #2a7a4a;
            color: #4ade80;
            background: rgba(34, 197, 94, 0.1);
        }
        /* ===== פופאפ הרצת סוויטה ===== */
        .sd-run-suite-popup {
            background: #1a1a2e;
            border: 1px solid #2a7a2a;
            border-radius: 10px;
            width: 90%;
            max-width: 460px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        /* כרטיסי בחירת מריץ */
        .sd-run-runner-options {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }

        .sd-run-runner-card {
            flex: 1;
            min-width: 160px;
            padding: 14px 16px;
            background: #252535;
            border: 2px solid #3a3a5a;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            text-align: center;
            position: relative;
            user-select: none;
        }

        .sd-run-runner-card:hover {
            background: #2a2a45;
            border-color: #4ade80;
        }
        .sd-run-runner-card.selected {
            background: rgba(74, 222, 128, 0.1);
            border-color: #4ade80;
        }

        .sd-run-runner-card.selected .sd-run-runner-icon i {
            color: #4ade80;
        }

        .sd-run-runner-card.selected .sd-run-runner-check {
            color: #4ade80;
            opacity: 1;
        }

        .sd-run-runner-check {
            opacity: 0;
            font-size: 1rem;
            transition: opacity 0.2s;
        }

        .sd-run-runner-icon {
            font-size: 1.8rem;
            color: #666;
            transition: color 0.2s;
        }

        .sd-run-runner-label {
            font-size: 0.85rem;
            color: #ccc;
            font-weight: 600;
        }
        /* ===== Progress Bar — Run Suite ===== */
        .sd-run-progress-wrap {
            background: #16162a;
            border: 1px solid #2a2a4e;
            border-radius: 8px;
            padding: 14px 16px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            animation: sdFadeIn 0.25s ease;
        }

        @keyframes sdFadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to   { opacity: 1; transform: translateY(0);    }
        }

        .sd-run-progress-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }

        .sd-run-progress-label {
            font-size: 0.82rem;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 7px;
            flex: 1;
        }

        .sd-run-progress-pct {
            font-size: 0.9rem;
            font-weight: 700;
            color: #4ade80;
            min-width: 42px;
            text-align: right;
            font-family: monospace;
            transition: color 0.3s ease;
        }

        .sd-run-progress-track {
            height: 10px;
            background: #252535;
            border-radius: 5px;
            overflow: hidden;
        }

        .sd-run-progress-bar {
            height: 100%;
            width: 0%;
            border-radius: 5px;
            transition: width 0.6s ease, background 0.3s ease;
        }

        /* ממתין על 50% עם shimmer */
        .sd-run-progress-bar.running {
            background: linear-gradient(
                90deg,
                #16a34a 0%,
                #4ade80 50%,
                #16a34a 100%
            );
            background-size: 200% 100%;
            animation: sdProgressShimmer 1.8s linear infinite;
        }

        /* הצלחה */
        .sd-run-progress-bar.success {
            background: #22c55e;
            animation: none;
        }

        /* שגיאה */
        .sd-run-progress-bar.error {
            background: #ef4444;
            animation: none;
        }

        @keyframes sdProgressShimmer {
            0%   { background-position:  200% 0; }
            100% { background-position: -200% 0; }
        }

        /* ===== כפתור CloudBeat Link ===== */
        .sd-tap-cblink-btn {
            background: #1a2e1a;
            border-color: #2a7a2a;
            color: #4ade80;
            text-decoration: none;
        }
        .sd-tap-cblink-btn:hover {
            background: #254a25;
            color: #86efac;
        }

        /* ===== sd-tap-run-btn-disabled (חסר) ===== */
        .sd-tap-run-btn-disabled {
            opacity: 0.45;
            cursor: not-allowed !important;
            pointer-events: none;
        }

        /* ===== sd-tap-status (חסר) ===== */
        .sd-tap-status {
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .sd-tap-status.passed { color: #22c55e; }
        .sd-tap-status.failed { color: #ef4444; }

        /* ===== sd-mp-cbid-badge / sd-mp-cbid-empty (חסרים) ===== */
        .sd-mp-cbid-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.78rem;
            color: #4ade80;
            font-family: monospace;
        }
        .sd-mp-cbid-empty {
            color: #444;
            font-size: 0.85rem;
        }
        /* ===== כפתור Run All ===== */
        .sd-run-all-btn {
            background: linear-gradient(135deg, #1e3a1e, #1a4a1a);
            border: 1px solid #2a9f2a;
            border-radius: 6px;
            color: #4ade80;
            cursor: pointer;
            padding: 5px 14px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            font-weight: 600;
            box-shadow: 0 0 8px rgba(74, 222, 128, 0.15);
        }
        .sd-run-all-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, #254a25, #1e5a1e);
            color: #86efac;
            box-shadow: 0 0 12px rgba(74, 222, 128, 0.3);
        }
        .sd-run-all-btn:disabled,
        .sd-run-all-btn.sd-run-all-btn-cooldown {
            opacity: 0.6;
            cursor: not-allowed;
            background: #252535;
            border-color: #3a3a5a;
            color: #888;
            box-shadow: none;
        }

        /* ===== פופאפ Run All ===== */
        .sd-run-all-popup {
            background: #1a1a2e;
            border: 1px solid #2a7a2a;
            border-radius: 10px;
            width: 90%;
            max-width: 480px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: rtl;
            animation: sdPopupIn 0.2s ease;
        }

        /* ===== Cooldown Banner ===== */
        .sd-run-all-cooldown-banner {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.3);
            border-radius: 8px;
            color: #fbbf24;
            font-size: 0.82rem;
        }
        .sd-run-all-cooldown-banner i {
            font-size: 1.4rem;
            flex-shrink: 0;
        }
        .sd-run-all-cooldown-title {
            font-weight: 600;
            margin-bottom: 2px;
        }
        .sd-run-all-cooldown-sub {
            color: #d97706;
            font-size: 0.78rem;
        }

        /* ===== Last Run Row ===== */
        .sd-run-all-last-run {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #1a1a2a;
            border-radius: 6px;
            border: 1px solid #2a2a4e;
            margin-top: 4px;
        }

        /* ===== Runner Info ===== */
        .sd-run-all-runner-info {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 8px 12px;
            background: #1a1a2a;
            border-radius: 6px;
            border: 1px dashed #2a2a4e;
            font-size: 0.8rem;
            color: #888;
            margin-top: 4px;
        }

        /* ===== כרטיסי מריץ ב-Run All ===== */
        .sd-run-all-runner-card {
            flex: 1;
            min-width: 160px;
            padding: 14px 16px;
            background: #252535;
            border: 2px solid #3a3a5a;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            text-align: center;
            position: relative;
            user-select: none;
        }
        .sd-run-all-runner-card:hover {
            background: #2a2a45;
            border-color: #4ade80;
        }
        .sd-run-all-runner-card.selected {
            background: rgba(74, 222, 128, 0.1);
            border-color: #4ade80;
        }
        /* ===== מפריד Post-Patch ===== */
        .sd-patch-divider {
            grid-column: 1 / -1;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px 16px;
            margin: 8px 0 4px 0;
            position: relative;
        }

        .sd-patch-divider-line {
            flex: 1;
            height: 2px;
            background: linear-gradient(
                90deg,
                transparent,
                rgba(167, 139, 250, 0.6),
                transparent
            );
        }

        .sd-patch-divider-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.78rem;
            font-weight: 700;
            color: #a78bfa;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            white-space: nowrap;
            padding: 6px 18px;
            background: rgba(167, 139, 250, 0.12);
            border: 1px solid rgba(167, 139, 250, 0.4);
            border-radius: 20px;
            box-shadow: 0 0 16px rgba(167, 139, 250, 0.15);
        }

        .sd-patch-divider-count {
            background: rgba(167, 139, 250, 0.3);
            color: #c4b5fd;
            border-radius: 10px;
            padding: 1px 8px;
            font-size: 0.7rem;
            font-weight: 700;
        }

        /* *** רמז לפתיחה *** */
        .sd-patch-divider-hint {
            font-size: 0.68rem;
            color: rgba(167, 139, 250, 0.6);
            font-weight: 400;
            letter-spacing: 0.02em;
            display: flex;
            align-items: center;
            gap: 3px;
            border-right: 1px solid rgba(167, 139, 250, 0.3);
            padding-right: 8px;
            margin-right: 2px;
        }

        /* ===== מפריד Patch — ניתן ללחיצה ===== */
        .sd-patch-divider-clickable {
            cursor: pointer;
            transition: all 0.2s;
        }
        .sd-patch-divider-clickable:hover {
            background: rgba(167, 139, 250, 0.2);
            border-color: rgba(167, 139, 250, 0.6);
            box-shadow: 0 0 20px rgba(167, 139, 250, 0.25);
            transform: scale(1.02);
        }
        .sd-patch-divider-clickable:active {
            transform: scale(0.98);
        }

        .sd-patch-divider-toggle-icon {
            font-size: 0.7rem;
            color: rgba(167, 139, 250, 0.7);
            margin-right: 2px;
            transition: transform 0.2s;
        }

        /* ===== כותרת עמודת Patch — עיצוב מיוחד ===== */
        .sd-col-header.sd-col-header-patch.good {
            background: linear-gradient(
                135deg,
                #1e1a2e,
                rgba(167, 139, 250, 0.12)
            );
            border-bottom: 2px solid #a78bfa;
            border-top: 1px solid rgba(167, 139, 250, 0.2);
        }

        .sd-col-header.sd-col-header-patch.bad {
            background: linear-gradient(
                135deg,
                #2a1a2e,
                rgba(167, 139, 250, 0.08)
            );
            border-bottom: 2px solid #a78bfa;
            border-top: 1px solid rgba(167, 139, 250, 0.2);
        }

        /* *** עמודת Patch סגורה — הצג רמז *** */
        .sd-column:has(.sd-col-header-patch.sd-collapsed) {
            opacity: 0.85;
            transition: opacity 0.2s;
        }
        .sd-column:has(.sd-col-header-patch.sd-collapsed):hover {
            opacity: 1;
        }

        /* ===== סוויטה ישנה (לא רצה יותר מ-12 שעות) ===== */
        .sd-column-stale .sd-test-card {
            opacity: 0.5;
            filter: saturate(0.5);
        }

        .sd-column-stale .sd-test-card:hover {
            opacity: 0.6;
            filter: saturate(0.75);
        }

        .sd-column-stale .sd-compact-dot {
            opacity: 0.5;
            filter: saturate(0.5);
        }

        .sd-column-stale .sd-compact-dot:hover {
            opacity: 0.6;
            filter: saturate(0.75);
        }

        /* כותרת הסוויטה — גם היא דהויה */
        .sd-column-stale .sd-col-header {
            opacity: 0.6;
        }

        .sd-column-stale .sd-col-header:hover {
            opacity: 0.85;
        }

        /* ===== כותרת עמודת Patch ===== */
        .sd-col-header-patch.good {
            background: linear-gradient(
                135deg,
                #1a1a2e,
                rgba(167, 139, 250, 0.08)
            );
            border-bottom-color: #a78bfa;
        }
        .sd-col-header-patch.bad {
            background: linear-gradient(
                135deg,
                #2e1a1a,
                rgba(167, 139, 250, 0.06)
            );
            border-bottom-color: #a78bfa;
        }

        /* תג Patch בכותרת עמודה */
        .sd-col-patch-badge {
            font-size: 0.6rem;
            color: #a78bfa;
            background: rgba(167, 139, 250, 0.15);
            border: 1px solid rgba(167, 139, 250, 0.3);
            border-radius: 3px;
            padding: 1px 4px;
            flex-shrink: 0;
        }

        /* ===== תג Patch בטבלת ניהול ===== */
        .sd-mp-patch-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 0.72rem;
            color: #a78bfa;
            background: rgba(167, 139, 250, 0.15);
            border: 1px solid rgba(167, 139, 250, 0.3);
            border-radius: 4px;
            padding: 2px 7px;
        }

        /* ===== כפתור Patch בטבלת ניהול ===== */
        .sd-mp-patch-btn {
            background: none;
            border: 1px solid #2a2a4e;
            border-radius: 4px;
            cursor: pointer;
            padding: 3px 7px;
            font-size: 0.78rem;
            color: #444;
            transition: all 0.2s;
        }
        .sd-mp-patch-btn:hover {
            background: rgba(167, 139, 250, 0.1);
            border-color: #a78bfa;
            color: #a78bfa;
        }

        /* ===== Label Patch בטופס הוספה ===== */
        .sd-mp-patch-label {
            display: flex;
            align-items: center;
            cursor: pointer;
            user-select: none;
        }
        .sd-mp-patch-custom-chk {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 7px 12px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #666;
            font-size: 0.82rem;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .sd-mp-patch-label:hover .sd-mp-patch-custom-chk {
            border-color: #a78bfa;
            color: #a78bfa;
        }
        .sd-mp-patch-checked .sd-mp-patch-custom-chk {
            background: rgba(167, 139, 250, 0.12);
            border-color: #a78bfa;
            color: #a78bfa;
        }

        /* מצב צפייה בלבד */
        .sd-readonly .sd-tap-action-btn,
        .sd-readonly .sd-suite-info-btn,
        .sd-readonly .sd-contact-edit-btn,
        .sd-readonly .sd-contact-del-btn,
        .sd-readonly .sd-manage-btn {
        pointer-events: none !important;
        opacity: 0.4;
        cursor: not-allowed !important;
        }

        .sd-readonly a {
        pointer-events: none !important;
        cursor: not-allowed !important;
        opacity: 0.4;
        }

        /* ===================================================
        מפריד טבלת מערכות לילה — בין סוויטות לפאצ'
        =================================================== */

        .sd-downtime-divider {
            grid-column: 1 / -1;
            display: flex;
            flex-direction: column;
            margin: 6px 0;
        }

        /* ===== כותרת המפריד — ניתנת ללחיצה ===== */
        .sd-downtime-divider-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 16px;
            cursor: pointer;
            user-select: none;
            transition: background 0.2s;
            border-radius: 8px;
        }
        .sd-downtime-divider-header:hover {
            background: rgba(251, 191, 36, 0.05);
        }
        .sd-downtime-divider-header:active {
            background: rgba(251, 191, 36, 0.1);
        }

        /* קו מפריד משני הצדדים */
        .sd-downtime-divider-line {
            flex: 1;
            height: 1px;
            background: linear-gradient(
                90deg,
                transparent,
                rgba(251, 191, 36, 0.4),
                transparent
            );
        }

        /* תווית המרכז */
        .sd-downtime-divider-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.78rem;
            font-weight: 700;
            color: #fbbf24;
            text-transform: uppercase;
            letter-spacing: 0.07em;
            white-space: nowrap;
            padding: 6px 18px;
            background: rgba(251, 191, 36, 0.08);
            border: 1px solid rgba(251, 191, 36, 0.3);
            border-radius: 20px;
            box-shadow: 0 0 14px rgba(251, 191, 36, 0.1);
            transition: all 0.2s;
            direction: rtl;
        }
        .sd-downtime-divider-header:hover
        .sd-downtime-divider-label {
            background: rgba(251, 191, 36, 0.14);
            border-color: rgba(251, 191, 36, 0.55);
            box-shadow: 0 0 20px rgba(251, 191, 36, 0.2);
        }

        /* תג מספר מערכות */
        .sd-downtime-divider-count {
            background: rgba(251, 191, 36, 0.2);
            color: #fde68a;
            border-radius: 10px;
            padding: 1px 8px;
            font-size: 0.7rem;
            font-weight: 700;
        }

        /* אייקון toggle */
        .sd-downtime-divider-toggle {
            font-size: 0.7rem;
            color: rgba(251, 191, 36, 0.7);
            transition: transform 0.25s ease;
            display: flex;
            align-items: center;
        }

        /* ===== גוף הטבלה ===== */
        .sd-downtime-divider-body {
            padding: 12px 8px 16px 8px;
            overflow: hidden;
        }

        .sd-downtime-body-hidden {
            display: none !important;
        }

        /* ===== גריד 4 עמודות ===== */
        .sd-dt-inner {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
            direction: rtl;
        }

        .sd-dt-col {
            min-width: 0;
            background: #161622;
            border: 1px solid #1e1e3a;
            border-radius: 8px;
            overflow: hidden;
        }

        /* ===== טבלה ===== */
        .sd-dt-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.75rem;
            direction: ltr;
        }

        .sd-dt-table thead tr {
            background: linear-gradient(
                135deg,
                rgba(251, 191, 36, 0.12),
                rgba(251, 191, 36, 0.06)
            );
        }

        .sd-dt-table th {
            color: #fbbf24;
            padding: 7px 10px;
            text-align: center;
            border-bottom: 1px solid rgba(251, 191, 36, 0.25);
            font-weight: 700;
            font-size: 0.7rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
        }

        .sd-dt-table td {
            padding: 5px 10px;
            border-bottom: 1px solid #1a1a2e;
            vertical-align: middle;
            transition: background 0.12s;
            text-align: center;
        }

        .sd-dt-table tr:last-child td {
            border-bottom: none;
        }

        .sd-dt-table tr:hover td {
            background: rgba(251, 191, 36, 0.05);
        }

        .sd-dt-table tr.sd-dt-even td {
            background: rgba(255, 255, 255, 0.015);
        }
        .sd-dt-table tr.sd-dt-even:hover td {
            background: rgba(251, 191, 36, 0.05);
        }

        /* עמודת שם באנגלית */
        .sd-dt-en {
            font-family: 'Consolas', 'Courier New', monospace;
            font-size: 0.68rem;
            color: #7ab3ef;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 160px;
        }

        /* עמודת מספר */
        .sd-dt-num {
            text-align: center;
            font-weight: 700;
            color: #fbbf24;
            font-size: 0.75rem;
            min-width: 32px;
            width: 36px;
        }

        /* עמודת שם בעברית */
        .sd-dt-he {
            color: #ddd;
            font-size: 0.73rem;
            direction: rtl;
        }

        /* ===== Responsive ===== */
        @media (max-width: 1400px) {
            .sd-dt-inner {
                grid-template-columns: repeat(2, 1fr);
            }
        }
        @media (max-width: 800px) {
            .sd-dt-inner {
                grid-template-columns: 1fr;
            }
        }

        /* Scrollbar */
        .sd-downtime-divider-body::-webkit-scrollbar {
            height: 4px;
        }
        .sd-downtime-divider-body::-webkit-scrollbar-track {
            background: transparent;
        }
        .sd-downtime-divider-body::-webkit-scrollbar-thumb {
            background: rgba(251, 191, 36, 0.3);
            border-radius: 2px;
        }
        .sd-export-btn {
            background: #123566;
            border: 1px solid #2c2e81;
            border-radius: 6px;
            color: #a0abd6;
            cursor: pointer;
            padding: 5px 12px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            position: relative;
            left: 6px;
        }
        .sd-export-btn:hover {
            background: #1b447f;
            color: #dbe4ff;
            border-color: #355fa8;
        }

        /* ===== List View ===== */
        .sd-view-mode-btn {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            padding: 5px 12px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            position: relative;
            left: 6px;
        }
        .sd-view-mode-btn:hover {
            background: #303050;
            color: #ccc;
        }
        .sd-view-mode-btn.active {
            background: rgba(122, 179, 239, 0.15);
            border-color: #7ab3ef;
            color: #7ab3ef;
        }

        /* ===== List View — Tests Table ===== */
        .sd-list-view {
            width: 100%;
            padding: 12px 16px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }

        /* סיכום כללי */
        .sd-list-summary {
            display: flex;
            gap: 16px;
            padding: 14px 20px;
            background: #1a1a2e;
            border: 1px solid #2a2a4e;
            border-radius: 10px;
            flex-wrap: wrap;
        }

        .sd-list-summary-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 3px;
            min-width: 70px;
        }

        .sd-list-summary-num {
            font-size: 1.6rem;
            font-weight: 700;
            line-height: 1.1;
            font-family: monospace;
        }

        .sd-list-summary-label {
            font-size: 0.7rem;
            color: #555;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        /* עטיפת הטבלה */
        .sd-list-table-wrap {
            overflow-x: auto;
            border-radius: 8px;
            border: 1px solid #2a2a4e;
        }

        /* הטבלה עצמה */
        .sd-list-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: ltr;
        }

        /* כותרות */
        .sd-list-table thead tr {
            background: #16162a;
        }

        .sd-list-table th {
            color: #7ab3ef;
            padding: 9px 12px;
            text-align: left;
            border-bottom: 2px solid #2a2a4e;
            font-weight: 700;
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            white-space: nowrap;
            position: sticky;
            top: 0;
            z-index: 2;
            background: #16162a;
        }

        /* רוחב עמודות */
        .sd-list-th-suite    { min-width: 180px; }
        .sd-list-th-team     { min-width: 90px;  }
        .sd-list-th-browser  { min-width: 90px;  }
        .sd-list-th-test     { min-width: 220px; }
        .sd-list-th-status   { min-width: 90px;  }
        .sd-list-th-priority { min-width: 70px;  }
        .sd-list-th-duration { min-width: 80px;  }
        .sd-list-th-lastrun  { min-width: 90px;  }
        .sd-list-th-rate     { min-width: 130px; }

        /* תאים */
        .sd-list-table td {
            padding: 6px 12px;
            border-bottom: 1px solid #1a1a2e;
            vertical-align: middle;
            color: #ccc;
        }

        /* שורה */
        .sd-list-row {
            cursor: pointer;
            transition: background 0.12s;
        }

        .sd-list-row:hover td {
            background: rgba(255, 255, 255, 0.03);
        }

        /* שורה ראשונה של סוויטה — קו עליון בולט */
        .sd-list-row-suite-first td {
            border-top: 2px solid #2a2a4e;
        }

        /* שורה אחרונה של סוויטה */
        .sd-list-row-suite-last td {
            border-bottom: 2px solid #2a2a4e;
        }

        /* ===== שורות ישנות ב-List View ===== */
        .sd-list-row-stale td {
            opacity: 0.45;
            filter: saturate(0.25) brightness(0.8);
        }

        .sd-list-row-stale:hover td {
            opacity: 0.75;
            filter: saturate(0.45) brightness(0.9);
        }

        /* תא הסוויטה — דהוי גם הוא */
        .sd-list-row-stale .sd-list-td-suite {
            opacity: 0.45;
            filter: saturate(0.25) brightness(0.8);
        }

        .sd-list-row-stale:hover .sd-list-td-suite {
            opacity: 0.75;
            filter: saturate(0.45) brightness(0.9);
        }

        /* צבע רקע לפי סטטוס */
        .sd-list-row.passed:hover td {
            background: rgba(34, 197, 94, 0.04);
        }
        .sd-list-row.failed:hover td {
            background: rgba(239, 68, 68, 0.04);
        }

        /* ===== תא סוויטה ===== */
        .sd-list-td-suite {
            background: #161622 !important;
            border-right: 2px solid #2a2a4e !important;
            vertical-align: top !important;
            padding-top: 10px !important;
            cursor: pointer;
        }

        .sd-list-td-suite:hover {
            background: rgba(122, 179, 239, 0.07) !important;
        }

        .sd-list-suite-cell {
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 0;
        }

        .sd-list-suite-name {
            font-size: 0.78rem;
            font-weight: 700;
            color: #bbb;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 320px;
            min-width: 250px;
            display: block;
        }

        /* סטטיסטיקות מיני בתא סוויטה */
        .sd-list-suite-stats {
            display: flex;
            align-items: center;
            gap: 2px;
            font-size: 0.7rem;
        }

        .sd-list-suite-stat-passed { color: #22c55e; font-weight: 700; }
        .sd-list-suite-stat-failed { color: #ef4444; font-weight: 700; }
        .sd-list-suite-stat-total  { color: #888; }
        .sd-list-suite-stat-sep    { color: #444; }

        /* אייקון Patch */
        .sd-list-patch-icon {
            color: #a78bfa;
            font-size: 0.65rem;
            flex-shrink: 0;
        }

        /* ===== תא Team / Browser ===== */
        .sd-list-td-team,
        .sd-list-td-browser {
            background: #161622 !important;
            border-right: 1px solid #1e1e3a !important;
            color: #777 !important;
            font-size: 0.75rem;
            vertical-align: top !important;
            padding-top: 10px !important;
        }

        .sd-list-td-browser {
            max-width: 20px;
        }

        .sd-list-browser-icon {
            color: #444;
            font-size: 0.65rem;
            margin-left: 3px;
        }

        /* ===== תא שם טסט ===== */
        .sd-list-td-test {
            max-width: 380px;
        }

        .sd-list-test-cell {
            display: flex;
            align-items: center;
            gap: 7px;
            min-width: 0;
        }

        .sd-list-test-name {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            font-size: 0.8rem;
            color: #ddd;
        }

        /* ===== אייקון סטטוס ===== */
        .sd-list-status-icon {
            font-size: 0.75rem;
            flex-shrink: 0;
        }
        .sd-list-status-icon.passed  { color: #22c55e; }
        .sd-list-status-icon.failed  { color: #ef4444; }
        .sd-list-status-icon.unknown { color: #666;    }

        /* ===== תג סטטוס ===== */
        .sd-list-status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.72rem;
            font-weight: 600;
            white-space: nowrap;
        }

        .sd-list-status-badge.passed {
            background: rgba(34, 197, 94, 0.12);
            color: #22c55e;
            border: 1px solid rgba(34, 197, 94, 0.25);
        }
        .sd-list-status-badge.failed {
            background: rgba(239, 68, 68, 0.12);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.25);
        }
        .sd-list-status-badge.warning {
            background: rgba(217, 119, 6, 0.15);
            color: #d97706;
            border: 1px solid rgba(217, 119, 6, 0.35);
        }

        .sd-list-status-icon.warning {
            color: #d97706;
        }

        .sd-list-row.warning:hover td {
            background: rgba(217, 119, 6, 0.04);
        }
        .sd-list-status-badge.unknown {
            background: rgba(100, 100, 100, 0.12);
            color: #888;
            border: 1px solid #333;
        }

        /* ===== עדיפות ===== */
        .sd-list-priority {
            font-size: 0.68rem;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 3px;
            text-transform: uppercase;
        }
        .sd-list-priority.p1 {
            background: rgba(239, 68, 68, 0.2);
            color: #fca5a5;
        }
        .sd-list-priority.p2 {
            background: rgba(245, 158, 11, 0.2);
            color: #fde68a;
        }
        .sd-list-priority.p0 {
            background: rgba(99, 102, 241, 0.2);
            color: #c7d2fe;
        }
        .sd-list-priority-empty {
            color: #444;
            font-size: 0.8rem;
        }

        /* ===== משך ===== */
        .sd-list-td-duration {
            white-space: nowrap;
            color: #888;
            font-size: 0.78rem;
        }
        .sd-list-clock-icon {
            color: #555;
            font-size: 0.65rem;
            margin-left: 3px;
        }

        /* ===== זמן ריצה ===== */
        .sd-list-td-lastrun {
            color: #666;
            font-size: 0.75rem;
            white-space: nowrap;
        }
        .sd-list-td-lastrun-old {
            font-weight: 800 !important;
        }

        /* ===== אחוז הצלחה ===== */
        .sd-list-td-rate {
            vertical-align: middle !important;
        }

        .sd-list-rate-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 110px;
        }

        .sd-list-rate-bar-track {
            flex: 1;
            height: 6px;
            background: #252535;
            border-radius: 3px;
            overflow: hidden;
        }

        .sd-list-rate-bar {
            height: 100%;
            border-radius: 3px;
            transition: width 0.4s ease;
            min-width: 2px;
        }

        /* ===== שורת סוויטה ריקה ===== */
        .sd-list-td-no-tests {
            color: #444;
            font-size: 0.75rem;
            font-style: italic;
        }
        .sd-list-td-no-tests i {
            margin-left: 5px;
            color: #333;
        }

        /* ===== אייקון מייל בשורת טסט ===== */
        .sd-list-mail-icon {
            display: inline-flex;
            align-items: center;
            color: rgba(239, 68, 68, 0.5);
            font-size: 0.65rem;
            text-decoration: none;
            padding: 2px 4px;
            border-radius: 3px;
            transition: all 0.15s;
            flex-shrink: 0;
        }
        .sd-list-mail-icon:hover {
            color: #f87171;
            background: rgba(239, 68, 68, 0.1);
            transform: scale(1.2);
        }

        /* ===== Scrollbar ===== */
        .sd-list-table-wrap::-webkit-scrollbar       { height: 5px; width: 5px; }
        .sd-list-table-wrap::-webkit-scrollbar-track { background: #111; }
        .sd-list-table-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        /* ===== באנר מצב חיפוש ===== */
        .sd-search-banner {
            display: flex;
            align-items: center;
            gap: 3px;
            padding: 6px 8px;
            background: linear-gradient(
                135deg,
                rgba(234, 179, 8, 0.12),
                rgba(234, 179, 8, 0.06)
            );
            border-bottom: 2px solid rgba(234, 179, 8, 0.4);
            border-top: 1px solid rgba(234, 179, 8, 0.2);
            font-size: 0.82rem;
            color: #fbbf24;
            animation: sdBannerIn 0.25s ease;
            flex-wrap: wrap;
        }

        @keyframes sdBannerIn {
            from { opacity: 0; transform: translateY(-6px); }
            to   { opacity: 1; transform: translateY(0);    }
        }

        .sd-search-banner i {
            font-size: 0.85rem;
            color: #fbbf24;
            flex-shrink: 0;
        }

        .sd-search-banner-term {
            font-weight: 700;
            color: #fde68a;
            background: rgba(234, 179, 8, 0.15);
            border: 1px solid rgba(234, 179, 8, 0.3);
            border-radius: 4px;
            padding: 1px 6px;
            font-family: monospace;
            font-size: 0.85rem;
        }

        .sd-search-banner-clear {
            background: rgba(234, 179, 8, 0.15);
            border: 1px solid rgba(234, 179, 8, 0.35);
            border-radius: 5px;
            color: #fbbf24;
            cursor: pointer;
            padding: 3px 10px;
            font-size: 0.78rem;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
            margin-right: auto;
        }
        .sd-search-banner-clear:hover {
            background: rgba(234, 179, 8, 0.28);
            color: #fde68a;
            border-color: rgba(234, 179, 8, 0.6);
        }

        /* ===== שדה חיפוש פעיל — הדגשה צהובה ===== */
        .sd-search-input.sd-search-active {
            border-color: #eab308 !important;
            background: rgba(234, 179, 8, 0.06) !important;
            color: #fde68a !important;
            box-shadow: 0 0 0 2px rgba(234, 179, 8, 0.15);
            transition: all 0.25s ease;
        }

        .sd-search-input.sd-search-active::placeholder {
            color: rgba(234, 179, 8, 0.4);
        }

        /* ===== עטיפת חיפוש פעילה ===== */
        .sd-search-wrap-active .sd-search-icon {
            color: #eab308 !important;
            transition: color 0.25s ease;
        }

        .sd-search-wrap-active .sd-clear-search {
            color: #eab308 !important;
        }
        .sd-search-wrap-active .sd-clear-search:hover {
            color: #fde68a !important;
        }
        .sd-list-night-icon {
            color: #fbbf24;
            font-size: 0.75rem;
            opacity: 0.85;
            transition: opacity 0.2s, transform 0.2s;
            display: inline-block;
        }

        .sd-list-row:hover .sd-list-night-icon {
            opacity: 1;
            transform: scale(1.2);
        }

        .sd-email-report-btn {
            background: #1e2e4a;
            border: 1px solid #2a4a8a;
            border-radius: 6px;
            color: #7ab3ef;
            cursor: pointer;
            padding: 5px 12px;
            font-size: 0.82rem;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .sd-email-report-btn:hover {
            background: #253a5a;
            color: #aad4ff;
        }
        /* ===== פופאפ בחירת Export ===== */
        .sd-export-choice-popup {
            background: #1a1a2e;
            border: 1px solid #2a5a9f;
            border-radius: 10px;
            width: 90%;
            max-width: 420px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            direction: ltr;
            animation: sdPopupIn 0.2s ease;
        }

        .sd-export-choice-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .sd-export-choice-desc {
            font-size: 0.85rem;
            color: #888;
            margin: 0;
            text-align: center;
        }

        .sd-export-choice-options {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .sd-export-choice-btn {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 16px 18px;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            text-align: left;
            width: 100%;
            border: 2px solid transparent;
            position: relative;
        }

        .sd-export-choice-btn.excel {
            background: rgba(34, 197, 94, 0.08);
            border-color: rgba(34, 197, 94, 0.25);
            color: #4ade80;
        }
        .sd-export-choice-btn.excel:hover {
            background: rgba(34, 197, 94, 0.15);
            border-color: rgba(34, 197, 94, 0.5);
            transform: translateX(-3px);
            box-shadow: 4px 0 16px rgba(34, 197, 94, 0.15);
        }

        .sd-export-choice-btn.email {
            background: rgba(122, 179, 239, 0.08);
            border-color: rgba(122, 179, 239, 0.25);
            color: #7ab3ef;
        }
        .sd-export-choice-btn.email:hover {
            background: rgba(122, 179, 239, 0.15);
            border-color: rgba(122, 179, 239, 0.5);
            transform: translateX(-3px);
            box-shadow: 4px 0 16px rgba(122, 179, 239, 0.15);
        }

        .sd-export-choice-icon {
            font-size: 1.8rem;
            flex-shrink: 0;
            width: 44px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .sd-export-choice-info {
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }

        .sd-export-choice-title {
            font-size: 0.92rem;
            font-weight: 700;
        }

        .sd-export-choice-sub {
            font-size: 0.75rem;
            opacity: 0.65;
        }

        .sd-export-choice-arrow {
            font-size: 0.75rem;
            opacity: 0.4;
            flex-shrink: 0;
            transition: opacity 0.2s, transform 0.2s;
        }

        .sd-export-choice-btn:hover .sd-export-choice-arrow {
            opacity: 0.8;
            transform: translateX(-3px);
        }
        /* ===== כפתור ניהול מערכות לילה ===== */
        .sd-dt-manage-btn {
            background: rgba(251,191,36,0.15);
            border: 1px solid rgba(251,191,36,0.4);
            border-radius: 5px;
            color: #fbbf24;
            cursor: pointer;
            padding: 2px 8px;
            font-size: 0.72rem;
            transition: all 0.2s;
            margin-right: 4px;
        }
        .sd-dt-manage-btn:hover {
            background: rgba(251,191,36,0.28);
            border-color: rgba(251,191,36,0.7);
        }
        /* ===== תא סיכום במצב Collapsed ב-List View ===== */
        .sd-list-td-collapsed-summary {
            padding: 8px 14px !important;
            background: rgba(255,255,255,0.02) !important;
            border-right: 1px dashed #2a2a4e !important;
            vertical-align: middle !important;
        }
        /* ===== תא סיכום במצב Collapsed ===== */
        .sd-list-td-collapsed-summary {
            padding: 8px 14px !important;
            background: rgba(255,255,255,0.02) !important;
            border-right: 1px dashed #2a2a4e !important;
            vertical-align: middle !important;
            transition: background 0.15s;
        }

        .sd-list-td-collapsed-summary:hover {
            background: rgba(122, 179, 239, 0.07) !important;
        }

        .sd-list-collapsed-summary-inner {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.78rem;
        }

        .sd-list-collapsed-icon {
            color: #555;
            font-size: 0.65rem;
            flex-shrink: 0;
            transition: color 0.15s, transform 0.2s;
        }

        .sd-list-td-collapsed-summary:hover
        .sd-list-collapsed-icon {
            color: #7ab3ef;
            transform: translateY(2px);
        }

        .sd-list-collapsed-suite-name {
            color: #aaa;
            font-weight: 600;
        }

        .sd-list-collapsed-hint {
            color: #555;
            font-style: italic;
            font-size: 0.72rem;
        }

        .sd-list-td-collapsed-summary:hover
        .sd-list-collapsed-hint {
            color: #7ab3ef;
        }

        /* ===== אנימציית פתיחה ===== */
        .sd-list-row-just-expanded td {
            animation: sdRowExpand 1.5s ease forwards;
        }

        @keyframes sdRowExpand {
            0%   { background: rgba(122, 179, 239, 0.18); }
            100% { background: transparent; }
        }
        /* ===== List View — Suite Cell Inline (חדש) ===== */

        /* תא הסוויטה — עכשיו שורה אחת עם הכל */
        .sd-list-suite-cell-inline {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: nowrap;
            min-width: 0;
            width: 100%;
        }

        /* כפתור collapse לסוויטה בודדת */
        .sd-list-suite-collapse-btn {
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 0.65rem;
            flex-shrink: 0;
            transition: all 0.2s;
            line-height: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
        }
        .sd-list-suite-collapse-btn:hover {
            background: rgba(255,255,255,0.1);
            color: #aaa;
        }

        /* סטטיסטיקות inline בתא הסוויטה */
        .sd-list-suite-stats-inline {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            font-size: 0.68rem;
            flex-shrink: 0;
            background: rgba(255,255,255,0.04);
            border: 1px solid #2a2a4e;
            border-radius: 4px;
            padding: 1px 5px;
        }

        /* Team inline */
        .sd-list-suite-team-inline {
            font-size: 0.68rem;
            color: #666;
            flex-shrink: 0;
            white-space: nowrap;
            border-right: 1px solid #2a2a4e;
            padding-right: 6px;
            margin-right: 0;
        }

        /* Browser inline */
        .sd-list-suite-browser-inline {
            font-size: 0.68rem;
            color: #555;
            flex-shrink: 0;
            white-space: nowrap;
            display: flex;
            align-items: center;
            gap: 3px;
        }

        /* שם הסוויטה — קצת יותר קצר כי יש עוד מידע בשורה */
        .sd-list-td-suite .sd-list-suite-name {
            font-size: 0.78rem;
            font-weight: 700;
            color: #bbb;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 200px;
            min-width: 100px;
            flex: 1;
        }

        /* שורה מקורסת — הדגשה קלה */
        .sd-list-row-suite-collapsed .sd-list-td-suite {
            background: rgba(122, 179, 239, 0.04) !important;
            border-bottom: 1px solid #2a2a4e !important;
        }

        .sd-list-row-suite-collapsed .sd-list-suite-collapse-btn {
            color: #7ab3ef;
        }

        /* הסתרת עמודות Team ו-Browser הנפרדות כי הן עכשיו inline */
        .sd-list-th-team,
        .sd-list-th-browser,
        .sd-list-td-team,
        .sd-list-td-browser {
            display: none !important;
        }
        /* ===== תא סיכום במצב Collapsed ===== */
        .sd-list-td-collapsed-summary {
            padding: 8px 14px !important;
            background: rgba(255,255,255,0.02) !important;
            border-right: 1px dashed #2a2a4e !important;
            vertical-align: middle !important;
            transition: background 0.15s;
            /* *** וודא שהתא מתפרס על כל הרוחב הנכון *** */
            min-width: 0;
            max-width: none;
        }

        .sd-list-td-collapsed-summary:hover {
            background: rgba(122, 179, 239, 0.07) !important;
        }

        .sd-list-collapsed-summary-inner {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.78rem;
            /* *** מנע גלישה *** */
            overflow: hidden;
            white-space: nowrap;
        }

        .sd-list-collapsed-icon {
            color: #555;
            font-size: 0.65rem;
            flex-shrink: 0;
            transition: color 0.15s, transform 0.2s;
        }

        .sd-list-td-collapsed-summary:hover .sd-list-collapsed-icon {
            color: #7ab3ef;
            transform: translateY(2px);
        }

        .sd-list-collapsed-suite-name {
            color: #aaa;
            font-weight: 600;
        }

        .sd-list-collapsed-hint {
            color: #555;
            font-style: italic;
            font-size: 0.72rem;
        }

        .sd-list-td-collapsed-summary:hover .sd-list-collapsed-hint {
            color: #7ab3ef;
        }
        /* ===== Triggered Info Banner ===== */
        .sd-run-all-triggered-info {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 14px;
            background: rgba(156, 163, 175, 0.08);
            border: 1px solid rgba(156, 163, 175, 0.2);
            border-radius: 8px;
            font-size: 0.8rem;
            color: #9ca3af;
        }

        .sd-run-all-triggered-info strong {
            color: #d1d5db;
            font-weight: 600;
        }

        /* ===== Privileged Banner ===== */
        .sd-run-all-privileged-banner {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 14px;
            background: rgba(167, 139, 250, 0.08);
            border: 1px solid rgba(167, 139, 250, 0.25);
            border-radius: 8px;
            font-size: 0.82rem;
        }
        `;

        document.head.appendChild(style);
    }
}

// ==========================================
// רישום גלובלי
// ==========================================
window.suiteResultsDashboard = null;