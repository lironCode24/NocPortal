// file: SystemsCatalogAdminColumnManager.js
// ─── מודל ניהול עמודות גלובלי - לאדמין בלבד ───────────────

class SystemsCatalogAdminColumnManager {

    constructor(dashboard) {
        this.dashboard = dashboard;
        this._serverDefs = null;
    }

    // ══════════════════════════════════════════════════════════
    // פתח מודל ניהול עמודות גלובלי
    // ══════════════════════════════════════════════════════════
    async openModal() {
        if (!this.dashboard.isAdmin) {
            this.dashboard.showToast('אין הרשאה לניהול עמודות גלובלי', 'error');
            return;
        }

        const existing = document.getElementById('scAdminColModal');
        if (existing) existing.remove();

        // ─── הצג loading ───
        const loadingModal = document.createElement('div');
        loadingModal.id = 'scAdminColModal';
        loadingModal.className = 'sc-modal-overlay';
        loadingModal.innerHTML = `
            <div class="sc-modal" style="max-width:1200px;width:96%">
                <div class="sc-modal-header" style="
                    background:linear-gradient(135deg,#7f1d1d,#991b1b);
                    border-bottom:2px solid rgba(239,68,68,0.4)">
                    <h3 class="sc-modal-title">
                        <i class="fas fa-columns" style="color:#fca5a5"></i>
                        ניהול עמודות גלובלי
                        <span style="
                            padding:2px 10px;
                            background:rgba(239,68,68,0.2);
                            border:1px solid rgba(239,68,68,0.4);
                            border-radius:8px;
                            color:#fca5a5;
                            font-size:0.75rem;
                            font-weight:700">
                            Admin Only
                        </span>
                    </h3>
                    <button class="sc-modal-close" onclick="
                        document.getElementById('scAdminColModal')?.remove()">
                        &times;
                    </button>
                </div>
                <div style="display:flex;align-items:center;justify-content:center;
                            padding:60px;gap:12px;color:#666">
                    <i class="fas fa-spinner fa-spin" 
                       style="color:#6366f1;font-size:1.2rem"></i>
                    <span>טוען הגדרות עמודות...</span>
                </div>
            </div>`;

        document.body.appendChild(loadingModal);

        // ─── טען הגדרות מהשרת ───
        try {
            const res = await fetch('/SystemsCatalog/GetColumnDefinitions',
                { credentials: 'include' });
            const data = await res.json();

            if (!data.success)
                throw new Error(data.error || 'שגיאה בטעינה');

            this._serverDefs = data.definitions;
            this._renderModal(loadingModal, data.definitions);

        } catch (err) {
            loadingModal.querySelector('.sc-modal').innerHTML += `
                <div style="padding:20px;color:#f87171;text-align:center">
                    שגיאה: ${err.message}
                </div>`;
        }
    }

