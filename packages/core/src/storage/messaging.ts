import type BetterSqlite3 from 'better-sqlite3';
import {
  Message,
  Contact,
  Chat,
  BroadcastMessage,
  BroadcastRecipient,
  ScheduledMessage,
  ScheduleRepeat,
  ScheduledMessageStatus
} from '../types.js';
import { getLogger } from '../utils/logger.js';

// ── Helper Row Converters ──────────────────────────────────────────

export function rowToContact(row: any): Contact {
  return {
    id: row.id,
    name: row.name,
    pushName: row.push_name || undefined,
    number: row.number,
    isGroup: row.is_group === 1,
    avatar: row.avatar || undefined,
    lastSeen: row.last_seen ? new Date(row.last_seen) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    tags: JSON.parse(row.tags || '[]'),
    notes: row.notes || undefined,
  };
}

export function rowToChat(row: any): Chat {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    lastMessage: row.last_message || undefined,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : undefined,
    unreadCount: row.unread_count,
    isGroup: row.is_group === 1,
    createdAt: new Date(row.created_at),
  };
}

export function rowToMessage(row: any): Message {
  return {
    id: row.id,
    from: row.from_jid,
    to: row.to_jid,
    content: row.content,
    type: row.message_type as Message['type'],
    timestamp: new Date(row.timestamp),
    fromMe: row.from_me === 1,
    metadata: JSON.parse(row.metadata || '{}'),
  };
}

export function rowToScheduled(row: any): ScheduledMessage {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    content: row.content,
    scheduledAt: new Date(row.scheduled_at),
    repeat: row.repeat as ScheduleRepeat,
    status: row.status as ScheduledMessageStatus,
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at) : undefined,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at) : undefined,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ── Contacts ──────────────────────────────────────────────────────

export function saveContact(db: BetterSqlite3.Database, contact: Contact): void {
  const stmt = db.prepare(`
    INSERT INTO contacts (id, name, push_name, number, is_group, avatar, last_seen, tags, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
      push_name = COALESCE(NULLIF(EXCLUDED.push_name, ''), contacts.push_name),
      avatar = COALESCE(EXCLUDED.avatar, contacts.avatar),
      last_seen = COALESCE(EXCLUDED.last_seen, contacts.last_seen),
      tags = COALESCE(EXCLUDED.tags, contacts.tags),
      notes = COALESCE(EXCLUDED.notes, contacts.notes),
      updated_at = datetime('now')
  `);
  stmt.run(
    contact.id, contact.name, contact.pushName || null,
    contact.number, contact.isGroup ? 1 : 0, contact.avatar || null,
    contact.lastSeen?.toISOString() || null,
    JSON.stringify(contact.tags || []), contact.notes || ''
  );
}

export function getContact(db: BetterSqlite3.Database, id: string): Contact | undefined {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) as any;
  return row ? rowToContact(row) : undefined;
}

export function getAllContacts(db: BetterSqlite3.Database): Contact[] {
  const rows = db.prepare('SELECT * FROM contacts ORDER BY updated_at DESC').all() as any[];
  return rows.map(rowToContact);
}

export function searchContacts(db: BetterSqlite3.Database, query: string): Contact[] {
  const rows = db.prepare(
    'SELECT * FROM contacts WHERE name LIKE ? OR number LIKE ? OR push_name LIKE ? ORDER BY updated_at DESC'
  ).all(`%${query}%`, `%${query}%`, `%${query}%`) as any[];
  return rows.map(rowToContact);
}

// ── Chats ─────────────────────────────────────────────────────

