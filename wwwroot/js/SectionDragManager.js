// SectionDragManager.js
class SectionDragManager {
    constructor() {
        this.draggedElement = null;
        this.defaultOrder = null;
        this.allSectionsOpen = false;
        this.placeholder = null;
        this.init();
    }

    init() {
        this.saveDefaultOrder();
        this.createPlaceholder();
        this.setupDragAndDrop();
        this.loadSavedOrder();
        this.updateResetButtonVisibility();
        this.updateToggleAllState();
    }

    createPlaceholder() {
        // Create a visual placeholder element
        this.placeholder = document.createElement('div');
        this.placeholder.className = 'drag-placeholder';
        this.placeholder.style.cssText = `
        height: 60px;
        border: 2px dashed #4a90e2;
        border-radius: 8px;
        background: rgba(74, 144, 226, 0.1);
        margin: 10px 0;
        transition: all 0.2s ease;
    `;
    }

    saveDefaultOrder() {
        // Check if we already have a saved default in localStorage
        const savedDefault = localStorage.getItem('noc-sections-default-order');
        if (savedDefault) {
            try {
                this.defaultOrder = JSON.parse(savedDefault);
                return;
            } catch (error) {
                console.error('Error loading default order:', error);
            }
        }

        // First time - save the initial/default order from HTML
        const columns = ['messagesColumn', 'shiftsColumn'];
        const order = {};

        columns.forEach(columnId => {
            const column = document.getElementById(columnId);
            if (column) {
                const sections = column.querySelectorAll('.draggable-section');
                order[columnId] = Array.from(sections).map(s => s.dataset.sectionId);
            }
        });

        this.defaultOrder = order;
        // Save to localStorage so it persists across refreshes
        localStorage.setItem('noc-sections-default-order', JSON.stringify(order));
    }

