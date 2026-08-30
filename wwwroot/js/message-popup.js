// ══════════════════════════════════════════════════════════════════════
//  message-popup.js  –  Popup אישור הודעות מערכת
//  נטען בכל דף לאחר התחברות
// ══════════════════════════════════════════════════════════════════════

(function () {
    'use strict';

    // ── CSS מוזרק דינמית ──────────────────────────────────────────────
    const STYLES = `
        #msgPopupOverlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,.75);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: fadeIn .25s ease;
        }
        @keyframes fadeIn {
            from { opacity:0; }
            to   { opacity:1; }
        }
        #msgPopupBox {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 16px;
            padding: 2rem;
            width: 90%;
            max-width: 520px;
            max-height: 80vh;
            overflow-y: auto;
            direction: rtl;
            font-family: 'Segoe UI', sans-serif;
            animation: slideUp .3s ease;
            position: relative;
        }
        @keyframes slideUp {
            from { transform: translateY(30px); opacity:0; }
            to   { transform: translateY(0);    opacity:1; }
        }
        #msgPopupHeader {
            display: flex;
            align-items: center;
            gap: .6rem;
            margin-bottom: 1.2rem;
        }
        #msgPopupIcon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(240,165,0,.15);
            border: 1px solid rgba(240,165,0,.3);
            display: flex;
            align-items: center;
            justify-content: center;
            color: #f0a500;
            font-size: 1.1rem;
            flex-shrink: 0;
        }
        #msgPopupHeaderText h2 {
            font-size: 1rem;
            color: #e6edf3;
            font-weight: 600;
        }
        #msgPopupHeaderText p {
            font-size: .78rem;
            color: rgba(255,255,255,.35);
            margin-top: .15rem;
        }
        /* תוספת: תגית "עודכן" */
        #msgPopupEditedBadge {
            display: inline-flex;
            align-items: center;
            gap: .3rem;
            background: rgba(240,165,0,.15);
            border: 1px solid rgba(240,165,0,.4);
            color: #f0a500;
            font-size: .72rem;
            font-weight: 600;
            padding: .2rem .6rem;
            border-radius: 20px;
            margin-top: .3rem;
        }
        #msgPopupCounter {
            margin-right: auto;
            font-size: .78rem;
            color: rgba(255,255,255,.3);
            white-space: nowrap;
            direction: ltr;
        }
        #msgPopupCard {
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 10px;
            padding: 1.2rem;
            margin-bottom: 1.2rem;
        }
        /* תוספת: border צהוב להודעה שעודכנה */
        #msgPopupCard.edited {
            border-color: rgba(240,165,0,.5);
        }
        #msgPopupTitle {
            font-size: 1rem;
            font-weight: 600;
            color: #58a6ff;
            margin-bottom: .6rem;
            display: flex;
            align-items: center;
            gap: .4rem;
        }
        #msgPopupContent {
            font-size: .9rem;
            color: rgba(255,255,255,.75);
            line-height: 1.7;
            white-space: pre-wrap;
        }
        #msgPopupDate {
            font-size: .75rem;
            color: rgba(255,255,255,.25);
            margin-top: .8rem;
            display: flex;
            align-items: center;
            gap: .3rem;
        }
        #msgPopupActions {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: .8rem;
        }
        #msgPopupSkip {
            background: none;
            border: none;
            color: rgba(255,255,255,.3);
            font-size: .82rem;
            cursor: pointer;
            padding: .4rem;
            transition: color .2s;
        }
        #msgPopupSkip:hover { color: rgba(255,255,255,.6); }
        #msgPopupAck {
            background: #238636;
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: .6rem 1.4rem;
            font-size: .9rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: .5rem;
            transition: background .2s;
            flex: 1;
            justify-content: center;
            max-width: fit-content;
        }
        #msgPopupAck:hover   { background: #2ea043; }
        #msgPopupAck:disabled {
            background: #21262d;
            color: rgba(255,255,255,.3);
            cursor: not-allowed;
        }
        #msgPopupClose {
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: .6rem 1.4rem;
            font-size: .9rem;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: .5rem;
            transition: background .2s;
            flex: 1;
            justify-content: center;
            max-width: fit-content;
        }
        #msgPopupClose:hover {
            background: linear-gradient(135deg, #dc2626, #b91c1c);
        }
        #msgPopupProgress {
            display: flex;
            gap: 4px;
            margin-bottom: 1rem;
        }
        .msg-dot {
            height: 4px;
            flex: 1;
            border-radius: 2px;
            background: #30363d;
            transition: background .3s;
        }
        .msg-dot.done    { background: #238636; }
        .msg-dot.current { background: #58a6ff; }

        /* ── Toast ── */
        .msg-toast {
            position: fixed;
            bottom: 1.5rem;
            left: 50%;
            transform: translateX(-50%);
            color: #fff;
            padding: .6rem 1.4rem;
            border-radius: 8px;
            font-size: .88rem;
            z-index: 100000;
            font-family: 'Segoe UI', sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,.4);
            animation: fadeIn .3s ease;
            pointer-events: none;
        }
        .msg-toast.success { background: #238636; }
        .msg-toast.error   { background: #da3633; }
        .msg-toast.info    { background: #1f6feb; }
        .msg-toast.warning { background: #9a6700; }
        /* כפתור X לסגירה */
        #msgPopupXClose {
            position: absolute;
            top: .8rem;
            left: .8rem;
            background: rgba(255,255,255,.07);
            border: 1px solid rgba(255,255,255,.12);
            color: rgba(255,255,255,.45);
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: .8rem;
            cursor: pointer;
            transition: background .2s, color .2s;
            line-height: 1;
        }
        #msgPopupXClose i,
        #msgInboxXClose i {
            display: flex;
            align-items: center;
            justify-content: center;
            line-height: 1;
            margin: 0;
            padding: 0;
            position: relative;
            top: 0;
            left: 0;
        }
        #msgPopupXClose:hover {
            background: rgba(239,68,68,.2);
            border-color: rgba(239,68,68,.4);
            color: #ef4444;
        }
    `;

    // ── משתנים ────────────────────────────────────────────────────────
    let _messages = [];
    let _currentIdx = 0;
    let _token = '';
    let _isOpen = false;
    let _isInboxOpen = false;

    // ══════════════════════════════════════════════════════════════════
    //  אתחול
    // ══════════════════════════════════════════════════════════════════
    async function init() {
        const tokenEl = document.querySelector(
            'input[name="__RequestVerificationToken"]');
        _token = tokenEl ? tokenEl.value : '';

        await refreshBadge(true);

        // תוספת: בדוק כל 60 שניות אם יש הודעות חדשות/עודכנו
        setInterval(checkForUpdates, 60000);
    }

    // ══════════════════════════════════════════════════════════════════
    //  חדש: בדיקת עדכונים תקופתית
    // ══════════════════════════════════════════════════════════════════
    async function checkForUpdates() {
        // אל תבדוק אם הפופאפ פתוח
        if (_isOpen || _isInboxOpen) return;

        try {
            const res = await fetch('/api/userMessages/pending',
                { credentials: 'same-origin' });
            if (!res.ok) return;

            const data = await res.json();
            const count = data.count || 0;

            updateSidebarBadge(count);

            if (count > 0) {
                // תמיד רענן את ה-messages מהשרת (כולל הודעות שעודכנו)
                _messages = data.messages || [];
                _currentIdx = 0;
            } else {
                _messages = [];
                _currentIdx = 0;
            }

        } catch (e) {
            // שקט - בדיקה ברקע
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  שליפת הודעות ממתינות + עדכון Badge
    // ══════════════════════════════════════════════════════════════════
    async function refreshBadge(isShowPopup) {
        try {
            const res = await fetch('/api/userMessages/pending',
                { credentials: 'same-origin' });

            if (!res.ok) return;

            const data = await res.json();
            const count = data.count || 0;

            updateSidebarBadge(count);

            if (count > 0) {
                _messages = data.messages || [];
                _currentIdx = 0;
                injectStyles();
                if (isShowPopup)
                    showPopup();
            }

        } catch (e) {
            console.warn('[MessagePopup] שגיאה בטעינת הודעות:', e);
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  עדכון Badge + שורת הכפתור בסרגל הצד
    // ══════════════════════════════════════════════════════════════════
    function updateSidebarBadge(count) {
        const badge = document.getElementById('messagesBadge');
        if (badge) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }

        const row = document.getElementById('userMessagesRow');
        if (row) {
            row.style.display = count > 0 ? 'block' : 'none';
        }

        const txt = document.querySelector('.messages-indicator-text');
        if (txt) {
            txt.textContent = count === 1
                ? 'הודעה אחת ממתינה לאישור'
                : `${count} הודעות ממתינות לאישור`;
        }
        ensureInboxButton(count === 0);
    }

    function ensureInboxButton(show) {
        let btn = document.getElementById('btnMsgInbox');

        if (!show) {
            if (btn) btn.style.display = 'none';
            return;
        }

        if (btn) {
            btn.style.display = 'flex';
            return;
        }

        const anchor =
            document.getElementById('userMessagesRow') ||
            document.querySelector('.user-messages-row');

        const isDashboard = window.location.pathname.toLowerCase().includes('/dashboards');

        if (!anchor) return;

        btn = document.createElement('button');
        btn.id = 'btnMsgInbox';
        btn.className = 'btn-inbox-indicator';
        btn.type = 'button';

        if (isDashboard) {
            btn.innerHTML = `
            <i class="fas fa-inbox"></i>
        `;
        } else {
            btn.innerHTML = `
            <i class="fas fa-inbox"></i>
            <span>תיבת דואר</span>
            <i class="fas fa-chevron-left inbox-arrow"></i>
        `;

        }
        btn.addEventListener('click', openInbox);
        anchor.insertAdjacentElement('afterend', btn);
    }

    // ══════════════════════════════════════════════════════════════════
    //  פתיחת Popup ידנית (מהכפתור בסרגל הצד)
    // ══════════════════════════════════════════════════════════════════
    window.openPendingMessages = async function () {
        // אם כבר פתוח – אל תפתח שוב
        if (_isOpen) return;

        // אם אין הודעות בזיכרון – שלוף מחדש
        if (_messages.length === 0) {
            try {
                const res = await fetch('/api/userMessages/pending',
                    { credentials: 'same-origin' });

                if (!res.ok) {
                    showToast('שגיאה בטעינת הודעות', 'error');
                    return;
                }

                const data = await res.json();

                if (!data.count || data.count === 0) {
                    showToast('אין הודעות ממתינות לאישור', 'info');
                    updateSidebarBadge(0);
                    _messages = [];
                    _currentIdx = 0;
                    return;
                }

                _messages = data.messages || [];
                _currentIdx = 0;

            } catch (e) {
                console.error('[MessagePopup] שגיאה:', e);
                showToast('שגיאה בטעינת הודעות', 'error');
                return;
            }
        }

        injectStyles();
        showPopup();
    };

    // ══════════════════════════════════════════════════════════════════
    //  הזרקת CSS
    // ══════════════════════════════════════════════════════════════════
    function injectStyles() {
        if (document.getElementById('msgPopupStyles')) return;
        const style = document.createElement('style');
        style.id = 'msgPopupStyles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    // ══════════════════════════════════════════════════════════════════
    //  הצגת הפופאפ
    // ══════════════════════════════════════════════════════════════════
    function showPopup() {
        removePopup();

        const msg = _messages[_currentIdx];
        if (!msg) return;

        _isOpen = true;

        const total = _messages.length;
        const current = _currentIdx + 1;
        const dateStr = formatDate(msg.createdAt);

        // תוספת: זיהוי הודעה שעודכנה
        const isEdited = msg.isEdited === true || msg.isEdited === 1;
        const editedDateStr = isEdited && msg.editedAt
            ? formatDate(msg.editedAt)
            : null;

        const overlay = document.createElement('div');
        overlay.id = 'msgPopupOverlay';

        overlay.innerHTML = `
            <div id="msgPopupBox">

                <!-- Progress dots -->
                ${total > 1 ? buildDots(total, _currentIdx) : ''}

                <!-- Header -->
                <div id="msgPopupHeader">
                    <div id="msgPopupIcon">
                        <i class="fas fa-bell"></i>
                    </div>

                    <div id="msgPopupHeaderText">
                        <h2>הודעת מערכת</h2>
                        <p>נדרש אישור קריאה</p>
                        ${isEdited
                ? `<div id="msgPopupEditedBadge">
                                   <i class="fas fa-pen"></i>
                                   הודעה זו עודכנה – נדרש אישור מחדש
                               </div>`
                : ''}
                    </div>

                    ${total > 1
                ? `<span id="msgPopupCounter">${current} / ${total}</span>`
                : ''}
                </div>

                <!-- Message Card -->
                <button id="msgPopupXClose" type="button" title="סגור">
                    <i class="fas fa-times"></i>
                </button>
                <div id="msgPopupCard" class="${isEdited ? 'edited' : ''}">
                    <div id="msgPopupTitle">
                        <i class="fas fa-info-circle"></i>
                        ${escHtml(msg.title)}
                    </div>
                    <div id="msgPopupContent">${escHtml(msg.content)}</div>
                    <div id="msgPopupDate">
                        <i class="fas fa-clock"></i>
                        ${dateStr}
                        ${editedDateStr
                ? `&nbsp;|&nbsp;<i class="fas fa-pen"></i> עודכן: ${editedDateStr}`
                : ''}
                    </div>
                </div>

                <!-- Actions -->
                <div id="msgPopupActions">
                    ${total > 1
                ? `<button id="msgPopupSkip" type="button">
                               דלג להודעה הבאה
                           </button>`
                : '<span></span>'}
                    <button id="msgPopupAck" type="button">
                        <i class="fas fa-check"></i>
                        קראתי ואישרתי
                    </button>
                    <button id="msgPopupClose" type="button">
                        <i class="fas fa-clock"></i>
                        קרא אחר כך
                    </button>
                </div>

            </div>
        `;

        document.body.appendChild(overlay);

        // ── Event Listeners ──────────────────────────────────────────
        const ackBtn = overlay.querySelector('#msgPopupAck');
        const skipBtn = overlay.querySelector('#msgPopupSkip');
        const closeBtn = overlay.querySelector('#msgPopupClose');

        if (ackBtn) ackBtn.addEventListener('click', () => handleAck(msg.id));
        if (skipBtn) skipBtn.addEventListener('click', handleSkip);
        if (closeBtn) closeBtn.addEventListener('click', handleClose);
        overlay.querySelector('#msgPopupXClose')
            ?.addEventListener('click', handleClose);
    }

    // ══════════════════════════════════════════════════════════════════
    //  handleClose - נקה state
    // ══════════════════════════════════════════════════════════════════
    function handleClose() {
        const remaining = _messages.length - _currentIdx;
        _currentIdx = 0;
        updateSidebarBadge(remaining > 0 ? remaining : _messages.length);
        removePopup();
        showToast('ההודעה נשמרה לקריאה מאוחרת יותר', 'info');
    }

    // ══════════════════════════════════════════════════════════════════
    //  תיבת דואר – הודעות שאושרו
    // ══════════════════════════════════════════════════════════════════
    async function openInbox() {
        if (_isInboxOpen) return;

        let items = [];
        try {
            const res = await fetch('/api/userMessages/acknowledged',
                { credentials: 'same-origin' });
            if (res.ok) {
                const data = await res.json();
                items = data.messages || [];
            }
        } catch (e) {
            showToast('שגיאה בטעינת תיבת הדואר', 'error');
            return;
        }
        _isInboxOpen = true;

        const overlay = document.createElement('div');
        overlay.id = 'msgInboxOverlay';

        const itemsHtml = items.length === 0
            ? `<div class="msg-inbox-empty">
                   <i class="fas fa-inbox"></i>
                   אין הודעות שאושרו עדיין
               </div>`
            : items.map((m, idx) => {
                return `
                <div class="msg-inbox-item">
                    <div class="msg-inbox-item-title">
                        <i class="fas fa-info-circle"></i>
                        ${escHtml(m.title)}
                    </div>
                    <div class="msg-inbox-item-content" id="inboxContent_${idx}">
                        ${escHtml(m.content)}
                    </div>
                    <div class="msg-inbox-item-footer">
                        <span class="msg-inbox-item-date">
                            <i class="fas fa-clock"></i>
                            ${formatDate(m.createdAt)}
                        </span>
                        <span class="msg-inbox-ack-date">
                            <i class="fas fa-check-circle"></i>
                            אושר: ${formatDate(m.acknowledgedAt)}
                        </span>
                        <button class="msg-inbox-expand-btn"
                                data-idx="${idx}" type="button">
                            הצג הכל
                        </button>
                    </div>
                </div>`;
            }).join('');

        overlay.innerHTML = `
            <div id="msgInboxBox">
                <button id="msgInboxXClose" type="button" title="סגור">
                    <i class="fas fa-times"></i>
                </button>
                <div id="msgInboxHeader">
                    <div id="msgInboxIcon">
                        <i class="fas fa-inbox"></i>
                    </div>
                    <div>
                        <div id="msgInboxTitle">תיבת הודעות</div>
                        <div id="msgInboxSubtitle">
                            הודעות שקראת ואישרת
                            ${items.length > 0 ? `(${items.length})` : ''}
                        </div>
                    </div>
                </div>
                ${itemsHtml}
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#msgInboxXClose')
            ?.addEventListener('click', closeInbox);

        overlay.querySelectorAll('.msg-inbox-expand-btn')
            .forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = btn.dataset.idx;
                    const content = document.getElementById(
                        `inboxContent_${idx}`);
                    if (!content) return;
                    const expanded = content.classList.toggle('expanded');
                    btn.textContent = expanded ? 'הצג פחות' : 'הצג הכל';
                });
            });
    }

    function closeInbox() {
        const el = document.getElementById('msgInboxOverlay');
        if (el) el.remove();
        _isInboxOpen = false;
    }

    // ══════════════════════════════════════════════════════════════════
    //  בניית נקודות Progress
    // ══════════════════════════════════════════════════════════════════
    function buildDots(total, current) {
        let html = '<div id="msgPopupProgress">';
        for (let i = 0; i < total; i++) {
            let cls = 'msg-dot';
            if (i < current) cls += ' done';
            if (i === current) cls += ' current';
            html += `<div class="${cls}"></div>`;
        }
        html += '</div>';
        return html;
    }

    // ══════════════════════════════════════════════════════════════════
    //  אישור הודעה
    // ══════════════════════════════════════════════════════════════════
    async function handleAck(messageId) {
        const btn = document.getElementById('msgPopupAck');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> שולח...';
        }

        try {
            const res = await fetch(
                `/api/userMessages/acknowledge/${messageId}`,
                {
                    method: 'POST',
                    headers: {
                        'RequestVerificationToken': _token,
                        'Content-Type': 'application/json'
                    },
                    credentials: 'same-origin'
                }
            );

            if (!res.ok) throw new Error(`שגיאת שרת: ${res.status}`);

            _currentIdx++;

            const remaining = _messages.length - _currentIdx;
            updateSidebarBadge(remaining);

            if (_currentIdx < _messages.length) {
                showPopup();
            } else {
                _messages = [];
                _currentIdx = 0;
                removePopup();
                refreshBadge(false);
                showToast('כל ההודעות אושרו ✓', 'success');
            }

        } catch (e) {
            console.error('[MessagePopup] שגיאה באישור:', e);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-check"></i> קראתי ואישרתי';
            }
            showToast('שגיאה בשליחת האישור', 'error');
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  דילוג להודעה הבאה
    // ══════════════════════════════════════════════════════════════════
    function handleSkip() {
        _currentIdx++;
        if (_currentIdx < _messages.length) {
            showPopup();
        } else {
            _currentIdx = 0;
            showPopup();
            showToast('חזרת להודעה הראשונה – יש לאשר את כל ההודעות', 'info');
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  הסרת הפופאפ
    // ══════════════════════════════════════════════════════════════════
    function removePopup() {
        const el = document.getElementById('msgPopupOverlay');
        if (el) el.remove();
        _isOpen = false;
    }

    // ══════════════════════════════════════════════════════════════════
    //  Toast
    // ══════════════════════════════════════════════════════════════════
    function showToast(text, type = 'info') {
        document.querySelectorAll('.msg-toast').forEach(t => t.remove());

        const t = document.createElement('div');
        t.className = `msg-toast ${type}`;
        t.textContent = text;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // ══════════════════════════════════════════════════════════════════
    //  פורמט תאריך
    // ══════════════════════════════════════════════════════════════════
    function formatDate(isoStr) {
        try {
            const d = new Date(isoStr);
            return d.toLocaleString('he-IL', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return '';
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  Escape HTML
    // ══════════════════════════════════════════════════════════════════
    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ══════════════════════════════════════════════════════════════════
    //  הפעל לאחר טעינת הדף
    // ══════════════════════════════════════════════════════════════════
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();