// js/main.js
import { state } from './state.js';
import { initializeDataListeners, saveSettings, saveTaskDefinition } from './database.js';
import { recalculateSchedule } from './scheduler.js';
import { renderApp } from './ui-render.js';
import {
    openModal, closeModal, setActiveTaskType, clearInputs, updateAndGetSettingsFromModal,
    closeEditModal, handleSaveEditedTask, handleDeleteTask, handleClearCompleted
} from './ui-actions.js';
// NEU: Importiere calculateDecimalHours
import { normalizeDate, calculateDecimalHours } from './utils.js';
import { initializeAuth, showLoadingScreen, showAppScreen } from './auth.js';

let currentDay = normalizeDate();
let isInitialized = false;
// Flags um initiales Laden zu verfolgen
let initialTasksLoaded = false;
let initialSettingsLoaded = false;

// --- Initialization Flow ---

// 1. Startpunkt
document.addEventListener('DOMContentLoaded', () => {
    showLoadingScreen();
    // initializeAuth ruft onLoginSuccess auf, wenn angemeldet und Profil vollständig.
    initializeAuth(onLoginSuccess);
});

// 2. Wird aufgerufen, wenn Login erfolgreich war (bei jedem Login/Session Restore)
function onLoginSuccess() {
    // Starte die Daten-Listener. Dies ruft handleDataUpdate auf, sobald Daten verfügbar sind.
    initializeDataListeners(handleDataUpdate);

    if (!isInitialized) {
        // Initialisiere die UI-Events nur beim ersten Mal
        initializeUI();
        isInitialized = true;
    }
    // Die App wird angezeigt, sobald handleDataUpdate das initiale Laden bestätigt UND das Profil geladen ist (in showAppScreen geprüft).
}

// 3. Callback für Daten-Updates (Zentraler Punkt für Synchronisation)
// GEÄNDERT: async, da renderApp async ist
async function handleDataUpdate(type, data) {
    // console.log(`Handling update for: ${type}`); // Optional für Debugging

    if (type === 'tasks') {
        state.tasks = data;
        initialTasksLoaded = true;
    } else if (type === 'settings') {
        // Verhindere unnötige Neuberechnungen, wenn sich Einstellungen nicht relevant geändert haben
        if (JSON.stringify(state.settings) === JSON.stringify(data)) {
             initialSettingsLoaded = true;
             // Wichtig: Auch wenn sich nichts geändert hat, müssen wir prüfen, ob wir rendern können (z.B. beim initialen Load).
             if (initialTasksLoaded && initialSettingsLoaded) {
                showAppScreen();
             }
             return; 
        }
        state.settings = data;
        initialSettingsLoaded = true;
    }

    // Prüfe, ob das initiale Laden abgeschlossen ist
    if (initialTasksLoaded && initialSettingsLoaded) {
        // Bei jedem Update (initial oder später): Neu berechnen und rendern
        recalculateSchedule();
        await renderApp(); // Warten auf das Rendering (async wegen Benutzerkürzel-Laden)
        // Sicherstellen, dass die App angezeigt wird (blendet Ladebildschirm aus)
        showAppScreen();
    }
}


// 4. Initialisierung der statischen UI-Elemente
function initializeUI() {
    // Set default active task type
    const defaultButton = document.querySelector('.task-type-btn[data-type="Vorteil & Dauer"]');
    if (defaultButton) {
        setActiveTaskType(defaultButton);
    }

    // Attach global event listeners
    attachEventListeners();
    startDayChangeChecker();
}


// --- Timer ---
function startDayChangeChecker() {
    // GEÄNDERT: async wegen renderApp
    setInterval(async () => {
        const now = normalizeDate();
        if (now.getTime() !== currentDay.getTime()) {
            console.log("Tageswechsel erkannt. Aktualisiere Zeitplan und Ansicht.");
            currentDay = now;
            // Wenn sich der Tag ändert, muss der Plan neu berechnet werden
            recalculateSchedule();
            await renderApp();
        }
    }, 10 * 60 * 1000); // 10 Minuten
}


// --- Event Listeners ---
let listenersAttached = false;
function attachEventListeners() {
    if (listenersAttached) return;

    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);

    document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
    document.getElementById('saveTaskBtn').addEventListener('click', handleSaveEditedTask);
    document.getElementById('deleteTaskBtn').addEventListener('click', handleDeleteTask); 


    window.addEventListener('click', (event) => {
        if (event.target === document.getElementById('settingsModal')) {
            closeModal();
        }
        if (event.target === document.getElementById('editTaskModal')) {
            closeEditModal();
        }
    });

    document.getElementById('toggleDragDrop').addEventListener('change', handleToggleDragDrop);
    // GEÄNDERT: Handler wird jetzt aus ui-actions.js importiert
    document.getElementById('clearCompletedBtn').addEventListener('click', handleClearCompleted);

    document.getElementById('taskTypeButtonsContainer').addEventListener('click', (event) => {
        if (event.target.classList.contains('task-type-btn')) {
            setActiveTaskType(event.target);
        }
    });

    document.getElementById('addTaskBtn').addEventListener('click', handleAddTask);
    document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleAddTask();
        }
    });
    listenersAttached = true;
}

