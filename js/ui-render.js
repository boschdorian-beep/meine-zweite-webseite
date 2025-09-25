// js/ui-render.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
// GEÄNDERT: Importiere formatDateLocalized
import { formatHoursMinutes, formatDateToYYYYMMDD, normalizeDate, parseDateString, generateColorFromString, formatDateLocalized } from './utils.js';
import { getScheduleItemDuration, getDailyAvailableHours, getOriginalTotalDuration } from './scheduler.js';
import { attachTaskInteractions } from './ui-actions.js';
import { getShortNamesForUids, getAllUserProfilesInTasks } from './collaboration.js';

// Element Caching
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
    // NEU: Datumsanzeige
    todayDateDisplay: document.getElementById('todayDateDisplay'),
    tomorrowDateDisplay: document.getElementById('tomorrowDateDisplay'),
    tomorrowAvailableTime: document.getElementById('tomorrowAvailableTime'),
    futureAvailableTime: document.getElementById('futureAvailableTime'),
    dailyTimeslotsContainer: document.getElementById('dailyTimeslotsContainer'),
    calcPriorityCheckbox: document.getElementById('calcPriorityCheckbox'),
    toggleDragDrop: document.getElementById('toggleDragDrop'),
    // Container für Ortsverwaltung
    locationsListContainer: document.getElementById('locations-list'),
};

// Elemente für die Filterleiste
const filterElements = {
    filterBar: document.getElementById('filter-bar'),
    locationFilters: document.getElementById('location-filters'),
    userFilters: document.getElementById('user-filters'),
    clearFiltersBtn: document.getElementById('clear-filters-btn'),
    filterActiveMessage: document.getElementById('filter-active-message'),
};

export async function renderApp() {
    await renderSchedule();
    await renderCompletedTasks();
    await renderFilterBar();
    populateLocationDropdowns();
    updateAvailableTimeDisplays();
    updateDateDisplays(); // NEU: Aktualisiere die Datumsanzeigen
    if (elements.toggleDragDrop) {
        elements.toggleDragDrop.checked = !state.settings.autoPriority;
    }
    attachTaskInteractions();
}

/**
 * NEU: Aktualisiert die Datumsanzeigen neben "Heute" und "Morgen".
 */
function updateDateDisplays() {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    if (elements.todayDateDisplay) {
        elements.todayDateDisplay.textContent = formatDateLocalized(today);
    }
    if (elements.tomorrowDateDisplay) {
        elements.tomorrowDateDisplay.textContent = formatDateLocalized(tomorrow);
    }
}

/**
 * Befüllt die Location-Dropdowns mit den Orten aus den Einstellungen.
 */
function populateLocationDropdowns(selectedLocation = null) {
    const locations = state.settings.locations || [];
    const newLocationSelect = document.getElementById('newLocationSelect');
    const editLocationSelect = document.getElementById('edit-location-select');

    [newLocationSelect, editLocationSelect].forEach(select => {
        if (!select) return;
        const currentValue = selectedLocation || select.value;
        select.innerHTML = '<option value="">Kein Ort</option>'; // Standardoption
        locations.forEach(location => {
            const option = document.createElement('option');
            option.value = location;
            option.textContent = location;
            select.appendChild(option);
        });
        select.value = currentValue;
    });
}

/**
 * Rendert die Filterleiste basierend auf den aktuellen Aufgaben.
 */
