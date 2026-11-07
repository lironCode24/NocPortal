// file: OrgTreeDashboard.js
class OrgTreeDashboard {
    constructor(containerId, currentUser) {
        this.containerId = containerId;
        this.container = null;
        this.currentUser = currentUser;
        this.employees = [];
        this.filteredEmployees = [];
        this.treeData = null;
        this.searchTerm = '';
        this.expandedNodes = new Set();
        this.highlightedNodes = new Set();
        this.viewMode = 'tree'; // 'tree' | 'table'
        this.selectedEmployee = null;
        this.zoomLevel = 1;
        this.isDragging = false;
        this.dragStart = { x: 0, y: 0 };
        this.panOffset = { x: 0, y: 0 };
        this.phoneData = [];
        this.isAdmin = false;
        this.focusedEmployeeId = null;
        this.focusedNodes = new Set();
        this.activeNodeId = null; // הצומת שהכפופים שלו מוצגים
        this.pathNodes = new Set();
    }

    async initialize() {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container #${this.containerId} not found`);
            return;
        }

        this.addStyles();
        this.renderShell();
        this.bindEvents();
        this._initAutocomplete();
        await this._checkPermissions();
        await this.loadData();
    }

    async _checkPermissions() {
        try {
            const role = this.currentUser?.role || '';
            this.isAdmin = role === 'Admin' || role === 'NOC';
        } catch (e) {
            this.isAdmin = false;
        }
    }

    // ══════════════════════════════════════════════════════════
    // טעינת נתונים
    // ══════════════════════════════════════════════════════════
    async loadData() {
        try {
            this.showLoading(true);

            // טען נתוני עץ ארגוני
            const treeRes = await fetch('/OrgTree/GetOrgTree', {
                credentials: 'include'
            });
            const treeData = await treeRes.json();

            if (!treeData.success) {
                this.showError(treeData.error || 'שגיאה בטעינת העץ הארגוני');
                return;
            }

            this.employees = treeData.employees || [];

            // טען נתוני ספר טלפונים לתוספת מידע
            try {
                const phoneRes = await fetch('/PhoneDirectory/GetPhoneDirectory', {
                    credentials: 'include'
                });
                const phoneData = await phoneRes.json();
                if (!phoneData.error) {
                    this.phoneData = phoneData || [];
                }
            } catch (e) {
                console.warn('Could not load phone directory:', e);
            }

            // בנה עץ
            this.treeData = this._buildTree(this.employees);

            // ── נסה למצוא את היוזר המחובר בעץ ──────────────
            this._initActiveNodeForCurrentUser();

            this.showLoading(false);
            this.renderContent();
            this._updateStats();

        } catch (err) {
            console.error('loadData error:', err);
            this.showLoading(false);
            this.showError('שגיאה בטעינת הנתונים: ' + err.message);
        }
    }

    // ══════════════════════════════════════════════════════════
    // חדש: אתחל צומת פעיל לפי יוזר מחובר
    // ══════════════════════════════════════════════════════════
    _initActiveNodeForCurrentUser() {
        // ── נסה למצוא לפי מייל ────────────────────────────────
        const userEmail = (
            this.currentUser?.email ||
            this.currentUser?.mail ||
            this.currentUser?.userEmail ||
            ''
        ).toLowerCase().trim();

        // ── נסה למצוא לפי שם ──────────────────────────────────
        const userName = (
            this.currentUser?.name ||
            this.currentUser?.fullName ||
            this.currentUser?.displayName ||
            ''
        ).toLowerCase().trim();

        // ── נסה למצוא לפי employeeId ──────────────────────────
        const userId = (
            this.currentUser?.employeeId ||
            this.currentUser?.id ||
            this.currentUser?.userId ||
            ''
        ).toLowerCase().trim();

        let foundNode = null;

        // ── שטח את העץ לחיפוש ─────────────────────────────────
        const allNodes = [];
        const flatten = (nodes) => {
            nodes.forEach(n => {
                allNodes.push(n);
                flatten(n.children);
            });
        };
        flatten(this.treeData);

        // ── חפש לפי מייל בספר הטלפונים ────────────────────────
        if (userEmail) {
            foundNode = allNodes.find(n => {
                const nodeEmail = (n.phoneInfo?.email || '').toLowerCase().trim();
                return nodeEmail && nodeEmail === userEmail;
            });
        }

        // ── חפש לפי שם אם לא נמצא מייל ───────────────────────
        if (!foundNode && userName) {
            foundNode = allNodes.find(n => {
                const nodeName = (n.employeeName || '').toLowerCase().trim();
                return nodeName === userName;
            });

            // חיפוש חלקי אם לא נמצאה התאמה מדויקת
            if (!foundNode) {
                foundNode = allNodes.find(n => {
                    const nodeName = (n.employeeName || '').toLowerCase().trim();
                    return nodeName.includes(userName) ||
                        userName.includes(nodeName);
                });
            }
        }

        // ── חפש לפי employeeId ────────────────────────────────
        if (!foundNode && userId) {
            foundNode = allNodes.find(n => {
                const nodeId = (n.employeeId || '').toLowerCase().trim();
                return nodeId === userId;
            });
        }

        if (foundNode) {
            // ── נמצא! הגדר כצומת פעיל ─────────────────────────
            this.activeNodeId = foundNode.employeeId;

            // ── פתח את הנתיב מהשורש עד היוזר ─────────────────
            this.pathNodes.clear();
            this.expandedNodes.clear();
            this._collectPathToRoot(foundNode.employeeId, this.treeData);
            this.pathNodes.forEach(id => this.expandedNodes.add(id));

        } else {
            // ── לא נמצא - הצג ראש העץ ─────────────────────────
            console.warn(
                '[OrgTree] לא נמצא יוזר מחובר בעץ, מציג ראש העץ.',
                { userEmail, userName, userId }
            );
            this._expandFirstLevels(this.treeData);
        }
    }

    // ══════════════════════════════════════════════════════════
    // בניית עץ מהנתונים
    // ══════════════════════════════════════════════════════════
    _buildTree(employees) {
        const map = {};
        const roots = [];

        // צור מפה של כל העובדים
        employees.forEach(emp => {
            map[emp.employeeId] = {
                ...emp,
                children: [],
                level: 0,
                phoneInfo: this._getPhoneInfo(emp.employeeName)
            };
        });

        // בנה קשרי הורה-ילד
        employees.forEach(emp => {
            if (emp.managerId && map[emp.managerId]) {
                map[emp.managerId].children.push(map[emp.employeeId]);
            } else if (!emp.managerId) {
                roots.push(map[emp.employeeId]);
            }
        });

        // חשב רמות
        const setLevels = (node, level) => {
            node.level = level;
            node.children.forEach(child => setLevels(child, level + 1));
        };

        roots.forEach(root => setLevels(root, 0));

        return roots;
    }

    _getPhoneInfo(name) {
        if (!name || !this.phoneData.length) return null;

        const nameLower = name.toLowerCase().trim();
        return this.phoneData.find(p => {
            const fullName = (p.fullName || '').toLowerCase().trim();
            return fullName === nameLower ||
                fullName.includes(nameLower) ||
                nameLower.includes(fullName);
        }) || null;
    }

    // ── הסרת פרמטר maxLevel שלא היה בשימוש ──────────────
    _expandFirstLevels(nodes) {
        // פתח רק את השורש - רמה אחת בלבד
        nodes.forEach(node => {
            if (node.children.length > 0) {
                this.expandedNodes.add(node.employeeId);
            }
        });
        // הגדר את השורש כצומת הפעיל
        if (nodes.length > 0) {
            this.activeNodeId = nodes[0].employeeId;
        }
    }

    _countDescendants(node) {
        let count = 0;
        const countRec = (n) => {
            count += n.children.length;
            n.children.forEach(countRec);
        };
        countRec(node);
        return count;
    }

    _getAllDescendantIds(node) {
        const ids = new Set();
        const collect = (n) => {
            ids.add(n.employeeId);
            n.children.forEach(collect);
        };
        node.children.forEach(collect);
        return ids;
    }

    _expandParentsOf(targetId, nodes, path = []) {
        for (const node of nodes) {
            if (node.employeeId === targetId) {
                path.forEach(id => this.expandedNodes.add(id));
                return true;
            }
            if (this._expandParentsOf(
                targetId,
                node.children,
                [...path, node.employeeId]
            )) {
                return true;
            }
        }
        return false;
    }

    // ══════════════════════════════════════════════════════════
    // רנדור Shell
    // ══════════════════════════════════════════════════════════
    renderShell() {
        this.container.innerHTML = `
        <div class="ot-root">

            <!-- Header -->
            <div class="ot-header">
                <div class="ot-header-left">
                    <div class="ot-search-wrap">
                        <i class="fas fa-search ot-search-icon"></i>
                        <input id="otSearch"
                               class="ot-search-input"
                               type="text"
                               placeholder="חיפוש עובד, תפקיד, מחלקה..."/>
                        <button id="otClearSearch"
                                class="ot-clear-btn"
                                style="display:none">
                            <i class="fas fa-times"></i>
                        </button>
                        <span id="otSearchCount"
                              class="ot-search-count"></span>
                    </div>
                </div>

                <div class="ot-header-right">
                    <div class="ot-stats-wrap" id="otStats"></div>

                    <div class="ot-view-btns">
                        <button class="ot-view-btn active"
                                id="otViewTree" title="עץ ארגוני">
                            <i class="fas fa-sitemap"></i>
                        </button>
                        <button class="ot-view-btn"
                                id="otViewTable" title="טבלה">
                            <i class="fas fa-table"></i>
                        </button>
                    </div>
                    <button id="otResetFocus" class="ot-ctrl-btn">
                        הצג הכל
                    </button>
                    <button id="otExpandAll"
                            class="ot-ctrl-btn"
                            title="פתח הכל">
                        <i class="fas fa-expand-alt"></i>
                        פתח הכל
                    </button>
                    <button id="otCollapseAll"
                            class="ot-ctrl-btn"
                            title="סגור הכל">
                        <i class="fas fa-compress-alt"></i>
                        סגור הכל
                    </button>
                    <button id="otRefreshBtn"
                            class="ot-ctrl-btn"
                            title="רענן">
                        <i class="fas fa-sync-alt"></i>
                    </button>
                    <button id="otExportBtn"
                            class="ot-ctrl-btn ot-export-btn"
                            title="ייצא לאקסל">
                        <i class="fas fa-file-excel"></i>
                    </button>
                </div>
            </div>

            <!-- Content -->
            <div id="otLoading" class="ot-loading" style="display:none">
                <i class="fas fa-spinner fa-spin"></i>
                טוען עץ ארגוני...
            </div>
            <div id="otError" class="ot-error" style="display:none"></div>
            <div id="otToast" class="ot-toast"></div>

            <div id="otContent" class="ot-content"></div>

            <!-- Modal Overlay -->
            <div id="otModalOverlay" class="ot-modal-overlay" style="display:none">
                <div id="otModal" class="ot-modal">
                    <div class="ot-modal-header">
                        <span class="ot-modal-title" id="otModalTitle">פרטי עובד</span>
                        <button id="otCloseModal" class="ot-modal-close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div id="otModalContent" class="ot-modal-content"></div>
                </div>
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    // רנדור תוכן
    // ══════════════════════════════════════════════════════════
    renderContent() {
        const content = document.getElementById('otContent');
        if (!content) return;

        if (!this.treeData || this.treeData.length === 0) {
            content.innerHTML = `
            <div class="ot-empty">
                <i class="fas fa-sitemap"></i>
                <p>לא נמצאו נתונים לעץ הארגוני</p>
            </div>`;
            return;
        }

        if (this.viewMode === 'table') {
            this._renderTable(content);
        } else {
            this._renderTree(content);
        }

        this._updateViewBtns();
    }

    // ══════════════════════════════════════════════════════════════
    // רנדור עץ
    // ══════════════════════════════════════════════════════════════
    _renderTree(container) {
        const isSearchMode = this.searchTerm &&
            this.searchTerm.trim().length >= 2;

        // ── מצב חיפוש עם activeNodeId ─────────────────────────
        if (isSearchMode && this.activeNodeId) {
            // ── שמור searchTerm זמנית כדי ש-_renderVerticalPath
            //        לא יכנס ללולאה אינסופית ─────────────────────
            const savedSearchTerm = this.searchTerm;
            this.searchTerm = '';

            const fullPath = this._getPathToNode(
                this.activeNodeId,
                this.treeData
            );

            this.searchTerm = savedSearchTerm;

            container.innerHTML = `
<div class="ot-tree-wrap">
    <div class="ot-tree">
        ${this._renderVerticalPath(fullPath)}
    </div>
</div>`;
            return;
        }

        // ── מצב חיפוש חופשי (ללא בחירה) ──────────────────────
        if (isSearchMode) {
            container.innerHTML = `
<div class="ot-tree-wrap ot-search-mode">
    <div class="ot-tree">
        ${this._renderTreeNodes(this.treeData, 0)}
    </div>
</div>`;
            return;
        }

        // ── מצב רגיל ──────────────────────────────────────────
        const fullPath = this._getPathToNode(
            this.activeNodeId,
            this.treeData
        );

        container.innerHTML = `
<div class="ot-tree-wrap">
    <div class="ot-tree">
        ${this._renderVerticalPath(fullPath)}
    </div>
</div>`;
    }

    // ── רנדור צמתים - עץ אנכי ─────────────────────────────────────
    _renderTreeNodes(nodes, level) {
        const isSearchMode = this.searchTerm &&
            this.searchTerm.trim().length >= 2;
        // ── סנן צמתים גלויים במצב חיפוש ──────────────────────────
        const visibleNodes = isSearchMode
            ? nodes.filter(n => this._isNodeVisible(n))
            : nodes;

        if (!visibleNodes || visibleNodes.length === 0) return '';

        // ── צומת יחיד - עמודה אנכית ───────────────────────────────
        if (visibleNodes.length === 1) {
            return this._renderSingleNode(visibleNodes[0], level);
        }

        // ── מספר צמתים - שורה אופקית ──────────────────────────────
        const cols = visibleNodes.map(node =>
            `<div class="ot-child-col">
            ${this._renderSingleNode(node, level)}
        </div>`
        ).join('');

        return `
    <div class="ot-children-row" style="position:relative">
        <div class="ot-h-line" id="hline_${level}_${Date.now()}"></div>
        ${cols}
    </div>`;
    }

    // ── רנדור צומת בודד ───────────────────────────────────────────
    _renderSingleNode(node, level) {

        const isSearchMode = this.searchTerm &&
            this.searchTerm.trim().length >= 2;
        const isExpanded = this.expandedNodes.has(node.employeeId);
        const hasChildren = node.children.length > 0;
        const isHighlighted = this.highlightedNodes.has(node.employeeId);
        const isFound = isSearchMode && isHighlighted;
        const isOnPath = isSearchMode && this.pathNodes.has(node.employeeId);
        const isSelected = this.selectedEmployee?.employeeId === node.employeeId;
        const phone = node.phoneInfo;
        const avatarColor = this._getAvatarColor(node.employeeId);
        const avatarLetter = this._getInitials(node.employeeName);
        const descendantCount = this._countDescendants(node);

        // ── קבע CSS classes לכרטיסייה ─────────────────────────────
        let nodeClasses = 'ot-node';
        if (level === 0) nodeClasses += ' ot-node-root';
        if (isFound) nodeClasses += ' ot-node-found';
        else if (isOnPath) nodeClasses += ' ot-node-path';
        if (isSelected) nodeClasses += ' ot-node-selected';

        // ── קבע נראות במצב חיפוש ──────────────────────────────────
        const wrapStyle = (isSearchMode && !isOnPath && !isFound)
            ? 'display:none'
            : '';

        // ── בנה ילדים ─────────────────────────────────────────────
        let childrenHtml = '';

        if (hasChildren) {

            // במצב חיפוש - הצג רק ילדים שבנתיב
            const childrenToShow = isSearchMode
                ? node.children.filter(c => this._isNodeVisible(c))
                : node.children;

            if (isExpanded && childrenToShow.length > 0) {

                const childrenContent =
                    this._renderTreeNodes(childrenToShow, level + 1);

                childrenHtml = `
            <div class="ot-connector-down"></div>
            <div class="ot-children-open">
                ${childrenContent}
            </div>`;
            }
        }

        return `
    <div class="ot-node-wrap"
         data-id="${this._esc(node.employeeId)}"
         data-level="${level}"
         style="${wrapStyle}">

        <!-- כרטיסייה -->
        <div class="${nodeClasses}"
             data-id="${this._esc(node.employeeId)}">

            <!-- אייקון אנשים (אם יש כפופים) -->
            ${hasChildren ? `
            <i class="fas fa-users ot-team-icon"
               title="${descendantCount} עובדים תחתיו"></i>
            ` : ''}

            <!-- אווטאר -->
            <div class="ot-avatar"
                 style="background:${avatarColor}">
                ${avatarLetter}
            </div>

            <!-- שם -->
            <div class="ot-node-name">
                ${this._highlightText(
            this._esc(node.employeeName || ''),
            this.searchTerm
        )}
            </div>

            <!-- תפקיד -->
            ${phone?.role ? `
            <div class="ot-node-role">
                ${this._esc(phone.role)}
            </div>` : `
            <div class="ot-node-id">
                ${this._esc(node.employeeId)}
            </div>`}

            <!-- מחלקה + צוות -->
            ${phone?.department || phone?.team ? `
            <div class="ot-node-dept">
                ${phone.department
                    ? `<span>${this._esc(phone.department)}</span>`
                    : ''}
                ${phone.team ? `
                <span class="ot-node-team">
                    ${this._esc(phone.team)}
                </span>` : ''}
            </div>` : ''}

            <!-- כפתור מידע -->
            <button class="ot-info-btn"
                    data-id="${this._esc(node.employeeId)}"
                    title="פרטים נוספים">
                <i class="fas fa-info"></i>
            </button>

            <!-- Badges טלפון/מייל -->
            <div class="ot-node-badges">
                ${phone?.phoneNumber ? `
                <a href="tel:${this._esc(phone.phoneNumber)}"
                   class="ot-badge ot-badge-phone"
                   title="${this._esc(phone.phoneNumber)}">
                    <i class="fas fa-phone"></i>
                </a>` : ''}
                ${phone?.email ? `
                <a href="mailto:${this._esc(phone.email)}"
                   class="ot-badge ot-badge-email"
                   title="${this._esc(phone.email)}">
                    <i class="fas fa-envelope"></i>
                </a>` : ''}
            </div>

            <!-- כפתור פתח/סגור -->
            ${hasChildren ? `
            <button class="ot-toggle-btn"
                    data-id="${this._esc(node.employeeId)}"
                    title="${isExpanded ? 'סגור' : 'פתח'}">
                <i class="fas fa-chevron-${isExpanded
                    ? 'up' : 'down'}"></i>
            </button>` : ''}
        </div>

        <!-- קו + ילדים -->
        ${childrenHtml}
    </div>`;
    }

    // ══════════════════════════════════════════════════════════════
    // חיפוש
    // ══════════════════════════════════════════════════════════════
    _search(term) {
        this.searchTerm = term;
        this.highlightedNodes.clear();
        this.pathNodes.clear();

        const countEl = document.getElementById('otSearchCount');

        if (!term || term.trim().length < 2) {
            if (countEl) countEl.textContent = '';
            this.renderContent();
            return;
        }

        const termLower = term.toLowerCase().trim();

        const findMatches = (nodes) => {
            nodes.forEach(node => {
                const nameMatch = (node.employeeName || '')
                    .toLowerCase().includes(termLower);
                const idMatch = (node.employeeId || '')
                    .toLowerCase().includes(termLower);
                const roleMatch = node.phoneInfo &&
                    (node.phoneInfo.role || '')
                        .toLowerCase().includes(termLower);
                const deptMatch = node.phoneInfo &&
                    (node.phoneInfo.department || '')
                        .toLowerCase().includes(termLower);

                if (nameMatch || idMatch || roleMatch || deptMatch) {
                    // סמן כנמצא
                    this.highlightedNodes.add(node.employeeId);
                }

                findMatches(node.children);
            });
        };

        findMatches(this.treeData);

        // ── שלב 2: בנה נתיב מכל תוצאה עד לשורש ──────────────────
        this.highlightedNodes.forEach(foundId => {
            this._collectPathToRoot(foundId, this.treeData);
        });

        // ── שלב 3: פתח את כל הצמתים בנתיב ───────────────────────
        this.pathNodes.forEach(id => {
            this.expandedNodes.add(id);
        });

        // ── עדכן count ────────────────────────────────────────────
        if (countEl) {
            const count = this.highlightedNodes.size;
            countEl.textContent = count > 0
                ? `${count} נמצאו`
                : 'לא נמצא';
            countEl.style.color = count > 0 ? '#22c55e' : '#ef4444';
        }

        this.renderContent();
    }

    // ── אסוף את כל הצמתים בנתיב מהצומת עד לשורש ─────────────────
    _collectPathToRoot(targetId, nodes, currentPath = []) {

        for (const node of nodes) {

            const newPath = [...currentPath, node.employeeId];

            if (node.employeeId === targetId) {
                // הוסף את כל הצמתים בנתיב
                newPath.forEach(id => this.pathNodes.add(id));
                return true;
            }

            if (this._collectPathToRoot(
                targetId,
                node.children,
                newPath
            )) {
                return true;
            }
        }

        return false;
    }

    _findNode(employeeId, nodes = this.treeData) {
        for (const node of nodes) {
            if (node.employeeId === employeeId) {
                return node;
            }

            const found = this._findNode(employeeId, node.children);
            if (found) return found;
        }

        return null;
    }

    _getPathToNode(targetId, nodes, path = []) {
        if (!targetId) return [];

        for (const node of nodes) {
            const newPath = [...path, node];
            if (node.employeeId === targetId) {
                return newPath;
            }
            const found = this._getPathToNode(
                targetId,
                node.children,
                newPath
            );
            if (found.length > 0) return found;
        }
        return [];
    }

    _renderVerticalPath(pathNodes) {
        if (!pathNodes || pathNodes.length === 0) {
            // אין נתיב - הצג שורש ישירות
            if (this.treeData.length === 1) {
                return this._renderSingleNode(this.treeData[0], 0) +
                    `<div class="ot-connector-down"></div>` +
                    this._renderDirectChildren(
                        this.treeData[0].children,
                        this.treeData[0].employeeId,
                        1
                    );
            }
            return this._renderDirectChildren(this.treeData, null, 0);
        }

        let html = '';
        const activeNode = pathNodes[pathNodes.length - 1];

        pathNodes.forEach((node, index) => {
            const isLast = index === pathNodes.length - 1;

            // ── רנדר את הצומת בנתיב ───────────────────────────────
            html += this._renderPathNode(node, index, isLast);

            // ── אחרי הצומת האחרון (הפעיל) - הצג כפופים ישירים ────
            if (isLast && node.children.length > 0) {
                html += `<div class="ot-connector-down"></div>`;
                html += this._renderDirectChildren(
                    node.children,
                    node.employeeId,
                    index + 1
                );
            }
            // ── בין צמתים בנתיב - קו חיבור בלבד ──────────────────
            else if (!isLast) {
                html += `<div class="ot-connector-down"></div>`;
            }
        });

        return html;
    }

    _renderPathNode(node, level, isActive) {
        const phone = node.phoneInfo;
        const avatarColor = this._getAvatarColor(node.employeeId);
        const avatarLetter = this._getInitials(node.employeeName);
        const hasChildren = node.children.length > 0;
        const descendantCount = this._countDescendants(node);
        const isSelected =
            this.selectedEmployee?.employeeId === node.employeeId;

        let nodeClasses = 'ot-node ot-node-in-path';
        if (level === 0) nodeClasses += ' ot-node-root';
        if (isActive) nodeClasses += ' ot-node-active';
        if (isSelected) nodeClasses += ' ot-node-selected';

        return `
<div class="ot-node-wrap"
     data-id="${this._esc(node.employeeId)}"
     data-level="${level}">

    <div class="${nodeClasses}"
         data-id="${this._esc(node.employeeId)}">

        ${hasChildren ? `
        <i class="fas fa-users ot-team-icon"
           title="${descendantCount} עובדים תחתיו"></i>
        ` : ''}

        <div class="ot-avatar"
             style="background:${avatarColor}">
            ${avatarLetter}
        </div>

        <div class="ot-node-name">
            ${this._esc(node.employeeName || '')}
        </div>

        ${phone?.role ? `
        <div class="ot-node-role">
            ${this._esc(phone.role)}
        </div>` : `
        <div class="ot-node-id">
            ${this._esc(node.employeeId)}
        </div>`}

        ${phone?.department || phone?.team ? `
        <div class="ot-node-dept">
            ${phone.department
                    ? `<span>${this._esc(phone.department)}</span>`
                    : ''}
            ${phone.team ? `
            <span class="ot-node-team">
                ${this._esc(phone.team)}
            </span>` : ''}
        </div>` : ''}

        <button class="ot-info-btn"
                data-id="${this._esc(node.employeeId)}"
                title="פרטים נוספים">
            <i class="fas fa-info"></i>
        </button>

        <div class="ot-node-badges">
            ${phone?.phoneNumber ? `
            <a href="tel:${this._esc(phone.phoneNumber)}"
               class="ot-badge ot-badge-phone"
               title="${this._esc(phone.phoneNumber)}">
                <i class="fas fa-phone"></i>
            </a>` : ''}
            ${phone?.email ? `
            <a href="mailto:${this._esc(phone.email)}"
               class="ot-badge ot-badge-email"
               title="${this._esc(phone.email)}">
                <i class="fas fa-envelope"></i>
            </a>` : ''}
        </div>
    </div>
</div>`;
    }

    _renderDirectChildren(children, parentId, level) {
        if (!children || children.length === 0) return '';

        const COLS_PER_ROW = 7; // מקסימום כרטיסיות בשורה

        // ── חלק לשורות ────────────────────────────────────────────
        const rows = [];
        for (let i = 0; i < children.length; i += COLS_PER_ROW) {
            rows.push(children.slice(i, i + COLS_PER_ROW));
        }

        const rowsHtml = rows.map((rowChildren, rowIndex) => {
            const cols = rowChildren.map(node => {
                const isSelected =
                    this.selectedEmployee?.employeeId === node.employeeId;
                const isActive = node.employeeId === this.activeNodeId;
                const avatarColor = this._getAvatarColor(node.employeeId);
                const avatarLetter = this._getInitials(node.employeeName);
                const phone = node.phoneInfo;
                const hasChildren = node.children.length > 0;
                const descendantCount = this._countDescendants(node);

                let nodeClasses = 'ot-node ot-node-direct-report';
                if (isSelected) nodeClasses += ' ot-node-selected';
                if (isActive) nodeClasses += ' ot-node-active-child';

                return `
<div class="ot-child-col">
    <div class="ot-node-wrap"
         data-id="${this._esc(node.employeeId)}"
         data-level="${level}">

        <div class="${nodeClasses}"
             data-id="${this._esc(node.employeeId)}">

            ${hasChildren ? `
            <i class="fas fa-users ot-team-icon"
               title="${descendantCount} עובדים תחתיו"></i>
            ` : ''}

            <div class="ot-avatar"
                 style="background:${avatarColor}">
                ${avatarLetter}
            </div>

            <div class="ot-node-name">
                ${this._esc(node.employeeName || '')}
            </div>

            ${phone?.role ? `
            <div class="ot-node-role">
                ${this._esc(phone.role)}
            </div>` : `
            <div class="ot-node-id">
                ${this._esc(node.employeeId)}
            </div>`}

            ${phone?.department || phone?.team ? `
            <div class="ot-node-dept">
                ${phone.department
                            ? `<span>${this._esc(phone.department)}</span>`
                            : ''}
                ${phone.team ? `
                <span class="ot-node-team">
                    ${this._esc(phone.team)}
                </span>` : ''}
            </div>` : ''}

            <button class="ot-info-btn"
                    data-id="${this._esc(node.employeeId)}"
                    title="פרטים נוספים">
                <i class="fas fa-info"></i>
            </button>

            <div class="ot-node-badges">
                ${phone?.phoneNumber ? `
                <a href="tel:${this._esc(phone.phoneNumber)}"
                   class="ot-badge ot-badge-phone"
                   title="${this._esc(phone.phoneNumber)}">
                    <i class="fas fa-phone"></i>
                </a>` : ''}
                ${phone?.email ? `
                <a href="mailto:${this._esc(phone.email)}"
                   class="ot-badge ot-badge-email"
                   title="${this._esc(phone.email)}">
                    <i class="fas fa-envelope"></i>
                </a>` : ''}
            </div>

            ${hasChildren ? `
            <div class="ot-node-expand-hint">
                <i class="fas fa-chevron-down"></i>
                ${descendantCount} תחתיו
            </div>` : ''}
        </div>
    </div>
</div>`;
            }).join('');

            // ── שורה בודדת ─────────────────────────────────────────
            return `
<div class="ot-direct-reports-row" data-row="${rowIndex}">
    <div class="ot-children-row ot-direct-reports">
        ${rowIndex === 0 ? `<div class="ot-h-line-direct"></div>` : ''}
        ${cols}
    </div>
</div>`;
        }).join('');

        return `
<div class="ot-direct-reports-container">
    ${rowsHtml}
</div>`;
    }

    _focusEmployee(employeeId) {
        this.focusedEmployeeId = employeeId;
        this.focusedNodes.clear();

        // העובד עצמו
        this.focusedNodes.add(employeeId);

        // כל הנתיב לשורש
        this._collectPathToRoot(employeeId, this.treeData);

        this.pathNodes.forEach(id => {
            this.focusedNodes.add(id);
        });

        // כל הכפופים
        const node = this._findNode(employeeId);

        if (node) {

            const descendants = this._getAllDescendantIds(node);

            descendants.forEach(id => {
                this.focusedNodes.add(id);
                this.expandedNodes.add(id);
            });

            this.expandedNodes.add(employeeId);
        }

        this.renderContent();
    }

    _clearFocus() {
        this.focusedEmployeeId = null;
        this.focusedNodes.clear();
        this.searchTerm = '';
        this.highlightedNodes.clear();

        if (this.pathNodes) this.pathNodes.clear();

        // חזור לשורש
        if (this.treeData && this.treeData.length > 0) {
            this.activeNodeId = this.treeData[0].employeeId;
        }

        const search = document.getElementById('otSearch');
        if (search) search.value = '';

        const clearBtn = document.getElementById('otClearSearch');
        if (clearBtn) clearBtn.style.display = 'none';

        const countEl = document.getElementById('otSearchCount');
        if (countEl) countEl.textContent = '';

        this._hideAutocomplete();
        this.renderContent();
    }

    // ── בדוק אם צומת גלוי במצב חיפוש ────────────────────────────
    _isNodeVisible(node) {

        // מצב היררכיה ממוקדת
        if (this.focusedEmployeeId) {
            return this.focusedNodes.has(node.employeeId);
        }

        const isSearchMode =
            this.searchTerm &&
            this.searchTerm.trim().length >= 2;

        if (!isSearchMode) {
            return true;
        }
        return this.pathNodes.has(node.employeeId)
            || this.highlightedNodes.has(node.employeeId);
    }

    // ══════════════════════════════════════════════════════════════
    // AUTOCOMPLETE - השלמה אוטומטית
    // ══════════════════════════════════════════════════════════════

    _initAutocomplete() {
        // צור את ה-dropdown
        const wrap = document.querySelector('.ot-search-wrap');
        if (!wrap) return;

        const dropdown = document.createElement('div');
        dropdown.id = 'otAutocomplete';
        dropdown.className = 'ot-autocomplete';
        wrap.appendChild(dropdown);

        this._autocompleteEl = dropdown;
        this._selectedSuggestionIndex = -1;
    }

    _showAutocomplete(term) {
        if (!this._autocompleteEl) return;

        if (!term || term.trim().length < 1) {
            this._hideAutocomplete();
            return;
        }

        const termLower = term.toLowerCase().trim();

        // ── אסוף כל העובדים ברשימה שטוחה ─────────────────────────
        const allNodes = [];
        const flatten = (nodes) => {
            nodes.forEach(node => {
                allNodes.push(node);
                flatten(node.children);
            });
        };
        flatten(this.treeData);

        // ── חפש התאמות ────────────────────────────────────────────
        const matches = [];

        for (const node of allNodes) {
            if (matches.length >= 8) break; // מקסימום 8 תוצאות

            const name = (node.employeeName || '').toLowerCase();
            const id = (node.employeeId || '').toLowerCase();
            const role = (node.phoneInfo?.role || '').toLowerCase();
            const dept = (node.phoneInfo?.department || '').toLowerCase();
            const team = (node.phoneInfo?.team || '').toLowerCase();

            const nameMatch = name.includes(termLower);
            const idMatch = id.includes(termLower);
            const roleMatch = role.includes(termLower);
            const deptMatch = dept.includes(termLower);
            const teamMatch = team.includes(termLower);

            if (nameMatch || idMatch || roleMatch || deptMatch || teamMatch) {

                // ── בנה תיאור משני ────────────────────────────────
                const parts = [];
                if (node.phoneInfo?.role) parts.push(node.phoneInfo.role);
                if (node.phoneInfo?.department) parts.push(node.phoneInfo.department);
                if (node.phoneInfo?.team) parts.push(node.phoneInfo.team);

                // ── מה התאים? (לתג) ───────────────────────────────
                let matchTag = '';
                if (!nameMatch && roleMatch) matchTag = 'תפקיד';
                if (!nameMatch && deptMatch) matchTag = 'מחלקה';
                if (!nameMatch && teamMatch) matchTag = 'צוות';
                if (!nameMatch && idMatch) matchTag = 'מזהה';

                matches.push({
                    node,
                    subtitle: parts.slice(0, 2).join(' · '),
                    matchTag,
                    score: nameMatch ? 2 : 1
                });
            }
        }

        // ── מיין - התאמות שם קודם ─────────────────────────────────
        matches.sort((a, b) => b.score - a.score);

        if (matches.length === 0) {
            this._autocompleteEl.innerHTML = `
        <div class="ot-ac-empty">
            <i class="fas fa-search"></i>
            לא נמצאו תוצאות עבור "${this._esc(term)}"
        </div>`;
            this._autocompleteEl.classList.add('ot-ac-open');
            return;
        }

        // ── בנה HTML ──────────────────────────────────────────────
        this._autocompleteEl.innerHTML = matches.map((m, i) => `
    <div class="ot-ac-item"
         data-id="${this._esc(m.node.employeeId)}"
         data-index="${i}">

        <div class="ot-ac-avatar"
             style="background:${this._getAvatarColor(m.node.employeeId)}">
            ${(m.node.employeeName || '?')[0]}
        </div>

        <div class="ot-ac-info">
            <div class="ot-ac-name">
                ${this._highlightText(
            this._esc(m.node.employeeName || ''),
            term
        )}
            </div>
            ${m.subtitle ? `
            <div class="ot-ac-subtitle">
                ${this._highlightText(
            this._esc(m.subtitle),
            term
        )}
            </div>` : ''}
        </div>

        ${m.matchTag ? `
        <span class="ot-ac-tag">${m.matchTag}</span>
        ` : ''}
    </div>`).join('');

        this._autocompleteEl.classList.add('ot-ac-open');
        this._selectedSuggestionIndex = -1;
    }

    _hideAutocomplete() {
        if (!this._autocompleteEl) return;
        this._autocompleteEl.classList.remove('ot-ac-open');
        this._selectedSuggestionIndex = -1;
    }

    _selectSuggestion(employeeId) {
        const allNodes = [];
        const flatten = (nodes) => {
            nodes.forEach(n => { allNodes.push(n); flatten(n.children); });
        };
        flatten(this.treeData);

        const node = allNodes.find(n => n.employeeId === employeeId);
        if (!node) return;

        const search = document.getElementById('otSearch');
        if (search) {
            search.value = node.employeeName;
            const clearBtn = document.getElementById('otClearSearch');
            if (clearBtn) clearBtn.style.display = 'flex';
        }

        this._hideAutocomplete();

        // ── נקה searchTerm כדי שתצוגת הנתיב תעבוד נכון ──────────
        this.searchTerm = '';  // ← שינוי: היה node.employeeName

        if (!this.pathNodes) this.pathNodes = new Set();
        this.pathNodes.clear();
        this.highlightedNodes.clear();
        this.expandedNodes.clear();

        // סמן את העובד כנמצא
        this.highlightedNodes.add(employeeId);

        // בנה נתיב מהעובד עד לשורש
        this._collectPathToRoot(employeeId, this.treeData);

        // פתח את כל הצמתים בנתיב
        this.pathNodes.forEach(id => {
            this.expandedNodes.add(id);
        });

        // ── הגדר כצומת פעיל לתצוגת עץ ───────────────────────────
        this.activeNodeId = employeeId;

        const countEl = document.getElementById('otSearchCount');
        if (countEl) countEl.textContent = '';

        this.renderContent();

        setTimeout(() => {
            const el = document.querySelector(
                `.ot-node[data-id="${CSS.escape(employeeId)}"]`
            );
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 300);
    }

    // ══════════════════════════════════════════════════════════════
    // עדכון bindEvents - הוסף autocomplete events
    // ══════════════════════════════════════════════════════════════
    bindEvents() {

        document.addEventListener('click', e => {

            // ── 1. כפתור מידע - חייב להיות ראשון ─────────────────────
            const infoBtn = e.target.closest('.ot-info-btn');
            if (infoBtn) {
                e.stopPropagation();
                e.preventDefault();
                this._openSidePanel(infoBtn.dataset.id);
                return;
            }

            // ── 2. Badge טלפון/מייל - אל תפתח side panel ─────────────
            const badge = e.target.closest('.ot-badge-phone, .ot-badge-email');
            if (badge) {
                e.stopPropagation();
                // תן לקישור לפעול רגיל (tel: / mailto:)
                return;
            }

            // ── 3. כפתור toggle עץ ────────────────────────────────────
            const toggleBtn = e.target.closest('.ot-toggle-btn');
            if (toggleBtn) {
                e.stopPropagation();
                this.toggleNode(toggleBtn.dataset.id);
                return;
            }

            // ── 4. כפתור toggle טבלה ──────────────────────────────────
            const tableToggle = e.target.closest('.ot-table-toggle');
            if (tableToggle) {
                e.stopPropagation();
                this.toggleNode(tableToggle.dataset.id);
                return;
            }

            // ── 5. לחיצה על צומת - הפוך לפעיל ────────────────────────
            const node = e.target.closest('.ot-node');
            if (node && node.dataset.id) {
                const empId = node.dataset.id;

                this.activeNodeId = empId;
                this.selectedEmployee = null;
                this.renderContent();

                setTimeout(() => {
                    const el = document.querySelector(
                        `.ot-node[data-id="${CSS.escape(empId)}"]`
                    );
                    if (el) {
                        el.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center'
                        });
                    }
                }, 100);
                return;
            }

            // ── 6. לחיצה על פריט autocomplete ─────────────────────────
            const acItem = e.target.closest('.ot-ac-item');
            if (acItem) {
                this._selectSuggestion(acItem.dataset.id);
                return;
            }

            // ── 7. לחיצה מחוץ ל-autocomplete - סגור ──────────────────
            if (!e.target.closest('.ot-search-wrap')) {
                this._hideAutocomplete();
            }
        });

        document.getElementById('otResetFocus')
            ?.addEventListener('click', () => {
                this._clearFocus();
            });


        // ── Search Input ──────────────────────────────────────────
        const search = document.getElementById('otSearch');

        if (search) {
            // ── הקלדה ─────────────────────────────────────────────
            search.addEventListener('input', e => {
                const value = e.target.value;

                const clearBtn = document.getElementById('otClearSearch');
                if (clearBtn) {
                    clearBtn.style.display = value ? 'flex' : 'none';
                }

                // הצג autocomplete
                this._showAutocomplete(value);

                // חיפוש רק אם נבחר מהרשימה או Enter
                // (לא בכל הקלדה - רק autocomplete)
            });

            // ── מקשי מקלדת ────────────────────────────────────────
            search.addEventListener('keydown', e => {
                const items = this._autocompleteEl
                    ?.querySelectorAll('.ot-ac-item');

                if (!items || items.length === 0) {
                    // Enter ללא autocomplete - חפש ישירות
                    if (e.key === 'Enter') {
                        this._hideAutocomplete();
                        this._search(search.value);
                    }
                    return;
                }

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this._selectedSuggestionIndex = Math.min(
                        this._selectedSuggestionIndex + 1,
                        items.length - 1
                    );
                    this._updateSuggestionHighlight(items);
                }
                else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this._selectedSuggestionIndex = Math.max(
                        this._selectedSuggestionIndex - 1,
                        -1
                    );
                    this._updateSuggestionHighlight(items);
                }
                else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (this._selectedSuggestionIndex >= 0 &&
                        items[this._selectedSuggestionIndex]) {
                        const id = items[this._selectedSuggestionIndex]
                            .dataset.id;
                        this._selectSuggestion(id);
                    } else {
                        // Enter ללא בחירה - חפש טקסט חופשי
                        this._hideAutocomplete();
                        this._search(search.value);
                    }
                }
                else if (e.key === 'Escape') {
                    this._hideAutocomplete();
                }
            });

            // ── Focus - הצג שוב אם יש טקסט ───────────────────────
            search.addEventListener('focus', e => {
                if (e.target.value.trim().length >= 1) {
                    this._showAutocomplete(e.target.value);
                }
            });
        }

        // ── Clear Button ──────────────────────────────────────────
        document.getElementById('otClearSearch')
            ?.addEventListener('click', () => {
                if (search) search.value = '';
                this._search('');
                this._hideAutocomplete();
                const clearBtn = document.getElementById('otClearSearch');
                if (clearBtn) clearBtn.style.display = 'none';
            });

        document.getElementById('otExpandAll')
            ?.addEventListener('click', () => this.expandAll());

        document.getElementById('otCollapseAll')
            ?.addEventListener('click', () => this.collapseAll());

        document.getElementById('otRefreshBtn')
            ?.addEventListener('click', () => this.loadData());

        document.getElementById('otViewTree')
            ?.addEventListener('click', () => {
                this.viewMode = 'tree';
                this.renderContent();
            });

        document.getElementById('otViewTable')
            ?.addEventListener('click', () => {
                this.viewMode = 'table';

                // אם יש חיפוש פעיל - וודא שהנתיב בנוי
                if (this.searchTerm &&
                    this.searchTerm.trim().length >= 2 &&
                    this.pathNodes.size === 0) {

                    // בנה נתיב מחדש
                    this.highlightedNodes.forEach(foundId => {
                        this._collectPathToRoot(foundId, this.treeData);
                    });
                    this.pathNodes.forEach(id => {
                        this.expandedNodes.add(id);
                    });
                }

                this.renderContent();
            });

        document.getElementById('otCloseModal')
            ?.addEventListener('click', () => this._closeSidePanel());

        // Close on overlay click
        document.getElementById('otModalOverlay')
            ?.addEventListener('click', (e) => {
                if (e.target.id === 'otModalOverlay') this._closeSidePanel();
            });

        document.getElementById('otExportBtn')
            ?.addEventListener('click', () => this.exportToExcel());
    }

    // ── עדכן הדגשת פריט נבחר ─────────────────────────────────────
    _updateSuggestionHighlight(items) {
        items.forEach((item, i) => {
            item.classList.toggle(
                'ot-ac-item-active',
                i === this._selectedSuggestionIndex
            );
        });
    }

    _highlightText(text, term) {
        if (!term || term.trim().length < 2) return text;
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(
            new RegExp(`(${escaped})`, 'gi'),
            '<mark class="ot-highlight">$1</mark>'
        );
    }

    _getAvatarColor(id) {
        const colors = [
            '#6366f1', '#3b82f6', '#22c55e', '#f59e0b',
            '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16',
            '#f43f5e', '#10b981'
        ];
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    // ══════════════════════════════════════════════════════════
    // רנדור טבלה
    // ══════════════════════════════════════════════════════════
    _renderTable(container) {
        // שטח את העץ לרשימה
        const flat = [];
        const flatten = (nodes, level = 0, parentName = '') => {
            nodes.forEach(node => {
                flat.push({ ...node, level, parentName });
                if (this.expandedNodes.has(node.employeeId)) {
                    flatten(node.children, level + 1, node.employeeName);
                }
            });
        };
        flatten(this.treeData);

        const rowsHtml = flat.map(node => {
            const phone = node.phoneInfo;
            const indent = node.level * 20;
            const isHighlighted = this.highlightedNodes.has(node.employeeId);

            return `
            <tr class="ot-table-row
                        ${isHighlighted ? 'ot-table-row-highlighted' : ''}"
                data-id="${this._esc(node.employeeId)}">
                <td class="ot-table-td" style="padding-right:${indent + 12}px">
                    <div style="display:flex;align-items:center;gap:8px">
                        ${node.children.length > 0 ? `
                        <button class="ot-table-toggle"
                                data-id="${this._esc(node.employeeId)}">
                            <i class="fas fa-chevron-${this.expandedNodes.has(node.employeeId)
                        ? 'down' : 'left'}"></i>
                        </button>` : '<span style="width:20px"></span>'}
                        <div class="ot-avatar ot-avatar-sm"
                             style="background:${this._getAvatarColor(node.employeeId)}">
                            ${this._getInitials(node.employeeName)}
                        </div>
                        <span class="ot-table-name">
                            ${this._highlightText(
                            this._esc(node.employeeName || ''),
                            this.searchTerm
                        )}
                        </span>
                    </div>
                </td>
                <td class="ot-table-td">
                    ${this._esc(phone?.role || '—')}
                </td>
                <td class="ot-table-td">
                    ${this._esc(phone?.department || '—')}
                </td>
                <td class="ot-table-td">
                    ${this._esc(phone?.team || '—')}
                </td>
                <td class="ot-table-td">
                    ${phone?.phoneNumber
                    ? `<a href="tel:${this._esc(phone.phoneNumber)}"
                              class="ot-phone-link">
                               <i class="fas fa-phone"></i>
                               ${this._esc(phone.phoneNumber)}
                           </a>`
                    : '—'}
                </td>
                <td class="ot-table-td">
                    ${phone?.email
                    ? `<a href="mailto:${this._esc(phone.email)}"
                              class="ot-email-link">
                               <i class="fas fa-envelope"></i>
                               ${this._esc(phone.email)}
                           </a>`
                    : '—'}
                </td>
                <td class="ot-table-td ot-table-td-center">
                    ${node.children.length > 0
                    ? `<span class="ot-badge ot-badge-children">
                               ${this._countDescendants(node)}
                           </span>`
                    : '—'}
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
        <div class="ot-table-wrap">
            <table class="ot-table">
                <thead>
                    <tr>
                        <th class="ot-table-th">שם עובד</th>
                        <th class="ot-table-th">תפקיד</th>
                        <th class="ot-table-th">מחלקה</th>
                        <th class="ot-table-th">צוות</th>
                        <th class="ot-table-th">טלפון</th>
                        <th class="ot-table-th">מייל</th>
                        <th class="ot-table-th ot-table-th-center">
                            כפופים ישירים
                        </th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;
    }

    _getInitials(name) {
        const names = (name || '').trim().split(/\s+/);

        return names.length > 1
            ? names[0][0] + names[names.length - 1][0]
            : (names[0]?.[0] || '?');
    }

    // ══════════════════════════════════════════════════════════
    // Side Panel - פרטי עובד
    // ══════════════════════════════════════════════════════════
    _openSidePanel(employeeId) {
        const findNode = (nodes) => {
            for (const node of nodes) {
                if (node.employeeId === employeeId) return node;
                const found = findNode(node.children);
                if (found) return found;
            }
            return null;
        };

        const node = findNode(this.treeData);
        if (!node) return;

        this.selectedEmployee = node;

        // Highlight selected card
        document.querySelectorAll('.ot-node-selected')
            .forEach(el => el.classList.remove('ot-node-selected'));
        document.querySelectorAll(
            `.ot-node[data-id="${CSS.escape(employeeId)}"]`
        ).forEach(el => el.classList.add('ot-node-selected'));

        const overlay = document.getElementById('otModalOverlay');
        const title = document.getElementById('otModalTitle');
        const content = document.getElementById('otModalContent');
        if (!overlay || !content) return;

        title.textContent = node.employeeName || 'פרטי עובד';

        const phone = node.phoneInfo;
        const directReports = node.children.length;
        const totalReports = this._countDescendants(node);

        content.innerHTML = `
    <div class="ot-sp-section">
        <div class="ot-sp-avatar"
             style="background:${this._getAvatarColor(node.employeeId)}">
            ${this._getInitials(node.employeeName)}
        </div>
        <div class="ot-sp-name">${this._esc(node.employeeName || '')}</div>
        <div class="ot-sp-id">${this._esc(node.employeeId)}</div>
    </div>

    ${phone ? `
    <div class="ot-sp-section">
        <div class="ot-sp-section-title">
            <i class="fas fa-id-card"></i> פרטי תפקיד
        </div>
        ${phone.role ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label"><i class="fas fa-briefcase"></i> תפקיד</span>
            <span class="ot-sp-value">${this._esc(phone.role)}</span>
        </div>` : ''}
        ${phone.team ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label"><i class="fas fa-users"></i> צוות</span>
            <span class="ot-sp-value">${this._esc(phone.team)}</span>
        </div>` : ''}
        ${phone.department ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label"><i class="fas fa-building"></i> מחלקה</span>
            <span class="ot-sp-value">${this._esc(phone.department)}</span>
        </div>` : ''}
        ${phone.domain ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label"><i class="fas fa-sitemap"></i> תחום</span>
            <span class="ot-sp-value">${this._esc(phone.domain)}</span>
        </div>` : ''}

        ${phone.division ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label"><i class="fas fa-project-diagram"></i> אגף</span>
            <span class="ot-sp-value">${this._esc(phone.division)}</span>
        </div>` : ''}
    </div>

    <div class="ot-sp-section">
        <div class="ot-sp-section-title">
            <i class="fas fa-address-book"></i> יצירת קשר
        </div>
        ${phone.phoneNumber ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label">טלפון</span>
            <a href="tel:${this._esc(phone.phoneNumber)}"
               class="ot-sp-link">
                <i class="fas fa-phone"></i>
                ${this._esc(phone.phoneNumber)}
            </a>
        </div>` : ''}
        ${phone.email ? `
        <div class="ot-sp-row">
            <span class="ot-sp-label">מייל</span>
            <a href="mailto:${this._esc(phone.email)}"
               class="ot-sp-link">
                <i class="fas fa-envelope"></i>
                ${this._esc(phone.email)}
            </a>
        </div>` : ''}
    </div>` : ''}

    <div class="ot-sp-section">
        <div class="ot-sp-section-title">
            <i class="fas fa-sitemap"></i> מבנה ארגוני
        </div>
        <div class="ot-sp-stat-grid">
            <div class="ot-sp-stat">
                <div class="ot-sp-stat-value">${directReports}</div>
                <div class="ot-sp-stat-label">כפופים ישירים</div>
            </div>
            <div class="ot-sp-stat">
                <div class="ot-sp-stat-value">${totalReports}</div>
                <div class="ot-sp-stat-label">סה"כ תחתיו</div>
            </div>
        </div>
    </div>`;

        overlay.style.display = 'flex';
        // Trigger animation
        requestAnimationFrame(() => overlay.classList.add('ot-modal-open'));
    }

    _closeSidePanel() {
        const overlay = document.getElementById('otModalOverlay');
        if (overlay) {
            overlay.classList.remove('ot-modal-open');
            setTimeout(() => { overlay.style.display = 'none'; }, 250);
        }
        this.selectedEmployee = null;
        document.querySelectorAll('.ot-node-selected')
            .forEach(el => el.classList.remove('ot-node-selected'));
    }


    toggleNode(employeeId) {

        if (this.expandedNodes.has(employeeId)) {
            this.expandedNodes.delete(employeeId);
        } else {
            this.expandedNodes.add(employeeId);
        }

        this.renderContent();
    }

    expandAll() {

        const expand = nodes => {
            nodes.forEach(node => {
                if (node.children.length > 0) {
                    this.expandedNodes.add(node.employeeId);
                    expand(node.children);
                }
            });
        };

        expand(this.treeData);
        this.renderContent();
    }

    collapseAll() {

        this.expandedNodes.clear();

        this.treeData.forEach(root => {
            if (root.children.length > 0) {
                this.expandedNodes.add(root.employeeId);
            }
        });

        this.renderContent();
    }

    _updateStats() {

        const stats = document.getElementById('otStats');

        if (!stats) return;

        const managers = this.employees.filter(x =>
            this.employees.some(y => y.managerId === x.employeeId)
        ).length;

        stats.innerHTML = `
        <div class="ot-stat">
            <span class="ot-stat-value">
                ${this.employees.length}
            </span>
            <span class="ot-stat-label">
                עובדים
            </span>
        </div>

        <div class="ot-stat">
            <span class="ot-stat-value">
                ${managers}
            </span>
            <span class="ot-stat-label">
                מנהלים
            </span>
        </div>`;
    }

    async _loadExcelJS() {
        if (typeof ExcelJS === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.3.0/exceljs.min.js';
                s.onload = res;
                s.onerror = () => rej(new Error('נכשלה טעינת ExcelJS'));
                document.head.appendChild(s);
            });
        }
        if (typeof saveAs === 'undefined') {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js';
                s.onload = res;
                s.onerror = () => rej(new Error('נכשלה טעינת FileSaver'));
                document.head.appendChild(s);
            });
        }
    }

    async exportToExcel() {
        try {
            await this._loadExcelJS();

            const wb = new ExcelJS.Workbook();
            wb.creator = 'NOC Portal';
            wb.created = new Date();

            // ── צבעים ──────────────────────────────────────────────
            const C = {
                headerBg: '320F5B',
                headerFont: 'FFFFFF',
                subBg: '7c6fcd',
                subFont: 'FFFFFF',
                rootBg: 'EDE9FE',
                rootFont: '4C1D95',
                managerBg: 'F0F9FF',
                managerFont: '0C4A6E',
                leafBg: 'FFFFFF',
                leafFont: '334155',
                altBg: 'F8F6FF',
                borderColor: 'D0D5DD',
            };

            const thinBorder = () => ({
                top: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                bottom: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                left: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
                right: { style: 'thin', color: { argb: 'FF' + C.borderColor } },
            });

            const applyStyle = (cell, {
                bgColor = null, fontColor = '000000',
                bold = false, hAlign = 'center',
                fontSize = 10, wrapText = false, italic = false,
            } = {}) => {
                cell.font = {
                    name: 'Arial', size: fontSize, bold, italic,
                    color: { argb: 'FF' + fontColor },
                };
                cell.alignment = {
                    horizontal: hAlign, vertical: 'middle',
                    wrapText, readingOrder: 'rightToLeft',
                };
                cell.border = thinBorder();
                if (bgColor) {
                    cell.fill = {
                        type: 'pattern', pattern: 'solid',
                        fgColor: { argb: 'FF' + bgColor },
                    };
                }
            };

            // ════════════════════════════════════════════════════════
            // גליון 1 - עץ ארגוני (היררכי)
            // ════════════════════════════════════════════════════════
            const wsTree = wb.addWorksheet('עץ ארגוני', {
                views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
                properties: { defaultRowHeight: 18 },
            });

            const treeCols = [16, 28, 22, 20, 18, 22, 22, 10];
            const treeHeaders = [
                'מזהה עובד', 'שם עובד', 'תפקיד', 'מחלקה',
                'צוות', 'טלפון', 'מייל', 'רמה',
            ];

            // כותרת ראשית
            wsTree.mergeCells(1, 1, 1, treeHeaders.length);
            const titleCell = wsTree.getCell(1, 1);
            titleCell.value = `עץ ארגוני - ${new Date().toLocaleDateString('he-IL')}`;
            applyStyle(titleCell, {
                bgColor: C.headerBg, fontColor: C.headerFont,
                bold: true, fontSize: 14,
            });
            wsTree.getRow(1).height = 30;

            // כותרות עמודות
            treeHeaders.forEach((h, i) => {
                const cell = wsTree.getCell(2, i + 1);
                cell.value = h;
                applyStyle(cell, {
                    bgColor: C.subBg, fontColor: C.subFont,
                    bold: true, fontSize: 11,
                });
                wsTree.getColumn(i + 1).width = treeCols[i];
            });
            wsTree.getRow(2).height = 22;

            // נתונים - שטח את העץ
            let treeRow = 3;
            let altToggle = false;

            const flattenForExcel = (nodes, level = 0) => {
                nodes.forEach(node => {
                    const phone = node.phoneInfo;
                    const indent = '  '.repeat(level);
                    const prefix = level === 0 ? '◆ ' :
                        level === 1 ? '├─ ' :
                            level === 2 ? '│  ├─ ' :
                                '│  │  └─ ';

                    // קבע צבעי שורה לפי רמה
                    let rowBg, rowFont;
                    if (level === 0) {
                        rowBg = C.rootBg; rowFont = C.rootFont;
                    } else if (node.children.length > 0) {
                        rowBg = C.managerBg; rowFont = C.managerFont;
                    } else {
                        rowBg = altToggle ? C.altBg : C.leafBg;
                        rowFont = C.leafFont;
                        altToggle = !altToggle;
                    }

                    const rowData = [
                        node.employeeId || '',
                        prefix + (node.employeeName || ''),
                        phone?.role || '',
                        phone?.department || '',
                        phone?.team || '',
                        phone?.phoneNumber || '',
                        phone?.email || '',
                        level,
                    ];

                    rowData.forEach((val, colIdx) => {
                        const cell = wsTree.getCell(treeRow, colIdx + 1);
                        cell.value = val;
                        applyStyle(cell, {
                            bgColor: rowBg,
                            fontColor: rowFont,
                            bold: level === 0,
                            hAlign: colIdx === 7 ? 'center' :
                                colIdx === 0 ? 'center' : 'right',
                            wrapText: colIdx === 1,
                            fontSize: level === 0 ? 11 : 10,
                        });
                    });

                    wsTree.getRow(treeRow).height =
                        level === 0 ? 22 : 18;
                    treeRow++;

                    // רקורסיה לילדים
                    flattenForExcel(node.children, level + 1);
                });
            };

            flattenForExcel(this.treeData);

            // שורת סיכום
            wsTree.mergeCells(treeRow, 1, treeRow, treeHeaders.length);
            const sumCell = wsTree.getCell(treeRow, 1);
            const managers = this.employees.filter(x =>
                this.employees.some(y => y.managerId === x.employeeId)
            ).length;
            sumCell.value =
                `סה"כ: ${this.employees.length} עובדים | ` +
                `${managers} מנהלים | ` +
                `${this.treeData.length} שורשים`;
            applyStyle(sumCell, {
                bgColor: C.headerBg, fontColor: C.headerFont,
                bold: true, fontSize: 11,
            });
            wsTree.getRow(treeRow).height = 22;

            // ════════════════════════════════════════════════════════
            // גליון 2 - רשימה שטוחה
            // ════════════════════════════════════════════════════════
            const wsFlat = wb.addWorksheet('רשימת עובדים', {
                views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
                properties: { defaultRowHeight: 18 },
            });

            const flatCols = [16, 26, 26, 22, 20, 18, 22, 22, 8];
            const flatHeaders = [
                'מזהה עובד', 'שם עובד', 'שם מנהל',
                'תפקיד', 'מחלקה', 'צוות',
                'טלפון', 'מייל', 'רמה',
            ];

            // כותרת ראשית
            wsFlat.mergeCells(1, 1, 1, flatHeaders.length);
            const flatTitle = wsFlat.getCell(1, 1);
            flatTitle.value = `רשימת עובדים - ${new Date().toLocaleDateString('he-IL')}`;
            applyStyle(flatTitle, {
                bgColor: C.headerBg, fontColor: C.headerFont,
                bold: true, fontSize: 14,
            });
            wsFlat.getRow(1).height = 30;

            // כותרות
            flatHeaders.forEach((h, i) => {
                const cell = wsFlat.getCell(2, i + 1);
                cell.value = h;
                applyStyle(cell, {
                    bgColor: C.subBg, fontColor: C.subFont,
                    bold: true, fontSize: 11,
                });
                wsFlat.getColumn(i + 1).width = flatCols[i];
            });
            wsFlat.getRow(2).height = 22;

            // נתונים שטוחים
            const flatRows = [];
            const flattenSimple = (nodes, level = 0, parentName = '') => {
                nodes.forEach(node => {
                    const phone = node.phoneInfo;
                    flatRows.push({
                        id: node.employeeId || '',
                        name: node.employeeName || '',
                        manager: parentName,
                        role: phone?.role || '',
                        dept: phone?.department || '',
                        team: phone?.team || '',
                        phone: phone?.phoneNumber || '',
                        email: phone?.email || '',
                        level: level,
                        hasChildren: node.children.length > 0,
                    });
                    flattenSimple(node.children, level + 1, node.employeeName);
                });
            };
            flattenSimple(this.treeData);

            flatRows.forEach((row, idx) => {
                const excelRow = idx + 3;
                const isAlt = idx % 2 === 1;
                const rowBg = row.hasChildren
                    ? C.managerBg
                    : (isAlt ? C.altBg : C.leafBg);
                const rowFont = row.hasChildren ? C.managerFont : C.leafFont;

                const vals = [
                    row.id, row.name, row.manager,
                    row.role, row.dept, row.team,
                    row.phone, row.email, row.level,
                ];

                vals.forEach((val, colIdx) => {
                    const cell = wsFlat.getCell(excelRow, colIdx + 1);
                    cell.value = val;
                    applyStyle(cell, {
                        bgColor: rowBg,
                        fontColor: rowFont,
                        bold: row.hasChildren && colIdx === 1,
                        hAlign: colIdx === 8 ? 'center' :
                            colIdx === 0 ? 'center' : 'right',
                        fontSize: 10,
                    });
                });

                wsFlat.getRow(excelRow).height = 18;
            });

            // סיכום
            const flatSumRow = flatRows.length + 3;
            wsFlat.mergeCells(flatSumRow, 1, flatSumRow, flatHeaders.length);
            const flatSum = wsFlat.getCell(flatSumRow, 1);
            flatSum.value = `סה"כ ${flatRows.length} עובדים`;
            applyStyle(flatSum, {
                bgColor: C.headerBg, fontColor: C.headerFont,
                bold: true, fontSize: 11,
            });
            wsFlat.getRow(flatSumRow).height = 22;

            // ════════════════════════════════════════════════════════
            // גליון 3 - לפי מחלקה
            // ════════════════════════════════════════════════════════
            const wsDept = wb.addWorksheet('לפי מחלקה', {
                views: [{ rightToLeft: true, state: 'frozen', ySplit: 2 }],
                properties: { defaultRowHeight: 18 },
            });

            const deptCols = [22, 26, 22, 18, 22, 22];
            const deptHeaders = [
                'מחלקה', 'שם עובד', 'תפקיד',
                'צוות', 'טלפון', 'מייל',
            ];

            // כותרת
            wsDept.mergeCells(1, 1, 1, deptHeaders.length);
            const deptTitle = wsDept.getCell(1, 1);
            deptTitle.value = `עובדים לפי מחלקה - ${new Date().toLocaleDateString('he-IL')}`;
            applyStyle(deptTitle, {
                bgColor: C.headerBg, fontColor: C.headerFont,
                bold: true, fontSize: 14,
            });
            wsDept.getRow(1).height = 30;

            deptHeaders.forEach((h, i) => {
                const cell = wsDept.getCell(2, i + 1);
                cell.value = h;
                applyStyle(cell, {
                    bgColor: C.subBg, fontColor: C.subFont,
                    bold: true, fontSize: 11,
                });
                wsDept.getColumn(i + 1).width = deptCols[i];
            });
            wsDept.getRow(2).height = 22;

            // קבץ לפי מחלקה
            const byDept = {};
            flatRows.forEach(row => {
                const dept = row.dept || 'ללא מחלקה';
                if (!byDept[dept]) byDept[dept] = [];
                byDept[dept].push(row);
            });

            const deptColors = [
                'EDE9FE', 'E0F2FE', 'ECFDF5', 'FEF9C3',
                'FEE2E2', 'F0FDF4', 'FDF4FF', 'FFF7ED',
            ];

            let deptRow = 3;
            let deptColorIdx = 0;

            Object.entries(byDept)
                .sort(([a], [b]) => a.localeCompare(b, 'he'))
                .forEach(([dept, emps]) => {
                    const deptBg = deptColors[deptColorIdx % deptColors.length];
                    deptColorIdx++;

                    emps.forEach((emp, empIdx) => {
                        const isFirst = empIdx === 0;
                        const vals = [
                            isFirst ? dept : '',
                            emp.name, emp.role,
                            emp.team, emp.phone, emp.email,
                        ];

                        vals.forEach((val, colIdx) => {
                            const cell = wsDept.getCell(deptRow, colIdx + 1);
                            cell.value = val;
                            applyStyle(cell, {
                                bgColor: colIdx === 0 ? deptBg : 'FFFFFF',
                                fontColor: colIdx === 0 ? '4C1D95' : C.leafFont,
                                bold: colIdx === 0 && isFirst,
                                hAlign: 'right',
                                fontSize: 10,
                            });
                        });

                        wsDept.getRow(deptRow).height = 18;
                        deptRow++;
                    });
                });

            // ── הורד ──────────────────────────────────────────────
            const buffer = await wb.xlsx.writeBuffer();
            const blob = new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            const fileName =
                `OrgTree_${new Date().toISOString().slice(0, 10)}.xlsx`;
            saveAs(blob, fileName);

            this.showToast('קובץ Excel יוצא בהצלחה!');

        } catch (err) {
            console.error('שגיאה בייצוא Excel:', err);
            this.showToast('שגיאה בייצוא: ' + err.message);
        }
    }

    showLoading(show) {

        const loading = document.getElementById('otLoading');

        if (loading) {
            loading.style.display = show ? 'flex' : 'none';
        }
    }

    showError(message) {

        const error = document.getElementById('otError');

        if (!error) return;

        error.textContent = message;
        error.style.display = 'block';
    }

    showToast(message) {

        const toast = document.getElementById('otToast');

        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    _updateViewBtns() {

        document.querySelectorAll('.ot-view-btn')
            .forEach(btn => btn.classList.remove('active'));

        if (this.viewMode === 'tree') {
            document.getElementById('otViewTree')
                ?.classList.add('active');
        } else {
            document.getElementById('otViewTable')
                ?.classList.add('active');
        }
    }

    _esc(value) {

        const div = document.createElement('div');
        div.textContent = value || '';
        return div.innerHTML;
    }

    addStyles() {

        if (document.getElementById('org-tree-dashboard-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'org-tree-dashboard-styles';

        style.textContent = `

        /* ═══════════════════════════════════════════════════════════════
        OrgTree Dashboard - Vertical Tree Style
        ═══════════════════════════════════════════════════════════════ */

        .ot-root {
            direction: rtl;
            font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
            background: #f5f5f5;
            min-height: 100%;
            padding: 0;
            box-sizing: border-box;
        }

        /* ══════════════════════════════════════════════════════════════
        HEADER
        ══════════════════════════════════════════════════════════════ */
        .ot-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 7px 14px;
            background: white;
            border-bottom: 1px solid #e8e8e8;
            flex-wrap: wrap;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0,0,0,.06);
        }

        .ot-header-left {
            display: flex;
            align-items: center;
            gap: 10px;
            flex: 1;
            min-width: 260px;
        }

        .ot-header-right {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }

        /* ── Search ───────────────────────────────────────────────────── */
        .ot-search-wrap {
            position: relative;
            display: flex;
            align-items: center;
            flex: 1;
            max-width: 460px;
        }

        .ot-search-icon {
            position: absolute;
            right: 16px;
            color: #aaa;
            font-size: 1rem;
            pointer-events: none;
        }

        .ot-search-input {
            width: 100%;
            padding: 11px 44px 11px 40px;
            border: 2px solid #e8e8e8;
            border-radius: 50px;          /* עגול כמו בתמונה */
            font-size: .95rem;
            background: white;
            color: #333;
            transition: border-color .2s, box-shadow .2s;
            outline: none;
            font-family: inherit;
            box-shadow: 0 2px 8px rgba(0,0,0,.06);
            height: 40px;
        }

        .ot-search-input:focus {
            border-color: #7c6fcd;
            box-shadow: 0 0 0 4px rgba(124,111,205,.1);
        }

        .ot-clear-btn {
            position: absolute;
            left: 12px;
            background: #f0f0f0;
            border: none;
            color: #888;
            cursor: pointer;
            padding: 4px 6px;
            display: flex;
            align-items: center;
            border-radius: 50%;
            transition: all .2s;
            font-size: .8rem;
        }

        .ot-clear-btn:hover {
            background: #ffd6d6;
            color: #e53e3e;
        }

        .ot-search-count {
            position: absolute;
            left: 44px;
            font-size: .75rem;
            font-weight: 600;
            white-space: nowrap;
            pointer-events: none;
        }

        /* ── Stats ────────────────────────────────────────────────────── */
        .ot-stats-wrap {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .ot-stat {
            display: flex;
            flex-direction: row;
            align-items: center;
            background: #f8f8f8;
            border: 1px solid #eee;
            border-radius: 8px;
            padding: 3px 7px;
            min-width: 56px;
            gap: 7px;
        }

        .ot-stat-value {
            font-size: 1rem;
            font-weight: 700;
            color: #7c6fcd;
            line-height: 1.2;
        }

        .ot-stat-label {
            font-size: .65rem;
            color: #aaa;
            white-space: nowrap;
        }

        /* ── View / Control Buttons ───────────────────────────────────── */
        .ot-view-btns {
            display: flex;
            gap: 2px;
            background: #f1f1f1;
            border-radius: 8px;
            padding: 3px;
        }

        .ot-view-btn {
            background: none;
            border: none;
            padding: 6px 10px;
            border-radius: 6px;
            cursor: pointer;
            color: #888;
            font-size: .9rem;
            transition: all .2s;
        }

        .ot-view-btn:hover  { background: #e2e2e2; color: #333; }
        .ot-view-btn.active {
            background: white;
            color: #7c6fcd;
            box-shadow: 0 1px 4px rgba(0,0,0,.1);
        }

        .ot-ctrl-btn {
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 7px 12px;
            background: #f8f8f8;
            border: 1.5px solid #e8e8e8;
            border-radius: 8px;
            cursor: pointer;
            font-size: .8rem;
            color: #555;
            font-family: inherit;
            transition: all .2s;
            white-space: nowrap;
        }

        .ot-ctrl-btn:hover   { background: #eee; color: #222; }
        .ot-export-btn:hover { background: #e8f5e9; border-color: #a5d6a7; color: #2e7d32; }

        /* ══════════════════════════════════════════════════════════════
        LOADING / ERROR / EMPTY / TOAST
        ══════════════════════════════════════════════════════════════ */
        .ot-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 12px;
            padding: 80px 20px;
            color: #7c6fcd;
            font-size: 1rem;
        }

        .ot-error {
            background: #fff5f5;
            border: 1px solid #fed7d7;
            color: #c53030;
            padding: 14px 18px;
            border-radius: 10px;
            margin: 16px;
        }

        .ot-empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 80px 20px;
            color: #bbb;
        }

        .ot-empty i { font-size: 3rem; opacity: .4; }

        .ot-toast {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: #333;
            color: white;
            padding: 10px 22px;
            border-radius: 10px;
            font-size: .9rem;
            opacity: 0;
            pointer-events: none;
            transition: opacity .3s, transform .3s;
            z-index: 99999;
        }

        .ot-toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }

        /* ══════════════════════════════════════════════════════════════
        TREE CONTENT WRAPPER
        ══════════════════════════════════════════════════════════════ */
        .ot-content {
            padding: 10px 20px 60px;
            overflow-x: auto;
        }

        .ot-tree-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: max-content;
            margin: 0 auto;
        }

        .ot-tree {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
        }

        /* ══════════════════════════════════════════════════════════════
        NODE CARD  ← הכרטיסייה עצמה
        ══════════════════════════════════════════════════════════════ */
        .ot-node-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            position: relative;
        }

        .ot-node {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            width: 240px;
            padding: 18px 14px 14px;
            background: white;
            border-radius: 16px;
            box-shadow: 0 2px 12px rgba(0,0,0,.08);
            cursor: pointer;
            transition: box-shadow .2s, transform .15s;
            position: relative;
            border: 2px solid transparent;
            user-select: none;
        }

        .ot-node:hover {
            box-shadow: 0 6px 20px rgba(0,0,0,.13);
            transform: translateY(-2px);
        }

        /* שורש - ללא תמונה, רק טקסט (כמו יקי זנו בתמונה) */
        .ot-node-root {
            background: white;
            border: 2px solid #e8e8e8;
            width: 220px;
        }

        /* הצומת שנמצא בחיפוש */
        .ot-node-found {
            background: #725800 !important;
            border-color: #f59e0b !important;
            box-shadow: 0 0 0 4px rgba(245,158,11,.2) !important;
        }

        .ot-node-selected {
            border-color: #7c6fcd !important;
            box-shadow: 0 0 0 3px rgba(124,111,205,.2) !important;
        }

        /* צמתים שאינם בנתיב - מוסתרים בחיפוש */
        .ot-node-hidden {
            display: none !important;
        }

        .ot-node-wrap-hidden {
            display: none !important;
        }

        /* ── Avatar ───────────────────────────────────────────────────── */
        .ot-avatar {
            width: 62px;
            height: 62px;
            border-radius: 50%;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: 1.6rem;
            margin-bottom: 10px;
            box-shadow: 0 3px 10px rgba(0,0,0,.15);
            flex-shrink: 0;
            background-size: cover;
            background-position: center;
            border: 3px solid white;
            outline: 2px solid #e8e8e8;
        }

        .ot-avatar-sm {
            width: 28px;
            height: 28px;
            font-size: 0.6rem;
            margin-bottom: 0;
        }

        /* ── Node Text ────────────────────────────────────────────────── */
        .ot-node-name {
            font-weight: 700;
            font-size: .95rem;
            color: #222;
            margin-bottom: 4px;
            line-height: 1.3;
        }

        .ot-node-role {
            font-size: .78rem;
            color: #666;
            line-height: 1.4;
            margin-bottom: 4px;
        }

        .ot-node-dept {
            font-size: .72rem;
            color: #999;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            flex-wrap: wrap;
            margin-top: 2px;
        }

        .ot-node-team {
            background: #f0eeff;
            color: #7c6fcd;
            padding: 1px 7px;
            border-radius: 10px;
            font-size: .68rem;
        }

        .ot-node-id {
            font-size: .7rem;
            color: #bbb;
            font-family: monospace;
            margin-top: 2px;
        }

        /* ── Info Button (כמו בתמונה) ─────────────────────────────────── */
        .ot-info-btn {
            margin-top: 10px;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            border: 1.5px solid #ddd;
            background: white;
            color: #aaa;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: .8rem;
            transition: all .2s;
        }

        .ot-info-btn:hover {
            border-color: #7c6fcd;
            color: #7c6fcd;
            background: #f0eeff;
        }

        /* ── Team Badge (אייקון אנשים) ────────────────────────────────── */
        .ot-team-icon {
            position: absolute;
            top: 10px;
            left: 10px;
            color: #bbb;
            font-size: .9rem;
            transition: color .2s;
        }

        .ot-node:hover .ot-team-icon { color: #7c6fcd; }

        /* ── Toggle ───────────────────────────────────────────────────── */
        .ot-toggle-btn {
            position: absolute;
            bottom: -14px;
            left: 50%;
            transform: translateX(-50%);
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 2px solid #ddd;
            background: white;
            color: #aaa;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: .6rem;
            z-index: 10;
            transition: all .2s;
            box-shadow: 0 1px 4px rgba(0,0,0,.1);
        }

        .ot-toggle-btn:hover {
            border-color: #7c6fcd;
            color: #7c6fcd;
            background: #f0eeff;
        }

        .ot-toggle-invisible {
            display: none;
        }

        /* ── Badges ───────────────────────────────────────────────────── */
        .ot-node-badges {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            margin-top: 6px;
            flex-wrap: wrap;
        }

        .ot-badge {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 2px 8px;
            border-radius: 20px;
            font-size: .7rem;
            font-weight: 600;
            text-decoration: none;
            transition: all .2s;
        }

        .ot-badge-children {
            background: #f0eeff;
            color: #7c6fcd;
            border: 1px solid #ddd6fe;
        }

        .ot-badge-phone {
            background: #e8f5e9;
            color: #2e7d32;
            border: 1px solid #c8e6c9;
        }

        .ot-badge-phone:hover { background: #2e7d32; color: white; }

        .ot-badge-email {
            background: #e3f2fd;
            color: #1565c0;
            border: 1px solid #bbdefb;
        }

        .ot-badge-email:hover { background: #1565c0; color: white; }

        /* ── Highlight ────────────────────────────────────────────────── */
        .ot-highlight {
            background: #fde047;
            color: #333;
            border-radius: 2px;
            padding: 0 1px;
        }

        /* ══════════════════════════════════════════════════════════════
        VERTICAL TREE LINES  ← הלב של העיצוב
        ══════════════════════════════════════════════════════════════ */

        /* קו אנכי מתחת לכרטיסייה */
        .ot-connector-down {
            width: 2px;
            height: 20px;
            background: #d0d0d0;
            flex-shrink: 0;
        }

        /* קו אנכי מעל כרטיסייה (לילדים) */
        .ot-connector-up {
            width: 2px;
            height: 30px;
            background: #d0d0d0;
            flex-shrink: 0;
        }

        /* עטיפת ילדים */
        .ot-children-open  { display: flex; flex-direction: column; align-items: center; }
        .ot-children-closed { display: none; }

        /* שורת ילדים - אופקית */
        .ot-children-row {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            justify-content: center;
            gap: 0;
            position: relative;
        }

        /* קו אופקי שמחבר את כל הילדים */
        .ot-h-line {
            position: absolute;
            top: 0;
            height: 2px;
            background: #d0d0d0;
            /* רוחב מחושב ב-JS */
        }

        /* עמודת ילד בודד */
        .ot-child-col {
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 0 10px;
            position: relative;
        }

        /* אנימציה */
        @keyframes ot-expand {
            from { opacity: 0; transform: translateY(-8px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        .ot-children-open {
            animation: ot-expand .2s ease-out;
        }

        /* ══════════════════════════════════════════════════════════════
        TABLE VIEW
        ══════════════════════════════════════════════════════════════ */
        .ot-table-wrap {
            overflow-x: auto;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0,0,0,.07);
        }

        .ot-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            font-size: .88rem;
        }

        .ot-table-th {
            background: #f8f8f8;
            padding: 12px 14px;
            text-align: right;
            font-weight: 600;
            color: #555;
            border-bottom: 2px solid #eee;
            white-space: nowrap;
            font-size: .82rem;
        }

        .ot-table-th-center { text-align: center; }

        .ot-table-td {
            padding: 10px 14px;
            border-bottom: 1px solid #f5f5f5;
            color: #444;
            vertical-align: middle;
        }

        .ot-table-td-center { text-align: center; }

        .ot-table-row { transition: background .15s; cursor: pointer; }
        .ot-table-row:hover { background: #fafafa; }
        .ot-table-row-highlighted { background: #fffde7 !important; }
        .ot-table-name { font-weight: 600; color: #222; }

        .ot-table-toggle {
            width: 22px; height: 22px;
            border-radius: 50%;
            border: 1px solid #ddd;
            background: #f8f8f8;
            color: #888;
            cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            font-size: .6rem;
            transition: all .2s;
            flex-shrink: 0;
        }

        .ot-table-toggle:hover { background: #7c6fcd; border-color: #7c6fcd; color: white; }

        .ot-phone-link, .ot-email-link {
            display: inline-flex; align-items: center; gap: 5px;
            color: #1565c0; text-decoration: none;
            font-size: .82rem; transition: color .2s;
        }

        .ot-phone-link:hover { color: #2e7d32; }
        .ot-email-link:hover { color: #7c6fcd; }

        /* ══════════════════════════════════════════════════════════════
        SIDE PANEL
        ══════════════════════════════════════════════════════════════ */
        .ot-side-panel {
            position: fixed;
            left: 0; top: 0;
            width: 360px; height: 100vh;
            background: white;
            box-shadow: 4px 0 24px rgba(0,0,0,.12);
            z-index: 9999;
            flex-direction: column;
            transform: translateX(-100%);
            transition: transform .25s cubic-bezier(.4,0,.2,1);
            display: flex !important;
        }

        .ot-side-panel-open { transform: translateX(0) !important; }

        .ot-side-panel-header {
            display: flex; align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid #f0f0f0;
            background: linear-gradient(135deg, #7c6fcd, #5b8dee);
            color: white;
            flex-shrink: 0;
        }

        .ot-side-panel-title { font-weight: 700; font-size: 1rem; }

        .ot-side-panel-close {
            background: rgba(255,255,255,.2);
            border: none; color: white;
            width: 30px; height: 30px;
            border-radius: 50%; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            font-size: .85rem; transition: background .2s;
        }

        .ot-side-panel-close:hover { background: rgba(255,255,255,.35); }

        .ot-side-panel-content {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }

        .ot-sp-section {
            margin-bottom: 20px;
            padding-bottom: 20px;
            border-bottom: 1px solid #f5f5f5;
        }

        .ot-sp-section:last-child { border-bottom: none; margin-bottom: 0; }

        .ot-sp-section-title {
            font-size: .75rem; font-weight: 700;
            color: #aaa; text-transform: uppercase;
            letter-spacing: .06em; margin-bottom: 12px;
            display: flex; align-items: center; gap: 6px;
        }

        .ot-sp-avatar {
            width: 72px; height: 72px; border-radius: 50%;
            color: white;
            display: flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 1.8rem;
            margin: 0 auto 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,.15);
        }

        .ot-sp-name {
            text-align: center; font-weight: 700;
            font-size: 1.05rem; color: #222; margin-bottom: 4px;
        }

        .ot-sp-id {
            text-align: center; font-size: .78rem;
            color: #aaa; font-family: monospace;
        }

        .ot-sp-row {
            display: flex; align-items: flex-start;
            gap: 10px; margin-bottom: 10px;
        }

        .ot-sp-label {
            font-size: .8rem; color: #888;
            min-width: 70px;
            display: flex; align-items: center; gap: 5px;
            flex-shrink: 0; padding-top: 1px;
        }

        .ot-sp-value {
            font-size: .85rem; color: #222;
            font-weight: 500; word-break: break-word;
        }

        .ot-sp-link {
            color: #5b8dee; text-decoration: none;
            font-size: .85rem; font-weight: 500;
            display: inline-flex; align-items: center; gap: 5px;
            transition: color .2s;
        }

        .ot-sp-link:hover { color: #7c6fcd; text-decoration: underline; }

        .ot-sp-stat-grid {
            display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        }

        .ot-sp-stat {
            background: #f8f8f8; border: 1px solid #eee;
            border-radius: 10px; padding: 12px; text-align: center;
        }

        .ot-sp-stat-value {
            font-size: 1.4rem; font-weight: 700;
            color: #7c6fcd; line-height: 1; margin-bottom: 4px;
        }

        .ot-sp-stat-label { font-size: .72rem; color: #aaa; }

        /* ══════════════════════════════════════════════════════════════
        SEARCH PATH MODE  ← מצב חיפוש - רק הנתיב
        ══════════════════════════════════════════════════════════════ */
        .ot-search-mode .ot-node-wrap-hidden {
            display: none !important;
        }

        .ot-search-mode .ot-children-row {
            /* במצב חיפוש - ילדים בעמודה אנכית */
            flex-direction: column;
            align-items: center;
        }

        .ot-search-mode .ot-child-col {
            padding: 0;
        }

        /* ══════════════════════════════════════════════════════════════
        RESPONSIVE
        ══════════════════════════════════════════════════════════════ */
        @media (max-width: 768px) {
            .ot-header { flex-direction: column; align-items: stretch; }
            .ot-header-right { justify-content: flex-end; }
            .ot-search-input { min-width: unset; }

            .ot-node { width: 160px; padding: 14px 10px 12px; }
            .ot-avatar { width: 56px; height: 56px; font-size: 1.3rem; }
            .ot-child-col { padding: 0 8px; }

            .ot-side-panel {
                width: 100%; left: 0; right: 0;
                top: auto; bottom: 0; height: 80vh;
                transform: translateY(100%);
                border-radius: 16px 16px 0 0;
            }

            .ot-side-panel-open { transform: translateY(0) !important; }
        }
        /* ══════════════════════════════════════════════════════════════
        AUTOCOMPLETE DROPDOWN
        ══════════════════════════════════════════════════════════════ */
        .ot-autocomplete {
            position: absolute;
            top: calc(100% + 8px);
            right: 0;
            left: 0;
            background: white;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,.14),
                        0 2px 8px  rgba(0,0,0,.08);
            border: 1px solid #efefef;
            z-index: 9999;
            overflow: hidden;
            max-height: 0;
            opacity: 0;
            pointer-events: none;
            transition: max-height .25s cubic-bezier(.4,0,.2,1),
                        opacity    .2s ease;
        }

        .ot-autocomplete.ot-ac-open {
            max-height: 420px;
            opacity: 1;
            pointer-events: auto;
            overflow-y: auto;
        }

        /* ── פריט ─────────────────────────────────────────────────────── */
        .ot-ac-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            cursor: pointer;
            transition: background .15s;
            border-bottom: 1px solid #f5f5f5;
            direction: rtl;
        }

        .ot-ac-item:last-child {
            border-bottom: none;
        }

        .ot-ac-item:hover,
        .ot-ac-item-active {
            background: #f8f6ff;
        }

        /* ── אווטאר קטן ───────────────────────────────────────────────── */
        .ot-ac-avatar {
            width: 38px;
            height: 38px;
            min-width: 38px;
            border-radius: 50%;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            font-size: .95rem;
            flex-shrink: 0;
        }

        /* ── טקסט ─────────────────────────────────────────────────────── */
        .ot-ac-info {
            flex: 1;
            min-width: 0;
            text-align: right;
        }

        .ot-ac-name {
            font-weight: 700;
            font-size: .92rem;
            color: #222;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .ot-ac-subtitle {
            font-size: .78rem;
            color: #888;
            margin-top: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* ── תג (תפקיד / מחלקה) ──────────────────────────────────────── */
        .ot-ac-tag {
            font-size: .68rem;
            font-weight: 600;
            background: #f0eeff;
            color: #7c6fcd;
            padding: 2px 8px;
            border-radius: 20px;
            white-space: nowrap;
            flex-shrink: 0;
        }

        /* ── ריק ──────────────────────────────────────────────────────── */
        .ot-ac-empty {
            padding: 20px 16px;
            text-align: center;
            color: #aaa;
            font-size: .88rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        /* ── Scrollbar עדין ───────────────────────────────────────────── */
        .ot-autocomplete::-webkit-scrollbar {
            width: 4px;
        }

        .ot-autocomplete::-webkit-scrollbar-track {
            background: transparent;
        }

        .ot-autocomplete::-webkit-scrollbar-thumb {
            background: #ddd;
            border-radius: 4px;
        }

        .ot-autocomplete::-webkit-scrollbar-thumb:hover {
            background: #bbb;
        }
        /* ══════════════════════════════════════════════════════════════
        DARK MODE
        ══════════════════════════════════════════════════════════════ */

        [data-theme="dark"] .ot-root {
            background: #0f172a;
            color: #e2e8f0;
        }

        [data-theme="dark"] .ot-header {
            background: #111827;
            border-bottom-color: #374151;
            box-shadow: 0 2px 12px rgba(0,0,0,.4);
        }

        [data-theme="dark"] .ot-search-input,
        [data-theme="dark"] .ot-autocomplete,
        [data-theme="dark"] .ot-side-panel,
        [data-theme="dark"] .ot-table,
        [data-theme="dark"] .ot-node {
            background: #1e293b;
            color: #e2e8f0;
        }

        [data-theme="dark"] .ot-search-input {
            border-color: #334155;
        }

        [data-theme="dark"] .ot-search-input:focus {
            border-color: #8b5cf6;
            box-shadow: 0 0 0 4px rgba(139,92,246,.2);
        }

        [data-theme="dark"] .ot-stat,
        [data-theme="dark"] .ot-view-btns,
        [data-theme="dark"] .ot-ctrl-btn,
        [data-theme="dark"] .ot-sp-stat {
            background: #1f2937;
            border-color: #374151;
        }

        [data-theme="dark"] .ot-view-btn {
            color: #cbd5e1;
        }

        [data-theme="dark"] .ot-view-btn.active {
            background: #334155;
            color: #a78bfa;
        }

        [data-theme="dark"] .ot-ctrl-btn:hover,
        [data-theme="dark"] .ot-view-btn:hover {
            background: #374151;
        }

        [data-theme="dark"] .ot-node {
            border-color: #334155;
            box-shadow: 0 4px 12px rgba(0,0,0,.35);
        }

        [data-theme="dark"] .ot-node-root {
            background: #111827;
            border-color: #475569;
        }

        [data-theme="dark"] .ot-node-name,
        [data-theme="dark"] .ot-sp-name,
        [data-theme="dark"] .ot-ac-name {
            color: #f8fafc;
        }

        [data-theme="dark"] .ot-node-role,
        [data-theme="dark"] .ot-ac-subtitle,
        [data-theme="dark"] .ot-sp-label,
        [data-theme="dark"] .ot-table-td,
        [data-theme="dark"] .ot-table-th {
            color: #cbd5e1;
        }

        [data-theme="dark"] .ot-table-th {
            background: #1e293b;
            border-color: #334155;
        }

        [data-theme="dark"] .ot-table-row:hover {
            background: #243244;
        }

        [data-theme="dark"] .ot-info-btn,
        [data-theme="dark"] .ot-toggle-btn,
        [data-theme="dark"] .ot-table-toggle {
            background: #334155;
            border-color: #475569;
            color: #cbd5e1;
        }

        [data-theme="dark"] .ot-info-btn:hover,
        [data-theme="dark"] .ot-toggle-btn:hover,
        [data-theme="dark"] .ot-table-toggle:hover {
            background: #8b5cf6;
            border-color: #8b5cf6;
            color: white;
        }

        [data-theme="dark"] .ot-side-panel-header {
            background: linear-gradient(135deg, #4f46e5, #2563eb);
        }

        [data-theme="dark"] .ot-sp-section {
            border-bottom-color: #334155;
        }

        [data-theme="dark"] .ot-ac-item {
            border-bottom-color: #334155;
        }

        [data-theme="dark"] .ot-ac-item:hover,
        [data-theme="dark"] .ot-ac-item-active {
            background: #334155;
        }

        [data-theme="dark"] .ot-connector-down,
        [data-theme="dark"] .ot-connector-up,
        [data-theme="dark"] .ot-child-col::before,
        [data-theme="dark"] .ot-h-line {
            background: #475569;
        }

        [data-theme="dark"] .ot-highlight {
            background: #facc15;
            color: #111827;
        }

        [data-theme="dark"] .ot-error {
            background: #451a1a;
            border-color: #7f1d1d;
            color: #fecaca;
        }

        [data-theme="dark"] .ot-toast {
            background: #111827;
            color: #fff;
        }
        /* ===== MISSING DARK MODE OVERRIDES ===== */

        [data-theme="dark"] .ot-table-name,
        [data-theme="dark"] .ot-sp-value,
        [data-theme="dark"] .ot-side-panel-title {
            color: #f8fafc;
        }

        [data-theme="dark"] .ot-node-id,
        [data-theme="dark"] .ot-sp-id,
        [data-theme="dark"] .ot-stat-label,
        [data-theme="dark"] .ot-search-icon,
        [data-theme="dark"] .ot-search-count,
        [data-theme="dark"] .ot-team-icon {
            color: #94a3b8;
        }

        [data-theme="dark"] .ot-node-dept {
            color: #94a3b8;
        }

        [data-theme="dark"] .ot-node-team {
            background: #312e81;
            color: #c4b5fd;
        }

        [data-theme="dark"] .ot-badge-children {
            background: #312e81;
            color: #ddd6fe;
            border-color: #4c1d95;
        }

        [data-theme="dark"] .ot-phone-link,
        [data-theme="dark"] .ot-email-link,
        [data-theme="dark"] .ot-sp-link {
            color: #93c5fd;
        }

        [data-theme="dark"] .ot-phone-link:hover,
        [data-theme="dark"] .ot-email-link:hover,
        [data-theme="dark"] .ot-sp-link:hover {
            color: #c4b5fd;
        }

        [data-theme="dark"] .ot-avatar {
            border-color: #1e293b;
            outline-color: #475569;
        }

        [data-theme="dark"] .ot-table-wrap {
            box-shadow: 0 4px 20px rgba(0,0,0,.4);
        }

        [data-theme="dark"] .ot-table-row-highlighted {
            background: rgba(245,158,11,.15) !important;
        }

        [data-theme="dark"] .ot-autocomplete {
            border-color: #334155;
        }

        [data-theme="dark"] .ot-ac-tag {
            background: #312e81;
            color: #c4b5fd;
        }

        [data-theme="dark"] .ot-ac-empty {
            color: #94a3b8;
        }

        [data-theme="dark"] .ot-clear-btn {
            background: #334155;
            color: #cbd5e1;
        }

        [data-theme="dark"] .ot-clear-btn:hover {
            background: #7f1d1d;
            color: #fecaca;
        }

        [data-theme="dark"] .ot-loading {
            color: #a78bfa;
        }

        [data-theme="dark"] .ot-empty {
            color: #94a3b8;
        }

        [data-theme="dark"] .ot-view-btns {
            border: 1px solid #374151;
        }

        [data-theme="dark"] .ot-ctrl-btn {
            color: #cbd5e1;
        }

        [data-theme="dark"] .ot-export-btn:hover {
            background: #14532d;
            border-color: #22c55e;
            color: #bbf7d0;
        }

        [data-theme="dark"] .ot-side-panel-content {
            background: #111827;
        }

        [data-theme="dark"] .ot-sp-stat-label {
            color: #94a3b8;
        }

        [data-theme="dark"] .ot-sp-section-title {
            color: #cbd5e1;
        }


        /* ══════════════════════════════════════════════════════════════
        VERTICAL PATH MODE - נתיב אנכי
        ══════════════════════════════════════════════════════════════ */

        /* שורת כפופים ישירים */
        .ot-direct-reports {
            margin-top: 0;
            flex-wrap: wrap;
            justify-content: center;
            gap: 0;
        }

        /* קו אופקי מעל כפופים ישירים */
        .ot-h-line-direct {
            position: absolute;
            top: 0;
            height: 2px;
            background: #d0d0d0;
            left: 10%;
            right: 10%;
        }

        /* כרטיסיית כפוף ישיר */
        .ot-node-direct-report {
            width: 245px;
            padding: 14px 12px 12px;
            cursor: pointer;
            transition: box-shadow .2s, transform .15s, border-color .2s;
        }

        .ot-node-direct-report:hover {
            border-color: #7c6fcd;
            box-shadow: 0 6px 20px rgba(124,111,205,.2);
            transform: translateY(-3px);
        }

        /* צומת פעיל (שהכפופים שלו מוצגים) */
        .ot-node-active-child {
            border-color: #7c6fcd !important;
            background: #f8f6ff !important;
        }

        /* רמז להרחבה */
        .ot-node-expand-hint {
            margin-top: 8px;
            font-size: .68rem;
            color: #7c6fcd;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            opacity: .7;
        }

        .ot-node-direct-report:hover .ot-node-expand-hint {
            opacity: 1;
        }

        /* ── Dark Mode ────────────────────────────────────────────────── */
        [data-theme="dark"] .ot-node-direct-report:hover {
            border-color: #8b5cf6;
            box-shadow: 0 6px 20px rgba(139,92,246,.25);
        }

        [data-theme="dark"] .ot-node-active-child {
            background: #1e1b4b !important;
            border-color: #8b5cf6 !important;
        }

        [data-theme="dark"] .ot-h-line-direct {
            background: #475569;
        }

        [data-theme="dark"] .ot-node-expand-hint {
            color: #a78bfa;
        }
        /* הוסף בתוך style.textContent */

        /* ══════════════════════════════════════════════════════════════
        DIRECT REPORTS - שורות מרובות
        ══════════════════════════════════════════════════════════════ */

        /* עטיפת כל שורות הכפופים */
        .ot-direct-reports-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 24px;
            width: 100%;
        }

        /* שורה בודדת של כפופים */
        .ot-direct-reports-row {
            display: flex;
            justify-content: center;
            width: 100%;
        }

        /* שורת כפופים ישירים - עטיפה */
        .ot-direct-reports {
            flex-wrap: wrap;
            justify-content: center;
            position: relative;
            padding-top: 10px; /* מקום לקו האופקי */
        }

        /* קו אופקי רק בשורה הראשונה */
        .ot-h-line-direct {
            position: absolute;
            top: 0;
            height: 2px;
            background: #d0d0d0;
            left: 10%;
            right: 10%;
        }

        /* צומת בנתיב האנכי */
        .ot-node-in-path {
            border: 2px solid #e8e8e8;
            background: white;
        }

        /* הצומת הפעיל (האחרון בנתיב) */
        .ot-node-active {
            border-color: #7c6fcd !important;
            box-shadow: 0 0 0 4px rgba(124,111,205,.15) !important;
        }

        /* ── Dark Mode ────────────────────────────────────────────────── */
        [data-theme="dark"] .ot-node-in-path {
            background: #1e293b;
            border-color: #334155;
        }

        [data-theme="dark"] .ot-node-active {
            border-color: #8b5cf6 !important;
            box-shadow: 0 0 0 4px rgba(139,92,246,.2) !important;
        }

        [data-theme="dark"] .ot-h-line-direct {
            background: #475569;
        }

        /* ══════════════════════════════════════════════════════════════
        MODAL POPUP - פופ-אפ פרטי עובד
        ══════════════════════════════════════════════════════════════ */

        /* Overlay - הרקע המעומעם */
        .ot-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(3px);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            opacity: 0;
            transition: opacity 0.25s ease;
        }

        .ot-modal-overlay.ot-modal-open {
            opacity: 1;
        }

        /* החלון עצמו */
        .ot-modal {
            background: white;
            border-radius: 20px;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2),
                        0 8px 24px rgba(0, 0, 0, 0.12);
            width: 100%;
            max-width: 420px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: translateY(16px) scale(0.97);
            transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .ot-modal-overlay.ot-modal-open .ot-modal {
            transform: translateY(0) scale(1);
        }

        /* כותרת הפופ-אפ */
        .ot-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 18px 22px;
            background: linear-gradient(135deg, #7c6fcd, #5b8dee);
            color: white;
            flex-shrink: 0;
        }

        .ot-modal-title {
            font-weight: 700;
            font-size: 1.05rem;
            color: white;
        }

        .ot-modal-close {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            color: white;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.9rem;
            transition: background 0.2s;
            flex-shrink: 0;
        }

        .ot-modal-close:hover {
            background: rgba(255, 255, 255, 0.35);
        }

        /* תוכן הפופ-אפ - גלילה פנימית */
        .ot-modal-content {
            padding: 22px;
            overflow-y: auto;
            flex: 1;
            direction: rtl;
        }

        /* Scrollbar עדין בתוך הפופ-אפ */
        .ot-modal-content::-webkit-scrollbar {
            width: 4px;
        }

        .ot-modal-content::-webkit-scrollbar-track {
            background: transparent;
        }

        .ot-modal-content::-webkit-scrollbar-thumb {
            background: #ddd;
            border-radius: 4px;
        }

        /* ── Responsive - מובייל ──────────────────────────────────────── */
        @media (max-width: 768px) {
            .ot-modal-overlay {
                align-items: flex-end;
                padding: 0;
            }

            .ot-modal {
                max-width: 100%;
                border-radius: 20px 20px 0 0;
                max-height: 90vh;
                transform: translateY(100%);
            }

            .ot-modal-overlay.ot-modal-open .ot-modal {
                transform: translateY(0);
            }
        }

        /* ══════════════════════════════════════════════════════════════
        DARK MODE - MODAL
        ══════════════════════════════════════════════════════════════ */
        [data-theme="dark"] .ot-modal {
            background: #1e293b;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
        }

        [data-theme="dark"] .ot-modal-header {
            background: linear-gradient(135deg, #4f46e5, #2563eb);
        }

        [data-theme="dark"] .ot-modal-content {
            background: #1e293b;
            color: #e2e8f0;
        }

        [data-theme="dark"] .ot-modal-content::-webkit-scrollbar-thumb {
            background: #475569;
        }

        [data-theme="dark"] .ot-modal-overlay {
            background: rgba(0, 0, 0, 0.65);
        }
    `;

        document.head.appendChild(style);
    }
}