import { Logger } from 'pino';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { Database } from '../storage/index.js';
import { EventBus } from '../utils/event-bus.js';
import { getLogger } from '../utils/logger.js';

export interface FollowUpStep {
  /** Delay in hours from previous step (or from trigger for first step) */
  delayHours: number;
  /** Message template (supports {{name}}, {{contact}}, {{order}}) */
  message: string;
  /** Condition to check before sending (optional) */
  condition?: {
    /** Only send if no reply within this many hours */
    noReplyAfterHours?: number;
    /** Only send if contact has specific tag */
    tag?: string;
  };
}

export interface FollowUpSequence {
  id: string;
  name: string;
  steps: FollowUpStep[];
  /** Trigger type */
  trigger: {
    type: 'manual' | 'no-reply' | 'order-created' | 'tag-added';
    /** For no-reply trigger: hours to wait before starting sequence */
    noReplyHours?: number;
    /** For tag-added trigger: which tag */
    tag?: string;
  };
  /** Max times to run this sequence per contact */
  maxRunsPerContact?: number;
  createdAt: Date;
}

interface SequenceRun {
  id: string;
  sequenceId: string;
  contactId: string;
  currentStep: number;
  status: 'pending' | 'running' | 'completed' | 'cancelled';
  lastSentAt?: Date;
  nextRunAt: Date;
  createdAt: Date;
}

/**
 * SchedulingWorkflows manages follow-up sequences and
 * trigger-based scheduling for automated messaging.
 */
export class SchedulingWorkflows {
  private logger: Logger;
  private sequences: Map<string, FollowUpSequence> = new Map();
  private activeRuns: Map<string, SequenceRun> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkIntervalMs = 60_000; // Check every minute
  private persistPath: string;

  constructor(
    private db: Database,
    private eventBus: EventBus,
    persistPath?: string
  ) {
    this.logger = getLogger().child({ module: 'scheduling-workflows' });
    this.persistPath = persistPath || join(process.cwd(), 'data', 'scheduling-workflows.json');

    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.load();
  }

