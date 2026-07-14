import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from './scheduler.js';
import { Database } from './storage.js';
import { EventBus } from './event-bus.js';
import { WhatsAppAdapter } from './gateway.js';
import { ScheduledMessage, Message, ConnectionStatus, GatewayEvent, Contact } from './types.js';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';

describe('Scheduler', () => {
  let db: Database;
  let eventBus: EventBus;
  let mockAdapter: WhatsAppAdapter;
  let scheduler: Scheduler;
  let TEST_DB: string;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'wagent-sched-'));
    TEST_DB = join(dir, 'test.db');
    db = new Database(TEST_DB);
    eventBus = new EventBus();

    mockAdapter = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue({
        id: 'sent-1', from: 'bot', to: 'user', content: 'test',
        type: 'text', timestamp: new Date(), fromMe: true,
      } as Message),
      getConnectionStatus: vi.fn().mockReturnValue('connected' as ConnectionStatus),
      getContacts: vi.fn().mockResolvedValue([] as Contact[]),
      isConnected: vi.fn().mockReturnValue(true),
      onEvent: vi.fn(),
    };

    scheduler = new Scheduler(db, mockAdapter, eventBus);
  });

  afterEach(() => {
    scheduler.stop();
    db.close();
    const dir = dirname(TEST_DB);
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    try { rmdirSync(dir); } catch {}
  });

  describe('calculateNextRun', () => {
    it('should return undefined for non-repeating messages', () => {
      const msg: ScheduledMessage = {
        id: '1', contactId: 'x', contactName: 'A', content: 'test',
        scheduledAt: new Date('2025-06-01T10:00:00'),
        repeat: 'none', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(),
      };
      // Access private method via prototype
      const nextRun = (Scheduler.prototype as any).calculateNextRun.call(scheduler, msg);
      expect(nextRun).toBeUndefined();
    });

    it('should calculate next daily run', () => {
      const msg: ScheduledMessage = {
        id: '1', contactId: 'x', contactName: 'A', content: 'test',
        scheduledAt: new Date('2025-06-01T14:30:00'),
        repeat: 'daily', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(),
      };
      const now = new Date();
      const nextRun = (Scheduler.prototype as any).calculateNextRun.call(scheduler, msg) as Date;
      expect(nextRun).toBeInstanceOf(Date);
      // Should be today or tomorrow at 14:30
      expect(nextRun.getHours()).toBe(14);
      expect(nextRun.getMinutes()).toBe(30);
    });

    it('should calculate next weekly run', () => {
      // Original: June 1, 2025 is a Sunday (day 0)
      const msg: ScheduledMessage = {
        id: '1', contactId: 'x', contactName: 'A', content: 'test',
        scheduledAt: new Date('2025-06-01T09:00:00'), // Sunday
        repeat: 'weekly', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(),
      };
      const nextRun = (Scheduler.prototype as any).calculateNextRun.call(scheduler, msg) as Date;
      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun.getHours()).toBe(9);
      expect(nextRun.getMinutes()).toBe(0);
    });

    it('should calculate next monthly run', () => {
      const msg: ScheduledMessage = {
        id: '1', contactId: 'x', contactName: 'A', content: 'test',
        scheduledAt: new Date('2025-06-15T12:00:00'),
        repeat: 'monthly', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(),
      };
      const nextRun = (Scheduler.prototype as any).calculateNextRun.call(scheduler, msg) as Date;
      expect(nextRun).toBeInstanceOf(Date);
      expect(nextRun.getDate()).toBe(15);
      expect(nextRun.getHours()).toBe(12);
    });
  });

  describe('start/stop', () => {
    it('should start and stop without errors', () => {
      expect(() => scheduler.start()).not.toThrow();
      expect(() => scheduler.stop()).not.toThrow();
    });

    it('should not start twice', () => {
      scheduler.start();
      const firstTimer = (scheduler as any).timer;
      scheduler.start(); // Second start should be no-op
      const secondTimer = (scheduler as any).timer;
      expect(secondTimer).toBe(firstTimer);
      scheduler.stop();
    });
  });

  describe('send flow', () => {
    it('should send due messages when WhatsApp is connected', async () => {
      // Create a due message
      const msg: ScheduledMessage = {
        id: 'due-1', contactId: '628123@s.whatsapp.net', contactName: 'John',
        content: 'Pesan otomatis', scheduledAt: new Date('2020-01-01'),
        repeat: 'none', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(), nextRunAt: new Date('2020-01-01'),
      };
      db.createScheduledMessage(msg);

      scheduler.start();

      // Wait for the check interval
      await new Promise(r => setTimeout(r, 100));

      // The message should have been sent
      const updated = db.getScheduledMessage('due-1');
      expect(updated!.status).toBe('sent');
      expect(updated!.sentCount).toBe(1);

      scheduler.stop();
    });

    it('should not send when WhatsApp is disconnected', async () => {
      mockAdapter.isConnected = vi.fn().mockReturnValue(false);
      const msg: ScheduledMessage = {
        id: 'skip-1', contactId: 'x', contactName: 'A', content: 'Skip',
        scheduledAt: new Date('2020-01-01'), repeat: 'none', status: 'pending',
        sentCount: 0, failedCount: 0, createdAt: new Date(), updatedAt: new Date(),
        nextRunAt: new Date('2020-01-01'),
      };
      db.createScheduledMessage(msg);

      scheduler.start();
      await new Promise(r => setTimeout(r, 100));

      const updated = db.getScheduledMessage('skip-1');
      expect(updated!.status).toBe('pending'); // Not sent because disconnected

      scheduler.stop();
    });
  });
});
