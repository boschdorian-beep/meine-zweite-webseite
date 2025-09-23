// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
// GEÄNDERT: Importiere syncTasksToFirestore aus database.js
import { syncTasksToFirestore } from './database.js';

const MAX_SCHEDULING_HORIZON = 365;
const EPSILON = 0.01;

// (Hilfsfunktionen: getTaskDuration, getOriginalTotalDuration, getDailyAvailableHours, getConsumedHoursForDay, sortTasksByPriority)
// BLEIBEN UNVERÄNDERT WIE IN DER VORHERIGEN VERSION.

export function getTaskDuration(task) {
    if (task.scheduledDuration !== undefined) {
        return parseFloat(task.scheduledDuration) || 0;
    }
    return getOriginalTotalDuration(task);
}

export function getOriginalTotalDuration(task) {
    if (task.type === 'Vorteil & Dauer') return parseFloat(task.estimatedDuration) || 0;
    if (task.type === 'Deadline') return parseFloat(task.deadlineDuration) || 0;
    if (task.type === 'Fixer Termin') return parseFloat(task.fixedDuration) || 0;
    return 0;
}

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

function getConsumedHoursForDay(date, taskList) {
    const dateStr = formatDateToYYYYMMDD(date);
    return taskList.reduce((sum, task) => {
        if (task.completed || task.plannedDate !== dateStr) {
            return sum;
        }
        return sum + getTaskDuration(task);
    }, 0);
}

