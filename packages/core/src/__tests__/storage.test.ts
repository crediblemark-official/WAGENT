import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { unlinkSync, existsSync, mkdirSync } from 'fs';

vi.mock('../logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

vi.mock('../crypto.js', () => ({
  isEncryptionAvailable: () => false,
  getEncryptionKey: () => null,
  encryptFile: vi.fn(),
  decryptFile: vi.fn(),
}));

import { Database } from '../storage.js';

let db: Database;
let dbPath: string;

beforeEach(() => {
  dbPath = join(process.cwd(), 'tmp', `test-db-${randomUUID()}.db`);
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  db = new Database(dbPath);
});

afterEach(() => {
  db.close();
  const resolved = join(process.cwd(), dbPath);
  for (const suffix of ['', '.db-journal', '.db-wal', '.db-shm']) {
    const f = resolved + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

describe('Database', () => {
  it('creates expected tables on init', () => {
    const stmt = (db as any).db;
    const tables = stmt
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain('contacts');
    expect(tables).toContain('chats');
    expect(tables).toContain('messages');
    expect(tables).toContain('conversations');
    expect(tables).toContain('daily_stats');
    expect(tables).toContain('scheduled_messages');
    expect(tables).toContain('knowledge_base');
    expect(tables).toContain('orders');
    expect(tables).toContain('payments');
  });

  describe('contacts', () => {
    it('saveContact and getContact', () => {
      const contact = {
        id: 'c1',
        name: 'Alice',
        number: '12345',
        isGroup: false,
        tags: ['vip'],
        notes: 'test note',
      };
      db.saveContact(contact);
      const got = db.getContact('c1');
      expect(got).toBeDefined();
      expect(got!.name).toBe('Alice');
      expect(got!.number).toBe('12345');
      expect(got!.tags).toEqual(['vip']);
      expect(got!.notes).toBe('test note');
    });

    it('getAllContacts returns saved contacts', () => {
      db.saveContact({ id: 'c1', name: 'Alice', number: '111', isGroup: false });
      db.saveContact({ id: 'c2', name: 'Bob', number: '222', isGroup: false });
      const all = db.getAllContacts();
      expect(all.length).toBeGreaterThanOrEqual(2);
      expect(all.map((c) => c.name)).toContain('Alice');
      expect(all.map((c) => c.name)).toContain('Bob');
    });

    it('searchContacts finds by name or number', () => {
      db.saveContact({ id: 'c1', name: 'Charlie', number: '555000', isGroup: false });
      db.saveContact({ id: 'c2', name: 'Dave', number: '555111', isGroup: false });
      expect(db.searchContacts('Charlie').length).toBe(1);
      expect(db.searchContacts('555111').length).toBe(1);
      expect(db.searchContacts('zzz').length).toBe(0);
    });
  });

  describe('chats', () => {
    it('saveChat and getChat', () => {
      db.saveContact({ id: 'c1', name: 'Alice', number: '111', isGroup: false });
      const now = new Date();
      db.saveChat({
        id: 'ch1',
        contactId: 'c1',
        contactName: 'Alice',
        lastMessage: 'Hi',
        lastMessageAt: now,
        unreadCount: 1,
        isGroup: false,
        createdAt: now,
      });
      const chat = db.getChat('ch1');
      expect(chat).toBeDefined();
      expect(chat!.contactId).toBe('c1');
      expect(chat!.lastMessage).toBe('Hi');
      expect(chat!.unreadCount).toBe(1);
    });
  });

  describe('messages', () => {
    it('saveMessage and getMessages', () => {
      db.saveContact({ id: 'c1', name: 'Alice', number: '111', isGroup: false });
      db.saveChat({
        id: 'ch1',
        contactId: 'c1',
        contactName: 'Alice',
        unreadCount: 0,
        isGroup: false,
        createdAt: new Date(),
      });
      const msg = {
        id: 'm1',
        from: '111',
        to: '222',
        content: 'Hello',
        type: 'text' as const,
        timestamp: new Date(),
        fromMe: false,
      };
      db.saveMessage(msg, 'ch1');
      const msgs = db.getMessages('ch1');
      expect(msgs.length).toBe(1);
      expect(msgs[0].content).toBe('Hello');
      expect(msgs[0].id).toBe('m1');
    });

    it('messageExists returns correct boolean', () => {
      expect(db.messageExists('nonexistent')).toBe(false);
      db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false });
      db.saveChat({ id: 'ch1', contactId: 'c1', contactName: 'A', unreadCount: 0, isGroup: false, createdAt: new Date() });
      db.saveMessage({
        id: 'm1', from: '1', to: '2', content: 'x', type: 'text', timestamp: new Date(), fromMe: true,
      }, 'ch1');
      expect(db.messageExists('m1')).toBe(true);
    });
  });

  describe('conversations', () => {
    it('addConversation and getConversationHistory', () => {
      db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false });
      db.addConversation('c1', 'user', 'What is 2+2?');
      db.addConversation('c1', 'assistant', '4');
      const history = db.getConversationHistory('c1');
      expect(history.length).toBe(2);
      expect(history[0]).toEqual({ role: 'user', content: 'What is 2+2?' });
      expect(history[1]).toEqual({ role: 'assistant', content: '4' });
    });
  });

  describe('stats', () => {
    it('incrementMessageCount and getStats', () => {
      db.incrementMessageCount('incoming');
      db.incrementMessageCount('incoming');
      db.incrementMessageCount('outgoing');
      const stats = db.getStats();
      expect(stats.length).toBeGreaterThanOrEqual(1);
      const today = stats.find(s => s.date === new Date().toISOString().split('T')[0]);
      expect(today).toBeDefined();
      expect(today!.totalMessages).toBe(3);
      expect(today!.incomingMessages).toBe(2);
      expect(today!.outgoingMessages).toBe(1);
    });
  });

  describe('scheduled messages', () => {
    it('createScheduledMessage and getDueScheduledMessages', () => {
      const now = new Date();
      const past = new Date(Date.now() - 60_000);
      db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false });

      db.createScheduledMessage({
        id: 's1',
        contactId: 'c1',
        contactName: 'A',
        content: 'Reminder',
        scheduledAt: past,
        repeat: 'none',
        status: 'pending',
        sentCount: 0,
        failedCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      const due = db.getDueScheduledMessages();
      expect(due.length).toBeGreaterThanOrEqual(1);
      expect(due.find(m => m.id === 's1')).toBeDefined();
    });
  });

  describe('knowledge base', () => {
    it('createKnowledgeEntry and searchKnowledge', () => {
      const now = new Date();
      db.createKnowledgeEntry({
        id: 'k1',
        category: 'pricing',
        question: 'How much?',
        answer: 'Rp 50.000',
        keywords: ['price', 'cost'],
        tags: ['pricing'],
        priority: 1,
        createdAt: now,
        updatedAt: now,
      });
      const results = db.searchKnowledge('price');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entry.id).toBe('k1');
    });

    it('getKnowledgeCategories returns distinct categories', () => {
      const now = new Date();
      db.createKnowledgeEntry({ id: 'k1', category: 'faq', question: 'Q1', answer: 'A1', keywords: [], tags: [], priority: 0, createdAt: now, updatedAt: now });
      db.createKnowledgeEntry({ id: 'k2', category: 'pricing', question: 'Q2', answer: 'A2', keywords: [], tags: [], priority: 0, createdAt: now, updatedAt: now });
      const cats = db.getKnowledgeCategories();
      expect(cats).toContain('faq');
      expect(cats).toContain('pricing');
    });
  });

  describe('orders', () => {
    it('saveOrder and getOrder', () => {
      db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false });
      db.saveOrder({
        id: 'o1',
        contactId: 'c1',
        orderNumber: 'ORD-001',
        status: 'pending',
        items: [{ name: 'Item', qty: 1 }],
        totalAmount: 50000,
      });
      const order = db.getOrder('o1');
      expect(order).not.toBeNull();
      expect(order.orderNumber).toBe('ORD-001');
      expect(order.totalAmount).toBe(50000);
      expect(order.items).toEqual([{ name: 'Item', qty: 1 }]);
    });
  });

  describe('payments', () => {
    it('savePayment and getPaymentsByOrder', () => {
      db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false });
      db.saveOrder({ id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
      db.savePayment({
        id: 'p1',
        orderId: 'o1',
        contactId: 'c1',
        amount: 50000,
        method: 'bank_transfer',
      });
      const payments = db.getPaymentsByOrder('o1');
      expect(payments.length).toBe(1);
      expect(payments[0].amount).toBe(50000);
      expect(payments[0].method).toBe('bank_transfer');
    });
  });
});
