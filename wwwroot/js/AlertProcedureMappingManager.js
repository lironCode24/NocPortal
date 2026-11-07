// file: AlertProcedureMappingManager.js
// ניהול מיפויים בין התראות לנהלים

class AlertProcedureMappingManager {

    constructor() {
        this.mappings = [];
        this.procedures = [];
        this._loaded = false;
        this._loadPromise = null;
    }

    // ══════════════════════════════════════════════════════════
    // טעינת מיפויים מהשרת
    // ══════════════════════════════════════════════════════════
    async loadMappings(forceReload = false) {
        if (this._loaded && !forceReload) return this.mappings;
        if (this._loadPromise) return this._loadPromise;

        this._loadPromise = fetch('/AlertProcedureMapping/GetAllMappingsForAlerts', {
            credentials: 'include'
        })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    this.mappings = data.mappings || [];
                    this._loaded = true;
                }
                this._loadPromise = null;
                return this.mappings;
            })
            .catch(err => {
                console.warn('AlertProcedureMappingManager: failed to load', err);
                this._loadPromise = null;
                return [];
            });

        return this._loadPromise;
    }

    // ══════════════════════════════════════════════════════════
    // טעינת רשימת נהלים
    // ══════════════════════════════════════════════════════════
    async loadProceduresList() {
        try {
            const res = await fetch('/AlertProcedureMapping/GetProceduresList',
                { credentials: 'include' });
            const data = await res.json();
            if (data.success) {
                this.procedures = data.procedures || [];
            }
        } catch (err) {
            console.warn('Failed to load procedures list', err);
            this.procedures = [];
        }
    }

    // ══════════════════════════════════════════════════════════
    // מציאת נוהל תואם להודעת התראה (בצד הלקוח)
    // ══════════════════════════════════════════════════════════
    findMatchingProcedure(message, host = '') {
        if (!this.mappings.length) return null;

        // *** תיקון: נקה רווחים מיותרים ***
        const msgLower  = (message || '').toLowerCase().trim();
        const hostLower = (host   || '').toLowerCase().trim();

        if (!msgLower && !hostLower) return null;   // *** הוספה ***

        for (const mapping of this.mappings) {
            const hasMessagePattern = !!(mapping.pattern &&
                mapping.pattern.trim());
            const hasHostPattern    = !!(mapping.hostPattern &&
                mapping.hostPattern.trim());

            const messageMatch = hasMessagePattern
                ? this._isPatternMatch(
                    msgLower, message || '',
                    mapping.pattern.trim(),        // *** trim ***
                    mapping.matchType || 'contains')
                : false;

            const hostMatch = hasHostPattern
                ? this._isPatternMatch(
                    hostLower, host || '',
                    mapping.hostPattern.trim(),    // *** trim ***
                    mapping.hostMatchType || 'contains')
                : false;

            let isMatch = false;
            const op = (mapping.conditionOperator || 'OR').toUpperCase();

            if (!hasMessagePattern && hasHostPattern) {
                isMatch = hostMatch;
            } else if (hasMessagePattern && !hasHostPattern) {
                isMatch = messageMatch;
            } else if (hasMessagePattern && hasHostPattern) {
                isMatch = op === 'AND'
                    ? (messageMatch && hostMatch)
                    : (messageMatch || hostMatch);
            }

            if (isMatch) return mapping;
        }

        return null;
    }

    // *** פונקציה עזר: בדיקת התאמת תבנית ***
    _isPatternMatch(valueLower, valueOriginal, pattern, matchType) {
        if (!pattern) return false;
        const patternLower = pattern.toLowerCase();

        switch (matchType.toLowerCase()) {
            case 'exact':
                return valueLower === patternLower;
            case 'startswith':
                return valueLower.startsWith(patternLower);
            case 'endswith':
                return valueLower.endsWith(patternLower);
            case 'regex':
                try {
                    return new RegExp(pattern, 'i').test(valueOriginal);
                } catch { return false; }
            case 'contains':
            default:
                return valueLower.includes(patternLower);
        }
    }

    // ══════════════════════════════════════════════════════════
    // יצירת כפתור נוהל לתא בטבלת ההתראות
    // ══════════════════════════════════════════════════════════
    createProcedureButton(mapping, alertId) {
        const btn = document.createElement('button');
        btn.className = 'alert-procedure-btn';
        btn.title = `נוהל: ${mapping.procedureName || mapping.procedureFileName}`;
        btn.dataset.mappingId = mapping.id;
        btn.dataset.procedureFileName = mapping.procedureFileName;
        btn.dataset.procedureFolder = mapping.procedureFolderPath || '';
        btn.dataset.alertId = alertId;
        btn.innerHTML = `<i class="fas fa-book-open"></i>`;

        btn.style.cssText = `
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 3px 8px;
            height: 24px;
            background: #0d6efd;
            border: 2px solid #3d8bfd;
            border-radius: 6px;
            color: #fff;
            font-size: 0.75rem;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(13,110,253,0.4);
            transition: all 0.2s;
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.background = '#0b5ed7';
            btn.style.transform = 'translateY(-1px)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = '#0d6efd';
            btn.style.transform = '';
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openProcedureFromAlert(mapping);
        });

        return btn;
    }

    // ══════════════════════════════════════════════════════════
    // פתיחת נוהל מתוך התראה
    // ══════════════════════════════════════════════════════════
    openProcedureFromAlert(mapping) {
        if (typeof proceduresManager !== 'undefined') {
            proceduresManager.viewProcedureInModal(
                mapping.procedureFileName,
                mapping.procedureFolderPath || ''
            );
            return;
        }
        const url = `/Procedures/ViewFile?fileName=${encodeURIComponent(mapping.procedureFileName)}` +
            (mapping.procedureFolderPath
                ? `&folderPath=${encodeURIComponent(mapping.procedureFolderPath)}`
                : '');
        window.open(url, '_blank');
    }

    // ══════════════════════════════════════════════════════════
    // פאנל ניהול מיפויים - עדכון עם שדות HOST
    // ══════════════════════════════════════════════════════════
    async openAdminPanel() {
        const existing = document.getElementById('alertProcedureMappingPanel');
        if (existing) existing.remove();

        await this.loadMappings(true);
        await this.loadProceduresList();

        const panel = document.createElement('div');
        panel.id = 'alertProcedureMappingPanel';
        panel.className = 'apm-overlay';

        panel.innerHTML = `
            <div class="apm-box">

                <!-- כותרת -->
                <div class="apm-header">
                    <h3 class="apm-title">
                        <i class="fas fa-gear"></i>
                        ניהול מיפויי התראות ← נהלים
                    </h3>
                    <button class="apm-close-btn"
                            onclick="alertProcedureMappingManager.closeAdminPanel()">
                        &times;
                    </button>
                </div>

                <!-- טופס הוספה -->
                <div class="apm-add-section">
                    <h4 class="apm-section-title">
                        <i class="fas fa-plus-circle"></i>
                        הוסף / ערוך מיפוי
                    </h4>

                    <input type="hidden" id="apmEditId" value="">

                    <div class="apm-form-grid">

                        <!-- ══════════════════════════════════════ -->
                        <!-- תבנית חיפוש בהודעה                    -->
                        <!-- ══════════════════════════════════════ -->
                        <div class="apm-form-group">
                            <label class="apm-label">
                                <i class="fas fa-comment-dots"></i>
                                תבנית חיפוש בהודעת ההתראה
                                <span class="apm-optional-badge">אופציונלי</span>
                            </label>
                            <input type="text"
                                   id="apmPattern"
                                   class="apm-input"
                                   placeholder='example: "ping lost to" or "CPU usage"'
                                   autocomplete="off">
                        </div>

                        <!-- סוג התאמה להודעה -->
                        <div class="apm-form-group">
                            <label class="apm-label">
                                <i class="fas fa-filter"></i>
                                סוג התאמה להודעה
                            </label>
                            <select id="apmMatchType" class="apm-select">
                                <option value="contains">מכיל (contains)</option>
                                <option value="startswith">מתחיל ב (startsWith)</option>
                                <option value="endswith">מסתיים ב (endsWith)</option>
                                <option value="exact">התאמה מדויקת (exact)</option>
                                <option value="regex">ביטוי רגולרי (regex)</option>
                            </select>
                        </div>

                        <!-- ══════════════════════════════════════ -->
                        <!-- תנאי AND / OR                         -->
                        <!-- ══════════════════════════════════════ -->
                        <div class="apm-form-group apm-form-group--full apm-operator-row">
                            <label class="apm-label">
                                <i class="fas fa-code-branch"></i>
                                תנאי בין שתי התבניות
                            </label>
                            <div class="apm-operator-btns">
                                <button type="button"
                                        id="apmOpOR"
                                        class="apm-op-btn apm-op-btn--active"
                                        onclick="alertProcedureMappingManager.setOperator('OR')">
                                    <i class="fas fa-circle-half-stroke"></i>
                                    OR — מספיק אחד מהתנאים
                                </button>
                                <button type="button"
                                        id="apmOpAND"
                                        class="apm-op-btn"
                                        onclick="alertProcedureMappingManager.setOperator('AND')">
                                    <i class="fas fa-circle"></i>
                                    AND — שני התנאים חייבים להתקיים
                                </button>
                            </div>
                            <input type="hidden" id="apmConditionOperator" value="OR">
                        </div>

                        <!-- ══════════════════════════════════════ -->
                        <!-- תבנית חיפוש ב-HOST                    -->
                        <!-- ══════════════════════════════════════ -->
                        <div class="apm-form-group">
                            <label class="apm-label">
                                <i class="fas fa-server"></i>
                                תבנית חיפוש ב-HOST
                                <span class="apm-optional-badge">אופציונלי</span>
                            </label>
                            <input type="text"
                                   id="apmHostPattern"
                                   class="apm-input"
                                   placeholder='example: "srv-db" or "192.168.1"'
                                   autocomplete="off">
                        </div>

                        <!-- סוג התאמה ל-HOST -->
                        <div class="apm-form-group">
                            <label class="apm-label">
                                <i class="fas fa-filter"></i>
                                סוג התאמה ל-HOST
                            </label>
                            <select id="apmHostMatchType" class="apm-select">
                                <option value="contains">מכיל (contains)</option>
                                <option value="startswith">מתחיל ב (startsWith)</option>
                                <option value="endswith">מסתיים ב (endsWith)</option>
                                <option value="exact">התאמה מדויקת (exact)</option>
                                <option value="regex">ביטוי רגולרי (regex)</option>
                            </select>
                        </div>

                        <!-- ══════════════════════════════════════ -->
                        <!-- הערה הסברתית                          -->
                        <!-- ══════════════════════════════════════ -->
                        <div class="apm-form-group apm-form-group--full">
                            <div class="apm-hint-box">
                                <i class="fas fa-info-circle"></i>
                                <span>
                                    ניתן למלא <strong>הודעה בלבד</strong>,
                                    <strong>HOST בלבד</strong>, או <strong>שניהם</strong>.
                                    כאשר ממלאים שניהם — בחר <strong>OR</strong> להתאמה
                                    לפחות לאחד, או <strong>AND</strong> לדרישת שניהם.
                                </span>
                            </div>
                        </div>

                        <!-- ══════════════════════════════════════ -->
                        <!-- בחירת נוהל                            -->
                        <!-- ══════════════════════════════════════ -->
                        <div class="apm-form-group apm-form-group--full">
                            <label class="apm-label">
                                <i class="fas fa-book"></i>
                                נוהל מקושר *
                            </label>

                            <!-- שדה חיפוש נוהל -->
                            <div class="apm-procedure-search-wrap">
                                <input type="text"
                                       id="apmProcedureSearch"
                                       class="apm-input"
                                       placeholder="חפש נוהל לפי שם..."
                                       autocomplete="off">
                                <div id="apmProcedureDropdown"
                                     class="apm-procedure-dropdown"
                                     style="display:none;">
                                </div>
                            </div>

                            <!-- תצוגת נוהל נבחר -->
                            <div id="apmSelectedProcedure"
                                 class="apm-selected-procedure"
                                 style="display:none;">
                                <i class="fas fa-check-circle"
                                   style="color:#28a745"></i>
                                <span id="apmSelectedProcedureName"></span>
                                <button class="apm-clear-procedure-btn"
                                        onclick="alertProcedureMappingManager
                                                 .clearSelectedProcedure()">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>

                            <!-- שדות נסתרים לנוהל הנבחר -->
                            <input type="hidden" id="apmProcedureFileName">
                            <input type="hidden" id="apmProcedureFolderPath">
                        </div>

                        <!-- תיאור -->
                        <div class="apm-form-group apm-form-group--full">
                            <label class="apm-label">
                                <i class="fas fa-comment"></i>
                                תיאור (אופציונלי)
                            </label>
                            <input type="text"
                                   id="apmDescription"
                                   class="apm-input"
                                   placeholder="תיאור קצר של המיפוי...">
                        </div>

                    </div><!-- /apm-form-grid -->

                    <!-- כפתורי פעולה -->
                    <div class="apm-form-actions">
                        <button class="apm-btn apm-btn--secondary"
                                onclick="alertProcedureMappingManager.resetForm()">
                            <i class="fas fa-undo"></i>
                            נקה טופס
                        </button>
                        <button class="apm-btn apm-btn--primary"
                                id="apmSaveBtn"
                                onclick="alertProcedureMappingManager.saveMapping()">
                            <i class="fas fa-save"></i>
                            שמור מיפוי
                        </button>
                    </div>

                </div><!-- /apm-add-section -->

                <!-- רשימת מיפויים קיימים -->
                <div class="apm-list-section">
                    <h4 class="apm-section-title">
                        <i class="fas fa-list"></i>
                        מיפויים קיימים
                        <span class="apm-count-badge" id="apmMappingsCount">
                            ${this.mappings.length}
                        </span>
                    </h4>

                    <div id="apmMappingsList" class="apm-mappings-list">
                        ${this._renderMappingsList()}
                    </div>
                </div>

            </div><!-- /apm-box -->
        `;

        document.body.appendChild(panel);
        this._injectStyles();
        this._initProcedureSearch();
    }

    // ══════════════════════════════════════════════════════════
    // הגדרת operator AND / OR
    // ══════════════════════════════════════════════════════════
    setOperator(op) {
        document.getElementById('apmConditionOperator').value = op;

        const orBtn = document.getElementById('apmOpOR');
        const andBtn = document.getElementById('apmOpAND');

        if (op === 'OR') {
            orBtn?.classList.add('apm-op-btn--active');
            andBtn?.classList.remove('apm-op-btn--active');
        } else {
            andBtn?.classList.add('apm-op-btn--active');
            orBtn?.classList.remove('apm-op-btn--active');
        }
    }

    // ══════════════════════════════════════════════════════════
    // רינדור רשימת המיפויים - עדכון עם HOST
    // ══════════════════════════════════════════════════════════
    _renderMappingsList() {
        if (!this.mappings.length) {
            return `
                <div class="apm-empty">
                    <i class="fas fa-inbox"></i>
                    <p>אין מיפויים עדיין</p>
                    <small>הוסף מיפוי ראשון בטופס למעלה</small>
                </div>
            `;
        }

        const matchTypeLabels = {
            contains: 'מכיל',
            startswith: 'מתחיל ב',
            endswith: 'מסתיים ב',
            exact: 'מדויק',
            regex: 'Regex'
        };

        return this.mappings.map(m => {

            // ── בנה תצוגת תבניות ──
            const hasMsg = !!(m.pattern);
            const hasHost = !!(m.hostPattern);
            const op = (m.conditionOperator || 'OR').toUpperCase();

            let patternsHTML = '';

            if (hasMsg) {
                patternsHTML += `
                    <div class="apm-mapping-pattern">
                        <i class="fas fa-comment-dots" title="הודעה"></i>
                        <strong>${this._escHtml(m.pattern)}</strong>
                        <span class="apm-match-badge apm-match-${m.matchType || 'contains'}">
                            ${matchTypeLabels[m.matchType] || m.matchType}
                        </span>
                    </div>`;
            }

            if (hasMsg && hasHost) {
                patternsHTML += `
                    <div class="apm-operator-label apm-operator-${op.toLowerCase()}">
                        <i class="fas fa-code-branch"></i>
                        ${op}
                    </div>`;
            }

            if (hasHost) {
                patternsHTML += `
                    <div class="apm-mapping-pattern">
                        <i class="fas fa-server" title="HOST"></i>
                        <strong>${this._escHtml(m.hostPattern)}</strong>
                        <span class="apm-match-badge apm-match-${m.hostMatchType || 'contains'}">
                            ${matchTypeLabels[m.hostMatchType] || m.hostMatchType}
                        </span>
                    </div>`;
            }

            return `
            <div class="apm-mapping-item" data-id="${m.id}">

                <div class="apm-mapping-left">

                    ${patternsHTML}

                    <div class="apm-mapping-procedure">
                        <i class="fas fa-arrow-right apm-arrow"></i>
                        <i class="fas fa-book-open" style="color:#0d6efd"></i>
                        <span>${this._escHtml(m.procedureName || m.procedureFileName)}</span>
                        ${m.procedureFolderPath
                    ? `<span class="apm-folder-badge">
                                   <i class="fas fa-folder"></i>
                                   ${this._escHtml(m.procedureFolderPath)}
                               </span>`
                    : ''}
                    </div>

                    ${m.description
                    ? `<div class="apm-mapping-desc">
                               <i class="fas fa-comment"></i>
                               ${this._escHtml(m.description)}
                           </div>`
                    : ''}
                </div>

                <div class="apm-mapping-actions">
                    <button class="apm-action-btn apm-action-edit"
                            title="ערוך"
                            onclick="alertProcedureMappingManager.editMapping('${m.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="apm-action-btn apm-action-test"
                            title="בדוק התאמה"
                            onclick="alertProcedureMappingManager.testMapping('${m.id}')">
                        <i class="fas fa-vial"></i>
                    </button>
                    <button class="apm-action-btn apm-action-delete"
                            title="מחק"
                            onclick="alertProcedureMappingManager.deleteMapping('${m.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>

            </div>
        `;
        }).join('');
    }

    // ══════════════════════════════════════════════════════════
    // אתחול חיפוש נהלים
    // ══════════════════════════════════════════════════════════
    _initProcedureSearch() {
        const input = document.getElementById('apmProcedureSearch');
        const dropdown = document.getElementById('apmProcedureDropdown');
        if (!input || !dropdown) return;

        input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();
            if (!term) { dropdown.style.display = 'none'; return; }

            const matches = this.procedures.filter(p =>
                p.name.toLowerCase().includes(term) ||
                p.fileName.toLowerCase().includes(term) ||
                (p.folderPath || '').toLowerCase().includes(term)
            ).slice(0, 15);

            if (!matches.length) {
                dropdown.innerHTML = `
                    <div class="apm-dropdown-empty">
                        <i class="fas fa-search"></i> לא נמצאו נהלים
                    </div>`;
                dropdown.style.display = 'block';
                return;
            }

            dropdown.innerHTML = matches.map(p => `
                <div class="apm-dropdown-item"
                     data-filename="${this._escHtml(p.fileName)}"
                     data-folder="${this._escHtml(p.folderPath || '')}"
                     data-name="${this._escHtml(p.name)}">
                    <i class="${p.icon || 'fas fa-file'} apm-dropdown-icon"></i>
                    <div class="apm-dropdown-info">
                        <div class="apm-dropdown-name">
                            ${this._highlight(p.name, term)}
                        </div>
                        ${p.folderPath
                    ? `<div class="apm-dropdown-folder">
                                   <i class="fas fa-folder"></i>
                                   ${this._escHtml(p.folderPath)}
                               </div>`
                    : ''}
                    </div>
                </div>
            `).join('');

            // מאזיני לחיצה על פריטים
            dropdown.querySelectorAll('.apm-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.selectProcedure(
                        item.dataset.filename,
                        item.dataset.folder,
                        item.dataset.name
                    );
                });
            });

            dropdown.style.display = 'block';
        });

        // סגור dropdown בלחיצה מחוץ
        document.addEventListener('click', (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });

        // ניווט במקלדת
        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.apm-dropdown-item');
            const active = dropdown.querySelector('.apm-dropdown-item.active');
            let idx = active ? [...items].indexOf(active) : -1;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (active) active.classList.remove('active');
                idx = Math.min(idx + 1, items.length - 1);
                items[idx]?.classList.add('active');
                items[idx]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (active) active.classList.remove('active');
                idx = Math.max(idx - 1, 0);
                items[idx]?.classList.add('active');
                items[idx]?.scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter' && active) {
                e.preventDefault();
                active.click();
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
            }
        });
    }

    // ══════════════════════════════════════════════════════════
    // בחירת נוהל מה-dropdown
    // ══════════════════════════════════════════════════════════
    selectProcedure(fileName, folderPath, displayName) {
        document.getElementById('apmProcedureFileName').value = fileName;
        document.getElementById('apmProcedureFolderPath').value = folderPath;
        document.getElementById('apmProcedureSearch').value = '';

        const nameEl = document.getElementById('apmSelectedProcedureName');
        const wrap = document.getElementById('apmSelectedProcedure');
        const dd = document.getElementById('apmProcedureDropdown');

        if (nameEl) nameEl.textContent =
            displayName + (folderPath ? ` (${folderPath})` : '');
        if (wrap) wrap.style.display = 'flex';
        if (dd) dd.style.display = 'none';
    }

    clearSelectedProcedure() {
        document.getElementById('apmProcedureFileName').value = '';
        document.getElementById('apmProcedureFolderPath').value = '';
        document.getElementById('apmProcedureSearch').value = '';
        const wrap = document.getElementById('apmSelectedProcedure');
        if (wrap) wrap.style.display = 'none';
    }

    // ══════════════════════════════════════════════════════════
    // שמירת מיפוי - עדכון עם שדות HOST
    // ══════════════════════════════════════════════════════════
    async saveMapping() {
        const pattern = document.getElementById('apmPattern')?.value.trim() || '';
        const matchType = document.getElementById('apmMatchType')?.value || 'contains';
        const hostPattern = document.getElementById('apmHostPattern')?.value.trim() || '';
        const hostMatchType = document.getElementById('apmHostMatchType')?.value || 'contains';
        const conditionOperator = document.getElementById('apmConditionOperator')?.value || 'OR';
        const fileName = document.getElementById('apmProcedureFileName')?.value || '';
        const folderPath = document.getElementById('apmProcedureFolderPath')?.value || '';
        const description = document.getElementById('apmDescription')?.value.trim() || '';
        const editId = document.getElementById('apmEditId')?.value || '';
        const procedureName = document.getElementById('apmSelectedProcedureName')
            ?.textContent?.split(' (')[0] || '';

        // ── ולידציה ──────────────────────────────────────────
        if (!pattern && !hostPattern) {
            this._showNotification(
                'יש להזין לפחות תבנית חיפוש אחת (הודעה או HOST)', 'error');
            return;
        }
        if (!fileName) {
            this._showFormError('apmProcedureSearch', 'יש לבחור נוהל');
            return;
        }

        // ── שלח לשרת ─────────────────────────────────────────
        const saveBtn = document.getElementById('apmSaveBtn');
        const origHtml = saveBtn?.innerHTML;
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const res = await fetch('/AlertProcedureMapping/SaveMapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    id: editId || null,
                    pattern,
                    matchType,
                    hostPattern,
                    hostMatchType,
                    conditionOperator,
                    procedureFileName: fileName,
                    procedureName,
                    procedureFolderPath: folderPath,
                    description
                })
            });

            const data = await res.json();

            if (data.success) {
                this._showNotification(
                    editId ? 'המיפוי עודכן בהצלחה' : 'המיפוי נשמר בהצלחה',
                    'success'
                );
                this.resetForm();
                await this.loadMappings(true);
                this._refreshMappingsList();
            } else {
                this._showNotification(data.message || 'שגיאה בשמירה', 'error');
            }
        } catch (err) {
            this._showNotification('שגיאת רשת: ' + err.message, 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = origHtml;
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // עריכת מיפוי - עדכון עם שדות HOST
    // ══════════════════════════════════════════════════════════
    editMapping(id) {
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        const patternEl = document.getElementById('apmPattern');
        const matchTypeEl = document.getElementById('apmMatchType');
        const hostPatternEl = document.getElementById('apmHostPattern');
        const hostMatchTypeEl = document.getElementById('apmHostMatchType');
        const descEl = document.getElementById('apmDescription');
        const editIdEl = document.getElementById('apmEditId');
        const saveBtnEl = document.getElementById('apmSaveBtn');

        if (patternEl) patternEl.value = mapping.pattern || '';
        if (matchTypeEl) matchTypeEl.value = mapping.matchType || 'contains';
        if (hostPatternEl) hostPatternEl.value = mapping.hostPattern || '';
        if (hostMatchTypeEl) hostMatchTypeEl.value = mapping.hostMatchType || 'contains';
        if (descEl) descEl.value = mapping.description || '';
        if (editIdEl) editIdEl.value = mapping.id;

        // *** עדכן operator ***
        this.setOperator((mapping.conditionOperator || 'OR').toUpperCase());

        this.selectProcedure(
            mapping.procedureFileName,
            mapping.procedureFolderPath || '',
            mapping.procedureName || mapping.procedureFileName
        );

        if (saveBtnEl) {
            saveBtnEl.innerHTML = '<i class="fas fa-save"></i> עדכן מיפוי';
        }

        document.querySelector('.apm-add-section')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        patternEl?.focus();
    }

    // ══════════════════════════════════════════════════════════
    // מחיקת מיפוי (ללא שינוי)
    // ══════════════════════════════════════════════════════════
    async deleteMapping(id) {
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        const lines = [`האם למחוק את המיפוי?`];
        if (mapping.pattern) lines.push(`הודעה: "${mapping.pattern}"`);
        if (mapping.hostPattern) lines.push(`HOST: "${mapping.hostPattern}"`);
        lines.push(`נוהל: "${mapping.procedureName || mapping.procedureFileName}"`);

        if (!confirm(lines.join('\n'))) return;

        try {
            const res = await fetch(
                `/AlertProcedureMapping/DeleteMapping?id=${encodeURIComponent(id)}`,
                { method: 'DELETE', credentials: 'include' }
            );
            const data = await res.json();

            if (data.success) {
                this._showNotification('המיפוי נמחק בהצלחה', 'success');
                await this.loadMappings(true);
                this._refreshMappingsList();
            } else {
                this._showNotification(data.message || 'שגיאה במחיקה', 'error');
            }
        } catch (err) {
            this._showNotification('שגיאת רשת: ' + err.message, 'error');
        }
    }

    // ══════════════════════════════════════════════════════════
    // בדיקת מיפוי - פופאפ מותאם עם הודעה + HOST באותו חלון
    // ══════════════════════════════════════════════════════════
    testMapping(id) {
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        const hasMsg = !!(mapping.pattern);
        const hasHost = !!(mapping.hostPattern);
        const op = (mapping.conditionOperator || 'OR').toUpperCase();

        // ── הסר פופאפ קיים ──
        const existingPopup = document.getElementById('apmTestPopup');
        if (existingPopup) existingPopup.remove();

        // ── בנה שורות מידע על המיפוי ──
        let mappingInfoHTML = '';
        if (hasMsg) {
            mappingInfoHTML += `
            <div class="apm-test-info-row">
                <span class="apm-test-info-icon">
                    <i class="fas fa-comment-dots"></i>
                </span>
                <span class="apm-test-info-label">הודעה:</span>
                <code class="apm-test-code">${this._escHtml(mapping.pattern)}</code>
                <span class="apm-match-badge apm-match-${mapping.matchType || 'contains'}">
                    ${mapping.matchType || 'contains'}
                </span>
            </div>`;
        }
        if (hasMsg && hasHost) {
            mappingInfoHTML += `
            <div class="apm-test-info-row">
                <span class="apm-test-info-icon">
                    <i class="fas fa-code-branch"></i>
                </span>
                <span class="apm-operator-label apm-operator-${op.toLowerCase()}">
                    ${op}
                </span>
            </div>`;
        }
        if (hasHost) {
            mappingInfoHTML += `
            <div class="apm-test-info-row">
                <span class="apm-test-info-icon">
                    <i class="fas fa-server"></i>
                </span>
                <span class="apm-test-info-label">HOST:</span>
                <code class="apm-test-code">${this._escHtml(mapping.hostPattern)}</code>
                <span class="apm-match-badge apm-match-${mapping.hostMatchType || 'contains'}">
                    ${mapping.hostMatchType || 'contains'}
                </span>
            </div>`;
        }

        // ── צור פופאפ ──
        const popup = document.createElement('div');
        popup.id = 'apmTestPopup';
        popup.className = 'apm-test-overlay';
        popup.innerHTML = `
        <div class="apm-test-box">

            <!-- כותרת -->
            <div class="apm-test-header">
                <h3 class="apm-test-title">
                    <i class="fas fa-vial"></i>
                    בדיקת התאמת מיפוי
                </h3>
                <button class="apm-close-btn" id="apmTestCloseBtn">&times;</button>
            </div>

            <!-- מידע על המיפוי -->
            <div class="apm-test-mapping-info">
                <div class="apm-test-info-title">
                    <i class="fas fa-info-circle"></i>
                    פרטי המיפוי הנבדק
                </div>
                ${mappingInfoHTML}
                <div class="apm-test-info-row apm-test-info-procedure">
                    <span class="apm-test-info-icon">
                        <i class="fas fa-book-open" style="color:#0d6efd"></i>
                    </span>
                    <span class="apm-test-info-label">נוהל:</span>
                    <span class="apm-test-procedure-name">
                        ${this._escHtml(mapping.procedureName || mapping.procedureFileName)}
                    </span>
                </div>
            </div>

            <!-- שדות קלט -->
            <div class="apm-test-inputs">

                <div class="apm-test-input-group">
                    <label class="apm-test-label" for="apmTestMessage">
                        <i class="fas fa-comment-dots"></i>
                        הודעת התראה לבדיקה
                    </label>
                    <input type="text"
                           id="apmTestMessage"
                           class="apm-test-input"
                           placeholder='for example: "ping lost to 192.168.1.1"'
                           autocomplete="off">
                </div>

                <div class="apm-test-input-group">
                    <label class="apm-test-label" for="apmTestHost">
                        <i class="fas fa-server"></i>
                        HOST לבדיקה
                    </label>
                    <input type="text"
                           id="apmTestHost"
                           class="apm-test-input"
                           placeholder='for example: "srv-db-01" או "192.168.1.5"'
                           autocomplete="off">
                </div>

            </div>

            <!-- אזור תוצאה -->
            <div id="apmTestResult" class="apm-test-result" style="display:none;"></div>

            <!-- כפתורים -->
            <div class="apm-test-actions">
                <button class="apm-btn apm-btn--secondary" id="apmTestCancelBtn">
                    <i class="fas fa-times"></i>
                    סגור
                </button>
                <button class="apm-btn apm-btn--primary" id="apmTestRunBtn">
                    <i class="fas fa-play"></i>
                    בצע בדיקה
                </button>
            </div>

        </div>
    `;

        document.body.appendChild(popup);
        this._injectTestStyles();

        // ── מאזינים ──
        const closeBtn = document.getElementById('apmTestCloseBtn');
        const cancelBtn = document.getElementById('apmTestCancelBtn');
        const runBtn = document.getElementById('apmTestRunBtn');
        const msgInput = document.getElementById('apmTestMessage');
        const hostInput = document.getElementById('apmTestHost');
        const resultEl = document.getElementById('apmTestResult');

        const closePopup = () => popup.remove();

        closeBtn.addEventListener('click', closePopup);
        cancelBtn.addEventListener('click', closePopup);

        // Enter מריץ בדיקה
        [msgInput, hostInput].forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') runBtn.click();
                if (e.key === 'Escape') closePopup();
            });
        });

        // ── לוגיקת הבדיקה ──
        runBtn.addEventListener('click', () => {
            const testMsg = msgInput.value.trim();
            const testHost = hostInput.value.trim();

            // ── חשב התאמות ──
            const msgLower = testMsg.toLowerCase();
            const hostLower = testHost.toLowerCase();

            const messageMatch = hasMsg
                ? this._isPatternMatch(
                    msgLower, testMsg,
                    mapping.pattern,
                    mapping.matchType || 'contains'
                )
                : null;

            const hostMatch = hasHost
                ? this._isPatternMatch(
                    hostLower, testHost,
                    mapping.hostPattern,
                    mapping.hostMatchType || 'contains'
                )
                : null;

            // ── תוצאה סופית ──
            let isMatch = false;
            if (!hasMsg && hasHost) isMatch = hostMatch;
            else if (hasMsg && !hasHost) isMatch = messageMatch;
            else if (hasMsg && hasHost) {
                isMatch = op === 'AND'
                    ? (messageMatch && hostMatch)
                    : (messageMatch || hostMatch);
            }

            // ── בנה HTML תוצאה ──
            const rowIcon = (val) => {
                if (val === null) return '<i class="fas fa-circle apm-test-neutral"></i>';
                return val
                    ? '<i class="fas fa-check-circle apm-test-pass"></i>'
                    : '<i class="fas fa-times-circle apm-test-fail"></i>';
            };

            let detailsHTML = '';

            // שורת הודעה
            // Message row
            detailsHTML += `
            <div class="apm-test-detail-row">
                ${rowIcon(messageMatch)}
                <span class="apm-test-detail-label">Message:</span>
                <span class="apm-test-detail-value">
                    ${testMsg
                    ? `"<strong>${this._escHtml(testMsg)}</strong>"`
                    : '<em class="apm-test-empty">Empty</em>'}
                </span>
                ${hasMsg
                    ? `<span class="apm-test-detail-pattern">
                        Pattern: <code>${this._escHtml(mapping.pattern)}</code>
                    </span>`
                    : '<span class="apm-test-detail-na">Not Defined</span>'}
            </div>`;

            // HOST row
            detailsHTML += `
            <div class="apm-test-detail-row">
                ${rowIcon(hostMatch)}
                <span class="apm-test-detail-label">Host:</span>
                <span class="apm-test-detail-value">
                    ${testHost
                    ? `"<strong>${this._escHtml(testHost)}</strong>"`
                    : '<em class="apm-test-empty">Empty</em>'}
                </span>
                ${hasHost
                    ? `<span class="apm-test-detail-pattern">
               Pattern: <code>${this._escHtml(mapping.hostPattern)}</code>
                       </span>`
                    : '<span class="apm-test-detail-na">Not Defined</span>'}
            </div>`;

            // AND/OR condition row
            if (hasMsg && hasHost) {
                detailsHTML += `
                <div class="apm-test-detail-divider"></div>
                <div class="apm-test-detail-row apm-test-detail-op">
                    <i class="fas fa-code-branch"></i>
                    <span><strong>${op}</strong> Condition:
                        ${op === 'AND'
                        ? `Both are required — Message ${messageMatch ? '✅' : '❌'} AND Host ${hostMatch ? '✅' : '❌'}`
                        : `Only one is required — Message ${messageMatch ? '✅' : '❌'} OR Host ${hostMatch ? '✅' : '❌'}`
                    }
                    </span>
                </div>`;
            }

            resultEl.innerHTML = `
            <div class="apm-test-result-banner ${isMatch ? 'apm-test-success' : 'apm-test-failure'}">
                <i class="fas ${isMatch ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                <span>${isMatch ? 'Match Successful!' : 'Match Failed'}</span>
                ${isMatch
                    ? `<span class="apm-test-procedure-badge">
                           <i class="fas fa-book-open"></i>
                           ${this._escHtml(mapping.procedureName || mapping.procedureFileName)}
                       </span>`
                    : ''}
            </div>
            <div class="apm-test-details">
                ${detailsHTML}
            </div>
        `;

            resultEl.style.display = 'block';

            // אנימציה קלה
            resultEl.style.opacity = '0';
            requestAnimationFrame(() => {
                resultEl.style.transition = 'opacity 0.25s ease';
                resultEl.style.opacity = '1';
            });
        });

        // פוקוס אוטומטי
        setTimeout(() => msgInput.focus(), 50);
    }

    // ══════════════════════════════════════════════════════════
    // סגנונות לפופאפ הבדיקה
    // ══════════════════════════════════════════════════════════
    _injectTestStyles() {
        if (document.getElementById('apmTestStyles')) return;

        const style = document.createElement('style');
        style.id = 'apmTestStyles';
        style.textContent = `

    /* ── Overlay ── */
    .apm-test-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.55);
        z-index: 10100;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        backdrop-filter: blur(3px);
    }

    /* ── Box ── */
    .apm-test-box {
        background: #fff;
        border-radius: 16px;
        width: 100%;
        max-width: 560px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        direction: rtl;
    }

    /* ── Header ── */
    .apm-test-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 22px 14px;
        border-bottom: 2px solid #f0f0f0;
        background: #fff;
        border-radius: 16px 16px 0 0;
        position: sticky;
        top: 0;
        z-index: 5;
    }
    .apm-test-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 700;
        color: #320F5B;
        display: flex;
        align-items: center;
        gap: 9px;
    }
    .apm-test-title i { color: #667eea; }

    /* ── Mapping Info ── */
    .apm-test-mapping-info {
        margin: 16px 22px 0;
        padding: 14px 16px;
        background: #f8f9ff;
        border: 1.5px solid #e0e4f8;
        border-radius: 10px;
    }
    .apm-test-info-title {
        font-size: 0.78rem;
        font-weight: 700;
        color: #667eea;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    .apm-test-info-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.85rem;
        color: #444;
        margin-bottom: 6px;
        flex-wrap: wrap;
    }
    .apm-test-info-row:last-child { margin-bottom: 0; }
    .apm-test-info-icon { color: #667eea; width: 18px; text-align: center; }
    .apm-test-info-label {
        font-weight: 700;
        color: #555;
        min-width: 48px;
    }
    .apm-test-code {
        background: #eef0fb;
        color: #3730a3;
        padding: 2px 8px;
        border-radius: 5px;
        font-size: 0.82rem;
        font-family: monospace;
    }
    .apm-test-info-procedure { margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e4f8; }
    .apm-test-procedure-name { font-weight: 700; color: #0d6efd; }

    /* ── Inputs ── */
    .apm-test-inputs {
        padding: 18px 22px 0;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .apm-test-input-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .apm-test-label {
        font-size: 0.82rem;
        font-weight: 600;
        color: #555;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .apm-test-label i { color: #667eea; font-size: 0.78rem; }
    .apm-test-input {
        padding: 9px 12px;
        border: 1.5px solid #dde1e7;
        border-radius: 8px;
        font-size: 0.9rem;
        color: #333;
        background: #fff;
        transition: border-color 0.2s, box-shadow 0.2s;
        width: 100%;
        box-sizing: border-box;
        direction: ltr;
        text-align: left;
    }
    .apm-test-input:focus {
        outline: none;
        border-color: #667eea;
        box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
    }

    /* ── Result ── */
    .apm-test-result {
        margin: 16px 22px 0;
        border-radius: 10px;
        overflow: hidden;
        border: 1.5px solid #e0e0e0;
        direction: ltr;
    }
    .apm-test-result-banner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        font-size: 0.95rem;
        font-weight: 700;
        flex-wrap: wrap;
    }
    .apm-test-success {
        background: #e8f5e9;
        color: #2e7d32;
        border-bottom: 1.5px solid #a5d6a7;
    }
    .apm-test-failure {
        background: #fce4ec;
        color: #c62828;
        border-bottom: 1.5px solid #f48fb1;
    }
    .apm-test-success i { font-size: 1.1rem; color: #2e7d32; }
    .apm-test-failure i { font-size: 1.1rem; color: #c62828; }
    .apm-test-procedure-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: #fff;
        color: #0d6efd;
        border: 1.5px solid #90caf9;
        border-radius: 20px;
        padding: 2px 10px;
        font-size: 0.8rem;
        font-weight: 700;
        margin-right: auto;
    }

    /* ── Details ── */
    .apm-test-details {
        padding: 12px 16px;
        background: #fafafa;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .apm-test-detail-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.85rem;
        color: #444;
        flex-wrap: wrap;
    }
    .apm-test-detail-label {
        font-weight: 700;
        min-width: 52px;
        color: #555;
    }
    .apm-test-detail-value { color: #333; }
    .apm-test-detail-pattern {
        font-size: 0.78rem;
        color: #888;
        margin-right: auto;
    }
    .apm-test-detail-pattern code {
        background: #eef0fb;
        color: #3730a3;
        padding: 1px 5px;
        border-radius: 4px;
        font-size: 0.78rem;
    }
    .apm-test-detail-na {
        font-size: 0.75rem;
        color: #bbb;
        font-style: italic;
        margin-right: auto;
    }
    .apm-test-detail-op {
        font-size: 0.82rem;
        color: #555;
        gap: 7px;
    }
    .apm-test-detail-op i { color: #667eea; }
    .apm-test-detail-divider {
        height: 1px;
        background: #ebebeb;
        margin: 2px 0;
    }
    .apm-test-empty { color: #bbb; font-size: 0.82rem; }

    /* ── Icons ── */
    .apm-test-pass    { color: #2e7d32; font-size: 1rem; }
    .apm-test-fail    { color: #c62828; font-size: 1rem; }
    .apm-test-neutral { color: #bbb;    font-size: 0.7rem; }

    /* ── Actions ── */
    .apm-test-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 18px 22px;
    }

    /* ── Responsive ── */
    @media (max-width: 600px) {
        .apm-test-box { border-radius: 12px; }
        .apm-test-detail-pattern { margin-right: 0; width: 100%; }
    }
    `;

        document.head.appendChild(style);
    }

    // ══════════════════════════════════════════════════════════
    // איפוס טופס - עדכון עם שדות HOST
    // ══════════════════════════════════════════════════════════
    resetForm() {
        ['apmPattern', 'apmHostPattern', 'apmDescription', 'apmProcedureSearch']
            .forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });

        const matchTypeEl = document.getElementById('apmMatchType');
        const hostMatchTypeEl = document.getElementById('apmHostMatchType');
        if (matchTypeEl) matchTypeEl.value = 'contains';
        if (hostMatchTypeEl) hostMatchTypeEl.value = 'contains';

        const editIdEl = document.getElementById('apmEditId');
        if (editIdEl) editIdEl.value = '';

        const saveBtnEl = document.getElementById('apmSaveBtn');
        if (saveBtnEl) {
            saveBtnEl.innerHTML = '<i class="fas fa-save"></i> שמור מיפוי';
        }

        // *** אפס operator ל-OR ***
        this.setOperator('OR');

        this.clearSelectedProcedure();

        document.querySelectorAll('.apm-input.apm-error')
            .forEach(el => el.classList.remove('apm-error'));
    }

    // ══════════════════════════════════════════════════════════
    // רענון רשימת המיפויים בפאנל
    // ══════════════════════════════════════════════════════════
    _refreshMappingsList() {
        const listEl = document.getElementById('apmMappingsList');
        const countEl = document.getElementById('apmMappingsCount');

        if (listEl) listEl.innerHTML = this._renderMappingsList();
        if (countEl) countEl.textContent = this.mappings.length;
    }

    // ══════════════════════════════════════════════════════════
    // סגירת פאנל
    // ══════════════════════════════════════════════════════════
    closeAdminPanel() {
        const panel = document.getElementById('alertProcedureMappingPanel');
        if (panel) panel.remove();
    }

    // ══════════════════════════════════════════════════════════
    // הצגת שגיאה על שדה טופס
    // ══════════════════════════════════════════════════════════
    _showFormError(fieldId, message) {
        const field = document.getElementById(fieldId);
        if (!field) return;
        field.classList.add('apm-error');
        field.focus();
        setTimeout(() => field.classList.remove('apm-error'), 3000);
        this._showNotification(message, 'error');
    }

    // ══════════════════════════════════════════════════════════
    // הצגת הודעת toast
    // ══════════════════════════════════════════════════════════
    _showNotification(message, type = 'success') {
        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show(message, type);
            return;
        }
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? '#28a745' : '#dc3545'};
            color: white; padding: 10px 24px; border-radius: 8px;
            font-size: 0.95rem; font-weight: 600; z-index: 99999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ══════════════════════════════════════════════════════════
    // הדגשת מונח חיפוש בטקסט
    // ══════════════════════════════════════════════════════════
    _highlight(text, term) {
        if (!term) return this._escHtml(text);
        const escaped = this._escHtml(text);
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped.replace(
            new RegExp(`(${escapedTerm})`, 'gi'),
            '<mark style="background:#fff3cd;padding:0 2px;border-radius:2px">$1</mark>'
        );
    }

    // ══════════════════════════════════════════════════════════
    // Escape HTML
    // ══════════════════════════════════════════════════════════
    _escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ══════════════════════════════════════════════════════════
    // הזרקת סגנונות CSS לפאנל
    // ══════════════════════════════════════════════════════════
    _injectStyles() {
        if (document.getElementById('apmStyles')) return;

        const style = document.createElement('style');
        style.id = 'apmStyles';
        style.textContent = `

        /* ── Overlay ── */
        .apm-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            backdrop-filter: blur(3px);
        }

        /* ── Box ── */
        .apm-box {
            background: #fff;
            border-radius: 16px;
            width: 100%;
            max-width: 820px;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            display: flex;
            flex-direction: column;
            direction: rtl;
        }

        /* ── Header ── */
        .apm-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 20px 24px 16px;
            border-bottom: 2px solid #f0f0f0;
            position: sticky;
            top: 0;
            background: #fff;
            z-index: 10;
            border-radius: 16px 16px 0 0;
        }
        .apm-title {
            margin: 0;
            font-size: 1.15rem;
            font-weight: 700;
            color: #320F5B;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .apm-title i { color: #667eea; }

        .apm-close-btn {
            background: none;
            border: none;
            font-size: 1.6rem;
            cursor: pointer;
            color: #888;
            line-height: 1;
            padding: 0 4px;
            transition: color 0.2s;
        }
        .apm-close-btn:hover { color: #333; }

        /* ── Sections ── */
        .apm-add-section,
        .apm-list-section {
            padding: 20px 24px;
        }
        .apm-add-section {
            border-bottom: 2px solid #f0f0f0;
            background: #fafbff;
        }

        .apm-section-title {
            margin: 0 0 16px;
            font-size: 0.95rem;
            font-weight: 700;
            color: #444;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .apm-section-title i { color: #667eea; }

        .apm-count-badge {
            background: #667eea;
            color: #fff;
            border-radius: 12px;
            padding: 1px 9px;
            font-size: 0.8rem;
            font-weight: 700;
            margin-right: 6px;
        }

        /* ── Optional Badge ── */
        .apm-optional-badge {
            font-size: 0.7rem;
            font-weight: 600;
            background: #e8f5e9;
            color: #2e7d32;
            border-radius: 8px;
            padding: 1px 7px;
            margin-right: 6px;
            border: 1px solid #a5d6a7;
        }

        /* ── Hint Box ── */
        .apm-hint-box {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 10px 14px;
            background: #fffde7;
            border: 1.5px solid #fff176;
            border-radius: 8px;
            font-size: 0.82rem;
            color: #555;
            line-height: 1.5;
        }
        .apm-hint-box i {
            color: #f9a825;
            margin-top: 2px;
            flex-shrink: 0;
        }

        /* ── Operator Buttons ── */
        .apm-operator-row {
            margin: 2px 0 6px;
        }
        .apm-operator-btns {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 6px;
        }
        .apm-op-btn {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            padding: 8px 18px;
            border-radius: 9px;
            border: 2px solid #dde1e7;
            background: #f8f9fa;
            color: #666;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        .apm-op-btn:hover {
            border-color: #667eea;
            color: #667eea;
            background: #f0f4ff;
        }
        .apm-op-btn--active {
            border-color: #667eea;
            background: linear-gradient(135deg, #667eea22, #764ba222);
            color: #320F5B;
            box-shadow: 0 2px 8px rgba(102,126,234,0.2);
        }
        .apm-op-btn--active i {
            color: #667eea;
        }

        /* ── Form Grid ── */
        .apm-form-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
        }
        .apm-form-group--full {
            grid-column: 1 / -1;
        }
        .apm-form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .apm-label {
            font-size: 0.82rem;
            font-weight: 600;
            color: #555;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .apm-label i { color: #667eea; font-size: 0.78rem; }

        .apm-input,
        .apm-select {
            padding: 9px 12px;
            border: 1.5px solid #dde1e7;
            border-radius: 8px;
            font-size: 0.9rem;
            color: #333;
            background: #fff;
            transition: border-color 0.2s, box-shadow 0.2s;
            width: 100%;
            box-sizing: border-box;
            direction: rtl;
        }
        #apmPattern,
        #apmHostPattern {
            direction: ltr;
        }
        .apm-input:focus,
        .apm-select:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102,126,234,0.15);
        }
        .apm-input.apm-error {
            border-color: #dc3545;
            box-shadow: 0 0 0 3px rgba(220,53,69,0.15);
            animation: apmShake 0.3s ease;
        }
        @keyframes apmShake {
            0%,100% { transform: translateX(0); }
            25%      { transform: translateX(-6px); }
            75%      { transform: translateX(6px); }
        }

        /* ── Procedure Search ── */
        .apm-procedure-search-wrap {
            position: relative;
        }
        .apm-procedure-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            right: 0;
            left: 0;
            background: #fff;
            border: 1.5px solid #dde1e7;
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            z-index: 1000;
            max-height: 240px;
            overflow-y: auto;
        }
        .apm-dropdown-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 14px;
            cursor: pointer;
            transition: background 0.15s;
            border-bottom: 1px solid #f5f5f5;
        }
        .apm-dropdown-item:last-child { border-bottom: none; }
        .apm-dropdown-item:hover,
        .apm-dropdown-item.active     { background: #f0f4ff; }
        .apm-dropdown-icon {
            color: #667eea;
            font-size: 1rem;
            margin-top: 2px;
            flex-shrink: 0;
        }
        .apm-dropdown-info  { flex: 1; min-width: 0; }
        .apm-dropdown-name  {
            font-size: 0.88rem;
            font-weight: 600;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .apm-dropdown-folder {
            font-size: 0.75rem;
            color: #888;
            margin-top: 2px;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .apm-dropdown-empty {
            padding: 16px;
            text-align: center;
            color: #aaa;
            font-size: 0.88rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        /* ── Selected Procedure ── */
        .apm-selected-procedure {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            background: #e8f5e9;
            border: 1.5px solid #a5d6a7;
            border-radius: 8px;
            font-size: 0.88rem;
            color: #2e7d32;
            font-weight: 600;
            margin-top: 6px;
        }
        .apm-clear-procedure-btn {
            background: none;
            border: none;
            cursor: pointer;
            color: #888;
            margin-right: auto;
            padding: 0 4px;
            font-size: 0.85rem;
            transition: color 0.2s;
        }
        .apm-clear-procedure-btn:hover { color: #dc3545; }

        /* ── Form Actions ── */
        .apm-form-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 18px;
        }
        .apm-btn {
            padding: 9px 20px;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            border: none;
            display: inline-flex;
            align-items: center;
            gap: 7px;
            transition: all 0.2s;
        }
        .apm-btn--primary {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
            box-shadow: 0 3px 10px rgba(102,126,234,0.35);
        }
        .apm-btn--primary:hover {
            transform: translateY(-1px);
            box-shadow: 0 5px 14px rgba(102,126,234,0.45);
        }
        .apm-btn--primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        .apm-btn--secondary {
            background: #f0f0f0;
            color: #555;
        }
        .apm-btn--secondary:hover { background: #e0e0e0; }

        /* ── Mappings List ── */
        .apm-mappings-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .apm-mapping-item {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            padding: 14px 16px;
            background: #fff;
            border: 1.5px solid #e8eaf0;
            border-radius: 10px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .apm-mapping-item:hover {
            border-color: #667eea;
            box-shadow: 0 2px 10px rgba(102,126,234,0.1);
        }
        .apm-mapping-left { flex: 1; min-width: 0; }

        /* ── Pattern rows ── */
        .apm-mapping-pattern {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            color: #333;
            flex-wrap: wrap;
            margin-bottom: 4px;
        }
        .apm-mapping-pattern i { color: #667eea; }

        /* ── Operator label ── */
        .apm-operator-label {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-size: 0.72rem;
            font-weight: 800;
            padding: 2px 10px;
            border-radius: 10px;
            margin: 3px 0;
            letter-spacing: 0.05em;
        }
        .apm-operator-or  {
            background: #e3f2fd;
            color: #1565c0;
            border: 1px solid #90caf9;
        }
        .apm-operator-and {
            background: #fce4ec;
            color: #c62828;
            border: 1px solid #f48fb1;
        }

        /* ── Match badges ── */
        .apm-match-badge {
            font-size: 0.72rem;
            font-weight: 700;
            padding: 2px 8px;
            border-radius: 10px;
            text-transform: uppercase;
        }
        .apm-match-contains   { background:#e3f2fd; color:#1565c0; }
        .apm-match-exact      { background:#fce4ec; color:#c62828; }
        .apm-match-startswith { background:#e8f5e9; color:#2e7d32; }
        .apm-match-endswith   { background:#fff3e0; color:#e65100; }
        .apm-match-regex      { background:#f3e5f5; color:#6a1b9a; }

        /* ── Procedure row ── */
        .apm-mapping-procedure {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85rem;
            color: #555;
            margin-top: 6px;
            flex-wrap: wrap;
        }
        .apm-arrow { color: #ccc; font-size: 0.75rem; }

        .apm-folder-badge {
            font-size: 0.72rem;
            background: #f5f5f5;
            color: #888;
            padding: 2px 7px;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .apm-mapping-desc {
            font-size: 0.78rem;
            color: #aaa;
            margin-top: 5px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        /* ── Action buttons ── */
        .apm-mapping-actions {
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        }
        .apm-action-btn {
            width: 32px;
            height: 32px;
            border-radius: 7px;
            border: 1.5px solid #e0e0e0;
            background: #fafafa;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.82rem;
            transition: all 0.2s;
            color: #666;
        }
        .apm-action-edit:hover   { background:#e3f2fd; border-color:#1976d2; color:#1976d2; }
        .apm-action-test:hover   { background:#e8f5e9; border-color:#388e3c; color:#388e3c; }
        .apm-action-delete:hover { background:#fce4ec; border-color:#c62828; color:#c62828; }

        /* ── Empty State ── */
        .apm-empty {
            text-align: center;
            padding: 40px 20px;
            color: #bbb;
        }
        .apm-empty i     { font-size: 2.5rem; margin-bottom: 12px; display: block; }
        .apm-empty p     { font-size: 1rem; font-weight: 600; margin: 0 0 6px; }
        .apm-empty small { font-size: 0.82rem; }

        /* ── כפתור נוהל בטבלת ההתראות ── */
        .alert-procedure-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 3px 8px;
            height: 24px;
            background: #0d6efd;
            border: 2px solid #3d8bfd;
            border-radius: 6px;
            color: #fff;
            font-size: 0.75rem;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            box-shadow: 0 2px 6px rgba(13,110,253,0.4);
            transition: all 0.2s;
        }
        .alert-procedure-btn:hover {
            background: #0b5ed7;
            transform: translateY(-1px);
            box-shadow: 0 4px 10px rgba(13,110,253,0.5);
        }

        /* ── Responsive ── */
        @media (max-width: 600px) {
            .apm-form-grid        { grid-template-columns: 1fr; }
            .apm-form-group--full { grid-column: 1; }
            .apm-box              { border-radius: 12px; }
            .apm-operator-btns   { flex-direction: column; }
        }
        `;

        document.head.appendChild(style);
    }
}

// ══════════════════════════════════════════════════════════════
// יצירת מופע גלובלי
// ══════════════════════════════════════════════════════════════
const alertProcedureMappingManager = new AlertProcedureMappingManager();