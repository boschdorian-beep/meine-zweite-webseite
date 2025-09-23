// js/main.js
import { state } from './state.js';
import { loadTasks, loadSettings, saveSettings } from './storage.js';
import { recalculateSchedule } from './scheduler.js';
import { renderApp } from './ui-render.js';
import { openModal, closeModal, setActiveTaskType, clearInputs, getSettingsFromModal } from './ui-actions.js';

// --- Initialization ---
function initialize() {
    // 1. Load data into state
    state.settings = loadSettings();
    state.tasks = loadTasks();

    // 2. Initial calculation and scheduling
    // Ensures the schedule is correct based on current time and settings
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
}

// --- Event Listeners ---
function attachEventListeners() {
    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);

    window.addEventListener('click', (event) => {
        if (event.target === document.getElementById('settingsModal')) {
            closeModal();
        }
    });

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
}

// --- Handlers ---

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
        completed: false
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
        // The recalculateSchedule function handles the logic for all types
        state.tasks.push(baseTask);
        recalculateSchedule();

        renderApp();
        clearInputs();

    } catch (error) {
        alert(error.message);
    }
}

function handleSaveSettings() {
    // Read the settings from the modal UI (which might have been modified)
    const newSettings = getSettingsFromModal();

    // Update global state
    Object.assign(state.settings, newSettings);
    saveSettings();
    closeModal();

    // Re-schedule tasks based on new settings (capacity/priority rules)
    recalculateSchedule();
    renderApp();
}

// Start the application when the DOM is ready
document.addEventListener('DOMContentLoaded', initialize);