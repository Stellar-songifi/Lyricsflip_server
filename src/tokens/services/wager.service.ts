import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wager } from '../entities/wager.entity';
import { CreateWagerDto } from '../dto/create-wager.dto';
import { DomainEvents } from '../../realtime/domain-events';

export type WagerTransitionResult =
  | { ok: true; wager: Wager }
  | { ok: false; reason: 'not_found' | 'conflict' };

@Injectable()
export class WagerService {
  private readonly logger = new Logger(WagerService.name);

  constructor(
    @InjectRepository(Wager)
    private readonly wagerRepository: Repository<Wager>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateWagerDto): Promise<Wager> {
    const wager = this.wagerRepository.create(dto);
    return this.wagerRepository.save(wager);
  }

  async findById(id: string): Promise<Wager> {
    const wager = await this.wagerRepository.findOne({ where: { id } });
    if (!wager) {
      throw new NotFoundException(`Wager ${id} not found`);
    }
    return wager;
  }

  /**
   * Conditionally transitions a wager to `staked` using a single UPDATE so
   * concurrent callers cannot double-stake. Emits `wager.staked` after commit.
   */
  async stake(id: string): Promise<WagerTransitionResult> {
    return this.transition(id, 'pending', 'staked', 'wager.staked');
  }

  /**
   * Conditionally transitions a wager to `settled` using a single UPDATE so
   * concurrent callers cannot double-settle. Emits `wager.settled` after commit.
   */
  async settle(id: string): Promise<WagerTransitionResult> {
    return this.transition(id, 'staked', 'settled', 'wager.settled');
  }

  private async transition(
    id: string,
    from: Wager['status'],
    to: Wager['status'],
    eventName: string,
  ): Promise<WagerTransitionResult> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.manager
        .createQueryBuilder()
        .update(Wager)
        .set({ status: to })
        .where('id = :id', { id })
        .andWhere('status = :from', { from })
        .execute();

      if (!result.affected) {
        await queryRunner.rollbackTransaction();
        const exists = await this.wagerRepository.findOne({ where: { id } });
        return { ok: false, reason: exists ? 'conflict' : 'not_found' };
      }

      const wager = await queryRunner.manager.findOne(Wager, { where: { id } });
      if (!wager) {
        await queryRunner.rollbackTransaction();
        return { ok: false, reason: 'not_found' };
      }

      DomainEvents.queue(queryRunner, eventName, {
        id: wager.id,
        status: wager.status,
        amount: wager.amount,
      });

      await queryRunner.commitTransaction();
      DomainEvents.flush(queryRunner);

      return { ok: true, wager };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to transition wager ${id} to ${to}`, error as Error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
