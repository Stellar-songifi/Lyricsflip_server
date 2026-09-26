export interface HeadToHeadSession {
  id: string;
  hostUserId: string;
  guestUserId?: string;
  status: "waiting" | "active" | "completed" | "declined";
  round: number;
  createdAt: Date;
}
