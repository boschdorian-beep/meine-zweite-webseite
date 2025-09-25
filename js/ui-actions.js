// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, handleTaskDrop, updateTaskDetails, getOriginalTotalDuration, recalculateSchedule } from './scheduler.js';
import { clearAllCompletedTasks, deleteTaskDefinition, saveSettings, saveTaskDefinition } from './database.js';
import { renderApp, renderSettingsModal } from './ui-render.js';
import { parseDateString, calculateDecimalHours } from './utils.js';
import { searchUsers, getUsersByIds } from './collaboration.js';
 
// Temporärer Zustand für Modals.
let modalState = {
    tempSettings: {},
    editModal: {
        assignedUsers: [], // Array von Profil-Objekten {uid, email, displayName, shortName}
        ownerId: null
    }
};

// --- Task Interactions ---

/**
 * Hängt Event-Listener an die Filterleiste.
 */
export function attachFilterInteractions() {
    // ... (Logik unverändert, da korrekt)
    const filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;

    // Event-Delegation für die gesamte Leiste
    // Wir verwenden 'change' für Checkboxen/Radios.
    // Wichtig: Listener entfernen, um Doppelungen zu vermeiden, falls die Funktion mehrfach aufgerufen wird.
    // Wir verwenden benannte Funktionen, um removeEventListener korrekt nutzen zu können.
    filterBar.removeEventListener('change', handleFilterChange);
    filterBar.addEventListener('change', handleFilterChange);

    // "Filter löschen"-Button
    const clearBtn = document.getElementById('clear-filters-btn');
    clearBtn.removeEventListener('click', handleClearFilters);
    clearBtn.addEventListener('click', handleClearFilters);
}

// Benannte Funktion für den Filter-Change-Listener
async function handleFilterChange(event) {
    // ... (Logik unverändert, da korrekt)
    const target = event.target;

    // GEÄNDERT: Orts-Filter (Checkboxes)
    if (target.matches('.location-filter-checkbox')) {
        const selectedLocations = Array.from(document.querySelectorAll('.location-filter-checkbox:checked')).map(cb => cb.value);
        // Nutzt das Array prioritizedLocations (siehe state.js)
        state.filters.prioritizedLocations = selectedLocations;
    }

    // Benutzer-Filter (Checkboxes)
    if (target.matches('.user-filter-checkbox')) {
        const selectedUids = Array.from(document.querySelectorAll('.user-filter-checkbox:checked')).map(cb => cb.value);
        state.filters.prioritizedUserIds = selectedUids;
    }

    // Nach jeder Änderung neu berechnen und rendern
    recalculateSchedule();
    await renderApp();
}

// Benannte Funktion für den Clear-Filters-Listener
async function handleClearFilters() {
    // ... (Logik unverändert, da korrekt)
    // GEÄNDERT: prioritizedLocations zurücksetzen
    state.filters.prioritizedLocations = [];
    state.filters.prioritizedUserIds = [];
    
    // Neu berechnen und rendern
    recalculateSchedule();
    await renderApp();
}


export function attachTaskInteractions() {
    // Checkboxen
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.addEventListener('change', handleCheckboxChange);
    });

    // Drag & Drop (Unverändert)
    document.querySelectorAll('.task-item').forEach(taskElement => {
        taskElement.removeEventListener('dragstart', handleDragStart);
        taskElement.removeEventListener('dragend', handleDragEnd);

        if (taskElement.draggable) {
            taskElement.addEventListener('dragstart', handleDragStart);
            taskElement.addEventListener('dragend', handleDragEnd);
        }
    });

    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.removeEventListener('dragover', handleDragOver);
        zone.removeEventListener('dragleave', handleDragLeaveZone);
        zone.removeEventListener('drop', handleDrop);

        // Drop Zones nur aktivieren, wenn Manuell Sortieren AN ist
        if (!state.settings.autoPriority) {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('dragleave', handleDragLeaveZone);
            zone.addEventListener('drop', handleDrop);
        }
    });

    // Klick auf Aufgabe (Öffnet Edit Modal) - GEÄNDERT: Selektor von .task-content zu .task-title
    document.querySelectorAll('.task-title').forEach(content => {
        content.removeEventListener('click', handleTaskContentClick);
        content.addEventListener('click', handleTaskContentClick);
    });

    // Klick auf Notiz-Icon (Toggle Notizen)
    document.querySelectorAll('.toggle-notes-btn').forEach(toggle => {
        toggle.removeEventListener('click', handleNotesToggle);
        toggle.addEventListener('click', handleNotesToggle);
    });

    // NEU: Klick auf Titel-Toggle (Mehr anzeigen/weniger anzeigen)
    document.querySelectorAll('.toggle-title-btn').forEach(toggle => {
        toggle.removeEventListener('click', handleTitleToggle);
        toggle.addEventListener('click', handleTitleToggle);
    });
}

// NEU: Toggle für Titelanzeige (Mehr/Weniger)
function handleTitleToggle(event) {
    // Verhindere, dass der Klick das Edit-Modal öffnet
    event.stopPropagation();
    const taskElement = event.target.closest('.task-item');
    const button = event.target.closest('.toggle-title-btn');

    if (taskElement && button) {
        // Toggle die 'expanded' Klasse auf dem task-item (CSS kümmert sich um die Anzeige)
        const isExpanded = taskElement.classList.toggle('expanded');
        
        if (isExpanded) {
            button.innerHTML = '<i class="fas fa-chevron-up text-gray-500"></i>'; // Pfeil nach oben
            button.title = "Weniger anzeigen";
        } else {
            button.innerHTML = '<i class="fas fa-ellipsis-h text-gray-500"></i>'; // Ellipsis
            button.title = "Vollständigen Titel anzeigen";
        }
    }
}


