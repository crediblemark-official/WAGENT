import BetterSqlite3 from 'better-sqlite3';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  Message,
  Contact,
  Chat,
  DailyStats,
  BroadcastMessage,
  BroadcastRecipient,
  ScheduledMessage,
  KnowledgeEntry,
  KnowledgeSearchResult
} from '../types.js';
import { getLogger } from '../utils/logger.js';
import { isEncryptionAvailable, getEncryptionKey, decryptFile, encryptFile } from '../utils/crypto.js';

// Impor sub-modul fungsional
import * as messaging from './messaging.js';
import * as knowledge from './knowledge.js';
import * as commerce from './commerce.js';

export class Database {
  private db: BetterSqlite3.Database;
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

    this.db = new BetterSqlite3(resolvedPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
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

      -- Payments
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        order_id TEXT,
        contact_id TEXT,
        amount INTEGER NOT NULL DEFAULT 0,
        method TEXT DEFAULT 'unknown',
        proof TEXT DEFAULT '',
        recorded_by TEXT DEFAULT 'system',
        status TEXT DEFAULT 'recorded',
        created_at TEXT DEFAULT (datetime('now'))
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
    messaging.saveContact(this.db, contact);
  }

  getContact(id: string): Contact | undefined {
    return messaging.getContact(this.db, id);
  }

  getAllContacts(): Contact[] {
    return messaging.getAllContacts(this.db);
  }

  searchContacts(query: string): Contact[] {
    return messaging.searchContacts(this.db, query);
  }

  // ── Chats ─────────────────────────────────────────────────────

  saveChat(chat: Chat): void {
    messaging.saveChat(this.db, chat);
  }

  getAllChats(): Chat[] {
    return messaging.getAllChats(this.db);
  }

  getChat(id: string): Chat | undefined {
    return messaging.getChat(this.db, id);
  }

  // ── Messages ──────────────────────────────────────────────────

  saveMessage(msg: Message, chatId: string): void {
    messaging.saveMessage(this.db, msg, chatId);
  }

  messageExists(id: string): boolean {
    return messaging.messageExists(this.db, id);
  }

  getMessages(chatId: string, limit = 50, offset = 0): Message[] {
    return messaging.getMessages(this.db, chatId, limit, offset);
  }

  // ── Conversation (AI Context) ─────────────────────────────────

  addConversation(contactId: string, role: string, content: string, tokenCount = 0): void {
    commerce.addConversation(this.db, contactId, role, content, tokenCount);
  }

  getConversationHistory(contactId: string, limit = 30): { role: string; content: string }[] {
    return commerce.getConversationHistory(this.db, contactId, limit);
  }

  clearConversation(contactId: string): void {
    commerce.clearConversation(this.db, contactId);
  }

  getStaleConversationContacts(hours: number): string[] {
    return commerce.getStaleConversationContacts(this.db, hours);
  }

  clearStaleConversations(hours: number): number {
    return commerce.clearStaleConversations(this.db, hours);
  }

  trimConversation(contactId: string, maxEntries = 60): void {
    commerce.trimConversation(this.db, contactId, maxEntries);
  }

  // ── Stats ─────────────────────────────────────────────────────

  incrementMessageCount(type: 'incoming' | 'outgoing'): void {
    commerce.incrementMessageCount(this.db, type);
  }

  getStats(days = 7): DailyStats[] {
    return commerce.getStats(this.db, days);
  }

  getTopContactsByMessageCount(limit = 5): { name: string; messages: number }[] {
    return commerce.getTopContactsByMessageCount(this.db, limit);
  }

  // ── Broadcasts ────────────────────────────────────────────────

  createBroadcast(broadcast: BroadcastMessage): void {
    messaging.createBroadcast(this.db, broadcast);
  }

  updateBroadcastStatus(id: string, status: string, sentCount?: number, failedCount?: number): void {
    messaging.updateBroadcastStatus(this.db, id, status, sentCount, failedCount);
  }

