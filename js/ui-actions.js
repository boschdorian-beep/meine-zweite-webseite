// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, updateTaskDetails, getOriginalTotalDuration, recalculateSchedule, changeTaskPriority } from './scheduler.js';
import { clearAllCompletedTasks, deleteTaskDefinition, saveSettings, saveTaskDefinition } from './database.js';
import { renderApp, renderSettingsModal, renderPrioritySelector } from './ui-render.js';
import { parseDateString, calculateDecimalHours } from './utils.js';
import { searchUsers, getUsersByIds } from './collaboration.js';
 
// Temporärer Zustand für Modals.
let modalState = {
    tempSettings: {},
    editModal: {
        assignedUsers: [], // Array von Profil-Objekten {uid, email, displayName, shortName}
        ownerId: null,
        priority: 3
    }
};

// ... (Initialization und Task Interactions unverändert)


// --- Edit Modal Actions ---

function handleTaskContentClick(event) {
    // Verhindert Klick, wenn die Aufgabe erledigt ist
    if (event.target.closest('.task-item').classList.contains('completed')) return;

    // Verhindert Klick, wenn auf interaktive Elemente innerhalb des Contents geklickt wird
    // (z.B. Toggle-Buttons für Notizen oder Beschreibung)
    if (event.target.closest('button') || event.target.closest('input')) {
        return;
    }

    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

// Hilfsfunktion zur Umrechnung von Dezimalstunden in H und M
const setDurationInputs = (durationDecimal, inputH, inputM) => {
    // Sicherstellen, dass durationDecimal eine Zahl ist
    const duration = parseFloat(durationDecimal) || 0;
    const totalMinutes = Math.round(duration * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    document.getElementById(inputH).value = hours;
    document.getElementById(inputM).value = minutes;
};

// Hilfsfunktion zum Umschalten der Eingabefelder basierend auf dem Typ
function toggleEditInputs(taskType) {
    document.querySelectorAll('.edit-inputs').forEach(el => el.classList.add('hidden'));

    if (taskType === 'Vorteil & Dauer') {
        document.getElementById('editVorteilDauerInputs').classList.remove('hidden');
    } else if (taskType === 'Deadline') {
        document.getElementById('editDeadlineInputs').classList.remove('hidden');
    } else if (taskType === 'Fixer Termin') {
        document.getElementById('editFixerTerminInputs').classList.remove('hidden');
    }
}

// Unterstützt Typänderung, Uhrzeit (inkl. Deadline Time), Priorität und nutzt generalisierte Kollaborations-UI
export async function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Modal-Zustand initialisieren
    modalState.editModal.ownerId = task.ownerId;
    modalState.editModal.assignedUsers = []; // Wird später geladen
    // Lese Priorität (Standard 3)
    modalState.editModal.priority = task.priority || 3;


    // 2. Basisdaten befüllen
    document.getElementById('edit-task-id').value = task.id;
    // Setze den Wert des <select> elements
    const typeSelect = document.getElementById('edit-task-type');
    typeSelect.value = task.type;
    
    document.getElementById('edit-description').value = task.description;
    document.getElementById('edit-notes').value = task.notes || '';
    document.getElementById('edit-location-select').value = task.location || '';

    // Typ-spezifische Felder befüllen. Wir befüllen alle, falls der Nutzer den Typ ändert.
    const duration = getOriginalTotalDuration(task);
    
    // Vorteil & Dauer
    setDurationInputs(duration, 'edit-estimated-duration-h', 'edit-estimated-duration-m');
    document.getElementById('edit-financial-benefit').value = task.financialBenefit || '';
    
    // Deadline
    document.getElementById('edit-deadline-date').value = task.deadlineDate || '';
    // NEU: Befülle Deadline Uhrzeit
    document.getElementById('edit-deadline-time').value = task.deadlineTime || '';
    setDurationInputs(duration, 'edit-deadline-duration-h', 'edit-deadline-duration-m');
    
    // Fixer Termin
    document.getElementById('edit-fixed-date').value = task.fixedDate || '';
    // Befülle Uhrzeit
    document.getElementById('edit-fixed-time').value = task.fixedTime || '';
    setDurationInputs(duration, 'edit-fixed-duration-h', 'edit-fixed-duration-m');

    // Zeige die richtigen Eingabefelder
    toggleEditInputs(task.type);

    // Event Listener für Typänderung
    // onchange ersetzt bestehende Listener.
    typeSelect.onchange = (event) => {
        toggleEditInputs(event.target.value);
    };

    // 3. Zeige das Modal
    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Initialisiere die Kollaborations-UI
    setupCollaborationUI('edit');
    // Initialisiere die Prioritäts-UI (liest den Wert aus modalState und setzt Listener)
    setupPrioritySelector('edit');

    
    // Initial leere Liste rendern, während Profile laden
    renderAssignedUsers('edit'); 

    // 4. Lade zugewiesene Benutzerprofile (async)
    const assignedUids = task.assignedTo || [];
    const userProfiles = await getUsersByIds(assignedUids);

    // Konvertiere Map in Array für den Modal-Zustand
    modalState.editModal.assignedUsers = assignedUids.map(uid => 
        userProfiles[uid] || { uid: uid, email: `Lade... (${uid.substring(0, 6)})`, displayName: 'Unbekannt', shortName: '??' }
    );
    
    // Rendere die Liste der Zuweisungen erneut mit geladenen Daten
    renderAssignedUsers('edit');
}


// --- Collaboration UI (Generalisiert für Create und Edit) ---

// ... (Funktionen getCollaborationContext, setupCollaborationUI, addUserToAssignment, removeUserFromAssignment, renderSearchResults, renderAssignedUsers sind unverändert)


export function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Modal-Zustand zurücksetzen
    modalState.editModal = { assignedUsers: [], ownerId: null, priority: 3 };
    // UI Elemente leeren (nutzt generalisierte Funktion)
    const ctx = getCollaborationContext('edit');
    if (ctx) {
        if (ctx.searchInput) ctx.searchInput.value = '';
        if (ctx.searchResults) ctx.searchResults.classList.add('hidden');
    }
}

