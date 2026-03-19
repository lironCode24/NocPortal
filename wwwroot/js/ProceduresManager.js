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

        // Reset to show all procedures
        this.searchProcedures('');
    }

    // Search procedures
    searchProcedures(searchTerm) {
        this.currentPage = 1;

        // Show/hide clear button
        const clearBtn = document.getElementById('clearSearchBtn');
        if (clearBtn) {
            clearBtn.style.display = searchTerm !== '' ? 'block' : 'none';
        }

        if (searchTerm === '') {
            // When clearing search, close all folders and show all procedures
            this.collapsedFolders.clear();
            this.displayProcedures(this.allProcedures);

            // Remove expanded class from all folders after display
            setTimeout(() => {
                document.querySelectorAll('.procedure-folder').forEach(folder => {
                    folder.classList.remove('expanded');
                });
                this.updateCollapseAllButton();
            }, 0);
        } else {
            // Filter procedures
            const filteredProcedures = this.allProcedures.filter(procedure =>
                procedure.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                procedure.fileName.toLowerCase().includes(searchTerm.toLowerCase())
            );

            // Open ALL folders when searching (in folder view)
            if (this.currentView === 'folder') {
                // Get ALL unique folders from ALL procedures (not just filtered)
                const allFolders = new Set(
                    this.allProcedures.map(p => p.folder || '')
                );

                // Open all folders
                allFolders.forEach(folder => {
                    this.collapsedFolders.add(folder);
                });
            }

            this.displayProcedures(filteredProcedures);

            // Add expanded class to all folders after display
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
        const viewUrl = folderPath ?
            `/Procedures/ViewFile?fileName=${encodedFileName}&folderPath=${encodedFolderPath}` :
            `/Procedures/ViewFile?fileName=${encodedFileName}`;

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

        // Delete cached PDF if it was a Word/Excel file
        if (currentFileName) {
            this.deleteCachedPdf(currentFileName, currentFolder);
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

    // Close upload modal
    closeUploadModal() {
        this.isModalOpen = false;
        document.getElementById('uploadProcedureModal').style.display = 'none';
        document.body.style.overflow = 'auto';
        document.getElementById('procedureFileInput').value = '';
        document.getElementById('procedureUploadPreview').style.display = 'none';

        // Reset folder selection
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