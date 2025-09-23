// js/database.js
import { collection, query, where, getDocs, doc, setDoc, getDoc, deleteDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';
import { state } from './state.js';
import { WEEKDAYS, getDefaultSettings } from './config.js';


// --- TASKS (CRUD for Definitions) ---

/**
 * Lädt alle Aufgabendefinitionen, die dem Benutzer zugewiesen sind.
 */
export async function loadTasks() {
    if (!state.user) return [];

    try {
        const tasksCol = collection(db, "tasks");
        // Query: Lade alle Tasks, bei denen der aktuelle Benutzer im 'assignedTo' Array ist.
        const q = query(tasksCol, where("assignedTo", "array-contains", state.user.uid));
        const snapshot = await getDocs(q);

        const tasks = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Verwende die Firestore ID als primäre ID
            data.id = doc.id;
            tasks.push(data);
        });
        return tasks;
    } catch (error) {
        console.error("Fehler beim Laden der Aufgaben aus Firestore:", error);
        return [];
    }
}

/**
 * Speichert oder aktualisiert eine einzelne Aufgabendefinition.
 * Gibt die (ggf. neue) Firestore ID zurück.
 */
export async function saveTaskDefinition(taskDefinition) {
    if (!state.user) return null;

    const userId = state.user.uid;
    // Erstelle eine Kopie für die Datenbank
    const dataToSave = { ...taskDefinition };

    // 1. Metadaten sicherstellen (für Security Rules)
    if (!dataToSave.ownerId) {
        dataToSave.ownerId = userId;
    }
    if (!dataToSave.assignedTo || dataToSave.assignedTo.length === 0) {
        dataToSave.assignedTo = [userId];
    }

    // 2. Speichern
    try {
        let docRef;
        // Prüfe, ob eine ID existiert und nicht temporär ist (z.B. 'temp-')
        if (dataToSave.id && !dataToSave.id.startsWith('temp-')) {
            // Existierende Aufgabe aktualisieren
            docRef = doc(db, "tasks", dataToSave.id);
            delete dataToSave.id; // ID nicht im Dokument speichern
            await setDoc(docRef, dataToSave, { merge: true });
            return docRef.id;
        } else {
            // Neue Aufgabe erstellen
            delete dataToSave.id; // Temporäre ID entfernen
            docRef = doc(collection(db, "tasks"));
            await setDoc(docRef, dataToSave);
            return docRef.id;
        }
    } catch (error) {
        console.error("Fehler beim Speichern der Aufgabendefinition:", error);
        return null;
    }
}

/**
 * Löscht eine einzelne Aufgabendefinition.
 */
export async function deleteTaskDefinition(taskId) {
    if (!state.user || !taskId) return;

    try {
        const docRef = doc(db, "tasks", taskId);
        await deleteDoc(docRef);
    } catch (error) {
        console.error("Fehler beim Löschen der Aufgabe:", error);
    }
}

/**
 * Löscht alle erledigten Aufgaben des Benutzers (Batch Write).
 */
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


// --- SETTINGS (Unverändert zur vorherigen Version) ---

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

export async function loadSettings() {
    if (!state.user) return getDefaultSettings();

    const settingsRef = doc(db, "settings", state.user.uid);

    try {
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const loadedSettings = docSnap.data();
            return validateSettings({ ...getDefaultSettings(), ...loadedSettings });
        } else {
            const defaultSettings = getDefaultSettings();
            await setDoc(settingsRef, defaultSettings);
            return defaultSettings;
        }
    } catch (error) {
        console.error("Fehler beim Laden der Einstellungen aus Firestore:", error);
        return getDefaultSettings();
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
