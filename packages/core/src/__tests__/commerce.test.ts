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

import { Database } from '../storage/index.js';
import * as commerce from '../storage/commerce.js';

let db: Database;
let sqliteDb: any;
let dbPath: string;

beforeEach(() => {
  dbPath = join(process.cwd(), 'tmp', `test-commerce-${randomUUID()}.db`);
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  db = new Database(dbPath);
  sqliteDb = (db as any).db;
});

afterEach(() => {
  db.close();
  const resolved = join(process.cwd(), dbPath);
  for (const suffix of ['', '.db-journal', '.db-wal', '.db-shm']) {
    const f = resolved + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

function insertContact(id: string, name: string) {
  sqliteDb.prepare('INSERT INTO contacts (id, name, number, is_group) VALUES (?, ?, ?, 0)').run(id, name, `${id}-num`);
}

function insertChat(id: string, contactId: string, contactName: string) {
  sqliteDb.prepare('INSERT INTO chats (id, contact_id, contact_name, unread_count, is_group) VALUES (?, ?, ?, 0, 0)').run(id, contactId, contactName);
}

function insertMessage(id: string, chatId: string) {
  sqliteDb.prepare("INSERT INTO messages (id, chat_id, from_jid, to_jid, content, message_type, from_me, timestamp) VALUES (?, ?, 'f', 't', 'hi', 'text', 0, datetime('now'))").run(id, chatId);
}

function insertConversation(contactId: string, role: string, content: string, createdAt?: string) {
  if (createdAt) {
    sqliteDb.prepare("INSERT INTO conversations (contact_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(contactId, role, content, createdAt);
  } else {
    sqliteDb.prepare("INSERT INTO conversations (contact_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(contactId, role, content, new Date().toISOString());
  }
}

function insertOrder(id: string, contactId: string, orderNumber: string, opts?: { status?: string; notes?: string; items?: any[]; totalAmount?: number }) {
  sqliteDb.prepare("INSERT INTO orders (id, contact_id, order_number, status, items, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id, contactId, orderNumber,
    opts?.status || 'pending',
    JSON.stringify(opts?.items || []),
    opts?.totalAmount || 0,
    opts?.notes || '',
  );
}

function insertProduct(id: string, name: string, opts?: { price?: number; stock?: number; category?: string; sku?: string; isActive?: boolean; description?: string; imageUrl?: string; metadata?: any }) {
  sqliteDb.prepare("INSERT INTO products (id, name, description, price, currency, stock, category, sku, image_url, is_active, metadata) VALUES (?, ?, ?, ?, 'IDR', ?, ?, ?, ?, ?, ?)").run(
    id, name, opts?.description || '', opts?.price || 0, opts?.stock || 0,
    opts?.category || 'general', opts?.sku || null, opts?.imageUrl || null,
    opts?.isActive !== false ? 1 : 0, JSON.stringify(opts?.metadata || {}),
  );
}

// ── rowToProduct ────────────────────────────────────────────────

describe('rowToProduct', () => {
  it('converts a full row to a product object', () => {
    const row = {
      id: 'p1', name: 'Widget', description: 'A widget', price: 10000,
      currency: 'IDR', stock: 50, category: 'tools', sku: 'W001',
      image_url: 'https://example.com/img.png', is_active: 1,
      metadata: '{"color":"red"}', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z',
    };
    const p = commerce.rowToProduct(row);
    expect(p.id).toBe('p1');
    expect(p.name).toBe('Widget');
    expect(p.description).toBe('A widget');
    expect(p.price).toBe(10000);
    expect(p.currency).toBe('IDR');
    expect(p.stock).toBe(50);
    expect(p.category).toBe('tools');
    expect(p.sku).toBe('W001');
    expect(p.imageUrl).toBe('https://example.com/img.png');
    expect(p.isActive).toBe(true);
    expect(p.metadata).toEqual({ color: 'red' });
    expect(p.createdAt).toBeInstanceOf(Date);
    expect(p.updatedAt).toBeInstanceOf(Date);
  });

  it('converts is_active=0 to isActive=false', () => {
    const row = { is_active: 0, metadata: null, created_at: '2025-01-01', updated_at: '2025-01-01' };
    const p = commerce.rowToProduct(row);
    expect(p.isActive).toBe(false);
    expect(p.metadata).toEqual({});
  });

  it('handles missing metadata (null) as empty object', () => {
    const row = { metadata: null, created_at: '2025-01-01', updated_at: '2025-01-01' };
    expect(commerce.rowToProduct(row).metadata).toEqual({});
  });

  it('handles empty string metadata as empty object', () => {
    const row = { metadata: '', created_at: '2025-01-01', updated_at: '2025-01-01' };
    expect(commerce.rowToProduct(row).metadata).toEqual({});
  });
});

// ── Conversation functions ──────────────────────────────────────

describe('commerce conversations', () => {
  beforeEach(() => {
    insertContact('c1', 'Alice');
  });

  it('addConversation inserts and getConversationHistory retrieves', () => {
    commerce.addConversation(sqliteDb, 'c1', 'user', 'Hello');
    commerce.addConversation(sqliteDb, 'c1', 'assistant', 'Hi there');
    const history = commerce.getConversationHistory(sqliteDb, 'c1');
    expect(history).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('addConversation with tokenCount', () => {
    commerce.addConversation(sqliteDb, 'c1', 'user', 'test', 42);
    const rows = sqliteDb.prepare('SELECT token_count FROM conversations WHERE contact_id = ?').all('c1');
    expect(rows[0].token_count).toBe(42);
  });

  it('addConversation defaults tokenCount to 0', () => {
    commerce.addConversation(sqliteDb, 'c1', 'user', 'test');
    const rows = sqliteDb.prepare('SELECT token_count FROM conversations WHERE contact_id = ?').all('c1');
    expect(rows[0].token_count).toBe(0);
  });

  it('getConversationHistory respects limit', () => {
    for (let i = 0; i < 5; i++) {
      commerce.addConversation(sqliteDb, 'c1', 'user', `msg-${i}`);
    }
    const history = commerce.getConversationHistory(sqliteDb, 'c1', 2);
    expect(history.length).toBe(2);
    expect(history[0].content).toBe('msg-0');
    expect(history[1].content).toBe('msg-1');
  });

  it('getConversationHistory defaults limit to 30', () => {
    for (let i = 0; i < 35; i++) {
      commerce.addConversation(sqliteDb, 'c1', 'user', `msg-${i}`);
    }
    const history = commerce.getConversationHistory(sqliteDb, 'c1');
    expect(history.length).toBe(30);
  });

  it('getConversationHistory returns empty array for nonexistent contact', () => {
    expect(commerce.getConversationHistory(sqliteDb, 'nonexistent')).toEqual([]);
  });

  it('getConversationHistory orders by created_at ASC', () => {
    commerce.addConversation(sqliteDb, 'c1', 'user', 'second');
    sqliteDb.prepare("INSERT INTO conversations (contact_id, role, content, created_at) VALUES (?, 'assistant', 'first', datetime('now', '-1 hour'))").run('c1');
    const history = commerce.getConversationHistory(sqliteDb, 'c1');
    expect(history[0].content).toBe('first');
    expect(history[1].content).toBe('second');
  });

  it('clearConversation removes all for a contact', () => {
    commerce.addConversation(sqliteDb, 'c1', 'user', 'a');
    commerce.addConversation(sqliteDb, 'c1', 'assistant', 'b');
    insertContact('c2', 'Bob');
    commerce.addConversation(sqliteDb, 'c2', 'user', 'c');

    commerce.clearConversation(sqliteDb, 'c1');
    expect(commerce.getConversationHistory(sqliteDb, 'c1')).toEqual([]);
    expect(commerce.getConversationHistory(sqliteDb, 'c2')).toHaveLength(1);
  });

  it('getStaleConversationContacts finds contacts with old messages', () => {
    const oldTime = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    insertConversation('c1', 'user', 'old msg', oldTime);
    insertConversation('c1', 'assistant', 'old reply', oldTime);

    insertContact('c2', 'Recent');
    const freshTime = new Date().toISOString();
    insertConversation('c2', 'user', 'recent msg', freshTime);

    const stale = commerce.getStaleConversationContacts(sqliteDb, 2);
    expect(stale).toContain('c1');
    expect(stale).not.toContain('c2');
  });

  it('getStaleConversationContacts returns empty when all conversations are fresh', () => {
    const freshTime = new Date().toISOString();
    insertConversation('c1', 'user', 'fresh', freshTime);
    const stale = commerce.getStaleConversationContacts(sqliteDb, 24);
    expect(stale).not.toContain('c1');
  });

  it('getStaleConversationContacts returns empty for no conversations', () => {
    expect(commerce.getStaleConversationContacts(sqliteDb, 1)).toEqual([]);
  });

  it('clearStaleConversations clears old and returns count', () => {
    const oldTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    insertConversation('c1', 'user', 'old', oldTime);
    insertContact('c2', 'Bob');
    insertConversation('c2', 'user', 'old2', oldTime);

    const count = commerce.clearStaleConversations(sqliteDb, 2);
    expect(count).toBe(2);
    expect(commerce.getConversationHistory(sqliteDb, 'c1')).toEqual([]);
    expect(commerce.getConversationHistory(sqliteDb, 'c2')).toEqual([]);
  });

  it('clearStaleConversations returns 0 when nothing stale', () => {
    const freshTime = new Date().toISOString();
    insertConversation('c1', 'user', 'fresh', freshTime);
    const count = commerce.clearStaleConversations(sqliteDb, 24);
    expect(count).toBe(0);
  });

  it('trimConversation removes excess oldest entries', () => {
    for (let i = 0; i < 5; i++) {
      insertConversation('c1', 'user', `msg-${i}`);
    }
    commerce.trimConversation(sqliteDb, 'c1', 3);
    const history = commerce.getConversationHistory(sqliteDb, 'c1');
    expect(history.length).toBe(3);
    expect(history[0].content).toBe('msg-2');
    expect(history[2].content).toBe('msg-4');
  });

  it('trimConversation does nothing when count equals maxEntries', () => {
    for (let i = 0; i < 3; i++) {
      insertConversation('c1', 'user', `msg-${i}`);
    }
    commerce.trimConversation(sqliteDb, 'c1', 3);
    expect(commerce.getConversationHistory(sqliteDb, 'c1').length).toBe(3);
  });

  it('trimConversation does nothing when count below maxEntries', () => {
    insertConversation('c1', 'user', 'only-one');
    commerce.trimConversation(sqliteDb, 'c1', 60);
    expect(commerce.getConversationHistory(sqliteDb, 'c1').length).toBe(1);
  });

  it('trimConversation defaults maxEntries to 60', () => {
    for (let i = 0; i < 65; i++) {
      insertConversation('c1', 'user', `msg-${i}`);
    }
    commerce.trimConversation(sqliteDb, 'c1');
    const count = sqliteDb.prepare('SELECT COUNT(*) as c FROM conversations WHERE contact_id = ?').get('c1');
    expect(count.c).toBe(60);
  });

  it('trimConversation with no entries does not error', () => {
    commerce.trimConversation(sqliteDb, 'nonexistent', 10);
  });
});

// ── Stats ───────────────────────────────────────────────────────

describe('commerce stats', () => {
  it('incrementMessageCount creates incoming stats', () => {
    commerce.incrementMessageCount(sqliteDb, 'incoming');
    const stats = commerce.getStats(sqliteDb, 1);
    expect(stats.length).toBe(1);
    expect(stats[0].incomingMessages).toBe(1);
    expect(stats[0].outgoingMessages).toBe(0);
    expect(stats[0].totalMessages).toBe(1);
  });

  it('incrementMessageCount creates outgoing stats', () => {
    commerce.incrementMessageCount(sqliteDb, 'outgoing');
    const stats = commerce.getStats(sqliteDb, 1);
    expect(stats[0].outgoingMessages).toBe(1);
    expect(stats[0].incomingMessages).toBe(0);
  });

  it('incrementMessageCount accumulates on same day', () => {
    commerce.incrementMessageCount(sqliteDb, 'incoming');
    commerce.incrementMessageCount(sqliteDb, 'incoming');
    commerce.incrementMessageCount(sqliteDb, 'outgoing');
    const stats = commerce.getStats(sqliteDb, 1);
    expect(stats[0].totalMessages).toBe(3);
    expect(stats[0].incomingMessages).toBe(2);
    expect(stats[0].outgoingMessages).toBe(1);
  });

  it('getStats returns empty for no data', () => {
    expect(commerce.getStats(sqliteDb)).toEqual([]);
  });

  it('getStats respects days limit', () => {
    const today = new Date().toISOString().split('T')[0];
    sqliteDb.prepare("INSERT INTO daily_stats (date, total_messages, incoming_messages, outgoing_messages, unique_contacts, ai_response_count, avg_response_time) VALUES ('2020-01-01', 1, 1, 0, 0, 0, 0)").run();
    sqliteDb.prepare(`INSERT INTO daily_stats (date, total_messages, incoming_messages, outgoing_messages, unique_contacts, ai_response_count, avg_response_time) VALUES (?, 1, 0, 1, 0, 0, 0)`).run(today);
    const stats = commerce.getStats(sqliteDb, 1);
    expect(stats.length).toBe(1);
    expect(stats[0].date).toBe(today);
  });

  it('getStats maps all fields correctly', () => {
    commerce.incrementMessageCount(sqliteDb, 'incoming');
    const stats = commerce.getStats(sqliteDb, 1);
    const s = stats[0];
    expect(s).toHaveProperty('date');
    expect(s).toHaveProperty('totalMessages');
    expect(s).toHaveProperty('incomingMessages');
    expect(s).toHaveProperty('outgoingMessages');
    expect(s).toHaveProperty('uniqueContacts');
    expect(s).toHaveProperty('aiResponseCount');
    expect(s).toHaveProperty('averageResponseTime');
  });

  it('getTopContactsByMessageCount returns empty with no messages', () => {
    expect(commerce.getTopContactsByMessageCount(sqliteDb)).toEqual([]);
  });

  it('getTopContactsByMessageCount ranks contacts by message count', () => {
    insertContact('c1', 'Alice');
    insertContact('c2', 'Bob');
    insertChat('ch1', 'c1', 'Alice');
    insertChat('ch2', 'c2', 'Bob');

    insertMessage('m1', 'ch1');
    insertMessage('m2', 'ch1');
    insertMessage('m3', 'ch1');
    insertMessage('m4', 'ch2');

    const top = commerce.getTopContactsByMessageCount(sqliteDb, 5);
    expect(top.length).toBe(2);
    expect(top[0]).toEqual({ name: 'Alice', messages: 3 });
    expect(top[1]).toEqual({ name: 'Bob', messages: 1 });
  });

  it('getTopContactsByMessageCount respects limit', () => {
    insertContact('c1', 'A');
    insertContact('c2', 'B');
    insertChat('ch1', 'c1', 'A');
    insertChat('ch2', 'c2', 'B');
    insertMessage('m1', 'ch1');
    insertMessage('m2', 'ch2');

    const top = commerce.getTopContactsByMessageCount(sqliteDb, 1);
    expect(top.length).toBe(1);
  });
});

// ── Orders ──────────────────────────────────────────────────────

describe('commerce orders', () => {
  beforeEach(() => {
    insertContact('c1', 'Alice');
  });

  it('saveOrder and getOrder round-trip', () => {
    commerce.saveOrder(sqliteDb, {
      id: 'o1', contactId: 'c1', orderNumber: 'ORD-001',
      status: 'pending', items: [{ name: 'Widget', qty: 2 }],
      totalAmount: 100000, currency: 'IDR',
      shippingAddress: '123 St', notes: 'urgent',
    });
    const order = commerce.getOrder(sqliteDb, 'o1');
    expect(order).not.toBeNull();
    expect(order.id).toBe('o1');
    expect(order.contactId).toBe('c1');
    expect(order.orderNumber).toBe('ORD-001');
    expect(order.status).toBe('pending');
    expect(order.items).toEqual([{ name: 'Widget', qty: 2 }]);
    expect(order.totalAmount).toBe(100000);
    expect(order.currency).toBe('IDR');
    expect(order.shippingAddress).toBe('123 St');
    expect(order.notes).toBe('urgent');
    expect(order.createdAt).toBeInstanceOf(Date);
    expect(order.updatedAt).toBeInstanceOf(Date);
  });

  it('saveOrder with minimal fields uses defaults', () => {
    commerce.saveOrder(sqliteDb, { id: 'o2', contactId: 'c1', orderNumber: 'ORD-002' });
    const order = commerce.getOrder(sqliteDb, 'o2');
    expect(order.status).toBe('pending');
    expect(order.items).toEqual([]);
    expect(order.totalAmount).toBe(0);
    expect(order.currency).toBe('IDR');
    expect(order.shippingAddress).toBe('');
    expect(order.notes).toBe('');
  });

  it('saveOrder upserts on conflict', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', totalAmount: 50000 });
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', totalAmount: 75000, notes: 'updated' });
    const order = commerce.getOrder(sqliteDb, 'o1');
    expect(order.totalAmount).toBe(75000);
    expect(order.notes).toBe('updated');
  });

  it('getOrder returns null for nonexistent id', () => {
    expect(commerce.getOrder(sqliteDb, 'nonexistent')).toBeNull();
  });

  it('getOrdersByContact returns orders ordered by created_at DESC', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
    sqliteDb.prepare("INSERT INTO orders (id, contact_id, order_number, status, items, total_amount, currency, notes, created_at) VALUES (?, ?, ?, 'pending', '[]', 0, 'IDR', '', datetime('now', '-1 hour'))").run('o2', 'c1', 'ORD-002');
    const orders = commerce.getOrdersByContact(sqliteDb, 'c1');
    expect(orders.length).toBe(2);
    expect(orders[0].orderNumber).toBe('ORD-001');
    expect(orders[1].orderNumber).toBe('ORD-002');
  });

  it('getOrdersByContact respects limit', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
    commerce.saveOrder(sqliteDb, { id: 'o2', contactId: 'c1', orderNumber: 'ORD-002' });
    commerce.saveOrder(sqliteDb, { id: 'o3', contactId: 'c1', orderNumber: 'ORD-003' });
    expect(commerce.getOrdersByContact(sqliteDb, 'c1', 2).length).toBe(2);
  });

  it('getOrdersByContact returns empty for contact with no orders', () => {
    insertContact('c2', 'NoOrders');
    expect(commerce.getOrdersByContact(sqliteDb, 'c2')).toEqual([]);
  });

  it('updateOrderStatus updates the status', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', status: 'pending' });
    commerce.updateOrderStatus(sqliteDb, 'o1', 'shipped');
    expect(commerce.getOrder(sqliteDb, 'o1').status).toBe('shipped');
  });

  it('searchOrders finds by order_number', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
    commerce.saveOrder(sqliteDb, { id: 'o2', contactId: 'c1', orderNumber: 'INV-002' });
    const results = commerce.searchOrders(sqliteDb, 'ORD');
    expect(results.length).toBe(1);
    expect(results[0].orderNumber).toBe('ORD-001');
  });

  it('searchOrders finds by notes', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', notes: 'fragile item' });
    commerce.saveOrder(sqliteDb, { id: 'o2', contactId: 'c1', orderNumber: 'ORD-002', notes: '' });
    const results = commerce.searchOrders(sqliteDb, 'fragile');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('o1');
  });

  it('searchOrders with special characters', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-100%', notes: '20% discount' });
    const results = commerce.searchOrders(sqliteDb, '100%');
    expect(results.length).toBe(1);
  });

  it('searchOrders respects limit', () => {
    for (let i = 0; i < 5; i++) {
      commerce.saveOrder(sqliteDb, { id: `o${i}`, contactId: 'c1', orderNumber: `SEARCH-${i}` });
    }
    expect(commerce.searchOrders(sqliteDb, 'SEARCH', 3).length).toBe(3);
  });

  it('searchOrders returns empty for no match', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
    expect(commerce.searchOrders(sqliteDb, 'ZZZ')).toEqual([]);
  });

  it('searchOrders returns mapped fields correctly', () => {
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', items: [{ name: 'x' }], totalAmount: 50000, currency: 'IDR' });
    const r = commerce.searchOrders(sqliteDb, 'ORD-001')[0];
    expect(r.id).toBe('o1');
    expect(r.contactId).toBe('c1');
    expect(r.items).toEqual([{ name: 'x' }]);
    expect(r.totalAmount).toBe(50000);
    expect(r.createdAt).toBeInstanceOf(Date);
  });
});

