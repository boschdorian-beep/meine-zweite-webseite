// js/config.js
export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export function getDefaultSettings() {
    const defaultDailyTimeSlots = {};
    // Standardmäßig Mo-So 9-17 Uhr (wie zuvor definiert)
    WEEKDAYS.forEach(day => {
        // Use a fresh timestamp for default IDs (wird von der UI Logik benötigt)
        defaultDailyTimeSlots[day] = [{ id: `ts-${Date.now()}-${day}-0`, start: "09:00", end: "17:00" }];
    });
    return {
        calcPriority: true,
        // autoPriority true bedeutet "Manuell Sortieren" ist AUS
        autoPriority: true, 
        dailyTimeSlots: defaultDailyTimeSlots
    };
}