// Toggle für Notizenanzeige (Unverändert)
function handleNotesToggle(event) {
    // Verhindere, dass der Klick das Edit-Modal öffnet
    event.stopPropagation(); 
    const taskElement = event.target.closest('.task-item');
    const notesContent = taskElement.querySelector('.task-notes-content');
    const button = event.target.closest('.toggle-notes-btn');

    if (notesContent && button) {
        const isVisible = !notesContent.classList.contains('hidden');
        
        if (isVisible) {
            notesContent.classList.add('hidden');
            button.innerHTML = '<i class="fas fa-chevron-down text-gray-500"></i>'; // Pfeil nach unten
        } else {
            notesContent.classList.remove('hidden');
            button.innerHTML = '<i class="fas fa-chevron-up text-gray-500"></i>'; // Pfeil nach oben
        }
    }
}

async function handleCheckboxChange(event) {
    // Verhindere, dass der Klick das Edit-Modal öffnet, wenn auf die Checkbox geklickt wird
    event.stopPropagation();
    const taskId = event.target.dataset.taskId;
    await toggleTaskCompleted(taskId, event.target.checked);
    await renderApp();
}

// --- Drag and Drop Handlers (Unverändert) ---
// ... (handleDragStart, handleDragOver, handleDragLeaveZone, handleDrop, handleDragEnd bleiben unverändert)


// --- Edit Modal Actions (Stark überarbeitet) ---

function handleTaskContentClick(event) {
    // Verhindert Klick, wenn die Aufgabe erledigt ist
    if (event.target.closest('.task-item').classList.contains('completed')) return;

    // Verhindert Klick, wenn auf interaktive Elemente innerhalb des Contents geklickt wird (z.B. Buttons im Titel-Container)
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

// Unterstützt Typänderung, Uhrzeit (Fix/Deadline) und nutzt generalisierte Kollaborations-UI
export async function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Modal-Zustand initialisieren
    modalState.editModal.ownerId = task.ownerId;
    modalState.editModal.assignedUsers = []; // Wird später geladen

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
    // Befülle Fixe Uhrzeit
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
// ... (initializeCollaborationUI, getCollaborationContext, setupCollaborationUI, addUserToAssignment, removeUserFromAssignment, renderSearchResults, renderAssignedUsers bleiben unverändert, da korrekt)


export function closeEditModal() {
    // ... (Logik unverändert)
}

// Liest neue Felder (Typ, Besitzer, Uhrzeit Fix/Deadline) und rechnet Zeit um
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

    const updatedDetails = {
        description: description,
        type: type, // Übergebe den Typ
        assignedTo: assignedUids,
        ownerId: ownerId, // Übergebe den Besitzer
        notes: notes || null,
        location: location || null
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

            // Lese Fixe Uhrzeit
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

export async function handleDeleteTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    let taskName = task ? task.description : "diese Aufgabe";

    // NEU: Kürze den Namen für die Bestätigung, falls er sehr lang ist
    if (taskName.length > 50) {
        taskName = taskName.substring(0, 50) + "...";
    }

    if (confirm(`Möchtest du "${taskName}" wirklich löschen?`)) {
        // 1. Lösche in DB
        await deleteTaskDefinition(taskId);
        
        // 2. Update lokalen State (für Responsivität, der Listener wird dies bestätigen)
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        recalculateSchedule();

        closeEditModal();
        await renderApp();
    }
}

// ... (handleClearCompleted, Settings Modal Actions bleiben unverändert)

// Setzt neue Felder zurück, inkl. Zuweisungen und Uhrzeit (Fix/Deadline)
export function clearInputs() {
    document.getElementById('newTaskInput').value = '';
    document.getElementById('newNotesInput').value = ''; 
    document.getElementById('newLocationSelect').value = ''; // Dropdown zurücksetzen

    // NEU: Zuweisungen zurücksetzen (Standardmäßig nur der aktuelle Benutzer)
    state.newTaskAssignment.length = 0; // Leert das Array
    if (state.userProfile) {
        state.newTaskAssignment.push(state.userProfile);
    }
    // Rendere die Zuweisungsliste neu
    renderAssignedUsers('create');
    // Suchfeld leeren
    const ctx = getCollaborationContext('create');
    if (ctx && ctx.searchInput) {
        ctx.searchInput.value = '';
        if (ctx.searchResults) ctx.searchResults.classList.add('hidden');
    }

    // Setze Stunden auf 1, Minuten auf 0 (Standard)
    document.getElementById('estimated-duration-h').value = '1';
    document.getElementById('estimated-duration-m').value = '0';
    document.getElementById('monthly-financial-benefit').value = '';
    
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-time').value = ''; // NEU: Reset Deadline Uhrzeit
    document.getElementById('deadline-duration-h').value = '1';
    document.getElementById('deadline-duration-m').value = '0';

    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-time').value = ''; // NEU: Reset Fixe Uhrzeit
    document.getElementById('fixed-duration-h').value = '1';
    document.getElementById('fixed-duration-m').value = '0';
    
    document.getElementById('newTaskInput').focus();
}