    // ══════════════════════════════════════════════════════════
    // רנדר תוכן המודל
    // ══════════════════════════════════════════════════════════
    _renderModal(modalEl, defs) {
        const columns = defs.columns || [];
        const lastUpd = defs.lastUpdated || '—';
        const updatedBy = defs.updatedBy || '—';

        // ─── מיין לפי sortOrder לפני הכל ───
        const sortedColumns = [...columns].sort(
            (a, b) => (a.sortOrder ?? 50) - (b.sortOrder ?? 50)
        );

        // ─── קבץ לפי קטגוריה (תוך שמירת הסדר הגלובלי) ───
        const categories = {};
        sortedColumns.forEach(col => {
            const cat = col.category || 'כללי';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(col);
        });

        const categoryColors = {
            'בסיסי': '#6366f1',
            'ארגוני': '#3b82f6',
            'טכני': '#06b6d4',
            'עסקי': '#f59e0b',
            'ספקים': '#8b5cf6',
            'תאריכים': '#10b981',
            'תיקוף': '#f43f5e',
            'אוטומציה': '#22c55e',
            'סקרים': '#ec4899',
            'כלים': '#84cc16',
            'כללי': '#6b7280',
            'מערכת': '#374151',
        };

        const rowsHtml = sortedColumns
            .map(col => this._renderColumnRow(
                col,
                categoryColors[col.category] || '#6b7280'
            ))
            .join('');

        // ─── כפתור הוספת עמודה חדשה ───
        const addNewColHtml = `
        <div class="sc-admin-col-add-section">
            <div class="sc-admin-col-add-title">
                <i class="fas fa-plus-circle" style="color:#22c55e"></i>
                הוסף עמודה חדשה
            </div>
            <div class="sc-admin-col-add-form">
                <input type="text" id="scNewColKey"
                    class="sc-edit-input"
                    placeholder="מפתח (camelCase, לדוגמה: myField)"
                    style="flex:1;direction:ltr"/>
                <input type="text" id="scNewColLabel"
                    class="sc-edit-input"
                    placeholder="תווית בעברית"
                    style="flex:1"/>
                <select id="scNewColCategory" class="sc-select"
                        style="flex:0.6">
                    ${Object.keys(categoryColors)
                        .filter(c => c !== 'מערכת')
                        .map(c => `<option value="${c}">${c}</option>`)
                        .join('')}
                </select>
                
                <!-- ─── סוג שדה ─── -->
                <select id="scNewColFieldType" class="sc-select"
                        style="flex:0.7"
                        onchange="window._adminColMgr._onFieldTypeChange(this.value)">
                    <option value="text">טקסט חופשי</option>
                    <option value="select">רשימה (dropdown)</option>
                    <option value="multiselect">בחירה מרובה</option>
                    <option value="number">מספר</option>
                    <option value="date">תאריך</option>
                    <option value="textarea">טקסט ארוך</option>
                </select>
                
                <label class="sc-admin-col-checkbox-label">
                    <input type="checkbox" id="scNewColDefault"
                        style="accent-color:#6366f1">
                    ברירת מחדל
                </label>
                <button id="scAddNewColBtn"
                        class="sc-admin-col-add-btn">
                    <i class="fas fa-plus"></i> הוסף
                </button>
            </div>
            
            <!-- ─── חדש: אזור ערכי רשימה (מוסתר בברירת מחדל) ─── -->
            <div id="scNewColAllowedValuesWrap" style="display:none;margin-top:10px">
                <div style="font-size:0.75rem;color:#888;margin-bottom:6px;
                            display:flex;align-items:center;gap:6px">
                    <i class="fas fa-list" style="color:#6366f1"></i>
                    ערכי הרשימה (ערך אחד בכל שורה):
                </div>
                <div style="display:flex;gap:8px;align-items:flex-start">
                    <textarea id="scNewColAllowedValues"
                            class="sc-form-textarea"
                            rows="4"
                            placeholder="פעיל&#10;לא פעיל&#10;בפיתוח&#10;..."
                            style="flex:1;font-size:0.8rem;direction:rtl;
                                    resize:vertical;min-height:80px"></textarea>
                </div>
                <!-- תצוגה מקדימה של הרשימה -->
                <div id="scNewColValuesPreview" style="
                    margin-top:8px;
                    display:flex;
                    flex-wrap:wrap;
                    gap:5px;
                    min-height:24px">
                </div>
            </div>
        </div>`;

        // ─── בנה את המודל המלא ───
        const modal = modalEl.querySelector('.sc-modal');
        modal.innerHTML = `
        <div class="sc-modal-header" style="
            background:linear-gradient(135deg,#1e1b4b,#312e81);
            border-bottom:2px solid rgba(99,102,241,0.4)">
            <h3 class="sc-modal-title">
                <i class="fas fa-columns" style="color:#a5b4fc"></i>
                ניהול עמודות גלובלי
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
            <button class="sc-modal-close"
                    id="scAdminColClose">&times;</button>
        </div>

        <!-- ── מידע אחרון ── -->
        <div class="sc-admin-col-meta">
            <i class="fas fa-info-circle" style="color:#6366f1"></i>
            <span>
                עדכון אחרון:
                <strong style="color:#a5b4fc">${lastUpd}</strong>
                על ידי
                <strong style="color:#a5b4fc">${updatedBy}</strong>
            </span>
            <span style="margin-right:auto;font-size:0.75rem;color:#555">
                שינויים כאן ישפיעו על
                <strong style="color:#fcd34d">כל המשתמשים</strong>
            </span>
        </div>

        <!-- ── אזהרה ── -->
        <div class="sc-admin-col-warning">
            <i class="fas fa-exclamation-triangle"
               style="color:#f59e0b;flex-shrink:0"></i>
            <span>
                הגדרות אלו קובעות אילו עמודות
                <strong>זמינות לכל המשתמשים</strong>
                ומה ברירת המחדל שלהן.
                <strong style="color:#fcd34d">הסדר כאן הוא סדר ברירת המחדל</strong>
                שבו העמודות יופיעו בטבלה.
            </span>
        </div>

        <!-- ── כלי חיפוש ── -->
        <div class="sc-admin-col-toolbar">
            <div style="position:relative;flex:1;max-width:280px">
                <i class="fas fa-search" style="
                    position:absolute;right:10px;top:50%;
                    transform:translateY(-50%);
                    color:#555;font-size:0.75rem;
                    pointer-events:none"></i>
                <input type="text"
                       id="scAdminColSearch"
                       class="sc-edit-input"
                       placeholder="חפש עמודה..."
                       style="padding-right:30px"
                       oninput="window._adminColMgr._filterColumns(this.value)"/>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="sc-admin-col-ctrl-btn sc-admin-col-ctrl-reset"
                        onclick="window._adminColMgr._resetToSystemDefault()">
                    <i class="fas fa-undo"></i> איפוס מערכת
                </button>
            </div>
        </div>

        <!-- ── כותרת עמודות הטבלה ── -->
        <div class="sc-admin-col-table-header">
            <div class="sc-admin-col-th sc-admin-col-th-order">סדר</div>
            <div class="sc-admin-col-th sc-admin-col-th-key">מפתח</div>
            <div class="sc-admin-col-th sc-admin-col-th-label">תווית</div>
            <div class="sc-admin-col-th sc-admin-col-th-default">ברירת מחדל</div>
            <div class="sc-admin-col-th sc-admin-col-th-always">חובה</div>
            <div class="sc-admin-col-th">בתיקוף</div>
            <div class="sc-admin-col-th">חובה בתיקוף</div> 
            <div class="sc-admin-col-th">סוג שדה</div>
            <div class="sc-admin-col-th sc-admin-col-th-del"></div>
        </div>

        <!-- ── גוף - רשימת עמודות ── -->
        <div class="sc-admin-col-body" id="scAdminColBody">
            ${rowsHtml}
        </div>

        <!-- ── הוסף עמודה חדשה ── -->
        ${addNewColHtml}

        <!-- ── Footer ── -->
        <div class="sc-modal-footer" style="
            justify-content:space-between;
            background:#13132a;
            border-top:1px solid #2a2a4e">
            <div style="font-size:0.78rem;color:#555;
                        display:flex;align-items:center;gap:6px">
                <i class="fas fa-users" style="color:#6366f1"></i>
                <span id="scAdminColCount">
                    ${columns.length} עמודות מוגדרות
                </span>
                <span style="color:#444;margin-right:8px">
                    <i class="fas fa-arrows-alt-v" 
                       style="color:#6366f1;font-size:0.65rem"></i>
                    הסדר קובע את סדר ברירת המחדל בטבלה
                </span>
            </div>
            <div style="display:flex;gap:8px">
                <button class="sc-modal-cancel-btn"
                        id="scAdminColCancel">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button id="scAdminColSave"
                        style="padding:8px 20px;
                               background:linear-gradient(135deg,#4f46e5,#7c3aed);
                               border:none;border-radius:6px;color:white;
                               font-size:0.85rem;font-weight:700;cursor:pointer;
                               display:flex;align-items:center;gap:6px;
                               font-family:inherit;transition:all 0.2s">
                    <i class="fas fa-globe"></i>
                    שמור לכל המשתמשים
                </button>
            </div>
        </div>`;

        // ─── אירועים ───
        window._adminColMgr = this;

        document.getElementById('scAdminColClose')
            ?.addEventListener('click', () => modalEl.remove());
        document.getElementById('scAdminColCancel')
            ?.addEventListener('click', () => modalEl.remove());
        document.getElementById('scAdminColSave')
            ?.addEventListener('click', () => this._saveToServer(modalEl));
        document.getElementById('scAdminColBody')
            ?.addEventListener('change', e => {
                const cb = e.target.closest('.sc-admin-col-cb');
                if (!cb) return;

                const key = cb.dataset.key;
                const field = cb.dataset.field;
                const isChecked = cb.checked;
                const row = cb.closest('.sc-admin-col-row');

                // ─── מצא את שתי התוויות בשורה ───
                // [0] = תווית של "ברירת מחדל / מוסתר"
                // [1] = תווית של "חובה / אופציונלי"
                const labels = row?.querySelectorAll(
                    '.sc-admin-col-toggle-label'
                );

                // ══════════════════════════════════════════
                // טיפול בשינוי "חובה"
                // ══════════════════════════════════════════
                if (field === 'alwaysVisible') {

                    // ─── עדכן תווית "חובה / אופציונלי" ───
                    if (labels?.[1]) {
                        labels[1].textContent = isChecked
                            ? 'חובה'
                            : 'אופציונלי';

                        // ─── צבע תווית לפי מצב ───
                        labels[1].style.color = isChecked
                            ? '#fcd34d'
                            : '';
                    }

                    // ─── מצא את checkbox ברירת מחדל ───
                    const defaultCb = row?.querySelector(
                        `.sc-admin-col-cb[data-key="${key}"]`
                        + `[data-field="defaultVisible"]`
                    );
                    const defaultSlider = defaultCb
                        ?.closest('.sc-admin-col-toggle')
                        ?.querySelector('.sc-admin-col-toggle-slider');

                    if (defaultCb) {
                        if (isChecked) {
                            // ─── סימון חובה:
                            //     נעל ברירת מחדל ל-true ───
                            defaultCb.checked = true;
                            defaultCb.disabled = true;
                            defaultSlider?.classList.add(
                                'sc-admin-col-toggle-locked'
                            );

                            // ─── עדכן תווית ברירת מחדל ───
                            if (labels?.[0]) {
                                labels[0].textContent = 'ברירת מחדל';
                                labels[0].style.color = '#86efac';
                            }

                        } else {
                            // ─── ביטול חובה:
                            //     שחרר ברירת מחדל לעריכה ───
                            defaultCb.disabled = false;
                            defaultSlider?.classList.remove(
                                'sc-admin-col-toggle-locked'
                            );

                            // ─── עדכן תווית ברירת מחדל
                            //     לפי הערך הנוכחי ───
                            if (labels?.[0]) {
                                labels[0].textContent = defaultCb.checked
                                    ? 'ברירת מחדל'
                                    : 'מוסתר';
                                labels[0].style.color = defaultCb.checked
                                    ? '#86efac'
                                    : '';
                            }
                        }
                    }
                }

                // ══════════════════════════════════════════
                // טיפול בשינוי "ברירת מחדל"
                // ══════════════════════════════════════════
                if (field === 'defaultVisible') {

                    // ─── עדכן תווית "ברירת מחדל / מוסתר" ───
                    if (labels?.[0]) {
                        labels[0].textContent = isChecked
                            ? 'ברירת מחדל'
                            : 'מוסתר';

                        // ─── צבע תווית לפי מצב ───
                        labels[0].style.color = isChecked
                            ? '#86efac'
                            : '';
                    }
                }

                // ══════════════════════════════════════════
                // טיפול בשינוי "הצג בתיקוף"
                // ══════════════════════════════════════════
                if (field === 'showInValidation') {

                    // מצא את התווית של הטוגל
                    const validationLabel = cb
                        ?.closest('.sc-admin-col-toggle-wrap')
                        ?.querySelector('.sc-admin-col-toggle-label');

                    if (validationLabel) {
                        validationLabel.textContent = isChecked
                            ? 'בתיקוף'
                            : 'לא בתיקוף';

                        validationLabel.style.color = isChecked
                            ? '#86efac'
                            : '';
                    }
                }
                // ══════════════════════════════════════════════════════════
                // טיפול בשינוי "חובה בתיקוף"
                // ══════════════════════════════════════════════════════════
                if (field === 'requiredInValidation') {

                    // ── אם מסמן "חובה בתיקוף" — חייב גם להיות "בתיקוף" ──
                    if (isChecked) {
                        const showInValCb = row?.querySelector(
                            `.sc-admin-col-cb[data-key="${key}"]`
                            + `[data-field="showInValidation"]`
                        );
                        if (showInValCb && !showInValCb.checked) {
                            // ─── הפעל גם "בתיקוף" אוטומטית ───
                            showInValCb.checked = true;
                            showInValCb.disabled = true; // ── נעל כל עוד חובה מסומן

                            // ─── עדכן תווית showInValidation ───
                            const showLabel = showInValCb
                                ?.closest('.sc-admin-col-toggle-wrap')
                                ?.querySelector('.sc-admin-col-toggle-label');
                            if (showLabel) {
                                showLabel.textContent = 'בתיקוף';
                                showLabel.style.color = '#86efac';
                            }
                        }
                    } else {
                        // ─── בטל נעילת "בתיקוף" ───
                        const showInValCb = row?.querySelector(
                            `.sc-admin-col-cb[data-key="${key}"]`
                            + `[data-field="showInValidation"]`
                        );
                        if (showInValCb) {
                            showInValCb.disabled = false;
                        }
                    }

                    // ─── עדכן תווית "חובה בתיקוף / אופציונלי" ───
                    const reqLabel = cb
                        ?.closest('.sc-admin-col-toggle-wrap')
                        ?.querySelector('.sc-admin-col-toggle-label');

                    if (reqLabel) {
                        reqLabel.textContent = isChecked ? 'חובה' : 'אופציונלי';
                        reqLabel.style.color = isChecked ? '#fca5a5' : '';
                    }
                }
            });

        // ─── נעל/שחרר ברירת מחדל לפי חובה ───
        document.getElementById('scAdminColBody')
            ?.addEventListener('change', e => {
                const cb = e.target.closest(
                    '.sc-admin-col-cb[data-field="alwaysVisible"]'
                );
                if (!cb) return;

                const key = cb.dataset.key;
                const isAlways = cb.checked;

                // ─── מצא את checkbox ברירת מחדל של אותה שורה ───
                const row = cb.closest('.sc-admin-col-row');
                const defaultCb = row?.querySelector(
                    `.sc-admin-col-cb[data-key="${key}"][data-field="defaultVisible"]`
                );
                const toggleLabel = row?.querySelector('.sc-admin-col-toggle-label');

                if (!defaultCb) return;

                if (isAlways) {
                    // ─── חובה: נעל ברירת מחדל ל-true ───
                    defaultCb.checked = true;
                    defaultCb.disabled = true;
                    defaultCb.closest('.sc-admin-col-toggle-slider')
                        ?.classList.add('sc-admin-col-toggle-locked');
                } else {
                    // ─── לא חובה: שחרר ───
                    defaultCb.disabled = false;
                    defaultCb.closest('.sc-admin-col-toggle-slider')
                        ?.classList.remove('sc-admin-col-toggle-locked');
                }

                // ─── עדכן תווית ───
                if (toggleLabel) {
                    toggleLabel.textContent = isAlways ? 'חובה' : 'אופציונלי';
                }
            });
        document.getElementById('scAddNewColBtn')
            ?.addEventListener('click', () => this._addNewColumn(modalEl));
    }

