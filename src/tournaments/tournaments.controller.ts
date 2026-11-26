import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
} from 'class-validator';
import { GetUser } from '../auth/decorators/user.decorator';
import { Role } from '../auth/roles/role.enum';
import { Roles } from '../auth/roles/roles.decorator';
import { User } from '../users/entities/user.entity';
import { TournamentsService } from './tournaments.service';

class CreateTournamentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsInt()
  @Min(2)
  @Max(64)
  maxPlayers: number;

  @IsDateString()
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  startsAt: string;
}

class TournamentGuessDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  guess: string;
}

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post()
  @Roles(Role.Admin)
  create(@Body() dto: CreateTournamentDto) {
    return this.tournaments.create(
      dto.name,
      dto.maxPlayers,
      new Date(dto.startsAt),
    );
  }

  @Post(':id/entries')
  @HttpCode(204)
  register(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User) {
    return this.tournaments.register(id, user.id);
  }

  @Get(':id/bracket')
  bracket(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.bracket(id);
  }

  @Get(':id/matches/:matchId')
  question(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @GetUser() user: User,
  ) {
    return this.tournaments.question(id, matchId, user.id);
  }

  @Post(':id/matches/:matchId/guess')
  @HttpCode(204)
  guess(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @GetUser() user: User,
    @Body() dto: TournamentGuessDto,
  ) {
    return this.tournaments.guess(id, matchId, user.id, dto.guess);
  }
}