export function saveChat(db: BetterSqlite3.Database, chat: Chat): void {
  const stmt = db.prepare(`
    INSERT INTO chats (id, contact_id, contact_name, last_message, last_message_at, unread_count, is_group, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      contact_name = COALESCE(NULLIF(EXCLUDED.contact_name, ''), chats.contact_name),
      last_message = COALESCE(EXCLUDED.last_message, chats.last_message),
      last_message_at = COALESCE(EXCLUDED.last_message_at, chats.last_message_at),
      unread_count = EXCLUDED.unread_count,
      is_group = EXCLUDED.is_group
  `);
  stmt.run(
    chat.id, chat.contactId, chat.contactName,
    chat.lastMessage || null, chat.lastMessageAt?.toISOString() || null,
    chat.unreadCount, chat.isGroup ? 1 : 0,
    chat.createdAt.toISOString()
  );
}

export function getAllChats(db: BetterSqlite3.Database): Chat[] {
  const rows = db.prepare(
    'SELECT * FROM chats ORDER BY COALESCE(last_message_at, created_at) DESC'
  ).all() as any[];
  return rows.map(rowToChat);
}

export function getChat(db: BetterSqlite3.Database, id: string): Chat | undefined {
  const row = db.prepare('SELECT * FROM chats WHERE id = ?').get(id) as any;
  return row ? rowToChat(row) : undefined;
}

// ── Messages ──────────────────────────────────────────────────

export function saveMessage(db: BetterSqlite3.Database, msg: Message, chatId: string): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages (id, chat_id, from_jid, to_jid, content, message_type, from_me, timestamp, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    msg.id, chatId, msg.from, msg.to, msg.content,
    msg.type, msg.fromMe ? 1 : 0,
    msg.timestamp.toISOString(),
    JSON.stringify(msg.metadata || {})
  );
}

export function messageExists(db: BetterSqlite3.Database, id: string): boolean {
  const row = db.prepare('SELECT 1 FROM messages WHERE id = ?').get(id) as any;
  return !!row;
}

export function getMessages(db: BetterSqlite3.Database, chatId: string, limit = 50, offset = 0): Message[] {
  const rows = db.prepare(
    'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
  ).all(chatId, limit, offset) as any[];
  return rows.map(rowToMessage);
}

// ── Broadcasts ────────────────────────────────────────────────

