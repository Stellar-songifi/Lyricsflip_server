# Realtime events

Players get game events pushed over Socket.IO instead of polling. The gateway lives in `src/realtime/`.

## Connecting

- Namespace: `/realtime`
- Auth: the same JWT as the HTTP API, as `auth: { token }` or an `Authorization: Bearer` header. A missing or invalid token gets an `error` event and a disconnect.
- On connect the server emits `connected { userId }` and puts the socket in its private `user:<userId>` room.

```ts
const socket = io('https://api.example.com/realtime', { auth: { token } });
socket.on('connected', async () => {
  await socket.emitWithAck('subscribe', { type: 'session', id: sessionId });
});
socket.on('round.ended', (e) => console.log(e.userId, e.points));
```

## Rooms

| Room            | Joined by                                                   |
| --------------- | ----------------------------------------------------------- |
| `user:<id>`     | Automatically. Carries that player's own events.            |
| `session:<id>`  | `subscribe { type: 'session', id }`, players of the session |
| `room:<id>`     | `subscribe { type: 'room', id }`, members of the room       |

`subscribe` and `unsubscribe` are acknowledged with `{ ok: true, room }` or `{ ok: false, error }`. A session or room you do not belong to answers `Not found`, the same as one that does not exist.

## Events (server → client)

Every payload also carries `at`, the ISO time the server sent it. No payload contains a lyric or an answer.

| Event                    | Sent to                          | Payload                                                                                          |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `session.player_joined`  | `session:<id>` or `room:<id>`, and the joining player | `{ scope: 'session' \| 'room', sessionId?, roomId?, userId }`                       |
| `round.started`          | the player, and `session:<id>`   | `{ roundId, sessionId \| null, userId, issuedAt, expiresAt, answerWindowSeconds }`               |
| `round.ended`            | the player, and `session:<id>`   | `{ roundId, sessionId \| null, userId, isCorrect, points, speedBonus, timedOut, hintsUsed }`     |
| `session.completed`      | `session:<id>` and both players  | `{ sessionId, playerId, playerTwoId, winnerId, score, playerTwoScore }`                          |
| `wager.staked`           | `session:<id>` and both players  | `{ wagerId, sessionId, playerAId, playerBId, stakeStroops, totalPotStroops }`                    |
| `wager.settled`          | `session:<id>` and both players  | `{ wagerId, sessionId, playerAId, playerBId, outcome: 'won' \| 'refunded', winnerId, totalPotStroops }` |

`round.*` events carry a `sessionId` when the round was served with `GET /game/lyric?sessionId=<id>`, which is how an opponent sees a player's progress. Rounds without one are only sent to the player.

`round.ended` is also sent when a round expires unanswered (`timedOut: true`, `points: 0`).

## Where events come from

Services raise events on the in-process `EventEmitter2` bus under the names above (`src/realtime/realtime.events.ts`), and `RealtimeGateway` fans them out. Game rounds raise theirs directly. Session, wager and room changes are picked up by a TypeORM subscriber (`EntityEventsSubscriber`), so anything that saves those rows announces them, and events raised inside a transaction are held until it commits.

## Multiple instances

Set `REDIS_URL`. `main.ts` then installs `RedisIoAdapter` (`@socket.io/redis-adapter`), so an event raised on one instance reaches sockets connected to any other. Without it the in-memory adapter is used, which is right for a single instance.

## Not in this contract

Round events raised from an instance other than the one a database change happened on rely on the adapter above. The bus itself is per-process: an event is emitted by the instance that handled the request or ran the query.
