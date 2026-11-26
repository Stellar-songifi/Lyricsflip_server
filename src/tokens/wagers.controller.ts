import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetUser } from '../auth/decorators/user.decorator';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { User } from '../users/entities/user.entity';
import { WagerViewDto } from './dto/wager-view.dto';
import { WagerService } from './services/wager.service';

@ApiTags('wagers')
@Controller('wagers')
export class WagersController {
  constructor(private readonly wagers: WagerService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get your wager history' })
  @ApiPaginatedResponse(WagerViewDto)
  getMine(@GetUser() user: User, @Query() query: PaginationQueryDto) {
    return this.wagers.getUserWagerPage(user.id, query);
  }
}
