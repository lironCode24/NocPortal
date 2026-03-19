// SectionManager.js
class SectionManager {
    constructor() {
        this.sectionStates = JSON.parse(localStorage.getItem('sectionStates') ||
            '{"shifts": false, "employeeTasks": false, "phoneDirectory": false, "activityManagement": false, "procedures": false, "messages": false, "dailyTasks": false, "teamLinks": false,"datacenter": false,"alerts": false ,"changes": false }');
    }

    // Toggle section visibility
    toggleSection(sectionName) {

        const content = document.getElementById(sectionName + 'Content');
        const toggleBtn = document.getElementById(sectionName + 'Toggle');
        const icon = toggleBtn.querySelector('i');
        const isCollapsed = content.classList.contains('collapsed');

        if (isCollapsed) {
            // Expand section
            content.classList.remove('collapsed');
            toggleBtn.classList.remove('collapsed');
            icon.className = 'fas fa-minus';
            this.sectionStates[sectionName] = true;
        } else {
            // Collapse section
            content.classList.add('collapsed');
            toggleBtn.classList.add('collapsed');
            icon.className = 'fas fa-plus';
            this.sectionStates[sectionName] = false;
        }

        // Save state to localStorage
        localStorage.setItem('sectionStates', JSON.stringify(this.sectionStates));

        // Update toggle all button state in SectionDragManager
        if (sectionDragManager && typeof sectionDragManager.updateToggleAllState === 'function') {
            sectionDragManager.updateToggleAllState();
        }
    }

    // Initialize section states on page load
    initializeSectionStates() {
        Object.keys(this.sectionStates).forEach(sectionName => {
            const content = document.getElementById(sectionName + 'Content');
            const toggleBtn = document.getElementById(sectionName + 'Toggle');

            if (!content || !toggleBtn) return;

            const icon = toggleBtn.querySelector('i');

            if (!this.sectionStates[sectionName]) {
                content.classList.add('collapsed');
                toggleBtn.classList.add('collapsed');
                icon.className = 'fas fa-plus';
            } else {
                content.classList.remove('collapsed');
                toggleBtn.classList.remove('collapsed');
                icon.className = 'fas fa-minus';
            }
        });
    }
}

// Initialize on page load
let sectionManagerInstance = null;

document.addEventListener('DOMContentLoaded', () => {
    sectionManagerInstance = new SectionManager();
    sectionManagerInstance.initializeSectionStates();
});