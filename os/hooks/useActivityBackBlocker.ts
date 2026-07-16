import { useEffect } from 'react';
import { useActivityContext } from '../ActivityContext';
import { BackDispatcher } from '../BackDispatcher';

/**
 * Temporarily consume system/edge Back for the foreground Activity.
 *
 * Apps use this for short, non-cancellable commit phases such as persisting a
 * confirmed multi-file send. Keyboard, permission, and system overlays retain
 * their higher Back priorities and still close first.
 */
export function useActivityBackBlocker(key: string, blocked: boolean): void {
  const { activityId, taskId } = useActivityContext();

  useEffect(() => {
    if (!blocked || !activityId || !taskId) return;
    return BackDispatcher.register(
      `activity.backBlocker.${key}.${activityId}`,
      () => {
        const state = window.__OS__?.getState?.();
        const activeTask = state?.activeTaskId
          ? state.tasks.find((task) => task.taskId === state.activeTaskId)
          : null;
        const topActivity = activeTask?.stack[activeTask.stack.length - 1];
        return activeTask?.taskId === taskId && topActivity?.activityId === activityId;
      },
      650,
    );
  }, [activityId, blocked, key, taskId]);
}

export default useActivityBackBlocker;
