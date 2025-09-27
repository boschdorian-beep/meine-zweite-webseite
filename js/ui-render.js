// js/ui-render.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
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
    // Container für Ortsverwaltung
    locationsListContainer: document.getElementById('locations-list'),
    tomorrowAvailableTime: document.getElementById('tomorrowAvailableTime'),
    futureAvailableTime: document.getElementById('futureAvailableTime'),
    dailyTimeslotsContainer: document.getElementById('dailyTimeslotsContainer'),
    calcPriorityCheckbox: document.getElementById('calcPriorityCheckbox'),
    // Checkbox für exakte Zeiten
    showExactTimesCheckbox: document.getElementById('showExactTimesCheckbox'),
    // Datumsanzeige
    todayDateDisplay: document.getElementById('todayDateDisplay'),
    tomorrowDateDisplay: document.getElementById('tomorrowDateDisplay'),
    // Input für Textlänge in Einstellungen
    taskTruncationLengthInput: document.getElementById('taskTruncationLengthInput'),
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
    updateDateDisplays(); // Aktualisiere die Datumsanzeigen

    // Interaktionen müssen nach dem Rendern angehängt werden
    attachTaskInteractions();
}

/**
 * Aktualisiert die Datumsanzeigen neben "Heute" und "Morgen".
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
    

    // 3. Filter-Buttons für Orte erstellen (Checkboxes)
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
 * Prüft, ob ein Schedule-Item den aktiven Filtern entspricht.
 */
