import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { CSATTracker } from '../services/csat-tracker.js';

function createTracker() {
  const db = {} as any;
  const eventBus = { emit: vi.fn() } as any;
  return { tracker: new CSATTracker(db, eventBus), eventBus };
}

describe('CSATTracker', () => {
  let tracker: CSATTracker;
  let eventBus: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ({ tracker, eventBus } = createTracker());
  });

  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  describe('Survey sending', () => {
    it('should create survey and return ID', async () => {
      const id = await tracker.sendSurvey('c1', 'Budi', 'msg1');
      expect(id).toMatch(/^csat-/);
    });

    it('should emit csat:send event', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'csat:send', contactId: 'c1' })
      );
    });

    it('should prevent duplicate pending surveys for same contact', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      const second = await tracker.sendSurvey('c1', 'Budi', 'msg2');
      expect(second).toBeNull();
    });

    it('should return null if pending survey exists', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      const result = await tracker.sendSurvey('c1', 'Budi', 'msg3');
      expect(result).toBeNull();
    });
  });

  describe('Response recording', () => {
    it('should record valid rating (1-5)', async () => {
      const id = await tracker.sendSurvey('c1', 'Budi', 'msg1');
      const result = tracker.recordResponse(id!, 4);
      expect(result).toBe(true);
    });

    it('should reject rating outside 1-5', async () => {
      const id = await tracker.sendSurvey('c1', 'Budi', 'msg1');
      expect(tracker.recordResponse(id!, 0)).toBe(false);
      expect(tracker.recordResponse(id!, 6)).toBe(false);
    });

    it('should record feedback', async () => {
      const id = await tracker.sendSurvey('c1', 'Budi', 'msg1');
      tracker.recordResponse(id!, 4, 'Layanan bagus');
      const pending = tracker.getPendingSurvey('c1');
      expect(pending).toBeUndefined();
    });

    it('should emit csat:answered event', async () => {
      const id = await tracker.sendSurvey('c1', 'Budi', 'msg1');
      tracker.recordResponse(id!, 5, 'Great');
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'csat:answered',
          surveyId: id,
          rating: 5,
          feedback: 'Great',
        })
      );
    });

    it('should return false for non-existent survey', () => {
      expect(tracker.recordResponse('fake-id', 3)).toBe(false);
    });
  });

  describe('Message handling', () => {
    it('should parse digit "3" as rating 3', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      eventBus.emit.mockClear();
      const result = tracker.handleIncomingMessage('c1', '3');
      expect(result).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'csat:answered' })
      );
    });

    it('should parse "sangat bagus" as rating 5', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      const result = tracker.handleIncomingMessage('c1', 'sangat bagus');
      expect(result).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'csat:answered', rating: 5 })
      );
    });

    it('should parse "buruk" as rating 2', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      const result = tracker.handleIncomingMessage('c1', 'buruk');
      expect(result).toBe(true);
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'csat:answered', rating: 2 })
      );
    });

    it('should return false for unrecognized message', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      const result = tracker.handleIncomingMessage('c1', 'not a rating');
      expect(result).toBe(false);
    });

    it('should return false if no pending survey', () => {
      expect(tracker.handleIncomingMessage('c1', '3')).toBe(false);
    });
  });

  describe('Stats', () => {
    it('should calculate average rating', async () => {
      const id1 = await tracker.sendSurvey('c1', 'A', 'm1');
      tracker.recordResponse(id1!, 4);
      const id2 = await tracker.sendSurvey('c2', 'B', 'm2');
      tracker.recordResponse(id2!, 2);

      const stats = tracker.getStats();
      expect(stats.averageRating).toBe(3);
    });

    it('should calculate NPS score', async () => {
      const id1 = await tracker.sendSurvey('c1', 'A', 'm1');
      tracker.recordResponse(id1!, 5);
      const id2 = await tracker.sendSurvey('c2', 'B', 'm2');
      tracker.recordResponse(id2!, 1);

      const stats = tracker.getStats();
      // promoter (>=4): 1, detractor (<=2): 1 => ((1-1)/2)*100 = 0
      expect(stats.nps).toBe(0);
    });

    it('should return empty stats when no surveys', () => {
      const stats = tracker.getStats();
      expect(stats.totalSurveys).toBe(0);
      expect(stats.averageRating).toBe(0);
      expect(stats.nps).toBe(0);
    });

    it('should filter by days parameter', async () => {
      const id = await tracker.sendSurvey('c1', 'A', 'm1');
      tracker.recordResponse(id!, 4);

      const stats30 = tracker.getStats(30);
      expect(stats30.totalSurveys).toBe(1);

      const stats0 = tracker.getStats(-1);
      expect(stats0.totalSurveys).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should expire surveys older than 24h', async () => {
      await tracker.sendSurvey('c1', 'Budi', 'msg1');
      expect(tracker.getPendingSurvey('c1')).toBeDefined();

      vi.advanceTimersByTime(25 * 60 * 60 * 1000);
      (tracker as any).cleanupExpired();

      expect(tracker.getPendingSurvey('c1')).toBeUndefined();
    });

    it('start/stop should manage timer', async () => {
      const t = createTracker();
      t.tracker.start();
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      t.tracker.stop();
    });
  });
});
