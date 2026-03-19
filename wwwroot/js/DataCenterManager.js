/**
 * DataCenterManager - מנהל תצוגת חדר שרתים
 * מאפשר הצגת מפת חדר שרתים ופרטי ארונות בפופאפ
 */
class DataCenterManager {
    constructor() {
        this.currentRack = null;
        // הפרדת נתוני הארונות לפי חדר
        this.racksData = {
            PT: {},
            RG: {}
        };
        this.isInitialized = false;
        this.currentDataCenter = null; // PT או RG
        this.dataLoadingStatus = {
            PT: false,
            RG: false
        };
    }

    /**
     * אתחול המנהל
    */
    initialize() {
        if (this.isInitialized) return;

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
                                <th>Connected To</th>
                                <th>Description</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>1</td>
                                <td>Optic</td>
                                <td>Server Dell (B4-6 / U-15 / PORT 2)</td>
                                <td>תיאור החיבור</td>
                            </tr>
                        </tbody>
                    </table>
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
                    <option value="Other" ${typeValue === 'Other' || !typeValue ? 'selected' : ''}>Other</option>
                </select>`;
            }

            // המרת התא השלישי (מחובר אל) למספר שדות נפרדים
            if (cells[2]) {
                // חילוץ הערכים מהתצוגה המפורטת
                const connectionDetails = cells[2].querySelectorAll('.connection-detail');
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
                    const targetValue = cells[2].textContent.trim();
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
                cells[2].className = 'edit-mode-cell';
                cells[2].innerHTML = `
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
                const equipmentInput = cells[2].querySelector('.equipment-name-input');
                const dropdown = cells[2].querySelector('.autocomplete-dropdown');
                const rackInput = cells[2].querySelector('.rack-id-input');
                const positionInput = cells[2].querySelector('.position-input');

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
                    if (!cells[2].querySelector('.autocomplete-container').contains(e.target)) {
                        dropdown.style.display = 'none';
                    }
                });
            }

            // המרת התא הרביעי (תיאור) לשדה טקסט
            if (cells[3]) {
                const descValue = cells[3].textContent.trim();
                cells[3].className = 'edit-mode-cell';
                cells[3].innerHTML = `<input type="text" class="connection-description" value="${descValue}">`;
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
            <td colspan="5" class="empty-cell">
                <div class="empty-message"><i class="fas fa-info-circle"></i> אין חיבורים מוגדרים לציוד זה</div>
            </td>
        </tr>`;
            return;
        }

        // הוספת שורות החיבורים במצב צפייה בלבד - עם פירוק המידע לשדות נפרדים
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
        <td colspan="5" class="loading-cell">
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
            <option value="Other">Other</option>
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
        const targetCell = row.querySelector('td:nth-child(3)');
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
            NotificationManager.show('לא נבחר ציוד לשמירת חיבורים', 'error');
            return;
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
                        connectedTo: connectedTo,
                        description: descriptionInput.value
                    });
                }
            });

            // שליחת הנתונים לשרת - כולל מיקום ה-U ושם הציוד
            const response = await fetch(`/DataCenter/SaveEquipmentConnections`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
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
                NotificationManager.show('החיבורים נשמרו בהצלחה', 'success');
                // חזרה למצב צפייה לאחר שמירה
                this.showEquipmentConnectionsModal(this.currentEquipment.name, this.currentEquipment.rackId, this.currentEquipment.startPosition);
            } else {
                throw new Error(data.error || 'שגיאה בשמירת החיבורים');
            }
        } catch (error) {
            console.error('Error saving equipment connections:', error);
            NotificationManager.show(`שגיאה בשמירת החיבורים: ${error.message}`, 'error');
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
            NotificationManager.show('הקובץ חייב להיות בפורמט Excel או CSV', 'error');
            return;
        }

        // בדיקה שיש ציוד נוכחי
        if (!this.currentEquipment) {
            NotificationManager.show('לא נבחר ציוד להעלאת חיבורים', 'error');
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

                if (isEditMode) {
                    // אם אנחנו במצב עריכה, נציג את הנתונים במצב עריכה
                    this.displayConnectionsInEditMode(data.connections || []);
                } else {
                    // אחרת, נציג את הנתונים במצב צפייה
                    this.updateConnectionsTable(data.connections || []);
                }

                NotificationManager.show('קובץ החיבורים נטען בהצלחה', 'success');
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
            NotificationManager.show(`שגיאה בהעלאת קובץ החיבורים: ${error.message}`, 'error');
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
                <option value="Other" ${connection.type === 'Other' || !connection.type ? 'selected' : ''}>Other</option>
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
            <input type="text" class="connection-description" value="${connection.description || ''}">
        </td>
        <td class="actions-cell">
            <button class="btn-delete-connection" onclick="dataCenterManager.deleteConnectionRow(this)">
                <i class="fas fa-trash"></i>
            </button>
        </td>`;
            tableBody.appendChild(row);

            // הוספת פונקציונליות השלמה אוטומטית לשדה שם הציוד
            const targetCell = row.querySelector('td:nth-child(3)');
            const equipmentInput = targetCell.querySelector('.equipment-name-input');
            const dropdown = targetCell.querySelector('.autocomplete-dropdown');
            const rackInput = targetCell.querySelector('.rack-id-input');
            const positionInput = targetCell.querySelector('.position-input');

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
                    <div class="search-box">
                        <input type="text" id="dataCenterSearchInput" placeholder="חפש ציוד בארונות..." onkeyup="dataCenterManager.searchEquipment()">
                        <i class="fas fa-search"></i>
                    </div>
                    <div id="searchResultsInfo" class="search-results-info" style="display: none;">
                        <span id="searchResultsCount">0</span> ארונות נמצאו
                        <button class="btn-clear-search" onclick="dataCenterManager.clearSearch()">
                            <i class="fas fa-times"></i> נקה חיפוש
                        </button>
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

        // Add event listener to refresh button
        const refreshButton = document.getElementById('refreshCurrentDataCenter');
        if (refreshButton) {
            refreshButton.addEventListener('click', () => this.refreshCurrentDataCenter());
        }
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
            NotificationManager.show(`נתוני חדר ${this.currentDataCenter} רועננו בהצלחה מהמקור`, 'success');

        } catch (error) {
            console.error('Error refreshing data center:', error);

            // הצגת הודעת שגיאה
            container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה ברענון נתונים: ${error.message}</div>`;
            NotificationManager.show(`שגיאה ברענון נתוני חדר ${this.currentDataCenter}: ${error.message}`, 'error');
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
        // בדיקה אם המודל כבר קיים
        if (document.getElementById('rackDetailsModal')) return;

        const modalHTML = `
        <div id="rackDetailsModal" class="modal-overlay">
            <div class="modal-content rack-details-modal">
                <div class="modal-header">
                    <h3><i class="fas fa-server"></i> <span id="rackTitle">פרטי ארון</span></h3>
                </div>
                    <button class="modal-close" onclick="dataCenterManager.closeRackDetails()">
                        <i class="fas fa-times"></i>
                    </button>
                <div class="modal-body">
                    <div id="rackContainer" class="rack-container"></div>
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
        this.clearSearch(); // ניקוי החיפוש בעת סגירה
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
                // NotificationManager.show(`שגיאה בטעינת נתוני ארון ${rackId}: ${error.message}`, 'error');

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
        document.getElementById('rackDetailsModal').style.display = 'none';
    }

    /**
 * חיפוש ציוד בארונות
 */
    searchEquipment() {
        const searchInput = document.getElementById('dataCenterSearchInput');
        const searchTerm = searchInput.value.trim().toLowerCase();
        const searchResultsInfo = document.getElementById('searchResultsInfo');
        const searchResultsCount = document.getElementById('searchResultsCount');

        // אם אין מונח חיפוש, נסתיר את תוצאות החיפוש ונחזיר את כל הארונות למצב רגיל
        if (!searchTerm) {
            this.clearSearch();
            return;
        }

        // מערך לשמירת הארונות שנמצאו בהם תוצאות
        const foundRacks = [];

        // נמצא את כל הארונות המוצגים כרגע בממשק
        const visibleRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        const visibleRackIds = Array.from(visibleRacks).map(rack => rack.getAttribute('data-rack-id'));

        // בדיקה אם יש לנו נתונים על חדר השרתים הנוכחי
        if (this.currentDataCenter && this.racksData[this.currentDataCenter]) {
            // עבור על כל הארונות הנראים כרגע
            for (const rackId of visibleRackIds) {
                // בדיקה אם יש לנו נתונים על הארון הזה בחדר השרתים הנוכחי
                if (!this.racksData[this.currentDataCenter][rackId]) continue;

                const rackData = this.racksData[this.currentDataCenter][rackId];

                // בדיקה אם יש ציוד בארון שמתאים לחיפוש
                const hasMatch = rackData.some(item =>
                    item.equipment && item.equipment.toLowerCase().includes(searchTerm)
                );

                // מצאנו התאמה בארון זה
                if (hasMatch) {
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
    highlightRacks(rackIds) {
        // איפוס כל הסימונים הקודמים
        const allRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        allRacks.forEach(rack => {
            rack.classList.remove('search-result');
            rack.classList.remove('search-highlight');
        });

        // סימון הארונות שנמצאו
        rackIds.forEach(rackId => {
            const rackElement = document.querySelector(`.room[data-rack-id="${rackId}"], .rack[data-rack-id="${rackId}"]`);
            if (rackElement) {
                rackElement.classList.add('search-result');
            }
        });
    }

    /**
     * ניקוי החיפוש והסרת הסימונים
     */
    clearSearch() {
        const searchInput = document.getElementById('dataCenterSearchInput');
        const searchResultsInfo = document.getElementById('searchResultsInfo');

        // ניקוי שדה החיפוש
        searchInput.value = '';

        // הסתרת מידע על תוצאות החיפוש
        searchResultsInfo.style.display = 'none';

        // הסרת כל הסימונים
        const allRacks = document.querySelectorAll('.room.clickable, .rack.clickable');
        allRacks.forEach(rack => {
            rack.classList.remove('search-result');
            rack.classList.remove('search-highlight');
        });
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

            // הוספת כפתור להוספת ציוד חדש
            this.addEquipmentAddButton();

            // הוספת אירועי לחיצה ימנית לפריטי ציוד
            this.setupEquipmentContextMenu();
        } catch (error) {
            console.error('Error loading rack data:', error);
            document.getElementById('rackContainer').innerHTML =
                '<div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת נתוני הארון</div>';
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
            // וודא שיש לנו את כל הערכים הנדרשים
            const startPosition = item.startPosition || item.StartPosition || 0;
            const sizeUnits = item.size_units || item.SizeUnits || 1;
            const equipmentType = item.type || item.Type || 'other';
            const equipmentName = item.equipment || item.Equipment || 'ציוד לא ידוע';

            const colorStyle = '';
            // קביעת גודל פונט בהתאם לגודל הפריט
            const fontSize = sizeUnits <= 1 ? '9px' :
                sizeUnits <= 3 ? '10px' : '14px';

            // בדיקה אם הפריט מתאים לחיפוש
            const isMatch = searchTerm && equipmentName &&
                equipmentName.toLowerCase().includes(searchTerm.toLowerCase());

            // הוספת מחלקה לסימון אם הפריט מתאים לחיפוש
            const highlightClass = isMatch ? 'search-highlight-equipment' : '';

            // הוספת מחלקה לציון שהפריט לחיץ
            const clickableClass = 'clickable-equipment';

            // הוספת מיקום ה-U כמאפיין data-position
            html += `
        <div class="equipment-item pos-${startPosition} size-${sizeUnits} type-${equipmentType} ${highlightClass} ${clickableClass}" 
             data-position="${startPosition}" ${colorStyle} title="${equipmentName}">
            <div class="equipment-info">
                <div class="model-name" style="font-size: ${fontSize};" title="${equipmentName}">${equipmentName}</div>
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

        // בדיקה שיש נתונים לחדר השרתים הנוכחי
        if (!this.currentDataCenter || !this.racksData[this.currentDataCenter]) {
            container.innerHTML = '<div class="error-message">אין נתונים זמינים</div>';
            return;
        }

        // יצירת כרטיסיות לכל הארונות בחדר השרתים הנוכחי
        const rackIds = Object.keys(this.racksData[this.currentDataCenter]).sort();

        // בדיקה אם יש ארונות
        if (rackIds.length === 0) {
            container.innerHTML = '<div class="info-message">אין ארונות זמינים בחדר זה</div>';
            return;
        }
        // --- חלוקה לקבוצות לפי מה שלפני המקף ---
        const groups = {};
        rackIds.forEach(rackId => {
            // אם יש מקף, לוקחים את מה שלפניו (למשל A1). אם אין, לוקחים את הכל.
            const groupKey = rackId.includes('-') ? rackId.split('-')[0] : rackId;

            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(rackId);
        });

        // יצירת HTML לכל הארונות
        let html = '<div class="all-racks-grid">';
        let lastRow = null; // משתנה למעקב אחרי הקבוצה הנוכחית (A1, A2...)
        rackIds.forEach(rackId => {
            // חילוץ שם השורה: הכל לפני המקף (למשל "A1" מתוך "A1-2")
            const currentRow = rackId.includes('-') ? rackId.split('-')[0] : rackId.charAt(0);
            const rackData = this.racksData[this.currentDataCenter][rackId] || [];
            // אם עברנו לשורה חדשה, נוסיף כותרת מפרידה
            if (currentRow !== lastRow) {
                html += `<div class="row-separator" style="width: 100%; grid-column: 1 / -1; margin: 20px 0 10px 0; font-weight: bold; border-bottom: 1px solid #ccc;">שורה ${currentRow}</div>`;
                lastRow = currentRow;
            }
            html += `
    <div class="rack-container-wrapper">
        ${this.generateRackHTML(rackId, rackData)}
    </div>
    `;
        });
        html += '</div>';

        container.innerHTML = html;

        // הוספת מאזיני אירועים לפריטי ציוד בתצוגת כל הארונות
        const allEquipmentItems = container.querySelectorAll('.equipment-item');
        allEquipmentItems.forEach(item => {
            item.addEventListener('click', (event) => {
                // מניעת התפשטות האירוע לארון
                event.stopPropagation();

                // קבלת מזהה הציוד והארון
                const equipmentName = item.querySelector('.model-name').textContent;
                const rackId = item.closest('.rack-container-wrapper').querySelector('.rack-header').textContent;
                // הוספת קוד לקבלת מיקום ה-U מהמאפיין data-position
                const startPosition = parseInt(item.getAttribute('data-position') || item.classList.toString().match(/pos-(\d+)/)?.[1] || 0);

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
            NotificationManager.show('שגיאה בתהליך ההדפסה', 'error');
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
  * סינון ארונות לפי חיפוש
  */
    filterRacks() {
        const searchInput = document.getElementById('rackSearchInput');
        const filter = searchInput.value.toLowerCase();
        const cards = document.querySelectorAll('.rack-card');

        // בדיקה שיש נתונים לחדר השרתים הנוכחי
        if (!this.currentDataCenter || !this.racksData[this.currentDataCenter]) {
            return;
        }

        cards.forEach(card => {
            const rackId = card.querySelector('.rack-card-header').textContent;
            const rackData = this.racksData[this.currentDataCenter][rackId] || [];

            // בדיקה אם מזהה הארון מכיל את מחרוזת החיפוש
            const matchesRackId = rackId.toLowerCase().includes(filter);

            // בדיקה אם אחד מפריטי הציוד מכיל את מחרוזת החיפוש
            const matchesEquipment = rackData.some(item =>
                (item.equipment && item.equipment.toLowerCase().includes(filter)) ||
                (item.type && item.type.toLowerCase().includes(filter))
            );

            // הצגה או הסתרה בהתאם לתוצאות החיפוש
            if (matchesRackId || matchesEquipment) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
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
                NotificationManager.show('טוען ספריית צילום מסך...', 'info');

                // טעינת הספרייה
                const script = document.createElement('script');
                script.src = 'https://html2canvas.hertzen.com/dist/html2canvas.min.js';
                script.onload = () => {
                    // לאחר טעינת הספרייה, המשך בתהליך
                    this.captureAndPrintRack(rackContainer);
                };
                script.onerror = () => {
                    NotificationManager.show('שגיאה בטעינת ספריית צילום מסך', 'error');
                };
                document.head.appendChild(script);
            } else {
                // אם הספרייה כבר טעונה, המשך ישירות
                this.captureAndPrintRack(rackContainer);
            }
        } catch (error) {
            console.error('Error exporting rack data:', error);
            NotificationManager.show('שגיאה בייצוא נתוני הארון', 'error');
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
                NotificationManager.show(`שגיאה: מיקום U${startPosition} כבר תפוס או חלקו תפוס`, 'error');
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
                NotificationManager.show('הציוד נוסף בהצלחה', 'success');

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
                NotificationManager.show(`שגיאה בהוספת ציוד: ${data.error}`, 'error');
            }

            return data;
        } catch (error) {
            console.error('Error adding equipment:', error);
            NotificationManager.show('שגיאה בהוספת ציוד', 'error');
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
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });

            const data = await response.json();

            if (data.success) {
                NotificationManager.show('הציוד עודכן בהצלחה', 'success');

                // עדכון נתוני הארון בזיכרון המקומי
                if (this.racksData[params.dataCenterType] && this.racksData[params.dataCenterType][params.rackId]) {
                    const rackData = this.racksData[params.dataCenterType][params.rackId];

                    // מחיקת הציוד הישן
                    const indexToRemove = rackData.findIndex(item =>
                        item.startPosition === params.originalStartPosition &&
                        item.equipment === params.originalEquipment
                    );

                    if (indexToRemove !== -1) {
                        rackData.splice(indexToRemove, 1);
                    }

                    // הוספת הציוד המעודכן
                    rackData.push({
                        startPosition: params.newStartPosition,
                        size_units: params.newSizeUnits,
                        equipment: params.newEquipment,
                        type: this.determineEquipmentType(params.newEquipment)
                    });
                }

                // רענון תצוגת הארון
                await this.showRackDetails(params.rackId);
            } else {
                NotificationManager.show(`שגיאה בעדכון ציוד: ${data.error}`, 'error');
            }

            return data;
        } catch (error) {
            console.error('Error editing equipment:', error);
            NotificationManager.show('שגיאה בעדכון ציוד', 'error');
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
                NotificationManager.show('הציוד הוסר בהצלחה', 'success');

                // עדכון נתוני הארון בזיכרון המקומי
                if (this.racksData[dataCenterType] && this.racksData[dataCenterType][rackId]) {
                    const rackData = this.racksData[dataCenterType][rackId];

                    // מחיקת הציוד
                    const indexToRemove = rackData.findIndex(item =>
                        item.startPosition === startPosition &&
                        item.equipment === equipment
                    );

                    if (indexToRemove !== -1) {
                        rackData.splice(indexToRemove, 1);
                    }
                }

                // רענון תצוגת הארון
                await this.showRackDetails(rackId);
            } else {
                NotificationManager.show(`שגיאה בהסרת ציוד: ${data.error}`, 'error');
            }

            return data;
        } catch (error) {
            console.error('Error removing equipment:', error);
            NotificationManager.show('שגיאה בהסרת ציוד', 'error');
            throw error;
        }
    }

    /**
     * הצגת מודל להוספת/עריכת ציוד
     * @param {string} mode - 'add' או 'edit'
     * @param {Object} equipmentData - נתוני הציוד לעריכה (אופציונלי)
     */
    showEquipmentEditModal(mode, equipmentData = null) {
        // יצירת המודל אם לא קיים
        this.createEquipmentEditModal();

        const modal = document.getElementById('equipmentEditModal');
        const title = document.getElementById('equipmentEditTitle');
        const form = document.getElementById('equipmentEditForm');

        // איפוס הטופס
        form.reset();

        if (mode === 'add') {
            title.textContent = 'הוספת ציוד חדש';
            document.getElementById('equipmentEditSubmitBtn').textContent = 'הוסף ציוד';

            // הגדרת ערכי ברירת מחדל
            document.getElementById('equipmentRackId').value = this.currentRack?.id || '';
            document.getElementById('equipmentRackId').readOnly = true;
            document.getElementById('equipmentRackId').classList.add('readonly-field');

            document.getElementById('equipmentDataCenterType').value = this.currentDataCenter || '';
            document.getElementById('equipmentDataCenterType').readOnly = true;
            document.getElementById('equipmentDataCenterType').classList.add('readonly-field');

            document.getElementById('equipmentStartPosition').value = '';
            document.getElementById('equipmentSizeUnits').value = '1';
            document.getElementById('equipmentName').value = '';

            // הסתרת שדות עריכה
            document.getElementById('originalEquipmentFields').style.display = 'none';
        } else if (mode === 'edit' && equipmentData) {
            title.textContent = 'עריכת ציוד';
            document.getElementById('equipmentEditSubmitBtn').textContent = 'שמור שינויים';

            // מילוי הטופס בנתוני הציוד
            document.getElementById('equipmentRackId').value = this.currentRack?.id || '';
            document.getElementById('equipmentRackId').readOnly = true;
            document.getElementById('equipmentRackId').classList.add('readonly-field');

            document.getElementById('equipmentDataCenterType').value = this.currentDataCenter || '';
            document.getElementById('equipmentDataCenterType').readOnly = true;
            document.getElementById('equipmentDataCenterType').classList.add('readonly-field');

            document.getElementById('equipmentStartPosition').value = equipmentData.newStartPosition || equipmentData.startPosition;
            document.getElementById('equipmentSizeUnits').value = equipmentData.newSizeUnits || equipmentData.size_units;
            document.getElementById('equipmentName').value = equipmentData.newEquipment || equipmentData.equipment;

            // הצגת שדות עריכה
            document.getElementById('originalEquipmentFields').style.display = 'block';
            document.getElementById('originalStartPosition').readOnly = true;
            document.getElementById('originalStartPosition').classList.add('readonly-field');

            document.getElementById('originalEquipment').readOnly = true;
            document.getElementById('originalEquipment').classList.add('readonly-field');

            document.getElementById('originalStartPosition').value = equipmentData.startPosition;
            document.getElementById('originalEquipment').value = equipmentData.equipment;
        }

        // הצגת המודל
        modal.style.display = 'flex';
    }

    /**
     * יצירת מודל להוספת/עריכת ציוד
     */
    createEquipmentEditModal() {
        // בדיקה אם המודל כבר קיים
        if (document.getElementById('equipmentEditModal')) return;

        const modalHTML = `
    <div id="equipmentEditModal" class="modal-overlay">
        <div class="modal-content equipment-edit-modal">
            <div class="modal-header">
                <h3 id="equipmentEditTitle">הוספת/עריכת ציוד</h3>
                <button class="modal-close" onclick="dataCenterManager.closeEquipmentEditModal()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <form id="equipmentEditForm">
                    <div class="form-group">
                        <label for="equipmentDataCenterType">סוג חדר שרתים</label>
                        <input type="text" id="equipmentDataCenterType" class="form-input" readonly>
                    </div>
                    <div class="form-group">
                        <label for="equipmentRackId">מזהה ארון</label>
                        <input type="text" id="equipmentRackId" class="form-input" readonly>
                    </div>
                    <div id="originalEquipmentFields" style="display:none;">
                        <div class="form-group">
                            <label for="originalStartPosition">מיקום מקורי (U)</label>
                            <input type="number" id="originalStartPosition" class="form-input" readonly>
                        </div>
                        <div class="form-group">
                            <label for="originalEquipment">שם ציוד מקורי</label>
                            <input type="text" id="originalEquipment" class="form-input" readonly>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="equipmentName">שם הציוד</label>
                        <input type="text" id="equipmentName" class="form-input" required>
                    </div>
                    <div class="form-group">
                        <label for="equipmentStartPosition">מיקום התחלתי (U)</label>
                        <input type="number" id="equipmentStartPosition" class="form-input" min="1" max="42" required>
                        <div id="positionErrorMessage" class="position-error-message"></div>
                    </div>
                    <div class="form-group">
                        <label for="equipmentSizeUnits">גודל (יחידות U)</label>
                        <input type="number" id="equipmentSizeUnits" class="form-input" min="1" max="42" value="1" required>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button id="equipmentEditSubmitBtn" class="btn-primary" onclick="dataCenterManager.submitEquipmentEdit()">
                    הוסף ציוד
                </button>
                <button class="btn-secondary" onclick="dataCenterManager.closeEquipmentEditModal()">
                    ביטול
                </button>
            </div>
        </div>
    </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        // לאחר יצירת המודל, הוסף מאזין אירועים לשדה המיקום
        const modal = document.getElementById('equipmentEditModal');
        if (modal) {
            // After creating the modal, add event listeners to check position availability in real-time
            const startPositionInput = document.getElementById('equipmentStartPosition');
            const sizeUnitsInput = document.getElementById('equipmentSizeUnits');
            if (startPositionInput) {
                startPositionInput.addEventListener('change', () => this.checkPositionAvailability());
                startPositionInput.addEventListener('input', () => this.checkPositionAvailability());
            }

            if (sizeUnitsInput) {
                sizeUnitsInput.addEventListener('change', () => this.checkPositionAvailability());
                sizeUnitsInput.addEventListener('input', () => this.checkPositionAvailability());
            }
        }
    }

    async checkPositionAvailability() {
        const startPositionInput = document.getElementById('equipmentStartPosition');
        const sizeUnitsInput = document.getElementById('equipmentSizeUnits');
        const rackId = document.getElementById('equipmentRackId').value;
        const dataCenterType = document.getElementById('equipmentDataCenterType').value;
        const submitBtn = document.getElementById('equipmentEditSubmitBtn');
        const errorMessageElement = document.getElementById('positionErrorMessage');
        errorMessageElement.style.display = 'flex';

        // Check if all required fields are filled
        if (!startPositionInput || !sizeUnitsInput || !rackId || !dataCenterType) return;

        const startPosition = parseInt(startPositionInput.value);
        const sizeUnits = parseInt(sizeUnitsInput.value);

        // Check if values are valid
        if (isNaN(startPosition) || isNaN(sizeUnits)) {
            // Reset error message if exists
            startPositionInput.setCustomValidity('');
            if (errorMessageElement) {
                errorMessageElement.textContent = '';
                errorMessageElement.classList.remove('show');
            }
            return;
        }

        try {
            // Check if this is an add or edit operation
            const originalEquipmentFields = document.getElementById('originalEquipmentFields');
            const isEdit = originalEquipmentFields.style.display !== 'none';

            let checkUrl = `/DataCenter/CheckUPositionsAvailability?rackId=${rackId}&dataCenterType=${dataCenterType}&startPosition=${startPosition}&sizeUnits=${sizeUnits}`;

            // If editing, add original position to ignore in the check
            if (isEdit) {
                const originalStartPosition = parseInt(document.getElementById('originalStartPosition').value);
                const originalEquipment = document.getElementById('originalEquipment').value;
                checkUrl += `&originalStartPosition=${originalStartPosition}&originalEquipment=${encodeURIComponent(originalEquipment)}`;
            }

            const response = await fetch(checkUrl);
            const data = await response.json();

            // Calculate the range of units the equipment will occupy
            const endPosition = startPosition - sizeUnits + 1;

            if (!data.isAvailable) {
                // Check for overlap with existing equipment
                let errorMessage = `מיקום U${endPosition} עד U${startPosition} כבר תפוס או חלקו תפוס`;

                // Show error message inside the form
                startPositionInput.setCustomValidity(errorMessage);

                // Show error message below the field
                if (errorMessageElement) {
                    errorMessageElement.textContent = errorMessage;
                    errorMessageElement.classList.add('show');
                }

                // Disable submit button
                if (submitBtn) submitBtn.disabled = true;
            } else
                if (startPosition - sizeUnits < 0 || startPosition <= 0 || startPosition > 42 || sizeUnits <= 0) {

                    // Check for overlap with existing equipment
                    let errorMessage = `הציוד חורג מגודל הארון`;

                    // Show error message inside the form
                    startPositionInput.setCustomValidity(errorMessage);

                    // Show error message below the field
                    if (errorMessageElement) {
                        errorMessageElement.textContent = errorMessage;
                        errorMessageElement.classList.add('show');
                    }

                    // Disable submit button
                    if (submitBtn) submitBtn.disabled = true;
                } else {
                    // Reset error message and enable submit button
                    startPositionInput.setCustomValidity('');

                    // Hide error message below the field
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
        document.getElementById('equipmentEditModal').style.display = 'none';
        document.getElementById('positionErrorMessage').textContent = '';
        document.getElementById('positionErrorMessage').style.display = 'none';
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

        // חישוב טווח היחידות הנדרש
        const endPosition = startPosition - sizeUnits + 1;

        // בדיקה עבור כל פריט ציוד בארון
        for (const item of rackData) {
            // אם זה אותו פריט ציוד (במקרה של עדכון), נדלג עליו
            if (originalPosition !== null && item.startPosition === originalPosition) {
                continue;
            }

            // חישוב טווח היחידות של הפריט הנוכחי
            const itemEndPosition = item.startPosition - item.size_units + 1;

            // בדיקה אם יש חפיפה בין הטווחים
            // חפיפה מתרחשת כאשר:
            // 1. תחילת הטווח החדש נמצאת בתוך הטווח הקיים, או
            // 2. סוף הטווח החדש נמצא בתוך הטווח הקיים, או
            // 3. הטווח החדש מכיל את הטווח הקיים
            if ((startPosition <= item.startPosition && startPosition >= itemEndPosition) ||
                (endPosition <= item.startPosition && endPosition >= itemEndPosition) ||
                (startPosition >= item.startPosition && endPosition <= itemEndPosition)) {
                return false; // יש חפיפה, היחידות לא פנויות
            }
        }

        return true; // אין חפיפה, היחידות פנויות
    }

    /**
     * שליחת טופס הוספת/עריכת ציוד
     */
    async submitEquipmentEdit() {
        const form = document.getElementById('equipmentEditForm');
        const startPositionInput = document.getElementById('equipmentStartPosition');

        // בדיקת תקינות הטופס
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        // בדיקה נוספת של זמינות המיקום לפני שליחה
        await this.checkPositionAvailability();

        // אם יש הודעת שגיאה, אל תמשיך
        if (startPositionInput.validity.customError) {
            startPositionInput.reportValidity();
            return;
        }

        const rackId = document.getElementById('equipmentRackId').value;
        const dataCenterType = document.getElementById('equipmentDataCenterType').value;
        const startPosition = parseInt(document.getElementById('equipmentStartPosition').value);
        const sizeUnits = parseInt(document.getElementById('equipmentSizeUnits').value);
        const equipment = document.getElementById('equipmentName').value;

        // בדיקה אם זו הוספה או עריכה
        const originalEquipmentFields = document.getElementById('originalEquipmentFields');
        const isEdit = originalEquipmentFields.style.display !== 'none';

        // בדיקה מקדימה אם ה-U תפוס
        try {
            let checkUrl = `/DataCenter/CheckUPositionsAvailability?rackId=${rackId}&dataCenterType=${dataCenterType}&startPosition=${startPosition}&sizeUnits=${sizeUnits}`;

            // אם זו עריכה, נוסיף את המיקום המקורי כדי שהשרת יתעלם ממנו בבדיקה
            if (isEdit) {
                const originalStartPosition = parseInt(document.getElementById('originalStartPosition').value);
                const originalEquipment = document.getElementById('originalEquipment').value;
                checkUrl += `&originalStartPosition=${originalStartPosition}&originalEquipment=${encodeURIComponent(originalEquipment)}`;
            }

            const checkResponse = await fetch(checkUrl);
            const checkData = await checkResponse.json();

            if (!checkData.isAvailable) {
                NotificationManager.show(`שגיאה: מיקום U${startPosition} כבר תפוס או חלקו תפוס`, 'error');
                return;
            }

            if (!checkData.isAvailable) {
                NotificationManager.show(`שגיאה: מיקום U${startPosition} כבר תפוס או חלקו תפוס`, 'error');
                return;
            }

            if (isEdit) {
                // עריכת ציוד קיים
                const originalStartPosition = parseInt(document.getElementById('originalStartPosition').value);
                const originalEquipment = document.getElementById('originalEquipment').value;

                await this.editEquipment({
                    rackId,
                    dataCenterType,
                    originalStartPosition,
                    originalEquipment,
                    newStartPosition: startPosition,
                    newSizeUnits: sizeUnits,
                    newEquipment: equipment
                });
            } else {
                // הוספת ציוד חדש
                await this.addEquipment(rackId, dataCenterType, startPosition, sizeUnits, equipment);
            }

            // סגירת המודל
            this.closeEquipmentEditModal();
        } catch (error) {
            console.error('Error submitting equipment edit:', error);
            NotificationManager.show(`שגיאה בשמירת הציוד: ${error.message}`, 'error');
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
        // בדיקה אם הכפתור כבר קיים
        if (document.getElementById('addEquipmentBtn')) return;

        const rackTitle = document.getElementById('rackTitle');
        if (!rackTitle) return;

        // מציאת ה-header שמכיל את הכותרת
        const modalHeader = rackTitle.closest('.modal-header');
        if (!modalHeader) return;

        const addButton = document.createElement('button');
        addButton.id = 'addEquipmentBtn';
        addButton.className = 'add-equipment-btn';
        addButton.innerHTML = '<i class="fas fa-plus"></i> הוסף ציוד חדש';
        addButton.onclick = () => this.showEquipmentEditModal('add');

        // הוספת הכפתור לסוף ה-header
        modalHeader.appendChild(addButton);

        // עדכון סגנון ה-header כדי שיציג את הכפתור בצורה נכונה
        modalHeader.style.display = 'flex';
        modalHeader.style.flexDirection = 'column';
        modalHeader.style.alignItems = 'flex-start';
        modalHeader.style.gap = '10px';
    }

    /**
     * צילום מסך של הארון והדפסתו
     */
    captureAndPrintRack(rackContainer) {
        // הודעה למשתמש
        NotificationManager.show('מכין צילום מסך...', 'info');

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
            NotificationManager.show('מכין להדפסה...', 'info');

            // הסרת ה-iframe אחרי זמן קצר
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 2000);
        }).catch(error => {
            console.error('Error capturing rack screenshot:', error);
            NotificationManager.show('שגיאה בצילום מסך של הארון', 'error');
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

        // עדכון כותרת
        const title = document.getElementById('dataCenterTitle');
        title.textContent = dataCenterType === 'PT' ? 'מפת אתר פתח תקווה' : 'מפת אתר רמת גן';

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
            container.innerHTML = `<div class="error-message"><i class="fas fa-exclamation-triangle"></i> שגיאה בטעינת נתונים: ${error.message}</div>`;
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
            NotificationManager.show('הנתונים רועננו בהצלחה מהמקור', 'success');

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

// הוספת אירוע לטעינת הדף
document.addEventListener('DOMContentLoaded', () => {
    // אתחול מנהל חדר השרתים
    dataCenterManager.initialize();
});