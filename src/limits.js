// What one user may keep in their account (checked in the Character Studio and again by the server, api/r2.js).
export const LIMITS = {
  characters: 20,                       // saved characters per user
  pageBytes: 15 * 1024 * 1024,          // one picture page of a character
  characterBytes: 40 * 1024 * 1024,     // all pictures of one character
  userBytes: 300 * 1024 * 1024,         // everything one user keeps in the cloud
};
export const mb = (n) => `${Math.round(n / 1048576)} MB`;
