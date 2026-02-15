export type SlotStatus = "available" | "blocked" | "booked";

export type Slot = {
  id: string;
  tutorId: string;
  startAt: string;
  endAt: string;
  status: SlotStatus;
  topic?: string;
};
