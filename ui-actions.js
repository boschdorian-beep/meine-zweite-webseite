// js/ui-actions.js
import { state } from './state.js';
import { WEEKDAYS } from './config.js';
import { toggleTaskCompleted, handleTaskDrop, updateTaskDetails, getOriginalTotalDuration, recalculateSchedule } from './scheduler.js';
import { clearAllCompletedTasks, deleteTaskDefinition, saveSettings, saveTaskDefinition } from './database.js';
import { renderApp, renderSettingsModal } from './ui-render.js';
import { parseDateString, calculateDecimalHours } from './utils.js';
import { searchUsers, getUsersByIds } from './collaboration.js';
 
// Temporärer Zustand für Modals.
let modalState = {
    tempSettings: {},
    editModal: {
        assignedUsers: [], // Array von Profil-Objekten {uid, email, displayName, shortName}
        ownerId: null
    }
};

// --- Task Interactions ---

/**
 * Hängt Event-Listener an die Filterleiste.
 */
export function attachFilterInteractions() {
    const filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;

    // Event-Delegation für die gesamte Leiste
    // Wir verwenden 'change' für Checkboxen/Radios.
    // Wichtig: Listener entfernen, um Doppelungen zu vermeiden, falls die Funktion mehrfach aufgerufen wird.
    // Wir verwenden benannte Funktionen, um removeEventListener korrekt nutzen zu können.
    filterBar.removeEventListener('change', handleFilterChange);
    filterBar.addEventListener('change', handleFilterChange);

    // "Filter löschen"-Button
    const clearBtn = document.getElementById('clear-filters-btn');
    clearBtn.removeEventListener('click', handleClearFilters);
    clearBtn.addEventListener('click', handleClearFilters);
}

// Benannte Funktion für den Filter-Change-Listener
async function handleFilterChange(event) {
    const target = event.target;

    // GEÄNDERT: Orts-Filter (Checkboxes)
    if (target.matches('.location-filter-checkbox')) {
        const selectedLocations = Array.from(document.querySelectorAll('.location-filter-checkbox:checked')).map(cb => cb.value);
        // Nutzt das Array prioritizedLocations (siehe state.js)
        state.filters.prioritizedLocations = selectedLocations;
    }

    // Benutzer-Filter (Checkboxes)
    if (target.matches('.user-filter-checkbox')) {
        const selectedUids = Array.from(document.querySelectorAll('.user-filter-checkbox:checked')).map(cb => cb.value);
        state.filters.prioritizedUserIds = selectedUids;
    }

    // Nach jeder Änderung neu berechnen und rendern
    recalculateSchedule();
    await renderApp();
}

// Benannte Funktion für den Clear-Filters-Listener
async function handleClearFilters() {
    // GEÄNDERT: prioritizedLocations zurücksetzen
    state.filters.prioritizedLocations = [];
    state.filters.prioritizedUserIds = [];
    
    // Neu berechnen und rendern
    recalculateSchedule();
    await renderApp();
}


export function attachTaskInteractions() {
    // Checkboxen
    document.querySelectorAll('.task-checkbox').forEach(checkbox => {
        checkbox.removeEventListener('change', handleCheckboxChange);
        checkbox.addEventListener('change', handleCheckboxChange);
    });

    // Drag & Drop (Unverändert)
    document.querySelectorAll('.task-item').forEach(taskElement => {
        taskElement.removeEventListener('dragstart', handleDragStart);
        taskElement.removeEventListener('dragend', handleDragEnd);

        if (taskElement.draggable) {
            taskElement.addEventListener('dragstart', handleDragStart);
            taskElement.addEventListener('dragend', handleDragEnd);
        }
    });

    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.removeEventListener('dragover', handleDragOver);
        zone.removeEventListener('dragleave', handleDragLeaveZone);
        zone.removeEventListener('drop', handleDrop);

        // Drop Zones nur aktivieren, wenn Manuell Sortieren AN ist
        if (!state.settings.autoPriority) {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('dragleave', handleDragLeaveZone);
            zone.addEventListener('drop', handleDrop);
        }
    });

    // Klick auf Aufgabe (Öffnet Edit Modal)
    document.querySelectorAll('.task-content').forEach(content => {
        content.removeEventListener('click', handleTaskContentClick);
        content.addEventListener('click', handleTaskContentClick);
    });

    // Klick auf Notiz-Icon (Toggle Notizen)
    document.querySelectorAll('.toggle-notes-btn').forEach(toggle => {
        toggle.removeEventListener('click', handleNotesToggle);
        toggle.addEventListener('click', handleNotesToggle);
    });
}

