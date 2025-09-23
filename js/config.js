// js/config.js
export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
// Version erhöht wegen neuer Features und Datenstruktur (isManuallyScheduled)
export const TASKS_STORAGE_KEY = 'my_todo_list_tasks_v10';
export const SETTINGS_STORAGE_KEY = 'my_todo_list_settings_v10';

export function getDefaultSettings() {
    const defaultDailyTimeSlots = {};
    WEEKDAYS.forEach(day => {
        // Use a fresh timestamp for default IDs
        defaultDailyTimeSlots[day] = [{ id: `ts-${Date.now()}-${day}-0`, start: "09:00", end: "17:00" }];
    });
    return {
        calcPriority: true,
        // autoPriority true bedeutet "Manuell Sortieren" ist AUS
        autoPriority: true,
        dailyTimeSlots: defaultDailyTimeSlots
    };
}
