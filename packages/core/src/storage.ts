import { Database as BunDatabase } from 'bun:sqlite';
import { join, dirname } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { Message, Contact, Chat, DailyStats, BroadcastMessage, BroadcastRecipient, ScheduledMessage, ScheduledMessageStatus, ScheduleRepeat, KnowledgeEntry, KnowledgeSearchResult } from './types.js';
import { getLogger } from './logger.js';
import { isEncryptionAvailable, getEncryptionKey, encryptFile, decryptFile } from './crypto.js';

export class Database {
  private db: BunDatabase;
  private dbPath: string;
  private encryptionKey: Buffer | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    const resolvedPath = join(process.cwd(), dbPath);
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Auto-decrypt DB file if encrypted and key is available
    const encPath = resolvedPath + '.encrypted';
    if (!existsSync(resolvedPath) && existsSync(encPath) && isEncryptionAvailable()) {
      const keyHex = getEncryptionKey()!;
      this.encryptionKey = Buffer.from(keyHex, 'hex');
      getLogger().info('Auto-decrypting database: %s → %s', encPath, resolvedPath);
      decryptFile(encPath, this.encryptionKey, true);
    } else if (existsSync(resolvedPath) && isEncryptionAvailable()) {
      this.encryptionKey = Buffer.from(getEncryptionKey()!, 'hex');
    }

    this.db = new BunDatabase(resolvedPath);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        push_name TEXT,
        number TEXT NOT NULL,
        is_group INTEGER NOT NULL DEFAULT 0,
        avatar TEXT,
        last_seen TEXT,
        tags TEXT DEFAULT '[]',
        notes TEXT DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        contact_name TEXT NOT NULL DEFAULT '',
        last_message TEXT,
        last_message_at TEXT,
        unread_count INTEGER NOT NULL DEFAULT 0,
        is_group INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (contact_id) REFERENCES contacts(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        from_jid TEXT NOT NULL,
        to_jid TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        message_type TEXT NOT NULL DEFAULT 'text',
        from_me INTEGER NOT NULL DEFAULT 0,
        timestamp TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY (chat_id) REFERENCES chats(id)
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (contact_id) REFERENCES contacts(id)
      );

      CREATE TABLE IF NOT EXISTS daily_stats (
        date TEXT NOT NULL,
        total_messages INTEGER NOT NULL DEFAULT 0,
        incoming_messages INTEGER NOT NULL DEFAULT 0,
        outgoing_messages INTEGER NOT NULL DEFAULT 0,
        unique_contacts INTEGER NOT NULL DEFAULT 0,
        ai_response_count INTEGER NOT NULL DEFAULT 0,
        avg_response_time REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (date)
      );

