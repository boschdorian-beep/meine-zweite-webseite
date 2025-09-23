// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
// Importiere handleTaskDrop statt updateTaskOrder
import { toggleTaskCompleted, handleTaskDrop, updateTaskDetails, getOriginalTotalDuration } from './scheduler.js';
import { renderApp, renderSettingsModal } from './ui-render.js';
import { parseDateString } from './utils.js';

// Temporärer Zustand für das Einstellungs-Modal.
let modalState = {
    tempSettings: {}
};

// --- Task Interactions (Checkbox, Drag & Drop, Edit) ---

export function attachTaskInteractions() {
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

    // NEU: Drag and Drop handling für Drop Zones (Listen)
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.removeEventListener('dragover', handleDragOver);
        zone.removeEventListener('dragleave', handleDragLeaveZone);
        zone.removeEventListener('drop', handleDrop);

        // Nur aktivieren, wenn D&D erlaubt ist (Manuell Sortieren AN / Auto-Prio AUS)
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

function handleCheckboxChange(event) {
    const taskId = event.target.dataset.id;
    toggleTaskCompleted(taskId, event.target.checked);
    renderApp();
}

// --- Drag and Drop Handlers (Stark überarbeitet für Zonen-Support) ---

function handleDragStart(e) {
    state.draggedItem = e.target;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggedItem.dataset.taskId);
    setTimeout(() => {
        state.draggedItem.classList.add('dragging');
    }, 0);
}

// Wird für Zonen UND Items verwendet
function handleDragOver(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.add('drag-over-zone'); // Visuelles Feedback für die Zone

    const targetItem = e.target.closest('.task-item');

    // Visual feedback auf dem Ziel-Item entfernen, wenn nicht mehr drüber
    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    // Feedback hinzufügen, wenn über einem gültigen Ziel
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
    // Verhindert Flackern beim Überfahren von Kind-Elementen
    if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over-zone');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    const dropTargetItem = e.target.closest('.task-item');
    const draggedId = state.draggedItem.dataset.taskId;

    let dropTargetId = null;
    let insertBefore = false;

    // 1. Bestimme Zielposition (wenn auf Item gefallen)
    if (dropTargetItem && dropTargetItem !== state.draggedItem) {
        dropTargetId = dropTargetItem.dataset.taskId;
        const rect = dropTargetItem.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        insertBefore = offsetY < rect.height / 2;
    }

    // 2. Bestimme Zieldatum basierend auf der Zone
    let newDate = null;
    // Finde die Sektion (Heute/Morgen/Zukunft), die die Zone enthält
    const section = zone.closest('[data-date-offset]');
    if (section) {
        const offset = parseInt(section.dataset.dateOffset, 10);
        if (offset < 2) { // Heute (0) oder Morgen (1)
            newDate = new Date();
            newDate.setDate(newDate.getDate() + offset);
        }
        // Bei "Zukunft" (2)
        if (offset === 2) {
            if (dropTargetItem) {
                 // Wenn auf ein Item in der Zukunft gefallen wird, nehmen wir dessen Datum.
                 const targetTask = state.tasks.find(t => t.id === dropTargetId);
                 if (targetTask && targetTask.plannedDate) {
                    newDate = parseDateString(targetTask.plannedDate);
                 }
            }

            // Wenn kein Zieldatum bestimmt werden konnte (z.B. leere Zukunftszone), setze auf Übermorgen
            if (!newDate) {
                newDate = new Date();
                newDate.setDate(newDate.getDate() + 2);
            }
        }
    }

    // Logik im Scheduler ausführen (kümmert sich um Datumsänderung, Bestätigungen UND Reordering)
    handleTaskDrop(draggedId, dropTargetId, insertBefore, newDate);

    renderApp(); // Re-render, da sich Zustand/Reihenfolge geändert hat
    handleDragEnd(); // Clean up
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


// --- NEU: Edit Modal Actions ---

function handleTaskContentClick(event) {
    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

export function openEditModal(taskId) {
    // Finde die Aufgabe.
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const originalId = task.originalId || task.id;
    // Finde eine repräsentative Instanz der Aufgabe, die alle Originaldaten enthält
    const representativeTask = state.tasks.find(t => (t.originalId || t.id) === originalId);
    if (!representativeTask) return;

    // Befülle das Modal
    document.getElementById('edit-task-id').value = originalId; // Wir speichern die originalId
    document.getElementById('edit-task-type').value = representativeTask.type;

    // Beschreibung bereinigen (Teil X entfernen)
    let cleanDescription = representativeTask.description.replace(/ \(Teil \d+\)$/, '');
    cleanDescription = cleanDescription.replace(/ \(Nicht planbar - Keine Kapazität\)$/, '');
    document.getElementById('edit-description').value = cleanDescription;

    // Verstecke alle Input-Gruppen
    document.querySelectorAll('.edit-inputs').forEach(el => el.classList.add('hidden'));

    // Zeige relevante Inputs und befülle sie (Nutze getOriginalTotalDuration)
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

    // Zeige das Modal
    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

export function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

export function handleSaveEditedTask() {
    const originalId = document.getElementById('edit-task-id').value;
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    const updatedDetails = {
        description: description
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

        // Rufe die Scheduler-Logik auf, um die Details zu aktualisieren und neu zu planen
        updateTaskDetails(originalId, updatedDetails);

        closeEditModal();
        renderApp();

    } catch (error) {
        alert(error.message);
    }
}

export function handleDeleteTask() {
    const originalId = document.getElementById('edit-task-id').value;
    // Finde die Aufgabe, um den Namen anzuzeigen
    const task = state.tasks.find(t => (t.originalId || t.id) === originalId);
    let taskName = task ? task.description.replace(/ \(Teil \d+\)$/, '') : "diese Aufgabe";

    if (confirm(`Möchtest du "${taskName}" (und alle ihre Teile) wirklich löschen?`)) {
        // Entferne alle Instanzen dieser Aufgabe
        state.tasks = state.tasks.filter(t => (t.originalId || t.id) !== originalId);
        // Muss neu geplant werden, da Kapazität frei wird
        // Wir übergeben null, damit updateTaskDetails weiß, dass es nur neu berechnen soll.
        updateTaskDetails(null, {});
        closeEditModal();
        renderApp();
    }
}


// --- Settings Modal Actions (Identisch zur vorherigen Version) ---

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
 */
export function updateAndGetSettingsFromModal() {
    // Aktualisiere temporäre Einstellungen basierend auf Checkboxen
    modalState.tempSettings.calcPriority = document.getElementById('calcPriorityCheckbox').checked;
    // autoPriority wird hier nicht gelesen, da es auf der Hauptseite ist.

    // Aktualisiere Zeitfenster basierend auf Eingabefeldern
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

// Handles dynamic interactions in the modal
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


// --- Task Type Selection & Input Management (Identisch) ---

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