  getAllBroadcasts(): BroadcastMessage[] {
    return messaging.getAllBroadcasts(this.db);
  }

  addBroadcastRecipient(recipient: BroadcastRecipient): void {
    messaging.addBroadcastRecipient(this.db, recipient);
  }

  updateBroadcastRecipient(broadcastId: string, contactId: string, status: string, error?: string): void {
    messaging.updateBroadcastRecipient(this.db, broadcastId, contactId, status, error);
  }

  getBroadcastRecipients(broadcastId: string): BroadcastRecipient[] {
    return messaging.getBroadcastRecipients(this.db, broadcastId);
  }

  // ── Scheduled Messages ───────────────────────────────────────

  createScheduledMessage(msg: ScheduledMessage): void {
    messaging.createScheduledMessage(this.db, msg);
  }

  updateScheduledMessage(id: string, updates: Partial<ScheduledMessage>): void {
    messaging.updateScheduledMessage(this.db, id, updates);
  }

  deleteScheduledMessage(id: string): void {
    messaging.deleteScheduledMessage(this.db, id);
  }

  getScheduledMessage(id: string): ScheduledMessage | undefined {
    return messaging.getScheduledMessage(this.db, id);
  }

  getAllScheduledMessages(): ScheduledMessage[] {
    return messaging.getAllScheduledMessages(this.db);
  }

  getDueScheduledMessages(): ScheduledMessage[] {
    return messaging.getDueScheduledMessages(this.db);
  }

  // ── Knowledge Base ────────────────────────────────────────────

  createKnowledgeEntry(entry: KnowledgeEntry): void {
    knowledge.createKnowledgeEntry(this.db, entry);
  }

  getKnowledgeEntry(id: string): KnowledgeEntry | undefined {
    return knowledge.getKnowledgeEntry(this.db, id);
  }

  getAllKnowledgeEntries(category?: string): KnowledgeEntry[] {
    return knowledge.getAllKnowledgeEntries(this.db, category);
  }

  searchKnowledge(query: string, maxResults = 5): KnowledgeSearchResult[] {
    return knowledge.searchKnowledge(this.db, query, maxResults);
  }

  searchKnowledgeSemantic(
    queryEmbedding: number[],
    maxResults = 5,
    minScore = 0.3,
  ): KnowledgeSearchResult[] {
    return knowledge.searchKnowledgeSemantic(this.db, queryEmbedding, maxResults, minScore);
  }

  setKnowledgeEmbedding(id: string, embedding: number[]): void {
    knowledge.setKnowledgeEmbedding(this.db, id, embedding);
  }

  getKnowledgeEntriesWithoutEmbedding(): KnowledgeEntry[] {
    return knowledge.getKnowledgeEntriesWithoutEmbedding(this.db);
  }

  updateKnowledgeEntry(id: string, updates: Partial<KnowledgeEntry>): void {
    knowledge.updateKnowledgeEntry(this.db, id, updates);
  }

  deleteKnowledgeEntry(id: string): void {
    knowledge.deleteKnowledgeEntry(this.db, id);
  }

  getKnowledgeCategories(): string[] {
    return knowledge.getKnowledgeCategories(this.db);
  }

  getKnowledgeCount(): number {
    return knowledge.getKnowledgeCount(this.db);
  }

  // ── KB Files (Flexible RAG) ──────────────────────────────────

  createKbFile(file: { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status?: string }): void {
    knowledge.createKbFile(this.db, file);
  }

  updateKbFileStatus(id: string, status: string, error?: string): void {
    knowledge.updateKbFileStatus(this.db, id, status, error);
  }

  getKbFile(id: string): { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string; error?: string; createdAt: Date; updatedAt: Date } | undefined {
    return knowledge.getKbFile(this.db, id);
  }

  getKbFileByName(fileName: string): { id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string } | undefined {
    return knowledge.getKbFileByName(this.db, fileName);
  }

  getAllKbFiles(): Array<{ id: string; fileName: string; filePath: string; fileExtension: string; fileSize: number; chunkCount: number; status: string; createdAt: Date }> {
    return knowledge.getAllKbFiles(this.db);
  }