async function renderFilterBar() {
    const activeTasks = state.tasks.filter(t => !t.completed);
    const allLocations = state.settings.locations || [];
    const allUsers = await getAllUserProfilesInTasks();

    if (allLocations.length === 0 && allUsers.length === 0) {
        filterElements.filterBar.classList.add('hidden');
        return;
    }
    filterElements.filterBar.classList.remove('hidden');

    // 3. Filter-Buttons für Orte erstellen (GEÄNDERT: Checkboxes statt Radio)
    filterElements.locationFilters.innerHTML = '';
    if (allLocations.length > 0) {
        allLocations.forEach(location => {
            // GEÄNDERT: Prüfe ob Location im Array ist
            const isChecked = state.filters.prioritizedLocations.includes(location);
            const toggleHtml = `
                <label class="filter-checkbox-label">
                    <input type="checkbox" name="location-filter" value="${location}" class="location-filter-checkbox" ${isChecked ? 'checked' : ''}>
                    <span class="filter-toggle">${location}</span>
                </label>
            `;
            filterElements.locationFilters.innerHTML += toggleHtml;
        });
    } else {
        filterElements.locationFilters.innerHTML = `<p class="text-sm text-gray-500">Keine Orte in Aufgaben definiert.</p>`;
    }

    // 4. Filter-Buttons für Benutzer erstellen
    filterElements.userFilters.innerHTML = '';
    if (allUsers.length > 0) {
        allUsers.forEach(user => {
            const isChecked = state.filters.prioritizedUserIds.includes(user.uid);
            const toggleHtml = `
                <label class="filter-checkbox-label">
                    <input type="checkbox" value="${user.uid}" class="user-filter-checkbox" ${isChecked ? 'checked' : ''}>
                    <span class="filter-toggle">${user.displayName} (${user.shortName})</span>
                </label>
            `;
            filterElements.userFilters.innerHTML += toggleHtml;
        });
    } else {
        filterElements.userFilters.innerHTML = `<p class="text-sm text-gray-500">Keine Team-Aufgaben vorhanden.</p>`;
    }

    // 5. Zustand des "Löschen"-Buttons und der Nachricht aktualisieren
    // GEÄNDERT: Prüfe prioritizedLocations
    const isFilterActive = state.filters.prioritizedLocations.length > 0 || state.filters.prioritizedUserIds.length > 0;
    filterElements.clearFiltersBtn.disabled = !isFilterActive;
    if (isFilterActive) {
        filterElements.filterActiveMessage.classList.remove('hidden');
    } else {
        filterElements.filterActiveMessage.classList.add('hidden');
    }
}

/**
 * Prüft, ob ein Schedule-Item den aktiven Filtern entspricht.
 */
function isItemPrioritized(item) {
    // GEÄNDERT: Prüfe prioritizedLocations (Array)
    const { prioritizedLocations, prioritizedUserIds } = state.filters;
    const matchesLocation = prioritizedLocations.length > 0 && prioritizedLocations.includes(item.location);
    
    // Für die Benutzerprüfung müssen alle ausgewählten User UND der aktuelle Benutzer dabei sein (siehe scheduler.js)
    const currentUserId = state.user ? state.user.uid : null;
    
    if (!currentUserId) return matchesLocation;

    const requiredUsers = [...prioritizedUserIds, currentUserId];
    const matchesUsers = prioritizedUserIds.length > 0 && requiredUsers.every(uid => (item.assignedTo || []).includes(uid));
    
    return matchesLocation || matchesUsers;
}

async function renderSchedule() {
    [elements.todayTasksList, elements.tomorrowTasksList, elements.futureTasksList].forEach(list => list.innerHTML = '');
    [elements.noTodayTasks, elements.noTomorrowTasks, elements.noFutureTasks].forEach(msg => msg.style.display = 'block');

    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const overmorrow = normalizeDate();
    overmorrow.setDate(overmorrow.getDate() + 2);

    const activeSchedule = state.schedule;
    const todayItems = [], tomorrowItems = [], futureItems = [], unscheduledItems = [];

    activeSchedule.forEach(item => {
        const itemPlannedDate = parseDateString(item.plannedDate);

        if (!itemPlannedDate) {
            unscheduledItems.push(item);
            return;
        }

        if (itemPlannedDate.getTime() <= today.getTime()) {
            todayItems.push(item);
        } else if (itemPlannedDate.getTime() === tomorrow.getTime()) {
            tomorrowItems.push(item);
        } else if (itemPlannedDate.getTime() >= overmorrow.getTime()) {
            futureItems.push(item);
        }
    });

    const allUids = activeSchedule.flatMap(item => item.assignedTo || []);
    await getShortNamesForUids([...new Set(allUids)]); 

    const renderList = async (items, listElement, noTasksMsg) => {
        if (items.length > 0) {
            noTasksMsg.style.display = 'none';
            for (const item of items) {
                const shortNames = await getShortNamesForUids(item.assignedTo);
                listElement.appendChild(createScheduleItemElement(item, shortNames));
            }
        }
    };

    await renderList(todayItems, elements.todayTasksList, elements.noTodayTasks);
    await renderList(tomorrowItems, elements.tomorrowTasksList, elements.noTomorrowTasks);
    await renderList([...futureItems, ...unscheduledItems], elements.futureTasksList, elements.noFutureTasks);
}

