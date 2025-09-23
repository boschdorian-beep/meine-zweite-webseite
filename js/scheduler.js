// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
// GEÄNDERT: Importiere Datenbank-Funktionen für Aktionen
import { saveTaskDefinition, deleteTaskDefinition, clearAllCompletedTasks } from './database.js';

const MAX_SCHEDULING_HORIZON = 365;
const EPSILON = 0.01;

// Hilfsfunktionen (angepasst für Schedule Items und Task Definitions)

/**
 * Gibt die Dauer eines Schedule Items zurück.
 */
export function getScheduleItemDuration(item) {
    // Schedule Items haben immer eine scheduledDuration
    return parseFloat(item.scheduledDuration) || 0;
}

/**
 * Gibt die Original-Gesamtdauer der zugrundeliegenden Aufgabe zurück.
 */
export function getOriginalTotalDuration(task) {
    if (task.type === 'Vorteil & Dauer') return parseFloat(task.estimatedDuration) || 0;
    if (task.type === 'Deadline') return parseFloat(task.deadlineDuration) || 0;
    if (task.type === 'Fixer Termin') return parseFloat(task.fixedDuration) || 0;
    return 0;
}

// (getDailyAvailableHours bleibt unverändert)
export function getDailyAvailableHours(date) {
    const dayName = getDayOfWeek(date);
     if (!state.settings || !state.settings.dailyTimeSlots) {
        return 0;
    }
    const slots = state.settings.dailyTimeSlots[dayName];
    let totalHours = 0;
    if (!slots || slots.length === 0) return 0;
    slots.forEach(slot => {
        const [startHour, startMinute] = slot.start.split(':').map(Number);
        const [endHour, endMinute] = slot.end.split(':').map(Number);
        const startTotalMinutes = startHour * 60 + startMinute;
        const endTotalMinutes = endHour * 60 + endMinute;
        if (endTotalMinutes > startTotalMinutes) {
             totalHours += (endTotalMinutes - startTotalMinutes) / 60;
        }
    });
    return totalHours;
}

/**
 * Berechnet die verbrauchte Zeit an einem Tag basierend auf dem aktuellen Schedule.
 */
function getConsumedHoursForDay(date, currentSchedule) {
    const dateStr = formatDateToYYYYMMDD(date);
    return currentSchedule.reduce((sum, item) => {
        // Wir prüfen nur Items im Schedule
        if (item.plannedDate !== dateStr) {
            return sum;
        }
        return sum + getScheduleItemDuration(item);
    }, 0);
}

// Prioritätssortierung (Logik unverändert, angewendet auf Task Definitions)
export function sortTasksByPriority(taskA, taskB) {
    const getBenefitPerHour = (task) => {
        const benefit = parseFloat(task.financialBenefit) || 0;
        const duration = getOriginalTotalDuration(task);
        return (benefit > 0 && duration > 0) ? (benefit / duration) : 0;
    };

    // (Logik für Fixer Termin, Deadline unverändert)
    if (taskA.type === 'Fixer Termin' && taskB.type !== 'Fixer Termin') return -1;
    if (taskB.type === 'Fixer Termin' && taskA.type !== 'Fixer Termin') return 1;

    if (taskA.type === 'Deadline' && taskB.type !== 'Deadline') return -1;
    if (taskB.type === 'Deadline' && taskA.type !== 'Deadline') return 1;

    // Sort by Date if types are the same (using the tempPlannedDate injected during preparation)
     if (taskA.type === taskB.type && (taskA.type === 'Fixer Termin' || taskA.type === 'Deadline')) {
         if (taskA.tempPlannedDate && taskB.tempPlannedDate) {
            const dateA = parseDateString(taskA.tempPlannedDate);
            const dateB = parseDateString(taskB.tempPlannedDate);
            if (dateA && dateB) {
                return dateA.getTime() - dateB.getTime();
            }
         }
         return 0;
    }

    // Vorteil & Dauer
    if (state.settings.calcPriority) {
        const benefitA = getBenefitPerHour(taskA);
        const benefitB = getBenefitPerHour(taskB);

        if (benefitA > 0 || benefitB > 0) {
            return benefitB - benefitA;
        }
    }
    return 0;
}

