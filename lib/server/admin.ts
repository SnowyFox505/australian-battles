import "server-only";
import { generateKeyPairSync } from "node:crypto";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function init(): App {
  if (getApps().length) return getApps()[0];
  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-australian-battles";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  }
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Missing FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY (or run against the emulators)");
  }
  // Local development against the emulators: no real credentials exist. A throwaway key keeps
  // the SDK from probing the (non-existent) cloud metadata server, which stalls requests.
  const { privateKey: pem } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return initializeApp({
    projectId,
    credential: cert({ projectId, clientEmail: "emulator@demo.iam.gserviceaccount.com", privateKey: pem }),
  });
}

// Lazy: Next.js imports route modules at build time, when no credentials exist.
export const getDb = () => getFirestore(init());
const getAdminAuth = () => getAuth(init());

export async function uidFromRequest(req: Request): Promise<string> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new HttpError(401, "Not signed in");
  try {
    return (await getAdminAuth().verifyIdToken(token)).uid;
  } catch {
    throw new HttpError(401, "Invalid session");
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Runs an action and turns its result (or error) into the JSON response the client expects. */
export async function respond(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return Response.json({ ok: true, serverNow: Date.now(), ...((data as object | undefined) ?? {}) });
  } catch (e) {
    if (e instanceof HttpError) {
      return Response.json({ ok: false, error: e.message }, { status: e.status });
    }
    console.error(e);
    return Response.json({ ok: false, error: "Something went wrong" }, { status: 500 });
  }
}
