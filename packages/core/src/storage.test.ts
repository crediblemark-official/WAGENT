import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Database } from './storage.js';
import { Message, Contact, Chat, ScheduledMessage, BroadcastMessage } from './types.js';

function makeTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wagent-test-'));
  return join(dir, 'test.db');
}

function makeContact(id = 'c1@s.whatsapp.net', name = 'Test'): Contact {
  return { id, name, number: id.split('@')[0], isGroup: false, createdAt: new Date(), updatedAt: new Date() };
}

function makeChat(id = 'ch1', contactId = 'c1@s.whatsapp.net', name = 'Test'): Chat {
  return { id, contactId, contactName: name, unreadCount: 0, isGroup: false, createdAt: new Date() };
}

function makeMsg(id = 'm1'): Message {
  return { id, from: 'c1@s.whatsapp.net', to: 'bot', content: 'Test', type: 'text', timestamp: new Date(), fromMe: false };
}

describe('Database', () => {
  let db: Database;
  let TEST_DB: string;

  beforeEach(() => {
    TEST_DB = makeTestDb();
    db = new Database(TEST_DB);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  // ── Contacts ──────────────────────────────────────────────────

  describe('Contacts', () => {
    it('should save and retrieve a contact', () => {
      const contact: Contact = {
        id: '628123456@s.whatsapp.net',
        name: 'John Doe',
        pushName: 'John',
        number: '628123456',
        isGroup: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.saveContact(contact);
      const retrieved = db.getContact(contact.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('John Doe');
      expect(retrieved!.number).toBe('628123456');
    });

    it('should update existing contact', () => {
      const contact: Contact = {
        id: '628123456@s.whatsapp.net',
        name: 'John',
        number: '628123456',
        isGroup: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.saveContact(contact);
      db.saveContact({ ...contact, name: 'John Updated', notes: 'VIP customer' });
      const updated = db.getContact(contact.id);
      expect(updated!.name).toBe('John Updated');
      expect(updated!.notes).toBe('VIP customer');
    });

    it('should return all contacts', () => {
      const c1: Contact = { id: '1@s.whatsapp.net', name: 'A', number: '1', isGroup: false, createdAt: new Date(), updatedAt: new Date() };
      const c2: Contact = { id: '2@s.whatsapp.net', name: 'B', number: '2', isGroup: false, createdAt: new Date(), updatedAt: new Date() };
      db.saveContact(c1);
      db.saveContact(c2);
      expect(db.getAllContacts()).toHaveLength(2);
    });

    it('should search contacts by name or number', () => {
      const c1: Contact = { id: '1@s.whatsapp.net', name: 'Andi', number: '62811', isGroup: false, createdAt: new Date(), updatedAt: new Date() };
      const c2: Contact = { id: '2@s.whatsapp.net', name: 'Budi', number: '62822', isGroup: false, createdAt: new Date(), updatedAt: new Date() };
      db.saveContact(c1);
      db.saveContact(c2);
      expect(db.searchContacts('Andi')).toHaveLength(1);
      expect(db.searchContacts('62822')).toHaveLength(1);
      expect(db.searchContacts('xyz')).toHaveLength(0);
    });
  });

  // ── Chats ─────────────────────────────────────────────────────

  describe('Chats', () => {
    it('should save and retrieve a chat', () => {
      db.saveContact(makeContact('628123@s.whatsapp.net', 'John'));
      const chat: Chat = {
        id: 'chat-1',
        contactId: '628123@s.whatsapp.net',
        contactName: 'John',
        lastMessage: 'Hello',
        lastMessageAt: new Date(),
        unreadCount: 5,
        isGroup: false,
        createdAt: new Date(),
      };
      db.saveChat(chat);
      const retrieved = db.getChat(chat.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.contactName).toBe('John');
      expect(retrieved!.unreadCount).toBe(5);
    });

    it('should list all chats ordered by last message', () => {
      db.saveContact(makeContact('1@s.whatsapp.net', 'Old'));
      db.saveContact(makeContact('2@s.whatsapp.net', 'Recent'));
      const old: Chat = { id: 'old', contactId: '1@s.whatsapp.net', contactName: 'Old', lastMessageAt: new Date('2020-01-01'), unreadCount: 0, isGroup: false, createdAt: new Date() };
      const recent: Chat = { id: 'recent', contactId: '2@s.whatsapp.net', contactName: 'Recent', lastMessageAt: new Date('2025-01-01'), unreadCount: 0, isGroup: false, createdAt: new Date() };
      db.saveChat(old);
      db.saveChat(recent);
      const chats = db.getAllChats();
      expect(chats[0].id).toBe('recent');
    });
  });

  // ── Messages ──────────────────────────────────────────────────

  describe('Messages', () => {
    it('should save and retrieve messages for a chat', () => {
      db.saveContact(makeContact('sender@s.whatsapp.net', 'Sender'));
      db.saveChat(makeChat('chat-1', 'sender@s.whatsapp.net', 'Sender'));
      const msg: Message = {
        id: 'msg-1',
        from: 'sender@s.whatsapp.net',
        to: 'receiver@s.whatsapp.net',
        content: 'Test message',
        type: 'text',
        timestamp: new Date(),
        fromMe: false,
      };
      db.saveMessage(msg, 'chat-1');
      const messages = db.getMessages('chat-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test message');
    });
  });

  // ── Scheduled Messages ────────────────────────────────────────

  describe('Scheduled Messages', () => {
    it('should create and retrieve a scheduled message', () => {
      const scheduled: ScheduledMessage = {
        id: 'sched-1',
        contactId: '628123@s.whatsapp.net',
        contactName: 'John',
        content: 'Scheduled text',
        scheduledAt: new Date('2025-06-01'),
        repeat: 'none',
        status: 'pending',
        sentCount: 0,
        failedCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      db.createScheduledMessage(scheduled);
      const retrieved = db.getScheduledMessage('sched-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.content).toBe('Scheduled text');
    });

    it('should return due scheduled messages', () => {
      const past: ScheduledMessage = {
        id: 'past', contactId: '1', contactName: 'A', content: 'Past', scheduledAt: new Date('2020-01-01'),
        repeat: 'none', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(), nextRunAt: new Date('2020-01-01'),
      };
      const future: ScheduledMessage = {
        id: 'future', contactId: '2', contactName: 'B', content: 'Future', scheduledAt: new Date('2030-01-01'),
        repeat: 'none', status: 'pending', sentCount: 0, failedCount: 0,
        createdAt: new Date(), updatedAt: new Date(), nextRunAt: new Date('2030-01-01'),
      };
      db.createScheduledMessage(past);
      db.createScheduledMessage(future);
      const due = db.getDueScheduledMessages();
      expect(due).toHaveLength(1);
      expect(due[0].id).toBe('past');
    });

    it('should update scheduled message status', () => {
      const msg: ScheduledMessage = {
        id: 'sched-2', contactId: '1', contactName: 'A', content: 'Test',
        scheduledAt: new Date(), repeat: 'none', status: 'pending',
        sentCount: 0, failedCount: 0, createdAt: new Date(), updatedAt: new Date(),
      };
      db.createScheduledMessage(msg);
      db.updateScheduledMessage('sched-2', { status: 'sent', sentCount: 1 });
      const updated = db.getScheduledMessage('sched-2');
      expect(updated!.status).toBe('sent');
      expect(updated!.sentCount).toBe(1);
    });

    it('should delete scheduled message', () => {
      const msg: ScheduledMessage = {
        id: 'del-me', contactId: '1', contactName: 'A', content: 'Delete me',
        scheduledAt: new Date(), repeat: 'none', status: 'pending',
        sentCount: 0, failedCount: 0, createdAt: new Date(), updatedAt: new Date(),
      };
      db.createScheduledMessage(msg);
      db.deleteScheduledMessage('del-me');
      expect(db.getScheduledMessage('del-me')).toBeUndefined();
    });
  });

  // ── Stats ─────────────────────────────────────────────────────

  describe('Stats', () => {
    it('should increment message count', () => {
      db.incrementMessageCount('incoming');
      db.incrementMessageCount('outgoing');
      const stats = db.getStats(7);
      expect(stats).toHaveLength(1);
      expect(stats[0].totalMessages).toBe(2);
      expect(stats[0].incomingMessages).toBe(1);
      expect(stats[0].outgoingMessages).toBe(1);
    });

    it('should return empty array when no stats exist', () => {
      const stats = db.getStats(7);
      expect(stats).toEqual([]);
    });
  });

  // ── Knowledge Base ─────────────────────────────────────────────

  describe('Knowledge Base', () => {
    it('should create and retrieve a knowledge entry', () => {
      db.createKnowledgeEntry({
        id: 'kb-1', category: 'produk',
        question: 'Berapa harga?', answer: 'Rp 50.000',
        keywords: ['harga', 'produk'], tags: ['faq'],
        priority: 5, createdAt: new Date(), updatedAt: new Date(),
      });
      const entry = db.getKnowledgeEntry('kb-1');
      expect(entry).toBeDefined();
      expect(entry!.question).toBe('Berapa harga?');
      expect(entry!.answer).toBe('Rp 50.000');
      expect(entry!.keywords).toEqual(['harga', 'produk']);
      expect(entry!.priority).toBe(5);
    });

    it('should return undefined for non-existent entry', () => {
      expect(db.getKnowledgeEntry('nonexistent')).toBeUndefined();
    });

    it('should update a knowledge entry', () => {
      db.createKnowledgeEntry({
        id: 'kb-upd', category: 'general',
        question: 'Old?', answer: 'Old answer',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      db.updateKnowledgeEntry('kb-upd', { answer: 'New answer', priority: 3 });
      const updated = db.getKnowledgeEntry('kb-upd');
      expect(updated!.answer).toBe('New answer');
      expect(updated!.priority).toBe(3);
    });

    it('should delete a knowledge entry', () => {
      db.createKnowledgeEntry({
        id: 'kb-del', category: 'general',
        question: 'Delete?', answer: 'Bye',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      db.deleteKnowledgeEntry('kb-del');
      expect(db.getKnowledgeEntry('kb-del')).toBeUndefined();
    });

    it('should get all entries ordered by priority', () => {
      db.createKnowledgeEntry({
        id: 'kb-low', category: 'produk',
        question: 'Low', answer: 'Low priority',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kb-high', category: 'produk',
        question: 'High', answer: 'High priority',
        keywords: [], tags: [],
        priority: 10, createdAt: new Date(), updatedAt: new Date(),
      });
      const entries = db.getAllKnowledgeEntries();
      expect(entries).toHaveLength(2);
      // Higher priority first
      expect(entries[0].id).toBe('kb-high');
    });

    it('should filter entries by category', () => {
      db.createKnowledgeEntry({
        id: 'kb-cat-1', category: 'produk',
        question: 'Produk', answer: 'A',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kb-cat-2', category: 'pengiriman',
        question: 'Ongkir', answer: 'B',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      const filtered = db.getAllKnowledgeEntries('produk');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('kb-cat-1');
    });

    it('should get knowledge categories', () => {
      db.createKnowledgeEntry({
        id: 'kc-1', category: 'produk',
        question: 'Q', answer: 'A',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kc-2', category: 'pengiriman',
        question: 'Q', answer: 'A',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      const categories = db.getKnowledgeCategories();
      expect(categories).toContain('produk');
      expect(categories).toContain('pengiriman');
      expect(categories).toHaveLength(2);
    });

    it('should get knowledge count', () => {
      expect(db.getKnowledgeCount()).toBe(0);
      db.createKnowledgeEntry({
        id: 'kc-count', category: 'general',
        question: 'Q', answer: 'A',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      expect(db.getKnowledgeCount()).toBe(1);
    });

    it('should search knowledge base by keywords', () => {
      db.createKnowledgeEntry({
        id: 'kb-search-1', category: 'produk',
        question: 'Harga produk A?', answer: 'Rp 100.000',
        keywords: ['harga', 'produk', 'biaya'], tags: [],
        priority: 5, createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kb-search-2', category: 'pengiriman',
        question: 'Ongkir ke Jakarta?', answer: 'Rp 15.000',
        keywords: ['ongkir', 'pengiriman', 'biaya kirim'], tags: [],
        priority: 3, createdAt: new Date(), updatedAt: new Date(),
      });

      const results = db.searchKnowledge('harga produk', 5);
      expect(results.length).toBeGreaterThanOrEqual(1);
      // produk entry should be first (higher priority + keyword match)
      const firstResult = results.find(r => r.entry.id === 'kb-search-1');
      expect(firstResult).toBeDefined();
      expect(firstResult!.score).toBeGreaterThan(0);
    });

    it('should return empty for non-matching search', () => {
      db.createKnowledgeEntry({
        id: 'kb-nomatch', category: 'general',
        question: 'Something', answer: 'Else',
        keywords: ['foo'], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      const results = db.searchKnowledge('xyz123nonexistent', 5);
      expect(results).toHaveLength(0);
    });

    it('should prioritize keyword matches over question/answer', () => {
      // Entry with matching keyword should score higher
      db.createKnowledgeEntry({
        id: 'kb-keyword', category: 'general',
        question: 'Not matching question', answer: 'Not matching answer',
        keywords: ['keyword_match_test'], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kb-question', category: 'general',
        question: 'keyword_match_test question', answer: 'Just answer',
        keywords: ['other'], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });

      const results = db.searchKnowledge('keyword_match_test', 5);
      expect(results).toHaveLength(2);
      // Keyword match should be first
      expect(results[0].entry.id).toBe('kb-keyword');
      expect(results[0].matchedOn).toBe('keyword');
    });
  });

  // ── Broadcasts ─────────────────────────────────────────────────

  describe('Broadcasts', () => {
    it('should create a broadcast', () => {
      db.createBroadcast({
        id: 'bc-1', content: 'Promo!',
        targetFilter: { tags: ['vip'] },
        status: 'pending', totalContacts: 10,
        sentCount: 0, failedCount: 0,
        createdAt: new Date(),
      });
      const broadcasts = db.getAllBroadcasts();
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0].content).toBe('Promo!');
    });

    it('should update broadcast status', () => {
      db.createBroadcast({
        id: 'bc-upd', content: 'Update',
        status: 'sending', totalContacts: 5,
        sentCount: 0, failedCount: 0,
        createdAt: new Date(),
      });
      db.updateBroadcastStatus('bc-upd', 'completed', 5, 0);
      const broadcasts = db.getAllBroadcasts();
      const bc = broadcasts.find(b => b.id === 'bc-upd');
      expect(bc).toBeDefined();
      expect(bc!.status).toBe('completed');
      expect(bc!.sentCount).toBe(5);
    });

    it('should add broadcast recipients', () => {
      db.createBroadcast({
        id: 'bc-recip', content: 'Bulk',
        status: 'pending', totalContacts: 2,
        sentCount: 0, failedCount: 0,
        createdAt: new Date(),
      });
      db.addBroadcastRecipient({ broadcastId: 'bc-recip', contactId: 'c1', status: 'pending' });
      db.addBroadcastRecipient({ broadcastId: 'bc-recip', contactId: 'c2', status: 'pending' });

      const recipients = db.getBroadcastRecipients('bc-recip');
      expect(recipients).toHaveLength(2);
    });

    it('should update broadcast recipient status', () => {
      db.createBroadcast({
        id: 'bc-recip-upd', content: 'Bulk',
        status: 'sending', totalContacts: 1,
        sentCount: 0, failedCount: 0,
        createdAt: new Date(),
      });
      db.addBroadcastRecipient({ broadcastId: 'bc-recip-upd', contactId: 'c1', status: 'pending' });
      db.updateBroadcastRecipient('bc-recip-upd', 'c1', 'sent');

      const recipients = db.getBroadcastRecipients('bc-recip-upd');
      expect(recipients[0].status).toBe('sent');
    });
  });

  // ── Conversations ──────────────────────────────────────────────

  describe('Conversations', () => {
    beforeEach(() => {
      // FK constraint: contacts must exist before conversations
      db.saveContact(makeContact('c1@s.whatsapp.net', 'C1'));
      db.saveContact(makeContact('c2@s.whatsapp.net', 'C2'));
      db.saveContact(makeContact('stale@s.whatsapp.net', 'Stale'));
      db.saveContact(makeContact('stale2@s.whatsapp.net', 'Stale2'));
      db.saveContact(makeContact('trim@s.whatsapp.net', 'Trim'));
      db.saveContact(makeContact('undertrim@s.whatsapp.net', 'UnderTrim'));
    });

    it('should add and retrieve conversation history', () => {
      db.addConversation('c1@s.whatsapp.net', 'user', 'Halo');
      db.addConversation('c1@s.whatsapp.net', 'assistant', 'Halo juga!');
      const history = db.getConversationHistory('c1@s.whatsapp.net');
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[1].content).toBe('Halo juga!');
    });

    it('should clear conversation history', () => {
      db.addConversation('c2@s.whatsapp.net', 'user', 'Pesan');
      db.clearConversation('c2@s.whatsapp.net');
      const history = db.getConversationHistory('c2@s.whatsapp.net');
      expect(history).toHaveLength(0);
    });

    it('should find stale conversations', () => {
      db.addConversation('stale@s.whatsapp.net', 'user', 'Lama');
      const dbAny = (db as any);
      dbAny.db.prepare(
        "UPDATE conversations SET created_at = datetime('now', '-25 hours') WHERE contact_id = ?"
      ).run('stale@s.whatsapp.net');

      const staleContacts = db.getStaleConversationContacts(24);
      expect(staleContacts).toContain('stale@s.whatsapp.net');
    });

    it('should clear stale conversations', () => {
      db.addConversation('stale2@s.whatsapp.net', 'user', 'Lama');
      const dbAny = (db as any);
      dbAny.db.prepare(
        "UPDATE conversations SET created_at = datetime('now', '-25 hours') WHERE contact_id = ?"
      ).run('stale2@s.whatsapp.net');

      const cleared = db.clearStaleConversations(24);
      expect(cleared).toBe(1);
      const history = db.getConversationHistory('stale2@s.whatsapp.net');
      expect(history).toHaveLength(0);
    });

    it('should trim conversations when exceeding max entries', () => {
      // Add 70 entries for the same contact (with tiny delay to ensure unique timestamps)
      for (let i = 0; i < 70; i++) {
        db.addConversation('trim@s.whatsapp.net', 'user', `Pesan ${i}`);
      }
      db.trimConversation('trim@s.whatsapp.net', 60);
      const history = db.getConversationHistory('trim@s.whatsapp.net');
      // Should have at most 60 entries
      expect(history.length).toBeLessThanOrEqual(60);
    });

    it('should not trim when under limit', () => {
      db.addConversation('undertrim@s.whatsapp.net', 'user', 'Only one');
      db.trimConversation('undertrim@s.whatsapp.net', 60);
      const history = db.getConversationHistory('undertrim@s.whatsapp.net');
      expect(history).toHaveLength(1);
    });
  });

  // ── Message Utilities ──────────────────────────────────────────

  describe('Message Utilities', () => {
    it('should check if message exists', () => {
      db.saveContact(makeContact('msgexist@s.whatsapp.net', 'Exist'));
      db.saveChat(makeChat('chat-msg-exist', 'msgexist@s.whatsapp.net', 'Exist'));
      const msg = makeMsg('msg-exist-1');
      db.saveMessage(msg, 'chat-msg-exist');
      expect(db.messageExists('msg-exist-1')).toBe(true);
      expect(db.messageExists('nonexistent-msg')).toBe(false);
    });
  });

  // ── Semantic Search (Embeddings) ────────────────────────────────

  describe('Semantic Search', () => {
    it('should create entry with embedding and retrieve it', () => {
      const embedding = Array.from({ length: 768 }, (_, i) => (i % 100) / 100);
      db.createKnowledgeEntry({
        id: 'kb-emb', category: 'general',
        question: 'Test Q', answer: 'Test A',
        keywords: [], tags: [],
        priority: 1, embedding,
        createdAt: new Date(), updatedAt: new Date(),
      });
      const entry = db.getKnowledgeEntry('kb-emb');
      expect(entry).toBeDefined();
      expect(entry!.embedding).toEqual(embedding);
      expect(entry!.embedding).toHaveLength(768);
    });

    it('should set embedding via setKnowledgeEmbedding', () => {
      db.createKnowledgeEntry({
        id: 'kb-emb-set', category: 'general',
        question: 'Q', answer: 'A',
        keywords: [], tags: [],
        priority: 1,
        createdAt: new Date(), updatedAt: new Date(),
      });
      const embedding = Array.from({ length: 768 }, () => 0.5);
      db.setKnowledgeEmbedding('kb-emb-set', embedding);
      const entry = db.getKnowledgeEntry('kb-emb-set');
      expect(entry!.embedding).toEqual(embedding);
    });

    it('should find entries without embedding', () => {
      db.createKnowledgeEntry({
        id: 'kb-no-emb', category: 'general',
        question: 'No emb', answer: 'A',
        keywords: [], tags: [],
        priority: 1,
        createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kb-with-emb', category: 'general',
        question: 'With emb', answer: 'A',
        keywords: [], tags: [],
        priority: 1, embedding: [0.1, 0.2],
        createdAt: new Date(), updatedAt: new Date(),
      });

      const withoutEmb = db.getKnowledgeEntriesWithoutEmbedding();
      expect(withoutEmb).toHaveLength(1);
      expect(withoutEmb[0].id).toBe('kb-no-emb');
    });

    it('should return semantic search results by cosine similarity', () => {
      // Entry A: similar to query (small angle)
      db.createKnowledgeEntry({
        id: 'kb-sim-1', category: 'produk',
        question: 'Harga produk A?', answer: 'Rp 100.000',
        keywords: ['harga'], tags: [],
        priority: 1, embedding: [0.9, 0.1, 0.0],
        createdAt: new Date(), updatedAt: new Date(),
      });
      // Entry B: less similar
      db.createKnowledgeEntry({
        id: 'kb-sim-2', category: 'pengiriman',
        question: 'Ongkir ke Jakarta?', answer: 'Rp 15.000',
        keywords: ['ongkir'], tags: [],
        priority: 1, embedding: [0.3, 0.8, 0.1],
        createdAt: new Date(), updatedAt: new Date(),
      });

      // Query embedding closer to entry A (0.9, 0.1, 0.0 vs 0.3, 0.8, 0.1)
      const queryEmb = [0.85, 0.15, 0.05];
      const results = db.searchKnowledgeSemantic(queryEmb, 5, 0.3);

      expect(results).toHaveLength(2);
      expect(results[0].entry.id).toBe('kb-sim-1');
      expect(results[0].matchedOn).toBe('semantic');
      expect(results[0].score).toBeGreaterThan(0.9);
    });

    it('should filter by minimum score threshold', () => {
      db.createKnowledgeEntry({
        id: 'kb-thresh-1', category: 'general',
        question: 'Close', answer: 'A',
        keywords: [], tags: [],
        priority: 1, embedding: [1.0, 0.0],
        createdAt: new Date(), updatedAt: new Date(),
      });
      db.createKnowledgeEntry({
        id: 'kb-thresh-2', category: 'general',
        question: 'Far', answer: 'B',
        keywords: [], tags: [],
        priority: 1, embedding: [-0.5, 0.5],
        createdAt: new Date(), updatedAt: new Date(),
      });

      const queryEmb = [0.9, 0.1];
      const results = db.searchKnowledgeSemantic(queryEmb, 5, 0.8);

      // Only the close one should pass the threshold
      expect(results).toHaveLength(1);
      expect(results[0].entry.id).toBe('kb-thresh-1');
    });

    it('should return empty when no entries have embeddings', () => {
      db.createKnowledgeEntry({
        id: 'kb-no-emb-2', category: 'general',
        question: 'No emb', answer: 'A',
        keywords: [], tags: [],
        priority: 1,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const results = db.searchKnowledgeSemantic([0.1, 0.2], 5);
      expect(results).toHaveLength(0);
    });

    it('should respect maxResults limit', () => {
      for (let i = 0; i < 5; i++) {
        db.createKnowledgeEntry({
          id: `kb-limit-${i}`, category: 'general',
          question: `Entry ${i}`, answer: 'A',
          keywords: [], tags: [],
          priority: 1, embedding: [1 - i * 0.1, 0.0],
          createdAt: new Date(), updatedAt: new Date(),
        });
      }

      const results = db.searchKnowledgeSemantic([0.9, 0.0], 2);
      expect(results).toHaveLength(2);
    });

    it('should update embedding via updateKnowledgeEntry', () => {
      const emb1 = Array.from({ length: 768 }, () => 0.1);
      db.createKnowledgeEntry({
        id: 'kb-upd-emb', category: 'general',
        question: 'Q', answer: 'A',
        keywords: [], tags: [],
        priority: 1, embedding: emb1,
        createdAt: new Date(), updatedAt: new Date(),
      });

      const emb2 = Array.from({ length: 768 }, () => 0.9);
      db.updateKnowledgeEntry('kb-upd-emb', { embedding: emb2 });
      const entry = db.getKnowledgeEntry('kb-upd-emb');
      expect(entry!.embedding).toEqual(emb2);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────

  describe('Edge Cases', () => {
    it('should handle empty search query', () => {
      const results = db.searchKnowledge('', 5);
      expect(results).toHaveLength(0);
    });

    it('should return empty categories when no entries', () => {
      expect(db.getKnowledgeCategories()).toEqual([]);
    });

    it('should update knowledge entry only when fields provided', () => {
      db.createKnowledgeEntry({
        id: 'kb-partial', category: 'general',
        question: 'Q', answer: 'A',
        keywords: [], tags: [],
        priority: 1, createdAt: new Date(), updatedAt: new Date(),
      });
      // Update with empty object — should not crash
      db.updateKnowledgeEntry('kb-partial', {});
      const entry = db.getKnowledgeEntry('kb-partial');
      expect(entry).toBeDefined();
      expect(entry!.answer).toBe('A');
    });

    it('should handle updateBroadcastStatus with minimal params', () => {
      db.createBroadcast({
        id: 'bc-min', content: 'Min',
        status: 'pending', totalContacts: 0,
        sentCount: 0, failedCount: 0,
        createdAt: new Date(),
      });
      // Just update status without counts
      db.updateBroadcastStatus('bc-min', 'cancelled');
      const broadcasts = db.getAllBroadcasts();
      expect(broadcasts.find(b => b.id === 'bc-min')!.status).toBe('cancelled');
    });
  });
});
