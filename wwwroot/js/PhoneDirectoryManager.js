// PhoneDirectoryManager.js - Enhanced with CRUD operations
class PhoneDirectoryManager {
    constructor() {
        this.phoneData = [];
        this.filteredData = [];
        this.editingContactId = null;
        this.currentPage = 1;
        this.itemsPerPage = 10;
        this.filters = {
            search: '',
            domain: '',
            department: '',
            team: ''
        };
        this.currentSort = 'default';

        // Column visibility settings
        this.visibleColumns = {
            fullName: true,    // Always visible (disabled checkbox)
            role: true,
            domain: true,
            department: true,
            team: true,
            phone: true,
            extension: true,
            email: true,
            division:   false,
            actions: true      // Always visible (disabled checkbox)
        };

        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;
        this.activeTab = 'all';
        this.newUsersData = [];
        this.changedUsersData = [];
        this.duplicatesData = [];
    }

    async initialize() {
        this.loadColumnVisibility();
        await this.loadPhoneDirectory();
        this.setupSearchListener();
        this.setupFormListener();
        this.setupFilterListeners();
        this.setupColumnVisibilityListeners();
        this.restoreFilterSectionState();
        this.clearFilterButton();
        this.startAutoRefresh();
    }

    // Check if all columns are visible
    areAllColumnsVisible() {
        // Check all columns except fullName and actions (which are always visible)
        const editableColumns = ['role', 'domain', 'department', 'team', 'phone', 'extension', 'email'];
        return editableColumns.every(col => this.visibleColumns[col]);
    }

    // Update reset button visibility
    updateResetButtonVisibility() {
        const resetBtn = document.querySelector('.reset-columns-btn');
        if (resetBtn) {
            if (this.areAllColumnsVisible()) {
                resetBtn.style.display = 'none';
            } else {
                resetBtn.style.display = 'flex';
            }
        }
    }

