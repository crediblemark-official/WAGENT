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

import { ProactiveScheduler } from '../services/proactive-scheduler.js';
import type { ProactiveAction } from '../types.js';

function makeAction(overrides: Partial<ProactiveAction> = {}): ProactiveAction {
  return {
    id: `pro_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    trigger: {
      id: `trg_${Date.now()}`,
      type: 'time',
      schedule: '0 10 * * *',
      contactId: 'c1',
      contactName: 'Alice',
    },
    actionType: 'reminder',
    title: 'Test Reminder',
    description: 'A test reminder',
    prompt: 'Send reminder',
    priority: 0,
    requiresApproval: false,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProactiveScheduler', () => {
  let scheduler: ProactiveScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (existsSync as any).mockReturnValue(false);
    (readFileSync as any).mockReturnValue('[]');
    scheduler = new ProactiveScheduler({
      persistPath: '/tmp/test-proactive.json',
      checkIntervalMs: 60_000,
    });
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  // ── CRUD Operations ────────────────────────────────────────

  describe('CRUD operations', () => {
    it('addAction stores action', () => {
      const action = makeAction({ id: 'pro_1' });
      scheduler.addAction(action);
      expect(scheduler.getAction('pro_1')).toBe(action);
    });

    it('removeAction returns true when exists, false when not', () => {
      scheduler.addAction(makeAction({ id: 'pro_1' }));
      expect(scheduler.removeAction('pro_1')).toBe(true);
      expect(scheduler.getAction('pro_1')).toBeUndefined();
      expect(scheduler.removeAction('nonexistent')).toBe(false);
    });

    it('updateAction merges updates and sets updatedAt', () => {
      const action = makeAction({ id: 'pro_1', title: 'Old Title' });
      scheduler.addAction(action);
      const before = action.updatedAt;
      vi.advanceTimersByTime(1000);
      scheduler.updateAction('pro_1', { title: 'New Title' });
      expect(action.title).toBe('New Title');
      expect(action.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('getAction returns action or undefined', () => {
      scheduler.addAction(makeAction({ id: 'pro_1' }));
      expect(scheduler.getAction('pro_1')).toBeDefined();
      expect(scheduler.getAction('nonexistent')).toBeUndefined();
    });

    it('getEnabledActions filters to enabled only', () => {
      scheduler.addAction(makeAction({ id: 'pro_1', enabled: true }));
      scheduler.addAction(makeAction({ id: 'pro_2', enabled: false }));
      scheduler.addAction(makeAction({ id: 'pro_3', enabled: true }));
      const enabled = scheduler.getEnabledActions();
      expect(enabled).toHaveLength(2);
      expect(enabled.map(a => a.id).sort()).toEqual(['pro_1', 'pro_3']);
    });
  });

  // ── Factory Methods ────────────────────────────────────────

  describe('factory methods', () => {
    it('createReminder generates correct action structure', () => {
      const action = scheduler.createReminder({
        contactId: 'c1',
        contactName: 'Bob',
        title: 'Check-in',
        prompt: 'Say hello',
        schedule: '0 9 * * 1',
      });
      expect(action.id).toMatch(/^pro_/);
      expect(action.actionType).toBe('reminder');
      expect(action.trigger.type).toBe('time');
      expect(action.trigger.schedule).toBe('0 9 * * 1');
      expect(action.trigger.contactId).toBe('c1');
      expect(action.trigger.contactName).toBe('Bob');
      expect(action.title).toBe('Check-in');
      expect(action.enabled).toBe(true);
      expect(scheduler.getAction(action.id)).toBeDefined();
    });

    it('createReminder sets requiresApproval to true by default', () => {
      const action = scheduler.createReminder({
        contactId: 'c1',
        contactName: 'Bob',
        title: 'Check-in',
        prompt: 'Say hello',
        schedule: '0 9 * * *',
      });
      expect(action.requiresApproval).toBe(true);
    });

    it('createFollowUp generates correct structure with cooldown', () => {
      const action = scheduler.createFollowUp({
        contactId: 'c2',
        contactName: 'Carol',
        title: 'Re-engage',
        prompt: 'Follow up',
        daysInactive: 7,
      });
      expect(action.actionType).toBe('follow_up');
      expect(action.trigger.type).toBe('pattern');
      expect(action.trigger.condition).toBe('7 days no reply');
      expect(action.cooldownMinutes).toBe(7 * 24 * 60);
      expect(action.priority).toBe(1);
    });

    it('createFollowUp calculates cooldownMinutes from daysInactive', () => {
      const action = scheduler.createFollowUp({
        contactId: 'c3',
        contactName: 'Dan',
        title: 'Nudge',
        prompt: 'Send nudge',
        daysInactive: 3,
      });
      expect(action.cooldownMinutes).toBe(3 * 24 * 60);
    });
  });

  // ── Cron Matching (via checkActions with time triggers) ─────

  describe('cron matching', () => {
    it('matches * for minute and hour', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron1',
        trigger: { id: 'trg1', type: 'time', schedule: '* * * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T14:37:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron1')).toBe(true);
    });

    it('matches */N for every N minutes/hours', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron2',
        trigger: { id: 'trg2', type: 'time', schedule: '*/15 * * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T10:30:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron2')).toBe(true);
    });

    it('does not match */N when not aligned', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron2b',
        trigger: { id: 'trg2b', type: 'time', schedule: '*/15 * * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T10:37:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron2b')).toBe(false);
    });

    it('matches exact N value', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron3',
        trigger: { id: 'trg3', type: 'time', schedule: '45 14 * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T14:45:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron3')).toBe(true);
    });

    it('does not match exact N when wrong minute', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron3b',
        trigger: { id: 'trg3b', type: 'time', schedule: '45 14 * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T14:46:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron3b')).toBe(false);
    });
  });

  // ── Day-of-week cron forcing minute 0 ─────────────────────

  describe('day-of-week cron', () => {
    it('forces minute 0 when day-of-week is not *', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron4',
        trigger: { id: 'trg4', type: 'time', schedule: '0 10 * * 1' },
      }));
      vi.setSystemTime(new Date('2025-01-13T10:00:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron4')).toBe(true);
    });

    it('does not trigger at non-zero minute when day-of-week is set', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cron4b',
        trigger: { id: 'trg4b', type: 'time', schedule: '0 10 * * 1' },
      }));
      vi.setSystemTime(new Date('2025-01-13T10:01:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cron4b')).toBe(false);
    });
  });

  // ── Time Triggers ──────────────────────────────────────────

  describe('time triggers', () => {
    it('triggers at correct time with "every N days at HH:mm"', () => {
      scheduler.addAction(makeAction({
        id: 'pro_every1',
        trigger: { id: 'trg_e1', type: 'time', schedule: 'every 3 days at 10:00' },
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_every1')).toBe(true);
    });

    it('respects windowStart/windowEnd hours', () => {
      scheduler.addAction(makeAction({
        id: 'pro_win1',
        trigger: { id: 'trg_w1', type: 'time', schedule: '0 10 * * *' },
        windowStart: '09:00',
        windowEnd: '11:00',
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_win1')).toBe(true);
    });

    it('does not trigger outside window', () => {
      scheduler.addAction(makeAction({
        id: 'pro_win2',
        trigger: { id: 'trg_w2', type: 'time', schedule: '0 10 * * *' },
        windowStart: '11:00',
        windowEnd: '12:00',
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_win2')).toBe(false);
    });

    it('does not trigger before interval elapsed', () => {
      scheduler.addAction(makeAction({
        id: 'pro_int1',
        trigger: { id: 'trg_i1', type: 'time', schedule: 'every 5 days at 10:00' },
        lastTriggeredAt: new Date('2025-01-13T10:00:00'),
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_int1')).toBe(false);
    });

    it('triggers after interval elapsed', () => {
      scheduler.addAction(makeAction({
        id: 'pro_int2',
        trigger: { id: 'trg_i2', type: 'time', schedule: 'every 3 days at 10:00' },
        lastTriggeredAt: new Date('2025-01-11T10:00:00'),
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_int2')).toBe(true);
    });
  });

  // ── Event Triggers ─────────────────────────────────────────

  describe('event triggers', () => {
    it('triggers when matching event registered', () => {
      scheduler.addAction(makeAction({
        id: 'pro_evt1',
        trigger: { id: 'trg_ev1', type: 'event', event: 'new_message' },
      }));
      scheduler.registerEvent('new_message');
      const matched = scheduler.checkEventTrigger('new_message');
      expect(matched.some(a => a.id === 'pro_evt1')).toBe(true);
    });

    it('consumes event after trigger via checkActions', () => {
      scheduler.addAction(makeAction({
        id: 'pro_evt2',
        trigger: { id: 'trg_ev2', type: 'event', event: 'order_created' },
      }));
      scheduler.registerEvent('order_created');
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_evt2')).toBe(true);

      const triggered2 = scheduler.checkActions();
      expect(triggered2.some(a => a.id === 'pro_evt2')).toBe(false);
    });

    it('does not trigger for unregistered events', () => {
      scheduler.addAction(makeAction({
        id: 'pro_evt3',
        trigger: { id: 'trg_ev3', type: 'event', event: 'payment_received' },
      }));
      scheduler.registerEvent('new_message');
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_evt3')).toBe(false);
    });

    it('does not trigger if lastTriggeredAt is newer than event', () => {
      scheduler.addAction(makeAction({
        id: 'pro_evt4',
        trigger: { id: 'trg_ev4', type: 'event', event: 'new_message' },
      }));
      vi.setSystemTime(new Date('2025-01-15T12:00:00'));
      scheduler.registerEvent('new_message');
      scheduler.updateAction('pro_evt4', { lastTriggeredAt: new Date('2025-01-15T12:00:01') });
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_evt4')).toBe(false);
    });
  });

  // ── Pattern Triggers ───────────────────────────────────────

  describe('pattern triggers', () => {
    it('triggers when condition met (days no reply)', () => {
      scheduler.addAction(makeAction({
        id: 'pro_pat1',
        trigger: {
          id: 'trg_p1',
          type: 'pattern',
          condition: '3 days no reply',
          contactId: 'c1',
          contactName: 'Alice',
        },
      }));
      const matched = scheduler.checkPatternTrigger({
        contactId: 'c1',
        daysSinceLastMessage: 5,
      });
      expect(matched.some(a => a.id === 'pro_pat1')).toBe(true);
    });

    it('does not trigger when condition not met', () => {
      scheduler.addAction(makeAction({
        id: 'pro_pat2',
        trigger: {
          id: 'trg_p2',
          type: 'pattern',
          condition: '7 days no reply',
          contactId: 'c1',
          contactName: 'Alice',
        },
      }));
      const matched = scheduler.checkPatternTrigger({
        contactId: 'c1',
        daysSinceLastMessage: 2,
      });
      expect(matched).toHaveLength(0);
    });

    it('handles missing DB gracefully', () => {
      const schedNoDb = new ProactiveScheduler({
        persistPath: '/tmp/test-proactive-nodb.json',
        checkIntervalMs: 60_000,
      });
      schedNoDb.addAction(makeAction({
        id: 'pro_pat3',
        trigger: {
          id: 'trg_p3',
          type: 'pattern',
          condition: '3 days no reply',
          contactId: 'c1',
          contactName: 'Alice',
        },
      }));
      (schedNoDb as any).running = true;
      (schedNoDb as any).timer = null;
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      const triggered = schedNoDb.checkActions();
      expect(triggered).toHaveLength(0);
      schedNoDb.stop();
    });
  });

  // ── Cooldown ───────────────────────────────────────────────

  describe('cooldown', () => {
    it('blocks trigger within cooldown window', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cd1',
        trigger: { id: 'trg_cd1', type: 'time', schedule: '0 10 * * *' },
        cooldownMinutes: 60,
        lastTriggeredAt: new Date('2025-01-15T09:30:00'),
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cd1')).toBe(false);
    });

    it('allows trigger after cooldown expires', () => {
      scheduler.addAction(makeAction({
        id: 'pro_cd2',
        trigger: { id: 'trg_cd2', type: 'time', schedule: '0 10 * * *' },
        cooldownMinutes: 60,
        lastTriggeredAt: new Date('2025-01-15T08:59:00'),
      }));
      vi.setSystemTime(new Date('2025-01-15T10:00:00'));
      (scheduler as any).running = true;
      (scheduler as any).timer = null;
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_cd2')).toBe(true);
    });
  });

  // ── checkActions ───────────────────────────────────────────

  describe('checkActions', () => {
    it('returns empty when not running', () => {
      scheduler.addAction(makeAction({ id: 'pro_chk1' }));
      const triggered = scheduler.checkActions();
      expect(triggered).toHaveLength(0);
    });

    it('returns triggered actions', () => {
      scheduler.addAction(makeAction({
        id: 'pro_chk2',
        trigger: { id: 'trg_ck2', type: 'time', schedule: '* * * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T12:00:00'));
      scheduler.start();
      const triggered = scheduler.checkActions();
      expect(triggered.some(a => a.id === 'pro_chk2')).toBe(true);
    });

    it('sets lastTriggeredAt on triggered actions', () => {
      scheduler.addAction(makeAction({
        id: 'pro_chk3',
        trigger: { id: 'trg_ck3', type: 'time', schedule: '* * * * *' },
      }));
      vi.setSystemTime(new Date('2025-01-15T12:00:00'));
      scheduler.start();
      scheduler.checkActions();
      const action = scheduler.getAction('pro_chk3')!;
      expect(action.lastTriggeredAt).toBeDefined();
      expect(action.lastTriggeredAt!.getTime()).toBe(Date.now());
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────

  describe('lifecycle', () => {
    it('start/stop manages interval', () => {
      scheduler.start();
      expect((scheduler as any).running).toBe(true);
      expect((scheduler as any).timer).not.toBeNull();
      scheduler.stop();
      expect((scheduler as any).running).toBe(false);
      expect((scheduler as any).timer).toBeNull();
    });

    it('start is idempotent', () => {
      scheduler.start();
      const timer1 = (scheduler as any).timer;
      scheduler.start();
      const timer2 = (scheduler as any).timer;
      expect(timer1).toBe(timer2);
    });
  });

  // ── Approval Queue & Callback ──────────────────────────────

  describe('approval queue', () => {
    it('enqueues to approvalQueue when requiresApproval', () => {
      const mockEnqueue = vi.fn().mockReturnValue('apr_1');
      const aqScheduler = new ProactiveScheduler({
        persistPath: '/tmp/test-proactive-aq.json',
        checkIntervalMs: 60_000,
        approvalQueue: { enqueue: mockEnqueue } as any,
      });
      aqScheduler.addAction(makeAction({
        id: 'pro_aq1',
        trigger: { id: 'trg_aq1', type: 'time', schedule: '* * * * *', contactId: 'c1', contactName: 'Alice' },
        requiresApproval: true,
        title: 'Approve Me',
        description: 'Needs approval',
        prompt: 'Do this',
      }));
      vi.setSystemTime(new Date('2025-01-15T12:00:00'));
      aqScheduler.start();
      aqScheduler.checkActions();
      expect(mockEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'proactive_action',
          title: 'Approve Me',
        })
      );
      aqScheduler.stop();
    });

    it('calls onActionTrigger callback when no approval needed', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      const cbScheduler = new ProactiveScheduler({
        persistPath: '/tmp/test-proactive-cb.json',
        checkIntervalMs: 60_000,
        onActionTrigger: callback,
      });
      cbScheduler.addAction(makeAction({
        id: 'pro_cb1',
        trigger: { id: 'trg_cb1', type: 'time', schedule: '* * * * *' },
        requiresApproval: false,
      }));
      vi.setSystemTime(new Date('2025-01-15T12:00:00'));
      cbScheduler.start();
      cbScheduler.stop();
      await vi.runAllTimersAsync();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pro_cb1' })
      );
    });
  });
});
