// js/ui-render.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
// GEÄNDERT: Importiere formatDateLocalized
import { formatHoursMinutes, formatDateToYYYYMMDD, normalizeDate, parseDateString, generateColorFromString, formatDateLocalized } from './utils.js';
import { getScheduleItemDuration, getDailyAvailableHours, getOriginalTotalDuration } from './scheduler.js';
import { attachTaskInteractions } from './ui-actions.js';
import { getShortNamesForUids, getAllUserProfilesInTasks } from './collaboration.js';

// NEU: Konstante für die maximale Länge des Titels, bevor der "Mehr anzeigen"-Button erscheint.
const MAX_TITLE_LENGTH_SHORT = 80; 

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
    // Container für Ortsverwaltung
    locationsListContainer: document.getElementById('locations-list'),
    tomorrowAvailableTime: document.getElementById('tomorrowAvailableTime'),
    futureAvailableTime: document.getElementById('futureAvailableTime'),
    dailyTimeslotsContainer: document.getElementById('dailyTimeslotsContainer'),
    calcPriorityCheckbox: document.getElementById('calcPriorityCheckbox'),
    toggleDragDrop: document.getElementById('toggleDragDrop'),
    // NEU: Datumsanzeige
    todayDateDisplay: document.getElementById('todayDateDisplay'),
    tomorrowDateDisplay: document.getElementById('tomorrowDateDisplay'),
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
    // Rendere Schedule (lädt asynchron die Benutzerkürzel)
    await renderSchedule();
    await renderCompletedTasks();
    await renderFilterBar(); // Filterleiste rendern
    populateLocationDropdowns(); // Dropdowns befüllen
    updateAvailableTimeDisplays();
    updateDateDisplays(); // NEU: Aktualisiere die Datumsanzeigen

    // (Toggle State Update unverändert)
    if (elements.toggleDragDrop) {
        elements.toggleDragDrop.checked = !state.settings.autoPriority;
    }
    // Interaktionen müssen nach dem Rendern angehängt werden
    attachTaskInteractions();
}


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
        // Setze den zuvor ausgewählten Wert wieder (falls er existiert)
        if (locations.includes(currentValue) || currentValue === "") {
            select.value = currentValue;
        }
    });
}