    // Load column visibility from localStorage
    loadColumnVisibility() {
        const saved = userSettings.getItem('phoneDirectoryColumns');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // Merge with defaults, ensuring fullName and actions are always true
                this.visibleColumns = {
                    ...this.visibleColumns,
                    ...parsed,
                    fullName: true,
                    actions: true
                };
            } catch (e) {
                console.error('Error loading column visibility:', e);
            }
        }
        this.updateColumnCheckboxes();
        this.updateResetButtonVisibility();
    }

    // Save column visibility to localStorage
    saveColumnVisibility() {
        userSettings.setItem('phoneDirectoryColumns', JSON.stringify(this.visibleColumns));
    }

    // Update checkboxes based on current visibility settings
    updateColumnCheckboxes() {
        Object.keys(this.visibleColumns).forEach(col => {
            const checkbox = document.getElementById(`col-${col}`);
            if (checkbox) {
                checkbox.checked = this.visibleColumns[col];
            }
        });
    }

    // Setup listeners for column visibility checkboxes
    setupColumnVisibilityListeners() {
        const checkboxes = document.querySelectorAll('.column-checkboxes input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const columnName = e.target.id.replace('col-', '');
                this.visibleColumns[columnName] = e.target.checked;
                this.saveColumnVisibility();
                this.renderPhoneDirectory();
                this.updateResetButtonVisibility();

                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(
                        e.target.checked ? 'עמודה הוצגה' : 'עמודה הוסתרה',
                        'info'
                    );
                }
            });
        });
        // Initial check
        this.updateResetButtonVisibility();
    }

    // Reset columns to default (all visible)
    resetColumns() {
        this.visibleColumns = {
            fullName: true,
            role: true,
            domain: true,
            department: true,
            team: true,
            phone: true,
            extension: true,
            email: true,
            division:   false,
            actions: true
        };
        this.saveColumnVisibility();
        this.updateColumnCheckboxes();
        this.renderPhoneDirectory();
        this.updateResetButtonVisibility();

        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show('כל העמודות הוצגו', 'success');
        }
    }

    // Get column class for hiding
    getColumnClass(columnName) {
        return this.visibleColumns[columnName] ? '' : 'hidden-column';
    }

    // Restore filter section collapsed state
    restoreFilterSectionState() {
        const phoneFiltersCollapsed = userSettings.getItem('phoneFiltersSectionCollapsed');
        if (phoneFiltersCollapsed === 'true' || phoneFiltersCollapsed == null) {
            document.getElementById('phoneFiltersContent')?.classList.add('collapsed');
            document.getElementById('phoneFiltersCollapseBtn')?.classList.add('collapsed');
        }
    }

    toggleFilterSection() {
        const content = document.getElementById('phoneFiltersContent');
        const btn = document.getElementById('phoneFiltersCollapseBtn');

        content.classList.toggle('collapsed');
        btn.classList.toggle('collapsed');

        if (content.classList.contains('collapsed')) {
            this.updateActiveFiltersDisplay();
        }

        userSettings.setItem('phoneFiltersSectionCollapsed', content.classList.contains('collapsed'));
    }

    async loadPhoneDirectory() {
        try {
            const response = await fetch('/PhoneDirectory/GetPhoneDirectory');
            const data = await response.json();

            if (data.error) {
                console.error('Error loading phone directory:', data.error);
                this.showError();
                return;
            }

            this.phoneData = data;
            this.filteredData = data;
            this.currentPage = 1;
            this.populateFilterDropdowns();
            this.renderPhoneDirectory();
        } catch (error) {
            console.error('Error fetching phone directory:', error);
            this.showError();
        }
    }


    renderPhoneDirectory() {
        const container = document.getElementById('phoneDirectoryContainer');

        if (!this.filteredData || this.filteredData.length === 0) {
            container.innerHTML = `
            <div class="phone-directory-empty">
                <i class="fas fa-address-book"></i><br>
                <p>לא נמצאו אנשי קשר</p>
            </div>
        `;
            return;
        }

        // Calculate pagination
        const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const currentPageData = this.filteredData.slice(startIndex, endIndex);

        let tableHTML = `
        <div class="phone-directory-wrapper">
            <table class="phone-directory-table">
                <thead>
                    <tr>
                        <th class="${this.getColumnClass('fullName')}">שם מלא</th>
                        <th class="${this.getColumnClass('role')}">תפקיד</th>
                        <th class="${this.getColumnClass('division')}">אגף</th>
                        <th class="${this.getColumnClass('domain')}">תחום</th>
                        <th class="${this.getColumnClass('department')}">מחלקה</th>
                        <th class="${this.getColumnClass('team')}">צוות</th>
                        <th class="${this.getColumnClass('phone')}">טלפון</th>
                        <th class="${this.getColumnClass('extension')}">שלוחה</th>
                        <th class="${this.getColumnClass('email')}">מייל</th>
                        <th class="${this.getColumnClass('actions')}">פעולות</th>
                    </tr>
                </thead>
                <tbody>
    `;

        currentPageData.forEach((person, index) => {
            const contactId = person.id || (startIndex + index);

            const phoneDisplay = person.phoneNumber
                ? `<a href="tel:${person.phoneNumber}" class="phone-link">
                <i class="fas fa-phone"></i> ${this.formatPhoneNumber(person.phoneNumber)}
            </a>`
                : '';

            const extensionDisplay = person.extension
                ? `<a href="tel:${person.extension}" class="phone-link">
                    <i class="fas fa-phone"></i> ${this.escapeHtml(person.extension)}
                </a>`
                : '';

            const emailDisplay = person.email
                ? `<a href="mailto:${person.email}?cc=NOC@MENORAMIVT.CO.IL" class="email-link">
                    <i class="fas fa-envelope"></i>
                    <span>${this.escapeHtml(person.email)}</span>
                </a>`
                : '';

            tableHTML += `
            <tr ondblclick="phoneDirectoryManager.editContact(${contactId})">
                <td class="${this.getColumnClass('fullName')}">${this.escapeHtml(person.fullName)}</td>
                <td class="${this.getColumnClass('role')} employee-role">${this.escapeHtml(person.role || '')}</td>
                <td class="${this.getColumnClass('division')}">${this.escapeHtml(person.division || '')}</td>
                <td class="${this.getColumnClass('domain')}">${this.escapeHtml(person.domain || '')}</td>
                <td class="${this.getColumnClass('department')}">${this.escapeHtml(person.department || '')}</td>
                <td class="${this.getColumnClass('team')}">${this.escapeHtml(person.team || '')}</td>
                <td class="${this.getColumnClass('phone')} phone-number">${phoneDisplay}</td>
                <td class="${this.getColumnClass('extension')} extension-number">${extensionDisplay}</td>
                <td class="${this.getColumnClass('email')} email-cell" data-email="${this.escapeHtml(person.email || '')}">${emailDisplay}</td>
                <td class="${this.getColumnClass('actions')}">
                    <div class="contact-actions">
                        <button class="contact-action-btn edit" onclick="phoneDirectoryManager.editContact(${contactId})" title="ערוך">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="contact-action-btn delete" onclick="phoneDirectoryManager.deleteContact(${contactId})" title="מחק">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr >
                `;
        });

        tableHTML += `
            </tbody >
        </table >
        </div >
                `;

        // Add pagination controls
        if (totalPages > 1) {
            {
                tableHTML += this.renderPaginationControls(totalPages);
            }
        }

        container.innerHTML = tableHTML;
    }

    populateFilterDropdowns() {
        const options = this.getAvailableFilterOptions();

        const domainSelect = document.getElementById('filterDomain');
        const departmentSelect = document.getElementById('filterDepartment');
        const teamSelect = document.getElementById('filterTeam');

        const currentDomain = this.filters.domain;
        const currentDepartment = this.filters.department;
        const currentTeam = this.filters.team;

        // Helper function to create option element properly
        const createOption = (value, text, isSelected) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            if (isSelected) option.selected = true;
            return option;
        };

        // Update domains
        if (domainSelect) {
            domainSelect.innerHTML = '';
            domainSelect.appendChild(createOption('', 'הכל', false));
            options.domains.forEach(d => {
                domainSelect.appendChild(createOption(d, d, d === currentDomain));
            });
            // Keep current selection even if not in filtered list
            if (currentDomain && !options.domains.includes(currentDomain)) {
                domainSelect.appendChild(createOption(currentDomain, currentDomain, true));
            }
        }

        // Update departments
        if (departmentSelect) {
            departmentSelect.innerHTML = '';
            departmentSelect.appendChild(createOption('', 'הכל', false));
            options.departments.forEach(d => {
                departmentSelect.appendChild(createOption(d, d, d === currentDepartment));
            });
            // Keep current selection even if not in filtered list
            if (currentDepartment && !options.departments.includes(currentDepartment)) {
                departmentSelect.appendChild(createOption(currentDepartment, currentDepartment, true));
            }
        }

        // Update teams
        if (teamSelect) {
            teamSelect.innerHTML = '';
            teamSelect.appendChild(createOption('', 'הכל', false));
            options.teams.forEach(t => {
                teamSelect.appendChild(createOption(t, t, t === currentTeam));
            });
            // Keep current selection even if not in filtered list
            if (currentTeam && !options.teams.includes(currentTeam)) {
                teamSelect.appendChild(createOption(currentTeam, currentTeam, true));
            }
        }
    }

    setupFilterListeners() {
        const domainFilter = document.getElementById('filterDomain');
        const departmentFilter = document.getElementById('filterDepartment');
        const teamFilter = document.getElementById('filterTeam');

        if (domainFilter) {
            domainFilter.addEventListener('change', () => this.applyFilters());
        }

        if (departmentFilter) {
            departmentFilter.addEventListener('change', () => this.applyFilters());
        }

        if (teamFilter) {
            teamFilter.addEventListener('change', () => this.applyFilters());
        }
    }

    clearSearch() {
        const searchInput = document.getElementById('phoneDirectorySearchInput');
        const clearBtn = document.getElementById('phoneDirectoryClearSearchBtn');

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

    setupSearchListener() {
        const searchInput = document.getElementById('phoneDirectorySearchInput');
        const clearBtn = document.getElementById('phoneDirectoryClearSearchBtn');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filters.search = e.target.value;

                // Show/hide clear button
                if (clearBtn) {
                    clearBtn.style.display = e.target.value.trim() !== '' ? 'flex' : 'none';
                }

                this.applyFilters();
            });
        }
    }

    // Auto-fill parent filters based on selection
    autoFillParentFilters() {
        // If team is selected, auto-fill both domain and department
        if (this.filters.team && (!this.filters.domain || !this.filters.department)) {
            const teamContact = this.phoneData.find(p => p.team === this.filters.team);
            if (teamContact) {
                if (!this.filters.domain && teamContact.domain) {
                    this.filters.domain = teamContact.domain;
                    const domainSelect = document.getElementById('filterDomain');
                    if (domainSelect) {
                        domainSelect.value = this.filters.domain;
                    }
                }
                if (!this.filters.department && teamContact.department) {
                    this.filters.department = teamContact.department;
                    const departmentSelect = document.getElementById('filterDepartment');
                    if (departmentSelect) {
                        departmentSelect.value = this.filters.department;
                    }
                }
            }
        }

        // If department is selected but domain is not, auto-fill domain
        if (this.filters.department && !this.filters.domain) {
            const departmentContact = this.phoneData.find(p => p.department === this.filters.department);
            if (departmentContact && departmentContact.domain) {
                this.filters.domain = departmentContact.domain;
                const domainSelect = document.getElementById('filterDomain');
                if (domainSelect) {
                    domainSelect.value = this.filters.domain;
                }
            }
        }
    }

    applyFilters() {
        // Get filter values
        this.filters.domain = document.getElementById('filterDomain')?.value || '';
        this.filters.department = document.getElementById('filterDepartment')?.value || '';
        this.filters.team = document.getElementById('filterTeam')?.value || '';
        this.currentSort = document.getElementById('phoneDirectorySort')?.value || 'default';

        // AUTO-FILL parent filters
        this.autoFillParentFilters();
        const searchTerm = this.filters.search.toLowerCase().trim();

        // Filter data
        this.filteredData = this.phoneData.filter(person => {
            const matchesSearch = !searchTerm ||
                person.fullName.toLowerCase().includes(searchTerm) ||
                (person.role && person.role.toLowerCase().includes(searchTerm)) ||
                (person.division && person.division.toLowerCase().includes(searchTerm)) ||
                (person.domain && person.domain.toLowerCase().includes(searchTerm)) ||
                (person.department && person.department.toLowerCase().includes(searchTerm)) ||
                (person.team && person.team.toLowerCase().includes(searchTerm)) ||
                person.phoneNumber.includes(searchTerm) ||
                (person.extension && person.extension.includes(searchTerm)) ||
                (person.email && person.email.toLowerCase().includes(searchTerm));

            const matchesDomain = !this.filters.domain || person.domain === this.filters.domain;
            const matchesDepartment = !this.filters.department || person.department === this.filters.department;
            const matchesTeam = !this.filters.team || person.team === this.filters.team;

            return matchesSearch && matchesDomain && matchesDepartment && matchesTeam;
        });

        // Apply sorting
        this.filteredData = this.sortContacts(this.filteredData);

        this.currentPage = 1;
        this.renderPhoneDirectory();
        this.updateActiveFiltersDisplay();
        this.populateFilterDropdowns();
    }

    sortContacts(contacts) {
        const sorted = [...contacts];

        switch (this.currentSort) {
            case 'fullName':
                return sorted.sort((a, b) =>
                    (a.fullName || '').localeCompare(b.fullName || '', 'he')
                );
            case 'role':
                return sorted.sort((a, b) =>
                    (a.role || '').localeCompare(b.role || '', 'he')
                );
            case 'domain':
                return sorted.sort((a, b) =>
                    (a.domain || '').localeCompare(b.domain || '', 'he')
                );
            case 'department':
                return sorted.sort((a, b) =>
                    (a.department || '').localeCompare(b.department || '', 'he')
                );
            case 'team':
                return sorted.sort((a, b) =>
                    (a.team || '').localeCompare(b.team || '', 'he')
                );
            default:
                return sorted;
        }
    }


    hasActiveFilters() {
        return this.filters.domain ||
            this.filters.department ||
            this.filters.team ||
            this.filters.search ||
            this.currentSort !== 'default';
    }

    clearFilterButton() {
        const clearBtn = document.querySelector('.phone-directory-section .clear-filters-btn');
        if (clearBtn) {
            clearBtn.style.display = this.hasActiveFilters() ? 'inline-flex' : 'none';
        }
    }

    updateActiveFiltersDisplay() {
        const display = document.getElementById('phoneActiveFiltersDisplay');
        if (!display) return;

        const filterTags = [];

        if (this.filters.domain) {
            filterTags.push(`
                <div class="filter-tag" onclick="phoneDirectoryManager.removeFilter('domain')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> תחום: ${this.escapeHtml(this.filters.domain)}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.filters.department) {
            filterTags.push(`
                <div class="filter-tag" onclick="phoneDirectoryManager.removeFilter('department')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> מחלקה: ${this.escapeHtml(this.filters.department)}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.filters.team) {
            filterTags.push(`
                <div class="filter-tag" onclick="phoneDirectoryManager.removeFilter('team')" title="לחץ להסרה">
                    <i class="fas fa-filter"></i> צוות: ${this.escapeHtml(this.filters.team)}
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.filters.search) {
            filterTags.push(`
                <div class="filter-tag" onclick="phoneDirectoryManager.removeFilter('search')" title="לחץ להסרה">
                    <i class="fas fa-search"></i> חיפוש: "${this.escapeHtml(this.filters.search)}"
                    <i class="fas fa-times filter-tag-remove"></i>
                </div>
            `);
        }

        if (this.currentSort !== 'default') {
            const sortLabels = {
                'fullName': 'מיון: שם מלא',
                'role': 'מיון: תפקיד',
                'domain': 'מיון: תחום',
                'department': 'מיון: מחלקה',
                'team': 'מיון: צוות'
            };
            filterTags.push(`
                <div class="filter-tag" onclick="phoneDirectoryManager.removeFilter('sort')" title="לחץ להסרה">
                    <i class="fas fa-sort"></i> ${sortLabels[this.currentSort]}
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

        this.clearFilterButton();
    }

    removeFilter(filterType) {
        switch (filterType) {
            case 'domain':
                this.filters.domain = '';
                const domainFilter = document.getElementById('filterDomain');
                if (domainFilter) domainFilter.value = '';

                // Clear child filters (department and team)
                this.filters.department = '';
                const departmentFilter = document.getElementById('filterDepartment');
                if (departmentFilter) departmentFilter.value = '';

                this.filters.team = '';
                const teamFilter = document.getElementById('filterTeam');
                if (teamFilter) teamFilter.value = '';
                break;

            case 'department':
                this.filters.department = '';
                const deptFilter = document.getElementById('filterDepartment');
                if (deptFilter) deptFilter.value = '';

                // Clear child filter (team)
                this.filters.team = '';
                const teamFilterDept = document.getElementById('filterTeam');
                if (teamFilterDept) teamFilterDept.value = '';
                break;

            case 'team':
                this.filters.team = '';
                const tFilter = document.getElementById('filterTeam');
                if (tFilter) tFilter.value = '';
                break;

            case 'search':
                this.filters.search = '';
                this.clearSearch();
                break;

            case 'sort':
                this.currentSort = 'default';
                const sortSelect = document.getElementById('phoneDirectorySort');
                if (sortSelect) sortSelect.value = 'default';
                break;
        }

        this.applyFilters();

        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show('הסינון הוסר', 'info');
        }
    }

    clearFilters() {
        this.filters = {
            search: '',
            domain: '',
            department: '',
            team: ''
        };
        this.currentSort = 'default';

        // Reset UI
        this.clearSearch();

        const domainFilter = document.getElementById('filterDomain');
        if (domainFilter) domainFilter.value = '';

        const departmentFilter = document.getElementById('filterDepartment');
        if (departmentFilter) departmentFilter.value = '';

        const teamFilter = document.getElementById('filterTeam');
        if (teamFilter) teamFilter.value = '';

        const sortSelect = document.getElementById('phoneDirectorySort');
        if (sortSelect) sortSelect.value = 'default';

        this.applyFilters();
    }

    filterPhoneDirectory(searchTerm) {
        // This method is now handled by applyFilters()
        this.filters.search = searchTerm;
        this.applyFilters();
    }

    setupFormListener() {
        const form = document.getElementById('addContactForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveContact();
            });
        }
    }

    getAvailableFilterOptions() {
        let baseData = this.phoneData;

        if (this.filters.search) {
            const searchTerm = this.filters.search.toLowerCase().trim();
            baseData = baseData.filter(person => {
                return person.fullName.toLowerCase().includes(searchTerm) ||
                    (person.role && person.role.toLowerCase().includes(searchTerm)) ||
                    (person.division && person.division.toLowerCase().includes(searchTerm)) ||
                    (person.domain && person.domain.toLowerCase().includes(searchTerm)) ||
                    (person.department && person.department.toLowerCase().includes(searchTerm)) ||
                    (person.team && person.team.toLowerCase().includes(searchTerm)) ||
                    person.phoneNumber.includes(searchTerm) ||
                    (person.extension && person.extension.includes(searchTerm));
            });
        }

        const domainFilteredData = this.filters.domain
            ? baseData.filter(p => p.domain === this.filters.domain)
            : baseData;

        const departmentFilteredData = this.filters.department
            ? domainFilteredData.filter(p => p.department === this.filters.department)
            : domainFilteredData;

        // Teams based on department if selected, otherwise domain
        const teamsBaseData = this.filters.department ? departmentFilteredData : domainFilteredData;

        return {
            domains: [...new Set(baseData.map(p => p.domain).filter(Boolean))].sort(),
            departments: [...new Set(domainFilteredData.map(p => p.department).filter(Boolean))].sort(),
            teams: [...new Set(teamsBaseData.map(p => p.team).filter(Boolean))].sort()
        };

    }

    openAddContactModal() {
        this.isModalOpen = true;
        this.editingContactId = null;
        document.getElementById('contactModalTitle').textContent = 'הוסף איש קשר';
        document.getElementById('contactSubmitBtn').textContent = 'הוסף איש קשר';
        document.getElementById('addContactForm').reset();
        document.getElementById('addContactModal').style.display = 'block';
    }

    closeAddContactModal() {
        this.isModalOpen = false;
        document.getElementById('addContactModal').style.display = 'none';
        this.editingContactId = null;
    }

    editContact(contactId) {
        const contact = this.phoneData.find((p, index) => (p.id || index) === contactId);
        if (!contact) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('איש קשר לא נמצא', 'error');
            } else {
                alert('איש קשר לא נמצא');
            }
            return;
        }

        this.isModalOpen = true;
        this.editingContactId = contactId;
        document.getElementById('contactModalTitle').textContent = 'ערוך איש קשר';
        document.getElementById('contactSubmitBtn').textContent = 'שמור שינויים';
        document.getElementById('contactFullName').value = contact.fullName;
        document.getElementById('contactRole').value = contact.role || '';
        document.getElementById('contactDivision').value  = contact.division    || '';
        document.getElementById('contactDomain').value = contact.domain || '';
        document.getElementById('contactDepartment').value = contact.department || '';
        document.getElementById('contactTeam').value = contact.team || '';
        document.getElementById('contactPhone').value = contact.phoneNumber;
        document.getElementById('contactExtension').value = contact.extension || '';
        document.getElementById('contactEmail').value = contact.email || '';
        document.getElementById('addContactModal').style.display = 'block';
    }

    // Check if phone number already exists (excluding current contact when editing)
    isPhoneDuplicate(phoneNumber) {
        return this.phoneData.some((contact, index) => {
            const contactId = contact.id || index;
            return contact.phoneNumber === phoneNumber && contactId !== this.editingContactId;
        });
    }

    // Check for duplicate extension
    isExtensionDuplicate(extension) {
        if (!extension) return null;  // If no extension provided, no issue

        const existingContact = this.phoneData.find((contact, index) => {
            const contactId = contact.id || index;
            return contact.extension === extension && contactId !== this.editingContactId;
        });

        return existingContact || null;
    }

    async saveContact() {
        const fullName = document.getElementById('contactFullName').value.trim();
        const role = document.getElementById('contactRole').value.trim();
        const division    = document.getElementById('contactDivision').value.trim();  // ← חדש
        const phoneNumber = document.getElementById('contactPhone').value.trim();
        const domain = document.getElementById('contactDomain').value.trim();
        const department = document.getElementById('contactDepartment').value.trim();
        const team = document.getElementById('contactTeam').value.trim();
        const extension = document.getElementById('contactExtension').value.trim();
        const email = document.getElementById('contactEmail').value.trim();  // ← הוסף שורה זו

        // Validate required fields
        if (!fullName || !role) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('נא למלא את כל השדות', 'error');
            } else {
                alert('נא למלא את כל השדות');
            }
            return;
        }

        if (!extension && !phoneNumber) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('חייב למלא לפחות אחד מהשדות: שלוחה או טלפון', 'error');
            } else {
                alert('חייב למלא לפחות אחד מהשדות: שלוחה או טלפון');
            }
            return;
        }

        // Validate phone format only if phone number is provided
        if (phoneNumber) {
            const phonePattern = /^[0-9]{2,4}-[0-9]{7}$/;
            if (!phonePattern.test(phoneNumber)) {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('פורמט טלפון לא תקין. השתמש בפורמט: 03-1234567', 'error');
                } else {
                    alert('פורמט טלפון לא תקין. השתמש בפורמט: 03-1234567');
                }
                return;
            }

            // Check for duplicate phone number - must prevent duplicates
            if (this.isPhoneDuplicate(phoneNumber)) {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('מספר טלפון נייד זה כבר קיים במערכת', 'error');
                } else {
                    alert('מספר טלפון נייד זה כבר קיים במערכת');
                }
                return;
            }
        }


        // Validate extension format - must be exactly 4 digits
        if (extension) {
            const extensionPattern = /^[0-9]{4}$/;
            if (!extensionPattern.test(extension)) {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('שלוחה חייבת להכיל 4 ספרות בלבד', 'error');
                } else {
                    alert('שלוחה חייבת להכיל 4 ספרות בלבד');
                }
                return;
            }

            // Check for duplicate extension - show warning but allow to continue
            const duplicateExtension = this.isExtensionDuplicate(extension);
            if (duplicateExtension) {
                const confirmMessage = `שלוחה ${extension} כבר קיימת עבור ${duplicateExtension.fullName}.\nהאם להמשיך בכל זאת?`;
                if (!confirm(confirmMessage)) {
                    return;
                }
            }
        }
        // Validate email format
        if (email) {
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(email)) {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('כתובת אימייל לא תקינה', 'error');
                } else {
                    alert('כתובת אימייל לא תקינה');
                }
                return;
            }
        }

        const contactData = {
            id: this.editingContactId,
            fullName: fullName,
            role: role,
            division:    division, 
            domain: domain,
            department: department,
            team: team,
            phoneNumber: phoneNumber,
            extension: extension,
            email: email
        };

        try {
            const url = this.editingContactId !== null
                ? '/PhoneDirectory/UpdateContact'
                : '/PhoneDirectory/AddContact';

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(contactData)
            });

            const result = await response.json();

            if (result.success) {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(
                        this.editingContactId !== null ? 'איש קשר עודכן בהצלחה' : 'איש קשר נוסף בהצלחה',
                        'success'
                    );
                } else {
                    alert(this.editingContactId !== null ? 'איש קשר עודכן בהצלחה' : 'איש קשר נוסף בהצלחה');
                }
                this.closeAddContactModal();
                this.clearFilters();
                await this.loadPhoneDirectory();
            } else {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(result.message || 'שגיאה בשמירת איש קשר', 'error');
                } else {
                    alert(result.message || 'שגיאה בשמירת איש קשר');
                }
            }
        } catch (error) {
            console.error('Error saving contact:', error);
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('שגיאה בשמירת איש קשר', 'error');
            } else {
                alert('שגיאה בשמירת איש קשר');
            }
        }
    }

    async deleteContact(contactId) {
        const contact = this.phoneData.find((p, index) => (p.id || index) === contactId);
        if (!contact) {
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('איש קשר לא נמצא', 'error');
            } else {
                alert('איש קשר לא נמצא');
            }
            return;
        }

        if (!confirm(`האם אתה בטוח שברצונך למחוק את ${contact.fullName}?`)) {
            return;
        }

        try {
            const response = await fetch('/PhoneDirectory/DeleteContact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id: contactId })
            });

            const result = await response.json();

            if (result.success) {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show('איש קשר נמחק בהצלחה', 'success');
                } else {
                    alert('איש קשר נמחק בהצלחה');
                }
                await this.loadPhoneDirectory();
            } else {
                if (typeof NotificationManager !== 'undefined') {
                    NotificationManager.show(result.message || 'שגיאה במחיקת איש קשר', 'error');
                } else {
                    alert(result.message || 'שגיאה במחיקת איש קשר');
                }
            }
        } catch (error) {
            console.error('Error deleting contact:', error);
            if (typeof NotificationManager !== 'undefined') {
                NotificationManager.show('שגיאה במחיקת איש קשר', 'error');
            } else {
                alert('שגיאה במחיקת איש קשר');
            }
        }

        this.clearFilters();
    }

    formatPhoneNumber(phoneNumber) {
        if (!phoneNumber) return '';

        const cleaned = phoneNumber.replace(/\D/g, '');

        if (cleaned.length === 10) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
        } else if (cleaned.length === 11) {
            return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
        }

        return phoneNumber;
    }

    showError() {
        const container = document.getElementById('phoneDirectoryContainer');
        container.innerHTML = `
            <div class="phone-directory-empty">
                <i class="fas fa-exclamation-triangle"></i><br>
                <p>שגיאה בטעינת ספר הטלפונים</p>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    renderPaginationControls(totalPages) {
        return `
        <div class="pagination-controls">
            <button class="pagination-btn" onclick="phoneDirectoryManager.goToPage(1)" ${this.currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-angle-double-right"></i>
            </button>
            <button class="pagination-btn" onclick="phoneDirectoryManager.goToPage(${this.currentPage - 1})" ${this.currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-angle-right"></i>
            </button>
            <span class="pagination-info">עמוד ${this.currentPage} מתוך ${totalPages}</span>
            <button class="pagination-btn" onclick="phoneDirectoryManager.goToPage(${this.currentPage + 1})" ${this.currentPage === totalPages ? 'disabled' : ''}>
                <i class="fas fa-angle-left"></i>
            </button>
            <button class="pagination-btn" onclick="phoneDirectoryManager.goToPage(${totalPages})" ${this.currentPage === totalPages ? 'disabled' : ''}>
                <i class="fas fa-angle-double-left"></i>
            </button>
        </div>
    `;
    }

    goToPage(pageNumber) {
        const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
        if (pageNumber < 1 || pageNumber > totalPages) return;

        this.currentPage = pageNumber;

        // Scroll to the table header
        const tableHeader = document.querySelector('.phone-directory-table thead');
        if (tableHeader) {
            tableHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        this.renderPhoneDirectory();

    }

    // Auto refresh data
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            if (!this.isModalOpen) {
                // שמור את הפילטרים והמיון הנוכחיים
                const currentFilters = { ...this.filters };
                const currentSort = this.currentSort;
                const currentPage = this.currentPage;

                // טען מחדש את ספר הטלפונים
                await this.loadPhoneDirectory();

                // החזר את הפילטרים והמיון
                this.filters = currentFilters;
                this.currentSort = currentSort;
                this.currentPage = currentPage;

                // החל מחדש את הפילטרים
                this.applyFilters();
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

// Create global instance
const phoneDirectoryManager = new PhoneDirectoryManager();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        await phoneDirectoryManager.initialize();
    });
} else {
    phoneDirectoryManager.initialize();
}

// Global functions for onclick handlers
window.openAddContactModal = function () {
    phoneDirectoryManager.openAddContactModal();
};

window.closeAddContactModal = function () {
    phoneDirectoryManager.closeAddContactModal();
};


// ═══════════════════════════════════════════════════════════════
// ExcelImportManager - ייבוא אנשי קשר מ-Excel
// סגנון זהה ל-ServersDashboard
// ═══════════════════════════════════════════════════════════════
class ExcelImportManager {
    constructor() {
        this.importedData = null;
        this.selectedKeys = new Set();
        this.newUsersData = [];
    }

    // ─── פתח מודל ────────────────────────────────────────────
    openModal() {
        // הסר מודל קיים
        const existing = document.getElementById('phoneImportModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'phoneImportModal';
        modal.className = 'phone-import-modal-overlay';

        modal.innerHTML = `
            <div class="phone-import-modal">

                <!-- ══ כותרת ══ -->
                <div class="phone-import-modal-header">
                    <div class="phone-import-modal-title-wrap">
                        <i class="fas fa-file-excel"></i>
                        <div>
                            <div class="phone-import-modal-title">
                                ייבוא אנשי קשר מ-Excel
                            </div>
                            <div class="phone-import-modal-subtitle">
                                עמודות נדרשות:
                                <code>EnglishName</code>
                                <code>nameFromMail</code>
                                <code>email</code>
                                <code>phoneNum</code>
                            </div>
                        </div>
                    </div>
                    <button class="phone-import-modal-close"
                            id="phoneImportClose">
                        &times;
                    </button>
                </div>

                <!-- ══ אזור העלאה ══ -->
                <div id="phoneImportUploadSection"
                     class="phone-import-upload-section">
                    <div class="phone-import-upload-area"
                         id="phoneImportDropZone">
                        <i class="fas fa-cloud-upload-alt
                                  phone-import-upload-icon"></i>
                        <p class="phone-import-upload-text">
                            גרור קובץ Excel לכאן
                        </p>
                        <p class="phone-import-upload-sub">
                            או
                        </p>
                        <label class="phone-import-file-label">
                            <i class="fas fa-folder-open"></i>
                            בחר קובץ
                            <input type="file"
                                   id="phoneImportFileInput"
                                   accept=".xlsx,.xls"
                                   style="display:none">
                        </label>
                        <span id="phoneImportFileName"
                              class="phone-import-file-name">
                            לא נבחר קובץ
                        </span>
                    </div>

                    <div class="phone-import-upload-actions">
                        <button id="phoneImportProcessBtn"
                                class="phone-import-process-btn"
                                style="display:none">
                            <i class="fas fa-cogs"></i>
                            עבד קובץ
                        </button>
                    </div>
                </div>

                <!-- ══ תצוגה מקדימה ══ -->
                <div id="phoneImportPreview"
                     style="display:none">
                </div>

                <!-- ══ Footer ══ -->
                <div class="phone-import-footer"
                     id="phoneImportFooter"
                     style="display:none">
                    <div class="phone-import-footer-info"
                         id="phoneImportFooterInfo">
                    </div>
                    <div class="phone-import-footer-btns">
                        <button class="phone-import-cancel-btn"
                                id="phoneImportCancelBtn">
                            <i class="fas fa-times"></i>
                            ביטול
                        </button>
                        <button class="phone-import-save-btn"
                                id="phoneImportSaveBtn"
                                disabled>
                            <i class="fas fa-save"></i>
                            שמור נבחרים
                        </button>
                    </div>
                </div>

            </div>
        `;

        document.body.appendChild(modal);
        this._bindModalEvents(modal);
    }

    // ─── קשר אירועים למודל ───────────────────────────────────
    _bindModalEvents(modal) {
        // סגירה
        const closeModal = () => {
            modal.remove();
            this.importedData = null;
            this.selectedKeys.clear();
            this.newUsersData = [];
        };

        document.getElementById('phoneImportClose')
            .addEventListener('click', closeModal);
        document.getElementById('phoneImportCancelBtn')
            .addEventListener('click', closeModal);

        // בחירת קובץ
        const fileInput = document.getElementById(
            'phoneImportFileInput'
        );
        fileInput.addEventListener('change', e => {
            this._handleFileSelect(e.target.files[0]);
        });

        // Drag & Drop
        const dropZone = document.getElementById(
            'phoneImportDropZone'
        );
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('phone-import-drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('phone-import-drag-over');
        });
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('phone-import-drag-over');
            const file = e.dataTransfer.files[0];
            if (file) this._handleFileSelect(file);
        });

        // עיבוד קובץ
        document.getElementById('phoneImportProcessBtn')
            .addEventListener('click', () => this._processFile());

        // שמירה
        document.getElementById('phoneImportSaveBtn')
            .addEventListener('click', () => this._saveSelected());
    }

    // ─── הוסף כפתור ייצוא ל-Footer ───────────────────────
    _addExportButton() {
        // הסר כפתור קיים אם יש
        const existing = document.getElementById('phoneImportExportBtn');
        if (existing) existing.remove();

        const footerBtns = document.querySelector(
            '.phone-import-footer-btns'
        );
        if (!footerBtns) return;

        const exportBtn = document.createElement('button');
        exportBtn.id = 'phoneImportExportBtn';
        exportBtn.className = 'phone-import-export-btn';
        exportBtn.innerHTML = `
        <i class="fas fa-file-excel"></i>
        ייצא דוח לאקסל
    `;
        exportBtn.addEventListener('click', () => {
            this._exportResultsToExcel();
        });

        // הכנס לפני כפתור הביטול
        const cancelBtn = document.getElementById('phoneImportCancelBtn');
        if (cancelBtn) {
            footerBtns.insertBefore(exportBtn, cancelBtn);
        } else {
            footerBtns.appendChild(exportBtn);
        }
    }

    // ─── טפל בבחירת קובץ ─────────────────────────────────────
    _handleFileSelect(file) {
        if (!file) return;

        const ext = file.name.split('.').pop().toLowerCase();
        if (ext !== 'xlsx' && ext !== 'xls') {
            this._showToast('יש להעלות קובץ Excel בלבד', 'error');
            return;
        }

        document.getElementById('phoneImportFileName')
            .textContent = file.name;

        const processBtn = document.getElementById(
            'phoneImportProcessBtn'
        );
        processBtn.style.display = 'inline-flex';
        processBtn._file = file;
    }

    // ─── עבד קובץ ────────────────────────────────────────────
    async _processFile() {
        const processBtn = document.getElementById(
            'phoneImportProcessBtn'
        );
        const file = processBtn._file;
        if (!file) return;

        // הצג loading
        processBtn.disabled = true;
        processBtn.innerHTML =
            '<i class="fas fa-spinner fa-spin"></i> מעבד...';

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(
                '/PhoneDirectory/ImportFromExcel',
                {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Accept-Charset': 'utf-8'
                    }
                }
            );
            const result = await response.json();

            if (result.success) {
                this.importedData = result.data;
                this.newUsersData = result.data.newUsers || [];
                this._renderPreview(result);
            } else {
                this._showError(result.message);
            }
        } catch (err) {
            console.error('Error processing file:', err);
            this._showError('שגיאה בעיבוד הקובץ');
        } finally {
            processBtn.disabled = false;
            processBtn.innerHTML =
                '<i class="fas fa-cogs"></i> עבד קובץ';
        }
    }

    // ─── ייצא תוצאות לאקסל ───────────────────────────────────
    async _exportResultsToExcel() {
        if (!this.importedData) {
            this._showToast('אין נתונים לייצוא', 'warning');
            return;
        }

        // ── טען ExcelJS ───────────────────────────────────────────
        if (typeof ExcelJS === 'undefined') {
            try {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'exceljs/4.3.0/exceljs.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                    document.head.appendChild(s);
                });
            } catch (err) {
                this._showToast('שגיאה בטעינת ספריית Excel', 'error');
                return;
            }
        }

        // ── טען FileSaver ─────────────────────────────────────────
        if (typeof saveAs === 'undefined') {
            try {
                await new Promise((res, rej) => {
                    const s = document.createElement('script');
                    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/' +
                        'FileSaver.js/2.0.5/FileSaver.min.js';
                    s.onload = res;
                    s.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                    document.head.appendChild(s);
                });
            } catch (err) {
                this._showToast('שגיאה בטעינת ספריית שמירה', 'error');
                return;
            }
        }

        const { newUsers, changedUsers, duplicates } = this.importedData;

        const wb = new ExcelJS.Workbook();
        wb.creator = 'PhoneDirectoryImport';
        wb.created = new Date();
        wb.modified = new Date();

        // ══ צבעים (זהה ל-SystemsCatalogDashboard) ════════════════
        const C = {
            headerBg: 'FF320F5B',
            headerText: 'FFFFFFFF',
            headerBorder: 'FF7c3aed',
            rowEven: 'FFFFFFFF',
            rowOdd: 'FFF5F3FF',
            rowBorder: 'FFe2e8f0',
            newRowBg: 'FFf0fdf4',
            newText: 'FF166534',
            newAccent: 'FF22c55e',
            changedRowBg: 'FFfffbeb',
            changedText: 'FF92400e',
            changedAccent: 'FFf59e0b',
            dupRowBg: 'FFf9fafb',
            dupText: 'FF6b7280',
            dupAccent: 'FF9ca3af',
        };

        // ── עיצוב כותרת ──────────────────────────────────────────
        const styleHeader = (row) => {
            row.height = 26;
            row.eachCell({ includeEmpty: true }, cell => {
                cell.font = {
                    name: 'Arial',
                    size: 11,
                    bold: true,
                    color: { argb: C.headerText }
                };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: C.headerBg }
                };
                cell.alignment = {
                    horizontal: 'center',
                    vertical: 'middle',
                    readingOrder: 2
                };
                cell.border = {
                    bottom: {
                        style: 'medium',
                        color: { argb: C.headerBorder }
                    }
                };
            });
        };

        // ── עיצוב שורת נתונים ────────────────────────────────────
        const styleRow = (row, idx, bgOverride, textOverride, accentColor) => {
            row.height = 18;
            const bg = bgOverride
                ? (idx % 2 === 0 ? bgOverride : bgOverride)
                : (idx % 2 === 0 ? C.rowEven : C.rowOdd);

            row.eachCell({ includeEmpty: true }, cell => {
                cell.font = {
                    name: 'Arial',
                    size: 10,
                    color: { argb: textOverride || 'FF1a1a2e' }
                };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: bg }
                };
                cell.alignment = {
                    horizontal: 'right',
                    vertical: 'middle',
                    readingOrder: 2,
                    wrapText: false
                };
                cell.border = {
                    bottom: {
                        style: 'thin',
                        color: { argb: accentColor || C.rowBorder }
                    }
                };
            });

            // ── צבע מיוחד לעמודת "סטטוס" (עמודה אחרונה) ─────────
            if (accentColor) {
                const lastCell = row.getCell(row.cellCount);
                lastCell.font = {
                    name: 'Arial',
                    size: 10,
                    bold: true,
                    color: { argb: accentColor }
                };
            }
        };

        // ── בנה גיליון עם AutoFilter + Freeze ────────────────────
        const buildSheet = (sheetName, columns) => {
            const ws = wb.addWorksheet(sheetName, {
                views: [{
                    state: 'frozen',
                    ySplit: 1,
                    rightToLeft: true
                }],
                properties: { defaultRowHeight: 18 }
            });

            ws.columns = columns.map(c => ({
                key: c.key,
                width: c.width
            }));

            // כותרות
            const hRow = ws.addRow(
                columns.reduce((acc, c) => {
                    acc[c.key] = c.header;
                    return acc;
                }, {})
            );
            styleHeader(hRow);

            // AutoFilter
            ws.autoFilter = {
                from: { row: 1, column: 1 },
                to: { row: 1, column: columns.length }
            };

            return ws;
        };

        // ══ גיליון 1: חדשים ══════════════════════════════════════
        const wsNew = buildSheet('חדשים', [
            { key: 'hebrewName', header: 'שם (עברית)', width: 24 },
            { key: 'email', header: 'אימייל', width: 34 },
            { key: 'phone', header: 'טלפון', width: 18 },
            { key: 'extension', header: 'שלוחה', width: 12 },
            { key: 'suggestedName', header: 'שם מוצע', width: 32 },
            { key: 'selected', header: 'נבחר לייבוא', width: 16 },
            { key: 'status', header: 'סטטוס', width: 12 },
        ]);

        (newUsers || []).forEach((user, idx) => {
            const key = `new_${idx}`;
            const isSelected = this.selectedKeys.has(key);

            const row = wsNew.addRow({
                hebrewName: user.hebrewName || '',
                email: user.suggestedEmail || '',
                phone: user.suggestedPhone || '',
                extension: user.suggestedExtension || '',
                suggestedName: user.suggestedFullName || user.englishName || '',
                selected: isSelected ? '✓ כן' : '✗ לא',
                status: 'חדש',
            });

            styleRow(row, idx, C.newRowBg, C.newText, C.newAccent);
        });

        // ══ גיליון 2: שינויים בקיים ══════════════════════════════
        const wsChanged = buildSheet('שינויים בקיים', [
            { key: 'importedHebrew', header: 'שם מיובא (עברית)', width: 24 },
            { key: 'importedEmail', header: 'אימייל מיובא', width: 34 },
            { key: 'importedPhone', header: 'טלפון מיובא', width: 18 },
            { key: 'importedExt', header: 'שלוחה מיובאת', width: 12 },
            { key: 'existingName', header: 'שם קיים', width: 28 },
            { key: 'existingEmail', header: 'אימייל קיים', width: 34 },
            { key: 'existingPhone', header: 'טלפון קיים', width: 18 },
            { key: 'existingExt', header: 'שלוחה קיימת', width: 12 },
            { key: 'changedFields', header: 'שדות שהשתנו', width: 24 },
            { key: 'matchReason', header: 'סיבת התאמה', width: 16 },
            { key: 'selected', header: 'נבחר לעדכון', width: 16 },
            { key: 'status', header: 'סטטוס', width: 14 },
        ]);

        (changedUsers || []).forEach((user, idx) => {
            const key = `changed_${idx}`;
            const isSelected = this.selectedKeys.has(key);

            const row = wsChanged.addRow({
                importedHebrew: user.importedHebrewName || '',
                importedEmail: user.importedEmail || '',
                importedPhone: user.importedPhone || '',
                importedExt: user.importedExtension || '',
                existingName: user.existingFullName || '',
                existingEmail: user.existingEmail || '',
                existingPhone: user.existingPhone || '',
                existingExt: user.existingExtension || '',
                changedFields: (user.changedFields || []).join(', '),
                matchReason: user.matchReason || '',
                selected: isSelected ? '✓ כן' : '✗ לא',
                status: 'שינוי בקיים',
            });

            styleRow(row, idx, C.changedRowBg, C.changedText, C.changedAccent);
        });

        // ══ גיליון 3: קיימים (זהים) ══════════════════════════════
        const wsDup = buildSheet('קיימים', [
            { key: 'hebrewName', header: 'שם (עברית)', width: 24 },
            { key: 'email', header: 'אימייל', width: 34 },
            { key: 'phone', header: 'טלפון', width: 18 },
            { key: 'existingName', header: 'שם קיים', width: 28 },
            { key: 'existingEmail', header: 'אימייל קיים', width: 34 },
            { key: 'existingPhone', header: 'טלפון קיים', width: 18 },
            { key: 'matchReason', header: 'סיבת התאמה', width: 16 },
            { key: 'status', header: 'סטטוס', width: 14 },
        ]);

        (duplicates || []).forEach((dup, idx) => {
            const row = wsDup.addRow({
                hebrewName: dup.importedHebrewName || '',
                email: dup.importedEmail || '',
                phone: dup.importedPhone || '',
                existingName: dup.existingFullName || '',
                existingEmail: dup.existingEmail || '',
                existingPhone: dup.existingPhone || '',
                matchReason: dup.matchReason || '',
                status: 'קיים - ללא שינוי',
            });

            styleRow(row, idx, C.dupRowBg, C.dupText, C.dupAccent);
        });

        // ══ גיליון 4: סיכום ══════════════════════════════════════
        const wsSummary = wb.addWorksheet('סיכום', {
            views: [{ rightToLeft: true }]
        });

        wsSummary.columns = [
            { key: 'label', width: 28 },
            { key: 'value', width: 16 },
        ];

        const summaryRows = [
            { label: 'תאריך ייצוא', value: new Date().toLocaleDateString('he-IL') },
            { label: 'שעת ייצוא', value: new Date().toLocaleTimeString('he-IL') },
            { label: '', value: '' },
            { label: 'סה"כ בקובץ', value: (newUsers?.length || 0) + (changedUsers?.length || 0) + (duplicates?.length || 0) },
            { label: 'חדשים', value: newUsers?.length || 0 },
            { label: 'שינויים בקיים', value: changedUsers?.length || 0 },
            { label: 'קיימים (ללא שינוי)', value: duplicates?.length || 0 },
            { label: '', value: '' },
            { label: 'נבחרו לייבוא', value: this.selectedKeys.size },
        ];

        // כותרת גיליון סיכום
        const summaryHeader = wsSummary.addRow({
            label: 'סיכום ייבוא ספר טלפונים',
            value: ''
        });
        summaryHeader.height = 28;
        summaryHeader.getCell(1).font = {
            name: 'Arial',
            size: 13,
            bold: true,
            color: { argb: C.headerText }
        };
        summaryHeader.getCell(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: C.headerBg }
        };
        summaryHeader.getCell(1).alignment = {
            horizontal: 'center',
            vertical: 'middle',
            readingOrder: 2
        };
        wsSummary.mergeCells('A1:B1');

        // שורות סיכום
        summaryRows.forEach((r, idx) => {
            const row = wsSummary.addRow(r);
            row.height = 20;

            if (!r.label && !r.value) return;

            row.getCell(1).font = {
                name: 'Arial',
                size: 10,
                bold: true,
                color: { argb: 'FF4a1a8c' }
            };
            row.getCell(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: idx % 2 === 0 ? C.rowEven : C.rowOdd }
            };
            row.getCell(1).alignment = {
                horizontal: 'right', readingOrder: 2
            };

            row.getCell(2).font = {
                name: 'Arial',
                size: 10,
                bold: true,
                color: { argb: 'FF1a1a2e' }
            };
            row.getCell(2).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: idx % 2 === 0 ? C.rowEven : C.rowOdd }
            };
            row.getCell(2).alignment = {
                horizontal: 'center', vertical: 'middle'
            };

            // צבע מיוחד לשורות ספירה
            if (r.label === 'חדשים') {
                row.getCell(2).font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: C.newAccent }
                };
            }
            if (r.label === 'שינויים בקיים') {
                row.getCell(2).font = {
                    name: 'Arial', size: 11,
                    bold: true, color: { argb: C.changedAccent }
                };
            }
            if (r.label === 'נבחרו לייבוא') {
                row.getCell(2).font = {
                    name: 'Arial', size: 12,
                    bold: true, color: { argb: 'FF6366f1' }
                };
            }
        });

        // ══ הורד קובץ ════════════════════════════════════════════
        try {
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-' +
                    'officedocument.spreadsheetml.sheet'
            });

            const date = new Date()
                .toLocaleDateString('he-IL')
                .replace(/\//g, '-');

            saveAs(blob, `ייבוא_ספר_טלפונים_${date}.xlsx`);

            const total = (newUsers?.length || 0) +
                (changedUsers?.length || 0) +
                (duplicates?.length || 0);

            this._showToast(
                `📊 יוצאו ${total} רשומות ב-4 גיליונות`,
                'success'
            );

        } catch (err) {
            console.error('_exportResultsToExcel error:', err);
            this._showToast('שגיאה בייצוא: ' + err.message, 'error');
        }
    }

    // ─── הצג תצוגה מקדימה ────────────────────────────────────
    _renderPreview(result) {
        const { data, totalImported, skippedCount } = result;
        const { newUsers, changedUsers, duplicates, summary } = data;

        // שמור נתונים לשימוש מאוחר
        this.newUsersData = newUsers || [];
        this.changedUsersData = changedUsers || [];
        this.duplicatesData = duplicates || [];

        document.getElementById('phoneImportUploadSection').style.display = 'none';

        const preview = document.getElementById('phoneImportPreview');
        preview.style.display = 'block';

        // ══ Stats Bar ══════════════════════════════════════════════
        let html = `
        <div class="phone-import-stats-bar">
            <div class="phone-import-stat phone-import-stat-total">
                <i class="fas fa-file-excel"></i>
                <span>סה"כ בקובץ: <strong>${totalImported}</strong></span>
            </div>
            <div class="phone-import-stat phone-import-stat-new">
                <i class="fas fa-user-plus"></i>
                <span>חדשים: <strong>${summary.newCount}</strong></span>
            </div>
            <div class="phone-import-stat phone-import-stat-changed">
                <i class="fas fa-user-edit"></i>
                <span>שינויים: <strong>${summary.changedCount ?? 0}</strong></span>
            </div>
            <div class="phone-import-stat phone-import-stat-dup">
                <i class="fas fa-user-check"></i>
                <span>קיימים: <strong>${summary.duplicateCount}</strong></span>
            </div>
            ${skippedCount > 0 ? `
            <div class="phone-import-stat phone-import-stat-skip">
                <i class="fas fa-ban"></i>
                <span>דולגו: <strong>${skippedCount}</strong></span>
            </div>` : ''}
        </div>
    `;

        // ══ 4 טאבים ═══════════════════════════════════════════════
        html += `
        <div class="phone-import-tabs">
            <button class="phone-import-tab active"
                    id="phoneImportTabAll"
                    onclick="excelImportManager._switchTab('all')">
                הכל (${totalImported})
            </button>
            <button class="phone-import-tab phone-import-tab-new"
                    id="phoneImportTabNew"
                    onclick="excelImportManager._switchTab('new')">
                <i class="fas fa-user-plus"></i>
                חדשים (${summary.newCount})
            </button>
            <button class="phone-import-tab phone-import-tab-changed"
                    id="phoneImportTabChanged"
                    onclick="excelImportManager._switchTab('changed')">
                <i class="fas fa-user-edit"></i>
                שינוי בקיים (${summary.changedCount ?? 0})
            </button>
            <button class="phone-import-tab phone-import-tab-dup"
                    id="phoneImportTabDup"
                    onclick="excelImportManager._switchTab('dup')">
                <i class="fas fa-user-check"></i>
                קיימים (${summary.duplicateCount})
            </button>
        </div>
    `;

        // ══ טבלה ══════════════════════════════════════════════════
        html += `
    <div class="phone-import-table-wrap">
        <table class="phone-import-table">
            <thead>
                <tr>
                    <th class="phone-import-th" style="width:36px">
                        <input type="checkbox"
                               id="phoneImportSelectAll"
                               checked
                               title="בחר/בטל הכל"
                               style="accent-color:#22c55e;
                                      width:14px;height:14px;
                                      cursor:pointer">
                    </th>
                    <th class="phone-import-th">שם</th>
                    <th class="phone-import-th">אימייל</th>
                    <th class="phone-import-th">טלפון / שלוחה</th>
                    <th class="phone-import-th">סטטוס</th>
                </tr>
            </thead>
            <tbody id="phoneImportTbody">
`;

        // ══ שורות חדשים ═══════════════════════════════════════════
        newUsers.forEach((user, index) => {
            const key = `new_${index}`;

            const hasValidEmail =
                user.suggestedEmail &&
                user.suggestedEmail !== 'NaN' &&
                user.suggestedEmail !== '';

            if (hasValidEmail) this.selectedKeys.add(key);

            const phoneDisplay = user.suggestedPhone
                ? `<span class="phone-import-badge-phone">
                   <i class="fas fa-phone"></i>
                   ${this._esc(user.suggestedPhone)}
               </span>` : '';

            const extDisplay = user.suggestedExtension
                ? `<span class="phone-import-badge-ext">
                   <i class="fas fa-phone-office"></i>
                   שלוחה: ${this._esc(user.suggestedExtension)}
               </span>` : '';

            html += `
    <tr class="phone-import-row phone-import-row-new
               ${hasValidEmail ? '' : 'phone-import-row-deselected'}"
        id="phone-import-row-${key}"
        data-type="new"
        onclick="excelImportManager._toggleRow('${key}')">
        <td class="phone-import-td" onclick="event.stopPropagation()">
            <input type="checkbox"
                   id="phone-import-chk-${key}"
                   class="phone-import-new-cb"
                   data-key="${key}"
                   ${hasValidEmail ? 'checked' : ''}
                   onchange="excelImportManager
                       ._onCheckboxChange('${key}', this.checked)">
        </td>
        <td class="phone-import-td phone-import-td-name">
            ${this._esc(user.hebrewName || user.nameFromMail || '')}
        </td>
        <td class="phone-import-td">
            <span class="phone-import-badge-email">
                ${this._esc(user.suggestedEmail || '')}
            </span>
        </td>
        <td class="phone-import-td">
            ${phoneDisplay}${extDisplay}
        </td>
        <td class="phone-import-td">
            <span class="phone-import-badge-new">
                <i class="fas fa-plus-circle"></i> חדש
            </span>
        </td>
    </tr>
`;
        });

        // ══ שורות שינוי בקיים ═════════════════════════════════════
        (changedUsers || []).forEach((user, index) => {
            const key = `changed_${index}`;
            // לא נבחר אוטומטית - המשתמש יחליט

            const changedBadges = (user.changedFields || [])
                .map(f => `<span class="phone-import-changed-field-badge">
                           ${this._esc(f)}
                       </span>`)
                .join('');

            const phoneNew = user.importedPhone
                ? `<span class="phone-import-badge-phone">
                   <i class="fas fa-phone"></i>
                   ${this._esc(user.importedPhone)}
               </span>` : '';

            const extNew = user.importedExtension
                ? `<span class="phone-import-badge-ext">
                   <i class="fas fa-phone-office"></i>
                   שלוחה: ${this._esc(user.importedExtension)}
               </span>` : '';

            const phoneOld = user.existingPhone
                ? `<div class="phone-import-old-val">
                   <i class="fas fa-arrow-left"
                      style="font-size:0.55rem;color:#555"></i>
                   ${this._esc(user.existingPhone)}
               </div>` : '';

            const extOld = user.existingExtension
                ? `<div class="phone-import-old-val">
                   <i class="fas fa-arrow-left"
                      style="font-size:0.55rem;color:#555"></i>
                   שלוחה: ${this._esc(user.existingExtension)}
               </div>` : '';


            // ── תצוגת טלפון חכמה לשורת שינוי ────────────────────────────
            const buildPhoneDisplay = (user) => {
                let html = '';

                // ── טלפון נייד ────────────────────────────────────────────
                if (user.suggestedPhone) {
                    const isNew = !user.existingPhone;
                    const isUpdated = user.existingPhone &&
                        user.existingPhone !== user.suggestedPhone;
                    const isSame = user.existingPhone === user.suggestedPhone;

                    html += `<span class="phone-import-badge-phone">
                     <i class="fas fa-phone"></i>
                     ${this._esc(user.suggestedPhone)}
                     ${isNew
                            ? `<span class="phone-import-merge-tag new">+חדש</span>`
                            : isUpdated
                                ? `<span class="phone-import-merge-tag updated">עודכן</span>`
                                : ''}
                 </span>`;

                    // הצג ישן אם עודכן
                    if (isUpdated) {
                        html += `<div class="phone-import-old-val">
                         <i class="fas fa-arrow-left"
                            style="font-size:0.55rem;color:#555"></i>
                         היה: ${this._esc(user.existingPhone)}
                     </div>`;
                    }
                } else if (user.existingPhone) {
                    // יש נייד קיים, לא מיובא → שמור
                    html += `<span class="phone-import-badge-phone"
                       style="opacity:0.5"
                       title="נשמר ללא שינוי">
                     <i class="fas fa-phone"></i>
                     ${this._esc(user.existingPhone)}
                     <span class="phone-import-merge-tag kept">נשמר</span>
                 </span>`;
                }

                // ── שלוחה ─────────────────────────────────────────────────
                if (user.suggestedExtension) {
                    const isNew = !user.existingExtension;
                    const isUpdated = user.existingExtension &&
                        user.existingExtension !== user.suggestedExtension;

                    html += `<span class="phone-import-badge-ext">
                     <i class="fas fa-phone-office"></i>
                     שלוחה: ${this._esc(user.suggestedExtension)}
                     ${isNew
                            ? `<span class="phone-import-merge-tag new">+חדש</span>`
                            : isUpdated
                                ? `<span class="phone-import-merge-tag updated">עודכן</span>`
                                : ''}
                 </span>`;

                    if (isUpdated) {
                        html += `<div class="phone-import-old-val">
                         <i class="fas fa-arrow-left"
                            style="font-size:0.55rem;color:#555"></i>
                         היה: ${this._esc(user.existingExtension)}
                     </div>`;
                    }
                } else if (user.existingExtension) {
                    // יש שלוחה קיימת, לא מיובאת → שמור
                    html += `<span class="phone-import-badge-ext"
                       style="opacity:0.5"
                       title="נשמר ללא שינוי">
                     <i class="fas fa-phone-office"></i>
                     שלוחה: ${this._esc(user.existingExtension)}
                     <span class="phone-import-merge-tag kept">נשמר</span>
                 </span>`;
                }

                return html || '<span style="color:#555">—</span>';
            };

            html += `
    <tr class="phone-import-row phone-import-row-changed
               phone-import-row-deselected"
        id="phone-import-row-${key}"
        data-type="changed"
        onclick="excelImportManager._toggleRow('${key}')">
        <td class="phone-import-td" onclick="event.stopPropagation()">
            <input type="checkbox"
                   id="phone-import-chk-${key}"
                   class="phone-import-changed-cb"
                   data-key="${key}"
                   onchange="excelImportManager
                       ._onCheckboxChange('${key}', this.checked)">
        </td>
        <td class="phone-import-td phone-import-td-name">
            <div style="font-weight:600">
                ${this._esc(user.importedHebrewName || '')}
            </div>
            <div style="margin-top:3px">${changedBadges}</div>
        </td>
        <td class="phone-import-td">
            ${user.importedEmail
                    ? `<span class="phone-import-badge-email">
                       ${this._esc(user.importedEmail)}
                   </span>` : ''}
        </td>
        <td class="phone-import-td">
            ${buildPhoneDisplay(user)}
        </td>
        <td class="phone-import-td">
            <span class="phone-import-badge-changed-status">
                <i class="fas fa-edit"></i> שינוי
            </span>
        </td>
    </tr>
`;
        });

        // ══ שורות קיימים (זהים לחלוטין) ══════════════════════════
        (duplicates || []).forEach((dup, index) => {
            const key = `dup_${index}`;
            // קיימים לא נבחרים ולא ניתן לבחור אותם

            html += `
    <tr class="phone-import-row phone-import-row-dup
               phone-import-row-identical"
        id="phone-import-row-${key}"
        data-type="dup"
        style="opacity:0.45;cursor:default"
        title="זהה לחלוטין - אין צורך בעדכון">
        <td class="phone-import-td" onclick="event.stopPropagation()">
            <input type="checkbox"
                   id="phone-import-chk-${key}"
                   class="phone-import-dup-cb"
                   data-key="${key}"
                   disabled
                   style="opacity:0.3;cursor:not-allowed">
        </td>
        <td class="phone-import-td phone-import-td-name"
            style="color:#666">
            ${this._esc(dup.importedHebrewName || '')}
        </td>
        <td class="phone-import-td" style="color:#555">
            ${this._esc(dup.importedEmail || '')}
        </td>
        <td class="phone-import-td" style="color:#555">
            ${dup.importedPhone
                    ? `<span style="font-size:0.75rem;color:#555">
                       ${this._esc(dup.importedPhone)}
                   </span>` : ''}
        </td>
        <td class="phone-import-td">
            <span class="phone-import-badge-dup">
                <i class="fas fa-check-double"></i> קיים
            </span>
        </td>
    </tr>
`;
        });

        html += `
                </tbody>
            </table>
        </div>
    `;

        preview.innerHTML = html;

        // ══ Footer ════════════════════════════════════════════════
        const footer = document.getElementById('phoneImportFooter');
        footer.style.display = 'flex';

        this._updateFooterInfo(newUsers.length, summary);
        this._updateSaveBtn();
        this._addExportButton();

        // ══ "בחר הכל" ════════════════════════════════════════════
        const selectAll = document.getElementById('phoneImportSelectAll');
        if (selectAll) {
            selectAll.addEventListener('change', () => {
                if (selectAll.checked) {
                    this._selectAll();
                } else {
                    this._deselectAll();
                }
            });
        }
    }

    // ─── החלף טאב ────────────────────────────────────────────
    _switchTab(tab) {
        this.activeTab = tab;

        // ── עדכן כפתורי טאב ──────────────────────────────────────
        ['All', 'New', 'Changed', 'Dup'].forEach(t => {
            const btn = document.getElementById(`phoneImportTab${t}`);
            if (btn) btn.classList.remove('active');
        });

        const tabMap = {
            all: 'All',
            new: 'New',
            changed: 'Changed',
            dup: 'Dup'
        };

        const activeBtn = document.getElementById(
            `phoneImportTab${tabMap[tab]}`
        );
        if (activeBtn) activeBtn.classList.add('active');

        // ── הצג/הסתר שורות ───────────────────────────────────────
        const tbody = document.getElementById('phoneImportTbody');
        if (!tbody) return;

        tbody.querySelectorAll('tr.phone-import-row').forEach(row => {
            const type = row.dataset.type;

            if (tab === 'all') {
                row.style.display = '';
            } else if (tab === 'new') {
                row.style.display = type === 'new' ? '' : 'none';
            } else if (tab === 'changed') {
                row.style.display = type === 'changed' ? '' : 'none';
            } else if (tab === 'dup') {
                row.style.display = type === 'dup' ? '' : 'none';
            }
        });

        this._updateSelectAllState();
    }

    // ─── בחר/בטל שורה ────────────────────────────────────────
    _toggleRow(key) {
        const chk = document.getElementById(
            `phone-import-chk-${key}`
        );
        const row = document.getElementById(
            `phone-import-row-${key}`
        );

        if (this.selectedKeys.has(key)) {
            this.selectedKeys.delete(key);
            if (chk) chk.checked = false;
            if (row) row.classList.add(
                'phone-import-row-deselected'
            );
        } else {
            this.selectedKeys.add(key);
            if (chk) chk.checked = true;
            if (row) row.classList.remove(
                'phone-import-row-deselected'
            );
        }

        this._updateSelectAllState();
        this._updateSaveBtn();
    }

    // ─── שינוי checkbox ───────────────────────────────────────
    _onCheckboxChange(key, isChecked) {
        const row = document.getElementById(
            `phone-import-row-${key}`
        );

        if (isChecked) {
            this.selectedKeys.add(key);
            if (row) row.classList.remove(
                'phone-import-row-deselected'
            );
        } else {
            this.selectedKeys.delete(key);
            if (row) row.classList.add(
                'phone-import-row-deselected'
            );
        }

        this._updateSelectAllState();
        this._updateSaveBtn();
    }

    // ─── בחר הכל ─────────────────────────────────────────
    _selectAll() {
        const tab = this.activeTab;

        if (tab === 'all' || tab === 'new') {
            this.newUsersData.forEach((_, i) => {
                const key = `new_${i}`;
                this.selectedKeys.add(key);
                const chk = document.getElementById(`phone-import-chk-${key}`);
                if (chk) chk.checked = true;
                const row = document.getElementById(`phone-import-row-${key}`);
                if (row) row.classList.remove('phone-import-row-deselected');
            });
        }

        if (tab === 'all' || tab === 'changed') {
            (this.changedUsersData || []).forEach((_, i) => {
                const key = `changed_${i}`;
                this.selectedKeys.add(key);
                const chk = document.getElementById(`phone-import-chk-${key}`);
                if (chk) chk.checked = true;
                const row = document.getElementById(`phone-import-row-${key}`);
                if (row) row.classList.remove('phone-import-row-deselected');
            });
        }

        // dup לא נבחרים לעולם (disabled)

        this._updateSaveBtn();
    }

    // ─── בטל הכל ─────────────────────────────────────────
    _deselectAll() {
        const tab = this.activeTab;

        if (tab === 'all' || tab === 'new') {
            this.newUsersData.forEach((_, i) => {
                const key = `new_${i}`;
                this.selectedKeys.delete(key);
                const chk = document.getElementById(`phone-import-chk-${key}`);
                if (chk) chk.checked = false;
                const row = document.getElementById(`phone-import-row-${key}`);
                if (row) row.classList.add('phone-import-row-deselected');
            });
        }

        if (tab === 'all' || tab === 'changed') {
            (this.changedUsersData || []).forEach((_, i) => {
                const key = `changed_${i}`;
                this.selectedKeys.delete(key);
                const chk = document.getElementById(`phone-import-chk-${key}`);
                if (chk) chk.checked = false;
                const row = document.getElementById(`phone-import-row-${key}`);
                if (row) row.classList.add('phone-import-row-deselected');
            });
        }

        this._updateSaveBtn();
    }

    // ─── עדכן מצב "בחר הכל" ──────────────────────────────────
    _updateSelectAllState() {
        const selectAll = document.getElementById('phoneImportSelectAll');
        if (!selectAll) return;

        const tab = this.activeTab;
        let relevantCheckboxes;

        if (tab === 'new') {
            relevantCheckboxes = document.querySelectorAll('.phone-import-new-cb');
        } else if (tab === 'changed') {
            relevantCheckboxes = document.querySelectorAll('.phone-import-changed-cb');
        } else if (tab === 'dup') {
            // dup תמיד disabled - הסתר את "בחר הכל"
            selectAll.style.display = 'none';
            return;
        } else {
            // all - רק new + changed (לא dup שהם disabled)
            relevantCheckboxes = document.querySelectorAll(
                '.phone-import-new-cb, .phone-import-changed-cb'
            );
        }

        selectAll.style.display = '';
        const total = relevantCheckboxes.length;
        const checked = [...relevantCheckboxes].filter(chk => chk.checked).length;

        selectAll.checked = checked === total && total > 0;
        selectAll.indeterminate = checked > 0 && checked < total;
    }

    // ─── עדכן כפתור שמירה ────────────────────────────────────
    _updateSaveBtn() {
        const saveBtn = document.getElementById(
            'phoneImportSaveBtn'
        );
        if (!saveBtn) return;

        const count = this.selectedKeys.size;
        saveBtn.disabled = count === 0;
        saveBtn.innerHTML = count > 0
            ? `<i class="fas fa-save"></i> שמור ${count} אנשי קשר`
            : `<i class="fas fa-save"></i> שמור נבחרים`;
    }

    // ─── עדכן מידע Footer ────────────────────────────────────
    _updateFooterInfo(newCount, summary) {
        const info = document.getElementById(
            'phoneImportFooterInfo'
        );
        if (!info) return;

        if (newCount > 0) {
            info.innerHTML = `
                <i class="fas fa-info-circle"
                   style="color:#6366f1"></i>
                יתווספו
                <strong id="phoneImportSelectedCount"
                        style="color:#22c55e">
                    ${newCount}
                </strong>
                אנשי קשר חדשים
                ${summary.duplicateCount > 0
                    ? `(${summary.duplicateCount} כבר קיימים)`
                    : ''}
            `;
        } else {
            info.innerHTML = `
                <i class="fas fa-info-circle"
                   style="color:#888"></i>
                אין אנשי קשר חדשים לייבוא
            `;
        }
    }

    // ─── שמור נבחרים ─────────────────────────────────────────
    async _saveSelected() {
        if (this.selectedKeys.size === 0) {
            this._showToast('לא נבחרו אנשי קשר', 'warning');
            return;
        }

        const contactsToSave = [];

        this.selectedKeys.forEach(key => {
            // ── חדשים ────────────────────────────────────────────
            if (key.startsWith('new_')) {
                const index = parseInt(key.replace('new_', ''));
                const user = this.newUsersData[index];
                if (!user) return;

                contactsToSave.push({
                    fullName: user.suggestedFullName || user.englishName,
                    role: '',
                    domain: '',
                    department: '',
                    team: '',
                    phoneNumber: user.suggestedPhone || '',
                    extension: user.suggestedExtension || '',
                    email: user.suggestedEmail || ''
                });
            }

            // ── שינוי בקיים ──────────────────────────────────────
            if (key.startsWith('changed_')) {
                const index = parseInt(key.replace('changed_', ''));
                const user = (this.changedUsersData || [])[index];
                if (!user) return;

                contactsToSave.push({
                    // שלח id כדי לעדכן את הקיים
                    id: user.existingId || null,
                    fullName: user.suggestedFullName || user.importedEnglishName,
                    role: '',
                    domain: '',
                    department: '',
                    team: '',
                    phoneNumber: user.suggestedPhone || '',
                    extension: user.suggestedExtension || '',
                    email: user.suggestedEmail || ''
                });
            }
        });

        if (contactsToSave.length === 0) return;

        const saveBtn = document.getElementById('phoneImportSaveBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML =
                '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            const response = await fetch(
                '/PhoneDirectory/SaveImportedContacts',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contacts: contactsToSave })
                }
            );

            const result = await response.json();

            if (result.success) {
                this._showToast(result.message, 'success');
                document.getElementById('phoneImportModal')?.remove();

                if (typeof phoneDirectoryManager !== 'undefined')
                    await phoneDirectoryManager.loadPhoneDirectory();
            } else {
                this._showToast(result.message || 'שגיאה בשמירה', 'error');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.innerHTML =
                        `<i class="fas fa-save"></i>
                     שמור ${this.selectedKeys.size} אנשי קשר`;
                }
            }
        } catch (err) {
            console.error('Error saving contacts:', err);
            this._showToast('שגיאה בשמירת אנשי קשר', 'error');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML =
                    `<i class="fas fa-save"></i>
                 שמור ${this.selectedKeys.size} אנשי קשר`;
            }
        }
    }

    // ─── הצג שגיאה בתוך המודל ────────────────────────────────
    _showError(msg) {
        const preview = document.getElementById(
            'phoneImportPreview'
        );
        if (preview) {
            preview.style.display = 'block';
            preview.innerHTML = `
                <div class="phone-import-error-msg">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${this._esc(msg)}</p>
                </div>
            `;
        }
    }

    // ─── Toast ───────────────────────────────────────────────
    _showToast(msg, type = 'info') {
        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show(msg, type);
        } else {
            alert(msg);
        }
    }

    // ─── Escape HTML ─────────────────────────────────────────
    _esc(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

// ─── Instance גלובלי ─────────────────────────────────────────
const excelImportManager = new ExcelImportManager();

// ─── פונקציות גלובליות ───────────────────────────────────────
window.openExcelImportModal = function () {
    excelImportManager.openModal();
};