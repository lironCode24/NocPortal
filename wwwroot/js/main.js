// Global instances
let nocPortalApp;
let shiftsManager;
let messagesManager;
let proceduresManager;
let dailyTasksManager;
let sectionManager;

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', async function () {
    try {
        console.log('Starting NOC Portal initialization...');

        // Create global instances
        nocPortalApp = new NOCPortalApp();
        shiftsManager = nocPortalApp.shiftsManager;
        messagesManager = nocPortalApp.messagesManager;
        proceduresManager = nocPortalApp.proceduresManager;
        dailyTasksManager = nocPortalApp.dailyTasksManager;
        sectionManager = nocPortalApp.sectionManager;

        // Define global functions BEFORE initializing
        defineGlobalFunctions();

        // Initialize the application
        await nocPortalApp.initialize();

        console.log('NOC Portal fully loaded and initialized');
    } catch (error) {
        console.error('Failed to initialize NOC Portal:', error);
        if (typeof NotificationManager !== 'undefined') {
            NotificationManager.show('שגיאה באתחול המערכת', 'error');
        } else {
            alert('שגיאה באתחול המערכת: ' + error.message);
        }
    }
});

// Define global functions for backward compatibility with onclick handlers
function defineGlobalFunctions() {
    // Section management
    window.toggleSection = function (sectionName) {
        if (sectionManager) {
            sectionManager.toggleSection(sectionName);
        }
    };

    // Messages functions
    window.openAddMessageModal = function () {
        if (messagesManager) {
            messagesManager.openAddMessageModal();
        }
    };

    window.closeAddMessageModal = function () {
        if (messagesManager) {
            messagesManager.closeAddMessageModal();
        }
    };

    window.openMessagePopup = function (messageId) {
        if (messagesManager) {
            messagesManager.openMessagePopup(messageId);
        }
    };

    window.closeMessagePopup = function () {
        if (messagesManager) {
            messagesManager.closeMessagePopup();
        }
    };

    window.toggleBookmark = function (messageId, buttonElement) {
        if (messagesManager) {
            messagesManager.toggleBookmark(messageId, buttonElement);
        }
    };

    window.deleteMessage = function (messageId) {
        if (messagesManager) {
            messagesManager.deleteMessage(messageId);
        }
    };

    // Tasks functions
    window.openAddTaskModal = function () {
        if (dailyTasksManager) {
            dailyTasksManager.openAddTaskModal();
        }
    };

    window.closeAddTaskModal = function () {
        if (dailyTasksManager) {
            dailyTasksManager.closeAddTaskModal();
        }
    };

    window.editTask = function (taskId) {
        if (dailyTasksManager) {
            dailyTasksManager.editTask(taskId);
        }
    };

    window.deleteTask = function (taskId) {
        if (dailyTasksManager) {
            dailyTasksManager.deleteTask(taskId);
        }
    };

    window.openSkipReasonModal = function (taskId) {
        if (dailyTasksManager) {
            dailyTasksManager.openSkipReasonModal(taskId);
        }
    };

    window.closeSkipReasonModal = function () {
        if (dailyTasksManager) {
            dailyTasksManager.closeSkipReasonModal();
        }
    };

    window.clearSkipReason = function (taskId) {
        if (dailyTasksManager) {
            dailyTasksManager.clearSkipReason(taskId);
        }
    };

    // Date functions
    window.openDatePicker = function () {
        if (dailyTasksManager) {
            dailyTasksManager.openDatePicker();
        }
    };

    window.handleDatePickerChange = function (isoDate) {
        if (dailyTasksManager) {
            dailyTasksManager.handleDatePickerChange(isoDate);
        }
    };

    window.setToday = function () {
        if (dailyTasksManager) {
            dailyTasksManager.setToday();
        }
    };

    window.handleSkipReasonChange = function () {
        if (dailyTasksManager) {
            dailyTasksManager.handleSkipReasonChange();
        }
    };

    // Procedures functions
    window.viewProcedure = function (fileName) {
        if (proceduresManager) {
            proceduresManager.viewProcedureInModal(fileName);
        }
    };

    window.editProcedure = function (fileName) {
        if (proceduresManager) {
            proceduresManager.editProcedure(fileName);
        }
    };

    window.closeSimpleDocumentModal = function () {
        if (proceduresManager) {
            proceduresManager.closeSimpleDocumentModal();
        }
    };
}

// Cleanup on page unload
window.addEventListener('beforeunload', function () {
    if (nocPortalApp) {
        nocPortalApp.stopAutoRefresh();
    }
});