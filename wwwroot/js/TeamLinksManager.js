// Team Links Manager
class TeamLinksManager {
    constructor() {
        this.links = [];
        this.filteredLinks = [];
        this.filters = {
            search: '',
            category: ''
        };
        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;

        // מיפוי קטגוריות לאייקונים רלוונטיים
        this.categoryIcons = {
            'מערכות': [
                'fas fa-link',
                'fas fa-globe',
                'fas fa-server',
                'fas fa-database',
                'fas fa-network-wired',
                'fas fa-sitemap',
                'fas fa-desktop',
                'fas fa-laptop-code',
                'fas fa-cogs'
            ],
            'כלים': [
                'fas fa-link',
                'fas fa-tools',
                'fas fa-wrench',
                'fas fa-laptop-code',
                'fas fa-cogs',
                'fas fa-hammer'
            ],
            'מסמכים': [
                'fas fa-link',
                'fas fa-file-alt',
                'fas fa-file-pdf',
                'fas fa-file-word',
                'fas fa-file-excel',
                'fas fa-folder',
                'fas fa-book'
            ],
            'דשבורדים': [
                'fas fa-link',
                'fas fa-chart-bar',
                'fas fa-tachometer-alt',
                'fas fa-chart-line',
                'fas fa-chart-pie',
                'fas fa-analytics',
                'fas fa-chart-area'
            ],
            'אחר': [
                'fas fa-link',
                'fas fa-globe',
                'fas fa-shield-alt',
                'fas fa-home',
                'fas fa-chart-bar',
                'fas fa-calendar',
                'fas fa-envelope',
                'fas fa-users',
                'fas fa-headset'
            ]
        };

        // אייקונים ברירת מחדל לכל קטגוריה
        this.defaultCategoryIcon = {
            'מערכות': 'fas fa-server',
            'כלים': 'fas fa-tools',
            'מסמכים': 'fas fa-file-alt',
            'דשבורדים': 'fas fa-chart-bar',
            'אחר': 'fas fa-link'
        };

        // כל האייקונים האפשריים
        this.allIcons = [
            { value: 'fas fa-link', label: 'קישור' },
            { value: 'fas fa-globe', label: 'אתר' },
            { value: 'fas fa-shield-alt', label: 'אבטחה' },
            { value: 'fas fa-home', label: 'בית' },
            { value: 'fas fa-chart-bar', label: 'גרפים' },
            { value: 'fas fa-cogs', label: 'הגדרות' },
            { value: 'fas fa-calendar', label: 'לוח שנה' },
            { value: 'fas fa-laptop-code', label: 'לפטופ' },
            { value: 'fas fa-database', label: 'מסד נתונים' },
            { value: 'fas fa-file-alt', label: 'מסמך' },
            { value: 'fas fa-desktop', label: 'מחשב שולחני' },
            { value: 'fas fa-envelope', label: 'מייל' },
            { value: 'fas fa-sitemap', label: 'מבנה מערכת' },
            { value: 'fas fa-network-wired', label: 'רשת מחשבים' },
            { value: 'fas fa-server', label: 'שרת' },
            { value: 'fas fa-tablet-alt', label: 'טאבלט' },
            { value: 'fas fa-mobile-alt', label: 'טלפון נייד' },
            { value: 'fas fa-tools', label: 'כלים' },
            { value: 'fas fa-users', label: 'צוות' },
            { value: 'fas fa-tachometer-alt', label: 'דשבורד' },
            { value: 'fas fa-chart-line', label: 'גרף קו' },
            { value: 'fas fa-chart-pie', label: 'גרף עוגה' },
            { value: 'fas fa-headset', label: 'תמיכה' }
        ];
    }

    // Load links from server
    async loadLinks() {
        try {
            const response = await fetch('/TeamLinks/GetTeamLinks');
            const data = await response.json();

            if (data.error) {
                console.error('Error loading links:', data.error);
                this.links = [];
            } else {
                this.links = data;
                this.filteredLinks = [...data]; // Initialize filtered links
            }

            this.renderLinks();
            this.populateCategoryFilter(); // Populate category filter dropdown
        } catch (error) {
            console.error('Error loading links:', error);
            this.links = [];
            this.filteredLinks = [];
            this.renderLinks();
        }
    }

