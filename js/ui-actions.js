// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, handleTaskDrop, updateTaskDetails, getOriginalTotalDuration, recalculateSchedule } from './scheduler.js';
// NEU: Importiere clearAllCompletedTasks und deleteTaskDefinition direkt aus database.js
import { clearAllCompletedTasks, deleteTaskDefinition } from './database.js';
import { renderApp, renderSettingsModal } from './ui-render.js';
// NEU: Importiere Hilfsfunktionen für Zeit und Parsing
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

export function attachTaskInteractions() {
    // Checkboxen
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.addEventListener('change', handleCheckboxChange);
    });

    // Drag & Drop
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

    // Klick auf Aufgabe (Öffnet Edit Modal)
    document.querySelectorAll('.task-content').forEach(content => {
        content.removeEventListener('click', handleTaskContentClick);
        content.addEventListener('click', handleTaskContentClick);
    });

    // NEU: Klick auf Notiz-Icon (Toggle Notizen)
    // Wir suchen nach dem Button, der das Icon enthält
    document.querySelectorAll('.toggle-notes-btn').forEach(toggle => {
        toggle.removeEventListener('click', handleNotesToggle);
        toggle.addEventListener('click', handleNotesToggle);
    });
}

// NEU: Toggle für Notizenanzeige
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
    await renderApp(); // GEÄNDERT: async
}

// --- Drag and Drop Handlers (Unverändert) ---

function handleDragStart(e) {
    // Verhindere Drag, wenn auf interaktive Elemente (Button, Input) geklickt wird
    if (e.target.closest('button') || e.target.closest('input')) {
        e.preventDefault();
        return;
    }
    
    state.draggedItem = e.currentTarget; // Nutze currentTarget, falls auf ein Kind-Element geklickt wurde
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggedItem.dataset.taskId);
    setTimeout(() => {
        state.draggedItem.classList.add('dragging');
    }, 0);
}

function handleDragOver(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.add('drag-over-zone');

    const targetItem = e.target.closest('.task-item');

    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    if (targetItem && targetItem !== state.draggedItem && !targetItem.classList.contains('completed')) {
        const rect = targetItem.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        if (offsetY < rect.height / 2) {
            targetItem.classList.add('drag-over-top');
        } else {
            targetItem.classList.add('drag-over-bottom');
        }
    }
}

function handleDragLeaveZone(e) {
    // Prüft, ob der Cursor die Zone wirklich verlassen hat
    if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over-zone');
    }
}

async function handleDrop(e) {
    e.preventDefault();
    if (!state.draggedItem) return;

    const dropTargetItem = e.target.closest('.task-item');
    const draggedTaskId = state.draggedItem.dataset.taskId;

    let dropTargetTaskId = null;
    let insertBefore = false;

    // Bestimme Ziel und Position (vor oder nach dem Ziel)
    if (dropTargetItem && dropTargetItem !== state.draggedItem) {
        dropTargetTaskId = dropTargetItem.dataset.taskId;
        const rect = dropTargetItem.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        insertBefore = offsetY < rect.height / 2;
    }

    // Bestimme das neue Datum basierend auf der Zone
    let newDate = null;
    const zone = e.currentTarget;
    const section = zone.closest('[data-date-offset]');
    if (section) {
        const offset = parseInt(section.dataset.dateOffset, 10);
        if (offset < 2) {
            // Heute oder Morgen
            newDate = new Date();
            newDate.setDate(newDate.getDate() + offset);
        }
        if (offset === 2) {
            // Zukunft: Versuche das Datum des Ziels zu übernehmen, falls vorhanden
            if (dropTargetItem) {
                 const targetScheduleId = dropTargetItem.dataset.scheduleId;
                 const targetScheduleItem = state.schedule.find(s => s.scheduleId === targetScheduleId);

                 if (targetScheduleItem && targetScheduleItem.plannedDate) {
                    newDate = parseDateString(targetScheduleItem.plannedDate);
                 }
            }
            // Fallback für Zukunft: Heute + 2 Tage
            if (!newDate) {
                newDate = new Date();
                newDate.setDate(newDate.getDate() + 2);
            }
        }
    }

    // Rufe die Scheduler-Logik auf
    const success = await handleTaskDrop(draggedTaskId, dropTargetTaskId, insertBefore, newDate);

    if (success) {
        await renderApp(); // GEÄNDERT: async
    }
    handleDragEnd();
}

