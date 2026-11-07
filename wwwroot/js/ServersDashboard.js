// file: ServersDashboard.js
class ServersDashboard {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.allServers = [];
        this.filteredServers = [];
        this.searchTerm = '';
        this.filters = {
            environment: 'all',
            isVirtual: 'all',
            systemStatus: 'all',
            isHealthy: 'all',
            department: 'all',
            team: 'all',
            os: 'all',
            bigfixStatus: 'all',
            systemName: 'all',
            systemManager: 'all',
            bootType: 'all',
            domain: 'all',
            canShutdown: 'all',
            catalogNumber: 'all',
        };
        this.sortColumn = 'name'
        this.sortDirection = 'asc';
        this.currentPage = 1;
        this.pageSize = 50;
        this.viewMode = 'table'; // 'table' | 'cards' | 'stats'

        // ─── מפתחות localStorage ───
        this.LS_FILTERS = 'srvFilters_v1';
        this.LS_SORT = 'srvSort_v1';
        this.LS_VIEW = 'srvView_v1';
        this.LS_PAGE_SIZE = 'srvPageSize_v1';

        // ─── שחזר העדפות ───
        this._loadPreferences();

        this.isAdmin = false;
        this.currentUser = '';
        this.editingRow = null; // שם השרת שנערך כרגע

        // ─── Multi-Select ───
        this.selectedServers = new Set(); // שמות שרתים נבחרים
        this.multiSelectMode = false;

        // ─── BigFix ───
        this.bigFixData = {};        // מפה: serverName → BigFixStatus
        this.bigFixLoaded = false;
        this.bigFixLoading = false;
        this.bigFixError = null;
        this.BF_REFRESH_MS = 10 * 60 * 1000; // רענון כל 10 דקות

        this._pingCache = {};
        this._openFilterPopupKey = null;
    }

    // ══════════════════════════════════════════════════════════
    // אתחול
    // ══════════════════════════════════════════════════════════
    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container #${this.containerId} not found`);
            return;
        }
        this.addStyles();
        this.renderShell();
        this.bindEvents();
        await this.loadData();
        // ─── בדוק אם יש פילטר ממתין מקטלוג המערכות ───
        this._applyPendingFilter()

        // ─── טען BigFix בנפרד (לא חוסם את הטעינה הראשית) ───
        window._srvDashboard = this; // ← נדרש לכפתורי רענון
        this.loadBigFixData(false);  // ← טעינה ראשונית
        await this._loadCurrentUser();

    }

    // ══════════════════════════════════════════════════════════
    // החל פילטר ממתין (מניווט מקטלוג המערכות)
    // ══════════════════════════════════════════════════════════

    _applyPendingFilter() {
        const urlParams = new URLSearchParams(window.location.search);

        // ─── בדוק פילטר לפי מספר (עדיפות ראשונה) ───
        let filterNumber = urlParams.get('filterNumber')
            ? decodeURIComponent(urlParams.get('filterNumber'))
            : null;

        if (!filterNumber) {
            try {
                filterNumber = sessionStorage.getItem('sc_pending_filter_number');
                if (filterNumber) sessionStorage.removeItem('sc_pending_filter_number');
            } catch (e) { }
        }

        if (filterNumber) {
            // ─── מצא מערכת לפי מספר ───
            const system = this.allServers.find(s =>
                String(s.catalogNumber || '') === String(filterNumber)
            );

            if (system) {
                this.filters.catalogNumber = String(filterNumber);
            } else {
                // fallback - חפש לפי catalogNumber ישירות
                this.filters.catalogNumber = String(filterNumber);
            }

            this._savePreferences();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            setTimeout(() => {
                this.showToast(`🔍 מסנן לפי מספר קטלוג: ${filterNumber}`, 'info');
            }, 500);

            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        // ─── fallback: פילטר לפי שם ───
        let systemName = urlParams.get('filterSystem')
            ? decodeURIComponent(urlParams.get('filterSystem'))
            : null;

        if (!systemName) {
            try {
                systemName = sessionStorage.getItem('sc_pending_filter_name');
                if (systemName) sessionStorage.removeItem('sc_pending_filter_name');
            } catch (e) { }
        }

        if (!systemName) return;

        this.filters.name = systemName;
        this._savePreferences();
        this.applyFiltersAndSort();
        this.renderContent();
        this.updateStats();

        setTimeout(() => {
            this.showToast(`🔍 מסנן לפי מערכת: ${systemName}`, 'info');
        }, 500);

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ══════════════════════════════════════════════════════════
    // טעינת נתונים
    // ══════════════════════════════════════════════════════════
    async loadData(forceImport = false, buildFromSources = false) {
        try {
            this.showLoading(true);

            let url = '/Servers/GetServers';
            let method = 'GET';

            // ─── ייבוא מחדש מ-CSV ───
            if (forceImport) {
                url = '/Servers/ImportFromCsv';
                method = 'POST';
            }

            // ─── בנה מקבצי המקור (לוגיקת הטסט) ───
            if (buildFromSources) {
                url = '/Servers/BuildFromSources';
                method = 'POST';
            }

            const res = await fetch(url, {
                method,
                credentials: 'include'
            });
            const data = await res.json();

            if (!data.success) {
                this.showError(data.error || 'שגיאה בטעינת נתונים');
                return;
            }

            this.allServers = data.servers || [];
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this.showLoading(false);

            if (forceImport) {
                this.showToast(
                    `✅ יובאו ${data.count} שרתים מהקובץ`,
                    'success'
                );
            }

            if (buildFromSources) {
                this.showToast(
                    `✅ נבנו ${data.count} שרתים מקבצי המקור`,
                    'success'
                );
            }

        } catch (err) {
            console.error('loadData error:', err);
            this.showLoading(false);
            this.showError('שגיאה בטעינת הנתונים: ' + err.message);
        }
    }

    // ══════════════════════════════════════════════════════════
    // טעינת פרטי משתמש נוכחי
    // ══════════════════════════════════════════════════════════
    async _loadCurrentUser() {
        try {
            const res = await fetch('/Servers/GetCurrentUser', {
                credentials: 'include'
            });
            const data = await res.json();

            if (data.success) {
                this.isAdmin = data.isAdmin || false;
                this.isEditor = data.isEditor || false;
                this.currentUser = data.username || '';

                // ─── אדמינים קשיחים - לא ניתן להסיר ─────────────────
                this.systemAdmins = data.systemAdmins || [];

                // ─── אדמינים של הדשבורד - ניתן לנהל ─────────────────
                this.dashboardAdmins = data.admins || [];
            }

            this._updateAdminUI();

        } catch (err) {
            console.warn('_loadCurrentUser error:', err);
            this.isAdmin = false;
            this.isEditor = false;
            this.systemAdmins = [];
            this.dashboardAdmins = [];
        }
    }

    // ─── עדכן UI לפי הרשאות ──────────────────────────────────
    _updateAdminUI() {

        // ─── כפתורי אדמין בלבד ───
        const adminBtns = document.querySelectorAll('.srv-admin-only');
        adminBtns.forEach(btn => {
            btn.style.display = this.isAdmin ? 'flex' : 'none';
        });

        // ─── כפתורי עורך (אדמין + עורך) ───────────────────────
        const editorBtns = document.querySelectorAll('.srv-editor-only');
        editorBtns.forEach(btn => {
            btn.style.display =
                (this.isAdmin || this.isEditor) ? 'flex' : 'none';
        });

        // ─── badge ───
        const badge = document.getElementById('srvAdminBadge');
        if (badge) {
            badge.style.display =
                (this.isAdmin || this.isEditor) ? 'flex' : 'none';
            badge.title = `מחובר כ: ${this.currentUser}`;

            // ─── שנה צבע לפי רמת הרשאה ───
            if (this.isAdmin) {
                badge.style.background = 'rgba(245,158,11,0.15)';
                badge.style.borderColor = 'rgba(245,158,11,0.4)';
                badge.style.color = '#fcd34d';
                badge.innerHTML = `
                <i class="fas fa-shield-alt"></i> Admin`;
            } else if (this.isEditor) {
                badge.style.background = 'rgba(99,102,241,0.15)';
                badge.style.borderColor = 'rgba(99,102,241,0.4)';
                badge.style.color = '#a5b4fc';
                badge.innerHTML = `
                <i class="fas fa-edit"></i> Editor`;
            }
        }

        // ─── רענן תוכן כדי שכפתורי עריכה בשורות יופיעו ───
        if ((this.isAdmin || this.isEditor) && this.allServers.length > 0) {
            this.renderContent();
        }
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
    // Auto-fill ארגוני לכל הרשומות (Bulk)
    // ══════════════════════════════════════════════════════════════
    async _autoFillOrgInfoBulk() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לביצוע פעולה זו', 'error');
            return;
        }

        const managers = [...new Set(
            this.allServers
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
            }
            await new Promise(r => setTimeout(r, 80));
        }

        const FIELDS = ['team', 'department', 'domain'];
        const FIELD_LABELS = { team: 'צוות', department: 'מחלקה', domain: 'תחום' };

        const allRows = [];
        const plannedChanges = [];
        const notFoundManagersAdded = new Set();

        for (const srv of this.allServers) {
            const managerName = (srv.systemManager || '').trim();
            const orgInfo = managerOrgMap[managerName] || null;

            for (const field of FIELDS) {
                const oldVal = (srv[field] || '').trim();
                const newVal = orgInfo ? (orgInfo[field] || '').trim() : '';

                let status = '';
                if (!managerName) status = 'אין מנהל';
                else if (!orgInfo) status = 'מנהל לא נמצא';
                else if (!newVal) status = 'אין ערך חדש';
                else if (this._normalizeDeptValue(oldVal) === this._normalizeDeptValue(newVal))
                    status = 'זהה - אין שינוי';
                else if (!oldVal) status = 'מילוי חדש';
                else status = 'שינוי';

                allRows.push({
                    serverName: srv.name,
                    environment: srv.environment || '',
                    manager: managerName,
                    managerFound: orgInfo ? 'כן' : 'לא',
                    field: FIELD_LABELS[field],
                    fieldKey: field,
                    oldVal: oldVal || '',
                    newVal: newVal || '',
                    status,
                });

                if (!orgInfo && managerName && !notFoundManagersAdded.has(managerName)) {
                    notFoundManagersAdded.add(managerName);

                    plannedChanges.push({
                        serverName: srv.name,
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
                        serverName: srv.name,
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

        // ─── הצג מודל תצוגה מקדימה עם checkboxes ───
        const result = await this._showBulkPreviewModal(
            allRows, plannedChanges, fetchedCount, notFoundCount, notFoundList
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

        // ─── החל שינויים נבחרים בלבד ───
        let appliedCount = 0;
        for (const change of selectedChanges) {
            const srv = this.allServers.find(s => s.name === change.serverName);
            if (!srv) continue;
            srv[change.field] = change.newVal;
            appliedCount++;
        }

        try {
            this.showToast('שומר שינויים...', 'info');

            const res = await fetch('/Servers/SaveServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ servers: this.allServers })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'שגיאה בשמירה');

            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this._populateDropdownFilters();
            this._restoreFilterSelects();

            const affectedServers = new Set(selectedChanges.map(c => c.serverName)).size;
            this.showToast(
                `✅ עודכנו ${affectedServers} שרתים (${appliedCount} שינויים)`,
                'success'
            );

            if (result === 'apply_and_export') {
                await this._exportBulkToExcel(allRows, plannedChanges);
            }

        } catch (err) {
            console.error('שגיאה בשמירה:', err);
            this.showToast('שגיאה בשמירה: ' + err.message, 'error');

            // ─── Rollback - רק שינויים שהוחלו ───
            for (const change of selectedChanges) {
                const srv = this.allServers.find(s => s.name === change.serverName);
                if (srv) {
                    srv[change.field] = change.oldVal === '(ריק)' ? '' : change.oldVal;
                }
            }
        }
    }

    // ══════════════════════════════════════════════════════════════
    // מודל Preview מתוקן - עם Checkboxes לבחירת שינויים
    // ══════════════════════════════════════════════════════════════
    _showBulkPreviewModal(allRows, plannedChanges, fetchedCount, notFoundCount, notFoundList) {
        return new Promise(resolve => {
            const existing = document.getElementById('srvBulkPreviewModal');
            if (existing) existing.remove();

            // ─── שמור reference לשינויים (לעדכון checkboxes) ───
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
                    const cfg = statusColors[status] || { bg: 'rgba(255,255,255,0.05)', color: '#aaa', border: 'rgba(255,255,255,0.1)' };
                    return `
                <div style="display:flex;align-items:center;gap:8px;
                            padding:6px 12px;border-radius:8px;
                            background:${cfg.bg};border:1px solid ${cfg.border};
                            color:${cfg.color};font-size:0.8rem;font-weight:600;white-space:nowrap">
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

                // מפתח ייחודי: שדה + ערך ישן + ערך חדש
                const changeKey = `${change.field}||${change.oldVal}||${change.newVal}`;

                if (!changesByManager[mgr][changeKey]) {
                    changesByManager[mgr][changeKey] = {
                        field: change.field,
                        fieldLabel: change.fieldLabel,
                        oldVal: change.oldVal,
                        newVal: change.newVal,
                        manager: mgr,
                        indices: [],   // ← כל ה-globalIdx של שינויים זהים
                        selected: true,
                        infoOnly: change.infoOnly
                    };
                }
                changesByManager[mgr][changeKey].indices.push(globalIdx);
            });

            // ─── בנה מפה: groupKey → groupData (לשימוש ב-checkbox) ───
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
                    const isInfoOnlyManager = changeEntries.every(c => c.infoOnly);
                    const managerHeader = `
        <tr style="background:rgba(99,102,241,0.08);
                   border-bottom:1px solid rgba(99,102,241,0.2)">
           <td style="padding:6px 10px;width:32px">
                ${isInfoOnlyManager
                            ? `<i class="fas fa-exclamation-triangle"
                        style="color:#fca5a5"
                        title="מנהל לא נמצא"></i>`
                            : `<input type="checkbox"
                        class="srv-bulk-manager-cb"
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

                    const changeRows = changeEntries.map((c, entryIdx) => {
                        // ─── מפתח ייחודי לקבוצה ───
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
            modal.id = 'srvBulkPreviewModal';
            modal.className = 'srv-modal-overlay';

            modal.innerHTML = `
    <div class="srv-modal" style="max-width:1100px;width:96%">

        <!-- כותרת -->
        <div class="srv-modal-header" style="
            border-bottom:2px solid rgba(99,102,241,0.35);
            background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(124,58,237,0.05))">
            <h3 class="srv-modal-title">
                <i class="fas fa-magic" style="color:#6366f1"></i>
                Auto-fill ארגוני - תצוגה מקדימה
            </h3>
            <button class="srv-modal-close" id="srvBulkPreviewClose">&times;</button>
        </div>

        <!-- גוף -->
        <div class="srv-modal-body" style="max-height:70vh;overflow-y:auto;gap:14px;padding:16px 20px">

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
        <div class="srv-modal-footer" style="gap:8px;flex-wrap:wrap">
            <button class="srv-modal-cancel-btn" id="srvBulkPreviewCancel">
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
                    `.srv-bulk-change-row[data-idx="${idx}"]`
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
                    `.srv-bulk-manager-cb[data-manager="${CSS.escape(managerName)}"]`
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
                    const groupCb = e.target.closest('.srv-bulk-group-cb');
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
                            `.srv-bulk-group-row[data-group-key=
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
                    const managerCb = e.target.closest('.srv-bulk-manager-cb');
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
                            `.srv-bulk-group-cb[data-manager=
                    "${CSS.escape(managerName)}"]`
                        ).forEach(cb => {
                            cb.checked = isChecked;
                            const row = cb.closest('.srv-bulk-group-row');
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

                    document.querySelectorAll('.srv-bulk-group-cb').forEach(cb => {
                        cb.checked = isChecked;
                        const row = cb.closest('.srv-bulk-group-row');
                        if (row) row.style.opacity = isChecked ? '1' : '0.4';
                    });

                    document.querySelectorAll('.srv-bulk-manager-cb').forEach(cb => {
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
                    document.querySelectorAll('.srv-bulk-group-cb').forEach(cb => {
                        if (cb.dataset.infoOnly === 'true') return;

                        cb.checked = true;

                        const row = cb.closest('.srv-bulk-group-row');
                        if (row) row.style.opacity = '1';
                    });

                    document.querySelectorAll('.srv-bulk-manager-cb').forEach(cb => {
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
                    plannedChanges.forEach((change, idx) => {
                        change.selected = false;

                        const cb = document.querySelector(
                            `.srv-bulk-change-cb[data-idx="${idx}"]`
                        );
                        if (cb) cb.checked = false;

                        updateRowAppearance(idx, false);
                    });

                    document.querySelectorAll('.srv-bulk-manager-cb').forEach(cb => {
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

    // ══════════════════════════════════════════════════════════════
    // מודל אישור Bulk Auto-fill
    // ══════════════════════════════════════════════════════════════
    _showBulkConfirmModal(plannedChanges, fetchedCount, notFoundCount) {
        return new Promise(resolve => {
            const existing = document.getElementById('srvBulkConfirmModal');
            if (existing) existing.remove();

            const affectedServers = new Set(
                plannedChanges.map(c => c.serverName)
            ).size;

            // ─── קבץ לפי שדה לסיכום ──────────────────────────────
            const byField = {};
            plannedChanges.forEach(c => {
                byField[c.fieldLabel] = (byField[c.fieldLabel] || 0) + 1;
            });

            const fieldSummaryHtml = Object.entries(byField)
                .map(([label, count]) => `
                <div class="srv-bulk-field-row">
                    <span class="srv-bulk-field-label">${this.escHtml(label)}</span>
                    <span class="srv-bulk-field-count">${count} שינויים</span>
                </div>
            `).join('');

            // ─── דוגמאות שינויים (עד 8) ──────────────────────────
            const samplesHtml = plannedChanges.slice(0, 8).map(c => `
            <tr class="srv-bulk-sample-row">
                <td class="srv-bulk-sample-td"
                    title="${this.escHtml(c.serverName)}">
                    ${this.escHtml(c.serverName)}
                </td>
                <td class="srv-bulk-sample-td">
                    ${this.escHtml(c.fieldLabel)}
                </td>
                <td class="srv-bulk-sample-td srv-bulk-old-val">
                    ${this.escHtml(c.oldVal)}
                </td>
                <td class="srv-bulk-sample-td">→</td>
                <td class="srv-bulk-sample-td srv-bulk-new-val">
                    ${this.escHtml(c.newVal)}
                </td>
            </tr>
        `).join('');

            const moreCount = plannedChanges.length - 8;

            const modal = document.createElement('div');
            modal.id = 'srvBulkConfirmModal';
            modal.className = 'srv-modal-overlay';

            modal.innerHTML = `
        <div class="srv-modal srv-bulk-confirm-modal">

            <!-- כותרת -->
            <div class="srv-modal-header srv-bulk-confirm-header">
                <h3 class="srv-modal-title">
                    <i class="fas fa-magic" style="color:#6366f1"></i>
                    Auto-fill ארגוני - אישור
                </h3>
                <button class="srv-modal-close"
                        id="srvBulkConfirmClose">&times;</button>
            </div>

            <!-- גוף -->
            <div class="srv-modal-body srv-bulk-confirm-body">

                <!-- סיכום -->
                <div class="srv-bulk-summary-grid">
                    <div class="srv-bulk-summary-item srv-bulk-summary-changes">
                        <i class="fas fa-edit"></i>
                        <div class="srv-bulk-summary-num">
                            ${plannedChanges.length}
                        </div>
                        <div class="srv-bulk-summary-label">שינויים</div>
                    </div>
                    <div class="srv-bulk-summary-item srv-bulk-summary-servers">
                        <i class="fas fa-server"></i>
                        <div class="srv-bulk-summary-num">
                            ${affectedServers}
                        </div>
                        <div class="srv-bulk-summary-label">שרתים</div>
                    </div>
                    <div class="srv-bulk-summary-item srv-bulk-summary-found">
                        <i class="fas fa-check-circle"></i>
                        <div class="srv-bulk-summary-num">
                            ${fetchedCount}
                        </div>
                        <div class="srv-bulk-summary-label">מנהלים נמצאו</div>
                    </div>
                    ${notFoundCount > 0 ? `
                    <div class="srv-bulk-summary-item srv-bulk-summary-notfound">
                        <i class="fas fa-question-circle"></i>
                        <div class="srv-bulk-summary-num">
                            ${notFoundCount}
                        </div>
                        <div class="srv-bulk-summary-label">לא נמצאו</div>
                    </div>` : ''}
                </div>

                <!-- לפי שדה -->
                <div class="srv-bulk-fields-summary">
                    <div class="srv-bulk-section-title">
                        <i class="fas fa-list"></i>
                        שינויים לפי שדה:
                    </div>
                    ${fieldSummaryHtml}
                </div>

                <!-- אזהרה -->
                <div class="srv-bulk-warning">
                    <i class="fas fa-exclamation-triangle"
                       style="color:#f59e0b;flex-shrink:0"></i>
                    <span>
                        פעולה זו <strong>תדרוס</strong> ערכים קיימים.
                        הנתונים יישמרו לשרת לאחר האישור.
                        ניתן לראות את כל השינויים בקונסול הדפדפן.
                    </span>
                </div>

                <!-- דוגמאות -->
                <div class="srv-bulk-samples">
                    <div class="srv-bulk-section-title">
                        <i class="fas fa-eye"></i>
                        דוגמאות שינויים:
                    </div>
                    <div class="srv-bulk-samples-table-wrap">
                        <table class="srv-bulk-samples-table">
                            <thead>
                                <tr>
                                    <th>שרת</th>
                                    <th>שדה</th>
                                    <th>ערך ישן</th>
                                    <th></th>
                                    <th>ערך חדש</th>
                                </tr>
                            </thead>
                            <tbody>${samplesHtml}</tbody>
                        </table>
                        ${moreCount > 0 ? `
                        <div class="srv-bulk-more-hint">
                            ועוד ${moreCount} שינויים נוספים...
                            (ראה קונסול לרשימה מלאה)
                        </div>` : ''}
                    </div>
                </div>

            </div>

            <!-- Footer -->
            <div class="srv-modal-footer">
                <button class="srv-modal-cancel-btn"
                        id="srvBulkConfirmCancel">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button class="srv-bulk-confirm-btn"
                        id="srvBulkConfirmOk">
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

            document.getElementById('srvBulkConfirmClose')
                .addEventListener('click', () => closeModal(false));
            document.getElementById('srvBulkConfirmCancel')
                .addEventListener('click', () => closeModal(false));
            document.getElementById('srvBulkConfirmOk')
                .addEventListener('click', () => closeModal(true));
            modal.addEventListener('click', e => {
                if (e.target === modal) closeModal(false);
            });
        });
    }

    async _exportBulkToExcel(allRows, plannedChanges) {
        try {
            this.showToast('מכין קובץ אקסל...', 'info');

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
            wb.creator = 'ServersDashboard';
            wb.created = new Date();

            // ══════════════════════════════════════════════════════
            // גיליון 1: כל הנתונים
            // ══════════════════════════════════════════════════════
            const wsAll = wb.addWorksheet('כל הנתונים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            wsAll.columns = [
                { header: 'שם שרת', key: 'serverName', width: 28 },
                { header: 'סביבה', key: 'environment', width: 12 },
                { header: 'מנהל מערכת', key: 'manager', width: 22 },
                { header: 'מנהל נמצא', key: 'managerFound', width: 12 },
                { header: 'שדה', key: 'field', width: 12 },
                { header: 'ערך קיים', key: 'oldVal', width: 28 },
                { header: 'ערך חדש', key: 'newVal', width: 28 },
                { header: 'סטטוס', key: 'status', width: 18 },
            ];

            // ─── עיצוב כותרות ────────────────────────────────────
            const hRow = wsAll.getRow(1);
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
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: { style: 'medium', color: { argb: 'FF6366f1' } }
                };
            });

            // ─── צבעים לפי סטטוס ─────────────────────────────────
            const statusStyle = {
                'שינוי': { rowBg: 'FFfffbeb', statusFg: 'FFb45309', statusBg: 'FFfef3c7' },
                'מילוי חדש': { rowBg: 'FFf0fdf4', statusFg: 'FF166534', statusBg: 'FFdcfce7' },
                'זהה - אין שינוי': { rowBg: 'FFf9fafb', statusFg: 'FF6b7280', statusBg: 'FFf3f4f6' },
                'אין ערך חדש': { rowBg: 'FFf5f3ff', statusFg: 'FF4338ca', statusBg: 'FFede9fe' },
                'מנהל לא נמצא': { rowBg: 'FFfff1f2', statusFg: 'FFb91c1c', statusBg: 'FFfee2e2' },
                'אין מנהל': { rowBg: 'FFf9fafb', statusFg: 'FF9ca3af', statusBg: 'FFf3f4f6' },
            };
            allRows.forEach((r, idx) => {
                const st = statusStyle[r.status] || {
                    rowBg: 'FFFFFFFF', statusFg: 'FF333333', statusBg: 'FFf3f4f6'
                };

                const row = wsAll.addRow({
                    serverName: r.serverName,
                    environment: r.environment,
                    manager: r.manager,
                    managerFound: r.managerFound,
                    field: r.field,
                    oldVal: r.oldVal,
                    newVal: r.newVal,
                    status: r.status
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
                        bottom: { style: 'thin', color: { argb: 'FFe5e7eb' } }
                    };

                    // ─── ערך קיים - אדום אם יש שינוי ───────────
                    if (colNum === 6 && r.status === 'שינוי' && r.oldVal) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            color: { argb: 'FFdc2626' },
                            strikethrough: true
                        };
                    }

                    // ─── ערך חדש - ירוק אם יש שינוי ────────────
                    if (colNum === 7 &&
                        (r.status === 'שינוי' || r.status === 'מילוי חדש') &&
                        r.newVal) {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: 'FF16a34a' }
                        };
                    }

                    // ─── עמודת סטטוס ────────────────────────────
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

                    // ─── עמודת מנהל נמצא ────────────────────────
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

                    // ─── עמודת סביבה ────────────────────────────
                    if (colNum === 2 && r.environment === 'PROD') {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: 'FF991b1b' }
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
                { header: 'שם שרת', key: 'serverName', width: 28 },
                { header: 'סביבה', key: 'environment', width: 12 },
                { header: 'מנהל מערכת', key: 'manager', width: 22 },
                { header: 'שדה', key: 'field', width: 12 },
                { header: 'ערך קיים', key: 'oldVal', width: 28 },
                { header: 'ערך חדש', key: 'newVal', width: 28 },
            ];

            // ─── כותרות ──────────────────────────────────────────
            const hRowChanges = wsChanges.getRow(1);
            hRowChanges.height = 26;
            hRowChanges.eachCell(cell => {
                cell.font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF78350f' }
                };
                cell.alignment = {
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: { style: 'medium', color: { argb: 'FFffffff' } }
                };
            });

            if (plannedChanges.length === 0) {
                const emptyRow = wsChanges.addRow({
                    serverName: 'אין שינויים לביצוע'
                });
                emptyRow.getCell('serverName').font = {
                    name: 'Arial', size: 10,
                    italic: true,
                    color: { argb: 'FF6b7280' }
                };
                emptyRow.getCell('serverName').alignment = {
                    horizontal: 'center', readingOrder: 2
                };
            } else {
                plannedChanges.forEach((c, idx) => {
                    const srv = this.allServers.find(
                        s => s.name === c.serverName
                    );
                    const env = srv?.environment || '';

                    const row = wsChanges.addRow({
                        serverName: c.serverName,
                        environment: env,
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

                        // ─── סביבה ────────────────────────────────
                        if (colNum === 2 && env === 'PROD') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true,
                                color: { argb: 'FF991b1b' }
                            };
                        }
                    });
                });
            }

            // ══════════════════════════════════════════════════════
            // גיליון 2.5: שינויים מאוגדים לפי מנהל (כמו בפופאפ)
            // ══════════════════════════════════════════════════════
            const wsGrouped = wb.addWorksheet('שינויים מאוגדים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            wsGrouped.columns = [
                { header: 'מנהל מערכת', key: 'manager', width: 22 },
                { header: 'מספר רשומות', key: 'count', width: 14 },
                { header: 'שדה', key: 'field', width: 12 },
                { header: 'ערך קיים', key: 'oldVal', width: 28 },
                { header: 'ערך חדש', key: 'newVal', width: 28 },
                { header: 'סטטוס', key: 'status', width: 14 },
                { header: 'דוגמאות שרתים', key: 'examples', width: 50 },
            ];

            // ── עיצוב כותרות ──
            const hRowGrouped = wsGrouped.getRow(1);
            hRowGrouped.height = 26;
            hRowGrouped.eachCell(cell => {
                cell.font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF4f46e5' }
                };
                cell.alignment = {
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: { style: 'medium', color: { argb: 'FF818cf8' } }
                };
            });

            if (plannedChanges.length === 0) {
                const emptyRow = wsGrouped.addRow({ manager: 'אין שינויים לביצוע' });
                emptyRow.getCell('manager').font = {
                    name: 'Arial', size: 10,
                    italic: true, color: { argb: 'FF6b7280' }
                };
                emptyRow.getCell('manager').alignment = {
                    horizontal: 'center', readingOrder: 2
                };
            } else {
                // ── בנה מפה מאוגדת: מנהל → שדה+ערך → ספירה+דוגמאות ──
                const changesByManager = {};
                allRows
                    .filter(r => r.status === 'שינוי' || r.status === 'מילוי חדש')
                    .forEach(r => {
                        const mgr = r.manager || '(ללא מנהל)';
                        if (!changesByManager[mgr]) changesByManager[mgr] = {};
                        const changeKey = `${r.field}||${r.oldVal}||${r.newVal}`;
                        if (!changesByManager[mgr][changeKey]) {
                            changesByManager[mgr][changeKey] = {
                                field: r.field,
                                oldVal: r.oldVal,
                                newVal: r.newVal,
                                status: r.status,
                                count: 0,
                                entities: [],
                            };
                        }
                        changesByManager[mgr][changeKey].count++;
                        const entityName = r.serverName || r.systemName || '';
                        if (changesByManager[mgr][changeKey].entities.length < 10) {
                            changesByManager[mgr][changeKey].entities.push(entityName);
                        }
                    });

                let rowIdx = 0;
                Object.entries(changesByManager).forEach(([manager, changeMap]) => {
                    const changeEntries = Object.values(changeMap);
                    const totalChanges = changeEntries.reduce((s, c) => s + c.count, 0);

                    // ── שורת כותרת מנהל ──
                    const managerRow = wsGrouped.addRow({
                        manager,
                        count: `${totalChanges} רשומות`,
                        field: '',
                        oldVal: '',
                        newVal: '',
                        status: '',
                        examples: '',
                    });
                    managerRow.height = 20;
                    managerRow.eachCell(cell => {
                        cell.font = {
                            name: 'Arial', size: 10,
                            bold: true, color: { argb: 'FF312E81' }
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: 'FFD0E8FF' }
                        };
                        cell.alignment = {
                            horizontal: 'right', vertical: 'middle',
                            readingOrder: 2
                        };
                        cell.border = {
                            bottom: { style: 'thin', color: { argb: 'FF3730a3' } }
                        };
                    });

                    // ── שורה לכל שינוי ייחודי ──
                    changeEntries.forEach(c => {
                        const st = statusStyle[c.status] || {
                            rowBg: 'FFFFFFFF',
                            statusFg: 'FF333333',
                            statusBg: 'FFf3f4f6'
                        };

                        const examplesStr = c.entities.join(', ') +
                            (c.count > c.entities.length
                                ? ` ועוד ${c.count - c.entities.length}...`
                                : '');

                        const row = wsGrouped.addRow({
                            manager: '',
                            count: c.count,
                            field: c.field,
                            oldVal: c.oldVal || '(ריק)',
                            newVal: c.newVal,
                            status: c.status,
                            examples: examplesStr,
                        });

                        row.height = 16;
                        const rowBg = rowIdx % 2 === 0 ? 'FFf8f7ff' : 'FFFFFFFF';

                        row.eachCell((cell, colNum) => {
                            cell.font = { name: 'Arial', size: 10 };
                            cell.fill = {
                                type: 'pattern', pattern: 'solid',
                                fgColor: { argb: rowBg }
                            };
                            cell.alignment = {
                                horizontal: colNum === 2 ? 'center' : 'right',
                                vertical: 'middle',
                                readingOrder: 2,
                                wrapText: colNum === 7
                            };
                            cell.border = {
                                bottom: { style: 'thin', color: { argb: 'FFe5e7eb' } }
                            };

                            // ── ערך קיים - אדום ──
                            if (colNum === 4) {
                                cell.font = {
                                    name: 'Arial', size: 10,
                                    color: { argb: 'FFdc2626' },
                                    strikethrough: true
                                };
                            }

                            // ── ערך חדש - ירוק ──
                            if (colNum === 5) {
                                cell.font = {
                                    name: 'Arial', size: 10,
                                    bold: true,
                                    color: { argb: 'FF16a34a' }
                                };
                            }

                            // ── סטטוס ──
                            if (colNum === 6) {
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

                            // ── מספר רשומות ──
                            if (colNum === 2) {
                                cell.font = {
                                    name: 'Arial', size: 10,
                                    bold: true,
                                    color: { argb: 'FF6366f1' }
                                };
                            }
                        });

                        rowIdx++;
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
                { header: 'מספר שרתים', key: 'serverCount', width: 14 },
                { header: 'שרתים', key: 'servers', width: 60 },
            ];

            // ─── כותרות ──────────────────────────────────────────
            const hRowNF = wsNotFound.getRow(1);
            hRowNF.height = 26;
            hRowNF.eachCell(cell => {
                cell.font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF7f1d1d' }
                };
                cell.alignment = {
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: { style: 'medium', color: { argb: 'FFffffff' } }
                };
            });

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
                    const servers = allRows
                        .filter(r =>
                            r.manager === manager &&
                            r.managerFound === 'לא'
                        )
                        .map(r => r.serverName);

                    const uniqueServers = [...new Set(servers)];

                    const row = wsNotFound.addRow({
                        manager,
                        serverCount: uniqueServers.length,
                        servers: uniqueServers.join(', '),
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
                { label: 'סה"כ שרתים', value: this.allServers.length },
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
                    bottom: { style: 'thin', color: { argb: 'FFe5e7eb' } }
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
                    bottom: { style: 'thin', color: { argb: 'FFe5e7eb' } }
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

            saveAs(blob, `servers_autofill_preview_${date}.xlsx`);

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
    // Auto-fill שיוך ארגוני לפי שם מנהל מערכת
    // ══════════════════════════════════════════════════════════════
    async _autoFillOrgInfo(managerName, prefix = 'srvEdit') {
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
                { id: `${prefix}Team`, val: emp.team, label: 'צוות' },
                { id: `${prefix}Dept`, val: emp.department, label: 'מחלקה' },
                { id: `${prefix}Domain`, val: emp.domain, label: 'תחום' },
            ];

            const filled = [];

            fields.forEach(({ id, val, label }) => {
                const el = document.getElementById(id);
                if (el && val) {
                    el.value = val;
                    el.classList.add('srv-autofilled');
                    filled.push(label);
                    // ─── הסר highlight אחרי 3 שניות ──────────────
                    setTimeout(() =>
                        el.classList.remove('srv-autofilled'), 3000);
                }
            });

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
    // מודל עריכת שרת (אדמין בלבד)
    // ══════════════════════════════════════════════════════════
    openEditServerModal(serverName) {

        // ─── בדוק הרשאות ─────────────────────────────────────
        if (!this.isAdmin && !this.isEditor) {
            this.showToast('אין הרשאה לעריכה', 'error');
            return;
        }

        const existing = document.getElementById('srvEditModal');
        if (existing) existing.remove();

        const server = this.allServers.find(
            s => s.name === serverName
        );
        if (!server) return;

        // ─── בנה אפשרויות לסלקטים ────────────────────────────
        // תיקון - השתמש בנרמול לבדיקת selected
        const envOptions = ['PROD', 'NONPROD']
            .map(v => `<option value="${v}"
    ${this._normalizeEnvironment(server.environment) === v ? 'selected' : ''}>
    ${v}
</option>`).join('');

        const virtualOptions = [
            { v: 'TRUE', l: '☁️ וירטואלי' },
            { v: 'FALSE', l: '🖥️ פיזי' },
            { v: 'UNKNOWN', l: '❓ לא ידוע' },
        ].map(o => `<option value="${o.v}"
        ${server.isVirtual === o.v ? 'selected' : ''}>
        ${o.l}
    </option>`).join('');

        const statusOptions = [
            'פעילה', 'לא פעילה', 'בבדיקה', 'מושבת', ''
        ].map(v => `<option value="${v}"
        ${server.systemStatus === v ? 'selected' : ''}>
        ${v || '— לא הוגדר —'}
    </option>`).join('');

        const healthOptions = [
            'תקין', 'לא תקין', 'בבדיקה', ''
        ].map(v => `<option value="${v}"
        ${server.isHealthy === v ? 'selected' : ''}>
        ${v || '— לא הוגדר —'}
    </option>`).join('');

        const shutdownOptions = ['כן', 'לא', '']
            .map(v => `<option value="${v}"
            ${server.canShutdown === v ? 'selected' : ''}>
            ${v || '— לא הוגדר —'}
        </option>`).join('');

        const modal = document.createElement('div');
        modal.id = 'srvEditModal';
        modal.className = 'srv-modal-overlay';

        modal.innerHTML = `
    <div class="srv-modal srv-edit-modal">

        <!-- ══ כותרת ══ -->
        <div class="srv-modal-header srv-edit-modal-header">
            <h3 class="srv-modal-title">
                <i class="fas fa-edit" style="color:#f59e0b"></i>
                עריכת שרת
                <span class="srv-edit-server-name-badge"
                    id="srvEditServerNameBadge">
                    ${this.escHtml(serverName)}
                </span>
                <button type="button"
                        id="srvEditRenameBtn"
                        class="srv-rename-btn"
                        title="שנה שם שרת">
                    <i class="fas fa-pen-to-square"></i>
                </button>
            </h3>
            <div style="display:flex;align-items:center;gap:8px">
                <span class="srv-admin-badge-inline">
                    <i class="fas fa-shield-alt"></i>
                    Admin
                </span>
                <button class="srv-modal-close"
                        id="srvEditClose">&times;</button>
            </div>
        </div>

        <!-- ══ גוף ══ -->
        <div class="srv-modal-body srv-edit-modal-body">

            <!-- ── שורה 1: סביבה + סוג ── -->
            <div class="srv-edit-row">
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-industry"></i>
                        סביבה
                    </label>
                    <select id="srvEditEnv"
                            class="srv-select srv-edit-select">
                        ${envOptions}
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-server"></i>
                        סוג שרת
                    </label>
                    <select id="srvEditVirtual"
                            class="srv-select srv-edit-select">
                        ${virtualOptions}
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-circle-dot"></i>
                        סטטוס מערכת
                    </label>
                    <select id="srvEditStatus"
                            class="srv-select srv-edit-select">
                        ${statusOptions}
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-heart"></i>
                        תקינות
                    </label>
                    <select id="srvEditHealthy"
                            class="srv-select srv-edit-select">
                        ${healthOptions}
                    </select>
                </div>
            </div>

            <!-- ── שורה 2: OS + יצרן ── -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-desktop"></i>
                        מערכת הפעלה
                    </label>
                    <input type="text"
                           id="srvEditOs"
                           class="srv-edit-input"
                           value="${this.escHtml(server.os || '')}"
                           placeholder="Windows Server 2019..."/>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-microchip"></i>
                        יצרן חומרה
                    </label>
                    <input type="text"
                           id="srvEditVendor"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.hardwareVendor || ''
        )}"
                           placeholder="Dell, HP, VMware..."/>
                </div>
            </div>

            <!-- ── שורה 3: שם מערכת + קטלוג ── -->
            <div class="srv-edit-row">
               <div class="srv-edit-field srv-edit-field-wide" style="position:relative">
                    <label class="srv-edit-label">
                        <i class="fas fa-layer-group"></i>
                        שם מערכת
                        <span style="font-size:0.68rem;color:#555;font-weight:400;margin-right:4px">
                            (מהקטלוג)
                        </span>
                    </label>
                    <div class="srv-system-combo-wrap" id="srvEditSystemNameWrap">
                        <div style="position:relative">
                            <input type="text"
                                id="srvEditSystemName"
                                class="srv-edit-input"
                                value="${this.escHtml(server.systemName || '')}"
                                placeholder="חפש שם מערכת..."
                                autocomplete="off"/>
                            <i class="fas fa-chevron-down"
                            style="position:absolute;left:10px;top:50%;
                                    transform:translateY(-50%);
                                    color:#555;font-size:0.65rem;
                                    pointer-events:none"
                            id="srvEditSystemNameChevron"></i>
                        </div>
                        <div class="srv-system-combo-dropdown"
                            id="srvEditSystemNameDropdown"
                            style="display:none">
                            <div class="srv-system-combo-loading"
                                id="srvEditSystemNameLoading">
                                <i class="fas fa-spinner fa-spin"></i>
                                טוען מערכות...
                            </div>
                            <div class="srv-system-combo-list"
                                id="srvEditSystemNameList"></div>
                        </div>
                    </div>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-hashtag"></i>
                        מספר קטלוג
                    </label>
                    <input type="text"
                           id="srvEditCatalog"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.catalogNumber || ''
        )}"
                           placeholder="מספר קטלוג..."/>
                </div>
            </div>

            <!-- ── שורה 4: מנהל + צוות + מחלקה ── -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-user-tie"></i>
                        מנהל מערכת
                        <button type="button"
                                id="srvEditAutoFillBtn"
                                class="srv-autofill-btn"
                                title="מלא אוטומטית צוות/מחלקה/תחום לפי שם המנהל">
                            <i class="fas fa-magic"></i>
                        </button>
                    </label>
                    <input type="text"
                        id="srvEditManager"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.systemManager || ''
        )}"
                           placeholder="שם מנהל המערכת..."/>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-users"></i>
                        צוות
                    </label>
                    <input type="text"
                           id="srvEditTeam"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.team || ''
        )}"
                           placeholder="שם הצוות..."/>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-building"></i>
                        מחלקה
                    </label>
                    <input type="text"
                           id="srvEditDept"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.department || ''
        )}"
                           placeholder="שם המחלקה..."/>
                </div>
            </div>

            <!-- ── שורה 5: תחום + IP + אתחול + כיבוי ── -->
            <div class="srv-edit-row">
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-sitemap"></i>
                        תחום
                    </label>
                    <input type="text"
                           id="srvEditDomain"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.domain || ''
        )}"
                           placeholder="תחום..."/>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-network-wired"></i>
                        כתובת IP
                    </label>
                    <input type="text"
                           id="srvEditIp"
                           class="srv-edit-input"
                           value="${this.escHtml(
            server.scannedVia || ''
        )}"
                           placeholder="192.168.1.1"/>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-power-off"></i>
                        סוג אתחול
                    </label>
                    <select id="srvEditBootType"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="ידני"
                            ${server.bootType === 'ידני' ? 'selected' : ''}>
                            ידני
                        </option>
                        <option value="אוטומטי"
                            ${server.bootType === 'אוטומטי' ? 'selected' : ''}>
                            אוטומטי
                        </option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-toggle-on"></i>
                        ניתן לכבות
                    </label>
                    <select id="srvEditShutdown"
                            class="srv-select srv-edit-select">
                        ${shutdownOptions}
                    </select>
                </div>
            </div>

            <!-- ── הערות ── -->
            <div class="srv-edit-field srv-edit-field-full">
                <label class="srv-edit-label">
                    <i class="fas fa-sticky-note"></i>
                    הערות
                </label>
                <textarea id="srvEditNotes"
                          class="srv-form-textarea"
                          rows="3"
                          placeholder="הערות..."
                >${this.escHtml(server.notes || '')}</textarea>
            </div>

            <!-- ── הערות מיפוי ── -->
            <div class="srv-edit-field srv-edit-field-full">
                <label class="srv-edit-label">
                    <i class="fas fa-map"></i>
                    הערות מיפוי
                </label>
                <textarea id="srvEditMappingNotes"
                          class="srv-form-textarea"
                          rows="2"
                          placeholder="הערות מיפוי..."
                >${this.escHtml(
            server.mappingNotes || ''
        )}</textarea>
            </div>

            <!-- ── מידע על עדכון אחרון ── -->
            ${server.lastUpdated ? `
            <div class="srv-edit-last-update">
                <i class="fas fa-clock"></i>
                עדכון אחרון: ${this.escHtml(server.lastUpdated)}
                ${server.updatedBy
                    ? `על ידי <strong>
                           ${this.escHtml(server.updatedBy)}
                       </strong>`
                    : ''}
            </div>` : ''}

        </div>

        <!-- ══ Footer ══ -->
        <div class="srv-modal-footer">
            <button class="srv-modal-cancel-btn"
                    id="srvEditCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button class="srv-edit-save-btn"
                    id="srvEditSave">
                <i class="fas fa-save"></i>
                שמור שינויים
            </button>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ─── אתחל combobox שם מערכת ───────────────────────────────
        this._initSystemNameCombo(
            'srvEditSystemName',
            'srvEditSystemNameDropdown',
            'srvEditSystemNameList',
            'srvEditSystemNameLoading',
            'srvEditSystemNameChevron'
        );

        // ─── אירועים ─────────────────────────────────────────
        const closeModal = () => {
            modal.remove();
            this.editingRow = null;
        };

        document.getElementById('srvEditClose')
            .addEventListener('click', closeModal);
        document.getElementById('srvEditCancel')
            .addEventListener('click', closeModal);

        document.getElementById('srvEditRenameBtn')
            ?.addEventListener('click', () => {
                this._openRenameDialog(serverName, modal);
            });
        document.getElementById('srvEditSave')
            .addEventListener('click', () =>
                this._saveServerEdit(serverName, modal)
            );

        // ─── Auto-fill לפי מנהל מערכת ────────────────────────────────
        document.getElementById('srvEditAutoFillBtn')
            ?.addEventListener('click', () => {
                const name = document
                    .getElementById('srvEditManager')?.value?.trim();
                name
                    ? this._autoFillOrgInfo(name, 'srvEdit')
                    : this.showToast('הזן שם מנהל מערכת תחילה', 'info');
            });

        document.getElementById('srvEditManager')
            ?.addEventListener('blur', e => {
                const val = e.target.value?.trim();
                if (val?.length >= 2)
                    this._autoFillOrgInfo(val, 'srvEdit');
            });

        // ─── סמן שורה בטבלה ──────────────────────────────────
        this.editingRow = serverName;
        const row = document.querySelector(
            `.srv-tr[data-name="${this.escHtml(serverName)}"]`
        );
        if (row) row.classList.add('srv-tr-editing');
    }

    // הוסף כפונקציה חדשה בקלאס, לפני addStyles()
    _openRenameDialog(currentName, editModal) {
        const existing = document.getElementById('srvRenameModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'srvRenameModal';
        modal.className = 'srv-modal-overlay';
        modal.style.zIndex = '999999'; // מעל מודל העריכה

        modal.innerHTML = `
    <div class="srv-modal" style="max-width:460px;width:95%">

        <!-- כותרת -->
        <div class="srv-modal-header" style="
            border-bottom:2px solid rgba(245,158,11,0.35);
            background:linear-gradient(135deg,
                rgba(245,158,11,0.08),
                rgba(217,119,6,0.05))">
            <h3 class="srv-modal-title">
                <i class="fas fa-pen-to-square"
                   style="color:#f59e0b"></i>
                שינוי שם שרת
            </h3>
            <button class="srv-modal-close"
                    id="srvRenameClose">&times;</button>
        </div>

        <!-- גוף -->
        <div class="srv-modal-body" style="gap:14px">

            <!-- שם נוכחי -->
            <div style="
                display:flex;align-items:center;gap:10px;
                padding:10px 14px;
                background:rgba(255,255,255,0.02);
                border:1px solid rgba(255,255,255,0.07);
                border-radius:8px">
                <i class="fas fa-server"
                   style="color:#555;font-size:0.85rem"></i>
                <div>
                    <div style="font-size:0.72rem;color:#666;
                                margin-bottom:2px">
                        שם נוכחי:
                    </div>
                    <div style="font-size:0.9rem;font-weight:700;
                                color:#e0e0e0;font-family:monospace">
                        ${this.escHtml(currentName)}
                    </div>
                </div>
            </div>

            <!-- שדה שם חדש -->
            <div class="srv-edit-field">
                <label class="srv-edit-label">
                    <i class="fas fa-tag"></i>
                    שם חדש
                    <span class="srv-required-badge">* חובה</span>
                </label>
                <input type="text"
                       id="srvRenameInput"
                       class="srv-edit-input"
                       value="${this.escHtml(currentName)}"
                       placeholder="שם שרת חדש..."
                       autocomplete="off"
                       maxlength="63"
                       spellcheck="false"/>
                <div id="srvRenameError"
                     class="srv-add-field-error"
                     style="display:none">
                    <i class="fas fa-exclamation-circle"></i>
                    <span id="srvRenameErrorMsg"></span>
                </div>
                <div style="font-size:0.72rem;color:#555;
                            margin-top:3px">
                    <i class="fas fa-info-circle"
                       style="color:#444"></i>
                    ללא רווחים, /, \\, :, *, ?, ", &lt;, &gt;, |
                    | מקסימום 63 תווים
                </div>
            </div>

            <!-- אזהרה -->
            <div style="
                display:flex;align-items:flex-start;gap:10px;
                padding:10px 14px;
                background:rgba(245,158,11,0.08);
                border:1px solid rgba(245,158,11,0.25);
                border-radius:8px;
                font-size:0.78rem;color:#fcd34d;line-height:1.5">
                <i class="fas fa-exclamation-triangle"
                   style="color:#f59e0b;flex-shrink:0;
                          margin-top:2px"></i>
                <span>
                    שינוי שם ישמר בהיסטוריית ההערות.
                    ודא שהשם החדש תואם לשם השרת בפועל.
                </span>
            </div>

        </div>

        <!-- Footer -->
        <div class="srv-modal-footer">
            <button class="srv-modal-cancel-btn"
                    id="srvRenameCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button id="srvRenameConfirm"
                    style="padding:8px 18px;
                           background:linear-gradient(
                               135deg,#f59e0b,#d97706);
                           border:none;border-radius:6px;
                           color:#1a0a00;font-size:0.85rem;
                           font-weight:700;cursor:pointer;
                           display:flex;align-items:center;
                           gap:6px;font-family:inherit;
                           transition:all 0.2s">
                <i class="fas fa-check"></i>
                שנה שם
            </button>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ── Focus ──────────────────────────────────────────────────
        const input = document.getElementById('srvRenameInput');
        setTimeout(() => {
            if (input) {
                input.focus();
                input.select();
            }
        }, 100);

        // ── ולידציה בזמן אמת ──────────────────────────────────────
        const showError = (msg) => {
            const errEl = document.getElementById('srvRenameError');
            const errMsg = document.getElementById('srvRenameErrorMsg');
            if (errEl) errEl.style.display = 'flex';
            if (errMsg) errMsg.textContent = msg;
            input?.classList.add('srv-add-input-error');
        };

        const clearError = () => {
            const errEl = document.getElementById('srvRenameError');
            if (errEl) errEl.style.display = 'none';
            input?.classList.remove('srv-add-input-error');
        };

        input?.addEventListener('input', () => {
            clearError();
            // ── בדוק תווים לא חוקיים בזמן הקלדה ──────────────────
            const val = input.value;
            const invalidChars = /[/\\:*?"<>| ]/;
            if (invalidChars.test(val)) {
                showError('תווים לא חוקיים: / \\ : * ? " < > | רווח');
            }
        });

        // ── Enter לאישור ──────────────────────────────────────────
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('srvRenameConfirm')?.click();
            }
            if (e.key === 'Escape') {
                modal.remove();
            }
        });

        // ── סגירה ─────────────────────────────────────────────────
        const closeRename = () => modal.remove();

        document.getElementById('srvRenameClose')
            ?.addEventListener('click', closeRename);
        document.getElementById('srvRenameCancel')
            ?.addEventListener('click', closeRename);

        // ── אישור שינוי שם ────────────────────────────────────────
        document.getElementById('srvRenameConfirm')
            ?.addEventListener('click', async () => {
                const newName = input?.value?.trim() ?? '';

                // ── ולידציה ──────────────────────────────────────
                if (!newName) {
                    showError('שם שרת נדרש');
                    return;
                }

                if (newName === currentName) {
                    showError('השם החדש זהה לשם הנוכחי');
                    return;
                }

                const invalidChars = /[/\\:*?"<>| ]/;
                if (invalidChars.test(newName)) {
                    showError('תווים לא חוקיים: / \\ : * ? " < > | רווח');
                    return;
                }

                if (newName.length > 63) {
                    showError('שם שרת לא יכול לעלות על 63 תווים');
                    return;
                }

                // ── בדוק כפילות בצד הלקוח ────────────────────────
                const exists = this.allServers.some(s =>
                    s.name !== currentName &&
                    s.name.toLowerCase() === newName.toLowerCase()
                );
                if (exists) {
                    showError(`שרת בשם "${newName}" כבר קיים`);
                    return;
                }

                // ── שלח לשרת ─────────────────────────────────────
                const confirmBtn = document.getElementById('srvRenameConfirm');
                if (confirmBtn) {
                    confirmBtn.disabled = true;
                    confirmBtn.innerHTML =
                        '<i class="fas fa-spinner fa-spin"></i> שומר...';
                }

                try {
                    const res = await fetch('/Servers/RenameServer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            oldName: currentName,
                            newName: newName
                        })
                    });

                    const data = await res.json();

                    if (!data.success)
                        throw new Error(data.error || 'שגיאה בשינוי שם');

                    // ── עדכן בזיכרון ─────────────────────────────
                    const srv = this.allServers.find(
                        s => s.name === currentName
                    );
                    if (srv) {
                        srv.name = newName;
                        srv.notes = data.server?.notes ?? srv.notes;
                        srv.lastUpdated = data.server?.lastUpdated;
                        srv.updatedBy = data.server?.updatedBy;
                    }

                    // ── עדכן selectedServers אם נבחר ─────────────
                    if (this.selectedServers.has(currentName)) {
                        this.selectedServers.delete(currentName);
                        this.selectedServers.add(newName);
                    }

                    // ── עדכן editingRow ───────────────────────────
                    if (this.editingRow === currentName) {
                        this.editingRow = newName;
                    }

                    // ── סגור מודל שינוי שם ────────────────────────
                    modal.remove();

                    // ── עדכן badge במודל העריכה ───────────────────
                    const badge = document.getElementById(
                        'srvEditServerNameBadge'
                    );
                    if (badge) badge.textContent = newName;

                    // ── עדכן כותרת מודל העריכה ───────────────────
                    const editTitle = editModal?.querySelector(
                        '.srv-edit-server-name-badge'
                    );
                    if (editTitle) editTitle.textContent = newName;

                    // ── עדכן data-name של מודל העריכה ────────────
                    if (editModal) {
                        // עדכן את ה-serverName בכפתור שמירה
                        const saveBtn = document.getElementById('srvEditSave');
                        if (saveBtn) {
                            // הסר listener ישן והוסף חדש עם השם החדש
                            const newSaveBtn = saveBtn.cloneNode(true);
                            saveBtn.parentNode?.replaceChild(newSaveBtn, saveBtn);
                            newSaveBtn.addEventListener('click', () =>
                                this._saveServerEdit(newName, editModal)
                            );
                        }
                    }

                    // ── רענן תצוגה ────────────────────────────────
                    this.applyFiltersAndSort();
                    this.renderContent();
                    this.updateStats();

                    this.showToast(
                        `✅ שם שרת שונה: "${currentName}" → "${newName}"`,
                        'success'
                    );

                } catch (err) {
                    console.error('RenameServer error:', err);
                    showError(err.message);

                    if (confirmBtn) {
                        confirmBtn.disabled = false;
                        confirmBtn.innerHTML =
                            '<i class="fas fa-check"></i> שנה שם';
                    }
                }
            });
    }

    // ══════════════════════════════════════════════════════════════
    // Combobox שם מערכת - גרסה כללית לכל מודל
    // ══════════════════════════════════════════════════════════════
    async _initSystemNameComboForModal(
        inputId,
        dropdownId,
        listId,
        loadingId,
        chevronId,
        catalogInputId,
        modalId
    ) {
        const input = document.getElementById(inputId);
        const dropdown = document.getElementById(dropdownId);
        const listEl = document.getElementById(listId);
        const loadingEl = document.getElementById(loadingId);
        const chevronEl = document.getElementById(chevronId);

        if (!input || !dropdown || !listEl) return;

        let allSystems = [];
        let isOpen = false;
        let highlightIdx = -1;

        // ─── טען קטלוג ───────────────────────────────────────────
        const loadSystems = async () => {
            try {
                const catalog = await this._loadSystemsCatalog();
                allSystems = catalog
                    .filter(s => s.name)
                    .sort((a, b) =>
                        (a.name || '').localeCompare(b.name || '', 'he')
                    );
            } catch (err) {
                console.warn('_initSystemNameComboForModal: failed', err);
                allSystems = [];
            }
        };

        // ─── בנה רשימה מסוננת ────────────────────────────────────
        const buildList = (term) => {
            const t = (term || '').trim().toLowerCase();
            const filtered = t
                ? allSystems.filter(s =>
                    (s.name || '').toLowerCase().includes(t) ||
                    (String(s.number || '')).includes(t)
                )
                : allSystems;

            if (filtered.length === 0) {
                listEl.innerHTML = `
                <div style="padding:10px 14px;color:#555;
                            font-size:0.78rem;text-align:center">
                    <i class="fas fa-search"
                       style="margin-left:5px"></i>
                    לא נמצאו מערכות
                </div>`;
                return;
            }

            const slice = filtered.slice(0, 80);

            listEl.innerHTML = slice.map((s, idx) => {
                const name = this.escHtml(s.name || '');
                const num = s.number
                    ? `#${this.escHtml(String(s.number))}`
                    : '';
                const dept = s.department
                    ? `<span style="color:#555;font-size:0.68rem">
                       ${this.escHtml(s.department)}
                   </span>`
                    : '';

                const highlight = (text) => {
                    if (!t) return text;
                    const re = new RegExp(
                        `(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
                        'gi'
                    );
                    return text.replace(re,
                        '<mark style="background:rgba(99,102,241,0.3);' +
                        'color:#c4b5fd;border-radius:2px;padding:0 1px">' +
                        '$1</mark>'
                    );
                };

                return `
            <div class="srv-system-combo-item"
                 data-idx="${idx}"
                 data-name="${this.escHtml(s.name || '')}"
                 data-number="${this.escHtml(String(s.number || ''))}"
                 style="display:flex;align-items:center;
                        justify-content:space-between;
                        padding:7px 12px;cursor:pointer;
                        border-bottom:1px solid rgba(255,255,255,0.04);
                        transition:background 0.12s;gap:8px">
                <div style="flex:1;min-width:0">
                    <div style="font-size:0.82rem;color:#e0e0e0;
                                white-space:nowrap;overflow:hidden;
                                text-overflow:ellipsis">
                        ${highlight(name)}
                    </div>
                    ${dept}
                </div>
                ${num ? `
                <span style="font-size:0.7rem;color:#6366f1;
                             background:rgba(99,102,241,0.12);
                             border:1px solid rgba(99,102,241,0.25);
                             border-radius:5px;padding:1px 6px;
                             flex-shrink:0;font-weight:700">
                    ${highlight(num)}
                </span>` : ''}
            </div>`;
            }).join('');

            if (filtered.length > 80) {
                listEl.insertAdjacentHTML('beforeend', `
                <div style="padding:6px 12px;color:#555;
                            font-size:0.72rem;text-align:center;
                            border-top:1px solid #2a2a4e">
                    ועוד ${filtered.length - 80} מערכות...
                    (הקלד לסינון)
                </div>`);
            }

            highlightIdx = -1;
        };

        // ─── פתח dropdown ─────────────────────────────────────────
        const openDropdown = async () => {
            if (isOpen) return;
            isOpen = true;

            if (allSystems.length === 0) {
                if (loadingEl) loadingEl.style.display = 'flex';
                if (listEl) listEl.innerHTML = '';
                dropdown.style.display = 'block';
                await loadSystems();
                if (loadingEl) loadingEl.style.display = 'none';
            } else {
                dropdown.style.display = 'block';
            }

            buildList(input.value);

            if (chevronEl) {
                chevronEl.style.transform =
                    'translateY(-50%) rotate(180deg)';
            }

            // ─── הדגש פריט נוכחי ─────────────────────────────────
            setTimeout(() => {
                const current = listEl.querySelector(
                    `.srv-system-combo-item[data-name=
                    "${CSS.escape(input.value)}"]`
                );
                if (current) {
                    current.style.background =
                        'rgba(99,102,241,0.18)';
                    current.scrollIntoView({ block: 'nearest' });
                }
            }, 50);
        };

        // ─── סגור dropdown ────────────────────────────────────────
        const closeDropdown = () => {
            if (!isOpen) return;
            isOpen = false;
            dropdown.style.display = 'none';
            highlightIdx = -1;
            if (chevronEl) {
                chevronEl.style.transform =
                    'translateY(-50%) rotate(0deg)';
            }
        };

        // ─── בחר פריט ─────────────────────────────────────────────
        const selectItem = (name, number) => {
            input.value = name;
            closeDropdown();
            input.focus();

            // ─── מלא מספר קטלוג אוטומטית אם ריק ────────────────
            if (catalogInputId) {
                const catalogInput =
                    document.getElementById(catalogInputId);
                if (catalogInput && number &&
                    !catalogInput.value.trim()) {
                    catalogInput.value = number;
                    catalogInput.classList.add('srv-autofilled');
                    setTimeout(() =>
                        catalogInput.classList
                            .remove('srv-autofilled'),
                        2500
                    );
                }
            }
        };

        // ─── Keyboard navigation ──────────────────────────────────
        const getItems = () =>
            listEl.querySelectorAll('.srv-system-combo-item');

        const setHighlight = (idx) => {
            const items = getItems();
            items.forEach((el, i) => {
                el.style.background = i === idx
                    ? 'rgba(99,102,241,0.2)'
                    : '';
            });
            if (items[idx]) {
                items[idx].scrollIntoView({ block: 'nearest' });
            }
            highlightIdx = idx;
        };

        // ─── אירועי input ─────────────────────────────────────────
        input.addEventListener('focus', () => openDropdown());

        input.addEventListener('input', () => {
            if (!isOpen) openDropdown();
            else buildList(input.value);
        });

        input.addEventListener('keydown', (e) => {
            if (!isOpen) {
                if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    openDropdown();
                    e.preventDefault();
                }
                return;
            }

            const items = getItems();
            const count = items.length;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight(
                    highlightIdx < count - 1
                        ? highlightIdx + 1 : 0
                );
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight(
                    highlightIdx > 0
                        ? highlightIdx - 1 : count - 1
                );
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlightIdx >= 0 && items[highlightIdx]) {
                    const el = items[highlightIdx];
                    selectItem(
                        el.dataset.name,
                        el.dataset.number
                    );
                } else {
                    closeDropdown();
                }
            } else if (e.key === 'Escape') {
                closeDropdown();
            }
        });

        // ─── לחיצה על פריט ────────────────────────────────────────
        listEl.addEventListener('mousedown', (e) => {
            const item = e.target.closest('.srv-system-combo-item');
            if (!item) return;
            e.preventDefault();
            selectItem(item.dataset.name, item.dataset.number);
        });

        // ─── hover ────────────────────────────────────────────────
        listEl.addEventListener('mouseover', (e) => {
            const item = e.target.closest('.srv-system-combo-item');
            if (!item) return;
            const idx = parseInt(item.dataset.idx);
            if (!isNaN(idx)) setHighlight(idx);
        });

        listEl.addEventListener('mouseleave', () => {
            getItems().forEach(el => { el.style.background = ''; });
            highlightIdx = -1;
        });

        // ─── סגור בלחיצה מחוץ ────────────────────────────────────
        const outsideHandler = (e) => {
            const wrap = input.closest('.srv-system-combo-wrap');
            if (wrap && !wrap.contains(e.target)) {
                closeDropdown();
            }
        };

        document.addEventListener('mousedown', outsideHandler);

        // ─── נקה handler כשהמודל נסגר ────────────────────────────
        if (modalId) {
            const observer = new MutationObserver(() => {
                if (!document.getElementById(modalId)) {
                    document.removeEventListener(
                        'mousedown', outsideHandler
                    );
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true });
        }
    }

    // ══════════════════════════════════════════════════════════════
    // Combobox שם מערכת - אתחול
    // ══════════════════════════════════════════════════════════════
    async _initSystemNameCombo(
        inputId,
        dropdownId,
        listId,
        loadingId,
        chevronId
    ) {
        // ─── קרא לפונקציה הכללית ─────────────────────────────────
        await this._initSystemNameComboForModal(
            inputId,
            dropdownId,
            listId,
            loadingId,
            chevronId,
            'srvEditCatalog',   // ← שדה קטלוג במודל עריכה
            'srvEditModal'      // ← ID של מודל העריכה
        );
    }

    async _loadSystemsCatalog() {
        if (this._systemsCatalog) return this._systemsCatalog;
        try {
            const res = await fetch('/SystemsCatalog/GetSystems',
                { credentials: 'include' });
            const data = await res.json();
            this._systemsCatalog = data.systems || [];
        } catch {
            this._systemsCatalog = [];
        }
        return this._systemsCatalog;
    }

    // ─── שמור עריכת שרת ──────────────────────────────────────────
    async _saveServerEdit(serverName, modal) {

        const saveBtn = document.getElementById('srvEditSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const payload = {
                serverName,
                environment: document.getElementById('srvEditEnv')
                    ?.value ?? null,
                isVirtual: document.getElementById('srvEditVirtual')
                    ?.value ?? null,
                systemStatus: document.getElementById('srvEditStatus')
                    ?.value ?? null,
                isHealthy: document.getElementById('srvEditHealthy')
                    ?.value ?? null,
                os: document.getElementById('srvEditOs')
                    ?.value?.trim() ?? null,
                hardwareVendor: document.getElementById('srvEditVendor')
                    ?.value?.trim() ?? null,
                systemName: document.getElementById('srvEditSystemName')
                    ?.value?.trim() ?? null,
                catalogNumber: document.getElementById('srvEditCatalog')
                    ?.value?.trim() ?? null,
                systemManager: document.getElementById('srvEditManager')
                    ?.value?.trim() ?? null,
                team: document.getElementById('srvEditTeam')
                    ?.value?.trim() ?? null,
                department: document.getElementById('srvEditDept')
                    ?.value?.trim() ?? null,
                domain: document.getElementById('srvEditDomain')
                    ?.value?.trim() ?? null,
                scannedVia: document.getElementById('srvEditIp')
                    ?.value?.trim() ?? null,
                bootType: document.getElementById('srvEditBootType')
                    ?.value?.trim() ?? null,
                canShutdown: document.getElementById('srvEditShutdown')
                    ?.value ?? null,
                notes: document.getElementById('srvEditNotes')
                    ?.value?.trim() ?? null,
                mappingNotes: document.getElementById('srvEditMappingNotes')
                    ?.value?.trim() ?? null,
            };

            const res = await fetch('/Servers/UpdateServer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            // ─── עדכן בזיכרון ────────────────────────────────
            const srv = this.allServers.find(
                s => s.name === serverName
            );
            if (srv && data.server) {
                Object.assign(srv, {
                    environment: data.server.environment,
                    isVirtual: data.server.isVirtual,
                    systemStatus: data.server.systemStatus,
                    isHealthy: data.server.isHealthy,
                    os: data.server.os,
                    hardwareVendor: data.server.hardwareVendor,
                    systemName: data.server.systemName,
                    catalogNumber: data.server.catalogNumber,
                    systemManager: data.server.systemManager,
                    team: data.server.team,
                    department: data.server.department,
                    domain: data.server.domain,
                    scannedVia: data.server.scannedVia,
                    bootType: data.server.bootType,
                    canShutdown: data.server.canShutdown,
                    notes: data.server.notes,
                    mappingNotes: data.server.mappingNotes,
                    lastUpdated: data.server.lastUpdated,
                    updatedBy: data.server.updatedBy,
                });
            }

            // ─── השלם שם מערכת / מספר קטלוג ────────────────────────
            const catalog = await this._loadSystemsCatalog();

            if (srv.catalogNumber && !srv.systemName) {
                const match = catalog.find(s =>
                    String(s.number || '').trim() ===
                    String(srv.catalogNumber).trim()
                );
                if (match?.name) {
                    srv.systemName = match.name;
                    // ─── שמור גם לשרת ───
                    await fetch('/Servers/UpdateServer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            serverName: srv.name,
                            systemName: match.name
                        })
                    });
                }
            }

            if (srv.systemName && !srv.catalogNumber) {
                const match = catalog.find(s =>
                    (s.name || '').toLowerCase() ===
                    (srv.systemName || '').toLowerCase()
                );
                if (match?.number) {
                    srv.catalogNumber = String(match.number);
                    await fetch('/Servers/UpdateServer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            serverName: srv.name,
                            catalogNumber: String(match.number)
                        })
                    });
                }
            }

            modal.remove();
            this.editingRow = null;

            // ─── רענן תצוגה ──────────────────────────────────
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            this.showToast(
                `✅ שרת ${serverName} עודכן בהצלחה`, 'success'
            );

        } catch (err) {
            console.error('_saveServerEdit error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-save"></i> שמור שינויים';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // BigFix - טעינת סטטוס
    // ══════════════════════════════════════════════════════════
    async loadBigFixData(silent = false) {
        if (this.bigFixLoading) return;
        this.bigFixLoading = true;

        try {
            if (!silent) this._setBigFixColumnHeader('loading');

            const res = await fetch('/Servers/GetBigFixStatus', {
                method: 'GET',
                credentials: 'include'
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'שגיאה בטעינת BigFix');
            }

            // ─── בנה מפה: שם שרת (lowercase) → סטטוס ────────
            this.bigFixData = {};
            (data.statusMap || []).forEach(item => {
                // שמור גם עם דומיין וגם בלי
                const key = (item.name || '').toLowerCase();
                this.bigFixData[key] = item;

                // גם ללא דומיין (אם יש נקודה)
                const dotIdx = key.indexOf('.');
                if (dotIdx > 0) {
                    const shortKey = key.substring(0, dotIdx);
                    if (!this.bigFixData[shortKey]) {
                        this.bigFixData[shortKey] = item;
                    }
                }
            });

            this.bigFixLoaded = true;
            this.bigFixError = null;

            // ─── עדכן תאים בטבלה הקיימת ──────────────────────
            this._updateBigFixCells();
            this._setBigFixColumnHeader('ok', data.count);
            this.updateStats();

            // ← תיקון: בנה מחדש את פילטר BigFix עם הנתונים החדשים
            this._populateDropdownFilters();
            this._restoreFilterSelects();

            if (!silent) {
                this.showToast(
                    `🔄 BigFix: ${data.count} שרתים עודכנו`,
                    'success'
                );
            }

            // ─── תזמן רענון אוטומטי ──────────────────────────
            clearTimeout(this._bigFixTimer);
            this._bigFixTimer = setTimeout(
                () => this.loadBigFixData(true),
                this.BF_REFRESH_MS
            );

        } catch (err) {
            console.error('loadBigFixData error:', err);
            this.bigFixError = err.message;
            this._setBigFixColumnHeader('error');

            if (!silent) {
                this.showToast(
                    '⚠️ BigFix: ' + err.message, 'error'
                );
            }
        } finally {
            this.bigFixLoading = false;
        }
    }

    // ─── עדכן כותרת עמודת BigFix ─────────────────────────────
    _setBigFixColumnHeader(state, count = 0) {
        const th = document.querySelector(
            '.srv-th[data-col="bigfixStatus"]'
        );
        if (!th) return;

        if (state === 'loading') {
            th.innerHTML = `
            <i class="fas fa-spinner fa-spin"
               style="color:#6366f1"></i>
            BigFix`;
        } else if (state === 'ok') {
            th.innerHTML = `
            <span class="srv-bigfix-header-ok">
                <i class="fas fa-shield-alt"></i>
                Updates
            </span>`;
        } else if (state === 'error') {
            th.innerHTML = `
            <span style="color:#f87171">
                <i class="fas fa-exclamation-triangle"></i>
                BigFix
            </span>
            <button class="srv-bigfix-refresh-btn"
                    title="נסה שוב"
                    onclick="event.stopPropagation();
                             window._srvDashboard
                                 .loadBigFixData(false)">
                <i class="fas fa-redo"></i>
            </button>`;
        }
    }

    // ─── עדכן תאי BigFix בטבלה הקיימת ───────────────────────
    _updateBigFixCells() {
        const tbody = document.getElementById('srvTbody');
        if (!tbody) return;

        tbody.querySelectorAll('tr.srv-tr').forEach(row => {
            const name = row.dataset.name || '';

            // ─── עדכן תא סטטוס ───
            const cell = row.querySelector('td[data-bigfix="1"]');
            if (cell) {
                cell.innerHTML = this._buildBigFixCell(name);
            }

            // ─── עדכן תא תאריך ───
            const dateCell = row.querySelector('td[data-bigfix-date="1"]');
            if (dateCell) {
                dateCell.innerHTML = this._buildBigFixDateCell(name);
            }
        });
    }

    // ─── בנה תוכן תא BigFix ──────────────────────────────────
    _buildBigFixCell(serverName) {
        if (!this.bigFixLoaded && !this.bigFixError) {
            return `<span class="srv-bigfix-pending">
                <i class="fas fa-clock"></i>
            </span>`;
        }

        if (this.bigFixError && !this.bigFixLoaded) {
            return `<span class="srv-bigfix-error"
                  title="${this.escHtml(this.bigFixError)}">
                <i class="fas fa-exclamation-circle"></i>
            </span>`;
        }

        const key = (serverName || '').toLowerCase();
        const status = this.bigFixData[key];

        if (!status) {
            return `<span class="srv-bigfix-notfound"
                  title="לא נמצא ב-BigFix">
                <i class="fas fa-minus-circle"></i>
                <span>לא ב-BigFix</span>
            </span>`;
        }

        const raw = (status.pendingRestart || '').trim();
        const badgeHtml = this._getBigFixBadge(raw);

        return badgeHtml;
    }

    // הוסף מתודה חדשה לתא התאריך:
    _buildBigFixDateCell(serverName) {
        if (!this.bigFixLoaded) return '—';

        const key = (serverName || '').toLowerCase();
        const status = this.bigFixData[key];

        if (!status) return '—';

        const lastReportShort = this._formatBigFixDate(status.lastReport);

        return `<span class="srv-bigfix-report"
                  title="דיווח אחרון: ${this.escHtml(status.lastReport || '')}">
                <i class="fas fa-clock"></i>
                ${this.escHtml(lastReportShort)}
            </span>`;
    }

    // ─── מחזיר badge לפי ערך BigFix ──────────────────────────
    _getBigFixBadge(value) {
        const v = (value || '').trim();

        // ─── Need Restart ─────────────────────────────────────
        if (v === 'Need Restart') {
            return `<span class="srv-bigfix-badge srv-bigfix-need-restart"
                      title="Need Restart">
                    <i class="fas fa-redo-alt"></i>
                    Restart
                </span>`;
        }

        // ─── Pending Restart ──────────────────────────────────
        if (v === 'Pending Restart') {
            return `<span class="srv-bigfix-badge srv-bigfix-pending-restart"
                      title="Pending Restart">
                    <i class="fas fa-hourglass-half"></i>
                    Pending
                </span>`;
        }

        // ─── Completed ────────────────────────────────────────
        if (v === 'Completed') {
            return `<span class="srv-bigfix-badge srv-bigfix-completed"
                      title="Completed">
                    <i class="fas fa-check-circle"></i>
                    Completed
                </span>`;
        }

        // ─── Not Completed → WAIT TO INSTALL ─────────────────
        if (v === 'Not Completed') {
            return `<span class="srv-bigfix-badge srv-bigfix-not-completed"
                      title="Not Completed">
                    <i class="fas fa-times-circle"></i>
                    Install
                </span>`;
        }

        // ─── Not Reboot 120 day ───────────────────────────────
        if (v === 'Not Reboot 120 day') {
            return `<span class="srv-bigfix-badge srv-bigfix-not-reboot"
                      title="Not Reboot 120 day">
                    <i class="fas fa-exclamation-triangle"></i>
                    120 day
                </span>`;
        }

        // ─── ערך לא מוכר ─────────────────────────────────────
        if (v && v !== 'Not Reported' && v !== 'False' && v !== 'True') {
            return `<span class="srv-bigfix-badge srv-bigfix-unknown"
                      title="${this.escHtml(v)}">
                    <i class="fas fa-question-circle"></i>
                    ${this.escHtml(v)}
                </span>`;
        }

        // ─── True/False (ערך ישן) - fallback ─────────────────
        if (v === 'True') {
            return `<span class="srv-bigfix-badge srv-bigfix-need-restart"
                      title="Pending Restart">
                    <i class="fas fa-redo-alt"></i>
                    Restart
                </span>`;
        }

        return `<span class="srv-bigfix-badge srv-bigfix-completed"
                  title="OK">
                <i class="fas fa-check-circle"></i>
                Completed
            </span>`;
    }

    // ─── פורמט תאריך BigFix ───────────────────────────────────
    // "Tue 19 May 2026 16:08:45 +0300" → "19/05 16:08"
    _formatBigFixDate(dateStr) {
        if (!dateStr || dateStr === 'Not Reported') return '—';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr.substring(0, 16);
            const day = d.getDate().toString().padStart(2, '0');
            const mon = (d.getMonth() + 1).toString().padStart(2, '0');
            const h = d.getHours().toString().padStart(2, '0');
            const m = d.getMinutes().toString().padStart(2, '0');
            return `${day}/${mon} ${h}:${m}`;
        } catch {
            return dateStr.substring(0, 16);
        }
    }

    // ══════════════════════════════════════════════════════════
    // סינון ומיון
    // ══════════════════════════════════════════════════════════
    applyFiltersAndSort() {
        let result = [...this.allServers];

        // ─── חיפוש ───
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            result = result.filter(s =>
                (s.name || '').toLowerCase().includes(term) ||
                (s.systemName || '').toLowerCase().includes(term) ||
                (s.os || '').toLowerCase().includes(term) ||
                (s.department || '').toLowerCase().includes(term) ||
                (s.team || '').toLowerCase().includes(term) ||
                (s.systemManager || '').toLowerCase().includes(term) ||
                (s.catalogNumber || '').toLowerCase().includes(term) ||
                (s.scannedVia || '').toLowerCase().includes(term)
            );
        }

        const f = this.filters;

        // ─── עזר: סינון עם תמיכה ב-__empty__ ───────────────────
        const filterField = (arr, filterVal, getFn) => {
            if (!filterVal || filterVal === 'all') return arr;

            // ── Multi-select (Set) ──
            if (filterVal instanceof Set) {
                return arr.filter(s => {
                    const v = (getFn(s) || '').trim();
                    if (!v) return filterVal.has('__empty__');
                    return filterVal.has(v);
                });
            }

            if (filterVal === '__empty__')
                return arr.filter(s => {
                    const v = getFn(s);
                    return !v || v.trim() === '';
                });
            return arr.filter(s => getFn(s) === filterVal);
        };

        // ─── סביבה ───
        if (f.environment !== 'all') {
            if (f.environment instanceof Set) {
                result = result.filter(s => {
                    const norm = this._normalizeEnvironment(s.environment);
                    if (f.environment.has('__empty__') && !norm) return true;
                    return f.environment.has(norm);
                });
            } else if (f.environment === '__empty__') {
                result = result.filter(s => !s.environment || s.environment.trim() === '');
            } else {
                const envTerm = this._normalizeEnvironment(f.environment);
                result = result.filter(s =>
                    this._normalizeEnvironment(s.environment) === envTerm
                );
            }
        }

        // ─── סוג שרת ───
        if (f.isVirtual !== 'all') {
            if (f.isVirtual instanceof Set) {
                result = result.filter(s => {
                    const norm = this._normalizeVirtual(s.isVirtual);
                    if (f.isVirtual.has('__empty__') && (!s.isVirtual || s.isVirtual.trim() === '')) return true;
                    return f.isVirtual.has(norm);
                });
            } else if (f.isVirtual === '__empty__') {
                result = result.filter(s => !s.isVirtual || s.isVirtual.trim() === '');
            } else {
                result = result.filter(s =>
                    this._normalizeVirtual(s.isVirtual) === f.isVirtual.toUpperCase()
                );
            }
        }

        // ─── שאר הפילטרים עם filterField ───
        result = filterField(result, f.systemStatus,
            s => s.systemStatus || '');

        result = filterField(result, f.isHealthy,
            s => s.isHealthy || '');

        result = filterField(result, f.department,
            s => s.department || '');

        result = filterField(result, f.team,
            s => s.team || '');

        // ─── OS - מיוחד ───
        if (f.os !== 'all') {
            if (f.os === '__empty__') {
                result = result.filter(s =>
                    !s.os || s.os.trim() === ''
                );
            } else {
                result = result.filter(s =>
                    this._simplifyOs(s.os) === f.os
                );
            }
        }

        // ─── BigFix ───
        if (f.bigfixStatus !== 'all') {
            result = result.filter(s => {
                const key = (s.name || '').toLowerCase();
                const status = this.bigFixData[key];

                const getVal = () => {
                    if (!status) return 'notfound';
                    let raw = (status.pendingRestart || status.PendingRestart || '').trim();
                    if (raw === 'True' || raw === 'TRUE') raw = 'Need Restart';
                    if (raw === 'False' || raw === 'FALSE') raw = 'Completed';
                    return raw;
                };

                if (f.bigfixStatus instanceof Set) {
                    const val = getVal();
                    return f.bigfixStatus.has(val);
                }

                if (f.bigfixStatus === 'notfound') return !status;
                if (!status) return false;
                return getVal() === f.bigfixStatus;
            });
        }

        result = filterField(result, f.systemName,
            s => s.systemName || '');

        result = filterField(result, f.systemManager,
            s => s.systemManager || '');

        result = filterField(result, f.bootType,
            s => s.bootType || '');

        result = filterField(result, f.domain,
            s => s.domain || '');

        result = filterField(result, f.canShutdown,
            s => s.canShutdown || '');

        result = filterField(result, f.catalogNumber,
            s => s.catalogNumber || '');

        // ─── מיון ───
        const col = this.sortColumn;
        const dir = this.sortDirection === 'asc' ? 1 : -1;

        result.sort((a, b) => {
            // ─── מיון מיוחד לעמודת תאריך BigFix ───
            if (col === 'bigfixDate') {
                const keyA = (a.name || '').toLowerCase();
                const keyB = (b.name || '').toLowerCase();
                const statA = this.bigFixData[keyA];
                const statB = this.bigFixData[keyB];

                const dateA = statA?.lastReport
                    ? new Date(statA.lastReport).getTime()
                    : 0;
                const dateB = statB?.lastReport
                    ? new Date(statB.lastReport).getTime()
                    : 0;

                // שרתים ללא תאריך - תמיד בסוף
                if (dateA === 0 && dateB === 0) return 0;
                if (dateA === 0) return 1;
                if (dateB === 0) return -1;

                return (dateA - dateB) * dir;
            }

            // ─── מיון מיוחד לעמודת סטטוס BigFix ───
            if (col === 'bigfixStatus') {
                const ORDER = {
                    'Need Restart': 1,
                    'Not Completed': 2,
                    'Not Reboot 120 day': 3,
                    'Pending Restart': 4,
                    'Completed': 5,
                    '': 6,
                };

                const keyA = (a.name || '').toLowerCase();
                const keyB = (b.name || '').toLowerCase();
                const statA = this.bigFixData[keyA];
                const statB = this.bigFixData[keyB];

                const rawA = (statA?.pendingRestart || '').trim();
                const rawB = (statB?.pendingRestart || '').trim();

                const normA = rawA === 'True' ? 'Need Restart'
                    : rawA === 'False' ? 'Completed'
                        : rawA;
                const normB = rawB === 'True' ? 'Need Restart'
                    : rawB === 'False' ? 'Completed'
                        : rawB;

                const orderA = ORDER[normA] ?? 5;
                const orderB = ORDER[normB] ?? 5;

                return (orderA - orderB) * dir;
            }

            // ─── מיון רגיל ───
            const av = (a[col] || '').toString().toLowerCase();
            const bv = (b[col] || '').toString().toLowerCase();
            return av.localeCompare(bv, 'he') * dir;
        });

        this.filteredServers = result;
        this.currentPage = 1;
        this._updateFilterCounter();
    }

    _normalizeVirtual(val) {
        if (val === null || val === undefined || val === '') return 'UNKNOWN';
        const s = String(val).trim().toUpperCase();

        // TRUE / וירטואלי
        if (s === 'TRUE' || s === '1' || s === 'YES' || s === 'כן') return 'TRUE';
        if (s === 'וירטואלי' || s.includes('וירטואל')) return 'TRUE';
        if (s === '☁️ וירטואלי') return 'TRUE';

        // FALSE / פיזי
        if (s === 'FALSE' || s === '0' || s === 'NO' || s === 'לא') return 'FALSE';
        if (s === 'פיזי' || s.includes('פיזי')) return 'FALSE';
        if (s === '🖥️ פיזי') return 'FALSE';

        return 'UNKNOWN';
    }

    // ══════════════════════════════════════════════════════════
    // רינדור מעטפת
    // ══════════════════════════════════════════════════════════
    renderShell() {
        this.container.innerHTML = `
        <div class="srv-root">

            <!-- ══ Header ══ -->
            <div class="srv-header">
                <div class="srv-header-left">

                    <!-- חיפוש -->
                    <div class="srv-search-wrap">
                        <i class="fas fa-search srv-search-icon"></i>
                        <input id="srvSearch" class="srv-search-input"
                               type="text" placeholder="חיפוש שרת, מחלקה, מנהל..."/>
                        <button id="srvClearSearch"
                                class="srv-clear-btn" style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>

                    <!-- פילטרים - כפתור פתיחה -->
                    <div class="srv-filters-wrap">
                        <div class="srv-filters-toggle-row">
                            <button id="srvFiltersToggle" class="srv-filters-toggle-btn">
                                <i class="fas fa-filter"></i>
                                פילטרים
                                <span id="srvFiltersBadge" class="srv-filters-badge" style="display:none">0</span>
                                <i class="fas fa-chevron-down srv-filters-chevron" id="srvFiltersChevron"></i>
                            </button>
                            <!-- תגיות פילטרים פעילים - מחוץ לפופאפ -->
                            <div id="srvActiveFilterTags" class="srv-active-filter-tags"></div>
                        </div>

                        <!-- פופאפ פילטרים -->
                        <div id="srvFiltersPopup" class="srv-filters-popup" style="display:none">
                            <div class="srv-filters-popup-header">
                                <span class="srv-filters-popup-title">
                                    <i class="fas fa-filter"></i> סינון שרתים
                                </span>
                                <button id="srvClearFilters" class="srv-clear-filters-btn" title="נקה הכל">
                                    <i class="fas fa-filter-circle-xmark"></i> נקה הכל
                                </button>
                            </div>

                            <div class="srv-filters-popup-grid">

                                <div class="srv-filter-group" data-filter-key="environment">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-industry" style="color:#6366f1;font-size:0.7rem"></i>
                                        סביבה
                                    </label>
                                    <select id="srvFltEnv" class="srv-select">
                                        <option value="all">כל הסביבות</option>
                                        <option value="PROD">PROD</option>
                                        <option value="NONPROD">NONPROD</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="isVirtual">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-server" style="color:#6366f1;font-size:0.7rem"></i>
                                        סוג שרת
                                    </label>
                                    <select id="srvFltVirtual" class="srv-select">
                                        <option value="all">הכל</option>
                                    </select>
                                </div>


                                <div class="srv-filter-group" data-filter-key="os">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-desktop" style="color:#6366f1;font-size:0.7rem"></i>
                                        מערכת הפעלה
                                    </label>
                                    <select id="srvFltOs" class="srv-select">
                                        <option value="all">כל ה-OS</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="systemName">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-layer-group" style="color:#6366f1;font-size:0.7rem"></i>
                                        מערכת
                                    </label>
                                    <select id="srvFltSystemName" class="srv-select">
                                        <option value="all">כל המערכות</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="systemStatus">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-circle-dot" style="color:#6366f1;font-size:0.7rem"></i>
                                        סטטוס מערכת
                                    </label>
                                    <select id="srvFltStatus" class="srv-select">
                                        <option value="all">כל הסטטוסים</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="systemManager">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-user-tie" style="color:#6366f1;font-size:0.7rem"></i>
                                        מנהל מערכת
                                    </label>
                                    <select id="srvFltSystemManager" class="srv-select">
                                        <option value="all">כל המנהלים</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="team">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-users" style="color:#6366f1;font-size:0.7rem"></i>
                                        צוות
                                    </label>
                                    <select id="srvFltTeam" class="srv-select">
                                        <option value="all">כל הצוותים</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="department">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-building" style="color:#6366f1;font-size:0.7rem"></i>
                                        מחלקה
                                    </label>
                                    <select id="srvFltDept" class="srv-select">
                                        <option value="all">כל המחלקות</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="domain">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-sitemap" style="color:#6366f1;font-size:0.7rem"></i>
                                        תחום
                                    </label>
                                    <select id="srvFltDomain" class="srv-select">
                                        <option value="all">כל התחומים</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="bootType">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-power-off" style="color:#6366f1;font-size:0.7rem"></i>
                                        סוג אתחול
                                    </label>
                                    <select id="srvFltBootType" class="srv-select">
                                        <option value="all">כל סוגי האתחול</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="canShutdown">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-toggle-on" style="color:#6366f1;font-size:0.7rem"></i>
                                        ניתן לכבות
                                    </label>
                                    <select id="srvFltCanShutdown" class="srv-select">
                                        <option value="all">הכל</option>
                                        <option value="כן">כן</option>
                                        <option value="לא">לא</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="isHealthy">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-heart" style="color:#6366f1;font-size:0.7rem"></i>
                                        תקינות
                                    </label>
                                    <select id="srvFltHealthy" class="srv-select">
                                        <option value="all">כל התקינות</option>
                                    </select>
                                </div>

                                <div class="srv-filter-group" data-filter-key="bigfixStatus">
                                    <label class="srv-filter-label">
                                        <i class="fas fa-shield-alt" style="color:#6366f1;font-size:0.7rem"></i>
                                        BigFix Updates
                                    </label>
                                    <select id="srvFltBigfix" class="srv-select">
                                        <option value="all">כל הסטטוסים</option>
                                    </select>
                                </div>

                            </div>
                        </div>
                    </div>
                </div>

                <div class="srv-header-right">
                    <!-- מונה -->
                    <div class="srv-counter" id="srvCounter"></div>

                    <!-- מצב תצוגה -->
                    <div class="srv-view-btns">
                        <button class="srv-view-btn active"
                                id="srvViewTable" title="טבלה">
                            <i class="fas fa-table"></i>
                        </button>
                        <button class="srv-view-btn"
                                id="srvViewCards" title="כרטיסים">
                            <i class="fas fa-th-large"></i>
                        </button>
                        <button class="srv-view-btn"
                                id="srvViewStats" title="סטטיסטיקות">
                            <i class="fas fa-chart-bar"></i>
                        </button>
                    </div>

                    <!-- גודל עמוד -->
                    <select id="srvPageSize" class="srv-select">
                        <option value="25"   ${this.pageSize === 25 ? 'selected' : ''}>25 שורות</option>
                        <option value="50"   ${this.pageSize === 50 ? 'selected' : ''}>50 שורות</option>
                        <option value="100"  ${this.pageSize === 100 ? 'selected' : ''}>100 שורות</option>
                        <option value="200"  ${this.pageSize === 200 ? 'selected' : ''}>200 שורות</option>
                        <option value="9999" ${this.pageSize === 9999 ? 'selected' : ''}>הכל</option>
                    </select>

                    <!-- Auto-fill Bulk -->
                    <button id="srvAutoFillBulkBtn"
                            class="srv-autofill-bulk-btn srv-admin-only"
                            title="מלא אוטומטית צוות/מחלקה/תחום לכל הרשומות"
                            style="display:none">
                        <i class="fas fa-magic"></i>
                        Auto-fill
                    </button>
                    <button id="srvBulkGapsBtn" class="srv-btn srv-btn-warning">
                        פערים
                    </button>

                    <!-- איפוס תקינות -->
                    <button id="srvResetHealthBtn" class="srv-reset-health-btn srv-admin-only"
                            title="אפס את כל ערכי התקינות"
                            style="display:none">
                        <i class="fas fa-heart-broken"></i>
                        איפוס תקינות
                    </button>
                    <button id="srvPatchExcludeBtn"
                            class="srv-patch-exclude-btn srv-admin-only"
                            title="הוסף קידומת מוחרג לשרתים מקובץ">
                        <i class="fas fa-ban"></i>
                        מוחרג
                    </button>
                    <button id="srvImportBtn" class="srv-import-btn srv-admin-only"
                            title="ייבא שרתים מקובץ אקסל"
                            style="display:none">
                        <i class="fas fa-file-excel"></i>
                        ייבא אקסל
                    </button>
                    <button id="srvAddServerBtn" class="srv-add-server-btn srv-admin-only"
                            title="הוסף שרת חדש"
                            style="display:none">
                        <i class="fas fa-plus-circle"></i>
                        הוסף שרת
                    </button>
                    <!-- ניהול הרשאות -->
                    <button id="srvPermissionsBtn"
                            class="srv-permissions-btn srv-admin-only"
                            title="ניהול הרשאות"
                            style="display:none">
                        <i class="fas fa-user-shield"></i>
                    </button>
                    <!-- ייצוא -->
                    <button id="srvExportBtn" class="srv-export-btn"
                            title="ייצא לאקסל">
                        <i class="fas fa-file-excel"></i>
                    </button>

                    <!-- רענון -->
                    <button id="srvRefreshBtn" class="srv-refresh-btn"
                            title="רענן">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <span id="srvLastUpdate" class="srv-last-update"></span>
                </div>
            </div>

            <!-- ══ Stats Bar ══ -->
            <div class="srv-stats-bar" id="srvStatsBar"></div>

            <!-- ══ הודעות ══ -->
            <div id="srvError"   class="srv-error"
                 style="display:none"></div>
            <div id="srvLoading" class="srv-loading"
                 style="display:none">
                <i class="fas fa-spinner fa-spin"></i> טוען נתונים...
            </div>

            <!-- ══ Multi-Select Toolbar ══ -->
            <div id="srvMultiToolbar" class="srv-multi-toolbar"
                style="display:none">
                <div class="srv-multi-toolbar-right">
                    <span class="srv-multi-count">
                        <i class="fas fa-check-square"></i>
                        <span id="srvMultiCount">0</span>
                        שרתים נבחרו
                    </span>
                    <button class="srv-multi-clear-btn"
                            id="srvMultiClear"
                            title="בטל בחירה">
                        <i class="fas fa-times"></i>
                        בטל בחירה
                    </button>
                </div>
                <div class="srv-multi-toolbar-left">
                    <button class="srv-multi-action-btn srv-multi-edit-btn"
                            id="srvMultiEditBtn"
                            title="ערוך שדות נבחרים">
                        <i class="fas fa-edit"></i>
                        ערוך נבחרים
                    </button>
                    <button class="srv-multi-action-btn srv-multi-delete-btn"
                            id="srvMultiDeleteBtn"
                            title="מחק שרתים נבחרים">
                        <i class="fas fa-trash-alt"></i>
                        מחק נבחרים
                    </button>
                    <button class="srv-multi-action-btn srv-multi-bigfix-btn"
                            id="srvMultiBigFixBtn"
                            title="בדוק BigFix לשרתים נבחרים">
                        <i class="fas fa-shield-alt"></i>
                        Check updates
                    </button>
                </div>
            </div>

            <!-- ══ Toast ══ -->
            <div id="srvToast" class="srv-toast"></div>

            <!-- ══ תוכן + Pagination בתוך wrapper גלילה ══ -->
            <div class="srv-scroll-wrapper">
                <div id="srvContent" class="srv-content"></div>
                <div id="srvPagination" class="srv-pagination"></div>
            </div>

        </div>`;
    }

    openAddServerModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה להוספת שרת', 'error');
            return;
        }

        const existing = document.getElementById('srvAddModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'srvAddModal';
        modal.className = 'srv-modal-overlay';

        modal.innerHTML = `
    <div class="srv-modal srv-edit-modal">

        <!-- כותרת -->
        <div class="srv-modal-header srv-add-modal-header">
            <h3 class="srv-modal-title">
                <i class="fas fa-plus-circle"
                   style="color:#22c55e"></i>
                הוספת שרת חדש
                <span class="srv-admin-badge-inline">
                    <i class="fas fa-shield-alt"></i>
                    Admin
                </span>
            </h3>
            <button class="srv-modal-close"
                    id="srvAddClose">&times;</button>
        </div>

        <!-- גוף -->
        <div class="srv-modal-body srv-edit-modal-body">

            <!-- שם שרת - שדה חובה -->
            <div class="srv-edit-field srv-edit-field-full">
                <label class="srv-edit-label">
                    <i class="fas fa-server"></i>
                    שם שרת
                    <span class="srv-required-badge">* חובה</span>
                </label>
                <input type="text"
                       id="srvAddName"
                       class="srv-edit-input srv-add-required-field"
                       placeholder="שם השרת..."
                       autocomplete="off"/>
                <div class="srv-add-field-error"
                     id="srvAddNameError"
                     style="display:none">
                    <i class="fas fa-exclamation-circle"></i>
                    שם שרת נדרש
                </div>
            </div>

            <!-- שורה 1: סביבה + סוג + סטטוס + תקינות -->
            <div class="srv-edit-row">
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-industry"></i>
                        סביבה
                    </label>
                    <select id="srvAddEnv"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="PROD">PROD</option>
                        <option value="NONPROD">NONPROD</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-server"></i>
                        סוג שרת
                    </label>
                    <select id="srvAddVirtual"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="TRUE">☁️ וירטואלי</option>
                        <option value="FALSE">🖥️ פיזי</option>
                        <option value="UNKNOWN">❓ לא ידוע</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-circle-dot"></i>
                        סטטוס מערכת
                    </label>
                    <select id="srvAddStatus"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="פעילה">פעילה</option>
                        <option value="לא פעילה">לא פעילה</option>
                        <option value="בבדיקה">בבדיקה</option>
                        <option value="מושבת">מושבת</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-heart"></i>
                        תקינות
                    </label>
                    <select id="srvAddHealthy"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="תקין">תקין</option>
                        <option value="לא תקין">לא תקין</option>
                        <option value="בבדיקה">בבדיקה</option>
                    </select>
                </div>
            </div>

            <!-- שורה 2: OS + יצרן -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-desktop"></i>
                        מערכת הפעלה
                    </label>
                    <input type="text"
                           id="srvAddOs"
                           class="srv-edit-input"
                           placeholder="Windows Server 2019..."/>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-microchip"></i>
                        יצרן חומרה
                    </label>
                    <input type="text"
                           id="srvAddVendor"
                           class="srv-edit-input"
                           placeholder="Dell, HP, VMware..."/>
                </div>
            </div>

            <!-- שורה 3: שם מערכת + קטלוג -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide" style="position:relative">
                    <label class="srv-edit-label">
                        <i class="fas fa-layer-group"></i>
                        שם מערכת
                        <span style="font-size:0.68rem;color:#555;font-weight:400;margin-right:4px">
                            (מהקטלוג)
                        </span>
                    </label>
                    <div class="srv-system-combo-wrap" id="srvAddSystemNameWrap">
                        <div style="position:relative">
                            <input type="text"
                                id="srvAddSystemName"
                                class="srv-edit-input"
                                placeholder="חפש שם מערכת..."
                                autocomplete="off"/>
                            <i class="fas fa-chevron-down"
                            style="position:absolute;left:10px;top:50%;
                                    transform:translateY(-50%);
                                    color:#555;font-size:0.65rem;
                                    pointer-events:none"
                            id="srvAddSystemNameChevron"></i>
                        </div>
                        <div class="srv-system-combo-dropdown"
                            id="srvAddSystemNameDropdown"
                            style="display:none">
                            <div class="srv-system-combo-loading"
                                id="srvAddSystemNameLoading">
                                <i class="fas fa-spinner fa-spin"></i>
                                טוען מערכות...
                            </div>
                            <div class="srv-system-combo-list"
                                id="srvAddSystemNameList"></div>
                        </div>
                    </div>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-hashtag"></i>
                        מספר קטלוג
                    </label>
                    <input type="text"
                           id="srvAddCatalog"
                           class="srv-edit-input"
                           placeholder="מספר קטלוג..."/>
                </div>
            </div>

            <!-- שורה 4: מנהל + צוות + מחלקה -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-user-tie"></i>
                        מנהל מערכת
                        <button type="button"
                                id="srvAddAutoFillBtn"
                                class="srv-autofill-btn"
                                title="מלא אוטומטית צוות/מחלקה/תחום לפי שם המנהל">
                            <i class="fas fa-magic"></i>
                        </button>
                    </label>
                    <input type="text"
                        id="srvAddManager"
                           class="srv-edit-input"
                           placeholder="שם מנהל המערכת..."/>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-users"></i>
                        צוות
                    </label>
                    <input type="text"
                           id="srvAddTeam"
                           class="srv-edit-input"
                           placeholder="שם הצוות..."/>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-building"></i>
                        מחלקה
                    </label>
                    <input type="text"
                           id="srvAddDept"
                           class="srv-edit-input"
                           placeholder="שם המחלקה..."/>
                </div>
            </div>

            <!-- שורה 5: תחום + IP + אתחול + כיבוי -->
            <div class="srv-edit-row">
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-sitemap"></i>
                        תחום
                    </label>
                    <input type="text"
                           id="srvAddDomain"
                           class="srv-edit-input"
                           placeholder="תחום..."/>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-network-wired"></i>
                        כתובת IP
                    </label>
                    <input type="text"
                           id="srvAddIp"
                           class="srv-edit-input"
                           placeholder="192.168.1.1"/>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-power-off"></i>
                        סוג אתחול
                    </label>
                    <select id="srvAddBootType"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="ידני">ידני</option>
                        <option value="אוטומטי">אוטומטי</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-toggle-on"></i>
                        ניתן לכבות
                    </label>
                    <select id="srvAddShutdown"
                            class="srv-select srv-edit-select">
                        <option value="">— לא הוגדר —</option>
                        <option value="כן">כן</option>
                        <option value="לא">לא</option>
                    </select>
                </div>
            </div>

            <!-- הערות -->
            <div class="srv-edit-field srv-edit-field-full">
                <label class="srv-edit-label">
                    <i class="fas fa-sticky-note"></i>
                    הערות
                </label>
                <textarea id="srvAddNotes"
                          class="srv-form-textarea"
                          rows="3"
                          placeholder="הערות..."></textarea>
            </div>

        </div>

        <!-- Footer -->
        <div class="srv-modal-footer">
            <button class="srv-modal-cancel-btn"
                    id="srvAddCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button class="srv-add-save-btn"
                    id="srvAddSave">
                <i class="fas fa-plus-circle"></i>
                הוסף שרת
            </button>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ─── אתחל combobox שם מערכת ───────────────────────────────
        this._initSystemNameComboForModal(
            'srvAddSystemName',
            'srvAddSystemNameDropdown',
            'srvAddSystemNameList',
            'srvAddSystemNameLoading',
            'srvAddSystemNameChevron',
            'srvAddCatalog',
            'srvAddModal'
        );

        // ─── אירועים ─────────────────────────────────────────
        const closeModal = () => modal.remove();

        document.getElementById('srvAddClose')
            .addEventListener('click', closeModal);
        document.getElementById('srvAddCancel')
            .addEventListener('click', closeModal);

        // ─── ניקוי שגיאה בהקלדה ──────────────────────────────
        document.getElementById('srvAddName')
            .addEventListener('input', () => {
                const err = document.getElementById('srvAddNameError');
                if (err) err.style.display = 'none';
                document.getElementById('srvAddName')
                    ?.classList.remove('srv-add-input-error');
            });

        document.getElementById('srvAddSave')
            .addEventListener('click', () =>
                this._saveNewServer(modal)
            );

        // ─── Auto-fill לפי מנהל מערכת ────────────────────────────────
        document.getElementById('srvAddAutoFillBtn')
            ?.addEventListener('click', () => {
                const name = document
                    .getElementById('srvAddManager')?.value?.trim();
                name
                    ? this._autoFillOrgInfo(name, 'srvAdd')
                    : this.showToast('הזן שם מנהל מערכת תחילה', 'info');
            });

        document.getElementById('srvAddManager')
            ?.addEventListener('blur', e => {
                const val = e.target.value?.trim();
                if (val?.length >= 2)
                    this._autoFillOrgInfo(val, 'srvAdd');
            });

        // ─── Focus על שדה השם ─────────────────────────────────
        setTimeout(() => {
            document.getElementById('srvAddName')?.focus();
        }, 100);
    }

    async _saveNewServer(modal) {
        const saveBtn = document.getElementById('srvAddSave');

        // ─── ולידציה ─────────────────────────────────────────
        const nameInput = document.getElementById('srvAddName');
        const serverName = nameInput?.value?.trim() ?? '';

        if (!serverName) {
            nameInput?.classList.add('srv-add-input-error');
            const err = document.getElementById('srvAddNameError');
            if (err) err.style.display = 'flex';
            nameInput?.focus();
            return;
        }

        // ─── בדוק אם שרת כבר קיים ────────────────────────────
        const exists = this.allServers.some(
            s => s.name.toLowerCase() === serverName.toLowerCase()
        );

        if (exists) {
            nameInput?.classList.add('srv-add-input-error');
            const err = document.getElementById('srvAddNameError');
            if (err) {
                err.innerHTML = `<i class="fas fa-exclamation-circle"></i>
                שרת בשם "${this.escHtml(serverName)}" כבר קיים`;
                err.style.display = 'flex';
            }
            nameInput?.focus();
            return;
        }

        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const payload = {
                serverName,
                environment: document.getElementById('srvAddEnv')
                    ?.value || null,
                isVirtual: document.getElementById('srvAddVirtual')
                    ?.value || null,
                systemStatus: document.getElementById('srvAddStatus')
                    ?.value || null,
                isHealthy: document.getElementById('srvAddHealthy')
                    ?.value || null,
                os: document.getElementById('srvAddOs')
                    ?.value?.trim() || null,
                hardwareVendor: document.getElementById('srvAddVendor')
                    ?.value?.trim() || null,
                systemName: document.getElementById('srvAddSystemName')
                    ?.value?.trim() || null,
                catalogNumber: document.getElementById('srvAddCatalog')
                    ?.value?.trim() || null,
                systemManager: document.getElementById('srvAddManager')
                    ?.value?.trim() || null,
                team: document.getElementById('srvAddTeam')
                    ?.value?.trim() || null,
                department: document.getElementById('srvAddDept')
                    ?.value?.trim() || null,
                domain: document.getElementById('srvAddDomain')
                    ?.value?.trim() || null,
                scannedVia: document.getElementById('srvAddIp')
                    ?.value?.trim() || null,
                bootType: document.getElementById('srvAddBootType')
                    ?.value || null,
                canShutdown: document.getElementById('srvAddShutdown')
                    ?.value || null,
                notes: document.getElementById('srvAddNotes')
                    ?.value?.trim() || null,
            };

            const res = await fetch('/Servers/AddServer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בהוספה');

            // ─── הוסף לזיכרון ────────────────────────────────
            if (data.server) {
                this.allServers.push(data.server);
            }

            modal.remove();

            // ─── רענן תצוגה ──────────────────────────────────
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this._populateDropdownFilters();

            this.showToast(
                `✅ שרת ${serverName} נוסף בהצלחה`, 'success'
            );

        } catch (err) {
            console.error('_saveNewServer error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-plus-circle"></i> הוסף שרת';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל עריכה מרובה
    // ══════════════════════════════════════════════════════════
    openMultiEditModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לעריכה', 'error');
            return;
        }

        if (this.selectedServers.size === 0) {
            this.showToast('לא נבחרו שרתים', 'error');
            return;
        }

        const existing = document.getElementById('srvMultiEditModal');
        if (existing) existing.remove();

        const count = this.selectedServers.size;

        // ─── בנה רשימות ערכים קיימים מהנתונים ───
        const getUniqueValues = (field) => {
            return [...new Set(
                this.allServers
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

        const teams = getUniqueValues('team');
        const departments = getUniqueValues('department');
        const domains = getUniqueValues('domain');
        const systemNames = getUniqueValues('systemName');
        const managers = getUniqueValues('systemManager');
        const osList = [...new Set(
            this.allServers
                .map(s => this._simplifyOs(s.os))
                .filter(v => v && v !== 'לא ידוע')
        )].sort();
        const vendors = getUniqueValues('hardwareVendor');
        const catalogs = getUniqueValues('catalogNumber');

        const modal = document.createElement('div');
        modal.id = 'srvMultiEditModal';
        modal.className = 'srv-modal-overlay';
        modal.innerHTML = `
    <div class="srv-modal srv-multi-edit-modal">

        <!-- כותרת -->
        <div class="srv-modal-header srv-multi-edit-header">
            <h3 class="srv-modal-title">
                <i class="fas fa-edit" style="color:#6366f1"></i>
                עריכה מרובה
                <span class="srv-multi-edit-count-badge">
                    ${count} שרתים
                </span>
            </h3>
            <button class="srv-modal-close"
                    id="srvMultiEditClose">&times;</button>
        </div>

        <!-- הסבר -->
        <div class="srv-multi-edit-info">
            <i class="fas fa-info-circle"></i>
            <span>
                רק שדות שתמלא <strong>יעודכנו</strong>.
                שדות ריקים לא ישנו את הערך הקיים.
            </span>
        </div>

        <!-- גוף -->
        <div class="srv-modal-body srv-multi-edit-body">

            <!-- שורה 1: סביבה + סוג שרת + סטטוס + תקינות -->
            <div class="srv-edit-row">
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-industry"></i>
                        סביבה
                    </label>
                    <select id="srvMEEnv"
                            class="srv-select srv-edit-select">
                        <option value="">— ללא שינוי —</option>
                        <option value="PROD">PROD</option>
                        <option value="NONPROD">NONPROD</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-server"></i>
                        סוג שרת
                    </label>
                    <select id="srvMEVirtual"
                            class="srv-select srv-edit-select">
                        <option value="">— ללא שינוי —</option>
                        <option value="TRUE">☁️ וירטואלי</option>
                        <option value="FALSE">🖥️ פיזי</option>
                        <option value="UNKNOWN">❓ לא ידוע</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-circle-dot"></i>
                        סטטוס מערכת
                    </label>
                    <select id="srvMEStatus"
                            class="srv-select srv-edit-select">
                        <option value="">— ללא שינוי —</option>
                        <option value="פעילה">פעילה</option>
                        <option value="לא פעילה">לא פעילה</option>
                        <option value="בבדיקה">בבדיקה</option>
                        <option value="מושבת">מושבת</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-heart"></i>
                        תקינות
                    </label>
                    <select id="srvMEHealthy"
                            class="srv-select srv-edit-select">
                        <option value="">— ללא שינוי —</option>
                        <option value="תקין">תקין</option>
                        <option value="לא תקין">לא תקין</option>
                        <option value="בבדיקה">בבדיקה</option>
                    </select>
                </div>
            </div>

            <!-- שורה 2: מנהל + צוות + מחלקה -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-user-tie"></i>
                        מנהל מערכת
                        <button type="button"
                                id="srvMEAutoFillBtn"
                                class="srv-autofill-btn"
                                title="מלא אוטומטית צוות/מחלקה/תחום לפי שם המנהל">
                            <i class="fas fa-magic"></i>
                        </button>
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMEManagerSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(managers)}
                        </select>
                        <input type="text"
                            id="srvMEManager"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-users"></i>
                        צוות
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMETeamSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(teams)}
                        </select>
                        <input type="text"
                            id="srvMETeam"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-building"></i>
                        מחלקה
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMEDeptSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(departments)}
                        </select>
                        <input type="text"
                            id="srvMEDept"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
            </div>

            <!-- שורה 3: תחום + שם מערכת + מספר קטלוג -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-sitemap"></i>
                        תחום
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMEDomainSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(domains)}
                        </select>
                        <input type="text"
                            id="srvMEDomain"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-layer-group"></i>
                        שם מערכת
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMESystemNameSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(systemNames)}
                        </select>
                        <input type="text"
                            id="srvMESystemName"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-hashtag"></i>
                        מספר קטלוג
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMECatalogSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(catalogs)}
                        </select>
                        <input type="text"
                            id="srvMECatalog"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
            </div>

            <!-- שורה 4: OS + יצרן חומרה -->
            <div class="srv-edit-row">
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-desktop"></i>
                        מערכת הפעלה
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMEOsSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(osList)}
                        </select>
                        <input type="text"
                            id="srvMEOs"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
                <div class="srv-edit-field srv-edit-field-wide">
                    <label class="srv-edit-label">
                        <i class="fas fa-microchip"></i>
                        יצרן חומרה
                    </label>
                    <div class="srv-me-combo-wrap">
                        <select id="srvMEVendorSelect"
                                class="srv-select srv-edit-select srv-me-combo-select">
                            ${buildSelectOptions(vendors)}
                        </select>
                        <input type="text"
                            id="srvMEVendor"
                            class="srv-edit-input srv-me-combo-input"
                            placeholder="או הקלד ידנית..."/>
                    </div>
                </div>
            </div>

            <div class="srv-edit-row">
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-power-off"></i>
                        סוג אתחול
                    </label>
                    <select id="srvMEBootType"
                            class="srv-select srv-edit-select">
                        <option value="">— ללא שינוי —</option>
                        <option value="ידני">ידני</option>
                        <option value="אוטומטי">אוטומטי</option>
                    </select>
                </div>
                <div class="srv-edit-field">
                    <label class="srv-edit-label">
                        <i class="fas fa-toggle-on"></i>
                        ניתן לכבות
                    </label>
                    <select id="srvMEShutdown"
                            class="srv-select srv-edit-select">
                        <option value="">— ללא שינוי —</option>
                        <option value="כן">כן</option>
                        <option value="לא">לא</option>
                    </select>
                </div>
            </div>

            <!-- הערות -->
            <div class="srv-edit-field srv-edit-field-full">
                <label class="srv-edit-label">
                    <i class="fas fa-sticky-note"></i>
                    הערות
                    <span class="srv-multi-field-hint">
                        (יחליף את ההערה הקיימת)
                    </span>
                </label>
                <textarea id="srvMENotes"
                        class="srv-form-textarea"
                        rows="2"
                        placeholder="— ללא שינוי —"></textarea>
            </div>

            <!-- הערות מיפוי -->
            <div class="srv-edit-field srv-edit-field-full">
                <label class="srv-edit-label">
                    <i class="fas fa-map"></i>
                    הערות מיפוי
                    <span class="srv-multi-field-hint">
                        (יחליף את הערת המיפוי הקיימת)
                    </span>
                </label>
                <textarea id="srvMEMappingNotes"
                        class="srv-form-textarea"
                        rows="2"
                        placeholder="— ללא שינוי —"></textarea>
            </div>

            <!-- רשימת שרתים נבחרים -->
            <div class="srv-multi-selected-list">
                <div class="srv-multi-selected-title">
                    <i class="fas fa-list"></i>
                    שרתים שיעודכנו:
                </div>
                <div class="srv-multi-selected-names">
                    ${[...this.selectedServers].map(name => `
                        <span class="srv-multi-selected-tag">
                            ${this.escHtml(name)}
                        </span>
                    `).join('')}
                </div>
            </div>

        </div>

        <!-- Footer -->
        <div class="srv-modal-footer">
            <button class="srv-modal-cancel-btn"
                    id="srvMultiEditCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button class="srv-edit-save-btn"
                    id="srvMultiEditSave">
                <i class="fas fa-save"></i>
                עדכן ${count} שרתים
            </button>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ─── קשר כל select לinput המתאים (combo behavior) ───
        const comboPairs = [
            { selectId: 'srvMEManagerSelect', inputId: 'srvMEManager' },
            { selectId: 'srvMETeamSelect', inputId: 'srvMETeam' },
            { selectId: 'srvMEDeptSelect', inputId: 'srvMEDept' },
            { selectId: 'srvMEDomainSelect', inputId: 'srvMEDomain' },
            { selectId: 'srvMESystemNameSelect', inputId: 'srvMESystemName' },
            { selectId: 'srvMECatalogSelect', inputId: 'srvMECatalog' },
            { selectId: 'srvMEOsSelect', inputId: 'srvMEOs' },
            { selectId: 'srvMEVendorSelect', inputId: 'srvMEVendor' },
        ];

        comboPairs.forEach(({ selectId, inputId }) => {
            const sel = document.getElementById(selectId);
            const inp = document.getElementById(inputId);
            if (!sel || !inp) return;

            // ── בחירה מהרשימה → מלא את ה-input ──
            sel.addEventListener('change', () => {
                if (sel.value) {
                    inp.value = sel.value;
                    inp.classList.add('srv-autofilled');
                    setTimeout(() =>
                        inp.classList.remove('srv-autofilled'), 2000);
                } else {
                    inp.value = '';
                }
            });

            // ── הקלדה ידנית → אפס את ה-select ──
            inp.addEventListener('input', () => {
                sel.value = '';
            });
        });

        // ─── אירועים ───
        const closeModal = () => modal.remove();

        document.getElementById('srvMultiEditClose')
            .addEventListener('click', closeModal);
        document.getElementById('srvMultiEditCancel')
            .addEventListener('click', closeModal);

        document.getElementById('srvMultiEditSave')
            .addEventListener('click', () =>
                this._saveMultiEdit(modal)
            );

        // ─── Auto-fill לפי מנהל מערכת ───
        document.getElementById('srvMEAutoFillBtn')
            ?.addEventListener('click', () => {
                const name = document
                    .getElementById('srvMEManager')?.value?.trim();
                name
                    ? this._autoFillOrgInfo(name, 'srvME')
                    : this.showToast('הזן שם מנהל מערכת תחילה', 'info');
            });

        document.getElementById('srvMEManager')
            ?.addEventListener('blur', e => {
                const val = e.target.value?.trim();
                if (val?.length >= 2)
                    this._autoFillOrgInfo(val, 'srvME');
            });
    }

    // ─── שמור עריכה מרובה ────────────────────────────────────────
    async _saveMultiEdit(modal) {
        const saveBtn = document.getElementById('srvMultiEditSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            // ─── עזר: קרא ערך מ-input (עדיפות) או מ-select ───
            const getComboValue = (inputId, selectId) => {
                const inputVal = document.getElementById(inputId)?.value?.trim();
                if (inputVal) return inputVal;
                const selectVal = document.getElementById(selectId)?.value;
                return selectVal || '';
            };

            const updates = {};

            const env = document.getElementById('srvMEEnv')?.value;
            if (env) updates.environment = env;

            const virtual_ = document.getElementById('srvMEVirtual')?.value;
            if (virtual_) updates.isVirtual = virtual_;

            const status = document.getElementById('srvMEStatus')?.value;
            if (status) updates.systemStatus = status;

            const healthy = document.getElementById('srvMEHealthy')?.value;
            if (healthy) updates.isHealthy = healthy;

            const manager = getComboValue('srvMEManager', 'srvMEManagerSelect');
            if (manager) updates.systemManager = manager;

            const team = getComboValue('srvMETeam', 'srvMETeamSelect');
            if (team) updates.team = team;

            const dept = getComboValue('srvMEDept', 'srvMEDeptSelect');
            if (dept) updates.department = dept;

            const domain = getComboValue('srvMEDomain', 'srvMEDomainSelect');
            if (domain) updates.domain = domain;

            const systemName = getComboValue('srvMESystemName', 'srvMESystemNameSelect');
            if (systemName) updates.systemName = systemName;

            const catalog = getComboValue('srvMECatalog', 'srvMECatalogSelect');
            if (catalog) updates.catalogNumber = catalog;

            const os = getComboValue('srvMEOs', 'srvMEOsSelect');
            if (os) updates.os = os;

            const vendor = getComboValue('srvMEVendor', 'srvMEVendorSelect');
            if (vendor) updates.hardwareVendor = vendor;

            const ip = document.getElementById('srvMEIp')?.value?.trim();
            if (ip) updates.scannedVia = ip;

            const bootType = document.getElementById('srvMEBootType')?.value;
            if (bootType) updates.bootType = bootType;

            const shutdown = document.getElementById('srvMEShutdown')?.value;
            if (shutdown) updates.canShutdown = shutdown;

            const notes = document.getElementById('srvMENotes')?.value?.trim();
            if (notes) updates.notes = notes;

            const mappingNotes = document.getElementById('srvMEMappingNotes')?.value?.trim();
            if (mappingNotes) updates.mappingNotes = mappingNotes;

            if (Object.keys(updates).length === 0) {
                this.showToast('לא הוזנו שדות לעדכון', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        `<i class="fas fa-save"></i> עדכן ${this.selectedServers.size} שרתים`;
                }
                return;
            }

            const payload = {
                serverNames: [...this.selectedServers],
                updates
            };

            const res = await fetch('/Servers/UpdateMultipleServers', {
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

            this.selectedServers.forEach(name => {
                const srv = this.allServers.find(s => s.name === name);
                if (srv) {
                    Object.assign(srv, updates);
                    srv.lastUpdated = updatedAt;
                    srv.updatedBy = this.currentUser;
                }
            });

            modal.remove();
            this.selectedServers.clear();
            this._updateMultiToolbar();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            this.showToast(
                `✅ עודכנו ${data.updatedCount} שרתים בהצלחה`,
                'success'
            );

        } catch (err) {
            console.error('_saveMultiEdit error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    `<i class="fas fa-save"></i> עדכן ${this.selectedServers.size} שרתים`;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // בדיקת BigFix לשרתים מסומנים
    // ══════════════════════════════════════════════════════════
    openMultiBigFixModal() {
        if (this.selectedServers.size === 0) {
            this.showToast('לא נבחרו שרתים', 'error');
            return;
        }

        const existing = document.getElementById('srvMultiBigFixModal');
        if (existing) existing.remove();

        const selectedList = [...this.selectedServers];
        const count = selectedList.length;

        const modal = document.createElement('div');
        modal.id = 'srvMultiBigFixModal';
        modal.className = 'srv-modal-overlay';

        // ─── בנה שורות ראשוניות ───
        const buildInitialRows = () => selectedList.map(name => {
            const srv = this.allServers.find(s => s.name === name);
            const env = srv?.environment || '';
            const envBadge = env
                ? `<span class="srv-badge ${env === 'PROD'
                    ? 'srv-badge-prod' : 'srv-badge-nonprod'}">
                ${this.escHtml(env)}
               </span>`
                : '';

            return `
        <tr class="srv-bigfix-multi-tr srv-bigfix-multi-tr-loading"
            id="srvBFRow_${this.escHtml(name)}">
            <td class="srv-bigfix-multi-td srv-bigfix-multi-td-name">
                <i class="fas fa-server"
                   style="color:#555;font-size:0.7rem;margin-left:5px"></i>
                ${this.escHtml(name)}
            </td>
            <td class="srv-bigfix-multi-td">${envBadge}</td>
            <td class="srv-bigfix-multi-td" id="srvBFStatus_${this.escHtml(name)}">
                <span style="color:#555;font-size:0.75rem">
                    <i class="fas fa-clock"></i> ממתין...
                </span>
            </td>
            <td class="srv-bigfix-multi-td" id="srvBFDate_${this.escHtml(name)}">
                <span style="color:#555;font-size:0.72rem">—</span>
            </td>
            <td class="srv-bigfix-multi-td" id="srvBFSource_${this.escHtml(name)}">
                <span style="color:#555;font-size:0.72rem">—</span>
            </td>
        </tr>`;
        }).join('');

        modal.innerHTML = `
    <div class="srv-modal srv-bigfix-multi-modal">

        <!-- כותרת -->
        <div class="srv-modal-header srv-bigfix-multi-header">
            <h3 class="srv-modal-title">
                <i class="fas fa-shield-alt" style="color:#6366f1"></i>
                Updates status
                <span style="
                    display:inline-flex;align-items:center;
                    padding:2px 10px;
                    background:rgba(99,102,241,0.15);
                    border:1px solid rgba(99,102,241,0.35);
                    border-radius:8px;color:#a5b4fc;
                    font-size:0.82rem;font-weight:700;margin-right:6px">
                    ${count} שרתים
                </span>
            </h3>
            <button class="srv-modal-close"
                    id="srvBFMultiClose">&times;</button>
        </div>

        <!-- Progress -->
        <div class="srv-modal-body" style="padding:16px 20px;gap:12px">

            <div class="srv-bigfix-multi-progress" id="srvBFProgress">
                <div class="srv-bigfix-multi-progress-text">
                    <span id="srvBFProgressText">מכין בדיקה...</span>
                    <span id="srvBFProgressPct">0%</span>
                </div>
                <div class="srv-bigfix-multi-progress-bar-wrap">
                    <div class="srv-bigfix-multi-progress-bar"
                         id="srvBFProgressBar"
                         style="width:0%"></div>
                </div>
            </div>

            <!-- סיכום תוצאות -->
            <div id="srvBFSummary"
                 style="display:none;
                        display:flex;gap:8px;flex-wrap:wrap">
            </div>

            <!-- טבלת תוצאות -->
            <div style="overflow-y:auto;max-height:420px;
                        border:1px solid rgba(255,255,255,0.07);
                        border-radius:8px;">
                <table class="srv-bigfix-multi-results-table">
                    <thead>
                        <tr>
                            <th class="srv-bigfix-multi-th">שם שרת</th>
                            <th class="srv-bigfix-multi-th">סביבה</th>
                            <th class="srv-bigfix-multi-th">סטטוס BigFix</th>
                            <th class="srv-bigfix-multi-th">דיווח אחרון</th>
                            <th class="srv-bigfix-multi-th">מקור</th>
                        </tr>
                    </thead>
                    <tbody id="srvBFMultiTbody">
                        ${buildInitialRows()}
                    </tbody>
                </table>
            </div>

        </div>

        <!-- Footer -->
        <div class="srv-modal-footer">
            <button class="srv-modal-cancel-btn"
                    id="srvBFMultiCancel">
                <i class="fas fa-times"></i> סגור
            </button>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ─── אירועי סגירה ───
        const closeModal = () => modal.remove();
        document.getElementById('srvBFMultiClose')
            .addEventListener('click', closeModal);
        document.getElementById('srvBFMultiCancel')
            .addEventListener('click', closeModal);

        // ─── כפתור רענון גלובלי ───
        document.getElementById('srvBFMultiRefresh')
            ?.addEventListener('click', () => {
                closeModal();
                this.loadBigFixData(false);
            });

        // ─── הרץ בדיקה ───
        this._runMultiBigFixCheck(selectedList, modal);
    }

    // ─── הרץ בדיקת BigFix לרשימת שרתים - פנייה ישירה לשרת ────────
    async _runMultiBigFixCheck(serverNames, modal) {
        const total = serverNames.length;

        const updateProgress = (text, done) => {
            const pct = Math.round((done / total) * 100);
            const bar = document.getElementById('srvBFProgressBar');
            const txt = document.getElementById('srvBFProgressText');
            const pctEl = document.getElementById('srvBFProgressPct');
            if (bar) bar.style.width = pct + '%';
            if (txt) txt.textContent = text;
            if (pctEl) pctEl.textContent = pct + '%';
        };

        const updateRow = (name, statusHtml, dateHtml, sourceHtml) => {
            const safeId = name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const row = document.getElementById(`srvBFRow_${safeId}`);
            if (row) row.classList.remove('srv-bigfix-multi-tr-loading');

            const statusEl = document.getElementById(`srvBFStatus_${safeId}`);
            const dateEl = document.getElementById(`srvBFDate_${safeId}`);
            const sourceEl = document.getElementById(`srvBFSource_${safeId}`);

            if (statusEl) statusEl.innerHTML = statusHtml;
            if (dateEl) dateEl.innerHTML = dateHtml;
            if (sourceEl) sourceEl.innerHTML = sourceHtml;
        };

        // ─── סמן כל השורות כ"בודק..." ───
        serverNames.forEach(name => {
            updateRow(
                name,
                `<span style="color:#6366f1;font-size:0.75rem">
                <i class="fas fa-spinner fa-spin"></i> בודק...
            </span>`,
                '—',
                '—'
            );
        });

        updateProgress(`שולח בקשה ל-BigFix עבור ${total} שרתים...`, 0);

        try {
            // ─── פנה לשרת עם רשימת השרתים הנבחרים ───
            const res = await fetch('/Servers/GetBigFixStatusForServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ serverNames })
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'שגיאה בטעינת BigFix');
            }

            // ─── עדכן מפת ה-cache הגלובלית עם הנתונים החדשים ───
            (data.statusMap || []).forEach(item => {
                const key = (item.name || '').toLowerCase();
                this.bigFixData[key] = item;

                // גם ללא דומיין
                const dotIdx = key.indexOf('.');
                if (dotIdx > 0) {
                    const shortKey = key.substring(0, dotIdx);
                    if (!this.bigFixData[shortKey]) {
                        this.bigFixData[shortKey] = item;
                    }
                }
            });

            // ─── בנה מפה מהירה לפי שם ───
            const resultMap = {};
            (data.statusMap || []).forEach(item => {
                const key = (item.name || '').toLowerCase();
                resultMap[key] = item;

                const dotIdx = key.indexOf('.');
                if (dotIdx > 0) {
                    const shortKey = key.substring(0, dotIdx);
                    if (!resultMap[shortKey]) resultMap[shortKey] = item;
                }
            });

            // ─── עדכן כל שורה לפי התוצאה ───
            serverNames.forEach((name, idx) => {
                const key = name.toLowerCase();
                const status = resultMap[key];

                updateProgress(
                    `מעדכן תוצאות... (${idx + 1}/${total})`,
                    idx + 1
                );

                if (!status) {
                    // ─── לא נמצא ב-BigFix ───
                    updateRow(
                        name,
                        `<span class="srv-bigfix-notfound"
                          title="השרת לא נמצא ב-BigFix">
                        <i class="fas fa-minus-circle"></i>
                        לא ב-BigFix
                    </span>`,
                        '—',
                        `<span style="font-size:0.7rem;color:#555">
                        <i class="fas fa-search"></i> לא נמצא
                    </span>`
                    );
                } else {
                    // ─── נמצא - הצג badge ───
                    const raw = (status.pendingRestart || '').trim();
                    const badgeHtml = this._getBigFixBadge(raw);
                    const lastReportShort = this._formatBigFixDate(
                        status.lastReport || ''
                    );

                    const dateHtml = status.lastReport
                        ? `<span class="srv-bigfix-report"
                             title="דיווח אחרון: ${this.escHtml(status.lastReport)}">
                           <i class="fas fa-clock"></i>
                           ${this.escHtml(lastReportShort)}
                       </span>`
                        : '<span style="color:#555;font-size:0.72rem">—</span>';

                    // ─── הצג שם מלא מ-BigFix אם שונה ───
                    const bigfixName = (status.name || '').toLowerCase();
                    const nameDiff = bigfixName &&
                        bigfixName !== key &&
                        !bigfixName.startsWith(key + '.');

                    const sourceHtml = nameDiff
                        ? `<span style="font-size:0.68rem;color:#a78bfa;
                                   font-family:monospace"
                             title="שם ב-BigFix: ${this.escHtml(status.name)}">
                           <i class="fas fa-info-circle"></i>
                           ${this.escHtml(status.name)}
                       </span>`
                        : `<span style="font-size:0.7rem;color:#555">
                           <i class="fas fa-check" style="color:#22c55e"></i>
                           נמצא
                       </span>`;

                    updateRow(name, badgeHtml, dateHtml, sourceHtml);
                }
            });

            // ─── סיום מוצלח ───
            updateProgress(`✅ הושלם - ${total} שרתים נבדקו`, total);

            const progressEl = document.getElementById('srvBFProgress');
            if (progressEl) {
                progressEl.style.background = 'rgba(34,197,94,0.08)';
                progressEl.style.borderColor = 'rgba(34,197,94,0.3)';
            }

            const bar = document.getElementById('srvBFProgressBar');
            if (bar) {
                bar.style.background =
                    'linear-gradient(90deg, #22c55e, #16a34a)';
            }

            // ─── הפעל כפתור רענון ───
            const refreshBtn = document.getElementById('srvBFMultiRefresh');
            if (refreshBtn) refreshBtn.disabled = false;

            // ─── הצג סיכום ───
            this._showBigFixMultiSummary(serverNames, resultMap);

            // ─── עדכן תאי BigFix בטבלה הראשית ───
            this._updateBigFixCells();
            this.updateStats();

            this.showToast(
                `🛡️ BigFix: נבדקו ${total} שרתים`,
                'success'
            );

        } catch (err) {
            console.error('_runMultiBigFixCheck error:', err);

            // ─── עדכן כל השורות עם שגיאה ───
            serverNames.forEach(name => {
                updateRow(
                    name,
                    `<span style="color:#f87171;font-size:0.75rem"
                      title="${this.escHtml(err.message)}">
                    <i class="fas fa-exclamation-circle"></i>
                    שגיאה
                </span>`,
                    '—',
                    `<span style="font-size:0.68rem;color:#f87171">
                    ${this.escHtml(err.message)}
                </span>`
                );
            });

            updateProgress(`❌ שגיאה: ${err.message}`, total);

            const progressEl = document.getElementById('srvBFProgress');
            if (progressEl) {
                progressEl.style.background = 'rgba(239,68,68,0.08)';
                progressEl.style.borderColor = 'rgba(239,68,68,0.3)';
            }

            const pctEl = document.getElementById('srvBFProgressPct');
            if (pctEl) pctEl.style.color = '#f87171';

            // ─── הפעל כפתור רענון גם בשגיאה ───
            const refreshBtn = document.getElementById('srvBFMultiRefresh');
            if (refreshBtn) refreshBtn.disabled = false;

            this.showToast('שגיאה בבדיקת BigFix: ' + err.message, 'error');
        }
    }

    // ─── הצג סיכום תוצאות ────────────────────────────────────────
    _showBigFixMultiSummary(serverNames, resultMap) {
        const summaryEl = document.getElementById('srvBFSummary');
        if (!summaryEl) return;

        const counts = {
            'Completed': 0,
            'Need Restart': 0,
            'Pending Restart': 0,
            'Not Completed': 0,
            'Not Reboot 120 day': 0,
            'notfound': 0,
        };

        serverNames.forEach(name => {
            const key = name.toLowerCase();
            const status = resultMap[key];

            if (!status) {
                counts['notfound']++;
                return;
            }

            const raw = (status.pendingRestart || '').trim();
            let norm = raw;
            if (raw === 'True' || raw === 'TRUE') norm = 'Need Restart';
            if (raw === 'False' || raw === 'FALSE') norm = 'Completed';

            if (counts.hasOwnProperty(norm)) {
                counts[norm]++;
            }
        });

        const pills = [
            {
                key: 'Completed',
                label: 'Completed',
                icon: 'fa-check-circle',
                color: '#86efac',
                bg: 'rgba(34,197,94,0.12)',
                border: 'rgba(34,197,94,0.3)'
            },
            {
                key: 'Need Restart',
                label: 'Need Restart',
                icon: 'fa-redo-alt',
                color: '#fdba74',
                bg: 'rgba(249,115,22,0.12)',
                border: 'rgba(249,115,22,0.35)'
            },
            {
                key: 'Pending Restart',
                label: 'Pending',
                icon: 'fa-hourglass-half',
                color: '#fcd34d',
                bg: 'rgba(245,158,11,0.12)',
                border: 'rgba(245,158,11,0.35)'
            },
            {
                key: 'Not Completed',
                label: 'Wait to Install',
                icon: 'fa-times-circle',
                color: '#fca5a5',
                bg: 'rgba(239,68,68,0.12)',
                border: 'rgba(239,68,68,0.35)'
            },
            {
                key: 'Not Reboot 120 day',
                label: '120 day',
                icon: 'fa-exclamation-triangle',
                color: '#fde047',
                bg: 'rgba(234,179,8,0.12)',
                border: 'rgba(234,179,8,0.35)'
            },
            {
                key: 'notfound',
                label: 'לא ב-BigFix',
                icon: 'fa-minus-circle',
                color: '#6b7280',
                bg: 'rgba(107,114,128,0.1)',
                border: 'rgba(107,114,128,0.25)'
            },
        ];

        summaryEl.innerHTML = pills
            .filter(p => counts[p.key] > 0)
            .map(p => `
            <div style="
                display:flex;align-items:center;gap:6px;
                padding:5px 12px;border-radius:10px;
                background:${p.bg};border:1px solid ${p.border};
                color:${p.color};font-size:0.78rem;font-weight:700">
                <i class="fas ${p.icon}"></i>
                <span>${p.label}</span>
                <span style="
                    background:rgba(255,255,255,0.15);
                    padding:1px 7px;border-radius:8px;
                    font-size:0.72rem">${counts[p.key]}</span>
            </div>
        `).join('');

        summaryEl.style.display = 'flex';
    }

    // ══════════════════════════════════════════════════════════
    // מודל מחיקה מרובה
    // ══════════════════════════════════════════════════════════
    openMultiDeleteModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה למחיקה', 'error');
            return;
        }

        if (this.selectedServers.size === 0) {
            this.showToast('לא נבחרו שרתים', 'error');
            return;
        }

        const existing = document.getElementById('srvMultiDeleteModal');
        if (existing) existing.remove();

        const count = this.selectedServers.size;
        const selectedList = [...this.selectedServers];

        // ── בנה רשימת שרתים נבחרים עם פרטים ──
        const serversInfo = selectedList.map(name => {
            const srv = this.allServers.find(s => s.name === name);
            return srv || { name, environment: '', systemName: '' };
        });

        const modal = document.createElement('div');
        modal.id = 'srvMultiDeleteModal';
        modal.className = 'srv-modal-overlay';
        modal.innerHTML = `
<div class="srv-modal srv-multi-delete-modal">

    <!-- כותרת -->
    <div class="srv-modal-header srv-multi-delete-header">
        <h3 class="srv-modal-title">
            <i class="fas fa-trash-alt" style="color:#ef4444"></i>
            מחיקת שרתים
            <span class="srv-multi-delete-count-badge">
                ${count} שרתים
            </span>
        </h3>
        <button class="srv-modal-close"
                id="srvMultiDeleteClose">&times;</button>
    </div>

    <!-- אזהרה -->
    <div class="srv-multi-delete-warning">
        <i class="fas fa-exclamation-triangle"></i>
        <div>
            <div class="srv-multi-delete-warning-title">
                פעולה זו תמחק לצמיתות
                <strong>${count}</strong> שרתים
            </div>
            <div class="srv-multi-delete-warning-sub">
                לא ניתן לבטל פעולה זו לאחר האישור.
            </div>
        </div>
    </div>

    <!-- גוף -->
    <div class="srv-modal-body srv-multi-delete-body">

        <!-- רשימת שרתים לפי סביבה -->
        <div class="srv-multi-delete-list-wrap">
            <div class="srv-multi-delete-list-title">
                <i class="fas fa-list"></i>
                שרתים שיימחקו:
            </div>
            <div class="srv-multi-delete-list">
                ${serversInfo.map(srv => `
                    <div class="srv-multi-delete-item">
                        <span class="srv-multi-delete-item-name"
                              title="${this.escHtml(srv.name)}">
                            <i class="fas fa-server"
                               style="color:#555;font-size:0.7rem"></i>
                            ${this.escHtml(srv.name)}
                        </span>
                        <div class="srv-multi-delete-item-meta">
                            ${srv.environment ? `
                            <span class="srv-badge ${srv.environment === 'PROD'
                    ? 'srv-badge-prod' : 'srv-badge-nonprod'}">
                                ${this.escHtml(srv.environment)}
                            </span>` : ''}
                            ${srv.systemName ? `
                            <span class="srv-multi-delete-item-system">
                                ${this.escHtml(srv.systemName)}
                            </span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- אישור הקלדה -->
        <div class="srv-multi-delete-confirm-wrap">
            <label class="srv-multi-delete-confirm-label">
                <i class="fas fa-keyboard"></i>
                הקלד <strong>מחק</strong> לאישור:
            </label>
            <input type="text"
                   id="srvMultiDeleteConfirmInput"
                   class="srv-multi-delete-confirm-input"
                   placeholder='הקלד "מחק"'
                   autocomplete="off"/>
        </div>

    </div>

    <!-- Footer -->
    <div class="srv-modal-footer">
        <button class="srv-modal-cancel-btn"
                id="srvMultiDeleteCancel">
            <i class="fas fa-times"></i> ביטול
        </button>
        <button class="srv-multi-delete-confirm-btn"
                id="srvMultiDeleteConfirm"
                disabled>
            <i class="fas fa-trash-alt"></i>
            מחק ${count} שרתים
        </button>
    </div>

</div>`;

        document.body.appendChild(modal);

        // ─── אירועים ───
        const closeModal = () => modal.remove();

        document.getElementById('srvMultiDeleteClose')
            .addEventListener('click', closeModal);
        document.getElementById('srvMultiDeleteCancel')
            .addEventListener('click', closeModal);

        // ─── הפעל כפתור רק אחרי הקלדת "מחק" ───
        const confirmInput = document.getElementById(
            'srvMultiDeleteConfirmInput'
        );
        const confirmBtn = document.getElementById(
            'srvMultiDeleteConfirm'
        );

        confirmInput.addEventListener('input', () => {
            const val = confirmInput.value.trim();
            const isValid = val === 'מחק';
            confirmBtn.disabled = !isValid;
            confirmInput.classList.toggle(
                'srv-multi-delete-input-valid', isValid
            );
        });

        confirmBtn.addEventListener('click', () =>
            this._executeMultiDelete(modal)
        );
    }

    // ─── בצע מחיקה מרובה ─────────────────────────────────────────
    async _executeMultiDelete(modal) {
        const confirmBtn = document.getElementById('srvMultiDeleteConfirm');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> מוחק...';
        }

        const toDelete = [...this.selectedServers];
        const count = toDelete.length;

        try {
            // ─── שלח לשרת ───
            const res = await fetch('/Servers/DeleteMultipleServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ serverNames: toDelete })
            });

            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה במחיקה');

            // ─── הסר מהזיכרון ───
            const deleteSet = new Set(
                toDelete.map(n => n.toLowerCase())
            );
            this.allServers = this.allServers.filter(
                s => !deleteSet.has((s.name || '').toLowerCase())
            );

            modal.remove();

            // ─── נקה בחירה ───
            this.selectedServers.clear();
            this._updateMultiToolbar();

            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            this.showToast(
                `🗑️ נמחקו ${data.deletedCount ?? count} שרתים בהצלחה`,
                'success'
            );

        } catch (err) {
            console.error('_executeMultiDelete error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML =
                    `<i class="fas fa-trash-alt"></i> מחק ${count} שרתים`;
            }
        }
    }

    // ─── עדכן Multi-Select Toolbar ───────────────────────────────
    _updateMultiToolbar() {
        const toolbar = document.getElementById('srvMultiToolbar');
        if (toolbar) toolbar.style.display = 'none'; // תמיד מוסתר

        this.updateStats(); // מעדכן את ה-stats bar כולל multi info
    }

    _restoreOpenFilterPopup() {
        if (!this._openFilterPopupKey) return;

        const colKey = this._openFilterPopupKey;

        // ── אל תשתמש ב-setTimeout - עדכן ישירות ──
        const popup = document.getElementById(`srvThFilter_${colKey}`);
        if (popup) {
            popup.style.display = 'block';
            popup.innerHTML = this._buildColumnFilterContent(colKey);
        }
    }

    // ══════════════════════════════════════════════════════════
    // רינדור תוכן לפי מצב תצוגה
    // ══════════════════════════════════════════════════════════
    renderContent() {
        switch (this.viewMode) {
            case 'table': this.renderTable(); break;
            case 'cards': this.renderCards(); break;
            case 'stats': this.renderStatsView(); break;
        }

        if (this.viewMode !== 'table') {
            this.selectedServers.clear();
            this._updateMultiToolbar();
        }
        this._updateViewBtns();
        this._updateLastUpdate();

        // ─── אחרי render - עדכן תאי BigFix אם הנתונים קיימים ─
        if (this.bigFixLoaded) {
            this._updateBigFixCells();
            this._setBigFixColumnHeader('ok',
                Object.keys(this.bigFixData).length);
            this._populateDropdownFilters();
        } else if (this.bigFixError) {
            this._setBigFixColumnHeader('error');
        } else {
            this._setBigFixColumnHeader('loading');
        }
        this._restoreOpenFilterPopup();
    }

    // ─── חלץ IP יחיד מרשימה (עדיפות ל-172.22) ───────────────────
    _extractPrimaryIp(ipString) {
        if (!ipString) return '';

        // ── פצל לפי פסיק או | ──
        const ips = ipString
            .split(/[,|;]/)
            .map(ip => ip.trim())
            .filter(ip => ip.length > 0);

        if (ips.length === 0) return '';
        if (ips.length === 1) return ips[0];

        // ── חפש IP שמתחיל ב-172.22 ──
        const preferred = ips.find(ip => ip.startsWith('172.22'));
        if (preferred) return preferred;

        // ── fallback: החזר את הראשון ──
        return ips[0];
    }

    // ─── זיהוי כיוון טקסט - עברית RTL, אנגלית LTR ───────────────
    _detectTextDir(text) {
        if (!text) return 'rtl';

        // ─── בדוק אם יש תווים עבריים ───
        const hebrewPattern = /[\u0590-\u05FF]/;
        if (hebrewPattern.test(text)) return 'rtl';

        // ─── אחרת - LTR ───
        return 'ltr';
    }

    // ─── תצוגת טבלה ──────────────────────────────────────────
    renderTable() {
        const content = document.getElementById('srvContent');
        if (!content) return;

        // ─── אפס דגל הרחבת עמודת PING ────────────────────────────
        this._pingColumnExpanded = false;

        const { page, total, pages } = this._getPaginationInfo();

        if (this.filteredServers.length === 0) {
            content.innerHTML = `
        <div class="srv-empty">
            <i class="fas fa-server"></i>
            <p>לא נמצאו שרתים</p>
        </div>`;
            this.renderPagination(0, 0);
            return;
        }

        // ← עמודות מעודכנות - תואמות לייצוא האקסל
        const cols = [
            ...(this.isAdmin ? [{ key: '_select', label: '', width: '36px' }] : []),
            { key: 'name', label: 'שם שרת', width: '110px' },
            { key: 'scannedVia', label: 'כתובת IP', width: '90px' },
            { key: 'environment', label: 'סביבה', width: '70px' },
            { key: 'isVirtual', label: 'סוג', width: '70px' },
            { key: 'os', label: 'מ׳ הפעלה', width: '75px' },
            { key: 'systemName', label: 'שם מערכת', width: '80px' },
            { key: 'catalogNumber', label: 'מס׳ קטלוג', width: '80px' },
            { key: 'systemStatus', label: 'סטטוס', width: '60px' },
            { key: 'systemManager', label: 'מנהל מערכת', width: '80px' },
            { key: 'team', label: 'צוות', width: '80px' },
            { key: 'department', label: 'מחלקה', width: '80px' },
            { key: 'domain', label: 'תחום', width: '80px' },
            { key: 'bootType', label: 'ס׳ אתחול', width: '65px' },
            { key: 'canShutdown', label: 'כיבוי', width: '55px' },
            { key: 'isHealthy', label: 'תקינות', width: '55px' },
            { key: 'notes', label: 'הערות', width: '80px' },
            { key: 'bigfixStatus', label: 'Updates', width: '80px' },
            { key: 'bigfixDate', label: '', width: '70px' },
            { key: 'ping', label: 'PING', width: '70px' },
        ];
        const allSelected = page.length > 0 &&
            page.every(s => this.selectedServers.has(s.name));

        const headerHtml = cols.map(c => {
            // ─── עמודת checkbox ───
            if (c.key === '_select') {
                // ← הוסף בדיקת isAdmin לפני הצגת checkbox
                if (this.isAdmin) {
                    return `
            <th class="srv-th srv-th-select"
                style="min-width:${c.width};width:${c.width}">
                <input type="checkbox"
                    class="srv-cb srv-cb-all"
                    ${allSelected ? 'checked' : ''}
                    title="בחר הכל">
            </th>`;
                }
            }

            // ── עמודות שתומכות בסינון מהכותרת ──
            const filterableColumns = {
                'environment': { filterId: 'srvFltEnv', type: 'select' },
                'isVirtual': { filterId: 'srvFltVirtual', type: 'select' },
                'systemStatus': { filterId: 'srvFltStatus', type: 'select' },
                'isHealthy': { filterId: 'srvFltHealthy', type: 'select' },
                'department': { filterId: 'srvFltDept', type: 'search' },
                'team': { filterId: 'srvFltTeam', type: 'search' },
                'os': { filterId: 'srvFltOs', type: 'select' },
                'systemName': { filterId: 'srvFltSystemName', type: 'search' },
                'systemManager': { filterId: 'srvFltSystemManager', type: 'search' },
                'bootType': { filterId: 'srvFltBootType', type: 'select' },
                'bigfixStatus': { filterId: 'srvFltBigfix', type: 'select' },
                'domain': { filterId: 'srvFltDomain', type: 'search' },
                'canShutdown': { filterId: 'srvFltCanShutdown', type: 'select' },
            };

            const filterInfo = filterableColumns[c.key];
            const isFiltered = filterInfo &&
                this.filters[c.key] && this.filters[c.key] !== 'all';

            // ── בנה אינדיקטור פילטר פעיל ──
            const filterIndicator = isFiltered
                ? `<span class="srv-th-filter-dot" 
                    title="פילטר פעיל: ${this.escHtml(this._filterValToString(this.filters[c.key]))}">
                </span>`
                : '';

            // ── בנה כפתור פילטר בכותרת ──
            const filterBtn = filterInfo
                ? `<button class="srv-th-filter-btn
                             ${isFiltered ? 'srv-th-filter-active' : ''}"
                       data-col="${c.key}"
                       title="${isFiltered
                    ? 'פילטר פעיל - לחץ לניקוי/שינוי'
                    : 'לחץ לסינון עמודה זו'}"
                       onclick="event.stopPropagation();
                                window._srvDashboard
                                    ._toggleColumnFilter('${c.key}')">
                   <i class="fas fa-filter"></i>
               </button>`
                : '';

            return `
        <th class="srv-th ${this.sortColumn === c.key ? 'sorted' : ''}
                   ${isFiltered ? 'srv-th-filtered' : ''}"
            data-col="${c.key}"
            style="min-width:${c.width}">
            <div class="srv-th-content">
                <span class="srv-th-label">${c.label}</span>
                ${filterIndicator}
                <div class="srv-th-actions">
                    ${filterBtn}
                    ${this.sortColumn === c.key
                    ? `<i class="fas fa-sort-${this.sortDirection === 'asc' ? 'up' : 'down'
                    } srv-th-sort-icon"></i>`
                    : '<i class="fas fa-sort srv-sort-icon-dim"></i>'}
                </div>
            </div>
            <!-- ── Inline Filter Popup ── -->
            <div class="srv-th-filter-popup"
                 id="srvThFilter_${c.key}"
                 style="display:none"
                 onclick="event.stopPropagation()">
            </div>
        </th>`;
        }).join('');

        const rowsHtml = page.map(s => {
            const envClass = s.environment === 'PROD'
                ? 'srv-badge-prod' : 'srv-badge-nonprod';
            const virtNorm = this._normalizeVirtual(s.isVirtual);
            const virtClass = virtNorm === 'TRUE'
                ? 'srv-badge-virtual'
                : virtNorm === 'FALSE'
                    ? 'srv-badge-physical'
                    : 'srv-badge-neutral';
            const statusClass = this._getStatusClass(s.systemStatus);
            const healthClass = this._getHealthClass(s.isHealthy);
            const osShort = this._simplifyOs(s.os);

            const isSelected = this.selectedServers.has(s.name);

            return `
        <tr class="srv-tr ${isSelected ? 'srv-tr-selected' : ''}"
            data-name="${this.escHtml(s.name)}">

            <!-- Checkbox -->
             ${this.isAdmin ? `
            <td class="srv-td srv-td-select">
               <input type="checkbox"
                    class="srv-cb srv-cb-row"
                    data-name="${this.escHtml(s.name)}"
                    ${isSelected ? 'checked' : ''}>
            </td>` : ''}

            <!-- שם שרת -->
            <td class="srv-td srv-td-name">
                <span class="srv-server-name"
                    title="${this.escHtml(s.name)}">
                    ${this.escHtml(s.name)}
                </span>
            </td>

           <!-- כתובת IP -->
            <td class="srv-td srv-td-ip"
                title="${this.escHtml(s.scannedVia || '')}">
                ${this.escHtml(this._extractPrimaryIp(s.scannedVia))}
            </td>

            <!-- סביבה -->
            <td class="srv-td srv-td-center">
                <span class="srv-badge ${envClass}">
                    ${this.escHtml(s.environment || '')}
                </span>
            </td>

            <!-- סוג -->
            <td class="srv-td srv-td-center">
                <span class="srv-badge ${virtClass}">
                    ${virtNorm === 'TRUE'
                    ? '☁️ וירטואלי'
                    : virtNorm === 'FALSE'
                        ? '🖥️ פיזי'
                        : '❓ לא ידוע'}
                </span>
            </td>

            <!-- מערכת הפעלה -->
            <td class="srv-td srv-td-os"
                title="${this.escHtml(s.os || '')}">
                ${this.escHtml(osShort)}
            </td>

            <!-- שם מערכת -->
            <td class="srv-td srv-td-truncate"
                dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.systemName || '')}">
                ${this.escHtml(s.systemName || '')}
            </td>

            <!-- מספר קטלוג -->
            <td class="srv-td srv-td-catalog"
                title="${this.escHtml(s.catalogNumber || '')}">
                ${s.catalogNumber
                    ? `<span class="srv-system-name-link"
                            data-system-name="${this.escHtml(s.systemName)}"
                            title="לחץ לפרטי מערכת: ${this.escHtml(s.systemName)} (#${this.escHtml(s.catalogNumber)})">
                        ${this.escHtml(s.catalogNumber)}
                    </span>`
                    : this.escHtml(s.catalogNumber || '')}
            </td>

            <!-- סטטוס מערכת -->
            <td class="srv-td srv-td-center">
                <span class="srv-badge ${statusClass}">
                    ${this.escHtml(s.systemStatus || '')}
                </span>
            </td>

            <!-- מנהל מערכת -->
            <td class="srv-td srv-td-truncate"
            dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.systemManager || '')}">
                ${this.escHtml(s.systemManager || '')}
            </td>

            <!-- צוות -->
            <td class="srv-td srv-td-truncate"
            dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.team || '')}">
                ${this.escHtml(this._shortenDeptTeam(s.team))}
            </td>

            <!-- מחלקה -->
            <td class="srv-td srv-td-truncate"
            dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.department || '')}">
                ${this.escHtml(this._shortenDeptTeam(s.department))}
            </td>
            <!-- תחום -->
            <td class="srv-td srv-td-truncate"
            dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.domain || '')}">
                ${this.escHtml(this._shortenDeptTeam(s.domain))}
            </td>

            <!-- סוג אתחול -->
            <td class="srv-td srv-td-truncate"
            dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.bootType || '')}">
                ${this.escHtml(s.bootType || '')}
            </td>

            <!-- ניתן לכבות -->
            <td class="srv-td srv-td-center srv-td-inline-select">
                ${this._buildInlineSelect(
                        s.name,
                        'canShutdown',
                        s.canShutdown || '',
                        [
                            { value: '', label: '<span class="srv-inline-opt-empty">— ריק —</span>' },
                            { value: 'כן', label: '<span class="srv-badge srv-badge-yes"><i class="fas fa-check"></i> כן</span>' },
                            { value: 'לא', label: '<span class="srv-badge srv-badge-no"><i class="fas fa-times"></i> לא</span>' },
                        ]
                    )}
            </td>

            <!-- תקינות -->
            <td class="srv-td srv-td-center srv-td-inline-select">
                ${this._buildInlineSelect(
                        s.name,
                        'isHealthy',
                        s.isHealthy || '',
                        [
                            { value: '', label: '<span class="srv-inline-opt-empty">— ריק —</span>' },
                            { value: 'תקין', label: '<span class="srv-badge srv-badge-healthy"><i class="fas fa-heart"></i> תקין</span>' },
                            { value: 'לא תקין', label: '<span class="srv-badge srv-badge-unhealthy"><i class="fas fa-heart-broken"></i> לא תקין</span>' },
                            { value: 'בבדיקה', label: '<span class="srv-badge srv-badge-neutral"><i class="fas fa-search"></i> בבדיקה</span>' },
                        ]
                    )}
            </td>

            <!-- הערות -->
            <td class="srv-td srv-td-notes">
                <span class="srv-notes-text"
                    title="${this.escHtml(
                        [s.mappingNotes, s.notes].filter(Boolean).join(' | ')
                    )}">
                    ${this.escHtml(
                        [s.mappingNotes, s.notes].filter(Boolean).join(' | ')
                    )}
                </span>
                <!-- ─── כפתור עריכת הערה - לעורכים ─── -->
                ${(this.isAdmin || this.isEditor) ? `
                <button class="srv-edit-note-btn"
                        data-name="${this.escHtml(s.name)}"
                        title="ערוך הערה">
                    <i class="fas fa-pen"></i>
                </button>` : ''}

                <!-- ─── כפתור עריכה מלאה - אדמין בלבד ─── -->
                ${this.isAdmin || this.isEditor ? `
                <button class="srv-row-edit-btn"
                        data-name="${this.escHtml(s.name)}"
                        title="ערוך שרת (Admin)">
                    <i class="fas fa-edit"></i>
                </button>` : ''}
            </td>

            <!-- BigFix Updates -->
            <td class="srv-td srv-td-bigfix" data-bigfix="1">
                ${this._buildBigFixCell(s.name)}
            </td>

            <!-- BigFix Date -->
            <td class="srv-td srv-td-bigfix-date" data-bigfix-date="1">
                ${this._buildBigFixDateCell(s.name)}
            </td>

            <!-- PING -->
            <td class="srv-td srv-td-ping" data-ping-cell="1">
                ${this._buildPingCell(s.name)}
            </td>
        </tr>`;
        }).join('');

        // ─── בנה colgroup לשליטה אמיתית ברוחב עמודות ───
        const colgroupHtml = cols.map(c =>
            `<col style="width:${c.width};min-width:${c.width}">`
        ).join('');

        content.innerHTML = `
<table class="srv-table">
    <colgroup>${colgroupHtml}</colgroup>
    <thead>
        <tr>${headerHtml}</tr>
    </thead>
    <tbody id="srvTbody">
        ${rowsHtml}
    </tbody>
</table>`;

        this.renderPagination(total, pages);
    }

    // הוסף פונקציה חדשה:
    _filterValToString(val) {
        if (!val || val === 'all') return '';
        if (val instanceof Set) {
            return [...val].join(', ');
        }
        return String(val);
    }

    // ══════════════════════════════════════════════════════════
    // מודל פרטי מערכת מהקטלוג
    // ══════════════════════════════════════════════════════════
    async openSystemInfoModal(systemName) {
        // ─── הסר מודל קיים ───
        const existing = document.getElementById('srvSystemInfoModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'srvSystemInfoModal';
        modal.className = 'srv-modal-overlay';

        // ─── הצג loading ───
        modal.innerHTML = `
    <div class="srv-modal srv-system-info-modal">
        <div class="srv-modal-header srv-system-info-modal-header">
            <h3 class="srv-modal-title">
                <i class="fas fa-layer-group" style="color:#6366f1"></i>
                פרטי מערכת
                <span style="
                    display:inline-flex;
                    align-items:center;
                    padding:2px 10px;
                    background:rgba(99,102,241,0.15);
                    border:1px solid rgba(99,102,241,0.35);
                    border-radius:8px;
                    color:#a5b4fc;
                    font-size:0.82rem;
                    font-weight:700;
                    margin-right:6px;">
                    ${this.escHtml(systemName)}
                </span>
            </h3>
            <button class="srv-modal-close" id="srvSysInfoClose">&times;</button>
        </div>
        <div class="srv-modal-body">
            <div class="srv-system-info-loading">
                <i class="fas fa-spinner fa-spin" style="color:#6366f1"></i>
                <span>טוען פרטי מערכת...</span>
            </div>
        </div>
    </div>`;

        document.body.appendChild(modal);

        // ─── אירועי סגירה ───
        const closeModal = () => modal.remove();
        document.getElementById('srvSysInfoClose')
            .addEventListener('click', closeModal);

        // ─── טען נתונים מהשרת ───
        try {
            // ─── מצא את מספר הקטלוג מהשרת שנבחר ───
            // חפש לפי systemName או לפי catalogNumber (אם systemName הוא בעצם מספר קטלוג)
            const server = this.allServers.find(s =>
                (s.systemName || '').toLowerCase() === (systemName || '').toLowerCase()
            ) || this.allServers.find(s =>
                (s.catalogNumber || '') === systemName
            );
            const catalogNumber = server?.catalogNumber ||
                (/^\d+$/.test(systemName) ? systemName : null);
            let data = null;

            // ─── ניסיון 1: חפש לפי מספר קטלוג (עדיפות) ───
            if (catalogNumber) {
                const res = await fetch(
                    `/SystemsCatalog/GetSystemByCatalogNum?number=${encodeURIComponent(catalogNumber)}`,
                    { credentials: 'include' }
                );
                data = await res.json();
            }

            // ─── ניסיון 2: fallback - חפש לפי שם ───
            if (!data || !data.success || !data.system) {
                const res = await fetch(
                    `/SystemsCatalog/GetSystemByName?name=${encodeURIComponent(systemName)}`,
                    { credentials: 'include' }
                );
                data = await res.json();
            }

            const body = modal.querySelector('.srv-modal-body');

            if (!data.success || !data.system) {
                // ─── מערכת לא נמצאה ───
                body.innerHTML = `
            <div class="srv-system-info-not-found">
                <i class="fas fa-search"></i>
                <div>
                    <div style="font-size:0.9rem;color:#888;margin-bottom:6px">
                        המערכת <strong style="color:#a5b4fc">
                            "${this.escHtml(catalogNumber || systemName)}"
                        </strong> לא נמצאה בקטלוג
                    </div>
                    <div style="font-size:0.78rem;color:#555">
                        ייתכן שהמערכת אינה רשומה בקטלוג המערכות
                    </div>
                </div>
            </div>`;
                return;
            }

            const s = data.system;

            // ─── בנה תצוגת פרטים ───
            const infoRow = (label, value, fullWidth = false) => {
                if (!value && value !== 0) return '';
                return `
            <div class="srv-system-info-row ${fullWidth ? 'full-width' : ''}">
                <span class="srv-system-info-label">${label}</span>
                <span class="srv-system-info-value">
                    ${this.escHtml(String(value))}
                </span>
            </div>`;
            };

            const statusClass = s.status
                ? (s.status.includes('פעיל') && !s.status.includes('לא')
                    ? 'srv-badge-active'
                    : s.status.includes('לא פעיל')
                        ? 'srv-badge-inactive'
                        : 'srv-badge-neutral')
                : 'srv-badge-neutral';

            const critClass = s.businessCriticality
                ? (s.businessCriticality.includes('גבוה') || s.businessCriticality.includes('קריטי')
                    ? 'srv-badge-unhealthy'
                    : s.businessCriticality.includes('בינוני')
                        ? 'srv-badge-neutral'
                        : 'srv-badge-healthy')
                : 'srv-badge-neutral';

            body.innerHTML = `

            <!-- ── כותרת מערכת ── -->
            <div style="
                display:flex;
                align-items:center;
                gap:12px;
                padding:12px 14px;
                background:rgba(99,102,241,0.06);
                border:1px solid rgba(99,102,241,0.15);
                border-radius:8px;
                margin-bottom:4px;">
                <div style="
                    width:42px;height:42px;
                    border-radius:10px;
                    background:rgba(99,102,241,0.15);
                    display:flex;align-items:center;justify-content:center;
                    color:#a5b4fc;font-size:1.2rem;flex-shrink:0;">
                    <i class="fas fa-layer-group"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:1rem;font-weight:700;color:#e0e0e0;
                                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${this.escHtml(s.name || '')}
                    </div>
                    ${s.nameEn ? `
                    <div style="font-size:0.78rem;color:#666;direction:ltr;text-align:right;">
                        ${this.escHtml(s.nameEn)}
                    </div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;
                            align-items:flex-end;flex-shrink:0;">
                    ${s.number ? `
                    <span style="
                        font-size:0.72rem;font-weight:700;color:#6366f1;
                        background:rgba(99,102,241,0.12);
                        border:1px solid rgba(99,102,241,0.25);
                        border-radius:6px;padding:2px 7px;">
                        #${this.escHtml(String(s.number))}
                    </span>` : ''}
                    ${s.status ? `
                    <span class="srv-badge ${statusClass}">
                        ${this.escHtml(s.status)}
                    </span>` : ''}
                </div>
            </div>

            <!-- ── תיאור ── -->
            ${s.description ? `
            <div style="
                padding:10px 14px;
                background:rgba(255,255,255,0.02);
                border:1px solid rgba(255,255,255,0.06);
                border-radius:8px;
                font-size:0.82rem;color:#aaa;
                line-height:1.5;">
                <i class="fas fa-align-left"
                style="color:#555;margin-left:6px;font-size:0.72rem;"></i>
                ${this.escHtml(s.description)}
            </div>` : ''}

            <!-- ── גריד פרטים מלא ── -->
            <div class="srv-system-info-grid">
                ${infoRow('מנהל מערכת', s.systemManager)}
                ${infoRow('צוות', s.team)}
                ${infoRow('מחלקה', s.department)}
                ${infoRow('תחום', s.domain)}
                ${infoRow('אגף עסקי', s.businessDivision)}
                ${infoRow('סביבה', s.environment)}
                ${infoRow('סיווג יישום', s.appClassification)}
                ${infoRow('סוג יישום', s.appType)}
                ${s.businessCriticality ? `
                <div class="srv-system-info-row">
                    <span class="srv-system-info-label">קריטיות עסקית</span>
                    <span class="srv-system-info-value">
                        <span class="srv-badge ${critClass}">
                            ${this.escHtml(s.businessCriticality)}
                        </span>
                    </span>
                </div>` : ''}
                ${infoRow('דרישת זמינות', s.availabilityRequirement)}
                ${infoRow('מפרסם', s.publisher)}
                ${infoRow('ספק תמיכה', s.supportVendor)}
                ${infoRow('נוצר', s.createdAt)}
                ${s.hasAutomation ? `
                <div class="srv-system-info-row">
                    <span class="srv-system-info-label">אוטומציה</span>
                    <span class="srv-system-info-value">
                        <span class="srv-badge ${s.hasAutomation === 'קיימות'
                        ? 'srv-badge-healthy'
                        : 'srv-badge-neutral'
                    }">
                            ${this.escHtml(s.hasAutomation)}
                        </span>
                        ${s.automationNote ? `
                        <span style="font-size:0.72rem;color:#666;
                                    margin-right:6px;">
                            ${this.escHtml(s.automationNote)}
                        </span>` : ''}
                    </span>
                </div>` : ''}
            </div>

            <!-- ── כפתור מעבר לקטלוג ── -->
            <div style="display:flex;justify-content:flex-end;margin-top:4px;">
                <button onclick="window._srvDashboard
                            ._openInSystemsCatalog('${this.escHtml(s.name || systemName)}')"
                    style="
                        display:flex;align-items:center;gap:6px;
                        padding:6px 14px;
                        background:rgba(99,102,241,0.12);
                        border:1px solid rgba(99,102,241,0.35);
                        border-radius:6px;
                        color:#a5b4fc;font-size:0.8rem;font-weight:600;
                        cursor:pointer;transition:all 0.2s;
                        font-family:inherit;">
                    <i class="fas fa-external-link-alt"></i>
                    פתח בקטלוג המערכות
                </button>
            </div>`;

        } catch (err) {
            console.error('openSystemInfoModal error:', err);
            const body = modal.querySelector('.srv-modal-body');
            if (body) {
                body.innerHTML = `
            <div class="srv-system-info-not-found">
                <i class="fas fa-exclamation-triangle" style="color:#f59e0b"></i>
                <div style="color:#f87171">שגיאה בטעינת פרטי המערכת: ${this.escHtml(err.message)}</div>
            </div>`;
            }
        }
    }

    _openInSystemsCatalog(systemName) {
        document.getElementById('srvSystemInfoModal')?.remove();

        // ─── נסה למצוא את מספר הקטלוג מהשרת שנבחר ───
        const server = this.allServers.find(s =>
            (s.systemName || '').toLowerCase() === (systemName || '').toLowerCase()
        );
        const catalogNumber = server?.catalogNumber || null;
        try {
            sessionStorage.setItem('sc_pending_filter_name', systemName);
            if (catalogNumber) {
                sessionStorage.setItem('sc_pending_filter_number', catalogNumber);
            }
        } catch (e) { }

        const filterParam = catalogNumber
            ? `filterNumber=${encodeURIComponent(catalogNumber)}`
            : `filterSystem=${encodeURIComponent(systemName)}`;

        window.location.href = `/dashboards?dashboard=systems-catalog&${filterParam}`;
    }

    // ══════════════════════════════════════════════════════════
    // סינון מהכותרת - פתח/סגור popup
    // ══════════════════════════════════════════════════════════
    _toggleColumnFilter(colKey) {
        // ── סגור כל שאר ה-popups ──
        document.querySelectorAll('.srv-th-filter-popup').forEach(p => {
            if (p.id !== `srvThFilter_${colKey}`) {
                p.style.display = 'none';
            }
        });

        const popup = document.getElementById(`srvThFilter_${colKey}`);
        if (!popup) return;

        const isOpen = popup.style.display !== 'none';

        if (isOpen) {
            popup.style.display = 'none';
            this._openFilterPopupKey = null;
            return;
        }

        // ── בנה תוכן ה-popup ──
        // ── פתח ושמור מפתח ──
        this._openFilterPopupKey = colKey; // ← שמור לפני buildContent
        popup.innerHTML = this._buildColumnFilterContent(colKey);
        popup.style.display = 'block';

        // ── Focus על שדה החיפוש אם קיים ──
        const searchInput = popup.querySelector('.srv-col-filter-search');
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 50);
        }
    }

    _applyColumnSort(colKey, direction) {
        this.sortColumn = colKey;
        this.sortDirection = direction;
        this._savePreferences();
        this.applyFiltersAndSort();
        this._updateTableRowsOnly();

        const popup = document.getElementById(`srvThFilter_${colKey}`);
        if (popup && popup.style.display !== 'none') {
            popup.innerHTML = this._buildColumnFilterContent(colKey);
            const searchInput = popup.querySelector('.srv-col-filter-search');
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

        let uniqueValues = [];

        // ══ אינדיקציית מיון פעיל ══
        const sortIndicator = isSortedHere ? `
    <div class="srv-col-sort-indicator">
        <i class="fas fa-sort-${sortDir === 'asc' ? 'up' : 'down'}"></i>
        <span>ממוין ${sortDir === 'asc' ? 'א → ת' : 'ת → א'}</span>
        <button class="srv-col-sort-flip-btn"
                title="הפוך כיוון מיון"
                onclick="event.stopPropagation();
                         window._srvDashboard._applyColumnSort(
                             '${colKey}',
                             '${sortDir === 'asc' ? 'desc' : 'asc'}'
                         )">
            <i class="fas fa-exchange-alt"></i>
        </button>
    </div>
    <div class="srv-col-filter-divider"></div>` : '';

        // ─── ספור ריקים לעמודה ───────────────────────────────────
        let emptyCount = 0;

        if (colKey === 'bigfixStatus') {
            // BigFix - ערכים מה-bigFixData
            const found = new Set();
            this.allServers.forEach(s => {
                const key = (s.name || '').toLowerCase();
                const status = this.bigFixData[key];
                if (!status) {
                    found.add('__notfound__');
                    return;
                }
                const raw = (status.pendingRestart || '').trim();
                let norm = raw;
                if (raw === 'True' || raw === 'TRUE') norm = 'Need Restart';
                if (raw === 'False' || raw === 'FALSE') norm = 'Completed';
                if (norm) found.add(norm);
            });
            uniqueValues = [...found].sort();
            // BigFix אין ריקים רגילים - notfound מטופל בנפרד

        } else if (colKey === 'isVirtual') {
            const normSet = new Set(
                this.allServers.map(s => this._normalizeVirtual(s.isVirtual))
            );
            const labelMap = {
                'TRUE': '☁️ וירטואלי',
                'FALSE': '🖥️ פיזי',
                'UNKNOWN': '❓ לא ידוע'
            };
            uniqueValues = [...normSet]
                .filter(Boolean)
                .map(v => ({ value: v, label: labelMap[v] || v }));

            // ─── ריקים לסוג שרת ───
            emptyCount = this.allServers.filter(
                s => !s.isVirtual || s.isVirtual.trim() === ''
            ).length;

        } else if (colKey === 'os') {
            uniqueValues = [...new Set(
                this.allServers.map(s => this._simplifyOs(s.os))
            )].sort();

            // ─── ריקים ל-OS ───
            emptyCount = this.allServers.filter(
                s => !s.os || s.os.trim() === ''
            ).length;

        } else {
            uniqueValues = [...new Set(
                this.allServers
                    .map(s => s[colKey])
                    .filter(v => v !== null && v !== undefined && v !== '')
            )].sort((a, b) =>
                String(a).localeCompare(String(b), 'he')
            );

            // ─── ספור ריקים לשדה רגיל ───────────────────────────
            emptyCount = this.allServers.filter(
                s => s[colKey] === null ||
                    s[colKey] === undefined ||
                    s[colKey] === ''
            ).length;
        }

        // ── בנה HTML ──
        const isSearchable = uniqueValues.length > 5;
        const searchHtml = isSearchable
            ? `<div class="srv-col-filter-search-wrap">
               <i class="fas fa-search srv-col-filter-search-icon"></i>
               <input type="text"
                      class="srv-col-filter-search"
                      placeholder="חפש..."
                      oninput="window._srvDashboard
                                   ._filterColumnOptions(this, '${colKey}')"/>
           </div>`
            : '';


        const selectedSet = this._getSelectedSet(colKey);

        const buildOption = (value, label, isActive, count) => {
            const displayLabel = label || value || '— ריק —';
            const isAll = value === 'all';

            // ── תיקון: כשאין בחירה (all), כל האפשרויות "מסומנות" ──
            const currentSelected = this._getSelectedSet(colKey);
            let checked;

            if (isAll) {
                // "הכל" מסומן כשאין בחירה ספציפית
                checked = currentSelected.size === 0;
            } else {
                // ערך ספציפי מסומן כשנמצא ב-Set, או כשאין בחירה (all = הכל מסומן)
                checked = currentSelected.size === 0 || currentSelected.has(value);
            }

            const isIndeterminate = isAll && currentSelected.size > 0 &&
                currentSelected.size < uniqueValues.length;

            return `
        <div class="srv-col-filter-option
                    ${checked && !isIndeterminate ? 'srv-col-filter-option-active' : ''}
                    ${isAll ? 'srv-col-filter-option-all' : ''}"
            data-value="${this.escHtml(String(value))}"
            onclick="event.stopPropagation();window._srvDashboard
                        ._toggleColumnFilterValue('${colKey}',
                            '${this.escHtml(String(value))}')">
            <input type="checkbox"
                class="srv-col-filter-cb ${isAll ? 'srv-col-filter-cb-all' : ''}"
                data-col="${colKey}"
                ${checked ? 'checked' : ''}
                ${isIndeterminate ? 'data-indeterminate="true"' : ''}
                onclick="event.stopPropagation()"
                onchange="event.stopPropagation();window._srvDashboard
                    ._toggleColumnFilterValue('${colKey}',
                        '${this.escHtml(String(value))}')"
                style="accent-color:#6366f1;width:13px;height:13px;
                        cursor:pointer;flex-shrink:0">
            <span class="srv-col-filter-option-label">
                ${this.escHtml(String(displayLabel))}
            </span>
            <span class="srv-col-filter-option-count">
                ${count}
            </span>
        </div>`;
        };

        // ── "הכל" תמיד ראשון ──
        const allOption = buildOption(
            'all',
            'הכל',
            currentVal === 'all',
            this.allServers.length
        );

        const multiControlsHtml = uniqueValues.length > 1 ? `
    <div class="srv-col-filter-multi-controls">
        <button class="srv-col-filter-select-all-btn"
                onclick="event.stopPropagation();
                         window._srvDashboard._selectAllColumnFilter('${colKey}')">
            <i class="fas fa-check-double"></i> הכל
        </button>
        <button class="srv-col-filter-clear-sel-btn"
                onclick="event.stopPropagation();
                         window._srvDashboard._clearColumnFilter('${colKey}')">
            <i class="fas fa-times"></i> נקה
        </button>
        <span class="srv-col-filter-sel-count">
            ${selectedSet.size > 0 ? selectedSet.size + ' נבחרו' : ''}
        </span>
    </div>` : '';

        // ── שאר האפשרויות ──
        let optionsHtml = '';

        if (Array.isArray(uniqueValues) &&
            uniqueValues.length > 0 &&
            typeof uniqueValues[0] === 'object') {
            // מערך של { value, label }
            optionsHtml = uniqueValues
                .map(item => buildOption(
                    item.value,
                    item.label,
                    currentVal === item.value,
                    this._countForFilter(colKey, item.value)
                )).join('');
        } else {
            optionsHtml = uniqueValues
                .map(v => {
                    const displayV = v === '__notfound__'
                        ? '➖ לא ב-BigFix' : v;
                    const filterV = v === '__notfound__'
                        ? 'notfound' : v;
                    return buildOption(
                        filterV,
                        displayV,
                        currentVal === filterV,
                        this._countForFilter(colKey, filterV)
                    );
                }).join('');
        }

        // ── אפשרות ריק - מופיעה בסוף אם יש ריקים ──────────────
        const emptyOption = emptyCount > 0
            ? buildOption(
                '__empty__',
                '— ריק —',
                currentVal === '__empty__',
                emptyCount
            )
            : '';

        // ── כפתור ניקוי ──
        const clearBtn = currentVal !== 'all'
            ? `<div class="srv-col-filter-clear"
                onclick="window._srvDashboard
                             ._applyColumnFilter('${colKey}', 'all')">
               <i class="fas fa-times"></i>
               נקה פילטר
           </div>`
            : '';

        setTimeout(() => {
            const allCb = document.querySelector(
                `#srvThFilter_${colKey} .srv-col-filter-cb-all`
            );
            if (allCb) {
                const total = uniqueValues.length;
                const selCount = selectedSet.size;
                allCb.indeterminate = selCount > 0 && selCount < total;
                allCb.checked = selCount === 0;
            }
        }, 0);

        return `
    <div class="srv-col-filter-inner">
        ${sortIndicator}
        ${searchHtml}
        <div class="srv-col-filter-options" id="srvColOpts_${colKey}">
            ${allOption}
            ${optionsHtml}
            ${emptyOption}
        </div>
        ${clearBtn}
    </div>`;
    }

    _applyColumnFilter(colKey, value) {
        if (value === 'all') {
            this.filters[colKey] = 'all';
        } else {
            this.filters[colKey] = value;
        }
        this._savePreferences();
        this.applyFiltersAndSort();
        this.updateStats();
        this._updateFilterCounter();
        this._updateTableRowsOnly();

        const popup = document.getElementById(`srvThFilter_${colKey}`);
        if (popup && popup.style.display !== 'none') {
            popup.innerHTML = this._buildColumnFilterContent(colKey);
        }
    }

    // ══════════════════════════════════════════════════════════
    // ספור שרתים לפי ערך פילטר
    // ══════════════════════════════════════════════════════════
    _countForFilter(colKey, value) {
        if (value === 'all') return this.allServers.length;

        // ─── ריק ───────────────────────────────────────────────
        if (value === '__empty__') {
            if (colKey === 'os') {
                return this.allServers.filter(s =>
                    !s.os || s.os.trim() === ''
                ).length;
            }
            return this.allServers.filter(s =>
                !s[colKey] || String(s[colKey]).trim() === ''
            ).length;
        }

        if (colKey === 'bigfixStatus') {
            if (value === 'notfound') {
                return this.allServers.filter(s => {
                    const key = (s.name || '').toLowerCase();
                    return !this.bigFixData[key];
                }).length;
            }
            return this.allServers.filter(s => {
                const key = (s.name || '').toLowerCase();
                const status = this.bigFixData[key];
                if (!status) return false;
                const raw = (status.pendingRestart || '').trim();
                let norm = raw;
                if (raw === 'True' || raw === 'TRUE') norm = 'Need Restart';
                if (raw === 'False' || raw === 'FALSE') norm = 'Completed';
                return norm === value;
            }).length;
        }

        if (colKey === 'isVirtual') {
            return this.allServers.filter(s =>
                this._normalizeVirtual(s.isVirtual) === value
            ).length;
        }

        if (colKey === 'os') {
            return this.allServers.filter(s =>
                this._simplifyOs(s.os) === value
            ).length;
        }

        return this.allServers.filter(s =>
            (s[colKey] || '') === value
        ).length;
    }

    _getSelectedSet(colKey) {
        const val = this.filters[colKey];
        if (!val || val === 'all') return new Set();
        if (val instanceof Set) return val;
        // ערך בודד ישן - המר ל-Set
        return new Set([val]);
    }

    _toggleColumnFilterValue(colKey, value) {

        if (value === 'all') {
            const selected = this._getSelectedSet(colKey);

            if (selected.size === 0 && !this._allDeselectedCols?.[colKey]) {
                // ── כבר "הכל" - רק עדכן UI ויזואלית ──
                const popup = document.getElementById(`srvThFilter_${colKey}`);
                if (popup && popup.style.display !== 'none') {
                    const checkboxes = popup.querySelectorAll(
                        '.srv-col-filter-cb:not(.srv-col-filter-cb-all)'
                    );
                    const allUnchecked = [...checkboxes].every(cb => !cb.checked);

                    checkboxes.forEach(cb => {
                        cb.checked = allUnchecked;
                        cb.closest('.srv-col-filter-option')?.classList.toggle(
                            'srv-col-filter-option-active', allUnchecked
                        );
                    });

                    const allCb = popup.querySelector('.srv-col-filter-cb-all');
                    if (allCb) {
                        allCb.checked = allUnchecked;
                        allCb.indeterminate = false;
                        allCb.closest('.srv-col-filter-option')?.classList.toggle(
                            'srv-col-filter-option-active', allUnchecked
                        );
                    }

                    // ─── שמור דגל: האם הכל בוטל ויזואלית ───
                    if (!this._allDeselectedCols) this._allDeselectedCols = {};
                    this._allDeselectedCols[colKey] = !allUnchecked === false
                        ? true : false;
                    // פשוט יותר:
                    this._allDeselectedCols[colKey] = !allUnchecked;

                    const selCount = popup.querySelector('.srv-col-filter-sel-count');
                    if (selCount) selCount.textContent = '';

                    const optsList = popup.querySelector('.srv-col-filter-options');
                    // שמור scroll
                }
                return;
            }

            // יש בחירות ספציפיות - נקה ל-all
            this.filters[colKey] = 'all';
            if (this._allDeselectedCols) this._allDeselectedCols[colKey] = false;

        } else {
            const selected = this._getSelectedSet(colKey);
            const isAllDeselected = this._allDeselectedCols?.[colKey];

            if (selected.size === 0 && !isAllDeselected) {
                // ─── מצב "הכל מסומן" - בטל ערך ספציפי ───
                // → כל הערכים מסומנים חוץ ממנו
                const allValues = this._getAllFilterValues(colKey);
                const newSet = new Set(allValues.filter(v => v !== value));
                this.filters[colKey] = newSet.size === 0 ? 'all' : newSet;

            } else if (selected.size === 0 && isAllDeselected) {
                // ─── מצב "הכל בוטל ויזואלית" - בחר רק אותו ───
                selected.add(value);
                this.filters[colKey] = selected;
                if (this._allDeselectedCols) this._allDeselectedCols[colKey] = false;

            } else if (selected.has(value)) {
                // ─── הערך מסומן - הסר ───
                selected.delete(value);
                this.filters[colKey] = selected.size === 0 ? 'all' : selected;

            } else {
                // ─── הערך לא מסומן - הוסף ───
                selected.add(value);
                const allValues = this._getAllFilterValues(colKey);
                this.filters[colKey] = selected.size >= allValues.length ? 'all' : selected;
            }
        }

        this._savePreferences();
        this.applyFiltersAndSort();
        this.updateStats();
        this._updateFilterCounter();
        this._updateTableRowsOnly();

        // ── עדכן popup in-place ──
        const popup = document.getElementById(`srvThFilter_${colKey}`);
        if (popup && popup.style.display !== 'none') {
            const scrollTop =
                popup.querySelector('.srv-col-filter-options')?.scrollTop || 0;
            const searchVal =
                popup.querySelector('.srv-col-filter-search')?.value || '';

            popup.innerHTML = this._buildColumnFilterContent(colKey);

            const optsList = popup.querySelector('.srv-col-filter-options');
            if (optsList) optsList.scrollTop = scrollTop;

            const searchInput = popup.querySelector('.srv-col-filter-search');
            if (searchInput) {
                searchInput.value = searchVal;
                if (searchVal) this._filterColumnOptions(searchInput, colKey);
                searchInput.focus();
            }
        }
    }

    // ─── קבל את כל הערכים האפשריים לפילטר עמודה ───────────────────
    _getAllFilterValues(colKey) {
        if (colKey === 'bigfixStatus') {
            const found = new Set();
            this.allServers.forEach(s => {
                const key = (s.name || '').toLowerCase();
                const status = this.bigFixData[key];
                if (!status) {
                    found.add('notfound');
                    return;
                }
                const raw = (status.pendingRestart || '').trim();
                let norm = raw;
                if (raw === 'True' || raw === 'TRUE') norm = 'Need Restart';
                if (raw === 'False' || raw === 'FALSE') norm = 'Completed';
                if (norm) found.add(norm);
            });
            return [...found];
        }

        if (colKey === 'isVirtual') {
            return [...new Set(
                this.allServers.map(s => this._normalizeVirtual(s.isVirtual))
            )].filter(Boolean);
        }

        if (colKey === 'os') {
            return [...new Set(
                this.allServers.map(s => this._simplifyOs(s.os))
            )].filter(Boolean);
        }

        // ─── שדה רגיל ───
        const values = [...new Set(
            this.allServers
                .map(s => s[colKey])
                .filter(v => v !== null && v !== undefined && v !== '')
        )];

        // ─── הוסף __empty__ אם יש ריקים ───
        const hasEmpty = this.allServers.some(
            s => s[colKey] === null || s[colKey] === undefined || s[colKey] === ''
        );
        if (hasEmpty) values.push('__empty__');

        return values;
    }

    _updateTableRowsOnly() {
        const tbody = document.getElementById('srvTbody');
        if (!tbody) {
            // אם אין tbody - בנה מחדש את הכל (תצוגת כרטיסים/סטטיסטיקות)
            this.renderContent();
            return;
        }

        const { page, total, pages } = this._getPaginationInfo();

        if (this.filteredServers.length === 0) {
            tbody.innerHTML = `
            <tr>
                <td colspan="20" style="text-align:center;padding:40px;color:#555">
                    <i class="fas fa-server" style="font-size:2rem;display:block;margin-bottom:10px"></i>
                    לא נמצאו שרתים
                </td>
            </tr>`;
            this.renderPagination(0, 0);
            return;
        }

        // ── בנה שורות מחדש ──
        const rowsHtml = page.map(s => {
            const envClass = s.environment === 'PROD'
                ? 'srv-badge-prod' : 'srv-badge-nonprod';
            const virtNorm = this._normalizeVirtual(s.isVirtual);
            const virtClass = virtNorm === 'TRUE'
                ? 'srv-badge-virtual'
                : virtNorm === 'FALSE'
                    ? 'srv-badge-physical'
                    : 'srv-badge-neutral';
            const statusClass = this._getStatusClass(s.systemStatus);
            const healthClass = this._getHealthClass(s.isHealthy);
            const osShort = this._simplifyOs(s.os);
            const isSelected = this.selectedServers.has(s.name);

            return `
        <tr class="srv-tr ${isSelected ? 'srv-tr-selected' : ''}"
            data-name="${this.escHtml(s.name)}">

            ${this.isAdmin ? `
            <td class="srv-td srv-td-select">
               <input type="checkbox"
                    class="srv-cb srv-cb-row"
                    data-name="${this.escHtml(s.name)}"
                    ${isSelected ? 'checked' : ''}>
            </td>` : ''}

            <td class="srv-td srv-td-name">
                <span class="srv-server-name" title="${this.escHtml(s.name)}">
                    ${this.escHtml(s.name)}
                </span>
            </td>
            <td class="srv-td srv-td-ip" title="${this.escHtml(s.scannedVia || '')}">
                ${this.escHtml(this._extractPrimaryIp(s.scannedVia))}
            </td>
            <td class="srv-td srv-td-center">
                <span class="srv-badge ${envClass}">
                    ${this.escHtml(s.environment || '')}
                </span>
            </td>
            <td class="srv-td srv-td-center">
                <span class="srv-badge ${virtClass}">
                    ${virtNorm === 'TRUE' ? '☁️ וירטואלי'
                    : virtNorm === 'FALSE' ? '🖥️ פיזי'
                        : '❓ לא ידוע'}
                </span>
            </td>
            <td class="srv-td srv-td-os" title="${this.escHtml(s.os || '')}">
                ${this.escHtml(osShort)}
            </td>
            <td class="srv-td srv-td-truncate"
                dir="${this._detectTextDir(s.systemName)}"
                title="${this.escHtml(s.systemName || '')}">
                ${this.escHtml(s.systemName || '')}
            </td>
            <td class="srv-td srv-td-catalog" title="${this.escHtml(s.catalogNumber || '')}">
                ${s.catalogNumber
                    ? `<span class="srv-system-name-link"
                            data-system-name="${this.escHtml(s.systemName)}"
                            title="לחץ לפרטי מערכת">
                        ${this.escHtml(s.catalogNumber)}
                       </span>`
                    : this.escHtml(s.catalogNumber || '')}
            </td>
            <td class="srv-td srv-td-center">
                <span class="srv-badge ${statusClass}">
                    ${this.escHtml(s.systemStatus || '')}
                </span>
            </td>
            <td class="srv-td srv-td-truncate"
                dir="${this._detectTextDir(s.systemManager)}"
                title="${this.escHtml(s.systemManager || '')}">
                ${this.escHtml(s.systemManager || '')}
            </td>
            <td class="srv-td srv-td-truncate"
                dir="${this._detectTextDir(s.team)}"
                title="${this.escHtml(s.team || '')}">
                ${this.escHtml(this._shortenDeptTeam(s.team))}
            </td>
            <td class="srv-td srv-td-truncate"
                dir="${this._detectTextDir(s.department)}"
                title="${this.escHtml(s.department || '')}">
                ${this.escHtml(this._shortenDeptTeam(s.department))}
            </td>
            <td class="srv-td srv-td-truncate"
                dir="${this._detectTextDir(s.domain)}"
                title="${this.escHtml(s.domain || '')}">
                ${this.escHtml(this._shortenDeptTeam(s.domain))}
            </td>
            <td class="srv-td srv-td-truncate"
                title="${this.escHtml(s.bootType || '')}">
                ${this.escHtml(s.bootType || '')}
            </td>
            <td class="srv-td srv-td-center srv-td-inline-select">
                ${this._buildInlineSelect(s.name, 'canShutdown', s.canShutdown || '', [
                        { value: '', label: '<span class="srv-inline-opt-empty">— ריק —</span>' },
                        { value: 'כן', label: '<span class="srv-badge srv-badge-yes"><i class="fas fa-check"></i> כן</span>' },
                        { value: 'לא', label: '<span class="srv-badge srv-badge-no"><i class="fas fa-times"></i> לא</span>' },
                    ])}
            </td>
            <td class="srv-td srv-td-center srv-td-inline-select">
                ${this._buildInlineSelect(s.name, 'isHealthy', s.isHealthy || '', [
                        { value: '', label: '<span class="srv-inline-opt-empty">— ריק —</span>' },
                        { value: 'תקין', label: '<span class="srv-badge srv-badge-healthy"><i class="fas fa-heart"></i> תקין</span>' },
                        { value: 'לא תקין', label: '<span class="srv-badge srv-badge-unhealthy"><i class="fas fa-heart-broken"></i> לא תקין</span>' },
                        { value: 'בבדיקה', label: '<span class="srv-badge srv-badge-neutral"><i class="fas fa-search"></i> בבדיקה</span>' },
                    ])}
            </td>
            <td class="srv-td srv-td-notes">
                <span class="srv-notes-text"
                    title="${this.escHtml([s.mappingNotes, s.notes].filter(Boolean).join(' | '))}">
                    ${this.escHtml([s.mappingNotes, s.notes].filter(Boolean).join(' | '))}
                </span>
                <button class="srv-edit-note-btn" data-name="${this.escHtml(s.name)}" title="ערוך הערה">
                    <i class="fas fa-pen"></i>
                </button>
                ${this.isAdmin || this.isEditor ? `
                <button class="srv-row-edit-btn" data-name="${this.escHtml(s.name)}" title="ערוך שרת">
                    <i class="fas fa-edit"></i>
                </button>` : ''}
            </td>
            <td class="srv-td srv-td-bigfix" data-bigfix="1">
                ${this._buildBigFixCell(s.name)}
            </td>
            <td class="srv-td srv-td-bigfix-date" data-bigfix-date="1">
                ${this._buildBigFixDateCell(s.name)}
            </td>
            <td class="srv-td srv-td-ping" data-ping-cell="1">
                ${this._buildPingCell(s.name)}
            </td>
        </tr>`;
        }).join('');

        tbody.innerHTML = rowsHtml;

        // ── עדכן pagination ──
        this.renderPagination(total, pages);

        // ── עדכן header checkbox ──
        const cbAll = document.querySelector('.srv-cb-all');
        if (cbAll) {
            const allSelected = page.length > 0 &&
                page.every(s => this.selectedServers.has(s.name));
            cbAll.checked = allSelected;
        }

        // ── עדכן תאי BigFix אם נטענו ──
        if (this.bigFixLoaded) {
            this._updateBigFixCells();
        }
    }

    // ── עדכן מצב checkbox "הכל" (checked / indeterminate / unchecked) ──
    _updateAllCheckbox(colKey, popupEl) {
        const popup = popupEl || document.getElementById(`srvThFilter_${colKey}`);
        if (!popup) return;

        const allCb = popup.querySelector('.srv-col-filter-cb-all');
        if (!allCb) return;

        const selected = this._getSelectedSet(colKey);

        // ── ספור רק אפשרויות שאינן "הכל" ──
        const allOptions = popup.querySelectorAll(
            '.srv-col-filter-option:not(.srv-col-filter-option-all)'
        );
        const total = allOptions.length;
        const selCount = selected.size;

        if (selCount === 0) {
            // ── אין בחירה ספציפית = "הכל" מסומן ──
            allCb.checked = true;
            allCb.indeterminate = false;
            allCb.closest('.srv-col-filter-option')
                ?.classList.add('srv-col-filter-option-active');
        } else if (selCount >= total) {
            // ── הכל נבחר ──
            allCb.checked = true;
            allCb.indeterminate = false;
            allCb.closest('.srv-col-filter-option')
                ?.classList.add('srv-col-filter-option-active');
        } else {
            // ── חלק נבחר = indeterminate ──
            allCb.checked = false;
            allCb.indeterminate = true;
            allCb.closest('.srv-col-filter-option')
                ?.classList.remove('srv-col-filter-option-active');
        }

        // ── עדכן גם את שאר הצ'קבוקסים ──
        if (selCount === 0) {
            // כשאין בחירה - סמן הכל
            popup.querySelectorAll(
                '.srv-col-filter-option:not(.srv-col-filter-option-all) .srv-col-filter-cb'
            ).forEach(cb => {
                cb.checked = true;
                cb.closest('.srv-col-filter-option')
                    ?.classList.add('srv-col-filter-option-active');
            });
        }
    }

    _selectAllColumnFilter(colKey) {
        const popup = document.getElementById(`srvThFilter_${colKey}`);
        const scrollTop =
            popup?.querySelector('.srv-col-filter-options')?.scrollTop || 0;

        this.filters[colKey] = 'all';
        this._savePreferences();
        this.applyFiltersAndSort();
        this.updateStats();
        this._updateFilterCounter();
        this._updateTableRowsOnly();

        // ── עדכן popup in-place ──
        if (popup && popup.style.display !== 'none') {
            popup.innerHTML = this._buildColumnFilterContent(colKey);
            const optsList = popup.querySelector('.srv-col-filter-options');
            if (optsList) optsList.scrollTop = scrollTop;
            this._updateAllCheckbox(colKey, popup);
        }
    }

    _clearColumnFilter(colKey) {
        this._selectAllColumnFilter(colKey);
    }

    // ══════════════════════════════════════════════════════════
    // סינון אפשרויות בתוך popup (חיפוש טקסט)
    // ══════════════════════════════════════════════════════════
    _filterColumnOptions(inputEl, colKey) {
        const term = (inputEl.value || '').toLowerCase().trim();
        const container = document.getElementById(`srvColOpts_${colKey}`);
        if (!container) return;

        container.querySelectorAll('.srv-col-filter-option').forEach(opt => {
            const label = (opt.querySelector(
                '.srv-col-filter-option-label'
            )?.textContent || '').toLowerCase();
            const value = (opt.dataset.value || '').toLowerCase();

            // "הכל" תמיד נראה
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

    // ─── בנה תא PING ──────────────────────────────────────────────
    _buildPingCell(serverName) {
        const cached = this._pingCache?.[serverName.toLowerCase()];

        if (!cached) {
            return `
    <button class="srv-ping-btn"
            data-name="${this.escHtml(serverName)}"
            title="בדוק PING ל-${this.escHtml(serverName)}">
        <i class="fas fa-satellite-dish"></i>
    </button>`;
        }

        if (cached.loading) {
            return `
    <span class="srv-ping-loading" title="בודק...">
        <i class="fas fa-spinner fa-spin"></i>
    </span>`;
        }

        if (cached.error) {
            return `
    <span class="srv-ping-error"
          title="${this.escHtml(cached.error)}">
        <i class="fas fa-exclamation-circle"></i>
        <button class="srv-ping-btn srv-ping-retry"
                data-name="${this.escHtml(serverName)}"
                title="נסה שוב">
            <i class="fas fa-redo"></i>
        </button>
    </span>`;
        }

        // ─── בנה tooltip מפורט ───────────────────────────────────
        const tooltipLines = [];

        if (cached.resolvedIp)
            tooltipLines.push(`IP שהוחזר: ${cached.resolvedIp}`);

        if (cached.resolvedName)
            tooltipLines.push(`שם DNS: ${cached.resolvedName}`);

        if (cached.storedIp)
            tooltipLines.push(`IP ברשומה: ${cached.storedIp}`);

        if (cached.hasMismatch && cached.mismatches?.length > 0)
            tooltipLines.push(
                '⚠️ ' + cached.mismatches.join(' | ')
            );

        const tooltip = tooltipLines.join('\n') ||
            cached.summary || '';

        // ─── badge אי-התאמה ───────────────────────────────────────
        const mismatchBadge = cached.hasMismatch
            ? `<span class="srv-ping-mismatch"
                 title="${this.escHtml(
                (cached.mismatches || []).join('\n')
            )}">
               <i class="fas fa-exclamation-triangle"></i>
           </span>`
            : '';

        // ─── מידע DNS - הצג רק אם שונה מהנתונים במערכת ──────────────

        // ─── נתוני המערכת (מה שמוגדר ברשומה) ────────────────────────
        const storedIpClean = (cached.storedIp || '').trim().toLowerCase();
        const storedNameClean = serverName.trim().toLowerCase();

        // ─── נתונים שהוחזרו מהפינג/DNS ───────────────────────────────
        const resolvedIpClean = (cached.resolvedIp || '').trim().toLowerCase();
        const resolvedNameShort = this._stripDomain(cached.resolvedName || '');
        const resolvedNameClean = resolvedNameShort.trim().toLowerCase();

        // ─── השוואה: IP שהוחזר vs IP במערכת ─────────────────────────
        // הצג רק אם:
        // 1. יש IP שהוחזר
        // 2. יש IP במערכת
        // 3. הם שונים
        const showResolvedIp =
            resolvedIpClean !== '' &&
            storedIpClean !== '' &&
            resolvedIpClean !== storedIpClean;

        // ─── השוואה: שם שהוחזר vs שם במערכת ─────────────────────────
        // הצג רק אם:
        // 1. יש שם שהוחזר
        // 2. יש שם במערכת
        // 3. הם שונים
        const showResolvedName =
            resolvedNameClean !== '' &&
            storedNameClean !== '' &&
            resolvedNameClean !== storedNameClean;

        // ─── בנה dnsInfo רק אם יש מה להציג ──────────────────────────
        const dnsInfo = (showResolvedIp || showResolvedName)
            ? `<span class="srv-ping-dns"
             title="${this.escHtml(tooltip)}">
           ${showResolvedIp
                ? `<span class="srv-ping-resolved-ip"
                        title="IP שהוחזר: ${this.escHtml(cached.resolvedIp)}
≠ IP במערכת: ${this.escHtml(cached.storedIp)}">
                      <i class="fas fa-exclamation-triangle"></i>
                      ${this.escHtml(cached.resolvedIp)}
                  </span>`
                : ''}
           ${showResolvedName
                ? `<span class="srv-ping-resolved-name"
                        title="שם שהוחזר: ${this.escHtml(resolvedNameShort)}
≠ שם במערכת: ${this.escHtml(serverName)}">
                      <i class="fas fa-exclamation-triangle"></i>
                      ${this.escHtml(resolvedNameShort)}
                  </span>`
                : ''}
       </span>`
            : '';

        // ─── מגיב ─────────────────────────────────────────────────────
        if (cached.isAlive) {
            const rttStr = cached.avgRtt > 0
                ? Math.round(cached.avgRtt) + 'ms'
                : 'OK';

            // ─── אם מגיב לפי IP - הצג גם את שם השרת שהוחזר ─────────
            let targetLabel = '';
            if (cached.targetType === 'ip') {

                // ─── שם שהוחזר מ-Reverse DNS ─────────────────────────
                const reverseName = cached.pingByIp?.resolvedName
                    ? this._stripDomain(cached.pingByIp.resolvedName)
                    : (cached.resolvedName
                        ? this._stripDomain(cached.resolvedName)
                        : '');

                // ─── בנה tooltip מפורט ───────────────────────────────
                const ipTooltipLines = [
                    `לא הגיב לפי שם: ${serverName}`,
                    `מגיב לפי IP: ${cached.storedIp || cached.target}`,
                ];
                if (reverseName)
                    ipTooltipLines.push(`שם שהוחזר מה-IP: ${reverseName}`);

                // ─── בדוק אם השם שהוחזר שונה מהשם המקורי ────────────
                const nameMismatch = reverseName &&
                    !reverseName.toLowerCase()
                        .includes(serverName.toLowerCase()) &&
                    !serverName.toLowerCase()
                        .includes(reverseName.toLowerCase());

                targetLabel = `
        <span class="srv-ping-via-ip-wrap
                      ${nameMismatch ? 'srv-ping-via-ip-name-diff' : ''}"
              title="${this.escHtml(ipTooltipLines.join('\n'))}">
            <span class="srv-ping-via-ip-label">
                <i class="fas fa-network-wired"></i>
                via IP
            </span>
            ${reverseName
                        ? `<span class="srv-ping-via-ip-name
                              ${nameMismatch
                            ? 'srv-ping-via-ip-name-mismatch'
                            : 'srv-ping-via-ip-name-match'}">
                       ${nameMismatch
                            ? '<i class="fas fa-exclamation-triangle"></i>'
                            : '<i class="fas fa-check"></i>'}
                       ${this.escHtml(reverseName)}
                   </span>`
                        : `<span class="srv-ping-via-ip-name-unknown">
                       <i class="fas fa-question"></i>
                       שם לא ידוע
                   </span>`
                    }
        </span>`;
            }

            const canUpdateIp = this.isAdmin &&
                cached.resolvedIp &&
                cached.storedIp &&
                cached.resolvedIp !== cached.storedIp;

            const updateIpBtn = canUpdateIp
                ? `<button class="srv-ping-update-ip-btn"
                   data-name="${this.escHtml(serverName)}"
                   data-new-ip="${this.escHtml(cached.resolvedIp)}"
                   title="עדכן IP מ-${this.escHtml(cached.storedIp)} ל-${this.escHtml(cached.resolvedIp)}">
               <i class="fas fa-sync-alt"></i> עדכן IP
           </button>`
                : '';

            return `
<span class="srv-ping-alive ${cached.hasMismatch
                    ? 'srv-ping-alive-mismatch' : ''}"
      title="${this.escHtml(tooltip)}">
    <i class="fas fa-check-circle"></i>
    <span class="srv-ping-rtt">${rttStr}</span>
    ${targetLabel}
    ${dnsInfo ? dnsInfo : mismatchBadge}
    ${updateIpBtn}
    <button class="srv-ping-btn srv-ping-retry"
            data-name="${this.escHtml(serverName)}"
            title="בדוק שוב">
        <i class="fas fa-redo"></i>
    </button>
</span>`;
        }

        // ─── לא מגיב ──────────────────────────────────────────────
        // ← הוסף גם כאן - אולי ה-IP שגוי וצריך עדכון
        const canUpdateIpDead = this.isAdmin &&
            cached.resolvedIp &&
            cached.storedIp &&
            cached.resolvedIp !== cached.storedIp;

        const updateIpBtnDead = canUpdateIpDead
            ? `<button class="srv-ping-update-ip-btn"
               data-name="${this.escHtml(serverName)}"
               data-new-ip="${this.escHtml(cached.resolvedIp)}"
               title="עדכן IP ל-${this.escHtml(cached.resolvedIp)}">
           <i class="fas fa-sync-alt"></i> עדכן IP
       </button>`
            : '';

        return `
<span class="srv-ping-dead"
      title="${this.escHtml(tooltip || 'לא מגיב')}">
    <i class="fas fa-times-circle"></i>
    <span>לא מגיב</span>
    ${updateIpBtnDead}
    <button class="srv-ping-btn srv-ping-retry"
            data-name="${this.escHtml(serverName)}"
            title="בדוק שוב">
        <i class="fas fa-redo"></i>
    </button>
</span>`;
    }

    // ─── עזר: הסר דומיין משם ─────────────────────────────────────
    _stripDomain(hostname) {
        if (!hostname) return '';
        const dotIdx = hostname.indexOf('.');
        return dotIdx > 0
            ? hostname.substring(0, dotIdx)
            : hostname;
    }

    // ─── בצע PING לשרת ────────────────────────────────────────────
    async _doPing(serverName) {
        if (!this._pingCache) this._pingCache = {};
        const key = serverName.toLowerCase();
        this._pingCache[key] = { loading: true };
        this._updatePingCell(serverName);

        try {
            const res = await fetch(
                `/Servers/PingServer?name=${encodeURIComponent(serverName)}`,
                { method: 'GET', credentials: 'include' }
            );

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בבדיקת PING');

            // ─── שמור תוצאה מורחבת ───────────────────────────────
            this._pingCache[key] = {
                loading: false,
                isAlive: data.isAlive,
                avgRtt: data.avgRtt,
                successCount: data.successCount,
                summary: data.summary,
                target: data.target,
                targetType: data.targetType,
                storedIp: data.storedIp,
                allIps: data.allIps || [],
                successfulIp: data.successfulIp || '',  // ← חדש: ה-IP שהצליח

                // ─── DNS / Reverse DNS ────────────────────────────
                resolvedIp: data.resolvedIp || '',
                resolvedName: data.resolvedName || '',

                // ─── אי-התאמות ────────────────────────────────────
                hasMismatch: data.hasMismatch || false,
                mismatches: data.mismatches || [],

                // ─── פרטי שני הניסיונות ───────────────────────────
                pingByName: data.pingByName || null,
                pingByIp: data.pingByIp || null,

                timestamp: new Date(),
                error: null
            };

            // ─── בנה הודעת Toast ──────────────────────────────────
            let toastMsg = data.summary || '';

            // ─── הוסף מידע על IPs שנוסו ──────────────────────────
            if (!data.isAlive && data.allIps?.length > 1) {
                toastMsg += ` | נוסו: ${data.allIps.join(', ')}`;
            }

            // ─── הוסף מידע DNS ────────────────────────────────────
            if (data.resolvedIp || data.resolvedName) {
                const dnsStr = [
                    data.resolvedIp
                        ? `IP: ${data.resolvedIp}` : '',
                    data.resolvedName
                        ? `שם: ${this._stripDomain(data.resolvedName)}`
                        : ''
                ].filter(Boolean).join(' | ');

                if (dnsStr) toastMsg += ` | ${dnsStr}`;
            }

            // ─── הוסף אזהרת אי-התאמה ─────────────────────────────
            if (data.hasMismatch && data.mismatches?.length > 0) {
                toastMsg += ` | ⚠️ ${data.mismatches[0]}`;
            }

            const toastType = data.isAlive
                ? (data.hasMismatch ? 'error' : 'success')
                : 'error';

            const icon = data.isAlive
                ? (data.hasMismatch ? '🟡' : '🟢')
                : '🔴';

            this.showToast(
                `${icon} ${serverName}: ${toastMsg}`,
                toastType,
                10 * 1000
            );

        } catch (err) {
            console.error('_doPing error:', err);

            this._pingCache[key] = {
                loading: false,
                isAlive: false,
                error: err.message,
                timestamp: new Date()
            };

            this.showToast(
                `⚠️ PING ${serverName}: ${err.message}`, 'error'
            );
        }

        this._updatePingCell(serverName);
    }

    // ─── עדכן תא PING בטבלה ───────────────────────────────────────
    _updatePingCell(serverName) {
        const tbody = document.getElementById('srvTbody');
        if (!tbody) return;

        const row = tbody.querySelector(
            `tr.srv-tr[data-name="${this.escHtml(serverName)}"]`
        );
        if (!row) return;

        const cell = row.querySelector('td[data-ping-cell="1"]');
        if (!cell) return;

        cell.innerHTML = this._buildPingCell(serverName);

        // ─── הרחב עמודת PING אחרי תוצאה ─────────────────────────
        const cached = this._pingCache?.[serverName.toLowerCase()];
        if (cached && !cached.loading) {
            this._expandPingColumn();
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל ניהול הרשאות שרתים
    // ══════════════════════════════════════════════════════════
    async openPermissionsModal() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה לניהול הרשאות', 'error');
            return;
        }

        const existing = document.getElementById('srvPermModal');
        if (existing) existing.remove();

        // ─── הצג loading ───
        const modal = document.createElement('div');
        modal.id = 'srvPermModal';
        modal.className = 'srv-modal-overlay';
        modal.innerHTML = `
        <div class="srv-modal" style="max-width:1000px;width:95%">
            <div class="srv-modal-header" style="
                background:linear-gradient(135deg,
                    rgba(99,102,241,0.12),
                    rgba(124,58,237,0.08));
                border-bottom:2px solid rgba(99,102,241,0.35)">
                <h3 class="srv-modal-title">
                    <i class="fas fa-user-shield"
                       style="color:#a5b4fc"></i>
                    ניהול הרשאות שרתים
                    <span style="
                        padding:2px 10px;
                        background:rgba(239,68,68,0.15);
                        border:1px solid rgba(239,68,68,0.35);
                        border-radius:8px;
                        color:#fca5a5;
                        font-size:0.72rem;
                        font-weight:700">
                        Admin Only
                    </span>
                </h3>
                <button class="srv-modal-close"
                        id="srvPermClose">&times;</button>
            </div>
            <div class="srv-modal-body" style="
                align-items:center;justify-content:center;
                padding:40px;gap:10px;color:#666">
                <i class="fas fa-spinner fa-spin"
                   style="color:#6366f1;font-size:1.2rem"></i>
                <span>טוען הרשאות...</span>
            </div>
        </div>`;

        document.body.appendChild(modal);

        document.getElementById('srvPermClose')
            ?.addEventListener('click', () => modal.remove());

        try {
            // ─── טען הרשאות + משתמשים במקביל ───
            const [permsRes, usersRes] = await Promise.all([
                fetch('/Servers/GetServersPermissions',
                    { credentials: 'include' }),
                fetch('/Servers/GetAllUsers',
                    { credentials: 'include' })
            ]);

            const permsData = await permsRes.json();
            const usersData = await usersRes.json();

            if (!permsData.success)
                throw new Error(permsData.error || 'שגיאה בטעינת הרשאות');

            const perms = permsData.permissions;
            const allUsers = usersData.success
                ? (usersData.users || []).map(u => u.username)
                : [];

            this._renderPermissionsModal(modal, perms, allUsers);

        } catch (err) {
            const body = modal.querySelector('.srv-modal-body');
            if (body) {
                body.innerHTML = `
                <div style="color:#f87171;text-align:center;
                            padding:20px">
                    <i class="fas fa-exclamation-triangle"
                       style="font-size:1.5rem;margin-bottom:8px;
                              display:block"></i>
                    שגיאה: ${this.escHtml(err.message)}
                </div>`;
            }
        }
    }

    // ─── רנדר תוכן מודל הרשאות ───────────────────────────────────
    _renderPermissionsModal(modal, perms, allUsers) {
        const admins = perms.admins || perms.Admins || [];
        const editors = perms.editors || perms.Editors || [];
        const lastUpd = perms.lastUpdated || perms.LastUpdated || '—';
        const updatedBy = perms.updatedBy || perms.UpdatedBy || '—';
        // ─── בנה רשימת משתמשים לבחירה ───────────────────────────

        const buildUserList = (listId, currentList, title,
            color, icon) => {

            const listItems = currentList.map((u, i) => {

                // ─── בדוק אם אדמין קשיח של המערכת ───────────────────
                const isSystemAdmin = listId === 'admins' &&
                    (this.systemAdmins || []).some(
                        sa => sa.toLowerCase() === u.toLowerCase()
                    );

                // ─── בדוק אם המשתמש הנוכחי ───────────────────────────
                const isCurrentUser =
                    u.toLowerCase() ===
                    this.currentUser.toLowerCase();

                // ─── ניתן להסיר רק אם לא אדמין מערכת ולא עצמו ───────
                const canRemove = !isSystemAdmin && !isCurrentUser;

                // ─── בנה badge מתאים ──────────────────────────────────
                const lockBadge = isSystemAdmin
                    ? `<span style="
                    font-size:0.65rem;
                    color:#f59e0b;
                    background:rgba(245,158,11,0.12);
                    border:1px solid rgba(245,158,11,0.3);
                    border-radius:5px;
                    padding:1px 6px;
                    white-space:nowrap"
                    title="אדמין מערכת - לא ניתן להסיר">
                    <i class="fas fa-lock"></i> מערכת
                  </span>`
                    : isCurrentUser
                        ? `<span style="
                        font-size:0.65rem;
                        color:#6366f1;
                        background:rgba(99,102,241,0.12);
                        border:1px solid rgba(99,102,241,0.3);
                        border-radius:5px;
                        padding:1px 6px;
                        white-space:nowrap"
                        title="המשתמש הנוכחי - לא ניתן להסיר">
                        <i class="fas fa-user-circle"></i> אתה
                      </span>`
                        : '';

                const removeBtn = canRemove
                    ? `<button class="srv-perm-remove-btn"
                           data-list="${listId}"
                           data-user="${this.escHtml(u)}"
                           title="הסר">
                       <i class="fas fa-times"></i>
                   </button>`
                    : `<button class="srv-perm-remove-btn"
                           disabled
                           style="opacity:0.2;cursor:not-allowed"
                           title="${isSystemAdmin
                        ? 'אדמין מערכת - לא ניתן להסיר'
                        : 'לא ניתן להסיר את עצמך'}">
                       <i class="fas fa-lock"></i>
                   </button>`;

                return `
            <div class="srv-perm-user-item"
                 data-list="${listId}"
                 data-index="${i}">
                <i class="fas fa-user"
                   style="color:${color};
                          font-size:0.7rem"></i>
                <span class="srv-perm-user-name">
                    ${this.escHtml(u)}
                </span>
                ${lockBadge}
                ${removeBtn}
            </div>`;
            }).join('');

            // ─── dropdown - סנן משתמשים שכבר ברשימה ──────────────────
            const availableUsers = allUsers.filter(
                u => !currentList.some(
                    cu => cu.toLowerCase() === u.toLowerCase()
                )
            );

            const userOptions = availableUsers
                .map(u => `
            <option value="${this.escHtml(u)}">
                ${this.escHtml(u)}
            </option>`)
                .join('');

            return `
        <div class="srv-perm-section">
            <div class="srv-perm-section-header"
                 style="border-right:3px solid ${color}">
                <i class="fas ${icon}"
                   style="color:${color}"></i>
                <span style="color:${color};font-weight:700">
                    ${title}
                </span>
                <span class="srv-perm-count"
                      style="background:${color}22;
                             border:1px solid ${color}44;
                             color:${color}"
                      id="srvPermCount_${listId}">
                    ${currentList.length}
                </span>
            </div>

            <div class="srv-perm-user-list"
                 id="srvPermList_${listId}">
                ${listItems || `
                    <div style="color:#555;font-size:0.78rem;
                                padding:8px;font-style:italic">
                        אין משתמשים ברשימה
                    </div>`}
            </div>

            <!-- ─── הוספה מרשימה בלבד ─── -->
            <div class="srv-perm-add-row">
                <select id="srvPermSelect_${listId}"
                        class="srv-select"
                        style="flex:1;font-size:0.8rem">
                    <option value="">
                        — בחר משתמש להוספה —
                    </option>
                    ${userOptions}
                </select>
                <button class="srv-perm-add-btn"
                        data-list="${listId}"
                        style="background:${color}22;
                               border:1px solid ${color}44;
                               color:${color}">
                    <i class="fas fa-plus"></i>
                </button>
            </div>

            ${listId === 'admins' ? `
                <!-- הסבר נעילות -->
                <div style="
                    display:flex;
                    gap:12px;
                    flex-wrap:wrap;
                    padding:10px 14px;
                    background:rgba(255,255,255,0.02);
                    border:1px solid rgba(255,255,255,0.06);
                    border-radius:8px;
                    font-size:0.75rem">

                    <div style="
                        display:flex;
                        align-items:center;
                        gap:6px;
                        color:#f59e0b">
                        <i class="fas fa-lock"
                        style="font-size:0.65rem"></i>
                        <span>
                            <strong>מערכת</strong> =
                            אדמין קשיח, לא ניתן להסיר
                        </span>
                    </div>

                    <div style="
                        display:flex;
                        align-items:center;
                        gap:6px;
                        color:#6366f1">
                        <i class="fas fa-user-circle"
                        style="font-size:0.65rem"></i>
                        <span>
                            <strong>אתה</strong> =
                            לא ניתן להסיר את עצמך
                        </span>
                    </div>

                </div>
            ` : ''}
        </div>`;
        };

        // ─── בנה את המודל ─────────────────────────────────────────────
        const modalEl = modal.querySelector('.srv-modal');
        modalEl.innerHTML = `
    <div class="srv-modal-header" style="
        background:linear-gradient(135deg,
            rgba(99,102,241,0.12),
            rgba(124,58,237,0.08));
        border-bottom:2px solid rgba(99,102,241,0.35)">
        <h3 class="srv-modal-title">
            <i class="fas fa-user-shield"
               style="color:#a5b4fc"></i>
            ניהול הרשאות שרתים
        </h3>
        <button class="srv-modal-close"
                id="srvPermClose2">&times;</button>
    </div>

    <!-- מידע אחרון -->
    <div style="
        display:flex;align-items:center;gap:8px;
        padding:8px 20px;
        background:rgba(99,102,241,0.05);
        border-bottom:1px solid rgba(99,102,241,0.12);
        font-size:0.75rem;color:#666">
        <i class="fas fa-clock" style="color:#6366f1"></i>
        עדכון אחרון:
        <strong style="color:#a5b4fc">
            ${this.escHtml(lastUpd)}
        </strong>
        על ידי
        <strong style="color:#a5b4fc">
            ${this.escHtml(updatedBy)}
        </strong>
        <span style="margin-right:auto;color:#555">
            <i class="fas fa-users" style="color:#6366f1"></i>
            ${allUsers.length} משתמשים במערכת
        </span>
    </div>

    <!-- גוף -->
    <div class="srv-modal-body"
         style="max-height:65vh;overflow-y:auto;
                padding:16px 20px;gap:14px">

        <!-- ─── שני sections בשורה אחת ─── -->
        <div style="
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:12px;
            align-items:start">

        ${buildUserList(
            'admins',
            admins,
            'אדמינים',
            '#f59e0b',
            'fa-shield-alt'
        )}

        ${buildUserList(
            'editors',
            editors,
            'עורכים',
            '#6366f1',
            'fa-edit'
        )}
        </div>
        <!-- legend הרשאות -->
        <div class="srv-perm-legend">
            <div class="srv-perm-legend-title">
                <i class="fas fa-info-circle"
                   style="color:#6366f1"></i>
                רמות הרשאה:
            </div>
            <div class="srv-perm-legend-row">
                <span class="srv-perm-legend-badge"
                      style="background:rgba(245,158,11,0.15);
                             border-color:rgba(245,158,11,0.4);
                             color:#fcd34d">
                    <i class="fas fa-shield-alt"></i> Admin
                </span>
                <span class="srv-perm-legend-desc">
                    גישה מלאה — הוספה, מחיקה, עריכת כל השדות,
                    ייבוא, ניהול הרשאות
                </span>
            </div>
            <div class="srv-perm-legend-row">
                <span class="srv-perm-legend-badge"
                      style="background:rgba(99,102,241,0.15);
                             border-color:rgba(99,102,241,0.4);
                             color:#a5b4fc">
                    <i class="fas fa-edit"></i> Editor
                </span>
                <span class="srv-perm-legend-desc">
                    עריכה מוגבלת — תקינות, סטטוס, הערות
                </span>
            </div>
        </div>

    </div>

    <!-- Footer -->
    <div class="srv-modal-footer">
        <button class="srv-modal-cancel-btn"
                id="srvPermCancel">
            <i class="fas fa-times"></i> ביטול
        </button>
        <button id="srvPermSave"
                style="padding:8px 20px;
                       background:linear-gradient(
                           135deg,#4f46e5,#7c3aed);
                       border:none;border-radius:6px;
                       color:white;font-size:0.85rem;
                       font-weight:700;cursor:pointer;
                       display:flex;align-items:center;
                       gap:6px;font-family:inherit;
                       transition:all 0.2s">
            <i class="fas fa-save"></i>
            שמור הרשאות
        </button>
    </div>`;

        // ─── שמור נתונים ──────────────────────────────────────────────
        this._permData = {
            admins: [...admins],
            editors: [...editors]
        };

        // ─── אירועים ──────────────────────────────────────────────────
        document.getElementById('srvPermClose2')
            ?.addEventListener('click', () => modal.remove());
        document.getElementById('srvPermCancel')
            ?.addEventListener('click', () => modal.remove());
        document.getElementById('srvPermSave')
            ?.addEventListener('click', () =>
                this._savePermissions(modal));

        // ─── הסר / הוסף משתמש ────────────────────────────────────
        modalEl.addEventListener('click', e => {
            const removeBtn = e.target.closest(
                '.srv-perm-remove-btn'
            );
            if (removeBtn && !removeBtn.disabled) {
                const listId = removeBtn.dataset.list;
                const user = removeBtn.dataset.user;
                this._removePermUser(listId, user, modal);
            }

            const addBtn = e.target.closest('.srv-perm-add-btn');
            if (addBtn) {
                const listId = addBtn.dataset.list;
                this._addPermUser(listId, modal, allUsers);
            }
        });
    }

    // ─── הוסף משתמש לרשימה ───────────────────────────────────────
    _addPermUser(listId, modal, allUsers) {
        // ─── קרא ערך מה-select בלבד ───────────────────────────
        const sel = document.getElementById(`srvPermSelect_${listId}`);
        const username = (sel?.value || '').trim();

        if (!username) {
            this.showToast('בחר משתמש מהרשימה', 'error');
            return;
        }

        if (!this._permData) this._permData = { admins: [], editors: [] };

        const list = this._permData[listId] || [];

        if (list.some(u => u.toLowerCase() === username.toLowerCase())) {
            this.showToast(`${username} כבר ברשימה`, 'error');
            sel.value = '';
            return;
        }

        list.push(username);
        this._permData[listId] = list;

        // ─── עדכן UI - הוסף שורה לרשימה ───────────────────────
        const listEl = document.getElementById(`srvPermList_${listId}`);
        if (listEl) {
            const color = listId === 'admins' ? '#f59e0b' : '#6366f1';

            // ─── הסר הודעת "אין משתמשים" אם קיימת ───
            const emptyMsg = listEl.querySelector('div[style*="font-style:italic"]');
            if (emptyMsg) emptyMsg.remove();

            const newItem = document.createElement('div');
            newItem.className = 'srv-perm-user-item';
            newItem.dataset.list = listId;
            newItem.innerHTML = `
            <i class="fas fa-user"
               style="color:${color};font-size:0.7rem"></i>
            <span class="srv-perm-user-name">
                ${this.escHtml(username)}
            </span>
            <button class="srv-perm-remove-btn"
                    data-list="${listId}"
                    data-user="${this.escHtml(username)}"
                    title="הסר">
                <i class="fas fa-times"></i>
            </button>`;
            listEl.appendChild(newItem);
        }

        // ─── הסר מה-dropdown ───────────────────────────────────
        if (sel) {
            const optToRemove = sel.querySelector(
                `option[value="${CSS.escape(username)}"]`
            );
            if (optToRemove) optToRemove.remove();
            sel.value = '';
        }

        // ─── עדכן מונה ─────────────────────────────────────────
        const countEl = document.getElementById(`srvPermCount_${listId}`);
        if (countEl) countEl.textContent = list.length;

        this.showToast(`✅ ${username} נוסף`, 'success');
    }

    // ─── הסר משתמש מרשימה ────────────────────────────────────────
    _removePermUser(listId, username, modal) {
        if (!this._permData) return;

        if (listId === 'admins') {

            // ─── הגנה 1: אדמין קשיח של המערכת ───────────────────────
            const isSystemAdmin = (this.systemAdmins || []).some(
                sa => sa.toLowerCase() === username.toLowerCase()
            );
            if (isSystemAdmin) {
                this.showToast(
                    `לא ניתן להסיר אדמין מערכת: ${username}`,
                    'error'
                );
                return;
            }

            // ─── הגנה 2: המשתמש הנוכחי ───────────────────────────────
            if (username.toLowerCase() ===
                this.currentUser.toLowerCase()) {
                this.showToast('לא ניתן להסיר את עצמך', 'error');
                return;
            }
        }

        const list = this._permData[listId] || [];
        this._permData[listId] = list.filter(
            u => u.toLowerCase() !== username.toLowerCase()
        );

        // ─── עדכן UI ────────────────────────────────────────────────
        const listEl = document.getElementById(
            `srvPermList_${listId}`
        );
        if (listEl) {
            const item = listEl.querySelector(
                `.srv-perm-remove-btn[data-user="${username}"]`
            )?.closest('.srv-perm-user-item');

            if (item) {
                item.style.transition =
                    'opacity 0.2s, transform 0.2s';
                item.style.opacity = '0';
                item.style.transform = 'translateX(10px)';
                setTimeout(() => {
                    item.remove();
                    if (listEl.children.length === 0) {
                        listEl.innerHTML = `
                        <div style="color:#555;font-size:0.78rem;
                                    padding:8px;font-style:italic">
                            אין משתמשים ברשימה
                        </div>`;
                    }
                }, 200);
            }
        }

        // ─── החזר למשתמש ל-dropdown ──────────────────────────────────
        const sel = document.getElementById(
            `srvPermSelect_${listId}`
        );
        if (sel) {
            const opt = document.createElement('option');
            opt.value = username;
            opt.textContent = username;
            sel.appendChild(opt);
        }

        // ─── עדכן מונה ───────────────────────────────────────────────
        const countEl = document.getElementById(
            `srvPermCount_${listId}`
        );
        if (countEl) {
            countEl.textContent = this._permData[listId].length;
        }

        this.showToast(`🗑️ ${username} הוסר`, 'info');
    }

    // ─── שמור הרשאות לשרת ────────────────────────────────────────
    async _savePermissions(modal) {
        const saveBtn = document.getElementById('srvPermSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const payload = {
                admins: this._permData?.admins || [],
                editors: this._permData?.editors || [],
                lastUpdated: '',
                updatedBy: ''
            };

            const res = await fetch('/Servers/SavePermissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            modal.remove();
            this.showToast('✅ הרשאות נשמרו בהצלחה', 'success');

        } catch (err) {
            console.error('_savePermissions error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-save"></i> שמור הרשאות';
            }
        }
    }

    // ─── הרחב עמודת PING ──────────────────────────────────────────
    _expandPingColumn() {
        if (this._pingColumnExpanded) return; // ← כבר הורחבה
        this._pingColumnExpanded = true;

        const table = document.querySelector('.srv-table');
        if (!table) return;

        // ─── מצא את אינדקס עמודת PING ────────────────────────────
        const headers = table.querySelectorAll('thead th.srv-th');
        let pingColIndex = -1;

        headers.forEach((th, idx) => {
            if (th.dataset.col === 'ping') pingColIndex = idx;
        });

        if (pingColIndex === -1) return;

        // ─── עדכן colgroup ────────────────────────────────────────
        const cols = table.querySelectorAll('colgroup col');
        if (cols[pingColIndex]) {
            cols[pingColIndex].style.width = '140px';
            cols[pingColIndex].style.minWidth = '140px';
        }

        // ─── עדכן th ──────────────────────────────────────────────
        const pingTh = headers[pingColIndex];
        if (pingTh) {
            pingTh.style.minWidth = '140px';
            pingTh.style.width = '140px';
        }

        // ─── עדכן כל תאי PING בשורות ─────────────────────────────
        table.querySelectorAll('td[data-ping-cell="1"]').forEach(td => {
            td.style.minWidth = '140px';
            td.style.width = '140px';
        });
    }

    // ══════════════════════════════════════════════════════════
    // Inline Select - שדה לחיץ בטבלה
    // ══════════════════════════════════════════════════════════
    _buildInlineSelect(serverName, field, currentValue, options) {
        const displayVal = currentValue || '';

        // ─── בנה badge לפי שדה וערך ───
        const badgeHtml = this._getInlineBadge(field, displayVal);

        // ─── רק אדמין או עורך ───────────────────────────────────
        if (!this.isAdmin && !this.isEditor) {
            return badgeHtml;
        }

        // ─── אם אדמין - הצג badge לחיץ ───
        return `
    <div class="srv-inline-select-wrap"
         data-server="${this.escHtml(serverName)}"
         data-field="${field}"
         title="לחץ לשינוי">
        <div class="srv-inline-select-display">
            ${badgeHtml}
            <i class="fas fa-chevron-down srv-inline-chevron"></i>
        </div>
        <div class="srv-inline-select-dropdown" style="display:none">
            ${options.map(opt => `
            <div class="srv-inline-option
                        ${opt.value === displayVal
                ? 'srv-inline-option-active' : ''}"
                 data-value="${this.escHtml(opt.value)}">
                ${opt.label}
            </div>`).join('')}
        </div>
    </div>`;
    }

    // ─── Badge לפי שדה וערך ──────────────────────────────────
    _getInlineBadge(field, value) {
        if (!value) {
            return `<span class="srv-inline-empty">
                    <i class="fas fa-minus"></i>
                </span>`;
        }

        if (field === 'canShutdown') {
            if (value === 'כן') {
                return `<span class="srv-badge srv-badge-yes">
                        <i class="fas fa-check"></i> כן
                    </span>`;
            }
            if (value === 'לא') {
                return `<span class="srv-badge srv-badge-no">
                        <i class="fas fa-times"></i> לא
                    </span>`;
            }
        }

        if (field === 'isHealthy') {
            const cls = this._getHealthClass(value);
            return `<span class="srv-badge ${cls}">
                    ${this.escHtml(value)}
                </span>`;
        }

        return `<span class="srv-badge srv-badge-neutral">
                ${this.escHtml(value)}
            </span>`;
    }

    // ══════════════════════════════════════════════════════════
    // שמירת שדה inline
    // ══════════════════════════════════════════════════════════
    async _saveInlineField(serverName, field, newValue) {
        // ─── עדכן בזיכרון מיד (optimistic update) ───
        const srv = this.allServers.find(s => s.name === serverName);
        if (!srv) return;

        const oldValue = srv[field];
        srv[field] = newValue;

        // ─── עדכן תצוגה מיד ───
        this._updateInlineCell(serverName, field, newValue);

        try {
            // ─── שלח לשרת ───
            const payload = {
                serverName,
                [field]: newValue
            };

            const res = await fetch('/Servers/UpdateServer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'שגיאה בשמירה');
            }

            // ─── עדכן lastUpdated בזיכרון ───
            if (data.server) {
                srv.lastUpdated = data.server.lastUpdated;
                srv.updatedBy = data.server.updatedBy;
            }

            // ─── עדכן stats bar ───
            this.updateStats();

            this.showToast(
                `✅ ${this._getFieldLabel(field)}: ${newValue || '—'}`,
                'success'
            );

        } catch (err) {
            // ─── Rollback ───
            srv[field] = oldValue;
            this._updateInlineCell(serverName, field, oldValue);

            console.error('_saveInlineField error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
        }
    }

    // ─── עדכן תא בודד בטבלה ─────────────────────────────────
    _updateInlineCell(serverName, field, value) {
        const row = document.querySelector(
            `tr.srv-tr[data-name="${this.escHtml(serverName)}"]`
        );
        if (!row) return;

        // ─── מצא את ה-wrap לפי field ───
        const wrap = row.querySelector(
            `.srv-inline-select-wrap[data-field="${field}"]`
        );
        if (!wrap) return;

        // ─── עדכן את ה-display ───
        const display = wrap.querySelector('.srv-inline-select-display');
        if (display) {
            display.innerHTML = `
            ${this._getInlineBadge(field, value)}
            <i class="fas fa-chevron-down srv-inline-chevron"></i>
        `;
        }

        // ─── עדכן active option ───
        wrap.querySelectorAll('.srv-inline-option').forEach(opt => {
            opt.classList.toggle(
                'srv-inline-option-active',
                opt.dataset.value === value
            );
        });
    }

    // ─── label לשדה (כבר קיים, ודא שקיים) ──────────────────
    _getFieldLabel(field) {
        const labels = {
            canShutdown: 'ניתן לכבות',
            isHealthy: 'תקינות',
            environment: 'סביבה',
            isVirtual: 'סוג שרת',
            os: 'מערכת הפעלה',
            systemName: 'שם מערכת',
            catalogNumber: 'מספר קטלוג',
            systemStatus: 'סטטוס מערכת',
            systemManager: 'מנהל מערכת',
            bootType: 'סוג אתחול',
            domain: 'תחום',
            department: 'מחלקה',
            team: 'צוות',
            scannedVia: 'כתובת IP',
            notes: 'הערות',
            mappingNotes: 'הערות מיפוי',
            hardwareVendor: 'יצרן חומרה',
        };
        return labels[field] || field;
    }

    // ─── קצר ערך מחלקה/צוות - הסר מילות קידומת ───────────────
    _shortenDeptTeam(value) {
        if (!value) return '';
        return value
            .replace(/^מחלקת\s+/i, '')
            .replace(/^צוות\s+/i, '')
            .replace(/^תחום\s+/i, '')
            .trim();
    }

    // ─── תצוגת כרטיסים ───────────────────────────────────────
    renderCards() {
        const content = document.getElementById('srvContent');
        if (!content) return;

        const { page, total, pages } = this._getPaginationInfo();

        if (this.filteredServers.length === 0) {
            content.innerHTML = `
            <div class="srv-empty">
                <i class="fas fa-server"></i>
                <p>לא נמצאו שרתים</p>
            </div>`;
            this.renderPagination(0, 0);
            return;
        }

        const cardsHtml = page.map(s => {
            const envClass = s.environment === 'PROD'
                ? 'srv-badge-prod' : 'srv-badge-nonprod';
            const statusClass = this._getStatusClass(s.systemStatus);
            const healthClass = this._getHealthClass(s.isHealthy);
            const osShort = this._simplifyOs(s.os);
            const isVirt = this._normalizeVirtual(s.isVirtual) === 'TRUE';

            return `
            <div class="srv-card" data-name="${this.escHtml(s.name)}">
                <div class="srv-card-header">
                    <div class="srv-card-icon">
                        <i class="fas fa-${isVirt ? 'cloud' : 'server'}"></i>
                    </div>
                    <div class="srv-card-title-wrap">
                        <div class="srv-card-name"
                             title="${this.escHtml(s.name)}">
                            ${this.escHtml(s.name)}
                        </div>
                        <div class="srv-card-system">
                            ${this.escHtml(s.systemName || '')}
                        </div>
                    </div>
                    <div class="srv-card-badges">
                        <span class="srv-badge ${envClass}">
                            ${this.escHtml(s.environment || '')}
                        </span>
                        <span class="srv-badge ${statusClass}">
                            ${this.escHtml(s.systemStatus || '')}
                        </span>
                    </div>
                </div>
                <div class="srv-card-body">
                    <div class="srv-card-row">
                        <i class="fas fa-desktop"></i>
                        <span>${this.escHtml(osShort)}</span>
                    </div>
                    <div class="srv-card-row">
                        <i class="fas fa-microchip"></i>
                        <span>${this.escHtml(s.hardwareVendor || 'לא ידוע')}</span>
                    </div>
                    <div class="srv-card-row">
                        <i class="fas fa-user"></i>
                        <span>${this.escHtml(s.systemManager || 'לא הוגדר')}</span>
                    </div>
                    <div class="srv-card-row">
                        <i class="fas fa-building"></i>
                        <span>${this.escHtml(s.department || '')}</span>
                    </div>
                    <div class="srv-card-row">
                        <i class="fas fa-users"></i>
                        <span>${this.escHtml(s.team || '')}</span>
                    </div>
                    ${s.scannedVia ? `
                    <div class="srv-card-row">
                        <i class="fas fa-network-wired"></i>
                        <span title="${this.escHtml(s.scannedVia)}">
                            ${this.escHtml(this._extractPrimaryIp(s.scannedVia))}
                        </span>
                    </div>` : ''}
                </div>
                <div class="srv-card-footer">
                    <span class="srv-badge ${healthClass}">
                        ${this.escHtml(s.isHealthy || 'לא ידוע')}
                    </span>
                    ${s.canShutdown === 'כן'
                    ? '<span class="srv-badge srv-badge-yes">ניתן לכבות</span>'
                    : ''}
                    <button class="srv-edit-note-btn srv-card-edit-btn"
                            data-name="${this.escHtml(s.name)}"
                            title="ערוך הערה">
                        <i class="fas fa-pen"></i>
                    </button>
                </div>
                ${(s.notes || s.mappingNotes) ? `
                    <div class="srv-card-notes">
                        <i class="fas fa-sticky-note"></i>
                        ${this.escHtml(
                        [s.mappingNotes, s.notes].filter(Boolean).join(' | ')
                    )}
                    </div>` : ''}
            </div>`;
        }).join('');

        content.innerHTML = `
        <div class="srv-cards-grid">${cardsHtml}</div>`;

        this.renderPagination(total, pages);
    }

    // ─── תצוגת סטטיסטיקות ────────────────────────────────────
    renderStatsView() {
        const content = document.getElementById('srvContent');
        if (!content) return;

        const s = this.allServers;
        const total = s.length;
        const prod = s.filter(x => x.environment === 'PROD').length;
        const nonProd = s.filter(x => x.environment === 'NONPROD').length;
        const virtual_ = s.filter(x =>
            this._normalizeVirtual(x.isVirtual) === 'TRUE').length;
        const physical = s.filter(x =>
            this._normalizeVirtual(x.isVirtual) === 'FALSE').length;
        const active = s.filter(x => x.systemStatus === 'פעילה').length;
        const healthy = s.filter(x => x.isHealthy === 'תקין').length;
        const unhealthy = s.filter(x => x.isHealthy === 'לא תקין').length;

        // ─── לפי OS ───
        const byOs = this._groupBy(s, x => this._simplifyOs(x.os));

        // ─── לפי מחלקה ───
        const byDept = this._groupBy(s, x => x.department || 'לא ידוע');

        // ─── לפי יצרן ───
        const byVendor = this._groupBy(s, x => x.hardwareVendor || 'לא ידוע');

        // ─── לפי צוות ───
        const byTeam = this._groupBy(s, x => x.team || 'לא ידוע');

        content.innerHTML = `
        <div class="srv-stats-view">

            <!-- כרטיסי סיכום -->
            <div class="srv-kpi-grid">
                ${this._kpiCard('fas fa-server', 'סה"כ שרתים', total, '#6366f1')}
                ${this._kpiCard('fas fa-industry', 'PROD', prod, '#ef4444')}
                ${this._kpiCard('fas fa-flask', 'NON PROD', nonProd, '#f59e0b')}
                ${this._kpiCard('fas fa-cloud', 'וירטואליים', virtual_, '#3b82f6')}
                ${this._kpiCard('fas fa-hdd', 'פיזיים', physical, '#8b5cf6')}
                ${this._kpiCard('fas fa-check-circle', 'פעילים', active, '#22c55e')}
                ${this._kpiCard('fas fa-heart', 'תקינים', healthy, '#10b981')}
                ${this._kpiCard('fas fa-heart-broken', 'לא תקינים', unhealthy, '#f43f5e')}
            </div>

            <!-- גרפים -->
            <div class="srv-charts-grid">

                <!-- לפי OS -->
                <div class="srv-chart-card">
                    <div class="srv-chart-title">
                        <i class="fas fa-desktop"></i> לפי מערכת הפעלה
                    </div>
                    ${this._renderBarChart(byOs, total)}
                </div>

                <!-- לפי מחלקה -->
                <div class="srv-chart-card">
                    <div class="srv-chart-title">
                        <i class="fas fa-building"></i> לפי מחלקה
                    </div>
                    ${this._renderBarChart(byDept, total)}
                </div>

                <!-- לפי יצרן -->
                <div class="srv-chart-card">
                    <div class="srv-chart-title">
                        <i class="fas fa-microchip"></i> לפי יצרן חומרה
                    </div>
                    ${this._renderBarChart(byVendor, total)}
                </div>

                <!-- לפי צוות -->
                <div class="srv-chart-card">
                    <div class="srv-chart-title">
                        <i class="fas fa-users"></i> לפי צוות
                    </div>
                    ${this._renderBarChart(byTeam, total)}
                </div>

            </div>
        </div>`;

        // הסתר pagination בתצוגת סטטיסטיקות
        const pag = document.getElementById('srvPagination');
        if (pag) pag.innerHTML = '';
    }

    // ─── KPI Card ─────────────────────────────────────────────
    _kpiCard(icon, label, value, color) {
        return `
        <div class="srv-kpi-card" style="border-top:3px solid ${color}">
            <div class="srv-kpi-icon" style="color:${color}">
                <i class="${icon}"></i>
            </div>
            <div class="srv-kpi-value" style="color:${color}">${value}</div>
            <div class="srv-kpi-label">${label}</div>
        </div>`;
    }

    // ─── Bar Chart פשוט ───────────────────────────────────────
    _renderBarChart(groupMap, total) {
        const sorted = Object.entries(groupMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const colors = [
            '#6366f1', '#3b82f6', '#22c55e', '#f59e0b',
            '#ef4444', '#8b5cf6', '#10b981', '#f43f5e',
            '#06b6d4', '#84cc16'
        ];

        return sorted.map(([label, count], i) => {
            const pct = total > 0
                ? Math.round((count / total) * 100) : 0;
            return `
            <div class="srv-bar-row">
                <div class="srv-bar-label"
                     title="${this.escHtml(label)}">
                    ${this.escHtml(label)}
                </div>
                <div class="srv-bar-track">
                    <div class="srv-bar-fill"
                         style="width:${pct}%;
                                background:${colors[i % colors.length]}">
                    </div>
                </div>
                <div class="srv-bar-count">${count}</div>
            </div>`;
        }).join('');
    }

    // ══════════════════════════════════════════════════════════
    // BigFix Pill ל-Stats Bar
    // ══════════════════════════════════════════════════════════
    _buildBigFixStatPill() {

        // ─── טוען ───
        if (this.bigFixLoading && !this.bigFixLoaded) {
            return `
        <div class="srv-stat-pill srv-stat-bigfix-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>Updates: טוען...</span>
        </div>`;
        }

        // ─── שגיאה ───
        if (this.bigFixError && !this.bigFixLoaded) {
            return `
        <div class="srv-stat-pill srv-stat-bigfix-error"
             title="${this.escHtml(this.bigFixError)}"
             style="cursor:pointer"
             onclick="window._srvDashboard.loadBigFixData(false)">
            <i class="fas fa-exclamation-triangle"></i>
            <span>Updates: שגיאה</span>
        </div>`;
        }

        // ─── לא נטען עדיין ───
        if (!this.bigFixLoaded) {
            return `
        <div class="srv-stat-pill srv-stat-bigfix-loading">
            <i class="fas fa-shield-alt"></i>
            <span>Updates: ממתין...</span>
        </div>`;
        }

        // ─── חשב סטטיסטיקות ───
        const total = this.allServers.length;
        const counted = Object.keys(this.bigFixData).length;

        // ספור לפי סטטוס
        let needRestart = 0;
        let pendingRestart = 0;
        let completed = 0;
        let notCompleted = 0;
        let notReboot = 0;
        let notFound = 0;

        this.allServers.forEach(s => {
            const key = (s.name || '').toLowerCase();
            const status = this.bigFixData[key];

            if (!status) {
                notFound++;
                return;
            }

            const raw = (
                status.pendingRestart ||
                status.PendingRestart || ''
            ).trim();

            let normalized = raw;
            if (raw === 'True' || raw === 'TRUE') normalized = 'Need Restart';
            if (raw === 'False' || raw === 'FALSE') normalized = 'Completed';

            switch (normalized) {
                case 'Need Restart': needRestart++; break;
                case 'Pending Restart': pendingRestart++; break;
                case 'Completed': completed++; break;
                case 'Not Completed': notCompleted++; break;
                case 'Not Reboot 120 day': notReboot++; break;
            }
        });

        // ─── בנה pill ראשי + פירוט ───
        const hasIssues = needRestart + pendingRestart +
            notCompleted + notReboot > 0;

        return `
    <div class="srv-stat-pill srv-stat-bigfix ${hasIssues
                ? 'srv-stat-bigfix-issues' : 'srv-stat-bigfix-ok'}"
         title="לחץ לרענון BigFix"
         style="cursor:pointer">
        <i class="fas fa-shield-alt"></i>
        <span>Updates: ${counted}</span>

            <button class="srv-bigfix-refresh-btn"
                    title="רענן BigFix"
                    onclick="event.stopPropagation();
                             window._srvDashboard
                                 .loadBigFixData(false)">
                <i class="fas fa-sync-alt"></i>
            </button>
    </div>`;
    }

    // ══════════════════════════════════════════════════════════
    // Stats Bar עליון
    // ══════════════════════════════════════════════════════════
    updateStats() {
        const bar = document.getElementById('srvStatsBar');
        if (!bar) return;

        const s = this.allServers;
        const total = s.length;
        const prod = s.filter(x => x.environment === 'PROD').length;
        const nonProd = s.filter(x => x.environment === 'NONPROD').length;
        const virt = s.filter(x =>
            this._normalizeVirtual(x.isVirtual) === 'TRUE').length;
        const physical = s.filter(x =>
            this._normalizeVirtual(x.isVirtual) === 'FALSE').length;
        const active = s.filter(x => x.systemStatus === 'פעילה').length;
        const inactive = s.filter(x => x.systemStatus === 'לא פעילה').length;
        const healthy = s.filter(x => x.isHealthy === 'תקין').length;
        const bad = s.filter(x => x.isHealthy === 'לא תקין').length;

        // ─── BigFix pill ───
        const bigfixPill = this._buildBigFixStatPill();

        // ─── בדוק אילו פילטרים פעילים ───
        const f = this.filters;

        // ─── פונקציה לבניית pill לחיץ עם מחזוריות ───
        const cyclePill = (filterKey, states, currentVal, icon, baseClass) => {
            // מצא את ה-index הנוכחי
            const currentIdx = states.findIndex(st => st.value === currentVal);
            const nextIdx = (currentIdx + 1) % states.length;
            const nextState = states[nextIdx];
            const currentState = states[currentIdx] || states[0];

            const isActive = currentVal !== 'all';
            const activeClass = isActive ? `srv-stat-pill-active` : '';

            return `
        <div class="srv-stat-pill srv-stat-pill-clickable ${baseClass} ${activeClass}"
             data-filter-key="${filterKey}"
             data-next-value="${this.escHtml(nextState.value)}"
             title="${isActive
                    ? `פילטר פעיל: ${currentState.label} — לחץ למצב הבא`
                    : `לחץ לסינון לפי ${currentState.label}`}">
            <i class="${icon}"></i>
            <span>${currentState.label}</span>
            ${isActive ? `<i class="fas fa-times srv-stat-pill-clear"
                            data-filter-key="${filterKey}"
                            title="נקה פילטר"></i>` : ''}
        </div>`;
        };

        // ─── הגדר מחזורי מצבים לכל pill ───
        const envStates = [
            { value: 'all', label: `סה"כ: ${total}` },
            { value: 'PROD', label: `PROD: ${prod}` },
            { value: 'NONPROD', label: `NONPROD: ${nonProd}` },
        ];

        const virtStates = [
            { value: 'all', label: `וירטואלי: ${virt}` },
            { value: 'TRUE', label: `☁️ וירטואלי: ${virt}` },
            { value: 'FALSE', label: `🖥️ פיזי: ${physical}` },
        ];

        const activeStates = [
            { value: 'all', label: `פעילים: ${active}` },
            { value: 'פעילה', label: `✅ פעילה: ${active}` },
            { value: 'לא פעילה', label: `❌ לא פעילה: ${inactive}` },
        ];

        const healthStates = [
            { value: 'all', label: `תקינים: ${healthy}` },
            { value: 'תקין', label: `💚 תקין: ${healthy}` },
            { value: 'לא תקין', label: `❤️ לא תקין: ${bad}` },
        ];

        bar.innerHTML = `
    ${cyclePill('environment', envStates, f.environment, 'fas fa-server', 'srv-stat-prod')}
    ${cyclePill('isVirtual', virtStates, f.isVirtual, 'fas fa-cloud', 'srv-stat-virtual')}
    ${cyclePill('systemStatus', activeStates, f.systemStatus, 'fas fa-check-circle', 'srv-stat-active')}
    ${cyclePill('isHealthy', healthStates, f.isHealthy, 'fas fa-heart', 'srv-stat-healthy')}
    ${bad > 0 ? `
    <div class="srv-stat-pill srv-stat-bad srv-stat-pill-clickable"
         data-filter-key="isHealthy"
         data-next-value="לא תקין"
         title="לחץ לסינון לא תקינים">
        <i class="fas fa-exclamation-triangle"></i>
        <span>לא תקינים: ${bad}</span>
    </div>` : ''}
    ${bigfixPill}`;

        // עדכן פילטרי dropdown
        this._populateDropdownFilters();
        this._renderActiveFilterTags();
        this._updateMultiInStatsBar();
    }

    _updateMultiInStatsBar() {
        const bar = document.getElementById('srvStatsBar');
        if (!bar) return;

        // הסר multi-info קיים
        bar.querySelector('.srv-multi-inline')?.remove();

        if (!this.isAdmin || this.selectedServers.size === 0) return;

        const count = this.selectedServers.size;

        const multiEl = document.createElement('div');
        multiEl.className = 'srv-multi-inline';
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
        <button id="srvMultiClearInline"
                style="background:none;border:none;color:#666;
                       cursor:pointer;font-size:0.7rem;padding:1px 4px;
                       border-radius:3px;transition:color 0.15s;
                       font-family:inherit"
                title="בטל בחירה">
            <i class="fas fa-times"></i>בטל בחירה
        </button>
        <button id="srvMultiEditInline"
                style="padding:3px 10px;
                       background:rgba(99,102,241,0.2);
                       border:1px solid rgba(99,102,241,0.45);
                       border-radius:5px;color:#a5b4fc;
                       font-size:0.75rem;font-weight:600;
                       cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;gap:4px"
                            title="ערוך שדות נבחרים">
                        <i class="fas fa-edit"></i>
                        ערוך נבחרים
        </button>
        <button id="srvMultiDeleteInline"
                style="padding:3px 10px;
                       background:rgba(239,68,68,0.12);
                       border:1px solid rgba(239,68,68,0.35);
                       border-radius:5px;color:#fca5a5;
                       font-size:0.75rem;font-weight:600;
                       cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;gap:4px"
                            title="מחק שרתים נבחרים">
                        <i class="fas fa-trash-alt"></i>
                        מחק נבחרים
        </button>
        <button id="srvMultiBigFixInline"
                style="padding:3px 10px;
                       background:rgba(234,179,8,0.12);
                       border:1px solid rgba(234,179,8,0.35);
                       border-radius:5px;color:#fde047;
                       font-size:0.75rem;font-weight:600;
                       cursor:pointer;font-family:inherit;
                       display:flex;align-items:center;gap:4px"
                            title="בדוק BigFix לשרתים נבחרים">
                        <i class="fas fa-shield-alt"></i>
                        Check updates
        </button>
    `;

        bar.appendChild(multiEl);

        // אירועים
        document.getElementById('srvMultiClearInline')?.addEventListener('click', () => {
            this.selectedServers.clear();
            document.querySelectorAll('.srv-cb-row').forEach(cb => {
                cb.checked = false;
                cb.closest('tr.srv-tr')?.classList.remove('srv-tr-selected');
            });
            const cbAll = document.querySelector('.srv-cb-all');
            if (cbAll) cbAll.checked = false;
            this._updateMultiToolbar();
        });

        document.getElementById('srvMultiEditInline')?.addEventListener('click', () => {
            this.openMultiEditModal();
        });

        document.getElementById('srvMultiDeleteInline')?.addEventListener('click', () => {
            this.openMultiDeleteModal();
        });

        document.getElementById('srvMultiBigFixInline')?.addEventListener('click', () => {
            this.openMultiBigFixModal();
        });
    }

    // ══════════════════════════════════════════════════════════
    // Pagination
    // ══════════════════════════════════════════════════════════
    renderPagination(total, pages) {
        const pag = document.getElementById('srvPagination');
        if (!pag) return;

        if (pages <= 1) { pag.innerHTML = ''; return; }

        const cur = this.currentPage;
        let html = `<div class="srv-pag-wrap">`;

        // כפתור ראשון + קודם
        html += `
        <button class="srv-pag-btn ${cur === 1 ? 'disabled' : ''}"
                data-page="1" title="ראשון">
            <i class="fas fa-angle-double-right"></i>
        </button>
        <button class="srv-pag-btn ${cur === 1 ? 'disabled' : ''}"
                data-page="${cur - 1}" title="קודם">
            <i class="fas fa-angle-right"></i>
        </button>`;

        // מספרי עמודים
        const range = this._pageRange(cur, pages);
        range.forEach(p => {
            if (p === '...') {
                html += `<span class="srv-pag-dots">...</span>`;
            } else {
                html += `
                <button class="srv-pag-btn ${p === cur ? 'active' : ''}"
                        data-page="${p}">${p}</button>`;
            }
        });

        // כפתור הבא + אחרון
        html += `
        <button class="srv-pag-btn ${cur === pages ? 'disabled' : ''}"
                data-page="${cur + 1}" title="הבא">
            <i class="fas fa-angle-left"></i>
        </button>
        <button class="srv-pag-btn ${cur === pages ? 'disabled' : ''}"
                data-page="${pages}" title="אחרון">
            <i class="fas fa-angle-double-left"></i>
        </button>
        <span class="srv-pag-info">
            עמוד ${cur} מתוך ${pages} | ${total} שרתים
        </span>`;

        html += `</div>`;
        pag.innerHTML = html;
    }

    async _executeResetHealth(modal) {
        const confirmBtn = document.getElementById(
            'srvResetHealthConfirm'
        );
        const scopeRadio = document.querySelector(
            'input[name="srvResetScope"]:checked'
        );
        const scope = scopeRadio ? scopeRadio.value : 'all';

        // ─── נעל כפתור ───
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> מאפס...';
        }

        try {
            // ─── בחר שרתים לאיפוס ───
            const toReset = scope === 'filtered'
                ? this.filteredServers
                : this.allServers;

            const resetCount = toReset.filter(
                s => s.isHealthy && s.isHealthy.trim() !== ''
            ).length;

            // ─── אפס בזיכרון ───
            toReset.forEach(s => { s.isHealthy = ''; });

            // ─── שמור לשרת ───
            const res = await fetch('/Servers/SaveServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ servers: this.allServers })
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'שגיאה בשמירה');
            }

            // ─── עדכן תצוגה ───
            modal.remove();
            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            this.showToast(
                `✅ אופסו ${resetCount} ערכי תקינות`,
                'success'
            );

        } catch (err) {
            console.error('_executeResetHealth error:', err);
            this.showToast(
                'שגיאה באיפוס: ' + err.message, 'error'
            );
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.innerHTML =
                    '<i class="fas fa-heart-broken"></i> אפס תקינות';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // מודל איפוס תקינות
    // ══════════════════════════════════════════════════════════
    openResetHealthModal() {
        const existing = document.getElementById('srvResetHealthModal');
        if (existing) existing.remove();

        // ─── חשב כמה שרתים יושפעו ───
        const withHealth = this.allServers.filter(
            s => s.isHealthy && s.isHealthy.trim() !== ''
        );
        const total = withHealth.length;

        // ─── ספור לפי ערך ───
        const byValue = withHealth.reduce((acc, s) => {
            const v = s.isHealthy || 'לא ידוע';
            acc[v] = (acc[v] || 0) + 1;
            return acc;
        }, {});

        // ─── בנה שורות סיכום ───
        const summaryRows = Object.entries(byValue)
            .sort((a, b) => b[1] - a[1])
            .map(([val, count]) => {
                const cls = this._getHealthClass(val);
                return `
            <div class="srv-reset-health-summary-row">
                <span class="srv-badge ${cls}">
                    ${this.escHtml(val)}
                </span>
                <span class="srv-reset-health-count">
                    ${count} שרתים
                </span>
            </div>`;
            }).join('');

        const modal = document.createElement('div');
        modal.id = 'srvResetHealthModal';
        modal.className = 'srv-modal-overlay';
        modal.innerHTML = `
    <div class="srv-modal srv-reset-health-modal">

        <!-- כותרת -->
        <div class="srv-modal-header srv-reset-health-header">
            <h3 class="srv-modal-title">
                <i class="fas fa-heart-broken"
                   style="color:#f43f5e"></i>
                איפוס ערכי תקינות
            </h3>
            <button class="srv-modal-close"
                    id="srvResetHealthClose">
                &times;
            </button>
        </div>

        <!-- גוף -->
        <div class="srv-modal-body">

            <!-- אזהרה -->
            <div class="srv-reset-health-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <div class="srv-reset-health-warning-title">
                        פעולה זו תאפס את ערך התקינות של
                        <strong>${total}</strong> שרתים
                    </div>
                    <div class="srv-reset-health-warning-sub">
                        כל הערכים יימחקו ויוחזרו לריק.
                        לא ניתן לבטל פעולה זו.
                    </div>
                </div>
            </div>

            <!-- סיכום ערכים קיימים -->
            ${total > 0 ? `
            <div class="srv-reset-health-summary">
                <div class="srv-reset-health-summary-title">
                    <i class="fas fa-list"></i>
                    ערכים קיימים שיימחקו:
                </div>
                <div class="srv-reset-health-summary-list">
                    ${summaryRows}
                </div>
            </div>` : `
            <div class="srv-reset-health-empty">
                <i class="fas fa-check-circle"
                   style="color:#22c55e"></i>
                אין ערכי תקינות לאיפוס
            </div>`}

            <!-- אפשרות סינון - רק מסוננים -->
            ${this.filteredServers.length < this.allServers.length ? `
            <div class="srv-reset-health-scope">
                <label class="srv-reset-health-scope-label">
                    <input type="radio"
                           name="srvResetScope"
                           value="all"
                           class="srv-reset-radio"
                           checked>
                    <span>
                        <strong>כל השרתים</strong>
                        <span class="srv-reset-scope-hint">
                            (${this.allServers.length} שרתים)
                        </span>
                    </span>
                </label>
                <label class="srv-reset-health-scope-label">
                    <input type="radio"
                           name="srvResetScope"
                           value="filtered"
                           class="srv-reset-radio">
                    <span>
                        <strong>שרתים מסוננים בלבד</strong>
                        <span class="srv-reset-scope-hint">
                            (${this.filteredServers.length} שרתים)
                        </span>
                    </span>
                </label>
            </div>` : ''}

            <!-- אישור הקלדה -->
            <div class="srv-reset-health-confirm-wrap">
                <label class="srv-reset-health-confirm-label">
                    <i class="fas fa-keyboard"></i>
                    הקלד <strong>איפוס</strong> לאישור:
                </label>
                <input type="text"
                       id="srvResetHealthConfirmInput"
                       class="srv-reset-health-confirm-input"
                       placeholder='הקלד "איפוס"'
                       autocomplete="off"/>
            </div>

        </div>

        <!-- footer -->
        <div class="srv-modal-footer">
            <button class="srv-modal-cancel-btn"
                    id="srvResetHealthCancel">
                <i class="fas fa-times"></i> ביטול
            </button>
            <button class="srv-reset-health-confirm-btn"
                    id="srvResetHealthConfirm"
                    disabled>
                <i class="fas fa-heart-broken"></i>
                אפס תקינות
            </button>
        </div>

    </div>`;

        document.body.appendChild(modal);

        // ─── אירועים ───
        const closeModal = () => modal.remove();

        document.getElementById('srvResetHealthClose')
            .addEventListener('click', closeModal);
        document.getElementById('srvResetHealthCancel')
            .addEventListener('click', closeModal);

        // ─── הפעל כפתור רק אחרי הקלדת "איפוס" ───
        const confirmInput = document.getElementById(
            'srvResetHealthConfirmInput'
        );
        const confirmBtn = document.getElementById(
            'srvResetHealthConfirm'
        );

        confirmInput.addEventListener('input', () => {
            const val = confirmInput.value.trim();
            const isValid = val === 'איפוס';
            confirmBtn.disabled = !isValid;
            confirmInput.classList.toggle(
                'srv-reset-input-valid', isValid
            );
        });

        // ─── ביצוע האיפוס ───
        confirmBtn.addEventListener('click', () =>
            this._executeResetHealth(modal)
        );
    }

    // ══════════════════════════════════════════════════════════
    // מודל עריכת הערה
    // ══════════════════════════════════════════════════════════
    openNoteModal(serverName) {

        // ─── בדוק הרשאות ────────────────────────────────────────
        if (!this.isAdmin && !this.isEditor) {
            this.showToast('אין הרשאה לעריכת הערות', 'error');
            return;
        }
        const existing = document.getElementById('srvNoteModal');
        if (existing) existing.remove();

        const server = this.allServers.find(s => s.name === serverName);
        if (!server) return;

        const modal = document.createElement('div');
        modal.id = 'srvNoteModal';
        modal.className = 'srv-modal-overlay';
        modal.innerHTML = `
        <div class="srv-modal">
            <div class="srv-modal-header">
                <h3 class="srv-modal-title">
                    <i class="fas fa-server"></i>
                    ${this.escHtml(serverName)}
                </h3>
                <button class="srv-modal-close" id="srvModalClose">
                    &times;
                </button>
            </div>
            <div class="srv-modal-body">

                <!-- פרטי שרת -->
                <div class="srv-modal-info-grid">
                    ${this._infoRow('מערכת הפעלה', server.os)}
                    ${this._infoRow('יצרן', server.hardwareVendor)}
                    ${this._infoRow('סביבה', server.environment)}
                    ${this._infoRow('סטטוס', server.systemStatus)}
                    ${this._infoRow('מנהל מערכת', server.systemManager)}
                    ${this._infoRow('מחלקה', server.department)}
                    ${this._infoRow('צוות', server.team)}
                    ${this._infoRow('כתובת IP',
            this._extractPrimaryIp(server.scannedVia) +
            (server.scannedVia?.includes(',') || server.scannedVia?.includes('|')
                ? ` (${server.scannedVia})`
                : '')
        )}
                    ${this._infoRow('מספר קטלוג', server.catalogNumber)}
                    ${this._infoRow('תקינות', server.isHealthy)}
                    ${this._infoRow('ניתן לכבות', server.canShutdown)}
                </div>

                <!-- ← שינוי: הערות מיפוי בנפרד (read-only אם קיים) -->
                ${(this.isAdmin || server.mappingNotes) ? `
                <div class="srv-form-group">
                    <label class="srv-form-label">
                        <i class="fas fa-map"></i>
                        הערות מיפוי
                        ${this.isAdmin ? '' : '<span class="srv-readonly-badge">צפייה בלבד</span>'}
                    </label>
                    ${this.isAdmin
                    ? `<textarea id="srvModalMappingNotes"
                                        class="srv-form-textarea"
                                        rows="3"
                                        placeholder="הערות מיפוי..."
                            >${this.escHtml(server.mappingNotes || '')}</textarea>`
                    : (server.mappingNotes
                        ? `<div class="srv-mapping-notes-display">
                                    ${this.escHtml(server.mappingNotes)}
                                </div>`
                        : '')
                }
                </div>` : ''}

                <!-- ← שינוי: רק הערות רגילות בטקסטאריה -->
                <div class="srv-form-group">
                    <label class="srv-form-label">
                        <i class="fas fa-sticky-note"></i>
                        הערות
                    </label>
                    <textarea id="srvModalNotes"
                            class="srv-form-textarea"
                            rows="4"
                            placeholder="הערות...">${this.escHtml(server.notes || '')}</textarea>
                </div>

            </div>
            <div class="srv-modal-footer">
                <button class="srv-modal-cancel-btn" id="srvModalCancel">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button class="srv-modal-save-btn" id="srvModalSave">
                    <i class="fas fa-save"></i> שמור
                </button>
            </div>
        </div>`;

        document.body.appendChild(modal);

        document.getElementById('srvModalClose')
            .addEventListener('click', () => modal.remove());
        document.getElementById('srvModalCancel')
            .addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('srvModalSave')
            .addEventListener('click', () =>
                this.saveNote(serverName, modal));
    }

    _infoRow(label, value) {
        if (!value) return '';
        return `
        <div class="srv-info-row">
            <span class="srv-info-label">${label}:</span>
            <span class="srv-info-value">${this.escHtml(value)}</span>
        </div>`;
    }

    async saveNote(serverName, modal) {
        const notes = document.getElementById('srvModalNotes').value.trim();
        const srv = this.allServers.find(s => s.name === serverName);
        let mappingNotes;
        if (this.isAdmin) {
            const mappingNotesEl = document.getElementById('srvModalMappingNotes');
            mappingNotes = mappingNotesEl
                ? mappingNotesEl.value.trim()
                : (this.allServers.find(s => s.name === serverName)?.mappingNotes || '');
        } else {
            // לא אדמין - שמור את הערך הקיים ללא שינוי
            mappingNotes = this.allServers.find(s => s.name === serverName)?.mappingNotes || '';
        }

        const saveBtn = document.getElementById('srvModalSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const res = await fetch('/Servers/UpdateServerNote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ serverName, notes, mappingNotes })
            });
            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            // ← תיקון: עדכן רק notes, אל תגע ב-mappingNotes
            if (srv) {
                srv.notes = notes;
                if (this.isAdmin) {
                    srv.mappingNotes = mappingNotes; // ← עדכן גם mappingNotes
                }
            }

            modal.remove();
            this.renderContent();
            this.showToast('✅ ההערה נשמרה', 'success');

        } catch (err) {
            this.showToast('שגיאה: ' + err.message, 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-save"></i> שמור';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // ייצוא לאקסל
    // ══════════════════════════════════════════════════════════
    async exportToExcel() {
        try {
            const exportBtn = document.getElementById('srvExportBtn');
            if (exportBtn) {
                exportBtn.disabled = true;
                exportBtn.innerHTML =
                    '<i class="fas fa-spinner fa-spin"></i>';
            }

            // טען ExcelJS
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
            wb.creator = 'ServersDashboard';
            wb.created = new Date();

            const ws = wb.addWorksheet('שרתים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            ws.columns = [
                { header: 'שם שרת', key: 'name', width: 25 },
                { header: 'כתובת IP', key: 'scannedVia', width: 16 },
                { header: 'סביבה', key: 'environment', width: 12 },
                { header: 'סוג', key: 'isVirtual', width: 12 },
                { header: 'מערכת הפעלה', key: 'os', width: 30 },
                { header: 'יצרן חומרה', key: 'hardwareVendor', width: 18 },
                { header: 'שם מערכת', key: 'systemName', width: 22 },
                { header: 'מספר קטלוג', key: 'catalogNumber', width: 16 },
                { header: 'סטטוס מערכת', key: 'systemStatus', width: 14 },
                { header: 'מנהל מערכת', key: 'systemManager', width: 20 },
                { header: 'צוות', key: 'team', width: 20 },
                { header: 'מחלקה', key: 'department', width: 25 },
                { header: 'תחום', key: 'domain', width: 20 },
                { header: 'סוג אתחול', key: 'bootType', width: 14 },
                { header: 'ניתן לכבות', key: 'canShutdown', width: 12 },
                { header: 'תקינות', key: 'isHealthy', width: 12 },
                { header: 'הערות מיפוי', key: 'mappingNotes', width: 30 },
                { header: 'הערות', key: 'notes', width: 35 },
                { header: 'BigFix Updates', key: 'bigfixStatus', width: 20 },
                { header: 'עודכן ע"י', key: 'updatedBy', width: 16 },
                { header: 'תאריך עדכון', key: 'lastUpdated', width: 18 },
            ];

            // כותרות - עיצוב
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
                cell.border = {
                    bottom: {
                        style: 'medium',
                        color: { argb: 'FF7c3aed' }
                    }
                };
            });

            // נתונים
            const toExport = this.filteredServers;
            toExport.forEach((s, idx) => {
                // ─── BigFix ערך לייצוא ───
                const bfKey = (s.name || '').toLowerCase();
                const bfStatus = this.bigFixData[bfKey];
                let bfValue = '';
                if (bfStatus) {
                    const raw = (
                        bfStatus.pendingRestart ||
                        bfStatus.PendingRestart || ''
                    ).trim();
                    if (raw === 'True' || raw === 'TRUE') bfValue = 'Need Restart';
                    else if (raw === 'False' || raw === 'FALSE') bfValue = 'Completed';
                    else bfValue = raw;
                } else if (this.bigFixLoaded) {
                    bfValue = 'לא ב-BigFix';
                }

                const row = ws.addRow({
                    name: this._sanitizeForExcel(s.name),
                    scannedVia: this._sanitizeForExcel(s.scannedVia),
                    environment: this._sanitizeForExcel(s.environment),
                    isVirtual: (() => {
                        const norm = this._normalizeVirtual(s.isVirtual);
                        if (norm === 'TRUE') return 'וירטואלי';
                        if (norm === 'FALSE') return 'פיזי';
                        return '';  // ← ריק אם לא ידוע
                    })(),
                    os: this._sanitizeForExcel(s.os),
                    hardwareVendor: this._sanitizeForExcel(s.hardwareVendor),
                    systemName: this._sanitizeForExcel(s.systemName),
                    catalogNumber: this._sanitizeForExcel(s.catalogNumber),
                    systemStatus: this._sanitizeForExcel(s.systemStatus),
                    systemManager: this._sanitizeForExcel(s.systemManager),
                    team: this._sanitizeForExcel(s.team),
                    department: this._sanitizeForExcel(s.department),
                    domain: this._sanitizeForExcel(s.domain),
                    bootType: this._sanitizeForExcel(s.bootType),
                    canShutdown: this._sanitizeForExcel(s.canShutdown),
                    isHealthy: this._sanitizeForExcel(s.isHealthy),
                    mappingNotes: this._sanitizeForExcel(s.mappingNotes),
                    notes: this._sanitizeForExcel(s.notes),
                    bigfixStatus: this._sanitizeForExcel(bfValue),
                    updatedBy: this._sanitizeForExcel(s.updatedBy),
                    lastUpdated: this._sanitizeForExcel(s.lastUpdated),
                });

                row.height = 16;
                const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF5F3FF';

                row.eachCell((cell, colNum) => {
                    cell.font = { name: 'Arial', size: 10 };
                    cell.alignment = {
                        horizontal: 'center',
                        vertical: 'middle',
                        readingOrder: 2,
                        wrapText: colNum === 17 || colNum === 18
                    };
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: rowBg }
                    };
                    cell.border = {
                        bottom: {
                            style: 'thin',
                            color: { argb: 'FFe2e8f0' }
                        }
                    };

                    // ── עמודה 3: סביבה ──────────────────────────────────
                    if (colNum === 3) {
                        if (s.environment === 'PROD') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FF991b1b' }
                            };
                        }
                    }

                    // ── עמודה 16: תקינות ─────────────────────────────────
                    if (colNum === 16) {
                        if (s.isHealthy === 'לא תקין') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FFdc2626' }
                            };
                        } else if (s.isHealthy === 'תקין') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FF16a34a' }
                            };
                        }
                    }

                    // ── עמודה 19: BigFix ─────────────────────────────────
                    if (colNum === 19) {
                        if (bfValue === 'Need Restart') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FFf97316' }
                            };
                        } else if (bfValue === 'Pending Restart') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FFf59e0b' }
                            };
                        } else if (bfValue === 'Completed') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FF16a34a' }
                            };
                        } else if (bfValue === 'Not Completed') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FFdc2626' }
                            };
                        } else if (bfValue === 'Not Reboot 120 day') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FFca8a04' }
                            };
                        } else if (bfValue === 'לא ב-BigFix') {
                            cell.font = {
                                name: 'Arial', size: 10,
                                color: { argb: 'FF6b7280' }
                            };
                        }
                    }
                });
            });

            // ─── רוחב עמודות אוטומטי לפי תוכן ───────────────────────
            ws.columns.forEach(col => {
                let maxLen = col.header ? col.header.length : 10;

                ws.eachRow(row => {
                    const cell = row.getCell(col.number);
                    const val = cell.value
                        ? cell.value.toString().length
                        : 0;
                    if (val > maxLen) maxLen = val;
                });

                // ─── מינימום 8, מקסימום 50 ───
                col.width = Math.min(Math.max(maxLen + 2, 8), 50);
            });

            // הורד
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });
            const date = new Date().toISOString().split('T')[0];
            saveAs(blob, `servers_${date}.xlsx`);

            this.showToast(
                `📊 יוצאו ${toExport.length} שרתים`, 'success'
            );

        } catch (err) {
            console.error('exportToExcel error:', err);
            this.showToast('שגיאה בייצוא: ' + err.message, 'error');
        } finally {
            const exportBtn = document.getElementById('srvExportBtn');
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML =
                    '<i class="fas fa-file-excel"></i>';
            }
        }
    }

    // ── עזר: נקה ערך לאקסל - הסר תווים לא חוקיים ──────────────────
    _sanitizeForExcel(value) {
        if (value === null || value === undefined) return '';

        let str = String(value);

        // ─── הסר Emoji ───
        str = str.replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
            .replace(/[\u{2600}-\u{27BF}]/gu, '')
            .replace(/[\u{FE00}-\u{FEFF}]/gu, '');

        // ─── הסר תווי בקרה לא חוקיים ב-XML ───
        // XML מאפשר רק: #x9 | #xA | #xD | [#x20-#xD7FF]
        str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        // ─── הסר תווים בטווח Unicode הבעייתי ───
        str = str.replace(/[\uD800-\uDFFF]/g, '');
        str = str.replace(/[\uFFFE\uFFFF]/g, '');

        return str.trim();
    }

    // ══════════════════════════════════════════════════════════
    // אירועים
    // ══════════════════════════════════════════════════════════
    bindEvents() {

        // ─── חיפוש ───
        document.addEventListener('input', e => {
            if (e.target.id === 'srvSearch') {
                this.searchTerm = e.target.value;
                const clr = document.getElementById('srvClearSearch');
                if (clr) clr.style.display =
                    e.target.value ? 'flex' : 'none';
                this.applyFiltersAndSort();
                this.renderContent();
            }
        });

        // ─── שינוי פילטרים ───
        document.addEventListener('change', e => {
            const id = e.target.id;

            if (id === 'srvFltEnv') {
                this.filters.environment = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltVirtual') {
                this.filters.isVirtual = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltStatus') {
                this.filters.systemStatus = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltHealthy') {
                this.filters.isHealthy = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltDept') {
                this.filters.department = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltTeam') {
                this.filters.team = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltOs') {
                this.filters.os = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvPageSize') {
                this.pageSize = parseInt(e.target.value);
                this._savePreferences();
                this.currentPage = 1;
                this.renderContent();
            }
            if (id === 'srvFltBigfix') {
                this.filters.bigfixStatus = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltSystemName') {
                this.filters.systemName = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltSystemManager') {
                this.filters.systemManager = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltBootType') {
                this.filters.bootType = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltDomain') {
                this.filters.domain = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }
            if (id === 'srvFltCanShutdown') {
                this.filters.canShutdown = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
            }

            if (id === 'srvFltCatalogNumber') {
                this.filters.catalogNumber = e.target.value;
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
                this.updateStats();
            }
        });

        // ─── לחיצות ───
        document.addEventListener('click', e => {

            // ─── מוחרג - העלאת קובץ ───────────────────────────────────────
            if (e.target.closest('#srvPatchExcludeBtn')) {
                this._excludeServersFromFile();
                return;
            }

            // ניקוי חיפוש
            if (e.target.closest('#srvClearSearch')) {
                this.searchTerm = '';
                const inp = document.getElementById('srvSearch');
                if (inp) inp.value = '';
                const clr = document.getElementById('srvClearSearch');
                if (clr) clr.style.display = 'none';
                this.applyFiltersAndSort();
                this.renderContent();
            }

            // ניקוי פילטרים
            if (e.target.closest('#srvClearFilters')) {
                Object.keys(this.filters).forEach(key => {
                    this.filters[key] = 'all';
                });
                this._restoreFilterSelects();
                this._savePreferences();
                this.applyFiltersAndSort();
                this.renderContent();
                this.updateStats();

                // ← סגור את הפופאפ
                const popup = document.getElementById('srvFiltersPopup');
                if (popup) popup.style.display = 'none';
                const chevron = document.getElementById('srvFiltersChevron');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }

            // הסרת פילטר בודד מתגית
            const removeTagBtn = e.target.closest('.srv-active-tag-remove');
            if (removeTagBtn) {
                const key = removeTagBtn.dataset.filterKey;
                if (key && this.filters.hasOwnProperty(key)) {
                    this.filters[key] = 'all';
                    this._restoreFilterSelects();
                    this._savePreferences();
                    this.applyFiltersAndSort();
                    this.renderContent();
                }
            }

            // רענון
            if (e.target.closest('#srvRefreshBtn'))
                this.loadData();

            // Auto-fill Bulk
            if (e.target.closest('#srvAutoFillBulkBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה', 'error');
                    return;
                }
                this._autoFillOrgInfoBulk();
                return;
            }

            if (e.target.closest('#srvBulkGapsBtn')) {
                console.log('gaps clicked');

                if (!this.isAdmin) {
                    this.showToast('אין הרשאה', 'error');
                    return;
                }
                this.openGapsModal();
                return;
            }
            // איפוס תקינות
            if (e.target.closest('#srvResetHealthBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה לאיפוס תקינות', 'error');
                    return;
                }
                this.openResetHealthModal();
            }

            // ייבוא CSV - אדמין בלבד
            if (e.target.closest('#srvImportBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה לייבוא', 'error');
                    return;
                }
                this.openImportExcelDialog();
            }

            // ייצוא
            if (e.target.closest('#srvExportBtn'))
                this.exportToExcel();

            // מצב תצוגה
            if (e.target.closest('#srvViewTable')) {
                this.viewMode = 'table';
                this._savePreferences();
                this.renderContent();
            }
            if (e.target.closest('#srvViewCards')) {
                this.viewMode = 'cards';
                this._savePreferences();
                this.renderContent();
            }
            if (e.target.closest('#srvViewStats')) {
                this.viewMode = 'stats';
                this._savePreferences();
                this.renderContent();
            }

            // מיון עמודה
            const th = e.target.closest('.srv-th');
            if (th) {
                const col = th.dataset.col;
                if (col) {
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
            }

            // עריכת הערה
            const editBtn = e.target.closest('.srv-edit-note-btn');
            if (editBtn) {
                e.stopPropagation();
                this.openNoteModal(editBtn.dataset.name);
            }

            // pagination
            const pagBtn = e.target.closest('.srv-pag-btn');
            if (pagBtn && !pagBtn.classList.contains('disabled')) {
                const pg = parseInt(pagBtn.dataset.page);
                if (!isNaN(pg)) {
                    this.currentPage = pg;
                    this.renderContent();
                    // גלול לראש
                    const wrap = document.querySelector('.srv-scroll-wrapper');
                    if (wrap) wrap.scrollTop = 0;
                }
            }

            const toggle = e.target.closest('#srvFiltersToggle');
            const popup = document.getElementById('srvFiltersPopup');
            const wrap = e.target.closest('.srv-filters-wrap');

            if (toggle && popup) {
                const isOpen = popup.style.display !== 'none';
                popup.style.display = isOpen ? 'none' : 'block';
                const chevron = document.getElementById('srvFiltersChevron');
                if (chevron) chevron.style.transform =
                    isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
                return;
            }

            // סגור אם לחצו מחוץ לפופאפ
            if (!wrap && popup) {
                popup.style.display = 'none';
                const chevron = document.getElementById('srvFiltersChevron');
                if (chevron) chevron.style.transform = 'rotate(0deg)';
            }

            // ─── Stats Bar - לחיצה על pill לחיץ ───
            const statPill = e.target.closest('.srv-stat-pill-clickable');
            if (statPill && !e.target.closest('.srv-stat-pill-clear')) {
                const filterKey = statPill.dataset.filterKey;
                const nextValue = statPill.dataset.nextValue;
                if (filterKey && nextValue !== undefined) {
                    this.filters[filterKey] = nextValue;
                    this._restoreFilterSelects();
                    this._savePreferences();
                    this.applyFiltersAndSort();
                    this.renderContent();
                    this.updateStats();
                }
                return;
            }

            // ─── לחיצה על שם מערכת ───
            const systemNameLink = e.target.closest('.srv-system-name-link');
            if (systemNameLink) {
                e.stopPropagation();
                const catalogNumber = systemNameLink.textContent.trim();
                if (catalogNumber) {
                    this.openSystemInfoModal(catalogNumber);
                }
                return;
            }

            // ─── Stats Bar - לחיצה על X לניקוי פילטר ───
            const statClear = e.target.closest('.srv-stat-pill-clear');
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
                }
                return;
            }

            if (e.target.closest('#srvFindMissingBtn'))
                this.findAndAddMissingServers();

            // עריכת שרת (אדמין)
            const rowEditBtn = e.target.closest('.srv-row-edit-btn');
            if (rowEditBtn) {
                e.stopPropagation();
                if (!this.isAdmin && !this.isEditor) {
                    this.showToast('אין הרשאה לעריכה', 'error');
                    return;
                }
                this.openEditServerModal(rowEditBtn.dataset.name);
            }

            // ─── Inline Select - פתח/סגור dropdown ───
            const inlineDisplay = e.target.closest('.srv-inline-select-display');
            if (inlineDisplay) {
                e.stopPropagation();

                const wrap = inlineDisplay.closest('.srv-inline-select-wrap');
                if (!wrap) return;

                // ─── סגור כל שאר ה-dropdowns הפתוחים ───
                document.querySelectorAll(
                    '.srv-inline-select-dropdown'
                ).forEach(dd => {
                    if (dd !== wrap.querySelector(
                        '.srv-inline-select-dropdown'
                    )) {
                        dd.style.display = 'none';
                        dd.closest('.srv-inline-select-wrap')
                            ?.classList.remove('srv-inline-open');
                    }
                });

                const dropdown = wrap.querySelector(
                    '.srv-inline-select-dropdown'
                );
                if (!dropdown) return;

                const isOpen = dropdown.style.display !== 'none';
                dropdown.style.display = isOpen ? 'none' : 'block';
                wrap.classList.toggle('srv-inline-open', !isOpen);
                return;
            }

            // ─── Inline Select - בחר ערך ───
            const inlineOption = e.target.closest('.srv-inline-option');
            if (inlineOption) {
                e.stopPropagation();

                const wrap = inlineOption.closest('.srv-inline-select-wrap');
                if (!wrap) return;

                const serverName = wrap.dataset.server;
                const field = wrap.dataset.field;
                const newValue = inlineOption.dataset.value;

                // ─── סגור dropdown ───
                const dropdown = wrap.querySelector(
                    '.srv-inline-select-dropdown'
                );
                if (dropdown) dropdown.style.display = 'none';
                wrap.classList.remove('srv-inline-open');

                // ─── שמור ───
                this._saveInlineField(serverName, field, newValue);
                return;
            }

            // ─── סגור dropdowns בלחיצה מחוץ ───
            if (!e.target.closest('.srv-inline-select-wrap')) {
                document.querySelectorAll(
                    '.srv-inline-select-dropdown'
                ).forEach(dd => {
                    dd.style.display = 'none';
                    dd.closest('.srv-inline-select-wrap')
                        ?.classList.remove('srv-inline-open');
                });
            }

            // ─── Checkbox - בחר שורה ───
            const cbRow = e.target.closest('.srv-cb-row');
            if (cbRow) {
                e.stopPropagation();
                const name = cbRow.dataset.name;
                if (cbRow.checked) {
                    this.selectedServers.add(name);
                } else {
                    this.selectedServers.delete(name);
                }
                // ─── עדכן מראה השורה ───
                const row = cbRow.closest('tr.srv-tr');
                if (row) row.classList.toggle('srv-tr-selected', cbRow.checked);
                this._updateMultiToolbar();
                return;
            }

            // ─── Checkbox - בחר הכל ───
            const cbAll = e.target.closest('.srv-cb-all');
            if (cbAll) {
                e.stopPropagation();
                const { page } = this._getPaginationInfo();
                if (cbAll.checked) {
                    page.forEach(s => this.selectedServers.add(s.name));
                } else {
                    page.forEach(s => this.selectedServers.delete(s.name));
                }
                // ─── עדכן כל checkboxes בעמוד ───
                document.querySelectorAll('.srv-cb-row').forEach(cb => {
                    const name = cb.dataset.name;
                    cb.checked = this.selectedServers.has(name);
                    const row = cb.closest('tr.srv-tr');
                    if (row) row.classList.toggle(
                        'srv-tr-selected', cb.checked
                    );
                });
                this._updateMultiToolbar();
                return;
            }

            // ─── Multi Toolbar - בטל בחירה ───
            if (e.target.closest('#srvMultiClear')) {
                this.selectedServers.clear();
                document.querySelectorAll('.srv-cb-row').forEach(cb => {
                    cb.checked = false;
                    const row = cb.closest('tr.srv-tr');
                    if (row) row.classList.remove('srv-tr-selected');
                });
                const cbAll = document.querySelector('.srv-cb-all');
                if (cbAll) cbAll.checked = false;
                this._updateMultiToolbar();
                return;
            }

            // ─── Multi Toolbar - ערוך נבחרים ───
            if (e.target.closest('#srvMultiEditBtn')) {
                this.openMultiEditModal();
                return;
            }
            // ─── Multi Toolbar - מחק נבחרים ───
            if (e.target.closest('#srvMultiDeleteBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה למחיקה', 'error');
                    return;
                }
                this.openMultiDeleteModal();
                return;
            }

            // ─── Multi Toolbar - BigFix נבחרים ───
            if (e.target.closest('#srvMultiBigFixBtn')) {
                this.openMultiBigFixModal();
                return;
            }
            // ─── Multi Toolbar - ייצא נבחרים ───
            if (e.target.closest('#srvMultiExportBtn')) {
                const prev = this.filteredServers;
                this.filteredServers = this.allServers.filter(
                    s => this.selectedServers.has(s.name)
                );
                this.exportToExcel();
                this.filteredServers = prev;
                return;
            }

            // הוספת שרת חדש - אדמין בלבד
            if (e.target.closest('#srvAddServerBtn')) {
                if (!this.isAdmin) {
                    this.showToast('אין הרשאה להוספת שרת', 'error');
                    return;
                }
                this.openAddServerModal();
            }

            // ─── PING Button ─────────────────────────────────────────────
            const pingBtn = e.target.closest('.srv-ping-btn');
            if (pingBtn) {
                e.stopPropagation();
                const name = pingBtn.dataset.name;
                if (name) {
                    this._doPing(name);
                }
                return;
            }

            // ── סגור column filter popups בלחיצה מחוץ ──
            // אל תסגור אם הלחיצה היא על אפשרות בתוך הפופאפ
            if (!e.target.closest('.srv-th-filter-popup') &&
                !e.target.closest('.srv-th-filter-btn')) {
                document.querySelectorAll('.srv-th-filter-popup').forEach(p => {
                    p.style.display = 'none';
                });
                this._openFilterPopupKey = null;
            }

            const updateIpBtn = e.target.closest('.srv-ping-update-ip-btn');
            if (updateIpBtn) {
                e.stopPropagation();
                const name = updateIpBtn.dataset.name;
                const newIp = updateIpBtn.dataset.newIp;
                if (name && newIp && this.isAdmin) {
                    this._saveInlineField(name, 'scannedVia', newIp);

                    // עדכן cache
                    const key = name.toLowerCase();
                    if (this._pingCache[key]) {
                        this._pingCache[key].storedIp = newIp;
                        // ← תיקון: עדכן גם את resolvedIp כדי שלא יוצג כאי-התאמה
                        this._pingCache[key].hasMismatch = false;
                        this._pingCache[key].mismatches = [];
                    }

                    // ← תיקון: עדכן תא IP בטבלה ישירות
                    this._updateIpCell(name, newIp);

                    this._updatePingCell(name);
                }
                return;
            }

            // ─── ניהול הרשאות ───
            if (e.target.closest('#srvPermissionsBtn')) {
                this.openPermissionsModal();
                return;
            }
        });

        document.addEventListener('dblclick', e => {

            // ─── בדוק שאנחנו בתצוגת טבלה ───
            if (this.viewMode !== 'table') return;

            // ─── בדוק שהמשתמש אדמין ───
            if (!this.isAdmin && !this.isEditor) return;

            // ─── מצא את השורה שנלחצה ───
            const row = e.target.closest('tr.srv-tr');
            if (!row) return;

            // ─── אל תפתח אם לחצו על כפתור ───
            if (e.target.closest('button')) return;

            // ─── אל תפתח אם לחצו על תא BigFix ───
            if (e.target.closest('td[data-bigfix]')) return;

            const serverName = row.dataset.name;
            if (!serverName) return;

            e.preventDefault();
            this.openEditServerModal(serverName);
        });
    }


    // ══════════════════════════════════════════════════════════
    // מודל פערים בין קטלוג מערכות לשרתים
    // ══════════════════════════════════════════════════════════
    async openGapsModal() {
        console.log("HI")
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
                 onclick="window._srvDashboard._filterGapsTable('${type}')"
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
                                window._srvDashboard._quickFixCatalog(this)">
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
                                window._srvDashboard._quickFixServers(this)">
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
                onclick="window._srvDashboard._filterGapsTable(null)">
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
                onclick="window._srvDashboard._exportGapsToExcel()">
            <i class="fas fa-file-excel"></i>
            ייצא פערים לאקסל
        </button>
        <button class="sc-gaps-refresh-btn"
                onclick="window._srvDashboard._refreshGaps()">
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

    // ─── עדכן תא IP בטבלה ───────────────────────────────────────
    _updateIpCell(serverName, newIp) {
        const tbody = document.getElementById('srvTbody');
        if (!tbody) return;

        const row = tbody.querySelector(
            `tr.srv-tr[data-name="${this.escHtml(serverName)}"]`
        );
        if (!row) return;

        // ─── מצא את תא ה-IP (עמודה srv-td-ip) ───
        const ipCell = row.querySelector('td.srv-td-ip');
        if (!ipCell) return;

        // ─── עדכן תוכן התא ───
        const primaryIp = this._extractPrimaryIp(newIp);
        ipCell.textContent = primaryIp;
        ipCell.title = newIp;

        // ─── הוסף אנימציה קצרה להדגשת השינוי ───
        ipCell.style.transition = 'background 0.3s ease';
        ipCell.style.background = 'rgba(34,197,94,0.15)';
        setTimeout(() => {
            ipCell.style.background = '';
        }, 1500);
    }

    // ══════════════════════════════════════════════════════════
    // עזרים פנימיים
    // ══════════════════════════════════════════════════════════
    _getPaginationInfo() {
        const total = this.filteredServers.length;
        const pages = Math.ceil(total / this.pageSize);
        const start = (this.currentPage - 1) * this.pageSize;
        const page = this.filteredServers.slice(start, start + this.pageSize);
        return { page, total, pages };
    }

    // ══════════════════════════════════════════════════════════════
    // מוחרג - הוסף קידומת "מוחרג - " לשרתים מקובץ
    // ══════════════════════════════════════════════════════════════
    async _excludeServersFromFile() {
        if (!this.isAdmin) {
            this.showToast('אין הרשאה', 'error');
            return;
        }

        // ─── פתח dialog לבחירת קובץ ───────────────────────────────
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            document.body.removeChild(input);
            if (!file) return;

            await this._processExcludeFile(file);
        });

        input.click();
    }

    // ─── עבד קובץ מוחרגים ────────────────────────────────────────
    async _processExcludeFile(file) {
        try {
            this.showToast('מעבד קובץ...', 'info');

            // ─── טען XLSX אם צריך ─────────────────────────────────
            if (typeof XLSX === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.sheetjs.com/xlsx-latest/' +
                        'package/dist/xlsx.full.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת ספריית XLSX'));
                    document.head.appendChild(s);
                });
            }

            // ─── קרא את הקובץ ─────────────────────────────────────
            const serverNames = await this._readServerNamesFromFile(file);

            if (!serverNames || serverNames.length === 0) {
                this.showToast('לא נמצאו שמות שרתים בקובץ', 'error');
                return;
            }

            this.showToast(`נמצאו ${serverNames.length} שרתים בקובץ`, 'info');

            // ─── בנה רשימת שינויים ────────────────────────────────
            const changes = [];

            for (const name of serverNames) {
                const srv = this.allServers.find(s =>
                    (s.name || '').toLowerCase() === name.toLowerCase()
                );

                if (!srv) {
                    changes.push({
                        name,
                        found: false,
                        oldBootType: '',
                        newBootType: '',
                        selected: false
                    });
                    continue;
                }

                const oldBoot = (srv.bootType || '').trim();

                // ─── בדוק אם כבר מוחרג ────────────────────────────
                if (oldBoot.startsWith('מוחרג - ')) {
                    changes.push({
                        name,
                        found: true,
                        alreadyExcluded: true,
                        oldBootType: oldBoot,
                        newBootType: oldBoot,
                        selected: false
                    });
                    continue;
                }

                const newBoot = oldBoot
                    ? `מוחרג - ${oldBoot}`
                    : 'מוחרג - ';

                changes.push({
                    name,
                    found: true,
                    alreadyExcluded: false,
                    oldBootType: oldBoot,
                    newBootType: newBoot,
                    selected: true
                });
            }

            // ─── הצג מודל אישור ───────────────────────────────────
            const result = await this._showExcludePreviewModal(
                changes, file.name
            );

            if (!result) {
                this.showToast('הפעולה בוטלה', 'info');
                return;
            }

            // ─── החל שינויים נבחרים ───────────────────────────────
            const selectedChanges = changes.filter(c =>
                c.selected && c.found && !c.alreadyExcluded
            );

            if (selectedChanges.length === 0) {
                this.showToast('לא נבחרו שינויים להחיל', 'info');
                return;
            }

            // ─── עדכן בזיכרון ─────────────────────────────────────
            for (const change of selectedChanges) {
                const srv = this.allServers.find(s =>
                    (s.name || '').toLowerCase() ===
                    change.name.toLowerCase()
                );
                if (srv) {
                    srv.bootType = change.newBootType;
                }
            }

            // ─── שמור לשרת ────────────────────────────────────────
            this.showToast('שומר שינויים...', 'info');

            const res = await fetch('/Servers/SaveServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ servers: this.allServers })
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'שגיאה בשמירה');

            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();
            this._populateDropdownFilters();
            this._restoreFilterSelects();

            this.showToast(
                `✅ עודכנו ${selectedChanges.length} שרתים`,
                'success'
            );

        } catch (err) {
            console.error('_processExcludeFile error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
        }
    }

    // ─── קרא שמות שרתים מקובץ Excel ─────────────────────────────
    _readServerNamesFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];

                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        defval: ''
                    });

                    if (!jsonData || jsonData.length === 0) {
                        resolve([]);
                        return;
                    }

                    // ─── מצא עמודת Server Name ────────────────────
                    const possibleCols = [
                        'Server Name', 'server name', 'ServerName',
                        'שם שרת', 'שם', 'Name', 'name'
                    ];

                    let nameCol = null;
                    if (jsonData.length > 0) {
                        const firstRow = jsonData[0];
                        for (const col of possibleCols) {
                            if (firstRow.hasOwnProperty(col)) {
                                nameCol = col;
                                break;
                            }
                        }

                        // ─── אם לא נמצא - קח את העמודה הראשונה ───
                        if (!nameCol) {
                            nameCol = Object.keys(firstRow)[0];
                        }
                    }

                    if (!nameCol) {
                        resolve([]);
                        return;
                    }

                    // ─── חלץ שמות ─────────────────────────────────
                    const names = jsonData
                        .map(row => {
                            const val = row[nameCol];
                            if (!val) return null;
                            const str = String(val).trim();
                            if (!str) return null;
                            // ─── הסר דומיין אם יש ─────────────────
                            const dotIdx = str.indexOf('.');
                            if (dotIdx > 0) {
                                const afterDot = str.substring(dotIdx + 1);
                                if (afterDot.length >= 2 &&
                                    isNaN(afterDot[0]) &&
                                    /[a-zA-Z]/.test(afterDot)) {
                                    return str.substring(0, dotIdx);
                                }
                            }
                            return str;
                        })
                        .filter(Boolean);

                    resolve([...new Set(names)]); // הסר כפילויות

                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
            reader.readAsArrayBuffer(file);
        });
    }

    // ─── מודל תצוגה מקדימה למוחרגים ─────────────────────────────
    _showExcludePreviewModal(changes, fileName) {
        return new Promise(resolve => {
            const existing = document.getElementById('srvExcludeModal');
            if (existing) existing.remove();

            // ─── סטטיסטיקות ───────────────────────────────────────
            const toChange = changes.filter(
                c => c.found && !c.alreadyExcluded
            );
            const notFound = changes.filter(c => !c.found);
            const alreadyExcluded = changes.filter(
                c => c.found && c.alreadyExcluded
            );

            // ─── בנה שורות טבלה ───────────────────────────────────
            const rowsHtml = changes.map((c, idx) => {
                if (!c.found) {
                    return `
                <tr class="srv-exclude-row srv-exclude-row-notfound">
                    <td class="srv-exclude-td" style="width:32px;">
                        <input type="checkbox" disabled
                               style="opacity:0.3">
                    </td>
                    <td class="srv-exclude-td">
                        <i class="fas fa-question-circle"
                           style="color:#6b7280;font-size:0.7rem"></i>
                        ${this.escHtml(c.name)}
                    </td>
                    <td class="srv-exclude-td">
                        <span style="color:#555;font-size:0.75rem">
                            לא נמצא במערכת
                        </span>
                    </td>
                    <td class="srv-exclude-td">—</td>
                    <td class="srv-exclude-td">
                        <span style="
                            background:rgba(107,114,128,0.12);
                            border:1px solid rgba(107,114,128,0.25);
                            border-radius:6px;padding:1px 7px;
                            color:#6b7280;font-size:0.7rem">
                            לא נמצא
                        </span>
                    </td>
                </tr>`;
                }

                if (c.alreadyExcluded) {
                    return `
                <tr class="srv-exclude-row srv-exclude-row-already"
                    style="opacity:0.5">
                    <td class="srv-exclude-td" style="width:32px">
                        <input type="checkbox" disabled
                               style="opacity:0.3">
                    </td>
                    <td class="srv-exclude-td">
                        <i class="fas fa-server"
                           style="color:#555;font-size:0.7rem"></i>
                        ${this.escHtml(c.name)}
                    </td>
                    <td class="srv-exclude-td">
                        <span style="color:#888;font-size:0.75rem;
                                     font-family:monospace">
                            ${this.escHtml(c.oldBootType)}
                        </span>
                    </td>
                    <td class="srv-exclude-td" style="color:#555">
                        ←
                    </td>
                    <td class="srv-exclude-td">
                        <span style="
                            background:rgba(107,114,128,0.12);
                            border:1px solid rgba(107,114,128,0.25);
                            border-radius:6px;padding:1px 7px;
                            color:#9ca3af;font-size:0.7rem">
                            כבר מוחרג
                        </span>
                    </td>
                </tr>`;
                }

                // ─── שרת שישתנה ───────────────────────────────────
                return `
            <tr class="srv-exclude-row srv-exclude-row-change"
                data-idx="${idx}">
                <td class="srv-exclude-td" style="width:32px;text-align: center;">
                    <input type="checkbox"
                           class="srv-exclude-cb"
                           data-idx="${idx}"
                           checked
                           style="accent-color:#6366f1;
                                  width:14px;height:14px;
                                  cursor:pointer">
                </td>
                <td class="srv-exclude-td" style="text-align: center;">
                    <i class="fas fa-server"
                       style="color:#6366f1;font-size:0.9rem"></i>
                    <strong style="color:#e0e0e0">
                        ${this.escHtml(c.name)}
                    </strong>
                </td>
                <td class="srv-exclude-td" style="text-align: center;">
                    <span style="
                        color:#fca5a5;
                        text-decoration:line-through;
                        opacity:0.8;
                        font-size:0.85rem;">
                        ${this.escHtml(c.oldBootType || '(ריק)')}
                    </span>
                </td>
                <td class="srv-exclude-td"
                    style="color:#6366f1;font-size:0.72rem;text-align: center;">
                    ←
                </td>
                <td class="srv-exclude-td" style="text-align: center;">
                    <span style="
                        color:#86efac;
                        font-size:0.85rem;">
                        ${this.escHtml(c.newBootType)}
                    </span>
                </td>
            </tr>`;
            }).join('');

            const modal = document.createElement('div');
            modal.id = 'srvExcludeModal';
            modal.className = 'srv-modal-overlay';

            modal.innerHTML = `
        <div class="srv-modal" style="max-width:700px;width:95%">

            <!-- כותרת -->
            <div class="srv-modal-header" style="
                border-bottom:2px solid rgba(99,102,241,0.35);
                background:linear-gradient(135deg,
                    rgba(99,102,241,0.08),
                    rgba(124,58,237,0.05))">
                <h3 class="srv-modal-title">
                    <i class="fas fa-ban" style="color:#6366f1"></i>
                    הוספת קידומת "מוחרג"
                    <span style="
                        font-size:0.75rem;color:#666;
                        font-weight:400;margin-right:8px">
                        ${this.escHtml(fileName)}
                    </span>
                </h3>
                <button class="srv-modal-close"
                        id="srvExcludeClose">&times;</button>
            </div>

            <!-- סטטיסטיקות -->
            <div style="
                display:flex;gap:10px;padding:12px 20px;
                background:#16162a;
                border-bottom:1px solid #2a2a4e;
                flex-wrap:wrap">
                <span style="
                    display:flex;align-items:center;gap:6px;
                    padding:4px 12px;border-radius:10px;
                    background:rgba(99,102,241,0.12);
                    border:1px solid rgba(99,102,241,0.3);
                    color:#a5b4fc;font-size:0.8rem;font-weight:600">
                    <i class="fas fa-list"></i>
                    סה"כ בקובץ: <strong>${changes.length}</strong>
                </span>
                <span style="
                    display:flex;align-items:center;gap:6px;
                    padding:4px 12px;border-radius:10px;
                    background:rgba(34,197,94,0.12);
                    border:1px solid rgba(34,197,94,0.3);
                    color:#86efac;font-size:0.8rem;font-weight:600">
                    <i class="fas fa-edit"></i>
                    ישתנו: <strong id="srvExcludeCount">
                        ${toChange.length}
                    </strong>
                </span>
                ${alreadyExcluded.length > 0 ? `
                <span style="
                    display:flex;align-items:center;gap:6px;
                    padding:4px 12px;border-radius:10px;
                    background:rgba(107,114,128,0.1);
                    border:1px solid rgba(107,114,128,0.25);
                    color:#9ca3af;font-size:0.8rem;font-weight:600">
                    <i class="fas fa-check"></i>
                    כבר מוחרגים: <strong>${alreadyExcluded.length}</strong>
                </span>` : ''}
                ${notFound.length > 0 ? `
                <span style="
                    display:flex;align-items:center;gap:6px;
                    padding:4px 12px;border-radius:10px;
                    background:rgba(239,68,68,0.1);
                    border:1px solid rgba(239,68,68,0.25);
                    color:#fca5a5;font-size:0.8rem;font-weight:600">
                    <i class="fas fa-question-circle"></i>
                    לא נמצאו: <strong>${notFound.length}</strong>
                </span>` : ''}
            </div>

            <!-- כפתורי בחר/בטל הכל -->
            ${toChange.length > 0 ? `
            <div style="
                display:flex;align-items:center;gap:10px;
                padding:8px 20px;
                background:rgba(99,102,241,0.04);
                border-bottom:1px solid rgba(99,102,241,0.15)">
                <button id="srvExcludeSelectAll"
                        style="padding:3px 10px;
                               background:rgba(34,197,94,0.1);
                               border:1px solid rgba(34,197,94,0.3);
                               border-radius:5px;color:#86efac;
                               font-size:0.75rem;font-weight:600;
                               cursor:pointer;font-family:inherit">
                    <i class="fas fa-check-double"></i> בחר הכל
                </button>
                <button id="srvExcludeDeselectAll"
                        style="padding:3px 10px;
                               background:rgba(239,68,68,0.08);
                               border:1px solid rgba(239,68,68,0.25);
                               border-radius:5px;color:#fca5a5;
                               font-size:0.75rem;font-weight:600;
                               cursor:pointer;font-family:inherit">
                    <i class="fas fa-times"></i> בטל הכל
                </button>
            </div>` : ''}

            <!-- טבלה -->
            <div style="
                overflow-y:auto;max-height:420px;
                border-bottom:1px solid #2a2a4e">
                <table style="
                    width:100%;border-collapse:collapse;
                    font-size:0.82rem;direction:rtl">
                    <thead>
                        <tr style="background:#1a1a2e;
                                   position:sticky;top:0;z-index:5">
                            <th class="srv-th"
                                style="width:36px;text-align:center">
                                <input type="checkbox"
                                       id="srvExcludeHeaderCb"
                                       checked
                                       style="accent-color:#6366f1;
                                              width:14px;height:14px;
                                              cursor:pointer">
                            </th>
                            <th class="srv-th">שם שרת</th>
                            <th class="srv-th">ערך קיים</th>
                            <th class="srv-th" style="width:30px"></th>
                            <th class="srv-th">ערך חדש</th>
                        </tr>
                    </thead>
                    <tbody id="srvExcludeTbody">
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>

            <!-- Footer -->
            <div class="srv-modal-footer">
                <button class="srv-modal-cancel-btn"
                        id="srvExcludeCancel">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button id="srvExcludeConfirm"
                        style="padding:8px 18px;
                               background:linear-gradient(
                                   135deg,#4f46e5,#7c3aed);
                               border:none;border-radius:6px;
                               color:white;font-size:0.85rem;
                               font-weight:700;cursor:pointer;
                               display:flex;align-items:center;
                               gap:6px;font-family:inherit;
                               transition:all 0.2s"
                        ${toChange.length === 0 ? 'disabled' : ''}>
                    <i class="fas fa-ban"></i>
                    החל מוחרג
                    (<span id="srvExcludeApplyCount">
                        ${toChange.length}
                    </span>)
                </button>
            </div>
        </div>`;

            document.body.appendChild(modal);

            // ─── עדכן מונה ────────────────────────────────────────
            const updateCount = () => {
                const checked = document.querySelectorAll(
                    '.srv-exclude-cb:checked'
                ).length;
                const countEl = document.getElementById('srvExcludeCount');
                const applyEl = document.getElementById('srvExcludeApplyCount');
                const confirmBtn = document.getElementById('srvExcludeConfirm');
                if (countEl) countEl.textContent = checked;
                if (applyEl) applyEl.textContent = checked;
                if (confirmBtn) {
                    confirmBtn.disabled = checked === 0;
                    confirmBtn.style.opacity = checked === 0 ? '0.4' : '1';
                }

                // ─── עדכן header checkbox ──────────────────────────
                const allCbs = document.querySelectorAll('.srv-exclude-cb');
                const headerCb = document.getElementById('srvExcludeHeaderCb');
                if (headerCb) {
                    headerCb.checked = checked === allCbs.length;
                    headerCb.indeterminate =
                        checked > 0 && checked < allCbs.length;
                }

                // ─── עדכן מצב ה-changes array ─────────────────────
                document.querySelectorAll('.srv-exclude-cb').forEach(cb => {
                    const idx = parseInt(cb.dataset.idx);
                    if (!isNaN(idx) && changes[idx]) {
                        changes[idx].selected = cb.checked;
                    }
                });
            };

            // ─── אירועי checkboxes ────────────────────────────────
            document.getElementById('srvExcludeTbody')
                ?.addEventListener('change', e => {
                    if (e.target.classList.contains('srv-exclude-cb')) {
                        updateCount();
                    }
                });

            document.getElementById('srvExcludeHeaderCb')
                ?.addEventListener('change', e => {
                    document.querySelectorAll('.srv-exclude-cb')
                        .forEach(cb => { cb.checked = e.target.checked; });
                    updateCount();
                });

            document.getElementById('srvExcludeSelectAll')
                ?.addEventListener('click', () => {
                    document.querySelectorAll('.srv-exclude-cb')
                        .forEach(cb => { cb.checked = true; });
                    updateCount();
                });

            document.getElementById('srvExcludeDeselectAll')
                ?.addEventListener('click', () => {
                    document.querySelectorAll('.srv-exclude-cb')
                        .forEach(cb => { cb.checked = false; });
                    updateCount();
                });

            // ─── סגירה ────────────────────────────────────────────
            const closeModal = (result) => {
                modal.remove();
                resolve(result);
            };

            document.getElementById('srvExcludeClose')
                ?.addEventListener('click', () => closeModal(null));
            document.getElementById('srvExcludeCancel')
                ?.addEventListener('click', () => closeModal(null));
            modal.addEventListener('click', e => {
                if (e.target === modal) closeModal(null);
            });

            document.getElementById('srvExcludeConfirm')
                ?.addEventListener('click', () => closeModal(true));
        });
    }

    _pageRange(cur, total) {
        const delta = 2;
        const range = [];
        const left = cur - delta;
        const right = cur + delta;

        for (let i = 1; i <= total; i++) {
            if (i === 1 || i === total ||
                (i >= left && i <= right)) {
                range.push(i);
            }
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

    // ─── נרמל ערך סביבה ───────────────────────────────────────
    _normalizeEnvironment(val) {
        if (!val) return '';
        // הסר רווחים, מקפים, קווים תחתונים - והמר לאותיות גדולות
        const normalized = val.toString()
            .trim()
            .replace(/[\s\-_]/g, '')
            .toUpperCase();

        if (normalized === 'PROD') return 'PROD';
        if (normalized === 'NONPROD') return 'NONPROD';

        // fallback - החזר את הערך המנורמל
        return normalized;
    }

    // ══════════════════════════════════════════════════════════
    // עדכון פילטרי dropdown - כולל וריאציות דינמיות
    // ══════════════════════════════════════════════════════════
    _populateDropdownFilters() {

        // ─── עזר: בנה אפשרויות עם תמיכה בריק ───────────────────
        const buildOptions = (selectEl, defaultLabel, values,
            hasEmpty, curVal) => {
            if (!selectEl) return;
            selectEl.innerHTML =
                `<option value="all">${defaultLabel}</option>` +
                values.map(v =>
                    `<option value="${this.escHtml(String(v))}"
                 ${curVal === String(v) ? 'selected' : ''}>
                 ${this.escHtml(String(v))}
                 </option>`
                ).join('') +
                (hasEmpty
                    ? `<option value="__empty__"
                       ${curVal === '__empty__' ? 'selected' : ''}>
                       — ריק —
                   </option>`
                    : '');
        };

        // ─── סביבה ───
        const envSel = document.getElementById('srvFltEnv');
        if (envSel) {
            const cur = envSel.value;
            const envList = [...new Set(
                this.allServers
                    .map(s => this._normalizeEnvironment(s.environment))
                    .filter(Boolean)
            )].sort();
            const hasEmpty = this.allServers.some(
                s => !s.environment || s.environment.trim() === ''
            );
            buildOptions(envSel, 'כל הסביבות', envList, hasEmpty, cur);
        }

        // ─── סוג שרת ───
        const virtualSel = document.getElementById('srvFltVirtual');
        if (virtualSel) {
            const cur = virtualSel.value;
            const normSet = new Set(
                this.allServers.map(s => this._normalizeVirtual(s.isVirtual))
            );
            const labelMap = {
                'TRUE': '☁️ וירטואלי',
                'FALSE': '🖥️ פיזי',
                'UNKNOWN': '❓ לא ידוע'
            };
            const hasEmpty = this.allServers.some(
                s => !s.isVirtual || s.isVirtual.trim() === ''
            );
            virtualSel.innerHTML =
                '<option value="all">הכל</option>' +
                [...normSet].filter(Boolean).map(v =>
                    `<option value="${v}"
                 ${cur === v ? 'selected' : ''}>
                 ${labelMap[v] || v}
                 </option>`
                ).join('') +
                (hasEmpty
                    ? `<option value="__empty__"
                       ${cur === '__empty__' ? 'selected' : ''}>
                       — ריק —
                   </option>`
                    : '');
        }

        // ─── סטטוס מערכת ───
        const statusSel = document.getElementById('srvFltStatus');
        if (statusSel) {
            const cur = statusSel.value;
            // תיקון - הוסף לכל dropdown בדיקת ריקים
            const statusList = [...new Set(
                this.allServers.map(s => s.systemStatus).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));

            // ─── בדוק אם יש שרתים עם ערך ריק ───
            const hasEmpty = this.allServers.some(
                s => !s.systemStatus || s.systemStatus.trim() === ''
            );

            statusSel.innerHTML =
                '<option value="all">כל הסטטוסים</option>' +
                statusList.map(st =>
                    `<option value="${this.escHtml(st)}"
        ${cur === st ? 'selected' : ''}>
        ${this.escHtml(st)}
    </option>`
                ).join('') +
                (hasEmpty
                    ? `<option value="__empty__"
               ${cur === '__empty__' ? 'selected' : ''}>
               — ריק —
           </option>`
                    : '');
            buildOptions(statusSel, 'כל הסטטוסים', statusList, hasEmpty, cur);
        }

        // ─── תקינות ───
        const healthySel = document.getElementById('srvFltHealthy');
        if (healthySel) {
            const cur = healthySel.value;
            const list = [...new Set(
                this.allServers.map(s => s.isHealthy).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.isHealthy || s.isHealthy.trim() === ''
            );
            buildOptions(healthySel, 'כל התקינות', list, hasEmpty, cur);
        }

        // ─── מחלקה ───
        const deptSel = document.getElementById('srvFltDept');
        if (deptSel) {
            const cur = deptSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.department).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.department || s.department.trim() === ''
            );
            buildOptions(deptSel, 'כל המחלקות', list, hasEmpty, cur);
        }

        // ─── צוות ───
        const teamSel = document.getElementById('srvFltTeam');
        if (teamSel) {
            const cur = teamSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.team).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.team || s.team.trim() === ''
            );
            buildOptions(teamSel, 'כל הצוותים', list, hasEmpty, cur);
        }

        // ─── OS ───
        const osSel = document.getElementById('srvFltOs');
        if (osSel) {
            const cur = osSel.value;
            const list = [...new Set(
                this.allServers.map(s => this._simplifyOs(s.os))
            )].sort();
            const hasEmpty = this.allServers.some(
                s => !s.os || s.os.trim() === ''
            );
            buildOptions(osSel, 'כל ה-OS', list, hasEmpty, cur);
        }

        // ─── שם מערכת ───
        const systemNameSel = document.getElementById('srvFltSystemName');
        if (systemNameSel) {
            const cur = systemNameSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.systemName).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.systemName || s.systemName.trim() === ''
            );
            buildOptions(systemNameSel, 'כל המערכות', list, hasEmpty, cur);
        }

        // ─── מנהל מערכת ───
        const managerSel = document.getElementById('srvFltSystemManager');
        if (managerSel) {
            const cur = managerSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.systemManager).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.systemManager || s.systemManager.trim() === ''
            );
            buildOptions(managerSel, 'כל המנהלים', list, hasEmpty, cur);
        }

        // ─── סוג אתחול ───
        const bootTypeSel = document.getElementById('srvFltBootType');
        if (bootTypeSel) {
            const cur = bootTypeSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.bootType).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.bootType || s.bootType.trim() === ''
            );
            buildOptions(bootTypeSel, 'כל סוגי האתחול', list, hasEmpty, cur);
        }

        // ─── BigFix - ללא שינוי (לוגיקה שונה) ───
        const bigfixSel = document.getElementById('srvFltBigfix');
        if (bigfixSel) {
            const cur = bigfixSel.value;
            const labelMap = {
                'Completed': 'Completed',
                'Need Restart': 'Need Restart',
                'Pending Restart': 'Pending Restart',
                'Not Completed': 'WAIT TO INSTALL',
                'Not Reboot 120 day': 'Not Reboot 120 day',
            };
            const foundStatuses = new Set();
            let hasNotFound = false;

            this.allServers.forEach(s => {
                const key = (s.name || '').toLowerCase();
                const status = this.bigFixData[key];
                if (!status) {
                    hasNotFound = true;
                } else {
                    const raw = (
                        status.pendingRestart ||
                        status.PendingRestart || ''
                    ).trim();
                    let normalized = raw;
                    if (raw === 'True' || raw === 'TRUE') normalized = 'Need Restart';
                    if (raw === 'False' || raw === 'FALSE') normalized = 'Completed';
                    if (normalized) foundStatuses.add(normalized);
                }
            });

            const ORDER = [
                'Completed', 'Need Restart', 'Pending Restart',
                'Not Completed', 'Not Reboot 120 day',
            ];
            const sortedStatuses = [
                ...ORDER.filter(s => foundStatuses.has(s)),
                ...[...foundStatuses].filter(s => !ORDER.includes(s)).sort(),
            ];

            bigfixSel.innerHTML =
                '<option value="all">כל הסטטוסים</option>' +
                sortedStatuses.map(raw => {
                    const label = labelMap[raw] || raw;
                    return `<option value="${this.escHtml(raw)}"
                        ${cur === raw ? 'selected' : ''}>
                        ${this.escHtml(label)}
                        </option>`;
                }).join('') +
                (hasNotFound
                    ? `<option value="notfound"
                       ${cur === 'notfound' ? 'selected' : ''}>
                       ➖ לא ב-BigFix
                   </option>`
                    : '');
        }

        // ─── תחום ───
        const domainSel = document.getElementById('srvFltDomain');
        if (domainSel) {
            const cur = domainSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.domain).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.domain || s.domain.trim() === ''
            );
            buildOptions(domainSel, 'כל התחומים', list, hasEmpty, cur);
        }

        // ─── ניתן לכבות ───
        const canShutdownSel = document.getElementById('srvFltCanShutdown');
        if (canShutdownSel) {
            const cur = canShutdownSel.value;
            const list = [...new Set(
                this.allServers.map(s => s.canShutdown).filter(Boolean)
            )].sort((a, b) => a.localeCompare(b, 'he'));
            const hasEmpty = this.allServers.some(
                s => !s.canShutdown || s.canShutdown.trim() === ''
            );
            buildOptions(canShutdownSel, 'הכל', list, hasEmpty, cur);
        }

        // ─── עדכן תגיות פילטרים פעילים ───
        this._renderActiveFilterTags();
    }

    // ══════════════════════════════════════════════════════════
    // תגיות פילטרים פעילים - מחוץ לפופאפ
    // ══════════════════════════════════════════════════════════
    _renderActiveFilterTags() {
        const container = document.getElementById('srvActiveFilterTags');
        if (!container) return;

        const labelMap = {
            environment: 'סביבה',
            isVirtual: 'סוג שרת',
            systemStatus: 'סטטוס',
            isHealthy: 'תקינות',
            department: 'מחלקה',
            team: 'צוות',
            os: 'OS',
            bigfixStatus: 'BigFix',
            systemName: 'מערכת',
            systemManager: 'מנהל',
            bootType: 'אתחול',
            catalogNumber: 'מס׳ קטלוג',
        };

        const displayMap = {
            'notfound': 'לא ב-BigFix',
            'TRUE': '☁️ וירטואלי',
            'FALSE': '🖥️ פיזי',
            'UNKNOWN': '❓ לא ידוע',
            '__empty__': '— ריק —',
        };

        const activeTags = Object.entries(this.filters)
            .filter(([, val]) => val !== 'all' && !(val instanceof Set && val.size === 0))
            .map(([key, val]) => {
                let display;
                if (val instanceof Set) {
                    display = [...val]
                        .map(v => displayMap[v] || v)
                        .join(', ');
                } else {
                    display = displayMap[String(val)] || String(val || '');
                }
                return { key, label: labelMap[key] || key, display, val };
            });

        if (activeTags.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = activeTags.map(tag => `
        <span class="srv-active-tag"
              data-filter-key="${this.escHtml(tag.key)}">
            <span class="srv-active-tag-label">
                ${this.escHtml(tag.label)}:
            </span>
            <span class="srv-active-tag-value">
                ${this.escHtml(tag.display)}
            </span>
            <button class="srv-active-tag-remove"
                    data-filter-key="${this.escHtml(tag.key)}"
                    title="הסר פילטר">
                <i class="fas fa-times"></i>
            </button>
        </span>
    `).join('');
    }

    // ══════════════════════════════════════════════════════════
    // Highlight שדות מסוננים בתוך הפופאפ
    // ══════════════════════════════════════════════════════════
    _highlightActiveFilterGroups() {
        const popup = document.getElementById('srvFiltersPopup');
        if (!popup) return;

        // עבור על כל filter-group
        popup.querySelectorAll('.srv-filter-group[data-filter-key]')
            .forEach(group => {
                const key = group.dataset.filterKey;
                const isActive = this.filters[key] &&
                    this.filters[key] !== 'all';

                // הוסף/הסר class active
                group.classList.toggle('srv-filter-group-active', isActive);

                // עדכן label
                const label = group.querySelector('.srv-filter-label');
                if (label) {
                    label.classList.toggle(
                        'srv-filter-label-active', isActive
                    );
                }

                // עדכן select
                const select = group.querySelector('.srv-select');
                if (select) {
                    select.classList.toggle(
                        'srv-select-active', isActive
                    );
                }
            });
    }

    _restoreFilterSelects() {
        const map = {
            srvFltEnv: this.filters.environment,
            srvFltVirtual: this.filters.isVirtual,
            srvFltStatus: this.filters.systemStatus,
            srvFltHealthy: this.filters.isHealthy,
            srvFltDept: this.filters.department,
            srvFltTeam: this.filters.team,
            srvFltOs: this.filters.os,
            srvFltBigfix: this.filters.bigfixStatus,
            srvFltSystemName: this.filters.systemName,
            srvFltSystemManager: this.filters.systemManager,
            srvFltBootType: this.filters.bootType,
            srvFltDomain: this.filters.domain,
            srvFltCanShutdown: this.filters.canShutdown,
            srvFltCatalogNumber: this.filters.catalogNumber,
            srvPageSize: String(this.pageSize),
        };

        Object.entries(map).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });
    }

    _updateFilterCounter() {
        const counter = document.getElementById('srvCounter');
        if (!counter) return;
        const total = this.allServers.length;
        const filtered = this.filteredServers.length;
        counter.textContent = filtered < total
            ? `${filtered} / ${total} שרתים`
            : `${total} שרתים`;

        // ─── עדכן badge מספר פילטרים פעילים ───
        const activeCount = Object.values(this.filters)
            .filter(v => v !== 'all' && !(v instanceof Set && v.size === 0)).length;
        const badge = document.getElementById('srvFiltersBadge');
        if (badge) {
            badge.textContent = activeCount;
            badge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
        }
        const toggleBtn = document.getElementById('srvFiltersToggle');
        if (toggleBtn) {
            toggleBtn.classList.toggle('srv-filters-active', activeCount > 0);
        }

        // ─── highlight שדות מסוננים בתוך הפופאפ ───
        this._highlightActiveFilterGroups();

        // ─── עדכן תגיות פילטרים פעילים ───
        this._renderActiveFilterTags();
    }

    _updateViewBtns() {
        ['Table', 'Cards', 'Stats'].forEach(v => {
            const btn = document.getElementById(`srvView${v}`);
            if (btn) btn.classList.toggle(
                'active', this.viewMode === v.toLowerCase()
            );
        });
    }

    _updateLastUpdate() {
        const el = document.getElementById('srvLastUpdate');
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

    _simplifyOs(os) {
        if (!os) return 'לא ידוע';
        if (os.includes('2025')) return 'Win 2025';
        if (os.includes('2022')) return 'Win 2022';
        if (os.includes('2019')) return 'Win 2019';
        if (os.includes('2016')) return 'Win 2016';
        if (os.includes('2012')) return 'Win 2012';
        if (os.includes('2008')) return 'Win 2008';
        if (os.includes('Ubuntu')) return 'Ubuntu';
        if (os.includes('Red Hat') || os.includes('RHEL')) return 'RHEL';
        if (os.includes('Linux') || os.includes('linux')) return 'Linux';
        if (os.includes('Windows')) return 'Windows (אחר)';
        return 'אחר';
    }

    _getStatusClass(status) {
        if (status === 'פעילה') return 'srv-badge-active';
        if (status === 'לא פעילה') return 'srv-badge-inactive';
        return 'srv-badge-neutral';
    }

    _getHealthClass(health) {
        if (health === 'תקין') return 'srv-badge-healthy';
        if (health === 'לא תקין') return 'srv-badge-unhealthy';
        return 'srv-badge-neutral';
    }

    _savePreferences() {
        try {
            // המר Sets למערכים לפני שמירה
            const filtersToSave = {};
            Object.entries(this.filters).forEach(([k, v]) => {
                filtersToSave[k] = v instanceof Set ? [...v] : v;
            });
            userSettings.setItem(this.LS_FILTERS, JSON.stringify(filtersToSave));
            userSettings.setItem(this.LS_SORT,
                JSON.stringify({ col: this.sortColumn, dir: this.sortDirection }));
            userSettings.setItem(this.LS_VIEW, this.viewMode);
            userSettings.setItem(this.LS_PAGE_SIZE, String(this.pageSize));
        } catch (e) { }
    }

    _loadPreferences() {
        try {
            const f = userSettings.getItem(this.LS_FILTERS);
            if (f) {
                const parsed = JSON.parse(f);
                // המר מערכים חזרה ל-Sets
                Object.entries(parsed).forEach(([k, v]) => {
                    this.filters[k] = Array.isArray(v) ? new Set(v) : v;
                });
            }
            const s = userSettings.getItem(this.LS_SORT);
            if (s) {
                const { col, dir } = JSON.parse(s);
                this.sortColumn = col || 'name';
                this.sortDirection = dir || 'asc';
            }
            const v = userSettings.getItem(this.LS_VIEW);
            if (v) this.viewMode = v;
            const ps = userSettings.getItem(this.LS_PAGE_SIZE);
            if (ps) this.pageSize = parseInt(ps) || 50;
        } catch (e) { }
    }

    // ══════════════════════════════════════════════════════════
    // Toast / Loading / Error
    // ══════════════════════════════════════════════════════════
    showToast(msg, type = 'info', duration = 3000) {
        const t = document.getElementById('srvToast');
        if (!t) return;
        t.textContent = msg;
        t.className = `srv-toast srv-toast-${type} srv-toast-show`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            t.classList.remove('srv-toast-show');
        }, duration);
    }

    showLoading(show) {
        const el = document.getElementById('srvLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
        const content = document.getElementById('srvContent');
        if (content) content.style.opacity = show ? '0.4' : '1';
    }

    showError(msg) {
        const el = document.getElementById('srvError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 6000);
        }
    }

    escHtml(str) {
        if (str === null || str === undefined) return '';

        // המר כל סוג לstring לפני replace
        let s;
        if (str instanceof Set) {
            s = [...str].join(', ');
        } else {
            s = String(str);
        }

        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ══════════════════════════════════════════════════════════
    // ייבוא שרתים מאקסל
    // ══════════════════════════════════════════════════════════

    openImportExcelDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xlsx,.xls';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.processImportExcelFile(file);
            }
            document.body.removeChild(input);
        });

        input.click();
    }

    async processImportExcelFile(file) {
        try {
            this.showToast('מעבד קובץ...', 'info');

            if (typeof XLSX === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdn.sheetjs.com/xlsx-latest/' +
                        'package/dist/xlsx.full.min.js';
                    s.onload = res;
                    s.onerror = () => rej(
                        new Error('נכשלה טעינת ספריית XLSX')
                    );
                    document.head.appendChild(s);
                });
            }

            const parsedServers = await this._parseServersExcel(file);

            if (!parsedServers || parsedServers.length === 0) {
                this.showToast('לא נמצאו שרתים בקובץ', 'error');
                return;
            }

            const diff = this._detectChanges(parsedServers);

            // ─── הצג תצוגה מקדימה ───
            const result = await this._showImportPreview(
                diff, file.name
            );

            if (!result) return; // המשתמש ביטל

            // ─── החל שינויים + מחיקות ───
            await this._applyImportChanges(
                diff,
                result.overwriteExisting,
                result.toDelete || [],
                result.selectedNewIndexes || null
            );

            this.applyFiltersAndSort();
            this.renderContent();
            this.updateStats();

            // ─── בנה הודעת סיכום ───
            const parts = [];

            if (result.overwriteExisting && diff.changed.length > 0)
                parts.push(`${diff.changed.length} עודכנו`);

            // ─── ספור רק שרתים חדשים שנבחרו ───
            const addedCount = result.selectedNewIndexes
                ? result.selectedNewIndexes.size
                : diff.added.length;

            if (addedCount > 0)
                parts.push(`${addedCount} נוספו`);

            if (result.toDelete && result.toDelete.length > 0)
                parts.push(`${result.toDelete.length} נמחקו`);

            const msg = parts.filter(Boolean).join(', ');
            this.showToast(`✅ ייבוא הושלם: ${msg}`, 'success');

        } catch (err) {
            console.error('processImportExcelFile error:', err);
            this.showToast(
                'שגיאה בעיבוד הקובץ: ' + err.message, 'error'
            );
        }
    }

    // ══════════════════════════════════════════════════════════
    // ניקוי שם שרת - הסרת סיומות דומיין
    // ══════════════════════════════════════════════════════════
    _cleanServerName(name) {
        if (!name) return '';

        // ─── הסר רווחים מהצדדים ───
        let cleaned = name.trim();

        // ─── רשימת סיומות דומיין להסרה ───
        const domainSuffixes = [
            '.menora.co.il',
            '.menora.local',
            '.corp.local',
            '.local',
            '.co.il',
            '.com',
            '.net',
            '.org',
            '.il',
            '.int',
            '.corp',
            '.internal',
            '.domain',
            '.ad',
            '.lan',
        ];

        // ─── המר ל-lowercase לצורך השוואה ───
        const lowerCleaned = cleaned.toLowerCase();

        // ─── חפש וסיר סיומת מתאימה ───
        for (const suffix of domainSuffixes) {
            if (lowerCleaned.endsWith(suffix.toLowerCase())) {
                // ─── הסר את הסיומת תוך שמירת ה-case המקורי ───
                cleaned = cleaned.substring(
                    0, cleaned.length - suffix.length
                );
                break; // ─── הסר רק סיומת אחת ───
            }
        }

        return cleaned.trim();
    }

    async _parseServersExcel(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];

                    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
                        defval: ''
                    });

                    if (!jsonData || jsonData.length === 0) {
                        resolve([]);
                        return;
                    }

                    // מיפוי עמודות - תואם לטבלה הנוכחית
                    // תומך בכותרות עברית ואנגלית
                    const colMap = {
                        name: ['שם שרת', 'name', 'Name', 'שם', 'Server Name', 'server name'],
                        environment: ['סביבה', 'environment', 'Environment', 'PROD/NON PROD'],
                        isVirtual: ['סוג', 'isVirtual', 'Virtual', 'וירטואלי'],
                        os: ['מע׳ הפעלה', 'מערכת הפעלה', 'os', 'OS'],
                        systemName: ['שם מערכת', 'systemName', 'System Name', 'מערכת מקושרת', 'מערכת'],
                        catalogNumber: ['מס׳ קטלוג', 'מספר קטלוג', 'catalogNumber', 'Catalog Number'],
                        systemStatus: ['סטטוס', 'systemStatus', 'System Status', 'סטטוס מערכת'],
                        systemManager: ['מנהל מערכת', 'systemManager', 'System Manager'],
                        bootType: ['אתחול', 'bootType', 'Boot Type', 'סוג אתחול'],
                        domain: ['תחום', 'domain', 'Domain'],
                        department: ['מחלקה', 'department', 'Department'],
                        team: ['צוות', 'team', 'Team'],
                        canShutdown: ['ניתן לכבות', 'canShutdown', 'Can Shutdown'],
                        scannedVia: ['כתובת IP', 'scannedVia', 'Scanned Via', 'IP', 'ip', 'Ip'],
                        isHealthy: ['תקינות', 'isHealthy', 'Is Healthy', 'תקין/לא תקין'],
                        notes: ['הערות', 'notes', 'Notes'],
                        mappingNotes: ['הערות מיפוי', 'mappingNotes', 'Mapping Notes'],
                        hardwareVendor: ['יצרן חומרה', 'hardwareVendor', 'Hardware Vendor'],
                    };

                    // פונקציה למציאת ערך עמודה
                    const EXCEL_ERRORS = new Set([
                        '#N/A', 'N/A', '#NA', '#REF!', '#VALUE!',
                        '#DIV/0!', '#NAME?', '#NULL!', '#NUM!', 'NaN'
                    ]);

                    const getVal = (row, keys) => {
                        for (const key of keys) {
                            if (row[key] !== undefined && row[key] !== null) {
                                const v = String(row[key]).trim();
                                // ─── אם הערך הוא שגיאת Excel - החזר ריק ───
                                if (v && !EXCEL_ERRORS.has(v)) return v;
                            }
                        }
                        return '';
                    };

                    const servers = jsonData
                        .map(row => {
                            const rawName = getVal(row, colMap.name);
                            if (!rawName) return null;
                            const name = this._cleanServerName(rawName);
                            if (!name) return null;

                            // ── נרמל isVirtual ──────────────────────────────────────
                            const rawVirtual = getVal(row, colMap.isVirtual);
                            let isVirtual = '';  // ← ריק כברירת מחדל - לא נגע בערך אם לא הוגדר

                            if (rawVirtual) {
                                const v = rawVirtual.trim().toUpperCase();
                                // תמיכה בכל הפורמטים האפשריים מהייצוא ומהמקור
                                if (
                                    v === 'TRUE' ||
                                    v === '1' ||
                                    v === 'YES' ||
                                    v === 'כן' ||
                                    v === 'וירטואלי' ||
                                    v.includes('וירטואל') ||
                                    v === '☁️ וירטואלי'
                                ) {
                                    isVirtual = 'TRUE';
                                } else if (
                                    v === 'UNKNOWN' ||
                                    v === 'לא ידוע' ||
                                    v === '❓ לא ידוע'
                                ) {
                                    isVirtual = 'UNKNOWN';
                                } else if (
                                    v === 'FALSE' ||
                                    v === '0' ||
                                    v === 'NO' ||
                                    v === 'לא' ||
                                    v === 'פיזי' ||
                                    v.includes('פיזי') ||
                                    v === '🖥️ פיזי'
                                ) {
                                    isVirtual = 'FALSE';  // ← רק אם כתוב במפורש "פיזי"
                                }
                                // אם ערך לא מוכר - נשאר ריק
                            }

                            return {
                                name,
                                environment: getVal(row, colMap.environment),
                                isVirtual,
                                os: getVal(row, colMap.os),
                                systemName: getVal(row, colMap.systemName),
                                catalogNumber: getVal(row, colMap.catalogNumber),
                                systemStatus: getVal(row, colMap.systemStatus),
                                systemManager: getVal(row, colMap.systemManager),
                                bootType: getVal(row, colMap.bootType),
                                domain: getVal(row, colMap.domain),
                                department: getVal(row, colMap.department),
                                team: getVal(row, colMap.team),
                                canShutdown: getVal(row, colMap.canShutdown),
                                scannedVia: getVal(row, colMap.scannedVia),
                                isHealthy: getVal(row, colMap.isHealthy),
                                notes: getVal(row, colMap.notes),
                                mappingNotes: getVal(row, colMap.mappingNotes),
                                hardwareVendor: getVal(row, colMap.hardwareVendor),
                            };
                        })
                        .filter(Boolean);

                    resolve(servers);
                } catch (err) {
                    reject(err);
                }
            };

            reader.onerror = () => reject(new Error('שגיאה בקריאת הקובץ'));
            reader.readAsArrayBuffer(file);
        });
    }

    _detectChanges(importedServers) {
        const added = [];
        const changed = [];
        const unchanged = [];
        const removed = [];

        const TRACKED_FIELDS = [
            'environment', 'isVirtual', 'os', 'systemName',
            'catalogNumber', 'systemStatus', 'systemManager',
            'bootType', 'domain', 'department', 'team',
            'canShutdown', 'scannedVia', 'isHealthy',
            'notes', 'mappingNotes', 'hardwareVendor'
        ];
        // הוסף פונקציה לנרמול רשימת IPs
        const normalizeIpList = (val) => {
            if (!val) return '';
            return val
                .split(/[|,;]/)
                .map(ip => ip.trim())
                .filter(Boolean)
                .sort()
                .join('|');
        };

        const normalizeForCompare = (field, value) => {
            const v = (value || '').toString().trim();

            // ─── התייחס ל-#N/A וערכים דומים כאילו הם ריקים ───
            if (v === '#N/A' || v === 'N/A' || v === '#NA' ||
                v === '#REF!' || v === '#VALUE!' || v === '#DIV/0!' ||
                v === '#NAME?' || v === '#NULL!' || v === '#NUM!') {
                return '';
            }
            if (field === 'isVirtual') return this._normalizeVirtual(v);
            if (field === 'environment')
                return v.replace(/[\s\-_]/g, '').toUpperCase();
            // נרמל ערכי מחלקה/צוות/תחום
            if (['department', 'team', 'domain'].includes(field)) {
                return v
                    .replace(/\s*&\s*/g, ' ו-')
                    .replace(/\s*,\s*/g, ' ו-')
                    .replace(/\s+ו-\s+/g, ' ו-')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
            }
            if (field === 'scannedVia') {
                return normalizeIpList(v);
            }
            return v;
        };

        const importedNames = new Set(
            importedServers.map(s => s.name.toLowerCase())
        );

        for (const existing of this.allServers) {
            if (!importedNames.has(existing.name.toLowerCase())) {
                removed.push({ existing });
            }
        }

        for (const imported of importedServers) {
            const existing = this.allServers.find(
                s => s.name.toLowerCase() === imported.name.toLowerCase()
            );

            if (!existing) {
                added.push({ imported });
                continue;
            }

            const fieldChanges = [];

            for (const field of TRACKED_FIELDS) {
                const importedRaw = imported[field];

                const importedIsEmpty = importedRaw === undefined ||
                    importedRaw === null || importedRaw === '';
                const existingIsEmpty = !existing[field] ||
                    existing[field].toString().trim() === '';

                if (importedIsEmpty && !existingIsEmpty) continue;

                const oldNorm = normalizeForCompare(field, existing[field]);
                const newNorm = normalizeForCompare(field, importedRaw);

                if (oldNorm !== newNorm) {
                    fieldChanges.push({
                        field,
                        oldVal: this._toDisplayValue(field, existing[field]),
                        newVal: this._toDisplayValue(field, importedRaw),
                        label: this._getFieldLabel(field),
                        selected: true
                    });
                }
            }

            if (fieldChanges.length > 0) {
                changed.push({
                    imported,
                    existing,
                    fieldChanges,
                    serverSelected: true
                });
            } else {
                unchanged.push({ imported, existing });
            }
        }

        return { added, changed, unchanged, removed };
    }

    _toDisplayValue(field, value) {
        if (!value && value !== 0) return '';
        const v = value.toString().trim();

        if (field === 'isVirtual') {
            const norm = this._normalizeVirtual(v);
            if (norm === 'TRUE') return '☁️ וירטואלי';
            if (norm === 'FALSE') return '🖥️ פיזי';
            return '❓ לא ידוע';
        }

        return v;
    }

    async _applyImportChanges(diff, overwriteExisting, toDelete = [], selectedNewIndexes = null) {
        // ── מחק שרתים שסומנו ──
        if (toDelete && toDelete.length > 0) {
            const deleteSet = new Set(
                toDelete.map(n => n.toLowerCase())
            );
            this.allServers = this.allServers.filter(
                s => !deleteSet.has((s.name || '').toLowerCase())
            );
        }

        // ── הוסף שרתים חדשים - רק שנבחרו ──
        diff.added.forEach(({ imported }, idx) => {

            // ─── אם selectedNewIndexes הוגדר - בדוק אם נבחר ───
            if (selectedNewIndexes !== null &&
                !selectedNewIndexes.has(idx)) {
                return; // ← דלג על שרת זה
            }

            // ─── שמור isVirtual ריק אם לא הוגדר בקובץ ───
            const importedVirtual = (imported.isVirtual || '').trim();
            const normalizedVirtual = importedVirtual
                ? this._normalizeVirtual(importedVirtual)
                : '';  // ← ריק = לא ידוע, לא "פיזי"

            this.allServers.push({
                id: `srv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                ...imported,
                isVirtual: normalizedVirtual,
                importedAt: new Date().toISOString().split('T')[0],
                hasMappingData: false,
            });
        });

        // ── עדכן שרתים קיימים - רק שינויים נבחרים ──
        if (overwriteExisting) {
            for (const { imported, fieldChanges } of diff.changed) {

                const selectedChanges = fieldChanges.filter(fc => fc.selected);
                if (selectedChanges.length === 0) continue;

                const idx = this.allServers.findIndex(
                    s => s.name.toLowerCase() ===
                        imported.name.toLowerCase()
                );
                if (idx === -1) continue;

                const existing = this.allServers[idx];
                const merged = { ...existing };

                for (const fc of selectedChanges) {
                    const importedVal = imported[fc.field];
                    if (importedVal !== undefined &&
                        importedVal !== null &&
                        importedVal !== '') {
                        merged[fc.field] = importedVal;
                    }
                }

                const mergedVirtual = (merged.isVirtual || '').trim();
                this.allServers[idx] = {
                    ...merged,
                    isVirtual: mergedVirtual
                        ? this._normalizeVirtual(mergedVirtual)
                        : '',  // ← שמור ריק אם לא הוגדר
                    lastUpdated: new Date().toISOString().split('T')[0],
                };

            }
        }

        // ── שמור לשרת ──
        try {
            const res = await fetch('/Servers/SaveServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ servers: this.allServers })
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'שגיאה בשמירה לשרת');
            }
        } catch (err) {
            throw new Error(
                'השינויים עודכנו בזיכרון אך לא נשמרו לקובץ: ' +
                err.message
            );
        }
    }

    _showImportPreview(diff, fileName) {
        this._currentDiff = diff;
        return new Promise((resolve) => {

            const { added, changed, unchanged, removed } = diff;
            const total = added.length + changed.length + unchanged.length;

            const envBadge = (env) => {
                if (!env) return '';
                const cls = env === 'PROD' ? 'srv-badge-prod' : 'srv-badge-nonprod';
                return `<span class="srv-badge ${cls}">${this.escHtml(env)}</span>`;
            };

            const healthBadge = (h) => {
                if (!h) return '';
                const cls = this._getHealthClass(h);
                return `<span class="srv-badge ${cls}">${this.escHtml(h)}</span>`;
            };

            // ── בנה HTML שינויים לשרת ────────────────────────────
            // ── בנה HTML שינויים לשרת - עם checkbox לכל שינוי ──
            const buildChangesHtml = (fieldChanges, serverIdx) => {
                return fieldChanges.map((fc, fcIdx) => `
        <div class="srv-import-change-row"
             data-server-idx="${serverIdx}"
             data-field-idx="${fcIdx}">
            
            <!-- ← חדש: checkbox לכל שינוי -->
            <label class="srv-import-change-check-wrap"
                   title="${fc.selected
                        ? 'לחץ לביטול שינוי זה'
                        : 'לחץ להפעלת שינוי זה'}">
                <input type="checkbox"
                       class="srv-import-field-cb"
                       data-server-idx="${serverIdx}"
                       data-field-idx="${fcIdx}"
                       ${fc.selected ? 'checked' : ''}
                       onchange="window._srvDashboard
                           ._toggleFieldChange(
                               ${serverIdx}, ${fcIdx}, this.checked
                           )">
            </label>
            
            <span class="srv-import-field-label">
                ${this.escHtml(fc.label)}:
            </span>
            <span class="srv-import-old-val"
                title="${fc.oldVal ? this.escHtml(fc.oldVal) : '— ריק —'}">
                ${this.escHtml(fc.oldVal) || '<em>ריק</em>'}
            </span>
            <i class="fas fa-arrow-left srv-import-arrow"></i>
            <span class="srv-import-new-val
                        ${fc.selected ? '' : 'srv-import-new-val-disabled'}"
                title="${fc.newVal ? this.escHtml(fc.newVal) : '— ריק —'}">
                ${this.escHtml(fc.newVal) || '<em>ריק</em>'}
            </span>
        </div>
    `).join('');
            };

            // ── בנה שורות טבלה ───────────────────────────────────
            const buildTableRows = (items, type) => {
                if (items.length === 0) {
                    return `<tr>
                <td colspan="6" class="srv-import-empty-row">
                    אין שרתים בקטגוריה זו
                </td>
            </tr>`;
                }

                return items.map((item, i) => {

                    // ─── טיפול בשרתים שנמחקים ───
                    if (type === 'removed') {
                        const srv = item.existing;
                        return `
                    <tr class="srv-import-row srv-import-row-removed"
                        data-name="${this.escHtml(srv.name)}">
                        <td class="srv-import-td srv-import-td-icon">
                            <i class="fas fa-minus-circle"
                            style="color:#ef4444"></i>
                        </td>
                        <td class="srv-import-td" style="width:32px"></td>
                        <td class="srv-import-td srv-import-td-name">
                            <span title="${this.escHtml(srv.name)}">
                                ${this.escHtml(srv.name)}
                            </span>
                        </td>
                        <td class="srv-import-td">
                            ${envBadge(srv.environment)}
                        </td>
                        <td class="srv-import-td">
                            ${healthBadge(srv.isHealthy)}
                        </td>
                        <td class="srv-import-td srv-import-td-status">
                            <span class="srv-import-badge-removed">
                                לא בקובץ
                            </span>
                            <button class="srv-import-delete-btn"
                                    data-name="${this.escHtml(srv.name)}"
                                    title="מחק שרת זה">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </td>
                    </tr>`;
                    }

                    const srv = item.imported;
                    const rowClass = type === 'added'
                        ? 'srv-import-row-added'
                        : type === 'changed'
                            ? 'srv-import-row-changed'
                            : 'srv-import-row-unchanged';

                    const statusIcon = type === 'added'
                        ? '<i class="fas fa-plus-circle" style="color:#22c55e"></i>'
                        : type === 'changed'
                            ? '<i class="fas fa-edit" style="color:#f59e0b"></i>'
                            : '<i class="fas fa-check" style="color:#6b7280"></i>';

                    const statusLabel = type === 'added'
                        ? '<span class="srv-import-badge-new">חדש</span>'
                        : type === 'changed'
                            ? '<span class="srv-import-badge-changed">שונה</span>'
                            : '<span class="srv-import-badge-same">ללא שינוי</span>';

                    // ─── Checkbox לשרתים חדשים ───────────────────────────
                    const checkboxCell = type === 'added'
                        ? `<td class="srv-import-td srv-import-td-cb">
                <input type="checkbox"
                       class="srv-import-new-cb"
                       data-index="${i}"
                       checked
                       title="בחר/בטל שרת זה">
               </td>`
                        : `<td class="srv-import-td"></td>`;

                    // ─── שינויים מפורטים (לשרתים שהשתנו) ───────────────
                    const changesHtml = type === 'changed' && item.fieldChanges
                        ? `<tr class="srv-import-changes-detail-row"
            id="srv-changes-${type}-${i}"
            style="display:none">
            <td colspan="6" class="srv-import-changes-detail">
                <div class="srv-import-server-change-actions">
                    <button class="srv-import-select-all-fields-btn"
                            onclick="window._srvDashboard
                                ._toggleAllFieldChanges(${i}, true)">
                        <i class="fas fa-check-double"></i>
                        בחר הכל
                    </button>
                    <button class="srv-import-deselect-all-fields-btn"
                            onclick="window._srvDashboard
                                ._toggleAllFieldChanges(${i}, false)">
                        <i class="fas fa-times"></i>
                        בטל הכל
                    </button>
                    <span class="srv-import-selected-fields-count"
                          id="srvFieldCount_${i}">
                        ${item.fieldChanges.filter(f => f.selected).length}
                        / ${item.fieldChanges.length} שינויים נבחרו
                    </span>
                </div>
                ${buildChangesHtml(item.fieldChanges, i)}
            </td>
        </tr>`
                        : '';

                    const expandBtn = type === 'changed'
                        ? `<button class="srv-import-expand-btn"
                            onclick="
                                const r = document.getElementById(
                                    'srv-changes-${type}-${i}');
                                const isOpen = r.style.display !== 'none';
                                r.style.display = isOpen ? 'none' : 'table-row';
                                this.innerHTML = isOpen
                                    ? '<i class=\\'fas fa-chevron-down\\'></i>'
                                    : '<i class=\\'fas fa-chevron-up\\'></i>';
                            "
                            title="הצג שינויים">
                            <i class="fas fa-chevron-down"></i>
                        </button>`
                        : '';

                    return `
                    <tr class="srv-import-row ${rowClass}
                            ${type === 'added' ? 'srv-import-row-new-selectable' : ''}"
                        data-name="${this.escHtml(srv.name)}"
                        data-type="${type}"
                        data-index="${i}">
                        <td class="srv-import-td srv-import-td-icon">
                            ${statusIcon}
                        </td>
                        ${checkboxCell}
                        <td class="srv-import-td srv-import-td-name">
                            <span title="${this.escHtml(srv.name)}">
                                ${this.escHtml(srv.name)}
                            </span>
                        </td>
                        <td class="srv-import-td">
                            ${envBadge(srv.environment)}
                        </td>
                        <td class="srv-import-td">
                            ${healthBadge(srv.isHealthy)}
                        </td>
                        <td class="srv-import-td srv-import-td-status">
                            ${statusLabel}
                            ${expandBtn}
                        </td>
                    </tr>
                    ${changesHtml}
                `;
                }).join('');
            };

            // ─── בנה רשימת שמות לעתק ───
            const removedNamesList = removed.map(r => r.existing.name).join('\n');

            const modalHtml = `
        <div id="srvImportModal" class="srv-import-modal-overlay">
            <div class="srv-import-modal">

                <!-- כותרת -->
                <div class="srv-import-modal-header">
                    <div class="srv-import-modal-title-wrap">
                        <i class="fas fa-file-excel"></i>
                        <div>
                            <div class="srv-import-modal-title">
                                ייבוא שרתים מאקסל
                            </div>
                            <div class="srv-import-modal-subtitle">
                                ${this.escHtml(fileName)}
                            </div>
                        </div>
                    </div>
                    <button class="srv-import-modal-close"
                            onclick="
                                document.getElementById(
                                    'srvImportModal').remove();
                                window._srvImportResolve(null);">
                        &times;
                    </button>
                </div>

                <!-- סטטיסטיקות -->
                <div class="srv-import-stats-bar">
                    <div class="srv-import-stat srv-import-stat-total">
                        <i class="fas fa-server"></i>
                        <span>סה"כ בקובץ: <strong>${total}</strong></span>
                    </div>
                    <div class="srv-import-stat srv-import-stat-added">
                        <i class="fas fa-plus-circle"></i>
                        <span>חדשים: <strong>${added.length}</strong></span>
                    </div>
                    <div class="srv-import-stat srv-import-stat-changed">
                        <i class="fas fa-edit"></i>
                        <span>שינויים: <strong>${changed.length}</strong></span>
                    </div>
                    <div class="srv-import-stat srv-import-stat-same">
                        <i class="fas fa-check"></i>
                        <span>ללא שינוי: <strong>${unchanged.length}</strong></span>
                    </div>
                    ${removed.length > 0 ? `
                    <div class="srv-import-stat srv-import-stat-removed">
                        <i class="fas fa-minus-circle"></i>
                        <span>לא בקובץ: <strong>${removed.length}</strong></span>
                    </div>` : ''}
                </div>

                <!-- אפשרות דריסה -->
                ${changed.length > 0 ? `
                <div class="srv-import-overwrite-section">
                    <label class="srv-import-overwrite-label">
                        <input type="checkbox"
                               id="srvImportOverwrite"
                               class="srv-import-checkbox"
                               checked>
                        <span class="srv-import-overwrite-text">
                            <i class="fas fa-exclamation-triangle"
                               style="color:#f59e0b"></i>
                            דרוס שרתים קיימים עם שינויים
                            <span class="srv-import-overwrite-hint">
                                (${changed.length} שרתים ישתנו)
                            </span>
                        </span>
                    </label>
                </div>` : ''}

                <!-- אזהרה על שרתים חסרים -->
                ${removed.length > 0 ? `
                <div class="srv-import-removed-warning">
                    <i class="fas fa-exclamation-triangle"
                       style="color:#f59e0b"></i>
                    <span>
                        <strong>${removed.length} שרתים</strong>
                        קיימים ב-JSON אך לא מופיעים בקובץ זה.
                        ניתן למחוק אותם בטאב "לא בקובץ".
                    </span>
                    <button class="srv-import-copy-removed-btn"
                            id="srvCopyRemovedBtn"
                            title="העתק רשימת שמות">
                        <i class="fas fa-copy"></i>
                        העתק רשימה
                    </button>
                </div>` : ''}

                <!-- טאבים -->
                <div class="srv-import-tabs">
                    <button class="srv-import-tab active"
                            id="srvImportTabAll"
                            onclick="window._srvSwitchTab('all')">
                        הכל (${total})
                    </button>
                    <button class="srv-import-tab srv-import-tab-added"
                            id="srvImportTabAdded"
                            onclick="window._srvSwitchTab('added')">
                        <i class="fas fa-plus-circle"></i>
                        חדשים (${added.length})
                    </button>
                    <button class="srv-import-tab srv-import-tab-changed"
                            id="srvImportTabChanged"
                            onclick="window._srvSwitchTab('changed')">
                        <i class="fas fa-edit"></i>
                        שינויים (${changed.length})
                    </button>
                    <button class="srv-import-tab srv-import-tab-same"
                            id="srvImportTabSame"
                            onclick="window._srvSwitchTab('unchanged')">
                        <i class="fas fa-check"></i>
                        ללא שינוי (${unchanged.length})
                    </button>
                    ${removed.length > 0 ? `
                    <button class="srv-import-tab srv-import-tab-removed"
                            id="srvImportTabRemoved"
                            onclick="window._srvSwitchTab('removed')">
                        <i class="fas fa-minus-circle"></i>
                        לא בקובץ (${removed.length})
                    </button>` : ''}
                </div>

                <!-- טבלה -->
                <div class="srv-import-table-wrap">
                    <table class="srv-import-table">
                        <thead>
                            <tr>
                                <th class="srv-import-th"
                                    style="width:36px"></th>
                                <th class="srv-import-th srv-import-th-cb"
                                    style="width:36px"
                                    title="בחר/בטל הכל (שרתים חדשים)">
                                    <input type="checkbox"
                                        id="srvImportNewSelectAll"
                                        checked
                                        title="בחר/בטל כל השרתים החדשים"
                                        style="accent-color:#22c55e;
                                                width:14px;height:14px;
                                                cursor:pointer">
                                </th>
                                <th class="srv-import-th">שם שרת</th>
                                <th class="srv-import-th">סביבה</th>
                                <th class="srv-import-th">תקינות</th>
                                <th class="srv-import-th">סטטוס</th>
                            </tr>
                        </thead>
                        <tbody id="srvImportTbody">
                            ${buildTableRows(added, 'added')}
                            ${buildTableRows(changed, 'changed')}
                            ${buildTableRows(unchanged, 'unchanged')}
                            ${buildTableRows(removed, 'removed')}
                        </tbody>
                    </table>
                </div>

                <!-- כפתורי פעולה -->
                <div class="srv-import-footer">
                    <div class="srv-import-footer-info" id="srvImportFooterInfo">
                        ${added.length > 0 || changed.length > 0
                    ? `<i class="fas fa-info-circle"
                                    style="color:#6366f1"></i>
                                יתווספו <strong id="srvImportAddedCount"
                                                style="color:#22c55e">
                                    ${added.length}
                                </strong> שרתים חדשים
                                ${changed.length > 0
                        ? `ו-<strong style="color:#f59e0b">
                                            ${changed.length}
                                        </strong> ישתנו (בכפוף לבחירה)`
                        : ''}`
                    : `<i class="fas fa-info-circle"
                                    style="color:#888"></i>
                                אין שינויים לייבוא`
                }
                    </div>
                    <div class="srv-import-footer-btns">
                        <button class="srv-import-cancel-btn"
                                onclick="
                                    document.getElementById(
                                        'srvImportModal').remove();
                                    window._srvImportResolve(null);">
                            <i class="fas fa-times"></i> ביטול
                        </button>
                        <!-- ← חדש: כפתור ייצוא שינויים -->
                        <button class="srv-import-export-changes-btn"
                                id="srvExportChangesBtn"
                                title="ייצא את השינויים הצפויים לאקסל"
                                ${added.length === 0 && changed.length === 0
                    ? 'disabled' : ''}>
                            <i class="fas fa-file-excel"></i>
                            ייצא שינויים
                        </button>
                        <button class="srv-import-confirm-btn"
                                ${added.length === 0 && changed.length === 0
                    ? 'disabled' : ''}
                                id="srvImportConfirmBtn">
                            <i class="fas fa-file-import"></i>
                            ייבא
                            ${added.length > 0 ? `${added.length} חדשים` : ''}
                            ${added.length > 0 && changed.length > 0 ? '+' : ''}
                            ${changed.length > 0 ? `${changed.length} שינויים` : ''}
                        </button>
                    </div>
                </div>

            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHtml);
            window._srvImportResolve = resolve;

            // ─── בחר/בטל הכל - שרתים חדשים ───────────────────────────
            const newSelectAll = document.getElementById('srvImportNewSelectAll');
            if (newSelectAll) {
                newSelectAll.addEventListener('change', () => {
                    document.querySelectorAll('.srv-import-new-cb')
                        .forEach(cb => {
                            cb.checked = newSelectAll.checked;
                            const row = cb.closest('tr.srv-import-row');
                            if (row) {
                                row.classList.toggle(
                                    'srv-import-row-new-deselected',
                                    !newSelectAll.checked
                                );
                            }
                        });
                    _updateNewAddedCount();
                    _updateImportConfirmBtnLocal();
                });
            }

            // ─── שינוי checkbox בודד - שרת חדש ───────────────────────
            document.getElementById('srvImportTbody')
                .addEventListener('change', e => {
                    const cb = e.target.closest('.srv-import-new-cb');
                    if (!cb) return;

                    const row = cb.closest('tr.srv-import-row');
                    if (row) {
                        row.classList.toggle(
                            'srv-import-row-new-deselected', !cb.checked
                        );
                    }

                    // ─── עדכן "בחר הכל" ───
                    const allCbs = document.querySelectorAll('.srv-import-new-cb');
                    const checkedCbs = document.querySelectorAll(
                        '.srv-import-new-cb:checked'
                    );
                    if (newSelectAll) {
                        newSelectAll.checked = checkedCbs.length === allCbs.length;
                        newSelectAll.indeterminate =
                            checkedCbs.length > 0 &&
                            checkedCbs.length < allCbs.length;
                    }

                    _updateNewAddedCount();
                    _updateImportConfirmBtnLocal();
                });

            // ─── עדכן מונה שרתים חדשים נבחרים ────────────────────────
            const _updateNewAddedCount = () => {
                const checked = document.querySelectorAll(
                    '.srv-import-new-cb:checked'
                ).length;
                const countEl = document.getElementById('srvImportAddedCount');
                if (countEl) countEl.textContent = checked;
            };

            // ─── עדכן כפתור אישור ─────────────────────────────────────
            const _updateImportConfirmBtnLocal = () => {
                const checkedNew = document.querySelectorAll(
                    '.srv-import-new-cb:checked'
                ).length;

                const changedCount = diff.changed.filter(item =>
                    item.fieldChanges.some(fc => fc.selected)
                ).length;

                const btn = document.getElementById('srvImportConfirmBtn');
                if (!btn) return;

                btn.disabled = checkedNew === 0 && changedCount === 0;

                const parts = [];
                if (checkedNew > 0) parts.push(`${checkedNew} חדשים`);
                if (changedCount > 0) parts.push(`${changedCount} שינויים`);

                btn.innerHTML = `
                    <i class="fas fa-file-import"></i>
                    ייבא ${parts.join(' + ') || ''}
                `;
            };

            // ─── הגדר confirmBtn לפני השימוש ──────────────────────────
            const confirmBtn = document.getElementById('srvImportConfirmBtn');

            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    const ow = document.getElementById('srvImportOverwrite');

                    // ─── אסוף שרתים שסומנו למחיקה ───
                    const toDelete = [];
                    document.querySelectorAll(
                        '.srv-import-delete-btn.marked-for-delete'
                    ).forEach(btn => {
                        toDelete.push(btn.dataset.name);
                    });

                    // ─── אסוף שרתים חדשים שנבחרו ───
                    const selectedNewIndexes = new Set();
                    document.querySelectorAll('.srv-import-new-cb:checked')
                        .forEach(cb => {
                            selectedNewIndexes.add(parseInt(cb.dataset.index));
                        });

                    window._srvImportResolve({
                        overwriteExisting: ow ? ow.checked : false,
                        toDelete,
                        selectedNewIndexes
                    });
                    document.getElementById('srvImportModal').remove();
                });
            }

            const exportChangesBtn = document.getElementById('srvExportChangesBtn');
            if (exportChangesBtn) {
                exportChangesBtn.addEventListener('click', () => {
                    this._exportChangesToExcel(diff, fileName);
                });
            }

            // ─── כפתור העתקת רשימה ───
            const copyBtn = document.getElementById('srvCopyRemovedBtn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(removedNamesList)
                        .then(() => {
                            copyBtn.innerHTML =
                                '<i class="fas fa-check"></i> הועתק!';
                            copyBtn.style.color = '#86efac';
                            setTimeout(() => {
                                copyBtn.innerHTML =
                                    '<i class="fas fa-copy"></i> העתק רשימה';
                                copyBtn.style.color = '';
                            }, 2000);
                        })
                        .catch(() => {
                            // fallback
                            const ta = document.createElement('textarea');
                            ta.value = removedNamesList;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            copyBtn.innerHTML =
                                '<i class="fas fa-check"></i> הועתק!';
                            setTimeout(() => {
                                copyBtn.innerHTML =
                                    '<i class="fas fa-copy"></i> העתק רשימה';
                            }, 2000);
                        });
                });
            }

            // ─── כפתורי מחיקה בודדים ───
            document.getElementById('srvImportTbody')
                .addEventListener('click', e => {
                    const deleteBtn = e.target.closest(
                        '.srv-import-delete-btn'
                    );
                    if (deleteBtn) {
                        const isMarked = deleteBtn.classList.contains(
                            'marked-for-delete'
                        );
                        deleteBtn.classList.toggle(
                            'marked-for-delete', !isMarked
                        );
                        const row = deleteBtn.closest('tr');
                        if (row) {
                            row.classList.toggle(
                                'srv-import-row-delete-marked', !isMarked
                            );
                        }
                        deleteBtn.title = isMarked
                            ? 'מחק שרת זה'
                            : 'בטל מחיקה';
                        deleteBtn.innerHTML = isMarked
                            ? '<i class="fas fa-trash-alt"></i>'
                            : '<i class="fas fa-undo"></i>';

                        // ─── עדכן מונה מחיקות ───
                        const markedCount = document.querySelectorAll(
                            '.srv-import-delete-btn.marked-for-delete'
                        ).length;
                        const confirmBtnEl = document.getElementById(
                            'srvImportConfirmBtn'
                        );
                        if (confirmBtnEl && markedCount > 0) {
                            confirmBtnEl.disabled = false;
                        }
                    }
                });

            // ─── פונקציית החלפת טאב ───
            window._srvSwitchTab = (tab) => {
                ['All', 'Added', 'Changed', 'Same', 'Removed'].forEach(t => {
                    const btn = document.getElementById(`srvImportTab${t}`);
                    if (btn) btn.classList.remove('active');
                });

                const activeMap = {
                    all: 'All', added: 'Added',
                    changed: 'Changed', unchanged: 'Same',
                    removed: 'Removed'
                };
                const activeBtn = document.getElementById(
                    `srvImportTab${activeMap[tab]}`
                );
                if (activeBtn) activeBtn.classList.add('active');

                const tbody = document.getElementById('srvImportTbody');
                if (!tbody) return;

                tbody.querySelectorAll('tr.srv-import-row').forEach(row => {
                    if (tab === 'all') {
                        row.style.display = '';
                    } else if (tab === 'added') {
                        row.style.display = row.classList.contains(
                            'srv-import-row-added') ? '' : 'none';
                    } else if (tab === 'changed') {
                        row.style.display = row.classList.contains(
                            'srv-import-row-changed') ? '' : 'none';
                    } else if (tab === 'unchanged') {
                        row.style.display = row.classList.contains(
                            'srv-import-row-unchanged') ? '' : 'none';
                    } else if (tab === 'removed') {
                        row.style.display = row.classList.contains(
                            'srv-import-row-removed') ? '' : 'none';
                    }
                });

                tbody.querySelectorAll(
                    '.srv-import-changes-detail-row'
                ).forEach(row => {
                    if (tab !== 'all' && tab !== 'changed') {
                        row.style.display = 'none';
                    }
                });
            };
        });
    }

    // ══════════════════════════════════════════════════════════
    // ייצוא שינויים צפויים לאקסל
    // ══════════════════════════════════════════════════════════
    async _exportChangesToExcel(diff, sourceFileName) {
        try {
            const exportBtn = document.getElementById('srvExportChangesBtn');
            if (exportBtn) {
                exportBtn.disabled = true;
                exportBtn.innerHTML =
                    '<i class="fas fa-spinner fa-spin"></i> מייצא...';
            }

            // ── טען ExcelJS ──
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
            wb.creator = 'ServersDashboard';
            wb.created = new Date();

            // ══════════════════════════════════════════════════
            // גיליון 1: סיכום שינויים
            // ══════════════════════════════════════════════════
            const wsSummary = wb.addWorksheet('סיכום שינויים', {
                views: [{ rightToLeft: true }]
            });

            wsSummary.columns = [
                { header: 'קטגוריה', key: 'category', width: 28 },
                { header: 'כמות', key: 'count', width: 10 },
                { header: 'פרטים', key: 'details', width: 80 },
            ];

            // ── עיצוב כותרות ──
            const summaryHeaderRow = wsSummary.getRow(1);
            summaryHeaderRow.height = 28;
            summaryHeaderRow.eachCell(cell => {
                cell.font = {
                    name: 'Calibri', size: 12,
                    bold: true, color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF1e3a5f' }
                };
                cell.alignment = {
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2, wrapText: false
                };
                cell.border = {
                    bottom: { style: 'medium', color: { argb: 'FF3b82f6' } }
                };
            });

            // ── נתוני סיכום ──
            const summaryData = [
                {
                    category: 'שרתים חדשים',
                    count: diff.added.length,
                    details: this._sanitizeForExcel(
                        diff.added.map(a => a.imported.name).join(', ')
                    )
                },
                {
                    category: 'שרתים שישתנו',
                    count: diff.changed.length,
                    details: this._sanitizeForExcel(
                        diff.changed.map(c => c.imported.name).join(', ')
                    )
                },
                {
                    category: 'ללא שינוי',
                    count: diff.unchanged.length,
                    details: `${diff.unchanged.length} שרתים לא ישתנו`
                },
                {
                    category: 'לא בקובץ',
                    count: diff.removed.length,
                    details: this._sanitizeForExcel(
                        diff.removed.map(r => r.existing.name).join(', ')
                    )
                },
            ];

            // ── צבעים נעימים - בהירים יותר ──
            const summaryStyles = [
                {   // ירוק - שרתים חדשים
                    rowBg: 'FFe8f5e9',   // ירוק בהיר מאוד
                    catBg: 'FF2e7d32',   // ירוק כהה
                    catFg: 'FFFFFFFF',
                    countBg: 'FF43a047',   // ירוק בינוני
                    countFg: 'FFFFFFFF',
                    detailFg: 'FF1b5e20',   // ירוק כהה לטקסט
                },
                {   // כתום/צהוב - שינויים
                    rowBg: 'FFfff8e1',   // צהוב בהיר מאוד
                    catBg: 'FFf57f17',   // כתום כהה
                    catFg: 'FFFFFFFF',
                    countBg: 'FFfb8c00',   // כתום בינוני
                    countFg: 'FFFFFFFF',
                    detailFg: 'FFe65100',   // כתום כהה לטקסט
                },
                {   // כחול-אפור - ללא שינוי
                    rowBg: 'FFf3f4f6',   // אפור בהיר מאוד
                    catBg: 'FF455a64',   // אפור-כחול כהה
                    catFg: 'FFFFFFFF',
                    countBg: 'FF607d8b',   // אפור-כחול בינוני
                    countFg: 'FFFFFFFF',
                    detailFg: 'FF37474f',   // אפור כהה לטקסט
                },
                {   // אדום - לא בקובץ
                    rowBg: 'FFfce4ec',   // ורוד בהיר מאוד
                    catBg: 'FFc62828',   // אדום כהה
                    catFg: 'FFFFFFFF',
                    countBg: 'FFe53935',   // אדום בינוני
                    countFg: 'FFFFFFFF',
                    detailFg: 'FF880e4f',   // אדום-כהה לטקסט
                },
            ];

            summaryData.forEach((rowData, idx) => {
                const r = wsSummary.addRow(rowData);
                const st = summaryStyles[idx];

                // ── גובה שורה לפי אורך הפרטים ──
                const detailsLen = (rowData.details || '').length;
                r.height = detailsLen > 200 ? 60
                    : detailsLen > 100 ? 40
                        : 26;

                // ── עמודת קטגוריה ──
                const catCell = r.getCell('category');
                catCell.font = {
                    name: 'Calibri', size: 11,
                    bold: true, color: { argb: st.catFg }
                };
                catCell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: st.catBg }
                };
                catCell.alignment = {
                    horizontal: 'right', vertical: 'middle',
                    readingOrder: 2
                };
                catCell.border = {
                    right: { style: 'medium', color: { argb: 'FFFFFFFF' } },
                    bottom: { style: 'thin', color: { argb: 'FFe0e0e0' } }
                };

                // ── עמודת כמות ──
                const countCell = r.getCell('count');
                countCell.font = {
                    name: 'Calibri', size: 13,
                    bold: true, color: { argb: st.countFg }
                };
                countCell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: st.countBg }
                };
                countCell.alignment = {
                    horizontal: 'center', vertical: 'middle'
                };
                countCell.border = {
                    right: { style: 'medium', color: { argb: 'FFFFFFFF' } },
                    bottom: { style: 'thin', color: { argb: 'FFe0e0e0' } }
                };

                // ── עמודת פרטים ──
                const detailCell = r.getCell('details');
                detailCell.font = {
                    name: 'Calibri', size: 10,
                    color: { argb: st.detailFg }
                };
                detailCell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: st.rowBg }
                };
                detailCell.alignment = {
                    horizontal: 'right', vertical: 'middle',
                    readingOrder: 2,
                    wrapText: true          // ← גלישת טקסט בעמודת פרטים
                };
                detailCell.border = {
                    bottom: { style: 'thin', color: { argb: 'FFe0e0e0' } }
                };
            });

            // ── שורה ריקה מפרידה ──
            wsSummary.addRow([]);

            // ── שורת מידע על הקובץ ──
            // ── שורת קובץ מקור ──
            const infoRow = wsSummary.addRow({
                category: 'קובץ מקור',
                count: '',
                details: this._sanitizeForExcel(sourceFileName || 'לא ידוע')
            });
            infoRow.height = 20;
            ['category', 'count', 'details'].forEach(key => {
                const cell = infoRow.getCell(key);
                cell.font = {
                    name: 'Calibri', size: 10,
                    italic: true,
                    color: { argb: 'FF455a64' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FFe3f2fd' }
                };
                cell.alignment = {
                    horizontal: key === 'count' ? 'center' : 'right',
                    vertical: 'middle', readingOrder: 2
                };
            });

            // ── שורת תאריך ──
            const dateRow = wsSummary.addRow({
                category: 'תאריך ייצוא',
                count: '',
                details: new Date().toLocaleString('he-IL')
            });
            dateRow.height = 20;
            ['category', 'count', 'details'].forEach(key => {
                const cell = dateRow.getCell(key);
                cell.font = {
                    name: 'Calibri', size: 10,
                    italic: true,
                    color: { argb: 'FF455a64' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FFe3f2fd' }
                };
                cell.alignment = {
                    horizontal: key === 'count' ? 'center' : 'right',
                    vertical: 'middle', readingOrder: 2
                };
            });

            // ══════════════════════════════════════════════════
            // גיליון 2: שרתים חדשים
            // ══════════════════════════════════════════════════
            const wsAdded = wb.addWorksheet('שרתים חדשים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            wsAdded.columns = [
                { header: 'שם שרת', key: 'name', width: 25 },
                { header: 'סביבה', key: 'environment', width: 12 },
                { header: 'סוג', key: 'isVirtual', width: 14 },
                { header: 'מערכת הפעלה', key: 'os', width: 28 },
                { header: 'שם מערכת', key: 'systemName', width: 22 },
                { header: 'מספר קטלוג', key: 'catalogNumber', width: 16 },
                { header: 'סטטוס מערכת', key: 'systemStatus', width: 14 },
                { header: 'מנהל מערכת', key: 'systemManager', width: 20 },
                { header: 'צוות', key: 'team', width: 18 },
                { header: 'מחלקה', key: 'department', width: 22 },
                { header: 'תחום', key: 'domain', width: 18 },
                { header: 'סוג אתחול', key: 'bootType', width: 14 },
                { header: 'ניתן לכבות', key: 'canShutdown', width: 12 },
                { header: 'כתובת IP', key: 'scannedVia', width: 16 },
                { header: 'תקינות', key: 'isHealthy', width: 12 },
                { header: 'הערות', key: 'notes', width: 30 },
                { header: 'יצרן חומרה', key: 'hardwareVendor', width: 18 },
            ];
            if (diff.added.length === 0) {
                const emptyRow = wsAdded.addRow({ name: 'אין שרתים חדשים לייבוא' });
                emptyRow.getCell('name').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF6b7280' } };
                emptyRow.getCell('name').alignment = { horizontal: 'center', readingOrder: 2 };
            } else {

                // ── עיצוב כותרות ──
                this._styleExcelHeader(wsAdded, 'FF166534'); // ירוק כהה

                // ── נתונים ──
                diff.added.forEach((item, idx) => {
                    const s = item.imported;
                    const row = wsAdded.addRow({
                        name: this._sanitizeForExcel(s.name),
                        environment: this._sanitizeForExcel(s.environment),
                        isVirtual: (() => {
                            const norm = this._normalizeVirtual(s.isVirtual);
                            if (norm === 'TRUE') return 'וירטואלי';
                            if (norm === 'FALSE') return 'פיזי';
                            return '';
                        })(),
                        os: this._sanitizeForExcel(s.os),
                        systemName: this._sanitizeForExcel(s.systemName),
                        catalogNumber: this._sanitizeForExcel(s.catalogNumber),
                        systemStatus: this._sanitizeForExcel(s.systemStatus),
                        systemManager: this._sanitizeForExcel(s.systemManager),
                        team: this._sanitizeForExcel(s.team),
                        department: this._sanitizeForExcel(s.department),
                        domain: this._sanitizeForExcel(s.domain),
                        bootType: this._sanitizeForExcel(s.bootType),
                        canShutdown: this._sanitizeForExcel(s.canShutdown),
                        scannedVia: this._sanitizeForExcel(s.scannedVia),
                        isHealthy: this._sanitizeForExcel(s.isHealthy),
                        notes: this._sanitizeForExcel(s.notes),
                        hardwareVendor: this._sanitizeForExcel(s.hardwareVendor),
                    });

                    row.height = 16;
                    const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFf0fdf4';

                    row.eachCell(cell => {
                        cell.font = { name: 'Arial', size: 10 };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: rowBg }
                        };
                        cell.alignment = {
                            horizontal: 'center', vertical: 'middle',
                            readingOrder: 2
                        };
                        cell.border = {
                            bottom: {
                                style: 'thin',
                                color: { argb: 'FFe2e8f0' }
                            }
                        };
                    });

                    // ── צבע סביבה ──
                    const envCell = row.getCell('environment');
                    if (s.environment === 'PROD') {
                        envCell.font = {
                            name: 'Arial', size: 10,
                            bold: true, color: { argb: 'FF991b1b' }
                        };
                    }
                });
            }

            // ══════════════════════════════════════════════════
            // גיליון 3: שינויים בשרתים קיימים
            // ══════════════════════════════════════════════════
            const wsChanged = wb.addWorksheet('שינויים בשרתים קיימים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });
            wsChanged.columns = [
                { header: 'שם שרת', key: 'name', width: 25 },
                { header: 'שדה', key: 'field', width: 18 },
                { header: 'ערך נוכחי', key: 'oldVal', width: 30 },
                { header: 'ערך חדש', key: 'newVal', width: 30 },
                { header: 'נבחר לעדכון', key: 'selected', width: 14 },
                { header: 'סביבה', key: 'environment', width: 12 },
            ];
            if (diff.changed.length === 0) {
                const emptyRow = wsChanged.addRow({ name: 'אין שינויים בשרתים קיימים' });
                emptyRow.getCell('name').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF6b7280' } };
                emptyRow.getCell('name').alignment = { horizontal: 'center', readingOrder: 2 };
            } else {


                // ── עיצוב כותרות ──
                this._styleExcelHeader(wsChanged, 'FF78350f'); // כתום כהה

                // ── נתונים ──
                let rowIdx = 0;
                diff.changed.forEach(item => {
                    const serverName = item.imported.name;
                    const env = item.imported.environment || '';

                    item.fieldChanges.forEach(fc => {
                        const row = wsChanged.addRow({
                            name: this._sanitizeForExcel(serverName),
                            field: this._sanitizeForExcel(fc.label || fc.field),
                            oldVal: this._sanitizeForExcel(fc.oldVal),
                            newVal: this._sanitizeForExcel(fc.newVal),
                            selected: fc.selected ? 'כן' : 'לא',
                            environment: this._sanitizeForExcel(env),
                        });

                        row.height = 16;
                        const rowBg = rowIdx % 2 === 0 ? 'FFFFFFFF' : 'FFfffbeb';

                        row.eachCell(cell => {
                            cell.font = { name: 'Arial', size: 10 };
                            cell.fill = {
                                type: 'pattern', pattern: 'solid',
                                fgColor: { argb: rowBg }
                            };
                            cell.alignment = {
                                horizontal: 'center', vertical: 'middle',
                                readingOrder: 2
                            };
                            cell.border = {
                                bottom: {
                                    style: 'thin',
                                    color: { argb: 'FFe2e8f0' }
                                }
                            };
                        });

                        // ── ערך ישן - אדום ──
                        const oldCell = row.getCell('oldVal');
                        oldCell.font = {
                            name: 'Arial', size: 10,
                            color: { argb: 'FFdc2626' },
                            strikethrough: true
                        };

                        // ── ערך חדש - ירוק ──
                        const newCell = row.getCell('newVal');
                        newCell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: { argb: fc.selected ? 'FF16a34a' : 'FF6b7280' }
                        };

                        // ── נבחר ──
                        const selCell = row.getCell('selected');
                        selCell.font = {
                            name: 'Arial', size: 10,
                            bold: true,
                            color: {
                                argb: fc.selected ? 'FF16a34a' : 'FFdc2626'
                            }
                        };

                        // ── סביבה ──
                        const envCell = row.getCell('environment');
                        if (env === 'PROD') {
                            envCell.font = {
                                name: 'Arial', size: 10,
                                bold: true, color: { argb: 'FF991b1b' }
                            };
                        }

                        rowIdx++;
                    });
                });
            }

            // ══════════════════════════════════════════════════
            // גיליון 4: שרתים שלא בקובץ (אם יש)
            // ══════════════════════════════════════════════════
            const wsRemoved = wb.addWorksheet('לא בקובץ שהועלה', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            wsRemoved.columns = [
                { header: 'שם שרת', key: 'name', width: 25 },
                { header: 'סביבה', key: 'environment', width: 12 },
                { header: 'שם מערכת', key: 'systemName', width: 22 },
                { header: 'מנהל מערכת', key: 'systemManager', width: 20 },
                { header: 'מחלקה', key: 'department', width: 22 },
                { header: 'תקינות', key: 'isHealthy', width: 12 },
                { header: 'הערות', key: 'notes', width: 30 },
            ];
            if (diff.removed.length === 0) {
                const emptyRow = wsRemoved.addRow({ name: 'כל השרתים מופיעים בקובץ' });
                emptyRow.getCell('name').font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF6b7280' } };
                emptyRow.getCell('name').alignment = { horizontal: 'center', readingOrder: 2 };
            } else {

                // ── עיצוב כותרות ──
                this._styleExcelHeader(wsRemoved, 'FF7f1d1d'); // אדום כהה

                // ── נתונים ──
                diff.removed.forEach((item, idx) => {
                    const s = item.existing;
                    const row = wsRemoved.addRow({
                        name: this._sanitizeForExcel(s.name),
                        environment: this._sanitizeForExcel(s.environment),
                        systemName: this._sanitizeForExcel(s.systemName),
                        systemManager: this._sanitizeForExcel(s.systemManager),
                        department: this._sanitizeForExcel(s.department),
                        isHealthy: this._sanitizeForExcel(s.isHealthy),
                        notes: this._sanitizeForExcel(s.notes),
                    });

                    row.height = 16;
                    const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFfff1f2';

                    row.eachCell(cell => {
                        cell.font = {
                            name: 'Arial', size: 10,
                            color: { argb: 'FF6b7280' }
                        };
                        cell.fill = {
                            type: 'pattern', pattern: 'solid',
                            fgColor: { argb: rowBg }
                        };
                        cell.alignment = {
                            horizontal: 'center', vertical: 'middle',
                            readingOrder: 2
                        };
                        cell.border = {
                            bottom: {
                                style: 'thin',
                                color: { argb: 'FFe2e8f0' }
                            }
                        };
                    });
                });
            }

            // ── הורד ──
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });

            const date = new Date().toISOString().split('T')[0];
            const baseName = (sourceFileName || 'import')
                .replace(/\.[^.]+$/, '');
            // ─── נקה שם קובץ מתווים לא חוקיים ───
            const cleanBaseName = (sourceFileName || 'import')
                .replace(/\.[^.]+$/, '')
                .replace(/[^\w\u0590-\u05FF\s\-_.]/g, '')
                .trim() || 'import';

            saveAs(blob, `changes_preview_${cleanBaseName}_${date}.xlsx`);

            this.showToast(
                `📊 ייוצאו ${diff.added.length} חדשים + ` +
                `${diff.changed.length} שינויים`,
                'success'
            );

        } catch (err) {
            console.error('_exportChangesToExcel error:', err);
            this.showToast('שגיאה בייצוא: ' + err.message, 'error');
        } finally {
            const exportBtn = document.getElementById('srvExportChangesBtn');
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML =
                    '<i class="fas fa-file-excel"></i> ייצא שינויים';
            }
        }
    }

    // ── עזר: עיצוב כותרות גיליון ──────────────────────────────────
    _styleExcelHeader(worksheet, headerColor = 'FF4a1a8c') {
        const headerRow = worksheet.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell(cell => {
            cell.font = {
                name: 'Arial', size: 11,
                bold: true, color: { argb: 'FFFFFFFF' }
            };
            cell.fill = {
                type: 'pattern', pattern: 'solid',
                fgColor: { argb: headerColor }
            };
            cell.alignment = {
                horizontal: 'center', vertical: 'middle',
                readingOrder: 2
            };
            cell.border = {
                bottom: {
                    style: 'medium',
                    color: { argb: 'FFffffff' }
                }
            };
        });
    }

    // ── Toggle שינוי שדה בודד ──
    _toggleFieldChange(serverIdx, fieldIdx, isChecked) {
        if (!this._currentDiff) return;

        const item = this._currentDiff.changed[serverIdx];
        if (!item || !item.fieldChanges[fieldIdx]) return;

        item.fieldChanges[fieldIdx].selected = isChecked;

        // ── עדכן מונה ──
        this._updateFieldChangeCounter(serverIdx, item);

        // ── עדכן מראה השורה ──
        const newValEl = document.querySelector(
            `.srv-import-change-row[data-server-idx="${serverIdx}"]` +
            `[data-field-idx="${fieldIdx}"] .srv-import-new-val`
        );
        if (newValEl) {
            newValEl.classList.toggle(
                'srv-import-new-val-disabled', !isChecked
            );
        }

        // ── עדכן badge של השרת ──
        this._updateServerChangeBadge(serverIdx, item);

        // ── עדכן כפתור אישור ──
        this._updateImportConfirmBtn();
    }

    // ── Toggle כל השינויים של שרת ──
    _toggleAllFieldChanges(serverIdx, isChecked) {
        if (!this._currentDiff) return;

        const item = this._currentDiff.changed[serverIdx];
        if (!item) return;

        item.fieldChanges.forEach(fc => { fc.selected = isChecked; });

        // ── עדכן כל checkboxes ──
        document.querySelectorAll(
            `.srv-import-field-cb[data-server-idx="${serverIdx}"]`
        ).forEach(cb => { cb.checked = isChecked; });

        // ── עדכן מראה ──
        document.querySelectorAll(
            `.srv-import-change-row[data-server-idx="${serverIdx}"]` +
            ` .srv-import-new-val`
        ).forEach(el => {
            el.classList.toggle('srv-import-new-val-disabled', !isChecked);
        });

        this._updateFieldChangeCounter(serverIdx, item);
        this._updateServerChangeBadge(serverIdx, item);
        this._updateImportConfirmBtn();
    }

    // ── עדכן מונה שדות ──
    _updateFieldChangeCounter(serverIdx, item) {
        const countEl = document.getElementById(
            `srvFieldCount_${serverIdx}`
        );
        if (!countEl) return;

        const selected = item.fieldChanges.filter(f => f.selected).length;
        const total = item.fieldChanges.length;
        countEl.textContent = `${selected} / ${total} שינויים נבחרו`;
        countEl.style.color = selected === 0 ? '#f87171' : '#86efac';
    }

    // ── עדכן badge שינויים של שרת ──
    _updateServerChangeBadge(serverIdx, item) {
        const selected = item.fieldChanges.filter(f => f.selected).length;
        const total = item.fieldChanges.length;

        // מצא את השורה של השרת
        const rows = document.querySelectorAll(
            `tr.srv-import-row.srv-import-row-changed`
        );
        const row = rows[serverIdx];
        if (!row) return;

        const badge = row.querySelector('.srv-import-badge-changed');
        if (badge) {
            if (selected === 0) {
                badge.innerHTML = `<i class="fas fa-ban"></i> מדולג`;
                badge.style.background = 'rgba(107,114,128,0.15)';
                badge.style.color = '#9ca3af';
                badge.style.borderColor = 'rgba(107,114,128,0.3)';
            } else if (selected < total) {
                badge.innerHTML =
                    `<i class="fas fa-edit"></i> ${selected}/${total} שינויים`;
                badge.style.background = 'rgba(245,158,11,0.15)';
                badge.style.color = '#fcd34d';
                badge.style.borderColor = 'rgba(245,158,11,0.3)';
            } else {
                badge.innerHTML =
                    `<i class="fas fa-edit"></i> שונה (${total})`;
                badge.style.background = '';
                badge.style.color = '';
                badge.style.borderColor = '';
            }
        }
    }

    // ── עדכן כפתור אישור ──
    _updateImportConfirmBtn() {
        if (!this._currentDiff) return;

        const diff = this._currentDiff;
        const addedCount = diff.added.length;
        const changedCount = diff.changed.filter(item =>
            item.fieldChanges.some(fc => fc.selected)
        ).length;

        const btn = document.getElementById('srvImportConfirmBtn');
        if (!btn) return;

        btn.disabled = addedCount === 0 && changedCount === 0;

        const parts = [];
        if (addedCount > 0) parts.push(`${addedCount} חדשים`);
        if (changedCount > 0) parts.push(`${changedCount} שינויים`);

        btn.innerHTML = `
        <i class="fas fa-file-import"></i>
        ייבא ${parts.join(' + ') || ''}
    `;
    }

    // ══════════════════════════════════════════════════════════
    // מצא שרתים חסרים ב-JSON והצג פופאפ אישור
    // ══════════════════════════════════════════════════════════
    async findAndAddMissingServers() {
        try {
            this.showToast('מחפש שרתים חסרים...', 'info');

            // ── שלב 1: קבל רשימת חסרים מהשרת ──────────────────
            const res = await fetch('/Servers/FindMissingServers', {
                method: 'GET',
                credentials: 'include'
            });

            const data = await res.json();

            if (!data.success) {
                this.showToast('שגיאה: ' + data.error, 'error');
                return;
            }

            const missing = data.missingServers || [];

            // ── שלב 2: אם אין חסרים ────────────────────────────
            if (missing.length === 0) {
                this.showToast(
                    `✅ כל ${data.sourceStats?.totalUnique ?? 0} השרתים מהקבצים קיימים ב-JSON`,
                    'success'
                );
                return;
            }

            // ── שלב 3: הצג פופאפ אישור ─────────────────────────
            const selected = await this._showMissingServersPopup(
                missing, data
            );

            if (!selected || selected.length === 0) {
                this.showToast('הפעולה בוטלה', 'info');
                return;
            }

            // ── שלב 4: שלח לשרת להוספה ─────────────────────────
            const addRes = await fetch('/Servers/AddMissingServers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    servers: selected.map(s => ({
                        name: s.name || '',
                        os: s.os || '',
                        hardwareVendor: s.hardwareVendor || '',
                        isVirtual: s.isVirtual || '',
                        scannedVia: s.scannedVia || '',
                        environment: s.environment || '',
                        bootType: s.bootType || '',
                        systemName: s.systemName || '',
                        catalogNumber: s.catalogNumber || '',
                        systemManager: s.systemManager || s.systemAdmin || '',
                        department: s.department || '',
                        team: s.team || '',
                        domain: s.domain || '',
                        canShutdown: s.canShutdown || '',
                        env: s.env || '',
                        primaryIP: s.primaryIP || '',
                        serverStatusVC: s.serverStatusVC || '',
                        systemStatus: s.systemStatus || '',
                        dataApproved: s.dataApproved || '',
                        mappingNotes: s.mappingNotes || '',
                        auxSystem: s.auxSystem || '',
                    }))
                })
            });

            const addData = await addRes.json();

            if (!addData.success) {
                this.showToast('שגיאה בהוספה: ' + addData.error, 'error');
                return;
            }

            // ── שלב 5: רענן נתונים ─────────────────────────────
            await this.loadData();
            this.showToast(
                `✅ ${addData.message}`, 'success'
            );

        } catch (err) {
            console.error('findAndAddMissingServers error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // דיבאג - חפש שרת ספציפי בכל הקבצים
    // ══════════════════════════════════════════════════════════
    async debugSearchServer(serverName) {
        try {
            const res = await fetch(
                `/Servers/SearchServer?name=${encodeURIComponent(serverName)}`,
                { credentials: 'include' }
            );
            const data = await res.json();

            if (data.foundInJson?.length > 0) {
                console.group('💾 ב-JSON:');
                console.table(data.foundInJson);
                console.groupEnd();
            }

            console.groupEnd();
            return data;
        } catch (err) {
            console.error('debugSearchServer error:', err);
        }
    }

    // ══════════════════════════════════════════════════════════
    // דיבאג - הצג את כל הקבצים והעמודות שלהם
    // ══════════════════════════════════════════════════════════
    async debugSources() {
        try {
            const res = await fetch('/Servers/DebugSources',
                { credentials: 'include' });
            const data = await res.json();

            return data;
        } catch (err) {
            console.error('debugSources error:', err);
        }
    }

    // ── פופאפ בחירת שרתים חסרים ────────────────────────────────────
    _showMissingServersPopup(missing, stats) {
        return new Promise((resolve) => {

            // ── בנה שורות טבלה ──────────────────────────────────
            // ── בנה שורות טבלה ──────────────────────────────────────
            const rowsHtml = missing.map((s, i) => `
    <tr class="srv-missing-row" data-index="${i}">
        <td class="srv-missing-td srv-missing-td-check">
            <input type="checkbox"
                   class="srv-missing-cb"
                   data-index="${i}"
                   checked>
        </td>
        <td class="srv-missing-td srv-missing-td-name"
            title="${this.escHtml(s.name)}">
            ${this.escHtml(s.name)}
        </td>
        <td class="srv-missing-td srv-missing-td-center">
            ${s.environment === 'PROD'
                    ? '<span class="srv-badge srv-badge-prod">PROD</span>'
                    : s.environment === 'NONPROD'
                        ? '<span class="srv-badge srv-badge-nonprod">NONPROD</span>'
                        : '<span class="srv-badge srv-badge-neutral">—</span>'}
        </td>
        <td class="srv-missing-td">
            <span class="srv-badge srv-badge-neutral"
                  title="${this.escHtml(s.os || '')}">
                ${this.escHtml(this._simplifyOs(s.os))}
            </span>
        </td>
        <!-- ← חדש: שם מערכת -->
        <td class="srv-missing-td srv-missing-td-truncate"
            title="${this.escHtml(s.systemName || '')}">
            ${this.escHtml(s.systemName || '')}
        </td>
        <!-- ← חדש: מנהל מערכת -->
        <td class="srv-missing-td srv-missing-td-truncate"
            title="${this.escHtml(s.systemManager || s.systemAdmin || '')}">
            ${this.escHtml(s.systemManager || s.systemAdmin || '')}
        </td>
        <td class="srv-missing-td">
            ${this.escHtml(s.hardwareVendor || '')}
        </td>
        <td class="srv-missing-td srv-missing-td-center">
            <span class="srv-badge ${this._normalizeVirtual(s.isVirtual) === 'TRUE'
                    ? 'srv-badge-virtual'
                    : 'srv-badge-physical'}">
                ${this._normalizeVirtual(s.isVirtual) === 'TRUE'
                    ? '☁️ וירטואלי' : '🖥️ פיזי'}
            </span>
        </td>
        <td class="srv-missing-td srv-missing-td-center">
            ${(s.sources || '').split(',').map(src => {
                        src = src.trim();
                        const icons = {
                            'SERVER_PROD': { i: 'fa-file-excel', c: '#22c55e' },
                            'PROD_PATCHES': { i: 'fa-shield-alt', c: '#ef4444' },
                            'NONPROD_PATCHES': { i: 'fa-flask', c: '#f59e0b' },
                            'PROD_ONLY': { i: 'fa-star', c: '#a855f7' },
                            'MAPPING': { i: 'fa-map', c: '#3b82f6' }
                        };
                        const cfg = icons[src] || { i: 'fa-file', c: '#888' };
                        return `<i class="fas ${cfg.i}"
                        style="color:${cfg.c};font-size:0.72rem;margin:0 2px"
                        title="${this.escHtml(src)}"></i>`;
                    }).join('')}
        </td>
    </tr>
`).join('');

            const modalHtml = `
        <div id="srvMissingModal" class="srv-modal-overlay">
            <div class="srv-modal" style="max-width:700px">

                <!-- כותרת -->
                <div class="srv-modal-header">
                    <h3 class="srv-modal-title">
                        <i class="fas fa-search-plus"
                           style="color:#f59e0b"></i>
                        שרתים חסרים ב-JSON
                    </h3>
                    <button class="srv-modal-close"
                            id="srvMissingClose">&times;</button>
                </div>

                <!-- סטטיסטיקות -->
                <div style="display:flex;gap:10px;padding:12px 20px;
                            background:#16162a;
                            border-bottom:1px solid #2a2a4e;
                            flex-wrap:wrap;">

                    <span class="srv-stat-pill" style="color:#a5b4fc">
                        <i class="fas fa-database"></i>
                        JSON קיים: ${stats.existingCount}
                    </span>

                    <span class="srv-stat-pill"
                        style="color:#86efac;border-color:rgba(34,197,94,0.3)"
                        title="SERVER_PROD__NONPROD.xlsx">
                        <i class="fas fa-file-excel" style="color:#22c55e"></i>
                        XLSX: ${stats.sourceStats?.serverProd ?? 0}
                    </span>

                    <span class="srv-stat-pill"
                        style="color:#fca5a5;border-color:rgba(239,68,68,0.3)"
                        title="הפצת עדכוני פאצים לשרתי ייצור">
                        <i class="fas fa-shield-alt" style="color:#ef4444"></i>
                        PROD: ${stats.sourceStats?.prodPatches ?? 0}
                    </span>

                    <span class="srv-stat-pill"
                        style="color:#fcd34d;border-color:rgba(245,158,11,0.3)"
                        title="הפצת עדכוני אבטחה לשרתי NONPROD">
                        <i class="fas fa-flask" style="color:#f59e0b"></i>
                        NONPROD: ${stats.sourceStats?.nonProdPatches ?? 0}
                    </span>

                    <span class="srv-stat-pill"
                        style="color:#d8b4fe;border-color:rgba(168,85,247,0.3)"
                        title="PROD_ONLY.xlsx">
                        <i class="fas fa-star" style="color:#a855f7"></i>
                        PROD_ONLY: ${stats.sourceStats?.prodOnly ?? 0}
                    </span>

                    <span class="srv-stat-pill"
                        style="color:#fcd34d;border-color:rgba(245,158,11,0.5);
                                font-weight:700;margin-right:auto">
                        <i class="fas fa-exclamation-triangle" style="color:#f59e0b"></i>
                        חסרים: <strong>${missing.length}</strong>
                    </span>
                </div>

                <!-- בחר הכל / בטל הכל -->
                <div style="
                    display:flex; align-items:center;
                    gap:10px; padding:10px 20px;
                    border-bottom:1px solid #1e1e3a;">
                    <label style="
                        display:flex; align-items:center;
                        gap:7px; cursor:pointer;
                        font-size:0.82rem; color:#aaa;">
                        <input type="checkbox"
                               id="srvMissingSelectAll"
                               checked
                               style="accent-color:#6366f1;
                                      width:15px; height:15px;">
                        בחר הכל / בטל הכל
                    </label>
                    <span id="srvMissingSelectedCount"
                          style="font-size:0.78rem; color:#888;
                                 margin-right:auto;">
                        ${missing.length} נבחרו
                    </span>
                </div>

                <!-- טבלה -->
                <div style="
                    overflow-y:auto;
                    max-height:380px;
                    min-height:100px;">
                    <table style="
                        width:100%;
                        border-collapse:collapse;
                        font-size:0.82rem;
                        direction:rtl;">
                        <thead>
                            <tr>
                                <th class="srv-th" style="width:36px;position:sticky;top:0"></th>
                                <th class="srv-th" style="position:sticky;top:0">שם שרת</th>
                                <th class="srv-th" style="position:sticky;top:0">סביבה</th>
                                <th class="srv-th" style="position:sticky;top:0">מערכת הפעלה</th>
                                <th class="srv-th" style="position:sticky;top:0">מערכת</th>      <!-- ← חדש -->
                                <th class="srv-th" style="position:sticky;top:0">מנהל</th>       <!-- ← חדש -->
                                <th class="srv-th" style="position:sticky;top:0">יצרן</th>
                                <th class="srv-th" style="position:sticky;top:0">סוג</th>
                                <th class="srv-th" style="position:sticky;top:0">מקורות</th>
                            </tr>
                        </thead>
                        <tbody id="srvMissingTbody">
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Footer -->
                <div class="srv-modal-footer">
                    <button class="srv-modal-cancel-btn"
                            id="srvMissingCancel">
                        <i class="fas fa-times"></i> ביטול
                    </button>
                    <button class="srv-modal-save-btn"
                            id="srvMissingConfirm"
                            style="background:#f59e0b;
                                   border-color:#d97706">
                        <i class="fas fa-plus-circle"></i>
                        הוסף נבחרים
                        (<span id="srvMissingConfirmCount">
                            ${missing.length}
                        </span>)
                    </button>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHtml);

            // ── עדכן מונה נבחרים ────────────────────────────────
            const updateCount = () => {
                const checked = document.querySelectorAll(
                    '.srv-missing-cb:checked'
                ).length;
                const countEl = document.getElementById(
                    'srvMissingSelectedCount'
                );
                const confirmCount = document.getElementById(
                    'srvMissingConfirmCount'
                );
                const confirmBtn = document.getElementById(
                    'srvMissingConfirm'
                );
                if (countEl) countEl.textContent = `${checked} נבחרו`;
                if (confirmCount) confirmCount.textContent = checked;
                if (confirmBtn) confirmBtn.disabled = checked === 0;
            };

            // ── בחר הכל ─────────────────────────────────────────
            document.getElementById('srvMissingSelectAll')
                .addEventListener('change', (e) => {
                    document.querySelectorAll('.srv-missing-cb')
                        .forEach(cb => { cb.checked = e.target.checked; });
                    updateCount();
                });

            // ── שינוי checkbox בודד ──────────────────────────────
            document.getElementById('srvMissingTbody')
                .addEventListener('change', (e) => {
                    if (e.target.classList.contains('srv-missing-cb')) {
                        updateCount();
                        // עדכן "בחר הכל"
                        const all = document.querySelectorAll(
                            '.srv-missing-cb'
                        ).length;
                        const checked = document.querySelectorAll(
                            '.srv-missing-cb:checked'
                        ).length;
                        const selectAll = document.getElementById(
                            'srvMissingSelectAll'
                        );
                        if (selectAll) {
                            selectAll.checked = checked === all;
                            selectAll.indeterminate =
                                checked > 0 && checked < all;
                        }
                    }
                });

            // ── סגור ─────────────────────────────────────────────
            const closeModal = () => {
                const modal = document.getElementById('srvMissingModal');
                if (modal) modal.remove();
                resolve(null);
            };

            document.getElementById('srvMissingClose')
                .addEventListener('click', closeModal);
            document.getElementById('srvMissingCancel')
                .addEventListener('click', closeModal);
            document.getElementById('srvMissingModal')
                .addEventListener('click', (e) => {
                    if (e.target.id === 'srvMissingModal') closeModal();
                });

            // ── אישור ────────────────────────────────────────────
            document.getElementById('srvMissingConfirm')
                .addEventListener('click', () => {
                    const selected = [];
                    document.querySelectorAll(
                        '.srv-missing-cb:checked'
                    ).forEach(cb => {
                        const idx = parseInt(cb.dataset.index);
                        if (!isNaN(idx) && missing[idx]) {
                            selected.push(missing[idx]);
                        }
                    });

                    const modal = document.getElementById('srvMissingModal');
                    if (modal) modal.remove();
                    resolve(selected);
                });
        });
    }


    // ══════════════════════════════════════════════════════════
    // סגנונות
    // ══════════════════════════════════════════════════════════
    addStyles() {
        if (document.getElementById('srvStyles')) return;
        const style = document.createElement('style');
        style.id = 'srvStyles';
        style.textContent = `

        /* ══ Root ══ */
        .srv-root {
            background: #0f0f1a;
            color: #e0e0e0;
            font-family: 'Segoe UI', Arial, sans-serif;
            height: 95vh;   
            display: flex;
            flex-direction: column;
            direction: rtl;
            overflow: hidden;       /* ← חדש: מונע גלילה על ה-root */
        }

        /* ══ Header ══ */
        .srv-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 16px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            gap: 10px;
            flex-shrink: 0;
            position: sticky;       /* ← חדש */
            top: 0;                 /* ← חדש */
            z-index: 100;           /* ← חדש */
        }
        .srv-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            flex: 1;
        }
        .srv-header-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        /* ══ חיפוש ══ */
        .srv-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .srv-search-icon {
            position: absolute;
            right: 9px;
            color: #666;
            font-size: 0.8rem;
            pointer-events: none;
        }
        .srv-search-input {
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
        .srv-search-input:focus { border-color: #6366f1; }
        .srv-search-input::placeholder { color: #555; }
        .srv-clear-btn {
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
        .srv-clear-btn:hover { color: #ccc; }

        /* ══ Selects ══ */
        .srv-select {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 6px 10px;
            font-size: 0.82rem;
            outline: none;
            cursor: pointer;
            transition: border-color 0.2s;
            direction: rtl;
        }
        .srv-select:focus { border-color: #6366f1; }
        .srv-select option { background: #252535; }

        /* ══ Quick Filters ══ */
        .srv-quick-filters {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }
        .srv-clear-filters-btn {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            border-radius: 6px;
            color: #f87171;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 0.82rem;
            transition: all 0.2s;
        }
        .srv-clear-filters-btn:hover {
            background: rgba(239,68,68,0.2);
        }

        /* ══ Buttons ══ */
        .srv-import-btn {
            padding: 6px 14px;
            background: rgba(99,102,241,0.25);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 6px;
            color: #98a0ca;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .srv-import-btn:hover {
            background: rgba(99,102,241,0.28);
        }
        /* ══ Light Mode - כפתורים עליונים ══ */
        [data-theme="light"] .srv-import-btn {
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.4);
            color: #4338ca;
        }
        [data-theme="light"] .srv-import-btn:hover {
            background: rgba(99,102,241,0.22);
        }
        .srv-patch-exclude-btn {
            padding: 6px 14px;
            background: rgba(245,158,11,0.25);
            border: 1px solid rgba(245,158,11,0.4);
            border-radius: 6px;
            color: #fbbf24;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .srv-patch-exclude-btn:hover {
            background: rgba(245,158,11,0.35);
        }

        /* ══ Light Mode ══ */
        [data-theme="light"] .srv-patch-exclude-btn {
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.4);
            color: #b45309;
        }

        [data-theme="light"] .srv-patch-exclude-btn:hover {
            background: rgba(245,158,11,0.22);
        }
        [data-theme="light"] .srv-add-server-btn {
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.45);
            color: #15803d;
        }
        [data-theme="light"] .srv-add-server-btn:hover {
            background: rgba(34,197,94,0.22);
            box-shadow: 0 4px 12px rgba(34,197,94,0.2);
        }

        [data-theme="light"] .srv-reset-health-btn {
            background: rgba(244,63,94,0.08);
            border: 1px solid rgba(244,63,94,0.35);
            color: #be123c;
        }
        [data-theme="light"] .srv-reset-health-btn:hover {
            background: rgba(244,63,94,0.15);
        }

        [data-theme="light"] .srv-autofill-bulk-btn {
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.4);
            color: #4338ca;
        }
        [data-theme="light"] .srv-autofill-bulk-btn:hover {
            background: rgba(99,102,241,0.2);
        }

        [data-theme="light"] .srv-export-btn {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.4);
            color: #15803d;
        }
        [data-theme="light"] .srv-export-btn:hover {
            background: rgba(34,197,94,0.2);
        }
        .srv-export-btn {
            padding: 6px 10px;
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.3);
            border-radius: 6px;
            color: #4ade80;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .srv-export-btn:hover {
            background: rgba(34,197,94,0.22);
        }
        .srv-refresh-btn {
            padding: 6px 10px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #999;
            cursor: pointer;
            transition: all 0.2s;
        }
        .srv-refresh-btn:hover { background: #303050; color: #ccc; }

        /* ══ View Buttons ══ */
        .srv-view-btns {
            display: flex;
            gap: 4px;
        }
        .srv-view-btn {
            padding: 6px 10px;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #777;
            cursor: pointer;
            font-size: 0.82rem;
            transition: all 0.2s;
        }
        .srv-view-btn:hover { background: #303050; color: #ccc; }
        .srv-view-btn.active {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.5);
            color: #a5b4fc;
        }

        /* ══ Counter ══ */
        .srv-counter {
            font-size: 0.78rem;
            color: #888;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            padding: 3px 10px;
            white-space: nowrap;
        }
        .srv-last-update {
            font-size: 0.72rem;
            color: #555;
            white-space: nowrap;
        }

        /* ══ Stats Bar ══ */
        .srv-stats-bar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 16px;
            background: #13132a;
            border-bottom: 1px solid #1e1e3a;
            flex-wrap: wrap;
            flex-shrink: 0;
            position: sticky;       /* ← חדש */
            top: 0;                 /* ← חדש - יחושב אוטומטית אחרי header */
            z-index: 99;            /* ← חדש */
        }
        /* ══ Stats Bar Pills ══ */
        .srv-stat-pill {
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
        .srv-stat-pill i { font-size: 0.72rem; }
        .srv-stat-prod     { color: #fca5a5; border-color: rgba(239,68,68,0.3); }
        .srv-stat-virtual  { color: #93c5fd; border-color: rgba(59,130,246,0.3); }
        .srv-stat-active   { color: #86efac; border-color: rgba(34,197,94,0.3); }
        .srv-stat-healthy  { color: #6ee7b7; border-color: rgba(16,185,129,0.3); }
        .srv-stat-bad      {
            color: #fca5a5;
            border-color: rgba(239,68,68,0.4);
            background: rgba(239,68,68,0.08);
            animation: srvPulse 2s infinite;
        }

        /* ══ Stats Bar Pills - לחיצים ══ */
        .srv-stat-pill-clickable {
            cursor: pointer;
            transition: all 0.18s ease;
            user-select: none;
        }

        .srv-stat-pill-clickable:hover {
            transform: translateY(-1px);
            box-shadow: 0 3px 10px rgba(0,0,0,0.3);
            filter: brightness(1.2);
        }

        .srv-stat-pill-clickable:active {
            transform: translateY(0px);
        }

        /* ── פעיל (פילטר מופעל) ── */
        .srv-stat-pill-active {
            font-weight: 700;
            box-shadow: 0 0 8px rgba(99,102,241,0.3);
        }

        .srv-stat-env.srv-stat-pill-active {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.6);
            color: #c4b5fd;
        }

        .srv-stat-prod.srv-stat-pill-active {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.6);
            color: #fca5a5;
        }

        .srv-stat-virtual.srv-stat-pill-active {
            background: rgba(59,130,246,0.2);
            border-color: rgba(59,130,246,0.6);
            color: #93c5fd;
        }

        .srv-stat-active.srv-stat-pill-active {
            background: rgba(34,197,94,0.2);
            border-color: rgba(34,197,94,0.6);
            color: #86efac;
        }

        .srv-stat-healthy.srv-stat-pill-active {
            background: rgba(16,185,129,0.2);
            border-color: rgba(16,185,129,0.6);
            color: #6ee7b7;
        }

        /* ── כפתור X לניקוי ── */
        .srv-stat-pill-clear {
            font-size: 0.6rem !important;
            opacity: 0.7;
            margin-right: 2px;
            padding: 1px 3px;
            border-radius: 50%;
            transition: all 0.15s;
            cursor: pointer;
        }

        .srv-stat-pill-clear:hover {
            opacity: 1;
            background: rgba(239,68,68,0.3);
            color: #fca5a5 !important;
        }

        @keyframes srvPulse {
            0%,100% { opacity:1; }
            50%      { opacity:0.6; }
        }

        /* ══ Error / Loading ══ */
        .srv-error {
            margin: 8px 16px;
            padding: 8px 14px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 6px;
            color: #f87171;
            font-size: 0.85rem;
        }
        .srv-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 30px;
            color: #666;
            font-size: 0.9rem;
        }

        /* ══ Toast ══ */
        .srv-toast {
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
            z-index: 9999999;
            direction: rtl;
            white-space: nowrap;
        }
        .srv-toast-show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        .srv-toast-success {
            background: #166534;
            border: 1px solid #22c55e;
            color: #4ade80;
        }
        .srv-toast-error {
            background: #7f1d1d;
            border: 1px solid #ef4444;
            color: #fca5a5;
        }
        .srv-toast-info {
            background: #1e3a5f;
            border: 1px solid #3b82f6;
            color: #93c5fd;
        }

        /* ══ Content ══ */
        .srv-content {
            transition: opacity 0.2s;
        }

        /* ══ Scroll Wrapper - גלילה ראשית ══ */
        .srv-scroll-wrapper {
            flex: 1;
            overflow-y: auto;
            overflow-x: auto;
            min-height: 0;
            direction: ltr;         /* ← לגלילה אופקית תקינה */
        }
        .srv-scroll-wrapper::-webkit-scrollbar { width: 7px; height: 7px; }
        .srv-scroll-wrapper::-webkit-scrollbar-track { background: #111; }
        .srv-scroll-wrapper::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 4px;
        }

        /* ── תוכן בתוך wrapper חוזר ל-RTL ── */
        .srv-scroll-wrapper .srv-content,
        .srv-scroll-wrapper .srv-pagination {
            direction: rtl;
        }

        /* ══ Table ══ */
        .srv-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
            table-layout: fixed;
            padding: 0 12px;
        }
        .srv-th {
            position: sticky;
            top: 0;
            background: #1a1a2e;
            color: #aaa;
            padding: 10px 12px;
            text-align: right;
            font-weight: 600;
            font-size: 0.78rem;
            border-bottom: 2px solid #2a2a4e;
            cursor: pointer;
            white-space: nowrap;
            user-select: none;
            transition: color 0.2s, background 0.2s;
            z-index: 20;
            text-align: center;
        }
        .srv-th:hover { color: #e0e0e0; background: #222240; }
        .srv-th.sorted { color: #a5b4fc; }
        .srv-th i { margin-right: 1px; font-size: 0.6rem; }
        .srv-sort-icon-dim { opacity: 0.25; }

        .srv-tr {
            border-bottom: 1px solid #1a1a2e;
            transition: background 0.15s;
        }
        .srv-tr:hover { background: rgba(99,102,241,0.07); }
        .srv-tr:nth-child(even) {
            background: rgba(255,255,255,0.03);
        }

        /* Dark mode - הבדל ברור יותר */
        .srv-tr:nth-child(odd) {
            background: rgba(255,255,255,0.0);
        }

        .srv-tr:nth-child(even) {
            background: rgba(255,255,255,0.04);
        }
        .srv-tr:nth-child(even):hover {
            background: rgba(99,102,241,0.07);
        }

        .srv-td {
            padding: 2px 8px;
            color: #ccc;
            vertical-align: middle;
            max-width: 200px;
            text-align: center;
        }
        .srv-td-center { text-align: center; }
        .srv-td-name {
            font-weight: 600;
            color: #e0e0e0;
            min-width: 150px;
        }
        .srv-server-name {
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 185px;
            direction: ltr;
        }
        .srv-td-os {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100px;
        }
        .srv-td-ip {
            font-family: monospace;
            font-size: 0.78rem;
            color: #888;
        }
        .srv-td-notes {
            position: relative;
            max-width: 120px;
        }

        .srv-td-catalog {
            font-size: 0.78rem;
            color: #aaa;
            white-space: nowrap;
        }
        .srv-td-meta {
            font-size: 0.75rem;
            color: #666;
            white-space: nowrap;
        }
        .srv-notes-text {
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 140px;
            font-size: 0.78rem;
            color: #888;
        }
        .srv-edit-note-btn {
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            font-size: 0.7rem;
            padding: 2px 5px;
            border-radius: 3px;
            opacity: 0;
            transition: all 0.2s;
            vertical-align: middle;
        }
        .srv-tr:hover .srv-edit-note-btn,
        .srv-card:hover .srv-edit-note-btn {
            opacity: 1;
        }
        .srv-edit-note-btn:hover {
            background: rgba(99,102,241,0.2);
            color: #a5b4fc;
        }

        /* ══ Badges ══ */
        .srv-badge {
            padding: 2px 5px;   /* ← היה 2px 8px */
            font-size: 0.68rem; /* ← היה 0.7rem */
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 600;
            white-space: nowrap;
        }
        /* ══ Dark Mode - שיפור ניגודיות ══ */
        .srv-badge-prod {
            background: rgba(239,68,68,0.18);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.45);
        }

        .srv-badge-nonprod {
            background: rgba(245,158,11,0.18);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.45);
        }

        .srv-badge-active {
            background: rgba(34,197,94,0.18);
            color: #86efac;
            border: 1px solid rgba(34,197,94,0.45);
        }

        .srv-badge-healthy {
            background: rgba(16,185,129,0.18);
            color: #6ee7b7;
            border: 1px solid rgba(16,185,129,0.45);
        }

        .srv-badge-unhealthy {
            background: rgba(239,68,68,0.22);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.55);
            font-weight: 700;
        }
        /* Dark Mode */
        .srv-badge-virtual {
            background: rgba(59,130,246,0.22);
            color: #93c5fd;
            border: 1px solid rgba(59,130,246,0.5);
            font-weight: 700;
        }
        .srv-badge-physical {
            background: rgba(107,114,128,0.22);
            color: #d1d5db;
            border: 1px solid rgba(107,114,128,0.5);
            font-weight: 700;
        }

        /* Light Mode */
        [data-theme="light"] .srv-badge-virtual {
            background: rgba(59,130,246,0.15);
            color: #1d4ed8;
            border: 1px solid rgba(59,130,246,0.5);
            font-weight: 700;
        }
        [data-theme="light"] .srv-badge-physical {
            background: rgba(107,114,128,0.15);
            color: #374151;
            border: 1px solid rgba(107,114,128,0.5);
            font-weight: 700;
        }
        [data-theme="light"] .srv-badge-prod {
            background: rgba(239,68,68,0.12);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.4);
        }

        [data-theme="light"] .srv-badge-nonprod {
            background: rgba(245,158,11,0.12);
            color: #92400e;
            border: 1px solid rgba(245,158,11,0.4);
        }

        [data-theme="light"] .srv-badge-active {
            background: rgba(34,197,94,0.12);
            color: #14532d;
            border: 1px solid rgba(34,197,94,0.4);
        }

        [data-theme="light"] .srv-badge-inactive {
            background: rgba(239,68,68,0.1);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.35);
        }

        [data-theme="light"] .srv-badge-healthy {
            background: rgba(16,185,129,0.12);
            color: #064e3b;
            border: 1px solid rgba(16,185,129,0.4);
        }

        [data-theme="light"] .srv-badge-unhealthy {
            background: rgba(239,68,68,0.12);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.45);
            font-weight: 700;
        }

        [data-theme="light"] .srv-badge-neutral {
            background: rgba(107,114,128,0.1);
            color: #374151;
            border: 1px solid rgba(107,114,128,0.35);
        }

        [data-theme="light"] .srv-badge-yes {
            background: rgba(34,197,94,0.12);
            color: #14532d;
            border: 1px solid rgba(34,197,94,0.4);
        }

        [data-theme="light"] .srv-badge-no {
            background: rgba(239,68,68,0.1);
            color: #991b1b;
            border: 1px solid rgba(239,68,68,0.35);
        }
        .srv-badge-active {
            background: rgba(34,197,94,0.15);
            color: #457757;
            border: 1px solid rgba(34,197,94,0.3);
        }
        .srv-badge-inactive {
            background: rgba(239,68,68,0.15);
            color: #ad6161;
            border: 1px solid rgba(239,68,68,0.3);
        }
        .srv-badge-healthy {
            background: rgba(16,185,129,0.15);
            color: #6ee7b7;
            border: 1px solid rgba(16,185,129,0.3);
        }
        .srv-badge-unhealthy {
            background: rgba(239,68,68,0.2);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.4);
        }
        .srv-badge-neutral {
            background: rgba(107,114,128,0.15);
            color: #9ca3af;
            border: 1px solid rgba(107,114,128,0.3);
        }
        .srv-badge-yes {
            background: rgba(34,197,94,0.15);
            color: #539d6d;
            border: 1px solid rgba(34,197,94,0.3);
        }
        .srv-badge-no {
            background: rgba(239,68,68,0.1);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.2);
        }

        /* ══ Cards ══ */
        .srv-cards-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 14px;
            padding: 16px;
        }

        .srv-card {
            background: linear-gradient(
                145deg,
                rgba(30, 30, 50, 0.95),
                rgba(20, 20, 40, 0.98)
            );
            border: 1px solid rgba(99, 102, 241, 0.18);
            border-radius: 12px;
            overflow: hidden;
            transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .srv-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.2),
                        0 4px 12px rgba(0, 0, 0, 0.4);
            border-color: rgba(99, 102, 241, 0.45);
        }

        .srv-card-header {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 14px 14px 10px;
            background: linear-gradient(
                135deg,
                rgba(99, 102, 241, 0.12),
                rgba(124, 58, 237, 0.06)
            );
            border-bottom: 1px solid rgba(99, 102, 241, 0.15);
        }

        .srv-card-icon {
            width: 38px;
            height: 38px;
            border-radius: 9px;
            background: linear-gradient(
                135deg,
                rgba(99, 102, 241, 0.25),
                rgba(124, 58, 237, 0.2)
            );
            display: flex;
            align-items: center;
            justify-content: center;
            color: #a5b4fc;
            font-size: 1rem;
            flex-shrink: 0;
            box-shadow: 0 2px 6px rgba(99, 102, 241, 0.2);
        }

        /* ══ Card Row - שיפור עיקרי ══ */
        .srv-card-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.79rem;
            color: #c8cce0;           /* ← ניטרלי, עובד בשני המצבים */
            padding: 5px 8px;
            border-radius: 6px;
            transition: background 0.15s;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .srv-card-row:last-child {
            border-bottom: none;
        }

        .srv-card-row:hover {
            background: rgba(99, 102, 241, 0.07);
            color: #e0e4f8;
        }

        .srv-card-row i {
            width: 16px;
            text-align: center;
            color: #6366f1;
            font-size: 0.72rem;
            flex-shrink: 0;
            opacity: 0.85;
        }

        .srv-card-footer {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px 10px;
            border-top: 1px solid rgba(99, 102, 241, 0.12);
            background: rgba(99, 102, 241, 0.04);
            flex-wrap: wrap;
        }

        .srv-card-notes {
            padding: 7px 14px 10px;
            font-size: 0.75rem;
            color: #7a7fa8;
            display: flex;
            gap: 6px;
            align-items: flex-start;
            border-top: 1px dashed rgba(99, 102, 241, 0.12);
            background: rgba(0, 0, 0, 0.1);
            font-style: italic;
        }

        .srv-card-notes i {
            color: #6366f1;
            flex-shrink: 0;
            margin-top: 2px;
            opacity: 0.7;
        }

        /* ══ Light Mode - Cards ══ */
        [data-theme="light"] .srv-card {
            background: linear-gradient(
                145deg,
                #ffffff,
                #f8f8ff
            );
            border: 1px solid rgba(99, 102, 241, 0.2);
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.08),
                        0 1px 3px rgba(0, 0, 0, 0.06);
        }

        [data-theme="light"] .srv-card:hover {
            box-shadow: 0 8px 24px rgba(99, 102, 241, 0.15),
                        0 4px 12px rgba(0, 0, 0, 0.08);
            border-color: rgba(99, 102, 241, 0.4);
        }

        [data-theme="light"] .srv-card-header {
            background: linear-gradient(
                135deg,
                rgba(99, 102, 241, 0.08),
                rgba(124, 58, 237, 0.04)
            );
            border-bottom: 1px solid rgba(99, 102, 241, 0.12);
        }

        [data-theme="light"] .srv-card-icon {
            background: linear-gradient(
                135deg,
                rgba(99, 102, 241, 0.15),
                rgba(124, 58, 237, 0.1)
            );
            color: #4338ca;
            box-shadow: 0 2px 6px rgba(99, 102, 241, 0.15);
        }

        [data-theme="light"] .srv-card-name {
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-card-system {
            color: #6b7280;
        }

        /* ══ Card Row - Light Mode ══ */
        [data-theme="light"] .srv-card-row {
            color: #374151;           /* ← כהה וברור על רקע בהיר */
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }

        [data-theme="light"] .srv-card-row:hover {
            background: rgba(99, 102, 241, 0.05);
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-card-row i {
            color: #4338ca;
            opacity: 0.9;
        }

        [data-theme="light"] .srv-card-footer {
            border-top: 1px solid rgba(99, 102, 241, 0.1);
            background: rgba(99, 102, 241, 0.03);
        }

        [data-theme="light"] .srv-card-notes {
            color: #6b7280;
            border-top: 1px dashed rgba(99, 102, 241, 0.1);
            background: rgba(0, 0, 0, 0.02);
        }

        [data-theme="light"] .srv-card-notes i {
            color: #4338ca;
        }
        .srv-card-title-wrap { flex: 1; min-width: 0; }
        .srv-card-name {
            font-size: 0.88rem;
            font-weight: 700;
            color: #e0e0e0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        [data-theme="light"] .srv-card-name { color: #1a1a2e; }
        .srv-card-system {
            font-size: 0.72rem;
            color: #666;
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .srv-card-badges {
            display: flex;
            flex-direction: column;
            gap: 3px;
            align-items: flex-end;
            flex-shrink: 0;
        }
        .srv-card-body {
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 0;
            background: transparent;
        }
        .srv-card-row i {
            width: 14px;
            text-align: center;
            color: #555;
            font-size: 0.72rem;
            flex-shrink: 0;
        }

        /* Dark Mode */
        [data-theme="dark"] .srv-card-row {
            color: white;
        }
        .srv-card-footer {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            border-top: 1px solid rgba(255,255,255,0.05);
            flex-wrap: wrap;
        }
        .srv-card-edit-btn {
            margin-right: auto;
        }
        .srv-card-notes {
            padding: 6px 14px 10px;
            font-size: 0.75rem;
            color: #777;
            display: flex;
            gap: 6px;
            align-items: flex-start;
            border-top: 1px dashed rgba(255,255,255,0.05);
        }
        .srv-card-notes i { color: #555; flex-shrink: 0; margin-top: 2px; }

        /* ══ Stats View ══ */
        .srv-stats-view {
            padding: 16px;
            overflow-y: auto;
            height: calc(100vh - 160px);
        }
        .srv-kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 12px;
            margin-bottom: 20px;
        }
        .srv-kpi-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 10px;
            padding: 16px 14px;
            text-align: center;
            transition: transform 0.15s;
        }
        .srv-kpi-card:hover { transform: translateY(-2px); }
        .srv-kpi-icon {
            font-size: 1.6rem;
            margin-bottom: 8px;
        }
        .srv-kpi-value {
            font-size: 1.8rem;
            font-weight: 700;
            line-height: 1;
            margin-bottom: 4px;
        }
        .srv-kpi-label {
            font-size: 0.75rem;
            color: #888;
        }
        .srv-charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
            gap: 16px;
        }
        .srv-chart-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 10px;
            padding: 16px;
        }
        .srv-chart-title {
            font-size: 0.88rem;
            font-weight: 600;
            color: #aaa;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 7px;
        }
        .srv-chart-title i { color: #6366f1; }
        .srv-bar-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 7px;
        }
        .srv-bar-label {
            width: 140px;
            font-size: 0.75rem;
            color: #aaa;
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex-shrink: 0;
        }
        .srv-bar-track {
            flex: 1;
            height: 8px;
            background: rgba(255,255,255,0.06);
            border-radius: 4px;
            overflow: hidden;
        }
        .srv-bar-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.5s ease;
            min-width: 2px;
        }
        .srv-bar-count {
            width: 30px;
            font-size: 0.72rem;
            color: #888;
            text-align: left;
            flex-shrink: 0;
        }

        /* ══ Empty ══ */
        .srv-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 80px 20px;
            color: #444;
            font-size: 1rem;
        }
        .srv-empty i { font-size: 3rem; color: #333; }

        /* ══ Pagination ══ */
        .srv-pagination {
            padding: 10px 16px;
            background: #13132a;
            border-top: 1px solid #1e1e3a;
            position: sticky;       /* ← חדש: הקפא pagination בתחתית */
            bottom: 0;              /* ← חדש */
            z-index: 20;            /* ← חדש */
        }
        .srv-pag-wrap {
            display: flex;
            align-items: center;
            gap: 4px;
            flex-wrap: wrap;
            direction: rtl;
        }
        .srv-pag-btn {
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
        .srv-pag-btn:hover:not(.disabled):not(.active) {
            background: #303050;
            color: #e0e0e0;
        }
        .srv-pag-btn.active {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.5);
            color: #a5b4fc;
            font-weight: 700;
        }
        .srv-pag-btn.disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }
        .srv-pag-dots {
            color: #555;
            padding: 0 4px;
        }
        .srv-pag-info {
            margin-right: auto;
            font-size: 0.75rem;
            color: #666;
            padding-right: 8px;
        }

        /* ══ Modal ══ */
        .srv-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: srvFadeIn 0.2s ease;
        }
        @keyframes srvFadeIn {
            from { opacity:0; } to { opacity:1; }
        }
        .srv-modal {
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 12px;
            width: 90%;
            max-width: 560px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            animation: srvSlideIn 0.2s ease;
            direction: rtl;
        }
        @keyframes srvSlideIn {
            from { transform:translateY(-20px); opacity:0; }
            to   { transform:translateY(0);     opacity:1; }
        }
        .srv-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid #2a2a4e;
        }
        .srv-modal-title {
            font-size: 1rem;
            font-weight: 700;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
        }
        .srv-modal-title i { color: #6366f1; }
        .srv-modal-close {
            background: none;
            border: none;
            color: #888;
            font-size: 22px;
            cursor: pointer;
            line-height: 1;
            transition: color 0.2s;
        }
        .srv-modal-close:hover { color: #ccc; }
        .srv-modal-body {
            padding: 20px;
            display: flex;
            flex-direction: column;
            gap: 14px;
        }
        .srv-modal-footer {
            display: flex;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid #2a2a4e;
            justify-content: flex-end;
        }

        /* ══ Info Grid במודל ══ */
        .srv-modal-info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 16px;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            padding: 12px 14px;
        }
        .srv-info-row {
            display: flex;
            gap: 6px;
            font-size: 0.8rem;
        }
        .srv-info-label {
            color: #666;
            flex-shrink: 0;
        }
        .srv-info-value {
            color: #ccc;
            word-break: break-word;
        }

        /* ══ Form ══ */
        .srv-form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .srv-form-label {
            font-size: 0.82rem;
            font-weight: 600;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .srv-form-label i { color: #6366f1; }
        .srv-form-textarea {
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
        }
        .srv-form-textarea:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }

        /* ══ Modal Buttons ══ */
        .srv-modal-cancel-btn {
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
        .srv-modal-cancel-btn:hover {
            background: #2a2a3a;
            color: #ccc;
        }
        .srv-modal-save-btn {
            padding: 8px 18px;
            background: #4f46e5;
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.2s;
        }
        .srv-modal-save-btn:hover { background: #4338ca; }
        .srv-modal-save-btn:disabled {
            background: #444;
            color: #777;
            cursor: not-allowed;
        }

        /* ══ Filters Popup ══ */
        .srv-filters-wrap {
            position: relative;
        }
        .srv-filters-toggle-btn {
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
        .srv-filters-toggle-btn:hover {
            background: #303050;
            color: #e0e0e0;
            border-color: #5a5a8a;
        }
        .srv-filters-toggle-btn.srv-filters-active {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.5);
            color: #a5b4fc;
        }
        .srv-filters-chevron {
            font-size: 0.7rem;
            transition: transform 0.2s;
        }
        .srv-filters-badge {
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
        .srv-filters-popup {
            position: absolute;
            top: calc(100% + 6px);
            right: 0;
            z-index: 9999;
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 10px;
            padding: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            min-width: 480px;
            animation: srvFadeIn 0.15s ease;
            direction: rtl;
        }
        .srv-filters-popup-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 1px solid #2a2a4e;
        }
        .srv-filters-popup-title {
            font-size: 0.88rem;
            font-weight: 700;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 7px;
        }
        .srv-filters-popup-title i { color: #6366f1; }
        .srv-filters-popup-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }
        .srv-filter-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .srv-filter-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: #777;
        }
        .srv-filter-group .srv-select {
            width: 100%;
        }

        /* ══ Import Modal ══ */
        .srv-import-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.75);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: srvFadeIn 0.2s ease;
            direction: rtl;
        }
        .srv-import-modal {
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 14px;
            width: 92%;
            max-width: 720px;
            max-height: 88vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0,0,0,0.6);
            overflow: hidden;
            animation: srvSlideIn 0.2s ease;
        }

        /* ── Header ── */
        .srv-import-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            flex-shrink: 0;
        }
        .srv-import-modal-title-wrap {
            display: flex;
            align-items: center;
            gap: 12px;
            color: white;
            font-size: 1.3rem;
        }
        .srv-import-modal-title {
            font-size: 1rem;
            font-weight: 700;
            color: white;
            margin: 0;
        }
        .srv-import-modal-subtitle {
            font-size: 0.75rem;
            color: rgba(255,255,255,0.7);
            margin-top: 2px;
        }
        .srv-import-modal-close {
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
            flex-shrink: 0;
        }
        .srv-import-modal-close:hover {
            background: rgba(255,255,255,0.3);
        }

        /* ── Stats Bar ── */
        .srv-import-stats-bar {
            display: flex;
            gap: 10px;
            padding: 12px 20px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap;
            flex-shrink: 0;
        }
        .srv-import-stat {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.82rem;
            padding: 4px 12px;
            border-radius: 12px;
            font-weight: 600;
        }
        .srv-import-stat-total {
            background: rgba(99,102,241,0.15);
            color: #a5b4fc;
            border: 1px solid rgba(99,102,241,0.3);
        }
        .srv-import-stat-added {
            background: rgba(34,197,94,0.12);
            color: #86efac;
            border: 1px solid rgba(34,197,94,0.3);
        }
        .srv-import-stat-changed {
            background: rgba(245,158,11,0.12);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.3);
        }
        .srv-import-stat-same {
            background: rgba(107,114,128,0.12);
            color: #9ca3af;
            border: 1px solid rgba(107,114,128,0.25);
        }

        /* ── Overwrite Section ── */
        .srv-import-overwrite-section {
            padding: 10px 20px;
            background: rgba(245,158,11,0.07);
            border-bottom: 1px solid rgba(245,158,11,0.2);
            flex-shrink: 0;
        }
        .srv-import-overwrite-label {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            user-select: none;
        }
        .srv-import-checkbox {
            width: 16px;
            height: 16px;
            accent-color: #f59e0b;
            cursor: pointer;
            flex-shrink: 0;
        }
        .srv-import-overwrite-text {
            font-size: 0.85rem;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            gap: 7px;
        }
        .srv-import-overwrite-hint {
            font-size: 0.75rem;
            color: #f59e0b;
            font-weight: 600;
        }

        /* ── Tabs ── */
        .srv-import-tabs {
            display: flex;
            border-bottom: 2px solid #2a2a4e;
            flex-shrink: 0;
            background: #16162a;
        }
        .srv-import-tab {
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
        .srv-import-tab:hover {
            color: #ccc;
            background: rgba(255,255,255,0.04);
        }
        .srv-import-tab.active {
            color: #a5b4fc;
            border-bottom-color: #6366f1;
            background: rgba(99,102,241,0.08);
        }
        .srv-import-tab-added.active {
            color: #86efac;
            border-bottom-color: #22c55e;
            background: rgba(34,197,94,0.07);
        }
        .srv-import-tab-changed.active {
            color: #fcd34d;
            border-bottom-color: #f59e0b;
            background: rgba(245,158,11,0.07);
        }
        .srv-import-tab-same.active {
            color: #9ca3af;
            border-bottom-color: #6b7280;
            background: rgba(107,114,128,0.07);
        }

        /* ── Table ── */
        .srv-import-table-wrap {
            overflow-y: auto;
            flex: 1;
            min-height: 0;
        }
        .srv-import-table-wrap::-webkit-scrollbar { width: 6px; }
        .srv-import-table-wrap::-webkit-scrollbar-track { background: #111; }
        .srv-import-table-wrap::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }
        .srv-import-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.82rem;
            direction: rtl;
        }
        .srv-import-th {
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
        .srv-import-td {
            padding: 8px 12px;
            color: #ccc;
            vertical-align: middle;
            border-bottom: 1px solid #1a1a2e;
        }
        .srv-import-td-icon {
            text-align: center;
            width: 36px;
            font-size: 0.9rem;
        }
        .srv-import-td-name {
            font-weight: 600;
            color: #e0e0e0;
            max-width: 200px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .srv-import-td-status {
            display: flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
        }

        /* ── Row Colors ── */
        .srv-import-row {
            transition: background 0.15s;
        }
        .srv-import-row:hover {
            background: rgba(255,255,255,0.03);
        }
        .srv-import-row-added {
            border-right: 3px solid #22c55e;
        }
        .srv-import-row-changed {
            border-right: 3px solid #f59e0b;
        }
        .srv-import-row-unchanged {
            border-right: 3px solid transparent;
            opacity: 0.6;
        }

        /* ── Status Badges ── */
        .srv-import-badge-new {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: rgba(34,197,94,0.15);
            color: #86efac;
            border: 1px solid rgba(34,197,94,0.3);
            white-space: nowrap;
        }
        .srv-import-badge-changed {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: rgba(245,158,11,0.15);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.3);
            white-space: nowrap;
        }
        .srv-import-badge-same {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: rgba(107,114,128,0.12);
            color: #9ca3af;
            border: 1px solid rgba(107,114,128,0.25);
            white-space: nowrap;
        }

        /* ── Expand Button ── */
        .srv-import-expand-btn {
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            color: #a5b4fc;
            width: 22px;
            height: 22px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.65rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .srv-import-expand-btn:hover {
            background: rgba(99,102,241,0.25);
        }

        /* ── Changes Detail ── */
        .srv-import-changes-detail-row {
            background: rgba(245,158,11,0.04);
        }
        .srv-import-changes-detail {
            padding: 10px 20px 10px 12px;
            border-bottom: 1px solid rgba(245,158,11,0.15);
        }
        .srv-import-change-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            font-size: 0.78rem;
            border-bottom: 1px dashed rgba(255,255,255,0.05);
        }
        .srv-import-change-row:last-child {
            border-bottom: none;
        }
        .srv-import-field-label {
            color: #888;
            min-width: 110px;
            flex-shrink: 0;
            font-weight: 600;
        }
        .srv-import-old-val {
            color: #fca5a5;
            background: rgba(239,68,68,0.1);
            padding: 1px 6px;
            border-radius: 4px;
            max-width: 360px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-decoration: line-through;
            opacity: 0.8;
        }
        .srv-import-old-val em {
            font-style: italic;
            opacity: 0.6;
        }
        .srv-import-arrow {
            color: #6366f1;
            font-size: 0.7rem;
            flex-shrink: 0;
        }
        .srv-import-new-val {
            color: #86efac;
            background: rgba(34,197,94,0.1);
            padding: 1px 6px;
            border-radius: 4px;
            max-width: 360px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 600;
        }
        .srv-import-new-val em {
            font-style: italic;
            opacity: 0.6;
        }
        .srv-import-empty-row {
            text-align: center;
            padding: 30px;
            color: #555;
            font-size: 0.85rem;
        }

        /* ══ Import - Tooltip על ערכים ישנים/חדשים ══ */
        .srv-import-old-val,
        .srv-import-new-val {
            position: relative;
            cursor: help;
            max-width: 360px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: inline-block;
            vertical-align: middle;
        }

        /* Tooltip מותאם - מציג ערך מלא */
        .srv-import-old-val[title]:hover::after,
        .srv-import-new-val[title]:hover::after {
            content: attr(title);
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            background: #1a1a2e;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            padding: 5px 10px;
            font-size: 0.78rem;
            color: #e0e0e0;
            white-space: nowrap;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            z-index: 999999;
            box-shadow: 0 4px 14px rgba(0,0,0,0.5);
            pointer-events: none;
            font-weight: 400;
            direction: rtl;
        }

        /* חץ קטן מתחת ל-tooltip */
        .srv-import-old-val[title]:hover::before,
        .srv-import-new-val[title]:hover::before {
            content: '';
            position: absolute;
            bottom: calc(100% + 1px);
            left: 50%;
            transform: translateX(-50%);
            border: 5px solid transparent;
            border-top-color: #3a3a5a;
            z-index: 999999;
            pointer-events: none;
        }
        /* ── Footer ── */
        .srv-import-footer {
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
        .srv-import-footer-info {
            font-size: 0.82rem;
            color: #888;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .srv-import-footer-btns {
            display: flex;
            gap: 10px;
        }
        .srv-import-cancel-btn {
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
        .srv-import-cancel-btn:hover {
            background: #2a2a3a;
            color: #ccc;
        }
        .srv-import-confirm-btn {
            padding: 8px 18px;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
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
        .srv-import-confirm-btn:hover:not(:disabled) {
            background: linear-gradient(135deg, #4338ca, #6d28d9);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99,102,241,0.4);
        }
        .srv-import-confirm-btn:disabled {
            background: #333;
            color: #666;
            cursor: not-allowed;
        }

        /* ══ BigFix Column ══ */
        .srv-td-bigfix {
            min-width: 80px;
            vertical-align: middle;
        }
        .srv-bigfix-cell {
            display: flex;
            flex-direction: column;
            gap: 3px;
            font-size: 0.72rem;
        }
        .srv-bigfix-header-ok {
            display: flex;
            align-items: center;
            gap: 5px;
            color: #86efac;
        }
        [data-theme="light"] .srv-bigfix-header-ok {
            color: #2e8d50;
        }
        .srv-bigfix-count {
            background: rgba(34,197,94,0.2);
            color: #86efac;
            border-radius: 8px;
            padding: 0 5px;
            font-size: 0.65rem;
            font-weight: 700;
        }
        .srv-bigfix-refresh-btn {
            background: none;
            border: none;
            color: #555;
            cursor: pointer;
            font-size: 0.65rem;
            padding: 2px 4px;
            border-radius: 3px;
            margin-right: 4px;
            transition: all 0.2s;
        }
        .srv-bigfix-refresh-btn:hover {
            color: #a5b4fc;
            background: rgba(99,102,241,0.15);
        }

        /* ══ BigFix Stats Pills ══ */
        .srv-stat-bigfix {
            color: #a5b4fc;
            border-color: rgba(99,102,241,0.3);
            font-weight: 600;
            transition: all 0.2s;
        }
        .srv-stat-bigfix:hover {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.5);
        }
        .srv-stat-bigfix-ok {
            color: #86efac;
            border-color: rgba(34,197,94,0.3);
        }
        .srv-stat-bigfix-issues {
            color: #fdba74;
            border-color: rgba(249,115,22,0.35);
        }
        .srv-stat-bigfix-loading {
            color: #818cf8;
            border-color: rgba(99,102,241,0.25);
            opacity: 0.7;
        }
        .srv-stat-bigfix-error {
            color: #fca5a5;
            border-color: rgba(239,68,68,0.3);
            background: rgba(239,68,68,0.07);
        }
        .srv-stat-bigfix-completed {
            color: #86efac;
            border-color: rgba(34,197,94,0.25);
            background: rgba(34,197,94,0.07);
        }
        .srv-stat-bigfix-need-restart {
            color: #fdba74;
            border-color: rgba(249,115,22,0.35);
            background: rgba(249,115,22,0.08);
            font-weight: 600;
        }
        .srv-stat-bigfix-pending {
            color: #fcd34d;
            border-color: rgba(245,158,11,0.35);
            background: rgba(245,158,11,0.07);
        }
        .srv-stat-bigfix-not-completed {
            color: #fca5a5;
            border-color: rgba(239,68,68,0.35);
            background: rgba(239,68,68,0.08);
            font-weight: 600;
        }
        .srv-stat-bigfix-not-reboot {
            color: #fde047;
            border-color: rgba(234,179,8,0.35);
            background: rgba(234,179,8,0.07);
        }
        .srv-stat-bigfix-notfound {
            color: #6b7280;
            border-color: rgba(107,114,128,0.25);
            background: rgba(107,114,128,0.05);
        }

        /* ══ System Name Link ══ */
        .srv-system-name-link {
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

        .srv-system-name-link:hover {
            color: #c4b5fd;
            text-decoration: underline solid;
        }

        /* ══ System Info Modal ══ */
        .srv-system-info-modal {
            max-width: 640px;
        }

        .srv-system-info-modal-header {
            border-bottom: 2px solid rgba(99,102,241,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05)
            ) !important;
        }

        .srv-system-info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 20px;
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            padding: 14px 16px;
        }

        .srv-system-info-row {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }

        .srv-system-info-row.full-width {
            grid-column: 1 / -1;
        }

        .srv-system-info-label {
            font-size: 0.7rem;
            font-weight: 600;
            color: #555;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }

        .srv-system-info-value {
            font-size: 0.85rem;
            color: #ccc;
            word-break: break-word;
        }

        .srv-system-info-value:empty::after {
            content: '—';
            color: #444;
            font-style: italic;
        }

        .srv-system-info-not-found {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 30px;
            color: #555;
            text-align: center;
        }

        .srv-system-info-not-found i {
            font-size: 2rem;
            color: #333;
        }

        .srv-system-info-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            padding: 30px;
            color: #666;
        }

        /* ── תאי סטטוס ── */
        .srv-bigfix-restart {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 8px;
            background: rgba(239,68,68,0.15);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.3);
            font-weight: 600;
            white-space: nowrap;
        }
        .srv-bigfix-ok {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 8px;
            background: rgba(34,197,94,0.12);
            color: #86efac;
            border: 1px solid rgba(34,197,94,0.25);
        }
        .srv-bigfix-critical {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: 8px;
            background: rgba(245,158,11,0.15);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.3);
            font-weight: 600;
            max-width: 140px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .srv-bigfix-report {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #666;
            font-size: 0.68rem;
            white-space: nowrap;
        }
        .srv-bigfix-notfound {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #444;
            font-size: 0.72rem;
        }
        .srv-bigfix-pending {
            color: #555;
            font-size: 0.72rem;
        }
        .srv-bigfix-error {
            color: #f87171;
            font-size: 0.72rem;
            cursor: help;
        }
        /* ══ BigFix Badges ══ */
        .srv-bigfix-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px;
            border-radius: 8px;
            font-size: 0.72rem;
            font-weight: 700;
            max-width: 155px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* 🟠 Need Restart */
        .srv-bigfix-need-restart {
            background: rgba(249,115,22,0.15);
            color: #fdba74;
            border: 1px solid rgba(249,115,22,0.4);
        }

        /* 🟠 Pending Restart */
        .srv-bigfix-pending-restart {
            background: rgba(245,158,11,0.15);
            color: #fcd34d;
            border: 1px solid rgba(245,158,11,0.4);
        }

        /* 🟢 Completed */
        .srv-bigfix-completed {
            background: rgba(34,197,94,0.12);
            color: #86efac;
            border: 1px solid rgba(34,197,94,0.3);
        }

        /* 🔴 Not Completed → WAIT TO INSTALL */
        .srv-bigfix-not-completed {
            background: rgba(239,68,68,0.15);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.4);
        }

        /* 🟡 Not Reboot 120 day */
        .srv-bigfix-not-reboot {
            background: rgba(234,179,8,0.15);
            color: #fde047;
            border: 1px solid rgba(234,179,8,0.4);
        }

        /* ❓ Unknown */
        .srv-bigfix-unknown {
            background: rgba(107,114,128,0.15);
            color: #9ca3af;
            border: 1px solid rgba(107,114,128,0.3);
        }

        /* ══ Active Filter Tags ══ */
        .srv-active-filter-tags {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }
        .srv-active-tag {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 8px 3px 4px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 12px;
            font-size: 0.75rem;
            color: #a5b4fc;
            white-space: nowrap;
            animation: srvFadeIn 0.15s ease;
        }
        .srv-active-tag-label {
            color: #7c7caa;
            font-weight: 600;
        }
        .srv-active-tag-value {
            color: #c4b5fd;
            font-weight: 700;
        }
        .srv-active-tag-remove {
            background: none;
            border: none;
            color: #6366f1;
            cursor: pointer;
            padding: 1px 3px;
            border-radius: 50%;
            font-size: 0.6rem;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
            line-height: 1;
        }
        .srv-active-tag-remove:hover {
            background: rgba(239,68,68,0.2);
            color: #f87171;
        }

        /* ══ Truncate TD - שורה אחת + tooltip ══ */
        .srv-td-truncate {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 130px;
            cursor: default;
            position: relative;
            unicode-bidi: plaintext;  /* ← זיהוי אוטומטי לפי תוכן */
            text-align: center;
        }

        .srv-td-truncate[dir="ltr"] {
            direction: ltr;
        }

        .srv-td-truncate[dir="rtl"] {
            direction: rtl;
        }

        /* Hover highlight לתאים עם truncate */
        .srv-td-truncate:hover {
            color: #e0e0e0;
            background: rgba(99,102,241,0.08);
        }

        /* ══ Filters Toggle Row - כפתור + תגיות ══ */
        .srv-filters-toggle-row {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        /* ══ Filter Group Active - highlight בפופאפ ══ */
        .srv-filter-group-active {
            background: rgba(99,102,241,0.07);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 8px;
            padding: 7px 8px 5px;
            margin: -7px -8px -5px;
            position: relative;
        }

        /* ── אינדיקטור נקודה ירוקה בפינה ── */
        .srv-filter-group-active::after {
            content: '';
            position: absolute;
            top: 6px;
            left: 6px;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #6366f1;
            box-shadow: 0 0 4px rgba(99,102,241,0.8);
            animation: srvPulse 2s infinite;
        }

        /* ── Label פעיל ── */
        .srv-filter-label-active {
            color: #a5b4fc !important;
            font-weight: 700 !important;
        }

        /* ── Select פעיל ── */
        .srv-select-active {
            border-color: rgba(99,102,241,0.6) !important;
            background: rgba(99,102,241,0.08) !important;
            color: #c4b5fd !important;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }

        /* ══ Active Filter Tags - ליד כפתור הפילטרים ══ */
        .srv-active-filter-tags {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-wrap: wrap;
            max-width: 600px;
        }

        .srv-active-tag {
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
            animation: srvFadeIn 0.15s ease;
            transition: all 0.2s;
        }

        .srv-active-tag:hover {
            background: rgba(99,102,241,0.22);
            border-color: rgba(99,102,241,0.6);
        }

        .srv-active-tag-label {
            color: #7c7caa;
            font-weight: 600;
            font-size: 0.7rem;
        }

        .srv-active-tag-value {
            color: #c4b5fd;
            font-weight: 700;
            max-width: 180px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .srv-active-tag-remove {
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
            line-height: 1;
            margin-right: 1px;
        }

        .srv-active-tag-remove:hover {
            background: rgba(239,68,68,0.2);
            color: #f87171;
            transform: scale(1.2);
        }

        /* ══ Reset Health Button ══ */
        .srv-reset-health-btn {
            padding: 6px 12px;
            background: rgba(244,63,94,0.1);
            border: 1px solid rgba(244,63,94,0.35);
            border-radius: 6px;
            color: #fb7185;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .srv-reset-health-btn:hover {
            background: rgba(244,63,94,0.2);
            border-color: rgba(244,63,94,0.55);
            color: #fda4af;
        }

        /* ══ Reset Health Modal ══ */
        .srv-reset-health-modal {
            max-width: 480px;
        }
        .srv-reset-health-header {
            border-bottom: 2px solid rgba(244,63,94,0.3) !important;
        }

        /* ── אזהרה ── */
        .srv-reset-health-warning {
            display: flex;
            gap: 14px;
            align-items: flex-start;
            padding: 14px 16px;
            background: rgba(244,63,94,0.08);
            border: 1px solid rgba(244,63,94,0.3);
            border-radius: 8px;
            color: #fda4af;
        }
        .srv-reset-health-warning i {
            font-size: 1.4rem;
            color: #f43f5e;
            flex-shrink: 0;
            margin-top: 2px;
        }
        .srv-reset-health-warning-title {
            font-size: 0.9rem;
            font-weight: 600;
            color: #fda4af;
            margin-bottom: 4px;
        }
        .srv-reset-health-warning-title strong {
            color: #f43f5e;
            font-size: 1rem;
        }
        .srv-reset-health-warning-sub {
            font-size: 0.78rem;
            color: #f87171;
            opacity: 0.8;
        }

        /* ── סיכום ── */
        .srv-reset-health-summary {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            padding: 12px 14px;
        }
        .srv-reset-health-summary-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #777;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .srv-reset-health-summary-title i {
            color: #6366f1;
        }
        .srv-reset-health-summary-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .srv-reset-health-summary-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px dashed rgba(255,255,255,0.05);
        }
        .srv-reset-health-summary-row:last-child {
            border-bottom: none;
        }
        .srv-reset-health-count {
            font-size: 0.78rem;
            color: #888;
            font-weight: 600;
        }
        .srv-reset-health-empty {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 16px;
            color: #555;
            font-size: 0.85rem;
            justify-content: center;
        }

        /* ── Scope Radio ── */
        .srv-reset-health-scope {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 14px;
            background: rgba(99,102,241,0.05);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 8px;
        }
        .srv-reset-health-scope-label {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
            font-size: 0.85rem;
            color: #ccc;
            user-select: none;
        }
        .srv-reset-radio {
            width: 15px;
            height: 15px;
            accent-color: #6366f1;
            cursor: pointer;
            flex-shrink: 0;
        }
        .srv-reset-scope-hint {
            font-size: 0.75rem;
            color: #666;
            margin-right: 4px;
        }

        /* ── Confirm Input ── */
        .srv-reset-health-confirm-wrap {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .srv-reset-health-confirm-label {
            font-size: 0.82rem;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .srv-reset-health-confirm-label i {
            color: #6366f1;
        }
        .srv-reset-health-confirm-label strong {
            color: #f43f5e;
            font-family: monospace;
            font-size: 0.9rem;
        }
        .srv-reset-health-confirm-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 8px 12px;
            font-size: 0.88rem;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            direction: rtl;
            width: 100%;
            box-sizing: border-box;
        }
        .srv-reset-health-confirm-input:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }
        .srv-reset-health-confirm-input.srv-reset-input-valid {
            border-color: #22c55e !important;
            box-shadow: 0 0 0 2px rgba(34,197,94,0.15) !important;
            color: #86efac;
        }

        /* ── Confirm Button ── */
        .srv-reset-health-confirm-btn {
            padding: 8px 18px;
            background: rgba(244,63,94,0.15);
            border: 1px solid rgba(244,63,94,0.4);
            border-radius: 6px;
            color: #fb7185;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .srv-reset-health-confirm-btn:not(:disabled):hover {
            background: rgba(244,63,94,0.28);
            border-color: rgba(244,63,94,0.6);
            color: #fda4af;
        }
        .srv-reset-health-confirm-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
        }

        .srv-find-missing-btn {
            padding: 6px 12px;
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.35);
            border-radius: 6px;
            color: #fcd34d;
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .srv-find-missing-btn:hover {
            background: rgba(245,158,11,0.22);
            border-color: rgba(245,158,11,0.55);
        }

        /* ══ Import - שרתים שלא בקובץ ══ */
        .srv-import-row-removed {
            border-right: 3px solid #ef4444;
            opacity: 0.85;
        }
        .srv-import-row-removed:hover {
            background: rgba(239,68,68,0.05);
        }

        /* סומן למחיקה */
        .srv-import-row-delete-marked {
            background: rgba(239,68,68,0.08) !important;
            opacity: 1;
        }
        .srv-import-row-delete-marked td {
            color: #fca5a5;
        }

        /* ══ Import - שרת חדש מבוטל ══ */
.srv-import-row-new-deselected {
    opacity: 0.38;
    background: rgba(107,114,128,0.05) !important;
}

.srv-import-row-new-deselected td {
    color: #555 !important;
}

.srv-import-row-new-deselected .srv-badge {
    opacity: 0.4;
    filter: grayscale(0.7);
}

.srv-import-row-new-selectable {
    cursor: default;
}

/* ── Checkbox עמודה בכותרת ── */
.srv-import-th-cb {
    text-align: center !important;
    vertical-align: middle;
}

/* ── תא checkbox ── */
.srv-import-td-cb {
    text-align: center;
    vertical-align: middle;
    padding: 4px !important;
}

.srv-import-new-cb {
    width: 14px;
    height: 14px;
    accent-color: #22c55e;
    cursor: pointer;
}

        .srv-import-badge-removed {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.7rem;
            font-weight: 700;
            background: rgba(239,68,68,0.12);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.3);
            white-space: nowrap;
        }

        /* כפתור מחיקה בודד */
        .srv-import-delete-btn {
            background: rgba(239,68,68,0.1);
            border: 1px solid rgba(239,68,68,0.3);
            color: #f87171;
            width: 24px;
            height: 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.68rem;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .srv-import-delete-btn:hover {
            background: rgba(239,68,68,0.25);
            border-color: rgba(239,68,68,0.6);
            color: #fca5a5;
        }
        .srv-import-delete-btn.marked-for-delete {
            background: rgba(239,68,68,0.25);
            border-color: #ef4444;
            color: #fca5a5;
        }

        /* טאב "לא בקובץ" */
        .srv-import-tab-removed.active {
            color: #fca5a5;
            border-bottom-color: #ef4444;
            background: rgba(239,68,68,0.07);
        }

        /* אזהרת שרתים חסרים */
        .srv-import-removed-warning {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 20px;
            background: rgba(245,158,11,0.07);
            border-bottom: 1px solid rgba(245,158,11,0.2);
            font-size: 0.82rem;
            color: #fcd34d;
            flex-shrink: 0;
            flex-wrap: wrap;
        }
        .srv-import-removed-warning i {
            flex-shrink: 0;
        }
        .srv-import-removed-warning span {
            flex: 1;
        }

        /* כפתור העתקת רשימה */
        .srv-import-copy-removed-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.4);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.78rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .srv-import-copy-removed-btn:hover {
            background: rgba(99,102,241,0.28);
            border-color: rgba(99,102,241,0.6);
        }

        /* stat pill אדום */
        .srv-import-stat-removed {
            background: rgba(239,68,68,0.12);
            color: #fca5a5;
            border: 1px solid rgba(239,68,68,0.3);
        }
        
        /* ══ Admin Badge (המשך) ══ */
        .srv-admin-badge-inline {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            background: rgba(245,158,11,0.15);
            border: 1px solid rgba(245,158,11,0.4);
            border-radius: 6px;
            color: #fcd34d;
            font-size: 0.72rem;
            font-weight: 700;
        }
        .srv-admin-badge-inline i { font-size: 0.65rem; }

        /* ══ Edit Server Modal ══ */
        .srv-edit-modal {
            max-width: 780px;
            width: 95%;
        }

        .srv-edit-modal-header {
            border-bottom: 2px solid rgba(245,158,11,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(245,158,11,0.08),
                rgba(217,119,6,0.05)
            ) !important;
        }

        .srv-edit-server-name-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            background: rgba(245,158,11,0.15);
            border: 1px solid rgba(245,158,11,0.35);
            border-radius: 8px;
            color: #fcd34d;
            font-size: 0.82rem;
            font-weight: 700;
            font-family: monospace;
            margin-right: 6px;
        }

        /* ══ Edit Modal Body ══ */
        .srv-edit-modal-body {
            padding: 18px 20px !important;
            gap: 12px !important;
            max-height: 65vh;
            overflow-y: auto;
        }

        .srv-edit-modal-body::-webkit-scrollbar {
            width: 6px;
        }
        .srv-edit-modal-body::-webkit-scrollbar-track {
            background: #111;
        }
        .srv-edit-modal-body::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        /* ══ Edit Rows & Fields ══ */
        .srv-edit-row {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            align-items: flex-end;
        }

        .srv-edit-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
            flex: 1;
            min-width: 130px;
        }

        .srv-edit-field-wide {
            flex: 2;
            min-width: 180px;
        }

        .srv-edit-field-full {
            width: 100%;
            flex: none;
        }

        /* ══ Edit Labels ══ */
        .srv-edit-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: #888;
            display: flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
        }

        .srv-edit-label i {
            color: #6366f1;
            font-size: 0.68rem;
            width: 12px;
            text-align: center;
        }

        /* ══ Edit Inputs ══ */
        .srv-edit-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 7px 10px;
            font-size: 0.83rem;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            direction: rtl;
            width: 100%;
            box-sizing: border-box;
            font-family: inherit;
        }

        .srv-edit-input:focus {
            border-color: #f59e0b;
            box-shadow: 0 0 0 2px rgba(245,158,11,0.15);
        }

        .srv-edit-input::placeholder {
            color: #444;
            font-size: 0.78rem;
        }

        /* ── Select בתוך edit modal ── */
        .srv-edit-select {
            width: 100%;
            padding: 7px 10px !important;
            font-size: 0.83rem !important;
            border-radius: 6px !important;
            transition: border-color 0.2s, box-shadow 0.2s !important;
        }

        .srv-edit-select:focus {
            border-color: #f59e0b !important;
            box-shadow: 0 0 0 2px rgba(245,158,11,0.15) !important;
        }

        /* ══ Last Update Info ══ */
        .srv-edit-last-update {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 7px 12px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 6px;
            font-size: 0.75rem;
            color: #666;
        }

        .srv-edit-last-update i {
            color: #555;
            font-size: 0.7rem;
        }

        .srv-edit-last-update strong {
            color: #888;
        }

        /* ══ Save Button ══ */
        .srv-edit-save-btn {
            padding: 8px 20px;
            background: linear-gradient(
                135deg,
                rgba(245,158,11,0.8),
                rgba(217,119,6,0.9)
            );
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

        .srv-edit-save-btn:hover:not(:disabled) {
            background: linear-gradient(
                135deg,
                rgba(245,158,11,1),
                rgba(217,119,6,1)
            );
            box-shadow: 0 4px 14px rgba(245,158,11,0.35);
            transform: translateY(-1px);
        }

        .srv-edit-save-btn:disabled {
            background: #333;
            border-color: #444;
            color: #666;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        /* ══ Row Edit Button ══ */
        .srv-row-edit-btn {
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
            margin-right: 2px;
        }

        .srv-tr:hover .srv-row-edit-btn {
            opacity: 1;
        }

        .srv-row-edit-btn:hover {
            background: rgba(245,158,11,0.18);
            color: #fcd34d;
            opacity: 1;
        }

        /* ══ שורה בעריכה פעילה ══ */
        .srv-tr-editing {
            background: rgba(245,158,11,0.07) !important;
            border-right: 3px solid rgba(245,158,11,0.6) !important;
            outline: 1px solid rgba(245,158,11,0.2);
        }

        .srv-tr-editing:hover {
            background: rgba(245,158,11,0.1) !important;
        }

        /* ══ Inline Select ══ */
        .srv-td-inline-select {
            padding: 4px 8px !important;
        }

        .srv-inline-select-wrap {
            position: relative;
            display: inline-block;
        }

        /* ── Display (הכפתור הנראה) ── */
        .srv-inline-select-display {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            border-radius: 6px;
            padding: 2px 4px;
            transition: background 0.15s;
            user-select: none;
        }

        .srv-inline-select-display:hover {
            background: rgba(255,255,255,0.06);
        }

        /* ── Chevron ── */
        .srv-inline-chevron {
            font-size: 0.55rem;
            color: #555;
            transition: transform 0.2s, color 0.2s;
            flex-shrink: 0;
        }

        .srv-inline-open .srv-inline-chevron {
            transform: rotate(180deg);
            color: #a5b4fc;
        }

        /* ── Dropdown ── */
        .srv-inline-select-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            left: 50%;
            transform: translateX(-50%);
            background: #1e1e2e;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            padding: 4px;
            z-index: 9999;
            min-width: 130px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            animation: srvFadeIn 0.12s ease;
            white-space: nowrap;
        }

        /* ── Option ── */
        .srv-inline-option {
            display: flex;
            align-items: center;
            padding: 6px 10px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 0.78rem;
            transition: background 0.12s;
            gap: 6px;
        }

        .srv-inline-option:hover {
            background: rgba(99,102,241,0.12);
        }

        .srv-inline-option-active {
            background: rgba(99,102,241,0.15);
        }

        .srv-inline-option-active::before {
            content: '✓';
            color: #a5b4fc;
            font-size: 0.7rem;
            margin-left: -4px;
            margin-right: 2px;
        }

        /* ── ערך ריק ── */
        .srv-inline-opt-empty {
            color: #555;
            font-size: 0.75rem;
            font-style: italic;
        }

        /* ── תצוגת ריק ── */
        .srv-inline-empty {
            color: #333;
            font-size: 0.75rem;
            padding: 2px 6px;
        }

        /* ── אנימציה ── */
        @keyframes srvDropIn {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(-4px);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }

        .srv-inline-select-dropdown {
            animation: srvDropIn 0.12s ease;
        }

        /* ── כשלא אדמין - ללא cursor pointer ── */
        .srv-td-inline-select:not(:has(.srv-inline-select-wrap)) {
            cursor: default;
        }

        .srv-td-bigfix-date {
            min-width: 80px;
            vertical-align: middle;
            font-size: 0.72rem;
            color: #666;
            white-space: nowrap;
        }

        .srv-td-bigfix-date .srv-bigfix-report {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #666;
            font-size: 0.72rem;
        }

        .srv-td-bigfix-date .srv-bigfix-report i {
            color: #444;
            font-size: 0.65rem;
        }

        /* ══ Multi-Select Toolbar ══ */
        .srv-multi-toolbar {
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
            animation: srvFadeIn 0.2s ease;
            gap: 12px;
            flex-wrap: wrap;
        }

        .srv-multi-toolbar-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .srv-multi-toolbar-left {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .srv-multi-count {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 0.88rem;
            font-weight: 700;
            color: #a5b4fc;
        }

        .srv-multi-count i {
            color: #6366f1;
            font-size: 1rem;
        }

        .srv-multi-clear-btn {
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
        }

        .srv-multi-clear-btn:hover {
            background: rgba(255,255,255,0.1);
            color: #e0e0e0;
        }

        .srv-multi-action-btn {
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
        }

        .srv-multi-edit-btn {
            background: rgba(99,102,241,0.2);
            border-color: rgba(99,102,241,0.45);
            color: #a5b4fc;
        }

        .srv-multi-edit-btn:hover {
            background: rgba(99,102,241,0.32);
            border-color: rgba(99,102,241,0.65);
            transform: translateY(-1px);
        }
        /* ══ PING Button & Status ══ */
        .srv-td-ping {
            min-width: 60px;
            vertical-align: middle;
            text-align: center;
        }

        /* ══ Multi Delete Button ══ */
        .srv-multi-delete-btn {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.4);
            color: #fca5a5;
        }

        .srv-multi-delete-btn:hover {
            background: rgba(239,68,68,0.28);
            border-color: rgba(239,68,68,0.65);
            transform: translateY(-1px);
        }

        /* ══ Multi Delete Modal ══ */
        .srv-multi-delete-modal {
            max-width: 520px;
        }

        .srv-multi-delete-header {
            border-bottom: 2px solid rgba(239,68,68,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(239,68,68,0.08),
                rgba(220,38,38,0.05)
            ) !important;
        }

        .srv-multi-delete-count-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.35);
            border-radius: 8px;
            color: #fca5a5;
            font-size: 0.82rem;
            font-weight: 700;
            margin-right: 6px;
        }

        /* ── אזהרה ── */
        .srv-multi-delete-warning {
            display: flex;
            gap: 14px;
            align-items: flex-start;
            padding: 14px 20px;
            background: rgba(239,68,68,0.08);
            border-bottom: 1px solid rgba(239,68,68,0.2);
            color: #fda4af;
            flex-shrink: 0;
        }

        .srv-multi-delete-warning i {
            font-size: 1.4rem;
            color: #ef4444;
            flex-shrink: 0;
            margin-top: 2px;
        }

        .srv-multi-delete-warning-title {
            font-size: 0.9rem;
            font-weight: 600;
            color: #fda4af;
            margin-bottom: 4px;
        }

        .srv-multi-delete-warning-title strong {
            color: #ef4444;
            font-size: 1rem;
        }

        .srv-multi-delete-warning-sub {
            font-size: 0.78rem;
            color: #f87171;
            opacity: 0.8;
        }

        /* ── גוף ── */
        .srv-multi-delete-body {
            padding: 16px 20px !important;
            gap: 14px !important;
        }

        /* ── רשימת שרתים ── */
        .srv-multi-delete-list-wrap {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            overflow: hidden;
        }

        .srv-multi-delete-list-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #777;
            padding: 8px 12px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(255,255,255,0.02);
        }

        .srv-multi-delete-list-title i {
            color: #6366f1;
        }

        .srv-multi-delete-list {
            max-height: 220px;
            overflow-y: auto;
            padding: 4px;
        }

        .srv-multi-delete-list::-webkit-scrollbar { width: 5px; }
        .srv-multi-delete-list::-webkit-scrollbar-track { background: #111; }
        .srv-multi-delete-list::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        .srv-multi-delete-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 10px;
            border-radius: 5px;
            border-bottom: 1px dashed rgba(255,255,255,0.04);
            transition: background 0.12s;
            gap: 8px;
        }

        .srv-multi-delete-item:last-child {
            border-bottom: none;
        }

        .srv-multi-delete-item:hover {
            background: rgba(239,68,68,0.06);
        }

        .srv-multi-delete-item-name {
            font-size: 0.82rem;
            font-weight: 600;
            color: #e0e0e0;
            display: flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
            min-width: 0;
        }

        .srv-multi-delete-item-meta {
            display: flex;
            align-items: center;
            gap: 5px;
            flex-shrink: 0;
        }

        .srv-multi-delete-item-system {
            font-size: 0.72rem;
            color: #666;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 120px;
        }

        /* ── Confirm Input ── */
        .srv-multi-delete-confirm-wrap {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .srv-multi-delete-confirm-label {
            font-size: 0.82rem;
            color: #aaa;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .srv-multi-delete-confirm-label i {
            color: #6366f1;
        }

        .srv-multi-delete-confirm-label strong {
            color: #ef4444;
            font-family: monospace;
            font-size: 0.9rem;
        }

        .srv-multi-delete-confirm-input {
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 6px;
            color: #e0e0e0;
            padding: 8px 12px;
            font-size: 0.88rem;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
            direction: rtl;
            width: 100%;
            box-sizing: border-box;
        }

        .srv-multi-delete-confirm-input:focus {
            border-color: #ef4444;
            box-shadow: 0 0 0 2px rgba(239,68,68,0.15);
        }

        .srv-multi-delete-confirm-input.srv-multi-delete-input-valid {
            border-color: #22c55e !important;
            box-shadow: 0 0 0 2px rgba(34,197,94,0.15) !important;
            color: #86efac;
        }

        /* ── Confirm Button ── */
        .srv-multi-delete-confirm-btn {
            padding: 8px 18px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 6px;
            color: #fca5a5;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .srv-multi-delete-confirm-btn:not(:disabled):hover {
            background: rgba(239,68,68,0.28);
            border-color: rgba(239,68,68,0.6);
            color: #fda4af;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(239,68,68,0.25);
        }

        .srv-multi-delete-confirm-btn:disabled {
            opacity: 0.35;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        /* ── כפתור ראשוני ── */
        .srv-ping-btn {
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.3);
            border-radius: 5px;
            color: #818cf8;
            cursor: pointer;
            font-size: 0.7rem;
            padding: 3px 6px;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            opacity: 0;
        }

        /* הצג כפתור רק ב-hover על השורה */
        .srv-tr:hover .srv-ping-btn {
            opacity: 1;
        }

        /* כפתור retry - תמיד נראה */
        .srv-ping-retry {
            opacity: 1 !important;
            background: rgba(255,255,255,0.06) !important;
            border-color: rgba(255,255,255,0.15) !important;
            color: #666 !important;
            padding: 2px 4px !important;
            font-size: 0.6rem !important;
            margin-right: 3px;
        }

        .srv-ping-btn:hover {
            background: rgba(99,102,241,0.22);
            border-color: rgba(99,102,241,0.55);
            color: #a5b4fc;
            transform: scale(1.05);
        }

        .srv-ping-retry:hover {
            background: rgba(99,102,241,0.15) !important;
            border-color: rgba(99,102,241,0.4) !important;
            color: #a5b4fc !important;
        }

        /* ── Loading ── */
        .srv-ping-loading {
            color: #6366f1;
            font-size: 0.78rem;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        /* ── מגיב ── */
        .srv-ping-alive {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #86efac;
            font-size: 0.72rem;
            font-weight: 600;
        }

        .srv-ping-alive i {
            color: #22c55e;
            font-size: 0.78rem;
        }

        .srv-ping-rtt {
            font-family: monospace;
            font-size: 0.7rem;
            color: #6ee7b7;
            background: rgba(34,197,94,0.1);
            padding: 1px 4px;
            border-radius: 3px;
        }

        /* ── לא מגיב ── */
        .srv-ping-dead {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #fca5a5;
            font-size: 0.72rem;
            font-weight: 600;
        }

        .srv-ping-dead i {
            color: #ef4444;
            font-size: 0.78rem;
        }

        .srv-ping-dead span {
            font-size: 0.68rem;
            color: #f87171;
        }

        /* ══ Column Header Filter ══ */
        .srv-th-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 2px;
            position: relative;
        }

        .srv-th-label {
            flex: 1;
            text-align: center;
        }

        .srv-th-actions {
            display: flex;
            align-items: center;
            gap: 1px;
            flex-shrink: 0;
        }

        /* ── כפתור פילטר בכותרת ── */
        .srv-th-filter-btn {
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

        .srv-th:hover .srv-th-filter-btn {
            opacity: 1;
        }

        .srv-th-filter-btn:hover {
            background: rgba(99,102,241,0.2);
            color: #a5b4fc;
        }

        /* ── פילטר פעיל ── */
        .srv-th-filter-btn.srv-th-filter-active {
            opacity: 1 !important;
            color: #6366f1 !important;
            background: rgba(99,102,241,0.15);
        }

        /* ── נקודה אינדיקטור ── */
        .srv-th-filter-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: #6366f1;
            display: inline-block;
            flex-shrink: 0;
            box-shadow: 0 0 4px rgba(99,102,241,0.8);
            animation: srvPulse 2s infinite;
        }

        /* ── כותרת עם פילטר פעיל ── */
        .srv-th-filtered {
            color: #a5b4fc !important;
        }

        /* ── Sort Icon ── */
        .srv-th-sort-icon {
            font-size: 0.65rem;
            color: #a5b4fc;
        }

        /* ══ Column Filter Popup ══ */
        .srv-th-filter-popup {
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
            animation: srvDropIn 0.15s ease;
            overflow: hidden;
        }

        .srv-col-filter-inner {
            display: flex;
            flex-direction: column;
        }

        /* ── Search ── */
        .srv-col-filter-search-wrap {
            position: relative;
            padding: 8px 10px 6px;
            border-bottom: 1px solid #2a2a4e;
        }

        .srv-col-filter-search-icon {
            position: absolute;
            right: 18px;
            top: 50%;
            transform: translateY(-50%);
            color: #555;
            font-size: 0.7rem;
            pointer-events: none;
            margin-top: 1px;
        }

        .srv-col-filter-search {
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

        .srv-col-filter-search:focus {
            border-color: #6366f1;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
        }

        .srv-col-filter-search::placeholder {
            color: #444;
        }

        /* ── Options List ── */
        .srv-col-filter-options {
            max-height: 220px;
            overflow-y: auto;
            padding: 4px;
        }

        .srv-col-filter-options::-webkit-scrollbar { width: 5px; }
        .srv-col-filter-options::-webkit-scrollbar-track { background: #111; }
        .srv-col-filter-options::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }

        /* ── Option ── */
        .srv-col-filter-option {
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

        .srv-col-filter-option:hover {
            background: rgba(99,102,241,0.12);
            color: #e0e0e0;
        }

        .srv-col-filter-option-active {
            background: rgba(99,102,241,0.18) !important;
            color: #a5b4fc !important;
            font-weight: 600;
        }

        .srv-col-filter-check {
            color: #6366f1;
            font-size: 0.65rem;
            flex-shrink: 0;
            width: 10px;
        }

        .srv-col-filter-dot {
            color: #333;
            font-size: 0.4rem;
            flex-shrink: 0;
            width: 10px;
        }

        .srv-col-filter-option-label {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .srv-col-filter-option-count {
            font-size: 0.68rem;
            color: #555;
            background: rgba(255,255,255,0.05);
            padding: 1px 5px;
            border-radius: 8px;
            flex-shrink: 0;
            min-width: 20px;
            text-align: center;
        }

        /* ── Clear Button ── */
        .srv-col-filter-clear {
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

        .srv-col-filter-clear:hover {
            background: rgba(239,68,68,0.1);
        }

        .srv-col-filter-clear i {
            font-size: 0.65rem;
        }

        /* ── שגיאה ── */
        .srv-ping-error {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            color: #fcd34d;
            font-size: 0.72rem;
        }

        .srv-ping-error i {
            color: #f59e0b;
        }

        /* ══ PING - מידע DNS ══ */
        .srv-ping-dns {
            display: inline-flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 1px;
            font-size: 0.62rem;
            line-height: 1.2;
            cursor: help;
        }

        .srv-ping-resolved-ip {
            color: #60a5fa;
            font-family: monospace;
            font-size: 0.65rem;
        }

        .srv-ping-resolved-name {
            color: #a78bfa;
            font-size: 0.62rem;
            max-width: 80px;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ── אי-התאמה ── */
        .srv-ping-mismatch {
            color: #fbbf24;
            font-size: 0.65rem;
            animation: srvPulse 1.5s infinite;
            cursor: help;
        }

        .srv-ping-alive-mismatch i.fa-check-circle {
            color: #fbbf24 !important;
        }

        /* ── מגיב לפי IP (לא לפי שם) ── */
        .srv-ping-via-ip {
            font-size: 0.6rem;
            color: #f59e0b;
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.3);
            border-radius: 3px;
            padding: 0 3px;
            white-space: nowrap;
        }

        /* ══ PING - via IP עם שם שרת ══ */
        .srv-ping-via-ip-wrap {
            display: inline-flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            background: rgba(245,158,11,0.08);
            border: 1px solid rgba(245,158,11,0.25);
            border-radius: 5px;
            padding: 2px 5px;
            cursor: help;
            max-width: 110px;
        }

        /* ── שורה עליונה: "via IP" ── */
        .srv-ping-via-ip-label {
            display: flex;
            align-items: center;
            gap: 3px;
            font-size: 0.6rem;
            color: #f59e0b;
            font-weight: 700;
            white-space: nowrap;
        }

        .srv-ping-via-ip-label i {
            font-size: 0.58rem;
        }

        /* ── שורה תחתונה: שם השרת שהוחזר ── */
        .srv-ping-via-ip-name {
            display: flex;
            align-items: center;
            gap: 3px;
            font-size: 0.65rem;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100px;
        }

        .srv-ping-via-ip-name i {
            font-size: 0.55rem;
            flex-shrink: 0;
        }

        /* ── שם תואם ── */
        .srv-ping-via-ip-name-match {
            color: #86efac;
        }

        .srv-ping-via-ip-name-match i {
            color: #22c55e;
        }

        /* ── שם לא תואם - הדגש באדום/כתום ── */
        .srv-ping-via-ip-name-mismatch {
            color: #fca5a5;
            animation: srvPulse 2s infinite;
        }

        .srv-ping-via-ip-name-mismatch i {
            color: #ef4444;
        }

        /* ── שם לא ידוע ── */
        .srv-ping-via-ip-name-unknown {
            display: flex;
            align-items: center;
            gap: 3px;
            font-size: 0.62rem;
            color: #6b7280;
            font-style: italic;
        }

        /* ── כשיש אי-התאמת שם - הדגש את כל ה-wrap ── */
        .srv-ping-via-ip-name-diff {
            border-color: rgba(239,68,68,0.4) !important;
            background: rgba(239,68,68,0.08) !important;
        }

        /* ══ PING - כפתור עדכון IP ══ */
        .srv-ping-update-ip-btn {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 2px 7px;
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.35);
            border-radius: 5px;
            color: #fcd34d;
            font-size: 0.62rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
            vertical-align: middle;
            line-height: 1.4;
            font-family: inherit;
        }

        .srv-ping-update-ip-btn:hover {
            background: rgba(245,158,11,0.28);
            border-color: rgba(245,158,11,0.65);
            color: #fde68a;
            transform: translateY(-1px);
            box-shadow: 0 3px 8px rgba(245,158,11,0.25);
        }

        .srv-ping-update-ip-btn:active {
            transform: translateY(0px);
            box-shadow: none;
        }

        .srv-ping-update-ip-btn i {
            font-size: 0.58rem;
            flex-shrink: 0;
        }

        /* ── אנימציה קלה על הכפתור כשיש אי-התאמה ── */
        .srv-ping-alive-mismatch .srv-ping-update-ip-btn {
            animation: srvIpMismatchPulse 2.5s infinite;
        }

        @keyframes srvIpMismatchPulse {
            0%, 100% {
                background: rgba(245,158,11,0.12);
                border-color: rgba(245,158,11,0.35);
            }
            50% {
                background: rgba(245,158,11,0.22);
                border-color: rgba(245,158,11,0.6);
                box-shadow: 0 0 6px rgba(245,158,11,0.3);
            }
        }

        /* ── Light Mode ── */
        [data-theme="light"] .srv-ping-update-ip-btn {
            background: rgba(245,158,11,0.1);
            border: 1px solid rgba(245,158,11,0.4);
            color: #b45309;
        }

        [data-theme="light"] .srv-ping-update-ip-btn:hover {
            background: rgba(245,158,11,0.22);
            border-color: rgba(245,158,11,0.65);
            color: #92400e;
            box-shadow: 0 3px 8px rgba(245,158,11,0.2);
        }

        [data-theme="light"] .srv-ping-alive-mismatch .srv-ping-update-ip-btn {
            animation: srvIpMismatchPulsLight 2.5s infinite;
        }

        @keyframes srvIpMismatchPulsLight {
            0%, 100% {
                background: rgba(245,158,11,0.1);
                border-color: rgba(245,158,11,0.4);
            }
            50% {
                background: rgba(245,158,11,0.2);
                border-color: rgba(245,158,11,0.65);
                box-shadow: 0 0 6px rgba(245,158,11,0.25);
            }
        }

        /* ── הרחב תא PING לתצוגה מורחבת ── */
        .srv-td-ping {
            min-width: 100px !important;
            vertical-align: middle;
        }

        /* ── תא PING - הרחב מעט ── */
        .srv-td-ping {
            min-width: 80px !important;
        }

        .srv-ping-alive {
            flex-wrap: wrap;
            max-width: 120px;
            gap: 2px !important;
        }

        /* ══ Sort Indicator בתוך popup ══ */
        .srv-col-sort-indicator {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 7px 10px;
            background: rgba(99,102,241,0.08);
            color: #a5b4fc;
            font-size: 0.78rem;
            font-weight: 600;
        }

        .srv-col-sort-indicator i:first-child {
            color: #6366f1;
            font-size: 0.75rem;
            flex-shrink: 0;
        }

        .srv-col-sort-indicator span {
            flex: 1;
        }

        .srv-col-sort-flip-btn {
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

        .srv-col-sort-flip-btn:hover {
            background: rgba(99,102,241,0.28);
            border-color: rgba(99,102,241,0.6);
            color: #a5b4fc;
        }

        .srv-col-filter-divider {
            height: 1px;
            background: #2a2a4e;
            margin: 0;
        }

        /* ══ Import - Field-level Change Selection ══ */
        .srv-import-change-check-wrap {
            display: flex;
            align-items: center;
            cursor: pointer;
            flex-shrink: 0;
        }

        .srv-import-field-cb {
            width: 14px;
            height: 14px;
            accent-color: #6366f1;
            cursor: pointer;
            flex-shrink: 0;
        }

        /* ── ערך חדש מבוטל ── */
        .srv-import-new-val-disabled {
            opacity: 0.35 !important;
            text-decoration: line-through !important;
            color: #6b7280 !important;
            background: rgba(107,114,128,0.08) !important;
        }

        /* ── כפתורי בחר/בטל הכל לשרת ── */
        .srv-import-server-change-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 0 8px;
            border-bottom: 1px dashed rgba(255,255,255,0.08);
            margin-bottom: 6px;
            flex-wrap: wrap;
        }

        .srv-import-select-all-fields-btn,
        .srv-import-deselect-all-fields-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 10px;
            border-radius: 5px;
            font-size: 0.72rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            border: 1px solid transparent;
        }

        .srv-import-select-all-fields-btn {
            background: rgba(34,197,94,0.12);
            border-color: rgba(34,197,94,0.3);
            color: #86efac;
        }

        .srv-import-select-all-fields-btn:hover {
            background: rgba(34,197,94,0.22);
            border-color: rgba(34,197,94,0.5);
        }

        .srv-import-deselect-all-fields-btn {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #fca5a5;
        }

        .srv-import-deselect-all-fields-btn:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.45);
        }

        .srv-import-selected-fields-count {
            font-size: 0.72rem;
            color: #86efac;
            margin-right: auto;
            font-weight: 600;
        }

        /* ── שורת שינוי עם checkbox ── */
        .srv-import-change-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 0;
            font-size: 0.78rem;
            border-bottom: 1px dashed rgba(255,255,255,0.05);
            transition: background 0.12s;
            border-radius: 4px;
            padding: 5px 6px;
        }

        .srv-import-change-row:last-child {
            border-bottom: none;
        }

        .srv-import-change-row:hover {
            background: rgba(255,255,255,0.03);
        }

        /* ── שורה מבוטלת ── */
        .srv-import-change-row:has(.srv-import-field-cb:not(:checked)) {
            opacity: 0.55;
        }

        /* ══ Responsive ══ */
        @media (max-width: 700px) {
            .srv-edit-modal {
                width: 98%;
                max-width: 98%;
            }
            .srv-edit-row {
                flex-direction: column;
                gap: 8px;
            }
            .srv-edit-field,
            .srv-edit-field-wide {
                min-width: unset;
                width: 100%;
            }
        }

        /* ══ Export Changes Button ══ */
        .srv-import-export-changes-btn {
            padding: 8px 16px;
            background: rgba(34,197,94,0.12);
            border: 1px solid rgba(34,197,94,0.35);
            border-radius: 7px;
            color: #86efac;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }

        .srv-import-export-changes-btn:hover:not(:disabled) {
            background: rgba(34,197,94,0.22);
            border-color: rgba(34,197,94,0.55);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(34,197,94,0.2);
        }

        .srv-import-export-changes-btn:disabled {
            background: #333;
            border-color: #444;
            color: #666;
            cursor: not-allowed;
        }

        /* ===== LIGHT MODE — ServersDashboard ===== */
        [data-theme="light"] .srv-root {
            background: #f0f2f5;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-header {
    background: #f8f8ff;
    border-bottom: 2px solid #d0d0e8;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

[data-theme="light"] .srv-stats-bar {
    background: #f0f0fa;
    border-bottom: 1px solid #d0d0e8;
}

        [data-theme="light"] .srv-search-input {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-search-input::placeholder { color: #aaa; }

        [data-theme="light"] .srv-select {
            background: #fff;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-select option { background: #fff; }

        [data-theme="light"] .srv-stats-bar {
            background: #e8e8f0;
            border-bottom: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-stat-pill {
            background: #ffffff;
            border: 1px solid rgba(0,0,0,0.15);
            color: #374151;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        [data-theme="light"] .srv-stat-prod {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.35);
            color: #b91c1c;
        }

        [data-theme="light"] .srv-stat-virtual {
            background: rgba(59,130,246,0.08);
            border-color: rgba(59,130,246,0.35);
            color: #1d4ed8;
        }

        [data-theme="light"] .srv-stat-active {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.35);
            color: #15803d;
        }

        [data-theme="light"] .srv-stat-healthy {
            background: rgba(16,185,129,0.08);
            border-color: rgba(16,185,129,0.35);
            color: #065f46;
        }

        [data-theme="light"] .srv-stat-bad {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.4);
            color: #b91c1c;
        }

        [data-theme="light"] .srv-stat-bigfix {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.35);
            color: #4338ca;
        }

        [data-theme="light"] .srv-stat-bigfix-ok {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.35);
            color: #15803d;
        }

        [data-theme="light"] .srv-stat-bigfix-issues {
            background: rgba(249,115,22,0.08);
            border-color: rgba(249,115,22,0.35);
            color: #c2410c;
        }

        [data-theme="light"] .srv-stat-pill-active {
            box-shadow: 0 0 0 2px rgba(99,102,241,0.25),
                        0 2px 6px rgba(0,0,0,0.1);
            font-weight: 700;
        }

        [data-theme="light"] .srv-table thead tr {
            background: #e8e8f0;
        }

        [data-theme="light"] .srv-th {
            background: #e8e8f0;
            color: #4a5568;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .srv-th:hover {
            color: #1a1a2e;
            background: #dde0f0;
        }

        [data-theme="light"] .srv-tr {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .srv-tr:hover {
            background: rgba(99,102,241,0.05);
        }

        [data-theme="light"] .srv-tr:nth-child(odd) {
            background: #ffffff;
        }

        [data-theme="light"] .srv-tr:nth-child(even) {
            background: #f3f4f8;
        }

        [data-theme="light"] .srv-tr:hover {
            background: rgba(99,102,241,0.08) !important;
        }

        [data-theme="light"] .srv-td { color: #2d3748; }

        [data-theme="light"] .srv-td-name { color: #1a1a2e; }

        [data-theme="light"] .srv-td-ip { color: #555; }

        [data-theme="light"] .srv-notes-text { color: #666; }

        [data-theme="light"] .srv-scroll-wrapper {
            background: #f0f2f5;
        }

        [data-theme="light"] .srv-pagination {
            background: #e8e8f0;
            border-top: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-pag-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .srv-pag-btn:hover:not(.disabled):not(.active) {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .srv-pag-btn.active {
            background: rgba(99,102,241,0.15);
            border-color: rgba(99,102,241,0.4);
            color: #4338ca;
        }

        [data-theme="light"] .srv-counter {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .srv-last-update { color: #888; }

        [data-theme="light"] .srv-refresh-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .srv-refresh-btn:hover {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .srv-export-btn {
            background: rgba(34,197,94,0.1);
            border: 1px solid rgba(34,197,94,0.3);
            color: #15803d;
        }

        [data-theme="light"] .srv-view-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .srv-view-btn.active {
            background: rgba(99,102,241,0.12);
            border-color: rgba(99,102,241,0.4);
            color: #4338ca;
        }

        [data-theme="light"] .srv-filters-toggle-btn {
            background: #fff;
            border: 1px solid #ccc;
            color: #555;
        }

        [data-theme="light"] .srv-filters-toggle-btn:hover {
            background: #f0f0f8;
            color: #333;
        }

        [data-theme="light"] .srv-filters-popup {
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .srv-filters-popup-header {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .srv-filters-popup-title { color: #555; }

        [data-theme="light"] .srv-filter-label { color: #555; }

        [data-theme="light"] .srv-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-modal-header {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .srv-modal-title { color: #1a1a2e; }

        [data-theme="light"] .srv-modal-close { color: #888; }

        [data-theme="light"] .srv-modal-body { background: #fff; }

        [data-theme="light"] .srv-modal-footer {
            border-top: 1px solid #eee;
            background: #f9f9f9;
        }

        [data-theme="light"] .srv-edit-input {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-edit-input::placeholder { color: #aaa; }

        [data-theme="light"] .srv-form-textarea {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-modal-info-grid {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .srv-info-label { color: #888; }
        [data-theme="light"] .srv-info-value { color: #333; }

        [data-theme="light"] .srv-mapping-notes-display {
            background: #f5f5f5;
            border: 1px solid #ddd;
            color: #555;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 0.82rem;
        }

        [data-theme="light"] .srv-kpi-card {
            background: #fff;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .srv-kpi-label { color: #666; }

        [data-theme="light"] .srv-chart-card {
            background: #fff;
            border: 1px solid #ddd;
        }

        [data-theme="light"] .srv-chart-title { color: #555; }

        [data-theme="light"] .srv-bar-label { color: #666; }

        [data-theme="light"] .srv-bar-track {
            background: rgba(0,0,0,0.08);
        }

        [data-theme="light"] .srv-bar-count { color: #666; }

        [data-theme="light"] .srv-empty { color: #aaa; }
        [data-theme="light"] .srv-empty i { color: #ccc; }

        [data-theme="light"] .srv-th-filter-popup {
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 8px 28px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .srv-col-filter-search {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-col-filter-option {
            color: #333;
        }

        [data-theme="light"] .srv-col-filter-option:hover {
            background: rgba(99,102,241,0.06);
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-col-filter-option-active {
            background: rgba(99,102,241,0.1) !important;
            color: #4338ca !important;
        }

        [data-theme="light"] .srv-col-filter-option-count {
            background: rgba(0,0,0,0.05);
            color: #888;
        }

        [data-theme="light"] .srv-col-filter-clear { color: #dc2626; }

        [data-theme="light"] .srv-col-sort-indicator {
            background: rgba(99,102,241,0.06);
            color: #4338ca;
        }

        [data-theme="light"] .srv-bigfix-badge { border-color: rgba(0,0,0,0.1); }

        [data-theme="light"] .srv-bigfix-completed {
            background: rgba(34,197,94,0.1);
            color: #15803d;
            border: 1px solid rgba(34,197,94,0.25);
        }

        [data-theme="light"] .srv-bigfix-need-restart {
            background: rgba(249,115,22,0.1);
            color: #c2410c;
            border: 1px solid rgba(249,115,22,0.3);
        }

        [data-theme="light"] .srv-bigfix-not-completed {
            background: rgba(239,68,68,0.1);
            color: #b91c1c;
            border: 1px solid rgba(239,68,68,0.3);
        }

        [data-theme="light"] .srv-bigfix-pending-restart {
            background: rgba(245,158,11,0.1);
            color: #b45309;
            border: 1px solid rgba(245,158,11,0.3);
        }

        [data-theme="light"] .srv-bigfix-not-reboot {
            background: rgba(234,179,8,0.1);
            color: #a16207;
            border: 1px solid rgba(234,179,8,0.3);
        }

        [data-theme="light"] .srv-bigfix-notfound {
            color: #9ca3af;
        }

        [data-theme="light"] .srv-bigfix-report { color: #888; }

        [data-theme="light"] .srv-td-bigfix-date { color: #888; }

        [data-theme="light"] .srv-ping-alive { color: #15803d; }
        [data-theme="light"] .srv-ping-alive i { color: #16a34a; }
        [data-theme="light"] .srv-ping-rtt {
            background: rgba(34,197,94,0.1);
            color: #15803d;
        }

        [data-theme="light"] .srv-ping-dead { color: #b91c1c; }
        [data-theme="light"] .srv-ping-dead i { color: #dc2626; }
        [data-theme="light"] .srv-ping-dead span { color: #dc2626; }

        [data-theme="light"] .srv-multi-toolbar {
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.06)
            );
            border-bottom: 1px solid rgba(99,102,241,0.2);
        }

        [data-theme="light"] .srv-multi-count { color: #4338ca; }

        [data-theme="light"] .srv-active-tag {
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.3);
            color: #4338ca;
        }

        [data-theme="light"] .srv-active-tag-label { color: #6366f1; }
        [data-theme="light"] .srv-active-tag-value { color: #4338ca; }

        [data-theme="light"] .srv-inline-select-dropdown {
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }

        [data-theme="light"] .srv-inline-option { color: #333; }

        [data-theme="light"] .srv-inline-option:hover {
            background: rgba(99,102,241,0.06);
        }

        [data-theme="light"] .srv-inline-option-active {
            background: rgba(99,102,241,0.1);
        }

        [data-theme="light"] .srv-system-name-link { color: #4338ca; }
        [data-theme="light"] .srv-system-name-link:hover { color: #3730a3; }

        [data-theme="light"] .srv-system-info-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-system-info-grid {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .srv-system-info-label { color: #888; }
        [data-theme="light"] .srv-system-info-value { color: #333; }

        [data-theme="light"] .srv-import-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-import-stats-bar {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .srv-import-table thead tr {
            background: #e8e8f0;
        }

        [data-theme="light"] .srv-import-th {
            background: #e8e8f0;
            color: #555;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .srv-import-td {
            color: #333;
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .srv-import-footer {
            background: #f0f0f8;
            border-top: 1px solid #ddd;
        }

        [data-theme="light"] .srv-import-footer-info { color: #666; }

        [data-theme="light"] .srv-gaps-modal-body {
            background: #fff;
        }

        [data-theme="light"] .srv-gaps-summary-bar {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .srv-gaps-total-badge {
            background: rgba(245,158,11,0.1);
            border: 1px solid rgba(245,158,11,0.3);
            color: #b45309;
        }

        [data-theme="light"] .srv-gaps-summary-pill {
            background: rgba(255,255,255,0.7);
            border: 1px solid rgba(0,0,0,0.1);
        }

        [data-theme="light"] .srv-gaps-meta {
            background: rgba(0,0,0,0.02);
            border-bottom: 1px solid rgba(0,0,0,0.05);
            color: #888;
        }

        [data-theme="light"] .srv-gaps-th {
            background: #e8e8f0;
            color: #555;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .srv-gaps-tr {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .srv-gaps-tr:hover {
            background: rgba(245,158,11,0.03);
        }

        [data-theme="light"] .srv-gaps-td { color: #333; }

        [data-theme="light"] .srv-gaps-catalog-num {
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .srv-gaps-name-catalog { color: #1a1a2e; }
        [data-theme="light"] .srv-gaps-name-server { color: #b45309; }
        [data-theme="light"] .srv-gaps-server-count { color: #666; }
        [data-theme="light"] .srv-gaps-empty-val { color: #aaa; }

        [data-theme="light"] .srv-gaps-footer {
            background: #f0f0f8;
            border-top: 1px solid #ddd;
        }

        [data-theme="light"] .srv-reset-health-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-reset-health-summary {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .srv-reset-health-summary-title { color: #555; }
        [data-theme="light"] .srv-reset-health-count { color: #666; }

        [data-theme="light"] .srv-reset-health-scope {
            background: rgba(99,102,241,0.04);
            border: 1px solid rgba(99,102,241,0.15);
        }

        [data-theme="light"] .srv-reset-health-scope-label { color: #444; }
        [data-theme="light"] .srv-reset-scope-hint { color: #888; }

        [data-theme="light"] .srv-reset-health-confirm-input {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-multi-delete-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-multi-delete-list-wrap {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
        }

        [data-theme="light"] .srv-multi-delete-list-title { color: #555; }

        [data-theme="light"] .srv-multi-delete-item {
            border-bottom: 1px dashed rgba(0,0,0,0.06);
        }

        [data-theme="light"] .srv-multi-delete-item:hover {
            background: rgba(239,68,68,0.03);
        }

        [data-theme="light"] .srv-multi-delete-item-name { color: #1a1a2e; }
        [data-theme="light"] .srv-multi-delete-item-system { color: #888; }

        [data-theme="light"] .srv-multi-delete-confirm-input {
            background: #f5f5f5;
            border: 1px solid #ccc;
            color: #1a1a2e;
        }

        [data-theme="light"] .srv-multi-edit-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-multi-edit-info {
            background: rgba(99,102,241,0.05);
            border-bottom: 1px solid rgba(99,102,241,0.15);
            color: #444;
        }

        [data-theme="light"] .srv-multi-selected-list {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
            border-radius: 8px;
            padding: 10px 12px;
        }

        [data-theme="light"] .srv-multi-selected-title { color: #555; }

        [data-theme="light"] .srv-multi-selected-tag {
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.25);
            color: #4338ca;
            border-radius: 6px;
            padding: 2px 8px;
            font-size: 0.78rem;
        }

        [data-theme="light"] .srv-servers-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-servers-modal-stats {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .srv-servers-modal-stat {
            background: rgba(255,255,255,0.7);
            border: 1px solid rgba(0,0,0,0.08);
        }

        [data-theme="light"] .srv-servers-modal-th {
            background: #e8e8f0;
            color: #555;
            border-bottom: 2px solid #c8c8e0;
        }

        [data-theme="light"] .srv-servers-modal-tr {
            border-bottom: 1px solid #eee;
        }

        [data-theme="light"] .srv-servers-modal-tr:hover {
            background: rgba(99,102,241,0.04);
        }

        [data-theme="light"] .srv-servers-modal-td { color: #333; }
        [data-theme="light"] .srv-servers-modal-td-name { color: #1a1a2e; }
        [data-theme="light"] .srv-servers-modal-td-ip { color: #666; }

        [data-theme="light"] .srv-servers-modal-footer {
            background: #f0f0f8;
            border-top: 1px solid #ddd;
        }

        [data-theme="light"] .srv-import-modal {
            background: #fff;
            border: 1px solid #c8c8e0;
        }

        [data-theme="light"] .srv-import-table-wrap {
            background: #fff;
        }

        [data-theme="light"] .srv-import-row:hover {
            background: rgba(0,0,0,0.02);
        }

        [data-theme="light"] .srv-missing-td { color: #333; }
        [data-theme="light"] .srv-missing-td-name { color: #1a1a2e; }

        [data-theme="light"] .srv-missing-row:hover {
            background: rgba(245,158,11,0.04);
        }

        /* ══ Filters Popup Grid - הרחבה ל-3 עמודות במסך רחב ══ */
        @media (min-width: 700px) {
            .srv-filters-popup-grid {
                grid-template-columns: 1fr 1fr 1fr;
            }
            .srv-filters-popup {
                min-width: 640px;
            }
        }
        /* ══ Responsive Popup ══ */
        @media (max-width: 600px) {
            .srv-filters-popup {
                min-width: calc(100vw - 32px);
                right: auto;
                left: 0;
            }
            .srv-filters-popup-grid {
                grid-template-columns: 1fr;
            }
        }

        /* ══ Responsive ══ */
        @media (max-width: 900px) {
            .srv-search-input { width: 160px; }
            .srv-charts-grid {
                grid-template-columns: 1fr;
            }
            .srv-modal-info-grid {
                grid-template-columns: 1fr;
            }
        }
        @media (max-width: 600px) {
            .srv-kpi-grid {
                grid-template-columns: repeat(2, 1fr);
            }
            .srv-cards-grid {
                grid-template-columns: 1fr;
            }
        }
        .srv-readonly-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            background: rgba(107,114,128,0.15);
            border: 1px solid rgba(107,114,128,0.3);
            border-radius: 8px;
            color: #6b7280;
            font-size: 0.68rem;
            font-weight: 600;
            margin-right: 6px;
        }
        /* ══ Add Server Button ══ */
        .srv-add-server-btn {
            padding: 6px 14px;
            background: rgba(34,197,94,0.15);
            border: 1px solid rgba(34,197,94,0.4);
            border-radius: 6px;
            color: #73ba8e;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .srv-add-server-btn:hover {
            background: rgba(34,197,94,0.28);
            border-color: rgba(34,197,94,0.6);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(34,197,94,0.2);
        }

        /* ══ Add Modal Header ══ */
        .srv-add-modal-header {
            border-bottom: 2px solid rgba(34,197,94,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.08),
                rgba(16,185,129,0.05)
            ) !important;
        }

        /* ══ Add Save Button ══ */
        .srv-add-save-btn {
            padding: 8px 20px;
            background: linear-gradient(
                135deg,
                rgba(34,197,94,0.8),
                rgba(16,185,129,0.9)
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
        .srv-add-save-btn:hover:not(:disabled) {
            background: linear-gradient(
                135deg,
                rgba(34,197,94,1),
                rgba(16,185,129,1)
            );
            box-shadow: 0 4px 14px rgba(34,197,94,0.35);
            transform: translateY(-1px);
        }
        .srv-add-save-btn:disabled {
            background: #333;
            border-color: #444;
            color: #666;
            cursor: not-allowed;
        }

        /* ══ Required Badge ══ */
        .srv-required-badge {
            font-size: 0.68rem;
            color: #f87171;
            font-weight: 600;
            margin-right: 4px;
        }

        /* ══ Field Error ══ */
        .srv-add-field-error {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.75rem;
            color: #f87171;
            margin-top: 3px;
        }
        .srv-add-field-error i {
            font-size: 0.7rem;
        }

        /* ══ Input Error State ══ */
        .srv-add-input-error {
            border-color: #ef4444 !important;
            box-shadow: 0 0 0 2px rgba(239,68,68,0.2) !important;
        }
        /* ══ Auto-fill Button ══ */
        .srv-autofill-btn {
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
        .srv-autofill-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
            color: #a5b4fc;
            transform: scale(1.08);
        }
        .srv-autofill-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        /* ── שדה שמולא אוטומטית ── */
        .srv-autofilled {
            border-color: #6366f1 !important;
            box-shadow: 0 0 0 2px rgba(99,102,241,0.25) !important;
            background: rgba(99,102,241,0.06) !important;
        }
        /* ══ Bulk Auto-fill Button ══ */
        .srv-autofill-bulk-btn {
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
        .srv-autofill-bulk-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.65);
            transform: translateY(-1px);
        }

        /* ══ Bulk Confirm Modal ══ */
        .srv-bulk-confirm-modal {
            max-width: 620px;
        }
        .srv-bulk-confirm-header {
            border-bottom: 2px solid rgba(99,102,241,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05)
            ) !important;
        }
        .srv-bulk-confirm-body {
            padding: 18px 20px !important;
            gap: 14px !important;
            max-height: 65vh;
            overflow-y: auto;
        }
        .srv-bulk-confirm-body::-webkit-scrollbar { width: 6px; }
        .srv-bulk-confirm-body::-webkit-scrollbar-track { background: #111; }
        .srv-bulk-confirm-body::-webkit-scrollbar-thumb {
            background: #333; border-radius: 3px;
        }

        /* ── Summary Grid ── */
        .srv-bulk-summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 10px;
        }
        .srv-bulk-summary-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            padding: 12px 8px;
            border-radius: 8px;
            border: 1px solid;
            text-align: center;
        }
        .srv-bulk-summary-item i { font-size: 1.1rem; }
        .srv-bulk-summary-num {
            font-size: 1.5rem;
            font-weight: 800;
            line-height: 1;
        }
        .srv-bulk-summary-label {
            font-size: 0.7rem;
            opacity: 0.8;
        }
        .srv-bulk-summary-changes {
            background: rgba(99,102,241,0.1);
            border-color: rgba(99,102,241,0.3);
            color: #a5b4fc;
        }
        .srv-bulk-summary-servers {
            background: rgba(59,130,246,0.1);
            border-color: rgba(59,130,246,0.3);
            color: #93c5fd;
        }
        .srv-bulk-summary-found {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.3);
            color: #86efac;
        }
        .srv-bulk-summary-notfound {
            background: rgba(245,158,11,0.1);
            border-color: rgba(245,158,11,0.3);
            color: #fcd34d;
        }

        /* ── Fields Summary ── */
        .srv-bulk-fields-summary {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            padding: 12px 14px;
        }
        .srv-bulk-section-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #777;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .srv-bulk-section-title i { color: #6366f1; }
        .srv-bulk-field-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 4px 0;
            border-bottom: 1px dashed rgba(255,255,255,0.05);
            font-size: 0.82rem;
        }
        .srv-bulk-field-row:last-child { border-bottom: none; }
        .srv-bulk-field-label { color: #ccc; }
        .srv-bulk-field-count {
            color: #a5b4fc;
            font-weight: 700;
            font-size: 0.78rem;
        }

        /* ── Warning ── */
        .srv-bulk-warning {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 14px;
            background: rgba(245,158,11,0.08);
            border: 1px solid rgba(245,158,11,0.25);
            border-radius: 8px;
            font-size: 0.8rem;
            color: #fcd34d;
            line-height: 1.5;
        }

        /* ── Samples Table ── */
        .srv-bulk-samples {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            padding: 12px 14px;
        }
        .srv-bulk-samples-table-wrap {
            overflow-x: auto;
            margin-top: 8px;
        }
        .srv-bulk-samples-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.78rem;
            direction: rtl;
        }
        .srv-bulk-samples-table th {
            background: #1a1a2e;
            color: #888;
            padding: 6px 10px;
            text-align: right;
            font-weight: 600;
            border-bottom: 1px solid #2a2a4e;
            white-space: nowrap;
        }
        .srv-bulk-sample-row {
            border-bottom: 1px solid #1a1a2e;
            transition: background 0.12s;
        }
        .srv-bulk-sample-row:hover { background: rgba(255,255,255,0.03); }
        .srv-bulk-sample-td {
            padding: 5px 10px;
            color: #ccc;
            vertical-align: middle;
            max-width: 140px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .srv-bulk-old-val {
            color: #fca5a5;
            text-decoration: line-through;
            opacity: 0.8;
        }
        .srv-bulk-new-val {
            color: #86efac;
            font-weight: 600;
        }
        .srv-bulk-more-hint {
            font-size: 0.72rem;
            color: #555;
            text-align: center;
            padding: 6px;
            font-style: italic;
        }

        /* ── Confirm Button ── */
        .srv-bulk-confirm-btn {
            padding: 8px 20px;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 0.85rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        .srv-bulk-confirm-btn:hover {
            background: linear-gradient(135deg, #4338ca, #6d28d9);
            transform: translateY(-1px);
            box-shadow: 0 4px 14px rgba(99,102,241,0.4);
        }

        /* ══ Multi BigFix Button ══ */
        .srv-multi-bigfix-btn {
            background: rgba(234,179,8,0.12);
            border-color: rgba(234,179,8,0.4);
            color: #fde047;
        }
        .srv-multi-bigfix-btn:hover {
            background: rgba(234,179,8,0.22);
            border-color: rgba(234,179,8,0.65);
            color: #fef08a;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(234,179,8,0.2);
        }
        .srv-multi-bigfix-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        /* ══ BigFix Multi Modal ══ */
        .srv-bigfix-multi-modal {
            max-width: 700px;
            width: 95%;
        }
        .srv-bigfix-multi-header {
            border-bottom: 2px solid rgba(99,102,241,0.35) !important;
            background: linear-gradient(
                135deg,
                rgba(99,102,241,0.08),
                rgba(124,58,237,0.05)
            ) !important;
        }
        .srv-bigfix-multi-progress {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 12px 16px;
            background: rgba(99,102,241,0.06);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 8px;
        }
        .srv-bigfix-multi-progress-bar-wrap {
            height: 8px;
            background: rgba(255,255,255,0.06);
            border-radius: 4px;
            overflow: hidden;
        }
        .srv-bigfix-multi-progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #6366f1, #a855f7);
            border-radius: 4px;
            transition: width 0.3s ease;
            min-width: 4px;
        }
        .srv-bigfix-multi-progress-text {
            font-size: 0.78rem;
            color: #a5b4fc;
            display: flex;
            justify-content: space-between;
        }
        .srv-bigfix-multi-results-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.8rem;
            direction: rtl;
        }
        .srv-bigfix-multi-th {
            position: sticky;
            top: 0;
            background: #1a1a2e;
            color: #888;
            padding: 8px 10px;
            text-align: right;
            font-weight: 600;
            font-size: 0.75rem;
            border-bottom: 2px solid #2a2a4e;
            white-space: nowrap;
            z-index: 5;
        }
        .srv-bigfix-multi-td {
            padding: 7px 10px;
            color: #ccc;
            vertical-align: middle;
            border-bottom: 1px solid #1a1a2e;
        }
        .srv-bigfix-multi-tr:hover {
            background: rgba(99,102,241,0.05);
        }
        .srv-bigfix-multi-tr-loading td {
            opacity: 0.6;
        }
        /* ══ Column Filter Multi Controls ══ */
        .srv-col-filter-multi-controls {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
        }

        .srv-col-filter-select-all-btn,
        .srv-col-filter-clear-sel-btn {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 9px;
            border-radius: 5px;
            font-size: 0.72rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            border: 1px solid transparent;
            font-family: inherit;
        }

        .srv-col-filter-select-all-btn {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.3);
            color: #86efac;
        }

        .srv-col-filter-select-all-btn:hover {
            background: rgba(34,197,94,0.22);
            border-color: rgba(34,197,94,0.5);
        }

        .srv-col-filter-clear-sel-btn {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #fca5a5;
        }

        .srv-col-filter-clear-sel-btn:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.45);
        }

        .srv-col-filter-sel-count {
            font-size: 0.72rem;
            color: #a5b4fc;
            font-weight: 700;
            margin-right: auto;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 8px;
            padding: 1px 7px;
        }

        /* ── Checkbox בתוך option ── */
        .srv-col-filter-option {
            gap: 8px; /* עדכן מ-7px */
        }

        .srv-col-filter-cb {
            flex-shrink: 0;
            pointer-events: none; /* הקליק מטופל על ה-div */
        }
        /* ══ אופציית "הכל" - מובדלת ══ */
        .srv-col-filter-option-all {
            border-bottom: 1px solid #2a2a4e;
            margin-bottom: 3px;
            padding-bottom: 7px !important;
            font-weight: 700 !important;
        }

        .srv-col-filter-option-all .srv-col-filter-option-label {
            color: #a5b4fc;
        }

        .srv-col-filter-option-all.srv-col-filter-option-active {
            background: rgba(99,102,241,0.15) !important;
        }

        /* indeterminate style */
        .srv-col-filter-cb-all:indeterminate {
            accent-color: #f59e0b;
        }

        [data-theme="light"] .srv-col-filter-option-all {
            border-bottom: 1px solid #e0e0f0;
        }

        [data-theme="light"] .srv-col-filter-option-all .srv-col-filter-option-label {
            color: #4338ca;
        }
        /* ══ System Name Combobox ══ */
.srv-system-combo-wrap {
    position: relative;
}

.srv-system-combo-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    left: 0;
    z-index: 99999;
    background: #1e1e2e;
    border: 1px solid rgba(99,102,241,0.4);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.55);
    overflow: hidden;
    animation: srvDropIn 0.15s ease;
    max-height: 280px;
    display: flex;
    flex-direction: column;
}

.srv-system-combo-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    color: #6366f1;
    font-size: 0.82rem;
}

.srv-system-combo-list {
    overflow-y: auto;
    flex: 1;
}

.srv-system-combo-list::-webkit-scrollbar { width: 5px; }
.srv-system-combo-list::-webkit-scrollbar-track { background: #111; }
.srv-system-combo-list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
}

.srv-system-combo-item:hover {
    background: rgba(99,102,241,0.12) !important;
}

/* Light Mode */
[data-theme="light"] .srv-system-combo-dropdown {
    background: #fff;
    border: 1px solid rgba(99,102,241,0.35);
    box-shadow: 0 8px 28px rgba(0,0,0,0.15);
}

[data-theme="light"] .srv-system-combo-item {
    border-bottom: 1px solid rgba(0,0,0,0.05) !important;
}

[data-theme="light"] .srv-system-combo-item > div > div {
    color: #1a1a2e !important;
}

[data-theme="light"] .srv-system-combo-item:hover {
    background: rgba(99,102,241,0.06) !important;
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

        /* ══ Gaps Button ══ */
        #srvBulkGapsBtn {
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
        /* ══ Light Mode ══ */
        [data-theme="light"]  #srvBulkGapsBtn {
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.4);
            color: #b45309;
        }
        #srvBulkGapsBtn:hover {
            background: rgba(245,158,11,0.22);
            border-color: rgba(245,158,11,0.6);
        }

        /* ══ Multi Edit Modal - תיקון מראה ══ */
        .srv-multi-edit-modal {
            max-width: 820px !important;
            width: 95% !important;
        }

        .srv-multi-edit-modal .srv-modal-body,
        .srv-multi-edit-body {
            max-height: 70vh !important;
            overflow-y: auto;
            padding: 16px 20px !important;
            gap: 10px !important;
            display: flex;
            flex-direction: column;
        }

        /* Combo wrap - select + input זה לצד זה */
        .srv-me-combo-wrap {
            display: flex;
            flex-direction: row !important;
            gap: 6px;
            align-items: center;
        }

        .srv-me-combo-select {
            flex: 1;
            min-width: 0;
        }

        .srv-me-combo-input {
            flex: 1;
            min-width: 0;
        }

        /* שורות עריכה */
        .srv-multi-edit-modal .srv-edit-row {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            align-items: flex-end;
        }

        .srv-multi-edit-modal .srv-edit-field {
            flex: 1;
            min-width: 140px;
        }

        .srv-multi-edit-modal .srv-edit-field-wide {
            flex: 2;
            min-width: 180px;
        }

        /* רשימת שרתים נבחרים */
        .srv-multi-selected-list {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            padding: 10px 14px;
            margin-top: 4px;
        }

        .srv-multi-selected-names {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 6px;
            max-height: 80px;
            overflow-y: auto;
        }

        .srv-multi-selected-tag {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.25);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.75rem;
            font-weight: 600;
            white-space: nowrap;
        }

        /* Info bar */
        .srv-multi-edit-info {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 14px;
            background: rgba(99,102,241,0.06);
            border-bottom: 1px solid rgba(99,102,241,0.15);
            font-size: 0.8rem;
            color: #888;
            flex-shrink: 0;
        }

        /* Count badge */
        .srv-multi-edit-count-badge {
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

        /* Light mode */
        [data-theme="light"] .srv-multi-selected-list {
            background: rgba(0,0,0,0.02);
            border-color: rgba(0,0,0,0.08);
        }

        [data-theme="light"] .srv-multi-selected-tag {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.2);
            color: #4338ca;
        }

        [data-theme="light"] .srv-multi-edit-info {
            background: rgba(99,102,241,0.04);
            border-bottom-color: rgba(99,102,241,0.1);
            color: #555;
        }
        /* ══ Rename Button ══ */
        .srv-rename-btn {
            background: rgba(245,158,11,0.12);
            border: 1px solid rgba(245,158,11,0.3);
            border-radius: 5px;
            color: #fcd34d;
            cursor: pointer;
            font-size: 0.7rem;
            padding: 3px 7px;
            margin-right: 6px;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            vertical-align: middle;
        }

        .srv-rename-btn:hover {
            background: rgba(245,158,11,0.25);
            border-color: rgba(245,158,11,0.6);
            color: #fde68a;
            transform: scale(1.05);
        }

        [data-theme="light"] .srv-rename-btn {
            background: rgba(245,158,11,0.1);
            border-color: rgba(245,158,11,0.35);
            color: #b45309;
        }
        /* ══ Permissions Modal ══ */
        .srv-permissions-btn {
            padding: 6px 10px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .srv-permissions-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
        }
        .srv-perm-section {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            overflow: hidden;
        }
        .srv-perm-section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.82rem;
        }
        .srv-perm-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 18px;
            padding: 0 6px;
            border-radius: 9px;
            font-size: 0.68rem;
            font-weight: 700;
            margin-right: auto;
        }
        .srv-perm-user-list {
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            max-height: 160px;
            overflow-y: auto;
        }
        .srv-perm-user-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 8px;
            border-radius: 5px;
            transition: background 0.12s;
            font-size: 0.8rem;
        }
        .srv-perm-user-item:hover {
            background: rgba(255,255,255,0.04);
        }
        .srv-perm-user-name {
            flex: 1;
            color: #ccc;
            font-family: monospace;
        }
        /* ══ Permissions Modal ══ */
        .srv-permissions-btn {
            padding: 6px 10px;
            background: rgba(99,102,241,0.12);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 6px;
            color: #a5b4fc;
            font-size: 0.85rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .srv-permissions-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.6);
        }
        .srv-perm-section {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            overflow: hidden;
        }
        .srv-perm-section-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.82rem;
        }
        .srv-perm-count {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 20px;
            height: 18px;
            padding: 0 6px;
            border-radius: 9px;
            font-size: 0.68rem;
            font-weight: 700;
            margin-right: auto;
        }
        .srv-perm-user-list {
            padding: 6px 8px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            max-height: 160px;
            overflow-y: auto;
        }
        .srv-perm-user-list::-webkit-scrollbar { width: 5px; }
        .srv-perm-user-list::-webkit-scrollbar-track { background: #111; }
        .srv-perm-user-list::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 3px;
        }
        .srv-perm-user-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 5px 8px;
            border-radius: 5px;
            transition: background 0.12s;
            font-size: 0.8rem;
        }
        .srv-perm-user-item:hover {
            background: rgba(255,255,255,0.04);
        }
        .srv-perm-user-name {
            flex: 1;
            color: #ccc;
            font-family: monospace;
        }
        .srv-perm-remove-btn {
            background: none;
            border: 1px solid transparent;
            border-radius: 4px;
            color: #444;
            cursor: pointer;
            font-size: 0.65rem;
            padding: 2px 5px;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
        }
        .srv-perm-remove-btn:hover {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.35);
            color: #fca5a5;
        }
        .srv-perm-add-row {
            display: flex;
            gap: 6px;
            align-items: center;
            padding: 8px 10px;
            border-top: 1px solid rgba(255,255,255,0.05);
            background: rgba(255,255,255,0.01);
        }
        .srv-perm-add-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 30px;
            height: 30px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.75rem;
            transition: all 0.15s;
            flex-shrink: 0;
        }
        .srv-perm-add-btn:hover {
            filter: brightness(1.3);
            transform: scale(1.05);
        }

        /* ── Light Mode ── */
        [data-theme="light"] .srv-perm-section {
            background: #fff;
            border: 1px solid #e0e0f0;
        }
        [data-theme="light"] .srv-perm-section-header {
            background: #f5f5ff;
            border-bottom: 1px solid #e8e8f8;
        }
        [data-theme="light"] .srv-perm-user-item:hover {
            background: rgba(0,0,0,0.03);
        }
        [data-theme="light"] .srv-perm-user-name {
            color: #333;
        }
        [data-theme="light"] .srv-perm-remove-btn {
            color: #bbb;
        }
        [data-theme="light"] .srv-perm-remove-btn:hover {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.25);
            color: #dc2626;
        }
        [data-theme="light"] .srv-perm-add-row {
            background: rgba(0,0,0,0.01);
            border-top: 1px solid #eee;
        }
        [data-theme="light"] .srv-permissions-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.3);
            color: #4338ca;
        }
        [data-theme="light"] .srv-permissions-btn:hover {
            background: rgba(99,102,241,0.15);
        }
        /* ══ Permissions Legend ══ */
        .srv-perm-legend {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .srv-perm-legend-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #777;
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 2px;
        }
        .srv-perm-legend-row {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.78rem;
        }
        .srv-perm-legend-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 8px;
            font-size: 0.72rem;
            font-weight: 700;
            border: 1px solid;
            white-space: nowrap;
            flex-shrink: 0;
            min-width: 80px;
            justify-content: center;
        }
        .srv-perm-legend-desc {
            color: #888;
            font-size: 0.75rem;
            line-height: 1.4;
        }

        /* ── Admin Badge ── */
        .srv-admin-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 3px 10px;
            border-radius: 8px;
            font-size: 0.72rem;
            font-weight: 700;
            border: 1px solid;
            cursor: default;
            transition: all 0.2s;
        }

        /* ── Light Mode ── */
        [data-theme="light"] .srv-perm-legend {
            background: rgba(0,0,0,0.02);
            border: 1px solid rgba(0,0,0,0.06);
        }
        [data-theme="light"] .srv-perm-legend-title { color: #555; }
        [data-theme="light"] .srv-perm-legend-desc  { color: #666; }
        `;
        document.head.appendChild(style);
    }
}