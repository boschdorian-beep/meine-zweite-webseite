// js/config.js
export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

// LocalStorage Keys werden nicht mehr verwendet.

export function getDefaultSettings() {
    const defaultDailyTimeSlots = {};
    WEEKDAYS.forEach(day => {
        // Use a fresh timestamp for default IDs (wird von der UI Logik benötigt)
        defaultDailyTimeSlots[day] = [{ id: `ts-${Date.now()}-${day}-0`, start: "09:00", end: "17:00" }];
    });
    return {
        calcPriority: true,
        // autoPriority entfernt, da Manuell Sortieren nicht mehr existiert.
        // NEU: Einstellung für die Textlänge (Standard 30 Zeichen)
        taskTruncationLength: 30,
        dailyTimeSlots: defaultDailyTimeSlots,
        locations: [] // Sicherstellen, dass locations existiert
    };
}
