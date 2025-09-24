// js/utils.js
import { WEEKDAYS } from './config.js';

/**
 * Formats a float number of hours into HHh MMmin format.
 */
export function formatHoursMinutes(totalHours) {
    // Ensure non-negative time
    const safeHours = Math.max(0, totalHours);
    
    // Berechne Gesamtminuten für Präzision und Rundung
    const totalMinutes = Math.round(safeHours * 60);
    
    if (totalMinutes === 0) return "0min";

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    // Intelligenteres Format (z.B. 1h 30min, 1h, 45min)
    if (hours > 0 && minutes > 0) {
        return `${hours}h ${minutes}min`;
    } else if (hours > 0) {
        return `${hours}h`;
    } else {
        return `${minutes}min`;
    }
}

/**
 * Converts Date object to a YYYY-MM-DD string (local time).
 */
export function formatDateToYYYYMMDD(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Gets the weekday name (e.g., "Montag").
 */
export function getDayOfWeek(date) {
    const dayIndex = date.getDay(); // Sunday is 0
    return WEEKDAYS[(dayIndex + 6) % 7]; // Adjust so Monday is 0
}

/**
 * Normalizes a date object (or current date if null/undefined) to the start of the day (midnight local time).
 */
export function normalizeDate(date = new Date()) {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}

/**
 * Parses a YYYY-MM-DD string and returns a Date object normalized to the start of that day (local time).
 */
export function parseDateString(dateString) {
    if (!dateString) return null;
    // Split the string and use the Date(year, monthIndex, day) constructor for reliable local time interpretation
    const parts = dateString.split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const monthIndex = parseInt(parts[1], 10) - 1; // Month is 0-indexed
        const day = parseInt(parts[2], 10);
        return new Date(year, monthIndex, day, 0, 0, 0, 0);
    }
    return null;
}

// Hilfsfunktionen für Zeitumrechnung und Visualisierung

/**
 * Converts hours and minutes inputs (Strings) into a single decimal hours value.
 */
export function calculateDecimalHours(hoursInput, minutesInput) {
    const hours = parseInt(hoursInput, 10) || 0;
    const minutes = parseInt(minutesInput, 10) || 0;
    
    if (hours < 0 || minutes < 0) return 0;

    // Wir speichern intern weiterhin als Dezimalstunden, um die Scheduler-Logik nicht zu ändern.
    return hours + (minutes / 60);
}

/**
 * Generiert eine konsistente Farbe basierend auf einem String (für Orte).
 * Nutzt HSL für angenehmere Farben.
 */
export function generateColorFromString(str) {
    if (!str) return 'transparent';

    // Einfacher Hash-Algorithmus
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Konvertiere zu 32bit Integer
    }
    
    // Generiere Hue (0-360), Saturation (60-80%), Lightness (45%)
    // Nutze Math.abs, da der Hash negativ sein kann.
    const h = Math.abs(hash) % 360;
    const s = 60 + (Math.abs(hash) % 20); // Sorgt für kräftige Farben
    const l = 45; // Etwas dunkler für besseren Kontrast auf Weiß

    return `hsl(${h}, ${s}%, ${l}%)`;
}
