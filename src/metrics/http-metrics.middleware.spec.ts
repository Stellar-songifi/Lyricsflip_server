import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  INestApplication,
  Injectable,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { IsString } from 'class-validator';
import * as request from 'supertest';
import {
  createHttpMetricsMiddleware,
  UNMATCHED_ROUTE,
} from './http-metrics.middleware';
import { MetricsService } from './metrics.service';

/** Rejects like JwtAuthGuard, RolesGuard and the throttler would. */
@Injectable()
class RejectingGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const outcome = context.switchToHttp().getRequest().headers['x-outcome'];
    if (outcome === 'unauthorized') throw new UnauthorizedException();
    if (outcome === 'forbidden') throw new ForbiddenException();
    if (outcome === 'throttled') {
      throw new HttpException(
        'Too Many Requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

class JoinDto {
  @IsString()
  name!: string;
}

@Controller('rooms')
@UseGuards(RejectingGuard)
class FakeRoomsController {
  @Get('join/:code')
  join(@Param('code') code: string) {
    return { code };
  }

  @Post()
  create(@Body() body: JoinDto) {
    return body;
  }
}

describe('HTTP metrics middleware (#361)', () => {
  let app: INestApplication;
  let metrics: MetricsService;

  const series = async () =>
    (await metrics.httpRequestTotal.get()).values.map((v) => ({
      ...(v.labels as Record<string, string>),
      count: v.value,
    }));

  const countFor = async (labels: Record<string, string>) =>
    (await series())
      .filter((s) =>
        Object.entries(labels).every(
          ([k, v]) => (s as Record<string, unknown>)[k] === v,
        ),
      )
      .reduce((sum, s) => sum + s.count, 0);

  beforeEach(async () => {
    metrics = new MetricsService();
    const moduleRef = await Test.createTestingModule({
      controllers: [FakeRoomsController],
      providers: [RejectingGuard],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(createHttpMetricsMiddleware(metrics));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    // Listening (rather than just init) lets supertest send concurrent
    // requests to one server instead of starting one per request.
    await app.listen(0);
  });

  afterEach(async () => {
    await app.close();
  });

  it('labels requests with the route template, not the concrete path', async () => {
    await request(app.getHttpServer()).get('/rooms/join/AB12CD').expect(200);
    await request(app.getHttpServer()).get('/rooms/join/ZZ99QQ').expect(200);

    const routes = (await series()).map((s) => s.route);
    expect(routes).toEqual(['/rooms/join/:code']);
    expect(
      await countFor({ route: '/rooms/join/:code', status_code: '200' }),
    ).toBe(2);
  });

  it.each([
    ['unauthorized', '401'],
    ['forbidden', '403'],
    ['throttled', '429'],
  ])('counts a guard rejection (%s → %s)', async (outcome, status) => {
    await request(app.getHttpServer())
      .get('/rooms/join/AB12CD')
      .set('x-outcome', outcome)
      .expect(Number(status));

    expect(
      await countFor({
        method: 'GET',
        route: '/rooms/join/:code',
        status_code: status,
      }),
    ).toBe(1);
  });

  it('counts a validation pipe rejection (400)', async () => {
    await request(app.getHttpServer())
      .post('/rooms')
      .send({ name: 42 })
      .expect(400);

    expect(
      await countFor({ method: 'POST', route: '/rooms', status_code: '400' }),
    ).toBe(1);
  });

  it('adds at most one series for 1,000 requests to random unknown paths', async () => {
    const before = (await series()).length;
    const server = app.getHttpServer();

    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(
        Array.from({ length: 100 }, () =>
          request(server)
            .get(
              `/${randomBytes(6).toString('hex')}/${randomBytes(4).toString('hex')}`,
            )
            .expect(404),
        ),
      );
    }

    const after = await series();
    expect(after.length - before).toBeLessThanOrEqual(1);
    expect(await countFor({ route: UNMATCHED_ROUTE, status_code: '404' })).toBe(
      1000,
    );
  });

  it('records a duration for every counted request', async () => {
    await request(app.getHttpServer()).get('/rooms/join/AB12CD').expect(200);
    await request(app.getHttpServer()).get('/nope').expect(404);

    const durations = (await metrics.httpRequestDuration.get()).values.filter(
      (v) => v.metricName === 'lyricsflip_http_request_duration_seconds_count',
    );
    expect(durations.reduce((sum, v) => sum + v.value, 0)).toBe(2);
  });
});
