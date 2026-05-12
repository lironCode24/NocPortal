/**
 * DataCenterManager - מנהל תצוגת חדר שרתים
 * מאפשר הצגת מפת חדר שרתים ופרטי ארונות בפופאפ
 */
class DataCenterManager {
    constructor() {
        this.searchMode = 'equipment'; // 'equipment' | 'freeSpace' | 'both'
        this.lastSearchTerm = '';
        this.lastFreeSpaceResults = [];
        this.currentRack = null;
        // הפרדת נתוני הארונות לפי חדר
        this.racksData = {
            PT: {},
            RG: {}
        };
        this.isInitialized = false;
        this.currentDataCenter = null;
        this.dataLoadingStatus = {
            PT: false,
            RG: false
        };

        // *** הוסף: נתוני משתמש נוכחי ***
        this.currentUser = null;
        this.canEdit = false;
    }

    /**
 * שליפת נתוני המשתמש הנוכחי מהשרת
 */
    async fetchCurrentUser() {
        try {
            const response = await fetch('/Auth/Me', {
                credentials: 'include'
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return null;
                }
                throw new Error(`HTTP error: ${response.status}`);
            }

            const user = await response.json();
            this.currentUser = user;
            return user;

        } catch (error) {
            console.error('Error fetching current user:', error);
            // *** fallback: נסה מ-sessionStorage ***
            const cached = sessionStorage.getItem('currentUser');
            if (cached) {
                this.currentUser = JSON.parse(cached);
                return this.currentUser;
            }
            return null;
        }
    }

    /**
 * בדיקה אם המשתמש הנוכחי מורשה לערוך ציוד
 * @returns {boolean}
 */
    checkEditPermission() {
        if (!this.currentUser) return false;

        const { role, username } = this.currentUser;

        // Admin ו-NOC רואים הכל
        if (role === 'Admin' || role === 'NOC') return true;

        // משתמש shabtayr מורשה תמיד
        const allowedUsers = ['shabtayr'];
        if (allowedUsers.some(u =>
            (username || '').toUpperCase() === u.toUpperCase()
        )) return true;

        return false;
    }
    /**
 * הצגת הודעה למשתמש - עם fallback אם NotificationManager לא זמין
 * @param {string} message - הודעה להצגה
 * @param {string} type - סוג ההודעה (success, error, info, warning)
 */
    _notify(message, type = 'info') {
        if (typeof NotificationManager !== 'undefined' && NotificationManager?.show) {
            NotificationManager.show(message, type);
        } else {
            // fallback פשוט
            switch (type) {
                case 'error':
                    console.error(`[${type.toUpperCase()}] ${message}`);
                    break;
                case 'warning':
                    console.warn(`[${type.toUpperCase()}] ${message}`);
                    break;
                default:
                    console.info(`[${type.toUpperCase()}] ${message}`);
            }
        }
    }

    /**
     * אתחול המנהל
    */
    async initialize() {
        if (this.isInitialized) return;

        // *** הוסף: טעינת נתוני משתמש לפני הכל ***
        await this.fetchCurrentUser();
        this.canEdit = this.checkEditPermission();
        // Create modals
        this.createDataCenterModal();
        this.createRackDetailsModal();

        // Add event listeners to buttons
        this.setupEventListeners();

        // Check for changes in source files
        this.updateRefreshButton();

        // Check for changes every 5 minutes
        setInterval(() => this.updateRefreshButton(), 5 * 60 * 1000);

        // טעינה מקדימה של נתוני חדרי השרתים
        this.preloadDataCentersData();

        // התחלת רענון אוטומטי
        // this.startAutoRefresh(120);
        this.isInitialized = true;
    }

    /**
 * טעינה מקדימה של נתוני חדרי השרתים
 * @returns {Promise<boolean>} - האם הטעינה הצליחה
 */
    async preloadDataCentersData() {
        try {
            this.showGlobalLoadingIndicator();

            // טעינת נתונים במקביל לשני חדרי השרתים
            await Promise.all([
                this.loadRacksData('PT'),
                this.loadRacksData('RG')
            ]);

            return true;
        } catch (error) {
            console.error('Error preloading data centers data:', error);
            return false;
        } finally {
            this.hideGlobalLoadingIndicator();
        }
    }

    /**
     * הצגת אינדיקציית טעינה גלובלית
     */
    showGlobalLoadingIndicator() {
        // בדיקה אם כבר קיים אינדיקטור טעינה
        if (document.getElementById('globalLoadingIndicator')) return;

        const loadingHTML = `
            <div id="globalLoadingIndicator" class="global-loading-indicator">
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>טוען נתוני חדרי שרתים...</span>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', loadingHTML);
    }

    /**
     * הסרת אינדיקציית טעינה גלובלית
     */
    hideGlobalLoadingIndicator() {
        const indicator = document.getElementById('globalLoadingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }

    /**
     * הוספת מאזיני אירועים לכפתורים
     */
    setupEventListeners() {
        // כפתור חדר שרתים PT
        const ptButton = document.getElementById('dataCenterPTButton');
        if (ptButton) {
            ptButton.addEventListener('click', () => this.showDataCenter('PT'));
        }

        // כפתור חדר שרתים RG
        const rgButton = document.getElementById('dataCenterRGButton');
        if (rgButton) {
            rgButton.addEventListener('click', () => this.showDataCenter('RG'));
        }
        // ניקוי חיפוש בעת סגירת המודל
        const closeButton = document.querySelector('#dataCenterModal .modal-close');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.clearSearch());
        }
    }

    /**
 * הוספת אירועי לחיצה על פריטי ציוד
 */
    setupEquipmentEventListeners() {
        const equipmentItems = document.querySelectorAll('.equipment-item');
        equipmentItems.forEach(item => {
            item.addEventListener('click', (event) => {
                // מניעת התפשטות האירוע לארון
                event.stopPropagation();

                // קבלת מזהה הציוד, הארון ומיקום ה-U
                const equipmentName = item.querySelector('.model-name').textContent;
                const rackId = this.currentRack?.id;
                const startPosition = parseInt(item.getAttribute('data-position') || item.classList.toString().match(/pos-(\d+)/)?.[1] || 0);

                if (rackId && equipmentName && startPosition > 0) {
                    this.showEquipmentConnectionsModal(equipmentName, rackId, startPosition);
                }
            });
        });
    }

    /**
     * יצירת מודל לעריכת חיבורי ציוד
     */
    createEquipmentConnectionsModal() {
        // בדיקה אם המודל כבר קיים
        if (document.getElementById('equipmentConnectionsModal')) return;

        const modalHTML = `
    <div id="equipmentConnectionsModal" class="modal-overlay">
        <div class="modal-content equipment-connections-modal">
            <div class="modal-header">
                <h3><i class="fas fa-network-wired"></i> <span id="equipmentConnectionsTitle">חיבורי ציוד</span></h3>
                <button class="modal-close" onclick="dataCenterManager.closeEquipmentConnectionsModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="connections-upload-container" style="display:none;">
                    <div class="file-upload-wrapper">
                        <label class="btn-primary" for="connectionsFileInput" class="file-upload-label">
                            <i class="fas fa-upload"></i> העלה קובץ חיבורים (Excel/CSV)
                        </label>
                        <input type="file" id="connectionsFileInput" accept=".xlsx,.xls,.csv" style="display:none;"
                               onchange="dataCenterManager.handleConnectionsFileUpload(event)">
                    </div>
                </div>
                
                <div class="connections-table-container">
                    <table id="connectionsTable" class="connections-table">
                        <thead>
                            <tr>
                                <th>פורט</th>
                                <th>סוג</th>
                                <th>מהירות</th>
                                <th>מחובר אל</th>
                                <th>תיאור</th>
                                <th class="actions-column" style="display:none;">פעולות</th>
                            </tr>
                        </thead>
                        <tbody id="connectionsTableBody">
                            <!-- כאן יתווספו שורות החיבורים -->
                        </tbody>
                    </table>
                    
                    <div class="add-connection-container" style="display:none;">
                        <button class="btn-add-connection" onclick="dataCenterManager.addNewConnectionRow()">
                            <i class="fas fa-plus"></i> הוסף חיבור חדש
                        </button>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button id="editConnectionsBtn" class="btn-primary" onclick="dataCenterManager.switchToEditMode()">
                    <i class="fas fa-edit"></i> ערוך חיבורים
                </button>
                <button id="saveConnectionsBtn" class="btn-primary" style="display:none;" onclick="dataCenterManager.saveEquipmentConnections()">
                    <i class="fas fa-save"></i> שמור חיבורים
                </button>
                <button id="cancelEditBtn" class="btn-cancel" style="display:none;" onclick="dataCenterManager.cancelEdit()">
                    <i class="fas fa-times"></i> בטל עריכה
                </button>
                <button id="closeConnectionsBtn" class="btn-cancel" onclick="dataCenterManager.closeEquipmentConnectionsModal()">
                    <i class="fas fa-times"></i> סגור
                </button>
            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
 * קבלת רשימת כל הציודים הקיימים במערכת
 * @returns {Array} - מערך של אובייקטים המכילים מידע על הציודים
 */
    getAllEquipmentList() {
        const equipmentList = [];

        // עבור על כל חדרי השרתים
        for (const dcType in this.racksData) {
            // עבור על כל הארונות בחדר
            for (const rackId in this.racksData[dcType]) {
                // עבור על כל פריטי הציוד בארון
                this.racksData[dcType][rackId].forEach(item => {
                    // בדיקה אם יש שם ציוד (בדיקה עם אות גדולה או קטנה)
                    const equipmentName = item.Equipment || item.equipment || '';
                    if (equipmentName) {
                        equipmentList.push({
                            name: equipmentName,
                            rackId: rackId,
                            position: item.StartPosition || item.startPosition || 0,
                            dataCenterType: dcType
                        });
                    }
                });
            }
        }

        return equipmentList;
    }

    /**
  * מעבר למצב עריכת חיבורים
  */
    switchToEditMode() {
        // הצגת עמודת פעולות בטבלה
        const actionsCells = document.querySelectorAll('.actions-cell');
        actionsCells.forEach(cell => cell.style.display = '');
        document.querySelector('.actions-column').style.display = '';

        // הצגת כפתורי עריכה
        document.querySelector('.connections-upload-container').style.display = '';
        document.querySelector('.add-connection-container').style.display = '';
        document.getElementById('saveConnectionsBtn').style.display = '';
        document.getElementById('cancelEditBtn').style.display = '';

        // הסתרת כפתור עריכה
        document.getElementById('editConnectionsBtn').style.display = 'none';

        // הוספת כפתור הנחיות
        const modalHeader = document.querySelector('#equipmentConnectionsModal .connections-upload-container');

        // בדיקה אם כפתור ההנחיות כבר קיים
        if (!document.getElementById('showInstructionsBtn')) {
            const instructionsButton = document.createElement('button');
            instructionsButton.id = 'showInstructionsBtn';
            instructionsButton.className = 'instructions-button';
            instructionsButton.innerHTML = '<i class="fas fa-question-circle"></i> הנחיות';
            instructionsButton.onclick = () => this.toggleInstructionsPopup();

            // הוספת הכפתור לכותרת המודל
            modalHeader.insertBefore(instructionsButton, modalHeader.querySelector('.modal-close'));
        }

        // יצירת פופאפ ההנחיות (אם לא קיים)
        if (!document.getElementById('instructionsPopup')) {
            const instructionsPopup = document.createElement('div');
            instructionsPopup.id = 'instructionsPopup';
            instructionsPopup.className = 'instructions-popup';
            instructionsPopup.style.display = 'none';
            instructionsPopup.innerHTML = `
            <div class="instructions-popup-content">
                <div class="instructions-popup-header">
                    <h4><i class="fas fa-info-circle"></i> הנחיות לרישום חיבורים</h4>
                    <button class="close-instructions" onclick="dataCenterManager.toggleInstructionsPopup()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="instructions-popup-body">
                    <p>המערכת מזהה באופן אוטומטי חיבורים הפוכים ומעדכנת את הציוד המחובר בשני הקצוות.</p>
                    <h4>העלאת קובץ חיבורים (Excel/CSV):</h4>
                    <p>הקובץ צריך לכלול את העמודות הבאות:</p>
                    <table class="file-format-table">
                        <thead>
                            <tr>
                                <th>Port</th>
                                <th>Type</th>
                                <th>Speed</th>
                                <th>Connected To</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>1</td>
                                <td>Optic</td>
                                <td>10G</td>
                                <td>Server Dell (B4-6 / U-15 / PORT 2)</td>
                                <td>תיאור החיבור</td>
                            </tr>
                        </tbody>
                    </table>
                    <p><strong>ערכי מהירות אפשריים:</strong> 1G, 10G, 16G, 25G, 32G, 100G</p>
                    <p><strong>פורמט מומלץ לציון חיבור:</strong> "שם הציוד (מזהה ארון / U-מיקום / PORT מספר)"</p>
                    <p><strong>לדוגמה:</strong></p>
                    <ul>
                        <p>Switch Cisco (B1-2 / U-10 / PORT 1)</p>
                    </ul>
                </div>
            </div>
        `;

            // הוספת הפופאפ לגוף המסמך
            document.body.appendChild(instructionsPopup);
        }

        // המרת תאי הטבלה לשדות עריכה
        const rows = document.querySelectorAll('#connectionsTableBody tr.view-mode-row');
        rows.forEach(row => {
            // הסרת מחלקת מצב צפייה והוספת מחלקת מצב עריכה
            row.classList.remove('view-mode-row');
            row.classList.add('edit-mode-row');

            const cells = row.querySelectorAll('td.view-mode-cell');

            // המרת התא הראשון (פורט) לשדה מספרי
            if (cells[0]) {
                const portValue = cells[0].textContent.trim();
                cells[0].className = 'edit-mode-cell';
                cells[0].innerHTML = `<input type="number" class="connection-port" value="${portValue}" min="1">`;
            }

            // המרת התא השני (סוג) לתיבת בחירה
            if (cells[1]) {
                const typeValue = cells[1].textContent.trim();
                cells[1].className = 'edit-mode-cell';
                cells[1].innerHTML = `
                <select class="connection-type">
                    <option value="RJ45" ${typeValue === 'RJ45' ? 'selected' : ''}>RJ45</option>
                    <option value="Optic" ${typeValue === 'Optic' ? 'selected' : ''}>Optic</option>
                    <option value="IDRAC" ${typeValue === 'IDRAC' ? 'selected' : ''}>IDRAC</option>
                    <option value="MGMT" ${typeValue === 'MGMT' ? 'selected' : ''}>MGMT</option>
                    <option value="ILO" ${typeValue === 'ILO' ? 'selected' : ''}>ILO</option>
                    <option value="MPO" ${typeValue === 'MPO' ? 'selected' : ''}>MPO</option>
                    <option value="MTP" ${typeValue === 'MTP' ? 'selected' : ''}>MTP</option>
                    <option value="DAC" ${typeValue === 'DAC' ? 'selected' : ''}>DAC</option>
                    <option value="Other" ${typeValue === 'Other' || !typeValue ? 'selected' : ''}>Other</option>
                </select>`;
            }

            // המרת התא השלישי (מהירות) לתיבת בחירה
            if (cells[2]) {
                const speedValue = cells[2].textContent.trim();
                cells[2].className = 'edit-mode-cell';
                cells[2].innerHTML = `
                <select class="connection-speed">
                    <option value="" ${!speedValue ? 'selected' : ''}>בחר</option>
                    <option value="1G" ${speedValue === '1G' ? 'selected' : ''}>1G</option>
                    <option value="10G" ${speedValue === '10G' ? 'selected' : ''}>10G</option>
                    <option value="16G" ${speedValue === '16G' ? 'selected' : ''}>16G</option>
                    <option value="25G" ${speedValue === '25G' ? 'selected' : ''}>25G</option>
                    <option value="32G" ${speedValue === '32G' ? 'selected' : ''}>32G</option>
                    <option value="100G" ${speedValue === '100G' ? 'selected' : ''}>100G</option>
                </select>`;
            }

            // המרת התא הרביעי (מחובר אל) למספר שדות נפרדים
            if (cells[3]) {
                // חילוץ הערכים מהתצוגה המפורטת
                const connectionDetails = cells[3].querySelectorAll('.connection-detail');
                let equipmentName = '';
                let rackId = '';
                let position = '';
                let port = '';

                // חילוץ הערכים מהתצוגה המפורטת
                connectionDetails.forEach(detail => {
                    const text = detail.textContent.trim();
                    if (text.includes('שם ציוד:')) {
                        equipmentName = text.replace('שם ציוד:', '').trim();
                    } else if (text.includes('ארון:')) {
                        rackId = text.replace('ארון:', '').trim();
                    } else if (text.includes('מיקום U:')) {
                        position = text.replace('מיקום U:', '').trim();
                    } else if (text.includes('פורט:')) {
                        port = text.replace('פורט:', '').trim();
                    }
                });

                // אם לא הצלחנו לחלץ מהתצוגה המפורטת, ננסה לחלץ מהפורמט הישן
                if (!equipmentName) {
                    const targetValue = cells[3].textContent.trim();
                    const match = targetValue.match(/^(.*?)\s*\(([^\/]+)\/\s*U-?(\d+)\s*\/\s*PORT\s*(\d+)\)$/i);

                    if (match) {
                        equipmentName = match[1].trim();
                        rackId = match[2].trim();
                        position = match[3].trim();
                        port = match[4].trim();
                    } else {
                        // אם הפורמט לא תואם, נשתמש בערך המלא כשם הציוד
                        equipmentName = targetValue;
                    }
                }

                // קבלת רשימת כל הציודים
                const equipmentList = this.getAllEquipmentList();

                // יצירת HTML עם שדות נפרדים
                cells[3].className = 'edit-mode-cell';
                cells[3].innerHTML = `
                <div class="connection-target-fields" style="display: flex; flex-direction: row; gap: 5px;">
                    <div class="target-field">
                        <label>שם ציוד:</label>
                        <div class="autocomplete-container">
                            <input type="text" class="equipment-name-input" value="${equipmentName}" placeholder="הקלד לחיפוש...">
                            <div class="autocomplete-dropdown" style="display: none;"></div>
                        </div>
                    </div>
                    <div class="target-field">
                        <label>ארון:</label>
                        <input type="text" class="rack-id-input" value="${rackId}">
                    </div>
                    <div class="target-field">
                        <label>מיקום U:</label>
                        <input type="number" class="position-input" value="${position}" min="1" max="42">
                    </div>
                    <div class="target-field">
                        <label>פורט:</label>
                        <input type="number" class="target-port-input" value="${port || '1'}" min="1">
                    </div>
                </div>
            `;

                // הוספת פונקציונליות השלמה אוטומטית לשדה שם הציוד
                const equipmentInput = cells[3].querySelector('.equipment-name-input');
                const dropdown = cells[3].querySelector('.autocomplete-dropdown');
                const rackInput = cells[3].querySelector('.rack-id-input');
                const positionInput = cells[3].querySelector('.position-input');

                // אירוע הקלדה - חיפוש והצגת תוצאות
                equipmentInput.addEventListener('input', () => {
                    const searchTerm = equipmentInput.value.toLowerCase();

                    if (searchTerm.length < 2) {
                        dropdown.style.display = 'none';
                        return;
                    }

                    // סינון הציודים לפי מונח החיפוש
                    const filteredEquipment = equipmentList.filter(equip =>
                        equip.name.toLowerCase().includes(searchTerm)
                    );

                    // הצגת התוצאות בדרופדאון
                    if (filteredEquipment.length > 0) {
                        dropdown.innerHTML = filteredEquipment.slice(0, 10).map(equip => `
                        <div class="autocomplete-item" 
                            data-name="${equip.name}" 
                            data-rack="${equip.rackId}" 
                            data-position="${equip.position}">
                        <span class="equip-name">${equip.name}</span> |
                        <span class="equip-dataCenterType">${equip.dataCenterType}</span> |
                        <span class="equip-rack">${equip.rackId}</span> | 
                        <span class="equip-position">U${equip.position}</span>
                        </div>
                    `).join('');

                        // הוספת אירועי לחיצה על פריטים
                        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                            item.addEventListener('click', () => {
                                const name = item.getAttribute('data-name');
                                const rack = item.getAttribute('data-rack');
                                const position = item.getAttribute('data-position');

                                // עדכון הערכים בשדות המתאימים
                                equipmentInput.value = name;
                                rackInput.value = rack;
                                positionInput.value = position;

                                dropdown.style.display = 'none';
                            });
                        });

                        dropdown.style.display = 'block';
                    } else {
                        dropdown.style.display = 'none';
                    }
                });

                // סגירת הדרופדאון בלחיצה מחוץ לשדה
                document.addEventListener('click', (e) => {
                    // בדיקה שהתא קיים ומכיל את האלמנט הנדרש
                    const container = cells[3] ? cells[3].querySelector('.autocomplete-container') : null;
                    if (container && !container.contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });
            }

            // המרת התא החמישי (תיאור) לשדה טקסט
            if (cells[4]) {
                const descValue = cells[4].textContent.trim();
                cells[4].className = 'edit-mode-cell';
                cells[4].innerHTML = `<input type="text" class="connection-description" value="${descValue}">`;
            }

            // הוספת כפתור מחיקה לתא האחרון
            const actionsCell = row.querySelector('.actions-cell');
            if (actionsCell) {
                actionsCell.innerHTML = `
            <button class="btn-delete-connection" onclick="dataCenterManager.deleteConnectionRow(this)">
                <i class="fas fa-trash"></i>
            </button>`;
                actionsCell.style.display = '';
            }
        });

        // הוספת סגנון CSS לפופאפ ההנחיות
        if (!document.getElementById('instructionsPopupStyle')) {
            const style = document.createElement('style');
            style.id = 'instructionsPopupStyle';
            style.textContent = `
            .instructions-button {
                background-color: #17a2b8;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 5px 10px;
                margin-left: 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                font-size: 16px;
                height: 40px;
            }
            
            .instructions-button i {
                margin-left: 5px;
            }
            
            .instructions-button:hover {
                background-color: #138496;
            }
            
            .instructions-popup {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10001;
            }
            
            .instructions-popup-content {
                background-color: white;
                border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
                width: 90%;
                max-width: 1200px;
                max-height: 90vh;
                display: flex;
                flex-direction: column;
                animation: popup-fade-in 0.3s ease-in-out;
            }
            
            @keyframes popup-fade-in {
                from { opacity: 0; transform: translateY(-20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            
            .instructions-popup-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px 20px;
                border-bottom: 1px solid #dee2e6;
                background-color: #f8f9fa;
                border-radius: 8px 8px 0 0;
            }
            
            .instructions-popup-header h4 {
                margin: 0;
                color: #0d6efd;
                display: flex;
                align-items: center;
            }
            
            .instructions-popup-header h4 i {
                margin-left: 10px;
                color: #0d6efd;
            }
            
            .instructions-popup-body {
                padding: 20px;
                overflow-y: auto;
                max-height: calc(90vh - 70px);
            }
            
            .close-instructions {
                background: none;
                border: none;
                color: #6c757d;
                cursor: pointer;
                font-size: 18px;
                padding: 5px;
                border-radius: 3px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .close-instructions:hover {
                background-color: #e2e6ea;
                color: #343a40;
            }
            
            .file-format-table {
                width: 100%;
                border-collapse: collapse;
                margin: 10px 0;
            }
            
            .file-format-table th, .file-format-table td {
                border: 1px solid #dee2e6;
                padding: 8px;
                text-align: right;
            }
            
            .file-format-table th {
                background-color: #f8f9fa;
            }
            
            .file-example {
                background-color: #f8f9fa;
                border: 1px solid #dee2e6;
                border-radius: 4px;
                padding: 10px;
                margin: 10px 0;
            }
            
            .file-example code {
                display: block;
                white-space: pre-wrap;
                word-break: break-all;
                background-color: #f1f1f1;
                padding: 8px;
                border-radius: 4px;
                font-family: monospace;
                direction: ltr;
                text-align: left;
            }
        `;
            document.head.appendChild(style);
        }
    }

    /**
     * הצגה או הסתרה של פופאפ ההנחיות
     */
    toggleInstructionsPopup() {
        const popup = document.getElementById('instructionsPopup');
        if (popup) {
            if (popup.style.display === 'none' || !popup.style.display) {
                popup.style.display = 'flex';
            } else {
                popup.style.display = 'none';
            }
        }
    }

    /**
  * ביטול מצב עריכה וחזרה למצב צפייה
  */
    cancelEdit() {
        // הסרת פופאפ ההנחיות אם הוא פתוח
        const popup = document.getElementById('instructionsPopup');
        if (popup) {
            popup.style.display = 'none';
        }

        // **שינוי: מחיקת נתונים זמניים**
        this.tempConnectionsData = null;

        // טעינה מחדש של נתוני החיבורים המקוריים מהשרת
        this.showEquipmentConnectionsModal(
            this.currentEquipment.name,
            this.currentEquipment.rackId,
            this.currentEquipment.startPosition
        );
    }

