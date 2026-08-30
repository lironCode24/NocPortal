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
    findMatchingProcedure(message) {
        if (!message || !this.mappings.length) return null;

        const msgLower = message.toLowerCase();

        for (const mapping of this.mappings) {
            if (!mapping.pattern) continue;

            const patternLower = mapping.pattern.toLowerCase();
            let isMatch = false;

            switch ((mapping.matchType || 'contains').toLowerCase()) {
                case 'exact':
                    isMatch = msgLower === patternLower;
                    break;
                case 'startswith':
                    isMatch = msgLower.startsWith(patternLower);
                    break;
                case 'endswith':
                    isMatch = msgLower.endsWith(patternLower);
                    break;
                case 'regex':
                    try {
                        isMatch = new RegExp(mapping.pattern, 'i').test(message);
                    } catch { isMatch = false; }
                    break;
                case 'contains':
                default:
                    isMatch = msgLower.includes(patternLower);
                    break;
            }

            if (isMatch) return mapping;
        }

        return null;
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

        // fallback
        const url = `/Procedures/ViewFile?fileName=${encodeURIComponent(mapping.procedureFileName)}` +
            (mapping.procedureFolderPath
                ? `&folderPath=${encodeURIComponent(mapping.procedureFolderPath)}`
                : '');
        window.open(url, '_blank');
    }

    // ══════════════════════════════════════════════════════════
    // פאנל ניהול מיפויים (Admin)
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

                    <!-- שדה מזהה נסתר לעריכה -->
                    <input type="hidden" id="apmEditId" value="">

                    <div class="apm-form-grid">

                        <!-- תבנית חיפוש -->
                        <div class="apm-form-group">
                            <label class="apm-label">
                                <i class="fas fa-search"></i>
                                תבנית חיפוש בהודעת ההתראה *
                            </label>
                            <input type="text"
                                   id="apmPattern"
                                   class="apm-input"
                                   placeholder='For example: "ping lost to" or "CPU usage"'
                                   autocomplete="off">
                        </div>

                        <!-- סוג התאמה -->
                        <div class="apm-form-group">
                            <label class="apm-label">
                                <i class="fas fa-filter"></i>
                                סוג התאמה
                            </label>
                            <select id="apmMatchType" class="apm-select">
                                <option value="contains">מכיל (contains)</option>
                                <option value="startswith">מתחיל ב (startsWith)</option>
                                <option value="endswith">מסתיים ב (endsWith)</option>
                                <option value="exact">התאמה מדויקת (exact)</option>
                                <option value="regex">ביטוי רגולרי (regex)</option>
                            </select>
                        </div>

                        <!-- בחירת נוהל -->
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

                        <!-- תיאור (אופציונלי) -->
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
                        <span class="apm-count-badge"
                              id="apmMappingsCount">
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
    // רינדור רשימת המיפויים
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

        return this.mappings.map(m => `
            <div class="apm-mapping-item" data-id="${m.id}">

                <div class="apm-mapping-left">
                    <div class="apm-mapping-pattern">
                        <i class="fas fa-search"></i>
                        <strong>${this._escHtml(m.pattern)}</strong>
                        <span class="apm-match-badge apm-match-${m.matchType || 'contains'}">
                            ${matchTypeLabels[m.matchType] || m.matchType}
                        </span>
                    </div>
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
        `).join('');
    }

    // ══════════════════════════════════════════════════════════
    // אתחול חיפוש נהלים עם autocomplete
    // ══════════════════════════════════════════════════════════
    _initProcedureSearch() {
        const input = document.getElementById('apmProcedureSearch');
        const dropdown = document.getElementById('apmProcedureDropdown');
        if (!input || !dropdown) return;

        input.addEventListener('input', () => {
            const term = input.value.trim().toLowerCase();

            if (!term) {
                dropdown.style.display = 'none';
                return;
            }

            const matches = this.procedures.filter(p =>
                p.name.toLowerCase().includes(term) ||
                p.fileName.toLowerCase().includes(term) ||
                (p.folderPath || '').toLowerCase().includes(term)
            ).slice(0, 15); // מקסימום 15 תוצאות

            if (!matches.length) {
                dropdown.innerHTML = `
                    <div class="apm-dropdown-empty">
                        <i class="fas fa-search"></i>
                        לא נמצאו נהלים
                    </div>`;
                dropdown.style.display = 'block';
                return;
            }

            dropdown.innerHTML = matches.map(p => `
                <div class="apm-dropdown-item"
                     data-filename="${this._escHtml(p.fileName)}"
                     data-folder="${this._escHtml(p.folderPath || '')}"
                     data-name="${this._escHtml(p.name)}">
                    <i class="${p.icon || 'fas fa-file'}
                       apm-dropdown-icon"></i>
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

        if (nameEl) nameEl.textContent = displayName +
            (folderPath ? ` (${folderPath})` : '');
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
    // שמירת מיפוי
    // ══════════════════════════════════════════════════════════
    async saveMapping() {
        const pattern = document.getElementById('apmPattern')?.value.trim();
        const matchType = document.getElementById('apmMatchType')?.value;
        const fileName = document.getElementById('apmProcedureFileName')?.value;
        const folderPath = document.getElementById('apmProcedureFolderPath')?.value || '';
        const description = document.getElementById('apmDescription')?.value.trim() || '';
        const editId = document.getElementById('apmEditId')?.value || '';
        const procedureName = document.getElementById('apmSelectedProcedureName')
            ?.textContent?.split(' (')[0] || '';

        // ── ולידציה ──────────────────────────────────────────
        if (!pattern) {
            this._showFormError('apmPattern', 'יש להזין תבנית חיפוש');
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
    // עריכת מיפוי קיים
    // ══════════════════════════════════════════════════════════
    editMapping(id) {
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        // מלא את הטופס
        const patternEl = document.getElementById('apmPattern');
        const matchTypeEl = document.getElementById('apmMatchType');
        const descEl = document.getElementById('apmDescription');
        const editIdEl = document.getElementById('apmEditId');
        const saveBtnEl = document.getElementById('apmSaveBtn');

        if (patternEl) patternEl.value = mapping.pattern;
        if (matchTypeEl) matchTypeEl.value = mapping.matchType || 'contains';
        if (descEl) descEl.value = mapping.description || '';
        if (editIdEl) editIdEl.value = mapping.id;

        // בחר נוהל
        this.selectProcedure(
            mapping.procedureFileName,
            mapping.procedureFolderPath || '',
            mapping.procedureName || mapping.procedureFileName
        );

        // עדכן כפתור שמירה
        if (saveBtnEl) {
            saveBtnEl.innerHTML = '<i class="fas fa-save"></i> עדכן מיפוי';
        }

        // גלול לטופס
        document.querySelector('.apm-add-section')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // הדגש שדה pattern
        patternEl?.focus();
    }

    // ══════════════════════════════════════════════════════════
    // מחיקת מיפוי
    // ══════════════════════════════════════════════════════════
    async deleteMapping(id) {
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        if (!confirm(
            `האם למחוק את המיפוי?\n\n` +
            `תבנית: "${mapping.pattern}"\n` +
            `נוהל: "${mapping.procedureName || mapping.procedureFileName}"`
        )) return;

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
    // בדיקת מיפוי (test)
    // ══════════════════════════════════════════════════════════
    testMapping(id) {
        const mapping = this.mappings.find(m => m.id === id);
        if (!mapping) return;

        const testMsg = prompt(
            `בדוק התאמה למיפוי:\n"${mapping.pattern}" (${mapping.matchType})\n\nהזן הודעת התראה לבדיקה:`
        );
        if (testMsg === null) return;

        const result = this.findMatchingProcedure(testMsg);
        const matched = result && result.id === id;

        alert(
            matched
                ? `✅ ההתאמה הצליחה!\nהנוהל "${mapping.procedureName}" יוצג עבור הודעה זו.`
                : `❌ ההתאמה נכשלה.\nהתבנית "${mapping.pattern}" לא נמצאה בהודעה.`
        );
    }

    // ══════════════════════════════════════════════════════════
    // איפוס טופס
    // ══════════════════════════════════════════════════════════
    resetForm() {
        const fields = ['apmPattern', 'apmDescription', 'apmProcedureSearch'];
        fields.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        const matchTypeEl = document.getElementById('apmMatchType');
        if (matchTypeEl) matchTypeEl.value = 'contains';

        const editIdEl = document.getElementById('apmEditId');
        if (editIdEl) editIdEl.value = '';

        const saveBtnEl = document.getElementById('apmSaveBtn');
        if (saveBtnEl) {
            saveBtnEl.innerHTML = '<i class="fas fa-save"></i> שמור מיפוי';
        }

        this.clearSelectedProcedure();

        // הסר הדגשות שגיאה
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

        // הסר שגיאה אחרי 3 שניות
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

        // fallback פשוט
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: ${type === 'success' ? '#28a745' : '#dc3545'};
            color: white;
            padding: 10px 24px;
            border-radius: 8px;
            font-size: 0.95rem;
            font-weight: 600;
            z-index: 99999;
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
            max-width: 780px;
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
        #apmPattern {
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
        .apm-dropdown-item.active {
            background: #f0f4ff;
        }

        .apm-dropdown-icon {
            color: #667eea;
            font-size: 1rem;
            margin-top: 2px;
            flex-shrink: 0;
        }
        .apm-dropdown-info { flex: 1; min-width: 0; }
        .apm-dropdown-name {
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
        .apm-btn--secondary:hover {
            background: #e0e0e0;
        }

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

        .apm-mapping-pattern {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            color: #333;
            flex-wrap: wrap;
        }
        .apm-mapping-pattern i { color: #667eea; }

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
        .apm-empty i    { font-size: 2.5rem; margin-bottom: 12px; display: block; }
        .apm-empty p    { font-size: 1rem; font-weight: 600; margin: 0 0 6px; }
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
            .apm-form-grid { grid-template-columns: 1fr; }
            .apm-form-group--full { grid-column: 1; }
            .apm-box { border-radius: 12px; }
        }
        `;

        document.head.appendChild(style);
    }
}

// ══════════════════════════════════════════════════════════════
// יצירת מופע גלובלי
// ══════════════════════════════════════════════════════════════
const alertProcedureMappingManager = new AlertProcedureMappingManager();