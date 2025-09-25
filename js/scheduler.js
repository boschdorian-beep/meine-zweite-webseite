// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
import { saveTaskDefinition } from './database.js';

const MAX_SCHEDULING_HORIZON = 365;
// Epsilon wird für Fließkommavergleiche benötigt (z.B. ob noch Restzeit übrig ist)
const EPSILON = 0.0001; // Präzise genug für Minuten-Berechnung

export function getScheduleItemDuration(item) {
    return parseFloat(item.scheduledDuration) || 0;
}

export function getOriginalTotalDuration(task) {
    if (task.type === 'Vorteil & Dauer') return parseFloat(task.estimatedDuration) || 0;
    if (task.type === 'Deadline') return parseFloat(task.deadlineDuration) || 0;
    if (task.type === 'Fixer Termin') return parseFloat(task.fixedDuration) || 0;
    return 0;
}

/**
 * GEÄNDERT: Berechnet die verfügbaren Stunden für einen Tag.
 * Wenn es Heute ist, wird die bereits vergangene Zeit berücksichtigt.
 */
export function getDailyAvailableHours(date) {
    const dayName = getDayOfWeek(date);
     if (!state.settings || !state.settings.dailyTimeSlots) {
        return 0;
    }
    const slots = state.settings.dailyTimeSlots[dayName];
    if (!slots || slots.length === 0) return 0;

    // Prüfe, ob das Datum Heute ist
    const today = normalizeDate();
    const isToday = date.getTime() === today.getTime();
    const now = new Date();
    // Berechne die aktuelle Zeit in Minuten seit Mitternacht
    const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

    let totalHours = 0;
    slots.forEach(slot => {
        const [startHour, startMinute] = slot.start.split(':').map(Number);
        const [endHour, endMinute] = slot.end.split(':').map(Number);
        let startTotalMinutes = startHour * 60 + startMinute;
        const endTotalMinutes = endHour * 60 + endMinute;

        if (isToday) {
            // Wenn das Zeitfenster bereits begonnen hat, setze den Start auf die aktuelle Zeit
            if (currentTotalMinutes > startTotalMinutes) {
                startTotalMinutes = currentTotalMinutes;
            }
        }

        // Wenn die Startzeit (entweder original oder angepasst) nach der Endzeit liegt, ist das Fenster vorbei oder ungültig.
        if (endTotalMinutes > startTotalMinutes) {
             totalHours += (endTotalMinutes - startTotalMinutes) / 60;
        }
    });
    
    return totalHours;
}

function getConsumedHoursForDay(date, currentSchedule) {
    const dateStr = formatDateToYYYYMMDD(date);
    return currentSchedule.reduce((sum, item) => {
        if (item.plannedDate !== dateStr) {
            return sum;
        }
        return sum + getScheduleItemDuration(item);
    }, 0);
}