function handleDragEnd() {
    if (state.draggedItem) {
        state.draggedItem.classList.remove('dragging');
    }
    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.classList.remove('drag-over-zone');
    });
    state.draggedItem = null;
}


// --- Edit Modal Actions (Stark überarbeitet) ---

function handleTaskContentClick(event) {
    // Verhindert Klick, wenn die Aufgabe erledigt ist
    if (event.target.closest('.task-item').classList.contains('completed')) return;

    // Verhindert Klick, wenn auf interaktive Elemente innerhalb des Contents geklickt wird
    if (event.target.closest('button') || event.target.closest('input')) {
        return;
    }

    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

// GEÄNDERT: Lädt Zuweisungen und befüllt neue Felder (inkl. Zeitumrechnung)
export async function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Modal-Zustand initialisieren
    modalState.editModal.ownerId = task.ownerId;
    modalState.editModal.assignedUsers = []; // Wird gleich geladen

    // 2. Basisdaten befüllen
    document.getElementById('edit-task-id').value = task.id;
    document.getElementById('edit-task-type').value = task.type;
    document.getElementById('edit-description').value = task.description;
    // NEU: Notizen und Ort
    document.getElementById('edit-notes').value = task.notes || '';
    document.getElementById('edit-location').value = task.location || '';

    document.querySelectorAll('.edit-inputs').forEach(el => el.classList.add('hidden'));

    // Hilfsfunktion zur Umrechnung von Dezimalstunden in H und M
    const setDurationInputs = (durationDecimal, inputH, inputM) => {
        const totalMinutes = Math.round(durationDecimal * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        document.getElementById(inputH).value = hours;
        document.getElementById(inputM).value = minutes;
    };

    // Typ-spezifische Felder befüllen
    if (task.type === 'Vorteil & Dauer') {
        document.getElementById('editVorteilDauerInputs').classList.remove('hidden');
        setDurationInputs(getOriginalTotalDuration(task), 'edit-estimated-duration-h', 'edit-estimated-duration-m');
        document.getElementById('edit-financial-benefit').value = task.financialBenefit || '';
    } else if (task.type === 'Deadline') {
        document.getElementById('editDeadlineInputs').classList.remove('hidden');
        document.getElementById('edit-deadline-date').value = task.deadlineDate || '';
        setDurationInputs(getOriginalTotalDuration(task), 'edit-deadline-duration-h', 'edit-deadline-duration-m');
    } else if (task.type === 'Fixer Termin') {
        document.getElementById('editFixerTerminInputs').classList.remove('hidden');
        document.getElementById('edit-fixed-date').value = task.fixedDate || '';
        setDurationInputs(getOriginalTotalDuration(task), 'edit-fixed-duration-h', 'edit-fixed-duration-m');
    }

    // 3. Zeige das Modal und initialisiere die Kollaborations-UI
    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden'); // Einfach einblenden
    
    setupCollaborationUIEvents();
    // Initial leere Liste rendern, während Profile laden
    renderAssignedUsers(); 

    // 4. Lade zugewiesene Benutzerprofile (async)
    const assignedUids = task.assignedTo || [];
    const userProfiles = await getUsersByIds(assignedUids);

    // Konvertiere Map in Array für den Modal-Zustand
    // Verwende einen Fallback, falls ein Profil nicht geladen werden konnte (sollte selten passieren)
    modalState.editModal.assignedUsers = assignedUids.map(uid => 
        userProfiles[uid] || { uid: uid, email: `Lade... (${uid.substring(0, 6)})`, displayName: 'Unbekannt', shortName: '??' }
    );
    
    // Rendere die Liste der Zuweisungen erneut mit geladenen Daten
    renderAssignedUsers();
}

// NEU: Initialisiert die UI Events für das Edit Modal (Suche, Hinzufügen/Entfernen)
function setupCollaborationUIEvents() {
    const searchInput = document.getElementById('user-search-input');
    const searchResults = document.getElementById('user-search-results');
    const assignedList = document.getElementById('assigned-users-list');

    // Sucheingabe (Debounced)
    let timeout = null;
    searchInput.value = ''; // Input leeren
    searchResults.classList.add('hidden'); // Ergebnisse verstecken

    // Verwende eine benannte Funktion für den Listener
    const handleInput = () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            const results = await searchUsers(searchInput.value);
            renderSearchResults(results);
        }, 300); // 300ms Verzögerung
    };
    
    // Setze den Listener (oninput reagiert auf jede Eingabe)
    searchInput.oninput = handleInput;


    // Klick auf Suchergebnis (Hinzufügen)
    searchResults.onclick = (event) => {
        const userElement = event.target.closest('.user-search-item');
        if (userElement) {
            // Lese das Profil aus dem data-Attribut (als JSON gespeichert)
            const userProfile = JSON.parse(userElement.dataset.profile);
            addUserToAssignment(userProfile);
            // UI aufräumen
            searchInput.value = '';
            searchResults.classList.add('hidden');
        }
    };

    // Klick auf Zuweisungsliste (Entfernen)
    assignedList.onclick = (event) => {
        if (event.target.classList.contains('remove-assignment-btn')) {
            const uid = event.target.dataset.uid;
            removeUserFromAssignment(uid);
        }
    };
}