    /**
  * עדכון טבלת החיבורים במצב צפייה בלבד
  * @param {Array} connections - מערך של חיבורים
  */
    updateConnectionsTable(connections) {
        const tableBody = document.getElementById('connectionsTableBody');

        // ניקוי הטבלה
        tableBody.innerHTML = '';

        // אם אין חיבורים, הצג שורת "אין נתונים"
        if (connections.length === 0) {
            tableBody.innerHTML = `
    <tr>
        <td colspan="6" class="empty-cell"> <!-- עדכון מספר העמודות -->
            <div class="empty-message"><i class="fas fa-info-circle"></i> אין חיבורים מוגדרים לציוד זה</div>
        </td>
    </tr>`;
            return;
        }

        // הוספת שורות החיבורים במצב צפייה בלבד
        connections.forEach((connection) => {
            const row = document.createElement('tr');
            row.className = 'view-mode-row'; // הוספת מחלקה לזיהוי שורות במצב צפייה

            // פירוק הערך של connectedTo לחלקים (אם הוא בפורמט המבוקש)
            let equipmentName = '';
            let rackId = '';
            let position = '';
            let port = '';

            // ניסיון לחלץ את הערכים מהפורמט: "שם ציוד (ארון / U-מיקום / PORT מספר)"
            const match = connection.connectedTo?.match(/^(.*?)\s*\(([^\/]+)\/\s*U-?(\d+)\s*\/\s*PORT\s*(\d+)\)$/i);

            if (match) {
                equipmentName = match[1].trim();
                rackId = match[2].trim();
                position = match[3].trim();
                port = match[4].trim();
            } else {
                // אם הפורמט לא תואם, נשתמש בערך המלא כשם הציוד
                equipmentName = connection.connectedTo || '';
            }

            // יצירת תצוגה מפורטת יותר
            const connectedToDisplay = `
            <div class="connection-details">
                <div class="connection-detail"><strong>שם ציוד:</strong> ${equipmentName}</div>
                ${rackId ? `<div class="connection-detail"><strong>ארון:</strong> ${rackId}</div>` : ''}
                ${position ? `<div class="connection-detail"><strong>מיקום U:</strong> ${position}</div>` : ''}
                ${port ? `<div class="connection-detail"><strong>פורט:</strong> ${port}</div>` : ''}
            </div>
        `;

            row.innerHTML = `
        <td class="view-mode-cell">${connection.port}</td>
        <td class="view-mode-cell">${connection.type || ''}</td>
        <td class="view-mode-cell">${connection.speed || ''}</td>
        <td class="view-mode-cell">${connectedToDisplay}</td>
        <td class="view-mode-cell">${connection.description || ''}</td>
        <td class="actions-cell" style="display:none;"></td>`;
            tableBody.appendChild(row);
        });
    }

    /**
 * הצגת מודל חיבורי ציוד
 * @param {string} equipmentName - שם הציוד
 * @param {string} rackId - מזהה הארון
 */
    async showEquipmentConnectionsModal(equipmentName, rackId, startPosition) {
        // יצירת המודל אם לא קיים
        this.createEquipmentConnectionsModal();

        // עדכון כותרת המודל
        document.getElementById('equipmentConnectionsTitle').textContent = `חיבורי ${equipmentName} (U${startPosition}) בארון ${rackId}`;

        // שמירת מידע על הציוד הנוכחי
        this.currentEquipment = {
            name: equipmentName,
            rackId: rackId,
            startPosition: startPosition
        };

        // הסתרת אלמנטים של מצב עריכה
        document.querySelector('.connections-upload-container').style.display = 'none';
        document.querySelector('.add-connection-container').style.display = 'none';
        document.getElementById('saveConnectionsBtn').style.display = 'none';
        document.getElementById('cancelEditBtn').style.display = 'none';
        document.getElementById('editConnectionsBtn').style.display = '';
        document.querySelector('.actions-column').style.display = 'none';

        // הצגת מצב טעינה
        document.getElementById('connectionsTableBody').innerHTML = `
    <tr>
        <td colspan="6" class="loading-cell">
            <div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><span>טוען נתוני חיבורים...</span></div>
        </td>
    </tr>`;

        // הצגת המודל
        document.getElementById('equipmentConnectionsModal').style.display = 'flex';

        try {
            // טעינת נתוני החיבורים מהשרת - כולל מיקום ה-U
            const response = await fetch(`/DataCenter/GetEquipmentConnections?equipmentId=${encodeURIComponent(equipmentName)}&rackId=${encodeURIComponent(rackId)}&dataCenterType=${this.currentDataCenter}&startPosition=${startPosition}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                // עדכון טבלת החיבורים במצב צפייה בלבד
                this.updateConnectionsTable(data.connections || []);
            } else {
                throw new Error(data.error || 'שגיאה בטעינת נתוני חיבורים');
            }
        } catch (error) {
            console.error('Error loading equipment connections:', error);
            document.getElementById('connectionsTableBody').innerHTML = `
        <tr>
            <td colspan="5" class="error-cell">
                <div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת נתוני חיבורים: ${error.message}</div>
            </td>
        </tr>`;
        }

        // בדיקת הרשאת עריכה
        if (!this.canEdit) {
            document.getElementById('editConnectionsBtn').style.display = 'none';
        }
    }

    /**
 * הוספת שורת חיבור חדשה
 */
    addNewConnectionRow() {
        const tableBody = document.getElementById('connectionsTableBody');

        // אם יש שורת "אין נתונים", נסיר אותה
        if (tableBody.querySelector('.empty-cell')) {
            tableBody.innerHTML = '';
        }

        // יצירת שורה חדשה
        const row = document.createElement('tr');
        row.className = 'edit-mode-row'; // הוספת מחלקת מצב עריכה
        row.innerHTML = `
    <td class="edit-mode-cell">
        <input type="number" class="connection-port" value="1" min="1">
    </td>
    <td class="edit-mode-cell">
        <select class="connection-type">
            <option value="RJ45">RJ45</option>
            <option value="Optic">Optic</option>
            <option value="IDRAC">IDRAC</option>
            <option value="MGMT">MGMT</option>
            <option value="ILO">ILO</option>
            <option value="MPO">MPO</option>
            <option value="MTP">MTP</option>
            <option value="DAC">DAC</option>
            <option value="Other">Other</option>
        </select>
    </td>
    <td class="edit-mode-cell">
        <select class="connection-speed">
            <option value="" selected>בחר</option>
            <option value="1G">1G</option>
            <option value="10G">10G</option>
            <option value="16G">16G</option>
            <option value="25G">25G</option>
            <option value="32G">32G</option>
            <option value="100G">100G</option>
        </select>
    </td>
    <td class="edit-mode-cell">
        <div class="connection-target-fields" style="display: flex; flex-direction: row; gap: 5px;">
            <div class="target-field">
                <label>שם ציוד:</label>
                <div class="autocomplete-container">
                    <input type="text" class="equipment-name-input" value="" placeholder="הקלד לחיפוש...">
                    <div class="autocomplete-dropdown" style="display: none;"></div>
                </div>
            </div>
            <div class="target-field">
                <label>ארון:</label>
                <input type="text" class="rack-id-input" value="">
            </div>
            <div class="target-field">
                <label>מיקום U:</label>
                <input type="number" class="position-input" value="" min="1" max="42">
            </div>
            <div class="target-field">
                <label>פורט:</label>
                <input type="number" class="target-port-input" value="1" min="1">
            </div>
        </div>
    </td>
    <td class="edit-mode-cell">
        <input type="text" class="connection-description" value="">
    </td>
    <td class="actions-cell">
        <button class="btn-delete-connection" onclick="dataCenterManager.deleteConnectionRow(this)">
            <i class="fas fa-trash"></i>
        </button>
    </td>`;
        tableBody.appendChild(row);

        // הוספת פונקציונליות השלמה אוטומטית לשדה שם הציוד
        const targetCell = row.querySelector('td:nth-child(4)'); // שינוי מ-3 ל-4 בגלל הוספת עמודת המהירות
        const equipmentInput = targetCell.querySelector('.equipment-name-input');
        const dropdown = targetCell.querySelector('.autocomplete-dropdown');
        const rackInput = targetCell.querySelector('.rack-id-input');
        const positionInput = targetCell.querySelector('.position-input');

        // קבלת רשימת כל הציודים
        const equipmentList = this.getAllEquipmentList();

        // אירוע הקלדה - חיפוש והצגת תוצאות
        equipmentInput.addEventListener('input', () => {
            const searchTerm = equipmentInput.value.toLowerCase();

            if (searchTerm.length < 2) {
                dropdown.style.display = 'none';
                return;
            }

            // סינון הציודים לפי מונח החיפוש
            const filteredEquipment = equipmentList.filter(equip =>
                equip.name.toLowerCase().includes(searchTerm)
            );

            // הצגת התוצאות בדרופדאון
            if (filteredEquipment.length > 0) {
                dropdown.innerHTML = filteredEquipment.slice(0, 10).map(equip => `
            <div class="autocomplete-item" 
                 data-name="${equip.name}" 
                 data-rack="${equip.rackId}" 
                 data-position="${equip.position}">
                <span class="equip-name">${equip.name}</span> |
                <span class="equip-dataCenterType">${equip.dataCenterType}</span> |
                <span class="equip-rack">${equip.rackId}</span> | 
                <span class="equip-position">U${equip.position}</span>
            </div>
        `).join('');

                // הוספת אירועי לחיצה על פריטים
                dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const name = item.getAttribute('data-name');
                        const rack = item.getAttribute('data-rack');
                        const position = item.getAttribute('data-position');

                        // עדכון הערכים בשדות המתאימים
                        equipmentInput.value = name;
                        rackInput.value = rack;
                        positionInput.value = position;

                        dropdown.style.display = 'none';
                    });
                });

                dropdown.style.display = 'block';
            } else {
                dropdown.style.display = 'none';
            }
        });

        // סגירת הדרופדאון בלחיצה מחוץ לשדה
        document.addEventListener('click', (e) => {
            if (!targetCell.querySelector('.autocomplete-container').contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    /**
     * מחיקת שורת חיבור
     * @param {HTMLElement} button - כפתור המחיקה שנלחץ
     */
    deleteConnectionRow(button) {
        const row = button.closest('tr');
        row.remove();

        // אם אין יותר שורות, הצג שורת "אין נתונים"
        const tableBody = document.getElementById('connectionsTableBody');
        if (tableBody.children.length === 0) {
            tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-cell">
                    <div class="empty-message"><i class="fas fa-info-circle"></i> אין חיבורים מוגדרים לציוד זה</div>
                </td>
            </tr>`;
        }
    }

    /**
 * שמירת חיבורי הציוד
 */
    async saveEquipmentConnections() {
        // בדיקה שיש ציוד נוכחי
        if (!this.currentEquipment) {
            this._notify('לא נבחר ציוד לשמירת חיבורים', 'error');
            return;
        }

        // *** הוסף: מניעת לחיצה כפולה ***
        const saveBtn = document.getElementById('saveConnectionsBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שומר...';
        }

        try {
            // איסוף נתוני החיבורים מהטבלה
            const connections = [];
            const rows = document.querySelectorAll('#connectionsTableBody tr.edit-mode-row');

            rows.forEach(row => {
                const portInput = row.querySelector('.connection-port');
                const typeSelect = row.querySelector('.connection-type');
                const equipmentNameInput = row.querySelector('.equipment-name-input');
                const rackIdInput = row.querySelector('.rack-id-input');
                const positionInput = row.querySelector('.position-input');
                const targetPortInput = row.querySelector('.target-port-input');
                const descriptionInput = row.querySelector('.connection-description');
                const speedSelect = row.querySelector('.connection-speed');

                if (portInput && typeSelect && equipmentNameInput && descriptionInput) {
                    // בניית מחרוזת "מחובר אל" בפורמט המבוקש
                    let connectedTo = '';
                    const equipmentName = equipmentNameInput.value.trim();
                    const rackId = rackIdInput.value.trim();
                    const position = positionInput.value.trim();
                    const targetPort = targetPortInput.value.trim();

                    // אם יש שם ציוד, נבנה את המחרוזת המלאה
                    if (equipmentName) {
                        connectedTo = `${equipmentName}`;
                        // אם יש גם ארון ומיקום, נוסיף אותם בסוגריים
                        if (rackId && position) {
                            connectedTo += ` (${rackId} / U-${position}`;
                            // אם יש גם מספר פורט, נוסיף אותו
                            if (targetPort) {
                                connectedTo += ` / PORT ${targetPort}`;
                            }
                            connectedTo += ')';
                        }
                    }

                    connections.push({
                        port: parseInt(portInput.value) || 0,
                        type: typeSelect.value,
                        speed: speedSelect.value,
                        connectedTo: connectedTo,
                        description: descriptionInput.value
                    });
                }
            });

            // *** הוסף: retry logic בצד הלקוח ***
            const maxRetries = 3;
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    if (attempt > 0) {
                        // המתן לפני ניסיון חוזר
                        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
                        this._notify(`מנסה שוב... (${attempt + 1}/${maxRetries})`, 'info');
                    }

                    const response = await fetch(`/DataCenter/SaveEquipmentConnections`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            equipmentId: this.currentEquipment.name,
                            rackId: this.currentEquipment.rackId,
                            dataCenterType: this.currentDataCenter,
                            startPosition: this.currentEquipment.startPosition,
                            connections: connections
                        })
                    });

                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const data = await response.json();

