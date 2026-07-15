import { Logger } from 'pino';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { ProactiveAction, ProactiveTriggerType, ProactiveActionType } from '../types.js';
import type { ApprovalQueue } from './approval-queue.js';
import type { Database } from '../storage/index.js';
import { getLogger } from '../utils/logger.js';

/**
 * ProactiveScheduler manages trigger-based actions.
 * Works alongside the v1 Scheduler (which handles cron message sending).
 *
 * The ProactiveScheduler:
 * - Holds a list of ProactiveAction rules
 * - Checks at regular interval which actions should trigger
 * - For actions that need approval: creates ApprovalRequest
 * - For auto-fire actions: directly triggers execution
 *
 * Trigger types:
 * - 'time': Cron-like schedule (e.g., "every 3 days at 10:00")
 * - 'event': Event-based (e.g., "when new message from VIP")
 * - 'pattern': Pattern-based (e.g., "3 days no reply → follow up")
 */
export class ProactiveScheduler {
  private logger: Logger;
  private actions: Map<string, ProactiveAction> = new Map();
  private approvalQueue?: ApprovalQueue;
  private db?: Database;
  private persistPath: string;
  private checkIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private onActionTrigger?: (action: ProactiveAction) => Promise<void>;
  private pendingEvents: Map<string, Date> = new Map();

  constructor(options?: {
    db?: Database;
    approvalQueue?: ApprovalQueue;
    persistPath?: string;
    checkIntervalMs?: number;
    onActionTrigger?: (action: ProactiveAction) => Promise<void>;
  }) {
    this.logger = getLogger().child({ module: 'proactive-scheduler' });
    this.db = options?.db;
    this.approvalQueue = options?.approvalQueue;
    this.persistPath = options?.persistPath || join(process.cwd(), 'data', 'proactive-actions.json');
    this.checkIntervalMs = options?.checkIntervalMs || 60_000; // Check every 60s
    this.onActionTrigger = options?.onActionTrigger;

    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.load();
  }

  // ── Action Management ────────────────────────────────────────

  /**
   * Register a proactive action rule.
   */
  addAction(action: ProactiveAction): void {
    this.actions.set(action.id, action);
    this.save();
    this.logger.info({ id: action.id, type: action.actionType }, 'Proactive action registered');
  }

  /**
   * Remove a proactive action.
   */
  removeAction(id: string): boolean {
    const existed = this.actions.delete(id);
    if (existed) {
      this.save();
      this.logger.info({ id }, 'Proactive action removed');
    }
    return existed;
  }

  /**
   * Update an existing action.
   */
  updateAction(id: string, updates: Partial<ProactiveAction>): boolean {
    const action = this.actions.get(id);
    if (!action) return false;

    Object.assign(action, updates, { updatedAt: new Date() });
    this.save();
    this.logger.info({ id }, 'Proactive action updated');
    return true;
  }

  /**
   * Get a specific action.
   */
  getAction(id: string): ProactiveAction | undefined {
    return this.actions.get(id);
  }

  /**
   * Get all registered actions.
   */
  getAllActions(): ProactiveAction[] {
    return Array.from(this.actions.values());
  }

  /**
   * Get actions that are enabled.
   */
  getEnabledActions(): ProactiveAction[] {
    return this.getAllActions().filter(a => a.enabled);
  }

