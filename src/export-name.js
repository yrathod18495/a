// The name a finished video is saved under: 12Toons_<mmddyy>_<project id>.mp4 (the same on this device and in the cloud).
const pad = (n) => String(n).padStart(2, '0');
export function exportFileName(projectId, ext = 'mp4', when = new Date()) {
  const id = String(projectId ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'project';
  return `12Toons_${pad(when.getMonth() + 1)}${pad(when.getDate())}${String(when.getFullYear()).slice(-2)}_${id}.${ext}`;
}