    // Populate category filter dropdown
    populateCategoryFilter() {
        const categorySelect = document.getElementById('filterCategory');
        if (!categorySelect) return;

        // Get unique categories - filter out null and empty strings properly
        const categories = [...new Set(this.links
            .map(link => link.category)
            .filter(category => category && category.trim() !== '')
        )];

        // Sort categories alphabetically
        categories.sort((a, b) => a.localeCompare(b, 'he'));

        // Clear existing options
        categorySelect.innerHTML = '<option value="">כל הקטגוריות</option>';

        // Add category options
        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            categorySelect.appendChild(option);
        });
    }

    // Setup search and filter listeners
    setupFilterTabs() {
        // Create filter tabs HTML structure
        const filtersContainer = document.getElementById('teamLinksFiltersContent');
        if (!filtersContainer) return;

        filtersContainer.innerHTML = `
        <div class="category-filters-row">
            <span class="filter-label">קטגוריה:</span>
            <div class="filter-tab links-category-filter-tab active" data-category="">הכל</div>
            <div class="filter-tab links-category-filter-tab" data-category="מערכות">מערכות</div>
            <div class="filter-tab links-category-filter-tab" data-category="כלים">כלים</div>
            <div class="filter-tab links-category-filter-tab" data-category="מסמכים">מסמכים</div>
            <div class="filter-tab links-category-filter-tab" data-category="דשבורדים">דשבורדים</div>
            <div class="filter-tab links-category-filter-tab" data-category="אחר">אחר</div>
        </div>
    `;

        // Add event listeners to filter tabs
        document.querySelectorAll('.links-category-filter-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                // Remove active class from all tabs
                document.querySelectorAll('.links-category-filter-tab').forEach(t => t.classList.remove('active'));

                // Add active class to clicked tab
                e.currentTarget.classList.add('active');

                // Apply filter
                this.filters.category = e.currentTarget.getAttribute('data-category');
                this.applyFilters();
            });
            tab.addEventListener('dblclick', (e) => {
                const category = e.currentTarget.getAttribute('data-category');
                // פתח את המודל עם הקטגוריה שנבחרה (אם יש)
                if (category) {
                    this.openAddLinkModal(null, category);
                } else {
                    this.openAddLinkModal();
                }
            });
        });

        // Setup search input listener
        const searchInput = document.getElementById('teamLinksSearchInput');
        const clearSearchBtn = document.getElementById('teamLinksClearSearchBtn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value;

                // Show/hide clear button
                if (clearSearchBtn) {
                    clearSearchBtn.style.display = e.target.value.trim() !== '' ? 'flex' : 'none';
                }

                this.applyFilters();
            });
        }

        if (clearSearchBtn) {
            clearSearchBtn.addEventListener('click', () => {
                this.clearSearch();
            });
        }
    }

    // Clear search
    clearSearch() {
        const searchInput = document.getElementById('teamLinksSearchInput');
        const clearBtn = document.getElementById('teamLinksClearSearchBtn');

        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }

        if (clearBtn) {
            clearBtn.style.display = 'none';
        }

        // Reset search filter and reapply filters
        this.filters.search = '';
        this.applyFilters();
    }

    // Apply filters with category mapping
    applyFilters() {
        const searchTerm = this.filters.search.toLowerCase().trim();
        const categoryFilter = this.filters.category;

        // Define category mappings - add all variations that should match each filter tab
        const categoryMappings = {
            'מערכות': ['מערכות', 'מערכות ניטור', 'מערכות מידע', 'ניטור', 'תשתיות'],
            'כלים': ['כלים', 'כלי עבודה', 'כלי ניהול', 'כלי פיתוח'],
            'מסמכים': ['מסמכים', 'מסמכי תיעוד', 'תיעוד', 'נהלים', 'דוחות'],
            'דשבורדים': ['דשבורדים', 'לוחות מחוונים', 'גרפים', 'ניתוח נתונים', 'סטטיסטיקות'],
            'תקיות': ['תקיות', 'תיקיות', 'קבצים'],
            'אחר': ['אחר', 'שונות', 'כללי', 'גיבויים', 'אבטחת מידע', 'תמיכה']
        };

        this.filteredLinks = this.links.filter(link => {
            // Search filter
            const matchesSearch = !searchTerm ||
                link.title.toLowerCase().includes(searchTerm) ||
                (link.description && link.description.toLowerCase().includes(searchTerm)) ||
                (link.category && link.category.toLowerCase().includes(searchTerm)) ||
                link.url.toLowerCase().includes(searchTerm);

            // Category filter with mapping
            let matchesCategory = true;
            if (categoryFilter) {
                // If we have a mapping for this category filter
                if (categoryMappings[categoryFilter]) {
                    matchesCategory = link.category &&
                        categoryMappings[categoryFilter].some(mappedCategory =>
                            link.category.toLowerCase() === mappedCategory.toLowerCase());
                } else {
                    // Fallback to exact match if no mapping exists
                    matchesCategory = !categoryFilter || link.category === categoryFilter;
                }
            }

            return matchesSearch && matchesCategory;
        });

        this.renderLinks();
        this.updateActiveFiltersDisplay();
    }

    // Update active filters display
    updateActiveFiltersDisplay() {
        const display = document.getElementById('teamLinksActiveFiltersDisplay');
        if (!display) return;

        const filterTags = [];

        if (this.filters.search) {
            filterTags.push(`
                <div class="filter-tag" onclick="teamLinksManager.removeFilter('search')" title="לחץ להסרה">
                    <i class="fas fa-search"></i> חיפוש: "${this.escapeHtml(this.filters.search)}"
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.filters.category) {
            filterTags.push(`
                <div class="filter-tag" onclick="teamLinksManager.removeFilter('category')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> קטגוריה: ${this.escapeHtml(this.filters.category)}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (filterTags.length > 0) {
            display.innerHTML = `<div class="active-filters-tags">${filterTags.join('')}</div>`;
            display.style.display = 'block';
        } else {
            display.style.display = 'none';
        }

        // Update clear filters button visibility
        const clearBtn = document.getElementById('teamLinksClearFilters');
        if (clearBtn) {
            clearBtn.style.display = this.hasActiveFilters() ? 'inline-flex' : 'none';
        }
    }

    // Check if there are active filters
    hasActiveFilters() {
        return this.filters.search || this.filters.category;
    }

    // Remove filter
    removeFilter(filterType) {
        switch (filterType) {
            case 'search':
                this.filters.search = '';
                this.clearSearch();
                break;
            case 'category':
                this.filters.category = '';
                const categoryFilter = document.getElementById('filterCategory');
                if (categoryFilter) categoryFilter.value = '';

                // עדכון הלשוניות - הסרת הסימון מכל הלשוניות והוספת סימון ללשונית "הכל"
                document.querySelectorAll('.links-category-filter-tab').forEach(tab => {
                    tab.classList.remove('active');
                    if (tab.getAttribute('data-category') === '') {
                        tab.classList.add('active');
                    }
                });
        }

        this.applyFilters();

        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show('הסינון הוסר', 'info');
        }
    }

    // Clear all filters
    clearFilters() {
        this.filters = {
            search: '',
            category: ''
        };

        // Reset UI
        this.clearSearch();
        const categoryFilter = document.getElementById('filterCategory');
        if (categoryFilter) categoryFilter.value = '';

        // עדכון הלשוניות - הסרת הסימון מכל הלשוניות והוספת סימון ללשונית "הכל"
        document.querySelectorAll('.links-category-filter-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.getAttribute('data-category') === '') {
                tab.classList.add('active');
            }
        });

        this.applyFilters();
    }

    // Toggle filter section
    toggleFilterSection() {
        const content = document.getElementById('teamLinksFiltersContent');
        const btn = document.getElementById('teamLinksFiltersCollapseBtn');

        if (content && btn) {
            content.classList.toggle('collapsed');
            btn.classList.toggle('collapsed');

            if (content.classList.contains('collapsed')) {
                this.updateActiveFiltersDisplay();
            }

            localStorage.setItem('teamLinksFiltersSectionCollapsed', content.classList.contains('collapsed'));
        }
    }

    // Restore filter section collapsed state
    restoreFilterSectionState() {
        const filtersCollapsed = localStorage.getItem('teamLinksFiltersSectionCollapsed');
        const content = document.getElementById('teamLinksFiltersContent');
        const btn = document.getElementById('teamLinksFiltersCollapseBtn');

        if (filtersCollapsed === 'true' || filtersCollapsed == null) {
            if (content) content.classList.add('collapsed');
            if (btn) btn.classList.add('collapsed');
        }
    }

    // Initialize filters
    initialize() {
        this.loadLinks(); // Load links first
        this.setupFilterTabs();
        this.restoreFilterSectionState();
        this.updateActiveFiltersDisplay();
        this.startAutoRefresh();
    }

    // Render links in container
    renderLinks() {
        const container = document.getElementById('teamLinksContainer');

        if (!this.filteredLinks || this.filteredLinks.length === 0) {
            container.innerHTML = `
            <div class="team-links-empty">
                <i class="fas fa-link"></i><br>
                ${this.hasActiveFilters() ? 'לא נמצאו קישורים התואמים לחיפוש' : 'אין קישורים שמורים. לחץ על "הוסף קישור חדש" כדי להוסיף קישור.'}
            </div>
        `;
            return;
        }

        let html = '<div class="team-links-grid">';

        this.filteredLinks.forEach((link) => {
            html += `
        <div class="team-link-card">
            <div class="team-link-content">
                <h3 class="team-link-title">
                    <i class="${link.icon || 'fas fa-link'}"></i>
                    ${link.title}
                </h3>
                <p class="team-link-description">${link.description || ''}</p>
                ${link.category ? `<span class="team-link-category">${link.category}</span>` : ''}
            </div>
            <div class="team-link-actions">
                <button class="team-link-copy-btn" onclick="teamLinksManager.copyLink('${link.url}'); event.stopPropagation(); event.preventDefault(); return false;" title="העתק קישור" style="position: relative; z-index: 10;">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="team-link-edit-btn" onclick="teamLinksManager.editLink(${link.id}); event.stopPropagation(); event.preventDefault(); return false;" title="ערוך קישור" style="position: relative; z-index: 10;">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="team-link-delete-btn" onclick="teamLinksManager.deleteLink(${link.id}); event.stopPropagation(); event.preventDefault(); return false;" title="מחק קישור" style="position: relative; z-index: 10;">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <a href="${link.url}" target="_blank" class="team-link-overlay" title="פתח קישור: ${link.title}" aria-label="${link.title}"></a>
        </div>
    `;
        });

        html += '</div>';
        container.innerHTML = html;
    }

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // פונקציה להעתקת קישור
    copyLink(url) {
        navigator.clipboard.writeText(url).then(() => {
            // הצג הודעת הצלחה
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('הקישור הועתק ללוח', 'success');
            } else {
                alert('הקישור הועתק ללוח');
            }
        }).catch(err => {
            console.error('שגיאה בהעתקת הקישור:', err);
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('שגיאה בהעתקת הקישור', 'error');
            } else {
                alert('שגיאה בהעתקת הקישור');
            }
        });
    }

    // Open add/edit link modal
    openAddLinkModal(linkId = null, selectedCategory = null) {
        this.isModalOpen = true; // סמן שהמודל פתוח
        const isEdit = linkId !== null;
        const link = isEdit ? this.links.find(l => l.id === linkId) : { title: '', url: '', description: '', icon: 'fas fa-link', category: selectedCategory || '' };

        if (isEdit && !link) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('הקישור לא נמצא', 'error');
            } else {
                alert('הקישור לא נמצא');
            }
            return;
        }

        // Create modal if it doesn't exist
        if (!document.getElementById('addLinkModal')) {
            const modalHTML = `
                <div id="addLinkModal" class="add-link-modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h3 id="linkModalTitle">הוסף קישור חדש</h3>
                            <button class="modal-close" onclick="teamLinksManager.closeAddLinkModal()">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="modal-body">
                            <form id="addLinkForm">
                                <input type="hidden" id="linkId" value="">
                                
                                <div class="form-group">
                                    <label class="form-label">כותרת *</label>
                                    <input type="text" id="linkTitle" class="form-input" required>
                                </div>
                                
                                <div class="form-group">
                                    <label class="form-label">כתובת URL *</label>
                                    <input type="url" id="linkUrl" class="form-input" required>
                                    <small class="form-help">לדוגמה: https://www.example.com</small>
                                </div>
                                
                                <div class="form-group">
                                    <label class="form-label">תיאור</label>
                                    <input type="text" id="linkDescription" class="form-input">
                                </div>
                                
                                <div class="form-group">
                                    <label class="form-label">קטגוריה</label>
                                    <select id="linkCategory" class="form-select">
                                        <option value="">בחר קטגוריה</option>
                                        <option value="מערכות"></option>
                                        <option value="כלים"></option>
                                        <option value="מסמכים"></option>
                                        <option value="דשבורדים">דשבורדים</option>
                                        <option value="אחר"></option>
                                    </select>
                                    <small class="form-help">בחר קטגוריה קיימת</small>
                                </div>
                                
                                <div class="form-group">
                                    <label class="form-label">אייקון</label>
                                    <select id="linkIcon" class="form-select">
                                        <option value="fas fa-link">קישור</option>
                                    </select>
                                </div>
                            </form>
                        </div>
                        <div class="modal-footer">
                            <button class="btn-secondary" onclick="teamLinksManager.closeAddLinkModal()">ביטול</button>
                            <button class="btn-primary" onclick="teamLinksManager.saveLink()">שמור</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Load categories for datalist
            this.loadCategories();
        }

        // Update modal content
        document.getElementById('linkModalTitle').textContent = isEdit ? 'ערוך קישור' : 'הוסף קישור חדש';
        document.getElementById('linkId').value = isEdit ? link.id : '';
        document.getElementById('linkTitle').value = link.title || '';
        document.getElementById('linkUrl').value = link.url || '';
        document.getElementById('linkDescription').value = link.description || '';
        document.getElementById('linkCategory').value = link.category || '';

        // עדכן את רשימת האייקונים לפי הקטגוריה שנבחרה
        this.updateIconsForCategory(link.category);

        // הגדר את האייקון הנבחר אם קיים
        if (isEdit && link.icon) {
            setTimeout(() => {
                const iconSelect = document.getElementById('linkIcon');
                if (iconSelect) {
                    iconSelect.value = link.icon;
                    this.showSelectedIcon();
                }
            }, 100);
        } else {
            const iconSelect = document.getElementById('linkIcon');
            if (iconSelect) {
                // אחרת השתמש באייקון קישור כברירת מחדל
                iconSelect.value = 'fas fa-link';
                this.showSelectedIcon();
            }
        }

        // הוסף מאזין אירועים לשינוי קטגוריה
        const categorySelect = document.getElementById('linkCategory');
        categorySelect.addEventListener('change', (e) => {
            this.updateIconsForCategory(e.target.value);
        });

        // Show modal
        document.getElementById('addLinkModal').style.display = 'flex';
        // הוסף מאזין אירועים לשינוי האייקון
        const iconSelect = document.getElementById('linkIcon');
        iconSelect.addEventListener('change', () => this.showSelectedIcon());
    }

    showSelectedIcon() {
        const iconSelect = document.getElementById('linkIcon');
        const selectedIcon = iconSelect.value;

        // מצא את האלמנט שמציג את האייקון הנבחר
        const iconPreview = document.getElementById('selectedIconPreview');
        if (!iconPreview) {
            // אם אין אלמנט תצוגה מקדימה, צור אחד
            const previewContainer = document.createElement('div');
            previewContainer.className = 'selected-icon-container';
            previewContainer.innerHTML = `
            <div id="selectedIconPreview" class="selected-icon-preview">
                <i class="${selectedIcon}"></i>
                <span>האייקון הנבחר</span>
            </div>
        `;

            // הוסף את התצוגה המקדימה אחרי ה-select
            iconSelect.parentNode.insertBefore(previewContainer, iconSelect.nextSibling);
        } else {
            // עדכן את האייקון הקיים
            const iconElement = iconPreview.querySelector('i');
            iconElement.className = selectedIcon;
        }
    }

    // Load categories for select
    async loadCategories() {
        try {
            const response = await fetch('/TeamLinks/GetCategories');
            const data = await response.json();

            // הוסף את הקטגוריות הבסיסיות שיש להן מיפוי אייקונים
            const defaultCategories = Object.keys(this.categoryIcons);

            const categorySelect = document.getElementById('linkCategory');
            if (!categorySelect) return;

            // שמור רק את האופציה הראשונה (בחר קטגוריה)
            categorySelect.innerHTML = '<option value="">בחר קטגוריה</option>';

            // מיין את הקטגוריות לפי סדר אלפביתי
            defaultCategories.sort((a, b) => a.localeCompare(b, 'he'));

            // הוסף את הקטגוריות לרשימה
            defaultCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading categories:', error);

            // במקרה של שגיאה, טען קטגוריות ברירת מחדל
            const defaultCategories = Object.keys(this.categoryIcons);

            const categorySelect = document.getElementById('linkCategory');
            if (!categorySelect) return;

            // שמור רק את האופציה הראשונה (בחר קטגוריה)
            categorySelect.innerHTML = '<option value="">בחר קטגוריה</option>';

            // מיין את הקטגוריות לפי סדר אלפביתי
            defaultCategories.sort((a, b) => a.localeCompare(b, 'he'));

            // הוסף את הקטגוריות לרשימה
            defaultCategories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
        }
    }

    // פונקציה לעדכון רשימת האייקונים לפי הקטגוריה שנבחרה
    updateIconsForCategory(category) {
        const iconSelect = document.getElementById('linkIcon');
        if (!iconSelect) return;

        // שמור את האייקון הנוכחי שנבחר (אם יש)
        const currentSelectedIcon = iconSelect.value;

        // נקה את הרשימה הנוכחית
        iconSelect.innerHTML = '';

        // קבע אילו אייקונים להציג
        let iconsToShow = [];

        if (category && this.categoryIcons[category]) {
            // אם נבחרה קטגוריה וקיימים אייקונים ספציפיים לה
            const categoryIconValues = this.categoryIcons[category];
            iconsToShow = this.allIcons.filter(icon => categoryIconValues.includes(icon.value));
        } else {
            // אחרת הצג את כל האייקונים
            iconsToShow = this.allIcons;
        }

        // הוסף את האייקונים לרשימה
        iconsToShow.forEach(icon => {
            const option = document.createElement('option');
            option.value = icon.value;
            option.textContent = icon.label;
            iconSelect.appendChild(option);
        });

        // נסה לשחזר את הבחירה הקודמת
        if (currentSelectedIcon && iconsToShow.some(icon => icon.value === currentSelectedIcon)) {
            iconSelect.value = currentSelectedIcon;
        } else if (category && this.defaultCategoryIcon[category]) {
            // אם לא ניתן לשחזר, השתמש באייקון ברירת מחדל של הקטגוריה
            iconSelect.value = this.defaultCategoryIcon[category];
        } else {
            // אחרת השתמש באייקון קישור כברירת מחדל
            iconSelect.value = 'fas fa-link';
        }

        // עדכן את התצוגה המקדימה של האייקון
        this.showSelectedIcon();
    }

    // Close add/edit link modal
    closeAddLinkModal() {
        this.isModalOpen = false; // סמן שהמודל סגור
        document.getElementById('addLinkModal').style.display = 'none';
    }

    // Save link
    async saveLink() {
        const form = document.getElementById('addLinkForm');

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const linkId = document.getElementById('linkId').value;
        const category = document.getElementById('linkCategory').value;
        const selectedIcon = document.getElementById('linkIcon').value;

        // אם לא נבחר אייקון, קבע אייקון ברירת מחדל לפי הקטגוריה
        const icon = selectedIcon || (this.categoryIconMapping[category] || 'fas fa-link');

        const link = {
            title: document.getElementById('linkTitle').value,
            url: document.getElementById('linkUrl').value,
            description: document.getElementById('linkDescription').value,
            category: category,
            icon: icon
        };

        try {
            let response;

            if (linkId === '') {
                // Add new link
                response = await fetch('/TeamLinks/AddLink', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(link)
                });
            } else {
                // Update existing link
                link.id = parseInt(linkId);
                response = await fetch('/TeamLinks/UpdateLink', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(link)
                });
            }

            const result = await response.json();

            if (result.success) {
                // Show notification
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(result.message, 'success');
                } else {
                    alert(result.message);
                }

                this.closeAddLinkModal();

                // שמור את הפילטרים הנוכחיים
                const currentFilters = { ...this.filters };
                const hasFilters = this.hasActiveFilters();

                // טען מחדש את הקישורים
                await this.loadLinks();

                // החזר את הפילטרים אם היו פעילים
                if (hasFilters) {
                    this.filters = currentFilters;
                    this.applyFilters();
                }
            } else {
                // Show error
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(result.message, 'error');
                } else {
                    alert(result.message);
                }
            }
        } catch (error) {
            console.error('Error saving link:', error);

            // Show error
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('שגיאה בשמירת הקישור', 'error');
            } else {
                alert('שגיאה בשמירת הקישור');
            }
        }
    }

    // Edit link
    editLink(id) {
        this.openAddLinkModal(id);
    }

    // Delete link
    async deleteLink(id) {
        if (confirm('האם אתה בטוח שברצונך למחוק קישור זה?')) {
            try {
                // שמור את הפילטרים הנוכחיים
                const currentFilters = { ...this.filters };
                const hasFilters = this.hasActiveFilters();

                const response = await fetch('/TeamLinks/DeleteLink', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ id })
                });

                const result = await response.json();

                if (result.success) {
                    // Show notification
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(result.message, 'success');
                    } else {
                        alert(result.message);
                    }

                    // טען מחדש את הקישורים
                    await this.loadLinks();

                    // החזר את הפילטרים אם היו פעילים
                    if (hasFilters) {
                        this.filters = currentFilters;
                        this.applyFilters();
                    }
                } else {
                    // Show error
                    if (typeof NotificationManager !== 'undefined') {
                        NotificationManager.show(result.message, 'error');
                    } else {
                        alert(result.message);
                    }
                }
            } catch (error) {
                console.error('Error deleting link:', error);

                // Show error
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('שגיאה במחיקת הקישור', 'error');
                } else {
                    alert('שגיאה במחיקת הקישור');
                }
            }
        }
    }

    // Auto refresh data
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            if (!this.isModalOpen) {
                // שמור את הפילטרים הנוכחיים
                const currentFilters = { ...this.filters };
                const hasFilters = this.hasActiveFilters();

                // טען מחדש את הקישורים
                await this.loadLinks();

                // החזר את הפילטרים
                this.filters = currentFilters;

                // החל מחדש את הפילטרים אם היו פעילים
                if (hasFilters) {
                    this.applyFilters();
                }
            }
        }, this.AUTO_REFRESH_MINUTES * 60 * 1000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// Initialize team links manager
const teamLinksManager = new TeamLinksManager();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        teamLinksManager.initialize();
    });
} else {
    teamLinksManager.initialize();
}