// --- Handlers ---

async function handleToggleDragDrop(event) {
    const manualSortEnabled = event.target.checked;
    // Lokales State Update für sofortiges UI Feedback
    state.settings.autoPriority = !manualSortEnabled;

    // 1. Einstellungen speichern (async). Dies löst ein Settings-Update über den Listener aus.
    await saveSettings(state.settings);
    
    // 2. WICHTIG: Wenn wir auf Auto-Prio zurückschalten (Manuell AUS), müssen wir die Pins (manualDate) in der DB löschen.
    if (state.settings.autoPriority) {
        // Wir müssen den lokalen State temporär aktualisieren, damit saveTaskDefinition die gelöschten Pins speichert.
        // recalculateSchedule() tut dies.
        recalculateSchedule(); 

        for (const task of state.tasks) {
             // Speichere die Änderung in der DB. 
             // Wir warten hier nicht darauf (kein await), damit die UI schnell reagiert.
             // database.js erstellt intern eine Kopie, daher ist es sicher, das task-Objekt direkt zu übergeben.
             saveTaskDefinition(task);
        }
    }
    
    // Da wir den State lokal geändert haben, rendern wir sofort neu für Responsivität.
    recalculateSchedule();
    await renderApp(); // GEÄNDERT: async
}

// handleClearCompleted wurde nach ui-actions.js verschoben.

async function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    // NEU: Lese Notizen und Ort
    const notes = document.getElementById('newNotesInput').value.trim();
    const location = document.getElementById('newLocationInput').value.trim();

    // Erstelle die Aufgabendefinition
    const taskDefinition = {
        description: description,
        type: state.activeTaskType,
        completed: false,
        isManuallyScheduled: false,
        notes: notes || null, // Speichere null, wenn leer
        location: location || null // Speichere null, wenn leer
        // assignedTo und ownerId werden automatisch in database.js gesetzt
    };

    try {
        // GEÄNDERT: Input Validierung und Berechnung der Dauer
        if (state.activeTaskType === 'Vorteil & Dauer') {
            const hours = document.getElementById('estimated-duration-h').value;
            const minutes = document.getElementById('estimated-duration-m').value;
            taskDefinition.estimatedDuration = calculateDecimalHours(hours, minutes);
            taskDefinition.financialBenefit = document.getElementById('monthly-financial-benefit').value.trim();

        } else if (state.activeTaskType === 'Deadline') {
            const deadlineDate = document.getElementById('deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            taskDefinition.deadlineDate = deadlineDate;
            
            const hours = document.getElementById('deadline-duration-h').value;
            const minutes = document.getElementById('deadline-duration-m').value;
            taskDefinition.deadlineDuration = calculateDecimalHours(hours, minutes);

        } else if (state.activeTaskType === 'Fixer Termin') {
            const fixedDate = document.getElementById('fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            taskDefinition.fixedDate = fixedDate;

            const hours = document.getElementById('fixed-duration-h').value;
            const minutes = document.getElementById('fixed-duration-m').value;
            taskDefinition.fixedDuration = calculateDecimalHours(hours, minutes);
        }

        // 1. Speichere die Definition in der Datenbank (async)
        const newId = await saveTaskDefinition(taskDefinition);

        if (newId) {
            // WICHTIG: Wir müssen den State NICHT manuell aktualisieren!
            // Der Firestore Listener (handleDataUpdate) wird automatisch die neue Aufgabe erhalten 
            // und alles aktualisieren.
            
            // Nur Inputs leeren
            clearInputs();
        } else {
            throw new Error("Konnte Aufgabe nicht in der Datenbank speichern.");
        }

    } catch (error) {
        alert(error.message);
    }
}

async function handleSaveSettings() {
    // Lese die Einstellungen aus dem Modal UI
    const newSettings = updateAndGetSettingsFromModal();

    // Behalte den Zustand von autoPriority bei (dieser wird nur durch den Toggle-Button gesteuert)
    newSettings.autoPriority = state.settings.autoPriority;

    // Aktualisiere den lokalen Zustand (für sofortiges Feedback)
    Object.assign(state.settings, newSettings);

    // 1. Speichern (async). Dies löst ein Settings-Update über den Listener aus.
    await saveSettings(state.settings);
    closeModal();
    
    // Der Listener (handleDataUpdate) wird dies auch tun, aber wir rufen es hier auf für Responsivität.
    recalculateSchedule();
    await renderApp(); // GEÄNDERT: async
}