// Toggle für Notizenanzeige (Unverändert)
function handleNotesToggle(event) {
    // Verhindere, dass der Klick das Edit-Modal öffnet
    event.stopPropagation(); 
    const taskElement = event.target.closest('.task-item');
    const notesContent = taskElement.querySelector('.task-notes-content');
    const button = event.target.closest('.toggle-notes-btn');

    if (notesContent && button) {
        const isVisible = !notesContent.classList.contains('hidden');
        
        if (isVisible) {
            notesContent.classList.add('hidden');
            button.innerHTML = '<i class="fas fa-chevron-down text-gray-500"></i>'; // Pfeil nach unten
        } else {
            notesContent.classList.remove('hidden');
            button.innerHTML = '<i class="fas fa-chevron-up text-gray-500"></i>'; // Pfeil nach oben
        }
    }
}

async function handleCheckboxChange(event) {
    // Verhindere, dass der Klick das Edit-Modal öffnet, wenn auf die Checkbox geklickt wird
    event.stopPropagation();
    const taskId = event.target.dataset.taskId;
    await toggleTaskCompleted(taskId, event.target.checked);
    await renderApp();
}

// --- Drag and Drop Handlers (Unverändert) ---

function handleDragStart(e) {
    // Verhindere Drag, wenn auf interaktive Elemente (Button, Input) geklickt wird
    if (e.target.closest('button') || e.target.closest('input')) {
        e.preventDefault();
        return;
    }
    
    state.draggedItem = e.currentTarget; // Nutze currentTarget, falls auf ein Kind-Element geklickt wurde
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', state.draggedItem.dataset.taskId);
    setTimeout(() => {
        state.draggedItem.classList.add('dragging');
    }, 0);
}

function handleDragOver(e) {
    e.preventDefault();
    const zone = e.currentTarget;
    zone.classList.add('drag-over-zone');

    const targetItem = e.target.closest('.task-item');
    document.querySelectorAll('.task-item').forEach(item => {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
    });

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
    // Prüft, ob der Cursor die Zone wirklich verlassen hat
    if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over-zone');
    }
}

