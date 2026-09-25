export interface WagerStatusDto {
  wagerId: string;
  stakeSigned: boolean;
  escrowed: boolean;
  status: "pending" | "active" | "forfeited" | "settled";
}
