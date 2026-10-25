import { getApps, initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getDatabase } from 'firebase-admin/database';

const SERVICE_ACCOUNT = process.env.FIREBASE_ADMIN_CREDENTIALS
  ? JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS)
  : null;
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'twelvelabs-studio-209137-11a91';
const FIRESTORE_DATABASE = process.env.FIRESTORE_DATABASE_ID || '(default)';
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL || '';   // Realtime Database: https://<project>-default-rtdb.<region>.firebasedatabase.app

export function services() {
  const app = getApps()[0] || initializeApp({
    credential: SERVICE_ACCOUNT ? cert(SERVICE_ACCOUNT) : applicationDefault(),
    projectId: FIREBASE_PROJECT,
    ...(DATABASE_URL ? { databaseURL: DATABASE_URL } : {}),
  });
  return {
    auth: getAuth(app),
    db: getFirestore(app, FIRESTORE_DATABASE),
    messaging: getMessaging(app),
    rtdb: DATABASE_URL ? getDatabase(app) : null,      // null until FIREBASE_DATABASE_URL is set; callers fall back to Firestore or say so in Hinglish
  };
}
