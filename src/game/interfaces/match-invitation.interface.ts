export interface MatchInvitation {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: "pending" | "accepted" | "declined" | "expired";
  expiresAt: Date;
}