function isItemPrioritized(item) {
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
            const dateA = parseDateString(a.completionDate);
            const dateB = parseDateString(b.completionDate);
            if (dateA && dateB) return dateB.getTime() - dateA.getTime();
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
 * Hilfsfunktion zur Kürzung des Textes.
 * Behandelt Aufgaben-Teile speziell.
 */
function truncateText(text, maxLength) {
    if (!text) return { truncated: '', isTruncated: false, suffix: '' };
    
    // Behandle Aufgaben-Teile (z.B. "(Teil 1)") speziell, damit sie nicht abgeschnitten werden.
    const partMatch = text.match(/\(Teil \d+\)$/);
    let baseDescription = text;
    let partSuffix = '';

    if (partMatch) {
        partSuffix = ' ' + partMatch[0];
        // Entferne den Suffix vom Haupttext für die Längenberechnung
        baseDescription = text.substring(0, text.length - partMatch[0].length).trim();
    }

    if (baseDescription.length <= maxLength) {
        // Text ist kurz genug. Suffix wird später hinzugefügt, falls vorhanden.
        return { truncated: baseDescription, isTruncated: false, suffix: partSuffix };
    }
    
    // Kürzen und "..." hinzufügen
    const truncated = baseDescription.substring(0, maxLength) + '...';
    return { truncated: truncated, isTruncated: true, suffix: partSuffix };
}


/**
 * Erstellt das DOM Element für ein aktives Schedule Item.
 * GEÄNDERT: Komplett überarbeitet, um das CSS Grid Layout zu nutzen.
 */
function createScheduleItemElement(item, assignedShortNames = []) {
    const itemElement = document.createElement('div');
    let classes = `task-item`;

    const today = normalizeDate();
    const itemPlannedDate = parseDateString(item.plannedDate);

    // Status Klassen
    if (itemPlannedDate && itemPlannedDate.getTime() < today.getTime()) {
        classes += ' overdue';
    }

    // Priorisierungs-Klasse hinzufügen
    if (isItemPrioritized(item)) {
        classes += ' prioritized';
    }

    // Draggable status
    itemElement.draggable = false;
    classes += ' cursor-default';

    itemElement.className = classes;
    itemElement.dataset.taskId = item.taskId;
    itemElement.dataset.scheduleId = item.scheduleId;

    // --- Elemente definieren (Inhalte für die Grid-Zellen) ---

    // 1. Ortsmarkierung (Keine Grid-Zelle, absolut positioniert)
    let locationMarker = '';
    if (item.location) {
        const color = generateColorFromString(item.location);
        locationMarker = `<div class="task-location-marker" style="background-color: ${color};" title="Ort: ${item.location}"></div>`;
    }

    // 2. Notizen (Button und Inhalt)
    let notesToggle = '';
    let notesContentHtml = '';
    if (item.notes) {
        // Button zum Ein-/Ausklappen (Standardmäßig eingeklappt)
        // ml-2 für Abstand zum vorherigen Element im task-content
        notesToggle = `<button class="toggle-notes-btn ml-2 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none" title="Notizen anzeigen/verbergen">
                            <i class="fas fa-chevron-down text-gray-500"></i>
                       </button>`;
        // Inhalt (versteckt) - wird später im expanded-container platziert
        notesContentHtml = `<div class="task-notes-content hidden"></div>`;
    }

    // 3. Zugewiesene Benutzer (Kürzel)
    let assignedUsersDisplay = '';
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        assignedUsersDisplay = `<div class="assigned-users-display">${userBadges}</div>`;
    }

    // 4. Prioritäts-Pfeile
    const priority = item.priority || 3;
    const isPrioUpDisabled = priority >= 5;
    const isPrioDownDisabled = priority <= 1;

    // Pfeile nur für flexible Aufgaben anzeigen.
    let priorityArrowsHtml = '';
    if (item.type === 'Vorteil & Dauer') {
        priorityArrowsHtml = `
            <div class="priority-arrows">
                <button data-task-id="${item.taskId}" data-direction="down" class="priority-arrow-btn ${isPrioDownDisabled ? 'disabled' : ''}" title="Priorität senken (Min 1)">
                    <i class="fas fa-chevron-down"></i>
                </button>
                <span class="priority-display">${priority}</span>
                <button data-task-id="${item.taskId}" data-direction="up" class="priority-arrow-btn ${isPrioUpDisabled ? 'disabled' : ''}" title="Priorität erhöhen (Max 5)">
                    <i class="fas fa-chevron-up"></i>
                </button>
            </div>
        `;
    } else {
        // Für Termine/Deadlines nur die Zahl anzeigen (zur Info)
         priorityArrowsHtml = `
            <div class="priority-arrows" title="Priorität (Fix durch Aufgabentyp)">
                <span class="priority-display">${priority}</span>
            </div>
        `;
    }


    // 5. Gekürzte Beschreibung und Toggle
    const truncationLength = state.settings.taskTruncationLength || 30;
    const { truncated, isTruncated, suffix } = truncateText(item.description, truncationLength);
    
    let descriptionToggle = '';
    // Gekürzter Text (Standardmäßig sichtbar) - Span wird später befüllt.
    let descriptionContentHtml = `<span class="task-description-short"></span>`;
    // Voller Text (Standardmäßig versteckt, nur wenn gekürzt) - wird später im expanded-container platziert
    let fullDescriptionHtml = '';

    if (isTruncated) {
        // Button zum Umschalten
        // ml-2 für Abstand zum vorherigen Element im task-content
        descriptionToggle = `<button class="toggle-description-btn ml-2 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none" title="Vollständigen Text anzeigen">
                                <i class="fas fa-chevron-down text-gray-500"></i>
                             </button>`;
        // Der vollständige Text wird später sicher eingefügt. Suffix wird hier als Text hinzugefügt.
        fullDescriptionHtml = `<div class="task-description-full hidden">${suffix}</div>`;
    }


    // --- Metadaten Elemente ---

    // Dauer
    const duration = getScheduleItemDuration(item);
    const durationDisplay = duration > 0 ? `<span class="text-sm text-gray-500">(${formatHoursMinutes(duration)})</span>` : '';

    // Finanzieller Vorteil
    let benefitDisplay = '';
    if (item.type === 'Vorteil & Dauer' && item.financialBenefit && parseFloat(item.financialBenefit) > 0) {
        // Nutze die gespeicherte estimatedDuration vom Item
        const originalDuration = parseFloat(item.estimatedDuration) || 0;
        if (originalDuration > 0) {
            const benefitPerHour = (parseFloat(item.financialBenefit) / originalDuration).toFixed(2);
            benefitDisplay = `<span class="text-sm text-green-700">(${benefitPerHour}€/h)</span>`;
        } else {
            benefitDisplay = `<span class="text-sm text-green-700">(${parseFloat(item.financialBenefit)}€)</span>`;
        }
    }

    // Datum (wenn in der Zukunft)
    let plannedDateDisplay = '';
    const tomorrow = normalizeDate();
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (itemPlannedDate && itemPlannedDate.getTime() > tomorrow.getTime()) {
        // Nutze lokalisierte Formatierung für zukünftige Daten
        plannedDateDisplay = `<span class="text-sm text-gray-400">(${formatDateLocalized(itemPlannedDate)})</span>`;
    }

    // Uhrzeit für Fixe Termine oder Berechnete Zeiten
    let timeDisplay = '';
    
    // Priorität 1: Berechnete Zeiten (wenn aktiviert und vorhanden)
    if (state.settings.showExactTimes && item.calculatedStartTime && item.calculatedEndTime) {
        // Nutzt eine leicht andere Farbe (Violett/Akzent) für berechnete Zeiten
        timeDisplay = `<span class="text-sm text-accent font-semibold">${item.calculatedStartTime} - ${item.calculatedEndTime}</span>`;
    } 
    // Priorität 2: Fixe Zeit (falls Einstellung aus oder Zeit nicht berechnet)
    else if (item.type === 'Fixer Termin' && item.fixedTime) {
        timeDisplay = `<span class="text-sm text-blue-500 font-semibold">@ ${item.fixedTime}</span>`;
    }

    // Deadline Info (Datum und Uhrzeit)
    let deadlineInfo = '';
    if (item.deadlineDate) {
        deadlineInfo = `<span class="text-sm text-red-500">Deadline: ${formatDateLocalized(parseDateString(item.deadlineDate))}`;
        if (item.deadlineTime) {
            deadlineInfo += ` ${item.deadlineTime}`;
        }
        deadlineInfo += `</span>`;
    }

    // NEU: Container für expandierbaren Inhalt (wenn vorhanden)
    let expandedContainerHtml = '';
    if (isTruncated || item.notes) {
        expandedContainerHtml = `
            <div class="task-expanded-container">
                ${fullDescriptionHtml}
                ${notesContentHtml}
            </div>
        `;
    }


    // Finales HTML Layout (CSS Grid Struktur)
    // Jedes direkte Child-Element ist eine Grid-Zelle.
    itemElement.innerHTML = `
        ${locationMarker}
        
        <input type="checkbox" data-task-id="${item.taskId}" class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded cursor-pointer">
        
        <div class="task-content">
             ${descriptionContentHtml}
             ${descriptionToggle}
             ${notesToggle}
        </div>

        ${timeDisplay}
        ${priorityArrowsHtml}
        ${durationDisplay}
        ${benefitDisplay}
        ${deadlineInfo}
        ${plannedDateDisplay}
        ${assignedUsersDisplay}

        ${expandedContainerHtml}
    `;

    // Sicherstellen, dass Inhalte als Text eingefügt werden (verhindert XSS)
    
    // Gekürzten Text einfügen
    const shortTextElement = itemElement.querySelector('.task-description-short');
    if (shortTextElement) {
        shortTextElement.textContent = truncated;
        // Wenn nicht gekürzt, aber ein Suffix vorhanden ist (z.B. "(Teil 1)"), füge ihn hinzu.
        if (suffix && !isTruncated) {
            shortTextElement.textContent += suffix;
        }
    }

    if (item.notes) {
        const notesElement = itemElement.querySelector('.task-notes-content');
        if (notesElement) {
            notesElement.textContent = item.notes;
        }
    }

    if (isTruncated) {
        const fullTextElementBlock = itemElement.querySelector('.task-description-full');
        // Wir fügen den Basis-Text (ohne Suffix) in das Block-Element ein.
        const baseDescription = item.description.replace(suffix, '').trim();
        
        if (fullTextElementBlock) {
            // Erstelle einen Span für den Text und füge ihn vor dem Suffix (der bereits im HTML steht) ein
            const textSpan = document.createElement('span');
            textSpan.textContent = baseDescription;
            fullTextElementBlock.insertBefore(textSpan, fullTextElementBlock.firstChild);
        }
    }

    return itemElement;
}