async function renderFilterBar() {
    // 1. Orte aus den zentralen Einstellungen laden
    const allLocations = state.settings.locations || [];

    // 2. Teammitglieder sammeln (async)
    const allUsers = await getAllUserProfilesInTasks();

    // Verstecke die Leiste, wenn es keine Filteroptionen gibt
    if (allLocations.length === 0 && allUsers.length === 0) {
        filterElements.filterBar.classList.add('hidden');
        // Wir fahren fort, um sicherzustellen, dass die "Aktiv"-Nachricht ausgeblendet wird
    } else {
        filterElements.filterBar.classList.remove('hidden');
    }
    

    // 3. Filter-Buttons für Orte erstellen
    filterElements.locationFilters.innerHTML = '';
    if (allLocations.length > 0) {
        allLocations.forEach(location => {
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
        filterElements.locationFilters.innerHTML = `<p class="text-sm text-gray-500">Keine Orte definiert.</p>`;
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
    const isFilterActive = state.filters.prioritizedLocations.length > 0 || state.filters.prioritizedUserIds.length > 0;
    filterElements.clearFiltersBtn.disabled = !isFilterActive;
    if (isFilterActive) {
        filterElements.filterActiveMessage.classList.remove('hidden');
    } else {
        filterElements.filterActiveMessage.classList.add('hidden');
    }
}

/**
 * FIX: Re-added the missing isItemPrioritized function.
 * Checks if a schedule item matches the active filters.
 */
function isItemPrioritized(item) {
    const { prioritizedLocations, prioritizedUserIds } = state.filters;

    // Trim the location from the task item to guard against potential whitespace issues.
    const itemLocation = item.location ? item.location.trim() : null;
    const matchesLocation = prioritizedLocations.length > 0 && itemLocation && prioritizedLocations.includes(itemLocation);

    // For user check, all selected users AND the current user must be assigned.
    const currentUserId = state.user ? state.user.uid : null;
    
    // If no user is logged in, only the location can match.
    if (!currentUserId) return matchesLocation;

    const requiredUsers = [...prioritizedUserIds, currentUserId];
    // Checks if all required users are assigned to the task.
    const matchesUsers = prioritizedUserIds.length > 0 && requiredUsers.every(uid => (item.assignedTo || []).includes(uid));
    
    return matchesLocation || matchesUsers;
}


async function renderSchedule() {
    // Clear active lists
    [elements.todayTasksList, elements.tomorrowTasksList, elements.futureTasksList].forEach(list => list.innerHTML = '');
    [elements.noTodayTasks, elements.noTomorrowTasks, elements.noFutureTasks].forEach(msg => msg.style.display = 'block');

    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const overmorrow = normalizeDate();
    overmorrow.setDate(overmorrow.getDate() + 2);

    const activeSchedule = state.schedule;

    const todayItems = [], tomorrowItems = [], futureItems = [], unscheduledItems = [];

    // Gruppiere Items nach Datum
    activeSchedule.forEach(item => {
        const itemPlannedDate = parseDateString(item.plannedDate);

        if (!itemPlannedDate) {
            unscheduledItems.push(item);
            return;
        }

        // Wenn das geplante Datum in der Vergangenheit liegt, gehört es zu HEUTE (Überfällig).
        if (itemPlannedDate.getTime() <= today.getTime()) {
            todayItems.push(item);
        } else if (itemPlannedDate.getTime() === tomorrow.getTime()) {
            tomorrowItems.push(item);
        } else if (itemPlannedDate.getTime() >= overmorrow.getTime()) {
            futureItems.push(item);
        }
    });

    // Lade alle benötigten Benutzerkürzel im Voraus (Optimierung)
    const allUids = activeSchedule.flatMap(item => item.assignedTo || []);
    await getShortNamesForUids([...new Set(allUids)]); 

    // Helper Funktion zum Rendern einer Liste
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
            const dateA = a.completedAt ? new Date(a.completedAt) : null;
            const dateB = b.completedAt ? new Date(b.completedAt) : null;
            
            if (dateA && dateB) return dateB.getTime() - dateA.getTime();
            if (!dateA && dateB) return 1;
            if (dateA && !dateB) return -1;
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

function createScheduleItemElement(item, assignedShortNames = []) {
    const itemElement = document.createElement('div');
    let classes = `task-item`;

    const today = normalizeDate();
    const itemPlannedDate = parseDateString(item.plannedDate);

    if (itemPlannedDate && itemPlannedDate.getTime() < today.getTime()) {
        classes += ' overdue';
    }

    if (isItemPrioritized(item)) {
        classes += ' prioritized';
    }

    const isDraggable = !state.settings.autoPriority;
    itemElement.draggable = isDraggable;

    if (isDraggable) {
        classes += ' cursor-grab';
    }

    itemElement.className = classes;
    itemElement.dataset.taskId = item.taskId;
    itemElement.dataset.scheduleId = item.scheduleId;

    let locationMarker = '';
    if (item.location) {
        const color = generateColorFromString(item.location);
        locationMarker = `<div class="task-location-marker" style="background-color: ${color};" title="Ort: ${item.location}"></div>`;
    }

    const checkboxHtml = `<input type="checkbox" data-task-id="${item.taskId}" class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer mt-0.5 flex-shrink-0">`;
    const titleHtml = `<span class="task-title">${item.description}</span>`;

    let togglesHtml = '';
    if (item.description.length > MAX_TITLE_LENGTH_SHORT) {
        togglesHtml += `<button class="toggle-title-btn ml-3 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none flex-shrink-0" title="Vollständigen Titel anzeigen">
                            <i class="fas fa-ellipsis-h text-gray-500"></i>
                       </button>`;
    }
    if (item.notes) {
        togglesHtml += `<button class="toggle-notes-btn ml-3 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none flex-shrink-0" title="Notizen anzeigen/verbergen">
                            <i class="fas fa-chevron-down text-gray-500"></i>
                       </button>`;
    }
    if (item.isManuallyScheduled && !state.settings.autoPriority) {
        togglesHtml += `<i class="fas fa-thumbtack text-blue-500 ml-3 text-sm flex-shrink-0 mt-0.5" title="Manuell geplant (wird nicht automatisch verschoben)"></i>`;
    }

    let metadataHtml = '';
    const duration = getScheduleItemDuration(item);
    if (duration > 0) {
        metadataHtml += `<div><i class="far fa-clock meta-icon"></i>${formatHoursMinutes(duration)}</div>`;
    }
    if (item.type === 'Vorteil & Dauer' && item.financialBenefit && parseFloat(item.financialBenefit) > 0) {
        const originalDuration = parseFloat(item.estimatedDuration) || 0;
        let benefitText = '';
        if (originalDuration > 0) {
            const benefitPerHour = (parseFloat(item.financialBenefit) / originalDuration).toFixed(2);
            benefitText = `${benefitPerHour}€/h`;
        } else {
            benefitText = `${parseFloat(item.financialBenefit)}€`;
        }
        metadataHtml += `<div class="meta-benefit"><i class="fas fa-euro-sign meta-icon text-green-600"></i>${benefitText}</div>`;
    }
    if (item.location) {
        metadataHtml += `<div><i class="fas fa-map-marker-alt meta-icon"></i>${item.location}</div>`;
    }
    if (item.type === 'Fixer Termin' && item.fixedTime) {
        metadataHtml += `<div class="meta-fixed-time"><i class="fas fa-calendar-check meta-icon text-blue-500"></i>@ ${item.fixedTime}</div>`;
    }
    if (item.deadlineDate) {
        const deadlineText = formatDateLocalized(parseDateString(item.deadlineDate), item.deadlineTime);
        metadataHtml += `<div class="meta-deadline" title="Deadline"><i class="fas fa-flag meta-icon text-red-500"></i>${deadlineText}</div>`;
    }
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (itemPlannedDate && itemPlannedDate.getTime() > tomorrow.getTime() && item.type !== 'Fixer Termin') {
         metadataHtml += `<div><i class="far fa-calendar-alt meta-icon"></i>${formatDateLocalized(itemPlannedDate)}</div>`;
    }
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        metadataHtml += `<div class="assigned-users-display">${userBadges}</div>`;
    }

    let notesContentHtml = '';
    if (item.notes) {
        notesContentHtml = `<div class="task-notes-content hidden w-full"></div>`;
    }

    itemElement.innerHTML = `
        ${locationMarker}
        <div class="task-title-container">
            ${checkboxHtml}
            ${titleHtml}
            ${togglesHtml}
        </div>
        ${metadataHtml ? `<div class="task-metadata">${metadataHtml}</div>` : ''}
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

    const checkboxHtml = `<input type="checkbox" data-task-id="${task.id}" checked class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer mt-0.5 flex-shrink-0">`;
    const titleHtml = `<span class="task-title">${task.description}</span>`;

    let metadataHtml = '';
    const duration = getOriginalTotalDuration(task);
    if (duration > 0) {
        metadataHtml += `<div><i class="far fa-clock meta-icon"></i>${formatHoursMinutes(duration)}</div>`;
    }
    if (task.location) {
        metadataHtml += `<div><i class="fas fa-map-marker-alt meta-icon"></i>${task.location}</div>`;
    }
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        metadataHtml += `<div class="assigned-users-display">${userBadges}</div>`;
    }

    taskElement.innerHTML = `
        ${locationMarker}
        <div class="task-title-container">
            ${checkboxHtml}
            ${titleHtml}
        </div>
        ${metadataHtml ? `<div class="task-metadata">${metadataHtml}</div>` : ''}
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
    
    const remainingToday = availableToday - consumedToday;
    const remainingTomorrow = availableTomorrow - consumedTomorrow;
    const remainingFuture = availableFuture - consumedFuture;

    elements.todayAvailableTime.textContent = `Verfügbare Zeit: ${formatHoursMinutes(remainingToday)}`;
    elements.tomorrowAvailableTime.textContent = `Verfügbare Zeit: ${formatHoursMinutes(remainingTomorrow)}`;
    elements.futureAvailableTime.textContent = `Verfügbare Zeit (nächste 7 Tage): ${formatHoursMinutes(remainingFuture)}`;
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
        container.innerHTML = '<p class="text-sm text-gray-500 italic mb-4">Noch keine Orte angelegt.</p>';
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
        <input type="time" class="timeslot-start-input p-2 border border-gray-300 rounded-lg w-1/3" value="${startTime}">
        <span class="text-gray-500">bis</span>
        <input type="time" class="timeslot-end-input p-2 border border-gray-300 rounded-lg w-1/3" value="${endTime}">
        <button type="button" data-day="${dayName}" data-timeslot-id="${slotId}" class="remove-timeslot-btn">
            &times;
        </button>
    `;
    return timeslotDiv;
}
