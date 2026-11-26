import { runtimeEnv } from '../config/runtime-env';
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
    const allowlist = runtimeEnv().METRICS_IP_ALLOWLIST;
    if (allowlist) {
      const allowed = allowlist.split(',').map((ip) => ip.trim());
      // Use req.ip which respects Express trust proxy (set via TRUST_PROXY)
      const clientIp = req.ip ?? '127.0.0.1';

      if (!allowed.includes(clientIp)) {
        this.logger.warn(`Metrics scrape denied for IP ${clientIp}`);
        throw new ForbiddenException('Access denied');
      }
    }

    // --- Basic auth ---
    const expectedCredentials = runtimeEnv().METRICS_BASIC_AUTH;
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
      // Constant-time comparison to prevent timing attacks
      if (!this.timingSafeEqual(presented, expectedCredentials)) {
        throw new UnauthorizedException('Invalid credentials');
      }
    }

    // Require at least one protection in production (R3-15)
    if (process.env.NODE_ENV === 'production' && !allowlist && !expectedCredentials) {
      this.logger.error('Metrics endpoint requires METRICS_IP_ALLOWLIST or METRICS_BASIC_AUTH in production');
      throw new ForbiddenException('Access denied');
    }

    const metrics = await this.metricsService.getMetrics();
    res.setHeader('Content-Type', this.metricsService.getContentType());
    res.end(metrics);
  }

  /**
   * Compare two strings in constant time to prevent timing attacks.
   */
  private timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    // If lengths differ, compare against a dummy buffer of the expected length
    // to keep timing constant regardless of the difference.
    if (bufA.length !== bufB.length) {
      const dummy = Buffer.alloc(bufB.length);
      // Perform the comparison anyway to keep timing constant
      const crypto = require('crypto');
      crypto.timingSafeEqual(dummy, bufB);
      return false;
    }
    const crypto = require('crypto');
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
