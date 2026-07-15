import { Logger } from 'pino';
import { Database } from '../storage/index.js';
import { WhatsAppAdapter } from './gateway.js';
import { EventBus } from '../utils/event-bus.js';
import { ScheduledMessage, ScheduleRepeat, ConnectionStatus } from '../types.js';
import { getLogger } from '../utils/logger.js';

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;
  private running = false;
  private checkIntervalMs = 30_000; // Check every 30 seconds

  constructor(
    private db: Database,
    private whatsapp: WhatsAppAdapter,
    private eventBus: EventBus
  ) {
    this.logger = getLogger().child({ module: 'scheduler' });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info('Scheduler started (checking every %ds)', this.checkIntervalMs / 1000);

    // Run immediately on start
    this.checkAndSend();

    // Then run at interval
    this.timer = setInterval(() => this.checkAndSend(), this.checkIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Scheduler stopped');
  }

  private async checkAndSend(): Promise<void> {
    if (!this.whatsapp.isConnected()) {
      this.logger.debug('WhatsApp not connected, skipping schedule check');
      return;
    }

    try {
      const dueMessages = this.db.getDueScheduledMessages();

      if (dueMessages.length === 0) return;

      this.logger.info('Found %d due scheduled messages', dueMessages.length);

      for (const msg of dueMessages) {
        await this.sendScheduledMessage(msg);
      }
    } catch (err: any) {
      this.logger.error({ error: err.message }, 'Error in scheduler check');
    }
  }

  private async sendScheduledMessage(msg: ScheduledMessage): Promise<void> {
    this.logger.info({ id: msg.id, to: msg.contactName }, 'Sending scheduled message');

    // Mark as active
    this.db.updateScheduledMessage(msg.id, { status: 'active' });

    try {
      // Send the message via WhatsApp
      const sentMessage = await this.whatsapp.sendMessage(msg.contactId, msg.content);

      // Calculate next run for recurring messages
      const nextRunAt = this.calculateNextRun(msg);

      const updates: Partial<ScheduledMessage> = {
        status: nextRunAt ? 'pending' : 'sent',
        lastSentAt: new Date(),
        sentCount: msg.sentCount + 1,
        nextRunAt,
      };

      this.db.updateScheduledMessage(msg.id, updates);

      // Emit event for dashboard
      this.eventBus.emit({
        type: 'scheduled:update',
        scheduled: {
          ...this.db.getScheduledMessage(msg.id)!,
        },
      });

      this.logger.info(
        { id: msg.id, nextRun: nextRunAt?.toISOString() },
        'Scheduled message sent successfully'
      );
    } catch (err: any) {
      this.logger.error({ id: msg.id, error: err.message }, 'Failed to send scheduled message');

      this.db.updateScheduledMessage(msg.id, {
        status: 'failed',
        failedCount: msg.failedCount + 1,
        nextRunAt: this.calculateNextRun(msg), // still schedule next run
      });

      this.eventBus.emit({
        type: 'scheduled:update',
        scheduled: {
          ...this.db.getScheduledMessage(msg.id)!,
        },
      });
    }
  }

  private calculateNextRun(msg: ScheduledMessage): Date | undefined {
    const originalDate = new Date(msg.scheduledAt);
    const now = new Date();

    switch (msg.repeat) {
      case 'daily': {
        const next = new Date(now);
        next.setHours(originalDate.getHours(), originalDate.getMinutes(), 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next;
      }
      case 'weekly': {
        const next = new Date(now);
        next.setHours(originalDate.getHours(), originalDate.getMinutes(), 0, 0);
        // Set to same day of week as original
        const targetDay = originalDate.getDay();
        const diff = targetDay - now.getDay();
        next.setDate(next.getDate() + (diff <= 0 ? diff + 7 : diff));
        if (next <= now) next.setDate(next.getDate() + 7);
        return next;
      }
      case 'monthly': {
        const next = new Date(now);
        next.setHours(originalDate.getHours(), originalDate.getMinutes(), 0, 0);
        next.setDate(originalDate.getDate());
        if (next <= now) next.setMonth(next.getMonth() + 1);
        return next;
      }
      default:
        return undefined; // No repeat
    }
  }
}