// ── Payments ────────────────────────────────────────────────────

describe('commerce payments', () => {
  beforeEach(() => {
    insertContact('c1', 'Alice');
    commerce.saveOrder(sqliteDb, { id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
  });

  it('savePayment and getPaymentsByOrder round-trip', () => {
    commerce.savePayment(sqliteDb, {
      id: 'p1', orderId: 'o1', contactId: 'c1',
      amount: 50000, method: 'bank_transfer',
      proof: 'receipt.png', recordedBy: 'admin',
    });
    const payments = commerce.getPaymentsByOrder(sqliteDb, 'o1');
    expect(payments.length).toBe(1);
    expect(payments[0].id).toBe('p1');
    expect(payments[0].orderId).toBe('o1');
    expect(payments[0].contactId).toBe('c1');
    expect(payments[0].amount).toBe(50000);
    expect(payments[0].method).toBe('bank_transfer');
    expect(payments[0].proof).toBe('receipt.png');
    expect(payments[0].recordedBy).toBe('admin');
    expect(payments[0].status).toBe('recorded');
    expect(payments[0].createdAt).toBeInstanceOf(Date);
  });

  it('savePayment with minimal fields uses defaults', () => {
    commerce.savePayment(sqliteDb, { id: 'p1', orderId: 'o1', amount: 10000, method: 'cash' });
    const p = commerce.getPaymentsByOrder(sqliteDb, 'o1')[0];
    expect(p.proof).toBe('');
    expect(p.recordedBy).toBe('system');
  });

  it('savePayment without orderId or contactId', () => {
    commerce.savePayment(sqliteDb, { id: 'p2', amount: 5000, method: 'e_wallet' });
    const p = (sqliteDb.prepare('SELECT * FROM payments WHERE id = ?').get('p2') as any);
    expect(p.order_id).toBeNull();
    expect(p.contact_id).toBeNull();
  });

  it('multiple payments per order', () => {
    commerce.savePayment(sqliteDb, { id: 'p1', orderId: 'o1', amount: 30000, method: 'bank_transfer' });
    commerce.savePayment(sqliteDb, { id: 'p2', orderId: 'o1', amount: 20000, method: 'cash' });
    commerce.savePayment(sqliteDb, { id: 'p3', orderId: 'o1', amount: 50000, method: 'e_wallet' });
    const payments = commerce.getPaymentsByOrder(sqliteDb, 'o1');
    expect(payments.length).toBe(3);
    expect(payments[0].amount + payments[1].amount + payments[2].amount).toBe(100000);
  });

  it('getPaymentsByOrder returns empty for order with no payments', () => {
    commerce.saveOrder(sqliteDb, { id: 'o2', contactId: 'c1', orderNumber: 'ORD-002' });
    expect(commerce.getPaymentsByOrder(sqliteDb, 'o2')).toEqual([]);
  });

  it('getPaymentsByOrder returns empty for nonexistent order', () => {
    expect(commerce.getPaymentsByOrder(sqliteDb, 'nonexistent')).toEqual([]);
  });

  it('getPaymentsByOrder orders by created_at DESC', () => {
    commerce.savePayment(sqliteDb, { id: 'p1', orderId: 'o1', amount: 10000, method: 'a' });
    sqliteDb.prepare("INSERT INTO payments (id, order_id, amount, method, status, created_at) VALUES (?, ?, ?, ?, 'recorded', datetime('now', '-1 hour'))").run('p2', 'o1', 20000, 'b');
    const payments = commerce.getPaymentsByOrder(sqliteDb, 'o1');
    expect(payments[0].id).toBe('p1');
    expect(payments[1].id).toBe('p2');
  });
});

// ── Products ────────────────────────────────────────────────────

describe('commerce products', () => {
  it('saveProduct and getProduct round-trip', () => {
    commerce.saveProduct(sqliteDb, {
      id: 'p1', name: 'Widget', description: 'A fine widget',
      price: 25000, currency: 'IDR', stock: 100,
      category: 'tools', sku: 'W001',
      imageUrl: 'https://example.com/w.png',
      isActive: true, metadata: { color: 'blue' },
    });
    const p = commerce.getProduct(sqliteDb, 'p1');
    expect(p).not.toBeNull();
    expect(p.id).toBe('p1');
    expect(p.name).toBe('Widget');
    expect(p.description).toBe('A fine widget');
    expect(p.price).toBe(25000);
    expect(p.stock).toBe(100);
    expect(p.category).toBe('tools');
    expect(p.sku).toBe('W001');
    expect(p.imageUrl).toBe('https://example.com/w.png');
    expect(p.isActive).toBe(true);
    expect(p.metadata).toEqual({ color: 'blue' });
  });

  it('saveProduct with defaults for optional fields', () => {
    commerce.saveProduct(sqliteDb, { id: 'p1', name: 'Basic', price: 1000 });
    const p = commerce.getProduct(sqliteDb, 'p1');
    expect(p.description).toBe('');
    expect(p.currency).toBe('IDR');
    expect(p.stock).toBe(0);
    expect(p.category).toBe('general');
    expect(p.sku).toBeNull();
    expect(p.imageUrl).toBeNull();
    expect(p.isActive).toBe(true);
    expect(p.metadata).toEqual({});
  });

  it('saveProduct upserts on conflict', () => {
    commerce.saveProduct(sqliteDb, { id: 'p1', name: 'Old', price: 1000, stock: 5 });
    commerce.saveProduct(sqliteDb, { id: 'p1', name: 'New', price: 2000, stock: 10 });
    const p = commerce.getProduct(sqliteDb, 'p1');
    expect(p.name).toBe('New');
    expect(p.price).toBe(2000);
    expect(p.stock).toBe(10);
  });

  it('saveProduct with isActive=false', () => {
    commerce.saveProduct(sqliteDb, { id: 'p1', name: 'Inactive', price: 0, isActive: false });
    const raw = sqliteDb.prepare('SELECT is_active FROM products WHERE id = ?').get('p1');
    expect(raw.is_active).toBe(0);
    const p = commerce.getProduct(sqliteDb, 'p1');
    expect(p.isActive).toBe(false);
  });

  it('getProduct returns null for nonexistent id', () => {
    expect(commerce.getProduct(sqliteDb, 'nonexistent')).toBeNull();
  });

  it('getProductsByCategory returns only active products', () => {
    insertProduct('p1', 'Active', { category: 'food', isActive: true });
    insertProduct('p2', 'Inactive', { category: 'food', isActive: false });
    insertProduct('p3', 'Also Active', { category: 'food', isActive: true });

    const products = commerce.getProductsByCategory(sqliteDb, 'food');
    expect(products.length).toBe(2);
    expect(products.map((p: any) => p.id)).toContain('p1');
    expect(products.map((p: any) => p.id)).toContain('p3');
    expect(products.map((p: any) => p.id)).not.toContain('p2');
  });

  it('getProductsByCategory returns empty for wrong category', () => {
    insertProduct('p1', 'Widget', { category: 'tools' });
    expect(commerce.getProductsByCategory(sqliteDb, 'food')).toEqual([]);
  });

  it('getProductsByCategory respects limit', () => {
    insertProduct('p1', 'A', { category: 'x' });
    insertProduct('p2', 'B', { category: 'x' });
    insertProduct('p3', 'C', { category: 'x' });
    expect(commerce.getProductsByCategory(sqliteDb, 'x', 2).length).toBe(2);
  });

  it('getProductsByCategory orders by name', () => {
    insertProduct('p1', 'Zebra', { category: 'z' });
    insertProduct('p2', 'Apple', { category: 'z' });
    insertProduct('p3', 'Mango', { category: 'z' });
    const products = commerce.getProductsByCategory(sqliteDb, 'z');
    expect(products[0].name).toBe('Apple');
    expect(products[1].name).toBe('Mango');
    expect(products[2].name).toBe('Zebra');
  });

  it('searchProducts finds by name', () => {
    insertProduct('p1', 'Blue Widget', { isActive: true });
    insertProduct('p2', 'Red Gadget', { isActive: true });
    const results = commerce.searchProducts(sqliteDb, 'Widget');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Blue Widget');
  });

  it('searchProducts finds by description', () => {
    insertProduct('p1', 'Item', { description: 'premium quality', isActive: true });
    insertProduct('p2', 'Other', { description: 'basic', isActive: true });
    const results = commerce.searchProducts(sqliteDb, 'premium');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('p1');
  });

  it('searchProducts finds by sku', () => {
    insertProduct('p1', 'Item', { sku: 'SKU-123', isActive: true });
    const results = commerce.searchProducts(sqliteDb, 'SKU-123');
    expect(results.length).toBe(1);
    expect(results[0].sku).toBe('SKU-123');
  });

  it('searchProducts excludes inactive products', () => {
    insertProduct('p1', 'Active Widget', { isActive: true });
    insertProduct('p2', 'Inactive Widget', { isActive: false });
    const results = commerce.searchProducts(sqliteDb, 'Widget');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('p1');
  });

  it('searchProducts respects limit', () => {
    insertProduct('p1', 'Search A', { isActive: true });
    insertProduct('p2', 'Search B', { isActive: true });
    insertProduct('p3', 'Search C', { isActive: true });
    expect(commerce.searchProducts(sqliteDb, 'Search', 2).length).toBe(2);
  });

  it('searchProducts returns empty for no match', () => {
    insertProduct('p1', 'Widget', { isActive: true });
    expect(commerce.searchProducts(sqliteDb, 'ZZZ')).toEqual([]);
  });

  it('updateProductStock updates the stock', () => {
    insertProduct('p1', 'Widget', { stock: 10 });
    commerce.updateProductStock(sqliteDb, 'p1', 25);
    const p = commerce.getProduct(sqliteDb, 'p1');
    expect(p.stock).toBe(25);
  });

  it('updateProductStock on nonexistent product does not error', () => {
    commerce.updateProductStock(sqliteDb, 'nonexistent', 0);
  });

  it('updateProductStock sets to zero', () => {
    insertProduct('p1', 'Widget', { stock: 50 });
    commerce.updateProductStock(sqliteDb, 'p1', 0);
    expect(commerce.getProduct(sqliteDb, 'p1').stock).toBe(0);
  });
});

// ── Database class facade tests ─────────────────────────────────

describe('Database facade delegates to commerce', () => {
  beforeEach(() => {
    insertContact('c1', 'Alice');
  });

  it('db.addConversation → commerce.addConversation', () => {
    db.addConversation('c1', 'user', 'Hi', 5);
    const history = db.getConversationHistory('c1');
    expect(history).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('db.clearConversation → commerce.clearConversation', () => {
    db.addConversation('c1', 'user', 'Hi');
    db.clearConversation('c1');
    expect(db.getConversationHistory('c1')).toEqual([]);
  });

  it('db.getStaleConversationContacts delegates', () => {
    const oldTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    sqliteDb.prepare("INSERT INTO conversations (contact_id, role, content, created_at) VALUES (?, 'user', 'old', ?)").run('c1', oldTime);
    expect(db.getStaleConversationContacts(2)).toContain('c1');
  });

  it('db.clearStaleConversations delegates', () => {
    const oldTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    sqliteDb.prepare("INSERT INTO conversations (contact_id, role, content, created_at) VALUES (?, 'user', 'old', ?)").run('c1', oldTime);
    expect(db.clearStaleConversations(2)).toBe(1);
  });

  it('db.trimConversation delegates', () => {
    for (let i = 0; i < 5; i++) db.addConversation('c1', 'user', `m${i}`);
    db.trimConversation('c1', 3);
    expect(db.getConversationHistory('c1').length).toBe(3);
  });

  it('db.incrementMessageCount and db.getStats delegate', () => {
    db.incrementMessageCount('incoming');
    db.incrementMessageCount('outgoing');
    const stats = db.getStats(1);
    expect(stats.length).toBe(1);
    expect(stats[0].totalMessages).toBe(2);
  });

  it('db.getTopContactsByMessageCount delegates', () => {
    expect(db.getTopContactsByMessageCount()).toEqual([]);
  });

  it('db.saveOrder and db.getOrder delegate', () => {
    db.saveOrder({ id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', totalAmount: 50000 });
    const order = db.getOrder('o1');
    expect(order.orderNumber).toBe('ORD-001');
    expect(order.totalAmount).toBe(50000);
  });

  it('db.getOrdersByContact delegates', () => {
    db.saveOrder({ id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
    db.saveOrder({ id: 'o2', contactId: 'c1', orderNumber: 'ORD-002' });
    expect(db.getOrdersByContact('c1').length).toBe(2);
  });

  it('db.updateOrderStatus delegates', () => {
    db.saveOrder({ id: 'o1', contactId: 'c1', orderNumber: 'ORD-001', status: 'pending' });
    db.updateOrderStatus('o1', 'delivered');
    expect(db.getOrder('o1').status).toBe('delivered');
  });

  it('db.searchOrders delegates', () => {
    db.saveOrder({ id: 'o1', contactId: 'c1', orderNumber: 'SEARCH-001' });
    expect(db.searchOrders('SEARCH').length).toBe(1);
  });

  it('db.savePayment and db.getPaymentsByOrder delegate', () => {
    db.saveOrder({ id: 'o1', contactId: 'c1', orderNumber: 'ORD-001' });
    db.savePayment({ id: 'p1', orderId: 'o1', amount: 10000, method: 'cash' });
    expect(db.getPaymentsByOrder('o1').length).toBe(1);
  });

  it('db.saveProduct and db.getProduct delegate', () => {
    db.saveProduct({ id: 'p1', name: 'Widget', price: 5000, stock: 10 });
    const p = db.getProduct('p1');
    expect(p.name).toBe('Widget');
    expect(p.stock).toBe(10);
  });

  it('db.getProductsByCategory delegates', () => {
    db.saveProduct({ id: 'p1', name: 'A', price: 1, category: 'cat1' });
    db.saveProduct({ id: 'p2', name: 'B', price: 1, category: 'cat2' });
    expect(db.getProductsByCategory('cat1').length).toBe(1);
  });

  it('db.searchProducts delegates', () => {
    db.saveProduct({ id: 'p1', name: 'FindMe', price: 1 });
    expect(db.searchProducts('FindMe').length).toBe(1);
  });

  it('db.updateProductStock delegates', () => {
    db.saveProduct({ id: 'p1', name: 'Widget', price: 1, stock: 0 });
    db.updateProductStock('p1', 42);
    expect(db.getProduct('p1').stock).toBe(42);
  });
});