export function createBroadcast(db: BetterSqlite3.Database, broadcast: BroadcastMessage): void {
  db.prepare(`
    INSERT INTO broadcasts (id, content, target_filter, status, total_contacts, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    broadcast.id, broadcast.content,
    JSON.stringify(broadcast.targetFilter || {}),
    broadcast.status, broadcast.totalContacts,
    broadcast.createdAt.toISOString()
  );
}

export function updateBroadcastStatus(db: BetterSqlite3.Database, id: string, status: string, sentCount?: number, failedCount?: number): void {
  const updates: string[] = ['status = ?'];
  const params: any[] = [status];

  if (sentCount !== undefined) {
    updates.push('sent_count = ?');
    params.push(sentCount);
  }
  if (failedCount !== undefined) {
    updates.push('failed_count = ?');
    params.push(failedCount);
  }
  if (status === 'completed' || status === 'cancelled') {
    updates.push('completed_at = datetime(\'now\')');
  }

  params.push(id);
  db.prepare(`UPDATE broadcasts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

export function getAllBroadcasts(db: BetterSqlite3.Database): BroadcastMessage[] {
  const rows = db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC').all() as any[];
  return rows.map(r => ({
    id: r.id,
    content: r.content,
    targetFilter: JSON.parse(r.target_filter || '{}'),
    status: r.status,
    totalContacts: r.total_contacts,
    sentCount: r.sent_count,
    failedCount: r.failed_count,
    createdAt: new Date(r.created_at),
    completedAt: r.completed_at ? new Date(r.completed_at) : undefined,
  }));
}

export function addBroadcastRecipient(db: BetterSqlite3.Database, recipient: BroadcastRecipient): void {
  db.prepare(`
    INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, contact_id, status)
    VALUES (?, ?, ?)
  `).run(recipient.broadcastId, recipient.contactId, recipient.status);
}

export function updateBroadcastRecipient(db: BetterSqlite3.Database, broadcastId: string, contactId: string, status: string, error?: string): void {
  const updates: string[] = ['status = ?'];
  const params: any[] = [status];
  if (error) {
    updates.push('error = ?');
    params.push(error);
  }
  if (status === 'sent') {
    updates.push('sent_at = datetime(\'now\')');
  }
  params.push(broadcastId, contactId);
  db.prepare(`UPDATE broadcast_recipients SET ${updates.join(', ')} WHERE broadcast_id = ? AND contact_id = ?`).run(...params);
}

export function getBroadcastRecipients(db: BetterSqlite3.Database, broadcastId: string): BroadcastRecipient[] {
  const rows = db.prepare(
    'SELECT * FROM broadcast_recipients WHERE broadcast_id = ?'
  ).all(broadcastId) as any[];
  return rows.map(r => ({
    broadcastId: r.broadcast_id,
    contactId: r.contact_id,
    status: r.status,
    error: r.error || undefined,
    sentAt: r.sent_at ? new Date(r.sent_at) : undefined,
  }));
}

// ── Scheduled Messages ───────────────────────────────────────

export function createScheduledMessage(db: BetterSqlite3.Database, msg: ScheduledMessage): void {
  db.prepare(`
    INSERT INTO scheduled_messages (id, contact_id, contact_name, content, scheduled_at, repeat, status, next_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id, msg.contactId, msg.contactName, msg.content,
    msg.scheduledAt.toISOString(), msg.repeat, msg.status,
    msg.scheduledAt.toISOString(), msg.createdAt.toISOString()
  );
  getLogger().info({ id: msg.id, contact: msg.contactName }, 'Scheduled message created');
}

export function updateScheduledMessage(db: BetterSqlite3.Database, id: string, updates: Partial<ScheduledMessage>): void {
  const fields: string[] = [];
  const params: any[] = [];

  if (updates.status) { fields.push('status = ?'); params.push(updates.status); }
  if (updates.content) { fields.push('content = ?'); params.push(updates.content); }
  if (updates.scheduledAt) { fields.push('scheduled_at = ?'); params.push(updates.scheduledAt.toISOString()); }
  if (updates.repeat) { fields.push('repeat = ?'); params.push(updates.repeat); }
  if (updates.contactId) { fields.push('contact_id = ?'); params.push(updates.contactId); }
  if (updates.contactName) { fields.push('contact_name = ?'); params.push(updates.contactName); }
  if (updates.nextRunAt !== undefined) {
    fields.push('next_run_at = ?');
    params.push(updates.nextRunAt ? updates.nextRunAt.toISOString() : null);
  }
  if (updates.lastSentAt !== undefined) {
    fields.push('last_sent_at = ?');
    params.push(updates.lastSentAt ? updates.lastSentAt.toISOString() : null);
  }
  if (updates.sentCount !== undefined) { fields.push('sent_count = ?'); params.push(updates.sentCount); }
  if (updates.failedCount !== undefined) { fields.push('failed_count = ?'); params.push(updates.failedCount); }

  fields.push("updated_at = datetime('now')");
  params.push(id);

  db.prepare(`UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteScheduledMessage(db: BetterSqlite3.Database, id: string): void {
  db.prepare('DELETE FROM scheduled_messages WHERE id = ?').run(id);
}

export function getScheduledMessage(db: BetterSqlite3.Database, id: string): ScheduledMessage | undefined {
  const row = db.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id) as any;
  return row ? rowToScheduled(row) : undefined;
}

export function getAllScheduledMessages(db: BetterSqlite3.Database): ScheduledMessage[] {
  const rows = db.prepare('SELECT * FROM scheduled_messages ORDER BY scheduled_at ASC').all() as any[];
  return rows.map(rowToScheduled);
}

export function getDueScheduledMessages(db: BetterSqlite3.Database): ScheduledMessage[] {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT * FROM scheduled_messages
     WHERE status IN ('pending', 'active')
     AND next_run_at IS NOT NULL
     AND next_run_at <= ?
     ORDER BY next_run_at ASC`
  ).all(now) as any[];
  return rows.map(rowToScheduled);
}
