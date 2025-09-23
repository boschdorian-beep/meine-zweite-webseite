// js/main.js
import { state } from './state.js';
// GEÄNDERT: Importiere saveTaskDefinition
import { loadTasks, loadSettings, saveSettings, saveTaskDefinition } from './database.js';
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

// --- Initialization Flow ---

// 1. Startpunkt
document.addEventListener('DOMContentLoaded', () => {
    showLoadingScreen();
    initializeAuth(onLoginSuccess);
});

// 2. Wird aufgerufen, wenn Login erfolgreich war
async function onLoginSuccess() {
    if (isInitialized) {
        showAppScreen();
        return;
    }

    showLoadingScreen();

    // Lade Daten (Definitionen)
    state.settings = await loadSettings();
    state.tasks = await loadTasks();

    // Initialisiere die App Logik
    initializeAppDataAndUI();
    isInitialized = true;
    showAppScreen();
}

// 3. Initialisierung der App-Logik und UI
function initializeAppDataAndUI() {
    // Berechnung (Plan erstellen) - Jetzt wieder synchron
    recalculateSchedule();

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


// --- Timer (GEÄNDERT: recalculateSchedule ist wieder synchron) ---
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

    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);

    document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
    document.getElementById('saveTaskBtn').addEventListener('click', handleSaveEditedTask);
    // Wichtig: handleDeleteTask aus ui-actions.js wird verwendet
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

// --- Handlers (GEÄNDERT: Folgen dem neuen Muster) ---

async function handleToggleDragDrop(event) {
    const manualSortEnabled = event.target.checked;
    state.settings.autoPriority = !manualSortEnabled;

    // 1. Einstellungen speichern (async)
    await saveSettings(state.settings);
    
    // 2. Neu berechnen (synchron, setzt isManuallyScheduled/manualDate zurück wenn nötig)
    recalculateSchedule();
    
    // 3. Rendern
    renderApp();
    
    // 4. WICHTIG: Wenn wir auf Auto-Prio zurückschalten, müssen wir die Pins (manualDate) in der DB löschen.
    if (state.settings.autoPriority) {
        // Da recalculateSchedule die Pins bereits lokal entfernt hat, speichern wir den aktuellen Stand.
        for (const task of state.tasks) {
             // Optimierung: Man könnte prüfen, ob die Aufgabe vorher manuell war, aber ein Update aller ist sicherer.
             await saveTaskDefinition(task);
        }
    }
}

async function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        // clearCompletedTasks kümmert sich um DB Update, State Update und Recalculate
        await clearCompletedTasks();
        renderApp();
    }
}


// GEÄNDERT: Neues Muster für handleAddTask
async function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    // Erstelle die Aufgabendefinition
    const taskDefinition = {
        // id wird von Firebase generiert
        description: description,
        type: state.activeTaskType,
        completed: false,
        isManuallyScheduled: false
        // ownerId und assignedTo werden in saveTaskDefinition hinzugefügt
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
            // 2. Füge die Definition mit der echten ID zum lokalen State hinzu
            taskDefinition.id = newId;
            state.tasks.push(taskDefinition);

            // 3. Berechne den Plan neu
            recalculateSchedule();

            // 4. Rendern und Inputs leeren
            renderApp();
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

    // Aktualisiere den globalen Zustand
    Object.assign(state.settings, newSettings);

    // 1. Speichern (async)
    await saveSettings(state.settings);
    closeModal();

    // 2. Neu planen
    recalculateSchedule();
    
    // 3. Rendern
    renderApp();
}
