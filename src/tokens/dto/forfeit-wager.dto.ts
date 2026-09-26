import { IsString } from "class-validator";

export class ForfeitWagerDto {
  @IsString()
  reason!: string;
}
