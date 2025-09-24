// js/state.js
/**
 * Centralized state management.
 */
export const state = {
    user: null,       // Firebase User Objekt
    userProfile: null, // Geladenes Profil aus der 'users' Collection (Name, Kürzel)
    tasks: [],        // Original task definitions (as stored in Firestore)
    schedule: [],     // Calculated schedule instances (ephemeral, not stored)
    settings: {},
    activeTaskType: 'Vorteil & Dauer',
    draggedItem: null,
    
    // Zustand für die Filterleiste (Phase 2)
    filters: {
        prioritizedLocation: null, // String des Ortsnamens
        prioritizedUsers: [],      // Array von UIDs der ausgewählten Benutzer
    }
};