                    if (data.success) {
                        this._notify('החיבורים נשמרו בהצלחה', 'success');
                        this.showEquipmentConnectionsModal(
                            this.currentEquipment.name,
                            this.currentEquipment.rackId,
                            this.currentEquipment.startPosition
                        );
                        return; // הצלחה - צא
                    } else {
                        // *** בדוק אם זו שגיאת נעילת קובץ ***
                        if (data.error && data.error.includes('נעול')) {
                            lastError = data.error;
                            continue; // נסה שוב
                        }
                        throw new Error(data.error || 'שגיאה בשמירת החיבורים');
                    }
                } catch (fetchError) {
                    lastError = fetchError.message;
                    if (attempt === maxRetries - 1) throw fetchError;
                }
            }

            // אם הגענו לכאן - כל הניסיונות נכשלו
            throw new Error(lastError || 'שגיאה בשמירת החיבורים לאחר מספר ניסיונות');

        } catch (error) {
            console.error('Error saving equipment connections:', error);
            this._notify(`שגיאה בשמירת החיבורים: ${error.message}`, 'error');
        } finally {
            // *** שחרר את הכפתור תמיד ***
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i class="fas fa-save"></i> שמור חיבורים';
            }
        }
    }

    /**
     * טיפול בהעלאת קובץ חיבורים
     * @param {Event} event - אירוע שינוי קובץ
     */
    async handleConnectionsFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // בדיקה שהקובץ הוא אקסל או CSV
        if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls') && !file.name.endsWith('.csv')) {
            this._notify('הקובץ חייב להיות בפורמט Excel או CSV', 'error');
            return;
        }

        // בדיקה שיש ציוד נוכחי
        if (!this.currentEquipment) {
            this._notify('לא נבחר ציוד להעלאת חיבורים', 'error');
            return;
        }

        try {
            // הצגת מצב טעינה
            document.getElementById('connectionsTableBody').innerHTML = `
        <tr>
            <td colspan="5" class="loading-cell">
                <div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><span>מעלה קובץ חיבורים...</span></div>
            </td>
        </tr>`;

            // יצירת FormData לשליחת הקובץ - כולל מיקום ה-U
            const formData = new FormData();
            formData.append('file', file);
            formData.append('equipmentId', this.currentEquipment.name);
            formData.append('rackId', this.currentEquipment.rackId);
            formData.append('dataCenterType', this.currentDataCenter);
            formData.append('startPosition', this.currentEquipment.startPosition);

            // שליחת הקובץ לשרת
            const response = await fetch('/DataCenter/UploadConnectionsFile', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                // בדיקה אם אנחנו במצב עריכה (אם כפתור העריכה מוסתר, אנחנו במצב עריכה)
                const isEditMode = document.getElementById('editConnectionsBtn').style.display === 'none';

                // המרת שמות השדות מ-camelCase ל-PascalCase אם צריך
                const formattedConnections = data.connections.map(conn => ({
                    port: conn.Port || conn.port,
                    type: conn.Type || conn.type,
                    speed: conn.Speed || conn.speed,
                    connectedTo: conn.ConnectedTo || conn.connectedTo,
                    description: conn.Description || conn.description
                }));

                if (isEditMode) {
                    // אם אנחנו במצב עריכה, נציג את הנתונים במצב עריכה
                    this.displayConnectionsInEditMode(formattedConnections);
                } else {
                    // אחרת, נציג את הנתונים במצב צפייה
                    this.updateConnectionsTable(formattedConnections);
                }

                this._notify('קובץ החיבורים נטען בהצלחה', 'success');
            } else {
                throw new Error(data.error || 'שגיאה בטעינת קובץ החיבורים');
            }
        } catch (error) {
            console.error('Error uploading connections file:', error);
            document.getElementById('connectionsTableBody').innerHTML = `
        <tr>
            <td colspan="5" class="error-cell">
                <div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בהעלאת קובץ החיבורים: ${error.message}</div>
            </td>
        </tr>`;
            this._notify(`שגיאה בהעלאת קובץ החיבורים: ${error.message}`, 'error');
        } finally {
            // איפוס שדה הקובץ
            event.target.value = '';
        }
    }

    /**
 * הצגת חיבורים במצב עריכה
 * @param {Array} connections - מערך של חיבורים
 */
    displayConnectionsInEditMode(connections) {
        const tableBody = document.getElementById('connectionsTableBody');

        // ניקוי הטבלה
        tableBody.innerHTML = '';

        // אם אין חיבורים, הצג שורת "אין נתונים" ואפשר להוסיף חיבור חדש
        if (connections.length === 0) {
            tableBody.innerHTML = `
        <tr>
            <td colspan="5" class="empty-cell">
                <div class="empty-message"><i class="fas fa-info-circle"></i> אין חיבורים מוגדרים לציוד זה</div>
            </td>
        </tr>`;
            return;
        }

        // קבלת רשימת כל הציודים
        const equipmentList = this.getAllEquipmentList();

        // הוספת שורות החיבורים במצב עריכה
        connections.forEach((connection) => {
            // פירוק הערך הקיים לחלקים (אם הוא בפורמט המבוקש)
            let equipmentName = '';
            let rackId = '';
            let position = '';
            let targetPort = '';

            // ניסיון לחלץ את הערכים מהפורמט: "שם ציוד (ארון / U-מיקום / PORT מספר)"
            const match = connection.connectedTo?.match(/^(.*?)\s*\(([^\/]+)\/\s*U-?(\d+)\s*\/\s*PORT\s*(\d+)\)$/i);

            if (match) {
                equipmentName = match[1].trim();
                rackId = match[2].trim();
                position = match[3].trim();
                targetPort = match[4].trim();
            } else {
                // אם הפורמט לא תואם, נשתמש בערך המלא כשם הציוד
                equipmentName = connection.connectedTo || '';
            }

            const row = document.createElement('tr');
            row.className = 'edit-mode-row';
            row.innerHTML = `
        <td class="edit-mode-cell">
            <input type="number" class="connection-port" value="${connection.port}" min="1">
        </td>
        <td class="edit-mode-cell">
            <select class="connection-type">
                <option value="RJ45" ${connection.type === 'RJ45' ? 'selected' : ''}>RJ45</option>
                <option value="Optic" ${connection.type === 'Optic' ? 'selected' : ''}>Optic</option>
                <option value="IDRAC" ${connection.type === 'IDRAC' ? 'selected' : ''}>IDRAC</option>
                <option value="MGMT" ${connection.type === 'MGMT' ? 'selected' : ''}>MGMT</option>
                <option value="ILO" ${connection.type === 'ILO' ? 'selected' : ''}>ILO</option>
                <option value="MPO" ${connection.type === 'MPO' ? 'selected' : ''}>MPO</option>
                <option value="MTP" ${connection.type === 'MTP' ? 'selected' : ''}>MTP</option>
                <option value="DAC" ${connection.type === 'DAC' ? 'selected' : ''}>DAC</option>
                <option value="Other" ${connection.type === 'Other' || !connection.type ? 'selected' : ''}>Other</option>
            </select>
        </td>
        <td class="edit-mode-cell">
            <select class="connection-speed">
                <option value="" ${!connection.speed ? 'selected' : ''}>בחר</option>
                <option value="1G" ${connection.speed === '1G' ? 'selected' : ''}>1G</option>
                <option value="10G" ${connection.speed === '10G' ? 'selected' : ''}>10G</option>
                <option value="16G" ${connection.speed === '16G' ? 'selected' : ''}>16G</option>
                <option value="25G" ${connection.speed === '25G' ? 'selected' : ''}>25G</option>
                <option value="32G" ${connection.speed === '32G' ? 'selected' : ''}>32G</option>
                <option value="100G" ${connection.speed === '100G' ? 'selected' : ''}>100G</option>
            </select>
        </td>
        <td class="edit-mode-cell">
        <div class="connection-target-fields" style="display: flex; flex-direction: row; gap: 5px;">
                <div class="target-field">
                    <label>שם ציוד:</label>
                    <div class="autocomplete-container">
                        <input type="text" class="equipment-name-input" value="${equipmentName}" placeholder="הקלד לחיפוש...">
                        <div class="autocomplete-dropdown" style="display: none;"></div>
                    </div>
                </div>
                <div class="target-field">
                    <label>ארון:</label>
                    <input type="text" class="rack-id-input" value="${rackId}">
                </div>
                <div class="target-field">
                    <label>מיקום U:</label>
                    <input type="number" class="position-input" value="${position}" min="1" max="42">
                </div>
                <div class="target-field">
                    <label>פורט:</label>
                    <input type="number" class="target-port-input" value="${targetPort || '1'}" min="1">
                </div>
            </div>
        </td>
        <td class="edit-mode-cell">
            <input type="text" class="connection-description" value="${connection.description || ''}">
        </td>
        <td class="actions-cell">
            <button class="btn-delete-connection" onclick="dataCenterManager.deleteConnectionRow(this)">
                <i class="fas fa-trash"></i>
            </button>
        </td>`;
            tableBody.appendChild(row);

            // הוספת פונקציונליות השלמה אוטומטית לשדה שם הציוד
            const targetCell = row.querySelector('td:nth-child(4)');
            const equipmentInput = targetCell.querySelector('.equipment-name-input');
            const dropdown = targetCell.querySelector('.autocomplete-dropdown');
            const rackInput = targetCell.querySelector('.rack-id-input');
            const positionInput = targetCell.querySelector('.position-input');
            const targetPortInput = targetCell.querySelector('.target-port-input');

            // אירוע הקלדה - חיפוש והצגת תוצאות
            equipmentInput.addEventListener('input', () => {
                const searchTerm = equipmentInput.value.toLowerCase();

                if (searchTerm.length < 2) {
                    dropdown.style.display = 'none';
                    return;
                }

                // סינון הציודים לפי מונח החיפוש
                const filteredEquipment = equipmentList.filter(equip =>
                    equip.name.toLowerCase().includes(searchTerm)
                );

                // הצגת התוצאות בדרופדאון
                if (filteredEquipment.length > 0) {
                    dropdown.innerHTML = filteredEquipment.slice(0, 10).map(equip => `
                    <div class="autocomplete-item" 
                        data-name="${equip.name}" 
                        data-rack="${equip.rackId}" 
                        data-position="${equip.position}">
                        <span class="equip-name">${equip.name}</span> |
                        <span class="equip-dataCenterType">${equip.dataCenterType}</span> |
                        <span class="equip-rack">${equip.rackId}</span> | 
                        <span class="equip-position">U${equip.position}</span>
                    </div>
                `).join('');

                    // הוספת אירועי לחיצה על פריטים
                    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const name = item.getAttribute('data-name');
                            const rack = item.getAttribute('data-rack');
                            const position = item.getAttribute('data-position');

                            // עדכון הערכים בשדות המתאימים
                            equipmentInput.value = name;
                            rackInput.value = rack;
                            positionInput.value = position;

                            dropdown.style.display = 'none';
                        });
                    });

                    dropdown.style.display = 'block';
                } else {
                    dropdown.style.display = 'none';
                }
            });

            // סגירת הדרופדאון בלחיצה מחוץ לשדה
            document.addEventListener('click', (e) => {
                if (!targetCell.querySelector('.autocomplete-container').contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });
        });
    }

    /**
     * סגירת מודל חיבורי ציוד
     */
    closeEquipmentConnectionsModal() {
        document.getElementById('equipmentConnectionsModal').style.display = 'none';
        this.currentEquipment = null;
    }

    /**
 * יצירת מודל לתצוגת חדר שרתים
 */
    createDataCenterModal() {
        // Check if modal already exists
        if (document.getElementById('dataCenterModal')) return;

        const modalHTML = `
    <div id="dataCenterModal" class="modal-overlay">
        <div class="modal-content datacenter-modal">
            <div class="modal-header">
                <h3><i class="fas fa-server"></i> <span id="dataCenterTitle">חדר שרתים</span></h3>
                <button class="modal-close" onclick="dataCenterManager.closeDataCenterModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
               <div class="datacenter-search-container">
                    <!-- שורת חיפוש ציוד -->
                    <div class="datacenter-search-row">
                        <div class="search-box search-box-equipment">
                            <input type="text" id="dataCenterSearchInput"
                                placeholder="חפש ציוד בארונות..."
                                onkeyup="dataCenterManager.searchEquipment()">
                            <i class="fas fa-search" style="color:#667eea;"></i>
                        </div>
                        <div id="searchResultsInfo" class="search-results-info" style="display: none;">
                            <span id="searchResultsCount">0</span> ארונות נמצאו
                            <button class="btn-clear-search" onclick="dataCenterManager.clearEquipmentSearch()">
                                <i class="fas fa-times"></i> נקה
                            </button>
                        </div>
                    </div>

                    <!-- שורת חיפוש מקום פנוי - נפרדת -->
                    <div class="datacenter-search-row datacenter-free-row">
                        <button id="findFreeSpaceBtn">
                            <i class="fas fa-search"></i> חפש מקום פנוי
                        </button>
                        <div id="freeSpaceResultsInfo" class="search-results-info free-space-results" style="display: none;">
                            <span id="freeSpaceResultsCount">0</span> ארונות עם מקום פנוי
                            <button class="btn-clear-search btn-clear-free-space-search"
                                    onclick="dataCenterManager.clearFreeSpaceSearch()">
                                <i class="fas fa-times"></i> נקה
                            </button>
                        </div>
                    </div>
                </div>
                <div id="dataCenterContainer" class="datacenter-container"></div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="dataCenterManager.showAllRacks()">
                    <i class="fas fa-th-list"></i> צפה בכל הארונות
                </button>

                <button class="btn-cancel" onclick="dataCenterManager.closeDataCenterModal()">
                    <i class="fas fa-times"></i> סגור
                </button>
            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.createFindFreeSpaceModal();

        const freeSpaceButton = document.getElementById('findFreeSpaceBtn');
        if (freeSpaceButton) {
            freeSpaceButton.addEventListener('click', () => this.openFindFreeSpaceModal());
        }

        // Add event listener to refresh button
        const refreshButton = document.getElementById('refreshCurrentDataCenter');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => this.refreshCurrentDataCenter());
        }
    }


    createFindFreeSpaceModal() {
        if (document.getElementById('findFreeSpaceModal')) return;

        const modalHTML = `
    <div id="findFreeSpaceModal" class="modal-overlay" style="display:none;">
        <div class="modal-content">
            <div class="modal-header">
                <h3>
                    <i class="fas fa-search"></i>
                    חפש מקום פנוי בארון
                </h3>
                <button class="modal-close" 
                        onclick="dataCenterManager.closeFindFreeSpaceModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">
                        <i class="fas fa-ruler-vertical"></i>
                        כמה יחידות U אתה צריך?
                    </label>
                    <select id="freeSpaceUnitsSelect">
                        ${Array.from({ length: 42 }, (_, i) => i + 1)
                .map(n => `<option value="${n}" 
                                ${n === 1 ? 'selected' : ''}>
                                ${n}U
                            </option>`)
                .join('')}
                    </select>
                    <div class="free-space-hint">
                        <i class="fas fa-info-circle"></i>
                        <span>המערכת תחפש ארונות עם <strong>יחידות רציפות</strong> פנויות</span>
                    </div>
                </div>
            </div>

            <div class="modal-footer">
                <button class="btn-cancel"
                        onclick="dataCenterManager.closeFindFreeSpaceModal()">
                    <i class="fas fa-times"></i> ביטול
                </button>
                <button id="confirmFindFreeSpaceBtn">
                    <i class="fas fa-search"></i> חפש
                </button>
            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    openFindFreeSpaceModal() {
        document.getElementById('findFreeSpaceModal').style.display = 'flex';

        const confirmFindFreeSpaceBtn = document.getElementById('confirmFindFreeSpaceBtn');
        if (confirmFindFreeSpaceBtn) {
            // ❌ הסר listener ישן כדי למנוע כפילויות
            const newBtn = confirmFindFreeSpaceBtn.cloneNode(true);
            confirmFindFreeSpaceBtn.parentNode.replaceChild(newBtn, confirmFindFreeSpaceBtn);

            newBtn.addEventListener('click', () => {
                // קרא את הערך בעת לחיצה, לא בעת פתיחה
                const units = parseInt(
                    document.getElementById('freeSpaceUnitsSelect').value
                );
                if (!isNaN(units) && units > 0) {
                    dataCenterManager.findAvailableSpace(units);
                }
            });
        }
    }

    closeFindFreeSpaceModal() {
        document.getElementById('findFreeSpaceModal').style.display = 'none';
    }

    async findAvailableSpace(requiredUnits) {
        this.closeFindFreeSpaceModal();

        if (!requiredUnits || requiredUnits <= 0) {
            this._notify('יש לבחור מספר יחידות תקין', 'error');
            return;
        }

        try {
            const response = await fetch(
                `/DataCenter/FindAvailableSpace?dataCenterType=${this.currentDataCenter}&requiredUnits=${requiredUnits}`
            );

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            if (!data.success) {
                this._notify('שגיאה בחיפוש מקום פנוי', 'error');
                return;
            }

            const rackIds = data.results.map(r => r.rackId);

            this.lastFreeSpaceResults = rackIds; // ← שמור

            // סימון עם type='freeSpace' - לא ידרוס חיפוש ציוד
            this.highlightRacks(rackIds, 'freeSpace');

            // עדכון מידע תוצאות - בשורה הנפרדת
            const freeSpaceInfo = document.getElementById('freeSpaceResultsInfo');
            const freeSpaceCount = document.getElementById('freeSpaceResultsCount');
            if (freeSpaceInfo && freeSpaceCount) {
                freeSpaceCount.textContent = rackIds.length;
                freeSpaceInfo.style.display = rackIds.length > 0 ? 'flex' : 'none';
            }

            // הודעה למשתמש
            if (rackIds.length === 0) {
                this._notify(
                    `לא נמצא מקום פנוי ל-${requiredUnits}U בחדר ${this.currentDataCenter}`,
                    'info'
                );
            } else {
                this._notify(
                    `נמצאו ${rackIds.length} ארונות עם מקום פנוי ל-${requiredUnits}U`,
                    'success'
                );
            }

        } catch (error) {
            console.error('Error finding available space:', error);
            this._notify(`שגיאה בחיפוש מקום פנוי: ${error.message}`, 'error');
        }
    }

    applyFreeSpaceResults(results, requiredUnits) {
        const rackElements = document.querySelectorAll('.rack.clickable, .room.clickable');

        // מפה: rackId → availableRanges
        this.freeSpaceMap = {};
        results.forEach(r => {
            this.freeSpaceMap[r.rackId] = r.availableRanges;
        });

        rackElements.forEach(rackEl => {
            const rackId = rackEl.getAttribute('data-rack-id');

            if (this.freeSpaceMap[rackId]) {
                rackEl.style.display = '';
                rackEl.classList.add('free-space-rack');
                rackEl.setAttribute('data-required-units', requiredUnits);
            } else {
                rackEl.style.display = 'none';
            }
        });

        this.updateSearchInfo(results.length, requiredUnits);
    }

    updateSearchInfo(count, units) {
        const info = document.getElementById('freeSpaceInfo');
        document.getElementById('freeSpaceCount').textContent = count;
        document.getElementById('freeSpaceUnits').textContent = units;
        info.style.display = 'block';
    }

    /**
    * רענון נתוני חדר השרתים הנוכחי בלבד
    */
    async refreshCurrentDataCenter() {
        if (!this.currentDataCenter) return;

        const refreshButton = document.getElementById('refreshCurrentDataCenter');

        if (refreshButton) {
            refreshButton.style.display = 'none';
        }
        // הצגת מצב טעינה
        const container = document.getElementById('dataCenterContainer');
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><span>מרענן נתונים...</span></div>';

        try {
            // מחיקת קבצי הקאש בשרת עבור החדר הנוכחי בלבד
            const clearCacheResponse = await fetch(`/DataCenter/ClearCache?dataCenterType=${this.currentDataCenter}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!clearCacheResponse.ok) {
                throw new Error('שגיאה במחיקת קבצי הקאש');
            }

            // איפוס נתוני הארונות של החדר הנוכחי
            this.racksData[this.currentDataCenter] = {};
            this.dataLoadingStatus[this.currentDataCenter] = false;

            // טעינת נתונים מחדש עם אילוץ רענון
            await this.loadRacksData(this.currentDataCenter, true);

            // עדכון התצוגה
            container.innerHTML = this.generateDataCenterHTML(this.currentDataCenter);
            this.setupRackEventListeners();

            // הודעת הצלחה
            this._notify(`נתוני חדר ${this.currentDataCenter} רועננו בהצלחה מהמקור`, 'success');

        } catch (error) {
            console.error('Error refreshing data center:', error);

            // הצגת הודעת שגיאה
            container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה ברענון נתונים: ${error.message}</div>`;
            this._notify(`שגיאה ברענון נתוני חדר ${this.currentDataCenter}: ${error.message}`, 'error');
        }
    }

    /**
    * הצגת אינדיקציית טעינה ספציפית לחדר שרתים
    * @param {string} dataCenterType - סוג חדר השרתים
    * @param {string} message - הודעה להצגה
    */
    showDataCenterLoadingIndicator(dataCenterType, message = 'טוען נתונים...') {
        const container = document.getElementById('dataCenterContainer');
        if (container) {
            container.innerHTML = `
            <div class="loading-indicator">
                <div class="loading-spinner">
                    <i class="fas fa-spinner fa-spin"></i>
                </div>
                <div class="loading-message">
                    ${message} (${dataCenterType})
                </div>
                <div class="loading-progress">
                    <div class="progress-bar"></div>
                </div>
            </div>
        `;

            // אנימציה לסרגל ההתקדמות
            setTimeout(() => {
                const progressBar = container.querySelector('.progress-bar');
                if (progressBar) {
                    progressBar.style.width = '100%';
                }
            }, 100);
        }
    }

    /**
     * יצירת מודל לפרטי ארון
     */
    createRackDetailsModal() {
        if (document.getElementById('rackDetailsModal')) return;
        const modalHTML = `
    <div id="rackDetailsModal" class="modal-overlay">
        <div class="modal-content rack-details-modal">
            <div class="modal-header">
                <div class="header-actions">
                    <h3><i class="fas fa-server"></i> <span id="rackTitle">פרטי ארון</span></h3>
                    <div id="headerButtonsContainer" class="header-buttons"></div>
                </div>
                <button class="modal-close" onclick="dataCenterManager.closeRackDetails()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div id="rackWithMetricsWrapper" style="
                    display: flex;
                    flex-direction: row;
                    align-items: flex-start;
                    gap: 10px;
                    height: 100%;
                    width: 100%;
                ">
                    <!-- מטריקות צד ימין (R) -->
                    <div id="metricsRightPanel" style="
                        width: 250px;
                        flex-shrink: 0;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        height: 36%;
                        align-self: stretch;
                        position: sticky;
                        top: 20%;
                        right: 20%;
                    "></div>

                    <!-- הארון עצמו - באמצע -->
                    <div id="rackContainer" class="rack-container" style="flex-shrink: 0;"></div>

                    <!-- מטריקות צד שמאל (L) -->
                    <div id="metricsLeftPanel" style="
                        width: 250px;
                        flex-shrink: 0;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        height: 36%;
                        align-self: stretch;
                        position: sticky;
                        top: 20%;
                        left: 20%;
                    "></div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="dataCenterManager.exportRackData()">
                    <i class="fa-solid fa-print"></i> הדפס
                </button>
                <button class="btn-cancel" onclick="dataCenterManager.closeRackDetails()">
                    <i class="fas fa-times"></i> סגור
                </button>
            </div>
        </div>
    </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }


    /**
     * סגירת מודל חדר שרתים
     */
    closeDataCenterModal() {
        document.getElementById('dataCenterModal').style.display = 'none';
        this.clearSearch();       // ניקוי חיפוש ציוד
        this.clearFreeSpaceSearch(); // ניקוי חיפוש מקום פנוי
    }

    /**
     * יצירת HTML לתצוגת חדר שרתים
     * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
     * @returns {string} - קוד HTML
     */
    generateDataCenterHTML(dataCenterType) {
        // בחירת תבנית HTML בהתאם לסוג חדר השרתים
        if (dataCenterType === 'RG') {
            return this.generateRGDataCenterHTML();
        } else if (dataCenterType === 'PT') {
            return this.generatePTDataCenterHTML();
        } else {
            return '<div class="error-message">סוג חדר שרתים לא נתמך</div>';
        }
    }

    /**
    * יצירת HTML לתצוגת חדר שרתים רמת גן
    * @returns {string} - קוד HTML
    */
    generateRGDataCenterHTML() {
        return `
    <div class="floor-plan-container">
      <!-- Room A -->
      <div class="floor-plan room-a">
        <h2 class="title-btn">חדר A - STORAGE</h2>
        <div class="building-wrapper">
          <div class="building-main">
            <!-- Row backgrounds -->
            <div class="row-bg row-bg-1"></div>
            <div class="row-bg row-bg-2"></div>
            <div class="row-bg row-bg-3"></div>
            <div class="row-bg row-bg-4"></div>
            <!-- Walls -->
            <div class="wall wall-left"></div>
            <div class="wall wall-top"></div>
            <div class="wall wall-right"></div>
            <div class="wall wall-bottom"></div>
            <!-- Rooms -->
            <div class="room room-a1-1 clickable" data-rack-id="A1-1"><span>A1-1</span></div>
            <div class="room room-a1-2 clickable" data-rack-id="A1-2"><span>A1-2</span></div>
            <div class="room room-a1-3 clickable" data-rack-id="A1-3"><span>A1-3</span></div>
            <div class="room room-a1-4 clickable" data-rack-id="A1-4"><span>A1-4</span></div>
            <div class="room room-a1-5 clickable" data-rack-id="A1-5"><span>A1-5</span></div>
            <div class="room room-a1-6 clickable" data-rack-id="A1-6"><span>A1-6</span></div>
            <div class="room room-a1-7 clickable" data-rack-id="A1-7"><span>A1-7</span></div>
            <div class="room room-a2-2 clickable" data-rack-id="A2-2"><span>A2-2</span></div>
            <div class="room room-a2-1 clickable" data-rack-id="A2-1"><span>A2-1</span></div>
            <div class="room room-a3-2 clickable" data-rack-id="A3-2"><span>A3-2</span></div>
            <div class="room room-a3-3 clickable" data-rack-id="A3-3"><span>A3-3</span></div>
            <div class="room room-a3-4 clickable" data-rack-id="A3-4"><span>A3-4</span></div>
            <div class="room room-a3-5 clickable" data-rack-id="A3-5"><span>A3-5</span></div>
            <div class="room room-a3-6 clickable" data-rack-id="A3-6"><span>A3-6</span></div>
            <div class="room room-a3-7 clickable" data-rack-id="A3-7"><span>A3-7</span></div>
            <div class="room room-a4-3 clickable" data-rack-id="A4-3"><span>A4-3</span></div>
            <div class="room room-a4-4 clickable" data-rack-id="A4-4"><span>A4-4</span></div>
            <div class="room room-a4-5 clickable" data-rack-id="A4-5"><span>A4-5</span></div>
            <div class="room room-a4-6 clickable" data-rack-id="A4-6"><span>A4-6</span></div>
            <div class="room room-a4-7 clickable" data-rack-id="A4-7"><span>A4-7</span></div>
          </div>

          <!-- Entrances -->
          <div class="entrance entrance-5"></div>
        </div>
      </div>

      <!-- Room B -->
      <div class="floor-plan room-b">
        <h2 class="title-btn">חדר ראשי - B</h2>
        <div class="building-wrapper">
          <div class="building-main">
            <!-- Row backgrounds -->
            <div class="row-bg row-bg-1-b"></div>
            <div class="row-bg row-bg-2-b"></div>
            <div class="row-bg row-bg-3-b"></div>
            <div class="row-bg row-bg-4-b"></div>
            <div class="row-bg row-bg-5"></div>
            <div class="row-bg row-bg-6"></div>
            <!-- Walls -->
            <div class="wall wall-left-b"></div>
            <div class="wall wall-top-b"></div>
            <div class="wall wall-right-b"></div>
            <div class="wall wall-bottom-b"></div>
            <!-- Rooms -->
            <div class="room room-b1-0 clickable" data-rack-id="B1-0"><span>B1-0</span></div>
            <div class="room room-b1-1 clickable" data-rack-id="B1-1"><span>B1-1</span></div>
            <div class="room room-b1-2 clickable" data-rack-id="B1-2"><span>B1-2</span></div>
            <div class="room room-b1-3 clickable" data-rack-id="B1-3"><span>B1-3</span></div>
            <div class="room room-b1-4 clickable" data-rack-id="B1-4"><span>B1-4</span></div>
            <div class="room room-b1-5 clickable" data-rack-id="B1-5"><span>B1-5</span></div>
            <div class="room room-b1-6 clickable" data-rack-id="B1-6"><span>B1-6</span></div>
            <div class="room room-b2-1 clickable" data-rack-id="B2-1"><span>B2-1</span></div>
            <div class="room room-b2-2 clickable" data-rack-id="B2-2"><span>B2-2</span></div>
            <div class="room room-b2-3 clickable" data-rack-id="B2-3"><span>B2-3</span></div>
            <div class="room room-b2-4 clickable" data-rack-id="B2-4"><span>B2-4</span></div>
            <div class="room room-b2-5 clickable" data-rack-id="B2-5"><span>B2-5</span></div>
            <div class="room room-b2-6 clickable" data-rack-id="B2-6"><span>B2-6</span></div>
            <div class="room room-b2-7 clickable" data-rack-id="B2-7"><span>B2-7</span></div>
            <div class="room room-b3-1 clickable" data-rack-id="B3-1"><span>B3-1</span></div>
            <div class="room room-b3-2 clickable" data-rack-id="B3-2"><span>B3-2</span></div>
            <div class="room room-b3-3 clickable" data-rack-id="B3-3"><span>B3-3</span></div>
            <div class="room room-b3-4 clickable" data-rack-id="B3-4"><span>B3-4</span></div>
            <div class="room room-b3-5 clickable" data-rack-id="B3-5"><span>B3-5</span></div>
            <div class="room room-b3-6 clickable" data-rack-id="B3-6"><span>B3-6</span></div>
            <div class="room room-b3-7 clickable" data-rack-id="B3-7"><span>B3-7</span></div>
            <div class="room room-b4-1 clickable" data-rack-id="B4-1"><span>B4-1</span></div>
            <div class="room room-b4-2 clickable" data-rack-id="B4-2"><span>B4-2</span></div>
            <div class="room room-b4-3 clickable" data-rack-id="B4-3"><span>B4-3</span></div>
            <div class="room room-b4-4 clickable" data-rack-id="B4-4"><span>B4-4</span></div>
            <div class="room room-b4-5 clickable" data-rack-id="B4-5"><span>B4-5</span></div>
            <div class="room room-b4-6 clickable" data-rack-id="B4-6"><span>B4-6</span></div>
            <div class="room room-b4-7 clickable" data-rack-id="B4-7"><span>B4-7</span></div>
            <div class="room room-b5-1 clickable" data-rack-id="B5-1"><span>B5-1</span></div>
            <div class="room room-b5-2 clickable" data-rack-id="B5-2"><span>B5-2</span></div>
            <div class="room room-b5-3 clickable" data-rack-id="B5-3"><span>B5-3</span></div>
            <div class="room room-b5-4 clickable" data-rack-id="B5-4"><span>B5-4</span></div>
            <div class="room room-b5-5 clickable" data-rack-id="B5-5"><span>B5-5</span></div>
            <div class="room room-b5-6 clickable" data-rack-id="B5-6"><span>B5-6</span></div>
            <div class="room room-b5-7 clickable" data-rack-id="B5-7"><span>B5-7</span></div>
            <div class="room room-b6-1 clickable" data-rack-id="B6-1"><span>B6-1</span></div>
            <div class="room room-b6-2 clickable" data-rack-id="B6-2"><span>B6-2</span></div>
            <div class="room room-b6-3 clickable" data-rack-id="B6-3"><span>B6-3</span></div>
            <div class="room room-b6-4 clickable" data-rack-id="B6-4"><span>B6-4</span></div>
            <div class="room room-b6-5 clickable" data-rack-id="B6-5"><span>B6-5</span></div>
            <div class="room room-b6-6 clickable" data-rack-id="B6-6"><span>B6-6</span></div>
            <div class="room room-b6-7 clickable" data-rack-id="B6-7"><span>B6-7</span></div>
          </div>

            <!-- Entrances -->
            <div class="entrance entrance-4"></div>
        </div>
      </div>
    </div>`;
    }

    /**
     * יצירת HTML לתצוגת חדר שרתים פתח תקווה
     * @returns {string} - קוד HTML
     */
    generatePTDataCenterHTML() {
        return `
    <div class="floor-plan">
        <div class="building-wrapper">
            <div class="building-main">
                <div class="datacenter-container">
                    <!-- Row backgrounds -->
                    <div class="row-bg row-bg-f"></div>
                    <div class="row-bg row-bg-d"></div>
                    <div class="row-bg row-bg-e"></div>
                    <div class="row-bg row-bg-c"></div>
                    <div class="row-bg row-bg-b"></div>
                    <div class="row-bg row-bg-a1"></div>
                    <div class="row-bg row-bg-a2"></div>

                    <!-- Walls -->
                    <div class="wall wall-left-outer"></div>
                    <div class="wall wall-top-main"></div>
                    <div class="wall wall-top-right"></div>
                    <div class="wall wall-top-outer-right"></div>
                    <div class="wall wall-top-outer-left"></div>
                    <div class="wall wall-right-outer"></div>
                    <div class="wall wall-bottom-outer"></div>
                    <div class="wall wall-vertical-1"></div>

                    <!-- Dashed areas -->
                    <div class="dashed-area-2"></div>
                    <div class="dashed-area-3"></div>
                    <!-- Racks - Row F -->
                    <div class="room room-f2 clickable" data-rack-id="F2"><span>F2</span></div>
                    <div class="room room-f3 clickable" data-rack-id="F3"><span>F3</span></div>
                    <div class="room room-f4 clickable" data-rack-id="F4"><span>F4</span></div>
                    <div class="room room-f5 clickable" data-rack-id="F5"><span>F5</span></div>
                    <div class="room room-f1-left clickable" data-rack-id="F1"><span>F1</span></div>
                    

                    <!-- Racks - Row E -->
                    <div class="room room-e8 clickable" data-rack-id="E8"><span>E8</span></div>
                    <div class="room room-e7 clickable" data-rack-id="E7"><span>E7</span></div>
                    <div class="room room-e6 clickable" data-rack-id="E6"><span>E6</span></div>
                    <div class="room room-e4 clickable" data-rack-id="E3 + E4"><span>E3+E4</span></div>
                    <div class="room room-e1 clickable" data-rack-id="E1"><span>E1</span></div>

                    <!-- Racks - Row D -->
                    <div class="room room-d2 clickable" data-rack-id="D2"><span>D2</span></div>
                    <div class="room room-d3 clickable" data-rack-id="D3"><span>D3</span></div>
                    <div class="room room-d4 clickable" data-rack-id="D4"><span>D4</span></div>
                    <div class="room room-d5 clickable" data-rack-id="D5"><span>D5</span></div>
                    <div class="room room-d6 clickable" data-rack-id="D6"><span>D6</span></div>
                    <div class="room room-d7 clickable" data-rack-id="D7"><span>D7</span></div>
                    <div class="room room-d8 clickable" data-rack-id="D8"><span>D8</span></div>

                    <!-- Racks - Row C -->
                    <div class="room room-c1 clickable" data-rack-id="C1"><span>C1</span></div>
                    <div class="room room-c2 clickable" data-rack-id="C2"><span>C2</span></div>
                    <div class="room room-c3 clickable" data-rack-id="C3"><span>C3</span></div>

                    <!-- Racks - Row B -->
                    <div class="room room-b1 clickable" data-rack-id="B1"><span>B1</span></div>
                    <div class="room room-b2 clickable" data-rack-id="B2"><span>B2</span></div>
                    <div class="room room-b3 clickable" data-rack-id="B3"><span>B3</span></div>
                    <div class="room room-b4 clickable" data-rack-id="B4"><span>B4</span></div>

                    <!-- Racks - Row A -->
                    <div class="room room-a1 clickable" data-rack-id="A1"><span>A1</span></div>
                    <div class="room room-a2 clickable" data-rack-id="A2"><span>A2</span></div>
                    <div class="room room-a3 clickable" data-rack-id="A3"><span>A3</span></div>
                    <div class="room room-a5 clickable" data-rack-id="A5"><span>A5</span></div>
                    <div class="room room-a6 clickable" data-rack-id="A6"><span>A6</span></div>
                    <div class="room room-a7 clickable" data-rack-id="A7"><span>A7</span></div>
                    <div class="room room-a8 clickable" data-rack-id="A8"><span>A8</span></div>
                    <div class="room room-a9 clickable" data-rack-id="A9"><span>A9</span></div>

                    <!-- Entrances -->
                    <div class="entrance entrance-left"></div>
                    <div class="entrance entrance-1"></div>
                    <div class="entrance entrance-2"></div>
                    <div class="entrance entrance-3"></div>
                </div>
            </div>
        </div>
    </div>`;
    }

    /**
     * הוספת מאזיני אירועים לארונות
     */
    setupRackEventListeners() {
        // Select both room and rack clickable elements
        const racks = document.querySelectorAll('.room.clickable, .rack.clickable');
        racks.forEach(rack => {
            rack.addEventListener('click', () => {
                const rackId = rack.getAttribute('data-rack-id');
                this.showRackDetails(rackId);
            });
        });
    }

    /**
     * טעינת נתוני ארון
     * @param {string} rackId - מזהה הארון
     * @returns {Array} - מערך של פריטי ציוד בארון
     */
    async loadRackData(rackId) {
        // Show loading message
        const loadingMessage = document.createElement('div');
        loadingMessage.className = 'loading-message';
        loadingMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> טוען נתונים...';
        document.body.appendChild(loadingMessage);

        try {
            // Check if we have local data first - שימוש בנתונים לפי סוג חדר השרתים
            if (this.racksData[this.currentDataCenter] && this.racksData[this.currentDataCenter][rackId]) {
                return this.racksData[this.currentDataCenter][rackId];
            }

            try {
                // Try to load from server
                const response = await fetch(`/DataCenter/GetRackDetails?rackId=${rackId}&dataCenterType=${this.currentDataCenter}`);

                // Handle 404 specifically - return empty array instead of throwing error
                if (response.status === 404) {
                    console.warn(`Rack ${rackId} not found on server, using empty data`);
                    return [];
                }

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
                }

                const data = await response.json();

                if (data.success) {
                    // Cache the data locally - שמירה לפי סוג חדר השרתים
                    if (!this.racksData[this.currentDataCenter]) {
                        this.racksData[this.currentDataCenter] = {};
                    }
                    this.racksData[this.currentDataCenter][rackId] = data.rackData || [];
                    return this.racksData[this.currentDataCenter][rackId];
                } else {
                    console.error('Error loading rack data:', data.error);
                    return [];
                }
            } catch (error) {
                console.error('Error fetching rack data:', error);

                // Show error message to user
                // this._notify(`שגיאה בטעינת נתוני ארון ${rackId}: ${error.message}`, 'error');

                // Return empty array on error
                return [];
            }
        } finally {
            // Remove loading message - this ensures it's removed even if there's an error
            if (document.body.contains(loadingMessage)) {
                document.body.removeChild(loadingMessage);
            }
        }
    }

    /**
    * יצירת מודל להצגת כל הארונות
    */
    createAllRacksModal() {
        // בדיקה אם המודל כבר קיים
        if (document.getElementById('allRacksModal')) return;
        const modalHTML = `
    <div id="allRacksModal" class="modal-overlay">
        <div class="modal-content all-racks-modal">
            <div class="modal-header">
                <h3><i class="fas fa-server"></i> כל הארונות - <span id="allRacksTitle">${this.currentDataCenter === 'PT' ? 'פ"ת' : 'ר"ג'}</span></h3>
                <button class="modal-close" onclick="dataCenterManager.closeAllRacksModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div id="allRacksContainer" class="all-racks-container"></div>
            </div>
            <div class="modal-footer">
                <button class="btn-primary" onclick="dataCenterManager.exportToExcel()">
                    <i class="fa-solid fa-file-excel"></i> ייצוא לאקסל
                </button>
                <button class="btn-primary" onclick="dataCenterManager.printAllRacks()">
                    <i class="fa-solid fa-print"></i> הדפס
                </button>
                <button class="btn-cancel" onclick="dataCenterManager.closeAllRacksModal()">
                    <i class="fas fa-times"></i> סגור
                </button>
            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
    * סגירת מודל פרטי ארון
    */
    closeRackDetails() {
        // סגירת המודל
        document.getElementById('rackDetailsModal').style.display = 'none';

        const rightPanel = document.getElementById('metricsRightPanel');
        const leftPanel = document.getElementById('metricsLeftPanel');
        if (rightPanel) rightPanel.innerHTML = '';
        if (leftPanel) leftPanel.innerHTML = '';

        // הסרת אלמנט המטריקות הישן אם קיים
        const metricsContainer = document.getElementById('rackMetricsContainer');
        if (metricsContainer) metricsContainer.remove();

        // ניקוי מיכל הכפתורים בכותרת
        const headerButtonsContainer = document.getElementById('headerButtonsContainer');
        if (headerButtonsContainer) headerButtonsContainer.innerHTML = '';

        // איפוס הארון הנוכחי
        this.currentRack = null;
    }

    /**
    * חיפוש ציוד בארונות
    */
    searchEquipment() {
        const searchInput = document.getElementById('dataCenterSearchInput');
        const searchTerm = searchInput.value.trim().toLowerCase();
        this.lastSearchTerm = searchTerm; // ← שמור

        if (!searchTerm) {
            this.clearEquipmentSearch();
            return;
        }

        // מערך לשמירת הארונות שנמצאו בהם תוצאות
        const foundRacks = [];
        // נמצא את כל הארונות המוצגים כרגע בממשק
        const visibleRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        const visibleRackIds = Array.from(visibleRacks).map(rack => rack.getAttribute('data-rack-id'));

        // תיקון: חפש בכל החדרים הזמינים, לא רק בנוכחי
        const dataToSearch = {};

        if (this.currentDataCenter && this.racksData[this.currentDataCenter] &&
            Object.keys(this.racksData[this.currentDataCenter]).length > 0) {
            // יש חדר נוכחי - חפש בו
            dataToSearch[this.currentDataCenter] = this.racksData[this.currentDataCenter];
        } else {
            // אין חדר נוכחי - חפש בכל החדרים
            Object.assign(dataToSearch, this.racksData);
        }

        for (const rackId of visibleRackIds) {
            // חפש בכל החדרים הרלוונטיים
            for (const dcType in dataToSearch) {
                if (!dataToSearch[dcType][rackId]) continue;

                const rackData = dataToSearch[dcType][rackId];
                const hasMatch = rackData.some(item =>
                    (item.Equipment && item.Equipment.toLowerCase().includes(searchTerm)) ||
                    (item.equipment && item.equipment.toLowerCase().includes(searchTerm))
                );

                // מצאנו התאמה בארון זה
                if (hasMatch && !foundRacks.includes(rackId)) {
                    foundRacks.push(rackId);
                }
            }
        }

        // סימון הארונות שנמצאו בהם תוצאות
        this.highlightRacks(foundRacks);
        // עדכון מידע על תוצאות החיפוש
        searchResultsCount.textContent = foundRacks.length;
        searchResultsInfo.style.display = foundRacks.length > 0 ? 'flex' : 'none';
    }

    /**
     * סימון ארונות שנמצאו בהם תוצאות חיפוש
     * @param {Array} rackIds - מערך של מזהי ארונות לסימון
     */
    highlightRacks(rackIds, type = 'search') {
        // type: 'search' | 'freeSpace'
        const cssClass = type === 'freeSpace' ? 'free-space-rack' : 'search-result';
        const otherClass = type === 'freeSpace' ? 'search-result' : 'free-space-rack';

        const allRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        allRacks.forEach(rack => {
            rack.classList.remove(cssClass); // הסר רק את הסוג הנוכחי
            // אל תגע בסוג האחר!
        });

        rackIds.forEach(rackId => {
            const rackElement = document.querySelector(
                `.room[data-rack-id="${rackId}"], .rack[data-rack-id="${rackId}"]`
            );
            if (rackElement) {
                rackElement.classList.add(cssClass);
            }
        });
    }

    clearFreeSpaceSearch() {
        const freeSpaceInfo = document.getElementById('freeSpaceResultsInfo');
        if (freeSpaceInfo) freeSpaceInfo.style.display = 'none';

        this.lastFreeSpaceResults = [];
        this.availableSpaceMap = {};
        this.freeSpaceMap = {};

        // הסר רק סימוני מקום פנוי
        const allRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        allRacks.forEach(rack => {
            rack.classList.remove('free-space-rack');
        });

        // אם יש חיפוש ציוד פעיל - הפעל אותו מחדש
        if (this.lastSearchTerm) {
            this.searchEquipment();
        }
    }

    clearEquipmentSearch() {
        const searchInput = document.getElementById('dataCenterSearchInput');
        const searchResultsInfo = document.getElementById('searchResultsInfo');

        if (searchInput) searchInput.value = '';
        if (searchResultsInfo) searchResultsInfo.style.display = 'none';
        this.lastSearchTerm = '';

        // הסר רק סימוני חיפוש ציוד, שמור סימוני מקום פנוי
        const allRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        allRacks.forEach(rack => {
            rack.classList.remove('search-result', 'search-highlight');
            // אם יש גם תוצאות מקום פנוי - שמור אותן
            if (this.lastFreeSpaceResults.includes(rack.getAttribute('data-rack-id'))) {
                rack.classList.add('free-space-rack');
            }
        });
    }

    /**
     * ניקוי החיפוש והסרת הסימונים
     */
    clearSearch() {
        const searchInput = document.getElementById('dataCenterSearchInput');
        const searchResultsInfo = document.getElementById('searchResultsInfo');

        // בדיקת null לפני שימוש
        if (searchInput) searchInput.value = '';
        if (searchResultsInfo) searchResultsInfo.style.display = 'none';

        this.lastSearchTerm = ''; // איפוס מונח החיפוש

        const allRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        allRacks.forEach(rack => {
            rack.classList.remove('search-result');
            rack.classList.remove('search-highlight');
        });
    }


    /**
    * הוספת כפתור לצריכת חשמל וטמפרטורה
    */
    addRackMetricsButton() {
        // בדיקה אם הכפתור כבר קיים
        if (document.getElementById('viewRackMetricsBtn')) return;

        const rackTitle = document.getElementById('rackTitle');
        if (!rackTitle) return;

        // מציאת ה-header שמכיל את הכותרת
        const buttonsContainer = document.getElementById('headerButtonsContainer');

        const metricsButton = document.createElement('button');
        metricsButton.id = 'viewRackMetricsBtn';
        metricsButton.className = 'view-metrics-btn';
        metricsButton.innerHTML = '<i class="fas fa-chart-line"></i> צפה במטריקות';
        metricsButton.onclick = () => this.showRackMetrics(this.currentRack.id);
        metricsButton.style.marginRight = '10px'; // מרווח בין הכפתורים

        // הוספת הכפתור ליד כפתור הוספת ציוד אם קיים, אחרת לסוף ה-header
        if (metricsButton) {
            buttonsContainer.insertAdjacentElement('beforeend', metricsButton)
        } else {
            modalHeader.appendChild(metricsButton);
        }
    }

    /**
    * הצגת פרטי ארון עם סימון ציוד שמתאים לחיפוש
    * @param {string} rackId - מזהה הארון
    */
    async showRackDetails(rackId) {
        // הצגת מצב טעינה
        document.getElementById('rackContainer').innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><span>טוען נתונים...</span></div>';
        document.getElementById('rackTitle').textContent = `ארון ${rackId} - באתר ${this.currentDataCenter === 'PT' ? 'פתח תקווה' : 'רמת גן'}`;
        document.getElementById('rackDetailsModal').style.display = 'flex';

        try {
            // טעינת נתוני הארון
            const rackData = await this.loadRackData(rackId);
            this.currentRack = { id: rackId, data: rackData };

            // קבלת מונח החיפוש הנוכחי
            const searchTerm = document.getElementById('dataCenterSearchInput')?.value.trim().toLowerCase() || '';

            // יצירת HTML עם סימון ציוד שמתאים לחיפוש
            const rackHTML = this.generateRackHTML(rackId, rackData, searchTerm);

            // עדכון תוכן המודל
            document.getElementById('rackContainer').innerHTML = rackHTML;

            // הוספת מאזיני אירועים לפריטי ציוד
            this.setupEquipmentEventListeners();

            // בדיקת הרשאת עריכה
            if (this.canEdit) {
                // הוספת כפתור להוספת ציוד חדש
                this.addEquipmentAddButton();

                // הוספת אירועי לחיצה ימנית לפריטי ציוד
                this.setupEquipmentContextMenu();
            }

            // טעינת מטריקות נוכחיות של הארון
            try {
                const metricsL = await this.getCurrentRackMetrics(rackId, "L");
                const metricsR = await this.getCurrentRackMetrics(rackId, "R");

                const rightPanel = document.getElementById('metricsRightPanel');
                const leftPanel = document.getElementById('metricsLeftPanel');

                // ניקוי פאנלים קודמים
                if (rightPanel) rightPanel.innerHTML = '';
                if (leftPanel) leftPanel.innerHTML = '';

                if (!metricsL.success && metricsL.error?.includes("A connection attempt failed")) {
                    const errorText = await metricsL.error;
                    document.getElementById('metricsLeftPanel').innerHTML =
                        '<div class="error-message"><i class="fas fa-exclamation-triangle"></i>שגיאה בטעינת נתוני חשמל וטמפרטורה</div>';
                    console.error(`HTTP error! message: ${errorText}`);
                }
                if (!metricsR.success && metricsL.error?.includes("A connection attempt failed")) {
                    const errorText = await metricsR.error;
                    document.getElementById('metricsRightPanel').innerHTML =
                        '<div class="error-message"><i class="fas fa-exclamation-triangle"></i>שגיאה בטעינת נתוני חשמל וטמפרטורה</div>';
                    console.error(`HTTP error! message: ${errorText}`);
                }

                // צד ימין (R) - מוצג מימין לארון
                if (rightPanel && metricsR.success &&
                    (metricsR.currentPower || metricsR.currentTemperature)) {

                    const tempThresholdR = this.getTemperatureThreshold(metricsR.currentTemperature);
                    const borderColorR = tempThresholdR.borderColor;

                    rightPanel.innerHTML = `
            <div onclick="dataCenterManager.showDetailedMetrics('${rackId}')"
                style="
                border: 2px solid ${borderColorR};
                border-radius: 8px;
                padding: 10px;
                background: #fafafa;
                height: 100%;
                box-sizing: border-box;
                cursor: pointer;
                transition: box-shadow 0.2s ease, transform 0.1s ease;
             "
             onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'; this.style.transform='scale(1.01)';"
             onmouseout="this.style.boxShadow='none'; this.style.transform='scale(1)';"
        >
                <h4 style="
                    text-align: center;
                    margin: 0 0 10px 0;
                    font-size: 0.85rem;
                    color: #333;
                    border-bottom: 2px solid ${borderColorR};
                    padding-bottom: 6px;
                ">
                    <i class="fas fa-plug" style="color:${borderColorR};"></i> צד ימין (R)
                </h4>
                ${this.generateMetricsHTML(metricsR)}
                <div style="text-align:center; margin-top:10px;">
                    <button class="btn-primary" style="font-size:0.95rem; padding:6px 10px;"
                            onclick="event.stopPropagation(); dataCenterManager.showDetailedMetrics('${rackId}')">
                        <i class="fas fa-chart-line"></i> גרף
                    </button>
                </div>
            </div>`;
                }

                // צד שמאל (L) - מוצג משמאל לארון
                if (leftPanel && metricsL.success &&
                    (metricsL.currentPower || metricsL.currentTemperature)) {

                    const tempThresholdL = this.getTemperatureThreshold(metricsL.currentTemperature);
                    const borderColorL = tempThresholdL.borderColor;

                    leftPanel.innerHTML = `
        <div onclick="dataCenterManager.showDetailedMetrics('${rackId}')"
             style="
                border: 2px solid ${borderColorL};
                border-radius: 8px;
                padding: 10px;
                background: #fafafa;
                height: 100%;
                box-sizing: border-box;
                cursor: pointer;
                transition: box-shadow 0.2s ease, transform 0.1s ease;
             "
             onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.15)'; this.style.transform='scale(1.01)';"
             onmouseout="this.style.boxShadow='none'; this.style.transform='scale(1)';"
        >
            <h4 style="
                text-align: center;
                margin: 0 0 10px 0;
                font-size: 0.85rem;
                color: #333;
                border-bottom: 2px solid ${borderColorL};
                padding-bottom: 6px;
            ">
                <i class="fas fa-plug" style="color:${borderColorL};"></i> צד שמאל (L)
            </h4>
            ${this.generateMetricsHTML(metricsL)}
            <div style="text-align:center; margin-top:10px;">
                <button class="btn-primary" style="font-size:0.95rem; padding:6px 10px;"
                        onclick="event.stopPropagation(); dataCenterManager.showDetailedMetrics('${rackId}')">
                    <i class="fas fa-chart-line"></i> גרף
                </button>
            </div>
        </div>`;
                }

            } catch (error) {
                console.warn('Could not load rack metrics:', error);
                // אם יש שגיאה בטעינת המטריקות, נמשיך בלעדיהן
            }
        } catch (error) {
            console.error('Error loading rack data:', error);
            document.getElementById('rackContainer').innerHTML =
                '<div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת נתוני הארון</div>';
        }
    }

    /**
     * סינון נתונים לפי טווח זמן
     * @param {Array} data - נתוני המטריקות
     * @param {number} minutes - מספר דקות לסינון
     * @returns {Array} - נתונים מסוננים
     */
    filterDataByTimeRange(data, minutes) {
        if (!data || !Array.isArray(data) || data.length === 0) {
            return [];
        }

        const now = Math.floor(Date.now() / 1000); // זמן נוכחי בשניות
        const cutoffTime = now - (minutes * 60); // זמן התחלתי לסינון

        return data.filter(point => point.timestamp >= cutoffTime);
    }

    /**
    * עדכון טווח הזמן בגרפים
    */
    updateChartsTimeRange() {
        try {
            const timeRangeSelector = document.getElementById('timeRangeSelector');
            if (!timeRangeSelector) {
                console.warn('Time range selector not found');
                return;
            }

            if (!this.currentMetricsData) {
                console.warn('No metrics data available');
                return;
            }

            const selectedMinutes = parseInt(timeRangeSelector.value);
            if (isNaN(selectedMinutes)) {
                console.warn('Invalid time range value');
                return;
            }

            // מחיקת הגרפים הקיימים
            const chartElements = document.querySelectorAll('.chart-container canvas');
            chartElements.forEach(canvas => {
                if (canvas.chart) {
                    canvas.chart.destroy();
                }
            });

            // בדיקה שיש נתונים לצד שמאל
            if (this.currentMetricsData.L && this.currentMetricsData.L.success) {
                const leftSideElement = document.querySelector('.left-side');
                if (leftSideElement) {
                    const chartSections = leftSideElement.querySelectorAll('.chart-section');
                    if (chartSections.length >= 2) {
                        // *** תיקון: chartSections[0] = טמפרטורה, chartSections[1] = חשמל ***
                        const tempChartElement = chartSections[0].querySelector('canvas');
                        const powerChartElement = chartSections[1].querySelector('canvas');

                        if (tempChartElement && tempChartElement.id) {
                            const filteredTempData = this.filterDataByTimeRange(
                                this.currentMetricsData.L.temperatureData || [],
                                selectedMinutes
                            );
                            this.createMetricsChart(
                                tempChartElement.id,
                                filteredTempData,
                                'טמפרטורה (°C)',
                                'rgb(54, 162, 235)'
                            );
                        }

                        if (powerChartElement && powerChartElement.id) {
                            const filteredPowerData = this.filterDataByTimeRange(
                                this.currentMetricsData.L.powerData || [],
                                selectedMinutes
                            );
                            this.createMetricsChart(
                                powerChartElement.id,
                                filteredPowerData,
                                'צריכת חשמל (W)',
                                'rgb(255, 99, 132)'
                            );
                        }
                    }
                }
            }

            // בדיקה שיש נתונים לצד ימין
            if (this.currentMetricsData.R && this.currentMetricsData.R.success) {
                const rightSideElement = document.querySelector('.right-side');
                if (rightSideElement) {
                    const chartSections = rightSideElement.querySelectorAll('.chart-section');
                    if (chartSections.length >= 2) {
                        // *** תיקון: chartSections[0] = טמפרטורה, chartSections[1] = חשמל ***
                        const tempChartElement = chartSections[0].querySelector('canvas');
                        const powerChartElement = chartSections[1].querySelector('canvas');

                        if (tempChartElement && tempChartElement.id) {
                            const filteredTempData = this.filterDataByTimeRange(
                                this.currentMetricsData.R.temperatureData || [],
                                selectedMinutes
                            );
                            this.createMetricsChart(
                                tempChartElement.id,
                                filteredTempData,
                                'טמפרטורה (°C)',
                                'rgb(54, 162, 235)'
                            );
                        }

                        if (powerChartElement && powerChartElement.id) {
                            const filteredPowerData = this.filterDataByTimeRange(
                                this.currentMetricsData.R.powerData || [],
                                selectedMinutes
                            );
                            this.createMetricsChart(
                                powerChartElement.id,
                                filteredPowerData,
                                'צריכת חשמל (W)',
                                'rgb(255, 99, 132)'
                            );
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error updating charts time range:', error);
            this._notify('שגיאה בעדכון טווח הזמן בגרפים', 'error');
        }
    }

    /**
    * הוספת אירועי לחיצה ימנית לפריטי ציוד
    */
    setupEquipmentContextMenu() {
        const equipmentItems = document.querySelectorAll('.equipment-item');
        equipmentItems.forEach(item => {
            // וודא שיש לנו את כל הערכים הנדרשים
            const position = parseInt(item.getAttribute('data-position')) || 0;
            const equipment = item.querySelector('.model-name')?.textContent || 'ציוד לא ידוע';

            // חילוץ גודל הציוד מהקלאסים
            let sizeUnits = 1; // ברירת מחדל
            const sizeClass = Array.from(item.classList).find(cls => cls.startsWith('size-'));
            if (sizeClass) {
                sizeUnits = parseInt(sizeClass.replace('size-', '')) || 1;
            }

            // הוספת אירוע לחיצה ימנית
            item.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                this.showEquipmentActions(event, item);
            });

            // הוספת כפתור פעולות בתוך פריט הציוד
            const actionsButton = document.createElement('button');
            actionsButton.className = 'equipment-actions-button';
            actionsButton.innerHTML = '<i class="fas fa-ellipsis-v"></i>';
            actionsButton.onclick = (event) => {
                event.stopPropagation();
                this.showEquipmentActions(event, item);
            };

            // וודא שהכפתור נוסף רק פעם אחת
            if (!item.querySelector('.equipment-actions-button')) {
                item.appendChild(actionsButton);
            }
        });
    }

    /**
    * יצירת HTML לתצוגת ארון עם סימון ציוד שמתאים לחיפוש
    * @param {string} rackId - מזהה הארון
    * @param {Array} rackData - נתוני הארון
    * @param {string} searchTerm - מונח החיפוש
    * @returns {string} - קוד HTML
    */
    generateRackHTML(rackId, rackData, searchTerm = '') {
        if (!rackData || rackData.length === 0) {
            return `
        <div class="rack-container">
            <div class="rack-header">${rackId}</div>
            <div class="empty-rack-message">
                <i class="fas fa-info-circle"></i>
                אין נתונים זמינים עבור ארון זה
            </div>
        </div>`;
        }

        let html = `
    <div class="rack-container">
        <div class="rack-header">${rackId}</div>
        <div class="rack-units">
            <div class="unit-numbers"></div>
            <div class="equipment-container">`;

        // Add equipment items with search highlighting and make them clickable
        rackData.forEach(item => {
            // startPosition = U תחתון (כפי שנשמר בשרת)
            const startPosition = item.startPosition || item.StartPosition || 0;
            const sizeUnits = item.size_units || item.SizeUnits || 1;

            // topPosition = U עליון (לצורך CSS class)
            const topPosition = startPosition + sizeUnits - 1;

            const equipmentType = item.type || item.Type || 'other';
            const equipmentName = item.equipment || item.Equipment || 'ציוד לא ידוע';

            const fontSize = sizeUnits <= 1 ? '9px' :
                sizeUnits <= 3 ? '10px' : '14px';

            const isMatch = searchTerm && equipmentName &&
                equipmentName.toLowerCase().includes(searchTerm.toLowerCase());

            const highlightClass = isMatch ? 'search-highlight-equipment' : '';
            const clickableClass = 'clickable-equipment';

            html += `
        <div class="equipment-item pos-${topPosition} size-${sizeUnits} 
                    type-${equipmentType} ${highlightClass} ${clickableClass}"
             data-position="${startPosition}"
             title="${equipmentName}">
            <div class="equipment-info">
                <div class="model-name" 
                     style="font-size: ${fontSize};" 
                     title="${equipmentName}">${equipmentName}</div>
            </div>
        </div>`;
        });

        html += `
            </div>
        </div>
    </div>`;

        return html;
    }

    /**
    * הצגת כל הארונות
    */
    showAllRacks() {
        // יצירת מודל להצגת כל הארונות
        this.createAllRacksModal();
        // מילוי נתונים
        const container = document.getElementById('allRacksContainer');
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><span>טוען נתונים...</span></div>';
        document.getElementById('allRacksModal').style.display = 'flex';

        let racksToShow = {};

        if (this.currentDataCenter && this.racksData[this.currentDataCenter] &&
            Object.keys(this.racksData[this.currentDataCenter]).length > 0) {
            // יש חדר נוכחי עם נתונים - השתמש בו
            racksToShow = this.racksData[this.currentDataCenter];
        } else {
            // אין חדר נוכחי - אסוף מכל החדרים הזמינים
            for (const dcType in this.racksData) {
                if (this.racksData[dcType] && Object.keys(this.racksData[dcType]).length > 0) {
                    Object.assign(racksToShow, this.racksData[dcType]);
                }
            }
        }

        // יצירת כרטיסיות לכל הארונות בחדר השרתים הנוכחי
        const rackIds = Object.keys(racksToShow).sort();

        // בדיקה אם יש ארונות
        if (rackIds.length === 0) {
            container.innerHTML = '<div class="info-message">אין ארונות זמינים</div>';
            return;
        }

        // עדכון כותרת
        const titleEl = document.getElementById('allRacksTitle');
        if (titleEl) {
            if (this.currentDataCenter) {
                titleEl.textContent = this.currentDataCenter === 'PT' ? 'פ"ת' : 'ר"ג';
            } else {
                titleEl.textContent = 'כל החדרים';
            }
        }

        // --- חלוקה לקבוצות לפי שורה ---
        const groups = {};
        rackIds.forEach(rackId => {
            const groupKey = rackId.includes('-')
                ? rackId.split('-')[0] // ר"ג: "B1-2" → "B1"
                : rackId.charAt(0); // פ"ת: "A1" → "A"

            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(rackId);
        });

        // יצירת HTML לכל הארונות
        let html = '';

        Object.keys(groups).sort().forEach(groupKey => {
            const racksInGroup = groups[groupKey];

            // כותרת שורה
            html += `
            <div class="row-separator" style="
                width: 100%; 
                margin: 20px 0 10px 0; 
                font-weight: bold; 
                border-bottom: 1px solid #ccc;
                font-size: 1.1rem;
                color: #333;
            ">
                שורה ${groupKey}
            </div>
            <div class="all-racks-grid">`;

            racksInGroup.forEach(rackId => {
                const rackData = racksToShow[rackId] || [];
                html += `
                <div class="rack-container-wrapper">
                    ${this.generateRackHTML(rackId, rackData)}
                </div>`;
            });

            html += '</div>';
        });

        container.innerHTML = html;

        // הוספת מאזיני אירועים לפריטי ציוד
        const allEquipmentItems = container.querySelectorAll('.equipment-item');
        allEquipmentItems.forEach(item => {
            item.addEventListener('click', (event) => {
                // מניעת התפשטות האירוע לארון
                event.stopPropagation();
                // קבלת מזהה הציוד והארון
                const equipmentName = item.querySelector('.model-name').textContent;
                const rackId = item.closest('.rack-container-wrapper')
                    ?.querySelector('.rack-header')?.textContent;
                const startPosition = parseInt(
                    item.getAttribute('data-position') ||
                    item.classList.toString().match(/pos-(\d+)/)?.[1] || 0
                );

                if (rackId && equipmentName && startPosition > 0) {
                    this.showEquipmentConnectionsModal(equipmentName, rackId, startPosition);
                }
            });
        });
    }

    showGlobalLoader(text) {
        let loader = document.getElementById('print-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'print-loader';
            loader.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);
                        display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:white;font-family:Arial;">
                <div class="spinner" style="border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;width:40px;height:40px;animation:spin 1s linear infinite;"></div>
                <p id="loader-text" style="margin-top:15px;font-size:18px;">${text}</p>
                <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
            </div>`;
            document.body.appendChild(loader);
        } else {
            document.getElementById('loader-text').innerText = text;
        }
    }

    hideGlobalLoader() {
        const loader = document.getElementById('print-loader');
        if (loader) loader.remove();
    }

    /**
    * ייצוא נתוני הארונות לקובץ אקסל
    */
    exportToExcel() {
        if (!this.currentDataCenter || !this.racksData[this.currentDataCenter]) {
            this._notify('אין נתונים זמינים לייצוא', 'error');
            return;
        }

        this.showGlobalLoader('מכין קובץ אקסל...');

        // טעינת ספריית ExcelJS
        if (typeof ExcelJS === 'undefined') {
            // טען את שתי הספריות הנדרשות
            const script1 = document.createElement('script');
            script1.src = '/lib/xlsx/exceljs.min.js';

            const script2 = document.createElement('script');
            script2.src = '/lib/xlsx/FileSaver.min.js';

            script1.onload = () => {
                document.head.appendChild(script2);
            };

            script2.onload = () => {
                this.generateStyledExcelFile();
            };

            script1.onerror = script2.onerror = (error) => {
                console.error('Failed to load library:', error);
                this.hideGlobalLoader();
                this._notify('שגיאה בטעינת ספריות נדרשות', 'error');
            };

            document.head.appendChild(script1);
        } else {
            this.generateStyledExcelFile();
        }
    }

    /**
    * יצירת קובץ אקסל מעוצב בדומה למקור
    */
    async generateStyledExcelFile() {
        try {
            // יצירת חוברת עבודה חדשה
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'NOC Portal';
            workbook.lastModifiedBy = 'NOC Portal';
            workbook.created = new Date();
            workbook.modified = new Date();

            // הוספת גיליון עבודה
            const sheetName = this.currentDataCenter === 'PT' ? 'PT' : 'RMG A+B';
            const worksheet = workbook.addWorksheet(sheetName);

            // מיון הארונות לפי מזהה
            const rackIds = Object.keys(this.racksData[this.currentDataCenter]).sort();

            // קבוצות ארונות לפי מקדם
            const rackGroups = {};
            rackIds.forEach(rackId => {
                // חילוץ המקדם (בפתח תקווה - האות, ברמת גן - האות והמספר)
                const prefix = this.currentDataCenter === 'PT' ?
                    rackId.charAt(0) : // פתח תקווה: A, B, C...
                    rackId.split('-')[0]; // רמת גן: B1, B2...

                if (!rackGroups[prefix]) {
                    rackGroups[prefix] = [];
                }
                rackGroups[prefix].push(rackId);
            });

            // הכנת הנתונים
            const data = [];

            // שורת כותרת - מזהי ארונות
            const headerRow = []; // הסרת העמודה הראשונה הריקה

            // מעבר על הקבוצות בסדר אלפביתי
            const groupPrefixes = Object.keys(rackGroups).sort();

            groupPrefixes.forEach((prefix, groupIndex) => {
                const racksInGroup = rackGroups[prefix].sort();

                racksInGroup.forEach(rackId => {
                    headerRow.push(""); // עמודת U בצד ימין של כל ארון
                    headerRow.push(rackId);
                });

                // הוספת עמודת רווח בין קבוצות (אם זו לא הקבוצה האחרונה)
                if (groupIndex < groupPrefixes.length - 1) {
                    headerRow.push(""); // עמודת רווח ריקה
                }
            });

            data.push(headerRow);

            // יצירת מטריצה ריקה לכל המיקומים בכל הארונות
            const rackMatrix = {};
            rackIds.forEach(rackId => {
                rackMatrix[rackId] = {};
                for (let u = 1; u <= 42; u++) {
                    rackMatrix[rackId][u] = "";
                }
            });

            // מילוי המטריצה בנתוני הציוד
            rackIds.forEach(rackId => {
                // קבלת נתוני הציוד בארון
                const rackData = this.racksData[this.currentDataCenter][rackId] || [];

                // עבור על כל פריטי הציוד בארון
                rackData.forEach(item => {
                    const startPosition = item.startPosition || item.StartPosition || 0;
                    const equipment = item.equipment || item.Equipment || '';
                    const sizeUnits = item.size_units || item.SizeUnits || 1;

                    // מילוי כל היחידות שהציוד תופס
                    for (let i = 0; i < sizeUnits; i++) {
                        const position = startPosition - i;
                        if (position > 0 && position <= 42) {
                            // שמירת מידע על הציוד והגודל שלו לצורך מיזוג תאים מאוחר יותר
                            rackMatrix[rackId][position] = {
                                equipment: equipment,
                                isStart: i === 0,  // האם זו היחידה הראשונה של הציוד
                                size: sizeUnits     // גודל הציוד הכולל
                            };
                        }
                    }
                });
            });

            // יצירת שורות לכל מיקום (U)
            for (let u = 42; u >= 1; u--) {
                const row = [];

                groupPrefixes.forEach((prefix, groupIndex) => {
                    const racksInGroup = rackGroups[prefix].sort();

                    racksInGroup.forEach(rackId => {
                        // הוספת מספר U בצד ימין של כל ארון
                        row.push(u);

                        // הוספת הציוד במיקום הנוכחי
                        const cellData = rackMatrix[rackId][u];
                        if (cellData) {
                            row.push(cellData.equipment || "");
                        } else {
                            row.push("");
                        }
                    });

                    // הוספת עמודת רווח בין קבוצות (אם זו לא הקבוצה האחרונה)
                    if (groupIndex < groupPrefixes.length - 1) {
                        row.push(""); // עמודת רווח ריקה
                    }
                });

                data.push(row);
            }

            // הוספת הנתונים לגיליון
            worksheet.addRows(data);

            // הגדרת גובה קבוע לכל השורות (מלבד שורת הכותרת)
            const rowHeight = 15; // גובה קבוע בפיקסלים
            for (let i = 2; i <= data.length; i++) {
                worksheet.getRow(i).height = rowHeight;
            }

            // מיפוי סוגי העמודות
            const columnTypes = [];
            let colIndex = 1;

            groupPrefixes.forEach((prefix, groupIndex) => {
                const racksInGroup = rackGroups[prefix].sort();

                racksInGroup.forEach(rackId => {
                    columnTypes[colIndex++] = 'unitNumber'; // עמודת U בצד ימין
                    columnTypes[colIndex++] = 'rack'; // עמודת ארון
                });

                // עמודת רווח בין קבוצות
                if (groupIndex < groupPrefixes.length - 1) {
                    columnTypes[colIndex++] = 'spacer';
                }
            });

            // הגדרת רוחב עמודות לפי סוג העמודה
            for (let i = 1; i <= columnTypes.length; i++) {
                const columnType = columnTypes[i];

                if (columnType === 'unitNumber') {
                    worksheet.getColumn(i).width = 2.5; // עמודות מספרי יחידות
                } else if (columnType === 'rack') {
                    worksheet.getColumn(i).width = 20; // עמודות ארונות
                } else if (columnType === 'spacer') {
                    worksheet.getColumn(i).width = 10; // עמודות רווח
                }
            }

            // הגדרת סגנונות
            // סגנון כותרת עמודת U - לבן ללא תכלת
            const unitHeaderStyle = {
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFFF' }
                },
                font: {
                    bold: true,
                    size: 9,
                    color: { argb: 'FF666666' }
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'middle'
                },
                border: {
                    top: { style: 'none' },
                    left: { style: 'none' },
                    bottom: { style: 'none' },
                    right: { style: 'none' }
                }
            };

            // סגנון כותרת שם ארון - תכלת
            const rackHeaderStyle = {
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFBDD7EE' } // כחול בהיר
                },
                font: {
                    bold: true,
                    size: 11
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'middle'
                },
                border: {
                    top: { style: 'none' },
                    left: { style: 'none' },
                    bottom: { style: 'none' },
                    right: { style: 'none' }
                }
            };

            const unitNumberStyle = {
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFFF' } // לבן
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'middle'
                },
                font: {
                    size: 8
                },
                border: {
                    top: { style: 'none' },
                    left: { style: 'none' },
                    bottom: { style: 'none' },
                    right: { style: 'none' }
                }
            };

            const lightGrayStyle = {
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD9D9D9' } // אפור בהיר
                },
                alignment: {
                    horizontal: 'center',
                    vertical: 'middle',
                    wrapText: true
                },
                font: {
                    size: 9 // פונט קטן יותר לציודים
                },
                border: {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                }
            };

            const darkGrayStyle = {
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFA6A6A6' } // אפור כהה
                },
                // אין מסגרת לתאים ריקים
                border: {
                    top: { style: 'none' },
                    left: { style: 'none' },
                    bottom: { style: 'none' },
                    right: { style: 'none' }
                }
            };

            const spacerStyle = {
                fill: {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFFFF' } // לבן
                },
                border: {
                    top: { style: 'none' },
                    left: { style: 'none' },
                    bottom: { style: 'none' },
                    right: { style: 'none' }
                }
            };

            // עיצוב שורת כותרת
            worksheet.getRow(1).eachCell((cell, colNumber) => {
                if (columnTypes[colNumber] === 'spacer') {
                    cell.style = spacerStyle;
                } else if (columnTypes[colNumber] === 'unitNumber') {
                    cell.style = unitHeaderStyle;
                } else if (columnTypes[colNumber] === 'rack') {
                    cell.style = rackHeaderStyle;
                }
            });

            // עיצוב תאי הנתונים
            // חישוב מיפוי: לכל עמודת rack - מה השורה הראשונה והאחרונה שלה בטבלה
            // שורה 1 = כותרת, שורות 2...(data.length) = נתונים (U42 עד U1)
            const firstDataRow = 2;
            const lastDataRow = data.length; // שורה אחרונה = U1

            // עיצוב תאי הנתונים
            for (let row = 2; row <= data.length; row++) {
                for (let col = 1; col <= columnTypes.length; col++) {
                    const columnType = columnTypes[col];
                    const cell = worksheet.getCell(row, col);

                    if (columnType === 'unitNumber') {
                        // עמודות מספרי יחידות
                        cell.style = unitNumberStyle;

                    } else if (columnType === 'spacer') {
                        // עמודות רווח
                        cell.style = spacerStyle;
                        // מחיקת הערך בעמודת הרווח (למקרה שנשאר שם משהו)
                        cell.value = "";
                    } else if (columnType === 'rack') {
                        // --- עיצוג בסיסי ---
                        const isEmpty = !cell.value;

                        if (!isEmpty) {
                            cell.style = JSON.parse(JSON.stringify(lightGrayStyle)); // clone
                            const textLength = cell.value.toString().length;
                            if (textLength > 30) {
                                cell.font = { size: 7, ...lightGrayStyle.font };
                            } else if (textLength > 20) {
                                cell.font = { size: 8, ...lightGrayStyle.font };
                            } else {
                                cell.font = { size: 9, ...lightGrayStyle.font };
                            }
                        } else {
                            cell.style = JSON.parse(JSON.stringify(darkGrayStyle)); // clone
                        }

                        // --- מסגרת עבה לארון + מסגרת דקה פנימית בין ציודים ---
                        const isFirstRow = (row === firstDataRow);
                        const isLastRow = (row === lastDataRow);

                        const thickSide = { style: 'medium', color: { argb: 'FF000000' } };
                        const thinLine = { style: 'thin', color: { argb: 'FF000000' } };
                        const noLine = { style: 'none' };

                        cell.border = {
                            left: thickSide,
                            right: thickSide,
                            // אם תא ריק - בלי קו דק, רק עבה בקצוות
                            top: isFirstRow ? thickSide : (isEmpty ? noLine : thinLine),
                            bottom: isLastRow ? thickSide : (isEmpty ? noLine : thinLine),
                        };
                    }
                }
            }

            // מיזוג תאים עבור ציוד שתופס מספר יחידות
            colIndex = 1;
            groupPrefixes.forEach((prefix, groupIndex) => {
                const racksInGroup = rackGroups[prefix].sort();

                racksInGroup.forEach(rackId => {
                    colIndex++; // דילוג על עמודת מספרי U

                    // עבור על כל המיקומים בארון
                    for (let u = 42; u >= 1; u--) {
                        const rowIndex = 43 - u + 1; // המרה ממיקום U לאינדקס שורה (שורה 1 היא כותרת)
                        const cellData = rackMatrix[rackId][u];

                        // אם זו היחידה הראשונה של ציוד שתופס יותר מיחידה אחת
                        if (cellData && cellData.isStart && cellData.size > 1) {
                            // מיזוג התאים מלמעלה למטה
                            worksheet.mergeCells(rowIndex, colIndex, rowIndex + cellData.size - 1, colIndex);

                            // הגדרת יישור אנכי למרכז עבור התא הממוזג
                            const cell = worksheet.getCell(rowIndex, colIndex);
                            if (cell.style) {
                                cell.style.alignment = {
                                    vertical: 'middle',
                                    horizontal: 'center',
                                    wrapText: true
                                };
                            }
                        }
                    }

                    colIndex++; // מעבר לעמודה הבאה
                });

                // דילוג על עמודת רווח בין קבוצות
                if (groupIndex < groupPrefixes.length - 1) {
                    colIndex++;
                }
            });

            // שמירת הקובץ
            const fileName = `תיעוד ציודים בחדר שרתים - ${this.currentDataCenter === 'PT' ? 'פתח תקווה' : 'רמת גן'}.xlsx`;

            // המרה לבלוב והורדה
            const buffer = await workbook.xlsx.writeBuffer();
            saveAs(new Blob([buffer]), fileName);

            this.hideGlobalLoader();
            this._notify('קובץ אקסל נוצר בהצלחה', 'success');
        } catch (error) {
            console.error('Error generating Excel file:', error);
            this.hideGlobalLoader();
            this._notify('שגיאה ביצירת קובץ אקסל', 'error');
        }
    }

    /**
     * הכנת נתונים לפורמט אקסל המקורי
     * @returns {Array} - מערך דו-ממדי של נתונים
     */
    prepareExcelDataInOriginalFormat() {
        // מיון הארונות לפי מזהה
        const rackIds = Object.keys(this.racksData[this.currentDataCenter]).sort();

        // יצירת מערך דו-ממדי לנתונים
        const data = [];

        // שורת כותרות - שם הגיליון
        const headerRow1 = [this.currentDataCenter];
        for (let i = 1; i < rackIds.length * 2; i++) {
            headerRow1.push("");
        }
        data.push(headerRow1);

        // שורת כותרות - מזהי ארונות
        const headerRow2 = [""];
        rackIds.forEach((rackId, index) => {
            headerRow2.push(rackId);
            headerRow2.push("");
        });
        data.push(headerRow2);

        // יצירת מיפוי של הציוד לפי מיקום בכל ארון
        const rackEquipmentMap = {};
        rackIds.forEach(rackId => {
            rackEquipmentMap[rackId] = {};

            const rackData = this.racksData[this.currentDataCenter][rackId] || [];
            rackData.forEach(item => {
                const position = item.startPosition || item.StartPosition || 0;
                const equipment = item.equipment || item.Equipment || '';
                const size = item.size_units || item.SizeUnits || 1;

                // שמירת הציוד במיקום המתאים
                for (let i = 0; i < size; i++) {
                    const currentPosition = position - i;
                    if (currentPosition > 0) {
                        rackEquipmentMap[rackId][currentPosition] = equipment;
                    }
                }
            });
        });

        // יצירת שורות לכל מיקום (U)
        for (let u = 42; u >= 1; u--) {
            const row = [u];

            rackIds.forEach(rackId => {
                // הוספת הציוד במיקום הנוכחי
                row.push(rackEquipmentMap[rackId][u] || "");
                // הוספת עמודת רווח ריקה
                row.push("");
            });

            data.push(row);
        }

        return data;
    }

    /**
     * יצירת קובץ אקסל מנתוני הארונות
     */
    generateExcelFile() {
        try {
            // הכנת הנתונים לפורמט אקסל
            const workbook = XLSX.utils.book_new();

            // יצירת גיליון נתונים
            const sheetName = this.currentDataCenter === 'PT' ? 'פתח תקווה' : 'רמת גן';

            // הכנת מערך הנתונים
            const data = this.prepareExcelData();

            // יצירת גיליון עבודה
            const worksheet = XLSX.utils.aoa_to_sheet(data);

            // הוספת הגיליון לחוברת העבודה
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

            // הגדרת רוחב עמודות
            const columnWidths = [
                { wch: 10 }, // מספר יחידה
                { wch: 40 }, // שם ציוד
                { wch: 15 }, // סוג ציוד
                { wch: 10 }, // גודל
                { wch: 15 }  // מזהה ארון
            ];
            worksheet['!cols'] = columnWidths;

            // שמירת הקובץ
            const fileName = `DataCenter_${this.currentDataCenter}_${new Date().toISOString().split('T')[0]}.xlsx`;
            XLSX.writeFile(workbook, fileName);

            this.hideGlobalLoader();
            this._notify('קובץ אקסל נוצר בהצלחה', 'success');
        } catch (error) {
            this.hideGlobalLoader();
            console.error('Error generating Excel file:', error);
            this._notify('שגיאה ביצירת קובץ אקסל', 'error');
        }
    }

    /**
     * הכנת נתונים לפורמט אקסל
     * @returns {Array} - מערך דו-ממדי של נתונים
     */
    prepareExcelData() {
        // יצירת כותרות
        const headers = ['מספר יחידה', 'שם ציוד', 'סוג ציוד', 'גודל (U)', 'מזהה ארון'];
        const data = [headers];

        // מיון הארונות לפי מזהה
        const rackIds = Object.keys(this.racksData[this.currentDataCenter]).sort();

        // עבור על כל הארונות
        rackIds.forEach(rackId => {
            const rackData = this.racksData[this.currentDataCenter][rackId] || [];

            // מיון הציוד לפי מיקום (מלמעלה למטה)
            const sortedEquipment = [...rackData].sort((a, b) => {
                const posA = a.startPosition || a.StartPosition || 0;
                const posB = b.startPosition || b.StartPosition || 0;
                return posB - posA; // מיון יורד
            });

            // הוספת שורות לכל פריט ציוד
            sortedEquipment.forEach(item => {
                const position = item.startPosition || item.StartPosition || 0;
                const equipment = item.equipment || item.Equipment || '';
                const type = this.getEquipmentTypeName(item.type || item.Type || 'other');
                const size = item.size_units || item.SizeUnits || 1;

                data.push([position, equipment, type, size, rackId]);
            });
        });

        return data;
    }

    /**
     * טעינת ספריית html2canvas אם לא נטענה
     * @returns {Promise<void>}
     */
    async loadHtml2CanvasIfNeeded() {
        if (typeof html2canvas !== 'undefined') {
            return Promise.resolve(); // הספרייה כבר נטענה
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load html2canvas'));
            document.head.appendChild(script);
        });
    }

    /**
    * הדפסת כל הארונות בחדר השרתים הנוכחי
    */
    async printAllRacks() {
        const container = document.getElementById('allRacksContainer');
        if (!container) return;
        // שליפת כל הדיבים של הארונות הבודדים בתוך הגריד
        const rackElements = Array.from(container.querySelectorAll('.rack-container'));
        if (rackElements.length === 0) return;
        this.showGlobalLoader(`מכין דפי הדפסה (0/${Math.ceil(rackElements.length / 7)})...`);

        try {
            const pageImages = [];

            // מעבר על הארונות בקבוצות של 7
            for (let i = 0; i < rackElements.length; i += 7) {
                const chunkIndex = Math.floor(i / 7) + 1;
                this.showGlobalLoader(`מכין דף ${chunkIndex}...`);

                // יצירת קונטיינר זמני בלתי נראה לצילום הקבוצה הנוכחית
                const tempWrapper = document.createElement('div');
                tempWrapper.style.display = 'grid';
                tempWrapper.style.gridTemplateColumns = 'repeat(7, 1fr)';
                tempWrapper.style.gap = '10px';
                tempWrapper.style.width = '1600px'; // רוחב נדיב לצילום איכותי
                tempWrapper.style.height = '1100px'; // כופה גובה של דף לרוחב
                tempWrapper.style.position = 'absolute';
                tempWrapper.style.left = '-9999px';
                tempWrapper.style.backgroundColor = 'white';
                document.body.appendChild(tempWrapper);
                const currentRacks = rackElements.slice(i, i + 7);
                currentRacks.forEach(rack => {
                    const clone = rack.cloneNode(true);
                    // פקודת הקסם: ביטול הגבלות גובה ומתיחה למקסימום
                    clone.style.height = '100% !important';
                    clone.style.minHeight = '1000px';
                    clone.style.display = 'flex';
                    clone.style.flexDirection = 'column';

                    // מוודא שהחלק הפנימי של הארון (היחידות) נמתח גם הוא
                    const rackUnits = clone.querySelector('.rack-units');
                    if (rackUnits) rackUnits.style.flexGrow = '1';

                    tempWrapper.appendChild(clone);
                });
                // צילום הקבוצה
                const canvas = await html2canvas(tempWrapper, {
                    scale: 1.5,
                    useCORS: true,
                    backgroundColor: '#ffffff'
                });

                pageImages.push(canvas.toDataURL('image/jpeg', 0.9));
                document.body.removeChild(tempWrapper);
            }
            // יצירת תוכן ההדפסה עם תמונה לכל דף
            const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @page { size: A4 landscape; margin: 0.5cm; }
                body { margin: 0; padding: 0; background: white; }
                .print-page {
                    width: 100%;
                    height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    page-break-after: always;
                }
                img {
                    max-width: 100%;
                    max-height: 100%;
                    object-fit: contain;
                }
            </style>
        </head>
        <body>
            ${pageImages.map(img => `<div class="print-page"><img src="${img}"></div>`).join('')}
            <script>
                window.onload = () => {
                    window.print();
                    setTimeout(() => window.close(), 500);
                };
            </script>
        </body>
        </html>`;
            const printWindow = window.open('', '_blank');
            printWindow.document.write(printContent);
            printWindow.document.close();
        } catch (error) {
            console.error('Print error:', error);
            this._notify('שגיאה בתהליך ההדפסה', 'error');
        } finally {
            this.hideGlobalLoader();
        }
    }



    /**
     * קבלת סגנונות CSS להדפסה
     */
    getPrintStyles() {
        return `
        .equipment-item {
            position: relative;
            border: 1px solid #ccc;
            margin-bottom: 2px;
            padding: 5px;
            background-color: #f9f9f9;
            border-radius: 3px;
            overflow: hidden;
        }
        .equipment-info {
            display: flex;
            flex-direction: column;
            justify-content: center;
            height: 100%;
        }
        .model-name {
            text-align: center;
            font-weight: bold;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .type-server {
            background-color: #d4edda;
            border-color: #c3e6cb;
        }
        .type-switch {
            background-color: #cce5ff;
            border-color: #b8daff;
        }
        .type-storage {
            background-color: #fff3cd;
            border-color: #ffeeba;
        }
        .pos-1 { height: 20px; }
        .pos-2 { height: 20px; }
        .pos-3 { height: 20px; }
        .pos-4 { height: 20px; }
        .pos-5 { height: 20px; }
        .size-1 { height: 20px; }
        .size-2 { height: 40px; }
        .size-3 { height: 60px; }
        .size-4 { height: 80px; }
        .size-5 { height: 100px; }
        .size-6 { height: 120px; }
        .size-7 { height: 140px; }
        .size-8 { height: 160px; }
        .size-9 { height: 180px; }
        .size-10 { height: 200px; }
    `;
    }

    /**
     * סגירת מודל כל הארונות
     */
    closeAllRacksModal() {
        document.getElementById('allRacksModal').style.display = 'none';
        document.getElementById('allRacksModal').remove();
    }

    /**
    * יצירת HTML לסיכום הציוד בארון
    * @param {Array} rackData - נתוני הארון
    * @returns {string} - קוד HTML
    */
    generateRackSummaryHTML(rackData) {
        // ספירת סוגי ציוד
        const typeCounts = {
            server: 0,
            switch: 0,
            storage: 0,
            other: 0
        };

        rackData.forEach(item => {
            const type = item.type || 'other';
            if (typeCounts.hasOwnProperty(type)) {
                typeCounts[type]++;
            } else {
                typeCounts.other++;
            }
        });

        return `
        <li><i class="fas fa-server"></i> שרתים: ${typeCounts.server}</li>
        <li><i class="fas fa-network-wired"></i> מתגים: ${typeCounts.switch}</li>
        <li><i class="fas fa-database"></i> אחסון: ${typeCounts.storage}</li>
        <li><i class="fas fa-cube"></i> אחר: ${typeCounts.other}</li>
        <li><i class="fas fa-hdd"></i> סה"כ פריטים: ${rackData.length}</li>
    `;
    }

    /**
    * קבלת שם סוג הציוד בעברית
    * @param {string} type - סוג הציוד
    * @returns {string} - שם בעברית
    */
    getEquipmentTypeName(type) {
        switch (type) {
            case 'server': return 'שרת';
            case 'switch': return 'מתג';
            case 'storage': return 'אחסון';
            default: return 'אחר';
        }
    }

    /**
    * ייצוא נתוני ארון להדפסה באמצעות צילום מסך
    */
    exportRackData() {
        if (!this.currentRack) {
            alert('אין נתונים לייצוא');
            return;
        }

        try {
            // מצא את אלמנט הפופאפ של הארון
            const rackContainer = document.querySelector('.rack-container');
            if (!rackContainer) {
                throw new Error('לא נמצא אלמנט הארון');
            }

            // שימוש בספריית html2canvas לצילום מסך של הארון
            // נטען את הספרייה דינמית אם היא לא קיימת
            if (typeof html2canvas === 'undefined') {
                // הודעה למשתמש
                this._notify('טוען ספריית צילום מסך...', 'info');

                // טעינת הספרייה
                const script = document.createElement('script');
                script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
                script.onload = () => {
                    // לאחר טעינת הספרייה, המשך בתהליך
                    this.captureAndPrintRack(rackContainer);
                };
                script.onerror = () => {
                    this._notify('שגיאה בטעינת ספריית צילום מסך', 'error');
                };
                document.head.appendChild(script);
            } else {
                // אם הספרייה כבר טעונה, המשך ישירות
                this.captureAndPrintRack(rackContainer);
            }
        } catch (error) {
            console.error('Error exporting rack data:', error);
            this._notify('שגיאה בייצוא נתוני הארון', 'error');
        }
    }

    /**
    * הוספת ציוד חדש לארון
    * @param {string} rackId - מזהה הארון
    * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
    * @param {number} startPosition - מיקום התחלתי (U)
    * @param {number} sizeUnits - גודל הציוד ביחידות U
    * @param {string} equipment - שם הציוד
    */
    async addEquipment(rackId, dataCenterType, startPosition, sizeUnits, equipment) {
        try {
            // בדיקה מקדימה אם ה-U תפוס
            const checkResponse = await fetch(`/DataCenter/CheckUPositionsAvailability?rackId=${rackId}&dataCenterType=${dataCenterType}&startPosition=${startPosition}&sizeUnits=${sizeUnits}`);
            const checkData = await checkResponse.json();

            if (!checkData.isAvailable) {
                const topPos = startPosition + sizeUnits - 1;
                this._notify(`שגיאה: מיקום U${startPosition}–U${topPos} כבר תפוס`, 'error');
                return { success: false, error: 'המיקום כבר תפוס' };
            }

            const response = await fetch('/DataCenter/AddEquipment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    rackId,
                    dataCenterType,
                    startPosition,
                    sizeUnits,
                    equipment
                })
            });

            const data = await response.json();

            if (data.success) {
                this._notify('הציוד נוסף בהצלחה', 'success');

                // עדכון נתוני הארון בזיכרון המקומי
                if (!this.racksData[dataCenterType][rackId]) {
                    this.racksData[dataCenterType][rackId] = [];
                }

                // הוספת הציוד החדש לנתונים המקומיים
                this.racksData[dataCenterType][rackId].push({
                    startPosition: startPosition,
                    size_units: sizeUnits,
                    equipment: equipment,
                    type: data.equipment?.type || 'other'
                });

                // רענון תצוגת הארון
                await this.showRackDetails(rackId);
            } else {
                this._notify(`שגיאה בהוספת ציוד: ${data.error}`, 'error');
            }

            return data;
        } catch (error) {
            console.error('Error adding equipment:', error);
            this._notify('שגיאה בהוספת ציוד', 'error');
            throw error;
        }
    }

    /**
     * עריכת ציוד קיים בארון
     * @param {Object} params - פרמטרים לעריכה
     */
    async editEquipment(params) {
        try {
            const response = await fetch('/DataCenter/EditEquipment', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });

            const data = await response.json();

            if (data.success) {
                this._notify(
                    data.message || 'הציוד עודכן בהצלחה', 'success');

                const targetRackId = params.newRackId || params.rackId;
                const isMoving = !!(params.newRackId &&
                    params.newRackId !== params.rackId);

                if (this.racksData[params.dataCenterType]) {

                    // --- הסרה מהארון המקורי ---
                    const sourceArr =
                        this.racksData[params.dataCenterType][params.rackId];
                    if (sourceArr) {
                        const idx = sourceArr.findIndex(item => {
                            const pos = item.startPosition ||
                                item.StartPosition || 0;
                            const nm = item.equipment ||
                                item.Equipment || '';
                            return pos === params.originalStartPosition &&
                                nm.toLowerCase() ===
                                params.originalEquipment.toLowerCase();
                        });
                        if (idx !== -1) sourceArr.splice(idx, 1);
                    }

                    // --- הוספה לארון היעד ---
                    if (!this.racksData[params.dataCenterType][targetRackId]) {
                        this.racksData[params.dataCenterType][targetRackId] = [];
                    }
                    this.racksData[params.dataCenterType][targetRackId].push({
                        startPosition: params.newStartPosition,
                        size_units: params.newSizeUnits,
                        equipment: params.newEquipment,
                        type: this.determineEquipmentType(params.newEquipment)
                    });
                }

                // סגירת פופאפ תצוגה מקדימה אם פתוח
                const preview = document.getElementById('rackPreviewPopup');
                if (preview) preview.remove();

                // רענון תצוגה
                if (isMoving) {
                    // הצג את הארון החדש
                    await this.showRackDetails(targetRackId);
                } else {
                    await this.showRackDetails(params.rackId);
                }

            } else {
                this._notify(
                    `שגיאה בעדכון ציוד: ${data.error}`, 'error');
            }

            return data;
        } catch (error) {
            console.error('Error editing equipment:', error);
            this._notify('שגיאה בעדכון ציוד', 'error');
            throw error;
        }
    }

    // פונקציה עזר לקביעת סוג הציוד
    determineEquipmentType(equipment) {
        if (!equipment) return "other";

        equipment = equipment.toLowerCase();

        if (equipment.includes("server") || equipment.includes("שרת") ||
            equipment.includes("cl-") || equipment.includes("power") ||
            equipment.includes("dell") || equipment.includes("hp ") ||
            equipment.includes("ucs") || equipment.includes("apollo")) {
            return "server";
        }
        else if (equipment.includes("switch") || equipment.includes("מתג") ||
            equipment.includes("cisco") || equipment.includes("sw") ||
            equipment.includes("arista") || equipment.includes("nexus") ||
            equipment.includes("network") || equipment.includes("ilo sw")) {
            return "switch";
        }
        else if (equipment.includes("storage") || equipment.includes("אחסון") ||
            equipment.includes("ds") || equipment.includes("emc") ||
            equipment.includes("infinibox") || equipment.includes("isilon") ||
            equipment.includes("san") || equipment.includes("tape")) {
            return "storage";
        }
        else {
            return "other";
        }
    }

    /**
     * הסרת ציוד מארון
     * @param {string} rackId - מזהה הארון
     * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
     * @param {number} startPosition - מיקום התחלתי (U)
     * @param {string} equipment - שם הציוד
     */
    async removeEquipment(rackId, dataCenterType, startPosition, equipment) {
        try {
            const response = await fetch('/DataCenter/RemoveEquipment', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    rackId,
                    dataCenterType,
                    startPosition,
                    equipment
                })
            });

            const data = await response.json();

            if (data.success) {
                this._notify('הציוד הוסר בהצלחה', 'success');

                // עדכון נתוני הארון בזיכרון המקומי
                if (this.racksData[dataCenterType] && this.racksData[dataCenterType][rackId]) {
                    const rackData = this.racksData[dataCenterType][rackId];

                    // מחיקת הציוד
                    const indexToRemove = rackData.findIndex(item => {
                        const itemPosition = item.startPosition || item.StartPosition;
                        const itemEquipment = item.equipment || item.Equipment;

                        return itemPosition === startPosition &&
                            itemEquipment === equipment;
                    });

                    if (indexToRemove !== -1) {
                        rackData.splice(indexToRemove, 1);
                    }

                    if (this.currentRack && this.currentRack.id === rackId) {
                        this.currentRack.data = rackData;
                    }
                }

                // רענון תצוגת הארון
                await this.showRackDetails(rackId);
            } else {
                this._notify(`שגיאה בהסרת ציוד: ${data.error}`, 'error');
            }

            return data;
        } catch (error) {
            console.error('Error removing equipment:', error);
            this._notify('שגיאה בהסרת ציוד', 'error');
            throw error;
        }
    }

    /**
     * הצגת מודל להוספת/עריכת ציוד
     * @param {string} mode - 'add' או 'edit'
     * @param {Object} equipmentData - נתוני הציוד לעריכה (אופציונלי)
     */
    showEquipmentEditModal(mode, equipmentData = null) {
        this.createEquipmentEditModal();

        const modal = document.getElementById('equipmentEditModal');
        const title = document.getElementById('equipmentEditTitle');
        const form = document.getElementById('equipmentEditForm');

        form.reset();

        // ניקוי שדות נסתרים
        document.getElementById('originalStartPosition').value = '';
        document.getElementById('originalEquipment').value = '';
        document.getElementById('equipmentRackId').value =
            this.currentRack?.id || '';
        document.getElementById('equipmentDataCenterTypeInternal').value =
            this.currentDataCenter || '';

        if (mode === 'add') {
            title.textContent = 'הוספת ציוד חדש';
            document.getElementById('equipmentEditSubmitBtn').textContent =
                'הוסף ציוד';

            const newRackGroup = document.getElementById('newRackIdGroup');
            if (newRackGroup) newRackGroup.style.display = 'none';

            // שדה תצוגה בלבד - שם ידידותי
            document.getElementById('equipmentDataCenterType').value =
                this.getDataCenterDisplayName(this.currentDataCenter, this.currentRack?.id);
            document.getElementById('equipmentDataCenterType').readOnly = true;
            document.getElementById('equipmentDataCenterType')
                .classList.add('readonly-field');
            document.getElementById('equipmentStartPosition').value = '';
            document.getElementById('equipmentSizeUnits').value = '1';
            document.getElementById('equipmentName').value = '';

        } else if (mode === 'edit' && equipmentData) {
            title.textContent = 'עריכת ציוד';
            document.getElementById('equipmentEditSubmitBtn').textContent =
                'שמור שינויים';

            // שדה תצוגה בלבד - שם ידידותי
            document.getElementById('equipmentDataCenterType').value =
                this.getDataCenterDisplayName(this.currentDataCenter, this.currentRack?.id);
            document.getElementById('equipmentDataCenterType').readOnly = true;
            document.getElementById('equipmentDataCenterType')
                .classList.add('readonly-field');

            // מילוי שדות עריכים
            document.getElementById('equipmentStartPosition').value =
                equipmentData.startPosition;
            document.getElementById('equipmentSizeUnits').value =
                equipmentData.size_units;
            document.getElementById('equipmentName').value =
                equipmentData.equipment;

            // שמירת ערכים מקוריים בשדות נסתרים
            document.getElementById('originalStartPosition').value =
                equipmentData.startPosition;
            document.getElementById('originalEquipment').value =
                equipmentData.equipment;

            // הצג ארון יעד בעריכה
            const newRackGroup = document.getElementById('newRackIdGroup');
            if (newRackGroup) {
                newRackGroup.style.display = 'block';
                this.populateRackSelector();
            }
        }

        modal.style.display = 'flex';
    }

    /**
 * קבלת שם תצוגה של חדר השרתים לפי סוג וארון
 * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
 * @param {string} rackId - מזהה הארון (אופציונלי)
 * @returns {string} - שם תצוגה
 */
    getDataCenterDisplayName(dataCenterType, rackId = '') {
        if (dataCenterType === 'PT') {
            return 'פתח תקווה';
        }

        if (dataCenterType === 'RG') {
            // זיהוי החדר לפי מזהה הארון
            // ארונות שמתחילים ב-A שייכים לחדר A - STORAGE
            // ארונות שמתחילים ב-B שייכים לחדר ראשי - B
            if (rackId) {
                const prefix = rackId.charAt(0).toUpperCase();
                if (prefix === 'A') {
                    return 'RG - חדר A - STORAGE';
                } else if (prefix === 'B') {
                    return 'RG - חדר ראשי - B';
                }
            }
            // ברירת מחדל אם אין מזהה ארון
            return 'רמת גן';
        }

        return dataCenterType;
    }

    populateRackSelector() {
        const select = document.getElementById('newRackIdSelect');
        if (!select || !this.currentDataCenter) return;

        const currentRackId = this.currentRack?.id || '';
        const racksData = this.racksData[this.currentDataCenter] || {};
        const rackIds = Object.keys(racksData).sort();

        select.innerHTML = '';

        // אפשרות ראשונה - אותו ארון
        const defaultOption = document.createElement('option');
        defaultOption.value = currentRackId;
        defaultOption.textContent = `${currentRackId} (ארון נוכחי)`;
        defaultOption.selected = true;
        select.appendChild(defaultOption);

        // שאר הארונות
        rackIds.forEach(rackId => {
            if (rackId === currentRackId) return;
            const option = document.createElement('option');
            option.value = rackId;
            option.textContent = rackId;
            select.appendChild(option);
        });

        // ← הוסף מאזין לשינוי - הצג פופאפ
        // הסרת מאזין קודם למניעת כפילויות
        select.removeEventListener('change', select._previewHandler);
        select._previewHandler = (e) => {
            const selectedRackId = e.target.value;
            if (selectedRackId && selectedRackId !== currentRackId) {
                this.showRackPreviewPopup(selectedRackId);
            } else {
                // סגור פופאפ אם חזרו לארון הנוכחי
                const popup = document.getElementById('rackPreviewPopup');
                if (popup) popup.remove();
            }
            // בדיקת זמינות מיקום בארון החדש
            this.checkPositionAvailability();
        };
        select.addEventListener('change', select._previewHandler);
    }

    /**
     * יצירת מודל להוספת/עריכת ציוד
     */
    createEquipmentEditModal() {
        if (document.getElementById('equipmentEditModal')) return;

        const modalHTML = `
    <div id="equipmentEditModal" class="modal-overlay">
        <div class="modal-content equipment-edit-modal">
            <div class="modal-header">
                <h3 id="equipmentEditTitle">הוספת/עריכת ציוד</h3>
                <button class="modal-close" 
                    onclick="dataCenterManager.closeEquipmentEditModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <form id="equipmentEditForm">
                    <div class="form-group">
                        <label for="equipmentName">שם הציוד</label>
                        <input type="text" id="equipmentName"
                            class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="equipmentDataCenterType">חדר/אתר</label>
                        <input type="text" id="equipmentDataCenterType" 
                            class="form-input" readonly>
                    </div>

                   <div class="form-group">
                        <label for="equipmentStartPosition">
                            מיקום התחלתי (U)
                            <span class="tooltip-wrapper">
                                <i class="fas fa-info-circle tooltip-icon"></i>
                                <span class="tooltip-text">
                                    מיקום הציוד נספר <strong>מלמטה למעלה</strong>
                                </span>
                            </span>
                        </label>
                        <input type="number" id="equipmentStartPosition"
                            class="form-input" min="1" max="42" required>
                        <div id="positionErrorMessage"
                            class="position-error-message"></div>
                    </div>
                    <div class="form-group">
                        <label for="equipmentSizeUnits">גודל (יחידות U)</label>
                        <input type="number" id="equipmentSizeUnits" 
                            class="form-input" min="1" max="42" 
                            value="1" required>
                    </div>
                    <div id="newRackIdGroup" class="form-group" style="display:none;">
                        <label for="newRackIdSelect">
                            <i class="fas fa-exchange-alt"
                                style="color:#667eea;margin-left:6px;"></i>
                            העבר לארון
                        </label>
                        <select id="newRackIdSelect" class="form-input">
                        </select>
                        <small style="color:#666;margin-top:4px;display:block;">
                            <i class="fas fa-info-circle"></i>
                            בחר ארון אחר להעברת הציוד
                        </small>
                    </div>

                    <!-- שדות נסתרים לשמירת הערכים המקוריים -->
                    <input type="hidden" id="originalStartPosition">
                    <input type="hidden" id="originalEquipment">
                    <input type="hidden" id="equipmentRackId">
                    <input type="hidden" id="equipmentDataCenterTypeInternal">
                </form>
            </div>
            <div class="modal-footer">
                <button id="equipmentEditSubmitBtn" class="btn-primary" 
                    onclick="dataCenterManager.submitEquipmentEdit()">
                    הוסף ציוד
                </button>
                <button class="btn-secondary" 
                    onclick="dataCenterManager.closeEquipmentEditModal()">
                    ביטול
                </button>
            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // מאזיני אירועים לבדיקת זמינות מיקום
        const startPositionInput = document.getElementById('equipmentStartPosition');
        const sizeUnitsInput = document.getElementById('equipmentSizeUnits');

        if (startPositionInput) {
            startPositionInput.addEventListener('change',
                () => this.checkPositionAvailability());
            startPositionInput.addEventListener('input',
                () => this.checkPositionAvailability());
        }
        if (sizeUnitsInput) {
            sizeUnitsInput.addEventListener('change',
                () => this.checkPositionAvailability());
            sizeUnitsInput.addEventListener('input',
                () => this.checkPositionAvailability());
        }

        const newRackSelect = document.getElementById('newRackIdSelect');
        if (newRackSelect) {
            newRackSelect.addEventListener('change',
                () => this.checkPositionAvailability());
        }
    }

    /**
 * הצגת תצוגה מקדימה של ארון יעד בפופאפ קטן
 * @param {string} rackId - מזהה הארון
 */
    showRackPreviewPopup(rackId) {
        // הסרת פופאפ קודם אם קיים
        const existingPopup = document.getElementById('rackPreviewPopup');
        if (existingPopup) existingPopup.remove();

        if (!rackId || !this.currentDataCenter) return;

        const rackData = this.racksData[this.currentDataCenter]?.[rackId] || [];

        // ***  קריאה נכונה של שמות השדות (PascalCase מהשרת) ***
        const uMap = {};
        for (let u = 1; u <= 42; u++) uMap[u] = null;

        rackData.forEach(item => {
            // *** תיקון: תמיכה בשני פורמטים של שמות שדות ***
            const start = item.StartPosition || item.startPosition || 0;
            const size = item.SizeUnits || item.size_units || 1;
            const name = item.Equipment || item.equipment || '';
            const type = item.Type || item.type || 'other';

            if (start <= 0 || size <= 0) return;

            for (let u = start + size - 1; u >= start && u >= 1; u--) {
                uMap[u] = {
                    name,
                    type,
                    size,
                    // *** תיקון: isTop = U העליון של הציוד (start + size - 1) ***
                    isTop: u === (start + size - 1)
                };
            }
        });

        // גובה שורה בסיסי לכל U
        const ROW_H = 18;
        // בניית שורות הארון מ-U42 עד U1
        // כל ציוד מקבל בלוק אחד בגובה size*ROW_H
        // כל U פנוי מקבל שורה בגובה ROW_H
        let rackRowsHTML = '';
        let u = 42;

        while (u >= 1) {
            const cell = uMap[u];

            if (cell && cell.isTop) {
                // ─── ראש הציוד: בלוק אחד בגובה כל היחידות ───
                const blockH = cell.size * ROW_H;
                // *** חישוב נכון של U תחתון ***
                const uBottom = u - cell.size + 1;

                // ─── תיקון תווית U ───
                // 1U  → מציג רק "U1" בצד שמאל (ללא חץ)
                // 2U  → מציג טווח "U_top / U_bottom" ללא חץ ↕
                // 3U+ → מציג טווח עם חץ ↕ באמצע

                let uLabelHTML;
                if (cell.size === 1) {
                    uLabelHTML = `
                    <div style="
                        font-size:9px;
                        color:#004085;
                        font-weight:bold;
                        min-width:22px;
                        text-align:center;
                        flex-shrink:0;">
                        U${u}
                    </div>`;
                } else if (cell.size === 2) {
                    // ─── 2U: טווח ללא חץ ↕ ───
                    uLabelHTML = `
                    <div style="
                        display:flex;
                        flex-direction:column;
                        align-items:center;
                        justify-content:space-between;
                        font-size:9px;
                        color:#004085;
                        font-weight:bold;
                        min-width:22px;
                        height:100%;
                        flex-shrink:0;
                        padding: 2px 0;">
                        <span>U${u}</span>
                        <span>U${uBottom}</span>
                    </div>`;
                } else {
                    // ─── 3U+: טווח עם חץ ↕ באמצע ───
                    uLabelHTML = `
                    <div style="
                        display:flex;
                        flex-direction:column;
                        align-items:center;
                        justify-content:space-between;
                        font-size:9px;
                        color:#004085;
                        font-weight:bold;
                        min-width:22px;
                        height:100%;
                        flex-shrink:0;
                        padding: 2px 0;">
                        <span>U${u}</span>
                        <span style="font-size:8px;color:#6699cc;">↕</span>
                        <span>U${uBottom}</span>
                    </div>`;
                }

                rackRowsHTML += `
                <div style="
                    display: flex;
                    flex-direction: row;
                    align-items: stretch;
                    height: ${blockH}px;
                    min-height: ${blockH}px;
                    max-height: ${blockH}px;
                    background: #cce5ff;
                    border-right: 3px solid #004085;
                    border-bottom: 2px solid #004085;
                    box-sizing: border-box;
                    overflow: hidden;
                    padding: 2px 4px;
                    gap: 4px;
                " title="${cell.name} | U${uBottom}–U${u} | ${cell.size}U">

                    <!-- תווית U -->
                    ${uLabelHTML}

                    <!-- שם ציוד -->
                    <div style="
                        flex: 1;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: ${cell.size === 1 ? '9px' : '10px'};
                        font-weight: bold;
                        color: #004085;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: ${cell.size === 1 ? 'nowrap' : 'normal'};
                        word-break: break-word;
                        text-align: center;
                        line-height: 1.2;">
                        ${cell.name}
                    </div>

                    <!-- badge גודל -->
                    <div style="
                        font-size: 8px;
                        background: #004085;
                        color: white;
                        border-radius: 3px;
                        padding: 1px 4px;
                        flex-shrink: 0;
                        align-self: flex-start;">
                        ${cell.size}U
                    </div>
                </div>`;

                // *** תיקון: קפיצה נכונה - מ-U עליון לאחר הציוד ***
                u -= cell.size;

            } else if (cell && !cell.isTop) {
                // *** שורת ביניים של ציוד - דלג ***
                u--;

            } else {
                // U פנוי
                rackRowsHTML += `
                <div style="
                    display: flex;
                    flex-direction: row;
                    align-items: center;
                    height: ${ROW_H}px;
                    min-height: ${ROW_H}px;
                    max-height: ${ROW_H}px;
                    background: #f8f9fa;
                    border-bottom: 1px solid #dee2e6;
                    box-sizing: border-box;
                    padding: 0 4px;
                    gap: 4px;
                " title="U${u} - פנוי">
                    <!-- מספר U -->
                    <div style="
                        min-width: 22px;
                        text-align: center;
                        font-size: 9px;
                        color: #aaa;
                        flex-shrink: 0;">
                        U${u}
                    </div>
                    <!-- קו ריק -->
                    <div style="
                        flex: 1;
                        height: 1px;
                        background: #dee2e6;">
                    </div>
                </div>`;
                u--;
            }
        }

        // ─── HTML של הפופאפ ───
        const popupHTML = `
        <div id="rackPreviewPopup" style="
            position: fixed;
            z-index: 99999;
            background: white;
            border: 2px solid #004085;
            border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.25);
            width: 280px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: Arial, sans-serif;
        ">
            <!-- כותרת -->
            <div style="
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: #004085;
                color: white;
                flex-shrink: 0;
            ">
                <div style="font-weight:bold; font-size:14px;">
                    <i class="fas fa-server"></i>
                    ארון ${rackId}
                </div>
                <button onclick="document.getElementById('rackPreviewPopup').remove()"
                    style="
                        background: none;
                        border: none;
                        color: white;
                        cursor: pointer;
                        font-size: 16px;
                        padding: 0;
                        line-height: 1;
                    ">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <!-- גוף הארון - גלילה -->
            <div style="
                overflow-y: auto;
                flex: 1;
                padding: 4px;
            ">
                <div style="
                    border: 2px solid #333;
                    border-radius: 4px;
                    overflow: hidden;
                ">
                    <!-- כותרת ארון -->
                    <div style="
                        background: #333;
                        color: white;
                        text-align: center;
                        font-size: 11px;
                        font-weight: bold;
                        padding: 3px;
                    ">
                        ${rackId}
                    </div>

                    <!-- יחידות הארון -->
                    <div>
                        ${rackRowsHTML}
                    </div>
                </div>
            </div>

            <!-- כפתור פתיחה מלאה -->
            <div style="
                padding: 8px;
                border-top: 1px solid #dee2e6;
                flex-shrink: 0;
                text-align: center;
            ">
                <button onclick="
                    document.getElementById('rackPreviewPopup').remove();
                    dataCenterManager.showRackDetails('${rackId}');"
                    style="
                        background: #004085;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        padding: 6px 14px;
                        cursor: pointer;
                        font-size: 12px;
                        width: 100%;
                    ">
                    <i class="fas fa-external-link-alt"></i>
                    פתח ארון מלא
                </button>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', popupHTML);
        this.positionPreviewNextToCurrentRack();
    }

    /**
     * מיקום הפופאפ משמאל לארון הנוכחי במודל
     */
    positionPreviewNextToCurrentRack() {
        const popup = document.getElementById('rackPreviewPopup');
        if (!popup) return;

        // חיפוש מיכל הארון הנוכחי
        const rackContainer = document.getElementById('rackContainer');
        if (!rackContainer) {
            // fallback - מרכז המסך
            popup.style.top = '50%';
            popup.style.left = '10px';
            popup.style.transform = 'translateY(-50%)';
            return;
        }

        const rect = rackContainer.getBoundingClientRect();
        const popupW = 260;
        const margin = 12;
        const vpH = window.innerHeight;
        const vpW = window.innerWidth;

        // מיקום אנכי - מיושר לראש הארון
        let top = rect.top;
        const maxH = vpH - margin * 2;
        if (top + maxH > vpH - margin) {
            top = vpH - maxH - margin;
        }
        if (top < margin) top = margin;

        // מיקום אופקי - משמאל לארון
        let left = rect.left - popupW - margin;
        if (left < margin) {
            // אם אין מקום משמאל - הצג מימין
            left = rect.right + margin;
        }
        if (left + popupW > vpW - margin) {
            left = vpW - popupW - margin;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;
        popup.style.maxHeight = `${maxH}px`;
        popup.style.transform = 'none';
    }

    /**
     * מיקום הפופאפ ליד אלמנט מסוים
     * @param {HTMLElement} popup - אלמנט הפופאפ
     * @param {HTMLElement} anchor - אלמנט העוגן
     */
    positionPopupNearElement(popup, anchor) {
        if (!anchor) {
            // מרכז המסך כברירת מחדל
            popup.style.top = '50%';
            popup.style.left = '50%';
            popup.style.transform = 'translate(-50%, -50%)';
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const popupWidth = 320;
        const margin = 10;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // חישוב מיקום אופקי
        let left = rect.right + margin;
        if (left + popupWidth > viewportWidth - margin) {
            // אם אין מקום מימין - הצג משמאל
            left = rect.left - popupWidth - margin;
        }
        if (left < margin) {
            left = margin;
        }

        // חישוב מיקום אנכי
        let top = rect.top;
        const popupHeight = Math.min(
            window.innerHeight * 0.8,
            600
        );
        if (top + popupHeight > viewportHeight - margin) {
            top = viewportHeight - popupHeight - margin;
        }
        if (top < margin) {
            top = margin;
        }

        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;
        popup.style.transform = 'none';
    }

    async checkPositionAvailability() {
        const startPositionInput =
            document.getElementById('equipmentStartPosition');
        const sizeUnitsInput =
            document.getElementById('equipmentSizeUnits');
        const rackId =
            document.getElementById('equipmentRackId').value;
        // תיקון: קריאה מהשדה הנסתר שמכיל את הקוד האמיתי (PT/RG)
        const dataCenterType =
            document.getElementById('equipmentDataCenterTypeInternal').value;
        const submitBtn =
            document.getElementById('equipmentEditSubmitBtn');
        const errorMessageElement =
            document.getElementById('positionErrorMessage');

        if (!startPositionInput || !sizeUnitsInput ||
            !rackId || !dataCenterType) return;

        const startPosition = parseInt(startPositionInput.value);
        const sizeUnits = parseInt(sizeUnitsInput.value);

        if (isNaN(startPosition) || isNaN(sizeUnits)) {
            startPositionInput.setCustomValidity('');
            if (errorMessageElement) {
                errorMessageElement.textContent = '';
                errorMessageElement.classList.remove('show');
            }
            return;
        }

        const newRackIdGroup = document.getElementById('newRackIdGroup');
        const newRackIdSelect = document.getElementById('newRackIdSelect');
        const isEditMode = newRackIdGroup &&
            newRackIdGroup.style.display !== 'none';
        const targetRackId = (isEditMode && newRackIdSelect?.value)
            ? newRackIdSelect.value
            : rackId;

        const originalStartPosition =
            document.getElementById('originalStartPosition').value;
        const isEdit = originalStartPosition !== '';

        const endPosition = startPosition + sizeUnits - 1; // endPosition = U עליון
        if (startPosition <= 0 || startPosition > 42 ||
            endPosition > 42 || sizeUnits <= 0) {
            const msg = 'הציוד חורג מגודל הארון';
            startPositionInput.setCustomValidity(msg);
            if (errorMessageElement) {
                errorMessageElement.textContent = msg;
                errorMessageElement.classList.add('show');
                errorMessageElement.style.display = 'flex';
            }
            if (submitBtn) submitBtn.disabled = true;
            return;
        }

        try {
            let checkUrl = `/DataCenter/CheckUPositionsAvailability` +
                `?rackId=${encodeURIComponent(targetRackId)}` +
                `&dataCenterType=${dataCenterType}` +
                `&startPosition=${startPosition}` +
                `&sizeUnits=${sizeUnits}`;

            if (isEdit && targetRackId === rackId) {
                const origName =
                    document.getElementById('originalEquipment').value;
                if (originalStartPosition && origName) {
                    checkUrl +=
                        `&originalStartPosition=${originalStartPosition}` +
                        `&originalEquipment=${encodeURIComponent(origName)}`;
                }
            }

            const response = await fetch(checkUrl);
            const data = await response.json();

            if (!data.isAvailable) {
                const msg = `מיקום U${startPosition}–U${endPosition}` +
                    ` בארון ${targetRackId} תפוס`;
                startPositionInput.setCustomValidity(msg);
                if (errorMessageElement) {
                    errorMessageElement.textContent = msg;
                    errorMessageElement.classList.add('show');
                    errorMessageElement.style.display = 'flex';
                }
                if (submitBtn) submitBtn.disabled = true;
            } else {
                startPositionInput.setCustomValidity('');
                if (errorMessageElement) {
                    errorMessageElement.textContent = '';
                    errorMessageElement.classList.remove('show');
                }
                if (submitBtn) submitBtn.disabled = false;
            }

        } catch (error) {
            console.error('Error checking position availability:', error);
        }
    }

    /**
     * סגירת מודל הוספת/עריכת ציוד
     */
    closeEquipmentEditModal() {
        const modal = document.getElementById('equipmentEditModal');
        if (modal) modal.style.display = 'none';

        const preview = document.getElementById('rackPreviewPopup');
        if (preview) preview.remove();

        const errorMsg = document.getElementById('positionErrorMessage');
        if (errorMsg) {
            errorMsg.textContent = '';
            errorMsg.style.display = 'none';
        }
    }

    /**
    * הצגת תפריט פעולות לציוד
    * @param {Event} event - אירוע הלחיצה
    * @param {HTMLElement} equipmentElement - אלמנט הציוד
    */
    showEquipmentActions(event, equipmentElement) {
        event.preventDefault(); // מניעת התנהגות ברירת מחדל
        event.stopPropagation(); // מניעת התפשטות האירוע לארון

        // קבלת נתוני הציוד עם טיפול בערכים חסרים
        const position = parseInt(equipmentElement.getAttribute('data-position')) || 0;
        const equipment = equipmentElement.querySelector('.model-name')?.textContent || 'ציוד לא ידוע';

        // חילוץ גודל הציוד מהקלאסים
        let sizeUnits = 1; // ברירת מחדל
        const sizeClass = Array.from(equipmentElement.classList).find(cls => cls.startsWith('size-'));
        if (sizeClass) {
            sizeUnits = parseInt(sizeClass.replace('size-', '')) || 1;
        }

        // הסרת תפריט קודם אם קיים
        const existingMenu = document.querySelector('.equipment-actions-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // יצירת תפריט פעולות
        const actionsMenu = document.createElement('div');
        actionsMenu.className = 'equipment-actions-menu';
        actionsMenu.innerHTML = `
        <button class="equipment-action-btn edit">
            <i class="fas fa-edit"></i> ערוך
        </button>
        <button class="equipment-action-btn delete">
            <i class="fas fa-trash"></i> הסר
        </button>
    `;

        // הוספת מאזיני אירועים לכפתורים
        const editBtn = actionsMenu.querySelector('.edit');
        const deleteBtn = actionsMenu.querySelector('.delete');

        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editEquipmentItem(position, equipment, sizeUnits);
            actionsMenu.remove();
        });

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.confirmRemoveEquipment(position, equipment);
            actionsMenu.remove();
        });

        // מיקום התפריט - שינוי למיקום יחסי למסך במקום יחסי לאלמנט
        const rect = event.target.getBoundingClientRect();
        actionsMenu.style.position = 'fixed';
        actionsMenu.style.top = `${rect.bottom + 5}px`;
        actionsMenu.style.left = `${rect.left}px`;
        actionsMenu.style.zIndex = '10000'; // z-index גבוה יותר

        // הוספת התפריט לדף
        document.body.appendChild(actionsMenu);

        // סגירת התפריט בלחיצה מחוץ אליו
        document.addEventListener('click', function closeMenu(e) {
            if (!actionsMenu.contains(e.target) && e.target !== event.target) {
                actionsMenu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }

    /**
     * עריכת פריט ציוד
     * @param {number} position - מיקום הציוד
     * @param {string} equipment - שם הציוד
     * @param {number} sizeUnits - גודל הציוד
     */
    editEquipmentItem(position, equipment, sizeUnits) {
        // וודא שהערכים תקינים
        position = parseInt(position) || 0;
        sizeUnits = parseInt(sizeUnits) || 1;
        equipment = equipment || '';

        this.showEquipmentEditModal('edit', {
            startPosition: position,
            equipment: equipment,
            size_units: sizeUnits
        });
    }

    /**
    * בדיקה אם יחידות ה-U פנויות לציוד
    * @param {string} rackId - מזהה הארון
    * @param {number} startPosition - מיקום התחלתי
    * @param {number} sizeUnits - גודל הציוד ביחידות
    * @param {number} originalPosition - מיקום מקורי (לעדכון ציוד קיים)
    * @param {number} originalSize - גודל מקורי (לעדכון ציוד קיים)
    * @returns {boolean} - האם היחידות פנויות
    */
    checkUnitAvailability(rackId, startPosition, sizeUnits, originalPosition = null, originalSize = null) {
        // בדיקה שיש נתונים לחדר השרתים הנוכחי
        if (!this.currentDataCenter || !this.racksData[this.currentDataCenter] || !this.racksData[this.currentDataCenter][rackId]) {
            return false;
        }

        // קבלת נתוני הארון
        const rackData = this.racksData[this.currentDataCenter][rackId];

        // חישוב טווח היחידות הנדרש (startPosition = תחתון, endPosition = עליון)
        const endPosition = startPosition + sizeUnits - 1;

        for (const item of rackData) {
            if (originalPosition !== null && item.startPosition === originalPosition) {
                continue;
            }

            // item.startPosition = תחתון, itemEndPosition = עליון
            const itemEndPosition = item.startPosition + (item.size_units || 1) - 1;

            // בדיקת חפיפה: שני טווחים חופפים אם אחד מתחיל לפני שהשני מסתיים
            if (startPosition <= itemEndPosition && endPosition >= item.startPosition) {
                return false;
            }
        }

        return true; // אין חפיפה, היחידות פנויות
    }

    /**
     * שליחת טופס הוספת/עריכת ציוד
     */
    async submitEquipmentEdit() {
        const form = document.getElementById('equipmentEditForm');
        const startPositionInput =
            document.getElementById('equipmentStartPosition');

        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        await this.checkPositionAvailability();

        if (startPositionInput.validity.customError) {
            startPositionInput.reportValidity();
            return;
        }

        const rackId = document.getElementById('equipmentRackId').value;
        // תיקון: קריאה מהשדה הנסתר שמכיל את הקוד האמיתי (PT/RG)
        const dataCenterType =
            document.getElementById('equipmentDataCenterTypeInternal').value;
        const startPosition = parseInt(
            document.getElementById('equipmentStartPosition').value);
        const sizeUnits = parseInt(
            document.getElementById('equipmentSizeUnits').value);
        const equipment = document.getElementById('equipmentName').value;

        const originalStartPositionVal =
            document.getElementById('originalStartPosition').value;
        const isEdit = originalStartPositionVal !== '';

        const newRackIdSelect = document.getElementById('newRackIdSelect');
        const newRackId = (isEdit && newRackIdSelect)
            ? newRackIdSelect.value
            : rackId;

        try {
            let checkUrl = `/DataCenter/CheckUPositionsAvailability` +
                `?rackId=${newRackId}` +
                `&dataCenterType=${dataCenterType}` +  // כעת שולח PT/RG
                `&startPosition=${startPosition}` +
                `&sizeUnits=${sizeUnits}`;

            if (isEdit) {
                const originalEquipment =
                    document.getElementById('originalEquipment').value;

                if (newRackId === rackId) {
                    checkUrl +=
                        `&originalStartPosition=${originalStartPositionVal}` +
                        `&originalEquipment=${encodeURIComponent(originalEquipment)}`;
                }
            }

            const checkResponse = await fetch(checkUrl);
            const checkData = await checkResponse.json();

            if (!checkData.isAvailable) {
                const topPos = startPosition + sizeUnits - 1;
                this._notify(
                    `שגיאה: מיקום U${startPosition}–U${topPos} בארון ${newRackId} תפוס`,
                    'error');
                return;
            }

            this.closeEquipmentEditModal();

            if (isEdit) {
                const originalEquipment =
                    document.getElementById('originalEquipment').value;

                await this.editEquipment({
                    rackId,
                    dataCenterType,  // כעת שולח PT/RG
                    originalStartPosition: parseInt(originalStartPositionVal),
                    originalEquipment,
                    newRackId,
                    newStartPosition: startPosition,
                    newSizeUnits: sizeUnits,
                    newEquipment: equipment
                });
            } else {
                await this.addEquipment(
                    rackId, dataCenterType, startPosition, sizeUnits, equipment);
            }

        } catch (error) {
            console.error('Error submitting equipment edit:', error);
            this._notify(
                `שגיאה בשמירת הציוד: ${error.message}`, 'error');
        }
    }

    /**
     * אישור הסרת ציוד
     * @param {number} position - מיקום הציוד
     * @param {string} equipment - שם הציוד
     */
    confirmRemoveEquipment(position, equipment) {
        if (confirm(`האם אתה בטוח שברצונך להסיר את הציוד "${equipment}" ממיקום U${position}?`)) {
            this.removeEquipment(this.currentRack.id, this.currentDataCenter, position, equipment);
        }
    }

    /**
    * הוספת כפתור להוספת ציוד חדש
    */
    addEquipmentAddButton() {
        // 1. בדיקה אם הכפתור כבר קיים
        if (document.getElementById('addEquipmentBtn')) return;
        const buttonsContainer = document.getElementById('headerButtonsContainer');
        if (!buttonsContainer) return;
        // 2. יצירת הכפתור (נשתמש בשם משתנה אחד עקבי)
        const addButton = document.createElement('button');
        addButton.id = 'addEquipmentBtn';
        addButton.className = 'add-equipment-btn';
        addButton.innerHTML = '<i class="fas fa-plus"></i> הוסף ציוד חדש';
        addButton.onclick = () => this.showEquipmentEditModal('add');
        // 3. התיקון: הכנסת הכפתור שיצרנו (addButton) לתוך המיכל
        buttonsContainer.insertAdjacentElement('beforeend', addButton);
        // 4. עיצוב ה-Container (כדי שיהיו בשורה, נשתמש ב-row ולא column)
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.flexDirection = 'row'; // שים לב: row כדי שיהיו באותה שורה
        buttonsContainer.style.alignItems = 'center';
        buttonsContainer.style.gap = '10px';
    }

    /**
     * צילום מסך של הארון והדפסתו
     */
    captureAndPrintRack(rackContainer) {
        // הודעה למשתמש
        this._notify('מכין צילום מסך...', 'info');

        // צילום מסך של הארון
        html2canvas(rackContainer, {
            backgroundColor: '#ffffff',
            scale: 1.5, // איכות טובה אך לא גבוהה מדי
            logging: false,
            useCORS: true
        }).then(canvas => {
            // המרת הקנבס לתמונה
            const imgData = canvas.toDataURL('image/png');

            // יצירת תוכן HTML להדפסה
            let printContent = `
        <!DOCTYPE html>
        <html dir="rtl" lang="he">
        <head>
            <meta charset="UTF-8">
            <title>ארון ${this.currentRack.id}</title>
            <style>
                @page {
                    size: A4 portrait;
                    margin: 0.5cm;
                }
                body {
                    font-family: Arial, sans-serif;
                    direction: rtl;
                    padding: 0;
                    margin: 0;
                    background-color: white;
                    color: black;
                }
                h1 {
                    text-align: center;
                    margin: 5px 0;
                    font-size: 16px;
                }
                .rack-image-container {
                    text-align: center;
                    margin: 10px auto;
                    max-width: 100%;
                    height: calc(100vh - 80px); /* גובה מקסימלי שיתאים לדף אחד */
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                }
                .rack-image {
                    max-width: 100%;
                    max-height: 100%; /* הגבלת גובה התמונה */
                    object-fit: contain; /* שמירה על יחס גובה-רוחב */
                }
                .print-footer {
                    margin-top: 5px;
                    text-align: center;
                    font-size: 10px;
                    color: #666;
                    padding-top: 5px;
                }
            </style>
        </head>
        <body>
            <h1>ארון ${this.currentRack.id} - באתר ${this.currentDataCenter === 'PT' ? 'פתח תקווה' : 'רמת גן'}</h1>
            
            <div class="rack-image-container">
                <img src="${imgData}" alt="ארון ${this.currentRack.id}" class="rack-image">
            </div>
            
            <div class="print-footer">
                הופק ממערכת NOC Portal | ${new Date().toLocaleDateString('he-IL')} | סה"כ: ${this.currentRack.data.length} פריטים
            </div>
            
            <script>
                // הפעל הדפסה אוטומטית כשהדף נטען
                window.onload = function() {
                    // וודא שהתמונה נטענה לפני הדפסה
                    const img = document.querySelector('.rack-image');
                    if (img.complete) {
                        window.print();
                    } else {
                        img.onload = function() {
                            window.print();
                        };
                    }
                };
            </script>
        </body>
        </html>`;

            // יצירת iframe נסתר
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = 'none';
            document.body.appendChild(iframe);

            // כתיבת התוכן ל-iframe
            const iframeDoc = iframe.contentWindow.document;
            iframeDoc.open();
            iframeDoc.write(printContent);
            iframeDoc.close();

            // הודעה למשתמש
            this._notify('מכין להדפסה...', 'info');

            // הסרת ה-iframe אחרי זמן קצר
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 2000);
        }).catch(error => {
            console.error('Error capturing rack screenshot:', error);
            this._notify('שגיאה בצילום מסך של הארון', 'error');
        });
    }

    /**
    * טעינת נתוני ארונות מהשרת
    * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
    * @param {boolean} forceRefresh - האם לאלץ טעינה מחדש מהמקור
    */
    async loadRacksData(dataCenterType, forceRefresh = false) {
        // סימון שהחדר בתהליך טעינה
        this.dataLoadingStatus[dataCenterType] = false;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.warn(`Request for ${dataCenterType} data timed out after 2 minutes`);
            }, 120 * 1000);

            // הוספת פרמטר לאילוץ טעינה מחדש
            const url = forceRefresh ?
                `/DataCenter/GetRacksData?dataCenterType=${dataCenterType}&forceRefresh=true` :
                `/DataCenter/GetRacksData?dataCenterType=${dataCenterType}`;

            // קריאה לשרת לקבלת נתוני הארונות
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });

            clearTimeout(timeoutId);

            // קריאת תוכן התשובה
            const responseText = await response.text();

            if (!response.ok) {
                let errorMessage = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = JSON.parse(responseText);
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch (e) {
                    errorMessage += ` - ${responseText}`;
                }
                throw new Error(errorMessage);
            }

            // ניסיון לפרסר את התשובה כ-JSON
            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                throw new Error('תשובה לא תקינה מהשרת');
            }

            if (data.success) {
                // וידוא שהנתונים בפורמט הנכון
                if (typeof data.racksData === 'object' && data.racksData !== null) {
                    this.racksData[dataCenterType] = data.racksData;
                    // סימון שהחדר נטען בהצלחה
                    this.dataLoadingStatus[dataCenterType] = true;
                    return true;
                } else {
                    throw new Error('פורמט נתונים לא תקין התקבל מהשרת');
                }
            } else {
                throw new Error(data.error || 'שגיאה בטעינת נתונים');
            }
        } catch (error) {
            console.error(`Error fetching ${dataCenterType} racks data:`, error);
            // סימון שהטעינה נכשלה
            this.dataLoadingStatus[dataCenterType] = false;

            throw error;
        }
    }

    /**
    * קבלת מטריקות של ארון
    * @param {string} rackId - מזהה הארון
    * @param {string} side - צד הארון (L או R)
    * @param {number} minutes - טווח זמן בדקות
    * @returns {Promise<Object>} - מטריקות הארון
    */
    async getRackMetrics(rackId, side = "L", minutes = 60) {
        try {
            const response = await fetch(`/DataCenter/GetRackMetrics?rackId=${encodeURIComponent(rackId)}&side=${side}&minutes=${minutes}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error fetching rack metrics:', error);
            throw error;
        }
    }

    /**
     * קבלת מטריקות נוכחיות של ארון
     * @param {string} rackId - מזהה הארון
     * @param {string} side - צד הארון (L או R)
     * @returns {Promise<Object>} - מטריקות נוכחיות של הארון
     */
    async getCurrentRackMetrics(rackId, side = "L") {
        try {
            const response = await fetch(`/DataCenter/GetCurrentRackMetrics?rackId=${encodeURIComponent(rackId)}&side=${side}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Error fetching current rack metrics:', error);
            throw error;
        }
    }

    /**
     * הצגת מטריקות של ארון
     * @param {string} rackId - מזהה הארון
     */
    async showRackMetrics(rackId) {
        try {
            // הצגת מצב טעינה
            this._notify('טוען צריכת חשמל וטמפרטורה...', 'info');

            // קבלת מטריקות נוכחיות
            const metricsL = await this.getCurrentRackMetrics(rackId, "L");
            const metricsR = await this.getCurrentRackMetrics(rackId, "R");

            // בדיקה אם יש מטריקות זמינות
            if ((!metricsL.success || (!metricsL.currentPower && !metricsL.currentTemperature)) &&
                (!metricsR.success || (!metricsR.currentPower && !metricsR.currentTemperature))) {
                this._notify('אין נתוני מטריקות זמינים לארון זה', 'info');
                return;
            }

            // יצירת תוכן המודל
            let modalContent = `
            <div class="rack-metrics-container">
                <h3>צריכת חשמל וטמפרטורה ${rackId}</h3>
                
                <div class="metrics-panels">
                    <div class="metrics-panel">
                        <h4>צד שמאל (L)</h4>
                        ${this.generateMetricsHTML(metricsL)}
                    </div>
                    
                    <div class="metrics-panel">
                        <h4>צד ימין (R)</h4>
                        ${this.generateMetricsHTML(metricsR)}
                    </div>
                </div>
                
                <div class="metrics-actions">
                    <button class="btn-primary" onclick="dataCenterManager.showDetailedMetrics('${rackId}')">
                        <i class="fas fa-chart-line"></i> הצג גרף מפורט
                    </button>
                </div>
            </div>
        `;

            // הצגת המודל
            this.showCustomModal('צריכת חשמל וטמפרטורה', modalContent);
        } catch (error) {
            console.error('Error showing rack metrics:', error);
            this._notify(`שגיאה בטעינת צריכת חשמל וטמפרטורה: ${error.message}`, 'error');
        }
    }

    /**
    * יצירת HTML למטריקות עם ספים
    * @param {Object} metrics - נתוני המטריקות
    * @returns {string} - קוד HTML
    */
    generateMetricsHTML(metrics) {
        if (!metrics.success || (!metrics.currentPower && !metrics.currentTemperature)) {
            return `<div class="no-data-message">אין נתונים זמינים</div>`;
        }

        const tempThreshold = this.getTemperatureThreshold(metrics.currentTemperature);
        const powerThreshold = this.getPowerThreshold(metrics.currentPower);

        const tempDisplay = metrics.currentTemperature
            ? metrics.currentTemperature.toFixed(1)
            : 'N/A';
        const powerDisplay = metrics.currentPower
            ? metrics.currentPower.toFixed(2)
            : 'N/A';

        return `
        <div class="metrics-data" style="
            border: 2px solid ${tempThreshold.borderColor}; 
            border-radius: 8px; 
            padding: 10px;
            display: flex;          
            flex-direction: column;    
            justify-content: center;
            align-items: center;    
            gap: 12px;              
        ">
            <!-- 🌡 טמפרטורה - למעלה -->
            <div class="metric-item" style="
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 6px;
                flex: 1;
            ">
                <div class="metric-icon" style="color: ${tempThreshold.color};">
                    <i class="fas fa-temperature-high"></i>
                </div>
                <div>
                    <div class="metric-value" style="color: ${tempThreshold.color};">
                        ${tempDisplay} °C
                    </div>
                    <div class="metric-label">טמפרטורה</div>
                </div>
            </div>

            <!-- ⚡ חשמל - למטה -->
            <div class="metric-item" style="
                display: flex;
                flex-direction: row;
                align-items: center;
                gap: 6px;
                flex: 1;
            ">
                <div class="metric-icon" style="color: ${powerThreshold.color};">
                    <i class="fas fa-bolt"></i>
                </div>
                <div>
                    <div class="metric-value" style="color: ${powerThreshold.color};">
                        ${powerDisplay} W
                    </div>
                    <div class="metric-label">צריכת חשמל</div>
                </div>
            </div>
        </div>
    `;
    }

    /**
    * קבלת סף טמפרטורה
    * @param {number} temperature - טמפרטורה בצלזיוס
    * @returns {Object} - { level: 'critical'|'warning'|'normal', color: string, label: string }
    */
    getTemperatureThreshold(temperature) {
        if (temperature === null || temperature === undefined) {
            return { level: 'unknown', color: '#6c757d', label: 'לא ידוע', borderColor: '#6c757d' };
        }
        if (temperature >= 29) {
            return { level: 'critical', color: '#dc3545', label: 'קריטי', borderColor: '#dc3545' };
        } else if (temperature >= 27) {
            return { level: 'warning', color: '#fd7e14', label: 'אזהרה', borderColor: '#fd7e14' };
        } else {
            return { level: 'normal', color: '#0d6efd', label: 'רגיל', borderColor: '#6c8ebf' };
        }
    }

    /**
    * קבלת סף הספק
    * @param {number} power - הספק בוואט
    * @returns {Object} - { level: string, color: string, label: string }
    */
    getPowerThreshold(power) {
        if (power === null || power === undefined) {
            return { level: 'unknown', color: '#6c757d', label: 'לא ידוע' };
        }

        // הערכים מהשרת הם בוואט - השוואה ישירה בוואט (ללא המרה)
        if (power >= 1000) {
            return { level: 'critical', color: '#dc3545', label: 'קריטי' };
        } else if (power >= 500) {
            return { level: 'warning', color: '#fd7e14', label: 'אזהרה' };
        } else if (power >= 100) {
            return { level: 'caution', color: '#ffc107', label: 'זהירות' };
        } else {
            return { level: 'normal', color: '#343a40', label: 'רגיל' };
        }
    }

    /**
     * הצגת מטריקות צריכת חשמל וטמפרטורה עם גרף
     * @param {string} rackId - מזהה הארון
     */
    async showDetailedMetrics(rackId) {
        try {
            // Show loading state
            if (typeof NotificationManager !== 'undefined') {
                this._notify('טוען נתונים מפורטים...', 'info');
            }
            // Get detailed metrics (24 hours)
            const metricsL = await this.getRackMetrics(rackId, "L", 1440); // 24 שעות
            const metricsR = await this.getRackMetrics(rackId, "R", 1440); // 24 שעות

            // בדיקה אם יש מטריקות זמינות
            if ((!metricsL.success || (metricsL.powerData.length === 0 && metricsL.temperatureData.length === 0)) &&
                (!metricsR.success || (metricsR.powerData.length === 0 && metricsR.temperatureData.length === 0))) {
                this._notify('אין נתוני מטריקות היסטוריים זמינים לארון זה', 'info');
                return;
            }


            // Create unique IDs for charts
            const powerChartIdL = `power-chart-L-${Date.now()}`;
            const tempChartIdL = `temp-chart-L-${Date.now()}`;
            const powerChartIdR = `power-chart-R-${Date.now()}`;
            const tempChartIdR = `temp-chart-R-${Date.now()}`;

            // Create modal content with side-by-side layout and time range selector
            let modalContent = `
                <div class="detailed-metrics-container">
                    <h3>נתוני צריכת חשמל וטמפרטורה - ארון ${rackId}</h3>
                    
                    <div class="time-range-selector">
                        <label>טווח זמן להצגה:</label>
                        <select id="timeRangeSelector" onchange="dataCenterManager.updateChartsTimeRange()">
                            <option value="60">שעה אחרונה</option>
                            <option value="720">12 שעות אחרונות</option>
                            <option value="1440">24 שעות אחרונות</option>
                        </select>
                    </div>
                    
                    <div class="metrics-side-by-side">                
                        <div class="metrics-side right-side">
                            <h4>צד ימין (R)</h4>

                            <!-- טמפרטורה למעלה -->
                            <div class="chart-section">
                                <h5>טמפרטורה</h5>
                                <div class="chart-container">
                                    <canvas id="${tempChartIdR}"></canvas>
                                </div>
                            </div>

                            <!-- חשמל למטה -->
                            <div class="chart-section">
                                <h5>צריכת חשמל</h5>
                                <div class="chart-container">
                                    <canvas id="${powerChartIdR}"></canvas>
                                </div>
                            </div>
                        </div>

                        <div class="metrics-side left-side">
                            <h4>צד שמאל (L)</h4>

                            <!-- טמפרטורה למעלה -->
                            <div class="chart-section">
                                <h5>טמפרטורה</h5>
                                <div class="chart-container">
                                    <canvas id="${tempChartIdL}"></canvas>
                                </div>
                            </div>

                            <!-- חשמל למטה -->
                            <div class="chart-section">
                                <h5>צריכת חשמל</h5>
                                <div class="chart-container">
                                    <canvas id="${powerChartIdL}"></canvas>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Show modal with larger size for side-by-side display
            this.showCustomModal('נתוני צריכת חשמל וטמפרטורה', modalContent, 'xl');

            // Load Chart.js if needed
            await this.loadChartJsIfNeeded();

            // שמירת נתוני המטריקות המלאים לשימוש בעת שינוי טווח הזמן
            this.currentMetricsData = {
                rackId,
                L: metricsL,
                R: metricsR
            };

            // Create charts with proper IDs - default to 1 hour view
            // *** תיקון: יצירת גרפים בסדר החדש - טמפ' ראשון, חשמל שני ***
            if (metricsL.success) {
                const filteredTempData = this.filterDataByTimeRange(metricsL.temperatureData, 60);
                const filteredPowerData = this.filterDataByTimeRange(metricsL.powerData, 60);

                // טמפרטורה למעלה
                this.createMetricsChart(tempChartIdL, filteredTempData, 'טמפרטורה (°C)', 'rgb(54, 162, 235)');
                // חשמל למטה
                this.createMetricsChart(powerChartIdL, filteredPowerData, 'צריכת חשמל (W)', 'rgb(255, 99, 132)');
            }

            if (metricsR.success) {
                const filteredTempData = this.filterDataByTimeRange(metricsR.temperatureData, 60);
                const filteredPowerData = this.filterDataByTimeRange(metricsR.powerData, 60);

                // טמפרטורה למעלה
                this.createMetricsChart(tempChartIdR, filteredTempData, 'טמפרטורה (°C)', 'rgb(54, 162, 235)');
                // חשמל למטה
                this.createMetricsChart(powerChartIdR, filteredPowerData, 'צריכת חשמל (W)', 'rgb(255, 99, 132)');
            }
        } catch (error) {
            console.error('Error showing detailed metrics:', error);
            this._notify(`שגיאה בטעינת נתוני צריכת חשמל וטמפרטורה: ${error.message}`, 'error');
        }
    }

    /**
     * טעינת ספריית Chart.js אם לא נטענה
     * @returns {Promise<void>}
     */
    async loadChartJsIfNeeded() {
        // Since the scripts are already included in the HTML, we just need to check if Chart is defined
        if (typeof Chart !== 'undefined') {
            return Promise.resolve(); // Chart.js is already loaded
        }

        // If Chart is not defined, wait a moment for scripts to load
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (typeof Chart !== 'undefined') {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);

            // Set a timeout to avoid infinite waiting
            setTimeout(() => {
                clearInterval(checkInterval);
                console.warn('Chart.js not loaded after timeout');
                resolve(); // Resolve anyway to avoid hanging
            }, 5000);
        });
    }

    /**
    * יצירת גרף מטריקות עם קווי threshold
    * @param {string} chartId - מזהה הקנבס
    * @param {Array} data - נתוני הגרף
    * @param {string} label - תווית הגרף
    * @param {string} color - צבע הגרף
    */
    createMetricsChart(chartId, data, label, color) {
        // הגבלת מספר הנקודות המוצגות למקסימום 70
        const MAX_POINTS = 70;
        const sampledData = data.length > MAX_POINTS
            ? (() => {
                const result = [];
                const step = (data.length - 1) / (MAX_POINTS - 1);
                for (let i = 0; i < MAX_POINTS; i++) {
                    result.push(data[Math.round(i * step)]);
                }
                return result;
            })()
            : data;

        const formattedData = sampledData.map(point => ({
            x: point.timestamp * 1000,
            y: point.value
        }));

        const ctx = document.getElementById(chartId)?.getContext('2d');
        if (!ctx) return;

        if (ctx.canvas.chart) {
            ctx.canvas.chart.destroy();
        }

        const isTemperature = label.includes('°C') || label.includes('טמפרטורה');
        const isPower = label.includes('W') || label.includes('חשמל');

        /**
         * פונקציה שמחזירה צבע לפי ערך נקודה
         */
        const getColorByValue = (value) => {
            if (isTemperature) {
                if (value >= 29) return '#dc3545'; // קריטי - אדום
                if (value >= 27) return '#fd7e14'; // אזהרה - כתום
                return '#0d6efd';                   // רגיל - כחול
            }
            if (isPower) {
                if (value >= 1000) return '#dc3545'; // קריטי - אדום
                if (value >= 500) return '#fd7e14'; // אזהרה - כתום
                if (value >= 100) return '#ffc107'; // זהירות - צהוב
                return '#333333'; // רגיל - אפור כהה
            }
            return color; // ברירת מחדל
        };

        // הגדרת annotations (קווי threshold)
        const annotations = {};

        if (isTemperature) {
            annotations.warningLine = {
                type: 'line',
                yMin: 27,
                yMax: 27,
                borderColor: '#fd7e14',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                    content: 'אזהרה 27°C',
                    enabled: true,
                    position: 'end',
                    backgroundColor: '#fd7e14',
                    color: 'white',
                    font: { size: 11 }
                }
            };
            annotations.criticalLine = {
                type: 'line',
                yMin: 29,
                yMax: 29,
                borderColor: '#dc3545',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                    content: 'קריטי 29°C',
                    enabled: true,
                    position: 'end',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    font: { size: 11 }
                }
            };
            annotations.criticalZone = {
                type: 'box',
                yMin: 29,
                backgroundColor: 'rgba(220, 53, 69, 0.08)',
                borderWidth: 0
            };
            annotations.warningZone = {
                type: 'box',
                yMin: 27,
                yMax: 29,
                backgroundColor: 'rgba(253, 126, 20, 0.08)',
                borderWidth: 0
            };
            annotations.normalZone = {
                type: 'box',
                yMax: 27,
                backgroundColor: 'rgba(13, 110, 253, 0.05)',
                borderWidth: 0
            };
        } else if (isPower) {
            annotations.cautionLine = {
                type: 'line',
                yMin: 100,
                yMax: 100,
                borderColor: '#ffc107',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                    content: 'זהירות 100kW',
                    enabled: true,
                    position: 'end',
                    backgroundColor: '#ffc107',
                    color: '#333',
                    font: { size: 11 }
                }
            };
            annotations.warningLine = {
                type: 'line',
                yMin: 500,
                yMax: 500,
                borderColor: '#fd7e14',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                    content: 'אזהרה 500kW',
                    enabled: true,
                    position: 'end',
                    backgroundColor: '#fd7e14',
                    color: 'white',
                    font: { size: 11 }
                }
            };
            annotations.criticalLine = {
                type: 'line',
                yMin: 1000,
                yMax: 1000,
                borderColor: '#dc3545',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                    content: 'קריטי 1000kW',
                    enabled: true,
                    position: 'end',
                    backgroundColor: '#dc3545',
                    color: 'white',
                    font: { size: 11 }
                }
            };
        }

        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: label,
                    data: formattedData,

                    // צבע הנקודות - כל נקודה לפי הערך שלה
                    pointBackgroundColor: formattedData.map(p => getColorByValue(p.y)),
                    pointBorderColor: formattedData.map(p => getColorByValue(p.y)),
                    pointRadius: 3,
                    pointHoverRadius: 6,

                    // צבע הקו בין נקודות - לפי הערך של הנקודה הנוכחית
                    segment: {
                        borderColor: (ctx) => {
                            // ctx.p1 היא הנקודה הבאה (הימנית)
                            // נצבע כל סגמנט לפי הערך הגבוה יותר מבין שתי הנקודות
                            const v1 = ctx.p0.parsed.y;
                            const v2 = ctx.p1.parsed.y;
                            const maxVal = Math.max(v1, v2);
                            return getColorByValue(maxVal);
                        },
                        // צבע המילוי מתחת לקו - לפי אותו עיקרון
                        backgroundColor: (ctx) => {
                            const v1 = ctx.p0.parsed.y;
                            const v2 = ctx.p1.parsed.y;
                            const maxVal = Math.max(v1, v2);
                            const baseColor = getColorByValue(maxVal);
                            // הוספת שקיפות לצבע המילוי
                            return baseColor + '22'; // 22 hex = ~13% opacity
                        }
                    },

                    tension: 0.2,
                    fill: true,
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    tooltip: {
                        enabled: true,
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function (tooltipItems) {
                                const date = new Date(tooltipItems[0].parsed.x);
                                return date.toLocaleString('he-IL');
                            },
                            label: function (context) {
                                const value = context.parsed.y;
                                let thresholdLabel = '';
                                if (isTemperature) {
                                    if (value >= 29) thresholdLabel = ' ⚠️ קריטי';
                                    else if (value >= 27) thresholdLabel = ' ⚠️ אזהרה';
                                } else if (isPower) {
                                    const kw = value;
                                    if (kw >= 1000) thresholdLabel = ' ⚠️ קריטי';
                                    else if (kw >= 500) thresholdLabel = ' ⚠️ אזהרה';
                                    else if (kw >= 100) thresholdLabel = ' ⚠️ זהירות';
                                }
                                return `${context.dataset.label}: ${value.toFixed(2)}${thresholdLabel}`;
                            },
                            labelColor: function (context) {
                                const value = context.parsed.y;
                                const bgColor = getColorByValue(value);
                                return {
                                    borderColor: bgColor,
                                    backgroundColor: bgColor
                                };
                            }
                        }
                    },
                    legend: {
                        display: false,
                        position: 'top',
                        labels: {
                            font: { size: 14 }
                        }
                    },
                    annotation: {
                        annotations: annotations
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'minute',
                            displayFormats: {
                                minute: 'HH:mm',
                                hour: 'HH:mm'
                            }
                        },
                        title: {
                            display: true,
                            text: 'זמן',
                            font: { size: 14 }
                        },
                        ticks: {
                            font: { size: 12 }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: label,
                            font: { size: 14 }
                        },
                        ticks: {
                            font: { size: 12 }
                        }
                    }
                }
            }
        });

        ctx.canvas.chart = chart;
    }

    /**
     * החלפת לשונית במטריקות צריכת חשמל וטמפרטורה
     * @param {Event} event - אירוע הלחיצה
     * @param {string} tabId - מזהה הלשונית
     */
    switchMetricsTab(event, tabId) {
        // הסרת מחלקת active מכל הלשוניות
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => button.classList.remove('active'));

        // הסרת מחלקת active מכל תוכן הלשוניות
        const tabPanes = document.querySelectorAll('.tab-pane');
        tabPanes.forEach(pane => pane.classList.remove('active'));

        // הוספת מחלקת active ללשונית שנלחצה
        event.currentTarget.classList.add('active');

        // הוספת מחלקת active לתוכן הלשונית המתאימה
        document.getElementById(tabId).classList.add('active');
    }

    /**
     * הצגת מודל מותאם אישית
     * @param {string} title - כותרת המודל
     * @param {string} content - תוכן המודל
     * @param {string} size - גודל המודל (sm, md, lg)
     */
    showCustomModal(title, content, size = 'md') {
        // בדיקה אם המודל כבר קיים
        let modal = document.getElementById('customModal');

        if (!modal) {
            // יצירת המודל
            const modalHTML = `
            <div id="customModal" class="modal-overlay">
                <div class="modal-content metrics-graph-modal custom-modal ${size}">
                    <div class="modal-header">
                        <h3 id="customModalTitle"></h3>
                        <button class="modal-close" onclick="dataCenterManager.closeCustomModal()">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div id="customModalBody" class="modal-body"></div>
                </div>
            </div>
        `;

            document.body.insertAdjacentHTML('beforeend', modalHTML);
            modal = document.getElementById('customModal');
        }

        // עדכון תוכן המודל
        document.getElementById('customModalTitle').textContent = title;
        document.getElementById('customModalBody').innerHTML = content;

        // הצגת המודל
        modal.style.display = 'flex';
    }

    /**
     * סגירת מודל מותאם אישית
     */
    closeCustomModal() {
        const modal = document.getElementById('customModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    /**
     * בדיקה אם כל הנתונים נטענו
     * @returns {boolean} - האם כל הנתונים נטענו
     */
    areAllDataCentersLoaded() {
        return this.dataLoadingStatus.PT && this.dataLoadingStatus.RG;
    }

    /**
     * הצגת חדר שרתים
     * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
     */
    async showDataCenter(dataCenterType) {
        this.currentDataCenter = dataCenterType;

        this.createDataCenterModal();

        // עדכון כותרת
        const title = document.getElementById('dataCenterTitle');
        if (!title) {
            console.error('dataCenterTitle element not found');
            return;
        }
        title.textContent = dataCenterType === 'PT' ? 'מפת אתר פתח תקווה' : 'מפת אתר רמת גן';

        // *** תיקון: איפוס מצב UI של חיפושים בעת פתיחה מחדש ***
        const freeSpaceResultsInfo = document.getElementById('freeSpaceResultsInfo');
        if (freeSpaceResultsInfo) freeSpaceResultsInfo.style.display = 'none';

        const searchResultsInfo = document.getElementById('searchResultsInfo');
        if (searchResultsInfo) searchResultsInfo.style.display = 'none';

        const searchInput = document.getElementById('dataCenterSearchInput');
        if (searchInput) searchInput.value = '';

        // איפוס נתוני חיפוש מקום פנוי
        this.lastFreeSpaceResults = [];
        this.lastSearchTerm = '';

        // הצג את המודל מיד עם אינדיקציית טעינה
        this.showDataCenterLoadingIndicator(dataCenterType);
        document.getElementById('dataCenterModal').style.display = 'flex';

        try {
            // בדיקה אם הנתונים כבר נטענו
            if (!this.dataLoadingStatus[dataCenterType]) {
                await this.loadRacksData(dataCenterType);
            }

            // עדכון התצוגה עם הנתונים
            const container = document.getElementById('dataCenterContainer');
            container.innerHTML = this.generateDataCenterHTML(dataCenterType);
            this.setupRackEventListeners();

            // בדיקה אם יש עדכונים זמינים לחדר זה - רק אם הטעינה הצליחה
            if (this.dataLoadingStatus[dataCenterType]) {
                this.checkAndUpdateRefreshButton(dataCenterType);
            }
        } catch (error) {
            console.error(`Error loading ${dataCenterType} data:`, error);
            const container = document.getElementById('dataCenterContainer');
            container.innerHTML = `<div class="error-message">
            <i class="fas fa-exclamation-triangle"></i> 
            שגיאה בטעינת נתונים: ${error.message}
        </div>`;
        }
    }


    /**
     * בדיקה ועדכון כפתור הרענון עבור חדר שרתים ספציפי
     */
    async checkAndUpdateRefreshButton(dataCenterType) {
        if (!dataCenterType) return; // אם לא הועבר סוג חדר שרתים, נצא מהפונקציה

        const hasChanges = await this.checkSourceFilesModified(dataCenterType);
        const refreshButton = document.getElementById('refreshCurrentDataCenter');

        if (refreshButton) {
            if (hasChanges) {
                refreshButton.style.display = 'flex';
                refreshButton.classList.add('has-updates');
                refreshButton.setAttribute('title', 'יש שינויים בקובץ המקור - לחץ לרענון');
            } else {
                refreshButton.style.display = 'none';
                refreshButton.classList.remove('has-updates');
                refreshButton.setAttribute('title', 'רענן נתונים מהמקור');
            }
        }
    }

    /**
     * רענון ידני של נתוני הארונות
     */
    async refreshRacksData() {
        // הצגת מצב טעינה
        const container = document.getElementById('dataCenterContainer');
        container.innerHTML = '<div class="loading-spinner"><i class="fas fa-spinner fa-spin"></i><span>מרענן נתונים...</span></div>';

        try {
            // קודם כל מחיקת קבצי הקאש בשרת
            const clearCacheResponse = await fetch('/DataCenter/ClearCache', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!clearCacheResponse.ok) {
                throw new Error('שגיאה במחיקת קבצי הקאש');
            }

            // איפוס נתוני הארונות ומצב הטעינה
            this.racksData = {
                PT: {},
                RG: {}
            };
            this.dataLoadingStatus = {
                PT: false,
                RG: false
            };

            // טעינת נתונים מחדש במקביל
            await Promise.all([
                this.loadRacksData('PT'),
                this.loadRacksData('RG')
            ]);

            // עדכון התצוגה
            if (this.currentDataCenter) {
                container.innerHTML = this.generateDataCenterHTML(this.currentDataCenter);
                this.setupRackEventListeners();
            }

            // הודעת הצלחה
            this._notify('הנתונים רועננו בהצלחה מהמקור', 'success');

        } catch (error) {
            console.error('Error refreshing racks data:', error);

            // הצגת הודעת שגיאה
            container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה ברענון נתונים: ${error.message}</div>`;
        }
    }

    /**
    * בדיקה אם יש שינויים בקבצי המקור
    * @param {string} dataCenterType - סוג חדר השרתים (PT או RG)
    * @returns {Promise<boolean>} - האם יש שינויים
    */
    async checkSourceFilesModified(dataCenterType) {
        try {
            const response = await fetch(`/DataCenter/CheckSourceFilesModified?dataCenterType=${dataCenterType}`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return result.hasChanges;
        } catch (error) {
            console.error('Error checking source files:', error);
            return false; // במקרה של שגיאה, נניח שאין שינויים
        }
    }

    /**
     * עדכון כפתור רענון בהתאם לשינויים
     */
    async updateRefreshButton() {
        // בדיקת שינויים רק אם יש חדר שרתים נוכחי
        if (this.currentDataCenter) {
            const hasChanges = await this.checkSourceFilesModified(this.currentDataCenter);

            // עדכון כפתור הרענון הספציפי לחדר הנוכחי
            const refreshButton = document.getElementById('refreshCurrentDataCenter');
            if (refreshButton) {
                if (hasChanges) {
                    refreshButton.style.display = 'flex';
                    refreshButton.classList.add('has-updates');
                    refreshButton.setAttribute('title', 'יש שינויים בקובץ המקור - לחץ לרענון');
                } else {
                    refreshButton.style.display = 'none';
                    refreshButton.classList.remove('has-updates');
                    refreshButton.setAttribute('title', 'רענן נתונים מהמקור');
                }
            }
        }
    }

    /**
    * התחלת רענון אוטומטי של נתוני הארונות
    * @param {number} intervalMinutes - מרווח זמן בדקות בין רענונים
    */
    startAutoRefresh(intervalMinutes = 60) {
        // ניקוי טיימר קודם אם קיים
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
        }

        // המרת דקות למילישניות
        const intervalMs = intervalMinutes * 60 * 1000;

        // הגדרת פונקציית הרענון
        const refreshFunction = async () => {
            try {
                // מחיקת קבצי הקאש בשרת
                await fetch('/DataCenter/ClearCache', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                // איפוס נתוני הארונות ומצב הטעינה
                this.racksData = {
                    PT: {},
                    RG: {}
                };
                this.dataLoadingStatus = {
                    PT: false,
                    RG: false
                };

                // טעינת נתונים מחדש במקביל
                await Promise.all([
                    this.loadRacksData('PT'),
                    this.loadRacksData('RG')
                ]);

                // רענון התצוגה אם המודל פתוח
                if (document.getElementById('dataCenterModal').style.display === 'flex' && this.currentDataCenter) {
                    const container = document.getElementById('dataCenterContainer');
                    container.innerHTML = this.generateDataCenterHTML(this.currentDataCenter);
                    this.setupRackEventListeners();
                }
            } catch (error) {
                console.error('Error during auto-refresh:', error);
            }
        };

        // הפעלת הפונקציה מיד בהתחלה
        refreshFunction();

        // הגדרת הטיימר לרענון תקופתי
        this.autoRefreshTimer = setInterval(refreshFunction, intervalMs);

        return true;
    }

    /**
     * עצירת רענון אוטומטי של נתוני הארונות
     */
    stopAutoRefresh() {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
            return true;
        }
        return false;
    }
}

// יצירת מופע גלובלי
const dataCenterManager = new DataCenterManager();
window.dataCenterManager = dataCenterManager;

// הוספת אירוע לטעינת הדף
document.addEventListener('DOMContentLoaded', () => {
    // אתחול מנהל חדר השרתים
    dataCenterManager.initialize();
});