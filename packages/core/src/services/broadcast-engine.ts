import { Logger } from 'pino';
import { Database } from '../storage/index.js';
import { WhatsAppAdapter } from './gateway.js';
import { EventBus } from '../utils/event-bus.js';
import { getLogger } from '../utils/logger.js';
import { BroadcastMessage } from '../types.js';
import { stripMarkdown } from './whatsapp-utils.js';

export interface BroadcastOptions {
  /** Delay between messages in ms (default: 2000) */
  delayMs?: number;
  /** Max messages per minute (rate limit) */
  rateLimit?: number;
  /** Target filter: tags, specific contacts, or all */
  targetFilter?: {
    tags?: string[];
    contactIds?: string[];
    all?: boolean;
  };
}

interface BroadcastJob {
  id: string;
  content: string;
  targetFilter: BroadcastOptions['targetFilter'];
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  totalContacts: number;
  sentCount: number;
  failedCount: number;
  createdAt: Date;
}

/**
 * BroadcastEngine sends messages to multiple contacts with:
 * - Rate limiting (configurable delay between messages)
 * - Progress tracking (sent/failed counts)
 * - Pause/resume support
 * - Event emission for dashboard
 */
export class BroadcastEngine {
  private logger: Logger;
  private activeJobs: Map<string, BroadcastJob> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(
    private db: Database,
    private whatsapp: WhatsAppAdapter,
    private eventBus: EventBus
  ) {
    this.logger = getLogger().child({ module: 'broadcast-engine' });
  }

  /**
   * Start a broadcast job
   */
  async startBroadcast(
    content: string,
    options: BroadcastOptions = {}
  ): Promise<string> {
    const { delayMs = 2000, targetFilter } = options;

    // Get target contacts
    const contacts = this.getTargetContacts(targetFilter);

    if (contacts.length === 0) {
      throw new Error('No contacts matched the target filter');
    }

    // Create broadcast record in DB
    const broadcast: BroadcastMessage = {
      id: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      targetFilter: targetFilter || {},
      status: 'sending',
      totalContacts: contacts.length,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };

    this.db.createBroadcast(broadcast);

    // Create job
    const job: BroadcastJob = {
      id: broadcast.id,
      content,
      targetFilter,
      status: 'running',
      totalContacts: contacts.length,
      sentCount: 0,
      failedCount: 0,
      createdAt: new Date(),
    };

    this.activeJobs.set(broadcast.id, job);

    // Start sending in background
    this.sendBroadcast(broadcast.id, contacts, content, delayMs);

    this.logger.info(
      { id: broadcast.id, contacts: contacts.length },
      'Broadcast started'
    );

    return broadcast.id;
  }

  /**
   * Pause a running broadcast
   */
  pauseBroadcast(id: string): boolean {
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }

    const job = this.activeJobs.get(id);
    if (job && job.status === 'running') {
      job.status = 'paused';
      this.db.updateBroadcastStatus(id, 'paused');
      this.eventBus.emit({ type: 'broadcast:paused', id });
      this.logger.info({ id }, 'Broadcast paused');
      return true;
    }
    return false;
  }

  /**
   * Resume a paused broadcast
   */
  async resumeBroadcast(id: string): Promise<boolean> {
    const job = this.activeJobs.get(id);
    if (job && job.status === 'paused') {
      job.status = 'running';
      this.db.updateBroadcastStatus(id, 'sending');

      // Resume sending remaining contacts
      const contacts = this.getTargetContacts(job.targetFilter);
      const remaining = contacts.slice(job.sentCount + job.failedCount);

      this.sendBroadcast(id, remaining, job.content, 2000);
      this.logger.info({ id, remaining: remaining.length }, 'Broadcast resumed');
      return true;
    }
    return false;
  }

  /**
   * Get broadcast status
   */
  getBroadcastStatus(id: string): BroadcastJob | undefined {
    return this.activeJobs.get(id);
  }

  /**
   * Get all active broadcasts
   */
  getActiveBroadcasts(): BroadcastJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Internal: Send broadcast to contacts with delay
   */
  private async sendBroadcast(
    id: string,
    contacts: { id: string; name: string }[],
    content: string,
    delayMs: number
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(id, controller);

    const job = this.activeJobs.get(id);
    if (!job) return;

    let sent = 0;
    let failed = 0;

    for (const contact of contacts) {
      // Check if paused/aborted
      if (controller.signal.aborted || job.status === 'paused') {
        this.logger.info({ id, sent, failed }, 'Broadcast interrupted');
        break;
      }

      try {
        // Personalize message
        const personalized = content
          .replace(/\{\{name\}\}/gi, contact.name)
          .replace(/\{\{contact\}\}/gi, contact.name);

        await this.whatsapp.sendMessage(contact.id, stripMarkdown(personalized));

        sent++;
        job.sentCount = sent;

        // Update DB
        this.db.updateBroadcastStatus(id, 'sending', sent, failed);

        // Emit progress
        this.eventBus.emit({
          type: 'broadcast:progress',
          id,
          sent,
          failed,
          total: contacts.length,
        });

        this.logger.debug(
          { id, contact: contact.name, sent, total: contacts.length },
          'Broadcast message sent'
        );
      } catch (err: any) {
        failed++;
        job.failedCount = failed;

        this.db.updateBroadcastStatus(id, 'sending', sent, failed);

        this.logger.warn(
          { id, contact: contact.name, error: err.message },
          'Broadcast message failed'
        );
      }

      // Delay between messages
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // Mark as completed
    job.status = 'completed';
    this.db.updateBroadcastStatus(id, 'completed', sent, failed);
    this.abortControllers.delete(id);

    this.eventBus.emit({
      type: 'broadcast:completed',
      id,
      sent,
      failed,
      total: contacts.length,
    });

    this.logger.info(
      { id, sent, failed, total: contacts.length },
      'Broadcast completed'
    );
  }

  /**
   * Get contacts matching the target filter
   */
  private getTargetContacts(
    filter?: BroadcastOptions['targetFilter']
  ): { id: string; name: string }[] {
    if (!filter || filter.all) {
      return this.db.getAllContacts().map((c) => ({ id: c.id, name: c.name }));
    }

    if (filter.contactIds && filter.contactIds.length > 0) {
      return this.db
        .getAllContacts()
        .filter((c) => filter.contactIds!.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name }));
    }

    if (filter.tags && filter.tags.length > 0) {
      return this.db
        .getAllContacts()
        .filter((c) => {
          let tags: string[] = [];
          if (typeof c.tags === 'string') {
            try { tags = JSON.parse(c.tags); } catch { tags = []; }
          } else {
            tags = c.tags || [];
          }
          return filter.tags!.some((t) => tags.includes(t));
        })
        .map((c) => ({ id: c.id, name: c.name }));
    }

    return this.db.getAllContacts().map((c) => ({ id: c.id, name: c.name }));
  }
}
