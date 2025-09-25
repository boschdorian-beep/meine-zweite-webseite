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
        // Setze den zuvor ausgewählten Wert wieder (falls er existiert)
        if (locations.includes(currentValue) || currentValue === "") {
            select.value = currentValue;
        }
    });
}

/**
 * Rendert die Filterleiste basierend auf den aktuellen Aufgaben.
 */
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
    

    // 3. Filter-Buttons für Orte erstellen (GEÄNDERT: Checkboxes statt Radio)
    filterElements.locationFilters.innerHTML = '';
    if (allLocations.length > 0) {
        allLocations.forEach(location => {
            // GEÄNDERT: Prüfe ob Location im Array ist (state.js wurde im vorherigen Schritt angepasst)
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
    
    // Wenn kein User eingeloggt ist, kann nur der Ort matchen
    if (!currentUserId) return matchesLocation;

    const requiredUsers = [...prioritizedUserIds, currentUserId];
    // Prüft, ob alle erforderlichen Benutzer der Aufgabe zugewiesen sind
    const matchesUsers = prioritizedUserIds.length > 0 && requiredUsers.every(uid => (item.assignedTo || []).includes(uid));
    
    return matchesLocation || matchesUsers;
}


/**
 * Rendert den aktiven Zeitplan (state.schedule).
 * Muss async sein, um Benutzerkürzel zu laden.
 */
async function renderSchedule() {
    // Clear active lists
    [elements.todayTasksList, elements.tomorrowTasksList, elements.futureTasksList].forEach(list => list.innerHTML = '');
    // GEÄNDERT: Zeige "Keine Aufgaben" Nachricht nur an, wenn die Liste leer ist
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
    // Sammle alle UIDs aus dem gesamten Schedule
    const allUids = activeSchedule.flatMap(item => item.assignedTo || []);
    // Lade die Profile (füllt den Cache in collaboration.js)
    await getShortNamesForUids([...new Set(allUids)]); 

    // Helper Funktion zum Rendern einer Liste
    const renderList = async (items, listElement, noTasksMsg) => {
        if (items.length > 0) {
            noTasksMsg.style.display = 'none';
            
            // Rendere die Elemente
            for (const item of items) {
                // Lade Kürzel für dieses spezifische Item (nutzt jetzt den Cache)
                const shortNames = await getShortNamesForUids(item.assignedTo);
                listElement.appendChild(createScheduleItemElement(item, shortNames));
            }
        }
    };

    await renderList(todayItems, elements.todayTasksList, elements.noTodayTasks);
    await renderList(tomorrowItems, elements.tomorrowTasksList, elements.noTomorrowTasks);

    // Zukünftige Items sind bereits nach Datum (und Zeit) sortiert (durch den Scheduler).
    await renderList([...futureItems, ...unscheduledItems], elements.futureTasksList, elements.noFutureTasks);
}

/**
 * Rendert die erledigten Aufgaben (aus state.tasks).
 * async
 */
async function renderCompletedTasks() {
    elements.completedTasksList.innerHTML = '';
    elements.noCompletedTasks.style.display = 'block';

    // Lese aus den Definitionen
    const completedTasks = state.tasks.filter(task => task.completed);

    if (completedTasks.length > 0) {
        elements.noCompletedTasks.style.display = 'none';
        // Sortiert nach Erledigungsdatum, neueste zuerst
        completedTasks.sort((a, b) => {
            // Nutze completedAt (ISO String) für die Sortierung
            const dateA = a.completedAt ? new Date(a.completedAt) : null;
            const dateB = b.completedAt ? new Date(b.completedAt) : null;
            
            if (dateA && dateB) return dateB.getTime() - dateA.getTime();
            if (!dateA && dateB) return 1;
            if (dateA && !dateB) return -1;
            return (b.id > a.id) ? 1 : -1; // Fallback
        });

        // Lade alle Benutzerkürzel im Voraus
        const allUidsInList = completedTasks.flatMap(task => task.assignedTo || []);
        await getShortNamesForUids([...new Set(allUidsInList)]);

        for (const task of completedTasks) {
            // Lade Kürzel (nutzt Cache)
            const shortNames = await getShortNamesForUids(task.assignedTo);
            elements.completedTasksList.appendChild(createCompletedTaskElement(task, shortNames));
        }
    }
}


/**
 * Erstellt das DOM Element für ein aktives Schedule Item.
 * STARK ÜBERARBEITET: Nutzt das neue, saubere Layout aus index.html.
 */
function createScheduleItemElement(item, assignedShortNames = []) {
    const itemElement = document.createElement('div');
    let classes = `task-item`;

    const today = normalizeDate();
    const itemPlannedDate = parseDateString(item.plannedDate);

    // Status Klassen
    // Überfällig hat visuelle Priorität vor Filter-Status (Rot > Lila)
    if (itemPlannedDate && itemPlannedDate.getTime() < today.getTime()) {
        classes += ' overdue';
    }

    // Priorisierungs-Klasse hinzufügen
    if (isItemPrioritized(item)) {
        classes += ' prioritized';
    }

    // Draggable status & Cursor
    const isDraggable = !state.settings.autoPriority;
    itemElement.draggable = isDraggable;

    // Der Cursor wird auf dem Hauptelement gesetzt
    if (isDraggable) {
        classes += ' cursor-grab';
    }

    itemElement.className = classes;
    itemElement.dataset.taskId = item.taskId;
    itemElement.dataset.scheduleId = item.scheduleId;

    // --- Elemente für das neue Layout ---

    // 1. Checkbox Container
    // CSS (.task-checkbox-container) kümmert sich um das Alignment (pt-0.5)
    const checkboxHtml = `<input type="checkbox" data-task-id="${item.taskId}" class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded cursor-pointer">`;

    // 2. Content Container

    // Titel (Wird gekürzt durch CSS-Klasse .task-title)
    const titleHtml = `<span class="task-title">${item.description}</span>`;

    // Toggles (Notizen, Titel erweitern, Manuell gepinnt)
    let togglesHtml = '';

    // NEU: Titel erweitern (wenn zu lang)
    if (item.description.length > MAX_TITLE_LENGTH_SHORT) {
        // mt-0.5 für Alignment mit dem Titeltext
        togglesHtml += `<button class="toggle-title-btn ml-3 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none flex-shrink-0 mt-0.5" title="Vollständigen Titel anzeigen">
                            <i class="fas fa-ellipsis-h text-gray-500"></i>
                       </button>`;
    }

    // Notizen Toggle
    if (item.notes) {
        togglesHtml += `<button class="toggle-notes-btn ml-3 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none flex-shrink-0 mt-0.5" title="Notizen anzeigen/verbergen">
                            <i class="fas fa-chevron-down text-gray-500"></i>
                       </button>`;
    }

    // Manuell gepinnt Flag
    if (item.isManuallyScheduled && !state.settings.autoPriority) {
        togglesHtml += `<i class="fas fa-thumbtack text-blue-500 ml-3 text-sm flex-shrink-0 mt-1" title="Manuell geplant (wird nicht automatisch verschoben)"></i>`;
    }


    // 3. Metadaten-Zeile (Zweite Zeile)
    let metadataHtml = '';

    // Dauer
    const duration = getScheduleItemDuration(item);
    if (duration > 0) {
        metadataHtml += `<div><i class="far fa-clock meta-icon"></i>${formatHoursMinutes(duration)}</div>`;
    }

    // Finanzieller Vorteil
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

    // Ort (Nur Textanzeige)
    if (item.location) {
        metadataHtml += `<div><i class="fas fa-map-marker-alt meta-icon"></i>${item.location}</div>`;
    }

    // Datum und Zeit (Fixer Termin, Deadline, Zukünftiges Datum)
    
    // Fixer Termin Zeit
    if (item.type === 'Fixer Termin' && item.fixedTime) {
        metadataHtml += `<div class="meta-fixed-time"><i class="fas fa-calendar-check meta-icon text-blue-500"></i>@ ${item.fixedTime}</div>`;
    }

    // Deadline Datum (& Zeit)
    if (item.deadlineDate) {
        // NEU: Zeige Uhrzeit an, wenn vorhanden (formatDateLocalized unterstützt dies)
        const deadlineText = formatDateLocalized(parseDateString(item.deadlineDate), item.deadlineTime);
        metadataHtml += `<div class="meta-deadline" title="Deadline"><i class="fas fa-flag meta-icon text-red-500"></i>${deadlineText}</div>`;
    }

    // Geplantes Datum (wenn in der Zukunft und nicht Fixer Termin, da diese schon Zeit anzeigen)
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (itemPlannedDate && itemPlannedDate.getTime() > tomorrow.getTime() && item.type !== 'Fixer Termin') {
         metadataHtml += `<div><i class="far fa-calendar-alt meta-icon"></i>${formatDateLocalized(itemPlannedDate)}</div>`;
    }


    // Zugewiesene Benutzer (Kürzel)
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        metadataHtml += `<div class="assigned-users-display">${userBadges}</div>`;
    }


    // 4. Notizen Inhalt (Dritte Zeile, optional)
    let notesContentHtml = '';
    if (item.notes) {
        // Inhalt (versteckt) - wird später als Element hinzugefügt für Sicherheit (textContent)
        notesContentHtml = `<div class="task-notes-content hidden w-full"></div>`;
    }


    // Finales HTML Layout (Nutzt die neuen Container-Klassen aus index.html)
    itemElement.innerHTML = `
        <div class="task-checkbox-container">
            ${checkboxHtml}
        </div>
        <div class="task-content-container">
            <div class="task-title-wrapper">
                ${titleHtml}
                ${togglesHtml}
            </div>
            ${metadataHtml ? `<div class="task-metadata">${metadataHtml}</div>` : ''}
            ${notesContentHtml}
        </div>
    `;

    // Sicherstellen, dass der Notizinhalt als Text eingefügt wird (verhindert XSS)
    if (item.notes) {
        const notesElement = itemElement.querySelector('.task-notes-content');
        if (notesElement) {
            notesElement.textContent = item.notes;
        }
    }

    return itemElement;
}

/**
 * Erstellt das DOM Element für eine erledigte Aufgabe (Definition).
 * Angepasst an das neue Layout.
 */
function createCompletedTaskElement(task, assignedShortNames = []) {
    const taskElement = document.createElement('div');
    // cursor-default entfernt den Grab-Cursor
    taskElement.className = 'task-item completed cursor-default';
    taskElement.dataset.taskId = task.id;

    // 1. Checkbox Container
    // (checked)
    const checkboxHtml = `<input type="checkbox" data-task-id="${task.id}" checked class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded cursor-pointer">`;
    
    // 2. Content Container
    // Titel (task-title Klasse für Konsistenz)
    const titleHtml = `<span class="task-title">${task.description}</span>`;


    // 3. Metadaten-Zeile
    let metadataHtml = '';

    // Dauer
    const duration = getOriginalTotalDuration(task);
    if (duration > 0) {
        metadataHtml += `<div><i class="far fa-clock meta-icon"></i>${formatHoursMinutes(duration)}</div>`;
    }

    // Ort
    if (task.location) {
        metadataHtml += `<div><i class="fas fa-map-marker-alt meta-icon"></i>${task.location}</div>`;
    }

    // Zugewiesene Benutzer (Kürzel)
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        metadataHtml += `<div class="assigned-users-display">${userBadges}</div>`;
    }

    // Finales HTML Layout
    taskElement.innerHTML = `
        <div class="task-checkbox-container">
            ${checkboxHtml}
        </div>
        <div class="task-content-container">
            <div class="task-title-wrapper">
                ${titleHtml}
            </div>
            ${metadataHtml ? `<div class="task-metadata">${metadataHtml}</div>` : ''}
        </div>
    `;
    return taskElement;
}


