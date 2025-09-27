// js/main.js
import { state } from './state.js';
// GEÄNDERT: saveSettings importiert.
import { initializeDataListeners, saveSettings, saveTaskDefinition } from './database.js';
import { recalculateSchedule } from './scheduler.js';
import { renderApp } from './ui-render.js';
// GEÄNDERT: initializeUIComponents hinzugefügt (ersetzt initializeCollaborationUI).
import {
    openModal, closeModal, setActiveTaskType, clearInputs, updateAndGetSettingsFromModal,
    closeEditModal, handleSaveEditedTask, handleDeleteTask, handleClearCompleted, attachFilterInteractions,
    initializeUIComponents
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
    
    // Füge den aktuellen Benutzer zum State für die neue Aufgabe hinzu (Standard)
    if (state.userProfile && state.newTaskAssignment.length === 0) {
        state.newTaskAssignment.push(state.userProfile);
        // Rendere die UI, falls sie bereits initialisiert wurde
        if (isInitialized) {
            // GEÄNDERT: Ruft die generalisierte Initialisierung auf
            initializeUIComponents();
        }
    }
}

// 3. Callback für Daten-Updates (Unverändert)
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
    // Initialisiere Filter-Interaktionen
    attachFilterInteractions(); 
    // GEÄNDERT: Initialisiere die Komponenten (ersetzt initializeCollaborationUI)
    initializeUIComponents();
    startDayChangeChecker();
}


// --- Timer ---
function startDayChangeChecker() {
    // async wegen renderApp
    // GEÄNDERT: Prüfintervall auf 5 Minuten verkürzt, um die verfügbare Zeit für "Heute" aktuell zu halten.
    setInterval(async () => {
        const now = normalizeDate();
        if (now.getTime() !== currentDay.getTime()) {
            console.log("Tageswechsel erkannt. Aktualisiere Zeitplan und Ansicht.");
            currentDay = now;
            recalculateSchedule();
            await renderApp();
        } else {
            // NEU: Auch innerhalb des Tages müssen wir regelmäßig neu berechnen, 
            // da sich die verfügbare Zeit für "Heute" durch verstreichende Zeit ändert (siehe scheduler.js).
            recalculateSchedule();
            // Ein periodisches Rendern stellt sicher, dass die "Verfügbare Zeit"-Anzeige aktuell ist.
            await renderApp();
        }
    }, 5 * 60 * 1000); // 5 Minuten
}


// --- Event Listeners ---
let listenersAttached = false;
function attachEventListeners() {
    if (listenersAttached) return;

    // Settings Modal
    document.getElementById('settingsBtn').addEventListener('click', openModal);
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('cancelSettingsBtn').addEventListener('click', closeModal);
    document.getElementById('saveSettingsBtn').addEventListener('click', handleSaveSettings);

    // Edit Modal
    document.getElementById('closeEditModalBtn').addEventListener('click', closeEditModal);
    document.getElementById('cancelEditModalBtn').addEventListener('click', closeEditModal);
    document.getElementById('saveTaskBtn').addEventListener('click', handleSaveEditedTask);
    document.getElementById('deleteTaskBtn').addEventListener('click', handleDeleteTask); 

    // Klick außerhalb des Modals (Overlay-Klick) (ENTFERNT)

    // Global actions
    // ENTFERNT: toggleDragDrop Listener
    document.getElementById('clearCompletedBtn').addEventListener('click', handleClearCompleted);

    // Task creation
    document.getElementById('taskTypeButtonsContainer').addEventListener('click', (event) => {
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

// --- Handlers ---

// handleToggleDragDrop entfernt.


async function handleAddTask() {
    const description = document.getElementById('newTaskInput').value.trim();
    if (description === '') {
        alert("Bitte gib eine Aufgabenbeschreibung ein!");
        return;
    }

    // Lese Notizen und Ort
    const notes = document.getElementById('newNotesInput').value.trim();
    const location = document.getElementById('newLocationSelect').value;

    // Lese Zuweisungen aus dem State
    // Stelle sicher, dass mindestens der aktuelle Benutzer enthalten ist (Fallback)
    const assignedTo = state.newTaskAssignment.map(u => u.uid);
    if (state.user && (!assignedTo.includes(state.user.uid))) {
        // Wenn der User sich selbst entfernt hat (sollte durch UI verhindert sein), füge ihn wieder hinzu
        assignedTo.push(state.user.uid);
    }

    // NEU: Lese Priorität aus dem State (wird durch UI-Aktionen gesetzt)
    const priority = state.newTaskPriority;

    // Erstelle die Aufgabendefinition
    const taskDefinition = {
        description: description,
        type: state.activeTaskType,
        completed: false,
        // isManuallyScheduled entfernt
        notes: notes || null,
        location: location || null,
        assignedTo: assignedTo,
        priority: priority // NEU: Priorität hinzufügen
        // ownerId wird automatisch in database.js gesetzt
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

            // Lese die Uhrzeit (optional)
            const fixedTime = document.getElementById('fixed-time').value;
            taskDefinition.fixedTime = fixedTime || null;

            const hours = document.getElementById('fixed-duration-h').value;
            const minutes = document.getElementById('fixed-duration-m').value;
            taskDefinition.fixedDuration = calculateDecimalHours(hours, minutes);
        }

        // 1. Speichere die Definition in der Datenbank (async)
        const newId = await saveTaskDefinition(taskDefinition);

        if (newId) {
            // Der Firestore Listener (handleDataUpdate) wird die neue Aufgabe erhalten und alles aktualisieren.
            // Nur Inputs leeren (clearInputs() setzt auch Zuweisungen und Priorität zurück)
            clearInputs();
        } else {
            throw new Error("Konnte Aufgabe nicht in der Datenbank speichern.");
        }

    } catch (error) {
        alert(error.message);
    }
}

// GEÄNDERT: Implementierung hinzugefügt (war vorher leer)
async function handleSaveSettings() {
    const newSettings = updateAndGetSettingsFromModal();
    
    try {
        // Speichere in der Datenbank (Der Listener wird das Update triggern)
        // Die Validierung (z.B. Limits der Textlänge) erfolgt in saveSettings -> validateSettings.
        await saveSettings(newSettings);

        // Wir verlassen uns auf den Listener (handleDataUpdate), um den State zu aktualisieren und neu zu rendern.
        
        closeModal();
    } catch (error) {
        alert("Fehler beim Speichern der Einstellungen: " + error.message);
    }
}
