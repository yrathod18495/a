// Effects of a background (colour looks): a background clip can carry one, and it is drawn with that tint in the preview and in the export.
// The order is the order of the list in the studio: None, Night, Evening, Dawn, Gloomy.
export const BG_EFFECTS = Object.freeze([
  { id: 'none', name: 'None', tint: [1, 1, 1], dot: '#cfd2da' },
  { id: 'night', name: 'Night', tint: [0.3, 0.38, 0.72], dot: '#2b3a78' },
  { id: 'evening', name: 'Evening', tint: [1, 0.7, 0.5], dot: '#f08a4b' },
  { id: 'dawn', name: 'Dawn', tint: [1, 0.86, 0.92], dot: '#f3b6c8' },
  { id: 'gloomy', name: 'Gloomy', tint: [0.6, 0.66, 0.72], dot: '#6c7a88' },
]);
export const bgEffectId = (id) => (BG_EFFECTS.some((e) => e.id === id) && id !== 'none' ? id : null);
export const bgTint = (id) => (BG_EFFECTS.find((e) => e.id === id)?.tint) || [1, 1, 1];