    // ══════════════════════════════════════════════════════════
    // רנדר שורת עמודה - עם כפתורי סדר
    // ══════════════════════════════════════════════════════════
    _renderColumnRow(col, color) {
        const isSystemFixed = col.key === 'number' || col.key === 'buttons';
        const isSystem = isSystemFixed;
        const isFixed  = isSystemFixed;
        
        // ─── הכן data-allowed-values ───
        const allowedValuesAttr = col.allowedValues?.length > 0
            ? `data-allowed-values='${JSON.stringify(col.allowedValues).replace(/'/g, "&apos;")}'`
            : '';
        
        const fieldTypeAttr = col.fieldType 
            ? `data-field-type="${col.fieldType}"` 
            : '';

        return `
        <div class="sc-admin-col-row ${isSystem ? 'sc-admin-col-row-system' : ''}"
            data-key="${col.key}"
            data-category="${col.category || 'כללי'}"
            data-sort-order="${col.sortOrder ?? 50}"
            ${fieldTypeAttr}
            ${allowedValuesAttr}>

            <!-- ── כפתורי סדר ── -->
            <div class="sc-admin-col-order-wrap">
                ${isFixed
                ? `<span class="sc-admin-col-order-locked"
                              title="${col.key === 'number'
                    ? 'עמודה זו תמיד ראשונה'
                    : 'עמודה זו תמיד אחרונה'}">
                           <i class="fas fa-lock" style="font-size:0.6rem"></i>
                       </span>`
                : `<div class="sc-admin-col-order-btns">
                           <button class="sc-admin-col-order-btn sc-admin-col-order-up"
                                   data-key="${col.key}"
                                   title="הזז למעלה"
                                   onclick="window._adminColMgr._moveRow('${col.key}', -1)">
                               <i class="fas fa-chevron-up"></i>
                           </button>
                           <span class="sc-admin-col-order-num"
                                 data-key="${col.key}">
                               ${col.sortOrder ?? 50}
                           </span>
                           <button class="sc-admin-col-order-btn sc-admin-col-order-down"
                                   data-key="${col.key}"
                                   title="הזז למטה"
                                   onclick="window._adminColMgr._moveRow('${col.key}', 1)">
                               <i class="fas fa-chevron-down"></i>
                           </button>
                       </div>`
            }
            </div>

            <!-- ── מפתח ── -->
            <div class="sc-admin-col-key" dir="ltr">
                ${col.key}
            </div>

            <!-- ── תווית ── -->
            <div class="sc-admin-col-label-wrap">
                ${isSystem
                ? `<span class="sc-admin-col-label-text">
                               ${col.label || '—'}
                           </span>`
                : `<input type="text"
                                  class="sc-admin-col-label-input sc-edit-input"
                                  data-key="${col.key}"
                                  data-field="label"
                                  value="${col.label || ''}"
                                  placeholder="תווית..."/>`
            }
            </div>

            <!-- ── ברירת מחדל ── -->
            <div class="sc-admin-col-toggle-wrap"
                 title="ברירת מחדל - האם העמודה מוצגת כברירת מחדל">
                <label class="sc-admin-col-toggle">
                    <input type="checkbox"
                           class="sc-admin-col-cb"
                           data-key="${col.key}"
                           data-field="defaultVisible"
                           ${col.defaultVisible ? 'checked' : ''}
                           ${isSystem ? 'disabled' : ''}/>
                    <span class="sc-admin-col-toggle-slider
                                 ${isSystem ? 'sc-admin-col-toggle-locked' : ''}">
                    </span>
                </label>
                <span class="sc-admin-col-toggle-label">
                    ${col.defaultVisible ? 'ברירת מחדל' : 'מוסתר'}
                </span>
            </div>

            <!-- ── חובה ── -->
            <div class="sc-admin-col-toggle-wrap"
                 title="חובה - האם ניתן להסתיר עמודה זו">
                <label class="sc-admin-col-toggle">
                    <input type="checkbox"
                           class="sc-admin-col-cb"
                           data-key="${col.key}"
                           data-field="alwaysVisible"
                           ${col.alwaysVisible ? 'checked' : ''}
                           ${isSystem ? 'disabled' : ''}/>
                    <span class="sc-admin-col-toggle-slider
                                 ${isSystem ? 'sc-admin-col-toggle-locked' : ''}">
                    </span>
                </label>
                <span class="sc-admin-col-toggle-label">
                    ${col.alwaysVisible ? 'חובה' : 'אופציונלי'}
                </span>
            </div>

            <!-- ── הצג בתיקוף ── -->
            <div class="sc-admin-col-toggle-wrap"
                title="האם שדה זה יוצג בדף תיקוף המערכת">
                <label class="sc-admin-col-toggle">
                    <input type="checkbox"
                        class="sc-admin-col-cb"
                        data-key="${col.key}"
                        data-field="showInValidation"
                        ${col.showInValidation ? 'checked' : ''}
                        ${isSystem ? 'disabled' : ''}/>
                    <span class="sc-admin-col-toggle-slider
                                ${isSystem ? 'sc-admin-col-toggle-locked' : ''}">
                    </span>
                </label>
                <span class="sc-admin-col-toggle-label">
                    ${col.showInValidation ? 'בתיקוף' : 'לא בתיקוף'}
                </span>
            </div>
            <div class="sc-admin-col-toggle-wrap"
                title="האם שדה זה חובה למילוי בדף תיקוף (יוצג עם * אדום)">
                <label class="sc-admin-col-toggle">
                    <input type="checkbox"
                        class="sc-admin-col-cb"
                        data-key="${col.key}"
                        data-field="requiredInValidation"
                        ${col.requiredInValidation ? 'checked' : ''}
                        ${isSystem ? 'disabled' : ''}/>
                    <span class="sc-admin-col-toggle-slider
                                ${isSystem ? 'sc-admin-col-toggle-locked' : ''}">
                    </span>
                </label>
                <span class="sc-admin-col-toggle-label"
                    style="${col.requiredInValidation ? 'color:#fca5a5' : ''}">
                    ${col.requiredInValidation ? 'חובה' : 'אופציונלי'}
                </span>
            </div>

            <!-- ── סוג שדה ── -->
            <div class="sc-admin-col-field-type-wrap">
                ${isSystem
                    ? `<span class="sc-admin-col-field-type-badge">
                        <i class="fas fa-font" style="font-size:0.6rem"></i>
                        טקסט
                    </span>`
                    : `<select class="sc-select sc-admin-col-field-type-select"
                            data-key="${col.key}"
                            data-field="fieldType"
                            style="font-size:0.72rem;padding:3px 6px"
                            onchange="window._adminColMgr
                                ._onExistingFieldTypeChange('${col.key}', this.value)">
                        <option value="text"      ${(col.fieldType||'text') === 'text'     ? 'selected':''}>טקסט</option>
                        <option value="select"    ${col.fieldType === 'select'             ? 'selected':''}>רשימה</option>
                        <option value="multiselect" ${col.fieldType === 'multiselect'        ? 'selected':''}>בחירה מרובה</option>
                        <option value="number"    ${col.fieldType === 'number'             ? 'selected':''}>מספר</option>
                        <option value="date"      ${col.fieldType === 'date'               ? 'selected':''}>תאריך</option>
                        <option value="textarea"  ${col.fieldType === 'textarea'           ? 'selected':''}>טקסט ארוך</option>
                    </select>
                    ${col.fieldType === 'select' && col.allowedValues?.length > 0
                        ? `<button class="sc-admin-col-values-btn"
                                    data-key="${col.key}"
                                    title="ערוך ערכי רשימה (${col.allowedValues.length} ערכים)"
                                    onclick="event.stopPropagation();
                                            window._adminColMgr._editAllowedValues('${col.key}')">
                                <i class="fas fa-list"></i>
                                <span style="font-size:0.65rem">${col.allowedValues.length}</span>
                            </button>`
                        : col.fieldType === 'select'
                            ? `<button class="sc-admin-col-values-btn sc-admin-col-values-btn-empty"
                                        data-key="${col.key}"
                                        title="הוסף ערכי רשימה"
                                        onclick="event.stopPropagation();
                                                window._adminColMgr._editAllowedValues('${col.key}')">
                                    <i class="fas fa-plus"></i>
                                </button>`
                            : ''
                    }`
                }
            </div>


            <!-- ── מחיקה ── -->
            <div class="sc-admin-col-delete-wrap">
                ${isSystem
                ? `<span style="color:#333;font-size:0.65rem">
                               <i class="fas fa-lock"></i>
                           </span>`
                : `<button class="sc-admin-col-delete-btn"
                                   data-key="${col.key}"
                                   title="מחק עמודה זו"
                                   onclick="window._adminColMgr
                                       ._deleteColumn('${col.key}')">
                               <i class="fas fa-trash-alt"></i>
                           </button>`
            }
            </div>
        </div>`;
    }

    // ── שנה סוג שדה של עמודה קיימת ──────────────────────────
    _onExistingFieldTypeChange(key, newType) {
        if (newType === 'select' || newType === 'multiselect') {  // ← שנה
            setTimeout(() => this._editAllowedValues(key), 100);
        }
        
        // ─── עדכן תצוגת הכפתור בשורה ───
        const row = document.querySelector(`.sc-admin-col-row[data-key="${key}"]`);
        if (!row) return;
        
        const ftWrap = row.querySelector('.sc-admin-col-field-type-wrap');
        if (!ftWrap) return;
        
        // ─── הסר כפתורי ערכים קיימים ───
        ftWrap.querySelectorAll('.sc-admin-col-values-btn').forEach(b => b.remove());
        
        if (newType === 'select' || newType === 'multiselect') {
            const btn = document.createElement('button');
            btn.className = 'sc-admin-col-values-btn sc-admin-col-values-btn-empty';
            btn.dataset.key = key;
            btn.title = 'הוסף ערכי רשימה';
            btn.innerHTML = '<i class="fas fa-plus"></i>';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                this._editAllowedValues(key);
            });
            ftWrap.appendChild(btn);
        }
    }

    // ─── עורך ערכי רשימה לעמודה קיימת ───────────────────────
    _editAllowedValues(key) {
        const row = document.querySelector(`.sc-admin-col-row[data-key="${key}"]`);
        if (!row) return;
        
        // ─── אסוף ערכים קיימים ───
        const existingValuesAttr = row.dataset.allowedValues || '';
        let existingValues = [];
        try {
            existingValues = existingValuesAttr 
                ? JSON.parse(existingValuesAttr) 
                : [];
        } catch { existingValues = []; }
        
        // ─── מצא שם תווית ───
        const labelInput = row.querySelector('.sc-admin-col-label-input');
        const labelText = labelInput?.value || key;
        
        // ─── הסר מודל קיים ───
        document.getElementById('scAllowedValuesModal')?.remove();
        
        const modal = document.createElement('div');
        modal.id = 'scAllowedValuesModal';
        modal.className = 'sc-modal-overlay';
        modal.style.zIndex = '9999999';
        
        modal.innerHTML = `
        <div class="sc-modal" style="max-width:480px;width:95%;
                                    animation:scSlideIn 0.2s ease">
            <div class="sc-modal-header" style="
                background:linear-gradient(135deg,#1e1b4b,#312e81);
                border-bottom:2px solid rgba(99,102,241,0.4)">
                <h3 class="sc-modal-title" style="gap:8px">
                    <i class="fas fa-list" style="color:#a5b4fc"></i>
                    ערכי הרשימה
                    <span style="
                        padding:2px 10px;
                        background:rgba(99,102,241,0.15);
                        border:1px solid rgba(99,102,241,0.3);
                        border-radius:8px;color:#a5b4fc;
                        font-size:0.78rem;font-weight:600">
                        ${labelText}
                    </span>
                </h3>
                <button class="sc-modal-close"
                        id="scAVClose">&times;</button>
            </div>
            
            <div class="sc-modal-body" style="gap:14px">
            
                <!-- ─── הוראות ─── -->
                <div style="font-size:0.78rem;color:#888;
                            display:flex;align-items:flex-start;gap:7px;
                            padding:8px 12px;background:rgba(99,102,241,0.06);
                            border:1px solid rgba(99,102,241,0.15);
                            border-radius:7px">
                    <i class="fas fa-info-circle" style="color:#6366f1;flex-shrink:0;margin-top:2px"></i>
                    <span>
                        הזן ערך אחד בכל שורה.
                        הערכים יופיעו כאפשרויות בתפריט הנפתח בעת עריכת מערכת.
                        <strong style="color:#a5b4fc">הכנס לפחות ערך אחד.</strong>
                    </span>
                </div>
                
                <!-- ─── Textarea ─── -->
                <div>
                    <div style="font-size:0.78rem;font-weight:600;color:#888;
                                margin-bottom:6px;display:flex;align-items:center;gap:5px">
                        <i class="fas fa-edit" style="color:#6366f1"></i>
                        ערכי הרשימה (ערך אחד בכל שורה):
                    </div>
                    <textarea id="scAVTextarea"
                            class="sc-form-textarea"
                            rows="8"
                            placeholder="פעיל&#10;לא פעיל&#10;בפיתוח&#10;..."
                            style="font-size:0.85rem;direction:rtl;
                                    resize:vertical;min-height:120px"
                    >${existingValues.join('\n')}</textarea>
                </div>
                
                <!-- ─── פעולות מהירות ─── -->
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <span style="font-size:0.72rem;color:#555;
                                align-self:center">תבניות מהירות:</span>
                    ${[
                        { label: 'כן/לא', values: 'כן\nלא' },
                        { label: 'פעיל/לא פעיל', values: 'פעיל\nלא פעיל\nבפיתוח\nמבוטל' },
                        { label: 'סביבה', values: 'PROD\nNONPROD\nDEV\nTEST\nSTAGE' },
                        { label: 'קריטיות', values: 'גבוהה\nבינונית\nנמוכה' },
                        { label: 'זמינות', values: '24/7\n8/5\nאד-הוק' },
                    ].map(t => `
                        <button 
                            class="sc-av-template-btn"
                            data-values="${encodeURIComponent(t.values)}"
                            style="padding:3px 10px;
                                    background:rgba(99,102,241,0.1);
                                    border:1px solid rgba(99,102,241,0.25);
                                    border-radius:5px;color:#a5b4fc;
                                    font-size:0.72rem;cursor:pointer;
                                    font-family:inherit;transition:all 0.15s"
                                onmouseover="this.style.background='rgba(99,102,241,0.2)'"
                                onmouseout="this.style.background='rgba(99,102,241,0.1)'">
                            ${t.label}
                        </button>`).join('')}
                </div>
                
                <!-- ─── תצוגה מקדימה ─── -->
                <div>
                    <div style="font-size:0.72rem;color:#555;margin-bottom:6px;
                                display:flex;align-items:center;gap:5px">
                        <i class="fas fa-eye" style="color:#6366f1;font-size:0.65rem"></i>
                        תצוגה מקדימה:
                    </div>
                    <div id="scAVPreview" style="
                        display:flex;flex-wrap:wrap;gap:5px;
                        min-height:28px;padding:6px;
                        background:rgba(255,255,255,0.02);
                        border:1px solid rgba(255,255,255,0.06);
                        border-radius:6px">
                        <span style="font-size:0.72rem;color:#444;font-style:italic">
                            הקלד ערכים לתצוגה מקדימה
                        </span>
                    </div>
                </div>
                
            </div>
            
            <div class="sc-modal-footer">
                <span id="scAVCount"
                    style="font-size:0.75rem;color:#666;margin-left:auto">
                    0 ערכים
                </span>
                <button class="sc-modal-cancel-btn" id="scAVCancel">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button id="scAVSave"
                        style="padding:8px 18px;
                            background:linear-gradient(135deg,#4f46e5,#7c3aed);
                            border:none;border-radius:6px;color:white;
                            font-size:0.85rem;font-weight:700;cursor:pointer;
                            display:flex;align-items:center;gap:6px;
                            font-family:inherit">
                    <i class="fas fa-save"></i> שמור ערכים
                </button>
            </div>
        </div>`;
        
        document.body.appendChild(modal);
        modal.querySelectorAll('.sc-av-template-btn')
            .forEach(btn => {
                btn.addEventListener('click', () => {

                    const values = decodeURIComponent(
                        btn.dataset.values
                    );

                    document.getElementById('scAVTextarea').value = values;
                    this._updateAVPreview();
                });
            });

            // ─── אירועים ───
        document.getElementById('scAVClose')
            ?.addEventListener('click', () => modal.remove());
        document.getElementById('scAVCancel')
            ?.addEventListener('click', () => modal.remove());
        
        // ─── עדכן תצוגה מקדימה בזמן הקלדה ───
        document.getElementById('scAVTextarea')
            ?.addEventListener('input', () => this._updateAVPreview());
        
        // ─── אתחל תצוגה מקדימה אם יש ערכים קיימים ───
        if (existingValues.length > 0) {
            this._updateAVPreview();
        }
        
        // ─── שמור ───
        document.getElementById('scAVSave')
            ?.addEventListener('click', () => {
                const textarea = document.getElementById('scAVTextarea');
                const values = (textarea?.value || '')
                    .split('\n')
                    .map(v => v.trim())
                    .filter(v => v.length > 0);
                
                // ─── ולידציה: חייב לפחות ערך אחד ───
                if (values.length === 0) {
                    this.dashboard.showToast(
                        'רשימה חייבת לכלול לפחות ערך אחד', 'error'
                    );
                    textarea?.focus();
                    return;
                }
                
                // ─── שמור על ה-row ב-data attribute ───
                if (row) {
                    row.dataset.allowedValues = JSON.stringify(values);
                    row.dataset.fieldType = 'select';
                }
                
                // ─── עדכן כפתור ───
                const ftWrap = row?.querySelector('.sc-admin-col-field-type-wrap');
                const existingBtn = ftWrap?.querySelector('.sc-admin-col-values-btn');
                
                if (existingBtn) {
                    existingBtn.title = `ערוך ערכי רשימה (${values.length} ערכים)`;
                    existingBtn.classList.remove('sc-admin-col-values-btn-empty');
                    existingBtn.innerHTML = `
                        <i class="fas fa-list"></i>
                        <span style="font-size:0.65rem">${values.length}</span>`;
                }
                
                modal.remove();
                
                this.dashboard.showToast(
                    `✅ נשמרו ${values.length} ערכים לעמודה "${labelText}"`,
                    'success'
                );
            });
        
        // ─── פוקוס על ה-textarea ───
        setTimeout(() => {
            document.getElementById('scAVTextarea')?.focus();
        }, 100);
    }

    // ─── עדכן תצוגה מקדימה בחלון ערכי רשימה ─────────────────
    _updateAVPreview() {
        const textarea = document.getElementById('scAVTextarea');
        const preview  = document.getElementById('scAVPreview');
        const countEl  = document.getElementById('scAVCount');
        
        if (!textarea || !preview) return;
        
        const values = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(v => v.length > 0);
        
        // ─── עדכן מונה ───
        if (countEl) {
            countEl.textContent = `${values.length} ערכים`;
            countEl.style.color = values.length === 0 ? '#ef4444' : '#86efac';
        }
        
        if (values.length === 0) {
            preview.innerHTML = `
                <span style="font-size:0.72rem;color:#444;font-style:italic">
                    הקלד ערכים לתצוגה מקדימה
                </span>`;
            return;
        }
        
        // ─── צבעים מחזוריים ───
        const colors = [
            { bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.3)',  color: '#a5b4fc'  },
            { bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)',   color: '#86efac'  },
            { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)',  color: '#fcd34d'  },
            { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',   color: '#fca5a5'  },
            { bg: 'rgba(6,182,212,0.12)',   border: 'rgba(6,182,212,0.3)',   color: '#67e8f9'  },
            { bg: 'rgba(139,92,246,0.12)',  border: 'rgba(139,92,246,0.3)',  color: '#c4b5fd'  },
        ];
        
        preview.innerHTML = values.map((v, i) => {
            const c = colors[i % colors.length];
            return `
            <span style="
                display:inline-flex;
                align-items:center;
                padding:3px 10px;
                background:${c.bg};
                border:1px solid ${c.border};
                border-radius:10px;
                font-size:0.75rem;
                font-weight:600;
                color:${c.color};
                white-space:nowrap">
                ${v}
            </span>`;
        }).join('');
    }

    // ══════════════════════════════════════════════════════════
    // הזז שורה למעלה / למטה
    // ══════════════════════════════════════════════════════════
    _moveRow(key, direction) {
        // ─── אסוף את כל השורות הניתנות להזזה (לא number/buttons) ───
        const body = document.getElementById('scAdminColBody');
        if (!body) return;

        // ─── קבל את כל השורות לפי הסדר הנוכחי ב-DOM ───
        // (כולל number ו-buttons לצורך חישוב, אבל לא נזיז אותן)
        const allRows = [...body.querySelectorAll('.sc-admin-col-row')];
        const movableRows = allRows.filter(
            r => r.dataset.key !== 'number' && r.dataset.key !== 'buttons'
        );

        const currentRow = body.querySelector(
            `.sc-admin-col-row[data-key="${key}"]`
        );
        if (!currentRow) return;

        const currentIdx = movableRows.indexOf(currentRow);
        if (currentIdx === -1) return;

        const targetIdx = currentIdx + direction;

        // ─── בדוק גבולות ───
        if (targetIdx < 0 || targetIdx >= movableRows.length) return;

        const targetRow = movableRows[targetIdx];
        if (!targetRow) return;

        // ─── בצע החלפה ב-DOM ───
        // נשתמש ב-insertAdjacentElement לפי הכיוון
        if (direction === -1) {
            // הזז למעלה: הכנס לפני targetRow
            targetRow.parentNode.insertBefore(currentRow, targetRow);
        } else {
            // הזז למטה: הכנס אחרי targetRow
            targetRow.parentNode.insertBefore(currentRow, targetRow.nextSibling);
        }

        // ─── עדכן מספרי סדר בכל השורות ───
        this._recalcSortOrders();

        // ─── אנימציה קצרה ───
        currentRow.style.transition = 'background 0.3s';
        currentRow.style.background = 'rgba(99,102,241,0.15)';
        setTimeout(() => {
            currentRow.style.background = '';
        }, 400);
    }

    // ══════════════════════════════════════════════════════════
    // חשב מחדש את מספרי הסדר לפי מיקום ב-DOM
    // ══════════════════════════════════════════════════════════
    _recalcSortOrders() {
        const body = document.getElementById('scAdminColBody');
        if (!body) return;

        const allRows = [...body.querySelectorAll('.sc-admin-col-row')];

        // ─── number = 0, buttons = allRows.length - 1 ───
        // ─── שאר לפי סדר ב-DOM ───
        let order = 0;

        allRows.forEach(row => {
            const key = row.dataset.key;

            if (key === 'number') {
                row.dataset.sortOrder = 0;
                // ─── עדכן תצוגה ───
                const numEl = row.querySelector(
                    `.sc-admin-col-order-num[data-key="${key}"]`
                );
                if (numEl) numEl.textContent = 0;
                return;
            }

            if (key === 'buttons') {
                // ─── יעודכן בסוף ───
                return;
            }

            order++;
            row.dataset.sortOrder = order;

            // ─── עדכן תצוגת המספר ───
            const numEl = row.querySelector(
                `.sc-admin-col-order-num[data-key="${key}"]`
            );
            if (numEl) numEl.textContent = order;
        });

        // ─── buttons תמיד אחרון ───
        const buttonsRow = body.querySelector(
            '.sc-admin-col-row[data-key="buttons"]'
        );
        if (buttonsRow) {
            buttonsRow.dataset.sortOrder = order + 1;
        }
    }

    // ══════════════════════════════════════════════════════════
    // פונקציות עזר - סינון, עדכון, מחיקה
    // ══════════════════════════════════════════════════════════

    // ─── סנן עמודות לפי חיפוש ───────────────────────────────
    _filterColumns(term) {
        const t = (term || '').toLowerCase().trim();
        document.querySelectorAll('.sc-admin-col-row').forEach(row => {
            const key = (row.dataset.key || '').toLowerCase();
            const label = (row.querySelector('.sc-admin-col-label-input')
                ?.value || row.querySelector('.sc-admin-col-label-text')
                    ?.textContent || '').toLowerCase();
            const cat = (row.dataset.category || '').toLowerCase();

            row.style.display = (
                !t ||
                key.includes(t) ||
                label.includes(t) ||
                cat.includes(t)
            ) ? '' : 'none';
        });

        // ─── הסתר קטגוריות ריקות ───
        document.querySelectorAll('.sc-admin-col-category').forEach(catEl => {
            const visibleRows = [...catEl.querySelectorAll('.sc-admin-col-row')]
                .filter(r => r.style.display !== 'none');
            catEl.style.display = visibleRows.length > 0 ? '' : 'none';
        });
    }

    // ─── איפוס לברירת מחדל של המערכת ───────────────────────
    _resetToSystemDefault() {
        if (!confirm('לאפס את כל ההגדרות לברירת המחדל של המערכת?')) return;

        // ─── ערכי ברירת מחדל קשיחים ───
        const systemDefaults = {
            number:          { defaultVisible: true,  sortOrder: 0,  requiredInValidation: false },
            name:            { defaultVisible: true,  sortOrder: 1,  requiredInValidation: true  },
            nameEn:          { defaultVisible: true,  sortOrder: 2,  requiredInValidation: true  },
            status:          { defaultVisible: true,  sortOrder: 4,  requiredInValidation: true  },
            systemManager:   { defaultVisible: true,  sortOrder: 5,  requiredInValidation: true  },
            departmentManager: { defaultVisible: true, sortOrder: 6 , requiredInValidation: false },
            team: { defaultVisible: true, sortOrder: 7, requiredInValidation: false },
            department: { defaultVisible: true, sortOrder: 8 , requiredInValidation: false },
            domain: { defaultVisible: true, sortOrder: 9 , requiredInValidation: false },
            businessDivision: { defaultVisible: true, sortOrder: 10 , requiredInValidation: false },
            appClassification: { defaultVisible: true, sortOrder: 11, requiredInValidation: false },
            appType: { defaultVisible: true, sortOrder: 12 , requiredInValidation: false },
            businessCriticality: { defaultVisible: true, sortOrder: 13, requiredInValidation: false },
            availabilityRequirement: { defaultVisible: true, sortOrder: 14 , requiredInValidation: false },
            environment: { defaultVisible: true, sortOrder: 15 , requiredInValidation: false },
            publisher: { defaultVisible: true, sortOrder: 16 , requiredInValidation: false },
            supportVendor: { defaultVisible: true, sortOrder: 17 , requiredInValidation: false },
            createdAt: { defaultVisible: true, sortOrder: 18 , requiredInValidation: false },
            hasAutomation: { defaultVisible: false, sortOrder: 19 , requiredInValidation: false },
            lastValidatedAt: { defaultVisible: false, sortOrder: 20 , requiredInValidation: false },
            requiresValidation: { defaultVisible: false, sortOrder: 21 , requiredInValidation: false },
            lastValidationEmailSentAt: { defaultVisible: false, sortOrder: 22, requiredInValidation: false },
            buttons: { defaultVisible: true, sortOrder: 99 , requiredInValidation: false },
        };

        // ─── עדכן checkboxes ───
        document.querySelectorAll(
            '.sc-admin-col-cb[data-field="defaultVisible"]:not(:disabled)'
        ).forEach(cb => {
            const key = cb.dataset.key;
            const val = systemDefaults[key]?.defaultVisible ?? false;
            cb.checked = val;

            const row = cb.closest('.sc-admin-col-row');
            const label = row?.querySelector('.sc-admin-col-toggle-label');
            if (label) label.textContent = val ? 'ברירת מחדל' : 'מוסתר';
        });

        // ─── סדר מחדש את השורות לפי sortOrder ───
        this._reorderRowsByDefault(systemDefaults);

        this.dashboard.showToast('✅ אופס לברירת מחדל של המערכת', 'info');
    }

    // ─── סדר שורות מחדש לפי מפה של sortOrder ───────────────
    _reorderRowsByDefault(defaultsMap) {
        const body = document.getElementById('scAdminColBody');
        if (!body) return;

        // ─── אסוף את כל השורות הניתנות להזזה ───
        const movableRows = [...body.querySelectorAll(
            '.sc-admin-col-row:not([data-key="number"]):not([data-key="buttons"])'
        )];

        // ─── מיין לפי sortOrder מהמפה ───
        movableRows.sort((a, b) => {
            const orderA = defaultsMap[a.dataset.key]?.sortOrder ?? 50;
            const orderB = defaultsMap[b.dataset.key]?.sortOrder ?? 50;
            return orderA - orderB;
        });

        // ─── מצא את שורת number (עוגן) ───
        const numberRow = body.querySelector('.sc-admin-col-row[data-key="number"]');
        const buttonsRow = body.querySelector('.sc-admin-col-row[data-key="buttons"]');

        // ─── הכנס שורות לפי הסדר החדש ───
        // כל שורה תוכנס לפני buttons (או בסוף אם אין buttons)
        movableRows.forEach(row => {
            if (buttonsRow && buttonsRow.parentNode) {
                buttonsRow.parentNode.insertBefore(row, buttonsRow);
            } else {
                // ─── מצא את ה-container המתאים ───
                const catName = row.dataset.category;
                const catEl = body.querySelector(
                    `.sc-admin-col-category[data-category="${catName}"]`
                );
                const rowsEl = catEl?.querySelector('.sc-admin-col-cat-rows');
                if (rowsEl) rowsEl.appendChild(row);
            }
        });

        // ─── עדכן מספרי סדר ───
        this._recalcSortOrders();
    }

    // ─── מחק עמודה ──────────────────────────────────────────
    _deleteColumn(key) {
        // ─── מנע מחיקת עמודות מערכת ───
        const systemKeys = ['number', 'buttons'];
        if (systemKeys.includes(key)) {
            this.dashboard.showToast('לא ניתן למחוק עמודת מערכת', 'error');
            return;
        }

        const row = document.querySelector(
            `.sc-admin-col-row[data-key="${key}"]`
        );
        if (!row) return;

        const labelEl = row.querySelector('.sc-admin-col-label-input');
        const label = labelEl?.value || key;

        if (!confirm(
            `למחוק את העמודה "${label}" (${key})?\n\n` +
            `פעולה זו תסיר את העמודה מכל המשתמשים.`
        )) return;

        // ─── אנימציה ───
        row.style.transition = 'opacity 0.3s, transform 0.3s';
        row.style.opacity = '0';
        row.style.transform = 'translateX(20px)';

        setTimeout(() => {
            row.remove();

            // ─── הסתר קטגוריה אם ריקה ───
            const catEl = document.querySelector(
                `.sc-admin-col-category[data-category="${row.dataset.category}"]`
            );
            if (catEl) {
                const remaining = catEl.querySelectorAll('.sc-admin-col-row');
                if (remaining.length === 0) {
                    catEl.style.transition = 'opacity 0.3s';
                    catEl.style.opacity = '0';
                    setTimeout(() => catEl.remove(), 300);
                }
            }

            // ─── עדכן מספרי סדר ───
            this._recalcSortOrders();
            this._updateColumnCount();
            this.dashboard.showToast(`🗑️ עמודה "${label}" הוסרה`, 'info');
        }, 300);
    }

    // ─── הוסף עמודה חדשה ────────────────────────────────────
    _addNewColumn(modalEl) {
        const keyInput = document.getElementById('scNewColKey');
        const labelInput = document.getElementById('scNewColLabel');
        const catSelect = document.getElementById('scNewColCategory');
        const defCb = document.getElementById('scNewColDefault');

        const key = (keyInput?.value || '').trim();
        const label = (labelInput?.value || '').trim();
        const cat = catSelect?.value || 'כללי';
        const isDef = defCb?.checked || false;

        // ─── ולידציה ───
        if (!key) {
            this.dashboard.showToast('מפתח העמודה נדרש', 'error');
            keyInput?.focus();
            return;
        }

        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
            this.dashboard.showToast(
                'מפתח חייב להתחיל באות אנגלית ולהכיל רק אותיות/מספרים/קו תחתון',
                'error'
            );
            keyInput?.focus();
            return;
        }

        if (!label) {
            this.dashboard.showToast('תווית העמודה נדרשת', 'error');
            labelInput?.focus();
            return;
        }

        // ─── בדוק כפילות ───
        const existing = document.querySelector(
            `.sc-admin-col-row[data-key="${key}"]`
        );
        if (existing) {
            this.dashboard.showToast(
                `עמודה עם מפתח "${key}" כבר קיימת`, 'error'
            );
            keyInput?.focus();
            return;
        }

        // ─── חשב sortOrder חדש (לפני buttons) ───
        const body = document.getElementById('scAdminColBody');
        const allMovable = body
            ? [...body.querySelectorAll(
                '.sc-admin-col-row:not([data-key="number"])' +
                ':not([data-key="buttons"])'
            )]
            : [];
        const maxOrder = allMovable.reduce((max, r) => {
            return Math.max(max, parseInt(r.dataset.sortOrder || '0', 10));
        }, 0);
        const newSortOrder = maxOrder + 1;

        // ─── בנה עמודה חדשה ───
        const fieldType = document.getElementById('scNewColFieldType')?.value || 'text';

        // ─── אסוף ערכים אפשריים (רק לרשימה) ───
        let allowedValues = null;
        if (fieldType === 'select' || fieldType === 'multiselect') {
            const textarea = document.getElementById('scNewColAllowedValues');
            const rawValues = textarea?.value || '';
            allowedValues = rawValues
                .split('\n')
                .map(v => v.trim())
                .filter(v => v.length > 0);
            
            if (allowedValues.length === 0) {
                this.dashboard.showToast('רשימה חייבת לכלול לפחות ערך אחד', 'error');
                return;
            }
        }

        const newCol = {
            key,
            label,
            defaultVisible: isDef,
            alwaysVisible: false,
            canReorder: true,
            category: cat,
            sortOrder: newSortOrder,
            fieldType,                    
            allowedValues: allowedValues, 
        };

        const color = this._getCategoryColor(cat);

        // ─── מצא/צור קטגוריה ───
        let catEl = document.querySelector(
            `.sc-admin-col-category[data-category="${cat}"]`
        );

        if (!catEl) {
            catEl = document.createElement('div');
            catEl.className = 'sc-admin-col-category';
            catEl.dataset.category = cat;
            catEl.innerHTML = `
                <div class="sc-admin-col-cat-header"
                     style="border-right:3px solid ${color}">
                    <i class="fas fa-layer-group"
                       style="color:${color};font-size:0.7rem"></i>
                    <span style="color:${color};font-weight:700">${cat}</span>
                    <span class="sc-admin-col-cat-count"
                          style="background:${color}22;
                                 border:1px solid ${color}44;
                                 color:${color}">0</span>
                </div>
                <div class="sc-admin-col-cat-rows"></div>`;

            if (body) body.appendChild(catEl);
        }

        // ─── הוסף שורה לפני buttons (אם קיים באותה קטגוריה) ───
        const rowsEl = catEl.querySelector('.sc-admin-col-cat-rows');
        if (rowsEl) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = this._renderColumnRow(newCol, color);
            const newRow = tempDiv.firstElementChild;

            // ─── אנימציה כניסה ───
            newRow.style.opacity = '0';
            newRow.style.transform = 'translateX(-10px)';
            rowsEl.appendChild(newRow);

            requestAnimationFrame(() => {
                newRow.style.transition = 'opacity 0.3s, transform 0.3s';
                newRow.style.opacity = '1';
                newRow.style.transform = 'translateX(0)';
                // ─── נקה גם שדות הוספת עמודה ───
                if (keyInput) keyInput.value = '';
                if (labelInput) labelInput.value = '';
                if (defCb) defCb.checked = false;

                // ─── חדש: נקה שדות סוג שדה ───
                const fieldTypeSelect = document.getElementById('scNewColFieldType');
                if (fieldTypeSelect) fieldTypeSelect.value = 'text';

                const allowedValuesTextarea = document.getElementById('scNewColAllowedValues');
                if (allowedValuesTextarea) allowedValuesTextarea.value = '';

                const valuesWrap = document.getElementById('scNewColAllowedValuesWrap');
                if (valuesWrap) valuesWrap.style.display = 'none';

                const preview = document.getElementById('scNewColValuesPreview');
                if (preview) preview.innerHTML = '';
            });
        }

        // ─── עדכן מונה קטגוריה ───
        const countEl = catEl.querySelector('.sc-admin-col-cat-count');
        if (countEl) {
            const rows = catEl.querySelectorAll('.sc-admin-col-row').length;
            countEl.textContent = rows;
        }

        // ─── עדכן מספרי סדר ───
        this._recalcSortOrders();

        // ─── נקה שדות ───
        if (keyInput) keyInput.value = '';
        if (labelInput) labelInput.value = '';
        if (defCb) defCb.checked = false;

        this._updateColumnCount();
        this.dashboard.showToast(`✅ עמודה "${label}" נוספה`, 'success');
    }

    // ─── הצג/הסתר אזור ערכי רשימה לפי סוג שדה ───────────────
    _onFieldTypeChange(fieldType) {
        const wrap = document.getElementById('scNewColAllowedValuesWrap');
        if (!wrap) return;

        if (fieldType === 'select' || fieldType === 'multiselect') {
            wrap.style.display = 'block';
            wrap.style.animation = 'scFadeIn 0.2s ease';
            
            // ─── עדכן placeholder לפי הקשר ───
            const textarea = document.getElementById('scNewColAllowedValues');
            if (textarea && !textarea.value) {
                textarea.placeholder = 'פעיל\nלא פעיל\nבפיתוח\nמבוטל\n...';
            }
        } else {
            wrap.style.display = 'none';
        }
    }

    // ─── הוסף ערך לתצוגה מקדימה ──────────────────────────────
    _addValueToList() {
        const modal = document.getElementById('scAdminColModal');
        if (!modal) return;
        
        // ─── פתח mini-dialog להזנת ערך ───
        const existingDialog = document.getElementById('scAddValueDialog');
        if (existingDialog) { existingDialog.remove(); return; }
        
        const dialog = document.createElement('div');
        dialog.id = 'scAddValueDialog';
        dialog.style.cssText = `
            position: absolute;
            background: #252535;
            border: 1px solid #3a3a5a;
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 4px 14px rgba(0,0,0,0.4);
            z-index: 9999;
            display: flex;
            gap: 6px;
            align-items: center;
            direction: rtl;
        `;
        dialog.innerHTML = `
            <input type="text"
                id="scAddValueInput"
                class="sc-edit-input"
                placeholder="הזן ערך..."
                style="width:150px;padding:5px 8px !important;
                        font-size:0.8rem !important"
                autofocus/>
            <button onclick="window._adminColMgr._confirmAddValue()"
                    style="padding:5px 10px;background:rgba(34,197,94,0.15);
                        border:1px solid rgba(34,197,94,0.4);border-radius:5px;
                        color:#86efac;font-size:0.78rem;cursor:pointer;
                        font-family:inherit">
                <i class="fas fa-check"></i>
            </button>
            <button onclick="document.getElementById('scAddValueDialog')?.remove()"
                    style="padding:5px 8px;background:rgba(239,68,68,0.12);
                        border:1px solid rgba(239,68,68,0.3);border-radius:5px;
                        color:#fca5a5;font-size:0.78rem;cursor:pointer;
                        font-family:inherit">
                <i class="fas fa-times"></i>
            </button>`;
        
        const btn = document.getElementById('scNewColAddValue');
        if (btn) {
            btn.parentNode.appendChild(dialog);
            const input = document.getElementById('scAddValueInput');
            input?.focus();
            
            // ─── Enter לאישור ───
            input?.addEventListener('keydown', e => {
                if (e.key === 'Enter') this._confirmAddValue();
                if (e.key === 'Escape') dialog.remove();
            });
        }
    }

    // ─── אשר הוספת ערך לרשימה ────────────────────────────────
    _confirmAddValue() {
        const input = document.getElementById('scAddValueInput');
        const textarea = document.getElementById('scNewColAllowedValues');
        const val = input?.value?.trim();
        
        if (!val) {
            document.getElementById('scAddValueDialog')?.remove();
            return;
        }
        
        if (textarea) {
            const existing = textarea.value.trim();
            textarea.value = existing ? `${existing}\n${val}` : val;
            this._updateValuesPreview();
        }
        
        document.getElementById('scAddValueDialog')?.remove();
        this.dashboard.showToast(`✅ ערך "${val}" נוסף`, 'info', 1500);
    }

    // ─── עדכן תצוגה מקדימה של ערכי הרשימה ───────────────────
    _updateValuesPreview() {
        const textarea = document.getElementById('scNewColAllowedValues');
        const preview = document.getElementById('scNewColValuesPreview');
        if (!textarea || !preview) return;
        
        const values = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(v => v.length > 0);
        
        if (values.length === 0) {
            preview.innerHTML = '<span style="font-size:0.72rem;color:#444;font-style:italic">אין ערכים עדיין</span>';
            return;
        }
        
        preview.innerHTML = values.map((v, i) => `
            <span style="
                display:inline-flex;align-items:center;gap:4px;
                padding:2px 8px;
                background:rgba(99,102,241,0.12);
                border:1px solid rgba(99,102,241,0.25);
                border-radius:8px;
                font-size:0.72rem;
                color:#a5b4fc;">
                ${v}
                <button onclick="window._adminColMgr._removePreviewValue(${i})"
                        style="background:none;border:none;color:#555;
                            cursor:pointer;font-size:0.55rem;padding:0 1px;
                            line-height:1;transition:color 0.15s"
                        onmouseover="this.style.color='#fca5a5'"
                        onmouseout="this.style.color='#555'">
                    <i class="fas fa-times"></i>
                </button>
            </span>`).join('');
    }

    // ─── הסר ערך מהתצוגה המקדימה ─────────────────────────────
    _removePreviewValue(index) {
        const textarea = document.getElementById('scNewColAllowedValues');
        if (!textarea) return;
        
        const values = textarea.value
            .split('\n')
            .map(v => v.trim())
            .filter(v => v.length > 0);
        
        values.splice(index, 1);
        textarea.value = values.join('\n');
        this._updateValuesPreview();
    }

    // ─── עדכן מונה עמודות ───────────────────────────────────
    _updateColumnCount() {
        const countEl = document.getElementById('scAdminColCount');
        if (!countEl) return;
        const total = document.querySelectorAll('.sc-admin-col-row').length;
        countEl.textContent = `${total} עמודות מוגדרות`;
    }

    // ─── צבע לפי קטגוריה ────────────────────────────────────
    _getCategoryColor(cat) {
        const colors = {
            'בסיסי': '#6366f1',
            'ארגוני': '#3b82f6',
            'טכני': '#06b6d4',
            'עסקי': '#f59e0b',
            'ספקים': '#8b5cf6',
            'תאריכים': '#10b981',
            'תיקוף': '#f43f5e',
            'אוטומציה': '#22c55e',
            'סקרים': '#ec4899',
            'כלים': '#84cc16',
            'כללי': '#6b7280',
            'מערכת': '#374151',
        };
        return colors[cat] || '#6b7280';
    }

    // ══════════════════════════════════════════════════════════
    // שמור לשרת - כולל שמירת הסדר מה-DOM
    // ══════════════════════════════════════════════════════════
    async _saveToServer(modalEl) {
        const saveBtn = document.getElementById('scAdminColSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            // ─── עדכן sortOrder לפני איסוף ───
            this._recalcSortOrders();

            const columns = [];

            const body = document.getElementById('scAdminColBody');
            if (!body) throw new Error('לא נמצא גוף הטבלה');

            // ─── אסוף לפי הסדר הנוכחי ב-DOM ───
            // סדר: number → שאר (לפי DOM) → buttons
            const allRows = [...body.querySelectorAll('.sc-admin-col-row')];

            const orderedRows = [
                // number תמיד ראשון
                ...allRows.filter(r => r.dataset.key === 'number'),
                // שאר לפי סדר DOM (כפי שהמשתמש סידר)
                ...allRows.filter(
                    r => r.dataset.key !== 'number' &&
                        r.dataset.key !== 'buttons'
                ),
                // buttons תמיד אחרון
                ...allRows.filter(r => r.dataset.key === 'buttons'),
            ];

            let sortOrder = 0;

            orderedRows.forEach(row => {
                const key = row.dataset.key;
                if (!key) return;

                const labelInput = row.querySelector(
                    `.sc-admin-col-label-input[data-key="${key}"]`
                );
                const labelText = row.querySelector(
                    '.sc-admin-col-label-text'
                );
                const label = labelInput?.value?.trim()
                    || labelText?.textContent?.trim()
                    || key;

                const defaultCb = row.querySelector(
                    `.sc-admin-col-cb[data-key="${key}"]` +
                    `[data-field="defaultVisible"]`
                );
                const alwaysCb = row.querySelector(
                    `.sc-admin-col-cb[data-key="${key}"]` +
                    `[data-field="alwaysVisible"]`
                );
                const catSelect = row.querySelector(
                    `.sc-admin-col-cat-select[data-key="${key}"]`
                );
                const catBadge = row.querySelector(
                    '.sc-admin-col-cat-badge'
                );
                const validationCb = row.querySelector(
                    `.sc-admin-col-cb[data-key="${key}"][data-field="showInValidation"]`
                );
                const requiredInValCb = row.querySelector(
                    `.sc-admin-col-cb[data-key="${key}"][data-field="requiredInValidation"]`
                );
                
                // ─── אסוף fieldType ו-allowedValues מה-row ───
                const fieldTypeSelect = row.querySelector(
                    `.sc-admin-col-field-type-select[data-key="${key}"]`
                );
                const fieldType = fieldTypeSelect?.value 
                    || row.dataset.fieldType 
                    || 'text';

                let allowedValues = null;
                if (fieldType === 'select' || fieldType === 'multiselect') {
                    // ─── נסה לקבל מ-data attribute ───
                    if (row.dataset.allowedValues) {
                        try {
                            allowedValues = JSON.parse(row.dataset.allowedValues);
                        } catch { allowedValues = null; }
                    }
                }

                columns.push({
                    key,
                    label,
                    defaultVisible: defaultCb?.checked ?? false,
                    alwaysVisible:  alwaysCb?.checked  ?? false,
                    canReorder:     key !== 'number' && key !== 'buttons',
                    category:       catSelect?.value
                        || catBadge?.textContent?.trim()
                        || row.dataset.category
                        || 'כללי',
                    showInValidation: validationCb?.checked ?? false,
                    requiredInValidation: requiredInValCb?.checked ?? false,
                    // ─── חדש: סוג שדה וערכים ───
                    fieldType,
                    allowedValues,
                    // ─── sortOrder לפי מיקום ב-DOM ───
                    sortOrder: sortOrder++,
                });
            });

            if (columns.length === 0) {
                this.dashboard.showToast('לא נמצאו עמודות לשמירה', 'error');
                return;
            }

            // ─── שלח לשרת ───
            const res = await fetch(
                '/SystemsCatalog/SaveColumnDefinitions',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ columns })
                }
            );

            const data = await res.json();
            if (!data.success)
                throw new Error(data.error || 'שגיאה בשמירה');

            // ─── עדכן את ה-dashboard ───
            await this.dashboard._loadColumnDefinitionsFromServer();

            modalEl.remove();

            this.dashboard.showToast(
                `✅ ${data.message} — הסדר החדש יחול על כל המשתמשים`,
                'success',
                5000
            );

            // ─── רענן תצוגה ───
            this.dashboard.renderContent();

        } catch (err) {
            console.error('_saveToServer error:', err);
            this.dashboard.showToast('שגיאה: ' + err.message, 'error');

            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    '<i class="fas fa-globe"></i> שמור לכל המשתמשים';
            }
        }
    }

    // ══════════════════════════════════════════════════════════
    // סגנונות
    // ══════════════════════════════════════════════════════════
    addStyles() {
        if (document.getElementById('scAdminColStyles')) return;
        const style = document.createElement('style');
        style.id = 'scAdminColStyles';
        style.textContent = `

        /* ══ Admin Column Manager Modal ══ */
        .sc-admin-col-meta {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 20px;
            background: rgba(99,102,241,0.06);
            border-bottom: 1px solid rgba(99,102,241,0.15);
            font-size: 0.78rem;
            color: #888;
            flex-shrink: 0;
        }

        .sc-admin-col-warning {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 10px 20px;
            background: rgba(245,158,11,0.07);
            border-bottom: 1px solid rgba(245,158,11,0.2);
            font-size: 0.78rem;
            color: #fcd34d;
            line-height: 1.5;
            flex-shrink: 0;
        }

        .sc-admin-col-toolbar {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 20px;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-shrink: 0;
            flex-wrap: wrap;
        }

        /* ── כותרת עמודות הטבלה ── */
        .sc-admin-col-table-header {
            display: grid;
            grid-template-columns: 70px 160px 1fr 130px 120px 110px 110px 120px 36px;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: #0f0f1e;
            border-bottom: 2px solid rgba(99,102,241,0.25);
            flex-shrink: 0;
        }

        .sc-admin-col-th {
            font-size: 0.68rem;
            font-weight: 700;
            color: #555;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            white-space: nowrap;
        }

        .sc-admin-col-th-order  { color: #6366f1; text-align: center; }
        .sc-admin-col-th-key    { color: #6366f1; }
        .sc-admin-col-th-label  { }
        .sc-admin-col-th-default{ }
        .sc-admin-col-th-always { }
        .sc-admin-col-th-cat    { }
        .sc-admin-col-th-del    { }

        .sc-admin-col-ctrl-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            border: 1px solid;
            font-family: inherit;
            white-space: nowrap;
        }

        .sc-admin-col-ctrl-all {
            background: rgba(34,197,94,0.1);
            border-color: rgba(34,197,94,0.3);
            color: #86efac;
        }
        .sc-admin-col-ctrl-all:hover {
            background: rgba(34,197,94,0.2);
            border-color: rgba(34,197,94,0.5);
        }

        .sc-admin-col-ctrl-none {
            background: rgba(239,68,68,0.1);
            border-color: rgba(239,68,68,0.25);
            color: #fca5a5;
        }
        .sc-admin-col-ctrl-none:hover {
            background: rgba(239,68,68,0.2);
            border-color: rgba(239,68,68,0.45);
        }

        .sc-admin-col-ctrl-reset {
            background: rgba(107,114,128,0.1);
            border-color: rgba(107,114,128,0.25);
            color: #9ca3af;
        }
        .sc-admin-col-ctrl-reset:hover {
            background: rgba(107,114,128,0.2);
            border-color: rgba(107,114,128,0.45);
            color: #e0e0e0;
        }

        /* ── גוף ── */
        .sc-admin-col-body {
            flex: 1;
            overflow-y: auto;
            padding: 12px 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .sc-admin-col-body::-webkit-scrollbar { width: 6px; }
        .sc-admin-col-body::-webkit-scrollbar-track { background: #111; }
        .sc-admin-col-body::-webkit-scrollbar-thumb {
            background: #333; border-radius: 3px;
        }

        /* ── קטגוריה ── */
        .sc-admin-col-category {
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 8px;
            overflow: hidden;
        }

        .sc-admin-col-cat-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            background: rgba(255,255,255,0.03);
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 0.78rem;
        }

        .sc-admin-col-cat-count {
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

        .sc-admin-col-cat-rows {
            display: flex;
            flex-direction: column;
        }

        /* ── שורת עמודה ── */
        .sc-admin-col-row {
            display: grid;
            grid-template-columns: 70px 160px 1fr 130px 120px 110px 110px 120px 36px;
            align-items: center;
            gap: 8px;
            padding: 7px 12px;
            border-bottom: 1px dashed rgba(255,255,255,0.04);
            transition: background 0.12s;
            font-size: 0.8rem;
        }

        .sc-admin-col-row:last-child { border-bottom: none; }

        .sc-admin-col-row:hover {
            background: rgba(99,102,241,0.05);
        }

        .sc-admin-col-row-system {
            opacity: 0.65;
            background: rgba(255,255,255,0.01);
        }

        .sc-admin-col-row-system:hover {
            background: rgba(255,255,255,0.02);
        }

        /* ── כפתורי סדר ── */
        .sc-admin-col-order-wrap {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .sc-admin-col-order-btns {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1px;
        }

        .sc-admin-col-order-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 20px;
            height: 16px;
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 3px;
            color: #6366f1;
            cursor: pointer;
            font-size: 0.55rem;
            transition: all 0.15s;
            padding: 0;
            line-height: 1;
        }

        .sc-admin-col-order-btn:hover {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.5);
            color: #a5b4fc;
            transform: scale(1.1);
        }

        .sc-admin-col-order-btn:active {
            transform: scale(0.95);
        }

        .sc-admin-col-order-num {
            font-size: 0.62rem;
            color: #555;
            font-family: monospace;
            min-width: 18px;
            text-align: center;
            line-height: 1;
            padding: 1px 0;
        }

        .sc-admin-col-order-locked {
            color: #333;
            font-size: 0.65rem;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
        }

        /* ── מפתח ── */
        .sc-admin-col-key {
            font-family: monospace;
            font-size: 0.72rem;
            color: #6366f1;
            background: rgba(99,102,241,0.1);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 4px;
            padding: 2px 7px;
            white-space: nowrap;
                    overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ── תווית ── */
        .sc-admin-col-label-wrap {
            min-width: 0;
        }

        .sc-admin-col-label-input {
            width: 100%;
            padding: 4px 8px !important;
            font-size: 0.8rem !important;
            box-sizing: border-box;
        }

        .sc-admin-col-label-text {
            font-size: 0.82rem;
            color: #ccc;
            font-weight: 600;
        }

        /* ── Toggle ── */
        .sc-admin-col-toggle-wrap {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .sc-admin-col-toggle {
            position: relative;
            display: inline-block;
            width: 34px;
            height: 18px;
            flex-shrink: 0;
        }

        .sc-admin-col-toggle input {
            opacity: 0;
            width: 0;
            height: 0;
            position: absolute;
        }

        .sc-admin-col-toggle-slider {
            position: absolute;
            inset: 0;
            background: #3a3a5a;
            border-radius: 9px;
            cursor: pointer;
            transition: background 0.2s;
        }

        .sc-admin-col-toggle-slider::after {
            content: '';
            position: absolute;
            top: 2px;
            left: 2px;
            width: 14px;
            height: 14px;
            background: #666;
            border-radius: 50%;
            transition: transform 0.2s, background 0.2s;
        }

        .sc-admin-col-toggle input:checked + .sc-admin-col-toggle-slider {
            background: rgba(99,102,241,0.4);
            border: 1px solid rgba(99,102,241,0.6);
        }

        .sc-admin-col-toggle input:checked + .sc-admin-col-toggle-slider::after {
            transform: translateX(16px);
            background: #a5b4fc;
        }

        .sc-admin-col-toggle-locked {
            opacity: 0.4;
            cursor: not-allowed !important;
        }

        .sc-admin-col-toggle-label {
            font-size: 0.7rem;
            color: #666;
            white-space: nowrap;
            min-width: 55px;
        }

        /* ── קטגוריה select ── */
        .sc-admin-col-cat-select {
            font-size: 0.72rem !important;
            padding: 3px 6px !important;
            width: 100%;
        }

        .sc-admin-col-cat-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: 8px;
            font-size: 0.7rem;
            font-weight: 700;
            white-space: nowrap;
        }

        .sc-admin-col-cat-select-wrap {
            min-width: 0;
        }

        /* ── מחיקה ── */
        .sc-admin-col-delete-btn {
            background: none;
            border: 1px solid transparent;
            border-radius: 5px;
            color: #444;
            cursor: pointer;
            font-size: 0.7rem;
            padding: 4px 6px;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .sc-admin-col-delete-btn:hover {
            background: rgba(239,68,68,0.15);
            border-color: rgba(239,68,68,0.35);
            color: #fca5a5;
        }

        .sc-admin-col-delete-wrap {
            display: flex;
            align-items: center;
            justify-content: center;
        }

        /* ── הוסף עמודה חדשה ── */
        .sc-admin-col-add-section {
            padding: 12px 20px;
            background: rgba(34,197,94,0.04);
            border-top: 1px solid rgba(34,197,94,0.15);
            flex-shrink: 0;
        }

        .sc-admin-col-add-title {
            font-size: 0.78rem;
            font-weight: 600;
            color: #86efac;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .sc-admin-col-add-form {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }

        .sc-admin-col-add-form .sc-edit-input {
            padding: 6px 10px !important;
            font-size: 0.8rem !important;
        }

        .sc-admin-col-checkbox-label {
            display: flex;
            align-items: center;
            gap: 5px;
            font-size: 0.78rem;
            color: #aaa;
            cursor: pointer;
            white-space: nowrap;
            user-select: none;
        }

        .sc-admin-col-add-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 6px 14px;
            background: rgba(34,197,94,0.15);
            border: 1px solid rgba(34,197,94,0.4);
            border-radius: 6px;
            color: #86efac;
            font-size: 0.8rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-family: inherit;
            white-space: nowrap;
            flex-shrink: 0;
        }

        .sc-admin-col-add-btn:hover {
            background: rgba(34,197,94,0.25);
            border-color: rgba(34,197,94,0.6);
            transform: translateY(-1px);
        }

        /* ══ Light Mode ══ */
        [data-theme="light"] .sc-admin-col-meta {
            background: rgba(99,102,241,0.04);
            border-bottom: 1px solid rgba(99,102,241,0.1);
            color: #555;
        }

        [data-theme="light"] .sc-admin-col-warning {
            background: rgba(245,158,11,0.05);
            border-bottom: 1px solid rgba(245,158,11,0.15);
            color: #b45309;
        }

        [data-theme="light"] .sc-admin-col-toolbar {
            background: #f0f0f8;
            border-bottom: 1px solid #ddd;
        }

        [data-theme="light"] .sc-admin-col-table-header {
            background: #eeeef8;
            border-bottom: 2px solid rgba(99,102,241,0.2);
        }

        [data-theme="light"] .sc-admin-col-th {
            color: #888;
        }

        [data-theme="light"] .sc-admin-col-th-order,
        [data-theme="light"] .sc-admin-col-th-key {
            color: #4338ca;
        }

        [data-theme="light"] .sc-admin-col-body {
            background: #f8f8ff;
        }

        [data-theme="light"] .sc-admin-col-body::-webkit-scrollbar-track {
            background: #f0f0f8;
        }

        [data-theme="light"] .sc-admin-col-body::-webkit-scrollbar-thumb {
            background: #ccc;
        }

        [data-theme="light"] .sc-admin-col-category {
            background: #fff;
            border: 1px solid #e0e0f0;
        }

        [data-theme="light"] .sc-admin-col-cat-header {
            background: #f5f5ff;
            border-bottom: 1px solid #e8e8f8;
        }

        [data-theme="light"] .sc-admin-col-row:hover {
            background: rgba(99,102,241,0.04);
        }

        [data-theme="light"] .sc-admin-col-row-system {
            background: rgba(0,0,0,0.01);
        }

        [data-theme="light"] .sc-admin-col-order-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.15);
            color: #4338ca;
        }

        [data-theme="light"] .sc-admin-col-order-btn:hover {
            background: rgba(99,102,241,0.18);
            border-color: rgba(99,102,241,0.4);
            color: #3730a3;
        }

        [data-theme="light"] .sc-admin-col-order-num {
            color: #999;
        }

        [data-theme="light"] .sc-admin-col-order-locked {
            color: #ccc;
        }

        [data-theme="light"] .sc-admin-col-key {
            background: rgba(99,102,241,0.06);
            border-color: rgba(99,102,241,0.15);
            color: #4338ca;
        }

        [data-theme="light"] .sc-admin-col-label-text {
            color: #1a1a2e;
        }

        [data-theme="light"] .sc-admin-col-toggle-slider {
            background: #ddd;
        }

        [data-theme="light"] .sc-admin-col-toggle-slider::after {
            background: #aaa;
        }

        [data-theme="light"] .sc-admin-col-toggle
            input:checked + .sc-admin-col-toggle-slider {
            background: rgba(99,102,241,0.25);
            border-color: rgba(99,102,241,0.45);
        }

        [data-theme="light"] .sc-admin-col-toggle
            input:checked + .sc-admin-col-toggle-slider::after {
            background: #4338ca;
        }

        [data-theme="light"] .sc-admin-col-toggle-label { color: #888; }

        [data-theme="light"] .sc-admin-col-delete-btn { color: #bbb; }

        [data-theme="light"] .sc-admin-col-delete-btn:hover {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.25);
            color: #dc2626;
        }

        [data-theme="light"] .sc-admin-col-add-section {
            background: rgba(34,197,94,0.03);
            border-top: 1px solid rgba(34,197,94,0.1);
        }

        [data-theme="light"] .sc-admin-col-add-title { color: #15803d; }

        [data-theme="light"] .sc-admin-col-add-btn {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.25);
            color: #15803d;
        }

        [data-theme="light"] .sc-admin-col-add-btn:hover {
            background: rgba(34,197,94,0.15);
            border-color: rgba(34,197,94,0.4);
        }

        [data-theme="light"] .sc-admin-col-checkbox-label { color: #555; }

        [data-theme="light"] .sc-admin-col-ctrl-all {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.2);
            color: #15803d;
        }

        [data-theme="light"] .sc-admin-col-ctrl-none {
            background: rgba(239,68,68,0.08);
            border-color: rgba(239,68,68,0.2);
            color: #dc2626;
        }

        [data-theme="light"] .sc-admin-col-ctrl-reset {
            background: rgba(107,114,128,0.08);
            border-color: rgba(107,114,128,0.2);
            color: #6b7280;
        }

        /* ══ Responsive ══ */
        @media (max-width: 768px) {
            .sc-admin-col-table-header {
                grid-template-columns: 60px 120px 1fr 110px 36px;
            }

            .sc-admin-col-row {
                grid-template-columns: 60px 120px 1fr 110px 36px;
                gap: 6px;
            }

            /* ─── הסתר עמודות פחות חשובות במסך קטן ─── */
            .sc-admin-col-th-always,
            .sc-admin-col-th-cat,
            .sc-admin-col-toggle-wrap:nth-child(5),
            .sc-admin-col-cat-select-wrap {
                display: none;
            }
        }

        @media (max-width: 520px) {
            .sc-admin-col-table-header {
                grid-template-columns: 50px 1fr 100px 36px;
            }

            .sc-admin-col-row {
                grid-template-columns: 50px 1fr 100px 36px;
            }

            .sc-admin-col-th-key,
            .sc-admin-col-key {
                display: none;
            }
        }

        /* ══ Field Type Select ══ */
        .sc-admin-col-field-type-wrap {
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 0;
        }

        .sc-admin-col-field-type-select {
            font-size: 0.72rem !important;
            padding: 3px 6px !important;
            width: 100%;
            max-width: 90px;
        }

        .sc-admin-col-field-type-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            background: rgba(107,114,128,0.12);
            border: 1px solid rgba(107,114,128,0.25);
            border-radius: 6px;
            font-size: 0.68rem;
            color: #666;
            white-space: nowrap;
        }

        /* ── כפתור ערכי רשימה ── */
        .sc-admin-col-values-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 3px 7px;
            background: rgba(99,102,241,0.15);
            border: 1px solid rgba(99,102,241,0.35);
            border-radius: 5px;
            color: #a5b4fc;
            cursor: pointer;
            font-size: 0.68rem;
            transition: all 0.15s;
            flex-shrink: 0;
            white-space: nowrap;
        }

        .sc-admin-col-values-btn:hover {
            background: rgba(99,102,241,0.28);
            border-color: rgba(99,102,241,0.6);
            transform: scale(1.05);
        }

        .sc-admin-col-values-btn-empty {
            background: rgba(245,158,11,0.12);
            border-color: rgba(245,158,11,0.3);
            color: #fcd34d;
        }

        .sc-admin-col-values-btn-empty:hover {
            background: rgba(245,158,11,0.25);
            border-color: rgba(245,158,11,0.55);
        }

        /* ── Light Mode ── */
        [data-theme="light"] .sc-admin-col-field-type-badge {
            background: rgba(107,114,128,0.08);
            border-color: rgba(107,114,128,0.18);
            color: #888;
        }

        [data-theme="light"] .sc-admin-col-values-btn {
            background: rgba(99,102,241,0.08);
            border-color: rgba(99,102,241,0.25);
            color: #4338ca;
        }

        [data-theme="light"] .sc-admin-col-values-btn:hover {
            background: rgba(99,102,241,0.16);
            border-color: rgba(99,102,241,0.45);
        }

        [data-theme="light"] .sc-admin-col-values-btn-empty {
            background: rgba(245,158,11,0.08);
            border-color: rgba(245,158,11,0.2);
            color: #b45309;
        }

        /* המודל עצמו - display flex, ללא overflow */
        #scAdminColModal .sc-modal {
            display: flex;
            flex-direction: column;
            max-height: 90vh;
            overflow: hidden;  /* ← שנה מ-overflow-y: auto */
        }

        /* Header - לא גולל */
        #scAdminColModal .sc-modal-header {
            flex-shrink: 0;
        }

        /* Meta + Warning + Toolbar - לא גוללים */
        .sc-admin-col-meta,
        .sc-admin-col-warning,
        .sc-admin-col-toolbar,
        .sc-admin-col-table-header {
            flex-shrink: 0;
        }

        /* Body - גולל */
        .sc-admin-col-body {
            flex: 1;
            overflow-y: auto;
            min-height: 0; /* ← חשוב ב-flex! */
        }

        /* Add section - לא גולל */
        .sc-admin-col-add-section {
            flex-shrink: 0;
        }

        /* Footer - לא גולל */
        #scAdminColModal .sc-modal-footer {
            flex-shrink: 0;
        }
        `;
        document.head.appendChild(style);
    }
}

// ══════════════════════════════════════════════════════════════
// יצירת מופע גלובלי
// ══════════════════════════════════════════════════════════════
window.AdminColumnManager = SystemsCatalogAdminColumnManager;