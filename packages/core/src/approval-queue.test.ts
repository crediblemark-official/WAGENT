import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ApprovalQueue } from './approval-queue.js';
import { ApprovalRequest } from './types.js';

const TEST_PERSIST_PATH = join(process.cwd(), 'data', 'test-approval-queue.json');

describe('ApprovalQueue', () => {
  let queue: ApprovalQueue;

  beforeEach(() => {
    // Clean up any leftover test file
    try { if (existsSync(TEST_PERSIST_PATH)) unlinkSync(TEST_PERSIST_PATH); } catch {}
    queue = new ApprovalQueue({
      persistPath: TEST_PERSIST_PATH,
      defaultTimeoutMinutes: 60,
    });
  });

  afterEach(() => {
    queue.destroy();
    try { if (existsSync(TEST_PERSIST_PATH)) unlinkSync(TEST_PERSIST_PATH); } catch {}
  });

  describe('enqueue', () => {
    it('should create an approval request with pending status', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Send message to Budi',
        description: 'AI wants to send a message',
        toolName: 'send_message',
        args: { to: 'budi', content: 'Halo Budi!' },
        reason: 'User requires approval for sending messages',
      });

      expect(id).toBeTruthy();
      expect(id.startsWith('apr_')).toBe(true);

      const request = queue.get(id);
      expect(request).toBeDefined();
      expect(request!.status).toBe('pending');
      expect(request!.type).toBe('send_message');
      expect(request!.action.toolName).toBe('send_message');
    });

    it('should set default timeout', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Test',
        description: 'Test',
        toolName: 'test',
        args: {},
      });

      const request = queue.get(id)!;
      const expectedExpiry = Date.now() + 60 * 60 * 1000;
      expect(request.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 1000);
      expect(request.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry);
    });

    it('should accept custom timeout', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Test',
        description: 'Test',
        toolName: 'test',
        args: {},
        timeoutMinutes: 5,
      });

      const request = queue.get(id)!;
      const expectedExpiry = Date.now() + 5 * 60 * 1000;
      expect(request.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 1000);
      expect(request.expiresAt.getTime()).toBeLessThanOrEqual(expectedExpiry);
    });

    it('should set optional fields', () => {
      const id = queue.enqueue({
        type: 'create_order',
        title: 'Create order for Joni',
        description: 'Order: Kaos Polos x2',
        source: 'agent',
        contactId: '62812@s.whatsapp.net',
        contactName: 'Joni',
        toolName: 'create_order',
        args: { product: 'Kaos Polos', qty: 2 },
        reason: 'New order needs approval',
        aiReasoning: 'Customer requested 2 pcs Kaos Polos',
      });

      const request = queue.get(id)!;
      expect(request.source).toBe('agent');
      expect(request.contactId).toBe('62812@s.whatsapp.net');
      expect(request.contactName).toBe('Joni');
      expect(request.context.aiReasoning).toBe('Customer requested 2 pcs Kaos Polos');
    });
  });

  describe('approve', () => {
    it('should approve a pending request', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Test',
        description: 'Test',
        toolName: 'test',
        args: {},
      });

      const result = queue.approve(id, 'telegram', 'Looks good');
      expect(result).toBe(true);

      const request = queue.get(id)!;
      expect(request.status).toBe('approved');
      expect(request.resolvedBy).toBe('telegram');
      expect(request.resolutionNote).toBe('Looks good');
      expect(request.resolvedAt).toBeDefined();
    });

    it('should return false for non-existent request', () => {
      expect(queue.approve('non_existent')).toBe(false);
    });

    it('should return false for already resolved request', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Test',
        description: 'Test',
        toolName: 'test',
        args: {},
      });

      queue.reject(id);
      expect(queue.approve(id)).toBe(false);
    });
  });

  describe('reject', () => {
    it('should reject a pending request', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Test',
        description: 'Test',
        toolName: 'test',
        args: {},
      });

      const result = queue.reject(id, 'dashboard', 'Not appropriate');
      expect(result).toBe(true);

      const request = queue.get(id)!;
      expect(request.status).toBe('rejected');
      expect(request.resolutionNote).toBe('Not appropriate');
    });
  });

  describe('cancel', () => {
    it('should cancel a pending request', () => {
      const id = queue.enqueue({
        type: 'send_message',
        title: 'Test',
        description: 'Test',
        toolName: 'test',
        args: {},
      });

      const result = queue.cancel(id, 'No longer needed');
      expect(result).toBe(true);

      const request = queue.get(id)!;
      expect(request.status).toBe('cancelled');
    });
  });

  describe('getAll', () => {
    it('should return all requests', () => {
      queue.enqueue({ type: 'send_message', title: 'A', description: '', toolName: 'test', args: {} });
      queue.enqueue({ type: 'send_message', title: 'B', description: '', toolName: 'test', args: {} });
      queue.enqueue({ type: 'create_order', title: 'C', description: '', toolName: 'test', args: {} });

      const all = queue.getAll();
      expect(all).toHaveLength(3);
    });

    it('should filter by status', () => {
      const id1 = queue.enqueue({ type: 'send_message', title: 'A', description: '', toolName: 'test', args: {} });
      queue.enqueue({ type: 'send_message', title: 'B', description: '', toolName: 'test', args: {} });
      queue.approve(id1);

      const pending = queue.getAll('pending');
      expect(pending).toHaveLength(1);

      const approved = queue.getAll('approved');
      expect(approved).toHaveLength(1);
    });
  });

  describe('getPending', () => {
    it('should return only pending requests', () => {
      queue.enqueue({ type: 'send_message', title: 'Pending', description: '', toolName: 'test', args: {} });
      const id2 = queue.enqueue({ type: 'send_message', title: 'Approved', description: '', toolName: 'test', args: {} });
      queue.approve(id2);

      const pending = queue.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Pending');
    });
  });

  describe('getResolvedForExecution', () => {
    it('should return approved request', () => {
      const id = queue.enqueue({ type: 'send_message', title: 'Test', description: '', toolName: 'test', args: {} });
      queue.approve(id);

      const resolved = queue.getResolvedForExecution(id);
      expect(resolved).not.toBeNull();
      expect(resolved!.status).toBe('approved');
    });

    it('should return null for rejected request', () => {
      const id = queue.enqueue({ type: 'send_message', title: 'Test', description: '', toolName: 'test', args: {} });
      queue.reject(id);

      expect(queue.getResolvedForExecution(id)).toBeNull();
    });

    it('should return null for non-existent request', () => {
      expect(queue.getResolvedForExecution('nope')).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct stats', () => {
      const id1 = queue.enqueue({ type: 'send_message', title: 'A', description: '', toolName: 'test', args: {} });
      const id2 = queue.enqueue({ type: 'send_message', title: 'B', description: '', toolName: 'test', args: {} });
      const id3 = queue.enqueue({ type: 'create_order', title: 'C', description: '', toolName: 'test', args: {} });

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

  describe('clearOld', () => {
    it('should clear old resolved requests', () => {
      const id = queue.enqueue({ type: 'send_message', title: 'Test', description: '', toolName: 'test', args: {} });
      queue.approve(id);

      // Should not clear recent requests
      expect(queue.clearOld(24)).toBe(0);
      expect(queue.get(id)).toBeDefined();
    });
  });

  describe('persistence', () => {
    it('should persist and reload requests', () => {
      const id = queue.enqueue({ type: 'send_message', title: 'Persist Test', description: '', toolName: 'test', args: {} });
      queue.destroy();

      // Create new queue instance and verify it loads
      const queue2 = new ApprovalQueue({ persistPath: TEST_PERSIST_PATH, defaultTimeoutMinutes: 60 });
      try {
        // Note: persistPath defaults might change, so ensure we use the same path
        // The original queue was already destroyed and saved
        const request = queue2.get(id);
        expect(request).toBeDefined();
        expect(request!.title).toBe('Persist Test');
        expect(request!.status).toBe('pending');
      } finally {
        queue2.destroy();
      }
    });
  });
});
