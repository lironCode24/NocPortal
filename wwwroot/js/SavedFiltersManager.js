/**
 * SavedFiltersManager.js
 * ניהול סינונים שמורים - שמירה מקומית ובשרת
 */
class SavedFiltersManager {
    constructor(alertsManager) {
        this.alertsManager = alertsManager;
        this.savedFilters = [];
        this.currentUser = null;
        this.storageKey = 'alertsSavedFilters';
        this.globalStorageKey = 'alertsGlobalSavedFilters';
        this.activeFilterId = null;
    }

    async fetchCurrentUser() {
        try {
            const response = await fetch('/Auth/Me', { credentials: 'include' });
            if (response.ok) {
                this.currentUser = await response.json();
            }
        } catch (error) {
            console.error('Error fetching current user:', error);
        }
    }

    // ==========================================
    // טעינה ושמירה
    // ==========================================

    async loadSavedFilters() {
        try {
            // טען סינונים מהשרת
            const response = await fetch('/Alerts/GetSavedFilters', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.savedFilters = data.filters || [];
            } else {
                // fallback ל-localStorage
                this.savedFilters = this._loadFromLocalStorage();
            }
        } catch (error) {
            console.error('Error loading saved filters:', error);
            this.savedFilters = this._loadFromLocalStorage();
        }
    }

    _loadFromLocalStorage() {
        try {
            const userKey = this._getUserStorageKey();
            const userFilters = JSON.parse(
                localStorage.getItem(userKey) || '[]'
            );
            const globalFilters = JSON.parse(
                localStorage.getItem(this.globalStorageKey) || '[]'
            );

            // מיזוג - סינונים גלובליים + אישיים
            const merged = [...globalFilters];
            userFilters.forEach(f => {
                if (!merged.find(m => m.id === f.id)) {
                    merged.push(f);
                }
            });
            return merged;
        } catch {
            return [];
        }
    }

    _getUserStorageKey() {
        const username = this.currentUser?.username || 'anonymous';
        return `${this.storageKey}_${username}`;
    }

    async saveFilterToServer(filter) {
        try {
            const response = await fetch('/Alerts/SaveFilter', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(filter)
            });

            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('Error saving filter to server:', error);
        }

