const hub = {
    features: [],
    query: "",
    category: "הכל",
    audience: "הכל",
    selected: null,
    openedScreen: null,
    step: 0
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeReg(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(value, query) {
    const safe = escapeHtml(value);
    const q = String(query || "").trim();
    if (!q) return safe;
    return safe.replace(new RegExp(escapeReg(q), "gi"), match => `<mark>${match}</mark>`);
}

function capBlob(cap) {
    return [cap.title, cap.permission, ...(cap.tags || []), ...(cap.steps || [])]
        .join(" ")
        .toLowerCase();
}

function screenBlob(feature) {
    return [feature.title, feature.summary, feature.category, feature.audience, ...(feature.tags || [])]
        .join(" ")
        .toLowerCase();
}

function inScope(feature) {
    if (hub.category !== "הכל" && feature.category !== hub.category) return false;
    if (hub.audience !== "הכל" && feature.audience !== hub.audience) return false;
    return true;
}

function scopedFeatures() {
    return hub.features.filter(inScope);
}

function searchHits(query) {
    const q = query.trim().toLowerCase();
    const hits = [];
    for (const feature of scopedFeatures()) {
        const caps = (feature.capabilities || []).filter(cap => capBlob(cap).includes(q));
        if (caps.length) {
            caps.forEach(cap => hits.push({ kind: "cap", feature, cap }));
        } else if (screenBlob(feature).includes(q)) {
            hits.push({ kind: "screen", feature });
        }
    }
    return hits;
}

function findCap(featureId, capId) {
    const feature = hub.features.find(item => item.id === featureId);
    const cap = feature?.capabilities?.find(item => item.id === capId);
    return { feature, cap };
}

function renderSide() {
    const categories = ["הכל", ...new Set(hub.features.map(f => f.category))];
    const audiences = ["הכל", ...new Set(hub.features.map(f => f.audience))];
    const count = (value, key) => hub.features.filter(f => value === "הכל" || f[key] === value).length;
    $("categoryNav").innerHTML = categories.map(name =>
        `<button type="button" class="side-btn ${hub.category === name ? "active" : ""}" data-kind="category" data-value="${escapeHtml(name)}">
            <span>${escapeHtml(name)}</span><em>${count(name, "category")}</em>
        </button>`
    ).join("");
    $("audienceNav").innerHTML = audiences.map(name =>
        `<button type="button" class="side-btn ${hub.audience === name ? "active" : ""}" data-kind="audience" data-value="${escapeHtml(name)}">
            <span>${escapeHtml(name)}</span><em>${count(name, "audience")}</em>
        </button>`
    ).join("");
}

function renderBoard() {
    const q = hub.query.trim();
    document.querySelector(".hub-lead").hidden = !!hub.selected;
    const clearBtn = $("clearSearch");
    if (clearBtn) clearBtn.hidden = !q;

    if (hub.selected) {
        renderGuide();
        return;
    }

    if (q) {
        renderSearch(q);
        return;
    }

    const rows = scopedFeatures();
    const caps = rows.reduce((sum, feature) => sum + (feature.capabilities || []).length, 0);
    $("resultTitle").textContent = "כל המדריכים";
    $("resultMeta").textContent = `${rows.length} מסכים · ${caps} פעולות`;

    if (!rows.length) {
        $("hubStage").innerHTML = `<div class="empty">אין מסכים בתחום הזה.</div>`;
        return;
    }

    $("hubStage").innerHTML = `<div class="hub-grid">${rows.map(feature => featureCard(feature)).join("")}</div>`;
}

function featureCard(feature, query) {
    const caps = feature.capabilities || [];
    return `
        <article class="feature-card">
            <div class="card-top">
                <div class="card-icon"><i class="fas ${escapeHtml(feature.icon || "fa-book")}"></i></div>
                <div>
                    <h3>${highlight(feature.title, query || "")}</h3>
                    <p>${highlight(feature.summary, query || "")}</p>
                    <div class="meta">
                        <span class="pill">${escapeHtml(feature.category)}</span>
                        <span class="pill">${escapeHtml(feature.audience)}</span>
                        <span class="pill quiet">${caps.length} פעולות</span>
                    </div>
                </div>
            </div>
            <div class="cap-links">
                ${caps.map(cap => `
                    <button type="button" class="cap-link" data-feature="${escapeHtml(feature.id)}" data-cap="${escapeHtml(cap.id)}">
                        <span>${highlight(cap.title, query || "")}</span>
                        <i class="fas fa-chevron-left"></i>
                    </button>`).join("")}
            </div>
        </article>`;
}

function renderSearch(query) {
    if (hub.openedScreen) {
        const feature = hub.features.find(item => item.id === hub.openedScreen);
        if (feature && inScope(feature)) {
            $("resultTitle").textContent = feature.title;
            $("resultMeta").textContent = "המסך שנמצא בחיפוש. בחר את הפעולה שרצית.";
            $("hubStage").innerHTML = `
                <button type="button" class="back-btn back-inline" id="backToResults">חזרה לתוצאות</button>
                <div class="hub-grid single">${featureCard(feature, query)}</div>`;
            return;
        }
        hub.openedScreen = null;
    }

    const hits = searchHits(query);
    const actions = hits.filter(hit => hit.kind === "cap").length;
    const screens = hits.length - actions;
    $("resultTitle").textContent = `תוצאות עבור “${query}”`;
    $("resultMeta").textContent = screens
        ? `${actions} פעולות · ${screens} מסכים`
        : `${actions} פעולות`;

    if (!hits.length) {
        $("hubStage").innerHTML = `<div class="empty">
            <i class="fas fa-search"></i>
            <p>אין פעולה שמתאימה לחיפוש.</p>
            <span>נסה מילה כמו סוויטה, אקסל, תיקוף או הרשאות.</span>
        </div>`;
        return;
    }

    $("hubStage").innerHTML = `<div class="hit-list">${hits.map(hit =>
        hit.kind === "cap" ? capHit(hit, query) : screenHit(hit, query)
    ).join("")}</div>`;
}

function capHit(hit, query) {
    const { feature, cap } = hit;
    const preview = (cap.steps || [])[0] || feature.summary;
    return `
        <button type="button" class="hit" data-feature="${escapeHtml(feature.id)}" data-cap="${escapeHtml(cap.id)}">
            <span class="hit-icon"><i class="fas ${escapeHtml(feature.icon || "fa-book")}"></i></span>
            <span class="hit-copy">
                <span class="hit-kicker">${highlight(feature.category, query)} · ${highlight(feature.title, query)}</span>
                <strong>${highlight(cap.title, query)}</strong>
                <span class="hit-preview">${highlight(preview, query)}</span>
            </span>
            <span class="pill">${escapeHtml(cap.permission)}</span>
            <i class="fas fa-chevron-left hit-go"></i>
        </button>`;
}

function screenHit(hit, query) {
    const { feature } = hit;
    const count = (feature.capabilities || []).length;
    return `
        <button type="button" class="hit hit-screen" data-open-feature="${escapeHtml(feature.id)}">
            <span class="hit-icon"><i class="fas ${escapeHtml(feature.icon || "fa-book")}"></i></span>
            <span class="hit-copy">
                <span class="hit-kicker">${highlight(feature.category, query)} · מסך</span>
                <strong>${highlight(feature.title, query)}</strong>
                <span class="hit-preview">${highlight(feature.summary, query)}</span>
            </span>
            <span class="pill">${count} פעולות</span>
            <i class="fas fa-chevron-left hit-go"></i>
        </button>`;
}

function quotedParts(step) {
    return [...String(step).matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

function renderGuide() {
    const { feature, cap } = findCap(hub.selected.featureId, hub.selected.capId);
    if (!feature || !cap) {
        hub.selected = null;
        hub.step = 0;
        renderBoard();
        return;
    }

    const steps = cap.steps || [];
    const last = Math.max(steps.length - 1, 0);
    const index = Math.max(0, Math.min(hub.step || 0, last));
    hub.step = index;
    const step = steps[index] || feature.summary;
    const quotes = quotedParts(step);
    const target = quotes.length ? quotes[quotes.length - 1] : "";
    const place = quotes.length > 1 ? quotes.slice(0, -1).join(" · ") : "";
    const backLabel = hub.query.trim() ? "חזרה לתוצאות" : "חזרה לכל המדריכים";
    const dots = steps.map((_, dotIndex) =>
        `<span class="step-dot ${dotIndex === index ? "on" : ""} ${dotIndex < index ? "done" : ""}"></span>`
    ).join("");
    const click = target
        ? `<div class="click-stage">
                <div class="click-kicker">כאן לוחצים</div>
                ${place ? `<div class="click-place">בתוך ${escapeHtml(place)}</div>` : ""}
                <div class="fake-btn" aria-hidden="true">
                    <span class="pulse"></span>
                    <i class="fas fa-hand-pointer"></i>
                    <span>${escapeHtml(target)}</span>
                </div>
           </div>`
        : `<div class="click-stage plain">
                <div class="click-kicker">מה עושים בשלב הזה</div>
           </div>`;
    const prev = index > 0
        ? `<button type="button" class="back-btn" id="prevStep">שלב קודם</button>`
        : `<span></span>`;
    const next = index < last
        ? `<button type="button" class="next-step" id="nextStep">עבור לשלב הבא</button>`
        : `<span class="step-done">זה השלב האחרון</span>`;

    $("hubStage").innerHTML = `
        <article class="guide">
            <div class="guide-copy">
                <div class="guide-kicker">${escapeHtml(feature.title)} · ${escapeHtml(feature.category)}</div>
                <h2>${escapeHtml(cap.title)}</h2>
                <div class="meta guide-meta">
                    <span class="pill">${escapeHtml(cap.permission)}</span>
                    <span class="pill">${escapeHtml(feature.audience)}</span>
                    <span class="pill quiet">שלב ${index + 1} מתוך ${steps.length || 1}</span>
                </div>
                <div class="step-dots" aria-hidden="true">${dots}</div>
                ${click}
                <p class="step-line">${escapeHtml(step)}</p>
            </div>
            <div class="guide-foot">
                <div class="foot-side">
                    <button type="button" class="back-btn" id="backToGrid">${backLabel}</button>
                    ${prev}
                </div>
                <div class="foot-side">
                    ${next}
                    <a class="open-screen" href="${escapeHtml(feature.route)}" target="_blank" rel="noopener">מעבר למסך</a>
                </div>
            </div>
        </article>`;
}

document.addEventListener("click", (event) => {
    const side = event.target.closest("[data-kind]");
    if (side) {
        hub[side.dataset.kind] = side.dataset.value;
        hub.selected = null;
        hub.openedScreen = null;
        renderSide();
        renderBoard();
        return;
    }

    const openFeature = event.target.closest("[data-open-feature]");
    if (openFeature) {
        hub.openedScreen = openFeature.dataset.openFeature;
        hub.selected = null;
        renderBoard();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }

    const cap = event.target.closest("[data-cap]");
    if (cap) {
        hub.selected = { featureId: cap.dataset.feature, capId: cap.dataset.cap };
        hub.step = 0;
        renderBoard();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }

    if (event.target.id === "backToResults") {
        hub.openedScreen = null;
        renderBoard();
        return;
    }

    if (event.target.id === "prevStep") {
        hub.step = Math.max(0, (hub.step || 0) - 1);
        renderBoard();
        return;
    }

    if (event.target.id === "nextStep") {
        hub.step = (hub.step || 0) + 1;
        renderBoard();
        return;
    }

    if (event.target.id === "backToGrid") {
        hub.selected = null;
        hub.step = 0;
        renderBoard();
    }
});

$("featureSearch").addEventListener("input", () => {
    hub.query = $("featureSearch").value;
    hub.selected = null;
    hub.openedScreen = null;
    renderBoard();
});

$("clearSearch").addEventListener("click", () => {
    $("featureSearch").value = "";
    hub.query = "";
    hub.selected = null;
    hub.openedScreen = null;
    renderBoard();
    $("featureSearch").focus();
});

document.querySelectorAll(".hub-nav a").forEach(link => {
    link.target = "_blank";
    link.rel = "noopener";
});

fetch("/data/features-catalog.json")
    .then(response => response.json())
    .then(data => {
        hub.features = data.features || [];
        renderSide();
        renderBoard();
        $("featureSearch").focus();
    })
    .catch(() => {
        $("hubStage").innerHTML = `<div class="empty">לא הצלחנו לטעון את המדריכים.</div>`;
    });