// WIEDERHERGESTELLT: Die folgenden Funktionen waren in den letzten Antworten teilweise abgeschnitten.

function updateAvailableTimeDisplays() {
    const today = normalizeDate();
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Berechne die verfügbare Zeit (inkl. Berücksichtigung der aktuellen Uhrzeit für Heute)
    const availableToday = getDailyAvailableHours(today);
    const availableTomorrow = getDailyAvailableHours(tomorrow);

    // Berechne die geplante Zeit
    let consumedToday = 0;
    let consumedTomorrow = 0;
    let consumedFuture = 0;

    // Wir müssen auch Aufgaben berücksichtigen, die für die Vergangenheit geplant waren (Überfällig)
    // Diese zählen zur heutigen Last.
    state.schedule.forEach(item => {
        const itemDate = parseDateString(item.plannedDate);
        
        // Behandle nicht planbare Aufgaben (zählen zur Zukunftslast)
        if (!itemDate) {
            consumedFuture += getScheduleItemDuration(item);
            return;
        }

        const duration = getScheduleItemDuration(item);

        if (itemDate.getTime() <= today.getTime()) {
            consumedToday += duration;
        } else if (itemDate.getTime() === tomorrow.getTime()) {
            consumedTomorrow += duration;
        } else {
            consumedFuture += duration;
        }
    });

    // Berechne die Restzeit (kann negativ sein, wenn überbucht)
    // Wir verwenden die verfügbare Zeit ab JETZT für die Berechnung des Rests Heute.
    const remainingToday = availableToday - consumedToday;
    const remainingTomorrow = availableTomorrow - consumedTomorrow;

    // Aktualisiere die Anzeige
    if (elements.todayAvailableTime) {
        // Angepasst: Zeigt Geplant und Restzeit an.
        elements.todayAvailableTime.textContent = `Geplant: ${formatHoursMinutes(consumedToday)} (Rest ab jetzt: ${formatHoursMinutes(remainingToday)})`;
        // Zeige Warnung, wenn überbucht (Restzeit < 0)
        if (remainingToday < -0.01) {
             elements.todayAvailableTime.classList.add('text-red-600', 'font-semibold');
        } else {
             elements.todayAvailableTime.classList.remove('text-red-600', 'font-semibold');
        }
    }
    if (elements.tomorrowAvailableTime) {
        elements.tomorrowAvailableTime.textContent = `Geplant: ${formatHoursMinutes(consumedTomorrow)} (Rest: ${formatHoursMinutes(remainingTomorrow)})`;
        if (remainingTomorrow < -0.01) {
            elements.tomorrowAvailableTime.classList.add('text-red-600', 'font-semibold');
       } else {
            elements.tomorrowAvailableTime.classList.remove('text-red-600', 'font-semibold');
       }
    }
    if (elements.futureAvailableTime) {
        // Für die Zukunft zeigen wir nur die geplante Gesamtzeit an
        elements.futureAvailableTime.textContent = `Insgesamt geplant: ${formatHoursMinutes(consumedFuture)}`;
    }
}

