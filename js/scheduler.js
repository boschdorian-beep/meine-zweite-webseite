// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
import { saveTaskDefinition } from './database.js';

const MAX_SCHEDULING_HORIZON = 365;
// Epsilon wird für Fließkommavergleiche benötigt (z.B. ob noch Restzeit übrig ist)
const EPSILON = 0.0001; // Präzise genug für Minuten-Berechnung

// NEU: Hilfsfunktionen für Zeitberechnungen
function timeToMins(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function minsToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    // Handle edge case near midnight. If it exceeds 24h, it means the calculation logic failed to advance the day, 
    // but we display it capped at 23:59 for safety if it happens within the same day calculation context.
    if (h >= 24) {
        return "23:59"; 
    }
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}


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
 * Berechnet die verfügbaren Stunden für einen Tag.
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

// Sortierlogik für flexible Aufgaben (Priorität > Finanzieller Vorteil).
export function sortTasksByPriority(taskA, taskB) {
    // ... (Logik unverändert)
}

/**
 * Plant flexible Aufgaben und erstellt Schedule Items.
 */
function scheduleFlexibleTask(task, currentSchedule) {
    // ... (Logik unverändert)
}

/**
 * Berechnet das Zieldatum für fixe Aufgaben (Deadlines, Fixe Termine).
 */
