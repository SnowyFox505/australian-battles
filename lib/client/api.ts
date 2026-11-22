"use client";
import { signInAnonymously } from "firebase/auth";
import { auth } from "./firebase";

let offset = 0;
/** Current server time (ms), corrected by the latest API round-trip. */
export const serverNow = () => Date.now() + offset;

export async function ensureUser() {
  if (auth.currentUser) return auth.currentUser;
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

/**
 * Wakes the server and signs in anonymously ahead of the first tap, so "Host" / "Join" do not pay
 * for a cold start and a login round trip.
 */
export function warmUp() {
  ensureUser().catch(() => {});
  fetch("/api/g/time", { cache: "no-store" }).catch(() => {}); // in parallel: no need to wait for the login
}

export class ApiError extends Error {}

export async function api<T = Record<string, unknown>>(path: string, body?: unknown, retried = false): Promise<T> {
  const user = await ensureUser();
  const token = await user.getIdToken();
  const t0 = Date.now();
  const res = await fetch(`/api/g/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // The stored anonymous session can go stale (e.g. user deleted): start a fresh one once.
  if (res.status === 401 && !retried) {
    await auth.signOut();
    return api<T>(path, body, true);
  }
  const json = await res.json().catch(() => ({ ok: false, error: "Network error" }));
  if (!res.ok || !json.ok) throw new ApiError(json.error ?? "Request failed");
  if (typeof json.serverNow === "number") offset = json.serverNow - (t0 + Date.now()) / 2;
  return json as T;
}
