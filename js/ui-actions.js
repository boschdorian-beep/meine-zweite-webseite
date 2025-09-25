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
    const filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;

    // Event-Delegation für die gesamte Leiste
    filterBar.addEventListener('change', async (event) => {
        const target = event.target;

        // GEÄNDERT: Orts-Filter (Checkboxes statt Radio-Buttons)
        if (target.matches('.location-filter-checkbox')) {
            const selectedLocations = Array.from(document.querySelectorAll('.location-filter-checkbox:checked')).map(cb => cb.value);
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
    });

    // "Filter löschen"-Button
    const clearBtn = document.getElementById('clear-filters-btn');
    clearBtn.addEventListener('click', async () => {
        // GEÄNDERT: prioritizedLocations zurücksetzen
        state.filters.prioritizedLocations = [];
        state.filters.prioritizedUserIds = [];
        
        // Neu berechnen und rendern
        recalculateSchedule();
        await renderApp();
    });
}

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

    // Klick auf Notiz-Icon (Toggle Notizen)
    document.querySelectorAll('.toggle-notes-btn').forEach(toggle => {
        toggle.removeEventListener('click', handleNotesToggle);
        toggle.addEventListener('click', handleNotesToggle);
    });
}

// Toggle für Notizenanzeige
function handleNotesToggle(event) {
    event.stopPropagation(); 
    const taskElement = event.target.closest('.task-item');
    const notesContent = taskElement.querySelector('.task-notes-content');
    const button = event.target.closest('.toggle-notes-btn');

    if (notesContent && button) {
        const isVisible = !notesContent.classList.contains('hidden');
        
        if (isVisible) {
            notesContent.classList.add('hidden');
            button.innerHTML = '<i class="fas fa-chevron-down text-gray-500"></i>';
        } else {
            notesContent.classList.remove('hidden');
            button.innerHTML = '<i class="fas fa-chevron-up text-gray-500"></i>';
        }
    }
}

async function handleCheckboxChange(event) {
    event.stopPropagation();
    const taskId = event.target.dataset.taskId;
    await toggleTaskCompleted(taskId, event.target.checked);
    await renderApp();
}

// --- Drag and Drop Handlers ---