async function handleDrop(e) {
    e.preventDefault();
    if (!state.draggedItem) return;

    const dropTargetItem = e.target.closest('.task-item');
    const draggedTaskId = state.draggedItem.dataset.taskId;

    let dropTargetTaskId = null;
    let insertBefore = false;

    // Bestimme Ziel und Position (vor oder nach dem Ziel)
    if (dropTargetItem && dropTargetItem !== state.draggedItem) {
        dropTargetTaskId = dropTargetItem.dataset.taskId;
        const rect = dropTargetItem.getBoundingClientRect();
        const offsetY = e.clientY - rect.top;
        insertBefore = offsetY < rect.height / 2;
    }

    // Bestimme das neue Datum basierend auf der Zone
    let newDate = null;
    const zone = e.currentTarget;
    const section = zone.closest('[data-date-offset]');
    if (section) {
        const offset = parseInt(section.dataset.dateOffset, 10);
        if (offset < 2) {
            // Heute oder Morgen
            newDate = new Date();
            newDate.setDate(newDate.getDate() + offset);
        }
        if (offset === 2) {
            // Zukunft: Versuche das Datum des Ziels zu übernehmen, falls vorhanden
            if (dropTargetItem) {
                 const targetScheduleId = dropTargetItem.dataset.scheduleId;
                 const targetScheduleItem = state.schedule.find(s => s.scheduleId === targetScheduleId);

                 if (targetScheduleItem && targetScheduleItem.plannedDate) {
                    newDate = parseDateString(targetScheduleItem.plannedDate);
                 }
            }
            // Fallback für Zukunft: Heute + 2 Tage
            if (!newDate) {
                newDate = new Date();
                newDate.setDate(newDate.getDate() + 2);
            }
        }
    }

    // Rufe die Scheduler-Logik auf
    // handleTaskDrop ist in scheduler.js definiert
    const success = await handleTaskDrop(draggedTaskId, dropTargetTaskId, insertBefore, newDate);

    if (success) {
        await renderApp();
    }
    handleDragEnd();
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


// --- Edit Modal Actions (Stark überarbeitet) ---

function handleTaskContentClick(event) {
    // Verhindert Klick, wenn die Aufgabe erledigt ist
    if (event.target.closest('.task-item').classList.contains('completed')) return;

    // Verhindert Klick, wenn auf interaktive Elemente innerhalb des Contents geklickt wird
    if (event.target.closest('button') || event.target.closest('input')) {
        return;
    }

    const taskId = event.target.closest('.task-item').dataset.taskId;
    openEditModal(taskId);
}

// Hilfsfunktion zur Umrechnung von Dezimalstunden in H und M
const setDurationInputs = (durationDecimal, inputH, inputM) => {
    // Sicherstellen, dass durationDecimal eine Zahl ist
    const duration = parseFloat(durationDecimal) || 0;
    const totalMinutes = Math.round(duration * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    document.getElementById(inputH).value = hours;
    document.getElementById(inputM).value = minutes;
};

// Hilfsfunktion zum Umschalten der Eingabefelder basierend auf dem Typ
function toggleEditInputs(taskType) {
    document.querySelectorAll('.edit-inputs').forEach(el => el.classList.add('hidden'));

    if (taskType === 'Vorteil & Dauer') {
        document.getElementById('editVorteilDauerInputs').classList.remove('hidden');
    } else if (taskType === 'Deadline') {
        document.getElementById('editDeadlineInputs').classList.remove('hidden');
    } else if (taskType === 'Fixer Termin') {
        document.getElementById('editFixerTerminInputs').classList.remove('hidden');
    }
}

// Unterstützt Typänderung, Uhrzeit und nutzt generalisierte Kollaborations-UI
export async function openEditModal(taskId) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // 1. Modal-Zustand initialisieren
    modalState.editModal.ownerId = task.ownerId;
    modalState.editModal.assignedUsers = []; // Wird später geladen

    // 2. Basisdaten befüllen
    document.getElementById('edit-task-id').value = task.id;
    // Setze den Wert des <select> elements
    const typeSelect = document.getElementById('edit-task-type');
    typeSelect.value = task.type;
    
    document.getElementById('edit-description').value = task.description;
    document.getElementById('edit-notes').value = task.notes || '';
    document.getElementById('edit-location-select').value = task.location || '';

    // Typ-spezifische Felder befüllen. Wir befüllen alle, falls der Nutzer den Typ ändert.
    const duration = getOriginalTotalDuration(task);
    
    // Vorteil & Dauer
    setDurationInputs(duration, 'edit-estimated-duration-h', 'edit-estimated-duration-m');
    document.getElementById('edit-financial-benefit').value = task.financialBenefit || '';
    
    // Deadline
    document.getElementById('edit-deadline-date').value = task.deadlineDate || '';
    setDurationInputs(duration, 'edit-deadline-duration-h', 'edit-deadline-duration-m');
    
    // Fixer Termin
    document.getElementById('edit-fixed-date').value = task.fixedDate || '';
    // Befülle Uhrzeit
    document.getElementById('edit-fixed-time').value = task.fixedTime || '';
    setDurationInputs(duration, 'edit-fixed-duration-h', 'edit-fixed-duration-m');

    // Zeige die richtigen Eingabefelder
    toggleEditInputs(task.type);

    // Event Listener für Typänderung
    // onchange ersetzt bestehende Listener.
    typeSelect.onchange = (event) => {
        toggleEditInputs(event.target.value);
    };

    // 3. Zeige das Modal
    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Initialisiere die Kollaborations-UI
    setupCollaborationUI('edit');
    
    // Initial leere Liste rendern, während Profile laden
    renderAssignedUsers('edit'); 

    // 4. Lade zugewiesene Benutzerprofile (async)
    const assignedUids = task.assignedTo || [];
    const userProfiles = await getUsersByIds(assignedUids);

    // Konvertiere Map in Array für den Modal-Zustand
    modalState.editModal.assignedUsers = assignedUids.map(uid => 
        userProfiles[uid] || { uid: uid, email: `Lade... (${uid.substring(0, 6)})`, displayName: 'Unbekannt', shortName: '??' }
    );
    
    // Rendere die Liste der Zuweisungen erneut mit geladenen Daten
    renderAssignedUsers('edit');
}


// --- Collaboration UI (Generalisiert für Create und Edit) ---

/**
 * Initialisiert die Kollaborations-UI für das "Neue Aufgabe"-Formular (Kontext 'create').
 */
export function initializeCollaborationUI() {
    setupCollaborationUI('create');
    // Rendere die initiale Liste (normalerweise nur der aktuelle Benutzer, falls geladen)
    renderAssignedUsers('create');
}

/**
 * Holt die relevanten UI-Elemente und den Zustand basierend auf dem Kontext.
 */
function getCollaborationContext(context) {
    if (context === 'edit') {
        return {
            assignmentState: modalState.editModal.assignedUsers,
            // Wichtig: ownerId aus dem modalState holen, da er sich ändern kann
            ownerId: modalState.editModal.ownerId, 
            searchInput: document.getElementById('user-search-input-edit'),
            searchResults: document.getElementById('user-search-results-edit'),
            assignedList: document.getElementById('assigned-users-list-edit')
        };
    } else if (context === 'create') {
        return {
            assignmentState: state.newTaskAssignment,
            ownerId: state.user ? state.user.uid : null, // Ersteller ist der Besitzer
            searchInput: document.getElementById('user-search-input-create'),
            searchResults: document.getElementById('user-search-results-create'),
            assignedList: document.getElementById('assigned-users-list-create')
        };
    }
    return null;
}

/**
 * Generalisierte Funktion zum Einrichten der UI Events (Suche, Hinzufügen/Entfernen).
 */
function setupCollaborationUI(context) {
    const ctx = getCollaborationContext(context);
    if (!ctx || !ctx.searchInput) return;

    // Sucheingabe (Debounced)
    let timeout = null;
    if (context === 'edit') {
        ctx.searchInput.value = ''; // Input leeren nur beim Öffnen des Edit-Modals
    }
    ctx.searchResults.classList.add('hidden'); // Ergebnisse verstecken

    // Listener für Sucheingabe
    const handleInput = () => {
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            const results = await searchUsers(ctx.searchInput.value);
            renderSearchResults(context, results);
        }, 300);
    };
    
    // Setze den Listener (oninput ersetzt bestehende Listener)
    ctx.searchInput.oninput = handleInput;

    // Klick auf Suchergebnis (Hinzufügen)
    // onclick ersetzt bestehende Listener
    ctx.searchResults.onclick = (event) => {
        const userElement = event.target.closest('.user-search-item');
        if (userElement) {
            const userProfile = JSON.parse(userElement.dataset.profile);
            addUserToAssignment(context, userProfile);
            // UI aufräumen
            ctx.searchInput.value = '';
            ctx.searchResults.classList.add('hidden');
        }
    };

    // Klick auf Zuweisungsliste (Entfernen)
    ctx.assignedList.onclick = (event) => {
        // Nutze closest, falls auf das 'x' Icon statt den Button geklickt wird
        const removeBtn = event.target.closest('.remove-assignment-btn');
        if (removeBtn) {
            const uid = removeBtn.dataset.uid;
            removeUserFromAssignment(context, uid);
        }
    };
}

