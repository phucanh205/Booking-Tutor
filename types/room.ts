export type Room = {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
};

export type RoomMemberRole = "owner" | "member";

export type RoomMember = {
  roomId: string;
  userId: string;
  role: RoomMemberRole;
  joinedAt: string;
};
