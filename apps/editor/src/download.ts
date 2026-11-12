// Saving a file on the user's computer: the system's save dialog when the
// browser has one, a download otherwise. On a phone's app: the sheet that saves
// to the gallery or the downloads, or shares (device.ts).

import { saveOnDevice } from './device.ts';
import { platform } from './tauri.ts';

export async function saveBlob(blob: Blob, name: string): Promise<boolean> {
  if (platform === 'android') return saveOnDevice(blob, name);
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      const ext = name.includes('.') ? name.slice(name.indexOf('.')) : '';
      const handle = await picker({ suggestedName: name, types: ext ? [{ description: name, accept: { [blob.type || 'application/octet-stream']: [ext.slice(ext.lastIndexOf('.'))] } }] : undefined });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
      // a type the dialog refuses: fall back to a download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}
