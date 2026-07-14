import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CSATTracker } from './csat-tracker.js';
import { EventBus } from './event-bus.js';
import { Database } from './storage.js';

function createMockDb(): Database {
  return {} as unknown as Database;
}

describe('CSATTracker', () => {
  let tracker: CSATTracker;
  let db: Database;
  let eventBus: EventBus;

  beforeEach(() => {
    db = createMockDb();
    eventBus = new EventBus();
    tracker = new CSATTracker(db, eventBus);
  });

  describe('sendSurvey', () => {
    it('creates and sends a survey', async () => {
      const surveyId = await tracker.sendSurvey(
        '1@s.whatsapp.net',
        'Budi',
        'msg-1'
      );

      expect(surveyId).toMatch(/^csat-/);
    });

    it('prevents duplicate pending surveys', async () => {
      await tracker.sendSurvey('1@s.whatsapp.net', 'Budi', 'msg-1');
      const duplicate = await tracker.sendSurvey(
        '1@s.whatsapp.net',
        'Budi',
        'msg-2'
      );

      expect(duplicate).toBeNull();
    });
  });

  describe('recordResponse', () => {
    it('records valid rating', async () => {
      const surveyId = await tracker.sendSurvey(
        '1@s.whatsapp.net',
        'Budi',
        'msg-1'
      );

      const result = tracker.recordResponse(surveyId!, 5);
      expect(result).toBe(true);
    });

    it('rejects invalid rating', async () => {
      const surveyId = await tracker.sendSurvey(
        '1@s.whatsapp.net',
        'Budi',
        'msg-1'
      );

      const result = tracker.recordResponse(surveyId!, 6);
      expect(result).toBe(false);
    });

    it('rejects response for non-existent survey', () => {
      const result = tracker.recordResponse('invalid', 5);
      expect(result).toBe(false);
    });
  });

  describe('handleIncomingMessage', () => {
    it('parses numeric rating', async () => {
      await tracker.sendSurvey('1@s.whatsapp.net', 'Budi', 'msg-1');

      const handled = tracker.handleIncomingMessage('1@s.whatsapp.net', '4');
      expect(handled).toBe(true);
    });

    it('parses text rating', async () => {
      await tracker.sendSurvey('1@s.whatsapp.net', 'Budi', 'msg-1');

      const handled = tracker.handleIncomingMessage('1@s.whatsapp.net', 'sangat bagus');
      expect(handled).toBe(true);
    });

    it('ignores non-rating messages', async () => {
      await tracker.sendSurvey('1@s.whatsapp.net', 'Budi', 'msg-1');

      const handled = tracker.handleIncomingMessage('1@s.whatsapp.net', 'Hello');
      expect(handled).toBe(false);
    });

    it('returns false when no pending survey', () => {
      const handled = tracker.handleIncomingMessage('1@s.whatsapp.net', '5');
      expect(handled).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns empty stats when no surveys', () => {
      const stats = tracker.getStats();
      expect(stats.totalSurveys).toBe(0);
      expect(stats.averageRating).toBe(0);
    });

    it('calculates stats correctly', async () => {
      // Create and answer surveys
      const id1 = await tracker.sendSurvey('1@s.whatsapp.net', 'Budi', 'msg-1');
      tracker.recordResponse(id1!, 5);

      const id2 = await tracker.sendSurvey('2@s.whatsapp.net', 'Andi', 'msg-2');
      tracker.recordResponse(id2!, 4);

      const stats = tracker.getStats();
      expect(stats.totalSurveys).toBe(2);
      expect(stats.averageRating).toBe(4.5);
      expect(stats.distribution[5]).toBe(1);
      expect(stats.distribution[4]).toBe(1);
    });
  });

  describe('getPendingSurvey', () => {
    it('returns pending survey for contact', async () => {
      await tracker.sendSurvey('1@s.whatsapp.net', 'Budi', 'msg-1');

      const pending = tracker.getPendingSurvey('1@s.whatsapp.net');
      expect(pending).toBeDefined();
      expect(pending!.contactName).toBe('Budi');
    });

    it('returns undefined when no pending', () => {
      const pending = tracker.getPendingSurvey('1@s.whatsapp.net');
      expect(pending).toBeUndefined();
    });
  });
});