// NEU: Fügt Benutzer zum temporären Modal-Zustand hinzu
function addUserToAssignment(userProfile) {
    if (!modalState.editModal.assignedUsers.find(u => u.uid === userProfile.uid)) {
        modalState.editModal.assignedUsers.push(userProfile);
        renderAssignedUsers();
    }
}

// NEU: Entfernt Benutzer aus dem temporären Modal-Zustand
function removeUserFromAssignment(uid) {
    // Regel 1: Der Besitzer kann nicht entfernt werden
    if (uid === modalState.editModal.ownerId) {
        alert("Der Besitzer der Aufgabe kann nicht entfernt werden.");
        return;
    }

    // Regel 2: Nur der Besitzer darf andere entfernen (außer man entfernt sich selbst)
    if (state.user.uid !== modalState.editModal.ownerId && state.user.uid !== uid) {
        alert("Nur der Besitzer der Aufgabe kann andere Teammitglieder entfernen.");
        return;
    }

    modalState.editModal.assignedUsers = modalState.editModal.assignedUsers.filter(u => u.uid !== uid);
    renderAssignedUsers();
}

// NEU: Rendert die Suchergebnisse
function renderSearchResults(results) {
    const searchResults = document.getElementById('user-search-results');
    searchResults.innerHTML = '';
    
    if (results.length === 0 && document.getElementById('user-search-input').value.length > 0) {
        searchResults.innerHTML = '<div class="p-3 text-gray-500">Keine Benutzer gefunden.</div>';
        searchResults.classList.remove('hidden');
        return;
    }

    let count = 0;
    results.forEach(user => {
        // Nur anzeigen, wenn noch nicht zugewiesen
        if (!modalState.editModal.assignedUsers.find(u => u.uid === user.uid)) {
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-gray-100 cursor-pointer user-search-item';
            // Speichere das gesamte Profil als JSON im data-Attribut
            item.dataset.profile = JSON.stringify(user);
            // Zeige Namen und E-Mail an
            item.innerHTML = `${user.displayName} <span class="text-sm text-gray-500">(${user.email})</span>`;
            searchResults.appendChild(item);
            count++;
        }
    });

    if (count > 0) {
        searchResults.classList.remove('hidden');
    } else {
        searchResults.classList.add('hidden');
    }
}

// NEU: Rendert die Liste der zugewiesenen Benutzer
function renderAssignedUsers() {
    const assignedList = document.getElementById('assigned-users-list');
    assignedList.innerHTML = '';

    // Sortiere: Besitzer zuerst, dann alphabetisch
    const sortedUsers = [...modalState.editModal.assignedUsers].sort((a, b) => {
        if (a.uid === modalState.editModal.ownerId) return -1;
        if (b.uid === modalState.editModal.ownerId) return 1;
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
    });

    sortedUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center bg-white p-2 rounded-lg shadow-sm';
        
        const isOwner = user.uid === modalState.editModal.ownerId;
        const roleText = isOwner ? '(Besitzer)' : '';

        // Prüfe, ob der aktuelle Benutzer entfernen darf (Besitzer oder sich selbst)
        const canRemove = !isOwner && (state.user.uid === modalState.editModal.ownerId || state.user.uid === user.uid);

        // Zeige Namen und E-Mail an
        item.innerHTML = `
            <span>${user.displayName || user.email} <span class="text-sm text-gray-500">${roleText}</span></span>
            ${canRemove ? `<button data-uid="${user.uid}" class="remove-assignment-btn text-red-500 hover:text-red-700 text-xl leading-none" title="Entfernen">&times;</button>` : ''}
        `;
        assignedList.appendChild(item);
    });
}


