"use client";
import { use } from "react";
import { RoomScreen } from "@/components/RoomScreen";

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <RoomScreen code={code.toUpperCase()} />;
}
