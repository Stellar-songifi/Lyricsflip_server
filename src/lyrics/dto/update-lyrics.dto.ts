import { PartialType } from '@nestjs/swagger';
import { CreateLyricsDto } from './create-lyrics.dto';

export class UpdateLyricsDto extends PartialType(CreateLyricsDto) {}
