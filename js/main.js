// js/main.js
import { state } from './state.js';
import { initializeDataListeners, saveSettings, saveTaskDefinition } from './database.js';
import { recalculateSchedule } from './scheduler.js';
import { renderApp } from './ui-render.js';
import {
    openModal, closeModal, setActiveTaskType, clearInputs, updateAndGetSettingsFromModal,
    closeEditModal, handleSaveEditedTask, handleDeleteTask, handleClearCompleted,
    // NEU: Importiere attachFilterInteractions
    attachFilterInteractions
} from './ui-actions.js';
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

// 2. Wird aufgerufen, wenn Login erfolgreich war
function onLoginSuccess() {
    // Starte die Daten-Listener.
    initializeDataListeners(handleDataUpdate);

    if (!isInitialized) {
        // Initialisiere die UI-Events nur beim ersten Mal
        initializeUI();
        isInitialized = true;
    }
}

// 3. Callback für Daten-Updates
async function handleDataUpdate(type, data) {
    
    if (type === 'tasks') {
        state.tasks = data;
        initialTasksLoaded = true;
    } else if (type === 'settings') {
        // Verhindere unnötige Neuberechnungen
        if (JSON.stringify(state.settings) === JSON.stringify(data)) {
             initialSettingsLoaded = true;
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
        // Bei jedem Update: Neu berechnen und rendern
        recalculateSchedule();
        await renderApp(); // Warten auf das Rendering (async)
        // Sicherstellen, dass die App angezeigt wird
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
    // NEU: Initialisiere Filter-Interaktionen (Logik in ui-actions.js)
    attachFilterInteractions(); 
    startDayChangeChecker();
}


// --- Timer ---
function startDayChangeChecker() {
    // async wegen renderApp
    setInterval(async () => {
        const now = normalizeDate();
        if (now.getTime() !== currentDay.getTime()) {
            console.log("Tageswechsel erkannt. Aktualisiere Zeitplan und Ansicht.");
            currentDay = now;
            recalculateSchedule();
            await renderApp();
        }
    }, 10 * 60 * 1000); // 10 Minuten
}


// --- Event Listeners ---
let listenersAttached = false;
function attachEventListeners() {
    if (listenersAttached) return;

    // Settings Modal
    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelSettingsBtn').addEventListener('click', closeModal); // NEU: Abbrechen Button
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);

    // Edit Modal
    document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
    document.getElementById('cancelEditModalBtn').addEventListener('click', closeEditModal); // NEU: Abbrechen Button
    document.getElementById('saveTaskBtn').addEventListener('click', handleSaveEditedTask);
    document.getElementById('deleteTaskBtn').addEventListener('click', handleDeleteTask); 

    // Klick außerhalb des Modals (Overlay-Klick)
    // Wir prüfen, ob das geklickte Element das Overlay selbst ist (nicht der Container darin)
    document.getElementById('settingsModal').addEventListener('click', (event) => {
        // event.target ist das Overlay (modal-overlay), event.currentTarget ist der Listener-Container (auch das Overlay)
        if (event.target === event.currentTarget) {
            closeModal();
        }
    });
    document.getElementById('editTaskModal').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) {
            closeEditModal();
        }
    });


    // Global actions
    document.getElementById('toggleDragDrop').addEventListener('change', handleToggleDragDrop);
    document.getElementById('clearCompletedBtn').addEventListener('click', handleClearCompleted);

    // Task creation
    document.getElementById('taskTypeButtonsContainer').addEventListener('click', (event) => {
        // Nutzt closest, falls auf ein Element innerhalb des Buttons geklickt wurde
        const button = event.target.closest('.task-type-btn');
        if (button) {
            setActiveTaskType(button);
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

// --- Handlers (Unverändert zur letzten Version) ---

async function handleToggleDragDrop(event) {
    const manualSortEnabled = event.target.checked;
    // Lokales State Update für sofortiges UI Feedback
    state.settings.autoPriority = !manualSortEnabled;

    // 1. Einstellungen speichern (async).
    await saveSettings(state.settings);
    
    // 2. WICHTIG: Wenn wir auf Auto-Prio zurückschalten (Manuell AUS), müssen wir die Pins (manualDate) in der DB löschen.
    if (state.settings.autoPriority) {
        // recalculateSchedule() aktualisiert den lokalen State und entfernt Pins.
        recalculateSchedule(); 

        for (const task of state.tasks) {
             // Speichere die Änderung in der DB (ohne await für Responsivität).
             saveTaskDefinition(task);
        }
    }
    
    // Da wir den State lokal geändert haben, rendern wir sofort neu.
    recalculateSchedule();
    await renderApp();
}


async function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    // Lese Notizen und Ort
    const notes = document.getElementById('newNotesInput').value.trim();
    const location = document.getElementById('newLocationInput').value.trim();

    // Erstelle die Aufgabendefinition
    const taskDefinition = {
        description: description,
        type: state.activeTaskType,
        completed: false,
        isManuallyScheduled: false,
        notes: notes || null,
        location: location || null
        // assignedTo und ownerId werden automatisch in database.js gesetzt
    };

    try {
        // Input Validierung und Berechnung der Dauer
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
            // Der Firestore Listener (handleDataUpdate) wird die neue Aufgabe erhalten und alles aktualisieren.
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

    // Behalte den Zustand von autoPriority bei (wird nur durch den Toggle-Button gesteuert)
    newSettings.autoPriority = state.settings.autoPriority;

    // Aktualisiere den lokalen Zustand (für sofortiges Feedback)
    Object.assign(state.settings, newSettings);

    // 1. Speichern (async).
    await saveSettings(state.settings);
    closeModal();
    
    // Der Listener wird dies auch tun, aber wir rufen es hier auf für Responsivität.
    recalculateSchedule();
    await renderApp();
}
