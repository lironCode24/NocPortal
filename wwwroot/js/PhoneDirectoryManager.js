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
            actions: true      // Always visible (disabled checkbox)
        };

        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;
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
        const saved = localStorage.getItem('phoneDirectoryColumns');
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
        localStorage.setItem('phoneDirectoryColumns', JSON.stringify(this.visibleColumns));
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
        const phoneFiltersCollapsed = localStorage.getItem('phoneFiltersSectionCollapsed');
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

        localStorage.setItem('phoneFiltersSectionCollapsed', content.classList.contains('collapsed'));
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
                if (searchInput) searchInput.value = '';
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