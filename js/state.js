// js/state.js

/**
 * Centralized state management.
 * This object holds the current state of the application.
 */
export const state = {
    tasks: [],
    settings: {},
    activeTaskType: 'Vorteil & Dauer',
    draggedItem: null // Used for UI drag operations
};