// Fügt Benutzer zum Zustand des jeweiligen Kontexts hinzu
function addUserToAssignment(context, userProfile) {
    const ctx = getCollaborationContext(context);
    
    // Prüfe, ob bereits vorhanden
    if (!ctx.assignmentState.find(u => u.uid === userProfile.uid)) {
        ctx.assignmentState.push(userProfile);
        renderAssignedUsers(context);
    }
}

// Entfernt Benutzer aus dem Zustand. Behandelt Besitzerwechsel.
function removeUserFromAssignment(context, uid) {
    const ctx = getCollaborationContext(context);
    // Wichtig: ownerId aus dem aktuellen Kontext holen, da er sich im Edit-Modus ändern kann.
    const ownerId = ctx.ownerId; 

    // Regel 1 & 2: Besitzerwechsel / Selbstentfernung
    if (uid === ownerId) {
        // Besitzer versucht sich selbst zu entfernen

        // Fall A: Es gibt andere Zugewiesene
        if (ctx.assignmentState.length > 1) {
            if (context === 'edit') {
                // Im Edit-Modus: Fordere zur Bestätigung des neuen Besitzers auf
                const potentialOwners = ctx.assignmentState.filter(u => u.uid !== ownerId);
                // Wähle den ersten anderen Benutzer als neuen Besitzer (deterministisch)
                const newOwner = potentialOwners[0];
                
                if (confirm(`Du bist der Besitzer dieser Aufgabe. Wenn du dich entfernst, wird die Besitzerschaft an ${newOwner.displayName} übertragen. Fortfahren?`)) {
                    // WICHTIG: Aktualisiere den OwnerId im Modal State
                    modalState.editModal.ownerId = newOwner.uid;
                    // Entferne den alten Besitzer
                    const index = ctx.assignmentState.findIndex(u => u.uid === uid);
                    if (index > -1) ctx.assignmentState.splice(index, 1);
                } else {
                    return; // Abbrechen
                }

            } else {
                // Im Create-Modus: Man kann sich selbst nicht entfernen (der Button wird ausgeblendet, aber zur Sicherheit hier prüfen)
                // Der Ersteller muss zugewiesen sein.
                return; 
            }

        } else {
            // Fall B: Besitzer ist alleine zugewiesen
            alert("Mindestens ein Teammitglied muss zugewiesen bleiben.");
            return;
        }
    } else {
        // Regel 3: Nur der Besitzer darf andere entfernen (außer man entfernt sich selbst)
        // state.user muss existieren, um die Prüfung durchzuführen
        if (state.user && state.user.uid !== ownerId && state.user.uid !== uid) {
            alert("Nur der Besitzer der Aufgabe kann andere Teammitglieder entfernen.");
            return;
        }

        // Standard-Entfernung
        const index = ctx.assignmentState.findIndex(u => u.uid === uid);
        if (index > -1) ctx.assignmentState.splice(index, 1);
    }

    renderAssignedUsers(context);
}

