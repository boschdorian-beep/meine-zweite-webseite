// js/config.js
export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
// Verwende Versionsnummern für Storage Keys, falls sich die Datenstruktur ändert
export const TASKS_STORAGE_KEY = 'my_todo_list_tasks_v3';
export const SETTINGS_STORAGE_KEY = 'my_todo_list_settings_v3';

export function getDefaultSettings() {
    const defaultDailyTimeSlots = {};
    WEEKDAYS.forEach(day => {
        // Use a fresh timestamp for default IDs
        defaultDailyTimeSlots[day] = [{ id: `ts-${Date.now()}-${day}-0`, start: "09:00", end: "17:00" }];
    });
    return {
        calcPriority: true,
        autoPriority: true,
        dailyTimeSlots: defaultDailyTimeSlots
    };
}