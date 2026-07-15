import { Logger } from 'pino';
import { Database } from '../storage/index.js';
import { CSATTracker, CSATStats } from './csat-tracker.js';
import { getLogger } from '../utils/logger.js';

export interface PerformanceMetrics {
  // Response metrics
  averageResponseTime: number; // ms
  medianResponseTime: number;
  p95ResponseTime: number;
  totalResponses: number;

  // Volume metrics
  totalMessages: number;
  incomingMessages: number;
  outgoingMessages: number;
  uniqueContacts: number;

  // AI metrics
  aiResponseCount: number;
  aiSuccessRate: number; // percentage
  escalationCount: number;
  escalationRate: number; // percentage

  // Tool metrics
  toolCallCount: number;
  toolSuccessRate: number;

  // CSAT
  csat: CSATStats;
}

export interface DailyReport {
  date: string;
  summary: string;
  metrics: {
    messages: number;
    contacts: number;
    avgResponseTime: number;
    csatScore: number;
    escalations: number;
  };
  topContacts: { name: string; messages: number }[];
  hourlyDistribution: number[]; // 24 entries
}

/**
 * AnalyticsService aggregates metrics and generates reports.
 */
export class AnalyticsService {
  private logger: Logger;
  private responseTimes: number[] = [];
  private toolCalls: { success: boolean; timestamp: Date }[] = [];
  private hourlyMessages: number[] = new Array(24).fill(0);

  constructor(
    private db: Database,
    private csatTracker: CSATTracker
  ) {
    this.logger = getLogger().child({ module: 'analytics' });
  }

