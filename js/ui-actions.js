// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, handleTaskDrop, updateTaskDetails, getOriginalTotalDuration, deleteTaskAction } from './scheduler.js';
import { renderApp, renderSettingsModal } from './ui-render.js';
import { parseDateString } from './utils.js';
// NEU: Importiere Collaboration Funktionen
import { searchUsers, getUsersByIds } from './collaboration.js';

// Temporärer Zustand für Modals.
let modalState = {
    tempSettings: {},
    // NEU: Zustand für das Edit Modal
    editModal: {
        assignedUsers: [], // Array von {uid, email} Objekten
        ownerId: null
    }
};

// --- Task Interactions (Unverändert) ---

export function attachTaskInteractions() {
    // (Setup Logik unverändert)
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.addEventListener('change', handleCheckboxChange);
    });

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

        if (!state.settings.autoPriority) {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('dragleave', handleDragLeaveZone);
            zone.addEventListener('drop', handleDrop);
        }
    });

    document.querySelectorAll('.task-content').forEach(content => {
        content.removeEventListener('click', handleTaskContentClick);
        content.addEventListener('click', handleTaskContentClick);
    });
}

async function handleCheckboxChange(event) {
    const taskId = event.target.dataset.taskId;
    await toggleTaskCompleted(taskId, event.target.checked);
    renderApp();
}

// --- Drag and Drop Handlers (Unverändert) ---
// (handleDragStart, handleDragOver, handleDragLeaveZone, handleDrop, handleDragEnd)

