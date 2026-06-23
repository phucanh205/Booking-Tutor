export type BookingStatus = "requested" | "approved" | "rejected";
export type AttendanceStatus = "none" | "completed" | "absent";

export type Booking = {
  id: string;
  tutorId: string;
  slotId: string;
  studentName: string;
  studentEmail: string;
  note?: string;
  status: BookingStatus;
  attendance: AttendanceStatus;
};