export function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden'); // Einfach ausblenden
    // NEU: Modal-Zustand zurücksetzen
    modalState.editModal = { assignedUsers: [], ownerId: null };
    document.getElementById('user-search-input').value = '';
    document.getElementById('user-search-results').classList.add('hidden');
}

// GEÄNDERT: Liest neue Felder und rechnet Zeit um
export async function handleSaveEditedTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    // NEU: Lese Zuweisungen, Notizen und Ort
    const assignedUids = modalState.editModal.assignedUsers.map(u => u.uid);
    const notes = document.getElementById('edit-notes').value.trim();
    const location = document.getElementById('edit-location').value.trim();

    const updatedDetails = {
        description: description,
        assignedTo: assignedUids,
        notes: notes || null, // Speichere null wenn leer
        location: location || null // Speichere null wenn leer
    };

    try {
        // GEÄNDERT: Lese Stunden/Minuten und rechne um
        if (type === 'Vorteil & Dauer') {
            const hours = document.getElementById('edit-estimated-duration-h').value;
            const minutes = document.getElementById('edit-estimated-duration-m').value;
            updatedDetails.estimatedDuration = calculateDecimalHours(hours, minutes);
            updatedDetails.financialBenefit = document.getElementById('edit-financial-benefit').value.trim();
            
        } else if (type === 'Deadline') {
            const deadlineDate = document.getElementById('edit-deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            updatedDetails.deadlineDate = deadlineDate;

            const hours = document.getElementById('edit-deadline-duration-h').value;
            const minutes = document.getElementById('edit-deadline-duration-m').value;
            updatedDetails.deadlineDuration = calculateDecimalHours(hours, minutes);

        } else if (type === 'Fixer Termin') {
            const fixedDate = document.getElementById('edit-fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            updatedDetails.fixedDate = fixedDate;

            const hours = document.getElementById('edit-fixed-duration-h').value;
            const minutes = document.getElementById('edit-fixed-duration-m').value;
            updatedDetails.fixedDuration = calculateDecimalHours(hours, minutes);
        }

        // Rufe die Scheduler-Logik auf (async)
        await updateTaskDetails(taskId, updatedDetails);

        closeEditModal();
        await renderApp(); // GEÄNDERT: async

    } catch (error) {
        alert(error.message);
    }
}

// GEÄNDERT: Logik direkt hier, nutzt deleteTaskDefinition
export async function handleDeleteTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    let taskName = task ? task.description : "diese Aufgabe";

    if (confirm(`Möchtest du "${taskName}" wirklich löschen?`)) {
        // 1. Lösche in DB
        await deleteTaskDefinition(taskId);
        
        // 2. Update lokalen State (für Responsivität, der Listener wird dies bestätigen)
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        recalculateSchedule();

        closeEditModal();
        await renderApp(); // GEÄNDERT: async
    }
}

// NEU: Handler für "Alle erledigten löschen" (verschoben von main.js)
export async function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        const completedTasks = state.tasks.filter(task => task.completed);
        const idsToDelete = completedTasks.map(t => t.id);
        
        // Lösche in DB (Der Listener wird das Update triggern)
        await clearAllCompletedTasks(idsToDelete);

        // Update lokalen State für Responsivität
        state.tasks = state.tasks.filter(task => !task.completed);
        recalculateSchedule();
        
        // Neu rendern
        await renderApp();
    }
}


// (Settings Modal Actions bleiben unverändert)
export function openModal() {
    // Kopiere aktuelle Einstellungen in den temporären Zustand
    modalState.tempSettings = JSON.parse(JSON.stringify(state.settings));
    renderSettingsModal(modalState.tempSettings);
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden'); // Einfach einblenden
    attachModalEventListeners();
}

export function closeModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    modalState.tempSettings = {};
}

