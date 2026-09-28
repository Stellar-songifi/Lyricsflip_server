import { ApiPropertyOptional } from '@nestjs/swagger';

export class ImportLyricsDto {
  @ApiPropertyOptional({
    description: 'Whether to validate the import without persisting the changes.',
    type: Boolean,
    default: false,
  })
  dryRun?: boolean | string;
}
