// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, updateTaskOrder } from './scheduler.js';
import { renderApp, renderSettingsModal } from './ui-render.js';

// NEU: Temporärer Zustand für das Modal. Änderungen werden erst bei "Speichern" global wirksam.
let modalState = {
    tempSettings: {}
};

// --- Task Interactions (Checkbox, Drag & Drop) ---

export function attachTaskInteractions() {
    // Checkbox handling
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        // Wichtig: Entferne vorherige Listener, um Duplikate nach dem Rendern zu vermeiden
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.addEventListener('change', handleCheckboxChange);
    });

    // Drag and Drop handling
    document.querySelectorAll('.task-item').forEach(taskElement => {
        // Wichtig: Entferne vorherige Listener
        taskElement.removeEventListener('dragstart', handleDragStart);
        taskElement.removeEventListener('dragover', handleDragOver);
        taskElement.removeEventListener('dragleave', handleDragLeave);
        taskElement.removeEventListener('drop', handleDrop);
        taskElement.removeEventListener('dragend', handleDragEnd);

        if (taskElement.draggable) {
            taskElement.addEventListener('dragstart', handleDragStart);
            taskElement.addEventListener('dragover', handleDragOver);
            taskElement.addEventListener('dragleave', handleDragLeave);
            taskElement.addEventListener('drop', handleDrop);
            taskElement.addEventListener('dragend', handleDragEnd);
        }
    });
}

function handleCheckboxChange(event) {
    const taskId = event.target.dataset.id;
    toggleTaskCompleted(taskId, event.target.checked);
    renderApp(); // Re-render after state change (which includes recalculation)
}

// --- Drag and Drop Handlers (Unverändert) ---

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
    // Erstelle eine tiefe Kopie der aktuellen Einstellungen für die Modal-Sitzung
    modalState.tempSettings = JSON.parse(JSON.stringify(state.settings));

    renderSettingsModal(modalState.tempSettings); // Rendere Modal basierend auf der Kopie
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    attachModalEventListeners();
}

export function closeModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Temporären Zustand löschen
    modalState.tempSettings = {};
}

/**
 * Liest die Einstellungen aus den Modal-Eingaben und aktualisiert den modalState.
 * Wird von main.js beim Speichern aufgerufen.
 */
export function updateAndGetSettingsFromModal() {
    // Aktualisiere temporäre Einstellungen basierend auf Checkboxen
    modalState.tempSettings.calcPriority = document.getElementById('calcPriorityCheckbox').checked;
    modalState.tempSettings.autoPriority = document.getElementById('autoPriorityCheckbox').checked;

    // Aktualisiere Zeitfenster basierend auf Eingabefeldern (Wichtig, falls Benutzer Zeit manuell bearbeitet)
    WEEKDAYS.forEach(dayName => {
        const dayTimeslotsElements = document.getElementById(`timeslots-${dayName}`);
        if (dayTimeslotsElements) {
            const currentDaySlots = [];
            // Wählt die Zeilen aus (Klasse .timeslot-row wird in ui-render.js hinzugefügt)
            dayTimeslotsElements.querySelectorAll('.timeslot-row').forEach(slotDiv => {
                const startInput = slotDiv.querySelector('.timeslot-start-input');
                const endInput = slotDiv.querySelector('.timeslot-end-input');
                const slotId = slotDiv.dataset.timeslotId;
                // Nur speichern, wenn Werte vorhanden sind
                if (startInput && endInput && startInput.value && endInput.value) {
                    currentDaySlots.push({
                        id: slotId,
                        start: startInput.value,
                        end: endInput.value
                    });
                }
            });
            // Ensure the structure exists before assignment
            if (modalState.tempSettings.dailyTimeSlots) {
                modalState.tempSettings.dailyTimeSlots[dayName] = currentDaySlots;
            }
        }
    });

    return modalState.tempSettings;
}

/**
 * Attaches listeners for interactions within the modal (Event Delegation).
 */
function attachModalEventListeners() {
    const container = document.getElementById('dailyTimeslotsContainer');
    // Remove existing listener to prevent duplicates
    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);
}

// Handles dynamic interactions in the modal (Add/Remove slots)
// Arbeitet nur noch auf modalState.tempSettings
function handleTimeslotAction(event) {
    const target = event.target;
    const day = target.dataset.day;

    if (!day) return;

    // Zuerst sicherstellen, dass modalState aktuell ist (bezüglich manueller Zeiteingaben)
    updateAndGetSettingsFromModal();

    // Ensure the structure exists before modification
    if (!modalState.tempSettings.dailyTimeSlots[day]) {
        modalState.tempSettings.dailyTimeSlots[day] = [];
    }

    // Jetzt die Aktion auf modalState.tempSettings ausführen
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

    // Re-render modal UI mit dem temporären Zustand
    renderSettingsModal(modalState.tempSettings);
}


// --- Task Type Selection (Unverändert) ---

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

// --- Input Management (Unverändert) ---
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
