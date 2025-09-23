// js/main.js
import { state } from './state.js';
import { loadTasks, loadSettings, saveSettings } from './storage.js';
import { recalculateSchedule, clearCompletedTasks } from './scheduler.js';
import { renderApp } from './ui-render.js';
import {
    openModal, closeModal, setActiveTaskType, clearInputs, updateAndGetSettingsFromModal,
    closeEditModal, handleSaveEditedTask, handleDeleteTask
} from './ui-actions.js';
import { normalizeDate } from './utils.js';

// NEU: Speichert das Datum, an dem die App gestartet wurde
let currentDay = normalizeDate();

// --- Initialization ---
function initialize() {
    // 1. Load data into state
    state.settings = loadSettings();
    state.tasks = loadTasks();

    // 2. Initial calculation and scheduling
    recalculateSchedule();

    // 3. Render UI
    renderApp();

    // 4. Set default active task type
    const defaultButton = document.querySelector('.task-type-btn[data-type="Vorteil & Dauer"]');
    if (defaultButton) {
        setActiveTaskType(defaultButton);
    }

    // 5. Attach global event listeners
    attachEventListeners();

    // 6. NEU: Starte Timer zur Überprüfung des Tageswechsels
    startDayChangeChecker();
}

// NEU: Prüft alle 10 Minuten, ob ein neuer Tag begonnen hat
function startDayChangeChecker() {
    setInterval(() => {
        const now = normalizeDate();
        if (now.getTime() !== currentDay.getTime()) {
            console.log("Tageswechsel erkannt. Aktualisiere Zeitplan und Ansicht.");
            currentDay = now;
            // Wenn sich der Tag ändert, muss alles neu berechnet werden
            recalculateSchedule();
            renderApp();
        }
    }, 10 * 60 * 1000); // 10 Minuten
}


// --- Event Listeners ---
function attachEventListeners() {
    // Settings Modal
    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);

    // NEU: Edit Modal
    document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
    document.getElementById('saveTaskBtn').addEventListener('click', handleSaveEditedTask);
    document.getElementById('deleteTaskBtn').addEventListener('click', handleDeleteTask);


    window.addEventListener('click', (event) => {
        if (event.target === document.getElementById('settingsModal')) {
            closeModal();
        }
        // NEU: Klick außerhalb Edit Modal schließt es
        if (event.target === document.getElementById('editTaskModal')) {
            closeEditModal();
        }
    });

    // NEU: Listener für den DnD Toggle
    document.getElementById('toggleDragDrop').addEventListener('change', handleToggleDragDrop);

    // NEU: Listener für Clear Completed Button
    document.getElementById('clearCompletedBtn').addEventListener('click', handleClearCompleted);


    // Task Type Buttons
    document.getElementById('taskTypeButtonsContainer').addEventListener('click', (event) => {
        if (event.target.classList.contains('task-type-btn')) {
            setActiveTaskType(event.target);
        }
    });

    // Add Task
    document.getElementById('addTaskBtn').addEventListener('click', handleAddTask);
    document.getElementById('newTaskInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleAddTask();
        }
    });
}

// --- Handlers ---

// NEU: Handler für den DnD Toggle
function handleToggleDragDrop(event) {
    const manualSortEnabled = event.target.checked;
    // Wenn Manuell Sortieren AN ist, ist Auto Priorität AUS.
    state.settings.autoPriority = !manualSortEnabled;

    // Wenn wir auf Auto-Priorität zurückschalten, werden alle manuellen Pins entfernt (siehe recalculateSchedule)

    saveSettings();
    // Beim Umschalten muss neu berechnet (wg. Sortierung/Planung) und gerendert (wg. Draggable-Attributen/Pins) werden
    recalculateSchedule();
    renderApp();
}

// NEU: Handler für Clear Completed
function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        clearCompletedTasks();
        renderApp();
    }
}


function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    const baseTask = {
        id: `original-${Date.now()}`,
        description: description,
        type: state.activeTaskType,
        completed: false,
        isManuallyScheduled: false // NEU: Standardmäßig nicht manuell geplant
    };

    // Populate task details based on type
    try {
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

        // Add the task conceptually to the list and recalculate everything
        state.tasks.push(baseTask);
        recalculateSchedule();

        renderApp();
        clearInputs();

    } catch (error) {
        alert(error.message);
    }
}

function handleSaveSettings() {
    // Lese die Einstellungen aus dem Modal UI
    const newSettings = updateAndGetSettingsFromModal();

    // WICHTIG: Behalte den Zustand von autoPriority bei, da dieser nicht mehr im Modal gesteuert wird.
    newSettings.autoPriority = state.settings.autoPriority;

    // Aktualisiere den globalen Zustand mit den bestätigten Einstellungen
    Object.assign(state.settings, newSettings);
    saveSettings();
    closeModal();

    // Neu planen basierend auf den neuen Einstellungen
    recalculateSchedule();
    renderApp();
}

// Start the application when the DOM is ready
document.addEventListener('DOMContentLoaded', initialize);
