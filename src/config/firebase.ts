import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Env } from "./env.js";

function missingFirebaseFields(env: Env): string[] {
  const missing = [];

  if (!env.firebaseProjectId) {
    missing.push("FIREBASE_PROJECT_ID");
  }

  if (!env.firebaseClientEmail) {
    missing.push("FIREBASE_CLIENT_EMAIL");
  }

  if (!env.firebasePrivateKey) {
    missing.push("FIREBASE_PRIVATE_KEY");
  }

  return missing;
}

export function assertFirebaseConfigured(env: Env): void {
  const missing = missingFirebaseFields(env);

  if (missing.length > 0) {
    throw new Error(
      `Firebase is required in firestore mode. Missing: ${missing.join(", ")}`
    );
  }
}

export function getFirebaseApp(env: Env): App {
  assertFirebaseConfigured(env);

  const existingApp = getApps()[0];

  if (existingApp) {
    return existingApp;
  }

  return initializeApp({
    credential: cert({
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: env.firebasePrivateKey
    })
  });
}

export function getFirestoreDb(env: Env): Firestore {
  const app = getFirebaseApp(env);

  return getFirestore(app);
}
