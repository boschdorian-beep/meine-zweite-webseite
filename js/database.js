// js/database.js
import { collection, query, where, getDocs, doc, setDoc, getDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js';
import { db } from './firebase-init.js';
import { state } from './state.js';
import { WEEKDAYS, getDefaultSettings } from './config.js';

// Cache für geladene Task IDs, um Löschungen bei der Synchronisation zu identifizieren
let loadedTaskIds = new Set();

// --- TASKS ---

export async function loadTasks() {
    if (!state.user) return [];

    try {
        // Query: Lade alle Tasks, bei denen der aktuelle Benutzer im 'assignedTo' Array ist.
        const tasksCol = collection(db, "tasks");
        const q = query(tasksCol, where("assignedTo", "array-contains", state.user.uid));
        const snapshot = await getDocs(q);

        const tasks = [];
        loadedTaskIds.clear();
        snapshot.forEach(doc => {
            const data = doc.data();
            // Verwende die Firestore ID als primäre ID im Frontend
            data.id = doc.id;
            tasks.push(data);
            loadedTaskIds.add(doc.id);
        });
        return tasks;
    } catch (error) {
        console.error("Fehler beim Laden der Aufgaben aus Firestore:", error);
        return [];
    }
}

/**
 * Synchronisiert den lokalen Zustand mit Firestore mittels Batched Write.
 * Erkennt neue, geänderte und gelöschte Aufgaben.
 */
export async function syncTasksToFirestore(tasks) {
    if (!state.user) return;

    const batch = writeBatch(db);
    const newTaskIds = new Set();
    const userId = state.user.uid;

    for (const task of tasks) {
        // 1. Bereite Task Daten vor
        const taskData = { ...task };

        // Sicherstellen, dass Metadaten vorhanden sind (wichtig für Security Rules)
        if (!taskData.ownerId) {
            taskData.ownerId = userId;
        }
        if (!taskData.assignedTo || taskData.assignedTo.length === 0) {
            // Standardmäßig dem Besitzer zuweisen
            taskData.assignedTo = [userId];
        }

        // 2. Bestimme die Firestore Document Reference
        let docRef;
        // Wenn die ID temporär ist (vom Scheduler generiert) oder nicht existiert, erstelle ein neues Dokument
        // Wir prüfen auf typische Präfixe der alten Logik ('temp-', 'original-')
        if (!taskData.id || taskData.id.startsWith('temp-') || taskData.id.startsWith('original-')) {
            docRef = doc(collection(db, "tasks"));
            // Weise die neue Firestore ID dem lokalen Objekt zu (WICHTIG!)
            task.id = docRef.id;
        } else {
             // Existierende Aufgabe
            docRef = doc(db, "tasks", taskData.id);
        }

        // Entferne die ID aus den Daten, da sie der Dokumentenschlüssel ist
        delete taskData.id; 

        // Füge zum Batch hinzu (Update oder Create)
        batch.set(docRef, taskData);
        newTaskIds.add(docRef.id);
    }

    // 3. Finde gelöschte Aufgaben (die vorher geladen wurden, aber jetzt nicht mehr im Zustand sind)
    loadedTaskIds.forEach(id => {
        if (!newTaskIds.has(id)) {
            const docRef = doc(db, "tasks", id);
            batch.delete(docRef);
        }
    });

    // 4. Führe Batch aus
    try {
        await batch.commit();
        // Aktualisiere den Cache der geladenen IDs
        loadedTaskIds = newTaskIds;
    } catch (error) {
        console.error("Fehler beim Synchronisieren der Aufgaben mit Firestore:", error);
    }
}


// --- SETTINGS ---

// (Validierungslogik unverändert zur vorherigen Version)
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

    // Einstellungen werden in der 'settings' Collection gespeichert, Dokumenten-ID = UserID
    const settingsRef = doc(db, "settings", state.user.uid);

    try {
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const loadedSettings = docSnap.data();
            // Validieren und mit Defaults mergen
            return validateSettings({ ...getDefaultSettings(), ...loadedSettings });
        } else {
            // Keine Einstellungen gefunden (z.B. neuer User), Standard verwenden und speichern
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
        // 'merge: true' stellt sicher, dass wir das Dokument aktualisieren
        await setDoc(settingsRef, validatedSettings, { merge: true });
    } catch (error) {
        console.error("Fehler beim Speichern der Einstellungen in Firestore:", error);
    }
}