function handleDragStart(e) {
    if (e.target.closest('button') || e.target.closest('input')) {
        e.preventDefault();
        return;
    }
    
    state.draggedItem = e.currentTarget;
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
        await renderApp();
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
    if (event.target.closest('.task-item').classList.contains('completed')) return;
    if (event.target.closest('button') || event.target.closest('input')) return;

    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

// Hilfsfunktion zur Umrechnung von Dezimalstunden in H und M
const setDurationInputs = (durationDecimal, inputH, inputM) => {
    const totalMinutes = Math.round(durationDecimal * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    document.getElementById(inputH).value = hours;
    document.getElementById(inputM).value = minutes;
};

// NEU: Hilfsfunktion zum Umschalten der Eingabefelder basierend auf dem Typ
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

// GEÄNDERT: Unterstützt Typänderung, Uhrzeit und nutzt generalisierte Kollaborations-UI
export async function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Modal-Zustand initialisieren
    modalState.editModal.ownerId = task.ownerId;
    modalState.editModal.assignedUsers = []; // Wird später geladen

    // 2. Basisdaten befüllen
    document.getElementById('edit-task-id').value = task.id;
    const typeSelect = document.getElementById('edit-task-type');
    typeSelect.value = task.type;
    
    document.getElementById('edit-description').value = task.description;
    document.getElementById('edit-notes').value = task.notes || '';
    document.getElementById('edit-location-select').value = task.location || '';

    // Typ-spezifische Felder befüllen
    const duration = getOriginalTotalDuration(task);
    setDurationInputs(duration, 'edit-estimated-duration-h', 'edit-estimated-duration-m');
    document.getElementById('edit-financial-benefit').value = task.financialBenefit || '';
    document.getElementById('edit-deadline-date').value = task.deadlineDate || '';
    setDurationInputs(duration, 'edit-deadline-duration-h', 'edit-deadline-duration-m');
    document.getElementById('edit-fixed-date').value = task.fixedDate || '';
    document.getElementById('edit-fixed-time').value = task.fixedTime || '';
    setDurationInputs(duration, 'edit-fixed-duration-h', 'edit-fixed-duration-m');

    toggleEditInputs(task.type);

    typeSelect.onchange = (event) => {
        toggleEditInputs(event.target.value);
    };

    // 3. Zeige das Modal und initialisiere UI
    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    setupCollaborationUI('edit');
    renderAssignedUsers('edit'); 

    // 4. Lade zugewiesene Benutzerprofile (async)
    const assignedUids = task.assignedTo || [];
    const userProfiles = await getUsersByIds(assignedUids);

    modalState.editModal.assignedUsers = assignedUids.map(uid => 
        userProfiles[uid] || { uid: uid, email: `Lade... (${uid.substring(0, 6)})`, displayName: 'Unbekannt', shortName: '??' }
    );
    
    renderAssignedUsers('edit');
}


// --- Collaboration UI (Generalisiert für Create und Edit) ---

export function initializeCollaborationUI() {
    setupCollaborationUI('create');
    renderAssignedUsers('create');
}

function getCollaborationContext(context) {
    if (context === 'edit') {
        return {
            assignmentState: modalState.editModal.assignedUsers,
            ownerId: modalState.editModal.ownerId,
            searchInput: document.getElementById('user-search-input-edit'),
            searchResults: document.getElementById('user-search-results-edit'),
            assignedList: document.getElementById('assigned-users-list-edit')
        };
    } else if (context === 'create') {
        return {
            assignmentState: state.newTaskAssignment,
            ownerId: state.user ? state.user.uid : null,
            searchInput: document.getElementById('user-search-input-create'),
            searchResults: document.getElementById('user-search-results-create'),
            assignedList: document.getElementById('assigned-users-list-create')
        };
    }
    return null;
}

function setupCollaborationUI(context) {
    const ctx = getCollaborationContext(context);
    if (!ctx || !ctx.searchInput) return;

    let timeout = null;
    if (context === 'edit') {
        ctx.searchInput.value = '';
    }
    ctx.searchResults.classList.add('hidden');

    const handleInput = () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            const results = await searchUsers(ctx.searchInput.value);
            renderSearchResults(context, results);
        }, 300);
    };
    
    ctx.searchInput.oninput = handleInput;

    ctx.searchResults.onclick = (event) => {
        const userElement = event.target.closest('.user-search-item');
        if (userElement) {
            const userProfile = JSON.parse(userElement.dataset.profile);
            addUserToAssignment(context, userProfile);
            ctx.searchInput.value = '';
            ctx.searchResults.classList.add('hidden');
        }
    };

    ctx.assignedList.onclick = (event) => {
        if (event.target.classList.contains('remove-assignment-btn')) {
            const uid = event.target.dataset.uid;
            removeUserFromAssignment(context, uid);
        }
    };
}

function addUserToAssignment(context, userProfile) {
    const ctx = getCollaborationContext(context);
    
    if (!ctx.assignmentState.find(u => u.uid === userProfile.uid)) {
        ctx.assignmentState.push(userProfile);
        renderAssignedUsers(context);
    }
}

function removeUserFromAssignment(context, uid) {
    const ctx = getCollaborationContext(context);
    const ownerId = ctx.ownerId;

    if (uid === ownerId) {
        if (ctx.assignmentState.length > 1) {
            if (context === 'edit') {
                const potentialOwners = ctx.assignmentState.filter(u => u.uid !== ownerId);
                const newOwner = potentialOwners[0];
                
                if (confirm(`Du bist der Besitzer dieser Aufgabe. Wenn du dich entfernst, wird die Besitzerschaft an ${newOwner.displayName} übertragen. Fortfahren?`)) {
                    modalState.editModal.ownerId = newOwner.uid;
                    const index = ctx.assignmentState.findIndex(u => u.uid === uid);
                    if (index > -1) ctx.assignmentState.splice(index, 1);
                } else {
                    return;
                }
            } else {
                return; 
            }
        } else {
            alert("Mindestens ein Teammitglied muss zugewiesen bleiben.");
            return;
        }
    } else {
        if (state.user.uid !== ownerId && state.user.uid !== uid) {
            alert("Nur der Besitzer der Aufgabe kann andere Teammitglieder entfernen.");
            return;
        }
        const index = ctx.assignmentState.findIndex(u => u.uid === uid);
        if (index > -1) ctx.assignmentState.splice(index, 1);
    }

    renderAssignedUsers(context);
}

