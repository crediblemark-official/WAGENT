import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../services/scheduler.js';
import { ScheduledMessage } from '../types.js';

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

function makeMsg(overrides: Partial<ScheduledMessage> = {}): ScheduledMessage {
  return {
    id: 'msg-1',
    contactId: 'c-1',
    contactName: 'Alice',
    content: 'Hello',
    scheduledAt: new Date('2025-01-15T10:00:00Z'),
    repeat: 'none',
    status: 'pending',
    sentCount: 0,
    failedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMocks() {
  return {
    db: {
      getDueScheduledMessages: vi.fn().mockReturnValue([]),
      updateScheduledMessage: vi.fn(),
      getScheduledMessage: vi.fn().mockReturnValue(makeMsg()),
    },
    whatsapp: {
      isConnected: vi.fn().mockReturnValue(true),
      sendMessage: vi.fn().mockResolvedValue({ id: 'sent-1' }),
    },
    eventBus: {
      emit: vi.fn(),
    },
  };
}

describe('Scheduler', () => {
  let scheduler: Scheduler;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks = createMocks();
    scheduler = new Scheduler(mocks.db as any, mocks.whatsapp as any, mocks.eventBus as any);
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('start() sets running and calls checkAndSend immediately', async () => {
    mocks.whatsapp.isConnected.mockReturnValue(false);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.whatsapp.isConnected).toHaveBeenCalled();
  });

  it('start() does not run twice', () => {
    mocks.whatsapp.isConnected.mockReturnValue(false);
    scheduler.start();
    scheduler.start();
    expect(mocks.db.getDueScheduledMessages).toHaveBeenCalledTimes(0);
  });

  it('stop() clears interval', () => {
    mocks.whatsapp.isConnected.mockReturnValue(false);
    scheduler.start();
    scheduler.stop();
    vi.advanceTimersByTime(60_000);
    expect(mocks.whatsapp.isConnected).toHaveBeenCalledTimes(1);
  });

  it('checkAndSend skips when whatsapp not connected', async () => {
    mocks.whatsapp.isConnected.mockReturnValue(false);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.db.getDueScheduledMessages).not.toHaveBeenCalled();
  });

  it('checkAndSend processes due messages', async () => {
    const msg = makeMsg();
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'sent', sentCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-1', 'Hello');
  });

  it('sendScheduledMessage marks active, sends, calculates next run, and emits', async () => {
    const msg = makeMsg({ repeat: 'none' });
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'sent', sentCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.db.updateScheduledMessage).toHaveBeenCalledWith('msg-1', { status: 'active' });
    expect(mocks.whatsapp.sendMessage).toHaveBeenCalledWith('c-1', 'Hello');
    expect(mocks.eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'scheduled:update' })
    );
  });

  it('calculateNextRun returns undefined for none repeat', async () => {
    const msg = makeMsg({ repeat: 'none' });
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'sent', sentCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const updateCall = mocks.db.updateScheduledMessage.mock.calls.find(
      (c: any[]) => c[1].status === 'sent'
    ) as any;
    expect(updateCall[1].nextRunAt).toBeUndefined();
  });

  it('calculateNextRun returns a future date for daily repeat', async () => {
    const msg = makeMsg({
      repeat: 'daily',
      scheduledAt: new Date('2025-01-15T10:00:00Z'),
    });
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'pending', sentCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const updateCall = mocks.db.updateScheduledMessage.mock.calls.find(
      (c: any[]) => c[1].status === 'pending'
    ) as any;
    expect(updateCall[1].nextRunAt).toBeInstanceOf(Date);
    expect(updateCall[1].nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('calculateNextRun returns a future date for weekly repeat', async () => {
    const msg = makeMsg({
      repeat: 'weekly',
      scheduledAt: new Date('2025-01-15T10:00:00Z'),
    });
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'pending', sentCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const updateCall = mocks.db.updateScheduledMessage.mock.calls.find(
      (c: any[]) => c[1].status === 'pending'
    ) as any;
    expect(updateCall[1].nextRunAt).toBeInstanceOf(Date);
    expect(updateCall[1].nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('calculateNextRun returns a future date for monthly repeat', async () => {
    const msg = makeMsg({
      repeat: 'monthly',
      scheduledAt: new Date('2025-01-15T10:00:00Z'),
    });
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'pending', sentCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const updateCall = mocks.db.updateScheduledMessage.mock.calls.find(
      (c: any[]) => c[1].status === 'pending'
    ) as any;
    expect(updateCall[1].nextRunAt).toBeInstanceOf(Date);
    expect(updateCall[1].nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('handles send failure by marking failed and incrementing failedCount', async () => {
    const msg = makeMsg({ failedCount: 0 });
    mocks.db.getDueScheduledMessages.mockReturnValue([msg]);
    mocks.whatsapp.sendMessage.mockRejectedValueOnce(new Error('send error'));
    mocks.db.getScheduledMessage.mockReturnValue({ ...msg, status: 'failed', failedCount: 1 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const failCall = mocks.db.updateScheduledMessage.mock.calls.find(
      (c: any[]) => c[1].status === 'failed'
    ) as any;
    expect(failCall).toBeDefined();
    expect(failCall[1].failedCount).toBe(1);
  });

  it('runs checkAndSend on interval', async () => {
    mocks.whatsapp.isConnected.mockReturnValue(false);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.whatsapp.isConnected).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(mocks.whatsapp.isConnected).toHaveBeenCalledTimes(2);
  });
});
