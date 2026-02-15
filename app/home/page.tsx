import { redirect } from "next/navigation";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ roomId?: string }>;
}) {
  const sp = await searchParams;
  const roomId = sp.roomId?.trim();

  if (roomId) {
    redirect(`/home/calendar?roomId=${encodeURIComponent(roomId)}`);
  }

  redirect("/home/calendar");
}
