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
    // NEU: Checkbox für exakte Zeiten
    showExactTimesCheckbox: document.getElementById('showExactTimesCheckbox'),
    // Datumsanzeige
    todayDateDisplay: document.getElementById('todayDateDisplay'),
    tomorrowDateDisplay: document.getElementById('tomorrowDateDisplay'),
    // Input für Textlänge in Einstellungen
    taskTruncationLengthInput: document.getElementById('taskTruncationLengthInput'),
};
// Elemente für die Filterleiste
// ... (Unverändert)

export async function renderApp() {
    // ... (Unverändert)
}

// ... (updateDateDisplays, populateLocationDropdowns, renderFilterBar, isItemPrioritized, renderSchedule, renderCompletedTasks, truncateText unverändert)


/**
 * Erstellt das DOM Element für ein aktives Schedule Item.
 * GEÄNDERT: Neues Layout für Ausrichtung, zeigt berechnete Zeiten und Deadline Time an.
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

    // --- Elemente definieren ---

    // 1. Ortsmarkierung
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
        // GEÄNDERT: ml-2 hinzugefügt für etwas Abstand
        notesToggle = `<button class="toggle-notes-btn ml-2 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none" title="Notizen anzeigen/verbergen">
                            <i class="fas fa-chevron-down text-gray-500"></i>
                       </button>`;
        // Inhalt (versteckt) - wird später als Element hinzugefügt für Sicherheit (textContent)
        notesContentHtml = `<div class="task-notes-content hidden w-full"></div>`;
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
    // Voller Text (Standardmäßig versteckt, nur wenn gekürzt)
    let fullDescriptionHtml = '';

    if (isTruncated) {
        // Button zum Umschalten
        // GEÄNDERT: ml-2 hinzugefügt für etwas Abstand
        descriptionToggle = `<button class="toggle-description-btn ml-2 cursor-pointer hover:text-gray-700 transition duration-150 focus:outline-none" title="Vollständigen Text anzeigen">
                                <i class="fas fa-chevron-down text-gray-500"></i>
                             </button>`;
        // Der vollständige Text wird später sicher eingefügt. Suffix wird hier als Text hinzugefügt.
        fullDescriptionHtml = `<div class="task-description-full hidden w-full">${suffix}</div>`;
    }


    // --- Metadaten Elemente ---

    // Dauer
    const duration = getScheduleItemDuration(item);
    // GEÄNDERT: Styling angepasst
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

    // Uhrzeit für Fixe Termine oder NEU: Berechnete Zeiten
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

    // Deadline Info (Datum und NEU: Uhrzeit)
    let deadlineInfo = '';
    if (item.deadlineDate) {
        deadlineInfo = `<span class="text-sm text-red-500">Deadline: ${formatDateLocalized(parseDateString(item.deadlineDate))}`;
        if (item.deadlineTime) {
            deadlineInfo += ` ${item.deadlineTime}`;
        }
        deadlineInfo += `</span>`;
    }


    // Finales HTML Layout (Komplett neu strukturiert für Ausrichtung)
    // Checkbox benötigt mt-0.5 für vertikale Ausrichtung mit dem Text (wegen items-start im .task-left-col).
    itemElement.innerHTML = `
        ${locationMarker}
        
        <div class="task-left-col">
            <input type="checkbox" data-task-id="${item.taskId}" class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer mt-0.5">
            
            <div class="task-content">
                <div class="task-content-header">
                    ${descriptionContentHtml}
                    ${descriptionToggle}
                    ${notesToggle}
                </div>
                ${fullDescriptionHtml}
                ${notesContentHtml}
            </div>
        </div>

        <div class="task-right-col">
            ${timeDisplay}
            ${priorityArrowsHtml}
            ${durationDisplay}
            ${benefitDisplay}
            ${deadlineInfo}
            ${plannedDateDisplay}
            ${assignedUsersDisplay}
        </div>
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
 * GEÄNDERT: Angepasst an das neue Layout.
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

    // Dauer (nutzt neue Formatierung)
    const duration = getOriginalTotalDuration(task);
    const durationDisplay = duration > 0 ? `<span class="text-sm text-gray-500">(${formatHoursMinutes(duration)})</span>` : '';

    // Textkürzung auch hier anwenden (ohne Toggle, da erledigt)
    const truncationLength = state.settings.taskTruncationLength || 30;
    // Bei erledigten Aufgaben gibt es keine Teile mehr.
    const { truncated } = truncateText(task.description, truncationLength);

    // GEÄNDERT: Nutzt das neue Spalten-Layout
    taskElement.innerHTML = `
        ${locationMarker}
        <div class="task-left-col">
            <input type="checkbox" data-task-id="${task.id}" checked class="task-checkbox form-checkbox h-5 w-5 text-green-600 rounded mr-3 cursor-pointer">
            <div class="task-content">
                 <span class="text-gray-800 text-lg">${truncated}</span>
            </div>
        </div>
        <div class="task-right-col">
            ${priorityDisplayHtml}
            ${durationDisplay}
            ${assignedUsersDisplay}
        </div>
    `;
    return taskElement;
}


// ... (updateAvailableTimeDisplays unverändert)

export function renderSettingsModal(settingsToRender) {
     if (!settingsToRender || !settingsToRender.dailyTimeSlots) return;
    elements.calcPriorityCheckbox.checked = settingsToRender.calcPriority;

    // NEU: Befülle die Checkbox für die exakte Zeitanzeige
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

// ... (renderLocationsManagement, renderDailyTimeslots, createTimeslotElement, renderPrioritySelector unverändert)