  deleteKbFile(id: string): void {
    knowledge.deleteKbFile(this.db, id);
  }

  // ── KB Chunks ────────────────────────────────────────────────

  createKbChunk(chunk: { id: string; fileId: string; chunkIndex: number; content: string; sectionHeading?: string; rowNumber?: number; lineStart?: number; lineEnd?: number; embedding?: number[] }): void {
    knowledge.createKbChunk(this.db, chunk);
  }

  setKbChunkEmbedding(id: string, embedding: number[]): void {
    knowledge.setKbChunkEmbedding(this.db, id, embedding);
  }

  getKbChunksByFileId(fileId: string): Array<{ id: string; fileId: string; chunkIndex: number; content: string; sectionHeading?: string; embedding?: number[] }> {
    return knowledge.getKbChunksByFileId(this.db, fileId);
  }

  getKbChunksWithoutEmbedding(): Array<{ id: string; fileId: string; content: string }> {
    return knowledge.getKbChunksWithoutEmbedding(this.db);
  }

  searchKbChunksSemantic(queryEmbedding: number[], maxResults = 5, minScore = 0.3): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
    return knowledge.searchKbChunksSemantic(this.db, queryEmbedding, maxResults, minScore);
  }

  searchKbChunksKeyword(query: string, maxResults = 5): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; fileName?: string }> {
    return knowledge.searchKbChunksKeyword(this.db, query, maxResults);
  }

  searchKbChunks(
    query: string,
    queryEmbedding: number[] | null,
    maxResults = 5,
    minScore = 0.3,
  ): Array<{ chunkId: string; fileId: string; content: string; sectionHeading?: string; score: number; matchedOn: 'semantic' | 'keyword' | 'combined'; fileName?: string }> {
    return knowledge.searchKbChunks(this.db, query, queryEmbedding, maxResults, minScore);
  }

  getKbChunkCount(): number {
    return knowledge.getKbChunkCount(this.db);
  }

  // ── Orders ───────────────────────────────────────────────────

  saveOrder(order: { id: string; contactId: string; orderNumber: string; status?: string; items?: any[]; totalAmount?: number; currency?: string; shippingAddress?: string; notes?: string }): void {
    commerce.saveOrder(this.db, order);
  }

  getOrder(id: string): any | null {
    return commerce.getOrder(this.db, id);
  }

  getOrdersByContact(contactId: string, limit = 10): any[] {
    return commerce.getOrdersByContact(this.db, contactId, limit);
  }

  updateOrderStatus(id: string, status: string): void {
    commerce.updateOrderStatus(this.db, id, status);
  }

  searchOrders(query: string, limit = 10): any[] {
    return commerce.searchOrders(this.db, query, limit);
  }

  // ── Payments ─────────────────────────────────────────────────

  savePayment(payment: { id: string; orderId?: string; contactId?: string; amount: number; method: string; proof?: string; recordedBy?: string }): void {
    commerce.savePayment(this.db, payment);
  }

  getPaymentsByOrder(orderId: string): any[] {
    return commerce.getPaymentsByOrder(this.db, orderId);
  }

  // ── Products ─────────────────────────────────────────────────

  saveProduct(product: { id: string; name: string; description?: string; price: number; currency?: string; stock?: number; category?: string; sku?: string; imageUrl?: string; isActive?: boolean; metadata?: any }): void {
    commerce.saveProduct(this.db, product);
  }

  getProduct(id: string): any | null {
    return commerce.getProduct(this.db, id);
  }

  getProductsByCategory(category: string, limit = 50): any[] {
    return commerce.getProductsByCategory(this.db, category, limit);
  }

  searchProducts(query: string, limit = 10): any[] {
    return commerce.searchProducts(this.db, query, limit);
  }

  updateProductStock(id: string, stock: number): void {
    commerce.updateProductStock(this.db, id, stock);
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

  getEncryptionKey(): Buffer | null {
    return this.encryptionKey;
  }
}
