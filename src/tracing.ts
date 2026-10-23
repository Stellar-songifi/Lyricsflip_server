import { Logger } from '@nestjs/common';

let sdkInstance: any = null;

/**
 * Initializes OpenTelemetry NodeSDK if OTEL_EXPORTER_OTLP_ENDPOINT is configured.
 * Must be executed before NestFactory boots and before instrumented modules are imported.
 * Operates as a complete no-op if OTEL_EXPORTER_OTLP_ENDPOINT is not set.
 */
export function initOpenTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    return;
  }

  const logger = new Logger('OpenTelemetry');
  try {
    // Dynamic requires ensure the module loads even in testing or bare environments
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
    const { SocketIoInstrumentation } = require('@opentelemetry/instrumentation-socket.io');

    const serviceName = process.env.OTEL_SERVICE_NAME || 'lyricsflip-server';

    const exporter = new OTLPTraceExporter({
      url: endpoint.endsWith('/v1/traces')
        ? endpoint
        : `${endpoint.replace(/\/$/, '')}/v1/traces`,
    });

    sdkInstance = new NodeSDK({
      serviceName,
      traceExporter: exporter,
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
        new PgInstrumentation(),
        new SocketIoInstrumentation(),
      ],
    });

    sdkInstance.start();
    logger.log(`OpenTelemetry started (service: ${serviceName}, exporter: ${endpoint})`);

    const shutdown = async () => {
      if (sdkInstance) {
        try {
          await sdkInstance.shutdown();
          logger.log('OpenTelemetry SDK shut down successfully');
        } catch (err) {
          logger.error('Error shutting down OpenTelemetry SDK', err);
        }
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.warn(
      `OpenTelemetry was configured via OTEL_EXPORTER_OTLP_ENDPOINT, ` +
        `but failed to start: ${(error as Error).message}. Continuing in no-op mode.`,
    );
  }
}

// Automatically invoke if required or loaded directly before bootstrapping
initOpenTelemetry();

function createNoopSpan() {
  const span: any = {
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => span,
    end: () => {},
    spanContext: () => ({ traceId: '', spanId: '', traceFlags: 0 }),
  };
  return span;
}

function createNoopTracer() {
  return {
    startSpan: () => createNoopSpan(),
    startActiveSpan: (...args: any[]) => {
      const fn = args[args.length - 1];
      const span = createNoopSpan();
      if (typeof fn === 'function') {
        return fn(span);
      }
      return undefined;
    },
  };
}

/**
 * Returns a tracer instance from the OpenTelemetry API if available,
 * or a graceful fallback no-op tracer otherwise.
 */
export function getTracer(name = 'lyricsflip-server') {
  try {
    const api = require('@opentelemetry/api');
    return api.trace.getTracer(name);
  } catch {
    return createNoopTracer();
  }
}

/**
 * Extracts the current trace_id from the active OpenTelemetry context, if available.
 */
export function getActiveTraceId(): string | undefined {
  try {
    const api = require('@opentelemetry/api');
    const span = api.trace.getActiveSpan();
    if (span) {
      const ctx = span.spanContext();
      if (ctx && ctx.traceId && ctx.traceId !== '00000000000000000000000000000000') {
        return ctx.traceId;
      }
    }
  } catch {
    // Ignore error
  }
  return undefined;
}

/**
 * Runs a scheduled job inside a new root span, linked to the wager it operates on.
 * Each run gets its own trace so periodic jobs do not inherit an unrelated parent.
 */
export async function runAsJobSpan<T>(
  jobName: string,
  wagerId: string | number | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  let api: any = null;
  try {
    api = require('@opentelemetry/api');
  } catch {
    return fn();
  }
  const tracer = api.trace.getTracer('lyricsflip-server');
  const span = tracer.startSpan(
    `job.${jobName}`,
    {
      root: true,
      attributes: wagerId !== undefined ? { 'wager.id': String(wagerId) } : {},
    },
  );
  try {
    return await api.context.with(
      api.trace.setSpan(api.context.active(), span),
      fn,
    );
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: 2, message: (err as Error)?.message });
    throw err;
  } finally {
    span.end();
  }
}
