import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app, firebaseConfig } from './firebase.js';
import { apiCall } from './session.js';

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';
const enabledKey = uid => `12toons-push-enabled:${uid}`;
const tokenKey = uid => `12toons-push-token:${uid}`;
let foregroundReady = false;

export function replyNotificationsEnabled(uid) {
  try { return localStorage.getItem(enabledKey(uid)) === '1'; } catch { return false; }
}

async function messagingSupport() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isSupported())) {
    throw new Error('This browser does not support push notifications.');
  }
}

async function registerPush(user) {
  if (!vapidKey) throw new Error('Push setup is incomplete. Add VITE_FIREBASE_VAPID_KEY from Firebase Console → Project settings → Cloud Messaging → Web Push certificates.');
  const swConfig = encodeURIComponent(JSON.stringify(firebaseConfig));
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?config=${swConfig}`, { scope: '/' });
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('The browser did not create a push subscription. Try enabling notifications again.');
  await apiCall('/api/notifications', { action: 'register', token }, user.uid);
  try { localStorage.setItem(tokenKey(user.uid), token); localStorage.setItem(enabledKey(user.uid), '1'); } catch { /* Server registration still works for this session. */ }
  if (!foregroundReady) {
    foregroundReady = true;
    onMessage(messaging, payload => {
      if (Notification.permission !== 'granted') return;
      const data = payload.data || {};
      const notification = new Notification(data.title || 'New reply from 12toons', { body: data.body || 'Open your support chat to read the reply.' });
      notification.onclick = () => { window.focus(); location.href = new URL(data.url || '/#/', location.origin).href; notification.close(); };
    });
  }
  return token;
}

export async function enableReplyNotifications(user) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('This browser does not support push notifications.');
  if (Notification.permission === 'denied') throw new Error('Notifications are blocked in browser settings. Allow them for this site, then try again.');
  // Start the browser prompt directly in the profile-menu click gesture.
  const permissionRequest = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
  await messagingSupport();
  if (await permissionRequest !== 'granted') throw new Error('Notification permission was not granted. You can enable it later in browser settings.');
  await registerPush(user);
  return 'Reply notifications are enabled on this device.';
}

export async function disableReplyNotifications(user) {
  const token = (() => { try { return localStorage.getItem(tokenKey(user.uid)); } catch { return null; } })();
  let failure = null;
  if (token) {
    try { await apiCall('/api/notifications', { action: 'remove', token }, user.uid); }
    catch (error) { failure = error; }
  }
  try { if ('serviceWorker' in navigator && await isSupported()) await deleteToken(getMessaging(app)); }
  catch (error) { failure ||= error; }
  try { localStorage.removeItem(enabledKey(user.uid)); localStorage.removeItem(tokenKey(user.uid)); } catch { /* Browser storage is optional. */ }
  if (failure) throw failure;
  return 'Reply notifications are turned off on this device.';
}

export async function toggleReplyNotifications(user) {
  return replyNotificationsEnabled(user.uid) ? disableReplyNotifications(user) : enableReplyNotifications(user);
}

export async function syncReplyNotifications(user) {
  if (!replyNotificationsEnabled(user.uid) || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { await messagingSupport(); await registerPush(user); }
  catch (error) { console.warn('Push notification registration could not be refreshed:', error.message); }
}