// Rendert die Suchergebnisse im jeweiligen Kontext
function renderSearchResults(context, results) {
    const ctx = getCollaborationContext(context);
    const searchResults = ctx.searchResults;
    searchResults.innerHTML = '';
    
    if (results.length === 0 && ctx.searchInput.value.length > 0) {
        searchResults.innerHTML = '<div class="p-3 text-gray-500">Keine Benutzer gefunden.</div>';
        searchResults.classList.remove('hidden');
        return;
    }

    let count = 0;
    results.forEach(user => {
        // Nur anzeigen, wenn noch nicht zugewiesen
        if (!ctx.assignmentState.find(u => u.uid === user.uid)) {
            const item = document.createElement('div');
            item.className = 'p-3 hover:bg-gray-100 cursor-pointer user-search-item';
            // Speichere das gesamte Profil als JSON im data-Attribut
            item.dataset.profile = JSON.stringify(user);
            // Zeige Namen und E-Mail an
            item.innerHTML = `${user.displayName} <span class="text-sm text-gray-500">(${user.email})</span>`;
            searchResults.appendChild(item);
            count++;
        }
    });

    if (count > 0) {
        searchResults.classList.remove('hidden');
    } else {
        searchResults.classList.add('hidden');
    }
}


// Rendert die Liste der zugewiesenen Benutzer im jeweiligen Kontext
function renderAssignedUsers(context) {
    // Hole den aktualisierten Kontext, da sich ownerId geändert haben könnte
    const ctx = getCollaborationContext(context);
    if (!ctx || !ctx.assignedList) return;

    ctx.assignedList.innerHTML = '';
    // Wichtig: ownerId aus dem aktuellen Kontext holen.
    const ownerId = ctx.ownerId;

    // Sortiere: Besitzer zuerst, dann alphabetisch
    const sortedUsers = [...ctx.assignmentState].sort((a, b) => {
        if (a.uid === ownerId) return -1;
        if (b.uid === ownerId) return 1;
        return (a.displayName || a.email).localeCompare(b.displayName || b.email);
    });

    sortedUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'flex justify-between items-center bg-white p-2 rounded-lg shadow-sm';
        
        const isOwner = user.uid === ownerId;
        let roleText = isOwner ? '(Besitzer)' : '';
        if (context === 'create' && isOwner) roleText = '(Du)';

        // Prüfe, ob der aktuelle Benutzer entfernen darf
        let canRemove = false;
        if (context === 'create') {
             canRemove = !isOwner; // Man kann nur andere entfernen, nicht sich selbst
        } else {
            // Edit Modus Logik: Besitzer darf alle entfernen. Andere dürfen nur sich selbst entfernen.
            // Dies erlaubt auch, dass man sich selbst entfernt, wenn man Besitzer ist (wird in removeUserFromAssignment behandelt).
            canRemove = (state.user && state.user.uid === ownerId) || (state.user && state.user.uid === user.uid);
        }

        // Zeige Namen und E-Mail an
        // focus:outline-none für bessere Button UX
        item.innerHTML = `
            <span>${user.displayName || user.email} <span class="text-sm text-gray-500">${roleText}</span></span>
            ${canRemove ? `<button data-uid="${user.uid}" class="remove-assignment-btn text-red-500 hover:text-red-700 text-xl leading-none focus:outline-none" title="Entfernen">&times;</button>` : ''}
        `;
        ctx.assignedList.appendChild(item);
    });
}


export function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    // Modal-Zustand zurücksetzen
    modalState.editModal = { assignedUsers: [], ownerId: null };
    // UI Elemente leeren (nutzt generalisierte Funktion)
    const ctx = getCollaborationContext('edit');
    if (ctx) {
        if (ctx.searchInput) ctx.searchInput.value = '';
        if (ctx.searchResults) ctx.searchResults.classList.add('hidden');
    }
}

