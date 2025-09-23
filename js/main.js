// js/main.js
import { state } from './state.js';
// Importiere aus database.js
import { loadTasks, loadSettings, saveSettings } from './database.js';
import { recalculateSchedule, clearCompletedTasks } from './scheduler.js';
import { renderApp } from './ui-render.js';
import {
    openModal, closeModal, setActiveTaskType, clearInputs, updateAndGetSettingsFromModal,
    closeEditModal, handleSaveEditedTask, handleDeleteTask
} from './ui-actions.js';
import { normalizeDate } from './utils.js';
// NEU: Importiere Auth Funktionen
import { initializeAuth, showLoadingScreen, showAppScreen } from './auth.js';

let currentDay = normalizeDate();
let isInitialized = false;

// --- Initialization Flow ---

// 1. Startpunkt
document.addEventListener('DOMContentLoaded', () => {
    showLoadingScreen();
    // Initialisiere Auth Listener. Ruft onLoginSuccess auf, wenn angemeldet.
    initializeAuth(onLoginSuccess);
});

// 2. Wird aufgerufen, wenn Login erfolgreich war (oder Session wiederhergestellt wurde)
async function onLoginSuccess() {
    if (isInitialized) {
        showAppScreen();
        return;
    }

    // Zeige Ladebildschirm wieder an, während Daten geladen werden
    showLoadingScreen();

    // Lade Daten (async)
    // state.user wird in auth.js gesetzt
    state.settings = await loadSettings();
    state.tasks = await loadTasks();

    // Initialisiere die App Logik (async)
    await initializeAppDataAndUI();
    isInitialized = true;
    showAppScreen();
}

// 3. Initialisierung der App-Logik und UI
async function initializeAppDataAndUI() {
    // Berechnung (async)
    await recalculateSchedule();

    // Rendering
    renderApp();

    // Set default active task type
    const defaultButton = document.querySelector('.task-type-btn[data-type="Vorteil & Dauer"]');
    if (defaultButton) {
        setActiveTaskType(defaultButton);
    }

    // Attach global event listeners
    attachEventListeners();
    startDayChangeChecker();
}


// --- Timer (Updated to Async) ---
function startDayChangeChecker() {
    setInterval(async () => {
        const now = normalizeDate();
        if (now.getTime() !== currentDay.getTime()) {
            console.log("Tageswechsel erkannt. Aktualisiere Zeitplan und Ansicht.");
            currentDay = now;
            // Wenn sich der Tag ändert, muss alles neu berechnet werden (async)
            await recalculateSchedule();
            renderApp();
        }
    }, 10 * 60 * 1000); // 10 Minuten
}


// --- Event Listeners ---
let listenersAttached = false;
function attachEventListeners() {
    if (listenersAttached) return;

    // (Listener Setup bleibt gleich, Logout wird durch auth.js gehandhabt)
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

// --- Handlers (GEÄNDERT: Alle sind jetzt async) ---

async function handleToggleDragDrop(event) {
    const manualSortEnabled = event.target.checked;
    state.settings.autoPriority = !manualSortEnabled;

    // Einstellungen speichern (async)
    await saveSettings(state.settings);
    // Neu berechnen (async)
    await recalculateSchedule();
    renderApp();
}

async function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        await clearCompletedTasks();
        renderApp();
    }
}


async function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    // Wir verwenden eine temporäre ID. Die echte ID wird beim Speichern erzeugt.
    const baseTask = {
        id: `temp-${Date.now()}`,
        description: description,
        type: state.activeTaskType,
        completed: false,
        isManuallyScheduled: false
        // ownerId und assignedTo werden beim Speichern (database.js via scheduler) hinzugefügt
    };

    try {
        // (Input Validierung unverändert)
        if (state.activeTaskType === 'Vorteil & Dauer') {
            baseTask.estimatedDuration = parseFloat(document.getElementById('estimated-duration').value) || 0;
            baseTask.financialBenefit = document.getElementById('monthly-financial-benefit').value.trim();

        } else if (state.activeTaskType === 'Deadline') {
            const deadlineDate = document.getElementById('deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            baseTask.deadlineDate = deadlineDate;
            baseTask.deadlineDuration = parseFloat(document.getElementById('deadline-duration').value) || 0;

        } else if (state.activeTaskType === 'Fixer Termin') {
            const fixedDate = document.getElementById('fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            baseTask.fixedDate = fixedDate;
            baseTask.fixedDuration = parseFloat(document.getElementById('fixed-duration').value) || 0;
        }

        // Hinzufügen und neu berechnen (async)
        state.tasks.push(baseTask);
        await recalculateSchedule(); // Dies synchronisiert mit Firebase und aktualisiert die IDs

        renderApp();
        clearInputs();

    } catch (error) {
        alert(error.message);
    }
}

async function handleSaveSettings() {
    // Lese die Einstellungen aus dem Modal UI
    const newSettings = updateAndGetSettingsFromModal();

    // Behalte den Zustand von autoPriority bei
    newSettings.autoPriority = state.settings.autoPriority;

    // Aktualisiere den globalen Zustand
    Object.assign(state.settings, newSettings);

    // Speichern (async)
    await saveSettings(state.settings);
    closeModal();

    // Neu planen (async)
    await recalculateSchedule();
    renderApp();
}