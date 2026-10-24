export const MAX_ANIMATION_BYTES = 4 * 1024 * 1024;
export const ANIMATION_LAYERS = ['body', 'hand', 'legs', 'face'];
export function animationData(raw) {
  if (!raw || typeof raw !== 'object' || raw.skeleton?.spine || raw.spine) throw Error('DragonBones animation ki JSON file chunein.');
  const animation = raw.armature?.[0]?.animation?.[0] || (Array.isArray(raw.bone) || Array.isArray(raw.slot) ? raw : Object.values(raw).find(value => value && (Array.isArray(value.bone) || Array.isArray(value.slot))));
  if (!animation || !(animation.bone?.length || animation.slot?.length) || !Number.isFinite(animation.duration) || animation.duration < 1 || animation.duration > 1e7) throw Error('File me ek sahi DragonBones animation honi chahiye.');
  return animation;
}
export function animationTarget(value, manifest) {
  return manifest.characters.flatMap(character => character.poses.map(pose => `ad-${character.id}-${pose.pose}`)).includes(value);
}

/** Keep motion duration when the uploaded clip and target rig use different FPS. */
export function retimeAnimation(animation, targetFps) {
  const sourceFps = animation._sourceFrameRate;
  if (!sourceFps || sourceFps === targetFps) return animation;
  const scale = targetFps / sourceFps;
  const copy = value => {
    if (Array.isArray(value)) {
      let elapsed = 0;
      return value.map(item => {
        const next = copy(item);
        if (item && typeof item === 'object' && typeof item.duration === 'number') {
          next.duration = Math.round((elapsed + item.duration) * scale) - Math.round(elapsed * scale);
          elapsed += item.duration;
        }
        return next;
      });
    }
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'duration' && typeof item === 'number' ? Math.round(item * scale) : copy(item)]));
  };
  const result = copy(animation); result._sourceFrameRate = targetFps; return result;
}
