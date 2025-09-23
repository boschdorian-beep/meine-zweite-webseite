// js/utils.js
import { WEEKDAYS } from './config.js';

/**
 * Formats a float number of hours into HHh MMmin format.
 */
export function formatHoursMinutes(totalHours) {
    // Ensure non-negative time
    const safeHours = Math.max(0, totalHours);
    const hours = Math.floor(safeHours);
    const minutes = Math.round((safeHours - hours) * 60);
    return `${hours}h ${minutes}min`;
}

/**
 * Converts Date object to a YYYY-MM-DD string (local time).
 */
export function formatDateToYYYYMMDD(date) {
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
 * Normalizes a date object to the start of the day (midnight local time).
 */
export function normalizeDate(date) {
    const normalized = new Date(date);
    normalized.setHours(0, 0, 0, 0);
    return normalized;
}