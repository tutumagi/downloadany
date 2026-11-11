const DIR = 'downloadany-temp';
export const FILE_TTL_MS = 3 * 60 * 60 * 1000;
export const LINK_TTL_MS = 2 * 60 * 60 * 1000;

export async function openTempDirectory(create: boolean) {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });
}

export async function expireTemporaryFiles(now = Date.now()) {
  let dir: FileSystemDirectoryHandle;
  try { dir = await openTempDirectory(false); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
  for await (const [name, handle] of dir.entries()) {
    const created = /^([0-9]+)-[0-9a-f-]{36}\.mp4$/i.exec(name);
    if (handle.kind === 'file' && created && Number(created[1]) <= now - FILE_TTL_MS) {
      await dir.removeEntry(name).catch(() => {});
    }
  }
}
