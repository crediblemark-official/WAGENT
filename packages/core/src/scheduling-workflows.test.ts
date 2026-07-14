import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchedulingWorkflows } from './scheduling-workflows.js';
import { EventBus } from './event-bus.js';
import { Database } from './storage.js';

function createMockDb(): Database {
  return {
    getContact: vi.fn().mockReturnValue({ id: '1@s.whatsapp.net', name: 'Budi' }),
    getConversationHistory: vi.fn().mockReturnValue([]),
  } as unknown as Database;
}

describe('SchedulingWorkflows', () => {
  let workflows: SchedulingWorkflows;
  let db: Database;
  let eventBus: EventBus;

  beforeEach(() => {
    db = createMockDb();
    eventBus = new EventBus();
    workflows = new SchedulingWorkflows(db, eventBus);
  });

  describe('createSequence', () => {
    it('creates a follow-up sequence', () => {
      const seq = workflows.createSequence({
        name: 'Post-purchase follow-up',
        steps: [
          { delayHours: 24, message: 'Hai {{name}}, pesananmu sudah sampai?' },
          { delayHours: 72, message: 'Gimana kabar pesananmu, {{name}}?' },
        ],
        trigger: { type: 'order-created' },
      });

      expect(seq.id).toMatch(/^seq-/);
      expect(seq.name).toBe('Post-purchase follow-up');
      expect(seq.steps).toHaveLength(2);
    });

    it('lists all sequences', () => {
      workflows.createSequence({
        name: 'Seq 1',
        steps: [{ delayHours: 1, message: 'test' }],
        trigger: { type: 'manual' },
      });
      workflows.createSequence({
        name: 'Seq 2',
        steps: [{ delayHours: 1, message: 'test' }],
        trigger: { type: 'manual' },
      });

      expect(workflows.listSequences()).toHaveLength(2);
    });
  });

  describe('startSequence', () => {
    it('starts a sequence for a contact', () => {
      const seq = workflows.createSequence({
        name: 'Test',
        steps: [{ delayHours: 1, message: 'Hello {{name}}' }],
        trigger: { type: 'manual' },
      });

      const runId = workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi');
      expect(runId).toMatch(/^run-/);
    });

    it('returns null for invalid sequence', () => {
      const runId = workflows.startSequence('invalid', '1@s.whatsapp.net', 'Budi');
      expect(runId).toBeNull();
    });

    it('respects max runs per contact', () => {
      const seq = workflows.createSequence({
        name: 'Limited',
        steps: [{ delayHours: 1, message: 'test' }],
        trigger: { type: 'manual' },
        maxRunsPerContact: 2,
      });

      workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi');
      workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi');
      const third = workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi');

      expect(third).toBeNull();
    });
  });

  describe('cancelRun', () => {
    it('cancels an active run', () => {
      const seq = workflows.createSequence({
        name: 'Test',
        steps: [{ delayHours: 1, message: 'test' }],
        trigger: { type: 'manual' },
      });

      const runId = workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi')!;
      expect(workflows.cancelRun(runId)).toBe(true);
    });

    it('returns false for invalid run', () => {
      expect(workflows.cancelRun('invalid')).toBe(false);
    });
  });

  describe('getActiveRunsForContact', () => {
    it('returns active runs for a contact', () => {
      const seq = workflows.createSequence({
        name: 'Test',
        steps: [{ delayHours: 1, message: 'test' }],
        trigger: { type: 'manual' },
      });

      workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi');
      workflows.startSequence(seq.id, '2@s.whatsapp.net', 'Andi');

      const runs = workflows.getActiveRunsForContact('1@s.whatsapp.net');
      expect(runs).toHaveLength(1);
      expect(runs[0].contactId).toBe('1@s.whatsapp.net');
    });
  });

  describe('deleteSequence', () => {
    it('deletes a sequence and cancels runs', () => {
      const seq = workflows.createSequence({
        name: 'Test',
        steps: [{ delayHours: 1, message: 'test' }],
        trigger: { type: 'manual' },
      });

      workflows.startSequence(seq.id, '1@s.whatsapp.net', 'Budi');
      expect(workflows.deleteSequence(seq.id)).toBe(true);
      expect(workflows.getSequence(seq.id)).toBeUndefined();
      expect(workflows.getActiveRunsForContact('1@s.whatsapp.net')).toHaveLength(0);
    });
  });
});