async function renderCompletedTasks() {
    elements.completedTasksList.innerHTML = '';
    elements.noCompletedTasks.style.display = 'block';

    const completedTasks = state.tasks.filter(task => task.completed);

    if (completedTasks.length > 0) {
        elements.noCompletedTasks.style.display = 'none';
        completedTasks.sort((a, b) => {
            const dateA = parseDateString(a.completionDate);
            const dateB = parseDateString(b.completionDate);
            if (dateA && dateB) return dateB.getTime() - dateA.getTime();
            return (b.id > a.id) ? 1 : -1;
        });

        const allUidsInList = completedTasks.flatMap(task => task.assignedTo || []);
        await getShortNamesForUids([...new Set(allUidsInList)]);

        for (const task of completedTasks) {
            const shortNames = await getShortNamesForUids(task.assignedTo);
            elements.completedTasksList.appendChild(createCompletedTaskElement(task, shortNames));
        }
    }
}

/**
 * Erstellt das DOM Element für ein aktives Schedule Item.
 * GEÄNDERT: Zeigt Uhrzeit bei Fixen Terminen an.
 */
function createScheduleItemElement(item, assignedShortNames = []) {
    const itemElement = document.createElement('div');
    let classes = `task-item`;

    const today = normalizeDate();
    const itemPlannedDate = parseDateString(item.plannedDate);

    if (itemPlannedDate && itemPlannedDate.getTime() < today.getTime()) {
        classes += ' overdue';
    }

    // Priorisierungs-Klasse hinzufügen
    if (isItemPrioritized(item)) {
        classes += ' prioritized';
    }

    const isDraggable = !state.settings.autoPriority;
    itemElement.draggable = isDraggable;
    classes += isDraggable ? ' cursor-grab' : ' cursor-default';

    itemElement.className = classes;
    itemElement.dataset.taskId = item.taskId;
    itemElement.dataset.scheduleId = item.scheduleId;

    let locationMarker = '';
    if (item.location) {
        const color = generateColorFromString(item.location);
        locationMarker = `<div class="task-location-marker" style="background-color: ${color};" title="Ort: ${item.location}"></div>`;
    }

    let notesToggle = '';
    let notesContentHtml = '';
    if (item.notes) {
        notesToggle = `<button class="toggle-notes-btn ml-3 cursor-pointer hover:text-gray-700 transition duration-150" title="Notizen anzeigen/verbergen">
                            <i class="fas fa-chevron-down text-gray-500"></i>
                       </button>`;
        notesContentHtml = `<div class="task-notes-content hidden w-full"></div>`;
    }

    let assignedUsersDisplay = '';
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        assignedUsersDisplay = `<div class="assigned-users-display">${userBadges}</div>`;
    }

    const duration = getScheduleItemDuration(item);
    const durationDisplay = duration > 0 ? `<span class="ml-4 text-sm text-gray-500">(${formatHoursMinutes(duration)})</span>` : '';

    let benefitDisplay = '';
    if (item.type === 'Vorteil & Dauer' && item.financialBenefit && parseFloat(item.financialBenefit) > 0) {
        const originalDuration = parseFloat(item.estimatedDuration) || 0;
        if (originalDuration > 0) {
            const benefitPerHour = (parseFloat(item.financialBenefit) / originalDuration).toFixed(2);
            benefitDisplay = `<span class="ml-2 text-sm text-green-700">(${benefitPerHour}€/h)</span>`;
        } else {
            benefitDisplay = `<span class="ml-2 text-sm text-green-700">(${parseFloat(item.financialBenefit)}€)</span>`;
        }
    }

    let plannedDateDisplay = '';
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (itemPlannedDate && itemPlannedDate.getTime() > tomorrow.getTime()) {
        // NEU: Nutze lokalisierte Formatierung für zukünftige Daten
        plannedDateDisplay = `<span class="ml-2 text-sm text-gray-400">(${formatDateLocalized(itemPlannedDate)})</span>`;
    }

    const manualScheduleFlag = item.isManuallyScheduled && !state.settings.autoPriority ? `<i class="fas fa-thumbtack text-blue-500 ml-2 text-sm" title="Manuell geplant (wird nicht automatisch verschoben)"></i>` : '';
    
    // NEU: Uhrzeit für Fixe Termine
    let timeDisplay = '';
    if (item.type === 'Fixer Termin' && item.fixedTime) {
        timeDisplay = `<span class="ml-2 text-sm text-blue-500 font-semibold">@ ${item.fixedTime}</span>`;
    }

    // Finales HTML Layout
    itemElement.innerHTML = `
        ${locationMarker}
        <div class="flex items-center flex-grow">
            <input type="checkbox" data-task-id="${item.taskId}" class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer mt-0.5">
            <span class="task-content text-gray-800 text-lg cursor-pointer hover:text-blue-600 transition duration-150">${item.description}</span>
            ${timeDisplay}
            ${notesToggle}
            ${manualScheduleFlag}
            ${durationDisplay}
            ${benefitDisplay}
            ${item.deadlineDate ? `<span class="ml-2 text-sm text-red-500">Deadline: ${formatDateLocalized(parseDateString(item.deadlineDate))}</span>` : ''}
            ${plannedDateDisplay}
            ${assignedUsersDisplay}
        </div>
        ${notesContentHtml}
    `;

    if (item.notes) {
        const notesElement = itemElement.querySelector('.task-notes-content');
        if (notesElement) {
            notesElement.textContent = item.notes;
        }
    }

    return itemElement;
}

