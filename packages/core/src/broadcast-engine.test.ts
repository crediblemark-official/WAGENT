import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BroadcastEngine } from './broadcast-engine.js';
import { EventBus } from './event-bus.js';
import { Database } from './storage.js';
import type { WhatsAppAdapter } from './gateway.js';

function createMockWhatsApp(): WhatsAppAdapter {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ id: 'msg-1', content: 'ok' } as any),
    getConnectionStatus: vi.fn().mockReturnValue('connected'),
    getContacts: vi.fn().mockResolvedValue([]),
    isConnected: vi.fn().mockReturnValue(true),
    onEvent: vi.fn(),
  };
}

function createMockDb(): Database {
  const db = {
    getAllContacts: vi.fn().mockReturnValue([
      { id: '1@s.whatsapp.net', name: 'Budi', tags: '["vip"]' },
      { id: '2@s.whatsapp.net', name: 'Andi', tags: '["regular"]' },
    ]),
    createBroadcast: vi.fn(),
    updateBroadcastStatus: vi.fn(),
  };
  return db as unknown as Database;
}

describe('BroadcastEngine', () => {
  let engine: BroadcastEngine;
  let whatsapp: WhatsAppAdapter;
  let db: Database;
  let eventBus: EventBus;

  beforeEach(() => {
    whatsapp = createMockWhatsApp();
    db = createMockDb();
    eventBus = new EventBus();
    engine = new BroadcastEngine(db, whatsapp, eventBus);
  });

  it('starts broadcast to all contacts', async () => {
    const id = await engine.startBroadcast('Hello {{name}}!', {
      delayMs: 10, // Fast for test
    });

    expect(id).toMatch(/^bc-/);
    expect(db.createBroadcast).toHaveBeenCalled();
  });

  it('starts broadcast with tag filter', async () => {
    const id = await engine.startBroadcast('VIP only!', {
      delayMs: 10,
      targetFilter: { tags: ['vip'] },
    });

    expect(id).toMatch(/^bc-/);
    // Wait for broadcast to complete
    await new Promise((r) => setTimeout(r, 50));
    expect(whatsapp.sendMessage).toHaveBeenCalledTimes(1); // Only Budi (vip)
  });

  it('personalizes message with contact name', async () => {
    await engine.startBroadcast('Hi {{name}}!', {
      delayMs: 10,
      targetFilter: { contactIds: ['1@s.whatsapp.net'] },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(whatsapp.sendMessage).toHaveBeenCalledWith(
      '1@s.whatsapp.net',
      'Hi Budi!'
    );
  });

  it('returns empty target list', async () => {
    await expect(
      engine.startBroadcast('Hello', {
        delayMs: 10,
        targetFilter: { tags: ['nonexistent'] },
      })
    ).rejects.toThrow('No contacts matched');
  });

  it('gets active broadcasts', async () => {
    await engine.startBroadcast('Test', { delayMs: 100 });
    const active = engine.getActiveBroadcasts();
    expect(active.length).toBe(1);
  });
});