export function updateAndGetSettingsFromModal() {
    modalState.tempSettings.calcPriority = document.getElementById('calcPriorityCheckbox').checked;

    WEEKDAYS.forEach(dayName => {
        const dayTimeslotsElements = document.getElementById(`timeslots-${dayName}`);
        if (dayTimeslotsElements) {
            const currentDaySlots = [];
            dayTimeslotsElements.querySelectorAll('.timeslot-row').forEach(slotDiv => {
                const startInput = slotDiv.querySelector('.timeslot-start-input');
                const endInput = slotDiv.querySelector('.timeslot-end-input');
                const slotId = slotDiv.dataset.timeslotId;
                if (startInput && endInput && startInput.value && endInput.value) {
                    currentDaySlots.push({
                        id: slotId,
                        start: startInput.value,
                        end: endInput.value
                    });
                }
            });
            if (modalState.tempSettings.dailyTimeSlots) {
                modalState.tempSettings.dailyTimeSlots[dayName] = currentDaySlots;
            }
        }
    });

    return modalState.tempSettings;
}

function attachModalEventListeners() {
    const container = document.getElementById('dailyTimeslotsContainer');
    // Entferne alte Listener, um Doppelungen zu vermeiden
    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);
}

function handleTimeslotAction(event) {
    // Finde den Button, der geklickt wurde (oder das Icon darin)
    const target = event.target.closest('button'); 
    if (!target) return;

    const day = target.dataset.day;
    if (!day) return;

    // Lese aktuelle Werte aus dem DOM, bevor Änderungen vorgenommen werden
    updateAndGetSettingsFromModal();

    if (!modalState.tempSettings.dailyTimeSlots[day]) {
        modalState.tempSettings.dailyTimeSlots[day] = [];
    }

    if (target.classList.contains('remove-timeslot-btn')) {
        const slotIdToRemove = target.dataset.timeslotId;
        modalState.tempSettings.dailyTimeSlots[day] = modalState.tempSettings.dailyTimeSlots[day].filter(slot => slot.id !== slotIdToRemove);

    } else if (target.classList.contains('add-timeslot-btn')) {
        modalState.tempSettings.dailyTimeSlots[day].push({
            id: 'ts-' + Date.now(),
            start: "09:00",
            end: "17:00"
        });

    } else if (target.classList.contains('remove-day-btn')) {
        modalState.tempSettings.dailyTimeSlots[day] = [];

    } else if (target.classList.contains('restore-day-btn')) {
        // Stellt einen Standard-Slot wieder her
        modalState.tempSettings.dailyTimeSlots[day] = [{ id: `ts-${Date.now()}`, start: "09:00", end: "17:00" }];
    }

    // Rendere das Modal neu mit den aktualisierten temporären Einstellungen
    renderSettingsModal(modalState.tempSettings);
}

export function setActiveTaskType(button) {
    document.querySelectorAll('.task-type-btn').forEach(btn => {
        btn.classList.remove('bg-green-500', 'text-white');
        btn.classList.add('text-gray-700', 'hover:bg-gray-300');
    });
    button.classList.add('bg-green-500', 'text-white');
    button.classList.remove('text-gray-700', 'hover:bg-gray-300');

    state.activeTaskType = button.dataset.type;

    document.querySelectorAll('.task-inputs').forEach(input => input.classList.add('hidden'));
    if (state.activeTaskType === 'Vorteil & Dauer') {
        document.getElementById('vorteilDauerInputs').classList.remove('hidden');
    } else if (state.activeTaskType === 'Deadline') {
        document.getElementById('deadlineInputs').classList.remove('hidden');
    } else if (state.activeTaskType === 'Fixer Termin') {
        document.getElementById('fixerTerminInputs').classList.remove('hidden');
    }
}

// GEÄNDERT: Setzt neue Felder zurück
export function clearInputs() {
    document.getElementById('newTaskInput').value = '';
    document.getElementById('newNotesInput').value = '';
    document.getElementById('newLocationInput').value = '';

    // Setze Stunden auf 1, Minuten auf 0 (Standard)
    document.getElementById('estimated-duration-h').value = '1';
    document.getElementById('estimated-duration-m').value = '0';
    document.getElementById('monthly-financial-benefit').value = '';
    
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-duration-h').value = '1';
    document.getElementById('deadline-duration-m').value = '0';

    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-duration-h').value = '1';
    document.getElementById('fixed-duration-m').value = '0';
    
    document.getElementById('newTaskInput').focus();
}
