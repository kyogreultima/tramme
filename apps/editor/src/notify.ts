// Telling the user a long task is over (an assistant turn, and any other) or
// that the editor waits for their answer: a notification of the system when
// the editor is in the background and allowed to, a message in the editor
// otherwise. The desktop app's web view shows no web notification: it sends
// them through its notification plugin (apps/desktop/src-tauri), which the
// system's own settings allow or not.

import { toast } from './state.ts';
import { tauri } from './tauri.ts';

const supported = () => !!tauri || typeof Notification !== 'undefined';

/** the browser's answer for the notifications: asked only when it was never given (from a click) */
export async function allowNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (tauri) return 'granted';
  if (!supported()) return 'unsupported';
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

/** what the browser says now, without asking */
export const notificationState = (): NotificationPermission | 'unsupported' => (tauri ? 'granted' : supported() ? Notification.permission : 'unsupported');

/** the user is elsewhere: another tab, another window */
export const away = () => document.hidden || !document.hasFocus();

export function notify(title: string, body: string, kind: 'info' | 'error' = 'info', opts?: { attention?: boolean }) {
  if (away() && notificationState() === 'granted') {
    if (tauri) {
      tauri.core.invoke('plugin:notification|notify', { options: { title, body } }).catch(() => toast(body, kind, 6000));
      // a notification alone does not bring the user back (its click is not reported): the window asks for attention too
      if (opts?.attention) tauri.window.getCurrentWindow().requestUserAttention(2).catch(() => {});
      return;
    }
    // one at a time: a new one replaces the previous (same tag)
    const n = new Notification(title, { body, tag: 'tramme' });
    n.onclick = () => { focus(); n.close(); };
    return;
  }
  toast(body, kind, 6000);
}

/**
 * The attention request cancelled the moment the window is focused again, or
 * when the question is answered or withdrawn first (the returned function:
 * the dialog calls it as it closes).
 */
export function attend(): () => void {
  if (!tauri) return () => {};
  const w = tauri.window.getCurrentWindow();
  const stop = () => { window.removeEventListener('focus', stop); w.requestUserAttention(null).catch(() => {}); };
  window.addEventListener('focus', stop, { once: true });
  return stop;
}
