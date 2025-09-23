// js/state.js

/**
 * Centralized state management.
 */
export const state = {
    user: null,   // Firebase User Objekt
    tasks: [],    // NEU: Original task definitions (as stored in Firestore)
    schedule: [], // NEU: Calculated schedule instances (ephemeral, not stored)
    settings: {},
    activeTaskType: 'Vorteil & Dauer',
    draggedItem: null
};
