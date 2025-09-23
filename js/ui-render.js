// js/ui-render.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
// GEÄNDERT: Importiere parseDateString
import { formatHoursMinutes, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
import { getTaskDuration, sortTasksByPriority, getDailyAvailableHours } from './scheduler.js';
import { attachTaskInteractions } from './ui-actions.js';

// Cache DOM elements used for rendering
const elements = {
    // Task Lists
    todayTasksList: document.getElementById('todayTasksList'),
    tomorrowTasksList: document.getElementById('tomorrowTasksList'),
    futureTasksList: document.getElementById('futureTasksList'),
    noTodayTasks: document.getElementById('noTodayTasks'),
    noTomorrowTasks: document.getElementById('noTomorrowTasks'),
    noFutureTasks: document.getElementById('noFutureTasks'),
    // Available Time Displays
    todayAvailableTime: document.getElementById('todayAvailableTime'),
    tomorrowAvailableTime: document.getElementById('tomorrowAvailableTime'),
    futureAvailableTime: document.getElementById('futureAvailableTime'),
    // Settings Modal Elements
    dailyTimeslotsContainer: document.getElementById('dailyTimeslotsContainer'),
    calcPriorityCheckbox: document.getElementById('calcPriorityCheckbox'),
    autoPriorityCheckbox: document.getElementById('autoPriorityCheckbox'),
};

/**
 * Main function to render the application UI.
 */
export function renderApp() {
    renderTasks();
    updateAvailableTimeDisplays();
}

function renderTasks() {
    // Clear lists
    [elements.todayTasksList, elements.tomorrowTasksList, elements.futureTasksList].forEach(list => list.innerHTML = '');
    [elements.noTodayTasks, elements.noTomorrowTasks, elements.noFutureTasks].forEach(msg => msg.style.display = 'block');

    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const overmorrow = normalizeDate();
    overmorrow.setDate(overmorrow.getDate() + 2);

    // Create a copy for sorting
    const activeTasks = [...state.tasks.filter(task => !task.completed)];

    // Sort tasks for display if autoPriority is enabled
    if (state.settings.autoPriority) {
        activeTasks.sort(sortTasksByPriority);
    }

    const todayTasks = [], tomorrowTasks = [], futureTasks = [], unscheduledTasks = [];

    activeTasks.forEach(task => {
        // GEÄNDERT: Verwende parseDateString für Robustheit
        const taskPlannedDate = parseDateString(task.plannedDate);

        if (!taskPlannedDate) {
            unscheduledTasks.push(task);
            return;
        }

        if (taskPlannedDate.getTime() === today.getTime()) {
            todayTasks.push(task);
        } else if (taskPlannedDate.getTime() === tomorrow.getTime()) {
            tomorrowTasks.push(task);
        } else if (taskPlannedDate.getTime() >= overmorrow.getTime()) {
            futureTasks.push(task);
        }
    });

    const renderList = (tasks, listElement, noTasksMsg) => {
        if (tasks.length > 0) {
            noTasksMsg.style.display = 'none';
            tasks.forEach(task => listElement.appendChild(createTaskElement(task)));
        }
    };

    renderList(todayTasks, elements.todayTasksList, elements.noTodayTasks);
    renderList(tomorrowTasks, elements.tomorrowTasksList, elements.noTomorrowTasks);

    // Sort future tasks by date, then combine with unscheduled tasks
    futureTasks.sort((a, b) => {
        const dateA = parseDateString(a.plannedDate);
        const dateB = parseDateString(b.plannedDate);
        return (dateA && dateB) ? dateA.getTime() - dateB.getTime() : 0;
    });
    renderList([...futureTasks, ...unscheduledTasks], elements.futureTasksList, elements.noFutureTasks);

    attachTaskInteractions();
}

function createTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = `task-item ${task.completed ? 'completed' : ''}`;
    taskElement.dataset.taskId = task.id;

    // Draggable status
    const isDraggable = !state.settings.autoPriority && !task.completed;
    taskElement.draggable = isDraggable;

    const duration = getTaskDuration(task);
    // Display duration with 2 decimal places for precision
    const durationDisplay = duration > 0 ? `<span class="ml-4 text-sm text-gray-500">(${duration.toFixed(2)}h)</span>` : '';

    // Benefit Display
    let benefitDisplay = '';
    if (task.type === 'Vorteil & Dauer' && task.financialBenefit && parseFloat(task.financialBenefit) > 0) {
        // Calculate based on the original total duration
        const originalDuration = parseFloat(task.estimatedDuration) || 0;
        if (originalDuration > 0) {
            const benefitPerHour = (parseFloat(task.financialBenefit) / originalDuration).toFixed(2);
            benefitDisplay = `<span class="ml-2 text-sm text-green-700">(${benefitPerHour}€/h)</span>`;
        } else {
            benefitDisplay = `<span class="ml-2 text-sm text-green-700">(${parseFloat(task.financialBenefit)}€)</span>`;
        }
    }

    // Date Display (for future tasks)
    let plannedDateDisplay = '';
    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const taskPlannedDate = parseDateString(task.plannedDate);

    // Display date if it's not today or tomorrow
    if (taskPlannedDate && taskPlannedDate.getTime() > tomorrow.getTime()) {
        plannedDateDisplay = `<span class="ml-2 text-sm text-gray-400">(${formatDateToYYYYMMDD(taskPlannedDate)})</span>`;
    }


    taskElement.innerHTML = `
        <div class="flex items-center flex-grow">
            <input type="checkbox" data-id="${task.id}" ${task.completed ? 'checked' : ''} class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer">
            <span class="text-gray-800 text-lg">${task.description}</span>
            ${durationDisplay}
            ${benefitDisplay}
            ${task.deadlineDate ? `<span class="ml-2 text-sm text-red-500">Deadline: ${task.deadlineDate}</span>` : ''}
            ${task.fixedDate ? `<span class="ml-2 text-sm text-blue-500">Termin: ${task.fixedDate}</span>` : ''}
            ${plannedDateDisplay}
        </div>
    `;

    return taskElement;
}

