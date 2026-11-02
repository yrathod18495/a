#!/usr/bin/env node
// Creates (or resets) the temporary test account for the email + password login on the login page.
// The server only accepts accounts whose email is verified, so this sets emailVerified = true (the Firebase console cannot do that).
// Needs the Firebase Admin key in the environment, the same one the server uses:
//   FIREBASE_ADMIN_CREDENTIALS='{"type":"service_account",...}' node scripts/create-test-user.mjs test@gmail.com 'the-password'
// Remove the account again with:  node scripts/create-test-user.mjs --delete test@gmail.com
import { services } from '../server/firebase-admin.js';

const args = process.argv.slice(2), remove = args[0] === '--delete';
const [email, password] = remove ? [args[1]] : args;
if (!email || (!remove && !password)) { console.error("Usage: node scripts/create-test-user.mjs <email> '<password>'   |   --delete <email>"); process.exit(1); }
if (!remove && password.length < 6) { console.error('Firebase needs a password of at least 6 characters.'); process.exit(1); }
const { auth } = services();
try {
  const existing = await auth.getUserByEmail(email).catch((e) => (e.code === 'auth/user-not-found' ? null : Promise.reject(e)));
  if (remove) { if (existing) { await auth.deleteUser(existing.uid); console.log(`Deleted ${email}.`); } else console.log(`${email} does not exist.`); }
  else if (existing) { await auth.updateUser(existing.uid, { password, emailVerified: true, disabled: false }); console.log(`Updated ${email} (password reset, email marked verified). uid: ${existing.uid}`); }
  else { const user = await auth.createUser({ email, password, emailVerified: true, displayName: 'Test User' }); console.log(`Created ${email} (email marked verified). uid: ${user.uid}`); }
  console.log('This account is a normal user. It is not an admin.');
} catch (e) { console.error(`Could not do that: ${e.message}`); process.exit(1); }