// GEÄNDERT: Sortierlogik berücksichtigt jetzt Uhrzeiten bei Fixen Terminen.
export function sortTasksByPriority(taskA, taskB) {
    const getBenefitPerHour = (task) => {
        const benefit = parseFloat(task.financialBenefit) || 0;
        const duration = getOriginalTotalDuration(task);
        return (benefit > 0 && duration > 0) ? (benefit / duration) : 0;
    };

    // Regel 1: Fixe Termine immer zuerst
    if (taskA.type === 'Fixer Termin' && taskB.type !== 'Fixer Termin') return -1;
    if (taskB.type === 'Fixer Termin' && taskA.type !== 'Fixer Termin') return 1;

    // Regel 2: Deadlines vor Vorteilsaufgaben
    if (taskA.type === 'Deadline' && taskB.type !== 'Deadline') return -1;
    if (taskB.type === 'Deadline' && taskA.type !== 'Deadline') return 1;

     // Regel 3: Bei gleichen Typen (Fix/Deadline) nach Datum sortieren
     if (taskA.type === taskB.type && (taskA.type === 'Fixer Termin' || taskA.type === 'Deadline')) {
         // Nutze das temporär berechnete Plandatum für die Sortierung
         if (taskA.tempPlannedDate && taskB.tempPlannedDate) {
            const dateA = parseDateString(taskA.tempPlannedDate);
            const dateB = parseDateString(taskB.tempPlannedDate);
            if (dateA && dateB) {
                // NEU: Wenn Datum gleich ist und Fixer Termin, sortiere nach Uhrzeit
                if (dateA.getTime() === dateB.getTime() && taskA.type === 'Fixer Termin') {
                    const timeA = taskA.fixedTime || "00:00";
                    const timeB = taskB.fixedTime || "00:00";
                    return timeA.localeCompare(timeB);
                }
                return dateA.getTime() - dateB.getTime();
            }
         }
         return 0;
    }

    // Regel 4: Wenn aktiviert, nach finanziellem Vorteil pro Stunde sortieren
    if (state.settings.calcPriority) {
        const benefitA = getBenefitPerHour(taskA);
        const benefitB = getBenefitPerHour(taskB);

        if (benefitA > 0 || benefitB > 0) {
            return benefitB - benefitA; // Höherer Vorteil zuerst
        }
    }
    // Standard-Fallback (keine Änderung der Reihenfolge)
    return 0;
}

/**
 * Plant flexible Aufgaben und erstellt Schedule Items.
 */
