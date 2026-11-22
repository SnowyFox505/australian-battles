"use client";
import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from "firebase/firestore";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-australian-battles",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
// Some mobile networks and proxies buffer Firestore's streaming connection, which delays live
// updates by seconds. Auto-detect switches to long polling in exactly that case.
function createFirestore() {
  try {
    return initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  } catch {
    return getFirestore(app); // already initialised (hot reload)
  }
}
export const firestore = createFirestore();

const g = globalThis as unknown as { __abEmu?: boolean };
if (typeof window !== "undefined" && process.env.NEXT_PUBLIC_USE_EMULATOR === "true" && !g.__abEmu) {
  g.__abEmu = true;
  const host = window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, 8080);
}
