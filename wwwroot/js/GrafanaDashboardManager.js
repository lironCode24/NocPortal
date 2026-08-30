class GrafanaDashboard {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;

        // קובץ ה-JSON של הדשבורד
        this.dashboardFile =
            "/assets/dashboards/application-status.json";

        this.dashboard = null;

        // מצב סטטוסים
        this.statuses = {};
        this.refreshInterval = null;
        this.refreshSeconds = 30;
    }

    // =============================================
    // אתחול
    // =============================================

    async initialize() {
        this.container =
            document.getElementById(this.containerId);

        if (!this.container) {
            console.error(
                `Container ${this.containerId} not found`
            );
            return;
        }

        this.addStyles();

        try {
            await this.loadDashboard();
            this.render();
            this.bindEvents();

            // טעינת סטטוסים ראשונית
            await this.fetchAllStatuses();

            // רענון אוטומטי
            this.startAutoRefresh();

        } catch (err) {
            console.error("Dashboard init failed:", err);
            this.container.innerHTML = `
                <div class="itsm-error">
                    שגיאה בטעינת הדשבורד: ${err.message}
                </div>
            `;
        }
    }

    // =============================================
    // טעינת קובץ JSON
    // =============================================

    async loadDashboard() {
        const response =
            await fetch(this.dashboardFile);

        if (!response.ok) {
            throw new Error(
                `Cannot load ${this.dashboardFile} ` +
                `(HTTP ${response.status})`
            );
        }

        this.dashboard = await response.json();
    }

    // =============================================
    // שליחת שאילתות ל-Backend (GrafanaDashboardController)
    // =============================================

    /**
     * שולח את כל הפאנלים ל-QueryAllPanels
     * ה-Controller שולח ל-Helix events-service
     * בדיוק כמו AlertsController
     */
    async fetchAllStatuses() {
        if (!this.dashboard?.panels) return;

        this.setAllCardsLoading(true);

        try {
            // בנה רשימת פאנלים עם שאילתות
            const panels = this.dashboard.panels
                .filter(p =>
                    p?.targets?.[0]
                        ?.sourceQuery?.expr
                )
                .map(p => ({
                    panelId: p.id,
                    expr: p.targets[0]
                        .sourceQuery.expr
                }));

            if (panels.length === 0) {
                console.warn(
                    "No panels with expressions found"
                );
                return;
            }

            console.log(
                `Querying ${panels.length} panels...`
            );

            const response = await fetch(
                "/GrafanaDashboard/QueryAllPanels",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json"
                    },
                    body: JSON.stringify({ panels })
                }
            );

            if (!response.ok) {
                const errorText =
                    await response.text();
                console.error(
                    "Server error:", errorText
                );
                throw new Error(
                    `HTTP ${response.status}: ` +
                    `${errorText}`
                );
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(
                    data.error || "Query failed"
                );
            }

            console.log(
                `Overall status: ${data.overallStatus}`
            );

            // עדכן כל כרטיסייה
            for (const panel of
                this.dashboard.panels) {

                const result =
                    data.results?.[panel.id];

                // אם אין תוצאה לפאנל - unknown
                const status =
                    result?.status ?? "unknown";

                this.statuses[panel.id] = status;

                this.updateCardStatus(
                    panel.id,
                    status,
                    result?.items ?? []
                );
            }

            // עדכן שעת רענון אחרון
            this.updateLastRefreshTime();

        } catch (err) {
            console.error(
                "fetchAllStatuses failed:", err
            );

            // סמן הכל כ-unknown
            if (this.dashboard?.panels) {
                this.dashboard.panels.forEach(p => {
                    this.updateCardStatus(
                        p.id, "unknown", []
                    );
                });
            }

        } finally {
            this.setAllCardsLoading(false);
        }
    }

    // =============================================
    // עדכון ויזואלי של כרטיסיות
    // =============================================

    /**
     * עדכון כרטיסייה בודדת לפי סטטוס
     * @param {number} panelId
     * @param {string} status - "up" | "critical" | "unknown"
     * @param {Array}  items  - רשימת hostnames ותוצאות
     */
    updateCardStatus(panelId, status, items = []) {
        const card = this.container.querySelector(
            `[data-panel-id="${panelId}"]`
        );

        if (!card) return;

        // הסר קלאסים קודמים
        card.classList.remove(
            "status-up",
            "status-critical",
            "status-unknown",
            "status-loading"
        );

        card.classList.add(`status-${status}`);

        // עדכן אינדיקטור
        const indicator =
            card.querySelector(
                ".itsm-status-indicator"
            );

        if (indicator) {
            const labels = {
                up: "✓ UP",
                critical: "✗ Critical",
                unknown: "? Unknown"
            };

            indicator.textContent =
                labels[status] || "? Unknown";

            indicator.className =
                `itsm-status-indicator ` +
                `indicator-${status}`;
        }

        // עדכן מונה פריטים
        const counter =
            card.querySelector(".itsm-item-count");

        if (counter && items.length > 0) {
            const criticalCount = items.filter(
                i => i.value < 0.5  // 0=DOWN/Critical
            ).length;

            const upCount =
                items.length - criticalCount;

            if (status === "critical") {
                counter.textContent =
                    `${criticalCount} Critical` +
                    (upCount > 0
                        ? ` / ${upCount} UP`
                        : "");
                counter.className =
                    "itsm-item-count count-critical";
            } else if (status === "up") {
                counter.textContent =
                    `${items.length} UP`;
                counter.className =
                    "itsm-item-count count-up";
            } else {
                counter.textContent = "";
            }
        }
    }

    setAllCardsLoading(loading) {
        const cards =
            this.container.querySelectorAll(
                ".itsm-card"
            );

        cards.forEach(card => {
            if (loading) {
                card.classList.add(
                    "status-loading"
                );
            } else {
                card.classList.remove(
                    "status-loading"
                );
            }
        });
    }

    updateLastRefreshTime() {
        const now =
            new Date().toLocaleTimeString("he-IL");

        const lastUpdate =
            document.getElementById(
                "itsmLastUpdate"
            );

        if (lastUpdate) {
            lastUpdate.textContent =
                `עודכן: ${now}`;
        }
    }

    // =============================================
    // רענון אוטומטי
    // =============================================

    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(
            () => this.fetchAllStatuses(),
            this.refreshSeconds * 1000
        );
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // =============================================
    // בניית כרטיסיות מה-JSON
    // =============================================

    getCards() {
        if (!this.dashboard?.panels) {
            return [];
        }

        return this.dashboard.panels.map(panel => {
            const link =
                panel?.fieldConfig?.defaults
                    ?.links?.[0]?.url || "";

            const description =
                panel.description || "";

            return {
                id: panel.id,
                title: panel.title || "Unknown",
                description,
                link,
                type: panel.type || "",
                expr:
                    panel?.targets?.[0]
                        ?.sourceQuery?.expr || ""
            };
        });
    }

    // =============================================
    // רינדור HTML
    // =============================================

    render() {
        const cards = this.getCards();

        this.container.innerHTML = `
        <div class="itsm-root">

            <div class="itsm-header">
                <h2 class="itsm-title">
                    ${this.escapeHtml(
            this.dashboard.title || ""
        )}
                </h2>

                <div class="itsm-header-right">
                    <span class="itsm-count">
                        ${cards.length} פאנלים
                    </span>

                    <button
                        class="itsm-refresh-btn"
                        id="itsmRefreshBtn"
                        title="רענן סטטוסים">
                        ↻ Refresh
                    </button>

                    <span
                        class="itsm-last-update"
                        id="itsmLastUpdate">
                    </span>
                </div>
            </div>

            <div class="itsm-grid">
                ${cards.map(card =>
            this.renderCard(card)
        ).join("")}
            </div>

        </div>
        `;
    }

    renderCard(card) {
        return `
        <div
            class="itsm-card status-loading"
            data-url="${this.escapeHtml(card.link)}"
            data-panel-id="${card.id}"
        >
            <div class="itsm-card-header">
                <div
                    class="itsm-status-indicator
                           indicator-loading">
                    ⟳ Loading...
                </div>
            </div>

            <div class="itsm-card-title">
                ${this.escapeHtml(card.title)}
            </div>

            <div class="itsm-card-desc">
                ${card.description
                ? this.escapeHtml(
                    card.description)
                : "<span class='no-desc'>" +
                "אין תיאור</span>"
            }
            </div>

            <div class="itsm-card-footer">
                <span class="itsm-item-count"></span>

                ${card.link ? `
                <button
                    class="itsm-open-btn"
                    data-url="${this.escapeHtml(
                card.link)}">
                    פתח ↗
                </button>
                ` : ""}
            </div>
        </div>
        `;
    }

    // =============================================
    // אירועים
    // =============================================

    bindEvents() {
        // כפתור רענון ידני
        const refreshBtn =
            document.getElementById(
                "itsmRefreshBtn"
            );

        if (refreshBtn) {
            refreshBtn.addEventListener(
                "click",
                async () => {
                    refreshBtn.disabled = true;
                    refreshBtn.textContent =
                        "⟳ טוען...";

                    await this.fetchAllStatuses();

                    refreshBtn.disabled = false;
                    refreshBtn.textContent =
                        "↻ Refresh";
                }
            );
        }

        // קליקים על כרטיסיות
        this.container.addEventListener(
            "click",
            e => {
                // כפתור "פתח"
                const btn =
                    e.target.closest(
                        ".itsm-open-btn"
                    );

                if (btn) {
                    e.stopPropagation();
                    const url = btn.dataset.url;
                    if (url) {
                        window.open(url, "_blank");
                    }
                    return;
                }

                // קליק על הכרטיסייה עצמה
                const card =
                    e.target.closest(".itsm-card");

                if (!card) return;

                const url = card.dataset.url;
                if (url) {
                    window.open(url, "_blank");
                }
            }
        );
    }

    // =============================================
    // עזר
    // =============================================

    escapeHtml(str) {
        if (!str) return "";
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // =============================================
    // עיצוב CSS
    // =============================================

    addStyles() {
        if (
            document.getElementById(
                "itsmDashboardStyles"
            )
        ) {
            return;
        }

        const style =
            document.createElement("style");

        style.id = "itsmDashboardStyles";

        style.textContent = `

        .itsm-root {
            background: #0f0f1a;
            min-height: 100vh;
            padding: 24px;
            color: #fff;
            font-family: Arial, sans-serif;
            direction: rtl;
        }

        /* ===== Header ===== */

        .itsm-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
            padding-bottom: 16px;
            border-bottom: 1px solid #2a2a4e;
        }

        .itsm-title {
            margin: 0;
            font-size: 22px;
            color: #e2e8f0;
        }

        .itsm-header-right {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .itsm-count {
            color: #94a3b8;
            font-size: 13px;
        }

        .itsm-last-update {
            color: #64748b;
            font-size: 12px;
            min-width: 120px;
            text-align: left;
        }

        .itsm-refresh-btn {
            background: #2563eb;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            transition: background .2s;
        }

        .itsm-refresh-btn:hover {
            background: #1d4ed8;
        }

        .itsm-refresh-btn:disabled {
            background: #475569;
            cursor: not-allowed;
        }

        /* ===== Grid ===== */

        .itsm-grid {
            display: grid;
            grid-template-columns:
                repeat(auto-fill, minmax(240px, 1fr));
            gap: 16px;
        }

        /* ===== כרטיסייה ===== */

        .itsm-card {
            background: #1e1e2e;
            border: 2px solid #2a2a4e;
            border-radius: 12px;
            padding: 16px;
            cursor: pointer;
            transition:
                transform .2s,
                border-color .2s,
                background .2s,
                box-shadow .2s;
            position: relative;
            overflow: hidden;
            min-height: 140px;
            display: flex;
            flex-direction: column;
        }

        .itsm-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 8px 24px
                rgba(0,0,0,.4);
        }

        /* ===== פס צבע עליון ===== */

        .itsm-card::before {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 4px;
            border-radius: 12px 12px 0 0;
            background: #2a2a4e;
            transition: background .3s;
        }

        /* ===== סטטוסים ===== */

        .itsm-card.status-up {
            border-color: #22c55e;
            background: #0d2218;
        }

        .itsm-card.status-up::before {
            background: #22c55e;
        }

        .itsm-card.status-up:hover {
            border-color: #4ade80;
        }

        .itsm-card.status-critical {
            border-color: #ef4444;
            background: #200f0f;
        }

        .itsm-card.status-critical::before {
            background: #ef4444;
        }

        .itsm-card.status-critical:hover {
            border-color: #f87171;
        }

        .itsm-card.status-unknown {
            border-color: #6b7280;
            background: #1a1a2e;
        }

        .itsm-card.status-loading {
            border-color: #3b82f6;
            background: #1a1a2e;
            animation: itsm-pulse 1.5s
                       ease-in-out infinite;
        }

        @keyframes itsm-pulse {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0.55; }
        }

        /* ===== אינדיקטור סטטוס ===== */

        .itsm-card-header {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
        }

        .itsm-status-indicator {
            font-size: 11px;
            font-weight: 700;
            padding: 3px 10px;
            border-radius: 20px;
            letter-spacing: .4px;
        }

        .indicator-up {
            background: #14532d;
            color: #4ade80;
            border: 1px solid #22c55e;
        }

        .indicator-critical {
            background: #7f1d1d;
            color: #fca5a5;
            border: 1px solid #ef4444;
        }

        .indicator-unknown {
            background: #374151;
            color: #9ca3af;
            border: 1px solid #6b7280;
        }

        .indicator-loading {
            background: #1e3a5f;
            color: #93c5fd;
            border: 1px solid #3b82f6;
        }

        /* ===== תוכן ===== */

        .itsm-card-title {
            font-size: 16px;
            font-weight: 700;
            margin-bottom: 6px;
            color: #f1f5f9;
            flex: 1;
        }

        .itsm-card-desc {
            color: #94a3b8;
            font-size: 12px;
            line-height: 1.5;
            margin-bottom: 8px;
        }

        .no-desc {
            color: #475569;
            font-style: italic;
        }

        /* ===== Footer ===== */

        .itsm-card-footer {
            margin-top: auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-top: 10px;
            border-top: 1px solid #2a2a4e;
        }

        .itsm-item-count {
            font-size: 11px;
            font-weight: 600;
        }

        .count-up {
            color: #4ade80;
        }

        .count-critical {
            color: #f87171;
        }

        .itsm-open-btn {
            border: none;
            background: #1d4ed8;
            color: white;
            padding: 5px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            transition: background .2s;
            margin-right: auto;
        }

        .itsm-open-btn:hover {
            background: #2563eb;
        }

        /* ===== שגיאה ===== */

        .itsm-error {
            color: #f87171;
            padding: 32px;
            text-align: center;
            font-size: 16px;
            background: #200f0f;
            border-radius: 12px;
            border: 1px solid #ef4444;
        }

        `;

        document.head.appendChild(style);
    }
}