import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    }),
  }),
}));

const mockExistsSync = vi.fn().mockReturnValue(false);
const mockReadFileSync = vi.fn().mockReturnValue('{}');
const mockWriteFileSync = vi.fn();
const mockMkdirSync = vi.fn();

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  readFileSync: (...args: any[]) => mockReadFileSync(...args),
  writeFileSync: (...args: any[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

import { SchedulingWorkflows } from '../services/scheduling-workflows.js';

function createMocks() {
  return {
    db: {
      getContact: vi.fn().mockReturnValue({ name: 'Alice', tags: ['vip'] }),
      getMessages: vi.fn().mockReturnValue([{ timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000) }]),
    },
    eventBus: {
      emit: vi.fn(),
    },
  };
}

function makeSequence(overrides: Record<string, any> = {}) {
  return {
    name: 'Test Sequence',
    steps: [
      { delayHours: 1, message: 'Hi {{name}}, following up!' },
      { delayHours: 24, message: 'Second follow-up for {{contact}}' },
    ],
    trigger: { type: 'manual' as const },
    ...overrides,
  };
}

describe('SchedulingWorkflows', () => {
  let sw: SchedulingWorkflows;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks = createMocks();
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue('{}');
    mockWriteFileSync.mockClear();
    mockMkdirSync.mockClear();
    sw = new SchedulingWorkflows(
      mocks.db as any,
      mocks.eventBus as any,
      '/tmp/test-scheduling.json',
    );
    mockWriteFileSync.mockClear();
  });

  afterEach(() => {
    sw.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Sequence CRUD ──────────────────────────────────────────────

  describe('Sequence CRUD', () => {
    it('createSequence generates ID and stores', () => {
      const seq = sw.createSequence(makeSequence());
      expect(seq.id).toMatch(/^seq-/);
      expect(seq.name).toBe('Test Sequence');
      expect(seq.steps).toHaveLength(2);
      expect(seq.createdAt).toBeInstanceOf(Date);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('getSequence returns sequence or undefined', () => {
      const seq = sw.createSequence(makeSequence());
      expect(sw.getSequence(seq.id)).toEqual(seq);
      expect(sw.getSequence('non-existent')).toBeUndefined();
    });

    it('listSequences returns all', () => {
      expect(sw.listSequences()).toHaveLength(0);
      sw.createSequence(makeSequence({ name: 'First' }));
      sw.createSequence(makeSequence({ name: 'Second' }));
      const all = sw.listSequences();
      expect(all).toHaveLength(2);
      expect(all.map((s) => s.name)).toEqual(expect.arrayContaining(['First', 'Second']));
    });

    it('deleteSequence removes sequence and cancels active runs', () => {
      const seq = sw.createSequence(makeSequence());
      sw.startSequence(seq.id, 'c-1', 'Bob');
      expect(sw.listSequences()).toHaveLength(1);
      expect(sw.getActiveRunsForContact('c-1')).toHaveLength(1);

      const deleted = sw.deleteSequence(seq.id);
      expect(deleted).toBe(true);
      expect(sw.listSequences()).toHaveLength(0);
      expect(sw.getActiveRunsForContact('c-1')).toHaveLength(0);
    });

    it('deleteSequence returns false for non-existent', () => {
      expect(sw.deleteSequence('nope')).toBe(false);
    });
  });

  // ── Starting runs ──────────────────────────────────────────────

  describe('Starting runs', () => {
    it('startSequence creates a run with first step scheduled', () => {
      const seq = sw.createSequence(makeSequence());
      const runId = sw.startSequence(seq.id, 'c-1', 'Bob');
      expect(runId).toMatch(/^run-/);
      const runs = sw.getActiveRunsForContact('c-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].currentStep).toBe(0);
      expect(runs[0].status).toBe('pending');
      const delayMs = 1 * 60 * 60 * 1000;
      expect(runs[0].nextRunAt.getTime()).toBeGreaterThanOrEqual(Date.now() + delayMs - 1000);
      expect(runs[0].nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + delayMs + 1000);
    });

    it('startSequence returns null if sequence not found', () => {
      expect(sw.startSequence('fake-id', 'c-1', 'Bob')).toBeNull();
    });

    it('startSequence returns null if maxRunsPerContact reached', () => {
      const seq = sw.createSequence(makeSequence({ maxRunsPerContact: 2 }));
      sw.startSequence(seq.id, 'c-1', 'Bob');
      sw.startSequence(seq.id, 'c-1', 'Bob');
      expect(sw.startSequence(seq.id, 'c-1', 'Bob')).toBeNull();
    });

    it('startSequence returns null if sequence has no steps', () => {
      const seq = sw.createSequence(makeSequence({ steps: [] }));
      expect(sw.startSequence(seq.id, 'c-1', 'Bob')).toBeNull();
    });

    it('startSequence emits save (writeFileSync called)', () => {
      const seq = sw.createSequence(makeSequence());
      mockWriteFileSync.mockClear();
      sw.startSequence(seq.id, 'c-1', 'Bob');
      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });

  // ── Cancelling runs ────────────────────────────────────────────

  describe('Cancelling runs', () => {
    it('cancelRun sets status to cancelled and removes from active', () => {
      const seq = sw.createSequence(makeSequence());
      const runId = sw.startSequence(seq.id, 'c-1', 'Bob')!;
      const result = sw.cancelRun(runId);
      expect(result).toBe(true);
      expect(sw.getActiveRunsForContact('c-1')).toHaveLength(0);
    });

    it('cancelRun returns false for non-existent run', () => {
      expect(sw.cancelRun('nope')).toBe(false);
    });
  });

  // ── Active runs ────────────────────────────────────────────────

  describe('Active runs', () => {
    it('getActiveRunsForContact returns pending/running runs', () => {
      const seq = sw.createSequence(makeSequence());
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.startSequence(seq.id, 'c-1', 'Alice');
      const runs = sw.getActiveRunsForContact('c-1');
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.status === 'pending')).toBe(true);
    });

    it('getActiveRunsForContact excludes cancelled runs', () => {
      const seq = sw.createSequence(makeSequence());
      const runId = sw.startSequence(seq.id, 'c-1', 'Alice')!;
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.cancelRun(runId);
      expect(sw.getActiveRunsForContact('c-1')).toHaveLength(1);
    });
  });

  // ── Condition checking ─────────────────────────────────────────

  describe('Condition checking', () => {
    it('noReplyAfterHours: returns true when no reply within hours', async () => {
      mocks.db.getMessages.mockReturnValue([
        { timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      ]);
      const seq = sw.createSequence(
        makeSequence({
          steps: [
            { delayHours: 0, message: 'Follow up', condition: { noReplyAfterHours: 2 } },
          ],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'workflow:send' }),
      );
    });

    it('noReplyAfterHours: returns false when recent reply', async () => {
      mocks.db.getMessages.mockReturnValue([
        { timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000) },
      ]);
      const seq = sw.createSequence(
        makeSequence({
          steps: [
            { delayHours: 0, message: 'Follow up', condition: { noReplyAfterHours: 2 } },
            { delayHours: 24, message: 'Later' },
          ],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });

    it('tag: returns true when tag present', async () => {
      mocks.db.getContact.mockReturnValue({ name: 'Alice', tags: ['vip', 'premium'] });
      const seq = sw.createSequence(
        makeSequence({
          steps: [
            { delayHours: 0, message: 'VIP message', condition: { tag: 'vip' } },
          ],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'workflow:send' }),
      );
    });

    it('tag: returns false when tag absent', async () => {
      mocks.db.getContact.mockReturnValue({ name: 'Alice', tags: ['regular'] });
      const seq = sw.createSequence(
        makeSequence({
          steps: [
            { delayHours: 0, message: 'VIP message', condition: { tag: 'vip' } },
            { delayHours: 24, message: 'Later' },
          ],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });
  });

  // ── Message templating ─────────────────────────────────────────

  describe('Message templating', () => {
    it('replaces {{name}} with contact name', async () => {
      const seq = sw.createSequence(
        makeSequence({
          steps: [{ delayHours: 0, message: 'Hello {{name}}' }],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Hello Alice' }),
      );
    });

    it('replaces {{contact}} with contact name', async () => {
      const seq = sw.createSequence(
        makeSequence({
          steps: [{ delayHours: 0, message: 'Hi {{contact}}, welcome' }],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Hi Alice, welcome' }),
      );
    });
  });

  // ── Step advancement ───────────────────────────────────────────

  describe('Step advancement', () => {
    it('moveToNextStep advances to next step', async () => {
      const seq = sw.createSequence(
        makeSequence({
          steps: [
            { delayHours: 0, message: 'First' },
            { delayHours: 24, message: 'Second' },
          ],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      const runs = sw.getActiveRunsForContact('c-1');
      expect(runs).toHaveLength(1);
      expect(runs[0].currentStep).toBe(1);
      expect(runs[0].status).toBe('pending');
    });

    it('moveToNextStep marks completed when all steps done', async () => {
      const seq = sw.createSequence(
        makeSequence({
          steps: [{ delayHours: 0, message: 'Only step' }],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(sw.getActiveRunsForContact('c-1')).toHaveLength(0);
    });

    it('checkRuns sends messages for due runs', async () => {
      const seq = sw.createSequence(
        makeSequence({
          steps: [{ delayHours: 0, message: 'Hello {{name}}' }],
        }),
      );
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(mocks.eventBus.emit).toHaveBeenCalledTimes(1);
      expect(mocks.eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'workflow:send',
          contactId: 'c-1',
        }),
      );
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────

  describe('Lifecycle', () => {
    it('start/stop manages interval', () => {
      sw.start();
      sw.stop();
      expect(() => sw.stop()).not.toThrow();
    });

    it('checkRuns returns empty when not running', async () => {
      const seq = sw.createSequence(makeSequence({ steps: [{ delayHours: 0, message: 'Hi' }] }));
      sw.startSequence(seq.id, 'c-1', 'Alice');
      sw.stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(mocks.eventBus.emit).not.toHaveBeenCalled();
    });
  });
});
