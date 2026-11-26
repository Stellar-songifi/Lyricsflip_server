import { EntityManager } from 'typeorm';

export function orderedPlayers(
  first: string,
  second: string,
): [string, string] {
  return first < second ? [first, second] : [second, first];
}

export async function lockPlayerPair(
  manager: EntityManager,
  first: string,
  second: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    orderedPlayers(first, second).join(':'),
  ]);
}