// Liest neue Felder (Typ, Besitzer, Uhrzeit) und rechnet Zeit um
export async function handleSaveEditedTask() {
    const taskId = document.getElementById('edit-task-id').value;
    // Lese den Typ aus dem <select> Element
    const type = document.getElementById('edit-task-type').value;
    const description = document.getElementById('edit-description').value.trim();

    if (!description) {
        alert("Beschreibung darf nicht leer sein.");
        return;
    }

    // Lese Zuweisungen, Notizen und Ort
    const assignedUids = modalState.editModal.assignedUsers.map(u => u.uid);
    const notes = document.getElementById('edit-notes').value.trim();
    const location = document.getElementById('edit-location-select').value;

    // Lese den (potenziell geänderten) Besitzer
    const ownerId = modalState.editModal.ownerId;

    const updatedDetails = {
        description: description,
        type: type, // Übergebe den Typ
        assignedTo: assignedUids,
        ownerId: ownerId, // Übergebe den Besitzer
        notes: notes || null,
        location: location || null
    };

    try {
        // Lese Stunden/Minuten und rechne um (für den aktuellen Typ)
        if (type === 'Vorteil & Dauer') {
            const hours = document.getElementById('edit-estimated-duration-h').value;
            const minutes = document.getElementById('edit-estimated-duration-m').value;
            updatedDetails.estimatedDuration = calculateDecimalHours(hours, minutes);
            updatedDetails.financialBenefit = document.getElementById('edit-financial-benefit').value.trim();
            
        } else if (type === 'Deadline') {
            const deadlineDate = document.getElementById('edit-deadline-date').value;
            if (!deadlineDate) throw new Error("Bitte gib ein Deadline Datum ein!");
            updatedDetails.deadlineDate = deadlineDate;

            const hours = document.getElementById('edit-deadline-duration-h').value;
            const minutes = document.getElementById('edit-deadline-duration-m').value;
            updatedDetails.deadlineDuration = calculateDecimalHours(hours, minutes);

        } else if (type === 'Fixer Termin') {
            const fixedDate = document.getElementById('edit-fixed-date').value;
            if (!fixedDate) throw new Error("Bitte gib ein Datum für den fixen Termin ein!");
            updatedDetails.fixedDate = fixedDate;

            // Lese Uhrzeit
            const fixedTime = document.getElementById('edit-fixed-time').value;
            updatedDetails.fixedTime = fixedTime || null;

            const hours = document.getElementById('edit-fixed-duration-h').value;
            const minutes = document.getElementById('edit-fixed-duration-m').value;
            updatedDetails.fixedDuration = calculateDecimalHours(hours, minutes);
        }

        // Rufe die Scheduler-Logik auf (async)
        await updateTaskDetails(taskId, updatedDetails);

        closeEditModal();
        await renderApp();

    } catch (error) {
        alert(error.message);
    }
}

export async function handleDeleteTask() {
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    let taskName = task ? task.description : "diese Aufgabe";

    if (confirm(`Möchtest du "${taskName}" wirklich löschen?`)) {
        // 1. Lösche in DB
        await deleteTaskDefinition(taskId);
        
        // 2. Update lokalen State (für Responsivität, der Listener wird dies bestätigen)
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        recalculateSchedule();

        closeEditModal();
        await renderApp();
    }
}

export async function handleClearCompleted() {
    if (confirm("Möchtest du wirklich alle erledigten Aufgaben endgültig löschen?")) {
        const completedTasks = state.tasks.filter(task => task.completed);
        const idsToDelete = completedTasks.map(t => t.id);
        
        // Lösche in DB (Der Listener wird das Update triggern)
        await clearAllCompletedTasks(idsToDelete);

        // Update lokalen State für Responsivität
        state.tasks = state.tasks.filter(task => !task.completed);
        recalculateSchedule();
        
        // Neu rendern
        await renderApp();
    }
}


// --- Settings Modal Actions ---

export function openModal() {
    // KORREKTUR: Wir sammeln ALLE Orte (aus Einstellungen und "verwaiste" aus Tasks)
    const allTaskLocations = [...new Set(state.tasks.map(t => t.location).filter(Boolean))];
    const allSettingLocations = state.settings.locations || [];
    const combinedLocations = [...new Set([...allSettingLocations, ...allTaskLocations])].sort();

    // Kopiere aktuelle Einstellungen in den temporären Zustand und füge die kombinierte Ortsliste hinzu
    modalState.tempSettings = JSON.parse(JSON.stringify(state.settings));
    modalState.tempSettings.locations = combinedLocations;

    renderSettingsModal(modalState.tempSettings); // Rendere mit der vollständigen Liste

    const modal = document.getElementById('settingsModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    attachModalEventListeners();
}

export function closeModal() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modalState.tempSettings = {};
}

