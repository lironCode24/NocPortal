/**
 * RackMetricsDashboard - דשבורד מטריקות ארונות
 * מציג את כל הארונות עם צריכת חשמל וטמפרטורה בזמן אמת
 */
class RackMetricsDashboard {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.refreshInterval = null;
        this.REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 דקות
        this.racksMetrics = {}; // { rackId: { L: {...}, R: {...} } }
        this.isLoading = false;
        this.roomFilter = 'ALL'; // ALL, MAIN, STORAGE
        this.sortBy = 'allRacks'; // byRow, allRacks
        this.lastUpdated = null;
        this.countdownInterval = null;
        this.nextRefreshTime = null;
        this.STORAGE_KEY = 'rackMetricsDashboard_cache';
        this.STORAGE_TIMESTAMP_KEY = 'rackMetricsDashboard_cacheTime';
        this.CACHE_MAX_AGE_MS = 8 * 60 * 1000; // 8 דקות
    }

    /**
     * אתחול הדשבורד
     */
    initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container ${this.containerId} not found`);
            return;
        }

        this.renderLayout();

        const loadedFromCache = this.loadFromLocalStorage();

        if (loadedFromCache) {
            // יש קאש - הצג מיד וטען ברקע
            this.renderRacks();
            this.updateLastUpdatedDisplay();
            this.loadAllMetrics(true); // רענון ברקע
        } else {
            // אין קאש - טעינה רגילה עם spinner
            this.loadAllMetrics(false);
        }

        this.startAutoRefresh();
        this.startCountdown();
    }

    saveToLocalStorage() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.racksMetrics));
            localStorage.setItem(this.STORAGE_TIMESTAMP_KEY, Date.now().toString());
        } catch (e) {
            console.warn('Could not save to localStorage:', e);
        }
    }

    loadFromLocalStorage() {
        try {
            const timestamp = localStorage.getItem(this.STORAGE_TIMESTAMP_KEY);
            if (!timestamp) return false;

            const age = Date.now() - parseInt(timestamp);
            if (age > this.CACHE_MAX_AGE_MS) return false;

            const data = localStorage.getItem(this.STORAGE_KEY);
            if (!data) return false;

            const parsed = JSON.parse(data);
            if (!parsed || Object.keys(parsed).length === 0) return false;

            this.racksMetrics = parsed;
            this.lastUpdated = new Date(parseInt(timestamp));
            return true;
        } catch (e) {
            console.warn('Could not load from localStorage:', e);
            return false;
        }
    }

    showBackgroundError(message) {
        let toast = document.getElementById('rmdBgErrorToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'rmdBgErrorToast';
            toast.style.cssText = `
            position: fixed; bottom: 20px; left: 20px;
            background: #2a1515; border: 1px solid #dc3545;
            border-radius: 8px; padding: 8px 14px;
            color: #dc3545; font-size: 13px;
            display: flex; align-items: center; gap: 8px;
            z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        `;
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<i class="fas fa-exclamation-triangle"></i> עדכון ברקע נכשל - מוצגים נתונים קודמים`;
        setTimeout(() => { if (toast) toast.remove(); }, 5000);
    }

    /**
     * יצירת מבנה ה-HTML הראשי
     */
    renderLayout() {
        this.container.innerHTML = `
            <div class="rmd-wrapper">
                <!-- כותרת ובקרות -->
                <div class="rmd-toolbar">
                    <div class="rmd-toolbar-left">
                        <div class="rmd-filter-group">
                            <label>Room:</label>
                            <div class="rmd-btn-group">
                                <button class="rmd-filter-btn active" data-filter="ALL">All</button>
                                <button class="rmd-filter-btn" data-filter="STORAGE">Room A - STORAGE</button>
                                <button class="rmd-filter-btn" data-filter="MAIN">Room B - MAIN</button>
                                <!-- פתח תקווה - בהערה כרגע
                                <button class="rmd-filter-btn" data-filter="PT">PT</button>
                                -->
                            </div>
                        </div>
                        <div class="rmd-filter-group">
                            <label>Sort:</label>
                            <select class="rmd-sort-select" id="rmdSortSelect">
                                <option value="allRacks">All racks</option>
                                <option value="byRow">By row</option>
                            </select>
                        </div>
                    </div>
                    <div class="rmd-stats-bar">
                        <div class="rmd-stat-item">
                            <div class="rmd-stat-value" id="statTotalRacks">-</div>
                            <div class="rmd-stat-label">Total Racks</div>
                        </div>
                        <!--  תוספת: סך צריכת חשמל -->
                        <div class="rmd-stat-item rmd-stat-power">
                            <div class="rmd-stat-value" id="statTotalPower">-</div>
                            <div class="rmd-stat-label">
                                Total Power (kW)
                            </div>
                        </div>
                        <!--  תוספת: ממוצע חשמל לארון -->
                        <div class="rmd-stat-item">
                            <div class="rmd-stat-value" id="statAvgPower">-</div>
                            <div class="rmd-stat-label">Avg Power/Rack (W)</div>
                        </div>
                    </div>

                    <div class="rmd-datacenter-buttons">
                        <button id="dataCenterRGButton" class="rmd-datacenter-btn">
                            <i class="fas fa-server"></i>
                            <span>RG Racks Map</span>
                            <i class="fas fa-map-marked-alt rmd-btn-icon" aria-hidden="true" style="font-size:19px"></i>
                        </button>

                        <button id="dataCenterPTButton" class="rmd-datacenter-btn">
                            <i class="fas fa-server"></i>
                            <span>DR Racks Map</span>
                            <i class="fas fa-map-marked-alt rmd-btn-icon" aria-hidden="true"  style="font-size:19px"></i>
                        </button>
                    </div>
                    <div class="rmd-toolbar-right">
                        <div class="rmd-last-updated" id="rmdLastUpdated">
                            <i class="fas fa-clock"></i> טוען...
                        </div>
                    </div>
                </div>

                <!-- גריד הארונות -->
                <div class="rmd-grid" id="rmdGrid">
                    <div class="rmd-loading">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>טוען נתוני ארונות...</span>
                    </div>
                </div>
            </div>
        `;

        this.addStyles();
        this.setupEventListeners();
    }

    /**
     * הגדרת מאזיני אירועים
     */
    setupEventListeners() {
        // כפתורי סינון אתר
        this.container.querySelectorAll('.rmd-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.container.querySelectorAll('.rmd-filter-btn')
                    .forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.roomFilter = btn.getAttribute('data-filter');
                this.renderRacks();
            });
        });

        // בחירת מיון
        const sortSelect = document.getElementById('rmdSortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                this.sortBy = sortSelect.value;
                this.renderRacks();
            });
        }

        // ===== כפתורי DataCenter =====
        const rgBtn = this.container.querySelector('#dataCenterRGButton');
        if (rgBtn) {
            rgBtn.addEventListener('click', () => this.openDataCenter('RG'));
        }

        const ptBtn = this.container.querySelector('#dataCenterPTButton');
        if (ptBtn) {
            ptBtn.addEventListener('click', () => this.openDataCenter('PT'));
        }
    }

    async openDataCenter(dcType) {
        try {
            await this.ensureDataCenterManagerLoaded();

            if (!window.dataCenterManager) {
                console.error('DataCenterManager not available');
                return;
            }

            window.dataCenterManager.createDataCenterModal();
            window.dataCenterManager.createRackDetailsModal();

            await window.dataCenterManager.showDataCenter(dcType);

        } catch (error) {
            console.error(`Error opening DataCenter ${dcType}:`, error);
        }
    }

    async refreshMetricsCacheIfNeeded() {
        try {
            // תמיד עדכן את הקאש בכל רענון של הדשבורד
            const updateRes = await fetch('/Dashboards/UpdateMetricsCache');
            const updateData = await updateRes.json();
            return updateData;
        } catch (err) {
            console.error("Failed to refresh metrics cache:", err);
            return null;
        }
    }

    /**
     * טעינת מטריקות לכל הארונות
     */
    async loadAllMetrics(isBackgroundRefresh = false) {
        if (this.isLoading) return;
        this.isLoading = true;

        const grid = document.getElementById('rmdGrid');
        const hasExistingData = Object.keys(this.racksMetrics).length > 0;

        // הצג spinner רק אם אין נתונים קיימים
        if (!hasExistingData && !isBackgroundRefresh && grid) {
            grid.innerHTML = `
            <div class="rmd-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>טוען נתוני ארונות...</span>
            </div>`;
        }

        if (hasExistingData || isBackgroundRefresh) {
            this.showRefreshIndicator(true);
        }
        // timeout של 30 שניות
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 30 * 1000)
        );

        try {
            await Promise.race([
                this._doLoadAllMetrics(),
                timeoutPromise
            ]);

        } catch (error) {
            console.error('Error loading all metrics:', error);
            if (grid && !hasExistingData && !isBackgroundRefresh) {
                grid.innerHTML = `
                <div class="rmd-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>שגיאה בטעינת נתוני חיבורי חשמל וטמפרטורה בארונות</p>
                    <span style="font-size: 12px; color: #888; margin-top: 4px;">
                        ${error.message === 'timeout'
                        ? 'הטעינה ארכה יותר מדי זמן'
                        : error.message}
                    </span>
                </div>`;
            } else if (isBackgroundRefresh) {
                this.showBackgroundError(error.message);
            }
        } finally {
            this.isLoading = false;
            //  הסתר אינדיקטור רענון
            this.showRefreshIndicator(false);
        }
    }

    /**
 * הצגה/הסתרה של אינדיקטור רענון קטן (לא מחליף את הנתונים)
 */
    showRefreshIndicator(show) {
        let indicator = document.getElementById('rmdRefreshIndicator');

        if (show) {
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'rmdRefreshIndicator';
                indicator.innerHTML = `
                <i class="fas fa-sync-alt fa-spin"></i>
                <span>מעדכן נתונים...</span>
            `;
                indicator.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: #1e1e1e;
                border: 1px solid #320F5B;
                border-radius: 8px;
                padding: 8px 14px;
                color: #aaa;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
                z-index: 9999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                animation: rmd-fadeIn 0.3s ease;
            `;
                document.body.appendChild(indicator);
            }
        } else {
            if (indicator) {
                indicator.remove();
            }
        }
    }

    // הלוגיקה האמיתית של הטעינה - פונקציה נפרדת
    async _doLoadAllMetrics(isBackgroundRefresh = false) {
        await this.refreshMetricsCacheIfNeeded();
        await this.ensureDataCenterManagerLoaded();

        const allRacks = this.getAllRacksFromManager();

        if (allRacks.length === 0) {
            if (!isBackgroundRefresh) {
                const grid = document.getElementById('rmdGrid');
                if (grid) {
                    grid.innerHTML = `
                    <div class="rmd-empty">
                        <i class="fas fa-server"></i>
                        <p>לא נמצאו ארונות. ודא שה-DataCenterManager נטען.</p>
                    </div>`;
                }
            }
            return;
        }

        const BATCH_SIZE = 10;
        const newMetrics = {}; // *** חדש: אוסף נתונים חדשים בנפרד ***

        for (let i = 0; i < allRacks.length; i += BATCH_SIZE) {
            const batch = allRacks.slice(i, i + BATCH_SIZE);
            await Promise.allSettled(
                batch.map(rack => this.loadRackMetricsInto(rack.rackId, rack.dataCenterType, newMetrics))
            );

            // *** חדש: עדכון מדורג - אחרי כל batch מזג ורנדר ***
            if (Object.keys(newMetrics).length > 0) {
                Object.assign(this.racksMetrics, newMetrics);
                this.renderRacks();
            }
        }

        this.lastUpdated = new Date();
        this.updateLastUpdatedDisplay();
        this.renderRacks();
        this.resetCountdown();

        // *** חדש: שמור ב-localStorage ***
        this.saveToLocalStorage();
    }

    /**
     * וידוא שה-DataCenterManager נטען
     */
    async ensureDataCenterManagerLoaded() {
        // וודא שאנחנו תמיד משתמשים באותו instance
        if (typeof dataCenterManager !== 'undefined') {
            // השתמש ב-instance הגלובלי הקיים
            window.dataCenterManager = dataCenterManager;

            if (!window.dataCenterManager.isInitialized) {
                await window.dataCenterManager.initialize();
            }

            if (!window.dataCenterManager.dataLoadingStatus.PT ||
                !window.dataCenterManager.dataLoadingStatus.RG) {
                await window.dataCenterManager.preloadDataCentersData();
            }
            return;
        }

        if (typeof DataCenterManager !== 'undefined' && window.dataCenterManager) {
            if (!window.dataCenterManager.dataLoadingStatus.PT ||
                !window.dataCenterManager.dataLoadingStatus.RG) {
                await window.dataCenterManager.preloadDataCentersData();
            }
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/DataCenterManager.js';
            script.onload = async () => {
                // DataCenterManager.js יצור את dataCenterManager אוטומטית
                window.dataCenterManager = dataCenterManager;
                await window.dataCenterManager.preloadDataCentersData();
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load DataCenterManager'));
            document.head.appendChild(script);
        });
    }

    /**
     * קבלת רשימת כל הארונות מה-DataCenterManager
     * @returns {Array} - [{ rackId, dataCenterType }]
     */
    getAllRacksFromManager() {
        const racks = [];
        if (!window.dataCenterManager) return racks;

        const racksData = window.dataCenterManager.racksData;
        for (const dcType in racksData) {
            for (const rackId in racksData[dcType]) {
                racks.push({ rackId, dataCenterType: dcType });
            }
        }
        return racks;
    }

    getRoomByRackId(rackId, dataCenterType) {
        if (!rackId) return 'OTHER';
        // רק רמת גן יש חדרים
        if (dataCenterType !== 'RG') return 'OTHER';
        const firstChar = rackId.charAt(0).toUpperCase();
        if (firstChar === 'B') return 'MAIN';
        if (firstChar === 'A') return 'STORAGE';
        return 'OTHER';
    }

    /**
     * טעינת מטריקות לארון ספציפי
     * @param {string} rackId
     * @param {string} dataCenterType
     */
    async loadRackMetrics(rackId, dataCenterType) {
        try {
            // --- שלב 1: ניסיון להביא מהקאש ---
            const cacheUrlL = `/Dashboards/GetCurrentRackMetricsCached?rackId=${encodeURIComponent(rackId)}&dataCenterType=${dataCenterType}&side=L`;
            const cacheUrlR = `/Dashboards/GetCurrentRackMetricsCached?rackId=${encodeURIComponent(rackId)}&dataCenterType=${dataCenterType}&side=R`;

            const [cacheL, cacheR] = await Promise.all([
                fetch(cacheUrlL, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),  // הוסף cache: 'no-store'
                fetch(cacheUrlR, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)   // הוסף cache: 'no-store'
            ]);

            let lData = null;
            let rData = null;

            // אם יש נתונים מקאש – נשתמש בהם
            if (cacheL && cacheL.success) lData = cacheL;
            if (cacheR && cacheR.success) rData = cacheR;

            // --- שלב 2: אם אין בקאש → השתמש בברירת מחדל ריקה ---
            if (!lData) lData = { success: false };
            if (!rData) rData = { success: false };

            // שמירה רק אם יש נתונים לפחות מצד אחד
            const hasData =
                (lData.success && (lData.currentPower || lData.currentTemperature)) ||
                (rData.success && (rData.currentPower || rData.currentTemperature));

            if (hasData) {
                this.racksMetrics[`${dataCenterType}:${rackId}`] = {
                    rackId,
                    dataCenterType,
                    room: this.getRoomByRackId(rackId, dataCenterType),
                    L: lData,
                    R: rData,
                    maxTemperature: Math.max(lData.currentTemperature || 0, rData.currentTemperature || 0),
                    totalPower: (lData.currentPower || 0) + (rData.currentPower || 0),
                    status: this.calculateRackStatus(lData, rData)
                };
            }
        } catch (error) {
            console.warn(`Could not load metrics for rack ${rackId}:`, error);
        }
    }

    // פונקציה חדשה - כותבת לתוך אובייקט חיצוני במקום ישירות ל-this.racksMetrics
    async loadRackMetricsInto(rackId, dataCenterType, targetObj) {
        try {
            const cacheUrlL = `/Dashboards/GetCurrentRackMetricsCached?rackId=${encodeURIComponent(rackId)}&dataCenterType=${dataCenterType}&side=L`;
            const cacheUrlR = `/Dashboards/GetCurrentRackMetricsCached?rackId=${encodeURIComponent(rackId)}&dataCenterType=${dataCenterType}&side=R`;

            const [cacheL, cacheR] = await Promise.all([
                fetch(cacheUrlL, { cache: 'no-store' }).then(r => r.ok ? r.json() : null),
                fetch(cacheUrlR, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
            ]);

            let lData = (cacheL && cacheL.success) ? cacheL : { success: false };
            let rData = (cacheR && cacheR.success) ? cacheR : { success: false };

            const hasData =
                (lData.success && (lData.currentPower || lData.currentTemperature)) ||
                (rData.success && (rData.currentPower || rData.currentTemperature));

            if (hasData) {
                targetObj[`${dataCenterType}:${rackId}`] = {
                    rackId,
                    dataCenterType,
                    room: this.getRoomByRackId(rackId, dataCenterType),
                    L: lData,
                    R: rData,
                    maxTemperature: Math.max(lData.currentTemperature || 0, rData.currentTemperature || 0),
                    totalPower: (lData.currentPower || 0) + (rData.currentPower || 0),
                    status: this.calculateRackStatus(lData, rData)
                };
            }
        } catch (error) {
            console.warn(`Could not load metrics for rack ${rackId}:`, error);
        }
    }

    /**
     * חישוב סטטוס הארון (critical/warning/normal)
     */
    calculateRackStatus(metricsL, metricsR) {
        const temps = [
            metricsL.currentTemperature,
            metricsR.currentTemperature
        ].filter(t => t !== null && t !== undefined);

        const maxTemp = temps.length > 0 ? Math.max(...temps) : null;

        if (maxTemp !== null) {
            if (maxTemp >= 29) return 'critical';
            if (maxTemp >= 27) return 'warning';
        }

        // const totalPower = (metricsL.currentPower || 0) + (metricsR.currentPower || 0);
        // if (totalPower >= 2000) return 'critical';
        // if (totalPower >= 1000) return 'warning';

        return 'normal';
    }

    /**
     * רינדור גריד הארונות
     */
    renderRacks() {
        const grid = document.getElementById('rmdGrid');
        if (!grid) return;

        let racks = Object.values(this.racksMetrics);

        // סינון לפי חדר
        if (this.roomFilter !== 'ALL') {
            racks = racks.filter(r => r.room === this.roomFilter);
        }

        this.updateStats(racks);

        if (racks.length === 0) {
            grid.innerHTML = `
        <div class="rmd-empty">
            <i class="fas fa-exclamation-triangle"></i>
            <p>שגיאה בטעינת נתוני חיבורי חשמל וטמפרטורה בארונות</p>
        </div>
        `;
            return;
        }

        let html = '';

        if (this.sortBy === 'allRacks') {
            // כל הארונות ביחד A-Z
            const sortedRacks = [...racks].sort((a, b) =>
                a.rackId.localeCompare(b.rackId, 'he', { numeric: true })
            );

            html += `
        <div class="rmd-dc-section">
            <div class="rmd-dc-title">
                <i class="fas fa-list"></i>
                All Racks
                <span class="rmd-dc-count">${sortedRacks.length} Racks</span>
            </div>
            <div class="rmd-row-grid">`;

            sortedRacks.forEach(rack => {
                html += this.renderRackCard(rack);
            });

            html += `</div></div>`;

        } else {
            // לפי שורה
            const grouped = this.groupRacks(racks);

            for (const dcType in grouped) {
                const dcLabel = dcType === 'PT' ? 'PT' : 'RG';
                const totalRacks = Object.values(grouped[dcType])
                    .reduce((sum, rowRacks) => sum + rowRacks.length, 0);

                html += `
            <div class="rmd-dc-section">
                <div class="rmd-dc-title">
                    <i class="fas fa-building"></i>
                    ${dcLabel}
                    <span class="rmd-dc-count">${totalRacks} Racks</span>
                </div>`;

                const sortedRows = Object.keys(grouped[dcType]).sort();

                sortedRows.forEach(rowKey => {
                    const rowRacks = grouped[dcType][rowKey];

                    const sortedRowRacks = [...rowRacks].sort((a, b) =>
                        a.rackId.localeCompare(b.rackId, 'he', { numeric: true })
                    );


                    html += `
                <div class="rmd-row-section">
                    <div class="rmd-row-header">
                        <i class="fas fa-grip-lines"></i>
                        ${rowKey}
                        <span class="rmd-row-count">${sortedRowRacks.length} Racks</span>
                    </div>
                    <div class="rmd-row-grid">`;

                    sortedRowRacks.forEach(rack => {
                        html += this.renderRackCard(rack);
                    });

                    html += `</div></div>`;
                });

                html += `</div>`;
            }
        }

        grid.innerHTML = html;

        grid.querySelectorAll('.rmd-rack-card').forEach(card => {
            card.addEventListener('click', () => {
                const rackId = card.getAttribute('data-rack-id');
                const dcType = card.getAttribute('data-dc-type');
                this.openRackDetails(rackId, dcType);
                document.querySelector('#rackDetailsModal .btn-primary').style.display = "none";
            });
        });
    }

    /**
     * קיבוץ לפי אתר ושורה
     */
    groupRacks(racks) {
        const grouped = {};
        racks.forEach(rack => {
            const dcType = rack.dataCenterType;
            if (!grouped[dcType]) {
                grouped[dcType] = {};
            }

            // חילוץ שם השורה מתוך מזהה הארון
            // רמת גן: B1-2 → שורה B1 | פתח תקווה: B2 → שורה B
            const rowKey = rack.rackId.includes('-')
                ? rack.rackId.split('-')[0]      // RG: A1, B2, B3...
                : rack.rackId.charAt(0);          // PT: A, B, C...

            if (!grouped[dcType][rowKey]) {
                grouped[dcType][rowKey] = [];
            }
            grouped[dcType][rowKey].push(rack);
        });
        return grouped;
    }

    /**
 * יצירת HTML לכרטיס ארון
 */
    renderRackCard(rack) {

        const maxTemp = rack.maxTemperature;
        let borderColor = '#2a4a2a';
        let bgColor = '#1e1e1e';
        let glowColor = 'transparent';

        if (maxTemp >= 29) {
            borderColor = '#dc3545';
            glowColor = 'rgba(220,53,69,0.3)';
        } else if (maxTemp >= 27) {
            borderColor = '#fd7e14';
            glowColor = 'rgba(253,126,20,0.3)';
        } else if (maxTemp > 0) {
            borderColor = '#6c8ebf';
            glowColor = 'rgba(25,135,84,0.2)';
        }

        const statusIcon = maxTemp >= 29 ? 'fa-exclamation-circle' :
            maxTemp >= 27 ? 'fa-exclamation-triangle' :
                'fa-check-circle';

        const statusIconColor = maxTemp >= 29 ? '#dc3545' :
            maxTemp >= 27 ? '#fd7e14' :
                '#6c8ebf';

        // נתוני צד שמאל
        const lTemp = rack.L?.currentTemperature;
        const lPower = rack.L?.currentPower;
        const lHasData = rack.L?.success && (lTemp || lPower);

        // נתוני צד ימין
        const rTemp = rack.R?.currentTemperature;
        const rPower = rack.R?.currentPower;
        const rHasData = rack.R?.success && (rTemp || rPower);

        return `
<div class="rmd-rack-card ${rack.status}"
     data-rack-id="${rack.rackId}"
     data-dc-type="${rack.dataCenterType}"
     title="לחץ לפתיחת פרטי הארון"
     style="
         border-color: ${borderColor};
         background-color: ${bgColor};
         box-shadow: 0 0 8px ${glowColor};
     ">

    <!-- כותרת הכרטיס -->
    <div class="rmd-card-header">
        <div class="rmd-card-title">
            <i class="fas fa-server"></i>
            <span>${rack.rackId}</span>
        </div>
        <div class="rmd-card-status">
            <i class="fas ${statusIcon}"
               style="color: ${statusIconColor};
               ${maxTemp >= 29 ? 'animation: rmd-pulse 1.5s infinite;' : ''}">
            </i>
        </div>
    </div>

    <!-- אזור תלת-מימד: מטריקות + ארון + מטריקות -->
    <div class="rmd-3d-zone">

        <!-- צד שמאל: מטריקות L -->
        <div class="rmd-side-panel rmd-side-left">
            ${lHasData ? `
                <div class="rmd-side-badge">L</div>
                ${lTemp ? `
                <div class="rmd-side-metric-row ${this.getTempClass(lTemp)}">
                    <span>${lTemp.toFixed(1)}°C</span>
                    <i class="fas fa-thermometer-half"></i>
                </div>` : ''}
                ${lPower ? `
                <div class="rmd-side-metric-row ${this.getPowerClass(lPower)}">
                    <span>${lPower.toFixed(0)}W</span>
                    <i class="fas fa-bolt"></i>
                </div>` : ''}
            ` : '<div class="rmd-side-nodata">—</div>'}
        </div>

        <!-- מרכז: ארון תלת-מימד -->
        <div class="rmd-rack-3d-wrap">
            <div class="rmd-rack-3d" style="--rack-border: ${borderColor}; --rack-glow: ${glowColor};">

                <!-- פנל עליון (גג) -->
                <div class="rmd-rack-top"></div>

                <!-- פנל צד (עומק) -->
                <div class="rmd-rack-side"></div>

                <!-- פנל קדמי (חזית) -->
                <div class="rmd-rack-front">
                    <!-- יחידות שרת בתוך הארון -->
                    <div class="rmd-rack-unit ${rack.status}"></div>
                    <div class="rmd-rack-unit ${rack.status}"></div>
                    <div class="rmd-rack-unit ${rack.status}"></div>
                    <div class="rmd-rack-unit-gap"></div>
                    <div class="rmd-rack-unit ${rack.status}"></div>
                    <div class="rmd-rack-unit ${rack.status}"></div>
                    <div class="rmd-rack-unit-gap"></div>
                    <div class="rmd-rack-unit ${rack.status}"></div>
                </div>
            </div>
            <!-- צל תחתון -->
            <div class="rmd-rack-shadow" style="--glow: ${glowColor};"></div>
        </div>

        <!-- צד ימין: מטריקות R -->
        <div class="rmd-side-panel rmd-side-right">
            ${rHasData ? `
                <div class="rmd-side-badge">R</div>
                ${rTemp ? `
                <div class="rmd-side-metric-row ${this.getTempClass(rTemp)}">
                    <span>${rTemp.toFixed(1)}°C</span>
                    <i class="fas fa-thermometer-half"></i>
                </div>
                ` : ''}
                ${rPower ? `
                <div class="rmd-side-metric-row ${this.getPowerClass(rPower)}">
                    <span>${rPower.toFixed(0)}W</span>
                    <i class="fas fa-bolt"></i>
                </div>` : ''}
            ` : '<div class="rmd-side-nodata">—</div>'}
        </div>
    </div><!-- /rmd-3d-zone -->

    <!-- סיכום צריכת חשמל -->
    <div class="rmd-card-power-summary">
        <div class="rmd-power-total">
             Total Power: <strong class="${this.getWorstPowerClass(lPower, rPower)}-power">${rack.totalPower.toFixed(0)}W<i class="fas fa-bolt"></i></strong>
        </div>
    </div>
</div>`;
    }

    /**
     * רינדור סרגל טמפרטורה
     */
    renderTempBar(temp) {
        if (!temp) return '<div class="rmd-bar-empty">N/A</div>';
        const pct = Math.min((temp / 35) * 100, 100);
        const color = temp >= 29 ? '#dc3545' : temp >= 27 ? '#fd7e14' : '#0d6efd';
        return `
            <div class="rmd-bar-container" title="טמפרטורה: ${temp.toFixed(1)}°C">
                <div class="rmd-bar-fill" style="height:${pct}%; background:${color};"></div>
                <div class="rmd-bar-label">${temp.toFixed(1)}°</div>
            </div>`;
    }

    /**
     * רינדור סרגל צריכת חשמל
     */
    renderPowerBar(power) {
        if (!power) return '<div class="rmd-bar-empty">N/A</div>';
        const pct = Math.min((power / 3000) * 100, 100);
        const color = power >= 2000 ? '#dc3545' : power >= 1000 ? '#fd7e14' : '#0d6efd';
        return `
            <div class="rmd-bar-container" title="צריכת חשמל: ${power.toFixed(0)}W">
                <div class="rmd-bar-fill" style="height:${pct}%; background:${color};"></div>
                <div class="rmd-bar-label">${power.toFixed(0)}W</div>
            </div>`;
    }

    /**
     * קבלת class לפי טמפרטורה
     */
    getTempClass(temp) {
        if (temp >= 29) return 'critical';
        if (temp >= 27) return 'warning';
        return 'normal temp';
    }

    /**
     * קבלת class לפי הספק
     */
    getPowerClass(power) {
        if (power >= 1000) return 'critical';
        if (power >= 500) return 'warning';
        if (power >= 100) return 'caution';
        return 'normal';
    }

    /**
 * קבלת class הכי חמור מבין שני הצדדים
 */
    getWorstPowerClass(lPower, rPower) {
        const lClass = this.getPowerClass(lPower || 0);
        const rClass = this.getPowerClass(rPower || 0);

        const severity = {
            'critical': 3,
            'warning': 2,
            'caution': 1,
            'normal': 0
        };

        return severity[lClass] >= severity[rClass] ? lClass : rClass;
    }

    /**
     * עדכון סטטיסטיקות
     */
    /**
 * עדכון סטטיסטיקות - כולל חישוב מלא של מטריקות חשמל
 */
    updateStats(racks) {
        const total = racks.length;
        const critical = racks.filter(r => r.status === 'critical').length;
        const warning = racks.filter(r => r.status === 'warning').length;

        // --- טמפרטורה ---
        const temps = racks
            .map(r => r.maxTemperature)
            .filter(t => t > 0);
        const avgTemp = temps.length > 0
            ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)
            : '-';

        // ---  חשמל: סך הכל ---
        const racksWithPower = racks.filter(r => r.totalPower > 0);
        const totalPowerW = racksWithPower.reduce((sum, r) => sum + (r.totalPower || 0), 0);
        const totalPowerKw = (totalPowerW / 1000).toFixed(2);

        // ---  חשמל: ממוצע לארון (רק ארונות עם נתונים) ---
        const avgPower = racksWithPower.length > 0
            ? (totalPowerW / racksWithPower.length).toFixed(0)
            : '-';

        // ---  חשמל: ארון עם הצריכה הגבוהה ביותר ---
        let topPowerRack = '-';
        if (racksWithPower.length > 0) {
            const topRack = racksWithPower.reduce((max, r) =>
                (r.totalPower > max.totalPower ? r : max), racksWithPower[0]);
            topPowerRack = `${topRack.rackId} (${topRack.totalPower.toFixed(0)}W)`;
        }

        // --- עדכון DOM ---
        const el = id => document.getElementById(id);

        if (el('statTotalRacks')) el('statTotalRacks').textContent = total;
        if (el('statCriticalRacks')) el('statCriticalRacks').textContent = critical;
        if (el('statWarningRacks')) el('statWarningRacks').textContent = warning;
        if (el('statAvgTemp')) el('statAvgTemp').textContent = avgTemp;

        //  עדכון שדות חשמל
        if (el('statTotalPower')) {
            el('statTotalPower').textContent = `${totalPowerKw} kW`;

            // צביעה לפי עומס
            el('statTotalPower').className = 'rmd-stat-value';
            if (totalPowerW >= 50000) el('statTotalPower').classList.add('rmd-power-critical');
            else if (totalPowerW >= 25000) el('statTotalPower').classList.add('rmd-power-warning');
        }

        if (el('statTotalPowerKw')) {
            el('statTotalPowerKw').textContent = `= ${totalPowerKw} kW`;
        }

        if (el('statAvgPower')) {
            el('statAvgPower').textContent = avgPower + "W";
        }

        if (el('statTopPowerRack')) {
            el('statTopPowerRack').textContent = topPowerRack;
        }
    }

    /**
     * עדכון תצוגת זמן עדכון אחרון
     */
    updateLastUpdatedDisplay() {
        const el = document.getElementById('rmdLastUpdated');
        if (el && this.lastUpdated) {
            el.innerHTML = `<i class="fas fa-clock"></i> Updated: ${this.lastUpdated.toLocaleTimeString('he-IL')}`;
        }
    }

    /**
 * פתיחת פרטי ארון ב-DataCenterManager
 */
    async openRackDetails(rackId, dataCenterType) {
        if (!window.dataCenterManager) {
            console.error('DataCenterManager not available');
            return;
        }

        try {
            // וידוא שה-DataCenterManager אותחל (יוצר את המודלים)
            if (!window.dataCenterManager.isInitialized) {
                window.dataCenterManager.initialize();
            }

            // וידוא שמודל פרטי הארון קיים ב-DOM
            window.dataCenterManager.createRackDetailsModal();

            // הגדרת החדר הנוכחי
            window.dataCenterManager.currentDataCenter = dataCenterType;

            // וידוא שנתוני הארון נטענו
            if (!window.dataCenterManager.dataLoadingStatus[dataCenterType]) {
                // הצגת הודעת טעינה בתוך המודל
                const rackDetailsModal = document.getElementById('rackDetailsModal');
                if (rackDetailsModal) {
                    rackDetailsModal.style.display = 'flex';
                }

                const rackContainer = document.getElementById('rackContainer');
                if (rackContainer) {
                    rackContainer.innerHTML = `
                    <div class="loading-spinner">
                        <i class="fas fa-spinner fa-spin"></i>
                        <span>טוען נתוני חדר שרתים...</span>
                    </div>`;
                }

                const titleEl = document.getElementById('rackTitle');
                if (titleEl) {
                    titleEl.textContent = `ארון ${rackId}`;
                }

                await window.dataCenterManager.loadRacksData(dataCenterType);
            }

            // פתיחת פרטי הארון
            await window.dataCenterManager.showRackDetails(rackId);

            // *** הסתרת כפתור הדפסה בדשבורד ***
            const printBtn = document.querySelector(
                '#rackDetailsModal .modal-footer .btn-primary'
            );
            if (printBtn) printBtn.style.display = 'none';

        } catch (error) {
            console.error('Error opening rack details:', error);
        }
    }

    /**
     * התחלת רענון אוטומטי
     */
    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => {
            this.loadAllMetrics(true);
        }, this.REFRESH_INTERVAL_MS);
    }

    /**
     * עצירת רענון אוטומטי
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * התחלת ספירה לאחור לרענון הבא
     */
    startCountdown() {
        this.nextRefreshTime = Date.now() + this.REFRESH_INTERVAL_MS;
        this.countdownInterval = setInterval(() => {
            const remaining = Math.max(0, this.nextRefreshTime - Date.now());
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            const el = document.getElementById('rmdCountdownTimer');
            if (el) {
                el.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }

    /**
     * איפוס ספירה לאחור
     */
    resetCountdown() {
        this.nextRefreshTime = Date.now() + this.REFRESH_INTERVAL_MS;
    }

    /**
     * הוספת סגנונות CSS
     */
    addStyles() {
        if (document.getElementById('rmdStyles')) return;

        const style = document.createElement('style');
        style.id = 'rmdStyles';
        style.textContent = `
        /* ===== WRAPPER ===== */
        .rmd-wrapper {
            background: #121212;
            min-height: calc(100vh - 60px);
            padding: 16px;
            color: #e0e0e0;
            font-family: Arial, sans-serif;
            direction: rtl;
        }

        /* ===== TOOLBAR ===== */
        .rmd-toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 12px 16px;
            margin-bottom: 12px;
            flex-wrap: wrap;
            gap: 10px;
            direction: ltr;
        }
        .rmd-toolbar-left,
        .rmd-toolbar-right {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .rmd-filter-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .rmd-filter-group label {
            color: #aaa;
            font-size: 13px;
            white-space: nowrap;
        }
        .rmd-btn-group {
            display: flex;
            gap: 4px;
        }
        .rmd-filter-btn {
            padding: 5px 12px;
            background: #2c2c2c;
            color: #aaa;
            border: 1px solid #444;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: all 0.2s;
        }
        .rmd-filter-btn:hover {
            background: #3a3a3a;
            color: #fff;
        }
        .rmd-filter-btn.active {
            background: #320F5B;
            color: #fff;
            border-color: #5a1a9a;
        }
        .rmd-sort-select {
            background: #2c2c2c;
            color: #e0e0e0;
            border: 1px solid #444;
            border-radius: 4px;
            padding: 5px 10px;
            font-size: 13px;
            cursor: pointer;
        }
        .rmd-last-updated {
            color: #888;
            font-size: 12px;
            white-space: nowrap;
        }
        .rmd-countdown {
            color: #888;
            font-size: 12px;
            white-space: nowrap;
        }
        .rmd-countdown span {
            color: #aaa;
            font-weight: bold;
        }
        .rmd-refresh-btn {
            padding: 6px 14px;
            background: #320F5B;
            color: #fff;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: background 0.2s;
            white-space: nowrap;
        }
        .rmd-refresh-btn:hover {
            background: #4a1a8c;
        }
        .rmd-refresh-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }

        /* ===== STATS BAR ===== */
        .rmd-stats-bar {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        .rmd-stat-item {
            flex: 1;
            min-width: 200px;
            background: #1e1e1e;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 5px 5px;
            text-align: center;
        }
        .rmd-stat-item.critical {
            border-color: #dc3545;
        }
        .rmd-stat-item.warning {
            border-color: #fd7e14;
        }

        .rmd-stat-value {
            font-size: 18px;
            font-weight: bold;
            color: #fff;
        }
        .rmd-stat-item.critical .rmd-stat-value {
            color: #dc3545;
        }
        .rmd-stat-item.warning .rmd-stat-value {
            color: #fd7e14;
        }
        .rmd-stat-label {
            font-size: 11px;
            color: #888;
        }

        /* ===== DC SECTION ===== */
        .rmd-dc-section {
            margin-bottom: 24px;
        }
        .rmd-dc-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 16px;
            font-weight: bold;
            color: #ccc;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #333;
            direction: ltr;
        }
        .rmd-dc-count {
            font-size: 12px;
            color: #888;
            font-weight: normal;
            background: #2c2c2c;
            padding: 2px 8px;
            border-radius: 10px;
        }
        .rmd-dc-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 12px;
        }

        /* ===== RACK CARD ===== */
        .rmd-rack-card {
            background: #1e1e1e;
            border: 2px solid #333;
            border-radius: 10px;
            padding: 12px;
            cursor: pointer;
            transition: all 0.25s;
            display: flex;
            flex-direction: column;
            gap: 8px;
            position: relative;
            overflow: hidden;
        }
        .rmd-rack-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 20px rgba(0,0,0,0.4);
            border-color: #555;
        }
        .rmd-rack-card.critical {
            border-color: #dc3545;
            background: #1e1212;
        }
        .rmd-rack-card.critical:hover {
            box-shadow: 0 6px 20px rgba(220,53,69,0.3);
        }
        .rmd-rack-card.warning {
            border-color: #fd7e14;
            background: #1e1a12;
        }
        .rmd-rack-card.warning:hover {
            box-shadow: 0 6px 20px rgba(253,126,20,0.3);
        }
        .rmd-rack-card.normal {
            border-color: #6c8ebf;
        }

        /* ===== CARD HEADER ===== */
        .rmd-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .rmd-card-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: bold;
            font-size: 14px;
            color: #fff;
        }
        .rmd-card-title i {
            color: #888;
            font-size: 12px;
        }
        .rmd-card-status i {
            font-size: 16px;
        }
        .rmd-rack-card.critical .rmd-card-status i {
            color: #dc3545;
            animation: rmd-pulse 1.5s infinite;
        }
        .rmd-rack-card.warning .rmd-card-status i {
            color: #fd7e14;
        }
        .rmd-rack-card.normal .rmd-card-status i {
            color: #0d6efd;
        }
        @keyframes rmd-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
        }

        /* ===== 3D ZONE ===== */
        .rmd-3d-zone {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            padding: 4px 0;
        }

        /* ===== SIDE PANELS (מטריקות ימין/שמאל) ===== */
        .rmd-side-panel {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            flex: 1;
            min-width: 0;
            bottom: 4px;
            margin-left: 4px;
            position: relative;
        }
        .rmd-side-badge {
            font-size: 9px;
            font-weight: bold;
            color: #888;
            background: #2c2c2c;
            border-radius: 3px;
            padding: 1px 5px;
            letter-spacing: 0.5px;
        }
        .rmd-side-metric-row {
            display: flex;
            align-items: center;
            gap: 3px;
            font-size: 14px;
            font-weight: bold;
            white-space: nowrap;
        }
        .rmd-side-metric-row i {
            font-size: 9px;
        }
        .rmd-side-metric-row.critical { color: #dc3545; }
        .rmd-side-metric-row.warning  { color: #fd7e14; }
        .rmd-side-metric-row.caution   { color: #ffeb3b; }
        .rmd-side-metric-row.normal   { color: white; }
        .rmd-side-metric-row.normal.temp  { color: #0d6efd; }

        .rmd-side-nodata {
            color: #444;
            font-size: 14px;
            margin: auto;
        }

        /* ===== 3D RACK ===== */
        .rmd-rack-3d-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex-shrink: 0;
            right: 2px;
            position: relative;
        }

        /* קונטיינר תלת-מימד */
        .rmd-rack-3d {
            position: relative;
            width: 45px;
            height: 88px;
        }

        /* פנל קדמי */
        .rmd-rack-front {
            position: absolute;
            inset: 0;
            background: linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%);
            border: 2.5px solid var(--rack-border, #444);
            border-radius: 3px 3px 2px 2px;
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 6px 5px 5px;
            overflow: hidden;
            z-index: 2;
        }

        /* פנל עליון (גג) */
        .rmd-rack-top {
            position: absolute;
            top: -10px;
            width: 45px;
            height: 10px;
            background: linear-gradient(90deg, #3a3a3a, #2a2a2a);
            border: 2.5px solid var(--rack-border, #444);
            border-bottom: none;
            border-radius: 3px 3px 0 0;
            transform: skewX(-45deg);
            transform-origin: bottom left;
            z-index: 3;
        }

        /* פנל צד (עומק) */
        .rmd-rack-side {
            position: absolute;
            right: -9px;
            width: 10px;
            height: 100%;
            background: linear-gradient(180deg, #252525, #181818);
            border: 2.5px solid var(--rack-border, #444);
            border-left: none;
            transform: skewY(-45deg);
            transform-origin: top left;
            z-index: 1;
        }

        /* יחידות שרת בתוך הארון */
        .rmd-rack-unit {
            height: 8px;
            border-radius: 1px;
            background: #333;
            border: 1px solid #444;
            position: relative;
            flex-shrink: 0;
        }
        .rmd-rack-unit::before {
            content: '';
            position: absolute;
            right: 3px;
            top: 50%;
            transform: translateY(-50%);
            width: 4px;
            height: 4px;
            border-radius: 50%;
            background: #555;
        }
        .rmd-rack-unit::after {
            content: '';
            position: absolute;
            left: 4px;
            top: 2px;
            width: 60%;
            height: 2px;
            background: #3a3a3a;
            border-radius: 1px;
        }

        /* צבע יחידות לפי סטטוס */
        .rmd-rack-unit.critical {
            background: #2a1515;
            border-color: #dc354540;
        }
        .rmd-rack-unit.critical::before {
            background: #dc3545;
            box-shadow: 0 0 4px #dc3545;
            animation: rmd-pulse 1.5s infinite;
        }
        .rmd-rack-unit.warning {
            background: #2a1e10;
            border-color: #fd7e1440;
        }
        .rmd-rack-unit.warning::before {
            background: #fd7e14;
            box-shadow: 0 0 4px #fd7e14;
        }
        .rmd-rack-unit.normal {
            background: #101a2a;
            border-color: #0d6efd40;
        }
        .rmd-rack-unit.normal::before {
            background: #0d6efd;
            box-shadow: 0 0 3px #0d6efd;
        }

        /* רווח בין קבוצות יחידות */
        .rmd-rack-unit-gap {
            height: 3px;
            flex-shrink: 0;
        }

        /* LED תחתון */
        .rmd-rack-led {
            position: absolute;
            bottom: 5px;
            left: 5px;
            width: 5px;
            height: 5px;
            border-radius: 50%;
        }
        .rmd-rack-led.critical {
            background: #dc3545;
            box-shadow: 0 0 6px #dc3545;
            animation: rmd-pulse 1.5s infinite;
        }
        .rmd-rack-led.warning {
            background: #fd7e14;
            box-shadow: 0 0 6px #fd7e14;
        }
        .rmd-rack-led.normal {
            background: #0d6efd;
            box-shadow: 0 0 4px #0d6efd;
        }

        /* צל תחתון */
        .rmd-rack-shadow {
            width: 60px;
            height: 8px;
            background: radial-gradient(ellipse, var(--glow, rgba(0,0,0,0.4)) 0%, transparent 70%);
            margin-top: 2px;
            border-radius: 50%;
        }
        
        /* ===== CARD FOOTER ===== */
        .rmd-card-footer {
            text-align: center;
            border-top: 1px solid #2c2c2c;
            padding-top: 6px;
        }
        .rmd-open-hint {
            font-size: 11px;
            color: #555;
            transition: color 0.2s;
        }
        .rmd-rack-card:hover .rmd-open-hint {
            color: #888;
        }

        /* ===== STATES ===== */
        .rmd-loading,
        .rmd-empty,
        .rmd-error {
            grid-column: 1 / -1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 60px 20px;
            color: #666;
            font-size: 16px;
        }
        .rmd-loading i,
        .rmd-empty i {
            font-size: 40px;
            color: #444;
        }
        .rmd-error {
            color: #dc3545;
        }
        .rmd-error i {
            font-size: 40px;
        }
        /* ===== ROW SECTION ===== */
        .rmd-row-section {
            margin-bottom: 16px;
        }

        .rmd-row-header {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            font-weight: bold;
            color: #bbb;
            margin-bottom: 8px;
            padding: 6px 12px;
            background: #252525;
            border-radius: 6px;
            border-right: 3px solid #320F5B;
            direction: ltr;
        }

        .rmd-row-header i {
            color: #555;
            font-size: 11px;
        }

        .rmd-row-count {
            font-size: 11px;
            color: #666;
            font-weight: normal;
            background: #1e1e1e;
            padding: 2px 8px;
            border-radius: 10px;
            margin-right: auto;
            direction: ltr;
        }

        .rmd-row-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 8px;
            border-radius: 8px;
            direction: ltr;
        }

        /* כרטיס ארון בתוך שורה - קצת יותר קטן */
        .rmd-row-grid .rmd-rack-card {
            width: 200px;
            flex-shrink: 0;
        }
        
        /* ===== POWER SUMMARY ===== */
        .rmd-card-power-summary {
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: #1a1a1a;
            border: 1px solid #2a2a2a;
            border-radius: 6px;
            padding: 6px 8px;
        }
        .rmd-power-row {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .rmd-power-side-label {
            font-size: 10px;
            font-weight: bold;
            color: #888;
            width: 12px;
            text-align: center;
        }
        .rmd-power-bar-wrap {
            flex: 1;
            height: 6px;
            background: #2c2c2c;
            border-radius: 3px;
            overflow: hidden;
        }
        .rmd-power-bar-fill {
            height: 100%;
            border-radius: 3px;
            transition: width 0.5s ease;
            min-width: 2px;
        }
        .rmd-power-val {
            font-size: 10px;
            color: #aaa;
            width: 38px;
            text-align: left;
        }
        .rmd-power-total {
            font-size: 11px;
            color: #aaa;
            text-align: center;
            border-top: 1px solid #2c2c2c;
            padding-top: 4px;
            margin-top: 2px;
        }
        .rmd-power-total strong {
            color: #fff;
        }
        .rmd-power-total strong.critical-power {
            color: #dc3545;
        }
        .rmd-power-total strong.warning-power {
            color: #fd7e14;
        }
        .rmd-power-total strong.caution-power {
            color: #ffeb3b;
        }
        .rmd-power-total strong.normal-power {
            color: white;
        }

       /* ===== DATACENTER BUTTONS (בתוך toolbar) ===== */
        .rmd-datacenter-buttons {
            display: flex;
            gap: 8px;
            direction: ltr;
            align-items: center;
        }
        .rmd-datacenter-btn {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 14px;
            background: #2c2c2c;
            border: 1px solid #444;
            border-radius: 6px;
            color: #e0e0e0;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s;
            white-space: nowrap;
        }
        .rmd-datacenter-btn:hover {
            background: #320F5B;
            border-color: #5a1a9a;
            color: #fff;
        }
        .rmd-datacenter-btn i {
            color: #888;
            font-size: 13px;
        }
        .rmd-datacenter-btn:hover i {
            color: #fff;
        }
        .rmd-btn-image {
            width: 36px;
            height: 24px;
            object-fit: cover;
            border-radius: 3px;
            opacity: 0.8;
        }
        .rmd-datacenter-btn:hover .rmd-btn-image {
            opacity: 1;
        }
        `;
        document.head.appendChild(style);
    }
}