export function sortTasksByPriority(taskA, taskB) {
    const getBenefitPerHour = (task) => {
        const benefit = parseFloat(task.financialBenefit) || 0;
        const duration = getOriginalTotalDuration(task);
        return (benefit > 0 && duration > 0) ? (benefit / duration) : 0;
    };

    // 1. Fixer Termin
    if (taskA.type === 'Fixer Termin' && taskB.type !== 'Fixer Termin') return -1;
    if (taskB.type === 'Fixer Termin' && taskA.type !== 'Fixer Termin') return 1;

    // 2. Deadline
    if (taskA.type === 'Deadline' && taskB.type !== 'Deadline') return -1;
    if (taskB.type === 'Deadline' && taskA.type !== 'Deadline') return 1;

    // 3. Sort by Date if types are the same (Fixer Termin or Deadline)
    if (taskA.type === taskB.type && (taskA.type === 'Fixer Termin' || taskA.type === 'Deadline')) {
         if (taskA.plannedDate && taskB.plannedDate) {
            const dateA = parseDateString(taskA.plannedDate);
            const dateB = parseDateString(taskB.plannedDate);
            if (dateA && dateB) {
                return dateA.getTime() - dateB.getTime();
            }
         }
         return 0;
    }

    // 4. Vorteil & Dauer (financial benefit)
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
 * Plant flexible "Vorteil & Dauer" Aufgaben.
 */
function scheduleFlexibleTask(originalTask, currentSchedule) {
    const totalRequiredDuration = getOriginalTotalDuration(originalTask);

    // WICHTIG: Wir verwenden temporäre IDs ('temp-') wenn die Original-ID temporär ist, 
    // da echte Firestore IDs erst beim Speichern generiert werden. Wenn bereits eine ID existiert, nutzen wir diese.
    const idPrefix = (originalTask.id && !originalTask.id.startsWith('temp-')) ? originalTask.id : `temp-${Date.now()}-${Math.random()}`;


    if (totalRequiredDuration <= EPSILON) {
        const newPart = {
            ...originalTask,
            id: `${idPrefix}-p1`, // ID für diesen Teil
            originalId: originalTask.id,
            plannedDate: formatDateToYYYYMMDD(normalizeDate()),
            scheduledDuration: 0,
            isManuallyScheduled: false
        };
        currentSchedule.push(newPart);
        return;
    }

    let remainingDuration = totalRequiredDuration;
    const startDate = normalizeDate();
    let currentDate = normalizeDate(startDate);
    let partIndex = 1;
    const originalDescription = originalTask.description;

    while (remainingDuration > EPSILON) {

        const daysTried = (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysTried > MAX_SCHEDULING_HORIZON) {
             const newPart = {
                ...originalTask,
                id: `${idPrefix}-UNSCHEDULED`,
                originalId: originalTask.id,
                plannedDate: null,
                scheduledDuration: remainingDuration,
                description: `${originalDescription} (Nicht planbar - Keine Kapazität)`,
                isManuallyScheduled: false
            };
            currentSchedule.push(newPart);
            return;
        }

        const consumedHours = getConsumedHoursForDay(currentDate, currentSchedule);
        const availableToday = getDailyAvailableHours(currentDate) - consumedHours;

        if (availableToday <= EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }

        const durationForPart = Math.min(remainingDuration, availableToday);

        const newPart = {
            ...originalTask,
            id: `${idPrefix}-p${partIndex}`, // ID für diesen Teil
            originalId: originalTask.id,
            plannedDate: formatDateToYYYYMMDD(currentDate),
            scheduledDuration: durationForPart,
            isManuallyScheduled: false
        };

        if (remainingDuration > durationForPart + EPSILON || partIndex > 1) {
             newPart.description = `${originalDescription} (Teil ${partIndex})`;
        } else {
            newPart.description = originalDescription;
        }

        currentSchedule.push(newPart);
        remainingDuration -= durationForPart;
        partIndex++;

        if (remainingDuration > EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
}

/**
 * Bereitet "Fixe" Aufgaben vor.
 */
function prepareFixedTasks(tasks) {
    const today = normalizeDate();

    tasks.forEach(task => {
         if (!task.originalId) {
            task.originalId = task.id;
        }
        // Wir behalten die existierende ID bei, generieren KEINE neue temporäre ID hier.

        const duration = getOriginalTotalDuration(task);
        task.scheduledDuration = duration;

        // (Rest der Logik identisch zur vorherigen Version)
        // Fall 1: Manuell geplant (durch DnD)
        if (task.isManuallyScheduled && task.plannedDate) {
             const manualDate = parseDateString(task.plannedDate);
             if (manualDate && manualDate.getTime() < today.getTime()) {
                 task.plannedDate = formatDateToYYYYMMDD(today);
             }
             return;
        }

        // Fall 2: Automatische Planung (Fixer Termin / Deadline)
        if (task.type === 'Fixer Termin' && task.fixedDate) {
            const fixedDate = parseDateString(task.fixedDate);
            if (fixedDate) {
                 if (fixedDate.getTime() < today.getTime()) {
                     task.plannedDate = formatDateToYYYYMMDD(today);
                 } else {
                    task.plannedDate = task.fixedDate;
                 }
            }

        } else if (task.type === 'Deadline' && task.deadlineDate) {
            const originalDeadline = parseDateString(task.deadlineDate);
            if (originalDeadline) {
                const bufferedDeadline = new Date(originalDeadline);
                bufferedDeadline.setDate(originalDeadline.getDate() - Math.floor(duration));

                if (bufferedDeadline.getTime() < today.getTime() && originalDeadline.getTime() >= today.getTime()) {
                    task.plannedDate = formatDateToYYYYMMDD(today);
                } else {
                    task.plannedDate = formatDateToYYYYMMDD(bufferedDeadline);
                }
            }
        }
    });
    return tasks;
}


/**
 * Hauptfunktion zur Neuberechnung des Zeitplans.
 * GEÄNDERT: Ist jetzt ASYNC und ruft syncTasksToFirestore auf.
 */
export async function recalculateSchedule() {

    // Wenn Auto-Priorität aktiviert wird, alle manuellen Planungen zurücksetzen.
    if (state.settings.autoPriority) {
        state.tasks.forEach(t => t.isManuallyScheduled = false);
    }

    // 1. Aufgaben trennen (Logik unverändert, aber angepasst für Metadaten)
    const completedTasks = state.tasks.filter(t => t.completed);

    let fixedTasks = state.tasks.filter(t => !t.completed &&
        (t.type === 'Fixer Termin' || t.type === 'Deadline' || t.isManuallyScheduled)
    );

    const flexibleOriginalTasksMap = new Map();
    state.tasks.filter(t => !t.completed && t.type === 'Vorteil & Dauer' && !t.isManuallyScheduled).forEach(task => {
        const originalId = task.originalId || task.id;
        if (!flexibleOriginalTasksMap.has(originalId)) {
            let cleanDescription = task.description.replace(/ \(Teil \d+\)$/, '');
            cleanDescription = cleanDescription.replace(/ \(Nicht planbar - Keine Kapazität\)$/, '');

            flexibleOriginalTasksMap.set(originalId, {
                // Wichtig: Behalte Metadaten (ownerId, assignedTo) bei
                ...task, 
                id: originalId,
                description: cleanDescription,
                // (Restliche Felder...)
                type: task.type,
                completed: false,
                estimatedDuration: task.estimatedDuration,
                financialBenefit: task.financialBenefit,
                isManuallyScheduled: false
            });
        }
    });
    const flexibleTasks = Array.from(flexibleOriginalTasksMap.values());

    // 2. Fixe Aufgaben vorbereiten
    fixedTasks = prepareFixedTasks(fixedTasks);
    const newSchedule = [...fixedTasks];

    // 3. Flexible Aufgaben sortieren
    if (state.settings.autoPriority) {
        flexibleTasks.sort(sortTasksByPriority);
    }

    // 4. Flexible Aufgaben in die Lücken planen
    flexibleTasks.forEach(task => {
        scheduleFlexibleTask(task, newSchedule);
    });

    // 5. Kombinieren und Synchronisieren
    state.tasks = [...newSchedule, ...completedTasks];

    // GEÄNDERT: Synchronisiere mit Firestore (async)
    await syncTasksToFirestore(state.tasks);
}

/**
 * GEÄNDERT: Ist jetzt ASYNC.
 */
export async function toggleTaskCompleted(taskId, isCompleted) {
    const taskIndex = state.tasks.findIndex(task => task.id === taskId);

    if (taskIndex > -1) {
        const originalId = state.tasks[taskIndex].originalId || state.tasks[taskIndex].id;

        // Update ALL parts of the original task
        state.tasks.forEach(task => {
            if ((task.originalId || task.id) === originalId) {
                task.completed = isCompleted;
                task.completionDate = isCompleted ? formatDateToYYYYMMDD(new Date()) : null;
            }
        });

        await recalculateSchedule();
    }
}

/**
 * GEÄNDERT: Ist jetzt ASYNC.
 */
export async function clearCompletedTasks() {
    state.tasks = state.tasks.filter(task => !task.completed);
    // Wir müssen synchronisieren, da Aufgaben gelöscht wurden.
    await syncTasksToFirestore(state.tasks);
}

/**
 * GEÄNDERT: Ist jetzt ASYNC.
 */
export async function updateTaskDetails(taskId, updatedDetails) {
    // Finde die Aufgabe anhand ihrer ID (die jetzt die Firestore ID ist)
    const taskToUpdate = state.tasks.find(t => t.id === taskId);

    if (!taskToUpdate && taskId !== null) {
        await recalculateSchedule();
        return;
    }

    // Finde die Original-ID, um alle Teile zu aktualisieren
    const originalId = taskToUpdate ? (taskToUpdate.originalId || taskToUpdate.id) : null;

    // Finde alle Teile der Aufgabe
    const taskParts = state.tasks.filter(t => (t.originalId || t.id) === originalId);


    // Aktualisiere die Eigenschaften für alle Teile
    taskParts.forEach(part => {
        if (updatedDetails.description !== undefined) {
             part.description = updatedDetails.description;
        }
        part.isManuallyScheduled = false;

        // HINWEIS: Hier wird später 'assignedTo' aktualisiert (Phase 2)

        if (part.type === 'Vorteil & Dauer') {
            if (updatedDetails.estimatedDuration !== undefined) part.estimatedDuration = updatedDetails.estimatedDuration;
            if (updatedDetails.financialBenefit !== undefined) part.financialBenefit = updatedDetails.financialBenefit;
        } else if (part.type === 'Deadline') {
            if (updatedDetails.deadlineDate !== undefined) part.deadlineDate = updatedDetails.deadlineDate;
            if (updatedDetails.deadlineDuration !== undefined) part.deadlineDuration = updatedDetails.deadlineDuration;
        } else if (part.type === 'Fixer Termin') {
            if (updatedDetails.fixedDate !== undefined) part.fixedDate = updatedDetails.fixedDate;
            if (updatedDetails.fixedDuration !== undefined) part.fixedDuration = updatedDetails.fixedDuration;
        }
    });

    await recalculateSchedule();
}


/**
 * GEÄNDERT: Ist jetzt ASYNC.
 */
export async function handleTaskDrop(draggedId, dropTargetId, insertBefore, newDate) {
    const draggedTaskIndex = state.tasks.findIndex(task => task.id === draggedId);
    if (draggedTaskIndex === -1) return false;

    const draggedTask = state.tasks[draggedTaskIndex];
    const originalPlannedDate = draggedTask.plannedDate;
    const newPlannedDateString = newDate ? formatDateToYYYYMMDD(newDate) : null;

    const dateChanged = newPlannedDateString && originalPlannedDate !== newPlannedDateString;

    // Fall 1: Datum hat sich geändert
    if (dateChanged) {

        // Sicherheitsabfrage für Fixe Termine
        if (draggedTask.type === 'Fixer Termin') {
            if (!confirm(`Möchtest du den Termin "${draggedTask.description}" wirklich auf den ${newPlannedDateString} verschieben?`)) {
                return false; // Abbrechen
            }
        }

        // Update das Datum aller Teile der Original-Aufgabe
        const originalId = draggedTask.originalId || draggedTask.id;
        state.tasks.forEach(task => {
            if ((task.originalId || task.id) === originalId) {
                if (task.type === 'Fixer Termin') {
                    task.fixedDate = newPlannedDateString;
                    task.plannedDate = newPlannedDateString;
                    task.isManuallyScheduled = false;
                } else {
                    task.plannedDate = newPlannedDateString;
                    task.isManuallyScheduled = true;
                }
            }
        });
    }

    // Fall 2: Reihenfolge aktualisieren
    const currentIndex = state.tasks.findIndex(task => task.id === draggedId);

    if (dropTargetId && currentIndex > -1) {
        const [removed] = state.tasks.splice(currentIndex, 1);
        const newDropIndex = state.tasks.findIndex(task => task.id === dropTargetId);

        if (newDropIndex > -1) {
            if (insertBefore) {
                state.tasks.splice(newDropIndex, 0, removed);
            } else {
                state.tasks.splice(newDropIndex + 1, 0, removed);
            }
        } else {
            state.tasks.push(removed);
        }
    }

    // Immer neu berechnen und synchronisieren (async)
    await recalculateSchedule();
    return true; // Erfolgreich verschoben
}