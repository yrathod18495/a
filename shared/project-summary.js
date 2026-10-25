// What the admin dashboard shows about a saved project (audio lines). The browser computes it from the project it is saving; the server only cleans it.
export function summarizeProjectSnapshot(manifest, limit = 100) {
  const rows = manifest.records || [], project = rows.find((r) => r.store === 'project' && r.value?.id === 'current')?.value;
  const lineInfo = new Map((Array.isArray(project?.lines) ? project.lines : []).filter((line) => line?.id).map((line) => [line.id, line]));
  const audio = rows.filter((r) => r.store === 'audio' && r.value?.id);
  const files = audio.slice(0, limit).map(({ value }) => {
    const line = lineInfo.get(value.id) || {};
    return { id: String(value.id).slice(0, 128), filename: typeof line.file === 'string' ? line.file.slice(0, 240) : '', speaker: typeof line.speaker === 'string' ? line.speaker.slice(0, 120) : '', order: Number.isSafeInteger(line.order) ? line.order : null, available: !!value.raw?.__asset };
  });
  return { audioCount: audio.length, audioFiles: files, audioFilesTruncated: audio.length > limit };
}
/** whatever the browser sent as a summary, reduced to the same safe shape */
export function cleanSummary(input, limit = 100) {
  const files = Array.isArray(input?.audioFiles) ? input.audioFiles.slice(0, limit) : [];
  return {
    audioCount: Number.isSafeInteger(input?.audioCount) && input.audioCount >= 0 ? Math.min(input.audioCount, 100000) : files.length,
    audioFiles: files.map((f) => ({ id: String(f?.id ?? '').slice(0, 128), filename: String(f?.filename ?? '').slice(0, 240), speaker: String(f?.speaker ?? '').slice(0, 120), order: Number.isSafeInteger(f?.order) ? f.order : null, available: f?.available === true })),
    audioFilesTruncated: input?.audioFilesTruncated === true || (Number(input?.audioCount) || 0) > limit,
  };
}
