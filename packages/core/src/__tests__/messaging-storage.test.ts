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

import {
  rowToContact,
  rowToChat,
  rowToMessage,
  rowToScheduled,
  saveContact,
  getContact,
  getAllContacts,
  searchContacts,
  saveChat,
  getAllChats,
  getChat,
  saveMessage,
  messageExists,
  getMessages,
  createBroadcast,
  updateBroadcastStatus,
  getAllBroadcasts,
  addBroadcastRecipient,
  updateBroadcastRecipient,
  getBroadcastRecipients,
  createScheduledMessage,
  updateScheduledMessage,
  deleteScheduledMessage,
  getScheduledMessage,
  getAllScheduledMessages,
  getDueScheduledMessages,
} from '../storage/messaging.js';
import { Database } from '../storage/index.js';
import type BetterSqlite3 from 'better-sqlite3';

let db: Database;
let rawDb: BetterSqlite3.Database;
let dbPath: string;

beforeEach(() => {
  dbPath = join(process.cwd(), 'tmp', `test-messaging-${randomUUID()}.db`);
  mkdirSync(join(process.cwd(), 'tmp'), { recursive: true });
  db = new Database(dbPath);
  rawDb = (db as any).db;
});

afterEach(() => {
  db.close();
  const resolved = join(process.cwd(), dbPath);
  for (const suffix of ['', '.db-journal', '.db-wal', '.db-shm']) {
    const f = resolved + suffix;
    if (existsSync(f)) unlinkSync(f);
  }
});

const now = new Date();
const ts = (d: Date) => d.toISOString();

