// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
// GEÄNDERT: clearAllCompletedTasks und deleteTaskDefinition werden nicht mehr von hier exportiert, sondern nur saveTaskDefinition importiert.
import { saveTaskDefinition } from './database.js';

const MAX_SCHEDULING_HORIZON = 365;
// Epsilon wird für Fließkommavergleiche benötigt (z.B. ob noch Restzeit übrig ist)
const EPSILON = 0.0001; // Präzise genug für Minuten-Berechnung

// (Hilfsfunktionen: getScheduleItemDuration, getOriginalTotalDuration, getDailyAvailableHours, getConsumedHoursForDay, sortTasksByPriority)
// BLEIBEN UNVERÄNDERT.

export function getScheduleItemDuration(item) {
    return parseFloat(item.scheduledDuration) || 0;
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

function getConsumedHoursForDay(date, currentSchedule) {
    const dateStr = formatDateToYYYYMMDD(date);
    return currentSchedule.reduce((sum, item) => {
        if (item.plannedDate !== dateStr) {
            return sum;
        }
        return sum + getScheduleItemDuration(item);
    }, 0);
}

// Die Sortierlogik bleibt exakt wie zuvor, um Priorität 1 zu gewährleisten.
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
 * GEÄNDERT: Übernimmt neue Felder in Schedule Items.
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
        // NEU: Übernehme Metadaten (auch wenn null)
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
        if (remainingDuration > EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
}

/**
 * Berechnet das Zieldatum für fixe Aufgaben (Deadlines, Fixe Termine, Manuell Geplant).
 * (Logik unverändert, sehr robust)
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
                // Wir nutzen Math.floor(duration), um sicherzustellen, dass wir genug ganze Tage Puffer haben.
                const bufferedDeadline = new Date(originalDeadline);
                bufferedDeadline.setDate(originalDeadline.getDate() - Math.floor(duration));

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
 * GEÄNDERT: Übernimmt neue Felder in Schedule Items.
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
            isManuallyScheduled: !!task.isManuallyScheduled,
            // NEU: Übernehme Metadaten (auch wenn null)
            assignedTo: task.assignedTo,
            notes: task.notes,
            location: task.location
        };
        currentSchedule.push(newItem);
    });
}


/**
 * Hauptfunktion zur Neuberechnung des Zeitplans.
 * (Logik unverändert)
 */
export function recalculateSchedule() {

    // 1. Vorbereitung: Wenn Auto-Priorität aktiv ist, entferne alle manuellen Pins.
    if (state.settings.autoPriority) {
        state.tasks.forEach(t => {
            t.isManuallyScheduled = false;
            delete t.manualDate;
        });
    }

    // 2. Aufgaben trennen (Nur aktive Aufgaben betrachten)
    const activeTasks = state.tasks.filter(t => !t.completed);

    // 3. Trennen in Fix und Flexibel
    // Fix = Deadlines, Fixe Termine ODER manuell gepinnte Aufgaben
    let fixedTasks = activeTasks.filter(t =>
        t.type === 'Fixer Termin' || t.type === 'Deadline' || t.isManuallyScheduled
    );

    // Flexibel = Vorteilsaufgaben, die nicht manuell gepinnt sind
    let flexibleTasks = activeTasks.filter(t =>
        t.type === 'Vorteil & Dauer' && !t.isManuallyScheduled
    );

    // 4. Berechne Zieldaten für Fixe Aufgaben (setzt tempPlannedDate)
    fixedTasks = calculateFixedTaskDates(fixedTasks);

    // 5. Sortiere Fixe Aufgaben nach ihrem berechneten Datum
    fixedTasks.sort((a, b) => {
        const dateA = parseDateString(a.tempPlannedDate);
        const dateB = parseDateString(b.tempPlannedDate);
        if (!dateA) return 1; // Nicht planbare ans Ende
        if (!dateB) return -1;
        return dateA.getTime() - dateB.getTime();
    });

    // 6. Erstelle den initialen Schedule mit Fixen Aufgaben
    const newSchedule = [];
    scheduleFixedTasks(fixedTasks, newSchedule);

    // 7. Sortiere Flexible Aufgaben (nur wenn Auto-Priorität aktiv ist)
    if (state.settings.autoPriority) {
        flexibleTasks.sort(sortTasksByPriority);
    }
    // Hinweis: Wenn Auto-Priorität AUS ist (Manuelles Sortieren AN), wird die Reihenfolge in state.tasks verwendet.

    // 8. Plane Flexible Aufgaben in die Lücken (füllt newSchedule auf)
    flexibleTasks.forEach(task => {
        scheduleFlexibleTask(task, newSchedule);
    });

    // 9. Aufräumen (Entferne temporäre Felder)
    activeTasks.forEach(t => delete t.tempPlannedDate);

    // 10. Aktualisiere den globalen State
    state.schedule = newSchedule;
}


// --- Aktionen ---

export async function toggleTaskCompleted(taskId, isCompleted) {
    const task = state.tasks.find(t => t.id === taskId);

    if (task) {
        // Update lokalen State
        task.completed = isCompleted;
        // Setze das Erledigungsdatum (für Sortierung der erledigten Aufgaben)
        task.completionDate = isCompleted ? formatDateToYYYYMMDD(new Date()) : null;
        
        // Speichere in DB (Der Listener wird das Update zurückmelden)
        // database.js erstellt intern eine Kopie, daher sicher.
        await saveTaskDefinition(task);
        
        // Berechne sofort neu für Responsivität
        recalculateSchedule();
    }
}

/**
 * Aktualisiert Details einer Aufgabe (aus dem Edit-Modal).
 * GEÄNDERT: Akzeptiert und speichert neue Felder.
 */
export async function updateTaskDetails(taskId, updatedDetails) {
    const task = state.tasks.find(t => t.id === taskId);

    if (!task) {
        console.error("Task not found for update:", taskId);
        return;
    }

    // 1. Aktualisiere Eigenschaften im lokalen State
    if (updatedDetails.description !== undefined) {
        task.description = updatedDetails.description;
    }
    
    // NEU: Aktualisiere Metadaten
    if (updatedDetails.assignedTo !== undefined) {
        task.assignedTo = updatedDetails.assignedTo;
    }
    // Wir speichern null, wenn das Feld leer ist.
    task.notes = updatedDetails.notes || null;
    task.location = updatedDetails.location || null;

    // Setze manuellen Status zurück (Änderungen erzwingen Neuplanung)
    task.isManuallyScheduled = false;
    delete task.manualDate;

    // Aktualisiere Typ-spezifische Felder
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

    // 2. Speichere in DB (Der Listener wird das Update zurückmelden)
    // database.js erstellt intern eine Kopie.
    await saveTaskDefinition(task);
    // 3. Berechne Schedule sofort neu für Responsivität
    recalculateSchedule();
}

// (handleTaskDrop Logik unverändert, sehr robust)
export async function handleTaskDrop(draggedTaskId, dropTargetTaskId, insertBefore, newDate) {
    const draggedTask = state.tasks.find(t => t.id === draggedTaskId);
    if (!draggedTask) return false;

    const newPlannedDateString = newDate ? formatDateToYYYYMMDD(newDate) : null;
    let needsDbUpdate = false;

    // 1. Behandle Datumsänderung (Pinning oder Terminverschiebung)
    if (newPlannedDateString) {

        // Prüfe, ob sich das Datum tatsächlich geändert hat
        const currentDate = draggedTask.isManuallyScheduled ? draggedTask.manualDate : (draggedTask.type === 'Fixer Termin' ? draggedTask.fixedDate : null);

        if (currentDate !== newPlannedDateString) {
            if (draggedTask.type === 'Fixer Termin') {
                // Bei Fixen Terminen fragen wir den Nutzer, ob er den Termin wirklich verschieben möchte
                if (!confirm(`Möchtest du den Termin "${draggedTask.description}" wirklich auf den ${newPlannedDateString} verschieben?`)) {
                    return false; // Abbrechen
                }
                // Aktualisiere das Fixe Datum, entferne manuellen Pin
                draggedTask.fixedDate = newPlannedDateString;
                draggedTask.isManuallyScheduled = false;
                delete draggedTask.manualDate;
            } else {
                // Bei anderen Typen wird die Aufgabe manuell auf das Datum gepinnt
                draggedTask.manualDate = newPlannedDateString;
                draggedTask.isManuallyScheduled = true;
            }
            needsDbUpdate = true;
        }
    }

    // 2. Behandle Reihenfolgeänderung (nur relevant, wenn Manuelles Sortieren AN ist)
    // Dies ändert die Reihenfolge in state.tasks, die verwendet wird, wenn Auto-Priorität AUS ist.
    if (dropTargetTaskId && !state.settings.autoPriority) {
        const currentIndex = state.tasks.findIndex(task => task.id === draggedTaskId);
        if (currentIndex > -1) {
            // Entferne das Element von der alten Position
            const [removed] = state.tasks.splice(currentIndex, 1);
            // Finde die neue Zielposition
            const newDropIndex = state.tasks.findIndex(task => task.id === dropTargetTaskId);

            if (newDropIndex > -1) {
                if (insertBefore) {
                    state.tasks.splice(newDropIndex, 0, removed);
                } else {
                    state.tasks.splice(newDropIndex + 1, 0, removed);
                }
            } else {
                // Fallback, falls Ziel nicht gefunden wurde (sollte nicht passieren)
                state.tasks.push(removed);
            }
        }
    }

    // 3. Speichere die Datumsänderung/Pinning in der DB, falls nötig
    if (needsDbUpdate) {
        // database.js erstellt intern eine Kopie.
        await saveTaskDefinition(draggedTask);
    }

    // 4. Immer neu berechnen
    recalculateSchedule();
    return true;
}
