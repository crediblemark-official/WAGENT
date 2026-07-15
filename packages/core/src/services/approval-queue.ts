import { Logger } from 'pino';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import {
  ApprovalRequest,
  ApprovalStatus,
  ApprovalSource,
  ApprovalActionType,
  GatewayEvent,
} from '../types.js';
import { EventBus } from '../utils/event-bus.js';
import { getLogger } from '../utils/logger.js';

/**
 * ApprovalQueue handles pending actions that need human approval.
 *
 * Flow:
 * 1. Tool/Agent creates an ApprovalRequest via enqueue()
 * 2. EventBus emits 'approval:request' → Telegram/Dashboard notified
 * 3. User approves/rejects via Telegram or Dashboard
 * 4. EventBus emits 'approval:update' → agent notified
 * 5. Request executor can check resolved requests via getResolved()
 *
 * Persistence: Automatically saves/loads from a JSON file.
 * Auto-expire: Pending requests expire after configurable timeout.
 */
export class ApprovalQueue {
  private logger: Logger;
  private requests: Map<string, ApprovalRequest> = new Map();
  private eventBus: EventBus;
  private persistPath: string;
  private defaultTimeoutMinutes: number;
  private expireTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: {
    eventBus?: EventBus;
    persistPath?: string;
    defaultTimeoutMinutes?: number;
  }) {
    this.logger = getLogger().child({ module: 'approval-queue' });
    this.eventBus = options?.eventBus || new EventBus();
    this.persistPath = options?.persistPath || join(process.cwd(), 'data', 'approval-queue.json');
    this.defaultTimeoutMinutes = options?.defaultTimeoutMinutes || 60;

    // Ensure data directory exists
    const dir = dirname(this.persistPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.load();
    this.startExpireCheck();
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Enqueue a new approval request.
   * Emits 'approval:request' event.
   * Returns the request ID.
   */
  enqueue(params: {
    type: ApprovalActionType;
    title: string;
    description: string;
    source?: ApprovalSource;
    contactId?: string;
    contactName?: string;
    toolName: string;
    args: Record<string, unknown>;
    reason?: string;
    aiReasoning?: string;
    timeoutMinutes?: number;
  }): string {
    const id = this.generateId();

    const request: ApprovalRequest = {
      id,
      type: params.type,
      title: params.title,
      description: params.description,
      status: 'pending',
      source: params.source || 'agent',
      contactId: params.contactId,
      contactName: params.contactName,
      action: {
        toolName: params.toolName,
        args: params.args,
      },
      context: {
        reason: params.reason || 'Action requires approval',
        aiReasoning: params.aiReasoning,
      },
      expiresAt: new Date(Date.now() + (params.timeoutMinutes || this.defaultTimeoutMinutes) * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.requests.set(id, request);
    this.save();
    this.emit('approval:request', request);

    this.logger.info({ id, type: params.type, toolName: params.toolName }, 'Approval request enqueued');
    return id;
  }

  /**
   * Approve a pending request.
   * Emits 'approval:update' event.
   * Returns true if successfully approved.
   */
  approve(id: string, resolvedBy?: string, note?: string): boolean {
    const request = this.requests.get(id);
    if (!request || request.status !== 'pending') return false;

    request.status = 'approved';
    request.resolvedAt = new Date();
    request.resolvedBy = (resolvedBy || 'system') as ApprovalRequest['resolvedBy'];
    request.resolutionNote = note;
    request.updatedAt = new Date();

    this.save();
    this.emit('approval:update', request);

    this.logger.info({ id, resolvedBy }, 'Approval request approved');
    return true;
  }

  /**
   * Reject a pending request.
   * Emits 'approval:update' event.
   * Returns true if successfully rejected.
   */
  reject(id: string, resolvedBy?: string, reason?: string): boolean {
    const request = this.requests.get(id);
    if (!request || request.status !== 'pending') return false;

    request.status = 'rejected';
    request.resolvedAt = new Date();
    request.resolvedBy = (resolvedBy || 'system') as ApprovalRequest['resolvedBy'];
    request.resolutionNote = reason || 'Rejected';
    request.updatedAt = new Date();

    this.save();
    this.emit('approval:update', request);

    this.logger.info({ id, resolvedBy }, 'Approval request rejected');
    return true;
  }

  /**
   * Cancel a request (by the system/agent, not by user rejection).
   */
  cancel(id: string, reason?: string): boolean {
    const request = this.requests.get(id);
    if (!request || request.status !== 'pending') return false;

    request.status = 'cancelled';
    request.resolvedAt = new Date();
    request.resolvedBy = 'system';
    request.resolutionNote = reason || 'Cancelled';
    request.updatedAt = new Date();

    this.save();
    this.emit('approval:update', request);

    return true;
  }

  /**
   * Get a specific request.
   */
  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  /**
   * Get all requests, optionally filtered by status.
   */
  getAll(status?: ApprovalStatus): ApprovalRequest[] {
    const all = Array.from(this.requests.values());
    if (status) return all.filter(r => r.status === status);
    return all;
  }

  /**
   * Get all pending requests.
   */
  getPending(): ApprovalRequest[] {
    return this.getAll('pending');
  }

  /**
   * Get recently resolved requests (within last N minutes).
   */
  getRecentlyResolved(minutes = 60): ApprovalRequest[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return Array.from(this.requests.values()).filter(
      r => r.status !== 'pending' && r.resolvedAt && r.resolvedAt.getTime() > cutoff
    );
  }

  /**
   * Get a specific resolved request that can be executed.
   * Returns null if not approved or not found.
   */
  getResolvedForExecution(id: string): ApprovalRequest | null {
    const request = this.requests.get(id);
    if (!request || request.status !== 'approved') return null;
    return request;
  }

  /**
   * Get queue statistics.
   */
  getStats(): {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
    cancelled: number;
  } {
    const all = Array.from(this.requests.values());
    return {
      total: all.length,
      pending: all.filter(r => r.status === 'pending').length,
      approved: all.filter(r => r.status === 'approved').length,
      rejected: all.filter(r => r.status === 'rejected').length,
      expired: all.filter(r => r.status === 'expired').length,
      cancelled: all.filter(r => r.status === 'cancelled').length,
    };
  }

  /**
   * Clear old resolved requests (older than specified hours).
   * Returns number of cleared requests.
   */
  clearOld(hours = 24): number {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    let count = 0;
    for (const [id, request] of this.requests) {
      if (request.status !== 'pending' && request.resolvedAt && request.resolvedAt.getTime() < cutoff) {
        this.requests.delete(id);
        count++;
      }
    }
    if (count > 0) {
      this.save();
      this.logger.info('Cleared %d old approval requests', count);
    }
    return count;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  startExpireCheck(): void {
    if (this.expireTimer) return;
    this.expireTimer = setInterval(() => this.checkExpired(), 30_000); // every 30s
  }

  stopExpireCheck(): void {
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.stopExpireCheck();
    this.save();
    this.requests.clear();
  }

  // ── Private ─────────────────────────────────────────────────

  private checkExpired(): void {
    const now = Date.now();
    for (const [id, request] of this.requests) {
      if (request.status === 'pending' && request.expiresAt.getTime() <= now) {
        request.status = 'expired';
        request.resolvedAt = new Date();
        request.resolvedBy = 'auto_expire';
        request.updatedAt = new Date();

        this.emit('approval:update', request);
        this.logger.info({ id }, 'Approval request auto-expired');
      }
    }
    this.save();
  }

  private emit(type: GatewayEvent['type'], request: ApprovalRequest): void {
    try {
      if (type === 'approval:request') {
        this.eventBus.emit({ type: 'approval:request', request });
      } else if (type === 'approval:update') {
        this.eventBus.emit({ type: 'approval:update', request });
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to emit approval event');
    }
  }

  private generateId(): string {
    return `apr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  // ── Persistence (JSON) ─────────────────────────────────────────

  private save(): void {
    try {
      const data = Array.from(this.requests.values()).map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString(),
      }));
      writeFileSync(this.persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to persist approval queue');
    }
  }

  private load(): void {
    try {
      if (!existsSync(this.persistPath)) return;
      const content = readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(content) as any[];
      for (const item of data) {
        const request: ApprovalRequest = {
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
          expiresAt: new Date(item.expiresAt),
          resolvedAt: item.resolvedAt ? new Date(item.resolvedAt) : undefined,
        };
        this.requests.set(request.id, request);
      }
      this.logger.info('Loaded %d approval requests from disk', data.length);
    } catch (err: any) {
      this.logger.warn({ error: err.message }, 'Failed to load approval queue');
    }
  }
}
