// js/database.js
import { collection, query, where, doc, setDoc, deleteDoc, writeBatch, onSnapshot, getDoc, set } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';
import { state } from './state.js';
import { WEEKDAYS, getDefaultSettings } from './config.js';

// NEU: Store für aktive Listener (Unsubscribe-Funktionen)
const activeListeners = {
    tasks: null,
    settings: null
};

// --- Initialization & Lifecycle ---

/**
 * NEU: Initializes real-time listeners for Tasks and Settings.
 * @param {function(string, object): void} onUpdateCallback - Callback function (type, data) when updates occur.
 */
export function initializeDataListeners(onUpdateCallback) {
    if (!state.user) return;

    // Detach previous listeners if they exist (safety measure)
    detachListeners();

    console.log("Attaching Firestore listeners...");
    const userId = state.user.uid;

    // --- Tasks Listener ---
    const tasksCol = collection(db, "tasks");
    // Query: Höre auf alle Tasks, bei denen der aktuelle Benutzer im 'assignedTo' Array ist.
    const q = query(tasksCol, where("assignedTo", "array-contains", userId));

    // onSnapshot abonniert Änderungen
    activeListeners.tasks = onSnapshot(q, (snapshot) => {
        const tasks = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            tasks.push(data);
        });
        console.log("Tasks update received from Firestore.");
        // Informiere die App über das Update
        onUpdateCallback('tasks', tasks);
    }, (error) => {
        console.error("Error in tasks listener:", error);
        if (error.code === 'permission-denied') {
             alert("Zugriff verweigert (Tasks). Bitte überprüfen Sie die Firestore-Sicherheitsregeln.");
        } else {
            alert("Fehler bei der Echtzeit-Synchronisierung der Aufgaben. Bitte prüfe die Netzwerkverbindung.");
        }
    });

    // --- Settings Listener ---
    const settingsRef = doc(db, "settings", userId);
    activeListeners.settings = onSnapshot(settingsRef, async (docSnap) => {
        if (docSnap.exists()) {
            const loadedSettings = docSnap.data();
            const validatedSettings = validateSettings({ ...getDefaultSettings(), ...loadedSettings });
            console.log("Settings update received from Firestore.");
            onUpdateCallback('settings', validatedSettings);
        } else {
            // Handle case where settings don't exist (e.g. new user)
            console.log("Settings not found, creating defaults.");
            const defaultSettings = getDefaultSettings();
            try {
                // Erstelle Standardeinstellungen in der DB, falls sie fehlen
                await setDoc(settingsRef, defaultSettings); 
            } catch (error) {
                console.error("Error creating default settings:", error);
            }
            // Informiere die App sofort über die Standardeinstellungen
            onUpdateCallback('settings', defaultSettings);
        }
    }, (error) => {
        console.error("Error in settings listener:", error);
         if (error.code === 'permission-denied') {
             alert("Zugriff verweigert (Settings). Bitte überprüfen Sie die Firestore-Sicherheitsregeln.");
        }
    });
}

/**
 * NEU: Detaches all active listeners (e.g., on logout).
 */
export function detachListeners() {
    if (activeListeners.tasks) {
        console.log("Detaching Tasks listener.");
        activeListeners.tasks(); // Ruft die Unsubscribe-Funktion auf
        activeListeners.tasks = null;
    }
    if (activeListeners.settings) {
        console.log("Detaching Settings listener.");
        activeListeners.settings();
        activeListeners.settings = null;
    }
}


// --- TASKS (CRUD for Definitions) ---
// Die CRUD Operationen bleiben unverändert, da sie die Listener triggern.

export async function saveTaskDefinition(taskDefinition) {
    if (!state.user) return null;

    const userId = state.user.uid;
    const dataToSave = { ...taskDefinition };

    // 1. Metadaten sicherstellen
    if (!dataToSave.ownerId) {
        dataToSave.ownerId = userId;
    }
    if (!dataToSave.assignedTo || dataToSave.assignedTo.length === 0) {
        dataToSave.assignedTo = [userId];
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

// (Validierungslogik unverändert)
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
}

// saveSettings wird weiterhin benötigt, wenn der Benutzer aktiv speichert
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
