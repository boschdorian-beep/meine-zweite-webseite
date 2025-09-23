// js/ui-render.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { formatHoursMinutes, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
// GEÄNDERT: Importiere angepasste Funktionen
import { getScheduleItemDuration, getDailyAvailableHours, getOriginalTotalDuration } from './scheduler.js';
import { attachTaskInteractions } from './ui-actions.js';

// (Element Caching unverändert)
const elements = {
    todayTasksList: document.getElementById('todayTasksList'),
    tomorrowTasksList: document.getElementById('tomorrowTasksList'),
    futureTasksList: document.getElementById('futureTasksList'),
    completedTasksList: document.getElementById('completedTasksList'),
    noTodayTasks: document.getElementById('noTodayTasks'),
    noTomorrowTasks: document.getElementById('noTomorrowTasks'),
    noFutureTasks: document.getElementById('noFutureTasks'),
    noCompletedTasks: document.getElementById('noCompletedTasks'),
    todayAvailableTime: document.getElementById('todayAvailableTime'),
    tomorrowAvailableTime: document.getElementById('tomorrowAvailableTime'),
    futureAvailableTime: document.getElementById('futureAvailableTime'),
    dailyTimeslotsContainer: document.getElementById('dailyTimeslotsContainer'),
    calcPriorityCheckbox: document.getElementById('calcPriorityCheckbox'),
    toggleDragDrop: document.getElementById('toggleDragDrop'),
};


export function renderApp() {
    // GEÄNDERT: Rendere Schedule und Tasks separat
    renderSchedule();
    renderCompletedTasks();
    updateAvailableTimeDisplays();
    // (Toggle State Update unverändert)
    if (elements.toggleDragDrop) {
        elements.toggleDragDrop.checked = !state.settings.autoPriority;
    }
    // Interaktionen müssen nach dem Rendern angehängt werden
    attachTaskInteractions();
}

/**
 * Rendert den aktiven Zeitplan (state.schedule).
 */
function renderSchedule() {
    // Clear active lists
    [elements.todayTasksList, elements.tomorrowTasksList, elements.futureTasksList].forEach(list => list.innerHTML = '');
    [elements.noTodayTasks, elements.noTomorrowTasks, elements.noFutureTasks].forEach(msg => msg.style.display = 'block');

    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const overmorrow = normalizeDate();
    overmorrow.setDate(overmorrow.getDate() + 2);

    // Wir verwenden state.schedule. Sortierung wird durch den Scheduler bestimmt.
    const activeSchedule = state.schedule;

    const todayItems = [], tomorrowItems = [], futureItems = [], unscheduledItems = [];

    activeSchedule.forEach(item => {
        const itemPlannedDate = parseDateString(item.plannedDate);

        if (!itemPlannedDate) {
            unscheduledItems.push(item);
            return;
        }

        // Wenn das geplante Datum in der Vergangenheit liegt, gehört es zu HEUTE.
        if (itemPlannedDate.getTime() <= today.getTime()) {
            todayItems.push(item);
        } else if (itemPlannedDate.getTime() === tomorrow.getTime()) {
            tomorrowItems.push(item);
        } else if (itemPlannedDate.getTime() >= overmorrow.getTime()) {
            futureItems.push(item);
        }
    });

    const renderList = (items, listElement, noTasksMsg) => {
        if (items.length > 0) {
            noTasksMsg.style.display = 'none';
            // Wir rendern Schedule Items
            items.forEach(item => listElement.appendChild(createScheduleItemElement(item)));
        }
    };

    renderList(todayItems, elements.todayTasksList, elements.noTodayTasks);
    renderList(tomorrowItems, elements.tomorrowTasksList, elements.noTomorrowTasks);

    // Zukünftige Items sind bereits nach Datum sortiert (durch den Scheduler).
    renderList([...futureItems, ...unscheduledItems], elements.futureTasksList, elements.noFutureTasks);
}

/**
 * Rendert die erledigten Aufgaben (aus state.tasks).
 */
function renderCompletedTasks() {
    elements.completedTasksList.innerHTML = '';
    elements.noCompletedTasks.style.display = 'block';

    // Lese aus den Definitionen
    const completedTasks = state.tasks.filter(task => task.completed);

    if (completedTasks.length > 0) {
        elements.noCompletedTasks.style.display = 'none';
        // Sortiert nach Erledigungsdatum, neueste zuerst
        completedTasks.sort((a, b) => {
            const dateA = parseDateString(a.completionDate);
            const dateB = parseDateString(b.completionDate);
            if (dateA && dateB) return dateB.getTime() - dateA.getTime();
            return (b.id > a.id) ? 1 : -1; // Fallback
        });

        completedTasks.forEach(task => {
             elements.completedTasksList.appendChild(createCompletedTaskElement(task));
        });
    }
}


/**
 * Erstellt das DOM Element für ein aktives Schedule Item.
 */
