// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate, parseDateString } from './utils.js';
import { saveTasks } from './storage.js';

// Safety brake: Stop searching after 1 year if no capacity is found
const MAX_SCHEDULING_HORIZON = 365;
// Tolerance for float comparisons (approx. 36 seconds) to prevent infinite loops due to rounding errors
const EPSILON = 0.01;

/**
 * Helper to get the duration of the specific scheduled part (split task).
 */
export function getTaskDuration(task) {
    // Always prefer the duration specifically allocated to this scheduled part
    if (task.scheduledDuration !== undefined) {
        return parseFloat(task.scheduledDuration) || 0;
    }
    // Fallback for non-scheduled or legacy tasks
    return getOriginalTotalDuration(task);
}

/**
 * Helper to get the original total duration of a task (before splitting).
 */
function getOriginalTotalDuration(task) {
    if (task.type === 'Vorteil & Dauer') return parseFloat(task.estimatedDuration) || 0;
    if (task.type === 'Deadline') return parseFloat(task.deadlineDuration) || 0;
    if (task.type === 'Fixer Termin') return parseFloat(task.fixedDuration) || 0;
    return 0;
}


/**
 * Calculates the total available working hours for a given date.
 * Relies on settings being pre-validated (start time < end time) by storage.js.
 */
export function getDailyAvailableHours(date) {
    const dayName = getDayOfWeek(date);

     // Defensive check
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

        // Since validation ensures start < end, we can calculate directly.
        if (endTotalMinutes > startTotalMinutes) {
             totalHours += (endTotalMinutes - startTotalMinutes) / 60;
        }
    });
    return totalHours;
}

/**
 * Calculates the consumed hours for a given day by tasks in the provided list.
 */
function getConsumedHoursForDay(date, taskList) {
    const dateStr = formatDateToYYYYMMDD(date);
    return taskList.reduce((sum, task) => {
        if (task.completed || task.plannedDate !== dateStr) {
            return sum;
        }
        return sum + getTaskDuration(task);
    }, 0);
}

/**
 * Compares two tasks for sorting based on priority rules.
 */