function createCompletedTaskElement(task, assignedShortNames = []) {
    const taskElement = document.createElement('div');
    taskElement.className = 'task-item completed cursor-default';
    taskElement.dataset.taskId = task.id;

    let locationMarker = '';
    if (task.location) {
        const color = generateColorFromString(task.location);
        locationMarker = `<div class="task-location-marker" style="background-color: ${color}; opacity: 0.6;" title="Ort: ${task.location}"></div>`;
    }

    let assignedUsersDisplay = '';
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        assignedUsersDisplay = `<div class="assigned-users-display">${userBadges}</div>`;
    }

    const duration = getOriginalTotalDuration(task);
    const durationDisplay = duration > 0 ? `<span class="ml-4 text-sm text-gray-500">(${formatHoursMinutes(duration)})</span>` : '';

    taskElement.innerHTML = `
        ${locationMarker}
        <div class="flex items-center flex-grow">
            <input type="checkbox" data-task-id="${task.id}" checked class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer">
            <span class="task-content text-gray-800 text-lg">${task.description}</span>
            ${durationDisplay}
            ${assignedUsersDisplay}
        </div>
    `;
    return taskElement;
}

function updateAvailableTimeDisplays() {
    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    let consumedToday = 0, consumedTomorrow = 0, consumedFuture = 0;

    state.schedule.forEach(item => {
        const itemDate = parseDateString(item.plannedDate);
        if (!itemDate) return;

        const duration = getScheduleItemDuration(item);
        if (itemDate.getTime() <= today.getTime()) {
            consumedToday += duration;
            return;
        }

        const timeDiff = itemDate.getTime() - today.getTime();
        const daysFromToday = Math.round(timeDiff / (1000 * 3600 * 24));

        if (daysFromToday === 1) {
            consumedTomorrow += duration;
        } else if (daysFromToday >= 2 && daysFromToday < 9) {
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

export function renderSettingsModal(settingsToRender) {
     if (!settingsToRender || !settingsToRender.dailyTimeSlots) return;
    elements.calcPriorityCheckbox.checked = settingsToRender.calcPriority;
    renderLocationsManagement(settingsToRender.locations || []);
    renderDailyTimeslots(settingsToRender);
}

function renderLocationsManagement(locations) {
    const container = elements.locationsListContainer;
    if (!container) return;

    container.innerHTML = '';
    if (locations.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 italic">Noch keine Orte angelegt.</p>';
        return;
    }

    locations.forEach(location => {
        const item = document.createElement('div');
        item.className = 'location-management-item';
        item.innerHTML = `
            <input type="text" value="${location}" data-original-location="${location}" class="location-name-input flex-grow bg-transparent focus:bg-white focus:ring-1 focus:ring-blue-500 rounded px-1">
            <button data-location="${location}" class="remove-location-btn" title="Ort löschen">&times;</button>
        `;
        container.appendChild(item);
    });
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
