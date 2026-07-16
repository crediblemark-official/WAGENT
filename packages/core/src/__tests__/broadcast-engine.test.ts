import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BroadcastEngine } from '../services/broadcast-engine.js';

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

const mockContacts = [
  { id: 'c-1', name: 'Alice', tags: '["vip"]' },
  { id: 'c-2', name: 'Bob', tags: '["lead"]' },
  { id: 'c-3', name: 'Carol', tags: '["vip","lead"]' },
];

function createMocks() {
  return {
    db: {
      getAllContacts: vi.fn().mockReturnValue(mockContacts),
      createBroadcast: vi.fn(),
      updateBroadcastStatus: vi.fn(),
    },
    whatsapp: {
      sendMessage: vi.fn().mockResolvedValue({ id: 'sent-1' }),
    },
    eventBus: {
      emit: vi.fn(),
    },
  };
}

describe('BroadcastEngine', () => {
  let engine: BroadcastEngine;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks = createMocks();
    engine = new BroadcastEngine(mocks.db as any, mocks.whatsapp as any, mocks.eventBus as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('startBroadcast', () => {
    it('creates a broadcast job and returns an ID matching expected pattern', async () => {
      const id = await engine.startBroadcast('Hello');
      expect(id).toMatch(/^bc-\d+-[a-z0-9]+$/);
      expect(mocks.db.createBroadcast).toHaveBeenCalledOnce();
      expect(mocks.db.createBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Hello',
          status: 'sending',
          totalContacts: 3,
          sentCount: 0,
          failedCount: 0,
        })
      );
    });

    it('sends messages to all contacts by default', async () => {
      await engine.startBroadcast('Hello {{name}}');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(3);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-1', 'Hello Alice');
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-2', 'Hello Bob');
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-3', 'Hello Carol');
    });

    it('throws when no contacts match the filter', async () => {
      mocks.db.getAllContacts.mockReturnValue([]);
      await expect(engine.startBroadcast('Hello')).rejects.toThrow(
        'No contacts matched the target filter'
      );
    });

    it('uses the provided delay between messages', async () => {
      await engine.startBroadcast('Hi', { delayMs: 500 });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('filters contacts by tag', async () => {
      await engine.startBroadcast('Hi', {
        targetFilter: { tags: ['vip'] },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(2);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-1', 'Hi');
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-3', 'Hi');
    });

    it('filters contacts by contactIds', async () => {
      await engine.startBroadcast('Hi', {
        targetFilter: { contactIds: ['c-2'] },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-2', 'Hi');
    });

    it('emits broadcast:progress after each message', async () => {
      await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      const progressCalls = mocks.eventBus.emit.mock.calls.filter(
        (c: any[]) => c[0].type === 'broadcast:progress'
      );
      expect(progressCalls).toHaveLength(3);
      expect(progressCalls[0][0]).toEqual(
        expect.objectContaining({ type: 'broadcast:progress', sent: 1, failed: 0, total: 3 })
      );
      expect(progressCalls[2][0]).toEqual(
        expect.objectContaining({ type: 'broadcast:progress', sent: 3, failed: 0, total: 3 })
      );
    });

    it('personalizes messages with {{contact}} placeholder', async () => {
      await engine.startBroadcast('Hello {{contact}}!');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-1', 'Hello Alice!');
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-2', 'Hello Bob!');
    });
  });

  describe('pauseBroadcast', () => {
    it('pauses a running broadcast', async () => {
      const id = await engine.startBroadcast('Hi');
      const result = engine.pauseBroadcast(id);
      expect(result).toBe(true);
      expect(mocks.db.updateBroadcastStatus).toHaveBeenCalledWith(id, 'paused');
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'broadcast:paused', id })
      );
    });

    it('returns false when broadcast ID is unknown', () => {
      expect(engine.pauseBroadcast('unknown')).toBe(false);
    });

    it('stops sending remaining messages', async () => {
      mocks.whatsapp.sendMessage.mockImplementation(() =>
        new Promise((resolve) => setTimeout(resolve, 100))
      );
      const id = await engine.startBroadcast('Hi', { delayMs: 0 });
      await vi.advanceTimersByTimeAsync(50);
      engine.pauseBroadcast(id);
      await vi.advanceTimersByTimeAsync(5000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('returns false for a completed broadcast', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(engine.pauseBroadcast(id)).toBe(false);
    });
  });

  describe('resumeBroadcast', () => {
    it('resumes a paused broadcast', async () => {
      mocks.whatsapp.sendMessage.mockImplementation(() =>
        new Promise((resolve) => setTimeout(resolve, 100))
      );
      const id = await engine.startBroadcast('Hi', { delayMs: 0 });
      await vi.advanceTimersByTimeAsync(100);
      engine.pauseBroadcast(id);
      const result = await engine.resumeBroadcast(id);
      expect(result).toBe(true);
      expect(mocks.db.updateBroadcastStatus).toHaveBeenCalledWith(id, 'sending');
    });

    it('returns false for a non-paused broadcast', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await engine.resumeBroadcast(id)).toBe(false);
    });

    it('returns false for unknown ID', async () => {
      expect(await engine.resumeBroadcast('unknown')).toBe(false);
    });

    it('resumes sends remaining contacts after pause', async () => {
      mocks.whatsapp.sendMessage.mockImplementation(() =>
        new Promise((resolve) => setTimeout(() => resolve({ id: 'sent' }), 200))
      );

      const id = await engine.startBroadcast('Hi', { delayMs: 0 });
      await vi.advanceTimersByTimeAsync(200);
      engine.pauseBroadcast(id);

      mocks.whatsapp.sendMessage.mockClear();
      mocks.whatsapp.sendMessage.mockResolvedValue({ id: 'sent' });

      const resumed = await engine.resumeBroadcast(id);
      expect(resumed).toBe(true);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalled();
      expect(mocks.db.updateBroadcastStatus).toHaveBeenCalledWith(id, 'sending');
    });
  });

  describe('getBroadcastStatus', () => {
    it('returns the broadcast job', async () => {
      const id = await engine.startBroadcast('Hi');
      const job = engine.getBroadcastStatus(id);
      expect(job).toBeDefined();
      expect(job!.id).toBe(id);
      expect(job!.status).toBe('running');
    });

    it('returns undefined for unknown ID', () => {
      expect(engine.getBroadcastStatus('unknown')).toBeUndefined();
    });

    it('reflects paused status', async () => {
      const id = await engine.startBroadcast('Hi');
      engine.pauseBroadcast(id);
      expect(engine.getBroadcastStatus(id)!.status).toBe('paused');
    });
  });

  describe('getActiveBroadcasts', () => {
    it('returns all broadcast jobs', async () => {
      const id1 = await engine.startBroadcast('First');
      const id2 = await engine.startBroadcast('Second');
      expect(id1).not.toBe(id2);
      const all = engine.getActiveBroadcasts();
      expect(all).toHaveLength(2);
      expect(all.map((j) => j.id)).toContain(id1);
      expect(all.map((j) => j.id)).toContain(id2);
    });

    it('returns empty array when no broadcasts exist', () => {
      expect(engine.getActiveBroadcasts()).toHaveLength(0);
    });
  });

  describe('progress tracking', () => {
    it('updates sentCount on successful send', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      const job = engine.getBroadcastStatus(id);
      expect(job!.sentCount).toBe(3);
      expect(job!.failedCount).toBe(0);
    });

    it('increments failedCount on send failure', async () => {
      mocks.whatsapp.sendMessage
        .mockResolvedValueOnce({ id: 'sent-1' })
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ id: 'sent-3' });

      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      const job = engine.getBroadcastStatus(id);
      expect(job!.sentCount).toBe(2);
      expect(job!.failedCount).toBe(1);
    });

    it('updates DB with sent and failed counts', async () => {
      mocks.whatsapp.sendMessage
        .mockResolvedValueOnce({ id: 'sent-1' })
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ id: 'sent-3' });

      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      const updateCalls = mocks.db.updateBroadcastStatus.mock.calls.filter(
        (c: any[]) => c[0] === id
      );
      expect(updateCalls.length).toBeGreaterThan(0);
      const lastUpdate = updateCalls[updateCalls.length - 1];
      expect(lastUpdate[2]).toBe(2);
      expect(lastUpdate[3]).toBe(1);
    });

    it('totalContacts matches target count', async () => {
      mocks.db.getAllContacts.mockReturnValue([{ id: 'c-1', name: 'A' }]);
      const id = await engine.startBroadcast('Hi');
      const job = engine.getBroadcastStatus(id);
      expect(job!.totalContacts).toBe(1);
    });
  });

  describe('completion handling', () => {
    it('marks broadcast as completed after all messages', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      const job = engine.getBroadcastStatus(id);
      expect(job!.status).toBe('completed');
    });

    it('emits broadcast:completed with final counts', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast:completed',
          id,
          sent: 3,
          failed: 0,
          total: 3,
        })
      );
    });

    it('updates DB with final completed status', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.db.updateBroadcastStatus).toHaveBeenCalledWith(id, 'completed', 3, 0);
    });

    it('handles broadcast with all failures', async () => {
      mocks.whatsapp.sendMessage.mockRejectedValue(new Error('fail'));
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      const job = engine.getBroadcastStatus(id);
      expect(job!.status).toBe('completed');
      expect(job!.sentCount).toBe(0);
      expect(job!.failedCount).toBe(3);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'broadcast:completed',
          sent: 0,
          failed: 3,
        })
      );
    });
  });

  describe('rate limiting', () => {
    it('delays between messages using default delay', async () => {
      const id = await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1999);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('respects custom delay', async () => {
      await engine.startBroadcast('Hi', { delayMs: 100 });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(99);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('target filtering', () => {
    it('defaults to all contacts when no filter is provided', async () => {
      await engine.startBroadcast('Hi');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('uses all contacts when filter.all is true', async () => {
      await engine.startBroadcast('Hi', { targetFilter: { all: true } });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('filters by multiple tags', async () => {
      await engine.startBroadcast('Hi', {
        targetFilter: { tags: ['vip', 'lead'] },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(3);
    });

    it('filters by specific contact IDs', async () => {
      await engine.startBroadcast('Hi', {
        targetFilter: { contactIds: ['c-1', 'c-3'] },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledTimes(2);
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-1', 'Hi');
      expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-3', 'Hi');
    });
  });
});