/**
 * Plant flexible Aufgaben und erstellt Schedule Items.
 */
function scheduleFlexibleTask(task, currentSchedule) {
    const totalRequiredDuration = getOriginalTotalDuration(task);

    // Erstelle ein Basis-Schedule-Item
    const baseItem = {
        taskId: task.id, // Link zur Originalaufgabe
        description: task.description,
        type: task.type,
        // Metadaten für die UI
        financialBenefit: task.financialBenefit,
        estimatedDuration: task.estimatedDuration,
        isManuallyScheduled: false
    };

    if (totalRequiredDuration <= EPSILON) {
        currentSchedule.push({
            ...baseItem,
            scheduleId: `sched-${task.id}-${Date.now()}-1`, // Temporäre ID für die UI
            plannedDate: formatDateToYYYYMMDD(normalizeDate()),
            scheduledDuration: 0
        });
        return;
    }

    let remainingDuration = totalRequiredDuration;
    const startDate = normalizeDate();
    let currentDate = normalizeDate(startDate);
    let partIndex = 1;

    while (remainingDuration > EPSILON) {

        // Safety Brake (Infinite Loop protection)
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

        const consumedHours = getConsumedHoursForDay(currentDate, currentSchedule);
        const availableToday = getDailyAvailableHours(currentDate) - consumedHours;

        if (availableToday <= EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        const durationForPart = Math.min(remainingDuration, availableToday);

        const newItem = {
            ...baseItem,
            scheduleId: `sched-${task.id}-${Date.now()}-${partIndex}`,
            plannedDate: formatDateToYYYYMMDD(currentDate),
            scheduledDuration: durationForPart
        };

        // Update description if split
        if (remainingDuration > durationForPart + EPSILON || partIndex > 1) {
             newItem.description = `${task.description} (Teil ${partIndex})`;
        }

        currentSchedule.push(newItem);
        remainingDuration -= durationForPart;
        partIndex++;

        if (remainingDuration > EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
}

/**
 * Berechnet das Zieldatum für fixe Aufgaben (Termine, Deadlines, Manuell).
 * Injiziert ein temporäres Feld `tempPlannedDate` zur Sortierung.
 */
function calculateFixedTaskDates(tasks) {
    const today = normalizeDate();

    tasks.forEach(task => {
        const duration = getOriginalTotalDuration(task);

        // Fall 1: Manuell geplant (durch DnD) - Verwendet manualDate
        if (task.isManuallyScheduled && task.manualDate) {
             const manualDate = parseDateString(task.manualDate);
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
                 if (fixedDate.getTime() < today.getTime()) {
                     task.tempPlannedDate = formatDateToYYYYMMDD(today);
                 } else {
                    task.tempPlannedDate = task.fixedDate;
                 }
            }
            return;
        }

        // Fall 3: Deadline
        if (task.type === 'Deadline' && task.deadlineDate) {
            const originalDeadline = parseDateString(task.deadlineDate);
            if (originalDeadline) {
                // Puffer Logik
                const bufferedDeadline = new Date(originalDeadline);
                bufferedDeadline.setDate(originalDeadline.getDate() - Math.floor(duration));

                // Wenn Puffer in Vergangenheit, aber Deadline noch nicht erreicht, plane HEUTE.
                if (bufferedDeadline.getTime() < today.getTime() && originalDeadline.getTime() >= today.getTime()) {
                    task.tempPlannedDate = formatDateToYYYYMMDD(today);
                } else {
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
 */
function scheduleFixedTasks(tasks, currentSchedule) {
    tasks.forEach(task => {
        // Erstelle ein Schedule Item basierend auf dem berechneten tempPlannedDate
        const newItem = {
            taskId: task.id,
            scheduleId: `sched-${task.id}-${Date.now()}-fixed`, // Temporäre ID für die UI
            description: task.description,
            type: task.type,
            plannedDate: task.tempPlannedDate || null, // Nutze das berechnete Datum
            scheduledDuration: getOriginalTotalDuration(task),
            // Metadaten für die UI
            deadlineDate: task.deadlineDate,
            fixedDate: task.fixedDate,
            isManuallyScheduled: !!task.isManuallyScheduled
        };
        currentSchedule.push(newItem);
    });
}


/**
 * Hauptfunktion zur Neuberechnung des Zeitplans.
 * Liest state.tasks (Definitionen) und schreibt state.schedule (Plan).
 */
export function recalculateSchedule() {

    // 1. Vorbereitung: Wenn Auto-Prio AN, entferne alle manuellen Planungen (lokal).
    if (state.settings.autoPriority) {
        state.tasks.forEach(t => {
            t.isManuallyScheduled = false;
            delete t.manualDate;
        });
        // Hinweis: Die DB wird in handleToggleDragDrop aktualisiert.
    }

    // 2. Aufgaben trennen (Aktiv vs. Erledigt)
    const activeTasks = state.tasks.filter(t => !t.completed);

    // 3. Trennen in Fix und Flexibel
    let fixedTasks = activeTasks.filter(t =>
        t.type === 'Fixer Termin' || t.type === 'Deadline' || t.isManuallyScheduled
    );

    let flexibleTasks = activeTasks.filter(t =>
        t.type === 'Vorteil & Dauer' && !t.isManuallyScheduled
    );

    // 4. Berechne Zieldaten für Fixe Aufgaben (injiziert tempPlannedDate)
    fixedTasks = calculateFixedTaskDates(fixedTasks);

    // 5. Sortiere Fixe Aufgaben nach Datum
    fixedTasks.sort((a, b) => {
        const dateA = parseDateString(a.tempPlannedDate);
        const dateB = parseDateString(b.tempPlannedDate);
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA.getTime() - dateB.getTime();
    });

    // 6. Erstelle den initialen Schedule mit Fixen Aufgaben
    const newSchedule = [];
    scheduleFixedTasks(fixedTasks, newSchedule);

    // 7. Sortiere Flexible Aufgaben (nur wenn Auto-Prio AN)
    if (state.settings.autoPriority) {
        flexibleTasks.sort(sortTasksByPriority);
    }
    // Wenn AUS, wird die Reihenfolge in state.tasks respektiert.

    // 8. Plane Flexible Aufgaben in die Lücken
    flexibleTasks.forEach(task => {
        scheduleFlexibleTask(task, newSchedule);
    });

    // 9. Aufräumen: Entferne temporäre Felder von den Definitionen
    activeTasks.forEach(t => delete t.tempPlannedDate);

    // 10. Aktualisiere den globalen State
    state.schedule = newSchedule;
}


// --- Aktionen (Alle sind async und interagieren mit der DB) ---

/**
 * Toggelt den Erledigt-Status einer Aufgabe.
 */
export async function toggleTaskCompleted(taskId, isCompleted) {
    // Finde die Definition
    const task = state.tasks.find(t => t.id === taskId);

    if (task) {
        // 1. Update lokalen State
        task.completed = isCompleted;
        task.completionDate = isCompleted ? formatDateToYYYYMMDD(new Date()) : null;

        // 2. Speichere die Änderung der Definition in der DB (async)
        await saveTaskDefinition(task);

        // 3. Berechne den Schedule neu
        recalculateSchedule();
    }
}

/**
 * Löscht alle erledigten Aufgaben.
 */
export async function clearCompletedTasks() {
    const completedTasks = state.tasks.filter(task => task.completed);
    const idsToDelete = completedTasks.map(t => t.id);

    // 1. Lösche in DB (Batch)
    await clearAllCompletedTasks(idsToDelete);

    // 2. Entferne aus lokalem State
    state.tasks = state.tasks.filter(task => !task.completed);

    // 3. Berechne den Schedule neu
    recalculateSchedule();
}

/**
 * Aktualisiert Details einer Aufgabe (aus dem Edit-Modal).
 */
export async function updateTaskDetails(taskId, updatedDetails) {
    const task = state.tasks.find(t => t.id === taskId);

    if (!task) {
        return;
    }

    // 1. Aktualisiere Eigenschaften im lokalen State
    if (updatedDetails.description !== undefined) {
        task.description = updatedDetails.description;
    }
    // Setze manuellen Status zurück
    task.isManuallyScheduled = false;
    delete task.manualDate;

    if (task.type === 'Vorteil & Dauer') {
        if (updatedDetails.estimatedDuration !== undefined) task.estimatedDuration = updatedDetails.estimatedDuration;
        if (updatedDetails.financialBenefit !== undefined) task.financialBenefit = updatedDetails.financialBenefit;
    } else if (task.type === 'Deadline') {
        if (updatedDetails.deadlineDate !== undefined) task.deadlineDate = updatedDetails.deadlineDate;
        if (updatedDetails.deadlineDuration !== undefined) task.deadlineDuration = updatedDetails.deadlineDuration;
    } else if (task.type === 'Fixer Termin') {
        if (updatedDetails.fixedDate !== undefined) task.fixedDate = updatedDetails.fixedDate;
        if (updatedDetails.fixedDuration !== undefined) task.fixedDuration = updatedDetails.fixedDuration;
    }

    // 2. Speichere in DB
    await saveTaskDefinition(task);
    // 3. Berechne Schedule neu
    recalculateSchedule();
}

/**
 * Löscht eine Aufgabe.
 */
export async function deleteTaskAction(taskId) {
     // 1. Lösche in DB
     await deleteTaskDefinition(taskId);
     // 2. Entferne aus lokalem State
     state.tasks = state.tasks.filter(t => t.id !== taskId);
     // 3. Berechne Schedule neu
     recalculateSchedule();
}


/**
 * Aktualisiert Reihenfolge UND/ODER Datum nach Drag-and-Drop.
 */
export async function handleTaskDrop(draggedTaskId, dropTargetTaskId, insertBefore, newDate) {
    // Finde die Definition
    const draggedTask = state.tasks.find(t => t.id === draggedTaskId);
    if (!draggedTask) return false;

    const newPlannedDateString = newDate ? formatDateToYYYYMMDD(newDate) : null;
    let needsDbUpdate = false;

    // 1. Behandle Datumsänderung (Verschieben zwischen Tagen)
    if (newPlannedDateString) {

        // Prüfen, ob sich das relevante Datum wirklich geändert hat
        const currentDate = draggedTask.isManuallyScheduled ? draggedTask.manualDate : (draggedTask.type === 'Fixer Termin' ? draggedTask.fixedDate : null);

        if (currentDate !== newPlannedDateString) {
            // Sicherheitsabfrage für Fixe Termine
            if (draggedTask.type === 'Fixer Termin') {
                if (!confirm(`Möchtest du den Termin "${draggedTask.description}" wirklich auf den ${newPlannedDateString} verschieben?`)) {
                    return false; // Abbrechen
                }
                draggedTask.fixedDate = newPlannedDateString;
                draggedTask.isManuallyScheduled = false;
                delete draggedTask.manualDate;
            } else {
                // Für Deadline und V&D: Pinnen (Manuell Planen)
                draggedTask.manualDate = newPlannedDateString;
                draggedTask.isManuallyScheduled = true;
            }
            needsDbUpdate = true;
        }
    }

    // 2. Behandle Reihenfolgeänderung (Umsortieren in state.tasks)
    // Dies ist wichtig, wenn Auto-Prio AUS ist.
    if (dropTargetTaskId) {
        const currentIndex = state.tasks.findIndex(task => task.id === draggedTaskId);
        if (currentIndex > -1) {
            // Entferne das gezogene Element
            const [removed] = state.tasks.splice(currentIndex, 1);

            // Finde den Index des Ziels
            const newDropIndex = state.tasks.findIndex(task => task.id === dropTargetTaskId);

            if (newDropIndex > -1) {
                if (insertBefore) {
                    state.tasks.splice(newDropIndex, 0, removed);
                } else {
                    state.tasks.splice(newDropIndex + 1, 0, removed);
                }
            } else {
                 // Fallback
                state.tasks.push(removed);
            }
        }
    }

    // 3. Speichere die Datumsänderung/Pinning in der DB, falls nötig
    if (needsDbUpdate) {
        await saveTaskDefinition(draggedTask);
    }

    // 4. Immer neu berechnen, da sich Zustand geändert hat.
    recalculateSchedule();
    return true; // Erfolgreich
}