function createScheduleItemElement(item) {
    const itemElement = document.createElement('div');
    let classes = `task-item`;

    const today = normalizeDate();
    const itemPlannedDate = parseDateString(item.plannedDate);

    // Status Klassen
    if (itemPlannedDate && itemPlannedDate.getTime() < today.getTime()) {
        classes += ' overdue';
    }

    // Draggable status & Cursor
    const isDraggable = !state.settings.autoPriority;
    itemElement.draggable = isDraggable;

    if (isDraggable) {
        classes += ' cursor-grab';
    } else {
        classes += ' cursor-default';
    }

    itemElement.className = classes;
    // WICHTIG: Wir speichern die Task ID für Interaktionen (Link zur Definition)
    itemElement.dataset.taskId = item.taskId;
    // Wir speichern auch die Schedule ID für UI-Referenzen (z.B. Drag&Drop Zielbestimmung)
    itemElement.dataset.scheduleId = item.scheduleId;


    const duration = getScheduleItemDuration(item);
    const durationDisplay = duration > 0 ? `<span class="ml-4 text-sm text-gray-500">(${duration.toFixed(2)}h)</span>` : '';

    // Benefit Display (Logik angepasst für Schedule Item)
    let benefitDisplay = '';
    if (item.type === 'Vorteil & Dauer' && item.financialBenefit && parseFloat(item.financialBenefit) > 0) {
        // Nutze die gespeicherte estimatedDuration vom Item
        const originalDuration = parseFloat(item.estimatedDuration) || 0;
        if (originalDuration > 0) {
            const benefitPerHour = (parseFloat(item.financialBenefit) / originalDuration).toFixed(2);
            benefitDisplay = `<span class="ml-2 text-sm text-green-700">(${benefitPerHour}€/h)</span>`;
        } else {
            benefitDisplay = `<span class="ml-2 text-sm text-green-700">(${parseFloat(item.financialBenefit)}€)</span>`;
        }
    }

    // Date Display (Logik unverändert)
    let plannedDateDisplay = '';
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (itemPlannedDate && itemPlannedDate.getTime() > tomorrow.getTime()) {
        plannedDateDisplay = `<span class="ml-2 text-sm text-gray-400">(${formatDateToYYYYMMDD(itemPlannedDate)})</span>`;
    }

    // Manuell geplante Markierung (Pinnadel)
    const manualScheduleFlag = item.isManuallyScheduled && !state.settings.autoPriority ? `<i class="fas fa-thumbtack text-blue-500 ml-2 text-sm" title="Manuell geplant (wird nicht automatisch verschoben)"></i>` : '';


    itemElement.innerHTML = `
        <div class="flex items-center flex-grow">
            <input type="checkbox" data-task-id="${item.taskId}" class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer">
            <span class="task-content text-gray-800 text-lg cursor-pointer hover:text-blue-600 transition duration-150">${item.description}</span>
            ${manualScheduleFlag}
            ${durationDisplay}
            ${benefitDisplay}
            ${item.deadlineDate ? `<span class="ml-2 text-sm text-red-500">Deadline: ${item.deadlineDate}</span>` : ''}
            ${item.fixedDate ? `<span class="ml-2 text-sm text-blue-500">Termin: ${item.fixedDate}</span>` : ''}
            ${plannedDateDisplay}
        </div>
    `;

    return itemElement;
}

/**
 * Erstellt das DOM Element für eine erledigte Aufgabe (Definition).
 */
function createCompletedTaskElement(task) {
    const taskElement = document.createElement('div');
    taskElement.className = 'task-item completed cursor-default';
    taskElement.dataset.taskId = task.id;

    // Zeige die Gesamtdauer an
    const duration = getOriginalTotalDuration(task);
    const durationDisplay = duration > 0 ? `<span class="ml-4 text-sm text-gray-500">(${duration.toFixed(2)}h)</span>` : '';

    taskElement.innerHTML = `
        <div class="flex items-center flex-grow">
            <input type="checkbox" data-task-id="${task.id}" checked class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer">
            <span class="task-content text-gray-800 text-lg cursor-pointer hover:text-blue-600 transition duration-150">${task.description}</span>
            ${durationDisplay}
        </div>
    `;
    return taskElement;
}


function updateAvailableTimeDisplays() {
    // GEÄNDERT: Basiert jetzt auf state.schedule
    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    let consumedToday = 0, consumedTomorrow = 0, consumedFuture = 0;

    // Calculate consumption based on the current schedule (state.schedule)
    state.schedule.forEach(item => {
        const itemDate = parseDateString(item.plannedDate);
        if (!itemDate) return;

        const duration = getScheduleItemDuration(item);

         // Wenn eine Aufgabe für die Vergangenheit geplant ist, zählt ihre Last zu HEUTE.
         if (itemDate.getTime() <= today.getTime()) {
            consumedToday += duration;
            return;
        }

        // Calculate days difference reliably
        const timeDiff = itemDate.getTime() - today.getTime();
        const daysFromToday = Math.round(timeDiff / (1000 * 3600 * 24));

        if (daysFromToday === 1) {
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
    elements.futureAvailableTime.textContent = `Verfügbare Zeit (nächste 7 Tage): ${formatHoursMinutes(availableFuture - consumedFuture)}`;
}

// (renderSettingsModal, renderDailyTimeslots, createTimeslotElement bleiben unverändert)
export function renderSettingsModal(settingsToRender) {
     if (!settingsToRender || !settingsToRender.dailyTimeSlots) return;

    elements.calcPriorityCheckbox.checked = settingsToRender.calcPriority;
    renderDailyTimeslots(settingsToRender);
}

function renderDailyTimeslots(settingsToRender) {
    const container = elements.dailyTimeslotsContainer;
    container.innerHTML = '';

    WEEKDAYS.forEach(dayName => {
        const dayTimeslots = settingsToRender.dailyTimeSlots[dayName] || [];

        const daySection = document.createElement('div');
        daySection.className = 'day-section';
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