function scheduleFlexibleTask(task, currentSchedule) {
    const totalRequiredDuration = getOriginalTotalDuration(task);

    // Erstelle ein Basis-Schedule-Item mit allen relevanten Daten
    const baseItem = {
        taskId: task.id,
        description: task.description,
        type: task.type,
        financialBenefit: task.financialBenefit,
        estimatedDuration: task.estimatedDuration, // Wichtig für die Berechnung des Vorteils/h
        isManuallyScheduled: false,
        assignedTo: task.assignedTo,
        notes: task.notes,
        location: task.location
    };

    // Behandle Aufgaben ohne Dauer (sofort geplant für Heute)
    if (totalRequiredDuration <= EPSILON) {
        currentSchedule.push({
            ...baseItem,
            scheduleId: `sched-${task.id}-${Date.now()}-1`,
            plannedDate: formatDateToYYYYMMDD(normalizeDate()),
            scheduledDuration: 0
        });
        return;
    }

    let remainingDuration = totalRequiredDuration;
    const startDate = normalizeDate();
    let currentDate = normalizeDate(startDate);
    let partIndex = 1;

    // Schleife läuft, bis die gesamte Dauer eingeplant ist
    while (remainingDuration > EPSILON) {

        // Sicherheitsabbruch, falls keine Kapazität gefunden wird
        const daysTried = (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysTried > MAX_SCHEDULING_HORIZON) {
             currentSchedule.push({
                ...baseItem,
                scheduleId: `sched-${task.id}-${Date.now()}-UNSCHEDULED`,
                plannedDate: null,
                scheduledDuration: remainingDuration,
                description: `${task.description} (Nicht planbar - Keine Kapazität)`
            });
            return;
        }

        // Berechne verfügbare Zeit am aktuellen Tag
        const consumedHours = getConsumedHoursForDay(currentDate, currentSchedule);
        // WICHTIG: getDailyAvailableHours berücksichtigt jetzt die aktuelle Uhrzeit, falls currentDate Heute ist.
        const availableToday = getDailyAvailableHours(currentDate) - consumedHours;

        // Wenn heute nichts mehr frei ist, gehe zum nächsten Tag
        if (availableToday <= EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        // Berechne, wie viel wir heute einplanen können
        const durationForPart = Math.min(remainingDuration, availableToday);

        const newItem = {
            ...baseItem,
            scheduleId: `sched-${task.id}-${Date.now()}-${partIndex}`,
            plannedDate: formatDateToYYYYMMDD(currentDate),
            scheduledDuration: durationForPart
        };

        // Füge "(Teil X)" hinzu, wenn die Aufgabe aufgeteilt wurde
        if (remainingDuration > durationForPart + EPSILON || partIndex > 1) {
             newItem.description = `${task.description} (Teil ${partIndex})`;
        }

        currentSchedule.push(newItem);
        remainingDuration -= durationForPart;
        partIndex++;

        // Wenn noch Restzeit übrig ist, gehe zum nächsten Tag für den nächsten Teil
        // Nur wenn der aktuelle Tag voll ausgelastet wurde
        if (remainingDuration > EPSILON && (availableToday - durationForPart) <= EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
}

/**
 * Berechnet das Zieldatum für fixe Aufgaben (Deadlines, Fixe Termine, Manuell Geplant).
 * (Logik unverändert)
 */
function calculateFixedTaskDates(tasks) {
    const today = normalizeDate();

    tasks.forEach(task => {
        const duration = getOriginalTotalDuration(task);

        // Fall 1: Manuell gepinnt (hat höchste Priorität)
        if (task.isManuallyScheduled && task.manualDate) {
             const manualDate = parseDateString(task.manualDate);
             // Wenn manuelles Datum in der Vergangenheit liegt, plane für Heute
             if (manualDate && manualDate.getTime() < today.getTime()) {
                 task.tempPlannedDate = formatDateToYYYYMMDD(today);
             } else {
                task.tempPlannedDate = task.manualDate;
             }
             return;
        }

        // Fall 2: Fixer Termin
        if (task.type === 'Fixer Termin' && task.fixedDate) {
            const fixedDate = parseDateString(task.fixedDate);
            if (fixedDate) {
                 // Wenn Termin in der Vergangenheit liegt, plane für Heute (Überfällig)
                 if (fixedDate.getTime() < today.getTime()) {
                     task.tempPlannedDate = formatDateToYYYYMMDD(today);
                 } else {
                    task.tempPlannedDate = task.fixedDate;
                 }
            }
            return;
        }

        // Fall 3: Deadline (Versuche Puffer einzubauen)
        if (task.type === 'Deadline' && task.deadlineDate) {
            const originalDeadline = parseDateString(task.deadlineDate);
            if (originalDeadline) {
                // Berechne das späteste Startdatum (Deadline minus Dauer)
                const bufferedDeadline = new Date(originalDeadline);
                const bufferInDays = Math.ceil(duration);
                bufferedDeadline.setDate(originalDeadline.getDate() - bufferInDays);

                // Wenn das errechnete Startdatum bereits vorbei ist, aber die Deadline noch nicht, starte Heute.
                if (bufferedDeadline.getTime() < today.getTime() && originalDeadline.getTime() >= today.getTime()) {
                    task.tempPlannedDate = formatDateToYYYYMMDD(today);
                } else {
                    // Ansonsten nutze das errechnete Startdatum (kann auch in der Vergangenheit sein, wenn Deadline überschritten)
                    task.tempPlannedDate = formatDateToYYYYMMDD(bufferedDeadline);
                }
            }
            return;
        }
    });
    return tasks;
}

/**
 * Erstellt Schedule Items für fixe Aufgaben.
 * GEÄNDERT: Übernimmt Uhrzeit (fixedTime).
 */
function scheduleFixedTasks(tasks, currentSchedule) {
    tasks.forEach(task => {
        const newItem = {
            taskId: task.id,
            scheduleId: `sched-${task.id}-${Date.now()}-fixed`,
            description: task.description,
            type: task.type,
            plannedDate: task.tempPlannedDate || null,
            scheduledDuration: getOriginalTotalDuration(task),
            deadlineDate: task.deadlineDate,
            fixedDate: task.fixedDate,
            fixedTime: task.fixedTime || null, // NEU: Übernehme Uhrzeit
            isManuallyScheduled: !!task.isManuallyScheduled,
            assignedTo: task.assignedTo,
            notes: task.notes,
            location: task.location
        };
        currentSchedule.push(newItem);
    });
}


/**
 * Hauptfunktion zur Neuberechnung des Zeitplans.
 */
export function recalculateSchedule() {
    // 1. Vorbereitung
    if (state.settings.autoPriority) {
        state.tasks.forEach(t => {
            t.isManuallyScheduled = false;
            delete t.manualDate;
        });
    }
    const activeTasks = state.tasks.filter(t => !t.completed);

    // 2. Aufgaben in priorisierte und andere aufteilen
    // GEÄNDERT: Nutze prioritizedLocations (Array)
    const { prioritizedLocations, prioritizedUserIds } = state.filters;
    const isFilterActive = prioritizedLocations.length > 0 || prioritizedUserIds.length > 0;
    const currentUserId = state.user ? state.user.uid : null;

    let prioritizedTasks = [];
    let otherTasks = [];

    if (isFilterActive && currentUserId) {
        activeTasks.forEach(task => {
            const assignedTo = task.assignedTo || [];
            // Bedingung 1: Einer der Orte stimmt überein
            const matchesLocation = prioritizedLocations.length > 0 && prioritizedLocations.includes(task.location);
            
            // Bedingung 2: Alle ausgewählten User (plus der aktuelle) sind zugewiesen (Interpretation für "Gemeinsame Aufgaben")
            const requiredUsers = [...prioritizedUserIds, currentUserId];
            const matchesUsers = prioritizedUserIds.length > 0 && requiredUsers.every(uid => assignedTo.includes(uid));

            if (matchesLocation || matchesUsers) {
                prioritizedTasks.push(task);
            } else {
                otherTasks.push(task);
            }
        });
    } else {
        otherTasks = activeTasks;
    }

    // 3. Planungs-Subroutine
    const planTaskSet = (tasksToPlan, schedule) => {
        let fixed = tasksToPlan.filter(t => t.type === 'Fixer Termin' || t.type === 'Deadline' || t.isManuallyScheduled);
        let flexible = tasksToPlan.filter(t => t.type === 'Vorteil & Dauer' && !t.isManuallyScheduled);

        fixed = calculateFixedTaskDates(fixed);
        // GEÄNDERT: Sortierung berücksichtigt jetzt Uhrzeit bei Fixen Terminen
        fixed.sort((a, b) => {
            const dateA = parseDateString(a.tempPlannedDate);
            const dateB = parseDateString(b.tempPlannedDate);
            if (!dateA) return 1;
            if (!dateB) return -1;
            
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA.getTime() - dateB.getTime();
            }
            
            // Wenn das Datum gleich ist, sortiere nach Uhrzeit (nur wenn beide Fixe Termine sind)
            if (a.type === 'Fixer Termin' && b.type === 'Fixer Termin') {
                const timeA = a.fixedTime || "00:00";
                const timeB = b.fixedTime || "00:00";
                return timeA.localeCompare(timeB);
            }
            
            return 0;
        });
        scheduleFixedTasks(fixed, schedule);

        if (state.settings.autoPriority) {
            flexible.sort(sortTasksByPriority);
        }
        flexible.forEach(task => scheduleFlexibleTask(task, schedule));
    };

    // 4. Plane zuerst priorisierte, dann die anderen Aufgaben
    const newSchedule = [];
    planTaskSet(prioritizedTasks, newSchedule);
    planTaskSet(otherTasks, newSchedule);

    // 5. Aufräumen und State aktualisieren
    activeTasks.forEach(t => delete t.tempPlannedDate);
    state.schedule = newSchedule;
}


// --- Aktionen ---

export async function toggleTaskCompleted(taskId, isCompleted) {
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
        task.completed = isCompleted;
        // Setze oder entferne das Fertigstellungsdatum
        task.completedAt = isCompleted ? new Date().toISOString() : null;
        
        // Setze manuelle Planung zurück, da die Aufgabe (vorerst) aus dem Plan entfernt wird
        task.isManuallyScheduled = false;
        delete task.manualDate;

        // Speichere die Änderung in der Datenbank
        await saveTaskDefinition(task);

        // Berechne den Zeitplan neu, damit die Aufgabe aus der Planung verschwindet/wieder auftaucht
        recalculateSchedule();
    }
}

/**
 * Aktualisiert Details einer Aufgabe (aus dem Edit-Modal).
 * GEÄNDERT: Behandelt Typänderungen, Besitzerwechsel und Uhrzeiten.
 */
export async function updateTaskDetails(taskId, updatedDetails) {
    const task = state.tasks.find(t => t.id === taskId);

    if (!task) {
        console.error("Task not found for update:", taskId);
        return;
    }

    const oldType = task.type;
    const newType = updatedDetails.type || oldType;

    // 1. Aktualisiere Eigenschaften im lokalen State
    if (updatedDetails.description !== undefined) {
        task.description = updatedDetails.description;
    }
    
    // Aktualisiere Metadaten
    if (updatedDetails.assignedTo !== undefined) {
        task.assignedTo = updatedDetails.assignedTo;
    }
    // NEU: Besitzerwechsel (falls durch UI Logik gesetzt)
    if (updatedDetails.ownerId !== undefined && updatedDetails.ownerId !== task.ownerId) {
        console.log(`Transferring ownership to ${updatedDetails.ownerId}`);
        task.ownerId = updatedDetails.ownerId;
    }

    // Wir speichern null, wenn das Feld leer ist.
    task.notes = updatedDetails.notes || null;
    task.location = updatedDetails.location || null;
    task.type = newType;

    // Setze manuellen Status zurück (Änderungen erzwingen Neuplanung)
    task.isManuallyScheduled = false;
    delete task.manualDate;

    // NEU: Behandle Typänderung - Lösche Felder des alten Typs
    if (oldType !== newType) {
        if (oldType === 'Vorteil & Dauer') {
            delete task.estimatedDuration;
            delete task.financialBenefit;
        } else if (oldType === 'Deadline') {
            delete task.deadlineDate;
            delete task.deadlineDuration;
        } else if (oldType === 'Fixer Termin') {
            delete task.fixedDate;
            delete task.fixedDuration;
            delete task.fixedTime; // NEU
        }
    }

    // Aktualisiere Typ-spezifische Felder des (neuen) Typs
    if (task.type === 'Vorteil & Dauer') {
        if (updatedDetails.estimatedDuration !== undefined) task.estimatedDuration = updatedDetails.estimatedDuration;
        if (updatedDetails.financialBenefit !== undefined) task.financialBenefit = updatedDetails.financialBenefit;
    } else if (task.type === 'Deadline') {
        if (updatedDetails.deadlineDate !== undefined) task.deadlineDate = updatedDetails.deadlineDate;
        if (updatedDetails.deadlineDuration !== undefined) task.deadlineDuration = updatedDetails.deadlineDuration;
    } else if (task.type === 'Fixer Termin') {
        if (updatedDetails.fixedDate !== undefined) task.fixedDate = updatedDetails.fixedDate;
        if (updatedDetails.fixedDuration !== undefined) task.fixedDuration = updatedDetails.fixedDuration;
        // NEU: Aktualisiere Uhrzeit
        if (updatedDetails.fixedTime !== undefined) task.fixedTime = updatedDetails.fixedTime;
    }

    // 2. Speichere in DB (Der Listener wird das Update zurückmelden)
    await saveTaskDefinition(task);
    // 3. Berechne Schedule sofort neu für Responsivität
    recalculateSchedule();
}

// (handleTaskDrop Logik unverändert)
export async function handleTaskDrop(draggedTaskId, dropTargetTaskId, insertBefore, newDate) {
    // ... (unverändert)
}
