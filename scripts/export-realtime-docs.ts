import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROTOCOL_VERSION,
  SERVER_TO_CLIENT_EVENTS,
  CLIENT_TO_SERVER_EVENTS,
  type EventDescriptor,
} from '../src/realtime/realtime.events';

/**
 * Generates docs/realtime.md from the typed realtime event maps.
 *
 * Run via `npm run docs:realtime` (or in CI) so the published contract is
 * always derived from `src/realtime/realtime.events.ts` instead of being
 * hand-maintained.
 */

function renderEventTable(events: Record<string, EventDescriptor>): string {
  const rows = Object.entries(events).map(([name, descriptor]) => {
    const payload = descriptor.payload ? `\`${descriptor.payload}\`` : '—';
    return `| \`${name}\` | ${payload} | ${descriptor.description} |`;
  });

  return ['| Event | Payload | Description |', '| --- | --- | --- |', ...rows].join('\n');
}

function render(): string {
  return [
    '# Realtime contract',
    '',
    `Protocol version: **${PROTOCOL_VERSION}**`,
    '',
    'This document is generated from `src/realtime/realtime.events.ts` by',
    '`scripts/export-realtime-docs.ts`. Do not edit it by hand — update the typed',
    'event maps and regenerate.',
    '',
    '## Server → client events',
    '',
    renderEventTable(SERVER_TO_CLIENT_EVENTS),
    '',
    '## Client → server events',
    '',
    renderEventTable(CLIENT_TO_SERVER_EVENTS),
    '',
    '## Typed client definitions',
    '',
    'The `ServerToClientEvents` and `ClientToServerEvents` interfaces in',
    '`src/realtime/realtime.events.ts` are the source of truth. Import them into a',
    'Socket.IO client to get fully typed `socket.on(...)` / `socket.emit(...)` calls:',
    '',
    '```ts',
    "import { io, type Socket } from 'socket.io-client';",
    "import type {",
    '  ServerToClientEvents,',
    '  ClientToServerEvents,',
    "} from './realtime.events';",
    '',
    'const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url);',
    '```',
    '',
  ].join('\n');
}

const outputPath = join(process.cwd(), 'docs', 'realtime.md');
writeFileSync(outputPath, render(), 'utf8');
// eslint-disable-next-line no-console
console.log(`Wrote ${outputPath}`);
