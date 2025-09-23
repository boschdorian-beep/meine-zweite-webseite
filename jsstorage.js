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

export function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
    } catch (e) {
        console.error("Fehler beim Speichern der Einstellungen:", e);
    }
}

export function loadSettings() {
    try {
        const storedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
        const loaded = storedSettings ? JSON.parse(storedSettings) : {};
        const defaults = getDefaultSettings();

        // Merge loaded settings with defaults
        const settings = { ...defaults, ...loaded };

        // Validate and ensure structure integrity
        if (!settings.dailyTimeSlots) {
            settings.dailyTimeSlots = defaults.dailyTimeSlots;
        } else {
            WEEKDAYS.forEach(day => {
                if (!settings.dailyTimeSlots[day]) {
                    // Restore missing day if necessary
                    settings.dailyTimeSlots[day] = defaults.dailyTimeSlots[day];
                } else if (Array.isArray(settings.dailyTimeSlots[day])) {
                    // Ensure existing slots have IDs
                    settings.dailyTimeSlots[day] = settings.dailyTimeSlots[day].map((slot, idx) => ({
                        id: slot.id || `ts-${Date.now()}-${day}-${idx}`,
                        start: slot.start,
                        end: slot.end
                    }));
                }
            });
        }
        return settings;

    } catch (e) {
        console.error("Fehler beim Laden der Einstellungen:", e);
        return getDefaultSettings();
    }
}