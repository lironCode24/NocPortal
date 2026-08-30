class AchievementsDashboard {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.achievements = [];
        this.searchTerm = '';
        this.filterCategory = 'ALL';
        this.sortMode = localStorage.getItem('achSortMode') || 'date_desc';
        this.currentUser = null;
        this.isPrivileged = false;
        this.isCanEdit = false;
        this.refreshInterval = null;
        this.REFRESH_MS = 5 * 60 * 1000;

        // *** צבעי קטגוריות ***
        this.CATEGORY_COLORS = {
            'נוהל': { bg: '#e0f2fe', border: '#0284c7', icon: 'fa-file-alt', text: '#0369a1' },
            'תקלה': { bg: '#fef3c7', border: '#d97706', icon: 'fa-tools', text: '#92400e' },
            'שיפור': { bg: '#d1fae5', border: '#059669', icon: 'fa-chart-line', text: '#065f46' },
            'הדרכה': { bg: '#ede9fe', border: '#7c3aed', icon: 'fa-chalkboard-teacher', text: '#4c1d95' },
            'פרויקט': { bg: '#fce7f3', border: '#db2777', icon: 'fa-project-diagram', text: '#9d174d' },
            'דשבורדים': { bg: '#ecfdf5', border: '#10b981', icon: 'fa-chart-bar', text: '#064e3b' },
            'תיעוד': { bg: '#fff7ed', border: '#ea580c', icon: 'fa-book', text: '#7c2d12' },
            'אחר': { bg: '#f1f5f9', border: '#64748b', icon: 'fa-star', text: '#334155' },
        };

        // *** תצורת השפעה (במקום עדיפות) ***
        this.IMPACT_CONFIG = {
            high: { label: 'גבוהה', color: '#dc2626', bg: '#fee2e2', stars: 1 },
            medium: { label: 'בינונית', color: '#d97706', bg: '#fef3c7', stars: 1 },
            low: { label: 'נמוכה', color: '#16a34a', bg: '#dcfce7', stars: 1 },
        };
    }

    // ==========================================
    // אתחול
    // ==========================================
    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container #${this.containerId} not found`);
            return;
        }

        this.addStyles();

        // טען הרשאות קודם, רק אחר כך רנדר
        await this.loadPermissions();

        this.renderShell();
        this.bindEvents();

        await this.loadData();

        this.refreshInterval = setInterval(
            () => this.loadData(), this.REFRESH_MS
        );
    }

    destroy() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
    }

    // ==========================================
    // הרשאות
    // ==========================================
    async loadPermissions() {
        try {
            const res = await fetch('/EmployeeTasks/GetMyPermissions',
                { credentials: 'include' });
            const data = await res.json();
            if (!data.error) {
                this.currentUser = data;
                this.isPrivileged = data.isPrivileged === true;
                this.isCanEdit = (data.role === "Admin");
            }
        } catch (err) {
            console.error('loadPermissions error:', err);
            this.isPrivileged = false;
            this.isCanEdit = false;
        }
    }

    // ==========================================
    // טעינת נתונים
    // ==========================================
    async loadData() {
        try {
            this.showLoading(true);

            const url = '/Achievements/GetAll';
            const achRes = await fetch(url, { credentials: 'include' });
            const achData = await achRes.json();

            if (!achData.error) {
                this.achievements = achData.achievements || [];
            }

            this.renderBoard();
            this.showLoading(false);
            this.updateLastRefresh();

        } catch (err) {
            console.error('AchievementsDashboard loadData error:', err);
            this.showLoading(false);
            this.showError('שגיאה בטעינת הנתונים');
        }
    }

    // ==========================================
    // סינון ומיון
    // ==========================================
    getFilteredAchievements() {
        let list = [...this.achievements];

        if (this.filterCategory !== 'ALL') {
            list = list.filter(a => a.category === this.filterCategory);
        }

        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            list = list.filter(a =>
                (a.title || '').toLowerCase().includes(term) ||
                (a.description || '').toLowerCase().includes(term)
            );
        }

        switch (this.sortMode) {
            case 'date_desc':
                list.sort((a, b) =>
                    // ✅ מיין לפי תאריך ביצוע, fallback לתאריך יצירה
                    new Date(b.achievementDate || b.createdAt || 0) -
                    new Date(a.achievementDate || a.createdAt || 0));
                break;
            case 'date_asc':
                list.sort((a, b) =>
                    new Date(a.achievementDate || a.createdAt || 0) -
                    new Date(b.achievementDate || b.createdAt || 0));
                break;
            case 'category':
                list.sort((a, b) =>
                    (a.category || '').localeCompare(b.category || '', 'he'));
                break;
            case 'impact': {
                // תוקן: case עם {} למניעת בעיית const
                const iOrder = { high: 0, medium: 1, low: 2 };
                list.sort((a, b) =>
                    (iOrder[a.priority] ?? 3) - (iOrder[b.priority] ?? 3));
                break;
            }
            case 'title':
                list.sort((a, b) =>
                    (a.title || '').localeCompare(b.title || '', 'he'));
                break;
        }

        return list;
    }

    getCategories() {
        const cats = new Set(
            this.achievements.map(a => a.category).filter(Boolean)
        );
        return [
            'ALL',
            ...Object.keys(this.CATEGORY_COLORS).filter(c => cats.has(c)),
            ...[...cats].filter(c => !this.CATEGORY_COLORS[c])
        ];
    }

    // ==========================================
    // רינדור מעטפת
    // ==========================================
    renderShell() {
        this.container.innerHTML = `
        <div class="ach-root">

            <!-- Header -->
            <div class="ach-header">
                <div class="ach-header-top">

                    <div class="ach-header-filters">
                        <!-- פילטר קטגוריה -->
                        <div class="ach-filter-wrap">
                            <i class="fas fa-tag ach-filter-icon"></i>
                            <select id="achCategoryFilter" class="ach-select">
                                <option value="ALL">📂 כל הקטגוריות</option>
                            </select>
                        </div>

                        <!-- מיון -->
                        <div class="ach-filter-wrap">
                            <i class="fas fa-sort ach-filter-icon"></i>
                            <select id="achSortSelect" class="ach-select">
                                <option value="date_desc">🕐 חדש ראשון</option>
                                <option value="date_asc">🕐 ישן ראשון</option>
                                <option value="category">🏷️ לפי קטגוריה</option>
                                <option value="impact">⭐ לפי השפעה</option>
                                <option value="title">🔤 לפי כותרת</option>
                            </select>
                        </div>

                        <!-- חיפוש -->
                        <div class="ach-search-wrap">
                            <i class="fas fa-search ach-search-icon"></i>
                            <input id="achSearchInput"
                                class="ach-search-input"
                                type="text"
                                placeholder="חיפוש השגים..."/>
                            <button id="achClearSearch"
                                    class="ach-clear-btn"
                                    style="display:none">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>

                    <div class="ach-header-actions">
                        <div class="ach-view-btns">
                            <button class="ach-view-btn active" id="achViewCards" title="כרטיסים">
                                <i class="fas fa-th-large"></i>
                            </button>
                            <button class="ach-view-btn" id="achViewTable" title="טבלה">
                                <i class="fas fa-table"></i>
                            </button>
                            <button class="ach-view-btn" id="achViewTimeline" title="ציר זמן">
                                <i class="fas fa-stream"></i>
                            </button>
                        </div>

                        ${this.isCanEdit ? `
                        <button class="ach-add-btn" id="achAddBtn">
                            <i class="fas fa-plus"></i> הוסף השג
                        </button>
                        <button class="ach-import-btn" id="achImportBtn" title="ייבוא מאקסל">
                            <i class="fas fa-file-excel"></i> ייבוא
                        </button>` : ''}

                        <button class="ach-export-btn" id="achExportBtn" title="ייצוא לאקסל">
                            <i class="fas fa-download"></i> ייצוא
                        </button>

                        <button class="ach-refresh-btn" id="achRefreshBtn" title="רענן">
                            <i class="fas fa-sync-alt"></i>
                        </button>

                        <span id="achLastRefresh" class="ach-last-refresh"></span>
                    </div>
                </div>

                <!-- ✅ סטטיסטיקות בתוך ה-header -->
                <div class="ach-stats-bar" id="achStatsBar" style="left: 10px;position: relative;"></div>
            </div>
            <!-- סטטיסטיקות -->
            <div class="ach-stats-bar" id="achStatsBar"></div>

            <!-- הודעות -->
            <div id="achError"   class="ach-error"   style="display:none"></div>
            <div id="achLoading" class="ach-loading"  style="display:none">
                <i class="fas fa-spinner fa-spin"></i> טוען נתונים...
            </div>

            <!-- Toast -->
            <div id="achToast" class="ach-toast"></div>

            <!-- input נסתר לייבוא אקסל -->
            <input type="file" id="achExcelFileInput"
                   accept=".xlsx,.xls,.csv" style="display:none">

            <!-- לוח -->
            <div class="ach-board" id="achBoard"></div>

        </div>`;

        const sortSel = document.getElementById('achSortSelect');
        if (sortSel) sortSel.value = this.sortMode;
    }

    // ==========================================
    // רינדור הלוח
    // ==========================================
    renderBoard() {
        const board = document.getElementById('achBoard');
        if (!board) return;

        board.innerHTML = '';

        const list = this.getFilteredAchievements();

        const counter = document.getElementById('achCounter');
        if (counter) {
            counter.textContent = list.length > 0
                ? `${list.length} השגים` : '';
        }

        this.renderStats(list);
        this.updateCategoryFilter();

        if (list.length === 0) {
            board.innerHTML = `
            <div class="ach-empty">
                <i class="fas fa-trophy"></i>
                <p>אין השגים להצגה</p>
                <button class="ach-add-btn-empty" id="achAddBtnEmpty">
                    <i class="fas fa-plus"></i> הוסף השג ראשון
                </button>
            </div>`;
            document.getElementById('achAddBtnEmpty')
                ?.addEventListener('click', () => this.openModal());
            return;
        }

        const activeView = document.querySelector('.ach-view-btn.active');
        const viewId = activeView?.id || 'achViewCards';

        if (viewId === 'achViewTable') {
            this.renderTableView(board, list);
        } else if (viewId === 'achViewTimeline') {
            this.renderTimelineView(board, list);
        } else {
            this.renderCardsView(board, list);
        }
    }

    // ==========================================
    // סטטיסטיקות : byCategory מאוכלס
    // ==========================================
    renderStats(list) {
        const bar = document.getElementById('achStatsBar');
        if (!bar) return;

        const total = list.length;

        // אכלוס byCategory
        const byCategory = {};
        list.forEach(a => {
            if (!a.category) return;
            byCategory[a.category] = (byCategory[a.category] || 0) + 1;
        });

        const topCat = Object.entries(byCategory)
            .sort((a, b) => b[1] - a[1])[0];

        const thisMonth = new Date();
        const thisMonthCount = list.filter(a => {
            // ✅ השתמש ב-achievementDate
            const dateToCheck = a.achievementDate || a.createdAt;
            if (!dateToCheck) return false;
            const d = new Date(dateToCheck);
            return d.getMonth() === thisMonth.getMonth() &&
                d.getFullYear() === thisMonth.getFullYear();
        }).length;

        bar.innerHTML = `
        <div class="ach-stat-item">
            <div class="ach-stat-icon"
                 style="background:#667eea22;color:#667eea">
                <i class="fas fa-trophy"></i>
            </div>
            <div class="ach-stat-info">
                <div class="ach-stat-label">סה"כ השגים</div>
                <div class="ach-stat-value">${total}</div>
            </div>
        </div>

        `;
    }

    // ==========================================
    // עזר: כוכבי השפעה
    // ==========================================
    buildStars(priority) {
        const cfg = this.IMPACT_CONFIG[priority]
            || this.IMPACT_CONFIG['medium'];
        let html = '';
        for (let i = 0; i < 1; i++) {
            const filled = i < cfg.stars;
            html += `<i class="fa${filled ? 's' : 'r'} fa-star"
                        style="color:${filled
                    ? cfg.color : '#555'};
                               font-size:0.85rem"></i>`;
        }
        return `<span title="השפעה ${cfg.label}"
                      class="ach-stars">${html}</span>`;
    }

    // ==========================================
    // תצוגת כרטיסים
    // ==========================================
    renderCardsView(board, list) {
        board.className = 'ach-board ach-board-cards';
        list.forEach(ach => board.appendChild(this.buildCard(ach)));
    }

    buildCard(ach) {
        const cfg = this.CATEGORY_COLORS[ach.category]
            || this.CATEGORY_COLORS['אחר'];
        const impCfg = this.IMPACT_CONFIG[ach.priority]
            || this.IMPACT_CONFIG['medium'];

        const card = document.createElement('div');
        card.className = 'ach-card';
        card.dataset.achId = ach.id;
        card.style.borderTop = `4px solid ${cfg.border}`;
        card.title = 'לחץ פעמיים לצפייה/עריכה';

        // קישור לחיץ אם קיים
        const linkHtml = ach.link
            ? `<a class="ach-card-link"
                  href="${this.escHtml(ach.link)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="${this.escHtml(ach.link)}"
                  onclick="event.stopPropagation()">
                   <i class="fas fa-external-link-alt"></i>
                   קישור רלוונטי
               </a>`
            : '';

        card.innerHTML = `
        <div class="ach-card-header">
            <div class="ach-card-cat-badge"
                 style="background:${cfg.bg};
                        color:${cfg.text};
                        border:1px solid ${cfg.border}">
                <i class="fas ${cfg.icon}"></i>
                ${this.escHtml(ach.category || 'אחר')}
            </div>
            <!-- ✅ כוכבים במקום עיגול -->
            ${this.buildStars(ach.priority)}
        </div>

        <div class="ach-card-title">
            ${this.escHtml(ach.title)}
        </div>

        <div class="ach-card-desc">
            ${this.escHtml(ach.description || '')}
        </div>

        ${ach.attachmentName ? `
        <div class="ach-card-attachment"
            data-path="${this.escHtml(ach.attachmentName)}">
            <i class="fas fa-paperclip"></i>
            <span>${this.escHtml(ach.attachmentName)}</span>
        </div>` : ''}

        ${linkHtml}

        <div class="ach-card-footer">
            <div class="ach-card-date">
                <i class="fas fa-calendar-alt"></i>
                ${this.formatDate(ach.achievementDate || ach.createdAt)}
            </div>
        </div>

        <div class="ach-card-actions">
            ${this.isCanEdit ? `
            <button class="ach-action-btn ach-edit-btn"
                    data-ach-id="${ach.id}" title="ערוך">
                <i class="fas fa-edit"></i>
            </button>
            <button class="ach-action-btn ach-delete-btn"
                    data-ach-id="${ach.id}" title="מחק">
                <i class="fas fa-trash"></i>
            </button>` : ''}
        </div>`;

        return card;
    }

    // ==========================================
    // תצוגת טבלה
    // ==========================================
    renderTableView(board, list) {
        board.className = 'ach-board ach-board-table';

        const wrapper = document.createElement('div');
        wrapper.className = 'ach-table-wrapper';

        wrapper.innerHTML = `
        <table class="ach-table">
            <thead>
                <tr>
                    <th>כותרת</th>
                    <th>קטגוריה</th>
                    <th>השפעה</th>
                    <th>תאריך</th>
                    <th>קישור</th>
                    ${this.isCanEdit ? '<th>פעולות</th>' : ''}
                </tr>
            </thead>
            <tbody id="achTableBody"></tbody>
        </table>`;

        board.appendChild(wrapper);

        const tbody = wrapper.querySelector('#achTableBody');
        list.forEach(ach => {
            const cfg = this.CATEGORY_COLORS[ach.category]
                || this.CATEGORY_COLORS['אחר'];

            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.title = 'לחץ פעמיים לצפייה/עריכה';
            tr.dataset.achId = ach.id;

            tr.innerHTML = `
            <td class="ach-table-title">
                ${this.escHtml(ach.title)}
                ${ach.description ? `
                <div class="ach-table-desc">
                    ${this.escHtml(ach.description.substring(0, 80))}
                    ${ach.description.length > 80 ? '...' : ''}
                </div>` : ''}
            </td>
            <td>
                <span class="ach-table-cat"
                      style="background:${cfg.bg};
                             color:${cfg.text};
                             border:1px solid ${cfg.border}">
                    <i class="fas ${cfg.icon}"></i>
                    ${this.escHtml(ach.category || 'אחר')}
                </span>
            </td>
            <td>${this.buildStars(ach.priority)}</td>
            <td class="ach-table-date">
                ${this.formatDate(ach.achievementDate || ach.createdAt)}
            </td>
            <td>
                ${ach.link
                    ? `<a href="${this.escHtml(ach.link)}"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="ach-table-link"
                          onclick="event.stopPropagation()">
                           <i class="fas fa-external-link-alt"></i>
                       </a>`
                    : '—'}
            </td>
            ${this.isCanEdit ? `
            <td class="ach-table-actions">
                <button class="ach-action-btn ach-edit-btn"
                        data-ach-id="${ach.id}" title="ערוך">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="ach-action-btn ach-delete-btn"
                        data-ach-id="${ach.id}" title="מחק">
                    <i class="fas fa-trash"></i>
                </button>
            </td>` : ''}`;

            tbody.appendChild(tr);
        });
    }

    bindDatePicker() {
        const textInput = document.getElementById('achModalDate');
        const hiddenDate = document.getElementById('achDateHidden');
        const pickerBtn = document.getElementById('achDatePickerBtn');

        if (!textInput) return;

        // ── עיצוב אוטומטי בהקלדה ──
        textInput.addEventListener('input', e => {
            let val = e.target.value.replace(/\D/g, ''); // רק ספרות

            if (val.length > 8) val = val.slice(0, 8);

            // הוסף '/' אוטומטית
            if (val.length >= 5) {
                val = `${val.slice(0, 2)}/${val.slice(2, 4)}/${val.slice(4)}`;
            } else if (val.length >= 3) {
                val = `${val.slice(0, 2)}/${val.slice(2)}`;
            }

            e.target.value = val;
        });

        // ── אימות ביציאה מהשדה ──
        textInput.addEventListener('blur', e => {
            const val = e.target.value.trim();
            if (!val) return;

            const parts = val.split('/');
            if (parts.length !== 3) {
                this.showToast('פורמט תאריך שגוי - השתמש ב-dd/mm/yyyy', 'error');
                textInput.focus();
                return;
            }

            const [dd, mm, yyyy] = parts.map(Number);
            const date = new Date(yyyy, mm - 1, dd);

            const isValid =
                date.getFullYear() === yyyy &&
                date.getMonth() === mm - 1 &&
                date.getDate() === dd &&
                yyyy >= 2000 &&
                yyyy <= 2100;

            if (!isValid) {
                this.showToast('תאריך לא תקין', 'error');
                textInput.focus();
            }
        });

        if (!hiddenDate || !pickerBtn) return;

        // ── סנכרון: בורר → שדה טקסט ──
        hiddenDate.addEventListener('change', e => {
            const val = e.target.value; // YYYY-MM-DD
            if (!val) return;
            const [yyyy, mm, dd] = val.split('-');
            textInput.value = `${dd}/${mm}/${yyyy}`;
            textInput.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // ── פתיחת בורר בלחיצה על כפתור ──
        pickerBtn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();

            // סנכרן ערך קיים לשדה הנסתר לפני פתיחה
            const cur = textInput.value.trim();
            if (cur) {
                const parts = cur.split('/');
                if (parts.length === 3) {
                    const [dd, mm, yyyy] = parts;
                    hiddenDate.value = `${yyyy}-${mm}-${dd}`;
                }
            }

            hiddenDate.showPicker?.();

            // fallback לדפדפנים ישנים
            if (!hiddenDate.showPicker) hiddenDate.click();
        });
    }

    // ==========================================
    // תצוגת ציר זמן
    // ==========================================
    renderTimelineView(board, list) {
        board.className = 'ach-board ach-board-timeline';

        const timeline = document.createElement('div');
        timeline.className = 'ach-timeline';

        const byMonth = {};
        list.forEach(ach => {
            const d = (ach.achievementDate || ach.createdAt)
                ? new Date(ach.achievementDate || ach.createdAt)
                : new Date();
            const key = `${d.getFullYear()}-${String(
                d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('he-IL', {
                year: 'numeric', month: 'long'
            });
            if (!byMonth[key]) byMonth[key] = { label, items: [] };
            byMonth[key].items.push(ach);
        });

        Object.entries(byMonth)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .forEach(([key, group]) => {
                const section = document.createElement('div');
                section.className = 'ach-timeline-section';

                section.innerHTML = `
                <div class="ach-timeline-month">
                    <i class="fas fa-calendar"></i>
                    ${group.label}
                    <span class="ach-timeline-count">
                        ${group.items.length}
                    </span>
                </div>
                <div class="ach-timeline-items" id="tl_${key}"></div>`;

                timeline.appendChild(section);

                const itemsEl = section.querySelector(`#tl_${key}`);
                group.items.forEach(ach => {
                    const cfg = this.CATEGORY_COLORS[ach.category]
                        || this.CATEGORY_COLORS['אחר'];

                    const item = document.createElement('div');
                    item.className = 'ach-timeline-item';
                    item.dataset.achId = ach.id;
                    item.style.cursor = 'pointer';
                    item.title = 'לחץ פעמיים לצפייה/עריכה';

                    item.innerHTML = `
                    <div class="ach-timeline-dot"
                         style="background:${cfg.border}">
                        <i class="fas ${cfg.icon}"></i>
                    </div>
                    <div class="ach-timeline-content">
                        <div class="ach-timeline-header">
                            <span class="ach-timeline-title">
                                ${this.escHtml(ach.title)}
                            </span>
                            <span class="ach-timeline-cat"
                                  style="background:${cfg.bg};
                                         color:${cfg.text};
                                         border:1px solid ${cfg.border}">
                                ${this.escHtml(ach.category || 'אחר')}
                            </span>
                            ${this.buildStars(ach.priority)}
                        </div>
                        ${ach.description ? `
                        <div class="ach-timeline-desc">
                            ${this.escHtml(ach.description)}
                        </div>` : ''}
                        ${ach.link ? `
                        <a class="ach-timeline-link"
                           href="${this.escHtml(ach.link)}"
                           target="_blank"
                           rel="noopener noreferrer"
                           onclick="event.stopPropagation()">
                            <i class="fas fa-external-link-alt"></i>
                            קישור רלוונטי
                        </a>` : ''}
                        <div class="ach-timeline-meta">
                            <span>
                                <i class="fas fa-calendar-alt"></i>
                                ${this.formatDate(ach.achievementDate || ach.createdAt)}
                            </span>
                        </div>
                        ${this.isCanEdit ? `
                        <div class="ach-timeline-actions">
                            <button class="ach-action-btn ach-edit-btn"
                                    data-ach-id="${ach.id}"
                                    title="ערוך">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="ach-action-btn ach-delete-btn"
                                    data-ach-id="${ach.id}"
                                    title="מחק">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>` : ''}
                    </div>`;

                    itemsEl.appendChild(item);
                });
            });

        board.appendChild(timeline);
    }

    // ==========================================
    // עדכון פילטר קטגוריות
    // ==========================================
    updateCategoryFilter() {
        const select = document.getElementById('achCategoryFilter');
        if (!select) return;

        const current = this.filterCategory;
        select.innerHTML = `<option value="ALL">📂 כל הקטגוריות</option>`;

        const cats = new Set(
            this.achievements.map(a => a.category).filter(Boolean)
        );

        Object.keys(this.CATEGORY_COLORS).forEach(cat => {
            if (cats.has(cat)) {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.textContent = cat;
                select.appendChild(opt);
            }
        });

        [...cats].filter(c => !this.CATEGORY_COLORS[c]).forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });

        select.value = current;
    }

    // ==========================================
    // מודל הוספה/עריכה/צפייה
    // ==========================================
    openModal(achId = null, viewOnly = false) {
        const existing = document.getElementById('achModal');
        if (existing) existing.remove();

        const isEdit = achId !== null;
        const ach = isEdit
            ? this.achievements.find(a => String(a.id) === String(achId))
            : null;

        if (isEdit && !ach) {
            this.showToast('השג לא נמצא', 'error');
            return;
        }

        // אם viewOnly=true ואין הרשאה - מצב צפייה בלבד
        const readOnly = viewOnly || (isEdit && !this.isCanEdit);

        const catOptions = Object.keys(this.CATEGORY_COLORS).map(cat =>
            `<option value="${cat}"
                ${ach?.category === cat ? 'selected' : ''}>
                ${cat}
            </option>`
        ).join('');

        const modal = document.createElement('div');
        modal.id = 'achModal';
        modal.className = 'ach-modal-overlay';

        modal.innerHTML = `
        <div class="ach-modal">
            <div class="ach-modal-header">
                <h3 class="ach-modal-title">
                    <i class="fas fa-${readOnly ? 'eye' : isEdit ? 'edit' : 'trophy'}"></i>
                    ${readOnly ? 'צפייה בהשג' : isEdit ? 'עריכת השג' : 'הוספת השג חדש'}
                </h3>
                <button class="ach-modal-close" id="achModalClose">
                    &times;
                </button>
            </div>

            <div class="ach-modal-body">
                <input type="hidden" id="achModalId"
                       value="${isEdit ? this.escHtml(String(ach.id)) : ''}">

                <!-- כותרת -->
                <div class="ach-form-group">
                    <label class="ach-form-label">
                        <i class="fas fa-heading"></i> כותרת ההשג
                    </label>
                    <input type="text"
                           id="achModalTitle"
                           class="ach-form-input"
                           placeholder="תאר את ההשג בקצרה..."
                           value="${isEdit ? this.escHtml(ach.title) : ''}"
                           ${readOnly ? 'readonly' : ''}
                           required>
                </div>

                <!-- תיאור -->
                <div class="ach-form-group">
                    <label class="ach-form-label">
                        <i class="fas fa-align-left"></i> תיאור מפורט
                    </label>
                    <textarea id="achModalDesc"
                              class="ach-form-textarea"
                              placeholder="פרט את ההשג..."
                              rows="4"
                              ${readOnly ? 'readonly' : ''}>${isEdit
                ? this.escHtml(ach.description || '')
                : ''}</textarea>
                </div>

                <!-- שורה: קטגוריה + השפעה -->
                <div class="ach-form-row">
                    <div class="ach-form-group">
                        <label class="ach-form-label">
                            <i class="fas fa-tag"></i> קטגוריה
                        </label>
                        <select id="achModalCategory"
                                class="ach-form-select"
                                ${readOnly ? 'disabled' : ''}>
                            ${catOptions}
                        </select>
                    </div>

                    <div class="ach-form-group">
                        <label class="ach-form-label">
                            <i class="fas fa-star"></i> השפעה
                        </label>
                        <select id="achModalPriority"
                                class="ach-form-select"
                                ${readOnly ? 'disabled' : ''}>
                            <option value="high"
                                ${ach?.priority === 'high' ? 'selected' : ''}>
                                ⭐⭐⭐ גבוהה
                            </option>
                            <option value="medium"
                                ${(!ach || ach.priority === 'medium') ? 'selected' : ''}>
                                ⭐⭐ בינונית
                            </option>
                            <option value="low"
                                ${ach?.priority === 'low' ? 'selected' : ''}>
                                ⭐ נמוכה
                            </option>
                        </select>
                    </div>
                </div>

                <!-- תאריך -->
                <div class="ach-form-group">
                    <label class="ach-form-label">
                        <i class="fas fa-calendar-alt"></i> תאריך ביצוע
                    </label>
                    <div class="ach-date-wrap">
                        <input type="text"
                            id="achModalDate"
                            class="ach-form-input ach-date-input"
                            placeholder="dd/mm/yyyy"
                            value="${(() => {
                const raw = ach?.achievementDate || ach?.createdAt || '';
                if (!raw) return new Date().toLocaleDateString('he-IL', {
                    day: '2-digit', month: '2-digit', year: 'numeric'
                }).replace(/\./g, '/');
                const p = raw.split('T')[0].split('-');
                return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : raw;
            })()}"
                            ${readOnly ? 'readonly' : ''}
                            autocomplete="off"
                            maxlength="10">
                        ${!readOnly ? `
                        <button type="button"
                                class="ach-date-picker-btn"
                                id="achDatePickerBtn"
                                tabindex="-1"
                                title="בחר תאריך">
                            <i class="fas fa-calendar-alt"></i>
                        </button>
                        <input type="date"
                            id="achDateHidden"
                            style="position:absolute;opacity:0;pointer-events:none;
                                    width:0;height:0;top:0;left:0">
                        ` : ''}
                    </div>
                </div>

                <!-- קישור -->
                <div class="ach-form-group">
                    <label class="ach-form-label">
                        <i class="fas fa-link"></i>
                        קישור רלוונטי (אופציונלי)
                    </label>
                    <input type="text"
                           id="achModalLink"
                           class="ach-form-input"
                           placeholder="https://..."
                           value="${isEdit ? this.escHtml(ach.link || '') : ''}"
                           ${readOnly ? 'readonly' : ''}>
                </div>

                <!-- קובץ מצורף -->
                <div class="ach-form-group">
                    <label class="ach-form-label">
                        <i class="fas fa-paperclip"></i>
                        שם קובץ/נוהל מצורף (אופציונלי)
                    </label>
                    <input type="text"
                           id="achModalAttachment"
                           class="ach-form-input"
                           placeholder="לדוגמה: נוהל_אתחול_BPM.pdf"
                           value="${isEdit
                ? this.escHtml(ach.attachmentName || '')
                : ''}"
                           ${readOnly ? 'readonly' : ''}>
                </div>
            </div>

            <div class="ach-modal-footer">
                <button class="ach-modal-cancel-btn" id="achModalCancel">
                    <i class="fas fa-times"></i> סגור
                </button>
                ${!readOnly ? `
                <button class="ach-modal-save-btn" id="achModalSave">
                    <i class="fas fa-save"></i>
                    ${isEdit ? 'עדכן השג' : 'הוסף השג'}
                </button>` : ''}
            </div>
        </div>`;

        document.body.appendChild(modal);

        document.getElementById('achModalClose')
            .addEventListener('click', () => this.closeModal());
        document.getElementById('achModalCancel')
            .addEventListener('click', () => this.closeModal());

        if (!readOnly) {
            document.getElementById('achModalSave')
                .addEventListener('click', () =>
                    this.saveFromModal(isEdit, ach));
            this.bindDatePicker();
        }

        // סגירה בלחיצה על ה-overlay
        modal.addEventListener('click', e => {
            if (e.target === modal) this.closeModal();
        });

        setTimeout(() => {
            document.getElementById('achModalTitle')?.focus();
        }, 100);
    }

    closeModal() {
        const modal = document.getElementById('achModal');
        if (modal) modal.remove();
    }

    // ==========================================
    // שמירת השג
    // ==========================================
    async saveFromModal(isEdit, originalAch) {
        const title = document.getElementById('achModalTitle').value.trim();
        const description = document.getElementById('achModalDesc').value.trim();
        const category = document.getElementById('achModalCategory').value;
        const priority = document.getElementById('achModalPriority').value;
        const link = document.getElementById('achModalLink').value.trim();
        const attachmentName = document.getElementById('achModalAttachment').value.trim();

        // ✅ המרה מ-dd/mm/yyyy ל-yyyy-MM-dd לשליחה לשרת
        const dateDisplayVal = document.getElementById('achModalDate').value.trim();
        const achievementDate = this.displayDateToISO(dateDisplayVal);

        if (!title) {
            this.showToast('יש להזין כותרת', 'error');
            return;
        }

        const saveBtn = document.getElementById('achModalSave');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const payload = {
                title,
                description,
                category,
                priority,
                achievementDate,  // ✅ תאריך ביצוע - שדה נפרד
                link,
                attachmentName
            };

            let url, method;
            if (isEdit) {
                payload.id = originalAch.id;
                url = '/Achievements/Update';
                method = 'POST';
            } else {
                url = '/Achievements/Add';
                method = 'POST';
            }

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'שגיאה בשמירה');
            }

            this.showToast(
                isEdit ? '✅ ההשג עודכן בהצלחה!' : '🏆 ההשג נוסף בהצלחה!',
                'success'
            );
            this.closeModal();
            await this.loadData();

        } catch (err) {
            console.error('saveFromModal error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<i class="fas fa-save"></i> ${isEdit ? 'עדכן' : 'הוסף'}`;
            }
        }
    }

    // ── פונקציית עזר: dd/mm/yyyy → yyyy-MM-dd ──
    displayDateToISO(displayDate) {
        if (!displayDate) return new Date().toISOString().split('T')[0];
        const parts = displayDate.split('/');
        if (parts.length !== 3) return displayDate;
        const [dd, mm, yyyy] = parts;
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    // ==========================================
    // מחיקת השג
    // ==========================================
    async deleteAchievement(achId) {
        if (!confirm('האם אתה בטוח שברצונך למחוק השג זה?')) return;

        try {
            const res = await fetch('/Achievements/Delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id: achId })
            });
            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'שגיאה במחיקה');
            }

            // השוואה כ-string לשני הצדדים
            this.achievements = this.achievements.filter(
                a => String(a.id) !== String(achId)
            );
            this.renderBoard();
            this.showToast('🗑️ ההשג נמחק', 'info');

        } catch (err) {
            console.error('deleteAchievement error:', err);
            this.showToast('שגיאה: ' + err.message, 'error');
        }
    }

    // ==========================================
    // ייבוא מאקסל  ✅ חדש
    // ==========================================
    async importFromExcel(file) {
        try {
            if (typeof XLSX === 'undefined') {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת XLSX'));
                    document.head.appendChild(s);
                });
            }

            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (!rows.length) {
                this.showToast('הקובץ ריק', 'error');
                return;
            }

            // מיפוי עמודות גמיש (עברית / אנגלית)
            const MAP = {
                title: ['כותרת', 'title', 'Title'],
                description: ['תיאור', 'description', 'Description'],
                category: ['קטגוריה', 'category', 'Category'],
                priority: ['השפעה', 'עדיפות', 'priority', 'Priority'],
                createdAt: ['תאריך', 'date', 'Date', 'createdAt'],
                link: ['קישור', 'link', 'Link'],
                attachmentName: ['קובץ', 'attachment', 'Attachment'],
            };

            const getVal = (row, keys) => {
                for (const k of keys) {
                    if (row[k] !== undefined && row[k] !== '')
                        return String(row[k]).trim();
                }
                return '';
            };

            // מיפוי ערכי השפעה
            const IMPACT_MAP = {
                'גבוהה': 'high', 'high': 'high', '3': 'high',
                'בינונית': 'medium', 'medium': 'medium', '2': 'medium',
                'נמוכה': 'low', 'low': 'low', '1': 'low',
            };

            let imported = 0;
            let errors = 0;

            for (const row of rows) {
                const title = getVal(row, MAP.title);
                if (!title) { errors++; continue; }

                const rawImpact = getVal(row, MAP.priority).toLowerCase();
                const priority = IMPACT_MAP[rawImpact] || 'medium';

                const payload = {
                    title,
                    description: getVal(row, MAP.description),
                    category: getVal(row, MAP.category) || 'אחר',
                    priority,
                    createdAt: getVal(row, MAP.createdAt)
                        || new Date().toISOString().split('T')[0],
                    link: getVal(row, MAP.link),
                    attachmentName: getVal(row, MAP.attachmentName),
                };

                try {
                    const res = await fetch('/Achievements/Add', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    const resp = await res.json();
                    if (resp.success) imported++;
                    else errors++;
                } catch { errors++; }
            }

            this.showToast(
                `✅ יובאו ${imported} השגים` +
                (errors ? ` | ❌ ${errors} שגיאות` : ''),
                imported > 0 ? 'success' : 'error'
            );

            if (imported > 0) await this.loadData();

        } catch (err) {
            console.error('importFromExcel error:', err);
            this.showToast('שגיאה בייבוא: ' + err.message, 'error');
        }
    }

    // ==========================================
    // ייצוא לאקסל
    // ==========================================
    async exportToExcel() {
        try {
            const exportBtn = document.getElementById('achExportBtn');
            if (exportBtn) {
                exportBtn.disabled = true;
                exportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
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

            const list = this.getFilteredAchievements();
            if (!list.length) {
                this.showToast('אין השגים לייצוא', 'error');
                return;
            }

            const wb = new ExcelJS.Workbook();
            wb.creator = 'AchievementsDashboard';
            wb.created = new Date();

            const ws = wb.addWorksheet('השגים', {
                views: [{ state: 'frozen', ySplit: 1, rightToLeft: true }]
            });

            ws.columns = [
                { key: 'title', header: 'כותרת', width: 35 },
                { key: 'desc', header: 'תיאור', width: 50 },
                { key: 'category', header: 'קטגוריה', width: 15 },
                { key: 'impact', header: 'השפעה', width: 12 },
                { key: 'date', header: 'תאריך', width: 14 },
                { key: 'link', header: 'קישור', width: 30 },
                { key: 'attach', header: 'קובץ מצורף', width: 25 },
            ];

            const hRow = ws.getRow(1);
            hRow.height = 24;
            hRow.eachCell(cell => {
                cell.font = {
                    name: 'Arial', size: 11, bold: true,
                    color: { argb: 'FFFFFFFF' }
                };
                cell.fill = {
                    type: 'pattern', pattern: 'solid',
                    fgColor: { argb: 'FF667eea' }
                };
                cell.alignment = {
                    horizontal: 'center', vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: {
                        style: 'medium',
                        color: { argb: 'FF5a67d8' }
                    }
                };
            });

            list.forEach((ach, idx) => {
                const impLabel = this.IMPACT_CONFIG[ach.priority]?.label || '';
                const rowBg = idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8F9FF';

                const row = ws.addRow({
                    title: ach.title || '',
                    desc: ach.description || '',
                    category: ach.category || '',
                    impact: impLabel,
                    date: this.formatDate(ach.achievementDate || ach.createdAt),
                    link: ach.link || '',
                    attach: ach.attachmentName || '',
                });

                row.height = 18;
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
                        bottom: {
                            style: 'thin',
                            color: { argb: 'FFe2e8f0' }
                        }
                    };
                });
            });

            const dateStr = new Date().toISOString().split('T')[0];
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
            saveAs(blob, `השגים_${dateStr}.xlsx`);

            this.showToast(`📊 ${list.length} השגים יוצאו בהצלחה`, 'success');

        } catch (err) {
            console.error('exportToExcel error:', err);
            this.showToast('שגיאה בייצוא: ' + err.message, 'error');
        } finally {
            const exportBtn = document.getElementById('achExportBtn');
            if (exportBtn) {
                exportBtn.disabled = false;
                exportBtn.innerHTML = '<i class="fas fa-download"></i>';
            }
        }
    }

    // ==========================================
    // אירועים
    // ==========================================
    bindEvents() {
        // חיפוש
        document.addEventListener('input', e => {
            if (e.target.id === 'achSearchInput') {
                this.searchTerm = e.target.value;
                const clearBtn = document.getElementById('achClearSearch');
                if (clearBtn)
                    clearBtn.style.display = e.target.value ? 'flex' : 'none';
                this.renderBoard();
            }
        });

        document.addEventListener('change', e => {
            if (e.target.id === 'achCategoryFilter') {
                this.filterCategory = e.target.value;
                this.renderBoard();
            }
            if (e.target.id === 'achSortSelect') {
                this.sortMode = e.target.value;
                localStorage.setItem('achSortMode', this.sortMode);
                this.renderBoard();
            }
            // ייבוא אקסל - בחירת קובץ
            if (e.target.id === 'achExcelFileInput') {
                const file = e.target.files[0];
                if (file) {
                    this.importFromExcel(file);
                    e.target.value = ''; // איפוס לבחירה חוזרת
                }
            }
        });

        document.addEventListener('click', e => {
            // העתקת נתיב קובץ ללוח
            const attachment = e.target.closest('.ach-card-attachment');

            if (attachment) {
                e.stopPropagation();

                const path = attachment.dataset.path;

                navigator.clipboard.writeText(path)
                    .then(() => {
                        this.showToast('📋 הנתיב הועתק ללוח', 'success');
                    })
                    .catch(() => {
                        this.showToast('שגיאה בהעתקה', 'error');
                    });

                return;
            }
            // ניקוי חיפוש
            if (e.target.closest('#achClearSearch')) {
                this.searchTerm = '';
                const inp = document.getElementById('achSearchInput');
                if (inp) inp.value = '';
                const clearBtn = document.getElementById('achClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';
                this.renderBoard();
            }

            // הוסף השג
            if (e.target.closest('#achAddBtn')) {
                this.openModal();
            }

            // ייבוא אקסל - פתיחת בורר קבצים
            if (e.target.closest('#achImportBtn')) {
                document.getElementById('achExcelFileInput')?.click();
            }

            // עריכה - רק אדמינים
            const editBtn = e.target.closest('.ach-edit-btn');
            if (editBtn && this.isCanEdit) {
                e.stopPropagation();
                this.openModal(editBtn.dataset.achId, false);
            }

            // מחיקה - רק אדמינים
            const deleteBtn = e.target.closest('.ach-delete-btn');
            if (deleteBtn && this.isCanEdit) {
                e.stopPropagation();
                this.deleteAchievement(deleteBtn.dataset.achId);
            }

            // ייצוא
            if (e.target.closest('#achExportBtn')) {
                this.exportToExcel();
            }

            // רענון
            if (e.target.closest('#achRefreshBtn')) {
                this.loadData();
            }

            // כפתורי תצוגה
            const viewBtn = e.target.closest('.ach-view-btn');
            if (viewBtn) {
                document.querySelectorAll('.ach-view-btn')
                    .forEach(b => b.classList.remove('active'));
                viewBtn.classList.add('active');
                this.renderBoard();
            }
        });

        // דאבל קליק לצפייה/עריכה
        document.addEventListener('dblclick', e => {
            // כרטיס
            const card = e.target.closest('.ach-card');
            if (card && card.dataset.achId) {
                e.preventDefault();
                this.openModal(card.dataset.achId, !this.isCanEdit);
                return;
            }
            // שורת טבלה
            const tr = e.target.closest('tr[data-ach-id]');
            if (tr && tr.dataset.achId) {
                e.preventDefault();
                this.openModal(tr.dataset.achId, !this.isCanEdit);
                return;
            }
            // פריט ציר זמן
            const tlItem = e.target.closest('.ach-timeline-item');
            if (tlItem && tlItem.dataset.achId) {
                e.preventDefault();
                this.openModal(tlItem.dataset.achId, !this.isCanEdit);
            }
        });
    }

    // ==========================================
    // עזרים
    // ==========================================
    formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            // חיתוך רק את חלק התאריך לפני T
            const datePart = dateStr.split('T')[0];
            const parts = datePart.split('-');
            if (parts.length === 3) {
                // parts[0]=שנה, parts[1]=חודש, parts[2]=יום
                return `${parts[2]}/${parts[1]}/${parts[0]}`;
            }
            // fallback ל-Date object
            const d = new Date(dateStr + 'T12:00:00');
            return `${d.getDate().toString().padStart(2, '0')}/` +
                `${(d.getMonth() + 1).toString().padStart(2, '0')}/` +
                `${d.getFullYear()}`;
        } catch { return dateStr; }
    }

    // פונקציה חדשה - מחזירה YYYY-MM-DD לפי timezone מקומי
    toLocalDateString(dateStr) {
        if (!dateStr) return '';
        try {
            const datePart = dateStr.split('T')[0];
            const parts = datePart.split('-');
            if (parts.length === 3) return datePart; // כבר בפורמט YYYY-MM-DD
            const d = new Date(dateStr);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch { return ''; }
    }

    escHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    showLoading(show) {
        const el = document.getElementById('achLoading');
        if (el) el.style.display = show ? 'flex' : 'none';
    }

    showError(msg) {
        const el = document.getElementById('achError');
        if (el) {
            el.textContent = msg;
            el.style.display = 'block';
            setTimeout(() => { el.style.display = 'none'; }, 5000);
        }
    }

    showToast(msg, type = 'info') {
        const toast = document.getElementById('achToast');
        if (!toast) return;
        toast.textContent = msg;
        toast.className = `ach-toast ach-toast-${type} ach-toast-show`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            toast.classList.remove('ach-toast-show');
        }, 3000);
    }

    updateLastRefresh() {
        const el = document.getElementById('achLastRefresh');
        if (!el) return;
        const now = new Date();
        el.textContent =
            `עודכן: ${now.getHours().toString().padStart(2, '0')}:` +
            `${now.getMinutes().toString().padStart(2, '0')}:` +
            `${now.getSeconds().toString().padStart(2, '0')}`;
    }

    // ==========================================
    // סגנונות - תוספות לכוכבים, קישורים, ייבוא
    // ==========================================
    addStyles() {
        if (document.getElementById('achStyles')) return;

        const style = document.createElement('style');
        style.id = 'achStyles';
        style.textContent = `
        /* ===== כל הסגנונות הקיימים + תוספות ===== */

        .ach-root {
            background: #1a1a2e; color: #e0e0e0;
            font-family: 'Segoe UI', Arial, sans-serif;
            min-height: 100vh; display: flex;
            flex-direction: column; direction: rtl;
        }
        .ach-header {
            display: flex; align-items: center;
            justify-content: space-between;
            background: #16162a;
            border-bottom: 1px solid #2a2a4e;
            flex-wrap: wrap; gap: 10px;
            flex-shrink: 0; direction: ltr;
        }
        .ach-header-left {
            display: flex; align-items: center;
            gap: 10px; flex-wrap: wrap;
        }
        .ach-header-right {
            display: flex; align-items: center; gap: 8px;
        }
        .ach-filter-wrap {
            position: relative; display: flex; align-items: center;
        }
        .ach-filter-icon {
            position: absolute; right: 9px; color: #888;
            font-size: 0.78rem; pointer-events: none; z-index: 1;
        }
        .ach-select {
            background: #252535; border: 1px solid #3a3a5a;
            border-radius: 6px; color: #e0e0e0;
            padding: 6px 28px 6px 10px; font-size: 0.85rem;
            outline: none; cursor: pointer; min-width: 150px;
            direction: rtl; appearance: none;
            -webkit-appearance: none; transition: border-color 0.2s;
        }
        .ach-select:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102,126,234,0.15);
        }
        .ach-select option { background: #252535; }
        .ach-search-wrap {
            position: relative; display: flex; align-items: center; direction: rtl;
        }
        .ach-search-icon {
            position: absolute; right: 9px; color: #666;
            font-size: 0.8rem; pointer-events: none;
        }
        .ach-search-input {
            background: #252535; border: 1px solid #3a3a5a;
            border-radius: 6px; color: #e0e0e0;
            padding: 6px 30px 6px 28px; font-size: 0.85rem;
            width: 200px; outline: none; transition: border-color 0.2s;
        }
        .ach-search-input:focus { border-color: #667eea; }
        .ach-search-input::placeholder { color: #555; }
        .ach-clear-btn {
            position: absolute; left: 7px; background: none;
            border: none; color: #777; cursor: pointer;
            display: flex; align-items: center;
            padding: 0; font-size: 0.8rem;
        }
        .ach-clear-btn:hover { color: #ccc; }

        /* ===== כפתורים ===== */
        .ach-add-btn {
            padding: 6px 14px;
            background: rgba(102,126,234,0.2);
            border: 1px solid rgba(102,126,234,0.4);
            border-radius: 6px; color: #a78bfa;
            font-size: 0.85rem; font-weight: 600;
            cursor: pointer; display: flex;
            align-items: center; gap: 6px; transition: all 0.2s;
        }
        .ach-add-btn:hover {
            background: rgba(102,126,234,0.35);
            border-color: rgba(102,126,234,0.6); color: #c4b5fd;
        }

        /*  כפתור ייבוא אקסל */
        .ach-import-btn {
            padding: 6px 10px; background: rgba(29,111,66,0.15);
            border: 1px solid rgba(29,111,66,0.4);
            border-radius: 6px; color: #4ade80;
            cursor: pointer; font-size: 0.85rem;
            display: flex; align-items: center;
            justify-content: center; transition: all 0.2s;
        }
        .ach-import-btn:hover {
            background: rgba(29,111,66,0.3);
            border-color: rgba(29,111,66,0.6);
        }

        .ach-export-btn, .ach-refresh-btn {
            padding: 6px 10px; background: #252535;
            border: 1px solid #3a3a5a; border-radius: 6px;
            color: #999; cursor: pointer; font-size: 0.85rem;
            display: flex; align-items: center;
            justify-content: center; gap: 6px; 
            transition: all 0.2s;
        }
        .ach-export-btn {
            color: #4ade80;
            border-color: rgba(74,222,128,0.3);
            background: rgba(74,222,128,0.08);
        }
        .ach-export-btn:hover {
            background: rgba(74,222,128,0.18);
            border-color: rgba(74,222,128,0.5);
        }
        .ach-export-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ach-refresh-btn:hover { background: #303050; color: #ccc; }

        /* ===== כפתורי תצוגה ===== */
        .ach-view-btns {
            display: flex; gap: 4px; background: #252535;
            border: 1px solid #3a3a5a; border-radius: 6px; padding: 3px;
        }
        .ach-view-btn {
            padding: 5px 9px; background: transparent; border: none;
            border-radius: 4px; color: #666; cursor: pointer;
            font-size: 0.82rem; transition: all 0.2s;
        }
        .ach-view-btn:hover { color: #aaa; background: #303050; }
        .ach-view-btn.active { background: #667eea; color: white; }

        /* ===== מונה ===== */
        .ach-counter {
            font-size: 0.78rem; color: #888; background: #252535;
            border: 1px solid #3a3a5a; border-radius: 10px;
            padding: 3px 10px;
        }
        .ach-last-refresh { font-size: 0.75rem; color: #555; }

        .ach-stat-item {
            display: flex; align-items: center; gap: 10px;
            padding: 8px 14px; background: #252535;
            border: 1px solid #3a3a5a; border-radius: 10px;
            min-width: 130px;
        }
        .ach-stat-icon {
            width: 36px; height: 36px; border-radius: 8px;
            display: flex; align-items: center;
            justify-content: center; font-size: 1rem; flex-shrink: 0;
        }
        .ach-stat-info { display: flex; flex-direction: row; gap: 2px; }
        .ach-stat-label { font-size: 0.72rem; color: #888; }
        .ach-stat-categories {
            display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
        }
        .ach-stat-cat-badge {
            display: inline-flex; align-items: center; gap: 5px;
            padding: 4px 10px; border-radius: 12px;
            font-size: 0.75rem; font-weight: 600;
        }

        /* ===== הודעות ===== */
        .ach-error {
            margin: 8px 16px; padding: 8px 14px;
            background: rgba(239,68,68,0.15);
            border: 1px solid rgba(239,68,68,0.4);
            border-radius: 6px; color: #f87171; font-size: 0.85rem;
        }
        .ach-loading {
            display: flex; align-items: center;
            justify-content: center; gap: 8px;
            padding: 20px; color: #666; font-size: 0.9rem;
        }

        /* ===== Toast ===== */
        .ach-toast {
            position: fixed; bottom: 30px; left: 50%;
            transform: translateX(-50%) translateY(20px);
            padding: 10px 24px; border-radius: 8px;
            font-size: 0.88rem; font-weight: 600;
            opacity: 0; pointer-events: none;
            transition: all 0.3s ease; z-index: 999999;
            direction: rtl; white-space: nowrap;
        }
        .ach-toast-show {
            opacity: 1; transform: translateX(-50%) translateY(0);
        }
        .ach-toast-success {
            background: #166534; border: 1px solid #22c55e; color: #4ade80;
        }
        .ach-toast-error {
            background: #7f1d1d; border: 1px solid #ef4444; color: #fca5a5;
        }
        .ach-toast-info {
            background: #1e3a5f; border: 1px solid #3b82f6; color: #93c5fd;
        }

        /* ===== לוח ===== */
        .ach-board {
            flex: 1; overflow-y: auto; padding: 16px;
            background: radial-gradient(ellipse at top,
                #1e1e3a 0%, #111122 100%);
        }
        .ach-board::-webkit-scrollbar { width: 8px; }
        .ach-board::-webkit-scrollbar-track { background: #111; }
        .ach-board::-webkit-scrollbar-thumb {
            background: #333; border-radius: 4px;
        }

        /* ===== ריק ===== */
        .ach-empty {
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 16px; padding: 80px 20px;
            color: #444; font-size: 1.1rem; text-align: center;
        }
        .ach-empty i { font-size: 4rem; color: #333; }
        .ach-add-btn-empty {
            padding: 10px 22px;
            background: rgba(102,126,234,0.2);
            border: 1px solid rgba(102,126,234,0.4);
            border-radius: 8px; color: #a78bfa;
            font-size: 0.9rem; font-weight: 600; cursor: pointer;
            display: flex; align-items: center; gap: 8px;
            transition: all 0.2s;
        }
        .ach-add-btn-empty:hover {
            background: rgba(102,126,234,0.35);
        }

        /* ===== תצוגת כרטיסים ===== */
        .ach-board-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px; align-content: start;
        }
        .ach-card {
            background: #1e1e30; border: 1px solid #2a2a4e;
            border-radius: 12px; padding: 16px; position: relative;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            animation: achCardIn 0.2s ease forwards; direction: rtl;
            cursor: pointer;
        }
        @keyframes achCardIn {
            from { opacity: 0; transform: translateY(-8px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        .ach-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        }
        .ach-card-header {
            display: flex; align-items: center;
            justify-content: space-between; margin-bottom: 10px;
        }
        .ach-card-cat-badge {
            display: inline-flex; align-items: center; gap: 5px;
            padding: 3px 10px; border-radius: 12px;
            font-size: 0.75rem; font-weight: 600;
        }

        /*  כוכבי השפעה */
        .ach-stars {
            display: inline-flex; align-items: center; gap: 2px;
        }
        .ach-stars i { transition: transform 0.15s; }
        .ach-stars i:hover { transform: scale(1.2); }

        .ach-card-title {
            font-size: 0.95rem; font-weight: 700;
            color: #e0e0e0; margin-bottom: 8px; line-height: 1.4;
        }
        .ach-card-desc {
            font-size: 0.8rem; color: #888; line-height: 1.5;
            margin-bottom: 10px; display: -webkit-box;
            -webkit-line-clamp: 3; -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .ach-card-attachment {
            display: flex; align-items: center; gap: 6px;
            font-size: 0.75rem; color: #667eea; margin-bottom: 10px;
            padding: 4px 8px; background: rgba(102,126,234,0.1);
            border-radius: 6px; border: 1px solid rgba(102,126,234,0.2);
        }

        /*  קישור לחיץ בכרטיס */
        .ach-card-link {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 0.75rem; color: #38bdf8; margin-bottom: 8px;
            padding: 3px 8px; background: rgba(56,189,248,0.1);
            border-radius: 6px; border: 1px solid rgba(56,189,248,0.25);
            text-decoration: none; transition: all 0.2s;
        }
        .ach-card-link:hover {
            background: rgba(56,189,248,0.2);
            border-color: rgba(56,189,248,0.5); color: #7dd3fc;
        }

        /*  קישור בציר זמן */
        .ach-timeline-link {
            display: inline-flex; align-items: center; gap: 5px;
            font-size: 0.75rem; color: #38bdf8; margin: 4px 0 6px;
            padding: 3px 8px; background: rgba(56,189,248,0.1);
            border-radius: 6px; border: 1px solid rgba(56,189,248,0.25);
            text-decoration: none; transition: all 0.2s;
        }
        .ach-timeline-link:hover {
            background: rgba(56,189,248,0.2); color: #7dd3fc;
        }

        /*  קישור בטבלה */
        .ach-table-link {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; background: rgba(56,189,248,0.1);
            border: 1px solid rgba(56,189,248,0.3); border-radius: 6px;
            color: #38bdf8; text-decoration: none; transition: all 0.2s;
        }
        .ach-table-link:hover {
            background: rgba(56,189,248,0.25); color: #7dd3fc;
        }

        .ach-card-footer {
            display: flex; align-items: center;
            justify-content: space-between;
            padding-top: 10px; border-top: 1px solid #2a2a4e;
        }
        .ach-card-date {
            display: flex; align-items: center; gap: 5px;
            font-size: 0.72rem; color: #666;
        }
        .ach-card-actions {
            position: absolute; top: 10px; left: 10px;
            display: flex; gap: 4px;
            opacity: 0; transition: opacity 0.2s;
        }
        .ach-card:hover .ach-card-actions { opacity: 1; }

        /* ===== כפתורי פעולה ===== */
        .ach-action-btn {
            background: rgba(0,0,0,0.3);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 5px; padding: 4px 8px;
            cursor: pointer; font-size: 0.72rem;
            transition: all 0.2s; color: #aaa;
        }
        .ach-edit-btn:hover {
            background: rgba(59,130,246,0.3);
            border-color: rgba(59,130,246,0.5); color: #93c5fd;
        }
        .ach-delete-btn:hover {
            background: rgba(239,68,68,0.3);
            border-color: rgba(239,68,68,0.5); color: #fca5a5;
        }

        /* ===== תצוגת טבלה ===== */
        .ach-board-table { padding: 16px; }
        .ach-table-wrapper {
            overflow-x: auto; border-radius: 10px;
            border: 1px solid #2a2a4e;
        }
        .ach-table {
            width: 100%; border-collapse: collapse; direction: rtl;
        }
        .ach-table thead tr {
            background: linear-gradient(135deg, #320F5B, #4a1a8c);
        }
        .ach-table th {
            padding: 12px 14px; text-align: right;
            font-size: 0.82rem; font-weight: 600; color: #e0e0e0;
            white-space: nowrap;
        }
        .ach-table td {
            padding: 10px 14px; border-bottom: 1px solid #2a2a4e;
            font-size: 0.82rem; color: #ccc; vertical-align: middle;
        }
        .ach-table tbody tr:hover { background: #252535; cursor: pointer; }
        .ach-table-title { font-weight: 600; color: #e0e0e0; }
        .ach-table-desc { font-size: 0.72rem; color: #666; margin-top: 3px; }
        .ach-table-cat {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 2px 8px; border-radius: 10px;
            font-size: 0.72rem; font-weight: 600; white-space: nowrap;
        }
        .ach-table-date { white-space: nowrap; color: #888; font-size: 0.78rem; }
        .ach-table-actions {
            display: flex; gap: 4px;
            opacity: 0; transition: opacity 0.2s;
        }
        .ach-table tbody tr:hover .ach-table-actions { opacity: 1; }

        /* ===== ציר זמן ===== */
        .ach-board-timeline { padding: 16px; }
        .ach-timeline { max-width: 900px; margin: 0 auto; }
        .ach-timeline-section { margin-bottom: 32px; }
        .ach-timeline-month {
            display: flex; align-items: center; gap: 10px;
            font-size: 1rem; font-weight: 700; color: #a78bfa;
            margin-bottom: 16px; padding-bottom: 8px;
            border-bottom: 2px solid #2a2a4e;
        }
        .ach-timeline-count {
            background: rgba(167,139,250,0.2); color: #a78bfa;
            border: 1px solid rgba(167,139,250,0.3);
            border-radius: 10px; padding: 1px 8px; font-size: 0.75rem;
        }
        .ach-timeline-items {
            display: flex; flex-direction: column; gap: 12px;
            padding-right: 20px; border-right: 2px solid #2a2a4e;
        }
        .ach-timeline-item {
            display: flex; gap: 16px; align-items: flex-start;
            position: relative;
        }
        .ach-timeline-dot {
            width: 36px; height: 36px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 0.85rem; color: white; flex-shrink: 0;
            margin-right: -30px; box-shadow: 0 0 0 3px #1a1a2e;
        }
        .ach-timeline-content {
            flex: 1; background: #1e1e30;
            border: 1px solid #2a2a4e; border-radius: 10px;
            padding: 12px 14px; transition: box-shadow 0.2s;
        }
        .ach-timeline-content:hover {
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
        }
        .ach-timeline-header {
            display: flex; align-items: center; gap: 10px;
            margin-bottom: 6px; flex-wrap: wrap;
        }
        .ach-timeline-title {
            font-size: 0.9rem; font-weight: 700;
            color: #e0e0e0; flex: 1;
        }
        .ach-timeline-cat {
            display: inline-flex; align-items: center; gap: 4px;
            padding: 2px 8px; border-radius: 10px;
            font-size: 0.7rem; font-weight: 600;
        }
        .ach-timeline-desc {
            font-size: 0.78rem; color: #888;
            line-height: 1.5; margin-bottom: 8px;
        }
        .ach-timeline-meta {
            display: flex; gap: 14px;
            font-size: 0.72rem; color: #666;
        }
        .ach-timeline-meta span {
            display: flex; align-items: center; gap: 4px;
        }
        .ach-timeline-actions {
            display: flex; gap: 4px; margin-top: 8px;
            opacity: 0; transition: opacity 0.2s;
        }
        .ach-timeline-content:hover .ach-timeline-actions { opacity: 1; }

        /* ===== מודל ===== */
        .ach-modal-overlay {
            position: fixed; top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); z-index: 99999;
            display: flex; align-items: center;
            justify-content: center;
            animation: achFadeIn 0.2s ease;
        }
        @keyframes achFadeIn {
            from { opacity: 0; } to { opacity: 1; }
        }
        .ach-modal {
            background: #1e1e2e; border: 1px solid #3a3a5a;
            border-radius: 12px; width: 90%; max-width: 560px;
            max-height: 90vh; overflow-y: auto;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
            animation: achSlideIn 0.2s ease; direction: rtl;
        }
        @keyframes achSlideIn {
            from { transform: translateY(-20px); opacity: 0; }
            to   { transform: translateY(0);     opacity: 1; }
        }
        .ach-modal-header {
            display: flex; justify-content: space-between;
            align-items: center; padding: 16px 20px;
            border-bottom: 1px solid #2a2a4e;
        }
        .ach-modal-title {
            font-size: 1rem; font-weight: 700; color: #e0e0e0;
            display: flex; align-items: center; gap: 8px; margin: 0;
        }
        .ach-modal-title i { color: #a78bfa; }
        .ach-modal-close {
            background: none; border: none; color: #888;
            font-size: 22px; cursor: pointer; line-height: 1;
            padding: 0 4px; transition: color 0.2s;
        }
        .ach-modal-close:hover { color: #ccc; }
        .ach-modal-body {
            padding: 20px; display: flex;
            flex-direction: column; gap: 14px;
        }
        .ach-modal-footer {
            display: flex; gap: 10px; padding: 16px 20px;
            border-top: 1px solid #2a2a4e; justify-content: flex-end;
        }

        /* ===== שדות טופס ===== */
        .ach-form-group { display: flex; flex-direction: column; gap: 6px; }
        .ach-form-row {
            display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
        }
        .ach-form-label {
            font-size: 0.82rem; font-weight: 600; color: #aaa;
            display: flex; align-items: center; gap: 6px;
        }
        .ach-form-label i { color: #a78bfa; }
        .ach-form-input,
        .ach-form-select,
        .ach-form-textarea {
            background: #252535; border: 1px solid #3a3a5a;
            border-radius: 6px; color: #e0e0e0;
            padding: 8px 12px; font-size: 0.88rem; outline: none;
            transition: border-color 0.2s; font-family: inherit;
            direction: rtl;
        }
        .ach-form-input:focus,
        .ach-form-select:focus,
        .ach-form-textarea:focus {
            border-color: #667eea;
            box-shadow: 0 0 0 2px rgba(102,126,234,0.15);
        }
        .ach-form-input[readonly],
        .ach-form-textarea[readonly],
        .ach-form-select[disabled] {
            opacity: 0.7; cursor: default;
            background: #1e1e2e;
        }
        .ach-form-input::placeholder,
        .ach-form-textarea::placeholder { color: #555; }
        .ach-form-textarea { resize: vertical; min-height: 100px; }
        .ach-form-select option { background: #252535; }

        /* ===== כפתורי Footer מודל ===== */
        .ach-modal-cancel-btn {
            padding: 9px 18px; background: transparent;
            border: 1px solid #444; border-radius: 6px;
            color: #999; font-size: 0.88rem; font-weight: 600;
            cursor: pointer; display: flex; align-items: center;
            gap: 6px; transition: all 0.2s;
        }
        .ach-modal-cancel-btn:hover { background: #2a2a3a; color: #ccc; }
        .ach-modal-save-btn {
            padding: 9px 20px; background: #667eea; border: none;
            border-radius: 6px; color: white; font-size: 0.88rem;
            font-weight: 700; cursor: pointer; display: flex;
            align-items: center; gap: 6px; transition: background 0.2s;
        }
        .ach-modal-save-btn:hover { background: #5a67d8; }
        .ach-modal-save-btn:disabled {
            background: #444; color: #777; cursor: not-allowed;
        }

        /* ===== Light Mode ===== */
        [data-theme="light"] .ach-root {
            background: #f0f2f5; color: #1a1a2e;
        }
        [data-theme="light"] .ach-header {
            background: #e8e8f8; border-bottom-color: #c8c8e0;
        }
        [data-theme="light"] .ach-select,
        [data-theme="light"] .ach-search-input {
            background: #fff; border-color: #ccc; color: #1a1a2e;
        }
        [data-theme="light"] .ach-stat-item {
            background: #fff; border-color: #ddd;
        }
        [data-theme="light"] .ach-stat-value { color: #1a1a2e; }
        [data-theme="light"] .ach-board {
            background: radial-gradient(ellipse at top,
                #e8e8f8 0%, #f0f2f5 100%);
        }
        [data-theme="light"] .ach-card {
            background: #fff; border-color: #e0e0e0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
                [data-theme="light"] .ach-card-title { color: #1a1a2e; }
        [data-theme="light"] .ach-card-desc { color: #666; }
        [data-theme="light"] .ach-card-footer { border-top-color: #eee; }
        [data-theme="light"] .ach-card-date { color: #888; }
        [data-theme="light"] .ach-card:hover {
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }
        [data-theme="light"] .ach-card-link {
            background: rgba(56,189,248,0.08);
            border-color: rgba(56,189,248,0.2); color: #0284c7;
        }
        [data-theme="light"] .ach-card-link:hover {
            background: rgba(56,189,248,0.15); color: #0369a1;
        }
        [data-theme="light"] .ach-timeline-link {
            background: rgba(56,189,248,0.08);
            border-color: rgba(56,189,248,0.2); color: #0284c7;
        }
        [data-theme="light"] .ach-table-link { color: #0284c7; }
        [data-theme="light"] .ach-action-btn {
            background: rgba(0,0,0,0.06);
            border-color: rgba(0,0,0,0.1); color: #666;
        }
        [data-theme="light"] .ach-table-wrapper { border-color: #e0e0e0; }
        [data-theme="light"] .ach-table thead tr {
            background: linear-gradient(135deg, #4a1a8c, #667eea);
        }
        [data-theme="light"] .ach-table td {
            border-bottom-color: #eee; color: #333;
        }
        [data-theme="light"] .ach-table tbody tr:hover {
            background: #f5f5ff;
        }
        [data-theme="light"] .ach-table-title { color: #1a1a2e; }
        [data-theme="light"] .ach-timeline-items { border-right-color: #ddd; }
        [data-theme="light"] .ach-timeline-content {
            background: #fff; border-color: #e0e0e0;
        }
        [data-theme="light"] .ach-timeline-title { color: #1a1a2e; }
        [data-theme="light"] .ach-timeline-desc { color: #666; }
        [data-theme="light"] .ach-timeline-meta { color: #888; }
        [data-theme="light"] .ach-modal {
            background: #fff; border-color: #c8c8e0;
        }
        [data-theme="light"] .ach-modal-header,
        [data-theme="light"] .ach-modal-footer { border-color: #eee; }
        [data-theme="light"] .ach-modal-title { color: #1a1a2e; }
        [data-theme="light"] .ach-form-input,
        [data-theme="light"] .ach-form-select,
        [data-theme="light"] .ach-form-textarea {
            background: #f5f5f5; border-color: #ccc; color: #1a1a2e;
        }
        [data-theme="light"] .ach-form-input[readonly],
        [data-theme="light"] .ach-form-textarea[readonly],
        [data-theme="light"] .ach-form-select[disabled] {
            background: #ebebeb;
        }
        [data-theme="light"] .ach-form-label { color: #555; }
        [data-theme="light"] .ach-modal-cancel-btn {
            border-color: #ccc; color: #666;
        }
        [data-theme="light"] .ach-modal-cancel-btn:hover {
            background: #f0f0f8;
        }
        [data-theme="light"] .ach-empty { color: #aaa; }
        [data-theme="light"] .ach-empty i { color: #ccc; }
        [data-theme="light"] .ach-view-btns {
            background: #fff; border-color: #ddd;
        }
        [data-theme="light"] .ach-view-btn { color: #888; }
        [data-theme="light"] .ach-view-btn:hover {
            background: #f0f0f8; color: #333;
        }
        [data-theme="light"] .ach-counter {
            background: #fff; border-color: #ddd; color: #666;
        }
        [data-theme="light"] .ach-export-btn {
            background: rgba(34,197,94,0.08);
            border-color: rgba(34,197,94,0.3); color: #15803d;
        }
        [data-theme="light"] .ach-import-btn {
            background: rgba(29,111,66,0.08);
            border-color: rgba(29,111,66,0.3); color: #15803d;
        }
        [data-theme="light"] .ach-refresh-btn {
            background: #fff; border-color: #ddd; color: #666;
        }
        [data-theme="light"] .ach-add-btn {
            background: rgba(102,126,234,0.1);
            border-color: rgba(102,126,234,0.3); color: #5b21b6;
        }
        [data-theme="light"] .ach-timeline-month {
            color: #5b21b6; border-bottom-color: #ddd;
        }
        [data-theme="light"] .ach-timeline-count {
            background: rgba(91,33,182,0.1); color: #5b21b6;
            border-color: rgba(91,33,182,0.2);
        }
        [data-theme="light"] .ach-timeline-dot {
            box-shadow: 0 0 0 3px #f0f2f5;
        }
        [data-theme="light"] .ach-stat-cat-badge { opacity: 0.9; }
        /* ===== שדה תאריך מותאם ===== */
        .ach-date-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        .ach-date-input {
            flex: 1;
            padding-left: 36px !important;
            letter-spacing: 0.5px;
            font-variant-numeric: tabular-nums;
        }
        .ach-date-picker-btn {
            position: absolute;
            left: 8px;
            background: none;
            border: none;
            color: #a78bfa;
            cursor: pointer;
            padding: 4px;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.2s;
            z-index: 1;
        }
        .ach-date-picker-btn:hover {
            color: #c4b5fd;
            background: rgba(167,139,250,0.15);
        }
        [data-theme="light"] .ach-date-picker-btn {
            color: #5b21b6;
        }
        [data-theme="light"] .ach-date-picker-btn:hover {
            background: rgba(91,33,182,0.1);
        }
        .ach-card-attachment {
            cursor: pointer;
        }

        .ach-card-attachment:hover {
            background: rgba(102,126,234,0.2);
        }
        /* ✅ Header צף */
.ach-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background: #16162a;
    border-bottom: 1px solid #2a2a4e;
    flex-shrink: 0;
    direction: rtl;
    box-shadow: 0 2px 12px rgba(0,0,0,0.4);
}

.ach-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    flex-wrap: wrap;
    gap: 10px;
    direction: ltr;
}

.ach-header-filters {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.ach-header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}


.ach-stat-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: #252535;
    border: 1px solid #3a3a5a;
    border-radius: 20px;       /* ✅ pill shape */
    white-space: nowrap;
}

.ach-stat-icon {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.78rem;
    flex-shrink: 0;
}

.ach-stat-info {
    display: flex;
    align-items: center;
    gap: 5px;
}

.ach-stat-value {
    font-size: 0.8rem;
    font-weight: 700;
    color: #e0e0e0;
    line-height: 1;
}

.ach-stat-label {
    font-size: 0.72rem;
    color: #888;
}

/* ✅ תגיות קטגוריות בסטטיסטיקות */
.ach-stat-cats {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    margin-right: 6px;
    padding-right: 10px;
    border-right: 1px solid #3a3a5a;
}

.ach-stat-cat-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
}

.ach-stat-cat-badge strong {
    font-size: 0.78rem;
}
        `;

        document.head.appendChild(style);
    }
}