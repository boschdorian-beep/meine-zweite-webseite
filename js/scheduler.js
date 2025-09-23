// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
import { saveTasks } from './storage.js';

const MAX_SCHEDULING_HORIZON = 365;
const EPSILON = 0.01;

// Hilfsfunktionen
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
    // (Identisch zur vorherigen Version)
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

// Prioritätssortierung (Wird nur angewendet, wenn Auto-Priorität AN ist)
export function sortTasksByPriority(taskA, taskB) {
    // (Identisch zur vorherigen Version)
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
    // (Identisch zur vorherigen Version inkl. Infinite Loop Fix)
    const totalRequiredDuration = getOriginalTotalDuration(originalTask);

    if (totalRequiredDuration <= EPSILON) {
        const newPart = {
            ...originalTask,
            id: `${originalTask.id}-${Date.now()}-1`,
            originalId: originalTask.id,
            plannedDate: formatDateToYYYYMMDD(normalizeDate()),
            scheduledDuration: 0,
            isManuallyScheduled: false // Flexibel geplant
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
                id: `${originalTask.id}-${Date.now()}-UNSCHEDULED`,
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
            id: `${originalTask.id}-${Date.now()}-${partIndex}`,
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
 * Bereitet "Fixe" Aufgaben vor (Termine, Deadlines und manuell geplante Aufgaben).
 */
function prepareFixedTasks(tasks) {
    const today = normalizeDate();

    tasks.forEach(task => {
         if (!task.originalId) {
            task.originalId = task.id;
        }
        task.id = `${task.originalId}-${Date.now()}`;

        const duration = getOriginalTotalDuration(task);
        // Fixe Aufgaben werden (noch) nicht geteilt, also ist die geplante Dauer die Gesamtdauer.
        task.scheduledDuration = duration;

        // Fall 1: Manuell geplant (durch DnD)
        if (task.isManuallyScheduled && task.plannedDate) {
             const manualDate = parseDateString(task.plannedDate);
             // Wenn das manuelle Datum in der Vergangenheit liegt, auf Heute setzen.
             if (manualDate && manualDate.getTime() < today.getTime()) {
                 task.plannedDate = formatDateToYYYYMMDD(today);
             }
             return; // Manuelle Planung respektieren
        }

        // Fall 2: Automatische Planung (Fixer Termin / Deadline)
        if (task.type === 'Fixer Termin' && task.fixedDate) {
            const fixedDate = parseDateString(task.fixedDate);
            if (fixedDate) {
                 if (fixedDate.getTime() < today.getTime()) {
                    // Überfällige Termine auf Heute setzen (zur Sichtbarkeit)
                     task.plannedDate = formatDateToYYYYMMDD(today);
                 } else {
                    task.plannedDate = task.fixedDate;
                 }
            }

        } else if (task.type === 'Deadline' && task.deadlineDate) {
            const originalDeadline = parseDateString(task.deadlineDate);
            if (originalDeadline) {
                // Puffer Logik (1 Tag pro Stunde)
                const bufferedDeadline = new Date(originalDeadline);
                bufferedDeadline.setDate(originalDeadline.getDate() - Math.floor(duration));

                // WICHTIG: Wenn der Puffer in die Vergangenheit führt, aber die Deadline noch nicht erreicht ist, plane für HEUTE.
                if (bufferedDeadline.getTime() < today.getTime() && originalDeadline.getTime() >= today.getTime()) {
                    task.plannedDate = formatDateToYYYYMMDD(today);
                } else {
                    // Sonst (inkl. bereits überfälliger Deadlines) nutze das berechnete Datum.
                    task.plannedDate = formatDateToYYYYMMDD(bufferedDeadline);
                }
            }
        }
    });
    return tasks;
}


/**
 * Hauptfunktion zur Neuberechnung des Zeitplans.
 */
export function recalculateSchedule() {

    // NEU: Wenn Auto-Priorität aktiviert wird, alle manuellen Planungen zurücksetzen.
    if (state.settings.autoPriority) {
        state.tasks.forEach(t => t.isManuallyScheduled = false);
    }

    // 1. Aufgaben trennen
    const completedTasks = state.tasks.filter(t => t.completed);

    // "Fixe" Aufgaben: Termine, Deadlines ODER manuell geplante flexible Aufgaben.
    let fixedTasks = state.tasks.filter(t => !t.completed &&
        (t.type === 'Fixer Termin' || t.type === 'Deadline' || t.isManuallyScheduled)
    );

    // "Flexible" Aufgaben: Nur "Vorteil & Dauer", die NICHT manuell geplant sind.
    const flexibleOriginalTasksMap = new Map();
    state.tasks.filter(t => !t.completed && t.type === 'Vorteil & Dauer' && !t.isManuallyScheduled).forEach(task => {
        const originalId = task.originalId || task.id;
        if (!flexibleOriginalTasksMap.has(originalId)) {
            // Beschreibung bereinigen
            let cleanDescription = task.description.replace(/ \(Teil \d+\)$/, '');
            cleanDescription = cleanDescription.replace(/ \(Nicht planbar - Keine Kapazität\)$/, '');

            flexibleOriginalTasksMap.set(originalId, {
                id: originalId,
                description: cleanDescription,
                type: task.type,
                completed: false,
                estimatedDuration: task.estimatedDuration,
                financialBenefit: task.financialBenefit,
                isManuallyScheduled: false
            });
        }
    });
    const flexibleTasks = Array.from(flexibleOriginalTasksMap.values());

    // 2. Fixe Aufgaben vorbereiten (Daten setzen, Puffer berechnen)
    fixedTasks = prepareFixedTasks(fixedTasks);
    const newSchedule = [...fixedTasks];

    // 3. Flexible Aufgaben sortieren (nur wenn Auto-Priorität AN ist)
    if (state.settings.autoPriority) {
        flexibleTasks.sort(sortTasksByPriority);
    }

    // 4. Flexible Aufgaben in die Lücken planen
    flexibleTasks.forEach(task => {
        scheduleFlexibleTask(task, newSchedule);
    });

    // 5. Kombinieren und speichern
    state.tasks = [...newSchedule, ...completedTasks];
    saveTasks();
}

/**
 * Toggelt den Erledigt-Status (alle Teile gleichzeitig).
 */
export function toggleTaskCompleted(taskId, isCompleted) {
    const taskIndex = state.tasks.findIndex(task => task.id === taskId);

    if (taskIndex > -1) {
        const originalId = state.tasks[taskIndex].originalId || state.tasks[taskIndex].id;

        // Update ALL parts of the original task
        state.tasks.forEach(task => {
            if ((task.originalId || task.id) === originalId) {
                task.completed = isCompleted;
                // NEU: Datum der Erledigung speichern
                task.completionDate = isCompleted ? formatDateToYYYYMMDD(new Date()) : null;
            }
        });

        recalculateSchedule();
    }
}

/**
 * NEU: Löscht alle erledigten Aufgaben.
 */
export function clearCompletedTasks() {
    state.tasks = state.tasks.filter(task => !task.completed);
    // Da wir nur erledigte Aufgaben entfernen, müssen wir nicht neu planen, nur speichern.
    saveTasks();
}

/**
 * NEU: Aktualisiert Details einer Aufgabe (aus dem Edit-Modal).
 */
export function updateTaskDetails(originalId, updatedDetails) {
    // Finde alle Teile der Aufgabe
    const taskParts = state.tasks.filter(t => (t.originalId || t.id) === originalId);

    if (taskParts.length === 0) {
        // Wenn ID nicht gefunden (z.B. nach Löschung), nur neu berechnen.
        recalculateSchedule();
        return;
    }

    // Aktualisiere die Eigenschaften für alle Teile
    taskParts.forEach(part => {
        if (updatedDetails.description !== undefined) {
             part.description = updatedDetails.description;
        }
        // Setze manuellen Status zurück, da Bearbeitung eine Neuplanung erfordert
        part.isManuallyScheduled = false;

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

    recalculateSchedule();
}


/**
 * NEU: Aktualisiert Reihenfolge UND/ODER Datum nach Drag-and-Drop.
 */
export function handleTaskDrop(draggedId, dropTargetId, insertBefore, newDate) {
    const draggedTaskIndex = state.tasks.findIndex(task => task.id === draggedId);
    if (draggedTaskIndex === -1) return;

    const draggedTask = state.tasks[draggedTaskIndex];
    const originalPlannedDate = draggedTask.plannedDate;
    const newPlannedDateString = newDate ? formatDateToYYYYMMDD(newDate) : null;

    // Prüfen, ob das Datum sich geändert hat (oder von null auf ein Datum wechselt)
    const dateChanged = newPlannedDateString && originalPlannedDate !== newPlannedDateString;

    // Fall 1: Datum hat sich geändert (Verschieben zwischen Tagen)
    if (dateChanged) {

        // Sicherheitsabfrage für Fixe Termine
        if (draggedTask.type === 'Fixer Termin') {
            if (!confirm(`Möchtest du den Termin "${draggedTask.description}" wirklich auf den ${newPlannedDateString} verschieben?`)) {
                return; // Abbrechen
            }
        }

        // Update das Datum aller Teile der Original-Aufgabe
        const originalId = draggedTask.originalId || draggedTask.id;
        state.tasks.forEach(task => {
            if ((task.originalId || task.id) === originalId) {
                if (task.type === 'Fixer Termin') {
                    // Update die Basisdaten
                    task.fixedDate = newPlannedDateString;
                    task.plannedDate = newPlannedDateString;
                    task.isManuallyScheduled = false; // Ein Fixer Termin ist per Definition fixiert
                } else {
                    // Für Deadline und V&D: Setze das geplante Datum manuell und markiere es (Pinnen)
                    task.plannedDate = newPlannedDateString;
                    task.isManuallyScheduled = true;
                }
            }
        });
    }

    // Fall 2: Reihenfolge aktualisieren (Umsortieren innerhalb der Liste oder nach Datumsänderung)
    // Finde den aktuellen Index neu, falls die Schleife oben etwas verschoben hat.
    const currentIndex = state.tasks.findIndex(task => task.id === draggedId);

    if (dropTargetId && currentIndex > -1) {
         // Entferne das gezogene Element
        const [removed] = state.tasks.splice(currentIndex, 1);

        // Finde den neuen Index des Ziels
        const newDropIndex = state.tasks.findIndex(task => task.id === dropTargetId);

        if (newDropIndex > -1) {
            if (insertBefore) {
                state.tasks.splice(newDropIndex, 0, removed);
            } else {
                state.tasks.splice(newDropIndex + 1, 0, removed);
            }
        } else {
            // Sollte nicht passieren, wenn dropTargetId existiert, aber als Fallback
            state.tasks.push(removed);
        }
    }

    // Immer neu berechnen, da sich entweder das Datum oder die manuelle Reihenfolge geändert hat.
    recalculateSchedule();
}