  /**
   * Start the workflow engine
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkRuns(), this.checkIntervalMs);
    this.logger.info('Scheduling workflows started');
  }

  /**
   * Stop the workflow engine
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Scheduling workflows stopped');
  }

  /**
   * Create a new follow-up sequence
   */
  createSequence(sequence: Omit<FollowUpSequence, 'id' | 'createdAt'>): FollowUpSequence {
    const id = `seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fullSequence: FollowUpSequence = {
      ...sequence,
      id,
      createdAt: new Date(),
    };

    this.sequences.set(id, fullSequence);
    this.save();
    this.logger.info({ id, name: sequence.name }, 'Follow-up sequence created');

    return fullSequence;
  }

  /**
   * Start a sequence for a specific contact
   */
  startSequence(
    sequenceId: string,
    contactId: string,
    contactName: string
  ): string | null {
    const sequence = this.sequences.get(sequenceId);
    if (!sequence) {
      this.logger.warn({ sequenceId }, 'Sequence not found');
      return null;
    }

    // Check max runs
    if (sequence.maxRunsPerContact) {
      const existingRuns = Array.from(this.activeRuns.values()).filter(
        (r) => r.sequenceId === sequenceId && r.contactId === contactId
      );
      if (existingRuns.length >= sequence.maxRunsPerContact) {
        this.logger.info(
          { sequenceId, contactId },
          'Max runs reached for this contact'
        );
        return null;
      }
    }

    // Calculate first run time
    if (!sequence.steps || sequence.steps.length === 0) {
      this.logger.warn({ sequenceId }, 'Sequence has no steps, skipping');
      return null;
    }
    const firstStep = sequence.steps[0];
    const nextRunAt = new Date(Date.now() + firstStep.delayHours * 60 * 60 * 1000);

    const run: SequenceRun = {
      id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sequenceId,
      contactId,
      currentStep: 0,
      status: 'pending',
      nextRunAt,
      createdAt: new Date(),
    };

    this.activeRuns.set(run.id, run);
    this.save();

    this.logger.info(
      { runId: run.id, sequence: sequence.name, contact: contactName },
      'Sequence run started'
    );

    return run.id;
  }

  /**
   * Cancel a sequence run
   */
  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.status = 'cancelled';
      this.activeRuns.delete(runId);
      this.save();
      this.logger.info({ runId }, 'Sequence run cancelled');
      return true;
    }
    return false;
  }

  /**
   * Get all active runs for a contact
   */
  getActiveRunsForContact(contactId: string): SequenceRun[] {
    return Array.from(this.activeRuns.values()).filter(
      (r) => r.contactId === contactId && r.status !== 'cancelled'
    );
  }

  /**
   * Check and execute due runs
   */
  private async checkRuns(): Promise<void> {
    const now = new Date();

    for (const [runId, run] of this.activeRuns) {
      if (run.status !== 'pending') continue;
      if (run.nextRunAt > now) continue;

      const sequence = this.sequences.get(run.sequenceId);
      if (!sequence) {
        this.activeRuns.delete(runId);
        continue;
      }

      const step = sequence.steps[run.currentStep];
      if (!step) {
        // Sequence completed
        run.status = 'completed';
        this.activeRuns.delete(runId);
        this.save();
        this.logger.info({ runId }, 'Sequence completed');
        continue;
      }

      // Check condition
      if (step.condition) {
        const shouldSend = await this.checkCondition(step.condition, run.contactId);
        if (!shouldSend) {
          // Skip this step, move to next
          this.moveToNextStep(run, sequence);
          continue;
        }
      }

      // Send message
      try {
        const contact = this.db.getContact(run.contactId);
        const contactName = contact?.name || 'Customer';

        const message = step.message
          .replace(/\{\{name\}\}/gi, contactName)
          .replace(/\{\{contact\}\}/gi, contactName);

        // Emit event for gateway to send
        this.eventBus.emit({
          type: 'workflow:send',
          runId: run.id,
          contactId: run.contactId,
          message,
        });

        run.lastSentAt = now;
        run.status = 'running';

        this.logger.info(
          { runId, step: run.currentStep, contact: contactName },
          'Follow-up message sent'
        );

        // Move to next step
        this.moveToNextStep(run, sequence);
      } catch (err: any) {
        this.logger.error(
          { runId, error: err.message },
          'Failed to send follow-up'
        );
        // Still move to next step (don't block sequence)
        this.moveToNextStep(run, sequence);
      }
    }
  }

  /**
   * Move to next step in sequence
   */
  private moveToNextStep(run: SequenceRun, sequence: FollowUpSequence): void {
    run.currentStep++;

    if (run.currentStep >= sequence.steps.length) {
      // Sequence completed
      run.status = 'completed';
      this.activeRuns.delete(run.id);
      this.save();
      this.logger.info({ runId: run.id }, 'Sequence completed');
    } else {
      // Schedule next step
      const nextStep = sequence.steps[run.currentStep];
      run.nextRunAt = new Date(Date.now() + nextStep.delayHours * 60 * 60 * 1000);
      run.status = 'pending';
      this.save();
    }
  }

  /**
   * Check if condition is met
   */
  private async checkCondition(
    condition: FollowUpStep['condition'],
    contactId: string
  ): Promise<boolean> {
    if (!condition) return true;

    // Check no-reply condition
    if (condition.noReplyAfterHours) {
      const lastMessage = this.db.getMessages(contactId, 1);
      if (lastMessage.length > 0) {
        const lastMsg = lastMessage[0];
        const hoursSinceLastMsg =
          (Date.now() - new Date(lastMsg.timestamp).getTime()) / (60 * 60 * 1000);
        if (hoursSinceLastMsg < condition.noReplyAfterHours) {
          return false; // Customer replied recently
        }
      }
    }

    // Check tag condition
    if (condition.tag) {
      const contact = this.db.getContact(contactId);
      if (contact) {
        let tags: string[] = [];
        if (typeof contact.tags === 'string') {
          try { tags = JSON.parse(contact.tags); } catch { tags = []; }
        } else {
          tags = contact.tags || [];
        }
        if (!tags.includes(condition.tag)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get sequence by ID
   */
  getSequence(id: string): FollowUpSequence | undefined {
    return this.sequences.get(id);
  }

  /**
   * List all sequences
   */
  listSequences(): FollowUpSequence[] {
    return Array.from(this.sequences.values());
  }

  /**
   * Delete a sequence
   */
  deleteSequence(id: string): boolean {
    // Cancel all active runs for this sequence
    for (const [runId, run] of this.activeRuns) {
      if (run.sequenceId === id) {
        run.status = 'cancelled';
        this.activeRuns.delete(runId);
      }
    }

    const deleted = this.sequences.delete(id);
    if (deleted) this.save();
    return deleted;
  }

  // ── Persistence ───────────────────────────────────────────────

  private save(): void {
    try {
      const data = {
        sequences: Array.from(this.sequences.values()).map(s => ({
          ...s,
          createdAt: s.createdAt.toISOString(),
        })),
        activeRuns: Array.from(this.activeRuns.values()).map(r => ({
          ...r,
          nextRunAt: r.nextRunAt.toISOString(),
          lastSentAt: r.lastSentAt?.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
      };
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to persist scheduling workflows');
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const content = readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(content) as any;

      if (data.sequences) {
        for (const item of data.sequences) {
          const sequence: FollowUpSequence = {
            ...item,
            createdAt: new Date(item.createdAt),
          };
          this.sequences.set(sequence.id, sequence);
        }
      }

      if (data.activeRuns) {
        for (const item of data.activeRuns) {
          const run: SequenceRun = {
            ...item,
            nextRunAt: new Date(item.nextRunAt),
            lastSentAt: item.lastSentAt ? new Date(item.lastSentAt) : undefined,
            createdAt: new Date(item.createdAt),
          };
          this.activeRuns.set(run.id, run);
        }
      }

      this.logger.info('Loaded %d sequences and %d active runs from disk',
        this.sequences.size, this.activeRuns.size);
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to load scheduling workflows');
    }
  }
}
