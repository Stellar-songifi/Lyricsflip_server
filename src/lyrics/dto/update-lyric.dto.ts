import { PartialType } from '@nestjs/mapped-types';
import { CreateLyricDto } from './create-lyric.dto';

export class UpdateLyricDto extends PartialType(CreateLyricDto) {}