        // fallback ל-localStorage
        this._saveToLocalStorage(filter);
        return { success: true, id: filter.id };
    }

    _saveToLocalStorage(filter) {
        try {
            if (filter.isGlobal) {
                const globalFilters = JSON.parse(
                    localStorage.getItem(this.globalStorageKey) || '[]'
                );
                const idx = globalFilters.findIndex(f => f.id === filter.id);
                if (idx >= 0) {
                    globalFilters[idx] = filter;
                } else {
                    globalFilters.push(filter);
                }
                localStorage.setItem(
                    this.globalStorageKey,
                    JSON.stringify(globalFilters)
                );
            } else {
                const userKey = this._getUserStorageKey();
                const userFilters = JSON.parse(
                    localStorage.getItem(userKey) || '[]'
                );
                const idx = userFilters.findIndex(f => f.id === filter.id);
                if (idx >= 0) {
                    userFilters[idx] = filter;
                } else {
                    userFilters.push(filter);
                }
                localStorage.setItem(userKey, JSON.stringify(userFilters));
            }
        } catch (error) {
            console.error('Error saving filter to localStorage:', error);
        }
    }

    async deleteFilterFromServer(filterId) {
        try {
            const response = await fetch(`/Alerts/DeleteFilter/${filterId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (response.ok) return true;
        } catch (error) {
            console.error('Error deleting filter from server:', error);
        }

        // fallback ל-localStorage
        this._deleteFromLocalStorage(filterId);
        return true;
    }

    _deleteFromLocalStorage(filterId) {
        // מחק מסינונים אישיים
        const userKey = this._getUserStorageKey();
        const userFilters = JSON.parse(
            localStorage.getItem(userKey) || '[]'
        ).filter(f => f.id !== filterId);
        localStorage.setItem(userKey, JSON.stringify(userFilters));

        // מחק מסינונים גלובליים
        const globalFilters = JSON.parse(
            localStorage.getItem(this.globalStorageKey) || '[]'
        ).filter(f => f.id !== filterId);
        localStorage.setItem(
            this.globalStorageKey,
            JSON.stringify(globalFilters)
        );
    }

    // ==========================================
    // פעולות CRUD
    // ==========================================

    getCurrentFiltersSnapshot() {
        return {
            severityFilters: [...this.alertsManager.severityFilters],
            statusFilters: [...this.alertsManager.statusFilters],
            searchTerm: this.alertsManager.searchTerm || ''
        };
    }

    async saveCurrentFilters(name, isGlobal = false) {
        if (!name || !name.trim()) {
            throw new Error('שם הסינון לא יכול להיות ריק');
        }

        const snapshot = this.getCurrentFiltersSnapshot();
        const username = this.currentUser?.username || 'anonymous';

        const filter = {
            id: `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: name.trim(),
            isGlobal,
            createdBy: username,
            createdAt: new Date().toISOString(),
            filters: snapshot
        };

        const result = await this.saveFilterToServer(filter);

        if (result.id) {
            filter.id = result.id;
        }

        // הוסף לרשימה המקומית
        this.savedFilters.push(filter);

        return filter;
    }

    _removeSearchHighlights() {
        const alertsTable = document.querySelector('.alerts-table');
        if (alertsTable) alertsTable.classList.remove('search-active');

        document.querySelectorAll('.alerts-table tr.search-match').forEach(row => {
            row.classList.remove('search-match');
        });

        const alertsSearch = document.querySelector('.alerts-search');
        if (alertsSearch) alertsSearch.classList.remove('has-search-text');
    }

    applyFilter(filterId) {
        const filter = this.savedFilters.find(f => f.id === filterId);
        if (!filter) return;

        // *** שמור את המצב הנוכחי לפני החלת הסינון ***
        this._previousFiltersSnapshot = {
            severityFilters: [...this.alertsManager.severityFilters],
            statusFilters: [...this.alertsManager.statusFilters],
            searchTerm: this.alertsManager.searchTerm || ''
        };

        const { severityFilters, statusFilters, searchTerm } = filter.filters;

        this.alertsManager.severityFilters = [...severityFilters];
        this.alertsManager.statusFilters = [...statusFilters];
        this.alertsManager.searchTerm = searchTerm || '';

        this.activeFilterId = filterId;

        // *** עדכן UI - כפתורי severity ***
        document.querySelectorAll('.severity-filter-btn').forEach(btn => {
            const value = btn.getAttribute('data-value');
            btn.classList.toggle('active', this.alertsManager.severityFilters.includes(value));
        });

        // *** עדכן UI - כפתורי status ***
        document.querySelectorAll('.status-filter-btn').forEach(btn => {
            const value = btn.getAttribute('data-value');
            btn.classList.toggle('active', this.alertsManager.statusFilters.includes(value));
        });

        // *** עדכן שדה חיפוש ***
        const searchInput = document.getElementById('alertSearchInput');
        if (searchInput) {
            searchInput.value = this.alertsManager.searchTerm;
            const clearBtn = document.getElementById('clearAlertSearch');
            if (clearBtn) {
                clearBtn.style.display = this.alertsManager.searchTerm ? 'flex' : 'none';
            }
        }

        // *** שמור ב-localStorage ***
        try {
            localStorage.setItem('alertsActiveFilterId', filterId);
            localStorage.setItem(
                'alertsActiveFilterCache',
                JSON.stringify({
                    id: filterId,
                    name: filter.name,
                    appliedAt: new Date().toISOString(),
                    filters: filter.filters
                })
            );
        } catch (e) {
            console.warn('Could not cache active filter:', e);
        }

        setTimeout(() => {
            this._removeSearchHighlights();
        }, 0);

        // *** הגדר דגל לפני applyFilters ***
        this.alertsManager._suppressSearchHighlight = true;
        this.alertsManager.applyFilters?.();

        this._updateActiveIndication();
    }

    /**
 * מעדכן את ה-UI של האינדיקטור לפי הסינון הפעיל הנוכחי
 * נקרא אחרי שהכפתורים נוצרו ב-DOM
 */
    restoreActiveFilterIndicator() {
        try {
            // בדוק אם יש סינון פעיל כבר מוגדר במופע
            if (this.activeFilterId) {
                // הכפתור כבר קיים עכשיו - עדכן את ה-UI
                this._updateActiveIndication();
                return;
            }

            // אם לא, בדוק ב-localStorage
            const cachedId = localStorage.getItem('alertsActiveFilterId');
            if (!cachedId) return;

            // בדוק שהסינון עדיין קיים ברשימה
            const filter = this.savedFilters.find(f => f.id === cachedId);
            if (!filter) {
                // הסינון נמחק - נקה קאש
                localStorage.removeItem('alertsActiveFilterId');
                localStorage.removeItem('alertsActiveFilterCache');
                return;
            }

            // הגדר את הסינון הפעיל ועדכן UI
            this.activeFilterId = cachedId;
            this._updateActiveIndication();

        } catch (error) {
            console.error('Error restoring active filter indicator:', error);
        }
    }

    // הוסף פונקציה לשחזור סינון פעיל בטעינה:
    restoreActiveFilter() {
        // *** אפס snapshot בטעינה ראשונית ***
        this._previousFiltersSnapshot = null;

        try {
            const cachedId = localStorage.getItem('alertsActiveFilterId');
            if (!cachedId) return;

            const filter = this.savedFilters.find(f => f.id === cachedId);
            if (filter) {
                const { severityFilters, statusFilters, searchTerm } = filter.filters;

                this.alertsManager.severityFilters = [...severityFilters];
                this.alertsManager.statusFilters = [...statusFilters];
                this.alertsManager.searchTerm = searchTerm || '';

                this.activeFilterId = cachedId;

                document.querySelectorAll('.severity-filter-btn').forEach(btn => {
                    const value = btn.getAttribute('data-value');
                    btn.classList.toggle('active', this.alertsManager.severityFilters.includes(value));
                });

                document.querySelectorAll('.status-filter-btn').forEach(btn => {
                    const value = btn.getAttribute('data-value');
                    btn.classList.toggle('active', this.alertsManager.statusFilters.includes(value));
                });

                const searchInput = document.getElementById('alertSearchInput');
                if (searchInput) {
                    searchInput.value = this.alertsManager.searchTerm;
                    const clearBtn = document.getElementById('clearAlertSearch');
                    if (clearBtn) {
                        clearBtn.style.display = this.alertsManager.searchTerm ? 'flex' : 'none';
                    }
                }

                // *** אפס snapshot אחרי שחזור (אין "מצב קודם" בטעינה) ***
                this._previousFiltersSnapshot = null;

                setTimeout(() => {
                    this._removeSearchHighlights();
                }, 0);

                // *** הגדר דגל לפני applyFilters ***
                this.alertsManager._suppressSearchHighlight = true;
                this.alertsManager.applyFilters?.();

                this._updateActiveIndication();

                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(
                        `סינון "${filter.name}" שוחזר`,
                        'info'
                    );
                }
            } else {
                // הסינון נמחק - נקה קאש
                localStorage.removeItem('alertsActiveFilterId');
                localStorage.removeItem('alertsActiveFilterCache');
            }
        } catch (e) {
            console.warn('Could not restore active filter:', e);
        }
    }

    async initialize() {
        await this.fetchCurrentUser();
        await this.loadSavedFilters();

        // *** המתן שה-DOM יהיה מוכן לפני שחזור סינון ***
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(() => {
                this.restoreActiveFilter();
            }, 300);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => {
                    this.restoreActiveFilter();
                }, 300);
            });
        }
    }

    // הוסף פונקציה לעריכת סינון קיים:
    async editFilter(filterId) {
        const filter = this.savedFilters.find(f => f.id === filterId);
        if (!filter) return;

        // פתח דיאלוג עריכה
        this._openEditDialog(filter);
    }

    _openAddDialog() {
        const snapshot = this.getCurrentFiltersSnapshot();
        const currentSeverity = [...snapshot.severityFilters];
        const currentStatus = [...snapshot.statusFilters];
        let currentSearch = snapshot.searchTerm || '';

        const dialog = document.createElement('div');
        dialog.id = 'sfpAddDialog';
        dialog.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0,0,0,0.6);
        z-index: 10002;
        display: flex; justify-content: center; align-items: center;
        direction: rtl;
    `;

        const severityOptions = [
            { value: 'CRITICAL', label: 'CRITICAL', color: '#ef4444' },
            { value: 'MAJOR', label: 'MAJOR', color: '#f97316' },
            { value: 'UNKNOWN', label: 'UNKNOWN', color: '#6b7280' }
        ];
        const statusOptions = [
            { value: 'OPEN', label: 'OPEN', color: '#ef4444' },
            { value: 'ACK', label: 'ACK', color: '#f97316' },
            { value: 'ASSIGN', label: 'ASSIGN', color: '#3b82f6' },
            { value: 'CLOSED', label: 'CLOSED', color: '#6b7280' }
        ];

        dialog.innerHTML = `
        <div style="background:#1e1e1e; border-radius:12px;
                    width:480px; max-width:95%; max-height:90vh;
                    overflow-y:auto; padding:24px;
                    box-shadow:0 8px 40px rgba(0,0,0,0.6);">

            <!-- כותרת -->
            <div style="display:flex; justify-content:space-between;
                        align-items:center; margin-bottom:20px;">
                <h3 style="margin:0; color:#e0e0e0; font-size:1.05rem;
                           display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-plus-circle" style="color:#a78bfa;"></i>
                    שמירת סינון חדש
                </h3>
                <button id="sfpAddClose"
                        style="background:none; border:none; color:#888;
                               cursor:pointer; font-size:1.3rem; line-height:1;
                               padding:4px 8px; border-radius:4px;">&times;</button>
            </div>

            <!-- שם -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem; display:block;
                              margin-bottom:6px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-tag" style="margin-left:4px; color:#7c3aed;"></i>
                    שם הסינון
                </label>
                <input type="text" id="sfpAddName"
                       placeholder="הכנס שם לסינון..."
                       maxlength="50"
                       style="width:100%; background:#2c2c2c; border:1px solid #444;
                              border-radius:8px; color:#e0e0e0; padding:10px 12px;
                              font-size:0.95rem; outline:none; box-sizing:border-box;
                              transition:border-color 0.2s;">
            </div>

            <!-- Severity -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem; display:block;
                              margin-bottom:8px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-exclamation-triangle" style="margin-left:4px; color:#f97316;"></i>
                    Severity
                </label>
                <div id="sfpAddSeverityBtns" style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${severityOptions.map(opt => `
                        <button type="button"
                                class="sfp-add-toggle-btn"
                                data-group="severity"
                                data-value="${opt.value}"
                                style="padding:7px 14px; border-radius:20px; cursor:pointer;
                                       font-size:0.82rem; font-weight:600;
                                       border:2px solid ${opt.color};
                                       background:${currentSeverity.includes(opt.value) ? opt.color : 'transparent'};
                                       color:${currentSeverity.includes(opt.value) ? '#fff' : opt.color};
                                       transition:all 0.2s; user-select:none;">
                            ${opt.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Status -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem; display:block;
                              margin-bottom:8px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-circle-dot" style="margin-left:4px; color:#3b82f6;"></i>
                    Status
                </label>
                <div id="sfpAddStatusBtns" style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${statusOptions.map(opt => `
                        <button type="button"
                                class="sfp-add-toggle-btn"
                                data-group="status"
                                data-value="${opt.value}"
                                style="padding:7px 14px; border-radius:20px; cursor:pointer;
                                       font-size:0.82rem; font-weight:600;
                                       border:2px solid ${opt.color};
                                       background:${currentStatus.includes(opt.value) ? opt.color : 'transparent'};
                                       color:${currentStatus.includes(opt.value) ? '#fff' : opt.color};
                                       transition:all 0.2s; user-select:none;">
                            ${opt.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- חיפוש -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem; display:block;
                              margin-bottom:6px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-search" style="margin-left:4px; color:#a78bfa;"></i>
                    טקסט חיפוש
                    <span style="color:#666; font-weight:400; font-size:0.75rem; margin-right:6px;">(אופציונלי)</span>
                </label>
                <div style="position:relative;">
                    <input type="text" id="sfpAddSearch"
                           value="${this._escapeHtml(currentSearch)}"
                           placeholder="חפש לפי טקסט..."
                           style="width:100%; background:#2c2c2c; border:1px solid #444;
                                  border-radius:8px; color:#e0e0e0;
                                  padding:10px 36px 10px 12px;
                                  font-size:0.9rem; outline:none; box-sizing:border-box;
                                  transition:border-color 0.2s;">
                    <button id="sfpAddSearchClear"
                            style="position:absolute; left:10px; top:50%;
                                   transform:translateY(-50%); background:none;
                                   border:none; color:#666; cursor:pointer;
                                   font-size:0.85rem; padding:2px;
                                   display:${currentSearch ? 'block' : 'none'};">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>

            <!-- גלובלי -->
            ${this.canCreateGlobal() ? `
                <div style="margin-bottom:20px; padding:10px 14px;
                            background:#252525; border-radius:8px;
                            border:1px solid #333; display:flex;
                            align-items:center; gap:10px; cursor:pointer;"
                     id="sfpAddGlobalRow">
                    <input type="checkbox" id="sfpAddGlobal"
                           style="width:16px; height:16px; cursor:pointer; accent-color:#7c3aed;">
                    <div>
                        <div style="color:#ccc; font-size:0.85rem; font-weight:600;">
                            <i class="fas fa-globe" style="color:#a78bfa; margin-left:5px;"></i>
                            סינון גלובלי
                        </div>
                        <div style="color:#666; font-size:0.75rem; margin-top:1px;">
                            יוצג לכל המשתמשים במערכת
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- תצוגה מקדימה -->
            <div style="background:#252525; border-radius:8px; padding:10px 14px;
                        margin-bottom:20px; border:1px solid #333;">
                <div style="color:#888; font-size:0.75rem; margin-bottom:6px; font-weight:600;">
                    <i class="fas fa-eye" style="margin-left:4px;"></i>
                    תצוגה מקדימה:
                </div>
                <div id="sfpAddPreview">
                    ${this._renderFilterPreview({
            severityFilters: currentSeverity,
            statusFilters: currentStatus,
            searchTerm: currentSearch
        })}
                </div>
            </div>

            <!-- כפתורים -->
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="sfpAddCancel"
                        style="padding:10px 20px; background:#2c2c2c; color:#ccc;
                               border:1px solid #444; border-radius:8px; cursor:pointer;
                               font-size:0.9rem; transition:all 0.2s;">
                    ביטול
                </button>
                <button id="sfpAddSave"
                        style="padding:10px 20px;
                               background:linear-gradient(135deg,#7c3aed,#6d28d9);
                               color:white; border:none; border-radius:8px;
                               cursor:pointer; font-size:0.9rem; font-weight:600;
                               display:flex; align-items:center; gap:6px;
                               transition:all 0.2s;">
                    <i class="fas fa-save"></i> שמור סינון
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(dialog);

        // toggle buttons
        const activeSeverity = [...currentSeverity];
        const activeStatus = [...currentStatus];

        dialog.querySelectorAll('.sfp-add-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = btn.dataset.group;
                const value = btn.dataset.value;
                const arr = group === 'severity' ? activeSeverity : activeStatus;
                const opt = (group === 'severity' ? severityOptions : statusOptions)
                    .find(o => o.value === value);

                const idx = arr.indexOf(value);
                if (idx >= 0) {
                    arr.splice(idx, 1);
                    btn.style.background = 'transparent';
                    btn.style.color = opt.color;
                } else {
                    arr.push(value);
                    btn.style.background = opt.color;
                    btn.style.color = '#fff';
                }

                const searchVal = dialog.querySelector('#sfpAddSearch')?.value || '';
                dialog.querySelector('#sfpAddPreview').innerHTML =
                    this._renderFilterPreview({
                        severityFilters: activeSeverity,
                        statusFilters: activeStatus,
                        searchTerm: searchVal
                    });
            });
        });

        // search input
        const searchInput = dialog.querySelector('#sfpAddSearch');
        const searchClear = dialog.querySelector('#sfpAddSearchClear');

        searchInput?.addEventListener('input', () => {
            const val = searchInput.value;
            if (searchClear) searchClear.style.display = val ? 'block' : 'none';
            dialog.querySelector('#sfpAddPreview').innerHTML =
                this._renderFilterPreview({
                    severityFilters: activeSeverity,
                    statusFilters: activeStatus,
                    searchTerm: val
                });
        });

        searchClear?.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.style.display = 'none';
            dialog.querySelector('#sfpAddPreview').innerHTML =
                this._renderFilterPreview({
                    severityFilters: activeSeverity,
                    statusFilters: activeStatus,
                    searchTerm: ''
                });
        });

        // global row click
        dialog.querySelector('#sfpAddGlobalRow')?.addEventListener('click', (e) => {
            if (e.target.id !== 'sfpAddGlobal') {
                const cb = dialog.querySelector('#sfpAddGlobal');
                if (cb) cb.checked = !cb.checked;
            }
        });

        // focus styles
        [dialog.querySelector('#sfpAddName'), searchInput].forEach(inp => {
            inp?.addEventListener('focus', () => inp.style.borderColor = '#7c3aed');
            inp?.addEventListener('blur', () => inp.style.borderColor = '#444');
        });

        // close
        dialog.querySelector('#sfpAddClose')?.addEventListener('click', () => dialog.remove());
        dialog.querySelector('#sfpAddCancel')?.addEventListener('click', () => dialog.remove());
        dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

        // save
        dialog.querySelector('#sfpAddSave')?.addEventListener('click', async () => {
            await this._submitAddFilter(dialog, activeSeverity, activeStatus);
        });

        // enter on name
        dialog.querySelector('#sfpAddName')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') dialog.querySelector('#sfpAddSave')?.click();
        });

        setTimeout(() => dialog.querySelector('#sfpAddName')?.focus(), 100);
    }

    _openEditDialog(filter) {
        // סגור פאנל קיים
        document.getElementById('savedFiltersPanel')?.remove();

        const dialog = document.createElement('div');
        dialog.id = 'sfpEditDialog';
        dialog.style.cssText = `
        position: fixed; top: 0; left: 0;
        width: 100%; height: 100%;
        background: rgba(0,0,0,0.6);
        z-index: 10002;
        display: flex; justify-content: center; align-items: center;
        direction: rtl;
    `;

        // קבל את הסינונים הנוכחיים של הסינון לעריכה
        const editSeverity = [...filter.filters.severityFilters];
        const editStatus = [...filter.filters.statusFilters];
        let editSearch = filter.filters.searchTerm || '';

        const severityOptions = [
            { value: 'CRITICAL', label: 'CRITICAL', color: '#ef4444' },
            { value: 'MAJOR', label: 'MAJOR', color: '#f97316' },
            { value: 'UNKNOWN', label: 'UNKNOWN', color: '#6b7280' }
        ];

        const statusOptions = [
            { value: 'OPEN', label: 'OPEN', color: '#ef4444' },
            { value: 'ACK', label: 'ACK', color: '#f97316' },
            { value: 'ASSIGN', label: 'ASSIGN', color: '#3b82f6' },
            { value: 'CLOSED', label: 'CLOSED', color: '#6b7280' }
        ];

        dialog.innerHTML = `
        <div style="background:#1e1e1e; border-radius:12px;
                    width:480px; max-width:95%; max-height:90vh;
                    overflow-y:auto; padding:24px;
                    box-shadow:0 8px 40px rgba(0,0,0,0.6);">

            <!-- כותרת -->
            <div style="display:flex; justify-content:space-between;
                        align-items:center; margin-bottom:20px;">
                <h3 style="margin:0; color:#e0e0e0; font-size:1.05rem; display:flex; align-items:center; gap:8px;">
                    <i class="fas fa-sliders-h" style="color:#a78bfa;"></i>
                    עריכת סינון
                </h3>
                <button id="sfpEditClose" style="background:none; border:none;
                        color:#888; cursor:pointer; font-size:1.3rem;
                        line-height:1; padding:4px 8px; border-radius:4px;
                        transition:all 0.2s;">&times;</button>
            </div>

            <!-- שם -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem;
                              display:block; margin-bottom:6px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-tag" style="margin-left:4px; color:#7c3aed;"></i>
                    שם הסינון
                </label>
                <input type="text" id="sfpEditName"
                       value="${this._escapeHtml(filter.name)}"
                       maxlength="50"
                       style="width:100%; background:#2c2c2c; border:1px solid #444;
                              border-radius:8px; color:#e0e0e0; padding:10px 12px;
                              font-size:0.95rem; outline:none; box-sizing:border-box;
                              transition:border-color 0.2s;">
            </div>

            <!-- Severity -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem;
                              display:block; margin-bottom:8px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-exclamation-triangle" style="margin-left:4px; color:#f97316;"></i>
                    Severity
                </label>
                <div id="sfpEditSeverityBtns" style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${severityOptions.map(opt => `
                        <button type="button"
                                class="sfp-edit-toggle-btn"
                                data-group="severity"
                                data-value="${opt.value}"
                                style="padding:7px 14px; border-radius:20px; cursor:pointer;
                                       font-size:0.82rem; font-weight:600; border:2px solid ${opt.color};
                                       background:${editSeverity.includes(opt.value) ? opt.color : 'transparent'};
                                       color:${editSeverity.includes(opt.value) ? '#fff' : opt.color};
                                       transition:all 0.2s; user-select:none;">
                            ${opt.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Status -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem;
                              display:block; margin-bottom:8px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-circle-dot" style="margin-left:4px; color:#3b82f6;"></i>
                    Status
                </label>
                <div id="sfpEditStatusBtns" style="display:flex; flex-wrap:wrap; gap:8px;">
                    ${statusOptions.map(opt => `
                        <button type="button"
                                class="sfp-edit-toggle-btn"
                                data-group="status"
                                data-value="${opt.value}"
                                style="padding:7px 14px; border-radius:20px; cursor:pointer;
                                       font-size:0.82rem; font-weight:600; border:2px solid ${opt.color};
                                       background:${editStatus.includes(opt.value) ? opt.color : 'transparent'};
                                       color:${editStatus.includes(opt.value) ? '#fff' : opt.color};
                                       transition:all 0.2s; user-select:none;">
                            ${opt.label}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- חיפוש -->
            <div style="margin-bottom:20px;">
                <label style="color:#aaa; font-size:0.8rem;
                              display:block; margin-bottom:6px; font-weight:600; letter-spacing:0.5px;">
                    <i class="fas fa-search" style="margin-left:4px; color:#a78bfa;"></i>
                    טקסט חיפוש
                    <span style="color:#666; font-weight:400; font-size:0.75rem; margin-right:6px;">(אופציונלי)</span>
                </label>
                <div style="position:relative;">
                    <input type="text" id="sfpEditSearch"
                           value="${this._escapeHtml(editSearch)}"
                           placeholder="חפש לפי טקסט..."
                           style="width:100%; background:#2c2c2c; border:1px solid #444;
                                  border-radius:8px; color:#e0e0e0; padding:10px 36px 10px 12px;
                                  font-size:0.9rem; outline:none; box-sizing:border-box;
                                  transition:border-color 0.2s;">
                    <button id="sfpEditSearchClear"
                            style="position:absolute; left:10px; top:50%; transform:translateY(-50%);
                                   background:none; border:none; color:#666; cursor:pointer;
                                   font-size:0.85rem; padding:2px;
                                   display:${editSearch ? 'block' : 'none'};">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            </div>

            <!-- גלובלי -->
            ${this.canCreateGlobal() ? `
                <div style="margin-bottom:20px; padding:10px 14px;
                            background:#252525; border-radius:8px;
                            border:1px solid #333; display:flex;
                            align-items:center; gap:10px; cursor:pointer;"
                     id="sfpEditGlobalRow">
                    <input type="checkbox" id="sfpEditGlobal"
                           ${filter.isGlobal ? 'checked' : ''}
                           style="width:16px; height:16px; cursor:pointer; accent-color:#7c3aed;">
                    <div>
                        <div style="color:#ccc; font-size:0.85rem; font-weight:600;">
                            <i class="fas fa-globe" style="color:#a78bfa; margin-left:5px;"></i>
                            סינון גלובלי
                        </div>
                        <div style="color:#666; font-size:0.75rem; margin-top:1px;">
                            יוצג לכל המשתמשים במערכת
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- תצוגה מקדימה חיה -->
            <div style="background:#252525; border-radius:8px; padding:10px 14px;
                        margin-bottom:20px; border:1px solid #333;">
                <div style="color:#888; font-size:0.75rem; margin-bottom:6px; font-weight:600;">
                    <i class="fas fa-eye" style="margin-left:4px;"></i>
                    תצוגה מקדימה:
                </div>
                <div id="sfpEditPreview">
                    ${this._renderFilterPreview({ severityFilters: editSeverity, statusFilters: editStatus, searchTerm: editSearch })}
                </div>
            </div>

            <!-- כפתורים -->
            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="sfpEditCancel"
                        style="padding:10px 20px; background:#2c2c2c; color:#ccc;
                               border:1px solid #444; border-radius:8px; cursor:pointer;
                               font-size:0.9rem; transition:all 0.2s;">
                    ביטול
                </button>
                <button id="sfpEditSave"
                        style="padding:10px 20px; background:linear-gradient(135deg,#7c3aed,#6d28d9);
                               color:white; border:none; border-radius:8px; cursor:pointer;
                               font-size:0.9rem; font-weight:600; display:flex;
                               align-items:center; gap:6px; transition:all 0.2s;">
                    <i class="fas fa-save"></i> שמור שינויים
                </button>
            </div>
        </div>
    `;

        document.body.appendChild(dialog);

        // --- מאזינים לכפתורי toggle ---
        const currentSeverity = [...editSeverity];
        const currentStatus = [...editStatus];

        dialog.querySelectorAll('.sfp-edit-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = btn.dataset.group;
                const value = btn.dataset.value;
                const arr = group === 'severity' ? currentSeverity : currentStatus;
                const opt = (group === 'severity' ? severityOptions : statusOptions)
                    .find(o => o.value === value);

                const idx = arr.indexOf(value);
                if (idx >= 0) {
                    arr.splice(idx, 1);
                    btn.style.background = 'transparent';
                    btn.style.color = opt.color;
                } else {
                    arr.push(value);
                    btn.style.background = opt.color;
                    btn.style.color = '#fff';
                }

                // עדכן תצוגה מקדימה
                const searchVal = dialog.querySelector('#sfpEditSearch')?.value || '';
                dialog.querySelector('#sfpEditPreview').innerHTML =
                    this._renderFilterPreview({
                        severityFilters: currentSeverity,
                        statusFilters: currentStatus,
                        searchTerm: searchVal
                    });
            });
        });

        // --- מאזין לחיפוש ---
        const searchInput = dialog.querySelector('#sfpEditSearch');
        const searchClear = dialog.querySelector('#sfpEditSearchClear');

        searchInput?.addEventListener('input', () => {
            const val = searchInput.value;
            if (searchClear) searchClear.style.display = val ? 'block' : 'none';
            dialog.querySelector('#sfpEditPreview').innerHTML =
                this._renderFilterPreview({
                    severityFilters: currentSeverity,
                    statusFilters: currentStatus,
                    searchTerm: val
                });
        });

        searchClear?.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.style.display = 'none';
            dialog.querySelector('#sfpEditPreview').innerHTML =
                this._renderFilterPreview({
                    severityFilters: currentSeverity,
                    statusFilters: currentStatus,
                    searchTerm: ''
                });
        });

        // --- גלובלי row לחיץ ---
        dialog.querySelector('#sfpEditGlobalRow')?.addEventListener('click', (e) => {
            if (e.target.id !== 'sfpEditGlobal') {
                const cb = dialog.querySelector('#sfpEditGlobal');
                if (cb) cb.checked = !cb.checked;
            }
        });

        // --- focus style ---
        [dialog.querySelector('#sfpEditName'), searchInput].forEach(inp => {
            inp?.addEventListener('focus', () => inp.style.borderColor = '#7c3aed');
            inp?.addEventListener('blur', () => inp.style.borderColor = '#444');
        });

        // --- סגירה ---
        dialog.querySelector('#sfpEditClose')?.addEventListener('click', () => dialog.remove());
        dialog.querySelector('#sfpEditCancel')?.addEventListener('click', () => dialog.remove());
        dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.remove(); });

        // --- שמירה ---
        dialog.querySelector('#sfpEditSave')?.addEventListener('click', async () => {
            await this._submitEditFilter(dialog, filter, currentSeverity, currentStatus);
        });

        setTimeout(() => dialog.querySelector('#sfpEditName')?.focus(), 100);
    }

    _showDuplicateContentWarning(duplicateFilterName) {
        return new Promise((resolve) => {
            // הסר modal קיים
            document.getElementById('sfpDuplicateWarningModal')?.remove();

            const modal = document.createElement('div');
            modal.id = 'sfpDuplicateWarningModal';
            modal.style.cssText = `
            position: fixed; top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.7);
            z-index: 10010;
            display: flex; justify-content: center; align-items: center;
            direction: rtl;
            animation: sfpFadeIn 0.15s ease;
        `;

            modal.innerHTML = `
            <div style="
                background: #1e1e1e;
                border: 1px solid #f59e0b;
                border-radius: 14px;
                width: 420px;
                max-width: 95%;
                padding: 28px 24px 22px;
                box-shadow: 0 8px 40px rgba(0,0,0,0.7),
                            0 0 0 1px rgba(245,158,11,0.2);
                animation: sfpSlideIn 0.2s ease;
            ">
                <!-- אייקון + כותרת -->
                <div style="
                    display: flex; align-items: center; gap: 12px;
                    margin-bottom: 16px;
                ">
                    <div style="
                        width: 44px; height: 44px; border-radius: 50%;
                        background: rgba(245,158,11,0.15);
                        border: 2px solid rgba(245,158,11,0.4);
                        display: flex; align-items: center; justify-content: center;
                        flex-shrink: 0;
                    ">
                        <i class="fas fa-exclamation-triangle"
                           style="color: #f59e0b; font-size: 1.2rem;"></i>
                    </div>
                    <div>
                        <div style="
                            color: #f59e0b; font-weight: 700;
                            font-size: 1rem; margin-bottom: 2px;
                        ">סינון עם הגדרות זהות קיים</div>
                        <div style="color: #888; font-size: 0.78rem;">
                            נמצא סינון עם אותן הגדרות בדיוק
                        </div>
                    </div>
                </div>

                <!-- תיבת מידע -->
                <div style="
                    background: rgba(245,158,11,0.08);
                    border: 1px solid rgba(245,158,11,0.25);
                    border-radius: 8px;
                    padding: 12px 14px;
                    margin-bottom: 20px;
                ">
                    <div style="
                        color: #aaa; font-size: 0.8rem;
                        margin-bottom: 5px;
                    ">הסינון הקיים:</div>
                    <div style="
                        display: flex; align-items: center; gap: 8px;
                    ">
                        <i class="fas fa-bookmark"
                           style="color: #f59e0b; font-size: 0.85rem;"></i>
                        <span style="
                            color: #fcd34d; font-weight: 600;
                            font-size: 0.95rem;
                        ">${this._escapeHtml(duplicateFilterName)}</span>
                    </div>
                    <div style="
                        color: #777; font-size: 0.75rem;
                        margin-top: 8px; line-height: 1.5;
                    ">
                        <i class="fas fa-info-circle"
                           style="margin-left: 4px;"></i>
                        שמירת סינון זהה עלולה לגרום לבלבול.
                        מומלץ להשתמש בסינון הקיים או לשנות את ההגדרות.
                    </div>
                </div>

                <!-- כפתורים -->
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="sfpDupCancel" style="
                        padding: 9px 18px;
                        background: #2c2c2c;
                        color: #ccc;
                        border: 1px solid #444;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.88rem;
                        transition: all 0.2s;
                        display: flex; align-items: center; gap: 6px;
                    ">
                        <i class="fas fa-times"></i> ביטול
                    </button>
                    <button id="sfpDupConfirm" style="
                        padding: 9px 18px;
                        background: linear-gradient(135deg, #d97706, #b45309);
                        color: white;
                        border: none;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.88rem;
                        font-weight: 600;
                        transition: all 0.2s;
                        display: flex; align-items: center; gap: 6px;
                    ">
                        <i class="fas fa-save"></i> שמור בכל זאת
                    </button>
                </div>
            </div>
        `;

            document.body.appendChild(modal);

            // Hover effects
            const cancelBtn = modal.querySelector('#sfpDupCancel');
            const confirmBtn = modal.querySelector('#sfpDupConfirm');

            cancelBtn.addEventListener('mouseenter', () => {
                cancelBtn.style.background = '#3c3c3c';
                cancelBtn.style.borderColor = '#666';
            });
            cancelBtn.addEventListener('mouseleave', () => {
                cancelBtn.style.background = '#2c2c2c';
                cancelBtn.style.borderColor = '#444';
            });
            confirmBtn.addEventListener('mouseenter', () => {
                confirmBtn.style.background = 'linear-gradient(135deg, #b45309, #92400e)';
            });
            confirmBtn.addEventListener('mouseleave', () => {
                confirmBtn.style.background = 'linear-gradient(135deg, #d97706, #b45309)';
            });

            // אירועים
            cancelBtn.addEventListener('click', () => {
                modal.remove();
                resolve(false);
            });

            confirmBtn.addEventListener('click', () => {
                modal.remove();
                resolve(true);
            });

            // סגירה בלחיצה על הרקע
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                    resolve(false);
                }
            });

            // סגירה ב-Escape
            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escHandler);
                    resolve(false);
                }
            };
            document.addEventListener('keydown', escHandler);
        });
    }

    async _submitAddFilter(dialog, activeSeverity, activeStatus) {
        const newName = dialog.querySelector('#sfpAddName')?.value?.trim();
        const isGlobal = this.canCreateGlobal()
            ? (dialog.querySelector('#sfpAddGlobal')?.checked ?? false)
            : false;
        const searchTerm = dialog.querySelector('#sfpAddSearch')?.value?.trim() || '';

        if (!newName) {
            const nameInput = dialog.querySelector('#sfpAddName');
            if (nameInput) {
                nameInput.style.borderColor = '#f87171';
                nameInput.focus();
                setTimeout(() => nameInput.style.borderColor = '#444', 2000);
            }
            return;
        }

        const duplicate = this.savedFilters.find(
            f => f.name.toLowerCase() === newName.toLowerCase()
        );
        if (duplicate) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(`סינון בשם "${newName}" כבר קיים`, 'error');
            }
            return;
        }

        // בדיקת תוכן זהה - אזהרה בלבד
        const contentDuplicate = this._findDuplicateContent(
            activeSeverity, activeStatus, searchTerm
        );
        if (contentDuplicate) {
            const confirmed = await this._showDuplicateContentWarning(
                contentDuplicate.name
            );
            if (!confirmed) return;
        }

        const username = this.currentUser?.username || 'anonymous';
        const filter = {
            id: `filter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: newName,
            isGlobal,
            createdBy: username,
            createdAt: new Date().toISOString(),
            filters: {
                severityFilters: [...activeSeverity],
                statusFilters: [...activeStatus],
                searchTerm
            }
        };

        try {
            const saveBtn = dialog.querySelector('#sfpAddSave');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
            }

            const result = await this.saveFilterToServer(filter);
            if (result?.id) filter.id = result.id;

            this.savedFilters.push(filter);

            dialog.remove();

            // הפעל את הסינון החדש אוטומטית
            this.applyFilter(filter.id);
            this.openSavedFiltersPanel();

            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    `הסינון "${newName}" נשמר והוחל בהצלחה`,
                    'success'
                );
            }
        } catch (error) {
            console.error('Error saving filter:', error);
            const saveBtn = dialog.querySelector('#sfpAddSave');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור סינון';
            }
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    `שגיאה בשמירת הסינון: ${error.message}`,
                    'error'
                );
            }
        }
    }

    _findDuplicateContent(severityFilters, statusFilters, searchTerm, excludeId = null) {
        return this.savedFilters.find(f => {
            // דלג על הסינון עצמו בעריכה
            if (excludeId && f.id === excludeId) return false;

            // בדוק רק סינונים שהמשתמש הנוכחי יכול לראות
            const username = this.currentUser?.username || 'anonymous';
            const isVisible = f.isGlobal || f.createdBy === username;
            if (!isVisible) return false;

            const saved = f.filters;

            const sameSeverity =
                severityFilters.length === saved.severityFilters.length &&
                severityFilters.every(v => saved.severityFilters.includes(v));

            const sameStatus =
                statusFilters.length === saved.statusFilters.length &&
                statusFilters.every(v => saved.statusFilters.includes(v));

            const sameSearch =
                (searchTerm || '') === (saved.searchTerm || '');

            return sameSeverity && sameStatus && sameSearch;
        });
    }

    async _submitEditFilter(dialog, originalFilter, currentSeverity, currentStatus) {
        const newName = dialog.querySelector('#sfpEditName')?.value?.trim();
        const isGlobal = this.canCreateGlobal()
            ? (dialog.querySelector('#sfpEditGlobal')?.checked ?? originalFilter.isGlobal)
            : originalFilter.isGlobal;
        const searchTerm = dialog.querySelector('#sfpEditSearch')?.value?.trim() || '';

        if (!newName) {
            const nameInput = dialog.querySelector('#sfpEditName');
            if (nameInput) {
                nameInput.style.borderColor = '#f87171';
                nameInput.focus();
                setTimeout(() => nameInput.style.borderColor = '#444', 2000);
            }
            return;
        }

        const duplicate = this.savedFilters.find(
            f => f.id !== originalFilter.id &&
                f.name.toLowerCase() === newName.toLowerCase()
        );
        if (duplicate) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    `סינון בשם "${newName}" כבר קיים`,
                    'error'
                );
            }
            return;
        }

        // בדיקת תוכן זהה - אזהרה בלבד (לא כולל את הסינון הנוכחי)
        const contentDuplicate = this._findDuplicateContent(
            currentSeverity, currentStatus, searchTerm, originalFilter.id
        );
        if (contentDuplicate) {
            const confirmed = await this._showDuplicateContentWarning(
                contentDuplicate.name
            );
            if (!confirmed) return;
        }

        const updatedFilter = {
            ...originalFilter,
            name: newName,
            isGlobal,
            updatedAt: new Date().toISOString(),
            filters: {
                severityFilters: [...currentSeverity],
                statusFilters: [...currentStatus],
                searchTerm
            }
        };

        try {
            const saveBtn = dialog.querySelector('#sfpEditSave');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
            }

            await this.saveFilterToServer(updatedFilter);

            const idx = this.savedFilters.findIndex(f => f.id === originalFilter.id);
            if (idx >= 0) this.savedFilters[idx] = updatedFilter;

            if (this.activeFilterId === originalFilter.id) {
                try {
                    localStorage.setItem('alertsActiveFilterCache', JSON.stringify({
                        id: updatedFilter.id,
                        name: updatedFilter.name,
                        appliedAt: new Date().toISOString(),
                        filters: updatedFilter.filters
                    }));
                } catch (e) { /* ignore */ }
                this._updateActiveIndication();
            }

            dialog.remove();

            // הפעל את הסינון המעודכן אוטומטית
            this.applyFilter(updatedFilter.id);

            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(`הסינון "${newName}" עודכן והוחל בהצלחה`, 'success');
            }

        } catch (error) {
            console.error('Error updating filter:', error);
            const saveBtn = dialog.querySelector('#sfpEditSave');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
            }
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    `שגיאה בעדכון הסינון: ${error.message}`,
                    'error'
                );
            }
        }
    }

    // נקה קאש בביטול סינון:
    clearActiveFilter() {
        // *** תמיד אפס לברירות מחדל - אל תסתמך על _previousFiltersSnapshot ***
        const defaultSeverity = ['CRITICAL', 'MAJOR', 'UNKNOWN'];
        const defaultStatus = ['OPEN', 'ACK', 'ASSIGN'];

        this.alertsManager.severityFilters = [...defaultSeverity];
        this.alertsManager.statusFilters = [...defaultStatus];
        this.alertsManager.searchTerm = '';

        // עדכן UI - כפתורי severity
        document.querySelectorAll('.severity-filter-btn').forEach(btn => {
            const value = btn.getAttribute('data-value');
            btn.classList.toggle('active', this.alertsManager.severityFilters.includes(value));
        });

        // עדכן UI - כפתורי status
        document.querySelectorAll('.status-filter-btn').forEach(btn => {
            const value = btn.getAttribute('data-value');
            btn.classList.toggle('active', this.alertsManager.statusFilters.includes(value));
        });

        // עדכן שדה חיפוש
        const searchInput = document.getElementById('alertSearchInput');
        if (searchInput) {
            searchInput.value = '';
            const clearBtn = document.getElementById('clearAlertSearch');
            if (clearBtn) {
                clearBtn.style.display = 'none';
            }
        }

        // שמור ב-localStorage
        this.alertsManager.saveToLocalStorage('alertsSeverityFilters', this.alertsManager.severityFilters);
        this.alertsManager.saveToLocalStorage('alertsStatusFilters', this.alertsManager.statusFilters);

        // אפס snapshot
        this._previousFiltersSnapshot = null;

        this.activeFilterId = null;
        localStorage.removeItem('alertsActiveFilterId');
        localStorage.removeItem('alertsActiveFilterCache');

        this.alertsManager.applyFilters?.();
        this._updateActiveIndication();
        this._updateClearButtonVisibility();
    }

    _updateClearButtonVisibility() {
        const clearBtn = document.getElementById('clearActiveFilterBtn');
        if (clearBtn) {
            if (this.activeFilterId) {
                clearBtn.classList.add('is-active');
            } else {
                clearBtn.classList.remove('is-active');
            }
        }
    }

    // ==========================================
    // עדכון כפתור הסינונים השמורים
    // ==========================================
    _updateActiveIndication() {
        const btn = document.getElementById('savedFiltersBtn');
        if (!btn) return;

        // הסר banner קיים
        document.getElementById('sfpActiveBanner')?.remove();

        if (this.activeFilterId) {
            const filter = this.savedFilters.find(f => f.id === this.activeFilterId);
            const filterName = filter?.name || '';

            // הכפתור עצמו - רק אייקון + dot
            btn.innerHTML = `
            <i class="fas fa-filter"></i>
            <span class="sfp-active-dot"></span>
        `;
            btn.title = `סינון פעיל: "${filterName}"\nלחץ לניהול סינונים`;
            btn.classList.add('has-active-filter');

            // Banner מתחת לכפתורים - מציג את שם הסינון
            this._renderActiveBanner(filterName);

        } else {
            btn.innerHTML = '<i class="fas fa-filter"></i>';
            btn.title = 'סינונים שמורים';
            btn.classList.remove('has-active-filter');
        }

        // עדכון פאנל פתוח אם קיים
        const panel = document.getElementById('savedFiltersPanel');
        if (panel) {
            panel.querySelectorAll('.sfp-item').forEach(el => {
                const isActive = el.dataset.filterId === this.activeFilterId;
                el.classList.toggle('sfp-item-active', isActive);

                const existingBadge = el.querySelector('.sfp-active-badge');
                if (isActive && !existingBadge) {
                    const badge = document.createElement('span');
                    badge.className = 'sfp-active-badge';
                    badge.innerHTML = '<i class="fas fa-check-circle"></i> פעיל';
                    el.querySelector('.sfp-item-name')?.after(badge);
                } else if (!isActive && existingBadge) {
                    existingBadge.remove();
                }
            });
        }

        this._updateClearButtonVisibility();
    }

    // Banner שמציג את שם הסינון הפעיל
    _renderActiveBanner(filterName) {
        // הסר banner קיים
        document.getElementById('sfpActiveBanner')?.remove();

        const banner = document.createElement('div');
        banner.id = 'sfpActiveBanner';
        banner.className = 'sfp-active-banner';
        banner.innerHTML = `
        <i class="fas fa-filter sfp-banner-icon"></i>
        <span class="sfp-banner-label">סינון פעיל:</span>
        <span class="sfp-banner-name">${this._escapeHtml(filterName)}</span>
        <button class="sfp-banner-clear" title="הסר סינון">
            <i class="fas fa-times"></i>
        </button>
    `;

        // מאזין לכפתור הסרה
        banner.querySelector('.sfp-banner-clear').addEventListener('click', () => {
            this.clearActiveFilter();
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(`סינון "${filterName}" בוטל`, 'info');
            }
        });

        // מצא את alerts-controls ושים את ה-banner אחריו
        const alertsControls = document.querySelector('.alerts-controls');
        if (alertsControls) {
            alertsControls.insertAdjacentElement('afterend', banner);
        } else {
            // fallback - שים לפני הטבלה
            const tableContainer = document.querySelector('.alerts-table-container');
            tableContainer?.insertAdjacentElement('beforebegin', banner);
        }
    }

    async deleteFilter(filterId) {
        await this.deleteFilterFromServer(filterId);
        this.savedFilters = this.savedFilters.filter(f => f.id !== filterId);

        if (this.activeFilterId === filterId) {
            this.activeFilterId = null;
            localStorage.removeItem('alertsActiveFilterId');
            localStorage.removeItem('alertsActiveFilterCache');
            this._previousFiltersSnapshot = null;
            this._updateActiveIndication();
            this._updateClearButtonVisibility();
        }
    }

    canDeleteFilter(filter) {
        if (!this.currentUser) return false;
        const { role, username } = this.currentUser;
        if (role === 'Admin') return true;
        return filter.createdBy === username;
    }

    canCreateGlobal() {
        if (!this.currentUser) return false;
        const { role } = this.currentUser;
        return role === 'Admin';
    }

    // ==========================================
    // UI - כפתור ופאנל
    // ==========================================
    renderSavedFiltersButton(container, clearContainer = null) {
        const existingBtn = document.getElementById('savedFiltersBtn');

        // *** בדוק אם הכפתור קיים בכלל (לא רק בcontainer הנוכחי) ***
        if (existingBtn) {
            // *** אם הכפתור קיים אבל ב-container שגוי - העבר אותו ***
            if (!container.contains(existingBtn)) {
                container.insertBefore(existingBtn, container.firstChild);

                // העבר גם את כפתור הניקוי
                const existingClearBtn = document.getElementById('clearActiveFilterBtn');
                if (existingClearBtn) {
                    const targetContainer = clearContainer || container;
                    targetContainer.insertBefore(existingClearBtn, targetContainer.firstChild);
                }
            }

            this._updateActiveIndication();
            this._updateClearButtonVisibility();
            return existingBtn;
        }

        // יצירת כפתור חדש (רק אם לא קיים בכלל)
        const btn = document.createElement('button');
        btn.id = 'savedFiltersBtn';
        btn.className = 'saved-filters-btn';
        btn.title = 'סינונים שמורים';
        btn.innerHTML = '<i class="fas fa-filter"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openSavedFiltersPanel();
        });
        container.insertBefore(btn, container.firstChild);

        const clearBtn = document.createElement('button');
        clearBtn.id = 'clearActiveFilterBtn';
        clearBtn.className = 'clear-active-filter-btn';
        clearBtn.title = 'הסר סינון פעיל';
        clearBtn.innerHTML = '<i class="fas fa-filter-circle-xmark"></i>';
        clearBtn.addEventListener('click', () => {
            if (!this.activeFilterId) return;
            this.clearActiveFilter();
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('הסינון הוסר', 'info');
            }
        });

        const targetContainer = clearContainer || container;
        targetContainer.insertBefore(clearBtn, targetContainer.firstChild);

        return btn;
    }

    openSavedFiltersPanel() {
        // סגור פאנל קיים
        const existing = document.getElementById('savedFiltersPanel');
        if (existing) {
            existing.remove();
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'savedFiltersPanel';
        panel.className = 'saved-filters-panel';

        const canGlobal = this.canCreateGlobal();
        const username = this.currentUser?.username || 'anonymous';
        // מיין: גלובליים קודם, אחר כך אישיים
        const globalFilters = this.savedFilters.filter(f => f.isGlobal);
        const personalFilters = this.savedFilters.filter(
            f => !f.isGlobal && f.createdBy === username
        );

        panel.innerHTML = `
            <div class="sfp-header">
                <span class="sfp-title">
                    <i class="fas fa-bookmark"></i> סינונים שמורים
                </span>
                <button class="sfp-close-btn" id="sfpCloseBtn">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="sfp-save-section">
                <button class="sfp-add-new-btn" id="sfpAddNewBtn">
                    <i class="fas fa-plus"></i> שמור סינון נוכחי
                </button>
                <div class="sfp-current-preview" id="sfpCurrentPreview">
                    ${this._renderFilterPreview(this.getCurrentFiltersSnapshot())}
                </div>
            </div>

            <div class="sfp-list-section">
                ${globalFilters.length > 0 ? `
                    <div class="sfp-group-label">
                        <i class="fas fa-globe"></i> גלובליים
                    </div>
                    ${globalFilters.map(f => this._renderFilterItem(f)).join('')}
                ` : ''}

                ${personalFilters.length > 0 ? `
                    <div class="sfp-group-label">
                        <i class="fas fa-user"></i> אישיים
                    </div>
                    ${personalFilters.map(f => this._renderFilterItem(f)).join('')}
                ` : ''}

                ${this.savedFilters.length === 0 ? `
                    <div class="sfp-empty">
                        <i class="fas fa-inbox"></i>
                        <span>אין סינונים שמורים</span>
                    </div>
                ` : ''}
            </div>
        `;

        // מיקום הפאנל
        const btn = document.getElementById('savedFiltersBtn');
        if (btn) {
            const rect = btn.getBoundingClientRect();
            panel.style.position = 'fixed';
            panel.style.top = `${rect.bottom + 8}px`;
            panel.style.right = `${window.innerWidth - rect.right - 400}px`;
        } else {
            panel.style.position = 'fixed';
            panel.style.top = '60px';
            panel.style.right = '20px';
        }

        document.body.appendChild(panel);
        this._attachPanelEvents(panel);

        // סגירה בלחיצה מחוץ לפאנל
        setTimeout(() => {
            document.addEventListener('click', this._outsideClickHandler.bind(this), { once: true });
        }, 100);
    }

    _outsideClickHandler(e) {
        const panel = document.getElementById('savedFiltersPanel');
        const btn = document.getElementById('savedFiltersBtn');
        if (panel && !panel.contains(e.target) && e.target !== btn) {
            panel.remove();
        }
    }

    _renderFilterPreview(snapshot) {
        const { severityFilters, statusFilters, searchTerm } = snapshot;
        const parts = [];

        if (severityFilters.length > 0) {
            parts.push(`<span class="sfp-tag sfp-tag-severity">
                ${severityFilters.join(', ')}
            </span>`);
        }
        if (statusFilters.length > 0) {
            parts.push(`<span class="sfp-tag sfp-tag-status">
                ${statusFilters.join(', ')}
            </span>`);
        }
        if (searchTerm) {
            parts.push(`<span class="sfp-tag sfp-tag-search">
                <i class="fas fa-search"></i> "${searchTerm}"
            </span>`);
        }

        return parts.length > 0
            ? `<div class="sfp-tags">${parts.join('')}</div>`
            : '<span class="sfp-no-filters">ללא סינונים פעילים</span>';
    }

    // ==========================================
    // רינדור פריט סינון בפאנל - עם צ'קבוקס ויזואלי
    // ==========================================
    _renderFilterItem(filter) {
        const canDelete = this.canDeleteFilter(filter);
        const isActive = filter.id === this.activeFilterId;
        const snapshot = filter.filters;
        const date = new Date(filter.createdAt);
        const dateStr = `${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;

        return `
        <div class="sfp-item ${isActive ? 'sfp-item-active' : ''}" 
            data-filter-id="${filter.id}">
            <div class="sfp-item-main">
                <div class="sfp-item-header">
                    <div class="sfp-item-name-row">
                        <div class="sfp-checkbox-visual ${isActive ? 'sfp-checkbox-checked' : ''}"
                            data-filter-id="${filter.id}"
                            title="${isActive ? 'לחץ לביטול הסינון' : 'לחץ להחלת הסינון'}">
                            ${isActive
                ? '<i class="fas fa-check"></i>'
                : ''}
                        </div>
                        <span class="sfp-item-name">
                            ${this._escapeHtml(filter.name)}
                        </span>
                        ${isActive ? `
                            <span class="sfp-active-badge">
                                <i class="fas fa-check-circle"></i> פעיל
                            </span>
                        ` : ''}
                    </div>
                    <div class="sfp-item-actions">
                        ${canDelete ? `
                            <button class="sfp-edit-btn" 
                                    data-filter-id="${filter.id}" 
                                    title="ערוך סינון">
                                <i class="fas fa-edit"></i>
                            </button>
                        ` : ''}
                        ${canDelete ? `
                            <button class="sfp-delete-btn" 
                                    data-filter-id="${filter.id}" 
                                    title="מחק סינון">
                                <i class="fas fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
                <div class="sfp-item-preview">
                    ${this._renderFilterPreview(snapshot)}
                </div>
                <div class="sfp-item-meta">
                    <span>${filter.createdBy}</span>
                    <span>${dateStr}</span>
                </div>
            </div>
        </div>
    `;
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    _attachPanelEvents(panel) {
        // סגירה
        panel.querySelector('#sfpCloseBtn')
            ?.addEventListener('click', () => panel.remove());

        // שמירת סינון
        panel.querySelector('#sfpAddNewBtn')
            ?.addEventListener('click', () => {
                panel.remove();
                this._openAddDialog();
            });

        // *** צ'קבוקסים ויזואליים - החלה/ביטול סינון ***
        panel.querySelectorAll('.sfp-checkbox-visual').forEach(checkbox => {
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                const filterId = checkbox.getAttribute('data-filter-id');
                const filter = this.savedFilters.find(f => f.id === filterId);

                if (this.activeFilterId === filterId) {
                    // ביטול סינון פעיל
                    this.clearActiveFilter();
                    panel.remove();
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(`סינון "${filter?.name}" בוטל`, 'info');
                    }
                } else {
                    // החלת סינון
                    this.applyFilter(filterId);
                    panel.remove();
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(`סינון "${filter?.name}" הוחל`, 'success');
                    }
                }
            });
        });

        // מחיקת סינון
        panel.querySelectorAll('.sfp-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const filterId = btn.getAttribute('data-filter-id');
                const filter = this.savedFilters.find(f => f.id === filterId);

                if (!confirm(`למחוק את הסינון "${filter?.name}"?`)) return;

                await this.deleteFilter(filterId);
                panel.remove();
                this.openSavedFiltersPanel();
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('הסינון נמחק', 'success');
                }
            });
        });

        panel.querySelectorAll('.sfp-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const filterId = btn.getAttribute('data-filter-id');
                panel.remove();
                this.editFilter(filterId);
            });
        });

        // לחיצה על שורת סינון (לא על כפתורים)
        panel.querySelectorAll('.sfp-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.sfp-checkbox-visual') ||
                    e.target.closest('.sfp-delete-btn') ||
                    e.target.closest('.sfp-edit-btn')) return;

                const filterId = item.getAttribute('data-filter-id');
                const filter = this.savedFilters.find(f => f.id === filterId);

                if (this.activeFilterId === filterId) {
                    this.clearActiveFilter();
                    panel.remove();
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(`סינון "${filter?.name}" בוטל`, 'info');
                    }
                    return;
                }

                this.applyFilter(filterId);
                panel.remove();
            });
        });
    }

    // בדיקה אם הסינון הנוכחי שונה מהסינון הפעיל
    _isFilterModified() {
        if (!this.activeFilterId) return false;

        const activeFilter = this.savedFilters.find(f => f.id === this.activeFilterId);
        if (!activeFilter) return false;

        const current = this.getCurrentFiltersSnapshot();
        const saved = activeFilter.filters;

        // השווה severity
        const sameSeverity =
            current.severityFilters.length === saved.severityFilters.length &&
            current.severityFilters.every(v => saved.severityFilters.includes(v));

        // השווה status
        const sameStatus =
            current.statusFilters.length === saved.statusFilters.length &&
            current.statusFilters.every(v => saved.statusFilters.includes(v));

        // השווה searchTerm
        const sameSearch = (current.searchTerm || '') === (saved.searchTerm || '');
        return !(sameSeverity && sameStatus && sameSearch);
    }

    // קריאה אחרי כל שינוי ידני
    checkAndClearIfModified() {
        if (!this.activeFilterId) return;

        if (this._isFilterModified()) {
            // הסינון שונה - בטל אינדיקציה בלבד (אל תאפס את הסינונים!)
            this.activeFilterId = null;
            localStorage.removeItem('alertsActiveFilterId');
            localStorage.removeItem('alertsActiveFilterCache');
            this._previousFiltersSnapshot = null;

            this._updateActiveIndication();
            this._updateClearButtonVisibility();
        }
    }

    async _handleSave(panel) {
        const nameInput = panel.querySelector('#sfpFilterName');
        const isGlobalCheckbox = panel.querySelector('#sfpIsGlobal');

        const name = nameInput?.value?.trim();
        if (!name) {
            nameInput?.classList.add('sfp-input-error');
            nameInput?.focus();
            setTimeout(() => nameInput?.classList.remove('sfp-input-error'), 2000);
            return;
        }

        const isGlobal = isGlobalCheckbox?.checked || false;

        try {
            const saveBtn = panel.querySelector('#sfpSaveBtn');
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            }

            await this.saveCurrentFilters(name, isGlobal);

            // רנדר מחדש
            panel.remove();
            this.openSavedFiltersPanel();

            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    `הסינון "${name}" נשמר בהצלחה`,
                    'success'
                );
            }
        } catch (error) {
            console.error('Error saving filter:', error);
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show(
                    `שגיאה בשמירת הסינון: ${error.message}`,
                    'error'
                );
            }
        }
    }

    // ==========================================
    // CSS
    // ==========================================

    injectStyles() {
        if (document.getElementById('savedFiltersStyles')) return;

        const style = document.createElement('style');
        style.id = 'savedFiltersStyles';
        style.textContent = `
            /* ===== כפתור סינונים שמורים ===== */
            .saved-filters-btn {
                background: linear-gradient(135deg, #27ae60, #1e8449);
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 600;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
            }
            .saved-filters-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(39, 174, 96, 0.4);
            }
            .saved-filters-btn.has-filters {
                border-color: #a78bfa;
                color: #a78bfa;
            }

            .dashboard-header .saved-filters-btn {
               background: linear-gradient(135deg, #9b59b6, #8e44ad);
            }

            .dashboard-header .saved-filters-btn:hover {
                box-shadow: 0 0px 0px rgba(39, 174, 96, 0.4);
            }
            /* ===== פאנל ===== */
            .saved-filters-panel {
                background: #1e1e1e;
                border: 1px solid #444;
                border-radius: 10px;
                width: 440px;
                max-height: 80vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5);
                z-index: 10001;
                direction: rtl;
                animation: sfpSlideIn 0.15s ease;
            }
            @keyframes sfpSlideIn {
                from { opacity: 0; transform: translateY(-8px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            /* Header */
            .sfp-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid #333;
                background: #2c2c2c;
                border-radius: 10px 10px 0 0;
            }
            .sfp-title {
                font-weight: bold;
                color: #e0e0e0;
                font-size: 0.95rem;
                display: flex;
                align-items: center;
                gap: 7px;
            }
            .sfp-title i { color: #a78bfa; }
            .sfp-close-btn {
                background: none;
                border: none;
                color: #888;
                cursor: pointer;
                font-size: 1rem;
                padding: 2px 6px;
                border-radius: 4px;
                transition: all 0.2s;
            }
            .sfp-close-btn:hover { color: #fff; background: #444; }

            /* Save section */
            .sfp-save-section {
                padding: 12px 16px;
                border-bottom: 1px solid #333;
                background: #252525;
            }
            .sfp-save-row {
                display: flex;
                gap: 8px;
                align-items: center;
                margin-bottom: 8px;
            }
            .sfp-name-input {
                flex: 1;
                background: #1e1e1e;
                border: 1px solid #555;
                border-radius: 6px;
                color: #e0e0e0;
                padding: 7px 10px;
                font-size: 0.88rem;
                outline: none;
                transition: border-color 0.2s;
            }
            .sfp-name-input:focus { border-color: #7c3aed; }
            .sfp-name-input.sfp-input-error {
                border-color: #f87171;
                animation: sfpShake 0.3s ease;
            }
            @keyframes sfpShake {
                0%,100% { transform: translateX(0); }
                25%      { transform: translateX(-4px); }
                75%      { transform: translateX(4px); }
            }
            .sfp-global-label {
                display: flex;
                align-items: center;
                gap: 4px;
                cursor: pointer;
                color: #888;
                font-size: 1rem;
                padding: 4px 8px;
                border-radius: 4px;
                border: 1px solid #444;
                transition: all 0.2s;
                user-select: none;
            }
            .sfp-global-label:hover {
                background: rgba(124,58,237,0.2);
                border-color: #7c3aed;
                color: #a78bfa;
            }
            .sfp-global-label input { display: none; }
            .sfp-global-label:has(input:checked) {
                background: rgba(124,58,237,0.25);
                border-color: #7c3aed;
                color: #a78bfa;
                box-shadow: 0 0 0 2px rgba(124,58,237,0.3);
            }
            .sfp-save-btn {
                background: #7c3aed;
                border: none;
                color: white;
                border-radius: 6px;
                padding: 7px 12px;
                cursor: pointer;
                font-size: 0.9rem;
                transition: background 0.2s;
                white-space: nowrap;
            }
            .sfp-save-btn:hover { background: #6d28d9; }
            .sfp-save-btn:disabled {
                background: #444;
                cursor: not-allowed;
            }

            /* Preview */
            .sfp-current-preview {
                font-size: 0.8rem;
            }
            .sfp-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            }
            .sfp-tag {
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 0.75rem;
                font-weight: 500;
            }
            .sfp-tag-severity {
                background: rgba(239,68,68,0.2);
                color: #fca5a5;
                border: 1px solid rgba(239,68,68,0.3);
            }
            .sfp-tag-status {
                background: rgba(59,130,246,0.2);
                color: #93c5fd;
                border: 1px solid rgba(59,130,246,0.3);
            }
            .sfp-tag-search {
                background: rgba(124,58,237,0.2);
                color: #c4b5fd;
                border: 1px solid rgba(124,58,237,0.3);
            }
            .sfp-no-filters {
                color: #666;
                font-size: 0.78rem;
                font-style: italic;
            }

            /* List section */
            .sfp-list-section {
                overflow-y: auto;
                flex: 1;
                padding: 8px 0;
            }
            .sfp-group-label {
                padding: 6px 16px 4px;
                font-size: 0.75rem;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .sfp-empty {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 30px 20px;
                color: #555;
                font-size: 0.85rem;
            }
            .sfp-empty i { font-size: 1.5rem; }

            /* Filter item */
            .sfp-item {
                padding: 8px 16px;
                cursor: pointer;
                transition: background 0.15s;
                border-bottom: 1px solid #2a2a2a;
            }
            .sfp-item:hover { background: #2c2c2c; }
            .sfp-item:last-child { border-bottom: none; }
            .sfp-item-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 4px;
            }
            .sfp-item-name {
                font-size: 0.88rem;
                color: #e0e0e0;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 380px;
            }
            .sfp-item-actions {
                display: flex;
                gap: 5px;
                opacity: 0;
                transition: opacity 0.2s;
            }
            .sfp-item:hover .sfp-item-actions { opacity: 1; }
            .sfp-apply-btn,
            .sfp-delete-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 3px 6px;
                border-radius: 4px;
                font-size: 0.8rem;
                transition: all 0.2s;
            }
            .sfp-apply-btn {
                color: #86efac;
            }
            .sfp-apply-btn:hover {
                background: rgba(134,239,172,0.15);
                color: #4ade80;
            }
            .sfp-delete-btn {
                color: #f87171;
            }
            .sfp-delete-btn:hover {
                background: rgba(248,113,113,0.15);
                color: #ef4444;
            }
            .sfp-item-preview {
                margin-bottom: 4px;
            }
            .sfp-item-meta {
                display: flex;
                justify-content: space-between;
                font-size: 0.72rem;
                color: #666;
            }
            .alerts-container:not(.fullscreen-mode) .saved-filters-panel {
                background: #fff;
                border: 1px solid #ddd;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            }
            .alerts-container:not(.fullscreen-mode) .sfp-header {
                background: #f8f9fa;
                border-bottom: 1px solid #eee;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-title {
                color: #333;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-save-section {
                background: #fafafa;
                border-bottom: 1px solid #eee;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-name-input {
                background: #fff;
                border-color: #ccc;
                color: #333;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-item {
                border-bottom: 1px solid #f0f0f0;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-item:hover {
                background: #f8f9fa;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-item-name {
                color: #333;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-group-label {
                color: #999;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-tag-severity {
                background: rgba(220,53,69,0.1);
                color: #dc3545;
                border-color: rgba(220,53,69,0.2);
            }
            .alerts-container:not(.fullscreen-mode) .sfp-tag-status {
                background: rgba(0,123,255,0.1);
                color: #007bff;
                border-color: rgba(0,123,255,0.2);
            }
            .alerts-container:not(.fullscreen-mode) .sfp-tag-search {
                background: rgba(102,16,242,0.1);
                color: #6610f2;
                border-color: rgba(102,16,242,0.2);
            }
            .alerts-container:not(.fullscreen-mode) .sfp-no-filters {
                color: #aaa;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-empty {
                color: #aaa;
            }
            .alerts-container:not(.fullscreen-mode) .sfp-item-meta {
                color: #aaa;
            }
            .saved-filters-btn.has-active-filter {
                position: relative;
                box-shadow: 0 0 0 2px rgba(39, 174, 96, 0.6);
            }
            .sfp-edit-btn {
                background: none;
                border: none;
                cursor: pointer;
                padding: 3px 6px;
                border-radius: 4px;
                font-size: 0.8rem;
                transition: all 0.2s;
                color: #93c5fd;
            }
            .sfp-edit-btn:hover {
                background: rgba(147,197,253,0.15);
                color: #60a5fa;
            }
            /* ===== כפתור ניקוי סינון - תמיד נראה, מאופרר כשאין סינון ===== */
            .clear-active-filter-btn {
                background: linear-gradient(135deg, #e74c3c, #c0392b);
                color: white;
                border: none;
                padding: 10px 16px;
                border-radius: 8px;
                cursor: pointer;
                font-size: 0.9rem;
                font-weight: 600;
                transition: all 0.3s ease;
                display: flex;   /* תמיד נראה */
                align-items: center;
                gap: 4px;
                opacity: 0.35;              /* מאופרר כברירת מחדל */
                pointer-events: none;       /* לא לחיץ כשמאופרר */
            }
            .clear-active-filter-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(231, 76, 60, 0.4);
            }
            .clear-active-filter-btn.is-active {
                opacity: 1;
                pointer-events: auto;
                cursor: pointer;
            }

            .clear-active-filter-btn.is-active:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(231, 76, 60, 0.4);
            }
            .clear-x-icon {
                font-size: 0.75rem;
                margin-right: 2px;
            }
            /* ===== אינדיקציה לסינון פעיל בפאנל ===== */
            .sfp-item-active {
                background: rgba(124, 58, 237, 0.12) !important;
                border-right: 3px solid #7c3aed;
            }

            .sfp-item-active:hover {
                background: rgba(124, 58, 237, 0.2) !important;
            }

            .sfp-item-name-row {
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
                min-width: 0;
            }

            .sfp-active-badge {
                display: inline-flex;
                align-items: center;
                gap: 3px;
                background: rgba(124, 58, 237, 0.25);
                color: #a78bfa;
                border: 1px solid rgba(124, 58, 237, 0.4);
                border-radius: 10px;
                padding: 1px 7px;
                font-size: 0.7rem;
                font-weight: 600;
                white-space: nowrap;
                flex-shrink: 0;
            }

            /* כפתור עם סינון פעיל - גדול יותר מעט */
            .saved-filters-btn.has-active-filter {
                padding: 10px 12px;
                gap: 6px;
                display: flex;
                align-items: center;
            }

            /* ===== Light mode overrides ===== */
            .alerts-container:not(.fullscreen-mode) .sfp-item-active {
                background: rgba(124, 58, 237, 0.08) !important;
                border-right: 3px solid #7c3aed;
            }

            .alerts-container:not(.fullscreen-mode) .sfp-active-badge {
                background: rgba(124, 58, 237, 0.12);
                color: #6d28d9;
                border-color: rgba(124, 58, 237, 0.25);
            }

            .saved-filters-btn.filter-modified {
                opacity: 0.6;
                box-shadow: none;
            }

            .saved-filters-btn.filter-modified::after {
                background: #f39c12; /* כתום במקום ירוק */
            }

            /* ===== כפתור הוספת סינון חדש ===== */
            .sfp-add-new-btn {
                width: 100%;
                background: linear-gradient(135deg, #7c3aed, #6d28d9);
                color: white;
                border: none;
                border-radius: 8px;
                padding: 9px 14px;
                font-size: 0.88rem;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 7px;
                margin-bottom: 8px;
                transition: all 0.2s;
            }
            .sfp-add-new-btn:hover {
                background: linear-gradient(135deg, #6d28d9, #5b21b6);
                transform: translateY(-1px);
                box-shadow: 0 4px 14px rgba(124,58,237,0.4);
            }

            /* ===== צ'קבוקס ויזואלי בפאנל ===== */
            .sfp-checkbox-visual {
                width: 20px;
                height: 20px;
                min-width: 20px;
                border: 2px solid #555;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s;
                background: transparent;
                color: transparent;
                font-size: 0.7rem;
            }

            .sfp-checkbox-visual:hover {
                border-color: #7c3aed;
                background: rgba(124, 58, 237, 0.1);
            }

            .sfp-checkbox-visual.sfp-checkbox-checked {
                background: #7c3aed;
                border-color: #7c3aed;
                color: white;
            }
            /* ===== Dot על הכפתור ===== */
            .saved-filters-btn {
                position: relative; /* חשוב ל-dot */
            }

            .sfp-active-dot {
                position: absolute;
                top: 5px;
                right: 5px;
                width: 9px;
                height: 9px;
                background: #2ecc71;
                border-radius: 50%;
                border: 2px solid white;
            }

            .saved-filters-btn.has-active-filter {
                box-shadow: 0 0 0 2px rgba(39, 174, 96, 0.5);
            }

            /* ===== Banner סינון פעיל ===== */
            .sfp-active-banner {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 14px;
                background: linear-gradient(135deg,
                    rgba(124, 58, 237, 0.12),
                    rgba(109, 40, 217, 0.08));
                border: 1px solid rgba(124, 58, 237, 0.3);
                border-radius: 6px;
                margin: 4px 0 6px 0;
                font-size: 0.82rem;
                direction: rtl;
                animation: sfpBannerIn 0.2s ease;
            }

            @keyframes sfpBannerIn {
                from { opacity: 0; transform: translateY(-4px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            .sfp-banner-icon {
                color: #7c3aed;
                font-size: 0.8rem;
                flex-shrink: 0;
            }

            .sfp-banner-label {
                color: #888;
                font-weight: 500;
                flex-shrink: 0;
            }

            .sfp-banner-name {
                color: #a78bfa;
                font-weight: 700;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                max-width: 200px;
            }

            .sfp-banner-clear {
                background: none;
                border: none;
                color: #888;
                cursor: pointer;
                padding: 2px 5px;
                border-radius: 4px;
                font-size: 0.75rem;
                transition: all 0.2s;
                flex-shrink: 0;
                margin-right: auto;
            }

            .sfp-banner-clear:hover {
                background: rgba(239, 68, 68, 0.15);
                color: #f87171;
            }

            /* Light mode */
            .alerts-container:not(.fullscreen-mode) .sfp-active-banner {
                background: linear-gradient(135deg,
                    rgba(124, 58, 237, 0.07),
                    rgba(109, 40, 217, 0.04));
                border-color: rgba(124, 58, 237, 0.2);
            }

            .alerts-container:not(.fullscreen-mode) .sfp-banner-label {
                color: #666;
            }

            .alerts-container:not(.fullscreen-mode) .sfp-banner-name {
                color: #6d28d9;
            }
        `;
        document.head.appendChild(style);
    }
}