// js/utils.js
import { WEEKDAYS } from './config.js';

/**
 * Formats a float number of hours into HHh MMmin format.
 */
export function formatHoursMinutes(totalHours) {
    // Ensure non-negative time
    const safeHours = Math.max(0, totalHours);
    let hours = Math.floor(safeHours);
    let minutes = Math.round((safeHours - hours) * 60);

    // Handle rounding up to 60 minutes
    if (minutes === 60) {
        hours += 1;
        minutes = 0;
    }
    return `${hours}h ${minutes}min`;
}

/**
 * Converts Date object to a YYYY-MM-DD string (local time).
 */
export function formatDateToYYYYMMDD(date) {
    if (!date) return null;
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
