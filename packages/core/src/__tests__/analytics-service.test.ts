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

import { AnalyticsService } from '../services/analytics-service.js';

function createService(dbOverride: Record<string, any> = {}) {
  const db = {
    getStats: vi.fn().mockReturnValue([]),
    getTopContactsByMessageCount: vi.fn().mockReturnValue([]),
    ...dbOverride,
  } as any;
  const csatTracker = {
    getStats: vi.fn().mockReturnValue({
      totalSurveys: 0,
      answered: 0,
      averageRating: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      nps: 0,
    }),
  } as any;
  return { service: new AnalyticsService(db, csatTracker), db, csatTracker };
}

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let db: any;
  let csatTracker: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ({ service, db, csatTracker } = createService());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Recording', () => {
    it('recordResponseTime should store values', () => {
      service.recordResponseTime(100);
      service.recordResponseTime(200);
      const metrics = service.getPerformanceMetrics();
      expect(metrics.totalResponses).toBe(2);
    });

    it('recordResponseTime should cap at 1000 entries', () => {
      for (let i = 0; i < 1100; i++) {
        service.recordResponseTime(i);
      }
      const metrics = service.getPerformanceMetrics();
      expect(metrics.totalResponses).toBe(1000);
    });

    it('recordToolCall should store results', () => {
      service.recordToolCall(true);
      service.recordToolCall(false);
      const metrics = service.getPerformanceMetrics();
      expect(metrics.toolCallCount).toBe(2);
      expect(metrics.toolSuccessRate).toBe(50);
    });

    it('recordMessageByHour should increment counter', () => {
      service.recordMessageByHour(10);
      service.recordMessageByHour(10);
      service.recordMessageByHour(14);
      const report = service.generateDailyReport();
      expect(report.hourlyDistribution[10]).toBe(2);
      expect(report.hourlyDistribution[14]).toBe(1);
    });
  });

  describe('Performance metrics', () => {
    it('should calculate average response time', () => {
      service.recordResponseTime(100);
      service.recordResponseTime(200);
      service.recordResponseTime(300);
      const metrics = service.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(200);
    });

    it('should calculate median response time', () => {
      service.recordResponseTime(100);
      service.recordResponseTime(200);
      service.recordResponseTime(300);
      const metrics = service.getPerformanceMetrics();
      expect(metrics.medianResponseTime).toBe(200);
    });

    it('should calculate P95 response time', () => {
      for (let i = 1; i <= 100; i++) {
        service.recordResponseTime(i);
      }
      const metrics = service.getPerformanceMetrics();
      expect(metrics.p95ResponseTime).toBe(96);
    });

    it('should return 0 for empty response times', () => {
      const metrics = service.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(0);
      expect(metrics.medianResponseTime).toBe(0);
      expect(metrics.p95ResponseTime).toBe(0);
    });

    it('should include CSAT stats', () => {
      csatTracker.getStats.mockReturnValue({
        totalSurveys: 10,
        answered: 8,
        averageRating: 4.2,
        distribution: { 1: 0, 2: 1, 3: 1, 4: 4, 5: 2 },
        nps: 50,
      });
      const metrics = service.getPerformanceMetrics();
      expect(metrics.csat.totalSurveys).toBe(10);
      expect(metrics.csat.averageRating).toBe(4.2);
    });

    it('should calculate AI success rate', () => {
      db.getStats.mockReturnValue([
        { totalMessages: 100, incomingMessages: 50, outgoingMessages: 50, uniqueContacts: 10, aiResponseCount: 40, escalation_count: 5 },
      ]);
      const metrics = service.getPerformanceMetrics();
      // (50 - 5) / 50 * 100 = 90
      expect(metrics.aiSuccessRate).toBe(90);
    });
  });

  describe('Daily report', () => {
    it('should generate report for today', () => {
      const report = service.generateDailyReport();
      expect(report.date).toBe(new Date().toISOString().split('T')[0]);
    });

    it('should include hourly distribution', () => {
      service.recordMessageByHour(9);
      const report = service.generateDailyReport();
      expect(report.hourlyDistribution).toHaveLength(24);
      expect(report.hourlyDistribution[9]).toBe(1);
    });

    it('should include top contacts', () => {
      db.getTopContactsByMessageCount.mockReturnValue([
        { name: 'Budi', messages: 50 },
        { name: 'Siti', messages: 30 },
      ]);
      const report = service.generateDailyReport();
      expect(report.topContacts).toHaveLength(2);
      expect(report.topContacts[0].name).toBe('Budi');
    });

    it('should use correct date format', () => {
      const report = service.generateDailyReport('2025-06-15');
      expect(report.date).toBe('2025-06-15');
    });
  });

  describe('Weekly report', () => {
    it('should generate markdown string', () => {
      const report = service.generateWeeklyReport();
      expect(typeof report).toBe('string');
      expect(report.length).toBeGreaterThan(0);
    });

    it('should contain Indonesian text', () => {
      const report = service.generateWeeklyReport();
      expect(report).toContain('Laporan Mingguan');
      expect(report).toContain('Pesan');
      expect(report).toContain('Performa AI');
    });

    it('should cover 7 days', () => {
      db.getStats.mockReturnValue([]);
      const report = service.generateWeeklyReport();
      expect(report).toContain('CSAT');
      expect(report).toContain('Tools');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty DB stats', () => {
      db.getStats.mockReturnValue([]);
      const metrics = service.getPerformanceMetrics();
      expect(metrics.totalMessages).toBe(0);
      expect(metrics.aiSuccessRate).toBe(100);
    });

    it('should handle negative response times', () => {
      service.recordResponseTime(-100);
      service.recordResponseTime(200);
      const metrics = service.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBe(50);
    });

    it('should handle hour out of range (>=24)', () => {
      service.recordMessageByHour(24);
      service.recordMessageByHour(100);
      service.recordMessageByHour(-1);
      const report = service.generateDailyReport();
      expect(report.hourlyDistribution[24]).toBeUndefined();
      expect(report.hourlyDistribution.reduce((a, b) => a + b, 0)).toBe(0);
    });
  });
});