  /**
   * Create a reminder action helper.
   */
  createReminder(params: {
    contactId: string;
    contactName: string;
    title: string;
    prompt: string;
    schedule: string; // e.g., "0 10 * * *" for daily at 10:00
    requiresApproval?: boolean;
    priority?: number;
  }): ProactiveAction {
    const action: ProactiveAction = {
      id: `pro_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      trigger: {
        id: `trg_${Date.now()}`,
        type: 'time',
        schedule: params.schedule,
        contactId: params.contactId,
        contactName: params.contactName,
      },
      actionType: 'reminder',
      title: params.title,
      description: `Reminder for ${params.contactName}: ${params.title}`,
      prompt: params.prompt,
      priority: params.priority || 0,
      requiresApproval: params.requiresApproval ?? true,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.addAction(action);
    return action;
  }

  /**
   * Create a follow-up action helper.
   */
  createFollowUp(params: {
    contactId: string;
    contactName: string;
    title: string;
    prompt: string;
    daysInactive: number;
    requiresApproval?: boolean;
  }): ProactiveAction {
    const action: ProactiveAction = {
      id: `pro_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      trigger: {
        id: `trg_${Date.now()}`,
        type: 'pattern',
        condition: `${params.daysInactive} days no reply`,
        contactId: params.contactId,
        contactName: params.contactName,
      },
      actionType: 'follow_up',
      title: params.title,
      description: `Follow up with ${params.contactName} after ${params.daysInactive} days inactive`,
      prompt: params.prompt,
      priority: 1,
      requiresApproval: params.requiresApproval ?? true,
      cooldownMinutes: params.daysInactive * 24 * 60, // Don't re-trigger within same period
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.addAction(action);
    return action;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.logger.info('Proactive scheduler started (checking every %ds)', this.checkIntervalMs / 1000);

    // Run check immediately
    this.checkActions();
    this.timer = setInterval(() => this.checkActions(), this.checkIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info('Proactive scheduler stopped');
  }

  /**
   * Register an external event for event-based triggers.
   * Call this when something happens (e.g., new message, order created).
   */
  registerEvent(eventName: string): void {
    this.pendingEvents.set(eventName, new Date());
    this.logger.debug({ event: eventName }, 'Event registered for proactive triggers');
  }

  /**
   * Manually trigger a check for all actions.
   * Returns actions that would trigger.
   */
  checkActions(): ProactiveAction[] {
    if (!this.running) return [];

    const triggered: ProactiveAction[] = [];
    const now = new Date();

    for (const action of this.getEnabledActions()) {
      if (!this.shouldTrigger(action, now)) continue;

      triggered.push(action);

      // Update last triggered
      action.lastTriggeredAt = now;
      this.save();

      this.logger.info(
        { id: action.id, type: action.actionType, contact: action.trigger.contactName },
        'Proactive action triggered: %s', action.title
      );

      // Handle the triggered action
      this.handleTrigger(action).catch(err => {
        this.logger.error({ id: action.id, error: err.message }, 'Failed to handle proactive action');
      });
    }

    return triggered;
  }

  // ── Private ─────────────────────────────────────────────────

  /**
   * Check if an action should trigger now based on its trigger type.
   */
  private shouldTrigger(action: ProactiveAction, now: Date): boolean {
    // Check cooldown
    if (action.lastTriggeredAt && action.cooldownMinutes) {
      const elapsed = (now.getTime() - action.lastTriggeredAt.getTime()) / (60 * 1000);
      if (elapsed < action.cooldownMinutes) return false;
    }

    switch (action.trigger.type) {
      case 'time':
        return this.checkTimeTrigger(action, now);
      case 'event': {
        // Event-based triggers check if the expected event has been registered
        const eventName = action.trigger.event;
        if (!eventName) return false;
        const eventTime = this.pendingEvents.get(eventName);
        if (!eventTime) return false;
        // Check if event happened after last trigger
        if (action.lastTriggeredAt && eventTime <= action.lastTriggeredAt) return false;
        // Clean up processed event
        this.pendingEvents.delete(eventName);
        return true;
      }
      case 'pattern': {
        // Pattern triggers with schedule use time-based check
        if (action.trigger.schedule) {
          return this.checkTimeTrigger(action, now);
        }
        // Pattern triggers without schedule check DB for last message time
        if (action.trigger.condition && action.trigger.contactId && this.db) {
          try {
            const messages = this.db.getMessages(action.trigger.contactId, 1);
            if (messages.length === 0) return false;
            const lastMsgTime = new Date(messages[0].timestamp).getTime();
            const daysSince = (now.getTime() - lastMsgTime) / (24 * 60 * 60 * 1000);
            const daysMatch = action.trigger.condition.match(/^(\d+)\s+days?\s+no\s+reply/i);
            if (daysMatch) {
              const threshold = parseInt(daysMatch[1], 10);
              return daysSince >= threshold;
            }
          } catch {
            return false;
          }
        }
        return false;
      }
      default:
        return false;
    }
  }

  /**
   * Check if a time-based trigger should fire.
   * Supports cron-like format: "minute hour * * *" or "(asterisk)/N * * * *"
   * Also supports: "every N days at HH:mm"
   */
  private checkTimeTrigger(action: ProactiveAction, now: Date): boolean {
    const schedule = action.trigger.schedule;
    if (!schedule) return false;

    // Check window hours
    if (action.windowStart || action.windowEnd) {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      if (action.windowStart) {
        const [h, m] = action.windowStart.split(':').map(Number);
        if (currentMinutes < h * 60 + m) return false;
      }
      if (action.windowEnd) {
        const [h, m] = action.windowEnd.split(':').map(Number);
        if (currentMinutes >= h * 60 + m) return false;
      }
    }

    // Parse simple cron format: "minute hour * * *"
    const parts = schedule.split(/\s+/);
    if (parts.length === 5) {
      return this.matchCron(parts, now);
    }

    // Parse "every N days at HH:mm"
    const everyMatch = schedule.match(/^every\s+(\d+)\s+days?\s+at\s+(\d+):(\d+)$/i);
    if (everyMatch) {
      const intervalDays = parseInt(everyMatch[1], 10);
      const targetHour = parseInt(everyMatch[2], 10);
      const targetMin = parseInt(everyMatch[3], 10);

      // Check if current time matches the target hour/minute
      if (now.getHours() !== targetHour || now.getMinutes() !== targetMin) return false;

      // Check if enough days have passed since last trigger
      if (action.lastTriggeredAt) {
        const daysSinceLast = (now.getTime() - action.lastTriggeredAt.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceLast < intervalDays) return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Simple cron matching (minute hour * * *).
   * Supports: *, (asterisk)/N, N
   */
  private matchCron(parts: string[], now: Date): boolean {
    const [minute, hour] = parts;

    const checkCronPart = (part: string, value: number): boolean => {
      if (part === '*') return true;
      if (part.startsWith('*/')) {
        const interval = parseInt(part.substring(2), 10);
        return interval > 0 && value % interval === 0;
      }
      return parseInt(part, 10) === value;
    };

    // Only check first check of the day for day-based triggers
    // to avoid re-triggering every minute
    if (parts[3] !== '*' || parts[4] !== '*') {
      // Day-of-month or day-of-week specified — check at most once per hour
      if (now.getMinutes() !== 0) return false;
      return checkCronPart(minute, now.getMinutes()) && checkCronPart(hour, now.getHours());
    }

    return checkCronPart(minute, now.getMinutes()) && checkCronPart(hour, now.getHours());
  }

  /**
   * Check if an event matches any event-based trigger.
   * Called externally when events occur.
   */
  checkEventTrigger(eventType: string, contactId?: string): ProactiveAction[] {
    const matched: ProactiveAction[] = [];
    for (const action of this.getEnabledActions()) {
      if (action.trigger.type !== 'event') continue;
      if (action.trigger.event && action.trigger.event !== eventType) continue;
      if (contactId && action.trigger.contactId && action.trigger.contactId !== contactId) continue;

      matched.push(action);
    }
    return matched;
  }

  /**
   * Check if a pattern-based trigger matches.
   * Called externally with context data.
   */
  checkPatternTrigger(context: {
    contactId?: string;
    daysSinceLastMessage?: number;
  }): ProactiveAction[] {
    const matched: ProactiveAction[] = [];
    for (const action of this.getEnabledActions()) {
      if (action.trigger.type !== 'pattern') continue;

      // Check contact match
      if (action.trigger.contactId && action.trigger.contactId !== context.contactId) continue;

      // Check condition
      if (action.trigger.condition && context.daysSinceLastMessage !== undefined) {
        const daysMatch = action.trigger.condition.match(/^(\d+)\s+days?\s+no\s+reply/i);
        if (daysMatch) {
          const threshold = parseInt(daysMatch[1], 10);
          if (context.daysSinceLastMessage < threshold) continue;
        }
      }

      matched.push(action);
    }
    return matched;
  }

  /**
   * Handle a triggered action.
   * If requiresApproval: queue to ApprovalQueue.
   * Otherwise: call onActionTrigger callback.
   */
  private async handleTrigger(action: ProactiveAction): Promise<void> {
    if (action.requiresApproval && this.approvalQueue) {
      this.approvalQueue.enqueue({
        type: 'proactive_action',
        title: action.title,
        description: action.description,
        source: 'agent',
        contactId: action.trigger.contactId,
        contactName: action.trigger.contactName,
        toolName: 'proactive_action',
        args: { actionId: action.id, prompt: action.prompt },
        reason: `Proactive action triggered: ${action.title}`,
      });
      this.logger.info({ id: action.id }, 'Proactive action queued for approval');
    } else if (this.onActionTrigger) {
      await this.onActionTrigger(action);
    }
  }

  // ── Persistence ───────────────────────────────────────────────

  private save(): void {
    try {
      const data = Array.from(this.actions.values()).map(a => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        lastTriggeredAt: a.lastTriggeredAt?.toISOString(),
        trigger: {
          ...a.trigger,
        },
      }));
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to persist proactive actions');
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const content = readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(content) as any[];
      for (const item of data) {
        const action: ProactiveAction = {
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          lastTriggeredAt: item.lastTriggeredAt ? new Date(item.lastTriggeredAt) : undefined,
          trigger: {
            ...item.trigger,
          },
        };
        this.actions.set(action.id, action);
      }
      this.logger.info('Loaded %d proactive actions from disk', data.length);
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to load proactive actions');
    }
  }
}