/**
 * Erstellt das DOM Element für eine erledigte Aufgabe (Definition).
 * GEÄNDERT: Angepasst an das neue CSS Grid Layout.
 */
function createCompletedTaskElement(task, assignedShortNames = []) {
    const taskElement = document.createElement('div');
    // cursor-default entfernt den Grab-Cursor
    taskElement.className = 'task-item completed cursor-default';
    taskElement.dataset.taskId = task.id;

    // 1. Ort (Farbiger Balken)
    let locationMarker = '';
    if (task.location) {
        const color = generateColorFromString(task.location);
        // Etwas transparenter bei erledigten Aufgaben
        locationMarker = `<div class="task-location-marker" style="background-color: ${color}; opacity: 0.6;" title="Ort: ${task.location}"></div>`;
    }

    // 2. Zugewiesene Benutzer (Kürzel)
    let assignedUsersDisplay = '';
    if (assignedShortNames.length > 0) {
        const userBadges = assignedShortNames.map(name => `<span class="user-shortname">${name}</span>`).join('');
        assignedUsersDisplay = `<div class="assigned-users-display">${userBadges}</div>`;
    }

    // Priorität (nur Anzeige)
    const priority = task.priority || 3;
    const priorityDisplayHtml = `
        <div class="priority-arrows">
            <span class="priority-display" title="Priorität">${priority}</span>
        </div>
    `;

    // Dauer
    const duration = getOriginalTotalDuration(task);
    const durationDisplay = duration > 0 ? `<span class="text-sm text-gray-500">(${formatHoursMinutes(duration)})</span>` : '';

    // Textkürzung auch hier anwenden (ohne Toggle, da erledigt)
    const truncationLength = state.settings.taskTruncationLength || 30;
    // Bei erledigten Aufgaben gibt es keine Teile mehr.
    const { truncated } = truncateText(task.description, truncationLength);

    // GEÄNDERT: Nutzt das neue CSS Grid Layout (flache Struktur)
    // Wir fügen leere <span> Elemente ein, um die Spalten auszurichten, die bei erledigten Aufgaben fehlen (Zeit, Benefit, Deadline, Datum).
    taskElement.innerHTML = `
        ${locationMarker}
        
        <input type="checkbox" data-task-id="${task.id}" checked class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer">
        
        <div class="task-content">
             <span class="text-gray-800 text-lg">${truncated}</span>
        </div>

        <span></span> ${priorityDisplayHtml}
        ${durationDisplay}
        <span></span> <span></span> <span></span> ${assignedUsersDisplay}
    `;
    return taskElement;
}