export function updateAndGetSettingsFromModal() {
    modalState.tempSettings.calcPriority = document.getElementById('calcPriorityCheckbox').checked;

    // Lese die Orte aus dem temporären Zustand. Die Bearbeitung des tempSettings-Objekts
    // passiert direkt in den Event-Listenern (handleLocationAction).
    // Hier muss nichts extra gelesen werden, da das Objekt bereits aktuell ist.


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
            if (modalState.tempSettings.dailyTimeSlots) {
                modalState.tempSettings.dailyTimeSlots[dayName] = currentDaySlots;
            }
        }
    });

    return modalState.tempSettings;
}

function attachModalEventListeners() {
    const container = document.getElementById('dailyTimeslotsContainer');
    const settingsModal = document.getElementById('settingsModal');

    // Entferne alte Listener, um Doppelungen zu vermeiden
    container.removeEventListener('click', handleTimeslotAction);
    container.addEventListener('click', handleTimeslotAction);

    // Listener für die Ortsverwaltung
    settingsModal.removeEventListener('click', handleLocationClick);
    settingsModal.addEventListener('click', handleLocationClick);
    settingsModal.removeEventListener('change', handleLocationInputChange); // 'change' feuert bei Blur oder Enter
    settingsModal.addEventListener('change', handleLocationInputChange);
}

/**
 * Verarbeitet Klicks in der Ortsverwaltung (Hinzufügen/Löschen).
 * Arbeitet jetzt direkt mit dem globalen State und speichert automatisch.
 */
async function handleLocationClick(event) {
    const addBtn = event.target.closest('#add-location-btn');
    const removeBtn = event.target.closest('.remove-location-btn');

    if (addBtn) {
        event.preventDefault(); // Verhindert Form-Submission, falls vorhanden
        const input = document.getElementById('new-location-input');
        const newLocation = input.value.trim();
        if (newLocation && !state.settings.locations.includes(newLocation)) {
            state.settings.locations.push(newLocation);
            state.settings.locations.sort();
            input.value = '';
            
            // Automatisch speichern und UI aktualisieren
            await saveSettings(state.settings);
            recalculateSchedule();
            await renderApp();
            openModal(); // Modal neu öffnen, um den Zustand zu erhalten
        }
    }

    if (removeBtn) {
        event.preventDefault();
        const locationToRemove = removeBtn.dataset.location;
        if (confirm(`Möchtest du den Ort "${locationToRemove}" wirklich löschen? Er wird von allen Aufgaben entfernt.`)) {
            // 1. Ort aus den Einstellungen entfernen
            state.settings.locations = state.settings.locations.filter(loc => loc !== locationToRemove);

            // 2. Ort aus allen Tasks entfernen und diese für den DB-Update sammeln
            const tasksToUpdate = [];
            state.tasks.forEach(task => {
                if (task.location === locationToRemove) {
                    task.location = null;
                    tasksToUpdate.push(saveTaskDefinition(task));
                }
            });

            // 3. Alle Änderungen speichern
            await Promise.all([saveSettings(state.settings), ...tasksToUpdate]);
            recalculateSchedule(); // Wichtig, falls Filter aktiv waren
            await renderApp();
            openModal();
        }
    }
}

/**
 * Verarbeitet das Umbenennen eines Ortes.
 */
async function handleLocationInputChange(event) {
    const input = event.target;
    if (!input.matches('.location-name-input')) return;

    const originalLocation = input.dataset.originalLocation;
    const newLocation = input.value.trim();

    if (newLocation === originalLocation) return;

    if (newLocation) {
        // Prüfe, ob der neue Name bereits existiert
        if (state.settings.locations.includes(newLocation)) {
            alert(`Der Ort "${newLocation}" existiert bereits. Bitte wähle einen anderen Namen.`);
            input.value = originalLocation;
            return;
        }
        
        if (confirm(`Möchtest du den Ort "${originalLocation}" in "${newLocation}" umbenennen? Dies wird für alle Aufgaben übernommen.`)) {
            // Logik zum Umbenennen und Speichern
            await renameLocationInStateAndDb(originalLocation, newLocation);
            recalculateSchedule();
            await renderApp();
            openModal();
        } else {
            // Zurücksetzen, wenn der Benutzer abbricht
            input.value = originalLocation;
        }
    } else {
         // Wenn das Feld leer ist, zurücksetzen (Löschen erfolgt über den Button)
        input.value = originalLocation;
    }
}
 
