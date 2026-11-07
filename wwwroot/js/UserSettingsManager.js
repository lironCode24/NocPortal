// file: UserSettingsManager.js

class UserSettingsManager {

    constructor() {
        this._cache = {};
        this._cacheLoaded = false;
        this._pendingSave = {};
        this._saveTimer = null;
        this._saveDelay = 800;
        this._apiBase = '/UserSettings';
        this._useFallback = false;
        this._userId = null;
        this._initialized = false;
        this._initPromise = null;

        // *** דגל קריטי: מונע רקורסיה ***
        this._isSetting = false;
    }

    // ==========================================
    // אתחול
    // ==========================================
    async initialize() {
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInitialize();
        return this._initPromise;
    }

    async _doInitialize() {
        try {
            const response = await fetch(`${this._apiBase}/GetAll`, {
                method: 'GET',
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();

            if (data.success && data.settings) {
                this._cache = data.settings;
                this._userId = data.userId || null;
            }

            this._cacheLoaded = true;
            this._initialized = true;

            console.log(
                `[UserSettings] טעינה הושלמה` +
                ` (${Object.keys(this._cache).length} הגדרות)`
            );

        } catch (err) {
            console.warn(
                '[UserSettings] שרת לא זמין, עובר ל-localStorage:', err
            );
            this._useFallback = true;
            this._loadFromLocalStorageFallback();
            this._initialized = true;
        }
    }

    _loadFromLocalStorageFallback() {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key) {
                    try {
                        const raw = localStorage.getItem(key);
                        this._cache[key] = raw ? JSON.parse(raw) : null;
                    } catch {
                        this._cache[key] = localStorage.getItem(key);
                    }
                }
            }
            this._cacheLoaded = true;
        } catch (err) {
            console.error('[UserSettings] שגיאה בטעינת fallback:', err);
        }
    }

    // ==========================================
    // getItem - קריאת ערך מהמטמון (סינכרוני)
    // ==========================================
    getItem(key) {
        if (!this._initialized) {
            return this._rawLocalStorageGet(key);
        }
        const value = this._cache[key];
        if (value === undefined || value === null) return null;
        if (typeof value === 'string') return value;
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    async getItemAsync(key) {
        if (!this._initialized) await this.initialize();
        return this.getItem(key);
    }

    // ==========================================
    // setItem - שמירת ערך
    // *** תוקן: ללא רקורסיה ***
    // ==========================================
    setItem(key, value) {
        if (this._isSetting) return;
        this._isSetting = true;
        try {
            // נסה לפרסר כ-JSON, אם נכשל - שמור כ-string
            if (typeof value === 'string') {
                try {
                    this._cache[key] = JSON.parse(value);
                } catch {
                    this._cache[key] = value; // string פשוט - שמור כמו שהוא
                }
            } else {
                this._cache[key] = value;
            }

            this._rawLocalStorageSet(key, value);
            this._pendingSave[key] = this._cache[key];
            this._scheduleSave();
        } finally {
            this._isSetting = false;
        }
    }

    // ==========================================
    // removeItem
    // ==========================================
    removeItem(key) {
        delete this._cache[key];
        try {
            localStorage.removeItem(key);
        } catch { /* ignore */ }
        this._deleteFromServer(key);
    }

    // ==========================================
    // *** פונקציות גולמיות ל-localStorage ***
    // *** אלו לא קוראות ל-setItem/getItem ***
    // ==========================================
    _rawLocalStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    _rawLocalStorageSet(key, value) {
        try {
            // *** קרא ישירות ל-localStorage.setItem הגולמי ***
            const strValue = (typeof value === 'string')
                ? value
                : JSON.stringify(value);

            localStorage.setItem(key, strValue);
        } catch (err) {
            // QuotaExceededError וכו'
            console.warn('[UserSettings] localStorage גולמי נכשל:', err);
        }
    }

    // ==========================================
    // שמירה לשרת - debounced
    // ==========================================
    _scheduleSave() {
        if (this._saveTimer) clearTimeout(this._saveTimer);

        this._saveTimer = setTimeout(
            () => this._flushToServer(),
            this._saveDelay
        );
    }

    async _flushToServer() {
        if (Object.keys(this._pendingSave).length === 0) return;
        if (this._useFallback) return;

        const toSave = { ...this._pendingSave };
        this._pendingSave = {};

        try {
            const response = await fetch(`${this._apiBase}/SaveBatch`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ settings: toSave })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            if (!result.success) throw new Error(result.error || 'שגיאה');

        } catch (err) {
            console.warn('[UserSettings] שגיאה בשמירה לשרת:', err);
            // החזר לתור
            Object.assign(this._pendingSave, toSave);
            this._useFallback = true;
        }
    }

    async _deleteFromServer(key) {
        if (this._useFallback) return;
        try {
            await fetch(`${this._apiBase}/Delete`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ key })
            });
        } catch (err) {
            console.warn('[UserSettings] שגיאה במחיקה:', err);
        }
    }

    // ==========================================
    // שמירה מיידית
    // ==========================================
    async saveNow() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        await this._flushToServer();
    }

    // ==========================================
    // תאימות לאחור - loadFromLocalStorage / saveToLocalStorage
    // (AlertsManager משתמש בפונקציות אלו)
    // ==========================================
    loadFromLocalStorage(key) {
        const raw = this.getItem(key);
        if (raw === null || raw === undefined) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return raw;
        }
    }

    saveToLocalStorage(key, value) {
        // *** setItem מקבל string - המר לפני ***
        const strValue = (typeof value === 'string')
            ? value
            : JSON.stringify(value);
        this.setItem(key, strValue);
    }

    // ==========================================
    // מיגרציה חד-פעמית מ-localStorage לשרת
    // ==========================================
    async migrateFromLocalStorage() {
        const keysToMigrate = [
            'achSortMode',
            'alertsColorMode',
            'alertsSeverityFilters',
            'alertsStatusFilters',
            'alertsColumnOrder',
            'alertsVisibleColumns',
            'alertsSortColumn',
            'alertsSortDirection',
            'alertsKnownIds',
            'alertsProcedurePopupShown',
            'alertsActiveFilterState',
            'lastSelectedEmployee',
            'dashboardColorMode'
        ];

        const toMigrate = {};
        let count = 0;

        keysToMigrate.forEach(key => {
            // *** קרא ישירות - לא דרך getItem ***
            const val = this._rawLocalStorageGet(key);
            if (val !== null) {
                try {
                    toMigrate[key] = JSON.parse(val);
                } catch {
                    toMigrate[key] = val;
                }
                count++;
            }
        });

        if (count === 0) {
            console.log('[UserSettings] אין נתונים למיגרציה');
            return;
        }

        try {
            const response = await fetch(`${this._apiBase}/SaveBatch`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ settings: toMigrate })
            });

            if (response.ok) {
                Object.assign(this._cache, toMigrate);
                console.log(
                    `[UserSettings] מיגרציה הושלמה: ${count} הגדרות`
                );
            }
        } catch (err) {
            console.warn('[UserSettings] מיגרציה נכשלה:', err);
        }
    }
}

// ── Singleton גלובלי ──
const userSettings = new UserSettingsManager();

// ── אתחול אוטומטי ──
document.addEventListener('DOMContentLoaded', async () => {
    await userSettings.initialize();

    // מיגרציה חד-פעמית
    const migrated = userSettings._rawLocalStorageGet('_settingsMigrated');
    if (!migrated) {
        await userSettings.migrateFromLocalStorage();
        userSettings._rawLocalStorageSet('_settingsMigrated', '1');
    }
});