function insertRawContact(overrides: Record<string, any> = {}) {
  const id = overrides.id || randomUUID();
  rawDb.prepare(`
    INSERT INTO contacts (id, name, push_name, number, is_group, avatar, last_seen, tags, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name ?? 'Test User',
    overrides.push_name ?? null,
    overrides.number ?? '12345',
    overrides.is_group ?? 0,
    overrides.avatar ?? null,
    overrides.last_seen ?? null,
    overrides.tags ?? '[]',
    overrides.notes ?? '',
    overrides.created_at ?? ts(now),
    overrides.updated_at ?? ts(now),
  );
  return id;
}

function insertRawChat(overrides: Record<string, any> = {}) {
  const id = overrides.id || randomUUID();
  const contactId = overrides.contact_id || insertRawContact({ id: overrides.contact_id });
  rawDb.prepare(`
    INSERT INTO chats (id, contact_id, contact_name, last_message, last_message_at, unread_count, is_group, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    contactId,
    overrides.contact_name ?? 'Test',
    overrides.last_message ?? null,
    overrides.last_message_at ?? null,
    overrides.unread_count ?? 0,
    overrides.is_group ?? 0,
    overrides.created_at ?? ts(now),
  );
  return id;
}

function insertRawBroadcast(overrides: Record<string, any> = {}) {
  const id = overrides.id || randomUUID();
  rawDb.prepare(`
    INSERT INTO broadcasts (id, content, target_filter, status, total_contacts, sent_count, failed_count, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.content ?? 'Hello everyone',
    overrides.target_filter ?? '{}',
    overrides.status ?? 'pending',
    overrides.total_contacts ?? 0,
    overrides.sent_count ?? 0,
    overrides.failed_count ?? 0,
    overrides.created_at ?? ts(now),
    overrides.completed_at ?? null,
  );
  return id;
}

// ── Row Converters ────────────────────────────────────────────────

describe('rowToContact', () => {
  it('converts a full row to Contact', () => {
    const row = {
      id: 'c1', name: 'Alice', push_name: 'Ali', number: '123',
      is_group: 1, avatar: 'http://img', last_seen: '2025-01-01T00:00:00.000Z',
      tags: '["vip"]', notes: 'important',
      created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z',
    };
    const contact = rowToContact(row);
    expect(contact.id).toBe('c1');
    expect(contact.name).toBe('Alice');
    expect(contact.pushName).toBe('Ali');
    expect(contact.number).toBe('123');
    expect(contact.isGroup).toBe(true);
    expect(contact.avatar).toBe('http://img');
    expect(contact.lastSeen).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    expect(contact.tags).toEqual(['vip']);
    expect(contact.notes).toBe('important');
  });

  it('handles missing optional fields', () => {
    const row = {
      id: 'c2', name: '', push_name: null, number: '456',
      is_group: 0, avatar: null, last_seen: null,
      tags: null, notes: null,
      created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
    };
    const contact = rowToContact(row);
    expect(contact.pushName).toBeUndefined();
    expect(contact.avatar).toBeUndefined();
    expect(contact.lastSeen).toBeUndefined();
    expect(contact.tags).toEqual([]);
    expect(contact.notes).toBeUndefined();
    expect(contact.isGroup).toBe(false);
  });
});

describe('rowToChat', () => {
  it('converts a full row to Chat', () => {
    const row = {
      id: 'ch1', contact_id: 'c1', contact_name: 'Alice',
      last_message: 'Hi', last_message_at: '2025-01-01T00:00:00.000Z',
      unread_count: 3, is_group: 1, created_at: '2025-01-01T00:00:00.000Z',
    };
    const chat = rowToChat(row);
    expect(chat.id).toBe('ch1');
    expect(chat.contactId).toBe('c1');
    expect(chat.contactName).toBe('Alice');
    expect(chat.lastMessage).toBe('Hi');
    expect(chat.lastMessageAt).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    expect(chat.unreadCount).toBe(3);
    expect(chat.isGroup).toBe(true);
  });

  it('handles missing optional fields', () => {
    const row = {
      id: 'ch2', contact_id: 'c1', contact_name: 'Bob',
      last_message: null, last_message_at: null,
      unread_count: 0, is_group: 0, created_at: '2025-01-01T00:00:00.000Z',
    };
    const chat = rowToChat(row);
    expect(chat.lastMessage).toBeUndefined();
    expect(chat.lastMessageAt).toBeUndefined();
    expect(chat.isGroup).toBe(false);
  });
});

describe('rowToMessage', () => {
  it('converts a full row to Message', () => {
    const row = {
      id: 'm1', from_jid: '111', to_jid: '222', content: 'Hello',
      message_type: 'text', from_me: 1, timestamp: '2025-01-01T00:00:00.000Z',
      metadata: '{"key":"val"}',
    };
    const msg = rowToMessage(row);
    expect(msg.id).toBe('m1');
    expect(msg.from).toBe('111');
    expect(msg.to).toBe('222');
    expect(msg.content).toBe('Hello');
    expect(msg.type).toBe('text');
    expect(msg.fromMe).toBe(true);
    expect(msg.metadata).toEqual({ key: 'val' });
  });

  it('handles empty metadata', () => {
    const row = {
      id: 'm2', from_jid: '111', to_jid: '222', content: '',
      message_type: 'image', from_me: 0, timestamp: '2025-01-01T00:00:00.000Z',
      metadata: null,
    };
    const msg = rowToMessage(row);
    expect(msg.fromMe).toBe(false);
    expect(msg.metadata).toEqual({});
  });
});

describe('rowToScheduled', () => {
  it('converts a full row to ScheduledMessage', () => {
    const row = {
      id: 's1', contact_id: 'c1', contact_name: 'Alice', content: 'Hi',
      scheduled_at: '2025-06-01T09:00:00.000Z', repeat: 'daily', status: 'active',
      last_sent_at: '2025-05-31T09:00:00.000Z', next_run_at: '2025-06-01T09:00:00.000Z',
      sent_count: 5, failed_count: 1,
      created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-05-31T00:00:00.000Z',
    };
    const msg = rowToScheduled(row);
    expect(msg.id).toBe('s1');
    expect(msg.contactId).toBe('c1');
    expect(msg.contactName).toBe('Alice');
    expect(msg.content).toBe('Hi');
    expect(msg.repeat).toBe('daily');
    expect(msg.status).toBe('active');
    expect(msg.lastSentAt).toEqual(new Date('2025-05-31T09:00:00.000Z'));
    expect(msg.nextRunAt).toEqual(new Date('2025-06-01T09:00:00.000Z'));
    expect(msg.sentCount).toBe(5);
    expect(msg.failedCount).toBe(1);
  });

  it('handles null optional datetime fields', () => {
    const row = {
      id: 's2', contact_id: 'c1', contact_name: 'Bob', content: 'Hey',
      scheduled_at: '2025-06-01T09:00:00.000Z', repeat: 'none', status: 'pending',
      last_sent_at: null, next_run_at: null,
      sent_count: 0, failed_count: 0,
      created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
    };
    const msg = rowToScheduled(row);
    expect(msg.lastSentAt).toBeUndefined();
    expect(msg.nextRunAt).toBeUndefined();
  });
});

// ── Contacts (direct module functions) ────────────────────────────

describe('saveContact (module)', () => {
  it('saves a contact with all fields', () => {
    const contact = {
      id: 'c1', name: 'Alice', pushName: 'Ali', number: '123',
      isGroup: false, avatar: 'http://img', lastSeen: new Date('2025-01-01'),
      createdAt: now, updatedAt: now, tags: ['vip', 'customer'], notes: 'Important',
    };
    saveContact(rawDb, contact);
    const got = getContact(rawDb, 'c1');
    expect(got).toBeDefined();
    expect(got!.name).toBe('Alice');
    expect(got!.pushName).toBe('Ali');
    expect(got!.number).toBe('123');
    expect(got!.isGroup).toBe(false);
    expect(got!.avatar).toBe('http://img');
    expect(got!.lastSeen).toEqual(new Date('2025-01-01'));
    expect(got!.tags).toEqual(['vip', 'customer']);
    expect(got!.notes).toBe('Important');
  });

  it('saves a contact with minimal fields', () => {
    const contact = {
      id: 'c2', name: 'Bob', number: '456',
      isGroup: true, createdAt: now, updatedAt: now,
    };
    saveContact(rawDb, contact);
    const got = getContact(rawDb, 'c2');
    expect(got).toBeDefined();
    expect(got!.name).toBe('Bob');
    expect(got!.pushName).toBeUndefined();
    expect(got!.avatar).toBeUndefined();
    expect(got!.lastSeen).toBeUndefined();
    expect(got!.tags).toEqual([]);
  });

  it('upserts contact preserving existing values with COALESCE', () => {
    saveContact(rawDb, {
      id: 'c1', name: 'Alice', pushName: 'Ali', number: '123',
      isGroup: false, avatar: 'http://old', lastSeen: new Date('2025-01-01'),
      createdAt: now, updatedAt: now, tags: ['vip'], notes: 'old note',
    });

    saveContact(rawDb, {
      id: 'c1', name: '', number: '123',
      isGroup: false, createdAt: now, updatedAt: now,
    });

    const got = getContact(rawDb, 'c1');
    expect(got!.name).toBe('Alice');
    expect(got!.pushName).toBe('Ali');
    expect(got!.avatar).toBe('http://old');
  });

  it('updates fields when new values are non-empty', () => {
    saveContact(rawDb, {
      id: 'c1', name: 'Alice', pushName: 'Ali', number: '123',
      isGroup: false, createdAt: now, updatedAt: now, tags: ['old'],
    });

    saveContact(rawDb, {
      id: 'c1', name: 'Alice Updated', pushName: 'Ali2', number: '123',
      isGroup: false, avatar: 'http://new', createdAt: now, updatedAt: now,
      tags: ['new'], notes: 'updated note',
    });

    const got = getContact(rawDb, 'c1');
    expect(got!.name).toBe('Alice Updated');
    expect(got!.pushName).toBe('Ali2');
    expect(got!.avatar).toBe('http://new');
    expect(got!.tags).toEqual(['new']);
    expect(got!.notes).toBe('updated note');
  });
});

describe('getContact (module)', () => {
  it('returns undefined for nonexistent id', () => {
    expect(getContact(rawDb, 'nonexistent')).toBeUndefined();
  });

  it('returns the correct contact', () => {
    insertRawContact({ id: 'c1', name: 'Alice' });
    const got = getContact(rawDb, 'c1');
    expect(got).toBeDefined();
    expect(got!.id).toBe('c1');
    expect(got!.name).toBe('Alice');
  });
});

describe('getAllContacts (module)', () => {
  it('returns contacts ordered by updated_at DESC', () => {
    insertRawContact({ id: 'c1', name: 'Alice', updated_at: '2025-01-01T00:00:00.000Z' });
    insertRawContact({ id: 'c2', name: 'Bob', updated_at: '2025-06-01T00:00:00.000Z' });
    const all = getAllContacts(rawDb);
    expect(all.length).toBe(2);
    expect(all[0].name).toBe('Bob');
    expect(all[1].name).toBe('Alice');
  });

  it('returns empty array when no contacts', () => {
    expect(getAllContacts(rawDb)).toEqual([]);
  });
});

describe('searchContacts (module)', () => {
  it('finds contact by name', () => {
    insertRawContact({ id: 'c1', name: 'Charlie Brown', number: '111' });
    insertRawContact({ id: 'c2', name: 'Dave', number: '222' });
    const results = searchContacts(rawDb, 'Charlie');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('c1');
  });

  it('finds contact by number', () => {
    insertRawContact({ id: 'c1', name: 'Alice', number: '5551234' });
    insertRawContact({ id: 'c2', name: 'Bob', number: '9998888' });
    const results = searchContacts(rawDb, '5551234');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('c1');
  });

  it('finds contact by push_name', () => {
    insertRawContact({ id: 'c1', name: 'Alice', number: '111', push_name: 'AliBaba' });
    insertRawContact({ id: 'c2', name: 'Bob', number: '222' });
    const results = searchContacts(rawDb, 'AliBaba');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('c1');
  });

  it('returns empty for no match', () => {
    insertRawContact({ id: 'c1', name: 'Alice', number: '111' });
    expect(searchContacts(rawDb, 'zzz')).toEqual([]);
  });

  it('performs partial matching', () => {
    insertRawContact({ id: 'c1', name: 'Christopher', number: '111' });
    const results = searchContacts(rawDb, 'ris');
    expect(results.length).toBe(1);
  });
});

// ── Chats (direct module functions) ───────────────────────────────

describe('saveChat (module)', () => {
  it('saves a new chat', () => {
    const contactId = insertRawContact({ id: 'c1', name: 'Alice' });
    const chat = {
      id: 'ch1', contactId, contactName: 'Alice',
      lastMessage: 'Hi', lastMessageAt: new Date('2025-06-01'),
      unreadCount: 2, isGroup: false, createdAt: now,
    };
    saveChat(rawDb, chat);
    const got = getChat(rawDb, 'ch1');
    expect(got).toBeDefined();
    expect(got!.contactId).toBe(contactId);
    expect(got!.lastMessage).toBe('Hi');
    expect(got!.unreadCount).toBe(2);
  });

  it('upserts chat updating last_message and unread_count', () => {
    const contactId = insertRawContact({ id: 'c1', name: 'Alice' });
    saveChat(rawDb, {
      id: 'ch1', contactId, contactName: 'Alice',
      lastMessage: 'Old', unreadCount: 1, isGroup: false, createdAt: now,
    });

    saveChat(rawDb, {
      id: 'ch1', contactId, contactName: 'Alice',
      lastMessage: 'New', unreadCount: 5, isGroup: false, createdAt: now,
    });

    const got = getChat(rawDb, 'ch1');
    expect(got!.lastMessage).toBe('New');
    expect(got!.unreadCount).toBe(5);
  });

  it('preserves contact_name when empty string on update', () => {
    const contactId = insertRawContact({ id: 'c1', name: 'Alice' });
    saveChat(rawDb, {
      id: 'ch1', contactId, contactName: 'Original',
      unreadCount: 0, isGroup: false, createdAt: now,
    });

    saveChat(rawDb, {
      id: 'ch1', contactId, contactName: '',
      lastMessage: 'msg', unreadCount: 1, isGroup: false, createdAt: now,
    });

    const got = getChat(rawDb, 'ch1');
    expect(got!.contactName).toBe('Original');
    expect(got!.lastMessage).toBe('msg');
  });
});

describe('getAllChats (module)', () => {
  it('returns chats ordered by last_message_at DESC', () => {
    const cId = insertRawContact({ id: 'c1', name: 'A' });
    insertRawChat({ id: 'ch1', contact_id: cId, contact_name: 'A', last_message_at: '2025-01-01T00:00:00.000Z' });
    insertRawChat({ id: 'ch2', contact_id: cId, contact_name: 'A', last_message_at: '2025-06-01T00:00:00.000Z' });
    const all = getAllChats(rawDb);
    expect(all.length).toBe(2);
    expect(all[0].id).toBe('ch2');
    expect(all[1].id).toBe('ch1');
  });

  it('returns empty array when no chats', () => {
    expect(getAllChats(rawDb)).toEqual([]);
  });
});

describe('getChat (module)', () => {
  it('returns undefined for nonexistent id', () => {
    expect(getChat(rawDb, 'nonexistent')).toBeUndefined();
  });

  it('returns the correct chat', () => {
    const cId = insertRawContact({ id: 'c1', name: 'Alice' });
    insertRawChat({ id: 'ch1', contact_id: cId, contact_name: 'Alice' });
    const chat = getChat(rawDb, 'ch1');
    expect(chat).toBeDefined();
    expect(chat!.id).toBe('ch1');
  });
});

// ── Messages (direct module functions) ────────────────────────────

describe('saveMessage (module)', () => {
  it('saves a message and retrieves it', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    const msg = {
      id: 'm1', from: '111', to: '222', content: 'Hello',
      type: 'text' as const, timestamp: new Date('2025-06-01'), fromMe: true,
      metadata: { source: 'test' },
    };
    saveMessage(rawDb, msg, chId);
    const msgs = getMessages(rawDb, chId);
    expect(msgs.length).toBe(1);
    expect(msgs[0].id).toBe('m1');
    expect(msgs[0].content).toBe('Hello');
    expect(msgs[0].metadata).toEqual({ source: 'test' });
  });

  it('INSERT OR IGNORE skips duplicate message ids', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    const msg = {
      id: 'm1', from: '111', to: '222', content: 'First',
      type: 'text' as const, timestamp: new Date(), fromMe: true,
    };
    saveMessage(rawDb, msg, chId);
    saveMessage(rawDb, { ...msg, content: 'Second' }, chId);

    const msgs = getMessages(rawDb, chId);
    expect(msgs.length).toBe(1);
    expect(msgs[0].content).toBe('First');
  });

  it('saves message without metadata', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    const msg = {
      id: 'm1', from: '111', to: '222', content: 'Hi',
      type: 'text' as const, timestamp: new Date(), fromMe: false,
    };
    saveMessage(rawDb, msg, chId);
    const msgs = getMessages(rawDb, chId);
    expect(msgs[0].metadata).toEqual({});
  });
});

describe('messageExists (module)', () => {
  it('returns false for nonexistent message', () => {
    expect(messageExists(rawDb, 'nope')).toBe(false);
  });

  it('returns true for existing message', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    saveMessage(rawDb, {
      id: 'm1', from: '1', to: '2', content: 'x',
      type: 'text', timestamp: new Date(), fromMe: true,
    }, chId);
    expect(messageExists(rawDb, 'm1')).toBe(true);
  });
});

describe('getMessages (module)', () => {
  function seedMessages(chatId: string, count: number) {
    for (let i = 0; i < count; i++) {
      saveMessage(rawDb, {
        id: `m${i}`, from: '1', to: '2', content: `msg-${i}`,
        type: 'text', timestamp: new Date(2025, 0, 1, 0, 0, i), fromMe: i % 2 === 0,
      }, chatId);
    }
  }

  it('returns all messages with default limit', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    seedMessages(chId, 5);
    const msgs = getMessages(rawDb, chId);
    expect(msgs.length).toBe(5);
  });

  it('respects limit parameter', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    seedMessages(chId, 10);
    const msgs = getMessages(rawDb, chId, 3);
    expect(msgs.length).toBe(3);
  });

  it('respects offset parameter', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    seedMessages(chId, 5);
    const msgs = getMessages(rawDb, chId, 50, 3);
    expect(msgs.length).toBe(2);
    expect(msgs[0].id).toBe('m3');
  });

  it('returns empty for chat with no messages', () => {
    expect(getMessages(rawDb, 'nonexistent')).toEqual([]);
  });

  it('returns messages ordered by timestamp ASC', () => {
    const cId = insertRawContact({ id: 'c1' });
    const chId = insertRawChat({ id: 'ch1', contact_id: cId });
    seedMessages(chId, 3);
    const msgs = getMessages(rawDb, chId);
    expect(msgs[0].content).toBe('msg-0');
    expect(msgs[1].content).toBe('msg-1');
    expect(msgs[2].content).toBe('msg-2');
  });
});

// ── Broadcasts (direct module functions) ──────────────────────────

describe('createBroadcast (module)', () => {
  it('creates a broadcast and retrieves it', () => {
    const broadcast = {
      id: 'b1', content: 'Hello everyone', targetFilter: { tags: ['vip'] },
      status: 'pending' as const, totalContacts: 10, sentCount: 0,
      failedCount: 0, createdAt: now,
    };
    createBroadcast(rawDb, broadcast);
    const all = getAllBroadcasts(rawDb);
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('b1');
    expect(all[0].content).toBe('Hello everyone');
    expect(all[0].totalContacts).toBe(10);
    expect(all[0].targetFilter).toEqual({ tags: ['vip'] });
  });

  it('creates broadcast with default empty targetFilter', () => {
    createBroadcast(rawDb, {
      id: 'b2', content: 'Test', status: 'pending',
      totalContacts: 0, sentCount: 0, failedCount: 0, createdAt: now,
    });
    const all = getAllBroadcasts(rawDb);
    expect(all[0].targetFilter).toEqual({});
  });
});

describe('updateBroadcastStatus (module)', () => {
  it('updates status only', () => {
    const bId = insertRawBroadcast({ id: 'b1', status: 'pending' });
    updateBroadcastStatus(rawDb, bId, 'sending');
    const all = getAllBroadcasts(rawDb);
    expect(all[0].status).toBe('sending');
  });

  it('updates status with sentCount and failedCount', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    updateBroadcastStatus(rawDb, bId, 'sending', 5, 2);
    const all = getAllBroadcasts(rawDb);
    expect(all[0].status).toBe('sending');
    expect(all[0].sentCount).toBe(5);
    expect(all[0].failedCount).toBe(2);
  });

  it('sets completed_at when status is completed', () => {
    const bId = insertRawBroadcast({ id: 'b1', status: 'sending' });
    updateBroadcastStatus(rawDb, bId, 'completed', 10, 0);
    const all = getAllBroadcasts(rawDb);
    expect(all[0].status).toBe('completed');
    expect(all[0].completedAt).toBeInstanceOf(Date);
  });

  it('sets completed_at when status is cancelled', () => {
    const bId = insertRawBroadcast({ id: 'b1', status: 'sending' });
    updateBroadcastStatus(rawDb, bId, 'cancelled');
    const all = getAllBroadcasts(rawDb);
    expect(all[0].status).toBe('cancelled');
    expect(all[0].completedAt).toBeInstanceOf(Date);
  });

  it('does not set completed_at for other statuses', () => {
    const bId = insertRawBroadcast({ id: 'b1', status: 'pending' });
    updateBroadcastStatus(rawDb, bId, 'sending');
    const all = getAllBroadcasts(rawDb);
    expect(all[0].completedAt).toBeUndefined();
  });
});

describe('getAllBroadcasts (module)', () => {
  it('returns broadcasts ordered by created_at DESC', () => {
    insertRawBroadcast({ id: 'b1', created_at: '2025-01-01T00:00:00.000Z' });
    insertRawBroadcast({ id: 'b2', created_at: '2025-06-01T00:00:00.000Z' });
    const all = getAllBroadcasts(rawDb);
    expect(all[0].id).toBe('b2');
    expect(all[1].id).toBe('b1');
  });

  it('returns empty array when no broadcasts', () => {
    expect(getAllBroadcasts(rawDb)).toEqual([]);
  });
});

// ── Broadcast Recipients (direct module functions) ────────────────

describe('addBroadcastRecipient (module)', () => {
  it('adds a recipient', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'pending' });
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients.length).toBe(1);
    expect(recipients[0].contactId).toBe('c1');
    expect(recipients[0].status).toBe('pending');
  });

  it('INSERT OR IGNORE skips duplicate recipients', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'pending' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'sent' });
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients.length).toBe(1);
    expect(recipients[0].status).toBe('pending');
  });
});

describe('updateBroadcastRecipient (module)', () => {
  it('updates status', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'pending' });
    updateBroadcastRecipient(rawDb, bId, 'c1', 'sent');
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients[0].status).toBe('sent');
    expect(recipients[0].sentAt).toBeInstanceOf(Date);
  });

  it('updates status with error', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'pending' });
    updateBroadcastRecipient(rawDb, bId, 'c1', 'failed', 'network timeout');
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients[0].status).toBe('failed');
    expect(recipients[0].error).toBe('network timeout');
  });

  it('does not set sent_at for non-sent status', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'pending' });
    updateBroadcastRecipient(rawDb, bId, 'c1', 'failed');
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients[0].sentAt).toBeUndefined();
  });
});

describe('getBroadcastRecipients (module)', () => {
  it('returns recipients for a broadcast', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'sent' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c2', status: 'failed' });
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients.length).toBe(2);
  });

  it('returns empty for broadcast with no recipients', () => {
    expect(getBroadcastRecipients(rawDb, 'nonexistent')).toEqual([]);
  });

  it('does not return recipients for other broadcasts', () => {
    const b1 = insertRawBroadcast({ id: 'b1' });
    const b2 = insertRawBroadcast({ id: 'b2' });
    addBroadcastRecipient(rawDb, { broadcastId: b1, contactId: 'c1', status: 'sent' });
    addBroadcastRecipient(rawDb, { broadcastId: b2, contactId: 'c2', status: 'sent' });
    const recipients = getBroadcastRecipients(rawDb, b1);
    expect(recipients.length).toBe(1);
    expect(recipients[0].contactId).toBe('c1');
  });

  it('handles undefined error field', () => {
    const bId = insertRawBroadcast({ id: 'b1' });
    addBroadcastRecipient(rawDb, { broadcastId: bId, contactId: 'c1', status: 'sent' });
    const recipients = getBroadcastRecipients(rawDb, bId);
    expect(recipients[0].error).toBeUndefined();
  });
});

// ── Scheduled Messages (direct module functions) ──────────────────

function makeScheduled(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: overrides.id || randomUUID(),
    contactId: overrides.contactId || 'c1',
    contactName: overrides.contactName || 'Alice',
    content: overrides.content || 'Hello',
    scheduledAt: overrides.scheduledAt || new Date('2025-06-01T09:00:00Z'),
    repeat: overrides.repeat || 'none',
    status: overrides.status || 'pending',
    sentCount: overrides.sentCount ?? 0,
    failedCount: overrides.failedCount ?? 0,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
  };
}

describe('createScheduledMessage (module)', () => {
  it('creates a scheduled message and retrieves it', () => {
    const msg = makeScheduled({ id: 's1' });
    createScheduledMessage(rawDb, msg);
    const got = getScheduledMessage(rawDb, 's1');
    expect(got).toBeDefined();
    expect(got!.id).toBe('s1');
    expect(got!.content).toBe('Hello');
    expect(got!.repeat).toBe('none');
    expect(got!.status).toBe('pending');
  });

  it('sets next_run_at to scheduled_at on create', () => {
    const scheduledAt = new Date('2025-06-01T09:00:00Z');
    const msg = makeScheduled({ id: 's1', scheduledAt });
    createScheduledMessage(rawDb, msg);
    const got = getScheduledMessage(rawDb, 's1');
    expect(got!.nextRunAt).toEqual(scheduledAt);
  });
});

describe('getScheduledMessage (module)', () => {
  it('returns undefined for nonexistent id', () => {
    expect(getScheduledMessage(rawDb, 'nonexistent')).toBeUndefined();
  });

  it('returns the correct scheduled message', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1', content: 'Test' }));
    const got = getScheduledMessage(rawDb, 's1');
    expect(got!.content).toBe('Test');
  });
});

describe('getAllScheduledMessages (module)', () => {
  it('returns all scheduled messages ordered by scheduled_at ASC', () => {
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', scheduledAt: new Date('2025-06-02T09:00:00Z'),
    }));
    createScheduledMessage(rawDb, makeScheduled({
      id: 's2', scheduledAt: new Date('2025-06-01T09:00:00Z'),
    }));
    const all = getAllScheduledMessages(rawDb);
    expect(all.length).toBe(2);
    expect(all[0].id).toBe('s2');
    expect(all[1].id).toBe('s1');
  });

  it('returns empty array when none exist', () => {
    expect(getAllScheduledMessages(rawDb)).toEqual([]);
  });
});

describe('updateScheduledMessage (module)', () => {
  it('updates status', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { status: 'active' });
    expect(getScheduledMessage(rawDb, 's1')!.status).toBe('active');
  });

  it('updates content', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { content: 'Updated content' });
    expect(getScheduledMessage(rawDb, 's1')!.content).toBe('Updated content');
  });

  it('updates scheduledAt', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    const newDate = new Date('2025-12-25T00:00:00Z');
    updateScheduledMessage(rawDb, 's1', { scheduledAt: newDate });
    expect(getScheduledMessage(rawDb, 's1')!.scheduledAt).toEqual(newDate);
  });

  it('updates repeat', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { repeat: 'weekly' });
    expect(getScheduledMessage(rawDb, 's1')!.repeat).toBe('weekly');
  });

  it('updates contactId', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { contactId: 'c99' });
    expect(getScheduledMessage(rawDb, 's1')!.contactId).toBe('c99');
  });

  it('updates contactName', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { contactName: 'Bob' });
    expect(getScheduledMessage(rawDb, 's1')!.contactName).toBe('Bob');
  });

  it('updates nextRunAt to a date', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    const nextRun = new Date('2025-07-01T09:00:00Z');
    updateScheduledMessage(rawDb, 's1', { nextRunAt: nextRun });
    expect(getScheduledMessage(rawDb, 's1')!.nextRunAt).toEqual(nextRun);
  });

  it('updates nextRunAt to null', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { nextRunAt: null });
    expect(getScheduledMessage(rawDb, 's1')!.nextRunAt).toBeUndefined();
  });

  it('updates lastSentAt to a date', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    const sentAt = new Date('2025-06-01T09:00:00Z');
    updateScheduledMessage(rawDb, 's1', { lastSentAt: sentAt });
    expect(getScheduledMessage(rawDb, 's1')!.lastSentAt).toEqual(sentAt);
  });

  it('updates lastSentAt to null', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { lastSentAt: null });
    expect(getScheduledMessage(rawDb, 's1')!.lastSentAt).toBeUndefined();
  });

  it('updates sentCount', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { sentCount: 10 });
    expect(getScheduledMessage(rawDb, 's1')!.sentCount).toBe(10);
  });

  it('updates failedCount', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', { failedCount: 3 });
    expect(getScheduledMessage(rawDb, 's1')!.failedCount).toBe(3);
  });

  it('updates multiple fields at once', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    updateScheduledMessage(rawDb, 's1', {
      status: 'sent', content: 'New', sentCount: 5, failedCount: 1,
      nextRunAt: new Date('2025-08-01T00:00:00Z'),
    });
    const got = getScheduledMessage(rawDb, 's1');
    expect(got!.status).toBe('sent');
    expect(got!.content).toBe('New');
    expect(got!.sentCount).toBe(5);
    expect(got!.failedCount).toBe(1);
  });

  it('always updates updated_at', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    const before = getScheduledMessage(rawDb, 's1')!.updatedAt;
    updateScheduledMessage(rawDb, 's1', { sentCount: 1 });
    const after = getScheduledMessage(rawDb, 's1')!.updatedAt;
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });
});

describe('deleteScheduledMessage (module)', () => {
  it('deletes an existing scheduled message', () => {
    createScheduledMessage(rawDb, makeScheduled({ id: 's1' }));
    expect(getScheduledMessage(rawDb, 's1')).toBeDefined();
    deleteScheduledMessage(rawDb, 's1');
    expect(getScheduledMessage(rawDb, 's1')).toBeUndefined();
  });

  it('does not throw when deleting nonexistent id', () => {
    expect(() => deleteScheduledMessage(rawDb, 'nonexistent')).not.toThrow();
  });
});

describe('getDueScheduledMessages (module)', () => {
  it('returns pending messages with next_run_at in the past', () => {
    const past = new Date(Date.now() - 60_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'pending', nextRunAt: past,
      scheduledAt: past,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(1);
    expect(due[0].id).toBe('s1');
  });

  it('returns active messages with next_run_at in the past', () => {
    const past = new Date(Date.now() - 60_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'active', nextRunAt: past,
      scheduledAt: past,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(1);
  });

  it('does not return messages with future next_run_at', () => {
    const future = new Date(Date.now() + 3_600_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'pending', nextRunAt: future,
      scheduledAt: future,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(0);
  });

  it('does not return sent messages', () => {
    const past = new Date(Date.now() - 60_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'sent', nextRunAt: past,
      scheduledAt: past,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(0);
  });

  it('does not return failed messages', () => {
    const past = new Date(Date.now() - 60_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'failed', nextRunAt: past,
      scheduledAt: past,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(0);
  });

  it('does not return cancelled messages', () => {
    const past = new Date(Date.now() - 60_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'cancelled', nextRunAt: past,
      scheduledAt: past,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(0);
  });

  it('does not return messages with null next_run_at', () => {
    rawDb.prepare(`
      INSERT INTO scheduled_messages (id, contact_id, contact_name, content, scheduled_at, repeat, status, next_run_at, sent_count, failed_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('s1', 'c1', 'Alice', 'Test', now.toISOString(), 'none', 'pending', null, 0, 0, now.toISOString(), now.toISOString());
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(0);
  });

  it('returns multiple due messages ordered by next_run_at ASC', () => {
    const past1 = new Date(Date.now() - 120_000);
    const past2 = new Date(Date.now() - 60_000);
    createScheduledMessage(rawDb, makeScheduled({
      id: 's2', status: 'pending', nextRunAt: past2, scheduledAt: past2,
    }));
    createScheduledMessage(rawDb, makeScheduled({
      id: 's1', status: 'active', nextRunAt: past1, scheduledAt: past1,
    }));
    const due = getDueScheduledMessages(rawDb);
    expect(due.length).toBe(2);
    expect(due[0].id).toBe('s1');
    expect(due[1].id).toBe('s2');
  });
});

