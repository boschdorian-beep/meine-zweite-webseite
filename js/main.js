// js/main.js
import { state } from './state.js';
// GEÄNDERT: Importiere initializeDataListeners
import { initializeDataListeners, saveSettings, saveTaskDefinition } from './database.js';
import { recalculateSchedule, clearCompletedTasks } from './scheduler.js';
import { renderApp } from './ui-render.js';
import {
    openModal, closeModal, setActiveTaskType, clearInputs, updateAndGetSettingsFromModal,
    closeEditModal, handleSaveEditedTask, handleDeleteTask
} from './ui-actions.js';
import { normalizeDate } from './utils.js';
import { initializeAuth, showLoadingScreen, showAppScreen } from './auth.js';

let currentDay = normalizeDate();
let isInitialized = false;
// NEU: Flags um initiales Laden zu verfolgen
let initialTasksLoaded = false;
let initialSettingsLoaded = false;

// --- Initialization Flow ---

// 1. Startpunkt
document.addEventListener('DOMContentLoaded', () => {
    showLoadingScreen();
    // initializeAuth ruft onLoginSuccess auf, wenn angemeldet.
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
    // Die App wird angezeigt, sobald handleDataUpdate das initiale Laden bestätigt.
}

// 3. NEU: Callback für Daten-Updates (Zentraler Punkt für Synchronisation)
function handleDataUpdate(type, data) {
    // console.log(`Handling update for: ${type}`); // Optional für Debugging

    if (type === 'tasks') {
        state.tasks = data;
        initialTasksLoaded = true;
    } else if (type === 'settings') {
        // Verhindere unnötige Neuberechnungen, wenn sich Einstellungen nicht relevant geändert haben
        if (JSON.stringify(state.settings) === JSON.stringify(data)) {
             initialSettingsLoaded = true;
             return; 
        }
        state.settings = data;
        initialSettingsLoaded = true;
    }

    // Prüfe, ob das initiale Laden abgeschlossen ist
    if (initialTasksLoaded && initialSettingsLoaded) {
        // Bei jedem Update (initial oder später): Neu berechnen und rendern
        recalculateSchedule();
        renderApp();
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


// --- Timer (Unverändert) ---
function startDayChangeChecker() {
    setInterval(() => {
        const now = normalizeDate();
        if (now.getTime() !== currentDay.getTime()) {
            console.log("Tageswechsel erkannt. Aktualisiere Zeitplan und Ansicht.");
            currentDay = now;
            // Wenn sich der Tag ändert, muss der Plan neu berechnet werden
            recalculateSchedule();
            renderApp();
        }
    }, 10 * 60 * 1000); // 10 Minuten
}


// --- Event Listeners (Unverändert) ---
let listenersAttached = false;
function attachEventListeners() {
    if (listenersAttached) return;

    // (Listener Setup bleibt gleich)
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

// --- Handlers (GEÄNDERT: Angepasst an Listener-Architektur) ---

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
             // Speichere die Änderung in der DB. Dies löst ein Task-Update über den Listener aus.
             // Wir warten hier nicht darauf (kein await), damit die UI schnell reagiert.
             saveTaskDefinition(task);
        }
    }
    
    // Da wir den State lokal geändert haben, rendern wir sofort neu für Responsivität.
    recalculateSchedule();
    renderApp();
}

async function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        // Wir müssen hier die Logik aus dem Scheduler aufrufen, die die DB aktualisiert.
        const completedTasks = state.tasks.filter(task => task.completed);
        const idsToDelete = completedTasks.map(t => t.id);
        // Der Listener wird den State Update und Recalculate/Render triggern.
        await clearCompletedTasks(idsToDelete);
    }
}


async function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    // Erstelle die Aufgabendefinition
    const taskDefinition = {
        description: description,
        type: state.activeTaskType,
        completed: false,
        isManuallyScheduled: false
    };

    try {
        // (Input Validierung unverändert)
        if (state.activeTaskType === 'Vorteil & Dauer') {
            taskDefinition.estimatedDuration = parseFloat(document.getElementById('estimated-duration').value) || 0;
            taskDefinition.financialBenefit = document.getElementById('monthly-financial-benefit').value.trim();

        } else if (state.activeTaskType === 'Deadline') {
            const deadlineDate = document.getElementById('deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            taskDefinition.deadlineDate = deadlineDate;
            taskDefinition.deadlineDuration = parseFloat(document.getElementById('deadline-duration').value) || 0;

        } else if (state.activeTaskType === 'Fixer Termin') {
            const fixedDate = document.getElementById('fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            taskDefinition.fixedDate = fixedDate;
            taskDefinition.fixedDuration = parseFloat(document.getElementById('fixed-duration').value) || 0;
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

    // Behalte den Zustand von autoPriority bei
    newSettings.autoPriority = state.settings.autoPriority;

    // Aktualisiere den lokalen Zustand (für sofortiges Feedback)
    Object.assign(state.settings, newSettings);

    // 1. Speichern (async). Dies löst ein Settings-Update über den Listener aus.
    await saveSettings(state.settings);
    closeModal();
    
    // Der Listener (handleDataUpdate) wird recalculateSchedule() und renderApp() aufrufen.
    // Wir rufen es hier auch auf, um sofortige Responsivität zu gewährleisten.
    recalculateSchedule();
    renderApp();
}
