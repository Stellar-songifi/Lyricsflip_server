import { PartialType } from '@nestjs/mapped-types';
import { CreateLyricsDto } from './create-lyrics.dto';

export class UpdateLyricsDto extends PartialType(CreateLyricsDto) {}
