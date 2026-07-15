import { Logger } from 'pino';
import { Database } from '../storage/index.js';
import { EventBus } from '../utils/event-bus.js';
import { getLogger } from '../utils/logger.js';

export interface CSATSurvey {
  id: string;
  contactId: string;
  contactName: string;
  messageId: string;
  rating?: number; // 1-5
  feedback?: string;
  status: 'pending' | 'answered' | 'expired';
  createdAt: Date;
  answeredAt?: Date;
}

export interface CSATStats {
  totalSurveys: number;
  answered: number;
  averageRating: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  nps: number; // Net Promoter Score (-100 to 100)
}

/**
 * CSATTracker manages customer satisfaction surveys.
 * Sends survey after conversation resolution, tracks ratings.
 */
export class CSATTracker {
  private logger: Logger;
  private pendingSurveys: Map<string, CSATSurvey> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private db: Database,
    private eventBus: EventBus
  ) {
    this.logger = getLogger().child({ module: 'csat-tracker' });
  }

  /**
   * Start the CSAT tracker (cleanup expired surveys)
   */
  start(): void {
    this.timer = setInterval(() => this.cleanupExpired(), 60 * 60 * 1000); // Every hour
    this.logger.info('CSAT tracker started');
  }

  /**
   * Stop the CSAT tracker
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Send a CSAT survey to a contact
   */
  async sendSurvey(
    contactId: string,
    contactName: string,
    messageId: string
  ): Promise<string | null> {
    // Check if already has pending survey
    const existing = Array.from(this.pendingSurveys.values()).find(
      (s) => s.contactId === contactId && s.status === 'pending'
    );
    if (existing) {
      this.logger.debug({ contactId }, 'Already has pending survey');
      return null;
    }

    const survey: CSATSurvey = {
      id: `csat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contactId,
      contactName,
      messageId,
      status: 'pending',
      createdAt: new Date(),
    };

    this.pendingSurveys.set(survey.id, survey);

    // Emit event for gateway to send survey
    this.eventBus.emit({
      type: 'csat:send',
      surveyId: survey.id,
      contactId,
      message: `Halo ${contactName}! 👋\n\nBagaimana pengalaman Anda dengan layanan kami?\n\nBalas dengan angka 1-5:\n1️⃣ Sangat Buruk\n2️⃣ Buruk\n3️⃣ Biasa\n4️⃣ Bagus\n5️⃣ Sangat Bagus`,
    });

    this.logger.info({ surveyId: survey.id, contact: contactName }, 'CSAT survey sent');
    return survey.id;
  }

  /**
   * Record a CSAT response
   */
  recordResponse(surveyId: string, rating: number, feedback?: string): boolean {
    const survey = this.pendingSurveys.get(surveyId);
    if (!survey || survey.status !== 'pending') {
      return false;
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return false;
    }

    survey.rating = rating;
    survey.feedback = feedback;
    survey.status = 'answered';
    survey.answeredAt = new Date();

    this.eventBus.emit({
      type: 'csat:answered',
      surveyId,
      contactId: survey.contactId,
      rating,
      feedback,
    });

    this.logger.info(
      { surveyId, contact: survey.contactName, rating },
      'CSAT survey answered'
    );

    return true;
  }

  /**
   * Handle incoming message as potential CSAT response
   */
  handleIncomingMessage(contactId: string, message: string): boolean {
    // Find pending survey for this contact
    const survey = Array.from(this.pendingSurveys.values()).find(
      (s) => s.contactId === contactId && s.status === 'pending'
    );

    if (!survey) return false;

    // Try to parse rating (1-5)
    const ratingMatch = message.match(/^[1-5]$/);
    if (ratingMatch) {
      this.recordResponse(survey.id, parseInt(ratingMatch[1]));
      return true;
    }

    // Try to parse rating from text
    const textRatings: Record<string, number> = {
      'sangat buruk': 1,
      'buruk': 2,
      'biasa': 3,
      'bagus': 4,
      'sangat bagus': 5,
    };

    const lowerMsg = message.toLowerCase().trim();
    for (const [text, rating] of Object.entries(textRatings)) {
      if (lowerMsg === text) {
        this.recordResponse(survey.id, rating);
        return true;
      }
    }

    return false;
  }

  /**
   * Get CSAT statistics
   */
  getStats(days = 30): CSATStats {
    const surveys = Array.from(this.pendingSurveys.values()).filter(
      (s) => s.status === 'answered' && s.answeredAt
    );

    // Filter by days
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recent = surveys.filter((s) => s.answeredAt! >= cutoff);

    const total = recent.length;
    const answered = recent.filter((s) => s.status === 'answered').length;

    // Calculate distribution
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    for (const survey of recent) {
      if (survey.rating) {
        distribution[survey.rating as keyof typeof distribution]++;
        sum += survey.rating;
      }
    }

    const averageRating = total > 0 ? sum / total : 0;

    // Calculate NPS (9-10 = promoters, 7-8 = passive, 1-6 = detractors)
    const promoters = recent.filter((s) => s.rating && s.rating >= 4).length;
    const detractors = recent.filter((s) => s.rating && s.rating <= 2).length;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

    return {
      totalSurveys: total,
      answered,
      averageRating: Math.round(averageRating * 10) / 10,
      distribution,
      nps,
    };
  }

  /**
   * Cleanup expired surveys (older than 24h)
   */
  private cleanupExpired(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let expired = 0;

    for (const [id, survey] of this.pendingSurveys) {
      if (survey.status === 'pending' && survey.createdAt < cutoff) {
        survey.status = 'expired';
        this.pendingSurveys.delete(id);
        expired++;
      }
    }

    if (expired > 0) {
      this.logger.info({ expired }, 'Expired CSAT surveys cleaned up');
    }
  }

  /**
   * Get pending survey for a contact
   */
  getPendingSurvey(contactId: string): CSATSurvey | undefined {
    return Array.from(this.pendingSurveys.values()).find(
      (s) => s.contactId === contactId && s.status === 'pending'
    );
  }
}