function updateAvailableTimeDisplays() {
    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    let consumedToday = 0, consumedTomorrow = 0, consumedFuture = 0;

    // Calculate consumption based on the current schedule
    state.tasks.filter(t => !t.completed).forEach(task => {
        const taskDate = parseDateString(task.plannedDate);
        if (!taskDate) return;

        const duration = getTaskDuration(task);

        // Calculate days difference reliably
        const timeDiff = taskDate.getTime() - today.getTime();
        // Use Math.round to handle potential daylight savings shifts robustly
        const daysFromToday = Math.round(timeDiff / (1000 * 3600 * 24));

        if (daysFromToday === 0) {
             consumedToday += duration;
        } else if (daysFromToday === 1) {
            consumedTomorrow += duration;
        } else if (daysFromToday >= 2 && daysFromToday < 9) { // Next 7 days starting from overmorrow
            consumedFuture += duration;
        }
    });

    const availableToday = getDailyAvailableHours(today);
    const availableTomorrow = getDailyAvailableHours(tomorrow);

    let availableFuture = 0;
    for (let i = 2; i < 9; i++) {
        const futureDate = normalizeDate();
        futureDate.setDate(today.getDate() + i);
        availableFuture += getDailyAvailableHours(futureDate);
    }

    elements.todayAvailableTime.textContent = `Verfügbare Zeit: ${formatHoursMinutes(availableToday - consumedToday)}`;
    elements.tomorrowAvailableTime.textContent = `Verfügbare Zeit: ${formatHoursMinutes(availableTomorrow - consumedTomorrow)}`;
    // Clarify the future time span
    elements.futureAvailableTime.textContent = `Verfügbare Zeit (nächste 7 Tage): ${formatHoursMinutes(availableFuture - consumedFuture)}`;
}

/**
 * Renders the settings modal content.
 * GEÄNDERT: Nimmt settingsToRender als Argument, um temporären Zustand anzuzeigen.
 * @param {object} settingsToRender - The settings object to use (temporary modal state).
 */
export function renderSettingsModal(settingsToRender) {
     // Ensure settingsToRender is valid
     if (!settingsToRender || !settingsToRender.dailyTimeSlots) return;

    elements.calcPriorityCheckbox.checked = settingsToRender.calcPriority;
    elements.autoPriorityCheckbox.checked = settingsToRender.autoPriority;
    renderDailyTimeslots(settingsToRender);
}

function renderDailyTimeslots(settingsToRender) {
    const container = elements.dailyTimeslotsContainer;
    container.innerHTML = '';

    WEEKDAYS.forEach(dayName => {
        const dayTimeslots = settingsToRender.dailyTimeSlots[dayName] || [];

        const daySection = document.createElement('div');
        daySection.className = 'day-section';
        // Buttons use data-attributes for event delegation in ui-actions.js
        daySection.innerHTML = `
            <h4 class="text-md font-semibold text-gray-700 mb-2">${dayName}</h4>
            <div id="timeslots-${dayName}" class="space-y-2"></div>
            <div class="flex flex-wrap gap-2 mt-3">
                <button type="button" data-day="${dayName}" class="add-timeslot-btn bg-blue-500 hover:bg-blue-600 text-white text-sm py-1 px-3 rounded-lg">
                    + Zeitfenster
                </button>
                ${dayTimeslots.length > 0 ? `
                    <button type="button" data-day="${dayName}" class="remove-day-btn bg-red-500 hover:bg-red-600 text-white text-sm py-1 px-3 rounded-lg">
                        Tag löschen
                    </button>` : `
                    <button type="button" data-day="${dayName}" class="restore-day-btn bg-green-500 hover:bg-green-600 text-white text-sm py-1 px-3 rounded-lg">
                        Wiederherstellen
                    </button>`
                }
            </div>
        `;
        container.appendChild(daySection);

        const slotsContainer = document.getElementById(`timeslots-${dayName}`);
        dayTimeslots.forEach(slot => {
            slotsContainer.appendChild(createTimeslotElement(dayName, slot.id, slot.start, slot.end));
        });
    });
}

function createTimeslotElement(dayName, slotId, startTime, endTime) {
    const timeslotDiv = document.createElement('div');
    // Wichtig: Klasse timeslot-row hinzugefügt für ui-actions.js
    timeslotDiv.className = 'flex items-center space-x-2 timeslot-row';
    timeslotDiv.dataset.timeslotId = slotId;

    timeslotDiv.innerHTML = `
        <input type="time" class="timeslot-start-input p-2 border border-gray-300 rounded-lg w-1/2" value="${startTime}">
        <span class="text-gray-600">-</span>
        <input type="time" class="timeslot-end-input p-2 border border-gray-300 rounded-lg w-1/2" value="${endTime}">
        <button type="button" data-day="${dayName}" data-timeslot-id="${slotId}" class="remove-timeslot-btn">
            &times;
        </button>
    `;
    return timeslotDiv;
}
