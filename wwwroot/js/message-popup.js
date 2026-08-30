// Message Popup Manager
// Handles the display and interaction of message popups

function closeMessagePopup() {
    const popup = document.getElementById('messagePopup');
    if (popup) {
        popup.style.display = 'none';
    }
}

function showMessagePopup(message) {
    const popup = document.getElementById('messagePopup');
    if (popup) {
        popup.style.display = 'block';
        
        // Update popup content if message object is provided
        if (message) {
            if (message.title && document.getElementById('popupTitle')) {
                document.getElementById('popupTitle').textContent = message.title;
            }
            if (message.category && document.getElementById('popupCategory')) {
                document.getElementById('popupCategory').textContent = message.category;
            }
            if (message.priority && document.getElementById('popupPriority')) {
                document.getElementById('popupPriority').textContent = message.priority;
            }
        }
    }
}

// Close popup when clicking outside of it
document.addEventListener('click', function(event) {
    const popup = document.getElementById('messagePopup');
    const popupContent = document.querySelector('.message-popup-content');
    
    if (popup && !popupContent.contains(event.target) && event.target !== popup) {
        closeMessagePopup();
    }
});

// Handle ESC key to close popup
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeMessagePopup();
    }
});
