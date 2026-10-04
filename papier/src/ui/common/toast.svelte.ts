export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error' | 'busy';
}

/** Notifications discrètes en bas de l'écran. */
export const toasts = $state<Toast[]>([]);
let seq = 0;

export function showToast(message: string, kind: Toast['kind'] = 'info', duration = 3500): number {
  const id = ++seq;
  toasts.push({ id, message, kind });
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** Exécute une tâche longue en affichant un indicateur, puis un message de succès ou d'erreur. */
export async function withBusy<T>(message: string, task: () => Promise<T>, done?: (result: T) => string | null): Promise<T | undefined> {
  const id = showToast(message, 'busy', 0);
  try {
    const result = await task();
    dismissToast(id);
    const msg = done?.(result);
    if (msg) showToast(msg);
    return result;
  } catch (err) {
    dismissToast(id);
    console.error(err);
    showToast(err instanceof Error && err.message ? err.message : 'Une erreur est survenue.', 'error', 6000);
    return undefined;
  }
}