function renderSearchResults(context, results) {
    const ctx = getCollaborationContext(context);
    if (!ctx) return;
    const searchResults = ctx.searchResults;
    searchResults.innerHTML = '';
    
    if (results.length === 0 && ctx.searchInput.value.length > 0) {
        searchResults.innerHTML = '<div class="p-3 text-gray-500">Keine Benutzer gefunden.</div>';
        searchResults.classList.remove('hidden');
        return;
    }

    let count = 0;
    results.forEach(user => {
        if (!ctx.assignmentState.find(u => u.uid === user.uid)) {
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-gray-100 cursor-pointer user-search-item';
            item.dataset.profile = JSON.stringify(user);
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

function renderAssignedUsers(context) {
    const ctx = getCollaborationContext(context);
    if (!ctx || !ctx.assignedList) return;

    ctx.assignedList.innerHTML = '';
    const ownerId = ctx.ownerId;

    const sortedUsers = [...ctx.assignmentState].sort((a, b) => {
        if (a.uid === ownerId) return -1;
        if (b.uid === ownerId) return 1;
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
    });

    sortedUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center bg-white p-2 rounded-lg shadow-sm';
        
        const isOwner = user.uid === ownerId;
        let roleText = isOwner ? '(Besitzer)' : '';
        if (context === 'create' && isOwner) roleText = '(Du)';

        let canRemove = false;
        if (context === 'create') {
             canRemove = !isOwner;
        } else {
            canRemove = (state.user.uid === ownerId) || (state.user.uid === user.uid);
        }

        item.innerHTML = `
            <span>${user.displayName || user.email} <span class="text-sm text-gray-500">${roleText}</span></span>
            ${canRemove ? `<button data-uid="${user.uid}" class="remove-assignment-btn text-red-500 hover:text-red-700 text-xl leading-none" title="Entfernen">&times;</button>` : ''}
        `;
        ctx.assignedList.appendChild(item);
    });
}


export function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalState.editModal = { assignedUsers: [], ownerId: null };
    document.getElementById('user-search-input-edit').value = '';
    document.getElementById('user-search-results-edit').classList.add('hidden');
}

export async function handleSaveEditedTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    const assignedUids = modalState.editModal.assignedUsers.map(u => u.uid);
    const notes = document.getElementById('edit-notes').value.trim();
    const location = document.getElementById('edit-location-select').value;
    const ownerId = modalState.editModal.ownerId;

    const updatedDetails = {
        description: description,
        type: type,
        assignedTo: assignedUids,
        ownerId: ownerId,
        notes: notes || null,
        location: location || null
    };

    try {
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

            const fixedTime = document.getElementById('edit-fixed-time').value;
            updatedDetails.fixedTime = fixedTime || null;

            const hours = document.getElementById('edit-fixed-duration-h').value;
            const minutes = document.getElementById('edit-fixed-duration-m').value;
            updatedDetails.fixedDuration = calculateDecimalHours(hours, minutes);
        }

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

    if (confirm(`Möchtest du "${taskName}" wirklich löschen?`)) {
        await deleteTaskDefinition(taskId);
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        recalculateSchedule();
        closeEditModal();
        await renderApp();
    }
}

export async function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        const completedTasks = state.tasks.filter(task => task.completed);
        const idsToDelete = completedTasks.map(t => t.id);
        
        await clearAllCompletedTasks(idsToDelete);
        state.tasks = state.tasks.filter(task => !task.completed);
        recalculateSchedule();
        await renderApp();
    }
}


// --- Settings Modal Actions ---