function handleDragStart(e) {
    state.draggedItem = e.target;
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

    if (dropTargetItem && dropTargetItem !== state.draggedItem) {
        dropTargetTaskId = dropTargetItem.dataset.taskId;
        const rect = dropTargetItem.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        insertBefore = offsetY < rect.height / 2;
    }

    let newDate = null;
    const zone = e.currentTarget;
    const section = zone.closest('[data-date-offset]');
    if (section) {
        const offset = parseInt(section.dataset.dateOffset, 10);
        if (offset < 2) {
            newDate = new Date();
            newDate.setDate(newDate.getDate() + offset);
        }
        if (offset === 2) {
            if (dropTargetItem) {
                 const targetScheduleId = dropTargetItem.dataset.scheduleId;
                 const targetScheduleItem = state.schedule.find(s => s.scheduleId === targetScheduleId);

                 if (targetScheduleItem && targetScheduleItem.plannedDate) {
                    newDate = parseDateString(targetScheduleItem.plannedDate);
                 }
            }
            if (!newDate) {
                newDate = new Date();
                newDate.setDate(newDate.getDate() + 2);
            }
        }
    }

    const success = await handleTaskDrop(draggedTaskId, dropTargetTaskId, insertBefore, newDate);

    if (success) {
        renderApp();
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


// --- Edit Modal Actions (Stark überarbeitet für Kollaboration) ---

function handleTaskContentClick(event) {
    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

// GEÄNDERT: Lädt jetzt auch Zuweisungen (async)
export async function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Modal-Zustand initialisieren
    modalState.editModal.ownerId = task.ownerId;
    modalState.editModal.assignedUsers = []; // Wird gleich geladen

    // 2. Basisdaten befüllen (unverändert)
    document.getElementById('edit-task-id').value = task.id;
    document.getElementById('edit-task-type').value = task.type;
    document.getElementById('edit-description').value = task.description;

    document.querySelectorAll('.edit-inputs').forEach(el => el.classList.add('hidden'));

    if (task.type === 'Vorteil & Dauer') {
        document.getElementById('editVorteilDauerInputs').classList.remove('hidden');
        document.getElementById('edit-estimated-duration').value = getOriginalTotalDuration(task);
        document.getElementById('edit-financial-benefit').value = task.financialBenefit || '';
    } else if (task.type === 'Deadline') {
        document.getElementById('editDeadlineInputs').classList.remove('hidden');
        document.getElementById('edit-deadline-date').value = task.deadlineDate || '';
        document.getElementById('edit-deadline-duration').value = getOriginalTotalDuration(task);
    } else if (task.type === 'Fixer Termin') {
        document.getElementById('editFixerTerminInputs').classList.remove('hidden');
        document.getElementById('edit-fixed-date').value = task.fixedDate || '';
        document.getElementById('edit-fixed-duration').value = getOriginalTotalDuration(task);
    }

    // 3. Zeige das Modal und initialisiere die Kollaborations-UI
    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Event Listener für Suche und Aktionen anhängen
    setupCollaborationUIEvents();
    // Initial leere Liste rendern, während Profile laden
    renderAssignedUsers(); 

    // 4. Lade zugewiesene Benutzerprofile (async)
    const assignedUids = task.assignedTo || [];
    const userProfiles = await getUsersByIds(assignedUids);

    // Konvertiere Map in Array und speichere im Modal-Zustand
    // Verwende einen Fallback, falls ein Profil nicht geladen werden konnte
    modalState.editModal.assignedUsers = assignedUids.map(uid => userProfiles[uid] || { uid: uid, email: `Lade... (${uid.substring(0, 6)})` });
    
    // Rendere die Liste der Zuweisungen erneut mit geladenen Daten
    renderAssignedUsers();
}

// NEU: Initialisiert die UI Events für das Edit Modal
function setupCollaborationUIEvents() {
    const searchInput = document.getElementById('user-search-input');
    const searchResults = document.getElementById('user-search-results');
    const assignedList = document.getElementById('assigned-users-list');

    // Sucheingabe (Debounced)
    let timeout = null;
    searchInput.value = ''; // Input leeren
    searchResults.classList.add('hidden'); // Ergebnisse verstecken

    // Verwende eine benannte Funktion, um Listener sauber zu entfernen/hinzuzufügen
    const handleInput = () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            const results = await searchUsers(searchInput.value);
            renderSearchResults(results);
        }, 300); // 300ms Verzögerung
    };
    
    // Setze den Listener
    searchInput.oninput = handleInput;


    // Klick auf Suchergebnis (Hinzufügen)
    searchResults.onclick = (event) => {
        const userElement = event.target.closest('.user-search-item');
        if (userElement) {
            const uid = userElement.dataset.uid;
            const email = userElement.dataset.email;
            addUserToAssignment(uid, email);
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
function addUserToAssignment(uid, email) {
    if (!modalState.editModal.assignedUsers.find(u => u.uid === uid)) {
        modalState.editModal.assignedUsers.push({ uid, email });
        renderAssignedUsers();
    }
}

// NEU: Entfernt Benutzer aus dem temporären Modal-Zustand
function removeUserFromAssignment(uid) {
    // Der Besitzer kann nicht entfernt werden
    if (uid === modalState.editModal.ownerId) {
        alert("Der Besitzer der Aufgabe kann nicht entfernt werden.");
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
        searchResults.innerHTML = '<div class="p-3 text-gray-500">Keine Benutzer gefunden. (Stellen Sie sicher, dass der Benutzer registriert ist)</div>';
        searchResults.classList.remove('hidden');
        return;
    }

    let count = 0;
    results.forEach(user => {
        // Nur anzeigen, wenn noch nicht zugewiesen
        if (!modalState.editModal.assignedUsers.find(u => u.uid === user.uid)) {
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-gray-100 cursor-pointer user-search-item';
            item.dataset.uid = user.uid;
            item.dataset.email = user.email;
            item.textContent = user.email;
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

    modalState.editModal.assignedUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center bg-white p-2 rounded-lg shadow-sm';
        
        const isOwner = user.uid === modalState.editModal.ownerId;
        const roleText = isOwner ? '(Besitzer)' : '';

        item.innerHTML = `
            <span>${user.email} <span class="text-sm text-gray-500">${roleText}</span></span>
            ${!isOwner ? `<button data-uid="${user.uid}" class="remove-assignment-btn text-red-500 hover:text-red-700 text-xl leading-none">&times;</button>` : ''}
        `;
        assignedList.appendChild(item);
    });
}


export function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // NEU: Modal-Zustand zurücksetzen
    modalState.editModal = { assignedUsers: [], ownerId: null };
    document.getElementById('user-search-input').value = '';
    document.getElementById('user-search-results').classList.add('hidden');
}

// GEÄNDERT: Liest jetzt auch Zuweisungen
export async function handleSaveEditedTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    // NEU: Lese Zuweisungen aus dem Modal-Zustand
    const assignedUids = modalState.editModal.assignedUsers.map(u => u.uid);

    const updatedDetails = {
        description: description,
        assignedTo: assignedUids // Füge Zuweisungen hinzu
    };

    try {
        if (type === 'Vorteil & Dauer') {
            updatedDetails.estimatedDuration = parseFloat(document.getElementById('edit-estimated-duration').value) || 0;
            updatedDetails.financialBenefit = document.getElementById('edit-financial-benefit').value.trim();
        } else if (type === 'Deadline') {
            const deadlineDate = document.getElementById('edit-deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            updatedDetails.deadlineDate = deadlineDate;
            updatedDetails.deadlineDuration = parseFloat(document.getElementById('edit-deadline-duration').value) || 0;
        } else if (type === 'Fixer Termin') {
            const fixedDate = document.getElementById('edit-fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            updatedDetails.fixedDate = fixedDate;
            updatedDetails.fixedDuration = parseFloat(document.getElementById('edit-fixed-duration').value) || 0;
        }

        // Rufe die Scheduler-Logik auf (async)
        await updateTaskDetails(taskId, updatedDetails);

        closeEditModal();
        renderApp();

    } catch (error) {
        alert(error.message);
    }
}

// (handleDeleteTask und Settings Modal Actions bleiben unverändert)
export async function handleDeleteTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    let taskName = task ? task.description : "diese Aufgabe";

    if (confirm(`Möchtest du "${taskName}" wirklich löschen?`)) {
        await deleteTaskAction(taskId);
        closeEditModal();
        renderApp();
    }
}

export function openModal() {
    modalState.tempSettings = JSON.parse(JSON.stringify(state.settings));
    renderSettingsModal(modalState.tempSettings);
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    attachModalEventListeners();
}

export function closeModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
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
    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);
}

function handleTimeslotAction(event) {
    const target = event.target;
    const day = target.dataset.day;

    if (!day) return;

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
        modalState.tempSettings.dailyTimeSlots[day] = [{ id: `ts-${Date.now()}`, start: "09:00", end: "17:00" }];
    }

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

export function clearInputs() {
    document.getElementById('newTaskInput').value = '';
    document.getElementById('estimated-duration').value = '1';
    document.getElementById('monthly-financial-benefit').value = '';
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-duration').value = '1';
    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-duration').value = '1';
    document.getElementById('newTaskInput').focus();
}
