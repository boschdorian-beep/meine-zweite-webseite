// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
// GEÄNDERT: Funktionen sind jetzt async
import { toggleTaskCompleted, handleTaskDrop, updateTaskDetails, getOriginalTotalDuration } from './scheduler.js';
import { renderApp, renderSettingsModal } from './ui-render.js';
import { parseDateString } from './utils.js';

// Temporärer Zustand für das Einstellungs-Modal.
let modalState = {
    tempSettings: {}
};

// --- Task Interactions ---

export function attachTaskInteractions() {
    // (Logik identisch zur vorherigen Version)
    // Checkbox handling
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.addEventListener('change', handleCheckboxChange);
    });

    // Drag and Drop handling für Task Items (Start/End)
    document.querySelectorAll('.task-item').forEach(taskElement => {
        taskElement.removeEventListener('dragstart', handleDragStart);
        taskElement.removeEventListener('dragend', handleDragEnd);

        if (taskElement.draggable) {
            taskElement.addEventListener('dragstart', handleDragStart);
            taskElement.addEventListener('dragend', handleDragEnd);
        }
    });

    // Drag and Drop handling für Drop Zones (Listen)
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.removeEventListener('dragover', handleDragOver);
        zone.removeEventListener('dragleave', handleDragLeaveZone);
        zone.removeEventListener('drop', handleDrop);

        // Nur aktivieren, wenn D&D erlaubt ist
        if (!state.settings.autoPriority) {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('dragleave', handleDragLeaveZone);
            zone.addEventListener('drop', handleDrop);
        }
    });

    // Klick auf Task Content zum Bearbeiten
    document.querySelectorAll('.task-content').forEach(content => {
        content.removeEventListener('click', handleTaskContentClick);
        content.addEventListener('click', handleTaskContentClick);
    });
}

// GEÄNDERT: Ist jetzt async
async function handleCheckboxChange(event) {
    const taskId = event.target.dataset.id;
    // toggleTaskCompleted ist jetzt async
    await toggleTaskCompleted(taskId, event.target.checked);
    renderApp();
}

// --- Drag and Drop Handlers ---

// (handleDragStart, handleDragOver, handleDragLeaveZone - Unverändert)
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


// GEÄNDERT: Ist jetzt async
async function handleDrop(e) {
    e.preventDefault();
    if (!state.draggedItem) return;

    const zone = e.currentTarget;
    const dropTargetItem = e.target.closest('.task-item');
    const draggedId = state.draggedItem.dataset.taskId;

    let dropTargetId = null;
    let insertBefore = false;

    // 1. Bestimme Zielposition
    if (dropTargetItem && dropTargetItem !== state.draggedItem) {
        dropTargetId = dropTargetItem.dataset.taskId;
        const rect = dropTargetItem.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        insertBefore = offsetY < rect.height / 2;
    }

    // 2. Bestimme Zieldatum (Logik unverändert)
    let newDate = null;
    const section = zone.closest('[data-date-offset]');
    if (section) {
        const offset = parseInt(section.dataset.dateOffset, 10);
        if (offset < 2) {
            newDate = new Date();
            newDate.setDate(newDate.getDate() + offset);
        }
        if (offset === 2) {
            if (dropTargetItem) {
                 const targetTask = state.tasks.find(t => t.id === dropTargetId);
                 if (targetTask && targetTask.plannedDate) {
                    newDate = parseDateString(targetTask.plannedDate);
                 }
            }
            if (!newDate) {
                newDate = new Date();
                newDate.setDate(newDate.getDate() + 2);
            }
        }
    }

    // Logik im Scheduler ausführen (async)
    const success = await handleTaskDrop(draggedId, dropTargetId, insertBefore, newDate);

    // Nur rendern, wenn die Aktion erfolgreich war (z.B. nicht abgebrochen wurde)
    if (success) {
        renderApp();
    }
    handleDragEnd(); // Clean up
}