      CREATE TABLE IF NOT EXISTS broadcasts (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        target_filter TEXT DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        total_contacts INTEGER NOT NULL DEFAULT 0,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS broadcast_recipients (
        broadcast_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        sent_at TEXT,
        PRIMARY KEY (broadcast_id, contact_id),
        FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_conversations_contact ON conversations(contact_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        content TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        repeat TEXT NOT NULL DEFAULT 'none',
        status TEXT NOT NULL DEFAULT 'pending',
        last_sent_at TEXT,
        next_run_at TEXT,
        sent_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_status ON scheduled_messages(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_next_run ON scheduled_messages(next_run_at);

      CREATE TABLE IF NOT EXISTS knowledge_base (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL DEFAULT 'general',
        question TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base(category);
      CREATE INDEX IF NOT EXISTS idx_kb_priority ON knowledge_base(priority);

      CREATE TABLE IF NOT EXISTS kb_files (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_extension TEXT NOT NULL DEFAULT '',
        file_size INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'uploaded',
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        section_heading TEXT,
        row_number INTEGER,
        line_start INTEGER,
        line_end INTEGER,
        embedding TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (file_id) REFERENCES kb_files(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON kb_chunks(file_id);

      -- FTS5 full-text search index for knowledge base chunks
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
        content,
        section_heading,
        content='kb_chunks',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS index in sync
      CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
        INSERT INTO kb_chunks_fts(rowid, content, section_heading)
        VALUES (new.rowid, new.content, new.section_heading);
      END;

      CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
        INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, section_heading)
        VALUES('delete', old.rowid, old.content, old.section_heading);
      END;

      CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
        INSERT INTO kb_chunks_fts(kb_chunks_fts, rowid, content, section_heading)
        VALUES('delete', old.rowid, old.content, old.section_heading);
        INSERT INTO kb_chunks_fts(rowid, content, section_heading)
        VALUES (new.rowid, new.content, new.section_heading);
      END;

      -- Orders (real-time e-commerce)
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        order_number TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        items TEXT DEFAULT '[]',
        total_amount INTEGER DEFAULT 0,
        currency TEXT DEFAULT 'IDR',
        shipping_address TEXT,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (contact_id) REFERENCES contacts(id)
      );

      -- Products (catalog)
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        currency TEXT DEFAULT 'IDR',
        stock INTEGER DEFAULT 0,
        category TEXT DEFAULT 'general',
        sku TEXT,
        image_url TEXT,
        is_active INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Safe migration: add embedding column if it doesn't exist
    try {
      this.db.exec('ALTER TABLE knowledge_base ADD COLUMN embedding TEXT');
    } catch {
      // Column already exists or table doesn't exist — both are fine
    }

    // Rebuild FTS index for existing data
    this.rebuildFtsIndex();
  }

  /**
   * Rebuild FTS5 index from existing kb_chunks data.
   * Useful after schema migration or if index is corrupted.
   */
  rebuildFtsIndex(): void {
    try {
      this.db.exec("INSERT INTO kb_chunks_fts(kb_chunks_fts) VALUES('rebuild')");
      getLogger().info('FTS5 index rebuilt');
    } catch (err: any) {
      getLogger().warn({ error: err.message }, 'Failed to rebuild FTS5 index');
    }
  }

  // ── Contacts ──────────────────────────────────────────────────

  saveContact(contact: Contact): void {
    const stmt = this.db.query(`
      INSERT INTO contacts (id, name, push_name, number, is_group, avatar, last_seen, tags, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = COALESCE(NULLIF(EXCLUDED.name, ''), contacts.name),
        push_name = COALESCE(EXCLUDED.push_name, contacts.push_name),
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

  getContact(id: string): Contact | undefined {
    const row = this.db.query('SELECT * FROM contacts WHERE id = ?').get(id) as any;
    return row ? this.rowToContact(row) : undefined;
  }

  getAllContacts(): Contact[] {
    const rows = this.db.query('SELECT * FROM contacts ORDER BY updated_at DESC').all() as any[];
    return rows.map(this.rowToContact);
  }

  searchContacts(query: string): Contact[] {
    const rows = this.db.query(
      'SELECT * FROM contacts WHERE name LIKE ? OR number LIKE ? OR push_name LIKE ? ORDER BY updated_at DESC'
    ).all(`%${query}%`, `%${query}%`, `%${query}%`) as any[];
    return rows.map(this.rowToContact);
  }

  private rowToContact(row: any): Contact {
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

  // ── Chats ─────────────────────────────────────────────────────

  saveChat(chat: Chat): void {
    const stmt = this.db.query(`
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

  getAllChats(): Chat[] {
    const rows = this.db.query(
      'SELECT * FROM chats ORDER BY COALESCE(last_message_at, created_at) DESC'
    ).all() as any[];
    return rows.map(this.rowToChat);
  }

  getChat(id: string): Chat | undefined {
    const row = this.db.query('SELECT * FROM chats WHERE id = ?').get(id) as any;
    return row ? this.rowToChat(row) : undefined;
  }

  private rowToChat(row: any): Chat {
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

  // ── Messages ──────────────────────────────────────────────────

  saveMessage(msg: Message, chatId: string): void {
    const stmt = this.db.query(`
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

  /** Check if a message with this ID already exists in the database */
  messageExists(id: string): boolean {
    const row = this.db.query('SELECT 1 FROM messages WHERE id = ?').get(id) as any;
    return !!row;
  }

  getMessages(chatId: string, limit = 50, offset = 0): Message[] {
    const rows = this.db.query(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?'
    ).all(chatId, limit, offset) as any[];
    return rows.map(this.rowToMessage);
  }

  private rowToMessage(row: any): Message {
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

  // ── Conversation (AI Context) ─────────────────────────────────

  addConversation(contactId: string, role: string, content: string, tokenCount = 0): void {
    this.db.query(
      'INSERT INTO conversations (contact_id, role, content, token_count) VALUES (?, ?, ?, ?)'
    ).run(contactId, role, content, tokenCount);
  }

  getConversationHistory(contactId: string, limit = 30): { role: string; content: string }[] {
    const rows = this.db.query(
      'SELECT role, content FROM conversations WHERE contact_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(contactId, limit) as any[];
    return rows.map(r => ({ role: r.role, content: r.content }));
  }

  clearConversation(contactId: string): void {
    this.db.query('DELETE FROM conversations WHERE contact_id = ?').run(contactId);
  }

  /**
   * Find conversations that have been idle for more than the specified hours.
   * Returns contact IDs whose last message was before the cutoff.
   */
  getStaleConversationContacts(hours: number): string[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    // Find contacts whose most recent conversation entry is older than cutoff
    const rows = this.db.query(
      `SELECT contact_id FROM conversations
       GROUP BY contact_id
       HAVING MAX(created_at) < ?`
    ).all(cutoff) as any[];
    return rows.map(r => r.contact_id);
  }

  /**
   * Clear conversation history for contacts idle longer than specified hours.
   * Returns number of cleared contacts.
   */
  clearStaleConversations(hours: number): number {
    const contacts = this.getStaleConversationContacts(hours);
    for (const contactId of contacts) {
      this.clearConversation(contactId);
    }
    if (contacts.length > 0) {
      getLogger().info('Cleared stale conversations for %d contacts (idle > %dh)', contacts.length, hours);
    }
    return contacts.length;
  }

  trimConversation(contactId: string, maxEntries = 60): void {
    const count = this.db.query(
      'SELECT COUNT(*) as count FROM conversations WHERE contact_id = ?'
    ).get(contactId) as any;

    if (count.count > maxEntries) {
      const excess = count.count - maxEntries;
      this.db.query(`
        DELETE FROM conversations WHERE contact_id = ? AND created_at IN (
          SELECT created_at FROM conversations WHERE contact_id = ? ORDER BY created_at ASC LIMIT ?
        )
      `).run(contactId, contactId, excess);
    }
  }

  // ── Stats ─────────────────────────────────────────────────────

  incrementMessageCount(type: 'incoming' | 'outgoing'): void {
    const today = new Date().toISOString().split('T')[0];
    this.db.query(`
      INSERT INTO daily_stats (date, total_messages, incoming_messages, outgoing_messages, unique_contacts, ai_response_count, avg_response_time)
      VALUES (?, 1, ?, ?, 0, 0, 0)
      ON CONFLICT(date) DO UPDATE SET
        total_messages = total_messages + 1,
        incoming_messages = incoming_messages + ?,
        outgoing_messages = outgoing_messages + ?
    `).run(today, type === 'incoming' ? 1 : 0, type === 'outgoing' ? 1 : 0,
      type === 'incoming' ? 1 : 0, type === 'outgoing' ? 1 : 0);
  }

  getStats(days = 7): DailyStats[] {
    const rows = this.db.query(
      'SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?'
    ).all(days) as any[];
    return rows.map(r => ({
      date: r.date,
      totalMessages: r.total_messages,
      incomingMessages: r.incoming_messages,
      outgoingMessages: r.outgoing_messages,
      uniqueContacts: r.unique_contacts,
      aiResponseCount: r.ai_response_count,
      averageResponseTime: r.avg_response_time,
    }));
  }

  /**
   * Get top contacts by message count
   */
  getTopContactsByMessageCount(limit = 5): { name: string; messages: number }[] {
    const rows = this.db.query(`
      SELECT c.contact_name AS name, COUNT(m.id) AS messages
      FROM messages m
      JOIN chats c ON m.chat_id = c.id
      GROUP BY m.chat_id
      ORDER BY messages DESC
      LIMIT ?
    `).all(limit) as any[];
    return rows.map(r => ({ name: r.name, messages: r.messages }));
  }

  // ── Broadcasts ────────────────────────────────────────────────

  createBroadcast(broadcast: BroadcastMessage): void {
    this.db.query(`
      INSERT INTO broadcasts (id, content, target_filter, status, total_contacts, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      broadcast.id, broadcast.content,
      JSON.stringify(broadcast.targetFilter || {}),
      broadcast.status, broadcast.totalContacts,
      broadcast.createdAt.toISOString()
    );
  }

  updateBroadcastStatus(id: string, status: string, sentCount?: number, failedCount?: number): void {
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
    this.db.query(`UPDATE broadcasts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  getAllBroadcasts(): BroadcastMessage[] {
    const rows = this.db.query('SELECT * FROM broadcasts ORDER BY created_at DESC').all() as any[];
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

  addBroadcastRecipient(recipient: BroadcastRecipient): void {
    this.db.query(`
      INSERT OR IGNORE INTO broadcast_recipients (broadcast_id, contact_id, status)
      VALUES (?, ?, ?)
    `).run(recipient.broadcastId, recipient.contactId, recipient.status);
  }

  updateBroadcastRecipient(broadcastId: string, contactId: string, status: string, error?: string): void {
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
    this.db.query(`UPDATE broadcast_recipients SET ${updates.join(', ')} WHERE broadcast_id = ? AND contact_id = ?`).run(...params);
  }

  getBroadcastRecipients(broadcastId: string): BroadcastRecipient[] {
    const rows = this.db.query(
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

  createScheduledMessage(msg: ScheduledMessage): void {
    this.db.query(`
      INSERT INTO scheduled_messages (id, contact_id, contact_name, content, scheduled_at, repeat, status, next_run_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.id, msg.contactId, msg.contactName, msg.content,
      msg.scheduledAt.toISOString(), msg.repeat, msg.status,
      msg.scheduledAt.toISOString(), msg.createdAt.toISOString()
    );
    getLogger().info({ id: msg.id, contact: msg.contactName }, 'Scheduled message created');
  }

  updateScheduledMessage(id: string, updates: Partial<ScheduledMessage>): void {
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

    this.db.query(`UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteScheduledMessage(id: string): void {
    this.db.query('DELETE FROM scheduled_messages WHERE id = ?').run(id);
  }

  getScheduledMessage(id: string): ScheduledMessage | undefined {
    const row = this.db.query('SELECT * FROM scheduled_messages WHERE id = ?').get(id) as any;
    return row ? this.rowToScheduled(row) : undefined;
  }

  getAllScheduledMessages(): ScheduledMessage[] {
    const rows = this.db.query('SELECT * FROM scheduled_messages ORDER BY scheduled_at ASC').all() as any[];
    return rows.map(this.rowToScheduled);
  }

  getDueScheduledMessages(): ScheduledMessage[] {
    const now = new Date().toISOString();
    const rows = this.db.query(
      `SELECT * FROM scheduled_messages
       WHERE status IN ('pending', 'active')
       AND next_run_at IS NOT NULL
       AND next_run_at <= ?
       ORDER BY next_run_at ASC`
    ).all(now) as any[];
    return rows.map(this.rowToScheduled);
  }

  private rowToScheduled(row: any): ScheduledMessage {
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

  // ── Knowledge Base ────────────────────────────────────────────

  createKnowledgeEntry(entry: KnowledgeEntry): void {
    this.db.query(`
      INSERT INTO knowledge_base (id, category, question, answer, keywords, tags, priority, embedding, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id, entry.category, entry.question, entry.answer,
      JSON.stringify(entry.keywords), JSON.stringify(entry.tags),
      entry.priority,
      entry.embedding ? JSON.stringify(entry.embedding) : null,
      entry.createdAt.toISOString(), entry.updatedAt.toISOString()
    );
  }

  getKnowledgeEntry(id: string): KnowledgeEntry | undefined {
    const row = this.db.query('SELECT * FROM knowledge_base WHERE id = ?').get(id) as any;
    return row ? this.rowToKnowledgeEntry(row) : undefined;
  }

  getAllKnowledgeEntries(category?: string): KnowledgeEntry[] {
    let rows: any[];
    if (category) {
      rows = this.db.query(
        'SELECT * FROM knowledge_base WHERE category = ? ORDER BY priority DESC, created_at DESC'
      ).all(category) as any[];
    } else {
      rows = this.db.query(
        'SELECT * FROM knowledge_base ORDER BY priority DESC, created_at DESC'
      ).all() as any[];
    }
    return rows.map(r => this.rowToKnowledgeEntry(r));
  }

  /**
   * Search knowledge base using keyword matching (original method,
   * kept as fallback when embeddings are not available).
   */
  searchKnowledge(query: string, maxResults = 5): KnowledgeSearchResult[] {
    const results: KnowledgeSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

    const allEntries = this.db.query(
      'SELECT * FROM knowledge_base ORDER BY priority DESC'
    ).all() as any[];

    for (const row of allEntries) {
      const entry = this.rowToKnowledgeEntry(row);
      let bestScore = 0;
      let matchedOn: 'keyword' | 'question' | 'answer' = 'keyword';

      // Score based on keyword matches (highest weight)
      const entryKeywords = entry.keywords.map(k => k.toLowerCase());
      const keywordMatches = entryKeywords.filter(k =>
        queryWords.some(qw => k.includes(qw) || qw.includes(k))
      ).length;
      if (keywordMatches > 0) {
        const score = keywordMatches / Math.max(entryKeywords.length, 1);
        if (score > bestScore) {
          bestScore = score;
          matchedOn = 'keyword';
        }
      }

      // Score based on question match
      const questionLower = entry.question.toLowerCase();
      const questionWordMatches = queryWords.filter(qw => questionLower.includes(qw)).length;
      if (questionWordMatches > 0) {
        const score = questionWordMatches / Math.max(queryWords.length, 1) * 0.8;
        if (score > bestScore) {
          bestScore = score;
          matchedOn = 'question';
        }
      }

      // Score based on answer match (lowest weight)
      const answerLower = entry.answer.toLowerCase();
      const answerWordMatches = queryWords.filter(qw => answerLower.includes(qw)).length;
      if (answerWordMatches > 0) {
        const score = answerWordMatches / Math.max(queryWords.length, 1) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          matchedOn = 'answer';
        }
      }

      // Boost priority entries
      if (entry.priority > 0) {
        bestScore = bestScore * (1 + entry.priority * 0.1);
      }

      if (bestScore > 0) {
        results.push({ entry, score: Math.min(bestScore, 1), matchedOn });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Semantic search using embedding vectors.
   * Computes cosine similarity between query embedding and stored embeddings.
   * Falls back to keyword search if no embeddings found in DB.
   *
   * @param queryEmbedding - The query embedding vector (768-dim float array)
   * @param maxResults - Max results to return
   * @param minScore - Minimum cosine similarity threshold (0-1)
   */
  searchKnowledgeSemantic(
    queryEmbedding: number[],
    maxResults = 5,
    minScore = 0.3,
  ): KnowledgeSearchResult[] {
    const results: KnowledgeSearchResult[] = [];

    const allEntries = this.db.query(
      'SELECT id, embedding FROM knowledge_base WHERE embedding IS NOT NULL'
    ).all() as any[];

    // Fall back to keyword search if no entries have embeddings
    if (allEntries.length === 0) {
      return [];
    }

    for (const row of allEntries) {
      const storedEmbedding: number[] = JSON.parse(row.embedding);
      if (!Array.isArray(storedEmbedding) || storedEmbedding.length === 0) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding);

      if (similarity >= minScore) {
        const entry = this.getKnowledgeEntry(row.id);
        if (entry) {
          results.push({ entry, score: similarity, matchedOn: 'semantic' });
        }
      }
    }

    // Sort by similarity descending (higher = more relevant)
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Compute cosine similarity between two embedding vectors.
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Update or set the embedding vector for a knowledge entry.
   */
  setKnowledgeEmbedding(id: string, embedding: number[]): void {
    this.db.query('UPDATE knowledge_base SET embedding = ? WHERE id = ?')
      .run(JSON.stringify(embedding), id);
  }

  /**
   * Get all knowledge entries that don't have an embedding vector yet.
   * Useful for batch-embedding existing entries after migration.
   */
  getKnowledgeEntriesWithoutEmbedding(): KnowledgeEntry[] {
    const rows = this.db.query(
      'SELECT * FROM knowledge_base WHERE embedding IS NULL'
    ).all() as any[];
    return rows.map(r => this.rowToKnowledgeEntry(r));
  }

  updateKnowledgeEntry(id: string, updates: Partial<KnowledgeEntry>): void {
    const fields: string[] = [];
    const params: any[] = [];

    if (updates.category !== undefined) { fields.push('category = ?'); params.push(updates.category); }
    if (updates.question !== undefined) { fields.push('question = ?'); params.push(updates.question); }
    if (updates.answer !== undefined) { fields.push('answer = ?'); params.push(updates.answer); }
    if (updates.keywords !== undefined) { fields.push('keywords = ?'); params.push(JSON.stringify(updates.keywords)); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); params.push(updates.priority); }
    if (updates.embedding !== undefined) { fields.push('embedding = ?'); params.push(JSON.stringify(updates.embedding)); }

    fields.push("updated_at = datetime('now')");
    params.push(id);

    if (fields.length > 1) {
      this.db.query(`UPDATE knowledge_base SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }
  }

  deleteKnowledgeEntry(id: string): void {
    this.db.query('DELETE FROM knowledge_base WHERE id = ?').run(id);
  }

  getKnowledgeCategories(): string[] {
    const rows = this.db.query(
      'SELECT DISTINCT category FROM knowledge_base ORDER BY category'
    ).all() as any[];
    return rows.map(r => r.category);
  }

  getKnowledgeCount(): number {
    const row = this.db.query('SELECT COUNT(*) as count FROM knowledge_base').get() as any;
    return row.count;
  }

  // ── KB Files (Flexible RAG) ──────────────────────────────────

  createKbFile(file: { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status?: string }): void {
    this.db.query(`
      INSERT INTO kb_files (id, file_name, file_path, file_extension, file_size, chunk_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(file.id, file.fileName, file.filePath, file.fileExtension, file.fileSize, file.chunkCount, file.status || 'uploaded');
  }

  updateKbFileStatus(id: string, status: string, error?: string): void {
    const fields = ['status = ?', "updated_at = datetime('now')"];
    const params: any[] = [status];
    if (error !== undefined) { fields.push('error = ?'); params.push(error); }
    params.push(id);
    this.db.query(`UPDATE kb_files SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  getKbFile(id: string): { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string; error?: string; createdAt: Date; updatedAt: Date } | undefined {
    const row = this.db.query('SELECT * FROM kb_files WHERE id = ?').get(id) as any;
    return row ? {
      id: row.id,
      fileName: row.file_name,
      filePath: row.file_path,
      fileExtension: row.file_extension,
      fileSize: row.file_size,
      chunkCount: row.chunk_count,
      status: row.status,
      error: row.error || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    } : undefined;
  }

  getKbFileByName(fileName: string): { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string } | undefined {
    const row = this.db.query('SELECT * FROM kb_files WHERE file_name = ?').get(fileName) as any;
    return row ? {
      id: row.id,
      fileName: row.file_name,
      filePath: row.file_path,
      fileExtension: row.file_extension,
      fileSize: row.file_size,
      chunkCount: row.chunk_count,
      status: row.status,
    } : undefined;
  }

  getAllKbFiles(): Array<{ id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string; createdAt: Date }> {
    const rows = this.db.query('SELECT * FROM kb_files ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      fileName: r.file_name,
      filePath: r.file_path,
      fileExtension: r.file_extension,
      fileSize: r.file_size,
      chunkCount: r.chunk_count,
      status: r.status,
      createdAt: new Date(r.created_at),
    }));
  }

  deleteKbFile(id: string): void {
    // Cascading delete will remove associated chunks
    this.db.query('DELETE FROM kb_files WHERE id = ?').run(id);
  }

  // ── KB Chunks ────────────────────────────────────────────────

  createKbChunk(chunk: { id: string; fileId: string; chunkIndex: number; content: string; sectionHeading?: string; rowNumber?: number; lineStart?: number; lineEnd?: number; embedding?: number[] }): void {
    this.db.query(`
      INSERT INTO kb_chunks (id, file_id, chunk_index, content, section_heading, row_number, line_start, line_end, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      chunk.id, chunk.fileId, chunk.chunkIndex, chunk.content,
      chunk.sectionHeading || null, chunk.rowNumber || null,
      chunk.lineStart || null, chunk.lineEnd || null,
      chunk.embedding ? JSON.stringify(chunk.embedding) : null,
    );
  }

  setKbChunkEmbedding(id: string, embedding: number[]): void {
    this.db.query('UPDATE kb_chunks SET embedding = ? WHERE id = ?')
      .run(JSON.stringify(embedding), id);
  }

  getKbChunksByFileId(fileId: string): Array<{ id: string; fileId: string; chunkIndex: number; content: string; sectionHeading?: string; embedding?: number[] }> {
    const rows = this.db.query('SELECT * FROM kb_chunks WHERE file_id = ? ORDER BY chunk_index').all(fileId) as any[];
    return rows.map(r => ({
      id: r.id,
      fileId: r.file_id,
      chunkIndex: r.chunk_index,
      content: r.content,
      sectionHeading: r.section_heading || undefined,
      embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
    }));
  }

  getKbChunksWithoutEmbedding(): Array<{ id: string; fileId: string; content: string }> {
    const rows = this.db.query('SELECT id, file_id, content FROM kb_chunks WHERE embedding IS NULL').all() as any[];
    return rows.map(r => ({ id: r.id, fileId: r.file_id, content: r.content }));
  }

  /**
   * Semantic search across KB chunks (vector similarity).
   */
  searchKbChunksSemantic(queryEmbedding: number[], maxResults = 5, minScore = 0.3): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
    const results: Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> = [];

    const rows = this.db.query(
      `SELECT c.id, c.file_id, c.content, c.section_heading, c.embedding, f.file_name
       FROM kb_chunks c
       LEFT JOIN kb_files f ON c.file_id = f.id
       WHERE c.embedding IS NOT NULL`
    ).all() as any[];

    if (rows.length === 0) return results;

    for (const row of rows) {
      const storedEmbedding: number[] = JSON.parse(row.embedding);
      if (!Array.isArray(storedEmbedding) || storedEmbedding.length === 0) continue;

      const similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding);
      if (similarity >= minScore) {
        results.push({
          chunkId: row.id,
          fileId: row.file_id,
          content: row.content,
          sectionHeading: row.section_heading || undefined,
          score: similarity,
          fileName: row.file_name || undefined,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Keyword search across KB chunks using FTS5 with BM25 ranking.
   */
  searchKbChunksKeyword(query: string, maxResults = 5): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
    const results: Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> = [];
    
    // Clean query for FTS5: escape special characters, join with AND
    const queryWords = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);
    
    if (queryWords.length === 0) return results;

    const ftsQuery = queryWords.join(' AND ');

    try {
      const rows = this.db.query(`
        SELECT 
          fts.rowid,
          fts.rank,
          c.id,
          c.file_id,
          c.content,
          c.section_heading,
          f.file_name
        FROM kb_chunks_fts fts
        JOIN kb_chunks c ON c.rowid = fts.rowid
        LEFT JOIN kb_files f ON c.file_id = f.id
        WHERE kb_chunks_fts MATCH ?
        ORDER BY fts.rank
        LIMIT ?
      `).all(ftsQuery, maxResults) as any[];

      for (const row of rows) {
        // BM25 rank is negative (lower = better), normalize to 0-1 score
        const score = Math.min(1, Math.max(0, 1 + row.rank / 10));
        results.push({
          chunkId: row.id,
          fileId: row.file_id,
          content: row.content,
          sectionHeading: row.section_heading || undefined,
          score,
          fileName: row.file_name || undefined,
        });
      }
    } catch (err: any) {
      // Fallback to simple substring search if FTS fails
      getLogger().warn({ error: err.message }, 'FTS5 search failed, falling back to substring');
      return this.searchKbChunksKeywordFallback(query, maxResults);
    }

    return results;
  }

  /**
   * Fallback keyword search using simple substring matching.
   */
  private searchKbChunksKeywordFallback(query: string, maxResults: number): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
    const results: Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> = [];
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);

    if (queryWords.length === 0) return results;

    const rows = this.db.query(
      `SELECT c.id, c.file_id, c.content, c.section_heading, f.file_name
       FROM kb_chunks c
       LEFT JOIN kb_files f ON c.file_id = f.id`
    ).all() as any[];

    for (const row of rows) {
      const contentLower = row.content.toLowerCase();
      let matches = 0;

      for (const word of queryWords) {
        if (contentLower.includes(word)) matches++;
      }

      if (matches > 0) {
        const score = matches / queryWords.length;
        results.push({
          chunkId: row.id,
          fileId: row.file_id,
          content: row.content,
          sectionHeading: row.section_heading || undefined,
          score,
          fileName: row.file_name || undefined,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Combined semantic + keyword search across KB chunks.
   * Merges results from both methods with weighted scoring.
   */
  searchKbChunks(
    query: string,
    queryEmbedding: number[] | null,
    maxResults = 5,
    minScore = 0.3,
  ): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; matchedOn: 'semantic' | 'keyword' | 'combined'; fileName?: string }> {
    const resultMap = new Map<string, { chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; matchedOn: 'semantic' | 'keyword' | 'combined'; fileName?: string }>();

    // Semantic results (weight: 0.7)
    if (queryEmbedding) {
      const semanticResults = this.searchKbChunksSemantic(queryEmbedding, maxResults * 2, minScore);
      for (const r of semanticResults) {
        resultMap.set(r.chunkId, {
          ...r,
          score: r.score * 0.7,
          matchedOn: 'semantic',
        });
      }
    }

    // Keyword results (weight: 0.3)
    const keywordResults = this.searchKbChunksKeyword(query, maxResults * 2);
    for (const r of keywordResults) {
      const existing = resultMap.get(r.chunkId);
      if (existing) {
        existing.score += r.score * 0.3;
        existing.matchedOn = 'combined';
      } else {
        resultMap.set(r.chunkId, {
          ...r,
          score: r.score * 0.3,
          matchedOn: 'keyword',
        });
      }
    }

    return Array.from(resultMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  getKbChunkCount(): number {
    const row = this.db.query('SELECT COUNT(*) as count FROM kb_chunks').get() as any;
    return row.count;
  }

  private rowToKnowledgeEntry(row: any): KnowledgeEntry {
    return {
      id: row.id,
      category: row.category,
      question: row.question,
      answer: row.answer,
      keywords: JSON.parse(row.keywords || '[]'),
      tags: JSON.parse(row.tags || '[]'),
      priority: row.priority,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // ── Orders ───────────────────────────────────────────────────

  saveOrder(order: { id: string; contactId: string; orderNumber: string; status?: string; items?: any[]; totalAmount?: number; currency?: string; shippingAddress?: string; notes?: string }): void {
    this.db.query(`
      INSERT INTO orders (id, contact_id, order_number, status, items, total_amount, currency, shipping_address, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        items = excluded.items,
        total_amount = excluded.total_amount,
        shipping_address = excluded.shipping_address,
        notes = excluded.notes,
        updated_at = datetime('now')
    `).run(
      order.id,
      order.contactId,
      order.orderNumber,
      order.status || 'pending',
      JSON.stringify(order.items || []),
      order.totalAmount || 0,
      order.currency || 'IDR',
      order.shippingAddress || '',
      order.notes || '',
    );
  }

  getOrder(id: string): any | null {
    const row = this.db.query('SELECT * FROM orders WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      contactId: row.contact_id,
      orderNumber: row.order_number,
      status: row.status,
      items: JSON.parse(row.items || '[]'),
      totalAmount: row.total_amount,
      currency: row.currency,
      shippingAddress: row.shipping_address,
      notes: row.notes,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  getOrdersByContact(contactId: string, limit = 10): any[] {
    const rows = this.db.query(
      'SELECT * FROM orders WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(contactId, limit) as any[];
    return rows.map(r => ({
      id: r.id,
      contactId: r.contact_id,
      orderNumber: r.order_number,
      status: r.status,
      items: JSON.parse(r.items || '[]'),
      totalAmount: r.total_amount,
      currency: r.currency,
      shippingAddress: r.shipping_address,
      notes: r.notes,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
    }));
  }

  updateOrderStatus(id: string, status: string): void {
    this.db.query('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
  }

  searchOrders(query: string, limit = 10): any[] {
    const rows = this.db.query(
      `SELECT * FROM orders
       WHERE order_number LIKE ? OR notes LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    ).all(`%${query}%`, `%${query}%`, limit) as any[];
    return rows.map(r => ({
      id: r.id,
      contactId: r.contact_id,
      orderNumber: r.order_number,
      status: r.status,
      items: JSON.parse(r.items || '[]'),
      totalAmount: r.total_amount,
      currency: r.currency,
      createdAt: new Date(r.created_at),
    }));
  }

  // ── Products ─────────────────────────────────────────────────

  saveProduct(product: { id: string; name: string; description?: string; price: number; currency?: string; stock?: number; category?: string; sku?: string; imageUrl?: string; isActive?: boolean; metadata?: any }): void {
    this.db.query(`
      INSERT INTO products (id, name, description, price, currency, stock, category, sku, image_url, is_active, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        price = excluded.price,
        stock = excluded.stock,
        category = excluded.category,
        sku = excluded.sku,
        image_url = excluded.image_url,
        is_active = excluded.is_active,
        metadata = excluded.metadata,
        updated_at = datetime('now')
    `).run(
      product.id,
      product.name,
      product.description || '',
      product.price,
      product.currency || 'IDR',
      product.stock || 0,
      product.category || 'general',
      product.sku || null,
      product.imageUrl || null,
      product.isActive !== false ? 1 : 0,
      JSON.stringify(product.metadata || {}),
    );
  }

  getProduct(id: string): any | null {
    const row = this.db.query('SELECT * FROM products WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToProduct(row);
  }

  getProductsByCategory(category: string, limit = 50): any[] {
    const rows = this.db.query(
      'SELECT * FROM products WHERE category = ? AND is_active = 1 ORDER BY name LIMIT ?'
    ).all(category, limit) as any[];
    return rows.map(r => this.rowToProduct(r));
  }

  searchProducts(query: string, limit = 10): any[] {
    const rows = this.db.query(
      `SELECT * FROM products
       WHERE is_active = 1 AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)
       ORDER BY name LIMIT ?`
    ).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
    return rows.map(r => this.rowToProduct(r));
  }

  updateProductStock(id: string, stock: number): void {
    this.db.query('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?').run(stock, id);
  }

  private rowToProduct(row: any): any {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      price: row.price,
      currency: row.currency,
      stock: row.stock,
      category: row.category,
      sku: row.sku,
      imageUrl: row.image_url,
      isActive: row.is_active === 1,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  close(): void {
    this.db.close();

    // Auto-encrypt DB file after close if encryption key is available
    if (this.encryptionKey) {
      const resolvedPath = join(process.cwd(), this.dbPath);
      if (existsSync(resolvedPath)) {
        getLogger().info('Encrypting database at rest: %s', resolvedPath);
        encryptFile(resolvedPath, this.encryptionKey, true);
      }
    }
  }

  /**
   * Get the encryption key buffer (for use by Database wrapper)
   */
  getEncryptionKey(): Buffer | null {
    return this.encryptionKey;
  }
}
