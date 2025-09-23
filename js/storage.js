// js/storage.js
import { TASKS_STORAGE_KEY, SETTINGS_STORAGE_KEY, WEEKDAYS, getDefaultSettings } from './config.js';
import { state } from './state.js';

export function saveTasks() {
    try {
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (e) {
        console.error("Fehler beim Speichern der Aufgaben:", e);
    }
}

export function loadTasks() {
    try {
        const storedTasks = localStorage.getItem(TASKS_STORAGE_KEY);
        return storedTasks ? JSON.parse(storedTasks) : [];
    } catch (e) {
        console.error("Fehler beim Laden der Aufgaben:", e);
        return [];
    }
}

/**
 * Helper function to validate if a timeslot is valid (Start < End).
 */
function isValidSlot(slot) {
    if (!slot || typeof slot.start !== 'string' || typeof slot.end !== 'string') return false;
    // String comparison works for HH:MM format (assuming 24h format)
    return slot.start < slot.end;
}

/**
 * Validates and cleans the settings object before saving or using it.
 */
function validateSettings(settings) {
    const defaults = getDefaultSettings();

    // Ensure core properties exist and are boolean
    if (typeof settings.calcPriority !== 'boolean') settings.calcPriority = defaults.calcPriority;
    if (typeof settings.autoPriority !== 'boolean') settings.autoPriority = defaults.autoPriority;

    if (!settings.dailyTimeSlots || typeof settings.dailyTimeSlots !== 'object') {
        settings.dailyTimeSlots = defaults.dailyTimeSlots;
        return settings;
    }

    // Validate daily time slots
    WEEKDAYS.forEach(day => {
        if (Array.isArray(settings.dailyTimeSlots[day])) {
            // Filter out invalid slots (e.g. end before start, non-string times)
            settings.dailyTimeSlots[day] = settings.dailyTimeSlots[day].filter(isValidSlot);

            // Ensure IDs exist
            settings.dailyTimeSlots[day] = settings.dailyTimeSlots[day].map((slot, idx) => ({
                id: slot.id || `ts-${Date.now()}-${day}-${idx}`,
                start: slot.start,
                end: slot.end
            }));
        } else if (settings.dailyTimeSlots[day] === undefined) {
             // If the day is missing entirely, use default
             settings.dailyTimeSlots[day] = defaults.dailyTimeSlots[day];
        } else {
            // If the structure for a day is corrupted (e.g. not an array), reset it to empty.
             settings.dailyTimeSlots[day] = [];
        }
    });

    return settings;
}


export function saveSettings() {
    try {
        // Validate before saving
        const validatedSettings = validateSettings({ ...state.settings });
        // Update state with validated settings just in case
        Object.assign(state.settings, validatedSettings);
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(validatedSettings));
    } catch (e) {
        console.error("Fehler beim Speichern der Einstellungen:", e);
    }
}

export function loadSettings() {
    try {
        const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const loaded = storedSettings ? JSON.parse(storedSettings) : getDefaultSettings();

        // Validate immediately after loading
        return validateSettings(loaded);

    } catch (e) {
        console.error("Fehler beim Laden der Einstellungen, lade Standardwerte:", e);
        return getDefaultSettings();
    }
}