    setupDragAndDrop() {
        const sections = document.querySelectorAll('.draggable-section');
        const columns = document.querySelectorAll('#messagesColumn, #shiftsColumn');

        sections.forEach(section => {
            const header = section.querySelector('.section-header');

            // Make section draggable via header
            header.addEventListener('mousedown', (e) => {
                if (e.target.closest('.drag-handle-icon')) {
                    section.setAttribute('draggable', 'true');
                }
            });

            section.addEventListener('dragstart', (e) => {
                this.draggedElement = section;
                section.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';

                setTimeout(() => {
                    if (this.draggedElement) {
                        section.style.opacity = '0.4';
                    }
                }, 0);
            });

            section.addEventListener('dragend', (e) => {
                section.classList.remove('dragging');
                section.style.opacity = '1';
                section.setAttribute('draggable', 'false');

                if (this.placeholder.parentNode) {
                    this.placeholder.parentNode.removeChild(this.placeholder);
                }

                this.saveOrder();
                this.updateResetButtonVisibility();
            });
        });

        columns.forEach(column => {
            column.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                if (!this.draggedElement) return;

                const afterElement = this.getDragAfterElement(column, e.clientY);

                if (afterElement == null) {
                    column.appendChild(this.placeholder);
                } else {
                    column.insertBefore(this.placeholder, afterElement);
                }
            });

            column.addEventListener('drop', (e) => {
                e.preventDefault();

                if (!this.draggedElement) return;

                if (this.placeholder.parentNode) {
                    this.placeholder.parentNode.insertBefore(this.draggedElement, this.placeholder);
                    this.placeholder.parentNode.removeChild(this.placeholder);
                }
            });

            column.addEventListener('dragleave', (e) => {
                if (e.target === column && !column.contains(e.relatedTarget)) {
                    if (this.placeholder.parentNode === column) {
                        column.removeChild(this.placeholder);
                    }
                }
            });
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.draggable-section:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    saveOrder() {
        const columns = ['messagesColumn', 'shiftsColumn'];
        const order = {};

        columns.forEach(columnId => {
            const column = document.getElementById(columnId);
            if (column) {
                const sections = column.querySelectorAll('.draggable-section');
                order[columnId] = Array.from(sections).map(s => s.dataset.sectionId);
            }
        });

        localStorage.setItem('noc-sections-order', JSON.stringify(order));
    }

    loadSavedOrder() {
        const savedOrder = localStorage.getItem('noc-sections-order');
        if (!savedOrder) {
            return;
        }

        try {
            const order = JSON.parse(savedOrder);

            // Collect all sections from DOM once
            const allSectionsMap = new Map();
            ['messagesColumn', 'shiftsColumn'].forEach(columnId => {
                const column = document.getElementById(columnId);
                if (column) {
                    const sections = column.querySelectorAll('.draggable-section');
                    sections.forEach(section => {
                        allSectionsMap.set(section.dataset.sectionId, section);
                    });
                }
            });

            // Now place sections according to saved order
            Object.keys(order).forEach(columnId => {
                const column = document.getElementById(columnId);
                if (!column) {
                    console.warn(`Column ${columnId} not found`);
                    return;
                }

                const sectionIds = order[columnId];

                // Clear the column
                column.innerHTML = '';

                // Append sections in the saved order
                sectionIds.forEach((sectionId, index) => {
                    const section = allSectionsMap.get(sectionId);
                    if (section) {
                        column.appendChild(section);
                        // Remove from map so we don't place it twice
                        allSectionsMap.delete(sectionId);
                    } else {
                        console.warn(`✗ Section "${sectionId}" not found in DOM`);
                    }
                });
            });

            // Append any remaining sections that weren't in the saved order
            // (in case new sections were added to the HTML)
            if (allSectionsMap.size > 0) {
                const messagesColumn = document.getElementById('messagesColumn');
                allSectionsMap.forEach((section, sectionId) => {
                    messagesColumn.appendChild(section);
                });
            }

        } catch (error) {
            console.error('Error loading saved section order:', error);
        }
    }

    hasCustomOrder() {
        const savedOrder = localStorage.getItem('noc-sections-order');
        if (!savedOrder) return false;

        try {
            const currentOrder = JSON.parse(savedOrder);

            // Compare current order with default order
            for (let columnId in this.defaultOrder) {
                const defaultSections = this.defaultOrder[columnId];
                const currentSections = currentOrder[columnId];

                if (!currentSections) return true;

                if (defaultSections.length !== currentSections.length) return true;

                for (let i = 0; i < defaultSections.length; i++) {
                    if (defaultSections[i] !== currentSections[i]) {
                        return true;
                    }
                }
            }

            return false;
        } catch (error) {
            console.error('Error checking custom order:', error);
            return false;
        }
    }

    updateResetButtonVisibility() {
        const resetBtn = document.querySelector('.reset-layout-btn');
        if (resetBtn) {
            if (this.hasCustomOrder()) {
                resetBtn.style.display = 'flex';
                resetBtn.style.animation = 'fadeIn 0.3s ease';
            } else {
                resetBtn.style.display = 'none';
            }
        }
    }

    resetToDefault() {
        // Remove only the custom order
        localStorage.removeItem('noc-sections-order');
        location.reload();
    }

    // Toggle all sections using SectionManager
    toggleAllSections() {
        const sections = [
            'shifts',
            'procedures',
            'employeeTasks',
            'messages',
            'phoneDirectory',
            'dailyTasks',
            'activityManagement',
            'teamLinks',
            'datacenter',
            'alerts',
            'changes'
        ];

        this.allSectionsOpen = !this.allSectionsOpen;

        // Load current section states from localStorage
        const sectionStates = JSON.parse(localStorage.getItem('sectionStates') || '{}');

        sections.forEach(sectionId => {
            const content = document.getElementById(`${sectionId}Content`);
            const toggleBtn = document.getElementById(`${sectionId}Toggle`);

            if (content && toggleBtn) {
                if (this.allSectionsOpen) {
                    // Open section
                    content.classList.remove('collapsed');
                    toggleBtn.innerHTML = '<i class="fas fa-minus"></i>';
                    toggleBtn.classList.remove('collapsed');
                    sectionStates[sectionId] = true;
                } else {
                    // Close section
                    content.classList.add('collapsed');
                    toggleBtn.innerHTML = '<i class="fas fa-plus"></i>';
                    toggleBtn.classList.add('collapsed');
                    sectionStates[sectionId] = false;
                }
            }
        });

        // Save updated states to localStorage
        localStorage.setItem('sectionStates', JSON.stringify(sectionStates));

        // Update button text and icon
        this.updateToggleAllButton();
    }

    //Update the toggle all button text and icon
    updateToggleAllButton() {
        const toggleAllBtn = document.querySelector('.toggle-all-sections-btn');
        const toggleAllText = document.getElementById('toggleAllText');
        const toggleAllIcon = toggleAllBtn?.querySelector('i');

        if (!toggleAllBtn || !toggleAllText || !toggleAllIcon) {
            return;
        }

        if (this.allSectionsOpen) {
            toggleAllText.textContent = 'סגור הכל';
            toggleAllIcon.className = 'fas fa-compress-alt';
            toggleAllBtn.classList.add('all-open');
        } else {
            toggleAllText.textContent = 'פתח הכל';
            toggleAllIcon.className = 'fas fa-expand-alt';
            toggleAllBtn.classList.remove('all-open');
        }
    }

    //Check if a specific section is open
    isSectionOpen(sectionId) {
        const content = document.getElementById(`${sectionId}Content`);
        return content && !content.classList.contains('collapsed');
    }

    //Update toggle all button state based on current sections state
    updateToggleAllState() {
        const sections = [
            'shifts',
            'procedures',
            'employeeTasks',
            'messages',
            'phoneDirectory',
            'dailyTasks',
            'activityManagement',
            'teamLinks',
            'datacenter',
            'alerts',
            'changes'
        ];

        const openSections = sections.filter(id => this.isSectionOpen(id));

        // If all sections are open, set state to true
        if (openSections.length > 0) {
            this.allSectionsOpen = true;
        }
        // If all sections are closed, set state to false
        else {
            this.allSectionsOpen = false;
        }


        this.updateToggleAllButton();
    }
}

let sectionDragManager = null;

// Add CSS animation for fadeIn
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
`;
document.head.appendChild(style);

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {

    // Create the manager instance
    sectionDragManager = new SectionDragManager();

    // Setup reset button
    const resetBtn = document.querySelector('.reset-layout-btn');
    if (resetBtn) {
        resetBtn.removeAttribute('onclick');

        resetBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (confirm('האם לאפס את סידור הסקשנים לברירת מחדל?')) {
                sectionDragManager.resetToDefault();
            }
        });
    }

    // Setup toggle all button
    const toggleAllBtn = document.querySelector('.toggle-all-sections-btn');
    if (toggleAllBtn) {
        toggleAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();

            if (sectionDragManager && typeof sectionDragManager.toggleAllSections === 'function') {
                sectionDragManager.toggleAllSections();
            }
        });
    }
});