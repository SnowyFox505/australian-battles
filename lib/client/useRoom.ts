"use client";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { RoomPublic } from "@/lib/game/types";
import { api, ensureUser } from "./api";
import { firestore } from "./firebase";

export function useUid() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    ensureUser().then((u) => alive && setUid(u.uid));
    api("time").catch(() => {}); // sync server clock
    return () => {
      alive = false;
    };
  }, []);
  return uid;
}

export function useRoom(code: string, uid: string | null) {
  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(
      doc(firestore, "rooms", code),
      (snap) => {
        setMissing(!snap.exists());
        setRoom(snap.exists() ? (snap.data() as RoomPublic) : null);
      },
      () => setMissing(true),
    );
  }, [code, uid]);
  return { room, missing };
}