// GEÄNDERT: Nutzt die aktualisierte getDailyAvailableHours (die die aktuelle Uhrzeit berücksichtigt)
function updateAvailableTimeDisplays() {
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

    // Diese Funktionen berücksichtigen jetzt die aktuelle Uhrzeit für "Heute" (siehe scheduler.js)
    const availableToday = getDailyAvailableHours(today);
    const availableTomorrow = getDailyAvailableHours(tomorrow);

    // Berechne Verfügbarkeit für die nächsten 7 Tage (ohne Heute/Morgen)
    let availableFuture = 0;
    for (let i = 2; i < 9; i++) {
        const futureDate = normalizeDate();
        futureDate.setDate(today.getDate() + i);
        availableFuture += getDailyAvailableHours(futureDate);
    }
    
    // Berechne die Restzeit (formatHoursMinutes stellt sicher, dass es nicht negativ wird)
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

    // Befülle die Checkbox für die exakte Zeitanzeige
    if (elements.showExactTimesCheckbox) {
        elements.showExactTimesCheckbox.checked = settingsToRender.showExactTimes || false;
    }

    // Befülle das Input-Feld für die Textlänge
    if (elements.taskTruncationLengthInput) {
        elements.taskTruncationLengthInput.value = settingsToRender.taskTruncationLength || 30;
    }
    
    renderLocationsManagement(settingsToRender.locations || []);
    renderDailyTimeslots(settingsToRender);
}

/**
 * Rendert die UI zur Verwaltung der Orte im Einstellungs-Modal.
 */
function renderLocationsManagement(locations) {
    const container = elements.locationsListContainer;
    if (!container) return;

    container.innerHTML = '';
    if (locations.length === 0) {
        // Etwas Abstand zum nächsten Element hinzufügen (mb-4)
        container.innerHTML = '<p class="text-sm text-gray-500 italic mb-4">Noch keine Orte angelegt.</p>';
        return;
    }

    locations.forEach(location => {
        const item = document.createElement('div');
        item.className = 'location-management-item';
        // Statt eines <span> verwenden wir ein <input>, um Umbenennungen zu ermöglichen.
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

    // Nutzt das Styling für remove-timeslot-btn aus dem CSS
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

/**
 * Rendert den Prioritäts-Selector (Radio Buttons) im jeweiligen Kontext.
 */
export function renderPrioritySelector(context, currentPriority) {
    // context ist 'new' oder 'edit'
    const selectorId = `${context}-priority-selector`;
    const selector = document.getElementById(selectorId);
    if (!selector) return;

    selector.innerHTML = '';
    // Name für die Radio-Gruppe (muss eindeutig sein)
    const radioName = `${context}-priority-radio`;

    // Erstellt die 5 Kästchen (1=Niedrig bis 5=Hoch)
    for (let i = 1; i <= 5; i++) {
        const isChecked = i === currentPriority;
        // Nutzt das Label/Input Pattern für die gestylten Kästchen (siehe CSS in index.html)
        const optionHtml = `
            <label class="priority-option-label">
                <input type="radio" name="${radioName}" value="${i}" ${isChecked ? 'checked' : ''}>
                <span class="priority-toggle">${i}</span>
            </label>
        `;
        selector.innerHTML += optionHtml;
    }
}
