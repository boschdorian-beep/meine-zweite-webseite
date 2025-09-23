// js/scheduler.js
import { state } from './state.js';
import { getDayOfWeek, formatDateToYYYYMMDD, normalizeDate } from './utils.js';
import { saveTasks } from './storage.js';

/**
 * Helper to get the relevant duration of a task.
 */
export function getTaskDuration(task) {
    if (task.scheduledDuration !== undefined) return parseFloat(task.scheduledDuration) || 0;
    if (task.type === 'Vorteil & Dauer') return parseFloat(task.estimatedDuration) || 0;
    if (task.type === 'Deadline') return parseFloat(task.deadlineDuration) || 0;
    if (task.type === 'Fixer Termin') return parseFloat(task.fixedDuration) || 0;
    return 0;
}

/**
 * Calculates the total available working hours for a given date.
 */
export function getDailyAvailableHours(date) {
    const dayName = getDayOfWeek(date);
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
        const duration = parseFloat(task.estimatedDuration) || 0;
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
            return new Date(taskA.plannedDate).getTime() - new Date(taskB.plannedDate).getTime();
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
 */
function scheduleVorteilDauerTask(originalTask, currentSchedule) {
    const totalRequiredDuration = parseFloat(originalTask.estimatedDuration) || 0;

    if (totalRequiredDuration <= 0) {
        // Handle zero duration task
        const newPart = {
            ...originalTask,
            id: `${originalTask.id}-${Date.now()}-1`,
            originalId: originalTask.id,
            plannedDate: formatDateToYYYYMMDD(normalizeDate(new Date())),
            scheduledDuration: 0
        };
        currentSchedule.push(newPart);
        return;
    }

    let remainingDuration = totalRequiredDuration;
    let currentDate = normalizeDate(new Date());
    let partIndex = 1;
    const originalDescription = originalTask.description;

    while (remainingDuration > 0) {
        const consumedHours = getConsumedHoursForDay(currentDate, currentSchedule);
        const availableToday = getDailyAvailableHours(currentDate) - consumedHours;

        if (availableToday <= 0.01) { // Small tolerance for float comparison
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

        // Update description if split
        if (remainingDuration > durationForPart || partIndex > 1) {
             newPart.description = `${originalDescription} (Teil ${partIndex})`;
        } else {
            newPart.description = originalDescription;
        }

        currentSchedule.push(newPart);
        remainingDuration -= durationForPart;
        partIndex++;

        if (remainingDuration > 0) {
            currentDate.setDate(currentDate.getDate() + 1);
        }
    }
}

/**
 * Prepares Fixed and Deadline tasks (setting plannedDate and scheduledDuration).
 */
function prepareFixedAndDeadlineTasks(tasks) {
    tasks.forEach(task => {
        const duration = getTaskDuration(task);
        task.scheduledDuration = duration;

        if (task.type === 'Fixer Termin' && task.fixedDate) {
            task.plannedDate = task.fixedDate;
        } else if (task.type === 'Deadline' && task.deadlineDate) {
            // Deadline Buffer Logic (1 Tag Puffer pro Stunde)
            const originalDeadline = normalizeDate(new Date(task.deadlineDate));
            const bufferedDeadline = new Date(originalDeadline);
            bufferedDeadline.setDate(originalDeadline.getDate() - Math.floor(duration));
            task.plannedDate = formatDateToYYYYMMDD(bufferedDeadline);
        }
    });
    return tasks;
}


/**
 * Main function to recalculate the entire schedule.
 */
export function recalculateSchedule() {
    console.log("Recalculating full schedule...");

    // 1. Separate tasks
    const completedTasks = state.tasks.filter(t => t.completed);
    let fixedAndDeadlineTasks = state.tasks.filter(t => !t.completed && (t.type === 'Fixer Termin' || t.type === 'Deadline'));
    
    // Collect original 'Vorteil & Dauer' tasks (reconstruct from parts)
    // We iterate through the existing state.tasks to preserve manual order if autoPriority is OFF.
    const originalVorteilDauerMap = new Map();
    state.tasks.filter(t => !t.completed && t.type === 'Vorteil & Dauer').forEach(task => {
        const originalId = task.originalId || task.id;
        if (!originalVorteilDauerMap.has(originalId)) {
            originalVorteilDauerMap.set(originalId, {
                id: originalId,
                description: task.description.replace(/ \(Teil \d+\)$/, ''),
                type: task.type,
                completed: false,
                estimatedDuration: task.estimatedDuration,
                financialBenefit: task.financialBenefit
            });
        }
    });
    const vorteilDauerTasks = Array.from(originalVorteilDauerMap.values());

    // 2. Prepare Fixed/Deadline tasks (they dictate capacity)
    fixedAndDeadlineTasks = prepareFixedAndDeadlineTasks(fixedAndDeadlineTasks);
    const newSchedule = [...fixedAndDeadlineTasks];

    // 3. Sort 'Vorteil & Dauer' tasks based on settings
    // Only sort if autoPriority is ON. If OFF, the order from the Map (which reflects manual sorting) is used.
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
 */
export function toggleTaskCompleted(taskId, isCompleted) {
    const taskIndex = state.tasks.findIndex(task => task.id === taskId);
    if (taskIndex > -1) {
        state.tasks[taskIndex].completed = isCompleted;
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