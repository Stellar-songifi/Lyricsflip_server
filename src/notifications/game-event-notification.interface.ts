export interface GameEventNotification {
  userId: string;
  type: "guess_correct" | "guess_wrong" | "match_invite" | "match_complete";
  title: string;
  body: string;
  metadata?: Record<string, string>;
}
