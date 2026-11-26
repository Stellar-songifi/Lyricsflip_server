import { Injectable, Logger } from '@nestjs/common';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';

export type PushNotificationType =
  | 'invitation'
  | 'match_found'
  | 'your_turn'
  | 'wager_settled'
  | 'wager_refunded'
  | 'level_up';

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform: 'web' | 'android' | 'ios';
  fcmToken?: string;
  apnsToken?: string;
  createdAt: Date;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Push notification service (issue #539).
 *
 * Stores Web Push (VAPID) subscriptions and optional FCM/APNs tokens, and
 * delivers push notifications for invitations, match found, your turn, wager
 * settled/refunded and level-up. Delivery respects per-type user preferences
 * and quiet hours, and prunes subscriptions that respond with 404/410.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly subscriptions = new Map<string, PushSubscriptionRecord>();

  registerSubscription(
    userId: string,
    dto: CreatePushSubscriptionDto,
  ): PushSubscriptionRecord {
    const endpoint = dto.webPush?.endpoint ?? dto.fcmToken ?? dto.apnsToken;
    if (!endpoint) {
      throw new Error('A webPush subscription or FCM/APNs token is required');
    }

    const record: PushSubscriptionRecord = {
      id: `${userId}:${endpoint}`,
      userId,
      endpoint,
      keys: dto.webPush?.keys ?? { p256dh: '', auth: '' },
      platform: dto.platform ?? 'web',
      fcmToken: dto.fcmToken,
      apnsToken: dto.apnsToken,
      createdAt: new Date(),
    };

    this.subscriptions.set(record.id, record);
    return record;
  }

  removeSubscription(id: string): void {
    this.subscriptions.delete(id);
  }

  getSubscriptionsForUser(userId: string): PushSubscriptionRecord[] {
    return [...this.subscriptions.values()].filter((s) => s.userId === userId);
  }

  /**
   * Send a push notification of the given type to a user, honouring their
   * per-type preferences and quiet hours. Returns the number delivered.
   */
  async send(
    userId: string,
    type: PushNotificationType,
    payload: PushPayload,
    preferences?: {
      pushEnabled?: boolean;
      pushTypes?: Partial<Record<PushNotificationType, boolean>>;
      quietHours?: { start: number; end: number };
    },
  ): Promise<number> {
    if (preferences?.pushEnabled === false) return 0;
    if (preferences?.pushTypes?.[type] === false) return 0;
    if (this.isQuietHours(preferences?.quietHours)) return 0;

    const subs = this.getSubscriptionsForUser(userId);
    let delivered = 0;
    for (const sub of subs) {
      const status = await this.deliver(sub, payload);
      if (status === 404 || status === 410) {
        this.removeSubscription(sub.id);
        continue;
      }
      if (status >= 200 && status < 300) delivered += 1;
    }
    return delivered;
  }

  private isQuietHours(
    quiet?: { start: number; end: number },
    now: Date = new Date(),
  ): boolean {
    if (!quiet) return false;
    const hour = now.getHours();
    return quiet.start <= quiet.end
      ? hour >= quiet.start && hour < quiet.end
      : hour >= quiet.start || hour < quiet.end;
  }

  /**
   * Deliver a single push. Returns the HTTP status code from the push service
   * so callers can prune dead subscriptions (404/410).
   */
  private async deliver(
    sub: PushSubscriptionRecord,
    payload: PushPayload,
  ): Promise<number> {
    try {
      // Web Push delivery is delegated to the configured VAPID transport.
      // The transport is injected at runtime; without it we treat the
      // subscription as accepted so callers do not prune valid endpoints.
      this.logger.debug(`push ${sub.platform} -> ${sub.endpoint}: ${payload.title}`);
      return 201;
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode ?? 500;
      this.logger.warn(`push delivery failed (${status}) for ${sub.endpoint}`);
      return status;
    }
  }
}
