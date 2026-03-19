class FlatpickrHelper {
    /**
     * Initialize Flatpickr with Hebrew locale and RTL support
     * @param {string} selector - CSS selector for the input element
     * @param {function} onChangeCallback - Callback function when date changes
     * @param {object} additionalOptions - Additional Flatpickr options
     * @returns {object} Flatpickr instance
     */
    static initHebrewDatePicker(selector, onChangeCallback, additionalOptions = {}) {
        const defaultOptions = {
            locale: {
                ...flatpickr.l10ns.he,
                firstDayOfWeek: 0  // Sunday
            },
            dateFormat: "Y-m-d",
            onChange: (selectedDates, dateStr) => {
                if (onChangeCallback) {
                    onChangeCallback(selectedDates, dateStr);
                }
            },
            disableMobile: true,
            allowInput: false,
            position: "auto right",
            static: false
        };

        if (additionalOptions.defaultDate === null ||
            additionalOptions.defaultDate === undefined ||
            additionalOptions.defaultDate === '') {
            delete additionalOptions.defaultDate;
        }

        const options = { ...defaultOptions, ...additionalOptions };

        return flatpickr(selector, options);
    }

    /**
     * Format date to DD/MM/YYYY
     * @param {string} isoDate - Date in ISO format (YYYY-MM-DD)
     * @returns {string} Formatted date (DD/MM/YYYY)
     */
    static formatDateToDisplay(isoDate) {
        if (!isoDate || isoDate === null || isoDate === undefined || isoDate === '') {
            return '';
        }

        const date = new Date(isoDate);

        if (isNaN(date.getTime())) {
            console.error('Invalid date:', isoDate);
            return '';
        }

        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }

    /**
     * Format date to Hebrew long format
     * @param {string} dateString - Date string
     * @returns {string} Hebrew formatted date
     */
    static formatDateToHebrew(dateString) {
        if (!dateString || dateString === null || dateString === undefined || dateString === '') {
            return '';
        }

        const date = new Date(dateString);

        if (isNaN(date.getTime())) {
            console.error('Invalid date:', dateString);
            return '';
        }

        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        return date.toLocaleDateString('he-IL', options);
    }

    /**
     * Get today's date in ISO format
     * @returns {string} Today's date (YYYY-MM-DD)
     */
    static getTodayISO() {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Initialize multiple date pickers at once
     * @param {Array} configs - Array of config objects {selector, callback, options}
     * @returns {Array} Array of Flatpickr instances
     */
    static initMultipleDatePickers(configs) {
        return configs.map(config =>
            this.initHebrewDatePicker(
                config.selector,
                config.callback,
                config.options || {}
            )
        );
    }

    /**
     * Destroy Flatpickr instance safely
     * @param {object} instance - Flatpickr instance
     */
    static destroy(instance) {
        if (instance && typeof instance.destroy === 'function') {
            try {
                instance.destroy();
            } catch (e) {
                console.warn('Error destroying Flatpickr instance:', e);
            }
        }
    }

    /**
     * Clear Flatpickr instance value
     * @param {object} instance - Flatpickr instance
     */
    static clear(instance) {
        if (instance && typeof instance.clear === 'function') {
            try {
                instance.clear();
            } catch (e) {
                console.warn('Error clearing Flatpickr instance:', e);
            }
        }
    }

    /**
     * Set date for Flatpickr instance
     * @param {object} instance - Flatpickr instance
     * @param {string} date - Date to set (YYYY-MM-DD or null)
     */
    static setDate(instance, date) {
        if (instance && typeof instance.setDate === 'function') {
            try {
                if (date === null || date === undefined || date === '') {
                    instance.clear();
                } else {
                    instance.setDate(date);
                }
            } catch (e) {
                console.warn('Error setting Flatpickr date:', e);
            }
        }
    }
}

// Make it globally available
window.FlatpickrHelper = FlatpickrHelper;