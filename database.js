// js/database.js
import { collection, query, where, doc, setDoc, deleteDoc, writeBatch, onSnapshot, getDoc } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';
import { state } from './state.js';
import { WEEKDAYS, getDefaultSettings } from './config.js';

// Store für aktive Listener
const activeListeners = {
    tasks: null,
    settings: null
};

// --- Initialization & Lifecycle ---

export function initializeDataListeners(onUpdateCallback) {
    if (!state.user) return;

    // Detach previous listeners if they exist
    detachListeners();

    console.log("Attaching Firestore listeners...");
    const userId = state.user.uid;

    // --- Tasks Listener ---
    const tasksCol = collection(db, "tasks");
    // Query: Höre auf alle Tasks, bei denen der aktuelle Benutzer im 'assignedTo' Array ist.
    const q = query(tasksCol, where("assignedTo", "array-contains", userId));

    activeListeners.tasks = onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            tasks.push(data);
        });
        console.log("Tasks update received from Firestore.");
        onUpdateCallback('tasks', tasks);
    }, (error) => {
        console.error("Error in tasks listener:", error);
        if (error.code === 'permission-denied') {
             alert("Zugriff verweigert (Tasks). Bitte überprüfen Sie die Firestore-Sicherheitsregeln.");
        }
    });

    // --- Settings Listener ---
    const settingsRef = doc(db, "settings", userId);
    activeListeners.settings = onSnapshot(settingsRef, async (docSnap) => {
        if (docSnap.exists()) {
            const loadedSettings = docSnap.data();
            // Validierung stellt sicher, dass die Struktur korrekt ist
            const validatedSettings = validateSettings({ ...getDefaultSettings(), ...loadedSettings });
            onUpdateCallback('settings', validatedSettings);
        } else {
            // Handle case where settings don't exist (e.g. new user)
            console.log("Settings not found, creating defaults.");
            const defaultSettings = getDefaultSettings();
            try {
                await setDoc(settingsRef, defaultSettings); 
            } catch (error) {
                console.error("Error creating default settings:", error);
            }
            onUpdateCallback('settings', defaultSettings);
        }
    }, (error) => {
        console.error("Error in settings listener:", error);
    });
}

export function detachListeners() {
    if (activeListeners.tasks) {
        activeListeners.tasks(); // Ruft die Unsubscribe-Funktion auf
        activeListeners.tasks = null;
    }
    if (activeListeners.settings) {
        activeListeners.settings();
        activeListeners.settings = null;
    }
}

// --- TASKS (CRUD for Definitions) ---

export async function saveTaskDefinition(taskDefinition) {
    if (!state.user) return null;

    const userId = state.user.uid;
    // WICHTIG: Erstelle eine Kopie der Daten.
    const dataToSave = { ...taskDefinition };

    // 1. Metadaten sicherstellen
    if (!dataToSave.ownerId) {
        dataToSave.ownerId = userId;
    }
    if (!dataToSave.assignedTo || dataToSave.assignedTo.length === 0) {
        dataToSave.assignedTo = [dataToSave.ownerId];
    }

    // 2. Speichern
    try {
        let docRef;
        if (dataToSave.id && !dataToSave.id.startsWith('temp-')) {
            // Existierende Aufgabe aktualisieren
            docRef = doc(db, "tasks", dataToSave.id);
            delete dataToSave.id;
            await setDoc(docRef, dataToSave, { merge: true });
            return docRef.id;
        } else {
            // Neue Aufgabe erstellen
            delete dataToSave.id;
            docRef = doc(collection(db, "tasks"));
            await setDoc(docRef, dataToSave);
            return docRef.id;
        }
    } catch (error) {
        console.error("Fehler beim Speichern der Aufgabendefinition:", error);
        return null;
    }
}

export async function deleteTaskDefinition(taskId) {
    if (!state.user || !taskId) return;

    try {
        const docRef = doc(db, "tasks", taskId);
        await deleteDoc(docRef);
    } catch (error) {
        console.error("Fehler beim Löschen der Aufgabe:", error);
    }
}

export async function clearAllCompletedTasks(completedTaskIds) {
    if (!state.user || completedTaskIds.length === 0) return;

    // Nutzt Batch Write für atomares Löschen mehrerer Dokumente
    const batch = writeBatch(db);
    completedTaskIds.forEach(id => {
        const docRef = doc(db, "tasks", id);
        batch.delete(docRef);
    });

    try {
        await batch.commit();
    } catch (error) {
        console.error("Fehler beim Löschen der erledigten Aufgaben:", error);
    }
}

// --- SETTINGS Validation ---

function isValidSlot(slot) {
    if (!slot || typeof slot.start !== 'string' || typeof slot.end !== 'string') return false;
    return slot.start < slot.end;
}

function validateSettings(settings) {
    const defaults = getDefaultSettings();
    if (typeof settings.calcPriority !== 'boolean') settings.calcPriority = defaults.calcPriority;
    if (typeof settings.autoPriority !== 'boolean') settings.autoPriority = defaults.autoPriority;

    if (!settings.dailyTimeSlots || typeof settings.dailyTimeSlots !== 'object') {
        settings.dailyTimeSlots = defaults.dailyTimeSlots;
        return settings;
    }

    WEEKDAYS.forEach(day => {
        if (Array.isArray(settings.dailyTimeSlots[day])) {
            settings.dailyTimeSlots[day] = settings.dailyTimeSlots[day].filter(isValidSlot);
             settings.dailyTimeSlots[day] = settings.dailyTimeSlots[day].map((slot, idx) => ({
                id: slot.id || `ts-${Date.now()}-${day}-${idx}`,
                start: slot.start,
                end: slot.end
            }));
        } else if (settings.dailyTimeSlots[day] === undefined) {
             settings.dailyTimeSlots[day] = defaults.dailyTimeSlots[day];
        } else {
             settings.dailyTimeSlots[day] = [];
        }
    });
    return settings;

    // NEU: Locations validieren
    if (!Array.isArray(settings.locations)) {
        settings.locations = defaults.locations;
    } else {
        // Stelle sicher, dass es nur eindeutige, getrimmte Strings sind und sortiere sie
        settings.locations = [...new Set(settings.locations.map(loc => String(loc).trim()).filter(Boolean))].sort();
    }
}

export async function saveSettings(settings) {
    if (!state.user) return;

    const validatedSettings = validateSettings({ ...settings });
    const settingsRef = doc(db, "settings", state.user.uid);

    try {
        await setDoc(settingsRef, validatedSettings, { merge: true });
    } catch (error) {
        console.error("Fehler beim Speichern der Einstellungen in Firestore:", error);
    }
}
