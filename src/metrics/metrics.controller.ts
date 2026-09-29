import {
  Controller,
  Get,
  Req,
  Res,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { MetricsService } from './metrics.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Exposes the Prometheus /metrics endpoint.
 *
 * Marked @Public() so the global JWT guard is skipped; access control is
 * enforced inside the handler via two optional environment variables:
 *
 *   METRICS_IP_ALLOWLIST  Comma-separated list of client IPs that may scrape.
 *                         When unset, any IP is allowed (useful for local dev).
 *   METRICS_BASIC_AUTH    Expected "username:password" string.
 *                         When unset, no Basic-Auth challenge is issued.
 *
 * Both checks are applied in order: IP first, then credentials.
 * Set at least one of them in any environment that faces the internet.
 */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Req() req: Request, @Res() res: Response): Promise<void> {
    // --- IP allowlist ---
    const allowlist = process.env.METRICS_IP_ALLOWLIST;
    if (allowlist) {
      const allowed = allowlist.split(',').map((ip) => ip.trim());
      const forwarded = req.headers['x-forwarded-for'] as string | undefined;
      const clientIp =
        forwarded?.split(',')[0]?.trim() ?? req.ip ?? '127.0.0.1';

      if (!allowed.includes(clientIp)) {
        this.logger.warn(`Metrics scrape denied for IP ${clientIp}`);
        throw new ForbiddenException('Access denied');
      }
    }

    // --- Basic auth ---
    const expectedCredentials = process.env.METRICS_BASIC_AUTH;
    if (expectedCredentials) {
      const authHeader = req.headers['authorization'];
      if (!authHeader?.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="metrics"');
        throw new UnauthorizedException('Authentication required');
      }
      const presented = Buffer.from(
        authHeader.slice('Basic '.length),
        'base64',
      ).toString('utf-8');
      if (presented !== expectedCredentials) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    const metrics = await this.metricsService.getMetrics();
    res.setHeader('Content-Type', this.metricsService.getContentType());
    res.end(metrics);
  }
}
