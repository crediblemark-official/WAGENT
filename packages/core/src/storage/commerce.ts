import BetterSqlite3 from 'better-sqlite3';
import { DailyStats } from '../types.js';
import { getLogger } from '../utils/logger.js';

// ── Helper Row Converter ──────────────────────────────────────────

export function rowToProduct(row: any): any {
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

// ── Conversation (AI Context) ─────────────────────────────────

export function addConversation(db: BetterSqlite3.Database, contactId: string, role: string, content: string, tokenCount = 0): void {
  db.prepare(
    'INSERT INTO conversations (contact_id, role, content, token_count) VALUES (?, ?, ?, ?)'
  ).run(contactId, role, content, tokenCount);
}

export function getConversationHistory(db: BetterSqlite3.Database, contactId: string, limit = 30): { role: string; content: string }[] {
  const rows = db.prepare(
    'SELECT role, content FROM conversations WHERE contact_id = ? ORDER BY created_at ASC LIMIT ?'
  ).all(contactId, limit) as any[];
  return rows.map(r => ({ role: r.role, content: r.content }));
}

export function clearConversation(db: BetterSqlite3.Database, contactId: string): void {
  db.prepare('DELETE FROM conversations WHERE contact_id = ?').run(contactId);
}

export function getStaleConversationContacts(db: BetterSqlite3.Database, hours: number): string[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(
    `SELECT contact_id FROM conversations
     GROUP BY contact_id
     HAVING MAX(created_at) < ?`
  ).all(cutoff) as any[];
  return rows.map(r => r.contact_id);
}

export function clearStaleConversations(db: BetterSqlite3.Database, hours: number): number {
  const contacts = getStaleConversationContacts(db, hours);
  for (const contactId of contacts) {
    clearConversation(db, contactId);
  }
  if (contacts.length > 0) {
    getLogger().info('Cleared stale conversations for %d contacts (idle > %dh)', contacts.length, hours);
  }
  return contacts.length;
}

export function trimConversation(db: BetterSqlite3.Database, contactId: string, maxEntries = 60): void {
  const count = db.prepare(
    'SELECT COUNT(*) as count FROM conversations WHERE contact_id = ?'
  ).get(contactId) as any;

  if (count.count > maxEntries) {
    const excess = count.count - maxEntries;
    db.prepare(`
      DELETE FROM conversations WHERE contact_id = ? AND created_at IN (
        SELECT created_at FROM conversations WHERE contact_id = ? ORDER BY created_at ASC LIMIT ?
      )
    `).run(contactId, contactId, excess);
  }
}

// ── Stats ─────────────────────────────────────────────────────

export function incrementMessageCount(db: BetterSqlite3.Database, type: 'incoming' | 'outgoing'): void {
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`
    INSERT INTO daily_stats (date, total_messages, incoming_messages, outgoing_messages, unique_contacts, ai_response_count, avg_response_time)
    VALUES (?, 1, ?, ?, 0, 0, 0)
    ON CONFLICT(date) DO UPDATE SET
      total_messages = total_messages + 1,
      incoming_messages = incoming_messages + ?,
      outgoing_messages = outgoing_messages + ?
  `).run(today, type === 'incoming' ? 1 : 0, type === 'outgoing' ? 1 : 0,
    type === 'incoming' ? 1 : 0, type === 'outgoing' ? 1 : 0);
}

export function getStats(db: BetterSqlite3.Database, days = 7): DailyStats[] {
  const rows = db.prepare(
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

export function getTopContactsByMessageCount(db: BetterSqlite3.Database, limit = 5): { name: string; messages: number }[] {
  const rows = db.prepare(`
    SELECT c.contact_name AS name, COUNT(m.id) AS messages
    FROM messages m
    JOIN chats c ON m.chat_id = c.id
    GROUP BY m.chat_id
    ORDER BY messages DESC
    LIMIT ?
  `).all(limit) as any[];
  return rows.map(r => ({ name: r.name, messages: r.messages }));
}

// ── Orders ───────────────────────────────────────────────────

export function saveOrder(db: BetterSqlite3.Database, order: { id: string; contactId: string; orderNumber: string; status?: string; items?: any[]; totalAmount?: number; currency?: string; shippingAddress?: string; notes?: string }): void {
  db.prepare(`
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

export function getOrder(db: BetterSqlite3.Database, id: string): any | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as any;
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

export function getOrdersByContact(db: BetterSqlite3.Database, contactId: string, limit = 10): any[] {
  const rows = db.prepare(
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

export function updateOrderStatus(db: BetterSqlite3.Database, id: string, status: string): void {
  db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);
}

export function searchOrders(db: BetterSqlite3.Database, query: string, limit = 10): any[] {
  const rows = db.prepare(
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

// ── Payments ─────────────────────────────────────────────────

export function savePayment(db: BetterSqlite3.Database, payment: { id: string; orderId?: string; contactId?: string; amount: number; method: string; proof?: string; recordedBy?: string }): void {
  db.prepare(`
    INSERT INTO payments (id, order_id, contact_id, amount, method, proof, recorded_by, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'recorded', datetime('now'))
  `).run(
    payment.id,
    payment.orderId || null,
    payment.contactId || null,
    payment.amount,
    payment.method,
    payment.proof || '',
    payment.recordedBy || 'system',
  );
}

export function getPaymentsByOrder(db: BetterSqlite3.Database, orderId: string): any[] {
  return (db.prepare(
    'SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC'
  ).all(orderId) as any[]).map(r => ({
    id: r.id,
    orderId: r.order_id,
    contactId: r.contact_id,
    amount: r.amount,
    method: r.method,
    proof: r.proof,
    recordedBy: r.recorded_by,
    status: r.status,
    createdAt: new Date(r.created_at),
  }));
}

// ── Products ─────────────────────────────────────────────────

export function saveProduct(db: BetterSqlite3.Database, product: { id: string; name: string; description?: string; price: number; currency?: string; stock?: number; category?: string; sku?: string; imageUrl?: string; isActive?: boolean; metadata?: any }): void {
  db.prepare(`
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

export function getProduct(db: BetterSqlite3.Database, id: string): any | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as any;
  if (!row) return null;
  return rowToProduct(row);
}

export function getProductsByCategory(db: BetterSqlite3.Database, category: string, limit = 50): any[] {
  const rows = db.prepare(
    'SELECT * FROM products WHERE category = ? AND is_active = 1 ORDER BY name LIMIT ?'
  ).all(category, limit) as any[];
  return rows.map(r => rowToProduct(r));
}

export function searchProducts(db: BetterSqlite3.Database, query: string, limit = 10): any[] {
  const rows = db.prepare(
    `SELECT * FROM products
     WHERE is_active = 1 AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)
     ORDER BY name LIMIT ?`
  ).all(`%${query}%`, `%${query}%`, `%${query}%`, limit) as any[];
  return rows.map(r => rowToProduct(r));
}

export function updateProductStock(db: BetterSqlite3.Database, id: string, stock: number): void {
  db.prepare('UPDATE products SET stock = ?, updated_at = datetime(\'now\') WHERE id = ?').run(stock, id);
}
