// js/state.js

/**
 * Centralized state management.
 */
export const state = {
    user: null, // NEU: Hält das Firebase User Objekt
    tasks: [],
    settings: {},
    activeTaskType: 'Vorteil & Dauer',
    draggedItem: null
};