export function openModal() {
    const allTaskLocations = [...new Set(state.tasks.map(t => t.location).filter(Boolean))];
    const allSettingLocations = state.settings.locations || [];
    const combinedLocations = [...new Set([...allSettingLocations, ...allTaskLocations])].sort();

    modalState.tempSettings = JSON.parse(JSON.stringify(state.settings));
    modalState.tempSettings.locations = combinedLocations;

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
    const settingsModal = document.getElementById('settingsModal');

    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);

    settingsModal.removeEventListener('click', handleLocationClick);
    settingsModal.addEventListener('click', handleLocationClick);
    settingsModal.removeEventListener('change', handleLocationInputChange);
    settingsModal.addEventListener('change', handleLocationInputChange);
}

async function handleLocationClick(event) {
    const addBtn = event.target.closest('#add-location-btn');
    const removeBtn = event.target.closest('.remove-location-btn');

    if (addBtn) {
        event.preventDefault();
        const input = document.getElementById('new-location-input');
        const newLocation = input.value.trim();
        if (newLocation && !state.settings.locations.includes(newLocation)) {
            state.settings.locations.push(newLocation);
            state.settings.locations.sort();
            input.value = '';
            
            await saveSettings(state.settings);
            await renderApp();
            openModal();
        }
    }

    if (removeBtn) {
        event.preventDefault();
        const locationToRemove = removeBtn.dataset.location;
        if (confirm(`Möchtest du den Ort "${locationToRemove}" wirklich löschen? Er wird von allen Aufgaben entfernt.`)) {
            state.settings.locations = state.settings.locations.filter(loc => loc !== locationToRemove);

            const tasksToUpdate = [];
            state.tasks.forEach(task => {
                if (task.location === locationToRemove) {
                    task.location = null;
                    tasksToUpdate.push(saveTaskDefinition(task));
                }
            });

            await Promise.all([saveSettings(state.settings), ...tasksToUpdate]);
            await renderApp();
            openModal();
        }
    }
}

async function handleLocationInputChange(event) {
    const input = event.target;
    if (!input.matches('.location-name-input')) return;

    const originalLocation = input.dataset.originalLocation;
    const newLocation = input.value.trim();

    if (newLocation && newLocation !== originalLocation) {
        if (confirm(`Möchtest du den Ort "${originalLocation}" in "${newLocation}" umbenennen? Dies wird für alle Aufgaben übernommen.`)) {
            await renameLocationInStateAndDb(originalLocation, newLocation);
            await renderApp();
            openModal();
        } else {
            input.value = originalLocation;
        }
    }
}
 
function handleTimeslotAction(event) {
    const target = event.target.closest('button'); 
    if (!target) return;

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

async function renameLocationInStateAndDb(oldName, newName) {
    const locationIndex = state.settings.locations.indexOf(oldName);
    if (locationIndex > -1) {
        state.settings.locations[locationIndex] = newName;
    } else {
        state.settings.locations.push(newName);
    }
    state.settings.locations = [...new Set(state.settings.locations)].sort();

    const tasksToUpdate = [];
    state.tasks.forEach(task => {
        if (task.location === oldName) {
            task.location = newName;
            tasksToUpdate.push(saveTaskDefinition(task));
        }
    });

    await Promise.all([saveSettings(state.settings), ...tasksToUpdate]);
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
    document.getElementById('newNotesInput').value = ''; 
    document.getElementById('newLocationSelect').value = '';

    state.newTaskAssignment.length = 0;
    if (state.userProfile) {
        state.newTaskAssignment.push(state.userProfile);
    }
    renderAssignedUsers('create');
    const ctx = getCollaborationContext('create');
    if (ctx && ctx.searchInput) {
        ctx.searchInput.value = '';
        ctx.searchResults.classList.add('hidden');
    }

    document.getElementById('estimated-duration-h').value = '1';
    document.getElementById('estimated-duration-m').value = '0';
    document.getElementById('monthly-financial-benefit').value = '';
    
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-duration-h').value = '1';
    document.getElementById('deadline-duration-m').value = '0';

    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-time').value = '';
    document.getElementById('fixed-duration-h').value = '1';
    document.getElementById('fixed-duration-m').value = '0';
    
    document.getElementById('newTaskInput').focus();
}
