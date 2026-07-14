import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from './analytics-service.js';
import { CSATTracker } from './csat-tracker.js';
import { Database } from './storage.js';

function createMockDb(): Database {
  return {
    getStats: vi.fn().mockReturnValue([
      {
        date: '2026-07-13',
        totalMessages: 100,
        incomingMessages: 60,
        outgoingMessages: 40,
        uniqueContacts: 25,
        aiResponseCount: 55,
        averageResponseTime: 1500,
      },
    ]),
  } as unknown as Database;
}

function createMockCSAT(): CSATTracker {
  return {
    getStats: vi.fn().mockReturnValue({
      totalSurveys: 10,
      answered: 8,
      averageRating: 4.2,
      distribution: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 2 },
      nps: 50,
    }),
  } as unknown as CSATTracker;
}

describe('AnalyticsService', () => {
  let analytics: AnalyticsService;
  let db: Database;
  let csat: CSATTracker;

  beforeEach(() => {
    db = createMockDb();
    csat = createMockCSAT();
    analytics = new AnalyticsService(db, csat);
  });

  describe('recordResponseTime', () => {
    it('records response times', () => {
      analytics.recordResponseTime(1000);
      analytics.recordResponseTime(1500);
      analytics.recordResponseTime(2000);

      const metrics = analytics.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(1500);
      expect(metrics.medianResponseTime).toBe(1500);
    });

    it('calculates p95 correctly', () => {
      // Add 100 response times
      for (let i = 1; i <= 100; i++) {
        analytics.recordResponseTime(i * 10);
      }

      const metrics = analytics.getPerformanceMetrics();
      // p95 index = floor(100 * 0.95) = 95, value = 960
      expect(metrics.p95ResponseTime).toBe(960);
    });
  });

  describe('recordToolCall', () => {
    it('records successful tool calls', () => {
      analytics.recordToolCall(true);
      analytics.recordToolCall(true);
      analytics.recordToolCall(false);

      const metrics = analytics.getPerformanceMetrics();
      expect(metrics.toolCallCount).toBe(3);
      expect(metrics.toolSuccessRate).toBeCloseTo(66.7, 1);
    });
  });

  describe('getPerformanceMetrics', () => {
    it('returns comprehensive metrics', () => {
      analytics.recordResponseTime(1000);
      analytics.recordToolCall(true);

      const metrics = analytics.getPerformanceMetrics();

      expect(metrics).toHaveProperty('averageResponseTime');
      expect(metrics).toHaveProperty('medianResponseTime');
      expect(metrics).toHaveProperty('p95ResponseTime');
      expect(metrics).toHaveProperty('totalMessages');
      expect(metrics).toHaveProperty('aiSuccessRate');
      expect(metrics).toHaveProperty('csat');
    });

    it('includes CSAT stats', () => {
      const metrics = analytics.getPerformanceMetrics();
      expect(metrics.csat.averageRating).toBe(4.2);
      expect(metrics.csat.nps).toBe(50);
    });
  });

  describe('generateDailyReport', () => {
    it('generates a daily report', () => {
      const report = analytics.generateDailyReport('2026-07-13');

      expect(report.date).toBe('2026-07-13');
      expect(report.summary).toBeDefined();
      expect(report.metrics).toBeDefined();
      expect(report.metrics.messages).toBe(100);
      expect(report.hourlyDistribution).toHaveLength(24);
    });
  });

  describe('generateWeeklyReport', () => {
    it('generates a weekly report', () => {
      analytics.recordResponseTime(1500);
      analytics.recordToolCall(true);

      const report = analytics.generateWeeklyReport();

      expect(report).toContain('Laporan Mingguan');
      expect(report).toContain('Pesan');
      expect(report).toContain('CSAT');
    });
  });
});
