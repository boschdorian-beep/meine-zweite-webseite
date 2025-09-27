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
    // draggedItem entfernt.
    
    // Zustand für die Filterleiste (Phase 2)
    filters: {
        prioritizedLocations: [], // Array von Ortsnamen
        prioritizedUserIds: [],      // Array von UIDs der ausgewählten Benutzer
    },

    // Zustand für die Zuweisungen im "Neue Aufgabe"-Formular
    newTaskAssignment: [], // Array von Profil-Objekten {uid, email, displayName, shortName}

    // NEU: Zustand für die Priorität im "Neue Aufgabe"-Formular (Standard: 3)
    newTaskPriority: 3
};
