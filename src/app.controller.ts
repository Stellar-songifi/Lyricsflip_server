import { Controller, Get, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from './auth/decorators/public.decorator';

/**
 * Root controller.
 *
 * GET / previously returned "Hello World!" and required auth.
 * It now redirects to /health/live so probes that hit the root still get a
 * useful response.  The real probe paths are /health/live and /health/ready.
 */
@ApiTags('app')
@Controller()
export class AppController {
  @Public()
  @Get()
  @Redirect('/health/live', 302)
  @ApiOperation({ summary: 'Redirects to /health/live' })
  @ApiResponse({ status: 302, description: 'Redirect to liveness probe.' })
  redirectToHealth() {
    // @Redirect handles the response; no body needed.
  }
}