function handleTimeslotAction(event) {
    // Finde den Button, der geklickt wurde (oder das Icon darin)
    const target = event.target.closest('button'); 
    if (!target) return;

    const day = target.dataset.day;
    if (!day) return;

    // Lese aktuelle Werte aus dem DOM, bevor Änderungen vorgenommen werden
    updateAndGetSettingsFromModal();

    if (!modalState.tempSettings.dailyTimeSlots[day]) {
        modalState.tempSettings.dailyTimeSlots[day] = [];
    }

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
        // Stellt einen Standard-Slot wieder her
        modalState.tempSettings.dailyTimeSlots[day] = [{ id: `ts-${Date.now()}`, start: "09:00", end: "17:00" }];
    }

    // Rendere das Modal neu mit den aktualisierten temporären Einstellungen
    renderSettingsModal(modalState.tempSettings);
}

/**
 * Hilfsfunktion, die die gesamte Logik zum Umbenennen eines Ortes kapselt.
 */
async function renameLocationInStateAndDb(oldName, newName) {
    // 1. Update der zentralen Ortsliste in den Einstellungen
    const locationIndex = state.settings.locations.indexOf(oldName);
    if (locationIndex > -1) {
        state.settings.locations[locationIndex] = newName;
    } else {
        // Wenn der alte Ort ein "verwaister" Ort war (nur in Tasks, nicht in Settings), füge den neuen hinzu
        state.settings.locations.push(newName);
    }
    // Entferne Duplikate (falls newName bereits existierte, was aber durch UI verhindert wird) und sortiere
    state.settings.locations = [...new Set(state.settings.locations)].sort();

    // 2. Alle Tasks durchgehen und den Ort aktualisieren
    const tasksToUpdate = [];
    state.tasks.forEach(task => {
        if (task.location === oldName) {
            task.location = newName;
            tasksToUpdate.push(saveTaskDefinition(task)); // Sammle die Speicher-Promises
        }
    });

    // 3. Alle Änderungen parallel in die DB schreiben
    await Promise.all([saveSettings(state.settings), ...tasksToUpdate]);
}

export function setActiveTaskType(button) {
    // Styling der Buttons (angepasst an das neue Design mit Primärfarbe)
    document.querySelectorAll('.task-type-btn').forEach(btn => {
        btn.classList.remove('bg-primary', 'text-white');
        btn.classList.add('text-gray-700', 'hover:bg-gray-300');
    });
    button.classList.add('bg-primary', 'text-white');
    button.classList.remove('text-gray-700', 'hover:bg-gray-300');

    state.activeTaskType = button.dataset.type;

    document.querySelectorAll('.task-inputs').forEach(input => input.classList.add('hidden'));
    if (state.activeTaskType === 'Vorteil & Dauer') {
        document.getElementById('vorteilDauerInputs').classList.remove('hidden');
    } else if (state.activeTaskType === 'Deadline') {
        document.getElementById('deadlineInputs').classList.remove('hidden');
    } else if (state.activeTaskType === 'Fixer Termin') {
        document.getElementById('fixerTerminInputs').classList.remove('hidden');
    }
}

// Setzt neue Felder zurück, inkl. Zuweisungen und Uhrzeit
export function clearInputs() {
    document.getElementById('newTaskInput').value = '';
    document.getElementById('newNotesInput').value = ''; 
    document.getElementById('newLocationSelect').value = ''; // Dropdown zurücksetzen

    // NEU: Zuweisungen zurücksetzen (Standardmäßig nur der aktuelle Benutzer)
    state.newTaskAssignment.length = 0; // Leert das Array
    if (state.userProfile) {
        state.newTaskAssignment.push(state.userProfile);
    }
    // Rendere die Zuweisungsliste neu
    renderAssignedUsers('create');
    // Suchfeld leeren
    const ctx = getCollaborationContext('create');
    if (ctx && ctx.searchInput) {
        ctx.searchInput.value = '';
        if (ctx.searchResults) ctx.searchResults.classList.add('hidden');
    }

    // Setze Stunden auf 1, Minuten auf 0 (Standard)
    document.getElementById('estimated-duration-h').value = '1';
    document.getElementById('estimated-duration-m').value = '0';
    document.getElementById('monthly-financial-benefit').value = '';
    
    document.getElementById('deadline-date').value = '';
    document.getElementById('deadline-duration-h').value = '1';
    document.getElementById('deadline-duration-m').value = '0';

    document.getElementById('fixed-date').value = '';
    document.getElementById('fixed-time').value = ''; // NEU: Reset Uhrzeit
    document.getElementById('fixed-duration-h').value = '1';
    document.getElementById('fixed-duration-m').value = '0';
    
    document.getElementById('newTaskInput').focus();
}
