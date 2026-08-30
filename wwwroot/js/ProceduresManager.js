class ProceduresManager {
    constructor() {
        this.allProcedures = [];
        this.filteredProcedures = [];
        this.currentPage = 1;
        this.itemsPerPage = 9;
        this.currentView = 'folder'; // 'folder' or 'grid'
        this.collapsedFolders = new Set(); // Track collapsed folders

        this.employees = [];
        this.refreshInterval = null;
        this.isModalOpen = false;
        this.AUTO_REFRESH_MINUTES = 5;
        this.quickProcedures = [];
    }

    // Switch between folder and grid view
    switchView(view) {
        this.currentView = view;
        this.currentPage = 1;

        // Update button states
        document.getElementById('folderViewBtn').classList.toggle('active', view === 'folder');
        document.getElementById('gridViewBtn').classList.toggle('active', view === 'grid');

        // Get current search term
        const searchInput = document.getElementById('proceduresSearchInput');
        const searchTerm = searchInput ? searchInput.value.trim() : '';

        // If there's an active search, reapply it
        if (searchTerm !== '') {
            this.searchProcedures(searchTerm);
            // If switching to folder view with search, add expanded class to all folders
            if (view === 'folder') {
                setTimeout(() => {
                    document.querySelectorAll('.procedure-folder').forEach(folder => {
                        folder.classList.add('expanded');
                    });
                }, 0);
            }
        } else {
            // Display procedures in selected view
            this.displayProcedures(this.filteredProcedures);

            // If switching to folder view without search, remove expanded class to all folders
            if (view === 'folder') {
                setTimeout(() => {
                    this.searchProcedures('');
                    document.querySelectorAll('.procedure-folder').forEach(folder => {
                        folder.classList.remove('expanded');
                    });
                }, 0);
            }
        }

        // Update collapse all button
        setTimeout(() => {
            this.updateCollapseAllButton();
        }, 100);
    }

    // Group procedures by folder
    groupByFolder(procedures) {
        const groups = {};

        procedures.forEach(procedure => {
            const folder = procedure.folder || '';
            if (!groups[folder]) {
                groups[folder] = [];
            }
            groups[folder].push(procedure);
        });

        return groups;
    }

    // Toggle folder collapse/expand
    toggleFolder(folder) {
        const folderElement = document.querySelector(`[data-folder="${folder}"]`);
        if (!folderElement) return;

        const content = folderElement.querySelector('.folder-content');
        const toggle = folderElement.querySelector('.folder-toggle');

        if (this.collapsedFolders.has(folder)) {
            // Currently open -> close it
            this.collapsedFolders.delete(folder);
            content.classList.add('collapsed');
            toggle.classList.add('collapsed');
            folderElement.classList.remove('expanded');
        } else {
            // Currently closed -> open it
            this.collapsedFolders.add(folder);
            content.classList.remove('collapsed');
            toggle.classList.remove('collapsed');
            folderElement.classList.add('expanded');
        }
        // Show/hide collapse all button based on opened folders
        this.updateCollapseAllButton();
    }

    // Display procedures in folder view
    displayFolderView(procedures) {
        const container = document.getElementById('proceduresContainer');

        // Group procedures by folder
        const folderGroups = this.groupByFolder(procedures);

        let html = '<div class="procedures-folders">';

        // Sort folders: root first, then alphabetically
        const sortedFolders = Object.keys(folderGroups).sort((a, b) => {
            if (a === '') return -1; // Root folder first
            if (b === '') return 1;
            return a.localeCompare(b, 'he');
        });

        sortedFolders.forEach(folder => {
            const folderProcedures = folderGroups[folder];
            const isRoot = folder === '';
            const folderName = isRoot ? 'תיקייה ראשית' : folder;
            const isCollapsed = !this.collapsedFolders.has(folder);

            html += `
        <div class="procedure-folder ${isRoot ? 'root-folder' : ''}" data-folder="${folder}">
            <div class="folder-header" onclick="proceduresManager.toggleFolder('${folder}')">
                <div class="folder-header-content">
                    <i class="folder-icon ${isRoot ? 'fas fa-home' : 'fas fa-folder'}"></i>
                    <div class="folder-info">
                        <h3 class="folder-name">${folderName}</h3>
                        <div class="folder-count">
                            <i class="fas fa-file"></i>
                            ${folderProcedures.length} קבצים
                        </div>
                    </div>
                </div>
                <button class="folder-toggle ${isCollapsed ? 'collapsed' : ''}">
                    <i class="fas fa-chevron-up"></i>
                </button>
            </div>
            
            <div class="folder-content ${isCollapsed ? 'collapsed' : ''}">
                <div class="folder-procedures-grid">
                    ${folderProcedures.map(procedure => this.createProcedureCard(procedure)).join('')}
                </div>
            </div>
        </div>
    `;
        });

        html += '</div>';
        container.innerHTML = html;

        // Update collapse all button visibility
        setTimeout(() => {
            this.updateCollapseAllButton();
        }, 100);
    }

    // Load procedures from server
    async loadProcedures() {
        try {
            const response = await fetch('/Procedures/GetProcedures');
            const data = await response.json();

            if (data.error) {
                console.error('Error loading procedures:', data.error);
                document.getElementById('proceduresContainer').innerHTML =
                    `<div class="procedures-error">
                    <i class="fas fa-exclamation-triangle"></i><br>
                    שגיאה בטעינת נהלים: ${data.error}
                </div>`;
                return;
            }

            this.allProcedures = data;
            // Clear opened folders on refresh
            this.collapsedFolders.clear();
            this.displayProcedures(this.allProcedures);
            if (!this.refreshInterval) {
                this.startAutoRefresh();
            }
        } catch (error) {
            console.error('Error fetching procedures:', error);
            document.getElementById('proceduresContainer').innerHTML =
                `<div class="procedures-error">
                <i class="fas fa-exclamation-triangle"></i><br>
                שגיאה בטעינת נהלים
            </div>`;
        }
    }

    // Display procedures in grid view with pagination
    displayGridView(procedures) {
        const container = document.getElementById('proceduresContainer');

        const totalPages = Math.ceil(procedures.length / this.itemsPerPage);
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const currentProcedures = procedures.slice(startIndex, endIndex);

        const gridHTML = `
        <div class="procedures-grid">
            ${currentProcedures.map(procedure => this.createProcedureCard(procedure)).join('')}
        </div>
        ${totalPages > 1 ? this.createPaginationHTML(totalPages) : ''}
    `;

        container.innerHTML = gridHTML;

        if (totalPages > 1) {
            this.addPaginationEventListeners();
        }
    }

    // Display procedures based on current view
    displayProcedures(procedures) {
        const container = document.getElementById('proceduresContainer');
        this.filteredProcedures = procedures;

        if (procedures.length === 0) {
            container.innerHTML = `
            <div class="procedures-empty">
                <i class="fas fa-folder-open"></i><br>
                אין נהלים זמינים
            </div>`;
            return;
        }

        if (this.currentView === 'folder') {
            this.displayFolderView(procedures);
            // Update collapse all button visibility
            setTimeout(() => {
                this.updateCollapseAllButton();
            }, 100);
        } else {
            this.displayGridView(procedures);
        }
    }

    // Create pagination HTML
    createPaginationHTML(totalPages) {
        const maxVisiblePages = 5;
        let startPage = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

        if (endPage - startPage + 1 < maxVisiblePages) {
            startPage = Math.max(1, endPage - maxVisiblePages + 1);
        }

        let paginationHTML = `
            <div class="procedures-pagination">
                <button class="pagination-btn" id="prevBtn" ${this.currentPage === 1 ? 'disabled' : ''}>
                    <i class="fas fa-chevron-right"></i>
                    הקודם
                </button>
                
                <div class="pagination-numbers">
        `;

        if (startPage > 1) {
            paginationHTML += `<button class="page-number" data-page="1">1</button>`;
            if (startPage > 2) {
                paginationHTML += `<span style="padding: 8px;">...</span>`;
            }
        }

        for (let i = startPage; i <= endPage; i++) {
            paginationHTML += `
                <button class="page-number ${i === this.currentPage ? 'active' : ''}" data-page="${i}">
                    ${i}
                </button>
            `;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                paginationHTML += `<span style="padding: 8px;">...</span>`;
            }
            paginationHTML += `<button class="page-number" data-page="${totalPages}">${totalPages}</button>`;
        }

        paginationHTML += `
                </div>
                
                <button class="pagination-btn" id="nextBtn" ${this.currentPage === totalPages ? 'disabled' : ''}>
                    הבא
                    <i class="fas fa-chevron-left"></i>
                </button>
            </div>
            
            <div class="pagination-info">
                מציג ${(this.currentPage - 1) * this.itemsPerPage + 1}-${Math.min(this.currentPage * this.itemsPerPage, this.filteredProcedures.length)} מתוך ${this.filteredProcedures.length} נהלים
            </div>
        `;

        return paginationHTML;
    }

    // Add pagination event listeners
    addPaginationEventListeners() {
        const prevBtn = document.getElementById('prevBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.displayProcedures(this.filteredProcedures);
                }
            });
        }

        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                const totalPages = Math.ceil(this.filteredProcedures.length / this.itemsPerPage);
                if (this.currentPage < totalPages) {
                    this.currentPage++;
                    this.displayProcedures(this.filteredProcedures);
                    this.scrollToTop();
                }
            });
        }

        document.querySelectorAll('.page-number').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page !== this.currentPage) {
                    this.currentPage = page;
                    this.displayProcedures(this.filteredProcedures);
                    this.scrollToTop();
                }
            });
        });
    }

    scrollToTop() {

        const container = document.getElementById('proceduresContainer');
        if (container) {
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // Clear search
    clearSearch() {
        const searchInput = document.getElementById('proceduresSearchInput');
        const clearBtn = document.getElementById('clearSearchBtn');

        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }

        if (clearBtn) {
            clearBtn.style.display = 'none';
        }

        // שחזר כפתור נהלים מהירים
        const btn = document.querySelector('.quick-procedure-btn');
        if (btn) {
            btn.classList.remove('has-search-results');
            btn.innerHTML = '<i class="fas fa-bolt"></i> נהלים מהירים';
            btn.onclick = () => this.openQuickProceduresModal();
        }

        this.searchProcedures('');
    }

    // Search procedures
    searchProcedures(searchTerm) {
        this.currentPage = 1;

        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) {
            clearBtn.style.display = searchTerm !== '' ? 'block' : 'none';
        }

        // עדכן כפתור נהלים מהירים
        this._checkQuickProceduresForSearch(searchTerm);

        if (searchTerm === '') {
            // שחזר כפתור
            const btn = document.querySelector('.quick-procedure-btn');
            if (btn) {
                btn.classList.remove('has-search-results');
                btn.innerHTML = '<i class="fas fa-bolt"></i> נהלים מהירים';
                btn.onclick = () => this.openQuickProceduresModal();
            }

            this.collapsedFolders.clear();
            this.displayProcedures(this.allProcedures);

            setTimeout(() => {
                document.querySelectorAll('.procedure-folder').forEach(folder => {
                    folder.classList.remove('expanded');
                });
                this.updateCollapseAllButton();
            }, 0);

        } else {
            const filteredProcedures = this.allProcedures.filter(procedure =>
                procedure.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                procedure.fileName.toLowerCase().includes(searchTerm.toLowerCase())
            );

            if (this.currentView === 'folder') {
                const allFolders = new Set(this.allProcedures.map(p => p.folder || ''));
                allFolders.forEach(folder => this.collapsedFolders.add(folder));
            }

            this.displayProcedures(filteredProcedures);

            if (this.currentView === 'folder') {
                setTimeout(() => {
                    document.querySelectorAll('.procedure-folder').forEach(folder => {
                        folder.classList.add('expanded');
                    });
                    this.updateCollapseAllButton();
                }, 0);
            }
        }
    }

    // בדוק אם יש תוצאות בנהלים מהירים
    async _checkQuickProceduresForSearch(searchTerm) {
        const btn = document.querySelector('.quick-procedure-btn');
        if (!btn) return;

        // נקה מצב קודם
        btn.classList.remove('has-search-results');
        btn.querySelector('span') && (btn.querySelector('span').textContent = 'נהלים מהירים');

        // שחזר טקסט מקורי אם אין חיפוש
        if (!searchTerm || searchTerm.trim() === '') {
            btn.innerHTML = '<i class="fas fa-bolt"></i> נהלים מהירים';
            return;
        }

        // טען נהלים מהירים אם צריך
        if (!this.quickProcedures || this.quickProcedures.length === 0) {
            try {
                await this.loadQuickProcedures();
            } catch (e) {
                return;
            }
        }

        const term = searchTerm.trim().toLowerCase();
        const matches = this.quickProcedures.filter(proc =>
            proc.title.toLowerCase().includes(term) ||
            (proc.content || '').toLowerCase().includes(term)
        );

        if (matches.length > 0) {
            // שנה כפתור - הצג תוצאות
            btn.classList.add('has-search-results');
            btn.innerHTML = `<i class="fas fa-bolt"></i> נמצאו ${matches.length} נהלים מהירים`;

            // בלחיצה - פתח מודל עם החיפוש
            btn.onclick = () => {
                this.openQuickProceduresModal().then(() => {
                    const internalInput = document.getElementById('quickProceduresSearchInput');
                    if (internalInput) {
                        internalInput.value = searchTerm;
                        internalInput.dispatchEvent(new Event('input'));
                    }
                });
            };
        } else {
            // אין תוצאות - שחזר כפתור רגיל
            btn.classList.remove('has-search-results');
            btn.innerHTML = '<i class="fas fa-bolt"></i> נהלים מהירים';

            // שחזר onclick מקורי
            btn.onclick = () => this.openQuickProceduresModal();
        }
    }

    // View procedure in modal
    viewProcedureInModal(fileName, folderPath = '') {
        this.isModalOpen = true;

        // Find the procedure with matching fileName and folder
        const procedure = this.allProcedures.find(p =>
            p.fileName === fileName &&
            (folderPath === '' || p.folder === folderPath)
        );

        const displayName = procedure ? procedure.name : fileName;
        const extension = fileName.split('.').pop().toLowerCase();
        const actualFolderPath = procedure ? procedure.folder : folderPath;

        document.getElementById('simpleDocumentTitle').textContent = displayName;
        document.getElementById('simpleDocumentTitle').setAttribute('data-filename', fileName);
        document.getElementById('simpleDocumentTitle').setAttribute('data-folder', procedure ? procedure.folder : '');

        // Include folder path in the URL if provided
        const encodedFileName = encodeURIComponent(fileName);
        const encodedFolderPath = folderPath ? encodeURIComponent(folderPath) : '';
        const cacheBuster = this._refreshTimestamp || Date.now();
        const viewUrl = folderPath ?
            `/Procedures/ViewFile?fileName=${encodedFileName}&folderPath=${encodedFolderPath}&t=${cacheBuster}` :
            `/Procedures/ViewFile?fileName=${encodedFileName}&t=${cacheBuster}`;

        // אפס את ה-timestamp אחרי שימוש
        this._refreshTimestamp = null;
        const iframe = document.getElementById('simpleDocumentFrame');
        const loader = document.getElementById('documentLoader');

        // Clear previous content FIRST
        iframe.src = 'about:blank';
        iframe.srcdoc = '';
        iframe.style.display = 'none';
        iframe.onload = null;

        // Show modal with loader
        document.getElementById('simpleDocumentModal').style.display = 'block';
        document.body.style.overflow = 'hidden';

        // ALWAYS show loader at start
        loader.style.display = 'flex';

        const editUrl = folderPath ?
            `/Procedures/EditFile?fileName=${encodedFileName}&folderPath=${encodedFolderPath}` :
            `/Procedures/EditFile?fileName=${encodedFileName}`;
        // Get full file path from server
        fetch(editUrl, { method: 'POST' })
            .then(response => response.json())
            .then(result => {
                const fullPath = result.fullPath || 'נתיב לא זמין';

                // Word and Excel files - convert to PDF and display
                if (['doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
                    // Show converting message
                    iframe.srcdoc = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <style>
                                * {
                                    margin: 0;
                                    padding: 0;
                                    box-sizing: border-box;
                                }
                                body {
                                    background: #2c3e50;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    min-height: 100vh;
                                    color: white;
                                    font-family: Arial, sans-serif;
                                    text-align: center;
                                }
                                .loading {
                                    padding: 40px;
                                }
                                .spinner {
                                    border: 4px solid rgba(255, 255, 255, 0.3);
                                    border-top: 4px solid white;
                                    border-radius: 50%;
                                    width: 50px;
                                    height: 50px;
                                    animation: spin 1s linear infinite;
                                    margin: 0 auto 20px;
                                }
                                @keyframes spin {
                                    0% { transform: rotate(0deg); }
                                    100% { transform: rotate(360deg); }
                                }
                                .message {
                                    font-size: 1.2rem;
                                    margin-bottom: 10px;
                                }
                                .submessage {
                                    font-size: 0.9rem;
                                    color: rgba(255, 255, 255, 0.7);
                                }
                            </style>
                        </head>
                        <body>
                            <div class="loading">
                                <div class="spinner"></div>
                                <div class="message">ממיר קובץ ל-PDF...</div>
                                <div class="submessage">זה עשוי לקחת מספר שניות</div>
                            </div>
                        </body>
                        </html>
                    `;

                    iframe.style.display = 'block';
                    loader.style.display = 'none';

                    // Load the converted PDF after short delay
                    setTimeout(() => {
                        this.loadPdfInIframe(viewUrl, iframe, fileName, loader, fullPath, actualFolderPath);
                    }, 500);
                }
                // Text files - show as text with path
                else if (extension === 'txt') {
                    this.loadConvertedFile(viewUrl, iframe, fileName, fullPath, loader, actualFolderPath);
                }
                // PDF files
                else if (extension === 'pdf') {
                    // Use the same method as converted PDFs to show header with buttons
                    this.loadPdfInIframe(viewUrl, iframe, fileName, loader, fullPath, actualFolderPath);
                }
                // Images
                else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
                    iframe.srcdoc = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <style>
                                * {
                                    margin: 0;
                                    padding: 0;
                                    box-sizing: border-box;
                                }
                                body {
                                    background: #2c3e50;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                    min-height: 100vh;
                                    padding: 20px;
                                }
                                img {
                                    max-width: 100%;
                                    max-height: calc(100vh - 40px);
                                    height: auto;
                                    border-radius: 10px;
                                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                                    transition: transform 0.3s ease;
                                }
                                img:hover {
                                    transform: scale(1.02);
                                }
                            </style>
                        </head>
                        <body>
                            <img src="${viewUrl}" alt="${displayName}" onload="parent.postMessage('loaded', '*')">
                        </body>
                        </html>
                    `;

                    // Hide loader when image loads
                    iframe.onload = () => {
                        setTimeout(() => {
                            loader.style.display = 'none';
                            iframe.style.display = 'block';
                        }, 300);
                    };
                }
                // HTML files - FIXED VERSION
                else if (['html', 'htm'].includes(extension)) {
                    // Load HTML content and inject it into iframe
                    fetch(viewUrl)
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('שגיאה בטעינת הקובץ');
                            }
                            return response.text();
                        })
                        .then(htmlContent => {
                            // Inject HTML content into iframe using srcdoc
                            iframe.srcdoc = htmlContent;

                            // Hide loader when HTML loads
                            iframe.onload = () => {
                                setTimeout(() => {
                                    loader.style.display = 'none';
                                    iframe.style.display = 'block';
                                }, 300);
                            };
                        })
                        .catch(error => {
                            console.error('Error loading HTML:', error);
                            loader.style.display = 'none';
                            iframe.srcdoc = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        .error-container {
                            text-align: center;
                            max-width: 600px;
                            width: 100%;
                            background: white;
                            padding: 50px 40px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                        }
                        .error-icon {
                            font-size: 5rem;
                            color: #dc3545;
                            margin-bottom: 25px;
                        }
                        h3 {
                            color: #320F5B;
                            font-size: 1.8rem;
                            font-weight: bold;
                            margin-bottom: 15px;
                        }
                        p {
                            color: #666;
                            font-size: 1.1rem;
                            line-height: 1.6;
                            margin-bottom: 25px;
                        }
                        .error-details {
                            background: #f8f9fa;
                            padding: 15px;
                            border-radius: 10px;
                            border-right: 4px solid #dc3545;
                            text-align: right;
                            margin-top: 20px;
                        }
                        .error-details code {
                            color: #dc3545;
                            font-family: 'Courier New', monospace;
                            font-size: 0.9rem;
                        }
                        .btn {
                            margin-top: 25px;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            color: white;
                            border: none;
                            border-radius: 10px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 1rem;
                            transition: all 0.3s ease;
                            display: inline-flex;
                            align-items: center;
                            gap: 10px;
                        }
                        .btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <i class="fas fa-exclamation-triangle error-icon"></i>
                        <h3>שגיאה בטעינת קובץ HTML</h3>
                        <p>לא ניתן להציג את תוכן הקובץ</p>
                        <div class="error-details">
                            <code>${error.message}</code>
                        </div>
                        <button class="btn" onclick="parent.proceduresManager.downloadProcedure('${fileName}','${folderPath || ''}')">
                            <i class="fas fa-download"></i>
                            הורד קובץ במקום
                        </button>
                    </div>
                </body>
                </html>
            `;
                            iframe.style.display = 'block';
                        });
                }
                // Other files - show with path
                else {
                    iframe.srcdoc = this.createOfficeFileView(fileName, displayName, extension, fullPath, actualFolderPath);

                    // Hide loader after a short delay
                    iframe.onload = () => {
                        loader.style.display = 'none';
                        iframe.style.display = 'block';
                    };
                }

                this.setupMessageListener();
            })
            .catch(error => {
                console.error('Error getting file path:', error);

                // Fallback
                if (['doc', 'docx', 'xls', 'xlsx', 'txt'].includes(extension)) {
                    this.loadConvertedFile(viewUrl, iframe, fileName, 'נתיב לא זמין', loader);
                } else if (extension === 'pdf') {
                    iframe.src = viewUrl;
                    iframe.onload = () => {
                        loader.style.display = 'none';
                        iframe.style.display = 'block';
                    };
                } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
                    iframe.srcdoc = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <style>
                            * { margin: 0; padding: 0; box-sizing: border-box; }
                            body {
                                background: #2c3e50;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                min-height: 100vh;
                                padding: 20px;
                            }
                            img {
                                max-width: 100%;
                                max-height: calc(100vh - 40px);
                                height: auto;
                                border-radius: 10px;
                                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                            }
                        </style>
                    </head>
                    <body>
                        <img src="${viewUrl}" alt="${displayName}">
                    </body>
                    </html>
                `;
                    iframe.onload = () => {
                        setTimeout(() => {
                            loader.style.display = 'none';
                            iframe.style.display = 'block';
                        }, 300);
                    };

                } else if (['html', 'htm'].includes(extension)) {
                    // HTML fallback
                    fetch(viewUrl)
                        .then(response => response.text())
                        .then(htmlContent => {
                            iframe.srcdoc = htmlContent;
                            iframe.onload = () => {
                                loader.style.display = 'none';
                                iframe.style.display = 'block';
                            };
                        })
                        .catch(() => {
                            iframe.srcdoc = this.createOfficeFileView(fileName, displayName, extension, 'נתיב לא זמין');
                            iframe.onload = () => {
                                loader.style.display = 'none';
                                iframe.style.display = 'block';
                            };
                        });
                } else {
                    iframe.srcdoc = this.createOfficeFileView(fileName, displayName, extension, 'נתיב לא זמין');
                    iframe.onload = () => {
                        loader.style.display = 'none';
                        iframe.style.display = 'block';
                    };
                }

                this.setupMessageListener();
            });
    }

    // Load converted Word/Excel/Text files
    loadConvertedFile(url, iframe, fileName, fullPath, loader, folderPath = '') {
        fetch(url)
            .then(response => {
                if (!response.ok) {
                    throw new Error('שגיאה בטעינת הקובץ');
                }
                return response.text();
            })
            .then(text => {
                iframe.srcdoc = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            background: #f8fafc;
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            min-height: 100vh;
                            display: flex;
                            flex-direction: column;
                        }

                        .text-file-header {
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            padding: 20px 30px;
                            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                            position: sticky;
                            top: 0;
                            z-index: 100;
                        }

                        .header-content {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            gap: 20px;
                            flex-wrap: wrap;
                        }

                        .file-info {
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            color: white;
                        }

                        .file-info i {
                            font-size: 1.5rem;
                        }

                        .file-info span {
                            font-size: 1.1rem;
                            font-weight: 600;
                        }

                        .header-actions {
                            display: flex;
                            gap: 10px;
                            flex-wrap: wrap;
                        }

                        .header-btn {
                            padding: 10px 18px;
                            background: rgba(255, 255, 255, 0.2);
                            border: 2px solid rgba(255, 255, 255, 0.3);
                            color: white;
                            border-radius: 10px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 0.9rem;
                            transition: all 0.3s ease;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            backdrop-filter: blur(10px);
                        }

                        .header-btn:hover {
                            background: rgba(255, 255, 255, 0.3);
                            border-color: rgba(255, 255, 255, 0.5);
                            transform: translateY(-2px);
                            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                        }

                        .header-btn:active {
                            transform: translateY(0);
                        }

                        .header-btn.copied {
                            background: rgba(16, 185, 129, 0.3);
                            border-color: rgba(16, 185, 129, 0.5);
                        }

                        .header-btn i {
                            font-size: 1rem;
                        }

                        .path-display {
                            background: rgba(255, 255, 255, 0.15);
                            padding: 12px 16px;
                            border-radius: 8px;
                            color: white;
                            font-family: 'Courier New', monospace;
                            font-size: 0.85rem;
                            word-break: break-all;
                            margin-top: 10px;
                            border: 1px solid rgba(255, 255, 255, 0.2);
                            direction: ltr;
                            text-align: left;
                        }

                        .text-content {
                            flex: 1;
                            padding: 30px;
                            overflow: auto;
                        }

                        pre {
                            background: white;
                            padding: 25px;
                            border-radius: 12px;
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                            border: 1px solid #e2e8f0;
                            font-family: 'Courier New', monospace;
                            color: #1e293b;
                            line-height: 1.8;
                            font-size: 14px;
                            white-space: pre-wrap;
                            word-wrap: break-word;
                            margin: 0;
                        }

                        ::-webkit-scrollbar {
                            width: 10px;
                            height: 10px;
                        }

                        ::-webkit-scrollbar-track {
                            background: #f1f5f9;
                        }

                        ::-webkit-scrollbar-thumb {
                            background: #cbd5e1;
                            border-radius: 5px;
                        }

                        ::-webkit-scrollbar-thumb:hover {
                            background: #94a3b8;
                        }

                        @media (max-width: 768px) {
                            .text-file-header {
                                padding: 15px 20px;
                            }

                            .header-content {
                                flex-direction: column;
                                align-items: stretch;
                            }

                            .header-actions {
                                width: 100%;
                            }

                            .header-btn {
                                flex: 1;
                                justify-content: center;
                            }

                            .text-content {
                                padding: 20px;
                            }

                            pre {
                                padding: 15px;
                                font-size: 12px;
                            }
                        }
                    </style>
                </head>
                <body>
                    <div class="text-file-header">
                        <div class="header-content">
                            <div class="file-info">
                                <i class="fas fa-file-alt"></i>
                                <span>${fileName}</span>
                            </div>
                            <div class="header-actions">
                                <button class="header-btn" onclick="copyPath()" id="copyBtn">
                                    <i class="fas fa-copy"></i>
                                    העתק נתיב
                                </button>
                                <button class="header-btn" onclick="downloadFile()">
                                    <i class="fas fa-download"></i>
                                    הורד קובץ
                                </button>
                                <button class="header-btn" onclick="refreshDocument()" id="refreshDocBtn">
                                    <i class="fas fa-sync-alt"></i>
                                    רענן מסמך
                                </button>
                            </div>
                        </div>
                        <div class="path-display" id="pathDisplay">${fullPath}</div>
                    </div>
                    
                    <div class="text-content">
                        <pre>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
                    </div>

                    <script>
                        function copyPath() {
                            const pathText = document.getElementById('pathDisplay').textContent;
                            const btn = document.getElementById('copyBtn');

                            const textarea = document.createElement('textarea');
                            textarea.value = pathText;
                            textarea.style.position = 'fixed';
                            textarea.style.opacity = '0';
                            document.body.appendChild(textarea);

                            textarea.select();
                            textarea.setSelectionRange(0, 99999);

                            try {
                                document.execCommand('copy');

                                btn.classList.add('copied');
                                btn.innerHTML = '<i class="fas fa-check"></i> הועתק!';

                                setTimeout(() => {
                                    btn.classList.remove('copied');
                                    btn.innerHTML = '<i class="fas fa-copy"></i> העתק נתיב';
                                }, 2000);

                            } catch (err) {
                                console.error('Copy failed:', err);
                                alert('שגיאה בהעתקת הנתיב');
                            }

                            document.body.removeChild(textarea);
                        }

                        function downloadFile() {
                            parent.postMessage({
                                action: 'download',
                                fileName: '${fileName}',
                                folderPath: '${folderPath}'
                            }, '*');
                        }
                    </script>
                </body>
                </html>
            `;

                // Hide loader when content is ready
                iframe.onload = () => {
                    if (loader) {
                        loader.style.display = 'none';
                    }
                    iframe.style.display = 'block';
                };
            })
            .catch(error => {
                console.error('Error loading file:', error);
                iframe.srcdoc = `
                <!DOCTYPE html>
                <html dir="rtl">
                <head>
                    <meta charset="UTF-8">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            background: linear-gradient(135deg, #fff5f5 0%, #ffe0e0 100%);
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 20px;
                        }
                        .error-container {
                            text-align: center;
                            max-width: 600px;
                            width: 100%;
                            background: white;
                            padding: 50px 40px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
                        }
                        .error-icon {
                            font-size: 5rem;
                            color: #dc3545;
                            margin-bottom: 25px;
                            animation: shake 0.5s;
                        }
                        @keyframes shake {
                            0%, 100% { transform: translateX(0); }
                            25% { transform: translateX(-10px); }
                            75% { transform: translateX(10px); }
                        }
                        h3 {
                            color: #320F5B;
                            font-size: 1.8rem;
                            font-weight: bold;
                            margin-bottom: 15px;
                        }
                        p {
                            color: #666;
                            font-size: 1.1rem;
                            line-height: 1.6;
                            margin-bottom: 25px;
                        }
                        .error-details {
                            background: #f8f9fa;
                            padding: 15px;
                            border-radius: 10px;
                            border-right: 4px solid #dc3545;
                            text-align: right;
                            margin-top: 20px;
                        }
                        .error-details code {
                            color: #dc3545;
                            font-family: 'Courier New', monospace;
                            font-size: 0.9rem;
                        }
                        .retry-btn {
                            margin-top: 25px;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea, #764ba2);
                            color: white;
                            border: none;
                            border-radius: 10px;
                            cursor: pointer;
                            font-weight: 600;
                            font-size: 1rem;
                            transition: all 0.3s ease;
                            display: inline-flex;
                            align-items: center;
                            gap: 10px;
                        }
                        .retry-btn:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <i class="fas fa-exclamation-triangle error-icon"></i>
                        <h3>שגיאה בטעינת הקובץ</h3>
                        <p>לא ניתן להציג את תוכן הקובץ</p>
                        <div class="error-details">
                            <code>${error.message}</code>
                        </div>
                        <button class="retry-btn" onclick="downloadFile()">
                            <i class="fas fa-download"></i>
                            הורד קובץ במקום
                        </button>
                    </div>

                    <script>
                        function downloadFile() {
                            parent.postMessage({
                                action: 'download',
                                fileName: '${fileName}',
                                folderPath: '${folderPath}'
                            }, '*');
                        }
                        function refreshDocument() {
                            // שלח הודעה לאב - הכפתור יוחלף ממילא כשה-iframe ייטען מחדש
                            parent.postMessage({
                                action: 'refresh',
                                fileName: '${fileName}',
                                folderPath: '${folderPath || ''}'
                            }, '*');
                        }
                    </script>
                </body>
                </html>
            `;
            });
    }

    // Create Office file view with path and download
    createOfficeFileView(fileName, displayName, extension, fullPath) {
        return `
    <!DOCTYPE html>
    <html dir="rtl">
    <head>
        <meta charset="UTF-8">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <link rel="stylesheet" href="/css/noc-portal.css">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                background: #f8fafc;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                min-height: 100vh;
                display: flex;
                flex-direction: column;
            }

            .text-file-header {
                background: linear-gradient(135deg, #667eea, #764ba2);
                padding: 20px 30px;
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                position: sticky;
                top: 0;
                z-index: 100;
            }

            .header-content {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 20px;
                flex-wrap: wrap;
            }

            .file-info {
                display: flex;
                align-items: center;
                gap: 12px;
                color: white;
            }

            .file-info i {
                font-size: 1.5rem;
            }

            .file-info span {
                font-size: 1.1rem;
                font-weight: 600;
            }

            .header-actions {
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }

            .header-btn {
                padding: 10px 18px;
                background: rgba(255, 255, 255, 0.2);
                border: 2px solid rgba(255, 255, 255, 0.3);
                color: white;
                border-radius: 10px;
                cursor: pointer;
                font-weight: 600;
                font-size: 0.9rem;
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                gap: 8px;
                backdrop-filter: blur(10px);
            }

            .header-btn:hover {
                background: rgba(255, 255, 255, 0.3);
                border-color: rgba(255, 255, 255, 0.5);
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            }

            .header-btn:active {
                transform: translateY(0);
            }

            .header-btn.copied {
                background: rgba(16, 185, 129, 0.3);
                border-color: rgba(16, 185, 129, 0.5);
            }

            .header-btn i {
                font-size: 1rem;
            }

            .path-display {
                background: rgba(255, 255, 255, 0.15);
                padding: 12px 16px;
                border-radius: 8px;
                color: white;
                font-family: 'Courier New', monospace;
                font-size: 0.85rem;
                word-break: break-all;
                margin-top: 10px;
                border: 1px solid rgba(255, 255, 255, 0.2);
                direction: ltr;
                text-align: left;
            }

            .file-message {
                flex: 1;
                padding: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .message-box {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
                border: 1px solid #e2e8f0;
                text-align: center;
                max-width: 500px;
            }

            .message-box i {
                font-size: 3rem;
                color: #667eea;
                margin-bottom: 20px;
            }

            .message-box h3 {
                color: #320F5B;
                font-size: 1.5rem;
                margin-bottom: 15px;
            }

            .message-box p {
                color: #666;
                font-size: 1rem;
                line-height: 1.6;
            }

            ::-webkit-scrollbar {
                width: 10px;
                height: 10px;
            }

            ::-webkit-scrollbar-track {
                background: #f1f5f9;
            }

            ::-webkit-scrollbar-thumb {
                background: #cbd5e1;
                border-radius: 5px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
            }

            @media (max-width: 768px) {
                .text-file-header {
                    padding: 15px 20px;
                }

                .header-content {
                    flex-direction: column;
                    align-items: stretch;
                }

                .header-actions {
                    width: 100%;
                }

                .header-btn {
                    flex: 1;
                    justify-content: center;
                }

                .file-message {
                    padding: 20px;
                }

                .message-box {
                    padding: 30px 20px;
                }
            }
        </style>
    </head>
    <body>
        <div class="text-file-header">
            <div class="header-content">
                <div class="file-info">
                    <i class="fas fa-file-alt"></i>
                    <span>${displayName}</span>
                </div>
                <div class="header-actions">
                    <button class="header-btn" onclick="copyPath()" id="copyBtn">
                        <i class="fas fa-copy"></i>
                        העתק נתיב
                    </button>
                    <button class="header-btn" onclick="downloadFile()">
                        <i class="fas fa-download"></i>
                        הורד קובץ
                    </button>
                    <button class="header-btn" onclick="refreshDocument()" id="refreshDocBtn">
                        <i class="fas fa-sync-alt"></i>
                        רענן מסמך
                    </button>
                </div>
            </div>
            <div class="path-display" id="pathDisplay">${fullPath}</div>
        </div>

        <div class="file-message">
            <div class="message-box">
                <i class="fas fa-info-circle"></i>
                <h3>קובץ זה אינו נתמך לתצוגה ישירה</h3>
                <p>השתמש בכפתור "הורד קובץ" למעלה או העתק את הנתיב לפתיחה ישירה מהרשת</p>
            </div>
        </div>

        <script>
            function copyPath() {
                const pathText = document.getElementById('pathDisplay').textContent;
                const btn = document.getElementById('copyBtn');

                const textarea = document.createElement('textarea');
                textarea.value = pathText;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);

                textarea.select();
                textarea.setSelectionRange(0, 99999);

                try {
                    document.execCommand('copy');

                    btn.classList.add('copied');
                    btn.innerHTML = '<i class="fas fa-check"></i> הועתק!';

                    setTimeout(() => {
                        btn.classList.remove('copied');
                        btn.innerHTML = '<i class="fas fa-copy"></i> העתק נתיב';
                    }, 2000);

                } catch (err) {
                    console.error('Copy failed:', err);
                    alert('שגיאה בהעתקת הנתיב');
                }

                document.body.removeChild(textarea);
            }

            function downloadFile() {
                parent.postMessage({
                    action: 'download',
                    fileName: '${fileName}',
                    folderPath: '${folderPath}'
                }, '*');
            }
            function refreshDocument() {
                // שלח הודעה לאב - הכפתור יוחלף ממילא כשה-iframe ייטען מחדש
                parent.postMessage({
                    action: 'refresh',
                    fileName: '${fileName}',
                    folderPath: '${folderPath || ''}'
                }, '*');
            }
        </script>
    </body>
    </html>
`;
    }

    // Setup message listener for iframe communication
    setupMessageListener() {
        // Remove existing listener if any
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener);
        }

        // Create new listener
        this.messageListener = (event) => {
            if (event.data && event.data.action) {
                const { action, fileName, folderPath } = event.data;

                if (action === 'download') {
                    this.downloadProcedure(fileName, folderPath || '');
                } else if (action === 'edit') {
                    this.editProcedure(fileName, folderPath || '');
                } else if (action === 'refresh') {
                    // ריענון - קרא ישירות ללא await
                    this.refreshCurrentProcedure();
                }
            }
        };

        window.addEventListener('message', this.messageListener);
    }

    // Helper method to get Office icon
    getOfficeIcon(extension) {
        const iconMap = {
            'doc': 'word',
            'docx': 'word',
            'xls': 'excel',
            'xlsx': 'excel',
            'csv': 'excel',
            'ppt': 'powerpoint',
            'pptx': 'powerpoint'
        };
        return iconMap[extension] || 'alt';
    }

    // Close modal
    closeSimpleDocumentModal() {
        this.isModalOpen = false;
        // Get current file name and folder before closing
        const titleElement = document.getElementById('simpleDocumentTitle');
        const currentFileName = titleElement.getAttribute('data-filename');
        const currentFolder = titleElement.getAttribute('data-folder') || '';

        // Close modal
        document.getElementById('simpleDocumentModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('simpleDocumentFrame').src = 'about:blank';

        // Remove message listener
        if (this.messageListener) {
            window.removeEventListener('message', this.messageListener);
            this.messageListener = null;
        }
    }

    // New method to delete cached PDF
    async deleteCachedPdf(fileName) {
        try {
            const extension = fileName.split('.').pop().toLowerCase();

            // Only delete cache for Word/Excel files
            if (['doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
                const response = await fetch(`/Procedures/DeleteCachedPdf?fileName=${encodeURIComponent(fileName)}`, {
                    method: 'DELETE'
                });

                const result = await response.json();
            }
        } catch (error) {
            console.error('Error deleting cached PDF:', error);
            // Don't show error to user - this is background cleanup
        }
    }

    // Edit procedure
    editProcedure(fileName) {
        try {
            const editUrl = `/Procedures/EditFile?fileName=${encodeURIComponent(fileName)}`;

            fetch(editUrl, { method: 'POST' })
                .then(response => response.json())
                .then(result => {
                    if (result.success) {
                        NotificationManager.show(`פותח לעריכה: ${fileName}`, 'success');
                    } else {
                        // If can't open for edit, download instead
                        NotificationManager.show('לא ניתן לפתוח לעריכה אוטומטית. מוריד קובץ...', 'info');
                        this.downloadProcedure(fileName);
                    }
                })
                .catch(error => {
                    console.error('Error opening for edit:', error);
                    NotificationManager.show('שגיאה בפתיחה לעריכה. מוריד קובץ...', 'error');
                    this.downloadProcedure(fileName);
                });
        } catch (error) {
            console.error('Error editing procedure:', error);
            NotificationManager.show('שגיאה בפתיחת הקובץ לעריכה', 'error');
        }
    }

    // Update createProcedureCard method
    createProcedureCard(procedure) {
        return `
     <div class="procedure-card" data-filename="${procedure.fileName}" data-folder="${procedure.folder || ''}">
        <div class="procedure-actions">
            <button class="procedure-action-btn delete"
                onclick="event.stopPropagation(); proceduresManager.deleteProcedure('${procedure.fileName}', '${procedure.folder || ''}')"
                title="מחק נוהל">
                <i class="fas fa-trash"></i>
            </button>
        </div>
        <div class="procedure-icon" onclick="proceduresManager.viewProcedureInModal('${procedure.fileName}', '${procedure.folder || ''}')">
            <i class="${procedure.icon}"></i>
        </div>
        <div class="procedure-name" onclick="proceduresManager.viewProcedureInModal('${procedure.fileName}', '${procedure.folder || ''}')">${procedure.name}</div>
        <div class="procedure-info">
            <span class="procedure-size">
                <span class="procedure-info-label">גודל</span>
                <span class="procedure-info-value">
                    <i class="fas fa-hdd"></i>
                    ${procedure.size}
                </span>
            </span>
            <span class="procedure-date">
                <span class="procedure-info-label">עודכן</span>
                <span class="procedure-info-value">
                    <i class="fas fa-calendar"></i>
                    ${procedure.lastModified}
                </span>
            </span>
            ${procedure.modifiedBy ? `
                <span class="procedure-user">
                    <span class="procedure-info-label">נערך ע"י</span>
                    <span class="procedure-info-value">
                        <i class="fas fa-user"></i>
                        ${procedure.modifiedBy}
                    </span>
                </span>
            ` : ''}
        </div>

        <div class="procedure-card-actions">
            <button class="procedure-card-action-btn view"
                    onclick="event.stopPropagation(); proceduresManager.viewProcedureInModal('${procedure.fileName}', '${procedure.folder || ''}')"
                    title="צפייה בנוהל">
                <i class="fas fa-eye"></i>
                צפייה
            </button>
            <button class="procedure-card-action-btn download" 
                    onclick="event.stopPropagation(); proceduresManager.downloadProcedure('${procedure.fileName}', '${procedure.folder || ''}')"
                    title="הורדת נוהל">
                <i class="fas fa-download"></i>
                הורדה
            </button>
        </div>
    </div>`;
    }

    // Download procedure
    downloadProcedure(fileName, folderPath = '') {
        try {
            let downloadUrl = `/Procedures/DownloadFile?fileName=${encodeURIComponent(fileName)}`;

            if (folderPath) {
                downloadUrl += `&folderPath=${encodeURIComponent(folderPath)}`;
            }

            const newWindow = window.open(downloadUrl, '_blank');

            if (!newWindow || newWindow.closed || typeof newWindow.closed == 'undefined') {
                const link = document.createElement('a');
                link.href = downloadUrl;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }

            NotificationManager.show(`פותח קובץ: ${fileName}`, 'success');
        } catch (error) {
            console.error('Error opening procedure:', error);
            NotificationManager.show('שגיאה בפתיחת הקובץ', 'error');
        }
    }

    // New helper method to load PDF in iframe
    loadPdfInIframe(viewUrl, iframe, fileName, loader, fullPath = null, folderPath = '') {
        iframe.src = 'about:blank';
        iframe.srcdoc = '';

        loader.style.display = 'flex';
        iframe.style.display = 'none';

        // If fullPath not provided, try to get it
        if (!fullPath) {
            const encodedFileName = encodeURIComponent(fileName);
            const encodedFolderPath = folderPath ? encodeURIComponent(folderPath) : '';
            const editUrl = folderPath ?
                `/Procedures/EditFile?fileName=${encodedFileName}&folderPath=${encodedFolderPath}` :
                `/Procedures/EditFile?fileName=${encodedFileName}`;

            fetch(editUrl, { method: 'POST' })
                .then(response => response.json())
                .then(result => {
                    fullPath = result.fullPath || 'נתיב לא זמין';
                    this.renderPdfWithHeader(viewUrl, iframe, fileName, loader, fullPath, folderPath);
                })
                .catch(() => {
                    this.renderPdfWithHeader(viewUrl, iframe, fileName, loader, 'נתיב לא זמין', folderPath);
                });
        } else {
            this.renderPdfWithHeader(viewUrl, iframe, fileName, loader, fullPath, folderPath);
        }
    }

    // ==========================================
    // 4. הוסף פונקציה חדשה: refreshCurrentProcedure
    // מחיקת קאש וטעינה מחדש של המסמך הנוכחי
    // ==========================================
    async refreshCurrentProcedure() {
        const titleElement = document.getElementById('simpleDocumentTitle');
        const fileName = titleElement.getAttribute('data-filename');
        const folderPath = titleElement.getAttribute('data-folder') || '';

        if (!fileName) return;

        // עדכן כפתור ריענון חיצוני (מחוץ ל-iframe) אם קיים
        const refreshBtn = document.getElementById('refreshProcedureBtn');
        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            refreshBtn.title = 'מרענן...';
        }

        try {
            // מחק קאש PDF אם קיים
            const extension = fileName.split('.').pop().toLowerCase();
            if (['doc', 'docx', 'xls', 'xlsx'].includes(extension)) {
                const encodedFileName = encodeURIComponent(fileName);
                const encodedFolderPath = folderPath ? encodeURIComponent(folderPath) : '';
                const deleteUrl = folderPath
                    ? `/Procedures/DeleteCachedPdf?fileName=${encodedFileName}&folderPath=${encodedFolderPath}`
                    : `/Procedures/DeleteCachedPdf?fileName=${encodedFileName}`;

                const deleteResult = await fetch(deleteUrl, { method: 'DELETE' });
                const deleteData = await deleteResult.json();

                // *** תיקון: המתן לאחר מחיקת הקאש ***
                if (deleteData.success) {
                    // המתן 500ms לוודא שהשרת סיים את המחיקה
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            // *** תיקון: הוסף cache-busting parameter לכתובת ***
            // על ידי שמירת timestamp ושימוש בו בטעינה
            this._refreshTimestamp = Date.now();

            this.viewProcedureInModal(fileName, folderPath);

            NotificationManager.show('המסמך רוענן בהצלחה', 'success');

        } catch (error) {
            console.error('Error refreshing procedure:', error);
            NotificationManager.show('שגיאה בריענון המסמך', 'error');

        } finally {
            // שחזר כפתור חיצוני
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
                refreshBtn.title = 'רענן מסמך';
            }
        }
    }

    // Render PDF iframe with header and actions
    renderPdfWithHeader(viewUrl, iframe, fileName, loader, fullPath, folderPath = '') {
        iframe.srcdoc = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head>
            <meta charset="UTF-8">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    background: #f8fafc;
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }
                .pdf-header {
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    padding: 20px 30px;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
                    z-index: 100;
                }
                .header-content {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 20px;
                    flex-wrap: wrap;
                }
                .header-actions { display: flex; gap: 10px; flex-wrap: wrap; }
                .header-btn {
                    padding: 10px 18px;
                    background: rgba(255, 255, 255, 0.2);
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    color: white;
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 0.9rem;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    backdrop-filter: blur(10px);
                }
                .header-btn:hover {
                    background: rgba(255, 255, 255, 0.3);
                    border-color: rgba(255, 255, 255, 0.5);
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                }
                .header-btn:active { transform: translateY(0); }
                .header-btn.copied {
                    background: rgba(16, 185, 129, 0.3);
                    border-color: rgba(16, 185, 129, 0.5);
                }
                .header-btn i { font-size: 1rem; }
                .path-display {
                    background: rgba(255, 255, 255, 0.15);
                    padding: 12px 16px;
                    border-radius: 8px;
                    color: white;
                    font-family: 'Segoe UI', 'Consolas', 'Monaco', monospace;
                    font-size: 0.9rem;
                    font-weight: 500;
                    word-break: break-all;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    direction: ltr;
                    text-align: left;
                    flex: 1;
                    max-width: 90%;
                    line-height: 1.4;
                    letter-spacing: 0.3px;
                }
                #pdf-container {
                    flex: 1;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                }
                embed, object {
                    width: 100%;
                    height: 100%;
                    border: none;
                    display: none;
                }
                embed.loaded, object.loaded {
                    display: block;
                }

                /* Loader Styles */
                .loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                    z-index: 10;
                }
                .loading.hidden {
                    display: none;
                }
                .spinner {
                    width: 60px;
                    height: 60px;
                    border: 5px solid rgba(255, 255, 255, 0.2);
                    border-top: 5px solid white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .error-container {
                    display: none;
                    text-align: center;
                    padding: 40px;
                }
                .error-btn {
                    padding: 12px 30px;
                    background: linear-gradient(135deg, #667eea, #764ba2);
                    color: white;
                    border: none;
                    border-radius: 10px;
                    cursor: pointer;
                    font-weight: 600;
                    font-size: 1rem;
                    transition: all 0.3s ease;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    font-family: 'Segoe UI', Arial, sans-serif;
                }
                /* Loader Styles - Enhanced */
                .loading {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    text-align: center;
                    z-index: 1;
                    background: rgba(44, 62, 80, 0.95);
                    padding: 40px 60px;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }

                .loading.hidden {
                    opacity: 0;
                    pointer-events: none;
                }

                .spinner {
                    width: 60px;
                    height: 60px;
                    border: 5px solid rgba(255, 255, 255, 0.2);
                    border-top: 5px solid white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin-bottom: 20px;
                }

                .loading-text {
                    color: white;
                    font-size: 1.2rem;
                    font-weight: 600;
                    margin-bottom: 10px;
                }

                .loading-subtext {
                    color: rgba(255, 255, 255, 0.7);
                    font-size: 0.9rem;
                }

                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }

                @media (max-width: 768px) {
                    .pdf-header { padding: 15px 20px; }
                    .header-content { flex-direction: column; align-items: stretch; }
                    .header-actions { width: 100%; }
                    .header-btn { flex: 1; justify-content: center; }
                    .path-display { max-width: 100%; }
                    .error-box { padding: 30px 20px; }
                    .error-icon { font-size: 3.5rem; }
                    .error-title { font-size: 1.4rem; }
                    .error-message { font-size: 1rem; }
                    .error-actions { flex-direction: column; }
                    .error-btn { width: 100%; justify-content: center; }
                }
            </style>
        </head>
        <body>
            <div class="pdf-header">
                <div class="header-content">
                    <div class="path-display" id="pathDisplay">${fullPath}</div>
                    <div class="header-actions">
                        <button class="header-btn" onclick="copyPath()" id="copyBtn">
                            <i class="fas fa-copy"></i>
                            העתק נתיב
                        </button>
                        <button class="header-btn" onclick="downloadFile()">
                            <i class="fas fa-download"></i>
                            הורד קובץ
                        </button>
                        <button class="header-btn" onclick="refreshDocument()" id="refreshDocBtn">
                            <i class="fas fa-sync-alt"></i>
                            רענן מסמך
                        </button>
                    </div>
                </div>
            </div>

            <div id="pdf-container">
                <!-- Loader -->
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <div class="loading-text">טוען PDF...</div>
                    <div class="loading-subtext">אנא המתן</div>
                </div>
                <embed id="pdf-embed" 
                    src="${viewUrl}#toolbar=1&navpanes=1&scrollbar=1"
                    type="application/pdf"
                    style="display: none;">

                <div class="error-container" id="error">
                    <div class="error-icon">⚠️</div>
                    <h2>לא ניתן להציג את ה-PDF</h2>
                    <p>הדפדפן שלך לא תומך בתצוגת PDF מוטמעת</p>
                    <button class="btn" onclick="openInNewTab()">פתח בחלון חדש</button>
                    <button class="btn" onclick="downloadFile()">הורד קובץ</button>
            </div>

            <script>
                const pdfEmbed = document.getElementById('pdf-embed');
                const loading = document.getElementById('loading');
                const errorDiv = document.getElementById('error');

                let loadTimeout;
                let loaded = false;

                pdfEmbed.style.display = 'block';

                loadTimeout = setTimeout(() => {
                    if (!loaded) {
                        loading.classList.add('hidden');
                        pdfEmbed.style.display = 'none';
                        errorDiv.style.display = 'block';
                    }
                }, 20000);

                pdfEmbed.onload = () => {
                    clearTimeout(loadTimeout);
                    loaded = true;
                    loading.classList.add('hidden');
                };

                pdfEmbed.onerror = () => {
                    clearTimeout(loadTimeout);
                    loading.classList.add('hidden');
                    pdfEmbed.style.display = 'none';
                    errorDiv.style.display = 'block';
                };

                function copyPath() {
                    const pathText = document.getElementById('pathDisplay').textContent;
                    const btn = document.getElementById('copyBtn');

                    const textarea = document.createElement('textarea');
                    textarea.value = pathText;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);

                    textarea.select();
                    textarea.setSelectionRange(0, 99999);

                    try {
                        document.execCommand('copy');
                        btn.classList.add('copied');
                        btn.innerHTML = '<i class="fas fa-check"></i> הועתק!';

                        setTimeout(() => {
                            btn.classList.remove('copied');
                            btn.innerHTML = '<i class="fas fa-copy"></i> העתק נתיב';
                        }, 2000);
                    } catch (err) {
                        console.error('Copy failed:', err);
                        alert('שגיאה בהעתקת הנתיב');
                    }

                    document.body.removeChild(textarea);
                }

                function openInNewTab() {
                    window.open('${viewUrl}', '_blank');
                }
                
                function downloadFile() {
                    parent.postMessage({
                        action: 'download',
                        fileName: '${fileName}',
                        folderPath: '${folderPath || ''}'
                    }, '*');
                }
                function refreshDocument() {
                    // שלח הודעה לאב - הכפתור יוחלף ממילא כשה-iframe ייטען מחדש
                    parent.postMessage({
                        action: 'refresh',
                        fileName: '${fileName}',
                        folderPath: '${folderPath || ''}'
                    }, '*');
                }
            </script>
        </body>
        </html>
    `;

        // Listen for PDF loaded message
        const messageHandler = (event) => {
            if (event.data && event.data.action === 'pdfLoaded') {
                loader.style.display = 'none';
                iframe.style.display = 'block';
                window.removeEventListener('message', messageHandler);
            }
        };

        window.addEventListener('message', messageHandler);

        iframe.onload = () => {
            setTimeout(() => {
                if (loader.style.display !== 'none') {
                    loader.style.display = 'none';
                    iframe.style.display = 'block';
                }
            }, 2000);
        };
    }

    // Setup drag and drop for file upload
    setupDragAndDrop() {
        const fileInput = document.getElementById('procedureFileInput');
        const uploadLabel = document.querySelector('#uploadProcedureModal .file-upload-label');

        if (!fileInput || !uploadLabel) {
            console.error('Elements not found:', { fileInput, uploadLabel });
            return;
        }

        // Prevent default behavior for drag events on entire document
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // Handle drag over upload area
        uploadLabel.addEventListener('dragenter', (e) => {
            uploadLabel.classList.add('drag-over');

        });

        uploadLabel.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadLabel.classList.add('drag-over');
        });

        uploadLabel.addEventListener('dragleave', (e) => {
            // Only remove if leaving the upload area completely
            if (e.target === uploadLabel) {
                uploadLabel.classList.remove('drag-over');
            }
        });

        // Handle file drop
        uploadLabel.addEventListener('drop', (e) => {
            e.preventDefault();

            uploadLabel.classList.remove('drag-over');

            const files = e.dataTransfer.files;

            if (files && files.length > 0) {
                // Set files to input
                fileInput.files = files;

                // Manually trigger handleFileSelect
                this.handleFileSelect({ target: fileInput });
            }
        });
    }

    // עדכון - פתיחה עם הכל מורחב
    async openQuickProceduresModal() {
        this.isModalOpen = true;
        const modal = document.getElementById('quickProceduresModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        document.getElementById('quickProceduresContainer').innerHTML = `
        <div class="quick-procedures-loading">
            <i class="fas fa-spinner fa-spin"></i>
            <span>טוען נהלים מהירים...</span>
        </div>
    `;

        await this.loadQuickProcedures();

        // פתיחה עם allExpanded = true
        this.renderQuickProcedures('', true);
        this._initQuickSearch();

        if (this.employees.length === 0) {
            await this.loadEmployees();
        }
        this.populateEmployeeSelect('aqpUserName');

        // עדכון כפתורים - מצב מורחב ראשוני
        setTimeout(() => this._updateExpandCollapseButtons(true), 100);
    }

    // סגור מודל נהלים מהירים
    closeQuickProceduresModal() {
        this.isModalOpen = false;
        document.getElementById('quickProceduresModal').style.display = 'none';

        // סגור גם מודל הוספה אם פתוח
        this.closeAddQuickProcedureModal();

        document.body.style.overflow = 'auto';
    }

    // טען נהלים מהירים מהשרת
    async loadQuickProcedures() {
        try {
            const response = await fetch('/Procedures/GetQuickProcedures');
            const data = await response.json();
            if (data.error) {
                console.error('Error loading quick procedures:', data.error);
                return;
            }
            this.quickProcedures = data;
        } catch (error) {
            console.error('Error fetching quick procedures:', error);
            this.quickProcedures = [];
        }
    }

    // הצג נהלים מהירים כפתקים
    renderQuickProcedures(filterTerm = '', allExpanded = true) {
        const container = document.getElementById('quickProceduresContainer');

        if (!this.quickProcedures || this.quickProcedures.length === 0) {
            container.innerHTML = `
            <div class="quick-procedures-empty">
                <i class="fas fa-sticky-note"></i>
                <p>אין נהלים מהירים עדיין</p>
                <small>לחץ על "הוסף נוהל מהיר" כדי להתחיל</small>
            </div>
        `;
            return;
        }

        const colors = [
            '#fff9c4', '#fce4ec', '#e8f5e9', '#e3f2fd',
            '#f3e5f5', '#fff3e0', '#e0f7fa', '#fbe9e7'
        ];

        const term = filterTerm.trim().toLowerCase();
        // אם יש חיפוש - תמיד מורחב; אחרת לפי הפרמטר
        const shouldExpand = term !== '' || allExpanded;

        let html = '<div class="quick-procedures-grid">';
        let visibleCount = 0;

        this.quickProcedures.forEach((proc, index) => {
            const color = colors[index % colors.length];

            const titleMatch = term && proc.title.toLowerCase().includes(term);
            const contentMatch = term && (proc.content || '').toLowerCase().includes(term);
            const isMatch = !term || titleMatch || contentMatch;
            if (!isMatch) return;
            visibleCount++;

            const highlightedTitle = term
                ? this._highlight(proc.title, term)
                : this._escapeHtml(proc.title);

            const previewText = this._getPreviewText(proc.content, 30);

            let displayContent = proc.content || '';
            if (term) {
                displayContent = this._highlightInHtml(displayContent, term);
            }

            displayContent = displayContent.replace(
                /<img([^>]*)>/gi,
                (match, attrs) => {
                    attrs = attrs.replace(/\s*onclick="[^"]*"/gi, '');
                    return `<img${attrs} onclick="proceduresManager.openImageLightbox(this.src)" style="cursor:pointer;">`;
                }
            );

            const hasImages = /<img/i.test(proc.content || '');
            const isLongContent = (proc.content || '').length > 500;

            // שימוש ב-shouldExpand במקום isSearchActive
            html += `
            <div class="quick-procedure-note ${shouldExpand ? 'note-expanded' : ''}"
                style="background-color: ${color}; --note-bg: ${color};"
                data-id="${proc.id}"
                ondblclick="proceduresManager.openQuickProcedureViewer('${proc.id}')">
                 
                <div class="quick-note-header">
                    <h4 class="quick-note-title">${highlightedTitle}</h4>
                    <div class="quick-note-actions">
                        <button class="quick-note-btn expand-btn"
                                onclick="proceduresManager.toggleNoteExpand('${proc.id}')"
                                title="הרחב/כווץ">
                            <i class="fas fa-chevron-${shouldExpand ? 'up' : 'down'}"></i>
                        </button>
                        ${hasImages || isLongContent ? `
                            <button class="quick-note-btn view"
                                    onclick="proceduresManager.openQuickProcedureViewer('${proc.id}')"
                                    title="צפה בנוהל">
                                <i class="fas fa-eye"></i>
                            </button>
                            ` : ''}
                        <button class="quick-note-btn edit"
                                onclick="proceduresManager.editQuickProcedure('${proc.id}')"
                                title="ערוך">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="quick-note-btn delete"
                                onclick="proceduresManager.deleteQuickProcedure('${proc.id}')"
                                title="מחק">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>

                <!-- תצוגה מקוצרת -->
                <div class="quick-note-preview" 
                     style="display: ${shouldExpand ? 'none' : 'block'}">
                    ${previewText}
                </div>

                <!-- תוכן מלא -->
                <div class="quick-note-content ${shouldExpand ? '' : 'collapsed-content'}" 
                     id="qnc-${proc.id}">
                    ${displayContent}
                </div>

                <div class="quick-note-footer">
                    <span class="quick-note-date">
                        <i class="fas fa-calendar"></i>
                        ${proc.lastModified || ''}
                    </span>
                    ${proc.modifiedBy ? `
                        <span class="quick-note-author">
                            <i class="fas fa-user"></i>
                            ${proc.modifiedBy}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
        });

        html += '</div>';

        if (term && visibleCount === 0) {
            html = `
            <div class="quick-procedures-empty">
                <i class="fas fa-search"></i>
                <p>לא נמצאו נהלים מהירים עבור "<strong>${this._escapeHtml(term)}</strong>"</p>
            </div>
        `;
        }

        container.innerHTML = html;
        this._checkNotesOverflow();
    }

    openQuickProcedureViewer(id) {
        const proc = this.quickProcedures.find(p => p.id == id);

        if (!proc) return;

        document.getElementById('quickProcedureViewerTitle').textContent =
            proc.title;

        document.getElementById('quickProcedureViewerContent').innerHTML =
            proc.content;

        document.getElementById('quickProcedureViewerModal').style.display = 'flex';
    }

    closeQuickProcedureViewer() {
        document.getElementById('quickProcedureViewerModal').style.display = 'none';
    }

    // הוסף פונקציה חדשה - הרחב הכל
    expandAllNotes() {
        document.querySelectorAll('.quick-procedure-note').forEach(note => {
            const id = note.getAttribute('data-id');
            const content = document.getElementById(`qnc-${id}`);
            const preview = note.querySelector('.quick-note-preview');
            const btn = note.querySelector('.expand-btn i');

            note.classList.add('note-expanded');
            if (content) content.classList.remove('collapsed-content');
            if (preview) preview.style.display = 'none';
            if (btn) btn.className = 'fas fa-chevron-up';
        });
        this._updateExpandCollapseButtons(true);
    }

    // הוסף פונקציה חדשה - כווץ הכל
    collapseAllNotes() {
        document.querySelectorAll('.quick-procedure-note').forEach(note => {
            const id = note.getAttribute('data-id');
            const content = document.getElementById(`qnc-${id}`);
            const preview = note.querySelector('.quick-note-preview');
            const btn = note.querySelector('.expand-btn i');

            note.classList.remove('note-expanded');
            if (content) content.classList.add('collapsed-content');
            if (preview) preview.style.display = 'block';
            if (btn) btn.className = 'fas fa-chevron-down';
        });
        this._updateExpandCollapseButtons(false);
    }

    // עדכון מצב כפתורי הרחב/כווץ הכל
    _updateExpandCollapseButtons(isExpanded) {
        const expandAllBtn = document.getElementById('expandAllNotesBtn');
        const collapseAllBtn = document.getElementById('collapseAllNotesBtn');
        if (expandAllBtn) expandAllBtn.style.display = isExpanded ? 'none' : 'inline-flex';
        if (collapseAllBtn) collapseAllBtn.style.display = isExpanded ? 'inline-flex' : 'none';
    }

    _getPreviewText(htmlContent, maxChars) {
        // הסר תגי HTML לתצוגה מקוצרת
        const temp = document.createElement('div');
        temp.innerHTML = htmlContent || '';
        const text = temp.textContent || temp.innerText || '';
        return text.length > maxChars
            ? this._escapeHtml(text.substring(0, maxChars)) + '...'
            : this._escapeHtml(text);
    }

    toggleNoteExpand(id) {
        const note = document.querySelector(`[data-id="${id}"]`);
        if (!note) return;
        const content = document.getElementById(`qnc-${id}`);
        const preview = note.querySelector('.quick-note-preview');
        const btn = note.querySelector('.expand-btn i');

        const isExpanded = note.classList.contains('note-expanded');

        if (isExpanded) {
            note.classList.remove('note-expanded');
            content.classList.add('collapsed-content');
            preview.style.display = 'block';
            btn.className = 'fas fa-chevron-down';
        } else {
            note.classList.add('note-expanded');
            content.classList.remove('collapsed-content');
            preview.style.display = 'none';
            btn.className = 'fas fa-chevron-up';
        }
    }

    // הדגש טקסט בתוך HTML מבלי לשבור תגים
    _highlightInHtml(html, term) {
        if (!term) return html;
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // הדגש רק טקסט שאינו בתוך תגי HTML
        return html.replace(
            new RegExp(`(?![^<]*>)(${escapedTerm})`, 'gi'),
            '<mark class="quick-highlight">$1</mark>'
        );
    }

    // בדוק אם תוכן הכרטיס גולש ועדכן class
    _checkNotesOverflow() {
        document.querySelectorAll('.quick-note-content').forEach(el => {
            if (el.scrollHeight > el.clientHeight + 5) {
                el.classList.add('has-overflow');
                // קבל צבע רקע מהכרטיס האב
                const card = el.closest('.quick-procedure-note');
                if (card) {
                    const bg = card.style.backgroundColor || 'white';
                    el.style.setProperty('--note-bg', bg);
                }
            } else {
                el.classList.remove('has-overflow');
            }
        });
    }

    // מחק נוהל מהיר
    async deleteQuickProcedure(id) {
        if (!confirm('האם אתה בטוח שברצונך למחוק נוהל מהיר זה?')) return;

        try {
            const response = await fetch(
                `/Procedures/DeleteQuickProcedure?id=${encodeURIComponent(id)}`,
                { method: 'DELETE' }
            );
            const result = await response.json();

            if (result.success) {
                NotificationManager.show('הנוהל המהיר נמחק בהצלחה', 'success');
                await this.loadQuickProcedures();
                this.renderQuickProcedures();
            } else {
                NotificationManager.show(result.error || 'שגיאה במחיקה', 'error');
            }
        } catch (error) {
            console.error('Error deleting quick procedure:', error);
            NotificationManager.show('שגיאה במחיקת הנוהל המהיר', 'error');
        }
    }

    // Escape HTML
    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // הדגש מונח חיפוש
    _highlight(text, term) {
        if (!term) return this._escapeHtml(text);
        const escaped = this._escapeHtml(text);
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return escaped.replace(
            new RegExp(`(${escapedTerm})`, 'gi'),
            '<mark class="quick-highlight">$1</mark>'
        );
    }

    // אתחל חיפוש פנימי במודל
    // עדכון - שמירת מצב הרחבה
    _initQuickSearch() {
        const input = document.getElementById('quickProceduresSearchInput');
        const clearBtn = document.getElementById('clearQuickSearch');
        if (!input) return;

        input.value = '';
        if (clearBtn) clearBtn.classList.remove('visible');

        input.oninput = () => {
            const term = input.value.trim();
            if (clearBtn) clearBtn.classList.toggle('visible', term !== '');
            // בחיפוש - תמיד מורחב; ללא חיפוש - שמור מצב נוכחי
            const isCurrentlyExpanded = document.querySelector('.quick-procedure-note.note-expanded') !== null;
            this.renderQuickProcedures(term, term !== '' ? true : isCurrentlyExpanded);
        };

        if (clearBtn) {
            clearBtn.onclick = () => {
                input.value = '';
                clearBtn.classList.remove('visible');
                // בניקוי חיפוש - שמור מצב מורחב
                this.renderQuickProcedures('', true);
                input.focus();
            };
        }
    }

    // ערוך נוהל מהיר
    editQuickProcedure(id) {
        const proc = this.quickProcedures.find(p => p.id === id);
        if (!proc) return;

        this.openAddQuickProcedureModal(proc);
    }

    // החלף בין מצב קובץ למצב נוהל מהיר
    toggleQuickProcedureMode() {
        const isQuick = document.getElementById('isQuickProcedure').checked;
        const fileSection = document.getElementById('fileUploadSection');
        const quickSection = document.getElementById('quickProcedureSection');
        const uploadBtn = document.getElementById('uploadProcedureBtn');
        const modalTitle = document.querySelector('#uploadProcedureModal .modal-title');

        if (isQuick) {
            if (fileSection) fileSection.style.display = 'none';
            if (quickSection) quickSection.style.display = 'block';
            if (uploadBtn) uploadBtn.innerHTML = '<i class="fas fa-bolt"></i> שמור נוהל מהיר';
            if (modalTitle) modalTitle.textContent = 'הוסף נוהל מהיר';
        } else {
            if (fileSection) fileSection.style.display = 'block';
            if (quickSection) quickSection.style.display = 'none';
            if (uploadBtn) uploadBtn.innerHTML = '<i class="fas fa-upload"></i> העלה נוהל';
            if (modalTitle) modalTitle.textContent = 'העלה נוהל חדש';
        }
    }

    // פתח מודל הוספה/עריכה של נוהל מהיר
    openAddQuickProcedureModal(existingProc = null) {
        const modal = document.getElementById('addQuickProcedureModal');
        if (!modal) return;

        // אפס שדות
        const titleInput = document.getElementById('aqpTitle');
        const editor = document.getElementById('aqpEditor');
        const saveBtn = document.getElementById('aqpSaveBtn');
        const modalTitle = modal.querySelector('.add-quick-modal-header h3');

        if (existingProc) {
            // מצב עריכה
            if (titleInput) titleInput.value = existingProc.title || '';
            if (editor) editor.innerHTML = existingProc.content || '';
            if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-edit"></i> ערוך נוהל מהיר';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור שינויים';
            modal.setAttribute('data-edit-id', existingProc.id);
        } else {
            // מצב הוספה
            if (titleInput) titleInput.value = '';
            if (editor) editor.innerHTML = '';
            if (modalTitle) modalTitle.innerHTML = '<i class="fas fa-bolt"></i> הוסף נוהל מהיר';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור';
            modal.removeAttribute('data-edit-id');
        }

        this._updateAqpCharCounter();
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';

        // פוקוס על שדה הכותרת
        setTimeout(() => { if (titleInput) titleInput.focus(); }, 100);

        // הגדר paste listener לתמונות
        this._setupAqpPasteListener();
    }

    // סגור מודל נוהל מהיר עצמאי
    closeAddQuickProcedureModal() {
        const modal = document.getElementById('addQuickProcedureModal');
        if (!modal) return;
        modal.classList.remove('open');
        modal.removeAttribute('data-edit-id');

        // הסר paste listener
        if (this._aqpPasteHandler) {
            document.removeEventListener('paste', this._aqpPasteHandler);
            this._aqpPasteHandler = null;
        }

        // אם מודל הנהלים המהירים פתוח - אל תשחרר overflow
        const quickModal = document.getElementById('quickProceduresModal');
        if (!quickModal || quickModal.style.display === 'none') {
            document.body.style.overflow = 'auto';
        }
    }

    // שמור נוהל מהיר מהמודל העצמאי
    async saveAddQuickProcedureModal() {
        const modal = document.getElementById('addQuickProcedureModal');
        const titleInput = document.getElementById('aqpTitle');
        const editor = document.getElementById('aqpEditor');
        const saveBtn = document.getElementById('aqpSaveBtn');
        const userSelect = document.getElementById('aqpUserName');

        const title = titleInput ? titleInput.value.trim() : '';
        const content = editor ? editor.innerHTML.trim() : '';
        const editId = modal.getAttribute('data-edit-id') || null;
        const userName = userSelect ? userSelect.value : '';

        if (!title) {
            NotificationManager.show('אנא הכנס כותרת לנוהל המהיר', 'error');
            if (titleInput) titleInput.focus();
            return;
        }

        if (!content || content === '<br>') {
            NotificationManager.show('אנא הכנס תוכן לנוהל המהיר', 'error');
            if (editor) editor.focus();
            return;
        }

        // בדוק גודל (כולל תמונות base64)
        const textOnly = editor ? (editor.innerText || editor.textContent || '') : '';
        if (textOnly.length > 2000) {
            NotificationManager.show('התוכן ארוך מדי (מקסימום 2000 תווים)', 'error');
            return;
        }

        const originalHtml = saveBtn ? saveBtn.innerHTML : '';
        try {
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
            }

            const payload = {
                title: title,
                content: content,
                userName: userName,
                id: editId
            };

            const response = await fetch('/Procedures/SaveQuickProcedure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(
                    editId ? 'הנוהל המהיר עודכן בהצלחה' : 'הנוהל המהיר נשמר בהצלחה',
                    'success'
                );
                this.closeAddQuickProcedureModal();

                // רענן את הרשימה אם המודל פתוח
                const quickModal = document.getElementById('quickProceduresModal');
                if (quickModal && quickModal.style.display !== 'none') {
                    await this.loadQuickProcedures();
                    this.renderQuickProcedures();
                }
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירה', 'error');
            }
        } catch (error) {
            console.error('Error saving quick procedure:', error);
            NotificationManager.show('שגיאה בשמירת הנוהל המהיר', 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = originalHtml;
            }
        }
    }

    // עדכן מונה תווים
    _updateAqpCharCounter() {
        const editor = document.getElementById('aqpEditor');
        const counter = document.getElementById('aqpCharCount');
        if (!editor || !counter) return;

        const text = editor.innerText || editor.textContent || '';
        const len = text.length;
        counter.textContent = `${len} תווים`;
        counter.parentElement.classList.toggle('warning', len > 1800);
    }

    // הגדר paste listener לתמונות
    _setupAqpPasteListener() {
        // הסר listener קיים
        if (this._aqpPasteHandler) {
            document.removeEventListener('paste', this._aqpPasteHandler);
        }

        this._aqpPasteHandler = (e) => {
            const editor = document.getElementById('aqpEditor');
            if (!editor) return;

            // בדוק אם הפוקוס בתוך העורך
            if (!editor.contains(document.activeElement) && document.activeElement !== editor) {
                return;
            }

            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    if (!blob) continue;

                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        const img = document.createElement('img');
                        img.src = evt.target.result;
                        img.style.maxWidth = '100%';
                        img.style.borderRadius = '8px';
                        img.style.margin = '6px 0';
                        img.style.display = 'block';

                        // הכנס בנקודת הסמן
                        const sel = window.getSelection();
                        if (sel && sel.rangeCount > 0) {
                            const range = sel.getRangeAt(0);
                            range.deleteContents();
                            range.insertNode(img);
                            range.setStartAfter(img);
                            range.collapse(true);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        } else {
                            editor.appendChild(img);
                        }

                        this._updateAqpCharCounter();
                        NotificationManager.show('התמונה הוכנסה בהצלחה', 'success');
                    };
                    reader.readAsDataURL(blob);
                    return;
                }
            }
        };

        document.addEventListener('paste', this._aqpPasteHandler);
    }

    // הכנס תמונה מקובץ
    insertImageFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 2 * 1024 * 1024) {
                NotificationManager.show('התמונה גדולה מדי (מקסימום 2MB)', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (evt) => {
                const editor = document.getElementById('aqpEditor');
                if (!editor) return;

                editor.focus();
                const img = document.createElement('img');
                img.src = evt.target.result;
                img.style.maxWidth = '100%';
                img.style.borderRadius = '8px';
                img.style.margin = '6px 0';
                img.style.display = 'block';

                const sel = window.getSelection();
                if (sel && sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    range.deleteContents();
                    range.insertNode(img);
                    range.setStartAfter(img);
                    range.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    editor.appendChild(img);
                }

                this._updateAqpCharCounter();
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }

    // פתח lightbox לתמונה
    openImageLightbox(src) {
        const lb = document.getElementById('quickImageLightbox');
        const img = document.getElementById('quickLightboxImg');
        if (!lb || !img) return;
        img.src = src;
        lb.classList.add('open');
    }

    // סגור lightbox
    closeImageLightbox() {
        const lb = document.getElementById('quickImageLightbox');
        if (lb) lb.classList.remove('open');
    }

    // עדכן מונה תווים
    updateCharCounter() {
        const content = document.getElementById('quickProcedureContent');
        const counter = document.getElementById('quickProcedureCharCount');
        if (content && counter) {
            counter.textContent = `${content.value.length} / 500 תווים`;
            counter.style.color = content.value.length > 450 ? '#e74c3c' : '#666';
        }
    }


    // הוסף פונקציה חדשה לשמירת נוהל מהיר:
    async saveQuickProcedure() {
        const title = document.getElementById('quickProcedureTitle').value.trim();
        const content = document.getElementById('quickProcedureContent').value.trim();
        const userNameSelect = document.getElementById('procedureUploadUserName');
        const userName = userNameSelect ? userNameSelect.value : '';
        const editId = document.getElementById('uploadProcedureModal').getAttribute('data-edit-id');

        if (!title) {
            NotificationManager.show('אנא הכנס כותרת לנוהל המהיר', 'error');
            document.getElementById('quickProcedureTitle').focus();
            return;
        }

        if (!content) {
            NotificationManager.show('אנא הכנס תוכן לנוהל המהיר', 'error');
            document.getElementById('quickProcedureContent').focus();
            return;
        }

        const uploadBtn = document.getElementById('uploadProcedureBtn');
        const originalText = uploadBtn.innerHTML;

        try {
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';

            const payload = {
                title: title,
                content: content,
                userName: userName,
                id: editId || null
            };

            const response = await fetch('/Procedures/SaveQuickProcedure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(
                    editId ? 'הנוהל המהיר עודכן בהצלחה' : 'הנוהל המהיר נשמר בהצלחה',
                    'success'
                );
                this.closeUploadModal();
            } else {
                NotificationManager.show(result.error || 'שגיאה בשמירה', 'error');
            }
        } catch (error) {
            console.error('Error saving quick procedure:', error);
            NotificationManager.show('שגיאה בשמירת הנוהל המהיר', 'error');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = originalText;
        }
    }


    // Close upload modal
    closeUploadModal() {
        this.isModalOpen = false;
        document.getElementById('uploadProcedureModal').style.display = 'none';
        document.body.style.overflow = 'auto';

        // איפוס שדות קובץ
        document.getElementById('procedureFileInput').value = '';
        document.getElementById('procedureUploadPreview').style.display = 'none';
        document.getElementById('procedureFolderSelect').value = '';
        document.getElementById('newFolderGroup').style.display = 'none';
        document.getElementById('newFolderNameInput').value = '';
    }

    // Handle file selection
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
            'application/rtf',
            'application/vnd.oasis.opendocument.text',
            'application/vnd.oasis.opendocument.spreadsheet'
        ];

        if (!allowedTypes.includes(file.type)) {
            NotificationManager.show('סוג קובץ לא נתמך', 'error');
            event.target.value = '';
            return;
        }

        // Validate file size (10MB)
        if (file.size > 10 * 1024 * 1024) {
            NotificationManager.show('גודל הקובץ חורג מ-10MB', 'error');
            event.target.value = '';
            return;
        }

        // Show preview
        document.getElementById('procedureUploadFileName').textContent = file.name;
        document.getElementById('procedureUploadFileSize').textContent = this.formatFileSize(file.size);
        document.getElementById('procedureUploadPreview').style.display = 'flex';
    }

    // Format file size helper
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Load available folders
    async loadFolders() {
        try {
            const response = await fetch('/Procedures/GetFolders');
            const folders = await response.json();

            if (folders.error) {
                console.error('Error loading folders:', folders.error);
                return [];
            }

            return folders;
        } catch (error) {
            console.error('Error fetching folders:', error);
            return [];
        }
    }

    // Open upload modal
    async openUploadModal() {
        this.isModalOpen = true;
        const modal = document.getElementById('uploadProcedureModal');
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        // Reset
        document.getElementById('procedureFileInput').value = '';
        document.getElementById('procedureUploadPreview').style.display = 'none';

        // Load folders
        const folders = await this.loadFolders();
        this.populateFolderSelect(folders);

        // Load employees and populate dropdown
        await this.loadEmployees();
        this.populateEmployeeSelect('procedureUploadUserName');

        // Setup drag and drop
        requestAnimationFrame(() => {
            this.setupDragAndDrop();
        });
    }

    // Handle folder selection change
    handleFolderSelection() {
        const select = document.getElementById('procedureFolderSelect');
        const newFolderGroup = document.getElementById('newFolderGroup');
        const newFolderInput = document.getElementById('newFolderNameInput');

        if (select.value === '__NEW_FOLDER__') {
            // Show new folder input
            newFolderGroup.style.display = 'block';
            newFolderInput.focus();
        } else {
            // Hide new folder input
            newFolderGroup.style.display = 'none';
            newFolderInput.value = '';
        }
    }

    // Populate folder select dropdown
    populateFolderSelect(folders) {
        const select = document.getElementById('procedureFolderSelect');
        if (!select) return;

        select.innerHTML = '';

        // Add existing folders
        folders.forEach(folder => {
            const option = document.createElement('option');
            option.value = folder.path;
            option.textContent = folder.name;
            select.appendChild(option);
        });

        // Add "Create New Folder" option at the end
        const newFolderOption = document.createElement('option');
        newFolderOption.value = '__NEW_FOLDER__';
        newFolderOption.textContent = '➕ צור תיקייה חדשה';
        newFolderOption.style.fontWeight = 'bold';
        newFolderOption.style.color = '#667eea';
        select.appendChild(newFolderOption);
    }

    // Validate folder name
    validateFolderName(folderName) {
        // Check for invalid characters in Windows folder names
        const invalidChars = /[<>:"/\\|?*\x00-\x1F]/g;

        if (invalidChars.test(folderName)) {
            return false;
        }

        // Check for reserved names
        const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4',
            'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2',
            'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];

        if (reservedNames.includes(folderName.toUpperCase())) {
            return false;
        }

        // Check length
        if (folderName.length === 0 || folderName.length > 100) {
            return false;
        }

        return true;
    }

    // Collapse all folders
    collapseAllFolders() {
        // Clear all opened folders
        this.collapsedFolders.clear();

        // Update UI - collapse all folders
        document.querySelectorAll('.procedure-folder').forEach(folder => {
            const content = folder.querySelector('.folder-content');
            const toggle = folder.querySelector('.folder-toggle');

            if (content && toggle) {
                content.classList.add('collapsed');
                toggle.classList.add('collapsed');
                folder.classList.remove('expanded');
            }
        });

        // Hide the collapse all button
        const collapseBtn = document.getElementById('collapseAllBtn');
        if (collapseBtn) {
            collapseBtn.style.display = 'none';
        }

        NotificationManager.show('כל התיקיות מוזערו', 'success');
    }

    // Update collapse all button visibility
    updateCollapseAllButton() {
        const collapseBtn = document.getElementById('collapseAllBtn');
        if (!collapseBtn) return;

        // Show button only if:
        // 1. We're in folder view
        // 2. At least one folder is open
        // 3. No active search
        const searchInput = document.getElementById('proceduresSearchInput');
        const hasSearch = searchInput && searchInput.value.trim() !== '';

        if (this.currentView === 'folder' &&
            this.collapsedFolders.size > 0 &&
            !hasSearch) {
            collapseBtn.style.display = 'inline-flex';
        } else if (hasSearch && document.querySelectorAll('.expanded').length > 0) {
            collapseBtn.style.display = 'inline-flex';
        } else {
            collapseBtn.style.display = 'none';
        }
    }

    // Upload procedure file
    async uploadProcedureFile() {
        // *** בדוק אם זה נוהל מהיר ***
        const isQuick = document.getElementById('isQuickProcedure')?.checked;
        if (isQuick) {
            await this.saveQuickProcedure();
            return;
        }
        const fileInput = document.getElementById('procedureFileInput');
        const folderSelect = document.getElementById('procedureFolderSelect');
        const newFolderInput = document.getElementById('newFolderNameInput');
        const userNameSelect = document.getElementById('procedureUploadUserName');
        const file = fileInput.files[0];

        if (!file) {
            NotificationManager.show('אנא בחר קובץ להעלאה', 'error');
            return;
        }

        // Determine folder path
        let folderPath = folderSelect.value;

        // If creating new folder
        if (folderPath === '__NEW_FOLDER__') {
            const newFolderName = newFolderInput.value.trim();

            if (!newFolderName) {
                NotificationManager.show('אנא הכנס שם לתיקייה החדשה', 'error');
                newFolderInput.focus();
                return;
            }

            // Validate folder name
            if (!this.validateFolderName(newFolderName)) {
                NotificationManager.show('שם התיקייה מכיל תווים לא חוקיים', 'error');
                return;
            }

            folderPath = newFolderName;
        }

        // Get selected user name
        const userName = userNameSelect ? userNameSelect.value : '';

        // Save last selected employee
        if (userName) {
            this.saveLastSelectedEmployee(userName);
        }

        const uploadBtn = document.getElementById('uploadProcedureBtn');
        const originalText = uploadBtn.innerHTML;

        try {
            uploadBtn.disabled = true;
            uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מעלה...';

            const formData = new FormData();
            formData.append('file', file);
            formData.append('folderPath', folderPath);
            formData.append('userName', userName); // Add user name to form data

            const response = await fetch('/Procedures/UploadProcedure', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(result.message, 'success');
                this.closeUploadModal();
                await this.loadProcedures();
            } else {
                NotificationManager.show(result.error, 'error');
            }
        } catch (error) {
            console.error('Error uploading procedure:', error);
            NotificationManager.show('שגיאה בהעלאת הקובץ', 'error');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.innerHTML = originalText;
        }
    }

    // Delete procedure
    async deleteProcedure(fileName, folderPath = '') {
        // Find the procedure to get its folder info
        const procedure = this.allProcedures.find(p => p.fileName === fileName);
        const folderInfo = procedure && procedure.folder ? ` מהתיקייה "${procedure.folder}"` : '';

        if (!confirm(`האם אתה בטוח שברצונך למחוק את הקובץ "${fileName}"${folderInfo}?`)) {
            return;
        }

        try {
            let deleteUrl = `/Procedures/DeleteProcedure?fileName=${encodeURIComponent(fileName)}`;

            if (folderPath) {
                deleteUrl += `&folderPath=${encodeURIComponent(folderPath)}`;
            }

            const response = await fetch(deleteUrl, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                NotificationManager.show(result.message, 'success');

                // Reload procedures list
                await this.loadProcedures();
            } else {
                NotificationManager.show(result.error, 'error');
            }
        } catch (error) {
            console.error('Error deleting procedure:', error);
            NotificationManager.show('שגיאה במחיקת הקובץ', 'error');
        }
    }

    // Load employees from server
    async loadEmployees() {
        try {
            const response = await fetch('/EmployeeTasks/GetEmployees');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const employees = await response.json();
            this.employees = employees;
        } catch (error) {
            console.error('Error fetching employees:', error);
            this.employees = [];
        }
    }

    // Save last selected employee to localStorage
    saveLastSelectedEmployee(employeeName) {
        if (employeeName && employeeName !== '') {
            localStorage.setItem('lastSelectedEmployee', employeeName);
        }
    }

    // Get last selected employee from localStorage
    getLastSelectedEmployee() {
        return localStorage.getItem('lastSelectedEmployee') || '';
    }

    // Set default employee in select dropdown
    setDefaultEmployee(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        const lastEmployee = this.getLastSelectedEmployee();
        if (lastEmployee) {
            // Check if employee exists in options
            const optionExists = Array.from(select.options).some(
                option => option.value === lastEmployee
            );

            if (optionExists) {
                select.value = lastEmployee;
            }
        }
    }

    // Populate employee select dropdown
    populateEmployeeSelect(selectId) {
        const select = document.getElementById(selectId);
        if (!select) return;

        // Clear existing options except the first one
        select.innerHTML = '<option value="">בחר משתמש...</option>';

        // Add employee options
        this.employees.forEach(employee => {
            const option = document.createElement('option');
            option.value = employee.name;
            option.textContent = employee.name;
            select.appendChild(option);
        });

        // Set last selected employee as default
        this.setDefaultEmployee(selectId);
    }

    // Auto refresh data
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            if (!this.isModalOpen) {
                // שמור את מצב התצוגה והחיפוש הנוכחיים
                const currentView = this.currentView;
                const currentPage = this.currentPage;
                const searchInput = document.getElementById('proceduresSearchInput');
                const searchTerm = searchInput ? searchInput.value.trim() : '';
                const collapsedFoldersState = new Set(this.collapsedFolders);

                // טען מחדש את הנהלים
                await this.loadProcedures();

                // שחזר את מצב התצוגה
                this.currentView = currentView;
                this.currentPage = currentPage;

                // שחזר את מצב התיקיות הפתוחות/סגורות
                this.collapsedFolders = collapsedFoldersState;

                // החל מחדש את החיפוש אם היה פעיל
                if (searchTerm) {
                    this.searchProcedures(searchTerm);
                } else {
                    this.displayProcedures(this.allProcedures);
                }

                // עדכן את כפתור סגירת כל התיקיות
                setTimeout(() => {
                    this.updateCollapseAllButton();
                }, 100);
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