export function renderSettingsModal(settings) {
    if (elements.calcPriorityCheckbox) {
        elements.calcPriorityCheckbox.checked = settings.calcPriority;
    }
    // Stellt sicher, dass die Listen im Modal gerendert werden
    renderDailyTimeslots(settings.dailyTimeSlots);
    renderLocationsManagement(settings.locations);
}

/**
 * Rendert die Ortsverwaltung im Einstellungs-Modal.
 */
function renderLocationsManagement(locations = []) {
    const container = elements.locationsListContainer;
    if (!container) return;
    container.innerHTML = '';

    if (locations.length === 0) {
        container.innerHTML = '<p class="text-gray-500 italic mb-4">Noch keine Orte definiert.</p>';
        return;
    }

    locations.forEach(location => {
        const item = document.createElement('div');
        item.className = 'location-management-item';
        // Wir nutzen ein Input-Feld für das Umbenennen.
        // data-original-location speichert den aktuellen Namen für die Logik in ui-actions.js
        item.innerHTML = `
            <input type="text" value="${location}" data-original-location="${location}" class="location-name-input flex-grow p-1 border border-transparent rounded-md hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none mr-2">
            <button data-location="${location}" class="remove-location-btn focus:outline-none" title="Löschen">&times;</button>
        `;
        container.appendChild(item);
    });
}