// Liest neue Felder (Typ, Besitzer, Uhrzeit (inkl. Deadline Time), Priorität) und rechnet Zeit um
export async function handleSaveEditedTask() {
    const taskId = document.getElementById('edit-task-id').value;
    // Lese den Typ aus dem <select> Element
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    // Lese Zuweisungen, Notizen und Ort
    const assignedUids = modalState.editModal.assignedUsers.map(u => u.uid);
    const notes = document.getElementById('edit-notes').value.trim();
    const location = document.getElementById('edit-location-select').value;

    // Lese den (potenziell geänderten) Besitzer
    const ownerId = modalState.editModal.ownerId;

    // Lese Priorität aus dem Modal State
    const priority = modalState.editModal.priority;

    const updatedDetails = {
        description: description,
        type: type, // Übergebe den Typ
        assignedTo: assignedUids,
        ownerId: ownerId, // Übergebe den Besitzer
        notes: notes || null,
        location: location || null,
        priority: priority
    };

    try {
        // Lese Stunden/Minuten und rechne um (für den aktuellen Typ)
        if (type === 'Vorteil & Dauer') {
            const hours = document.getElementById('edit-estimated-duration-h').value;
            const minutes = document.getElementById('edit-estimated-duration-m').value;
            updatedDetails.estimatedDuration = calculateDecimalHours(hours, minutes);
            updatedDetails.financialBenefit = document.getElementById('edit-financial-benefit').value.trim();
            
        } else if (type === 'Deadline') {
            const deadlineDate = document.getElementById('edit-deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            updatedDetails.deadlineDate = deadlineDate;

            // NEU: Lese Deadline Uhrzeit
            const deadlineTime = document.getElementById('edit-deadline-time').value;
            updatedDetails.deadlineTime = deadlineTime || null;

            const hours = document.getElementById('edit-deadline-duration-h').value;
            const minutes = document.getElementById('edit-deadline-duration-m').value;
            updatedDetails.deadlineDuration = calculateDecimalHours(hours, minutes);

        } else if (type === 'Fixer Termin') {
            const fixedDate = document.getElementById('edit-fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            updatedDetails.fixedDate = fixedDate;

            // Lese Uhrzeit
            const fixedTime = document.getElementById('edit-fixed-time').value;
            updatedDetails.fixedTime = fixedTime || null;

            const hours = document.getElementById('edit-fixed-duration-h').value;
            const minutes = document.getElementById('edit-fixed-duration-m').value;
            updatedDetails.fixedDuration = calculateDecimalHours(hours, minutes);
        }

        // Rufe die Scheduler-Logik auf (async)
        await updateTaskDetails(taskId, updatedDetails);

        closeEditModal();
        await renderApp();

    } catch (error) {
        alert(error.message);
    }
}

// ... (handleDeleteTask, handleClearCompleted unverändert)


// --- Settings Modal Actions ---

// ... (openModal, closeModal unverändert)

export function updateAndGetSettingsFromModal() {
    modalState.tempSettings.calcPriority = document.getElementById('calcPriorityCheckbox').checked;

    // NEU: Lese die Einstellung für die exakte Zeitanzeige
    const showExactTimesCheckbox = document.getElementById('showExactTimesCheckbox');
    if (showExactTimesCheckbox) {
        modalState.tempSettings.showExactTimes = showExactTimesCheckbox.checked;
    }


    // Lese die Einstellung für die Textlänge
    const truncationLengthInput = document.getElementById('taskTruncationLengthInput');
    if (truncationLengthInput) {
        const value = parseInt(truncationLengthInput.value, 10);
        // Validierung erfolgt primär in database.js, hier nur Prüfung auf gültige Zahl.
        if (!isNaN(value)) {
            modalState.tempSettings.taskTruncationLength = value;
        }
    }


    // Lese die Orte aus dem temporären Zustand. (Unverändert)
    // ...

    // Lese Zeitfenster (Unverändert)
    // ...

    return modalState.tempSettings;
}

// ... (attachModalEventListeners, handleLocationClick, handleLocationInputChange, handleTimeslotAction, renameLocationInStateAndDb, setActiveTaskType unverändert)


// Setzt neue Felder zurück, inkl. Zuweisungen, Uhrzeit (inkl. Deadline) und Priorität
export function clearInputs() {
    // ... (Basis-Felder und Zuweisungen zurücksetzen)

    // Priorität zurücksetzen (Unverändert)

    // Setze Stunden auf 1, Minuten auf 0 (Standard)
    document.getElementById('estimated-duration-h').value = '1';
    document.getElementById('estimated-duration-m').value = '0';
    document.getElementById('monthly-financial-benefit').value = '';
    
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-time').value = ''; // NEU: Reset Deadline Uhrzeit
    document.getElementById('deadline-duration-h').value = '1';
    document.getElementById('deadline-duration-m').value = '0';

    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-time').value = ''; // Reset Uhrzeit
    document.getElementById('fixed-duration-h').value = '1';
    document.getElementById('fixed-duration-m').value = '0';
    
    document.getElementById('newTaskInput').focus();
}
