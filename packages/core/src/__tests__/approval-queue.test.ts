import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { ApprovalQueue } from '../services/approval-queue.js';
import { EventBus } from '../utils/event-bus.js';
import { ApprovalActionType, ApprovalRequest } from '../types.js';

function makeEnqueueParams(overrides: Record<string, unknown> = {}) {
  return {
    type: 'send_message' as ApprovalActionType,
    title: 'Send welcome message',
    description: 'Send a greeting to new contact',
    toolName: 'send_message',
    args: { to: '123', content: 'Hello!' },
    ...overrides,
  };
}

describe('ApprovalQueue', () => {
  let queue: ApprovalQueue;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (existsSync as any).mockReturnValue(false);
    (readFileSync as any).mockReturnValue('[]');
    eventBus = new EventBus();
    queue = new ApprovalQueue({
      eventBus,
      persistPath: '/tmp/test-approval-queue.json',
      defaultTimeoutMinutes: 60,
    });
  });

  afterEach(() => {
    queue.destroy();
    vi.useRealTimers();
  });

  describe('enqueue', () => {
    it('should add a pending request and return an ID', () => {
      const id = queue.enqueue(makeEnqueueParams());
      expect(id).toMatch(/^apr_\d+_[a-z0-9]+$/);
      const request = queue.get(id);
      expect(request).toBeDefined();
      expect(request!.status).toBe('pending');
    });

    it('should emit approval:request event', () => {
      const handler = vi.fn();
      eventBus.on('approval:request', handler);

      const id = queue.enqueue(makeEnqueueParams());
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'approval:request', request: expect.objectContaining({ id }) })
      );
    });

    it('should set expiresAt based on default timeout', () => {
      const id = queue.enqueue(makeEnqueueParams());
      const request = queue.get(id)!;
      const expectedExpiry = Date.now() + 60 * 60 * 1000;
      expect(request.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);
    });

    it('should set expiresAt based on custom timeout', () => {
      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));
      const request = queue.get(id)!;
      const expectedExpiry = Date.now() + 5 * 60 * 1000;
      expect(request.expiresAt.getTime()).toBeCloseTo(expectedExpiry, -3);
    });

    it('should default source to agent', () => {
      const id = queue.enqueue(makeEnqueueParams());
      expect(queue.get(id)!.source).toBe('agent');
    });

    it('should use provided source', () => {
      const id = queue.enqueue(makeEnqueueParams({ source: 'manual' }));
      expect(queue.get(id)!.source).toBe('manual');
    });

    it('should default reason to Action requires approval', () => {
      const id = queue.enqueue(makeEnqueueParams());
      expect(queue.get(id)!.context.reason).toBe('Action requires approval');
    });

    it('should persist to disk', () => {
      queue.enqueue(makeEnqueueParams());
      expect(writeFileSync).toHaveBeenCalled();
    });
  });

  describe('approve', () => {
    it('should mark a pending request as approved', () => {
      const id = queue.enqueue(makeEnqueueParams());
      const result = queue.approve(id, 'admin', 'Looks good');
      expect(result).toBe(true);
      expect(queue.get(id)!.status).toBe('approved');
    });

    it('should emit approval:update event', () => {
      const handler = vi.fn();
      eventBus.on('approval:update', handler);

      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id, 'admin');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'approval:update', request: expect.objectContaining({ id, status: 'approved' }) })
      );
    });

    it('should set resolvedBy and resolvedAt', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id, 'admin', 'ok');
      const request = queue.get(id)!;
      expect(request.resolvedBy).toBe('admin');
      expect(request.resolvedAt).toBeInstanceOf(Date);
      expect(request.resolutionNote).toBe('ok');
    });

    it('should default resolvedBy to system', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id);
      expect(queue.get(id)!.resolvedBy).toBe('system');
    });

    it('should return false for non-existent id', () => {
      expect(queue.approve('fake-id')).toBe(false);
    });

    it('should return false for already approved request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id);
      expect(queue.approve(id)).toBe(false);
    });

    it('should return false for rejected request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.reject(id);
      expect(queue.approve(id)).toBe(false);
    });
  });

  describe('reject', () => {
    it('should mark a pending request as rejected', () => {
      const id = queue.enqueue(makeEnqueueParams());
      const result = queue.reject(id, 'admin', 'Not now');
      expect(result).toBe(true);
      expect(queue.get(id)!.status).toBe('rejected');
    });

    it('should emit approval:update event', () => {
      const handler = vi.fn();
      eventBus.on('approval:update', handler);

      const id = queue.enqueue(makeEnqueueParams());
      queue.reject(id, 'admin');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'approval:update', request: expect.objectContaining({ id, status: 'rejected' }) })
      );
    });

    it('should default resolutionNote to Rejected', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.reject(id);
      expect(queue.get(id)!.resolutionNote).toBe('Rejected');
    });

    it('should return false for non-existent id', () => {
      expect(queue.reject('fake-id')).toBe(false);
    });

    it('should return false for already resolved request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.reject(id);
      expect(queue.reject(id)).toBe(false);
    });
  });

  describe('cancel', () => {
    it('should mark a pending request as cancelled', () => {
      const id = queue.enqueue(makeEnqueueParams());
      const result = queue.cancel(id, 'Changed mind');
      expect(result).toBe(true);
      expect(queue.get(id)!.status).toBe('cancelled');
    });

    it('should set resolvedBy to system', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.cancel(id);
      expect(queue.get(id)!.resolvedBy).toBe('system');
    });

    it('should default resolutionNote to Cancelled', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.cancel(id);
      expect(queue.get(id)!.resolutionNote).toBe('Cancelled');
    });

    it('should return false for non-existent id', () => {
      expect(queue.cancel('fake-id')).toBe(false);
    });

    it('should return false for already resolved request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.cancel(id);
      expect(queue.cancel(id)).toBe(false);
    });
  });

  describe('getPending', () => {
    it('should return only pending requests', () => {
      const id1 = queue.enqueue(makeEnqueueParams({ title: 'A' }));
      const id2 = queue.enqueue(makeEnqueueParams({ title: 'B' }));
      const id3 = queue.enqueue(makeEnqueueParams({ title: 'C' }));

      queue.approve(id2);
      queue.reject(id3);

      const pending = queue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id1);
    });

    it('should return empty array when no pending requests', () => {
      expect(queue.getPending()).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    it('should return all requests when no status filter', () => {
      queue.enqueue(makeEnqueueParams({ title: 'A' }));
      queue.enqueue(makeEnqueueParams({ title: 'B' }));
      expect(queue.getAll()).toHaveLength(2);
    });

    it('should filter by status', () => {
      const id1 = queue.enqueue(makeEnqueueParams());
      queue.enqueue(makeEnqueueParams());
      queue.approve(id1);

      expect(queue.getAll('approved')).toHaveLength(1);
      expect(queue.getAll('pending')).toHaveLength(1);
    });
  });

  describe('get', () => {
    it('should return request by id', () => {
      const id = queue.enqueue(makeEnqueueParams());
      const request = queue.get(id);
      expect(request).toBeDefined();
      expect(request!.id).toBe(id);
    });

    it('should return undefined for unknown id', () => {
      expect(queue.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getResolvedForExecution', () => {
    it('should return approved request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id);
      expect(queue.getResolvedForExecution(id)).toBeDefined();
    });

    it('should return null for pending request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      expect(queue.getResolvedForExecution(id)).toBeNull();
    });

    it('should return null for rejected request', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.reject(id);
      expect(queue.getResolvedForExecution(id)).toBeNull();
    });

    it('should return null for unknown id', () => {
      expect(queue.getResolvedForExecution('nope')).toBeNull();
    });
  });

  describe('getRecentlyResolved', () => {
    it('should return resolved requests within time window', () => {
      const id1 = queue.enqueue(makeEnqueueParams());
      const id2 = queue.enqueue(makeEnqueueParams());

      queue.approve(id1);
      vi.advanceTimersByTime(10 * 60 * 1000); // 10 minutes
      queue.reject(id2);

      const recent = queue.getRecentlyResolved(60);
      expect(recent).toHaveLength(2);
    });

    it('should exclude old resolved requests', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id);

      vi.advanceTimersByTime(70 * 60 * 1000); // 70 minutes

      const recent = queue.getRecentlyResolved(60);
      expect(recent).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct counts', () => {
      const id1 = queue.enqueue(makeEnqueueParams());
      const id2 = queue.enqueue(makeEnqueueParams());
      const id3 = queue.enqueue(makeEnqueueParams());

      queue.approve(id1);
      queue.reject(id2);

      const stats = queue.getStats();
      expect(stats.total).toBe(3);
      expect(stats.pending).toBe(1);
      expect(stats.approved).toBe(1);
      expect(stats.rejected).toBe(1);
      expect(stats.expired).toBe(0);
      expect(stats.cancelled).toBe(0);
    });
  });

  describe('auto-expire', () => {
    it('should expire pending requests after TTL', () => {
      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));
      expect(queue.get(id)!.status).toBe('pending');

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const request = queue.get(id)!;
      expect(request.status).toBe('expired');
      expect(request.resolvedBy).toBe('auto_expire');
      expect(request.resolvedAt).toBeInstanceOf(Date);
    });

    it('should emit approval:update when request expires', () => {
      const handler = vi.fn();
      eventBus.on('approval:update', handler);

      queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval:update',
          request: expect.objectContaining({ status: 'expired', resolvedBy: 'auto_expire' }),
        })
      );
    });

    it('should not expire already approved requests', () => {
      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));
      queue.approve(id);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(queue.get(id)!.status).toBe('approved');
    });

    it('should not expire already rejected requests', () => {
      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));
      queue.reject(id);

      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(queue.get(id)!.status).toBe('rejected');
    });

    it('should check expired on 30s interval', () => {
      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 1 }));
      expect(queue.get(id)!.status).toBe('pending');

      vi.advanceTimersByTime(30_000);
      expect(queue.get(id)!.status).toBe('pending');

      vi.advanceTimersByTime(30_001);
      expect(queue.get(id)!.status).toBe('expired');
    });

    it('should handle multiple requests with different expiry times', () => {
      const id1 = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 2 }));
      const id2 = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 10 }));

      vi.advanceTimersByTime(2 * 60 * 1000 + 1);

      expect(queue.get(id1)!.status).toBe('expired');
      expect(queue.get(id2)!.status).toBe('pending');

      vi.advanceTimersByTime(8 * 60 * 1000);

      expect(queue.get(id2)!.status).toBe('expired');
    });
  });

  describe('clearOld', () => {
    it('should remove resolved requests older than cutoff', () => {
      const id1 = queue.enqueue(makeEnqueueParams());
      const id2 = queue.enqueue(makeEnqueueParams());

      queue.approve(id1);

      vi.advanceTimersByTime(25 * 60 * 60 * 1000); // 25 hours

      const removed = queue.clearOld(24);
      expect(removed).toBe(1);
      expect(queue.get(id1)).toBeUndefined();
      expect(queue.get(id2)).toBeDefined();
    });

    it('should not remove pending requests', () => {
      queue.enqueue(makeEnqueueParams());
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const removed = queue.clearOld(24);
      expect(removed).toBe(0);
    });

    it('should not remove recently resolved requests', () => {
      const id = queue.enqueue(makeEnqueueParams());
      queue.approve(id);

      vi.advanceTimersByTime(1 * 60 * 60 * 1000); // 1 hour

      const removed = queue.clearOld(24);
      expect(removed).toBe(0);
      expect(queue.get(id)).toBeDefined();
    });

    it('should return 0 when nothing to clear', () => {
      expect(queue.clearOld(24)).toBe(0);
    });
  });

  describe('lifecycle', () => {
    it('stopExpireCheck should halt auto-expire', () => {
      queue.stopExpireCheck();
      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));

      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(queue.get(id)!.status).toBe('pending');
    });

    it('startExpireCheck should not create duplicate intervals', () => {
      queue.startExpireCheck();
      queue.startExpireCheck();

      const id = queue.enqueue(makeEnqueueParams({ timeoutMinutes: 5 }));
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(queue.get(id)!.status).toBe('expired');
    });

    it('destroy should clear all data and stop timer', () => {
      queue.enqueue(makeEnqueueParams());
      queue.destroy();

      expect(queue.getPending()).toHaveLength(0);
      expect(queue.getAll()).toHaveLength(0);

      queue.stopExpireCheck(); // should not throw
    });
  });

  describe('persistence', () => {
    it('should load existing requests from disk', () => {
      const existingData = [
        {
          id: 'apr_existing_1',
          type: 'send_message',
          title: 'Existing',
          description: 'Already saved',
          status: 'pending',
          source: 'agent',
          action: { toolName: 'send_message', args: {} },
          context: { reason: 'test' },
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      (readFileSync as any).mockReturnValue(JSON.stringify(existingData));
      (existsSync as any).mockReturnValue(true);

      const q = new ApprovalQueue({
        eventBus: new EventBus(),
        persistPath: '/tmp/test-load.json',
      });

      expect(q.get('apr_existing_1')).toBeDefined();
      q.destroy();
    });

    it('should handle missing persist file gracefully', () => {
      (existsSync as any).mockReturnValue(false);

      const q = new ApprovalQueue({
        eventBus: new EventBus(),
        persistPath: '/tmp/nonexistent.json',
      });

      expect(q.getAll()).toHaveLength(0);
      q.destroy();
    });
  });
});