function handleDragEnd() {
    // (Unverändert)
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


// --- Edit Modal Actions ---

function handleTaskContentClick(event) {
    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

export function openEditModal(taskId) {
    // (Logik unverändert zur vorherigen Version)
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const originalId = task.originalId || task.id;
    const representativeTask = state.tasks.find(t => (t.originalId || t.id) === originalId);
    if (!representativeTask) return;

    // Wir verwenden die ID des Tasks selbst (die Firestore ID)
    document.getElementById('edit-task-id').value = representativeTask.id; 
    document.getElementById('edit-task-type').value = representativeTask.type;

    let cleanDescription = representativeTask.description.replace(/ \(Teil \d+\)$/, '');
    cleanDescription = cleanDescription.replace(/ \(Nicht planbar - Keine Kapazität\)$/, '');
    document.getElementById('edit-description').value = cleanDescription;

    document.querySelectorAll('.edit-inputs').forEach(el => el.classList.add('hidden'));

    if (representativeTask.type === 'Vorteil & Dauer') {
        document.getElementById('editVorteilDauerInputs').classList.remove('hidden');
        document.getElementById('edit-estimated-duration').value = getOriginalTotalDuration(representativeTask);
        document.getElementById('edit-financial-benefit').value = representativeTask.financialBenefit || '';
    } else if (representativeTask.type === 'Deadline') {
        document.getElementById('editDeadlineInputs').classList.remove('hidden');
        document.getElementById('edit-deadline-date').value = representativeTask.deadlineDate || '';
        document.getElementById('edit-deadline-duration').value = getOriginalTotalDuration(representativeTask);
    } else if (representativeTask.type === 'Fixer Termin') {
        document.getElementById('editFixerTerminInputs').classList.remove('hidden');
        document.getElementById('edit-fixed-date').value = representativeTask.fixedDate || '';
        document.getElementById('edit-fixed-duration').value = getOriginalTotalDuration(representativeTask);
    }

     // HINWEIS: Hier wird später die Zuweisung gerendert (Phase 2)

    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closeEditModal() {
    // (Unverändert)
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// GEÄNDERT: Ist jetzt async
export async function handleSaveEditedTask() {
    // Wir verwenden die ID des Tasks, die wir im Modal gespeichert haben
    const taskId = document.getElementById('edit-task-id').value;
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    const updatedDetails = {
        description: description
    };

    // HINWEIS: Hier wird später die Zuweisung gelesen (Phase 2)

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

// GEÄNDERT: Ist jetzt async
export async function handleDeleteTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    let taskName = task ? task.description.replace(/ \(Teil \d+\)$/, '') : "diese Aufgabe";

    if (confirm(`Möchtest du "${taskName}" (und alle ihre Teile) wirklich löschen?`)) {
        // Finde die Original-ID, um alle Teile zu löschen
        const originalId = task ? (task.originalId || task.id) : null;

        if (originalId) {
             // Entferne alle Instanzen dieser Aufgabe aus dem lokalen State
            state.tasks = state.tasks.filter(t => (t.originalId || t.id) !== originalId);
        }
       
        // Muss neu geplant werden (async). Wir übergeben null.
        await updateTaskDetails(null, {});
        closeEditModal();
        renderApp();
    }
}


// --- Settings Modal Actions & Andere UI Funktionen (Unverändert zur vorherigen Version) ---
// (openModal, closeModal, updateAndGetSettingsFromModal, attachModalEventListeners, handleTimeslotAction, setActiveTaskType, clearInputs)

export function openModal() {
    // (Unverändert)
    modalState.tempSettings = JSON.parse(JSON.stringify(state.settings));

    renderSettingsModal(modalState.tempSettings);
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    attachModalEventListeners();
}

export function closeModal() {
    // (Unverändert)
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalState.tempSettings = {};
}

export function updateAndGetSettingsFromModal() {
    // (Unverändert)
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
    // (Unverändert)
    const container = document.getElementById('dailyTimeslotsContainer');
    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);
}

function handleTimeslotAction(event) {
    // (Unverändert)
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
    // (Unverändert)
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
    // (Unverändert)
    document.getElementById('newTaskInput').value = '';
    document.getElementById('estimated-duration').value = '1';
    document.getElementById('monthly-financial-benefit').value = '';
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-duration').value = '1';
    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-duration').value = '1';
    document.getElementById('newTaskInput').focus();
}