export function sortTasksByPriority(taskA, taskB) {
    const getBenefitPerHour = (task) => {
        const benefit = parseFloat(task.financialBenefit) || 0;
        // Use original estimated duration for accurate benefit calculation
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
    // Only apply if calcPriority is enabled
    if (state.settings.calcPriority) {
        const benefitA = getBenefitPerHour(taskA);
        const benefitB = getBenefitPerHour(taskB);

        if (benefitA > 0 || benefitB > 0) {
            return benefitB - benefitA; // Higher benefit per hour first
        }
    }

    // 5. Maintain order
    return 0;
}

/**
 * Schedules a 'Vorteil & Dauer' task, potentially splitting it.
 * Uses EPSILON and MAX_SCHEDULING_HORIZON to prevent infinite loops.
 */
function scheduleVorteilDauerTask(originalTask, currentSchedule) {
    const totalRequiredDuration = getOriginalTotalDuration(originalTask);

    // Handle tasks without meaningful duration
    if (totalRequiredDuration <= EPSILON) {
        const newPart = {
            ...originalTask,
            id: `${originalTask.id}-${Date.now()}-1`,
            originalId: originalTask.id,
            plannedDate: formatDateToYYYYMMDD(normalizeDate()),
            scheduledDuration: 0
        };
        currentSchedule.push(newPart);
        return;
    }

    let remainingDuration = totalRequiredDuration;
    const startDate = normalizeDate();
    let currentDate = normalizeDate(startDate);
    let partIndex = 1;
    const originalDescription = originalTask.description;

    // Loop while meaningful duration remains
    while (remainingDuration > EPSILON) {

        // --- FIX: Safety Brake (Prevent Infinite Loop) ---
        const daysTried = (currentDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysTried > MAX_SCHEDULING_HORIZON) {
            console.warn(`Scheduling aborted for task "${originalTask.description}". No availability found within ${MAX_SCHEDULING_HORIZON} days.`);
            // Mark the remaining part as unscheduled (plannedDate: null)
             const newPart = {
                ...originalTask,
                id: `${originalTask.id}-${Date.now()}-UNSCHEDULED`,
                originalId: originalTask.id,
                plannedDate: null,
                scheduledDuration: remainingDuration,
                description: `${originalDescription} (Nicht planbar - Keine Kapazität)`
            };
            currentSchedule.push(newPart);
            return;
        }
        // -------------------------------------------------

        const consumedHours = getConsumedHoursForDay(currentDate, currentSchedule);
        const availableToday = getDailyAvailableHours(currentDate) - consumedHours;

        // If no meaningful time available today, move to next day
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
            scheduledDuration: durationForPart
        };

        // Update description if the task is split
        if (remainingDuration > durationForPart + EPSILON || partIndex > 1) {
             newPart.description = `${originalDescription} (Teil ${partIndex})`;
        } else {
            newPart.description = originalDescription;
        }

        currentSchedule.push(newPart);
        remainingDuration -= durationForPart;
        partIndex++;

        // Move to the next day if still duration remaining
        if (remainingDuration > EPSILON) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
}

/**
 * Prepares Fixed and Deadline tasks (setting plannedDate and scheduledDuration).
 */
function prepareFixedAndDeadlineTasks(tasks) {
    tasks.forEach(task => {
        // Ensure the task object has a unique ID and originalId if it's new
         if (!task.originalId) {
            task.originalId = task.id;
        }
        // Ensure the ID is unique for this specific instance (important if the same task is rescheduled)
        task.id = `${task.originalId}-${Date.now()}`;


        const duration = getOriginalTotalDuration(task);
        // For these types, the scheduled duration is the total duration (they don't split)
        task.scheduledDuration = duration;

        if (task.type === 'Fixer Termin' && task.fixedDate) {
            task.plannedDate = task.fixedDate;
        } else if (task.type === 'Deadline' && task.deadlineDate) {
            // Deadline Buffer Logic (1 Tag Puffer pro Stunde)
            const originalDeadline = parseDateString(task.deadlineDate);
            if (originalDeadline) {
                const bufferedDeadline = new Date(originalDeadline);
                // Use floor to ensure whole days are subtracted
                bufferedDeadline.setDate(originalDeadline.getDate() - Math.floor(duration));
                task.plannedDate = formatDateToYYYYMMDD(bufferedDeadline);
            }
        }
    });
    return tasks;
}


/**
 * Main function to recalculate the entire schedule.
 */
export function recalculateSchedule() {
    // console.log("Recalculating full schedule..."); // Optional: for debugging

    // 1. Separate tasks
    const completedTasks = state.tasks.filter(t => t.completed);
    let fixedAndDeadlineTasks = state.tasks.filter(t => !t.completed && (t.type === 'Fixer Termin' || t.type === 'Deadline'));

    // Collect original 'Vorteil & Dauer' tasks (reconstruct from parts)
    // We iterate through the existing state.tasks to preserve manual order if autoPriority is OFF.
    const originalVorteilDauerMap = new Map();
    state.tasks.filter(t => !t.completed && t.type === 'Vorteil & Dauer').forEach(task => {
        const originalId = task.originalId || task.id;
        if (!originalVorteilDauerMap.has(originalId)) {
            // Clean up description from previous scheduling attempts
            let cleanDescription = task.description.replace(/ \(Teil \d+\)$/, '');
            cleanDescription = cleanDescription.replace(/ \(Nicht planbar - Keine Kapazität\)$/, '');

            originalVorteilDauerMap.set(originalId, {
                id: originalId,
                description: cleanDescription,
                type: task.type,
                completed: false,
                estimatedDuration: task.estimatedDuration, // Keep original total duration
                financialBenefit: task.financialBenefit
            });
        }
    });
    const vorteilDauerTasks = Array.from(originalVorteilDauerMap.values());

    // 2. Prepare Fixed/Deadline tasks (they dictate capacity)
    fixedAndDeadlineTasks = prepareFixedAndDeadlineTasks(fixedAndDeadlineTasks);
    const newSchedule = [...fixedAndDeadlineTasks];

    // 3. Sort 'Vorteil & Dauer' tasks based on settings
    // Only sort if autoPriority is ON.
    if (state.settings.autoPriority) {
        vorteilDauerTasks.sort(sortTasksByPriority);
    }

    // 4. Schedule 'Vorteil & Dauer' tasks sequentially
    vorteilDauerTasks.forEach(task => {
        scheduleVorteilDauerTask(task, newSchedule);
    });

    // 5. Combine and save
    state.tasks = [...newSchedule, ...completedTasks];
    saveTasks();
}

/**
 * Toggles completion status and triggers rescheduling.
 * Handles split tasks by ensuring all parts are toggled together.
 */
export function toggleTaskCompleted(taskId, isCompleted) {
    const taskIndex = state.tasks.findIndex(task => task.id === taskId);

    if (taskIndex > -1) {
        // Find the originalId of the task being toggled
        const originalId = state.tasks[taskIndex].originalId || state.tasks[taskIndex].id;

        // Update ALL parts of the original task
        state.tasks.forEach(task => {
            if ((task.originalId || task.id) === originalId) {
                task.completed = isCompleted;
            }
        });

        // When a task status changes, capacity changes, so we must recalculate.
        recalculateSchedule();
    }
}

/**
 * Updates task order after drag-and-drop and triggers rescheduling.
 */
export function updateTaskOrder(draggedId, dropId, insertBefore) {
    const draggedTaskIndex = state.tasks.findIndex(task => task.id === draggedId);

    if (draggedTaskIndex > -1) {
        const [removed] = state.tasks.splice(draggedTaskIndex, 1);

        // Find the new index of the drop target after the splice
        const newDropIndex = state.tasks.findIndex(task => task.id === dropId);

        if (newDropIndex > -1) {
            if (insertBefore) {
                state.tasks.splice(newDropIndex, 0, removed);
            } else {
                state.tasks.splice(newDropIndex + 1, 0, removed);
            }
        } else {
            // Fallback if dropped at the very end
            state.tasks.push(removed);
        }

        // Since the order changed, recalculate the schedule respecting this new manual order.
        recalculateSchedule();
    }
}
