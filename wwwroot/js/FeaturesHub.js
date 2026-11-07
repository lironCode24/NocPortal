const hub = {
    features: [],
    query: "",
    category: "הכל",
    audience: "הכל",
    selected: null
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function capText(cap) {
    return [cap.title, cap.permission, ...(cap.tags || []), ...(cap.steps || [])].join(" ");
}

function featureText(feature) {
    return [
        feature.title, feature.summary, feature.category, feature.audience, feature.route,
        ...(feature.tags || []),
        ...(feature.capabilities || []).map(capText)
    ].join(" ").toLowerCase();
}

function visibleFeatures() {
    const q = hub.query.trim().toLowerCase();
    return hub.features.filter(feature => {
        if (hub.category !== "הכל" && feature.category !== hub.category) return false;
        if (hub.audience !== "הכל" && feature.audience !== hub.audience) return false;
        if (!q) return true;
        return featureText(feature).includes(q);
    });
}

function findCap(featureId, capId) {
    const feature = hub.features.find(item => item.id === featureId);
    const cap = feature?.capabilities?.find(item => item.id === capId);
    return { feature, cap };
}

function renderSide() {
    const categories = ["הכל", ...new Set(hub.features.map(f => f.category))];
    const audiences = ["הכל", ...new Set(hub.features.map(f => f.audience))];
    const count = (list, value, key) => hub.features.filter(f => value === "הכל" || f[key] === value).length;
    $("categoryNav").innerHTML = categories.map(name =>
        `<button type="button" class="side-btn ${hub.category === name ? "active" : ""}" data-kind="category" data-value="${escapeHtml(name)}">${escapeHtml(name)} <span>${count(categories, name, "category")}</span></button>`
    ).join("");
    $("audienceNav").innerHTML = audiences.map(name =>
        `<button type="button" class="side-btn ${hub.audience === name ? "active" : ""}" data-kind="audience" data-value="${escapeHtml(name)}">${escapeHtml(name)} <span>${count(audiences, name, "audience")}</span></button>`
    ).join("");
}

function renderBoard() {
    const rows = visibleFeatures();
    const caps = rows.reduce((sum, feature) => sum + (feature.capabilities || []).length, 0);
    $("resultTitle").textContent = hub.query ? `תוצאות עבור “${hub.query}”` : "כל המדריכים";
    $("resultMeta").textContent = `${rows.length} מסכים · ${caps} מדריכי הגעה`;
    document.querySelector(".hub-lead").hidden = !!hub.selected;

    if (hub.selected) {
        renderGuide(rows);
        return;
    }

    if (!rows.length) {
        $("hubStage").innerHTML = `<div class="empty">אין מדריך שמתאים לחיפוש. נסה מילה כמו סוויטה, אקסל, תיקוף או הרשאות.</div>`;
        return;
    }

    $("hubStage").innerHTML = `<div class="hub-grid">${rows.map(feature => `
        <article class="feature-card">
            <div class="card-top">
                <div class="card-icon"><i class="fas ${escapeHtml(feature.icon || "fa-book")}"></i></div>
                <div>
                    <h3>${escapeHtml(feature.title)}</h3>
                    <p>${escapeHtml(feature.summary)}</p>
                    <div class="meta">
                        <span class="pill">${escapeHtml(feature.category)}</span>
                        <span class="pill">${escapeHtml(feature.audience)}</span>
                    </div>
                </div>
            </div>
            <div class="cap-links">
                ${(feature.capabilities || []).map(cap => `
                    <button type="button" class="cap-link" data-feature="${escapeHtml(feature.id)}" data-cap="${escapeHtml(cap.id)}">
                        ${escapeHtml(cap.title)}
                    </button>`).join("")}
            </div>
        </article>`).join("")}</div>`;
}

function renderGuide() {
    const { feature, cap } = findCap(hub.selected.featureId, hub.selected.capId);
    if (!feature || !cap) {
        hub.selected = null;
        renderBoard();
        return;
    }
    const steps = (cap.steps || []).map((step, index) =>
        `<li><span class="num">${index + 1}</span><span>${escapeHtml(step)}</span></li>`
    ).join("");
    $("hubStage").innerHTML = `
        <article class="guide">
            <div class="guide-copy">
                <div class="guide-kicker">${escapeHtml(feature.category)} · ${escapeHtml(cap.permission)}</div>
                <h2>${escapeHtml(cap.title)}</h2>
                <p class="summary">${escapeHtml(feature.summary)}</p>
                <ol class="steps">${steps}</ol>
            </div>
            <div class="guide-foot">
                <button type="button" class="back-btn" id="backToGrid">חזרה לכל המדריכים</button>
                <a class="open-screen" href="${escapeHtml(feature.route)}">פתח את המסך</a>
            </div>
        </article>`;
}

document.addEventListener("click", (event) => {
    const side = event.target.closest("[data-kind]");
    if (side) {
        hub[side.dataset.kind] = side.dataset.value;
        hub.selected = null;
        renderSide();
        renderBoard();
        return;
    }
    const cap = event.target.closest("[data-cap]");
    if (cap) {
        hub.selected = { featureId: cap.dataset.feature, capId: cap.dataset.cap };
        renderBoard();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }
    if (event.target.id === "backToGrid") {
        hub.selected = null;
        renderBoard();
    }
});

$("featureSearch").addEventListener("input", () => {
    hub.query = $("featureSearch").value;
    hub.selected = null;
    renderBoard();
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