function calculateFixedTaskDates(tasks) {
    const today = normalizeDate();

    tasks.forEach(task => {
        const duration = getOriginalTotalDuration(task);

        // Fall 1: Fixer Termin
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

        // Fall 2: Deadline (Versuche Puffer einzubauen)
        if (task.type === 'Deadline' && task.deadlineDate) {
            const originalDeadline = parseDateString(task.deadlineDate);
            if (originalDeadline) {
                // Berechne das späteste Startdatum (Deadline minus Dauer)
                // HINWEIS: Die Logik verwendet weiterhin volle Tage als Puffer für Einfachheit.
                // Die Uhrzeit der Deadline wird primär zur Anzeige und Sortierung genutzt.
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
 * Übernimmt Uhrzeit (fixedTime, deadlineTime).
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
            deadlineTime: task.deadlineTime || null, // NEU: Deadline Uhrzeit
            fixedDate: task.fixedDate,
            fixedTime: task.fixedTime || null,
            assignedTo: task.assignedTo,
            notes: task.notes,
            location: task.location,
            priority: task.priority || 3
        };
        currentSchedule.push(newItem);
    });
}


/**
 * Hauptfunktion zur Neuberechnung des Zeitplans.
 */
export function recalculateSchedule() {
    // ... (Vorbereitung und Filterung unverändert)

    // 3. Planungs-Subroutine
    const planTaskSet = (tasksToPlan, schedule) => {
        // Hierarchie 1 & 2: Termine und Deadlines
        let fixed = tasksToPlan.filter(t => t.type === 'Fixer Termin' || t.type === 'Deadline');
        // Hierarchie 3, 4, 5: Flexible Aufgaben
        let flexible = tasksToPlan.filter(t => t.type === 'Vorteil & Dauer');

        fixed = calculateFixedTaskDates(fixed);
        
        // GEÄNDERT: Sortierung der Fixen Aufgaben (Strikte Hierarchie: Termin > Deadline > Datum/Zeit)
        fixed.sort((a, b) => {
            // Regel 1: Termine vor Deadlines
            if (a.type === 'Fixer Termin' && b.type === 'Deadline') return -1;
            if (b.type === 'Fixer Termin' && a.type === 'Deadline') return 1;

            // Regel 2: Wenn Typ gleich ist, sortiere nach Datum
            const dateA = parseDateString(a.tempPlannedDate);
            const dateB = parseDateString(b.tempPlannedDate);
            if (!dateA) return 1;
            if (!dateB) return -1;
            
            if (dateA.getTime() !== dateB.getTime()) {
                return dateA.getTime() - dateB.getTime();
            }
            
            // Regel 3: Wenn das Datum gleich ist, sortiere nach Uhrzeit
            // Wir nutzen die jeweilige Zeit (fixedTime oder deadlineTime)
            let timeA = "00:00";
            let timeB = "00:00";

            // Da Regel 1 bereits Typenunterschiede behandelt hat, sind hier die Typen gleich.
            if (a.type === 'Fixer Termin') {
                timeA = a.fixedTime || "00:00";
                timeB = b.fixedTime || "00:00";
            } else if (a.type === 'Deadline') {
                // Bei Deadlines: Mit Zeit vor Ohne Zeit (sortiert sie früher am Tag).
                const dlTimeA = a.deadlineTime;
                const dlTimeB = b.deadlineTime;
                if (dlTimeA && !dlTimeB) return -1;
                if (dlTimeB && !dlTimeA) return 1;
                timeA = dlTimeA || "00:00";
                timeB = dlTimeB || "00:00";
            }
            
            return timeA.localeCompare(timeB);
        });
        scheduleFixedTasks(fixed, schedule);

        // Sortierung der Flexiblen Aufgaben
        flexible.sort(sortTasksByPriority);
        
        flexible.forEach(task => scheduleFlexibleTask(task, schedule));
    };

    // 4. Plane zuerst priorisierte, dann die anderen Aufgaben
    const newSchedule = [];
    planTaskSet(prioritizedTasks, newSchedule);
    planTaskSet(otherTasks, newSchedule);

    // 5. Aufräumen und State aktualisieren
    activeTasks.forEach(t => delete t.tempPlannedDate);
    state.schedule = newSchedule;
    // WICHTIG: Die Berechnung der exakten Zeiten erfolgt NICHT hier, sondern in main.js nach diesem Aufruf.
}


/**
 * NEU: Berechnet die exakten Start- und Endzeiten für den Schedule.
 * Muss NACH recalculateSchedule aufgerufen werden.
 */
export function calculateExactTimes(schedule) {
    // Setup
    const today = normalizeDate();
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();

    // Track usage of slots per day. Key: DateString, Value: Array of {startMins, endMins}
    const usedSlots = {};

    // Iterate schedule items (they are already sorted correctly by date and priority from recalculateSchedule)
    for (const item of schedule) {
        // Reset previous calculations
        delete item.calculatedStartTime;
        delete item.calculatedEndTime;

        if (!item.plannedDate) continue;

        const date = parseDateString(item.plannedDate);
        const dayName = getDayOfWeek(date);
        // Hole die definierten Arbeitszeitfenster für diesen Tag
        const availableSlots = (state.settings.dailyTimeSlots && state.settings.dailyTimeSlots[dayName]) || [];
        const durationMins = Math.round(item.scheduledDuration * 60);

        if (durationMins === 0) continue;

        // Initialisiere Used Slots für den Tag, falls noch nicht geschehen
        if (!usedSlots[item.plannedDate]) usedSlots[item.plannedDate] = [];
        const dayUsedSlots = usedSlots[item.plannedDate];

        // Behandle Fixe Termine zuerst (sie blockieren Zeit, auch außerhalb der definierten Arbeitszeiten)
        if (item.type === 'Fixer Termin' && item.fixedTime) {
             const startMins = timeToMins(item.fixedTime);
             const endMins = startMins + durationMins;
             item.calculatedStartTime = item.fixedTime;
             item.calculatedEndTime = minsToTime(endMins);
             // Füge den Slot hinzu und halte die Liste sortiert
             dayUsedSlots.push({startMins, endMins});
             dayUsedSlots.sort((a,b) => a.startMins - b.startMins);
             continue;
        }

        // Behandle Flexible/Deadline Aufgaben: Finde die nächste freie Lücke in den Arbeitszeitfenstern
        let placed = false;
        for (const slot of availableSlots) {
            let slotStart = timeToMins(slot.start);
            const slotEnd = timeToMins(slot.end);

            // Adjust start time if it's today (or past) and the slot started before now
            // Wir prüfen auf <= today.getTime(), da überfällige Aufgaben auch für "Heute" geplant werden.
            if (date.getTime() <= today.getTime() && slotStart < nowMins) {
                slotStart = nowMins;
            }

            // Finde die nächste freie Lücke innerhalb dieses Slots
            let currentPos = slotStart;
            while (currentPos < slotEnd) {
                // Prüfe auf Überschneidung mit bereits genutzten Slots (z.B. durch fixe Termine oder vorherige Aufgaben)
                const overlap = dayUsedSlots.find(used => currentPos >= used.startMins && currentPos < used.endMins);

                if (overlap) {
                    // Springe zum Ende des blockierten Slots
                    currentPos = overlap.endMins;
                    continue;
                }

                // Gefunden: Eine Lücke startet bei currentPos. Wie lang ist sie?
                // Sie dauert bis zum Ende des Arbeitszeitfensters ODER bis zum Start des nächsten genutzten Slots.
                const nextUsed = dayUsedSlots.find(used => used.startMins > currentPos);
                const gapEnd = Math.min(slotEnd, nextUsed ? nextUsed.startMins : Infinity);

                if (gapEnd - currentPos >= durationMins) {
                    // Es passt! Plane das Item hier ein.
                    const endMins = currentPos + durationMins;
                    item.calculatedStartTime = minsToTime(currentPos);
                    item.calculatedEndTime = minsToTime(endMins);
                    // Blockiere diesen Zeitraum
                    dayUsedSlots.push({startMins: currentPos, endMins});
                    dayUsedSlots.sort((a,b) => a.startMins - b.startMins);
                    placed = true;
                    break; // Verlasse die innere Schleife (while)
                } else {
                    // Lücke zu klein, springe zum Ende der Lücke (was dem nächsten genutzten Slot entspricht oder dem Ende des Arbeitsfensters)
                    currentPos = gapEnd;
                }
            }
            if (placed) break; // Verlasse die äußere Schleife (for slot of availableSlots)
        }
        // Da die Kapazitätsplanung (recalculateSchedule) zuerst läuft, sollte immer ein Platz gefunden werden.
    }
}



// --- Aktionen ---

export async function toggleTaskCompleted(taskId, isCompleted) {
    const task = state.tasks.find(t => t.id === taskId);
    if (task) {
        task.completed = isCompleted;
        // Setze oder entferne das Fertigstellungsdatum
        task.completedAt = isCompleted ? new Date().toISOString() : null;
        
        // Speichere die Änderung in der Datenbank
        await saveTaskDefinition(task);

        // Berechne den Zeitplan neu, damit die Aufgabe aus der Planung verschwindet/wieder auftaucht
        recalculateSchedule();
        calculateExactTimes(state.schedule); // NEU
    }
}

/**
 * Aktualisiert Details einer Aufgabe (aus dem Edit-Modal).
 * Behandelt Typänderungen, Besitzerwechsel, Uhrzeiten (inkl. Deadline Time) und Priorität.
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
    // Besitzerwechsel (falls durch UI Logik gesetzt)
    if (updatedDetails.ownerId !== undefined && updatedDetails.ownerId !== task.ownerId) {
        console.log(`Transferring ownership to ${updatedDetails.ownerId}`);
        task.ownerId = updatedDetails.ownerId;
    }

    // Aktualisiere Priorität
    if (updatedDetails.priority !== undefined) {
        task.priority = updatedDetails.priority;
    }

    // Wir speichern null, wenn das Feld leer ist.
    task.notes = updatedDetails.notes || null;
    task.location = updatedDetails.location || null;
    task.type = newType;

    // Behandle Typänderung - Lösche Felder des alten Typs
    if (oldType !== newType) {
        if (oldType === 'Vorteil & Dauer') {
            delete task.estimatedDuration;
            delete task.financialBenefit;
        } else if (oldType === 'Deadline') {
            delete task.deadlineDate;
            delete task.deadlineDuration;
            delete task.deadlineTime; // NEU: Lösche Deadline Time
        } else if (oldType === 'Fixer Termin') {
            delete task.fixedDate;
            delete task.fixedDuration;
            delete task.fixedTime;
        }
    }

    // Aktualisiere Typ-spezifische Felder des (neuen) Typs
    if (task.type === 'Vorteil & Dauer') {
        if (updatedDetails.estimatedDuration !== undefined) task.estimatedDuration = updatedDetails.estimatedDuration;
        if (updatedDetails.financialBenefit !== undefined) task.financialBenefit = updatedDetails.financialBenefit;
    } else if (task.type === 'Deadline') {
        if (updatedDetails.deadlineDate !== undefined) task.deadlineDate = updatedDetails.deadlineDate;
        if (updatedDetails.deadlineDuration !== undefined) task.deadlineDuration = updatedDetails.deadlineDuration;
        // NEU: Aktualisiere Deadline Uhrzeit
        if (updatedDetails.deadlineTime !== undefined) task.deadlineTime = updatedDetails.deadlineTime;

    } else if (task.type === 'Fixer Termin') {
        if (updatedDetails.fixedDate !== undefined) task.fixedDate = updatedDetails.fixedDate;
        if (updatedDetails.fixedDuration !== undefined) task.fixedDuration = updatedDetails.fixedDuration;
        // Aktualisiere Uhrzeit
        if (updatedDetails.fixedTime !== undefined) task.fixedTime = updatedDetails.fixedTime;
    }

    // 2. Speichere in DB (Der Listener wird das Update zurückmelden)
    await saveTaskDefinition(task);
    // 3. Berechne Schedule sofort neu für Responsivität
    recalculateSchedule();
    // NEU: Berechne Zeiten neu
    calculateExactTimes(state.schedule);
}

/**
 * Ändert die Priorität einer Aufgabe (über die Pfeile).
 */
export async function changeTaskPriority(taskId, direction) {
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    // Nur flexible Aufgaben dürfen über die Pfeile geändert werden.
    // Termine und Deadlines haben implizit eine höhere Priorität.
    if (task.type !== 'Vorteil & Dauer') return;

    const currentPriority = task.priority || 3;
    let newPriority = currentPriority;

    // Richtung 'up' erhöht den Wert (bis 5), 'down' verringert ihn (bis 1).
    if (direction === 'up' && currentPriority < 5) {
        newPriority++;
    } else if (direction === 'down' && currentPriority > 1) {
        newPriority--;
    }

    if (newPriority !== currentPriority) {
        task.priority = newPriority;
        // Speichern und neu berechnen
        await saveTaskDefinition(task);
        recalculateSchedule();
        calculateExactTimes(state.schedule); // NEU
    }
}
