// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, updateTaskOrder } from './scheduler.js';
import { renderApp, renderSettingsModal } from './ui-render.js';

// --- Task Interactions (Checkbox, Drag & Drop) ---

export function attachTaskInteractions() {
    // Checkbox handling
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        // Use arrow function to maintain 'this' context if needed, though not strictly necessary here
        checkbox.addEventListener('change', (event) => {
            const taskId = event.target.dataset.id;
            toggleTaskCompleted(taskId, event.target.checked);
            renderApp(); // Re-render after state change (which includes recalculation)
        });
    });

    // Drag and Drop handling
    document.querySelectorAll('.task-item').forEach(taskElement => {
        if (taskElement.draggable) {
            taskElement.addEventListener('dragstart', handleDragStart);
            taskElement.addEventListener('dragover', handleDragOver);
            taskElement.addEventListener('dragleave', handleDragLeave);
            taskElement.addEventListener('drop', handleDrop);
            taskElement.addEventListener('dragend', handleDragEnd);
        }
    });
}

// --- Drag and Drop Handlers ---

function handleDragStart(e) {
    state.draggedItem = e.target;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggedItem.dataset.taskId);
    setTimeout(() => {
        state.draggedItem.classList.add('dragging');
    }, 0);
}

function handleDragOver(e) {
    e.preventDefault(); // Necessary to allow dropping
    const target = e.target.closest('.task-item');
    if (target && target !== state.draggedItem && !target.classList.contains('completed')) {
        const rect = target.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        if (offsetY < rect.height / 2) {
            // Above the target
            target.classList.remove('drag-over-bottom');
            target.classList.add('drag-over-top');
        } else {
            // Below the target
            target.classList.remove('drag-over-top');
            target.classList.add('drag-over-bottom');
        }
    }
}

function handleDragLeave(e) {
    const target = e.target.closest('.task-item');
    if (target) {
        target.classList.remove('drag-over-top', 'drag-over-bottom');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const dropTarget = e.target.closest('.task-item');
    if (state.draggedItem && dropTarget && state.draggedItem !== dropTarget) {
        const draggedId = state.draggedItem.dataset.taskId;
        const dropId = dropTarget.dataset.taskId;

        const rect = dropTarget.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        const insertBefore = offsetY < rect.height / 2;

        // Update order in state and trigger recalculation
        updateTaskOrder(draggedId, dropId, insertBefore);
        renderApp();
    }
    handleDragEnd(); // Clean up
}

function handleDragEnd() {
    if (state.draggedItem) {
        state.draggedItem.classList.remove('dragging');
    }
    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    state.draggedItem = null;
}


// --- Settings Modal Actions ---

export function openModal() {
    renderSettingsModal(); // Render content based on current state
    document.getElementById('settingsModal').style.display = 'flex';
    attachModalEventListeners();
}

export function closeModal() {
    document.getElementById('settingsModal').style.display = 'none';
}

/**
 * Reads the settings from the modal inputs.
 */
export function getSettingsFromModal() {
    const newSettings = {
        calcPriority: document.getElementById('calcPriorityCheckbox').checked,
        autoPriority: document.getElementById('autoPriorityCheckbox').checked,
        dailyTimeSlots: {}
    };

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
            newSettings.dailyTimeSlots[dayName] = currentDaySlots;
        }
    });
    return newSettings;
}

/**
 * Attaches listeners for interactions within the modal (Event Delegation).
 */
function attachModalEventListeners() {
    const container = document.getElementById('dailyTimeslotsContainer');
    // Remove existing listener to prevent duplicates if modal is opened multiple times
    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);
}

// Handles dynamic interactions in the modal (Add/Remove slots)
function handleTimeslotAction(event) {
    const target = event.target;
    const day = target.dataset.day;

    if (!day) return;

    // To provide immediate UI feedback in the modal before "Save" is clicked,
    // we update the state temporarily based on the current DOM inputs.
    const tempSettings = getSettingsFromModal();
    state.settings = tempSettings; // Update state temporarily

    if (target.classList.contains('remove-timeslot-btn')) {
        const slotIdToRemove = target.dataset.timeslotId;
        state.settings.dailyTimeSlots[day] = state.settings.dailyTimeSlots[day].filter(slot => slot.id !== slotIdToRemove);
    } else if (target.classList.contains('add-timeslot-btn')) {
        if (!state.settings.dailyTimeSlots[day]) state.settings.dailyTimeSlots[day] = [];
        state.settings.dailyTimeSlots[day].push({
            id: 'ts-' + Date.now(),
            start: "09:00",
            end: "17:00"
        });
    } else if (target.classList.contains('remove-day-btn')) {
        state.settings.dailyTimeSlots[day] = [];
    } else if (target.classList.contains('restore-day-btn')) {
        state.settings.dailyTimeSlots[day] = [{ id: `ts-${Date.now()}`, start: "09:00", end: "17:00" }];
    }

    renderSettingsModal(); // Re-render modal UI
}


// --- Task Type Selection ---

export function setActiveTaskType(button) {
    document.querySelectorAll('.task-type-btn').forEach(btn => {
        btn.classList.remove('bg-green-500', 'text-white');
        btn.classList.add('text-gray-700', 'hover:bg-gray-300');
    });
    button.classList.add('bg-green-500', 'text-white');
    button.classList.remove('text-gray-700', 'hover:bg-gray-300');

    state.activeTaskType = button.dataset.type;

    // Show/hide inputs
    document.querySelectorAll('.task-inputs').forEach(input => input.classList.add('hidden'));
    if (state.activeTaskType === 'Vorteil & Dauer') {
        document.getElementById('vorteilDauerInputs').classList.remove('hidden');
    } else if (state.activeTaskType === 'Deadline') {
        document.getElementById('deadlineInputs').classList.remove('hidden');
    } else if (state.activeTaskType === 'Fixer Termin') {
        document.getElementById('fixerTerminInputs').classList.remove('hidden');
    }
}

// --- Input Management ---
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