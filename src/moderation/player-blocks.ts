import { ForbiddenException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { UserBlock } from './user-block.entity';

export function arePlayersBlocked(
  manager: EntityManager,
  firstPlayerId: string,
  secondPlayerId: string,
): Promise<boolean> {
  return manager.exists(UserBlock, {
    where: [
      { blockerId: firstPlayerId, blockedId: secondPlayerId },
      { blockerId: secondPlayerId, blockedId: firstPlayerId },
    ],
  });
}

export async function assertPlayersCanInteract(
  manager: EntityManager,
  firstPlayerId: string,
  secondPlayerId: string,
): Promise<void> {
  if (await arePlayersBlocked(manager, firstPlayerId, secondPlayerId)) {
    throw new ForbiddenException('This interaction is unavailable');
  }
}