  /**
   * Record a response time
   */
  recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);
    // Keep last 1000 entries
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000);
    }
  }

  /**
   * Record a tool call
   */
  recordToolCall(success: boolean): void {
    this.toolCalls.push({ success, timestamp: new Date() });
    // Keep last 1000 entries
    if (this.toolCalls.length > 1000) {
      this.toolCalls = this.toolCalls.slice(-1000);
    }
  }

  /**
   * Record a message by hour
   */
  recordMessageByHour(hour: number): void {
    if (hour >= 0 && hour < 24) {
      this.hourlyMessages[hour]++;
    }
  }

  /**
   * Get performance metrics for a period
   */
  getPerformanceMetrics(days = 7): PerformanceMetrics {
    const stats = this.db.getStats(days);
    const csatStats = this.csatTracker.getStats(days);

    // Aggregate stats
    let totalMessages = 0;
    let incomingMessages = 0;
    let outgoingMessages = 0;
    let uniqueContacts = 0;
    let aiResponseCount = 0;

    for (const day of stats) {
      totalMessages += day.totalMessages;
      incomingMessages += day.incomingMessages;
      outgoingMessages += day.outgoingMessages;
      uniqueContacts = Math.max(uniqueContacts, day.uniqueContacts);
      aiResponseCount += day.aiResponseCount;
    }

    // Response time metrics
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const averageResponseTime = sorted.length > 0
      ? sorted.reduce((a, b) => a + b, 0) / sorted.length
      : 0;
    const medianResponseTime = sorted.length > 0
      ? sorted[Math.floor(sorted.length / 2)]
      : 0;
    const p95ResponseTime = sorted.length > 0
      ? sorted[Math.floor(sorted.length * 0.95)]
      : 0;

    // Tool metrics
    const recentTools = this.toolCalls.filter(
      (t) => t.timestamp >= new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    );
    const toolCallCount = recentTools.length;
    const toolSuccessRate = toolCallCount > 0
      ? (recentTools.filter((t) => t.success).length / toolCallCount) * 100
      : 100;

    // AI success rate (based on escalation)
    const escalationCount = stats.reduce((sum, s) => sum + (s as any).escalation_count || 0, 0);
    const aiSuccessRate = incomingMessages > 0
      ? ((incomingMessages - escalationCount) / incomingMessages) * 100
      : 100;

    return {
      averageResponseTime: Math.round(averageResponseTime),
      medianResponseTime: Math.round(medianResponseTime),
      p95ResponseTime: Math.round(p95ResponseTime),
      totalResponses: this.responseTimes.length,
      totalMessages,
      incomingMessages,
      outgoingMessages,
      uniqueContacts,
      aiResponseCount,
      aiSuccessRate: Math.round(aiSuccessRate * 10) / 10,
      escalationCount,
      escalationRate: incomingMessages > 0
        ? Math.round((escalationCount / incomingMessages) * 1000) / 10
        : 0,
      toolCallCount,
      toolSuccessRate: Math.round(toolSuccessRate * 10) / 10,
      csat: csatStats,
    };
  }

  /**
   * Generate daily report
   */
  generateDailyReport(date?: string): DailyReport {
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Get stats for the day
    const stats = this.db.getStats(1);
    const dayStats = stats[0] || {
      totalMessages: 0,
      incomingMessages: 0,
      outgoingMessages: 0,
      uniqueContacts: 0,
      aiResponseCount: 0,
    };

    // Get CSAT for the day
    const csatStats = this.csatTracker.getStats(1);

    // Get top contacts (from recent conversations)
    const topContacts = this.getTopContacts(5);

    // Calculate summary
    const summary = this.formatSummary(dayStats, csatStats);

    return {
      date: targetDate,
      summary,
      metrics: {
        messages: dayStats.totalMessages,
        contacts: dayStats.uniqueContacts,
        avgResponseTime: dayStats.averageResponseTime,
        csatScore: csatStats.averageRating,
        escalations: dayStats.aiResponseCount,
      },
      topContacts,
      hourlyDistribution: [...this.hourlyMessages],
    };
  }

  /**
   * Generate weekly report
   */
  generateWeeklyReport(): string {
    const metrics = this.getPerformanceMetrics(7);
    const csat = metrics.csat;

    const lines = [
      `📊 *Laporan Mingguan WAGENT*`,
      ``,
      `📅 ${this.getDateRange(7)}`,
      ``,
      `*Pesan:*`,
      `• Total: ${metrics.totalMessages}`,
      `• Masuk: ${metrics.incomingMessages}`,
      `• Keluar: ${metrics.outgoingMessages}`,
      ``,
      `*Performa AI:*`,
      `• Rata-rata respon: ${metrics.averageResponseTime}ms`,
      `• Median respon: ${metrics.medianResponseTime}ms`,
      `• P95 respon: ${metrics.p95ResponseTime}ms`,
      `• Success rate: ${metrics.aiSuccessRate}%`,
      `• Eskalasi: ${metrics.escalationCount} (${metrics.escalationRate}%)`,
      ``,
      `*CSAT:*`,
      `• Skor rata-rata: ${csat.averageRating}/5`,
      `• NPS: ${csat.nps}`,
      `• Survey terjawab: ${csat.answered}/${csat.totalSurveys}`,
      ``,
      `*Tools:*`,
      `• Total pemanggilan: ${metrics.toolCallCount}`,
      `• Success rate: ${metrics.toolSuccessRate}%`,
    ];

    return lines.join('\n');
  }

  /**
   * Get top contacts by message count
   */
  private getTopContacts(limit: number): { name: string; messages: number }[] {
    return this.db.getTopContactsByMessageCount(limit);
  }

  /**
   * Format summary text
   */
  private formatSummary(
    stats: any,
    csat: CSATStats
  ): string {
    const parts: string[] = [];

    parts.push(`Hari ini: ${stats.totalMessages} pesan`);
    parts.push(`${stats.incomingMessages} masuk, ${stats.outgoingMessages} keluar`);

    if (csat.totalSurveys > 0) {
      parts.push(`CSAT: ${csat.averageRating}/5 (${csat.totalSurveys} survey)`);
    }

    return parts.join(' | ');
  }

  /**
   * Get date range string
   */
  private getDateRange(days: number): string {
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const formatDate = (d: Date) =>
      d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

    return `${formatDate(start)} - ${formatDate(end)}`;
  }
}
