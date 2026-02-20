"use client";

import { useParams } from "next/navigation";
import { redirect } from "next/navigation";

export default function RoomPage() {
  const params = useParams();
  const roomId = typeof params?.roomId === "string" ? params.roomId : "";
  redirect(`/rooms/${encodeURIComponent(roomId)}/calendar`);
}