// ── Database Facade Methods ───────────────────────────────────────

describe('Database facade - messaging methods', () => {
  it('saveContact/getContact/getAllContacts/searchContacts', () => {
    db.saveContact({ id: 'c1', name: 'Alice', number: '111', isGroup: false, createdAt: now, updatedAt: now });
    db.saveContact({ id: 'c2', name: 'Bob', number: '222', isGroup: false, createdAt: now, updatedAt: now, pushName: 'Bobby' });

    expect(db.getContact('c1')!.name).toBe('Alice');
    expect(db.getAllContacts().length).toBe(2);
    expect(db.searchContacts('Bobby').length).toBe(1);
    expect(db.searchContacts('zzz').length).toBe(0);
  });

  it('saveChat/getChat/getAllChats', () => {
    db.saveContact({ id: 'c1', name: 'Alice', number: '111', isGroup: false, createdAt: now, updatedAt: now });
    db.saveChat({
      id: 'ch1', contactId: 'c1', contactName: 'Alice',
      lastMessage: 'Hi', lastMessageAt: now, unreadCount: 1, isGroup: false, createdAt: now,
    });
    expect(db.getChat('ch1')!.lastMessage).toBe('Hi');
    expect(db.getAllChats().length).toBe(1);
  });

  it('saveMessage/getMessages/messageExists', () => {
    db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false, createdAt: now, updatedAt: now });
    db.saveChat({ id: 'ch1', contactId: 'c1', contactName: 'A', unreadCount: 0, isGroup: false, createdAt: now });
    db.saveMessage({
      id: 'm1', from: '1', to: '2', content: 'test', type: 'text', timestamp: now, fromMe: true,
    }, 'ch1');
    expect(db.getMessages('ch1').length).toBe(1);
    expect(db.messageExists('m1')).toBe(true);
    expect(db.messageExists('nope')).toBe(false);
  });

  it('createBroadcast/updateBroadcastStatus/getAllBroadcasts', () => {
    db.createBroadcast({
      id: 'b1', content: 'Hi', status: 'pending', totalContacts: 5,
      sentCount: 0, failedCount: 0, createdAt: now,
    });
    expect(db.getAllBroadcasts().length).toBe(1);
    db.updateBroadcastStatus('b1', 'completed', 5, 0);
    expect(db.getAllBroadcasts()[0].status).toBe('completed');
  });

  it('addBroadcastRecipient/updateBroadcastRecipient/getBroadcastRecipients', () => {
    db.createBroadcast({
      id: 'b1', content: 'Hi', status: 'pending', totalContacts: 1,
      sentCount: 0, failedCount: 0, createdAt: now,
    });
    db.addBroadcastRecipient({ broadcastId: 'b1', contactId: 'c1', status: 'pending' });
    expect(db.getBroadcastRecipients('b1').length).toBe(1);
    db.updateBroadcastRecipient('b1', 'c1', 'sent');
    expect(db.getBroadcastRecipients('b1')[0].status).toBe('sent');
  });

  it('createScheduledMessage/updateScheduledMessage/deleteScheduledMessage/getScheduledMessage/getAllScheduledMessages/getDueScheduledMessages', () => {
    const past = new Date(Date.now() - 60_000);
    db.saveContact({ id: 'c1', name: 'A', number: '1', isGroup: false, createdAt: now, updatedAt: now });
    db.createScheduledMessage({
      id: 's1', contactId: 'c1', contactName: 'A', content: 'Remind',
      scheduledAt: past, repeat: 'none', status: 'pending',
      sentCount: 0, failedCount: 0, createdAt: now, updatedAt: now,
    });
    expect(db.getScheduledMessage('s1')!.content).toBe('Remind');
    expect(db.getAllScheduledMessages().length).toBe(1);
    expect(db.getDueScheduledMessages().length).toBe(1);

    db.updateScheduledMessage('s1', { status: 'sent', sentCount: 1 });
    expect(db.getScheduledMessage('s1')!.status).toBe('sent');

    db.deleteScheduledMessage('s1');
    expect(db.getScheduledMessage('s1')).toBeUndefined();
  });
});