function renderDailyTimeslots(dailyTimeSlots) {
    const container = elements.dailyTimeslotsContainer;
    if (!container) return;
    container.innerHTML = '';

    WEEKDAYS.forEach(dayName => {
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day-section';

        const slots = dailyTimeSlots[dayName] || [];
        
        // Header: Wochentag und Buttons (Vereinfachtes Layout)
        const header = document.createElement('div');
        header.className = 'flex justify-between items-center mb-4';
        header.innerHTML = `<h3 class="text-lg font-semibold text-gray-800">${dayName}</h3>`;
        
        const buttonsDiv = document.createElement('div');
        buttonsDiv.className = 'flex space-x-2';

        if (slots.length > 0) {
            // Button zum Hinzufügen eines weiteren Slots
            buttonsDiv.innerHTML += `<button data-day="${dayName}" class="add-timeslot-btn text-blue-500 hover:text-blue-700 focus:outline-none" title="Zeitfenster hinzufügen">
                                    <i class="fas fa-plus-circle"></i>
                                </button>`;
            // Button zum Entfernen aller Slots des Tages
            buttonsDiv.innerHTML += `<button data-day="${dayName}" class="remove-day-btn text-red-500 hover:text-red-700 focus:outline-none" title="Alle Zeitfenster für diesen Tag löschen">
                                    <i class="fas fa-trash-alt"></i>
                                </button>`;
        } else {
            // Wenn keine Slots vorhanden sind, zeige "Wiederherstellen" Button
            buttonsDiv.innerHTML = `<button data-day="${dayName}" class="restore-day-btn text-green-500 hover:text-green-700 focus:outline-none" title="Standardzeitfenster erstellen">
                                <i class="fas fa-plus-circle"></i> Hinzufügen
                           </button>`;
        }
        header.appendChild(buttonsDiv);
        dayDiv.appendChild(header);

        // Container für die einzelnen Slots
        const slotsDiv = document.createElement('div');
        slotsDiv.id = `timeslots-${dayName}`;
        slotsDiv.className = 'space-y-3';

        if (slots.length === 0) {
            slotsDiv.innerHTML = '<p class="text-gray-500 italic">Keine Zeitfenster definiert (Keine Verfügbarkeit).</p>';
        } else {
            // Sortiere Slots nach Startzeit, bevor sie gerendert werden
            slots.sort((a, b) => a.start.localeCompare(b.start));
            slots.forEach(slot => {
                // Angepasst: createTimeslotElement Signatur
                slotsDiv.appendChild(createTimeslotElement(slot, dayName));
            });
        }

        dayDiv.appendChild(slotsDiv);
        container.appendChild(dayDiv);
    });
}

// Angepasst: Signatur
function createTimeslotElement(slot, dayName) {
    const slotDiv = document.createElement('div');
    // timeslot-row Klasse wird für das Auslesen der Daten benötigt (updateAndGetSettingsFromModal)
    slotDiv.className = 'flex items-center space-x-4 timeslot-row';
    // data-timeslot-id wird benötigt, um Slots eindeutig zu identifizieren
    slotDiv.dataset.timeslotId = slot.id;

    slotDiv.innerHTML = `
        <input type="time" value="${slot.start}" class="timeslot-start-input p-2 border border-gray-300 rounded-lg w-full">
        <span class="text-gray-500">bis</span>
        <input type="time" value="${slot.end}" class="timeslot-end-input p-2 border border-gray-300 rounded-lg w-full">
        <button data-day="${dayName}" data-timeslot-id="${slot.id}" class="remove-timeslot-btn focus:outline-none" title="Diesen Slot entfernen">
            <i class="fas fa-times"></i>
        </button>
    `;
    return slotDiv;
}
